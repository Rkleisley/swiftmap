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

    time_points: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1, 36.2], lon: [-5.3, -5.2, -5.1],
                             timestamp: ["2026-01-01T00:00:00", "2026-01-02T12:30:00Z", null] },
                           { name: "Feed" });
        m.makeTimeLayer("Feed", { period: "PT1H" });
        return m;
    },

    time_epoch_pairs: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2],
                             datetime_start: [1767225600, 1767312000],
                             datetime_end: [1767229200, 1767315600] },
                           { name: "Dwells" });
        m.makeTimeLayer("Dwells", { duration: "PT2H", fade: true });
        return m;
    },

    time_clear: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2], value: [1.0, 9.0],
                             timestamp: ["2026-01-01T00:00:00", "2026-01-02T00:00:00"] },
                           { name: "Feed", colorCol: "value" });
        m.makeTimeLayer("Feed", { period: "P1D" });
        m.clearTimeLayer("Feed");
        return m;
    },

    time_append: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2],
                             timestamp: ["2026-01-01T00:00:00", "2026-01-02T00:00:00"] },
                           { name: "Feed" });
        m.makeTimeLayer("Feed", { period: "P1D" });
        m.updateLayer("Feed", { data: { lat: [36.2], lon: [-5.1],
                                        timestamp: ["2026-01-03T00:00:00"] },
                                append: true });
        return m;
    },

    time_config: () => createMapModel().configureTime(
        { period: "PT15M", speed: 2, loop: true, window: "PT2H30M",
          position: "bottom-center" }),

    basemap_names: () => {
        const m = createMapModel();
        m.addBasemap("CartoDB positron", { visible: true });
        m.addBasemap("Esri.WorldImagery");
        m.addBasemap("OpenTopoMap");
        return m;
    },

    basemap_wms: () => createMapModel().addBasemap("usgs imagery wms"),

    basemap_url: () => createMapModel().addBasemap(
        "https://tiles.example.test/{z}/{x}/{y}.png",
        { attribution: "Example tiles", maxZoom: 19 }),

    crs_4326_defaults: () => createMapModel({ crs: "EPSG:4326" }),

    collection_geojson: () => createMapModel().addCollection(
        { type: "FeatureCollection", features: [
            { type: "Feature", geometry: { type: "Point", coordinates: [-5.3, 36.0] },
              properties: { site: "A" } },
            { type: "Feature", geometry: { type: "LineString",
                                           coordinates: [[-5.3, 36.0], [-5.2, 36.1]] },
              properties: { site: "B" } },
            { type: "Feature", geometry: { type: "Polygon",
                                           coordinates: [[[-5.3, 36.0], [-5.2, 36.0],
                                                          [-5.2, 36.1], [-5.3, 36.0]]] },
              properties: { site: "C" } },
        ] }, { name: "Survey", layerGroup: "Field" }),

    polygon_hole_wkt: () => createMapModel().addPolygon(
        "POLYGON ((-5.3 36.0, -5.1 36.0, -5.1 36.2, -5.3 36.2, -5.3 36.0), "
        + "(-5.25 36.05, -5.15 36.05, -5.15 36.15, -5.25 36.05))",
        { name: "Zone", properties: { zone: "N" } }),

    multiline_wkt: () => createMapModel().addLine(
        "MULTILINESTRING ((-5.3 36.0, -5.2 36.1), (-5.1 36.0, -5.0 36.1))",
        { name: "Route", properties: { route: "R1" } }),

    line_fan_geojson: () => createMapModel().addLine(
        { type: "FeatureCollection", features: [
            { type: "Feature", geometry: { type: "LineString",
                                           coordinates: [[-5.3, 36.0], [-5.2, 36.1]] },
              properties: { n: 1 } },
            { type: "Feature", geometry: { type: "LineString",
                                           coordinates: [[-5.1, 36.0], [-5.0, 36.1]] },
              properties: { n: 2 } },
        ] }, { name: "Tracks" }),

    points_geojson: () => createMapModel().addCircleMarkers(
        { type: "FeatureCollection", features: [
            { type: "Feature", geometry: { type: "Point", coordinates: [-5.3, 36.0] },
              properties: { site: "Alpha", value: 10 } },
            { type: "Feature", geometry: { type: "Point", coordinates: [-5.2, 36.1] },
              properties: { site: "Bravo", value: 55 } },
        ] }, { name: "Sites" }),

    labels: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2],
                             site: ["Alpha", null] }, { name: "Sites", label: "site" });
        m.addPolygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]],
                     { name: "Zone", label: "Restricted" });
        return m;
    },

    style_column: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1, 36.2], lon: [-5.3, -5.2, -5.1],
                             style: ["red", { color: "#00ff00", radius: 14 }, null] },
                           { name: "Mixed" });
        m.addCircleMarkers({ lat: [36.3, 36.4], lon: [-5.0, -4.9],
                             style: ["blue", "blue"] }, { name: "Uniform" });
        return m;
    },

    static_style: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1], lon: [-5.3, -5.2], style: ["red", "green"] },
        { name: "Fixed", staticStyle: { color: "#123456" } }),

    feature_style_ops: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2] }, { name: "Sites" });
        m.setFeatureStyles("Sites", { 1: { color: "#ffcc00", radius: 14 } });
        m.setFeatureStyles("Sites", {});
        return m;
    },

    highlight: () => {
        const m = createMapModel();
        m.addCollection({ type: "FeatureCollection", features: [
            { type: "Feature", geometry: { type: "Point", coordinates: [-5.3, 36.0] },
              properties: { site: "A" } },
            { type: "Feature", geometry: { type: "LineString",
                                           coordinates: [[-5.3, 36.0], [-5.2, 36.1]] },
              properties: { site: "B" } },
            { type: "Feature", geometry: { type: "Polygon",
                                           coordinates: [[[-5.3, 36.0], [-5.2, 36.0],
                                                          [-5.2, 36.1], [-5.3, 36.0]]] },
              properties: { site: "C" } },
        ] }, { name: "Survey", layerGroup: "Field" });
        m.addCircleMarkers([[36.5, -5.5]], { name: "Other" });
        m.highlight("Survey", { color: "#ffcc00", markers: { radius: 14 },
                                polygons: { fill_opacity: 0.5 } });
        m.highlight("Other", { color: "#00ffff" });
        return m;
    },

    styled_replace: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2],
                             style: ["red", "yellow"] }, { name: "Feed" });
        m.setFeatureStyles("Feed", { 0: { radius: 20 } });
        m.updateLayer("Feed", { data: { lat: [36.2, 36.3, 36.4], lon: [-5.1, -5.0, -4.9],
                                        style: ["green", null, "red"] } });
        return m;
    },

    labels_append: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2],
                             site: ["Alpha", "Bravo"] }, { name: "Feed", label: "site" });
        m.updateLayer("Feed", { data: { lat: [36.2], lon: [-5.1], site: ["Charlie"] },
                                append: true });
        return m;
    },

    circle: () => createMapModel().addCircle([36.05, -5.25], 500,
        { name: "Perimeter", color: "#ff0000" }),

    point_fanout: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2, 36.3], lon: [-5.3, -5.2, -5.1, -5.0],
          status: ["Active", "Idle", "Active", "Fault"],
          value: [1.0, 2.0, 3.0, 4.0] },
        { name: "Feed", layerGroup: ["Sensors", "status"], colorCol: "value" }),

    point_name_column: () => createMapModel().addCircleMarkers(
        { lat: [36.0, 36.1, 36.2], lon: [-5.3, -5.2, -5.1],
          site: ["A", "B", "A"] }, { name: "site" }),

    configures: () => {
        const m = createMapModel();
        m.configureLegend({ show: true, title: "Key", position: "bottom-right",
                            scope: "visible" });
        m.configureScale({ show: true, units: "nautical", maxWidth: 160 });
        m.configureDraw({ show: true, tools: ["rectangle", "polygon"],
                          position: "top-right" });
        m.configureGroup("Feeds", { collapsed: true });
        m.configureLogo("https://example.test/logo.png",
                        { position: "bottom-right", height: 40, show: true });
        return m;
    },

    fit_bounds: () => {
        const m = createMapModel();
        m.addCircleMarkers([[36.0, -5.3]], { name: "A" });
        m.fitBounds([[35.9, -5.5], [36.2, -5.0]], { zoomOffset: -1, maxZoom: 16,
                                                    padding: 20 });
        m.addCircleMarkers([[36.1, -5.2]], { name: "B" });
        return m;
    },

    bare_wkt: () => {
        const m = createMapModel();
        m.addPolygon("POLYGON ((-5.3 36.0, -5.1 36.0, -5.1 36.2, -5.3 36.2, -5.3 36.0), "
            + "(-5.25 36.05, -5.15 36.05, -5.15 36.15, -5.25 36.05))", { name: "Zone" });
        m.addLine("MULTILINESTRING ((-5.3 36.0, -5.2 36.1), (-5.1 36.0, -5.0 36.1))",
                  { name: "Route" });
        return m;
    },

    mut_merged_visibility: () => {
        const m = createMapModel();
        for (const [i, lat] of [[1, 36.0], [2, 36.1], [3, 36.2]]) {
            m.addPolygon([[lat, -5.3], [lat, -5.2], [lat + 0.05, -5.2]],
                         { name: `Dwell ${i}`, layerGroup: "Dwells" });
            m.addCircleMarkers([[lat + 0.02, -5.25]], { name: `Dwell ${i}`,
                                                        layerGroup: "Dwells" });
        }
        m.select("Dwell 2", { scope: "Dwells" });
        m.hide("Dwell 2");
        m.show("Dwell 2");
        return m;
    },

    select_zoom: () => {
        const m = createMapModel();
        m.addCircleMarkers([[36.0, -5.3]], { name: "A", layerGroup: "Fleet" });
        m.addCircleMarkers([[36.1, -5.2]], { name: "B", layerGroup: "Fleet" });
        m.select("A", { scope: "Fleet", zoom: true, zoomOffset: -1,
                        maxZoom: 16, padding: 10 });
        return m;
    },

    radio_merge: () => {
        const m = createMapModel();
        m.addPolygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]],
                     { name: "Dwell 1", layerGroup: "Dwells", multiSelect: false });
        m.addCircleMarkers([[36.05, -5.25]], { name: "Dwell 1", layerGroup: "Dwells" });
        m.addPolygon([[36.2, -5.3], [36.2, -5.2], [36.3, -5.2]],
                     { name: "Dwell 2", layerGroup: "Dwells" });
        m.addCircleMarkers([[36.25, -5.25]], { name: "Dwell 2", layerGroup: "Dwells" });
        return m;
    },

    mut_hide_show: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2] }, { name: "Sites" });
        m.addLine([[36.0, -5.3], [36.1, -5.2]], { name: "Track" });
        m.hide("Sites");
        m.hide("Track");
        m.show("Track");
        return m;
    },

    mut_select: () => {
        const m = createMapModel();
        m.addCircleMarkers([[36.0, -5.3]], { name: "A", layerGroup: "Fleet" });
        m.addCircleMarkers([[36.1, -5.3]], { name: "B", layerGroup: "Fleet" });
        m.addCircleMarkers([[36.2, -5.3]], { name: "C", layerGroup: "Fleet" });
        m.select("B", { scope: "Fleet" });
        m.select(null, { scope: "Fleet" });
        return m;
    },

    mut_remove: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2], value: [1.0, 9.0] },
                           { name: "Sites", colorCol: "value" });
        m.addCircleMarkers([[36.3, -5.1]], { name: "Keep" });
        m.removeLayer("Sites");
        return m;
    },

    mut_update_attrs: () => {
        const m = createMapModel();
        m.addCircleMarkers([[36.0, -5.3]], { name: "Sites" });
        m.updateLayer("Sites", { color: "#112233", radius: 6 });
        return m;
    },

    mut_update_replace: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2], value: [1.0, 9.0] },
                           { name: "Feed", colorCol: "value" });
        m.updateLayer("Feed", { data: { lat: [36.2, 36.3, 36.4], lon: [-5.1, -5.0, -4.9],
                                        value: [2.0, 5.0, 8.0] } });
        return m;
    },

    mut_update_append_tail: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2], value: [10.0, 90.0] },
                           { name: "Feed", colorCol: "value", vmin: 0, vmax: 100 });
        m.updateLayer("Feed", { data: { lat: [36.2], lon: [-5.1], value: [50.0] },
                                append: true });
        return m;
    },

    mut_update_append_full: () => {
        const m = createMapModel();
        m.addCircleMarkers({ lat: [36.0, 36.1], lon: [-5.3, -5.2], value: [10.0, 90.0] },
                           { name: "Feed", colorCol: "value" });
        m.updateLayer("Feed", { data: { lat: [36.2], lon: [-5.1], value: [200.0] },
                                append: true });
        return m;
    },

    mut_update_line: () => {
        const m = createMapModel();
        m.addLine([[36.0, -5.3], [36.1, -5.2]], { name: "Track", color: "#0055ff",
                                                  properties: { vessel: "Swift One" } });
        m.updateLayer("Track", { data: [[36.0, -5.3], [36.05, -5.25], [36.2, -5.1]] });
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
        const model = build();
        const wire = model.wireState();

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

        // The wire itself: every op the model emitted, in order, buffers included.
        const emitted = model.opLog.map(({ op, buffer }) => ({
            op,
            buffer: buffer
                ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
                    .toString("base64")
                : null,
        }));
        assert.deepEqual(normalize(emitted), golden.ops,
            "the op stream matches Python's, op for op");
    });
}

