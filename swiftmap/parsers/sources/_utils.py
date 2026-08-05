import re
from typing import Optional, List, Any, Iterable, Sequence, Tuple

FLOAT_REGEX = re.compile(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?')

_WKT_PREFIX = re.compile(r'^\s*(MULTI)?(POINT|LINESTRING|POLYGON)\b', re.IGNORECASE)
_WKT_KINDS = {"POINT": "point", "LINESTRING": "line", "POLYGON": "polygon"}


def wkt_kind(val: Any) -> Optional[str]:
    """
    Returns 'point', 'line' or 'polygon' for a WKT string, or None if it is not WKT.

    Used to keep each geometry parser to its own kind. Plain delimited coordinate strings
    ("-118.24, 34.05; -122.41, 37.77") are not WKT and return None, so they still reach the
    permissive number-extraction path the parsers rely on.
    """
    if not isinstance(val, str):
        return None
    match = _WKT_PREFIX.match(val)
    return _WKT_KINDS[match.group(2).upper()] if match else None


def _wkt_coord_pairs(val: str) -> List[List[float]]:
    """Pulls [lat, lon] pairs out of a WKT body, which is always lon-first."""
    nums = [float(n) for n in FLOAT_REGEX.findall(val)]
    return [[nums[i + 1], nums[i]] for i in range(0, len(nums) - 1, 2)]


def _parse_point_wkt_string(val: Any) -> List[List[float]]:
    """Returns [[lat, lon], ...] for a POINT or MULTIPOINT string, else []."""
    return _wkt_coord_pairs(val) if wkt_kind(val) == "point" else []

def find_column_or_key(keys: List[str], candidates: List[str]) -> Optional[str]:
    """Finds the first key in keys that matches any of the candidates case-insensitively."""
    for c in candidates:
        for k in keys:
            if k.lower() == c.lower():
                return k
    return None

def _ensure_closed_ring(ring: List[List[float]]) -> List[List[float]]:
    """Ensures a polygon coordinate ring is closed (first and last vertex match)."""
    if not ring or len(ring) < 3:
        return ring
    first, last = ring[0], ring[-1]
    if abs(first[0] - last[0]) > 1e-7 or abs(first[1] - last[1]) > 1e-7:
        ring.append([first[0], first[1]])
    return ring

def detect_coord_order(pairs: Iterable[Sequence[float]], coord_order: str = "auto") -> str:
    """
    Resolves `coord_order` to 'lat_lon' or 'lon_lat' once, for a whole set of coordinates.

    Decide this per dataset, never per point. Latitude is bounded to +/-90 and longitude is
    not, so a pair whose first value exceeds 90 while its second does not can only be
    lon-first. But that evidence is missing from every pair that happens to sit inside +/-90
    in both slots, and most real coordinates do. Testing each point on its own therefore
    transposes exactly the points carrying the evidence and leaves their neighbours alone --
    a mostly-correct layer with a handful of features thrown across the map, which reads as
    bad data rather than as a parsing bug.

    Scanning stops at the first decisive pair, so the usual case costs one comparison. With
    no evidence either way the data is taken as lat-first, matching the documented default.
    """
    if coord_order in ("lat_lon", "lon_lat"):
        return coord_order
    for pair in pairs:
        if abs(pair[0]) > 90 and abs(pair[1]) <= 90:
            return "lon_lat"
    return "lat_lon"


def apply_coord_order(pairs: Iterable[Sequence[float]], order: str) -> List[List[float]]:
    """Emits [lat, lon] for every pair, under an order already resolved for the dataset."""
    if order == "lon_lat":
        return [[float(p[1]), float(p[0])] for p in pairs]
    return [[float(p[0]), float(p[1])] for p in pairs]


def coord_string_parts(val: Any, kind_wanted: str, min_nums: int) -> Tuple[Optional[List[List[float]]], Optional[List[Sequence[float]]]]:
    """
    Splits one coordinate-column value into (resolved, pairs); exactly one is not None.

    `resolved` is finished [lat, lon] output, used when the value is WKT: WKT declares its
    own axis order -- always lon first -- so it neither needs detection nor may be subjected
    to it. `pairs` is the raw number pairs of an ambiguous delimited string, handed back
    untouched so the caller can resolve the order across every row at once instead of
    row by row.
    """
    if not val or not isinstance(val, str):
        return [], None
    kind = wkt_kind(val)
    if kind == kind_wanted:
        return _wkt_coord_pairs(val), None
    if kind is not None:
        # Recognisable WKT of another kind. Falling through would extract its numbers as
        # this kind, which is how a POLYGON column used to render as a phantom polyline.
        return [], None

    nums = [float(n) for n in FLOAT_REGEX.findall(val)]
    if len(nums) < min_nums:
        return [], None
    return None, [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]


def _parse_coord_string(val: str, coord_order: str = "auto") -> List[List[float]]:
    resolved, pairs = coord_string_parts(val, "line", 4)
    if pairs is None:
        return resolved
    return apply_coord_order(pairs, detect_coord_order(pairs, coord_order))


def _parse_polygon_wkt_string(val: str, coord_order: str = "auto") -> List[List[float]]:
    resolved, pairs = coord_string_parts(val, "polygon", 6)
    if pairs is None:
        return _ensure_closed_ring(resolved)
    return _ensure_closed_ring(apply_coord_order(pairs, detect_coord_order(pairs, coord_order)))
