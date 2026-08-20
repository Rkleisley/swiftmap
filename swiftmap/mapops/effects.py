"""
Layer effects: the verbs that resolve targets and write fields -- visibility,
selection, highlights, per-feature style overrides -- all through
_set_layer_fields, the shared field-level write engine.
"""
from typing import Any, Dict, List, Optional, Union

from .._infra import LayerConfig
from .._warnings import warn
from ..layers._style import (STYLE_KEYS, POINTS, LINES, AREAS, pop_style_options,
                             warn_on_undrawn_options, normalize as normalize_style)
from ..layers._targeting import apply_to_layers


def _describe_target(target, criteria):
    """Echoes back what was asked for, so an empty match says which part missed."""
    parts = [repr(target)] if target is not None else []
    parts += [f"{k}={v!r}" for k, v in sorted(criteria.items()) if v is not None]
    return ", ".join(parts) or "no criteria"


def _set_layer_fields(self, layers: List[Any], fields: Dict[str, Any]) -> "Map":
    """
    Applies `fields` to the given layers, emitting nothing if none actually change.

    Sends one `set` op per layer rather than replacing them. A replace carries the whole
    layer, so hiding a 50k-point layer resent every property it holds -- roughly half a
    megabyte to change one boolean, on every click of a checkbox wired to a reactive.
    """
    if not layers:
        return self
    targets = [l for l in layers if l.get("id") is not None
               and any(l.get(k) != v for k, v in fields.items())]
    if not targets:
        return self

    changes = {l.get("id"): fields for l in targets}
    new_layers, _ = apply_to_layers(self.layers, changes, lambda d: LayerConfig(**d))
    self._set_trait_quietly("layers", new_layers)
    with self.batch():
        for layer in targets:
            self._emit({"op": "set", "id": layer.get("id"), "fields": dict(fields)})
    return self


def select(self, target: Any = None, *, scope: Optional[str] = None, zoom: bool = False,
           zoom_offset: int = 0, max_zoom: Optional[int] = None,
           padding: Optional[int] = None, **criteria) -> "Map":
    """
    Shows only the matching layers, hiding the rest of their scope.

    Declarative and total: each call describes the complete selection, so switching
    selections needs no undoing of the last one and `select(None)` restores everything
    in scope. Nothing about the previous selection is remembered, which is what keeps
    repeated calls from drifting.

    Parameters
    ----------
    target : str or layer or list, optional
        What to select -- ids or names, as in `hide`. An empty list clears the
        selection and shows everything in scope; so does `None` with no criteria.
        Criteria alone select, exactly as in `hide`: `select(types="polyline",
        scope="Field")` shows the lines and hides the rest of the scope.
    scope : str, optional
        The folder this selection owns. Only layers under it are hidden or restored,
        so selecting a dwell leaves an unrelated layer the user hid alone. Inferred
        from the matched layers' own groups when omitted; when clearing, an omitted
        scope means every non-basemap layer, which is rarely what you want.
    zoom : bool, default False
        Fit the viewport to the selection. Off by default: a hover should be able to
        highlight without yanking the map, and the bounds come from the layers
        themselves so nothing needs passing in.
    zoom_offset, max_zoom, padding
        Forwarded to `fit_bounds`. `zoom_offset=-1` pulls back a level so the
        selection is shown in context.
    **criteria
        Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

    Returns
    -------
    Map
        Self reference for method chaining.

    Notes
    -----
    Clearing restores everything in scope to visible rather than to whatever the user
    had set by hand. That is deliberate: with table selections and sidebar toggles
    both in play, a clean slate is easier to reason about than a restore that has to
    guess which of two intents wins.

    Examples
    --------
    >>> rows = table.cell_selection().get("rows", [])
    >>> m.select([dwell_ids[i] for i in rows], scope="Dwells",
    ...          zoom=True, zoom_offset=-1)
    >>> m.select(None, scope="Dwells")          # clean slate
    """
    # Clearing is target=None with no criteria. It used to be `if target`, which
    # sent a criteria-only call -- select(types="polyline") -- down the clear
    # branch and restored everything: the exact opposite of what was asked, and
    # the one place criteria-only worked differently from hide/show/make_time_layer.
    clearing = target is None and not criteria
    chosen = [] if clearing else self.find_layers(target, **criteria)
    if not clearing and not chosen and not (
            isinstance(target, (list, tuple, set)) and len(target) == 0):
        # An empty list is the table saying "no rows selected" -- a deliberate
        # clean slate. Anything else matching nothing is a miss worth naming,
        # though the clean slate still follows: an unmatched selection and an
        # empty one must land the same.
        warn(f"select matched nothing ({_describe_target(target, criteria)}); "
             f"restoring the scope to visible.")
    chosen_ids = {l.get("id") for l in chosen}

    if scope is not None:
        pool = self.find_layers(group=scope)
    elif chosen:
        groups = {l.get("layer_group") for l in chosen}
        pool = [l for l in self.find_layers() if l.get("layer_group") in groups]
    else:
        pool = [l for l in self.find_layers() if l.get("type") != "basemap"]

    with self.batch():
        if chosen_ids:
            self._set_layer_fields([l for l in pool if l.get("id") in chosen_ids],
                                   {"visible": True})
            self._set_layer_fields([l for l in pool if l.get("id") not in chosen_ids],
                                   {"visible": False})
        else:
            self._set_layer_fields(pool, {"visible": True})

        if zoom and chosen:
            self.fit_bounds(self.bounds_of(chosen), zoom_offset=zoom_offset,
                            max_zoom=max_zoom, padding=padding)
    return self


