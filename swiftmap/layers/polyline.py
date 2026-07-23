from typing import Optional, List

def add_polyline(
    self,
    locations: List[List[float]],
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    **kwargs
):
    self.add_child({
        "type": "polyline",
        "name": name or "Polyline",
        "layer_group": layer_group or "Polyline Group",
        "group_multi_select": group_multi_select,
        "visible": True,
        "locations": locations,
        **kwargs
    })
    return self
