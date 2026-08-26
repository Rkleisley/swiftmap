// The demo site's host over the swiftmap core.
//
// A static export (swiftmap/export.py) is one map per file, with the whole
// bundle inlined -- perfect for handing someone a map, wrong for a page that
// wants twenty of them: twenty exports is twenty copies of the same 650 KB.
//
// So this page is the OTHER shape the host interface allows. The bundle loads
// ONCE, from assets/swiftmap.js, and every map on the page is a `createHostStub`
// over a small map.json plus its coordinate buffers as raw .bin files -- binary
// on the wire instead of the export's base64, which is the same bytes minus the
// 4/3. Nothing here reaches into the core; it drives exactly the five methods
// documented in src/host.js, which is the point of the exercise.
//
// Two things this file exists to manage, both consequences of many maps on one
// page:
//
//   * WebGL contexts. Browsers cap them somewhere around 16 and start dropping
//     the oldest when you pass it, which looks exactly like a rendering bug.
//     Cards mount when they scroll into view and the least-recently-seen one is
//     destroyed past MAX_LIVE.
//   * Bytes. Nothing is fetched until its card is near the viewport, and the
//     hero's larger tiers are fetched only when someone asks for them.

const MAX_LIVE = 5;          // concurrent mounted cards, WebGL contexts allowing
const DATA = "data";         // where build_demos.py wrote map.json + *.bin

// ---------------------------------------------------------------- the bundle

// One import for the whole page. `widget` is the anywidget default export
// (render({model, el})); `createHostStub` is src/host.js, the reference host an
// export uses too.
const bundle = import("./swiftmap.js");

// ------------------------------------------------------------------ fetching

const jsonCache = new Map();
const bufCache = new Map();

function fetchMapJson(slug) {
    if (!jsonCache.has(slug)) {
        jsonCache.set(slug, fetch(`${DATA}/${slug}/map.json`).then(r => {
            if (!r.ok) throw new Error(`${slug}/map.json: HTTP ${r.status}`);
            return r.json();
        }));
    }
    return jsonCache.get(slug);
}

// A buffer file, as the DataView the core expects -- the same type
// decodeBase64Buffers hands it in an export, arrived by a shorter road.
// `onBytes` reports progress so the hero can show a real bar rather than a
// spinner that means nothing.
function fetchBuffer(slug, file, onBytes) {
    const key = `${slug}/${file}`;
    if (bufCache.has(key)) return bufCache.get(key);
    const p = (async () => {
        const res = await fetch(`${DATA}/${key}`);
        if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
        if (!onBytes || !res.body) return new DataView(await res.arrayBuffer());
        const chunks = [];
        let seen = 0;
        const reader = res.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            seen += value.byteLength;
            onBytes(seen);
        }
        const out = new Uint8Array(seen);
        let at = 0;
        for (const c of chunks) { out.set(c, at); at += c.byteLength; }
        return new DataView(out.buffer);
    })();
    bufCache.set(key, p);
    return p;
}

// The state the core reads: the composed map state with its buffers filled in.
// A fresh object every call -- the core writes back into whatever it is given
// (center, zoom, group_configs...), so two mounts must never share one.
async function loadState(slug, onBytes) {
    const { state, buffers } = await fetchMapJson(slug);
    const total = buffers.reduce((n, b) => n + b.bytes, 0);
    const per = new Array(buffers.length).fill(0);
    const views = await Promise.all(buffers.map((b, i) => fetchBuffer(
        slug, b.file,
        onBytes ? seen => { per[i] = seen; onBytes(per.reduce((a, c) => a + c, 0), total); } : null,
    )));
    const fresh = structuredClone(state);
    fresh.coordinate_buffers = {};
    buffers.forEach((b, i) => { fresh.coordinate_buffers[b.key] = views[i]; });
    if (onBytes) onBytes(total, total);
    return fresh;
}

// -------------------------------------------------------------------- mounts

// Every live map on the page, oldest first. `seen` is bumped whenever a card is
// visible, so the eviction below drops the one nobody has looked at longest.
const live = [];

