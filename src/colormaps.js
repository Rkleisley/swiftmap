// Data-driven colour and size mapping: the JS side of swiftmap/_colormaps.py.
//
// Phase 3 stage 2. One rulebook, two implementations, held together by the
// authoring goldens (see src/model.js): the buffers this file packs must be
// BYTE-IDENTICAL to numpy's for the same inputs, which is why three numpy
// behaviours are replicated deliberately rather than approximated:
//   - np.round rounds half to EVEN (Math.round rounds half up);
//   - np.linspace(0, 1, n) computes i * (1/(n-1)) and pins the endpoint;
//   - np.interp computes slope = dy/dx once, then slope * (t - x0) + y0.
// The colormap tables are anchor lists interpolated in RGB -- matplotlib-faithful
// to well within a shade, small enough to type by hand on a closed network. The
// result of every mapping is a compact binary buffer (u8 RGBA, f32 radii) plus
// the legend block that describes it, from the same arithmetic, so the legend
// can never disagree with the pixels.

// Sequential/diverging ramps, evenly spaced anchors (swiftmap/_colormaps.py).
export const COLORMAPS = {
    viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e",
              "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
    plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786",
             "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
    inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60",
              "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
    magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f",
            "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
    turbo: ["#30123b", "#4145ab", "#4675ed", "#39a2fc", "#1bcfd4",
            "#24eca6", "#61fc6c", "#a4fc3b", "#d1e834", "#f3c63a",
            "#fe9b2d", "#f36315", "#d93806", "#b11901", "#7a0402"],
    coolwarm: ["#3b4cc0", "#6688ee", "#88abfd", "#b8d0f9", "#dddddd",
               "#f5c4ac", "#f4987a", "#dd5f4b", "#b40426"],
    blues: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6",
            "#4292c6", "#2171b5", "#08519c", "#08306b"],
    reds: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a",
           "#ef3b2c", "#cb181d", "#a50f15", "#67000d"],
    greens: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476",
             "#41ab5d", "#238b45", "#006d2c", "#00441b"],
    greys: ["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696",
            "#737373", "#525252", "#252525", "#000000"],
};

export const CATEGORICAL_PALETTES = {
    swift10: ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
              "#edc949", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"],
};

export const DEFAULT_COLORMAP = "viridis";
export const DEFAULT_PALETTE = "swift10";
const SAMPLE_ANCHORS = 16;
export const MAX_LEGEND_CATEGORIES = 50;

const warnOnce = (msg) => console.warn(`swiftmap: ${msg}`);

// --- numpy-exact arithmetic ----------------------------------------------------------

function roundHalfEven(x) {
    const floor = Math.floor(x);
    const frac = x - floor;
    if (frac > 0.5) return floor + 1;
    if (frac < 0.5) return floor;
    return floor % 2 === 0 ? floor : floor + 1;
}

function linspace01(n) {
    const out = new Float64Array(n);
    const step = 1 / (n - 1);
    for (let i = 0; i < n; i++) out[i] = i * step;
    out[n - 1] = 1;
    return out;
}

function interp1(t, pos, vals) {
    const n = pos.length;
    if (t <= pos[0]) return vals[0];
    if (t >= pos[n - 1]) return vals[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (pos[mid] <= t) lo = mid;
        else hi = mid;
    }
    const slope = (vals[hi] - vals[lo]) / (pos[hi] - pos[lo]);
    return slope * (t - pos[lo]) + vals[lo];
}

// --- colour parsing ------------------------------------------------------------------

export function hexToRgb(value) {
    const v = value.replace(/^#/, "");
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16),
            parseInt(v.slice(4, 6), 16)];
}

const rgbHex = (row) => "#" + [row[0], row[1], row[2]]
    .map(c => c.toString(16).padStart(2, "0")).join("");
export { rgbHex };

