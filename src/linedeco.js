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
// rotated by the segment's bearing in the fragment, plus one END CAP anchored
// at each part's terminal vertex. Which sprites SHOW is a per-arrow gate the
// vertex shader evaluates from uploaded attributes -- density follows zoom
// with no rebuild:
//   spacing (the default): an arrow shows where its segment crosses a
//     gridline drawn every N screen pixels of path -- so the on-screen count
//     is locked, and a dense track zoomed out draws a handful of arrows
//     instead of a blob. The grid can also be a ground distance ("2km"),
//     converted to world units at the feature's mid-latitude.
//   segments: one arrow per segment, hidden only when the segment is too
//     short on screen -- the sparse-geometry mode where every leg matters.
//   end: caps only.
// The end cap bypasses every gate: at any zoom, in every mode, each part
// still declares its direction at least once. Both decorations carry the full
// time/visibility attribute contract, so a decorated time layer windows,
// fades and toggles exactly as its line does.
import { ALWAYS, LAYER_SLOTS } from "./gputime.js";
import { mercatorX, mercatorY } from "./heat.js";

export const MIN_ARROW_SEGMENT_PX = 48;
export const DEFAULT_ARROW_SPACING_PX = 120;
// Equatorial circumference of the web-mercator sphere; with the 256-unit
// zoom-0 world, meters convert to world units through cos(latitude).
const EARTH_CIRCUMFERENCE_M = 40075016.686;

// The gate attribute's first component: how the vertex shader decides whether
// an arrow deserves pixels. END CAPS are gate 0 -- unconditional.
const GATE_ALWAYS = 0;
const GATE_SEGMENT_PX = 1;      // segment >= MIN_ARROW_SEGMENT_PX on screen
const GATE_SPACING_PX = 2;      // segment crosses a screen-pixel gridline
const GATE_SPACING_WORLD = 3;   // segment crosses a world-unit gridline

// The placement vocabulary from a layer's `arrows` config value. `true` and
// any legacy truthy value mean the spacing default; hand-built configs from
// before the vocabulary keep working.
export function arrowMode(layer) {
    const a = layer && layer.arrows;
    if (!a) return null;
    if (a === "end" || a === "segments") return a;
    return "spacing";
}

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
attribute vec2 aDistSpan;
attribute vec2 aGate;
uniform float uTick;
uniform float uOverride;
uniform float uLayerVis[${LAYER_SLOTS}];
uniform float uPxPerWorld;
varying vec4 _color;
varying float vAngle;

void main() {
  bool fades = aDuration < 0.0;
  float dur = uOverride >= 0.0 ? uOverride : abs(aDuration);
  bool gateOk;
  if (aGate.x < 0.5) {
    gateOk = true;
  } else if (aGate.x < 1.5) {
    gateOk = aSegLen * uPxPerWorld >= ${MIN_ARROW_SEGMENT_PX.toFixed(1)};
  } else {
    float k = aGate.x < 2.5 ? uPxPerWorld : 1.0;
    gateOk = floor(aDistSpan.x * k / aGate.y) != floor(aDistSpan.y * k / aGate.y);
  }
  bool visible = aTimeSpan.y > (uTick - dur) && aTimeSpan.x <= uTick
      && uLayerVis[int(aLayer)] > 0.5
      && gateOk;
  gl_PointSize = visible ? pointSize : 0.0;
  gl_Position = visible ? matrix * vertex : vec4(2.0, 2.0, 2.0, 1.0);
  float alpha = fades ? clamp(1.0 - (uTick - aTimeSpan.y) / dur, 0.0, 1.0) : 1.0;
  _color = vec4(color.rgb, color.a * alpha);
  vAngle = aAngle;
}
`;
}

// A stroked chevron (a rotated ">") pointing +x in its own frame, rotated
// into the segment's screen bearing. gl_PointCoord and the mercator plane are
// both y-down, so the angle computed from mercator deltas applies without a
// flip. A stroke reads as an arrow where the old filled triangle read as a
// lump: the sprite sits ON the line, so its color is the CONTRAST of the
// line's (picked per feature at build time) and its arms must reach past the
// stroke width -- which is why the sprite is sized off the line's weight.
export const ARROW_FRAGMENT = `precision mediump float;
varying vec4 _color;
varying float vAngle;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float c = cos(vAngle);
  float s = sin(vAngle);
  vec2 p = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y);
  vec2 tip = vec2(0.22, 0.0);
  vec2 upper = vec2(-0.14, -0.32);
  vec2 lower = vec2(-0.14, 0.32);
  float d = min(segDist(p, upper, tip), segDist(p, lower, tip)) - 0.10;
  float aa = 1.0 - smoothstep(-0.04, 0.04, d);
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

