"""
Line decoration options: arrows and dash, recorded on the config for the
renderer -- and surviving everything a config survives (merged members
included), since a decoration is a property of one line.

`arrows` is a placement vocabulary: True = evenly spaced in screen pixels
(the on-screen count locked at every zoom), 'segments' = one per leg,
'end' = terminal caps only. Every mode always draws the end cap -- that
happens renderer-side, so here the contract is what the config records.
"""
import pytest

from swiftmap import Map
from swiftmap._warnings import warn  # noqa: F401  (import parity with siblings)

LINE = [[36.00, -5.30], [36.05, -5.25], [36.10, -5.20]]


def test_arrows_and_dash_are_recorded():
    m = Map()
    m.add_line(LINE, name="Flow", arrows=True, dash="8 4")
    layer = m.layers[-1]
    assert layer.arrows == "spacing"
    assert layer.dash == [8.0, 4.0]


def test_arrow_placement_vocabulary():
    m = Map()
    m.add_line(LINE, name="Caps", arrows="end")
    m.add_line(LINE, name="Legs", arrows="segments")
    m.add_line(LINE, name="Grid", arrows="spacing")
    assert m.get_layer("Caps").arrows == "end"
    assert m.get_layer("Legs").arrows == "segments"
    assert m.get_layer("Grid").arrows == "spacing"


def test_junk_arrows_warns_and_spaces():
    m = Map()
    with pytest.warns(Warning, match="arrows must be True"):
        m.add_line(LINE, name="Flow", arrows="chevrons")
    assert m.get_layer("Flow").arrows == "spacing"


def test_arrow_spacing_pixels_and_ground_distance():
    m = Map()
    m.add_line(LINE, name="Px", arrows=True, arrow_spacing=200)
    m.add_line(LINE, name="PxStr", arrows=True, arrow_spacing="90px")
    m.add_line(LINE, name="Km", arrows=True, arrow_spacing="2km")
    m.add_line(LINE, name="M", arrows=True, arrow_spacing="500 m")
    px = m.get_layer("Px")
    assert px.arrow_spacing_px == 200.0
    assert getattr(px, "arrow_spacing_m", None) is None
    assert m.get_layer("PxStr").arrow_spacing_px == 90.0
    km = m.get_layer("Km")
    assert km.arrow_spacing_m == 2000.0
    assert getattr(km, "arrow_spacing_px", None) is None
    assert m.get_layer("M").arrow_spacing_m == 500.0


def test_default_spacing_records_nothing():
    # The 120px default lives in the renderer, not the config: a plain
    # arrows=True layer stays lean and picks up any future default change.
    m = Map()
    m.add_line(LINE, name="Flow", arrows=True)
    layer = m.get_layer("Flow")
    assert getattr(layer, "arrow_spacing_px", None) is None
    assert getattr(layer, "arrow_spacing_m", None) is None


def test_junk_spacing_warns_and_uses_default():
    m = Map()
    with pytest.warns(Warning, match="arrow_spacing must be pixels"):
        m.add_line(LINE, name="Flow", arrows=True, arrow_spacing="wide")
    with pytest.warns(Warning, match="arrow_spacing must be pixels"):
        m.add_line(LINE, name="Flow2", arrows=True, arrow_spacing=-5)
    for name in ("Flow", "Flow2"):
        layer = m.get_layer(name)
        assert layer.arrows == "spacing"
        assert getattr(layer, "arrow_spacing_px", None) is None
        assert getattr(layer, "arrow_spacing_m", None) is None


def test_spacing_without_spaced_arrows_warns_and_is_ignored():
    m = Map()
    with pytest.warns(Warning, match="spaced arrows only"):
        m.add_line(LINE, name="Caps", arrows="end", arrow_spacing=200)
    with pytest.warns(Warning, match="spaced arrows only"):
        m.add_line(LINE, name="Plain", arrow_spacing=200)
    assert getattr(m.get_layer("Caps"), "arrow_spacing_px", None) is None
    assert getattr(m.get_layer("Plain"), "arrows", None) is None


def test_dash_accepts_lists_and_commas():
    m = Map()
    m.add_line(LINE, name="A", dash=[10, 6, 2, 2])     # extra pairs: first two win
    m.add_line(LINE, name="B", dash="12, 3")
    assert m.get_layer("A").dash == [10.0, 6.0]
    assert m.get_layer("B").dash == [12.0, 3.0]


def test_junk_dash_warns_and_draws_solid():
    m = Map()
    with pytest.warns(Warning, match="on,off pixel pair"):
        m.add_line(LINE, name="Flow", dash="wide")
    with pytest.warns(Warning, match="on,off pixel pair"):
        m.add_line(LINE, name="Flow2", dash=[0, 5])
    assert getattr(m.get_layer("Flow"), "dash", None) is None
    assert getattr(m.get_layer("Flow2"), "dash", None) is None


def test_undecorated_lines_carry_no_deco_keys():
    m = Map()
    m.add_line(LINE, name="Plain")
    layer = m.get_layer("Plain")
    assert getattr(layer, "arrows", None) is None
    assert getattr(layer, "dash", None) is None


def test_merged_members_keep_their_decoration():
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {},
         "geometry": {"type": "LineString",
                      "coordinates": [[-5.30, 36.00], [-5.25, 36.05]]}},
        {"type": "Feature", "properties": {},
         "geometry": {"type": "LineString",
                      "coordinates": [[-5.20, 36.00], [-5.15, 36.05]]}},
    ]}
    m = Map()
    m.add_line(fc, name="Routes", arrows=True, arrow_spacing="1km", dash=[6, 3])
    entry = m.layers[-1]
    assert entry.type == "group"
    assert all(sub.get("arrows") == "spacing" for sub in entry.layers)
    assert all(sub.get("arrow_spacing_m") == 1000.0 for sub in entry.layers)
    assert all(sub.get("dash") == [6.0, 3.0] for sub in entry.layers)
