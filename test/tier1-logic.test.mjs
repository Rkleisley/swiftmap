/**
 * Tier 1: the renderer's decisions, tested as pure functions.
 *
 * Most "does it render" risk is not about pixels -- it is about which layer lands in which
 * draw pass, whether a nested folder's visibility is inherited, which row a click maps to,
 * and which feature wins when three overlap. All of that is data in, data out, so it runs
 * in Node in milliseconds with no browser.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    applySwiftmapPatch, isLayerEffectiveVisible, collectWebglLayers,
    normalizeRadioLayers, getLayerBounds, styleFor, getIndexedProperties,
    parseColor, formatPropertiesHTML, escapeHtml, safeUrl,
} from "../src/index.js";
import { layer, A, B } from "./helpers.mjs";

// --- visibility inheritance -------------------------------------------------------
test("a layer is visible when nothing above it is switched off", () => {
    assert.equal(isLayerEffectiveVisible(layer({ layer_group: "Feeds/Active" }), {}), true);
});

test("its own visible:false hides it", () => {
    assert.equal(isLayerEffectiveVisible(layer({ visible: false }), {}), false);
});

test("an ancestor folder switched off hides it", () => {
    const l = layer({ layer_group: "Feeds/Active" });
    assert.equal(isLayerEffectiveVisible(l, { "Feeds": { visible: false } }), false,
        "the top folder should hide everything beneath it");
    assert.equal(isLayerEffectiveVisible(l, { "Feeds/Active": { visible: false } }), false,
        "the immediate folder should hide it too");
});

test("a sibling folder being off does not hide it", () => {
    const l = layer({ layer_group: "Feeds/Active" });
    assert.equal(isLayerEffectiveVisible(l, { "Feeds/Idle": { visible: false } }), true);
});

test("visibility inheritance reaches arbitrarily deep paths", () => {
    const l = layer({ layer_group: "A/B/C/D" });
    assert.equal(isLayerEffectiveVisible(l, { "A/B": { visible: false } }), false);
    assert.equal(isLayerEffectiveVisible(l, { "A/B/C/D": { visible: false } }), false);
});

// --- WebGL bucketing --------------------------------------------------------------
test("each geometry type lands in its own draw pass", () => {
    const buckets = collectWebglLayers([
        layer({ id: "1", type: "markers" }),
        layer({ id: "2", type: "circle_markers" }),
        layer({ id: "3", type: "polyline" }),
        layer({ id: "4", type: "polygon" }),
    ], {});
    assert.deepEqual(Object.keys(buckets).map(k => buckets[k].length), [1, 1, 1, 1]);
});

test("circles are drawn in the polygon pass", () => {
    const buckets = collectWebglLayers([layer({ type: "circle" })], {});
    assert.equal(buckets.polygon.length, 1);
});

test("a hidden layer is not collected", () => {
    const buckets = collectWebglLayers([layer({ type: "markers", visible: false })], {});
    assert.equal(buckets.markers.length, 0);
});

test("a layer under a switched-off folder is not collected", () => {
    const buckets = collectWebglLayers(
        [layer({ type: "markers", layer_group: "Feeds" })],
        { "Feeds": { visible: false } });
    assert.equal(buckets.markers.length, 0);
});

test("a merged group contributes its children", () => {
    const group = layer({
        type: "group",
        layers: [layer({ id: "a", type: "markers" }), layer({ id: "b", type: "polygon" })],
    });
    const buckets = collectWebglLayers([group], {});
    assert.equal(buckets.markers.length, 1);
    assert.equal(buckets.polygon.length, 1);
});

test("a switched-off group contributes nothing, whatever its children say", () => {
    const group = layer({
        type: "group", visible: false,
        layers: [layer({ id: "a", type: "markers", visible: true })],
    });
    assert.equal(collectWebglLayers([group], {}).markers.length, 0);
});

test("sub-layers inherit the group's visibility rather than needing their own", () => {
    // Sub-layers of a merge carry visible:false individually; the group decides.
    const group = layer({
        type: "group",
        layers: [layer({ id: "a", type: "markers", visible: false })],
    });
    assert.equal(collectWebglLayers([group], {}).markers.length, 1);
});

// --- radio (single-select) groups -------------------------------------------------
test("a single-select group keeps only its first visible layer", () => {
    const layers = [
        layer({ id: "1", layer_group: "Base", visible: true }),
        layer({ id: "2", layer_group: "Base", visible: true }),
        layer({ id: "3", layer_group: "Base", visible: true }),
    ];
    const changed = normalizeRadioLayers(layers, { "Base": { multi_select: false } });
    assert.equal(changed, true, "the model needs writing back after a correction");
    assert.deepEqual(layers.map(l => l.visible), [true, false, false]);
});

test("a multi-select group is left alone", () => {
    const layers = [
        layer({ id: "1", layer_group: "Overlays", visible: true }),
        layer({ id: "2", layer_group: "Overlays", visible: true }),
    ];
    assert.equal(normalizeRadioLayers(layers, { "Overlays": { multi_select: true } }), false);
    assert.deepEqual(layers.map(l => l.visible), [true, true]);
});

// --- bounds -----------------------------------------------------------------------
test("bounds come straight from a layer's own bounds", () => {
    assert.deepEqual(getLayerBounds(layer({ bounds: [[1, 2], [3, 4]] }), {}), [[1, 2], [3, 4]]);
});

test("bounds are derived from locations when absent", () => {
    const b = getLayerBounds(layer({ type: "polygon", locations: [A, B] }), {});
    assert.deepEqual(b, [[A[0], A[1]], [B[0], B[1]]]);
});

test("bounds are read from the coordinate buffer as a last resort", () => {
    const buf = new Float64Array([A[0], A[1], B[0], B[1]]);
    const bounds = getLayerBounds(layer({ id: "L" }), { L: buf });
    assert.deepEqual(bounds, [[A[0], A[1]], [B[0], B[1]]]);
});

test("a layer with no geometry has no bounds", () => {
    assert.equal(getLayerBounds(layer(), {}), null);
});

// --- per-feature style ------------------------------------------------------------
test("a uniform layer resolves to its own style", () => {
    assert.equal(styleFor({ color: "red" }, 0).color, "red");
});

test("each feature takes its own entry when styles vary", () => {
    const l = { color: "grey", weight: 3, feature_styles: [{ color: "red" }, { color: "blue", weight: 8 }] };
    assert.equal(styleFor(l, 0).color, "red");
    assert.equal(styleFor(l, 1).color, "blue");
    assert.equal(styleFor(l, 1).weight, 8);
    assert.equal(styleFor(l, 0).weight, 3, "unset options fall back to the layer");
    assert.equal(styleFor(l, 99).color, "grey", "an index past the end falls back too");
});

// --- click-to-row mapping ---------------------------------------------------------
test("a click maps to that row's values, not the whole column", () => {
    const props = { city: ["Tarifa", "Ceuta"], pop: [18000, 84000] };
    assert.deepEqual(getIndexedProperties(props, 1), { city: "Ceuta", pop: 84000 });
});

test("scalar properties are shared by every feature", () => {
    assert.deepEqual(getIndexedProperties({ zone: "North" }, 5), { zone: "North" });
});

// --- patch application ------------------------------------------------------------
test("add, replace and remove apply by layer id", () => {
    let s = { layers: [], buffers: {} };
    s = applySwiftmapPatch(s, [{ op: "add", layer: layer({ id: "a" }) }]);
    s = applySwiftmapPatch(s, [{ op: "add", layer: layer({ id: "b" }) }]);
    assert.deepEqual(s.layers.map(l => l.id), ["a", "b"]);

    s = applySwiftmapPatch(s, [{ op: "replace", layer: layer({ id: "a", name: "renamed" }) }]);
    assert.equal(s.layers[0].name, "renamed");
    assert.equal(s.layers.length, 2, "replace must not append");

    s = applySwiftmapPatch(s, [{ op: "remove", id: "a" }]);
    assert.deepEqual(s.layers.map(l => l.id), ["b"]);
});

test("add is an upsert, so a patch racing the snapshot cannot duplicate a layer", () => {
    let s = { layers: [layer({ id: "a", name: "first" })], buffers: {} };
    s = applySwiftmapPatch(s, [{ op: "add", layer: layer({ id: "a", name: "again" }) }]);
    assert.equal(s.layers.length, 1);
    assert.equal(s.layers[0].name, "again");
});

test("removing an unknown id is a no-op", () => {
    const s = applySwiftmapPatch({ layers: [layer({ id: "a" })], buffers: {} },
                                 [{ op: "remove", id: "ghost" }]);
    assert.equal(s.layers.length, 1);
});

test("buffers are keyed by layer id and removable", () => {
    const buf = new Float64Array([1, 2]);
    let s = applySwiftmapPatch({ layers: [], buffers: {} },
                               [{ op: "buffer", id: "a", buffer_index: 0 }], [buf]);
    assert.equal(s.buffers.a, buf);
    s = applySwiftmapPatch(s, [{ op: "buffer_remove", id: "a" }]);
    assert.equal("a" in s.buffers, false, "a removed buffer must not linger on the client");
});

test("a snapshot replaces everything", () => {
    const s = applySwiftmapPatch(
        { layers: [layer({ id: "old" })], buffers: { old: 1 } },
        [{ op: "snapshot", layers: [layer({ id: "new" })], buffer_ids: ["new"] }],
        [new Float64Array([1])]);
    assert.deepEqual(s.layers.map(l => l.id), ["new"]);
    assert.deepEqual(Object.keys(s.buffers), ["new"]);
});

// --- colour ------------------------------------------------------------------------
test("hex colours parse without a DOM", () => {
    assert.deepEqual(parseColor("#ff0000"), { r: 1, g: 0, b: 0 });
    assert.deepEqual(parseColor("#f00"), { r: 1, g: 0, b: 0 });
});

test("an unparseable colour falls back rather than throwing", () => {
    assert.deepEqual(parseColor("not-a-colour"), parseColor("#3388ff"));
});

// --- popup content ------------------------------------------------------------------
test("values are escaped on the way into innerHTML", () => {
    const html = formatPropertiesHTML({ note: '<img src=x onerror="alert(1)">' });
    assert.ok(!html.includes("<img"), "markup in data must not survive as markup");
    assert.ok(html.includes("&lt;img"));
});

test("field names are escaped too", () => {
    assert.ok(!formatPropertiesHTML({ "<b>x</b>": "v" }).includes("<b>x</b>:"));
});

test("aliases replace the raw column names", () => {
    const html = formatPropertiesHTML({ pop_2020: 1 }, ["pop_2020"], ["Population"]);
    assert.ok(html.includes("<b>Population</b>"));
    assert.ok(!html.includes("pop_2020"));
});

test("mismatched aliases fall back to column names rather than failing", () => {
    const html = formatPropertiesHTML({ a: 1, b: 2 }, ["a", "b"], ["Only One"]);
    assert.ok(html.includes("<b>a</b>") && html.includes("<b>b</b>"));
});

test("escapeHtml covers every character that can break out", () => {
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("safeUrl passes real links and blocks script schemes", () => {
    assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
    assert.equal(safeUrl("data:image/png;base64,AA"), "data:image/png;base64,AA");
    assert.equal(safeUrl("javascript:alert(1)"), "");
    assert.equal(safeUrl("java\tscript:alert(1)"), "", "obfuscation with control chars");
});
