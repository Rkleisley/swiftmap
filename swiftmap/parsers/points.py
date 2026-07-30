import numpy as np
from typing import Optional, Any, Tuple
from .base import (
    GeometryParserRegistry,
    find_column_or_key,
    is_geopandas_dataframe,
    is_geostructures,
    is_pandas_dataframe,
    is_polars_dataframe,
    is_list_of_dicts,
    is_geojson,
    is_coordinate_list,
    is_dict,
)

def parse_geopandas_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    """Parses GeoPandas GeoDataFrame/GeoSeries containing Point / MultiPoint geometries."""
    try:
        import geopandas as gpd
        from shapely.geometry import Point, MultiPoint
    except ImportError:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), {}, np.array([], dtype=np.float64)

    if isinstance(data, gpd.GeoSeries):
        gdf = gpd.GeoDataFrame(geometry=data)
    else:
        gdf = data

    geom_col = gdf.geometry.name
    non_geom_cols = [c for c in gdf.columns if c != geom_col]

    lats_list = []
    lons_list = []
    props_list = []
    intensities_list = []

    for _, row in gdf.iterrows():
        geom = row[geom_col]
        if geom is None or geom.is_empty:
            continue

        row_props = {col: row[col] for col in non_geom_cols}
        intensity_val = float(row_props.get(intensity_col, 1.0)) if intensity_col else 1.0

        if isinstance(geom, Point):
            lats_list.append(float(geom.y))
            lons_list.append(float(geom.x))
            props_list.append(row_props)
            intensities_list.append(intensity_val)
        elif isinstance(geom, MultiPoint):
            for pt in geom.geoms:
                lats_list.append(float(pt.y))
                lons_list.append(float(pt.x))
                props_list.append(row_props)
                intensities_list.append(intensity_val)

    lats = np.array(lats_list, dtype=np.float64)
    lons = np.array(lons_list, dtype=np.float64)
    intensities = np.array(intensities_list, dtype=np.float64)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]

    return lats, lons, props, intensities


def parse_geostructures_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    shapes = []
    if isinstance(data, (list, tuple)):
        shapes = list(data)
    elif hasattr(data, "__iter__") and not isinstance(data, (str, bytes, dict)):
        shapes = list(data)
    else:
        shapes = [data]
        
    valid_shapes = [s for s in shapes if hasattr(s, "centroid")]
    lats = np.array([s.centroid.latitude for s in valid_shapes], dtype=np.float64)
    lons = np.array([s.centroid.longitude for s in valid_shapes], dtype=np.float64)
    
    props = {}
    if valid_shapes:
        first_props = getattr(valid_shapes[0], 'properties', {}) or {}
        props = {k: [getattr(s, 'properties', {}).get(k) for s in valid_shapes] for k in first_props.keys()}
        
    intensities = np.array([
        getattr(s, 'properties', {}).get(intensity_col, 1.0) if (intensity_col and getattr(s, 'properties', {})) else 1.0 
        for s in valid_shapes
    ], dtype=np.float64)
    
    return lats, lons, props, intensities


def parse_pandas_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or find_column_or_key(list(data.columns), lat_candidates)
    actual_lon = lon_col or find_column_or_key(list(data.columns), lon_candidates)
                
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


def parse_polars_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or find_column_or_key(list(data.columns), lat_candidates)
    actual_lon = lon_col or find_column_or_key(list(data.columns), lon_candidates)
                
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


def parse_list_of_dicts_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or find_column_or_key(list(data[0].keys()), lat_candidates)
    actual_lon = lon_col or find_column_or_key(list(data[0].keys()), lon_candidates)
        
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


def parse_geojson_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
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


def parse_coordinate_list_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    if len(data) == 2 and isinstance(data[0], (int, float)) and isinstance(data[1], (int, float)):
        return np.array([float(data[0])]), np.array([float(data[1])]), {}, np.array([1.0])
        
    arr = np.asarray(data, dtype=np.float64)
    if arr.ndim == 1:
        return np.array([arr[0]]), np.array([arr[1]]), {}, np.array([1.0])
        
    lats = arr[:, 0]
    lons = arr[:, 1]
    intensities = arr[:, 2] if (arr.shape[1] >= 3 and intensity_col) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, {}, intensities


def parse_dict_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    
    actual_lat = lat_col or find_column_or_key(list(data.keys()), lat_candidates)
    actual_lon = lon_col or find_column_or_key(list(data.keys()), lon_candidates)
        
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
points_registry = GeometryParserRegistry("points")
points_registry.register(is_geopandas_dataframe, parse_geopandas_points)
points_registry.register(is_geostructures, parse_geostructures_points)
points_registry.register(is_pandas_dataframe, parse_pandas_points)
points_registry.register(is_polars_dataframe, parse_polars_points)
points_registry.register(is_list_of_dicts, parse_list_of_dicts_points)
points_registry.register(is_geojson, parse_geojson_points)
points_registry.register(is_dict, parse_dict_points)
points_registry.register(is_coordinate_list, parse_coordinate_list_points)

def parse_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    """
    Public entrypoint for point coordinate parsing.
    Returns (lats: np.ndarray, lons: np.ndarray, props: dict, intensities: np.ndarray).
    """
    return points_registry.parse(data, lat_col, lon_col, intensity_col)
