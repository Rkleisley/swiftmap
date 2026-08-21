import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import _ensure_closed_ring, PolygonGeom, LineGeom

def is_geojson(data: Any) -> bool:
    if isinstance(data, dict) and "type" in data:
        return True
    return False


def parse_geojson_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, **kwargs) -> Tuple:
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
            # ONE feature with its parts kept apart, as a MultiPolygon is. It used to
            # split into a line per part -- a sidebar entry each, and the opposite of
            # the polygon precedent. A single-part multi stays the plain list.
            parts = []
            for line_coords_raw in geom.get('coordinates', []):
                coords = [[float(c[1]), float(c[0])] for c in line_coords_raw if len(c) >= 2]
                if len(coords) >= 2:
                    parts.append(coords)
            if parts:
                lines.append(parts[0] if len(parts) == 1 else LineGeom(parts))
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

    def to_ring(ring):
        coords = [[float(c[1]), float(c[0])] for c in ring if len(c) >= 2]
        return _ensure_closed_ring(coords) if len(coords) >= 3 else None

    def to_part(rings):
        """One polygon: outer ring first, holes after -- holes without an outer drop."""
        converted = [r for r in (to_ring(ring) for ring in rings) if r]
        return converted if converted else None

    for feature in features:
        geom = feature.get('geometry') or {}
        p = feature.get('properties', {}) or {}
        gtype = geom.get('type')

        # Holes and multipolygon parts survive as a PolygonGeom; the bare-ring shape
        # stays a plain list, so the common case is unchanged. A MultiPolygon is ONE
        # feature and stays one layer -- it used to split into a layer per part, each
        # stripped to its outer ring.
        if gtype == 'Polygon':
            part = to_part(geom.get('coordinates', []))
            if part:
                polygons.append(part[0] if len(part) == 1 else PolygonGeom([part]))
                props_list.append(p)
        elif gtype == 'MultiPolygon':
            parts = [pt for pt in (to_part(rings) for rings in geom.get('coordinates', [])) if pt]
            if parts:
                if len(parts) == 1 and len(parts[0]) == 1:
                    polygons.append(parts[0][0])
                else:
                    polygons.append(PolygonGeom(parts))
                props_list.append(p)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [x.get(k) for x in props_list]

    return polygons, props
