from typing import Optional, List, Dict, Any

def add_polygon(
    self,
    locations: List[List[float]],
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    properties: Optional[Dict[str, Any]] = None,
    **kwargs
):
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
