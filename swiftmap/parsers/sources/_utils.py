import re
from typing import Optional, List, Any

FLOAT_REGEX = re.compile(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?')

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
    val_upper = val.strip().upper()
    if val_upper.startswith("LINESTRING") or val_upper.startswith("MULTILINESTRING"):
        nums = [float(n) for n in FLOAT_REGEX.findall(val)]
        coords = []
        for i in range(0, len(nums) - 1, 2):
            lon, lat = nums[i], nums[i+1]
            coords.append([lat, lon])
        return coords

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
    val_upper = val.strip().upper()
    if val_upper.startswith("POLYGON") or val_upper.startswith("MULTIPOLYGON"):
        nums = [float(n) for n in FLOAT_REGEX.findall(val)]
        coords = []
        for i in range(0, len(nums) - 1, 2):
            lon, lat = nums[i], nums[i+1]
            coords.append([lat, lon])
        return _ensure_closed_ring(coords)

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
