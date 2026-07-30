import re
import math
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

def _ensure_closed_ring(ring: List[List[float]]) -> List[List[float]]:
    """Ensures a polygon coordinate ring is closed (first and last vertex match)."""
    if not ring or len(ring) < 3:
        return ring
    first, last = ring[0], ring[-1]
    if abs(first[0] - last[0]) > 1e-7 or abs(first[1] - last[1]) > 1e-7:
        ring.append([first[0], first[1]])
    return ring


def _parse_polygon_wkt_string(val: str, coord_order: str = "auto") -> List[List[float]]:
    """
    Parses WKT POLYGON / MULTIPOLYGON or delimited text coordinate rings.
    Returns outer boundary coordinates `[[lat1, lon1], [lat2, lon2], ...]`.
    """
    if not val or not isinstance(val, str):
        return []

    val_upper = val.strip().upper()

    # 1. WKT POLYGON / MULTIPOLYGON -> GIS standard (lon, lat)
    if val_upper.startswith("POLYGON") or val_upper.startswith("MULTIPOLYGON"):
        nums = [float(n) for n in FLOAT_REGEX.findall(val)]
        coords = []
        for i in range(0, len(nums) - 1, 2):
            lon, lat = nums[i], nums[i+1]
            coords.append([lat, lon])
        return _ensure_closed_ring(coords)

    # 2. Delimited text format
    nums = [float(n) for n in FLOAT_REGEX.findall(val)]
    if len(nums) < 6:  # Minimum 3 vertices (6 numbers) for a polygon
        return []

    coords = []
    for i in range(0, len(nums) - 1, 2):
        n1, n2 = nums[i], nums[i+1]
        if coord_order == "lon_lat":
            coords.append([n2, n1])
        elif coord_order == "lat_lon":
            coords.append([n1, n2])
        else:
            if abs(n1) > 90 and abs(n2) <= 90:
                coords.append([n2, n1])
            else:
                coords.append([n1, n2])

    return _ensure_closed_ring(coords)


def parse_geopandas_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses GeoPandas GeoDataFrame/GeoSeries containing Polygon / MultiPolygon geometries."""
    try:
        import geopandas as gpd
        from shapely.geometry import Polygon, MultiPolygon
    except ImportError:
        return [], {}

    polygons = []
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

        if isinstance(geom, Polygon):
            coords = [[float(y), float(x)] for x, y in geom.exterior.coords]
            if len(coords) >= 3:
                polygons.append(_ensure_closed_ring(coords))
                props_list.append(row_props)
        elif isinstance(geom, MultiPolygon):
            for poly in geom.geoms:
                coords = [[float(y), float(x)] for x, y in poly.exterior.coords]
                if len(coords) >= 3:
                    polygons.append(_ensure_closed_ring(coords))
                    props_list.append(row_props)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]

    return polygons, props


def parse_geostructures_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses geostructures shapes (GeoPolygon, GeoBox, GeoCircle, GeoEllipse, GeoRing, GeoWedge, MultiGeoPolygon, collections)."""
    raw_shapes = []
    if isinstance(data, (list, tuple)):
        raw_shapes = list(data)
    elif hasattr(data, "geoshapes"):
        raw_shapes = list(data.geoshapes)
    elif hasattr(data, "__iter__") and not isinstance(data, (str, bytes, dict)):
        raw_shapes = list(data)
    else:
        raw_shapes = [data]

    # Flatten any MultiGeoPolygon or nested collections
    shapes = []
    for s in raw_shapes:
        if hasattr(s, "geoshapes"):
            shapes.extend(s.geoshapes)
        else:
            shapes.append(s)

    polygons = []
    props_list = []

    for shape in shapes:
        shape_props = getattr(shape, 'properties', {}) or {}
        if hasattr(shape, 'to_polygon'):
            try:
                rings = shape.to_polygon().linear_rings()
                for ring in rings:
                    coords = [[float(pt.latitude), float(pt.longitude)] for pt in ring]
                    if len(coords) >= 3:
                        polygons.append(_ensure_closed_ring(coords))
                        props_list.append(shape_props)
                continue
            except Exception:
                pass

        # Fallback to outline/boundary
        coords = []
        raw_pts = getattr(shape, 'outline', getattr(shape, 'boundary', getattr(shape, 'coordinates', [])))
        if callable(raw_pts):
            try:
                raw_pts = raw_pts()
            except Exception:
                raw_pts = []

        for pt in raw_pts:
            if hasattr(pt, 'latitude') and hasattr(pt, 'longitude'):
                coords.append([float(pt.latitude), float(pt.longitude)])
            elif isinstance(pt, (list, tuple)) and len(pt) >= 2:
                coords.append([float(pt[1]), float(pt[0])])

        if len(coords) >= 3:
            polygons.append(_ensure_closed_ring(coords))
            props_list.append(shape_props)

    props = {}
    if props_list:
        first_props = props_list[0]
        for k in first_props.keys():
            props[k] = [p.get(k) for p in props_list]

    return polygons, props


