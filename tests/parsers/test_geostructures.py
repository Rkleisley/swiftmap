"""
geostructures parsing.

Dispatch is by the library's own type mixins rather than by probing for attributes. The
regression tests at the bottom pin the failures that duck-typing caused: `centroid` exists
on every shape, `to_polygon` exists on lines, `MultiGeoLineString` has no `vertices`, and
`MultiGeoPolygon` has no `to_polygon`.
"""
import pytest

from geometry import A, B, C, LINE, RING, assert_coords, assert_points, assert_closed
from swiftmap.parsers import parse_points, parse_lines, parse_polygons

pytest.importorskip("geostructures")
from geostructures import (  # noqa: E402
    Coordinate, GeoPoint, GeoLineString, GeoPolygon, GeoBox, GeoCircle, GeoRing,
    MultiGeoPoint, MultiGeoLineString, MultiGeoPolygon,
)
from geostructures.collections import FeatureCollection, Track  # noqa: E402


def coord(pt):
    """geostructures Coordinate is (longitude, latitude)."""
    return Coordinate(pt[1], pt[0])


@pytest.fixture
def point():
    return GeoPoint(coord(A))


@pytest.fixture
def line():
    return GeoLineString([coord(A), coord(B), coord(C)])


@pytest.fixture
def polygon():
    return GeoPolygon([coord(A), coord(C), coord(B), coord(A)])


# --- basic parsing ----------------------------------------------------------------
def test_point_parses_to_its_coordinate(point):
    lats, lons, _ = parse_points([point])
    assert_points(lats, lons, [A])


def test_linestring_keeps_vertex_order(line):
    lines, _ = parse_lines([line])
    assert_coords(lines[0], LINE, label="GeoLineString")


def test_polygon_ring_is_closed(polygon):
    polygons, _ = parse_polygons([polygon])
    assert_closed(polygons[0])


@pytest.mark.parametrize("shape_factory", [
    pytest.param(lambda: GeoBox(coord(A), coord(B)), id="GeoBox"),
    pytest.param(lambda: GeoCircle(coord(A), radius=500), id="GeoCircle"),
])
def test_derived_polygon_shapes_parse_as_polygons(shape_factory):
    shape = shape_factory()
    polygons, _ = parse_polygons([shape])
    assert len(polygons) == 1
    assert_closed(polygons[0])
    assert not len(parse_points([shape])[0]), "a polygon-like shape is not a point"
    assert not len(parse_lines([shape])[0]), "a polygon-like shape is not a line"


def test_georing_yields_outer_boundary_and_hole():
    polygons, _ = parse_polygons([GeoRing(coord(A), inner_radius=200, outer_radius=500)])
    assert len(polygons) == 2, "a ring contributes its outer boundary and its hole"
    for ring in polygons:
        assert_closed(ring)


# --- collections ------------------------------------------------------------------
def test_mixed_collection_splits_by_kind(point, line, polygon):
    fc = FeatureCollection([point, line, polygon])
    assert len(parse_points(fc)[0]) == 1
    assert len(parse_lines(fc)[0]) == 1
    assert len(parse_polygons(fc)[0]) == 1


def test_bare_shape_without_a_list(point):
    lats, lons, _ = parse_points(point)
    assert_points(lats, lons, [A])


def test_empty_track_yields_nothing():
    assert len(parse_points(Track([]))[0]) == 0, "an empty Track yields nothing, without raising"


@pytest.mark.parametrize("shapes,expected", [
    pytest.param(
        lambda t0, td: [GeoPoint(coord(A), dt=t0), GeoPoint(coord(B), dt=t0 + td)],
        (2, 0, 0), id="points"),
    pytest.param(
        lambda t0, td: [GeoLineString([coord(A), coord(B)], dt=t0),
                        GeoLineString([coord(B), coord(C)], dt=t0 + td)],
        (0, 2, 0), id="lines"),
    pytest.param(
        lambda t0, td: [GeoPolygon([coord(A), coord(C), coord(B), coord(A)], dt=t0),
                        GeoPolygon([coord(B), coord(C), coord(A), coord(B)], dt=t0 + td)],
        (0, 0, 2), id="polygons"),
])
def test_track_contents_route_by_shape_type(shapes, expected):
    """
    A Track groups shapes by time, not by geometry: it may hold points, lines or polygons.
    Its contents dispatch by shape type like any other collection, so a Track of polygons
    is polygons -- not points, and not a line through them.
    """
    import datetime as dt
    track = Track(shapes(dt.datetime(2026, 1, 1), dt.timedelta(hours=1)))
    counts = (len(parse_points(track)[0]),
              len(parse_lines(track)[0]),
              len(parse_polygons(track)[0]))
    assert counts == expected


def test_track_timestamps_reach_properties():
    """geostructures exposes the time interval as properties, so popups can show it."""
    import datetime as dt
    t0 = dt.datetime(2026, 1, 1)
    track = Track([GeoPoint(coord(A), dt=t0), GeoPoint(coord(B), dt=t0 + dt.timedelta(hours=1))])
    _, _, props = parse_points(track)
    assert "datetime_start" in props and len(props["datetime_start"]) == 2