test("props identities move when mutations touch them (round-2 gap A)", () => {
    const m = createMapModel();
    const before = m.props();
    m.addCircleMarkers([[36.0, -5.3]], { name: "Late" });
    const after = m.props();
    assert.notEqual(after.buffers, before.buffers,
        "a layer added after mount must reach the host as geometry, not just config");
    assert.notEqual(after.layers, before.layers);
    assert.ok(after.buffers[m.findLayers("Late")[0].id], "the new buffer is there");
});

test("the op log is bounded and clearable (round-2 gap D)", () => {
    const m = createMapModel({ maxOpLog: 5 });
    for (let i = 0; i < 20; i++) m.addCircleMarkers([[36 + i * 0.01, -5.3]], { name: `L${i}` });
    assert.ok(m.opLog.length <= 5, `capped, got ${m.opLog.length}`);
    m.clearOpLog();
    assert.equal(m.opLog.length, 0);
});

test("a consumed op stream retains nothing, and bytes are budgeted (round-3 gap I)", () => {
    const fed = createMapModel();
    fed.subscribe(() => {});
    fed.clearOpLog();          // the seeded basemaps predate the subscriber
    fed.addCircleMarkers({ lat: Array.from({ length: 500 }, (_, i) => 36 + i * 1e-4),
                           lon: Array.from({ length: 500 }, () => -5.3) },
                         { name: "Feed" });
    assert.equal(fed.opLog.length, 0,
        "a subscriber already took every op; nothing is held");

    const budgeted = createMapModel({ maxOpLogBytes: 8000 });
    for (let i = 0; i < 6; i++) {
        budgeted.addCircleMarkers(
            { lat: Array.from({ length: 200 }, (_, j) => 36 + j * 1e-4),
              lon: Array.from({ length: 200 }, () => -5.3 - i * 0.01) },
            { name: `Burst ${i}` });
    }
    const held = budgeted.opLog.reduce(
        (sum, e) => sum + (e.buffer ? e.buffer.byteLength : 0), 0);
    assert.ok(held <= 8000, `buffer bytes budgeted, holding ${held}`);
});

test("every golden has a scenario and vice versa", () => {
    const files = readdirSync(GOLDENS).filter(f => f.endsWith(".json"))
        .map(f => f.replace(/\.json$/, "")).sort();
    assert.deepEqual(Object.keys(SCENARIOS).sort(), files,
        "the Python and JS scenario lists are the same list");
});
