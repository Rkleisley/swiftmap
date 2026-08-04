"""
pandas and polars, held to identical expectations.

Their multi-row grouping is implemented separately -- pandas iterates groupby sub-frames,
polars uses a native group_by/agg -- so every shared case runs against both. A divergence
between the two shows up as one parametrisation failing while its twin passes.
"""
import pytest

from cases import POINT_CASES, LINE_CASES, POLYGON_CASES
from geometry import (
    A, B, C, LINE, RING, RING_OPEN, SECOND_LINE,
    assert_coords, assert_points, assert_closed, wkt_line, wkt_point, wkt_polygon,
)
from swiftmap.parsers import parse_points, parse_lines, parse_polygons

pd = pytest.importorskip("pandas")
pl = pytest.importorskip("polars")

FRAMES = [pytest.param(pd.DataFrame, id="pandas"), pytest.param(pl.DataFrame, id="polars")]


def ids(cases):
    return [c[0] for c in cases]


# --- points -----------------------------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
@pytest.mark.parametrize("_id,build,expected", POINT_CASES, ids=ids(POINT_CASES))
def test_points(mk, _id, build, expected):
    lats, lons, _props = parse_points(build(mk))
    assert_points(lats, lons, expected)


@pytest.mark.parametrize("mk", FRAMES)
def test_points_keep_other_columns_as_properties(mk):
    df = mk({"lat": [A[0], B[0]], "lon": [A[1], B[1]],
             "city": ["Tarifa", "Ceuta"], "pop": [18000, 84000]})
    _lats, _lons, props = parse_points(df)
    assert props["city"] == ["Tarifa", "Ceuta"]
    assert props["pop"] == [18000, 84000]
    assert "lat" not in props and "lon" not in props, "coordinate columns are not properties"


@pytest.mark.parametrize("mk", FRAMES)
def test_points_explicit_columns_override_autodetect(mk):
    # Both pairs are plausible; the explicit arguments must decide.
    df = mk({"lat": [0.0], "lon": [0.0], "start_lat": [A[0]], "start_lon": [A[1]]})
    lats, lons, _ = parse_points(df, lat_col="start_lat", lon_col="start_lon")
    assert_points(lats, lons, [A])


@pytest.mark.parametrize("mk", FRAMES)
def test_points_without_coordinates_raises(mk):
    with pytest.raises(ValueError, match="lat/lon"):
        parse_points(mk({"name": ["nowhere"], "value": [1]}))


# --- lines ------------------------------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
@pytest.mark.parametrize("_id,build,expected", LINE_CASES, ids=ids(LINE_CASES))
def test_lines(mk, _id, build, expected):
    lines, _props = parse_lines(build(mk))
    assert len(lines) == len(expected), f"expected {len(expected)} line(s), got {len(lines)}"
    for got, want in zip(lines, expected):
        assert_coords(got, want, label="line")


@pytest.mark.parametrize("mk", FRAMES)
def test_lines_grouped_keep_group_key_in_properties(mk):
    df = mk({"track_id": ["T1", "T1", "T2", "T2"],
             "lat": [A[0], B[0], SECOND_LINE[0][0], SECOND_LINE[1][0]],
             "lon": [A[1], B[1], SECOND_LINE[0][1], SECOND_LINE[1][1]]})
    lines, props = parse_lines(df)
    assert len(lines) == 2
    assert props["track_id"] == ["T1", "T2"]


# --- polygons ---------------------------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
@pytest.mark.parametrize("_id,build,expected", POLYGON_CASES, ids=ids(POLYGON_CASES))
def test_polygons(mk, _id, build, expected):
    polygons, _props = parse_polygons(build(mk))
    assert len(polygons) == len(expected), f"expected {len(expected)}, got {len(polygons)}"
    for got, want in zip(polygons, expected):
        assert_coords(got, want, label="polygon")
        assert_closed(got)