// The layer's gate for its segment arrows: [type, spacing]. A ground-distance
// spacing converts to world units at the feature's mid-latitude, so one
// feature keeps one consistent grid however far it wanders.
function segmentGate(layer, coords) {
    const mode = arrowMode(layer);
    if (mode === "segments") return [GATE_SEGMENT_PX, 0];
    const meters = Number(layer.arrow_spacing_m);
    if (meters > 0) {
        let lo = Infinity, hi = -Infinity;
        for (const c of coords) {
            if (c[1] < lo) lo = c[1];
            if (c[1] > hi) hi = c[1];
        }
        const midLat = ((lo + hi) / 2) * Math.PI / 180;
        return [GATE_SPACING_WORLD,
                meters * 256 / (EARTH_CIRCUMFERENCE_M
                                * Math.max(0.01, Math.cos(midLat)))];
    }
    const px = Number(layer.arrow_spacing_px);
    return [GATE_SPACING_PX, px > 0 ? px : DEFAULT_ARROW_SPACING_PX];
}

// The chevron rides ON the stroke, so its own color is the line color's
// contrast: near-white on a dark line, near-black on a light one. Perceived
// luminance (Rec. 601), computed per feature -- color_col lines get a
// per-feature answer for free.
export function arrowColor(colorRGB) {
    const { r = 0, g = 0, b = 0, a = 1 } = colorRGB || {};
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = luminance > 0.6 ? 0.08 : 1.0;
    return { r: v, g: v, b: v, a };
}

// One arrow per segment of every arrow-flagged feature (unless the mode is
// "end") -- midpoint, screen bearing, cumulative-distance span and gate for
// the shader -- plus one always-shown END CAP at each part's terminal vertex,
// bearing the last real segment's direction. The distance ruler resets per
// feature like the dash ruler: a spacing grid is a property of one part.
// layerRefs and segIndexInLayer tie each arrow to its layer and its segment
// POSITION WITHIN that layer -- features are parts, the time meta is per
// layer, and a multi-part line's segments run contiguously across its parts
// in exactly this walking order; the cap takes its part's last segment, so it
// windows with the leg that actually arrives there.
export function buildArrowPoints(features) {
    const latlngs = [];
    const angles = [];
    const segLens = [];
    const distSpans = [];
    const gates = [];
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
        const mode = arrowMode(layer);
        if (!mode) {
            segInLayer += Math.max(0, coords.length - 1);
            continue;
        }
        // The sprite must CLEAR the stroke: glify draws a weight-w line about
        // (4w + 1) pixels wide, and a chevron narrower than that drowns in it.
        const size = Math.min(40, 16 + 3 * (f.properties.weight || 3));
        const color = arrowColor(f.properties.colorRGB);
        const gate = mode === "end" ? null : segmentGate(layer, coords);
        let running = 0;
        let lastAngle = null;
        let lastSeg = 0;
        for (let i = 0; i + 1 < coords.length; i++) {
            const [lon0, lat0] = coords[i];
            const [lon1, lat1] = coords[i + 1];
            const x0 = mercatorX(lon0), y0 = mercatorY(lat0);
            const x1 = mercatorX(lon1), y1 = mercatorY(lat1);
            const seg = Math.hypot(x1 - x0, y1 - y0);
            const angle = Math.atan2(y1 - y0, x1 - x0);
            if (seg > 0) {
                lastAngle = angle;
                lastSeg = seg;
            }
            if (gate) {
                latlngs.push([(lat0 + lat1) / 2, (lon0 + lon1) / 2]);
                angles.push(angle);
                segLens.push(seg);
                distSpans.push(running, running + seg);
                gates.push(gate[0], gate[1]);
                colors.push(color);
                sizes.push(size);
                layerRefs.push(layer);
                segIndexInLayer.push(segInLayer);
            }
            running += seg;
            segInLayer++;
        }
        if (lastAngle !== null) {
            const [lonEnd, latEnd] = coords[coords.length - 1];
            latlngs.push([latEnd, lonEnd]);
            angles.push(lastAngle);
            segLens.push(lastSeg);
            distSpans.push(0, 0);
            gates.push(GATE_ALWAYS, 0);
            colors.push(color);
            sizes.push(size);
            layerRefs.push(layer);
            segIndexInLayer.push(segInLayer - 1);
        }
    }
    return { latlngs, angles: new Float32Array(angles),
             segLens: new Float32Array(segLens),
             distSpans: new Float32Array(distSpans),
             gates: new Float32Array(gates), colors, sizes,
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

// Wires angle, segment-length, distance-span and gate attributes into the
// arrows POINTS instance.
export function wireArrowDeco(instance, arrows) {
    const gl = instance.gl;
    const program = instance.program;
    const layer = instance.layer;
    if (!gl || !program || !layer) throw new Error("instance lacks gl/program/layer");
    gl.useProgram(program);
    bindArray(gl, program, "aAngle", arrows.angles, 1);
    bindArray(gl, program, "aSegLen", arrows.segLens, 1);
    bindArray(gl, program, "aDistSpan", arrows.distSpans, 2);
    bindArray(gl, program, "aGate", arrows.gates, 2);
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
