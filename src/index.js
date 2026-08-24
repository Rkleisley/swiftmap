// swiftmap-core: framework-agnostic entry point.
//
// Everything exported here operates on a Leaflet map instance plus plain layer-config
// objects, with no dependency on Python, anywidget, or any UI framework. The anywidget
// widget (src/anywidget.js) is one consumer of this; a React or vanilla app is another.
// createSwiftMap mounts the whole map over a host (src/host.js); the rest are the
// pieces it is built from, for consumers that compose their own.

export { createSwiftMap, sendLayerWrite } from "./core.js";
export { createMapModel } from "./model.js";
export { parseTimestamp, normalizeLayerTimes, isValidPeriod } from "./times.js";
export { parseWKT, featuresOf, containsLatLon } from "./geo.js";
export { resolveStyles, normalizeStyle, popStyleOptions,
         resolveFeatureLabels } from "./style.js";
export { XYZ as BASEMAP_XYZ, PRESETS as BASEMAP_PRESETS, WMS as BASEMAP_WMS,
         DEFAULT_BASEMAPS, queryKey as basemapQueryKey } from "./basemap-catalog.js";
export { mapColors, mapRadii, resolveColormap, registerColormap,
         dataDrivenLegend, COLORMAPS, CATEGORICAL_PALETTES } from "./colormaps.js";
export { createHostStub } from "./host.js";
export { decodeBase64Buffers, decodeBase64BuffersReusing } from "./transport.js";
export { provideLeaflet, requireLeaflet } from "./libs.js";
export { loadLibraries, LIBRARY_URLS } from "./loader.js";
export { applySwiftmapPatch, isLayerEffectiveVisible, collectWebglLayers,
         collectPointLayersAll } from "./patch.js";
export { renderLayer, renderMergedGlLayer, styleFor, getIndexedProperties } from "./layers.js";
export { renderSidebarControls, normalizeRadioLayers, getLayerBounds,
         sidebarCollapseState } from "./sidebar.js";
export { deriveLegendSpec, renderLegend, formatBound } from "./legend.js";
export { collectLayerProblems, warnLayerProblems } from "./validate.js";
export { collectLabels, renderLabels } from "./labels.js";
export { pinShader } from "./shaders.js";
export { parsePeriod, addPeriod, generateTicks, windowFor, featureInWindow,
         timesFor, layerInWindow, collectTimeExtent, hasTimeLayers,
         renderTimeControl } from "./timecontrol.js";
export {
    layersBoundsUnion,
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
