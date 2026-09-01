import re
import warnings
import numpy as np
from typing import Any, Dict, List, Optional, Tuple
from ._utils import (
    find_column_or_key,
    _parse_coord_string,
    _parse_polygon_wkt_string,
    _parse_point_wkt_string,
    _ensure_closed_ring,
    PolygonGeom,
    wkt_kind,
    coord_string_parts,
    detect_coord_order_multi,
    apply_coord_order,
    as_pair_block,
    h3_cell_str,
    h3_cell_ring,
    h3_cell_center,
    h3_module,
    is_h3_cell,
    warn_h3_missing,
)

# Multi-row grouping (tier 3 of lines/polygons parsing) is intentionally NOT
# shared here: pandas.py groups via per-group sub-frames, polars.py via
# native vectorized group_by/agg for speed. Only the tiers below it, which
# carry no performance-motivated divergence, are unified.

# Column-name guesses shared across every tabular source (pandas, polars, and
# the dict / list-of-dicts parsers in lists_dicts.py).
LAT_CANDIDATES = ['lat', 'latitude', 'y', 'lat_col']
LON_CANDIDATES = ['lon', 'longitude', 'x', 'lon_col', 'lng']
LINE_ID_CANDIDATES = ['line_id', 'track_id', 'flight_id', 'route_id', 'group', 'id', 'segment_id']
LINE_ORDER_CANDIDATES = ['order', 'step', 'timestamp', 'index', 'seq', 'sequence']
SHAPE_ID_CANDIDATES = ['shape_id', 'polygon_id', 'zone_id', 'group', 'id', 'name']
SHAPE_ORDER_CANDIDATES = ['order', 'step', 'vertex', 'index', 'seq', 'sequence']
LINE_COORD_COL_CANDIDATES = ['coords', 'coordinates', 'locations', 'path', 'wkt', 'geometry']
POLYGON_COORD_COL_CANDIDATES = ['coords', 'coordinates', 'locations', 'wkt', 'geometry', 'shape']
WKT_COL_CANDIDATES = ['wkt', 'geometry', 'geom', 'shape', 'coords', 'coordinates', 'locations']


def explicit_wkt_column(data: Any, id_col: Optional[str], kind: str) -> Optional[str]:
    """
    Returns id_col when the column it names actually holds WKT of `kind`, else None.

    `line_id_col` / `shape_id_col` normally name a grouping id, but they are also how a
    caller points at a WKT column the name-guess would miss ("boundary", "zone_wkt"):
    a WKT value is unambiguous -- no real id column holds "POLYGON ((..." -- so when the
    named column's values are WKT it is the geometry source, one shape per row, and
    grouping does not apply.
    """
    if not id_col:
        return None
    for checked, row in enumerate(iter_row_dicts(data)):
        if checked >= 10:
            break
        found = wkt_kind(row.get(id_col))
        if found is not None:
            return id_col if found == kind else None
    return None


def find_wkt_column(data: Any) -> Optional[str]:
    """
    Returns the name of a column holding WKT strings, or None.

    A likely column name is not enough -- 'coords' may hold plain delimited pairs -- so the
    first few non-null values are checked for an actual WKT prefix.
    """
    try:
        cols = list(data.columns)
    except AttributeError:
        return None

    column = find_column_or_key(cols, WKT_COL_CANDIDATES)
    if not column:
        return None

    for checked, row in enumerate(iter_row_dicts(data)):
        if checked >= 10:
            break
        if wkt_kind(row[column]):
            return column
    return None


H3_COL_CANDIDATES = ['h3', 'h3_cell', 'h3_index', 'h3_id', 'hex_id', 'hex', 'cell_id', 'cell', 'hexagon']

GEOHASH_COL_CANDIDATES = ['geohash', 'niemeyer', 'gh']


