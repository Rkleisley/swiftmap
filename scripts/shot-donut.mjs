// One-off: renders widget-vector.html and saves a screenshot of the donut polygon,
// for eyeball verification that the hole actually renders. Not part of the suite.
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
await page.goto(`http://127.0.0.1:${port}/test/fixtures/widget-vector.html`);
await page.waitForFunction("window.__ready === true", { timeout: 30000 });
await page.waitForSelector(".leaflet-polygons-pane canvas", { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: process.argv[2] || "donut.png" });
await browser.close();
server.close();
console.log("saved", process.argv[2] || "donut.png");
