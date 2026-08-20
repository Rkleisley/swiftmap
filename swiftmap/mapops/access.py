"""
Layer access: finding, adding, removing, and updating layers, plus sidebar
group configuration.
"""
from typing import Any, Dict, List, Optional, Union

from .._infra import LayerConfig
from ..layers._targeting import find_layers as _find_layers


def get_layer(self, identifier: Union[str, Any], name: Optional[str] = None) -> Optional[LayerConfig]:
    """
    Finds and returns a LayerConfig object matching by ID, name, or (layer_group, name).

    Parameters
    ----------
    identifier : Union[str, Any]
        Layer ID, layer name, or layer_group folder string.
    name : str, optional
        If specified, searches for a layer matching `layer_group == identifier` and `name == name`.

    Returns
    -------
    Optional[LayerConfig]
        The matching LayerConfig object, or None if not found.
    """
    target_id = getattr(identifier, "id", identifier)
    target_name = getattr(identifier, "name", identifier)

    for l in self.layers:
        if name is not None:
            # Group and Name lookup
            if l.get("layer_group") == identifier and l.get("name") == name:
                return l
        else:
            # Name or ID lookup
            if l.get("id") == target_id or l.get("name") == target_name:
                return l
    return None


def find_layers(self, target: Any = None, **criteria) -> List[Any]:
    """
    Returns every layer matching the given criteria, looking inside groups.

    The same targeting vocabulary every layer method accepts, exposed directly for
    cases it cannot express -- combining several queries, or reading `bounds` off the
    results. For plain "act on these layers", pass the criteria to `hide` or `show`
    instead of filtering here first.

    Parameters
    ----------
    target : str or layer or list, optional
        Matches an id or a name, the same pair `get_layer` accepts.
    ids, name, types, exclude_types, group : optional
        Narrowing criteria; see `hide`. All given conditions must match.
    include_groups : bool, default False
        Include the group layers themselves, not only the geometry inside them.

    Returns
    -------
    list
        The matching layers, in map order. Empty if nothing matched.

    Examples
    --------
    >>> m.find_layers("Survey")                       # every part of a collection
    >>> m.find_layers("Survey", types="polyline")     # just its line
    >>> m.find_layers(group="Feeds")                  # everything under a folder
    """
    return _find_layers(self.layers, target, **criteria)


def add_layer(self, layer: Any) -> "Map":
    """
    Compatibility wrapper for standard Leaflet `add_layer(layer)` syntax.

    Parameters
    ----------
    layer : Any
        Layer configuration object or dictionary.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    self.add_child(layer)
    return self


def configure_group(self, group_name: str, **kwargs) -> "Map":
    """
    Configures properties and UI controls for a layer group folder in the sidebar.

    Parameters
    ----------
    group_name : str
        The folder path name of the target group (e.g., "Basemaps", "Sensor Feeds/Active").
    **kwargs
        Supported configuration keywords:
        - multi_select (bool) : If False, configures the group to render mutually exclusive
                                radio buttons instead of checkboxes.
        - group_multi_select (bool) : Alias for `multi_select`.
        - visible (bool) : Default initial visibility state for all layers in this group.
        - collapsed (bool) : Initial collapsed/expanded state of folder in sidebar tree.

    Returns
    -------
    Map
        Self reference for method chaining.

    Examples
    --------
    >>> m = Map()
    >>> # Configure Basemaps folder as mutually exclusive radio buttons
    >>> m.configure_group("Basemaps", multi_select=False)
    >>> # Force a group to be visible by default
    >>> m.configure_group("Sensor Feeds/Active", visible=True)
    """
    new_configs = dict(self.group_configs)
    group_conf = dict(new_configs.get(group_name, {}))

    for k, v in kwargs.items():
        if k in ("multi_select", "group_multi_select"):
            group_conf["multi_select"] = v
        else:
            group_conf[k] = v

    new_configs[group_name] = group_conf
    self.group_configs = new_configs
    return self


def remove_layers(self, identifiers: List[Any]) -> "Map":
    """
    Removes multiple layers from the map by layer name or ID in a single atomic transaction.

    Also cleans up associated binary coordinate float buffers from trait memory.

    Parameters
    ----------
    identifiers : List[Any]
        List of layer IDs, layer names, or LayerConfig objects to remove.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    target_ids = set()
    target_names = set()
    for item in identifiers:
        if isinstance(item, dict):
            target_ids.add(item.get("id"))
            target_names.add(item.get("name"))
        else:
            target_ids.add(getattr(item, "id", item))
            target_names.add(getattr(item, "name", item))

    with self.batch():
        kept = []
        dropped = []
        for l in self.layers:
            if l.get("id") in target_ids or l.get("name") in target_names:
                dropped.append(l)
            else:
                kept.append(l)
        if not dropped:
            return self

        self._layers_set(kept, [l.get("id") for l in dropped])

        # Buffers belong to the removed layers and to any sub-layers they nested.
        buffer_ids = set()
        for l in dropped:
            buffer_ids.add(l.get("id"))
            for sub in (l.get("layers") or []):
                sub_id = sub.get("id") if hasattr(sub, "get") else None
                if sub_id:
                    buffer_ids.add(sub_id)
        self._remove_layer_buffers(buffer_ids)
    return self


def remove_layer(self, name_or_id: Any) -> "Map":
    """
    Removes a single layer from the map by name or ID.

    Parameters
    ----------
    name_or_id : Any
        Layer ID string, layer name string, or LayerConfig object.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    return self.remove_layers([name_or_id])


def update_layer(self, identifier: Union[str, Any], name: Optional[str] = None, **kwargs) -> "Map":
    """
    Updates attributes of an existing layer (e.g. `visible`, `color`, `weight`) and triggers a sync.

    Parameters
    ----------
    identifier : Union[str, Any]
        Layer ID, layer name, or layer_group folder string.
    name : str, optional
        If specified, matches layer by `(layer_group, name)`.
    **kwargs
        Key-value attribute pairs to update on the target layer (e.g. `visible=False`, `color="blue"`).

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    target_id = getattr(identifier, "id", identifier)
    target_name = getattr(identifier, "name", identifier)

    updated_layers = []
    changed = []

    for l in self.layers:
        # Check if this is the target layer
        match = False
        if name is not None:
            if l.get("layer_group") == identifier and l.get("name") == name:
                match = True
        else:
            if l.get("id") == target_id or l.get("name") == target_name:
                match = True

        if match:
            # Create a brand-new LayerConfig instance with updated values
            new_dict = {**l.to_dict(), **kwargs}
            new_layer = LayerConfig(**new_dict)
            updated_layers.append(new_layer)
            changed.append(new_layer)
        else:
            updated_layers.append(l)

    if changed:
        with self.batch():
            self._layers_update_many(updated_layers, changed)
    return self
