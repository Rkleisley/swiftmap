from typing import Optional

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

def add_basemap(self, name: str, layer_group: str = "Basemaps", group_multi_select: Optional[bool] = None, visible: bool = False, **kwargs):
    """Adds a basemap configuration layer with URL metadata resolved in Python."""
    info = BASEMAPS.get(name)
    if info:
        url = info["url"]
        attribution = info.get("attribution", "")
        max_zoom = info.get("max_zoom", 22)
        max_native_zoom = info.get("max_native_zoom", 19)
    else:
        # Fallback/raw URL support
        if name.startswith("http://") or name.startswith("https://") or "{" in name:
            url = name
        else:
            # Fallback to OpenStreetMap
            url = BASEMAPS["OpenStreetMap"]["url"]
            
        attribution = kwargs.get("attribution", '&copy; OpenStreetMap')
        max_zoom = kwargs.get("max_zoom", 22)
        max_native_zoom = kwargs.get("max_native_zoom", 19)

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
        **kwargs
    })
    return self
