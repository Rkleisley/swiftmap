// Layer-state functions: visibility, bucketing, and patch application.
//
// Pure data in, data out -- no map, no DOM, no host. This is the part of the core
// that every consumer shares verbatim: the anywidget widget, a static export and a
// React app all apply the same patch ops to the same {layers, buffers} state.

// True if a layer is visible and no folder above it is switched off.
//
// Visibility is inherited down the folder path: a layer inside "Feeds/Active" is hidden
// when either "Feeds" or "Feeds/Active" is off, regardless of its own flag. Getting this
// wrong shows up as "that layer just will not appear", with nothing logged.
export function isLayerEffectiveVisible(layer, groupConfigs) {
    if (layer.visible === false) return false;
    let runningPath = "";
    for (const part of (layer.layer_group || "Layers").split("/")) {
        runningPath = runningPath ? `${runningPath}/${part}` : part;
        const config = groupConfigs[runningPath];
        if (config && config.visible === false) return false;
    }
    return true;
}

// Sorts the visible layers into one bucket per WebGL draw pass.
//
// Sub-layers of a merged group inherit their parent's visibility rather than carrying
// their own, so a group toggled off contributes nothing even when its children say
// visible. Circles join the polygon bucket: they are drawn as generated rings.
export function collectWebglLayers(layers, groupConfigs) {
    const buckets = { circle_markers: [], markers: [], polyline: [], polygon: [] };

    function collect(layer, parentVisible, isSubLayer) {
        if (!parentVisible) return;
        if (layer.type === "group" && layer.layers) {
            layer.layers.forEach(sub => collect(sub, parentVisible, true));
            return;
        }
        if (!isSubLayer && layer.visible === false) return;

        const bucket = layer.type === "circle" ? "polygon" : layer.type;
        if (buckets[bucket]) buckets[bucket].push(layer);
    }

    for (const layer of layers) {
        collect(layer, isLayerEffectiveVisible(layer, groupConfigs), false);
    }
    return buckets;
}

// Applies incremental patch ops to {layers, buffers}, returning the new state.
//
// Ops are addressed by layer id and applied idempotently: "add" upserts rather than
// appending blindly, so a patch that races the initial trait snapshot cannot duplicate
// a layer, and a "remove" for something already gone is a no-op.
// Applies `update` to one layer wherever it sits, descending into groups. add_collection
// nests its point, line and polygon layers inside a group layer, so an op addressed at a
// nested id would otherwise match nothing and silently do nothing. Returns the original
// array untouched when the id is not found, so an unmatched op costs no re-render.
function updateLayerById(layers, id, update) {
    let hit = false;
    const next = layers.map(l => {
        if (l.id === id) {
            hit = true;
            return update(l);
        }
        if (l.type === "group" && Array.isArray(l.layers)) {
            const subs = updateLayerById(l.layers, id, update);
            if (subs !== l.layers) {
                hit = true;
                return { ...l, layers: subs };
            }
        }
        return l;
    });
    return hit ? next : layers;
}

// Every point layer, visible or not, with its effective visibility recorded -- the
// GPU-visibility path keeps hidden layers in the bucket (stable ids, no rebuild on a
// toggle) and hides them with a uniform instead. Mirrors collectWebglLayers' rules:
// sub-layers inherit their parent's effective visibility, top-level layers answer for
// their own flag and their folder chain.
export function collectPointLayersAll(layers, groupConfigs) {
    const out = { circle_markers: [], markers: [], polyline: [], polygon: [] };
    function walk(layer, parentVisible, isSub) {
        if (layer.type === "group" && layer.layers) {
            const selfVis = parentVisible && isLayerEffectiveVisible(layer, groupConfigs);
            layer.layers.forEach(sub => walk(sub, selfVis, true));
            return;
        }
        const bucket = layer.type === "circle" ? "polygon" : layer.type;
        if (!out[bucket]) return;
        const vis = isSub ? parentVisible
            : parentVisible && isLayerEffectiveVisible(layer, groupConfigs);
        out[bucket].push({ layer, vis });
    }
    for (const layer of layers) walk(layer, true, false);
    return out;
}

