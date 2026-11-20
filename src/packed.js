// Packed vector layers: one polygon or polyline layer holding many features.
//
// Points have always been one layer per (folder, name), with every point's data in
// columns and binary buffers. Polygons and lines were one layer PER FEATURE -- a
// 9,919-cell H3 table arrived as 9,919 configs and 9,919 coordinate buffers. A
// packed layer stores them the way points are stored:
//
//   feature_count   n, which is what marks a layer as packed
//   <id>            float64 [lat, lon] of every feature, one after another
//   <id>::offsets   uint32 n + 1: feature i is vertices offsets[i] .. offsets[i+1]-1
//   <id>::colors    u8 RGBA per feature (color_col), the points' encoding; it drives
//                   a polygon's fill, its stroke too when color_col_stroke is set,
//                   and a line's colour
//   <id>::times     float64 [start, end] per feature -- or per vertex, as tracks do
//   properties      columns; feature_styles and labels per-feature lists
//   rings / parts   per-feature ring tables / part lengths, null for simple features
//
// The renderer draws features, the layer is the unit of visibility. So a packed
// layer stays ONE entry in every bucket (one visibility slot, one meta entry) and
// is expanded here, at draw time, into per-feature VIEWS shaped like the old
// one-feature layers -- the drawing code then needs no second implementation.

import { bufferSerial } from "./patch.js";

// Per-feature keys a view replaces with its own value; everything else is the
// layer's, shared by every feature.
const PER_FEATURE = new Set([
    "properties", "feature_styles", "labels", "rings", "parts", "style_overrides",
    "bounds", "feature_count", "label",
]);

export function isPacked(layer) {
    return Boolean(layer) && (layer.type === "polygon" || layer.type === "polyline")
        && Number.isInteger(layer.feature_count);
}

// A typed view over a buffer as the transport delivers it (DataView, ArrayBuffer or
// typed array). A byte offset the element size does not divide gets a copy rather
// than a RangeError.
function typed(raw, Ctor) {
    if (!raw) return null;
    const buffer = raw.buffer || raw;
    const offset = raw.byteOffset || 0;
    const length = Math.floor((raw.byteLength ?? raw.length) / Ctor.BYTES_PER_ELEMENT);
    if (offset % Ctor.BYTES_PER_ELEMENT !== 0) {
        return new Ctor(buffer.slice(offset, offset + length * Ctor.BYTES_PER_ELEMENT));
    }
    return new Ctor(buffer, offset, length);
}

function hex2(v) {
    return v.toString(16).padStart(2, "0");
}

// The vertex range of every feature: n + 1 offsets. Without an offsets buffer a
// one-feature layer owns every vertex; a many-feature layer without one cannot be
// split, and draws as one feature (validate.js names the problem).
export function featureOffsets(layer, buffers) {
    const coords = typed(buffers[layer.id], Float64Array);
    const vertices = coords ? coords.length / 2 : 0;
    const raw = typed(buffers[`${layer.id}::offsets`], Uint32Array);
    if (raw && raw.length === layer.feature_count + 1 && raw[raw.length - 1] === vertices) {
        return raw;
    }
    return Uint32Array.from([0, vertices]);
}

const viewCache = new WeakMap();

