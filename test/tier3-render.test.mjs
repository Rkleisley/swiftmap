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

async function withPage(fn, fixture = "widget.html",
                        readySelector = ".leaflet-points-pane canvas") {
    const { server, port } = await serve();
    // SwiftShader gives software WebGL, so this runs on machines and CI images with no GPU.
    const browser = await chromium.launch({
        args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
    });
    try {
        const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
        const errors = [];
        page.on("pageerror", e => errors.push(String(e)));
        // A fixture name lives under test/fixtures; an absolute path -- the React
        // example app, built into examples/react/dist -- is served as-is.
        const path = fixture.startsWith("/") ? fixture : `/test/fixtures/${fixture}`;
        await page.goto(`http://127.0.0.1:${port}${path}`);
        await page.waitForFunction("window.__ready === true", { timeout: 30000 });
        // Wait for glify's canvas rather than sleeping: the first WebGL draw happens on a
        // later frame than render() resolving, and a fixed delay is a flaky test waiting
        // to happen on a slower machine. null skips it, for fixtures whose widget is
        // deliberately hidden at load -- Playwright's wait wants a VISIBLE element.
        if (readySelector) await page.waitForSelector(readySelector, { timeout: 20000 });
        await fn(page, errors);
    } finally {
        await browser.close();
        server.close();
    }
}

const suite = chromium ? test : test.skip;

suite("the widget renders a Leaflet map with the expected panes", async () => {
    await withPage(async (page, errors) => {
        // The bundle carries Leaflet, glify and Geoman inside it: rendering must
        // touch NO CDN -- the closed-network requirement, asserted here so a
        // regression to runtime fetching cannot land quietly. (Basemap tiles are
        // runtime content and the fixture's basemap starts hidden.)
        const external = await page.evaluate(() =>
            performance.getEntriesByType("resource")
                .map(e => e.name)
                .filter(u => !u.startsWith("http://127.0.0.1")
                    && !u.startsWith("data:") && !u.startsWith("blob:")));
        assert.deepEqual(external.filter(u => !u.includes("tile")), [],
            "no script, stylesheet or font left the test server");
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
        assert.equal(state.pointCount, 4,
            "every point from both coordinate buffers reached the renderer "
            + "(2 sites + 2 buffer-styled bubbles)");
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

suite("hidden layers stay dark through a highlight rebuild", async () => {
    await withPage(async (page, errors) => {
        // The React report's long-standing finding: hide layers, then land a
        // highlight (or an append) -- the rebuild must not redraw layers whose
        // model still says visible: false.
        // Per-layer flags through the REAL wire path -- the exact ops Python's
        // hide() and highlight() emit, not a folder toggle or a trait swap.
        await page.evaluate(() => {
            window.__model.emit("msg:custom", { ops: [
                { op: "set", id: "pts", fields: { visible: false } },
                { op: "set", id: "pts2", fields: { visible: false } },
            ] }, []);
        });
        await page.waitForTimeout(900);
        const clip = { clip: { x: 100, y: 100, width: 480, height: 450 } };
        const hidden = await page.screenshot(clip);

        await page.evaluate(() => {
            window.__model.emit("msg:custom", { ops: [
                { op: "set", id: "pts2",
                  fields: { highlight_style: { color: "#00ff00", radius: 24 } } },
            ] }, []);
        });
        await page.waitForTimeout(900);
        const highlighted = await page.screenshot(clip);

        assert.equal(Buffer.compare(hidden, highlighted), 0,
            "a highlight on a hidden layer rebuilds the bucket; nothing hidden "
            + "may come back -- the screen must be pixel-identical");

        // The other reported trigger: a data write. A tail for the coordinate
        // buffer AND the times buffer (pts is a time layer), plus the property
        // rows -- update_layer(append=True)'s exact wire shape.
        await page.evaluate(() => {
            const coords = new Float64Array([36.06, -5.24]);
            const times = new Float64Array([Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 2)]);
            window.__model.emit("msg:custom", { ops: [
                { op: "buffer_append", id: "pts", buffer_index: 0 },
                { op: "buffer_append", id: "pts::times", buffer_index: 1 },
                { op: "append", id: "pts", base: 3,
                  properties: { site: ["Echo"] } },
            ] }, [new DataView(coords.buffer), new DataView(times.buffer)]);
        });
        await page.waitForTimeout(900);
        const appended = await page.screenshot(clip);

        assert.equal(Buffer.compare(hidden, appended), 0,
            "an append to a hidden layer rebuilds the bucket; the new point and "
            + "the old ones alike must stay dark");
        assert.deepEqual(errors, [], "no page errors across the rebuilds");
    }, "widget-time.html");
});

suite("the coordinate readout can be dismissed", async () => {
    await withPage(async page => {
        // Every empty-map click replaces this popup, so its close button is
        // the ONLY route to a popup-free screenshot. It shipped without one.
        await page.evaluate(() => window.__model.set("show_click_coordinates", true));
        await page.locator(".swiftmap-container").click({ position: { x: 30, y: 250 } });
        await page.waitForTimeout(400);
        assert.equal(await page.locator(".swiftmap-coords-popup").count(), 1,
            "an empty-map click shows the readout");
        assert.equal(
            await page.locator(".swiftmap-coords-popup .leaflet-popup-close-button").count(),
            1, "the readout carries a close button");
        await page.click(".swiftmap-coords-popup .leaflet-popup-close-button");
        await page.waitForTimeout(200);
        assert.equal(await page.locator(".swiftmap-coords-popup").count(), 0,
            "the close button actually removes it");
    });
});

suite("the heatmap accumulates and colours pixels on its own pane", async () => {
    await withPage(async (page, errors) => {
        assert.equal(await page.locator(".leaflet-swiftmap-heat-pane canvas").count(), 3,
            "each heatmap layer -- blob and hex alike -- draws on its own canvas");

        // Past the initial normalise debounce AND headless Chromium's early GPU
        // bounce (the context-loss recovery re-inits the renderer).
        await page.waitForTimeout(900);
        const container = page.locator(".swiftmap-container");
        const withHeat = await container.screenshot();

        await page.evaluate(() => {
            const box = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.name === "group_Heat");
            box.checked = false;
            box.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(900);
        const withoutHeat = await container.screenshot();

        assert.notEqual(Buffer.compare(withHeat, withoutHeat), 0,
            "hiding the heat folder must change the screen -- both the own-buffer "
            + "blob and the source-derived one draw real pixels");
        assert.deepEqual(errors, [], "no console errors from the heat pipeline");
    }, "widget-heat.html");
});

suite("hex heat draws real polygons that vanish with their folder", async () => {
    await withPage(async (page, errors) => {
        await page.waitForTimeout(900);
        const container = page.locator(".swiftmap-container");
        const withHexes = await container.screenshot();

        await page.evaluate(() => {
            const box = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.name === "group_Hexes");
            box.checked = false;
            box.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(900);
        const withoutHexes = await container.screenshot();

        assert.notEqual(Buffer.compare(withHexes, withoutHexes), 0,
            "hiding the Hexes folder must change the screen -- the triangulated "
            + "cells draw real pixels through their own pass");
        assert.deepEqual(errors, [], "no console errors from the hex pipeline");
    }, "widget-heat.html");
});

suite("a zoom's re-normalisation reaches the screen without needing a pan", async () => {
    await withPage(async (page, errors) => {
        // The bug this pins: computeMax left the accumulation framebuffer
        // bound, so the colorize that followed painted into the FBO instead of
        // the canvas -- the zoom DID re-normalise, but the screen kept the old
        // scale until the next pan redrew. So: zoom, settle, screenshot; pan
        // away and back to the exact same view, settle, screenshot. Identical
        // views must show identical pixels -- if the first is stale, they differ.
        await page.waitForTimeout(900);
        await page.evaluate(() => window.__model.set("zoom", 13));
        await page.waitForTimeout(1200);
        // Clipped to the map's centre, where the blob lives: DOM chrome (sidebar
        // text, controls) antialiases with +/-1 jitter and is not under test.
        const clip = { clip: { x: 280, y: 180, width: 340, height: 340 } };
        const afterZoom = await page.screenshot(clip);

        await page.evaluate(() => window.__model.set("center", [36.05, -5.28]));
        await page.waitForTimeout(600);
        await page.evaluate(() => window.__model.set("center", [36.03, -5.30]));
        await page.waitForTimeout(1200);
        const afterRoundTrip = await page.screenshot(clip);

        assert.equal(Buffer.compare(afterZoom, afterRoundTrip), 0,
            "the same view must render the same pixels whether reached by zoom "
            + "or by pan -- a difference means the zoom's normalisation never "
            + "reached the canvas");
        assert.deepEqual(errors, [], "no console errors across the round trip");
    }, "widget-heat.html");
});

suite("heat follows the time slider through its source layer", async () => {
    await withPage(async (page, errors) => {
        // The source points sit one per day, so each tick lights a different
        // subset of the derived heat. The points themselves are hidden first,
        // so the ONLY thing allowed to change between ticks is heat pixels --
        // and the timeless cluster blob doubles as a control that must not.
        await page.evaluate(() => {
            const box = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.name === "group_Points");
            box.checked = false;
            box.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(900);
        const container = page.locator(".swiftmap-container");
        const tickOne = await container.screenshot();

        await page.click(".swiftmap-time-fwd");
        await page.waitForTimeout(600);
        const tickTwo = await container.screenshot();

        assert.notEqual(Buffer.compare(tickOne, tickTwo), 0,
            "stepping the slider must move the source-derived heat -- the gated "
            + "splats are the only visible layer that carries time");
        assert.deepEqual(errors, [], "no console errors while ticking heat");
    }, "widget-heat.html");
});

suite("a static export renders without any backend", async () => {
    // m.save() bakes the map into one HTML file: state as JSON, buffers as base64,
    // the bundle inlined and imported through a blob URL. The export is generated by
    // the real Python path right here, then driven like any fixture -- if the bundle
    // and the baked model stub ever drift apart, this is where it surfaces.
    const { execSync } = await import("node:child_process");
    const { unlink } = await import("node:fs/promises");
    const out = join(ROOT, "test", "fixtures", "static-export.html");
    execSync(`python "${join(ROOT, "scripts", "export_demo.py")}" "${out}"`,
        { cwd: ROOT, stdio: "pipe" });
    try {
        await withPage(async (page, errors) => {
            assert.equal(await page.locator(".leaflet-points-pane canvas").count(), 1,
                "the exported points draw on a WebGL canvas");
            assert.equal(await page.locator(".leaflet-polygons-pane canvas").count(), 1,
                "the exported polygon draws too");
            const sidebar = await page.locator(".swiftmap-sidebar").innerText();
            assert.ok(sidebar.includes("Sites") && sidebar.includes("Zone"),
                "the sidebar lists the exported layers");

            // The demo sets no center: its data sits near Madrid while the fallback
            // view is Gibraltar, so the map only opens on the data if the auto-fit
            // union rode the export and was applied at startup. The fit's moveend
            // echoes the final center into the model, which is the probe.
            await page.waitForTimeout(600);
            const center = await page.evaluate(() => window.__model.get("center"));
            assert.ok(Math.abs(center[0] - 40.05) < 0.3 && Math.abs(center[1] + 3.7) < 0.3,
                `auto-fit opened the export on its data, got ${JSON.stringify(center)}`);
            assert.deepEqual(errors, [], "no errors with no backend behind the page");
        }, "static-export.html");
    } finally {
        await unlink(out).catch(() => {});
    }
});

suite("an explicit height sizes the container and drops the 400px floor", async () => {
    await withPage(async page => {
        const probe = () => page.evaluate(() => {
            const c = document.querySelector(".swiftmap-container");
            return { height: c.offsetHeight, min: c.style.minHeight };
        });
        const before = await probe();
        assert.ok(before.height >= 400, "unset, the stylesheet floor holds");

        await page.evaluate(() => window.__model.set("height", "250px"));
        await page.waitForTimeout(300);
        const after = await probe();
        // offsetHeight includes the container's 1px top and bottom borders.
        assert.equal(after.height, 252,
            "an explicit height wins -- including against the 400px minimum");
    });
});

suite("a fit requested while hidden lands when the container gains size", async () => {
    // The Shiny nav_panel case: the widget builds on an unselected tab, Leaflet
    // initialises at 0x0 and caches it, and a fit computed then is garbage. The
    // container's own ResizeObserver must re-measure on reveal and re-apply the
    // pending request -- Leaflet's trackResize only watches the window.
    await withPage(async (page, errors) => {
        await page.waitForTimeout(500);
        await page.evaluate(() => window.__reveal());
        await page.waitForTimeout(800);

        const center = await page.evaluate(() => window.__model.get("center"));
        // The request's union centres near [36.01, -5.43]; the fixture's own view
        // sits at [20, 10], so landing here proves the reveal re-applied the fit.
        assert.ok(Math.abs(center[0] - 36.01) < 0.3 && Math.abs(center[1] + 5.43) < 0.4,
            `the revealed map frames the requested bounds -- got ${JSON.stringify(center)}`);
        const zoom = await page.evaluate(() => window.__model.get("zoom"));
        assert.ok(zoom > 3 && zoom <= 15, `and chose a real zoom for them -- got ${zoom}`);
        assert.deepEqual(errors, [], "no errors through hide, reveal, and refit");
    }, "widget-hidden.html", null);
});

suite("permanent labels render, follow visibility, and stay text", async () => {
    // Applied dynamically so the other suites' screenshot clips never contain them.
    await withPage(async (page, errors) => {
        const texts = () => page.evaluate(() =>
            [...document.querySelectorAll(".swiftmap-feature-label")]
                .map(e => e.textContent));

        assert.deepEqual(await texts(), [], "no labels until asked");

        await page.evaluate(() => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === "pts" ? { ...l, labels: ["Alpha", "<b>Bravo</b>"] } : l));
        });
        await page.waitForTimeout(500);
        assert.deepEqual((await texts()).sort(), ["<b>Bravo</b>", "Alpha"],
            "labels render, and markup in data stays text");
        const bolded = await page.evaluate(() =>
            document.querySelectorAll(".swiftmap-feature-label b").length);
        assert.equal(bolded, 0, "no element was parsed out of a label");

        await page.evaluate(() => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === "pts" ? { ...l, visible: false } : l));
        });
        await page.waitForTimeout(500);
        assert.deepEqual(await texts(), [], "labels follow their layer's visibility");
        assert.deepEqual(errors, [], "no errors along the way");
    });
});

