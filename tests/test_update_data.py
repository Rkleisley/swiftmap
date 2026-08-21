"""
update_layer(target, data=...): a layer's data changes, its identity does not.

The live-feed primitive. Replace keeps id, name, group, visibility, time animation
and highlights while every data-derived piece (buffers, colours, radii, legend,
labels, bounds) re-derives from the new data; append grows the layer with the new
rows after the old ones.
"""
import json
import warnings

import numpy as np
import pandas as pd
import pytest

import swiftmap
from swiftmap._warnings import SwiftMapWarning


class Comm:
    comm_id = "c"
    kernel = True

    def __init__(self):
        self.msgs = []

    def send(self, data=None, buffers=None, **kw):
        self.msgs.append((data, buffers or []))

    def on_msg(self, *a, **k):
        pass

    def close(self, *a, **k):
        pass


def quiet_map(**kw):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        return swiftmap.Map(**kw)


DF1 = pd.DataFrame({
    "lat": [36.0, 36.1, 36.2], "lon": [-5.3, -5.2, -5.1], "v": [1, 2, 3],
    "name": ["a", "b", "c"],
    "timestamp": ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z"],
})
DF2 = pd.DataFrame({
    "lat": [35.5, 35.6, 35.7, 35.8, 35.9], "lon": [-5.9, -5.8, -5.7, -5.6, -5.5],
    "v": [10, 20, 30, 40, 50], "name": ["p", "q", "r", "s", "t"],
    "timestamp": [f"2026-01-0{d}T00:00:00Z" for d in range(5, 10)],
})


def feed_map(**map_kwargs):
    m = quiet_map(**map_kwargs)
    m.add_circle_markers(DF1, name="Feed", color_col="v", radius_col="v", label="name")
    return m


def feed(m):
    return m.find_layers("Feed")[0]


def coords_of(m, layer):
    return np.frombuffer(m.coordinate_buffers[layer["id"]]).reshape(-1, 2)


def ops_of(comm):
    return [o for d, _ in comm.msgs for o in (d.get("content") or {}).get("ops", [])]


# --- identity ---------------------------------------------------------------------------
def test_replace_keeps_identity_and_redoes_the_data():
    m = feed_map()
    m.set_layer_visibility("Feed", False)
    m.make_time_layer("Feed")
    before = feed(m)
    old_id, old_time = before["id"], dict(before["time"])

    m.update_layer("Feed", data=DF2)

    layer = feed(m)
    assert layer["id"] == old_id, "the id is the identity a feed keeps"
    assert layer["name"] == "Feed" and layer["layer_group"] == before["layer_group"]
    assert layer["visible"] is False, "the user's sidebar choice survives the refresh"
    assert layer["time"] == old_time, "time animation is kept, not redone"
    assert coords_of(m, layer).tolist() == DF2[["lat", "lon"]].values.tolist()
    assert layer["properties"]["v"] == [10, 20, 30, 40, 50]
    times = np.frombuffer(m.coordinate_buffers[f"{old_id}::times"])
    assert len(times) == 2 * 5, "::times re-normalised to the new length"
    assert layer["labels"] == ["p", "q", "r", "s", "t"], "labels re-derived"
    assert layer["bounds"] == [[35.5, -5.9], [35.9, -5.5]]


def test_colours_radii_and_legend_follow_the_new_data():
    m = feed_map()
    lid = feed(m)["id"]
    m.update_layer("Feed", data=DF2)
    assert len(m.coordinate_buffers[f"{lid}::colors"]) == 5 * 4
    assert len(m.coordinate_buffers[f"{lid}::radii"]) == 5 * 4
    legend = feed(m)["legend"]
    assert (legend["vmin"], legend["vmax"]) == (10, 50), "auto range recomputed"
    assert feed(m)["legend_size"]["vmax"] == 50


def test_explicit_vmin_vmax_stay_fixed():
    m = quiet_map()
    m.add_circle_markers(DF1, name="Feed", color_col="v", vmin=0, vmax=100)
    m.update_layer("Feed", data=DF2)
    legend = feed(m)["legend"]
    assert (legend["vmin"], legend["vmax"]) == (0, 100)


def test_without_data_update_layer_behaves_as_before():
    m = feed_map()
    m.update_layer("Feed", color="#123456")
    assert feed(m)["color"] == "#123456"
    assert coords_of(m, feed(m)).shape == (3, 2)


def test_field_kwargs_ride_along_with_a_data_update():
    m = feed_map()
    m.update_layer("Feed", data=DF2, color="#abcdef")
    assert feed(m)["color"] == "#abcdef"


