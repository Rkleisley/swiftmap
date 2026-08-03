import numpy as np
from typing import Optional, List, Dict, Any, Tuple
from ._utils import find_column_or_key, _ensure_closed_ring
from ._tabular import LAT_CANDIDATES, LON_CANDIDATES

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


def parse_list_of_dicts_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    actual_lat = lat_col or find_column_or_key(list(data[0].keys()), LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(list(data[0].keys()), LON_CANDIDATES)

    if not actual_lat or not actual_lon:
        raise ValueError(f"Could not auto-detect lat/lon keys from dictionaries. Keys: {list(data[0].keys())}")
        
    lats = np.array([float(item[actual_lat]) for item in data], dtype=np.float64)
    lons = np.array([float(item[actual_lon]) for item in data], dtype=np.float64)
    
    props = {}
    for k in data[0].keys():
        if k not in (actual_lat, actual_lon):
            props[k] = [item[k] for item in data]
            
    intensities = np.array(props.get(intensity_col), dtype=np.float64) if (intensity_col and intensity_col in props) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, props, intensities


def parse_dict_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    actual_lat = lat_col or find_column_or_key(list(data.keys()), LAT_CANDIDATES)
    actual_lon = lon_col or find_column_or_key(list(data.keys()), LON_CANDIDATES)

    if not actual_lat or not actual_lon:
        raise ValueError(f"Could not auto-detect lat/lon keys from dictionary. Keys: {list(data.keys())}")
        
    lats = np.asarray(data[actual_lat], dtype=np.float64)
    lons = np.asarray(data[actual_lon], dtype=np.float64)
    
    props = {}
    for k in data.keys():
        if k not in (actual_lat, actual_lon):
            props[k] = list(data[k])
            
    intensities = np.array(props.get(intensity_col), dtype=np.float64) if (intensity_col and intensity_col in props) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, props, intensities


def parse_coordinate_list_points(data: Any, lat_col: Optional[str] = None, lon_col: Optional[str] = None, intensity_col: Optional[str] = None) -> Tuple:
    if not data or len(data) == 0:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64), {}, np.array([], dtype=np.float64)

    if len(data) == 2 and isinstance(data[0], (int, float)) and isinstance(data[1], (int, float)):
        return np.array([float(data[0])]), np.array([float(data[1])]), {}, np.array([1.0])
        
    arr = np.asarray(data, dtype=np.float64)
    if arr.ndim == 1:
        return np.array([arr[0]]), np.array([arr[1]]), {}, np.array([1.0])
        
    lats = arr[:, 0]
    lons = arr[:, 1]
    intensities = arr[:, 2] if (arr.shape[1] >= 3 and intensity_col) else np.ones(len(lats), dtype=np.float64)
    return lats, lons, {}, intensities


def parse_coordinate_list_lines(data: Any, coord_order: str = "auto", **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    if not data:
        return [], {}

    # Check if single line: [[lat1, lon1], [lat2, lon2], ...]
    if isinstance(data[0], (list, tuple, np.ndarray)) and len(data[0]) >= 2 and isinstance(data[0][0], (int, float, np.number)):
        line = []
        for pt in data:
            n1, n2 = float(pt[0]), float(pt[1])
            if coord_order == "lon_lat":
                line.append([n2, n1])
            elif coord_order == "lat_lon":
                line.append([n1, n2])
            else:
                if abs(n1) > 90 and abs(n2) <= 90:
                    line.append([n2, n1])
                else:
                    line.append([n1, n2])
        return [line], {}

    # Check if list of lines: [[[lat1, lon1], ...], [[lat3, lon3], ...]]
    lines = []
    for sub in data:
        if isinstance(sub, (list, tuple, np.ndarray)) and len(sub) > 0:
            line = []
            for pt in sub:
                if len(pt) >= 2:
                    n1, n2 = float(pt[0]), float(pt[1])
                    if coord_order == "lon_lat":
                        line.append([n2, n1])
                    elif coord_order == "lat_lon":
                        line.append([n1, n2])
                    else:
                        if abs(n1) > 90 and abs(n2) <= 90:
                            line.append([n2, n1])
                        else:
                            line.append([n1, n2])
            if len(line) >= 2:
                lines.append(line)

    return lines, {}


def parse_coordinate_list_polygons(data: Any, coord_order: str = "auto", **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    if not data:
        return [], {}

    # Check if single polygon ring: [[lat1, lon1], [lat2, lon2], ...]
    if isinstance(data[0], (list, tuple, np.ndarray)) and len(data[0]) >= 2 and isinstance(data[0][0], (int, float, np.number)):
        ring = []
        for pt in data:
            n1, n2 = float(pt[0]), float(pt[1])
            if coord_order == "lon_lat":
                ring.append([n2, n1])
            elif coord_order == "lat_lon":
                ring.append([n1, n2])
            else:
                if abs(n1) > 90 and abs(n2) <= 90:
                    ring.append([n2, n1])
                else:
                    ring.append([n1, n2])
        ring = _ensure_closed_ring(ring)
        return [ring], {}

    # Check if list of polygon rings: [[[lat1, lon1], ...], [[lat3, lon3], ...]]
    polygons = []
    for sub in data:
        if isinstance(sub, (list, tuple, np.ndarray)) and len(sub) > 0:
            ring = []
            for pt in sub:
                if len(pt) >= 2:
                    n1, n2 = float(pt[0]), float(pt[1])
                    if coord_order == "lon_lat":
                        ring.append([n2, n1])
                    elif coord_order == "lat_lon":
                        ring.append([n1, n2])
                    else:
                        if abs(n1) > 90 and abs(n2) <= 90:
                            ring.append([n2, n1])
                        else:
                            ring.append([n1, n2])
            if len(ring) >= 3:
                ring = _ensure_closed_ring(ring)
                polygons.append(ring)

    return polygons, {}


def parse_dict_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import pandas as pd
    from .pandas import parse_pandas_lines
    return parse_pandas_lines(pd.DataFrame(data), **kwargs)


def parse_list_of_dicts_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import pandas as pd
    from .pandas import parse_pandas_lines
    return parse_pandas_lines(pd.DataFrame(data), **kwargs)


def parse_dict_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import pandas as pd
    from .pandas import parse_pandas_polygons
    return parse_pandas_polygons(pd.DataFrame(data), **kwargs)


def parse_list_of_dicts_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, List[Any]]]:
    import pandas as pd
    from .pandas import parse_pandas_polygons
    return parse_pandas_polygons(pd.DataFrame(data), **kwargs)