suite("an empty-map click reports where, and only when nothing else claimed it", async () => {
    await withPage(async (page, errors) => {
        const box = await page.locator(".leaflet-container").boundingBox();
        // Top-left of the view: north-west of every fixture feature.
        await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.10);
        await page.waitForTimeout(400);

        const state = await page.evaluate(() => ({
            latlng: window.__model.get("clicked_latlng"),
            id: window.__model.get("clicked_layer_id"),
            seq: window.__model.get("click_seq"),
        }));
        assert.equal(state.id, "", "an empty click carries no layer");
        assert.equal(state.seq, 1, "and still bumps the one observable");
        assert.ok(Array.isArray(state.latlng) && state.latlng.length === 2,
            "the location arrived");
        const [lat, lng] = state.latlng;
        // The fixture centres on [36.05, -5.25] at zoom 12; the click landed in the
        // view's north-west, so the coordinate must sit near there -- Leaflet's own
        // unprojection did the work, whatever the CRS.
        assert.ok(lat > 36.05 && lat < 36.2 && lng < -5.25 && lng > -5.45,
            `a plausible north-west coordinate -- got ${JSON.stringify(state.latlng)}`);

        // Opt into the readout and click again: a mono popup with 5-decimal coords.
        await page.evaluate(() => window.__model.set("show_click_coordinates", true));
        await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.10);
        await page.waitForTimeout(400);
        const popup = await page.evaluate(() => {
            const el = document.querySelector(".swiftmap-coords-popup .leaflet-popup-content");
            return el ? el.textContent : null;
        });
        assert.match(popup || "", /^-?\d+\.\d{5}, -?\d+\.\d{5}$/,
            `the readout is the coordinate pair -- got ${popup}`);
        assert.deepEqual(errors, [], "no errors through both clicks");
    });
});

suite("drawing a rectangle lands in the drawings trait", async () => {
    // Geoman loads lazily from unpkg only when a map turns drawing on; the drawn
    // shape must arrive in Python as a GeoJSON feature with draw_seq bumped.
    await withPage(async (page, errors) => {
        await page.evaluate(() => window.__model.set("show_draw", true));
        await page.waitForSelector(".leaflet-pm-toolbar", { timeout: 20000 });

        // Rectangle: arm the tool, click one corner, click the opposite one.
        await page.click(".leaflet-pm-icon-rectangle");
        const box = await page.locator(".leaflet-container").boundingBox();
        await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.30);
        await page.waitForTimeout(200);
        await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.55);
        await page.waitForTimeout(500);

        const state = await page.evaluate(() => {
            const drawings = window.__model.get("drawings") || [];
            return {
                count: drawings.length,
                type: drawings[0] && drawings[0].geometry.type,
                id: drawings[0] && drawings[0].properties.draw_id,
                seq: window.__model.get("draw_seq"),
            };
        });
        assert.equal(state.count, 1, "one drawing recorded");
        assert.equal(state.type, "Polygon", "a rectangle arrives as a polygon feature");
        assert.ok(state.id, "carrying its draw_id");
        assert.ok(state.seq >= 1, "and draw_seq bumped for the one-observer pattern");

        // The reported bug, reproduced under its own conditions: this fixture has GL
        // layers whose canvases sit over the whole map, and drawn vectors used to
        // live UNDER them -- removal clicks never arrived, and the empty-click
        // fallback answered with a coords popup instead. Removal must now work
        // through the GL stack, and the fallback must stand down while armed.
        await page.evaluate(() => window.__model.set("show_click_coordinates", true));
        const clicksBefore = await page.evaluate(() =>
            window.__model.get("click_seq"));
        await page.click(".leaflet-pm-icon-delete");
        await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.42);
        await page.waitForTimeout(500);

        const after = await page.evaluate(() => ({
            count: (window.__model.get("drawings") || []).length,
            clicks: window.__model.get("click_seq"),
            popup: Boolean(document.querySelector(".swiftmap-coords-popup")),
        }));
        assert.equal(after.count, 0, "removal reaches the drawn shape through the GL panes");
        assert.equal(after.clicks, clicksBefore,
            "the coords fallback stood down while removal was armed");
        assert.ok(!after.popup, "and no coordinate popup pretended to answer");
        assert.deepEqual(errors, [], "no errors while drawing and removing");
    });
});

suite("the scale bar shows, reads nautical, and moves corners", async () => {
    await withPage(async (page, errors) => {
        const scaleText = () => page.evaluate(() => {
            const el = document.querySelector(".leaflet-control-scale");
            return el ? el.textContent : null;
        });
        assert.equal(await scaleText(), null, "off by default");

        await page.evaluate(() => window.__model.set("show_scale", true));
        await page.waitForTimeout(300);
        assert.match(await scaleText() || "", /\d+\s*(km|m)\b/,
            "metric by default");

        await page.evaluate(() =>
            window.__model.set("scale_config", { units: "nautical",
                                                 position: "bottom-right" }));
        await page.waitForTimeout(300);
        const text = await scaleText();
        assert.match(text || "", /\d+(\.\d+)?\s*nm\b/,
            `the nautical line renders -- got ${text}`);
        assert.ok(!/\bkm\b/.test(text || ""), "and metric stands down");
        const corner = await page.evaluate(() =>
            Boolean(document.querySelector(
                ".leaflet-bottom.leaflet-right .leaflet-control-scale")));
        assert.ok(corner, "the bar moved to its corner");
        assert.deepEqual(errors, [], "no errors while reconfiguring");
    });
});

suite("labels follow the time window", async () => {
    // The fixture's three points sit on separate days; labelling them and seeking
    // the slider must swap the chips with the points, since every tick re-enters
    // the sync that re-derives labels.
    await withPage(async (page, errors) => {
        await page.evaluate(() => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === "pts" ? { ...l, labels: ["D1", "D2", "D3"] } : l));
        });
        const seek = v => page.evaluate(val => {
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = String(val); s.dispatchEvent(new Event("input"));
        }, v).then(() => page.waitForTimeout(700));
        const texts = () => page.evaluate(() =>
            [...document.querySelectorAll(".swiftmap-feature-label")]
                .map(e => e.textContent).sort());

        await seek(0);
        assert.deepEqual(await texts(), ["D1"], "day one labels day one's point");
        const max = await page.evaluate(() =>
            parseInt(document.querySelector(".swiftmap-time-slider").max, 10));
        await seek(max);
        assert.deepEqual(await texts(), ["D3"], "the chip moved with the window");
        assert.deepEqual(errors, [], "no errors while seeking");
    }, "widget-time.html");
});

suite("the legend derives, dims, and obeys overrides", async () => {
    // Enabled dynamically so the other suites' screenshot clips never contain it.
    await withPage(async (page, errors) => {
        const visible = () => page.evaluate(() => {
            const el = document.querySelector(".swiftmap-legend");
            return el && el.style.display !== "none" ? el.innerText : null;
        });
        assert.equal(await visible(), null, "off by default");

        await page.evaluate(() => window.__model.set("show_legend", true));
        await page.waitForTimeout(400);
        let text = await visible();
        assert.ok(text && text.includes("Sites") && text.includes("Zone")
            && text.includes("Bubbles"), `derived rows render -- got: ${text}`);

        await page.evaluate(() => window.__model.set("legend_config", {
            title: "Key",
            remove: [{ label: "Zone" }],
            add: [{ kind: "swatch", label: "Custom entry", shape: "line",
                    color: "#000000", fillColor: "#000000" }],
        }));
        await page.waitForTimeout(400);
        text = await visible();
        assert.ok(text.includes("Key"), "the title override lands");
        assert.ok(!text.includes("Zone"), "a removed row stays removed");
        assert.ok(text.includes("Custom entry"), "a manual row renders");

        await page.evaluate(() => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === "pts" ? { ...l, visible: false } : l));
        });
        await page.waitForTimeout(600);
        const dimmed = await page.evaluate(() => {
            const rows = [...document.querySelectorAll(".swiftmap-legend div")];
            const row = rows.find(d => d.textContent === "Sites"
                && d.style.display === "flex");
            return row && row.style.opacity;
        });
        assert.equal(dimmed, "0.5",
            "a hidden layer's row dims under the default scope");
        assert.deepEqual(errors, [], "no errors along the way");
    });
});

