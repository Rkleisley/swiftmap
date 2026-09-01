import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import (find_column_or_key, _ensure_closed_ring, detect_coord_order,
                     detect_coord_order_multi, apply_coord_order, as_pair_block)
from ._utils import h3_cell_center
from ._tabular import (
    LAT_CANDIDATES,
    LON_CANDIDATES,
    RowsView,
    group_rows_into_paths,
    explicit_wkt_column,
    find_h3_column,
    _points_from_cells,
    parse_tabular_lines_by_coord_column,
    parse_tabular_lines_by_wide_columns,
    parse_tabular_points_by_hash_column,
    parse_tabular_polygons_by_coord_column,
    parse_tabular_polygons_by_geohash_column,
    parse_tabular_polygons_by_h3_column,
    parse_tabular_polygons_by_wide_columns,
)

def is_list_of_dicts(data: Any) -> bool:
    return isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict)

def is_dict(data: Any) -> bool:
    return isinstance(data, dict) and "type" not in data

def is_coordinate_list(data: Any) -> bool:
    if isinstance(data, (list, tuple, np.ndarray)):
        if len(data) == 0:
            return True
        if isinstance(data[0], (int, float, np.number)):
            return True
        if isinstance(data[0], (list, tuple, np.ndarray)) and len(data[0]) > 0:
            if isinstance(data[0][0], (int, float, np.number, list, tuple, np.ndarray)):
                return True
    return False


def parse_list_of_dicts_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, **kwargs) -> Tuple:
    hashed = _hash_points(data, kwargs)
    if hashed is not None:
        return hashed
    actual_lat = lat_col or find_column_or_key(list(data[0].keys()), LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(list(data[0].keys()), LON_CANDIDATES)

    if not actual_lat or not actual_lon:
        return _h3_fallback_points(data) or (
            np.array([], dtype=np.float64), np.array([], dtype=np.float64), {})
        
    rows = [r for r in data if r.get(actual_lat) is not None and r.get(actual_lon) is not None]
    lats = np.array([float(r[actual_lat]) for r in rows], dtype=np.float64)
    lons = np.array([float(r[actual_lon]) for r in rows], dtype=np.float64)

    # Union of keys in first-seen order: rows need not share a schema, and indexing with
    # [k] instead of .get(k) raised KeyError as soon as one row differed.
    keys = {}
    for row in rows:
        for key in row:
            if key not in (actual_lat, actual_lon):
                keys[key] = None

    props = {k: [r.get(k) for r in rows] for k in keys}
    return lats, lons, props


def _hash_points(data: Any, kwargs: dict) -> Optional[Tuple]:
    """The explicit-pointer hash tier, over a RowsView -- see _tabular."""
    geohash_col = kwargs.get("geohash_col")
    geohash_base = kwargs.get("geohash_base")
    if geohash_col is None and geohash_base is None:
        return None
    view = RowsView(data)
    return parse_tabular_points_by_hash_column(
        view, view.columns, geohash_col, geohash_base)


def _h3_fallback_points(data: Any) -> Optional[Tuple]:
    """An unpointed H3 column, when no coordinates of any other kind exist."""
    view = RowsView(data)
    column = find_h3_column(view)
    if not column:
        return None
    return _points_from_cells(view, view.columns, column,
                              h3_cell_center, "H3 cell")


def parse_dict_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, **kwargs) -> Tuple:
    hashed = _hash_points(data, kwargs)
    if hashed is not None:
        return hashed
    actual_lat = lat_col or find_column_or_key(list(data.keys()), LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(list(data.keys()), LON_CANDIDATES)

    if not actual_lat or not actual_lon:
        return _h3_fallback_points(data) or (
            np.array([], dtype=np.float64), np.array([], dtype=np.float64), {})
        
    lats = np.asarray(data[actual_lat], dtype=np.float64)
    lons = np.asarray(data[actual_lon], dtype=np.float64)
    
    props = {}
    for k in data.keys():
        if k not in (actual_lat, actual_lon):
            props[k] = list(data[k])
            
    return lats, lons, props


def parse_coordinate_list_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None,
                                 coord_order: str = "auto", **kwargs) -> Tuple:
    """
    Raw coordinate lists, the one point source whose axis order nothing states.

    Every other point source declares it -- named lat/lon columns, WKT, the GeoJSON spec,
    a typed geometry -- so this is the only place detection has anything to decide.
    """
    if data is None or len(data) == 0:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), {}

    if len(data) == 2 and isinstance(data[0], (int, float)) and isinstance(data[1], (int, float)):
        arr = np.asarray([data], dtype=np.float64)
    else:
        arr = np.asarray(data, dtype=np.float64)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)

    if arr.shape[0] == 0 or arr.shape[1] < 2:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), {}

    # Detected across the whole array and applied to all of it, never per point: see
    # detect_coord_order. A single bare pair carries only its own evidence, which is all
    # there is to go on, so [-118.24, 34.05] is still correctly read as lon-first.
    if detect_coord_order(arr, coord_order) == "lon_lat":
        return arr[:, 1], arr[:, 0], {}
    return arr[:, 0], arr[:, 1], {}


