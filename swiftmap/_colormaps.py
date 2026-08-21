"""
Data-driven colour and size mapping, with no dependency beyond numpy.

Colormaps are anchor tables interpolated linearly in RGB rather than 256-entry
LUTs: a dozen hex codes per map reproduces matplotlib's ramps to well within a
shade, and a table this size can be typed by hand on a network where nothing can
be installed. The result of every mapping is a compact binary buffer -- u8 RGBA
for colours, f32 for radii -- shipped on the same transport as coordinates, never
as per-feature style dicts in the layers JSON: at millions of points, style dicts
are exactly the payload that killed sessions before coordinates moved to buffers.
"""
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from ._warnings import warn

# Sequential/diverging ramps, evenly spaced anchors, matplotlib-faithful.
COLORMAPS = {
    "viridis": ["#440154", "#482878", "#3e4989", "#31688e", "#26828e",
                "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
    "plasma": ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786",
               "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
    "inferno": ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60",
                "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
    "magma": ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f",
              "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
    "turbo": ["#30123b", "#4145ab", "#4675ed", "#39a2fc", "#1bcfd4",
              "#24eca6", "#61fc6c", "#a4fc3b", "#d1e834", "#f3c63a",
              "#fe9b2d", "#f36315", "#d93806", "#b11901", "#7a0402"],
    "coolwarm": ["#3b4cc0", "#6688ee", "#88abfd", "#b8d0f9", "#dddddd",
                 "#f5c4ac", "#f4987a", "#dd5f4b", "#b40426"],
    "blues": ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6",
              "#4292c6", "#2171b5", "#08519c", "#08306b"],
    "reds": ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a",
             "#ef3b2c", "#cb181d", "#a50f15", "#67000d"],
    "greens": ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476",
               "#41ab5d", "#238b45", "#006d2c", "#00441b"],
    "greys": ["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696",
              "#737373", "#525252", "#252525", "#000000"],
}

# Categorical palettes cycle; Tableau 10 reads well on both basemap tones.
CATEGORICAL_PALETTES = {
    "swift10": ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
                "#edc949", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"],
}

DEFAULT_COLORMAP = "viridis"
DEFAULT_PALETTE = "swift10"


# --- colormap specs ----------------------------------------------------------------
# What `colormap=` accepts, canonicalised ONCE when the option is popped into a
# JSON-safe spec that records into the layer config and so survives
# update_layer(data=...):
#   a registered name       -> that name ("viridis", "swift10", or one you registered)
#   "matplotlib:<name>"     -> that map sampled into anchors; the import happens only
#                              when asked, so matplotlib is never a dependency
#   a list of colours       -> anchors: a ramp for numeric values, a palette for
#                              categories (the first sorted category takes the first)
#   a callable t -> colour  -> sampled into anchors; a matplotlib Colormap object is one
#   {value: colour}         -> an explicit category mapping; the legend follows the
#                              dict's order, and an unmapped value takes the fallback
SAMPLE_ANCHORS = 16


def _to_hex(color: Any) -> Optional[str]:
    """#rrggbb from '#rgb'/'#rrggbb'/'#rrggbbaa' or an RGB(A) tuple in 0..1 or 0..255."""
    if isinstance(color, str):
        v = color.strip().lstrip("#")
        if len(v) == 3:
            v = "".join(ch * 2 for ch in v)
        if len(v) in (6, 8) and all(ch in "0123456789abcdefABCDEF" for ch in v[:6]):
            return "#" + v[:6].lower()
        return None
    try:
        parts = [float(c) for c in list(color)[:3]]
    except (TypeError, ValueError):
        return None
    if len(parts) != 3:
        return None
    if all(0.0 <= c <= 1.0 for c in parts):
        parts = [c * 255.0 for c in parts]
    return "#%02x%02x%02x" % tuple(int(round(min(max(c, 0.0), 255.0))) for c in parts)


def _sample_callable(fn: Any) -> Optional[List[str]]:
    anchors = []
    for t in np.linspace(0.0, 1.0, SAMPLE_ANCHORS):
        try:
            hexcode = _to_hex(fn(float(t)))
        except Exception:
            return None
        if hexcode is None:
            return None
        anchors.append(hexcode)
    return anchors


def _from_matplotlib(name: str) -> Optional[List[str]]:
    try:
        import matplotlib
        cmap = matplotlib.colormaps[name]
    except ImportError:
        warn(f"colormap 'matplotlib:{name}' needs matplotlib, which is not installed; "
             f"using {DEFAULT_COLORMAP!r}.")
        return None
    except KeyError:
        warn(f"matplotlib has no colormap named {name!r}; using {DEFAULT_COLORMAP!r}.")
        return None
    return _sample_callable(cmap)


