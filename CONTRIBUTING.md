# Contributing to swiftmap

This document covers swiftmap's internal architecture for people extending the library itself. If you just want to *use* `Map`, see [README.md](README.md) instead.

---

## Decisions worth preserving

Each of these looks like something worth tidying up, and each is load-bearing. The reason is
recorded so a future cleanup does not reintroduce a bug that has already been fixed.

**Parsers return empty; they never raise for absent geometry.** Building a map is a chain of
`add_*` calls, and an exception partway through discards every layer already added, leaving
nothing to render. The calling `add_*` warns instead, because only it knows whether that
geometry kind was actually asked for — `add_collection` asks all three speculatively and so
suppresses `EmptyLayerWarning`. Still fatal, because nothing can render and there is no
partial result: an unknown data source type, and a missing JS bundle.

**geostructures dispatches on type mixins, never on attributes.** `centroid` exists on every
shape and `to_polygon` exists on lines, so duck-typing made a polygon render as a polygon
*and* a phantom centroid marker. Expansion via `.geoshapes` must happen *before* geometry is
read: `linear_rings()` nests differently on a `MultiGeoPolygon` than a `GeoPolygon`, and
`MultiGeoLineString` has no `vertices` at all.

**GeoPandas must stay registered ahead of pandas in `registry.py`.** `GeoDataFrame` subclasses
`DataFrame`, so first-match-wins dispatch would otherwise read it as a plain table with no
geometry. A test pins this.

**Property values are coerced to JSON-safe types in `_add_child.py`.** Timestamps and numpy
scalars parse fine and then fail during traitlets serialisation, far from the column
responsible. One choke point every layer passes through.

**Per-feature styles live in `feature_styles`, not inside `properties`.** So restyling one
feature — highlighting a selected table row — can patch that field alone rather than
resending a layer's whole property set.

**`swiftmap/static/` is a committed build artifact**, so `pip install` never needs Node. See
the rebuild warning below.

## Project Layout

*   `src/` — the frontend (Leaflet + WebGL via a customized `Leaflet.glify`), written as ES modules. This is the primary JavaScript source.
*   `swiftmap/map.py` — the `Map` widget itself: traitlets state, layer CRUD (`update_layer`, `remove_layers`, ...), `batch()` / `sync()`, and the incremental patch transport.
*   `swiftmap/layers/` — one file per layer type (`markers.py`, `polyline.py`, `polygon.py`, `circle.py`, ...). These implement the public `add_*` methods and hand off to the parser layer to turn input data into coordinate arrays.
*   `swiftmap/parsers/` — turns whatever data format a user passes in into plain coordinate arrays. See below.
*   `swiftmap/static/` — **build output, not source.** The bundled widget the Python package ships.
*   `tests/test_basic.py` — integration tests that exercise everything through the public `Map` API rather than calling internals directly.

---

## Working on the JavaScript

> **If you edit anything in `src/`, you must rebuild.** `swiftmap/static/widget.js` is a
> committed build artifact, and Python loads *that*, not your source. Skip the rebuild and
> the Python tests will pass while your change quietly does nothing.

```bash
npm install
npm run build        # or: npm run build:watch
```

`npm run build` produces three artifacts from the same source:

| output | consumer |
| --- | --- |
| `swiftmap/static/widget.js` | the Python widget (committed, so `pip install` never needs Node) |
| `dist/anywidget.js` | the same bundle for npm consumers |
| `dist/index.js` | `swiftmap-core` — the framework-agnostic entry point for vanilla JS |
| `swiftmap/static/widget.js` + `.css` | the anywidget bundle, Leaflet/glify/Geoman and all styles INSIDE (offline; minified, no sourcemap — debug against `dist/anywidget.js`) |
| `dist/react.js` | `swiftmap-core/react` — the `<SwiftMap>` component; react and the rendering libraries are peer dependencies |
| `examples/react/dist/` | the React example app, bundled whole (gitignored); tier 3 drives it |
| `swiftmap/streamlit/frontend/` | the Streamlit component — the React host under Streamlit's protocol, bundled whole with React, Leaflet, glify, Geoman and CSS; shipped in the wheel and committed like `static/` |

`swiftmap/static/` is committed deliberately: a Python user installing from source should
never need a JavaScript toolchain. Commit the rebuilt bundle alongside your `src/` change so
the two never drift apart.