def test_collection_containing_a_multi_is_flattened(line):
    fc = FeatureCollection([MultiGeoPoint([GeoPoint(coord(A)), GeoPoint(coord(B))]), line])
    assert len(parse_points(fc)[0]) == 2, "nested Multi shapes expand recursively"
    assert len(parse_lines(fc)[0]) == 1


# --- properties -------------------------------------------------------------------
def test_properties_are_collected(point):
    tagged = GeoPoint(coord(A), properties={"site": "S1", "active": True})
    _, _, props = parse_points([tagged])
    assert props["site"] == ["S1"]
    assert props["active"] == [True]


def test_properties_propagate_through_multi_expansion():
    multi = MultiGeoPolygon(
        [GeoPolygon([coord(A), coord(C), coord(B), coord(A)]),
         GeoPolygon([coord(B), coord(C), coord(A), coord(B)])],
        properties={"zone": "Z1"},
    )
    polygons, props = parse_polygons([multi])
    assert len(polygons) == 2
    assert props["zone"] == ["Z1", "Z1"], "each expanded part keeps the feature's metadata"


def test_shapes_with_differing_property_keys_are_unioned():
    shapes = [GeoPoint(coord(A), properties={"a": 1}), GeoPoint(coord(B), properties={"b": 2})]
    _, _, props = parse_points(shapes)
    assert props["a"] == [1, None]
    assert props["b"] == [None, 2]


# --- regressions ------------------------------------------------------------------
def test_polygon_does_not_also_parse_as_a_point(polygon):
    """`centroid` exists on every shape, so polygons used to render a phantom marker."""
    assert len(parse_points([polygon])[0]) == 0


def test_line_does_not_also_parse_as_a_polygon(line):
    """`to_polygon` exists on lines, so lines used to render a phantom polygon."""
    assert len(parse_polygons([line])[0]) == 0


def test_line_does_not_also_parse_as_a_point(line):
    assert len(parse_points([line])[0]) == 0


def test_multigeopoint_yields_every_point_not_one_centroid():
    """Previously collapsed to a single centroid."""
    lats, lons, _ = parse_points([MultiGeoPoint([GeoPoint(coord(A)), GeoPoint(coord(B))])])
    assert_points(lats, lons, [A, B])


def test_multigeolinestring_yields_every_line():
    """Previously produced nothing: MultiGeoLineString has no `vertices` attribute."""
    multi = MultiGeoLineString([
        GeoLineString([coord(A), coord(B)]),
        GeoLineString([coord(B), coord(C)]),
    ])
    lines, _ = parse_lines([multi])
    assert len(lines) == 2
    assert_coords(lines[0], [list(A), list(B)], label="first line")
    assert_coords(lines[1], [list(B), list(C)], label="second line")


def test_multigeopolygon_parses_without_error():
    """Previously raised: MultiGeoPolygon has `linear_rings` but no `to_polygon`."""
    multi = MultiGeoPolygon([
        GeoPolygon([coord(A), coord(C), coord(B), coord(A)]),
        GeoPolygon([coord(B), coord(C), coord(A), coord(B)]),
    ])
    polygons, _ = parse_polygons([multi])
    assert len(polygons) == 2
    for ring in polygons:
        assert_closed(ring)


# --- source detection ---------------------------------------------------------------
@pytest.mark.parametrize("factory", [
    pytest.param(lambda: GeoPoint(coord(A)), id="GeoPoint"),
    pytest.param(lambda: GeoLineString([coord(A), coord(B)]), id="GeoLineString"),
    pytest.param(lambda: GeoPolygon([coord(A), coord(C), coord(B), coord(A)]), id="GeoPolygon"),
    pytest.param(lambda: GeoBox(coord(A), coord(B)), id="GeoBox"),
    pytest.param(lambda: GeoCircle(coord(A), radius=500), id="GeoCircle"),
    pytest.param(lambda: GeoRing(coord(A), inner_radius=1, outer_radius=2), id="GeoRing"),
    pytest.param(lambda: MultiGeoPoint([GeoPoint(coord(A))]), id="MultiGeoPoint"),
    pytest.param(lambda: FeatureCollection([GeoPoint(coord(A))]), id="FeatureCollection"),
    pytest.param(lambda: Track([]), id="Track"),
])
def test_every_geostructures_type_is_recognised(factory):
    from swiftmap.parsers.sources.geostructures import is_geostructures
    shape = factory()
    assert is_geostructures(shape), "bare shape"
    assert is_geostructures([shape]), "inside a list"


def test_non_geostructures_input_is_not_claimed():
    from swiftmap.parsers.sources.geostructures import is_geostructures
    # A Coordinate is part of geostructures but is not a shape, so it must not be claimed.
    assert not is_geostructures(Coordinate(-5.3, 36.0))
    assert not is_geostructures({"type": "FeatureCollection", "features": []})
    assert not is_geostructures([[36.0, -5.3]])
    assert not is_geostructures([])
    assert not is_geostructures(object())
