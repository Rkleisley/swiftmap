import json
import warnings
from typing import Optional, Any
from ..parsers import supports_mixed_geometry
from .._warnings import warn, EmptyLayerWarning
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
    FeatureCollection of points and boundaries, a geostructures `FeatureCollection`, a
    GeoDataFrame whose geometry column mixes types, or a table with a WKT column. When your
    data is all one kind, call `add_markers`, `add_line`, or `add_polygon` directly.

    Layers created from one call share a name, so they merge into a single collapsible
    entry in the sidebar with the individual geometries as children.

    Parameters
    ----------
    data : Any
        Any source that states each geometry's own type:

        - a GeoJSON dict or JSON string
        - a geostructures shape, or a collection of them (`FeatureCollection`, `Track`).
          A `Track` groups shapes by time rather than by geometry, so its contents route
          by shape type the same as any other collection.
        - a GeoPandas GeoDataFrame or GeoSeries
        - a Pandas or Polars DataFrame with a WKT geometry column, since WKT declares its
          kind per value and one column may mix them

        A table whose geometry is implicit -- plain lat/lon columns -- holds a single kind
        by construction and is not accepted, nor are raw coordinate lists. Fed to all three
        parsers speculatively, a table of points would yield the points plus a line threaded
        through them and a polygon around them. Those sources warn and add nothing; use
        `add_markers`, `add_line`, or `add_polygon` instead.
    name : str, optional
        Layer name displayed in sidebar controls. If it matches a property key -- a GeoJSON
        feature property, a geostructures shape property, a GeoDataFrame column -- every
        geometry is named from its own value, so one call can produce a layer per feature.
    layer_group : str or list of str, optional
        Folder path in sidebar controls (e.g. "GIS Feeds/Boundaries"), or a list of parts.
        Any part matching a property key resolves per feature, so `["Sites", "zone"]` files
        each geometry under its own zone.
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

    Warns
    -----
    SwiftMapWarning
        If `data` is not valid JSON, comes from a source that does not distinguish
        geometry types, or `point_type` is unrecognised. Nothing raises: an exception
        partway through a chain of `add_*` calls would discard the layers already added
        and leave nothing to render.

    Examples
    --------
    >>> m = Map()
    >>> m.add_collection(feature_collection, name="Survey", layer_group="Field Data")
    >>> m.add_collection(gdf, name="Assets", point_type="markers")

    >>> # A WKT column may mix kinds; each value declares its own.
    >>> df = pd.DataFrame({"geometry": ["POINT (-5.3 36.0)",
    ...                                 "LINESTRING (-5.3 36.0, -5.2 36.1)"]})
    >>> m.add_collection(df, name="Survey")
    """
    # Every problem below reports and returns rather than raising. Building a map is a
    # chain of add_* calls, and an exception partway through discards the layers already
    # added -- one bad call would leave nothing to render.
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError as exc:
            warn(f"add_collection received a string that is not valid JSON ({exc}). "
                 f"No layer was added.")
            return self

    if not supports_mixed_geometry(data):
        warn(
            f"add_collection needs a source that states each geometry's type: GeoJSON, "
            f"geostructures, GeoPandas, or a DataFrame with a WKT geometry column. Got "
            f"{type(data).__name__}, which holds a single geometry kind by construction -- "
            f"use add_markers, add_line, or add_polygon instead. No layer was added."
        )
        return self

    if point_type not in ("circle_markers", "markers"):
        warn(f"point_type must be 'circle_markers' or 'markers', got {point_type!r}. "
             f"Falling back to 'circle_markers'.")
        point_type = "circle_markers"

    shared = {
        "name": name or "Collection Layer",
        "layer_group": layer_group or "Collection",
        "group_multi_select": group_multi_select,
        **kwargs,
    }

    # The source data is handed to each builder rather than pre-parsed coordinates, so each
    # keeps its own per-feature properties for popups.
    #
    # All three are asked speculatively, so EmptyLayerWarning is suppressed: a collection of
    # polygons containing no points is normal, not something to report. A direct call to
    # add_markers still warns, because there the caller did ask for points.
    add_points = self.add_markers if point_type == "markers" else self.add_circle_markers
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", EmptyLayerWarning)
        add_points(data=data, **shared)
        self.add_polyline(data=data, **shared)
        self.add_polygon(data=data, **shared)

    return self


# Format-named aliases: the collection behaviour is identical, and these keep the
# entry point discoverable for someone who goes looking for their data's format.
add_geojson = add_collection
add_geostructures = add_collection
