import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import _ensure_closed_ring

def is_geojson(data: Any) -> bool:
    if isinstance(data, dict) and "type" in data:
        return True
    return False


def parse_geojson_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None) -> Tuple:
    features = []
    if data.get('type') == 'FeatureCollection':
        features = data.get('features', [])
    elif data.get('type') == 'Feature':
        features = [data]
    elif data.get('type') in ('Point', 'MultiPoint'):
        features = [{'geometry': data, 'properties': {}}]

    lats_list = []
    lons_list = []
    props_list = []

    for feature in features:
        geom = feature.get('geometry') or {}
        gtype = geom.get('type')

        # MultiPoint holds a list of positions; a Point holds one. Normalizing to a list
        # keeps both on the same path, matching how lines and polygons treat their Multi
        # variants -- MultiPoint was previously dropped entirely.
        if gtype == 'Point':
            positions = [geom.get('coordinates', [])]
        elif gtype == 'MultiPoint':
            positions = geom.get('coordinates', [])
        else:
            continue

        p = feature.get('properties', {}) or {}
        for coords in positions:
            if len(coords) >= 2:
                lons_list.append(float(coords[0]))
                lats_list.append(float(coords[1]))
                props_list.append(p)

    lats = np.array(lats_list, dtype=np.float64)
    lons = np.array(lons_list, dtype=np.float64)
    
    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [x.get(k) for x in props_list]
            
    return lats, lons, props


def parse_geojson_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
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
        geom = feature.get('geometry') or {}
        p = feature.get('properties', {}) or {}
        gtype = geom.get('type')

        if gtype == 'LineString':
            coords = [[float(c[1]), float(c[0])] for c in geom.get('coordinates', []) if len(c) >= 2]
            if len(coords) >= 2:
                lines.append(coords)
                props_list.append(p)
        elif gtype == 'MultiLineString':
            for line_coords_raw in geom.get('coordinates', []):
                coords = [[float(c[1]), float(c[0])] for c in line_coords_raw if len(c) >= 2]
                if len(coords) >= 2:
                    lines.append(coords)
                    props_list.append(p)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [x.get(k) for x in props_list]

    return lines, props


def parse_geojson_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
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
        geom = feature.get('geometry') or {}
        p = feature.get('properties', {}) or {}
        gtype = geom.get('type')

        if gtype == 'Polygon':
            rings = geom.get('coordinates', [])
            if rings:
                coords = [[float(c[1]), float(c[0])] for c in rings[0] if len(c) >= 2]
                if len(coords) >= 3:
                    coords = _ensure_closed_ring(coords)
                    polygons.append(coords)
                    props_list.append(p)
        elif gtype == 'MultiPolygon':
            for poly_rings in geom.get('coordinates', []):
                if poly_rings:
                    coords = [[float(c[1]), float(c[0])] for c in poly_rings[0] if len(c) >= 2]
                    if len(coords) >= 3:
                        coords = _ensure_closed_ring(coords)
                        polygons.append(coords)
                        props_list.append(p)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [x.get(k) for x in props_list]

    return polygons, props
