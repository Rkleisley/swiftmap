# Swiftmap Custom AnyWidget Map Controller
import anywidget
import traitlets
import numpy as np
import contextlib
from typing import Optional, List, Dict, Any, Union
import pathlib
from ._infra import LayerConfig, _load_esm, _widget_css_path

# Import layer methods
from .layers.basemap import add_basemap
from .layers.circle_markers import add_circle_markers
from .layers.markers import add_markers
from .layers.polyline import add_line, add_polyline
from .layers.polygon import add_polygon, add_polygons, add_shape, add_shapes
from .layers.collection import add_collection, add_geojson, add_geostructures
from .layers.circle import add_circle

def _layers_from_json(value, widget):
    if not value:
        return []
    return [LayerConfig(**item) if isinstance(item, dict) else item for item in value]

def _layer_to_dict(item):
    return item.to_dict() if hasattr(item, "to_dict") else item

class Map(anywidget.AnyWidget):
    """
    High-performance Leaflet map controller with WebGL rendering pipelines for Shiny for Python.

    Extends `anywidget.AnyWidget` to seamlessly sync map viewports, layers, selection events,
    and hierarchical sidebar tree controls reactively between Python and JavaScript.

    Parameters
    ----------
    center : List[float], default [36.0, -5.35]
        Initial map center coordinates `[latitude, longitude]`.
    zoom : int, default 10
        Initial map zoom level (0 to 22).
    show_legend : bool, default False
        If True, `legend_html` returns markup for the active layers. There is no built-in
        map overlay yet -- render the string wherever your app wants it.
    show_logo : bool, default True
        If True, displays branding logos on the map viewport.
    height : str, optional
        Custom CSS height string for the map widget container (e.g. '600px', '100%').
    crs : str, default 'EPSG:3857'
        Coordinate Reference System projection:
        - 'EPSG:3857': Web Mercator (standard web tiles).
        - 'EPSG:4326': WGS84 Equirectangular / Plate Carrée.
    auto_sync : bool, default True
        If True, automatically syncs trait changes to the frontend JavaScript widget view.

    Examples
    --------
    >>> from swiftmap import Map
    >>> m = Map(center=[34.05, -118.24], zoom=12, crs="EPSG:3857")
    >>> m.add_basemap("Dark Matter", visible=True)
    """

    _esm = _load_esm()
    _css = _widget_css_path()

    # Assign helper methods
    add_basemap = add_basemap
    add_circle_markers = add_circle_markers
    add_markers = add_markers
    add_line = add_line
    add_polyline = add_polyline
    add_polygon = add_polygon
    add_polygons = add_polygons
    add_shape = add_shape
    add_shapes = add_shapes
    add_collection = add_collection
    add_geojson = add_geojson
    add_geostructures = add_geostructures
    add_circle = add_circle

    # Synchronized traits
    center = traitlets.List([36.0, -5.35]).tag(sync=True)
    zoom = traitlets.Int(10).tag(sync=True)
    crs = traitlets.Unicode("EPSG:3857").tag(sync=True)
    layers = traitlets.List([]).tag(
        sync=True, 
        to_json=lambda lst, _: [item.to_dict() if hasattr(item, 'to_dict') else item for item in lst],
        from_json=_layers_from_json
    )
    coordinate_buffers = traitlets.Dict({}).tag(sync=True)
    show_logo = traitlets.Bool(False).tag(sync=True)
    group_configs = traitlets.Dict(default_value={}).tag(sync=True)
    
    # Selection and click interaction tracking
    selected_index = traitlets.Int(-1).tag(sync=True)
    clicked_layer_id = traitlets.Unicode("").tag(sync=True)
    fit_bounds_coords = traitlets.List([]).tag(sync=True)
    js_console_logs = traitlets.List([]).tag(sync=True)
    auto_sync = traitlets.Bool(True).tag(sync=True)
    sync_trigger = traitlets.Int(0).tag(sync=True)
 
    def __init__(
        self,
        center: List[float] = [36.0, -5.35],
        zoom: int = 10,
        show_legend: bool = False,
        show_logo: bool = True,
        height: Optional[str] = None,
        crs: str = "EPSG:3857",
        auto_sync: bool = True,
        **kwargs
    ):
        super().__init__(**kwargs)

        # Patch-transport state. Initialized before any add_* call below, since the
        # default basemaps route through the same mutation path as user layers.
        self._batch_depth = 0
        self._pending_ops = []
        self._pending_buffers = []

        # A view can attach after layers already exist (the default basemaps are added
        # below, before any client is listening) and patches sent into that window are
        # lost. The frontend announces itself on render and we answer with a snapshot,
        # so the client always starts from a state that provably matches this object.
        self.on_msg(self._handle_client_msg)

        self.center = center
        self.zoom = zoom
        self.crs = crs
        self.show_legend = show_legend
        self.show_logo = show_logo
        self.auto_sync = auto_sync

        # Internal layer list counter
        self._layer_counter = 0

        # Initialize default basemaps based on projection
        if self.crs == "EPSG:4326":
            self.add_basemap("Esri WGS84", layer_group="Basemaps", group_multi_select=False, visible=True)
        else:
            self.add_basemap("Open Street Map", layer_group="Basemaps", group_multi_select=False, visible=True)
            self.add_basemap("Dark Matter", layer_group="Basemaps", group_multi_select=False, visible=False)

    # ------------------------------------------------------------------
    # Patch transport
    #
    # Reassigning `layers` or `coordinate_buffers` makes traitlets serialize and send
    # the ENTIRE map, so one added dwell costs O(everything already plotted). These
    # helpers instead update the trait storage in place (no notification, therefore no
    # full-snapshot send) and emit a small patch describing just what changed.
    #
    # The traits stay tagged sync=True on purpose: ipywidgets sends full state when a
    # view first attaches, which is exactly the snapshot a fresh or late-joining client
    # needs, and the frontend still writes `layers` back for sidebar toggles.
    # ------------------------------------------------------------------

    def _handle_client_msg(self, widget: Any, content: Any, buffers: Any) -> None:
        if isinstance(content, dict) and content.get("kind") == "swiftmap_ready":
            self.resync()

    def _set_trait_quietly(self, name: str, value: Any) -> None:
        """Updates trait storage without firing a notification (and so without a full send)."""
        self._trait_values[name] = value

    def _emit(self, op: Dict[str, Any], buffer: Optional[bytes] = None) -> None:
        """Queues a patch op, flushing immediately unless a batch() is open."""
        if buffer is not None:
            op = {**op, "buffer_index": len(self._pending_buffers)}
            self._pending_buffers.append(buffer)
        self._pending_ops.append(op)
        if self._batch_depth == 0:
            self._flush_ops()

    def _flush_ops(self) -> None:
        ops, buffers = self._pending_ops, self._pending_buffers
        self._pending_ops, self._pending_buffers = [], []
        if not ops:
            return
        # No comm yet (widget built outside a live session): the trait values are already
        # correct, so the initial state message will carry them.
        if getattr(self, "comm", None) is None:
            return
        self.send({"kind": "swiftmap_patch", "ops": ops}, buffers=buffers)

    def _layers_append(self, config: Any) -> None:
        self._set_trait_quietly("layers", self.layers + [config])
        self._emit({"op": "add", "layer": _layer_to_dict(config)})

    def _layers_replace(self, existing: Any, config: Any) -> None:
        self._set_trait_quietly(
            "layers", [config if l is existing else l for l in self.layers]
        )
        self._emit({"op": "replace", "id": config.get("id"), "layer": _layer_to_dict(config)})

    def _layers_set(self, new_layers: List[Any], removed_ids: List[Any]) -> None:
        self._set_trait_quietly("layers", new_layers)
        for layer_id in removed_ids:
            if layer_id is not None:
                self._emit({"op": "remove", "id": layer_id})

    def _layers_update_many(self, new_layers: List[Any], changed: List[Any]) -> None:
        self._set_trait_quietly("layers", new_layers)
        for config in changed:
            self._emit({"op": "replace", "id": config.get("id"), "layer": _layer_to_dict(config)})

    def _set_layer_buffer(self, layer_id: str, payload: bytes) -> None:
        """Stores one layer's coordinate buffer and sends only that buffer to the client."""
        self._set_trait_quietly(
            "coordinate_buffers", {**self.coordinate_buffers, layer_id: payload}
        )
        self._emit({"op": "buffer", "id": layer_id}, buffer=payload)

    def _remove_layer_buffers(self, layer_ids: Any) -> None:
        buffers = dict(self.coordinate_buffers)
        removed = [lid for lid in layer_ids if lid in buffers]
        if not removed:
            return
        for layer_id in removed:
            del buffers[layer_id]
        self._set_trait_quietly("coordinate_buffers", buffers)
        for layer_id in removed:
            self._emit({"op": "buffer_remove", "id": layer_id})

    def resync(self) -> "Map":
        """
        Pushes the complete map state to the client, replacing whatever it currently holds.

        Patches assume the client and server started from the same snapshot. Use this if a
        client may have missed messages, or to force-refresh a view.
        """
        self._pending_ops, self._pending_buffers = [], []
        if getattr(self, "comm", None) is None:
            return self
        buffers = []
        buffer_ids = []
        for layer_id, payload in self.coordinate_buffers.items():
            buffer_ids.append(layer_id)
            buffers.append(payload)
        self.send(
            {
                "kind": "swiftmap_patch",
                "ops": [{
                    "op": "snapshot",
                    "layers": [_layer_to_dict(l) for l in self.layers],
                    "buffer_ids": buffer_ids,
                }],
            },
            buffers=buffers,
        )
        return self

    @property
    def legend_html(self) -> str:
        """
        Returns HTML listing the active layers, or "" when `show_legend` is False.

        Not drawn on the map: place it in your own layout (a Shiny ui element, a notebook
        display call). A built-in overlay is not implemented.
        """
        if not self.show_legend:
            return ""
        items = []
        for l in self.layers:
            name = l.get("name", "Layer")
            color = l.get("color", "#3388ff")
            items.append(f"<div><span style='background:{color};width:10px;height:10px;display:inline-block;margin-right:5px;'></span>{name}</div>")
        return "".join(items)

    def add_child(
        self,
        child: Any,
        name: Optional[str] = None,
        layer_group: Optional[str] = None,
        group_multi_select: Optional[bool] = None
    ) -> "Map":
        """
        Adds a raw layer configuration dictionary or `LayerConfig` object directly to `map.layers`.

        Handles automatic layer ID generation, folder pathing resolution, and sub-layer merging.

        Parameters
        ----------
        child : Any
            Layer dictionary or LayerConfig instance.
        name : str, optional
            Layer display name.
        layer_group : str, optional
            Directory path string for sidebar folder tree (e.g. "Feeds/Active").
        group_multi_select : bool, optional
            If False, configures parent group to use mutually exclusive radio buttons.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        from .layers._add_child import add_child as add_child_fn
        return add_child_fn(self, child, name=name, layer_group=layer_group, group_multi_select=group_multi_select)

    def add_layer(self, layer: Any) -> "Map":
        """
        Compatibility wrapper for standard Leaflet `add_layer(layer)` syntax.

        Parameters
        ----------
        layer : Any
            Layer configuration object or dictionary.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        self.add_child(layer)
        return self

    def configure_group(self, group_name: str, **kwargs) -> "Map":
        """
        Configures properties and UI controls for a layer group folder in the sidebar.

        Parameters
        ----------
        group_name : str
            The folder path name of the target group (e.g., "Basemaps", "Sensor Feeds/Active").
        **kwargs
            Supported configuration keywords:
            - multi_select (bool) : If False, configures the group to render mutually exclusive 
                                    radio buttons instead of checkboxes.
            - group_multi_select (bool) : Alias for `multi_select`.
            - visible (bool) : Default initial visibility state for all layers in this group.
            - collapsed (bool) : Initial collapsed/expanded state of folder in sidebar tree.

        Returns
        -------
        Map
            Self reference for method chaining.

        Examples
        --------
        >>> m = Map()
        >>> # Configure Basemaps folder as mutually exclusive radio buttons
        >>> m.configure_group("Basemaps", multi_select=False)
        >>> # Force a group to be visible by default
        >>> m.configure_group("Sensor Feeds/Active", visible=True)
        """
        new_configs = dict(self.group_configs)
        group_conf = dict(new_configs.get(group_name, {}))
        
        for k, v in kwargs.items():
            if k in ("multi_select", "group_multi_select"):
                group_conf["multi_select"] = v
            else:
                group_conf[k] = v
                
        new_configs[group_name] = group_conf
        self.group_configs = new_configs
        return self

    def remove_layers(self, identifiers: List[Any]) -> "Map":
        """
        Removes multiple layers from the map by layer name or ID in a single atomic transaction.

        Also cleans up associated binary coordinate float buffers from trait memory.

        Parameters
        ----------
        identifiers : List[Any]
            List of layer IDs, layer names, or LayerConfig objects to remove.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        target_ids = set()
        target_names = set()
        for item in identifiers:
            if isinstance(item, dict):
                target_ids.add(item.get("id"))
                target_names.add(item.get("name"))
            else:
                target_ids.add(getattr(item, "id", item))
                target_names.add(getattr(item, "name", item))

        with self.batch():
            kept = []
            dropped = []
            for l in self.layers:
                if l.get("id") in target_ids or l.get("name") in target_names:
                    dropped.append(l)
                else:
                    kept.append(l)
            if not dropped:
                return self

            self._layers_set(kept, [l.get("id") for l in dropped])

            # Buffers belong to the removed layers and to any sub-layers they nested.
            buffer_ids = set()
            for l in dropped:
                buffer_ids.add(l.get("id"))
                for sub in (l.get("layers") or []):
                    sub_id = sub.get("id") if hasattr(sub, "get") else None
                    if sub_id:
                        buffer_ids.add(sub_id)
            self._remove_layer_buffers(buffer_ids)
        return self

    def remove_layer(self, name_or_id: Any) -> "Map":
        """
        Removes a single layer from the map by name or ID.

        Parameters
        ----------
        name_or_id : Any
            Layer ID string, layer name string, or LayerConfig object.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        return self.remove_layers([name_or_id])

    def fit_bounds(self, bounds: List[List[float]]) -> "Map":
        """
        Sets the map viewport bounds in the client widget.

        Parameters
        ----------
        bounds : List[List[float]]
            Bounding box coordinates `[[min_lat, min_lon], [max_lat, max_lon]]`.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        self.fit_bounds_coords = bounds
        return self

    def get_layer(self, identifier: Union[str, Any], name: Optional[str] = None) -> Optional[LayerConfig]:
        """
        Finds and returns a LayerConfig object matching by ID, name, or (layer_group, name).

        Parameters
        ----------
        identifier : Union[str, Any]
            Layer ID, layer name, or layer_group folder string.
        name : str, optional
            If specified, searches for a layer matching `layer_group == identifier` and `name == name`.

        Returns
        -------
        Optional[LayerConfig]
            The matching LayerConfig object, or None if not found.
        """
        target_id = getattr(identifier, "id", identifier)
        target_name = getattr(identifier, "name", identifier)
        
        for l in self.layers:
            if name is not None:
                # Group and Name lookup
                if l.get("layer_group") == identifier and l.get("name") == name:
                    return l
            else:
                # Name or ID lookup
                if l.get("id") == target_id or l.get("name") == target_name:
                    return l
        return None

    def update_layer(self, identifier: Union[str, Any], name: Optional[str] = None, **kwargs) -> "Map":
        """
        Updates attributes of an existing layer (e.g. `visible`, `color`, `weight`) and triggers a sync.

        Parameters
        ----------
        identifier : Union[str, Any]
            Layer ID, layer name, or layer_group folder string.
        name : str, optional
            If specified, matches layer by `(layer_group, name)`.
        **kwargs
            Key-value attribute pairs to update on the target layer (e.g. `visible=False`, `color="blue"`).

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        target_id = getattr(identifier, "id", identifier)
        target_name = getattr(identifier, "name", identifier)
        
        updated_layers = []
        changed = []

        for l in self.layers:
            # Check if this is the target layer
            match = False
            if name is not None:
                if l.get("layer_group") == identifier and l.get("name") == name:
                    match = True
            else:
                if l.get("id") == target_id or l.get("name") == target_name:
                    match = True

            if match:
                # Create a brand-new LayerConfig instance with updated values
                new_dict = {**l.to_dict(), **kwargs}
                new_layer = LayerConfig(**new_dict)
                updated_layers.append(new_layer)
                changed.append(new_layer)
            else:
                updated_layers.append(l)

        if changed:
            with self.batch():
                self._layers_update_many(updated_layers, changed)
        return self

    def set_layers_visibility(self, visibility_map: Dict[Any, bool]) -> "Map":
        """
        Sets visibility states for multiple layers at once in a single atomic transaction.

        Parameters
        ----------
        visibility_map : Dict[Any, bool]
            Dictionary mapping layer names/IDs to boolean visibility states `{"Layer 1": True, "Layer 2": False}`.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        if not visibility_map:
            return self
            
        lookup = {}
        for identifier, visible in visibility_map.items():
            target_id = getattr(identifier, "id", identifier)
            target_name = getattr(identifier, "name", identifier)
            lookup[target_id] = visible
            lookup[target_name] = visible

        updated_layers = []
        changed = []

        for l in self.layers:
            lid = l.get("id")
            lname = l.get("name")

            target_visible = None
            if lid in lookup:
                target_visible = lookup[lid]
            elif lname in lookup:
                target_visible = lookup[lname]

            if target_visible is not None and l.get("visible") != target_visible:
                new_dict = {**l.to_dict(), "visible": target_visible}
                new_layer = LayerConfig(**new_dict)
                updated_layers.append(new_layer)
                changed.append(new_layer)
            else:
                updated_layers.append(l)

        if changed:
            with self.batch():
                self._layers_update_many(updated_layers, changed)
        return self

    def set_layer_visibility(self, identifier: Union[str, Any], visible: bool, name: Optional[str] = None) -> "Map":
        """
        Sets the visibility of a layer and synchronizes the change to the client widget.

        Parameters
        ----------
        identifier : Union[str, Any]
            Layer ID or name.
        visible : bool
            Target visibility state.
        name : str, optional
            Optional layer name if matching by group.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        return self.update_layer(identifier, name=name, visible=visible)

    def sync(self) -> "Map":
        """
        Manually triggers a map state synchronization and forces a WebGL re-render on the frontend.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        self.sync_trigger += 1
        return self

    @contextlib.contextmanager
    def batch(self):
        """
        Context manager batching multiple map mutations into a single sync message.

        Reentrant: every public mutator opens one internally, so nesting is expected and
        only the outermost block flushes.

        Examples
        --------
        >>> m = Map()
        >>> with m.batch():
        ...     m.add_markers(df1, name="Points")
        ...     m.add_line(df2, name="Tracks")
        ...     m.configure_group("Tracks", multi_select=False)
        """
        self._batch_depth += 1
        try:
            with self.hold_trait_notifications():
                yield self
        finally:
            self._batch_depth -= 1
            if self._batch_depth == 0:
                self._flush_ops()
