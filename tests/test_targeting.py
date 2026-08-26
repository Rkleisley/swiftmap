"""
Layer targeting: find_layers, hide, show.

The case that motivated it: `add_collection` produces one layer of type `group` holding a
point, line and polygon layer, and every existing lookup walked only the top level. The
parts of a collection could not be addressed at all -- so "highlight this survey but not
its line" had nowhere to start. They deliberately share a name, which is why geometry type
is the thing that tells them apart.
"""
import warnings

import pytest

import swiftmap
from swiftmap._warnings import SwiftMapWarning

FC = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-5.3, 36.0]},
     "properties": {}},
    {"type": "Feature", "geometry": {"type": "LineString",
                                     "coordinates": [[-5.3, 36.0], [-5.2, 36.1]]},
     "properties": {}},
    {"type": "Feature", "geometry": {"type": "Polygon",
                                     "coordinates": [[[-5.3, 36.0], [-5.2, 36.0],
                                                      [-5.2, 36.1], [-5.3, 36.0]]]},
     "properties": {}},
]}


@pytest.fixture
def m():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        mp = swiftmap.Map()
        mp.add_collection(FC, name="Survey", layer_group="Field")
        mp.add_circle_markers([[36.0, -5.3]], name="Ports", layer_group="Feeds/Active")
    return mp


def kinds(layers):
    return sorted(l.get("type") for l in layers)


def group_of(m):
    return [l for l in m.layers if l.get("type") == "group"][0]


def subs(m):
    return {s["type"]: s for s in group_of(m).get("layers")}


# --- finding -------------------------------------------------------------------------
def test_a_collection_is_found_by_its_parts_not_its_wrapper(m):
    """The group is a container; acting on it means acting on the geometry inside."""
    assert kinds(m.find_layers("Survey")) == ["circle_markers", "polygon", "polyline"]


def test_a_promoted_group_has_an_id_of_its_own(m):
    # The group used to be built from its first member's config and kept that
    # member's id, so find_layers(id) was ambiguous and a write by id landed on
    # whichever of the two resolved first.
    group = group_of(m)
    member_ids = [s["id"] for s in group.get("layers")]
    assert group.get("id") not in member_ids, "the wrapper's id is nobody else's"
    assert len(set(member_ids)) == len(member_ids)
    for mid in member_ids:
        assert len(m.find_layers(mid, include_groups=True)) == 1, f"{mid} is unambiguous"
    assert [l.get("type") for l in m.find_layers(group.get("id"), include_groups=True)] == ["group"]
    # A same-name merge of two plain layers promotes the same way.
    mp = swiftmap.Map()
    mp.add_polygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]], name="Dwell 1", layer_group="Dwells")
    mp.add_circle_markers([[36.05, -5.25]], name="Dwell 1", layer_group="Dwells")
    dwell = group_of(mp)
    assert dwell.get("id") not in [s["id"] for s in dwell.get("layers")]
    assert mp.coordinate_buffers.keys() >= {s["id"] for s in dwell.get("layers")},         "the members keep the ids their buffers are filed under"


def test_a_collection_toggle_writes_back_to_the_group(m):
    # The sidebar flips the collection's own `visible` and writes the collection's
    # id. Python must land that on the group -- the members' own flags stay, as
    # they do in the frontend's mirror, where visibility is hierarchical.
    group = group_of(m)
    ops = []
    m._emit = lambda op, buffer=None: ops.append(op)
    m._handle_client_msg(None, {"kind": "swiftmap_write", "ops": [
        {"op": "set", "id": group.get("id"), "fields": {"visible": False}}]}, [])
    group = group_of(m)
    assert group.get("visible") is False, "the write landed on the collection"
    assert all(s.get("visible", True) for s in group.get("layers")),         "the members' own flags are untouched, as on the screen"
    assert ops == [{"op": "set", "id": group.get("id"), "fields": {"visible": False}}],         "re-emitted for other views, aimed at the group"
    # By name still acts on the parts, as before.
    m.hide("Survey")
    assert not any(l.get("visible", True) for l in m.find_layers("Survey"))


