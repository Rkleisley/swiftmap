// The shared time slider: one control serving every time layer on the map.
//
// Ticks are generated from an ISO8601 period rather than taken from the observed
// timestamps, deliberately: a period in which nothing happened still gets its tick, so an
// empty map at 03:00 reads as absence rather than the slider skipping the quiet hours.
//
// This is swiftmap's own control rather than Leaflet.TimeDimension's. That library splits
// into a time model, a control, and per-layer adapters that re-render GeoJSON per tick --
// the adapters are unusable against WebGL layers, the model is a few dozen lines, and the
// control alone was not worth a vendored dependency on a network where every file is
// carried across by hand.

// --- ISO8601 periods ---------------------------------------------------------------
// Mirrors is_valid_period() in swiftmap/layers/_time.py; the grammar must not drift.
const PERIOD_RE =
    /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parsePeriod(text) {
    const m = PERIOD_RE.exec(text || "");
    if (!m) return null;
    return {
        years: +(m[1] || 0), months: +(m[2] || 0), weeks: +(m[3] || 0), days: +(m[4] || 0),
        hours: +(m[5] || 0), minutes: +(m[6] || 0), seconds: +(m[7] || 0),
    };
}

// Years and months move through the UTC calendar -- P1M from Jan 31 lands where Date
// arithmetic puts it, not a fixed 30 days -- while the rest is plain milliseconds.
export function addPeriod(ms, p, sign = 1) {
    const d = new Date(ms);
    if (p.years) d.setUTCFullYear(d.getUTCFullYear() + sign * p.years);
    if (p.months) d.setUTCMonth(d.getUTCMonth() + sign * p.months);
    return d.getTime() + sign * (((p.weeks * 7 + p.days) * 24 * 3600
        + p.hours * 3600 + p.minutes * 60 + p.seconds) * 1000);
}

// The slider's positions: the first tick sits one period after the earliest observation,
// so the first window (tick - period, tick] contains it; the last tick is the first to
// reach past the final observation. Capped because a mistyped PT1S over a year of data
// would otherwise hang the tab building an array of millions.
export const MAX_TICKS = 5000;

export function generateTicks(startMs, endMs, p) {
    const ticks = [];
    let t = startMs;
    while (ticks.length < MAX_TICKS) {
        t = addPeriod(t, p);
        ticks.push(t);
        if (t >= endMs) return ticks;
    }
    console.warn(`[SwiftMap] time slider capped at ${MAX_TICKS} ticks; ` +
        `the period is too fine for the data's extent. Use a coarser period.`);
    return ticks;
}

// --- windows and filtering -----------------------------------------------------------

// The interval shown at one tick. duration "period" is the tick's own period, so absence
// is visible; null accumulates everything so far; an ISO string trails a fixed window.
export function windowFor(tick, durationSpec, period) {
    if (durationSpec === null || durationSpec === undefined) {
        return { start: -Infinity, end: tick };
    }
    const p = durationSpec === "period" ? period : parsePeriod(durationSpec);
    if (!p) return { start: -Infinity, end: tick };
    return { start: addPeriod(tick, p, -1), end: tick };
}

// Half-open (start, end]: a feature stamped exactly on a tick boundary belongs to the
// period that ends there, and never to two neighbouring ticks at once. NaN times mark
// features that carried no readable time; they stay visible rather than vanishing.
export function featureInWindow(startMs, endMs, win) {
    if (Number.isNaN(startMs)) return true;
    return endMs > win.start && startMs <= win.end;
}

// Times travel as a Float64Array of interleaved [start, end] pairs in the buffer map,
// under "<layer id>::times" -- the same transport coordinates use.
export function timesFor(layer, buffers) {
    const raw = buffers && buffers[`${layer.id}::times`];
    if (!raw) return null;
    return new Float64Array(raw.buffer || raw, raw.byteOffset || 0,
        (raw.byteLength || raw.length) / 8);
}

// What rendering threads through: the current tick plus the shared period, or null when
// no slider is active. Each layer derives its own window from these, since duration is
// per layer while the tick is shared.
//
// Whether a whole layer shows at the current tick. Lines, polygons and circles are one
// geometry per layer, so they are in or out as a unit; a layer with no time metadata is
// not the slider's to hide.
export function layerInWindow(layer, buffers, timeState) {
    if (!layer.time || !timeState) return true;
    const times = timesFor(layer, buffers);
    if (!times || times.length < 2) return true;
    const win = windowFor(timeState.tick, layer.time.duration, timeState.period);
    return featureInWindow(times[0], times[1], win);
}

// The extent of every time layer's observations, NaN-blind. Feeds tick generation.
export function collectTimeExtent(layers, buffers) {
    let min = Infinity, max = -Infinity;
    const visit = (list) => list.forEach(layer => {
        if (layer.type === "group") return visit(layer.layers || []);
        if (!layer.time) return;
        const times = timesFor(layer, buffers);
        if (!times) return;
        for (let i = 0; i < times.length; i += 2) {
            if (Number.isNaN(times[i])) continue;
            if (times[i] < min) min = times[i];
            if (times[i + 1] > max) max = times[i + 1];
        }
    });
    visit(layers);
    return min === Infinity ? null : { min, max };
}

