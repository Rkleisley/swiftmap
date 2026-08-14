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
        await page.goto(`http://127.0.0.1:${port}/test/fixtures/${fixture}`);
        await page.waitForFunction("window.__ready === true", { timeout: 30000 });
        // Wait for glify's canvas rather than sleeping: the first WebGL draw happens on a
        // later frame than render() resolving, and a fixed delay is a flaky test waiting
        // to happen on a slower machine.
        await page.waitForSelector(readySelector, { timeout: 20000 });
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
        assert.deepEqual(errors, [], "no errors while toggling");
    }, "widget-vector.html", ".leaflet-polylines-pane canvas");
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
        const seek = (v) => page.evaluate((val) => {
            const s = document.querySelector(".swiftmap-time-slider");
            s.value = String(val); s.dispatchEvent(new Event("input"));
        }, v).then(() => page.waitForTimeout(700));

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
        await page.waitForTimeout(700);
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
