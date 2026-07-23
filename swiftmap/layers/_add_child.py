from typing import Any, Optional
from .._infra import LayerConfig

def add_child(self, child: Any, name: Optional[str] = None, layer_group: Optional[str] = None, group_multi_select: Optional[bool] = None) -> "Map":
    """Adds a layer or configuration metadata config directly to the map's layers list."""
    if isinstance(child, dict):
        child_config = LayerConfig(**child)
    elif isinstance(child, LayerConfig):
        child_config = child
    else:
        child_config = LayerConfig(
            id=getattr(child, "id", None),
            type=getattr(child, "type", "custom"),
            name=name or getattr(child, "name", None),
            layer_group=layer_group or getattr(child, "layer_group", None),
            group_multi_select=group_multi_select,
            visible=getattr(child, "visible", True)
        )
        
    # Ensure ID and name are present
    if not child_config.id:
        child_config.id = f"layer_{self._layer_counter}"
        self._layer_counter += 1
    if not child_config.name:
        child_config.name = f"Layer {child_config.id}"
    if not child_config.layer_group:
        child_config.layer_group = "Layers"
    elif isinstance(child_config.layer_group, (list, tuple)):
        child_config.layer_group = "/".join(str(part) for part in child_config.layer_group if part is not None)
        
    # Resolve group_multi_select if not yet resolved
    explicit_multi_select = group_multi_select
    if explicit_multi_select is None:
        if isinstance(child, dict) and "group_multi_select" in child:
            explicit_multi_select = child["group_multi_select"]
        elif hasattr(child, "group_multi_select"):
            explicit_multi_select = getattr(child, "group_multi_select")
            
    group_multi_select = explicit_multi_select
    if group_multi_select is None:
        if child_config.layer_group == "Basemaps":
            group_multi_select = False
        else:
            group_multi_select = True

    # Centralize group-level multi_select configuration into self.group_configs
    if child_config.layer_group and group_multi_select is not None:
        new_configs = dict(self.group_configs)
        is_new_group = child_config.layer_group not in new_configs or "multi_select" not in new_configs[child_config.layer_group]
        if is_new_group or explicit_multi_select is not None:
            group_conf = dict(new_configs.get(child_config.layer_group, {}))
            group_conf["multi_select"] = group_multi_select
            new_configs[child_config.layer_group] = group_conf
            self.group_configs = new_configs
            
    # If the group is single-select, ensure only one layer inside it is visible initially
    group_info = self.group_configs.get(child_config.layer_group, {})
    if group_info.get("multi_select") == False:
        has_visible = any(
            l.get("layer_group") == child_config.layer_group and l.get("visible", True)
            for l in self.layers
        )
        if has_visible:
            child_config.visible = False
            
    # Clean up any child-level group configuration attributes so they are not synced on the child
    attr = "group_multi_select"
    if attr in child_config.__dict__:
        del child_config.__dict__[attr]
    if isinstance(child, dict) and attr in child:
        del child[attr]

    # Check if an overlay layer with the same name and layer_group already exists to auto-merge them
    existing = None
    if child_config.layer_group != "Basemaps":
        for l in self.layers:
            if l.get("layer_group") == child_config.layer_group and l.get("name") == child_config.name:
                existing = l
                break

    if existing is not None:
        # Create a new LayerConfig instance to force traitlets serialization change detection
        new_config = LayerConfig(**existing.to_dict())
        
        # Convert existing to a group type if it is not one already
        existing_type = new_config.get("type")
        if existing_type != "group":
            # Convert the single layer config to a nested layer dict
            sub_layer = {
                "id": new_config.get("id"),
                "type": existing_type,
                "name": new_config.get("name") or "Sub-layer",
                "visible": new_config.get("visible", True),
            }
            # Copy other attributes
            for attr in ("radius", "color", "fill_color", "fillColor", "fill_opacity", "fillOpacity", "weight", "opacity", "popup_str", "tooltip_str", "properties", "locations", "location", "geojson", "autobind_popup", "autobind_tooltip"):
                val = new_config.get(attr)
                if val is not None:
                    sub_layer[attr] = val
            
            # Update to be a group type
            new_config.type = "group"
            new_config.layers = [sub_layer]
            # Remove individual layer attributes from group level
            for attr in ("radius", "color", "fill_color", "fillColor", "fill_opacity", "fillOpacity", "weight", "opacity", "popup_str", "tooltip_str", "properties", "locations", "location", "geojson"):
                if attr in new_config.__dict__:
                    del new_config.__dict__[attr]
        
        # Append the new child_config
        if child_config.get("type") == "group":
            new_config.layers = new_config.layers + child_config.get("layers", [])
        else:
            sub_layer = {
                "id": child_config.id,
                "type": child_config.type,
                "name": child_config.name,
                "visible": child_config.visible,
            }
            for attr in ("radius", "color", "fill_color", "fillColor", "fill_opacity", "fillOpacity", "weight", "opacity", "popup_str", "tooltip_str", "properties", "locations", "location", "geojson", "autobind_popup", "autobind_tooltip"):
                val = getattr(child_config, attr, None)
                if val is not None:
                    sub_layer[attr] = val
            new_config.layers = new_config.layers + [sub_layer]
            
        # Replace the old reference inside the layers list with our new instance
        self.layers = [l if l is not existing else new_config for l in self.layers]
        return self

    self.layers = self.layers + [child_config]
    return self
