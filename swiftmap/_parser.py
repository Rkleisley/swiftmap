import numpy as np
from typing import Optional, List, Union, Dict, Any

def _find_column_or_key(keys: List[str], candidates: List[str]) -> Optional[str]:
    """Finds the first key in keys that matches any of the candidates case-insensitively."""
    for c in candidates:
        for k in keys:
            if k.lower() == c.lower():
                return k
    return None

class CoordinateParserRegistry:
    """Registry broker managing coordinate data parsing strategies."""
    def __init__(self):
        self._parsers = []

    def register(self, check_func, parse_func):
        """Registers a check function and a parser strategy function."""
        self._parsers.append((check_func, parse_func))

    def parse(self, data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
        """Finds the matching strategy and parses the data."""
        for check, parse_fn in self._parsers:
            if check(data):
                return parse_fn(data, lat_col, lon_col, intensity_col)
        raise TypeError(f"Unsupported coordinate data source type: {type(data)}")

# --- PARSER STRATEGIES ---

def is_geostructures(data: Any) -> bool:
    try:
        from geostructures.typing import GeoShape, CollectionBase
        return isinstance(data, (CollectionBase, GeoShape)) or (
            isinstance(data, list) and all(isinstance(x, GeoShape) for x in data)
        )
    except ImportError:
        return False

def parse_geostructures(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    try:
        from geostructures.typing import GeoShape, CollectionBase
    except ImportError:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), {}, np.array([], dtype=np.float64)
        
    if isinstance(data, CollectionBase):
        shapes = data.geoshapes
    elif isinstance(data, GeoShape):
        shapes = [data]
    else:
        shapes = data
        
    lats = np.array([shape.centroid.latitude for shape in shapes], dtype=np.float64)
    lons = np.array([shape.centroid.longitude for shape in shapes], dtype=np.float64)
    
    props = {}
    if shapes:
        first_props = getattr(shapes[0], 'properties', {}) or {}
        props = {k: [getattr(s, 'properties', {}).get(k) for s in shapes] for k in first_props.keys()}
        
    intensities = np.array([
        getattr(shape, 'properties', {}).get(intensity_col, 1.0) if (intensity_col and getattr(shape, 'properties', {})) else 1.0 
        for shape in shapes
    ], dtype=np.float64)
    
    return lats, lons, props, intensities


def is_pandas_dataframe(data: Any) -> bool:
    try:
        import pandas as pd
        return isinstance(data, pd.DataFrame)
    except ImportError:
        return False

def parse_pandas_dataframe(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or _find_column_or_key(list(data.columns), lat_candidates)
    actual_lon = lon_col or _find_column_or_key(list(data.columns), lon_candidates)
                
    if not actual_lat or not actual_lon:
        raise ValueError(f"Could not auto-detect lat/lon columns from DataFrame. Columns: {list(data.columns)}")
        
    lats = data[actual_lat].to_numpy().astype(np.float64)
    lons = data[actual_lon].to_numpy().astype(np.float64)
    
    props = {}
    for col in data.columns:
        if col not in (actual_lat, actual_lon):
            props[col] = data[col].to_list()
            
    intensities = np.array(props.get(intensity_col), dtype=np.float64) if (intensity_col and intensity_col in props) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, props, intensities


def is_polars_dataframe(data: Any) -> bool:
    try:
        import polars as pl
        return isinstance(data, pl.DataFrame)
    except ImportError:
        return False

def parse_polars_dataframe(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or _find_column_or_key(list(data.columns), lat_candidates)
    actual_lon = lon_col or _find_column_or_key(list(data.columns), lon_candidates)
                
    if not actual_lat or not actual_lon:
        raise ValueError(f"Could not auto-detect lat/lon columns. Columns: {data.columns}")
        
    lats = data[actual_lat].to_numpy().astype(np.float64)
    lons = data[actual_lon].to_numpy().astype(np.float64)
    
    props = {}
    for col in data.columns:
        if col not in (actual_lat, actual_lon):
            props[col] = data[col].to_list()
            
    intensities = np.array(props.get(intensity_col), dtype=np.float64) if (intensity_col and intensity_col in props) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, props, intensities


def is_list_of_dicts(data: Any) -> bool:
    return isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict)

def parse_list_of_dicts(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or _find_column_or_key(list(data[0].keys()), lat_candidates)
    actual_lon = lon_col or _find_column_or_key(list(data[0].keys()), lon_candidates)
        
    if not actual_lat or not actual_lon:
        raise ValueError(f"Could not auto-detect lat/lon keys from dictionaries. Keys: {list(data[0].keys())}")
        
    lats = np.array([float(item[actual_lat]) for item in data], dtype=np.float64)
    lons = np.array([float(item[actual_lon]) for item in data], dtype=np.float64)
    
    props = {}
    for k in data[0].keys():
        if k not in (actual_lat, actual_lon):
            props[k] = [item[k] for item in data]
            
    intensities = np.array(props.get(intensity_col), dtype=np.float64) if (intensity_col and intensity_col in props) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, props, intensities


def is_geojson(data: Any) -> bool:
    if isinstance(data, dict):
        t = data.get('type')
        return t in ('FeatureCollection', 'Feature', 'Point')
    return False

def parse_geojson(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    features = []
    if data.get('type') == 'FeatureCollection':
        features = data.get('features', [])
    elif data.get('type') == 'Feature':
        features = [data]
    elif data.get('type') == 'Point':
        features = [{'geometry': data, 'properties': {}}]
        
    lats_list = []
    lons_list = []
    props_list = []
    intensities_list = []
    
    for feature in features:
        geom = feature.get('geometry', {})
        if geom.get('type') == 'Point':
            coords = geom.get('coordinates', [])
            if len(coords) >= 2:
                lons_list.append(float(coords[0]))
                lats_list.append(float(coords[1]))
                p = feature.get('properties', {}) or {}
                props_list.append(p)
                intensities_list.append(float(p.get(intensity_col, 1.0)) if intensity_col else 1.0)
                
    lats = np.array(lats_list, dtype=np.float64)
    lons = np.array(lons_list, dtype=np.float64)
    intensities = np.array(intensities_list, dtype=np.float64)
    
    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [x.get(k) for x in props_list]
            
    return lats, lons, props, intensities


def is_coordinate_list(data: Any) -> bool:
    return isinstance(data, (list, tuple))

def parse_coordinate_list(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    if len(data) == 2 and isinstance(data[0], (int, float)) and isinstance(data[1], (int, float)):
        return np.array([float(data[0])]), np.array([float(data[1])]), {}, np.array([1.0])
        
    arr = np.asarray(data, dtype=np.float64)
    if arr.ndim == 1:
        return np.array([arr[0]]), np.array([arr[1]]), {}, np.array([1.0])
        
    lats = arr[:, 0]
    lons = arr[:, 1]
    intensities = arr[:, 2] if (arr.shape[1] >= 3 and intensity_col) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, {}, intensities


def is_dict(data: Any) -> bool:
    return isinstance(data, dict) and not is_geojson(data)

def parse_dict(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or _find_column_or_key(list(data.keys()), lat_candidates)
    actual_lon = lon_col or _find_column_or_key(list(data.keys()), lon_candidates)
        
    if not actual_lat or not actual_lon:
        raise ValueError(f"Could not auto-detect lat/lon keys from dictionary. Keys: {list(data.keys())}")
        
    lats = np.asarray(data[actual_lat], dtype=np.float64)
    lons = np.asarray(data[actual_lon], dtype=np.float64)
    
    props = {}
    for k in data.keys():
        if k not in (actual_lat, actual_lon):
            props[k] = list(data[k])
            
    intensities = np.array(props.get(intensity_col), dtype=np.float64) if (intensity_col and intensity_col in props) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, props, intensities

# --- REGISTRATION ---

_registry = CoordinateParserRegistry()
_registry.register(is_geostructures, parse_geostructures)
_registry.register(is_pandas_dataframe, parse_pandas_dataframe)
_registry.register(is_polars_dataframe, parse_polars_dataframe)
_registry.register(is_list_of_dicts, parse_list_of_dicts)
_registry.register(is_geojson, parse_geojson)
_registry.register(is_dict, parse_dict)
_registry.register(is_coordinate_list, parse_coordinate_list)

# --- PUBLIC FUNCTIONS ---

def _parse_coordinates(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> tuple:
    """
    Public entrypoint for coordinate parsing. Dispatches coordinates parsing to registered strategy.
    Returns (lats: np.ndarray, lons: np.ndarray, props: dict, intensities: np.ndarray).
    """
    return _registry.parse(data, lat_col, lon_col, intensity_col)
