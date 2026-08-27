import { L, provideLeaflet, requireLeaflet } from "./libs.js";
import { warnLayerProblems } from "./validate.js";
import { renderSidebarControls, normalizeRadioLayers, sidebarCollapseState } from "./sidebar.js";
import { deriveLegendSpec, renderLegend } from "./legend.js";
import { renderLabels } from "./labels.js";
import { renderLayer, renderMergedGlLayer, registerClickMatch, imageMetaKey,
         heatMetaKey, heatTimeKey, findLayerById } from "./layers.js";
import { clusterMetaKey } from "./cluster.js";
import { parsePeriod, generateTicks, collectTimeExtent, hasTimeLayers,
         layerInWindow, renderTimeControl, advance, periodToMs, gcdGridMs,
         collectDurationsMs, POSITIONS, timesFor, windowFor, featureInWindow,
         effectiveDuration, nearestTickIndex } from "./timecontrol.js";
import { gpuTimeAvailable, vectorGpuAvailable, LAYER_SLOTS } from "./gputime.js";
import { isLayerEffectiveVisible, collectWebglLayers, collectPointLayersAll,
         applySwiftmapPatch, bufferSerial } from "./patch.js";

// The sidebar's toggle write-back: targeted visibility flips through send(),
// never the layers trait. The full write scaled with the map instead of the
// click -- 36 MB at 25 tracks x 200k vertices, past uvicorn's 16 MB default
// websocket cap, which closes the connection and ends the Shiny session.
export function sendLayerWrite(host, changes) {
    if (!changes.length) return;
    try {
        host.send({
            kind: "swiftmap_write",
            ops: changes.map(c => ({ op: "set", id: c.id, fields: { visible: c.visible } })),
        });
    } catch (err) { /* no live backend; the rendered list already holds the change */ }
}