def test_a_field_set_addressed_to_a_group_takes_effect(m):
    # Used to recurse into the members and never touch the group itself, so the
    # set silently did nothing.
    group = group_of(m)
    m._set_layer_fields([group], {"visible": False})
    assert group_of(m).get("visible") is False
    m._set_layer_fields([group_of(m)], {"visible": False})   # a no-op emits nothing


def test_the_wrapper_is_available_when_asked_for(m):
    found = m.find_layers("Survey", include_groups=True)
    assert "group" in kinds(found)


def test_geometry_type_tells_a_collections_parts_apart(m):
    assert kinds(m.find_layers("Survey", types="polyline")) == ["polyline"]
    assert kinds(m.find_layers("Survey", exclude_types="polyline")) == \
        ["circle_markers", "polygon"]


def test_types_accepts_one_or_many(m):
    assert kinds(m.find_layers("Survey", types=["polyline", "polygon"])) == \
        ["polygon", "polyline"]


def test_a_group_path_matches_its_nested_folders(m):
    """Layer groups are paths everywhere else; naming a folder means its contents."""
    assert [l["name"] for l in m.find_layers(group="Feeds")] == ["Ports"]
    assert [l["name"] for l in m.find_layers(group="Feeds/Active")] == ["Ports"]
    assert m.find_layers(group="Feed") == [], "prefix matching is per path segment"


def test_a_group_path_reaches_a_collections_parts(m):
    # Parts carry no layer_group of their own -- the folder they live in is their
    # wrapper's. Read off each part, group-scoped operations silently skipped every
    # collection: hide(group="Field") and select(scope="Field") were no-ops here.
    assert kinds(m.find_layers(group="Field")) == \
        ["circle_markers", "polygon", "polyline"]


def test_a_target_matches_either_id_or_name(m):
    by_name = m.find_layers("Ports")
    assert len(by_name) == 1
    assert m.find_layers(by_name[0]["id"]) == by_name


def test_a_layer_object_can_be_passed_back_in(m):
    found = m.find_layers("Ports")
    assert m.find_layers(found) == found


def test_no_criteria_returns_every_drawable_layer(m):
    found = m.find_layers()
    assert all(l.get("type") != "group" for l in found)
    assert {"circle_markers", "polyline", "polygon", "basemap"} <= set(
        l.get("type") for l in found)


def test_nothing_matched_is_an_empty_list_not_an_error(m):
    assert m.find_layers("Nope") == []


# --- hiding and showing --------------------------------------------------------------
def test_hiding_one_part_of_a_collection_leaves_the_others(m):
    m.hide("Survey", types="polyline")
    state = {k: v.get("visible") for k, v in subs(m).items()}
    assert state == {"circle_markers": True, "polyline": False, "polygon": True}


def test_showing_restores_a_hidden_part(m):
    m.hide("Survey", types="polyline")
    m.show("Survey", types="polyline")
    assert subs(m)["polyline"].get("visible") is True


def test_hiding_a_collection_hides_every_part(m):
    m.hide("Survey")
    assert all(s.get("visible") is False for s in subs(m).values())


def test_a_hidden_sub_layer_stays_a_plain_dict(m):
    """Promoting it to LayerConfig would change what the group serialises as."""
    m.hide("Survey", types="polyline")
    assert all(isinstance(s, dict) for s in group_of(m).get("layers"))


def test_hide_returns_self_for_chaining(m):
    assert m.hide("Survey", types="polyline") is m


# --- what reaches the wire -----------------------------------------------------------
class Comm:
    comm_id = "c"
    kernel = True

    def __init__(self):
        self.msgs = []

    def send(self, data=None, buffers=None, **kw):
        self.msgs.append(data)

    def on_msg(self, *a, **k):
        pass

    def close(self, *a, **k):
        pass


def ops_of(comm):
    return [o for d in comm.msgs for o in (d.get("content") or {}).get("ops", [])]