function toHex(color) {
    if (typeof color === "string") {
        let v = color.trim().replace(/^#/, "");
        if (v.length === 3) v = [...v].map(ch => ch + ch).join("");
        if ((v.length === 6 || v.length === 8) && /^[0-9a-fA-F]{6}/.test(v)) {
            return "#" + v.slice(0, 6).toLowerCase();
        }
        return null;
    }
    let parts;
    try {
        parts = [...color].slice(0, 3).map(Number);
    } catch (err) {
        return null;
    }
    if (parts.length !== 3 || parts.some(c => !isFinite(c))) return null;
    if (parts.every(c => c >= 0 && c <= 1)) parts = parts.map(c => c * 255);
    return rgbHex(parts.map(c => Math.round(Math.min(Math.max(c, 0), 255))));
}

// --- specs ---------------------------------------------------------------------------

export function resolveColormap(spec) {
    if (spec == null) return null;
    if (typeof spec === "string") {
        const text = spec.trim();
        const low = text.toLowerCase();
        if (low in COLORMAPS || low in CATEGORICAL_PALETTES) return low;
        if (text.includes(":")) {
            const source = text.split(":", 1)[0].trim().toLowerCase();
            if (source === "matplotlib" || source === "mpl") {
                warnOnce(`colormap '${text}' needs matplotlib, which JS does not have; `
                    + `using '${DEFAULT_COLORMAP}'. Sample it in Python and pass the anchors.`);
                return null;
            }
            warnOnce(`Unknown colormap source '${source}' in '${text}'; using '${DEFAULT_COLORMAP}'.`);
            return null;
        }
        return text;   // an unknown name: the mapping warns "Unknown colormap"
    }
    if (typeof spec === "function") {
        const anchors = [];
        for (const t of linspace01(SAMPLE_ANCHORS)) {
            let hex = null;
            try { hex = toHex(spec(t)); } catch (err) { /* falls through */ }
            if (hex == null) {
                warnOnce(`A colormap callable must map t in [0, 1] to a colour; using '${DEFAULT_COLORMAP}'.`);
                return null;
            }
            anchors.push(hex);
        }
        return anchors;
    }
    if (Array.isArray(spec)) {
        const anchors = spec.map(toHex);
        if (!anchors.length || anchors.some(a => a == null)) {
            warnOnce(`A colormap list must hold colours (#rrggbb or RGB arrays); using '${DEFAULT_COLORMAP}'.`);
            return null;
        }
        return anchors.length > 1 ? anchors : [...anchors, ...anchors];
    }
    if (typeof spec === "object") {
        const mapping = {};
        let bad = 0;
        for (const [key, value] of Object.entries(spec)) {
            const hex = toHex(value);
            if (hex == null) bad += 1;
            else mapping[String(key)] = hex;
        }
        if (bad) warnOnce(`colormap mapping: ${bad} value(s) are not colours; `
            + `those categories take the fallback colour.`);
        return mapping;
    }
    warnOnce(`colormap must be a name, a list of colours, a function or a `
        + `{value: colour} mapping; using '${DEFAULT_COLORMAP}'.`);
    return null;
}

export function registerColormap(name, source, kind = "ramp") {
    let spec = resolveColormap(source);
    if (typeof spec === "string") spec = COLORMAPS[spec] || CATEGORICAL_PALETTES[spec];
    if (!Array.isArray(spec)) {
        warnOnce(`registerColormap('${name}'): the source must resolve to a list of colours; nothing was registered.`);
        return;
    }
    const key = String(name).trim().toLowerCase();
    if (kind === "palette") {
        CATEGORICAL_PALETTES[key] = [...spec];
        delete COLORMAPS[key];
    } else if (kind === "ramp") {
        COLORMAPS[key] = [...spec];
        delete CATEGORICAL_PALETTES[key];
    } else {
        warnOnce(`registerColormap('${name}'): kind must be 'ramp' or 'palette'; nothing was registered.`);
    }
}

function anchorsOf(spec) {
    if (Array.isArray(spec)) return spec.map(String);
    if (typeof spec === "string") return COLORMAPS[spec.toLowerCase()] || null;
    return null;
}

function rampOf(spec) {
    let anchors = anchorsOf(spec);
    if (anchors == null) {
        if (spec && typeof spec === "object" && !Array.isArray(spec)) {
            warnOnce(`A {value: colour} mapping colours categories, but the values are `
                + `numeric; using the '${DEFAULT_COLORMAP}' ramp.`);
        } else {
            warnOnce(`Unknown colormap '${spec}'; using '${DEFAULT_COLORMAP}'. `
                + `Available: ${Object.keys(COLORMAPS).sort().join(", ")}.`);
        }
        anchors = COLORMAPS[DEFAULT_COLORMAP];
    }
    return anchors.map(hexToRgb);
}

function sampleChannel(ramp, t, channel) {
    const pos = linspace01(ramp.length);
    const vals = ramp.map(row => row[channel]);
    return interp1(t, pos, vals);
}

// Python's np.asarray makes a list numeric only when every entry is a number
// (None or a string makes the whole column object dtype, hence categorical);
// missing numeric values arrive as NaN. The JS mirror is the same rule.
function numericOrNull(values) {
    return values.every(v => typeof v === "number");
}

// --- the mappings --------------------------------------------------------------------

export function mapColors(values, colormap = null, vmin = null, vmax = null,
                          bins = null, fallback = "#3388ff") {
    const n = values.length;
    const out = new Uint8Array(n * 4);
    const fb = hexToRgb(fallback);

    if (numericOrNull(values)) {
        const v = values;
        const finite = v.map(Number.isFinite);
        const ramp = rampOf(colormap || DEFAULT_COLORMAP);
        let tOf;
        if (bins != null) {
            const edges = bins.map(Number);
            const classes = edges.length + 1;
            tOf = (x, ok) => {
                const val = ok ? x : edges[0];
                let idx = 0;
                for (const e of edges) {
                    if (val >= e) idx += 1;
                    else break;
                }
                return idx / Math.max(classes - 1, 1);
            };
        } else {
            const fin = v.filter((x, i) => finite[i]);
            const lo = vmin != null ? Number(vmin) : (fin.length ? Math.min(...fin) : 0);
            const hi = vmax != null ? Number(vmax) : (fin.length ? Math.max(...fin) : 1);
            const span = hi - lo;
            tOf = span > 0
                ? (x, ok) => Math.min(Math.max(((ok ? x : lo) - lo) / span, 0), 1)
                : () => 0.5;
        }
        for (let i = 0; i < n; i++) {
            if (!finite[i]) {
                out[i * 4] = fb[0]; out[i * 4 + 1] = fb[1]; out[i * 4 + 2] = fb[2];
            } else {
                const t = tOf(v[i], true);
                out[i * 4] = roundHalfEven(sampleChannel(ramp, t, 0));
                out[i * 4 + 1] = roundHalfEven(sampleChannel(ramp, t, 1));
                out[i * 4 + 2] = roundHalfEven(sampleChannel(ramp, t, 2));
            }
            out[i * 4 + 3] = 255;
        }
        return out;
    }

    // Categorical: distinct value -> colour, in sorted order for determinism.
    const strings = values.map(String);
    const cats = [...new Set(strings)].sort();
    const index = new Map(cats.map((c, i) => [c, i]));
    const table = categoryAssignments(cats, colormap, fallback, false);
    for (let i = 0; i < n; i++) {
        const row = table[index.get(strings[i])];
        out[i * 4] = row[0]; out[i * 4 + 1] = row[1]; out[i * 4 + 2] = row[2];
        out[i * 4 + 3] = 255;
    }
    return out;
}

export function categoryAssignments(cats, colormap, fallback, quiet) {
    if (colormap && typeof colormap === "object" && !Array.isArray(colormap)) {
        const mapping = {};
        for (const [k, v] of Object.entries(colormap)) mapping[String(k)] = v;
        const fb = hexToRgb(fallback);
        const rows = [];
        const missing = [];
        for (const cat of cats) {
            const hex = mapping[String(cat)];
            if (hex == null) {
                missing.push(String(cat));
                rows.push(fb);
            } else {
                rows.push(hexToRgb(hex));
            }
        }
        if (missing.length && !quiet) {
            const shown = missing.slice(0, 5).map(m => `'${m}'`).join(", ");
            warnOnce(`color_col: ${missing.length} categor${missing.length === 1 ? "y is" : "ies are"} `
                + `not in the colormap mapping (${shown}${missing.length > 5 ? "..." : ""}); `
                + `painted with the fallback colour.`);
        }
        return rows;
    }
    return categoryTable(cats.length, colormap, quiet);
}

function categoryTable(count, colormap, quiet) {
    if (Array.isArray(colormap)) {
        const table = colormap.map(hexToRgb);
        return Array.from({ length: count }, (_, i) => table[i % table.length]);
    }
    const name = colormap ? String(colormap).toLowerCase() : DEFAULT_PALETTE;
    if (name in COLORMAPS && count > 1) {
        const ramp = rampOf(name);
        const pos = linspace01(count);
        return Array.from({ length: count }, (_, i) => [
            roundHalfEven(sampleChannel(ramp, pos[i], 0)),
            roundHalfEven(sampleChannel(ramp, pos[i], 1)),
            roundHalfEven(sampleChannel(ramp, pos[i], 2)),
        ]);
    }
    let palette = CATEGORICAL_PALETTES[name];
    if (palette == null && colormap != null && !quiet) {
        warnOnce(`Unknown colormap '${colormap}'; using '${DEFAULT_PALETTE}'.`);
    }
    palette = palette || CATEGORICAL_PALETTES[DEFAULT_PALETTE];
    const table = palette.map(hexToRgb);
    return Array.from({ length: count }, (_, i) => table[i % table.length]);
}

export function mapRadii(values, radiusRange = [3.0, 18.0], vmin = null, vmax = null) {
    const [r0, r1] = [Number(radiusRange[0]), Number(radiusRange[1])];
    const n = values.length;
    const finite = values.map(Number.isFinite);
    const fin = values.filter((x, i) => finite[i]);
    const lo = vmin != null ? Number(vmin) : (fin.length ? Math.min(...fin) : 0);
    const hi = vmax != null ? Number(vmax) : (fin.length ? Math.max(...fin) : 1);
    const span = hi - lo;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        if (!finite[i]) {
            out[i] = r0;
        } else {
            const t = span > 0
                ? Math.min(Math.max((values[i] - lo) / span, 0), 1) : 0.5;
            out[i] = r0 + Math.sqrt(t) * (r1 - r0);
        }
    }
    return out;
}

