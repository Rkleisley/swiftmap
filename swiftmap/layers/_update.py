"""
In-place data updates -- the live-feed primitive.

`update_layer(target, data=...)` re-parses through the parser family the layer was
built with and rewrites its buffers and data-derived config while the layer keeps
its identity: id, name, group, visibility, time animation, highlights. The only
alternative used to be remove + add, which minted a new id, reset the sidebar
choice, and dropped the time animation on every refresh of a feed.

The add_* builders record what they were called with (`added_with`: parser
options, data-driven styling options, style, label, popup constants, and whether
the call fanned out into sibling layers) so all of it re-applies to new data.
Everything sent is one `replace` plus the buffers that changed, in one batch --
never a snapshot.
"""
from typing import Any, Dict, List, Optional

import numpy as np

from .._colormaps import (data_driven_colors, data_driven_legend, data_driven_radii,
                          data_driven_size_legend, rgb_hex)
from .._infra import LayerConfig
from .._warnings import warn
from ..parsers import parse_lines, parse_points, parse_polygons
from ..parsers.sources._utils import LineGeom, PolygonGeom
from ._add_child import _json_safe
from ._grouping import resolve_feature_label, resolve_feature_labels
from ._style import resolve_styles
from ._targeting import bounds_of_coords
from ._time import normalize_layer_times

# Parser options update_layer(data=...) forwards to the parsers, merged over the
# options recorded at add time.
PARSER_KEYS = ("lat_col", "lon_col", "coord_order", "line_id_col", "order_col",
               "shape_id_col")

POINT_TYPES = ("circle_markers", "markers")
SINGLE_TYPES = ("polyline", "polygon")

_STYLE_DEFAULTS = {
    "circle_markers": {"color": "#3388ff", "fill_color": "#3388ff", "fill_opacity": 0.2,
                       "weight": 3, "opacity": 1.0},
    "markers": {"color": "#e61a26"},
    "polyline": {"color": "#3388ff", "weight": 3, "opacity": 1.0},
    "polygon": {"color": "#3388ff", "fill_opacity": 0.2, "weight": 3, "opacity": 1.0},
}