def parse_tabular_polygons_by_geohash_column(
    data: Any, cols: List[str],
    geohash_col: Optional[str] = None, geohash_base: Optional[int] = None,
) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """
    Tier 1a: a column of Niemeyer geohashes, one rectangle per row. None if
    not applicable.

    The same string is a valid hash in every base whose alphabet contains its
    characters -- decoding to a DIFFERENT rectangle in each -- so unlike WKT
    and H3 there is no value-verification that could make guessing safe: this
    tier only fires when `geohash_base` states the base, mirroring
    geostructures' NiemeyerHasher, which has no default either. Without the
    base, a candidate-named column earns a hint, not a guess. The hash column
    survives into the properties, like H3's cell ids: it is the join key.
    """
    from ..._niemeyer import BASES, cell_ring, valid_geohash

    if geohash_base is None:
        if geohash_col is not None:
            # The one pointer serves both hash formats. An H3 cell id
            # validates structurally -- the value states what it is -- so an
            # H3 column needs no base and routes to the H3 tier; only a
            # Niemeyer hash, which cannot state its own base, requires one.
            verdict = (_h3_column_verdict(data, geohash_col)
                       if geohash_col in cols else "no")
            if verdict == "h3":
                # Delegated directly, not deferred: an explicit pointer must
                # beat every later tier (a WKT column elsewhere in the table
                # would otherwise win the fall-through).
                return parse_tabular_polygons_by_h3_column(
                    data, cols, hash_col=geohash_col)
            if verdict == "missing":
                warn_h3_missing(f"Column {geohash_col!r}")
                return None
            warnings.warn(
                f"[SwiftMap] geohash_col={geohash_col!r} was given without "
                f"geohash_base, and its values are not H3 cell ids (which "
                f"need no base). A Niemeyer hash cannot state its own base -- "
                f"pass geohash_base=16, 32 or 64. The column was left as data.",
                stacklevel=4,
            )
            return None
        hinted = find_column_or_key(cols, GEOHASH_COL_CANDIDATES)
        has_latlon = (find_column_or_key(cols, LAT_CANDIDATES)
                      and find_column_or_key(cols, LON_CANDIDATES))
        if hinted and not has_latlon and not find_wkt_column(data):
            warnings.warn(
                f"[SwiftMap] Column {hinted!r} looks like Niemeyer geohashes, "
                f"but the base cannot be read from the strings themselves -- "
                f"pass geohash_base=16, 32 or 64 to draw them.",
                stacklevel=4,
            )
        return None

    if geohash_base not in BASES:
        warnings.warn(
            f"[SwiftMap] geohash_base must be one of {BASES}, got "
            f"{geohash_base!r}. Nothing was parsed.",
            stacklevel=4,
        )
        return None
    if geohash_col is not None and geohash_col not in cols:
        warnings.warn(
            f"[SwiftMap] geohash_col={geohash_col!r} is not a column of the "
            f"supplied data. Nothing was parsed.",
            stacklevel=4,
        )
        return None
    column = geohash_col or find_column_or_key(cols, GEOHASH_COL_CANDIDATES)
    if not column:
        warnings.warn(
            f"[SwiftMap] geohash_base was given but no geohash column was "
            f"found (looked for {', '.join(GEOHASH_COL_CANDIDATES)}); point "
            f"at one with geohash_col=. Nothing was parsed.",
            stacklevel=4,
        )
        return None

    polygons, props_list, skipped, total, bad_cells = [], [], 0, 0, 0
    for row in iter_row_dicts(data):
        total += 1
        value = row.get(column)
        # A row may hold ONE hash or a LIST of them: an aggregated row that
        # covers several cells is one thing, so its cells become one
        # multipolygon feature -- the row's properties, popup and colour stay
        # per row instead of being cloned per cell.
        hashes = value if isinstance(value, (list, tuple, np.ndarray)) else [value]
        rings = [cell_ring(h, geohash_base) for h in hashes
                 if valid_geohash(h, geohash_base)]
        if not rings:
            skipped += 1
            continue
        bad_cells += len(hashes) - len(rings)
        polygons.append(rings[0] if len(rings) == 1
                        else PolygonGeom([[ring] for ring in rings]))
        props_list.append({c: row.get(c) for c in cols})

    if skipped:
        warnings.warn(
            f"[SwiftMap] Skipped {skipped} of {total} row(s) whose {column!r} "
            f"value holds no valid base-{geohash_base} geohash.",
            stacklevel=4,
        )
    if bad_cells:
        warnings.warn(
            f"[SwiftMap] Dropped {bad_cells} value(s) in {column!r} that are "
            f"not valid base-{geohash_base} geohashes; the rows kept their "
            f"remaining cells.",
            stacklevel=4,
        )
    props = {c: [p.get(c) for p in props_list] for c in cols} if props_list else {}
    return polygons, props