// The layer's features as views, cached per layer object and buffer identity: a
// sync that changed neither re-uses the very same objects, which is what lets the
// draw path, the time meta and the labels walk the same features in the same order.
export function expandPacked(layer, buffers) {
    const keys = ["", "::offsets", "::colors", "::times"].map(k => `${layer.id}${k}`);
    const serial = keys.map(k => bufferSerial(buffers[k])).join(",");
    const hit = viewCache.get(layer);
    if (hit && hit.serial === serial) return hit.views;

    const coords = typed(buffers[layer.id], Float64Array) || new Float64Array(0);
    const offsets = featureOffsets(layer, buffers);
    const n = offsets.length - 1;
    const vertices = coords.length / 2;
    const colors = typed(buffers[`${layer.id}::colors`], Uint8Array);
    const useColors = colors && colors.length === 4 * layer.feature_count ? colors : null;
    const times = typed(buffers[`${layer.id}::times`], Float64Array);
    const perFeatureTimes = times && times.length === 2 * n;
    const perVertexTimes = times && !perFeatureTimes && times.length === 2 * vertices;

    const base = {};
    for (const [k, v] of Object.entries(layer)) {
        if (!PER_FEATURE.has(k)) base[k] = v;
    }
    const props = layer.properties || {};
    const propKeys = Object.keys(props);
    const styles = Array.isArray(layer.feature_styles) ? layer.feature_styles : null;
    const overrides = layer.style_overrides || null;

    const mask = featureMask(layer, n);
    const views = new Array(n);
    for (let i = 0; i < n; i++) {
        const view = { ...base };
        if (styles && styles[i]) Object.assign(view, styles[i]);
        if (useColors) {
            const c = `#${hex2(useColors[i * 4])}${hex2(useColors[i * 4 + 1])}`
                + hex2(useColors[i * 4 + 2]);
            view.fillColor = c;
            // A line has no fill: its colour IS the stroke. A polygon's stroke
            // follows only when color_col_stroke says so (an explicit color= keeps
            // a uniform border over ramped fills).
            if (layer.type === "polyline" || layer.color_col_stroke) view.color = c;
        }
        const row = {};
        for (const k of propKeys) {
            const v = props[k];
            row[k] = Array.isArray(v) ? v[i] : v;
        }
        view.properties = row;
        if (Array.isArray(layer.rings) && layer.rings[i]) view.rings = layer.rings[i];
        if (Array.isArray(layer.parts) && layer.parts[i]) view.parts = layer.parts[i];
        if (Array.isArray(layer.labels) && layer.labels[i] != null && layer.labels[i] !== "") {
            view.label = layer.labels[i];
        }
        if (overrides && overrides[i]) view.style_overrides = { 0: overrides[i] };
        view.__packed = layer;
        view.__index = i;
        view.__coords = coords.subarray(offsets[i] * 2, offsets[i + 1] * 2);
        view.__times = perFeatureTimes ? times.subarray(i * 2, i * 2 + 2)
            : perVertexTimes ? times.subarray(offsets[i] * 2, offsets[i + 1] * 2)
            : null;
        // Which [start, end] pair answers "is this feature in the window": its own
        // when times are per feature; per-vertex tracks answer for the whole line.
        view.__timeIndex = perFeatureTimes ? i : undefined;
        // Filtered out by a where= selection: never drawn, never labelled, never
        // clickable -- the bucket simply leaves it out.
        view.__hidden = Boolean(mask && !mask[i]);
        views[i] = view;
    }
    viewCache.set(layer, { serial, views });
    return views;
}

// What a bucket draws, in draw order: every feature of every layer that its
// feature filter keeps, each with the bucket SLOT of the layer it came from -- the
// GPU visibility and time attributes are per slot, so a packed layer's features
// all answer to one.
export function drawUnits(layersList, buffers) {
    const units = [];
    const slots = [];
    layersList.forEach((layer, slot) => {
        if (isPacked(layer)) {
            for (const view of expandPacked(layer, buffers)) {
                if (view.__hidden) continue;
                units.push(view);
                slots.push(slot);
            }
        } else {
            const mask = featureMask(layer, 1);
            if (mask && !mask[0]) return;
            units.push(layer);
            slots.push(slot);
        }
    });
    return { units, slots };
}

// The layer a click reports and the feature index within it.
export function clickTarget(unit) {
    return unit.__packed
        ? { layer: unit.__packed, index: unit.__index, timeIndex: unit.__timeIndex }
        : { layer: unit, index: 0, timeIndex: undefined };
}

// The features a layer's feature_filter draws: a Uint8Array of n (1 = drawn), or
// null when the layer has no filter and draws everything. The filter is a
// PREDICATE written by select / hide / show `where=` --
//     { where: { column: [values] }, keep: true | false }
// -- keep draws the features matching every column, !keep draws the rest. Being a
// predicate, not a stored mask, it re-applies to whatever rows the layer holds
// after a data update. A column the layer lacks matches nothing; Python's
// feature_match applies the same rule, so what it zooms to is what is drawn.
export function featureMask(layer, n) {
    const filter = layer && layer.feature_filter;
    if (!filter || !filter.where) return null;
    const props = layer.properties || {};
    const tests = Object.entries(filter.where).map(([column, values]) =>
        [props[column], new Set(Array.isArray(values) ? values : [values]),
         column in props]);
    const keep = filter.keep !== false;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        let match = true;
        for (const [data, wanted, present] of tests) {
            const value = !present ? undefined : Array.isArray(data) ? data[i] : data;
            if (!present || !wanted.has(value === undefined ? null : value)) {
                match = false;
                break;
            }
        }
        mask[i] = match === keep ? 1 : 0;
    }
    return mask;
}
