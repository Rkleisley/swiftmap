import re
import warnings
import numpy as np
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


class PolygonGeom:
    """
    A polygon with holes and/or multiple parts: parts -> rings -> [lat, lon] pairs,
    every ring closed, ring 0 of a part the outer boundary and the rest its holes.

    A plain list of pairs remains the representation of the common hole-free
    single-ring polygon, so nothing on that path changes; this exists only where
    there is structure to carry. Downstream it flattens into the one coordinate
    buffer a layer already ships, with the ring lengths as a small `rings` table in
    the layer config for the renderer to slice by.
    """
    __slots__ = ("parts",)

    def __init__(self, parts: List[List[List[List[float]]]]):
        self.parts = parts

    def __len__(self) -> int:
        return sum(len(ring) for part in self.parts for ring in part)

    def flat(self) -> List[List[float]]:
        return [pair for part in self.parts for ring in part for pair in ring]

    def ring_lengths(self) -> List[List[int]]:
        return [[len(ring) for ring in part] for part in self.parts]


class LineGeom:
    """
    A multi-part line: parts -> [lat, lon] pairs, each part drawn on its own.

    The line-side twin of PolygonGeom. A plain list of pairs remains the
    representation of the common single-part line, so nothing on that path
    changes; this exists only where there are parts to keep apart. Downstream it
    flattens into the one coordinate buffer a layer already ships, with the part
    lengths as a small `parts` table in the layer config for the renderer to slice
    by -- so no segment is ever drawn from one part's last vertex to the next
    part's first.
    """
    __slots__ = ("parts",)

    def __init__(self, parts: List[List[List[float]]]):
        self.parts = parts

    def __len__(self) -> int:
        return sum(len(part) for part in self.parts)

    def flat(self) -> List[List[float]]:
        return [pair for part in self.parts for pair in part]

    def part_lengths(self) -> List[int]:
        return [len(part) for part in self.parts]


# Innermost paren groups are ring bodies (coordinates never contain parens), and a
# MULTIPOLYGON's parts are separated by a comma between DOUBLED parens -- rings within
# one part only ever meet at single parens -- so both structures fall to C-speed regex.
# The part split is pure lookaround: consuming the parens would orphan the ring bodies
# on either side of the cut. This used to be a character-by-character Python walk,
# which read every byte of WKT through the interpreter: 2.4s of a 6k-polygon ingest.
_RING_RE = re.compile(r"\(([^()]+)\)")
_PART_SPLIT_RE = re.compile(r"(?<=\)\))\s*,\s*(?=\(\()")


def _wkt_polygon_structure(val: str) -> List[List[List[List[float]]]]:
    """
    Parts -> rings -> [lat, lon] pairs for a POLYGON or MULTIPOLYGON body.

    Ring-aware rather than a flat number sweep: the sweep merged every ring and part
    into one garbled boundary, which was exactly the holes/multipolygon oversight.
    Malformed parens yield [], and the caller falls back to the permissive sweep.
    """
    match = _WKT_PREFIX.match(val)
    is_multi = match is not None and match.group(1) is not None

    def rings_of(text: str) -> List[List[List[float]]]:
        rings = []
        for body in _RING_RE.findall(text):
            nums = [float(n) for n in FLOAT_REGEX.findall(body)]
            ring = [[nums[i + 1], nums[i]] for i in range(0, len(nums) - 1, 2)]
            if len(ring) >= 3:
                rings.append(_ensure_closed_ring(ring))
        return rings

    if not is_multi:
        rings = rings_of(val)
        return [rings] if rings else []
    parts = [rings_of(chunk) for chunk in _PART_SPLIT_RE.split(val)]
    return [p for p in parts if p]


def _wkt_line_structure(val: str) -> List[List[List[float]]]:
    """
    Parts -> [lat, lon] pairs for a LINESTRING or MULTILINESTRING body.

    Each part is one innermost paren group. A flat number sweep merged the parts
    of a MULTILINESTRING into one vertex run, so the renderer drew a segment from
    one part's end to the next part's start that exists in no data -- the
    line-side twin of the polygon ring oversight. Parts shorter than two vertices
    are dropped; malformed parens yield [], and the caller falls back to the sweep.
    """
    parts = []
    for body in _RING_RE.findall(val):
        nums = [float(n) for n in FLOAT_REGEX.findall(body)]
        part = [[nums[i + 1], nums[i]] for i in range(0, len(nums) - 1, 2)]
        if len(part) >= 2:
            parts.append(part)
    return parts


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

    # Point layers reach this with the whole dataset as one (n, 2) array, and may hold
    # millions of rows. The early exit below is O(1) on decisive data but walks every row
    # when there is no evidence to find, which is the common case for data that really is
    # lat-first -- so arrays take a vectorised scan instead.
    if isinstance(pairs, np.ndarray):
        if pairs.ndim != 2 or pairs.shape[0] == 0:
            return "lat_lon"
        decisive = (np.abs(pairs[:, 0]) > 90) & (np.abs(pairs[:, 1]) <= 90)
        return "lon_lat" if decisive.any() else "lat_lon"

    for pair in pairs:
        if abs(pair[0]) > 90 and abs(pair[1]) <= 90:
            return "lon_lat"
    return "lat_lon"