def _h3_column_verdict(data: Any, column: str) -> str:
    """
    "h3" when the column's first few non-null values validate structurally as
    H3 cell ids, "missing" when they are hex-shaped but the h3 package is not
    installed to prove it, "no" otherwise. A row's value may be one id or a
    LIST of them (checked element-wise); a value that is not even hex-shaped
    rejects the column outright -- that is a data column.
    """
    shaped = 0
    valid = 0
    for checked, row in enumerate(iter_row_dicts(data)):
        if checked >= 10:
            break
        value = row.get(column)
        if value is None:
            continue
        vals = value if isinstance(value, (list, tuple, np.ndarray)) else [value]
        for val in vals:
            if val is None:
                continue
            if h3_cell_str(val) is None:
                return "no"
            shaped += 1
            if is_h3_cell(val):
                valid += 1
    if not shaped:
        return "no"
    if h3_module() is None:
        return "missing"
    return "h3" if valid else "no"


def find_h3_column(data: Any, id_col: Optional[str] = None,
                   hash_col: Optional[str] = None) -> Optional[str]:
    """
    Returns the name of a column holding H3 cell ids, or None.

    Mirrors the WKT pair above: `shape_id_col` may point at a column the name-guess
    would miss (`hash_col` is geohash_col handed on -- the one hash pointer serves
    both formats), and a likely name is not enough on its own -- 'cell' may hold
    tower ids -- so at least one of the first few non-null values must actually
    validate. Validation is structural (is_h3_cell checks the id's bit layout), so
    junk cannot qualify a column; but one corrupt value must not disqualify a
    feed's column either, so invalid rows are left for the parser's skip-and-count.
    """
    try:
        cols = list(data.columns)
    except AttributeError:
        return None

    candidates = [c for c in (id_col, hash_col) if c and c in cols]
    guessed = find_column_or_key(cols, H3_COL_CANDIDATES)
    if guessed and guessed not in candidates:
        candidates.append(guessed)

    for column in candidates:
        verdict = _h3_column_verdict(data, column)
        if verdict == "missing":
            warn_h3_missing(f"Column {column!r}")
            return None
        if verdict == "h3":
            return column
    return None


def parse_tabular_polygons_by_h3_column(
    data: Any, cols: List[str], shape_id_col: Optional[str] = None,
    hash_col: Optional[str] = None,
) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """
    Tier 1b: a column of H3 cell ids -- one hexagon per row, or one
    multipolygon of hexagons for a row holding a LIST of ids. None if not
    applicable.

    Unlike a WKT column, the cell column survives into the properties: a cell id is
    data -- the join key an aggregated table carries and the id a popup should show --
    where a WKT blob is only a spelling of the geometry.
    """
    column = find_h3_column(data, shape_id_col, hash_col)
    if not column:
        return None

    polygons, props_list, skipped, total, bad_cells = [], [], 0, 0, 0
    for row in iter_row_dicts(data):
        total += 1
        value = row.get(column)
        # An aggregated row covering several cells is one thing: its cells
        # become one multipolygon feature, keeping properties, popup and
        # colour per ROW instead of cloned per cell.
        ids = value if isinstance(value, (list, tuple, np.ndarray)) else [value]
        rings = [ring for ring in (h3_cell_ring(v) for v in ids)
                 if ring is not None]
        if not rings:
            skipped += 1
            continue
        bad_cells += len(ids) - len(rings)
        polygons.append(rings[0] if len(rings) == 1
                        else PolygonGeom([[ring] for ring in rings]))
        props_list.append({c: row.get(c) for c in cols})

    if skipped:
        warnings.warn(
            f"[SwiftMap] Skipped {skipped} of {total} row(s) whose {column!r} value "
            f"holds no valid H3 cell.",
            stacklevel=4,
        )
    if bad_cells:
        warnings.warn(
            f"[SwiftMap] Dropped {bad_cells} value(s) in {column!r} that are not "
            f"valid H3 cells; the rows kept their remaining cells.",
            stacklevel=4,
        )
    props = {c: [p.get(c) for p in props_list] for c in cols} if props_list else {}
    return polygons, props