def resolve_colormap(spec: Any) -> Any:
    """
    Canonicalises a `colormap=` value into its JSON-safe spec: a registered name,
    a list of hex anchors, or a {value: hex} mapping. None means "the default".
    Anything that cannot be read warns honestly and falls back to the default.
    """
    if spec is None:
        return None
    if isinstance(spec, str):
        text = spec.strip()
        low = text.lower()
        if low in COLORMAPS or low in CATEGORICAL_PALETTES:
            return low
        if ":" in text:
            source, _, name = text.partition(":")
            if source.strip().lower() in ("matplotlib", "mpl"):
                return _from_matplotlib(name.strip())
            warn(f"Unknown colormap source {source.strip()!r} in {spec!r}; only "
                 f"'matplotlib:<name>' is understood. Using {DEFAULT_COLORMAP!r}.")
            return None
        return text          # an unknown name: the mapping warns "Unknown colormap"
    if isinstance(spec, dict):
        mapping: Dict[str, str] = {}
        bad = []
        for key, value in spec.items():
            hexcode = _to_hex(value)
            if hexcode is None:
                bad.append(key)
            else:
                mapping[str(key)] = hexcode
        if bad:
            warn(f"colormap mapping: {len(bad)} value(s) are not colours "
                 f"({', '.join(repr(b) for b in bad[:5])}); those categories take the "
                 f"fallback colour.")
        return mapping
    if isinstance(spec, (list, tuple)):
        anchors = [_to_hex(c) for c in spec]
        if not anchors or any(a is None for a in anchors):
            warn(f"A colormap list must hold colours (#rrggbb or RGB tuples); got "
                 f"{spec!r}. Using {DEFAULT_COLORMAP!r}.")
            return None
        return anchors if len(anchors) > 1 else anchors * 2
    if callable(spec):
        anchors = _sample_callable(spec)
        if anchors is None:
            warn(f"A colormap callable must map t in [0, 1] to a colour; {spec!r} did "
                 f"not. Using {DEFAULT_COLORMAP!r}.")
        return anchors
    warn(f"colormap must be a name, 'matplotlib:<name>', a list of colours, a callable, "
         f"or a {{value: colour}} mapping; got {type(spec).__name__}. Using "
         f"{DEFAULT_COLORMAP!r}.")
    return None


def register_colormap(name: str, source: Any, kind: str = "ramp") -> None:
    """
    Registers a colormap under a name, from any form `colormap=` accepts -- a list of
    colours, a callable or matplotlib Colormap, 'matplotlib:<name>'. `kind='ramp'`
    (default) interpolates for numeric values and spreads over categories;
    `kind='palette'` cycles discrete colours over categories. The name then works
    everywhere a built-in does, and records into layer configs as a name.
    """
    spec = resolve_colormap(source)
    if isinstance(spec, str):
        spec = COLORMAPS.get(spec) or CATEGORICAL_PALETTES.get(spec)
    if not isinstance(spec, list):
        warn(f"register_colormap({name!r}): the source must resolve to a list of "
             f"colours; nothing was registered.")
        return
    key = str(name).strip().lower()
    if kind == "palette":
        CATEGORICAL_PALETTES[key] = list(spec)
        COLORMAPS.pop(key, None)
    elif kind == "ramp":
        COLORMAPS[key] = list(spec)
        CATEGORICAL_PALETTES.pop(key, None)
    else:
        warn(f"register_colormap({name!r}): kind must be 'ramp' or 'palette', got "
             f"{kind!r}; nothing was registered.")


def _anchors_of(spec: Any) -> Optional[List[str]]:
    """The anchor list behind a ramp spec -- a registered name or a colour list."""
    if isinstance(spec, (list, tuple)):
        return [str(c) for c in spec]
    if isinstance(spec, str):
        return COLORMAPS.get(spec.lower())
    return None


def _hex_to_rgb(value: str) -> Tuple[int, int, int]:
    v = value.lstrip("#")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def _ramp(spec: Any) -> np.ndarray:
    """The anchor table as an (n, 3) float array, warning-and-viridis on a bad spec."""
    anchors = _anchors_of(spec)
    if anchors is None:
        if isinstance(spec, dict):
            warn(f"A {{value: colour}} mapping colours categories, but the values are "
                 f"numeric; using the {DEFAULT_COLORMAP!r} ramp.")
        else:
            warn(f"Unknown colormap {spec!r}; using {DEFAULT_COLORMAP!r}. "
                 f"Available: {', '.join(sorted(COLORMAPS))}.")
        anchors = COLORMAPS[DEFAULT_COLORMAP]
    return np.array([_hex_to_rgb(a) for a in anchors], dtype=np.float64)


