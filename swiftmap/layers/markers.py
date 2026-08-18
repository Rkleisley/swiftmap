import numpy as np
from typing import Optional, Any
from ..parsers import parse_points
from ._display import extract_display_config
from ._style import pop_style_options, pop_data_options, resolve_styles
from .._colormaps import data_driven_colors, data_driven_radii, data_driven_legend
from ._batching import batched
from ._grouping import build_group_specs, resolve_group_path, is_column, static_group_path
from .._warnings import warn, EmptyLayerWarning

@batched
def add_markers(
    self,
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    coord_order: str = "auto",
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    **kwargs
) -> "Map":
    """
    Adds hardware-accelerated WebGL pin icon markers to the map.

    Uses a custom GLSL fragment shader (hardware-rendered, anti-aliased pin icon 
    with drop-shadow overlays) capable of rendering hundreds of thousands of markers at 60 FPS.

    Parameters
    ----------
    data : Any
        Input dataset (Pandas/Polars DataFrame, GeoPandas, GeoJSON, GeoStructures, or list of dicts/coords).
    lat_col : str, optional
        Column name for latitude coordinates. Auto-detected if omitted.
    lon_col : str, optional
        Column name for longitude coordinates. Auto-detected if omitted.
    coord_order : {'auto', 'lat_lon', 'lon_lat'}, default 'auto'
        Coordinate pairing convention, used only for raw coordinate lists. Every other
        source states its own axis order -- named lat/lon columns, WKT, the GeoJSON spec,
        a typed geometry -- and ignores this.
        - 'auto': Range-based heuristic. A first value beyond +/-90 can only be a longitude,
          so the whole dataset is read lon-first; absent that evidence anywhere in the data,
          it is read lat-first. The decision is made once and applied to every coordinate.
        - 'lon_lat': GIS standard (X = Longitude, Y = Latitude).
        - 'lat_lon': Traditional format (Y = Latitude, X = Longitude).
    name : str, optional
        Layer name displayed in sidebar control. Can refer to a column name in `data` for dynamic naming.
    layer_group : str or list of str, optional
        Directory path string (e.g., "Sensors/Active") or list of column names to dynamically
        group points into hierarchical sidebar folders.
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    **kwargs
        Additional attributes:
        - color : str, default 'red' - Pin icon color.
        - popup : bool or dict, default True - Enables popups on click.
        - tooltip : bool or dict, default True - Enables tooltips on hover.
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
    >>> m = Map()
    >>> df = pd.DataFrame({"lat": [34.05, 37.77], "lon": [-118.24, -122.41], "city": ["LA", "SF"]})
    >>> m.add_markers(df, name="California Cities", color="red")
    """
    group_multi_select = kwargs.pop("multi_select", group_multi_select)

    # 1. Parse all coordinates and properties first
    explicit_style, static_style = pop_style_options(kwargs, "add_markers", "markers")
    data_opts = pop_data_options(kwargs, "add_markers", "markers")
    try:
        lats, lons, props = parse_points(data, lat_col, lon_col, coord_order=coord_order)
    except TypeError as exc:
        # The registry raises for a source it cannot dispatch. Direct parse_* callers should
        # see that, but here it would escape the add_* chain and discard every layer already
        # on the map -- the same reason nothing else in this path raises.
        warn(f"add_markers could not read the supplied data. {exc} No layer was added.")
        return self
    num_points = len(lats)
    if num_points == 0:
        warn(
            f"add_markers found no point geometry in the supplied {type(data).__name__}. "
            f"No layer was added.",
            EmptyLayerWarning,
        )
        return self

    # 2. Determine which components of layer_group are dynamic column names vs static strings
    name_is_col = is_column(name, props)
    group_specs = build_group_specs(layer_group, props)

    # Extract popup and tooltip settings
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)
    display_config = extract_display_config(kwargs, name)
    layer_style, feature_styles = resolve_styles(
        explicit_style, static_style, props, num_points, {"color": "#e61a26"})

    # Data-driven styling rides binary buffers, exactly as in add_circle_markers.
    colors_u8 = data_driven_colors(props, data_opts,
                                   layer_style.get("color", "#e61a26"), "add_markers")
    radii_f32 = data_driven_radii(props, data_opts, "add_markers")
    legend_block = data_driven_legend(props, data_opts)

    # 3. Group the dataset by the unique combinations of these path strings and names
    group_map = {}
    static_path = static_group_path(group_specs, "Markers Group")
    if static_path is not None and not name_is_col:
        # One group, one name: every point shares a single key, and iterating 200k times
        # to discover that was a measurable share of large ingests.
        group_map[(static_path, name)] = list(range(num_points))
    else:
        for i in range(num_points):
            g_val = (static_path if static_path is not None
                     else resolve_group_path(group_specs, props, i, "Markers Group"))
            n_val = props[name][i] if name_is_col else name
        
            key = (g_val, n_val)
            if key not in group_map:
                group_map[key] = []
            group_map[key].append(i)

    # 4. Create separate layers for each group
    for (g_val, n_val), indices in group_map.items():
        # The single-group fast path selects every point, and subsetting 200k-element
        # columns into identical copies was a measurable share of large ingests.
        whole = len(indices) == num_points
        sub_lats = lats if whole else lats[indices]
        sub_lons = lons if whole else lons[indices]

        # Styles are resolved for the whole input, so each group takes its own slice.
        sub_feature_styles = (None if not feature_styles
                              else feature_styles if whole
                              else [feature_styles[idx] for idx in indices])

        # Subset properties
        sub_props = {}
        for k, v in props.items():
            sub_props[k] = v if whole else [v[idx] for idx in indices]

        # Merge dict popups/tooltips into sub_props
        sub_props_copy = dict(sub_props)
        if isinstance(popup, dict):
            for k, v in popup.items():
                if k not in sub_props_copy:
                    sub_props_copy[k] = [v] * len(indices)
        if isinstance(tooltip, dict):
            for k, v in tooltip.items():
                if k not in sub_props_copy:
                    sub_props_copy[k] = [v] * len(indices)

        # Unique layer id
        sub_layer_id = f"layer_{self._layer_counter}"
        self._layer_counter += 1

        # Compile coordinate buffer
        sub_coords = np.column_stack((sub_lats, sub_lons)).flatten().astype(np.float64)
        self._set_layer_buffer(sub_layer_id, sub_coords.tobytes())

        if colors_u8 is not None:
            sub_colors = colors_u8 if whole else colors_u8[indices]
            self._set_layer_buffer(f"{sub_layer_id}::colors", sub_colors.tobytes())
        if radii_f32 is not None:
            sub_radii = radii_f32 if whole else radii_f32[indices]
            self._set_layer_buffer(f"{sub_layer_id}::radii", sub_radii.tobytes())

        # Bounding box
        min_lat = float(np.min(sub_lats))
        min_lon = float(np.min(sub_lons))
        max_lat = float(np.max(sub_lats))
        max_lon = float(np.max(sub_lons))
        sub_bounds = [[min_lat, min_lon], [max_lat, max_lon]]

        layer_meta = {
            "id": sub_layer_id,
            "type": "markers",
            "name": str(n_val) if n_val is not None else "Markers",
            "layer_group": str(g_val) if g_val is not None else "Markers Group",
            "group_multi_select": group_multi_select,
            "visible": True,
            "properties": sub_props_copy,
            "autobind_popup": bool(popup),
            "autobind_tooltip": bool(tooltip),
            "bounds": sub_bounds,
            **({"legend": legend_block} if legend_block else {}),
            **layer_style,
            **display_config,
            **kwargs
        }
        if sub_feature_styles:
            layer_meta["feature_styles"] = sub_feature_styles
        self.add_child(layer_meta)
    return self
