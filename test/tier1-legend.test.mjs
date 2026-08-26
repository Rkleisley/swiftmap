/**
 * Tier 1: legend derivation and overrides -- pure data in, spec out.
 *
 * The legend is derived from the same layer state everything else renders from,
 * never registered: there is no entries dict to fall out of step with the layers,
 * which was the StructMap manager's failure mode. Manual adds and persistent
 * remove-matchers apply on top as declarative config.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { deriveLegendSpec } from "../src/legend.js";
import { layer } from "./helpers.mjs";

const flat = spec => spec.groups.flatMap(
    g => g.entries.map(e => ({ group: g.name, ...e })));

const labelled = (spec, label) => flat(spec).filter(e => e.label === label);

// --- derivation ---------------------------------------------------------------------
test("geometry layers derive swatches; basemaps derive nothing", () => {
    const spec = deriveLegendSpec([
        layer({ id: "b", type: "basemap", name: "OSM", layer_group: "Basemaps" }),
        layer({ id: "p", type: "circle_markers", name: "Sites", color: "#f00" }),
        layer({ id: "m", type: "markers", name: "Pins" }),
        layer({ id: "l", type: "polyline", name: "Route", color: "#00f" }),
        layer({ id: "g", type: "polygon", name: "Zone", color: "#0f0", fillColor: "#0f8" }),
    ], {}, {});
    const shapes = Object.fromEntries(flat(spec).map(e => [e.label, e.shape]));
    assert.deepEqual(shapes, {
        Sites: "circle", Pins: "pin", Route: "line", Zone: "polygon" });
    const zone = labelled(spec, "Zone")[0];
    assert.equal(zone.color, "#0f0");
    assert.equal(zone.fillColor, "#0f8", "areas swatch fill and border separately");
});

test("groups follow layer order and empty groups vanish", () => {
    const spec = deriveLegendSpec([
        layer({ id: "1", name: "B", layer_group: "Second" }),
        layer({ id: "2", name: "A", layer_group: "First" }),
        layer({ id: "3", type: "basemap", name: "OSM", layer_group: "Basemaps" }),
    ], {}, {});
    assert.deepEqual(spec.groups.map(g => g.name), ["Second", "First"],
        "insertion order, matching the sidebar, not alphabetical");
});

test("hidden state comes from the layer and its folders", () => {
    const spec = deriveLegendSpec([
        layer({ id: "1", name: "Off", visible: false }),
        layer({ id: "2", name: "FolderOff", layer_group: "Feeds" }),
        layer({ id: "3", name: "On" }),
    ], { Feeds: { visible: false } }, {});
    assert.equal(labelled(spec, "Off")[0].hidden, true);
    assert.equal(labelled(spec, "FolderOff")[0].hidden, true);
    assert.equal(labelled(spec, "On")[0].hidden, false);
});

test("scope visible drops hidden entries; the default keeps them flagged", () => {
    const layers = [layer({ id: "1", name: "Off", visible: false }),
                    layer({ id: "2", name: "On" })];
    assert.equal(flat(deriveLegendSpec(layers, {}, {})).length, 2);
    const visible = deriveLegendSpec(layers, {}, { scope: "visible" });
    assert.deepEqual(flat(visible).map(e => e.label), ["On"]);
});

test("a collection contributes one entry per geometry part", () => {
    const spec = deriveLegendSpec([layer({
        id: "c", type: "group", name: "Survey", layer_group: "Field",
        layers: [
            { id: "c1", type: "circle_markers", name: "Survey", color: "#111" },
            { id: "c2", type: "polyline", name: "Survey", color: "#222" },
            { id: "c3", type: "polygon", name: "Survey", color: "#333" },
        ],
    })], {}, {});
    assert.deepEqual(flat(spec).map(e => e.shape), ["circle", "line", "polygon"],
        "shared label by design; the glyphs tell the parts apart");
});

test("a data-driven legend block replaces the swatch", () => {
    const spec = deriveLegendSpec([layer({
        id: "1", name: "Tracks",
        legend: { kind: "ramp", field: "speed", anchors: ["#000", "#fff"],
                  vmin: 0, vmax: 30 },
    })], {}, {});
    const entry = flat(spec)[0];
    assert.equal(entry.kind, "ramp");
    assert.deepEqual(entry.anchors, ["#000", "#fff"]);
    assert.equal(entry.vmax, 30);
});

test("identical data-driven blocks collapse to one row named by the field", () => {
    const block = { kind: "ramp", field: "speed", anchors: ["#000", "#fff"],
                    vmin: 0, vmax: 30 };
    const spec = deriveLegendSpec([
        layer({ id: "1", name: "Cargo", layer_group: "Fleet/cargo", legend: block }),
        layer({ id: "2", name: "Tanker", layer_group: "Fleet/tanker", legend: block,
                visible: false }),
    ], {}, {});
    const ramps = flat(spec).filter(e => e.kind === "ramp");
    assert.equal(ramps.length, 1, "one shared mapping, one row");
    assert.equal(ramps[0].label, "speed", "the field is the honest label");
    assert.equal(ramps[0].hidden, false, "hidden only when every contributor is");
});

// --- overrides ------------------------------------------------------------------------
test("auto false leaves only the manual entries", () => {
    const spec = deriveLegendSpec(
        [layer({ id: "1", name: "Derived" })], {},
        { auto: false, add: [{ kind: "swatch", label: "Mine", shape: "square",
                               color: "#000", fillColor: "#000" }] });
    assert.deepEqual(flat(spec).map(e => e.label), ["Mine"]);
});

test("removes suppress by label, group, or layer id -- derived and manual alike", () => {
    const layers = [
        layer({ id: "1", name: "Keep", layer_group: "A" }),
        layer({ id: "2", name: "ByLabel", layer_group: "A" }),
        layer({ id: "3", name: "ByGroup", layer_group: "Debug" }),
        layer({ id: "4", name: "ById", layer_group: "A" }),
    ];
    const spec = deriveLegendSpec(layers, {}, {
        remove: [{ label: "ByLabel" }, { group: "Debug" }, { id: "4" },
                 { label: "Mine" }],
        add: [{ kind: "swatch", label: "Mine", shape: "square",
                color: "#000", fillColor: "#000" }],
    });
    assert.deepEqual(flat(spec).map(e => e.label), ["Keep"]);
});

test("an empty matcher suppresses nothing", () => {
    const spec = deriveLegendSpec([layer({ id: "1", name: "Keep" })], {},
        { remove: [{}] });
    assert.equal(flat(spec).length, 1);
});

test("manual entries ignore scope unless bound to a layer", () => {
    const layers = [layer({ id: "1", name: "Sites", visible: false })];
    const spec = deriveLegendSpec(layers, {}, {
        scope: "visible",
        add: [
            { kind: "swatch", label: "Free", shape: "square", color: "#000",
              fillColor: "#000" },
            { kind: "swatch", label: "Bound", shape: "square", color: "#000",
              fillColor: "#000", layer: "Sites" },
        ],
    });
    assert.deepEqual(flat(spec).map(e => e.label), ["Free"],
        "the bound entry follows its layer out of a visible-scope legend");
});

test("a bound manual entry dims with its layer under the default scope", () => {
    const spec = deriveLegendSpec(
        [layer({ id: "1", name: "Sites", visible: false })], {},
        { add: [{ kind: "swatch", label: "Bound", shape: "square", color: "#000",
                  fillColor: "#000", layer: "Sites" }] });
    assert.equal(labelled(spec, "Bound")[0].hidden, true);
});

test("the title defaults and overrides", () => {
    assert.equal(deriveLegendSpec([], {}, {}).title, "Legend");
    assert.equal(deriveLegendSpec([], {}, { title: "Key" }).title, "Key");
});

test("a size key rides beside the colour entry, one row each", () => {
    const spec = deriveLegendSpec([layer({
        id: "1", name: "Ships", type: "circle_markers",
        legend: { kind: "ramp", field: "speed", anchors: ["#000", "#fff"],
                  vmin: 0, vmax: 30 },
        legend_size: { kind: "sizes", field: "tonnage", vmin: 2, vmax: 30 },
    })], {}, {});
    const entries = flat(spec);
    assert.deepEqual(entries.map(e => e.kind), ["ramp", "sizes"],
        "both encodings on the map, both explained in the legend");
    assert.equal(entries[1].label, "tonnage");
});

test("identical size keys collapse like identical ramps", () => {
    const block = { kind: "sizes", field: "tonnage", vmin: 2, vmax: 30 };
    const spec = deriveLegendSpec([
        layer({ id: "1", name: "Cargo", layer_group: "Fleet/cargo", legend_size: block }),
        layer({ id: "2", name: "Tanker", layer_group: "Fleet/tanker", legend_size: block }),
    ], {}, {});
    assert.equal(flat(spec).filter(e => e.kind === "sizes").length, 1,
        "one shared mapping, one row");
});

// --- round 8: heat layers and merged entries ----------------------------------------
test("a heatmap layer's ramp block reaches the legend (round-8 T)", () => {
    const block = { kind: "ramp", field: "density", anchors: ["#000", "#fff"],
                    vmin: "low", vmax: "high" };
    const spec = deriveLegendSpec([
        layer({ id: "h", type: "heatmap", name: "Heat", legend: block }),
        layer({ id: "x", type: "heatmap", name: "HexHeat", cells: "h3", legend: block }),
        layer({ id: "c", type: "circle_markers", name: "Control" }),
    ], {}, {});
    const kinds = flat(spec).map(e => e.kind);
    assert.deepEqual(kinds, ["ramp", "swatch"],
        "both kernels contribute (identical blocks collapse to one ramp row); "
        + "the control still swatches");
});

test("a bare heatmap layer falls back to a gradient swatch", () => {
    const spec = deriveLegendSpec([
        layer({ id: "h", type: "heatmap", name: "Heat",
                ramp: ["#111111", "#eeeeee"] }),
    ], {}, {});
    const [entry] = flat(spec);
    assert.equal(entry.shape, "gradient");
    assert.deepEqual(entry.gradient, ["#111111", "#eeeeee"]);
});

test("a merged entry's own legend block speaks for its members (round-8 S)", () => {
    const block = { kind: "ramp", field: "count", anchors: ["#000", "#fff"],
                    vmin: 1, vmax: 1942 };
    const members = Array.from({ length: 5 }, (_, i) =>
        layer({ id: `m${i}`, type: "polygon", name: "Cells",
                fillColor: `#00000${i}` }));
    const spec = deriveLegendSpec([
        layer({ id: "grp", type: "group", name: "Cells", legend: block,
                layers: members }),
    ], {}, {});
    const entries = flat(spec);
    assert.equal(entries.length, 1, "one row, not one per styled member");
    assert.equal(entries[0].kind, "ramp");
    assert.equal(entries[0].label, "count",
        "the shared mapping labels itself by its field");
});
