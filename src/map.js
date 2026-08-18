import { loadCSS, loadJS } from "./utils.js";
import { renderSidebarControls, normalizeRadioLayers, sendLayerWrite } from "./sidebar.js";
import { deriveLegendSpec, renderLegend } from "./legend.js";
import { renderLabels } from "./labels.js";
import { renderLayer, renderMergedGlLayer } from "./layers.js";
import { parsePeriod, generateTicks, collectTimeExtent, hasTimeLayers,
         layerInWindow, renderTimeControl, advance, periodToMs, gcdGridMs,
         collectDurationsMs, POSITIONS } from "./timecontrol.js";
import { gpuTimeAvailable, vectorGpuAvailable, LAYER_SLOTS } from "./gputime.js";

// True if a layer is visible and no folder above it is switched off.
//
// Visibility is inherited down the folder path: a layer inside "Feeds/Active" is hidden
// when either "Feeds" or "Feeds/Active" is off, regardless of its own flag. Getting this
// wrong shows up as "that layer just will not appear", with nothing logged.
export function isLayerEffectiveVisible(layer, groupConfigs) {
    if (layer.visible === false) return false;
    let runningPath = "";
    for (const part of (layer.layer_group || "Layers").split("/")) {
        runningPath = runningPath ? `${runningPath}/${part}` : part;
        const config = groupConfigs[runningPath];
        if (config && config.visible === false) return false;
    }
    return true;
}

// Sorts the visible layers into one bucket per WebGL draw pass.
//
// Sub-layers of a merged group inherit their parent's visibility rather than carrying
// their own, so a group toggled off contributes nothing even when its children say
// visible. Circles join the polygon bucket: they are drawn as generated rings.
export function collectWebglLayers(layers, groupConfigs) {
    const buckets = { circle_markers: [], markers: [], polyline: [], polygon: [] };

    function collect(layer, parentVisible, isSubLayer) {
        if (!parentVisible) return;
        if (layer.type === "group" && layer.layers) {
            layer.layers.forEach(sub => collect(sub, parentVisible, true));
            return;
        }
        if (!isSubLayer && layer.visible === false) return;

        const bucket = layer.type === "circle" ? "polygon" : layer.type;
        if (buckets[bucket]) buckets[bucket].push(layer);
    }

    for (const layer of layers) {
        collect(layer, isLayerEffectiveVisible(layer, groupConfigs), false);
    }
    return buckets;
}

// Applies incremental patch ops to {layers, buffers}, returning the new state.
//
// Ops are addressed by layer id and applied idempotently: "add" upserts rather than
// appending blindly, so a patch that races the initial trait snapshot cannot duplicate
// a layer, and a "remove" for something already gone is a no-op.
// Applies `update` to one layer wherever it sits, descending into groups. add_collection
// nests its point, line and polygon layers inside a group layer, so an op addressed at a
// nested id would otherwise match nothing and silently do nothing. Returns the original
// array untouched when the id is not found, so an unmatched op costs no re-render.
function updateLayerById(layers, id, update) {
    let hit = false;
    const next = layers.map(l => {
        if (l.id === id) {
            hit = true;
            return update(l);
        }
        if (l.type === "group" && Array.isArray(l.layers)) {
            const subs = updateLayerById(l.layers, id, update);
            if (subs !== l.layers) {
                hit = true;
                return { ...l, layers: subs };
            }
        }
        return l;
    });
    return hit ? next : layers;
}

// Every point layer, visible or not, with its effective visibility recorded -- the
// GPU-visibility path keeps hidden layers in the bucket (stable ids, no rebuild on a
// toggle) and hides them with a uniform instead. Mirrors collectWebglLayers' rules:
// sub-layers inherit their parent's effective visibility, top-level layers answer for
// their own flag and their folder chain.
export function collectPointLayersAll(layers, groupConfigs) {
    const out = { circle_markers: [], markers: [], polyline: [], polygon: [] };
    function walk(layer, parentVisible, isSub) {
        if (layer.type === "group" && layer.layers) {
            const selfVis = parentVisible && isLayerEffectiveVisible(layer, groupConfigs);
            layer.layers.forEach(sub => walk(sub, selfVis, true));
            return;
        }
        const bucket = layer.type === "circle" ? "polygon" : layer.type;
        if (!out[bucket]) return;
        const vis = isSub ? parentVisible
            : parentVisible && isLayerEffectiveVisible(layer, groupConfigs);
        out[bucket].push({ layer, vis });
    }
    for (const layer of layers) walk(layer, true, false);
    return out;
}

