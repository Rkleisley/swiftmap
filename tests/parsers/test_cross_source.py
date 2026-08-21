"""
The same geometry, expressed in every supported source, must parse identically.

This is the strongest guard in the suite. A source that transposes lat/lon, drops a
vertex, fails to close a ring, or leaks one geometry kind into another parser diverges
from its peers here, and it catches those faults in a new source before anyone renders it.
"""
import pytest

from geometry import (
    A, B, C, LINE, RING, RING_OPEN, SECOND_LINE,
    assert_coords, assert_points, assert_closed,
    wkt_point, wkt_line, wkt_multiline, wkt_polygon, gj_feature, gj_collection, lonlat,
)
from swiftmap.parsers import parse_points, parse_lines, parse_polygons

pd = pytest.importorskip("pandas")
pl = pytest.importorskip("polars")
gpd = pytest.importorskip("geopandas")
pytest.importorskip("geostructures")

from shapely.geometry import Point, LineString, MultiLineString, Polygon  # noqa: E402
from geostructures import (  # noqa: E402
    Coordinate, GeoPoint, GeoLineString, GeoPolygon, MultiGeoLineString,
)
from geostructures.collections import FeatureCollection  # noqa: E402


def gs(pt):
    return Coordinate(pt[1], pt[0])


def xy(pt):
    return (pt[1], pt[0])


# Every representation of the same single point.
POINT_SOURCES = {
    "geojson": lambda: gj_collection(gj_feature("Point", [A[1], A[0]])),
    "geostructures": lambda: [GeoPoint(gs(A))],
    "geopandas": lambda: gpd.GeoDataFrame({"n": ["a"]}, geometry=[Point(xy(A))]),
    "pandas_latlon": lambda: pd.DataFrame({"lat": [A[0]], "lon": [A[1]]}),
    "polars_latlon": lambda: pl.DataFrame({"lat": [A[0]], "lon": [A[1]]}),
    "pandas_wkt": lambda: pd.DataFrame({"geometry": [wkt_point(A)]}),
    "polars_wkt": lambda: pl.DataFrame({"geometry": [wkt_point(A)]}),
    "coordinate_list": lambda: [list(A)],
    "dict_of_columns": lambda: {"lat": [A[0]], "lon": [A[1]]},
    "list_of_row_dicts": lambda: [{"lat": A[0], "lon": A[1]}],
}

# Every representation of the same three-vertex line.
LINE_SOURCES = {
    "geojson": lambda: gj_collection(gj_feature("LineString", lonlat(LINE))),
    "geostructures": lambda: [GeoLineString([gs(A), gs(B), gs(C)])],
    "geopandas": lambda: gpd.GeoDataFrame({"n": ["a"]},
                                          geometry=[LineString([xy(A), xy(B), xy(C)])]),
    "pandas_wkt": lambda: pd.DataFrame({"wkt": [wkt_line(LINE)]}),
    "polars_wkt": lambda: pl.DataFrame({"wkt": [wkt_line(LINE)]}),
    "pandas_latlon": lambda: pd.DataFrame({"lat": [p[0] for p in LINE],
                                           "lon": [p[1] for p in LINE]}),
    "polars_latlon": lambda: pl.DataFrame({"lat": [p[0] for p in LINE],
                                           "lon": [p[1] for p in LINE]}),
    "pandas_wide": lambda: pd.DataFrame({"lat1": [A[0]], "lon1": [A[1]],
                                         "lat2": [B[0]], "lon2": [B[1]],
                                         "lat3": [C[0]], "lon3": [C[1]]}),
    "coordinate_list": lambda: [list(A), list(B), list(C)],
}

# Every representation of the same two-part line.
MULTILINE_SOURCES = {
    "geojson": lambda: gj_collection(
        gj_feature("MultiLineString", [lonlat(LINE), lonlat(SECOND_LINE)])),
    "geostructures": lambda: [MultiGeoLineString([
        GeoLineString([gs(p) for p in LINE]),
        GeoLineString([gs(p) for p in SECOND_LINE])])],
    "geopandas": lambda: gpd.GeoDataFrame({"n": ["a"]}, geometry=[
        MultiLineString([[xy(p) for p in LINE], [xy(p) for p in SECOND_LINE]])]),
    "pandas_wkt": lambda: pd.DataFrame({"wkt": [wkt_multiline([LINE, SECOND_LINE])]}),
    "polars_wkt": lambda: pl.DataFrame({"wkt": [wkt_multiline([LINE, SECOND_LINE])]}),
}

