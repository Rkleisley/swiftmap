import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import find_column_or_key, _ensure_closed_ring
from ._tabular import (
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
    parse_tabular_polygons_by_wide_columns,
)

def is_pandas_dataframe(data: Any) -> bool:
    try:
        import pandas as pd
        return isinstance(data, pd.DataFrame)
    except ImportError:
        return False


def parse_pandas_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None) -> Tuple:
    return parse_tabular_points(data, lat_col, lon_col, label="DataFrame")


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

    result = parse_tabular_lines_by_coord_column(data, cols, lat_col, lon_col, coord_order)
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
            return [coords], {}

    raise ValueError(f"Could not parse lines from Pandas DataFrame columns: {cols}")


def parse_pandas_polygons(
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    shape_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    cols = list(data.columns)

    result = parse_tabular_polygons_by_coord_column(data, cols, lat_col, lon_col, coord_order)
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

    raise ValueError(f"Could not parse polygons from Pandas DataFrame columns: {cols}")