class _Column:
    """A column of a RowsView, exposing the accessors the tabular parsers use."""
    __slots__ = ("_values",)

    def __init__(self, values):
        self._values = values

    def to_list(self):
        return list(self._values)

    def to_numpy(self):
        return np.asarray(self._values)


class RowsView:
    """
    Read-only view giving plain Python data the surface the tabular parsers expect.

    A dict of columns or a list of row dicts is already tabular; converting it into a
    DataFrame to reuse those parsers would copy the whole input and make pandas a hard
    dependency of inputs that need no third-party library at all. This exposes `.columns`,
    `[col]` and `.iter_rows()` over the original object instead, materialising nothing.
    """
    __slots__ = ("_columns", "_by_column", "_rows")

    def __init__(self, data: Any):
        if isinstance(data, dict):
            self._by_column = data
            self._rows = None
            self._columns = list(data.keys())
        else:
            self._by_column = None
            self._rows = data
            # Union of keys, first-seen order, so rows with differing keys are not truncated.
            seen = {}
            for row in data:
                for key in row:
                    seen[key] = None
            self._columns = list(seen)

    @property
    def columns(self):
        return self._columns

    def __getitem__(self, column):
        if self._by_column is not None:
            return _Column(self._by_column[column])
        return _Column([row.get(column) for row in self._rows])

    def iter_rows(self, named: bool = True):
        if self._rows is not None:
            yield from self._rows
            return
        columns = self._columns
        length = max((len(v) for v in self._by_column.values()), default=0)
        for i in range(length):
            yield {c: self._by_column[c][i] for c in columns}


