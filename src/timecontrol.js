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

// The slider's positions: from the earliest observation to the first tick at or past the
// final one, one per period. Capped because a mistyped PT1S over a year of data
// would otherwise hang the tab building an array of millions.
export const MAX_TICKS = 5000;

export function generateTicks(startMs, endMs, p) {
    // The first tick sits AT the earliest observation, not one period after it: windows
    // are half-open (start, end], so a first tick at start+P would exclude the earliest
    // point from its own window and it would never display at any tick.
    const ticks = [startMs];
    let t = startMs;
    if (t >= endMs) return ticks;
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
// The duration a layer shows right now. A window dragged out on the bar is a user
// gesture and outranks every layer's configured duration while it is active -- when the
// user grabs the bar, the bar tells the truth for everything. Snapping the handle back
// onto the thumb clears the override and layers return to their own settings.
export function effectiveDuration(layer, timeState) {
    return timeState.window || (layer.time && layer.time.duration);
}

export function layerInWindow(layer, buffers, timeState) {
    if (!layer.time || !timeState) return true;
    const times = timesFor(layer, buffers);
    if (!times || times.length < 2) return true;
    const win = windowFor(timeState.tick, effectiveDuration(layer, timeState), timeState.period);
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

// Where the control sits, as inline styles so the choice travels with the state rather
// than needing a stylesheet rule per corner. Every property is written on every render --
// including the ones a position does not use -- so moving the control clears the old
// anchor instead of accumulating both.
export const POSITIONS = {
    "top-left":      { top: "10px", bottom: "", left: "10px", right: "", transform: "" },
    "top-center":    { top: "10px", bottom: "", left: "50%", right: "", transform: "translateX(-50%)" },
    "top-right":     { top: "10px", bottom: "", left: "", right: "10px", transform: "" },
    "left-center":   { top: "50%", bottom: "", left: "10px", right: "", transform: "translateY(-50%)" },
    "right-center":  { top: "50%", bottom: "", left: "", right: "10px", transform: "translateY(-50%)" },
    "bottom-left":   { top: "", bottom: "10px", left: "10px", right: "", transform: "" },
    "bottom-center": { top: "", bottom: "10px", left: "50%", right: "", transform: "translateX(-50%)" },
    "bottom-right":  { top: "", bottom: "10px", left: "", right: "10px", transform: "" },
};

function applyPosition(el, position) {
    const styles = POSITIONS[position] || POSITIONS["top-center"];
    for (const [prop, value] of Object.entries(styles)) {
        el.style[prop] = value;
    }
}

function formatUTC(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + "Z";
}

// --- the window and the ruler --------------------------------------------------------

// Fixed milliseconds for a period, or null when it moves through the calendar (months,
// years) and has no fixed width. The ruler and the drag grid need fixed widths; calendar
// periods fall back to the tick positions themselves.
export function periodToMs(p) {
    if (!p || p.years || p.months) return null;
    return ((p.weeks * 7 + p.days) * 24 * 3600 + p.hours * 3600
        + p.minutes * 60 + p.seconds) * 1000;
}

// Milliseconds as an ISO8601 duration, hours/minutes/seconds only -- PT26H is valid and
// avoids calendar units entirely, so what the drag writes always parses back exactly.
export function msToPeriodISO(ms) {
    let rest = Math.round(ms / 1000);
    const h = Math.floor(rest / 3600); rest -= h * 3600;
    const m = Math.floor(rest / 60); rest -= m * 60;
    let out = "PT";
    if (h) out += `${h}H`;
    if (m) out += `${m}M`;
    if (rest || out === "PT") out += `${rest}S`;
    return out;
}

// The ruler's increment: the largest step that lands on every boundary the user can care
// about -- the gcd of the interval and every attached duration. An interval of 1h with a
// 2.5h duration needs 30-minute marks for the duration to sit on one; 1h and 2h need only
// the hours. "Lowest duration" is the special case where one divides the other.
export function gcdGridMs(periodMs, durationsMs) {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    let grid = periodMs;
    for (const d of durationsMs) {
        if (d > 0) grid = gcd(grid, Math.round(d));
    }
    return Math.max(grid, 1000);
}

// Every finite duration attached to a time layer, in ms, for the grid. "period" and null
// contribute nothing new; calendar durations cannot join a fixed-ms grid and are skipped.
export function collectDurationsMs(layers, windowIso) {
    const out = [];
    const visit = list => list.forEach(l => {
        if (l.type === "group") return visit(l.layers || []);
        const spec = l.time && l.time.duration;
        if (typeof spec === "string" && spec !== "period") {
            const ms = periodToMs(parsePeriod(spec));
            if (ms) out.push(ms);
        }
    });
    visit(layers);
    if (windowIso) {
        const ms = periodToMs(parsePeriod(windowIso));
        if (ms) out.push(ms);
    }
    return out;
}

// Tick marks for the track: majors at every interval boundary (sparsely labelled so long
// timelines stay readable), unlabelled minors at the grid in between. Minor DISPLAY is
// thinned when dense; the snap grid stays exact, so a mark is a guide, not a constraint.
export function buildRuler(ticks, gridMs, formatLabel, { maxLabels = 6, maxMinors = 240 } = {}) {
    if (ticks.length < 2) return [];
    const t0 = ticks[0], span = ticks[ticks.length - 1] - t0;
    const marks = [];
    const labelEvery = Math.max(1, Math.ceil(ticks.length / maxLabels));
    ticks.forEach((t, i) => marks.push({
        fraction: (t - t0) / span, major: true,
        label: i % labelEvery === 0 ? formatLabel(t) : null,
    }));
    if (gridMs && gridMs < span) {
        const total = Math.floor(span / gridMs);
        const thin = Math.max(1, Math.ceil(total / maxMinors));
        for (let k = 1; k * gridMs < span; k += thin) {
            const t = t0 + k * gridMs;
            if (ticks.includes(t)) continue;
            marks.push({ fraction: (t - t0) / span, major: false, label: null });
        }
    }
    return marks;
}

export function formatTickLabel(ms, periodMs) {
    const iso = new Date(ms).toISOString();
    if (periodMs != null && periodMs < 60 * 1000) return iso.slice(11, 19);
    if (periodMs != null && periodMs < 24 * 3600 * 1000) return iso.slice(11, 16);
    return iso.slice(5, 10);
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
//
// The slider is a composite. A native <input type=range> stays on top as the thumb: it
// keeps keyboard arrows, screen readers and every existing test working, and playback
// drives it as before. Underneath sit the parts a native input cannot draw: the window
// span showing exactly what interval is on the map, a ruler with labelled interval marks
// and unlabelled gcd minors, and the trail handle -- drag it back to widen the window for
// every layer at once, drop it onto the thumb to hand control back to per-layer durations.
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
            <span class="swiftmap-time-track">
                <span class="swiftmap-time-base"></span>
                <span class="swiftmap-time-span"></span>
                <span class="swiftmap-time-ruler"></span>
                <input class="swiftmap-time-slider" type="range" min="0" step="1">
                <span class="swiftmap-time-trail" role="slider" tabindex="0"
                      aria-label="Trailing window" title="Drag back to widen the time window; drop on the thumb to clear"></span>
            </span>
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

        attachTrailDrag(el, handlers);
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
    renderTrack(el, state);
    applyPosition(el, state.position);
    return el;
}

// Geometry shared by rendering and dragging: where a time sits on the track, 0..1.
function trackFraction(ticks, t) {
    const span = ticks[ticks.length - 1] - ticks[0];
    if (span <= 0) return 1;
    return Math.min(1, Math.max(0, (t - ticks[0]) / span));
}

function renderTrack(el, state) {
    const { ticks, index } = state;
    const track = el.querySelector(".swiftmap-time-track");
    track._state = state;      // the drag handler reads the freshest state from here

    const thumbT = ticks[index];
    const periodMs = state.periodMs;
    const windowMs = state.window ? periodToMs(parsePeriod(state.window)) : null;
    const shownMs = windowMs != null ? windowMs : periodMs;

    // The span: what interval the map is showing right now. The span depicts the shared
    // window -- one period by default -- and per-layer durations remain an API concern
    // until a drag overrides them for everything at once.
    const span = el.querySelector(".swiftmap-time-span");
    const right = trackFraction(ticks, thumbT);
    const left = shownMs != null ? trackFraction(ticks, thumbT - shownMs) : 0;
    span.style.left = `${(left * 100).toFixed(2)}%`;
    span.style.width = `${(Math.max(0, right - left) * 100).toFixed(2)}%`;
    span.classList.toggle("override", windowMs != null);

    // The trail handle parks ON the thumb when no override is active -- "not grabbed" --
    // and sits at the window's start while one is. Dropping it back on the thumb clears.
    const trail = el.querySelector(".swiftmap-time-trail");
    const at = windowMs != null ? trackFraction(ticks, thumbT - windowMs) : right;
    trail.style.left = `${(at * 100).toFixed(2)}%`;
    trail.classList.toggle("active", windowMs != null);
    trail.setAttribute("aria-valuetext", state.window || "no trailing window");
    // No fixed-ms grid (calendar periods) means nothing sensible to snap to.
    trail.style.display = state.gridMs ? "" : "none";

    const ruler = el.querySelector(".swiftmap-time-ruler");
    const key = `${ticks[0]}|${ticks.length}|${state.gridMs}|${periodMs}`;
    if (ruler._key !== key) {
        ruler._key = key;
        ruler.innerHTML = "";
        for (const mark of buildRuler(ticks, state.gridMs, t => formatTickLabel(t, periodMs))) {
            const m = document.createElement("span");
            m.className = mark.major ? "swiftmap-time-mark major" : "swiftmap-time-mark";
            m.style.left = `${(mark.fraction * 100).toFixed(2)}%`;
            if (mark.label) {
                const lab = document.createElement("span");
                lab.className = "swiftmap-time-mark-label";
                lab.textContent = mark.label;
                m.appendChild(lab);
            }
            ruler.appendChild(m);
        }
    }
}

// Dragging the trail handle. Snaps to the gcd grid so every stop is a boundary the data
// or the interval actually names; the distance to the thumb, in whole grid steps, IS the
// window. Zero steps -- dropped on the thumb -- clears the override.
function attachTrailDrag(el, handlers) {
    const track = el.querySelector(".swiftmap-time-track");
    const trail = el.querySelector(".swiftmap-time-trail");

    function isoFromEvent(ev) {
        const state = track._state;
        const rect = track.getBoundingClientRect();
        if (!state || !state.gridMs || rect.width === 0) return undefined;
        // Deliberately unclamped on the left: the window is "how far back from the
        // lead point", and that may reach past the bar's start -- especially when the
        // lead sits early on the bar and most of its trail is off-screen. Clamping here
        // capped the window at the visible past, which pinned the handle to the bar's
        // start and made anything wider impossible to set. Only the DRAWING clamps.
        const frac = Math.min(1, (ev.clientX - rect.left) / rect.width);
        const t0 = state.ticks[0];
        const spanMs = state.ticks[state.ticks.length - 1] - t0;
        const thumbT = state.ticks[state.index];
        const dist = thumbT - (t0 + frac * spanMs);
        const steps = Math.max(0, Math.round(dist / state.gridMs));
        return steps === 0 ? null : msToPeriodISO(steps * state.gridMs);
    }

    // Move and release listen on the document for the duration of the drag: the handle
    // is 12px wide, the cursor leaves it on the first fast movement, and events that
    // target whatever is underneath would stutter the drag and could swallow the release
    // entirely -- an uncommitted drag then snaps back on the next sync.
    trail.addEventListener("pointerdown", ev => {
        ev.preventDefault();
        ev.stopPropagation();

        const move = e => {
            const iso = isoFromEvent(e);
            if (iso !== undefined) handlers.onWindowDrag(iso);
        };
        const finish = e => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", finish);
            const iso = isoFromEvent(e);
            if (iso !== undefined) handlers.onWindowCommit(iso);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", finish);
        document.addEventListener("pointercancel", finish);
    });

    // Keyboard: one grid step per arrow, Delete/Home to clear. Same contract as the drag.
    trail.addEventListener("keydown", ev => {
        const state = track._state;
        if (!state || !state.gridMs) return;
        const current = state.window ? periodToMs(parsePeriod(state.window)) : 0;
        let next;
        if (ev.key === "ArrowLeft") next = current + state.gridMs;
        else if (ev.key === "ArrowRight") next = Math.max(0, current - state.gridMs);
        else if (ev.key === "Delete" || ev.key === "Home") next = 0;
        else return;
        ev.preventDefault();
        handlers.onWindowCommit(next > 0 ? msToPeriodISO(next) : null);
    });
}
