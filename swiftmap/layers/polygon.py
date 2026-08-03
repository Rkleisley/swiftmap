from typing import Optional, List, Dict, Any
from ..parsers import parse_polygons
from ._display import extract_display_config
from ._batching import batched

@batched
def add_polygon(
    self,
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    shape_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    color: str = "#3388ff",
    fill_color: Optional[str] = None,
    fill_opacity: float = 0.2,
    weight: int = 3,
    opacity: float = 1.0,
    properties: Optional[Dict[str, Any]] = None,
    **kwargs
) -> "Map":
    """
    Adds hardware-accelerated WebGL polygon shape layer(s) to the map.

    Supports automatic parsing from multiple data structures:
    - Lists of boundary coordinate rings
    - DataFrames with grouped shape rows (via `shape_id_col` and `order_col`)
    - DataFrames with WKT string columns ("POLYGON (...)") or delimited text
    - DataFrames with wide vertex columns (`lat1, lon1, lat2, lon2, ...`)
    - GeoPandas GeoDataFrames / GeoSeries (`Polygon`, `MultiPolygon`)
    - GeoJSON objects / FeatureCollections
    - GeoStructures objects (`GeoPolygon`, `GeoBox`, `GeoCircle`, `GeoEllipse`, `GeoWedge`, `CollectionBase`)

    Parameters
    ----------
    data : Any
        Input dataset containing polygon geometries.
    lat_col : str, optional
        Name of the latitude column (for DataFrames with multi-row points).
    lon_col : str, optional
        Name of the longitude column (for DataFrames with multi-row points).
    shape_id_col : str, optional
        Column name used to group multi-row DataFrames into separate polygon features 
        (e.g., 'polygon_id', 'zone_id', 'shape_id').
    order_col : str, optional
        Column name used to sequence boundary vertices along each polygon ring.
    coord_order : {'auto', 'lat_lon', 'lon_lat'}, default 'auto'
        Coordinate pairing convention for raw arrays and delimited strings:
        - 'auto': Range-based heuristic (values > 90° are automatically identified as longitude).
        - 'lon_lat': GIS standard (X = Longitude, Y = Latitude).
        - 'lat_lon': Traditional format (Y = Latitude, X = Longitude).
    name : str, optional
        Name of the layer displayed in sidebar controls.
    layer_group : str, optional
        Nested folder path for hierarchical sidebar organization (e.g., "Boundaries/Zones").
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    color : str, default '#3388ff'
        Polygon stroke line color (hex string or color name).
    fill_color : str, optional
        Polygon interior fill color. Defaults to `color` if omitted.
    fill_opacity : float, default 0.2
        Interior fill opacity (0.0 to 1.0).
    weight : int, default 3
        Stroke line width in pixels.
    opacity : float, default 1.0
        Stroke opacity (0.0 to 1.0).
    properties : dict, optional
        Feature attribute metadata dictionary for popups and tooltips.
    **kwargs
        Additional layer metadata attributes:
        - popup_fields / tooltip_fields : list of str - Property names to display.
          Defaults to every property.
        - popup_names / tooltip_names : list of str - Display labels for those fields,
          matched by position (e.g. fields=["pop_2020"], names=["Population"]).
          Requires the matching `*_fields`.
        - popup_template / tooltip_template : str - HTML template. `{column}` inserts one
          value, `{*}` inserts the default field list. Data values are HTML-escaped; your
          markup is not (e.g. "<img src='{photo}' width=300><br>{*}").
        - popup_style / tooltip_style : str - Inline CSS for the content container.
        - popup_max_width : int - Popup width in pixels (Leaflet default 300).

    Returns
    -------
    Map
        Self reference for method chaining.

    Examples
    --------
    >>> # 1. Simple boundary coordinate ring
    >>> m = Map()
    >>> m.add_polygon([[36.0, -5.35], [36.05, -5.30], [36.02, -5.25]], name="Hazard Zone")

    >>> # 2. GeoPandas GeoDataFrame with polygons
    >>> m.add_shapes(gdf, color="red", fill_opacity=0.4, layer_group="Boundaries/Zones")
    """
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)
    display_config = extract_display_config(kwargs)
    fill_color_resolved = fill_color or kwargs.pop("fill_color", kwargs.pop("fillColor", color))

    # Parse polygon coordinates
    polygons_coords, props = parse_polygons(
        data,
        lat_col=lat_col,
        lon_col=lon_col,
        shape_id_col=shape_id_col,
        order_col=order_col,
        coord_order=coord_order,
        **kwargs
    )
    if not polygons_coords:
        return self

    is_multi = len(polygons_coords) > 1

    for i, coords in enumerate(polygons_coords):
        poly_props = {k: v[i] for k, v in props.items()} if props else {}
        if properties:
            poly_props.update(properties)
        
        if name:
            poly_name = f"{name} {i+1}" if is_multi else name
        else:
            poly_name = str(poly_props.get("name")) if "name" in poly_props else f"Polygon {i+1}" if is_multi else "Polygon"

        self.add_child({
            "type": "polygon",
            "name": poly_name,
            "layer_group": layer_group or "Polygon Group",
            "group_multi_select": group_multi_select,
            "visible": True,
            "locations": coords,
            "color": color,
            "fillColor": fill_color_resolved,
            "fillOpacity": fill_opacity,
            "weight": weight,
            "opacity": opacity,
            "properties": poly_props,
            "autobind_popup": bool(popup),
            "autobind_tooltip": bool(tooltip),
            **display_config,
            **kwargs
        })

    return self

# Aliases for user convenience and intuition
add_polygons = add_polygon
add_shape = add_polygon
add_shapes = add_polygon
