// createMapModel: the authoring surface in JS.
//
// Phase 3's first stage. The rendering core (createSwiftMap) has been
// framework-agnostic since Phase 2, but everything that BUILDS what it renders --
// add_circle_markers, the merge rule, bounds, the buffer packing -- lived only in
// Python, so a JS app hand-wrote configs at every call site or grew a model layer
// of its own (react_test_app/GAPS.md, gap 1). This is that layer, in the core,
// with Python's Map as its specification.
//
// CONFORMANCE, not translation: there is no runtime bridge between the two sides
// (the server has no JS engine, the browser no Python), so the rules exist twice
// and are held together by golden fixtures. scripts/authoring_goldens.py builds
// canonical scenarios through the real Python Map and commits the exact state and
// buffers; tests/test_authoring_goldens.py keeps Python matching them, and
// test/tier1-model.test.mjs keeps THIS FILE matching them, byte-for-byte on
// buffers. A rule changed on either side breaks a suite loudly.
//
// The shape is Python's, deliberately: mutate the model, then snapshot. Mutators
// rebuild the arrays they touch, so a snapshot's identities change exactly when
// something changed -- what React needs, and the same invariant Python's
// transport keeps for its own reasons.
//
// Stage 1 covers: circle markers, pin markers, lines, polygons; column-dict,
// row-object and coordinate-pair inputs; default folders and group_configs;
// multi_select radio seeding; the same-name merge promotion (the group minting
// its own id); bounds and the auto-fit union. Data-driven colour/size, WKT and
// GeoJSON ingestion, query/select/update and time layers are later stages.

import { layersBoundsUnion } from "./utils.js";
import { resolveColormap, dataDrivenColors, dataDrivenRadii,
         dataDrivenLegend, dataDrivenSizeLegend } from "./colormaps.js";

// What Python seeds every map with (basemap_registry.DEFAULT_BASEMAPS): OSM
// visible, Dark Matter hidden, radio-grouped. The full name-callable catalogue
// is a later stage; these two are the contract every map starts from.
export const DEFAULT_BASEMAPS = [
    {
        name: "Open Street Map",
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors",
        max_native_zoom: 19, max_zoom: 22, visible: true,
    },
    {
        name: "Dark Matter",
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors &copy; <a href=\"https://carto.com/attributions\">CARTO</a>",
        max_native_zoom: 20, max_zoom: 22, subdomains: "abcd", visible: false,
    },
];

// An option under either naming convention: the JS surface takes camelCase, the
// wire and anyone porting Python code takes snake_case, both mean the same thing.
function opt(options, camel, snake, fallback) {
    if (options[camel] !== undefined) return options[camel];
    if (options[snake] !== undefined) return options[snake];
    return fallback;
}

function packPairs(pairs) {
    const flat = new Float64Array(pairs.length * 2);
    for (let i = 0; i < pairs.length; i++) {
        flat[i * 2] = pairs[i][0];
        flat[i * 2 + 1] = pairs[i][1];
    }
    return new DataView(flat.buffer);
}

function boundsOfPairs(pairs) {
    if (!pairs.length) return null;
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const [lat, lon] of pairs) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
    }
    return [[minLat, minLon], [maxLat, maxLon]];
}

const LAT_NAMES = ["lat", "latitude", "y"];
const LON_NAMES = ["lon", "lng", "long", "longitude", "x"];

function findColumn(keys, wanted, explicit) {
    if (explicit) return explicit;
    const lower = keys.map(k => k.toLowerCase());
    for (const name of wanted) {
        const i = lower.indexOf(name);
        if (i !== -1) return keys[i];
    }
    return null;
}

