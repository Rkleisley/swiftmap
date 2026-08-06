"""
Coordinate axis-order detection.

The order is a property of a dataset, not of a point. Latitude is bounded to +/-90 and
longitude is not, so only a pair whose first value exceeds 90 proves lon-first ordering --
and most real coordinates never provide that proof. Detecting per point therefore
transposed exactly the points carrying the evidence and left the rest alone, which put a
handful of features on the wrong side of the planet inside an otherwise correct layer.

The fixtures below are deliberately transcontinental: west-coast longitudes (-118, -122)
are decisive, east-coast ones (-80, -74) are not, so anything deciding per point splits
them. Every test asserts that both halves agree.
"""
import pytest

import numpy as np

from swiftmap.parsers import parse_lines, parse_points, parse_polygons
from swiftmap.parsers.sources._utils import detect_coord_order, apply_coord_order

LA, SF = [-118.24, 34.05], [-122.41, 37.77]      # |lon| > 90 -- proves lon-first
MIA, NYC = [-80.19, 25.76], [-74.00, 40.71]      # |lon| < 90 -- ambiguous alone

LA_LATLON, SF_LATLON = [34.05, -118.24], [37.77, -122.41]
MIA_LATLON, NYC_LATLON = [25.76, -80.19], [40.71, -74.00]


# --- the detector itself ------------------------------------------------------------
@pytest.mark.parametrize("pairs,expected", [
    pytest.param([LA, SF], "lon_lat", id="all-decisive"),
    pytest.param([LA, MIA], "lon_lat", id="one-decisive-pair-decides-the-set"),
    pytest.param([MIA, NYC], "lat_lon", id="no-evidence-defaults-to-lat-first"),
    pytest.param([MIA, NYC, LA], "lon_lat", id="evidence-found-late-still-counts"),
    pytest.param([], "lat_lon", id="empty"),
])
def test_detection_is_a_single_decision_for_the_whole_set(pairs, expected):
    assert detect_coord_order(pairs) == expected


@pytest.mark.parametrize("explicit", ["lat_lon", "lon_lat"])
def test_explicit_order_skips_detection_entirely(explicit):
    """An explicit order is the caller's assertion about their data, and outranks evidence."""
    assert detect_coord_order([LA, SF], explicit) == explicit


def test_detection_stops_at_the_first_decisive_pair():
    """Scanning is lazy, so the common case does not walk a large dataset."""
    def pairs():
        yield MIA
        yield LA
        raise AssertionError("scanned past the decisive pair")

    assert detect_coord_order(pairs()) == "lon_lat"


def test_apply_is_uniform_across_every_pair():
    assert apply_coord_order([LA, MIA], "lon_lat") == [LA_LATLON, MIA_LATLON]
    assert apply_coord_order([LA, MIA], "lat_lon") == [LA, MIA]


# --- through the parsers ------------------------------------------------------------
def test_one_line_does_not_flip_partway_through():
    lines, _ = parse_lines([LA, MIA])
    assert lines[0] == [LA_LATLON, MIA_LATLON], "both points take the order the set implies"


def test_order_carries_across_separate_lines():
    """The evidence sits only in the first line; the second must not fall back to lat-first."""
    lines, _ = parse_lines([[LA, SF], [MIA, NYC]])
    assert lines == [[LA_LATLON, SF_LATLON], [MIA_LATLON, NYC_LATLON]]


def test_order_carries_across_separate_rings():
    polygons, _ = parse_polygons([[LA, SF, MIA], [MIA, NYC, [-71.06, 42.36]]])
    assert polygons[0][:3] == [LA_LATLON, SF_LATLON, MIA_LATLON]
    assert polygons[1][:3] == [MIA_LATLON, NYC_LATLON, [42.36, -71.06]]


def test_single_ring_does_not_flip_partway_through():
    polygons, _ = parse_polygons([LA, MIA, [-95.37, 29.76]])
    assert polygons[0][:3] == [LA_LATLON, MIA_LATLON, [29.76, -95.37]]


@pytest.mark.parametrize("explicit,expected", [
    ("lat_lon", [LA, MIA]),
    ("lon_lat", [LA_LATLON, MIA_LATLON]),
])
def test_explicit_order_survives_the_parsers(explicit, expected):
    assert parse_lines([LA, MIA], coord_order=explicit)[0][0] == expected


def test_genuine_lat_lon_data_is_left_alone():
    """Nothing in a well-formed lat-first dataset looks like evidence, so nothing moves."""
    lines, _ = parse_lines([LA_LATLON, MIA_LATLON])
    assert lines[0] == [LA_LATLON, MIA_LATLON]