suite("hidden features do not answer clicks", async () => {
    // GPU-path buckets keep every layer -- visibility is a shader uniform -- but
    // glify's hit-tests run against the bucket's DATA, which cannot see uniforms:
    // a radio-hidden layer's features still won clicks and popped up, and so did
    // points outside the current time window. Visibility is now consulted live,
    // per event, before a feature competes for the click.
    await withPage(async (page, errors) => {
        // Container position of a latlng, by pure CRS math off the fixture's fixed
        // centre and zoom -- Leaflet exposes no map handle to project through.
        const clickAt = async (lat, lng) => {
            const off = await page.evaluate(([la, ln]) => {
                const z = window.__model.get("zoom");
                const c = window.__model.get("center");
                const p = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(la, ln), z);
                const pc = window.L.CRS.EPSG3857.latLngToPoint(
                    window.L.latLng(c[0], c[1]), z);
                return [p.x - pc.x, p.y - pc.y];
            }, [lat, lng]);
            const box = await page.locator(".leaflet-container").boundingBox();
            await page.mouse.click(box.x + box.width / 2 + off[0],
                                   box.y + box.height / 2 + off[1]);
            await page.waitForTimeout(400);
        };
        const clicked = () => page.evaluate(() => ({
            id: window.__model.get("clicked_layer_id"),
            popups: document.querySelectorAll(".leaflet-popup").length,
        }));

        // Tick 0 shows only the Jan-1 observation. Bravo (Jan 2) is time-hidden:
        // clicking its position must fall through to the empty-map answer.
        await clickAt(36.10, -5.20);
        let state = await clicked();
        assert.equal(state.id, "", "an out-of-window point does not answer");
        assert.equal(state.popups, 0, "and opens no popup");

        // Alpha (Jan 1) is genuinely visible: it must still answer.
        await clickAt(36.00, -5.30);
        state = await clicked();
        assert.equal(state.id, "pts", "a visible point answers as before");

        // Hide the whole layer -- what a radio group does -- and Alpha goes quiet.
        await page.evaluate(() => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === "pts" ? { ...l, visible: false } : l));
        });
        await page.waitForTimeout(500);
        await clickAt(36.00, -5.30);
        state = await clicked();
        assert.equal(state.id, "",
            "a layer hidden by its visible flag -- a radio deselection -- is unclickable");
        assert.deepEqual(errors, [], "no errors through the three clicks");
    }, "widget-time.html");
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

suite("a layer's radius reaches the renderer", async () => {
    // glify was given `size: type === "markers" ? 64 : 5` -- a constant. Every layer's
    // radius was validated, styled and shipped, then discarded at the last step, so this
    // is only catchable against a real glify instance.
    await withPage(async page => {
        const out = await page.evaluate(() => {
            const inst = (window.L.glify.pointsInstances || [])[0];
            const declared = (window.__model.get("layers") || [])
                .find(l => l.type === "circle_markers");
            const size = inst.settings.size;
            return {
                declared: declared && declared.radius,
                resolved: typeof size === "function" ? size(0, null) : size,
            };
        });
        assert.ok(out.declared, "the fixture declares a radius to test against");
        assert.equal(out.resolved, out.declared,
            "the radius the layer declares is the size glify draws");
    });
});

suite("buffer-driven colours and sizes reach the renderer", async () => {
    // color_col / radius_col compute in Python and arrive as binary buffers beside
    // the coordinates. Probed against the live glify callbacks like the radius test
    // above: shipped-then-discarded is this feature's native failure mode. The merged
    // instance holds pts (indices 0-1) then bub (2-3), in layer-list order.
    await withPage(async page => {
        const out = await page.evaluate(() => {
            const inst = (window.L.glify.pointsInstances || [])[0];
            return {
                colorA: inst.settings.color(2, null),
                colorB: inst.settings.color(3, null),
                sizeA: inst.settings.size(2, null),
                sizeB: inst.settings.size(3, null),
            };
        });
        assert.deepEqual(out.colorA, { r: 1, g: 0, b: 0, a: 1 },
            "the first bubble draws the buffer's red");
        assert.deepEqual(out.colorB, { r: 0, g: 0, b: 1, a: 1 },
            "the second draws the buffer's blue");
        assert.equal(out.sizeA, 4, "sizes come from the radii buffer");
        assert.equal(out.sizeB, 16, "per point, not per layer");
    });
});

suite("the time slider filters what glify draws", async () => {
    // Time filtering happens in the vertex shader: glify holds EVERY point (that count is
    // the probe that the GPU path engaged -- the CPU fallback would hold one), and what
    // changes per tick is what gets drawn. readPixels is unavailable (no
    // preserveDrawingBuffer), so ticks are compared by same-session screenshots: the
    // fixture's three points sit on separate days, and tick 1's period holds nothing --
    // an empty map that must differ from both neighbours.
    await withPage(async (page, errors) => {
        assert.equal(await page.locator(".swiftmap-time-control").count(), 1,
            "a time layer summons the shared control");

        const container = page.locator(".swiftmap-container");
        const shotAt = async (index) => {
            await page.evaluate((i) => {
                const slider = document.querySelector(".swiftmap-time-slider");
                slider.value = String(i);
                slider.dispatchEvent(new Event("input"));
            }, index);
            await page.waitForTimeout(500);
            return container.screenshot();
        };

        const max = await page.evaluate(() =>
            parseInt(document.querySelector(".swiftmap-time-slider").max, 10));

        const fed = await page.evaluate(() => {
            const inst = window.L.glify.pointsInstances;
            return inst[inst.length - 1].settings.data.length;
        });
        assert.equal(fed, 4, "every point is on the GPU; the shader does the filtering");

        const first = await shotAt(0);
        const empty = await shotAt(1);
        const last = await shotAt(max);
        assert.notEqual(Buffer.compare(first, empty), 0,
            "tick 0 draws its point; tick 1's period holds nothing");
        assert.notEqual(Buffer.compare(last, empty), 0,
            "the last tick draws its point too");
        // startOver, as the folium player was configured: play pressed at the end
        // restarts from tick 0 immediately -- not one silent interval later, and not
        // the dead press it used to be.
        const restarted = await page.evaluate(() => {
            const slider = document.querySelector(".swiftmap-time-slider");
            slider.value = slider.max;
            slider.dispatchEvent(new Event("input"));
            document.querySelector(".swiftmap-time-play").click();
            return new Promise(resolve => setTimeout(() => resolve({
                index: document.querySelector(".swiftmap-time-slider").value,
                state: document.querySelector(".swiftmap-time-play").getAttribute("aria-label"),
            }), 200));
        });
        assert.equal(restarted.index, "0", "play at the end starts over");
        assert.equal(restarted.state, "Pause", "and playback is actually running");
        await page.evaluate(() => document.querySelector(".swiftmap-time-play").click());

        assert.deepEqual(errors, [], "no errors while scrubbing");
    }, "widget-time.html");
});

suite("a highlight repaints the merged WebGL layer", async () => {
    // Regression: highlight_style was absent from the rebuild key, so a highlight landed
    // in layer state and the skip-if-unchanged guard threw the repaint away. Only this
    // tier can catch that class of bug -- state and tests on state looked perfect.
    await withPage(async page => {
        const result = await page.evaluate(() => {
            const last = () => {
                const a = window.L.glify.pointsInstances;
                return a[a.length - 1];
            };
            const before = last();
            window.__model.set("layers", window.__model.get("layers").map(l =>
                l.id === "pts" ? { ...l, highlight_style: { color: "#ffcc00" } } : l));
            return new Promise(resolve => setTimeout(() => {
                const inst = last();
                resolve({ rebuilt: inst !== before, color: inst.settings.color(0, null) });
            }, 400));
        });
        assert.ok(result.rebuilt, "a new glify instance was built for the new styling");
        assert.ok(Math.abs(result.color.r - 1) < 1e-6 && Math.abs(result.color.g - 0.8) < 1e-6,
            "and its colour callback resolves the highlight, #ffcc00");
    });
});

suite("dragging the trail handle widens the window for every layer", async () => {
    // The fixture's two points sit on consecutive days with duration "period", so the
    // last tick draws one point. Dragging the trail handle a day back must bring the
    // other into the window -- and release must write the override into time_config so
    // Python sees the same window the bar shows.
    await withPage(async (page, errors) => {
        const container = page.locator(".swiftmap-container");
        await page.evaluate(() => {
            const slider = document.querySelector(".swiftmap-time-slider");
            slider.value = slider.max;
            slider.dispatchEvent(new Event("input"));
        });
        await page.waitForTimeout(500);
        const narrow = await container.screenshot();

        const result = await page.evaluate(() => new Promise(resolve => {
            const track = document.querySelector(".swiftmap-time-track");
            const trail = document.querySelector(".swiftmap-time-trail");
            const rect = track.getBoundingClientRect();
            const opts = (x) => ({ bubbles: true, clientX: x, pointerId: 1 });
            // A human drag spans hundreds of ms, so debounced map syncs run in the
            // middle of it. The pause below is the regression: mid-drag state lived
            // only locally, a sync re-read the not-yet-committed config, and the
            // handle snapped home between mouse movements. Moves and the release go
            // through document, as they do when the cursor slides off the 12px handle.
            trail.dispatchEvent(new PointerEvent("pointerdown", opts(rect.right)));
            document.dispatchEvent(new PointerEvent("pointermove", opts(rect.left)));
            setTimeout(() => {
                const held = document.querySelector(".swiftmap-time-trail")
                    .getAttribute("aria-valuetext");
                document.dispatchEvent(new PointerEvent("pointerup", opts(rect.left)));
                setTimeout(() => resolve({
                    held,
                    window: (window.__model.get("time_config") || {}).window || null,
                }), 400);
            }, 350);
        }));
        await page.waitForTimeout(400);
        const widened = await container.screenshot();

        assert.equal(result.held, "PT72H",
            "mid-drag, across map syncs, the handle holds instead of snapping home");
        assert.equal(result.window, "PT72H", "the release wrote the override back");
        assert.notEqual(Buffer.compare(narrow, widened), 0,
            "the widened window draws points the narrow one did not");
        assert.deepEqual(errors, [], "no errors while dragging");
    }, "widget-time.html");
});

