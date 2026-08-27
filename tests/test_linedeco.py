"""
Line decoration options: arrows and dash, recorded on the config for the
renderer -- and surviving everything a config survives (merged members
included), since a decoration is a property of one line.
"""
import pytest

from swiftmap import Map
from swiftmap._warnings import warn  # noqa: F401  (import parity with siblings)

LINE = [[36.00, -5.30], [36.05, -5.25], [36.10, -5.20]]


def test_arrows_and_dash_are_recorded():
    m = Map()
    m.add_line(LINE, name="Flow", arrows=True, dash="8 4")
    layer = m.layers[-1]
    assert layer.arrows is True
    assert layer.dash == [8.0, 4.0]


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
    m.add_line(fc, name="Routes", arrows=True, dash=[6, 3])
    entry = m.layers[-1]
    assert entry.type == "group"
    assert all(sub.get("arrows") is True for sub in entry.layers)
    assert all(sub.get("dash") == [6.0, 3.0] for sub in entry.layers)
