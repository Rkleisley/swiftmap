"""
read_wfs: an OGC WFS layer in, an ordinary table out. The bridge, not a client.

The read_mvt pattern, feature-service edition: fetch once, parse, hand back
rows whose `geometry` column is WKT in lon/lat -- the front door the parsers
already read. Painting it is `add_polygon(df, color_col=...)` (or add_line /
add_circle_markers / add_collection for mixed layers) with everything add_*
already does. This module and mvt.py are where swiftmap's fetching lives, by
decision rather than accident: the read_* functions fetch, the add_* methods
never do.

The trap this bridge exists to refuse: WFS servers cap GetFeature at a
per-request feature limit (GeoServer admins commonly set it low), and a naive
single fetch silently returns a truncated layer -- the silent-wrong-data
class. read_wfs pages with WFS 2.0 startIndex/count until the server says the
layer is complete, and raises rather than quietly stopping when a layer is
larger than `max_features`.
"""
import gzip
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Union

# One page per request; the server may return fewer (its own cap), and the
# paging loop keeps going until the layer is actually complete.
PAGE_SIZE = 10_000


def _fetch(url: str, headers: Optional[Dict[str, str]]) -> bytes:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data


def _service_url(url: str, updates: Dict[str, str]) -> str:
    """The endpoint with query parameters merged in; the caller's survive
    unless a WFS-required key overrides them, and `params=` overrides ours."""
    parts = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    lowered = {k.lower(): k for k in query}
    for key, value in updates.items():
        existing = lowered.get(key.lower())
        if existing is not None and existing != key:
            del query[existing]
        query[key] = value
    return urllib.parse.urlunsplit(parts._replace(
        query=urllib.parse.urlencode(query)))


def _exception_text(text: str) -> Optional[str]:
    """The message inside an OGC exception report, or None if this is not one.

    WFS servers answer bad requests with HTTP 200 and an XML report; handing
    that to json.loads would blame the wrong thing.
    """
    if not text.lstrip().startswith("<"):
        return None
    for pattern in (r"<(?:\w+:)?ExceptionText>(.*?)</(?:\w+:)?ExceptionText>",
                    r"<(?:\w+:)?ServiceException[^>]*>(.*?)</(?:\w+:)?ServiceException>"):
        match = re.search(pattern, text, re.S)
        if match:
            return " ".join(match.group(1).split())
    return "the server returned XML, not GeoJSON (an exception report or GML)"


def _capability_names(url: str, headers) -> List[str]:
    """The endpoint's feature type names, best effort, for a helpful error."""
    try:
        data = _fetch(_service_url(url, {"service": "WFS",
                                         "request": "GetCapabilities"}), headers)
        root = ET.fromstring(data)
        names = []
        for el in root.iter():
            tag = el.tag if isinstance(el.tag, str) else ""
            ns, _, local = tag.rpartition("}")
            # FeatureType names, whatever namespace (or none) the server used;
            # ows:* Name elements are service metadata, not layers.
            if local == "Name" and "/ows" not in ns and el.text:
                names.append(el.text.strip())
        return sorted(set(names))[:40]
    except Exception:
        return []


def _coords_wkt(coords) -> str:
    return ", ".join(f"{float(pt[0]):.7f} {float(pt[1]):.7f}" for pt in coords)


def _geometry_wkt(geometry: Optional[Dict[str, Any]]) -> Optional[str]:
    """One GeoJSON geometry as WKT (lon/lat, as GeoJSON already is)."""
    if not geometry or "type" not in geometry:
        return None
    gtype = geometry["type"]
    coords = geometry.get("coordinates")
    if gtype == "Point":
        return f"POINT ({_coords_wkt([coords])})"
    if gtype == "MultiPoint":
        return "MULTIPOINT (" + ", ".join(
            f"({_coords_wkt([pt])})" for pt in coords) + ")"
    if gtype == "LineString":
        return f"LINESTRING ({_coords_wkt(coords)})"
    if gtype == "MultiLineString":
        return "MULTILINESTRING (" + ", ".join(
            f"({_coords_wkt(line)})" for line in coords) + ")"
    if gtype == "Polygon":
        return "POLYGON (" + ", ".join(
            f"({_coords_wkt(ring)})" for ring in coords) + ")"
    if gtype == "MultiPolygon":
        return "MULTIPOLYGON (" + ", ".join(
            "(" + ", ".join(f"({_coords_wkt(ring)})" for ring in rings) + ")"
            for rings in coords) + ")"
    return None