def test_changing_a_nested_layer_addresses_it_directly(m):
    """
    A `set` op names the nested layer itself; the frontend descends into groups to find
    it. Sending a `replace` for the enclosing group instead would carry every sibling's
    properties along with it, which is the cost this op exists to avoid.
    """
    m.comm = Comm()
    m.comm.msgs.clear()
    m.hide("Survey", types="polyline")
    ops = ops_of(m.comm)
    line_id = subs(m)["polyline"]["id"]
    assert [o["op"] for o in ops] == ["set"]
    assert ops[0]["id"] == line_id
    assert ops[0]["fields"] == {"visible": False}
    assert "layer" not in ops[0], "no layer body -- only the changed field travels"


def test_a_second_identical_call_emits_nothing(m):
    """
    Reactive callers re-run on any dependency, so a no-op has to cost nothing. Without
    this, an unrelated input would resend a layer on every tick.
    """
    m.hide("Survey", types="polyline")
    m.comm = Comm()
    m.comm.msgs.clear()
    m.hide("Survey", types="polyline")
    assert ops_of(m.comm) == []


def test_untouched_layers_are_not_resent(m):
    m.comm = Comm()
    m.comm.msgs.clear()
    m.hide("Ports")
    ids = [o["id"] for o in ops_of(m.comm)]
    assert group_of(m)["id"] not in ids, "the collection was not involved"


# --- empty matches ------------------------------------------------------------------
def test_hiding_nothing_warns_rather_than_passing_silently(m):
    """A mistyped name and a genuinely hidden layer look identical on the map."""
    with pytest.warns(SwiftMapWarning, match="hide matched no layers"):
        m.hide("Typo")


def test_the_warning_echoes_the_criteria(m):
    with pytest.warns(SwiftMapWarning, match=r"types='circle'"):
        m.hide("Survey", types="circle")


def test_show_warns_the_same_way(m):
    with pytest.warns(SwiftMapWarning, match="show matched no layers"):
        m.show("Typo")


# --- style overrides ------------------------------------------------------------------
def test_feature_styles_travel_as_a_style_op(m):
    m.comm = Comm()
    m.comm.msgs.clear()
    m.set_feature_styles("Ports", {0: {"color": "#ffcc00", "radius": 14}})
    ops = ops_of(m.comm)
    assert [o["op"] for o in ops] == ["style"]
    assert ops[0]["overrides"] == {"0": {"color": "#ffcc00", "radius": 14}}


def test_overrides_replace_rather_than_accumulate(m):
    m.set_feature_styles("Ports", {0: {"color": "#f00"}})
    m.set_feature_styles("Ports", {1: {"color": "#0f0"}})
    layer = m.find_layers("Ports")[0]
    assert set(layer.get("style_overrides")) == {"1"}, \
        "a selection describes its whole state; the previous one needs no undoing"


def test_empty_overrides_clear_the_highlight(m):
    m.set_feature_styles("Ports", {0: {"color": "#f00"}})
    m.set_feature_styles("Ports", {})
    assert m.find_layers("Ports")[0].get("style_overrides") == {}


def test_restyling_to_the_same_thing_emits_nothing(m):
    m.set_feature_styles("Ports", {0: {"color": "#f00"}})
    m.comm = Comm()
    m.comm.msgs.clear()
    m.set_feature_styles("Ports", {0: {"color": "#f00"}})
    assert ops_of(m.comm) == []


def test_styling_can_target_one_geometry_of_a_collection(m):
    m.set_feature_styles("Survey", {0: {"color": "#f00"}}, types="polygon")
    assert subs(m)["polygon"].get("style_overrides") == {"0": {"color": "#f00"}}
    assert not subs(m)["polyline"].get("style_overrides")


def test_styling_nothing_warns(m):
    with pytest.warns(SwiftMapWarning, match="set_feature_styles matched no layers"):
        m.set_feature_styles("Typo", {0: {"color": "#f00"}})


# --- bounds and viewport --------------------------------------------------------------
@pytest.fixture
def dwells():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        mp = swiftmap.Map()
        for i in range(4):
            mp.add_circle_markers([[36.0 + i, -5.3], [36.1 + i, -5.2]],
                                  name=f"Dwell {i + 1}", layer_group="Dwells")
        mp.add_circle_markers([[40.0, -3.0]], name="Ports", layer_group="Other")
    return mp


def visible(m):
    return {l["name"]: l.get("visible") for l in m.find_layers()
            if l.get("type") != "basemap"}


