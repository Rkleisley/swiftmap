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
test("ticks cover the data: first period contains the earliest observation", () => {
    const ticks = generateTicks(T0, T0 + 3 * DAY, parsePeriod("P1D"));
    assert.deepEqual(ticks, [T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY]);
});

test("an empty period still gets its tick", () => {
    // Observations on day 1 and day 3, nothing on day 2 -- the tick exists anyway,
    // which is the entire reason ticks are period-generated.
    const ticks = generateTicks(T0, T0 + 3 * DAY, parsePeriod("P1D"));
    assert.equal(ticks.length, 3, "day 2 is a tick even though nothing happened then");
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
