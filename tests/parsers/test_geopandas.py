"""
GeoPandas / Shapely parsing.

Shapely geometries are x/y (lon/lat), so these also guard the transposition into
swiftmap's [lat, lon] output.
"""
import pytest

from geometry import (
    A, B, C, LINE, RING, SECOND_LINE,
    assert_coords, assert_points, assert_closed,
)
from swiftmap.parsers import parse_points, parse_lines, parse_polygons

gpd = pytest.importorskip("geopandas")
shapely = pytest.importorskip("shapely")
from shapely.geometry import (  # noqa: E402
    Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon,
)


def xy(pt):
    """Shapely takes (x, y) = (lon, lat)."""
    return (pt[1], pt[0])


@pytest.fixture
def mixed_gdf():
    return gpd.GeoDataFrame(
        {"kind": ["p", "l", "g"]},
        geometry=[
            Point(xy(A)),
            LineString([xy(A), xy(B), xy(C)]),
            Polygon([xy(A), xy(C), xy(B), xy(A)]),
        ],
    )


# --- geometry kinds ---------------------------------------------------------------
def test_point_transposes_to_lat_lon():
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[Point(xy(A))])
    lats, lons, _ = parse_points(gdf)
    assert_points(lats, lons, [A])


def test_linestring_keeps_vertex_order():
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[LineString([xy(A), xy(B), xy(C)])])
    lines, _ = parse_lines(gdf)
    assert_coords(lines[0], LINE, label="LineString")


def test_polygon_ring_is_closed():
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[Polygon([xy(A), xy(C), xy(B), xy(A)])])
    polygons, _ = parse_polygons(gdf)
    assert_closed(polygons[0])


def test_multipoint_yields_each_point():
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[MultiPoint([xy(A), xy(B)])])
    lats, lons, _ = parse_points(gdf)
    assert_points(lats, lons, [A, B])


def test_multilinestring_yields_each_line():
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[
        MultiLineString([[xy(A), xy(B)], [xy(B), xy(C)]])])
    lines, _ = parse_lines(gdf)
    assert len(lines) == 2


def test_multipolygon_stays_one_feature_with_parts():
    # One MultiPolygon is one feature -- it used to split into a layer per part.
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[MultiPolygon([
        Polygon([xy(A), xy(C), xy(B), xy(A)]),
        Polygon([xy(B), xy(C), xy(A), xy(B)]),
    ])])
    polygons, _ = parse_polygons(gdf)
    assert len(polygons) == 1
    assert polygons[0].ring_lengths() == [[4], [4]]


def test_polygon_interiors_are_kept():
    # Shapely holes (interiors) survive as extra rings of the same part.
    outer = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)]
    hole = [(2.0, 2.0), (4.0, 2.0), (4.0, 4.0), (2.0, 4.0), (2.0, 2.0)]
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[Polygon(outer, [hole])])
    polygons, _ = parse_polygons(gdf)
    assert len(polygons) == 1
    assert polygons[0].ring_lengths() == [[5, 5]]


# --- filtering --------------------------------------------------------------------
def test_each_kind_reaches_only_its_own_parser(mixed_gdf):
    assert len(parse_points(mixed_gdf)[0]) == 1
    assert len(parse_lines(mixed_gdf)[0]) == 1
    assert len(parse_polygons(mixed_gdf)[0]) == 1


def test_geoseries_is_accepted():
    series = gpd.GeoSeries([Point(xy(A)), Point(xy(B))])
    lats, lons, _ = parse_points(series)
    assert_points(lats, lons, [A, B])


# --- properties and edge cases ----------------------------------------------------
def test_non_geometry_columns_become_properties():
    gdf = gpd.GeoDataFrame({"city": ["Tarifa"], "pop": [18000]}, geometry=[Point(xy(A))])
    _, _, props = parse_points(gdf)
    assert props["city"] == ["Tarifa"]
    assert props["pop"] == [18000]
    assert "geometry" not in props


def test_multi_geometry_repeats_the_row_properties():
    gdf = gpd.GeoDataFrame({"zone": ["Z1"]}, geometry=[MultiPoint([xy(A), xy(B)])])
    _, _, props = parse_points(gdf)
    assert props["zone"] == ["Z1", "Z1"], "each expanded point keeps its row's metadata"


def test_none_geometry_is_skipped():
    gdf = gpd.GeoDataFrame({"n": ["a", "b"]}, geometry=[Point(xy(A)), None])
    lats, lons, _ = parse_points(gdf)
    assert_points(lats, lons, [A])


def test_empty_geodataframe():
    gdf = gpd.GeoDataFrame({"n": []}, geometry=[])
    assert len(parse_points(gdf)[0]) == 0
    assert parse_lines(gdf)[0] == []
    assert parse_polygons(gdf)[0] == []