// Every mount gets its own element inside the container, and destroys only
// that. The hero swaps tiers within one container, and teardown here is
// deferred (see `retire`) -- sharing an element would let a retiring map wipe
// the successor that had already taken its place. Owning a subtree makes the
// two orders independent, which is the only reason a delay is safe at all.
async function mount(container, state) {
    const { default: widget, createHostStub } = await bundle;
    const el = document.createElement("div");
    el.className = "mount";
    container.appendChild(el);
    const host = createHostStub(state);
    const cleanup = await widget.render({ model: host, el });
    return {
        host,
        mountedAt: performance.now(),
        destroy() { try { cleanup && cleanup(); } catch (_) {} el.remove(); },
    };
}

// Leaflet arms a bare `setTimeout(_onZoomTransitionEnd, 250)` when it starts a
// zoom animation, and map.remove() does not clear it -- so a map torn down
// inside that window throws from a timer that outlived it. The opening auto-fit
// IS a zoom animation, which makes "mounted, then immediately discarded" the
// case that hits it: a fast scroll through the gallery, or a quick click up the
// hero's ladder. Nothing on this page needs a teardown to be instantaneous, so
// young maps are retired on a delay instead. Two WebGL contexts overlap for a
// moment, which is nowhere near the browser's cap.
const RETIRE_AFTER_MS = 1500;

function retire(handle) {
    if (!handle) return;
    const age = performance.now() - handle.mountedAt;
    if (age >= RETIRE_AFTER_MS) handle.destroy();
    else setTimeout(() => handle.destroy(), RETIRE_AFTER_MS - age);
}

// Never evict a card that is on screen. An IntersectionObserver only reports
// *changes*, so a card blanked while visible would never be told to come back
// -- it would sit empty until the reader scrolled it away and back. Going one
// over the cap is the cheaper mistake.
function evictBeyondCap() {
    while (live.length > MAX_LIVE) {
        const offscreen = live.filter(e => !e.visible).sort((a, b) => a.seen - b.seen);
        if (!offscreen.length) return;
        const gone = offscreen[0];
        live.splice(live.indexOf(gone), 1);
        retire(gone.handle);
        gone.card.dataset.state = "idle";
        gone.card.dataset.hint = "scroll back to load";
        gone.mounted = false;
    }
}

// ---------------------------------------------------------------- the cards

function setupCards() {
    const cards = [...document.querySelectorAll("[data-demo]")];
    if (!cards.length) return;

    const entries = new Map(cards.map(el => [el, {
        card: el, slug: el.dataset.demo, seen: 0,
        visible: false, mounted: false, busy: false,
    }]));

    const io = new IntersectionObserver(async (records) => {
        for (const rec of records) {
            const e = entries.get(rec.target);
            e.visible = rec.isIntersecting;
            if (!rec.isIntersecting) { evictBeyondCap(); continue; }
            e.seen = performance.now();
            if (e.mounted || e.busy) continue;
            e.busy = true;
            rec.target.dataset.state = "loading";
            rec.target.dataset.hint = "loading map...";
            try {
                const state = await loadState(e.slug);
                e.handle = await mount(rec.target, state);
                e.mounted = true;
                rec.target.dataset.state = "live";
                live.push(e);
                evictBeyondCap();
            } catch (err) {
                console.error(`[swiftmap demos] ${e.slug}`, err);
                rec.target.dataset.state = "error";
                rec.target.dataset.hint = `could not load this map (${err.message})`;
            } finally {
                e.busy = false;
            }
        }
    }, { rootMargin: "300px 0px" });   // start a card just before it arrives

    cards.forEach(el => { el.dataset.state = "idle"; el.dataset.hint = "loading map..."; io.observe(el); });
}

// ------------------------------------------------------------------ the hero

