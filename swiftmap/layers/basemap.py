from typing import List, Optional

import xyzservices

from ._batching import batched
from .._warnings import warn

# The one basemap the catalogue cannot supply: Esri World Imagery tiled for
# EPSG:4326. Every xyzservices template is web-mercator XYZ, and the 4326 map
# default needs the WGS84 tiling scheme.
BASEMAPS = {
    "Esri WGS84": {
        "url": "https://wi.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        "max_zoom": 15,
        "max_native_zoom": 15
    }
}

# WMS services callable by name, mirroring StructMap's WmsProviders structure
# (category -> name -> entry) so a network's registry pastes straight in --
# xyz is the primary source on this network, WMS on the other, and both work
# everywhere. Extend at runtime: WMS_PROVIDERS["cat"]["Name"] = {...}.
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


def _flatten_wms() -> dict:
    """Name and alias -> entry, lowercased. Rebuilt per lookup, deliberately:
    WMS_PROVIDERS is meant to be extended at runtime, and an import-time
    flatten would freeze out anything registered after import."""
    flat = {}
    for category in WMS_PROVIDERS.values():
        for key, entry in category.items():
            flat[key.lower()] = entry
            for alias in entry.get("aliases", []):
                flat[alias.lower()] = entry
    return flat


# Historical preset spellings, forwarded into the catalogue. Names only -- the
# tile definitions live in xyzservices, and query_name would miss these forms
# ("Dark Matter" does not normalise to "cartodbdarkmatter").
_ALIASES = {
    "OpenStreetMap": "OpenStreetMap.Mapnik",
    "Open Street Map": "OpenStreetMap.Mapnik",
    "Dark Matter": "CartoDB.DarkMatter",
    "DarkMatter": "CartoDB.DarkMatter",
    "CartoDB dark_matter": "CartoDB.DarkMatter",
    "Positron": "CartoDB.Positron",
    "CartoDB positron": "CartoDB.Positron",
}

