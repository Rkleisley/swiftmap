import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import find_column_or_key, _ensure_closed_ring
from ._tabular import (
    find_wkt_column,
    explicit_wkt_column,
    LAT_CANDIDATES,
    LON_CANDIDATES,
    LINE_ID_CANDIDATES,
    LINE_ORDER_CANDIDATES,
    SHAPE_ID_CANDIDATES,
    SHAPE_ORDER_CANDIDATES,
    parse_tabular_points,
    parse_tabular_lines_by_coord_column,
    parse_tabular_lines_by_wide_columns,
    parse_tabular_polygons_by_coord_column,
    parse_tabular_polygons_by_geohash_column,
    parse_tabular_polygons_by_h3_column,
    parse_tabular_polygons_by_wide_columns,
)

def is_pandas_dataframe(data: Any) -> bool:
    try:
        import pandas as pd
        return isinstance(data, pd.DataFrame)
    except ImportError:
        return False


def pandas_has_mixed_geometry(data: Any) -> bool:
    """
    True only when a WKT column is present.

    WKT states its own kind per value, so one column may hold points, lines and polygons.
    A table of plain lat/lon columns is a single kind by construction, and handing it to
    all three parsers would yield the points plus a line threaded through them and a
    polygon around them.
    """
    return is_pandas_dataframe(data) and find_wkt_column(data) is not None


def _order_values(series: Any) -> list:
    """A line's per-vertex order values, datetimes down-converted to epoch ms ints
    so the vectorised numeric time path applies instead of a per-value parse.
    Via datetime64[ms], not a division: pandas keeps whatever unit the data arrived
    in (ns, us, ms...), so the int64 view's scale is not knowable up front."""
    dtype = series.dtype
    if getattr(dtype, "tz", None) is not None:
        # tz-aware columns are pandas' DatetimeTZDtype, an EXTENSION dtype that
        # np.issubdtype does not interpret -- it raises ("Cannot interpret
        # 'datetime64[us, UTC]'"), which killed the whole add_line. Normalise to
        # naive UTC first; naive parses as UTC everywhere else in the time path,
        # so slider positions come out identical.
        series = series.dt.tz_convert("UTC").dt.tz_localize(None)
        dtype = series.dtype
    try:
        is_datetime = np.issubdtype(dtype, np.datetime64)
    except TypeError:
        is_datetime = False   # some other extension dtype: keep the raw values
    if is_datetime:
        series = series.astype("datetime64[ms]").astype("int64")
    return series.to_list()


def parse_pandas_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, **kwargs) -> Tuple:
    return parse_tabular_points(data, lat_col, lon_col, label="DataFrame",
                                geohash_col=kwargs.get("geohash_col"),
                                geohash_base=kwargs.get("geohash_base"))


