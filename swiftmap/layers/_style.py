import difflib
from typing import Any, Dict, Iterable, List, NamedTuple, Optional, Tuple

from .._warnings import warn
from ._display import DISPLAY_KEYS

# Layer types, grouped by what styling means for them.
POINTS = frozenset({"circle_markers", "markers"})
LINES = frozenset({"polyline"})
AREAS = frozenset({"polygon", "circle"})
GEOMETRY = POINTS | LINES | AREAS
NOTHING = frozenset()


class StyleKey(NamedTuple):
    """
    One style option, and where it is meaningful versus where it is actually drawn.

    `applies_to` is semantic -- a fill colour means something for an area and nothing for a
    line, whatever any renderer does. `renders_on` is the subset the renderer draws today,
    and is always a subset of `applies_to`.

    Keeping them apart is what lets a warning tell the truth about three different
    situations that otherwise look identical to the caller, because every one of them ends
    in a map that ignored what they asked for:

      - the option does not exist         -> probably a typo
      - it exists but not for this shape  -> wrong option for the job
      - it exists, fits, and is not drawn -> a gap in swiftmap, not a mistake

    A capability landing later is then one edit here plus the renderer work, with no change
    to any signature: an option can be named and accepted before it can be drawn.
    """
    frontend: str
    applies_to: frozenset
    renders_on: frozenset
    note: str = ""


# The vocabulary. `renders_on` was read out of src/layers.js rather than assumed -- see
# tests/test_style_registry.py, which pins each entry against what the renderer
# actually consumes so this table cannot quietly drift from the code it describes.
STYLE_REGISTRY = {
    "color": StyleKey("color", GEOMETRY, GEOMETRY),
    "fill_color": StyleKey("fillColor", AREAS, AREAS),
    "fill_opacity": StyleKey("fillOpacity", AREAS, AREAS),
    "opacity": StyleKey(
        "opacity", GEOMETRY, LINES | AREAS,
        note="point layers take their alpha from the colour itself, e.g. rgba() or #rrggbbaa"),
    "weight": StyleKey("weight", LINES | AREAS, LINES | AREAS),
    "radius": StyleKey(
        "radius", POINTS | {"circle"}, POINTS | {"circle"},
        note="pixels for point layers, metres for `circle`"),
}

# Canonical style option -> the key the frontend reads. The frontend uses Leaflet's
# camelCase for two of them, so callers may write either spelling.
STYLE_KEYS = {name: spec.frontend for name, spec in STYLE_REGISTRY.items()}

# Spellings accepted for the same option.
ALIASES = {
    "fillColor": "fill_color",
    "fillOpacity": "fill_opacity",
    "fillcolor": "fill_color",
    "fillopacity": "fill_opacity",
}

BEHAVIOUR_OPTIONS = frozenset({"popup", "tooltip", "multi_select", "static_style"})

# Data-driven styling: a column drives the option per feature, through a colormap or a
# radius range. Universal kwargs like every other style option -- popped centrally and
# warned about honestly per geometry -- never per-builder signature parameters.
DATA_OPTIONS = ("color_col", "colormap", "vmin", "vmax", "color_bins",
                "radius_col", "radius_range")

KNOWN_OPTIONS = (
    frozenset(STYLE_KEYS) | frozenset(ALIASES) | BEHAVIOUR_OPTIONS | frozenset(DISPLAY_KEYS)
    | frozenset(DATA_OPTIONS)
)

# The property auto-detected as per-feature styling. Only this exact name is claimed: a
# column called "color" may well be data rather than styling, and guessing wrong would
# silently restyle someone's map. Any other column is opted in explicitly, the same way
# `name="site"` opts a column in as the layer name.
STYLE_PROPERTY = "style"


def canonical(key: str) -> str:
    return ALIASES.get(key, key)


def normalize(style: Any) -> Dict[str, Any]:
    """
    Coerces one style value into a dict of canonical options.

    A bare string is treated as a color, since "make these red" is the common case and
    writing {"color": "red"} for every row is noise.
    """
    if style is None:
        return {}
    if isinstance(style, str):
        return {"color": style}
    if isinstance(style, dict):
        return {canonical(k): v for k, v in style.items() if canonical(k) in STYLE_KEYS}
    return {}


def warn_on_misspelled_options(kwargs: Dict[str, Any], method: str,
                               known: Iterable[str] = KNOWN_OPTIONS) -> None:
    """
    Flags an option that looks like a misspelling of a real one.

    Unknown keys are not rejected: whatever remains in kwargs is forwarded to the layer on
    purpose, which is how callers pass their own metadata to the frontend. So only near
    misses are reported -- `colour` is one edit from `color` and almost certainly a
    mistake, while `title` matches nothing and passes silently.

    Without this, a misspelled style is accepted, ignored by the renderer, and renders in
    the default color: wrong output with no signal.
    """
    known = list(known)
    for key in kwargs:
        if key in known:
            continue
        close = difflib.get_close_matches(key, known, n=1, cutoff=0.8)
        if close:
            warn(
                f"{method} received unknown option {key!r} -- did you mean {close[0]!r}? "
                f"It was passed to the layer unchanged, so the renderer will ignore it."
            )


