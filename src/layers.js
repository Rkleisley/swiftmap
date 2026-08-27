import { bindPopup, bindTooltip, parseColor } from "./utils.js";
import { L } from "./libs.js";
import { pinShader } from "./shaders.js";
import { windowFor, featureInWindow, timesFor, layerInWindow, effectiveDuration,
         periodToMs } from "./timecontrol.js";
import { strippedTimeProps } from "./times.js";
import { buildTimeAttributes, attachTimeToInstance, timeVertexShader,
         gpuTimeAvailable, buildVectorTimeMeta, attachTimeToVectorInstance } from "./gputime.js";
import { createHeatLayer } from "./heat.js";
import { durationSeconds } from "./gputime.js";
import { lineDecoVertexShader, lineDecoFragmentShader, arrowVertexShader,
         ARROW_FRAGMENT, buildLineDistances, buildArrowPoints, arrowTimeAttrs,
         wireLineDeco, wireArrowDeco, combineTimeHandles } from "./linedeco.js";
import { createClusterLayer, clusterMetaKey } from "./cluster.js";

function setupGlifyProjection(glInstance) {
    if (glInstance && glInstance.layer) {
        glInstance.layer._unclampedProject = function(latlng, zoom) {
            return this._map.options.crs.latLngToPoint(latlng, zoom);
        };
        glInstance.layer.redraw();
    }
}

export function registerClickMatch(map, priority, action) {
    if (!map._clickMatches) {
        map._clickMatches = [];
    }
    map._clickMatches.push({ priority, action });
    if (!map._clickTimeout) {
        map._clickTimeout = setTimeout(() => {
            map._clickMatches.sort((a, b) => a.priority - b.priority);
            // While a Geoman mode is armed (the widget's click handler stamps this
            // per click, before any feature handler runs), EVERY match stands down:
            // a click in removal mode is a deletion attempt, and answering it with
            // a feature popup or a coords readout reads as "remove is broken".
            if (map._clickMatches.length > 0 && !map._pmModeActive) {
                map._clickMatches[0].action();
            }
            map._clickMatches = [];
            map._clickTimeout = null;
        }, 0);
    }
}

function registerHoverMatch(map, priority, action) {
    if (!map._hoverMatches) {
        map._hoverMatches = [];
    }
    map._hoverMatches.push({ priority, action });
    if (!map._hoverTimeout) {
        map._hoverTimeout = setTimeout(() => {
            map._hoverMatches.sort((a, b) => a.priority - b.priority);
            if (map._hoverMatches.length > 0) {
                map._hoverMatches[0].action();
            }
            map._hoverMatches = [];
            map._hoverTimeout = null;
        }, 0);
    }
}

// Style for one feature: its own entry from `feature_styles` when the layer carries
// varied styling, otherwise the layer's single style. Python only emits feature_styles
// when features actually differ, so a uniform layer costs nothing extra here.
// Four sources, least specific first. Each transient one lives in its own field rather
// than editing the layer's style, so clearing it restores what was underneath with
// nothing to remember and nothing to put back.
//
//   the layer's own style   what it was drawn with
//   feature_styles[i]       per feature, from the data
//   highlight_style         the whole layer is selected
//   style_overrides[i]      this feature is selected -- most specific, so it wins
export function styleFor(layer, index) {
    const fromData = Array.isArray(layer.feature_styles) ? layer.feature_styles[index] : null;
    const highlight = layer.highlight_style;
    const selected = layer.style_overrides && layer.style_overrides[index];
    if (!fromData && !highlight && !selected) return layer;
    return { ...layer, ...(fromData || {}), ...(highlight || {}), ...(selected || {}) };
}

export function getIndexedProperties(properties, index) {
    if (!properties) return {};
    const props = {};
    Object.keys(properties).forEach(k => {
        const val = properties[k];
        props[k] = Array.isArray(val) ? val[index] : val;
    });
    return props;
}



// An imagery overlay's identity: everything the rendered element derives from its
// config. The sync loop recreates the overlay when this changes (or when the
// binary buffer object under the layer id is replaced), since a DOM image is a
// single cheap node -- no incremental update machinery needed.
export function imageMetaKey(layer) {
    return JSON.stringify([layer.url || null, layer.bounds,
                           layer.opacity ?? 1, layer.image_format || null]);
}

// Georeferenced pixels pinned to a lat/lon box. The config is pure data --
// {type: "image", bounds, opacity, url | bytes under the layer id} -- so a
// plain-JS consumer passes a URL and the widget path ships bytes over the
// binary buffer transport. Python has already warped the raster into the MAP's
// own CRS grid (rasterio side), which is what makes Leaflet's linear corner
// stretch exactly correct; this stays a dumb renderer.
function renderImageLayer(map, layer, coordBuffer) {
    if (!layer.bounds) return null;
    let url = layer.url;
    let objectUrl = null;
    if (!url && coordBuffer) {
        const blob = new Blob([coordBuffer],
            { type: layer.image_format || "image/png" });
        objectUrl = url = URL.createObjectURL(blob);
    }
    if (!url) return null;
    const overlay = L.imageOverlay(url, layer.bounds, {
        opacity: layer.opacity ?? 1,
        // Context, not a click target: clicks fall through to features and the
        // empty-map coordinate fallback. The default overlayPane (z 400)
        // already sits above tiles (200) and below the GL panes (410+).
        interactive: false,
    });
    if (objectUrl) {
        overlay.on("remove", () => URL.revokeObjectURL(objectUrl));
    }
    overlay.addTo(map);
    overlay.layerType = layer.type;
    overlay.imageMeta = imageMetaKey(layer);
    overlay.imageSource = coordBuffer || null;
    return overlay;
}

