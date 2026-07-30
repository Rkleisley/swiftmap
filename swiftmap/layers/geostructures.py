from typing import Optional, Any
from ..parsers.points import parse_points
from ..parsers.lines import parse_lines
from ..parsers.polygons import parse_polygons

def add_geostructures(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    **kwargs
) -> "Map":
    """
    Convenience wrapper to parse and render geostructures objects, shapes, tracks, or collections
    using Python geometry parsers and high-performance WebGL binary-buffered layers.

    Parameters
    ----------
    data : Any
        `geostructures` object (`GeoPoint`, `GeoLine`, `GeoPolygon`, `GeoBox`, `Track`, `CollectionBase`) or list of shapes.
    name : str, optional
        Layer name displayed in sidebar controls.
    layer_group : str, optional
        Nested folder path in sidebar controls (e.g. "Tracks/Active").
    group_multi_select : bool, optional
        If False, configures parent folder controls as mutually exclusive radio buttons.
    **kwargs
        Additional visual styling options passed to sub-layer builders.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    group_name = layer_group or "Geostructures Group"
    layer_name = name or "Geostructures Layer"

    # 1. Parse point geometries
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

    # 2. Parse line geometries
    try:
        lines, line_props = parse_lines(data)
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
        polygons, poly_props = parse_polygons(data)
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
