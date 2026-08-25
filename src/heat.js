// The blob heatmap: sum weights into screen-space cells, colour the sums.
//
// This is the one place swiftmap aggregates, and it is sanctioned because
// screen-space density is a rendering operation, not an analytic one: the
// kernel is sized in pixels, so the field recomputes with every view and no
// upstream table could equal it. Everything the colour MEANS stays relative --
// the ramp is normalised to the hottest cell in the current view (recomputed on
// a debounced moveend, so colours hold still mid-drag), and `maxIntensity`
// pins the scale when comparability matters more than local contrast.
//
// Two GL passes on a dedicated canvas below the vector panes: point sprites
// with a Gaussian falloff accumulate additively (ONE, ONE) into a half-
// resolution float framebuffer, then a fullscreen pass maps field / max
// through the colormap ramp. WebGL2 with float buffers preferred; WebGL1
// falls back to byte accumulation, which saturates under deep stacking but
// still renders. glify is not involved: its pipeline draws discrete features
// and has no accumulation target, which is also why the wrappable canvas
// heatmap plugins (per-point 2D draws) die at exactly the scale swiftmap
// exists for.
import { COLORMAPS, DEFAULT_COLORMAP, mapColors } from "./colormaps.js";

const DOWNSAMPLE = 2;          // accumulation runs at 1/2 canvas resolution
const NORMALIZE_DELAY = 150;   // ms after the last move before re-normalising

// Matches L.CRS.EPSG3857.latLngToPoint(latlng, 0) exactly: zoom-0 pixel space,
// 256 units across the world. The closed form exists so five million points do
// not each construct a LatLng and a Point on the way to the GPU.
const MAX_MERC_LAT = 85.0511287798;
function mercatorX(lon) { return 256 * (0.5 + lon / 360); }
function mercatorY(lat) {
    const clamped = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat));
    const s = Math.sin(clamped * Math.PI / 180);
    return 256 * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI));
}

