import numpy as np
from typing import Optional, Any
from ..parsers import parse_points
from ._display import extract_display_config
from ._style import resolve_styles
from ._batching import batched
from ._grouping import build_group_specs, resolve_group_path, is_column
from .._warnings import warn, EmptyLayerWarning

@batched
def add_circle_markers(
    self,
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    radius: int = 10,
    name: Optional[str] = None,
    layer_group: Optional[str] = None,
    group_multi_select: Optional[bool] = None,
    **kwargs
) -> "Map":
    """
    Adds hardware-accelerated WebGL circle point markers to the map.

    Parameters
    ----------
    data : Any
        Input dataset (Pandas/Polars DataFrame, GeoPandas, GeoJSON, GeoStructures, or list of dicts/coords).
    lat_col : str, optional
        Column name for latitude coordinates. Auto-detected if omitted.
    lon_col : str, optional
        Column name for longitude coordinates. Auto-detected if omitted.
    radius : int, default 10
        Circle marker radius in screen pixels.
    name : str, optional
        Layer name displayed in sidebar control. Can refer to a column name in `data` for dynamic naming.
    layer_group : str or list of str, optional
        Directory path string (e.g., "Sensors/Active") or list of column names to dynamically
        group points into hierarchical sidebar folders.
    group_multi_select : bool, optional
        If False, configures the parent layer group to act as mutually exclusive radio buttons.
    **kwargs
        Additional visual attributes:
        - color : str, default '#3388ff' - Circle stroke color.
        - fill_color : str, default '#3388ff' - Circle fill color.
        - fill_opacity : float, default 0.2 - Circle fill opacity (0.0 to 1.0).
        - weight : int, default 3 - Stroke line width in pixels.
        - opacity : float, default 1.0 - Stroke opacity.
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
    >>> df = pd.DataFrame({"lat": [36.01, 36.02], "lon": [-5.36, -5.35], "status": ["Active", "Inactive"]})
    >>> m.add_circle_markers(df, radius=8, color="blue", layer_group=["Status", "status"])
    """
    group_multi_select = kwargs.pop("multi_select", group_multi_select)

    # 1. Parse all coordinates and properties first
    lats, lons, props = parse_points(data, lat_col, lon_col)
    num_points = len(lats)
    if num_points == 0:
        warn(
            f"add_circle_markers found no point geometry in the supplied {type(data).__name__}. "
            f"No layer was added.",
            EmptyLayerWarning,
        )
        return self

    # 2. Check if name refers to column in props, and build group specifications
    name_is_col = is_column(name, props)
    group_specs = build_group_specs(layer_group, props)

    # Extract popup and tooltip settings
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)
    display_config = extract_display_config(kwargs, name)

    layer_style, feature_styles = resolve_styles(
        kwargs, props, num_points,
        {"color": "#3388ff", "fill_color": "#3388ff", "fill_opacity": 0.2,
         "weight": 3, "opacity": 1.0},
        "add_circle_markers")

    # 3. Group the dataset by the unique combinations of these columns/strings
    group_map = {}
    for i in range(num_points):
        g_val = resolve_group_path(group_specs, props, i, "Circle Markers Group")
        n_val = props[name][i] if name_is_col else name
        
        key = (g_val, n_val)
        if key not in group_map:
            group_map[key] = []
        group_map[key].append(i)

    # 4. Create separate layers for each group
    for (g_val, n_val), indices in group_map.items():
        sub_lats = lats[indices]
        sub_lons = lons[indices]
        
        sub_feature_styles = ([feature_styles[idx] for idx in indices]
                              if feature_styles else None)

        # Subset properties
        sub_props = {}
        for k, v in props.items():
            sub_props[k] = [v[idx] for idx in indices]

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

        # Bounding box
        min_lat = float(np.min(sub_lats))
        min_lon = float(np.min(sub_lons))
        max_lat = float(np.max(sub_lats))
        max_lon = float(np.max(sub_lons))
        sub_bounds = [[min_lat, min_lon], [max_lat, max_lon]]

        layer_meta = {
            "id": sub_layer_id,
            "type": "circle_markers",
            "name": str(n_val) if n_val is not None else "Circle Markers",
            "layer_group": str(g_val) if g_val is not None else "Circle Markers Group",
            "group_multi_select": group_multi_select,
            "visible": True,
            "radius": radius,
            **layer_style,
            "properties": sub_props_copy,
            "autobind_popup": bool(popup),
            "autobind_tooltip": bool(tooltip),
            "bounds": sub_bounds,
            **display_config,
            **kwargs
        }
        if sub_feature_styles:
            layer_meta["feature_styles"] = sub_feature_styles
        self.add_child(layer_meta)
    return self