// Buffer identity for the GL meta key. A new DataView under a layer id -- a
// buffer op from update_layer(data=...), or the trait reseeded -- must rebuild
// the bucket even when the byte length is unchanged (points moved, colours
// recomputed). The serial is per object, so an untouched buffer keeps its number
// and costs no rebuild. Works for any consumer that swaps a buffer, Python or not.
const bufferSerials = new WeakMap();
let nextBufferSerial = 1;
export function bufferSerial(buf) {
    if (!buf || typeof buf !== "object") return 0;
    let serial = bufferSerials.get(buf);
    if (!serial) {
        serial = nextBufferSerial++;
        bufferSerials.set(buf, serial);
    }
    return serial;
}

function concatViews(head, tail) {
    const out = new Uint8Array(head.byteLength + tail.byteLength);
    out.set(new Uint8Array(head.buffer, head.byteOffset, head.byteLength), 0);
    out.set(new Uint8Array(tail.buffer, tail.byteOffset, tail.byteLength), head.byteLength);
    return new DataView(out.buffer);
}

function appendRows(layer, op) {
    const base = op.base || 0;
    const count = op.count || 0;
    const incoming = op.properties || {};
    const props = { ...(layer.properties || {}) };
    for (const key of new Set([...Object.keys(props), ...Object.keys(incoming)])) {
        const head = Array.isArray(props[key]) ? props[key]
            : new Array(base).fill(props[key] === undefined ? null : props[key]);
        const tail = Array.isArray(incoming[key]) ? incoming[key] : new Array(count).fill(null);
        props[key] = head.concat(tail);
    }
    const next = { ...layer, properties: props };
    for (const [field, tail] of Object.entries(op.lists || {})) {
        next[field] = (Array.isArray(layer[field]) ? layer[field] : []).concat(tail);
    }
    return next;
}

export function applySwiftmapPatch(state, ops, buffers) {
    let layers = state.layers || [];
    let bufferMap = state.buffers || {};

    for (const op of ops) {
        if (op.op === "snapshot") {
            layers = op.layers || [];
            bufferMap = {};
            (op.buffer_ids || []).forEach((id, i) => {
                if (buffers && buffers[i]) bufferMap[id] = buffers[i];
            });
        } else if (op.op === "add" || op.op === "replace") {
            const incoming = op.layer;
            const id = incoming ? incoming.id : op.id;
            const idx = layers.findIndex(l => l.id === id);
            if (idx === -1) {
                layers = [...layers, incoming];
            } else {
                layers = layers.map((l, i) => (i === idx ? incoming : l));
            }
        } else if (op.op === "set") {
            // Field-level update. "replace" carries the whole layer, so flipping `visible`
            // on a 50k-point layer resent every property it holds -- half a megabyte to
            // change one boolean, on every click of a checkbox.
            layers = updateLayerById(layers, op.id, l => ({ ...l, ...(op.fields || {}) }));
        } else if (op.op === "style") {
            // Per-feature style overrides, replaced wholesale rather than merged: a
            // selection describes its complete state, so sending {} clears it and no
            // caller has to track what the previous highlight touched.
            layers = updateLayerById(layers, op.id, l => ({
                ...l, style_overrides: op.overrides || {},
            }));
        } else if (op.op === "remove") {
            layers = layers.filter(l => l.id !== op.id);
        } else if (op.op === "buffer") {
            const buf = buffers && buffers[op.buffer_index];
            if (buf) bufferMap = { ...bufferMap, [op.id]: buf };
        } else if (op.op === "buffer_append") {
            // A tail for an existing buffer -- the feed primitive's wire shape,
            // proportional to the batch. Concatenation yields a NEW DataView, and
            // the GL meta key keys on buffer identity, so the bucket rebuilds.
            const tail = buffers && buffers[op.buffer_index];
            if (tail) {
                const head = bufferMap[op.id];
                bufferMap = { ...bufferMap, [op.id]: head ? concatViews(head, tail) : tail };
            }
        } else if (op.op === "append") {
            // New rows for the property lists (and other per-feature lists), after
            // the existing ones. Columns missing on either side fill null, exactly
            // as the Python side does, so a later popup reads the same table.
            layers = updateLayerById(layers, op.id, l => appendRows(l, op));
        } else if (op.op === "buffer_remove") {
            bufferMap = { ...bufferMap };
            delete bufferMap[op.id];
        }
    }

    return { layers, buffers: bufferMap };
}