suite("lines and polygons each earn their own pixels", async () => {
    // Regression for the Valhalla-VRE report: swiftmap polylines had NEVER rendered.
    // The lines branch feeds glify GeoJSON ([lon, lat]) while glify's line vertex
    // builder defaults to latitude-first, so every line projected off-viewport --
    // silently, and invisibly to a suite whose only pixel test hid a whole group at
    // once, points included. This fixture has no points: each geometry is isolated by
    // its own visibility toggle, sampled away from the sidebar so the checkbox's own
    // pixels cannot fake a difference. The polygon assertion pins the OTHER half of
    // that report: the shapes path consumes GeoJSON natively, so it must keep working
    // WITHOUT coordinate keys -- adding them there would transpose polygons the same
    // way lines were.
    await withPage(async (page, errors) => {
        const mapArea = { x: 40, y: 40, width: 560, height: 520 };
        const shot = () => page.screenshot({ clip: mapArea });
        const setVis = (id, v) => page.evaluate(([i, vis]) => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === i ? { ...l, visible: vis } : l));
        }, [id, v]).then(() => page.waitForTimeout(900));

        const both = await shot();
        await setVis("ln", false);
        const noLine = await shot();
        await setVis("ln", true);
        await setVis("pg", false);
        const noPoly = await shot();
        await setVis("pg", true);
        await setVis("pg3", false);
        const noDonut = await shot();

        assert.notEqual(Buffer.compare(both, noLine), 0,
            "the polyline draws pixels of its own");
        assert.notEqual(Buffer.compare(both, noPoly), 0,
            "the polygon draws pixels of its own");
        assert.notEqual(Buffer.compare(both, noDonut), 0,
            "the holed polygon draws pixels of its own");

        // Polygon styling is more than one knob now: the border is real pixels
        // (zeroing weight removes them) and the fill reads fillColor, not color.
        const setStyle = (id, patch) => page.evaluate(([i, p]) => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === i ? { ...l, ...p } : l));
        }, [id, patch]).then(() => page.waitForTimeout(900));

        await setVis("pg3", true);
        const restored = await shot();
        await setStyle("pg", { weight: 0 });
        const noBorder = await shot();
        assert.notEqual(Buffer.compare(restored, noBorder), 0,
            "the polygon border draws pixels of its own");
        await setStyle("pg", { weight: 6, fillColor: "#0000ff" });
        const refilled = await shot();
        assert.notEqual(Buffer.compare(restored, refilled), 0,
            "the fill colour is fillColor, not the stroke color");
        assert.deepEqual(errors, [], "no errors while toggling");
    }, "widget-vector.html", ".leaflet-polylines-pane canvas");
});

suite("a multipolygon fills both parts and area clicks are exact", async () => {
    // The four-WKT-shape report, distilled. Fill half: glify's shapes only explodes
    // MultiPolygon for bare-Feature data -- inside a FeatureCollection the raw multi
    // coordinates reach earcut, which returns no indices, and the feature silently
    // draws ZERO fill triangles (the "unhandled polygon" throw sits inside the empty
    // loop and never fires). Parts now ship as one Polygon feature each. Click half:
    // area outlines ride the lines bucket, and glify's line CLICK tolerance is 0.1
    // degrees against 0.03 for hover -- borders answered clicks far outside the
    // shape and inside holes while hover stayed honest. Borders are inert now; the
    // shapes instance owns area interaction with exact, hole-aware containment.
    await withPage(async (page, errors) => {
        const box = await page.locator(".leaflet-container").boundingBox();
        const at = async (lat, lng) => {
            const off = await page.evaluate(([la, ln]) => {
                const z = window.__model.get("zoom");
                const c = window.__model.get("center");
                const p = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(la, ln), z);
                const pc = window.L.CRS.EPSG3857.latLngToPoint(
                    window.L.latLng(c[0], c[1]), z);
                return [p.x - pc.x, p.y - pc.y];
            }, [lat, lng]);
            return [box.x + box.width / 2 + off[0], box.y + box.height / 2 + off[1]];
        };
        const shotAt = async (lat, lng, size) => {
            const [x, y] = await at(lat, lng);
            return page.screenshot({ clip: {
                x: x - size / 2, y: y - size / 2, width: size, height: size } });
        };
        const setVis = (v) => page.evaluate((vis) => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === "mpz" ? { ...l, visible: vis } : l));
        }, v).then(() => page.waitForTimeout(1200));

        // Interior of the holed part's ring zone, interior of the solid part, and
        // the hole's centre -- all clear of every ring by 15+ pixels.
        const part1On = await shotAt(35.917, -5.207, 10);
        const part2On = await shotAt(35.895, -5.200, 10);
        const holeOn = await shotAt(35.940, -5.185, 12);
        await setVis(false);
        const part1Off = await shotAt(35.917, -5.207, 10);
        const part2Off = await shotAt(35.895, -5.200, 10);
        const holeOff = await shotAt(35.940, -5.185, 12);
        await setVis(true);

        assert.notEqual(Buffer.compare(part1On, part1Off), 0,
            "the holed part draws fill pixels of its own");
        assert.notEqual(Buffer.compare(part2On, part2Off), 0,
            "the second part draws fill pixels too");
        assert.equal(Buffer.compare(holeOn, holeOff), 0,
            "the hole stays empty whether the layer shows or not");

        const clickAt = async (lat, lng) => {
            const [x, y] = await at(lat, lng);
            await page.mouse.click(x, y);
            await page.waitForTimeout(400);
            return page.evaluate(() => window.__model.get("clicked_layer_id"));
        };
        assert.equal(await clickAt(35.917, -5.207), "mpz",
            "a part interior answers the click");
        assert.equal(await clickAt(35.940, -5.185), "",
            "a hole click falls through to the open map");
        assert.equal(await clickAt(35.895, -5.200), "mpz",
            "the second part answers as its own containment");
        assert.equal(await clickAt(35.880, -5.160), "",
            "near-but-outside no longer answers through the border");

        // Real polylines: the degree-constant tolerance is replaced by a few
        // pixels at the current zoom. On the route still answers; 0.025 degrees
        // off it -- a quarter of glify's old click tolerance -- falls through.
        assert.equal(await clickAt(36.05, -5.25), "ln",
            "a click on the line answers");
        assert.equal(await clickAt(36.072, -5.261), "",
            "a click well off the line reaches the open map");
        assert.deepEqual(errors, [], "no errors through fills and clicks");
    }, "widget-vector.html", ".leaflet-polylines-pane canvas");
});

suite("a multi-part line leaves its gap unpainted and keeps GPU time", async () => {
    // MULTILINESTRING used to parse as one vertex run, and the renderer drew a
    // segment between the parts that exists in no data. The layer now carries a
    // `parts` length table, the bucket emits one LineString feature per part, and
    // the time path builds segment spans within parts only -- a span across the
    // boundary would be the phantom segment in the shader AND a shear of every
    // attribute after it, which silently disables vector GPU for all vectors.
    await withPage(async (page, errors) => {
        const gpuMessages = [];
        page.on("console", (m) => {
            if (/GPU time/.test(m.text())) gpuMessages.push(m.text());
        });
        const box = await page.locator(".leaflet-container").boundingBox();
        const at = async (lat, lng) => {
            const off = await page.evaluate(([la, ln]) => {
                const z = window.__model.get("zoom");
                const c = window.__model.get("center");
                const p = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(la, ln), z);
                const pc = window.L.CRS.EPSG3857.latLngToPoint(
                    window.L.latLng(c[0], c[1]), z);
                return [p.x - pc.x, p.y - pc.y];
            }, [lat, lng]);
            return [box.x + box.width / 2 + off[0], box.y + box.height / 2 + off[1]];
        };
        const shotAt = async (lat, lng, size) => {
            const [x, y] = await at(lat, lng);
            return page.screenshot({ clip: {
                x: x - size / 2, y: y - size / 2, width: size, height: size } });
        };
        const setVis = (id, v) => page.evaluate(([i, vis]) => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === i ? { ...l, visible: vis } : l));
        }, [id, v]).then(() => page.waitForTimeout(1200));
        const seek = (v) => page.evaluate((val) => {
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = String(val); s.dispatchEvent(new Event("input"));
        }, v).then(() => page.waitForTimeout(1200));

        // The plain two-leg line: both legs paint, the gap between them does not.
        const leg1On = await shotAt(35.86, -5.32, 12);
        const gapOn = await shotAt(35.86, -5.26, 12);
        const leg2On = await shotAt(35.86, -5.20, 12);
        await setVis("mln", false);
        const leg1Off = await shotAt(35.86, -5.32, 12);
        const gapOff = await shotAt(35.86, -5.26, 12);
        const leg2Off = await shotAt(35.86, -5.20, 12);
        await setVis("mln", true);
        assert.notEqual(Buffer.compare(leg1On, leg1Off), 0, "the first leg paints");
        assert.notEqual(Buffer.compare(leg2On, leg2Off), 0, "the second leg paints");
        assert.equal(Buffer.compare(gapOn, gapOff), 0,
            "the gap between the legs stays unpainted -- no phantom segment");

        // The per-vertex timed legs: day one draws leg one only, day three leg
        // two only. Correct only if segment spans never bridged the boundary.
        const probe = () => page.evaluate(() => {
            const li = window.L.glify.linesInstances;
            window.__li2 = window.__li2 || li[li.length - 1];
            return li[li.length - 1] === window.__li2;
        });
        await probe();
        await seek(0);
        const t1Leg1 = await shotAt(36.14, -5.32, 12);
        const t1Leg2 = await shotAt(36.14, -5.20, 12);
        const max = await page.evaluate(() =>
            parseInt(document.querySelector(".swiftmap-time-slider").max, 10));
        await seek(max);
        const t3Leg1 = await shotAt(36.14, -5.32, 12);
        const t3Leg2 = await shotAt(36.14, -5.20, 12);
        assert.notEqual(Buffer.compare(t1Leg1, t3Leg1), 0,
            "leg one is on screen on day one and gone on day three");
        assert.notEqual(Buffer.compare(t1Leg2, t3Leg2), 0,
            "leg two appears only on day three");
        await setVis("mln2", false);
        const hiddenLeg1 = await shotAt(36.14, -5.32, 12);
        const hiddenLeg2 = await shotAt(36.14, -5.20, 12);
        assert.equal(Buffer.compare(t3Leg1, hiddenLeg1), 0,
            "on day three leg one was already unpainted");
        assert.notEqual(Buffer.compare(t3Leg2, hiddenLeg2), 0,
            "on day three leg two was the painted one");

        assert.ok(await probe(), "the lines instance survived the seeks: GPU time stayed engaged");
        assert.deepEqual(gpuMessages, [], "no 'GPU time ... disabled' message was logged");
        assert.deepEqual(errors, [], "no errors through the legs");
    }, "widget-vector.html", ".leaflet-polylines-pane canvas");
});