// Points from the three JS-native shapes: [[lat, lon], ...], a column dict
// ({lat: [...], lon: [...], other: [...]}), or rows of objects. Returns
// { pairs, properties } with the coordinate columns removed from properties.
function normalizePoints(data, options = {}) {
    const latCol = opt(options, "latCol", "lat_col");
    const lonCol = opt(options, "lonCol", "lon_col");
    if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
        return { pairs: data.map(p => [Number(p[0]), Number(p[1])]), properties: {} };
    }
    let columns;
    if (Array.isArray(data)) {                        // rows of objects
        columns = {};
        for (const row of data) {
            for (const key of Object.keys(row)) (columns[key] = columns[key] || []);
        }
        for (const row of data) {
            for (const key of Object.keys(columns)) columns[key].push(row[key] ?? null);
        }
    } else if (data && typeof data === "object") {    // column dict
        columns = {};
        for (const [key, values] of Object.entries(data)) {
            columns[key] = Array.isArray(values) ? values.slice() : values;
        }
    } else {
        throw new Error("swiftmap model: unsupported data shape");
    }
    const keys = Object.keys(columns);
    const lat = findColumn(keys, LAT_NAMES, latCol);
    const lon = findColumn(keys, LON_NAMES, lonCol);
    if (!lat || !lon) throw new Error("swiftmap model: no lat/lon columns found");
    const n = columns[lat].length;
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([Number(columns[lat][i]), Number(columns[lon][i])]);
    const properties = {};
    for (const key of keys) {
        if (key !== lat && key !== lon) properties[key] = columns[key];
    }
    return { pairs, properties };
}

