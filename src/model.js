// createMapModel: the authoring surface in JS.
//
// Phase 3's first stage. The rendering core (createSwiftMap) has been
// framework-agnostic since Phase 2, but everything that BUILDS what it renders --
// add_circle_markers, the merge rule, bounds, the buffer packing -- lived only in
// Python, so a JS app hand-wrote configs at every call site or grew a model layer
// of its own (react_test_app/GAPS.md, gap 1). This is that layer, in the core,
// with Python's Map as its specification.
//
// CONFORMANCE, not translation: there is no runtime bridge between the two sides
// (the server has no JS engine, the browser no Python), so the rules exist twice
// and are held together by golden fixtures. scripts/authoring_goldens.py builds
// canonical scenarios through the real Python Map and commits the exact state and
// buffers; tests/test_authoring_goldens.py keeps Python matching them, and
// test/tier1-model.test.mjs keeps THIS FILE matching them, byte-for-byte on
// buffers. A rule changed on either side breaks a suite loudly.
//
// The shape is Python's, deliberately: mutate the model, then snapshot. Mutators
// rebuild the arrays they touch, so a snapshot's identities change exactly when
// something changed -- what React needs, and the same invariant Python's
// transport keeps for its own reasons.
//
// Covered so far: the builders (circle markers, pin markers, lines, polygons)
// over column-dict / row-object / coordinate-pair inputs; default folders and
// group_configs; radio seeding; the merge promotion; bounds and the auto-fit
// union; data-driven colour and size with their legend blocks; findLayers /
// getLayer; hide / show / select / setLayersVisibility; removeLayers; and
// updateLayer -- attributes, data replace, and the append delta whose wire cost
// is the batch, not the layer. Every mutation EMITS the same ops Python's
// transport emits (model.opLog records them; the onPatch option streams them),
// so a live consumer can forward deltas to applyPatch and the op-stream goldens
// pin the wire byte-for-byte. Still to come: WKT/GeoJSON ingestion,
// labels/feature styles/highlight, time layers, the basemap catalogue.

import { layersBoundsUnion } from "./utils.js";
import { resolveColormap, dataDrivenColors, dataDrivenRadii,
         dataDrivenLegend, dataDrivenSizeLegend } from "./colormaps.js";
import { isValidPeriod, normalizeLayerTimes } from "./times.js";
import { XYZ, ALIASES as BASEMAP_ALIASES, PRESETS, WMS,
         DEFAULT_BASEMAPS, queryKey } from "./basemap-catalog.js";
import { featuresOf, pointPairsOf, linePartsOf, polygonPartsOf,
         POINT_GEOMETRY, LINE_GEOMETRY, POLYGON_GEOMETRY } from "./geo.js";

// Mirrors TIME_POSITIONS in swiftmap/mapops/time.py and POSITIONS in
// src/timecontrol.js; the sets must not drift.
const TIME_POSITIONS = new Set([
    "top-left", "top-center", "top-right", "left-center", "right-center",
    "bottom-left", "bottom-center", "bottom-right",
]);

// An option under either naming convention: the JS surface takes camelCase, the
// wire and anyone porting Python code takes snake_case, both mean the same thing.
function opt(options, camel, snake, fallback) {
    if (options[camel] !== undefined) return options[camel];
    if (options[snake] !== undefined) return options[snake];
    return fallback;
}

function packPairs(pairs) {
    const flat = new Float64Array(pairs.length * 2);
    for (let i = 0; i < pairs.length; i++) {
        flat[i * 2] = pairs[i][0];
        flat[i * 2 + 1] = pairs[i][1];
    }
    return new DataView(flat.buffer);
}

function boundsOfPairs(pairs) {
    if (!pairs.length) return null;
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const [lat, lon] of pairs) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
    }
    return [[minLat, minLon], [maxLat, maxLon]];
}

const LAT_NAMES = ["lat", "latitude", "y"];
const LON_NAMES = ["lon", "lng", "long", "longitude", "x"];

function findColumn(keys, wanted, explicit) {
    if (explicit) return explicit;
    const lower = keys.map(k => k.toLowerCase());
    for (const name of wanted) {
        const i = lower.indexOf(name);
        if (i !== -1) return keys[i];
    }
    return null;
}

// Points from the three JS-native shapes: [[lat, lon], ...], a column dict
// ({lat: [...], lon: [...], other: [...]}), or rows of objects. Returns
// { pairs, properties } with the coordinate columns removed from properties.
function isGeometryInput(data) {
    return typeof data === "string"
        || (data && typeof data === "object" && !Array.isArray(data)
            && typeof data.type === "string");
}

function normalizePoints(data, options = {}) {
    const latCol = opt(options, "latCol", "lat_col");
    const lonCol = opt(options, "lonCol", "lon_col");
    if (isGeometryInput(data)) {
        const features = featuresOf(data)
            .filter(f => f.geometry && POINT_GEOMETRY.has(f.geometry.type));
        const keys = [...new Set(features.flatMap(f => Object.keys(f.properties)))];
        const pairs = [];
        const properties = Object.fromEntries(keys.map(k => [k, []]));
        for (const f of features) {
            for (const pair of pointPairsOf(f.geometry)) {
                pairs.push(pair);
                for (const k of keys) properties[k].push(f.properties[k] ?? null);
            }
        }
        return { pairs, properties };
    }
    if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
        return { pairs: data.map(p => [Number(p[0]), Number(p[1])]), properties: {} };
    }
    let columns;
    if (Array.isArray(data)) {                        // rows of objects
        columns = {};
        for (const row of data) {
            for (const key of Object.keys(row)) (columns[key] = columns[key] || []);
        }
        for (const row of data) {
            for (const key of Object.keys(columns)) columns[key].push(row[key] ?? null);
        }
    } else if (data && typeof data === "object") {    // column dict
        columns = {};
        for (const [key, values] of Object.entries(data)) {
            columns[key] = Array.isArray(values) ? values.slice() : values;
        }
    } else {
        throw new Error("swiftmap model: unsupported data shape");
    }
    const keys = Object.keys(columns);
    const lat = findColumn(keys, LAT_NAMES, latCol);
    const lon = findColumn(keys, LON_NAMES, lonCol);
    if (!lat || !lon) throw new Error("swiftmap model: no lat/lon columns found");
    const n = columns[lat].length;
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([Number(columns[lat][i]), Number(columns[lon][i])]);
    const properties = {};
    for (const key of keys) {
        if (key !== lat && key !== lon) properties[key] = columns[key];
    }
    return { pairs, properties };
}

