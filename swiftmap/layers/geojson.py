import json
from typing import Optional, Dict, Any
from ..parsers import is_geostructures
from ._geometry import add_parsed_geometries
from ._batching import batched

@batched
def add_geojson(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    style: Optional[Dict] = None,
    **kwargs
) -> "Map":
    """
    Convenience wrapper to parse and render GeoJSON features (FeatureCollections, Features, Geometries)
    using Python geometry parsers and high-performance WebGL binary-buffered layers.

    Parameters
    ----------
    data : Any
        GeoJSON dictionary or JSON string. Geostructures objects are forwarded to
        `add_geostructures`, which parses them directly rather than converting to GeoJSON first.
    name : str, optional
        Layer name displayed in sidebar controls.
    layer_group : str, optional
        Nested folder path in sidebar controls (e.g. "GIS Feeds/Boundaries").
    group_multi_select : bool, optional
        If False, configures parent folder controls as mutually exclusive radio buttons.
    style : dict, optional
        Optional style overrides dictionary.
    **kwargs
        Additional visual styling and popup/tooltip options passed to sub-layer builders.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    # Geostructures shapes parse faster natively and need per-kind classification to avoid
    # rendering a polygon as both a polygon and a centroid marker.
    if is_geostructures(data):
        return self.add_geostructures(
            data,
            name=name,
            layer_group=layer_group,
            group_multi_select=group_multi_select,
            **kwargs
        )

    if isinstance(data, str):
        try:
            parsed_data = json.loads(data)
        except ValueError as exc:
            raise ValueError(f"add_geojson received a string that is not valid JSON: {exc}") from exc
    else:
        parsed_data = data

    # GeoJSON parsers filter on feature type, so each one returns only its own geometries.
    return add_parsed_geometries(
        self,
        point_data=parsed_data,
        line_data=parsed_data,
        polygon_data=parsed_data,
        name=name or "GeoJSON Layer",
        layer_group=layer_group or "GeoJSON Group",
        group_multi_select=group_multi_select,
        **kwargs
    )
