export function loadCSS(id, url) {
    if (!document.getElementById(id)) {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = url;
        document.head.appendChild(link);
    }
}

const activeLoaders = {};

export function loadJS(id, url) {
    if (activeLoaders[id]) {
        return activeLoaders[id];
    }
    const promise = new Promise((resolve, reject) => {
        if (document.getElementById(id)) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.id = id;
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
        document.head.appendChild(script);
    });
    activeLoaders[id] = promise;
    return promise;
}

function hexToRgb(hex) {
    if (!hex) return null;
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    if (hex.length !== 6) return null;
    const num = parseInt(hex, 16);
    return {
        r: ((num >> 16) & 255) / 255,
        g: ((num >> 8) & 255) / 255,
        b: (num & 255) / 255
    };
}

let colorProbe = null;

// Browsers ship a complete CSS color parser -- every named color, rgb(), hsl(), hwb().
// Borrow it instead of maintaining a lookup table. Returns null outside a DOM (Node tests),
// where the hex fallback in parseColor still applies.
function cssColorToRgb(value) {
    if (typeof document === "undefined") return null;
    if (!colorProbe) colorProbe = document.createElement("canvas").getContext("2d");

    // Assigning an invalid color leaves fillStyle untouched, so probe against two different
    // sentinels: only a value the browser actually parsed produces the same result twice.
    colorProbe.fillStyle = "#000000";
    colorProbe.fillStyle = value;
    const first = colorProbe.fillStyle;
    colorProbe.fillStyle = "#ffffff";
    colorProbe.fillStyle = value;
    if (first !== colorProbe.fillStyle) return null;

    if (first.startsWith("#")) return hexToRgb(first);
    const match = first.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(",").map(p => parseFloat(p.trim()));
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
}

export function parseColor(colorStr, fallbackHex = "#3388ff") {
    if (!colorStr) colorStr = fallbackHex;
    return cssColorToRgb(colorStr)
        || hexToRgb(colorStr)
        || cssColorToRgb(fallbackHex)
        || hexToRgb(fallbackHex)
        || { r: 0.2, g: 0.5, b: 1.0 };
}

const URL_ATTR_BEFORE = /(?:href|src)\s*=\s*['"]?$/i;
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|data:image\/|[./#?]|[\w.-]+(?:[/?#]|$))/i;

// Property values come from user data and end up in innerHTML, so they are escaped.
// Markup the app author wrote (templates, style strings) is left intact.
export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Escaping stops attribute breakout but not "javascript:" in an href, so values landing
// in a URL attribute get a scheme check. Control characters are stripped first because
// "java\tscript:" survives a naive comparison.
export function safeUrl(value) {
    const collapsed = String(value).split("").filter(c => c.charCodeAt(0) > 32).join("");
    return SAFE_URL.test(collapsed) ? String(value) : "";
}

export function formatPropertiesHTML(props, fields, names) {
    const targetFields = (Array.isArray(fields) && fields.length) ? fields : Object.keys(props);
    const labels = (Array.isArray(names) && names.length === targetFields.length) ? names : targetFields;
    const lines = [];
    for (let i = 0; i < targetFields.length; i++) {
        const f = targetFields[i];
        if (props[f] === undefined || props[f] === null) continue;
        lines.push(`<b>${escapeHtml(labels[i])}</b>: ${escapeHtml(props[f])}`);
    }
    return lines.join("<br>");
}

// "{column}" inserts one escaped value; "{*}" inserts the default field list.
function renderTemplate(template, props, fields, names) {
    return template.replace(/\{(\*|\w+)\}/g, (match, key, offset) => {
        if (key === "*") {
            return formatPropertiesHTML(props, fields, names);
        }
        const val = props[key];
        if (val === undefined || val === null) return "";
        const preceding = template.slice(Math.max(0, offset - 16), offset);
        return escapeHtml(URL_ATTR_BEFORE.test(preceding) ? safeUrl(val) : val);
    });
}

export function renderContent(props, layer, kind) {
    const template = layer[kind + "_template"];
    const fields = layer[kind + "_fields"];
    const names = layer[kind + "_names"];
    if (typeof template === "string" && template) {
        return renderTemplate(template, props, fields, names);
    }
    return formatPropertiesHTML(props, fields, names);
}

function wrapStyled(html, style) {
    if (!style) return html;
    return `<div style="${escapeHtml(style)}">${html}</div>`;
}

export function bindPopup(map, latlng, props, layer) {
    const html = renderContent(props, layer, "popup");
    if (html && (layer.autobind_popup || layer.popup_fields || layer.popup_template)) {
        const options = {};
        if (layer.popup_max_width) options.maxWidth = layer.popup_max_width;
        L.popup(options)
            .setLatLng(latlng)
            .setContent(wrapStyled(html, layer.popup_style))
            .openOn(map);
    }
}

export function bindTooltip(map, latlng, props, layer, layerInstance) {
    const html = renderContent(props, layer, "tooltip");
    if (html && (layer.autobind_tooltip || layer.tooltip_fields || layer.tooltip_template)) {
        if (!layerInstance._sharedTooltip) {
            layerInstance._sharedTooltip = L.tooltip({ direction: 'top', offset: [0, -5] });
        }
        layerInstance._sharedTooltip
            .setLatLng(latlng)
            .setContent(wrapStyled(html, layer.tooltip_style))
            .addTo(map);
    }
}
