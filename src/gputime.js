// Time filtering on the GPU, for point layers.
//
// The coordinates already live in GPU buffers; rebuilding the merged layer per tick threw
// that away and re-fed glify all 5M points through JS -- measured at ~2.6s per window
// change at that scale, with allocation churn that could crash the tab when changes
// stacked. Instead, each point's time interval and its layer's duration ride along as
// vertex attributes uploaded once, and the current tick is a uniform: a tick or window
// change costs two floats and a redraw.
//
// glify makes this possible without forking it: vertexShaderSource is an overridable
// setting (the pin fragment shader already uses the same door), instances expose their
// gl/program/canvas, attributes are bound once at setup, and the per-frame draw touches
// only the matrix uniform -- so extra attributes bound after setup persist, and uniform
// updates take effect on the next redraw.
import { parsePeriod, periodToMs, timesFor } from "./timecontrol.js";

// Times travel as float32 on the GPU, whose integers are exact only to 2^24. Epoch ms is
// hopeless at that precision, so times are rebased to the bucket's earliest start and
// expressed in seconds: exact to ~194 days of span, and a 2s rounding beyond that is
// invisible at any zoom a time slider makes sense at.
const ALWAYS = 6.3e8;   // ~20 years, in seconds: the "duration" of cumulative layers,
                        // and the span half-width of points with no readable time.

// Per-bucket layer-visibility slots in the vertex shader. Each float array element
// occupies a full uniform vector in ES GLSL packing, and the spec guarantees only 128
// vertex uniform vectors -- 64 slots leaves comfortable room for the matrix and the time
// uniforms. A bucket with more layers than slots falls back to rebuild-per-toggle.
// (Packing four layers per vec4 would quadruple this if anyone ever needs it.)
export const LAYER_SLOTS = 64;

// Cheap kill switches: if wiring the GL state ever fails (a future glify version moving
// its internals), the affected family falls back to the CPU rebuild path. Points and
// vectors are separate flags -- a vector introspection failure must not cost points
// their GPU path.
let gpuOk = true;
export function gpuTimeAvailable() { return gpuOk; }
export function disableGpuTime(reason) {
    if (gpuOk) console.warn(`[SwiftMap] GPU time filtering disabled: ${reason}. ` +
        `Falling back to rebuild-per-tick.`);
    gpuOk = false;
}
let vectorGpuOk = true;
export function vectorGpuAvailable() { return vectorGpuOk; }
export function disableVectorGpu(reason) {
    if (vectorGpuOk) console.warn(`[SwiftMap] GPU time for lines/polygons disabled: ` +
        `${reason}. Falling back to rebuild-per-tick for those buckets.`);
    vectorGpuOk = false;
}

// The default points vertex shader (read out of leaflet.glify 3.3.0) with the window
// test added. A hidden point gets size 0 and a position outside clip space, so neither
// the visible pass nor the shared-program picking pass ever rasterises it.
export function timeVertexShader() {
    return `uniform mat4 matrix;
attribute vec4 vertex;
attribute vec4 color;
attribute float pointSize;
attribute vec2 aTimeSpan;
attribute float aDuration;
attribute float aLayer;
uniform float uTick;
uniform float uOverride;
uniform float uLayerVis[${LAYER_SLOTS}];
varying vec4 _color;

void main() {
  // A negative duration is the fade flag: |aDuration| is the window, the sign says this
  // point dims with age. A shared override keeps the point's own fade preference.
  bool fades = aDuration < 0.0;
  float dur = uOverride >= 0.0 ? uOverride : abs(aDuration);
  // Half-open (tick - dur, tick], matching featureInWindow on the CPU side -- ANDed with
  // the point's layer being visible. Layer toggles are one uniform element, not a
  // rebuild: unchecking one of 25 tracks used to re-feed all 5M points through JS.
  bool visible = aTimeSpan.y > (uTick - dur) && aTimeSpan.x <= uTick
      && uLayerVis[int(aLayer)] > 0.5;
  gl_PointSize = visible ? pointSize : 0.0;
  gl_Position = visible ? matrix * vertex : vec4(2.0, 2.0, 2.0, 1.0);
  // Age runs from the feature's end; newest is opaque, the trailing edge reaches zero.
  float alpha = fades ? clamp(1.0 - (uTick - aTimeSpan.y) / dur, 0.0, 1.0) : 1.0;
  _color = vec4(color.rgb, color.a * alpha);
}
`;
}

// Per-layer duration in seconds: null accumulates, "period" is the shared interval,
// an ISO string is itself; anything unparseable falls back to the interval.
function durationSeconds(spec, periodMs) {
    if (spec === null || spec === undefined) return ALWAYS;
    if (spec === "period") return (periodMs || 24 * 3600 * 1000) / 1000;
    const ms = periodToMs(parsePeriod(spec));
    return ms ? ms / 1000 : (periodMs || 24 * 3600 * 1000) / 1000;
}

