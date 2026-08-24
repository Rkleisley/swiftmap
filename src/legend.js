// The legend: derived from the same layer state everything else renders from, with
// declarative overrides on top. Deliberately model-free -- pure data in, DOM out --
// so a plain-JS consumer of dist/index.js gets the whole feature, and the anywidget
// glue in map.js is a few lines. (sidebar.js still takes `model` and is filed for
// extraction; this module must never need that unpicking.)
//
// The pipeline: deriveLegendSpec(layers, groupConfigs, config) walks the layers into
// entries (skipped entirely when config.auto === false), applies the persistent
// remove-matchers, appends the manual adds, and returns a spec that renderLegend
// turns into DOM. Nothing here knows about colormaps: ramp/category/bin entries
// arrive with their colours already resolved (Python resolves at the add_* boundary,
// manual entries at legend_add), so there is no anchor table to drift.

import { isLayerEffectiveVisible } from "./patch.js";

const GLYPHS = {
    circle_markers: "circle",
    markers: "pin",
    polyline: "line",
    polygon: "polygon",
    circle: "circle",
};

function swatchEntry(layer, hidden) {
    return {
        kind: "swatch",
        label: layer.name || "Layer",
        shape: GLYPHS[layer.type] || "square",
        color: layer.color || "#3388ff",
        fillColor: layer.fillColor || layer.fill_color || layer.color || "#3388ff",
        hidden,
    };
}

// A data-driven block recorded at add time ({kind, anchors|items|edges+colors, ...})
// becomes the layer's entry as-is; the layer only contributes label and visibility.
function blockEntry(layer, hidden) {
    return { ...layer.legend, label: layer.name || "Layer", hidden };
}

function entriesForLayer(layer, groupConfigs) {
    if (layer.type === "basemap") return [];
    const hidden = !isLayerEffectiveVisible(layer, groupConfigs);
    if (layer.type === "group") {
        // A collection: one entry per geometry part, same label by design -- the
        // glyphs are what tell them apart, matching how the parts render.
        return (layer.layers || [])
            .filter(sub => GLYPHS[sub.type])
            .map(sub => sub.legend
                ? blockEntry({ ...sub, name: layer.name }, hidden)
                : swatchEntry({ ...sub, name: layer.name }, hidden));
    }
    if (!GLYPHS[layer.type]) return [];
    const entries = [layer.legend ? blockEntry(layer, hidden) : swatchEntry(layer, hidden)];
    // radius_col records a size key beside the colour story: both encodings on the
    // map deserve both explanations in the legend.
    if (layer.legend_size) {
        entries.push({ ...layer.legend_size,
                       label: layer.legend_size.field || layer.name || "Size", hidden });
    }
    return entries;
}

// Identical data-driven payloads collapse into one row. Grouping points by a column
// gives every sub-layer the same ramp; a ramp per sub-layer is noise, and the field
// name is the honest label for the shared mapping. The survivor keeps the first
// occurrence's position and hides only when every contributor is hidden.
function payloadKey(entry) {
    // Identity fields stay out of the key: the whole point is that entries from
    // DIFFERENT layers collapse when their mapping payload is the same.
    const { label, hidden, layerId, layer, group, ...payload } = entry;
    return JSON.stringify(payload);
}

function dedupeDataEntries(groups) {
    const seen = new Map();   // payload key -> surviving entry
    for (const group of groups) {
        group.entries = group.entries.filter(entry => {
            if (entry.kind === "swatch") return true;
            const key = payloadKey(entry);
            const survivor = seen.get(key);
            if (!survivor) {
                seen.set(key, entry);
                if (entry.field) entry.label = entry.field;
                return true;
            }
            survivor.hidden = survivor.hidden && entry.hidden;
            return false;
        });
    }
    return groups;
}

function matcherHits(matcher, entry, groupName) {
    if (!matcher) return false;
    let constrained = false;
    if (matcher.label != null) {
        constrained = true;
        if (entry.label !== matcher.label) return false;
    }
    if (matcher.group != null) {
        constrained = true;
        if (groupName !== matcher.group) return false;
    }
    if (matcher.id != null) {
        constrained = true;
        if (entry.layerId !== matcher.id) return false;
    }
    return constrained;
}

