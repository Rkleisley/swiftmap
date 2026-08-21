import numpy as np
from typing import Optional, List, Dict, Any, Tuple, Iterator
from ._utils import LineGeom, _ensure_closed_ring


def is_geostructures(data: Any) -> bool:
    """
    True for a geostructures shape or collection, or a list of them.

    Tested against the library's own base classes rather than by probing for a `to_geojson`
    method and a module name. Duck-typing here would match anything that happened to expose
    that method, and a module-name prefix is not a type check at all -- the same reasoning
    that moved the parsers onto the geometry mixins.
    """
    try:
        from geostructures.typing import BaseShape, CollectionBase
    except ImportError:
        return False

    known = (BaseShape, CollectionBase)
    if isinstance(data, known):
        return True
    if isinstance(data, (list, tuple)) and len(data) > 0:
        return isinstance(data[0], known)
    return False


def _mixins():
    """
    Imported lazily, since geostructures is an optional dependency.

    `geostructures.typing` is the library's canonical home for these -- it re-exports the
    mixins and base classes together, so importing from the implementation modules would
    be reaching past the interface the library offers.
    """
    from geostructures.typing import PointLikeMixin, LineLikeMixin, PolygonLikeMixin
    return PointLikeMixin, LineLikeMixin, PolygonLikeMixin


def _iter_shapes(data: Any, inherited: Optional[Dict[str, Any]] = None,
                 keep=None) -> Iterator[Tuple[Any, Dict[str, Any]]]:
    """
    Yields (shape, properties) for every individual shape, recursively.

    Collections (`FeatureCollection`, `Track`) and the `MultiGeo*` types both expose their
    parts through `.geoshapes`, so both are expanded the same way. Expansion has to happen
    before geometry is read: `linear_rings()` nests differently on a MultiGeoPolygon than on
    a GeoPolygon, and `vertices` is absent from MultiGeoLineString entirely.

    Properties propagate down to parts that carry none of their own, so expanding a
    MultiGeoPolygon does not lose the feature's metadata for popups.

    `keep(shape)` names shapes to yield WHOLE instead of expanding: a
    MultiGeoLineString is one feature with parts, so the line parser keeps it.
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
        if children and not (keep is not None and keep(shape)):
            yield from _iter_shapes(children, props, keep)
        else:
            yield shape, props


def _collect_props(props_list: List[Dict[str, Any]]) -> Dict[str, List[Any]]:
    if not props_list:
        return {}
    keys = {k for p in props_list for k in p}
    return {k: [p.get(k) for p in props_list] for k in keys}


def parse_geostructures_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, **kwargs) -> Tuple:
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

    return lats_arr, lons_arr, props


def parse_geostructures_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    _, LineLikeMixin, _ = _mixins()
    from geostructures import MultiGeoLineString

    def is_multi_line(shape):
        return isinstance(shape, MultiGeoLineString)

    lines, props_list = [], []
    for shape, props in _iter_shapes(data, keep=is_multi_line):
        if not isinstance(shape, LineLikeMixin):
            continue
        if is_multi_line(shape):
            # ONE feature with its parts kept apart -- a MultiGeoLineString has no
            # `vertices` of its own; each part does. It used to expand into a line
            # per part like every other Multi, against the polygon precedent.
            parts = [[[float(v.latitude), float(v.longitude)] for v in part.vertices]
                     for part in shape.geoshapes]
            parts = [part for part in parts if len(part) >= 2]
            if parts:
                lines.append(parts[0] if len(parts) == 1 else LineGeom(parts))
                props_list.append(props)
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
