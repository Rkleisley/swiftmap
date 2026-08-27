// Marker clustering: the folium question, answered at swiftmap scale.
//
// Leaflet.markercluster is DOM markers all the way down and dies exactly
// where swiftmap lives, so this is the GL-era shape of the same idea: grid
// clustering over the binary coordinate buffer, DOM badges only for the
// CLUSTERS (there are never many on screen), and one glify points instance
// for the unclustered singles -- whose population is bounded by the viewport,
// because clustering runs over the points in view. Zoomed out, a million
// points collapse into a handful of badges; zoomed in, the viewport holds
// few points and most stand alone. Reclustering happens on zoomend/moveend,
// never per frame: panning moves badges through Leaflet's own pane transform.
import { L } from "./libs.js";
import { mercatorX, mercatorY } from "./heat.js";
import { getIndexedProperties } from "./layers.js";
import { bindPopup } from "./utils.js";

// Points as mercator zoom-0 coordinates, built once per layer from the same
// float64 buffer everything else reads.
export function projectClusterPoints(latlonView) {
    const f64 = new Float64Array(
        latlonView.buffer, latlonView.byteOffset, latlonView.byteLength / 8);
    const n = f64.length / 2;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        xs[i] = mercatorX(f64[i * 2 + 1]);
        ys[i] = mercatorY(f64[i * 2]);
    }
    return { xs, ys, count: n };
}

// One clustering pass: the in-view points binned on a grid whose cell is the
// cluster radius at the CURRENT zoom. Returns clusters (count > 1, centred on
// their members' mean) and the surviving singles' original indices. Pure and
// O(points in view), so a million-point layer pays for what the viewport
// holds, not for what the layer holds -- except zoomed far out, where the
// full pass is one Map insert per point and the output is a handful of cells.
export function clusterPass(points, zoom, radiusPx, view) {
    // The zoom-0 world is 256 units across and 256 * 2^z pixels across, so one
    // world unit is 2^z pixels: the radius in pixels over 2^z is the cell.
    const cell = radiusPx / Math.pow(2, zoom);
    const cells = new Map();
    const singles = [];
    const { xs, ys, count } = points;
    for (let i = 0; i < count; i++) {
        const x = xs[i], y = ys[i];
        if (view && (x < view.minX || x > view.maxX
                || y < view.minY || y > view.maxY)) continue;
        const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
        const bucket = cells.get(key);
        if (bucket) {
            bucket.count++;
            bucket.sumX += x;
            bucket.sumY += y;
            if (x < bucket.minX) bucket.minX = x;
            if (x > bucket.maxX) bucket.maxX = x;
            if (y < bucket.minY) bucket.minY = y;
            if (y > bucket.maxY) bucket.maxY = y;
            bucket.first = bucket.first;   // the single's index no longer matters
        } else {
            cells.set(key, { count: 1, sumX: x, sumY: y,
                             minX: x, maxX: x, minY: y, maxY: y, first: i });
        }
    }
    const clusters = [];
    for (const b of cells.values()) {
        if (b.count === 1) {
            singles.push(b.first);
        } else {
            clusters.push({ count: b.count,
                            x: b.sumX / b.count, y: b.sumY / b.count,
                            minX: b.minX, maxX: b.maxX,
                            minY: b.minY, maxY: b.maxY });
        }
    }
    return { clusters, singles };
}

// Inverse of the zoom-0 mercator projection, for placing badges.
export function unproject(x, y) {
    const lon = (x / 256 - 0.5) * 360;
    const n = Math.PI - 2 * Math.PI * (y / 256);
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return [lat, lon];
}

// glify arms a redraw frame that outlives remove(): a retired singles
// instance must have it cancelled, or the late frame draws into a torn-down
// canvas overlay (retireGl's lesson, applied here).
function retireSingles(glInstance) {
    if (!glInstance) return;
    const overlay = glInstance.layer;
    if (overlay && overlay._frame != null) {
        L.Util.cancelAnimFrame(overlay._frame);
        overlay._frame = null;
    }
    glInstance.remove();
}

// Badge size class by count, markercluster's familiar ladder.
export function badgeClass(count) {
    return count >= 1000 ? "swiftmap-cluster-large"
        : count >= 100 ? "swiftmap-cluster-medium" : "swiftmap-cluster-small";
}