def test_numpy_input_detects_the_same_way():
    lines, _ = parse_lines(np.array([LA, MIA]))
    assert lines[0] == [LA_LATLON, MIA_LATLON]


# --- tabular sources ----------------------------------------------------------------
@pytest.fixture(params=["pandas", "polars"])
def frame(request):
    """A coordinate-string column whose decisive row and ambiguous row are separate rows."""
    lib = pytest.importorskip(request.param)
    data = {"coordinates": ["-118.24, 34.05; -122.41, 37.77",
                            "-80.19, 25.76; -74.00, 40.71"]}
    return lib.DataFrame(data)


def test_coordinate_column_detects_across_rows(frame):
    """
    Row 2 holds no evidence of its own. Deciding per row would leave it lat-first while
    row 1 flipped, so a two-city route would render as one city and one point at sea.
    """
    lines, _ = parse_lines(frame)
    assert lines == [[LA_LATLON, SF_LATLON], [MIA_LATLON, NYC_LATLON]]


def test_list_valued_coordinate_column_detects_across_rows():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame({"coordinates": [[LA, SF], [MIA, NYC]]})
    lines, _ = parse_lines(df)
    assert lines == [[LA_LATLON, SF_LATLON], [MIA_LATLON, NYC_LATLON]]


def test_wkt_rows_are_exempt_from_detection():
    """
    WKT states its own axis order -- always lon first -- so its coordinates are already
    resolved and must not be fed to the detector, whatever the rest of the column holds.
    """
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame({"geometry": ["LINESTRING (-80.19 25.76, -74.00 40.71)",
                                    "LINESTRING (-118.24 34.05, -122.41 37.77)"]})
    lines, _ = parse_lines(df)
    assert lines == [[MIA_LATLON, NYC_LATLON], [LA_LATLON, SF_LATLON]]


def test_wkt_polygon_rows_are_exempt_from_detection():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame({"geometry": [
        "POLYGON ((-80.19 25.76, -74.00 40.71, -71.06 42.36, -80.19 25.76))"]})
    polygons, _ = parse_polygons(df)
    assert polygons[0][:3] == [MIA_LATLON, NYC_LATLON, [42.36, -71.06]]


# --- points -------------------------------------------------------------------------
def as_pairs(result):
    lats, lons, _ = result
    return [[lat, lon] for lat, lon in zip(lats, lons)]


def test_points_detect_order_like_every_other_geometry():
    """Points had no detection at all, so lon-first input yielded latitudes past ±90."""
    assert as_pairs(parse_points([LA, MIA])) == [LA_LATLON, MIA_LATLON]


def test_points_and_lines_agree_on_identical_input():
    """
    The same coordinates through two entrypoints must land in the same place. They did
    not: add_line put this route in California while add_markers put it off the globe.
    """
    assert as_pairs(parse_points([LA, SF, MIA])) == parse_lines([LA, SF, MIA])[0][0]


def test_points_never_flip_partway_through():
    """MIA carries no evidence of its own and must follow the decision LA forces."""
    pairs = as_pairs(parse_points([LA, MIA, NYC]))
    assert pairs == [LA_LATLON, MIA_LATLON, NYC_LATLON]


def test_genuine_lat_lon_points_are_left_alone():
    assert as_pairs(parse_points([LA_LATLON, MIA_LATLON])) == [LA_LATLON, MIA_LATLON]


def test_every_parsed_latitude_stays_on_the_globe():
    """The symptom that makes this a bug and not a preference."""
    lats, _, _ = parse_points([LA, SF, MIA, NYC])
    assert all(abs(lat) <= 90 for lat in lats)


@pytest.mark.parametrize("explicit,expected", [
    ("lat_lon", [LA, MIA]),
    ("lon_lat", [LA_LATLON, MIA_LATLON]),
])
def test_explicit_order_survives_the_point_parser(explicit, expected):
    assert as_pairs(parse_points([LA, MIA], coord_order=explicit)) == expected


def test_a_single_bare_pair_still_detects():
    """One pair is the whole dataset, so its own evidence is all there is to go on."""
    assert as_pairs(parse_points(LA)) == [LA_LATLON]
    assert as_pairs(parse_points([LA])) == [LA_LATLON]