# Every representation of the same triangle.
POLYGON_SOURCES = {
    "geojson": lambda: gj_collection(gj_feature("Polygon", [lonlat(RING)])),
    "geostructures": lambda: [GeoPolygon([gs(A), gs(C), gs(B), gs(A)])],
    "geopandas": lambda: gpd.GeoDataFrame({"n": ["a"]},
                                          geometry=[Polygon([xy(A), xy(C), xy(B), xy(A)])]),
    "pandas_wkt": lambda: pd.DataFrame({"wkt": [wkt_polygon(RING)]}),
    "polars_wkt": lambda: pl.DataFrame({"wkt": [wkt_polygon(RING)]}),
    "pandas_latlon": lambda: pd.DataFrame({"lat": [p[0] for p in RING_OPEN],
                                           "lon": [p[1] for p in RING_OPEN]}),
    "polars_latlon": lambda: pl.DataFrame({"lat": [p[0] for p in RING_OPEN],
                                           "lon": [p[1] for p in RING_OPEN]}),
    "coordinate_list": lambda: [list(p) for p in RING_OPEN],
}


@pytest.mark.parametrize("source", POINT_SOURCES, ids=list(POINT_SOURCES))
def test_every_source_yields_the_same_point(source):
    lats, lons, _ = parse_points(POINT_SOURCES[source]())
    assert_points(lats, lons, [A])


@pytest.mark.parametrize("source", LINE_SOURCES, ids=list(LINE_SOURCES))
def test_every_source_yields_the_same_line(source):
    lines, _ = parse_lines(LINE_SOURCES[source]())
    assert len(lines) == 1, f"{source} produced {len(lines)} lines, expected 1"
    assert_coords(lines[0], LINE, label=source)


@pytest.mark.parametrize("source", MULTILINE_SOURCES, ids=list(MULTILINE_SOURCES))
def test_every_source_yields_the_same_multi_part_line(source):
    # ONE feature with two parts, never a line per part and never one merged run:
    # the merged run is how the phantom segment between the parts got drawn.
    lines, _ = parse_lines(MULTILINE_SOURCES[source]())
    assert len(lines) == 1, f"{source} produced {len(lines)} lines, expected 1"
    geom = lines[0]
    assert geom.part_lengths() == [len(LINE), len(SECOND_LINE)], source
    assert_coords(geom.parts[0], LINE, label=f"{source} part 1")
    assert_coords(geom.parts[1], SECOND_LINE, label=f"{source} part 2")


@pytest.mark.parametrize("source", POLYGON_SOURCES, ids=list(POLYGON_SOURCES))
def test_every_source_yields_the_same_polygon(source):
    polygons, _ = parse_polygons(POLYGON_SOURCES[source]())
    assert len(polygons) == 1, f"{source} produced {len(polygons)} polygons, expected 1"
    assert_coords(polygons[0], RING, label=source)
    assert_closed(polygons[0])


# --- mixed collections ------------------------------------------------------------
MIXED_SOURCES = {
    "geojson": lambda: gj_collection(
        gj_feature("Point", [A[1], A[0]]),
        gj_feature("LineString", lonlat(LINE)),
        gj_feature("Polygon", [lonlat(RING)]),
    ),
    "geostructures": lambda: FeatureCollection([
        GeoPoint(gs(A)),
        GeoLineString([gs(A), gs(B), gs(C)]),
        GeoPolygon([gs(A), gs(C), gs(B), gs(A)]),
    ]),
    "geopandas": lambda: gpd.GeoDataFrame({"n": ["p", "l", "g"]}, geometry=[
        Point(xy(A)),
        LineString([xy(A), xy(B), xy(C)]),
        Polygon([xy(A), xy(C), xy(B), xy(A)]),
    ]),
    "pandas_wkt": lambda: pd.DataFrame(
        {"geometry": [wkt_point(A), wkt_line(LINE), wkt_polygon(RING)]}),
    "polars_wkt": lambda: pl.DataFrame(
        {"geometry": [wkt_point(A), wkt_line(LINE), wkt_polygon(RING)]}),
}


@pytest.mark.parametrize("source", MIXED_SOURCES, ids=list(MIXED_SOURCES))
def test_mixed_collection_splits_one_of_each(source):
    """Exactly one geometry per parser: no kind leaks into another, none is dropped."""
    data = MIXED_SOURCES[source]()
    counts = (len(parse_points(data)[0]), len(parse_lines(data)[0]), len(parse_polygons(data)[0]))
    assert counts == (1, 1, 1), f"{source} split as points/lines/polys={counts}, expected (1, 1, 1)"


@pytest.mark.parametrize("source", MIXED_SOURCES, ids=list(MIXED_SOURCES))
def test_mixed_collection_coordinates_agree_across_sources(source):
    data = MIXED_SOURCES[source]()
    lats, lons, _ = parse_points(data)
    assert_points(lats, lons, [A])
    assert_coords(parse_lines(data)[0][0], LINE, label=f"{source} line")
    assert_coords(parse_polygons(data)[0][0], RING, label=f"{source} polygon")
