import datetime
import decimal
from typing import Any, Optional
from .._infra import LayerConfig
from ._display import DISPLAY_KEYS


# Types that pass through _json_safe unchanged. type() membership, not isinstance:
# an isinstance gate would wave numpy scalars through as float/int lookalikes, and
# np.int64 is not an int subclass -- json.dumps rejects it outright. (np.float64 does
# subclass float and would serialise, but the strict gate just costs it a recursion.)
_SAFE_SCALARS = frozenset({bool, int, float, str, type(None)})


def _json_safe(value: Any) -> Any:
    """
    Coerces a property value into something the widget transport can serialize.

    Layer properties come straight from user data, so they carry whatever the source held:
    pandas Timestamps, numpy scalars, Decimals, dates. Those survive parsing and then fail
    at sync time, inside traitlets, far from the column that caused it. Converting here --
    the single point every layer passes through -- keeps the failure from ever happening.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    # numpy scalars and anything else exposing .item() (np.int64, np.float32, ...)
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _json_safe(item())
        except (ValueError, TypeError):
            pass
    if isinstance(value, (list, tuple)):
        # A property column from a 200k-row frame is usually a plain list of ints or
        # strings, and recursing per element re-derived "already safe" 200k times -- one
        # of the three hot spots of large ingests. The gate is a full pass over the
        # element types at C speed, not a sample: one pandas Timestamp past a sampled
        # head would revive exactly the far-from-cause sync failure this function exists
        # to prevent. bool is fine here -- True serialises as true.
        if isinstance(value, list) and not set(map(type, value)) - _SAFE_SCALARS:
            return value
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    return str(value)

# Per-layer attributes relocated onto a sub-layer when same-name layers merge into a group.
_SUB_LAYER_ATTRS = (
    "radius", "color", "fill_color", "fillColor", "fill_opacity", "fillOpacity",
    "weight", "opacity", "popup_str", "tooltip_str", "properties", "locations",
    "location", "geojson", "rings", "legend",
) + DISPLAY_KEYS

# Same set, plus the flags that are carried down but not stripped from the group.
_COPY_ATTRS = _SUB_LAYER_ATTRS + ("autobind_popup", "autobind_tooltip")

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
        
    # Every layer passes through here, so this is the one place that has to guarantee
    # properties can cross the wire.
    if isinstance(child_config.get("properties"), dict):
        child_config.properties = {
            str(k): _json_safe(v) for k, v in child_config.properties.items()
        }

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

    # Check if an overlay layer with the same name and layer_group already exists to
    # auto-merge them. Through the map's index, never a scan: per-add scans made bulk
    # adds quadratic (35M attribute reads for a 6k-polygon ingest).
    existing = None
    if child_config.layer_group != "Basemaps":
        existing = self._merge_lookup(child_config.layer_group, child_config.name)

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
            for attr in _COPY_ATTRS:
                val = new_config.get(attr)
                if val is not None:
                    sub_layer[attr] = val
            
            # Update to be a group type
            new_config.type = "group"
            new_config.layers = [sub_layer]
            # Remove individual layer attributes from group level
            for attr in _SUB_LAYER_ATTRS:
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
            for attr in _COPY_ATTRS:
                val = getattr(child_config, attr, None)
                if val is not None:
                    sub_layer[attr] = val
            new_config.layers = new_config.layers + [sub_layer]
            
        # Replace the old reference inside the layers list with our new instance
        self._layers_replace(existing, new_config)
        self._auto_fit_extend(child_config)
        return self

    self._layers_append(child_config)
    self._auto_fit_extend(child_config)
    return self