export function hasTimeLayers(layers) {
    return layers.some(l => l.type === "group"
        ? hasTimeLayers(l.layers || [])
        : Boolean(l.time));
}

// One playback step: the next index and whether playback survives it. Pure so the loop
// semantics are testable without a timer -- looping wraps and keeps playing, the end
// without loop stops where it is.
export function advance(index, length, loop) {
    if (index < length - 1) return { index: index + 1, playing: true };
    if (loop) return { index: 0, playing: true };
    return { index, playing: false };
}

function formatUTC(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + "Z";
}

// Glyphs as inline SVG rather than text: "↻" reads as refresh -- a loop toggle drawn with
// it looks like a reset button, which is exactly how it got misread. currentColor lets
// the pressed state restyle them from CSS.
const ICONS = {
    back: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M3 2h2v12H3zM13 2 6 8l7 6z"/></svg>',
    play: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 2l9 6-9 6z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 2h3v12H4zM9 2h3v12H9z"/></svg>',
    fwd: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M11 2h2v12h-2zM3 2l7 6-7 6z"/></svg>',
    loop: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M8 2a6 6 0 0 1 5.65 4H16l-2.8 3.5L10.4 6h2.1A4.5 4.5 0 1 0 12.5 10l1.3.75A6 6 0 1 1 8 2z"/></svg>',
};

// --- the control -----------------------------------------------------------------------
// Plain DOM inside the widget container, like the sidebar: no Leaflet control machinery,
// which keeps it testable in jsdom and styleable from map.css. The layout follows
// Leaflet.TimeDimension's control -- step/play/step/loop as a joined button bar, then the
// date, slider and speed -- since that is the slider users of the folium apps know.
export function renderTimeControl(container, state, handlers) {
    let el = container.querySelector(".swiftmap-time-control");
    if (!state.ticks || state.ticks.length === 0) {
        if (el) el.remove();
        return null;
    }
    if (!el) {
        el = document.createElement("div");
        el.className = "swiftmap-time-control";
        el.innerHTML = `
            <span class="swiftmap-time-buttons">
                <button class="swiftmap-time-back" title="Step back" aria-label="Step back">${ICONS.back}</button>
                <button class="swiftmap-time-play" aria-label="Play">${ICONS.play}</button>
                <button class="swiftmap-time-fwd" title="Step forward" aria-label="Step forward">${ICONS.fwd}</button>
                <button class="swiftmap-time-loop" aria-label="Loop">${ICONS.loop}</button>
            </span>
            <span class="swiftmap-time-label"></span>
            <input class="swiftmap-time-slider" type="range" min="0" step="1">
            <select class="swiftmap-time-speed" title="Playback speed">
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
            </select>`;
        container.appendChild(el);

        el.querySelector(".swiftmap-time-back").addEventListener("click", handlers.onStepBack);
        el.querySelector(".swiftmap-time-fwd").addEventListener("click", handlers.onStepForward);
        el.querySelector(".swiftmap-time-play").addEventListener("click", handlers.onPlayToggle);
        el.querySelector(".swiftmap-time-loop").addEventListener("click", handlers.onLoopToggle);
        el.querySelector(".swiftmap-time-speed").addEventListener("change",
            e => handlers.onSpeed(parseFloat(e.target.value)));
        const slider = el.querySelector(".swiftmap-time-slider");
        // `input` fires per drag step for live scrubbing; the model writeback is the
        // handler's problem, throttled there so dragging does not flood the kernel.
        slider.addEventListener("input", e => handlers.onSeek(parseInt(e.target.value, 10)));
    }

    el.querySelector(".swiftmap-time-slider").max = String(state.ticks.length - 1);
    el.querySelector(".swiftmap-time-slider").value = String(state.index);
    el.querySelector(".swiftmap-time-label").textContent = formatUTC(state.ticks[state.index]);

    const play = el.querySelector(".swiftmap-time-play");
    play.innerHTML = state.playing ? ICONS.pause : ICONS.play;
    play.setAttribute("aria-label", state.playing ? "Pause" : "Play");
    play.title = state.playing ? "Pause" : "Play";

    // A mode, not an action: pressed styling and aria-pressed say "this stays on",
    // where a bare icon invited a click expecting something to happen right now.
    const loop = el.querySelector(".swiftmap-time-loop");
    loop.classList.toggle("active", Boolean(state.loop));
    loop.setAttribute("aria-pressed", String(Boolean(state.loop)));
    loop.title = state.loop ? "Loop: on" : "Loop: off";

    el.querySelector(".swiftmap-time-speed").value = String(state.speed || 1);
    return el;
}