def test_bounds_come_from_the_layers_themselves(dwells):
    """No coordinates need passing back in; each layer recorded its own extent."""
    assert dwells.bounds_of("Dwell 1") == [[36.0, -5.3], [36.1, -5.2]]


def test_bounds_of_several_layers_is_their_union(dwells):
    box = dwells.bounds_of(["Dwell 1", "Dwell 3"])
    assert box == [[36.0, -5.3], [38.1, -5.2]]


def test_bounds_of_nothing_is_none(dwells):
    assert dwells.bounds_of("Typo") is None


def test_fitting_to_no_bounds_does_nothing(dwells):
    """So m.fit_bounds(m.bounds_of(sel)) is safe on an empty selection."""
    # The fixture built without a view, so auto-fit has already issued a request;
    # "does nothing" means no NEW one.
    before = dict(dwells.fit_bounds_request)
    dwells.fit_bounds(None)
    assert dwells.fit_bounds_request == before


def test_fitting_the_same_bounds_twice_still_moves_the_map(dwells):
    """A viewport change is a command, not state -- the user may have panned away."""
    dwells.fit_bounds([[36.0, -5.3], [36.1, -5.2]])
    first = dwells.fit_bounds_request["seq"]
    dwells.fit_bounds([[36.0, -5.3], [36.1, -5.2]])
    assert dwells.fit_bounds_request["seq"] > first


def test_fit_options_reach_the_request(dwells):
    dwells.fit_bounds([[36.0, -5.3], [36.1, -5.2]], zoom_offset=-1, max_zoom=16, padding=20)
    req = dwells.fit_bounds_request
    assert (req["zoom_offset"], req["max_zoom"], req["padding"]) == (-1, 16, 20)


# --- select ---------------------------------------------------------------------------
def test_select_shows_the_chosen_and_hides_the_rest_of_scope(dwells):
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[1], ids[2]], scope="Dwells")
    assert visible(dwells) == {"Dwell 1": False, "Dwell 2": True, "Dwell 3": True,
                               "Dwell 4": False, "Ports": True}


def test_selecting_again_needs_no_undoing(dwells):
    """Each call describes the whole selection, so switching is one call."""
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[0]], scope="Dwells")
    dwells.select([ids[3]], scope="Dwells")
    assert visible(dwells)["Dwell 1"] is False
    assert visible(dwells)["Dwell 4"] is True


def test_clearing_restores_everything_in_scope(dwells):
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[0]], scope="Dwells")
    dwells.select(None, scope="Dwells")
    assert all(visible(dwells)[f"Dwell {i + 1}"] for i in range(4))


def test_clearing_leaves_layers_outside_the_scope_alone(dwells):
    """
    A layer the user hid by hand is not the selection's to restore. Without a scope,
    clearing a dwell selection would turn an unrelated layer back on.
    """
    dwells.hide("Ports")
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[0]], scope="Dwells")
    dwells.select(None, scope="Dwells")
    assert visible(dwells)["Ports"] is False


def test_scope_is_inferred_from_the_selection(dwells):
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[1]], zoom=False)
    assert visible(dwells)["Dwell 1"] is False, "siblings in the same group are hidden"
    assert visible(dwells)["Ports"] is True, "a different group is untouched"


def test_select_can_fit_the_view_to_what_it_selected(dwells):
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[0], ids[2]], scope="Dwells", zoom=True, zoom_offset=-1)
    req = dwells.fit_bounds_request
    assert req["bounds"] == [[36.0, -5.3], [38.1, -5.2]]
    assert req["zoom_offset"] == -1


def test_select_does_not_move_the_view_unless_asked(dwells):
    before = dict(dwells.fit_bounds_request)   # auto-fit's build-time request
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[0]], scope="Dwells")
    assert dwells.fit_bounds_request == before, "a highlight should not yank the map"


def test_a_whole_selection_is_one_patch_message(dwells):
    """Four visibility changes, one message -- the batch is what makes this per-click."""
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.comm = Comm()
    dwells.comm.msgs.clear()
    dwells.select([ids[1]], scope="Dwells")
    patches = [d for d in dwells.comm.msgs if (d.get("content") or {}).get("ops")]
    assert len(patches) == 1
    assert all(o["op"] == "set" for o in patches[0]["content"]["ops"])