// --- legend blocks -------------------------------------------------------------------

// Python's round(x, 6) rounds half to even at the sixth decimal; ints stay ints.
function labelNum(value) {
    if (Number.isInteger(value)) return value;
    return roundHalfEven(value * 1e6) / 1e6;
}

export function binsBlock(colormap, edges) {
    const e = edges.map(Number);
    const classes = e.length + 1;
    const ramp = (anchorsOf(colormap) || COLORMAPS[DEFAULT_COLORMAP]).map(hexToRgb);
    const colors = [];
    for (let i = 0; i < classes; i++) {
        const t = i / Math.max(classes - 1, 1);
        colors.push(rgbHex([
            roundHalfEven(sampleChannel(ramp, t, 0)),
            roundHalfEven(sampleChannel(ramp, t, 1)),
            roundHalfEven(sampleChannel(ramp, t, 2)),
        ]));
    }
    return { kind: "bins", edges: e.map(labelNum), colors };
}

export function dataDrivenLegend(props, opts, fallback = "#3388ff") {
    const col = opts.color_col;
    const values = col ? (props || {})[col] : null;
    if (values == null) return null;
    const spec = opts.colormap;

    if (numericOrNull(values)) {
        const anchors = anchorsOf(spec) || COLORMAPS[DEFAULT_COLORMAP];
        if (opts.color_bins != null) {
            return { ...binsBlock(spec, opts.color_bins), field: col };
        }
        const fin = values.filter(Number.isFinite);
        const lo = opts.vmin != null ? Number(opts.vmin) : (fin.length ? Math.min(...fin) : 0);
        const hi = opts.vmax != null ? Number(opts.vmax) : (fin.length ? Math.max(...fin) : 1);
        return { kind: "ramp", field: col, anchors: [...anchors],
                 vmin: labelNum(lo), vmax: labelNum(hi) };
    }

    const cats = [...new Set(values.map(String))].sort();
    const table = categoryAssignments(cats, spec, fallback, true);
    const colourOf = {};
    cats.forEach((c, i) => { colourOf[c] = rgbHex(table[i]); });
    let order;
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
        order = Object.keys(spec).map(String);
        for (const [k, v] of Object.entries(spec)) {
            if (!(String(k) in colourOf)) colourOf[String(k)] = rgbHex(hexToRgb(v));
        }
        const declared = new Set(order);
        order = [...order, ...cats.filter(c => !declared.has(c))];
    } else {
        order = cats;
    }
    const kept = order.slice(0, MAX_LEGEND_CATEGORIES);
    const block = { kind: "categories", field: col,
                    items: kept.map(value => ({ value, color: colourOf[value] })) };
    if (order.length > kept.length) block.truncated = order.length - kept.length;
    return block;
}

