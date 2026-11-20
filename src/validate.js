// Authoring guardrails for hand-built configs and buffers.
//
// Python warns at add time -- 80 warn() sites across layers/, mapops/ and
// parsers/ -- but a JS app hands the core finished configs and packed buffers,
// and until now a malformed layer, a wrong-length buffer or an unknown type all
// produced the same result: silence, and a map that is blank or subtly wrong
// (the React port's gap report, item 2). These checks are O(layers) arithmetic
// on byte lengths, run once per config object, and print through console.warn --
// they never throw and never change what renders.
import { isPacked } from "./packed.js";

const KNOWN_TYPES = new Set([
    "basemap", "circle_markers", "markers", "polyline", "polygon", "circle",
    "image", "group", "heatmap",
]);

// The problems with one layer, as sentences. Exported bare for tests and for
// apps that want to lint configs before handing them over.
export function collectLayerProblems(layer, buffers = {}) {
    const problems = [];
    const id = layer.id || "(no id)";
    const type = layer.type;
    if (type && !KNOWN_TYPES.has(type)) {
        problems.push(`layer ${id}: unknown type "${type}" -- it will not render`);
        return problems;
    }
    const view = buffers[layer.id];
    const bytes = view ? view.byteLength : 0;
    if (view && bytes % 16 !== 0) {
        problems.push(`layer ${id}: coordinate buffer is ${bytes} bytes, `
            + `not a multiple of 16 (float64 [lat, lon] pairs)`);
    }
    const n = Math.floor(bytes / 16);

    const isPoints = type === "circle_markers" || type === "markers";
    if (isPoints && view) {
        const colors = buffers[`${layer.id}::colors`];
        if (colors && colors.byteLength !== 4 * n) {
            problems.push(`layer ${id}: colors buffer holds `
                + `${Math.floor(colors.byteLength / 4)} RGBA entries for ${n} points`);
        }
        const radii = buffers[`${layer.id}::radii`];
        if (radii && radii.byteLength !== 4 * n) {
            problems.push(`layer ${id}: radii buffer holds `
                + `${Math.floor(radii.byteLength / 4)} float32 entries for ${n} points`);
        }
        const times = buffers[`${layer.id}::times`];
        if (times && times.byteLength !== 16 * n) {
            problems.push(`layer ${id}: times buffer holds `
                + `${Math.floor(times.byteLength / 16)} [start, end] pairs for ${n} points`);
        }
        for (const [key, values] of Object.entries(layer.properties || {})) {
            if (Array.isArray(values) && values.length !== n) {
                problems.push(`layer ${id}: property "${key}" has ${values.length} `
                    + `rows for ${n} points -- popups and clicks will desync`);
                break;
            }
        }
    }

    if (type === "heatmap") {
        const src = buffers[layer.source || layer.id];
        if (layer.source && !src) {
            problems.push(`layer ${id}: heatmap references source layer `
                + `"${layer.source}" with no coordinate buffer -- nothing will draw`);
        }
        const weights = buffers[`${layer.id}::weights`];
        const points = src ? Math.floor(src.byteLength / 16) : 0;
        if (src && weights && weights.byteLength !== 4 * points) {
            problems.push(`layer ${id}: weights buffer holds `
                + `${Math.floor(weights.byteLength / 4)} float32 entries for `
                + `${points} points`);
        }
        if (layer.cells && layer.cells !== "blobs") {
            const counts = Array.isArray(layer.cell_counts) ? layer.cell_counts : [];
            const total = counts.reduce((a, b) => a + b, 0);
            if (src && total * 16 !== src.byteLength) {
                problems.push(`layer ${id}: cell_counts sum to ${total} vertices `
                    + `but the buffer holds ${Math.floor(src.byteLength / 16)}`);
            }
            const cellValues = buffers[`${layer.id}::values`];
            if (cellValues && cellValues.byteLength !== 8 * counts.length) {
                problems.push(`layer ${id}: values buffer holds `
                    + `${Math.floor(cellValues.byteLength / 8)} float64 entries for `
                    + `${counts.length} cells`);
            }
        }
    }

    const times = buffers[`${layer.id}::times`];
    if (times && times.byteLength >= 16) {
        const first = times.getFloat64(0, true);
        if (first > 0 && first < 1e11) {
            problems.push(`layer ${id}: times look like epoch SECONDS (first is `
                + `${first}); swiftmap times are epoch milliseconds`);
        }
    }

    // A packed layer's rings and parts are per FEATURE (src/packed.js); the
    // per-layer checks below would read them as one table and cry wolf.
    if (isPacked(layer)) {
        problems.push(...packedProblems(layer, buffers, n));
        return problems;
    }

    if (type === "polygon" && Array.isArray(layer.rings) && view) {
        const total = layer.rings.flat().reduce((sum, count) => sum + count, 0);
        if (total * 16 !== bytes) {
            problems.push(`layer ${id}: rings sum to ${total} vertices `
                + `but the buffer holds ${n}`);
        }
    }
    if (type === "polyline" && Array.isArray(layer.parts) && layer.parts.length > 1 && view) {
        const total = layer.parts.reduce((sum, count) => sum + count, 0);
        if (total * 16 !== bytes) {
            problems.push(`layer ${id}: parts sum to ${total} vertices `
                + `but the buffer holds ${n}`);
        }
    }
    return problems;
}

