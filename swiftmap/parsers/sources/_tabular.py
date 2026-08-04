import re
import numpy as np
from typing import Any, Dict, List, Optional, Tuple
from ._utils import (
    find_column_or_key,
    _parse_coord_string,
    _parse_polygon_wkt_string,
    _parse_point_wkt_string,
    _ensure_closed_ring,
    wkt_kind,
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


def iter_row_dicts(data: Any):
    """Yields each row as something supporting row[col], for either a pandas or polars DataFrame."""
    if hasattr(data, "iter_rows"):
        yield from data.iter_rows(named=True)
    else:
        for _, row in data.iterrows():
            yield row


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


def parse_tabular_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None, label: str = "DataFrame") -> Tuple:
    """Points parser shared by any source exposing `.columns` and column `.to_numpy()`/`.to_list()` (pandas, polars)."""
    cols = list(data.columns)
    actual_lat = lat_col or find_column_or_key(cols, LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(cols, LON_CANDIDATES)

    if not actual_lat or not actual_lon:
        # No coordinate columns, but a WKT column may carry POINTs. Rows holding another
        # geometry kind yield nothing here and are picked up by the line/polygon parsers.
        wkt_column = find_wkt_column(data)
        if wkt_column:
            return _parse_wkt_points(data, cols, wkt_column, intensity_col)
        raise ValueError(f"Could not auto-detect lat/lon columns from {label}. Columns: {cols}")

    lats = data[actual_lat].to_numpy().astype(np.float64)
    lons = data[actual_lon].to_numpy().astype(np.float64)

    props = {}
    for col in cols:
        if col not in (actual_lat, actual_lon):
            props[col] = data[col].to_list()

    intensities = np.array(props.get(intensity_col), dtype=np.float64) if (intensity_col and intensity_col in props) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, props, intensities


def _parse_wkt_points(data: Any, cols: List[str], wkt_column: str, intensity_col: Optional[str]) -> Tuple:
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

    if intensity_col and intensity_col in props:
        intensities = np.array(props[intensity_col], dtype=np.float64)
    else:
        intensities = np.ones(len(lats_arr), dtype=np.float64)

    return lats_arr, lons_arr, props, intensities


def parse_tabular_lines_by_coord_column(data: Any, cols: List[str], lat_col: Optional[str], lon_col: Optional[str], coord_order: str) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """Tier 1: a single column holding WKT/coordinate-string or list-of-coordinate values. None if not applicable."""
    actual_coord_col = find_column_or_key(cols, LINE_COORD_COL_CANDIDATES)
    if not actual_coord_col or (lat_col or lon_col):
        return None

    lines = []
    props_list = []
    non_coord_cols = [c for c in cols if c != actual_coord_col]

    for row in iter_row_dicts(data):
        raw_val = row[actual_coord_col]
        if isinstance(raw_val, str):
            coords = _parse_coord_string(raw_val, coord_order=coord_order)
        elif isinstance(raw_val, (list, tuple, np.ndarray)):
            coords = []
            for pt in raw_val:
                if len(pt) >= 2:
                    n1, n2 = float(pt[0]), float(pt[1])
                    if coord_order == "lon_lat":
                        coords.append([n2, n1])
                    else:
                        coords.append([n1, n2])
        else:
            coords = []

        if len(coords) >= 2:
            lines.append(coords)
            props_list.append({col: row[col] for col in non_coord_cols})

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


def parse_tabular_polygons_by_coord_column(data: Any, cols: List[str], lat_col: Optional[str], lon_col: Optional[str], coord_order: str) -> Optional[Tuple[List[List[List[float]]], Dict[str, List[Any]]]]:
    """Tier 1: a single column holding a WKT polygon string or list-of-coordinate ring. None if not applicable."""
    actual_coord_col = find_column_or_key(cols, POLYGON_COORD_COL_CANDIDATES)
    if not actual_coord_col or (lat_col or lon_col):
        return None

    polygons = []
    props_list = []
    non_coord_cols = [c for c in cols if c != actual_coord_col]

    for row in iter_row_dicts(data):
        raw_val = row[actual_coord_col]
        if isinstance(raw_val, str):
            coords = _parse_polygon_wkt_string(raw_val, coord_order=coord_order)
        elif isinstance(raw_val, (list, tuple, np.ndarray)):
            coords = []
            for pt in raw_val:
                if len(pt) >= 2:
                    n1, n2 = float(pt[0]), float(pt[1])
                    if coord_order == "lon_lat":
                        coords.append([n2, n1])
                    else:
                        coords.append([n1, n2])
            coords = _ensure_closed_ring(coords)
        else:
            coords = []

        if len(coords) >= 3:
            polygons.append(coords)
            props_list.append({col: row[col] for col in non_coord_cols})

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
