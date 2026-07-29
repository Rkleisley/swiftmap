from .base import GeometryParserRegistry
from .points import parse_points
from .lines import parse_lines
from .polygons import parse_polygons

# Aliases for backwards compatibility
_parse_coordinates = parse_points

__all__ = [
    "GeometryParserRegistry",
    "parse_points",
    "parse_lines",
    "parse_polygons",
    "_parse_coordinates",
]
