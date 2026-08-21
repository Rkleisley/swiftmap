// The CDN loader, for hosts whose page has no bundler: the anywidget widget and
// a static export. Fetches Leaflet, glify and Geoman from unpkg -- a receiving
// network's patcher rewrites these URLs like any other CDN reference -- and then
// provides the global they install. Everything is awaited before returning, so
// Geoman exists before any map is built. The URL table is a parameter so a
// vendored or inlined variant is a matter of passing different ones.
import { loadCSS, loadJS } from "./utils.js";
import { provideLeaflet } from "./libs.js";

export const LIBRARY_URLS = {
    leafletCss: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    leafletJs: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    glifyJs: "https://unpkg.com/leaflet.glify@3.3.0/dist/glify-browser.js",
    geomanCss: "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.css",
    geomanJs: "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.min.js",
};

export async function loadLibraries(urls = LIBRARY_URLS) {
    loadCSS("leaflet-css", urls.leafletCss);
    await loadJS("leaflet-js", urls.leafletJs);
    await loadJS("leaflet-glify", urls.glifyJs);
    loadCSS("leaflet-geoman-css", urls.geomanCss);
    await loadJS("leaflet-geoman", urls.geomanJs);
    return provideLeaflet(window.L);
}