def test_parser_kwargs_pass_through():
    m = feed_map()
    xy = pd.DataFrame({"y": [35.5, 35.6], "x": [-5.9, -5.8], "v": [1, 2]})
    m.update_layer("Feed", data=xy, lat_col="y", lon_col="x")
    assert coords_of(m, feed(m)).tolist() == [[35.5, -5.9], [35.6, -5.8]]


# --- the viewport -----------------------------------------------------------------------
def test_a_chosen_view_is_never_moved_by_a_refresh():
    m = feed_map(center=[36.0, -5.3], zoom=9)
    assert m.fit_bounds_request == {}
    m.update_layer("Feed", data=DF2)
    assert m.fit_bounds_request == {}, "disarmed auto-fit stays disarmed"
    m.update_layer("Feed", data=DF2, append=True)
    assert m.fit_bounds_request == {}


def test_an_armed_auto_fit_extends_to_the_new_data():
    m = feed_map()
    m.update_layer("Feed", data=DF2)
    (south, west), (north, east) = m.fit_bounds_request["bounds"]
    assert south <= 35.5 and west <= -5.9 and north >= 36.2 and east >= -5.1


# --- overrides --------------------------------------------------------------------------
def test_replace_clears_feature_overrides_with_a_warning():
    m = feed_map()
    m.set_feature_styles("Feed", {0: {"color": "#ffffff"}})
    with pytest.warns(SwiftMapWarning, match="overrides"):
        m.update_layer("Feed", data=DF2)
    assert feed(m)["style_overrides"] == {}


def test_append_keeps_feature_overrides():
    m = feed_map()
    m.set_feature_styles("Feed", {0: {"color": "#ffffff"}})
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        m.update_layer("Feed", data=DF2, append=True)
    assert not [w for w in caught if "overrides" in str(w.message)]
    assert feed(m)["style_overrides"] == {"0": {"color": "#ffffff"}}


def test_highlight_survives_a_replace():
    m = feed_map()
    m.highlight("Feed", color="#ffcc00")
    m.update_layer("Feed", data=DF2)
    assert feed(m)["highlight_style"], "layer-level highlight is kept"


# --- append -----------------------------------------------------------------------------
def test_append_grows_the_layer_after_the_existing_rows():
    m = feed_map()
    m.make_time_layer("Feed")
    lid = feed(m)["id"]
    m.update_layer("Feed", data=DF2, append=True)
    layer = feed(m)
    assert coords_of(m, layer).shape == (8, 2)
    assert coords_of(m, layer)[:3].tolist() == DF1[["lat", "lon"]].values.tolist()
    assert layer["properties"]["v"] == [1, 2, 3, 10, 20, 30, 40, 50]
    assert len(np.frombuffer(m.coordinate_buffers[f"{lid}::times"])) == 16
    assert len(m.coordinate_buffers[f"{lid}::colors"]) == 8 * 4
    assert layer["legend"]["vmax"] == 50, "auto-ranged colours rescale over the union"
    assert layer["bounds"] == [[35.5, -5.9], [36.2, -5.1]]


def test_append_fills_missing_columns_with_none():
    m = feed_map()
    m.update_layer("Feed", data=pd.DataFrame({"lat": [35.0], "lon": [-6.0], "v": [7]}),
                   append=True)
    assert feed(m)["properties"]["name"] == ["a", "b", "c", None]


# --- refusals, all honest ---------------------------------------------------------------
def _snapshot(m):
    return ([dict(l.to_dict()) for l in m.layers], dict(m.coordinate_buffers))


def test_a_fanned_out_layer_warns_and_changes_nothing():
    m = quiet_map()
    df = DF1.assign(kind=["x", "y", "x"])
    m.add_circle_markers(df, name="kind")          # two sibling layers from a column
    before = _snapshot(m)
    with pytest.warns(SwiftMapWarning, match="fanned out"):
        m.update_layer("x", data=DF2)
    assert _snapshot(m) == before


def test_a_collection_and_its_parts_warn():
    m = quiet_map()
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-5.3, 36.0]},
         "properties": {}},
        {"type": "Feature", "geometry": {"type": "LineString",
                                         "coordinates": [[-5.3, 36.0], [-5.2, 36.1]]},
         "properties": {}}]}
    m.add_collection(fc, name="Survey")
    before = _snapshot(m)
    with pytest.warns(SwiftMapWarning, match="collection"):
        m.update_layer("Survey", data=DF2)
    part_id = next(l["id"] for l in m.find_layers("Survey") if l.get("type") == "polyline")
    with pytest.warns(SwiftMapWarning, match="collection"):
        m.update_layer(part_id, data=DF2)
    assert _snapshot(m) == before


def test_wrong_geometry_for_the_layer_warns_and_changes_nothing():
    m = quiet_map()
    m.add_polygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]], name="Zone")
    before = _snapshot(m)
    with pytest.warns(SwiftMapWarning, match="no polygon geometry"):
        m.update_layer("Zone", data=DF2)
    assert _snapshot(m) == before


