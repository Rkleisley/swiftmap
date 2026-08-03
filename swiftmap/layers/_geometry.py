from typing import Any, Optional
from ..parsers import parse_points, parse_lines, parse_polygons


def add_parsed_geometries(
    map_obj: Any,
    point_data: Any,
    line_data: Any,
    polygon_data: Any,
    name: Optional[str],
    layer_group: str,
    group_multi_select: Optional[bool],
    **kwargs
) -> Any:
    """
    Parses point, line, and polygon geometries and adds a layer for each kind that yields features.

    The three datasets are supplied separately because sources differ in how geometry kinds get
    separated. GeoJSON parsers filter on feature type internally, so the same object is passed
    three times and each parser returns only its own geometries. Geostructures shapes carry no
    such filter in the parsers, so they are classified by type up front and each parser receives
    only shapes of its own kind. Pass None for a kind to skip it entirely.
    """
    if point_data is not None:
        lats, lons, props, _ = parse_points(point_data)
        if len(lats) > 0:
            map_obj.add_markers(
                data={"lat": lats, "lon": lons, **props},
                name=name,
                layer_group=layer_group,
                group_multi_select=group_multi_select,
                **kwargs
            )

    if line_data is not None:
        lines, _ = parse_lines(line_data)
        if len(lines) > 0:
            map_obj.add_polyline(
                data=lines,
                name=name,
                layer_group=layer_group,
                group_multi_select=group_multi_select,
                **kwargs
            )

    if polygon_data is not None:
        polygons, _ = parse_polygons(polygon_data)
        if len(polygons) > 0:
            map_obj.add_polygon(
                data=polygons,
                name=name,
                layer_group=layer_group,
                group_multi_select=group_multi_select,
                **kwargs
            )

    return map_obj
