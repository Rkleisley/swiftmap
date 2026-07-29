import re
import numpy as np
from typing import Optional, List, Dict, Any, Tuple
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

FLOAT_REGEX = re.compile(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?')

def _parse_coord_string(val: str, coord_order: str = "auto") -> List[List[float]]:
    """
    Parses string-formatted line coordinates (WKT LINESTRING or delimited pair strings).
    Respects coord_order ('auto', 'lat_lon', 'lon_lat').
    """
    if not val or not isinstance(val, str):
        return []

    val_upper = val.strip().upper()

    # 1. WKT Format (LINESTRING / MULTILINESTRING) -> GIS Standard (lon, lat)
    if val_upper.startswith("LINESTRING") or val_upper.startswith("MULTILINESTRING"):
        nums = [float(n) for n in FLOAT_REGEX.findall(val)]
        coords = []
        for i in range(0, len(nums) - 1, 2):
            lon, lat = nums[i], nums[i+1]
            coords.append([lat, lon])
        return coords

    # 2. Delimited text format (e.g. "34.05, -118.24; 34.06, -118.25" or "34.05 -118.24, 34.06 -118.25")
    nums = [float(n) for n in FLOAT_REGEX.findall(val)]
    if len(nums) < 4:  # Need at least 2 points (4 numbers) for a line
        return []

    pairs = []
    for i in range(0, len(nums) - 1, 2):
        n1, n2 = nums[i], nums[i+1]

        if coord_order == "lon_lat":
            pairs.append([n2, n1])
        elif coord_order == "lat_lon":
            pairs.append([n1, n2])
        else:
            # "auto" range-based heuristic: lat [-90, 90], lon [-180, 180]
            if abs(n1) > 90 and abs(n2) <= 90:
                # n1 is longitude, n2 is latitude -> (lon, lat) order
                pairs.append([n2, n1])
            elif abs(n2) > 90 and abs(n1) <= 90:
                # n2 is longitude, n1 is latitude -> (lat, lon) order
                pairs.append([n1, n2])
            else:
                # Default fallback: (lat, lon)
                pairs.append([n1, n2])

    return pairs


def parse_geopandas_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses GeoPandas GeoDataFrame/GeoSeries containing LineString / MultiLineString geometries."""
    try:
        import geopandas as gpd
        from shapely.geometry import LineString, MultiLineString
    except ImportError:
        return [], {}

    lines = []
    props_list = []

    if isinstance(data, gpd.GeoSeries):
        gdf = gpd.GeoDataFrame(geometry=data)
    else:
        gdf = data

    geom_col = gdf.geometry.name
    non_geom_cols = [c for c in gdf.columns if c != geom_col]

    for _, row in gdf.iterrows():
        geom = row[geom_col]
        if geom is None or geom.is_empty:
            continue

        row_props = {col: row[col] for col in non_geom_cols}

        if isinstance(geom, LineString):
            coords = [[float(y), float(x)] for x, y in geom.coords]
            if len(coords) >= 2:
                lines.append(coords)
                props_list.append(row_props)
        elif isinstance(geom, MultiLineString):
            for line in geom.geoms:
                coords = [[float(y), float(x)] for x, y in line.coords]
                if len(coords) >= 2:
                    lines.append(coords)
                    props_list.append(row_props)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]

    return lines, props


def parse_geostructures_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses geostructures GeoLine, GeoPath, or collections containing line shapes."""
    try:
        from geostructures.typing import GeoShape, CollectionBase
    except ImportError:
        return [], {}

    if isinstance(data, CollectionBase):
        shapes = data.geoshapes
    elif isinstance(data, GeoShape):
        shapes = [data]
    else:
        shapes = data

    lines = []
    props_list = []

    for shape in shapes:
        coords = []
        if hasattr(shape, 'coordinates'):
            raw_coords = shape.coordinates
            for pt in raw_coords:
                if hasattr(pt, 'latitude') and hasattr(pt, 'longitude'):
                    coords.append([float(pt.latitude), float(pt.longitude)])
                elif isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    coords.append([float(pt[1]), float(pt[0])])
        
        if len(coords) >= 2:
            lines.append(coords)
            props_list.append(getattr(shape, 'properties', {}) or {})

    props = {}
    if props_list:
        first_props = props_list[0]
        for k in first_props.keys():
            props[k] = [p.get(k) for p in props_list]

    return lines, props


def parse_geojson_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses GeoJSON features containing LineString or MultiLineString geometries."""
    features = []
    if data.get('type') == 'FeatureCollection':
        features = data.get('features', [])
    elif data.get('type') == 'Feature':
        features = [data]
    elif data.get('type') in ('LineString', 'MultiLineString'):
        features = [{'geometry': data, 'properties': {}}]

    lines = []
    props_list = []

    for feature in features:
        geom = feature.get('geometry', {})
        p = feature.get('properties', {}) or {}
        gtype = geom.get('type')

        if gtype == 'LineString':
            raw_coords = geom.get('coordinates', [])
            coords = [[float(c[1]), float(c[0])] for c in raw_coords if len(c) >= 2]
            if len(coords) >= 2:
                lines.append(coords)
                props_list.append(p)
        elif gtype == 'MultiLineString':
            for line_coords in geom.get('coordinates', []):
                coords = [[float(c[1]), float(c[0])] for c in line_coords if len(c) >= 2]
                if len(coords) >= 2:
                    lines.append(coords)
                    props_list.append(p)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [x.get(k) for x in props_list]

    return lines, props


def parse_coordinate_list_lines(data: Any, coord_order: str = "auto", **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses python lists of coordinates: single line or list of lines."""
    if not data:
        return [], {}

    # Check if single line: [[lat1, lon1], [lat2, lon2], ...]
    if isinstance(data[0], (list, tuple, np.ndarray)) and len(data[0]) >= 2 and isinstance(data[0][0], (int, float, np.number)):
        line = []
        for pt in data:
            n1, n2 = float(pt[0]), float(pt[1])
            if coord_order == "lon_lat":
                line.append([n2, n1])
            elif coord_order == "lat_lon":
                line.append([n1, n2])
            else:
                if abs(n1) > 90 and abs(n2) <= 90:
                    line.append([n2, n1])
                else:
                    line.append([n1, n2])
        return [line], {}

    # Check if list of lines: [[[lat1, lon1], ...], [[lat3, lon3], ...]]
    lines = []
    for sub in data:
        if isinstance(sub, (list, tuple, np.ndarray)) and len(sub) > 0:
            line = []
            for pt in sub:
                if len(pt) >= 2:
                    n1, n2 = float(pt[0]), float(pt[1])
                    if coord_order == "lon_lat":
                        line.append([n2, n1])
                    elif coord_order == "lat_lon":
                        line.append([n1, n2])
                    else:
                        if abs(n1) > 90 and abs(n2) <= 90:
                            line.append([n2, n1])
                        else:
                            line.append([n1, n2])
            if len(line) >= 2:
                lines.append(line)

    return lines, {}


def parse_pandas_lines(
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    line_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses Pandas/Polars DataFrames supporting string/WKT columns, wide vertex columns, or grouped track rows."""
    cols = list(data.columns)
    
    # 1. Check for single column with string coordinates or WKT or list of coordinates
    coord_col_candidates = ['coords', 'coordinates', 'locations', 'path', 'wkt', 'geometry']
    actual_coord_col = find_column_or_key(cols, coord_col_candidates)

    if actual_coord_col and not (lat_col or lon_col):
        lines = []
        props_list = []
        non_coord_cols = [c for c in cols if c != actual_coord_col]

        for _, row in data.iterrows():
            raw_val = row[actual_coord_col]
            if isinstance(raw_val, str):
                coords = _parse_coord_string(raw_val, coord_order=coord_order)
            elif isinstance(raw_val, (list, tuple, np.ndarray)):
                coords = []
                for pt in raw_val:
                    if len(pt) >= 2:
                        n1, n2 = float(pt[0]), float(pt[1])
                        if coord_order == "lon_lat":
                            coords.append([n2, n1])
                        else:
                            coords.append([n1, n2])
            else:
                coords = []

            if len(coords) >= 2:
                lines.append(coords)
                props_list.append({col: row[col] for col in non_coord_cols})

        props = {}
        if props_list:
            for k in props_list[0].keys():
                props[k] = [p.get(k) for p in props_list]
        return lines, props

    # 2. Check for wide-format vertex columns (e.g. lat1, lon1, lat2, lon2 or x1, y1, x2, y2)
    lat_pairs = {}
    lon_pairs = {}
    for c in cols:
        m_lat = re.match(r'^(?:lat|latitude|y)_?(\d+)$', c, re.IGNORECASE)
        m_lon = re.match(r'^(?:lon|longitude|x)_?(\d+)$', c, re.IGNORECASE)
        if m_lat:
            lat_pairs[int(m_lat.group(1))] = c
        elif m_lon:
            lon_pairs[int(m_lon.group(1))] = c

    matching_indices = sorted(set(lat_pairs.keys()) & set(lon_pairs.keys()))
    if len(matching_indices) >= 2 and not (lat_col or lon_col):
        lines = []
        props_list = []
        used_cols = set(lat_pairs.values()) | set(lon_pairs.values())
        other_cols = [c for c in cols if c not in used_cols]

        for _, row in data.iterrows():
            line = []
            for idx in matching_indices:
                lat_val = float(row[lat_pairs[idx]])
                lon_val = float(row[lon_pairs[idx]])
                line.append([lat_val, lon_val])
            if len(line) >= 2:
                lines.append(line)
                props_list.append({col: row[col] for col in other_cols})

        props = {}
        if props_list:
            for k in props_list[0].keys():
                props[k] = [p.get(k) for p in props_list]
        return lines, props

    # 3. Multi-row track grouping or simple lat/lon columns
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    line_candidates = ['line_id', 'track_id', 'flight_id', 'route_id', 'group', 'id', 'segment_id']
    order_candidates = ['order', 'step', 'timestamp', 'index', 'seq', 'sequence']

    actual_lat = lat_col or find_column_or_key(cols, lat_candidates)
    actual_lon = lon_col or find_column_or_key(cols, lon_candidates)
    actual_group = line_id_col or find_column_or_key(cols, line_candidates)
    actual_order = order_col or find_column_or_key(cols, order_candidates)

    if actual_lat and actual_lon:
        if actual_group:
            lines = []
            props = {}
            group_keys = []
            non_group_cols = [c for c in cols if c not in (actual_lat, actual_lon, actual_group, actual_order)]
            
            for grp_val, group_df in data.groupby(actual_group, sort=False):
                if actual_order and actual_order in group_df.columns:
                    group_df = group_df.sort_values(by=actual_order)

                lats = group_df[actual_lat].to_numpy().astype(np.float64)
                lons = group_df[actual_lon].to_numpy().astype(np.float64)
                
                if coord_order == "lon_lat":
                    coords = np.column_stack((lons, lats)).tolist()
                else:
                    coords = np.column_stack((lats, lons)).tolist()

                if len(coords) >= 2:
                    lines.append(coords)
                    group_keys.append(grp_val)
                    for col in non_group_cols:
                        if col not in props:
                            props[col] = []
                        props[col].append(group_df[col].iloc[0])

            props[actual_group] = group_keys
            return lines, props
        else:
            # Single line from entire DataFrame
            df_sorted = data.sort_values(by=actual_order) if (actual_order and actual_order in data.columns) else data
            lats = df_sorted[actual_lat].to_numpy().astype(np.float64)
            lons = df_sorted[actual_lon].to_numpy().astype(np.float64)
            if coord_order == "lon_lat":
                coords = np.column_stack((lons, lats)).tolist()
            else:
                coords = np.column_stack((lats, lons)).tolist()
            return [coords], {}

    raise ValueError(f"Could not parse lines from DataFrame columns: {cols}")

# --- REGISTRATION ---
lines_registry = GeometryParserRegistry("lines")
lines_registry.register(is_geopandas_dataframe, parse_geopandas_lines)
lines_registry.register(is_geostructures, parse_geostructures_lines)
lines_registry.register(is_geojson, parse_geojson_lines)
lines_registry.register(is_pandas_dataframe, parse_pandas_lines)
lines_registry.register(is_polars_dataframe, parse_pandas_lines)
lines_registry.register(is_coordinate_list, parse_coordinate_list_lines)

def parse_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """
    Public entrypoint for polyline data parsing strategy dispatching.

    Dispatches input data (DataFrames, GeoPandas, GeoJSON, GeoStructures, Coordinate Lists)
    to registered parser strategies to extract line coordinate paths and feature properties.

    Parameters
    ----------
    data : Any
        Input dataset containing line geometries.
    lat_col : str, optional
        Column name for latitude coordinates.
    lon_col : str, optional
        Column name for longitude coordinates.
    line_id_col : str, optional
        Column name for grouping rows into distinct polyline features.
        A new line feature is created whenever this ID value differs or changes.
    order_col : str, optional
        Column name for sequencing/sorting vertices along each line feature.
    coord_order : {'auto', 'lat_lon', 'lon_lat'}, default 'auto'
        Coordinate ordering convention for raw arrays and string formats.

    Returns
    -------
    Tuple[List[List[List[float]]], Dict[str, List[Any]]]
        A tuple of (lines_coords, props):
        - lines_coords: List of 2D vertex coordinate arrays `[[[lat1, lon1], [lat2, lon2]], ...]`.
        - props: Dictionary mapping property names to lists of feature attribute values.
    """
    return lines_registry.parse(data, **kwargs)