def test_reselecting_the_same_rows_emits_nothing(dwells):
    ids = [l["id"] for l in dwells.find_layers(group="Dwells")]
    dwells.select([ids[1]], scope="Dwells")
    dwells.comm = Comm()
    dwells.comm.msgs.clear()
    dwells.select([ids[1]], scope="Dwells")
    assert ops_of(dwells.comm) == []


# --- highlight --------------------------------------------------------------------------
def test_highlight_leaves_the_layers_own_style_untouched(m):
    """It lives in its own field, so clearing restores what was underneath."""
    m.highlight("Survey", color="#ffcc00")
    poly = subs(m)["polygon"]
    assert poly["highlight_style"] == {"color": "#ffcc00"}
    assert poly.get("color") != "#ffcc00", "the layer's own colour is not overwritten"


def test_per_family_options_apply_to_their_geometry_only(m):
    m.highlight("Survey", color="#ffcc00",
                markers={"radius": 14}, polygons={"fill_opacity": 0.5})
    assert subs(m)["circle_markers"]["highlight_style"] == {"color": "#ffcc00", "radius": 14}
    assert subs(m)["polyline"]["highlight_style"] == {"color": "#ffcc00"}
    assert subs(m)["polygon"]["highlight_style"] == {"color": "#ffcc00", "fillOpacity": 0.5}


def test_highlighting_again_drops_the_previous_one(m):
    """Each call states the whole highlight, so nothing tracks what was lit before."""
    m.highlight("Survey", color="#ffcc00")
    m.highlight("Survey", color="#0000ff", exclude_types="polyline")
    assert subs(m)["polygon"]["highlight_style"] == {"color": "#0000ff"}
    assert not subs(m)["polyline"].get("highlight_style"), "no longer in the selection"


def test_highlight_none_clears_everything(m):
    m.highlight("Survey", color="#ffcc00")
    m.highlight(None)
    assert all(not s.get("highlight_style") for s in subs(m).values())


def test_highlight_travels_as_a_set_op(m):
    m.comm = Comm()
    m.comm.msgs.clear()
    m.highlight("Survey", color="#ffcc00", types="polygon")
    ops = ops_of(m.comm)
    assert [o["op"] for o in ops] == ["set"]
    assert ops[0]["fields"] == {"highlight_style": {"color": "#ffcc00"}}


def test_rehighlighting_identically_emits_nothing(m):
    m.highlight("Survey", color="#ffcc00")
    m.comm = Comm()
    m.comm.msgs.clear()
    m.highlight("Survey", color="#ffcc00")
    assert ops_of(m.comm) == []


def test_an_undrawable_option_warns_but_is_kept(m):
    """
    Kept rather than dropped, so it starts working if the renderer later learns to draw
    it -- the same contract the style registry sets for add_*.
    """
    with pytest.warns(SwiftMapWarning, match="'weight' does not apply to circle_markers"):
        m.highlight("Survey", color="#ffcc00", weight=6, types="circle_markers")
    assert subs(m)["circle_markers"]["highlight_style"]["weight"] == 6


def test_highlighting_nothing_warns(m):
    with pytest.warns(SwiftMapWarning, match="highlight matched no layers"):
        m.highlight("Typo", color="#ffcc00")


def test_highlight_composes_with_select_in_one_batch(m):
    m.comm = Comm()
    m.comm.msgs.clear()
    with m.batch():
        m.select("Survey", scope="Field")
        m.highlight("Survey", color="#ffcc00", types="polygon")
    patches = [d for d in m.comm.msgs if (d.get("content") or {}).get("ops")]
    assert len(patches) == 1, "visibility and styling leave together"


