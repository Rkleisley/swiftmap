"""
Feature-level selection: `where=` on select / hide / show, and clicked_feature().

A layer holds many features (points always did; polygons and lines are packed since
0.7.0), so selecting a table's rows on the map means selecting FEATURES within a
layer. `where=` writes a predicate onto the layer -- feature_filter = {"where":
{column: [values]}, "keep": bool} -- that the renderer evaluates against the layer's
own columns (src/packed.js featureMask). Being a predicate, it survives data updates.
"""
import time
import warnings

import numpy as np
import pytest

pd = pytest.importorskip("pandas")

from swiftmap import Map
from swiftmap._warnings import SwiftMapWarning
from swiftmap.layers._packed import feature_match, where_set

ZONES = {
    "geometry": ["POLYGON ((-5.31 36.00, -5.30 36.00, -5.30 36.01, -5.31 36.00))",
                 "POLYGON ((-5.29 36.00, -5.28 36.00, -5.28 36.01, -5.29 36.00))",
                 "POLYGON ((-5.27 36.00, -5.26 36.00, -5.26 36.01, -5.27 36.00))"],
    "zone": ["a", "b", "a"],
    "rank": [1, 2, 3],
}


def field_map():
    m = Map(show_logo=False)
    m.add_polygon(ZONES, name="Zones", layer_group="Field")
    m.add_circle_markers({"lat": [36.0, 36.1, 36.2], "lon": [-5.3, -5.2, -5.1],
                          "zone": ["a", "b", "b"]}, name="Sites", layer_group="Field")
    m.add_line([[36.0, -5.3], [36.1, -5.2]], name="Route", layer_group="Field")
    return m


def layer(m, name):
    return m.find_layers(name)[0]


def drawn(m, name):
    """Which features the renderer draws -- the predicate, evaluated as JS does."""
    l = layer(m, name)
    f = l.get("feature_filter")
    n = l.get("feature_count") or len(m.coordinate_buffers[l.get("id")]) // 16
    if not f:
        return list(range(n))
    hit = feature_match(l, where_set(f["where"]), n)
    keep = hit if f["keep"] else ~hit
    return [i for i in range(n) if keep[i]]


# --- select -------------------------------------------------------------------
def test_select_where_draws_only_the_matching_features():
    m = field_map()
    m.select("Zones", where={"zone": "a"})
    assert layer(m, "Zones").get("feature_filter") == {"where": {"zone": ["a"]}, "keep": True}
    assert drawn(m, "Zones") == [0, 2]
    assert layer(m, "Sites").get("visible") is False, "the rest of the scope hides, as ever"


def test_where_alone_selects_in_every_layer_of_scope_that_carries_the_column():
    m = field_map()
    m.select(where={"zone": ["b"]}, scope="Field")
    assert drawn(m, "Zones") == [1]
    assert drawn(m, "Sites") == [1, 2]
    assert layer(m, "Route").get("visible") is False, "no zone column: not part of it"


def test_select_where_zoom_fits_the_matching_features_only():
    m = field_map()
    m.select("Zones", where={"zone": "b"}, zoom=True)
    assert m.fit_bounds_request["bounds"] == [[36.0, -5.29], [36.01, -5.28]]


def test_no_rows_is_the_clean_slate():
    m = field_map()
    m.select("Zones", where={"zone": "a"})
    m.select("Zones", where={"zone": []})
    assert layer(m, "Zones").get("feature_filter") is None
    assert all(layer(m, n).get("visible") for n in ("Zones", "Sites", "Route"))


def test_a_plain_select_clears_the_scopes_filters():
    m = field_map()
    m.select(where={"zone": "b"}, scope="Field")
    m.select("Route", scope="Field")
    assert layer(m, "Zones").get("feature_filter") is None
    assert layer(m, "Sites").get("feature_filter") is None


def test_values_normalise_like_stored_properties():
    m = field_map()
    m.select("Zones", where={"rank": np.array([np.int64(1), np.int64(3)])})
    assert drawn(m, "Zones") == [0, 2], "numpy ints match the stored Python ints"
    m.select("Zones", where={"zone": {"b", "a"}})
    assert layer(m, "Zones").get("feature_filter")["where"]["zone"] == ["a", "b"], \
        "a set lands in a stable order on the wire"


