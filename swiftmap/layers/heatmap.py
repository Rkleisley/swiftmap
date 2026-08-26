import numpy as np
from typing import Any, Optional

from ..parsers import parse_points
from ..parsers.sources._utils import h3_module
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
    cells: str = "blobs",
    auto_normalize: bool = True,
    resolution: Optional[int] = None,
    radius: Optional[int] = None,
    colormap: Any = None,
    max_intensity: Optional[float] = None,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
    opacity: Optional[float] = None,
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
    Adds a density heatmap: point weights summed into cells, colour from sums.

    This is the exploratory view of a point dataset -- the answer to "where is
    the structure in what I am looking at". The colour ramp is RELATIVE: it
    normalises to the hottest cell in the current view and re-normalises as the
    view settles, so zooming into a quiet region spreads its local structure
    across the full ramp. The kernel is the one choice:

    - ``cells="blobs"`` (default): screen-space Gaussian blobs. The picture
      recomputes with the screen -- pretty, relative, not a measurement.
    - ``cells="h3"``: real hexagon polygons at a fixed H3 ``resolution``.
      The sums are computed once, here, at add time; only the COLOURING is
      dynamic, re-stretching to the hexes on screen. Three hexes in view means
      the ramp spans those three.

    When you need reportable numbers -- clickable cells with values in popups,
    a legend with real bounds, a join key -- bin the data yourself
    (`swiftmap.hexbin`) and paint it with `add_polygon(df, color_col=...)`.

    Parameters
    ----------
    data : Any
        Either a point dataset (everything add_circle_markers reads), or the
        name/id of a point layer already on the map -- the "too many points"
        workflow: `m.add_heatmap("Sites")` derives heat from the layer's own
        points. A string that matches no layer is treated as data. For
        ``cells="h3"`` the binning happens now: later updates to a source
        layer's data do not re-bin (call add_heatmap again).
    weight_col : str, optional
        Column whose value each point contributes to the sum; omitted, every
        point contributes 1 (a count). For a layer source, the column comes
        from that layer's own properties.
    cells : {'blobs', 'h3'}, default 'blobs'
        The kernel: screen-space blobs, or fixed-resolution H3 hexagons.
    auto_normalize : bool, default True
        The view-tracking itself. True re-stretches the ramp as the view
        settles; False computes the scale once and holds it -- blobs freeze
        the scale of the first settled view, hexes colour by the whole
        dataset's extremes. Explicit pins (max_intensity, vmin/vmax) override
        either way.
    resolution : int, optional
        H3 resolution for ``cells="h3"``, 0 (continent) to 15 (sub-metre);
        default 8. Requires the `h3` package (optional dependency).
    radius : int, optional
        Blob kernel radius in screen pixels; default 25. Blobs only.
    colormap : optional
        Any continuous colormap `color_col` accepts -- a registered name, a
        list of colours, a callable, "matplotlib:<name>". A `{value: color}`
        mapping is categorical and is refused with a warning.
    max_intensity : float, optional
        Blobs only: pins the top of the ramp to a fixed summed weight,
        turning the view-relative normalisation OFF.
    vmin, vmax : float, optional
        Hexes only: pin the ramp to fixed values, turning the view-relative
        normalisation OFF -- the escape hatch when colours must be comparable
        across views or maps.
    opacity : float, optional
        Overall layer opacity; default 1.0 for blobs, 0.75 for hexes.
    name : str, optional
        Sidebar name; defaults to "Heatmap".
    layer_group : str, optional
        Sidebar folder path (e.g. "Analysis/Density").
    visible : bool, default True
        Initial visibility.
    lat_col, lon_col, coord_order :
        As in every add_* method; used only on the data path.
    """
    if cells not in ("blobs", "h3"):
        warn(f"add_heatmap: cells must be 'blobs' or 'h3', got {cells!r}. "
             f"Using 'blobs'.")
        cells = "blobs"

    if cells == "h3":
        if radius is not None:
            warn("add_heatmap: radius sizes the blob kernel and does not apply "
                 "to cells='h3' (hexes are ground-fixed). Ignoring it.")
        if max_intensity is not None:
            warn("add_heatmap: max_intensity pins the blob scale; for "
                 "cells='h3' pin the ramp with vmin/vmax. Ignoring it.")
        if resolution is None:
            resolution = 8
        elif isinstance(resolution, bool) or not isinstance(resolution, int) \
                or not 0 <= resolution <= 15:
            warn(f"add_heatmap: resolution must be an integer from 0 to 15, "
                 f"got {resolution!r}. Using 8.")
            resolution = 8
        if h3_module() is None:
            warn("add_heatmap: cells='h3' needs the h3 package to bin points "
                 "into hexes. pip install h3. No layer was added.")
            return self
    else:
        for given, knob, fix in ((resolution, "resolution", "cells='h3'"),
                                 (vmin, "vmin", "cells='h3'"),
                                 (vmax, "vmax", "cells='h3'")):
            if given is not None:
                warn(f"add_heatmap: {knob} applies to {fix}, not to blobs. "
                     f"Ignoring it.")
        if radius is None:
            radius = 25
        elif isinstance(radius, bool) or not isinstance(radius, (int, float)) \
                or radius <= 0:
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
    props = None

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
        if cells == "h3":
            if not count:
                warn(f"add_heatmap: layer {data!r} has no coordinate buffer to "
                     f"bin. No layer was added.", EmptyLayerWarning)
                return self
            coords = np.frombuffer(raw, dtype=np.float64).reshape(-1, 2)
            lats, lons = coords[:, 0], coords[:, 1]
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
    group_specs = build_group_specs(layer_group, {})
    shared = {
        "id": layer_id,
        "type": "heatmap",
        "name": name or "Heatmap",
        "layer_group": resolve_group_path(group_specs, {}, 0, "Heatmap Group"),
        "group_multi_select": group_multi_select,
        "visible": visible,
        "auto_normalize": bool(auto_normalize),
        "ramp": anchors,
        # The ramp reads low -> high by design: the scale is view-relative, so
        # numbers on it would be a lie that changes with every pan.
        "legend": {"kind": "ramp", "field": weight_col or "density",
                   "anchors": list(anchors), "vmin": "low", "vmax": "high"},
        "added_with": record_added_with(
            "add_heatmap",
            parser={"lat_col": lat_col, "lon_col": lon_col,
                    "coord_order": coord_order},
            data_opts={"weight_col": weight_col,
                       "cells": None if cells == "blobs" else cells,
                       "resolution": resolution}),
    }

    if cells == "h3":
        h3 = h3_module()
        w = None
        if weights is not None:
            w = np.nan_to_num(weights.astype(np.float64), nan=0.0)
        sums = {}
        for i in range(len(lats)):
            cell = h3.latlng_to_cell(float(lats[i]), float(lons[i]), resolution)
            sums[cell] = sums.get(cell, 0.0) + (w[i] if w is not None else 1.0)

        cell_ids = list(sums.keys())
        ring_pts = []
        cell_counts = []
        for cell in cell_ids:
            boundary = h3.cell_to_boundary(cell)
            cell_counts.append(len(boundary))
            ring_pts.extend([[float(lat), float(lon)] for lat, lon in boundary])
        rings = np.asarray(ring_pts, dtype=np.float64)
        values = np.asarray([sums[c] for c in cell_ids], dtype=np.float64)
        bounds = [[float(rings[:, 0].min()), float(rings[:, 1].min())],
                  [float(rings[:, 0].max()), float(rings[:, 1].max())]]

        self._set_layer_buffer(layer_id, rings.flatten().tobytes())
        self._set_layer_buffer(f"{layer_id}::values", values.tobytes())
        self.add_child({
            **shared,
            "cells": "h3",
            "resolution": resolution,
            "opacity": 0.75 if opacity is None else opacity,
            "vmin": vmin,
            "vmax": vmax,
            "cell_counts": cell_counts,
            # The cell ids stay: a hex is a real place, and the ids are the
            # join key back onto whatever produced the points.
            "properties": {"h3": cell_ids},
            "bounds": bounds,
            **kwargs,
        })
        return self

    if source_id is None:
        coords = np.column_stack((lats, lons)).astype(np.float64)
        self._set_layer_buffer(layer_id, coords.flatten().tobytes())
    if weights is not None:
        self._set_layer_buffer(f"{layer_id}::weights", weights.tobytes())
    self.add_child({
        **shared,
        "radius": radius,
        "opacity": 1.0 if opacity is None else opacity,
        "max_intensity": max_intensity,
        **({"source": source_id} if source_id else {}),
        # Data-path heat keeps its columns: that is what lets make_time_layer
        # probe a timestamp column and animate the blobs. A source-referenced
        # heat animates through its SOURCE layer's time instead.
        **({"properties": props} if source_id is None else {}),
        **({"bounds": bounds} if bounds else {}),
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
