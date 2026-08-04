# swiftmap

`swiftmap` is a high-performance Python mapping library built on top of `anywidget` and Leaflet JS, optimized for interactive data visualization in **Shiny for Python**.

It replaces standard Leaflet vector drawing layers with custom **WebGL rendering pipelines**, allowing the map to render millions of data points, complex polylines, and shapes smoothly at 60 FPS.

---

## Key Features

### 1. High-Performance WebGL Pipelines
*   **Hardware Acceleration:** Overlays (markers, circle markers, polylines, polygons, circles, and GeoJSON shapes) are rendered via WebGL using a customized integration of `Leaflet.glify`.
*   **Custom Shaders:** Markers use custom GLSL shaders (e.g., a hardware-rendered, anti-aliased pin icon shader with drop-shadow overlays) to ensure beautiful rendering at scale.

### 2. Nested Sidebar Control & Hierarchical Visibility
*   **Arbitrary Folder Pathing:** Organizes map layers into infinite directory paths (e.g., `layer_group=["Sensor Feeds", category_col, "Active"]`) which are resolved automatically into nested tree-views in the sidebar.
*   **Group Radio Toggle Support:** Configure specific group paths to display radio buttons instead of checkboxes (e.g., for mutually exclusive basemaps or specific overlay groups).
*   **Propagated Visibility:** Toggling a folder checkbox automatically turns its nested child layers on and off, with parent visibility states cleanly inherited by WebGL draw passes.

### 3. Top-Down Event Coordination
*   **Overlapping Priority Picker:** If a marker, polyline, and polygon overlap, mouse clicks and hover events are resolved through a top-down priority transaction queue (Points > Lines > Polygons), ensuring only the topmost layer triggers event callbacks.
*   **Strict Distance Thresholds:** Uses precise pixel-distance picking thresholds (25px for markers, 12px for circle markers) to eliminate ghost picks or misfires on empty map space.

### 4. Interactive State Synchronization
*   **Bidirectional Sync:** Automatically tracks and updates map center, zoom level, layer visibilities, and selection events (`clicked_layer_id` and `selected_index`) reactively to Python/Shiny.
*   **Automatic Data Buffering:** Point/shape coordinates are converted to optimized binary buffers on the Python side for fast serialization to the client widget.

---

## Installation

```bash
pip install -e .
```

The bundled JavaScript ships with the package, so installing never requires Node. If you
intend to modify the frontend, see [CONTRIBUTING.md](CONTRIBUTING.md) — the JS lives in
`src/` and must be rebuilt after changes.

---

## Quick Example

```python
import polars as pl
from shiny import App, ui
from shinywidgets import output_widget, render_widget
from swiftmap import Map

app_ui = ui.page_fluid(
    ui.h2("Swiftmap WebGL Plot"),
    output_widget("map_widget")
)

def server(input, output, session):
    @render_widget
    def map_widget():
        # Instantiate map
        m = Map(center=[36.0, -5.35], zoom=10)
        
        # Load sample coordinates
        df = pl.DataFrame({
            "lat": [36.01, 36.02, 36.03],
            "lon": [-5.36, -5.35, -5.34],
            "name": ["Point A", "Point B", "Point C"],
            "value": [12.4, 8.2, 15.1],
            "status": ["Active", "Inactive", "Active"]
        })
        
        # Plot with automatic path grouping
        m.add_markers(
            data=df,
            lat_col="lat",
            lon_col="lon",
            name="name",
            layer_group=["Points", "status"],
            color="blue"
        )
        
        # Set mutually exclusive radio buttons for the status sub-folders
        m.group_configs = {
            "Points/Active": {"multi_select": False},
            "Points/Inactive": {"multi_select": False}
        }
        
        return m

app = App(app_ui, server)
```

---

## Core API

Beyond `add_markers`, `Map` exposes:

