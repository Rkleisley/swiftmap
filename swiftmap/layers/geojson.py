import json
from typing import Optional, Dict, Any
from ..parsers.points import parse_points

def add_geojson(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    style: Optional[Dict] = None,
    **kwargs
):
    """
    Convenience wrapper to parse and render GeoJSON features using Python geometry parsers
    and standard binary-buffered WebGL layers.
    """
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
            
    group_name = layer_group or "GeoJSON Group"
    layer_name = name or "GeoJSON Layer"

    # 1. Parse point geometries
    try:
        lats, lons, props, _ = parse_points(parsed_data)
        if len(lats) > 0:
            point_data = {"lat": lats, "lon": lons, **props}
            self.add_markers(
                data=point_data,
                name=layer_name,
                layer_group=group_name,
                group_multi_select=group_multi_select,
                **kwargs
            )
    except Exception:
        pass

    # 2. Lines & Polygons dispatching will be added here once parse_lines and parse_polygons are built.

    return self