def highlight(self, target: Any = None, *, markers: Optional[Dict[str, Any]] = None,
              lines: Optional[Dict[str, Any]] = None,
              polygons: Optional[Dict[str, Any]] = None, **options) -> "Map":
    """
    Restyles whole layers to mark them as selected, leaving their own styling intact.

    The highlight sits in a field of its own above the layer's style and any
    data-driven per-feature styling, so clearing it restores what was underneath with
    nothing remembered and nothing to put back. Like `select`, each call states the
    whole highlight: highlighting something else drops the previous one, and
    `highlight(None)` clears every highlight on the map.

    Parameters
    ----------
    target : str or layer or list, optional
        What to highlight -- ids or names, as in `hide`. `None` clears.
    markers, lines, polygons : dict, optional
        Style overrides for one geometry family, applied over the shared options
        below. A mixed selection usually wants different treatment per shape --
        an accent colour on the points and a translucent wash on the areas -- and a
        single flat colour cannot say that.
    **options
        Shared style options applied to every matched layer -- `color`, `weight`,
        `radius`, and the rest of the vocabulary `add_*` accepts. Targeting criteria
        (`types`, `exclude_types`, `group`) are accepted here too.

    Returns
    -------
    Map
        Self reference for method chaining.

    Warns
    -----
    SwiftMapWarning
        If nothing matched, or an option cannot be drawn for a matched layer's
        geometry -- `weight` on points, say. The option is kept rather than dropped,
        so it starts working if the renderer later learns to draw it.

    Examples
    --------
    >>> m.highlight("Survey", color="#ffcc00", weight=6)
    >>> m.highlight("Survey", color="#ffcc00",
    ...             markers={"radius": 14}, polygons={"fill_opacity": 0.5})
    >>> m.highlight("Survey", color="#ffcc00", exclude_types="polyline")
    >>> m.highlight(None)                       # clear every highlight
    """
    criteria = {k: options.pop(k) for k in
                ("ids", "name", "types", "exclude_types", "group", "include_groups")
                if k in options}

    if not target:
        lit = [l for l in self.find_layers() if l.get("highlight_style")]
        return self._set_layer_fields(lit, {"highlight_style": {}}) if lit else self

    matched = self.find_layers(target, **criteria)
    if not matched:
        warn(f"highlight matched no layers ({_describe_target(target, criteria)}). "
             f"Nothing was highlighted.")
        return self

    shared, _ = pop_style_options(dict(options), "highlight")
    per_family = {"markers": markers or {}, "lines": lines or {}, "polygons": polygons or {}}
    families = {"markers": POINTS, "lines": LINES, "polygons": AREAS}

    with self.batch():
        for layer in matched:
            ltype = layer.get("type")
            merged = dict(shared)
            for family, style in per_family.items():
                if style and ltype in families[family]:
                    merged.update(normalize_style(style))
            if not merged:
                continue
            warn_on_undrawn_options(merged, "highlight", ltype)
            frontend = {STYLE_KEYS[k]: v for k, v in merged.items() if k in STYLE_KEYS}
            self._set_layer_fields([layer], {"highlight_style": frontend})

        # Anything previously lit and not in this selection goes dark, so the caller
        # never tracks what the last highlight touched.
        keep = {l.get("id") for l in matched}
        stale = [l for l in self.find_layers()
                 if l.get("highlight_style") and l.get("id") not in keep]
        if stale:
            self._set_layer_fields(stale, {"highlight_style": {}})
    return self


