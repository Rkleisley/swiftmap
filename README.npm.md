# swiftmap-core

The framework-agnostic rendering core behind [swiftmap](https://github.com/Rkleisley/swiftmap) —
Leaflet's ergonomics with WebGL pipelines under them, so a map keeps rendering smoothly at
millions of features. This package is the JavaScript half: a React component, a JS authoring
surface, and the primitives any host can drive. The Python package on PyPI is one consumer of
exactly this code; the static export and the notebook widget are others.

```bash
npm install swiftmap-core
```

Peer dependencies your bundler owns: `leaflet`, `leaflet.glify`,
`@geoman-io/leaflet-geoman-free`, and `react` if you use the component.

## The React component

The same map as a component. `swiftmap-core/react` exports `<SwiftMap>`, one more host
over the core the notebook widget and the static export use — not a second renderer:

```jsx
import { SwiftMap } from "swiftmap-core/react";
// plus leaflet.css, leaflet-geoman.css and swiftmap-core/swiftmap.css from your bundler

<SwiftMap ref={mapRef} layers={layers} buffers={buffers} center={[36.05, -5.25]} zoom={12}
          showLegend timeConfig={{ period: "P1D" }}
          onViewChange={...} onLayerToggle={...} onFeatureClick={...}
          onDrawChange={...} onTimeChange={...} />
```

Props are the same configs the Python side builds (`layers`, binary `buffers`, the
legend/time/draw/scale/logo configs); the callbacks are the core's write-backs; and
`mapRef.current.applyPatch(ops, buffers)` is the widget's own incremental path — a live
feed's `buffer_append`/`append` ops land exactly as they do from Python. `react`,
`leaflet`, `leaflet.glify` and Leaflet-Geoman are peer dependencies your bundler owns.
`examples/react/` is the working example, and tier 3 drives it.

Building layers in JS no longer means hand-writing configs -- `createMapModel`
is the same authoring surface Python has, held byte-identical to it by a
conformance suite:

```js
import { createMapModel } from "swiftmap-core";

const model = createMapModel();
model.addCircleMarkers({ lat, lon, site, value }, { name: "Sites" });
model.addPolygon(ring, { name: "Zone", fillColor: "#00ff00" });

<SwiftMap {...model.props()} />
```

Same defaults, same folder seeding, same merge rule (same name + same folder
becomes one collection), same auto-fit -- because a golden-fixture suite pins the
JS output (state, buffers, and the op stream) byte-identical to what Python's
`Map` produces for the same inputs. The whole surface is there: data-driven
colour and size with their legend blocks (`colorCol`, `radiusCol`), WKT strings
and GeoJSON straight into the builders (`addPolygon("POLYGON ((...))")`, holes
and multi-parts included; several features fan into numbered layers),
`addCollection`, `findLayers` / `select` / `hide` / `show` / `updateLayer`
(attributes, replace, and the append delta), `makeTimeLayer` / `configureTime`,
and `addBasemap` over a catalogue generated from the same registry Python
resolves. Every mutation emits the ops Python's transport emits
(`model.subscribe`), so a live feed drives the map through
`useSwiftMapFeed(model, mapRef)` from `swiftmap-core/react` -- one state model,
wire cost of the batch -- while `useSwiftMapModel` covers the
mutate-then-snapshot shape. `examples/react/` is authored entirely through the
model. Not in JS yet: labels, feature styles/highlight, imagery, and
column-driven point fan-out.

Hand-building configs and buffers anyway? The contract, which nothing else documents:

| buffer key | dtype | stride |
|---|---|---|
| `<id>` | Float64 | 2 per vertex, **lat then lon** (the reverse of GeoJSON/WKT order) |
| `<id>::colors` | Uint8 | 4 per point, RGBA |
| `<id>::radii` | Float32 | 1 per point, pixels |
| `<id>::times` | Float64 | 2 per feature, `[start, end]` epoch **milliseconds** (never seconds) |

Multi-ring polygons carry `rings: [[5, 5], [5]]` — parts → ring vertex counts,
concatenated into one flat buffer, first ring of each part the outer boundary and the
rest holes; a single plain ring omits the key. Multi-part lines carry `parts` (vertex
counts per part). Two layers added with the same `name` **and** `layer_group` merge
into one `type: "group"` entry with the members nested under `layers` — one sidebar
entry, selected as one unit — and the group has an id of its own. A map given layers
but no `center`/`zoom` opens fitted to their bounds, exactly as `Map()` does in Python.
Malformed configs no longer fail silently: the core warns on unknown types,
buffer/count mismatches, desynced property columns, seconds-shaped times, and `append`
ops whose `base` disagrees with the layer (`collectLayerProblems` exports the same
checks for linting up front).

## Any other host

`<SwiftMap>` and the anywidget entry are both hosts over one interface — five methods,
documented in `src/host.js`: `get(key)`, `set(key, value)`, `on(event, fn)`,
`send(content, buffers)`, `save_changes()`. Implement those over whatever state your
framework uses and the core runs unchanged; `createHostStub` is the reference
implementation, and it is what every static export runs on with no server behind it.

```js
import { createSwiftMap, createHostStub } from "swiftmap-core";
```

## License

MIT. Issues, docs and the Python package: https://github.com/Rkleisley/swiftmap
