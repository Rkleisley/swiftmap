/*
 * Line decoration's pure parts: the per-vertex distance ruler dashes measure
 * with, the per-segment arrow geometry, and the arrows' time attributes --
 * all in glify's exact vertex-walking order, tested away from any GL context.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildLineDistances, buildArrowPoints, arrowTimeAttrs, dashTriple,
         combineTimeHandles } from "../src/linedeco.js";
import { mercatorX, mercatorY } from "../src/heat.js";

const LAYER_A = { arrows: true, dash: [8, 4] };
const LAYER_B = {};

function feature(layer, coords, weight = 3) {
    return { geometry: { coordinates: coords },
             properties: { layer, weight, colorRGB: { r: 0, g: 0, b: 1, a: 1 } } };
}

// [lon, lat] pairs: a 3-vertex eastward line and a 2-vertex southward one.
const EAST = [[-5.30, 36.00], [-5.20, 36.00], [-5.10, 36.00]];
const SOUTH = [[-5.30, 36.00], [-5.30, 35.90]];

test("dashTriple: an on,off pair becomes period/duty/enabled; junk is solid", () => {
    assert.deepEqual(dashTriple([8, 4]), [12, 8, 1]);
    assert.deepEqual(dashTriple(null), [1, 1, 0]);
    assert.deepEqual(dashTriple([8]), [1, 1, 0]);
    assert.deepEqual(dashTriple([0, 4]), [1, 1, 0]);
});

test("distances run cumulatively per feature and reset between features", () => {
    const { dists, dash } = buildLineDistances([
        feature(LAYER_A, EAST), feature(LAYER_B, SOUTH)]);
    assert.equal(dists.length, (2 + 1) * 2);           // 2 segs + 1 seg, 2 verts each
    assert.equal(dists[0], 0);
    assert.ok(dists[1] > 0);
    assert.equal(dists[2], dists[1], "second segment starts where the first ended");
    assert.ok(dists[3] > dists[2]);
    assert.equal(dists[4], 0, "a new feature starts its own ruler at zero");
    assert.deepEqual([...dash.slice(0, 3)], [12, 8, 1]);
    assert.deepEqual([...dash.slice(12, 15)], [1, 1, 0], "the plain layer stays solid");
});

test("arrows: one per segment of flagged layers, bearing in y-down screen space", () => {
    const arrows = buildArrowPoints([
        feature(LAYER_A, EAST), feature(LAYER_B, SOUTH)]);
    assert.equal(arrows.latlngs.length, 2, "only the flagged layer grows arrows");
    assert.deepEqual(arrows.latlngs[0], [36.00, -5.25]);
    assert.ok(Math.abs(arrows.angles[0]) < 1e-9, "due east is angle zero");
    assert.deepEqual([...arrows.segIndexInLayer], [0, 1]);
    const south = buildArrowPoints([feature(LAYER_A, SOUTH)]);
    assert.ok(Math.abs(south.angles[0] - Math.PI / 2) < 1e-6,
        "due south points +90 degrees in a y-down plane");
    const expected = Math.hypot(
        mercatorX(-5.20) - mercatorX(-5.30), mercatorY(36) - mercatorY(36));
    assert.ok(Math.abs(arrows.segLens[0] - expected) < 1e-6);
});

test("arrow time attributes take per-segment spans when the layer has them", () => {
    const arrows = buildArrowPoints([feature(LAYER_A, EAST)]);
    const layerPos = new Map([[LAYER_A, 0]]);
    const meta = { base: 1000, layerIds: ["l1"], perFeature: [
        { seg: new Float64Array([0, 10, 10, 20]), start: 0, end: 20, dur: 5, idx: 0 },
    ] };
    const attrs = arrowTimeAttrs(arrows, layerPos, meta);
    assert.deepEqual([...attrs.spans], [0, 10, 10, 20]);
    assert.deepEqual([...attrs.durs], [5, 5]);
    assert.equal(attrs.base, 1000);

    const whole = arrowTimeAttrs(arrows, layerPos, { base: 0, layerIds: ["l1"],
        perFeature: [{ start: 3, end: 7, dur: 2, idx: 0 }] });
    assert.deepEqual([...whole.spans], [3, 7, 3, 7],
        "no per-segment table means every arrow takes the whole span");
});

test("a combined handle fans window and visibility pushes to both instances", () => {
    const calls = [];
    const handle = (tag) => ({
        layerIds: [tag],
        setWindow: (t, o) => calls.push([tag, "win", t, o]),
        setLayerVisibility: (v) => calls.push([tag, "vis", v]),
    });
    const combined = combineTimeHandles(handle("line"), handle("arrow"));
    combined.setWindow(5, null);
    combined.setLayerVisibility([1, 0]);
    assert.deepEqual(calls.map(c => c.slice(0, 2)),
        [["line", "win"], ["arrow", "win"], ["line", "vis"], ["arrow", "vis"]]);
    assert.deepEqual(combined.layerIds, ["line"]);
    assert.equal(combineTimeHandles(handle("only"), null).layerIds[0], "only");
});
