# Deploying swiftmap on your own network

swiftmap's code is network-agnostic; its *tile facts* are not. Which basemaps
exist, what they're called, which WMS services answer, and what a bare `Map()`
shows are different on every network — so all of it lives in one module,
[`swiftmap/basemap_registry.py`](swiftmap/basemap_registry.py), as plain
dictionaries. Resolution logic reads that module's **current** attributes on
every lookup (and `Map()` reads the defaults at construction), so there are two
ways to make swiftmap native to a network, and neither touches anything else.

This document describes shapes and hooks only. The actual values for a given
network — hostnames, service lists, catalogues — live on that network, not in
this repository.

## Route 1: override at startup (no fork)

Because every lookup reads live, an application can extend or replace the
registry when it boots. Do it before building maps; everything created
afterwards sees the new facts.

```python
from swiftmap import basemap_registry

# Add WMS services callable by name (extend in place, or reassign wholesale):
basemap_registry.WMS_PROVIDERS["mynet"] = {
    "Ops Imagery": {
        "url": "https://<endpoint>/wms", "layers": "0",
        "name": "Ops Imagery", "attribution": "…", "aliases": ["ops"],
    },
}

# Swap the XYZ catalogue for the network's own (see "The catalogue" below):
basemap_registry.SERVICES = basemap_registry.build_services("providers.json")

# Decide what a bare Map() shows, per CRS:
basemap_registry.DEFAULT_BASEMAPS = {
    "EPSG:3857": [("Ops Imagery", True)],
}
```

This is the recommended route: it survives swiftmap upgrades untouched, and it
composes — a shared internal module can apply the overrides for every app on
the network with one import.

## Route 2: ship a network copy of the file

For a network that distributes its own wheel (`npm run wheel` builds one),
replace `basemap_registry.py` itself in the internal distribution — or patch it
in place, if the receiving side already rewrites files on ingest. The module is
deliberately self-contained: no other file in the package holds tile data, and
`swiftmap/layers/basemap.py` is pure resolution logic over it.

## What the registry holds

| Attribute | What it is |
| --- | --- |
| `BASEMAPS` | Hand-defined XYZ presets the catalogue cannot supply. Entry keys: `url` (a `{z}/{x}/{y}` template), `attribution`, `max_zoom`, `max_native_zoom`. The public repo keeps exactly one: an EPSG:4326-tiled imagery layer, because every catalogue template is web-mercator. |
| `ALIASES` | Friendly spellings forwarded into the catalogue, names only (`"Dark Matter" → "CartoDB.DarkMatter"`). For forms the catalogue's own tolerant lookup would miss. |
| `WMS_PROVIDERS` | WMS services callable by name: `category → name → entry`, mirroring StructMap's `WmsProviders` structure so an existing registry pastes straight in. Entry keys: `url` (the endpoint, no template), `layers`, `name`, `attribution`, `aliases`; optional `format`, `version`, `transparent`, `styles`, `max_zoom`. The name/alias index is rebuilt per lookup, case-insensitively. |
| `SERVICES` | The XYZ catalogue behind bare provider names. See below. |
| `DEFAULT_BASEMAPS` | What a bare `Map()` adds, per CRS: `(name, initially_visible)` pairs resolved through `add_basemap`, so any name form above works here — including WMS entries, for a network where WMS is the primary source. A CRS with no row falls back to the `EPSG:3857` row. |

## The catalogue

`SERVICES` is an `xyzservices.Bunch`. The public build uses the bundled
catalogue (~880 providers); a network with its own builds one instead:

```python
SERVICES = build_services("providers.json")   # or a nested dict
```

`build_services` accepts a nested dict — or the path to a JSON file of the same
shape — where anything with a `"url"` is a provider and anything else nests
(categories). Providers need at least `url` and `attribution`; the result
answers `query_name`, tolerant lookup, and token warnings exactly like the
bundled catalogue, because it *is* the same machinery.

## Verifying a deployment

`Map().list_basemaps()` lists every name `add_basemap` will accept on this
install — presets, WMS registry, and catalogue together — and
`list_basemaps("imagery")` filters. An unknown name warns and adds nothing;
there is no silent fallback, so a misconfigured registry announces itself
instead of quietly serving OpenStreetMap.

## The other network-specific fact: view-time JavaScript

Leaflet, glify, and Leaflet-Geoman load from unpkg when a map (or a static
export) is *viewed*. Networks without that reach need their delivery mechanism
to rewrite or serve those URLs — the same arrangement that already covers any
web application's CDN dependencies on such a network. Tile and WMS traffic
goes wherever the registry points it, which is the point of this file.