def parse_geojson_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses GeoJSON features containing Polygon or MultiPolygon geometries."""
    features = []
    if data.get('type') == 'FeatureCollection':
        features = data.get('features', [])
    elif data.get('type') == 'Feature':
        features = [data]
    elif data.get('type') in ('Polygon', 'MultiPolygon'):
        features = [{'geometry': data, 'properties': {}}]

    polygons = []
    props_list = []

    for feature in features:
        geom = feature.get('geometry', {})
        p = feature.get('properties', {}) or {}
        gtype = geom.get('type')

        if gtype == 'Polygon':
            rings = geom.get('coordinates', [])
            if rings:
                # Outer boundary ring
                coords = [[float(c[1]), float(c[0])] for c in rings[0] if len(c) >= 2]
                if len(coords) >= 3:
                    polygons.append(_ensure_closed_ring(coords))
                    props_list.append(p)
        elif gtype == 'MultiPolygon':
            for poly_rings in geom.get('coordinates', []):
                if poly_rings:
                    coords = [[float(c[1]), float(c[0])] for c in poly_rings[0] if len(c) >= 2]
                    if len(coords) >= 3:
                        polygons.append(_ensure_closed_ring(coords))
                        props_list.append(p)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [x.get(k) for x in props_list]

    return polygons, props


def parse_coordinate_list_polygons(data: Any, coord_order: str = "auto", **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses python lists of coordinates: single polygon ring or list of polygon rings."""
    if not data:
        return [], {}

    # Check if single polygon ring: [[lat1, lon1], [lat2, lon2], ...]
    if isinstance(data[0], (list, tuple, np.ndarray)) and len(data[0]) >= 2 and isinstance(data[0][0], (int, float, np.number)):
        ring = []
        for pt in data:
            n1, n2 = float(pt[0]), float(pt[1])
            if coord_order == "lon_lat":
                ring.append([n2, n1])
            elif coord_order == "lat_lon":
                ring.append([n1, n2])
            else:
                if abs(n1) > 90 and abs(n2) <= 90:
                    ring.append([n2, n1])
                else:
                    ring.append([n1, n2])
        return [_ensure_closed_ring(ring)], {}

    # Check if list of polygon rings: [[[lat1, lon1], ...], [[lat3, lon3], ...]]
    polygons = []
    for sub in data:
        if isinstance(sub, (list, tuple, np.ndarray)) and len(sub) > 0:
            ring = []
            for pt in sub:
                if len(pt) >= 2:
                    n1, n2 = float(pt[0]), float(pt[1])
                    if coord_order == "lon_lat":
                        ring.append([n2, n1])
                    elif coord_order == "lat_lon":
                        ring.append([n1, n2])
                    else:
                        if abs(n1) > 90 and abs(n2) <= 90:
                            ring.append([n2, n1])
                        else:
                            ring.append([n1, n2])
            if len(ring) >= 3:
                polygons.append(_ensure_closed_ring(ring))

    return polygons, {}