@pytest.mark.parametrize("mk", FRAMES)
def test_polygons_close_an_open_ring(mk):
    df = mk({"lat": [p[0] for p in RING_OPEN], "lon": [p[1] for p in RING_OPEN]})
    polygons, _ = parse_polygons(df)
    assert len(polygons[0]) == len(RING_OPEN) + 1, "an open ring gains its closing vertex"
    assert_closed(polygons[0])


@pytest.mark.parametrize("mk", FRAMES)
def test_polygons_already_closed_ring_not_double_closed(mk):
    polygons, _ = parse_polygons(mk({"wkt": [wkt_polygon(RING)]}))
    assert len(polygons[0]) == len(RING), "a closed ring is not extended again"


# --- column selection: sorting ----------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
def test_lines_sorted_by_order_column(mk):
    # Rows deliberately out of order. Without sorting the path zigzags: it renders, and
    # it is wrong, which is exactly the failure that never raises.
    df = mk({"step": [3, 1, 2],
             "lat": [C[0], A[0], B[0]],
             "lon": [C[1], A[1], B[1]]})
    lines, _ = parse_lines(df)
    assert_coords(lines[0], LINE, label="line sorted by 'step'")


@pytest.mark.parametrize("mk", FRAMES)
@pytest.mark.parametrize("order_col", ["order", "step", "seq", "sequence", "index"])
def test_line_order_column_candidates_are_detected(mk, order_col):
    df = mk({order_col: [2, 1], "lat": [B[0], A[0]], "lon": [B[1], A[1]]})
    lines, _ = parse_lines(df)
    assert_coords(lines[0], [list(A), list(B)], label=f"sorted by '{order_col}'")


@pytest.mark.parametrize("mk", FRAMES)
def test_lines_explicit_order_col_overrides_autodetect(mk):
    # 'step' would be auto-detected; order_col must win and sort the other way.
    df = mk({"step": [1, 2], "rank": [2, 1],
             "lat": [B[0], A[0]], "lon": [B[1], A[1]]})
    lines, _ = parse_lines(df, order_col="rank")
    assert_coords(lines[0], [list(A), list(B)], label="sorted by explicit 'rank'")


@pytest.mark.parametrize("mk", FRAMES)
def test_sorting_applies_within_each_group(mk):
    df = mk({"track_id": ["T1", "T2", "T1", "T2"],
             "step": [2, 2, 1, 1],
             "lat": [B[0], SECOND_LINE[1][0], A[0], SECOND_LINE[0][0]],
             "lon": [B[1], SECOND_LINE[1][1], A[1], SECOND_LINE[0][1]]})
    lines, props = parse_lines(df)
    assert len(lines) == 2
    ordered = dict(zip(props["track_id"], lines))
    assert_coords(ordered["T1"], [list(A), list(B)], label="T1")
    assert_coords(ordered["T2"], SECOND_LINE, label="T2")


# --- column selection: grouping ---------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
@pytest.mark.parametrize("group_col", ["line_id", "track_id", "flight_id", "route_id", "segment_id"])
def test_line_group_column_candidates_are_detected(mk, group_col):
    df = mk({group_col: ["X", "X", "Y", "Y"],
             "lat": [A[0], B[0], SECOND_LINE[0][0], SECOND_LINE[1][0]],
             "lon": [A[1], B[1], SECOND_LINE[0][1], SECOND_LINE[1][1]]})
    lines, _ = parse_lines(df)
    assert len(lines) == 2, f"'{group_col}' should split the rows into 2 lines"


@pytest.mark.parametrize("mk", FRAMES)
def test_line_group_candidate_priority(mk):
    # Both 'track_id' and 'id' are candidates; 'track_id' is listed first and must win.
    # Grouping by 'id' instead would yield 4 single-vertex groups and no lines at all.
    df = mk({"id": [1, 2, 3, 4],
             "track_id": ["X", "X", "Y", "Y"],
             "lat": [A[0], B[0], SECOND_LINE[0][0], SECOND_LINE[1][0]],
             "lon": [A[1], B[1], SECOND_LINE[0][1], SECOND_LINE[1][1]]})
    lines, props = parse_lines(df)
    assert len(lines) == 2, "grouped by 'track_id', not 'id'"
    assert set(props["track_id"]) == {"X", "Y"}


