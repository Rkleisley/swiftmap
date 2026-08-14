import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import _ensure_closed_ring, PolygonGeom

def is_geopandas_dataframe(data: Any) -> bool:
    try:
        import geopandas as gpd
        return isinstance(data, (gpd.GeoDataFrame, gpd.GeoSeries))
    except ImportError:
        return False


def parse_geopandas_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, **kwargs) -> Tuple:
    import geopandas as gpd
    from shapely.geometry import Point, MultiPoint
    from shapely.geometry.base import BaseGeometry

    if isinstance(data, gpd.GeoSeries):
        gdf = gpd.GeoDataFrame(geometry=data)
    else:
        gdf = data

    geom_col = gdf.geometry.name
    non_geom_cols = [c for c in gdf.columns if c != geom_col]

    lats_list = []
    lons_list = []
    props_list = []

    for _, row in gdf.iterrows():
        geom = row[geom_col]
        if not isinstance(geom, BaseGeometry) or geom.is_empty:
            continue

        row_props = {col: row[col] for col in non_geom_cols}

        if isinstance(geom, Point):
            lons_list.append(float(geom.x))
            lats_list.append(float(geom.y))
            props_list.append(row_props)
        elif isinstance(geom, MultiPoint):
            for pt in geom.geoms:
                lons_list.append(float(pt.x))
                lats_list.append(float(pt.y))
                props_list.append(row_props)

    lats = np.array(lats_list, dtype=np.float64)
    lons = np.array(lons_list, dtype=np.float64)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]

    return lats, lons, props


def parse_geopandas_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import geopandas as gpd
    from shapely.geometry import LineString, MultiLineString
    from shapely.geometry.base import BaseGeometry

    lines = []
    props_list = []

    if isinstance(data, gpd.GeoSeries):
        gdf = gpd.GeoDataFrame(geometry=data)
    else:
        gdf = data

    geom_col = gdf.geometry.name
    non_geom_cols = [c for c in gdf.columns if c != geom_col]

    for _, row in gdf.iterrows():
        geom = row[geom_col]
        if not isinstance(geom, BaseGeometry) or geom.is_empty:
            continue

        row_props = {col: row[col] for col in non_geom_cols}

        if isinstance(geom, LineString):
            coords = [[float(y), float(x)] for x, y in geom.coords]
            if len(coords) >= 2:
                lines.append(coords)
                props_list.append(row_props)
        elif isinstance(geom, MultiLineString):
            for line in geom.geoms:
                coords = [[float(y), float(x)] for x, y in line.coords]
                if len(coords) >= 2:
                    lines.append(coords)
                    props_list.append(row_props)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]

    return lines, props


def parse_geopandas_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import geopandas as gpd
    from shapely.geometry import Polygon, MultiPolygon
    from shapely.geometry.base import BaseGeometry

    polygons = []
    props_list = []

    if isinstance(data, gpd.GeoSeries):
        gdf = gpd.GeoDataFrame(geometry=data)
    else:
        gdf = data

    geom_col = gdf.geometry.name
    non_geom_cols = [c for c in gdf.columns if c != geom_col]

    for _, row in gdf.iterrows():
        geom = row[geom_col]
        if not isinstance(geom, BaseGeometry) or geom.is_empty:
            continue

        row_props = {col: row[col] for col in non_geom_cols}

        # Holes (shapely `interiors`) and multipolygon parts survive as a PolygonGeom;
        # a bare exterior stays a plain ring. A MultiPolygon is ONE feature and stays
        # one layer -- it used to split into a layer per part, each stripped to its
        # outer ring.
        def shapely_part(poly):
            rings = [[[float(y), float(x)] for x, y in poly.exterior.coords]]
            rings += [[[float(y), float(x)] for x, y in hole.coords]
                      for hole in poly.interiors]
            rings = [_ensure_closed_ring(r) for r in rings if len(r) >= 3]
            return rings if rings else None

        if isinstance(geom, Polygon):
            part = shapely_part(geom)
            if part:
                polygons.append(part[0] if len(part) == 1 else PolygonGeom([part]))
                props_list.append(row_props)
        elif isinstance(geom, MultiPolygon):
            parts = [pt for pt in (shapely_part(poly) for poly in geom.geoms) if pt]
            if parts:
                if len(parts) == 1 and len(parts[0]) == 1:
                    polygons.append(parts[0][0])
                else:
                    polygons.append(PolygonGeom(parts))
                props_list.append(row_props)

    props = {}
    if props_list:
        for k in props_list[0].keys():
            props[k] = [p.get(k) for p in props_list]

    return polygons, props