export function applySwiftmapPatch(state, ops, buffers) {
    let layers = state.layers || [];
    let bufferMap = state.buffers || {};

    for (const op of ops) {
        if (op.op === "snapshot") {
            layers = op.layers || [];
            bufferMap = {};
            (op.buffer_ids || []).forEach((id, i) => {
                if (buffers && buffers[i]) bufferMap[id] = buffers[i];
            });
        } else if (op.op === "add" || op.op === "replace") {
            const incoming = op.layer;
            const id = incoming ? incoming.id : op.id;
            const idx = layers.findIndex(l => l.id === id);
            if (idx === -1) {
                layers = [...layers, incoming];
            } else {
                layers = layers.map((l, i) => (i === idx ? incoming : l));
            }
        } else if (op.op === "set") {
            // Field-level update. "replace" carries the whole layer, so flipping `visible`
            // on a 50k-point layer resent every property it holds -- half a megabyte to
            // change one boolean, on every click of a checkbox.
            layers = updateLayerById(layers, op.id, l => ({ ...l, ...(op.fields || {}) }));
        } else if (op.op === "style") {
            // Per-feature style overrides, replaced wholesale rather than merged: a
            // selection describes its complete state, so sending {} clears it and no
            // caller has to track what the previous highlight touched.
            layers = updateLayerById(layers, op.id, l => ({
                ...l, style_overrides: op.overrides || {},
            }));
        } else if (op.op === "remove") {
            layers = layers.filter(l => l.id !== op.id);
        } else if (op.op === "buffer") {
            const buf = buffers && buffers[op.buffer_index];
            if (buf) bufferMap = { ...bufferMap, [op.id]: buf };
        } else if (op.op === "buffer_remove") {
            bufferMap = { ...bufferMap };
            delete bufferMap[op.id];
        }
    }

    return { layers, buffers: bufferMap };
}

