// Debug: trace click_seq and pm mode states through a draw + removal sequence.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".map": "application/json" };
const server = createServer(async (req, res) => {
    const path = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    try {
        const body = await readFile(path);
        res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
        res.end(body);
    } catch { res.writeHead(404).end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(`http://127.0.0.1:${port}/test/fixtures/widget.html`);
await page.waitForFunction("window.__ready === true", { timeout: 30000 });
await page.waitForSelector(".leaflet-points-pane canvas", { timeout: 20000 });

const probe = label => page.evaluate((l) => {
    const map = document.querySelector(".leaflet-container");
    const pmMap = Object.values(map).find(v => v && v.pm && v.getCenter)
        || null;
    const pm = pmMap && pmMap.pm;
    return {
        label: l,
        seq: window.__model.get("click_seq"),
        drawings: (window.__model.get("drawings") || []).length,
        draw: pm && pm.globalDrawModeEnabled && pm.globalDrawModeEnabled(),
        removal: pm && pm.globalRemovalModeEnabled && pm.globalRemovalModeEnabled(),
    };
}, label).then(s => console.log(JSON.stringify(s)));

await page.evaluate(() => window.__model.set("show_draw", true));
await page.waitForSelector(".leaflet-pm-toolbar", { timeout: 20000 });
await probe("toolbar up");

await page.click(".leaflet-pm-icon-rectangle");
await probe("rect armed");
const box = await page.locator(".leaflet-container").boundingBox();
await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.30);
await page.waitForTimeout(300);
await probe("corner 1");
await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.55);
await page.waitForTimeout(400);
await probe("corner 2 / created");

await page.click(".leaflet-pm-icon-delete");
await probe("removal armed");
await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.42);
await page.waitForTimeout(400);
await probe("removal click");

await browser.close();
server.close();
