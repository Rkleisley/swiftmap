from typing import Optional, List, Dict, Any

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
    
    self.add_child({
        "type": "circle",
        "name": name or "Circle",
        "layer_group": layer_group or "Circle Group",
        "group_multi_select": group_multi_select,
        "visible": True,
        "location": location,
        "radius": radius,
        "properties": properties or {},
        "autobind_popup": bool(popup),
        "autobind_tooltip": bool(tooltip),
        **kwargs
    })
    return self
