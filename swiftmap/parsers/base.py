import numpy as np
from typing import Optional, List, Any

def find_column_or_key(keys: List[str], candidates: List[str]) -> Optional[str]:
    """Finds the first key in keys that matches any of the candidates case-insensitively."""
    for c in candidates:
        for k in keys:
            if k.lower() == c.lower():
                return k
    return None

class GeometryParserRegistry:
    """Registry broker managing coordinate data parsing strategies for a geometry type."""
    def __init__(self, geometry_name: str = "geometry"):
        self.geometry_name = geometry_name
        self._parsers = []

    def register(self, check_func, parse_func):
        """Registers a data format check function and a parser strategy function."""
        self._parsers.append((check_func, parse_func))

    def parse(self, data: Any, *args, **kwargs):
        """Finds the matching strategy and parses the data."""
        for check, parse_fn in self._parsers:
            if check(data):
                return parse_fn(data, *args, **kwargs)
        raise TypeError(f"Unsupported data source type for {self.geometry_name}: {type(data)}")

# --- DATA FRAMEWORK CHECKERS ---

def is_geostructures(data: Any) -> bool:
    try:
        from geostructures.typing import GeoShape, CollectionBase
        return isinstance(data, (CollectionBase, GeoShape)) or (
            isinstance(data, list) and all(isinstance(x, GeoShape) for x in data)
        )
    except ImportError:
        return False

def is_geopandas_dataframe(data: Any) -> bool:
    try:
        import geopandas as gpd
        return isinstance(data, (gpd.GeoDataFrame, gpd.GeoSeries))
    except ImportError:
        return False

def is_pandas_dataframe(data: Any) -> bool:
    try:
        import pandas as pd
        return isinstance(data, pd.DataFrame)
    except ImportError:
        return False

def is_polars_dataframe(data: Any) -> bool:
    try:
        import polars as pl
        return isinstance(data, pl.DataFrame)
    except ImportError:
        return False

def is_list_of_dicts(data: Any) -> bool:
    return isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict)

def is_geojson(data: Any) -> bool:
    if isinstance(data, dict):
        t = data.get('type')
        return t in ('FeatureCollection', 'Feature', 'Point', 'LineString', 'Polygon', 'MultiPolygon', 'MultiLineString', 'MultiPoint')
    return False

def is_coordinate_list(data: Any) -> bool:
    return isinstance(data, (list, tuple))

def is_dict(data: Any) -> bool:
    return isinstance(data, dict) and not is_geojson(data)
