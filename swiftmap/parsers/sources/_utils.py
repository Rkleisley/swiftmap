import re
from typing import Optional, List, Any

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

def _parse_coord_string(val: str, coord_order: str = "auto") -> List[List[float]]:
    if not val or not isinstance(val, str):
        return []
    kind = wkt_kind(val)
    if kind == "line":
        return _wkt_coord_pairs(val)
    if kind is not None:
        # Recognisable WKT of another kind. Falling through would extract its numbers as
        # a line, which is how a POLYGON column used to render as a phantom polyline.
        return []

    nums = [float(n) for n in FLOAT_REGEX.findall(val)]
    if len(nums) < 4:
        return []
    pairs = []
    for i in range(0, len(nums) - 1, 2):
        n1, n2 = nums[i], nums[i+1]
        if coord_order == "lon_lat":
            pairs.append([n2, n1])
        elif coord_order == "lat_lon":
            pairs.append([n1, n2])
        else:
            if abs(n1) > 90 and abs(n2) <= 90:
                pairs.append([n2, n1])
            else:
                pairs.append([n1, n2])
    return pairs

def _parse_polygon_wkt_string(val: str, coord_order: str = "auto") -> List[List[float]]:
    if not val or not isinstance(val, str):
        return []
    kind = wkt_kind(val)
    if kind == "polygon":
        return _ensure_closed_ring(_wkt_coord_pairs(val))
    if kind is not None:
        return []

    nums = [float(n) for n in FLOAT_REGEX.findall(val)]
    if len(nums) < 6:
        return []
    coords = []
    for i in range(0, len(nums) - 1, 2):
        n1, n2 = nums[i], nums[i+1]
        if coord_order == "lon_lat":
            coords.append([n2, n1])
        elif coord_order == "lat_lon":
            coords.append([n1, n2])
        else:
            if abs(n1) > 90 and abs(n2) <= 90:
                coords.append([n2, n1])
            else:
                coords.append([n1, n2])
    return _ensure_closed_ring(coords)