def parse_pandas_polygons(
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    shape_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """Parses Pandas/Polars DataFrames containing WKT polygon columns, wide vertex columns, or grouped shape rows."""
    cols = list(data.columns)

    # 1. Check for single column with WKT polygon string or list of coordinates
    coord_col_candidates = ['coords', 'coordinates', 'locations', 'wkt', 'geometry', 'shape']
    actual_coord_col = find_column_or_key(cols, coord_col_candidates)

    if actual_coord_col and not (lat_col or lon_col):
        polygons = []
        props_list = []
        non_coord_cols = [c for c in cols if c != actual_coord_col]

        for _, row in data.iterrows():
            raw_val = row[actual_coord_col]
            if isinstance(raw_val, str):
                coords = _parse_polygon_wkt_string(raw_val, coord_order=coord_order)
            elif isinstance(raw_val, (list, tuple, np.ndarray)):
                coords = []
                for pt in raw_val:
                    if len(pt) >= 2:
                        n1, n2 = float(pt[0]), float(pt[1])
                        if coord_order == "lon_lat":
                            coords.append([n2, n1])
                        else:
                            coords.append([n1, n2])
                coords = _ensure_closed_ring(coords)
            else:
                coords = []

            if len(coords) >= 3:
                polygons.append(coords)
                props_list.append({col: row[col] for col in non_coord_cols})

        props = {}
        if props_list:
            for k in props_list[0].keys():
                props[k] = [p.get(k) for p in props_list]
        return polygons, props

    # 2. Check for wide-format vertex columns (lat1, lon1, lat2, lon2...)
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
    if len(matching_indices) >= 3 and not (lat_col or lon_col):
        polygons = []
        props_list = []
        used_cols = set(lat_pairs.values()) | set(lon_pairs.values())
        other_cols = [c for c in cols if c not in used_cols]

        for _, row in data.iterrows():
            ring = []
            for idx in matching_indices:
                lat_val = float(row[lat_pairs[idx]])
                lon_val = float(row[lon_pairs[idx]])
                ring.append([lat_val, lon_val])
            if len(ring) >= 3:
                polygons.append(_ensure_closed_ring(ring))
                props_list.append({col: row[col] for col in other_cols})

        props = {}
        if props_list:
            for k in props_list[0].keys():
                props[k] = [p.get(k) for p in props_list]
        return polygons, props

    # 3. Multi-row polygon grouping by shape_id_col
    lat_candidates = ['lat', 'latitude', 'y', 'lat_col']
    lon_candidates = ['lon', 'longitude', 'x', 'lon_col', 'lng']
    shape_candidates = ['shape_id', 'polygon_id', 'zone_id', 'group', 'id', 'name']
    order_candidates = ['order', 'step', 'vertex', 'index', 'seq', 'sequence']

    actual_lat = lat_col or find_column_or_key(cols, lat_candidates)
    actual_lon = lon_col or find_column_or_key(cols, lon_candidates)
    actual_group = shape_id_col or find_column_or_key(cols, shape_candidates)
    actual_order = order_col or find_column_or_key(cols, order_candidates)

    if actual_lat and actual_lon:
        if actual_group:
            polygons = []
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

                if len(coords) >= 3:
                    polygons.append(_ensure_closed_ring(coords))
                    group_keys.append(grp_val)
                    for col in non_group_cols:
                        if col not in props:
                            props[col] = []
                        props[col].append(group_df[col].iloc[0])

            props[actual_group] = group_keys
            return polygons, props
        else:
            # Single polygon ring from entire DataFrame
            df_sorted = data.sort_values(by=actual_order) if (actual_order and actual_order in data.columns) else data
            lats = df_sorted[actual_lat].to_numpy().astype(np.float64)
            lons = df_sorted[actual_lon].to_numpy().astype(np.float64)
            if coord_order == "lon_lat":
                coords = np.column_stack((lons, lats)).tolist()
            else:
                coords = np.column_stack((lats, lons)).tolist()
            return [_ensure_closed_ring(coords)], {}

    raise ValueError(f"Could not parse polygons from DataFrame columns: {cols}")

# --- REGISTRATION ---
polygons_registry = GeometryParserRegistry("polygons")
polygons_registry.register(is_geopandas_dataframe, parse_geopandas_polygons)
polygons_registry.register(is_geostructures, parse_geostructures_polygons)
polygons_registry.register(is_geojson, parse_geojson_polygons)
polygons_registry.register(is_pandas_dataframe, parse_pandas_polygons)
polygons_registry.register(is_polars_dataframe, parse_pandas_polygons)
polygons_registry.register(is_coordinate_list, parse_coordinate_list_polygons)

def parse_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """
    Public entrypoint for polygon data parsing strategy dispatching.

    Dispatches input data (DataFrames, GeoPandas, GeoJSON, GeoStructures, Coordinate Lists)
    to registered parser strategies to extract polygon boundary rings and feature properties.

    Parameters
    ----------
    data : Any
        Input dataset containing polygon geometries.
    lat_col : str, optional
        Column name for latitude coordinates.
    lon_col : str, optional
        Column name for longitude coordinates.
    shape_id_col : str, optional
        Column name for grouping rows into distinct polygon shape features.
    order_col : str, optional
        Column name for sequencing/sorting vertices along each polygon boundary ring.
    coord_order : {'auto', 'lat_lon', 'lon_lat'}, default 'auto'
        Coordinate ordering convention for raw arrays and string formats.

    Returns
    -------
    Tuple[List[List[List[float]]], Dict[str, List[Any]]]
        A tuple of (polygons_coords, props):
        - polygons_coords: List of 2D vertex coordinate boundary rings `[[[lat1, lon1], [lat2, lon2], ...], ...]`.
        - props: Dictionary mapping property names to lists of feature attribute values.
    """
    return polygons_registry.parse(data, **kwargs)
