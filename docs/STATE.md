# Project state and handoff

Living notes on where swiftmap stands, what is deliberately the way it is, and what is
still open. Commit messages carry the detail of *what* changed; this file carries the
*why*, so the reasoning survives when the conversation that produced it does not.

Last updated after the three-tier JavaScript test suite landed.

---

## Where things stand

| area | state |
| --- | --- |
| Parsers | 309 Python tests. Every source, every input shape, cross-source equivalence. Solid. |
| JS logic | 58 tests across three tiers. Decisions, sidebar DOM, and a browser smoke pass. |
| Sync transport | Incremental patches. 30 dwells over a 20k track: ~140 MB -> ~0.06 MB. |
| Popups / tooltips | Escaped by default, templates and aliases supported. |
| Styling | Per-feature from a `style` column, `static_style` override, universal across `add_*`. |
| Build | esbuild, `src/` is primary, outputs to `dist/` (npm) and `swiftmap/static/` (wheel). |
| CI | **None.** Nothing runs the suites on push. Biggest remaining infrastructure gap. |
| Release | Unreleased, 0.1.0, not on PyPI. |

Run everything:

```bash
pytest -q          # 309
npm test           # 58, tier 3 skips without Playwright
npm run build      # required after any src/ change
```

---

## Decisions that should not be quietly reversed

**Parsers return empty; they do not raise for absent geometry.** Building a map is a chain
of `add_*` calls, and an exception partway through discards every layer already added,
leaving nothing to render. The calling `add_*` warns instead, because only it knows whether
that geometry kind was actually asked for. `add_collection` suppresses `EmptyLayerWarning`
because it asks all three parsers speculatively.

Still fatal, because nothing can render and there is no partial result: an unknown data
source type, and a missing JS bundle.

**geostructures dispatches on type mixins, never on attributes.** `centroid` exists on every
shape and `to_polygon` exists on lines, so duck-typing made polygons render as a polygon
*and* a phantom centroid marker. `PointLikeMixin` / `LineLikeMixin` / `PolygonLikeMixin` are
exact. Expansion via `.geoshapes` must happen *before* geometry is read: `linear_rings()`
nests differently on a `MultiGeoPolygon` than on a `GeoPolygon`, and `MultiGeoLineString`
has no `vertices` at all.

A `Track` groups shapes by *time*, not geometry. It may hold points, lines or polygons, and
its contents route by shape like any other collection.

**`swiftmap/static/` is a committed build artifact.** So `pip install` never needs Node.
Editing `src/` without `npm run build` leaves the Python tests passing while the change does
nothing — the single most likely way to lose an hour in this repo.

**GeoPandas must stay registered ahead of pandas** in `registry.py`. `GeoDataFrame`
subclasses `DataFrame`, so first-match-wins dispatch would otherwise parse it as a plain
table with no geometry. There is a test pinning this.

**Property values are coerced to JSON-safe types in `_add_child.py`.** Timestamps and numpy
scalars parse fine and then fail during traitlets serialisation, far from the column
responsible. One choke point every layer passes through.

**Per-feature styles live in `feature_styles`, not inside `properties`.** So a future
restyle — highlighting a selected table row — can patch just that field instead of
resending a layer's whole property set.

---

## Testing approach

Three tiers, cheapest first, on the principle that most "rendering" risk is a decision
rather than a pixel. See CONTRIBUTING for the table and the two hard-won rules: never
compare screenshots to a stored baseline, and `readPixels` is unusable because glify
creates its context without `preserveDrawingBuffer`.

The keystone is the model stub in `test/helpers.mjs`. anywidget's model is
`get`/`set`/`on`/`send`/`save_changes`/`comm` — twenty lines of it drives the whole widget
with no Python, kernel or comm.

Every bug found this cycle came from writing a test for *intended* behaviour, never from
reading code. Worth repeating rather than reviewing harder.

---

## Open — needs a decision

**Connect-the-dots (points plus a path).** A GPS/AIS track drawn as clickable pings plus a
connecting line. Two same-named calls already merge into one sidebar entry, so this is
convenience, not capability. Do **not** call it `add_track`: geostructures already uses
`Track` for timestamped shapes of any geometry, and the geospatial convention is a
trajectory, so a third meaning would make things worse. Name the action instead —
`connect=True` on the points call, or similar.

**React / npm extraction.** `src/index.js` is the framework-agnostic entry and `package.json`
exists, but the core is not yet consumable standalone: `layers.js` and `sidebar.js` still
take `model`, and Leaflet/glify load from unpkg as globals rather than imports. Remaining
work is inverting that dependency to callbacks and swapping the CDN loads for real imports.
Doing it *before* the arcs/icons/heatmaps work avoids porting those features twice.

**Streamlit.** Static-only ("like folium") is the current lean and is nearly free once the
core is extractable, since Streamlit components are React underneath. Reactive Streamlit is
the expensive part and can wait indefinitely.

---

## Known and unfixed

**`collapsedPaths` is module scope in `sidebar.js`.** Two maps on one page share sidebar
collapse state. Fix when `renderSidebarControls` gets its dependency inversion, since that
signature changes anyway.

**`pointsList.indexOf(point)` is a linear scan** on every click and hover
(`layers.js`). For a library advertising millions of points that is a scan of millions per
mouse event. glify hands back the same array reference that is in `pointsList`, so a `Map`
from reference to index built once at render time would make it O(1).

**Line and polygon holes are not rendered.** `GeoRing` returns its outer boundary and its
hole as two separate rings, each drawn as its own outline rather than as a donut. The
renderer only ever passes one ring per polygon.

**`setupGlifyProjection` patches `glInstance.layer._unclampedProject`,** a glify private.
It works but pins us to glify internals — worth a pinned version and an upstream issue
rather than a rewrite.

**Placeholder logo URLs** in `src/map.js` (`https://repo/assets/image.png`) fail DNS when
`show_logo` is on.

---

## Behaviour changes worth remembering

**`parseColor` uses the browser's CSS parser**, replacing a 7-entry lookup table. `teal`,
`navy`, `rgb()`, `hsl()` and the rest now work instead of silently rendering blue. But the
old table held hand-tuned approximations, so two colours moved: `"red"` is now true
`#FF0000`, and **`"green"` is now CSS `#008000`, which is noticeably darker** — `test_app`
uses `color="green"` for its track.

**Polylines now show popups.** `add_line` was the only layer type that never set
`autobind_popup`, so polyline popups could never fire even though the JS called `bindPopup`
for them.

**Collection adds render points as circle markers**, not pin markers — cheaper for
collections carrying many. `point_type="markers"` opts back in.