def group_rows_into_paths(
    data: Any,
    cols: List[str],
    lat_col: Optional[str],
    lon_col: Optional[str],
    group_col: Optional[str],
    order_col: Optional[str],
    coord_order: str,
    min_vertices: int,
    close_rings: bool,
) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """
    Multi-row grouping in plain Python, for sources with no native groupby.

    pandas and polars each keep their own implementation of this tier because theirs are
    vectorised; this is the fallback for dict and list-of-dicts input.
    """
    id_candidates = SHAPE_ID_CANDIDATES if close_rings else LINE_ID_CANDIDATES
    order_candidates = SHAPE_ORDER_CANDIDATES if close_rings else LINE_ORDER_CANDIDATES

    actual_lat = lat_col or find_column_or_key(cols, LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(cols, LON_CANDIDATES)
    if not actual_lat or not actual_lon:
        return None

    actual_group = group_col or find_column_or_key(cols, id_candidates)
    actual_order = order_col or find_column_or_key(cols, order_candidates)

    rows = list(data.iter_rows(named=True))
    if actual_order:
        rows.sort(key=lambda r: (r.get(actual_order) is None, r.get(actual_order)))

    other_cols = [c for c in cols if c not in (actual_lat, actual_lon, actual_group, actual_order)]

    grouped = {}
    for row in rows:
        key = row.get(actual_group) if actual_group else None
        grouped.setdefault(key, []).append(row)

    paths, props_list, keys = [], [], []
    for key, group in grouped.items():
        coords = []
        order_values = []
        for row in group:
            lat, lon = row.get(actual_lat), row.get(actual_lon)
            if lat is None or lon is None:
                continue
            lat, lon = float(lat), float(lon)
            coords.append([lon, lat] if coord_order == "lon_lat" else [lat, lon])
            if actual_order and not close_rings:
                order_values.append(row.get(actual_order))
        if len(coords) < min_vertices:
            continue
        if close_rings:
            coords = _ensure_closed_ring(coords)
        paths.append(coords)
        entry = {c: group[0].get(c) for c in other_cols}
        # Lines keep the order column per vertex (a track ordered by time carries its
        # times there); rings do not -- vertex order around a polygon is not a series.
        if actual_order and not close_rings:
            entry[actual_order] = order_values
        props_list.append(entry)
        keys.append(key)

    props = {c: [p.get(c) for p in props_list] for c in other_cols} if props_list else {}
    if actual_order and not close_rings and props_list:
        props[actual_order] = [p.get(actual_order) for p in props_list]
    if actual_group and paths:
        props[actual_group] = keys
    return paths, props


def iter_row_dicts(data: Any):
    """
    Yields each row as a dict, for either a pandas or polars DataFrame.

    pandas goes through itertuples, not iterrows: iterrows constructs a Series per
    row and was a measurable slice of a 6k-row WKT ingest.
    """
    if hasattr(data, "iter_rows"):
        yield from data.iter_rows(named=True)
    else:
        columns = list(data.columns)
        for row in data.itertuples(index=False, name=None):
            yield dict(zip(columns, row))


def match_wide_vertex_columns(cols: List[str]) -> Tuple[Dict[int, str], Dict[int, str]]:
    """Finds wide-format vertex column pairs like lat1/lon1, lat2/lon2, ..."""
    lat_pairs = {}
    lon_pairs = {}
    for c in cols:
        m_lat = re.match(r'^(?:lat|latitude|y)_?(\d+)$', c, re.IGNORECASE)
        m_lon = re.match(r'^(?:lon|longitude|x)_?(\d+)$', c, re.IGNORECASE)
        if m_lat:
            lat_pairs[int(m_lat.group(1))] = c
        elif m_lon:
            lon_pairs[int(m_lon.group(1))] = c
    return lat_pairs, lon_pairs


def _points_from_cells(data: Any, cols: List[str], column: str, center,
                       kind: str) -> Tuple:
    """
    Each row's cell hash(es) as CENTER points -- `center(value)` maps one hash
    to (lat, lon) or None. A list-valued row contributes one point per cell,
    all sharing the row's properties (the MULTIPOINT rule); the hash column
    survives into the properties, as everywhere.
    """
    lats, lons, props_list = [], [], []
    skipped, total, bad_cells = 0, 0, 0
    for row in iter_row_dicts(data):
        total += 1
        value = row.get(column)
        ids = value if isinstance(value, (list, tuple, np.ndarray)) else [value]
        centers = [pt for pt in (center(v) for v in ids) if pt is not None]
        if not centers:
            skipped += 1
            continue
        bad_cells += len(ids) - len(centers)
        row_props = {c: row.get(c) for c in cols}
        for lat, lon in centers:
            lats.append(lat)
            lons.append(lon)
            props_list.append(row_props)
    if skipped:
        warnings.warn(
            f"[SwiftMap] Skipped {skipped} of {total} row(s) whose {column!r} "
            f"value holds no valid {kind}.",
            stacklevel=5,
        )
    if bad_cells:
        warnings.warn(
            f"[SwiftMap] Dropped {bad_cells} value(s) in {column!r} that are "
            f"not valid {kind}s; the rows kept their remaining cells.",
            stacklevel=5,
        )
    props = {c: [p.get(c) for p in props_list] for c in cols} if props_list else {}
    return (np.array(lats, dtype=np.float64),
            np.array(lons, dtype=np.float64), props)


def parse_tabular_points_by_hash_column(
    data: Any, cols: List[str],
    geohash_col: Optional[str] = None, geohash_base: Optional[int] = None,
) -> Optional[Tuple]:
    """
    Tier 0 of points parsing: a column of cell hashes, each cell contributing
    its CENTER as the point. None if not applicable.

    The polygon tier's rules exactly: an explicit base means Niemeyer and is
    never second-guessed; a pointer without a base accepts H3 (the ids state
    what they are) and otherwise earns the base hint. Nothing fires without
    a pointer or a base -- lat/lon columns stay the fast path, and unpointed
    H3 columns are picked up in the no-coordinates fallback below.
    """
    from ..._niemeyer import BASES, decode, valid_geohash

    if geohash_col is None and geohash_base is None:
        return None
    if geohash_base is None:
        verdict = (_h3_column_verdict(data, geohash_col)
                   if geohash_col in cols else "no")
        if verdict == "h3":
            return _points_from_cells(data, cols, geohash_col,
                                      h3_cell_center, "H3 cell")
        if verdict == "missing":
            warn_h3_missing(f"Column {geohash_col!r}")
            return None
        warnings.warn(
            f"[SwiftMap] geohash_col={geohash_col!r} was given without "
            f"geohash_base, and its values are not H3 cell ids (which need "
            f"no base). A Niemeyer hash cannot state its own base -- pass "
            f"geohash_base=16, 32 or 64. The column was left as data.",
            stacklevel=5,
        )
        return None
    if geohash_base not in BASES:
        warnings.warn(
            f"[SwiftMap] geohash_base must be one of {BASES}, got "
            f"{geohash_base!r}. Nothing was parsed.",
            stacklevel=5,
        )
        return None
    if geohash_col is not None and geohash_col not in cols:
        warnings.warn(
            f"[SwiftMap] geohash_col={geohash_col!r} is not a column of the "
            f"supplied data. Nothing was parsed.",
            stacklevel=5,
        )
        return None
    column = geohash_col or find_column_or_key(cols, GEOHASH_COL_CANDIDATES)
    if not column:
        warnings.warn(
            f"[SwiftMap] geohash_base was given but no geohash column was "
            f"found (looked for {', '.join(GEOHASH_COL_CANDIDATES)}); point "
            f"at one with geohash_col=. Nothing was parsed.",
            stacklevel=5,
        )
        return None

    def niemeyer_center(value):
        if not valid_geohash(value, geohash_base):
            return None
        lon, lat, _lon_err, _lat_err = decode(value, geohash_base)
        return lat, lon

    return _points_from_cells(data, cols, column, niemeyer_center,
                              f"base-{geohash_base} geohash")


def parse_tabular_points(data: Any, lat_col: Optional[str] = None,
                         lon_col: Optional[str] = None, label: str = "DataFrame",
                         geohash_col: Optional[str] = None,
                         geohash_base: Optional[int] = None) -> Tuple:
    """Points parser shared by any source exposing `.columns` and column `.to_numpy()`/`.to_list()` (pandas, polars)."""
    cols = list(data.columns)

    result = parse_tabular_points_by_hash_column(data, cols, geohash_col, geohash_base)
    if result is not None:
        return result

    actual_lat = lat_col or find_column_or_key(cols, LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(cols, LON_CANDIDATES)

    if not actual_lat or not actual_lon:
        # No coordinate columns, but a WKT column may carry POINTs. Rows holding another
        # geometry kind yield nothing here and are picked up by the line/polygon parsers.
        wkt_column = find_wkt_column(data)
        if wkt_column:
            return _parse_wkt_points(data, cols, wkt_column)
        # An unpointed H3 column parses here too: with no coordinates of any
        # other kind, cell centers are what the table plots.
        h3_column = find_h3_column(data)
        if h3_column:
            return _points_from_cells(data, cols, h3_column,
                                      h3_cell_center, "H3 cell")
        # No coordinates of any kind. Returning empty rather than raising lets the
        # calling add_* decide: it knows whether points were actually asked for.
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), {}

    lats = data[actual_lat].to_numpy().astype(np.float64)
    lons = data[actual_lon].to_numpy().astype(np.float64)

    props = {}
    for col in cols:
        if col not in (actual_lat, actual_lon):
            props[col] = data[col].to_list()

    return drop_invalid_coordinates(lats, lons, props, label)


def drop_invalid_coordinates(lats: Any, lons: Any, props: Dict[str, List[Any]], label: str) -> Tuple:
    """
    Removes points whose coordinates are missing or non-finite, warning once per call.

    A null in a coordinate column becomes NaN through the float conversion. Left in place it
    reaches the WebGL buffer, where it does not raise -- it quietly corrupts the draw. Rows
    are dropped rather than raising so one bad record cannot take down a whole map.
    """
    valid = np.isfinite(lats) & np.isfinite(lons)
    dropped = int((~valid).sum())
    if not dropped:
        return lats, lons, props

    warnings.warn(
        f"[SwiftMap] Dropped {dropped} of {len(lats)} point(s) from {label} with missing or "
        f"invalid coordinates.",
        stacklevel=4,
    )
    return lats[valid], lons[valid], {k: [v for v, keep in zip(vals, valid) if keep]
                                      for k, vals in props.items()}


def _parse_wkt_points(data: Any, cols: List[str], wkt_column: str) -> Tuple:
    """Extracts POINT/MULTIPOINT geometries from a WKT column, ignoring other kinds."""
    lats, lons, props_list = [], [], []
    other_cols = [c for c in cols if c != wkt_column]

    for row in iter_row_dicts(data):
        row_props = {c: row[c] for c in other_cols}
        # MULTIPOINT contributes several points, all sharing the row's properties.
        for lat, lon in _parse_point_wkt_string(row[wkt_column]):
            lats.append(lat)
            lons.append(lon)
            props_list.append(row_props)

    lats_arr = np.array(lats, dtype=np.float64)
    lons_arr = np.array(lons, dtype=np.float64)
    props = {k: [p.get(k) for p in props_list] for k in other_cols} if props_list else {}

    return lats_arr, lons_arr, props


def parse_tabular_lines_by_coord_column(data: Any, cols: List[str], lat_col: Optional[str], lon_col: Optional[str], coord_order: str, coord_col: Optional[str] = None) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """Tier 1: a single column holding WKT/coordinate-string or list-of-coordinate values. None if not applicable.

    An explicit coord_col (a verified WKT id column) wins over the name-guess and over
    lat/lon columns; the guessed path still yields to explicit lat/lon.
    """
    actual_coord_col = coord_col or find_column_or_key(cols, LINE_COORD_COL_CANDIDATES)
    if not actual_coord_col or (coord_col is None and (lat_col or lon_col)):
        return None

    non_coord_cols = [c for c in cols if c != actual_coord_col]

    # Collected before any ordering happens, so the axis order can be detected across the
    # whole column at once. Deciding row by row lets a row whose longitudes all sit inside
    # +/-90 default to lat-first while a neighbouring row with a decisive value flips,
    # scattering part of the layer. WKT rows come back already resolved -- WKT states its
    # own axis order -- and are held aside from detection entirely.
    rows = []  # (resolved | None, pairs | None, props)
    for row in iter_row_dicts(data):
        raw_val = row[actual_coord_col]
        if isinstance(raw_val, (list, tuple, np.ndarray)):
            resolved, pairs = None, as_pair_block(raw_val)
        else:
            resolved, pairs = coord_string_parts(raw_val, "line", 4)
        if len(pairs if pairs is not None else resolved) >= 2:
            rows.append((resolved, pairs, {col: row[col] for col in non_coord_cols}))

    order = detect_coord_order_multi(
        (pairs for _, pairs, _ in rows if pairs is not None), coord_order)

    lines = [resolved if pairs is None else apply_coord_order(pairs, order)
             for resolved, pairs, _ in rows]
    props_list = [p for _, _, p in rows]

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]
    return lines, props


