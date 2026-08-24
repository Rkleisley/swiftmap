// Round-2 gaps C and E: typed-array time columns, and the AOI predicate.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLayerTimes, parseTimestamp } from "../src/times.js";
import { containsLatLon } from "../src/geo.js";

test("a typed timestamp column reads one pair per feature, like a plain array", () => {
    const epochSeconds = [1767225600, 1767312000, 1767398400];
    const typed = normalizeLayerTimes({ timestamp: new Float64Array(epochSeconds) });
    const plain = normalizeLayerTimes({ timestamp: epochSeconds });
    assert.equal(typed.interleaved.length, 6, "three features, three [start, end] pairs");
    assert.deepEqual([...typed.interleaved], [...plain.interleaved],
        "typed and plain columns normalise identically, seconds scaled to ms");
});

test("parseTimestamp corner rules hold", () => {
    assert.equal(parseTimestamp("2026-01-01T00:00:00"), Date.UTC(2026, 0, 1),
        "a naive ISO string is UTC, never local time");
    assert.equal(parseTimestamp("2026-01-01T02:00:00+02:00"), Date.UTC(2026, 0, 1));
    assert.equal(parseTimestamp(1767225600), 1767225600000, "epoch seconds scale");
    assert.ok(Number.isNaN(parseTimestamp(true)), "booleans are not timestamps");
    assert.ok(Number.isNaN(parseTimestamp(-5)));
});

test("containsLatLon answers polygons, holes and drawn circles", () => {
    const inside = containsLatLon([
        { type: "Feature", properties: {},
          geometry: { type: "Polygon", coordinates: [
              [[-5.3, 36.0], [-5.1, 36.0], [-5.1, 36.2], [-5.3, 36.2], [-5.3, 36.0]],
              [[-5.25, 36.05], [-5.15, 36.05], [-5.15, 36.15], [-5.25, 36.15],
               [-5.25, 36.05]],
          ] } },
        { type: "Feature", properties: { kind: "circle", radius: 1000 },
          geometry: { type: "Point", coordinates: [-5.0, 36.5] } },
    ]);
    assert.ok(inside(36.02, -5.28), "inside the boundary");
    assert.ok(!inside(36.1, -5.2), "inside the hole is outside");
    assert.ok(!inside(36.3, -5.2), "outside the boundary");
    assert.ok(inside(36.505, -5.0), "≈550 m from the circle centre");
    assert.ok(!inside(36.52, -5.0), "≈2.2 km away");
    assert.equal(containsLatLon([]), null,
        "nothing drawn is null, distinguishable from nothing matched");
    assert.equal(containsLatLon(null), null);
    const bare = containsLatLon([{ geometry: { type: "Polygon", coordinates: [
        [[-5.3, 36.0], [-5.1, 36.0], [-5.1, 36.2], [-5.3, 36.2], [-5.3, 36.0]],
    ] }, properties: {} }]);
    assert.ok(bare(36.02, -5.28), "a bare {geometry} carrier counts too");
});

test("a merged child draws when the group AND its own flag agree (round-2 gap B)", async () => {
    const { collectWebglLayers, collectPointLayersAll } = await import("../src/patch.js");
    const layers = [
        { id: "g", type: "group", name: "Survey", layer_group: "Field", visible: true,
          layers: [
              { id: "a", type: "circle_markers", name: "Survey", visible: true },
              { id: "b", type: "polyline", name: "Survey", visible: false },
          ] },
    ];
    const buckets = collectWebglLayers(layers, {});
    assert.equal(buckets.circle_markers.length, 1, "the visible child draws");
    assert.equal(buckets.polyline.length, 0, "the hidden child does not");
    const all = collectPointLayersAll(layers, {});
    assert.deepEqual(all.polyline.map(e => e.vis), [false],
        "the GPU visibility slot carries the child's own flag");
    const groupOff = collectWebglLayers(
        [{ ...layers[0], visible: false }], {});
    assert.equal(groupOff.circle_markers.length, 0,
        "the group toggled off still wins outright");
});
