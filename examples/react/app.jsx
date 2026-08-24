// The React example: the same map the notebooks and the static export render,
// AUTHORED IN JS -- no hand-written configs, no hand-packed buffers. The model
// (createMapModel) is the same authoring surface Python's Map has, held
// byte-identical to it by the conformance goldens: builders, data-driven
// colour, time layers, and the live-feed update whose ops flow to the map
// through useSwiftMapFeed. In the repo this imports from src/; an application
// imports "swiftmap-core" and "swiftmap-core/react". Rendered under StrictMode
// on purpose: the double mount is the first thing a React host must survive.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "../../src/map.css";
import { SwiftMap, useSwiftMapFeed } from "../../src/react.jsx";
import { createMapModel } from "../../src/model.js";

const day = (d) => `2026-01-0${d}T00:00:00`;

function buildModel() {
    const m = createMapModel({ center: [36.05, -5.25], zoom: 12 });
    m.addCircleMarkers(
        { lat: [36.02, 36.05, 36.08], lon: [-5.28, -5.25, -5.22],
          name: ["Alpha", "Bravo", "Charlie"], value: [10, 55, 90],
          timestamp: [day(1), day(2), day(3)] },
        { name: "Sites", layerGroup: "Feeds/Active", colorCol: "value", radius: 10 });
    m.addLine([[36.00, -5.30], [36.05, -5.25], [36.10, -5.20]],
              { name: "Track", layerGroup: "Feeds/Active", color: "#0055ff", weight: 6,
                properties: { vessel: "Swift One" } });
    m.makeTimeLayer("Sites", { period: "P1D" });
    return m;
}

function App() {
    const mapRef = useRef(null);
    const modelRef = useRef(null);
    if (!modelRef.current) modelRef.current = buildModel();
    const model = modelRef.current;
    // Feed mode: the initial snapshot is taken once; every later change goes
    // through the model, whose ops reach the map as patches.
    const initialRef = useRef(null);
    if (!initialRef.current) initialRef.current = model.props();
    useSwiftMapFeed(model, mapRef);

    const [log, setLog] = useState([]);
    const [appended, setAppended] = useState(0);
    const note = (kind, detail) =>
        setLog((lines) => [...lines, `${kind} ${JSON.stringify(detail)}`].slice(-30));

    // A live feed: one more point through the model's own append -- the same
    // delta transport Python emits, ops and buffers alike.
    const append = () => {
        const n = appended;
        model.updateLayer("Sites", {
            data: { lat: [36.07 + n * 0.005], lon: [-5.33],
                    name: [`Echo ${n + 1}`], value: [50], timestamp: [day(4)] },
            append: true,
        });
        setAppended(n + 1);
    };

    useEffect(() => { window.__ready = true; window.__model = model; }, [model]);

    return (
        <div>
            <div id="toolbar" style={{ padding: "6px" }}>
                <button id="append" onClick={append}>Append a point</button>
                <span id="appended"> appended: {appended}</span>
            </div>
            <div style={{ height: "520px", position: "relative" }}>
                <SwiftMap ref={mapRef} {...initialRef.current}
                          showLegend legendConfig={{ title: "Key" }}
                          showScale scaleConfig={{ units: "nautical" }}
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
