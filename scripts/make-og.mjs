// Renders docs/assets/og.png -- the social card for the docs site.
//
// The card is a real screenshot of the hero map drawing a million points, not a
// mockup: serve docs/ locally, load the page, promote the 1M tier, collapse the
// headline block so the map fills the frame, and shoot 1200x630 at 2x.
//
//   node scripts/make-og.mjs [url] [outfile]
import { chromium } from "playwright";

const URL = process.argv[2] || "http://127.0.0.1:8137/";
const OUT = process.argv[3] || "docs/assets/og.png";

const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });

const veilGone = () => page.waitForFunction(() => {
    const v = document.querySelector("#hero-stage .veil");
    if (!v) return true;
    const cs = getComputedStyle(v);
    return cs.display === "none" || cs.opacity === "0" || cs.visibility === "hidden";
}, { timeout: 60000 });

await veilGone();

// The headline says a million, so the card should show a million.
const mil = await page.$('[data-tier="hero-1m"]');
if (mil) {
    await mil.click();
    await page.waitForTimeout(1500);
    await veilGone();
    console.log("  promoted to the 1M tier");
}
await page.waitForTimeout(7000);   // tiles, then the glify draw

// Drag once so the fps readout holds a real number rather than an em dash.
const box = await page.locator("#hero-stage .map").boundingBox();
if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx - i * 7, cy - i * 3);
    await page.mouse.up();
    await page.waitForTimeout(2500);
}

// Collapse the copy so the map -- the whole argument -- owns the frame.
await page.addStyleTag({ content: `
    .hero .lede, .hero .ladder .wt { display: none !important; }
    /* fps only fills while a drag is in flight -- an em dash reads as broken. */
    .hero .readout .stat:has(#hero-fps) { display: none !important; }
    .hero { padding-top: 18px !important; padding-bottom: 0 !important; }
    .hero h1 { font-size: 40px !important; line-height: 1.05 !important; margin: 0 0 14px !important; }
    .hero .stage { height: 380px !important; min-height: 380px !important; }
    .hero .ladder { margin-top: 10px !important; }
`});
await page.evaluate(() => window.scrollTo(0, 0));   // the drag scrolled us off the hero
await page.waitForTimeout(1500);

const readout = await page.evaluate(() => ({
    points: document.querySelector("#hero-points")?.textContent?.trim(),
    ms: document.querySelector("#hero-ms")?.textContent?.trim(),
    fps: document.querySelector("#hero-fps")?.textContent?.trim(),
}));
console.log("  readout:", JSON.stringify(readout));

await page.screenshot({ path: OUT });
console.log("  wrote", OUT);

await browser.close();