### Building without Node

```bash
python tools/bundle.py
```

For environments where `src/` can be obtained but `node_modules` cannot. It rebuilds
`swiftmap/static/` from `src/` using only the standard library — **building the CDN
variant** (`src/anywidget-cdn.js`), not the canonical offline widget.

The canonical `swiftmap/static/widget.js` BUNDLES Leaflet, glify and Geoman (with their
stylesheets, images as data URIs) so the widget and the static export run with no network
— the closed-network requirement — and that needs esbuild. glify note: the bundle imports
`leaflet.glify/dist/glify-browser.js` by path; the package main is a different build.
The no-Node fallback instead flattens only swiftmap's own modules and keeps the runtime
loader (`src/loader.js`), whose CDN URLs a receiving network's patcher rewrites — so a
rebuild without Node still yields a working widget, at the price of the libraries loading
from wherever the patcher points. Running `tools/bundle.py` therefore REPLACES the
offline widget with the CDN variant; run `npm run build` to restore it.
An npm consumer instead imports `leaflet`, `leaflet.glify` and Geoman itself and passes
the namespace in -- the bundler owns the dependencies there.

Prefer `npm run build` whenever Node is available. The Python script flattens every module
into one shared scope rather than preserving module boundaries, so it fails the build if
two modules declare the same top-level name — a duplicate would otherwise shadow silently.
Keep that in mind when naming things in `src/`; it is the constraint esbuild removes.

The JS is plain ES modules with real `import`/`export`, bundled by esbuild (`build.mjs`).
Nothing in `src/` may import from Python or assume anywidget. `src/core.js` mounts a map
over a *host* — the five-method interface documented in `src/host.js` (`get`, `set`, `on`,
`send`, `save_changes`), which anywidget's model satisfies as-is and which
`createHostStub` implements for exports and tests. `src/anywidget.js` is the anywidget
*adapter*, a dozen lines over the core; the reusable pieces are exported from
`src/index.js` so the same renderer backs a static export or a React app.

### Building an installable package

```bash
npm run wheel
```

Rebuilds the JS bundle, then builds the wheel and sdist into `pydist/` (kept apart
from `dist/`, which is the esbuild output). Chained deliberately: a wheel must never
ship a stale bundle, and the committed `swiftmap/static/` is what the wheel carries —
installing needs no Node, ever. `pip install pydist/swiftmap-*.whl` into a fresh
environment is the acceptance test; `Map().to_html()` proves the static assets load
from the installed location. Runtime dependencies are anywidget, traitlets and numpy
only — pandas/polars/geopandas stay optional and are detected at parse time.

### Testing the JavaScript

```bash
npm test              # all three tiers
npm run test:unit     # tiers 1 and 2 only -- no browser needed
```

Three tiers, cheapest first. Most of what looks like "rendering" is really a decision, and
decisions are testable without pixels.

| tier | file | covers | needs |
| --- | --- | --- | --- |
| 1 | `test/tier1-logic.test.mjs` | visibility inheritance, WebGL bucketing, radio groups, patch application, bounds, per-feature style, click-to-row mapping, escaping | nothing |
| 2 | `test/tier2-sidebar.test.mjs` | the folder tree, checkbox vs radio, writeback to the model, fitBounds on toggle | jsdom |
| 3 | `test/tier3-render.test.mjs` | Leaflet init, panes, glify receiving data, visible output, popups | Playwright |

Tier 3 skips itself when Playwright is absent, so the suite still runs on a machine without
it. Install with `npm i -D playwright && npx playwright install chromium`.

Two rules for tier 3, both learned the hard way:

**Never compare screenshots to a stored baseline.** WebGL output differs across GPUs and
drivers, so a pixel-exact baseline fails for reasons that have nothing to do with the code.
Compare two screenshots taken in the *same session* instead -- render, hide the layer,
assert the images differ. That proves something was drawn and cannot fail on a new machine.

**`readPixels` does not work here.** glify creates its context without
`preserveDrawingBuffer`, so the buffer is empty by the time a test can read it. The
differential screenshot above is the way around it.

Keep tier 3 thin. Anything answerable from data belongs in tier 1, where it runs in
milliseconds instead of six seconds.

---

## Adding Support for a New Data Source

