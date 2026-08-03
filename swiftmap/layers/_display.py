from typing import Any, Dict

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


def extract_display_config(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pops popup/tooltip display options out of `kwargs` and returns them as layer metadata.

    Aliases are matched to fields by position, so a length mismatch is rejected here rather
    than silently falling back to raw column names once it reaches the browser.
    """
    config = {key: kwargs.pop(key) for key in DISPLAY_KEYS if key in kwargs}

    for kind in ("popup", "tooltip"):
        names = config.get(f"{kind}_names")
        if names is None:
            continue

        fields = config.get(f"{kind}_fields")
        if fields is None:
            raise ValueError(
                f"{kind}_names requires {kind}_fields. Aliases are matched to fields by "
                f"position, so the fields must be listed explicitly."
            )
        if len(names) != len(fields):
            raise ValueError(
                f"{kind}_names has {len(names)} entries but {kind}_fields has {len(fields)}. "
                f"They are matched by position and must be the same length."
            )

    return config
