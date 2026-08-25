// Authoring guardrails: the checks that turned silent JS failures into warnings.
import test from "node:test";
import assert from "node:assert/strict";

import { collectLayerProblems } from "../src/validate.js";
import { applySwiftmapPatch } from "../src/patch.js";
import { formatBound } from "../src/legend.js";
import { layersBoundsUnion } from "../src/utils.js";

const f64 = (nums) => new DataView(new Float64Array(nums).buffer);
const u8 = (nums) => new DataView(new Uint8Array(nums).buffer);
const f32 = (nums) => new DataView(new Float32Array(nums).buffer);

const DAY = Date.UTC(2026, 0, 1);

function cleanLayer() {
    return {
        layer: { id: "a", type: "circle_markers", name: "A",
                 properties: { site: ["x", "y"] } },
        buffers: { a: f64([36, -5, 36.1, -5.1]),
                   "a::colors": u8([1, 2, 3, 4, 5, 6, 7, 8]),
                   "a::radii": f32([4, 6]),
                   "a::times": f64([DAY, DAY, DAY, DAY]) },
    };
}

test("a well-formed layer raises no problems", () => {
    const { layer, buffers } = cleanLayer();
    assert.deepEqual(collectLayerProblems(layer, buffers), []);
});

test("an unknown type is named, and nothing else is piled on", () => {
    const problems = collectLayerProblems({ id: "a", type: "hologram" }, {});
    assert.equal(problems.length, 1);
    assert.match(problems[0], /unknown type "hologram"/);
});

test("a heatmap with a dangling source or misaligned weights is called out", () => {
    const dangling = collectLayerProblems(
        { id: "h", type: "heatmap", source: "gone" }, {});
    assert.equal(dangling.length, 1);
    assert.match(dangling[0], /source layer "gone" with no coordinate buffer/);

    const coords = new DataView(new ArrayBuffer(2 * 16));
    const weights = new DataView(new ArrayBuffer(3 * 4));
    const misaligned = collectLayerProblems(
        { id: "h", type: "heatmap" }, { h: coords, "h::weights": weights });
    assert.equal(misaligned.length, 1);
    assert.match(misaligned[0], /weights buffer holds 3 float32 entries for 2 points/);
});

test("every buffer length mismatch is called out against the point count", () => {
    const { layer, buffers } = cleanLayer();
    buffers["a::colors"] = u8([1, 2, 3, 4]);          // 1 entry for 2 points
    buffers["a::radii"] = f32([4]);                    // 1 for 2
    buffers["a::times"] = f64([DAY, DAY]);             // 1 pair for 2
    const problems = collectLayerProblems(layer, buffers);
    assert.match(problems.find(p => p.includes("colors")), /1 RGBA entries for 2 points/);
    assert.match(problems.find(p => p.includes("radii")), /1 float32 entries for 2 points/);
    assert.match(problems.find(p => p.includes("times") && p.includes("pairs")),
        /1 \[start, end\] pairs for 2 points/);
});

test("a property column of the wrong length is a desync warning", () => {
    const { layer, buffers } = cleanLayer();
    layer.properties = { site: ["only one"] };
    assert.match(collectLayerProblems(layer, buffers)[0], /"site" has 1 rows for 2 points/);
});

test("epoch seconds in a times buffer are recognised", () => {
    const { layer, buffers } = cleanLayer();
    const secs = DAY / 1000;
    buffers["a::times"] = f64([secs, secs, secs, secs]);
    assert.match(collectLayerProblems(layer, buffers).find(p => p.includes("SECONDS")),
        /times are epoch milliseconds/);
});

test("rings and parts must sum to the buffer's vertices", () => {
    const poly = collectLayerProblems(
        { id: "z", type: "polygon", rings: [[4, 3]] },
        { z: f64(new Array(4 * 2).fill(0)) });        // 4 vertices, rings say 7
    assert.match(poly[0], /rings sum to 7 vertices but the buffer holds 4/);
    const line = collectLayerProblems(
        { id: "t", type: "polyline", parts: [3, 3] },
        { t: f64(new Array(4 * 2).fill(0)) });        // 4 vertices, parts say 6
    assert.match(line[0], /parts sum to 6 vertices but the buffer holds 4/);
});

test("an append whose base disagrees with the property rows warns and names the layer", () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
        applySwiftmapPatch(
            { layers: [{ id: "a", type: "circle_markers",
                         properties: { site: ["x", "y"] } }],
              buffers: {} },
            [{ op: "append", id: "a", base: 5, count: 1, properties: { site: ["z"] } }],
            []);
    } finally {
        console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /append to a: base 5 .* 2 rows .* desync/);
});

test("legend bounds read like labels, not doubles", () => {
    assert.equal(formatBound(0.0037567270919680595), "0.003757");
    assert.equal(formatBound(5.981683373451233), "5.982");
    assert.equal(formatBound(78900), "78900");
    assert.equal(formatBound("high"), "high");
});

test("the bounds union spans groups and skips layers without bounds", () => {
    const union = layersBoundsUnion([
        { id: "base", type: "basemap" },
        { id: "a", bounds: [[36.0, -5.3], [36.1, -5.2]] },
        { id: "g", type: "group", layers: [{ id: "b", bounds: [[35.9, -5.5], [36.05, -5.25]] }] },
    ]);
    assert.deepEqual(union, [[35.9, -5.5], [36.1, -5.2]]);
    assert.equal(layersBoundsUnion([{ id: "base" }]), null);
});
