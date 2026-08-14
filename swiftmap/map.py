# Swiftmap Custom AnyWidget Map Controller
import anywidget
import traitlets
import contextlib
from typing import Optional, List, Dict, Any, Union
from ._infra import LayerConfig, _load_esm, _widget_css_path
import numpy as np
from .layers._targeting import find_layers, apply_to_layers
from .layers._time import normalize_layer_times, is_valid_period

# Mirrors POSITIONS in src/timecontrol.js; the two sets must not drift.
TIME_POSITIONS = frozenset({
    "top-left", "top-center", "top-right", "left-center", "right-center",
    "bottom-left", "bottom-center", "bottom-right",
})
from ._warnings import warn
from .layers._style import (STYLE_KEYS, POINTS, LINES, AREAS, pop_style_options,
                            warn_on_undrawn_options, normalize as normalize_style)

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

def _describe_target(target, criteria):
    """Echoes back what was asked for, so an empty match says which part missed."""
    parts = [repr(target)] if target is not None else []
    parts += [f"{k}={v!r}" for k, v in sorted(criteria.items()) if v is not None]
    return ", ".join(parts) or "no criteria"


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
    fit_bounds_request = traitlets.Dict({}).tag(sync=True)
    # Shared time-slider settings and its current position (epoch ms). One slider serves
    # every time layer, so its configuration is map state rather than layer state.
    time_config = traitlets.Dict({}).tag(sync=True)
    time_current = traitlets.Float(0).tag(sync=True)
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
        # A layer may own auxiliary buffers under "<id>::<kind>" -- per-feature times ride
        # that way -- so removing a layer removes everything keyed under its id.
        removed = [key for key in buffers
                   for lid in layer_ids
                   if key == lid or (lid is not None and key.startswith(f"{lid}::"))]
        if not removed:
            return
        for key in removed:
            del buffers[key]
        self._set_trait_quietly("coordinate_buffers", buffers)
        for key in removed:
            self._emit({"op": "buffer_remove", "id": key})

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

    def bounds_of(self, target: Any = None, **criteria) -> Optional[List[List[float]]]:
        """
        Returns the bounding box enclosing every matching layer, or None if none match.

        Each layer records its own bounds when it is built, so fitting the view to a
        selection needs nothing from the caller -- no coordinates to pass back in, and no
        second copy of the data to keep in step with the map.

        Parameters
        ----------
        target : str or layer or list, optional
            Matches an id or a name, as in `hide`.
        **criteria
            Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

        Returns
        -------
        list or None
            `[[min_lat, min_lon], [max_lat, max_lon]]`, or None if nothing matched or no
            match carried bounds.

        Examples
        --------
        >>> m.fit_bounds(m.bounds_of(["Dwell 3", "Dwell 7"]), zoom_offset=-1)
        """
        boxes = [l.get("bounds") for l in self.find_layers(target, **criteria)
                 if l.get("bounds")]
        if not boxes:
            return None
        return [
            [min(b[0][0] for b in boxes), min(b[0][1] for b in boxes)],
            [max(b[1][0] for b in boxes), max(b[1][1] for b in boxes)],
        ]

    def fit_bounds(self, bounds: Optional[List[List[float]]], zoom_offset: int = 0,
                   max_zoom: Optional[int] = None, padding: Optional[int] = None) -> "Map":
        """
        Moves the map viewport to enclose `bounds`.

        Parameters
        ----------
        bounds : list or None
            `[[min_lat, min_lon], [max_lat, max_lon]]`. `None` is accepted and does
            nothing, so `m.fit_bounds(m.bounds_of(sel))` is safe when the selection is
            empty -- the caller does not have to guard it.
        zoom_offset : int, default 0
            Zoom levels to apply after fitting. -1 pulls back one level, so a selection
            is shown with its surroundings rather than filling the frame.
        max_zoom : int, optional
            Ceiling on the zoom the fit may choose. Without it, fitting a single point
            zooms to maximum.
        padding : int, optional
            Pixels of margin to leave on every side.

        Returns
        -------
        Map
            Self reference for method chaining.

        Notes
        -----
        Unlike visibility and styling, this is a command rather than declared state.
        Fitting the same bounds twice moves the map twice, since the user may have panned
        away in between, so repeat calls are deliberately not suppressed.

        Examples
        --------
        >>> m.fit_bounds([[36.0, -5.4], [36.2, -5.2]])
        >>> m.fit_bounds(m.bounds_of("Dwell 3"), zoom_offset=-1, max_zoom=16)
        """
        if not bounds:
            return self
        self._fit_sequence = getattr(self, "_fit_sequence", 0) + 1
        self.fit_bounds_request = {
            "bounds": bounds,
            "zoom_offset": zoom_offset,
            "max_zoom": max_zoom,
            "padding": padding,
            "seq": self._fit_sequence,
        }
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

    def find_layers(self, target: Any = None, **criteria) -> List[Any]:
        """
        Returns every layer matching the given criteria, looking inside groups.

        The same targeting vocabulary every layer method accepts, exposed directly for
        cases it cannot express -- combining several queries, or reading `bounds` off the
        results. For plain "act on these layers", pass the criteria to `hide` or `show`
        instead of filtering here first.

        Parameters
        ----------
        target : str or layer or list, optional
            Matches an id or a name, the same pair `get_layer` accepts.
        ids, name, types, exclude_types, group : optional
            Narrowing criteria; see `hide`. All given conditions must match.
        include_groups : bool, default False
            Include the group layers themselves, not only the geometry inside them.

        Returns
        -------
        list
            The matching layers, in map order. Empty if nothing matched.

        Examples
        --------
        >>> m.find_layers("Survey")                       # every part of a collection
        >>> m.find_layers("Survey", types="polyline")     # just its line
        >>> m.find_layers(group="Feeds")                  # everything under a folder
        """
        return find_layers(self.layers, target, **criteria)

    def _set_layer_fields(self, layers: List[Any], fields: Dict[str, Any]) -> "Map":
        """
        Applies `fields` to the given layers, emitting nothing if none actually change.

        Sends one `set` op per layer rather than replacing them. A replace carries the whole
        layer, so hiding a 50k-point layer resent every property it holds -- roughly half a
        megabyte to change one boolean, on every click of a checkbox wired to a reactive.
        """
        if not layers:
            return self
        targets = [l for l in layers if l.get("id") is not None
                   and any(l.get(k) != v for k, v in fields.items())]
        if not targets:
            return self

        changes = {l.get("id"): fields for l in targets}
        new_layers, _ = apply_to_layers(self.layers, changes, lambda d: LayerConfig(**d))
        self._set_trait_quietly("layers", new_layers)
        with self.batch():
            for layer in targets:
                self._emit({"op": "set", "id": layer.get("id"), "fields": dict(fields)})
        return self

    def select(self, target: Any = None, *, scope: Optional[str] = None, zoom: bool = False,
               zoom_offset: int = 0, max_zoom: Optional[int] = None,
               padding: Optional[int] = None, **criteria) -> "Map":
        """
        Shows only the matching layers, hiding the rest of their scope.

        Declarative and total: each call describes the complete selection, so switching
        selections needs no undoing of the last one and `select(None)` restores everything
        in scope. Nothing about the previous selection is remembered, which is what keeps
        repeated calls from drifting.

        Parameters
        ----------
        target : str or layer or list, optional
            What to select -- ids or names, as in `hide`. `None` or an empty list clears
            the selection and shows everything in scope.
        scope : str, optional
            The folder this selection owns. Only layers under it are hidden or restored,
            so selecting a dwell leaves an unrelated layer the user hid alone. Inferred
            from the matched layers' own groups when omitted; when clearing, an omitted
            scope means every non-basemap layer, which is rarely what you want.
        zoom : bool, default False
            Fit the viewport to the selection. Off by default: a hover should be able to
            highlight without yanking the map, and the bounds come from the layers
            themselves so nothing needs passing in.
        zoom_offset, max_zoom, padding
            Forwarded to `fit_bounds`. `zoom_offset=-1` pulls back a level so the
            selection is shown in context.
        **criteria
            Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

        Returns
        -------
        Map
            Self reference for method chaining.

        Notes
        -----
        Clearing restores everything in scope to visible rather than to whatever the user
        had set by hand. That is deliberate: with table selections and sidebar toggles
        both in play, a clean slate is easier to reason about than a restore that has to
        guess which of two intents wins.

        Examples
        --------
        >>> rows = table.cell_selection().get("rows", [])
        >>> m.select([dwell_ids[i] for i in rows], scope="Dwells",
        ...          zoom=True, zoom_offset=-1)
        >>> m.select(None, scope="Dwells")          # clean slate
        """
        chosen = self.find_layers(target, **criteria) if target else []
        chosen_ids = {l.get("id") for l in chosen}

        if scope is not None:
            pool = self.find_layers(group=scope)
        elif chosen:
            groups = {l.get("layer_group") for l in chosen}
            pool = [l for l in self.find_layers() if l.get("layer_group") in groups]
        else:
            pool = [l for l in self.find_layers() if l.get("type") != "basemap"]

        with self.batch():
            if chosen_ids:
                self._set_layer_fields([l for l in pool if l.get("id") in chosen_ids],
                                       {"visible": True})
                self._set_layer_fields([l for l in pool if l.get("id") not in chosen_ids],
                                       {"visible": False})
            else:
                self._set_layer_fields(pool, {"visible": True})

            if zoom and chosen:
                self.fit_bounds(self.bounds_of(chosen), zoom_offset=zoom_offset,
                                max_zoom=max_zoom, padding=padding)
        return self

    def make_time_layer(self, target: Any = None, *, time_field: Optional[str] = None,
                        time_end_field: Optional[str] = None, period: Optional[str] = None,
                        duration: Optional[str] = "period", fade: bool = False,
                        **criteria) -> "Map":
        """
        Animates the matching layers along the time their features already carry.

        Timestamps are read from the layer's own properties -- a DataFrame's timestamp
        column, or the datetime_start/datetime_end the geostructures parser records --
        so nothing is re-parsed and nothing extra is passed in. One slider serves every
        time layer on the map; making a second time layer joins it to the same slider
        rather than adding another control.

        The slider steps through generated periods rather than through the observed
        timestamps, so a period in which nothing happened still gets its tick: an empty
        map at 03:00 is a finding, not a gap in the slider.

        Parameters
        ----------
        target : str or layer or list, optional
            Which layers, as in `hide`. Chaining works since every method returns the map:
            `m.add_circle_markers(df, name="V").make_time_layer("V")`.
        time_field : str, optional
            Property holding each feature's time -- a single stamp or a [start, end] pair.
            When omitted, the known names are probed: "times", "datetime_start"(/"_end"),
            "timestamp", "datetime", "time", "date".
        time_end_field : str, optional
            Property holding the interval end, for data with separate start/end columns.
        period : str, optional
            Slider step as an ISO8601 duration ('P1D', 'PT1H', 'PT15M'). Shared by the one
            slider, so setting it here reconfigures the map's time axis. Default 'P1D'.
        duration : str or None, default "period"
            How long a feature stays visible after its time. "period" shows each tick's
            own period -- absence reads as absence. None accumulates history instead, and
            an ISO8601 duration gives a fixed trailing window ('PT6H').
        fade : bool, default False
            Dim point features with age: newest at full opacity, reaching zero at the
            window's trailing edge. Applies to point layers rendered on the GPU time
            path (the normal case); with a cumulative duration the fade spans decades
            and is imperceptible, and features without readable times never fade.
        **criteria
            Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

        Returns
        -------
        Map
            Self reference for method chaining.

        Warns
        -----
        SwiftMapWarning
            If nothing matched, a matched layer has no readable time property, some
            features carry no parseable time (those stay permanently visible), or the
            period/duration strings are not ISO8601 durations.

        Examples
        --------
        >>> m.add_circle_markers(df, name="Vessel")     # df has a timestamp column
        >>> m.make_time_layer("Vessel", period="PT1H")

        >>> m.make_time_layer(group="Tracks", period="PT15M", duration="PT1H")
        """
        matched = self.find_layers(target, **criteria)
        if not matched:
            warn(f"make_time_layer matched no layers ({_describe_target(target, criteria)}). "
                 f"Nothing was animated.")
            return self

        if duration not in (None, "period") and not is_valid_period(duration):
            warn(f"make_time_layer: duration {duration!r} is not an ISO8601 duration "
                 f"(like 'PT1H'). Falling back to 'period'.")
            duration = "period"

        with self.batch():
            for layer in matched:
                interleaved, field, timeless = normalize_layer_times(
                    layer.get("properties"), time_field, time_end_field)
                if interleaved is None:
                    warn(f"make_time_layer: layer {layer.get('name')!r} has no time "
                         f"property. Pass time_field= naming one; its features stay "
                         f"visible at every tick until then.")
                    continue
                if timeless:
                    total = len(interleaved) // 2
                    warn(f"make_time_layer: {timeless} of {total} feature(s) in "
                         f"{layer.get('name')!r} carry no parseable time and will stay "
                         f"visible at every tick.")

                payload = np.asarray(interleaved, dtype=np.float64).tobytes()
                key = f"{layer.get('id')}::times"
                if self.coordinate_buffers.get(key) != payload:
                    self._set_layer_buffer(key, payload)
                time_meta = {"field": field, "duration": duration}
                if fade:
                    time_meta["fade"] = True
                self._set_layer_fields([layer], {"time": time_meta})
            if period is not None:
                self.configure_time(period=period)
        return self

    def clear_time_layer(self, target: Any = None, **criteria) -> "Map":
        """
        Stops animating the matching layers; with no target, every time layer on the map.

        The slider disappears once nothing is animated. Features return to being always
        visible; the layer itself is untouched.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        if target is None and not criteria:
            matched = [l for l in self.find_layers() if l.get("time")]
        else:
            matched = [l for l in self.find_layers(target, **criteria) if l.get("time")]
        if not matched:
            return self
        with self.batch():
            self._set_layer_fields(matched, {"time": None})
            self._remove_layer_buffers([l.get("id") for l in matched
                                        if f"{l.get('id')}::times" in self.coordinate_buffers])
        return self

    def configure_time(self, **options) -> "Map":
        """
        Configures the shared time slider.

        Options
        -------
        period : str
            Slider step, ISO8601 ('P1D', 'PT1H'). Default 'P1D'.
        auto_play : bool
            Start playing as soon as the slider appears. Default False.
        loop : bool
            Start over when playback reaches the end. Default False.
        speed : float
            Playback rate in ticks per second. Default 1.
        window : str or None
            Shared trailing window as an ISO8601 duration ('PT2H30M'). While set it
            overrides every layer's own `duration` -- it is the same override dragging
            the bar's trail handle creates, so Python and the bar never disagree.
            Pass None to clear it and hand control back to per-layer durations.
            Fixed-width durations (hours, days) draw exactly on the bar; calendar
            durations (months) filter correctly but cannot be depicted as a span.
        position : str
            Where the control sits on the map: 'top-left', 'top-center', 'top-right',
            'left-center', 'right-center', 'bottom-left', 'bottom-center' or
            'bottom-right'. Default 'top-center'. The sidebar lives at top-right, so
            that corner works but crowds it.

        Returns
        -------
        Map
            Self reference for method chaining.
        """
        if "position" in options and options["position"] not in TIME_POSITIONS:
            warn(f"configure_time: position {options['position']!r} is not one of "
                 f"{sorted(TIME_POSITIONS)}. Keeping the previous position.")
            options.pop("position")
        if "window" in options:
            window = options.pop("window")
            if window is None:
                # Clearing is removing the key, not storing None: the frontend treats a
                # present window as an override, and per-layer durations return only
                # when it is gone.
                if "window" in self.time_config:
                    self.time_config = {k: v for k, v in self.time_config.items()
                                        if k != "window"}
            elif not is_valid_period(window):
                warn(f"configure_time: window {window!r} is not an ISO8601 duration "
                     f"(like 'PT2H30M'). Keeping the previous window.")
            else:
                options["window"] = window
        if "period" in options and not is_valid_period(options["period"]):
            warn(f"configure_time: period {options['period']!r} is not an ISO8601 "
                 f"duration (like 'P1D' or 'PT1H'). Keeping the previous period.")
            options.pop("period")
        if options:
            self.time_config = {**self.time_config, **options}
        return self

    def highlight(self, target: Any = None, *, markers: Optional[Dict[str, Any]] = None,
                  lines: Optional[Dict[str, Any]] = None,
                  polygons: Optional[Dict[str, Any]] = None, **options) -> "Map":
        """
        Restyles whole layers to mark them as selected, leaving their own styling intact.

        The highlight sits in a field of its own above the layer's style and any
        data-driven per-feature styling, so clearing it restores what was underneath with
        nothing remembered and nothing to put back. Like `select`, each call states the
        whole highlight: highlighting something else drops the previous one, and
        `highlight(None)` clears every highlight on the map.

        Parameters
        ----------
        target : str or layer or list, optional
            What to highlight -- ids or names, as in `hide`. `None` clears.
        markers, lines, polygons : dict, optional
            Style overrides for one geometry family, applied over the shared options
            below. A mixed selection usually wants different treatment per shape --
            an accent colour on the points and a translucent wash on the areas -- and a
            single flat colour cannot say that.
        **options
            Shared style options applied to every matched layer -- `color`, `weight`,
            `radius`, and the rest of the vocabulary `add_*` accepts. Targeting criteria
            (`types`, `exclude_types`, `group`) are accepted here too.

        Returns
        -------
        Map
            Self reference for method chaining.

        Warns
        -----
        SwiftMapWarning
            If nothing matched, or an option cannot be drawn for a matched layer's
            geometry -- `weight` on points, say. The option is kept rather than dropped,
            so it starts working if the renderer later learns to draw it.

        Examples
        --------
        >>> m.highlight("Survey", color="#ffcc00", weight=6)
        >>> m.highlight("Survey", color="#ffcc00",
        ...             markers={"radius": 14}, polygons={"fill_opacity": 0.5})
        >>> m.highlight("Survey", color="#ffcc00", exclude_types="polyline")
        >>> m.highlight(None)                       # clear every highlight
        """
        criteria = {k: options.pop(k) for k in
                    ("ids", "name", "types", "exclude_types", "group", "include_groups")
                    if k in options}

        if not target:
            lit = [l for l in self.find_layers() if l.get("highlight_style")]
            return self._set_layer_fields(lit, {"highlight_style": {}}) if lit else self

        matched = self.find_layers(target, **criteria)
        if not matched:
            warn(f"highlight matched no layers ({_describe_target(target, criteria)}). "
                 f"Nothing was highlighted.")
            return self

        shared, _ = pop_style_options(dict(options), "highlight")
        per_family = {"markers": markers or {}, "lines": lines or {}, "polygons": polygons or {}}
        families = {"markers": POINTS, "lines": LINES, "polygons": AREAS}

        with self.batch():
            for layer in matched:
                ltype = layer.get("type")
                merged = dict(shared)
                for family, style in per_family.items():
                    if style and ltype in families[family]:
                        merged.update(normalize_style(style))
                if not merged:
                    continue
                warn_on_undrawn_options(merged, "highlight", ltype)
                frontend = {STYLE_KEYS[k]: v for k, v in merged.items() if k in STYLE_KEYS}
                self._set_layer_fields([layer], {"highlight_style": frontend})

            # Anything previously lit and not in this selection goes dark, so the caller
            # never tracks what the last highlight touched.
            keep = {l.get("id") for l in matched}
            stale = [l for l in self.find_layers()
                     if l.get("highlight_style") and l.get("id") not in keep]
            if stale:
                self._set_layer_fields(stale, {"highlight_style": {}})
        return self

    def set_feature_styles(self, target: Any = None, overrides: Optional[Dict[int, Any]] = None,
                           **criteria) -> "Map":
        """
        Overrides the style of individual features within the matching layers.

        Intended for transient styling -- a highlighted row, a hovered feature -- which is
        why the overrides replace whatever was set before rather than merging with it.
        Passing `{}` clears them, so a caller describes the state it wants and never has to
        remember what the previous call touched.

        Overrides sit in their own field, above both the layer's style and any per-feature
        styling from the data, so clearing one restores the underlying style with nothing
        to put back.

        Parameters
        ----------
        target : str or layer or list, optional
            Matches an id or a name, as in `hide`.
        overrides : dict, optional
            Feature index -> style dict, e.g. `{3: {"color": "#ffcc00", "radius": 14}}`.
            `None` or `{}` clears the layer's overrides.
        **criteria
            Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

        Returns
        -------
        Map
            Self reference for method chaining.

        Warns
        -----
        SwiftMapWarning
            If nothing matched.

        Examples
        --------
        >>> m.set_feature_styles("Sites", {12: {"color": "#ffcc00", "radius": 14}})
        >>> m.set_feature_styles("Sites", {})        # clear
        """
        matched = self.find_layers(target, **criteria)
        if not matched:
            warn(f"set_feature_styles matched no layers "
                 f"({_describe_target(target, criteria)}). Nothing was styled.")
            return self

        wanted = {str(k): v for k, v in (overrides or {}).items()}
        targets = [l for l in matched
                   if l.get("id") is not None and (l.get("style_overrides") or {}) != wanted]
        if not targets:
            return self

        changes = {l.get("id"): {"style_overrides": wanted} for l in targets}
        new_layers, _ = apply_to_layers(self.layers, changes, lambda d: LayerConfig(**d))
        self._set_trait_quietly("layers", new_layers)
        with self.batch():
            for layer in targets:
                self._emit({"op": "style", "id": layer.get("id"), "overrides": wanted})
        return self

    def hide(self, target: Any = None, **criteria) -> "Map":
        """
        Hides every layer matching the criteria, including layers inside a collection.

        Parameters
        ----------
        target : str or layer or list, optional
            Matches an id or a name.
        ids : str or list, optional
            Match by id only, when a name would be ambiguous.
        name : str, optional
            Match by name only.
        types : str or list, optional
            Keep only these layer types -- 'circle_markers', 'markers', 'polyline',
            'polygon', 'circle'. Within a collection this is the only thing telling the
            parts apart, since they share a name by design.
        exclude_types : str or list, optional
            The inverse: match everything except these types.
        group : str, optional
            Match by folder path. Matches nested folders too, so "Feeds" includes
            "Feeds/Active".

        Returns
        -------
        Map
            Self reference for method chaining.

        Warns
        -----
        SwiftMapWarning
            If nothing matched. A call that quietly does nothing is the failure this is
            most likely to hide, since a mistyped name looks identical to a hidden layer.

        Examples
        --------
        >>> m.hide("Survey", types="polyline")    # drop the line from a collection
        >>> m.hide(group="Feeds/Inactive")
        >>> m.hide(ids=[l.id for l in stale])
        """
        matched = self.find_layers(target, **criteria)
        if not matched:
            warn(f"hide matched no layers ({_describe_target(target, criteria)}). "
                 f"Nothing was hidden.")
            return self
        return self._set_layer_fields(matched, {"visible": False})

    def show(self, target: Any = None, **criteria) -> "Map":
        """
        Shows every layer matching the criteria. The inverse of `hide`; same arguments.

        Returns
        -------
        Map
            Self reference for method chaining.

        Warns
        -----
        SwiftMapWarning
            If nothing matched.

        Examples
        --------
        >>> m.show("Survey")            # every part of a collection, line included
        >>> m.show(group="Feeds")
        """
        matched = self.find_layers(target, **criteria)
        if not matched:
            warn(f"show matched no layers ({_describe_target(target, criteria)}). "
                 f"Nothing was shown.")
            return self
        return self._set_layer_fields(matched, {"visible": True})

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
