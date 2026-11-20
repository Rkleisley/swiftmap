/**
 * Tier 1: packed vector layers -- many polygon or line features in ONE layer, the way
 * points have always been stored (src/packed.js). The renderer expands a packed layer
 * into per-feature views shaped like the old one-feature layers, so these tests pin
 * that every view answers exactly what the equivalent one-feature layer would.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    isPacked, expandPacked, featureOffsets, drawUnits, collectWebglLayers,
    collectPointLayersAll, collectLabels, collectLayerProblems, collectTimeExtent,
    getLayerBounds, timesFor, styleFor, layerInWindow,
} from "../src/index.js";
import { buildVectorTimeMeta } from "../src/gputime.js";
import { vectorCoords, lineParts } from "../src/layers.js";

const f64 = (arr) => new DataView(new Float64Array(arr).buffer);
const u32 = (arr) => new DataView(new Uint32Array(arr).buffer);
const u8 = (arr) => new DataView(new Uint8Array(arr).buffer);

// Three polygons: a triangle, a square with a triangular hole, a pentagon -- every
// ring closed, so the vertex counts are 4, 5 + 4, and 6.
const TRI = [[0, 0], [0, 1], [1, 0], [0, 0]];
const SQUARE = [[10, 10], [10, 14], [14, 14], [14, 10], [10, 10]];
const HOLE = [[11, 11], [11, 12], [12, 11], [11, 11]];
const PENT = [[20, 20], [20, 22], [21, 23], [22, 22], [22, 20], [20, 20]];

function packedPolygons(extra = {}) {
    const verts = [...TRI, ...SQUARE, ...HOLE, ...PENT];
    const buffers = {
        P: f64(verts.flat()),
        "P::offsets": u32([0, 4, 13, 19]),
        "P::colors": u8([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]),
    };
    const layer = {
        id: "P", type: "polygon", name: "Zones", layer_group: "Areas", visible: true,
        feature_count: 3, color: "#333333", fillOpacity: 0.4, weight: 2,
        properties: { zone: ["a", "b", "c"], score: [1, 2, 3] },
        rings: [null, [[5, 4]], null],
        labels: ["A", "B", "C"],
        bounds: [[0, 0], [22, 23]],
        ...extra,
    };
    return { layer, buffers };
}

// The same three polygons as today's one-feature layers.
function singlePolygons() {
    const mk = (id, coords, rings, label) => ({
        id, type: "polygon", name: "Zones", layer_group: "Areas", visible: true,
        color: "#333333", fillOpacity: 0.4, weight: 2, label,
        ...(rings ? { rings } : {}),
    });
    return {
        layers: [mk("s0", TRI, null, "A"), mk("s1", [...SQUARE, ...HOLE], [[5, 4]], "B"),
                 mk("s2", PENT, null, "C")],
        buffers: { s0: f64(TRI.flat()), s1: f64([...SQUARE, ...HOLE].flat()),
                   s2: f64(PENT.flat()) },
    };
}

test("a polygon or line with feature_count is packed; nothing else is", () => {
    assert.equal(isPacked({ type: "polygon", feature_count: 3 }), true);
    assert.equal(isPacked({ type: "polyline", feature_count: 1 }), true);
    assert.equal(isPacked({ type: "polygon" }), false, "today's one-feature layer");
    assert.equal(isPacked({ type: "circle_markers", feature_count: 3 }), false);
});

test("views slice the coordinates by offsets, one per feature", () => {
    const { layer, buffers } = packedPolygons();
    const views = expandPacked(layer, buffers);
    assert.equal(views.length, 3);
    assert.deepEqual(views.map(v => v.__coords.length / 2), [4, 9, 6]);
    assert.deepEqual(vectorCoords(views[0], buffers), TRI);
    assert.deepEqual(vectorCoords(views[2], buffers), PENT);
    assert.deepEqual(views.map(v => v.__index), [0, 1, 2]);
    assert.ok(views.every(v => v.id === "P" && v.__packed === layer),
        "every view answers to the layer's id -- visibility and GPU slots are per layer");
});

test("a view carries its own row, ring table and label -- and no layer-wide bounds", () => {
    const { layer, buffers } = packedPolygons();
    const views = expandPacked(layer, buffers);
    assert.deepEqual(views[1].properties, { zone: "b", score: 2 });
    assert.deepEqual(views[1].rings, [[5, 4]]);
    assert.equal(views[0].rings, undefined, "a simple feature keeps the one-ring default");
    assert.deepEqual(views.map(v => v.label), ["A", "B", "C"]);
    assert.ok(views.every(v => v.bounds === undefined && v.labels === undefined
        && v.feature_count === undefined),
        "the layer's bounds would pull every label to the layer's middle");
});

test("::colors fill each feature, and its stroke only with color_col_stroke", () => {
    const fillOnly = packedPolygons();
    const v = expandPacked(fillOnly.layer, fillOnly.buffers);
    assert.deepEqual(v.map(x => x.fillColor), ["#ff0000", "#00ff00", "#0000ff"]);
    assert.ok(v.every(x => x.color === "#333333"), "an explicit stroke stays uniform");
    const both = packedPolygons({ color_col_stroke: true });
    assert.deepEqual(expandPacked(both.layer, both.buffers).map(x => x.color),
        ["#ff0000", "#00ff00", "#0000ff"]);
    // A line has no fill: its colour IS the stroke, flag or not.
    const line = { id: "L", type: "polyline", visible: true, feature_count: 2, color: "#333333" };
    const lineBuffers = { L: f64([0, 0, 0, 1, 5, 5, 5, 6]), "L::offsets": u32([0, 2, 4]),
                          "L::colors": u8([255, 0, 0, 255, 0, 0, 255, 255]) };
    assert.deepEqual(expandPacked(line, lineBuffers).map(x => x.color), ["#ff0000", "#0000ff"]);
});

test("feature_styles merge per feature; style_overrides re-key to the view", () => {
    const { layer, buffers } = packedPolygons({
        feature_styles: [null, { weight: 7, fillOpacity: 0.9 }, null],
        style_overrides: { 2: { color: "#ffcc00" } },
    });
    const views = expandPacked(layer, buffers);
    assert.equal(views[1].weight, 7);
    assert.equal(views[0].weight, 2);
    assert.equal(styleFor(views[2], 0).color, "#ffcc00",
        "styleFor(view, 0) reads the feature's own override");
    assert.equal(styleFor(views[1], 0).color, "#333333", "no override: the layer's stroke");
});

test("per-feature ::times give each view its own pair; per-vertex times slice by offsets", () => {
    const perFeature = packedPolygons({ time: { duration: "PT1H" } });
    perFeature.buffers["P::times"] = f64([1000, 2000, 3000, 4000, 5000, 6000]);
    const v = expandPacked(perFeature.layer, perFeature.buffers);
    assert.deepEqual([...timesFor(v[1], perFeature.buffers)], [3000, 4000]);
    assert.equal(v[1].__timeIndex, 1);

    const line = {
        id: "L", type: "polyline", name: "Tracks", visible: true, feature_count: 2,
        time: { duration: "PT1H" }, parts: [null, [2, 2]],
    };
    const lineBuffers = {
        L: f64([0, 0, 0, 1, 0, 2, 5, 5, 5, 6, 9, 9, 9, 8]),
        "L::offsets": u32([0, 3, 7]),
        "L::times": f64(Array.from({ length: 14 }, (_, i) => i * 100)),
    };
    const lv = expandPacked(line, lineBuffers);
    assert.deepEqual([...timesFor(lv[1], lineBuffers)],
        [600, 700, 800, 900, 1000, 1100, 1200, 1300],
        "feature 1 owns vertices 3..6, so time floats 6..13");
    assert.equal(lv[1].__timeIndex, undefined, "a per-vertex track answers as a whole line");
    assert.deepEqual(lineParts(lv[1], lineBuffers), [[[5, 5], [5, 6]], [[9, 9], [9, 8]]],
        "the multi-part feature never draws the segment between its parts");
});

test("off the GPU path, the time window is decided per packed feature", () => {
    // The CPU fallback filters the drawn units with layerInWindow; a view must answer
    // with its own [start, end], not the layer's -- which would show all or nothing.
    const DAY = 86400000;
    const { layer, buffers } = packedPolygons({ time: { duration: "P1D" } });
    buffers["P::times"] = f64([1 * DAY, 1 * DAY, 3 * DAY, 3 * DAY, 5 * DAY, 5 * DAY]);
    const views = expandPacked(layer, buffers);
    const at = (tick) => views.filter(v => layerInWindow(v, buffers, { tick }))
        .map(v => v.__index);
    assert.deepEqual(at(3 * DAY), [1]);
    assert.deepEqual(at(5 * DAY), [2]);
    assert.deepEqual(at(9 * DAY), []);
    assert.equal(layerInWindow(layer, buffers, { tick: 3 * DAY }), true,
        "the whole layer still answers 'any feature in the window'");
});

test("views are cached per layer object and rebuilt when a buffer is replaced", () => {
    const { layer, buffers } = packedPolygons();
    const first = expandPacked(layer, buffers);
    assert.equal(expandPacked(layer, buffers), first, "same layer, same buffers: same views");
    const swapped = { ...buffers, "P::colors": u8(new Array(12).fill(128)) };
    const second = expandPacked(layer, swapped);
    assert.notEqual(second, first);
    assert.equal(second[0].fillColor, "#808080");
});

test("missing or wrong offsets draw the layer as one feature, never a garbled many", () => {
    const { layer, buffers } = packedPolygons();
    const noOffsets = { ...buffers };
    delete noOffsets["P::offsets"];
    assert.deepEqual([...featureOffsets(layer, noOffsets)], [0, 19]);
    const wrong = { ...buffers, "P::offsets": u32([0, 4, 13, 18]) };
    assert.deepEqual([...featureOffsets(layer, wrong)], [0, 19]);
});

test("a packed layer is ONE bucket entry; its features expand only at draw time", () => {
    const { layer, buffers } = packedPolygons();
    const buckets = collectWebglLayers([layer], {});
    assert.equal(buckets.polygon.length, 1, "one visibility slot for the whole layer");
    const hidden = collectWebglLayers([{ ...layer, visible: false }], {});
    assert.equal(hidden.polygon.length, 0);
    const all = collectPointLayersAll([layer], {});
    assert.equal(all.polygon.length, 1);

    const plain = { id: "x", type: "polygon", visible: true };
    const { units, slots } = drawUnits([plain, layer], buffers);
    assert.equal(units.length, 4);
    assert.deepEqual(slots, [0, 1, 1, 1], "every feature answers to its layer's slot");
});

test("vector time meta has one record per drawn feature, slotted by layer", () => {
    const { layer, buffers } = packedPolygons({ time: { duration: "PT1H" } });
    buffers["P::times"] = f64([1000, 2000, 3000, 4000, 5000, 6000]);
    const plain = { id: "x", type: "polygon", visible: true, time: { duration: "PT1H" } };
    buffers.x = f64([0, 0, 0, 1, 1, 0, 0, 0]);
    buffers["x::times"] = f64([500, 900]);
    const meta = buildVectorTimeMeta([plain, layer], buffers, null);
    assert.equal(meta.perFeature.length, 4);
    assert.deepEqual(meta.perFeature.map(f => f.idx), [0, 1, 1, 1]);
    assert.deepEqual(meta.layerIds, ["x", "P"]);
    assert.deepEqual(meta.perFeature.map(f => f.start), [0, 0.5, 2.5, 4.5],
        "rebased to the earliest start (500 ms), in seconds");
});

test("labels on a packed layer anchor where the one-feature layers' would", () => {
    const { layer, buffers } = packedPolygons();
    const packed = collectLabels([layer], buffers, {});
    const single = singlePolygons();
    const expected = collectLabels(single.layers, single.buffers, {});
    assert.equal(packed.length, 3);
    assert.deepEqual(packed, expected);
});

test("time extent and zoom bounds of a packed layer cover every feature", () => {
    const { layer, buffers } = packedPolygons({ time: { duration: "PT1H" } });
    buffers["P::times"] = f64([1000, 2000, 3000, 4000, 5000, 6000]);
    const extent = collectTimeExtent([layer], buffers);
    assert.equal(extent.min, 1000);
    assert.equal(extent.max, 6000);
    const noBounds = { ...layer };
    delete noBounds.bounds;
    assert.deepEqual(getLayerBounds(noBounds, buffers), [[0, 0], [22, 23]]);
});

test("validation passes a well-formed packed layer and names each mismatch", () => {
    const { layer, buffers } = packedPolygons();
    assert.deepEqual(collectLayerProblems(layer, buffers), []);

    const short = { ...buffers, "P::colors": u8([1, 2, 3, 4]) };
    assert.match(collectLayerProblems(layer, short).join("\n"), /colors buffer holds 1 RGBA/);

    const noOffsets = { ...buffers };
    delete noOffsets["P::offsets"];
    assert.match(collectLayerProblems(layer, noOffsets).join("\n"), /no ::offsets buffer/);

    const badRings = { ...layer, rings: [null, [[5, 3]], null] };
    assert.match(collectLayerProblems(badRings, buffers).join("\n"),
        /feature 1's rings sum to 8 vertices but it owns 9/);

    const shortProps = { ...layer, properties: { zone: ["a", "b"] } };
    assert.match(collectLayerProblems(shortProps, buffers).join("\n"),
        /property "zone" has 2 rows for 3 features/);
});
