import json
from typing import Optional, Dict, Any
from ..parsers.points import parse_points
from ..parsers.lines import parse_lines
from ..parsers.polygons import parse_polygons

def add_geojson(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    style: Optional[Dict] = None,
    **kwargs
) -> "Map":
    """
    Convenience wrapper to parse and render GeoJSON features (FeatureCollections, Features, Geometries)
    using Python geometry parsers and high-performance WebGL binary-buffered layers.

    Parameters
    ----------
    data : Any
        GeoJSON dictionary, JSON string, or object with a `.to_geojson()` method.
    name : str, optional
        Layer name displayed in sidebar controls.
    layer_group : str, optional
        Nested folder path in sidebar controls (e.g. "GIS Feeds/Boundaries").
    group_multi_select : bool, optional
        If False, configures parent folder controls as mutually exclusive radio buttons.
    style : dict, optional
        Optional style overrides dictionary.
    **kwargs
        Additional visual styling options passed to sub-layer builders.

    Returns
    -------
    Map
        Self reference for method chaining.
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

    # 2. Parse line geometries
    try:
        lines, line_props = parse_lines(parsed_data)
        if len(lines) > 0:
            self.add_polyline(
                data=lines,
                name=layer_name,
                layer_group=group_name,
                group_multi_select=group_multi_select,
                **kwargs
            )
    except Exception:
        pass

    # 3. Parse polygon geometries
    try:
        polygons, poly_props = parse_polygons(parsed_data)
        if len(polygons) > 0:
            self.add_polygon(
                data=polygons,
                name=layer_name,
                layer_group=group_name,
                group_multi_select=group_multi_select,
                **kwargs
            )
    except Exception:
        pass

    return self