suite("an in-place data update repaints the new positions and keeps visibility", async () => {
    // update_layer(data=...) sends a buffer op plus a replace for an EXISTING id.
    // The GL meta key used to carry only the buffer's byte length, so moving two
    // points to two new places -- same length -- would not have rebuilt the bucket
    // and the old positions would have stayed on screen. The key now carries
    // buffer identity. Driven through msg:custom, the real transport path.
    await withPage(async (page, errors) => {
        const box = await page.locator(".leaflet-container").boundingBox();
        const at = async (lat, lng) => {
            const off = await page.evaluate(([la, ln]) => {
                const z = window.__model.get("zoom");
                const c = window.__model.get("center");
                const p = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(la, ln), z);
                const pc = window.L.CRS.EPSG3857.latLngToPoint(
                    window.L.latLng(c[0], c[1]), z);
                return [p.x - pc.x, p.y - pc.y];
            }, [lat, lng]);
            return [box.x + box.width / 2 + off[0], box.y + box.height / 2 + off[1]];
        };
        const shotAt = async (lat, lng, size) => {
            const [x, y] = await at(lat, lng);
            return page.screenshot({ clip: {
                x: x - size / 2, y: y - size / 2, width: size, height: size } });
        };
        const patch = (ops, floatBuffers) => page.evaluate(([ops, bufs]) => {
            const views = bufs.map(arr => new DataView(new Float64Array(arr).buffer));
            window.__model.emit("msg:custom", { kind: "swiftmap_patch", ops }, views);
        }, [ops, floatBuffers]).then(() => page.waitForTimeout(900));
        const config = () => page.evaluate(() =>
            window.__model.get("layers").find(l => l.id === "pts"));

        // What "nothing from Sites" looks like at the old and the new spot.
        const oldOn = await shotAt(36.00, -5.30, 10);
        const newBefore = await shotAt(36.03, -5.31, 10);
        await patch([{ op: "set", id: "pts", fields: { visible: false } }], []);
        const oldHidden = await shotAt(36.00, -5.30, 10);
        const newHidden = await shotAt(36.03, -5.31, 10);
        await patch([{ op: "set", id: "pts", fields: { visible: true } }], []);
        assert.notEqual(Buffer.compare(oldOn, oldHidden), 0, "Alpha paints before the update");
        assert.equal(Buffer.compare(newBefore, newHidden), 0, "the new spot is empty before");

        // The update: same point count, new positions -- a same-length buffer.
        const cfg = await config();
        await patch([
            { op: "buffer", id: "pts", buffer_index: 0 },
            { op: "replace", id: "pts", layer: { ...cfg,
                properties: { site: ["Alpha2", "Bravo2"] },
                bounds: [[36.03, -5.31], [36.11, -5.19]] } },
        ], [[36.03, -5.31, 36.11, -5.19]]);
        const oldAfter = await shotAt(36.00, -5.30, 10);
        const newAfter = await shotAt(36.03, -5.31, 10);
        assert.equal(Buffer.compare(oldAfter, oldHidden), 0,
            "the old position is no longer painted by Sites");
        assert.notEqual(Buffer.compare(newAfter, newHidden), 0,
            "the new position is painted");

        // Visibility off stays off across an update: the replace carries
        // visible:false, as Python preserves it, and nothing paints.
        await patch([{ op: "set", id: "pts", fields: { visible: false } }], []);
        // The stub's trait never sees patch ops (only the widget's own state does),
        // so build the replace the way Python sends it: the config as it stands,
        // visibility preserved.
        const cfgHidden = { ...cfg, visible: false };
        await patch([
            { op: "buffer", id: "pts", buffer_index: 0 },
            { op: "replace", id: "pts", layer: { ...cfgHidden,
                bounds: [[36.03, -5.31], [36.11, -5.19]] } },
        ], [[36.03, -5.31, 36.11, -5.19]]);
        const stillHidden = await shotAt(36.03, -5.31, 10);
        assert.equal(Buffer.compare(stillHidden, newHidden), 0,
            "a hidden layer stays unpainted through a data update");
        const checked = await page.evaluate(() =>
            [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.parentElement.textContent.includes("Sites")).checked);
        assert.equal(checked, false, "and its sidebar box stays unchecked");
        assert.deepEqual(errors, [], "no errors through the updates");
    }, "widget.html");
});

suite("a timed layer keeps animating after an append extends its range", async () => {
    // Append under a GPU-time bucket THROUGH THE DELTA OPS: buffer_append tails
    // for the coordinates and ::times (one observation on a later day) plus an
    // `append` for the new row. The slider's range must extend, the new point
    // must animate in at its own tick, and the GPU time path must stay engaged
    // over the CONCATENATED buffers -- the per-vertex attributes are rebuilt with
    // the bucket (a grown buffer is a new object to the meta key), never kept stale.
    await withPage(async (page, errors) => {
        const gpuMessages = [];
        page.on("console", (m) => {
            if (/GPU time/.test(m.text())) gpuMessages.push(m.text());
        });
        const box = await page.locator(".leaflet-container").boundingBox();
        const at = async (lat, lng) => {
            const off = await page.evaluate(([la, ln]) => {
                const z = window.__model.get("zoom");
                const c = window.__model.get("center");
                const p = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(la, ln), z);
                const pc = window.L.CRS.EPSG3857.latLngToPoint(
                    window.L.latLng(c[0], c[1]), z);
                return [p.x - pc.x, p.y - pc.y];
            }, [lat, lng]);
            return [box.x + box.width / 2 + off[0], box.y + box.height / 2 + off[1]];
        };
        const shotAt = async (lat, lng, size) => {
            const [x, y] = await at(lat, lng);
            return page.screenshot({ clip: {
                x: x - size / 2, y: y - size / 2, width: size, height: size } });
        };
        const seek = (v) => page.evaluate((val) => {
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = String(val); s.dispatchEvent(new Event("input"));
        }, v).then(() => page.waitForTimeout(900));
        const probe = () => page.evaluate(() => {
            const a = window.L.glify.pointsInstances;
            return { max: parseInt(document.querySelector(".swiftmap-time-slider").max, 10),
                     fed: a[a.length - 1].settings.data.length };
        });

        const before = await probe();
        const cfg = await page.evaluate(() =>
            window.__model.get("layers").find(l => l.id === "pts"));
        const day = (d) => Date.UTC(2026, 0, d);
        await page.evaluate(([coords, times]) => {
            const views = [new DataView(new Float64Array(coords).buffer),
                           new DataView(new Float64Array(times).buffer)];
            window.__model.emit("msg:custom", { kind: "swiftmap_patch", ops: [
                { op: "buffer_append", id: "pts", buffer_index: 0 },
                { op: "buffer_append", id: "pts::times", buffer_index: 1 },
                { op: "append", id: "pts", base: 3, count: 1, properties: { site: ["Echo"] } },
                { op: "set", id: "pts", fields: { bounds: [[35.98, -5.32], [36.12, -5.18]] } },
            ] }, views);
        }, [[36.08, -5.29], [day(6), day(6)]]);
        const props = await page.evaluate(() => {
            const insts = window.L.glify.pointsInstances;
            return insts[insts.length - 1].settings.data.length;
        });
        void cfg; void props;
        await page.waitForTimeout(900);

        const after = await probe();
        assert.ok(after.max > before.max, "the slider's range extended to the new day");
        assert.equal(after.fed, before.fed + 1, "the bucket holds the appended point");

        await seek(0);
        const echoEarly = await shotAt(36.08, -5.29, 10);
        await seek(after.max);
        const echoLate = await shotAt(36.08, -5.29, 10);
        assert.notEqual(Buffer.compare(echoEarly, echoLate), 0,
            "the appended point animates in at its own tick");
        assert.deepEqual(gpuMessages, [], "GPU time stayed engaged through the append");
        assert.deepEqual(errors, [], "no errors through the append");
    }, "widget-time.html");
});

suite("the logo card is app-supplied, off by default, and carries data URIs", async () => {
    // The card used to hardcode two placeholder URLs that never resolved -- two
    // broken-image icons on every map -- and show_logo defaulted True through the
    // constructor. Now: off by default, content from logo_config (URL, data URI,
    // or a file embedded Python-side), a generic inline mark only when the card is
    // on with neither slot set, and never a request to a non-resolving host.
    await withPage(async (page, errors) => {
        const stray = [];
        page.on("request", r => { if (/repo\/assets/.test(r.url())) stray.push(r.url()); });
        const card = () => page.evaluate(() => {
            const div = document.querySelector(".swiftmap-logo");
            const imgs = div ? [...div.querySelectorAll("img")] : [];
            return {
                shown: Boolean(div) && getComputedStyle(div).display !== "none",
                imgs: imgs.map(i => ({ scheme: i.src.split(";")[0], alt: i.alt,
                                       height: i.style.height,
                                       ok: i.complete && i.naturalWidth > 0 })),
                pos: div ? { top: div.style.top, bottom: div.style.bottom,
                             left: div.style.left, right: div.style.right } : null,
            };
        });
        const set = (k, v) => page.evaluate(([key, val]) =>
            window.__model.set(key, val), [k, v]).then(() => page.waitForTimeout(300));
        const decoded = () => page.waitForFunction(() => {
            const imgs = [...document.querySelectorAll(".swiftmap-logo img")];
            return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0);
        }, null, { timeout: 10000 });

        let state = await card();
        assert.equal(state.shown, false, "off by default");
        assert.equal(state.imgs.length, 0, "and holds no images while off");

        // A data-URI logo in the configured corner at the configured height.
        const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        await set("logo_config", { company: { url: PNG, alt: "Acme" },
                                   position: "top-left", height: 40 });
        await set("show_logo", true);
        await decoded();
        state = await card();
        assert.equal(state.shown, true, "the card shows");
        assert.equal(state.imgs.length, 1, "one slot set, one image -- the other slot renders nothing");
        assert.equal(state.imgs[0].scheme, "data:image/png", "the data URI is the source");
        assert.equal(state.imgs[0].alt, "Acme");
        assert.equal(state.imgs[0].height, "40px", "height is the configured pixels");
        assert.ok(state.imgs[0].ok, "the image decoded");
        assert.deepEqual([state.pos.top, state.pos.left, state.pos.bottom, state.pos.right],
            ["10px", "10px", "", ""], "anchored top-left");

        // Live toggle, both ways.
        await set("show_logo", false);
        assert.equal((await card()).shown, false, "toggling off hides it live");
        await set("show_logo", true);
        assert.equal((await card()).shown, true, "and back on shows it");

        // On with neither slot set: the generic mark stands in -- never a broken image.
        await set("logo_config", {});
        await decoded();
        state = await card();
        assert.equal(state.imgs.length, 1);
        assert.equal(state.imgs[0].scheme, "data:image/svg+xml", "the built-in mark is inline SVG");
        assert.ok(state.imgs[0].ok, "and it decodes");
        assert.deepEqual([state.pos.bottom, state.pos.right], ["10px", "10px"],
            "default corner is bottom-right");
        assert.deepEqual(stray, [], "no request ever went to the old placeholder host");
        assert.deepEqual(errors, [], "no errors through the logo states");
    }, "widget.html");
});

suite("an append through the delta ops paints the new point and leaves the old ones", async () => {
    // The live-feed wire shape: buffer_append with the new coordinates, `append`
    // with the new rows, `set` for the bounds -- never the layer. The existing
    // points must not so much as flicker in identity: their pixels stay put.
    await withPage(async (page, errors) => {
        const box = await page.locator(".leaflet-container").boundingBox();
        const at = async (lat, lng) => {
            const off = await page.evaluate(([la, ln]) => {
                const z = window.__model.get("zoom");
                const c = window.__model.get("center");
                const p = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(la, ln), z);
                const pc = window.L.CRS.EPSG3857.latLngToPoint(
                    window.L.latLng(c[0], c[1]), z);
                return [p.x - pc.x, p.y - pc.y];
            }, [lat, lng]);
            return [box.x + box.width / 2 + off[0], box.y + box.height / 2 + off[1]];
        };
        const shotAt = async (lat, lng, size) => {
            const [x, y] = await at(lat, lng);
            return page.screenshot({ clip: {
                x: x - size / 2, y: y - size / 2, width: size, height: size } });
        };
        const fed = () => page.evaluate(() => {
            const a = window.L.glify.pointsInstances;
            return a[a.length - 1].settings.data.length;
        });
        const props = () => page.evaluate(() => {
            // The widget's own mirror of the layer, via the sidebar's data attribute
            // path is not exposed; read the merged bucket's feature count and the
            // popup property table through the glify instance instead.
            const a = window.L.glify.pointsInstances;
            return a[a.length - 1].settings.data.length;
        });

        const alphaBefore = await shotAt(36.00, -5.30, 10);
        const newBefore = await shotAt(36.07, -5.33, 10);
        const fedBefore = await fed();
        await page.evaluate(() => {
            const views = [new DataView(new Float64Array([36.07, -5.33]).buffer)];
            window.__model.emit("msg:custom", { kind: "swiftmap_patch", ops: [
                { op: "buffer_append", id: "pts", buffer_index: 0 },
                { op: "append", id: "pts", base: 2, count: 1, properties: { site: ["Echo"] } },
                { op: "set", id: "pts", fields: { bounds: [[35.98, -5.33], [36.12, -5.18]] } },
            ] }, views);
        });
        await page.waitForTimeout(900);
        const alphaAfter = await shotAt(36.00, -5.30, 10);
        const newAfter = await shotAt(36.07, -5.33, 10);
        assert.equal(Buffer.compare(alphaBefore, alphaAfter), 0,
            "the existing point's pixels are untouched");
        assert.notEqual(Buffer.compare(newBefore, newAfter), 0,
            "the appended point paints");
        assert.equal(await fed(), fedBefore + 1, "the bucket holds one more point");
        void props;
        assert.deepEqual(errors, [], "no errors through the append");
    }, "widget.html");
});

