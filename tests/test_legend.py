"""
The legend's Python surface: thin wrappers writing declarative state.

Derivation and rendering live in src/legend.js (tiers 1 and 2); what Python owns is
the legend_config trait the m.legend_* verbs write, and the resolved `legend` block
color_col records in layer configs -- anchors, category colours and bin classes are
resolved HERE so the frontend never holds a colormap table that could drift.
"""
import pytest

from swiftmap import Map
from swiftmap._colormaps import COLORMAPS, CATEGORICAL_PALETTES
from swiftmap._warnings import SwiftMapWarning


# --- configure_legend -------------------------------------------------------------
def test_configure_legend_merges_only_what_is_given():
    m = Map()
    m.configure_legend(title="Key", position="bottom-right")
    m.configure_legend(scope="visible")
    assert m.legend_config["title"] == "Key"
    assert m.legend_config["position"] == "bottom-right"
    assert m.legend_config["scope"] == "visible"


def test_configure_legend_show_flips_the_trait():
    m = Map()
    assert m.show_legend is False
    m.configure_legend(show=True)
    assert m.show_legend is True


def test_bad_position_and_scope_warn_and_are_ignored():
    m = Map()
    with pytest.warns(SwiftMapWarning, match="unknown position"):
        m.configure_legend(position="under-the-couch")
    with pytest.warns(SwiftMapWarning, match="scope must be"):
        m.configure_legend(scope="everything")
    assert "position" not in m.legend_config
    assert "scope" not in m.legend_config


# --- legend_add / legend_remove / legend_clear -------------------------------------
def test_a_plain_add_is_a_swatch_with_defaults():
    m = Map()
    m.legend_add("Restricted", shape="polygon", color="#f00", group="Zones")
    (entry,) = m.legend_config["add"]
    assert entry == {"label": "Restricted", "group": "Zones", "kind": "swatch",
                     "shape": "polygon", "color": "#f00", "fillColor": "#f00"}


def test_a_ramp_add_resolves_its_anchors():
    m = Map()
    m.legend_add("Threat", colormap="turbo", vmin=0, vmax=100)
    (entry,) = m.legend_config["add"]
    assert entry["kind"] == "ramp"
    assert entry["anchors"] == COLORMAPS["turbo"]
    assert entry["vmin"] == 0 and entry["vmax"] == 100


def test_a_bins_add_resolves_class_colours():
    m = Map()
    m.legend_add("Depth", colormap="blues", color_bins=[10, 50])
    (entry,) = m.legend_config["add"]
    assert entry["kind"] == "bins"
    assert entry["edges"] == [10, 50]
    assert len(entry["colors"]) == 3, "edges + 1 classes"


def test_category_adds_take_a_dict_as_given_and_colour_a_list():
    m = Map()
    m.legend_add("Status", categories={"ok": "#0f0", "down": "#f00"})
    m.legend_add("Kind", categories=["confirmed", "probable"])
    given, coloured = m.legend_config["add"]
    assert given["items"] == [{"value": "ok", "color": "#0f0"},
                              {"value": "down", "color": "#f00"}]
    assert coloured["items"][0]["color"] == CATEGORICAL_PALETTES["swift10"][0]


def test_removes_accumulate_matchers_and_clear_drops_them():
    m = Map()
    m.configure_legend(title="Key")
    m.legend_add("Mine")
    m.legend_remove("Sites").legend_remove(group="Debug")
    assert m.legend_config["remove"] == [{"label": "Sites"}, {"group": "Debug"}]
    m.legend_clear()
    assert "add" not in m.legend_config and "remove" not in m.legend_config
    assert m.legend_config["title"] == "Key", "display options survive a clear"


def test_removing_nothing_warns():
    m = Map()
    with pytest.warns(SwiftMapWarning, match="nothing to match"):
        m.legend_remove()


# --- the recorded block -------------------------------------------------------------
def test_color_col_records_a_resolved_ramp_block():
    m = Map()
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "speed": [2.0, 30.0]},
                         name="Tracks", color_col="speed")
    block = m.layers[-1].legend
    assert block == {"kind": "ramp", "field": "speed",
                     "anchors": COLORMAPS["viridis"], "vmin": 2, "vmax": 30}


def test_a_categorical_column_records_items():
    m = Map()
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "kind": ["cargo", "tanker"]},
                         name="Ships", color_col="kind")
    block = m.layers[-1].legend
    assert block["kind"] == "categories"
    assert [i["value"] for i in block["items"]] == ["cargo", "tanker"]


def test_bins_record_edges_and_class_colours():
    m = Map()
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "speed": [2.0, 30.0]},
                         name="Tracks", color_col="speed", color_bins=[10.0])
    block = m.layers[-1].legend
    assert block["kind"] == "bins" and block["edges"] == [10]
    assert len(block["colors"]) == 2


def test_without_color_col_no_block_is_recorded():
    m = Map()
    m.add_circle_markers([[36.0, -5.3]], name="Plain")
    assert m.layers[-1].legend is None


def test_the_export_carries_the_legend_config():
    m = Map(show_logo=False)
    m.add_circle_markers([[36.0, -5.3]], name="Sites")
    m.configure_legend(show=True, title="Patrol Key")
    assert '"Patrol Key"' in m.to_html()


# --- the size key --------------------------------------------------------------------
# Stated, never drawn: legend CSS pixels are not map pixels at any zoom, so the block
# carries the field and its domain -- no radii, nothing derived from radius_range.
def test_radius_col_records_a_size_key():
    m = Map()
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "tonnage": [2.0, 30.0]},
                         name="Ships", radius_col="tonnage")
    assert m.layers[-1].legend_size == {"kind": "sizes", "field": "tonnage",
                                        "vmin": 2, "vmax": 30}


def test_no_radius_col_records_no_size_key():
    m = Map()
    m.add_circle_markers([[36.0, -5.3]], name="Plain")
    assert m.layers[-1].legend_size is None


def test_a_non_numeric_radius_column_records_nothing():
    import warnings as w
    m = Map()
    with w.catch_warnings():
        w.simplefilter("ignore")
        m.add_circle_markers({"lat": [36.0], "lon": [-5.3], "kind": ["cargo"]},
                             name="Ships", radius_col="kind")
    assert m.layers[-1].legend_size is None
