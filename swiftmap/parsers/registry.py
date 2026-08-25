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


def _coerce_geometry_input(data: Any) -> Any:
    """
    The bare-geometry front door: forms that state their geometry plainly read
    as naturally as the wrapped ones. A WKT string becomes the one-column table
    the tabular parser already reads; an H3 cell id -- or a list of them --
    becomes the one-column table the H3 tier reads, cells resolved to rings
    before transport; a shapely geometry becomes its __geo_interface__ GeoJSON;
    a list of shapely geometries becomes a FeatureCollection. The JS model
    accepted WKT and GeoJSON first (its addPolygon takes "POLYGON ((...))"
    directly), and the asymmetry was the gap; H3 stays Python-side breadth.
    Everything else passes through untouched.
    """
    if isinstance(data, str):
        text = data.strip()
        if text and not text.startswith(("{", "[")):
            from .sources._utils import wkt_kind, h3_cell_str, h3_module, is_h3_cell, warn_h3_missing
            if wkt_kind(text):
                return {"geometry": [data]}
            if h3_cell_str(text):
                if h3_module() is None:
                    warn_h3_missing("The supplied string")
                elif is_h3_cell(text):
                    return {"h3": [text]}
        return data
    module = type(data).__module__ or ""
    if module.startswith("shapely") and hasattr(data, "__geo_interface__"):
        return data.__geo_interface__
    if isinstance(data, (list, tuple)) and len(data) > 0 and all(
            (type(item).__module__ or "").startswith("shapely")
            and hasattr(item, "__geo_interface__") for item in data):
        return {"type": "FeatureCollection",
                "features": [{"type": "Feature", "geometry": item.__geo_interface__,
                              "properties": {}} for item in data]}
    if isinstance(data, (list, tuple)) and len(data) > 0:
        from .sources._utils import h3_cell_str, h3_module, is_h3_cell, warn_h3_missing
        if all(isinstance(item, str) and h3_cell_str(item) for item in data):
            if h3_module() is None:
                warn_h3_missing("The supplied list")
            elif is_h3_cell(data[0]):
                return {"h3": list(data)}
    return data


class GeometryParserRegistry:
    """Registry broker managing coordinate data parsing strategies for a geometry type."""
    def __init__(self, geometry_name: str = "geometry"):
        self.geometry_name = geometry_name
        self._parsers = []

    def register(self, check_func, parse_func):
        self._parsers.append((check_func, parse_func))

    def parse(self, data: Any, *args, **kwargs):
        data = _coerce_geometry_input(data)
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
        supported = ("GeoJSON, WKT or H3 cell strings, geostructures, GeoPandas, Pandas, "
                     "Polars, or plain coordinate lists and dicts")

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

# Checks for sources whose parsers filter by geometry type: each returns only its own kind
# from a mixed input, so the same object can safely go to all three. Sources opt in from
# their own block below, so everything about a source stays in one place.
mixed_geometry_checks = []


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


def supports_mixed_geometry(data: Any) -> bool:
    """True if `data` comes from a source that distinguishes geometry types when parsing."""
    data = _coerce_geometry_input(data)
    return any(check(data) for check in mixed_geometry_checks)


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
mixed_geometry_checks.append(is_geopandas_dataframe)

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
mixed_geometry_checks.append(is_geostructures)

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
mixed_geometry_checks.append(is_geojson)

# --- Pandas DataFrames ---
from .sources.pandas import (
    is_pandas_dataframe,
    pandas_has_mixed_geometry,
    parse_pandas_points,
    parse_pandas_lines,
    parse_pandas_polygons,
)
points_registry.register(is_pandas_dataframe, parse_pandas_points)
lines_registry.register(is_pandas_dataframe, parse_pandas_lines)
polygons_registry.register(is_pandas_dataframe, parse_pandas_polygons)
mixed_geometry_checks.append(pandas_has_mixed_geometry)

# --- Polars DataFrames ---
from .sources.polars import (
    is_polars_dataframe,
    polars_has_mixed_geometry,
    parse_polars_points,
    parse_polars_lines,
    parse_polars_polygons,
)
points_registry.register(is_polars_dataframe, parse_polars_points)
lines_registry.register(is_polars_dataframe, parse_polars_lines)
polygons_registry.register(is_polars_dataframe, parse_polars_polygons)
mixed_geometry_checks.append(polars_has_mixed_geometry)

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