def record_added_with(method: str, *, parser: Optional[Dict[str, Any]] = None,
                      data_opts: Optional[Dict[str, Any]] = None,
                      explicit_style: Optional[Dict[str, Any]] = None,
                      static_style: Optional[Dict[str, Any]] = None,
                      label: Any = None, fanned: bool = False,
                      popup: Any = None, tooltip: Any = None,
                      properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    The options an add_* call was made with, as a small JSON-safe record on the
    layer config. `fanned` marks a layer born from a column-driven fan-out (name or
    layer_group from a column, or one of several features) -- one of several
    siblings with no persistent link, which v1 of update_layer declines to
    re-fan.
    """
    rec: Dict[str, Any] = {"method": method, "fanned": bool(fanned)}
    if parser:
        rec["parser"] = {k: v for k, v in parser.items()
                         if v is not None and v != "auto"}
    if data_opts:
        rec["data_opts"] = {k: v for k, v in data_opts.items() if v is not None}
    if explicit_style:
        rec["style"] = dict(explicit_style)
    if static_style:
        rec["static_style"] = dict(static_style)
    if label is not None:
        rec["label"] = label
    if isinstance(popup, dict):
        rec["popup"] = popup
    if isinstance(tooltip, dict):
        rec["tooltip"] = tooltip
    if properties:
        rec["properties"] = properties
    return _json_safe(rec)


def update_layer_data(self, layer: Any, data: Any, append: bool,
                      parser_kwargs: Dict[str, Any],
                      field_kwargs: Dict[str, Any]) -> "Map":
    """Entry point from Map.update_layer when data= is given."""
    ltype = layer.get("type")
    name = layer.get("name")
    rec = layer.get("added_with") or {}

    if ltype == "group":
        warn(f"update_layer: {name!r} is a collection. Updating a collection in place "
             f"is not supported yet -- update its parts as flat layers, or remove and "
             f"re-add it. Nothing changed.")
        return self
    if ltype not in POINT_TYPES + SINGLE_TYPES:
        warn(f"update_layer: data= applies to point, line and polygon layers; "
             f"{name!r} is a {ltype} layer. Nothing changed.")
        return self
    if rec.get("fanned"):
        warn(f"update_layer: {name!r} was fanned out from a column -- one of several "
             f"sibling layers with no persistent link between them. Re-fanning new "
             f"data is not supported yet: update a flat layer, or remove and re-add "
             f"the set. Nothing changed.")
        return self

    parser = {**(rec.get("parser") or {}), **parser_kwargs}
    if ltype in POINT_TYPES:
        return _update_points(self, layer, data, append, parser, field_kwargs, rec)
    if append:
        warn(f"update_layer: append=True on {name!r}, a single {ltype}: there is one "
             f"feature to replace and nothing to append a vertex run to without "
             f"changing it. Pass data= without append to replace it. Nothing changed.")
        return self
    return _update_single(self, layer, data, parser, field_kwargs, rec)


# --- shared pieces ---------------------------------------------------------------------
def _set_or_remove_buffer(self, key: str, payload: Optional[bytes]) -> None:
    if payload is not None:
        if self.coordinate_buffers.get(key) != payload:
            self._set_layer_buffer(key, payload)
    elif key in self.coordinate_buffers:
        self._remove_layer_buffers([key])


def _put(config: Dict[str, Any], key: str, value: Any) -> None:
    """Sets a data-derived field, or drops it when the new data no longer yields it."""
    if value:
        config[key] = value
    else:
        config.pop(key, None)


def _retime(layer: Any, props: Dict[str, Any]):
    """
    Re-normalises a time layer's ::times from the new properties with the same
    field (the meta's "start" or "start/end" description), or None when the
    property is gone. Returns (payload | None, dropped).
    """
    meta = layer.get("time")
    if not meta:
        return None, False
    field = str(meta.get("field") or "")
    start_field, end_field = (field.split("/", 1) + [None])[:2] if field else (None, None)
    interleaved, _, _ = normalize_layer_times(props, start_field, end_field)
    if interleaved is None:
        warn(f"update_layer: the new data for {layer.get('name')!r} has no "
             f"{field!r} time property; the layer stops animating.")
        return None, True
    return np.asarray(interleaved, dtype=np.float64).tobytes(), False


def _clear_overrides(layer: Any, append: bool) -> bool:
    overrides = layer.get("style_overrides") or {}
    if overrides and not append:
        warn(f"update_layer: {layer.get('name')!r} had per-feature style overrides "
             f"(set_feature_styles). Feature indices do not survive a data replace, "
             f"so they were cleared; re-apply them against the new data if needed.")
        return True
    return False


def _merge_constants(props: Dict[str, List[Any]], rec: Dict[str, Any], n: int) -> None:
    """popup={...}/tooltip={...} constants ride properties as repeated columns."""
    for key in ("popup", "tooltip"):
        for k, v in (rec.get(key) or {}).items():
            if k not in props:
                props[k] = [v] * n
            else:
                props[k] = [v if x is None else x for x in props[k]]


# --- points ----------------------------------------------------------------------------
def _update_points(self, layer, data, append, parser, field_kwargs, rec) -> "Map":
    name = layer.get("name")
    ltype = layer.get("type")
    layer_id = layer.get("id")
    try:
        lats, lons, props = parse_points(data, parser.get("lat_col"), parser.get("lon_col"),
                                         coord_order=parser.get("coord_order", "auto"))
    except TypeError as exc:
        warn(f"update_layer could not read the supplied data for {name!r}. {exc} "
             f"Nothing changed.")
        return self
    lats = np.asarray(lats, dtype=np.float64)
    lons = np.asarray(lons, dtype=np.float64)
    props = dict(props or {})
    if lats.size == 0:
        warn(f"update_layer found no points in the supplied {type(data).__name__} for "
             f"{name!r}. Nothing changed.")
        return self

    n_new = int(lats.size)
    n_old = 0
    if append:
        # New features land AFTER the existing ones, so existing feature indices
        # -- and any per-feature overrides keyed on them -- stay valid.
        old = np.frombuffer(self.coordinate_buffers.get(layer_id, b""),
                            dtype=np.float64).reshape(-1, 2)
        old_props = layer.get("properties") or {}
        n_old = old.shape[0]
        lats = np.concatenate([old[:, 0], lats])
        lons = np.concatenate([old[:, 1], lons])
        merged = {}
        for k in dict.fromkeys([*old_props, *props]):
            a = old_props.get(k)
            a = list(a) if isinstance(a, list) else [a] * n_old
            b = list(props.get(k, [None] * n_new))
            merged[k] = a + b
        props = merged

    n = int(lats.size)
    _merge_constants(props, rec, n)
    data_opts = rec.get("data_opts") or {}
    _, feature_styles = resolve_styles(rec.get("style") or {}, rec.get("static_style") or {},
                                       props, n, _STYLE_DEFAULTS[ltype])
    # Auto-ranged colormaps and radii rescale over the whole (appended) data -- the
    # encoding is always the layer's current data, never a mix of two ranges.
    colors_u8 = data_driven_colors(props, data_opts,
                                   layer.get("color", _STYLE_DEFAULTS[ltype]["color"]),
                                   "update_layer")
    radii_f32 = data_driven_radii(props, data_opts, "update_layer")
    legend_block = data_driven_legend(props, data_opts, layer.get("color", _STYLE_DEFAULTS[ltype]["color"]))
    size_legend = data_driven_size_legend(props, data_opts)
    labels = (resolve_feature_labels(rec["label"], props, n)
              if rec.get("label") is not None else None)
    times_payload, drop_time = _retime(layer, props)
    cleared = _clear_overrides(layer, append)

    coords = np.column_stack((lats, lons)).flatten().astype(np.float64)
    bounds = [[float(lats.min()), float(lons.min())], [float(lats.max()), float(lons.max())]]

    # An append sends the delta: the new tail of every buffer and only the new
    # rows of the property lists. A per-feature `style` column resolves over the
    # whole set (its uniform-collapse rule spans every feature), so that shape,
    # and a lost time property, take the full path instead.
    incremental = (append and n_old > 0 and feature_styles is None
                   and not layer.get("feature_styles") and not drop_time)
    if incremental:
        _emit_points_append(self, layer, n_old, n_new, coords, colors_u8, radii_f32,
                            legend_block, size_legend, labels, times_payload, props,
                            bounds, field_kwargs)
        return self

    with self.batch():
        self._set_layer_buffer(layer_id, coords.tobytes())
        _set_or_remove_buffer(self, f"{layer_id}::colors",
                              colors_u8.tobytes() if colors_u8 is not None else None)
        _set_or_remove_buffer(self, f"{layer_id}::radii",
                              radii_f32.tobytes() if radii_f32 is not None else None)
        if layer.get("time"):
            _set_or_remove_buffer(self, f"{layer_id}::times", times_payload)

        new = dict(layer.to_dict())
        new["properties"] = {str(k): _json_safe(v) for k, v in props.items()}
        new["bounds"] = bounds
        _put(new, "legend", legend_block)
        _put(new, "legend_size", size_legend)
        _put(new, "labels", labels)
        _put(new, "feature_styles", feature_styles)
        if drop_time:
            new["time"] = None
        if cleared:
            new["style_overrides"] = {}
        new.update(field_kwargs)
        config = LayerConfig(**new)
        self._layers_replace(layer, config)
        # Extends the union only while auto-fit is still armed; with a view chosen,
        # a feed refresh must never yank the viewport.
        self._auto_fit_extend(config)
    return self


def _grow_or_reset(self, key: str, payload: Optional[bytes], bytes_per_point: int,
                   n_old: int) -> None:
    """
    Ships a recomputed per-point buffer as a TAIL when the existing points' values
    are unchanged, in full when they moved, gone when there is nothing to ship.

    The decision is a byte comparison of the recomputed head against what the
    client already holds -- never an inference. For ::colors and ::radii that is
    where the range rule lands: an explicit vmin/vmax (or a category mapping with
    no new category) leaves every existing value unchanged, so the head matches
    and only the tail goes; an auto range that actually moved changes every value,
    so the head differs and the whole buffer goes. After warm-up an auto range
    rarely moves, so the common tick is tail-only. ::times and coordinates are
    absolute and always append.
    """
    if payload is None:
        if key in self.coordinate_buffers:
            self._remove_layer_buffers([key])
        return
    split = n_old * bytes_per_point
    existing = self.coordinate_buffers.get(key)
    if existing is not None and len(existing) == split and payload[:split] == existing:
        self._append_layer_buffer(key, payload[split:])
    else:
        self._set_layer_buffer(key, payload)


def _emit_points_append(self, layer, n_old, n_new, coords, colors_u8, radii_f32,
                        legend_block, size_legend, labels, times_payload, props,
                        bounds, field_kwargs) -> None:
    """The append's wire shape: tails for the buffers, the new rows for the
    property lists, and one `set` for the small fields. Never the layer."""
    layer_id = layer.get("id")
    with self.batch():
        self._append_layer_buffer(layer_id, coords[n_old * 2:].tobytes())
        _grow_or_reset(self, f"{layer_id}::colors",
                       colors_u8.tobytes() if colors_u8 is not None else None, 4, n_old)
        _grow_or_reset(self, f"{layer_id}::radii",
                       radii_f32.tobytes() if radii_f32 is not None else None, 4, n_old)
        if layer.get("time") and times_payload is not None:
            _grow_or_reset(self, f"{layer_id}::times", times_payload, 16, n_old)

        new = dict(layer.to_dict())
        new["properties"] = {str(k): _json_safe(v) for k, v in props.items()}
        new["bounds"] = bounds
        _put(new, "legend", legend_block)
        _put(new, "legend_size", size_legend)
        _put(new, "labels", labels)
        new.update(field_kwargs)

        fields = {"bounds": bounds, **field_kwargs}
        for key, value in (("legend", legend_block), ("legend_size", size_legend)):
            if (value or None) != (layer.get(key) or None):
                fields[key] = value
        append_op = {"op": "append", "id": layer_id, "base": n_old, "count": n_new,
                     "properties": {str(k): _json_safe(list(v)[n_old:])
                                    for k, v in props.items()}}
        if labels:
            append_op["lists"] = {"labels": labels[n_old:]}
        config = LayerConfig(**new)
        self._layers_replace(layer, config, emit_ops=[
            append_op, {"op": "set", "id": layer_id, "fields": fields}])
        self._auto_fit_extend(config)


# --- one line / one polygon ------------------------------------------------------------
def _update_single(self, layer, data, parser, field_kwargs, rec) -> "Map":
    name = layer.get("name")
    ltype = layer.get("type")
    layer_id = layer.get("id")
    kind = "line" if ltype == "polyline" else "polygon"
    parse = parse_lines if ltype == "polyline" else parse_polygons
    id_key = "line_id_col" if ltype == "polyline" else "shape_id_col"
    parse_kwargs = {k: parser[k] for k in ("lat_col", "lon_col", "order_col", id_key)
                    if parser.get(k) is not None}
    parse_kwargs["coord_order"] = parser.get("coord_order", "auto")
    try:
        feats, props = parse(data, **parse_kwargs)
    except TypeError as exc:
        warn(f"update_layer could not read the supplied data for {name!r}. {exc} "
             f"Nothing changed.")
        return self
    if not feats:
        warn(f"update_layer found no {kind} geometry in the supplied "
             f"{type(data).__name__} for {name!r}. Nothing changed.")
        return self
    if len(feats) > 1:
        warn(f"update_layer: the new data holds {len(feats)} {kind}s but {name!r} is one "
             f"layer holding one. Pass a single feature, or use add_{'line' if kind == 'line' else 'polygon'} "
             f"for a set. Nothing changed.")
        return self

    coords = feats[0]
    if isinstance(coords, LineGeom):
        flat, structure = coords.flat(), ("parts", coords.part_lengths())
    elif isinstance(coords, PolygonGeom):
        flat, structure = coords.flat(), ("rings", coords.ring_lengths())
    else:
        flat, structure = coords, ("parts" if ltype == "polyline" else "rings", None)

    feature_props = {k: v[0] for k, v in (props or {}).items()}
    if rec.get("properties"):
        feature_props.update(rec["properties"])
    data_opts = rec.get("data_opts") or {}
    colors_u8 = data_driven_colors(props, data_opts,
                                   layer.get("color", _STYLE_DEFAULTS[ltype]["color"]),
                                   "update_layer")
    legend_block = data_driven_legend(props, data_opts, layer.get("color", _STYLE_DEFAULTS[ltype]["color"]))
    label = (resolve_feature_label(rec["label"], props, 0)
             if rec.get("label") is not None else None)
    times_payload, drop_time = _retime(layer, feature_props)
    cleared = _clear_overrides(layer, append=False)

    with self.batch():
        self._set_layer_buffer(
            layer_id, np.asarray(flat, dtype=np.float64).flatten().tobytes())
        if layer.get("time"):
            _set_or_remove_buffer(self, f"{layer_id}::times", times_payload)

        new = dict(layer.to_dict())
        new["properties"] = {str(k): _json_safe(v) for k, v in feature_props.items()}
        new["bounds"] = bounds_of_coords(flat)
        _put(new, structure[0], structure[1])
        _put(new, "legend", legend_block)
        _put(new, "label", label)
        if colors_u8 is not None:
            new["color" if ltype == "polyline" else "fillColor"] = rgb_hex(colors_u8[0])
        if drop_time:
            new["time"] = None
        if cleared:
            new["style_overrides"] = {}
        new.update(field_kwargs)
        config = LayerConfig(**new)
        self._layers_replace(layer, config)
        self._auto_fit_extend(config)
    return self