export function createMapModel(options = {}) {
    // The same trait defaults Python's Map opens with; the auto-fit below makes
    // the opening view data-driven anyway, exactly as it does there.
    const state = {
        layers: [],
        group_configs: {},
        center: opt(options, "center", "center", [36.0, -5.35]),
        zoom: opt(options, "zoom", "zoom", 10),
        crs: opt(options, "crs", "crs", "EPSG:3857"),
        height: opt(options, "height", "height", ""),
        auto_sync: true, sync_trigger: 0,
        show_logo: false, logo_config: {},
        show_legend: opt(options, "showLegend", "show_legend", false), legend_config: {},
        show_scale: opt(options, "showScale", "show_scale", false), scale_config: {},
        show_draw: opt(options, "showDraw", "show_draw", false), draw_config: {},
        drawings: [], draw_seq: 0,
        show_click_coordinates: opt(options, "showClickCoordinates", "show_click_coordinates", false),
        time_config: {}, time_current: 0,
        fit_bounds_request: {},
    };
    const buffers = {};
    let counter = 0;
    let fitSeq = 0;
    let autoFitArmed = options.center === undefined && options.zoom === undefined;
    let autoFitBounds = null;

    const nextId = () => `layer_${counter++}`;

    // --- the rules Python's _add_child applies -------------------------------------

    function ensureGroupConfig(group, multiSelect) {
        const existing = state.group_configs[group];
        const isNew = !existing || existing.multi_select === undefined;
        if (isNew || multiSelect !== undefined) {
            state.group_configs = {
                ...state.group_configs,
                [group]: { ...existing, multi_select: multiSelect !== undefined ? multiSelect : true },
            };
        }
    }

    // A single-select folder shows one layer at a time: a newcomer to a folder
    // that already shows something starts hidden.
    function radioAdjust(layer) {
        const info = state.group_configs[layer.layer_group] || {};
        if (info.multi_select !== false) return;
        const hasVisible = state.layers.some(l =>
            l.layer_group === layer.layer_group && l.visible !== false);
        if (hasVisible) layer.visible = false;
    }

    function autoFitExtend(bounds) {
        if (!autoFitArmed || !bounds) return;
        autoFitBounds = layersBoundsUnion([{ bounds }, autoFitBounds && { bounds: autoFitBounds }]);
        fitSeq += 1;
        state.fit_bounds_request = {
            bounds: [autoFitBounds[0].slice(), autoFitBounds[1].slice()],
            zoom_offset: 0, max_zoom: 15, padding: 30, seq: fitSeq,
        };
    }

    // Same name + same folder joins the existing layer: the two become one
    // collection -- a type "group" entry with the members nested under `layers`,
    // stripped of their own layer_group, and an id of the group's own. One
    // sidebar entry, selected as one unit (the merge rule Python applies).
    function place(layer) {
        const twinIndex = state.layers.findIndex(l =>
            l.type !== "basemap" && l.name === layer.name
            && l.layer_group === layer.layer_group);
        if (twinIndex === -1) {
            state.layers = [...state.layers, layer];
            return;
        }
        const twin = state.layers[twinIndex];
        const asMember = (config) => {
            const member = { ...config };
            delete member.layer_group;
            return member;
        };
        let group;
        if (twin.type === "group") {
            group = { ...twin, layers: [...twin.layers, asMember(layer)] };
        } else {
            group = {
                id: nextId(), type: "group", name: layer.name,
                layer_group: layer.layer_group, visible: true,
                autobind_popup: true, autobind_tooltip: true,
                layers: [asMember(twin), asMember(layer)],
            };
        }
        state.layers = state.layers.map((l, i) => (i === twinIndex ? group : l));
    }

    function addLayer(layer, pairs, options, defaultGroup) {
        layer.layer_group = opt(options, "layerGroup", "layer_group", defaultGroup);
        const multiSelect = opt(options, "multiSelect", "multi_select",
            opt(options, "groupMultiSelect", "group_multi_select"));
        ensureGroupConfig(layer.layer_group, multiSelect);
        radioAdjust(layer);
        const displayKeys = [
            ["popupFields", "popup_fields"], ["popupNames", "popup_names"],
            ["tooltipFields", "tooltip_fields"], ["tooltipNames", "tooltip_names"],
            ["popupTemplate", "popup_template"], ["tooltipTemplate", "tooltip_template"],
            ["popupStyle", "popup_style"], ["tooltipStyle", "tooltip_style"],
            ["popupMaxWidth", "popup_max_width"], ["label", "label"],
        ];
        for (const [camel, snake] of displayKeys) {
            const value = opt(options, camel, snake);
            if (value !== undefined) layer[snake] = value;
        }
        const bounds = boundsOfPairs(pairs);
        if (bounds) layer.bounds = bounds;
        buffersSet(layer.id, packPairs(pairs));
        place(layer);
        autoFitExtend(bounds);
        return layer;
    }

    function buffersSet(key, view) {
        buffers[key] = view;
    }

    // --- builders --------------------------------------------------------------------

    // color_col / radius_col do three jobs in one call, exactly as in Python: the
    // buffer the GPU draws, and the legend block that describes it, from the same
    // arithmetic -- so the legend cannot disagree with the pixels (GAPS.md gap 4).
    function applyDataDriven(layer, options, method) {
        const dataOpts = {
            color_col: opt(options, "colorCol", "color_col") ?? null,
            colormap: resolveColormap(opt(options, "colormap", "colormap") ?? null),
            vmin: opt(options, "vmin", "vmin") ?? null,
            vmax: opt(options, "vmax", "vmax") ?? null,
            color_bins: opt(options, "colorBins", "color_bins") ?? null,
            radius_col: opt(options, "radiusCol", "radius_col") ?? null,
            radius_range: opt(options, "radiusRange", "radius_range") ?? [3.0, 18.0],
        };
        const colors = dataDrivenColors(layer.properties, dataOpts, layer.color, method);
        if (colors) buffersSet(`${layer.id}::colors`, new DataView(colors.buffer));
        const radii = dataDrivenRadii(layer.properties, dataOpts, method);
        if (radii) buffersSet(`${layer.id}::radii`, new DataView(radii.buffer));
        const legend = dataDrivenLegend(layer.properties, dataOpts, layer.color);
        if (legend) layer.legend = legend;
        const sizeLegend = dataDrivenSizeLegend(layer.properties, dataOpts);
        if (sizeLegend) layer.legend_size = sizeLegend;
    }

    function addCircleMarkers(data, options = {}) {
        const { pairs, properties } = normalizePoints(data, options);
        const layer = {
            id: nextId(), type: "circle_markers",
            name: options.name || "Circle Markers",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            radius: options.radius !== undefined ? options.radius : 10,
            color: options.color || "#3388ff",
            fillColor: opt(options, "fillColor", "fill_color", "#3388ff"),
            fillOpacity: opt(options, "fillOpacity", "fill_opacity", 0.2),
            weight: options.weight !== undefined ? options.weight : 3,
            opacity: options.opacity !== undefined ? options.opacity : 1.0,
            properties,
        };
        applyDataDriven(layer, options, "addCircleMarkers");
        addLayer(layer, pairs, options, "Circle Markers Group");
        return model;
    }

    function addMarkers(data, options = {}) {
        const { pairs, properties } = normalizePoints(data, options);
        const layer = {
            id: nextId(), type: "markers",
            name: options.name || "Markers",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            color: options.color || "#e61a26",
            properties,
        };
        applyDataDriven(layer, options, "addMarkers");
        addLayer(layer, pairs, options, "Markers Group");
        return model;
    }

    function addLine(coords, options = {}) {
        const pairs = coords.map(p => [Number(p[0]), Number(p[1])]);
        const layer = {
            id: nextId(), type: "polyline",
            name: options.name || "Line",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            color: options.color || "#3388ff",
            weight: options.weight !== undefined ? options.weight : 3,
            opacity: options.opacity !== undefined ? options.opacity : 1.0,
            properties: options.properties || {},
        };
        addLayer(layer, pairs, options, "Line Group");
        return model;
    }

    function addPolygon(coords, options = {}) {
        const ring = coords.map(p => [Number(p[0]), Number(p[1])]);
        const [f, l] = [ring[0], ring[ring.length - 1]];
        if (f && (f[0] !== l[0] || f[1] !== l[1])) ring.push([f[0], f[1]]);
        const layer = {
            id: nextId(), type: "polygon",
            name: options.name || "Polygon",
            visible: options.visible !== undefined ? options.visible : true,
            autobind_popup: true, autobind_tooltip: true,
            color: options.color || "#3388ff",
            fillOpacity: opt(options, "fillOpacity", "fill_opacity", 0.2),
            weight: options.weight !== undefined ? options.weight : 3,
            opacity: options.opacity !== undefined ? options.opacity : 1.0,
            properties: options.properties || {},
        };
        const fillColor = opt(options, "fillColor", "fill_color");
        if (fillColor !== undefined) layer.fillColor = fillColor;
        addLayer(layer, ring, options, "Polygon Group");
        return model;
    }

    // --- output ---------------------------------------------------------------------

    // The host-state shape: exactly what a trait snapshot carries, so it can feed
    // createHostStub directly -- and what the conformance suite compares.
    function wireState() {
        return { ...state, coordinate_buffers: { ...buffers } };
    }

    // <SwiftMap>'s props. Mutators rebuild what they touch, so these identities
    // change exactly when something did.
    function props() {
        return {
            layers: state.layers,
            buffers,
            groupConfigs: state.group_configs,
            center: state.center, zoom: state.zoom, crs: state.crs,
            height: state.height || undefined,
            showLegend: state.show_legend, legendConfig: state.legend_config,
            showScale: state.show_scale, scaleConfig: state.scale_config,
            showDraw: state.show_draw, drawConfig: state.draw_config,
            drawings: state.drawings,
            timeConfig: state.time_config, timeCurrent: state.time_current,
            showClickCoordinates: state.show_click_coordinates,
            fitBoundsRequest: state.fit_bounds_request,
        };
    }

    const model = {
        addCircleMarkers, addMarkers, addLine, addPolygon,
        wireState, props,
        get layers() { return state.layers; },
        get buffers() { return buffers; },
    };

    // Every map starts from the seeded basemaps, radio-grouped, like Python's.
    if (opt(options, "basemaps", "basemaps") !== false) {
        ensureGroupConfig("Basemaps", false);
        for (const spec of DEFAULT_BASEMAPS) {
            state.layers = [...state.layers, {
                id: nextId(), type: "basemap", layer_group: "Basemaps", ...spec,
            }];
        }
    }

    return model;
}
