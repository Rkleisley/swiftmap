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
    parse_tabular_polygons_by_h3_column,
    parse_tabular_polygons_by_wide_columns,
)

def is_polars_dataframe(data: Any) -> bool:
    try:
        import polars as pl
        return isinstance(data, pl.DataFrame)
    except ImportError:
        return False


def polars_has_mixed_geometry(data: Any) -> bool:
    """
    True only when a WKT column is present.

    WKT states its own kind per value, so one column may hold points, lines and polygons.
    A table of plain lat/lon columns is a single kind by construction, and handing it to
    all three parsers would yield the points plus a line threaded through them and a
    polygon around them.
    """
    return is_polars_dataframe(data) and find_wkt_column(data) is not None


def parse_polars_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, **kwargs) -> Tuple:
    return parse_tabular_points(data, lat_col, lon_col, label="Polars DataFrame")


def parse_polars_lines(
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    line_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import polars as pl
    cols = list(data.columns)

    result = parse_tabular_lines_by_coord_column(
        data, cols, lat_col, lon_col, coord_order,
        coord_col=explicit_wkt_column(data, line_id_col, "line"))
    if result is not None:
        return result

    result = parse_tabular_lines_by_wide_columns(data, cols, lat_col, lon_col)
    if result is not None:
        return result

    # 3. Multi-row track grouping using native Polars expressions
    actual_lat = lat_col or find_column_or_key(cols, LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(cols, LON_CANDIDATES)
    actual_group = line_id_col or find_column_or_key(cols, LINE_ID_CANDIDATES)
    actual_order = order_col or find_column_or_key(cols, LINE_ORDER_CANDIDATES)

    if actual_lat and actual_lon:
        sorted_df = data.sort(actual_order) if (actual_order and actual_order in data.columns) else data
        if actual_group and actual_group in data.columns:
            non_group_cols = [c for c in cols if c not in (actual_lat, actual_lon, actual_group, actual_order)]
            # The order column survives per vertex (see the pandas parser for why):
            # temporals down-convert to epoch ms so the vectorised time path applies.
            order_exprs = []
            if actual_order and actual_order in data.columns:
                col_expr = pl.col(actual_order)
                if sorted_df.schema[actual_order].is_temporal():
                    col_expr = col_expr.dt.epoch("ms")
                order_exprs = [col_expr.alias(actual_order)]
            grouped = sorted_df.group_by(actual_group, maintain_order=True).agg([
                pl.col(actual_lat),
                pl.col(actual_lon),
                *[pl.col(c).first() for c in non_group_cols],
                *order_exprs,
            ])
            lines = []
            props = {}
            for col in non_group_cols:
                props[col] = grouped[col].to_list()
            if order_exprs:
                props[actual_order] = grouped[actual_order].to_list()
            props[actual_group] = grouped[actual_group].to_list()

            lats_list = grouped[actual_lat].to_list()
            lons_list = grouped[actual_lon].to_list()

            for lats, lons in zip(lats_list, lons_list):
                if coord_order == "lon_lat":
                    coords = np.column_stack((lons, lats)).tolist()
                else:
                    coords = np.column_stack((lats, lons)).tolist()
                if len(coords) >= 2:
                    lines.append(coords)
            return lines, props
        else:
            lats = sorted_df[actual_lat].to_numpy().astype(np.float64)
            lons = sorted_df[actual_lon].to_numpy().astype(np.float64)
            if coord_order == "lon_lat":
                coords = np.column_stack((lons, lats)).tolist()
            else:
                coords = np.column_stack((lats, lons)).tolist()
            return [coords], {}

    # No line geometry here. Typed sources return empty for this, so tabular
    # sources do too; the calling add_* warns if it was asked for lines specifically.
    return [], {}


def parse_polars_polygons(
    data: Any,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    shape_id_col: Optional[str] = None,
    order_col: Optional[str] = None,
    coord_order: str = "auto",
    **kwargs
) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import polars as pl
    cols = list(data.columns)

    result = parse_tabular_polygons_by_coord_column(
        data, cols, lat_col, lon_col, coord_order,
        coord_col=explicit_wkt_column(data, shape_id_col, "polygon"))
    if result is not None:
        return result

    result = parse_tabular_polygons_by_h3_column(data, cols, shape_id_col)
    if result is not None:
        return result

    result = parse_tabular_polygons_by_wide_columns(data, cols, lat_col, lon_col)
    if result is not None:
        return result

    # 3. Multi-row polygon grouping by shape_id_col using Polars expressions
    actual_lat = lat_col or find_column_or_key(cols, LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(cols, LON_CANDIDATES)
    actual_group = shape_id_col or find_column_or_key(cols, SHAPE_ID_CANDIDATES)
    actual_order = order_col or find_column_or_key(cols, SHAPE_ORDER_CANDIDATES)

    if actual_lat and actual_lon:
        sorted_df = data.sort(actual_order) if (actual_order and actual_order in data.columns) else data
        if actual_group and actual_group in data.columns:
            non_group_cols = [c for c in cols if c not in (actual_lat, actual_lon, actual_group, actual_order)]
            grouped = sorted_df.group_by(actual_group, maintain_order=True).agg([
                pl.col(actual_lat),
                pl.col(actual_lon),
                *[pl.col(c).first() for c in non_group_cols]
            ])
            polygons = []
            props = {}
            for col in non_group_cols:
                props[col] = grouped[col].to_list()
            props[actual_group] = grouped[actual_group].to_list()

            lats_list = grouped[actual_lat].to_list()
            lons_list = grouped[actual_lon].to_list()

            for lats, lons in zip(lats_list, lons_list):
                if coord_order == "lon_lat":
                    coords = np.column_stack((lons, lats)).tolist()
                else:
                    coords = np.column_stack((lats, lons)).tolist()
                if len(coords) >= 3:
                    coords = _ensure_closed_ring(coords)
                    polygons.append(coords)
            return polygons, props
        else:
            lats = sorted_df[actual_lat].to_numpy().astype(np.float64)
            lons = sorted_df[actual_lon].to_numpy().astype(np.float64)
            if coord_order == "lon_lat":
                coords = np.column_stack((lons, lats)).tolist()
            else:
                coords = np.column_stack((lats, lons)).tolist()
            coords = _ensure_closed_ring(coords)
            return [coords], {}

    # No polygon geometry here. Typed sources return empty for this, so tabular
    # sources do too; the calling add_* warns if it was asked for polygons specifically.
    return [], {}
