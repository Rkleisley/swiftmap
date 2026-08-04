import json
from typing import Optional, Any
from ..parsers import supports_mixed_geometry
from ._batching import batched


@batched
def add_collection(
    self,
    data: Any,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    point_type: str = "circle_markers",
    **kwargs
) -> "Map":
    """
    Plots every geometry in a mixed collection, adding one layer per geometry kind present.

    Use this when a single dataset holds more than one kind of shape -- a GeoJSON
    FeatureCollection of points and boundaries, a geostructures `FeatureCollection` or
    `Track`, a GeoDataFrame whose geometry column mixes types. When your data is all one
    kind, call `add_markers`, `add_line`, or `add_polygon` directly.

    Layers created from one call share a name, so they merge into a single collapsible
    entry in the sidebar with the individual geometries as children.

    Parameters
    ----------
    data : Any
        GeoJSON dict or JSON string, a geostructures shape/collection, or a GeoPandas
        GeoDataFrame/GeoSeries. Sources that hold only one geometry kind per call
        (Pandas, Polars, raw coordinate lists) are rejected -- see Raises.
    name : str, optional
        Layer name displayed in sidebar controls.
    layer_group : str, optional
        Nested folder path in sidebar controls (e.g. "GIS Feeds/Boundaries").
    group_multi_select : bool, optional
        If False, configures parent folder controls as mutually exclusive radio buttons.
    point_type : {'circle_markers', 'markers'}, default 'circle_markers'
        How to render point geometries. Circle markers are the cheaper primitive and the
        better default for collections carrying many points; 'markers' draws the pin shader.
    **kwargs
        Styling and popup/tooltip options, forwarded to each sub-layer builder.

    Returns
    -------
    Map
        Self reference for method chaining.

    Raises
    ------
    TypeError
        If `data` comes from a source whose parsers do not distinguish geometry types.
        Tabular parsers coerce whatever they are given -- a table of points would also
        yield a line threaded through them and a polygon around them -- so plotting one
        speculatively as all three kinds would produce layers you did not ask for.
    ValueError
        If `data` is a string that is not valid JSON.

    Examples
    --------
    >>> m = Map()
    >>> m.add_collection(feature_collection, name="Survey", layer_group="Field Data")
    >>> m.add_collection(gdf, name="Assets", point_type="markers")
    """
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError as exc:
            raise ValueError(
                f"add_collection received a string that is not valid JSON: {exc}"
            ) from exc

    if not supports_mixed_geometry(data):
        raise TypeError(
            f"add_collection needs a source that states each geometry's type: GeoJSON, "
            f"geostructures, GeoPandas, or a DataFrame with a WKT geometry column. Got "
            f"{type(data).__name__}. A table of lat/lon columns is a single geometry kind "
            f"by construction -- use add_markers, add_line, or add_polygon instead."
        )

    if point_type not in ("circle_markers", "markers"):
        raise ValueError(
            f"point_type must be 'circle_markers' or 'markers', got {point_type!r}."
        )

    shared = {
        "name": name or "Collection Layer",
        "layer_group": layer_group or "Collection",
        "group_multi_select": group_multi_select,
        **kwargs,
    }

    # The source data is handed to each builder rather than pre-parsed coordinates, so each
    # keeps its own per-feature properties for popups. Every builder returns early when its
    # parser finds nothing, so kinds absent from the collection simply add no layer.
    add_points = self.add_markers if point_type == "markers" else self.add_circle_markers
    add_points(data=data, **shared)
    self.add_polyline(data=data, **shared)
    self.add_polygon(data=data, **shared)

    return self


# Format-named aliases: the collection behaviour is identical, and these keep the
# entry point discoverable for someone who goes looking for their data's format.
add_geojson = add_collection
add_geostructures = add_collection