def test_a_missing_column_warns_and_matches_nothing():
    m = field_map()
    with pytest.warns(SwiftMapWarning, match="no property 'zone'"):
        m.select("Route", where={"zone": "a"})
    assert drawn(m, "Route") == []


def test_a_filter_without_one_sends_nothing_new():
    # Visibility and filters are written apart, so a select that touches no filter
    # sends exactly the ops it always did -- the conformance goldens pin this too.
    m = field_map()
    before = len(m.layers)
    m.select("Zones")
    assert all(layer(m, n).get("feature_filter") is None for n in ("Zones", "Sites"))
    assert len(m.layers) == before


# --- hide / show --------------------------------------------------------------
def test_hide_where_drops_the_matching_features():
    m = field_map()
    m.hide("Sites", where={"zone": "b"})
    assert layer(m, "Sites").get("visible") is True
    assert drawn(m, "Sites") == [0]


def test_each_call_states_the_whole_filter():
    m = field_map()
    m.hide("Zones", where={"zone": "a"})
    m.hide("Zones", where={"rank": 2})
    assert drawn(m, "Zones") == [0, 2], "the second hide replaced the first"


def test_show_where_shows_only_the_matching_and_show_clears():
    m = field_map()
    m.hide("Zones")
    m.show("Zones", where={"zone": "b"})
    assert layer(m, "Zones").get("visible") is True
    assert drawn(m, "Zones") == [1]
    m.show("Zones")
    assert drawn(m, "Zones") == [0, 1, 2], "show(target) shows every feature"


# --- the predicate survives data -------------------------------------------------
def test_the_filter_reapplies_to_new_data():
    m = field_map()
    m.select("Zones", where={"zone": "a"})
    m.update_layer("Zones", data={"geometry": ZONES["geometry"][:2], "zone": ["b", "a"],
                                  "rank": [9, 8]})
    assert layer(m, "Zones").get("feature_filter") == {"where": {"zone": ["a"]}, "keep": True}
    assert drawn(m, "Zones") == [1]


# --- clicked_feature ------------------------------------------------------------
def test_clicked_feature_reads_the_clicked_row():
    m = field_map()
    zones = layer(m, "Zones")
    m.clicked_layer_id, m.selected_index = zones.id, 2
    assert m.clicked_feature() == {"layer": zones.id, "name": "Zones", "index": 2,
                                   "properties": {"zone": "a", "rank": 3}}
    sites = layer(m, "Sites")
    m.clicked_layer_id, m.selected_index = sites.id, 1
    assert m.clicked_feature()["properties"] == {"zone": "b"}


def test_clicked_feature_is_none_for_open_map_and_gone_layers():
    m = field_map()
    assert m.clicked_feature() is None
    m.clicked_layer_id, m.selected_index = "layer_999", 0
    assert m.clicked_feature() is None


def test_clicked_feature_restores_a_stripped_time_column():
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "timestamp": ["2026-01-01T00:00:00", "2026-01-02T00:00:00"]},
                         name="Pings")
    m.make_time_layer("Pings")
    pings = layer(m, "Pings")
    assert "timestamp" not in pings.get("properties"), "moved into ::times"
    m.clicked_layer_id, m.selected_index = pings.id, 1
    assert m.clicked_feature()["properties"]["timestamp"] == \
        pd.Timestamp("2026-01-02").value // 10**6


# --- scale ----------------------------------------------------------------------
def test_selecting_rows_among_ten_thousand_hexes_is_fast_and_small():
    h3 = pytest.importorskip("h3")
    cells = list(h3.grid_disk(h3.latlng_to_cell(36.13, -5.44, 8), 57))[:10000]
    m = Map(show_logo=False)
    m.add_polygon(pd.DataFrame({"h3_cell": cells, "v": range(len(cells))}), name="Hexes")
    t0 = time.perf_counter()
    m.select("Hexes", where={"h3_cell": cells[::2]}, zoom=True)
    elapsed = time.perf_counter() - t0
    assert drawn(m, "Hexes") == list(range(0, len(cells), 2))
    assert elapsed < 1.0, f"select(where=) over 10k features took {elapsed:.2f} s"
