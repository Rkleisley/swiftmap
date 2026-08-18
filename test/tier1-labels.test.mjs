/**
 * Tier 1: permanent-label anchors -- pure data in, positioned texts out.
 * Points anchor at their buffer coordinates, a line at its middle vertex (on the
 * line, not floating in its box), areas at their bounds centre. Hidden layers and
 * unchecked folders contribute nothing: labels describe the screen.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { collectLabels } from "../src/labels.js";
import { layer } from "./helpers.mjs";

const buf = pairs => new DataView(new Float64Array(pairs.flat()).buffer);

test("point labels anchor at their buffer coordinates", () => {
    const out = collectLabels(
        [layer({ id: "p", labels: ["Alpha", "", "Charlie"] })],
        { p: buf([[36.0, -5.3], [36.1, -5.2], [36.2, -5.1]]) }, {});
    assert.deepEqual(out.map(l => [l.lat, l.lng, l.text]),
        [[36.0, -5.3, "Alpha"], [36.2, -5.1, "Charlie"]],
        "an empty label is no label");
});

test("a line labels at its middle vertex, an area at its bounds centre", () => {
    const out = collectLabels([
        layer({ id: "l", type: "polyline", label: "Route",
                locations: [[36.0, -5.3], [36.1, -5.2], [36.2, -5.1]] }),
        layer({ id: "g", type: "polygon", label: "Zone",
                bounds: [[35.0, -6.0], [36.0, -5.0]] }),
        layer({ id: "c", type: "circle", label: "Ring", location: [40.0, -3.7] }),
    ], {}, {});
    assert.deepEqual(out.map(l => [l.lat, l.lng, l.text]), [
        [36.1, -5.2, "Route"],
        [35.5, -5.5, "Zone"],
        [40.0, -3.7, "Ring"],
    ]);
});

test("hidden layers and unchecked folders contribute no labels", () => {
    const out = collectLabels([
        layer({ id: "1", type: "polygon", label: "Off", visible: false,
                bounds: [[0, 0], [1, 1]] }),
        layer({ id: "2", type: "polygon", label: "FolderOff", layer_group: "Feeds",
                bounds: [[0, 0], [1, 1]] }),
    ], {}, { Feeds: { visible: false } });
    assert.deepEqual(out, []);
});

test("labelled points with no buffer are skipped, never thrown on", () => {
    assert.deepEqual(collectLabels([layer({ id: "p", labels: ["A"] })], {}, {}), []);
});

test("collections descend", () => {
    const out = collectLabels([layer({
        id: "c", type: "group", name: "Survey",
        layers: [{ id: "s1", type: "polygon", label: "Site",
                   bounds: [[10, 10], [12, 12]] }],
    })], {}, {});
    assert.deepEqual(out.map(l => l.text), ["Site"]);
});
