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


def static_group_path(
    group_specs: Sequence[Tuple[Any, bool]],
    default: str,
) -> Optional[str]:
    """
    The folder path when it does not depend on the data, else None.

    Callers resolve the path inside their per-feature loop, because a column-backed part
    makes it differ per feature. When no part is column-backed the answer is identical for
    every feature -- and at 200k points per layer, rebuilding the same string 200k times
    was one of the three hot spots of large ingests. Hoist this outside the loop.
    """
    if not group_specs:
        return default
    if any(is_col for _, is_col in group_specs):
        return None
    return "/".join(str(value) for value, _ in group_specs)


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


def resolve_feature_labels(label: Any, props: Dict[str, List[Any]],
                           count: int) -> Optional[List[str]]:
    """
    One label per feature: the column's values when `label` names one, else the
    literal repeated -- the same string-or-column resolution `name` uses. None stays
    None so unlabelled layers carry nothing.
    """
    if label is None:
        return None
    if is_column(label, props):
        values = props[label]
        return ["" if v is None else str(v) for v in values[:count]]
    return [str(label)] * count


def resolve_feature_label(label: Any, props: Dict[str, List[Any]],
                          index: int) -> Optional[str]:
    """One vector feature's label, column-or-literal like resolve_feature_labels."""
    if label is None:
        return None
    if is_column(label, props):
        value = props[label][index] if index < len(props[label]) else None
        return "" if value is None else str(value)
    return str(label)


def resolve_layer_name(
    name: Optional[str],
    props: Dict[str, List[Any]],
    index: int,
    is_multi: bool,
    fallback: str,
) -> str:
    """
    Picks the display name for one feature.

    A name matching a property key takes that feature's value. A literal name is
    shared by EVERY feature the call produced, so the merge machinery collapses
    them into one sidebar entry -- 20k WKT rows under name="Zones" is one entry
    holding 20k features, not 20k numbered entries. (The old positional suffix
    kept fans distinct on purpose, from before merged collections were the good
    path; a name column is how per-feature names are asked for.)
    """
    if is_column(name, props):
        return str(props[name][index])
    if name:
        return name
    feature_props = {k: v[index] for k, v in props.items()} if props else {}
    if "name" in feature_props:
        return str(feature_props["name"])
    return fallback
