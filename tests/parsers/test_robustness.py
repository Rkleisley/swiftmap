"""
Behaviour that spans sources: dispatch precedence, malformed input, and values that have
to survive the trip to the browser.

Every case here was found by auditing what the parsers intend versus what they assert.
"""
import datetime
import decimal
import json
import warnings

import pytest
import numpy as np

from geometry import A, B, C, LINE, RING, assert_points, assert_coords, wkt_point
from swiftmap.parsers import parse_points, parse_lines, parse_polygons, supports_mixed_geometry
from swiftmap.parsers.sources._utils import find_column_or_key

pd = pytest.importorskip("pandas")
pl = pytest.importorskip("polars")
FRAMES = [pytest.param(pd.DataFrame, id="pandas"), pytest.param(pl.DataFrame, id="polars")]


# --- dispatch precedence ----------------------------------------------------------
def test_geodataframe_takes_the_geopandas_path_not_the_pandas_one():
    """
    GeoDataFrame subclasses DataFrame, so is_pandas_dataframe() is True for one. It parses
    correctly only because GeoPandas is registered ahead of pandas in registry.py. Reorder
    those blocks and a GeoDataFrame silently parses as a plain table with no geometry.
    """
    gpd = pytest.importorskip("geopandas")
    from shapely.geometry import Point
    gdf = gpd.GeoDataFrame({"n": ["a"]}, geometry=[Point(A[1], A[0])])

    assert isinstance(gdf, pd.DataFrame), "precondition: GeoDataFrame is a DataFrame"
    lats, lons, _ = parse_points(gdf)
    assert_points(lats, lons, [A])


def test_geojson_dict_outranks_the_plain_dict_parser():
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [A[1], A[0]]},
         "properties": {}}]}
    lats, lons, _ = parse_points(gj)
    assert_points(lats, lons, [A])


@pytest.mark.parametrize("parse", [parse_points, parse_lines, parse_polygons])
def test_unsupported_type_names_the_type_and_points_at_contributing(parse):
    with pytest.raises(TypeError, match="no registered parser handles it") as exc:
        parse(object())
    assert "CONTRIBUTING.md" in str(exc.value), "the error should say how to add a source"


@pytest.mark.parametrize("parse", [parse_points, parse_lines, parse_polygons])
def test_a_type_from_a_supported_library_blames_the_import(parse):
    """
    Every is_x check swallows ImportError and returns False, so a library that is installed
    but fails to import makes its own types look unsupported. That reads as nonsense to
    someone who plainly has pandas, so it is reported as an import problem instead.
    """
    with pytest.raises(TypeError, match="failing to import") as exc:
        parse(pd.Series([1, 2]))
    assert "import pandas" in str(exc.value)


# --- column detection -------------------------------------------------------------
@pytest.mark.parametrize("lat_name,lon_name", [
    ("LAT", "LON"), ("Lat", "Lon"), ("Latitude", "Longitude"), ("LATITUDE", "LONGITUDE"),
])
@pytest.mark.parametrize("mk", FRAMES)
def test_column_detection_is_case_insensitive(mk, lat_name, lon_name):
    lats, lons, _ = parse_points(mk({lat_name: [A[0]], lon_name: [A[1]]}))
    assert_points(lats, lons, [A])


def test_find_column_or_key_returns_the_first_candidate_that_matches():
    # Candidate order decides, not column order.
    assert find_column_or_key(["id", "track_id"], ["track_id", "id"]) == "track_id"
    assert find_column_or_key(["id"], ["track_id", "id"]) == "id"
    assert find_column_or_key(["nope"], ["track_id", "id"]) is None


# --- missing and malformed coordinates --------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
def test_null_coordinates_are_dropped_with_a_warning(mk):
    """
    A null in a coordinate column becomes NaN, which reaches the WebGL buffer without
    raising and corrupts the draw. Rows are dropped so one bad record cannot kill a map.
    """
    df = mk({"lat": [A[0], None, C[0]], "lon": [A[1], B[1], None], "n": ["a", "b", "c"]})
    with pytest.warns(UserWarning, match="Dropped 2 of 3"):
        lats, lons, props = parse_points(df)
    assert_points(lats, lons, [A])
    assert props["n"] == ["a"], "properties are filtered alongside the coordinates"


