"""
The WKT helpers in parsers/sources/_utils.py, tested directly.

Two rules matter here. A parser must take only its own geometry kind -- otherwise a
POLYGON is read as a line and renders twice. And a string that is not WKT at all must
still reach the permissive number-extraction path, which delimited coordinate strings
depend on.
"""
import pytest

from geometry import A, B, C, LINE, RING, assert_coords, wkt_point, wkt_line, wkt_polygon
from swiftmap.parsers.sources._utils import (
    wkt_kind, _parse_point_wkt_string, _parse_coord_string,
    _parse_polygon_wkt_string, _ensure_closed_ring,
)


# --- kind detection ---------------------------------------------------------------
@pytest.mark.parametrize("text,expected", [
    ("POINT (-5.3 36.0)", "point"),
    ("MULTIPOINT (-5.3 36.0, -5.2 36.1)", "point"),
    ("LINESTRING (-5.3 36.0, -5.2 36.1)", "line"),
    ("MULTILINESTRING ((-5.3 36.0, -5.2 36.1))", "line"),
    ("POLYGON ((-5.3 36.0, -5.2 36.0, -5.2 36.1, -5.3 36.0))", "polygon"),
    ("MULTIPOLYGON (((-5.3 36.0, -5.2 36.0, -5.2 36.1, -5.3 36.0)))", "polygon"),
    ("point (-5.3 36.0)", "point"),
    ("  LINESTRING (-5.3 36.0, -5.2 36.1)", "line"),
    ("-5.30 36.00; -5.20 36.10", None),
    ("36.0, -5.3", None),
    ("", None),
    ("GEOMETRYCOLLECTION (POINT (-5.3 36.0))", None),
    (None, None),
    (42, None),
])
def test_wkt_kind(text, expected):
    assert wkt_kind(text) == expected


# --- each parser takes only its own kind ------------------------------------------
@pytest.mark.parametrize("text,kind", [
    (wkt_point(A), "point"),
    (wkt_line(LINE), "line"),
    (wkt_polygon(RING), "polygon"),
])
def test_parsers_reject_other_wkt_kinds(text, kind):
    got = {
        "point": len(_parse_point_wkt_string(text)),
        "line": len(_parse_coord_string(text)),
        "polygon": len(_parse_polygon_wkt_string(text)),
    }
    for other in ("point", "line", "polygon"):
        if other != kind:
            assert got[other] == 0, (
                f"{kind} WKT was also parsed as {other} -- this is how a POLYGON column "
                f"used to render a phantom polyline"
            )
    assert got[kind] > 0, f"{kind} WKT should parse as {kind}"


# --- coordinate transposition -----------------------------------------------------
def test_wkt_is_read_longitude_first():
    assert _parse_point_wkt_string(wkt_point(A)) == [[A[0], A[1]]]


def test_linestring_vertices_and_order():
    assert_coords(_parse_coord_string(wkt_line(LINE)), LINE, label="LINESTRING")


def test_polygon_ring_is_returned_closed():
    ring = _parse_polygon_wkt_string(wkt_polygon(RING))
    assert_coords(ring, RING, label="POLYGON")


def test_multipoint_returns_every_position():
    text = "MULTIPOINT (-5.3 36.0, -5.2 36.1, -5.1 36.05)"
    assert_coords(_parse_point_wkt_string(text), [list(A), list(B), list(C)], label="MULTIPOINT")


# --- non-WKT strings still work ---------------------------------------------------
def test_delimited_pairs_reach_the_generic_path():
    coords = _parse_coord_string("-118.24, 34.05; -122.41, 37.77")
    assert_coords(coords, [[34.05, -118.24], [37.77, -122.41]], label="delimited")


@pytest.mark.parametrize("order,expected", [
    ("lat_lon", [[36.0, -5.3], [36.1, -5.2]]),
    ("lon_lat", [[-5.3, 36.0], [-5.2, 36.1]]),
])
def test_explicit_coord_order_on_generic_strings(order, expected):
    assert_coords(_parse_coord_string("36.0 -5.3; 36.1 -5.2", coord_order=order),
                  expected, label=order)


def test_too_few_numbers_yields_nothing():
    assert _parse_coord_string("36.0") == []
    assert _parse_polygon_wkt_string("36.0, -5.3") == []


# --- ring closure -----------------------------------------------------------------
def test_ensure_closed_ring_appends_the_first_vertex():
    ring = _ensure_closed_ring([list(A), list(C), list(B)])
    assert len(ring) == 4
    assert ring[-1] == list(A)


def test_ensure_closed_ring_leaves_a_closed_ring_alone():
    assert len(_ensure_closed_ring([list(p) for p in RING])) == len(RING)


def test_ensure_closed_ring_ignores_degenerate_input():
    assert _ensure_closed_ring([list(A), list(B)]) == [list(A), list(B)]
    assert _ensure_closed_ring([]) == []
