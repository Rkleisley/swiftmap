from typing import Optional, Any
from ..parsers.points import parse_points

def add_geostructures(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    **kwargs
):
    """
    Convenience wrapper to parse and render geostructures objects or collections
    using Python geometry parsers and standard binary-buffered WebGL layers.
    """
    group_name = layer_group or "Geostructures Group"
    layer_name = name or "Geostructures Layer"

    try:
        lats, lons, props, _ = parse_points(data)
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

    return self
