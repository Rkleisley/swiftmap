/*
 * Clustering's pure parts: the grid pass, the projection round trip, and the
 * badge ladder -- no GL, no DOM.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { projectClusterPoints, clusterPass, unproject, badgeClass,
         pointsInView, clusterZoomCap, clusterMetaKey } from "../src/cluster.js";
import { pointStyler } from "../src/layers.js";

function view(latlonPairs) {
    const flat = new Float64Array(latlonPairs.flat());
    return new DataView(flat.buffer);
}

// Two tight knots of three, and one loner far east.
const KNOT_A = [[36.010, -5.310], [36.011, -5.311], [36.012, -5.309]];
const KNOT_B = [[36.010, -5.250], [36.011, -5.251], [36.012, -5.249]];
const LONER = [[36.010, -5.000]];
const ALL = [...KNOT_A, ...KNOT_B, ...LONER];

test("knots collapse and the loner stands alone", () => {
    // Zoom 12: a 60px cell spans ~0.015 world units, wider than each knot's
    // spread and narrower than the gap between them.
    const points = projectClusterPoints(view(ALL));
    const { clusters, singles } = clusterPass(points, 12, 60, null);
    // Grid semantics: a knot may straddle a cell edge (markercluster's grid
    // does the same), so the contract is invariants, not an exact split.
    const clustered = clusters.reduce((a, c) => a + c.count, 0);
    assert.equal(clustered + singles.length, 7, "every point is accounted for");
    assert.ok(clusters.length >= 2, "each knot produces at least one cluster");
    assert.ok(clusters.every(c => c.count >= 2));
    assert.ok(singles.includes(6), "the loner is a single, by original index");
});

test("zoomed far in, everything stands alone", () => {
    const points = projectClusterPoints(view(ALL));
    const { clusters, singles } = clusterPass(points, 22, 60, null);
    assert.equal(clusters.length, 0);
    assert.equal(singles.length, 7);
});

test("the viewport bounds the work: out-of-view points do not participate", () => {
    const points = projectClusterPoints(view(ALL));
    const west = {
        minX: points.xs[0] - 0.001, maxX: points.xs[2] + 0.001,
        minY: points.ys[2] - 0.001, maxY: points.ys[0] + 0.001,
    };
    const { clusters, singles } = clusterPass(points, 10, 60, west);
    assert.equal(clusters.length, 1, "only knot A is in view");
    assert.equal(singles.length, 0);
});

test("a cluster badge lands at its members' mean, and unproject inverts", () => {
    const points = projectClusterPoints(view(KNOT_A));
    const { clusters } = clusterPass(points, 10, 60, null);
    const [lat, lon] = unproject(clusters[0].x, clusters[0].y);
    assert.ok(Math.abs(lat - 36.011) < 0.002);
    assert.ok(Math.abs(lon + 5.310) < 0.002);
});

test("the badge ladder is markercluster's familiar one", () => {
    assert.equal(badgeClass(5), "swiftmap-cluster-small");
    assert.equal(badgeClass(100), "swiftmap-cluster-medium");
    assert.equal(badgeClass(1000), "swiftmap-cluster-large");
});


test("coincident points never split by grid, so dissolution must not need them to", () => {
    // Repeated pings at ONE position share a cell at every zoom -- the reason
    // clustering now dissolves at the map's max zoom instead of relying on
    // the grid to separate them.
    const same = projectClusterPoints(view([[36.01, -5.31], [36.01, -5.31], [36.01, -5.31]]));
    const deep = clusterPass(same, 22, 60, null);
    assert.equal(deep.clusters.length, 1, "the grid alone badges them forever");
    assert.deepEqual(pointsInView(same, null), [0, 1, 2],
        "the dissolved state is every point, coincident or not");
});

test("pointsInView culls to the view and keeps original indices", () => {
    const pts = projectClusterPoints(view(ALL));
    const a = pts.xs[0];
    const only = pointsInView(pts, { minX: a - 0.001, maxX: a + 0.001,
                                     minY: -Infinity, maxY: Infinity });
    assert.ok(only.includes(0) && !only.includes(6), "the loner far east is out");
});

test("the zoom cap is the map's own max zoom, 18 when unbounded", () => {
    assert.equal(clusterZoomCap({ getMaxZoom: () => 22 }), 22);
    assert.equal(clusterZoomCap({ getMaxZoom: () => Infinity }), 18);
});

test("singles take the SAME styling as unclustered points", () => {
    // The singles once colored themselves with a hex STRING (glify reads
    // .r/.g/.b off it: black), sized themselves on their own default, and
    // ignored the radii buffer. pointStyler is now the one source of truth.
    const layer = { id: "c", color: "#ff0000", radius: 7 };
    const style = pointStyler(layer, {}, "circle_markers")(0);
    assert.equal(typeof style.colorRGB, "object", "an {r,g,b} object, never a string");
    assert.ok(style.colorRGB.r > 0.99 && style.colorRGB.g < 0.01, "red stays red");
    assert.equal(style.size, 7);
    const radii = new Float32Array([3, 11]);
    const sized = pointStyler({ id: "c" }, { "c::radii": new DataView(radii.buffer) },
                              "circle_markers");
    assert.equal(sized(1).size, 11, "radius_col's buffer reaches the singles");
    const pin = pointStyler({ id: "m" }, {}, "markers")(0);
    assert.equal(pin.size, 64, "pins keep the pin quad's room");
});

test("selection styling invalidates a clustered layer's instance", () => {
    const base = { cluster_radius: 60, color: "#3388ff" };
    assert.notEqual(clusterMetaKey(base),
        clusterMetaKey({ ...base, style_overrides: { 2: { color: "#f00" } } }),
        "select() on a clustered layer must repaint, not just land in state");
    assert.notEqual(clusterMetaKey(base),
        clusterMetaKey({ ...base, highlight_style: { color: "#f00" } }));
});