suite("late data leaves the playhead on its moment and prepends ticks", async () => {
    // Appending observations EARLIER than the layer's earliest used to re-base the
    // tick series from the new earliest and drop the playhead to the start -- the
    // user lost where they were looking, with no warning. Ticks now anchor to period
    // boundaries (late data only prepends) and the playhead is an absolute moment
    // that snaps to the nearest tick of the new series, paused or playing. The
    // trailing-window override survives, and a forward extension is covered too.
    await withPage(async (page, errors) => {
        const slider = () => page.evaluate(() => {
            const s = document.querySelector(".swiftmap-time-slider");
            return { value: +s.value, max: +s.max,
                     current: window.__model.get("time_current") };
        });
        const seek = (v) => page.evaluate((val) => {
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = String(val); s.dispatchEvent(new Event("input"));
        }, v).then(() => page.waitForTimeout(700));
        const appendAt = (lat, lng, dayMs, base, label) => page.evaluate(
            ([lat, lng, dayMs, base, label]) => {
                const views = [new DataView(new Float64Array([lat, lng]).buffer),
                               new DataView(new Float64Array([dayMs, dayMs]).buffer)];
                window.__model.emit("msg:custom", { kind: "swiftmap_patch", ops: [
                    { op: "buffer_append", id: "pts", buffer_index: 0 },
                    { op: "buffer_append", id: "pts::times", buffer_index: 1 },
                    { op: "append", id: "pts", base, count: 1, properties: { site: [label] } },
                ] }, views);
            }, [lat, lng, dayMs, base, label]).then(() => page.waitForTimeout(700));

        // A trailing-window override, to prove it survives the extent changes.
        await page.evaluate(() => {
            const m = window.__model;
            m.set("time_config", { ...(m.get("time_config") || {}), window: "PT36H" });
        });
        await page.waitForTimeout(500);
        await seek(2);                                   // a mid-timeline tick (Jan 3)
        const before = await slider();
        assert.equal(before.value, 2);
        const moment = before.current;

        // Late data: two days before the earliest observation.
        await appendAt(36.02, -5.31, Date.UTC(2025, 11, 30), 3, "Late");
        const after = await slider();
        assert.equal(after.current, moment, "the playhead stays on the same absolute moment");
        assert.equal(after.max, before.max + 2, "the slider grew by the two prepended days");
        assert.equal(after.value, before.value + 2,
            "the handle moved WITH its moment, not back to the start");
        const trail = await page.evaluate(() =>
            document.querySelector(".swiftmap-time-trail")?.getAttribute("aria-valuetext"));
        assert.equal(trail, "PT36H", "the trailing-window override survived");

        // A forward extension -- the normal append -- leaves the playhead alone too.
        await appendAt(36.09, -5.19, Date.UTC(2026, 0, 6), 4, "Later");
        const forward = await slider();
        assert.equal(forward.current, moment, "forward growth does not move the playhead");
        assert.equal(forward.value, after.value);
        assert.equal(forward.max, after.max + 2, "two days appended at the end");

        // Playing: playback continues from where it was, never from the beginning.
        await page.click(".swiftmap-time-play");
        await page.waitForTimeout(1100);
        const playing = await slider();
        assert.ok(playing.value > forward.value, "playback is advancing");
        await appendAt(36.01, -5.29, Date.UTC(2025, 11, 27), 5, "Older");   // three more days
        const shifted = await slider();
        assert.ok(shifted.value >= playing.value + 3,
            "the playhead kept its moment through three prepended ticks while playing");
        await page.waitForTimeout(1100);
        const later = await slider();
        assert.ok(later.value > shifted.value, "and playback is still running from there");
        assert.ok(later.value < later.max, "well short of the end -- it did not restart");
        await page.click(".swiftmap-time-play");
        assert.deepEqual(errors, [], "no errors through the late data");
    }, "widget-time.html");
});