def _sample(ramp: np.ndarray, t: np.ndarray) -> np.ndarray:
    """(n,) positions in [0, 1] -> (n, 3) interpolated RGB."""
    pos = np.linspace(0.0, 1.0, len(ramp))
    return np.stack([np.interp(t, pos, ramp[:, c]) for c in range(3)], axis=1)


def _is_numeric(values: np.ndarray) -> bool:
    return np.issubdtype(values.dtype, np.number) and not np.issubdtype(
        values.dtype, np.bool_)


def map_colors(
    values: Sequence[Any],
    colormap: Optional[str] = None,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
    bins: Optional[Sequence[float]] = None,
    fallback: str = "#3388ff",
) -> np.ndarray:
    """
    One colour per value, as a (n, 4) uint8 RGBA array.

    Numeric values ramp through a colormap between vmin and vmax (the data's own
    finite extremes when not given), or through `bins` edges into discrete classes.
    Non-numeric values are categories: each distinct value takes a palette colour,
    cycling; naming a sequential colormap instead samples it evenly across the
    categories. Values that are missing (NaN) paint as `fallback`.
    """
    arr = np.asarray(values)
    n = len(arr)
    out = np.empty((n, 4), dtype=np.uint8)
    out[:, 3] = 255
    fb = _hex_to_rgb(fallback)

    if _is_numeric(arr):
        v = arr.astype(np.float64)
        finite = np.isfinite(v)
        ramp = _ramp(colormap or DEFAULT_COLORMAP)
        if bins is not None:
            edges = np.asarray(list(bins), dtype=np.float64)
            classes = len(edges) + 1
            idx = np.digitize(np.where(finite, v, edges[0]), edges)
            t = idx / max(classes - 1, 1)
        else:
            lo = float(vmin) if vmin is not None else (
                float(np.min(v[finite])) if finite.any() else 0.0)
            hi = float(vmax) if vmax is not None else (
                float(np.max(v[finite])) if finite.any() else 1.0)
            span = hi - lo
            t = (np.clip((np.where(finite, v, lo) - lo) / span, 0.0, 1.0)
                 if span > 0 else np.full(n, 0.5))
        out[:, :3] = np.round(_sample(ramp, t)).astype(np.uint8)
        out[~finite, 0], out[~finite, 1], out[~finite, 2] = fb
        return out

    # Categorical: distinct value -> colour, in sorted order for determinism.
    cats, inverse = np.unique(arr.astype(str), return_inverse=True)
    table = _category_assignments(cats, colormap, fallback, quiet=False)
    out[:, :3] = table[inverse]
    return out


def _category_assignments(cats: Sequence[str], colormap: Any, fallback: str,
                          quiet: bool) -> np.ndarray:
    """
    (len(cats), 3) uint8 colours aligned with `cats`. A {value: colour} mapping
    assigns by value -- high stays red wherever it sorts -- and a category the
    mapping does not name takes the fallback, with a warning naming it (once, from
    the buffer mapping; the legend derivation stays quiet). Anything else is a
    palette or a spread ramp through _category_table.
    """
    if isinstance(colormap, dict):
        mapping = {str(k): v for k, v in colormap.items()}
        fb = _hex_to_rgb(fallback)
        rows, missing = [], []
        for cat in cats:
            hexcode = mapping.get(str(cat))
            if hexcode is None:
                missing.append(str(cat))
                rows.append(fb)
            else:
                rows.append(_hex_to_rgb(hexcode))
        if missing and not quiet:
            shown = ", ".join(repr(m) for m in missing[:5])
            more = "..." if len(missing) > 5 else ""
            warn(f"color_col: {len(missing)} categor{'y is' if len(missing) == 1 else 'ies are'} "
                 f"not in the colormap mapping ({shown}{more}); painted with the "
                 f"fallback colour.")
        return np.array(rows, dtype=np.uint8)
    return _category_table(len(cats), colormap, quiet)