// Builds the per-point attribute arrays for one merged bucket, in the exact order the
// bucket feeds points to glify: layer by layer, index 0..n-1, with single-`location`
// layers contributing one point. Points in layers without time metadata -- and points
// whose time was unreadable (NaN) -- get a span that is visible at every tick.
export function buildTimeAttributes(layersList, coordinateBuffers, periodMs) {
    let total = 0;
    let hasTime = false;
    const perLayer = [];
    for (const layer of layersList) {
        const buf = coordinateBuffers[layer.id];
        const count = buf ? buf.byteLength / 16 : (layer.location ? 1 : 0);
        const times = layer.time ? timesFor(layer, coordinateBuffers) : null;
        if (layer.time) hasTime = true;
        perLayer.push({ layer, count, times });
        total += count;
    }
    if (!hasTime) return { hasTime: false };

    let base = Infinity;
    for (const { times } of perLayer) {
        if (!times) continue;
        for (let i = 0; i < times.length; i += 2) {
            if (!Number.isNaN(times[i]) && times[i] < base) base = times[i];
        }
    }
    if (base === Infinity) base = 0;

    const spans = new Float32Array(total * 2);
    const durs = new Float32Array(total);
    const layerIdx = new Float32Array(total);
    const layerIds = [];
    let out = 0;
    for (const { layer, count, times } of perLayer) {
        const idx = layerIds.length;
        layerIds.push(layer.id);
        const dur = layer.time ? durationSeconds(layer.time.duration, periodMs) : ALWAYS;
        // The fade flag rides the duration's sign, so it costs no extra attribute.
        // Timeless (NaN) points keep a positive duration: with no age, nothing to fade.
        const signedDur = layer.time && layer.time.fade ? -dur : dur;
        for (let i = 0; i < count; i++) {
            const start = times ? times[i * 2] : NaN;
            const end = times ? times[i * 2 + 1] : NaN;
            if (Number.isNaN(start)) {
                spans[out * 2] = -ALWAYS;
                spans[out * 2 + 1] = ALWAYS;
                durs[out] = ALWAYS;
            } else {
                spans[out * 2] = (start - base) / 1000;
                spans[out * 2 + 1] = (end - base) / 1000;
                durs[out] = signedDur;
            }
            layerIdx[out] = idx;
            out++;
        }
    }
    return { hasTime: true, base, spans, durs, layerIdx, layerIds, count: total };
}

// Per-feature time metadata for a vector bucket (lines/polygons): one entry per layer,
// since those layers hold exactly one geometry. Same encodings as the point path --
// rebased float32 seconds, sign-packed fade, always-visible spans for timeless or
// non-time layers.
export function buildVectorTimeMeta(layersList, coordinateBuffers, periodMs) {
    if (!layersList.some(l => l.time)) return { hasTime: false };
    let base = Infinity;
    for (const layer of layersList) {
        const times = layer.time ? timesFor(layer, coordinateBuffers) : null;
        if (times && !Number.isNaN(times[0]) && times[0] < base) base = times[0];
    }
    if (base === Infinity) base = 0;

    const perFeature = layersList.map((layer, idx) => {
        const times = layer.time ? timesFor(layer, coordinateBuffers) : null;
        const dur = layer.time ? durationSeconds(layer.time.duration, periodMs) : ALWAYS;
        const signedDur = layer.time && layer.time.fade ? -dur : dur;
        if (!times || Number.isNaN(times[0])) {
            return { start: -ALWAYS, end: ALWAYS, dur: ALWAYS, idx };
        }
        return { start: (times[0] - base) / 1000, end: (times[1] - base) / 1000,
                 dur: signedDur, idx };
    });
    return { hasTime: true, base, perFeature, layerIds: layersList.map(l => l.id) };
}

// Expands per-feature values to per-GL-vertex arrays given each feature's vertex count.
// Pure, so the alignment logic is tier-1 testable away from any GL context.
export function expandPerFeature(perFeature, counts) {
    let total = 0;
    for (const c of counts) total += c;
    const spans = new Float32Array(total * 2);
    const durs = new Float32Array(total);
    const layerIdx = new Float32Array(total);
    let out = 0;
    perFeature.forEach((f, i) => {
        for (let v = 0; v < counts[i]; v++) {
            spans[out * 2] = f.start;
            spans[out * 2 + 1] = f.end;
            durs[out] = f.dur;
            layerIdx[out] = f.idx;
            out++;
        }
    });
    return { spans, durs, layerIdx };
}

// glify's vertex layout: 6 floats per GL vertex (x, y, r, g, b, a), confirmed for 3.3.0
// both by reading the source and by the Valhalla-VRE report's debug dump -- two
// one-segment lines produced allVerticesTyped of 24 floats: 2 features x 2 vertices x 6.
const FLOATS_PER_VERTEX = 6;

