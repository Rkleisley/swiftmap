// <SwiftMap>: the React host over the swiftmap core.
//
// One more host over the same five-method interface the widget and the static
// export drive -- not a second rendering path. Props become host state (each
// change fires the core's own change handlers, the path a trait snapshot takes
// in the widget); the core's write-backs become callbacks; and the ref exposes
// applyPatch, the widget's incremental patch path, for live feeds.
//
// React's realities: strict mode mounts, unmounts and remounts synchronously --
// the map is created a microtask later, so the throwaway mount never builds one
// and exactly one map exists; unmount tears down timers, the resize observer, the
// console hooks, and the Leaflet map with every GL context and blob URL its
// layers hold (core.destroy), even while the first sync is still in flight.
//
// Dependencies are the consumer's: react, leaflet, leaflet.glify and Geoman are
// peers imported here, never fetched. Include leaflet.css, leaflet-geoman.css and
// swiftmap.css from your bundler; this file imports no CSS on your behalf.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle,
               useReducer, useRef } from "react";
import L from "leaflet";
// The bare specifier resolves to dist/glify-browser.js through the package's
// browser/module fields under every browser-target bundler (verified against
// esbuild's metafile); only CJS require or platform:node reaches dist/glify.js.
// An earlier commit blamed a build divergence for blank vectors and pinned the
// deep path -- the React port's round-4 review showed the real culprit was the
// WebGL context loss fixed alongside, so the fragile deep import (it bypasses
// field resolution and would hard-fail if glify ever adds an exports map) goes.
import glify from "leaflet.glify";
import "@geoman-io/leaflet-geoman-free";
import { createSwiftMap } from "./core.js";
import { createHostStub } from "./host.js";
import { layersBoundsUnion } from "./utils.js";

// glify attaches itself to window.L at import when Leaflet is already there
// (Leaflet's own UMD sets window.L even under a bundler); belt and braces for a
// bundler that evaluated them in another order.
if (L && !L.glify) L.glify = glify;

// prop -> host key. Everything the core reads is reachable as a prop.
const PROP_KEYS = {
    layers: "layers",
    buffers: "coordinate_buffers",
    groupConfigs: "group_configs",
    center: "center",
    zoom: "zoom",
    crs: "crs",
    height: "height",
    showLegend: "show_legend",
    legendConfig: "legend_config",
    showScale: "show_scale",
    scaleConfig: "scale_config",
    showDraw: "show_draw",
    drawConfig: "draw_config",
    drawings: "drawings",
    timeConfig: "time_config",
    timeCurrent: "time_current",
    showLogo: "show_logo",
    logoConfig: "logo_config",
    showClickCoordinates: "show_click_coordinates",
    fitBoundsRequest: "fit_bounds_request",
};
const PROP_NAMES = Object.keys(PROP_KEYS);

const DEFAULTS = {
    layers: [], coordinate_buffers: {}, group_configs: {},
    // A neutral opening view; a map given data and no view auto-fits instead
    // (below), matching Python's Map().
    center: [0, 0], zoom: 2, crs: "EPSG:3857", height: "",
    auto_sync: true, sync_trigger: 0,
    show_logo: false, logo_config: {}, show_legend: false, legend_config: {},
    show_scale: false, scale_config: {}, show_draw: false, draw_config: {},
    drawings: [], draw_seq: 0, show_click_coordinates: false,
    time_config: {}, time_current: 0, fit_bounds_request: {},
    clicked_layer_id: "", selected_index: -1, clicked_latlng: [], click_seq: 0,
    js_console_logs: [],
};

function stateFromProps(props) {
    const state = { ...DEFAULTS };
    for (const [prop, key] of Object.entries(PROP_KEYS)) {
        if (props[prop] !== undefined) state[key] = props[prop];
    }
    // Python's Map() auto-fits when built with no explicit view; this host
    // matches it. No center, no zoom, no fit of your own -> open on the data,
    // with the same request shape and ceilings the Python side sends.
    if (props.center === undefined && props.zoom === undefined
            && props.fitBoundsRequest === undefined) {
        const union = layersBoundsUnion(state.layers);
        if (union) {
            state.fit_bounds_request = { bounds: union, max_zoom: 15, padding: 30, seq: 1 };
        }
    }
    return state;
}

