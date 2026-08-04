"""
GeoJSON parsing.

GeoJSON stores coordinates longitude-first, so every test here doubles as a check that the
transposition into swiftmap's [lat, lon] output actually happens.
"""
import pytest

from geometry import (
    A, B, C, LINE, RING, SECOND_LINE, SECOND_RING,
    assert_coords, assert_points, assert_closed, gj_feature, gj_collection, lonlat,
)
from swiftmap.parsers import parse_points, parse_lines, parse_polygons


@pytest.fixture
def point_feature():
    return gj_feature("Point", [A[1], A[0]], {"site": "S1"})


@pytest.fixture
def line_feature():
    return gj_feature("LineString", lonlat(LINE), {"route": "R1"})


@pytest.fixture
def polygon_feature():
    return gj_feature("Polygon", [lonlat(RING)], {"zone": "Z1"})


# --- containers -------------------------------------------------------------------
def test_feature_collection(point_feature):
    lats, lons, _ = parse_points(gj_collection(point_feature))
    assert_points(lats, lons, [A])


def test_bare_feature(point_feature):
    lats, lons, _ = parse_points(point_feature)
    assert_points(lats, lons, [A])


def test_bare_geometry():
    lats, lons, _ = parse_points({"type": "Point", "coordinates": [A[1], A[0]]})
    assert_points(lats, lons, [A])


# --- geometry kinds ---------------------------------------------------------------
def test_linestring_transposes_to_lat_lon(line_feature):
    lines, _ = parse_lines(gj_collection(line_feature))
    assert_coords(lines[0], LINE, label="LineString")


def test_polygon_transposes_and_closes(polygon_feature):
    polygons, _ = parse_polygons(gj_collection(polygon_feature))
    assert_coords(polygons[0], RING, label="Polygon")
    assert_closed(polygons[0])


def test_multipoint_yields_each_point():
    fc = gj_collection(gj_feature("MultiPoint", lonlat([A, B, C])))
    lats, lons, _ = parse_points(fc)
    assert_points(lats, lons, [A, B, C])


def test_multilinestring_yields_each_line():
    fc = gj_collection(gj_feature("MultiLineString", [lonlat(LINE), lonlat(SECOND_LINE)]))
    lines, _ = parse_lines(fc)
    assert len(lines) == 2
    assert_coords(lines[0], LINE, label="first")
    assert_coords(lines[1], SECOND_LINE, label="second")


def test_multipolygon_yields_each_polygon():
    fc = gj_collection(gj_feature("MultiPolygon", [[lonlat(RING)], [lonlat(SECOND_RING)]]))
    polygons, _ = parse_polygons(fc)
    assert len(polygons) == 2
    for ring in polygons:
        assert_closed(ring)


# --- filtering --------------------------------------------------------------------
def test_each_kind_reaches_only_its_own_parser(point_feature, line_feature, polygon_feature):
    fc = gj_collection(point_feature, line_feature, polygon_feature)
    assert len(parse_points(fc)[0]) == 1
    assert len(parse_lines(fc)[0]) == 1
    assert len(parse_polygons(fc)[0]) == 1


def test_collection_without_a_kind_yields_nothing_rather_than_raising(point_feature):
    fc = gj_collection(point_feature)
    assert parse_lines(fc)[0] == []
    assert parse_polygons(fc)[0] == []


def test_empty_feature_collection():
    fc = gj_collection()
    assert len(parse_points(fc)[0]) == 0
    assert parse_lines(fc)[0] == []
    assert parse_polygons(fc)[0] == []


# --- properties -------------------------------------------------------------------
def test_properties_are_collected(point_feature, line_feature, polygon_feature):
    _, _, props = parse_points(gj_collection(point_feature))
    assert props["site"] == ["S1"]
    _, line_props = parse_lines(gj_collection(line_feature))
    assert line_props["route"] == ["R1"]
    _, poly_props = parse_polygons(gj_collection(polygon_feature))
    assert poly_props["zone"] == ["Z1"]


def test_feature_without_properties_is_tolerated():
    fc = gj_collection({"type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [A[1], A[0]]}})
    lats, _, props = parse_points(fc)
    assert len(lats) == 1
    assert props == {}


def test_multipolygon_uses_only_the_exterior_ring():
    """A hole is not currently rendered, so only the outer ring is taken."""
    outer, hole = lonlat(RING), lonlat(SECOND_RING)
    fc = gj_collection(gj_feature("Polygon", [outer, hole]))
    polygons, _ = parse_polygons(fc)
    assert len(polygons) == 1
    assert_coords(polygons[0], RING, label="exterior ring")
