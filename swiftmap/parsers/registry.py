from typing import Any, Tuple, List, Dict

# =============================================================================
# 1. REGISTRY BROKER CLASS & GLOBAL INSTANCES
# =============================================================================

class GeometryParserRegistry:
    """Registry broker managing coordinate data parsing strategies for a geometry type."""
    def __init__(self, geometry_name: str = "geometry"):
        self.geometry_name = geometry_name
        self._parsers = []

    def register(self, check_func, parse_func):
        self._parsers.append((check_func, parse_func))

    def parse(self, data: Any, *args, **kwargs):
        for check, parse_fn in self._parsers:
            if check(data):
                return parse_fn(data, *args, **kwargs)
        raise TypeError(f"Unsupported data source type for {self.geometry_name}: {type(data)}")


points_registry = GeometryParserRegistry("points")
lines_registry = GeometryParserRegistry("lines")
polygons_registry = GeometryParserRegistry("polygons")


# =============================================================================
# 2. PUBLIC DISPATCH API
# =============================================================================

def parse_points(data: Any, *args, **kwargs) -> Tuple:
    """Public entrypoint for point coordinate parsing."""
    return points_registry.parse(data, *args, **kwargs)


def parse_lines(data: Any, *args, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Public entrypoint for polyline data parsing."""
    return lines_registry.parse(data, *args, **kwargs)


def parse_polygons(data: Any, *args, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Public entrypoint for polygon data parsing."""
    return polygons_registry.parse(data, *args, **kwargs)


# =============================================================================
# 3. SOURCE STRATEGY REGISTRATIONS (Add new data sources at the bottom)
# =============================================================================

# --- GeoPandas ---
from .sources.geopandas import (
    is_geopandas_dataframe,
    parse_geopandas_points,
    parse_geopandas_lines,
    parse_geopandas_polygons,
)
points_registry.register(is_geopandas_dataframe, parse_geopandas_points)
lines_registry.register(is_geopandas_dataframe, parse_geopandas_lines)
polygons_registry.register(is_geopandas_dataframe, parse_geopandas_polygons)

# --- GeoStructures ---
from .sources.geostructures import (
    is_geostructures,
    parse_geostructures_points,
    parse_geostructures_lines,
    parse_geostructures_polygons,
)
points_registry.register(is_geostructures, parse_geostructures_points)
lines_registry.register(is_geostructures, parse_geostructures_lines)
polygons_registry.register(is_geostructures, parse_geostructures_polygons)

# --- GeoJSON ---
from .sources.geojson import (
    is_geojson,
    parse_geojson_points,
    parse_geojson_lines,
    parse_geojson_polygons,
)
points_registry.register(is_geojson, parse_geojson_points)
lines_registry.register(is_geojson, parse_geojson_lines)
polygons_registry.register(is_geojson, parse_geojson_polygons)

# --- Pandas DataFrames ---
from .sources.pandas import (
    is_pandas_dataframe,
    parse_pandas_points,
    parse_pandas_lines,
    parse_pandas_polygons,
)
points_registry.register(is_pandas_dataframe, parse_pandas_points)
lines_registry.register(is_pandas_dataframe, parse_pandas_lines)
polygons_registry.register(is_pandas_dataframe, parse_pandas_polygons)

# --- Polars DataFrames ---
from .sources.polars import (
    is_polars_dataframe,
    parse_polars_points,
    parse_polars_lines,
    parse_polars_polygons,
)
points_registry.register(is_polars_dataframe, parse_polars_points)
lines_registry.register(is_polars_dataframe, parse_polars_lines)
polygons_registry.register(is_polars_dataframe, parse_polars_polygons)

# --- Raw Lists, Dicts, and Coordinates ---
from .sources.lists_dicts import (
    is_list_of_dicts,
    is_dict,
    is_coordinate_list,
    parse_list_of_dicts_points,
    parse_dict_points,
    parse_dict_lines,
    parse_list_of_dicts_lines,
    parse_dict_polygons,
    parse_list_of_dicts_polygons,
    parse_coordinate_list_points,
    parse_coordinate_list_lines,
    parse_coordinate_list_polygons,
)
points_registry.register(is_list_of_dicts, parse_list_of_dicts_points)
points_registry.register(is_dict, parse_dict_points)
points_registry.register(is_coordinate_list, parse_coordinate_list_points)

lines_registry.register(is_dict, parse_dict_lines)
lines_registry.register(is_list_of_dicts, parse_list_of_dicts_lines)
lines_registry.register(is_coordinate_list, parse_coordinate_list_lines)

polygons_registry.register(is_dict, parse_dict_polygons)
polygons_registry.register(is_list_of_dicts, parse_list_of_dicts_polygons)
polygons_registry.register(is_coordinate_list, parse_coordinate_list_polygons)


# =============================================================================
# 4. SOURCE CAPABILITIES
# =============================================================================

# Sources whose parsers filter by geometry type: each returns only its own kind from a
# mixed input, so the same object can safely be handed to all three. The tabular parsers
# do not -- they coerce whatever they are given, which is correct when the caller asked
# for a specific kind and wrong when all three are speculative.
_MIXED_GEOMETRY_CHECKS = (
    is_geojson,
    is_geostructures,
    is_geopandas_dataframe,
)


def supports_mixed_geometry(data: Any) -> bool:
    """True if `data` comes from a source that distinguishes geometry types when parsing."""
    return any(check(data) for check in _MIXED_GEOMETRY_CHECKS)
