/*
 * The hex heat kernel's pure parts: fan triangulation, the visible-extremes
 * scan, and the recolour rule -- the arithmetic behind "three hexes in view
 * span the whole ramp", tested away from any GL context.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { projectHexCells, hexVisibleExtremes, hexCellColors }
    from "../src/heat.js";
import { COLORMAPS } from "../src/colormaps.js";

function viewOf(rings) {
    const flat = new Float64Array(rings.flat(2));
    return new DataView(flat.buffer);
}

// Two square "cells" (any convex ring works; H3 never enters the renderer),
// one around lat/lon 36/-5.3, one far north.
const CELL_A = [[36.00, -5.31], [36.00, -5.29], [36.02, -5.29], [36.02, -5.31]];
const CELL_B = [[46.00, -5.31], [46.00, -5.29], [46.02, -5.29], [46.02, -5.31]];

test("fan triangulation: n-vertex convex cells become n-2 triangles each", () => {
    const projected = projectHexCells(viewOf([CELL_A, CELL_B]), [4, 4], null, null);
    assert.equal(projected.count, 2);
    assert.equal(projected.vertCount, 2 * (4 - 2) * 3);
    assert.equal(projected.tris.length, projected.vertCount * 2);
    // The first vertex anchors the offsets: exactly zero, no float residue.
    assert.equal(projected.tris[0], 0);
    assert.equal(projected.tris[1], 0);
    assert.equal(projected.cellTriVerts[0], 6);
});

test("bounding boxes land in offset space, one per cell", () => {
    const projected = projectHexCells(viewOf([CELL_A, CELL_B]), [4, 4], null, null);
    assert.equal(projected.bboxes.length, 8);
    const [minX, minY, maxX, maxY] = projected.bboxes.slice(0, 4);
    assert.ok(minX <= 0 && minY <= 0 && maxX >= 0 && maxY >= 0,
        "cell A's box contains the anchor (its own first vertex)");
    assert.ok(projected.bboxes[5] < minY,
        "cell B sits north of cell A, which is a smaller mercator y");
});

test("visible extremes scan only the cells whose boxes touch the view", () => {
    const projected = projectHexCells(viewOf([CELL_A, CELL_B]), [4, 4], null, null);
    const values = new Float64Array([2, 40]);
    const both = hexVisibleExtremes(projected.bboxes, values,
        { minX: -100, maxX: 100, minY: -100, maxY: 100 });
    assert.deepEqual(both, { lo: 2, hi: 40 });

    const aBox = projected.bboxes.slice(0, 4);
    const onlyA = hexVisibleExtremes(projected.bboxes, values,
        { minX: aBox[0], maxX: aBox[2], minY: aBox[1], maxY: aBox[3] });
    assert.deepEqual(onlyA, { lo: 2, hi: 2 },
        "a view holding one cell normalises to that cell alone");
});

test("a view touching no cell keeps the whole dataset's scale", () => {
    const projected = projectHexCells(viewOf([CELL_A, CELL_B]), [4, 4], null, null);
    const values = new Float64Array([2, 40]);
    const nowhere = hexVisibleExtremes(projected.bboxes, values,
        { minX: 500, maxX: 501, minY: 500, maxY: 501 });
    assert.deepEqual(nowhere, { lo: 2, hi: 40 });
});

test("recolour: extremes span the ramp, and a lone cell takes the top", () => {
    const anchors = COLORMAPS.viridis;
    const spread = hexCellColors(new Float64Array([2, 21, 40]), anchors, 2, 40);
    const bottom = hexCellColors([0], anchors, 0, 1);       // t = 0 reference
    const top = hexCellColors([1], anchors, 0, 1);          // t = 1 reference
    assert.deepEqual([...spread.subarray(0, 4)], [...bottom.subarray(0, 4)],
        "the view's minimum takes the bottom of the ramp");
    assert.deepEqual([...spread.subarray(8, 12)], [...top.subarray(0, 4)],
        "the view's maximum takes the top");

    const lone = hexCellColors(new Float64Array([7]), anchors, 7, 7);
    assert.deepEqual([...lone.subarray(0, 4)], [...top.subarray(0, 4)],
        "alone on screen, a cell is its own maximum");
});