def detect_coord_order_multi(chunks: Iterable[Any], coord_order: str = "auto") -> str:
    """
    Resolves the order across several coordinate sequences as though they were one.

    Equivalent to concatenating them first: a single decisive pair anywhere settles the
    whole dataset, so the first chunk answering 'lon_lat' ends the scan. Keeping the chunks
    apart lets each take whichever scan suits its type -- vectorised for arrays, early-exit
    for lists -- without building a combined copy just to look at it.
    """
    if coord_order in ("lat_lon", "lon_lat"):
        return coord_order
    for chunk in chunks:
        if detect_coord_order(chunk) == "lon_lat":
            return "lon_lat"
    return "lat_lon"


def apply_coord_order(pairs: Iterable[Sequence[float]], order: str) -> List[List[float]]:
    """
    Emits [lat, lon] for every pair, under an order already resolved for the dataset.

    Arrays are reordered as whole columns and converted in one step. Going through the
    comprehension instead costs roughly 3x as much on a large array, since it pays for a
    Python-level iteration and two float() calls on numpy scalars per row. The reverse is
    just as true: converting a genuine Python list to an array to use this path costs more
    than the comprehension it replaces, so lists stay on the comprehension.
    """
    if isinstance(pairs, np.ndarray) and pairs.ndim == 2 and pairs.shape[1] >= 2:
        cols = [1, 0] if order == "lon_lat" else [0, 1]
        return pairs[:, cols].tolist()
    if order == "lon_lat":
        return [[float(p[1]), float(p[0])] for p in pairs]
    return [[float(p[0]), float(p[1])] for p in pairs]


def as_pair_block(seq: Any) -> Any:
    """
    Keeps a coordinate sequence in array form when it already is one.

    Filtering short rows out with a comprehension turns an (n, 2) array into a list of n
    array scalars, which then forces both the detection scan and the reordering onto their
    slow paths. A clean 2-D array has no short rows to filter, so it passes straight
    through; anything else is filtered as before.
    """
    if isinstance(seq, np.ndarray) and seq.ndim == 2 and seq.shape[1] >= 2:
        return seq
    return [pt for pt in seq if len(pt) >= 2]


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
        if kind_wanted == "polygon":
            parts = _wkt_polygon_structure(val)
            if len(parts) == 1 and len(parts[0]) == 1:
                return parts[0][0], None      # the common hole-free ring, as before
            if parts:
                return PolygonGeom(parts), None
        elif kind_wanted == "line":
            parts = _wkt_line_structure(val)
            if len(parts) == 1:
                return parts[0], None         # the common single-part line, as before
            if parts:
                return LineGeom(parts), None
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


def _parse_polygon_wkt_string(val: str, coord_order: str = "auto") -> Any:
    resolved, pairs = coord_string_parts(val, "polygon", 6)
    if pairs is None:
        return resolved if isinstance(resolved, PolygonGeom) else _ensure_closed_ring(resolved)
    return _ensure_closed_ring(apply_coord_order(pairs, detect_coord_order(pairs, coord_order)))


# --- H3 cell ids -------------------------------------------------------------

_H3_STRING = re.compile(r'^[0-9a-fA-F]{15}$')
_h3_module: Any = False   # False = not probed yet; None = probed and unavailable


def h3_module():
    """The h3 package, imported on first use, or None when it is not installed."""
    global _h3_module
    if _h3_module is False:
        try:
            import h3
            _h3_module = h3
        except ImportError:
            _h3_module = None
    return _h3_module


def h3_cell_str(val: Any) -> Optional[str]:
    """
    The 15-hex-char string form of a possible H3 cell id, or None.

    Shape only, no validation -- this is the prefilter that works without the h3
    package. Integer ids share the string form exactly (the string id IS the hex
    of the 64-bit id), so both spellings normalise here.
    """
    if isinstance(val, str):
        return val if _H3_STRING.match(val) else None
    if isinstance(val, (int, np.integer)):
        text = format(int(val), "x")
        return text if _H3_STRING.match(text) else None
    return None


def is_h3_cell(val: Any) -> bool:
    """
    True when `val` is a valid H3 cell id, in either string or integer spelling.

    Validation is structural -- h3.is_valid_cell checks the id's bit layout, not
    just its shape -- so a hex-shaped string that is not a cell stays data.
    False when the h3 package is not installed.
    """
    text = h3_cell_str(val)
    h3 = h3_module()
    if text is None or h3 is None:
        return False
    try:
        return bool(h3.is_valid_cell(text.lower()))
    except (TypeError, ValueError):
        return False


def h3_cell_ring(val: Any) -> Optional[List[List[float]]]:
    """A cell's boundary as a closed [lat, lon] ring, or None for a non-cell."""
    text = h3_cell_str(val)
    h3 = h3_module()
    if text is None or h3 is None:
        return None
    try:
        boundary = h3.cell_to_boundary(text.lower())
    except (TypeError, ValueError):
        return None
    return _ensure_closed_ring([[float(lat), float(lon)] for lat, lon in boundary])


def warn_h3_missing(context: str) -> None:
    warnings.warn(
        f"[SwiftMap] {context} looks like H3 cell ids, but the h3 package is not "
        f"installed, so the cells cannot become polygons. pip install h3",
        stacklevel=4,
    )
