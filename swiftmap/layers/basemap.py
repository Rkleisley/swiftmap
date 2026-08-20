from typing import List, Optional

# All network-specific basemap data -- presets, alias spellings, WMS services,
# the xyz catalogue (SERVICES, where the xyzservices work happens),
# constructor defaults -- lives in the registry module, the ONE file a
# network swaps or patches. This module is pure resolution logic over it:
# every lookup reads the registry's CURRENT attributes, so reassigning a
# value wholesale is seen, not just mutating one. The names below are
# re-exported for direct imports.
from .. import basemap_registry as _registry
from ..basemap_registry import ALIASES, BASEMAPS, SERVICES, WMS_PROVIDERS
from ._batching import batched
from .._warnings import warn


def _flatten_wms() -> dict:
    """Name and alias -> entry, lowercased. Rebuilt per lookup, deliberately:
    WMS_PROVIDERS is meant to be extended at runtime, and an import-time
    flatten would freeze out anything registered after import."""
    flat = {}
    for category in _registry.WMS_PROVIDERS.values():
        for key, entry in category.items():
            flat[key.lower()] = entry
            for alias in entry.get("aliases", []):
                flat[alias.lower()] = entry
    return flat

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
    info = _registry.BASEMAPS.get(name)
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
            provider = _registry.SERVICES.query_name(_registry.ALIASES.get(name, name))
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
    names = (set(_registry.BASEMAPS) | set(_registry.ALIASES)
             | set(_registry.SERVICES.flatten()))
    for category in _registry.WMS_PROVIDERS.values():
        names |= set(category)
    if search:
        needle = search.lower()
        names = {n for n in names if needle in n.lower()}
    return sorted(names)