def _category_table(count: int, colormap: Any, quiet: bool) -> np.ndarray:
    """
    (count, 3) uint8 colours for that many categories.

    A named sequential map spreads evenly across the categories; a list of colours
    is a palette (the first sorted category takes the first colour, cycling);
    otherwise a categorical palette cycles. Shared by the buffer mapping and the
    legend block so the swatches in the legend are byte-identical to the points on
    the map.
    """
    if isinstance(colormap, (list, tuple)):
        table = np.array([_hex_to_rgb(c) for c in colormap], dtype=np.uint8)
        return table[np.arange(count) % len(table)]
    name = str(colormap).lower() if colormap else DEFAULT_PALETTE
    if name in COLORMAPS and count > 1:
        ramp = _ramp(name)
        return np.round(_sample(ramp, np.linspace(0.0, 1.0, count))).astype(np.uint8)
    palette = CATEGORICAL_PALETTES.get(name)
    if palette is None and colormap is not None and not quiet:
        warn(f"Unknown colormap {colormap!r}; using {DEFAULT_PALETTE!r}. "
             f"Available: {', '.join(sorted(COLORMAPS) + sorted(CATEGORICAL_PALETTES))}.")
    palette = palette or CATEGORICAL_PALETTES[DEFAULT_PALETTE]
    table = np.array([_hex_to_rgb(c) for c in palette], dtype=np.uint8)
    return table[np.arange(count) % len(table)]


def rgb_hex(row: Sequence[int]) -> str:
    """One RGBA row of a map_colors result as the hex string a layer config carries."""
    return "#%02x%02x%02x" % (int(row[0]), int(row[1]), int(row[2]))


def data_driven_colors(props: Optional[dict], opts: dict, fallback: str,
                       method: str) -> Optional[np.ndarray]:
    """(n, 4) u8 colours for a layer's features, or None when not asked for or possible."""
    col = opts.get("color_col")
    if not col:
        return None
    values = (props or {}).get(col)
    if values is None:
        warn(f"{method}: color_col {col!r} is not a column of the parsed data; colours "
             f"unchanged. Columns: {sorted(props) if props else '(none)'}.")
        return None
    return map_colors(values, opts.get("colormap"), opts.get("vmin"),
                      opts.get("vmax"), opts.get("color_bins"), fallback)


def data_driven_radii(props: Optional[dict], opts: dict,
                      method: str) -> Optional[np.ndarray]:
    """(n,) f32 pixel radii for a layer's points, or None when not asked for or possible."""
    col = opts.get("radius_col")
    if not col:
        return None
    values = (props or {}).get(col)
    if values is None:
        warn(f"{method}: radius_col {col!r} is not a column of the parsed data; sizes "
             f"unchanged. Columns: {sorted(props) if props else '(none)'}.")
        return None
    if not _is_numeric(np.asarray(values)):
        # Checked here, not left to np.asarray inside map_radii: the ValueError it
        # raised would escape the add_* chain and discard every layer already added.
        warn(f"{method}: radius_col {col!r} is not numeric; sizes size by value and "
             f"{col!r} holds none. Sizes unchanged.")
        return None
    return map_radii(values, opts.get("radius_range") or (3.0, 18.0))


def _label_num(value: float) -> Any:
    """A ramp endpoint as it should read in a legend: 10, not 10.000000001."""
    return int(value) if float(value) == int(value) else round(float(value), 6)

# Category blocks cap what they store: a legend cannot usefully enumerate a
# track-id column's thousands of values, and the config is JSON.
MAX_LEGEND_CATEGORIES = 50


def bins_block(colormap: Any, edges: Sequence[float]) -> dict:
    """Bin edges plus per-class colours sampled from the colormap, frontend-ready."""
    edges = [float(e) for e in edges]
    classes = len(edges) + 1
    anchors = _anchors_of(colormap) or COLORMAPS[DEFAULT_COLORMAP]
    ramp = np.array([_hex_to_rgb(a) for a in anchors], dtype=np.float64)
    t = np.arange(classes) / max(classes - 1, 1)
    table = np.round(_sample(ramp, t)).astype(np.uint8)
    return {"kind": "bins", "edges": [_label_num(e) for e in edges],
            "colors": [rgb_hex(row) for row in table]}