def test_unknown_target_warns():
    m = feed_map()
    with pytest.warns(SwiftMapWarning, match="no layer"):
        m.update_layer("Nope", data=DF2)


def test_a_lost_time_property_stops_the_animation_honestly():
    m = feed_map()
    m.make_time_layer("Feed")
    lid = feed(m)["id"]
    with pytest.warns(SwiftMapWarning, match="stops animating"):
        m.update_layer("Feed", data=DF2.drop(columns=["timestamp"]))
    assert feed(m)["time"] is None
    assert f"{lid}::times" not in m.coordinate_buffers


# --- single lines and polygons ----------------------------------------------------------
def test_a_single_line_replaces_in_place():
    m = quiet_map()
    m.add_line(pd.DataFrame({"geometry": ["LINESTRING (-5.3 36.0, -5.2 36.1)"]}), name="Route")
    lid = m.find_layers("Route")[0]["id"]
    m.update_layer("Route", data=pd.DataFrame(
        {"geometry": ["MULTILINESTRING ((-5.4 36.0, -5.3 36.0), (-5.2 36.1, -5.1 36.1))"]}))
    layer = m.find_layers("Route")[0]
    assert layer["id"] == lid
    assert layer["parts"] == [2, 2]
    assert coords_of(m, layer).shape == (4, 2)


def test_append_on_a_single_line_warns():
    m = quiet_map()
    m.add_line(pd.DataFrame({"geometry": ["LINESTRING (-5.3 36.0, -5.2 36.1)"]}), name="Route")
    before = _snapshot(m)
    with pytest.warns(SwiftMapWarning, match="nothing to append"):
        m.update_layer("Route", data=pd.DataFrame(
            {"geometry": ["LINESTRING (-5.1 36.2, -5.0 36.3)"]}), append=True)
    assert _snapshot(m) == before


def test_many_features_for_a_single_layer_warns():
    m = quiet_map()
    m.add_line(pd.DataFrame({"geometry": ["LINESTRING (-5.3 36.0, -5.2 36.1)"]}), name="Route")
    with pytest.warns(SwiftMapWarning, match="holds 2 lines"):
        m.update_layer("Route", data=pd.DataFrame(
            {"geometry": ["LINESTRING (-5.3 36.0, -5.2 36.1)",
                          "LINESTRING (-5.1 36.2, -5.0 36.3)"]}))


# --- transport --------------------------------------------------------------------------
def test_the_update_is_one_replace_plus_changed_buffers_never_a_snapshot():
    # A chosen view, so no auto-fit trait update rides beside the patch message.
    m = feed_map(center=[36.0, -5.3], zoom=9)
    m.make_time_layer("Feed")
    m.comm = Comm()
    m.comm.msgs.clear()
    m.update_layer("Feed", data=DF2)
    kinds = sorted(o["op"] for o in ops_of(m.comm))
    assert kinds == ["buffer", "buffer", "buffer", "buffer", "replace"], kinds
    patches = [d for d, _ in m.comm.msgs if (d.get("content") or {}).get("kind") == "swiftmap_patch"]
    assert len(patches) == 1, "one batch, one patch message"
    assert "snapshot" not in kinds


def test_added_with_is_recorded_on_every_builder():
    m = quiet_map()
    m.add_circle_markers(DF1, name="P", color_col="v")
    m.add_markers(DF1, name="M")
    m.add_line(pd.DataFrame({"geometry": ["LINESTRING (-5.3 36.0, -5.2 36.1)"]}), name="L")
    m.add_polygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]], name="G")
    for name, method in (("P", "add_circle_markers"), ("M", "add_markers"),
                         ("L", "add_line"), ("G", "add_polygon")):
        rec = m.find_layers(name)[0]["added_with"]
        assert rec["method"] == method and rec["fanned"] is False
    assert m.find_layers("P")[0]["added_with"]["data_opts"]["color_col"] == "v"


# --- the wire: an append is a delta -----------------------------------------------------
def _payload_bytes(comm):
    return sum(len(json.dumps(content, default=str)) + sum(len(b) for b in buffers)
               for content, buffers in comm.msgs)


def _ops_by_kind(comm):
    out = {}
    for content, buffers in comm.msgs:
        for op in (content.get("content") or {}).get("ops", []):
            key = op["op"] + (":" + op["id"].split("::")[-1] if "::" in op.get("id", "") else "")
            out.setdefault(key, []).append(
                len(buffers[op["buffer_index"]]) if "buffer_index" in op else op)
    return out


