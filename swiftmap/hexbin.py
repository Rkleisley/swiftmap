"""
hexbin: raw points in, a cell + count table out. Data-side, on purpose.

swiftmap paints; it does not analyse. Binning lives in a function that takes
data and returns data -- inspect it, filter it, join it, then paint it -- and
the map itself never aggregates anything.
"""
from collections import Counter
from typing import Any, Optional

from .parsers import parse_points
from .parsers.sources._utils import h3_module


def hexbin(
    data: Any,
    resolution: int,
    lat_col: Optional[str] = None,
    lon_col: Optional[str] = None,
    coord_order: str = "auto",
):
    """
    Bins point data into H3 cells and returns a table of `h3` and `count` columns.

    Counting is the one aggregation with no interpretation in it, and it is the
    only one built in. Means, uniques, dwell times and every other statistic
    belong in the pipeline that understands the data -- and that pipeline's
    output paints through the same door this function's does:

        m.add_polygon(swiftmap.hexbin(df, resolution=8), color_col="count")

    Accepts every point source the add_* methods read (DataFrames, GeoDataFrames,
    dicts, coordinate lists, ...), with the same `lat_col`/`lon_col`/`coord_order`
    overrides. Rows with missing coordinates are dropped and counted in a warning,
    exactly as they are on the way onto a map. The result matches the input's
    flavour -- pandas in, pandas out; polars in, polars out; anything else, a
    plain dict of columns -- so it feeds add_polygon directly and joins back onto
    the source data on the `h3` column.

    Unlike the add_* chain this is a plain function with nothing on the map to
    lose, so a missing h3 package or an impossible resolution raises instead of
    warning: silently returning an empty table would poison everything downstream.

    Parameters
    ----------
    data : any point source swiftmap reads
    resolution : int
        H3 resolution, 0 (continent-scale) to 15 (sub-metre).
    lat_col, lon_col : str, optional
        Column overrides, as in every add_* method.
    coord_order : str
        "auto" (default), "lat_lon", or "lon_lat" -- for bare coordinate lists,
        as in every add_* method.
    """
    h3 = h3_module()
    if h3 is None:
        raise ImportError(
            "swiftmap.hexbin needs the h3 package to bin points into cells. "
            "pip install h3"
        )
    if isinstance(resolution, bool) or not isinstance(resolution, int) \
            or not 0 <= resolution <= 15:
        raise ValueError(
            f"hexbin resolution must be an integer from 0 to 15, got {resolution!r}."
        )

    lats, lons, _props = parse_points(
        data, lat_col=lat_col, lon_col=lon_col, coord_order=coord_order)

    counts = Counter(
        h3.latlng_to_cell(lat, lon, resolution)
        for lat, lon in zip(lats.tolist(), lons.tolist())
    )
    cells = list(counts.keys())
    values = [counts[c] for c in cells]

    module = type(data).__module__ or ""
    if module.startswith("polars"):
        import polars as pl
        return pl.DataFrame({"h3": cells, "count": values})
    if module.startswith(("pandas", "geopandas")):
        import pandas as pd
        return pd.DataFrame({"h3": cells, "count": values})
    return {"h3": cells, "count": values}
