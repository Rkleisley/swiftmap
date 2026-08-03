import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import _ensure_closed_ring

def is_geostructures(data: Any) -> bool:
    if hasattr(data, "to_geojson") and type(data).__module__.startswith("geostructures"):
        return True
    if isinstance(data, (list, tuple)) and len(data) > 0:
        if hasattr(data[0], "to_geojson") and type(data[0]).__module__.startswith("geostructures"):
            return True
    return False


def _flatten_shapes(data: Any) -> List[Any]:
    """Normalizes any geostructures input to a flat shape list, expanding collections."""
    if isinstance(data, (list, tuple)):
        raw_shapes = list(data)
    elif hasattr(data, "geoshapes"):
        raw_shapes = list(data.geoshapes)
    elif hasattr(data, "__iter__") and not isinstance(data, (str, bytes, dict)):
        raw_shapes = list(data)
    else:
        raw_shapes = [data]

    shapes = []
    for shape in raw_shapes:
        if hasattr(shape, "geoshapes"):
            shapes.extend(shape.geoshapes)
        else:
            shapes.append(shape)
    return shapes


def split_geostructures_by_geometry(data: Any) -> Tuple[List[Any], List[Any], List[Any]]:
    """
    Flattens collections and groups shapes into (points, lines, polygons).

    Dispatch uses geostructures' own type mixins rather than a `to_geojson()` round trip:
    it is faster, and it is exact. Every shape is point-like, line-like, or polygon-like and
    never more than one, so each parser only ever sees shapes of its own kind. Duck-typing on
    attributes cannot do this -- `centroid` is present on every shape, and `to_polygon` on
    lines as well as polygons.
    """
    from geostructures.structures import PointLikeMixin, LineLikeMixin, PolygonLikeMixin

    points, lines, polygons = [], [], []
    for shape in _flatten_shapes(data):
        if isinstance(shape, PointLikeMixin):
            points.append(shape)
        elif isinstance(shape, LineLikeMixin):
            lines.append(shape)
        elif isinstance(shape, PolygonLikeMixin):
            polygons.append(shape)
    return points, lines, polygons


def parse_geostructures_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    shapes = _flatten_shapes(data)
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
    ], dtype=np.float64) if valid_shapes else np.ones(len(lats), dtype=np.float64)
    
    return lats, lons, props, intensities


def parse_geostructures_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    shapes = _flatten_shapes(data)

    lines = []
    props_list = []

    for shape in shapes:
        coords = []
        if hasattr(shape, 'vertices'):
            coords = [[float(pt.latitude), float(pt.longitude)] for pt in shape.vertices]
        elif hasattr(shape, 'coordinates'):
            for pt in shape.coordinates:
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


def parse_geostructures_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    shapes = _flatten_shapes(data)

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
                        coords = _ensure_closed_ring(coords)
                        polygons.append(coords)
                        props_list.append(shape_props)
                continue
            except Exception:
                pass

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
            coords = _ensure_closed_ring(coords)
            polygons.append(coords)
            props_list.append(shape_props)

    props = {}
    if props_list:
        first_props = props_list[0]
        for k in first_props.keys():
            props[k] = [p.get(k) for p in props_list]

    return polygons, props
