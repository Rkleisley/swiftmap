# swiftmap examples

One notebook per topic, simple at the top and deeper as it goes. Every dataset is
generated in-cell — nothing to download, every notebook runs top-to-bottom on its
own. Numbered order is a reading journey for newcomers; each notebook also stands
alone for anyone arriving with a task.

| Notebook | What it shows | Key calls |
| --- | --- | --- |
| [01_quickstart](01_quickstart.ipynb) | DataFrame → map → color/size by value → sidebar folders → popups → export | `add_circle_markers`, `color_col`, `radius_col`, `layer_group`, `save` |
| [02_data_sources](02_data_sources.ipynb) | Every input format, one section each: Pandas, Polars, long/wide tables, WKT columns, GeoPandas, geostructures, GeoJSON, raw lists | every `add_*`, `line_id_col`/`shape_id_col`, `coord_order`, `add_collection` |
| [03_styling](03_styling.ipynb) | Layer options → per-feature `style` column → precedence → colormaps, bins, categorical, bubbles | `fill_color`, `static_style`, `color_col`, `color_bins`, `radius_col` |
| [04_sidebar_groups](04_sidebar_groups.ipynb) | Folder trees from strings and from columns, radio groups, custom basemaps, collection merging | `layer_group`, `configure_group`, `add_basemap`, `add_collection` |
| [05_layer_control](05_layer_control.ipynb) | The targeting vocabulary: find, hide/show, select, highlight, per-feature overrides, batch, remove | `find_layers`, `select`, `highlight`, `set_feature_styles`, `batch` |
| [06_time](06_time.ipynb) | Animating timestamps the data already carries: periods, durations, fade, playback, both-ways sync | `make_time_layer`, `configure_time`, `time_current`, `clear_time_layer` |
| [07_popups_tooltips](07_popups_tooltips.ipynb) | Narrowing, relabeling, templates, container styling, constant fields, permanent labels, the escaping story | `popup_fields`/`_names`/`_template`, `tooltip_style`, `popup=dict`, `label=` |
| [08_export](08_export.ipynb) | One self-contained file, what works client-side, sizes, the Streamlit one-liner | `save`, `to_html` |
| [09_showcase](09_showcase.ipynb) | The capstone: sensors, marching tracks, lapsing dwells, labels, legend, a selection moment, shipped as one file | everything above, together |
| [10_ipywidgets](10_ipywidgets.ipynb) | Notebook-native reactivity: `observe`, `interact`, map traits driving widgets, layout, sizing — plus an honest findings section | `observe`, `batch`, `click_seq`, `time_current`, `height` |
| [11_legend](11_legend.ipynb) | The auto-derived legend: ramps/bins/categories/size rows, scope and dimming, manual entries, persistent suppression, full takeover | `configure_legend`, `legend_add`, `legend_remove`, `legend_clear` |

## Shiny apps

Apps cannot be notebooks; these run with `shiny run <file>` from `shiny/`:

| App | What it shows |
| --- | --- |
| [shiny/01_basic_app.py](shiny/01_basic_app.py) | The build-once rule, `map_effect`, and a select-driven filter |
| [shiny/02_linked_table.py](shiny/02_linked_table.py) | Table ↔ map both ways: row selection drives `select()`, clicks report back via `clicked_layer_id` |

## Conventions

- Notebooks are committed with outputs stripped; run them to see the maps.
- `python scripts/run_examples.py` (from the repo root) executes every code cell
  of every notebook as a smoke test — each notebook doubles as a regression check
  on the API surface it demonstrates.
- The quickstart and export notebooks write `*.html` files next to themselves
  when run — generated output, gitignored, not part of the repo.
