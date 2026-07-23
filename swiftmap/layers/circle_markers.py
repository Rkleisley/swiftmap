import numpy as np
from typing import Optional, Any
from .._parser import _parse_coordinates

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
):
    group_multi_select = kwargs.pop("multi_select", group_multi_select)

    # 1. Parse all coordinates and properties first
    lats, lons, props, _ = _parse_coordinates(data, lat_col, lon_col)
    num_points = len(lats)
    if num_points == 0:
        return self

    # 2. Check if name refers to column in props, and build group specifications
    name_is_col = name is not None and name in props
    if isinstance(layer_group, (list, tuple)):
        group_specs = [(part, part in props) for part in layer_group if part is not None]
    else:
        group_specs = [(layer_group, layer_group is not None and layer_group in props)] if layer_group is not None else []

    # Extract popup and tooltip settings
    popup = kwargs.pop("popup", True)
    tooltip = kwargs.pop("tooltip", True)

    # Resolve colors, weight, opacity etc from kwargs
    color = kwargs.pop("color", "#3388ff")
    fillColor = kwargs.pop("fill_color", kwargs.pop("fillColor", "#3388ff"))
    fillOpacity = kwargs.pop("fill_opacity", kwargs.pop("fillOpacity", 0.2))
    weight = kwargs.pop("weight", 3)
    opacity = kwargs.pop("opacity", 1.0)

    # 3. Group the dataset by the unique combinations of these columns/strings
    group_map = {}
    for i in range(num_points):
        path_parts = []
        for val, is_col in group_specs:
            if is_col:
                path_parts.append(str(props[val][i]))
            else:
                path_parts.append(str(val))
        
        g_val = "/".join(path_parts) if path_parts else "Circle Markers Group"
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
            "type": "circle_markers",
            "name": str(n_val) if n_val is not None else "Circle Markers",
            "layer_group": str(g_val) if g_val is not None else "Circle Markers Group",
            "group_multi_select": group_multi_select,
            "visible": True,
            "radius": radius,
            "color": color,
            "fillColor": fillColor,
            "fillOpacity": fillOpacity,
            "weight": weight,
            "opacity": opacity,
            "properties": sub_props_copy,
            "autobind_popup": bool(popup),
            "autobind_tooltip": bool(tooltip),
            "bounds": sub_bounds,
            **kwargs
        }
        self.add_child(layer_meta)
    return self
