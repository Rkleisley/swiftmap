from typing import Optional, List, Dict, Any
from ..parsers import parse_lines
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
def add_line(
    self,
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    line_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    arrows: Any = False,
    arrow_spacing: Any = None,
    dash: Any = None,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    properties: Optional[Dict[str, Any]] = None,
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
    - GeoStructures line shapes (`GeoLineString`, `MultiGeoLineString`), including those
      inside a collection. A `FeatureCollection` or `Track` contributes whichever of its
      shapes are line-like. A `Track` additionally requires timestamps on its shapes, but
      places no restriction on their geometry, so its contents route by shape type like any
      other collection.

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
        a distinct line feature is created. May instead name a column holding WKT
        LINESTRING strings -- recognised by the values themselves -- in which case it is
        the geometry source, one line per row, and no grouping applies. This is how to
        point at a WKT column whose name the automatic guess ('wkt', 'geometry', ...)
        would miss.
    order_col : str, optional
        Column name used to sequence vertices within each line feature (e.g., 'timestamp', 'step').
    coord_order : {'auto', 'lat_lon', 'lon_lat'}, default 'auto'
        Coordinate pairing convention for raw arrays and delimited strings:
        - 'auto': Range-based heuristic. A first value beyond ±90° can only be a longitude,
          so the whole dataset is read lon-first; absent that evidence anywhere in the
          data, it is read lat-first. The decision is made once and applied to every
          coordinate, so no part of a layer can be transposed away from the rest.
        - 'lon_lat': GIS standard (X = Longitude, Y = Latitude).
        - 'lat_lon': Traditional format (Y = Latitude, X = Longitude).

        WKT values declare their own axis order and are never subject to the heuristic.
    arrows : bool or str, default False
        Direction arrows along each line. True spaces them evenly in screen
        pixels, so the number on screen stays steady at every zoom; 'segments'
        draws one per leg (thinned only when a leg is too short on screen);
        'end' draws only the terminal cap. Every mode always draws the end
        cap, so a line declares its direction at any zoom.
    arrow_spacing : int, float or str, optional
        The spacing grid for `arrows=True`: screen pixels (120, '120px') or a
        ground distance ('500m', '2km'). Default 120 pixels.
    dash : str or list, optional
        An on,off pixel pair ('8 4' or [8, 4]) patterning the stroke,
        screen-stable at every zoom.
    name : str, optional
        Layer name displayed in the sidebar control. If it matches a property key in the
        data, each line is named from its own value of that property.
    layer_group : str or list of str, optional
        Folder path for the sidebar tree (e.g. "Tracks/Active"), or a list of parts. Any
        part matching a property key resolves per line, so `["Tracks", "status"]` files
        each line under its own status.
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    properties : dict, optional
        Feature attribute metadata dictionary for popups and tooltips; recorded, so
        `update_layer(data=...)` keeps it.
    **kwargs
        Styling and behaviour options. Anything not listed here is forwarded to the layer
        unchanged, so custom metadata reaches the frontend; an option close to a real name
        (e.g. 'colour') is reported as a likely typo.
        - color : str, default '#3388ff' - Hex string or CSS color name for the line.
        - weight : int, default 3 - Line width in pixels.
        - opacity : float, default 1.0 - Line opacity (0.0 to 1.0).
        - popup : bool, default True - Enables popups on click.
        - tooltip : bool, default True - Enables tooltips on hover.
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
    display_config = extract_display_config(kwargs, name)


    explicit_style, static_style = pop_style_options(kwargs, "add_line", "polyline")
    data_opts = pop_data_options(kwargs, "add_line", "polyline")
    label = kwargs.pop("label", None)
    try:
        lines_coords, props = parse_lines(
            data,
            lat_col=lat_col,
            lon_col=lon_col,
            line_id_col=line_id_col,
            order_col=order_col,
            coord_order=coord_order,
            **kwargs
        )
    except TypeError as exc:
        # The registry raises for a source it cannot dispatch. Direct parse_* callers should
        # see that, but here it would escape the add_* chain and discard every layer already
        # on the map -- the same reason nothing else in this path raises.
        warn(f"add_line could not read the supplied data. {exc} No layer was added.")
        return self
    if not lines_coords:
        warn(
            f"add_line found no line geometry in the supplied {type(data).__name__}. "
            f"No layer was added.",
            EmptyLayerWarning,
        )
        return self

    n = len(lines_coords)
    group_specs = build_group_specs(layer_group, props)
    layer_style, feature_styles = resolve_styles(
        explicit_style, static_style, props, n, {"color": "#3388ff", "weight": 3, "opacity": 1.0})

    # color_col: per-feature colours ride ::colors (u8 RGBA, the points' encoding);
    # on a line the colour IS the stroke, so no flag is needed.
    colors_u8 = data_driven_colors(props, data_opts,
                                   layer_style.get("color", "#3388ff"), "add_line")
    legend_block = data_driven_legend(props, data_opts, layer_style.get("color", "#3388ff"))

    # Direction and pattern decoration. `arrows` is a placement vocabulary:
    # True spaces chevrons evenly in SCREEN pixels, so the on-screen count is
    # locked at every zoom (a dense track zoomed out shows a handful, never a
    # blob); "segments" is one per leg for sparse geometry; "end" is caps
    # only. Every mode always shows the end cap. `arrow_spacing` tunes the
    # grid -- pixels (120, "120px") or ground distance ("500m", "2km").
    # `dash` is an on,off pixel pair ("8 4" or [8, 4]), screen-stable at
    # every zoom.
    arrow_mode = None
    if arrows:
        if arrows is True or arrows == "spacing":
            arrow_mode = "spacing"
        elif arrows in ("end", "segments"):
            arrow_mode = arrows
        else:
            warn(f"add_line: arrows must be True, 'end', or 'segments' -- got "
                 f"{arrows!r}. Drawing spaced arrows.")
            arrow_mode = "spacing"
    spacing_px = spacing_m = None
    if arrow_spacing is not None:
        if arrow_mode != "spacing":
            warn("add_line: arrow_spacing applies to spaced arrows only "
                 "(arrows=True). Ignored.")
        else:
            try:
                if isinstance(arrow_spacing, str):
                    s = arrow_spacing.strip().lower().replace(" ", "")
                    if s.endswith("km"):
                        spacing_m = float(s[:-2]) * 1000.0
                    elif s.endswith("px"):
                        spacing_px = float(s[:-2])
                    elif s.endswith("m"):
                        spacing_m = float(s[:-1])
                    else:
                        spacing_px = float(s)
                else:
                    spacing_px = float(arrow_spacing)
            except (TypeError, ValueError):
                pass
            if not ((spacing_px or 0) > 0 or (spacing_m or 0) > 0):
                warn(f"add_line: arrow_spacing must be pixels (120, '120px') "
                     f"or a ground distance ('500m', '2km') -- got "
                     f"{arrow_spacing!r}. Using the default spacing.")
                spacing_px = spacing_m = None
            elif not ((spacing_px or 0) > 0):
                spacing_px = None
            else:
                spacing_m = None
    dash_list = None
    if dash is not None:
        try:
            raw = dash.replace(",", " ").split() if isinstance(dash, str) else list(dash)
            parts = [float(x) for x in raw]
        except (TypeError, ValueError):
            parts = []
        if len(parts) >= 2 and parts[0] > 0 and parts[1] > 0:
            dash_list = parts[:2]
        else:
            warn(f"add_line: dash must give an on,off pixel pair -- dash='8 4' or "
                 f"dash=[8, 4] -- got {dash!r}. Drawing solid.")

    # One PACKED layer per (folder, name) -- see add_polygon and _packed.py. A
    # multi-part line (MULTILINESTRING, MultiLineString) keeps its part lengths
    # per feature, so no segment is ever drawn between its parts.
    fanned = is_column(name, props) or any(is_col for _, is_col in group_specs)
    for (folder, layer_name), indices in group_features(
            n, name, props, group_specs, "Line", "Line Group").items():
        layer_id = f"layer_{self._layer_counter}"
        self._layer_counter += 1
        coords_b, offsets_b, parts, bounds = pack_geometry("polyline", lines_coords, indices)
        self._set_layer_buffer(layer_id, coords_b)
        self._set_layer_buffer(f"{layer_id}::offsets", offsets_b)
        if colors_u8 is not None:
            self._set_layer_buffer(f"{layer_id}::colors",
                                   np.ascontiguousarray(colors_u8[indices]).tobytes())

        self.add_child({
            "id": layer_id,
            "type": "polyline",
            "name": layer_name,
            "layer_group": folder,
            "group_multi_select": group_multi_select,
            "visible": True,
            "feature_count": len(indices),
            **({"arrows": arrow_mode} if arrow_mode else {}),
            **({"arrow_spacing_px": spacing_px} if spacing_px else {}),
            **({"arrow_spacing_m": spacing_m} if spacing_m else {}),
            **({"dash": dash_list} if dash_list else {}),
            **({"parts": parts} if parts else {}),
            "bounds": bounds,
            # Recorded for update_layer(data=...). A column-driven name or folder
            # makes this one of several sibling layers.
            "added_with": record_added_with(
                "add_line",
                parser={"lat_col": lat_col, "lon_col": lon_col, "line_id_col": line_id_col,
                        "order_col": order_col, "coord_order": coord_order},
                data_opts=data_opts, explicit_style=explicit_style,
                static_style=static_style, label=label, fanned=fanned,
                popup=popup, tooltip=tooltip, properties=properties),
            **layer_style,
            **({"feature_styles": [feature_styles[i] for i in indices]}
               if feature_styles else {}),
            # An explicit constant merges over parsed columns and is RECORDED, so
            # update_layer(data=...) keeps it (the authoring goldens caught it
            # vanishing once, when it rode **kwargs instead).
            "properties": subset_columns(props, indices, n, properties),
            "autobind_popup": bool(popup),
            "autobind_tooltip": bool(tooltip),
            **display_config,
            **kwargs,
            **({"legend": legend_block} if legend_block else {}),
            **({"labels": [resolve_feature_label(label, props, i) for i in indices]}
               if label is not None else {}),
        })

    return self

# Alias for Leaflet / Folium compatibility
add_polyline = add_line
