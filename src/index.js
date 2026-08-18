// swiftmap-core: framework-agnostic entry point.
//
// Everything exported here operates on a Leaflet map instance plus plain layer-config
// objects, with no dependency on Python, anywidget, or any UI framework. The anywidget
// widget (src/anywidget.js) is one consumer of this; a React or vanilla app is another.

export { applySwiftmapPatch, isLayerEffectiveVisible, collectWebglLayers,
         collectPointLayersAll } from "./map.js";
export { renderLayer, renderMergedGlLayer, styleFor, getIndexedProperties } from "./layers.js";
export { renderSidebarControls, normalizeRadioLayers, getLayerBounds, sendLayerWrite } from "./sidebar.js";
export { deriveLegendSpec, renderLegend } from "./legend.js";
export { collectLabels, renderLabels } from "./labels.js";
export { pinShader } from "./shaders.js";
export { parsePeriod, addPeriod, generateTicks, windowFor, featureInWindow,
         timesFor, layerInWindow, collectTimeExtent, hasTimeLayers,
         renderTimeControl } from "./timecontrol.js";
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
