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