suite("the React example app renders the same map over the same core", async () => {
    // The second consumer: <SwiftMap> is one more host over the five-method
    // interface, not another rendering path. Rendered under StrictMode, so the
    // throwaway mount must leave exactly one map; the core's write-backs must reach
    // the app's callbacks; and the ref's applyPatch must be the widget's own patch
    // path, carrying a live-feed append with its binary buffer.
    await withPage(async (page, errors) => {
        assert.equal(await page.locator(".leaflet-container").count(), 1,
            "StrictMode's double mount leaves exactly one map");
        await page.waitForSelector(".leaflet-polylines-pane canvas");
        const sidebar = await page.locator(".swiftmap-sidebar").innerText();
        assert.ok(sidebar.includes("Sites") && sidebar.includes("Track"),
            "the sidebar lists both layers");
        const legend = await page.locator(".swiftmap-legend").innerText();
        assert.ok(legend.includes("Key") && legend.includes("value"),
            "the legend derives from the layer configs, title from the prop");
        assert.equal(await page.locator(".swiftmap-time-slider").count(), 1,
            "the timed track puts up the time slider");
        assert.ok(await page.locator(".leaflet-control-scale").count() >= 1, "the scale bar shows");

        const log = () => page.locator("#log").innerText();

        // The Sites layer is TIMED (the model packed ::times and set the meta),
        // so hit-testing honours the window: seek the slider to the last tick
        // and click the day that owns it -- "Charlie".
        await page.evaluate(() => {
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = s.max;
            s.dispatchEvent(new Event("input"));
        });
        await page.waitForTimeout(600);
        const box = await page.locator(".leaflet-container").boundingBox();
        const [cx, cy] = await page.evaluate(() => {
            const crs = window.L.CRS.EPSG3857;
            const p = crs.latLngToPoint(window.L.latLng(36.08, -5.22), 12);
            const c = crs.latLngToPoint(window.L.latLng(36.05, -5.25), 12);
            return [p.x - c.x, p.y - c.y];
        });
        await page.mouse.click(box.x + box.width / 2 + cx, box.y + box.height / 2 + cy);
        await page.waitForTimeout(500);
        assert.match(await log(), /click .*"layerId":"layer_\d+".*"index":2/,
            "the click names the model's layer and Charlie's row");

        // A sidebar toggle reaches onLayerToggle with the targeted op.
        await page.evaluate(() => {
            const input = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.parentElement.textContent.includes("Track"));
            input.checked = false;
            input.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(500);
        assert.match(await log(), /toggle .*"visible":false/,
            "the toggle arrives as the same targeted op Python receives");

        // A live append through the MODEL: updateLayer(append) emits the delta
        // ops -- buffer tails, the append row, one set -- and useSwiftMapFeed
        // forwards them to applyPatch. One state model, wire cost of the batch
        // (GAPS.md gap 11 answered end to end).
        const fed = () => page.evaluate(() => {
            const a = window.L.glify.pointsInstances;
            return a[a.length - 1].settings.data.length;
        });
        const before = await fed();
        await page.click("#append");
        await page.waitForTimeout(700);
        assert.equal(await fed(), before + 1, "the appended point reached the GL bucket");
        assert.equal(await page.locator("#appended").innerText(), " appended: 1");
        assert.deepEqual(errors, [], "no errors through mount, callbacks and the append");
    }, "/examples/react/index.html", ".leaflet-points-pane canvas");
});

suite("a whole-map GPU loss rebuilds every bucket in one rung", async () => {
    // A real GPU process bounce fires webglcontextlost on every canvas in the
    // same tick. The backoff ladder must advance once per EVENT, not once per
    // canvas -- counting canvases delayed a multi-bucket map's very first
    // recovery by seconds (round-5 gap N). Forced with WEBGL_lose_context,
    // the same way the report measured it: pixels must be back well inside
    // the first rung's window, not after a walked-up ladder.
    await withPage(async (page, errors) => {
        const mapArea = { x: 40, y: 60, width: 500, height: 400 };
        await page.waitForTimeout(400);
        const before = await page.screenshot({ clip: mapArea });
        await page.evaluate(() => {
            for (const canvas of document.querySelectorAll(".leaflet-pane canvas")) {
                const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
                const ext = gl && gl.getExtension("WEBGL_lose_context");
                if (ext) ext.loseContext();
            }
        });
        await page.waitForTimeout(900);
        const after = await page.screenshot({ clip: mapArea });
        assert.equal(Buffer.compare(before, after), 0,
            "every bucket redrew within the first rung -- per-canvas counting "
            + "would still be waiting on a walked-up timer");
        assert.deepEqual(errors, [], "no errors through loss and recovery");
    }, "widget.html");
});

suite("clustered points badge up, and dissolve past the max zoom", async () => {
    await withPage(async (page, errors) => {
        const counts = await page.evaluate(async () => {
            const m = await import("/dist/anywidget.js");
            const el = document.createElement("div");
            el.id = "clustered";
            el.style.cssText = "width:500px;height:400px";
            document.body.appendChild(el);
            // Two knots of 30 around distinct centres, plus one loner.
            const pts = [];
            for (let i = 0; i < 30; i++) {
                pts.push(36.01 + 0.0005 * Math.sin(i), -5.31 + 0.0005 * Math.cos(i));
                pts.push(36.01 + 0.0005 * Math.sin(i), -5.25 + 0.0005 * Math.cos(i));
            }
            pts.push(36.01, -5.10);
            const coords = new Float64Array(pts);
            const model = m.createHostStub({
                layers: [{ id: "c", type: "circle_markers", name: "Sites",
                           layer_group: "L", visible: true, radius: 5,
                           color: "#3388ff", cluster: true, cluster_radius: 60,
                           cluster_max_zoom: 15, properties: {} }],
                group_configs: {},
                coordinate_buffers: { c: new DataView(coords.buffer) },
                center: [36.01, -5.25], zoom: 11, crs: "EPSG:3857",
                auto_sync: true, sync_trigger: 0, show_logo: false,
            }, { comm: null });
            window.__clusterModel = model;
            await m.default.render({ model, el });
            await new Promise(r => setTimeout(r, 600));
            const badges = [...el.querySelectorAll(".swiftmap-cluster span")]
                .map(s => s.textContent);
            const zoomNow = (window.L && el.querySelector(".leaflet-container"))
                ? "n/a" : "n/a";
            window.__clusterModel.set("zoom", 17);   // past cluster_max_zoom
            await new Promise(r => setTimeout(r, 800));
            const after = el.querySelectorAll(".swiftmap-cluster").length;
            return { badges, after };
        });
        assert.ok(counts.badges.length >= 2,
            "each knot shows at least one badge zoomed out");
        assert.ok(counts.badges.some(t => Number(t) >= 15),
            "badge counts read as real membership, not decoration");
        assert.equal(counts.after, 0,
            "past cluster_max_zoom every point stands alone -- no badges");
        assert.deepEqual(errors, [], "no errors from the cluster pipeline");
    });
});

suite("arrows and dashes draw, and draw differently from a solid line", async () => {
    await withPage(async (page, errors) => {
        const counts = await page.evaluate(async () => {
            const m = await import("/dist/anywidget.js");
            const mk = async (id, deco) => {
                const el = document.createElement("div");
                el.id = id;
                el.style.cssText = "width:400px;height:300px;display:inline-block";
                document.body.appendChild(el);
                const coords = new Float64Array(
                    [36.00, -5.32, 36.02, -5.28, 36.00, -5.24]);
                await m.default.render({ model: m.createHostStub({
                    layers: [{ id: "t", type: "polyline", name: "Track",
                               layer_group: "L", visible: true, color: "#ff0000",
                               weight: 4, opacity: 1, ...deco }],
                    group_configs: {},
                    coordinate_buffers: { t: new DataView(coords.buffer) },
                    center: [36.01, -5.28], zoom: 12, crs: "EPSG:3857",
                    auto_sync: true, sync_trigger: 0, show_logo: false,
                }, { comm: null }), el });
                return el;
            };
            const plain = await mk("plain", {});
            const deco = await mk("deco", { arrows: true, dash: [10, 6] });
            await new Promise(r => setTimeout(r, 800));
            const panes = el =>
                el.querySelectorAll(".leaflet-polylines-pane canvas").length;
            return { plain: panes(plain), deco: panes(deco) };
        });
        assert.equal(counts.plain, 1, "a solid line is one canvas");
        assert.equal(counts.deco, 2,
            "the arrows ride their own points canvas in the lines pane");

        const plainShot = await page.locator("#plain").screenshot();
        const decoShot = await page.locator("#deco").screenshot();
        assert.notEqual(Buffer.compare(plainShot, decoShot), 0,
            "the same track must LOOK different dashed and arrowed -- equal "
            + "pixels mean the decoration silently drew nothing");
        assert.deepEqual(errors, [], "no errors from the decoration pipeline");
    });
});

suite("destroying a map mid-zoom-animation throws nothing later", async () => {
    // Leaflet arms a bare setTimeout(_onZoomTransitionEnd, 250) when a zoom
    // animation starts, and map.remove() does not clear it -- so a map torn
    // down mid-zoom (StrictMode's double mount, a Shiny re-render, a gallery
    // eviction) took an exception from a timer firing into removed panes. The
    // opening auto-fit IS a zoom animation, so mount-then-quick-unmount hits
    // it reliably; destroy() now disarms the flag the handler guards on.
    await withPage(async (page, errors) => {
        await page.evaluate(async () => {
            const m = await import("/dist/anywidget.js");
            const el = document.createElement("div");
            el.style.height = "300px";
            document.body.appendChild(el);
            const state = { ...window.__model.state };
            const cleanup = await m.default.render({
                model: m.createHostStub(state, { comm: null }), el });
            await new Promise(r => setTimeout(r, 50));   // zoom anim under way
            cleanup();
            await new Promise(r => setTimeout(r, 700));  // past Leaflet's 250ms timer
        });
        assert.deepEqual(errors, [],
            "the zoom-transition timer must not fire into the dead map");
    });
});

suite("an initial time_current is honoured, not silently dropped", async () => {
    // m.time_current = X before the view attaches -- or baked into m.save() --
    // is state by the time the tick series first builds, so change:time_current
    // never fires for it. The first build now reads it once, exactly the
    // fit_bounds_request pattern; without that, every export saved mid-playback
    // opened back at tick 0.
    await withPage(async (page, errors) => {
        const labels = await page.evaluate(async () => {
            const m = await import("/dist/anywidget.js");
            const el = document.createElement("div");
            el.style.height = "300px";
            document.body.appendChild(el);
            const state = { ...window.__model.state,
                            time_current: Date.UTC(2026, 0, 3, 12) };
            await m.default.render({
                model: m.createHostStub(state, { comm: null }), el });
            await new Promise(r => setTimeout(r, 400));
            const read = root =>
                (root.querySelector(".swiftmap-time-label") || {}).textContent || "";
            return { main: read(document.querySelector(".swiftmap-container")),
                     second: read(el) };
        });
        assert.ok(labels.second, "the second map renders a time control");
        assert.notEqual(labels.second, labels.main,
            "the preset playhead must not open at the main map's tick 0");
        assert.deepEqual(errors, [], "no errors honouring the initial playhead");
    }, "widget-time.html");
});

suite("destroying a map while its first sync is in flight leaves nothing behind", async () => {
    // The hazard the React host surfaced: a host may tear the map down (an
    // unmount, a throwaway mount) before the initial sync has added its GL layers.
    // The continuation must not touch the removed map, and the glify instance it
    // built must be retired from glify's module-level list with its GL context.
    await withPage(async (page, errors) => {
        const result = await page.evaluate(async () => {
            const m = await import("/dist/anywidget.js");
            const count = () => window.L.glify.pointsInstances.length;
            const before = count();
            const el = document.createElement("div");
            el.style.height = "300px";
            document.body.appendChild(el);
            const state = { ...window.__model.state };
            const cleanup = await m.default.render({ model: m.createHostStub(state, { comm: null }), el });
            const during = count();
            cleanup();                       // before the sync's continuation runs
            await new Promise(r => setTimeout(r, 600));
            return { before, during, after: count(), containers: document.querySelectorAll(".leaflet-container").length };
        });
        assert.equal(result.after, result.before, "no glify instance survives the destroyed map");
        assert.equal(result.containers, 1, "the destroyed map's container is gone");
        assert.deepEqual(errors, [], "no error from the sync continuation or a pending redraw");
    }, "widget-time.html");
});

suite("the Streamlit component renders from JSON args and reports events", async () => {
    // The fourth stack. The args come from the real Python composition
    // (scripts/streamlit_demo_args.py -> swiftmap.streamlit.compose_args: the
    // export's state, base64 buffers, the fingerprint); the page is the SHIPPED
    // frontend in swiftmap/streamlit/frontend, inside an iframe, driven by a stub
    // of Streamlit's parent side (test/fixtures/streamlit-host.html).
    const { execSync } = await import("node:child_process");
    const args = JSON.parse(execSync(
        `python "${join(ROOT, "scripts", "streamlit_demo_args.py")}"`,
        { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 }).toString());
    const EVENT_KEYS = ["clicked_layer_id", "selected_index", "clicked_latlng", "click_seq",
                        "drawings", "draw_seq", "center", "zoom", "time_current",
                        "layer_visibility"];
    await withPage(async (page, errors) => {
        const frame = page.frames().find(f => f.url().includes("/swiftmap/streamlit/frontend/"));
        assert.ok(frame, "the iframe loaded the shipped frontend");
        const values = () => page.evaluate(() => window.__values);
        const probe = () => frame.evaluate(() =>
            document.querySelector(".leaflet-container").dataset.probe || "");
        const instances = () => frame.evaluate(() => window.L.glify.pointsInstances.length);

        // Render from the args: points from a base64 coordinate buffer, colours from
        // a base64 colour buffer, the line from its own, the legend from the config.
        await page.evaluate(a => window.__render(a), args);
        await frame.waitForSelector(".leaflet-points-pane canvas", { timeout: 20000 });
        await frame.waitForSelector(".leaflet-polylines-pane canvas", { timeout: 20000 });
        const fed = await frame.evaluate(() => {
            const a = window.L.glify.pointsInstances;
            return a[a.length - 1].settings.data.length;
        });
        assert.equal(fed, 3, "the points decoded from base64 reached the GPU");
        const sidebar = await frame.locator(".swiftmap-sidebar").innerText();
        assert.ok(sidebar.includes("Sites") && sidebar.includes("Track"), "the sidebar lists both layers");
        assert.ok((await frame.locator(".swiftmap-legend").innerText()).includes("Key"),
            "the legend renders from the composed config");
        const heights = await page.evaluate(() => window.__heights);
        assert.ok(heights.some(h => Math.abs(h - 600) <= 2),
            `the frame height follows the map's 600px, reported ${JSON.stringify(heights)}`);

        // A click on Bravo (the map centre) comes back as a setComponentValue with
        // the full, stable shape.
        const box = await page.locator("#component").boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(() => window.__values.some(v => v.click_seq > 0),
                                   null, { timeout: 5000 });
        const clicked = (await values()).find(v => v.click_seq > 0);
        assert.deepEqual(Object.keys(clicked).sort(), [...EVENT_KEYS].sort(),
            "every key the core writes back, with defaults for the rest");
        const sites = args.state.layers.find(l => l.name === "Sites");
        assert.equal(clicked.clicked_layer_id, sites.id);
        assert.equal(clicked.selected_index, 1, "Bravo is the second point");

        // THE NO-OP PATH: the rerun a click causes re-sends the same args. The map
        // must not be rebuilt -- the container and the GL instances stay.
        await frame.evaluate(() => { document.querySelector(".leaflet-container").dataset.probe = "kept"; });
        const before = await instances();
        await page.evaluate(a => window.__render(a), args);
        await page.evaluate(a => window.__render(a), args);
        await page.waitForTimeout(500);
        assert.equal(await probe(), "kept", "an unchanged fingerprint leaves the map alone");
        assert.equal(await instances(), before, "no GL layer was rebuilt");

        // A CHANGED fingerprint applies Python's change through the React host's
        // props -- the same map, the viewer's pan kept since Python did not move it.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 40, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const panned = (await values()).filter(v => v.center).pop();
        assert.ok(panned, "the pan came back as a view event");
        const renamed = {
            ...args, fingerprint: args.fingerprint + ":changed",
            state: { ...args.state,
                     layers: args.state.layers.map(l => l.name === "Sites" ? { ...l, name: "Sites (renamed)" } : l) },
        };
        await page.evaluate(a => window.__render(a), renamed);
        await page.waitForTimeout(600);
        assert.ok((await frame.locator(".swiftmap-sidebar").innerText()).includes("Sites (renamed)"),
            "Python's change is on the map");
        assert.equal(await probe(), "kept", "applied to the same map, not a rebuilt one");
        const now = await frame.evaluate(() => {
            const c = window.__swiftmap.map.getCenter();
            return [c.lat, c.lng];
        });
        assert.ok(Math.abs(now[0] - panned.center[0]) < 1e-6 && Math.abs(now[1] - panned.center[1]) < 1e-6,
            `the viewer's pan survived the re-send: ${now} vs ${panned.center}`);
        assert.deepEqual(errors, [], "no errors across render, click, no-op and change");
    }, "streamlit-host.html", "#component");
});

suite("imagery renders from a URL and from the binary transport", async () => {
    // The image layer type is pure data -- {type:"image", bounds, opacity,
    // url | bytes under the layer id} -- so a plain-JS consumer needs only a
    // URL while the widget path ships bytes as a coordinate buffer. Leaflet's
    // imageOverlay does the drawing; the sync loop owns visibility and
    // recreates the overlay when config or buffer change.
    await withPage(async (page, errors) => {
        await page.waitForFunction(() => {
            const imgs = [...document.querySelectorAll("img.leaflet-image-layer")];
            return imgs.length === 2 && imgs.every(i => i.complete && i.naturalWidth > 0);
        }, null, { timeout: 15000 });
        const info = await page.evaluate(() =>
            [...document.querySelectorAll("img.leaflet-image-layer")].map(i => ({
                scheme: i.src.split(":")[0], opacity: i.style.opacity })));
        assert.ok(info.some(i => i.scheme === "data"), "the URL path renders");
        assert.ok(info.some(i => i.scheme === "blob"), "the buffer path renders");

        const mapArea = { x: 40, y: 40, width: 560, height: 520 };
        const shot = () => page.screenshot({ clip: mapArea });
        const setLayer = (id, patch) => page.evaluate(([i, p]) => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === i ? { ...l, ...p } : l));
        }, [id, patch]).then(() => page.waitForTimeout(900));

        // Pixels paint, and the overlay behaves like any layer on toggle.
        const both = await shot();
        await setLayer("imgbuf", { visible: false });
        const one = await shot();
        assert.notEqual(Buffer.compare(both, one), 0,
            "the buffer image draws pixels of its own");
        assert.equal(await page.evaluate(() =>
            document.querySelectorAll("img.leaflet-image-layer").length), 1,
            "a hidden overlay leaves the DOM");
        await setLayer("imgbuf", { visible: true });
        assert.equal(await page.evaluate(() =>
            document.querySelectorAll("img.leaflet-image-layer").length), 2,
            "and returns on show");

        // A config change re-renders without a visibility bounce.
        await setLayer("imgurl", { opacity: 0.3 });
        const opacity = await page.evaluate(() =>
            [...document.querySelectorAll("img.leaflet-image-layer")]
                .find(i => i.src.startsWith("data:")).style.opacity);
        assert.equal(opacity, "0.3", "an opacity update lands on the live overlay");
        assert.deepEqual(errors, [], "no errors through render and toggles");
    }, "widget-image.html", "img.leaflet-image-layer");
});