def warn_on_undrawn_options(styles: Iterable[str], method: str, layer_type: Optional[str]) -> None:
    """
    Flags a real style option that this layer type will not draw.

    Both cases end the same way for the caller -- a map that ignored what they asked for --
    but they need different responses, so they are reported differently. An option that does
    not apply to the shape is the wrong tool. An option that applies and is simply not drawn
    yet is a gap in swiftmap, and the caller has nothing to fix.

    Nothing is rejected. `radius` was accepted, validated and discarded by the renderer for
    the whole life of the project without a word; saying so is the entire point.
    """
    if not layer_type:
        return
    for name in styles:
        spec = STYLE_REGISTRY.get(name)
        if spec is None or layer_type in spec.renders_on:
            continue
        detail = f" ({spec.note})" if spec.note else ""
        if layer_type not in spec.applies_to:
            warn(f"{method}: {name!r} does not apply to {layer_type} layers{detail}. "
                 f"It was accepted but will not change how the layer draws.")
        else:
            warn(f"{method}: {name!r} is not drawn for {layer_type} layers yet{detail}. "
                 f"It was accepted but will not change how the layer draws.")


def pop_data_options(kwargs: Dict[str, Any], method: str,
                     layer_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Takes the data-driven styling options out of kwargs, same contract as
    pop_style_options: popped before any parser sees kwargs, honest per-geometry
    warnings, nothing rejected. Returns a dict holding every DATA_OPTIONS key.

    `color_col` colours features from a column (any geometry with features);
    `radius_col` sizes points -- lines size with `weight`, so it warns there.
    `vmin`/`vmax`/`color_bins`/`colormap` shape the colour ramp only.
    """
    opts = {name: kwargs.pop(name, None) for name in DATA_OPTIONS}
    if opts["radius_range"] is None:
        opts["radius_range"] = (3.0, 18.0)
    if layer_type:
        if opts["color_col"] and layer_type == "circle":
            warn(f"{method}: 'color_col' does not apply to a circle -- it colours "
                 f"features from a column, and a circle is a single feature. "
                 f"It was accepted but will not change how the layer draws.")
        if opts["radius_col"] and layer_type not in POINTS:
            warn(f"{method}: 'radius_col' does not apply to {layer_type} layers -- "
                 f"points size by radius, lines by `weight`. It was accepted but "
                 f"will not change how the layer draws.")
        if not opts["color_col"]:
            stray = [n for n in ("colormap", "vmin", "vmax", "color_bins")
                     if opts[n] is not None]
            if stray:
                warn(f"{method}: {', '.join(repr(n) for n in stray)} shape the colour "
                     f"ramp and do nothing without 'color_col'.")
    return opts


def pop_style_options(kwargs: Dict[str, Any], method: str,
                      layer_type: Optional[str] = None) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Takes the style options out of kwargs, returning (explicit, static_style).

    Called before parsing so styling never reaches a parser: several add_* methods forward
    their remaining kwargs to the parser, and while parsers ignore what they do not know
    today, a parser that later gained a `color` argument would silently misread it.

    `layer_type` enables the capability warnings. It is optional so a caller that has no
    single type -- add_collection fans one call out to three -- can leave them to the
    per-geometry builders it delegates to, which do know.
    """
    static_style = normalize(kwargs.pop("static_style", None))
    explicit = {}
    for key in list(kwargs):
        name = canonical(key)
        if name in STYLE_KEYS:
            explicit[name] = kwargs.pop(key)
    warn_on_misspelled_options(kwargs, method)
    warn_on_undrawn_options({**explicit, **static_style}, method, layer_type)
    return explicit, static_style


def resolve_styles(
    explicit: Dict[str, Any],
    static_style: Dict[str, Any],
    props: Dict[str, List[Any]],
    count: int,
    defaults: Dict[str, Any],
) -> Tuple[Dict[str, Any], Optional[List[Dict[str, Any]]]]:
    """
    Works out the style for a layer and, where they differ, for each feature in it.

    Precedence, highest first:
      1. `static_style={...}`  -- one style for the whole layer, ignoring the data
      2. explicit options      -- `color="red"`, `weight=5`
      3. a `style` property    -- per feature, from the data
      4. the layer type's defaults

    Returns `(layer_style, feature_styles)` in frontend key names. `feature_styles` is None
    when every feature resolves the same, so the common case adds nothing to the payload.
    Keeping per-feature styling in its own field rather than inside `properties` also means
    a future restyle -- highlighting a selected row, say -- can patch just this field
    instead of resending a layer's whole property set.
    """
    base = {**defaults, **explicit, **static_style}
    layer_style = {STYLE_KEYS[k]: v for k, v in base.items() if k in STYLE_KEYS}

    # static_style deliberately overrides the data, so per-feature resolution is skipped.
    per_feature = props.get(STYLE_PROPERTY) if props else None
    if static_style or not per_feature:
        return layer_style, None

    feature_styles = []
    for i in range(count):
        raw = per_feature[i] if i < len(per_feature) else None
        # Explicit options still outrank the data, so they are applied last.
        merged = {**defaults, **normalize(raw), **explicit}
        feature_styles.append({STYLE_KEYS[k]: v for k, v in merged.items() if k in STYLE_KEYS})

    # A style column that happens to hold one value everywhere is still a uniform layer.
    # Comparing the features to each other rather than to the defaults keeps that case on
    # the layer-level path, so it costs nothing extra on the wire.
    if not feature_styles:
        return layer_style, None
    first = feature_styles[0]
    if all(style == first for style in feature_styles):
        return {**layer_style, **first}, None

    return layer_style, feature_styles
