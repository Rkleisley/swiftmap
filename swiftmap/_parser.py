"""Backwards compatibility shim pointing to swiftmap.parsers"""
from .parsers import (
    GeometryParserRegistry as CoordinateParserRegistry,
    parse_points as _parse_coordinates,
    parse_points,
    parse_lines,
    parse_polygons,
)
from .parsers.base import (
    find_column_or_key as _find_column_or_key,
    is_geostructures,
    is_pandas_dataframe,
    is_polars_dataframe,
    is_list_of_dicts,
    is_geojson,
    is_coordinate_list,
    is_dict,
)

__all__ = [
    "CoordinateParserRegistry",
    "_parse_coordinates",
    "parse_points",
    "parse_lines",
    "parse_polygons",
]
