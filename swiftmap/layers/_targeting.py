"""
Selecting layers to act on.

One vocabulary -- name, ids, types, group -- shared by every method that operates on
existing layers, so `hide`, `show` and anything built on them take the same arguments and
mean the same thing by them. Without this each method grows its own idea of what a target
is, and callers end up doing the filtering themselves.

It also reaches somewhere nothing else did. `add_collection` produces one layer of type
`group` holding a point, line and polygon layer inside it, and every existing lookup walks
only the top level -- so the parts of a collection had no way to be addressed at all. That
is why `types=` exists: within a collection, geometry type is the only thing telling the
three parts apart, since they deliberately share a name.
"""
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _to_dict(layer: Any) -> Dict[str, Any]:
    """Top-level layers are LayerConfig; the parts inside a group are plain dicts."""
    return layer.to_dict() if hasattr(layer, "to_dict") else dict(layer)


def _as_set(value: Any) -> Optional[frozenset]:
    """Accepts a bare string or any iterable of them, since both read naturally."""
    if value is None:
        return None
    if isinstance(value, str):
        return frozenset({value})
    return frozenset(value)


def iter_layers(layers: Iterable[Any], include_groups: bool = False):
    """
    Walks layers depth first, yielding the drawable ones.

    Group layers are containers, not geometry, so they are descended into rather than
    returned -- acting on a group means acting on its parts.
    """
    for layer in layers:
        if layer.get("type") == "group":
            if include_groups:
                yield layer
            yield from iter_layers(layer.get("layers") or [], include_groups)
        else:
            yield layer


def _identifiers(value: Any) -> frozenset:
    """A target may be given as a string, a layer object, or a mix of both in a list."""
    if value is None:
        return frozenset()
    items = value if isinstance(value, (list, tuple, set, frozenset)) else [value]
    out = set()
    for item in items:
        out.add(getattr(item, "id", None) or item)
        name = getattr(item, "name", None)
        if name is not None:
            out.add(name)
        if isinstance(item, str):
            out.add(item)
    return frozenset(o for o in out if o is not None)


def find_layers(
    layers: Iterable[Any],
    target: Any = None,
    *,
    ids: Any = None,
    name: Optional[str] = None,
    types: Any = None,
    exclude_types: Any = None,
    group: Optional[str] = None,
    include_groups: bool = False,
) -> List[Any]:
    """
    Returns every layer matching all of the given conditions, groups descended into.

    `target` is the positional shorthand and matches an id or a name, the same pair
    `get_layer` already accepts -- so `find_layers("Survey")` finds a collection's parts
    whether "Survey" is its name or its id. The keyword forms narrow from there, and an
    absent condition constrains nothing.

    `group` matches a path prefix, so "Feeds" selects "Feeds/Active" too. Layer groups are
    written as paths everywhere else, and a caller naming a folder means its contents.
    """
    wanted_ids = _identifiers(target) | _identifiers(ids)
    want_types = _as_set(types)
    skip_types = _as_set(exclude_types) or frozenset()

    found = []
    for layer in iter_layers(layers, include_groups):
        if wanted_ids and not (layer.get("id") in wanted_ids or layer.get("name") in wanted_ids):
            continue
        if name is not None and layer.get("name") != name:
            continue
        ltype = layer.get("type")
        if want_types is not None and ltype not in want_types:
            continue
        if ltype in skip_types:
            continue
        if group is not None:
            path = layer.get("layer_group") or ""
            if path != group and not path.startswith(group + "/"):
                continue
        found.append(layer)
    return found


def apply_to_layers(layers: List[Any], changes: Dict[Any, Dict[str, Any]],
                    make: Any) -> Tuple[List[Any], List[Any]]:
    """
    Rebuilds the layer list with `changes` applied by layer id, nested layers included.

    Returns `(new_layers, changed_top_level)`. Patch ops address top-level layers, so a
    change to a layer inside a group is reported as a replacement of the group itself --
    the group is a handful of entries, and expressing it any other way would need an op
    that can address a path rather than an id.

    Layers whose values already match are left untouched and excluded from the changed
    list, so a no-op call emits nothing. That matters most for the reactive callers this
    exists for, which re-run on any dependency and would otherwise resend a layer per tick.
    """
    def rebuild(layer, top=False):
        """
        Returns (layer, changed). Only top-level layers are rebuilt through `make`: the
        parts inside a group travel as plain dicts, and promoting them to LayerConfig here
        would change what the group serialises as.
        """
        wrap = make if top else dict
        if layer.get("type") == "group":
            subs = layer.get("layers") or []
            rebuilt, any_changed = [], False
            for sub in subs:
                new_sub, changed = rebuild(sub)
                rebuilt.append(new_sub)
                any_changed = any_changed or changed
            if not any_changed:
                return layer, False
            return wrap({**_to_dict(layer), "layers": rebuilt}), True

        wanted = changes.get(layer.get("id"))
        if not wanted:
            return layer, False
        if all(layer.get(k) == v for k, v in wanted.items()):
            return layer, False
        return wrap({**_to_dict(layer), **wanted}), True

    new_layers, changed_top = [], []
    for layer in layers:
        rebuilt, changed = rebuild(layer, top=True)
        new_layers.append(rebuilt)
        if changed:
            changed_top.append(rebuilt)
    return new_layers, changed_top
