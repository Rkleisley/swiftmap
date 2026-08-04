import warnings
from typing import Any, Dict, Optional

# Popup/tooltip display options forwarded to the frontend as layer metadata.
DISPLAY_KEYS = (
    "popup_fields",
    "popup_names",
    "popup_template",
    "popup_style",
    "popup_max_width",
    "tooltip_fields",
    "tooltip_names",
    "tooltip_template",
    "tooltip_style",
)


def extract_display_config(kwargs: Dict[str, Any], layer_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Pops popup/tooltip display options out of `kwargs` and returns them as layer metadata.

    Aliases are matched to fields by position. If they cannot be lined up -- different
    lengths, or names given without fields -- the aliases are dropped and the raw column
    names are used instead. Mislabelled popups are a better outcome than a failed render,
    so this warns rather than raising.
    """
    config = {key: kwargs.pop(key) for key in DISPLAY_KEYS if key in kwargs}

    for kind in ("popup", "tooltip"):
        names = config.get(f"{kind}_names")
        if names is None:
            continue

        fields = config.get(f"{kind}_fields")
        if fields is not None and len(names) == len(fields):
            continue

        if fields is None:
            detail = f"{kind}_names was given without {kind}_fields"
        else:
            detail = f"{kind}_fields has {len(fields)} entries but {kind}_names has {len(names)}"

        # 4 frames out lands on the caller's add_* line: here -> add_*() -> the @batched
        # wrapper -> user code. Without this the warning blames swiftmap's own decorator.
        warnings.warn(
            f"[SwiftMap] Layer {layer_name or '<unnamed>'} did not have matching fields and "
            f"names for popups or tooltips ({detail}). Defaulting to column names.",
            stacklevel=4,
        )
        config.pop(f"{kind}_names")

    return config