// Wires time + layer-visibility into a live glify LINES or SHAPES instance. The caller
// supplies per-feature GL-vertex counts computed from the geometry it built itself:
// lines draw 2*(points-1) vertices per feature, and any triangulation of a simple ring
// has exactly n-2 triangles -- a property of geometry, not of glify's earcut. The counts
// are validated against the instance's actual buffer length, and any mismatch disables
// the vector GPU path rather than mis-aligning attributes.
export function attachTimeToVectorInstance(instance, meta, counts) {
    try {
        if (!Array.isArray(counts) || counts.length !== meta.perFeature.length) {
            throw new Error(`expected ${meta.perFeature.length} vertex counts, ` +
                `got ${counts && counts.length}`);
        }
        const expected = counts.reduce((a, b) => a + b, 0) * FLOATS_PER_VERTEX;
        // Lines keep a typed flat buffer; shapes keep a plain flat array. Either is the
        // ground truth for how many GL vertices glify actually built.
        const actual = instance.allVerticesTyped ? instance.allVerticesTyped.length
            : (Array.isArray(instance.vertices) ? instance.vertices.length : -1);
        if (actual !== expected) {
            throw new Error(`vertex count mismatch: geometry says ${expected} floats, ` +
                `the instance holds ${actual}`);
        }
        const attrs = expandPerFeature(meta.perFeature, counts);
        attrs.base = meta.base;
        attrs.layerIds = meta.layerIds;
        return wireTimeAttributes(instance, attrs);
    } catch (err) {
        disableVectorGpu(err.message);
        return null;
    }
}

// Wires the attribute buffers and uniforms into a live glify points instance. Returns a
// handle whose setWindow costs two uniforms and a redraw, or null if anything about the
// instance is not where glify 3.3.0 keeps it -- in which case GPU time is disabled and
// the caller's rebuild path takes over.
export function attachTimeToInstance(instance, attrs) {
    try {
        return wireTimeAttributes(instance, attrs);
    } catch (err) {
        disableGpuTime(err.message);
        return null;
    }
}

// The common GL wiring: buffers for span/duration/layer attributes, uniforms for the
// tick, the shared override and the per-layer visibility slots. Throws on anything
// unexpected; the callers decide which fallback flag that flips.
function wireTimeAttributes(instance, attrs) {
    {
        const gl = instance.gl;
        const program = instance.program;
        const layer = instance.layer;
        if (!gl || !program || !layer) throw new Error("instance lacks gl/program/layer");

        gl.useProgram(program);

        const spanLoc = gl.getAttribLocation(program, "aTimeSpan");
        const durLoc = gl.getAttribLocation(program, "aDuration");
        const layerLoc = gl.getAttribLocation(program, "aLayer");
        const tickLoc = gl.getUniformLocation(program, "uTick");
        const overrideLoc = gl.getUniformLocation(program, "uOverride");
        // Some drivers name the array head "uLayerVis[0]"; accept either.
        const visLoc = gl.getUniformLocation(program, "uLayerVis")
            || gl.getUniformLocation(program, "uLayerVis[0]");
        if (spanLoc < 0 || durLoc < 0 || layerLoc < 0 || !tickLoc || !overrideLoc || !visLoc) {
            throw new Error("time attributes/uniforms missing from the linked program");
        }

        const spanBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, spanBuf);
        gl.bufferData(gl.ARRAY_BUFFER, attrs.spans, gl.STATIC_DRAW);
        gl.vertexAttribPointer(spanLoc, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(spanLoc);

        const durBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, durBuf);
        gl.bufferData(gl.ARRAY_BUFFER, attrs.durs, gl.STATIC_DRAW);
        gl.vertexAttribPointer(durLoc, 1, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(durLoc);

        const layerBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, layerBuf);
        gl.bufferData(gl.ARRAY_BUFFER, attrs.layerIdx, gl.STATIC_DRAW);
        gl.vertexAttribPointer(layerLoc, 1, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(layerLoc);

        // Until the slider says otherwise, everything is visible -- in time AND layer.
        gl.uniform1f(tickLoc, ALWAYS);
        gl.uniform1f(overrideLoc, -1);
        gl.uniform1fv(visLoc, new Float32Array(LAYER_SLOTS).fill(1));

        return {
            layerIds: attrs.layerIds,
            // tickMs in epoch ms; overrideMs a shared-window width or null.
            setWindow(tickMs, overrideMs) {
                gl.useProgram(program);
                gl.uniform1f(tickLoc, tickMs === null ? ALWAYS : (tickMs - attrs.base) / 1000);
                gl.uniform1f(overrideLoc, overrideMs === null ? -1 : overrideMs / 1000);
                layer.redraw();
            },
            // One float per layer slot, in attrs.layerIds order. A sidebar toggle lands
            // here instead of rebuilding the bucket.
            setLayerVisibility(visArray) {
                const vis = new Float32Array(LAYER_SLOTS).fill(1);
                vis.set(visArray.slice(0, LAYER_SLOTS));
                gl.useProgram(program);
                gl.uniform1fv(visLoc, vis);
                layer.redraw();
            },
        };
    }
}
