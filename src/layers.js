import { loadJS, bindPopup, bindTooltip, parseColor } from "./utils.js";
import { pinShader } from "./shaders.js";
import { windowFor, featureInWindow, timesFor, layerInWindow, effectiveDuration,
         periodToMs } from "./timecontrol.js";
import { buildTimeAttributes, attachTimeToInstance, timeVertexShader,
         gpuTimeAvailable, buildVectorTimeMeta, attachTimeToVectorInstance } from "./gputime.js";

function setupGlifyProjection(glInstance) {
    if (glInstance && glInstance.layer) {
        glInstance.layer._unclampedProject = function(latlng, zoom) {
            return this._map.options.crs.latLngToPoint(latlng, zoom);
        };
        glInstance.layer.redraw();
    }
}

function registerClickMatch(map, priority, action) {
    if (!map._clickMatches) {
        map._clickMatches = [];
    }
    map._clickMatches.push({ priority, action });
    if (!map._clickTimeout) {
        map._clickTimeout = setTimeout(() => {
            map._clickMatches.sort((a, b) => a.priority - b.priority);
            if (map._clickMatches.length > 0) {
                map._clickMatches[0].action();
            }
            map._clickMatches = [];
            map._clickTimeout = null;
        }, 0);
    }
}

function registerHoverMatch(map, priority, action) {
    if (!map._hoverMatches) {
        map._hoverMatches = [];
    }
    map._hoverMatches.push({ priority, action });
    if (!map._hoverTimeout) {
        map._hoverTimeout = setTimeout(() => {
            map._hoverMatches.sort((a, b) => a.priority - b.priority);
            if (map._hoverMatches.length > 0) {
                map._hoverMatches[0].action();
            }
            map._hoverMatches = [];
            map._hoverTimeout = null;
        }, 0);
    }
}

// Style for one feature: its own entry from `feature_styles` when the layer carries
// varied styling, otherwise the layer's single style. Python only emits feature_styles
// when features actually differ, so a uniform layer costs nothing extra here.
// Four sources, least specific first. Each transient one lives in its own field rather
// than editing the layer's style, so clearing it restores what was underneath with
// nothing to remember and nothing to put back.
//
//   the layer's own style   what it was drawn with
//   feature_styles[i]       per feature, from the data
//   highlight_style         the whole layer is selected
//   style_overrides[i]      this feature is selected -- most specific, so it wins
export function styleFor(layer, index) {
    const fromData = Array.isArray(layer.feature_styles) ? layer.feature_styles[index] : null;
    const highlight = layer.highlight_style;
    const selected = layer.style_overrides && layer.style_overrides[index];
    if (!fromData && !highlight && !selected) return layer;
    return { ...layer, ...(fromData || {}), ...(highlight || {}), ...(selected || {}) };
}

export function getIndexedProperties(properties, index) {
    if (!properties) return {};
    const props = {};
    Object.keys(properties).forEach(k => {
        const val = properties[k];
        props[k] = Array.isArray(val) ? val[index] : val;
    });
    return props;
}



export async function renderLayer(map, layer, coordBuffer, model) {
    if (layer.type === "group") {
        const group = L.layerGroup();
        const coordinateBuffers = model.get("coordinate_buffers") || {};
        for (const sub of layer.layers) {
            if (sub.type === "circle_markers" || sub.type === "markers" || sub.type === "polyline" || sub.type === "polygon" || sub.type === "circle") {
                continue;
            }
            const instance = await renderLayer(map, sub, coordinateBuffers[sub.id], model);
            if (instance) {
                group.addLayer(instance);
            }
        }
        group.addTo(map);
        group.layerType = layer.type;
        return group;
    }
    return null;
}

// A vector layer's coordinates: the binary buffer under its id when Python built it
// (the layers JSON then carries no coordinates at all), or inline `locations` for
// hand-built configs and fixtures. Materialised only on rebuild, which vector buckets
// on the GPU path rarely do.
function vectorCoords(layer, coordinateBuffers) {
    if (layer.locations) return layer.locations;
    const raw = coordinateBuffers[layer.id];
    if (!raw) return null;
    const flat = new Float64Array(raw.buffer || raw, raw.byteOffset || 0,
        (raw.byteLength || raw.length) / 8);
    const out = new Array(flat.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = [flat[i * 2], flat[i * 2 + 1]];
    }
    return out;
}