export const SwiftMap = forwardRef(function SwiftMap(props, ref) {
    const elRef = useRef(null);
    const hostRef = useRef(null);
    const handleRef = useRef(null);
    const latest = useRef(props);     // the host hooks read the newest callbacks
    latest.current = props;
    const applying = useRef(false);   // prop writes must not echo as callbacks

    useEffect(() => {
        const el = elRef.current;
        const pending = new Set();
        const host = createHostStub(stateFromProps(latest.current), {
            // The sidebar's toggle write-back arrives as a message, as it does
            // in Python; the folder flags it changed ride group_configs.
            onSend: (content) => {
                if (content && content.kind === "swiftmap_write") {
                    const fn = latest.current.onLayerToggle;
                    if (fn) fn({ ops: content.ops || [], groupConfigs: host.get("group_configs") });
                }
            },
            // The core writes a group of keys, then saves: one callback per save.
            onSave: () => {
                const keys = [...pending];
                pending.clear();
                if (!keys.length) return;
                const cb = latest.current;
                const has = (...ks) => ks.some(k => keys.includes(k));
                if (has("center", "zoom") && cb.onViewChange) {
                    cb.onViewChange({ center: host.get("center"), zoom: host.get("zoom") });
                }
                if (has("click_seq") && cb.onFeatureClick) {
                    cb.onFeatureClick({
                        layerId: host.get("clicked_layer_id"),
                        index: host.get("selected_index"),
                        latlng: host.get("clicked_latlng"),
                        seq: host.get("click_seq"),
                    });
                }
                if (has("drawings", "draw_seq") && cb.onDrawChange) {
                    cb.onDrawChange({ drawings: host.get("drawings"), seq: host.get("draw_seq") });
                }
                if (has("time_current", "time_config") && cb.onTimeChange) {
                    cb.onTimeChange({ timeCurrent: host.get("time_current"),
                                      timeConfig: host.get("time_config") });
                }
                if (has("group_configs") && cb.onLayerToggle) {
                    cb.onLayerToggle({ ops: [], groupConfigs: host.get("group_configs") });
                }
            },
        });
        // Core-originated writes are collected for the next save; prop-originated
        // ones (applying) are the app's own and never echo back to it.
        const set = host.set;
        host.set = (key, value) => {
            set(key, value);
            if (!applying.current) pending.add(key);
        };
        hostRef.current = host;

        // Strict mode runs mount, cleanup and mount again synchronously: creating
        // the map a microtask later means the throwaway mount never builds one.
        // A real unmount while the map is still being built is destroyed on arrival.
        let cancelled = false;
        Promise.resolve().then(() => {
            if (cancelled) return;
            return createSwiftMap({ host, el, leaflet: L }).then((handle) => {
                if (cancelled) handle.destroy();
                else handleRef.current = handle;
            });
        });
        return () => {
            cancelled = true;
            if (handleRef.current) handleRef.current.destroy();
            handleRef.current = null;
            hostRef.current = null;
        };
    }, []);

    // Prop updates flow into the host as state changes, which fire the core's own
    // change handlers -- the same path a trait snapshot takes in the widget. A
    // new `buffers` object is a new identity to the GL meta key, so it rebuilds.
    //
    // A prop is applied only when IT changed, never because it differs from the
    // host's state: the core moves keys of its own (a pan moves center, the
    // slider moves time_current), and comparing against host state re-asserted
    // every stale prop on every app re-render -- one log line snapped the
    // slider, or the viewport, back to the opening values.
    const prevProps = useRef({});
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        applying.current = true;
        try {
            for (const [prop, key] of Object.entries(PROP_KEYS)) {
                const value = props[prop];
                const previous = prevProps.current[prop];
                prevProps.current[prop] = value;
                if (value !== undefined && value !== previous
                        && host.get(key) !== value) {
                    host.set(key, value);
                }
            }
        } finally {
            applying.current = false;
        }
    }, PROP_NAMES.map(name => props[name]));   // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({
        get map() { return handleRef.current ? handleRef.current.map : null; },
        get host() { return hostRef.current; },
        // The widget's own incremental path: patch ops with binary buffers --
        // buffer_append / append / set for a live feed, exactly as Python sends them.
        applyPatch(ops, buffers = []) {
            const host = hostRef.current;
            if (host) host.emit("msg:custom", { kind: "swiftmap_patch", ops }, buffers);
        },
        sync() {
            if (handleRef.current) handleRef.current.sync();
        },
    }), []);

    return (
        <div ref={elRef} className={props.className}
             style={{ width: "100%", height: props.height || "100%", ...(props.style || {}) }} />
    );
});

// Build a map model once and mutate it Python-style. `mutate` runs your
// function against the model and re-renders, so a fresh `model.props()` spread
// reaches <SwiftMap> with new identities exactly where something changed --
// the mutate-then-snapshot shape @map_effect gives Shiny.
export function useSwiftMapModel(build) {
    const modelRef = useRef(null);
    if (!modelRef.current) modelRef.current = build();
    const [, force] = useReducer(c => c + 1, 0);
    const mutate = useCallback((fn) => {
        const result = fn ? fn(modelRef.current) : undefined;
        force();
        return result;
    }, []);
    return [modelRef.current, mutate];
}

// The feed mode: every op the model emits flows straight to the map through
// applyPatch -- the widget's own incremental path, so an append's wire cost is
// the batch, never the layer. The contract: snapshot model.props() ONCE for the
// initial render and drive every later change through the model, or the change
// arrives twice (once as a patch, once as new props). Do not mix this with
// re-spreading fresh props for the same mutation.
export function useSwiftMapFeed(model, mapRef) {
    useEffect(() => model.subscribe((op, buffer) => {
        const handle = mapRef.current;
        if (!handle) return;
        handle.applyPatch([buffer ? { ...op, buffer_index: 0 } : op],
                          buffer ? [buffer] : []);
    }), [model, mapRef]);
}

export default SwiftMap;
