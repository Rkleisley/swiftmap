// Line decoration: direction arrows and dash patterns, on the GPU.
//
// A paused track shows no direction at all -- the last visible capability gap
// on the board. Both decorations ride doors already proven open: glify's
// lines take a vertexShaderSource/fragmentShaderSource override (the vector
// time shader uses the first), extra attributes bound after setup persist
// (gputime's whole trick), and arrows are one more glify POINTS instance with
// the pin shader's kind of custom fragment.
//
// Dashes: each GL vertex carries its cumulative distance along its feature
// (mercator zoom-0 units, the heat pass's space); the fragment shader turns
// distance * pixels-per-world-unit into an on/off test, so the pattern is
// screen-stable at every zoom. Arrows: one point sprite per segment midpoint,
// rotated by the segment's bearing in the fragment, hidden by the vertex
// shader when the segment is too short on screen to deserve one -- density
// follows zoom with no rebuild. Both carry the full time/visibility attribute
// contract, so a decorated time layer windows, fades and toggles exactly as
// its line does.
import { ALWAYS, LAYER_SLOTS } from "./gputime.js";
import { mercatorX, mercatorY } from "./heat.js";

export const MIN_ARROW_SEGMENT_PX = 48;

export function lineDecoVertexShader() {
    return `uniform mat4 matrix;
attribute vec4 vertex;
attribute vec4 color;
attribute float pointSize;
attribute vec2 aTimeSpan;
attribute float aDuration;
attribute float aLayer;
attribute float aDist;
attribute vec3 aDash;
uniform float uTick;
uniform float uOverride;
uniform float uLayerVis[${LAYER_SLOTS}];
varying vec4 _color;
varying float vDist;
varying vec3 vDash;

void main() {
  bool fades = aDuration < 0.0;
  float dur = uOverride >= 0.0 ? uOverride : abs(aDuration);
  bool visible = aTimeSpan.y > (uTick - dur) && aTimeSpan.x <= uTick
      && uLayerVis[int(aLayer)] > 0.5;
  gl_Position = visible ? matrix * vertex : vec4(2.0, 2.0, 2.0, 1.0);
  float alpha = fades ? clamp(1.0 - (uTick - aTimeSpan.y) / dur, 0.0, 1.0) : 1.0;
  _color = vec4(color.rgb, color.a * alpha);
  vDist = aDist;
  vDash = aDash;
}
`;
}

// A feature's vertices all share one dash triple, so the varying interpolates
// to a constant; distance interpolates linearly along each segment, which is
// exactly the ruler the pattern needs.
export function lineDecoFragmentShader() {
    return `precision mediump float;
varying vec4 _color;
varying float vDist;
varying vec3 vDash;
uniform float uPxPerWorld;

void main() {
  if (vDash.z > 0.5) {
    float px = vDist * uPxPerWorld;
    if (fract(px / vDash.x) > vDash.y / vDash.x) discard;
  }
  gl_FragColor = _color;
}
`;
}

export function arrowVertexShader() {
    return `uniform mat4 matrix;
attribute vec4 vertex;
attribute vec4 color;
attribute float pointSize;
attribute vec2 aTimeSpan;
attribute float aDuration;
attribute float aLayer;
attribute float aAngle;
attribute float aSegLen;
uniform float uTick;
uniform float uOverride;
uniform float uLayerVis[${LAYER_SLOTS}];
uniform float uPxPerWorld;
varying vec4 _color;
varying float vAngle;

void main() {
  bool fades = aDuration < 0.0;
  float dur = uOverride >= 0.0 ? uOverride : abs(aDuration);
  bool visible = aTimeSpan.y > (uTick - dur) && aTimeSpan.x <= uTick
      && uLayerVis[int(aLayer)] > 0.5
      && aSegLen * uPxPerWorld >= ${MIN_ARROW_SEGMENT_PX.toFixed(1)};
  gl_PointSize = visible ? pointSize : 0.0;
  gl_Position = visible ? matrix * vertex : vec4(2.0, 2.0, 2.0, 1.0);
  float alpha = fades ? clamp(1.0 - (uTick - aTimeSpan.y) / dur, 0.0, 1.0) : 1.0;
  _color = vec4(color.rgb, color.a * alpha);
  vAngle = aAngle;
}
`;
}