// Mounts one swiftmap map into `el`, driven by a host -- see src/host.js for the
// interface. The widget, a static export and a React component are all hosts over
// this one function; it never sees an anywidget model, only the five host methods.
//
// Returns a handle: the Leaflet map, the container element, a `sync` to force a
// re-render, and `destroy` to tear everything down.
export async function createSwiftMap({ host, el, leaflet = null }) {
    // Leaflet -- with glify and Geoman attached -- comes from the host, and it
    // must already be here: the map below is built from it, and Geoman's init
    // hook only reaches maps created after the plugin exists.
    if (leaflet) provideLeaflet(leaflet);
    requireLeaflet();

    // Every host subscription, so destroy() can unsubscribe from a host that
    // offers `off` (anywidget's model does; a minimal stub may not).
    const subscriptions = [];
    function listen(event, fn) {
        subscriptions.push([event, fn]);
        host.on(event, fn);
    }
    let destroyed = false;

    const originalError = console.error;
    const originalWarn = console.warn;

    // js_console_logs is a synced list, so each append resends the whole array. Keeping
    // only the most recent entries bounds both the payload and the memory a long-lived
    // session accumulates; the newest are the ones worth having anyway.
    const MAX_CONSOLE_LOGS = 200;
    const appendLog = entry => {
        const logs = host.get("js_console_logs") || [];
        const next = [...logs, entry];
        return next.length > MAX_CONSOLE_LOGS ? next.slice(-MAX_CONSOLE_LOGS) : next;
    };

    // Helper to safely write back to Python only if the widget view is active and attached
    function safeSetAndSave(key, value) {
        if (document.body.contains(el)) {
            try {
                host.set(key, value);
                host.save_changes();
            } catch (e) {
                originalWarn.call(console, "[SwiftMap] Suppressed sync write error:", e);
            }
        }
    }

    function safeSaveChanges() {
        if (document.body.contains(el)) {
            try {
                host.save_changes();
            } catch (e) {
                originalWarn.call(console, "[SwiftMap] Suppressed sync save error:", e);
            }
        }
    }

    console.error = function(...args) {
        originalError.apply(console, args);
        safeSetAndSave("js_console_logs",
            appendLog("CONSOLE.ERROR: " + args.map(a => String(a)).join(" ")));
    };
    
    let loggedReprojected = false;
    console.warn = function(...args) {
        const msg = args.map(a => String(a)).join(" ");
        if (msg.includes("layer designed for SphericalMercator") || msg.includes("alternate detected")) {
            if (!loggedReprojected) {
                loggedReprojected = true;
                const crs = host.get("crs") || "EPSG:3857";
                const cleanMsg = `[SwiftMap] Layer was reprojected to "${crs}"`;
                originalWarn.call(console, cleanMsg);
                
                safeSetAndSave("js_console_logs", appendLog(cleanMsg));
            }
            return; // suppress duplicate console warnings
        }
        originalWarn.apply(console, args);
    };

    const onWindowError = function(message, source, lineno, colno, error) {
        safeSetAndSave("js_console_logs",
            appendLog(`WINDOW.ONERROR: ${message} at ${source}:${lineno}:${colno}`));
    };
    window.onerror = onWindowError;

    const container = document.createElement("div");
    container.className = "swiftmap-container";
    container.style.width = "100%";
    container.style.position = "relative";
    el.appendChild(container);

    // Map(height=...) sizing. An explicit height also drops the stylesheet's
    // 400px floor -- an explicit 200px must not lose to a default minimum.
    // Height was accepted and documented long before it reached the DOM; this
    // is where it finally does.
    function applyHeight() {
        const h = host.get("height");
        container.style.height = h || "100%";
        container.style.minHeight = h ? "0" : "";
    }
    applyHeight();

    let labelsGroup = null;   // created after the map; filled by each sync

    const crsName = host.get("crs");
    let mapCrs = L.CRS.EPSG3857;
    if (crsName === "EPSG:4326") {
        mapCrs = L.CRS.EPSG4326;
    }

    const map = L.map(container, {
        crs: mapCrs,
        center: host.get("center"),
        zoom: host.get("zoom"),
        scrollWheelZoom: true,
        preferCanvas: true
    });

    // Create custom panes for strict Z-index ordering
    map.createPane("polygonsPane");
    map.getPane("polygonsPane").style.zIndex = "410";
    
    map.createPane("polylinesPane");
    map.getPane("polylinesPane").style.zIndex = "420";
    
    map.createPane("pointsPane");
    map.getPane("pointsPane").style.zIndex = "430";

    // Drawn vectors live ABOVE the GL panes. Geoman defaults them into Leaflet's
    // overlayPane (400), which sits under the GL canvases (410/420/430) whose
    // pointer-events are forced on -- so with any GL layer present, clicks meant
    // for a drawn shape never arrived: drawing worked (Geoman listens on the
    // container) while removal, edit and drag silently did nothing.
    map.createPane("swiftmapDrawPane");
    map.getPane("swiftmapDrawPane").style.zIndex = "440";

    labelsGroup = L.layerGroup().addTo(map);

    // Local mirrors of the layer list and coordinate buffers.
    //
    // Python updates these incrementally via "swiftmap_patch" messages instead of
    // reassigning the traits, because a trait reassignment re-serializes and re-sends
    // the entire map on every mutation. The traits still carry the initial snapshot
    // when a view attaches, and the sidebar still writes `layers` back on toggle, so
    // both are seeded here and kept in step by the change handlers further down.
    let layerState = host.get("layers") || [];
    let bufferState = { ...(host.get("coordinate_buffers") || {}) };

    function applyPatchOps(ops, buffers) {
        const next = applySwiftmapPatch({ layers: layerState, buffers: bufferState }, ops, buffers);
        layerState = next.layers;
        bufferState = next.buffers;
    }

    // Live feature visibility, for hit-testing. GPU-path buckets keep EVERY
    // layer -- hidden ones are masked by a shader uniform -- and glify's
    // hit-tests run against the bucket's data, which cannot see uniforms: a
    // radio-hidden layer's features still won clicks and answered with popups.
    // Looked up fresh per event, because the config captured at build time goes
    // stale the moment a patch op replaces it; the time check reads the live
    // tick the same way, since ticks change without rebuilding the bucket.
    function findLayerNow(list, id) {
        for (const l of list) {
            if (l.id === id) return l;
            if (l.type === "group") {
                const sub = findLayerNow(l.layers || [], id);
                if (sub) return sub;
            }
        }
        return null;
    }
    function featureVisibleNow(layer, index) {
        const current = findLayerNow(layerState, layer.id) || layer;
        if (!isLayerEffectiveVisible(current, host.get("group_configs") || {})) {
            return false;
        }
        if (!current.time || !timeState) return true;
        const times = timesFor(current, bufferState);
        if (!times) return true;
        const win = windowFor(timeState.tick,
            effectiveDuration(current, timeState), timeState.period);
        if (index != null && times.length > 2) {
            const start = times[index * 2];
            return Number.isNaN(start)
                || featureInWindow(start, times[index * 2 + 1], win);
        }
        for (let i = 0; i < times.length; i += 2) {
            if (Number.isNaN(times[i])
                    || featureInWindow(times[i], times[i + 1], win)) return true;
        }
        return false;
    }

    // Feature clicks, written to the host BARE -- no gating on a comm property:
    // shinywidgets' model has none, and gating on it silently killed every
    // writeback under Shiny. One key always answers "where" (clicked_latlng),
    // clicked_layer_id answers "on what" ("" for open map), and click_seq bumps
    // on EVERY click so a repeat click on the same feature still fires.
    const layerEvents = {
        onFeatureClick: ({ layer, index, latlng }) => {
            try {
                host.set("clicked_layer_id", layer.id);
                host.set("selected_index", index);
                host.set("clicked_latlng", latlng);
                host.set("click_seq", (host.get("click_seq") || 0) + 1);
                host.save_changes();
            } catch (err) { /* no live backend */ }
        },
    };

    const activeTileLayers = {};
    const activeOverlayLayers = {};
    const glStates = {
        circle_markers: { layer: null, ids: "", meta: "" },
        markers: { layer: null, ids: "", meta: "" },
        polyline: { layer: null, ids: "", meta: "" },
        polygon: { layer: null, ids: "", meta: "" }
    };

    // The shared time slider. `timeState` is what rendering reads -- the current tick
    // and the period, or null when nothing is animated -- and `timeUI` is the slider's
    // own bookkeeping. Playback never round-trips through Python: ticks re-render
    // locally, and time_current is written back at most once a second while playing.
    let timeState = null;
    const timeUI = { ticks: [], key: "", index: 0, playing: false, loop: false,
                     speed: 1, timer: null, lastWrite: 0, started: false,
                     window: null, periodMs: null, gridMs: null };

    function stopPlayback() {
        if (timeUI.timer) clearInterval(timeUI.timer);
        timeUI.timer = null;
        timeUI.playing = false;
    }

    function writeTimeCurrent(force) {
        const now = Date.now();
        if (!force && now - timeUI.lastWrite < 1000) return;
        timeUI.lastWrite = now;
        try {
            host.set("time_current", timeUI.ticks[timeUI.index]);
            host.save_changes();
        } catch (err) { /* no live backend */ }
    }

    function seekTo(index, { write = true } = {}) {
        timeUI.index = Math.max(0, Math.min(index, timeUI.ticks.length - 1));
        timeState = { tick: timeUI.ticks[timeUI.index], period: timeState.period,
                      window: timeUI.window };
        if (write) writeTimeCurrent(!timeUI.playing);
        renderTimeControl(el, timeUI, timeHandlers);
        queueSync();
    }

    function startPlayback() {
        stopPlayback();
        timeUI.playing = true;
        timeUI.timer = setInterval(() => {
            const next = advance(timeUI.index, timeUI.ticks.length, timeUI.loop);
            if (!next.playing) {
                stopPlayback();
                renderTimeControl(el, timeUI, timeHandlers);
                writeTimeCurrent(true);
                return;
            }
            seekTo(next.index);
        }, 1000 / timeUI.speed);
    }

    const timeHandlers = {
        onSeek: (index) => seekTo(index),
        onStepBack: () => seekTo(timeUI.index - 1),
        onStepForward: () => seekTo(timeUI.index + 1),
        onPlayToggle: () => {
            if (timeUI.playing) {
                stopPlayback();
                writeTimeCurrent(true);
            } else {
                // startOver, as the folium player was configured: pressing play at
                // the end restarts from the beginning immediately, rather than one
                // silent interval later deciding there is nowhere to go and stopping.
                if (timeUI.index >= timeUI.ticks.length - 1) seekTo(0);
                startPlayback();
            }
            renderTimeControl(el, timeUI, timeHandlers);
        },
        onLoopToggle: () => {
            timeUI.loop = !timeUI.loop;
            renderTimeControl(el, timeUI, timeHandlers);
        },
        onSpeed: (speed) => {
            timeUI.speed = speed;
            if (timeUI.playing) startPlayback();
        },
        // Live during the drag: local state and a re-render of the control on every
        // move, but map rebuilds at most every 300ms. At 5M points a rebuild costs
        // seconds, and a drag fires dozens of moves -- unthrottled, the rebuilds
        // stack faster than they finish and the allocation churn crashes the tab.
        onWindowDrag: (iso) => {
            timeUI.dragActive = true;
            timeUI.window = iso;
            if (timeState) timeState = { ...timeState, window: iso };
            renderTimeControl(el, timeUI, timeHandlers);
            const now = Date.now();
            if (now - (timeUI.lastDragSync || 0) >= 300) {
                timeUI.lastDragSync = now;
                queueSync();
            }
        },
        // On release (or a keyboard step): the override lands in time_config so
        // Python and Shiny see the same window the bar shows. null clears the key,
        // handing control back to per-layer durations.
        onWindowCommit: (iso) => {
            timeHandlers.onWindowDrag(iso);
            timeUI.dragActive = false;
            queueSync();       // the release always lands, throttle or not
            const cfg = { ...(host.get("time_config") || {}) };
            if (iso) cfg.window = iso;
            else delete cfg.window;
            try {
                host.set("time_config", cfg);
                host.save_changes();
            } catch (err) { /* no live backend; the local host still holds it */ }
        },
    };

    // Creates, retunes or removes the slider to match the layers present. Ticks are
    // regenerated only when the data's time extent or the period changes, so a
    // playback tick -- which re-enters here via queueSync -- does not rebuild them.
    function updateTimeDimension() {
        if (!hasTimeLayers(layerState)) {
            if (timeState) {
                stopPlayback();
                renderTimeControl(el, { ticks: [] }, timeHandlers);
                timeState = null;
                timeUI.key = "";
                timeUI.started = false;
            }
            return;
        }
        const cfg = host.get("time_config") || {};
        const period = parsePeriod(cfg.period || "P1D") || parsePeriod("P1D");
        const extent = collectTimeExtent(layerState, bufferState);
        if (!extent) return;

        const key = `${extent.min}|${extent.max}|${cfg.period || "P1D"}`;
        if (key !== timeUI.key) {
            // The playhead is a MOMENT, not an index. Late data prepends ticks
            // and a grown extent appends them; the user's position in time is a
            // chosen view -- the same rule that keeps a data update from moving
            // a chosen viewport -- so it snaps to the nearest tick of the new
            // series and never resets to the start, paused or playing (playback
            // simply continues from the snapped index).
            let moment = timeUI.ticks.length ? timeUI.ticks[timeUI.index] : null;
            // On the FIRST build there is no previous playhead -- but the host
            // may have arrived carrying one. A `m.time_current = ...` set before
            // this view attached is already state by now, so `change:time_current`
            // will never fire for it, and the playhead used to silently open at
            // tick 0: a static export saved mid-playback lost its moment. Exactly
            // the gap fit_bounds_request had, and the same fix -- read it once,
            // here, and let the snap-to-nearest-tick below do the rest.
            if (moment === null) {
                const initial = host.get("time_current");
                if (typeof initial === "number" && isFinite(initial)) moment = initial;
            }
            timeUI.key = key;
            timeUI.ticks = generateTicks(extent.min, extent.max, period);
            timeUI.index = moment === null ? 0 : nearestTickIndex(timeUI.ticks, moment);
            if (moment !== null && timeUI.ticks[timeUI.index] !== moment) {
                writeTimeCurrent(true);   // the series realigned: tell Python where we landed
            }
        }

        // The shared window override, config-driven; a bad string clears rather than
        // guessing. The drag grid is the gcd of the interval and every attached
        // duration -- the largest step that lands on all of them -- so a 2.5h trail
        // is draggable on a 1h bar. Calendar periods have no fixed width; the ruler
        // then shows interval marks only and the trail handle hides.
        // Never while a drag is live: the dragged window exists only locally until
        // release commits it, and reading config here mid-drag reset the handle to
        // "no window" on every debounced sync -- the handle followed the mouse, then
        // snapped home, then followed again, once per sync.
        if (!timeUI.dragActive) {
            timeUI.window = cfg.window && parsePeriod(cfg.window) ? cfg.window : null;
        }
        timeUI.periodMs = periodToMs(period);
        timeUI.gridMs = timeUI.periodMs
            ? gcdGridMs(timeUI.periodMs, collectDurationsMs(layerState, timeUI.window))
            : null;

        timeState = { tick: timeUI.ticks[timeUI.index], period, window: timeUI.window };
        timeUI.position = cfg.position || "top-center";

        if (!timeUI.started) {
            timeUI.started = true;
            timeUI.speed = cfg.speed || 1;
            timeUI.loop = Boolean(cfg.loop);
            // Only the first configuration may auto-start. Every config change resets
            // `started` to re-read speed and loop -- including the change a window
            // drag commits -- and re-running auto_play there would start playback as
            // a side effect of releasing the handle.
            if (cfg.auto_play && !timeUI.everStarted) startPlayback();
            timeUI.everStarted = true;
        }
        renderTimeControl(el, timeUI, timeHandlers);
    }

    // Sidebar Layers Control UI
    const sidebar = document.createElement("div");
    sidebar.className = "swiftmap-sidebar";
    sidebar.style.position = "absolute";
    sidebar.style.top = "10px";
    sidebar.style.right = "10px";
    sidebar.style.zIndex = "1000";
    sidebar.style.background = "white";
    sidebar.style.padding = "10px";
    sidebar.style.borderRadius = "5px";
    sidebar.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
    sidebar.style.maxHeight = "80%";
    sidebar.style.overflowY = "auto";
    sidebar.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    sidebar.style.fontSize = "12px";
    sidebar.style.color = "#333";
    container.appendChild(sidebar);

    // Legend: derived fresh on every sync from the same layer state the sidebar
    // renders from, so toggles dim or drop rows with no extra wiring. Hidden
    // until show_legend asks for it.
    const legendDiv = document.createElement("div");
    legendDiv.className = "swiftmap-legend";
    legendDiv.style.position = "absolute";
    legendDiv.style.zIndex = "1000";
    legendDiv.style.background = "white";
    legendDiv.style.padding = "10px";
    legendDiv.style.borderRadius = "5px";
    legendDiv.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
    legendDiv.style.maxWidth = "260px";
    legendDiv.style.maxHeight = "45%";
    legendDiv.style.overflowY = "auto";
    legendDiv.style.fontFamily = sidebar.style.fontFamily;
    legendDiv.style.fontSize = "12px";
    legendDiv.style.color = "#333";
    legendDiv.style.display = "none";
    container.appendChild(legendDiv);

    // Logo
    // The logo card: two app-supplied slots from logo_config, no branding of
    // its own. With the card on and neither slot set, swiftmap's own mark stands in
    // -- inline SVG, so it needs no network and survives a static export.
    // Built with elements, not innerHTML, so an alt text cannot inject markup.
    const LOGO_POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
    // The swiftmap mark: an S sampled from map points on a graticule. Inline,
    // so it needs no network and rides into a static export like everything else.
    const DEFAULT_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#2b7a9e" stroke-width=".7" opacity=".26"><line x1="6" y1="21" x2="58" y2="21"/><line x1="6" y1="43" x2="58" y2="43"/></g><g fill="#2b7a9e"><circle cx="39.78" cy="13.22" r="1.6"/><circle cx="36.21" cy="10.84" r="2.2"/><circle cx="32" cy="10" r="2.7"/><circle cx="27.79" cy="10.84" r="2.9"/><circle cx="24.22" cy="13.22" r="3"/><circle cx="21.84" cy="16.79" r="3"/><circle cx="21" cy="21" r="3"/><circle cx="21.84" cy="25.21" r="3"/><circle cx="24.22" cy="28.78" r="3"/><circle cx="27.79" cy="31.16" r="3"/><circle cx="32" cy="32" r="3"/><circle cx="36.21" cy="32.84" r="3"/><circle cx="39.78" cy="35.22" r="3"/><circle cx="42.16" cy="38.79" r="3"/><circle cx="43" cy="43" r="3"/><circle cx="42.16" cy="47.21" r="3"/><circle cx="39.78" cy="50.78" r="2.9"/><circle cx="36.21" cy="53.16" r="2.7"/><circle cx="32" cy="54" r="2.2"/><circle cx="27.79" cy="53.16" r="1.9"/><circle cx="24.22" cy="50.78" r="1.6"/></g></svg>');
    const logoDiv = document.createElement("div");
    logoDiv.className = "swiftmap-logo";
    logoDiv.style.position = "absolute";
    logoDiv.style.zIndex = "1000";
    logoDiv.style.background = "white";
    logoDiv.style.padding = "5px";
    logoDiv.style.borderRadius = "4px";
    logoDiv.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
    logoDiv.style.display = "none";
    container.appendChild(logoDiv);

    function syncLogo() {
        const show = Boolean(host.get("show_logo"));
        logoDiv.style.display = show ? "block" : "none";
        logoDiv.replaceChildren();
        if (!show) return;
        const cfg = host.get("logo_config") || {};
        const height = Number(cfg.height) > 0 ? Number(cfg.height) : 35;
        const position = LOGO_POSITIONS.has(cfg.position) ? cfg.position : "bottom-right";
        for (const side of ["top", "bottom", "left", "right"]) logoDiv.style[side] = "";
        logoDiv.style[position.startsWith("top") ? "top" : "bottom"] = "10px";
        logoDiv.style[position.endsWith("left") ? "left" : "right"] = "10px";
        const slots = [cfg.company, cfg.parent_company].filter(s => s && s.url);
        const images = slots.length ? slots : [{ url: DEFAULT_LOGO, alt: "swiftmap" }];
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "5px";
        for (const image of images) {
            const img = document.createElement("img");
            img.src = image.url;
            img.alt = image.alt || "";
            img.style.height = `${height}px`;
            row.appendChild(img);
        }
        logoDiv.appendChild(row);
    }
    syncLogo();
    listen("change:logo_config", syncLogo);



    function getTileLayer(layer) {
        const options = {
            attribution: layer.attribution || '',
            maxZoom: layer.max_zoom || 22,
            maxNativeZoom: layer.max_native_zoom || 19
        };
        // xyzservices providers declare their own {s} hosts; Leaflet's
        // default "abc" is wrong for anything else.
        if (layer.subdomains) options.subdomains = layer.subdomains;
        if (layer.wms) {
            // WMS request CRS follows the map's, so 4326 maps ask in 4326.
            return L.tileLayer.wms(layer.url, {
                ...options,
                layers: layer.wms.layers,
                format: layer.wms.format || 'image/png',
                version: layer.wms.version || '1.1.1',
                transparent: !!layer.wms.transparent,
                ...(layer.wms.styles ? { styles: layer.wms.styles } : {})
            });
        }
        return L.tileLayer(layer.url, options);
    }

    // Retire a glify instance the safe way: its canvas overlay never cancels the
    // redraw frame it schedules, and that frame dereferences the map unguarded --
    // removing a layer within a frame of its creation would throw from inside
    // requestAnimationFrame, where no caller can catch it.
    // Takes either a merged wrapper layer (which keeps its glify instance as
    // glPoints / glLines / glShapes) or a bare glify instance.
    function cancelGlFrame(glInstance) {
        const overlay = glInstance && glInstance.layer;
        if (overlay && overlay._frame != null) {
            L.Util.cancelAnimFrame(overlay._frame);
            overlay._frame = null;
        }
    }
    function retireGl(instance) {
        if (!instance) return;
        for (const gl of [instance.glPoints, instance.glLines, instance.glShapes,
                          instance.glArrows, instance]) {
            cancelGlFrame(gl);
        }
        try { instance.remove(); } catch (err) { /* already gone */ }
    }

    // A lost WebGL context leaves a bucket's canvas permanently blank, and
    // browsers lose contexts for real reasons: GPU pressure evicts them, GPU
    // process restarts take every context at once (headless SwiftShader bounces
    // its GPU process moments after startup, which is how the test tiers found
    // this the day the libraries were bundled and rendering stopped waiting on
    // the network). Recovery is a rebuild: retire the dead instance, clear the
    // bucket's caches, and let the next sync build fresh canvases on a live
    // context.
    // Recovery is not an auto-sync concern: the context died regardless of who
    // drives repaints, so the rebuild goes through performSync directly rather
    // than queueSync's auto_sync gate (a map built with auto_sync=False went
    // permanently blank -- the React round-4 review, gap K). Repeated losses
    // back off exponentially instead of looping at the debounce rate under
    // sustained GPU pressure; ten quiet seconds reset the ladder.
    let contextLossCount = 0;
    let contextLossAt = 0;
    let contextLossTimer = null;
    function scheduleContextLossRebuild() {
        const now = Date.now();
        // One GPU bounce loses EVERY canvas in the same tick, and each canvas
        // lands here -- the ladder advances per loss EVENT, not per canvas, with
        // the pending timer as the coalescing signal, exactly as it already
        // coalesces the rebuild itself. Counting canvases walked a four-canvas
        // map to a 2 s delay on its very first loss and to the 30 s cap on the
        // second (React round-5 report, gap N, measured to the rung).
        if (contextLossTimer == null) {
            contextLossCount = now - contextLossAt > 10000 ? 0 : contextLossCount + 1;
        }
        contextLossAt = now;
        const delay = contextLossCount === 0 ? 50
            : Math.min(30000, 250 * 2 ** contextLossCount);
        if (contextLossTimer) clearTimeout(contextLossTimer);
        contextLossTimer = setTimeout(() => {
            contextLossTimer = null;
            if (!destroyed) performSync();
        }, delay);
    }

    function armContextLossRecovery(type, wrapper) {
        for (const gl of [wrapper.glPoints, wrapper.glLines, wrapper.glShapes,
                          wrapper.glArrows]) {
            const canvas = gl && gl.layer && gl.layer.canvas;
            if (!canvas || canvas._swiftmapLossArmed) continue;
            canvas._swiftmapLossArmed = true;
            canvas.addEventListener("webglcontextlost", (event) => {
                event.preventDefault();
                if (destroyed) return;
                const state = glStates[type];
                if (state.layer === wrapper) {
                    retireGl(state.layer);
                    state.layer = null;
                    state.ids = "";
                    state.meta = "";
                    state.visKey = null;
                    scheduleContextLossRebuild();
                }
            });
        }
    }

    async function syncMapState() {
        console.time("[Performance] syncMapState Total");
        updateTimeDimension();
        const layers = layerState;
        const groupConfigs = host.get("group_configs") || {};
        const coordinateBuffers = bufferState;

        // Authoring guardrails, once per config object: where Python warns at add
        // time, a hand-built JS config used to fail silently -- a blank or subtly
        // wrong map with nothing in the console (src/validate.js).
        for (const layer of layers) warnLayerProblems(layer, coordinateBuffers);

        // Enforce mutually exclusive radio group visibility before collecting or rendering WebGL layers.
        // Written back as targeted flips, never the layers trait -- the full write was
        // the frame that killed large sessions (see the sidebar's change handler).
        const radio = normalizeRadioLayers(layers, groupConfigs, sidebarCollapseState(sidebar));
        if ((radio.changes.length > 0 || radio.groupsChanged) && document.body.contains(el)) {
            sendLayerWrite(host, radio.changes);
            host.set("group_configs", { ...groupConfigs });
            host.save_changes();
        }

        syncLogo();

        // Group visible layers (including sub-layers inside groups) to always use WebGL
        const {
            circle_markers: webglCircleMarkerLayers,
            markers: webglMarkerLayers,
            polyline: webglPolylineLayers,
            polygon: webglPolygonLayers,
        } = collectWebglLayers(layers, groupConfigs);

        // Set of layer IDs processed via merged WebGL layers
        const webglLayerIds = new Set([
            ...webglCircleMarkerLayers.map(l => l.id),
            ...webglMarkerLayers.map(l => l.id),
            ...webglPolylineLayers.map(l => l.id),
            ...webglPolygonLayers.map(l => l.id)
        ]);

        // Remove retired overlay layers, including those that transitioned to WebGL
        Object.keys(activeOverlayLayers).forEach(id => {
            if (!layers.find(l => l.id === id) || webglLayerIds.has(id)) {
                activeOverlayLayers[id].remove();
                delete activeOverlayLayers[id];
            }
        });

        // Process non-WebGL layers
        for (const layer of layers) {
            const effectiveVisible = isLayerEffectiveVisible(layer, groupConfigs);
            if (layer.type === "basemap") {
                if (effectiveVisible) {
                    if (!activeTileLayers[layer.name]) {
                        const tile = getTileLayer(layer);
                        tile.addTo(map);
                        activeTileLayers[layer.name] = tile;
                    }
                } else {
                    if (activeTileLayers[layer.name]) {
                        activeTileLayers[layer.name].remove();
                        delete activeTileLayers[layer.name];
                    }
                }
                continue;
            }

            // Skip layers managed by the merged WebGL layers
            if (webglLayerIds.has(layer.id)) {
                continue;
            }

            if (!effectiveVisible || !layerInWindow(layer, bufferState, timeState)) {
                if (activeOverlayLayers[layer.id]) {
                    activeOverlayLayers[layer.id].remove();
                    delete activeOverlayLayers[layer.id];
                }
                continue;
            }

            if (activeOverlayLayers[layer.id]) {
                const existing = activeOverlayLayers[layer.id];
                // Image overlays recreate when their config or their buffer
                // changes -- a replace op swaps the config object and a
                // buffer op swaps the DataView, and a stale image would
                // otherwise sit until a visibility bounce.
                const staleImage = layer.type === "image"
                    && (existing.imageMeta !== imageMetaKey(layer)
                        || existing.imageSource !== (coordinateBuffers[layer.id] || null));
                // Heat reads its own buffers -- or a SOURCE layer's -- so a swap
                // of either view (a live feed's update_layer) recreates the
                // instance the same way a stale image does. The time inputs
                // (own or source time config, the ::times view, the period)
                // are baked at build, so they recreate too.
                const staleHeat = layer.type === "heatmap"
                    && (existing.heatMeta !== heatMetaKey(layer)
                        || existing.heatCoordSource
                            !== (coordinateBuffers[layer.source || layer.id] || null)
                        || existing.heatWeightSource
                            !== (coordinateBuffers[`${layer.id}::weights`] || null)
                        || existing.heatValuesSource
                            !== (coordinateBuffers[`${layer.id}::values`] || null)
                        || existing.heatTimesSource
                            !== (coordinateBuffers[`${layer.source || layer.id}::times`] || null)
                        || existing.heatTimeKey !== heatTimeKey(layer,
                            layer.source ? findLayerById(layers, layer.source) : null,
                            timeState));
                const staleCluster = layer.cluster
                    && (existing.clusterMeta !== clusterMetaKey(layer)
                        || existing.clusterCoordSource
                            !== (coordinateBuffers[layer.id] || null)
                        || existing.clusterColorsSource
                            !== (coordinateBuffers[`${layer.id}::colors`] || null));
                // A layer that stops (or starts) clustering swaps rendering
                // paths entirely; layerType alone cannot see that.
                const clusterFlip = Boolean(layer.cluster) !== Boolean(existing.clusterMeta);
                if (existing.layerType !== layer.type || staleImage || staleHeat
                        || staleCluster || clusterFlip) {
                    existing.remove();
                    delete activeOverlayLayers[layer.id];
                } else {
                    continue;
                }
            }

            const instance = await renderLayer(map, layer, coordinateBuffers[layer.id],
                coordinateBuffers, layers, timeState, layerEvents);
            // A host may destroy the map while a sync is in flight (an unmount, or
            // React strict mode's throwaway mount): nothing past this point may
            // touch a map that no longer has panes.
            if (destroyed) return;
            if (instance) {
                activeOverlayLayers[layer.id] = instance;
            }
        }

        // Helper to sync WebGL layer states and rebuild only if changed
        async function syncGlLayer(type, visibleLayers, vectorGpu = false) {
            const idsString = visibleLayers.map(l => l.id).sort().join(",");
            // Everything the built buffers depend on belongs in this key: a change that
            // is not in it renders stale. highlight_style and style_overrides were
            // missing at first, so a highlight landed in state and never repainted.
            // Point buckets on the GPU path exclude the tick and window from the key:
            // those change per tick and are applied as uniforms, not by rebuilding.
            // The period stays in, since it is baked into the duration attributes.
            // Everything else -- and every non-point bucket -- rebuilds as before.
            const gpuPoints = ((type === "circle_markers" || type === "markers")
                && gpuTimeAvailable()) || vectorGpu;
            const metaString = JSON.stringify(visibleLayers.map(l => ({
                id: l.id,
                color: l.color,
                radius: l.radius,
                weight: l.weight,
                opacity: l.opacity,
                fillOpacity: l.fillOpacity,
                arrows: l.arrows,
                arrowSpacingPx: l.arrow_spacing_px,
                arrowSpacingM: l.arrow_spacing_m,
                dash: l.dash,
                highlight: l.highlight_style,
                overrides: l.style_overrides,
                featureStyles: l.feature_styles,
                time: l.time,
                gpu: gpuPoints,
                tick: l.time && timeState && !gpuPoints ? timeState.tick : 0,
                win: l.time && timeState && !gpuPoints ? timeState.window : null,
                per: l.time && gpuPoints && timeState
                    ? JSON.stringify(timeState.period) : null,
                bufLen: coordinateBuffers[l.id]?.byteLength || 0,
                // Identity of every buffer the bucket reads for this layer:
                // same-length replacements must rebuild too.
                bufSerial: [l.id, `${l.id}::colors`, `${l.id}::radii`, `${l.id}::times`]
                    .map(k => bufferSerial(coordinateBuffers[k])),
                locLen: l.locations?.length || 0
            })));

            const state = glStates[type];
            const stateChanged = state.ids !== idsString || state.meta !== metaString;

            if (stateChanged) {
                if (state.layer) {
                    retireGl(state.layer);
                }
                if (visibleLayers.length > 0) {
                    const built = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, layerEvents, timeState, vectorGpu, featureVisibleNow);
                    if (destroyed) {
                        // Destroyed mid-build: retire the instance glify registered
                        // (its GL context goes with it) instead of adding it to a
                        // removed map.
                        retireGl(built);
                        return;
                    }
                    state.layer = built;
                    if (state.layer) {
                        state.layer.addTo(map);
                        armContextLossRecovery(type, state.layer);
                    }
                } else {
                    state.layer = null;
                }
                state.ids = idsString;
                state.meta = metaString;
                // The visibility cache described the handle just retired. A rebuilt
                // bucket is born all-visible, so the next pass must upload the
                // vector even when it did not change -- otherwise every rebuild
                // (an append moves bufLen, a highlight moves the style key) drew
                // hidden layers again until the user re-toggled them.
                state.visKey = null;
                // And push it NOW, in the same synchronous block as the rebuild:
                // waiting for the window-push loop below left a gap in which
                // glify could composite one all-visible frame -- a flash of the
                // hidden layers on every highlight or append.
                const handle = state.layer && state.layer._swiftmapTime;
                if (handle && state.visVector) {
                    state.visKey = state.visVector.join("");
                    handle.setLayerVisibility(state.visVector);
                }
            }
        }

        // Point buckets holding time layers keep EVERY point layer -- hidden ones
        // included -- so a sidebar toggle changes a visibility uniform instead of
        // the bucket's ids. Unchecking one of 25 tracks used to rebuild all 5M
        // points; clicking down the sidebar stacked those rebuilds into a crash.
        const allByType = collectPointLayersAll(layers, groupConfigs);
        // Area outlines ride the lines bucket: every polygon and circle joins it as
        // an extra entry whose rings render as weighted LineStrings (the polygon
        // bucket draws only the fill). Joining unconditionally -- strokeless areas
        // contribute an empty slot -- keeps the bucket's membership independent of
        // style changes, so restyling a border stays a rebuild, never a re-bucket.
        allByType.polyline = [...allByType.polyline, ...allByType.polygon];
        const bucket = { circle_markers: webglCircleMarkerLayers,
                         markers: webglMarkerLayers,
                         polyline: [...webglPolylineLayers, ...webglPolygonLayers],
                         polygon: webglPolygonLayers };
        const vectorGpuBucket = { polyline: false, polygon: false };
        for (const type of ["circle_markers", "markers", "polyline", "polygon"]) {
            const entries = allByType[type];
            const isPoints = type === "circle_markers" || type === "markers";
            const available = isPoints ? gpuTimeAvailable() : vectorGpuAvailable();
            const gpuVis = available && entries.length > 0
                && entries.length <= LAYER_SLOTS
                && entries.some(e => e.layer.time);
            glStates[type].visVector = gpuVis ? entries.map(e => (e.vis ? 1 : 0)) : null;
            if (gpuVis) bucket[type] = entries.map(e => e.layer);
            if (!isPoints) vectorGpuBucket[type] = gpuVis;
        }

        await syncGlLayer("circle_markers", bucket.circle_markers);
        if (destroyed) return;
        await syncGlLayer("markers", bucket.markers);
        if (destroyed) return;
        await syncGlLayer("polyline", bucket.polyline, vectorGpuBucket.polyline);
        if (destroyed) return;
        await syncGlLayer("polygon", bucket.polygon, vectorGpuBucket.polygon);
        if (destroyed) return;

        // Push the current window into the GPU-filtered point buckets: two uniforms
        // and a redraw, which is the entire per-tick cost of the time slider there.
        for (const type of ["circle_markers", "markers", "polyline", "polygon"]) {
            const state = glStates[type];
            const handle = state.layer && state.layer._swiftmapTime;
            if (!handle) continue;
            // Layer visibility first, and only when it changed: a toggle costs one
            // uniform array write and a redraw, never a rebuild.
            const vis = state.visVector;
            if (vis) {
                const key = vis.join("");
                if (state.visKey !== key) {
                    state.visKey = key;
                    handle.setLayerVisibility(vis);
                }
            }
            if (timeState) {
                const overrideMs = timeState.window
                    ? periodToMs(parsePeriod(timeState.window)) : null;
                handle.setWindow(timeState.tick, overrideMs);
            } else {
                handle.setWindow(null, null);
            }
        }

        // Heat instances take the same window: three uniforms and a redraw per
        // tick, exactly like the GL point buckets above.
        for (const instance of Object.values(activeOverlayLayers)) {
            const handle = instance._swiftmapHeatTime;
            if (!handle) continue;
            if (timeState) {
                const overrideMs = timeState.window
                    ? periodToMs(parsePeriod(timeState.window)) : null;
                handle.setWindow(timeState.tick, overrideMs);
            } else {
                handle.setWindow(null, null);
            }
        }

        renderSidebarControls(sidebar, layers, {
            groupConfigs,
            coordinateBuffers,
            onLayerWrite: (changes) => sendLayerWrite(host, changes),
            // group_configs stays on the host: a handful of folder flags, and the
            // spread gives Backbone a fresh reference so in-place edits register.
            onGroupConfigsChange: (cfg) => {
                host.set("group_configs", { ...cfg });
                host.save_changes();
            },
        }, map, () => {
            performSync();
        });

        // Permanent labels follow the same derive-per-sync pattern as the legend,
        // so they track visibility with no bucket or meta-key involvement -- and
        // since every playback tick re-enters this sync, passing timeState makes
        // them follow the window too: chips appear and vanish with their features.
        if (labelsGroup) {
            renderLabels(L, labelsGroup, layers, coordinateBuffers, groupConfigs,
                         timeState);
        }

        const legendCfg = host.get("legend_config") || {};
        if (host.get("show_legend")) {
            const spec = deriveLegendSpec(layers, groupConfigs, legendCfg);
            renderLegend(legendDiv, spec,
                { dimHidden: legendCfg.dim_hidden !== false });
            const pos = POSITIONS[legendCfg.position] || POSITIONS["bottom-left"];
            for (const [prop, value] of Object.entries(pos)) {
                legendDiv.style[prop] = value;
            }
            legendDiv.style.display = spec.groups.length > 0 ? "block" : "none";
        } else {
            legendDiv.style.display = "none";
        }
        console.timeEnd("[Performance] syncMapState Total");
    }

    let isUpdatingCenterFromMap = false;
    let isUpdatingZoomFromMap = false;

    // Draw / AOI tools: Leaflet-Geoman (the maintained successor to Leaflet.draw,
    // which breaks on Leaflet 1.9), loaded from unpkg like Leaflet and glify --
    // lazily, only when a map turns drawing on, so every other map pays nothing.
    // Drawn shapes live in their own feature group and sync to Python as GeoJSON
    // features under the `drawings` trait, with `draw_seq` bumping per change so
    // one observer catches create, edit and delete alike. The trait syncs both
    // ways: Python can seed AOIs or clear them, and exports carry the drawings.
    let drawReady = false;
    let drawingsGroup = null;
    let drawIdCounter = 0;
    let suppressDrawingsEcho = false;

    function drawingToFeature(l) {
        const gj = l.toGeoJSON();
        gj.properties = { ...(gj.properties || {}), draw_id: l._swiftmapDrawId };
        if (typeof l.getRadius === "function" && l instanceof L.Circle) {
            gj.properties.kind = "circle";
            gj.properties.radius = l.getRadius();
        }
        return gj;
    }

    function writeDrawings() {
        const features = [];
        drawingsGroup.eachLayer(l => features.push(drawingToFeature(l)));
        suppressDrawingsEcho = true;
        try {
            host.set("drawings", features);
            host.set("draw_seq", (host.get("draw_seq") || 0) + 1);
            host.save_changes();
        } catch (err) { /* no live backend; the drawings still live on the map */ }
        suppressDrawingsEcho = false;
    }

    function adoptDrawing(layer) {
        if (!layer._swiftmapDrawId) {
            layer._swiftmapDrawId = `draw_${++drawIdCounter}`;
        }
        drawingsGroup.addLayer(layer);
        layer.on("pm:update pm:dragend pm:rotateend", writeDrawings);
    }

    function rehydrateDrawings() {
        drawingsGroup.clearLayers();
        for (const feature of host.get("drawings") || []) {
            const props = feature.properties || {};
            let layer;
            if (props.kind === "circle" && feature.geometry.type === "Point") {
                const [lng, lat] = feature.geometry.coordinates;
                layer = L.circle([lat, lng], { radius: props.radius || 100,
                                               pane: "swiftmapDrawPane" });
            } else {
                layer = L.geoJSON(feature, { pane: "swiftmapDrawPane" })
                    .getLayers()[0];
            }
            if (!layer) continue;
            layer._swiftmapDrawId = props.draw_id || `draw_${++drawIdCounter}`;
            adoptDrawing(layer);
        }
    }

    function syncDraw() {
        const show = host.get("show_draw");
        const cfg = host.get("draw_config") || {};
        if (show && !drawReady) {
            drawReady = true;
            // Everything Geoman creates goes to the pane above the GL stack.
            map.pm.setGlobalOptions({
                panes: { layerPane: "swiftmapDrawPane",
                         vertexPane: "markerPane", markerPane: "markerPane" },
            });
            drawingsGroup = L.featureGroup().addTo(map);
            rehydrateDrawings();
            map.on("pm:create", (e) => {
                adoptDrawing(e.layer);
                writeDrawings();
            });
            map.on("pm:remove", (e) => {
                // Geoman removes the layer from the MAP; the feature group still
                // holds it, and writeDrawings reads the group -- evict it first
                // or the deletion never reaches the trait.
                drawingsGroup.removeLayer(e.layer);
                writeDrawings();
            });
            listen("change:drawings", () => {
                if (!suppressDrawingsEcho) rehydrateDrawings();
            });
        }
        if (!drawReady) return;
        if (show) {
            const tools = cfg.tools
                || ["marker", "polyline", "rectangle", "polygon", "circle"];
            map.pm.addControls({
                position: (cfg.position || "top-left").replace("-", ""),
                drawMarker: tools.includes("marker"),
                drawPolyline: tools.includes("polyline"),
                drawRectangle: tools.includes("rectangle"),
                drawPolygon: tools.includes("polygon"),
                drawCircle: tools.includes("circle"),
                drawCircleMarker: false,
                drawText: false,
                rotateMode: false,
                cutPolygon: false,
                editMode: true,
                dragMode: true,
                removalMode: true,
            });
        } else {
            map.pm.removeControls();
        }
    }
    syncDraw();
    listen("change:show_draw", syncDraw);
    listen("change:draw_config", syncDraw);

    // The scale bar: Leaflet's own control, which measures through the map's CRS
    // (haversine under 3857 and 4326 alike -- no pixel math of ours), extended
    // with the unit Leaflet lacks and this domain runs on: nautical miles.
    const NauticalScale = L.Control.Scale.extend({
        onAdd: function (m) {
            const container = L.Control.Scale.prototype.onAdd.call(this, m);
            this._nauticalScale = L.DomUtil.create(
                "div", "leaflet-control-scale-line", container);
            this._update();
            return container;
        },
        _updateScales: function (maxMeters) {
            L.Control.Scale.prototype._updateScales.call(this, maxMeters);
            if (this._nauticalScale && maxMeters) {
                const maxNm = maxMeters / 1852;
                const nm = this._getRoundNum(maxNm);
                this._updateScale(this._nauticalScale, `${nm} nm`, nm / maxNm);
            }
        },
    });

    let scaleControl = null;
    function syncScale() {
        if (scaleControl) {
            scaleControl.remove();
            scaleControl = null;
        }
        if (!host.get("show_scale")) return;
        const cfg = host.get("scale_config") || {};
        const units = cfg.units || "metric";
        const options = {
            position: (cfg.position || "bottom-left").replace("-", ""),
            maxWidth: cfg.max_width || 120,
            metric: units === "metric" || units === "both",
            imperial: units === "imperial" || units === "both",
        };
        scaleControl = units === "nautical"
            ? new NauticalScale(options)
            : L.control.scale(options);
        scaleControl.addTo(map);
    }
    syncScale();
    listen("change:show_scale", syncScale);
    listen("change:scale_config", syncScale);

    // Empty-map clicks: report where. Registered through the same arbitration the
    // feature handlers use, at the lowest priority, so a click that hit a feature
    // stays that feature's click -- this wins only when nothing claimed the event.
    // e.latlng is already unprojected through whichever CRS the map runs (3857 and
    // 4326 alike), so there is no pixel math to get wrong here; wrap() keeps a
    // world-panned map from reporting longitude -364.
    map.on("click", (e) => {
        // Stamped synchronously, before any glify handler registers its match
        // (this handler was bound first, so Leaflet runs it first): the whole
        // click pipeline -- feature popups and this fallback alike -- stands
        // down while a Geoman mode is armed. Deferred checks miss modes that
        // close themselves on their finishing click (a completed rectangle),
        // which is why the state is captured at click time.
        const pm = map.pm;
        map._pmModeActive = Boolean(pm
            && ((pm.globalRemovalModeEnabled && pm.globalRemovalModeEnabled())
                || (pm.globalEditModeEnabled && pm.globalEditModeEnabled())
                || (pm.globalDragModeEnabled && pm.globalDragModeEnabled())
                || (pm.globalDrawModeEnabled && pm.globalDrawModeEnabled())));
        registerClickMatch(map, 99, () => {
            const ll = e.latlng.wrap();
            const lat = Math.round(ll.lat * 1e5) / 1e5;
            const lng = Math.round(ll.lng * 1e5) / 1e5;
            try {
                host.set("clicked_layer_id", "");
                host.set("selected_index", -1);
                host.set("clicked_latlng", [lat, lng]);
                host.set("click_seq", (host.get("click_seq") || 0) + 1);
                host.save_changes();
            } catch (err) { /* no live backend */ }
            if (host.get("show_click_coordinates")) {
                // The close button is the only exit: every empty-map click
                // replaces the popup, so without it there is no popup-free
                // state to screenshot -- closing meant clicking a feature and
                // dismissing THAT popup instead.
                L.popup({ className: "swiftmap-coords-popup" })
                    .setLatLng(e.latlng)
                    .setContent(`${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`)
                    .openOn(map);
            }
        });
    });

    // Bind zoom and center changes back to Python safely
    map.on("moveend", () => {
        try {
            const center = map.getCenter();
            const currentZoom = map.getZoom();
            
            const modelCenter = host.get("center");
            const modelZoom = host.get("zoom");
            
            const zoomChanged = modelZoom !== currentZoom;
            const centerChanged = !modelCenter || 
                !Array.isArray(modelCenter) ||
                modelCenter.length < 2 ||
                Math.abs(modelCenter[0] - center.lat) > 0.0001 || 
                Math.abs(modelCenter[1] - center.lng) > 0.0001;
                
            if (centerChanged) {
                isUpdatingCenterFromMap = true;
                host.set("center", [center.lat, center.lng]);
            }
            if (zoomChanged) {
                isUpdatingZoomFromMap = true;
                host.set("zoom", currentZoom);
            }
            if (centerChanged || zoomChanged) {
                safeSaveChanges();
            }
        } catch (err) {
            console.error("Error in moveend handler:", err);
        }
    });

    function updateMapView() {
        const center = host.get("center");
        const zoom = host.get("zoom");
        if (center && Array.isArray(center) && center.length >= 2) {
            const mapCenter = map.getCenter();
            const mapZoom = map.getZoom();
            const centerChanged = Math.abs(mapCenter.lat - center[0]) > 0.0001 || 
                                  Math.abs(mapCenter.lng - center[1]) > 0.0001;
            const zoomChanged = mapZoom !== zoom;
            
            if (centerChanged || zoomChanged) {
                map.setView(center, typeof zoom === "number" ? zoom : mapZoom);
            }
        } else {
            const zoom = host.get("zoom");
            if (typeof zoom === "number" && map.getZoom() !== zoom) {
                map.setZoom(zoom);
            }
        }
    }

    // Watch for map view updates from Python
    listen("change:center", () => {
        if (isUpdatingCenterFromMap) {
            isUpdatingCenterFromMap = false;
            return;
        }
        updateMapView();
    });
    listen("change:zoom", () => {
        if (isUpdatingZoomFromMap) {
            isUpdatingZoomFromMap = false;
            return;
        }
        updateMapView();
    });
    // Fitting the view is a command, not state: asking to fit the same bounds twice
    // must move the map both times, since the user may have panned away in between.
    // The request carries a sequence number so an identical fit still fires a change.
    function applyFitRequest() {
        const req = host.get("fit_bounds_request") || {};
        const bounds = req.bounds;
        if (!bounds || bounds.length === 0) return;

        const options = {};
        if (req.padding != null) options.padding = [req.padding, req.padding];
        if (req.max_zoom != null) options.maxZoom = req.max_zoom;
        map.fitBounds(bounds, options);

        // Applied after the fit, since it is relative to whatever zoom the fit chose.
        if (req.zoom_offset) {
            map.setZoom(map.getZoom() + req.zoom_offset);
        }
    }
    listen("change:fit_bounds_request", applyFitRequest);
    // A request set before this view attached -- a pre-display fit_bounds() call,
    // or the union a fresh map maintains as auto-fit while layers are added -- is
    // already state by now, so the change event will never fire for it. It used
    // to be silently dropped; apply it once the map is ready instead.
    map.whenReady(() => applyFitRequest());
    // A map constructed inside a hidden container -- a Shiny nav_panel that is
    // not the selected tab -- initialises at 0x0, and Leaflet caches that size:
    // its own trackResize watches the WINDOW, not the container, so nothing ever
    // corrects it. The fit above then computes its zoom from a zero-size lie and
    // the view lands wrong permanently. Watch the container itself: every resize
    // re-measures, and the first transition from zero to real size re-applies
    // the pending fit with a size that can actually hold it.
    let containerResize = null;
    if (typeof ResizeObserver !== "undefined") {
        let hadSize = container.clientWidth > 0 && container.clientHeight > 0;
        containerResize = new ResizeObserver(() => {
            const hasSize = container.clientWidth > 0 && container.clientHeight > 0;
            if (hasSize) {
                map.invalidateSize();
                if (!hadSize) applyFitRequest();
            }
            hadSize = hasSize;
        });
        containerResize.observe(container);
    }

    let syncTimeout = null;
    let isSyncing = false;
    let needsSync = false;

    async function performSync() {
        if (destroyed) return;
        if (isSyncing) {
            needsSync = true;
            return;
        }
        isSyncing = true;
        try {
            await syncMapState();
        } catch (err) {
            console.error("Error in syncMapState:", err);
        } finally {
            isSyncing = false;
            if (needsSync) {
                needsSync = false;
                performSync();
            }
        }
    }

    function queueSync() {
        if (destroyed || !host.get("auto_sync")) {
            return;
        }
        if (syncTimeout) {
            clearTimeout(syncTimeout);
        }
        syncTimeout = setTimeout(() => {
            syncTimeout = null;
            performSync();
        }, 50);
    }

    // Listen for manual sync trigger changes from Python
    listen("change:sync_trigger", () => {
        performSync();
    });

    // Incremental updates from Python. Applied even when auto_sync is off so the mirror
    // stays current; queueSync decides whether to actually re-render.
    listen("msg:custom", (msg, buffers) => {
        if (!msg || msg.kind !== "swiftmap_patch") return;
        applyPatchOps(msg.ops || [], buffers);
        queueSync();
    });

    // Full-snapshot paths: the initial state message, and the sidebar writing `layers`
    // back after a toggle. Either way the trait becomes authoritative again.
    listen("change:layers", () => {
        layerState = host.get("layers") || [];
        queueSync();
    });
    listen("change:coordinate_buffers", () => {
        bufferState = { ...(host.get("coordinate_buffers") || {}) };
        queueSync();
    });
    listen("change:group_configs", queueSync);
    listen("change:time_config", () => {
        timeUI.started = false;   // re-apply speed/loop from the new config
        queueSync();
    });
    // Python steering the slider: snap to the nearest tick at or after the requested
    // time. Guarded so the widget's own writeback does not loop through here.
    listen("change:time_current", () => {
        const wanted = host.get("time_current");
        if (!timeState || !timeUI.ticks.length) return;
        if (Math.abs(wanted - timeUI.ticks[timeUI.index]) < 1) return;
        let idx = timeUI.ticks.findIndex(t => t >= wanted);
        if (idx === -1) idx = timeUI.ticks.length - 1;
        seekTo(idx, { write: false });
    });
    listen("change:show_logo", queueSync);
    listen("change:show_legend", queueSync);
    listen("change:legend_config", queueSync);
    // Live resizes (a Shiny layout, a notebook cell): Leaflet caches its box, so
    // it must be told to re-measure or tiles render for the old size.
    listen("change:height", () => {
        applyHeight();
        map.invalidateSize();
    });

    // Announce this view so Python replies with a full snapshot. Layers added before
    // the view attached would otherwise be missing: their patches were emitted into a
    // window where nothing was listening.
    try {
        host.send({ kind: "swiftmap_ready" });
    } catch (err) { /* no live backend; the initial state message is all there is */ }

    // Respect initial auto_sync state or manual sync requests sent during map building
    if (host.get("auto_sync") || host.get("sync_trigger") > 0) {
        performSync();
    }

    // The handle a host keeps: the live map and a teardown that releases what the
    // page cannot reclaim on its own -- playback timers, the pending sync, the
    // container's resize observer, the console hooks, the host subscriptions, and
    // the Leaflet map with every GL context and blob URL its layers hold.
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        stopPlayback();
        if (syncTimeout) {
            clearTimeout(syncTimeout);
            syncTimeout = null;
        }
        if (contextLossTimer) {
            clearTimeout(contextLossTimer);
            contextLossTimer = null;
        }
        if (containerResize) containerResize.disconnect();
        if (typeof host.off === "function") {
            for (const [event, fn] of subscriptions) host.off(event, fn);
        }
        console.error = originalError;
        console.warn = originalWarn;
        if (window.onerror === onWindowError) window.onerror = null;
        // glify keeps every instance in a module-level list; map.remove() alone
        // would leave each one -- and its GL context -- registered there. The
        // sweep over those lists also catches an instance a sync built for this
        // map and had not yet recorded when the host destroyed it.
        for (const state of Object.values(glStates)) {
            retireGl(state.layer);
            state.layer = null;
        }
        const glify = L.glify;
        if (glify) {
            for (const list of [glify.pointsInstances, glify.linesInstances, glify.shapesInstances]) {
                for (const instance of [...(list || [])]) {
                    if (instance.map === map) retireGl(instance);
                }
            }
        }
        // Leaflet arms a bare `setTimeout(_onZoomTransitionEnd, 250)` whenever
        // it starts a zoom animation (its webkit transitionend workaround), and
        // map.remove() does not clear it -- so a map torn down mid-zoom throws
        // from a timer that outlived it: _onZoomTransitionEnd -> _move ->
        // _getMapPanePos on a pane that no longer exists. Its own first line is
        // an `_animatingZoom` guard, so clearing the flag is enough to make the
        // late timer a no-op. Harmless where a map lives as long as its page;
        // visible as a console stack trace in any host that mounts and unmounts
        // maps freely -- React's StrictMode double mount, a Shiny re-render, the
        // demo site's card gallery.
        map._animatingZoom = false;
        try {
            map.remove();
        } catch (err) { /* already torn down */ }
        if (container.parentNode) container.parentNode.removeChild(container);
    }
    return { map, container, sync: performSync, destroy };
}
