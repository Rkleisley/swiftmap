// The React example: the same map the notebooks and the static export render,
// as a component in an app -- points, a timed track, the sidebar, the legend,
// the time slider and the scale bar, with every callback wired to a log and a
// live append through the ref. In the repo it imports the component from src/;
// an application imports "swiftmap-core/react". Rendered under StrictMode on
// purpose: the double mount is the first thing a React host has to survive.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "../../src/map.css";
import { SwiftMap } from "../../src/react.jsx";

const day = (d) => Date.UTC(2026, 0, d);
const f64 = (nums) => new DataView(new Float64Array(nums).buffer);

const layers = [
    { id: "sites", type: "circle_markers", name: "Sites", layer_group: "Feeds/Active",
      visible: true, radius: 10, color: "#ff0000", fillColor: "#ff0000", fillOpacity: 1,
      weight: 2, opacity: 1, autobind_popup: true, autobind_tooltip: true,
      properties: { name: ["Alpha", "Bravo", "Charlie"], value: [10, 55, 90] },
      // A legend block as Python would resolve it: the ramp stated, the field named.
      legend: { kind: "ramp", field: "value", vmin: 0, vmax: 100,
                anchors: ["#440154", "#3e4989", "#26828e", "#35b779", "#b5de2b", "#fde725"] },
      bounds: [[36.02, -5.28], [36.08, -5.22]] },
    { id: "track", type: "polyline", name: "Track", layer_group: "Feeds/Active",
      visible: true, color: "#0055ff", weight: 6, opacity: 1,
      properties: { vessel: "Swift One" },
      // One [start, end] pair per vertex: the track reveals itself leg by leg.
      time: { field: "t", duration: "period" },
      bounds: [[36.00, -5.30], [36.10, -5.20]] },
];

const buffers = {
    sites: f64([36.02, -5.28, 36.05, -5.25, 36.08, -5.22]),
    track: f64([36.00, -5.30, 36.05, -5.25, 36.10, -5.20]),
    "track::times": f64([day(1), day(1), day(2), day(2), day(3), day(3)]),
};

function App() {
    const mapRef = useRef(null);
    const [log, setLog] = useState([]);
    const [appended, setAppended] = useState(0);
    const note = (kind, detail) =>
        setLog((lines) => [...lines, `${kind} ${JSON.stringify(detail)}`].slice(-30));

    // A live feed: one more point through the widget's own patch path.
    const append = () => {
        const n = appended;
        mapRef.current.applyPatch([
            { op: "buffer_append", id: "sites", buffer_index: 0 },
            { op: "append", id: "sites", base: 3 + n, count: 1,
              properties: { name: [`Echo ${n + 1}`], value: [50] } },
        ], [f64([36.07 + n * 0.005, -5.33])]);
        setAppended(n + 1);
    };

    useEffect(() => { window.__ready = true; }, []);

    return (
        <div>
            <div id="toolbar" style={{ padding: "6px" }}>
                <button id="append" onClick={append}>Append a point</button>
                <span id="appended"> appended: {appended}</span>
            </div>
            <div style={{ height: "520px", position: "relative" }}>
                <SwiftMap ref={mapRef}
                          layers={layers} buffers={buffers}
                          center={[36.05, -5.25]} zoom={12}
                          showLegend legendConfig={{ title: "Key" }}
                          showScale scaleConfig={{ units: "nautical" }}
                          timeConfig={{ period: "P1D" }}
                          onViewChange={(v) => note("view", v)}
                          onLayerToggle={(t) => note("toggle", t.ops)}
                          onFeatureClick={(c) => note("click", c)}
                          onDrawChange={(d) => note("draw", d.seq)}
                          onTimeChange={(t) => note("time", t.timeCurrent)} />
            </div>
            <pre id="log" style={{ fontSize: "11px" }}>{log.join("\n")}</pre>
        </div>
    );
}

createRoot(document.getElementById("root")).render(
    <React.StrictMode><App /></React.StrictMode>
);
