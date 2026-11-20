"""
Packed vector layers: many polygon or line features in ONE layer.

Points have always been one layer per (folder, name), with every point's data in
columns and binary buffers. Polygons and lines were one layer PER FEATURE -- a
9,919-cell H3 table became 9,919 configs (7.6 MB of JSON, half of it repeated in
every one) and 9,919 coordinate buffers of 112 bytes, and a name taken from a
column re-sent the growing group per feature (1.8 GB for 6,000 hexes). A packed
layer stores them the way points are stored:

    feature_count   n
    <id>            float64 [lat, lon] of every feature, one after another
    <id>::offsets   uint32 n + 1: feature i is vertices offsets[i] .. offsets[i+1]-1
    <id>::colors    u8 RGBA per feature (color_col): a polygon's fill -- its stroke
                    too with color_col_stroke -- and a line's colour
    <id>::times     float64 [start, end] per feature, or per vertex for tracks
    properties      columns; feature_styles and labels per-feature lists
    rings / parts   per-feature ring tables / part lengths, None for simple ones

Every add_polygon / add_line result is packed, one feature included: one format,
as points are columnar for a single point. The renderer reads it in src/packed.js.
"""
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from ..parsers.sources._utils import LineGeom, PolygonGeom
from ._grouping import resolve_group_path, resolve_layer_name, static_group_path, is_column
from ._time import detect_time_fields, normalize_layer_times


def group_features(count: int, name: Optional[str], props: Dict[str, List[Any]],
                   group_specs, fallback_name: str,
                   default_group: str) -> Dict[Tuple[str, str], List[int]]:
    """
    Feature indices per (folder, name), in first-seen order: one packed layer each.

    The rule points follow. A literal name in a static folder is every feature in
    one layer; a name (or folder part) from a column splits by its values.
    """
    static = static_group_path(group_specs, default_group)
    per_feature_name = is_column(name, props) or (not name and "name" in (props or {}))
    if static is not None and not per_feature_name:
        return {(static, name or fallback_name): list(range(count))}
    groups: Dict[Tuple[str, str], List[int]] = {}
    for i in range(count):
        folder = (static if static is not None
                  else resolve_group_path(group_specs, props, i, default_group))
        label = resolve_layer_name(name, props, i, count > 1, fallback_name)
        groups.setdefault((folder, label), []).append(i)
    return groups


def pack_geometry(ltype: str, feats: Sequence[Any], indices: Sequence[int]):
    """
    The packed coordinates of feats[indices]: (coords bytes, offsets bytes,
    per-feature tables or None, bounds or None).

    The table is `rings` for polygons and `parts` for lines, None for a feature
    whose geometry is one ring or one run -- the default the renderer assumes --
    and None as a whole when no feature needs one.
    """
    chunks = []
    counts = np.zeros(len(indices), dtype=np.int64)
    tables: List[Any] = []
    for k, i in enumerate(indices):
        geom = feats[i]
        table = None
        if isinstance(geom, LineGeom):
            flat, lengths = geom.flat(), geom.part_lengths()
            table = list(lengths) if len(lengths) > 1 else None
        elif isinstance(geom, PolygonGeom):
            flat, rings = geom.flat(), geom.ring_lengths()
            plain = len(rings) == 1 and len(rings[0]) == 1
            table = None if plain else [list(r) for r in rings]
        else:
            flat = geom
        arr = np.asarray(flat, dtype=np.float64).reshape(-1)
        chunks.append(arr)
        counts[k] = arr.size // 2
        tables.append(table)
    coords = np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float64)
    offsets = np.zeros(len(indices) + 1, dtype=np.uint32)
    np.cumsum(counts, out=offsets[1:])
    bounds = None
    if coords.size:
        lats, lons = coords[0::2], coords[1::2]
        bounds = [[float(lats.min()), float(lons.min())],
                  [float(lats.max()), float(lons.max())]]
    has_table = any(t is not None for t in tables)
    return coords.tobytes(), offsets.tobytes(), (tables if has_table else None), bounds


def subset_columns(props: Dict[str, List[Any]], indices: Sequence[int], total: int,
                   constants: Optional[Dict[str, Any]] = None) -> Dict[str, List[Any]]:
    """Columnar properties for feats[indices], with `properties=` constants as columns."""
    whole = len(indices) == total
    cols = {k: (list(v) if whole else [v[i] for i in indices]) for k, v in props.items()}
    for k, v in (constants or {}).items():
        cols[k] = [v] * len(indices)
    return cols