// A chevron pointing +x in its own frame, rotated into the segment's screen
// bearing. gl_PointCoord and the mercator plane are both y-down, so the angle
// computed from mercator deltas applies without a flip.
export const ARROW_FRAGMENT = `precision mediump float;
varying vec4 _color;
varying float vAngle;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float c = cos(vAngle);
  float s = sin(vAngle);
  vec2 p = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y);
  float halfH = (0.35 - p.x) * 0.55;
  float d = max(max(abs(p.y) - halfH, p.x - 0.35), -0.25 - p.x);
  float aa = 1.0 - smoothstep(-0.05, 0.03, d);
  if (aa <= 0.0) discard;
  gl_FragColor = vec4(_color.rgb, _color.a * aa);
}
`;

// [period, duty, enabled] from a layer's dash option, or zeros. The pattern is
// the first on/off pair in pixels; junk was already warned about at add time.
export function dashTriple(dash) {
    if (Array.isArray(dash) && dash.length >= 2
            && dash[0] > 0 && dash[1] > 0) {
        return [dash[0] + dash[1], dash[0], 1];
    }
    return [1, 1, 0];
}

// Per-GL-vertex cumulative distance and dash triple, in the exact order glify
// builds line vertices: per feature, per segment, two dedicated vertices.
// Distance resets per feature -- a pattern is a property of one line, and
// carrying it across features would shift every later layer's dashes when an
// earlier layer changes length.
export function buildLineDistances(features) {
    let total = 0;
    for (const f of features) {
        total += Math.max(0, f.geometry.coordinates.length - 1) * 2;
    }
    const dists = new Float32Array(total);
    const dash = new Float32Array(total * 3);
    let out = 0;
    for (const f of features) {
        const coords = f.geometry.coordinates;   // [lon, lat]
        const triple = dashTriple(f.properties.layer && f.properties.layer.dash);
        let running = 0;
        let px = mercatorX(coords[0] ? coords[0][0] : 0);
        let py = mercatorY(coords[0] ? coords[0][1] : 0);
        for (let i = 0; i + 1 < coords.length; i++) {
            const nx = mercatorX(coords[i + 1][0]);
            const ny = mercatorY(coords[i + 1][1]);
            const seg = Math.hypot(nx - px, ny - py);
            dists[out] = running;
            dists[out + 1] = running + seg;
            for (let v = 0; v < 2; v++) {
                dash.set(triple, (out + v) * 3);
            }
            running += seg;
            px = nx;
            py = ny;
            out += 2;
        }
    }
    return { dists, dash };
}

// One arrow per segment of every arrow-flagged feature: midpoint, screen
// bearing, and the segment's world length for the shader's density gate.
// layerRefs and segIndexInLayer tie each arrow to its layer and its segment
// POSITION WITHIN that layer -- features are parts, the time meta is per
// layer, and a multi-part line's segments run contiguously across its parts
// in exactly this walking order.
export function buildArrowPoints(features) {
    const latlngs = [];
    const angles = [];
    const segLens = [];
    const colors = [];
    const sizes = [];
    const layerRefs = [];
    const segIndexInLayer = [];
    let currentLayer = null;
    let segInLayer = 0;
    for (const f of features) {
        const layer = f.properties.layer;
        if (layer !== currentLayer) {
            currentLayer = layer;
            segInLayer = 0;
        }
        if (!layer || f.properties.isBorder) continue;
        const coords = f.geometry.coordinates;   // [lon, lat]
        if (!layer.arrows) {
            segInLayer += Math.max(0, coords.length - 1);
            continue;
        }
        const size = Math.min(26, 10 + 2 * (f.properties.weight || 3));
        for (let i = 0; i + 1 < coords.length; i++) {
            const [lon0, lat0] = coords[i];
            const [lon1, lat1] = coords[i + 1];
            const x0 = mercatorX(lon0), y0 = mercatorY(lat0);
            const x1 = mercatorX(lon1), y1 = mercatorY(lat1);
            latlngs.push([(lat0 + lat1) / 2, (lon0 + lon1) / 2]);
            angles.push(Math.atan2(y1 - y0, x1 - x0));
            segLens.push(Math.hypot(x1 - x0, y1 - y0));
            colors.push(f.properties.colorRGB);
            sizes.push(size);
            layerRefs.push(layer);
            segIndexInLayer.push(segInLayer);
            segInLayer++;
        }
    }
    return { latlngs, angles: new Float32Array(angles),
             segLens: new Float32Array(segLens), colors, sizes,
             layerRefs, segIndexInLayer };
}

