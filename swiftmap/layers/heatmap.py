import numpy as np
from typing import Any, Optional

from ..parsers import parse_points
from .._colormaps import COLORMAPS, DEFAULT_COLORMAP, _anchors_of, resolve_colormap
from ._batching import batched
from ._grouping import build_group_specs, resolve_group_path
from ._update import record_added_with
from .._warnings import warn, EmptyLayerWarning


@batched
def add_heatmap(
    self,
    data: Any,
    weight_col: Optional[str] = None,
    radius: int = 25,
    colormap: Any = None,
    max_intensity: Optional[float] = None,
    opacity: float = 1.0,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    visible: bool = True,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    coord_order: str = "auto",
    **kwargs,
) -> "Map":
    """
    Adds a density heatmap: point weights summed into screen-space blobs.

    This is the exploratory view of a point dataset -- the answer to "where is
    the structure in what I am looking at". The colour ramp is RELATIVE: it
    normalises to the hottest spot in the current view and re-normalises as the
    view settles, so zooming into a quiet region spreads its local structure
    across the full ramp. The picture recomputes with the screen and is not a
    measurement; when you need numbers -- clickable cells, a legend with values,
    a join key -- bin the data instead (`swiftmap.hexbin`) and paint the result
    with `add_polygon(df, color_col=...)`.

    Parameters
    ----------
    data : Any
        Either a point dataset (everything add_circle_markers reads), or the
        name/id of a point layer already on the map -- the "too many points"
        workflow: `m.add_heatmap("Sites")` derives heat from the layer's own
        coordinates without re-uploading them. A string that matches no layer
        is treated as data.
    weight_col : str, optional
        Column whose value each point contributes to the sum; omitted, every
        point contributes 1 (a count). For a layer source, the column comes
        from that layer's own properties.
    radius : int, default 25
        Kernel radius in screen pixels.
    colormap : optional
        Any continuous colormap `color_col` accepts -- a registered name, a
        list of colours, a callable, "matplotlib:<name>". A `{value: color}`
        mapping is categorical and is refused with a warning.
    max_intensity : float, optional
        Pins the top of the ramp to a fixed summed weight, turning the
        view-relative normalisation OFF -- the escape hatch when colours must
        be comparable across views or maps.
    opacity : float, default 1.0
        Overall layer opacity.
    name : str, optional
        Sidebar name; defaults to "Heatmap".
    layer_group : str, optional
        Sidebar folder path (e.g. "Analysis/Density").
    visible : bool, default True
        Initial visibility.
    lat_col, lon_col, coord_order :
        As in every add_* method; used only on the data path.
    """
    if not isinstance(radius, (int, float)) or isinstance(radius, bool) or radius <= 0:
        warn(f"add_heatmap: radius must be a positive number of pixels, got "
             f"{radius!r}. Using 25.")
        radius = 25

    anchors = None
    if colormap is not None:
        resolved = resolve_colormap(colormap)
        if isinstance(resolved, dict):
            warn("add_heatmap: a {value: color} mapping is categorical, and heat "
                 "is a continuous ramp. Using the default colormap.")
        elif resolved is not None:
            anchors = _anchors_of(resolved)
    if anchors is None:
        anchors = list(COLORMAPS[DEFAULT_COLORMAP])

    source_layer = self.get_layer(data) if isinstance(data, str) else None
    source_id = None
    weights = None
    bounds = None

    if source_layer is not None:
        source_type = getattr(source_layer, "type", None)
        if source_type not in ("circle_markers", "markers"):
            warn(f"add_heatmap: layer {data!r} is a {source_type} layer; heat "
                 f"derives from point layers. No layer was added.")
            return self
        source_id = source_layer.id
        raw = self.coordinate_buffers.get(source_id)
        count = len(raw) // 16 if raw else 0
        bounds = getattr(source_layer, "bounds", None)
        if weight_col is not None:
            values = (getattr(source_layer, "properties", None) or {}).get(weight_col)
            weights = _weights_or_warn(values, count, weight_col, f"layer {data!r}")
    else:
        try:
            lats, lons, props = parse_points(
                data, lat_col=lat_col, lon_col=lon_col, coord_order=coord_order)
        except TypeError as exc:
            warn(f"add_heatmap could not read the supplied data. {exc} "
                 f"No layer was added.")
            return self
        if len(lats) == 0:
            warn(f"add_heatmap found no point geometry in the supplied "
                 f"{type(data).__name__}. No layer was added.", EmptyLayerWarning)
            return self
        if weight_col is not None:
            weights = _weights_or_warn(props.get(weight_col), len(lats), weight_col,
                                       f"the supplied {type(data).__name__}")
        bounds = [[float(np.min(lats)), float(np.min(lons))],
                  [float(np.max(lats)), float(np.max(lons))]]

    layer_id = f"layer_{self._layer_counter}"
    self._layer_counter += 1

    if source_id is None:
        coords = np.column_stack((lats, lons)).astype(np.float64)
        self._set_layer_buffer(layer_id, coords.flatten().tobytes())
    if weights is not None:
        self._set_layer_buffer(f"{layer_id}::weights", weights.tobytes())

    group_specs = build_group_specs(layer_group, {})
    self.add_child({
        "id": layer_id,
        "type": "heatmap",
        "name": name or "Heatmap",
        "layer_group": resolve_group_path(group_specs, {}, 0, "Heatmap Group"),
        "group_multi_select": group_multi_select,
        "visible": visible,
        "radius": radius,
        "opacity": opacity,
        "max_intensity": max_intensity,
        "ramp": anchors,
        **({"source": source_id} if source_id else {}),
        # Data-path heat keeps its columns: that is what lets make_time_layer
        # probe a timestamp column and animate the blobs. A source-referenced
        # heat animates through its SOURCE layer's time instead.
        **({"properties": props} if source_id is None else {}),
        **({"bounds": bounds} if bounds else {}),
        # The ramp reads low -> high by design: the scale is view-relative, so
        # numbers on it would be a lie that changes with every pan.
        "legend": {"kind": "ramp", "field": weight_col or "density",
                   "anchors": list(anchors), "vmin": "low", "vmax": "high"},
        "added_with": record_added_with(
            "add_heatmap",
            parser={"lat_col": lat_col, "lon_col": lon_col,
                    "coord_order": coord_order},
            data_opts={"weight_col": weight_col}),
        **kwargs,
    })
    return self


def _weights_or_warn(values: Any, count: int, weight_col: str, origin: str):
    """A float32 weights array aligned to the points, or None with a warning."""
    if values is None:
        warn(f"add_heatmap: {origin} has no {weight_col!r} column; every point "
             f"will weigh 1.")
        return None
    try:
        arr = np.asarray(values, dtype=np.float64).astype(np.float32)
    except (TypeError, ValueError):
        warn(f"add_heatmap: {weight_col!r} is not numeric; every point will "
             f"weigh 1.")
        return None
    if len(arr) != count:
        warn(f"add_heatmap: {weight_col!r} has {len(arr)} values for {count} "
             f"points; every point will weigh 1.")
        return None
    return arr