def _is_vertex_run(value: Any, field: str) -> bool:
    """A feature's value that holds one time per vertex -- _values_of's rule per feature."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if not isinstance(value, (list, tuple)):
        return False
    return not (field == "times" and len(value) == 2
                and not isinstance(value[0], (list, tuple)))


def packed_times(props: Dict[str, List[Any]], time_field: Optional[str],
                 time_end_field: Optional[str], vertex_counts: Sequence[int]):
    """
    (interleaved, field description, timeless) for a packed layer: one [start, end]
    pair per feature, or -- when any feature carries a per-vertex run, as a track
    ordered by time does -- one pair per VERTEX across the layer, a feature with a
    single time repeating it over its vertices. None when no time field exists.
    """
    n = len(vertex_counts)
    start_field, end_field = time_field, time_end_field
    if not start_field:
        start_field, detected_end = detect_time_fields(props)
        end_field = time_end_field or detected_end
    column = props.get(start_field) if start_field else None
    per_vertex = isinstance(column, list) and any(
        _is_vertex_run(v, start_field) for v in column)
    if not per_vertex:
        return normalize_layer_times(props, time_field, time_end_field)

    pieces = []
    timeless = 0
    described = None
    for i in range(n):
        sub = {start_field: column[i] if i < len(column) else None}
        if end_field and isinstance(props.get(end_field), list):
            sub[end_field] = props[end_field][i]
        pairs, described_i, timeless_i = normalize_layer_times(
            sub, start_field, end_field if end_field in sub else None)
        described = described or described_i
        need = int(vertex_counts[i])
        arr = (np.asarray(pairs, dtype=np.float64) if pairs is not None
               else np.full(2, np.nan))
        if arr.size == 2 * need:
            pieces.append(arr)
            timeless += timeless_i
        elif arr.size == 2:
            pieces.append(np.tile(arr, need))
            timeless += need if np.isnan(arr[0]) else 0
        else:
            pieces.append(np.full(2 * need, np.nan))
            timeless += need
    interleaved = np.concatenate(pieces) if pieces else np.empty(0)
    return interleaved, described or start_field, timeless


def vertex_counts_of(coordinate_buffers: Dict[str, bytes], layer_id: str,
                     feature_count: int) -> np.ndarray:
    """Each feature's vertex count, from the layer's ::offsets buffer."""
    raw = coordinate_buffers.get(f"{layer_id}::offsets")
    if raw:
        offsets = np.frombuffer(raw, dtype=np.uint32)
        if offsets.size == feature_count + 1:
            return np.diff(offsets).astype(np.int64)
    coords = coordinate_buffers.get(layer_id) or b""
    return np.array([len(coords) // 16], dtype=np.int64)


def is_packed(layer: Any) -> bool:
    """A polygon or line layer in the packed format."""
    return (layer.get("type") in ("polygon", "polyline")
            and layer.get("feature_count") is not None)


# Keys a feature replaces with its own value (src/packed.js PER_FEATURE, same set).
_PER_FEATURE = {"properties", "feature_styles", "labels", "rings", "parts",
                "style_overrides", "bounds", "feature_count", "label"}


def _hex(rgba) -> str:
    return "#%02x%02x%02x" % (int(rgba[0]), int(rgba[1]), int(rgba[2]))


def features_of(layer: Any, coordinate_buffers: Dict[str, bytes]) -> List[Dict[str, Any]]:
    """
    A packed layer's features, one dict each, shaped like the one-feature layers of
    old and resolved exactly as the renderer resolves them (src/packed.js): the
    layer's fields, the feature's style over them, its ::colors fill (and stroke,
    on a line or with color_col_stroke), its own row of properties, ring or part
    table, label, coordinates and bounds, plus `layer_id` and `index` -- what a
    click reports. A layer that is not packed comes back as its one feature.
    """
    config = dict(layer.to_dict() if hasattr(layer, "to_dict") else layer)
    lid = config.get("id")
    raw = coordinate_buffers.get(lid) or b""
    coords = np.frombuffer(raw, dtype=np.float64).reshape(-1, 2)
    if not is_packed(config):
        bounds = ([[float(coords[:, 0].min()), float(coords[:, 1].min())],
                   [float(coords[:, 0].max()), float(coords[:, 1].max())]]
                  if len(coords) else config.get("bounds"))
        return [{**config, "layer_id": lid, "index": 0,
                 "coords": coords.tolist(), "bounds": bounds}]

    n = int(config["feature_count"])
    counts = vertex_counts_of(coordinate_buffers, lid, n)
    offsets = np.concatenate([[0], np.cumsum(counts)]).astype(np.int64)
    raw_colors = coordinate_buffers.get(f"{lid}::colors")
    colors = (np.frombuffer(raw_colors, dtype=np.uint8).reshape(-1, 4)
              if raw_colors and len(raw_colors) == 4 * n else None)
    stroke_follows = config.get("type") == "polyline" or config.get("color_col_stroke")
    base = {k: v for k, v in config.items() if k not in _PER_FEATURE}
    props = config.get("properties") or {}
    styles = config.get("feature_styles") or None
    table_key = "parts" if config.get("type") == "polyline" else "rings"
    tables = config.get(table_key) or None
    labels = config.get("labels")
    overrides = config.get("style_overrides") or {}

    out = []
    for i in range(n):
        feature = dict(base)
        if styles and i < len(styles) and styles[i]:
            feature.update(styles[i])
        if colors is not None:
            feature["fillColor"] = _hex(colors[i])
            if stroke_follows:
                feature["color"] = _hex(colors[i])
        feature["properties"] = {k: (v[i] if isinstance(v, list) else v)
                                 for k, v in props.items()}
        if tables and i < len(tables) and tables[i]:
            feature[table_key] = tables[i]
        if labels is not None and i < len(labels):
            feature["label"] = labels[i]
        own = overrides.get(str(i), overrides.get(i))
        if own:
            feature["style_overrides"] = {"0": own}
        run = coords[offsets[i]:offsets[i + 1]]
        feature["coords"] = run.tolist()
        feature["bounds"] = ([[float(run[:, 0].min()), float(run[:, 1].min())],
                              [float(run[:, 0].max()), float(run[:, 1].max())]]
                             if len(run) else None)
        feature["layer_id"] = lid
        feature["index"] = i
        out.append(feature)
    return out


def map_features(m: Any, target: Any = None, **criteria) -> List[Dict[str, Any]]:
    """Every polygon and line feature among the matching layers, in map order."""
    out: List[Dict[str, Any]] = []
    for layer in m.find_layers(target, **criteria):
        if layer.get("type") in ("polygon", "polyline"):
            out.extend(features_of(layer, m.coordinate_buffers))
    return out
