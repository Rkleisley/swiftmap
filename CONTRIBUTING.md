# Contributing to swiftmap

This document covers swiftmap's internal architecture for people extending the library itself. If you just want to *use* `Map`, see [README.md](README.md) instead.

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
| `dist/index.js` | `swiftmap-core` — the framework-agnostic entry point for React/vanilla JS |

`swiftmap/static/` is committed deliberately: a Python user installing from source should
never need a JavaScript toolchain. Commit the rebuilt bundle alongside your `src/` change so
the two never drift apart.

The JS is plain ES modules with real `import`/`export`, bundled by esbuild (`build.mjs`).
Nothing in `src/` may import from Python or assume anywidget — `src/map.js` is the anywidget
*adapter*, and the reusable pieces it builds on are exported from `src/index.js` so the same
renderer can back a React app.

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

5. **Add test cases** to `tests/test_basic.py` verifying that `add_markers()`, `add_line()`, and `add_polygon()` work end-to-end with your new data source. Follow the shape of an existing test like `test_geopandas_points_and_lines` or `test_polars_and_dict_lines_polygons` — build a small sample of your format, call the public `Map` method, and assert on the resulting layer rather than calling your parser functions directly.
