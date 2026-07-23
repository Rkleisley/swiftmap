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
):
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
