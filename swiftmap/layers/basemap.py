from typing import List, Optional

import xyzservices

from ._batching import batched
from .._warnings import warn

BASEMAPS = {
    "OpenStreetMap": {
        "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        "max_zoom": 22,
        "max_native_zoom": 19
    },
    "Open Street Map": {
        "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        "max_zoom": 22,
        "max_native_zoom": 19
    },
    "Dark Matter": {
        "url": "https://{s}.basemap.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "attribution": '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        "max_zoom": 22,
        "max_native_zoom": 20
    },
    "CartoDB dark_matter": {
        "url": "https://{s}.basemap.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "attribution": '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        "max_zoom": 22,
        "max_native_zoom": 20
    },
    "DarkMatter": {
        "url": "https://{s}.basemap.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "attribution": '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        "max_zoom": 22,
        "max_native_zoom": 20
    },
    "CartoDB positron": {
        "url": "https://{s}.basemap.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "attribution": '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        "max_zoom": 22,
        "max_native_zoom": 20
    },
    "Positron": {
        "url": "https://{s}.basemap.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "attribution": '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        "max_zoom": 22,
        "max_native_zoom": 20
    },
    "CartoDB.Positron": {
        "url": "https://{s}.basemap.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "attribution": '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        "max_zoom": 22,
        "max_native_zoom": 20
    },
    "Esri WGS84": {
        "url": "https://wi.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        "max_zoom": 15,
        "max_native_zoom": 15
    }
}

@batched
def add_basemap(
    self,
    name: str,
    layer_group: str = "Basemaps",
    group_multi_select: Optional[bool] = None,
    visible: bool = False,
    **kwargs
) -> "Map":
    """
    Adds a tile basemap configuration layer to the map.

    Parameters
    ----------
    name : str
        Preset basemap name ('OpenStreetMap', 'Dark Matter', 'Positron', 'Esri WGS84'),
        any provider from the xyzservices catalogue ('CartoDB.DarkMatter',
        'Esri.WorldImagery', 'OpenTopoMap', ... -- `m.list_basemaps("dark")` to
        search it), or a custom tile URL template
        (e.g. 'https://{s}.tile.../{z}/{x}/{y}.png').
    layer_group : str, default 'Basemaps'
        Folder name in sidebar controls.
    group_multi_select : bool, optional
        If False, configures the basemap group as mutually exclusive radio buttons (default for Basemaps).
    visible : bool, default False
        Initial visibility state of the basemap.
    **kwargs
        Custom tile attributes (attribution, max_zoom, max_native_zoom). For
        providers that take an access token, pass it under the keyword the
        provider names (usually accessToken= or apiKey=).

    Returns
    -------
    Map
        Self reference for method chaining.

    Examples
    --------
    >>> m = Map()
    >>> m.add_basemap("Dark Matter", visible=True)
    >>> m.add_basemap("Esri.WorldImagery")
    >>> m.add_basemap("Jawg.Streets", accessToken="...")
    """
    subdomains = None
    info = BASEMAPS.get(name)
    if info:
        url = info["url"]
        attribution = info.get("attribution", "")
        max_zoom = info.get("max_zoom", 22)
        max_native_zoom = info.get("max_native_zoom", 19)
    elif name.startswith("http://") or name.startswith("https://") or "{" in name:
        # A raw tile URL template is its own definition.
        url = name
        attribution = kwargs.pop("attribution", "")
        max_zoom = kwargs.pop("max_zoom", 22)
        max_native_zoom = kwargs.pop("max_native_zoom", 19)
    else:
        # Every provider xyzservices catalogues, callable by name. query_name is
        # deliberately tolerant -- "CartoDB.DarkMatter", "CartoDB DarkMatter" and
        # "cartodb darkmatter" all resolve.
        try:
            provider = xyzservices.providers.query_name(name)
        except ValueError:
            # It used to silently substitute OpenStreetMap here -- asked for X,
            # quietly shown Y, the radius disease with tiles. Say so instead.
            warn(f"add_basemap: no basemap named {name!r} -- not a preset, not an "
                 f"xyzservices provider, not a tile URL. Try "
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
        **kwargs
    })
    return self


def list_basemaps(self, search: Optional[str] = None) -> List[str]:
    """
    Names `add_basemap` accepts: the presets plus every xyzservices provider.

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
    names = set(BASEMAPS) | set(xyzservices.providers.flatten())
    if search:
        needle = search.lower()
        names = {n for n in names if needle in n.lower()}
    return sorted(names)
