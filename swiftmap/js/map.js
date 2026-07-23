import { loadCSS, loadJS } from "./utils.js";
import { renderSidebarControls } from "./sidebar.js";
import { renderLayer, renderMergedGlLayer } from "./layers.js";

export default {
    async render({ model, el }) {
        // Intercept console.error, console.warn, and window.onerror for debugging and warning cleanup
        const originalError = console.error;
        console.error = function(...args) {
            originalError.apply(console, args);
            const logs = model.get("js_console_logs") || [];
            logs.push("CONSOLE.ERROR: " + args.map(a => String(a)).join(" "));
            model.set("js_console_logs", [...logs]);
            model.save_changes();
        };
        
        const originalWarn = console.warn;
        let loggedReprojected = false;
        console.warn = function(...args) {
            const msg = args.map(a => String(a)).join(" ");
            if (msg.includes("layer designed for SphericalMercator") || msg.includes("alternate detected")) {
                if (!loggedReprojected) {
                    loggedReprojected = true;
                    const crs = model.get("crs") || "EPSG:3857";
                    const cleanMsg = `[SwiftMap] Layer was reprojected to "${crs}"`;
                    originalWarn.call(console, cleanMsg);
                    
                    const logs = model.get("js_console_logs") || [];
                    logs.push(cleanMsg);
                    model.set("js_console_logs", [...logs]);
                    model.save_changes();
                }
                return; // suppress duplicate console warnings
            }
            originalWarn.apply(console, args);
        };

        window.onerror = function(message, source, lineno, colno, error) {
            const logs = model.get("js_console_logs") || [];
            logs.push(`WINDOW.ONERROR: ${message} at ${source}:${lineno}:${colno}`);
            model.set("js_console_logs", [...logs]);
            model.save_changes();
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

        const activeTileLayers = {};
        const activeOverlayLayers = {};
        let activeSharedCircleMarkersGlLayer = null;
        let activeSharedMarkersGlLayer = null;
        let activeSharedPolylinesGlLayer = null;
        let activeSharedPolygonsGlLayer = null;

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
            const layers = model.get("layers") || [];
            const coordinateBuffers = model.get("coordinate_buffers") || {};

            logoDiv.style.display = model.get("show_logo") ? "block" : "none";

            // Group visible layers (including sub-layers inside groups) to always use WebGL
            const webglCircleMarkerLayers = [];
            const webglMarkerLayers = [];
            const webglPolylineLayers = [];
            const webglPolygonLayers = [];

            const groupConfigs = model.get("group_configs") || {};

            function isLayerEffectiveVisible(l) {
                if (l.visible === false) return false;
                const pathStr = l.layer_group || "Layers";
                const parts = pathStr.split("/");
                let runningPath = "";
                for (const part of parts) {
                    runningPath = runningPath ? `${runningPath}/${part}` : part;
                    const config = groupConfigs[runningPath];
                    if (config && config.visible === false) {
                        return false;
                    }
                }
                return true;
            }

            function collectWebglLayers(l, parentEffectiveVisible, isSubLayer) {
                if (!parentEffectiveVisible) return;
                
                if (l.type === "group" && l.layers) {
                    l.layers.forEach(sub => {
                        collectWebglLayers(sub, parentEffectiveVisible, true);
                    });
                    return;
                }
                
                if (!isSubLayer && l.visible === false) return;

                if (l.type === "geojson" && l.geojson) {
                    const features = [];
                    if (l.geojson.type === "FeatureCollection") {
                        features.push(...(l.geojson.features || []));
                    } else if (l.geojson.type === "Feature") {
                        features.push(l.geojson);
                    } else if (l.geojson.type === "Polygon" || l.geojson.type === "MultiPolygon" || l.geojson.type === "LineString" || l.geojson.type === "Point" || l.geojson.type === "MultiPoint") {
                        features.push({ geometry: l.geojson, properties: {} });
                    }
                    
                    features.forEach(f => {
                        const geom = f.geometry;
                        if (!geom) return;
                        
                        if (geom.type === "Polygon") {
                            const locations = geom.coordinates[0].map(c => [c[1], c[0]]);
                            webglPolygonLayers.push({
                                ...l,
                                type: "polygon",
                                locations: locations,
                                properties: f.properties || {}
                            });
                        } else if (geom.type === "MultiPolygon") {
                            geom.coordinates.forEach(polyCoords => {
                                const locations = polyCoords[0].map(c => [c[1], c[0]]);
                                webglPolygonLayers.push({
                                    ...l,
                                    type: "polygon",
                                    locations: locations,
                                    properties: f.properties || {}
                                });
                            });
                        } else if (geom.type === "LineString") {
                            const locations = geom.coordinates.map(c => [c[1], c[0]]);
                            webglPolylineLayers.push({
                                ...l,
                                type: "polyline",
                                locations: locations,
                                properties: f.properties || {}
                            });
                        } else if (geom.type === "MultiLineString") {
                            geom.coordinates.forEach(lineCoords => {
                                const locations = lineCoords.map(c => [c[1], c[0]]);
                                webglPolylineLayers.push({
                                    ...l,
                                    type: "polyline",
                                    locations: locations,
                                    properties: f.properties || {}
                                });
                            });
                        } else if (geom.type === "Point") {
                            webglMarkerLayers.push({
                                ...l,
                                type: "markers",
                                location: [geom.coordinates[1], geom.coordinates[0]],
                                properties: f.properties || {}
                            });
                        } else if (geom.type === "MultiPoint") {
                            geom.coordinates.forEach(ptCoords => {
                                webglMarkerLayers.push({
                                    ...l,
                                    type: "markers",
                                    location: [ptCoords[1], ptCoords[0]],
                                    properties: f.properties || {}
                                });
                            });
                        }
                    });
                    return;
                }
                
                if (l.type === "circle_markers") {
                    webglCircleMarkerLayers.push(l);
                } else if (l.type === "markers") {
                    webglMarkerLayers.push(l);
                } else if (l.type === "polyline") {
                    webglPolylineLayers.push(l);
                } else if (l.type === "polygon" || l.type === "circle") {
                    webglPolygonLayers.push(l);
                }
            }

            layers.forEach(l => {
                const effectiveVisible = isLayerEffectiveVisible(l);
                collectWebglLayers(l, effectiveVisible);
            });

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
                const effectiveVisible = isLayerEffectiveVisible(layer);
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

                if (!effectiveVisible) {
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

            // Render/update merged WebGL circle markers
            if (webglCircleMarkerLayers.length > 0) {
                if (activeSharedCircleMarkersGlLayer) {
                    activeSharedCircleMarkersGlLayer.remove();
                }
                activeSharedCircleMarkersGlLayer = await renderMergedGlLayer(
                    map,
                    "circle_markers",
                    webglCircleMarkerLayers,
                    coordinateBuffers,
                    model
                );
            } else {
                if (activeSharedCircleMarkersGlLayer) {
                    activeSharedCircleMarkersGlLayer.remove();
                    activeSharedCircleMarkersGlLayer = null;
                }
            }

            // Render/update merged WebGL markers
            if (webglMarkerLayers.length > 0) {
                if (activeSharedMarkersGlLayer) {
                    activeSharedMarkersGlLayer.remove();
                }
                activeSharedMarkersGlLayer = await renderMergedGlLayer(
                    map,
                    "markers",
                    webglMarkerLayers,
                    coordinateBuffers,
                    model
                );
            } else {
                if (activeSharedMarkersGlLayer) {
                    activeSharedMarkersGlLayer.remove();
                    activeSharedMarkersGlLayer = null;
                }
            }

            // Render/update merged WebGL polylines
            if (webglPolylineLayers.length > 0) {
                if (activeSharedPolylinesGlLayer) {
                    activeSharedPolylinesGlLayer.remove();
                }
                activeSharedPolylinesGlLayer = await renderMergedGlLayer(
                    map,
                    "polyline",
                    webglPolylineLayers,
                    coordinateBuffers,
                    model
                );
            } else {
                if (activeSharedPolylinesGlLayer) {
                    activeSharedPolylinesGlLayer.remove();
                    activeSharedPolylinesGlLayer = null;
                }
            }

            // Render/update merged WebGL polygons/circles
            if (webglPolygonLayers.length > 0) {
                if (activeSharedPolygonsGlLayer) {
                    activeSharedPolygonsGlLayer.remove();
                }
                activeSharedPolygonsGlLayer = await renderMergedGlLayer(
                    map,
                    "polygon",
                    webglPolygonLayers,
                    coordinateBuffers,
                    model
                );
            } else {
                if (activeSharedPolygonsGlLayer) {
                    activeSharedPolygonsGlLayer.remove();
                    activeSharedPolygonsGlLayer = null;
                }
            }

            renderSidebarControls(sidebar, layers, model, map, () => {
                performSync();
            });
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
                    model.save_changes();
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
        model.on("change:fit_bounds_coords", () => {
            const bounds = model.get("fit_bounds_coords");
            if (bounds && bounds.length > 0) {
                map.fitBounds(bounds);
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

        model.on("change:layers", queueSync);
        model.on("change:group_configs", queueSync);
        model.on("change:coordinate_buffers", queueSync);
        model.on("change:show_logo", queueSync);

        // Respect initial auto_sync state or manual sync requests sent during map building
        if (model.get("auto_sync") || model.get("sync_trigger") > 0) {
            performSync();
        }
    }
};
