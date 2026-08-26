/**
 * Smoke-checks the built demo site in a real browser.
 *
 *     node scripts/check_demos.mjs [--dir docs] [--shots <out-dir>] [--headed]
 *
 * The site is generated from working code, but "the generator ran" is not the
 * same claim as "every map mounts in a browser and something reached the GPU"
 * -- and the whole pitch of the page is the second one. So this walks the page
 * the way a visitor does: scroll each card into view, wait for its map to
 * mount, and assert that a canvas or a tile actually rendered inside it. It
 * also checks the hero ladder against the tiers actually built, which is how a
 * partial build gets caught before it is published.
 *
 * Exit code is non-zero if any card fails, so it belongs next to
 * build_demos.py on the release checklist.
 *
 * Screenshots are never compared byte for byte -- WebGL output differs across
 * drivers. --shots is for eyeballing, not for asserting.
 */
import { createServer } from "node:http";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { argv, exit } from "node:process";

const arg = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
};
const DIR = resolve(arg("--dir", "docs"));
const SHOTS = arg("--shots", null);
const HEADED = argv.includes("--headed");

const TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".bin": "application/octet-stream",
    ".map": "application/json",
};

function serve() {
    const server = createServer(async (req, res) => {
        const rel = decodeURIComponent(req.url.split("?")[0]);
        const path = join(DIR, rel === "/" ? "index.html" : rel);
        try {
            const body = await readFile(path);
            res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
            res.end(body);
        } catch {
            res.writeHead(404).end("not found");
        }
    });
    return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}

let chromium;
try { ({ chromium } = await import("playwright")); } catch { chromium = null; }
if (!chromium) { console.error("playwright is not installed -- npm install"); exit(2); }

const { server, port } = await serve();
const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push(
    argv.includes("--stacks") ? `pageerror: ${e.stack}` : `pageerror: ${e.message}`));

let failures = 0;
const fail = (what, why) => { failures += 1; console.log(`  FAIL  ${what}: ${why}`); };
const pass = what => console.log(`  ok    ${what}`);