def _big_frame(n):
    rng = np.random.default_rng(1)
    return pd.DataFrame({
        "lat": 35.0 + rng.random(n), "lon": -6.0 + rng.random(n),
        "v": rng.integers(0, 100, n), "name": ["x"] * n,
        "timestamp": 1767225600000 + rng.integers(0, 86400000 * 3, n),
    })


def test_an_append_frame_scales_with_the_batch_not_the_layer():
    # The regression guard for the live feed: the same 5-row batch appended to a
    # 3-point layer and a 20,000-point layer must cost the same on the wire.
    # Re-sending the layer crosses uvicorn's 16 MB frame cap around 270k points,
    # which closes the websocket and kills the session -- the toggle write-back
    # failure (6de6d5a) by another route.
    sizes = {}
    for label, frame in (("small", DF1), ("big", _big_frame(20_000))):
        m = quiet_map(center=[36.0, -5.3], zoom=9)
        m.add_circle_markers(frame, name="Feed", color_col="v", vmin=0, vmax=100,
                             radius_col="v")
        m.make_time_layer("Feed")
        m.comm = Comm()
        m.comm.msgs.clear()
        m.update_layer("Feed", data=DF2, append=True)
        sizes[label] = _payload_bytes(m.comm)
        kinds = _ops_by_kind(m.comm)
        assert "replace" not in kinds, f"{label}: an append never re-sends the layer"
        assert "buffer_append" in kinds and "append" in kinds
    assert sizes["big"] <= sizes["small"] * 1.25 + 512, sizes


def test_append_ships_the_tails_and_only_the_new_rows():
    m = quiet_map(center=[36.0, -5.3], zoom=9)
    m.add_circle_markers(DF1, name="Feed", color_col="v", vmin=0, vmax=100,
                         radius_col="v", label="name")
    m.make_time_layer("Feed")
    m.comm = Comm()
    m.comm.msgs.clear()
    m.update_layer("Feed", data=DF2, append=True)
    kinds = _ops_by_kind(m.comm)
    assert kinds["buffer_append"] == [5 * 16], "coordinate tail: 5 points x 2 float64"
    assert kinds["buffer_append:colors"] == [5 * 4], "fixed range: the colour tail only"
    assert kinds["buffer_append:times"] == [5 * 16]
    (append_op,) = kinds["append"]
    assert append_op["base"] == 3 and append_op["count"] == 5
    assert append_op["properties"]["v"] == [10, 20, 30, 40, 50]
    assert append_op["lists"]["labels"] == ["p", "q", "r", "s", "t"]
    (set_op,) = kinds["set"]
    assert set_op["fields"]["bounds"] == [[35.5, -5.9], [36.2, -5.1]]
    # And the server-side mirror agrees with what the client will hold.
    layer = feed(m)
    assert coords_of(m, layer).shape == (8, 2)
    assert layer["properties"]["v"] == [1, 2, 3, 10, 20, 30, 40, 50]


def test_a_moved_auto_range_resends_colours_in_full_but_coordinates_still_append():
    m = quiet_map(center=[36.0, -5.3], zoom=9)
    m.add_circle_markers(DF1, name="Feed", color_col="v")      # auto range 1..3
    m.comm = Comm()
    m.comm.msgs.clear()
    m.update_layer("Feed", data=DF2, append=True)              # up to 50: every value moves
    kinds = _ops_by_kind(m.comm)
    assert kinds["buffer_append"] == [5 * 16]
    assert kinds["buffer:colors"] == [8 * 4], "the range moved, so the whole colour buffer goes"
    assert "buffer_append:colors" not in kinds


def test_an_unmoved_auto_range_appends_colours():
    m = quiet_map(center=[36.0, -5.3], zoom=9)
    m.add_circle_markers(DF1, name="Feed", color_col="v")      # auto range 1..3
    m.comm = Comm()
    m.comm.msgs.clear()
    inside = pd.DataFrame({"lat": [35.9, 35.8], "lon": [-5.5, -5.6], "v": [2, 3]})
    m.update_layer("Feed", data=inside, append=True)
    kinds = _ops_by_kind(m.comm)
    assert kinds["buffer_append:colors"] == [2 * 4], "range unchanged: tail only"
    assert "buffer:colors" not in kinds


def test_a_style_column_takes_the_full_path():
    m = quiet_map(center=[36.0, -5.3], zoom=9)
    styled = DF1.assign(style=[{"color": "#f00"}, {"color": "#0f0"}, {"color": "#00f"}])
    m.add_circle_markers(styled, name="Feed")
    m.comm = Comm()
    m.comm.msgs.clear()
    m.update_layer("Feed", data=DF2.assign(style=[{"color": "#fff"}] * 5), append=True)
    kinds = _ops_by_kind(m.comm)
    assert "replace" in kinds, "per-feature styles resolve over the whole set"
    assert len(feed(m)["feature_styles"]) == 8