def data_driven_legend(props: Optional[dict], opts: dict,
                       fallback: str = "#3388ff") -> Optional[dict]:
    """
    The resolved legend block for a color_col mapping, or None.

    Recorded in the layer config at add time, because the buffers alone cannot say
    "viridis over speed 0..30" after the fact. Everything is resolved here -- ramp
    anchors, category colours, bin class colours -- so the frontend renders what it
    is handed and owns no colormap knowledge to drift. Warnings are the colour
    mapping's job, which already ran; this stays quiet.
    """
    col = opts.get("color_col")
    values = (props or {}).get(col) if col else None
    if values is None:
        return None
    arr = np.asarray(values)
    spec = opts.get("colormap")

    if _is_numeric(arr) and not np.issubdtype(arr.dtype, np.bool_):
        v = arr.astype(np.float64)
        finite = np.isfinite(v)
        anchors = _anchors_of(spec) or COLORMAPS[DEFAULT_COLORMAP]
        bins = opts.get("color_bins")
        if bins is not None:
            return {**bins_block(spec, bins), "field": col}
        lo = float(opts["vmin"]) if opts.get("vmin") is not None else (
            float(np.min(v[finite])) if finite.any() else 0.0)
        hi = float(opts["vmax"]) if opts.get("vmax") is not None else (
            float(np.max(v[finite])) if finite.any() else 1.0)
        return {"kind": "ramp", "field": col, "anchors": list(anchors),
                "vmin": _label_num(lo), "vmax": _label_num(hi)}

    cats = [str(c) for c in np.unique(arr.astype(str))]
    table = _category_assignments(cats, spec, fallback, quiet=True)
    colour_of = {c: rgb_hex(table[i]) for i, c in enumerate(cats)}
    # A {value: colour} mapping also states the ORDER the legend should read in
    # (high, medium, low -- not alphabetical) and names EVERY value the data may
    # carry: a declared value the feed has not delivered yet still gets its row, so
    # the legend holds still as the feed fills in. Unmapped values follow, sorted.
    if isinstance(spec, dict):
        order = [str(k) for k in spec]
        for k, v in spec.items():
            colour_of.setdefault(str(k), rgb_hex(_hex_to_rgb(v)))
        declared = set(order)
        order += [c for c in cats if c not in declared]
    else:
        order = cats
    kept = order[:MAX_LEGEND_CATEGORIES]
    items = [{"value": value, "color": colour_of[value]} for value in kept]
    block = {"kind": "categories", "field": col, "items": items}
    if len(order) > len(kept):
        block["truncated"] = int(len(order) - len(kept))
    return block


def size_block(values_lo: float, values_hi: float, field: Optional[str] = None) -> dict:
    """
    A size-key block: the encoding stated, never drawn. Nothing in it derives from
    radius_range or the data's spread, deliberately -- legend CSS pixels are not map
    pixels at any zoom, so sample circles would assert a precision that does not
    exist. The row reads "size <proportional to> field (min - max)": the field and
    its domain, resolved at add time like every other legend block.
    """
    block = {"kind": "sizes",
             "vmin": _label_num(float(values_lo)),
             "vmax": _label_num(float(values_hi))}
    if field:
        block["field"] = field
    return block


def data_driven_size_legend(props: Optional[dict], opts: dict) -> Optional[dict]:
    """The resolved size-key block for a radius_col mapping, or None. Quiet, like
    data_driven_legend: the radius mapping itself already warned about problems."""
    col = opts.get("radius_col")
    values = (props or {}).get(col) if col else None
    if values is None:
        return None
    arr = np.asarray(values)
    if not _is_numeric(arr):
        return None
    v = arr.astype(np.float64)
    finite = np.isfinite(v)
    if not finite.any():
        return None
    return size_block(float(np.min(v[finite])), float(np.max(v[finite])), field=col)


def map_radii(
    values: Sequence[Any],
    radius_range: Tuple[float, float] = (3.0, 18.0),
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
) -> np.ndarray:
    """
    One radius per value, as a (n,) float32 array of pixels.

    Scaled so AREA is proportional to the value (radius grows with its square
    root), which is how a bubble map reads honestly -- a doubled value looks
    doubled, not quadrupled. Missing values take the smallest radius.
    """
    r0, r1 = float(radius_range[0]), float(radius_range[1])
    v = np.asarray(values, dtype=np.float64)
    finite = np.isfinite(v)
    lo = float(vmin) if vmin is not None else (
        float(np.min(v[finite])) if finite.any() else 0.0)
    hi = float(vmax) if vmax is not None else (
        float(np.max(v[finite])) if finite.any() else 1.0)
    span = hi - lo
    t = (np.clip((np.where(finite, v, lo) - lo) / span, 0.0, 1.0)
         if span > 0 else np.full(len(v), 0.5))
    radii = r0 + np.sqrt(t) * (r1 - r0)
    radii[~finite] = r0
    return radii.astype(np.float32)
