# swiftmap

`swiftmap` is a Python mapping library that keeps Leaflet's ergonomics while replacing its
vector drawing with WebGL pipelines — so the map you build with a few `add_*` calls keeps
rendering smoothly at millions of points, not thousands.

It targets a gap the existing libraries leave open: **folium and ipyleaflet have the
ergonomics but hit a ceiling around tens of thousands of features and offer flat layer
controls; deck.gl scales but is a different mental model with a thin Python layer.**
swiftmap keeps the Leaflet mental model, adds WebGL scale, hierarchical layer controls,
and bidirectional Python sync.

It runs anywhere `anywidget` runs — JupyterLab, Jupyter Notebook, VS Code — and is
first-class in **Shiny for Python**, where map state (viewport, visibility, clicks,
the time slider) syncs reactively in both directions. A finished map also exports to
a single static HTML file that opens with no backend at all — see
[Sharing a map](#sharing-a-map-one-static-file).

---

## Installation

Not yet on PyPI; install from a checkout:

```bash
pip install -e .
```

Required: `anywidget`, `numpy`, and `xyzservices` (the tile-provider catalogue behind
name-callable basemaps — pure metadata, no compiled bits). Pandas, Polars, GeoPandas,
and geostructures are all supported as data sources but none is a dependency — swiftmap
parses whatever you have installed. The bundled JavaScript ships with the package, so installing never
requires Node.

---

## Quick start (notebook)

```python
import pandas as pd
from swiftmap import Map

df = pd.DataFrame({
    "lat": [36.01, 36.02, 36.03],
    "lon": [-5.36, -5.35, -5.34],
    "name": ["Point A", "Point B", "Point C"],
    "value": [12.4, 8.2, 15.1],
})

m = Map()
m.add_circle_markers(df, name="Sites", color_col="value")
m
```

Three things worth noticing:

- **No column mapping.** `lat`/`lon` were found by name; `latitude`/`longitude`, `x`/`y`,
  and `lng` work too, and `lat_col=`/`lon_col=` override the guess when your names differ.
- **`color_col="value"`** colored each point through a viridis ramp. See
  [Color and size from data](#color-and-size-from-data).
- **The view followed the data.** A `Map()` built without `center`/`zoom` fits itself to
  whatever is added, and keeps following as layers arrive — until anyone states a view
  (explicit `center=`/`zoom=` at construction, a `fit_bounds()` call, or panning the map
  in the browser), after which it is left alone. Frame something on demand any time with
  `m.fit_bounds(m.bounds_of("Sites"))`.
- **Sizing:** `Map(height="500px")` fixes the widget's height, and assigning `m.height`
  resizes a live map. Unset, it fills whatever container it is in.

## Quick start (Shiny)

```python
from shiny import App, ui
from shinywidgets import output_widget, render_widget
from swiftmap import Map
from swiftmap.shiny import map_effect
import polars as pl

app_ui = ui.page_fluid(
    ui.h2("Swiftmap"),
    ui.input_select("status", "Status", ["All", "Active", "Inactive"]),
    output_widget("map_widget"),
)

def server(input, output, session):
    df = pl.DataFrame({
        "lat": [36.01, 36.02, 36.03],
        "lon": [-5.36, -5.35, -5.34],
        "name": ["A", "B", "C"],
        "status": ["Active", "Inactive", "Active"],
    })

    @render_widget
    def map_widget():
        # Built once. Depends on nothing reactive -- see the note below.
        m = Map()                      # no view given: it fits itself to the data
        m.add_markers(df, name="name", layer_group=["Points", "status"])
        m.configure_group("Points", collapsed=False)
        return m

    @map_effect(map_widget)
    def filter_points(m):
        if input.status() == "All":
            m.select(None, scope="Points")
        else:
            m.select(group=f"Points/{input.status()}", scope="Points")

app = App(app_ui, server)
```

**The one Shiny rule:** the `@render_widget` function must depend on nothing reactive.
`@render_widget` rebuilds the widget whenever a dependency invalidates, which throws the
map away and re-uploads every coordinate buffer. Build the map once; make every update
through `@map_effect`, which resolves the live widget, skips quietly if it has not
rendered yet, and batches everything in the body into one message. `map_effect` accepts
`event=` for what `@reactive.event` would do — do not stack that decorator yourself (it
rejects the map argument at decoration time).

---

## What you can plot

| Method | Draws | Notes |
| --- | --- | --- |
| `add_markers` | Pin icons | Custom GLSL shader — anti-aliased pins with drop shadows, at scale |
| `add_circle_markers` | Circle points | `radius` in **pixels**; the cheaper primitive, better default for many points |
| `add_line` / `add_polyline` | Polylines | Long-format rows (`line_id_col`, `order_col`), WKT, GeoJSON, GeoPandas... |
| `add_polygon` (+ `add_polygons`, `add_shape`, `add_shapes`) | Polygons | Interior holes and MultiPolygons render correctly; one MultiPolygon is one layer |
| `add_circle` | Geodesic circle | Center plus `radius` in **meters** — note the unit difference from circle markers |
| `add_collection` (aliases `add_geojson`, `add_geostructures`) | Every kind in a mixed dataset | One layer per geometry kind, merged under a single sidebar entry; points render as circle markers unless `point_type="markers"` |
| `add_basemap` | Tile layer | Any xyzservices catalogue name (~880 providers), a WMS registry name or raw WMS endpoint, or a raw `{z}/{x}/{y}` template — see [Basemaps](#basemaps) |

Every `add_*` method accepts the same range of inputs:

- **Pandas / Polars DataFrames** — lat/lon columns found by name; long format via
  `shape_id_col`/`line_id_col` + `order_col`; WKT geometry columns recognised by value
  (point at one explicitly via `shape_id_col`/`line_id_col` when its name would not be
  guessed); wide vertex columns (`lat1, lon1, lat2, lon2, ...`)
- **GeoPandas** GeoDataFrames and GeoSeries
- **geostructures** shapes, `FeatureCollection`s, and `Track`s
- **GeoJSON** dicts or strings
- **Raw lists and dicts** of coordinates, with a range-based heuristic for axis order
  (`coord_order="lat_lon"`/`"lon_lat"` to state it explicitly; WKT and GeoJSON declare
  their own order and are never guessed at)

A method that cannot read what you passed **warns and adds nothing** rather than raising —
a map is built by a chain of `add_*` calls, and an exception partway through would discard
the layers already added. Rows with missing coordinates are dropped and counted in a
warning rather than failing the layer.

## Basemaps

`add_basemap` resolves, in order: a preset, a WMS registry name, a raw URL, then the
xyzservices catalogue — ~880 providers, with tolerant lookup (`"CartoDB.DarkMatter"`,
`"CartoDB DarkMatter"`, and `"cartodb darkmatter"` all land):

```python
m.add_basemap("Esri.WorldImagery", visible=True)   # catalogue name
m.add_basemap("USGS Imagery")                      # WMS, from the registry
m.add_basemap("https://server/wms", wms_layers="0")        # raw WMS endpoint
m.add_basemap("https://{s}.tile.../{z}/{x}/{y}.png")       # raw XYZ template
```

`m.list_basemaps("dark")` searches every accepted name. An unknown name **warns and
adds nothing** — you never silently get OpenStreetMap when you asked for something
else — and a provider that needs an API key warns by the exact keyword it expects
(`accessToken=`, `apiKey=`, ...). WMS requests follow the map's CRS, so an EPSG:4326
map asks in 4326.

Deploying on a network with its own tile and WMS infrastructure — different
services, a different catalogue, different defaults — is one swappable module:
see [DEPLOYING.md](DEPLOYING.md).

---

## Styling

Every `add_*` method takes the same styling vocabulary as keyword arguments — `color`,
`fill_color`, `fill_opacity`, `weight`, `opacity`, and `radius` where it applies. Leaflet's
camelCase spellings (`fillColor`, `fillOpacity`) work too:

```python
m.add_polygon(zones, color="crimson", fill_color="#f5c4ac", fill_opacity=0.4, weight=2)
```

Polygons follow Leaflet semantics: the fill reads `fill_color` and defaults to `color`
when unset; `weight` and `opacity` draw the border. Point layers take their alpha from
the color itself (`rgba(...)` or `#rrggbbaa`) rather than from `opacity`.

**Style from your data, row by row.** A `style` property or column is applied per
feature, so one DataFrame can carry its own appearance:

```python
df["style"] = df["kind"].map({"city": "red", "town": "blue"})
m.add_markers(df)          # each point takes its own colour
```

The value is a colour string or a dict of options
(`{"color": "red", "weight": 5}`). Only a column named exactly `style` is treated this
way — a column that happens to be called `color` is data, not styling.

**Overriding.** Precedence runs `static_style` → explicit keyword → `style` column →
defaults. `static_style={...}` forces one appearance for the whole layer regardless of
the data; a plain keyword still beats the column.

**Honest warnings.** Misspelled options are reported with a suggestion (`colour` →
`color`); a real option that this geometry cannot draw says so instead of being silently
ignored. Unrecognised keys that match nothing are passed through to the layer untouched,
which is how custom metadata reaches the frontend.

## Color and size from data

Any `add_*` call can drive color and size from a column, the way the rest of the styling
vocabulary works — no precomputed hex codes, no per-row style dicts:

```python
m.add_circle_markers(df, name="Sensors",
                     color_col="reading", colormap="plasma",
                     radius_col="volume", radius_range=(4, 20))

m.add_polygon(districts, name="Districts",
              color_col="median_income", colormap="greens")   # choropleth:
                                                              # fill ramps, border keeps `color`
```

- **Numeric columns** ramp between the data's own extremes, or between `vmin`/`vmax` when
  you fix them. `color_bins=[10, 20, 50]` classifies into discrete classes instead of a
  continuous ramp. Missing values (NaN) paint as the layer's base color.
- **Non-numeric columns** are categories: each distinct value takes a palette colour
  automatically. Naming a sequential colormap instead spreads it evenly across the
  categories.
- **Colormaps:** `viridis` (default), `plasma`, `inferno`, `magma`, `turbo`, `coolwarm`,
  `blues`, `reds`, `greens`, `greys`; categorical palette `swift10`. They are small anchor
  tables interpolated in RGB — matplotlib-faithful with no matplotlib dependency.
- **`radius_col`** sizes points so *area* is proportional to the value (radius grows with
  the square root) — a doubled value looks doubled, not quadrupled — across
  `radius_range` pixels, default `(3, 18)`.

At scale this matters more than convenience: point colors and radii travel as compact
binary buffers beside the coordinates, never as per-feature style dicts in the layer
JSON, so coloring five million points does not bloat the payload that every sidebar
toggle and view attach has to carry.

The legend below picks all of this up automatically — the ramp, the bins, the
categories, and a stated size row for `radius_col` (`size ∝ volume (10 – 500)`;
stated, never drawn, because legend pixels are not map pixels at any zoom).

## The legend

One call puts a legend on the map, and it derives from the same layer state the map
renders — glyphs per geometry, sections per sidebar folder, ramps/bins/categories
straight from `color_col` — so there is nothing to fall out of step:

```python
m.configure_legend(show=True, title="Key", position="bottom-right")
```

`scope='all'` (default) lists every layer and dims the hidden ones — a legend is the
map's vocabulary; `scope='visible'` tracks the screen instead, and `dim_hidden=False`
gives the print-style static key. Eight anchor positions, shared with the time control.

When derivation isn't what you want to say, `legend_add` writes your own rows — plain
swatches, ramps, or category lists, optionally bound to a live layer's visibility
(`layer=`) — and `legend_remove` is a persistent suppressor that keeps matching across
every re-derivation. `configure_legend(auto=False)` hands the whole legend over to
manual entries. Exports carry it all.

## Scale bar

Off by default, one call away, with the unit maritime work runs on alongside the
usual ones:

```python
m.show_scale = True
m.configure_scale(units="nautical")     # metric (default) | imperial | both | nautical
```

It measures through the map's CRS — Leaflet's own control underneath, so there is no
pixel math of swiftmap's to get wrong — and exports carry it.

---

## The sidebar: hierarchy from your data

Layers organise into a tree of folders in the map's sidebar, and the tree can come from
the data itself — any part of `layer_group` that matches a column name resolves per row:

```python
m.add_markers(df, name="site",                 # each point named from its own row
              layer_group=["Sensor Feeds", "region", "status"])
# -> Sensor Feeds / EMEA / Active, Sensor Feeds / EMEA / Inactive, ...
```

Toggling a folder toggles everything nested under it. Configure a folder's behaviour with:

```python
m.configure_group("Sensor Feeds", collapsed=True)
m.configure_group("Basemaps", multi_select=False)   # radio buttons, not checkboxes
```

## Acting on layers after they exist

One targeting vocabulary — id or name, `types=`, `exclude_types=`, `group=` — is shared
by everything that operates on existing layers:

```python
m.hide(group="Feeds/Inactive")
m.show("Survey")                                  # every part of a collection
m.select(chosen_ids, scope="Dwells", zoom=True, zoom_offset=-1)
m.highlight("Survey", color="#ffcc00", markers={"radius": 14})
m.set_feature_styles("Sites", {12: {"color": "#ffcc00"}})     # one feature, by index
m.fit_bounds(m.bounds_of(["Dwell 3", "Dwell 7"]), zoom_offset=-1)
```

`select` and `highlight` are declarative and total: each call states the complete
selection, so switching needs no undoing and `select(None)` / `highlight(None)` restores
a clean slate. Highlights and per-feature overrides sit in fields of their own above the
layer's styling, so clearing them restores what was underneath with nothing remembered.

A call that matches nothing **warns** — a mistyped name looks identical to a hidden
layer, and silence is the failure you would not notice.

Clicks sync back to Python — on features and on open map alike. A feature click sets
`m.clicked_layer_id` and `m.selected_index` (overlaps resolved top-down: points over
lines over polygons); a click on open map clears them and reports `m.clicked_latlng`
as `[lat, lon]`. Feature clicks record their location too — a point reports its own
coordinates, not the mouse's. `m.click_seq` bumps on every click, so one observer
reads "where" and "on what" from a single event.

## Drawing & AOIs

`configure_draw(show=True)` puts a draw toolbar on the map — markers, lines,
rectangles, polygons and circles, with vertex editing, dragging and deletion.
Everything drawn lands in `m.drawings` as GeoJSON features (a circle carries
`properties.kind` and its radius, since GeoJSON has no circle), and `m.draw_seq`
bumps on every create, edit and delete — observe that one trait and read
`m.drawings` in the handler, the same pattern clicks use:

```python
m.configure_draw(show=True, tools=["rectangle", "polygon"])
aoi = m.drawings[0]["geometry"]          # after the analyst draws one
```

The trait syncs both ways: setting `m.drawings` from Python seeds AOIs onto the map,
`clear_drawings()` empties it, and exports carry the drawings and the toolbar with
them. The drawing engine (Leaflet-Geoman) loads from unpkg at view time, the same
way Leaflet and glify do.

---

## Time layers

Any layer whose features carry timestamps can be animated. Timestamps are read from the
layer's own properties — a DataFrame's `timestamp` column, or the interval a
geostructures `Track` already records — so nothing extra is passed in:

```python
m.add_circle_markers(df, name="Vessel")          # df has a timestamp column
m.make_time_layer("Vessel", period="PT1H")
```

The automatic probe checks the usual names (`times`, `datetime_start`/`datetime_end`,
`timestamp`, `datetime`, `time`, `date`). When your column is called something else —
or the probe would pick the wrong one — name it yourself, like any other override:

```python
m.make_time_layer("Vessel", time_field="obs_time", period="PT1H")
m.make_time_layer("Dwells", time_field="arrived", time_end_field="departed")
```

One slider serves every time layer on the map; animating a second layer joins it to the
same slider rather than adding another control. The slider steps through generated
periods (`'P1D'`, `'PT15M'`, ...) rather than through the observed timestamps, so a
period in which nothing happened still gets its tick — an empty map at 03:00 is a
finding, not a gap in the slider.

By default each tick shows its own period. Pass `duration=None` to accumulate history
instead, or an ISO8601 duration (`'PT6H'`) for a fixed trailing window. Add `fade=True`
to dim point features with age — newest at full opacity, reaching zero at the window's
trailing edge. Playback options are shared:
`m.configure_time(period="PT1H", auto_play=True, loop=True, speed=2,
position="bottom-center")`.

The slider's position syncs both ways: `m.time_current` holds the current tick (epoch
ms) for Shiny to react to, and setting it from Python jumps the slider to that moment.
`m.clear_time_layer()` stops animating and removes the control.

For point layers the per-tick filtering runs in the vertex shader — dragging the window
across five million points repaints in milliseconds, not seconds.

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

## Labels

`label=` puts permanent text chips on features — a column name labels each feature from
its own value, anything else is the literal text:

```python
m.add_circle_markers(sites, name="Sites", label="site")
m.add_polygon(zones, name="zone_id", label="zone_id")
```

Every geometry takes one: points anchor at the point, lines at their middle vertex, areas
at their centre. Label text is escaped like popup values, and on a time layer the chips
appear and vanish with their features. Labels are DOM elements — built for sites and
zones, not point clouds — so the point builders warn past a thousand.

---

## Sharing a map: one static file

```python
m.save("map.html")           # or: html = m.to_html()
```

The export is one self-contained HTML file with the map's whole state baked in — layer
configs, every coordinate/time/style buffer (base64, so expect roughly 4/3 of their
binary size), the widget bundle and its CSS. Hand the file to anyone: it opens from disk
or a static file host with no Python, no kernel, no server. The sidebar and time playback
work fully client-side, and the automatic fit rides along so the file opens framed on its
data. One caveat: Leaflet and glify load from unpkg when the file is opened, the same way
the live widget loads them, so *viewing* needs internet (or your own vendored bundle).

`to_html()` returns the same document as a string, which is also the Streamlit story:

```python
import streamlit.components.v1 as components
components.html(m.to_html(), height=600)
```

Interaction in an export stays in the file — there is no Python behind it to sync back to.

---

## Performance notes

The things that keep large maps fast are on by default and mostly invisible:

- Coordinates — points, lines, and polygons alike — travel as binary float64 buffers,
  never as JSON in the layer configs. Data-driven colors and radii ride the same
  transport.
- Every mutation after the first render is a small patch, not a resend of the map.
  A sidebar toggle costs ~100 bytes at any scale.
- Time filtering for points runs on the GPU (per-point times upload once as vertex
  attributes; the tick is a uniform).
- Every `add_*` call already batches internally. Group several calls into one message
  with `with m.batch(): ...` — it is reentrant, so nesting is safe.

`sync()` pushes a render when `auto_sync=False`; `resync()` replaces the client's entire
state, useful if a view may have missed updates.

Full parameter documentation lives in each method's docstring
(e.g. `help(Map.add_markers)`).

---

## Contributing

Want to add support for a new data source, fix a bug, or improve the docs? See
[CONTRIBUTING.md](CONTRIBUTING.md). The JS lives in `src/` and must be rebuilt after
changes (`npm run build`); the committed bundle is what ships.

---

## Development Notes

[Claude Code](https://claude.com/claude-code) is used during development of this project —
for refactoring, building test harnesses, and working through architecture decisions.
Direction, review, and acceptance are human-owned: changes are verified against the test
suite and exercised in a real application before they land.
