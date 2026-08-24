// The authoring conformance suite: the JS model against Python's goldens.
//
// scripts/authoring_goldens.py builds these scenarios through the real Python
// Map and commits the exact state and buffers under test/goldens/authoring/.
// Here the SAME scenarios run through createMapModel, and the result must match:
// configs deep-equal, buffers byte-identical. Two implementations, one rulebook,
// and a change to either side breaks its suite loudly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createMapModel } from "../src/model.js";

const GOLDENS = join(dirname(fileURLToPath(import.meta.url)), "goldens", "authoring");

// One JS builder per Python scenario, same names, same inputs.
const SCENARIOS = {
    empty_map: () => createMapModel(),

    points_defaults: () => createMapModel().addCircleMarkers(
        { lat: [36.01, 36.05, 36.09], lon: [-5.31, -5.25, -5.19],
          site: ["Alpha", "Bravo", "Charlie"], value: [10, 55, 90] },
        { name: "Sites" }),

    points_styled: () => createMapModel().addCircleMarkers(
        { lat: [36.02, 36.06], lon: [-5.28, -5.22], site: ["A", "B"] },
        { name: "Beacons", layerGroup: "Feeds/Active", radius: 14, color: "#ff8800",
          tooltipFields: ["site"], tooltipNames: ["Site"] }),

    pin_markers: () => createMapModel().addMarkers(
        [[36.03, -5.27], [36.07, -5.21]], { name: "Pins" }),

    line: () => createMapModel().addLine(
        [[36.00, -5.30], [36.05, -5.25], [36.10, -5.20]],
        { name: "Track", color: "#0055ff", weight: 6,
          properties: { vessel: "Swift One" } }),

    polygon: () => createMapModel().addPolygon(
        [[36.00, -5.30], [36.00, -5.20], [36.10, -5.20]],
        { name: "Zone", color: "#ff0000", fillColor: "#00ff00",
          fillOpacity: 0.5, weight: 5 }),

    merge_promotion: () => {
        const m = createMapModel();
        m.addPolygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]],
                     { name: "Dwell 1", layerGroup: "Dwells" });
        m.addCircleMarkers([[36.05, -5.25]], { name: "Dwell 1", layerGroup: "Dwells" });
        return m;
    },

    ramp_default: () => createMapModel().addCircleMarkers(
        { lat: Array.from({ length: 101 }, (_, i) => 36.0 + i * 0.001),
          lon: Array.from({ length: 101 }, (_, i) => -5.3 + i * 0.001),
          value: Array.from({ length: 101 }, (_, i) => i) },
        { name: "Sweep", colorCol: "value" }),

    ramp_named_clamped: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2, 36.3], lon: [-5.3, -5.2, -5.1, -5.0],
          reading: [5.0, 20.0, 62.5, 95.0] },
        { name: "Readings", colorCol: "reading", colormap: "turbo", vmin: 20, vmax: 80 }),

    ramp_list: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2], lon: [-5.3, -5.2, -5.1], value: [0.0, 2.5, 10.0] },
        { name: "TwoTone", colorCol: "value", colormap: ["#000000", "#ffffff"] }),

    color_bins: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2, 36.3, 36.4], lon: [-5.3, -5.2, -5.1, -5.0, -4.9],
          value: [1.0, 3.0, 4.5, 6.0, 9.0] },
        { name: "Classed", colorCol: "value", colormap: "plasma", colorBins: [3, 6] }),

    categorical_auto: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2, 36.3], lon: [-5.3, -5.2, -5.1, -5.0],
          status: ["Idle", "Active", "Fault", "Active"] },
        { name: "Status", colorCol: "status" }),

    categorical_spread: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2, 36.3], lon: [-5.3, -5.2, -5.1, -5.0],
          grade: ["a", "b", "c", "d"] },
        { name: "Grades", colorCol: "grade", colormap: "viridis" }),

    categorical_dict: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2], lon: [-5.3, -5.2, -5.1],
          risk: ["high", "medium", "zzz"] },
        { name: "Risk", colorCol: "risk", color: "#123456",
          colormap: { high: "#ff0000", medium: "#ffaa00", low: "#00ff00" } }),

    radius_col: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2, 36.3], lon: [-5.3, -5.2, -5.1, -5.0],
          tonnage: [900.0, 12000.0, 44100.0, 78900.0] },
        { name: "Fleet", colorCol: "tonnage", radiusCol: "tonnage",
          radiusRange: [4, 20] }),

    radio_group: () => {
        const m = createMapModel();
        m.addCircleMarkers([[36.01, -5.29]], { name: "Plan A", layerGroup: "Plans",
                                               multiSelect: false });
        m.addCircleMarkers([[36.02, -5.28]], { name: "Plan B", layerGroup: "Plans" });
        return m;
    },
};

function normalize(value) {
    // Through JSON, as the goldens went: drops undefined, unifies 1.0 and 1.
    return JSON.parse(JSON.stringify(value));
}

for (const file of readdirSync(GOLDENS).filter(f => f.endsWith(".json")).sort()) {
    const golden = JSON.parse(readFileSync(join(GOLDENS, file), "utf-8"));
    const name = golden.scenario;
    test(`authoring conformance: ${name}`, () => {
        const build = SCENARIOS[name];
        assert.ok(build, `no JS scenario for golden "${name}" -- add it to SCENARIOS`);
        const wire = build().wireState();

        const buffers = wire.coordinate_buffers;
        delete wire.coordinate_buffers;
        assert.deepEqual(normalize(wire), golden.state,
            "the state matches Python's, key for key");

        assert.deepEqual(Object.keys(buffers).sort(), Object.keys(golden.buffers).sort(),
            "the same buffers exist under the same ids");
        for (const [key, view] of Object.entries(buffers)) {
            const b64 = Buffer.from(view.buffer, view.byteOffset, view.byteLength)
                .toString("base64");
            assert.equal(b64, golden.buffers[key], `buffer ${key} is byte-identical`);
        }
    });
}

test("every golden has a scenario and vice versa", () => {
    const files = readdirSync(GOLDENS).filter(f => f.endsWith(".json"))
        .map(f => f.replace(/\.json$/, "")).sort();
    assert.deepEqual(Object.keys(SCENARIOS).sort(), files,
        "the Python and JS scenario lists are the same list");
});