def parse_pandas_lines(
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    line_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    cols = list(data.columns)

    result = parse_tabular_lines_by_coord_column(
        data, cols, lat_col, lon_col, coord_order,
        coord_col=explicit_wkt_column(data, line_id_col, "line"))
    if result is not None:
        return result

    result = parse_tabular_lines_by_wide_columns(data, cols, lat_col, lon_col)
    if result is not None:
        return result

    # 3. Multi-row track grouping or simple lat/lon columns (pandas-specific: groupby sub-frames)
    actual_lat = lat_col or find_column_or_key(cols, LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(cols, LON_CANDIDATES)
    actual_group = line_id_col or find_column_or_key(cols, LINE_ID_CANDIDATES)
    actual_order = order_col or find_column_or_key(cols, LINE_ORDER_CANDIDATES)

    if actual_lat and actual_lon:
        if actual_group:
            lines = []
            props = {}
            group_keys = []
            non_group_cols = [c for c in cols if c not in (actual_lat, actual_lon, actual_group, actual_order)]

            for grp_val, group_df in data.groupby(actual_group, sort=False):
                if actual_order and actual_order in group_df.columns:
                    group_df = group_df.sort_values(by=actual_order)

                lats = group_df[actual_lat].to_numpy().astype(np.float64)
                lons = group_df[actual_lon].to_numpy().astype(np.float64)

                if coord_order == "lon_lat":
                    coords = np.column_stack((lons, lats)).tolist()
                else:
                    coords = np.column_stack((lats, lons)).tolist()

                if len(coords) >= 2:
                    lines.append(coords)
                    group_keys.append(grp_val)
                    for col in non_group_cols:
                        if col not in props:
                            props[col] = []
                        props[col].append(group_df[col].iloc[0])
                    # The order column survives PER VERTEX, not as a first-row scalar:
                    # for a track ordered by its timestamps, these are the times, and
                    # dropping them is why a whole track could only ever carry one time
                    # span -- forcing per-segment layers and the 64-slot ceiling.
                    if actual_order and actual_order in group_df.columns:
                        props.setdefault(actual_order, []).append(
                            _order_values(group_df[actual_order]))

            props[actual_group] = group_keys
            return lines, props
        else:
            df_sorted = data.sort_values(by=actual_order) if (actual_order and actual_order in data.columns) else data
            lats = df_sorted[actual_lat].to_numpy().astype(np.float64)
            lons = df_sorted[actual_lon].to_numpy().astype(np.float64)
            if coord_order == "lon_lat":
                coords = np.column_stack((lons, lats)).tolist()
            else:
                coords = np.column_stack((lats, lons)).tolist()
            props_single = {}
            if actual_order and actual_order in df_sorted.columns:
                props_single[actual_order] = [_order_values(df_sorted[actual_order])]
            return [coords], props_single

    # No line geometry here. Typed sources return empty for this, so tabular
    # sources do too; the calling add_* warns if it was asked for lines specifically.
    return [], {}


def parse_pandas_polygons(
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    shape_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    geohash_col: Optional[str] = None,
    geohash_base: Optional[int] = None,
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    cols = list(data.columns)

    # An explicit base is a stated intent, so the geohash tier outranks every
    # guessed one; without a base it only ever hints, never parses.
    result = parse_tabular_polygons_by_geohash_column(
        data, cols, geohash_col, geohash_base)
    if result is not None:
        return result

    result = parse_tabular_polygons_by_coord_column(
        data, cols, lat_col, lon_col, coord_order,
        coord_col=explicit_wkt_column(data, shape_id_col, "polygon"))
    if result is not None:
        return result

    # geohash_col rides along: the one hash pointer serves both formats, and a
    # column of H3 ids (which state what they are) needs no base. An explicit
    # base means Niemeyer and was consumed above.
    result = parse_tabular_polygons_by_h3_column(
        data, cols, shape_id_col,
        hash_col=geohash_col if geohash_base is None else None)
    if result is not None:
        return result

    result = parse_tabular_polygons_by_wide_columns(data, cols, lat_col, lon_col)
    if result is not None:
        return result

    # 3. Multi-row polygon grouping by shape_id_col (pandas-specific: groupby sub-frames)
    actual_lat = lat_col or find_column_or_key(cols, LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(cols, LON_CANDIDATES)
    actual_group = shape_id_col or find_column_or_key(cols, SHAPE_ID_CANDIDATES)
    actual_order = order_col or find_column_or_key(cols, SHAPE_ORDER_CANDIDATES)

    if actual_lat and actual_lon:
        if actual_group:
            polygons = []
            props = {}
            group_keys = []
            non_group_cols = [c for c in cols if c not in (actual_lat, actual_lon, actual_group, actual_order)]

            for grp_val, group_df in data.groupby(actual_group, sort=False):
                if actual_order and actual_order in group_df.columns:
                    group_df = group_df.sort_values(by=actual_order)

                lats = group_df[actual_lat].to_numpy().astype(np.float64)
                lons = group_df[actual_lon].to_numpy().astype(np.float64)

                if coord_order == "lon_lat":
                    coords = np.column_stack((lons, lats)).tolist()
                else:
                    coords = np.column_stack((lats, lons)).tolist()

                if len(coords) >= 3:
                    coords = _ensure_closed_ring(coords)
                    polygons.append(coords)
                    group_keys.append(grp_val)
                    for col in non_group_cols:
                        if col not in props:
                            props[col] = []
                        props[col].append(group_df[col].iloc[0])

            props[actual_group] = group_keys
            return polygons, props
        else:
            df_sorted = data.sort_values(by=actual_order) if (actual_order and actual_order in data.columns) else data
            lats = df_sorted[actual_lat].to_numpy().astype(np.float64)
            lons = df_sorted[actual_lon].to_numpy().astype(np.float64)
            if coord_order == "lon_lat":
                coords = np.column_stack((lons, lats)).tolist()
            else:
                coords = np.column_stack((lats, lons)).tolist()
            coords = _ensure_closed_ring(coords)
            return [coords], {}

    # No polygon geometry here. Typed sources return empty for this, so tabular
    # sources do too; the calling add_* warns if it was asked for polygons specifically.
    return [], {}
