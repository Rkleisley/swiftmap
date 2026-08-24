// The CDN-variant anywidget entry -- the fallback, not the shipped artifact.
//
// The canonical widget bundle (src/anywidget.js -> swiftmap/static/widget.js)
// carries Leaflet, glify and Geoman inside it, so notebooks and Shiny apps run
// with no network at all. This variant instead fetches them at view time from
// the URLs in src/loader.js (a receiving network's patcher rewrites those like
// any CDN reference), and exists for one workflow: rebuilding the widget from
// edited source WITHOUT Node -- tools/bundle.py can flatten swiftmap's own
// modules but cannot resolve node_modules, so it builds this entry.
import { createSwiftMap } from "./core.js";
import { loadLibraries } from "./loader.js";

export { createHostStub } from "./host.js";
export { decodeBase64Buffers } from "./transport.js";

export default {
    async render({ model, el }) {
        const leaflet = await loadLibraries();
        const handle = await createSwiftMap({ host: model, el, leaflet });
        return () => handle.destroy();
    },
};
