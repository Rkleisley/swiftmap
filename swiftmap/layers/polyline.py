from typing import Optional, List, Dict, Any
from ..parsers import parse_lines
from ._display import extract_display_config
from ._batching import batched

@batched
def add_line(
    self,
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    line_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    color: str = "#3388ff",
    weight: int = 3,
    opacity: float = 1.0,
    **kwargs
) -> "Map":
    """
    Adds hardware-accelerated WebGL polyline layer(s) to the map.

    Supports automatic parsing from multiple data structures:
    - Lists of coordinate pairs/paths
    - DataFrames with grouped track rows (via `line_id_col` and `order_col`)
    - DataFrames with WKT string columns ("LINESTRING (...)") or delimited text
    - DataFrames with wide vertex columns (`lat1, lon1, lat2, lon2, ...`)
    - GeoPandas GeoDataFrames / GeoSeries (`LineString`, `MultiLineString`)
    - GeoJSON objects / FeatureCollections
    - GeoStructures objects (`GeoLineString`, `MultiGeoLineString`, `Track`, `FeatureCollection`)

    Parameters
    ----------
    data : Any
        Input dataset containing polyline geometries.
    lat_col : str, optional
        Name of the latitude column (for DataFrames with multi-row points).
    lon_col : str, optional
        Name of the longitude column (for DataFrames with multi-row points).
    line_id_col : str, optional
        Column name used to break/group multi-row DataFrames into separate line features 
        (e.g., 'track_id', 'flight_number', 'segment_id'). When this value changes or differs,
        a distinct line feature is created.
    order_col : str, optional
        Column name used to sequence vertices within each line feature (e.g., 'timestamp', 'step').
    coord_order : {'auto', 'lat_lon', 'lon_lat'}, default 'auto'
        Coordinate pairing convention for raw arrays and delimited strings:
        - 'auto': Range-based heuristic (values > 90° are automatically identified as longitude).
        - 'lon_lat': GIS standard (X = Longitude, Y = Latitude).
        - 'lat_lon': Traditional format (Y = Latitude, X = Longitude).
    name : str, optional
        Name of the layer displayed in the sidebar control.
    layer_group : str, optional
        Nested folder path for hierarchical sidebar organization (e.g., "Tracks/Active").
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    color : str, default '#3388ff'
        Hex color string or color name for line rendering.
    weight : int, default 3
        Line width in pixels.
    opacity : float, default 1.0
        Line opacity (0.0 to 1.0).
    **kwargs
        Additional layer metadata attributes:
        - popup : bool, default True - Enables popups on click.
        - tooltip : bool, default True - Enables tooltips on hover.
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
    >>> # 1. Simple coordinate list
    >>> m = Map()
    >>> m.add_line([[34.05, -118.24], [37.77, -122.41]], name="CA Highway")

    >>> # 2. DataFrame grouped by track ID with timestamp sorting
    >>> df = pd.DataFrame({
    ...     "lat": [34.05, 34.06, 37.77, 37.78],
    ...     "lon": [-118.24, -118.25, -122.41, -122.42],
    ...     "flight_no": ["F101", "F101", "F202", "F202"],
    ...     "time": [1, 2, 1, 2]
    ... })
    >>> m.add_line(df, line_id_col="flight_no", order_col="time", color="red")

    >>> # 3. GeoPandas GeoDataFrame with GIS lon/lat standard
    >>> m.add_line(gdf, coord_order="lon_lat", layer_group="GIS Feeds/Routes")
    """
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)
    display_config = extract_display_config(kwargs)

    lines_coords, props = parse_lines(
        data,
        lat_col=lat_col,
        lon_col=lon_col,
        line_id_col=line_id_col,
        order_col=order_col,
        coord_order=coord_order,
        **kwargs
    )
    if not lines_coords:
        return self

    is_multi = len(lines_coords) > 1

    for i, coords in enumerate(lines_coords):
        line_props = {k: v[i] for k, v in props.items()} if props else {}
        
        if name:
            line_name = f"{name} {i+1}" if is_multi else name
        else:
            line_name = str(line_props.get("name")) if "name" in line_props else f"Line {i+1}" if is_multi else "Line"

        self.add_child({
            "type": "polyline",
            "name": line_name,
            "layer_group": layer_group or "Line Group",
            "group_multi_select": group_multi_select,
            "visible": True,
            "locations": coords,
            "color": color,
            "weight": weight,
            "opacity": opacity,
            "properties": line_props,
            "autobind_popup": bool(popup),
            "autobind_tooltip": bool(tooltip),
            **display_config,
            **kwargs
        })

    return self

# Alias for Leaflet / Folium compatibility
add_polyline = add_line
