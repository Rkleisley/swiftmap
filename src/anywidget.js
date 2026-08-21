// The anywidget adapter: one host over the swiftmap core.
//
// anywidget's model already IS a host -- get/set/on/send/save_changes, with
// `change:<key>` and `msg:custom` events -- so nothing is translated here. The
// cleanup returned tears the map down when anywidget discards the view.
import { createSwiftMap } from "./core.js";
import { loadLibraries } from "./loader.js";

export { createHostStub } from "./host.js";

export default {
    async render({ model, el }) {
        // This host's page has no bundler: Leaflet, glify and Geoman come from
        // the CDN, fully loaded before the map is constructed.
        const leaflet = await loadLibraries();
        const handle = await createSwiftMap({ host: model, el, leaflet });
        return () => handle.destroy();
    },
};
