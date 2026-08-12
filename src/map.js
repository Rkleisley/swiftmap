import { loadCSS, loadJS } from "./utils.js";
import { renderSidebarControls, normalizeRadioLayers } from "./sidebar.js";
import { renderLayer, renderMergedGlLayer } from "./layers.js";
import { parsePeriod, generateTicks, collectTimeExtent, hasTimeLayers,
         layerInWindow, renderTimeControl, advance } from "./timecontrol.js";

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
            if (model.comm && document.body.contains(el)) {
                try {
                    model.set(key, value);
                    model.save_changes();
                } catch (e) {
                    originalWarn.call(console, "[SwiftMap] Suppressed sync write error:", e);
                }
            }
        }

        function safeSaveChanges() {
            if (model.comm && document.body.contains(el)) {
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
        container.style.height = "100%";
        container.style.position = "relative";
        el.appendChild(container);

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
                         speed: 1, timer: null, lastWrite: 0, started: false };

        function stopPlayback() {
            if (timeUI.timer) clearInterval(timeUI.timer);
            timeUI.timer = null;
            timeUI.playing = false;
        }

        function writeTimeCurrent(force) {
            const now = Date.now();
            if (!force && now - timeUI.lastWrite < 1000) return;
            timeUI.lastWrite = now;
            if (model.comm) {
                model.set("time_current", timeUI.ticks[timeUI.index]);
                model.save_changes();
            }
        }

        function seekTo(index, { write = true } = {}) {
            timeUI.index = Math.max(0, Math.min(index, timeUI.ticks.length - 1));
            timeState = { tick: timeUI.ticks[timeUI.index], period: timeState.period };
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
            timeState = { tick: timeUI.ticks[timeUI.index], period };

            if (!timeUI.started) {
                timeUI.started = true;
                timeUI.speed = cfg.speed || 1;
                timeUI.loop = Boolean(cfg.loop);
                if (cfg.auto_play) startPlayback();
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

            // Enforce mutually exclusive radio group visibility before collecting or rendering WebGL layers
            const radioChanged = normalizeRadioLayers(layers, groupConfigs);
            if (radioChanged && model.comm && document.body.contains(el)) {
                model.set("layers", [...layers]);
                model.set("group_configs", groupConfigs);
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
            async function syncGlLayer(type, visibleLayers) {
                const idsString = visibleLayers.map(l => l.id).sort().join(",");
                // Everything the built buffers depend on belongs in this key: a change that
                // is not in it renders stale. highlight_style and style_overrides were
                // missing at first, so a highlight landed in state and never repainted.
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
                    tick: l.time && timeState ? timeState.tick : 0,
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
                        state.layer = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, model, timeState);
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

            await syncGlLayer("circle_markers", webglCircleMarkerLayers);
            await syncGlLayer("markers", webglMarkerLayers);
            await syncGlLayer("polyline", webglPolylineLayers);
            await syncGlLayer("polygon", webglPolygonLayers);

            renderSidebarControls(sidebar, layers, model, map, () => {
                performSync();
            });
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
        model.on("change:fit_bounds_request", () => {
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
        });

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
            timeUI.started = false;   // re-apply speed/loop/auto_play from the new config
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

        // Announce this view so Python replies with a full snapshot. Layers added before
        // the view attached would otherwise be missing: their patches were emitted into a
        // window where nothing was listening.
        if (model.comm) {
            model.send({ kind: "swiftmap_ready" });
        }

        // Respect initial auto_sync state or manual sync requests sent during map building
        if (model.get("auto_sync") || model.get("sync_trigger") > 0) {
            performSync();
        }
    }
};
