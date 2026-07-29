from typing import Optional, List, Dict, Any

def add_polygon(
    self,
    locations: List[List[float]],
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    properties: Optional[Dict[str, Any]] = None,
    **kwargs
) -> "Map":
    """
    Adds a hardware-accelerated WebGL polygon shape layer to the map.

    Parameters
    ----------
    locations : List[List[float]]
        List of [lat, lon] coordinate pairs defining the polygon boundary vertices.
    name : str, optional
        Layer name displayed in sidebar control.
    layer_group : str, optional
        Nested folder path for hierarchical sidebar organization (e.g., "Boundaries/Zones").
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    properties : dict, optional
        Feature attribute metadata dictionary for popups and tooltips.
    **kwargs
        Additional visual attributes:
        - color : str, default '#3388ff' - Polygon border color.
        - fill_color : str, default '#3388ff' - Polygon interior fill color.
        - fill_opacity : float, default 0.2 - Interior fill opacity (0.0 to 1.0).
        - weight : int, default 3 - Border line width in pixels.
        - popup : bool, default True - Enables popups on click.
        - tooltip : bool, default True - Enables tooltips on hover.

    Returns
    -------
    Map
        Self reference for method chaining.

    Examples
    --------
    >>> m = Map()
    >>> m.add_polygon(
    ...     locations=[[36.0, -5.35], [36.05, -5.30], [36.02, -5.25]],
    ...     name="Hazard Zone",
    ...     color="orange",
    ...     fill_opacity=0.4
    ... )
    """
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)
    
    self.add_child({
        "type": "polygon",
        "name": name or "Polygon",
        "layer_group": layer_group or "Polygon Group",
        "group_multi_select": group_multi_select,
        "visible": True,
        "locations": locations,
        "properties": properties or {},
        "autobind_popup": bool(popup),
        "autobind_tooltip": bool(tooltip),
        **kwargs
    })
    return self