@batched
def add_basemap(
    self,
    name: str,
    layer_group: str = "Basemaps",
    group_multi_select: Optional[bool] = None,
    visible: bool = False,
    wms_layers: Optional[str] = None,
    **kwargs
) -> "Map":
    """
    Adds a tile or WMS basemap configuration layer to the map.

    Parameters
    ----------
    name : str
        Any provider from the xyzservices catalogue ('CartoDB.DarkMatter',
        'Esri.WorldImagery', 'OpenTopoMap', ... -- `m.list_basemaps("dark")` to
        search it), a WMS service from WMS_PROVIDERS by name or alias
        (case-insensitive), a custom tile URL template
        (e.g. 'https://{s}.tile.../{z}/{x}/{y}.png'), a WMS endpoint URL
        (with wms_layers=), or 'Esri WGS84' for the EPSG:4326 imagery default.
        Historical spellings ('Dark Matter', 'Positron', 'Open Street Map')
        forward to their catalogue providers.
    layer_group : str, default 'Basemaps'
        Folder name in sidebar controls.
    group_multi_select : bool, optional
        If False, configures the basemap group as mutually exclusive radio buttons (default for Basemaps).
    visible : bool, default False
        Initial visibility state of the basemap.
    wms_layers : str, optional
        With a URL name, treat it as a WMS endpoint and request these layers
        (comma-separated layer ids). Ignored for registry and catalogue names.
    **kwargs
        Custom tile attributes (attribution, max_zoom, max_native_zoom). For
        providers that take an access token, pass it under the keyword the
        provider names (usually accessToken= or apiKey=). For URL-form WMS:
        wms_format, wms_version, wms_transparent.

    Returns
    -------
    Map
        Self reference for method chaining.

    Examples
    --------
    >>> m = Map()
    >>> m.add_basemap("Dark Matter", visible=True)
    >>> m.add_basemap("Esri.WorldImagery")
    >>> m.add_basemap("USGS Imagery")
    >>> m.add_basemap("https://host/service/WmsServer", wms_layers="0")
    """
    subdomains = None
    wms = None
    info = BASEMAPS.get(name)
    wms_entry = None if info else _flatten_wms().get(name.lower())
    if info:
        url = info["url"]
        attribution = info.get("attribution", "")
        max_zoom = info.get("max_zoom", 22)
        max_native_zoom = info.get("max_native_zoom", 19)
    elif wms_entry is not None:
        url = wms_entry["url"]
        name = wms_entry.get("name", name)  # aliases display the canonical name
        attribution = wms_entry.get("attribution", "")
        max_zoom = wms_entry.get("max_zoom", 22)
        # A WMS server renders at any zoom; never upscale below the ceiling.
        max_native_zoom = wms_entry.get("max_native_zoom", max_zoom)
        wms = {"layers": wms_entry["layers"],
               "format": wms_entry.get("format", "image/png"),
               "version": wms_entry.get("version", "1.1.1"),
               "transparent": wms_entry.get("transparent", False)}
        if wms_entry.get("styles"):
            wms["styles"] = wms_entry["styles"]
    elif name.startswith("http://") or name.startswith("https://") or "{" in name:
        # A raw URL is its own definition: a tile template as-is, or a WMS
        # endpoint when wms_layers says which layers to request.
        url = name
        attribution = kwargs.pop("attribution", "")
        max_zoom = kwargs.pop("max_zoom", 22)
        max_native_zoom = kwargs.pop("max_native_zoom", max_zoom if wms_layers else 19)
        if wms_layers:
            wms = {"layers": wms_layers,
                   "format": kwargs.pop("wms_format", "image/png"),
                   "version": kwargs.pop("wms_version", "1.1.1"),
                   "transparent": kwargs.pop("wms_transparent", False)}
    else:
        # Every provider xyzservices catalogues, callable by name. query_name is
        # deliberately tolerant -- "CartoDB.DarkMatter", "CartoDB DarkMatter" and
        # "cartodb darkmatter" all resolve.
        try:
            provider = xyzservices.providers.query_name(_ALIASES.get(name, name))
        except ValueError:
            # It used to silently substitute OpenStreetMap here -- asked for X,
            # quietly shown Y, the radius disease with tiles. Say so instead.
            warn(f"add_basemap: no basemap named {name!r} -- not a preset, not a "
                 f"WMS_PROVIDERS entry, not an xyzservices provider, not a tile "
                 f"URL. Try "
                 f"m.list_basemaps({name.split('.')[0]!r}) to search the catalogue. "
                 f"No basemap was added.")
            return self
        # Placeholders the provider's template names (accessToken, apiKey,
        # variant, ...) come out of kwargs; {s}/{z}/{x}/{y} stay for Leaflet.
        fills = {key: kwargs.pop(key) for key in list(kwargs)
                 if f"{{{key}}}" in provider["url"]}
        try:
            url = provider.build_url(fill_subdomain=False, **fills)
        except ValueError:
            # build_url raises when a required token placeholder went unfilled.
            missing = [key for key, value in provider.items()
                       if isinstance(value, str) and value.startswith("<")]
            warn(f"add_basemap: {name!r} requires an access token -- pass "
                 f"{', '.join(f'{key}=...' for key in missing) or 'the token keyword'} "
                 f"to add_basemap. No basemap was added.")
            return self
        attribution = provider.get("html_attribution") or provider.get("attribution", "")
        max_native_zoom = provider.get("max_zoom", 19)
        max_zoom = max(22, max_native_zoom)
        subdomains = provider.get("subdomains")

    self.add_child({
        "type": "basemap",
        "name": name,
        "layer_group": layer_group,
        "group_multi_select": group_multi_select,
        "visible": visible,
        "url": url,
        "attribution": attribution,
        "max_zoom": max_zoom,
        "max_native_zoom": max_native_zoom,
        **({"subdomains": subdomains} if subdomains else {}),
        **({"wms": wms} if wms else {}),
        **kwargs
    })
    return self


def list_basemaps(self, search: Optional[str] = None) -> List[str]:
    """
    Names `add_basemap` accepts: the presets, the WMS_PROVIDERS registry, and
    every xyzservices provider.

    Parameters
    ----------
    search : str, optional
        Case-insensitive substring filter -- `m.list_basemaps("dark")`.

    Returns
    -------
    list of str
        Sorted names. Providers that need an access token are listed too; adding
        one without its token warns and names the keyword to pass.

    Examples
    --------
    >>> m.list_basemaps("esri")[:3]
    ['Esri.AntarcticBasemap', 'Esri.AntarcticImagery', 'Esri.ArcticImagery']
    """
    names = set(BASEMAPS) | set(_ALIASES) | set(xyzservices.providers.flatten())
    for category in WMS_PROVIDERS.values():
        names |= set(category)
    if search:
        needle = search.lower()
        names = {n for n in names if needle in n.lower()}
    return sorted(names)
