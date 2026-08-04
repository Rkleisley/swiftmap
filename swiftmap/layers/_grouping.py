from typing import Any, Dict, List, Optional, Sequence, Tuple


def build_group_specs(layer_group: Any, props: Dict[str, List[Any]]) -> List[Tuple[Any, bool]]:
    """
    Splits `layer_group` into (value, is_column) parts.

    A part naming a key in `props` resolves per feature -- `["Sites", "zone"]` becomes
    "Sites/North" for a feature whose zone is North. Anything else is a literal folder
    name. This is what lets one call fan out into a folder tree driven by the data.
    """
    if layer_group is None:
        return []
    if isinstance(layer_group, (list, tuple)):
        return [(part, part in props) for part in layer_group if part is not None]
    return [(layer_group, layer_group in props)]


def resolve_group_path(
    group_specs: Sequence[Tuple[Any, bool]],
    props: Dict[str, List[Any]],
    index: int,
    default: str,
) -> str:
    """Builds the sidebar folder path for one feature, resolving column-backed parts."""
    if not group_specs:
        return default
    parts = [
        str(props[value][index]) if is_column else str(value)
        for value, is_column in group_specs
    ]
    return "/".join(parts)


def is_column(name: Optional[str], props: Dict[str, List[Any]]) -> bool:
    """True if `name` refers to a property key rather than a literal layer name."""
    return name is not None and bool(props) and name in props


def resolve_layer_name(
    name: Optional[str],
    props: Dict[str, List[Any]],
    index: int,
    is_multi: bool,
    fallback: str,
) -> str:
    """
    Picks the display name for one feature.

    A name matching a property key takes that feature's value. A literal name gains a
    positional suffix when the call produced several features, so they stay distinct in
    the sidebar instead of merging under one entry.
    """
    if is_column(name, props):
        return str(props[name][index])
    if name:
        return f"{name} {index + 1}" if is_multi else name
    feature_props = {k: v[index] for k, v in props.items()} if props else {}
    if "name" in feature_props:
        return str(feature_props["name"])
    return f"{fallback} {index + 1}" if is_multi else fallback
