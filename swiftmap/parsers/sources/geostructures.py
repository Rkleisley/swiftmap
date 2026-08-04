import numpy as np
from typing import Optional, List, Dict, Any, Tuple, Iterator
from ._utils import _ensure_closed_ring


def is_geostructures(data: Any) -> bool:
    if hasattr(data, "to_geojson") and type(data).__module__.startswith("geostructures"):
        return True
    if isinstance(data, (list, tuple)) and len(data) > 0:
        if hasattr(data[0], "to_geojson") and type(data[0]).__module__.startswith("geostructures"):
            return True
    return False


def _mixins():
    """Imported lazily: geostructures is an optional dependency."""
    from geostructures.structures import PointLikeMixin, LineLikeMixin, PolygonLikeMixin
    return PointLikeMixin, LineLikeMixin, PolygonLikeMixin


def _iter_shapes(data: Any, inherited: Optional[Dict[str, Any]] = None) -> Iterator[Tuple[Any, Dict[str, Any]]]:
    """
    Yields (shape, properties) for every individual shape, recursively.

    Collections (`FeatureCollection`, `Track`) and the `MultiGeo*` types both expose their
    parts through `.geoshapes`, so both are expanded the same way. Expansion has to happen
    before geometry is read: `linear_rings()` nests differently on a MultiGeoPolygon than on
    a GeoPolygon, and `vertices` is absent from MultiGeoLineString entirely.

    Properties propagate down to parts that carry none of their own, so expanding a
    MultiGeoPolygon does not lose the feature's metadata for popups.
    """
    if isinstance(data, (list, tuple)):
        items = list(data)
    elif hasattr(data, "geoshapes"):
        items = list(data.geoshapes)
        inherited = getattr(data, "properties", None) or inherited
    elif hasattr(data, "__iter__") and not isinstance(data, (str, bytes, dict)):
        items = list(data)
    else:
        items = [data]

    for shape in items:
        props = getattr(shape, "properties", None) or inherited or {}
        children = getattr(shape, "geoshapes", None)
        if children:
            yield from _iter_shapes(children, props)
        else:
            yield shape, props


def _collect_props(props_list: List[Dict[str, Any]]) -> Dict[str, List[Any]]:
    if not props_list:
        return {}
    keys = {k for p in props_list for k in p}
    return {k: [p.get(k) for p in props_list] for k in keys}


def parse_geostructures_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    PointLikeMixin, _, _ = _mixins()

    lats, lons, props_list = [], [], []
    for shape, props in _iter_shapes(data):
        if not isinstance(shape, PointLikeMixin):
            continue
        centroid = shape.centroid
        lats.append(float(centroid.latitude))
        lons.append(float(centroid.longitude))
        props_list.append(props)

    lats_arr = np.array(lats, dtype=np.float64)
    lons_arr = np.array(lons, dtype=np.float64)
    props = _collect_props(props_list)

    if intensity_col and props_list:
        intensities = np.array(
            [float(p.get(intensity_col, 1.0) or 1.0) for p in props_list], dtype=np.float64
        )
    else:
        intensities = np.ones(len(lats_arr), dtype=np.float64)

    return lats_arr, lons_arr, props, intensities


def parse_geostructures_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    _, LineLikeMixin, _ = _mixins()

    lines, props_list = [], []
    for shape, props in _iter_shapes(data):
        if not isinstance(shape, LineLikeMixin):
            continue
        coords = [[float(v.latitude), float(v.longitude)] for v in shape.vertices]
        if len(coords) >= 2:
            lines.append(coords)
            props_list.append(props)

    return lines, _collect_props(props_list)


def parse_geostructures_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    _, _, PolygonLikeMixin = _mixins()

    polygons, props_list = [], []
    for shape, props in _iter_shapes(data):
        if not isinstance(shape, PolygonLikeMixin):
            continue
        # linear_rings() is declared by the mixin and works on every polygon-like shape,
        # unlike to_polygon() which MultiGeoPolygon does not implement. A GeoRing returns
        # its outer boundary and its hole as separate rings; the renderer draws one ring
        # per polygon, so each becomes its own outline.
        for ring in shape.linear_rings():
            coords = [[float(p.latitude), float(p.longitude)] for p in ring]
            if len(coords) >= 3:
                polygons.append(_ensure_closed_ring(coords))
                props_list.append(props)

    return polygons, _collect_props(props_list)
