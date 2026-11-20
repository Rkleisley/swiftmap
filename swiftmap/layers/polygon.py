from typing import Optional, List, Dict, Any
from ..parsers import parse_polygons
from ._display import extract_display_config
from ._style import pop_style_options, pop_data_options, resolve_styles
from .._colormaps import data_driven_colors, data_driven_legend
from ._batching import batched
from ._update import record_added_with
from ._grouping import is_column
from ._grouping import build_group_specs, resolve_feature_label
from ._packed import group_features, pack_geometry, subset_columns
from .._warnings import warn, EmptyLayerWarning
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
    geohash_col: Optional[str] = None,
    geohash_base: Optional[int] = None,
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
    - DataFrames with cell-hash columns: H3 cell ids (auto-detected, or pointed
      at via `geohash_col`/`shape_id_col`) and Niemeyer geohashes (`geohash_col`
      + `geohash_base`). A row may hold ONE hash or a LIST of them -- a list
      draws as one multipolygon feature, keeping properties per row
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
    geohash_col : str, optional
        Column holding cell hashes -- each cell drawn as its polygon. H3 cell
        ids are recognised by value and need nothing else; Niemeyer geohashes
        additionally require `geohash_base` (the same string is a valid hash
        in every base, decoding to a different rectangle in each, so the base
        is part of the format and is never guessed). A row's value may be one
        hash or a list of hashes; a list becomes one multipolygon feature.
    geohash_base : int, optional
        The Niemeyer base: 16, 32 or 64. Stating it is what makes a Niemeyer
        column parse at all; with it, the column is read as Niemeyer even if
        its strings would also validate as H3.
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
    data_opts = pop_data_options(kwargs, "add_polygon", "polygon")
    label = kwargs.pop("label", None)
    try:
        polygons_coords, props = parse_polygons(
            data,
            lat_col=lat_col,
            lon_col=lon_col,
            shape_id_col=shape_id_col,
            order_col=order_col,
            coord_order=coord_order,
            geohash_col=geohash_col,
            geohash_base=geohash_base,
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

    n = len(polygons_coords)
    group_specs = build_group_specs(layer_group, props)
    layer_style, feature_styles = resolve_styles(
        explicit_style, static_style, props, n, {"color": "#3388ff", "fill_opacity": 0.2, "weight": 3, "opacity": 1.0})

    # color_col drives BOTH the fill and the stroke: zoomed out, a polygon is
    # mostly border, and a uniform stroke over ramped fills made the classes
    # indistinguishable exactly when the map was small enough to need them.
    # An EXPLICIT color= alongside color_col is the stated exception -- ramped
    # fills under a uniform border, the old choropleth look, one kwarg away.
    # The colours ride ::colors (u8 RGBA, the points' encoding) and
    # color_col_stroke tells the renderer whether the stroke follows.
    colors_u8 = data_driven_colors(props, data_opts,
                                   layer_style.get("color", "#3388ff"), "add_polygon")
    ramp_stroke = colors_u8 is not None and "color" not in explicit_style
    legend_block = data_driven_legend(props, data_opts, layer_style.get("color", "#3388ff"))

    # One PACKED layer per (folder, name) -- the rule points follow (_packed.py).
    # A literal name is every feature in one layer, sent as one add with three
    # buffers; a name or folder from a column splits by its values. Each layer
    # used to be one feature: 9,919 H3 cells were 9,919 configs and buffers.
    fanned = is_column(name, props) or any(is_col for _, is_col in group_specs)
    for (folder, layer_name), indices in group_features(
            n, name, props, group_specs, "Polygon", "Polygon Group").items():
        layer_id = f"layer_{self._layer_counter}"
        self._layer_counter += 1
        # Coordinates travel as binary buffers under the layer's id -- never as
        # JSON in the config (25 tracks of 200k vertices once made every sidebar
        # toggle serialise ~187 MB). Holes and multipolygon parts keep their ring
        # tables per feature, so the renderer slices them back out.
        coords_b, offsets_b, rings, bounds = pack_geometry("polygon", polygons_coords, indices)
        self._set_layer_buffer(layer_id, coords_b)
        self._set_layer_buffer(f"{layer_id}::offsets", offsets_b)
        if colors_u8 is not None:
            self._set_layer_buffer(f"{layer_id}::colors",
                                   np.ascontiguousarray(colors_u8[indices]).tobytes())

        self.add_child({
            "id": layer_id,
            "type": "polygon",
            "name": layer_name,
            "layer_group": folder,
            "group_multi_select": group_multi_select,
            "visible": True,
            "feature_count": len(indices),
            **({"rings": rings} if rings else {}),
            "bounds": bounds,
            # Recorded for update_layer(data=...); see add_line. A literal name is
            # ONE layer now, so only a column-driven name or folder fans out.
            "added_with": record_added_with(
                "add_polygon",
                parser={"lat_col": lat_col, "lon_col": lon_col, "shape_id_col": shape_id_col,
                        "order_col": order_col, "coord_order": coord_order,
                        "geohash_col": geohash_col, "geohash_base": geohash_base},
                data_opts=data_opts, explicit_style=explicit_style,
                static_style=static_style, label=label, fanned=fanned,
                popup=popup, tooltip=tooltip, properties=properties),
            **layer_style,
            **({"feature_styles": [feature_styles[i] for i in indices]}
               if feature_styles else {}),
            "properties": subset_columns(props, indices, n, properties),
            "autobind_popup": bool(popup),
            "autobind_tooltip": bool(tooltip),
            **display_config,
            **kwargs,
            **({"color_col_stroke": True} if ramp_stroke else {}),
            **({"legend": legend_block} if legend_block else {}),
            **({"labels": [resolve_feature_label(label, props, i) for i in indices]}
               if label is not None else {}),
        })

    return self

# Aliases for user convenience and intuition
add_polygons = add_polygon
add_shape = add_polygon
add_shapes = add_polygon