`swiftmap` uses a **source-based strategy architecture** in `swiftmap/parsers/` to parse diverse data formats (Pandas, Polars, GeoPandas, GeoStructures, GeoJSON, raw dicts/lists) into optimized coordinate arrays for WebGL rendering.

### Architecture & Dispatch Flow

```
swiftmap/parsers/
├── __init__.py         # Public exports (parse_points, parse_lines, parse_polygons, GeometryParserRegistry)
├── registry.py         # GeometryParserRegistry class, registry brokers, & strategy registrations
└── sources/
    ├── __init__.py
    ├── _utils.py       # Shared column finders, WKT string parsers, & ring closure helpers
    ├── _tabular.py     # Shared points/lines/polygons logic for any DataFrame-like source
    ├── pandas.py       # Pandas DataFrame parser (points, lines, polygons)
    ├── polars.py       # Polars SIMD native parser (points, lines, polygons)
    ├── geopandas.py    # GeoPandas GeoDataFrame/GeoSeries parser (points, lines, polygons)
    ├── geostructures.py # Direct attribute geostructures parser (points, lines, polygons)
    ├── geojson.py      # GeoJSON Feature/Collection parser (points, lines, polygons)
    └── lists_dicts.py  # Raw coordinate list, dict, and list-of-dicts parsers
```

`registry.py` is the only file that sits at the top level of `parsers/` alongside `__init__.py` — it's the dispatch mechanism, worth reading first. Everything in `sources/` is a strategy it dispatches into. The two leading-underscore files there (`_utils.py`, `_tabular.py`) are shared plumbing used *by* other sources, not sources themselves — nothing outside `sources/` ever imports them directly.

Parsing is dispatched dynamically using `GeometryParserRegistry` strategy brokers (`points_registry`, `lines_registry`, `polygons_registry`) defined in `registry.py`. Each broker holds a list of `(check_func, parse_func)` pairs. When `m.add_markers()`, `m.add_line()`, or `m.add_polygon()` is called, the matching registry tries every registered `check_func`, in registration order, and dispatches to the `parse_func` of the first one that returns `True`.

> **Registration order matters.** Dispatch is first-match-wins — there's no specificity scoring. Write `is_x` checks that are as precise as possible (e.g. `isinstance(data, my_library.MyType)` behind a guarded `import`) so overlap with other sources isn't a concern. The raw catch-alls for plain dicts and coordinate lists (`is_dict`, `is_coordinate_list` in `sources/lists_dicts.py`) are deliberately registered last in `registry.py` — keep new sources above them, not below.

### How to Add Support for a New Data Source

1. **Create a source module**: add a file to `swiftmap/parsers/sources/` (e.g. `swiftmap/parsers/sources/my_format.py`).

2. **Implement a type checker and three parsers**:

   ```python
   from typing import Any, Tuple, List, Dict, Optional
   import numpy as np

   def is_my_format(data: Any) -> bool:
       """Returns True if input data matches your data source type."""
       try:
           import my_library
           return isinstance(data, my_library.MyDataFrame)
       except ImportError:
           return False

   def parse_my_format_points(data: Any, lat_col=None, lon_col=None, **kwargs) -> Tuple:
       """Returns (lats: np.ndarray, lons: np.ndarray, props: Dict[str, list])."""

   def parse_my_format_lines(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, list]]:
       """Returns (lines_coords: List[List[List[float]]], props: Dict[str, list])."""

   def parse_my_format_polygons(data: Any, **kwargs) -> Tuple[List[List[List[float]]], Dict[str, list]]:
       """Returns (polygons_coords: List[List[List[float]]], props: Dict[str, list])."""
   ```