// Everything the heat draw depends on besides the buffers themselves: a change
// here must recreate the instance, exactly like imageMetaKey above.
export function heatMetaKey(layer) {
    return JSON.stringify([layer.radius, layer.opacity, layer.max_intensity,
        layer.ramp, layer.source || null,
        layer.cells || null, layer.vmin ?? null, layer.vmax ?? null,
        layer.cell_counts || null, layer.auto_normalize ?? true]);
}

// A layer by id, descending into groups -- a heat source may be a merged
// collection's member.
export function findLayerById(layers, id) {
    for (const layer of layers || []) {
        if (layer.id === id) return layer;
        if (layer.type === "group" && Array.isArray(layer.layers)) {
            const hit = findLayerById(layer.layers, id);
            if (hit) return hit;
        }
    }
    return null;
}

// The time inputs a heat instance bakes at build: its own time config -- or
// its SOURCE layer's, so heat over an animated layer animates with it --
// plus the shared period the "period" duration resolves against. A change in
// any of these recreates the instance, like the GL buckets' meta key.
export function heatTimeKey(layer, sourceLayer, timeState) {
    return JSON.stringify([
        layer.time ?? (sourceLayer ? sourceLayer.time : null) ?? null,
        timeState && timeState.period ? timeState.period : null,
    ]);
}

function renderHeatLayer(map, layer, coordinateBuffers, allLayers, timeState) {
    const coordView = coordinateBuffers[layer.source || layer.id] || null;
    if (!coordView) {
        if (layer.source) {
            console.warn(`[SwiftMap] heatmap ${layer.name || layer.id}: source `
                + `layer ${layer.source} has no coordinate buffer; nothing to draw.`);
        }
        return null;
    }
    const weightsView = coordinateBuffers[`${layer.id}::weights`] || null;
    const sourceLayer = layer.source ? findLayerById(allLayers, layer.source) : null;
    const timeCfg = layer.time ?? (sourceLayer ? sourceLayer.time : null) ?? null;
    const timesView = coordinateBuffers[`${layer.source || layer.id}::times`] || null;
    let timeOpts = null;
    if (timeCfg && timesView) {
        const periodMs = timeState && timeState.period
            ? periodToMs(timeState.period) : null;
        const durationSec = (timeCfg.fade ? -1 : 1)
            * durationSeconds(timeCfg.duration, periodMs);
        timeOpts = { timesView, durationSec };
    }
    const valuesView = coordinateBuffers[`${layer.id}::values`] || null;
    const instance = createHeatLayer(L, layer, coordView, weightsView, timeOpts,
        valuesView);
    instance.addTo(map);
    instance.layerType = layer.type;
    instance.heatMeta = heatMetaKey(layer);
    instance.heatCoordSource = coordView;
    instance.heatWeightSource = weightsView;
    instance.heatValuesSource = valuesView;
    instance.heatTimesSource = timesView;
    instance.heatTimeKey = heatTimeKey(layer, sourceLayer, timeState);
    return instance;
}

// A non-GL layer (image overlay, or a group of them) as a Leaflet layer. Takes the
// LIVE buffer map the core keeps -- patches land there, never in a host trait.
export async function renderLayer(map, layer, coordBuffer, coordinateBuffers = {},
                                  allLayers = [], timeState = null, events = null) {
    if (layer.type === "heatmap") {
        return renderHeatLayer(map, layer, coordinateBuffers, allLayers, timeState);
    }
    if (layer.cluster && (layer.type === "circle_markers" || layer.type === "markers")) {
        if (!coordBuffer) return null;
        const instance = createClusterLayer(layer, coordBuffer, coordinateBuffers,
            events && events.onFeatureClick);
        instance.addTo(map);
        instance.layerType = layer.type;
        instance.clusterMeta = clusterMetaKey(layer);
        instance.clusterCoordSource = coordBuffer;
        instance.clusterColorsSource = coordinateBuffers[`${layer.id}::colors`] || null;
        return instance;
    }
    if (layer.type === "image") {
        return renderImageLayer(map, layer, coordBuffer);
    }
    if (layer.type === "group") {
        const group = L.layerGroup();
        for (const sub of layer.layers) {
            // Merged-bucket kinds render there -- EXCEPT clustered members,
            // which own their instance like any clustered layer.
            if (!sub.cluster && (sub.type === "circle_markers" || sub.type === "markers"
                    || sub.type === "polyline" || sub.type === "polygon"
                    || sub.type === "circle")) {
                continue;
            }
            const instance = await renderLayer(map, sub, coordinateBuffers[sub.id],
                coordinateBuffers, allLayers, timeState, events);
            if (instance) {
                group.addLayer(instance);
            }
        }
        group.addTo(map);
        group.layerType = layer.type;
        return group;
    }
    return null;
}