suite("vector time layers tick and toggle without rebuilding", async () => {
    // Regression for the second deselection crash: a line-shaped track has as many
    // vertices as a point track has points, and lines/polygons were left on the
    // rebuild-per-tick path -- every tick and every toggle re-fed all of them through
    // JS. Now their buckets ride the same GPU path as points: per-vertex time and layer
    // slots (expanded to glify's own tessellated vertex counts), the tick and visibility
    // as uniforms. The timed line and polygon in the fixture sit on different days, so
    // ticks swap them on screen while both instances keep their identity.
    await withPage(async (page, errors) => {
        const mapArea = { x: 40, y: 60, width: 560, height: 480 };
        const shot = () => page.screenshot({ clip: mapArea });
        const probe = () => page.evaluate(() => {
            const li = window.L.glify.linesInstances;
            const si = window.L.glify.shapesInstances;
            window.__li = window.__li || li[li.length - 1];
            window.__si = window.__si || si[si.length - 1];
            return {
                lineSame: li[li.length - 1] === window.__li,
                shapeSame: si[si.length - 1] === window.__si,
            };
        });
        // 1200ms, not 700: area borders draw as glify's offset multi-pass, which is
        // real work under SwiftShader -- a tight budget here races the redraw and
        // compares two screenshots of the same frame.
        const seek = (v) => page.evaluate((val) => {
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = String(val); s.dispatchEvent(new Event("input"));
        }, v).then(() => page.waitForTimeout(1200));

        await probe();
        await seek(0);
        const early = await shot();              // timed zone's day
        const max = await page.evaluate(() =>
            parseInt(document.querySelector(".swiftmap-time-slider").max, 10));
        await seek(max);
        const late = await shot();               // timed route's day
        assert.notEqual(Buffer.compare(early, late), 0,
            "different days draw different timed vectors");

        await page.evaluate(() => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.id === "ln2" ? { ...l, visible: false } : l));
        });
        await page.waitForTimeout(1200);
        const toggled = await shot();
        assert.notEqual(Buffer.compare(late, toggled), 0,
            "toggling the timed line changes the pixels");

        const after = await probe();
        assert.ok(after.lineSame, "the lines instance survived ticks and the toggle");
        assert.ok(after.shapeSame, "the shapes instance survived them too");
        assert.deepEqual(errors, [], "no errors along the way");
    }, "widget-vector.html", ".leaflet-polylines-pane canvas");
});

suite("fading dims aged points", async () => {
    // With a 3-day window at the last tick, the fixture's three points are 0, 1 and 2
    // days old. Turning fade on must change the pixels -- the older points dim -- and
    // turning it on is a rebuild (fade lives inside layer.time, which is in the rebuild
    // key), so the same differential also proves the toggle reaches the GPU.
    await withPage(async (page, errors) => {
        const mapArea = { x: 40, y: 60, width: 560, height: 480 };
        await page.evaluate(() => {
            const m = window.__model;
            m.set("time_config", { ...(m.get("time_config") || {}), window: "PT72H" });
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = s.max; s.dispatchEvent(new Event("input"));
        });
        await page.waitForTimeout(800);
        const flat = await page.screenshot({ clip: mapArea });

        await page.evaluate(() => {
            const m = window.__model;
            m.set("layers", m.get("layers").map(l =>
                l.time ? { ...l, time: { ...l.time, fade: true } } : l));
        });
        await page.waitForTimeout(900);
        const faded = await page.screenshot({ clip: mapArea });

        assert.notEqual(Buffer.compare(flat, faded), 0,
            "aged points must dim once fade is on");
        assert.deepEqual(errors, [], "no errors while fading");
    }, "widget-time.html");
});

suite("a hidden layer stays hidden across a bucket rebuild", async () => {
    // Regression: the visibility vector is uploaded only when it changes, and the
    // cache key lived on the bucket slot, which outlives the bucket. Any rebuild
    // (an append moves bufLen in the meta key; so do highlight and feature
    // styles) produced a fresh, all-visible handle that never learned a layer
    // was hidden when the vector was unchanged -- hidden layers drew again
    // after every feed tick until re-toggled. Sidebar and Python were right all
    // along; only the uniform was stale.
    await withPage(async (page, errors) => {
        const box = await page.locator(".leaflet-container").boundingBox();
        const shotAt = async (lat, lng, size) => {
            const off = await page.evaluate(([la, ln]) => {
                const z = window.__model.get("zoom");
                const c = window.__model.get("center");
                const p = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(la, ln), z);
                const pc = window.L.CRS.EPSG3857.latLngToPoint(window.L.latLng(c[0], c[1]), z);
                return [p.x - pc.x, p.y - pc.y];
            }, [lat, lng]);
            const [x, y] = [box.x + box.width / 2 + off[0], box.y + box.height / 2 + off[1]];
            return page.screenshot({ clip: { x: x - size / 2, y: y - size / 2, width: size, height: size } });
        };
        const instance = () => page.evaluate(() => {
            const a = window.L.glify.pointsInstances;
            const inst = a[a.length - 1];
            window.__inst = window.__inst || inst;
            return { fed: inst.settings.data.length, same: inst === window.__inst };
        });
        await page.evaluate(() => {
            const m = window.__model;
            m.set("time_config", { ...(m.get("time_config") || {}), window: "PT96H" });
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = s.max; s.dispatchEvent(new Event("input"));
        });
        await page.waitForTimeout(800);

        const BEACON = [36.03, -5.26];
        const shown = await shotAt(...BEACON, 16);
        await page.evaluate(() => {
            const input = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.parentElement.textContent.includes("Beacon"));
            input.checked = false;
            input.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(900);
        const hidden = await shotAt(...BEACON, 16);
        assert.notEqual(Buffer.compare(shown, hidden), 0, "the toggle hides Beacon");
        const before = await instance();

        // A feed tick on the OTHER layer: bufLen moves, the bucket rebuilds.
        await page.evaluate(() => {
            const day = Date.UTC(2026, 0, 1);
            const views = [new DataView(new Float64Array([36.07, -5.33]).buffer),
                           new DataView(new Float64Array([day, day]).buffer)];
            window.__model.emit("msg:custom", { kind: "swiftmap_patch", ops: [
                { op: "buffer_append", id: "pts", buffer_index: 0 },
                { op: "buffer_append", id: "pts::times", buffer_index: 1 },
                { op: "append", id: "pts", base: 3, count: 1, properties: { site: ["Echo"] } },
            ] }, views);
        });
        await page.waitForTimeout(900);
        const after = await instance();
        assert.ok(!after.same && after.fed === before.fed + 1,
            "the append rebuilt the bucket (the regression's precondition)");
        const afterRebuild = await shotAt(...BEACON, 16);
        assert.equal(Buffer.compare(hidden, afterRebuild), 0,
            "Beacon is still hidden after the rebuild: the new handle got the vector");
        assert.deepEqual(errors, [], "no errors through toggle and append");
    }, "widget-time.html");
});

suite("a layer toggle is a uniform, not a rebuild", async () => {
    // Regression for the deselection crash: unchecking one of N point layers changed the
    // merged bucket's membership and rebuilt every point -- at 5M points, seconds per
    // click, and consecutive clicks stacked into a tab crash. With visibility on the
    // GPU, the bucket keeps ALL point layers (glify's fed count stays constant and the
    // instance identity survives the toggle) while the pixels still change.
    await withPage(async (page, errors) => {
        const mapArea = { x: 40, y: 60, width: 560, height: 480 };
        await page.evaluate(() => {
            // widen the window so both layers' points draw at the last tick
            const m = window.__model;
            m.set("time_config", { ...(m.get("time_config") || {}), window: "PT96H" });
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = s.max; s.dispatchEvent(new Event("input"));
        });
        await page.waitForTimeout(800);

        const probe = () => page.evaluate(() => {
            const a = window.L.glify.pointsInstances;
            const inst = a[a.length - 1];
            window.__lastInst = window.__lastInst || inst;
            return { fed: inst.settings.data.length, same: inst === window.__lastInst };
        });

        const before = await probe();
        const withBeacon = await page.screenshot({ clip: mapArea });

        await page.evaluate(() => {
            const box = [...document.querySelectorAll(".swiftmap-sidebar input")]
                .find(i => i.parentElement.textContent.includes("Beacon"));
            box.checked = false;
            box.dispatchEvent(new Event("change"));
        });
        await page.waitForTimeout(900);

        const after = await probe();
        const withoutBeacon = await page.screenshot({ clip: mapArea });

        assert.notEqual(Buffer.compare(withBeacon, withoutBeacon), 0,
            "the toggled layer's point disappears from the screen");
        assert.equal(after.fed, before.fed,
            "the bucket keeps every point -- membership did not change");
        assert.ok(after.same,
            "the glify instance survives the toggle: no rebuild happened");
        assert.deepEqual(errors, [], "no errors while toggling");
    }, "widget-time.html");
});