// The arrows' time attributes, derived from the SAME per-layer meta the line
// wires: each arrow takes its segment's span when the layer carries
// per-segment times, its layer's whole span otherwise, and its layer's slot
// for the visibility vector.
export function arrowTimeAttrs(arrows, layerPos, meta) {
    const n = arrows.layerRefs.length;
    const spans = new Float32Array(n * 2);
    const durs = new Float32Array(n);
    const layerIdx = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        const li = layerPos.get(arrows.layerRefs[k]);
        const f = meta.perFeature[li];
        const s = arrows.segIndexInLayer[k];
        if (f.seg && f.seg.length >= (s + 1) * 2) {
            spans[k * 2] = f.seg[s * 2];
            spans[k * 2 + 1] = f.seg[s * 2 + 1];
        } else {
            spans[k * 2] = f.start;
            spans[k * 2 + 1] = f.end;
        }
        durs[k] = f.dur;
        layerIdx[k] = f.idx;
    }
    return { spans, durs, layerIdx, base: meta.base, layerIds: meta.layerIds };
}

// The always-visible defaults wireTimeAttributes would set: a decorated bucket
// with no time layers still runs the deco shaders, whose window test must pass
// for everything and whose layer slots must all read visible.
function setAlwaysVisible(gl, program) {
    const span = gl.getAttribLocation(program, "aTimeSpan");
    const dur = gl.getAttribLocation(program, "aDuration");
    const layerLoc = gl.getAttribLocation(program, "aLayer");
    if (span >= 0) { gl.disableVertexAttribArray(span); gl.vertexAttrib2f(span, -ALWAYS, ALWAYS); }
    if (dur >= 0) { gl.disableVertexAttribArray(dur); gl.vertexAttrib1f(dur, ALWAYS); }
    if (layerLoc >= 0) { gl.disableVertexAttribArray(layerLoc); gl.vertexAttrib1f(layerLoc, 0); }
    const tick = gl.getUniformLocation(program, "uTick");
    const override = gl.getUniformLocation(program, "uOverride");
    const vis = gl.getUniformLocation(program, "uLayerVis")
        || gl.getUniformLocation(program, "uLayerVis[0]");
    if (tick) gl.uniform1f(tick, ALWAYS);
    if (override) gl.uniform1f(override, -1);
    if (vis) gl.uniform1fv(vis, new Float32Array(LAYER_SLOTS).fill(1));
}

function bindArray(gl, program, name, data, size) {
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) throw new Error(`${name} missing from the linked program`);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(loc);
}

// Wires distance + dash attributes into a live glify LINES instance and
// returns { setPxPerWorld }. Throws on anything unexpected; the caller decides
// what falls back (an undecorated line, never a broken one).
export function wireLineDeco(instance, dists, dash) {
    const gl = instance.gl;
    const program = instance.program;
    const layer = instance.layer;
    if (!gl || !program || !layer) throw new Error("instance lacks gl/program/layer");
    gl.useProgram(program);
    const expected = instance.allVerticesTyped ? instance.allVerticesTyped.length / 6
        : (Array.isArray(instance.vertices) ? instance.vertices.length / 6 : -1);
    if (expected !== dists.length) {
        throw new Error(`distance count mismatch: geometry says ${dists.length} `
            + `GL vertices, the instance holds ${expected}`);
    }
    bindArray(gl, program, "aDist", dists, 1);
    bindArray(gl, program, "aDash", dash, 3);
    setAlwaysVisible(gl, program);
    const px = gl.getUniformLocation(program, "uPxPerWorld");
    return {
        setPxPerWorld(value) {
            gl.useProgram(program);
            if (px) gl.uniform1f(px, value);
            layer.redraw();
        },
    };
}

// Wires angle + segment-length attributes into the arrows POINTS instance.
export function wireArrowDeco(instance, angles, segLens) {
    const gl = instance.gl;
    const program = instance.program;
    const layer = instance.layer;
    if (!gl || !program || !layer) throw new Error("instance lacks gl/program/layer");
    gl.useProgram(program);
    bindArray(gl, program, "aAngle", angles, 1);
    bindArray(gl, program, "aSegLen", segLens, 1);
    setAlwaysVisible(gl, program);
    const px = gl.getUniformLocation(program, "uPxPerWorld");
    return {
        setPxPerWorld(value) {
            gl.useProgram(program);
            if (px) gl.uniform1f(px, value);
            layer.redraw();
        },
    };
}

// One handle over both instances, so the core's per-tick and per-toggle pushes
// reach the arrows exactly when they reach the line.
export function combineTimeHandles(lineHandle, arrowHandle) {
    if (!arrowHandle) return lineHandle;
    if (!lineHandle) return arrowHandle;
    return {
        layerIds: lineHandle.layerIds,
        setWindow(tickMs, overrideMs) {
            lineHandle.setWindow(tickMs, overrideMs);
            arrowHandle.setWindow(tickMs, overrideMs);
        },
        setLayerVisibility(vis) {
            lineHandle.setLayerVisibility(vis);
            arrowHandle.setLayerVisibility(vis);
        },
    };
}