try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

    // --- the hero -------------------------------------------------------
    console.log("hero");
    await page.waitForSelector("#hero-stage .leaflet-container", { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector(".veil").hidden, null, { timeout: 60000 });
    const heroCanvas = await page.locator("#hero-stage canvas").count();
    heroCanvas > 0 ? pass(`initial tier drew (${heroCanvas} canvas)`)
                   : fail("initial tier", "no canvas inside the hero");
    const readout = await page.evaluate(() => ({
        points: document.getElementById("hero-points").textContent,
        ms: document.getElementById("hero-ms").textContent,
    }));
    console.log(`        ${readout.points} points, mount->paint ${readout.ms}`);

    // The ladder must offer every tier that exists on disk. A partial build
    // rewrites index.html with only the tiers it made, leaving the rest of the
    // data orphaned -- a page that looks finished while missing the headline.
    // Comparing the two catches it, including in an already-committed page.
    const onDisk = (await readdir(join(DIR, "data")))
        .filter(name => name.startsWith("hero-")).sort();
    const onPage = await page.locator(".tier").evaluateAll(
        els => els.map(e => e.dataset.tier).sort());
    const missing = onDisk.filter(slug => !onPage.includes(slug));
    missing.length
        ? fail("ladder", `data/ has ${onDisk.join(", ")} but the page offers only `
                       + `${onPage.join(", ")} -- rebuild without --skip-hero-large`)
        : pass(`ladder offers all ${onDisk.length} tiers built`);

    // Every rung of the ladder, in order, including the largest.
    const tiers = await page.locator(".tier").count();
    for (let i = 0; i < tiers; i++) {
        const btn = page.locator(".tier").nth(i);
        const label = (await btn.getAttribute("data-points"));
        const t0 = Date.now();
        await btn.click();
        await page.waitForFunction(() => document.querySelector(".veil").hidden,
                                   null, { timeout: 180000 });
        const n = await page.locator("#hero-stage canvas").count();
        const ms = await page.evaluate(() => document.getElementById("hero-ms").textContent);
        n > 0 ? pass(`tier ${Number(label).toLocaleString()} drew  (${ms} paint, ${((Date.now() - t0) / 1000).toFixed(1)}s incl. fetch)`)
              : fail(`tier ${label}`, "no canvas after the swap");
    }
    if (SHOTS) {
        await mkdir(SHOTS, { recursive: true });
        // Clicking a tier moves focus, which can scroll the page; put it back
        // so the shot is the hero as a visitor first meets it.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(SHOTS, "hero.png") });
    }

    // --- the cards ------------------------------------------------------
    console.log("cards");
    const slugs = await page.locator("[data-demo]").evaluateAll(
        els => els.map(e => e.dataset.demo));

    for (const slug of slugs) {
        const el = page.locator(`[data-demo="${slug}"]`);
        await el.scrollIntoViewIfNeeded();
        try {
            await page.waitForFunction(
                s => document.querySelector(`[data-demo="${s}"]`).dataset.state === "live",
                slug, { timeout: 45000 });
        } catch {
            const state = await el.getAttribute("data-state");
            const hint = await el.getAttribute("data-hint");
            fail(slug, `never went live (state=${state}, hint=${hint})`);
            continue;
        }
        // Something reached the screen: a WebGL canvas for vector layers, a
        // tile image for the basemap/imagery cards, or an SVG path.
        const drew = await el.evaluate(e => ({
            canvas: e.querySelectorAll("canvas").length,
            tiles: e.querySelectorAll("img.leaflet-tile").length,
            paths: e.querySelectorAll("path").length,
            markers: e.querySelectorAll(".leaflet-marker-icon").length,
        }));
        const any = drew.canvas + drew.tiles + drew.paths + drew.markers;
        any > 0
            ? pass(`${slug.padEnd(18)} canvas:${drew.canvas} tiles:${drew.tiles} paths:${drew.paths} markers:${drew.markers}`)
            : fail(slug, "mounted but nothing drew");
        // Let the basemap tiles arrive before the shot -- "live" means the map
        // mounted, not that every tile has landed.
        if (SHOTS) {
            await page.waitForTimeout(1200);
            await el.screenshot({ path: join(SHOTS, `card-${slug}.png`) });
        }
    }

    // --- the eviction policy -------------------------------------------
    // MAX_LIVE in gallery.js exists because browsers cap WebGL contexts; if
    // it stopped working the page would look fine until the tenth card.
    const stillLive = await page.locator('[data-demo][data-state="live"]').count();
    stillLive <= 6
        ? pass(`eviction held: ${stillLive} cards live after scrolling all ${slugs.length}`)
        : fail("eviction", `${stillLive} cards still mounted -- MAX_LIVE is not being enforced`);

    // A viewport shot of each landmark, for eyeballing the page itself rather
    // than the maps in it.
    if (SHOTS) {
        for (const [name, sel] of [["sec-gallery", "#gallery"], ["sec-stacks", "#stacks"],
                                   ["sec-why", "#why"], ["sec-foot", "footer.site"]]) {
            await page.locator(sel).scrollIntoViewIfNeeded();
            await page.waitForTimeout(900);
            await page.screenshot({ path: join(SHOTS, `${name}.png`) });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(600);
    }
} finally {
    // Tile 404s from a basemap provider are noise; anything from our own code
    // is not.
    const real = consoleErrors.filter(t => !/leaflet-tile|ERR_|Failed to load resource/i.test(t));
    if (real.length) {
        console.log("console errors:");
        real.slice(0, 12).forEach(t => console.log(`  ! ${t}`));
        failures += real.length;
    }
    await browser.close();
    server.close();
}

console.log(failures ? `\n${failures} failure(s)` : "\nall demos rendered");
exit(failures ? 1 : 0);
