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

// --- write-back targets the rendered list, not the trait ----------------------------
// The sidebar renders from the list map.js keeps locally, which patches update in place.
// Python's _set_trait_quietly deliberately skips the notification, so the frontend's copy
// of the `layers` trait never advances past the initial state message. Any handler that
// rebuilds the update from the trait silently drops every layer added after display: the
// toggle matches no id, the stale list is written back, and map.js resets local state to
// it -- so the checkbox re-checks itself and the layer never hides.

/** Mounts with the rendered list deliberately ahead of the model, as a patch leaves it. */
function mountDiverged(rendered, inModel, groupConfigs = {}) {
    const dom = new JSDOM("<!doctype html><div id='sidebar'></div>");
    globalThis.document = dom.window.document;
    globalThis.Event = dom.window.Event;
    const model = makeModel({ layers: inModel, group_configs: groupConfigs });
    const el = dom.window.document.getElementById("sidebar");
    renderSidebarControls(el, rendered, model, makeMap(), () => {});
    return { el, model };
}

const boxFor = (el, name) => inputs(el).find(
    i => i.parentElement.textContent.includes(name));

test("toggling a patch-added layer writes that layer, not the stale trait", () => {
    const base = layer({ id: "a", name: "Base", layer_group: "Layers" });
    const added = layer({ id: "s1", name: "Search Result", layer_group: "Layers" });
    const { el, model } = mountDiverged([base, added], [base]);

    boxFor(el, "Search Result").click();

    const written = model.get("layers");
    const target = written.find(l => l.id === "s1");
    assert.ok(target, "the toggled layer survives the write-back");
    assert.equal(target.visible, false, "and is actually hidden");
});

test("a toggle never shrinks the layer list back to the trait's copy", () => {
    const base = layer({ id: "a", name: "Base", layer_group: "Layers" });
    const added = layer({ id: "s1", name: "Search Result", layer_group: "Layers" });
    const { el, model } = mountDiverged([base, added], [base]);

    boxFor(el, "Search Result").click();

    assert.deepEqual(model.get("layers").map(l => l.id), ["a", "s1"],
        "map.js resets local state from this write, so dropping a layer here unrenders it");
});

test("untoggling a patch-added layer leaves its siblings alone", () => {
    const base = layer({ id: "a", name: "Base", layer_group: "Layers" });
    const added = layer({ id: "s1", name: "Search Result", layer_group: "Layers" });
    const { el, model } = mountDiverged([base, added], [base]);

    boxFor(el, "Search Result").click();

    assert.equal(model.get("layers").find(l => l.id === "a").visible, true);
});

test("a radio layer added by patch can still be selected", () => {
    // Radios route through the same write-back, so they failed identically -- the symptom
    // just looked like radio semantics rather than a stale read.
    const first = layer({ id: "a", name: "Alpha", layer_group: "Modes" });
    const added = layer({ id: "b", name: "Bravo", layer_group: "Modes", visible: false });
    const { el, model } = mountDiverged([first, added], [first],
        { Modes: { visible: true, multi_select: false } });

    boxFor(el, "Bravo").click();

    const written = model.get("layers");
    assert.equal(written.find(l => l.id === "b").visible, true, "the selected radio turns on");
    assert.equal(written.find(l => l.id === "a").visible, false, "and its sibling turns off");
});

test("toggling still works when the trait and the rendered list agree", () => {
    // The undiverged path, so the fix is not just moving the failure somewhere else.
    const layers = [layer({ id: "a", name: "Alpha", layer_group: "Layers" })];
    const { el, model } = mountDiverged(layers, layers);

    boxFor(el, "Alpha").click();

    assert.equal(model.get("layers").find(l => l.id === "a").visible, false);
});

// --- the time control -------------------------------------------------------------
// Pure DOM like the sidebar, so jsdom covers it: creation, teardown, seeking, and the
// handler contract. Playback timing and WebGL filtering live in tiers 1 and 3.
import { renderTimeControl } from "../src/timecontrol.js";

function mountTime(state, handlers = {}) {
    const dom = new JSDOM("<!doctype html><div id='host'></div>");
    globalThis.document = dom.window.document;
    const host = dom.window.document.getElementById("host");
    const el = renderTimeControl(host, state, {
        onSeek: () => {}, onPlayToggle: () => {}, onLoopToggle: () => {}, onSpeed: () => {},
        ...handlers,
    });
    return { host, el, dom };
}

const T0 = Date.UTC(2026, 0, 1);
const DAY = 24 * 3600 * 1000;

test("the control renders once ticks exist", () => {
    const { el } = mountTime({ ticks: [T0, T0 + DAY], index: 0, playing: false, speed: 1 });
    assert.ok(el.querySelector(".swiftmap-time-slider"));
    assert.equal(el.querySelector(".swiftmap-time-slider").max, "1");
    assert.equal(el.querySelector(".swiftmap-time-label").textContent,
        "2026-01-01 00:00:00Z", "dates display in UTC with the Z said out loud");
});

test("no ticks means no control, and an existing one is torn down", () => {
    const { host } = mountTime({ ticks: [T0], index: 0 });
    assert.ok(host.querySelector(".swiftmap-time-control"));
    renderTimeControl(host, { ticks: [] }, {});
    assert.equal(host.querySelector(".swiftmap-time-control"), null,
        "clearing the last time layer removes the slider");
});

test("re-rendering updates the one control rather than stacking a second", () => {
    const { host } = mountTime({ ticks: [T0, T0 + DAY], index: 0 });
    renderTimeControl(host, { ticks: [T0, T0 + DAY], index: 1 }, {});
    assert.equal(host.querySelectorAll(".swiftmap-time-control").length, 1);
    assert.equal(host.querySelector(".swiftmap-time-slider").value, "1");
});

test("dragging the slider reports the tick index", () => {
    const seeks = [];
    const { el, dom } = mountTime({ ticks: [T0, T0 + DAY, T0 + 2 * DAY], index: 0 },
        { onSeek: i => seeks.push(i) });
    const slider = el.querySelector(".swiftmap-time-slider");
    slider.value = "2";
    slider.dispatchEvent(new dom.window.Event("input"));
    assert.deepEqual(seeks, [2]);
});

test("play state is reflected, not owned, by the button", () => {
    const { el } = mountTime({ ticks: [T0], index: 0, playing: true });
    assert.equal(el.querySelector(".swiftmap-time-play").textContent, "⏸");
    renderTimeControl(el.parentElement, { ticks: [T0], index: 0, playing: false }, {});
    assert.equal(el.querySelector(".swiftmap-time-play").textContent, "▶");
});

test("one slider serves however many time layers exist", () => {
    // The control renders from merged state -- ticks spanning every layer -- so a second
    // time layer widens the range instead of adding a second control.
    const { host } = mountTime({ ticks: [T0, T0 + DAY], index: 0 });
    renderTimeControl(host, { ticks: [T0, T0 + DAY, T0 + 9 * DAY], index: 0 }, {});
    assert.equal(host.querySelectorAll(".swiftmap-time-control").length, 1);
    assert.equal(host.querySelector(".swiftmap-time-slider").max, "2");
});
