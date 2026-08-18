// Permanent feature labels: text pinned to the map, from a layer's `label` (one
// vector feature) or `labels` (one per point, aligned with the coordinate buffer).
// DOM elements by design -- Leaflet permanent tooltips -- which is why they are for
// site-scale layers; Python warns past a thousand. Model-free like the legend: pure
// data in, Leaflet layers out, re-derived each sync so labels follow visibility
// without touching the GL buckets or their meta keys.

import { isLayerEffectiveVisible } from "./map.js";
import { vectorCoords } from "./layers.js";

// One anchor per labelled feature. Points label at the point; a line labels at its
// middle vertex (on the line, not floating in its bounding box); a polygon or
// circle labels at its bounds centre.
export function collectLabels(layers, buffers, groupConfigs) {
    const out = [];
    for (const layer of layers || []) {
        if (!isLayerEffectiveVisible(layer, groupConfigs || {})) continue;
        if (layer.type === "group") {
            out.push(...collectLabels(layer.layers || [], buffers, groupConfigs));
            continue;
        }
        if (Array.isArray(layer.labels)) {
            const raw = buffers && buffers[layer.id];
            if (!raw) continue;
            const coords = new Float64Array(raw.buffer || raw, raw.byteOffset || 0,
                (raw.byteLength || raw.length) / 8);
            const count = Math.min(layer.labels.length, coords.length / 2);
            for (let i = 0; i < count; i++) {
                if (layer.labels[i]) {
                    out.push({ lat: coords[i * 2], lng: coords[i * 2 + 1],
                               text: String(layer.labels[i]), center: false });
                }
            }
        } else if (layer.label) {
            if (layer.type === "polyline") {
                const locs = vectorCoords(layer, buffers || {}) || [];
                if (locs.length === 0) continue;
                const mid = locs[Math.floor((locs.length - 1) / 2)];
                out.push({ lat: mid[0], lng: mid[1],
                           text: String(layer.label), center: false });
            } else if (layer.bounds) {
                const [[aLat, aLon], [bLat, bLon]] = layer.bounds;
                out.push({ lat: (aLat + bLat) / 2, lng: (aLon + bLon) / 2,
                           text: String(layer.label), center: true });
            } else if (layer.location) {
                out.push({ lat: layer.location[0], lng: layer.location[1],
                           text: String(layer.label), center: true });
            }
        }
    }
    return out;
}

// Rebuilds `group` (an L.layerGroup) to hold exactly the current labels, skipping
// the work when nothing changed -- syncs run on every toggle and tick.
export function renderLabels(L, group, layers, buffers, groupConfigs) {
    const labels = collectLabels(layers, buffers, groupConfigs);
    const key = JSON.stringify(labels);
    if (group._swiftmapLabelKey === key) return;
    group._swiftmapLabelKey = key;
    group.clearLayers();
    for (const item of labels) {
        // Content as an element with textContent: tooltip string content is HTML,
        // and labels come from user data, which must never parse as markup.
        const span = document.createElement("span");
        span.textContent = item.text;
        const tooltip = L.tooltip({
            permanent: true,
            direction: item.center ? "center" : "top",
            className: "swiftmap-feature-label",
            offset: item.center ? [0, 0] : [0, -6],
        }).setLatLng([item.lat, item.lng]).setContent(span);
        group.addLayer(tooltip);
    }
}
