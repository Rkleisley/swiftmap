// The Streamlit host: <SwiftMap> inside Streamlit's component protocol.
//
// Streamlit renders a component in an iframe and drives it with postMessage:
// args in through a render event on every script rerun, a value out through
// setComponentValue, the frame's height through setFrameHeight. This file is
// that protocol around the React host (src/react.jsx) -- no rendering of its own.
//
// Two things are particular to Streamlit, and both are handled here:
// - Args are JSON. Buffers arrive base64-encoded exactly as the static export
//   bakes them, and decode through the same decoder (src/transport.js).
// - Every interaction reruns the script and re-sends the args. Each render
//   carries a fingerprint the Python side computes; a render whose fingerprint
//   this page already holds is a no-op. A render with a new fingerprint flows
//   through the React host's props -- the core's own change handlers, which
//   rebuild only the layers whose config or buffers changed -- and keeps what the
//   viewer owns (their pan, their zoom, their drawings, their slider, their
//   toggles) unless Python itself moved it.
//
// Everything is bundled: React, Leaflet, glify, Geoman and the stylesheets ship
// in app.js / app.css next to index.html, so this is the one stack that works
// with no network at all.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
// The protocol class alone: the package index also exports React 16 helpers
// (withStreamlitConnection) that would bundle a second React.
import { Streamlit } from "streamlit-component-lib/dist/streamlit.js";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "./map.css";
import { SwiftMap } from "./react.jsx";
import { decodeBase64BuffersReusing } from "./transport.js";

const DEFAULT_HEIGHT_PX = 500;

// The value sent back: every key the core writes, with the same defaults the
// Python side returns before anyone has interacted (swiftmap/streamlit).
const EVENT_DEFAULTS = {
    clicked_layer_id: "", selected_index: -1, clicked_latlng: null, click_seq: 0,
    drawings: [], draw_seq: 0, center: null, zoom: null, time_current: null,
    layer_visibility: {},
};

// State keys the viewer takes over once the map is up. On a re-send where
// Python did not change one of these, the live value stays -- a filter change
// must not snap the viewer back to the opening view or wipe their drawings.
const VIEWER_KEYS = ["center", "zoom", "drawings", "time_current", "fit_bounds_request",
                     "time_config", "legend_config", "draw_config", "scale_config",
                     "logo_config", "group_configs"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The map's height is the frame's height: an iframe does not size itself, and
// Streamlit's default frame is 0px tall. Only a pixel height can be honoured
// inside a frame (a percentage would be of the frame, which is circular).
function heightPx(height) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*px\s*$/.exec(String(height || ""));
    return m ? Math.round(Number(m[1])) : DEFAULT_HEIGHT_PX;
}

const visibilityFlags = (layers, acc = {}) => {
    for (const l of layers || []) {
        acc[l.id] = l.visible;
        visibilityFlags(l.layers, acc);
    }
    return acc;
};

// Python's layer configs with the viewer's toggles re-applied wherever Python
// left a flag as it was; a flag Python changed wins and retires the viewer's.
function withViewerToggles(layers, prevFlags, live) {
    return (layers || []).map(l => {
        let out = l;
        if (l.id in live && prevFlags[l.id] === l.visible && live[l.id] !== l.visible) {
            out = { ...l, visible: live[l.id] };
        } else if (l.id in live && prevFlags[l.id] !== l.visible) {
            delete live[l.id];
        }
        if (Array.isArray(l.layers)) {
            const kids = withViewerToggles(l.layers, prevFlags, live);
            if (kids.some((k, i) => k !== l.layers[i])) out = { ...out, layers: kids };
        }
        return out;
    });
}

function App() {
    const mapRef = useRef(null);
    const wrapRef = useRef(null);
    const [view, setView] = useState(null);
    const previous = useRef(null);        // { state, buffers, decoded } last rendered
    const fingerprint = useRef(null);
    const events = useRef({ ...EVENT_DEFAULTS });
    const toggles = useRef({});           // layer id -> visible, from the sidebar

    useEffect(() => {
        const onRender = (event) => {
            const { state, buffers, fingerprint: fp } = event.detail.args || {};
            if (!state) return;
            if (fp === fingerprint.current) return;      // the no-op path: nothing changed
            fingerprint.current = fp;
            const prev = previous.current;
            const decoded = decodeBase64BuffersReusing(buffers, prev && prev.buffers,
                                                       prev && prev.decoded);
            const next = { ...state, coordinate_buffers: decoded };
            const host = mapRef.current && mapRef.current.host;
            if (prev && host) {
                for (const key of VIEWER_KEYS) {
                    if (same(prev.state[key], state[key])) next[key] = host.get(key);
                }
                next.layers = withViewerToggles(state.layers, visibilityFlags(prev.state.layers),
                                                toggles.current);
            }
            previous.current = { state, buffers, decoded };
            setView(next);
        };
        Streamlit.events.addEventListener(Streamlit.RENDER_EVENT, onRender);
        Streamlit.setComponentReady();
        return () => Streamlit.events.removeEventListener(Streamlit.RENDER_EVENT, onRender);
    }, []);

    // The frame follows the map's height, and any later resize of it.
    useEffect(() => {
        if (!wrapRef.current) return;
        const report = () => Streamlit.setFrameHeight(wrapRef.current.offsetHeight);
        report();
        const ro = new ResizeObserver(report);
        ro.observe(wrapRef.current);
        return () => ro.disconnect();
    }, [view && view.height]);

    useEffect(() => {
        if (view) window.__swiftmap = mapRef.current;   // devtools and tier 3
    }, [view]);

    const emit = (patch) => {
        events.current = { ...events.current, ...patch };
        Streamlit.setComponentValue(events.current);
    };

    if (!view) return null;
    const px = heightPx(view.height);
    return (
        <div ref={wrapRef} style={{ height: `${px}px`, position: "relative" }}>
            <SwiftMap ref={mapRef}
                      layers={view.layers} buffers={view.coordinate_buffers}
                      groupConfigs={view.group_configs}
                      center={view.center} zoom={view.zoom} crs={view.crs}
                      height={`${px}px`}
                      showLegend={view.show_legend} legendConfig={view.legend_config}
                      showScale={view.show_scale} scaleConfig={view.scale_config}
                      showDraw={view.show_draw} drawConfig={view.draw_config}
                      drawings={view.drawings}
                      timeConfig={view.time_config} timeCurrent={view.time_current}
                      showLogo={view.show_logo} logoConfig={view.logo_config}
                      showClickCoordinates={view.show_click_coordinates}
                      fitBoundsRequest={view.fit_bounds_request}
                      onViewChange={({ center, zoom }) => emit({ center, zoom })}
                      onFeatureClick={(c) => emit({ clicked_layer_id: c.layerId, selected_index: c.index,
                                                    clicked_latlng: c.latlng, click_seq: c.seq })}
                      onDrawChange={(d) => emit({ drawings: d.drawings, draw_seq: d.seq })}
                      onTimeChange={(t) => emit({ time_current: t.timeCurrent })}
                      onLayerToggle={({ ops }) => {
                          for (const op of ops) {
                              if (op.op === "set" && op.fields && "visible" in op.fields) {
                                  toggles.current[op.id] = op.fields.visible;
                              }
                          }
                          if (ops.length) emit({ layer_visibility: { ...toggles.current } });
                      }} />
        </div>
    );
}

createRoot(document.getElementById("root")).render(<App />);