// A vector layer's coordinates: the binary buffer under its id when Python built it
// (the layers JSON then carries no coordinates at all), or inline `locations` for
// hand-built configs and fixtures. Materialised only on rebuild, which vector buckets
// on the GPU path rarely do.
export function vectorCoords(layer, coordinateBuffers) {
    if (layer.locations) return layer.locations;
    const raw = coordinateBuffers[layer.id];
    if (!raw) return null;
    const flat = new Float64Array(raw.buffer || raw, raw.byteOffset || 0,
        (raw.byteLength || raw.length) / 8);
    const out = new Array(flat.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = [flat[i * 2], flat[i * 2 + 1]];
    }
    return out;
}

// A line layer's coordinates as parts: the flat run sliced by the config's `parts`
// length table, or one part without it. A multi-part line -- MULTILINESTRING,
// MultiLineString -- is ONE layer drawn as disjoint runs; nothing may ever draw a
// segment from one part's last vertex to the next part's first.
export function lineParts(layer, coordinateBuffers) {
    const locs = vectorCoords(layer, coordinateBuffers) || [];
    const lengths = Array.isArray(layer.parts) && layer.parts.length > 1 ? layer.parts : null;
    if (!lengths) return locs.length ? [locs] : [];
    const parts = [];
    let offset = 0;
    for (const n of lengths) {
        const part = locs.slice(offset, offset + n);
        offset += n;
        if (part.length >= 2) parts.push(part);
    }
    return parts;
}

function closeRing(ring) {
    if (ring.length > 0) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push([first[0], first[1]]);
        }
    }
    return ring;
}

// glify's line hit tolerance is `sensitivity + weight/scale`, and sensitivity is a
// CONSTANT in latlng degrees -- 0.1 for clicks (~11 km) and 0.03 for hovers,
// zoom-blind, so a click within sight of a line matched it and starved the
// empty-map fallback. The weight/scale term already covers the drawn width;
// replace the constant with a few pixels' worth at the current zoom. The instance
// getters read `settings` live per event, so updating on zoom is enough -- no
// glify patching. Returns the unsubscribe for onRemove.
const LINE_HIT_SLACK_PX = 8;
function trackLineSensitivity(map, instance) {
    const apply = () => {
        const slack = LINE_HIT_SLACK_PX / Math.pow(2, map.getZoom());
        instance.settings.sensitivity = slack;
        instance.settings.sensitivityHover = slack;
    };
    apply();
    map.on("zoomend", apply);
    return () => map.off("zoomend", apply);
}