// Zoom-0 pixel offsets from an anchor, plus the anchor itself: float32 holds a
// city-sized extent to sub-pixel precision at any zoom, where absolute world
// coordinates in float32 jitter visibly past zoom ~12. Rows with unreadable
// coordinates drop, and their weights drop with them so the arrays stay aligned.
export function projectHeatPoints(latlonView, weightsView, crs, L) {
    const f64 = new Float64Array(
        latlonView.buffer, latlonView.byteOffset, latlonView.byteLength / 8);
    const n = f64.length / 2;
    const w32 = weightsView
        ? new Float32Array(weightsView.buffer, weightsView.byteOffset,
                           weightsView.byteLength / 4)
        : null;
    const mercator = !crs || !L || crs === L.CRS.EPSG3857;

    const offsets = new Float32Array(n * 2);
    const weights = new Float32Array(n);
    let anchorX = null, anchorY = null;
    let kept = 0;
    for (let i = 0; i < n; i++) {
        const lat = f64[i * 2];
        const lon = f64[i * 2 + 1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        let x, y;
        if (mercator) {
            x = mercatorX(lon);
            y = mercatorY(lat);
        } else {
            const p = crs.latLngToPoint(L.latLng(lat, lon), 0);
            x = p.x;
            y = p.y;
        }
        if (anchorX === null) { anchorX = x; anchorY = y; }
        offsets[kept * 2] = x - anchorX;
        offsets[kept * 2 + 1] = y - anchorY;
        const w = w32 ? w32[i] : 1;
        weights[kept] = Number.isFinite(w) ? w : 0;
        kept++;
    }
    return {
        offsets: offsets.subarray(0, kept * 2),
        weights: weights.subarray(0, kept),
        anchorX: anchorX ?? 0,
        anchorY: anchorY ?? 0,
        count: kept,
    };
}

const SPLAT_VS = `
attribute vec2 aOffset;
attribute float aWeight;
uniform vec2 uAnchorPx;
uniform float uScale;
uniform vec2 uViewport;
uniform float uSize;
varying float vWeight;
void main() {
    vec2 px = uAnchorPx + aOffset * uScale;
    vec2 clip = px / uViewport * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    gl_PointSize = uSize;
    vWeight = aWeight;
}`;

const SPLAT_FS = `
precision mediump float;
varying float vWeight;
uniform float uIntensity;
void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float d2 = dot(d, d) * 4.0;
    if (d2 > 1.0) discard;
    float g = exp(-d2 * 3.0) - exp(-3.0);
    gl_FragColor = vec4(g * vWeight * uIntensity, 0.0, 0.0, 1.0);
}`;

const COLORIZE_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COLORIZE_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uField;
uniform sampler2D uRamp;
uniform float uMax;
uniform float uOpacity;
void main() {
    float v = texture2D(uField, vUv).r;
    float t = uMax > 0.0 ? clamp(v / uMax, 0.0, 1.0) : 0.0;
    if (t <= 0.004) discard;
    vec3 c = texture2D(uRamp, vec2(t, 0.5)).rgb;
    float a = min(t * 2.5, 1.0) * uOpacity;
    gl_FragColor = vec4(c * a, a);
}`;

function compileProgram(gl, vsSource, fsSource) {
    function shader(type, source) {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
        }
        return s;
    }
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "program link failed");
    }
    return program;
}

// A 256x1 RGBA ramp texture through the same colormap machinery color_col uses,
// so a heat ramp and a legend ramp of the same name cannot disagree.
function rampPixels(anchors) {
    const t = new Float64Array(256);
    for (let i = 0; i < 256; i++) t[i] = i / 255;
    const colors = mapColors(Array.from(t), anchors, 0, 1);
    return new Uint8Array(colors.buffer, colors.byteOffset, 256 * 4);
}

export function createHeatRenderer(canvas, options = {}) {
    const opacity = options.opacity ?? 1.0;
    const radius = Math.max(1, options.radius ?? 25);
    const pinnedMax = options.maxIntensity ?? null;
    const anchors = options.anchors || COLORMAPS[DEFAULT_COLORMAP];

    let gl = canvas.getContext("webgl2",
        { antialias: false, depth: false, alpha: true });
    let isGL2 = !!gl;
    if (!gl) {
        gl = canvas.getContext("webgl", { antialias: false, depth: false, alpha: true });
    }
    if (!gl) return null;
    const floatOk = isGL2 && !!gl.getExtension("EXT_color_buffer_float");

    const splat = compileProgram(gl, SPLAT_VS, SPLAT_FS);
    const colorize = compileProgram(gl, COLORIZE_VS, COLORIZE_FS);

    const offsetBuf = gl.createBuffer();
    const weightBuf = gl.createBuffer();
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const rampTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rampTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA,
        gl.UNSIGNED_BYTE, rampPixels(anchors));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fieldTex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    let fboW = 0, fboH = 0;

    // Byte accumulation clips a stack of ~64 full-weight splats; the intensity
    // scale trades headroom for quantisation. Float buffers need neither.
    const intensity = floatOk ? 1.0 : 1 / 64;

    let count = 0;
    let currentMax = 0;

    function ensureFbo() {
        const w = Math.max(1, Math.floor(canvas.width / DOWNSAMPLE));
        const h = Math.max(1, Math.floor(canvas.height / DOWNSAMPLE));
        if (w === fboW && h === fboH) return;
        fboW = w; fboH = h;
        gl.bindTexture(gl.TEXTURE_2D, fieldTex);
        if (floatOk) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA,
                gl.HALF_FLOAT, null);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, null);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D, fieldTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function setData(projected) {
        count = projected.count;
        gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuf);
        gl.bufferData(gl.ARRAY_BUFFER, projected.offsets, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, weightBuf);
        gl.bufferData(gl.ARRAY_BUFFER, projected.weights, gl.STATIC_DRAW);
    }

    // view: {anchorPxX, anchorPxY, scale, dpr} -- anchor position in CSS pixels
    // from the canvas's top-left, and CSS pixels per zoom-0 unit, both computed
    // in float64 by the caller so only small offsets reach float32.
    function splatPass(view) {
        ensureFbo();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, fboW, fboH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!count) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
        gl.useProgram(splat);
        const px = view.dpr / DOWNSAMPLE;
        gl.uniform2f(gl.getUniformLocation(splat, "uAnchorPx"),
            view.anchorPxX * px, view.anchorPxY * px);
        gl.uniform1f(gl.getUniformLocation(splat, "uScale"), view.scale * px);
        gl.uniform2f(gl.getUniformLocation(splat, "uViewport"), fboW, fboH);
        gl.uniform1f(gl.getUniformLocation(splat, "uSize"),
            Math.max(2, radius * 2 * px));
        gl.uniform1f(gl.getUniformLocation(splat, "uIntensity"), intensity);
        const offLoc = gl.getAttribLocation(splat, "aOffset");
        gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuf);
        gl.vertexAttribPointer(offLoc, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(offLoc);
        const wLoc = gl.getAttribLocation(splat, "aWeight");
        gl.bindBuffer(gl.ARRAY_BUFFER, weightBuf);
        gl.vertexAttribPointer(wLoc, 1, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(wLoc);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function colorizePass() {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const max = pinnedMax !== null ? pinnedMax * intensity : currentMax;
        if (!count || max <= 0) return;
        gl.useProgram(colorize);
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fieldTex);
        gl.uniform1i(gl.getUniformLocation(colorize, "uField"), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, rampTex);
        gl.uniform1i(gl.getUniformLocation(colorize, "uRamp"), 1);
        gl.uniform1f(gl.getUniformLocation(colorize, "uMax"), max);
        gl.uniform1f(gl.getUniformLocation(colorize, "uOpacity"), opacity);
        const posLoc = gl.getAttribLocation(colorize, "aPos");
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(posLoc);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // The hottest accumulated cell in the current view, read back from the
    // half-resolution field. Only runs on the moveend debounce and after data
    // changes -- never per frame -- so the readback cost stays off the pan path.
    function computeMax() {
        if (!count || pinnedMax !== null) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        let max = 0;
        if (floatOk) {
            const pixels = new Float32Array(fboW * fboH * 4);
            gl.readPixels(0, 0, fboW, fboH, gl.RGBA, gl.FLOAT, pixels);
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > max) max = pixels[i];
            }
        } else {
            const pixels = new Uint8Array(fboW * fboH * 4);
            gl.readPixels(0, 0, fboW, fboH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > max) max = pixels[i];
            }
            max /= 255;
        }
        currentMax = max;
    }

    return {
        setData,
        render(view) {
            splatPass(view);
            colorizePass();
        },
        normalize(view) {
            splatPass(view);
            computeMax();
            colorizePass();
        },
        destroy() {
            const lose = gl.getExtension("WEBGL_lose_context");
            if (lose) lose.loseContext();
        },
    };
}

// The Leaflet layer: a viewport-sized canvas in a dedicated pane between the
// tiles and the vector panes, fully redrawn on every move -- the redraw is two
// draw calls, so tracking the map beats transform bookkeeping.
export function createHeatLayer(L, layer, latlonView, weightsView) {
    const HeatLayer = L.Layer.extend({
        onAdd(map) {
            this._map = map;
            if (!map.getPane("swiftmap-heat")) {
                const pane = map.createPane("swiftmap-heat");
                pane.style.zIndex = 395;   // tiles 200 < heat < overlay 400
                pane.style.pointerEvents = "none";
            }
            this._canvas = document.createElement("canvas");
            this._canvas.style.position = "absolute";
            map.getPane("swiftmap-heat").appendChild(this._canvas);

            this._canvas.addEventListener("webglcontextlost", (event) => {
                event.preventDefault();
            });
            this._canvas.addEventListener("webglcontextrestored", () => {
                this._initGL();
                this._scheduleNormalize(0);
            });

            this._initGL();
            map.on("move", this._onMove, this);
            map.on("moveend zoomend", this._onMoveEnd, this);
            map.on("resize", this._onResize, this);
            map.on("zoomanim", this._onZoomAnim, this);
            this._resize();
            this._draw();
            this._scheduleNormalize(0);
            return this;
        },

        onRemove(map) {
            map.off("move", this._onMove, this);
            map.off("moveend zoomend", this._onMoveEnd, this);
            map.off("resize", this._onResize, this);
            map.off("zoomanim", this._onZoomAnim, this);
            if (this._normalizeTimer) clearTimeout(this._normalizeTimer);
            if (this._frame) cancelAnimationFrame(this._frame);
            if (this._renderer) this._renderer.destroy();
            this._renderer = null;
            if (this._canvas && this._canvas.parentNode) {
                this._canvas.parentNode.removeChild(this._canvas);
            }
            this._canvas = null;
            return this;
        },

        _initGL() {
            this._renderer = createHeatRenderer(this._canvas, {
                radius: layer.radius,
                opacity: layer.opacity,
                maxIntensity: layer.max_intensity,
                anchors: layer.ramp,
            });
            if (!this._renderer) {
                console.warn("[SwiftMap] heatmap: WebGL unavailable; layer "
                    + `${layer.name || layer.id} will not render.`);
                return;
            }
            this._projected = projectHeatPoints(
                latlonView, weightsView, this._map.options.crs, L);
            this._renderer.setData(this._projected);
        },

        _resize() {
            const size = this._map.getSize();
            const dpr = window.devicePixelRatio || 1;
            this._canvas.width = Math.max(1, size.x * dpr);
            this._canvas.height = Math.max(1, size.y * dpr);
            this._canvas.style.width = `${size.x}px`;
            this._canvas.style.height = `${size.y}px`;
        },

        // Anchor position and scale in float64, so float32 only ever sees the
        // small offsets uploaded once.
        _view() {
            const map = this._map;
            const crs = map.options.crs;
            const zoom = map.getZoom();
            const scale = crs.scale(zoom) / crs.scale(0);
            const origin = map.getPixelOrigin();
            const pane = L.DomUtil.getPosition(map.getPane("mapPane"));
            const p = this._projected;
            return {
                anchorPxX: p.anchorX * scale - origin.x + pane.x,
                anchorPxY: p.anchorY * scale - origin.y + pane.y,
                scale,
                dpr: window.devicePixelRatio || 1,
            };
        },

        _draw() {
            if (!this._renderer) return;
            L.DomUtil.setPosition(this._canvas,
                this._map.containerPointToLayerPoint([0, 0]));
            this._renderer.render(this._view());
        },

        _onMove() {
            if (this._frame) return;
            this._frame = requestAnimationFrame(() => {
                this._frame = null;
                this._draw();
            });
        },

        _onMoveEnd() {
            L.DomUtil.setTransform(this._canvas, new L.Point(0, 0), 1);
            this._draw();
            this._scheduleNormalize(NORMALIZE_DELAY);
        },

        _onResize() {
            this._resize();
            this._draw();
            this._scheduleNormalize(NORMALIZE_DELAY);
        },

        // The standard overlay zoom-animation transform, so the heat stretches
        // with the tiles instead of freezing mid-flight.
        _onZoomAnim(e) {
            try {
                const map = this._map;
                const scale = map.getZoomScale(e.zoom);
                const offset = map._getCenterOffset(e.center)
                    ._multiplyBy(-scale)
                    .subtract(map._getMapPanePos());
                L.DomUtil.setTransform(this._canvas, offset, scale);
            } catch (err) { /* private API moved: skip the cosmetic transform */ }
        },

        _scheduleNormalize(delay) {
            if (this._normalizeTimer) clearTimeout(this._normalizeTimer);
            this._normalizeTimer = setTimeout(() => {
                this._normalizeTimer = null;
                if (this._renderer && this._map) {
                    this._renderer.normalize(this._view());
                }
            }, delay);
        },
    });
    return new HeatLayer();
}