3. **Reuse shared helpers directly — don't reinvent them.** Rather than writing from the stub above, copy whichever existing module in `sources/` is closest to your data's shape:

   - **Tabular, with column names to guess** (a DataFrame-like object exposing `.columns` and per-column `.to_numpy()` / `.to_list()`) → copy `sources/pandas.py` or `sources/polars.py`. Most of the work is already done for you in `sources/_tabular.py`: `parse_tabular_points` handles points outright, and `parse_tabular_lines_by_coord_column` / `parse_tabular_lines_by_wide_columns` / `parse_tabular_polygons_by_coord_column` / `parse_tabular_polygons_by_wide_columns` handle the "single WKT/coordinate column" and "wide vertex columns (`lat1, lon1, lat2, lon2, ...`)" cases for lines and polygons — call them first and only fall back to source-specific logic (e.g. `pandas.py`'s `.groupby()`, `polars.py`'s native `.group_by().agg()`) for multi-row grouping, which is the one part that's genuinely worth writing per-library for performance. See `sources/pandas.py` for the reference shape.
   - **Typed geometry objects** (like Shapely/GeoPandas geometries, or GeoStructures shapes) → copy `sources/geopandas.py` or `sources/geostructures.py`. These import `_ensure_closed_ring` from `_utils.py` directly, and only in the polygon parser — points and lines read coordinates straight off the geometry object, with no column-name guessing involved.

   If neither fits — your format needs column auto-detection, WKT/coordinate-string parsing, or ring-closing but isn't `.columns`-shaped enough to reuse `_tabular.py` — import the underlying primitives directly, since both are plain siblings inside `sources/`:

   ```python
   from ._utils import find_column_or_key, _parse_coord_string, _parse_polygon_wkt_string, _ensure_closed_ring
   ```

4. **Register your strategies in `swiftmap/parsers/registry.py`**, at the bottom, next to the other source registrations. Note the import path reaches down into `sources/`, since `registry.py` itself lives one level up:

   ```python
   from .sources.my_format import is_my_format, parse_my_format_points, parse_my_format_lines, parse_my_format_polygons

   points_registry.register(is_my_format, parse_my_format_points)
   lines_registry.register(is_my_format, parse_my_format_lines)
   polygons_registry.register(is_my_format, parse_my_format_polygons)
   ```

   Every registration in the file follows this same plain two-argument form — if you find yourself reaching for a `lambda` here, it usually means step 3 was skipped.

   **Also add your library's top-level import name to `_SOURCE_PACKAGES`** in the same file.
   That set is how the registry tells "you passed something from a library we support, so its
   import probably failed" apart from "we do not support this at all" — two very different
   messages for a reader to act on. Miss it, and someone whose install of your library is
   broken gets told their own type is unsupported, which sends them looking in the wrong place.

   **If your parsers filter by geometry type**, add one more line to the same block:

   ```python
   mixed_geometry_checks.append(is_my_format)
   ```

   That is what lets `add_collection` hand the same object to all three parsers. Only opt in
   if each parser genuinely returns *only* its own kind from a mixed input — GeoJSON,
   geostructures and GeoPandas do. The tabular sources coerce whatever they are given, so
   they register a narrower check (`pandas_has_mixed_geometry`) that requires a WKT column;
   a plain lat/lon table stays out.

5. **Add test cases** to `tests/test_basic.py` verifying that `add_markers()`, `add_line()`, and `add_polygon()` work end-to-end with your new data source. Follow the shape of an existing test like `test_geopandas_points_and_lines` or `test_polars_and_dict_lines_polygons` — build a small sample of your format, call the public `Map` method, and assert on the resulting layer rather than calling your parser functions directly.

## Authoring conformance: one rulebook, two implementations

`createMapModel` (src/model.js) is the authoring surface in JS -- the builders,
the merge rule, bounds, the auto-fit union, the buffer packing -- with Python's
`Map` as its specification. There is no runtime bridge between the two (the
server has no JS engine, the browser no Python), so the rules exist twice and are
held together by golden fixtures instead: `scripts/authoring_goldens.py` builds
canonical scenarios through the real Python Map and commits their exact state and
buffers under `test/goldens/authoring/`. `tests/test_authoring_goldens.py` keeps
Python matching the committed files; `test/tier1-model.test.mjs` builds the same
scenarios through the JS model and demands byte-identical buffers and equal
configs. Changing an authoring rule on either side breaks that side's suite; the
fix is to regenerate the goldens, review the diff, and bring the other side with
you -- never to loosen a comparison. New authoring behaviour lands with a new
scenario in both lists (the suites fail if the lists differ).

`src/basemap-catalog.js` is GENERATED by `scripts/generate_basemap_catalog.py`
from the Python basemap registry (plus xyzservices) and committed: building the
JS never needs Python, and a network that swaps its registry file reruns the
generator so both sides resolve every name to the same tiles. Do not edit it by
hand.
