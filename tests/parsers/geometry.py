"""
Canonical geometry used across every parser test.

Defined once, in swiftmap's own output convention ([lat, lon]), then expressed in each
source's input format by the builders below. Any parser that transposes lat/lon, drops a
vertex, or fails to close a ring diverges from these constants and fails loudly.
"""
import pytest

# Coordinate tolerance. Roughly 1.1 metres at the equator -- far tighter than any real
# use needs, loose enough that geodesic shapes (GeoCircle, GeoBox) do not fail on the
# eleventh decimal place.
TOL = 1e-5

# --- canonical geometry, always (lat, lon) ---------------------------------------
A = (36.00, -5.30)
B = (36.10, -5.20)
C = (36.05, -5.10)

LINE = [list(A), list(B), list(C)]              # open 3-vertex path
RING = [list(A), list(C), list(B), list(A)]     # closed triangle
RING_OPEN = [list(A), list(C), list(B)]         # same ring, last vertex omitted

SECOND_LINE = [[35.90, -5.40], [35.95, -5.35]]
SECOND_RING = [[35.90, -5.40], [35.95, -5.35], [35.92, -5.30], [35.90, -5.40]]


# --- WKT builders (WKT is lon-first, which is the point of testing it) ------------
def wkt_point(pt):
    return f"POINT ({pt[1]} {pt[0]})"


def wkt_multipoint(pts):
    return "MULTIPOINT (" + ", ".join(f"{p[1]} {p[0]}" for p in pts) + ")"


def wkt_line(pts):
    return "LINESTRING (" + ", ".join(f"{p[1]} {p[0]}" for p in pts) + ")"


def wkt_multiline(parts):
    return "MULTILINESTRING (" + ", ".join(
        "(" + ", ".join(f"{p[1]} {p[0]}" for p in part) + ")" for part in parts) + ")"


def wkt_multipolygon(rings):
    """One hole-free part per ring."""
    return "MULTIPOLYGON (" + ", ".join(
        "((" + ", ".join(f"{p[1]} {p[0]}" for p in ring) + "))" for ring in rings) + ")"


def wkt_polygon(ring):
    return "POLYGON ((" + ", ".join(f"{p[1]} {p[0]}" for p in ring) + "))"


# --- GeoJSON builders (also lon-first) -------------------------------------------
def gj_feature(geom_type, coords, props=None):
    return {"type": "Feature",
            "geometry": {"type": geom_type, "coordinates": coords},
            "properties": props or {}}


def gj_collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def lonlat(pts):
    """Flips canonical (lat, lon) pairs into the lon-first order GeoJSON/WKT use."""
    return [[p[1], p[0]] for p in pts]


# --- assertion helpers ------------------------------------------------------------
def assert_coords(actual, expected, tol=TOL, label="coords"):
    """Compares [[lat, lon], ...] sequences with a stated tolerance."""
    assert len(actual) == len(expected), (
        f"{label}: expected {len(expected)} coordinate(s), got {len(actual)}\n"
        f"  actual:   {actual}\n  expected: {expected}"
    )
    for i, (got, want) in enumerate(zip(actual, expected)):
        assert got[0] == pytest.approx(want[0], abs=tol), (
            f"{label}[{i}] latitude: got {got[0]}, expected {want[0]}"
        )
        assert got[1] == pytest.approx(want[1], abs=tol), (
            f"{label}[{i}] longitude: got {got[1]}, expected {want[1]}"
        )


def assert_points(lats, lons, expected, tol=TOL):
    """Compares parse_points output arrays against canonical (lat, lon) pairs."""
    assert len(lats) == len(expected), (
        f"expected {len(expected)} point(s), got {len(lats)}\n"
        f"  actual: {list(zip(list(lats), list(lons)))}\n  expected: {expected}"
    )
    for i, want in enumerate(expected):
        assert lats[i] == pytest.approx(want[0], abs=tol), (
            f"point[{i}] latitude: got {lats[i]}, expected {want[0]} "
            f"(a lat/lon transposition would show here)"
        )
        assert lons[i] == pytest.approx(want[1], abs=tol), (
            f"point[{i}] longitude: got {lons[i]}, expected {want[1]}"
        )


def assert_same_ring(actual, expected, label="ring"):
    """
    The same closed ring regardless of start vertex or winding direction.

    Some sources normalise winding (geostructures enforces the right-hand rule and
    reverses a clockwise ring), which is their prerogative: the geometry is identical,
    only the traversal differs, so an exact-order comparison would fail for no fault.
    """
    assert_closed(actual)
    a = [tuple(round(v, 6) for v in p) for p in actual[:-1]]
    e = [tuple(round(v, 6) for v in p) for p in expected[:-1]]
    assert len(a) == len(e), f"{label}: {len(a)} vertices, expected {len(e)}"
    cycles = [e[i:] + e[:i] for i in range(len(e))]
    cycles += [list(reversed(c)) for c in cycles]
    assert a in cycles, f"{label}: {actual} is not the ring {expected} in any winding"


def assert_closed(ring, tol=TOL):
    """A polygon ring must return to its starting vertex."""
    assert len(ring) >= 4, f"a closed ring needs >= 4 vertices, got {len(ring)}: {ring}"
    assert ring[0][0] == pytest.approx(ring[-1][0], abs=tol), f"ring not closed (lat): {ring}"
    assert ring[0][1] == pytest.approx(ring[-1][1], abs=tol), f"ring not closed (lon): {ring}"
