// Style resolution: the JS side of swiftmap/layers/_style.py (and the label
// rules from _grouping.py).
//
// One vocabulary -- color, fill colour/opacity, opacity, weight, radius -- with
// two facts kept apart per option: where it MEANS something (a fill colour
// means nothing on a line) and where the renderer actually DRAWS it today.
// That split lets a warning tell the truth about three failures that look
// identical to the caller: a typo, the wrong option for the shape, and a gap
// in swiftmap. Precedence, highest first: staticStyle, explicit options, a
// per-feature `style` property column, the layer type's defaults -- and a
// style column that resolves uniform collapses back onto the layer, so the
// common case adds nothing to the wire. Conformance with Python is held by
// the authoring goldens.

export const POINTS = new Set(["circle_markers", "markers"]);
export const LINES = new Set(["polyline"]);
export const AREAS = new Set(["polygon", "circle"]);
const GEOMETRY = new Set([...POINTS, ...LINES, ...AREAS]);

// canonical option -> { frontend key, where it applies, where it renders }.
export const STYLE_REGISTRY = {
    color: { frontend: "color", applies: GEOMETRY, renders: GEOMETRY },
    fill_color: { frontend: "fillColor", applies: AREAS, renders: AREAS },
    fill_opacity: { frontend: "fillOpacity", applies: AREAS, renders: AREAS },
    opacity: {
        frontend: "opacity", applies: GEOMETRY,
        renders: new Set([...LINES, ...AREAS]),
        note: "point layers take their alpha from the colour itself, e.g. rgba() or #rrggbbaa",
    },
    weight: { frontend: "weight", applies: new Set([...LINES, ...AREAS]),
              renders: new Set([...LINES, ...AREAS]) },
    radius: { frontend: "radius", applies: new Set([...POINTS, "circle"]),
              renders: new Set([...POINTS, "circle"]),
              note: "pixels for point layers, metres for `circle`" },
};

export const STYLE_KEYS = Object.fromEntries(
    Object.entries(STYLE_REGISTRY).map(([name, spec]) => [name, spec.frontend]));

const ALIASES = {
    fillColor: "fill_color", fillOpacity: "fill_opacity",
    fillcolor: "fill_color", fillopacity: "fill_opacity",
};

// The property auto-detected as per-feature styling. Only this exact name.
export const STYLE_PROPERTY = "style";

export const canonical = (key) => ALIASES[key] || key;

// One style value as a dict of canonical options; a bare string is a colour.
export function normalizeStyle(style) {
    if (style == null) return {};
    if (typeof style === "string") return { color: style };
    if (typeof style === "object" && !Array.isArray(style)) {
        const out = {};
        for (const [k, v] of Object.entries(style)) {
            const name = canonical(k);
            if (name in STYLE_KEYS) out[name] = v;
        }
        return out;
    }
    return {};
}

export function warnOnUndrawnOptions(styles, method, layerType) {
    if (!layerType) return;
    for (const name of Object.keys(styles)) {
        const spec = STYLE_REGISTRY[name];
        if (!spec) continue;
        const suffix = spec.note ? ` (${spec.note})` : "";
        if (!spec.applies.has(layerType)) {
            console.warn(`swiftmap: ${method}: '${name}' does not apply to ${layerType} `
                + `layers. It was accepted but will not change how the layer draws.`);
        } else if (!spec.renders.has(layerType)) {
            console.warn(`swiftmap: ${method}: '${name}' is not drawn for ${layerType} `
                + `layers yet${suffix}. It was accepted but will not change how the `
                + `layer draws.`);
        }
    }
}

// Takes the style options out of an options bag: (explicit, staticStyle), both
// in canonical names, with the capability warnings fired.
export function popStyleOptions(options, method, layerType = null) {
    const staticStyle = normalizeStyle(
        options.staticStyle !== undefined ? options.staticStyle : options.static_style);
    const explicit = {};
    for (const [key, value] of Object.entries(options)) {
        const name = canonical(key);
        if (name in STYLE_KEYS && value !== undefined) explicit[name] = value;
    }
    warnOnUndrawnOptions({ ...explicit, ...staticStyle }, method, layerType);
    return { explicit, staticStyle };
}

// The style for a layer and, where they differ, for each feature in it.
// Returns { layerStyle, featureStyles } in frontend key names; featureStyles is
// null when every feature resolves the same.
export function resolveStyles(explicit, staticStyle, props, count, defaults) {
    const toFrontend = (style) => {
        const out = {};
        for (const [k, v] of Object.entries(style)) {
            if (k in STYLE_KEYS) out[STYLE_KEYS[k]] = v;
        }
        return out;
    };
    const base = { ...defaults, ...explicit, ...staticStyle };
    const layerStyle = toFrontend(base);

    const perFeature = props ? props[STYLE_PROPERTY] : null;
    if (Object.keys(staticStyle).length || !perFeature) {
        return { layerStyle, featureStyles: null };
    }

    const featureStyles = [];
    for (let i = 0; i < count; i++) {
        const raw = Array.isArray(perFeature) && i < perFeature.length ? perFeature[i] : null;
        featureStyles.push(toFrontend({ ...defaults, ...normalizeStyle(raw), ...explicit }));
    }
    if (!featureStyles.length) return { layerStyle, featureStyles: null };
    const first = JSON.stringify(featureStyles[0]);
    if (featureStyles.every(style => JSON.stringify(style) === first)) {
        return { layerStyle: { ...layerStyle, ...featureStyles[0] }, featureStyles: null };
    }
    return { layerStyle, featureStyles };
}

// One label per feature: the column's values when `label` names one, else the
// literal repeated. null stays null so unlabelled layers carry nothing.
export function resolveFeatureLabels(label, props, count) {
    if (label == null) return null;
    if (props && label in props && Array.isArray(props[label])) {
        return props[label].slice(0, count).map(v => (v == null ? "" : String(v)));
    }
    return new Array(count).fill(String(label));
}

// One vector feature's label, column-or-literal.
export function resolveFeatureLabel(label, props, index) {
    if (label == null) return null;
    if (props && label in props && Array.isArray(props[label])) {
        const value = index < props[label].length ? props[label][index] : null;
        return value == null ? "" : String(value);
    }
    return String(label);
}