export function createMapModel(options = {}) {
    // The same trait defaults Python's Map opens with; the auto-fit below makes
    // the opening view data-driven anyway, exactly as it does there.
    const state = {
        layers: [],
        group_configs: {},
        center: opt(options, "center", "center", [36.0, -5.35]),
        zoom: opt(options, "zoom", "zoom", 10),
        crs: opt(options, "crs", "crs", "EPSG:3857"),
        height: opt(options, "height", "height", ""),
        auto_sync: true, sync_trigger: 0,
        show_logo: false, logo_config: {},
        show_legend: opt(options, "showLegend", "show_legend", false), legend_config: {},
        show_scale: opt(options, "showScale", "show_scale", false), scale_config: {},
        show_draw: opt(options, "showDraw", "show_draw", false), draw_config: {},
        drawings: [], draw_seq: 0,
        show_click_coordinates: opt(options, "showClickCoordinates", "show_click_coordinates", false),
        time_config: {}, time_current: 0,
        fit_bounds_request: {},
    };
    const buffers = {};
    let counter = 0;
    let fitSeq = 0;
    let autoFitArmed = options.center === undefined && options.zoom === undefined;
    let autoFitBounds = null;

    const nextId = () => `layer_${counter++}`;

    // The wire. Every mutation emits the ops Python's transport would -- adds,
    // replaces, targeted sets, buffer (re)writes, append deltas -- in the same
    // order. opLog keeps them all; onPatch streams them to a live consumer.
    const opLog = [];
    const onPatch = options.onPatch || null;
    const subscribers = new Set();
    function subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
    }
    function emit(op, buffer = null) {
        opLog.push({ op, buffer });
        if (onPatch) onPatch(op, buffer);
        for (const fn of subscribers) fn(op, buffer);
    }

    const asBytes = (view) =>
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    function bytesEqual(a, b, length = null) {
        const ba = asBytes(a), bb = asBytes(b);
        const n = length != null ? length : Math.max(ba.length, bb.length);
        if (length == null && ba.length !== bb.length) return false;
        for (let i = 0; i < n; i++) if (ba[i] !== bb[i]) return false;
        return true;
    }

    // --- the rules Python's _add_child applies -------------------------------------

    function ensureGroupConfig(group, multiSelect, fallback = true) {
        const existing = state.group_configs[group];
        const isNew = !existing || existing.multi_select === undefined;
        if (isNew || multiSelect !== undefined) {
            state.group_configs = {
                ...state.group_configs,
                [group]: { ...existing,
                           multi_select: multiSelect !== undefined ? multiSelect : fallback },
            };
        }
    }

    // A single-select folder shows one layer at a time: a newcomer to a folder
    // that already shows something starts hidden.
    function radioAdjust(layer) {
        const info = state.group_configs[layer.layer_group] || {};
        if (info.multi_select !== false) return;
        const hasVisible = state.layers.some(l =>
            l.layer_group === layer.layer_group && l.visible !== false);
        if (hasVisible) layer.visible = false;
    }

    function autoFitExtend(bounds) {
        if (!autoFitArmed || !bounds) return;
        autoFitBounds = layersBoundsUnion([{ bounds }, autoFitBounds && { bounds: autoFitBounds }]);
        fitSeq += 1;
        state.fit_bounds_request = {
            bounds: [autoFitBounds[0].slice(), autoFitBounds[1].slice()],
            zoom_offset: 0, max_zoom: 15, padding: 30, seq: fitSeq,
        };
    }

    // Same name + same folder joins the existing layer: the two become one
    // collection -- a type "group" entry with the members nested under `layers`,
    // stripped of their own layer_group, and an id of the group's own. One
    // sidebar entry, selected as one unit (the merge rule Python applies).
    function place(layer) {
        const twinIndex = state.layers.findIndex(l =>
            l.type !== "basemap" && l.name === layer.name
            && l.layer_group === layer.layer_group);
        if (twinIndex === -1) {
            state.layers = [...state.layers, layer];
            emit({ op: "add", layer });
            return;
        }
        const twin = state.layers[twinIndex];
        const asMember = (config) => {
            const member = { ...config };
            delete member.layer_group;
            return member;
        };
        let group;
        if (twin.type === "group") {
            group = { ...twin, layers: [...twin.layers, asMember(layer)] };
        } else {
            group = {
                id: nextId(), type: "group", name: layer.name,
                layer_group: layer.layer_group, visible: true,
                autobind_popup: true, autobind_tooltip: true,
                layers: [asMember(twin), asMember(layer)],
            };
        }
        state.layers = state.layers.map((l, i) => (i === twinIndex ? group : l));
        emit({ op: "replace", id: group.id, layer: group });
    }

    // Swaps one top-level config, emitting a whole-layer replace -- or the given
    // smaller ops when the change can be said in less (Python's _layers_replace).
    function replaceInState(existing, config, emitOps = null) {
        state.layers = state.layers.map(l => (l === existing ? config : l));
        for (const op of emitOps || [{ op: "replace", id: config.id, layer: config }]) {
            emit(op);
        }
    }

    function addLayer(layer, pairs, options, defaultGroup, dataDrivenMethod = null) {
        layer.layer_group = opt(options, "layerGroup", "layer_group", defaultGroup);
        const multiSelect = opt(options, "multiSelect", "multi_select",
            opt(options, "groupMultiSelect", "group_multi_select"));
        ensureGroupConfig(layer.layer_group, multiSelect);
        radioAdjust(layer);
        const displayKeys = [
            ["popupFields", "popup_fields"], ["popupNames", "popup_names"],
            ["tooltipFields", "tooltip_fields"], ["tooltipNames", "tooltip_names"],
            ["popupTemplate", "popup_template"], ["tooltipTemplate", "tooltip_template"],
            ["popupStyle", "popup_style"], ["tooltipStyle", "tooltip_style"],
            ["popupMaxWidth", "popup_max_width"],
        ];
        for (const [camel, snake] of displayKeys) {
            const value = opt(options, camel, snake);
            if (value !== undefined) layer[snake] = value;
        }
        const bounds = boundsOfPairs(pairs);
        if (bounds) layer.bounds = bounds;
        // Emission order is Python's: the coordinate buffer, then the data-driven
        // buffers, then the add itself.
        buffersSet(layer.id, packPairs(pairs));
        if (dataDrivenMethod) applyDataDriven(layer, options, dataDrivenMethod);
        recordAddedWith(layer, options, dataDrivenMethod);
        place(layer);
        autoFitExtend(bounds);
        return layer;
    }

    // What each add was called with, so updateLayer(data=...) re-applies it to
    // new data exactly as the add did. Internal, never on the wire: Python
    // records added_with on the config; the frontend ignores it, so this side
    // keeps it out of the state instead.
    const addedWith = new Map();
    function recordAddedWith(layer, options, dataDrivenMethod, fanned = false) {
        const record = { parser: {}, data_opts: null, properties: null, fanned };
        const latCol = opt(options, "latCol", "lat_col");
        const lonCol = opt(options, "lonCol", "lon_col");
        if (latCol) record.parser.lat_col = latCol;
        if (lonCol) record.parser.lon_col = lonCol;
        if (dataDrivenMethod) record.data_opts = dataOptsOf(options);
        if (options.properties) record.properties = options.properties;
        addedWith.set(layer.id, record);
    }

    function buffersSet(key, view) {
        buffers[key] = view;
        emit({ op: "buffer", id: key }, view);
    }

    function buffersAppend(key, tail) {
        const head = buffers[key];
        const joined = new Uint8Array((head ? head.byteLength : 0) + tail.byteLength);
        if (head) joined.set(asBytes(head), 0);
        joined.set(asBytes(tail), head ? head.byteLength : 0);
        buffers[key] = new DataView(joined.buffer);
        emit({ op: "buffer_append", id: key }, tail);
    }

    function buffersRemove(ids) {
        const removed = Object.keys(buffers).filter(key =>
            ids.some(id => id != null && (key === id || key.startsWith(`${id}::`))));
        for (const key of removed) delete buffers[key];
        for (const key of removed) emit({ op: "buffer_remove", id: key });
    }

    // Ships a recomputed per-point buffer as a TAIL when the head the client
    // holds is byte-identical, in full when the values moved, gone when there is
    // nothing left to ship -- Python's _grow_or_reset, decision and all.
    function growOrReset(key, payload, bytesPerPoint, nOld) {
        if (payload == null) {
            if (buffers[key]) buffersRemove([key]);
            return;
        }
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const split = nOld * bytesPerPoint;
        const existing = buffers[key];
        if (existing && existing.byteLength === split && bytesEqual(existing, view, split)) {
            buffersAppend(key, new DataView(payload.buffer.slice(
                payload.byteOffset + split, payload.byteOffset + payload.byteLength)));
        } else {
            buffersSet(key, view);
        }
    }

    function setOrRemoveBuffer(key, payload) {
        if (payload != null) {
            const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
            if (!buffers[key] || !bytesEqual(buffers[key], view)) buffersSet(key, view);
        } else if (buffers[key]) {
            buffersRemove([key]);
        }
    }

    // --- builders --------------------------------------------------------------------

    // color_col / radius_col do three jobs in one call, exactly as in Python: the
    // buffer the GPU draws, and the legend block that describes it, from the same
    // arithmetic -- so the legend cannot disagree with the pixels (GAPS.md gap 4).
    function dataOptsOf(options) {
        return {
            color_col: opt(options, "colorCol", "color_col") ?? null,
            colormap: resolveColormap(opt(options, "colormap", "colormap") ?? null),
            vmin: opt(options, "vmin", "vmin") ?? null,
            vmax: opt(options, "vmax", "vmax") ?? null,
            color_bins: opt(options, "colorBins", "color_bins") ?? null,
            radius_col: opt(options, "radiusCol", "radius_col") ?? null,
            radius_range: opt(options, "radiusRange", "radius_range") ?? [3.0, 18.0],
        };
    }

    function applyDataDriven(layer, options, method) {
        const dataOpts = dataOptsOf(options);
        const colors = dataDrivenColors(layer.properties, dataOpts, layer.color, method);
        if (colors) buffersSet(`${layer.id}::colors`, new DataView(colors.buffer));
        const radii = dataDrivenRadii(layer.properties, dataOpts, method);
        if (radii) buffersSet(`${layer.id}::radii`, new DataView(radii.buffer));
        const legend = dataDrivenLegend(layer.properties, dataOpts, layer.color);
        if (legend) layer.legend = legend;
        const sizeLegend = dataDrivenSizeLegend(layer.properties, dataOpts);
        if (sizeLegend) layer.legend_size = sizeLegend;
    }

    function addCircleMarkers(data, options = {}) {
        const { pairs, properties } = normalizePoints(data, options);
        const layer = {
            id: nextId(), type: "circle_markers",
            name: options.name || "Circle Markers",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            radius: options.radius !== undefined ? options.radius : 10,
            color: options.color || "#3388ff",
            fillColor: opt(options, "fillColor", "fill_color", "#3388ff"),
            fillOpacity: opt(options, "fillOpacity", "fill_opacity", 0.2),
            weight: options.weight !== undefined ? options.weight : 3,
            opacity: options.opacity !== undefined ? options.opacity : 1.0,
            properties,
        };
        addLayer(layer, pairs, options, "Circle Markers Group", "addCircleMarkers");
        return model;
    }

    function addMarkers(data, options = {}) {
        const { pairs, properties } = normalizePoints(data, options);
        const layer = {
            id: nextId(), type: "markers",
            name: options.name || "Markers",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            color: options.color || "#e61a26",
            properties,
        };
        addLayer(layer, pairs, options, "Markers Group", "addMarkers");
        return model;
    }

    // WKT strings and GeoJSON route through the feature path: one feature is
    // one layer (multi-part geometry keeps its parts/rings structure); several
    // features FAN into numbered sibling layers exactly as Python's adders do --
    // and a name matching a property key names each from its own value. Fanned
    // layers refuse updateLayer(data=...), as in Python: siblings share no
    // persistent link.
    function addVectorFeatures(type, data, options) {
        const family = type === "polyline" ? LINE_GEOMETRY : POLYGON_GEOMETRY;
        const partsOf = type === "polyline" ? linePartsOf : polygonPartsOf;
        const label = type === "polyline" ? "addLine" : "addPolygon";
        const defaultName = type === "polyline" ? "Line" : "Polygon";
        const features = featuresOf(data)
            .filter(f => f.geometry && family.has(f.geometry.type));
        if (!features.length) {
            console.warn(`swiftmap: ${label} found no ${type} geometry in the supplied `
                + `data. No layer was added.`);
            return model;
        }
        const isMulti = features.length > 1;
        const baseName = options.name;
        const nameIsColumn = baseName != null
            && features.some(f => baseName in f.properties);
        const keys = [...new Set(features.flatMap(f => Object.keys(f.properties)))];
        features.forEach((feature, i) => {
            const name = nameIsColumn ? String(feature.properties[baseName])
                : isMulti ? `${baseName ?? defaultName} ${i + 1}`
                : (baseName ?? defaultName);
            const props = Object.fromEntries(keys.map(k => [k, feature.properties[k] ?? null]));
            Object.assign(props, options.properties || {});
            const layer = type === "polyline"
                ? {
                    id: nextId(), type, name,
                    visible: options.visible !== undefined ? options.visible : true,
                    autobind_popup: true, autobind_tooltip: true,
                    color: options.color || "#3388ff",
                    weight: options.weight !== undefined ? options.weight : 3,
                    opacity: options.opacity !== undefined ? options.opacity : 1.0,
                    properties: props,
                }
                : {
                    id: nextId(), type, name,
                    visible: options.visible !== undefined ? options.visible : true,
                    autobind_popup: true, autobind_tooltip: true,
                    color: options.color || "#3388ff",
                    fillOpacity: opt(options, "fillOpacity", "fill_opacity", 0.2),
                    weight: options.weight !== undefined ? options.weight : 3,
                    opacity: options.opacity !== undefined ? options.opacity : 1.0,
                    properties: props,
                };
            if (type === "polygon") {
                const fillColor = opt(options, "fillColor", "fill_color");
                if (fillColor !== undefined) layer.fillColor = fillColor;
            }
            const parts = partsOf(feature.geometry);
            let flat;
            if (type === "polyline") {
                flat = parts.flat();
                if (parts.length > 1) layer.parts = parts.map(p => p.length);
            } else {
                flat = parts.flat(2);
                const plain = parts.length === 1 && parts[0].length === 1;
                if (!plain) layer.rings = parts.map(part => part.map(r => r.length));
            }
            addLayer(layer, flat, options, `${defaultName} Group`);
            recordAddedWith(layer, options, null, isMulti || nameIsColumn);
        });
        return model;
    }

    function addLine(coords, options = {}) {
        if (isGeometryInput(coords)) return addVectorFeatures("polyline", coords, options);
        const pairs = coords.map(p => [Number(p[0]), Number(p[1])]);
        const layer = {
            id: nextId(), type: "polyline",
            name: options.name || "Line",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            color: options.color || "#3388ff",
            weight: options.weight !== undefined ? options.weight : 3,
            opacity: options.opacity !== undefined ? options.opacity : 1.0,
            properties: options.properties || {},
        };
        addLayer(layer, pairs, options, "Line Group");
        recordAddedWith(layer, options, null);
        return model;
    }

    function addPolygon(coords, options = {}) {
        if (isGeometryInput(coords)) return addVectorFeatures("polygon", coords, options);
        const ring = coords.map(p => [Number(p[0]), Number(p[1])]);
        const [f, l] = [ring[0], ring[ring.length - 1]];
        if (f && (f[0] !== l[0] || f[1] !== l[1])) ring.push([f[0], f[1]]);
        const layer = {
            id: nextId(), type: "polygon",
            name: options.name || "Polygon",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            color: options.color || "#3388ff",
            fillOpacity: opt(options, "fillOpacity", "fill_opacity", 0.2),
            weight: options.weight !== undefined ? options.weight : 3,
            opacity: options.opacity !== undefined ? options.opacity : 1.0,
            properties: options.properties || {},
        };
        const fillColor = opt(options, "fillColor", "fill_color");
        if (fillColor !== undefined) layer.fillColor = fillColor;
        addLayer(layer, ring, options, "Polygon Group");
        recordAddedWith(layer, options, null);
        return model;
    }

    // A mixed collection: one layer per geometry kind present, all sharing the
    // name so the merge machinery collapses them into a single sidebar entry
    // (Python's add_collection). Point features go to circles or pins by
    // pointType; lines and polygons keep their structure.
    function addCollection(data, options = {}) {
        const features = featuresOf(data);
        const pointType = opt(options, "pointType", "point_type", "circle_markers");
        const family = (set) => features.filter(f => f.geometry && set.has(f.geometry.type));
        const fc = (list) => ({
            type: "FeatureCollection",
            features: list.map(f => ({ type: "Feature", geometry: f.geometry,
                                       properties: f.properties })),
        });
        const points = family(POINT_GEOMETRY);
        const lines = family(LINE_GEOMETRY);
        const polys = family(POLYGON_GEOMETRY);
        if (!points.length && !lines.length && !polys.length) {
            console.warn("swiftmap: addCollection found no geometry. Nothing was added.");
            return model;
        }
        if (points.length) {
            (pointType === "markers" ? addMarkers : addCircleMarkers)(fc(points), options);
        }
        if (lines.length) addLine(fc(lines), options);
        if (polys.length) addPolygon(fc(polys), options);
        return model;
    }

    // The name-callable basemap surface, resolved through the GENERATED
    // catalogue (src/basemap-catalog.js): presets first, then the WMS registry
    // (case-insensitive, aliases included, displaying the canonical name), then
    // raw URL templates (a WMS endpoint when wmsLayers says so), then the xyz
    // catalogue with Python's aliases and query_name tolerance.
    function addBasemap(name, options = {}) {
        const layerGroup = opt(options, "layerGroup", "layer_group", "Basemaps");
        const multiSelect = opt(options, "multiSelect", "multi_select",
            opt(options, "groupMultiSelect", "group_multi_select"));
        const visible = options.visible !== undefined ? options.visible : false;
        const wmsLayers = opt(options, "wmsLayers", "wms_layers");
        let url, attribution, maxZoom, maxNativeZoom;
        let subdomains = null, wms = null, displayName = name;
        const preset = PRESETS[name];
        const wmsEntry = preset ? null : WMS[String(name).toLowerCase()];
        if (preset) {
            ({ url, attribution, max_zoom: maxZoom, max_native_zoom: maxNativeZoom } = preset);
        } else if (wmsEntry) {
            url = wmsEntry.url;
            displayName = wmsEntry.name;
            attribution = wmsEntry.attribution;
            maxZoom = wmsEntry.max_zoom;
            maxNativeZoom = wmsEntry.max_native_zoom !== undefined
                ? wmsEntry.max_native_zoom : maxZoom;
            wms = { layers: wmsEntry.layers, format: wmsEntry.format,
                    version: wmsEntry.version, transparent: wmsEntry.transparent };
            if (wmsEntry.styles) wms.styles = wmsEntry.styles;
        } else if (String(name).startsWith("http://") || String(name).startsWith("https://")
                   || String(name).includes("{")) {
            url = name;
            attribution = opt(options, "attribution", "attribution", "");
            maxZoom = opt(options, "maxZoom", "max_zoom", 22);
            maxNativeZoom = opt(options, "maxNativeZoom", "max_native_zoom",
                                wmsLayers ? maxZoom : 19);
            if (wmsLayers) {
                wms = { layers: wmsLayers,
                        format: opt(options, "wmsFormat", "wms_format", "image/png"),
                        version: opt(options, "wmsVersion", "wms_version", "1.1.1"),
                        transparent: opt(options, "wmsTransparent", "wms_transparent", false) };
            }
        } else {
            const entry = XYZ[queryKey(BASEMAP_ALIASES[name] ?? name)];
            if (!entry) {
                console.warn(`swiftmap: addBasemap: no basemap named '${name}' -- not a `
                    + `preset, not a WMS entry, not a tile URL, not in the generated `
                    + `catalogue (curated; scripts/generate_basemap_catalog.py adds `
                    + `providers). No basemap was added.`);
                return model;
            }
            ({ url, attribution, max_zoom: maxZoom, max_native_zoom: maxNativeZoom } = entry);
            subdomains = entry.subdomains || null;
        }
        const layer = {
            id: nextId(), type: "basemap", name: displayName, layer_group: layerGroup,
            visible, url, attribution, max_zoom: maxZoom, max_native_zoom: maxNativeZoom,
            ...(subdomains ? { subdomains } : {}),
            ...(wms ? { wms } : {}),
        };
        ensureGroupConfig(layerGroup, multiSelect, layerGroup === "Basemaps" ? false : true);
        radioAdjust(layer);
        state.layers = [...state.layers, layer];
        emit({ op: "add", layer });
        return model;
    }

    function listBasemaps(search = null) {
        const names = new Set([
            ...Object.keys(PRESETS),
            ...Object.keys(BASEMAP_ALIASES),
            ...Object.values(XYZ).map(e => e.name),
            ...Object.values(WMS).map(e => e.name),
        ]);
        let out = [...names];
        if (search) {
            const needle = search.toLowerCase();
            out = out.filter(n => n.toLowerCase().includes(needle));
        }
        return out.sort();
    }

    // --- time layers --------------------------------------------------------------------

    // Animates the matching layers along the times their features already
    // carry: ::times packed from properties, the meta set as a field, the
    // period onto the one shared slider (Python's make_time_layer).
    function makeTimeLayer(target = null, options = {}) {
        const opts = { ...options };
        const timeField = opt(opts, "timeField", "time_field") ?? null;
        const timeEndField = opt(opts, "timeEndField", "time_end_field") ?? null;
        const period = opts.period ?? null;
        let duration = opts.duration !== undefined ? opts.duration : "period";
        const fade = opts.fade || false;
        for (const key of ["timeField", "time_field", "timeEndField", "time_end_field",
                           "period", "duration", "fade"]) delete opts[key];
        const matched = findLayers(target, opts);
        if (!matched.length) {
            console.warn("swiftmap: makeTimeLayer matched no layers. Nothing was animated.");
            return model;
        }
        if (duration !== null && duration !== "period" && !isValidPeriod(duration)) {
            console.warn(`swiftmap: makeTimeLayer: duration '${duration}' is not an ISO8601 `
                + `duration (like 'PT1H'). Falling back to 'period'.`);
            duration = "period";
        }
        for (const layer of matched) {
            const props = layer.properties || {};
            if (timeField && !(timeField in props)) {
                console.warn(`swiftmap: makeTimeLayer: '${timeField}' is not a property of `
                    + `layer '${layer.name}'. Its features stay visible at every tick.`);
                continue;
            }
            if (timeEndField && !(timeEndField in props)) {
                console.warn(`swiftmap: makeTimeLayer: end field '${timeEndField}' is not a `
                    + `property of layer '${layer.name}'; using start times only.`);
            }
            const { interleaved, field, timeless } =
                normalizeLayerTimes(props, timeField, timeEndField);
            if (interleaved == null) {
                console.warn(`swiftmap: makeTimeLayer: layer '${layer.name}' has no time `
                    + `property. Pass timeField naming one; its features stay visible at `
                    + `every tick until then.`);
                continue;
            }
            if (timeless) {
                console.warn(`swiftmap: makeTimeLayer: ${timeless} of ${interleaved.length / 2} `
                    + `feature(s) in '${layer.name}' carry no parseable time and will stay `
                    + `visible at every tick.`);
            }
            const payload = new DataView(interleaved.buffer);
            const key = `${layer.id}::times`;
            if (!buffers[key] || !bytesEqual(buffers[key], payload)) buffersSet(key, payload);
            const timeMeta = { field, duration };
            if (fade) timeMeta.fade = true;
            setLayerFields([layer], { time: timeMeta });
        }
        if (period != null) configureTime({ period });
        return model;
    }

    function clearTimeLayer(target = null, criteria = {}) {
        const pool = target == null && !Object.keys(criteria).length
            ? findLayers() : findLayers(target, criteria);
        const matched = pool.filter(l => l.time);
        if (!matched.length) return model;
        setLayerFields(matched, { time: null });
        buffersRemove(matched.filter(l => buffers[`${l.id}::times`])
                             .map(l => `${l.id}::times`));
        return model;
    }

    function configureTime(options = {}) {
        const opts = { ...options };
        if ("position" in opts && !TIME_POSITIONS.has(opts.position)) {
            console.warn(`swiftmap: configureTime: position '${opts.position}' is not one of `
                + `${[...TIME_POSITIONS].sort().join(", ")}. Keeping the previous position.`);
            delete opts.position;
        }
        if ("window" in opts) {
            const window = opts.window;
            delete opts.window;
            if (window == null) {
                if ("window" in state.time_config) {
                    const next = { ...state.time_config };
                    delete next.window;
                    state.time_config = next;
                }
            } else if (!isValidPeriod(window)) {
                console.warn(`swiftmap: configureTime: window '${window}' is not an ISO8601 `
                    + `duration (like 'PT2H30M'). Keeping the previous window.`);
            } else {
                opts.window = window;
            }
        }
        if ("period" in opts && !isValidPeriod(opts.period)) {
            console.warn(`swiftmap: configureTime: period '${opts.period}' is not an ISO8601 `
                + `duration (like 'P1D' or 'PT1H'). Keeping the previous period.`);
            delete opts.period;
        }
        if (Object.keys(opts).length) state.time_config = { ...state.time_config, ...opts };
        return model;
    }

    // Re-normalises a time layer's ::times from new properties with the same
    // field(s), or drops the animation with a warning when the property is gone.
    function retime(layer, props) {
        const desc = String((layer.time && layer.time.field) || "");
        const [startField, endField] = desc ? desc.split("/", 2) : [null, null];
        const { interleaved } = normalizeLayerTimes(props, startField || null, endField || null);
        if (interleaved == null) {
            console.warn(`swiftmap: updateLayer: the new data for '${layer.name}' has no `
                + `'${desc}' time property; the layer stops animating.`);
            return { payload: null, dropTime: true };
        }
        return { payload: new Uint8Array(interleaved.buffer), dropTime: false };
    }

    // --- query -----------------------------------------------------------------------

    // One targeting vocabulary, shared by everything that operates on existing
    // layers (Python's find_layers): target matches id or name; ids/name/types/
    // excludeTypes/group narrow; groups are containers, found by their parts
    // unless includeGroups. Collection parts inherit their wrapper's folder.
    function findLayers(target = null, criteria = {}) {
        const asSet = (v) => (v == null ? null
            : new Set(typeof v === "string" ? [v] : v));
        const identifiers = (v) => {
            if (v == null) return new Set();
            const items = Array.isArray(v) || v instanceof Set ? [...v] : [v];
            const out = new Set();
            for (const item of items) {
                if (item && typeof item === "object") {
                    if (item.id != null) out.add(item.id);
                    if (item.name != null) out.add(item.name);
                } else if (item != null) {
                    out.add(item);
                }
            }
            return out;
        };
        const wantedIds = new Set([...identifiers(target),
                                   ...identifiers(criteria.ids)]);
        const name = criteria.name ?? null;
        const wantTypes = asSet(criteria.types);
        const skipTypes = asSet(opt(criteria, "excludeTypes", "exclude_types")) || new Set();
        const group = criteria.group ?? null;
        const includeGroups = opt(criteria, "includeGroups", "include_groups", false);

        const found = [];
        const walk = (seq, inherited) => {
            for (const layer of seq) {
                const path = layer.layer_group || inherited;
                if (layer.type === "group") {
                    if (matches(layer, path)) found.push(layer);
                    walk(layer.layers || [], path);
                } else if (matches(layer, path, true)) {
                    found.push(layer);
                }
            }
        };
        const matches = (layer, path, leaf = false) => {
            if (!leaf && !includeGroups) return false;
            if (wantedIds.size && !(wantedIds.has(layer.id) || wantedIds.has(layer.name))) return false;
            if (name != null && layer.name !== name) return false;
            if (wantTypes != null && !wantTypes.has(layer.type)) return false;
            if (skipTypes.has(layer.type)) return false;
            if (group != null && path !== group && !String(path).startsWith(group + "/")) return false;
            return true;
        };
        walk(state.layers, "");
        return found;
    }

    function getLayer(identifier, name = null) {
        for (const l of state.layers) {
            if (name != null) {
                if (l.layer_group === identifier && l.name === name) return l;
            } else if (l.id === identifier || l.name === identifier) {
                return l;
            }
        }
        return null;
    }

    // --- visibility and fields ---------------------------------------------------------

    // Python's apply_to_layers: changes by id, nested layers included; a group
    // addressed by its OWN id takes the fields itself, members still visited.
    function applyChanges(layers, changes) {
        const differs = (layer, fields) =>
            fields && Object.entries(fields).some(([k, v]) => !sameValue(layer[k], v));
        const rebuild = (layer) => {
            if (layer.type === "group") {
                const subs = (layer.layers || []).map(rebuild);
                const changed = subs.some((s, i) => s !== (layer.layers || [])[i]);
                const own = changes.get(layer.id);
                const ownReal = differs(layer, own);
                if (!changed && !ownReal) return layer;
                return { ...layer, ...(ownReal ? own : {}), layers: subs };
            }
            const wanted = changes.get(layer.id);
            if (!differs(layer, wanted)) return layer;
            return { ...layer, ...wanted };
        };
        return layers.map(rebuild);
    }

    // Python's `!=` compares dicts by value; a repeated set of the same time
    // meta (or any object field) must stay a no-op here too.
    const sameValue = (a, b) => a === b
        || (a != null && b != null && typeof a === "object" && typeof b === "object"
            && JSON.stringify(a) === JSON.stringify(b));

    function setLayerFields(targets, fields) {
        const real = targets.filter(l => l.id != null
            && Object.entries(fields).some(([k, v]) => !sameValue(l[k], v)));
        if (!real.length) return model;
        state.layers = applyChanges(state.layers,
            new Map(real.map(l => [l.id, fields])));
        for (const l of real) emit({ op: "set", id: l.id, fields: { ...fields } });
        return model;
    }

    function hide(target = null, criteria = {}) {
        const matched = findLayers(target, criteria);
        if (!matched.length) {
            console.warn("swiftmap: hide matched no layers. Nothing was hidden.");
            return model;
        }
        return setLayerFields(matched, { visible: false });
    }

    function show(target = null, criteria = {}) {
        const matched = findLayers(target, criteria);
        if (!matched.length) {
            console.warn("swiftmap: show matched no layers. Nothing was shown.");
            return model;
        }
        return setLayerFields(matched, { visible: true });
    }

    function setLayersVisibility(visibilityMap) {
        for (const [key, visible] of Object.entries(visibilityMap)) {
            setLayerFields(findLayers(key), { visible: !!visible });
        }
        return model;
    }

    // Declarative and total within its scope: each call states the complete
    // selection, select(null, {scope}) restores the scope whole (Python's select).
    function select(target = null, options = {}) {
        const { scope = null, zoom = false, ...criteria } = options;
        const clearing = target == null && !Object.keys(criteria).length;
        const chosen = clearing ? [] : findLayers(target, criteria);
        if (!clearing && !chosen.length
                && !(Array.isArray(target) && target.length === 0)) {
            console.warn("swiftmap: select matched nothing; restoring the scope to visible.");
        }
        const chosenIds = new Set(chosen.map(l => l.id));
        let pool;
        if (scope != null) {
            pool = findLayers(null, { group: scope });
        } else if (chosen.length) {
            const groups = new Set(chosen.map(l => l.layer_group));
            pool = findLayers().filter(l => groups.has(l.layer_group));
        } else {
            pool = findLayers().filter(l => l.type !== "basemap");
        }
        if (chosenIds.size) {
            setLayerFields(pool.filter(l => chosenIds.has(l.id)), { visible: true });
            setLayerFields(pool.filter(l => !chosenIds.has(l.id)), { visible: false });
        } else {
            setLayerFields(pool, { visible: true });
        }
        if (zoom && chosen.length) {
            const union = layersBoundsUnion(chosen);
            if (union) {
                fitSeq += 1;
                state.fit_bounds_request = { bounds: union, zoom_offset: 0,
                                             max_zoom: null, padding: null, seq: fitSeq };
            }
        }
        return model;
    }

    // --- removal -----------------------------------------------------------------------

    function removeLayers(identifiers) {
        const ids = new Set(), names = new Set();
        for (const item of identifiers) {
            if (item && typeof item === "object") {
                ids.add(item.id);
                names.add(item.name);
            } else {
                ids.add(item);
                names.add(item);
            }
        }
        const kept = [], dropped = [];
        for (const l of state.layers) {
            (ids.has(l.id) || names.has(l.name) ? dropped : kept).push(l);
        }
        if (!dropped.length) return model;
        state.layers = kept;
        for (const l of dropped) emit({ op: "remove", id: l.id });
        const bufferIds = [];
        for (const l of dropped) {
            bufferIds.push(l.id);
            for (const sub of l.layers || []) if (sub.id) bufferIds.push(sub.id);
        }
        buffersRemove(bufferIds);
        return model;
    }

    const removeLayer = (nameOrId) => removeLayers([nameOrId]);

    // --- in-place data updates ---------------------------------------------------------

    const deepEqual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

    function singleTopLevel(identifier, name) {
        const targetId = identifier && typeof identifier === "object" ? identifier.id : identifier;
        const targetName = identifier && typeof identifier === "object" ? identifier.name : identifier;
        for (const l of state.layers) {
            if (name != null) {
                if (l.layer_group === identifier && l.name === name) return l;
            } else if (l.id === targetId || l.name === targetName) {
                return l;
            }
        }
        if (findLayers(identifier).length) {
            console.warn(`swiftmap: updateLayer: '${identifier}' is a part inside a collection; `
                + `updating a collection's parts in place is not supported yet. Nothing changed.`);
        } else {
            console.warn(`swiftmap: updateLayer: no layer named '${identifier}'. Nothing changed.`);
        }
        return null;
    }

    // update_layer, all three shapes: attributes; data replace; append -- the
    // live-feed primitive, whose wire cost is the batch, never the layer.
    function updateLayer(identifier, options = {}) {
        const { data = null, append = false, name = null, ...restRaw } = options;
        const rest = { ...restRaw };
        const parser = {};
        for (const [camel, snake] of [["latCol", "lat_col"], ["lonCol", "lon_col"]]) {
            const v = opt(rest, camel, snake);
            if (v !== undefined) parser[snake] = v;
            delete rest[camel];
            delete rest[snake];
        }
        if (data != null) {
            const target = singleTopLevel(identifier, name);
            if (!target) return model;
            if (target.type === "group") {
                console.warn(`swiftmap: updateLayer: '${target.name}' is a collection; update its `
                    + `parts as flat layers, or remove and re-add it. Nothing changed.`);
                return model;
            }
            if (target.type === "circle_markers" || target.type === "markers") {
                return updatePoints(target, data, append, parser, rest);
            }
            if (append) {
                console.warn(`swiftmap: updateLayer: append=true on '${target.name}', a single `
                    + `${target.type}. Pass data without append to replace it. Nothing changed.`);
                return model;
            }
            if (target.type === "polyline" || target.type === "polygon") {
                return updateSingle(target, data, rest);
            }
            console.warn(`swiftmap: updateLayer: data applies to point, line and polygon layers; `
                + `'${target.name}' is a ${target.type} layer. Nothing changed.`);
            return model;
        }
        // Attribute updates: one replace per match, as Python sends them.
        const targetId = identifier && typeof identifier === "object" ? identifier.id : identifier;
        const targetName = identifier && typeof identifier === "object" ? identifier.name : identifier;
        const changed = [];
        state.layers = state.layers.map(l => {
            const match = name != null
                ? (l.layer_group === identifier && l.name === name)
                : (l.id === targetId || l.name === targetName);
            if (!match) return l;
            const next = { ...l, ...rest };
            changed.push(next);
            return next;
        });
        for (const config of changed) emit({ op: "replace", id: config.id, layer: config });
        return model;
    }

    function updatePoints(layer, data, append, parser, fieldKwargs) {
        const rec = addedWith.get(layer.id) || {};
        if (rec.fanned) {
            console.warn(`swiftmap: updateLayer: '${layer.name}' was fanned out from `
                + `several features -- one of several sibling layers with no persistent `
                + `link. Update a flat layer, or remove and re-add the set. Nothing changed.`);
            return model;
        }
        let parsed;
        try {
            parsed = normalizePoints(data, { ...(rec.parser || {}), ...parser });
        } catch (err) {
            console.warn(`swiftmap: updateLayer could not read the supplied data for `
                + `'${layer.name}'. ${err.message} Nothing changed.`);
            return model;
        }
        let { pairs, properties: props } = parsed;
        if (!pairs.length) {
            console.warn(`swiftmap: updateLayer found no points for '${layer.name}'. Nothing changed.`);
            return model;
        }
        const nNew = pairs.length;
        let nOld = 0;
        if (append) {
            const old = buffers[layer.id];
            nOld = old ? old.byteLength / 16 : 0;
            const oldPairs = [];
            for (let i = 0; i < nOld; i++) {
                oldPairs.push([old.getFloat64(i * 16, true), old.getFloat64(i * 16 + 8, true)]);
            }
            pairs = [...oldPairs, ...pairs];
            const oldProps = layer.properties || {};
            const merged = {};
            for (const k of new Set([...Object.keys(oldProps), ...Object.keys(props)])) {
                const a = Array.isArray(oldProps[k]) ? [...oldProps[k]]
                    : new Array(nOld).fill(oldProps[k] === undefined ? null : oldProps[k]);
                const b = Array.isArray(props[k]) ? props[k] : new Array(nNew).fill(null);
                merged[k] = [...a, ...b];
            }
            props = merged;
        }
        const n = pairs.length;
        const dataOpts = rec.data_opts || dataOptsOf({});
        const colors = dataDrivenColors(props, dataOpts, layer.color, "updateLayer");
        const radii = dataDrivenRadii(props, dataOpts, "updateLayer");
        const legend = dataDrivenLegend(props, dataOpts, layer.color);
        const sizeLegend = dataDrivenSizeLegend(props, dataOpts);
        let timesPayload = null, dropTime = false;
        if (layer.time) ({ payload: timesPayload, dropTime } = retime(layer, props));
        const bounds = boundsOfPairs(pairs);
        const coords = packPairs(pairs);

        const config = { ...layer, properties: props, bounds };
        if (dropTime) config.time = null;
        for (const [key, value] of [["legend", legend], ["legend_size", sizeLegend]]) {
            if (value) config[key] = value;
            else delete config[key];
        }
        Object.assign(config, fieldKwargs);

        if (append && nOld > 0 && !dropTime) {
            buffersAppend(layer.id, new DataView(coords.buffer.slice(nOld * 16)));
            growOrReset(`${layer.id}::colors`, colors, 4, nOld);
            growOrReset(`${layer.id}::radii`, radii, 4, nOld);
            if (layer.time && timesPayload != null) {
                growOrReset(`${layer.id}::times`, timesPayload, 16, nOld);
            }
            const fields = { bounds, ...fieldKwargs };
            for (const [key, value] of [["legend", legend], ["legend_size", sizeLegend]]) {
                if (!deepEqual(value || null, layer[key] || null)) fields[key] = value;
            }
            const tails = {};
            for (const [k, v] of Object.entries(props)) tails[k] = v.slice(nOld);
            replaceInState(layer, config, [
                { op: "append", id: layer.id, base: nOld, count: nNew, properties: tails },
                { op: "set", id: layer.id, fields },
            ]);
        } else {
            buffersSet(layer.id, coords);
            setOrRemoveBuffer(`${layer.id}::colors`, colors);
            setOrRemoveBuffer(`${layer.id}::radii`, radii);
            if (layer.time) setOrRemoveBuffer(`${layer.id}::times`, timesPayload);
            replaceInState(layer, config);
        }
        autoFitExtend(bounds);
        return model;
    }

    function updateSingle(layer, data, fieldKwargs) {
        const rec = addedWith.get(layer.id) || {};
        if (rec.fanned) {
            console.warn(`swiftmap: updateLayer: '${layer.name}' was fanned out from `
                + `several features -- one of several sibling layers with no persistent `
                + `link. Update a flat layer, or remove and re-add the set. Nothing changed.`);
            return model;
        }
        const pairs = data.map(p => [Number(p[0]), Number(p[1])]);
        if (layer.type === "polygon" && pairs.length) {
            const [f, l] = [pairs[0], pairs[pairs.length - 1]];
            if (f[0] !== l[0] || f[1] !== l[1]) pairs.push([f[0], f[1]]);
        }
        const bounds = boundsOfPairs(pairs);
        const config = { ...layer, properties: { ...(rec.properties || {}) }, bounds };
        delete config.parts;
        delete config.rings;
        let timesPayload = null, dropTime = false;
        if (layer.time) ({ payload: timesPayload, dropTime } = retime(layer, config.properties));
        if (dropTime) config.time = null;
        Object.assign(config, fieldKwargs);
        buffersSet(layer.id, packPairs(pairs));
        if (layer.time) setOrRemoveBuffer(`${layer.id}::times`, timesPayload);
        replaceInState(layer, config);
        autoFitExtend(bounds);
        return model;
    }

    // --- output ---------------------------------------------------------------------

    // The host-state shape: exactly what a trait snapshot carries, so it can feed
    // createHostStub directly -- and what the conformance suite compares.
    function wireState() {
        return { ...state, coordinate_buffers: { ...buffers } };
    }

    // <SwiftMap>'s props. Mutators rebuild what they touch, so these identities
    // change exactly when something did.
    function props() {
        return {
            layers: state.layers,
            buffers,
            groupConfigs: state.group_configs,
            center: state.center, zoom: state.zoom, crs: state.crs,
            height: state.height || undefined,
            showLegend: state.show_legend, legendConfig: state.legend_config,
            showScale: state.show_scale, scaleConfig: state.scale_config,
            showDraw: state.show_draw, drawConfig: state.draw_config,
            drawings: state.drawings,
            timeConfig: state.time_config, timeCurrent: state.time_current,
            showClickCoordinates: state.show_click_coordinates,
            fitBoundsRequest: state.fit_bounds_request,
        };
    }

    const model = {
        addCircleMarkers, addMarkers, addLine, addPolygon, addCollection,
        addBasemap, listBasemaps, subscribe,
        makeTimeLayer, clearTimeLayer, configureTime,
        findLayers, getLayer,
        hide, show, select, setLayersVisibility, setLayerFields,
        removeLayer, removeLayers, updateLayer,
        wireState, props,
        get layers() { return state.layers; },
        get buffers() { return buffers; },
        get opLog() { return opLog; },
    };

    // Every map starts from the registry's per-CRS defaults, resolved through
    // addBasemap exactly as Python's Map() resolves them.
    if (opt(options, "basemaps", "basemaps") !== false) {
        const rows = DEFAULT_BASEMAPS[state.crs] || DEFAULT_BASEMAPS["EPSG:3857"];
        for (const [bname, vis] of rows) addBasemap(bname, { visible: vis });
    }

    return model;
}