# --- every geometry records its own extent ---------------------------------------------
GEOMETRY_BUILDERS = [
    pytest.param(lambda m: m.add_circle_markers([[36.0, -5.3], [36.1, -5.2]], name="X"),
                 id="circle_markers"),
    pytest.param(lambda m: m.add_markers([[36.0, -5.3], [36.1, -5.2]], name="X"),
                 id="markers"),
    pytest.param(lambda m: m.add_line([[36.0, -5.3], [36.1, -5.2]], name="X"),
                 id="polyline"),
    pytest.param(lambda m: m.add_polygon([[36.0, -5.3], [36.1, -5.2], [36.0, -5.2]], name="X"),
                 id="polygon"),
    pytest.param(lambda m: m.add_circle([36.0, -5.3], radius=500, name="X"), id="circle"),
]


@pytest.mark.parametrize("build", GEOMETRY_BUILDERS)
def test_every_geometry_type_records_its_bounds(build):
    """
    Only point layers did. `bounds_of` and `select(zoom=True)` returned None for the rest
    and the map simply did not move -- accepted, plausible, silent. A new layer type must
    not be able to reintroduce that.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        mp = swiftmap.Map()
        build(mp)
    layer = mp.find_layers("X")[0]
    box = layer.get("bounds")
    assert box, f"{layer['type']} carries no bounds"
    (min_lat, min_lon), (max_lat, max_lon) = box
    assert min_lat <= max_lat and min_lon <= max_lon


@pytest.mark.parametrize("build", GEOMETRY_BUILDERS)
def test_zooming_to_any_geometry_moves_the_map(build):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        mp = swiftmap.Map()
        build(mp)
    mp.select("X", zoom=True)
    assert mp.fit_bounds_request.get("bounds"), "select(zoom=True) had nothing to fit"


def test_a_circle_encloses_its_radius():
    """Its radius is metres, not pixels, so the extent is the centre expanded outwards."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        mp = swiftmap.Map()
        mp.add_circle([36.0, -5.3], radius=1000, name="C")
    (min_lat, _), (max_lat, _) = mp.find_layers("C")[0]["bounds"]
    assert min_lat < 36.0 < max_lat
    assert 0.017 < (max_lat - min_lat) < 0.019, "~2km of latitude across"


# --- json-safety of large property columns ----------------------------------------------
def test_a_clean_column_passes_through_unchanged_by_identity():
    from swiftmap.layers._add_child import _json_safe
    col = [1, 2.5, "x", None, True] * 1000
    assert _json_safe(col) is col, "no per-element recursion for the common tabular case"


def test_one_unsafe_element_anywhere_still_coerces_the_column():
    """The gate is a full scan, not a sample: a Timestamp at the tail must be caught."""
    import datetime
    from swiftmap.layers._add_child import _json_safe
    col = [1] * 5000 + [datetime.datetime(2026, 1, 1)]
    out = _json_safe(col)
    assert out is not col
    assert out[-1] == "2026-01-01T00:00:00"


def test_numpy_ints_do_not_slip_through_the_gate():
    """
    np.int64 is not an int subclass and json.dumps rejects it outright, so a column
    holding one must fall off the fast path and be coerced. (np.float64 is harmless --
    it subclasses float and serialises -- but the type() gate treats it the same way,
    which costs a recursion and never a broken wire.)
    """
    import json
    import numpy as np
    from swiftmap.layers._add_child import _json_safe
    col = [1, np.int64(2)]
    out = _json_safe(col)
    assert out is not col, "the gate rejected the column"
    json.dumps(out)
    assert out[1] == 2 and type(out[1]) is int


# --- the frontend's toggle write-back ------------------------------------------------
# A sidebar toggle arrives as a swiftmap_write custom message naming just the flipped
# ids. It exists because the frontend used to write the whole layers trait to flip one
# boolean: 36 MB a click at 25 tracks x 200k vertices, past uvicorn's 16 MB default
# websocket frame cap, which closes the connection and ends the Shiny session.
def test_a_client_visibility_write_lands_on_the_named_layer(m):
    ports = m.find_layers("Ports")[0]
    m._handle_client_msg(m, {"kind": "swiftmap_write", "ops": [
        {"op": "set", "id": ports.get("id"), "fields": {"visible": False}}]}, None)
    assert m.find_layers("Ports")[0].get("visible") is False