export default {
    async render({ model, el }) {
        const originalError = console.error;
        const originalWarn = console.warn;

        // js_console_logs is a synced list, so each append resends the whole array. Keeping
        // only the most recent entries bounds both the payload and the memory a long-lived
        // session accumulates; the newest are the ones worth having anyway.
        const MAX_CONSOLE_LOGS = 200;
        const appendLog = entry => {
            const logs = model.get("js_console_logs") || [];
            const next = [...logs, entry];
            return next.length > MAX_CONSOLE_LOGS ? next.slice(-MAX_CONSOLE_LOGS) : next;
        };

        // Helper to safely write back to Python only if the widget view is active and attached
        function safeSetAndSave(key, value) {
            if (document.body.contains(el)) {
                try {
                    model.set(key, value);
                    model.save_changes();
                } catch (e) {
                    originalWarn.call(console, "[SwiftMap] Suppressed sync write error:", e);
                }
            }
        }

        function safeSaveChanges() {
            if (document.body.contains(el)) {
                try {
                    model.save_changes();
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
                    const crs = model.get("crs") || "EPSG:3857";
                    const cleanMsg = `[SwiftMap] Layer was reprojected to "${crs}"`;
                    originalWarn.call(console, cleanMsg);
                    
                    safeSetAndSave("js_console_logs", appendLog(cleanMsg));
                }
                return; // suppress duplicate console warnings
            }
            originalWarn.apply(console, args);
        };

        window.onerror = function(message, source, lineno, colno, error) {
            safeSetAndSave("js_console_logs",
                appendLog(`WINDOW.ONERROR: ${message} at ${source}:${lineno}:${colno}`));
        };

        // Load CSS and Leaflet libraries (including WebGL glify)
        loadCSS("leaflet-css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
        await loadJS("leaflet-js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
        await loadJS("leaflet-glify", "https://unpkg.com/leaflet.glify@3.3.0/dist/glify-browser.js");

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
            const h = model.get("height");
            container.style.height = h || "100%";
            container.style.minHeight = h ? "0" : "";
        }
        applyHeight();

        let labelsGroup = null;   // created after the map; filled by each sync

        const crsName = model.get("crs");
        let mapCrs = L.CRS.EPSG3857;
        if (crsName === "EPSG:4326") {
            mapCrs = L.CRS.EPSG4326;
        }

        const map = L.map(container, {
            crs: mapCrs,
            center: model.get("center"),
            zoom: model.get("zoom"),
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

        labelsGroup = L.layerGroup().addTo(map);

        // Local mirrors of the layer list and coordinate buffers.
        //
        // Python updates these incrementally via "swiftmap_patch" messages instead of
        // reassigning the traits, because a trait reassignment re-serializes and re-sends
        // the entire map on every mutation. The traits still carry the initial snapshot
        // when a view attaches, and the sidebar still writes `layers` back on toggle, so
        // both are seeded here and kept in step by the change handlers further down.
        let layerState = model.get("layers") || [];
        let bufferState = { ...(model.get("coordinate_buffers") || {}) };

        function applyPatchOps(ops, buffers) {
            const next = applySwiftmapPatch({ layers: layerState, buffers: bufferState }, ops, buffers);
            layerState = next.layers;
            bufferState = next.buffers;
        }

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
                model.set("time_current", timeUI.ticks[timeUI.index]);
                model.save_changes();
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
                const cfg = { ...(model.get("time_config") || {}) };
                if (iso) cfg.window = iso;
                else delete cfg.window;
                try {
                    model.set("time_config", cfg);
                    model.save_changes();
                } catch (err) { /* no live backend; the local model still holds it */ }
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
            const cfg = model.get("time_config") || {};
            const period = parsePeriod(cfg.period || "P1D") || parsePeriod("P1D");
            const extent = collectTimeExtent(layerState, bufferState);
            if (!extent) return;

            const key = `${extent.min}|${extent.max}|${cfg.period || "P1D"}`;
            if (key !== timeUI.key) {
                timeUI.key = key;
                timeUI.ticks = generateTicks(extent.min, extent.max, period);
                timeUI.index = Math.min(timeUI.index, timeUI.ticks.length - 1);
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
        const logoDiv = document.createElement("div");
        logoDiv.style.position = "absolute";
        logoDiv.style.bottom = "10px";
        logoDiv.style.right = "10px";
        logoDiv.style.zIndex = "1000";
        logoDiv.style.background = "white";
        logoDiv.style.padding = "5px";
        logoDiv.style.borderRadius = "4px";
        logoDiv.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
        logoDiv.style.display = "none";
        logoDiv.innerHTML = `
            <div style="display: flex; align-items: center;">
                <img src="https://repo/assets/image.png" alt="Company" style="height: 35px; margin-right: 5px;">
                <img src="https://repo/assets/image2.png" alt="Parent Company" style="height: 35px;">
            </div>
        `;
        container.appendChild(logoDiv);



        function getTileLayer(layer) {
            return L.tileLayer(layer.url, {
                attribution: layer.attribution || '',
                maxZoom: layer.max_zoom || 22,
                maxNativeZoom: layer.max_native_zoom || 19
            });
        }

        async function syncMapState() {
            console.time("[Performance] syncMapState Total");
            updateTimeDimension();
            const layers = layerState;
            const groupConfigs = model.get("group_configs") || {};
            const coordinateBuffers = bufferState;

            // Enforce mutually exclusive radio group visibility before collecting or rendering WebGL layers.
            // Written back as targeted flips, never the layers trait -- the full write was
            // the frame that killed large sessions (see the sidebar's change handler).
            const radio = normalizeRadioLayers(layers, groupConfigs);
            if ((radio.changes.length > 0 || radio.groupsChanged) && document.body.contains(el)) {
                sendLayerWrite(model, radio.changes);
                model.set("group_configs", { ...groupConfigs });
                model.save_changes();
            }

            logoDiv.style.display = model.get("show_logo") ? "block" : "none";

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
                    if (existing.layerType !== layer.type) {
                        existing.remove();
                        delete activeOverlayLayers[layer.id];
                    } else {
                        continue;
                    }
                }

                const instance = await renderLayer(map, layer, coordinateBuffers[layer.id], model);
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
                    locLen: l.locations?.length || 0
                })));

                const state = glStates[type];
                const stateChanged = state.ids !== idsString || state.meta !== metaString;

                if (stateChanged) {
                    if (state.layer) {
                        state.layer.remove();
                    }
                    if (visibleLayers.length > 0) {
                        state.layer = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, model, timeState, vectorGpu);
                        if (state.layer) {
                            state.layer.addTo(map);
                        }
                    } else {
                        state.layer = null;
                    }
                    state.ids = idsString;
                    state.meta = metaString;
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
            await syncGlLayer("markers", bucket.markers);
            await syncGlLayer("polyline", bucket.polyline, vectorGpuBucket.polyline);
            await syncGlLayer("polygon", bucket.polygon, vectorGpuBucket.polygon);

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

            renderSidebarControls(sidebar, layers, model, map, () => {
                performSync();
            });

            // Permanent labels follow the same derive-per-sync pattern as the legend,
            // so they track visibility with no bucket or meta-key involvement.
            if (labelsGroup) {
                renderLabels(L, labelsGroup, layers, coordinateBuffers, groupConfigs);
            }

            const legendCfg = model.get("legend_config") || {};
            if (model.get("show_legend")) {
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

        // Bind zoom and center changes back to Python safely
        map.on("moveend", () => {
            try {
                const center = map.getCenter();
                const currentZoom = map.getZoom();
                
                const modelCenter = model.get("center");
                const modelZoom = model.get("zoom");
                
                const zoomChanged = modelZoom !== currentZoom;
                const centerChanged = !modelCenter || 
                    !Array.isArray(modelCenter) ||
                    modelCenter.length < 2 ||
                    Math.abs(modelCenter[0] - center.lat) > 0.0001 || 
                    Math.abs(modelCenter[1] - center.lng) > 0.0001;
                    
                if (centerChanged) {
                    isUpdatingCenterFromMap = true;
                    model.set("center", [center.lat, center.lng]);
                }
                if (zoomChanged) {
                    isUpdatingZoomFromMap = true;
                    model.set("zoom", currentZoom);
                }
                if (centerChanged || zoomChanged) {
                    safeSaveChanges();
                }
            } catch (err) {
                console.error("Error in moveend handler:", err);
            }
        });

        function updateMapView() {
            const center = model.get("center");
            const zoom = model.get("zoom");
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
                const zoom = model.get("zoom");
                if (typeof zoom === "number" && map.getZoom() !== zoom) {
                    map.setZoom(zoom);
                }
            }
        }

        // Watch for map view updates from Python
        model.on("change:center", () => {
            if (isUpdatingCenterFromMap) {
                isUpdatingCenterFromMap = false;
                return;
            }
            updateMapView();
        });
        model.on("change:zoom", () => {
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
            const req = model.get("fit_bounds_request") || {};
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
        model.on("change:fit_bounds_request", applyFitRequest);
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
        if (typeof ResizeObserver !== "undefined") {
            let hadSize = container.clientWidth > 0 && container.clientHeight > 0;
            const containerResize = new ResizeObserver(() => {
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
            if (!model.get("auto_sync")) {
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
        model.on("change:sync_trigger", () => {
            performSync();
        });

        // Incremental updates from Python. Applied even when auto_sync is off so the mirror
        // stays current; queueSync decides whether to actually re-render.
        model.on("msg:custom", (msg, buffers) => {
            if (!msg || msg.kind !== "swiftmap_patch") return;
            applyPatchOps(msg.ops || [], buffers);
            queueSync();
        });

        // Full-snapshot paths: the initial state message, and the sidebar writing `layers`
        // back after a toggle. Either way the trait becomes authoritative again.
        model.on("change:layers", () => {
            layerState = model.get("layers") || [];
            queueSync();
        });
        model.on("change:coordinate_buffers", () => {
            bufferState = { ...(model.get("coordinate_buffers") || {}) };
            queueSync();
        });
        model.on("change:group_configs", queueSync);
        model.on("change:time_config", () => {
            timeUI.started = false;   // re-apply speed/loop from the new config
            queueSync();
        });
        // Python steering the slider: snap to the nearest tick at or after the requested
        // time. Guarded so the widget's own writeback does not loop through here.
        model.on("change:time_current", () => {
            const wanted = model.get("time_current");
            if (!timeState || !timeUI.ticks.length) return;
            if (Math.abs(wanted - timeUI.ticks[timeUI.index]) < 1) return;
            let idx = timeUI.ticks.findIndex(t => t >= wanted);
            if (idx === -1) idx = timeUI.ticks.length - 1;
            seekTo(idx, { write: false });
        });
        model.on("change:show_logo", queueSync);
        model.on("change:show_legend", queueSync);
        model.on("change:legend_config", queueSync);
        // Live resizes (a Shiny layout, a notebook cell): Leaflet caches its box, so
        // it must be told to re-measure or tiles render for the old size.
        model.on("change:height", () => {
            applyHeight();
            map.invalidateSize();
        });

        // Announce this view so Python replies with a full snapshot. Layers added before
        // the view attached would otherwise be missing: their patches were emitted into a
        // window where nothing was listening.
        try {
            model.send({ kind: "swiftmap_ready" });
        } catch (err) { /* no live backend; the initial state message is all there is */ }

        // Respect initial auto_sync state or manual sync requests sent during map building
        if (model.get("auto_sync") || model.get("sync_trigger") > 0) {
            performSync();
        }
    }
};
