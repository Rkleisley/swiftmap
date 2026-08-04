/**
 * Tier 2: the sidebar tree, in jsdom.
 *
 * renderSidebarControls is 426 lines of DOM construction that only touches Leaflet to call
 * fitBounds, so a stubbed model and map cover all of it without a browser: the folder tree,
 * checkbox vs radio, propagated visibility, and what gets written back on a toggle.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { renderSidebarControls } from "../src/sidebar.js";
import { makeModel, makeMap, layer } from "./helpers.mjs";

function mount(layers, groupConfigs = {}) {
    const dom = new JSDOM("<!doctype html><div id='sidebar'></div>");
    // sidebar.js reaches for document/Event at module level of the call, not import time.
    globalThis.document = dom.window.document;
    globalThis.Event = dom.window.Event;

    const model = makeModel({ layers, group_configs: groupConfigs });
    const map = makeMap();
    const el = dom.window.document.getElementById("sidebar");
    const toggles = [];
    renderSidebarControls(el, layers, model, map, () => toggles.push(true));
    return { el, model, map, toggles, dom };
}

const labels = el => [...el.querySelectorAll("span")]
    .map(s => s.textContent).filter(t => t && !["▸", "▾"].includes(t));

const inputs = el => [...el.querySelectorAll("input")];

// --- tree construction ------------------------------------------------------------
test("a flat list renders one entry per layer", () => {
    const { el } = mount([
        layer({ id: "1", name: "Alpha", layer_group: "Layers" }),
        layer({ id: "2", name: "Bravo", layer_group: "Layers" }),
    ]);
    const text = labels(el);
    assert.ok(text.includes("Alpha") && text.includes("Bravo"));
});

test("a slash path becomes nested folders", () => {
    const { el } = mount([layer({ id: "1", name: "Ping", layer_group: "Feeds/Active" })]);
    const text = labels(el);
    assert.ok(text.includes("Feeds"), "the top folder is rendered");
    assert.ok(text.includes("Active"), "the nested folder is rendered");
    assert.ok(text.includes("Ping"), "the layer itself is rendered");
});

test("arbitrarily deep paths nest all the way down", () => {
    const { el } = mount([layer({ id: "1", name: "Leaf", layer_group: "A/B/C/D" })]);
    const text = labels(el);
    for (const part of ["A", "B", "C", "D", "Leaf"]) {
        assert.ok(text.includes(part), `${part} should appear in the tree`);
    }
});

test("layers sharing a folder are siblings under one header", () => {
    const { el } = mount([
        layer({ id: "1", name: "One", layer_group: "Feeds" }),
        layer({ id: "2", name: "Two", layer_group: "Feeds" }),
    ]);
    assert.equal(labels(el).filter(t => t === "Feeds").length, 1, "one folder header, not two");
});

// --- checkbox vs radio ------------------------------------------------------------
test("a multi-select group renders checkboxes", () => {
    const { el } = mount(
        [layer({ id: "1", name: "A", layer_group: "Overlays" })],
        { "Overlays": { multi_select: true } });
    assert.ok(inputs(el).some(i => i.type === "checkbox"));
});

test("a single-select group renders radios for its children", () => {
    const { el } = mount([
        layer({ id: "1", name: "A", layer_group: "Base" }),
        layer({ id: "2", name: "B", layer_group: "Base" }),
    ], { "Base": { multi_select: false } });
    const radios = inputs(el).filter(i => i.type === "radio");
    assert.ok(radios.length >= 2, "each member of a single-select group is a radio");
});

test("checked state mirrors the layer's visibility", () => {
    const { el } = mount([
        layer({ id: "1", name: "On", layer_group: "L", visible: true }),
        layer({ id: "2", name: "Off", layer_group: "L", visible: false }),
    ]);
    const boxes = inputs(el).filter(i => i.type === "checkbox");
    assert.ok(boxes.some(i => i.checked), "a visible layer is checked");
    assert.ok(boxes.some(i => !i.checked), "a hidden layer is unchecked");
});

// --- interaction writes back ------------------------------------------------------
test("unticking a layer writes the new visibility back to the model", () => {
    const { el, model } = mount([layer({ id: "L1", name: "Alpha", layer_group: "Feeds" })]);
    const box = inputs(el).find(i => i.type === "checkbox" && i.name.includes("L1"));
    assert.ok(box, "the layer has its own checkbox");

    box.checked = false;
    box.dispatchEvent(new globalThis.Event("change"));

    const written = model.sets.filter(([k]) => k === "layers").pop();
    assert.ok(written, "a toggle writes the layers back");
    assert.equal(written[1].find(l => l.id === "L1").visible, false);
    assert.ok(model.saves > 0, "and commits the change");
});

test("toggling a layer runs the re-render callback", () => {
    const { el, toggles } = mount([layer({ id: "L1", name: "Alpha", layer_group: "Feeds" })]);
    const box = inputs(el).find(i => i.type === "checkbox" && i.name.includes("L1"));
    box.checked = false;
    box.dispatchEvent(new globalThis.Event("change"));
    assert.equal(toggles.length, 1, "the map is asked to redraw");
});

test("selecting one radio turns its siblings off", () => {
    const layers = [
        layer({ id: "B1", name: "Streets", layer_group: "Base", visible: true }),
        layer({ id: "B2", name: "Satellite", layer_group: "Base", visible: false }),
    ];
    const { el, model } = mount(layers, { "Base": { multi_select: false } });

    const radios = inputs(el).filter(i => i.type === "radio");
    const target = radios[radios.length - 1];
    target.checked = true;
    target.dispatchEvent(new globalThis.Event("change"));

    const written = model.sets.filter(([k]) => k === "layers").pop();
    assert.ok(written, "a radio selection writes back");
    const visible = written[1].filter(l => l.visible);
    assert.equal(visible.length, 1, "exactly one member of a single-select group stays on");
});

test("ticking a folder writes its visibility into group_configs", () => {
    const { el, model } = mount([layer({ id: "1", name: "Ping", layer_group: "Feeds" })]);
    const folderBox = inputs(el).find(i => i.name.startsWith("group_"));
    assert.ok(folderBox, "the folder has its own checkbox");

    folderBox.checked = false;
    folderBox.dispatchEvent(new globalThis.Event("change"));

    const written = model.sets.filter(([k]) => k === "group_configs").pop();
    assert.ok(written, "folder visibility lives in group_configs, not on the layer");
    assert.equal(written[1]["Feeds"].visible, false);
});

test("checking a layer fits the map to its bounds", () => {
    const { el, map } = mount([
        layer({ id: "L1", name: "Alpha", layer_group: "Feeds",
                visible: false, bounds: [[35.9, -5.4], [36.2, -5.1]] }),
    ]);
    const box = inputs(el).find(i => i.type === "checkbox" && i.name.includes("L1"));
    box.checked = true;
    box.dispatchEvent(new globalThis.Event("change"));
    assert.deepEqual(map.calls.fitBounds.pop(), [[35.9, -5.4], [36.2, -5.1]]);
});

// --- visual inheritance -----------------------------------------------------------
test("entries under a switched-off folder are dimmed", () => {
    const { el } = mount(
        [layer({ id: "1", name: "Ping", layer_group: "Feeds" })],
        { "Feeds": { visible: false } });
    const dimmed = [...el.querySelectorAll("div")].filter(d => d.style.opacity === "0.5");
    assert.ok(dimmed.length > 0, "a hidden parent greys out what is beneath it");
});

test("the basemaps folder has no checkbox of its own", () => {
    // Basemaps are mutually exclusive by construction, so the folder is not toggleable.
    const { el } = mount([layer({ id: "1", name: "OSM", type: "basemap", layer_group: "Basemaps" })]);
    assert.ok(!inputs(el).some(i => i.name === "group_Basemaps"));
});

// --- rendering is repeatable ------------------------------------------------------
test("re-rendering replaces the tree rather than appending to it", () => {
    const layers = [layer({ id: "1", name: "Alpha", layer_group: "Feeds" })];
    const { el, model, map } = mount(layers);
    const before = el.querySelectorAll("input").length;
    renderSidebarControls(el, layers, model, map, () => {});
    assert.equal(el.querySelectorAll("input").length, before, "no duplicated controls");
});
