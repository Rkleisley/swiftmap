// Debug: load widget-vector.html, capture console, probe glify buffer sizes.
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
page.on("console", m => console.log("[console]", m.type(), m.text()));
page.on("pageerror", e => console.log("[pageerror]", String(e)));
await page.goto(`http://127.0.0.1:${port}/test/fixtures/widget-vector.html`);
await page.waitForFunction("window.__ready === true", { timeout: 30000 });
await page.waitForTimeout(2000);

const probe = await page.evaluate(() => {
    const li = window.L.glify.linesInstances;
    const si = window.L.glify.shapesInstances;
    const line = li[li.length - 1];
    const shape = si[si.length - 1];
    const flat = v => (v && v.length) || 0;
    return {
        lineFeatures: line.settings.data.features.length,
        lineVertices: flat(line.vertices),
        lineAllTyped: flat(line.allVerticesTyped),
        lineAll: flat(line.allVertices),
        shapeVertices: flat(shape.vertices),
    };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
server.close();