// A ramp endpoint as it should read in a legend: 10, not 10.000000001, and
// 0.003757, not 0.0037567270919680595. Four significant figures, integers whole,
// anything non-numeric passed through. Python rounds its side before composing
// a block (_label_num), but legends derived or hand-built in JS arrive raw.
export function formatBound(value) {
    const n = Number(value);
    if (value == null || value === "" || !isFinite(n)) return String(value);
    return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)));
}

export function deriveLegendSpec(layers, groupConfigs, config) {
    const cfg = config || {};
    const groups = [];
    const byName = new Map();
    const groupFor = name => {
        if (!byName.has(name)) {
            const group = { name, entries: [] };
            byName.set(name, group);
            groups.push(group);
        }
        return byName.get(name);
    };

    if (cfg.auto !== false) {
        for (const layer of layers || []) {
            for (const entry of entriesForLayer(layer, groupConfigs || {})) {
                entry.layerId = layer.id;
                if (cfg.scope === "visible" && entry.hidden) continue;
                groupFor(layer.layer_group || "Layers").entries.push(entry);
            }
        }
        dedupeDataEntries(groups);
    }

    // Persistent suppression: matchers outlive every re-derivation, which is the
    // difference from a registry remove that the next add would just repopulate.
    const removes = cfg.remove || [];
    if (removes.length > 0) {
        for (const group of groups) {
            group.entries = group.entries.filter(
                entry => !removes.some(m => matcherHits(m, entry, group.name)));
        }
    }

    // Manual entries: the user's own claims. scope never drops them; a `layer`
    // binding makes one follow a live layer's visibility (and vanish with it under
    // scope "visible"), for when a manual row is really a relabelling.
    for (const added of cfg.add || []) {
        const entry = { hidden: false, ...added };
        if (entry.layer != null) {
            const bound = (layers || []).find(
                l => l.id === entry.layer || l.name === entry.layer);
            entry.hidden = !bound || !isLayerEffectiveVisible(bound, groupConfigs || {});
            if (cfg.scope === "visible" && entry.hidden) continue;
        }
        if (removes.some(m => matcherHits(m, entry, entry.group || ""))) continue;
        groupFor(entry.group || "").entries.push(entry);
    }

    const populated = groups.filter(g => g.entries.length > 0);
    return { title: cfg.title || "Legend", groups: populated };
}

// --- rendering ------------------------------------------------------------------------
// DOM built with createElement/textContent throughout: labels and category values come
// from user data and must never be parsed as HTML.

function div(styles, text) {
    const el = document.createElement("div");
    Object.assign(el.style, styles);
    if (text != null) el.textContent = text;
    return el;
}

function glyph(entry) {
    if (entry.shape === "line") {
        return div({ width: "20px", height: "4px", background: entry.color,
                     marginRight: "6px", flex: "none" });
    }
    if (entry.shape === "pin") {
        const el = document.createElement("span");
        el.style.marginRight = "6px";
        el.style.flex = "none";
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "12");
        svg.setAttribute("height", "14");
        svg.setAttribute("viewBox", "0 0 24 28");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d",
            "M12 0C5.4 0 0 5.4 0 12c0 9 12 16 12 16s12-7 12-16C24 5.4 18.6 0 12 0z");
        path.setAttribute("fill", entry.color);
        svg.appendChild(path);
        el.appendChild(svg);
        return el;
    }
    // circle / polygon / square: fill inside a border, which is how areas draw.
    const radius = entry.shape === "circle" ? "50%"
        : entry.shape === "polygon" ? "2px" : "0";
    return div({ width: "12px", height: "12px", background: entry.fillColor,
                 border: `2px solid ${entry.color}`, borderRadius: radius,
                 marginRight: "6px", flex: "none", boxSizing: "border-box" });
}