@pytest.mark.parametrize("mk", FRAMES)
def test_all_valid_coordinates_warn_about_nothing(mk):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        lats, _, _ = parse_points(mk({"lat": [A[0]], "lon": [A[1]]}))
    assert len(lats) == 1


def test_geojson_feature_with_null_geometry_is_skipped():
    """`"geometry": null` is valid GeoJSON for an unlocated feature."""
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"n": "unlocated"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [A[1], A[0]]},
         "properties": {"n": "ok"}}]}
    lats, lons, _ = parse_points(fc)
    assert_points(lats, lons, [A])
    assert parse_lines(fc)[0] == []
    assert parse_polygons(fc)[0] == []


def test_geojson_point_with_too_few_coordinates_is_skipped():
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [1.0]},
         "properties": {}}]}
    assert len(parse_points(fc)[0]) == 0


# --- values that must survive the widget transport --------------------------------
def test_property_values_are_json_serializable_after_add():
    """
    Properties carry whatever the source column held. Timestamps and numpy scalars parse
    fine and then fail during traitlets serialization, far from the column responsible.
    """
    from ipywidgets.widgets.widget import Widget
    Widget.on_widget_constructed(None)
    from swiftmap import Map

    df = pd.DataFrame({
        "lat": [A[0]], "lon": [A[1]],
        "when": pd.to_datetime(["2026-01-01T12:30:00"]),
        "day": [datetime.date(2026, 1, 1)],
        "count": [np.int64(5)],
        "ratio": [np.float32(1.5)],
        "money": [decimal.Decimal("2.50")],
    })
    m = Map()
    m.add_markers(df, name="M")
    props = m.layers[-1].get("properties")

    json.dumps(props)  # raises TypeError if any value is not serializable
    assert props["when"] == ["2026-01-01T12:30:00"]
    assert props["count"] == [5]
    assert props["money"] == [2.5]


# --- coordinate order on polygons -------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
def test_polygon_coord_order_is_respected(mk):
    ring_lonlat = [[p[1], p[0]] for p in (A, C, B)]
    polygons, _ = parse_polygons(ring_lonlat, coord_order="lon_lat")
    assert_coords(polygons[0][:3], [list(A), list(C), list(B)], label="lon_lat polygon")


# --- wide format edge cases -------------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
def test_wide_columns_with_a_gap_use_the_matching_pairs(mk):
    """lat1/lon1/lat3/lon3: index 2 is absent, so the intersection is {1, 3}."""
    lines, _ = parse_lines(mk({"lat1": [A[0]], "lon1": [A[1]], "lat3": [B[0]], "lon3": [B[1]]}))
    assert_coords(lines[0], [list(A), list(B)], label="gapped wide columns")


@pytest.mark.parametrize("mk", FRAMES)
def test_wide_columns_without_a_matching_pair_yield_nothing(mk):
    """lat1/lat2/lon1: only index 1 pairs up, too few for a line, and no other tier matches."""
    lines, props = parse_lines(mk({"lat1": [A[0]], "lat2": [B[0]], "lon1": [A[1]]}))
    assert lines == [] and props == {}


# --- mixed-geometry capability ----------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
def test_supports_mixed_geometry_requires_actual_wkt_content(mk):
    assert supports_mixed_geometry(mk({"geometry": [wkt_point(A)]}))
    assert not supports_mixed_geometry(mk({"lat": [A[0]], "lon": [A[1]]}))
    # A promising column name is not enough: 'coords' often holds delimited pairs.
    assert not supports_mixed_geometry(mk({"coords": ["-5.30 36.00; -5.20 36.10"]}))


def test_supports_mixed_geometry_accepts_typed_sources():
    gj = {"type": "FeatureCollection", "features": []}
    assert supports_mixed_geometry(gj)
    assert not supports_mixed_geometry([[36.0, -5.3]])
    assert not supports_mixed_geometry(object())
