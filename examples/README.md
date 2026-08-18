# swiftmap examples

One notebook per topic, simple at the top and deeper as it goes. Every dataset is
generated in-cell — nothing to download, every notebook runs top-to-bottom on its
own. Numbered order is a reading journey for newcomers; each notebook also stands
alone for anyone arriving with a task.

| Notebook | What it shows | Key calls |
| --- | --- | --- |
| [01_quickstart](01_quickstart.ipynb) | DataFrame → map → color/size by value → sidebar folders → popups → export | `add_circle_markers`, `color_col`, `radius_col`, `layer_group`, `save` |
| [02_data_sources](02_data_sources.ipynb) | Every input format, one section each: Pandas, Polars, long/wide tables, WKT columns, GeoPandas, geostructures, GeoJSON, raw lists | every `add_*`, `line_id_col`/`shape_id_col`, `coord_order`, `add_collection` |

## Planned

As the gallery grows, each of these gets its own notebook: styling in depth,
sidebar hierarchies and groups, layer targeting (`hide`/`show`/`select`/
`highlight`), time animation, popups and tooltips, static export, and a capstone
showcase combining everything. Shiny apps live in a `shiny/` subdirectory as
runnable `app.py` files, since apps cannot be notebooks. A notebook on notebook-native
reactivity (ipywidgets alongside swiftmap, the way `map_effect` serves Shiny) is
under consideration.

## Conventions

- Notebooks are committed with outputs stripped; run them to see the maps.
- The quickstart's export step writes `quickstart_map.html` next to the notebook —
  it is generated output, not part of the repo.
