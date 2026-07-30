import numpy as np
from typing import Optional, Any
from ..parsers.points import parse_points

def add_markers(
    self,
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
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
    lats, lons, props, _ = parse_points(data, lat_col, lon_col)
    num_points = len(lats)
    if num_points == 0:
        return self

    # 2. Determine which components of layer_group are dynamic column names vs static strings
    name_is_col = name is not None and name in props
    
    if isinstance(layer_group, (list, tuple)):
        group_specs = [(part, part in props) for part in layer_group if part is not None]
    else:
        group_specs = [(layer_group, layer_group is not None and layer_group in props)] if layer_group is not None else []

    # Extract popup and tooltip settings
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)

    # 3. Group the dataset by the unique combinations of these path strings and names
    group_map = {}
    for i in range(num_points):
        path_parts = []
        for val, is_col in group_specs:
            if is_col:
                path_parts.append(str(props[val][i]))
            else:
                path_parts.append(str(val))
        
        g_val = "/".join(path_parts) if path_parts else "Markers Group"
        n_val = props[name][i] if name_is_col else name
        
        key = (g_val, n_val)
        if key not in group_map:
            group_map[key] = []
        group_map[key].append(i)

    # 4. Create separate layers for each group
    for (g_val, n_val), indices in group_map.items():
        sub_lats = lats[indices]
        sub_lons = lons[indices]
        
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
        self.coordinate_buffers = {**self.coordinate_buffers, sub_layer_id: sub_coords.tobytes()}

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
            **kwargs
        }
        self.add_child(layer_meta)
    return self