*   **Layers:** `add_line` / `add_polyline`, `add_polygon` / `add_polygons` / `add_shape` / `add_shapes`, `add_circle`, `add_circle_markers`, `add_basemap` — each accepts the same range of input formats as `add_markers` (Pandas, Polars, GeoPandas, GeoStructures, GeoJSON, or raw dicts/lists/coordinates).
*   **Mixed collections:** `add_collection(data)` plots every geometry kind in one dataset — a GeoJSON `FeatureCollection`, a geostructures collection, a GeoDataFrame, or a DataFrame with a WKT geometry column — adding one layer per kind, merged under a single sidebar entry. `add_geojson` and `add_geostructures` are aliases. `name` and `layer_group` accept property keys, so `name="site", layer_group=["Sites", "zone"]` names each geometry from its own data and files it under its own folder. Points render as circle markers; pass `point_type="markers"` for pins. A table of plain lat/lon columns is one geometry kind by construction; passing one warns and adds nothing, pointing you at the specific method.
*   **Sidebar groups:** `configure_group(name, multi_select=False, visible=True, collapsed=False)` — control radio-vs-checkbox behavior, default visibility, and collapsed state for a folder path.
*   **Finding layers:** `get_layer(id_or_name)` or `get_layer(group, name)` — returns the live layer config, so attributes you set on it persist.
*   **Updating existing layers:** `update_layer(id_or_name, **kwargs)`, `set_layer_visibility` / `set_layers_visibility`, `remove_layer` / `remove_layers`. `add_layer(layer)` is a Leaflet-compatible alias for adding a prebuilt config.
*   **Viewport:** `fit_bounds([[min_lat, min_lon], [max_lat, max_lon]])`.
*   **Legend:** `legend_html` returns markup for the active layers when `show_legend=True`. It is not drawn on the map — render it wherever your layout wants it.
*   **Syncing:** `sync()` pushes a render when `auto_sync=False`; `resync()` replaces the client's entire state, useful if a view may have missed updates.
*   **Batching:** `with m.batch(): ...` collapses multiple mutations into one message. Every `add_*` already batches internally, so this is for grouping several calls; it is reentrant, so nesting is safe.

Full parameter documentation lives in each method's docstring (e.g. `help(Map.add_markers)`).

---

## Styling

Every `add_*` method takes the same styling options as keyword arguments — `color`,
`fill_color`, `fill_opacity`, `weight`, `opacity`, and `radius` where it applies. Leaflet's
camelCase spellings (`fillColor`, `fillOpacity`) work too:

```python
m.add_polygon(zones, color="crimson", fill_opacity=0.4, weight=2)
```

**Style from your data.** A `style` property or column is applied per feature, so one
DataFrame can carry its own appearance — sort your rows, add a column, and every layer
type picks it up:

```python
df["style"] = df["kind"].map({"city": "red", "town": "blue"})
m.add_markers(df)                    # each point takes its own colour
```

The value is a colour string or a dict of options:

```python
df["style"] = [{"color": "red", "weight": 5}, {"color": "blue"}, ...]
```

**Overriding.** Precedence runs `static_style` → explicit keyword → `style` column →
defaults. So `static_style` forces one appearance for the whole layer regardless of the
data, while a plain keyword still beats the column:

```python
m.add_markers(df, static_style={"color": "grey"})   # ignores the style column
m.add_markers(df, color="purple")                   # also wins over the column
```

A style column holding one value everywhere collapses to a plain layer style, so uniform
data costs nothing extra.

Misspelled options are reported rather than silently ignored — `colour="red"` warns and
suggests `color`, while unrecognised keys that match nothing (`title`, `draggable`) are
passed through to the layer untouched.

---

## Popups & Tooltips

By default every property is listed as `name: value`. Narrow the list with `*_fields`, and give
columns readable labels with `*_names`:

```python
m.add_markers(
    df,
    popup_fields=["city", "pop_2020"],
    popup_names=["City", "Population"],     # matched to fields by position
    tooltip_style="background: white; border: 1px solid #333; font-size: 10px;",
)
```

If `*_names` cannot be lined up with `*_fields`, swiftmap warns and falls back to the raw
column names rather than failing the render.

For images, links, or custom layout, supply a template. `{column}` inserts a single value and
`{*}` expands the default field list, so you can add markup without enumerating every column:

```python
m.add_markers(
    df,
    popup_template="<img src='{photo_url}' width=300><br>{*}<br><a href='{source_url}'>source</a>",
    popup_fields=["city", "pop_2020"],
    popup_names=["City", "Population"],
    popup_max_width=800,
)
```

**Your markup renders as HTML; values pulled from the data are escaped.** That means a value
containing `<script>` displays as text instead of executing — which matters as soon as your map
shows data you didn't author yourself (uploads, shared tables, third-party APIs). Values landing
in an `href` or `src` are additionally checked for a safe URL scheme.

If you need raw HTML stored *inside* the data itself to render as markup, that is an explicit
opt-in and should only be used with data you control.

---

## Contributing

Want to add support for a new data source, fix a bug, or improve the docs? See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Development Notes

[Claude Code](https://claude.com/claude-code) is used during development of this project —
for refactoring, building test harnesses, and working through architecture decisions.
Direction, review, and acceptance are human-owned: changes are verified against the test
suite and exercised in a real application before they land.
