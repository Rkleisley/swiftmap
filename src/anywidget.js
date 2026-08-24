// The anywidget adapter: one host over the swiftmap core.
//
// anywidget's model already IS a host -- get/set/on/send/save_changes, with
// `change:<key>` and `msg:custom` events -- so nothing is translated here. The
// cleanup returned tears the map down when anywidget discards the view.
//
// Leaflet, glify and Geoman are BUNDLED, not fetched: this entry builds into
// swiftmap/static/widget.js (and its stylesheet, leaflet.css and geoman.css
// included, images as data URIs), which ships inside the wheel -- so the
// widget, and the static export that inlines this same bundle, run with no
// network at all. That is what a closed network needs, and it also makes the
// browser test tiers hermetic. The CDN-loading variant survives as
// src/anywidget-cdn.js for the no-Node rebuild path (tools/bundle.py).
import L from "leaflet";
// glify ships two builds and they are NOT equivalent: dist/glify.js (the
// package main) renders no vector pixels under our wiring, while
// dist/glify-browser.js -- the file the CDN always served -- draws correctly.
// Import the proven artifact by path, everywhere swiftmap bundles it.
import glify from "leaflet.glify/dist/glify-browser.js";
import "@geoman-io/leaflet-geoman-free";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "./map.css";
import { createSwiftMap } from "./core.js";

export { createHostStub } from "./host.js";
// The static export decodes its base64 buffers with this (see swiftmap/export.py).
export { decodeBase64Buffers } from "./transport.js";

// glify attaches itself to window.L at import when Leaflet is already there
// (Leaflet's own UMD sets window.L even under a bundler); belt and braces for
// an evaluation order that misses it.
if (L && !L.glify) L.glify = glify;

export default {
    async render({ model, el }) {
        const handle = await createSwiftMap({ host: model, el, leaflet: L });
        return () => handle.destroy();
    },
};