// The hero is one element that swaps between prebuilt tiers of the same data.
// Swapping tears down the map and builds a new one -- which is honest, because
// that is what a fresh page of that size costs -- but the viewport carries
// across, so clicking up the ladder keeps you looking at the same water.
function setupHero() {
    const stage = document.getElementById("hero-stage");
    if (!stage) return;

    const el = stage.querySelector(".map");
    const veil = stage.querySelector(".veil");
    const veilText = veil.querySelector(".txt");
    const veilBar = veil.querySelector(".bar i");
    const tiers = [...stage.parentElement.querySelectorAll(".tier")];
    const outPts = document.getElementById("hero-points");
    const outMs = document.getElementById("hero-ms");
    const outFps = document.getElementById("hero-fps");

    let handle = null;
    let carry = null;      // {center, zoom} kept across a tier swap

    const fmt = n => n.toLocaleString("en-US");

    async function show(btn) {
        const slug = btn.dataset.tier;
        const points = Number(btn.dataset.points);
        tiers.forEach(b => { b.disabled = true; b.setAttribute("aria-pressed", String(b === btn)); });
        veil.hidden = false;
        veilBar.style.width = "0%";
        veilText.textContent = `fetching ${fmt(points)} points...`;

        try {
            const state = await loadState(slug, (seen, total) => {
                veilBar.style.width = `${total ? (seen / total) * 100 : 0}%`;
                veilText.textContent =
                    `fetching ${fmt(points)} points  ${(seen / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
            });

            // Keep the view. A tier swap is a new map, and without this every
            // click would throw you back to the fitted bounds.
            if (carry) {
                state.center = carry.center;
                state.zoom = carry.zoom;
                state.fit_bounds_request = null;
            }

            veilText.textContent = `uploading ${fmt(points)} points to the GPU...`;
            retire(handle);

            // Wait for the bundle BEFORE starting the clock. It loads once for
            // the whole page, and charging the first tier for it would report a
            // download as though it were rendering work.
            await bundle;

            // The number the page is actually claiming: mount to first paint,
            // measured here, in this browser, on this machine.
            const t0 = performance.now();
            handle = await mount(el, state);
            const ms = performance.now() - t0;

            outPts.textContent = fmt(points);
            outMs.textContent = `${ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(2) + " s"}`;
            outMs.className = ms < 1500 ? "hot" : ms < 4000 ? "" : "warn";
            veil.hidden = true;
        } catch (err) {
            console.error("[swiftmap demos] hero", err);
            veilText.textContent = `could not load this tier (${err.message})`;
            veilBar.style.width = "0%";
        } finally {
            tiers.forEach(b => { b.disabled = false; });
        }
    }

    // Carry the view only once the visitor has actually moved the map. The core
    // writes center/zoom back on moveend, but the moveend belonging to the
    // opening fit lands a beat AFTER render() resolves -- so carrying
    // unconditionally would hand the next tier the pre-fit fallback view of
    // anyone who clicks the ladder quickly. Untouched, each tier fits itself;
    // touched, we are looking at the visitor's own view and keep it.
    let touched = false;
    tiers.forEach(btn => btn.addEventListener("click", () => {
        const center = handle && handle.host.get("center");
        carry = (touched && Array.isArray(center))
            ? { center, zoom: handle.host.get("zoom") } : null;
        show(btn);
    }));

    // The frame counter. An idle map runs at the display's refresh rate no
    // matter what is on it, so a number shown all the time would be flattering
    // and meaningless -- this one only counts while the map is being moved, and
    // holds the last measurement afterwards.
    let moving = 0, frames = 0, since = performance.now();
    const nudge = () => { moving = performance.now(); touched = true; };
    ["pointerdown", "pointermove", "wheel", "touchmove"].forEach(ev =>
        el.addEventListener(ev, nudge, { passive: true }));

    (function tick(now) {
        requestAnimationFrame(tick);
        if (now - moving > 400) { frames = 0; since = now; return; }
        frames += 1;
        if (now - since >= 350) {
            const fps = Math.round((frames * 1000) / (now - since));
            outFps.textContent = String(fps);
            outFps.className = fps >= 50 ? "hot" : fps >= 28 ? "" : "warn";
            frames = 0; since = now;
        }
    })(performance.now());

    // Open on the middle rung: instant, and already an order of magnitude past
    // where an SVG/canvas map gives up.
    const initial = tiers.find(b => b.dataset.initial === "1") || tiers[0];
    show(initial);
}

// ------------------------------------------------------------- copy buttons

function setupCopy() {
    document.querySelectorAll(".copy").forEach(btn => {
        btn.addEventListener("click", async () => {
            const pre = btn.parentElement.querySelector("pre");
            try {
                await navigator.clipboard.writeText(pre.innerText);
                btn.textContent = "copied";
                btn.classList.add("done");
            } catch (_) {
                btn.textContent = "press ctrl+c";
                const r = document.createRange();
                r.selectNodeContents(pre);
                const s = getSelection();
                s.removeAllRanges();
                s.addRange(r);
            }
            setTimeout(() => { btn.textContent = "copy"; btn.classList.remove("done"); }, 1600);
        });
    });
}

setupCopy();
setupHero();
setupCards();