def set_feature_styles(self, target: Any = None, overrides: Optional[Dict[int, Any]] = None,
                       **criteria) -> "Map":
    """
    Overrides the style of individual features within the matching layers.

    Intended for transient styling -- a highlighted row, a hovered feature -- which is
    why the overrides replace whatever was set before rather than merging with it.
    Passing `{}` clears them, so a caller describes the state it wants and never has to
    remember what the previous call touched.

    Overrides sit in their own field, above both the layer's style and any per-feature
    styling from the data, so clearing one restores the underlying style with nothing
    to put back.

    Parameters
    ----------
    target : str or layer or list, optional
        Matches an id or a name, as in `hide`.
    overrides : dict, optional
        Feature index -> style dict, e.g. `{3: {"color": "#ffcc00", "radius": 14}}`.
        `None` or `{}` clears the layer's overrides.
    **criteria
        Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

    Returns
    -------
    Map
        Self reference for method chaining.

    Warns
    -----
    SwiftMapWarning
        If nothing matched.

    Examples
    --------
    >>> m.set_feature_styles("Sites", {12: {"color": "#ffcc00", "radius": 14}})
    >>> m.set_feature_styles("Sites", {})        # clear
    """
    matched = self.find_layers(target, **criteria)
    if not matched:
        warn(f"set_feature_styles matched no layers "
             f"({_describe_target(target, criteria)}). Nothing was styled.")
        return self

    wanted = {str(k): v for k, v in (overrides or {}).items()}
    targets = [l for l in matched
               if l.get("id") is not None and (l.get("style_overrides") or {}) != wanted]
    if not targets:
        return self

    changes = {l.get("id"): {"style_overrides": wanted} for l in targets}
    new_layers, _ = apply_to_layers(self.layers, changes, lambda d: LayerConfig(**d))
    self._set_trait_quietly("layers", new_layers)
    with self.batch():
        for layer in targets:
            self._emit({"op": "style", "id": layer.get("id"), "overrides": wanted})
    return self


def hide(self, target: Any = None, **criteria) -> "Map":
    """
    Hides every layer matching the criteria, including layers inside a collection.

    Parameters
    ----------
    target : str or layer or list, optional
        Matches an id or a name.
    ids : str or list, optional
        Match by id only, when a name would be ambiguous.
    name : str, optional
        Match by name only.
    types : str or list, optional
        Keep only these layer types -- 'circle_markers', 'markers', 'polyline',
        'polygon', 'circle'. Within a collection this is the only thing telling the
        parts apart, since they share a name by design.
    exclude_types : str or list, optional
        The inverse: match everything except these types.
    group : str, optional
        Match by folder path. Matches nested folders too, so "Feeds" includes
        "Feeds/Active".

    Returns
    -------
    Map
        Self reference for method chaining.

    Warns
    -----
    SwiftMapWarning
        If nothing matched. A call that quietly does nothing is the failure this is
        most likely to hide, since a mistyped name looks identical to a hidden layer.

    Examples
    --------
    >>> m.hide("Survey", types="polyline")    # drop the line from a collection
    >>> m.hide(group="Feeds/Inactive")
    >>> m.hide(ids=[l.id for l in stale])
    """
    matched = self.find_layers(target, **criteria)
    if not matched:
        warn(f"hide matched no layers ({_describe_target(target, criteria)}). "
             f"Nothing was hidden.")
        return self
    return self._set_layer_fields(matched, {"visible": False})


def show(self, target: Any = None, **criteria) -> "Map":
    """
    Shows every layer matching the criteria. The inverse of `hide`; same arguments.

    Returns
    -------
    Map
        Self reference for method chaining.

    Warns
    -----
    SwiftMapWarning
        If nothing matched.

    Examples
    --------
    >>> m.show("Survey")            # every part of a collection, line included
    >>> m.show(group="Feeds")
    """
    matched = self.find_layers(target, **criteria)
    if not matched:
        warn(f"show matched no layers ({_describe_target(target, criteria)}). "
             f"Nothing was shown.")
        return self
    return self._set_layer_fields(matched, {"visible": True})


def set_layers_visibility(self, visibility_map: Dict[Any, bool]) -> "Map":
    """
    Sets visibility states for multiple layers at once in a single atomic transaction.

    Parameters
    ----------
    visibility_map : Dict[Any, bool]
        Dictionary mapping layer names/IDs to boolean visibility states `{"Layer 1": True, "Layer 2": False}`.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    if not visibility_map:
        return self

    lookup = {}
    for identifier, visible in visibility_map.items():
        target_id = getattr(identifier, "id", identifier)
        target_name = getattr(identifier, "name", identifier)
        lookup[target_id] = visible
        lookup[target_name] = visible

    updated_layers = []
    changed = []

    for l in self.layers:
        lid = l.get("id")
        lname = l.get("name")

        target_visible = None
        if lid in lookup:
            target_visible = lookup[lid]
        elif lname in lookup:
            target_visible = lookup[lname]

        if target_visible is not None and l.get("visible") != target_visible:
            new_dict = {**l.to_dict(), "visible": target_visible}
            new_layer = LayerConfig(**new_dict)
            updated_layers.append(new_layer)
            changed.append(new_layer)
        else:
            updated_layers.append(l)

    if changed:
        with self.batch():
            self._layers_update_many(updated_layers, changed)
    return self


def set_layer_visibility(self, identifier: Union[str, Any], visible: bool, name: Optional[str] = None) -> "Map":
    """
    Sets the visibility of a layer and synchronizes the change to the client widget.

    Parameters
    ----------
    identifier : Union[str, Any]
        Layer ID or name.
    visible : bool
        Target visibility state.
    name : str, optional
        Optional layer name if matching by group.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    return self.update_layer(identifier, name=name, visible=visible)
