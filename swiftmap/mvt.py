"""
read_mvt: vector tiles in, an ordinary table out. The bridge, not a renderer.

A tile server's data becomes swiftmap's kind of data here -- fetched once
for a stated view, decoded, and handed back as rows whose `geometry` column
is WKT: the front door the parsers already read. Painting it is
`add_polygon(df[df.mvt_layer == "buildings"], color_col=...)` with
everything add_* already does. What this deliberately is NOT is live
viewport fetching -- that renderer gets built if real use of this bridge
ever shows it must be.
"""
import itertools
import math
import urllib.request
from typing import Any, Dict, List, Optional

from ._mvt import decode_mvt

# A screenful at sane zooms is a few dozen tiles; hundreds means the zoom or
# the bounds is a mistake, and a silent multi-thousand-request fetch is not a
# favour. Raise -- this is a pure function with nothing on a map to lose.
MAX_TILES = 128


def _tile_range(bounds, zoom: int):
    (lat_min, lon_min), (lat_max, lon_max) = bounds
    lat_min, lat_max = sorted((float(lat_min), float(lat_max)))
    lon_min, lon_max = sorted((float(lon_min), float(lon_max)))
    n = 2 ** zoom

    def tile_x(lon):
        return min(n - 1, max(0, int((lon + 180.0) / 360.0 * n)))

    def tile_y(lat):
        lat = max(-85.0511287798, min(85.0511287798, lat))
        rad = math.radians(lat)
        return min(n - 1, max(0, int(
            (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi)
            / 2.0 * n)))

    xs = range(tile_x(lon_min), tile_x(lon_max) + 1)
    ys = range(tile_y(lat_max), tile_y(lat_min) + 1)   # north is the smaller y
    return xs, ys


def _fetch(url: str, headers: Optional[Dict[str, str]]) -> Optional[bytes]:
    """One tile's bytes, or None for the empty-tile responses sparse
    tilesets legitimately return (404/204; a missing local file likewise)."""
    if "://" not in url:
        try:
            with open(url, "rb") as fh:
                return fh.read()
        except FileNotFoundError:
            return None
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status == 204:
                return None
            return response.read()
    except urllib.error.HTTPError as exc:
        if exc.code in (204, 404, 410):
            return None
        raise


def read_mvt(url: str, bounds, zoom: int,
             layers: Optional[List[str]] = None,
             headers: Optional[Dict[str, str]] = None):
    """
    Reads the vector tiles covering `bounds` at `zoom` into a table.

    Zero dependencies: the decoder is swiftmap's own (pinned to the reference
    library by the parity suite) and fetching is the standard library, so a
    closed network's local tile directory works exactly like a live server.

    Parameters
    ----------
    url : str
        An XYZ template with {z}, {x}, {y} placeholders -- an http(s) URL or
        a local path ("tiles/{z}/{x}/{y}.pbf"). {-y} in place of {y} flips
        the row for TMS tile schemes; an optional {s} rotates through a, b, c.
    bounds : [[lat_min, lon_min], [lat_max, lon_max]]
        The area to read, the shape bounds_of returns.
    zoom : int
        The tile zoom to fetch (which also sets the geometry's detail --
        tiles are pre-simplified per zoom by whoever built them).
    layers : list of str, optional
        Tile layer names to keep; everything, when omitted.
    headers : dict, optional
        Extra HTTP headers (an API token's home).

    Returns
    -------
    A pandas DataFrame when pandas is installed, else a dict of columns:
    `geometry` (WKT, lon/lat), `mvt_layer`, and every feature property.
    Features are clipped per tile by the tileset itself, so a shape spanning
    tiles arrives as its clipped parts.
    """
    if isinstance(zoom, bool) or not isinstance(zoom, int) or not 0 <= zoom <= 24:
        raise ValueError(f"read_mvt zoom must be an integer from 0 to 24, "
                         f"got {zoom!r}.")
    if "{z}" not in url or "{x}" not in url or (
            "{y}" not in url and "{-y}" not in url):
        raise ValueError("read_mvt url must be an XYZ template containing "
                         "{z}, {x} and {y} (or {-y} for TMS tile schemes).")
    xs, ys = _tile_range(bounds, zoom)
    count = len(xs) * len(ys)
    if count > MAX_TILES:
        raise ValueError(
            f"read_mvt: these bounds at zoom {zoom} cover {count} tiles "
            f"(cap {MAX_TILES}). Lower the zoom or shrink the bounds.")

    subdomains = itertools.cycle("abc")
    rows: List[Dict[str, Any]] = []
    for x in xs:
        for y in ys:
            # {-y} is the TMS convention: same tiles, y counted from the south.
            tile_url = (url.replace("{z}", str(zoom)).replace("{x}", str(x))
                           .replace("{-y}", str(2 ** zoom - 1 - y))
                           .replace("{y}", str(y))
                           .replace("{s}", next(subdomains)))
            data = _fetch(tile_url, headers)
            if data:
                rows.extend(decode_mvt(data, zoom, x, y, layers))

    columns = list(dict.fromkeys(k for row in rows for k in row))
    table = {c: [row.get(c) for row in rows] for c in columns} if rows \
        else {"geometry": [], "mvt_layer": []}
    try:
        import pandas as pd
        return pd.DataFrame(table)
    except ImportError:
        return table