def test_numpy_point_input_detects_the_same_way():
    """Arrays take a vectorised scan; it must reach the same verdict as the iterator."""
    assert as_pairs(parse_points(np.array([LA, MIA]))) == [LA_LATLON, MIA_LATLON]
    assert as_pairs(parse_points(np.array([LA_LATLON, MIA_LATLON]))) == [LA_LATLON, MIA_LATLON]


@pytest.mark.parametrize("pairs,expected", [
    pytest.param([LA, MIA], "lon_lat", id="decisive"),
    pytest.param([MIA, NYC], "lat_lon", id="ambiguous"),
    pytest.param([], "lat_lon", id="empty"),
])
def test_array_and_iterator_detection_agree(pairs, expected):
    arr = np.array(pairs, dtype=np.float64).reshape(-1, 2)
    assert detect_coord_order(arr) == detect_coord_order(pairs) == expected


def test_sources_that_state_their_own_order_ignore_the_parameter():
    """
    Named lat/lon columns mean what they say. coord_order exists for raw coordinate
    lists, the one point source that states nothing, and must not override a column name.
    """
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame({"lat": [34.05], "lon": [-118.24]})
    assert as_pairs(parse_points(df, coord_order="lon_lat")) == [LA_LATLON]


def test_point_layer_methods_accept_coord_order():
    """Without a real parameter this would fall into **kwargs and ship to JS as metadata."""
    import swiftmap
    m = swiftmap.Map().add_circle_markers([LA, MIA], coord_order="lon_lat")
    assert m.layers[-1]["bounds"] == [[MIA_LATLON[0], LA_LATLON[1]],
                                      [LA_LATLON[0], MIA_LATLON[1]]]
    assert "coord_order" not in m.layers[-1], "consumed by the parser, not sent to the client"


# --- array fast path ----------------------------------------------------------------
# Arrays skip the per-row Python scan on both detection and reordering. The results must
# be indistinguishable from the list path; only the cost differs.
from swiftmap.parsers.sources._utils import as_pair_block, detect_coord_order_multi  # noqa: E402


@pytest.mark.parametrize("pairs", [
    pytest.param([LA, SF], id="decisive"),
    pytest.param([MIA, NYC], id="ambiguous"),
    pytest.param([MIA, NYC, LA], id="evidence-last"),
])
@pytest.mark.parametrize("parse,index", [
    pytest.param(parse_lines, lambda r: r[0][0], id="lines"),
    pytest.param(parse_polygons, lambda r: r[0][0][:3], id="polygons"),
])
def test_array_input_parses_identically_to_list_input(pairs, parse, index):
    pairs = pairs + [[-95.37, 29.76]]  # third vertex, so polygons have a valid ring
    assert index(parse(np.array(pairs))) == index(parse(pairs))


def test_array_and_list_agree_across_several_geometries():
    """Chunk-wise detection must reach the same verdict as scanning the concatenation."""
    subs = [[LA, SF], [MIA, NYC]]
    assert parse_lines([np.array(s) for s in subs])[0] == parse_lines(subs)[0]


@pytest.mark.parametrize("chunks,expected", [
    pytest.param([[MIA, NYC], [LA, SF]], "lon_lat", id="evidence-in-a-later-chunk"),
    pytest.param([[MIA, NYC], [NYC, MIA]], "lat_lon", id="no-evidence-anywhere"),
    pytest.param([], "lat_lon", id="no-chunks"),
])
def test_multi_chunk_detection_matches_the_flat_scan(chunks, expected):
    flat = [pt for chunk in chunks for pt in chunk]
    assert detect_coord_order_multi(chunks) == detect_coord_order(flat) == expected
    assert detect_coord_order_multi([np.array(c) for c in chunks]) == expected


def test_multi_chunk_detection_honours_an_explicit_order():
    assert detect_coord_order_multi([[LA, SF]], "lat_lon") == "lat_lon"


def test_clean_arrays_pass_through_and_everything_else_is_filtered():
    arr = np.array([LA, MIA])
    assert as_pair_block(arr) is arr, "a 2-D array has no short rows to filter"
    assert as_pair_block([LA, [1.0], MIA]) == [LA, MIA], "short rows are dropped"
    assert as_pair_block(np.array([[1.0], [2.0]])) == [], "an (n, 1) array holds no pairs"


def test_extra_columns_are_ignored_on_both_paths():
    """A third column (elevation, timestamp) must not shift which values are read."""
    with_elev = [LA + [120.0], MIA + [3.0]]
    assert parse_lines(np.array(with_elev))[0][0] == parse_lines(with_elev)[0][0] \
        == [LA_LATLON, MIA_LATLON]
