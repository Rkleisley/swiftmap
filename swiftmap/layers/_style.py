import difflib
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .._warnings import warn
from ._display import DISPLAY_KEYS

# Canonical style option -> the key the frontend reads. The frontend uses Leaflet's
# camelCase for two of them, so callers may write either spelling.
STYLE_KEYS = {
    "color": "color",
    "fill_color": "fillColor",
    "fill_opacity": "fillOpacity",
    "weight": "weight",
    "opacity": "opacity",
    "radius": "radius",
}

# Spellings accepted for the same option.
ALIASES = {
    "fillColor": "fill_color",
    "fillOpacity": "fill_opacity",
    "fillcolor": "fill_color",
    "fillopacity": "fill_opacity",
}

BEHAVIOUR_OPTIONS = frozenset({"popup", "tooltip", "multi_select", "static_style"})

KNOWN_OPTIONS = (
    frozenset(STYLE_KEYS) | frozenset(ALIASES) | BEHAVIOUR_OPTIONS | frozenset(DISPLAY_KEYS)
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


def pop_style_options(kwargs: Dict[str, Any], method: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Takes the style options out of kwargs, returning (explicit, static_style).

    Called before parsing so styling never reaches a parser: several add_* methods forward
    their remaining kwargs to the parser, and while parsers ignore what they do not know
    today, a parser that later gained a `color` argument would silently misread it.
    """
    static_style = normalize(kwargs.pop("static_style", None))
    explicit = {}
    for key in list(kwargs):
        name = canonical(key)
        if name in STYLE_KEYS:
            explicit[name] = kwargs.pop(key)
    warn_on_misspelled_options(kwargs, method)
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
