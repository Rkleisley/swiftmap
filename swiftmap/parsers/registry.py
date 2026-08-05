from typing import Any, Tuple, List, Dict

# =============================================================================
# 1. REGISTRY BROKER CLASS & GLOBAL INSTANCES
# =============================================================================

# Top-level packages swiftmap knows how to parse. Used only to tell "you passed something
# from a library we support, so its import probably failed" apart from "we do not support
# this at all" -- two very different things for the reader to act on.
_SOURCE_PACKAGES = frozenset({
    "pandas", "polars", "geopandas", "shapely", "geostructures",
})


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
        raise TypeError(self._unsupported_message(data))

    def _unsupported_message(self, data: Any) -> str:
        """
        Explains why nothing matched, and what to do about it.

        Every `is_x` check swallows ImportError and returns False, so a library that is
        installed but fails to import for some other reason -- a broken build, a missing
        dependency of its own -- makes its own types report as unsupported. Saying
        "unsupported: <class 'pandas.DataFrame'>" to someone who plainly has pandas is
        baffling, so that case is named separately.
        """
        origin = type(data).__module__.split(".")[0]
        supported = ("GeoJSON, geostructures, GeoPandas, Pandas, Polars, or plain "
                     "coordinate lists and dicts")

        if origin in _SOURCE_PACKAGES:
            return (
                f"Cannot parse {self.geometry_name} from {type(data).__name__}. swiftmap "
                f"supports {origin}, so this is most likely {origin} failing to import -- "
                f"try `import {origin}` directly to see the underlying error."
            )
        return (
            f"Cannot parse {self.geometry_name} from {type(data).__name__}: no registered "
            f"parser handles it. Supported sources are {supported}. To add one, see the "
            f"\"Adding Support for a New Data Source\" section of CONTRIBUTING.md."
        )


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
# mixed input, so the same object can safely be handed to all three.
_MIXED_GEOMETRY_CHECKS = (
    is_geojson,
    is_geostructures,
    is_geopandas_dataframe,
)

from .sources._tabular import find_wkt_column


def supports_mixed_geometry(data: Any) -> bool:
    """
    True if `data` comes from a source that distinguishes geometry types when parsing.

    A DataFrame qualifies only when it carries a WKT geometry column, since WKT states its
    own kind per value and a single column may mix them. Without one, a table is a single
    geometry kind by construction: lat/lon columns fed to all three parsers would yield the
    points plus a line threaded through them and a polygon around them.
    """
    if any(check(data) for check in _MIXED_GEOMETRY_CHECKS):
        return True
    if is_pandas_dataframe(data) or is_polars_dataframe(data):
        return find_wkt_column(data) is not None
    return False
