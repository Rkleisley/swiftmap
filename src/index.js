// swiftmap-core: framework-agnostic entry point.
//
// Everything exported here operates on a Leaflet map instance plus plain layer-config
// objects, with no dependency on Python, anywidget, or any UI framework. The anywidget
// widget (src/anywidget.js) is one consumer of this; a React or vanilla app is another.

export { applySwiftmapPatch, isLayerEffectiveVisible, collectWebglLayers } from "./map.js";
export { renderLayer, renderMergedGlLayer, styleFor, getIndexedProperties } from "./layers.js";
export { renderSidebarControls, normalizeRadioLayers, getLayerBounds } from "./sidebar.js";
export { pinShader } from "./shaders.js";
export {
    parseColor,
    escapeHtml,
    safeUrl,
    renderContent,
    formatPropertiesHTML,
    bindPopup,
    bindTooltip,
    loadCSS,
    loadJS,
} from "./utils.js";
