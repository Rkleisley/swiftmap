from .registry import (
    GeometryParserRegistry,
    parse_points,
    parse_lines,
    parse_polygons,
    points_registry,
    lines_registry,
    polygons_registry,
)

# Geostructures shapes need classifying by geometry kind before parsing, since the
# geostructures parsers do not filter by type the way the GeoJSON ones do.
from .sources.geostructures import (
    is_geostructures,
    split_geostructures_by_geometry,
)

__all__ = [
    "GeometryParserRegistry",
    "parse_points",
    "parse_lines",
    "parse_polygons",
    "points_registry",
    "lines_registry",
    "polygons_registry",
    "is_geostructures",
    "split_geostructures_by_geometry",
]
