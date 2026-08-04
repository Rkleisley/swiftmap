"""
Raw Python inputs: coordinate lists, dicts of columns, and lists of row dicts.

These are the fallback parsers, registered last so they never shadow a typed source.
"""
import pytest
import numpy as np

from geometry import (
    A, B, C, LINE, RING, RING_OPEN, SECOND_LINE,
    assert_coords, assert_points, assert_closed,
)
from swiftmap.parsers import parse_points, parse_lines, parse_polygons


# --- coordinate lists -------------------------------------------------------------
def test_list_of_pairs_as_points():
    lats, lons, _, _ = parse_points([list(A), list(B)])
    assert_points(lats, lons, [A, B])


def test_single_pair_as_one_point():
    lats, lons, _, _ = parse_points([A[0], A[1]])
    assert_points(lats, lons, [A])


def test_list_of_pairs_as_one_line():
    lines, _ = parse_lines([list(A), list(B), list(C)])
    assert len(lines) == 1
    assert_coords(lines[0], LINE, label="single line")


def test_nested_lists_as_several_lines():
    lines, _ = parse_lines([[list(A), list(B)], [list(p) for p in SECOND_LINE]])
    assert len(lines) == 2
    assert_coords(lines[0], [list(A), list(B)], label="first")


def test_list_of_pairs_as_one_polygon_and_closed():
    polygons, _ = parse_polygons([list(p) for p in RING_OPEN])
    assert len(polygons) == 1
    assert_closed(polygons[0])


def test_nested_lists_as_several_polygons():
    polygons, _ = parse_polygons([
        [list(p) for p in RING_OPEN],
        [[35.90, -5.40], [35.95, -5.35], [35.92, -5.30]],
    ])
    assert len(polygons) == 2
    for ring in polygons:
        assert_closed(ring)


def test_numpy_array_of_coordinates():
    lats, lons, _, _ = parse_points(np.array([list(A), list(B)]))
    assert_points(lats, lons, [A, B])


def test_empty_list_yields_nothing():
    lats, _, _, _ = parse_points([])
    assert len(lats) == 0
    assert parse_lines([])[0] == []
    assert parse_polygons([])[0] == []


# --- dict of columns --------------------------------------------------------------
def test_dict_of_columns_as_points():
    lats, lons, _, _ = parse_points({"lat": [A[0], B[0]], "lon": [A[1], B[1]]})
    assert_points(lats, lons, [A, B])


def test_dict_keeps_other_keys_as_properties():
    data = {"lat": [A[0], B[0]], "lon": [A[1], B[1]], "city": ["Tarifa", "Ceuta"]}
    _, _, props, _ = parse_points(data)
    assert props["city"] == ["Tarifa", "Ceuta"]
    assert "lat" not in props


def test_dict_alternate_column_names():
    lats, lons, _, _ = parse_points({"latitude": [A[0]], "longitude": [A[1]]})
    assert_points(lats, lons, [A])


def test_dict_as_a_line():
    lines, _ = parse_lines({"lat": [p[0] for p in LINE], "lon": [p[1] for p in LINE]})
    assert_coords(lines[0], LINE, label="dict line")


def test_dict_without_coordinates_raises():
    with pytest.raises(ValueError, match="lat/lon"):
        parse_points({"name": ["nowhere"]})


# --- list of row dicts ------------------------------------------------------------
def test_list_of_row_dicts_as_points():
    rows = [{"lat": A[0], "lon": A[1], "city": "Tarifa"},
            {"lat": B[0], "lon": B[1], "city": "Ceuta"}]
    lats, lons, props, _ = parse_points(rows)
    assert_points(lats, lons, [A, B])
    assert props["city"] == ["Tarifa", "Ceuta"]


def test_list_of_row_dicts_grouped_into_lines():
    rows = [{"track_id": "T1", "lat": A[0], "lon": A[1]},
            {"track_id": "T1", "lat": B[0], "lon": B[1]},
            {"track_id": "T2", "lat": SECOND_LINE[0][0], "lon": SECOND_LINE[0][1]},
            {"track_id": "T2", "lat": SECOND_LINE[1][0], "lon": SECOND_LINE[1][1]}]
    lines, props = parse_lines(rows)
    assert len(lines) == 2
    assert props["track_id"] == ["T1", "T2"]


def test_list_of_row_dicts_without_coordinates_raises():
    with pytest.raises(ValueError, match="lat/lon"):
        parse_points([{"name": "nowhere"}])


# --- dispatch precedence ----------------------------------------------------------
def test_geojson_dict_is_not_captured_by_the_plain_dict_parser():
    """`is_dict` excludes anything carrying a 'type' key so GeoJSON keeps priority."""
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [A[1], A[0]]},
         "properties": {}}]}
    lats, lons, _, _ = parse_points(gj)
    assert_points(lats, lons, [A])
