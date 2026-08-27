/*
 * Clustering's pure parts: the grid pass, the projection round trip, and the
 * badge ladder -- no GL, no DOM.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { projectClusterPoints, clusterPass, unproject, badgeClass }
    from "../src/cluster.js";

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
