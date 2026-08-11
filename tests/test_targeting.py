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