def parse_tabular_lines_by_wide_columns(data: Any, cols: List[str], lat_col: Optional[str], lon_col: Optional[str]) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """Tier 2: wide-format vertex columns (lat1, lon1, lat2, lon2, ...). None if not applicable."""
    lat_pairs, lon_pairs = match_wide_vertex_columns(cols)
    matching_indices = sorted(set(lat_pairs.keys()) & set(lon_pairs.keys()))
    if len(matching_indices) < 2 or (lat_col or lon_col):
        return None

    lines = []
    props_list = []
    used_cols = set(lat_pairs.values()) | set(lon_pairs.values())
    other_cols = [c for c in cols if c not in used_cols]

    for row in iter_row_dicts(data):
        line = []
        for idx in matching_indices:
            lat_val = float(row[lat_pairs[idx]])
            lon_val = float(row[lon_pairs[idx]])
            line.append([lat_val, lon_val])
        if len(line) >= 2:
            lines.append(line)
            props_list.append({col: row[col] for col in other_cols})

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]
    return lines, props


def parse_tabular_polygons_by_coord_column(data: Any, cols: List[str], lat_col: Optional[str], lon_col: Optional[str], coord_order: str, coord_col: Optional[str] = None) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """Tier 1: a single column holding a WKT polygon string or list-of-coordinate ring. None if not applicable.

    An explicit coord_col (a verified WKT id column) wins over the name-guess and over
    lat/lon columns; the guessed path still yields to explicit lat/lon.
    """
    actual_coord_col = coord_col or find_column_or_key(cols, POLYGON_COORD_COL_CANDIDATES)
    if not actual_coord_col or (coord_col is None and (lat_col or lon_col)):
        return None

    non_coord_cols = [c for c in cols if c != actual_coord_col]

    # Two passes, for the reason given in the lines parser above.
    rows = []  # (resolved | None, pairs | None, props)
    for row in iter_row_dicts(data):
        raw_val = row[actual_coord_col]
        if isinstance(raw_val, (list, tuple, np.ndarray)):
            resolved, pairs = None, as_pair_block(raw_val)
        else:
            resolved, pairs = coord_string_parts(raw_val, "polygon", 6)
        if len(pairs if pairs is not None else resolved) >= 3:
            rows.append((resolved, pairs, {col: row[col] for col in non_coord_cols}))

    order = detect_coord_order_multi(
        (pairs for _, pairs, _ in rows if pairs is not None), coord_order)

    # A PolygonGeom (holes / multipolygon) arrives with every ring already closed.
    polygons = [resolved if isinstance(resolved, PolygonGeom)
                else _ensure_closed_ring(resolved if pairs is None
                                         else apply_coord_order(pairs, order))
                for resolved, pairs, _ in rows]
    props_list = [p for _, _, p in rows]

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]
    return polygons, props


def parse_tabular_polygons_by_wide_columns(data: Any, cols: List[str], lat_col: Optional[str], lon_col: Optional[str]) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """Tier 2: wide-format vertex columns (lat1, lon1, lat2, lon2, ...). None if not applicable."""
    lat_pairs, lon_pairs = match_wide_vertex_columns(cols)
    matching_indices = sorted(set(lat_pairs.keys()) & set(lon_pairs.keys()))
    if len(matching_indices) < 3 or (lat_col or lon_col):
        return None

    polygons = []
    props_list = []
    used_cols = set(lat_pairs.values()) | set(lon_pairs.values())
    other_cols = [c for c in cols if c not in used_cols]

    for row in iter_row_dicts(data):
        ring = []
        for idx in matching_indices:
            lat_val = float(row[lat_pairs[idx]])
            lon_val = float(row[lon_pairs[idx]])
            ring.append([lat_val, lon_val])
        if len(ring) >= 3:
            ring = _ensure_closed_ring(ring)
            polygons.append(ring)
            props_list.append({col: row[col] for col in other_cols})

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]
    return polygons, props
