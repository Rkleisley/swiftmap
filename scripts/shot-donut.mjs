// One-off: renders a fixture and saves a screenshot for eyeball verification.
// Usage: node scripts/shot-donut.mjs [out.png] [fixture.html]  (defaults: donut.png,
// widget-vector.html). Lives in scripts/, NOT test/: node --test executes every file
// under a test directory, and a browser-launching helper inside the suite run starves
// the SwiftShader frame budget the screenshot differentials depend on.
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
    } catch {
        res.writeHead(404).end("not found");
    }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const fixture = process.argv[3] || "widget-vector.html";
await page.goto(`http://127.0.0.1:${port}/test/fixtures/${fixture}`);
await page.waitForFunction("window.__ready === true", { timeout: 30000 });
await page.waitForSelector(".leaflet-polygons-pane canvas", { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: process.argv[2] || "donut.png" });
await browser.close();
server.close();
console.log("saved", process.argv[2] || "donut.png");
