"""
The network's basemap registry -- the ONE file to swap when swiftmap moves.

Everything network-specific about basemaps lives here as plain dictionaries:
which presets exist, which friendly spellings forward where, which WMS services
are callable by name, and what a bare Map() shows. swiftmap/layers/basemap.py
ingests this module and holds no tile data of its own, so a different network
ships a different copy of THIS file (or patches it in place) and the rest of
the package never changes. Even the xyz catalogue lives here: xyzservices is
imported and worked into SERVICES below, and name resolution imports SERVICES
from this module -- a network with its own catalogue rebuilds that one line.

Every value here is read live -- extend the dictionaries in place or reassign
them wholesale after import, both are seen by the next lookup.
"""
import json
from pathlib import Path
from typing import Optional, Union

import xyzservices


def _build_bunch(data: dict, prefix: str = "") -> "xyzservices.Bunch":
    """A nested dict of providers -> a real xyzservices Bunch, so a custom
    catalogue answers query_name/flatten/build_url exactly like the bundled
    one. A dict with a "url" is a provider; anything else nests. "name"
    defaults to the dotted path, the catalogue's own convention."""
    out = {}
    for key, value in data.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict) and "url" in value:
            provider = dict(value)
            provider.setdefault("name", path)
            out[key] = xyzservices.TileProvider(provider)
        elif isinstance(value, dict):
            out[key] = _build_bunch(value, prefix=f"{path}.")
        else:
            out[key] = value
    return xyzservices.Bunch(out)


def build_services(source: Optional[Union[str, Path, dict]] = None) -> "xyzservices.Bunch":
    """
    The xyz catalogue SERVICES is built from.

    None returns the xyzservices package's bundled public catalogue (878
    providers). A nested dict, or the path to a providers JSON file of the
    same shape -- categories of entries, each entry at least {url,
    attribution} -- builds the network's own catalogue instead, with full
    query_name/flatten/token behaviour.
    """
    if source is None:
        return xyzservices.providers
    if isinstance(source, (str, Path)):
        source = json.loads(Path(source).read_text(encoding="utf-8"))
    return _build_bunch(source)

# Hand-defined tile basemaps the catalogue cannot supply. Currently one: Esri
# World Imagery tiled for EPSG:4326. Every xyzservices template is web-mercator
# XYZ, and the 4326 map default needs the WGS84 tiling scheme.
# Entry keys: url (a {z}/{x}/{y} template), attribution, max_zoom, max_native_zoom.
BASEMAPS = {
    "Esri WGS84": {
        "url": "https://wi.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        "max_zoom": 15,
        "max_native_zoom": 15
    }
}

# Historical preset spellings, forwarded into the xyzservices catalogue. Names
# only -- the tile definitions live in xyzservices, and query_name would miss
# these forms ("Dark Matter" does not normalise to "cartodbdarkmatter").
ALIASES = {
    "OpenStreetMap": "OpenStreetMap.Mapnik",
    "Open Street Map": "OpenStreetMap.Mapnik",
    "Dark Matter": "CartoDB.DarkMatter",
    "DarkMatter": "CartoDB.DarkMatter",
    "CartoDB dark_matter": "CartoDB.DarkMatter",
    "Positron": "CartoDB.Positron",
    "CartoDB positron": "CartoDB.Positron",
}

# WMS services callable by name, mirroring StructMap's WmsProviders structure
# (category -> name -> entry) so a network's registry pastes straight in.
# Entry keys: url (the WMS endpoint, no {z}/{x}/{y}), layers, name, attribution,
# aliases; optional format, version, transparent, styles, max_zoom.
WMS_PROVIDERS = {
    "usgs": {
        "USGS Imagery": {
            "url": "https://basemap.nationalmap.gov/arcgis/services/USGSImageryOnly/MapServer/WmsServer",
            "layers": "0",
            "name": "USGS Imagery",
            "attribution": "USGS The National Map",
            "aliases": ["usgs imagery wms"],
        },
        "USGS Topo": {
            "url": "https://basemap.nationalmap.gov/arcgis/services/USGSTopo/MapServer/WmsServer",
            "layers": "0",
            "name": "USGS Topo",
            "attribution": "USGS The National Map",
            "aliases": ["usgs topo wms"],
        },
    },
}

# The xyz tile catalogue behind bare provider names ("CartoDB.DarkMatter",
# "Esri.WorldImagery", ...). This network uses the bundled public catalogue;
# a network with its own rewrites this line, e.g.
#   SERVICES = build_services("/path/to/providers.json")
SERVICES = build_services()

# What a bare Map() adds, per CRS: (name, initially_visible) pairs resolved
# through add_basemap, so any name form above works here -- including WMS
# entries on a network where those are the primary source. A CRS with no row
# falls back to the EPSG:3857 row.
DEFAULT_BASEMAPS = {
    "EPSG:3857": [("Open Street Map", True), ("Dark Matter", False)],
    "EPSG:4326": [("Esri WGS84", True)],
}

# Fixed branding for every map on this network, applied by Map() through
# configure_logo -- the same keywords: company, parent_company (URL, data URI or
# local file path), position, height, show. None ships no branding; an app can
# still call configure_logo to change or clear it.
DEFAULT_LOGO = None
