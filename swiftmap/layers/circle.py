from typing import Optional, List, Dict, Any
from ._display import extract_display_config
from ._style import pop_style_options, resolve_styles
from ._batching import batched

@batched
def add_circle(
    self,
    location: List[float],
    radius: float,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    properties: Optional[Dict[str, Any]] = None,
    **kwargs
) -> "Map":
    """
    Adds a geodesic circle shape layer specified by a center point and physical radius in meters.

    Parameters
    ----------
    location : List[float]
        Center point coordinates `[latitude, longitude]`.
    radius : float
        Circle radius in physical meters.
    name : str, optional
        Layer name displayed in sidebar control.
    layer_group : str, optional
        Nested folder path for hierarchical sidebar organization (e.g., "Buffers/Ranges").
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    properties : dict, optional
        Feature attribute metadata dictionary for popups and tooltips.
    **kwargs
        Additional visual attributes:
        - color : str, default '#3388ff' - Circle border stroke color.
        - fill_color : str, default '#3388ff' - Circle interior fill color.
        - fill_opacity : float, default 0.2 - Interior fill opacity (0.0 to 1.0).
        - popup : bool, default True - Enables popups on click.
        - tooltip : bool, default True - Enables tooltips on hover.
        - popup_fields / tooltip_fields : list of str - Property names to display.
          Defaults to every property.
        - popup_names / tooltip_names : list of str - Display labels for those fields,
          matched by position (e.g. fields=["pop_2020"], names=["Population"]).
          If they cannot be lined up, a warning is issued and the raw column
          names are used.
        - popup_template / tooltip_template : str - HTML template. `{column}` inserts one
          value, `{*}` inserts the default field list. Data values are HTML-escaped; your
          markup is not (e.g. "<img src='{photo}' width=300><br>{*}").
        - popup_style / tooltip_style : str - Inline CSS for the content container.
        - popup_max_width : int - Popup width in pixels (Leaflet default 300).

    Returns
    -------
    Map
        Self reference for method chaining.

    Examples
    --------
    >>> m = Map()
    >>> m.add_circle(location=[36.0, -5.35], radius=1500, name="Search Area", color="red")
    """
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)
    display_config = extract_display_config(kwargs, name)
    explicit_style, static_style = pop_style_options(kwargs, "add_circle", "circle")
    layer_style, _ = resolve_styles(
        explicit_style, static_style, {}, 1,
        {"color": "#3388ff", "fill_color": "#3388ff", "fill_opacity": 0.2})

    self.add_child({
        "type": "circle",
        "name": name or "Circle",
        "layer_group": layer_group or "Circle Group",
        "group_multi_select": group_multi_select,
        "visible": True,
        "location": location,
        "radius": radius,
        **layer_style,
        "properties": properties or {},
        "autobind_popup": bool(popup),
        "autobind_tooltip": bool(tooltip),
        **display_config,
        **kwargs
    })
    return self
