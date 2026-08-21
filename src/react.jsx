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
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import glify from "leaflet.glify";
import "@geoman-io/leaflet-geoman-free";
import { createSwiftMap } from "./core.js";
import { createHostStub } from "./host.js";

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
    center: [36.0, -5.35], zoom: 10, crs: "EPSG:3857", height: "",
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
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        applying.current = true;
        try {
            for (const [prop, key] of Object.entries(PROP_KEYS)) {
                const value = props[prop];
                if (value !== undefined && host.get(key) !== value) host.set(key, value);
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

export default SwiftMap;
