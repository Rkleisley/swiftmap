/**
 * Tier 2: the legend renderer, in jsdom. Pure DOM construction from a spec --
 * glyph shapes, ramp gradients, category caps, bin labels, dimming, and that user
 * data can never smuggle HTML in through a label.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { renderLegend } from "../src/legend.js";

function mount(spec, options = {}) {
    const dom = new JSDOM("<!doctype html><div id='legend'></div>");
    globalThis.document = dom.window.document;
    const el = dom.window.document.getElementById("legend");
    renderLegend(el, spec, options);
    return el;
}

const swatch = (label, over = {}) => ({
    kind: "swatch", label, shape: "circle", color: "#f00", fillColor: "#f00",
    hidden: false, ...over,
});

test("title, group headers and rows all render", () => {
    const el = mount({ title: "Key", groups: [
        { name: "Feeds", entries: [swatch("Sites"), swatch("Route", { shape: "line" })] },
    ] });
    assert.ok(el.textContent.includes("Key"));
    assert.ok(el.textContent.includes("Feeds"));
    assert.ok(el.textContent.includes("Sites") && el.textContent.includes("Route"));
});

test("a label is text, never markup", () => {
    const el = mount({ title: "Legend", groups: [
        { name: "", entries: [swatch("<img src=x onerror=alert(1)>")] },
    ] });
    assert.equal(el.querySelector("img"), null, "the label cannot inject elements");
    assert.ok(el.textContent.includes("<img"), "and still reads verbatim");
});

test("a hidden entry dims, unless dimming is off", () => {
    const spec = { title: "Legend", groups: [
        { name: "", entries: [swatch("Off", { hidden: true })] } ] };
    const dimmed = mount(spec);
    assert.equal([...dimmed.querySelectorAll("div")]
        .some(d => d.style.opacity === "0.5"), true);
    const plain = mount(spec, { dimHidden: false });
    assert.equal([...plain.querySelectorAll("div")]
        .some(d => d.style.opacity === "0.5"), false);
});

test("a ramp renders its gradient and endpoints", () => {
    const el = mount({ title: "Legend", groups: [
        { name: "", entries: [{ kind: "ramp", label: "speed", hidden: false,
            anchors: ["#440154", "#fde725"], vmin: 0, vmax: 30 }] },
    ] });
    const bar = [...el.querySelectorAll("div")]
        .find(d => d.style.backgroundImage.includes("linear-gradient"));
    assert.ok(bar, "the ramp is a CSS gradient");
    // jsdom's CSSOM normalises hex to rgb(), so match either spelling.
    const image = bar.style.backgroundImage;
    assert.ok((image.includes("#440154") || image.includes("68, 1, 84"))
        && (image.includes("#fde725") || image.includes("253, 231, 37")),
        `built from the resolved anchors -- got: ${image}`);
    assert.ok(el.textContent.includes("0") && el.textContent.includes("30"));
});

test("categories cap at twelve rows and say how many more exist", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
        ({ value: `cat ${i}`, color: "#123456" }));
    const el = mount({ title: "Legend", groups: [
        { name: "", entries: [{ kind: "categories", label: "kind", hidden: false,
                                items }] },
    ] });
    assert.ok(el.textContent.includes("cat 11"));
    assert.ok(!el.textContent.includes("cat 12"), "rows past the cap do not render");
    assert.ok(el.textContent.includes("+ 3 more"));
});

test("bins label their classes as ranges with open ends", () => {
    const el = mount({ title: "Legend", groups: [
        { name: "", entries: [{ kind: "bins", label: "depth", hidden: false,
            edges: [10, 50], colors: ["#111111", "#222222", "#333333"] }] },
    ] });
    assert.ok(el.textContent.includes("< 10"));
    assert.ok(el.textContent.includes("10 – 50"));
    assert.ok(el.textContent.includes("≥ 50"));
});

test("a group header collapses its rows and survives the re-render every sync does", () => {
    const dom = new JSDOM("<!doctype html><div id='legend'></div>");
    globalThis.document = dom.window.document;
    const el = dom.window.document.getElementById("legend");
    const spec = { title: "Legend", groups: [
        { name: "Feeds", entries: [swatch("Sites")] } ] };

    renderLegend(el, spec);
    assert.ok(el.textContent.includes("▾ Feeds") && el.textContent.includes("Sites"));

    const header = [...el.querySelectorAll("div")]
        .find(d => d.textContent.includes("Feeds"));
    header.dispatchEvent(new dom.window.Event("click"));
    assert.ok(el.textContent.includes("▸ Feeds"), "the arrow folds");
    assert.ok(!el.textContent.includes("Sites"), "the rows fold with it");

    // The sync loop re-renders the whole legend from fresh state; the fold must hold.
    renderLegend(el, spec);
    assert.ok(!el.textContent.includes("Sites"), "collapse survives a re-render");

    const folded = [...el.querySelectorAll("div")]
        .find(d => d.textContent.includes("Feeds"));
    folded.dispatchEvent(new dom.window.Event("click"));
    assert.ok(el.textContent.includes("Sites"), "clicking again expands");
});

test("two legends never share collapse state", () => {
    // The sidebar keys its collapse state at module scope and two maps on one page
    // share it -- a filed bug the legend must not inherit.
    const dom = new JSDOM("<!doctype html><div id='a'></div><div id='b'></div>");
    globalThis.document = dom.window.document;
    const a = dom.window.document.getElementById("a");
    const b = dom.window.document.getElementById("b");
    const spec = { title: "Legend", groups: [
        { name: "Feeds", entries: [swatch("Sites")] } ] };

    renderLegend(a, spec);
    renderLegend(b, spec);
    [...a.querySelectorAll("div")].find(d => d.textContent.includes("Feeds"))
        .dispatchEvent(new dom.window.Event("click"));

    assert.ok(!a.textContent.includes("Sites"), "the clicked legend folds");
    assert.ok(b.textContent.includes("Sites"), "the other map's legend does not");
});

test("re-rendering replaces the content rather than appending", () => {
    const dom = new JSDOM("<!doctype html><div id='legend'></div>");
    globalThis.document = dom.window.document;
    const el = dom.window.document.getElementById("legend");
    const spec = { title: "Legend", groups: [
        { name: "", entries: [swatch("Sites")] } ] };
    renderLegend(el, spec);
    const count = el.querySelectorAll("div").length;
    renderLegend(el, spec);
    assert.equal(el.querySelectorAll("div").length, count);
});

test("a size key is a statement, not a drawing", () => {
    const el = mount({ title: "Legend", groups: [
        { name: "", entries: [{ kind: "sizes", label: "tonnage", field: "tonnage",
                                vmin: 2, vmax: 30, hidden: false }] },
    ] });
    assert.ok(el.textContent.includes("size ∝ tonnage (2 – 30)"),
        "the encoding and its domain, in words");
    assert.equal([...el.querySelectorAll("div")]
        .filter(d => d.style.borderRadius === "50%").length, 0,
        "no sample circles -- legend pixels are not map pixels at any zoom");
});
