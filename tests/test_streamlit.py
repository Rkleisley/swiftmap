"""
The Streamlit component's Python side: what it sends, and what it returns.

Composition is pinned here the way tests/test_export.py pins the export's; that
the built frontend RENDERS those args, reports a click, and no-ops on an unchanged
fingerprint is tier 3's job ("the Streamlit component renders from JSON args").
"""
import base64
import json
import sys

import pytest

from swiftmap import Map
from swiftmap._warnings import SwiftMapWarning
from swiftmap.export import compose_state
import swiftmap.streamlit as st_mod
from swiftmap.streamlit import EVENT_KEYS, compose_args, state_fingerprint, st_swiftmap


def small_map():
    m = Map(show_logo=False, height="600px")
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2], "value": [1.0, 9.0]},
        name="Sites", color_col="value")
    return m


def test_the_args_are_the_export_state_with_base64_buffers():
    m = small_map()
    args = compose_args(m)
    expected = json.loads(json.dumps(compose_state(m), default=str))
    assert args["state"] == expected, "the same composition the export bakes"
    layer = m.layers[-1]
    for key in (layer.id, f"{layer.id}::colors"):
        assert base64.b64decode(args["buffers"][key]) == bytes(m.coordinate_buffers[key]), \
            f"{key} round-trips through base64"
    json.dumps(args)   # exactly what Streamlit will do to it


def test_height_overrides_the_map_and_names_the_fingerprint():
    m = small_map()
    assert compose_args(m)["state"]["height"] == "600px"
    tall = compose_args(m, height="800px")
    assert tall["state"]["height"] == "800px"
    assert tall["fingerprint"] != compose_args(m)["fingerprint"]


def test_the_fingerprint_moves_only_when_the_map_changes():
    m = small_map()
    fp = state_fingerprint(m)
    assert state_fingerprint(m) == fp, "reading is not changing"
    assert compose_args(m) is compose_args(m), "an unchanged map is not re-encoded"

    seen = [fp]

    def moved(what):
        now = state_fingerprint(m)
        assert now not in seen, f"{what} must move the fingerprint"
        seen.append(now)

    m.add_circle_markers({"lat": [36.2], "lon": [-5.1]}, name="More")
    moved("adding a layer (an in-place patch)")
    m.update_layer("Sites", data={"lat": [36.3], "lon": [-5.0], "value": [5.0]}, append=True)
    moved("appending data (a buffer patch)")
    m.center = [36.5, -5.5]
    moved("a trait assignment")
    m.configure_legend(title="Key")
    moved("a config change")
    m.sync()
    moved("an explicit sync")
    assert compose_args(m)["fingerprint"] == seen[-1]
    assert len({a for a in seen}) == len(seen)

    other = small_map()
    assert state_fingerprint(other) != state_fingerprint(small_map()), \
        "two maps never share a fingerprint, whatever their counters say"


def test_the_return_shape_is_stable_before_any_interaction(monkeypatch):
    calls = []

    def component(**kwargs):
        calls.append(kwargs)
        return None                     # Streamlit before the first interaction

    monkeypatch.setattr(st_mod, "_component_func", lambda: component)
    events = st_swiftmap(small_map(), key="map")
    assert tuple(events) == EVENT_KEYS
    assert events["clicked_layer_id"] == "" and events["selected_index"] == -1
    assert events["drawings"] == [] and events["layer_visibility"] == {}
    assert events["center"] is None and events["click_seq"] == 0
    sent = calls[0]
    assert sent["key"] == "map" and sent["fingerprint"] and sent["state"]["layers"]
    assert tuple(sent["default"]) == EVENT_KEYS, "Streamlit's own default has the same shape"

    def clicked(**kwargs):
        return {"click_seq": 3, "clicked_layer_id": "x", "selected_index": 1,
                "unknown_key": "dropped"}

    monkeypatch.setattr(st_mod, "_component_func", lambda: clicked)
    events = st_swiftmap(small_map())
    assert events["click_seq"] == 3 and events["clicked_layer_id"] == "x"
    assert events["drawings"] == [] and "unknown_key" not in events


def test_without_streamlit_it_warns_and_returns_the_defaults(monkeypatch):
    monkeypatch.setitem(sys.modules, "streamlit", None)
    with pytest.warns(SwiftMapWarning, match="swiftmap\\[streamlit\\]"):
        events = st_swiftmap(small_map())
    assert tuple(events) == EVENT_KEYS


def test_the_built_frontend_ships_inside_the_package():
    # Bundled whole -- Leaflet, glify, Geoman, CSS -- so the component is the one
    # stack that needs no network. package-data in pyproject.toml carries it.
    assert (st_mod._FRONTEND / "index.html").exists()
    assert (st_mod._FRONTEND / "app.js").exists()
    assert (st_mod._FRONTEND / "app.css").exists()
    app = (st_mod._FRONTEND / "app.js").read_text(encoding="utf-8", errors="ignore")
    assert "unpkg.com" not in app.split("sourceMappingURL")[0], "nothing loads from a CDN"
