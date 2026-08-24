// The libraries the core renders with, PROVIDED by the host before the map is
// constructed -- never reached for as globals. `L` is a live binding: every
// module imports it from here and sees whatever provideLeaflet set.
//
// Two kinds of host. The widget and a static export fetch Leaflet, glify and
// Geoman at runtime (src/loader.js, the CDN fallback the no-Node rebuild
// uses), because their page has no bundler; an npm
// consumer imports them as real dependencies and passes the result in. Either
// way the ORDER is fixed by construction: Geoman attaches map.pm through a
// Leaflet init hook that only runs for maps created after the plugin exists
// (5394d1e), so providing must finish before createSwiftMap builds the map --
// which is why the core takes Leaflet as an argument and never loads it lazily.
export let L = null;

export function provideLeaflet(leaflet) {
    if (!leaflet || typeof leaflet.map !== "function") {
        throw new Error("swiftmap: provideLeaflet expects the Leaflet namespace (L)");
    }
    if (!leaflet.glify) {
        console.warn("[SwiftMap] provideLeaflet: L.glify is missing -- import "
            + "leaflet.glify before providing, or no WebGL layer will draw.");
    }
    if (!leaflet.PM) {
        console.warn("[SwiftMap] provideLeaflet: Leaflet-Geoman is missing -- the "
            + "draw/AOI toolbar will be unavailable.");
    }
    L = leaflet;
    return L;
}

export function requireLeaflet() {
    if (!L) {
        throw new Error("swiftmap: no Leaflet provided. Pass `leaflet` to "
            + "createSwiftMap, call provideLeaflet(L), or use loadLibraries() on a "
            + "page that loads from a CDN.");
    }
    return L;
}