def parse_coordinate_list_lines(data: Any, coord_order: str = "auto", **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    if data is None or len(data) == 0:
        return [], {}

    # Check if single line: [[lat1, lon1], [lat2, lon2], ...]
    if isinstance(data[0], (list, tuple, np.ndarray)) and len(data[0]) >= 2 and isinstance(data[0][0], (int, float, np.number)):
        pts = as_pair_block(data)
        return [apply_coord_order(pts, detect_coord_order(pts, coord_order))], {}

    # Check if list of lines: [[[lat1, lon1], ...], [[lat3, lon3], ...]]
    #
    # The order is detected across every line at once and then applied to all of them, so a
    # single line holding the only out-of-range longitude cannot end up transposed while the
    # rest of the dataset keeps the opposite convention.
    subs = [as_pair_block(sub)
            for sub in data if isinstance(sub, (list, tuple, np.ndarray)) and len(sub) > 0]
    order = detect_coord_order_multi(subs, coord_order)

    lines = []
    for sub in subs:
        line = apply_coord_order(sub, order)
        if len(line) >= 2:
            lines.append(line)

    return lines, {}


def parse_coordinate_list_polygons(data: Any, coord_order: str = "auto", **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    if data is None or len(data) == 0:
        return [], {}

    # Check if single polygon ring: [[lat1, lon1], [lat2, lon2], ...]
    if isinstance(data[0], (list, tuple, np.ndarray)) and len(data[0]) >= 2 and isinstance(data[0][0], (int, float, np.number)):
        pts = as_pair_block(data)
        ring = apply_coord_order(pts, detect_coord_order(pts, coord_order))
        return [_ensure_closed_ring(ring)], {}

    # Check if list of polygon rings: [[[lat1, lon1], ...], [[lat3, lon3], ...]]
    # Detected across every ring at once, for the reason given in the lines parser.
    subs = [as_pair_block(sub)
            for sub in data if isinstance(sub, (list, tuple, np.ndarray)) and len(sub) > 0]
    order = detect_coord_order_multi(subs, coord_order)

    polygons = []
    for sub in subs:
        ring = apply_coord_order(sub, order)
        if len(ring) >= 3:
            polygons.append(_ensure_closed_ring(ring))

    return polygons, {}


def _parse_rows(
    data: Any,
    close_rings: bool,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    line_id_col: Optional[str] = None,
    shape_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    geohash_col: Optional[str] = None,
    geohash_base: Optional[int] = None,
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    """
    Runs the tabular tiers over dict / list-of-dicts input.

    The input is already tabular, so it is wrapped in a RowsView rather than converted
    into a DataFrame: no copy is made, and pandas is not required for data that is plain
    Python to begin with.
    """
    view = RowsView(data)
    cols = view.columns

    if close_rings:
        result = parse_tabular_polygons_by_geohash_column(
            view, cols, geohash_col, geohash_base)
        if result is not None:
            return result

    by_coord = (parse_tabular_polygons_by_coord_column if close_rings
                else parse_tabular_lines_by_coord_column)
    by_wide = (parse_tabular_polygons_by_wide_columns if close_rings
               else parse_tabular_lines_by_wide_columns)

    id_col = shape_id_col if close_rings else line_id_col
    result = by_coord(view, cols, lat_col, lon_col, coord_order,
                      coord_col=explicit_wkt_column(
                          view, id_col, "polygon" if close_rings else "line"))
    if result is not None:
        return result

    if close_rings:
        result = parse_tabular_polygons_by_h3_column(
            view, cols, shape_id_col,
            hash_col=geohash_col if geohash_base is None else None)
        if result is not None:
            return result

    result = by_wide(view, cols, lat_col, lon_col)
    if result is not None:
        return result

    result = group_rows_into_paths(
        view, cols, lat_col, lon_col,
        group_col=shape_id_col if close_rings else line_id_col,
        order_col=order_col,
        coord_order=coord_order,
        min_vertices=3 if close_rings else 2,
        close_rings=close_rings,
    )
    return result if result is not None else ([], {})


def parse_dict_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    return _parse_rows(data, close_rings=False, **kwargs)


def parse_list_of_dicts_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    return _parse_rows(data, close_rings=False, **kwargs)


def parse_dict_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    return _parse_rows(data, close_rings=True, **kwargs)


def parse_list_of_dicts_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    return _parse_rows(data, close_rings=True, **kwargs)