export function sizeBlock(lo, hi, field) {
    const block = { kind: "sizes", vmin: labelNum(lo), vmax: labelNum(hi) };
    if (field) block.field = field;
    return block;
}

export function dataDrivenSizeLegend(props, opts) {
    const col = opts.radius_col;
    const values = col ? (props || {})[col] : null;
    if (values == null || !numericOrNull(values)) return null;
    const fin = values.filter(Number.isFinite);
    if (!fin.length) return null;
    return sizeBlock(Math.min(...fin), Math.max(...fin), col);
}

export function dataDrivenColors(props, opts, fallback, method) {
    const col = opts.color_col;
    if (!col) return null;
    const values = (props || {})[col];
    if (values == null) {
        warnOnce(`${method}: color_col '${col}' is not a column of the data; colours `
            + `unchanged. Columns: ${props ? Object.keys(props).sort().join(", ") : "(none)"}.`);
        return null;
    }
    return mapColors(values, opts.colormap, opts.vmin, opts.vmax, opts.color_bins, fallback);
}

export function dataDrivenRadii(props, opts, method) {
    const col = opts.radius_col;
    if (!col) return null;
    const values = (props || {})[col];
    if (values == null) {
        warnOnce(`${method}: radius_col '${col}' is not a column of the data; sizes `
            + `unchanged. Columns: ${props ? Object.keys(props).sort().join(", ") : "(none)"}.`);
        return null;
    }
    if (!numericOrNull(values)) {
        warnOnce(`${method}: radius_col '${col}' is not numeric; sizes unchanged.`);
        return null;
    }
    return mapRadii(values, opts.radius_range || [3.0, 18.0]);
}
