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
from typing import Any, List, Optional, Sequence, Tuple

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


def _hex_to_rgb(value: str) -> Tuple[int, int, int]:
    v = value.lstrip("#")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def _ramp(name: str) -> np.ndarray:
    """The anchor table as an (n, 3) float array, warning-and-viridis on a bad name."""
    anchors = COLORMAPS.get(str(name).lower())
    if anchors is None:
        warn(f"Unknown colormap {name!r}; using {DEFAULT_COLORMAP!r}. "
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
    name = str(colormap).lower() if colormap else DEFAULT_PALETTE
    if name in COLORMAPS and len(cats) > 1:
        ramp = _ramp(name)
        table = np.round(_sample(ramp, np.linspace(0.0, 1.0, len(cats)))).astype(np.uint8)
    else:
        palette = CATEGORICAL_PALETTES.get(name)
        if palette is None and colormap is not None:
            warn(f"Unknown colormap {colormap!r}; using {DEFAULT_PALETTE!r}. "
                 f"Available: {', '.join(sorted(COLORMAPS) + sorted(CATEGORICAL_PALETTES))}.")
        palette = palette or CATEGORICAL_PALETTES[DEFAULT_PALETTE]
        table = np.array([_hex_to_rgb(c) for c in palette], dtype=np.uint8)
        table = table[np.arange(len(cats)) % len(table)]
    out[:, :3] = table[inverse]
    return out


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
    return map_radii(values, opts.get("radius_range") or (3.0, 18.0))


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
