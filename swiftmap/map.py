# Swiftmap Custom AnyWidget Map Controller
#
# This file is the widget's identity: the synced traits, the constructor, and
# the lifecycle verbs (sync/batch/resync). Every other method family lives in
# its own module -- layer builders under layers/, everything else under
# mapops/ -- as plain functions taking `self`, bound in the class body below.
import anywidget
import traitlets
import contextlib
from typing import Optional, List, Dict, Any
from ._infra import LayerConfig, _load_esm, _widget_css_path

# Import layer methods
from . import basemap_registry as _basemap_registry
from .layers.basemap import add_basemap, list_basemaps
from .layers.circle_markers import add_circle_markers
from .layers.markers import add_markers
from .layers.polyline import add_line, add_polyline
from .layers.polygon import add_polygon, add_polygons, add_shape, add_shapes
from .layers.collection import add_collection, add_geojson, add_geostructures
from .layers.circle import add_circle
from .layers.imagery import add_imagery
from .export import to_html, save

# Import method families (see mapops/__init__.py)
from .mapops.transport import (
    _layer_to_dict, _handle_client_msg, _set_trait_quietly, _emit, _flush_ops,
    _merge_lookup, _layers_append, _layers_replace, _layers_set,
    _layers_update_many, _set_layer_buffer, _append_layer_buffer, _remove_layer_buffers)
from .mapops.marginalia import (
    _DRAW_TOOLS, _DRAW_POSITIONS, _SCALE_UNITS, _SCALE_POSITIONS, _LOGO_POSITIONS,
    configure_draw, clear_drawings, configure_scale, configure_logo)
from .mapops.legend import (
    _LEGEND_POSITIONS, configure_legend, legend_add, legend_remove,
    legend_clear, legend_html)
from .mapops.bounds import (
    bounds_of, fit_bounds, _request_fit, _disarm_auto_fit, _auto_fit_extend)
from .mapops.access import (
    get_layer, find_layers, add_layer, configure_group, remove_layers,
    remove_layer, update_layer)
from .mapops.effects import (
    _set_layer_fields, select, highlight, set_feature_styles, hide, show,
    set_layers_visibility, set_layer_visibility)
from .mapops.time import (
    TIME_POSITIONS, make_time_layer, clear_time_layer, configure_time)


def _layers_from_json(value, widget):
    if not value:
        return []
    return [LayerConfig(**item) if isinstance(item, dict) else item for item in value]