def read_wfs(url: str, layer: Optional[Union[str, List[str]]] = None,
             bounds=None, max_features: int = 100_000,
             headers: Optional[Dict[str, str]] = None,
             params: Optional[Dict[str, str]] = None):
    """
    Reads a WFS feature layer into a table, complete or not at all.

    Zero dependencies: fetching is the standard library, the response is the
    server's own GeoJSON. Requests are WFS 2.0 (GeoServer's native dialect --
    the standard OGC stack on closed networks) and PAGE with startIndex/count,
    because servers cap a single GetFeature at an admin-set feature limit and
    a naive fetch silently returns a truncated layer. read_wfs keeps paging
    until the server says the layer is complete, and raises -- rather than
    quietly stopping -- when the layer exceeds `max_features`.

    Parameters
    ----------
    url : str
        The WFS endpoint ("https://host/geoserver/wfs"). Query parameters
        already on it survive; an API key in the URL keeps working.
    layer : str or list of str
        The feature type to fetch (WFS `typeNames`, e.g. "topp:states").
        Omitted, the endpoint is asked for its capabilities and the available
        names are raised in the error -- the closed-network "what is on this
        server" question, answered by the message.
    bounds : [[lat_min, lon_min], [lat_max, lon_max]], optional
        Spatial filter, the shape bounds_of returns. Sent axis-correctly for
        WFS 2.0 (urn CRS, latitude first).
    max_features : int, default 100_000
        The completeness guarantee's ceiling. A layer larger than this raises
        with guidance instead of returning part of it.
    headers : dict, optional
        Extra HTTP headers (an auth token's home).
    params : dict, optional
        Extra query parameters, overriding the defaults this function sends
        (e.g. {"srsName": ...} or a vendor option).

    Returns
    -------
    A pandas DataFrame when pandas is installed, else a dict of columns:
    `geometry` (WKT, lon/lat), `wfs_layer`, `wfs_id` (when the server sends
    feature ids), and every feature property.
    """
    if not isinstance(max_features, int) or max_features <= 0:
        raise ValueError(f"read_wfs max_features must be a positive integer, "
                         f"got {max_features!r}.")
    if layer is None:
        names = _capability_names(url, headers)
        listing = ", ".join(names) if names else "could not be read"
        raise ValueError(f"read_wfs needs layer= naming a feature type. "
                         f"This endpoint offers: {listing}.")
    type_names = ",".join(layer) if isinstance(layer, (list, tuple)) else str(layer)

    base: Dict[str, str] = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": type_names,
        "outputFormat": "application/json",
        "srsName": "urn:ogc:def:crs:EPSG::4326",
    }
    if bounds is not None:
        (lat_min, lon_min), (lat_max, lon_max) = bounds
        lat_min, lat_max = sorted((float(lat_min), float(lat_max)))
        lon_min, lon_max = sorted((float(lon_min), float(lon_max)))
        base["bbox"] = (f"{lat_min},{lon_min},{lat_max},{lon_max},"
                        f"urn:ogc:def:crs:EPSG::4326")
    if params:
        base.update({str(k): str(v) for k, v in params.items()})

    features: List[Dict[str, Any]] = []
    start = 0
    matched: Optional[int] = None
    while True:
        page_url = _service_url(url, {**base,
                                      "count": str(PAGE_SIZE),
                                      "startIndex": str(start)})
        text = _fetch(page_url, headers).decode("utf-8", errors="replace")
        problem = _exception_text(text)
        if problem is not None:
            raise ValueError(f"read_wfs: the server declined the request: "
                             f"{problem}")
        page = json.loads(text)
        got = page.get("features") or []
        features.extend(got)
        raw_matched = page.get("numberMatched")
        if isinstance(raw_matched, int):
            matched = raw_matched
        total = matched if matched is not None else len(features)
        if total > max_features:
            raise ValueError(
                f"read_wfs: '{type_names}' holds {total} features "
                f"(max_features {max_features}). Narrow with bounds= or raise "
                f"max_features= -- a partial layer is never returned silently.")
        if not got:
            break
        if matched is not None and len(features) >= matched:
            break
        # No numberMatched (a pre-2.0 or terse server): a short page could be
        # the end OR the server's own cap, so only an EMPTY page proves done.
        start += len(got)

    rows: List[Dict[str, Any]] = []
    for feature in features:
        wkt = _geometry_wkt(feature.get("geometry"))
        if wkt is None:
            continue
        fid = feature.get("id")
        row: Dict[str, Any] = {"geometry": wkt}
        if isinstance(fid, str) and "." in fid:
            row["wfs_layer"] = fid.rsplit(".", 1)[0]
        else:
            row["wfs_layer"] = type_names
        if fid is not None:
            row["wfs_id"] = fid
        for k, v in (feature.get("properties") or {}).items():
            row[k] = v
        rows.append(row)

    columns = list(dict.fromkeys(k for row in rows for k in row))
    table = {c: [row.get(c) for row in rows] for c in columns} if rows \
        else {"geometry": [], "wfs_layer": []}
    try:
        import pandas as pd
        return pd.DataFrame(table)
    except ImportError:
        return table