// An area layer's geometry as parts -> closed [lon, lat] rings: a polygon's flat
// coordinate run sliced by its `rings` table (one hole-free ring without it), or a
// circle's generated ring. Feeds both the fill (earcut, in the polygon bucket) and
// the outline (LineStrings in the lines bucket).
function areaParts(layer, coordinateBuffers) {
    if (layer.type === "circle") {
        const lat = layer.location[0];
        const lon = layer.location[1];
        const radiusMeters = layer.radius || 10;
        const earthRadius = 6378137;
        const ring = [];
        for (let i = 0; i <= 32; i++) {
            const angle = (i * 360) / 32;
            const angleRad = (angle * Math.PI) / 180;
            const dLat = (radiusMeters * Math.cos(angleRad)) / earthRadius;
            const dLon = (radiusMeters * Math.sin(angleRad)) / (earthRadius * Math.cos((lat * Math.PI) / 180));
            ring.push([lon + (dLon * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
        }
        return [[ring]];
    }
    const locs = vectorCoords(layer, coordinateBuffers) || [];
    const lonlat = locs.map(c => [c[1], c[0]]);
    const ringTable = layer.rings || (lonlat.length > 0 ? [[lonlat.length]] : []);
    const parts = [];
    let at = 0;
    for (const partLens of ringTable) {
        const rings = [];
        for (const len of partLens) {
            const ring = closeRing(lonlat.slice(at, at + len));
            at += len;
            if (ring.length >= 4) rings.push(ring);
        }
        if (rings.length > 0) parts.push(rings);
    }
    return parts;
}

// `events.onFeatureClick({ layer, index, latlng })` is how a click reaches whatever
// hosts the map; this module never writes state itself.
export async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, events,
                                           timeState = null, vectorGpu = false,
                                           isFeatureVisible = null) {
    const onFeatureClick = (events && events.onFeatureClick) || (() => {});
    // Hit-test guard: GPU-path buckets hold hidden layers (and out-of-window
    // features), masked only by shader uniforms glify's hit-tests cannot see. The
    // widget passes a live lookup; the fallback covers plain-JS consumers with the
    // config's own flag.
    const visibleNow = isFeatureVisible || ((l) => l.visible !== false);
    // Lines, polygons and circles are one geometry per layer. On the GPU path (map.js
    // passes vectorGpu when the bucket qualifies) every feature stays in the buffers and
    // the shader decides visibility per tick and per layer toggle -- a line-shaped track
    // has as many vertices as a point track has points, so its rebuilds cost the same
    // and crashed the same way. Off the GPU path, the whole-feature CPU filter remains.
    const vectorMeta = vectorGpu && type !== "circle_markers" && type !== "markers"
        ? buildVectorTimeMeta(layersList, coordinateBuffers,
            timeState && timeState.period ? periodToMs(timeState.period) : null)
        : { hasTime: false };
    const vectorTime = Boolean(vectorMeta.hasTime);
    if (timeState && !vectorTime && type !== "circle_markers" && type !== "markers") {
        layersList = layersList.filter(l => layerInWindow(l, coordinateBuffers, timeState));
        if (layersList.length === 0) return null;
    }
    if (type === "polyline") {
        const features = [];
        const vertexCounts = [];
        for (const layer of layersList) {
            const style = styleFor(layer, 0);
            const rgb = parseColor(style.color, "#3388ff");

            // Area outlines: a polygon or circle in this bucket contributes each of its
            // rings as one LineString, drawn with the area's stroke options -- color,
            // weight, opacity, Leaflet's own semantics. Outline weight and opacity never
            // rendered before this; the fill machinery cannot draw them (glify's border
            // is 1px and fill-coloured), the lines machinery already does.
            if (layer.type === "polygon" || layer.type === "circle") {
                let count = 0;
                if ((style.weight ?? 3) > 0 && (style.opacity ?? 1.0) > 0) {
                    for (const rings of areaParts(layer, coordinateBuffers)) {
                        for (const ring of rings) {
                            count += Math.max(0, 2 * (ring.length - 1));
                            features.push({
                                type: "Feature",
                                geometry: { type: "LineString", coordinates: ring },
                                properties: {
                                    layer: layer,
                                    // Outline pixels only -- the area's shapes instance
                                    // owns interaction with exact containment. Left
                                    // clickable, these rings answered through glify's
                                    // line tolerance (0.1 DEGREES for clicks vs 0.03
                                    // for hovers): popups well outside the shape and
                                    // inside holes, hover disagreeing with click.
                                    isBorder: true,
                                    colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.opacity || 1.0 },
                                    weight: style.weight || 3
                                }
                            });
                        }
                    }
                }
                vertexCounts.push(count);   // 0 keeps the slot aligned when strokeless
                continue;
            }

            // One LineString feature PER PART, every part carrying the layer -- never
            // a MultiLineString: glify's MultiLineString path hit-tests the connector
            // between parts, which is the phantom segment by another route. The GL
            // vertex stream stays consecutive, so the per-layer count still aligns
            // the time attributes; a strokeless or degenerate layer keeps its slot.
            let count = 0;
            for (const part of lineParts(layer, coordinateBuffers)) {
                const geojsonCoords = part.map(c => [c[1], c[0]]);
                count += Math.max(0, 2 * (geojsonCoords.length - 1));
                features.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: geojsonCoords
                    },
                    properties: {
                        layer: layer,
                        colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.opacity || 1.0 },
                        weight: style.weight || 3
                    }
                });
            }
            vertexCounts.push(count);
        }

        if (features.length === 0) return null;

        const geojson = {
            type: "FeatureCollection",
            features: features
        };

        const glLayer = L.Layer.extend({
            onAdd: function(m) {
                this._map = m;
                this._isHovering = false;
                
                this._mapMouseMoveHandler = (e) => {
                    setTimeout(() => {
                        if (!this._isHovering) {
                            map.getContainer().style.cursor = '';
                            if (this._sharedTooltip) {
                                this._sharedTooltip.remove();
                                this._sharedTooltip = null;
                            }
                        }
                        this._isHovering = false;
                    }, 0);
                };
                m.on("mousemove", this._mapMouseMoveHandler);

                // Any dash in the bucket switches to the decoration shader
                // pair -- a superset of the time shader (same attribute
                // contract), so the two compose instead of competing.
                const anyDash = layersList.some(
                    l => Array.isArray(l.dash) && l.dash.length >= 2);
                const anyArrows = layersList.some(l => l.arrows);
                const lineOptions = anyDash
                    ? { vertexShaderSource: () => lineDecoVertexShader(),
                        fragmentShaderSource: () => lineDecoFragmentShader() }
                    : vectorTime
                        ? { vertexShaderSource: () => timeVertexShader() } : {};
                this.glLines = L.glify.lines({
                    ...lineOptions,
                    map: m,
                    data: geojson,
                    pane: "polylinesPane",
                    // The data above is GeoJSON, whose coordinates are [lon, lat]; glify
                    // defaults to latitude-first and its LINE vertex builder reads
                    // coordinates through these keys -- unset, it took longitude as
                    // latitude and projected every line off-viewport. Silently: no GL
                    // error, a healthy canvas, zero fragments. Set per instance rather
                    // than on the L.glify global, which another library could also
                    // mutate. The polygon path is deliberately NOT given these keys:
                    // it triangulates via earcut on the GeoJSON directly, native
                    // [lon, lat], and keys there would transpose it the same way.
                    // Found by the Valhalla-VRE bug report, driving the plain-JS
                    // bundle where no points masked the blank lines.
                    latitudeKey: 1,
                    longitudeKey: 0,
                    color: (index, feature) => {
                        return feature.properties.colorRGB;
                    },
                    weight: (index, feature) => {
                        return feature.properties.weight;
                    },
                    click: (e, feature) => {
                        if (!feature || !feature.properties || feature.properties.isBorder
                                || !feature.properties.layer
                                || !visibleNow(feature.properties.layer)) return;
                        registerClickMatch(map, 2, () => {
                            if (feature && feature.properties && feature.properties.layer) {
                                const layer = feature.properties.layer;
                                bindPopup(map, e.latlng, layer.properties, layer);
                                // Where the click landed: the host records "where"
                                // and "on what" -- see onFeatureClick in core.js.
                                onFeatureClick({
                                    layer, index: 0,
                                    latlng: [Math.round(e.latlng.wrap().lat * 1e5) / 1e5,
                                             Math.round(e.latlng.wrap().lng * 1e5) / 1e5],
                                });
                            }
                        });
                    },
                    hover: (e, feature) => {
                        this._isHovering = true;
                        if (feature && feature.properties && !feature.properties.isBorder
                                && feature.properties.layer
                                && visibleNow(feature.properties.layer)) {
                            registerHoverMatch(map, 2, () => {
                                const layer = feature.properties.layer;
                                map.getContainer().style.cursor = 'pointer';
                                bindTooltip(map, e.latlng, layer.properties, layer, this);
                            });
                        }
                    }
                });
                setupGlifyProjection(this.glLines);
                this._sensitivityOff = trackLineSensitivity(m, this.glLines);

                // Decoration wiring runs BEFORE the time attach: its
                // always-visible defaults are exactly what the time wiring
                // overwrites when a slider is aboard. A wiring failure warns
                // and costs the decoration, never the line.
                let lineDeco = null;
                if (anyDash) {
                    try {
                        const { dists, dash } = buildLineDistances(features);
                        lineDeco = wireLineDeco(this.glLines, dists, dash);
                    } catch (err) {
                        console.warn(`[SwiftMap] line dashes disabled: ${err.message}`);
                    }
                }
                let arrowHandle = null;
                if (anyArrows) {
                    try {
                        const arrows = buildArrowPoints(features);
                        if (arrows.latlngs.length) {
                            this.glArrows = L.glify.points({
                                map: m,
                                data: arrows.latlngs,
                                pane: "polylinesPane",
                                size: (i) => arrows.sizes[i],
                                color: (i) => arrows.colors[i],
                                // Decoration, not a click target: arrows must
                                // never win a click from the line under them.
                                picking: false,
                                vertexShaderSource: () => arrowVertexShader(),
                                fragmentShaderSource: () => ARROW_FRAGMENT,
                            });
                            setupGlifyProjection(this.glArrows);
                            this._arrowDeco = wireArrowDeco(
                                this.glArrows, arrows.angles, arrows.segLens);
                            if (vectorTime) {
                                const layerPos = new Map(
                                    layersList.map((l, i) => [l, i]));
                                arrowHandle = attachTimeToInstance(this.glArrows,
                                    arrowTimeAttrs(arrows, layerPos, vectorMeta));
                            }
                        }
                    } catch (err) {
                        console.warn(`[SwiftMap] line arrows disabled: ${err.message}`);
                    }
                }
                if (lineDeco || this._arrowDeco) {
                    const applyPx = () => {
                        const px = Math.pow(2, m.getZoom());
                        if (lineDeco) lineDeco.setPxPerWorld(px);
                        if (this._arrowDeco) this._arrowDeco.setPxPerWorld(px);
                    };
                    applyPx();
                    m.on("zoomend", applyPx);
                    this._decoOff = () => m.off("zoomend", applyPx);
                }
                if (vectorTime) {
                    const lineHandle = attachTimeToVectorInstance(this.glLines, vectorMeta, vertexCounts);
                    this._swiftmapTime = combineTimeHandles(lineHandle, arrowHandle);
                }
            },
            onRemove: function(m) {
                if (this._mapMouseMoveHandler) {
                    m.off("mousemove", this._mapMouseMoveHandler);
                }
                if (this._sensitivityOff) this._sensitivityOff();
                if (this._decoOff) this._decoOff();
                if (this.glArrows) this.glArrows.remove();
                if (this.glLines) this.glLines.remove();
                if (this._sharedTooltip) {
                    this._sharedTooltip.remove();
                    this._sharedTooltip = null;
                }
                map.getContainer().style.cursor = '';
            }
        });
        const instance = new glLayer();
        instance.addTo(map);
        instance.layerType = type;
        return instance;
    }

    if (type === "polygon") {
        const features = [];
        const vertexCounts = [];
        for (const layer of layersList) {
            const parts = areaParts(layer, coordinateBuffers);
            if (parts.length === 0) {
                vertexCounts.push(0);   // no feature, but the slot must stay aligned
                continue;
            }
            // Any triangulation of a polygon with D distinct vertices and h holes has
            // exactly D + 2h - 2 triangles -- a property of geometry, not of glify's
            // earcut; h = 0 gives the familiar D - 2. Rings are closed by now, so each
            // contributes length - 1 distinct vertices. Parts triangulate separately
            // and sum.
            let triangles = 0;
            for (const rings of parts) {
                const distinct = rings.reduce((sum, r) => sum + r.length - 1, 0);
                triangles += Math.max(0, distinct + 2 * (rings.length - 1) - 2);
            }
            vertexCounts.push(3 * triangles);

            const style = styleFor(layer, 0);
            // Leaflet's own semantics: the fill is fillColor, defaulting to the stroke
            // color when unset. It used to always fill with `color`, which made
            // "red outline, pale blue fill" -- the most basic polygon styling ask --
            // impossible; the outline itself is drawn by the lines bucket.
            const rgb = parseColor(style.fillColor || style.fill_color || style.color, "#3388ff");
            // One Feature PER PART, never a MultiPolygon: glify's shapes only
            // explodes MultiPolygon when handed a bare Feature or geometry -- in a
            // FeatureCollection the coordinates reach earcut.flatten unexploded,
            // earcut returns no indices, and the feature silently draws ZERO fill
            // triangles (verified against glify 3.3.0; its "unhandled polygon"
            // throw sits inside the empty loop and never fires). Parts stay
            // consecutive, so per-layer vertexCounts still align for GPU time.
            for (const rings of parts) {
                features.push({
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: rings },
                    properties: {
                        layer: layer,
                        colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.fillOpacity || 0.2 }
                    }
                });
            }
        }

        if (features.length === 0) return null;

        const geojson = {
            type: "FeatureCollection",
            features: features
        };

        const glLayer = L.Layer.extend({
            onAdd: function(m) {
                this._map = m;
                this._isHovering = false;
                
                this._mapMouseMoveHandler = (e) => {
                    setTimeout(() => {
                        if (!this._isHovering) {
                            map.getContainer().style.cursor = '';
                            if (this._sharedTooltip) {
                                this._sharedTooltip.remove();
                                this._sharedTooltip = null;
                            }
                        }
                        this._isHovering = false;
                    }, 0);
                };
                m.on("mousemove", this._mapMouseMoveHandler);

                const shapeOptions = vectorTime
                    ? { vertexShaderSource: () => timeVertexShader() } : {};
                this.glShapes = L.glify.shapes({
                    ...shapeOptions,
                    map: m,
                    data: geojson,
                    pane: "polygonsPane",
                    color: (index, feature) => {
                        return feature.properties.colorRGB;
                    },
                    click: (e, feature) => {
                        if (!feature || !feature.properties || !feature.properties.layer
                                || !visibleNow(feature.properties.layer)) return;
                        registerClickMatch(map, 3, () => {
                            if (feature && feature.properties && feature.properties.layer) {
                                const layer = feature.properties.layer;
                                bindPopup(map, e.latlng, layer.properties, layer);
                                // Where the click landed: the host records "where"
                                // and "on what" -- see onFeatureClick in core.js.
                                onFeatureClick({
                                    layer, index: 0,
                                    latlng: [Math.round(e.latlng.wrap().lat * 1e5) / 1e5,
                                             Math.round(e.latlng.wrap().lng * 1e5) / 1e5],
                                });
                            }
                        });
                    },
                    hover: (e, feature) => {
                        this._isHovering = true;
                        if (feature && feature.properties && feature.properties.layer
                                && visibleNow(feature.properties.layer)) {
                            registerHoverMatch(map, 3, () => {
                                const layer = feature.properties.layer;
                                map.getContainer().style.cursor = 'pointer';
                                bindTooltip(map, e.latlng, layer.properties, layer, this);
                            });
                        }
                    }
                });
                setupGlifyProjection(this.glShapes);
                if (vectorTime) {
                    this._swiftmapTime = attachTimeToVectorInstance(this.glShapes, vectorMeta, vertexCounts);
                }
            },
            onRemove: function(m) {
                if (this._mapMouseMoveHandler) {
                    m.off("mousemove", this._mapMouseMoveHandler);
                }
                if (this.glShapes) this.glShapes.remove();
                if (this._sharedTooltip) {
                    this._sharedTooltip.remove();
                    this._sharedTooltip = null;
                }
                map.getContainer().style.cursor = '';
            }
        });
        const instance = new glLayer();
        instance.addTo(map);
        instance.layerType = type;
        return instance;
    }

    const pointsList = [];
    const indexMapping = [];

    const fallbackColor = type === "markers" ? "#e61a26" : "#3388ff";
    // glify's fallback when a layer declares no radius. Pins need far more room than a
    // circle because the glyph is drawn inside the point's own quad by the shader.
    const defaultSize = type === "markers" ? 64 : 5;

    // GPU time path: when this bucket holds time layers, every point is fed to glify and
    // per-point time rides along as vertex attributes -- the window test happens in the
    // vertex shader, so a tick costs two uniforms instead of rebuilding 5M points in JS.
    // The CPU filter below stays as the fallback when the GL wiring is unavailable.
    const gpuAttrs = gpuTimeAvailable()
        ? buildTimeAttributes(layersList, coordinateBuffers,
            timeState && timeState.period ? periodToMs(timeState.period) : null)
        : { hasTime: false };
    const gpuTime = Boolean(gpuAttrs.hasTime);

    for (const layer of layersList) {
        const colorRGB = parseColor(layer.color, fallbackColor);
        const layerSize = layer.radius != null ? Number(layer.radius) : defaultSize;

        const coordBuffer = coordinateBuffers[layer.id];
        if (!coordBuffer) {
            if (layer.location && layerInWindow(layer, coordinateBuffers, timeState)) {
                pointsList.push([layer.location[0], layer.location[1]]);
                indexMapping.push({
                    layer: layer,
                    originalIndex: 0,
                    colorRGB: colorRGB,
                    size: layerSize
                });
            }
            continue;
        }

        const coords = new Float64Array(
            coordBuffer.buffer,
            coordBuffer.byteOffset,
            coordBuffer.byteLength / 8
        );
        const count = coords.length / 2;

        const perFeature = Array.isArray(layer.feature_styles) ? layer.feature_styles : null;
        // Selection styling, applied over the layer's own and its data-driven styles.
        // Same precedence as styleFor: data, then whole-layer highlight, then per-feature.
        const highlight = layer.highlight_style || null;
        const overrides = layer.style_overrides || null;
        // Data-driven styling arrives as binary buffers beside the coordinates --
        // u8 RGBA under "<id>::colors", f32 pixels under "<id>::radii" -- computed
        // in Python from color_col/radius_col. Buffers, never per-feature style
        // dicts: at millions of points, style dicts in the layers JSON are the
        // payload that used to kill sessions. Explicit styles still outrank them.
        const colorsRaw = coordinateBuffers[`${layer.id}::colors`];
        const bufColors = colorsRaw
            ? new Uint8Array(colorsRaw.buffer || colorsRaw, colorsRaw.byteOffset || 0,
                             colorsRaw.byteLength)
            : null;
        const radiiRaw = coordinateBuffers[`${layer.id}::radii`];
        const bufRadii = radiiRaw
            ? new Float32Array(radiiRaw.buffer || radiiRaw, radiiRaw.byteOffset || 0,
                               radiiRaw.byteLength / 4)
            : null;
        // The current time window, when this layer is animated. Features outside it are
        // simply not pushed; indexMapping carries originalIndex, so popups and properties
        // on the survivors keep pointing at the right rows.
        const win = !gpuTime && timeState && layer.time
            ? windowFor(timeState.tick, effectiveDuration(layer, timeState), timeState.period)
            : null;
        const times = win ? timesFor(layer, coordinateBuffers) : null;

        for (let i = 0; i < count; i++) {
            if (times && !featureInWindow(times[i * 2], times[i * 2 + 1], win)) continue;
            const fromData = perFeature ? perFeature[i] : null;
            const selected = overrides ? overrides[i] : null;
            const color = (selected && selected.color)
                || (highlight && highlight.color)
                || (fromData && fromData.color);
            const radius = selected && selected.radius != null ? selected.radius
                : highlight && highlight.radius != null ? highlight.radius
                : fromData && fromData.radius != null ? fromData.radius
                : null;

            pointsList.push([coords[i * 2], coords[i * 2 + 1]]);
            indexMapping.push({
                layer: layer,
                originalIndex: i,
                colorRGB: color ? parseColor(color, fallbackColor)
                    : bufColors ? { r: bufColors[i * 4] / 255,
                                    g: bufColors[i * 4 + 1] / 255,
                                    b: bufColors[i * 4 + 2] / 255,
                                    a: bufColors[i * 4 + 3] / 255 }
                    : colorRGB,
                size: radius != null ? Number(radius)
                    : bufRadii ? bufRadii[i]
                    : layerSize
            });
        }
    }

    if (pointsList.length === 0) return null;

    // glify hands the hit point back as the SAME array reference it was fed,
    // so identity is the key -- and indexOf was a linear reference-scan over
    // the whole merged bucket per mousemove: an O(1M) walk to show a tooltip
    // on the landing page's hero. Built once, looked up in O(1).
    const pointIndex = new Map(pointsList.map((p, i) => [p, i]));

    const glLayer = L.Layer.extend({
        onAdd: function(m) {
            this._map = m;
            this._isHovering = false;
            
            const getInteractiveEl = () => {
                return map.getPane("pointsPane").querySelector("canvas") || map.getContainer();
            };
            
            this._mapMouseMoveHandler = (e) => {
                setTimeout(() => {
                    if (!this._isHovering) {
                        map.getContainer().style.cursor = '';
                        const el = getInteractiveEl();
                        if (el) el.style.cursor = '';
                        if (this._sharedTooltip) {
                            this._sharedTooltip.remove();
                            this._sharedTooltip = null;
                        }
                    }
                    this._isHovering = false;
                }, 0);
            };
            m.on("mousemove", this._mapMouseMoveHandler);

            const glifyOptions = {
                map: m,
                data: pointsList,
                pane: "pointsPane",
                // Resolved per point, like colour: several layers share one glify instance,
                // so a single constant here silently discarded every layer's own radius.
                size: (index) => {
                    const info = indexMapping[index];
                    return info && info.size != null ? info.size : defaultSize;
                },
                color: (index, point) => {
                    const info = indexMapping[index];
                    return info ? info.colorRGB : { r: 0.2, g: 0.5, b: 1.0 };
                },
                picking: true,
                sensitivity: type === "markers" ? 20 : 8,
                click: (e, point) => {
                    if (!point) return;

                    // Enforce a strict pixel-distance threshold to prevent popups on far away clicks
                    const clickPoint = map.latLngToContainerPoint(e.latlng);
                    const markerPoint = map.latLngToContainerPoint(L.latLng(point[0], point[1]));
                    const pixelDist = clickPoint.distanceTo(markerPoint);
                    const maxDist = type === "markers" ? 25 : 12;
                    if (pixelDist > maxDist) return;

                    // Resolved BEFORE competing for the click: a hidden or
                    // out-of-window point must not enter the arbitration at all, so
                    // whatever sits beneath it -- a visible feature, or the
                    // empty-map fallback -- wins instead.
                    const idx = pointIndex.get(point) ?? -1;
                    const preInfo = indexMapping[idx];
                    if (!preInfo || !visibleNow(preInfo.layer, preInfo.originalIndex)) {
                        return;
                    }
                    registerClickMatch(map, 1, () => {
                        const info = preInfo;
                        if (info) {
                            const layer = info.layer;
                            const originalIndex = info.originalIndex;
                            const props = {
                                ...getIndexedProperties(layer.properties, originalIndex),
                                ...(strippedTimeProps(layer,
                                    coordinateBuffers[`${layer.id}::times`],
                                    originalIndex) || {}),
                            };
                            bindPopup(map, point, props, layer);
                            // The clicked point's own coordinates -- more truthful
                            // than the mouse position for a point.
                            onFeatureClick({ layer, index: originalIndex,
                                             latlng: [point[0], point[1]] });
                        }
                    });
                },
                hover: (e, point) => {
                    this._isHovering = true;
                    if (point) {
                        // Enforce a strict pixel-distance threshold to prevent tooltips on far away hovers
                        const hoverPoint = map.latLngToContainerPoint(e.latlng);
                        const markerPoint = map.latLngToContainerPoint(L.latLng(point[0], point[1]));
                        const pixelDist = hoverPoint.distanceTo(markerPoint);
                        const maxDist = type === "markers" ? 25 : 12;
                        if (pixelDist > maxDist) return;

                        const idx = pointIndex.get(point) ?? -1;
                        const info = indexMapping[idx];
                        if (!info || !visibleNow(info.layer, info.originalIndex)) {
                            return;
                        }
                        registerHoverMatch(map, 1, () => {
                            map.getContainer().style.cursor = 'pointer';
                            const el = getInteractiveEl();
                            if (el) el.style.cursor = 'pointer';
                            if (info) {
                                const layer = info.layer;
                                const originalIndex = info.originalIndex;
                                const props = {
                                ...getIndexedProperties(layer.properties, originalIndex),
                                ...(strippedTimeProps(layer,
                                    coordinateBuffers[`${layer.id}::times`],
                                    originalIndex) || {}),
                            };
                                bindTooltip(map, point, props, layer, this);
                            }
                        });
                    }
                }
            };

            if (type === "markers") {
                glifyOptions.fragmentShaderSource = () => pinShader;
            }

            if (gpuTime) {
                glifyOptions.vertexShaderSource = () => timeVertexShader();
            }
            this.glPoints = L.glify.points(glifyOptions);
            setupGlifyProjection(this.glPoints);
            if (gpuTime) {
                // Null on failure, which also flips the global flag: the next sync's
                // rebuild key changes with it and the CPU path takes over.
                this._swiftmapTime = attachTimeToInstance(this.glPoints, gpuAttrs);
            }
        },
        onRemove: function(m) {
            if (this._mapMouseMoveHandler) {
                m.off("mousemove", this._mapMouseMoveHandler);
            }
            if (this.glPoints) this.glPoints.remove();
            if (this._sharedTooltip) {
                this._sharedTooltip.remove();
                this._sharedTooltip = null;
            }
            map.getContainer().style.cursor = '';
            const canvas = map.getPane("pointsPane").querySelector("canvas");
            if (canvas) canvas.style.cursor = '';
        }
    });

    const instance = new glLayer();
    instance.addTo(map);
    instance.layerType = type;
    return instance;
}
