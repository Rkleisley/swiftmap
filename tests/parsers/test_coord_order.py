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

from swiftmap.parsers import parse_lines, parse_polygons
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