class Map(anywidget.AnyWidget):
    """
    High-performance Leaflet map controller with WebGL rendering pipelines for Shiny for Python.

    Extends `anywidget.AnyWidget` to seamlessly sync map viewports, layers, selection events,
    and hierarchical sidebar tree controls reactively between Python and JavaScript.

    Parameters
    ----------
    center : List[float], optional
        Initial map center coordinates `[latitude, longitude]`. Left unset, the map
        fits itself to the data: every added layer extends a running bounds union and
        the viewport follows, until you set a view (center/zoom, `fit_bounds`, or a
        pan in the browser). With no data it opens on [36.0, -5.35].
    zoom : int, optional
        Initial map zoom level (0 to 22). Setting it disables the auto-fit above;
        unset with no data it is 10.
    show_legend : bool, default False
        If True, a legend overlay renders on the map, derived from the layers (glyphs
        per geometry, ramps/categories/bins from `color_col`) with `legend_add` /
        `legend_remove` overrides on top. See `configure_legend` for position, scope
        and title.
    show_logo : bool, default False
        If True, shows the logo card -- your branding, set with `configure_logo`
        (two slots, each a URL, data URI or local file). Nothing is shipped by
        default; with the card on and no slots set, a generic swiftmap mark
        stands in.
    show_click_coordinates : bool, default False
        If True, clicking open map (not a feature) opens a small popup with the
        clicked coordinates. Either way the click reaches Python: `clicked_latlng`
        holds [lat, lon], `clicked_layer_id` clears to "", and `click_seq` bumps.
    show_scale : bool, default False
        If True, draws a scale bar (bottom-left by default). `configure_scale`
        chooses units -- 'metric', 'imperial', 'both', or 'nautical' -- position
        and width.
    height : str, optional
        CSS height for the map ('600px', '40vh'). Sizes both the widget element and
        the map container, and an explicit value overrides the default 400px minimum.
        Left unset, the map fills its parent -- what a Shiny layout wants. Assign
        `m.height` later to resize a live map.
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

    # Layer builders (layers/) and export
    add_basemap = add_basemap
    list_basemaps = list_basemaps
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
    add_imagery = add_imagery
    to_html = to_html
    save = save

    # Patch transport and the layers-list invariants (mapops/transport.py)
    _handle_client_msg = _handle_client_msg
    _set_trait_quietly = _set_trait_quietly
    _emit = _emit
    _flush_ops = _flush_ops
    _merge_lookup = _merge_lookup
    _layers_append = _layers_append
    _layers_replace = _layers_replace
    _layers_set = _layers_set
    _layers_update_many = _layers_update_many
    _set_layer_buffer = _set_layer_buffer
    _append_layer_buffer = _append_layer_buffer
    _remove_layer_buffers = _remove_layer_buffers

    # Marginalia (mapops/marginalia.py)
    _DRAW_TOOLS = _DRAW_TOOLS
    _DRAW_POSITIONS = _DRAW_POSITIONS
    _SCALE_UNITS = _SCALE_UNITS
    _SCALE_POSITIONS = _SCALE_POSITIONS
    configure_draw = configure_draw
    clear_drawings = clear_drawings
    configure_scale = configure_scale
    _LOGO_POSITIONS = _LOGO_POSITIONS
    configure_logo = configure_logo

    # Legend (mapops/legend.py)
    _LEGEND_POSITIONS = _LEGEND_POSITIONS
    configure_legend = configure_legend
    legend_add = legend_add
    legend_remove = legend_remove
    legend_clear = legend_clear
    legend_html = property(legend_html)

    # Bounds and auto-fit (mapops/bounds.py)
    bounds_of = bounds_of
    fit_bounds = fit_bounds
    _request_fit = _request_fit
    _disarm_auto_fit = _disarm_auto_fit
    _auto_fit_extend = _auto_fit_extend

    # Layer access (mapops/access.py)
    get_layer = get_layer
    find_layers = find_layers
    add_layer = add_layer
    configure_group = configure_group
    remove_layers = remove_layers
    remove_layer = remove_layer
    update_layer = update_layer

    # Layer effects (mapops/effects.py)
    _set_layer_fields = _set_layer_fields
    select = select
    highlight = highlight
    set_feature_styles = set_feature_styles
    hide = hide
    show = show
    set_layers_visibility = set_layers_visibility
    set_layer_visibility = set_layer_visibility

    # Time (mapops/time.py)
    make_time_layer = make_time_layer
    clear_time_layer = clear_time_layer
    configure_time = configure_time

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
    # The logo card's content and placement: {"company": {url, alt},
    # "parent_company": {url, alt}, "position", "height"} -- see configure_logo.
    # Empty means no branding; the frontend shows a generic mark only while the
    # card is on with neither slot set.
    logo_config = traitlets.Dict({}).tag(sync=True)
    # Undeclared, this was a plain Python attribute: __init__ assigned it happily,
    # export read it happily, and the frontend's model.get("show_legend") was
    # undefined forever -- the legend could never switch on under a real widget.
    # The fixtures' model stub hid it, because a stub accepts any key.
    show_legend = traitlets.Bool(False).tag(sync=True)
    group_configs = traitlets.Dict(default_value={}).tag(sync=True)

    # Selection and click interaction tracking
    selected_index = traitlets.Int(-1).tag(sync=True)
    clicked_layer_id = traitlets.Unicode("").tag(sync=True)
    # Bumped by the frontend on EVERY click -- features and open map alike. Observe
    # this one trait for clicks: id and index stay put when the same feature is
    # clicked twice, so observers watching only them miss repeat clicks entirely.
    click_seq = traitlets.Int(0).tag(sync=True)
    # Where the last click landed, [lat, lon], feature or open map -- the frontend
    # reads Leaflet's own unprojection, so it is correct under EPSG:4326 too. On an
    # empty click, clicked_layer_id clears to "" and selected_index to -1: one
    # click_seq observer reads "where" here and "on what" there.
    clicked_latlng = traitlets.List([]).tag(sync=True)
    # When True, an empty-map click also opens a small popup showing the coordinates.
    show_click_coordinates = traitlets.Bool(False).tag(sync=True)
    # The scale bar and its options (units/position/max_width); see configure_scale.
    show_scale = traitlets.Bool(False).tag(sync=True)
    scale_config = traitlets.Dict({}).tag(sync=True)
    # Draw/AOI tools (Leaflet-Geoman) and everything drawn with them. `drawings` is
    # a list of GeoJSON features that syncs BOTH ways -- the frontend writes every
    # create/edit/delete, and Python may seed or clear it -- with `draw_seq` bumping
    # per change so one observer catches them all. Circles carry
    # properties.kind="circle" and properties.radius (metres) since GeoJSON has no
    # circle geometry.
    show_draw = traitlets.Bool(False).tag(sync=True)
    draw_config = traitlets.Dict({}).tag(sync=True)
    drawings = traitlets.List([]).tag(sync=True)
    draw_seq = traitlets.Int(0).tag(sync=True)
    # Explicit widget height ('600px', '40vh'); empty means fill the parent with the
    # stylesheet's 400px floor. Applied by the frontend, which also drops the floor
    # for an explicit value.
    height = traitlets.Unicode("").tag(sync=True)
    fit_bounds_request = traitlets.Dict({}).tag(sync=True)
    # Declarative legend state: display options plus the manual overrides
    # (adds and persistent remove-matchers). Derivation and rendering live in
    # src/legend.js; Python only writes this.
    legend_config = traitlets.Dict({}).tag(sync=True)
    # Shared time-slider settings and its current position (epoch ms). One slider serves
    # every time layer, so its configuration is map state rather than layer state.
    time_config = traitlets.Dict({}).tag(sync=True)
    time_current = traitlets.Float(0).tag(sync=True)
    js_console_logs = traitlets.List([]).tag(sync=True)
    auto_sync = traitlets.Bool(True).tag(sync=True)
    sync_trigger = traitlets.Int(0).tag(sync=True)

    def __init__(
        self,
        center: Optional[List[float]] = None,
        zoom: Optional[int] = None,
        show_legend: bool = False,
        show_logo: bool = False,
        show_click_coordinates: bool = False,
        show_scale: bool = False,
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

        # Auto-fit: with no explicit view, the map follows the data -- every add
        # extends a min/max union of the layer bounds already computed at add time and
        # refreshes the fit request. It disarms the moment anyone sets a view: center
        # or zoom here, a fit_bounds() call, or a pan echoed back from the browser --
        # so a map builds to the union of its layers, fits once on display, and is
        # then left alone.
        self._auto_fit_armed = center is None and zoom is None
        self._auto_fit_bounds = None

        self.center = center if center is not None else [36.0, -5.35]
        self.zoom = zoom if zoom is not None else 10
        self.crs = crs
        self.show_legend = show_legend
        self.show_logo = show_logo
        self.show_click_coordinates = show_click_coordinates
        self.show_scale = show_scale
        self.auto_sync = auto_sync
        if height:
            self.height = height
            # The outer ipywidgets element must size too, or a notebook cell
            # collapses around the absolutely-sized container inside it.
            self.layout.height = height
        self.observe(self._disarm_auto_fit, names=["center", "zoom"])

        # Internal layer list counter
        self._layer_counter = 0

        # Fixed branding across an office's apps seeds from the registry file,
        # exactly like the default basemaps, so no app repeats it.
        if _basemap_registry.DEFAULT_LOGO:
            self.configure_logo(**_basemap_registry.DEFAULT_LOGO)

        # Default basemaps come from the network's registry file, per CRS --
        # the other network defaults a bare Map() to its own services.
        defaults = _basemap_registry.DEFAULT_BASEMAPS
        for bm_name, bm_visible in defaults.get(self.crs, defaults.get("EPSG:3857", [])):
            self.add_basemap(bm_name, layer_group="Basemaps",
                             group_multi_select=False, visible=bm_visible)

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