@pytest.mark.parametrize("mk", FRAMES)
def test_lines_explicit_group_col_overrides_autodetect(mk):
    df = mk({"track_id": ["X", "X", "X", "X"],
             "vessel": ["V1", "V1", "V2", "V2"],
             "lat": [A[0], B[0], SECOND_LINE[0][0], SECOND_LINE[1][0]],
             "lon": [A[1], B[1], SECOND_LINE[0][1], SECOND_LINE[1][1]]})
    lines, props = parse_lines(df, line_id_col="vessel")
    assert len(lines) == 2, "grouped by the explicit 'vessel' column"
    assert set(props["vessel"]) == {"V1", "V2"}


@pytest.mark.parametrize("mk", FRAMES)
@pytest.mark.parametrize("group_col", ["shape_id", "polygon_id", "zone_id"])
def test_polygon_group_column_candidates_are_detected(mk, group_col):
    df = mk({group_col: ["Z1"] * 3 + ["Z2"] * 3,
             "lat": [p[0] for p in RING_OPEN] * 2,
             "lon": [p[1] for p in RING_OPEN] * 2})
    polygons, _ = parse_polygons(df)
    assert len(polygons) == 2, f"'{group_col}' should split the rows into 2 polygons"


@pytest.mark.parametrize("mk", FRAMES)
def test_polygons_explicit_shape_id_col_overrides_autodetect(mk):
    df = mk({"zone_id": ["same"] * 6,
             "parcel": ["P1"] * 3 + ["P2"] * 3,
             "lat": [p[0] for p in RING_OPEN] * 2,
             "lon": [p[1] for p in RING_OPEN] * 2})
    polygons, props = parse_polygons(df, shape_id_col="parcel")
    assert len(polygons) == 2
    assert set(props["parcel"]) == {"P1", "P2"}


# --- WKT type discipline ----------------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
def test_wkt_column_parses_only_its_own_geometry_kind(mk):
    """A mixed WKT column must yield each geometry exactly once, to one parser only."""
    df = mk({"geometry": [wkt_point(A), wkt_line(LINE), wkt_polygon(RING)],
             "n": ["p", "l", "g"]})
    lats, _lons, _ = parse_points(df)
    lines, _ = parse_lines(df)
    polygons, _ = parse_polygons(df)
    assert (len(lats), len(lines), len(polygons)) == (1, 1, 1), (
        "each WKT kind belongs to exactly one parser; a POLYGON read as a line was a real bug"
    )


@pytest.mark.parametrize("mk", FRAMES)
def test_plain_delimited_string_is_not_treated_as_wkt(mk):
    """Non-WKT coordinate strings still reach the permissive number-extraction path."""
    lines, _ = parse_lines(mk({"coords": ["-5.30 36.00; -5.20 36.10"]}), coord_order="lon_lat")
    assert_coords(lines[0], [list(A), list(B)], label="delimited pairs")


# --- coordinate order -------------------------------------------------------------
@pytest.mark.parametrize("mk", FRAMES)
def test_coord_order_lon_lat_is_respected(mk):
    lines, _ = parse_lines(mk({"coords": [f"{A[1]} {A[0]}; {B[1]} {B[0]}"]}), coord_order="lon_lat")
    assert_coords(lines[0], [list(A), list(B)], label="explicit lon_lat")


@pytest.mark.parametrize("mk", FRAMES)
def test_coord_order_auto_detects_longitude_beyond_90(mk):
    """Values past +/-90 cannot be latitude, so 'auto' must place them as longitude."""
    lines, _ = parse_lines(mk({"coords": ["-118.24 34.05; -122.41 37.77"]}))
    assert_coords(lines[0], [[34.05, -118.24], [37.77, -122.41]], label="auto order")