def test_a_client_write_re_emits_the_flip_for_other_views(m):
    """Notebooks show one map in several outputs; the tiny `set` patch keeps them in step."""
    ports = m.find_layers("Ports")[0]
    emitted = []
    m._emit = lambda op, buffer=None: emitted.append(op)
    m._handle_client_msg(m, {"kind": "swiftmap_write", "ops": [
        {"op": "set", "id": ports.get("id"), "fields": {"visible": False}}]}, None)
    assert emitted == [
        {"op": "set", "id": ports.get("id"), "fields": {"visible": False}}]


def test_a_client_write_to_an_unknown_id_is_ignored(m):
    before = [l.get("visible") for l in m.layers]
    m._handle_client_msg(m, {"kind": "swiftmap_write", "ops": [
        {"op": "set", "id": "no-such-layer", "fields": {"visible": False}}]}, None)
    assert [l.get("visible") for l in m.layers] == before


def test_malformed_client_writes_are_safe(m):
    m._handle_client_msg(m, "not a dict", None)
    m._handle_client_msg(m, {"kind": "swiftmap_write"}, None)
    m._handle_client_msg(m, {"kind": "swiftmap_write", "ops": [
        None, {}, {"op": "set"}, {"op": "set", "id": None},
        {"op": "set", "id": "x", "fields": "not a dict"}]}, None)


# --- select with criteria only -------------------------------------------------------
# `if target` sent criteria-only calls down the CLEAR branch: select(types="polyline")
# restored everything instead of selecting the lines -- the one place criteria-only
# behaved differently from hide/show/make_time_layer.
def test_select_by_criteria_alone_selects(m):
    m.select(types="polyline", scope="Field")
    parts = subs(m)
    assert parts["polyline"].get("visible") is not False
    assert parts["circle_markers"].get("visible") is False
    assert parts["polygon"].get("visible") is False


def test_select_none_with_no_criteria_still_clears(m):
    m.select(types="polyline", scope="Field")
    m.select(None, scope="Field")
    assert all(s.get("visible") is not False for s in subs(m).values())


def test_an_empty_list_clears_without_a_warning(recwarn):
    mp = swiftmap.Map()
    mp.add_circle_markers([[36.0, -5.3]], name="Sites", layer_group="Feeds")
    mp.select([], scope="Feeds")
    assert [w for w in recwarn if issubclass(w.category, SwiftMapWarning)] == [], \
        "the table's 'no rows selected' is deliberate, not a miss"


def test_a_missed_selection_warns_and_restores(m):
    m.select(types="polyline", scope="Field")            # something is hidden
    with pytest.warns(SwiftMapWarning, match="select matched nothing"):
        m.select("No Such Layer", scope="Field")
    assert all(s.get("visible") is not False for s in subs(m).values()), \
        "an unmatched selection lands like an empty one: a clean slate"


def test_a_sidebar_write_reaches_a_merged_member(m):
    # The sidebar cascade writes member flags too (a merged entry's checkbox is
    # the whole entry); the write-back index used to hold top-level layers only,
    # so a member's op was silently dropped.
    member = m.find_layers("Survey", types="polyline")[0]
    m._handle_client_msg(None, {"kind": "swiftmap_write", "ops": [
        {"op": "set", "id": member.get("id"), "fields": {"visible": False}}]}, [])
    assert m.find_layers("Survey", types="polyline")[0].get("visible") is False
    assert m.find_layers("Survey", types="circle_markers")[0].get("visible", True),         "only the addressed member flipped"


def test_select_zoom_survives_merged_collections():
    # The React report's oldest finding: select's own matches -- plain dicts for
    # merged members -- crashed _identifiers on the hand-off to bounds_of.
    import pandas as pd
    from swiftmap import Map
    m = Map()
    m.add_circle_markers(pd.DataFrame({"lat": [36.0, 36.1], "lon": [-5.3, -5.2]}),
                         name="Dwell 1", layer_group="Dwells")
    m.add_polygon([[36.0, -5.3], [36.1, -5.3], [36.1, -5.2]],
                  name="Dwell 1", layer_group="Dwells")
    m.select("Dwell 1", zoom=True, zoom_offset=-1)   # raised TypeError before
    assert m.bounds_of("Dwell 1") == [[36.0, -5.3], [36.1, -5.2]]