function formatCount(count) {
    return count >= 10000 ? `${Math.round(count / 1000)}k` : String(count);
}

// The Leaflet layer for one clustered point layer: badges in a layerGroup,
// singles on their own glify points instance, both rebuilt on zoom/pan end.
export function createClusterLayer(layer, latlonView, coordinateBuffers, onFeatureClick) {
    const radiusPx = layer.cluster_radius || 60;
    const maxZoom = layer.cluster_max_zoom ?? null;
    const points = projectClusterPoints(latlonView);
    const f64 = new Float64Array(
        latlonView.buffer, latlonView.byteOffset, latlonView.byteLength / 8);
    const colorsView = coordinateBuffers[`${layer.id}::colors`] || null;
    const colors = colorsView
        ? new Uint8Array(colorsView.buffer, colorsView.byteOffset, colorsView.byteLength)
        : null;

    const ClusterLayer = L.Layer.extend({
        onAdd(map) {
            this._map = map;
            this._badges = L.layerGroup().addTo(map);
            map.on("zoomend moveend", this._recluster, this);
            this._recluster();
            return this;
        },
        onRemove(map) {
            map.off("zoomend moveend", this._recluster, this);
            if (this._badges) this._badges.remove();
            this._badges = null;
            if (this.glSingles) {
                retireSingles(this.glSingles);
                this.glSingles = null;
            }
            return this;
        },

        _view() {
            const b = this._map.getBounds().pad(0.2);
            return {
                minX: mercatorX(b.getWest()), maxX: mercatorX(b.getEast()),
                minY: mercatorY(b.getNorth()), maxY: mercatorY(b.getSouth()),
            };
        },

        _recluster() {
            const map = this._map;
            if (!map) return;
            const zoom = map.getZoom();
            const past = maxZoom != null && zoom > maxZoom;
            const { clusters, singles } = clusterPass(
                points, zoom, past ? 0.0001 : radiusPx, this._view());

            this._badges.clearLayers();
            for (const c of clusters) {
                const [lat, lon] = unproject(c.x, c.y);
                const marker = L.marker([lat, lon], {
                    icon: L.divIcon({
                        className: `swiftmap-cluster ${badgeClass(c.count)}`,
                        html: `<span>${formatCount(c.count)}</span>`,
                        iconSize: null,
                    }),
                    keyboard: false,
                });
                // A badge click frames its members: the classic gesture.
                marker.on("click", () => {
                    const [south, west] = unproject(c.minX, c.maxY);
                    const [north, east] = unproject(c.maxX, c.minY);
                    map.fitBounds([[south, west], [north, east]],
                                  { padding: [40, 40], maxZoom: 18 });
                });
                this._badges.addLayer(marker);
            }

            if (this.glSingles) {
                retireSingles(this.glSingles);
                this.glSingles = null;
            }
            if (singles.length) {
                const data = singles.map(i => [f64[i * 2], f64[i * 2 + 1]]);
                // Identity map, not indexOf: the hover fix's lesson, applied
                // before this instance can relearn it.
                const dataIndex = new Map(data.map((p, k) => [p, k]));
                const fallback = layer.color || "#3388ff";
                this.glSingles = L.glify.points({
                    map,
                    data,
                    size: () => (layer.radius != null ? Number(layer.radius) : 6),
                    color: (k) => {
                        const i = singles[k];
                        if (colors && colors.length >= (i + 1) * 4) {
                            return { r: colors[i * 4] / 255, g: colors[i * 4 + 1] / 255,
                                     b: colors[i * 4 + 2] / 255, a: colors[i * 4 + 3] / 255 };
                        }
                        return fallback;
                    },
                    click: (e, point) => {
                        const k = dataIndex.get(point) ?? -1;
                        if (k < 0) return;
                        const original = singles[k];
                        const props = getIndexedProperties(layer.properties, original);
                        bindPopup(map, point, props, layer);
                        if (onFeatureClick) {
                            onFeatureClick({ layer, index: original,
                                             latlng: [point[0], point[1]] });
                        }
                    },
                });
            }
        },
    });
    return new ClusterLayer();
}

// Everything a cluster instance bakes besides the buffers: recreate on change,
// the image/heat pattern.
export function clusterMetaKey(layer) {
    return JSON.stringify([layer.cluster_radius || 60, layer.cluster_max_zoom ?? null,
        layer.radius ?? null, layer.color || null]);
}
