from typing import Optional, Any
from ..parsers import split_geostructures_by_geometry
from ._geometry import add_parsed_geometries
from ._batching import batched

@batched
def add_geostructures(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    **kwargs
) -> "Map":
    """
    Convenience wrapper to parse and render geostructures objects, shapes, tracks, or collections
    using Python geometry parsers and high-performance WebGL binary-buffered layers.

    Shapes are classified by geometry kind before parsing, so a polygon renders only as a polygon
    and a line only as a line. Classification uses the geostructures type mixins directly rather
    than converting through `to_geojson()`, which is both faster and avoids a lossy round trip.

    Parameters
    ----------
    data : Any
        `geostructures` object (`GeoPoint`, `GeoLineString`, `GeoPolygon`, `GeoBox`, `GeoCircle`,
        `GeoRing`, `GeoEllipse`, any `MultiGeo*`), a `FeatureCollection`/`Track`, or a list of shapes.
    name : str, optional
        Layer name displayed in sidebar controls.
    layer_group : str, optional
        Nested folder path in sidebar controls (e.g. "Tracks/Active").
    group_multi_select : bool, optional
        If False, configures parent folder controls as mutually exclusive radio buttons.
    **kwargs
        Additional visual styling and popup/tooltip options passed to sub-layer builders.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    points, lines, polygons = split_geostructures_by_geometry(data)

    return add_parsed_geometries(
        self,
        point_data=points or None,
        line_data=lines or None,
        polygon_data=polygons or None,
        name=name or "Geostructures Layer",
        layer_group=layer_group or "Geostructures Group",
        group_multi_select=group_multi_select,
        **kwargs
    )
