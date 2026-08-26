// Authoring guardrails for hand-built configs and buffers.
//
// Python warns at add time -- 80 warn() sites across layers/, mapops/ and
// parsers/ -- but a JS app hands the core finished configs and packed buffers,
// and until now a malformed layer, a wrong-length buffer or an unknown type all
// produced the same result: silence, and a map that is blank or subtly wrong
// (the React port's gap report, item 2). These checks are O(layers) arithmetic
// on byte lengths, run once per config object, and print through console.warn --
// they never throw and never change what renders.
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
