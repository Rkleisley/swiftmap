"""
Layer access: finding, adding, removing, and updating layers, plus sidebar
group configuration.
"""
from typing import Any, Dict, List, Optional, Union

from .._infra import LayerConfig
from .._warnings import warn
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


def _single_top_level(self, identifier: Any, name: Optional[str]) -> Optional[Any]:
    """
    The one top-level layer update_layer(data=...) targets, or None after an honest
    warning: a part inside a collection cannot be swapped in place (v1), and no
    match at all is worth naming.
    """
    target_id = getattr(identifier, "id", identifier)
    target_name = getattr(identifier, "name", identifier)
    for l in self.layers:
        if name is not None:
            if l.get("layer_group") == identifier and l.get("name") == name:
                return l
        elif l.get("id") == target_id or l.get("name") == target_name:
            return l
    if self.find_layers(identifier):
        warn(f"update_layer: {identifier!r} is a part inside a collection. Updating a "
             f"collection's parts in place is not supported yet -- remove and re-add "
             f"the collection. Nothing changed.")
    else:
        warn(f"update_layer: no layer named {identifier!r}. Nothing changed.")
    return None


def update_layer(self, identifier: Union[str, Any], name: Optional[str] = None, *,
                 data: Any = None, append: bool = False, **kwargs) -> "Map":
    """
    Updates an existing layer in place: its attributes, or with `data=`, its data.

    With `data=`, the layer keeps its identity -- id, name, group, visibility, time
    animation, highlights -- while its data changes: the new data is parsed through
    the same parser family the layer was built with, and every data-derived piece
    (coordinate buffers, `color_col`/`radius_col` colours and sizes, the legend
    block, labels, bounds) re-derives from it. `append=True` grows a point layer
    instead of replacing it -- the live-feed primitive. Without `data=`, the given
    attributes are set, as before.

    Parameters
    ----------
    identifier : Union[str, Any]
        Layer ID, layer name, or layer_group folder string.
    name : str, optional
        If specified, matches layer by `(layer_group, name)`.
    data : Any, optional
        New data for the layer, in any form the layer's add_* method accepts.
    append : bool, default False
        With `data=`, add the new features after the existing ones rather than
        replacing them. Point layers only: a single line or polygon has nothing to
        append to. Existing feature indices stay valid under append, so per-feature
        style overrides survive it; a replace clears them (with a warning), since
        the indices no longer correspond. Auto-ranged colormaps and radii rescale
        over the whole appended data.

        An append sends the delta, never the layer: the new tail of the
        coordinate and ::times buffers, only the new rows of the property lists,
        and the small fields (bounds, legend) -- so a tick's frame is proportional
        to the batch and flat across the life of the feed. ::colors and ::radii
        follow the range: with an explicit vmin/vmax, or an auto range that did
        not move, the existing values are unchanged and only the tail goes; an
        auto range that moved changes every value and the buffer goes in full
        (decided by comparing the recomputed values against what the client
        holds, not by guessing). A per-feature `style` column takes the full
        path, since its styles resolve over the whole set.
    **kwargs
        Attribute updates (`visible=False`, `color="blue"`); with `data=`, the parser
        options `lat_col`, `lon_col`, `coord_order`, `line_id_col`, `order_col`,
        `shape_id_col` are forwarded to the parser instead.

    Returns
    -------
    Map
        Self reference for method chaining.

    Warns
    -----
    SwiftMapWarning
        If the target is a collection or was fanned out from a column (one of several
        sibling layers -- not updatable in place yet), the data holds no geometry of
        the layer's kind, or a time property the layer animates on is missing from
        the new data (the layer stops animating).

    Notes
    -----
    A data update never moves a chosen viewport. The auto-fit union extends only
    while the map is still following its data.

    Examples
    --------
    >>> m.update_layer("Feed", data=new_df)                  # replace the data
    >>> m.update_layer("Feed", data=new_rows, append=True)   # grow it
    >>> m.update_layer("Feed", data=df, lat_col="y", lon_col="x")
    """
    if data is not None:
        from ..layers._update import PARSER_KEYS, update_layer_data
        parser_kwargs = {k: kwargs.pop(k) for k in PARSER_KEYS if k in kwargs}
        target = _single_top_level(self, identifier, name)
        if target is None:
            return self
        return update_layer_data(self, target, data, append, parser_kwargs, kwargs)

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
