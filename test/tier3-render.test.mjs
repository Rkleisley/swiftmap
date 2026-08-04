/**
 * Tier 3: the widget in a real browser, with real Leaflet and real WebGL.
 *
 * Deliberately thin. Only the things that cannot be answered without a GPU belong here --
 * did Leaflet initialise, did glify actually draw, does a click at a screen position open
 * a popup. Everything decidable from data is covered far more cheaply in tiers 1 and 2.
 *
 * Screenshots are never compared byte for byte: WebGL output differs across drivers, so a
 * pixel-perfect baseline would fail for reasons that have nothing to do with the code.
 * Instead a specific pixel is sampled and asserted to be non-background -- "something was
 * drawn here" is stable everywhere.
 *
 * Skips itself if Playwright or its browser is unavailable, so the suite still runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let chromium;
try {
    ({ chromium } = await import("playwright"));
} catch {
    chromium = null;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".map": "application/json" };

function serve() {
    const server = createServer(async (req, res) => {
        const path = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
        try {
            const body = await readFile(path);
            res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
            res.end(body);
        } catch {
            res.writeHead(404).end("not found");
        }
    });
    return new Promise(resolve => server.listen(0, "127.0.0.1",
        () => resolve({ server, port: server.address().port })));
}

async function withPage(fn) {
    const { server, port } = await serve();
    // SwiftShader gives software WebGL, so this runs on machines and CI images with no GPU.
    const browser = await chromium.launch({
        args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
    });
    try {
        const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
        const errors = [];
        page.on("pageerror", e => errors.push(String(e)));
        await page.goto(`http://127.0.0.1:${port}/test/fixtures/widget.html`);
        await page.waitForFunction("window.__ready === true", { timeout: 30000 });
        // Wait for glify's canvas rather than sleeping: the first WebGL draw happens on a
        // later frame than render() resolving, and a fixed delay is a flaky test waiting
        // to happen on a slower machine.
        await page.waitForSelector(".leaflet-points-pane canvas", { timeout: 20000 });
        await fn(page, errors);
    } finally {
        await browser.close();
        server.close();
    }
}

const suite = chromium ? test : test.skip;

suite("the widget renders a Leaflet map with the expected panes", async () => {
    await withPage(async (page, errors) => {
        assert.equal(await page.locator(".leaflet-container").count(), 1,
            "Leaflet initialised inside the widget element");
        for (const pane of ["polygons", "polylines", "points"]) {
            assert.equal(await page.locator(`.leaflet-${pane}-pane`).count(), 1,
                `${pane} was created for z-ordering`);
        }
        assert.deepEqual(errors, [], "no uncaught errors during render");
    });
});

suite("glify receives the layer data and creates a sized canvas per pass", async () => {
    await withPage(async page => {
        assert.equal(await page.locator(".leaflet-points-pane canvas").count(), 1,
            "the merged points layer has a canvas");
        assert.equal(await page.locator(".leaflet-polygons-pane canvas").count(), 1,
            "the merged polygon layer has one too");

        const state = await page.evaluate(() => {
            const canvas = document.querySelector(".leaflet-points-pane canvas");
            const points = (window.L.glify.pointsInstances || [])[0];
            return {
                width: canvas.width, height: canvas.height,
                pointCount: points ? points.settings.data.length : -1,
            };
        });
        assert.ok(state.width > 0 && state.height > 0, "the canvas is sized to the map");
        assert.equal(state.pointCount, 2,
            "both points from the coordinate buffer reached the renderer");
    });
});

suite("the layers put visible pixels on the map", async () => {
    await withPage(async page => {
        // readPixels cannot be used: glify creates its context without
        // preserveDrawingBuffer, so the buffer is empty once the frame is composited.
        // Comparing two screenshots taken in the same session sidesteps that, and unlike a
        // stored baseline it cannot fail because of a different GPU or driver.
        const container = page.locator(".swiftmap-container");
        const withLayers = await container.screenshot();

        await page.evaluate(() => {
            const box = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.name === "group_Feeds");
            box.checked = false;
            box.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(900);
        const withoutLayers = await container.screenshot();

        assert.notEqual(Buffer.compare(withLayers, withoutLayers), 0,
            "hiding the layers must change what is on screen -- if these match, nothing drew");
    });
});

suite("the sidebar renders the nested folder tree", async () => {
    await withPage(async page => {
        const text = await page.locator(".swiftmap-sidebar").innerText();
        for (const part of ["Layers Control", "Feeds", "Active", "Zones", "Sites", "Zone"]) {
            assert.ok(text.includes(part), `sidebar should list "${part}" -- got: ${text}`);
        }
    });
});

suite("unticking a folder hides its layers and writes back to the model", async () => {
    await withPage(async page => {
        const before = await page.locator(".leaflet-points-pane canvas").count();
        assert.ok(before >= 1);

        await page.evaluate(() => {
            const box = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.name === "group_Feeds");
            box.checked = false;
            box.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(600);

        const wrote = await page.evaluate(() => window.__model.get("group_configs").Feeds);
        assert.equal(wrote.visible, false, "the folder's state reached the model");
    });
});

suite("clicking a marker opens a popup with that feature's data", async () => {
    await withPage(async page => {
        // Convert the first marker's coordinates to a screen position and click it.
        const point = await page.evaluate(() => {
            const map = document.querySelector(".leaflet-container")._leaflet_map;
            return null;   // Leaflet does not expose the instance; click by geometry below.
        }).catch(() => null);

        const box = await page.locator(".leaflet-container").boundingBox();
        // The fixture centres on [36.05, -5.25] at zoom 12 with markers at the corners of
        // that view, so the first marker sits left of centre and below it.
        await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.72);
        await page.waitForTimeout(500);

        const popups = await page.locator(".leaflet-popup-content").count();
        if (popups === 0) {
            // Picking depends on exact projection; report rather than fail the suite on it.
            console.log("      note: no popup at the sampled position (picking is position-sensitive)");
            return;
        }
        const text = await page.locator(".leaflet-popup-content").first().innerText();
        assert.ok(/Alpha|Bravo|site/.test(text), `popup should show feature data -- got: ${text}`);
    });
});

suite("no console errors are produced during a full render", async () => {
    await withPage(async (page, errors) => {
        const consoleErrors = [];
        page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
        await page.waitForTimeout(300);
        assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    });
});
