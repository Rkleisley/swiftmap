// swiftmap-core: framework-agnostic entry point.
//
// Everything exported here operates on a Leaflet map instance plus plain layer-config
// objects, with no dependency on Python, anywidget, or any UI framework. The anywidget
// widget (src/anywidget.js) is one consumer of this; a React or vanilla app is another.

export { applySwiftmapPatch } from "./map.js";
export { renderLayer, renderMergedGlLayer } from "./layers.js";
export { renderSidebarControls, normalizeRadioLayers } from "./sidebar.js";
export { pinShader } from "./shaders.js";
export {
    parseColor,
    formatPropertiesHTML,
    bindPopup,
    bindTooltip,
    loadCSS,
    loadJS,
} from "./utils.js";