function rampRow(entry) {
    const row = div({ marginTop: "5px" });
    row.appendChild(div({}, entry.label));
    const stops = (entry.anchors || []).map((color, i, all) =>
        `${color} ${all.length > 1 ? (i / (all.length - 1)) * 100 : 0}%`);
    row.appendChild(div({
        width: "120px", height: "12px", borderRadius: "2px",
        backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`,
    }));
    const ends = div({ display: "flex", justifyContent: "space-between", width: "120px",
                       fontSize: "11px", color: "#555" });
    ends.appendChild(div({}, formatBound(entry.vmin)));
    ends.appendChild(div({}, formatBound(entry.vmax)));
    row.appendChild(ends);
    return row;
}

const MAX_CATEGORY_ROWS = 12;

function categoriesRow(entry) {
    const row = div({ marginTop: "5px" });
    row.appendChild(div({}, entry.label));
    const items = entry.items || [];
    for (const item of items.slice(0, MAX_CATEGORY_ROWS)) {
        const line = div({ display: "flex", alignItems: "center", marginTop: "3px",
                           marginLeft: "8px" });
        line.appendChild(glyph({ shape: "square", color: item.color, fillColor: item.color }));
        line.appendChild(div({}, String(item.value)));
        row.appendChild(line);
    }
    if (items.length > MAX_CATEGORY_ROWS) {
        row.appendChild(div({ marginLeft: "8px", marginTop: "3px", color: "#555" },
            `+ ${items.length - MAX_CATEGORY_ROWS} more`));
    }
    return row;
}

function binsRow(entry) {
    const row = div({ marginTop: "5px" });
    row.appendChild(div({}, entry.label));
    const edges = entry.edges || [];
    const colors = entry.colors || [];
    const labelFor = i => i === 0 ? `< ${edges[0]}`
        : i === edges.length ? `≥ ${edges[edges.length - 1]}`
        : `${edges[i - 1]} – ${edges[i]}`;
    colors.forEach((color, i) => {
        const line = div({ display: "flex", alignItems: "center", marginTop: "3px",
                           marginLeft: "8px" });
        line.appendChild(glyph({ shape: "square", color, fillColor: color }));
        line.appendChild(div({}, labelFor(i)));
        row.appendChild(line);
    });
    return row;
}

// A size key is a statement, not a drawing: "● size ∝ field (min – max)". The glyph
// is fixed and nothing in the row derives from radius_range or the data's spread --
// legend CSS pixels are not map pixels at any zoom, so drawn sample circles would
// assert a precision that does not exist. The row names the encoding and its domain.
function sizesRow(entry) {
    const row = div({ display: "flex", alignItems: "center", marginTop: "5px" });
    row.appendChild(div({ marginRight: "6px", flex: "none", color: "#666" }, "●"));
    const range = entry.vmin != null && entry.vmax != null
        ? ` (${formatBound(entry.vmin)} – ${formatBound(entry.vmax)})` : "";
    row.appendChild(div({}, `size ∝ ${entry.field || entry.label}${range}`));
    return row;
}

function swatchRow(entry) {
    const row = div({ display: "flex", alignItems: "center", marginTop: "5px" });
    row.appendChild(glyph(entry));
    row.appendChild(div({}, entry.label));
    return row;
}

// Collapse state, per container rather than module scope: the sidebar keys its
// collapsedPaths at module level and two maps on one page share it -- a filed bug
// this deliberately does not inherit. Keyed by group name, surviving the full
// re-render every sync performs.
const collapsedByContainer = new WeakMap();

export function renderLegend(container, spec, options = {}) {
    container.innerHTML = "";
    const dimHidden = options.dimHidden !== false;
    let collapsed = collapsedByContainer.get(container);
    if (!collapsed) {
        collapsed = new Set();
        collapsedByContainer.set(container, collapsed);
    }
    container.appendChild(div({
        fontSize: "13px", fontWeight: "bold", borderBottom: "2px solid #eee",
        paddingBottom: "4px", marginBottom: "4px",
    }, spec.title));

    for (const group of spec.groups) {
        const isCollapsed = group.name && collapsed.has(group.name);
        if (group.name) {
            // The sidebar's affordance exactly: an arrow that folds the section.
            const header = div({ fontWeight: "bold", marginTop: "6px",
                                 cursor: "pointer", userSelect: "none" });
            header.textContent = `${isCollapsed ? "▸" : "▾"} ${group.name}`;
            header.addEventListener("click", () => {
                if (collapsed.has(group.name)) collapsed.delete(group.name);
                else collapsed.add(group.name);
                renderLegend(container, spec, options);
            });
            container.appendChild(header);
        }
        if (isCollapsed) continue;
        for (const entry of group.entries) {
            const row = entry.kind === "ramp" ? rampRow(entry)
                : entry.kind === "categories" ? categoriesRow(entry)
                : entry.kind === "bins" ? binsRow(entry)
                : entry.kind === "sizes" ? sizesRow(entry)
                : swatchRow(entry);
            // Dimmed, not dropped: under scope "all" the legend is the map's whole
            // vocabulary, and the dim is what still tells the current screen state.
            if (entry.hidden && dimHidden) row.style.opacity = "0.5";
            container.appendChild(row);
        }
    }
    return container;
}