export async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, model,
                                           timeState = null, vectorGpu = false) {
    // Lines, polygons and circles are one geometry per layer. On the GPU path (map.js
    // passes vectorGpu when the bucket qualifies) every feature stays in the buffers and
    // the shader decides visibility per tick and per layer toggle -- a line-shaped track
    // has as many vertices as a point track has points, so its rebuilds cost the same
    // and crashed the same way. Off the GPU path, the whole-feature CPU filter remains.
    const vectorMeta = vectorGpu && type !== "circle_markers" && type !== "markers"
        ? buildVectorTimeMeta(layersList, coordinateBuffers,
            timeState && timeState.period ? periodToMs(timeState.period) : null)
        : { hasTime: false };
    const vectorTime = Boolean(vectorMeta.hasTime);
    if (timeState && !vectorTime && type !== "circle_markers" && type !== "markers") {
        layersList = layersList.filter(l => layerInWindow(l, coordinateBuffers, timeState));
        if (layersList.length === 0) return null;
    }
    if (type === "polyline") {
        const features = [];
        const vertexCounts = [];
        for (const layer of layersList) {
            const locs = vectorCoords(layer, coordinateBuffers) || [];
            const geojsonCoords = locs.map(c => [c[1], c[0]]);
            vertexCounts.push(Math.max(0, 2 * (geojsonCoords.length - 1)));
            const style = styleFor(layer, 0);
            const rgb = parseColor(style.color, "#3388ff");
            features.push({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: geojsonCoords
                },
                properties: {
                    layer: layer,
                    colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.opacity || 1.0 },
                    weight: style.weight || 3
                }
            });
        }

        if (features.length === 0) return null;

        const geojson = {
            type: "FeatureCollection",
            features: features
        };

        const glLayer = L.Layer.extend({
            onAdd: function(m) {
                this._map = m;
                this._isHovering = false;
                
                this._mapMouseMoveHandler = (e) => {
                    setTimeout(() => {
                        if (!this._isHovering) {
                            map.getContainer().style.cursor = '';
                            if (this._sharedTooltip) {
                                this._sharedTooltip.remove();
                                this._sharedTooltip = null;
                            }
                        }
                        this._isHovering = false;
                    }, 0);
                };
                m.on("mousemove", this._mapMouseMoveHandler);

                const lineOptions = vectorTime
                    ? { vertexShaderSource: () => timeVertexShader() } : {};
                this.glLines = L.glify.lines({
                    ...lineOptions,
                    map: m,
                    data: geojson,
                    pane: "polylinesPane",
                    // The data above is GeoJSON, whose coordinates are [lon, lat]; glify
                    // defaults to latitude-first and its LINE vertex builder reads
                    // coordinates through these keys -- unset, it took longitude as
                    // latitude and projected every line off-viewport. Silently: no GL
                    // error, a healthy canvas, zero fragments. Set per instance rather
                    // than on the L.glify global, which another library could also
                    // mutate. The polygon path is deliberately NOT given these keys:
                    // it triangulates via earcut on the GeoJSON directly, native
                    // [lon, lat], and keys there would transpose it the same way.
                    // Found by the Valhalla-VRE bug report, driving the plain-JS
                    // bundle where no points masked the blank lines.
                    latitudeKey: 1,
                    longitudeKey: 0,
                    color: (index, feature) => {
                        return feature.properties.colorRGB;
                    },
                    weight: (index, feature) => {
                        return feature.properties.weight;
                    },
                    click: (e, feature) => {
                        registerClickMatch(map, 2, () => {
                            if (feature && feature.properties && feature.properties.layer) {
                                const layer = feature.properties.layer;
                                bindPopup(map, e.latlng, layer.properties, layer);
                                // Written bare: shinywidgets' model has no `comm`
                                // property, so gating on it silently killed this
                                // writeback under Shiny. The sidebar always wrote bare
                                // and was the one path that worked there.
                                try {
                                    model.set("clicked_layer_id", layer.id);
                                    model.set("selected_index", 0);
                                    model.save_changes();
                                } catch (err) { /* no live backend */ }
                            }
                        });
                    },
                    hover: (e, feature) => {
                        this._isHovering = true;
                        if (feature && feature.properties && feature.properties.layer) {
                            registerHoverMatch(map, 2, () => {
                                const layer = feature.properties.layer;
                                map.getContainer().style.cursor = 'pointer';
                                bindTooltip(map, e.latlng, layer.properties, layer, this);
                            });
                        }
                    }
                });
                setupGlifyProjection(this.glLines);
                if (vectorTime) {
                    this._swiftmapTime = attachTimeToVectorInstance(this.glLines, vectorMeta, vertexCounts);
                }
            },
            onRemove: function(m) {
                if (this._mapMouseMoveHandler) {
                    m.off("mousemove", this._mapMouseMoveHandler);
                }
                if (this.glLines) this.glLines.remove();
                if (this._sharedTooltip) {
                    this._sharedTooltip.remove();
                    this._sharedTooltip = null;
                }
                map.getContainer().style.cursor = '';
            }
        });
        const instance = new glLayer();
        instance.addTo(map);
        instance.layerType = type;
        return instance;
    }

    if (type === "polygon") {
        const features = [];
        const vertexCounts = [];
        for (const layer of layersList) {
            let geojsonCoords = [];
            if (layer.type === "polygon") {
                const locs = vectorCoords(layer, coordinateBuffers) || [];
                geojsonCoords = locs.map(c => [c[1], c[0]]);
                if (geojsonCoords.length > 0) {
                    const first = geojsonCoords[0];
                    const last = geojsonCoords[geojsonCoords.length - 1];
                    if (first[0] !== last[0] || first[1] !== last[1]) {
                        geojsonCoords.push([first[0], first[1]]);
                    }
                }
            } else if (layer.type === "circle") {
                const lat = layer.location[0];
                const lon = layer.location[1];
                const radiusMeters = layer.radius || 10;
                const earthRadius = 6378137;
                for (let i = 0; i <= 32; i++) {
                    const angle = (i * 360) / 32;
                    const angleRad = (angle * Math.PI) / 180;
                    const dLat = (radiusMeters * Math.cos(angleRad)) / earthRadius;
                    const dLon = (radiusMeters * Math.sin(angleRad)) / (earthRadius * Math.cos((lat * Math.PI) / 180));
                    const newLat = lat + (dLat * 180) / Math.PI;
                    const newLon = lon + (dLon * 180) / Math.PI;
                    geojsonCoords.push([newLon, newLat]);
                }
            }

            if (geojsonCoords.length === 0) {
                vertexCounts.push(0);   // no feature, but the slot must stay aligned
                continue;
            }
            // Any triangulation of a simple ring has exactly n-2 triangles, n counting
            // distinct vertices -- a property of geometry, not of glify's earcut. The
            // ring is closed by now (first == last), so distinct = length - 1.
            const distinct = geojsonCoords.length - 1;
            vertexCounts.push(Math.max(0, 3 * (distinct - 2)));

            const style = styleFor(layer, 0);
            const rgb = parseColor(style.color, "#3388ff");
            features.push({
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [geojsonCoords]
                },
                properties: {
                    layer: layer,
                    colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.fillOpacity || 0.2 }
                }
            });
        }

        if (features.length === 0) return null;

        const geojson = {
            type: "FeatureCollection",
            features: features
        };

        const glLayer = L.Layer.extend({
            onAdd: function(m) {
                this._map = m;
                this._isHovering = false;
                
                this._mapMouseMoveHandler = (e) => {
                    setTimeout(() => {
                        if (!this._isHovering) {
                            map.getContainer().style.cursor = '';
                            if (this._sharedTooltip) {
                                this._sharedTooltip.remove();
                                this._sharedTooltip = null;
                            }
                        }
                        this._isHovering = false;
                    }, 0);
                };
                m.on("mousemove", this._mapMouseMoveHandler);

                const shapeOptions = vectorTime
                    ? { vertexShaderSource: () => timeVertexShader() } : {};
                this.glShapes = L.glify.shapes({
                    ...shapeOptions,
                    map: m,
                    data: geojson,
                    pane: "polygonsPane",
                    color: (index, feature) => {
                        return feature.properties.colorRGB;
                    },
                    click: (e, feature) => {
                        registerClickMatch(map, 3, () => {
                            if (feature && feature.properties && feature.properties.layer) {
                                const layer = feature.properties.layer;
                                bindPopup(map, e.latlng, layer.properties, layer);
                                // Written bare: shinywidgets' model has no `comm`
                                // property, so gating on it silently killed this
                                // writeback under Shiny. The sidebar always wrote bare
                                // and was the one path that worked there.
                                try {
                                    model.set("clicked_layer_id", layer.id);
                                    model.set("selected_index", 0);
                                    model.save_changes();
                                } catch (err) { /* no live backend */ }
                            }
                        });
                    },
                    hover: (e, feature) => {
                        this._isHovering = true;
                        if (feature && feature.properties && feature.properties.layer) {
                            registerHoverMatch(map, 3, () => {
                                const layer = feature.properties.layer;
                                map.getContainer().style.cursor = 'pointer';
                                bindTooltip(map, e.latlng, layer.properties, layer, this);
                            });
                        }
                    }
                });
                setupGlifyProjection(this.glShapes);
                if (vectorTime) {
                    this._swiftmapTime = attachTimeToVectorInstance(this.glShapes, vectorMeta, vertexCounts);
                }
            },
            onRemove: function(m) {
                if (this._mapMouseMoveHandler) {
                    m.off("mousemove", this._mapMouseMoveHandler);
                }
                if (this.glShapes) this.glShapes.remove();
                if (this._sharedTooltip) {
                    this._sharedTooltip.remove();
                    this._sharedTooltip = null;
                }
                map.getContainer().style.cursor = '';
            }
        });
        const instance = new glLayer();
        instance.addTo(map);
        instance.layerType = type;
        return instance;
    }

    const pointsList = [];
    const indexMapping = [];

    const fallbackColor = type === "markers" ? "#e61a26" : "#3388ff";
    // glify's fallback when a layer declares no radius. Pins need far more room than a
    // circle because the glyph is drawn inside the point's own quad by the shader.
    const defaultSize = type === "markers" ? 64 : 5;

    // GPU time path: when this bucket holds time layers, every point is fed to glify and
    // per-point time rides along as vertex attributes -- the window test happens in the
    // vertex shader, so a tick costs two uniforms instead of rebuilding 5M points in JS.
    // The CPU filter below stays as the fallback when the GL wiring is unavailable.
    const gpuAttrs = gpuTimeAvailable()
        ? buildTimeAttributes(layersList, coordinateBuffers,
            timeState && timeState.period ? periodToMs(timeState.period) : null)
        : { hasTime: false };
    const gpuTime = Boolean(gpuAttrs.hasTime);

    for (const layer of layersList) {
        const colorRGB = parseColor(layer.color, fallbackColor);
        const layerSize = layer.radius != null ? Number(layer.radius) : defaultSize;

        const coordBuffer = coordinateBuffers[layer.id];
        if (!coordBuffer) {
            if (layer.location && layerInWindow(layer, coordinateBuffers, timeState)) {
                pointsList.push([layer.location[0], layer.location[1]]);
                indexMapping.push({
                    layer: layer,
                    originalIndex: 0,
                    colorRGB: colorRGB,
                    size: layerSize
                });
            }
            continue;
        }

        const coords = new Float64Array(
            coordBuffer.buffer,
            coordBuffer.byteOffset,
            coordBuffer.byteLength / 8
        );
        const count = coords.length / 2;

        const perFeature = Array.isArray(layer.feature_styles) ? layer.feature_styles : null;
        // Selection styling, applied over the layer's own and its data-driven styles.
        // Same precedence as styleFor: data, then whole-layer highlight, then per-feature.
        const highlight = layer.highlight_style || null;
        const overrides = layer.style_overrides || null;
        // The current time window, when this layer is animated. Features outside it are
        // simply not pushed; indexMapping carries originalIndex, so popups and properties
        // on the survivors keep pointing at the right rows.
        const win = !gpuTime && timeState && layer.time
            ? windowFor(timeState.tick, effectiveDuration(layer, timeState), timeState.period)
            : null;
        const times = win ? timesFor(layer, coordinateBuffers) : null;

        for (let i = 0; i < count; i++) {
            if (times && !featureInWindow(times[i * 2], times[i * 2 + 1], win)) continue;
            const fromData = perFeature ? perFeature[i] : null;
            const selected = overrides ? overrides[i] : null;
            const color = (selected && selected.color)
                || (highlight && highlight.color)
                || (fromData && fromData.color);
            const radius = selected && selected.radius != null ? selected.radius
                : highlight && highlight.radius != null ? highlight.radius
                : fromData && fromData.radius != null ? fromData.radius
                : null;

            pointsList.push([coords[i * 2], coords[i * 2 + 1]]);
            indexMapping.push({
                layer: layer,
                originalIndex: i,
                colorRGB: color ? parseColor(color, fallbackColor) : colorRGB,
                size: radius != null ? Number(radius) : layerSize
            });
        }
    }

    if (pointsList.length === 0) return null;

    const glLayer = L.Layer.extend({
        onAdd: function(m) {
            this._map = m;
            this._isHovering = false;
            
            const getInteractiveEl = () => {
                return map.getPane("pointsPane").querySelector("canvas") || map.getContainer();
            };
            
            this._mapMouseMoveHandler = (e) => {
                setTimeout(() => {
                    if (!this._isHovering) {
                        map.getContainer().style.cursor = '';
                        const el = getInteractiveEl();
                        if (el) el.style.cursor = '';
                        if (this._sharedTooltip) {
                            this._sharedTooltip.remove();
                            this._sharedTooltip = null;
                        }
                    }
                    this._isHovering = false;
                }, 0);
            };
            m.on("mousemove", this._mapMouseMoveHandler);

            const glifyOptions = {
                map: m,
                data: pointsList,
                pane: "pointsPane",
                // Resolved per point, like colour: several layers share one glify instance,
                // so a single constant here silently discarded every layer's own radius.
                size: (index) => {
                    const info = indexMapping[index];
                    return info && info.size != null ? info.size : defaultSize;
                },
                color: (index, point) => {
                    const info = indexMapping[index];
                    return info ? info.colorRGB : { r: 0.2, g: 0.5, b: 1.0 };
                },
                picking: true,
                sensitivity: type === "markers" ? 20 : 8,
                click: (e, point) => {
                    if (!point) return;

                    // Enforce a strict pixel-distance threshold to prevent popups on far away clicks
                    const clickPoint = map.latLngToContainerPoint(e.latlng);
                    const markerPoint = map.latLngToContainerPoint(L.latLng(point[0], point[1]));
                    const pixelDist = clickPoint.distanceTo(markerPoint);
                    const maxDist = type === "markers" ? 25 : 12;
                    if (pixelDist > maxDist) return;

                    registerClickMatch(map, 1, () => {
                        const idx = pointsList.indexOf(point);
                        const info = indexMapping[idx];
                        if (info) {
                            const layer = info.layer;
                            const originalIndex = info.originalIndex;
                            const props = getIndexedProperties(layer.properties, originalIndex);
                            bindPopup(map, point, props, layer);
                            try {
                                model.set("clicked_layer_id", layer.id);
                                model.set("selected_index", originalIndex);
                                model.save_changes();
                            } catch (err) { /* no live backend */ }
                        }
                    });
                },
                hover: (e, point) => {
                    this._isHovering = true;
                    if (point) {
                        // Enforce a strict pixel-distance threshold to prevent tooltips on far away hovers
                        const hoverPoint = map.latLngToContainerPoint(e.latlng);
                        const markerPoint = map.latLngToContainerPoint(L.latLng(point[0], point[1]));
                        const pixelDist = hoverPoint.distanceTo(markerPoint);
                        const maxDist = type === "markers" ? 25 : 12;
                        if (pixelDist > maxDist) return;

                        registerHoverMatch(map, 1, () => {
                            map.getContainer().style.cursor = 'pointer';
                            const el = getInteractiveEl();
                            if (el) el.style.cursor = 'pointer';
                            const idx = pointsList.indexOf(point);
                            const info = indexMapping[idx];
                            if (info) {
                                const layer = info.layer;
                                const originalIndex = info.originalIndex;
                                const props = getIndexedProperties(layer.properties, originalIndex);
                                bindTooltip(map, point, props, layer, this);
                            }
                        });
                    }
                }
            };

            if (type === "markers") {
                glifyOptions.fragmentShaderSource = () => pinShader;
            }

            if (gpuTime) {
                glifyOptions.vertexShaderSource = () => timeVertexShader();
            }
            this.glPoints = L.glify.points(glifyOptions);
            setupGlifyProjection(this.glPoints);
            if (gpuTime) {
                // Null on failure, which also flips the global flag: the next sync's
                // rebuild key changes with it and the CPU path takes over.
                this._swiftmapTime = attachTimeToInstance(this.glPoints, gpuAttrs);
            }
        },
        onRemove: function(m) {
            if (this._mapMouseMoveHandler) {
                m.off("mousemove", this._mapMouseMoveHandler);
            }
            if (this.glPoints) this.glPoints.remove();
            if (this._sharedTooltip) {
                this._sharedTooltip.remove();
                this._sharedTooltip = null;
            }
            map.getContainer().style.cursor = '';
            const canvas = map.getPane("pointsPane").querySelector("canvas");
            if (canvas) canvas.style.cursor = '';
        }
    });

    const instance = new glLayer();
    instance.addTo(map);
    instance.layerType = type;
    return instance;
}
