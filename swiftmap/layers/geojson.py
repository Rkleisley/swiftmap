import json
from typing import Optional, Dict, Any

def add_geojson(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    style: Optional[Dict] = None,
    **kwargs
):
    # Parse GeoJSON inputs cleanly without any legacy dependencies
    if isinstance(data, str):
        try:
            parsed_data = json.loads(data)
        except Exception:
            parsed_data = {"type": "FeatureCollection", "features": []}
    elif isinstance(data, dict) and "type" in data:
        parsed_data = data
    elif hasattr(data, "to_geojson"):
        parsed_data = data.to_geojson()
    else:
        parsed_data = {"type": "FeatureCollection", "features": []}
            
    self.add_child({
        "type": "geojson",
        "name": name or "GeoJSON Layer",
        "layer_group": layer_group or "GeoJSON Group",
        "group_multi_select": group_multi_select,
        "visible": True,
        "geojson": parsed_data,
        "style": style or {},
        **kwargs
    })
    return self
