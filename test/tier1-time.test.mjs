/**
 * Tier 1: the time slider's pure logic — periods, ticks, windows, filtering.
 *
 * Ticks are period-generated rather than data-driven on purpose: a period in which
 * nothing happened still gets its tick, so an empty map reads as absence rather than the
 * slider skipping the quiet hours. Several tests below pin exactly that.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    parsePeriod, addPeriod, generateTicks, windowFor, featureInWindow,
    timesFor, layerInWindow, collectTimeExtent, hasTimeLayers,
    alignToPeriod, nearestTickIndex,
} from "../src/timecontrol.js";

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 0, 1);          // 2026-01-01T00:00:00Z

// --- periods ---------------------------------------------------------------------------
test("the period grammar accepts the ISO8601 durations the docs promise", () => {
    assert.deepEqual(parsePeriod("P1D"), { years: 0, months: 0, weeks: 0, days: 1,
                                           hours: 0, minutes: 0, seconds: 0 });
    assert.equal(parsePeriod("PT1H").hours, 1);
    assert.equal(parsePeriod("PT15M").minutes, 15);
    assert.equal(parsePeriod("P2W").weeks, 2);
    assert.equal(parsePeriod("P1DT12H").hours, 12);
});

test("what is not a duration is rejected, not guessed at", () => {
    for (const bad of ["", "P", "PT", "1D", "P1X", "PT1D", null, undefined]) {
        assert.equal(parsePeriod(bad), null, `${bad} must not parse`);
    }
});

test("day periods are exact milliseconds", () => {
    assert.equal(addPeriod(T0, parsePeriod("P1D")), T0 + DAY);
    assert.equal(addPeriod(T0, parsePeriod("PT6H")), T0 + DAY / 4);
});

test("month periods move through the calendar, not a fixed 30 days", () => {
    // Jan 1 + P1M is Feb 1 -- 31 days -- and Feb 1 + P1M is Mar 1 -- 28 in 2026.
    const feb = addPeriod(T0, parsePeriod("P1M"));
    assert.equal(new Date(feb).toISOString(), "2026-02-01T00:00:00.000Z");
    assert.equal(new Date(addPeriod(feb, parsePeriod("P1M"))).toISOString(),
        "2026-03-01T00:00:00.000Z");
});

test("subtracting a period inverts adding it", () => {
    const p = parsePeriod("P1M");
    assert.equal(addPeriod(addPeriod(T0, p), p, -1), T0);
});

// --- ticks -------------------------------------------------------------------------
test("ticks cover the data, earliest observation included", () => {
    // Data starting on a boundary: the first tick sits AT the earliest time, and with
    // half-open windows the earliest point is inside the first tick's own window.
    const ticks = generateTicks(T0, T0 + 3 * DAY, parsePeriod("P1D"));
    assert.deepEqual(ticks, [T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY]);
});

// --- ticks anchor to period boundaries ---------------------------------------------
test("ticks land on period boundaries, not on the data", () => {
    const HOUR = 3600 * 1000;
    const start = T0 + 17 * 60 * 1000;            // 00:17
    const ticks = generateTicks(start, T0 + 3 * HOUR, parsePeriod("PT1H"));
    assert.deepEqual(ticks, [T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR],
        "01:00, 02:00, 03:00 -- never 00:17, 01:17, 02:17");
    // The original constraint holds: the earliest observation falls inside the first
    // tick's half-open window (start, end].
    const win = windowFor(ticks[0], "period", parsePeriod("PT1H"));
    assert.ok(start > win.start && start <= win.end, "the earliest point is in the first window");
});

test("late data prepends boundaries and shifts nothing", () => {
    const HOUR = 3600 * 1000;
    const p = parsePeriod("PT1H");
    const before = generateTicks(T0 + 17 * 60 * 1000, T0 + 6 * HOUR, p);
    const after = generateTicks(T0 + 17 * 60 * 1000 - 27.8 * HOUR, T0 + 6 * HOUR, p);
    assert.ok(after.length > before.length, "earlier data adds ticks");
    assert.deepEqual(after.slice(after.length - before.length), before,
        "every original tick is still there at the same timestamp -- only earlier ones were added");
});

test("alignment per period kind", () => {
    const t = Date.UTC(2026, 0, 15, 10, 7, 30);    // Thursday 15 Jan 2026 10:07:30Z
    assert.equal(alignToPeriod(t, parsePeriod("PT15M")), Date.UTC(2026, 0, 15, 10, 15));
    assert.equal(alignToPeriod(t, parsePeriod("PT1H")), Date.UTC(2026, 0, 15, 11));
    assert.equal(alignToPeriod(t, parsePeriod("P1D")), Date.UTC(2026, 0, 16));
    assert.equal(alignToPeriod(t, parsePeriod("P1W")), Date.UTC(2026, 0, 19), "weeks start on Monday");
    assert.equal(alignToPeriod(t, parsePeriod("P1M")), Date.UTC(2026, 1, 1),
        "month starts, not 30-day multiples");
    assert.equal(alignToPeriod(t, parsePeriod("P3M")), Date.UTC(2026, 3, 1), "quarters");
    assert.equal(alignToPeriod(t, parsePeriod("P1Y")), Date.UTC(2027, 0, 1));
    assert.equal(alignToPeriod(Date.UTC(2026, 1, 1), parsePeriod("P1M")), Date.UTC(2026, 1, 1),
        "a boundary aligns to itself");
    assert.equal(alignToPeriod(t, parsePeriod("P1M1D")), t,
        "calendar plus clock units cannot align sensibly: anchored to the data, as before");
});

test("the playhead snaps to the nearest tick of a re-generated series", () => {
    const ticks = [T0, T0 + DAY, T0 + 2 * DAY];
    assert.equal(nearestTickIndex(ticks, T0 + DAY), 1, "an exact moment keeps its tick");
    assert.equal(nearestTickIndex(ticks, T0 + DAY + 1000), 1);
    assert.equal(nearestTickIndex(ticks, T0 + 1.6 * DAY), 2);
    assert.equal(nearestTickIndex([], T0), 0);
    assert.equal(nearestTickIndex(ticks, NaN), 0);
});

test("a single instant is one tick, not a hang", () => {
    assert.deepEqual(generateTicks(T0, T0, parsePeriod("P1D")), [T0]);
});

test("an empty period still gets its tick", () => {
    // Observations on day 1 and day 3, nothing on day 2 -- the tick exists anyway,
    // which is the entire reason ticks are period-generated.
    const ticks = generateTicks(T0, T0 + 3 * DAY, parsePeriod("P1D"));
    assert.equal(ticks.length, 4, "day 2 is a tick even though nothing happened then");
});

test("tick generation is capped rather than hanging the tab", () => {
    const ticks = generateTicks(T0, T0 + 365 * DAY, parsePeriod("PT1S"));
    assert.equal(ticks.length, 5000);
});

// --- windows -----------------------------------------------------------------------
test("duration 'period' shows the tick's own period", () => {
    const win = windowFor(T0 + 2 * DAY, "period", parsePeriod("P1D"));
    assert.deepEqual(win, { start: T0 + DAY, end: T0 + 2 * DAY });
});

test("duration null accumulates all history", () => {
    assert.deepEqual(windowFor(T0, null, parsePeriod("P1D")),
        { start: -Infinity, end: T0 });
});

test("an ISO duration trails a fixed window behind the tick", () => {
    const win = windowFor(T0 + DAY, "PT6H", parsePeriod("P1D"));
    assert.deepEqual(win, { start: T0 + DAY - DAY / 4, end: T0 + DAY });
});

test("a boundary stamp belongs to the period that ends there, once", () => {
    // Half-open (start, end]: a feature at exactly midnight is in the window ending at
    // midnight and NOT in the one starting there -- never two ticks at once.
    const early = { start: T0 - DAY, end: T0 };
    const late = { start: T0, end: T0 + DAY };
    assert.equal(featureInWindow(T0, T0, early), true);
    assert.equal(featureInWindow(T0, T0, late), false);
});

test("an interval overlapping any part of the window shows", () => {
    const win = { start: T0, end: T0 + DAY };
    assert.equal(featureInWindow(T0 - DAY, T0 + DAY / 2, win), true, "spans into it");
    assert.equal(featureInWindow(T0 - 2 * DAY, T0 - DAY, win), false, "ends before it");
});

test("a feature with no readable time is always shown", () => {
    assert.equal(featureInWindow(NaN, NaN, { start: T0, end: T0 + DAY }), true,
        "one bad row must not vanish from the map");
});

// --- layers ------------------------------------------------------------------------
function timesBuffer(pairs) {
    return new Float64Array(pairs.flat());
}

const state = (tick, period = "P1D") => ({ tick, period: parsePeriod(period) });

test("a whole-geometry time layer is in or out as a unit", () => {
    const layer = { id: "l1", type: "polyline", time: { duration: "period" } };
    const buffers = { "l1::times": timesBuffer([[T0 + DAY / 2, T0 + DAY / 2]]) };
    assert.equal(layerInWindow(layer, buffers, state(T0 + DAY)), true);
    assert.equal(layerInWindow(layer, buffers, state(T0 + 3 * DAY)), false);
});

test("a layer without time metadata is not the slider's to hide", () => {
    assert.equal(layerInWindow({ id: "x", type: "polyline" }, {}, state(T0)), true);
});

test("no active slider means nothing is filtered", () => {
    const layer = { id: "l1", type: "polyline", time: { duration: "period" } };
    assert.equal(layerInWindow(layer, {}, null), true);
});

test("the extent spans every time layer and ignores NaN", () => {
    const layers = [
        { id: "a", type: "circle_markers", time: {} },
        { id: "g", type: "group", layers: [{ id: "b", type: "polyline", time: {} }] },
        { id: "c", type: "circle_markers" },                    // not a time layer
    ];
    const buffers = {
        "a::times": timesBuffer([[T0, T0], [NaN, NaN], [T0 + DAY, T0 + DAY]]),
        "b::times": timesBuffer([[T0 + 5 * DAY, T0 + 6 * DAY]]),
        "c::times": timesBuffer([[T0 + 99 * DAY, T0 + 99 * DAY]]),  // ignored: no time field
    };
    assert.deepEqual(collectTimeExtent(layers, buffers), { min: T0, max: T0 + 6 * DAY });
});

test("hasTimeLayers sees into groups", () => {
    assert.equal(hasTimeLayers([{ type: "group", layers: [{ id: "b", time: {} }] }]), true);
    assert.equal(hasTimeLayers([{ id: "a" }, { type: "group", layers: [] }]), false);
});

test("timesFor reads the buffer under the layer's composite key", () => {
    const buffers = { "l1::times": timesBuffer([[T0, T0 + DAY]]) };
    const times = timesFor({ id: "l1" }, buffers);
    assert.equal(times.length, 2);
    assert.equal(times[0], T0);
    assert.equal(timesFor({ id: "l2" }, buffers), null);
});

// --- playback stepping ----------------------------------------------------------------
import { advance } from "../src/timecontrol.js";

test("playback advances one tick at a time", () => {
    assert.deepEqual(advance(0, 3, false), { index: 1, playing: true });
});

test("the end without loop stops where it is", () => {
    assert.deepEqual(advance(2, 3, false), { index: 2, playing: false });
});

test("the end with loop wraps and keeps playing", () => {
    // The complaint that pinned this: loop enabled, playback reached the end, and time
    // stopped anyway. Looping is a wrap, not a stop.
    assert.deepEqual(advance(2, 3, true), { index: 0, playing: true });
});

test("a single tick with loop spins in place rather than dying", () => {
    assert.deepEqual(advance(0, 1, true), { index: 0, playing: true });
});

// --- the window override and the ruler grid -------------------------------------------
import { effectiveDuration, periodToMs, gcdGridMs, msToPeriodISO, buildRuler,
         collectDurationsMs } from "../src/timecontrol.js";

test("a dragged window outranks every layer's own duration", () => {
    // A user gesture on the bar tells the truth for everything; per-layer settings
    // return the moment the override clears.
    const layer = { time: { duration: "PT6H" } };
    assert.equal(effectiveDuration(layer, { window: "PT1H" }), "PT1H");
    assert.equal(effectiveDuration(layer, { window: null }), "PT6H");
});

test("the override reaches whole-geometry filtering too", () => {
    const layer = { id: "l1", type: "polyline", time: { duration: null } };  // cumulative
    const buffers = { "l1::times": timesBuffer([[T0, T0]]) };
    const at = (window) => layerInWindow(layer, buffers,
        { tick: T0 + 3 * DAY, period: parsePeriod("P1D"), window });
    assert.equal(at(null), true, "cumulative keeps history");
    assert.equal(at("PT1H"), false, "the dragged window hides what fell out of it");
});

test("calendar periods have no fixed width", () => {
    assert.equal(periodToMs(parsePeriod("P1M")), null);
    assert.equal(periodToMs(parsePeriod("P1D")), 24 * 3600 * 1000);
    assert.equal(periodToMs(parsePeriod("PT1H30M")), 1.5 * 3600 * 1000);
});

test("the grid is the gcd of the interval and every duration", () => {
    const H = 3600 * 1000;
    // Robert's examples: 1h+2h -> hour marks; 1h interval with a 2.5h duration needs
    // 30-minute marks for the duration to land on one. "Lowest duration" is the special
    // case where one divides the other; gcd also covers 2h+3h -> 1h, which lowest cannot.
    assert.equal(gcdGridMs(H, [2 * H]), H);
    assert.equal(gcdGridMs(H, [2.5 * H]), H / 2);
    assert.equal(gcdGridMs(H, [2 * H, 3 * H]), H);
    assert.equal(gcdGridMs(H, []), H, "no durations: the interval is the grid");
});

test("what the drag writes always parses back to the same width", () => {
    for (const ms of [30 * 60000, 2.5 * 3600e3, 26 * 3600e3, 45000]) {
        assert.equal(periodToMs(parsePeriod(msToPeriodISO(ms))), ms);
    }
});

test("durations are collected from every time layer, groups included", () => {
    const layers = [
        { id: "a", time: { duration: "PT6H" } },
        { type: "group", layers: [{ id: "b", time: { duration: "PT2H" } }] },
        { id: "c", time: { duration: "period" } },     // contributes nothing new
        { id: "d" },                                    // not a time layer
    ];
    assert.deepEqual(collectDurationsMs(layers, null).sort((x, y) => x - y),
        [2 * 3600e3, 6 * 3600e3]);
});

test("the ruler labels intervals and leaves the minors silent", () => {
    const H = 3600 * 1000;
    const ticks = [T0, T0 + H, T0 + 2 * H];
    const marks = buildRuler(ticks, H / 2, t => "L");
    const majors = marks.filter(m => m.major);
    const minors = marks.filter(m => !m.major);
    assert.equal(majors.length, 3, "one major per interval boundary");
    assert.equal(minors.length, 2, "one silent 30-min mark inside each hour");
    assert.ok(minors.every(m => m.label === null), "duration marks are unlabelled");
    assert.ok(majors.some(m => m.label), "interval marks carry the labels");
});

test("long timelines thin the labels, not the truth", () => {
    const H = 3600 * 1000;
    const ticks = Array.from({ length: 48 }, (_, i) => T0 + i * H);
    const marks = buildRuler(ticks, H, t => "L");
    const labelled = marks.filter(m => m.label);
    assert.ok(labelled.length <= 7, "a two-day hourly bar cannot label every hour");
    assert.equal(marks.filter(m => m.major).length, 48, "every boundary still gets a mark");
});

// --- GPU time attributes ---------------------------------------------------------------
// The window test itself runs in the vertex shader, which tier 1 cannot execute; what it
// CAN pin is everything fed to it: attribute order, float32 rebasing, the encodings for
// timeless points and cumulative layers, and that the shader's boolean is the same
// half-open test featureInWindow applies on the CPU side.
import { buildTimeAttributes, timeVertexShader } from "../src/gputime.js";

const coordBuf = (n) => new DataView(new Float64Array(n * 2).buffer);
const spanBuf = (pairs) => new DataView(new Float64Array(pairs.flat()).buffer);

test("attributes follow the bucket's feeding order, layer by layer", () => {
    const layers = [
        { id: "a", time: { duration: "period" } },
        { id: "b", time: { duration: "PT2H" } },
    ];
    const buffers = {
        a: coordBuf(2), "a::times": spanBuf([[T0, T0], [T0 + DAY, T0 + DAY]]),
        b: coordBuf(1), "b::times": spanBuf([[T0 + 2 * DAY, T0 + 2 * DAY]]),
    };
    const attrs = buildTimeAttributes(layers, buffers, DAY);
    assert.equal(attrs.count, 3);
    assert.equal(attrs.base, T0, "rebased to the bucket's earliest start");
    assert.deepEqual([...attrs.spans], [0, 0, 86400, 86400, 172800, 172800]);
    assert.deepEqual([...attrs.durs], [86400, 86400, 7200],
        "each point carries its own layer's duration, in seconds");
});

test("a bucket with no time layers builds nothing", () => {
    assert.deepEqual(buildTimeAttributes([{ id: "a" }], { a: coordBuf(2) }, DAY),
        { hasTime: false });
});

test("timeless points and cumulative layers encode as always-visible", () => {
    const layers = [{ id: "a", time: { duration: null } }];
    const buffers = { a: coordBuf(2), "a::times": spanBuf([[T0, T0], [NaN, NaN]]) };
    const attrs = buildTimeAttributes(layers, buffers, DAY);
    assert.ok(attrs.durs[0] > 1e8, "cumulative: a duration longer than any dataset");
    assert.ok(attrs.spans[2] < -1e8 && attrs.spans[3] > 1e8,
        "NaN times: a span containing every tick");
});

test("a layer without time in a mixed bucket stays permanently visible", () => {
    const layers = [
        { id: "t", time: { duration: "period" } },
        { id: "plain" },
    ];
    const buffers = {
        t: coordBuf(1), "t::times": spanBuf([[T0, T0]]),
        plain: coordBuf(1),
    };
    const attrs = buildTimeAttributes(layers, buffers, DAY);
    assert.ok(attrs.spans[2] < -1e8 && attrs.spans[3] > 1e8,
        "the slider is not the plain layer's to hide");
});

test("the shader's window test is featureInWindow, boolean for boolean", () => {
    // Mirror of `aTimeSpan.y > (uTick - dur) && aTimeSpan.x <= uTick` from the shader.
    const glsl = (start, end, tick, dur) => end > (tick - dur) && start <= tick;
    const cases = [
        [T0, T0, T0, DAY],                    // on the tick itself
        [T0, T0, T0 + DAY, DAY],              // exactly one window behind: excluded
        [T0, T0, T0 + DAY / 2, DAY],          // inside
        [T0 - DAY, T0 + DAY, T0, DAY / 2],    // interval spanning the window
        [T0, T0, T0 - 1, DAY],                // in the future of the tick
    ];
    for (const [s, e, tick, dur] of cases) {
        const win = { start: tick - dur, end: tick };
        assert.equal(glsl(s, e, tick, dur), featureInWindow(s, e, win),
            `divergence at start=${s} end=${e} tick=${tick} dur=${dur}`);
    }
});

test("the vertex shader carries glify's own contract plus the window", () => {
    const src = timeVertexShader();
    for (const needed of ["uniform mat4 matrix", "attribute vec4 vertex",
                          "attribute vec4 color", "attribute float pointSize",
                          "varying vec4 _color", "aTimeSpan", "aDuration",
                          "uTick", "uOverride"]) {
        assert.ok(src.includes(needed), `shader must declare ${needed}`);
    }
});

// --- fading ---------------------------------------------------------------------------
test("fade rides the duration's sign, and timeless points never fade", () => {
    const layers = [
        { id: "f", time: { duration: "PT2H", fade: true } },
        { id: "p", time: { duration: "PT2H" } },
    ];
    const buffers = {
        f: coordBuf(2), "f::times": spanBuf([[T0, T0], [NaN, NaN]]),
        p: coordBuf(1), "p::times": spanBuf([[T0, T0]]),
    };
    const attrs = buildTimeAttributes(layers, buffers, DAY);
    assert.equal(attrs.durs[0], -7200, "fading layer: negative duration flags it");
    assert.ok(attrs.durs[1] > 0, "a timeless point has no age, so nothing to fade");
    assert.equal(attrs.durs[2], 7200, "non-fading layer keeps a positive duration");
});

test("the shader's alpha ramp: newest opaque, trailing edge zero", () => {
    // Mirror of `clamp(1.0 - (uTick - aTimeSpan.y) / dur, 0.0, 1.0)`.
    const alpha = (tick, end, dur) => Math.min(1, Math.max(0, 1 - (tick - end) / dur));
    assert.equal(alpha(100, 100, 50), 1, "a feature at the tick is fully opaque");
    assert.equal(alpha(125, 100, 50), 0.5, "halfway through the window, half faded");
    assert.equal(alpha(150, 100, 50), 0, "at the trailing edge, gone");
    assert.equal(alpha(90, 100, 50), 1, "an interval spanning the tick does not brighten past 1");
});

test("the fade terms are in the shader", () => {
    const src = timeVertexShader();
    assert.ok(src.includes("aDuration < 0.0"), "the sign is the flag");
    assert.ok(src.includes("clamp(1.0 - (uTick - aTimeSpan.y)"), "the age ramp");
});

// --- layer visibility on the GPU --------------------------------------------------------
import { collectPointLayersAll } from "../src/index.js";

test("hidden point layers stay in the bucket, marked invisible", () => {
    const layers = [
        { id: "a", type: "circle_markers", visible: true, layer_group: "Tracks" },
        { id: "b", type: "circle_markers", visible: false, layer_group: "Tracks" },
        { id: "ln", type: "polyline", visible: true, layer_group: "Tracks" },
    ];
    const out = collectPointLayersAll(layers, {});
    assert.deepEqual(out.circle_markers.map(e => [e.layer.id, e.vis]),
        [["a", true], ["b", false]], "b is present but marked hidden");
    assert.equal(out.markers.length, 0, "lines are not the point bucket's business");
});

test("a hidden folder hides its point layers without removing them", () => {
    const layers = [
        { id: "a", type: "circle_markers", visible: true, layer_group: "Feeds/Active" },
    ];
    const out = collectPointLayersAll(layers, { Feeds: { visible: false } });
    assert.deepEqual(out.circle_markers.map(e => e.vis), [false]);
});

test("group sub-layers inherit the group's effective visibility", () => {
    // Mirrors collectWebglLayers: a sub-layer's own flag defers to its parent.
    const layers = [{
        id: "g", type: "group", name: "Survey", layer_group: "Field", visible: false,
        layers: [{ id: "s", type: "circle_markers", visible: true }],
    }];
    const out = collectPointLayersAll(layers, {});
    assert.deepEqual(out.circle_markers.map(e => e.vis), [false]);
});

test("attributes carry each point's layer slot", () => {
    const layers = [
        { id: "a", time: { duration: "period" } },
        { id: "b", time: { duration: "period" } },
    ];
    const buffers = {
        a: coordBuf(2), "a::times": spanBuf([[T0, T0], [T0, T0]]),
        b: coordBuf(1), "b::times": spanBuf([[T0, T0]]),
    };
    const attrs = buildTimeAttributes(layers, buffers, DAY);
    assert.deepEqual([...attrs.layerIdx], [0, 0, 1]);
    assert.deepEqual(attrs.layerIds, ["a", "b"]);
});

test("the shader gates visibility on the layer slot", () => {
    const src = timeVertexShader();
    assert.ok(src.includes("uLayerVis[int(aLayer)]"), "per-layer uniform lookup");
});

// --- vector expansion -------------------------------------------------------------------
import { expandPerFeature, buildVectorTimeMeta } from "../src/gputime.js";

test("per-feature values expand to glify's tessellated vertex counts", () => {
    const per = [
        { start: 0, end: 0, dur: 3600, idx: 0 },
        { start: 10, end: 20, dur: -7200, idx: 1 },   // fading
    ];
    const out = expandPerFeature(per, [2, 3]);
    assert.deepEqual([...out.layerIdx], [0, 0, 1, 1, 1]);
    assert.deepEqual([...out.durs], [3600, 3600, -7200, -7200, -7200]);
    assert.deepEqual([...out.spans], [0, 0, 0, 0, 10, 20, 10, 20, 10, 20]);
});

test("vector meta mirrors the point encodings", () => {
    const layers = [
        { id: "t", time: { duration: "PT2H" } },
        { id: "plain" },
    ];
    const buffers = { "t::times": spanBuf([[T0, T0 + DAY]]) };
    const meta = buildVectorTimeMeta(layers, buffers, DAY);
    assert.equal(meta.base, T0);
    assert.deepEqual(meta.perFeature[0], { start: 0, end: 86400, dur: 7200, idx: 0 });
    assert.ok(meta.perFeature[1].end > 1e8,
        "the timeless layer is visible at every tick");
    assert.deepEqual(meta.layerIds, ["t", "plain"]);
});

test("a bucket with no timed vectors builds nothing", () => {
    assert.deepEqual(buildVectorTimeMeta([{ id: "a" }], {}, DAY), { hasTime: false });
});

test("circles join the polygon bucket in the all-layers walk", () => {
    const layers = [
        { id: "c", type: "circle", visible: false, layer_group: "V" },
        { id: "l", type: "polyline", visible: true, layer_group: "V" },
    ];
    const out = collectPointLayersAll(layers, {});
    assert.deepEqual(out.polygon.map(e => [e.layer.id, e.vis]), [["c", false]]);
    assert.deepEqual(out.polyline.map(e => [e.layer.id, e.vis]), [["l", true]]);
});

// --- per-segment spans within one line -------------------------------------------------
// One [start, end] pair per vertex animates a track per segment on ONE layer slot,
// the way a 200k-point layer animates on one -- instead of one chunk-layer per
// segment marching into the 64-slot uLayerVis ceiling.
test("a per-vertex-timed line builds per-segment spans", () => {
    const layer = { id: "t", type: "polyline", time: { duration: "PT1H" },
                    locations: [[36.0, -5.3], [36.1, -5.2], [36.2, -5.1]] };
    const buffers = { "t::times": spanBuf([[T0, T0], [T0 + DAY, T0 + DAY],
                                           [T0 + 2 * DAY, T0 + 2 * DAY]]) };
    const meta = buildVectorTimeMeta([layer], buffers, DAY);
    const f = meta.perFeature[0];
    assert.deepEqual([...f.seg], [0, 86400, 86400, 172800],
        "segment k spans vertex k's start to vertex k+1's end, rebased seconds");
    assert.equal(f.dur, 3600);
});

test("segment spans expand pairwise onto glify's two vertices per segment", () => {
    const per = [{ seg: new Float64Array([0, 10, 10, 20]), start: 0, end: 20,
                   dur: 60, idx: 0 }];
    const out = expandPerFeature(per, [4]);
    assert.deepEqual([...out.spans], [0, 10, 0, 10, 10, 20, 10, 20],
        "both endpoints of a segment carry its span, so it toggles atomically");
});

test("a count mismatch falls back to the whole-feature span, never shears", () => {
    const per = [{ seg: new Float64Array([0, 10, 10, 20]), start: 0, end: 20,
                   dur: 60, idx: 0 }];
    const out = expandPerFeature(per, [6]);
    assert.deepEqual([...out.spans], [0, 20, 0, 20, 0, 20, 0, 20, 0, 20, 0, 20]);
});

test("a pair count that matches nothing stays a whole-layer span", () => {
    // Two pairs but three vertices: not per-vertex data, so the first pair rules
    // the layer as before rather than guessing an alignment.
    const layer = { id: "t", type: "polyline", time: { duration: "PT1H" },
                    locations: [[36.0, -5.3], [36.1, -5.2], [36.2, -5.1]] };
    const buffers = { "t::times": spanBuf([[T0, T0], [T0 + DAY, T0 + DAY]]) };
    const meta = buildVectorTimeMeta([layer], buffers, DAY);
    assert.equal(meta.perFeature[0].seg, undefined);
    assert.equal(meta.perFeature[0].start, 0);
});
