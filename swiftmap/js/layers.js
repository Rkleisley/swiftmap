import { loadJS, bindPopup, bindTooltip, parseColor } from "./utils.js";
import { pinShader } from "./shaders.js";

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

function getIndexedProperties(properties, index) {
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
            if (sub.type === "circle_markers" || sub.type === "markers" || sub.type === "polyline" || sub.type === "polygon" || sub.type === "circle" || sub.type === "geojson") {
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

export async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, model) {
    if (type === "polyline") {
        const features = [];
        for (const layer of layersList) {
            const geojsonCoords = layer.locations.map(c => [c[1], c[0]]);
            const rgb = parseColor(layer.color, "#3388ff");
            features.push({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: geojsonCoords
                },
                properties: {
                    layer: layer,
                    colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: layer.opacity || 1.0 },
                    weight: layer.weight || 3
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

                this.glLines = L.glify.lines({
                    map: m,
                    data: geojson,
                    pane: "polylinesPane",
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
                                model.set("clicked_layer_id", layer.id);
                                model.set("selected_index", 0);
                                model.save_changes();
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
        for (const layer of layersList) {
            let geojsonCoords = [];
            if (layer.type === "polygon") {
                geojsonCoords = layer.locations.map(c => [c[1], c[0]]);
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

            if (geojsonCoords.length === 0) continue;

            const rgb = parseColor(layer.color, "#3388ff");
            features.push({
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [geojsonCoords]
                },
                properties: {
                    layer: layer,
                    colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: layer.fillOpacity || 0.2 }
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

                this.glShapes = L.glify.shapes({
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
                                model.set("clicked_layer_id", layer.id);
                                model.set("selected_index", 0);
                                model.save_changes();
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

    for (const layer of layersList) {
        const colorRGB = parseColor(layer.color, type === "markers" ? "#e61a26" : "#3388ff");

        const coordBuffer = coordinateBuffers[layer.id];
        if (!coordBuffer) {
            if (layer.location) {
                pointsList.push([layer.location[0], layer.location[1]]);
                indexMapping.push({
                    layer: layer,
                    originalIndex: 0,
                    colorRGB: colorRGB
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

        for (let i = 0; i < count; i++) {
            pointsList.push([coords[i * 2], coords[i * 2 + 1]]);
            indexMapping.push({
                layer: layer,
                originalIndex: i,
                colorRGB: colorRGB
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
                size: type === "markers" ? 64 : 5,
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
                            model.set("clicked_layer_id", layer.id);
                            model.set("selected_index", originalIndex);
                            model.save_changes();
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

            this.glPoints = L.glify.points(glifyOptions);
            setupGlifyProjection(this.glPoints);
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
