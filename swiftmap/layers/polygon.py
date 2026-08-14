from typing import Optional, List, Dict, Any
from ..parsers import parse_polygons
from ._display import extract_display_config
from ._style import pop_style_options, resolve_styles
from ._batching import batched
from ._grouping import build_group_specs, resolve_group_path, resolve_layer_name
from .._warnings import warn, EmptyLayerWarning
from ._targeting import bounds_of_coords
import numpy as np

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
        (e.g., 'polygon_id', 'zone_id', 'shape_id'). May instead name a column holding
        WKT polygon strings -- recognised by the values themselves -- in which case it
        is the geometry source, one shape per row, and no grouping applies. This is how
        to point at a WKT column whose name the automatic guess ('wkt', 'geometry',
        'shape', ...) would miss.
    order_col : str, optional
        Column name used to sequence boundary vertices along each polygon ring.
    coord_order : {'auto', 'lat_lon', 'lon_lat'}, default 'auto'
        Coordinate pairing convention for raw arrays and delimited strings:
        - 'auto': Range-based heuristic. A first value beyond ±90° can only be a longitude,
          so the whole dataset is read lon-first; absent that evidence anywhere in the
          data, it is read lat-first. The decision is made once and applied to every
          coordinate, so no part of a layer can be transposed away from the rest.
        - 'lon_lat': GIS standard (X = Longitude, Y = Latitude).
        - 'lat_lon': Traditional format (Y = Latitude, X = Longitude).

        WKT values declare their own axis order and are never subject to the heuristic.
    name : str, optional
        Layer name displayed in sidebar controls. If it matches a property key in the data,
        each polygon is named from its own value of that property.
    layer_group : str or list of str, optional
        Folder path for the sidebar tree (e.g. "Boundaries/Zones"), or a list of parts. Any
        part matching a property key resolves per polygon, so `["Zones", "risk"]` files each
        polygon under its own risk level.
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    properties : dict, optional
        Feature attribute metadata dictionary for popups and tooltips.
    **kwargs
        Styling and behaviour options. Anything not listed here is forwarded to the layer
        unchanged, so custom metadata reaches the frontend; an option close to a real name
        (e.g. 'colour') is reported as a likely typo.
        - color : str, default '#3388ff' - Stroke color (hex string or CSS color name).
        - fill_color : str - Interior fill color. Defaults to `color`.
        - fill_opacity : float, default 0.2 - Interior fill opacity (0.0 to 1.0).
        - weight : int, default 3 - Stroke width in pixels.
        - opacity : float, default 1.0 - Stroke opacity (0.0 to 1.0).
        - popup_fields / tooltip_fields : list of str - Property names to display.
          Defaults to every property.
        - popup_names / tooltip_names : list of str - Display labels for those fields,
          matched by position (e.g. fields=["pop_2020"], names=["Population"]).
          If they cannot be lined up, a warning is issued and the raw column
          names are used.
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
    display_config = extract_display_config(kwargs, name)


    # Parse polygon coordinates
    explicit_style, static_style = pop_style_options(kwargs, "add_polygon", "polygon")
    try:
        polygons_coords, props = parse_polygons(
            data,
            lat_col=lat_col,
            lon_col=lon_col,
            shape_id_col=shape_id_col,
            order_col=order_col,
            coord_order=coord_order,
            **kwargs
        )
    except TypeError as exc:
        # The registry raises for a source it cannot dispatch. Direct parse_* callers should
        # see that, but here it would escape the add_* chain and discard every layer already
        # on the map -- the same reason nothing else in this path raises.
        warn(f"add_polygon could not read the supplied data. {exc} No layer was added.")
        return self
    if not polygons_coords:
        warn(
            f"add_polygon found no polygon geometry in the supplied {type(data).__name__}. "
            f"No layer was added.",
            EmptyLayerWarning,
        )
        return self

    is_multi = len(polygons_coords) > 1
    group_specs = build_group_specs(layer_group, props)
    layer_style, feature_styles = resolve_styles(
        explicit_style, static_style, props, len(polygons_coords), {"color": "#3388ff", "fill_opacity": 0.2, "weight": 3, "opacity": 1.0})

    for i, coords in enumerate(polygons_coords):
        poly_props = {k: v[i] for k, v in props.items()} if props else {}
        if properties:
            poly_props.update(properties)

        poly_name = resolve_layer_name(name, props, i, is_multi, "Polygon")

        # Coordinates travel as a binary float64 buffer under the layer's id, exactly
        # like point layers -- never as JSON inside the layer config. Carried as
        # `locations`, 25 tracks of 200k vertices made every sidebar toggle serialise
        # ~187 MB of layers JSON per click, which is what actually crashed large maps
        # after the per-click rebuilds were already gone.
        layer_id = f"layer_{self._layer_counter}"
        self._layer_counter += 1
        self._set_layer_buffer(
            layer_id, np.asarray(coords, dtype=np.float64).flatten().tobytes())

        self.add_child({
            "id": layer_id,
            "type": "polygon",
            "name": poly_name,
            "layer_group": resolve_group_path(group_specs, props, i, "Polygon Group"),
            "group_multi_select": group_multi_select,
            "visible": True,
            "bounds": bounds_of_coords(coords),
            **(feature_styles[i] if feature_styles else layer_style),
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
