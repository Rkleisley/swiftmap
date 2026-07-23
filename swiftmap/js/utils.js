export function loadCSS(id, url) {
    if (!document.getElementById(id)) {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = url;
        document.head.appendChild(link);
    }
}

export function loadJS(id, url) {
    return new Promise((resolve, reject) => {
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
}

const COLOR_NAMES = {
    red: { r: 0.9, g: 0.1, b: 0.15 },
    green: { r: 0.1, g: 0.8, b: 0.2 },
    blue: { r: 0.2, g: 0.5, b: 1.0 },
    orange: { r: 1.0, g: 0.5, b: 0.0 },
    purple: { r: 0.6, g: 0.1, b: 0.8 },
    black: { r: 0.0, g: 0.0, b: 0.0 },
    white: { r: 1.0, g: 1.0, b: 1.0 }
};

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

export function parseColor(colorStr, fallbackHex = "#3388ff") {
    if (!colorStr) colorStr = fallbackHex;
    const nameColor = COLOR_NAMES[colorStr.toLowerCase()];
    if (nameColor) return nameColor;
    return hexToRgb(colorStr) || hexToRgb(fallbackHex) || { r: 0.2, g: 0.5, b: 1.0 };
}

export function formatPropertiesHTML(props, fields) {
    let targetFields = Array.isArray(fields) ? fields : Object.keys(props);
    let lines = [];
    for (let idx = 0; idx < targetFields.length; idx++) {
        let f = targetFields[idx];
        if (props[f] !== undefined && props[f] !== null) {
            let val = Array.isArray(props[f]) ? props[f] : [props[f]];
            lines.push(`<b>${f}</b>: ${val}`);
        }
    }
    return lines.join("<br>");
}

export function bindPopup(map, latlng, props, layer) {
    const html = formatPropertiesHTML(props, layer.popup_fields);
    if (html && (layer.autobind_popup || layer.popup_fields)) {
        L.popup()
            .setLatLng(latlng)
            .setContent(html)
            .openOn(map);
    }
}

export function bindTooltip(map, latlng, props, layer, layerInstance) {
    const html = formatPropertiesHTML(props, layer.tooltip_fields);
    if (html && (layer.autobind_tooltip || layer.tooltip_fields)) {
        if (!layerInstance._sharedTooltip) {
            layerInstance._sharedTooltip = L.tooltip({ direction: 'top', offset: [0, -5] });
        }
        layerInstance._sharedTooltip
            .setLatLng(latlng)
            .setContent(html)
            .addTo(map);
    }
}