// A packed layer's tables against its buffers. `vertices` is the coordinate
// buffer's [lat, lon] count. Every mismatch here draws wrong without an error:
// features run into each other, colours or popups land on the wrong feature.
function packedProblems(layer, buffers, vertices) {
    const problems = [];
    const id = layer.id || "(no id)";
    const n = layer.feature_count;
    if (n < 1) {
        problems.push(`layer ${id}: feature_count is ${n}; a packed layer holds at least one`);
        return problems;
    }
    const rawOffsets = buffers[`${layer.id}::offsets`];
    let offsets = null;
    if (!rawOffsets) {
        if (n > 1) {
            problems.push(`layer ${id}: ${n} features but no ::offsets buffer -- `
                + `it draws as one feature`);
        }
    } else if (rawOffsets.byteLength !== 4 * (n + 1)) {
        problems.push(`layer ${id}: offsets buffer holds `
            + `${Math.floor(rawOffsets.byteLength / 4)} uint32 entries for ${n} features `
            + `(needs ${n + 1})`);
    } else {
        // A DataView over whatever arrived: DataView, typed array or ArrayBuffer.
        const dv = new DataView(rawOffsets.buffer || rawOffsets,
            rawOffsets.byteOffset || 0, rawOffsets.byteLength);
        offsets = [];
        for (let i = 0; i <= n; i++) offsets.push(dv.getUint32(i * 4, true));
        const last = offsets[n];
        const sorted = offsets.every((v, i) => i === 0 || v >= offsets[i - 1]);
        if (offsets[0] !== 0 || last !== vertices || !sorted) {
            problems.push(`layer ${id}: offsets run ${offsets[0]}..${last} `
                + `${sorted ? "" : "out of order "}over a buffer of ${vertices} vertices`);
            offsets = null;
        }
    }
    const colors = buffers[`${layer.id}::colors`];
    if (colors && colors.byteLength !== 4 * n) {
        problems.push(`layer ${id}: colors buffer holds `
            + `${Math.floor(colors.byteLength / 4)} RGBA entries for ${n} features`);
    }
    const times = buffers[`${layer.id}::times`];
    if (times && times.byteLength !== 16 * n && times.byteLength !== 16 * vertices) {
        problems.push(`layer ${id}: times buffer holds `
            + `${Math.floor(times.byteLength / 16)} [start, end] pairs for ${n} features `
            + `(${vertices} vertices)`);
    }
    for (const [key, values] of Object.entries(layer.properties || {})) {
        if (Array.isArray(values) && values.length !== n) {
            problems.push(`layer ${id}: property "${key}" has ${values.length} `
                + `rows for ${n} features -- popups and clicks will desync`);
            break;
        }
    }
    for (const field of ["labels", "feature_styles", "rings", "parts"]) {
        if (Array.isArray(layer[field]) && layer[field].length !== n) {
            problems.push(`layer ${id}: ${field} has ${layer[field].length} `
                + `entries for ${n} features`);
        }
    }
    if (offsets) {
        const table = layer.type === "polygon" ? layer.rings : layer.parts;
        if (Array.isArray(table)) {
            for (let i = 0; i < Math.min(n, table.length); i++) {
                if (!Array.isArray(table[i])) continue;
                const flat = layer.type === "polygon" ? table[i].flat() : table[i];
                const total = flat.reduce((sum, count) => sum + count, 0);
                const own = offsets[i + 1] - offsets[i];
                if (total !== own) {
                    problems.push(`layer ${id}: feature ${i}'s `
                        + `${layer.type === "polygon" ? "rings" : "parts"} sum to ${total} `
                        + `vertices but it owns ${own}`);
                    break;
                }
            }
        }
    }
    return problems;
}

// Once per config OBJECT: patches and toggles replace configs, so a changed
// layer is a new object and gets re-checked; an unchanged one costs a set lookup.
const checked = new WeakSet();

export function warnLayerProblems(layer, buffers) {
    if (!layer || typeof layer !== "object" || checked.has(layer)) return;
    checked.add(layer);
    for (const problem of collectLayerProblems(layer, buffers)) {
        console.warn(`swiftmap: ${problem}`);
    }
    if (Array.isArray(layer.layers)) {
        for (const sub of layer.layers) warnLayerProblems(sub, buffers);
    }
}
