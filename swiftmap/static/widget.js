// src/utils.js
function loadCSS(id, url) {
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
  }
}
var activeLoaders = {};
function loadJS(id, url) {
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
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex.split("").map((char) => char + char).join("");
  }
  if (hex.length !== 6) return null;
  const num = parseInt(hex, 16);
  return {
    r: (num >> 16 & 255) / 255,
    g: (num >> 8 & 255) / 255,
    b: (num & 255) / 255
  };
}
var colorProbe = null;
function cssColorToRgb(value) {
  if (typeof document === "undefined") return null;
  if (!colorProbe) colorProbe = document.createElement("canvas").getContext("2d");
  colorProbe.fillStyle = "#000000";
  colorProbe.fillStyle = value;
  const first = colorProbe.fillStyle;
  colorProbe.fillStyle = "#ffffff";
  colorProbe.fillStyle = value;
  if (first !== colorProbe.fillStyle) return null;
  if (first.startsWith("#")) return hexToRgb(first);
  const match = first.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
}
function parseColor(colorStr, fallbackHex = "#3388ff") {
  if (!colorStr) colorStr = fallbackHex;
  return cssColorToRgb(colorStr) || hexToRgb(colorStr) || cssColorToRgb(fallbackHex) || hexToRgb(fallbackHex) || { r: 0.2, g: 0.5, b: 1 };
}
var URL_ATTR_BEFORE = /(?:href|src)\s*=\s*['"]?$/i;
var SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|data:image\/|[./#?]|[\w.-]+(?:[/?#]|$))/i;
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeUrl(value) {
  const collapsed = String(value).split("").filter((c) => c.charCodeAt(0) > 32).join("");
  return SAFE_URL.test(collapsed) ? String(value) : "";
}
function formatPropertiesHTML(props, fields, names) {
  const targetFields = Array.isArray(fields) && fields.length ? fields : Object.keys(props);
  const labels = Array.isArray(names) && names.length === targetFields.length ? names : targetFields;
  const lines = [];
  for (let i = 0; i < targetFields.length; i++) {
    const f = targetFields[i];
    if (props[f] === void 0 || props[f] === null) continue;
    lines.push(`<b>${escapeHtml(labels[i])}</b>: ${escapeHtml(props[f])}`);
  }
  return lines.join("<br>");
}
function renderTemplate(template, props, fields, names) {
  return template.replace(/\{(\*|\w+)\}/g, (match, key, offset) => {
    if (key === "*") {
      return formatPropertiesHTML(props, fields, names);
    }
    const val = props[key];
    if (val === void 0 || val === null) return "";
    const preceding = template.slice(Math.max(0, offset - 16), offset);
    return escapeHtml(URL_ATTR_BEFORE.test(preceding) ? safeUrl(val) : val);
  });
}
function renderContent(props, layer, kind) {
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
function bindPopup(map, latlng, props, layer) {
  const html = renderContent(props, layer, "popup");
  if (html && (layer.autobind_popup || layer.popup_fields || layer.popup_template)) {
    const options = {};
    if (layer.popup_max_width) options.maxWidth = layer.popup_max_width;
    L.popup(options).setLatLng(latlng).setContent(wrapStyled(html, layer.popup_style)).openOn(map);
  }
}
function bindTooltip(map, latlng, props, layer, layerInstance) {
  const html = renderContent(props, layer, "tooltip");
  if (html && (layer.autobind_tooltip || layer.tooltip_fields || layer.tooltip_template)) {
    if (!layerInstance._sharedTooltip) {
      layerInstance._sharedTooltip = L.tooltip({ direction: "top", offset: [0, -5] });
    }
    layerInstance._sharedTooltip.setLatLng(latlng).setContent(wrapStyled(html, layer.tooltip_style)).addTo(map);
  }
}

// src/sidebar.js
var collapsedPaths = {};
function getLayerBounds(l, coordinateBuffers) {
  if (!l) return null;
  if (l.isGroup) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    Object.keys(l.children).forEach((key) => {
      const b = getLayerBounds(l.children[key], coordinateBuffers);
      if (b) {
        if (b[0][0] < minLat) minLat = b[0][0];
        if (b[1][0] > maxLat) maxLat = b[1][0];
        if (b[0][1] < minLon) minLon = b[0][1];
        if (b[1][1] > maxLon) maxLon = b[1][1];
      }
    });
    l.layers.forEach((lyr) => {
      const b = getLayerBounds(lyr, coordinateBuffers);
      if (b) {
        if (b[0][0] < minLat) minLat = b[0][0];
        if (b[1][0] > maxLat) maxLat = b[1][0];
        if (b[0][1] < minLon) minLon = b[0][1];
        if (b[1][1] > maxLon) maxLon = b[1][1];
      }
    });
    if (minLat !== Infinity) {
      return [[minLat, minLon], [maxLat, maxLon]];
    }
    return null;
  }
  if (l.bounds && l.bounds.length > 0) {
    return l.bounds;
  }
  if (l.type === "group" && l.layers) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    for (const sub of l.layers) {
      const b = getLayerBounds(sub, coordinateBuffers);
      if (b) {
        if (b[0][0] < minLat) minLat = b[0][0];
        if (b[1][0] > maxLat) maxLat = b[1][0];
        if (b[0][1] < minLon) minLon = b[0][1];
        if (b[1][1] > maxLon) maxLon = b[1][1];
      }
    }
    if (minLat !== Infinity) {
      return [[minLat, minLon], [maxLat, maxLon]];
    }
  }
  if (l.locations && l.locations.length > 0) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    const coords = l.locations.flat(Infinity);
    for (let i = 0; i < coords.length; i += 2) {
      const lat = coords[i];
      const lon = coords[i + 1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    if (minLat !== Infinity) {
      return [[minLat, minLon], [maxLat, maxLon]];
    }
  }
  if (coordinateBuffers) {
    const buf = coordinateBuffers[l.id];
    if (buf) {
      const coords = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
      let minLat = Infinity, maxLat = -Infinity;
      let minLon = Infinity, maxLon = -Infinity;
      for (let i = 0; i < coords.length / 2; i++) {
        const lat = coords[i * 2];
        const lon = coords[i * 2 + 1];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
      if (minLat !== Infinity) {
        return [[minLat, minLon], [maxLat, maxLon]];
      }
    }
  }
  return null;
}
function normalizeRadioLayers(layers, groupConfigs) {
  const tree = { name: "Root", path: "", children: {}, layers: [], isGroup: true };
  if (!groupConfigs[""]) {
    groupConfigs[""] = { multi_select: true, visible: true };
  }
  layers.forEach((l) => {
    const pathStr = l.layer_group || "Layers";
    const parts = pathStr.split("/");
    let curr = tree;
    let runningPath = "";
    parts.forEach((part) => {
      runningPath = runningPath ? `${runningPath}/${part}` : part;
      if (!curr.children[part]) {
        curr.children[part] = {
          name: part,
          path: runningPath,
          children: {},
          layers: [],
          isGroup: true
        };
      }
      curr = curr.children[part];
    });
    curr.layers.push(l);
  });
  let modelNeedsUpdate = false;
  function enforceRadioToggles(node) {
    const conf = groupConfigs[node.path] || { multi_select: true };
    const isRadioGroup = conf.multi_select === false;
    if (isRadioGroup) {
      let foundActive = false;
      Object.keys(node.children).forEach((key) => {
        const childGroup = node.children[key];
        if (!groupConfigs[childGroup.path]) {
          groupConfigs[childGroup.path] = { visible: true, multi_select: true };
        }
        const isVisible = groupConfigs[childGroup.path].visible !== false;
        if (isVisible) {
          if (foundActive) {
            groupConfigs[childGroup.path].visible = false;
            collapsedPaths[childGroup.path] = true;
            modelNeedsUpdate = true;
          } else {
            foundActive = true;
            collapsedPaths[childGroup.path] = false;
          }
        } else {
          collapsedPaths[childGroup.path] = true;
        }
      });
      node.layers.forEach((lyr) => {
        const isVisible = lyr.visible !== false;
        if (isVisible) {
          if (foundActive) {
            lyr.visible = false;
            modelNeedsUpdate = true;
          } else {
            foundActive = true;
          }
        }
      });
    }
    Object.keys(node.children).forEach((key) => {
      enforceRadioToggles(node.children[key]);
    });
  }
  enforceRadioToggles(tree);
  return modelNeedsUpdate;
}
function renderSidebarControls(sidebar, layers, model, map, onLayerToggle) {
  sidebar.innerHTML = "<b style='font-size: 13px; border-bottom: 2px solid #eee; padding-bottom: 4px; display: block; margin-bottom: 8px;'>Layers Control</b>";
  const groupConfigs = model.get("group_configs") || {};
  const tree = { name: "Root", path: "", children: {}, layers: [], isGroup: true };
  if (!groupConfigs[""]) {
    groupConfigs[""] = { multi_select: true, visible: true };
  }
  layers.forEach((l) => {
    const pathStr = l.layer_group || "Layers";
    const parts = pathStr.split("/");
    let curr = tree;
    let runningPath = "";
    parts.forEach((part) => {
      runningPath = runningPath ? `${runningPath}/${part}` : part;
      if (!curr.children[part]) {
        curr.children[part] = {
          name: part,
          path: runningPath,
          children: {},
          layers: [],
          isGroup: true
        };
      }
      curr = curr.children[part];
    });
    curr.layers.push(l);
  });
  function renderNode(node, parentEl, depth, parentNode, parentEffectiveVisible) {
    if (node.path === "") {
      Object.keys(node.children).forEach((key) => {
        renderNode(node.children[key], parentEl, depth, node, true);
      });
      node.layers.forEach((lyr) => {
        renderNode(lyr, parentEl, depth, node, true);
      });
      return;
    }
    const isGroup = node.isGroup === true;
    const path = isGroup ? node.path : null;
    const name = node.name;
    const id = isGroup ? null : node.id;
    const parentPath = parentNode ? parentNode.path : "";
    const parentConf = groupConfigs[parentPath] || { multi_select: true };
    const isMultiSelect = parentConf.multi_select !== false;
    const nodeDiv = document.createElement("div");
    nodeDiv.style.marginBottom = "4px";
    let selfVisible = true;
    if (isGroup) {
      selfVisible = path === "Basemaps" ? true : groupConfigs[path]?.visible !== false;
    } else {
      selfVisible = node.visible !== false;
    }
    const selfEffectiveVisible = parentEffectiveVisible && selfVisible;
    const headerDiv = document.createElement("div");
    headerDiv.style.display = "flex";
    headerDiv.style.alignItems = "center";
    headerDiv.style.cursor = "pointer";
    headerDiv.style.userSelect = "none";
    headerDiv.style.webkitUserSelect = "none";
    headerDiv.style.fontSize = "12px";
    if (!parentEffectiveVisible) {
      headerDiv.style.opacity = "0.5";
      headerDiv.style.color = "#888";
    }
    let toggleEl = null;
    if (isGroup) {
      toggleEl = document.createElement("span");
      toggleEl.style.marginRight = "4px";
      toggleEl.style.width = "14px";
      toggleEl.style.fontSize = "16px";
      toggleEl.style.lineHeight = "1";
      toggleEl.style.display = "inline-block";
      toggleEl.style.textAlign = "center";
      const isCollapsed = collapsedPaths[path] === true;
      toggleEl.textContent = isCollapsed ? "\u25B8" : "\u25BE";
      toggleEl.style.fontWeight = "bold";
      headerDiv.appendChild(toggleEl);
    } else {
      const spacer = document.createElement("span");
      spacer.style.marginRight = "4px";
      spacer.style.width = "14px";
      spacer.style.display = "inline-block";
      headerDiv.appendChild(spacer);
    }
    let input = null;
    if (!isGroup || path !== "Basemaps") {
      input = document.createElement("input");
      input.type = isMultiSelect ? "checkbox" : "radio";
      input.name = isMultiSelect ? isGroup ? `group_${path}` : `layer_${id}` : `parent_${parentPath}`;
      input.style.marginRight = "6px";
      input.style.cursor = "pointer";
      input.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      if (isGroup) {
        if (!groupConfigs[path]) {
          groupConfigs[path] = { visible: true, multi_select: true };
        }
        input.checked = groupConfigs[path].visible !== false;
      } else {
        input.checked = node.visible !== false;
      }
      headerDiv.appendChild(input);
    }
    const label = document.createElement("span");
    label.textContent = name;
    if (isGroup) {
      label.style.fontWeight = "bold";
    }
    headerDiv.appendChild(label);
    nodeDiv.appendChild(headerDiv);
    let childrenDiv = null;
    if (isGroup) {
      childrenDiv = document.createElement("div");
      const isCollapsed = collapsedPaths[path] === true;
      childrenDiv.style.display = isCollapsed ? "none" : "block";
      childrenDiv.style.borderLeft = "1px dashed #ccc";
      childrenDiv.style.marginLeft = "5px";
      childrenDiv.style.paddingLeft = "8px";
      Object.keys(node.children).forEach((key) => {
        renderNode(node.children[key], childrenDiv, depth + 1, node, selfEffectiveVisible);
      });
      node.layers.forEach((lyr) => {
        renderNode(lyr, childrenDiv, depth + 1, node, selfEffectiveVisible);
      });
      nodeDiv.appendChild(childrenDiv);
    }
    if (isGroup) {
      headerDiv.addEventListener("click", () => {
        const isCollapsed = collapsedPaths[path] === true;
        collapsedPaths[path] = !isCollapsed;
        if (toggleEl) {
          toggleEl.textContent = !isCollapsed ? "\u25B8" : "\u25BE";
        }
        if (childrenDiv) {
          childrenDiv.style.display = !isCollapsed ? "none" : "block";
        }
      });
    }
    if (input) {
      label.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isMultiSelect) {
          input.checked = !input.checked;
        } else {
          input.checked = true;
        }
        input.dispatchEvent(new Event("change"));
      });
    }
    if (input) {
      input.addEventListener("change", () => {
        const isChecked = input.checked;
        if (!isMultiSelect && !isChecked) {
          return;
        }
        let updatedLayers = [...layers];
        if (!isMultiSelect) {
          Object.keys(parentNode.children).forEach((key) => {
            const sibGroup = parentNode.children[key];
            const active = sibGroup.path === path;
            groupConfigs[sibGroup.path] = {
              ...groupConfigs[sibGroup.path],
              visible: active
            };
            collapsedPaths[sibGroup.path] = !active;
          });
          parentNode.layers.forEach((sibLyr) => {
            const active = sibLyr.id === id;
            updatedLayers = updatedLayers.map((origLayer) => {
              if (origLayer.id === sibLyr.id) {
                return { ...origLayer, visible: active };
              }
              return origLayer;
            });
          });
        } else {
          if (isGroup) {
            groupConfigs[path] = {
              ...groupConfigs[path],
              visible: isChecked
            };
            collapsedPaths[path] = !isChecked;
          } else {
            updatedLayers = updatedLayers.map((origLayer) => {
              if (origLayer.id === id) {
                return { ...origLayer, visible: isChecked };
              }
              return origLayer;
            });
          }
        }
        model.set("layers", updatedLayers);
        model.set("group_configs", groupConfigs);
        model.save_changes();
        if (isChecked && map) {
          const bounds = getLayerBounds(node, model.get("coordinate_buffers") || {});
          if (bounds) {
            map.fitBounds(bounds);
          }
        }
        if (onLayerToggle) {
          onLayerToggle();
        }
      });
    }
    parentEl.appendChild(nodeDiv);
  }
  renderNode(tree, sidebar, 0, null, true);
}

// src/shaders.js
var pinShader = `
precision mediump float;
varying vec4 _color;
void main() {
    // uv ranges from -0.5 to 0.5. The center (0.0, 0.0) is the exact coordinate.
    vec2 uv = gl_PointCoord.xy - vec2(0.5);

    // Pin head circle centered at (0.0, -0.30) with radius 0.16
    float d_circle = length(uv - vec2(0.0, -0.30)) - 0.16;
    
    // Pin body triangle pointing exactly to (0.0, 0.0)
    float d_triangle = max(abs(uv.x) * 1.875 + uv.y, -uv.y - 0.30);
    float d_pin = min(d_circle, d_triangle);

    // Inner hole centered at (0.0, -0.30) with radius 0.06
    float d_hole = length(uv - vec2(0.0, -0.30)) - 0.06;

    // Drop shadow shifted slightly down and blurred
    vec2 shadowUv = uv - vec2(0.0, 0.04);
    float d_shadow_circle = length(shadowUv - vec2(0.0, -0.30)) - 0.16;
    float d_shadow_triangle = max(abs(shadowUv.x) * 1.875 + shadowUv.y, -shadowUv.y - 0.30);
    float d_shadow = min(d_shadow_circle, d_shadow_triangle);

    // Anti-aliased masks
    float mask_pin = 1.0 - smoothstep(-0.012, 0.012, d_pin);
    float mask_hole = 1.0 - smoothstep(-0.012, 0.012, d_hole);
    float mask_border = 1.0 - smoothstep(-0.012, 0.012, d_pin + 0.025);
    float mask_shadow = 1.0 - smoothstep(-0.03, 0.04, d_shadow);

    // Composite layers
    vec4 shadowColor = vec4(0.0, 0.0, 0.0, 0.25) * mask_shadow;
    vec4 bodyColor = mix(vec4(0.0, 0.0, 0.0, 0.85), vec4(_color.rgb, _color.a), mask_border);
    vec4 withHole = mix(bodyColor, vec4(1.0, 1.0, 1.0, 1.0), mask_hole);

    gl_FragColor = mix(shadowColor, withHole, mask_pin);
}`;

// src/timecontrol.js
var PERIOD_RE = /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
function parsePeriod(text) {
  const m = PERIOD_RE.exec(text || "");
  if (!m) return null;
  return {
    years: +(m[1] || 0),
    months: +(m[2] || 0),
    weeks: +(m[3] || 0),
    days: +(m[4] || 0),
    hours: +(m[5] || 0),
    minutes: +(m[6] || 0),
    seconds: +(m[7] || 0)
  };
}
function addPeriod(ms, p, sign = 1) {
  const d = new Date(ms);
  if (p.years) d.setUTCFullYear(d.getUTCFullYear() + sign * p.years);
  if (p.months) d.setUTCMonth(d.getUTCMonth() + sign * p.months);
  return d.getTime() + sign * (((p.weeks * 7 + p.days) * 24 * 3600 + p.hours * 3600 + p.minutes * 60 + p.seconds) * 1e3);
}
var MAX_TICKS = 5e3;
function generateTicks(startMs, endMs, p) {
  const ticks = [];
  let t = startMs;
  while (ticks.length < MAX_TICKS) {
    t = addPeriod(t, p);
    ticks.push(t);
    if (t >= endMs) return ticks;
  }
  console.warn(`[SwiftMap] time slider capped at ${MAX_TICKS} ticks; the period is too fine for the data's extent. Use a coarser period.`);
  return ticks;
}
function windowFor(tick, durationSpec, period) {
  if (durationSpec === null || durationSpec === void 0) {
    return { start: -Infinity, end: tick };
  }
  const p = durationSpec === "period" ? period : parsePeriod(durationSpec);
  if (!p) return { start: -Infinity, end: tick };
  return { start: addPeriod(tick, p, -1), end: tick };
}
function featureInWindow(startMs, endMs, win) {
  if (Number.isNaN(startMs)) return true;
  return endMs > win.start && startMs <= win.end;
}
function timesFor(layer, buffers) {
  const raw = buffers && buffers[`${layer.id}::times`];
  if (!raw) return null;
  return new Float64Array(
    raw.buffer || raw,
    raw.byteOffset || 0,
    (raw.byteLength || raw.length) / 8
  );
}
function layerInWindow(layer, buffers, timeState) {
  if (!layer.time || !timeState) return true;
  const times = timesFor(layer, buffers);
  if (!times || times.length < 2) return true;
  const win = windowFor(timeState.tick, layer.time.duration, timeState.period);
  return featureInWindow(times[0], times[1], win);
}
function collectTimeExtent(layers, buffers) {
  let min = Infinity, max = -Infinity;
  const visit = (list) => list.forEach((layer) => {
    if (layer.type === "group") return visit(layer.layers || []);
    if (!layer.time) return;
    const times = timesFor(layer, buffers);
    if (!times) return;
    for (let i = 0; i < times.length; i += 2) {
      if (Number.isNaN(times[i])) continue;
      if (times[i] < min) min = times[i];
      if (times[i + 1] > max) max = times[i + 1];
    }
  });
  visit(layers);
  return min === Infinity ? null : { min, max };
}
function hasTimeLayers(layers) {
  return layers.some((l) => l.type === "group" ? hasTimeLayers(l.layers || []) : Boolean(l.time));
}
function advance(index, length, loop) {
  if (index < length - 1) return { index: index + 1, playing: true };
  if (loop) return { index: 0, playing: true };
  return { index, playing: false };
}
var POSITIONS = {
  "top-left": { top: "10px", bottom: "", left: "10px", right: "", transform: "" },
  "top-center": { top: "10px", bottom: "", left: "50%", right: "", transform: "translateX(-50%)" },
  "top-right": { top: "10px", bottom: "", left: "", right: "10px", transform: "" },
  "left-center": { top: "50%", bottom: "", left: "10px", right: "", transform: "translateY(-50%)" },
  "right-center": { top: "50%", bottom: "", left: "", right: "10px", transform: "translateY(-50%)" },
  "bottom-left": { top: "", bottom: "10px", left: "10px", right: "", transform: "" },
  "bottom-center": { top: "", bottom: "10px", left: "50%", right: "", transform: "translateX(-50%)" },
  "bottom-right": { top: "", bottom: "10px", left: "", right: "10px", transform: "" }
};
function applyPosition(el, position) {
  const styles = POSITIONS[position] || POSITIONS["top-center"];
  for (const [prop, value] of Object.entries(styles)) {
    el.style[prop] = value;
  }
}
function formatUTC(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + "Z";
}
var ICONS = {
  back: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M3 2h2v12H3zM13 2 6 8l7 6z"/></svg>',
  play: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 2l9 6-9 6z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 2h3v12H4zM9 2h3v12H9z"/></svg>',
  fwd: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M11 2h2v12h-2zM3 2l7 6-7 6z"/></svg>',
  loop: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M8 2a6 6 0 0 1 5.65 4H16l-2.8 3.5L10.4 6h2.1A4.5 4.5 0 1 0 12.5 10l1.3.75A6 6 0 1 1 8 2z"/></svg>'
};
function renderTimeControl(container, state, handlers) {
  let el = container.querySelector(".swiftmap-time-control");
  if (!state.ticks || state.ticks.length === 0) {
    if (el) el.remove();
    return null;
  }
  if (!el) {
    el = document.createElement("div");
    el.className = "swiftmap-time-control";
    el.innerHTML = `
            <span class="swiftmap-time-buttons">
                <button class="swiftmap-time-back" title="Step back" aria-label="Step back">${ICONS.back}</button>
                <button class="swiftmap-time-play" aria-label="Play">${ICONS.play}</button>
                <button class="swiftmap-time-fwd" title="Step forward" aria-label="Step forward">${ICONS.fwd}</button>
                <button class="swiftmap-time-loop" aria-label="Loop">${ICONS.loop}</button>
            </span>
            <span class="swiftmap-time-label"></span>
            <input class="swiftmap-time-slider" type="range" min="0" step="1">
            <select class="swiftmap-time-speed" title="Playback speed">
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
            </select>`;
    container.appendChild(el);
    el.querySelector(".swiftmap-time-back").addEventListener("click", handlers.onStepBack);
    el.querySelector(".swiftmap-time-fwd").addEventListener("click", handlers.onStepForward);
    el.querySelector(".swiftmap-time-play").addEventListener("click", handlers.onPlayToggle);
    el.querySelector(".swiftmap-time-loop").addEventListener("click", handlers.onLoopToggle);
    el.querySelector(".swiftmap-time-speed").addEventListener(
      "change",
      (e) => handlers.onSpeed(parseFloat(e.target.value))
    );
    const slider = el.querySelector(".swiftmap-time-slider");
    slider.addEventListener("input", (e) => handlers.onSeek(parseInt(e.target.value, 10)));
  }
  el.querySelector(".swiftmap-time-slider").max = String(state.ticks.length - 1);
  el.querySelector(".swiftmap-time-slider").value = String(state.index);
  el.querySelector(".swiftmap-time-label").textContent = formatUTC(state.ticks[state.index]);
  const play = el.querySelector(".swiftmap-time-play");
  play.innerHTML = state.playing ? ICONS.pause : ICONS.play;
  play.setAttribute("aria-label", state.playing ? "Pause" : "Play");
  play.title = state.playing ? "Pause" : "Play";
  const loop = el.querySelector(".swiftmap-time-loop");
  loop.classList.toggle("active", Boolean(state.loop));
  loop.setAttribute("aria-pressed", String(Boolean(state.loop)));
  loop.title = state.loop ? "Loop: on" : "Loop: off";
  el.querySelector(".swiftmap-time-speed").value = String(state.speed || 1);
  applyPosition(el, state.position);
  return el;
}

// src/layers.js
function setupGlifyProjection(glInstance) {
  if (glInstance && glInstance.layer) {
    glInstance.layer._unclampedProject = function(latlng, zoom) {
      return this._map.options.crs.latLngToPoint(latlng, zoom);
    };
    glInstance.layer.redraw();
  }
}
function registerClickMatch(map, priority, action) {
  if (!map._clickMatches) {
    map._clickMatches = [];
  }
  map._clickMatches.push({ priority, action });
  if (!map._clickTimeout) {
    map._clickTimeout = setTimeout(() => {
      map._clickMatches.sort((a, b) => a.priority - b.priority);
      if (map._clickMatches.length > 0) {
        map._clickMatches[0].action();
      }
      map._clickMatches = [];
      map._clickTimeout = null;
    }, 0);
  }
}
function registerHoverMatch(map, priority, action) {
  if (!map._hoverMatches) {
    map._hoverMatches = [];
  }
  map._hoverMatches.push({ priority, action });
  if (!map._hoverTimeout) {
    map._hoverTimeout = setTimeout(() => {
      map._hoverMatches.sort((a, b) => a.priority - b.priority);
      if (map._hoverMatches.length > 0) {
        map._hoverMatches[0].action();
      }
      map._hoverMatches = [];
      map._hoverTimeout = null;
    }, 0);
  }
}
function styleFor(layer, index) {
  const fromData = Array.isArray(layer.feature_styles) ? layer.feature_styles[index] : null;
  const highlight = layer.highlight_style;
  const selected = layer.style_overrides && layer.style_overrides[index];
  if (!fromData && !highlight && !selected) return layer;
  return { ...layer, ...fromData || {}, ...highlight || {}, ...selected || {} };
}
function getIndexedProperties(properties, index) {
  if (!properties) return {};
  const props = {};
  Object.keys(properties).forEach((k) => {
    const val = properties[k];
    props[k] = Array.isArray(val) ? val[index] : val;
  });
  return props;
}
async function renderLayer(map, layer, coordBuffer, model) {
  if (layer.type === "group") {
    const group = L.layerGroup();
    const coordinateBuffers = model.get("coordinate_buffers") || {};
    for (const sub of layer.layers) {
      if (sub.type === "circle_markers" || sub.type === "markers" || sub.type === "polyline" || sub.type === "polygon" || sub.type === "circle") {
        continue;
      }
      const instance = await renderLayer(map, sub, coordinateBuffers[sub.id], model);
      if (instance) {
        group.addLayer(instance);
      }
    }
    group.addTo(map);
    group.layerType = layer.type;
    return group;
  }
  return null;
}
async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, model, timeState = null) {
  if (timeState && type !== "circle_markers" && type !== "markers") {
    layersList = layersList.filter((l) => layerInWindow(l, coordinateBuffers, timeState));
    if (layersList.length === 0) return null;
  }
  if (type === "polyline") {
    const features = [];
    for (const layer of layersList) {
      const geojsonCoords = layer.locations.map((c) => [c[1], c[0]]);
      const style = styleFor(layer, 0);
      const rgb = parseColor(style.color, "#3388ff");
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: geojsonCoords
        },
        properties: {
          layer,
          colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.opacity || 1 },
          weight: style.weight || 3
        }
      });
    }
    if (features.length === 0) return null;
    const geojson = {
      type: "FeatureCollection",
      features
    };
    const glLayer2 = L.Layer.extend({
      onAdd: function(m) {
        this._map = m;
        this._isHovering = false;
        this._mapMouseMoveHandler = (e) => {
          setTimeout(() => {
            if (!this._isHovering) {
              map.getContainer().style.cursor = "";
              if (this._sharedTooltip) {
                this._sharedTooltip.remove();
                this._sharedTooltip = null;
              }
            }
            this._isHovering = false;
          }, 0);
        };
        m.on("mousemove", this._mapMouseMoveHandler);
        this.glLines = L.glify.lines({
          map: m,
          data: geojson,
          pane: "polylinesPane",
          color: (index, feature) => {
            return feature.properties.colorRGB;
          },
          weight: (index, feature) => {
            return feature.properties.weight;
          },
          click: (e, feature) => {
            registerClickMatch(map, 2, () => {
              if (feature && feature.properties && feature.properties.layer) {
                const layer = feature.properties.layer;
                bindPopup(map, e.latlng, layer.properties, layer);
                if (model.comm) {
                  model.set("clicked_layer_id", layer.id);
                  model.set("selected_index", 0);
                  model.save_changes();
                }
              }
            });
          },
          hover: (e, feature) => {
            this._isHovering = true;
            if (feature && feature.properties && feature.properties.layer) {
              registerHoverMatch(map, 2, () => {
                const layer = feature.properties.layer;
                map.getContainer().style.cursor = "pointer";
                bindTooltip(map, e.latlng, layer.properties, layer, this);
              });
            }
          }
        });
        setupGlifyProjection(this.glLines);
      },
      onRemove: function(m) {
        if (this._mapMouseMoveHandler) {
          m.off("mousemove", this._mapMouseMoveHandler);
        }
        if (this.glLines) this.glLines.remove();
        if (this._sharedTooltip) {
          this._sharedTooltip.remove();
          this._sharedTooltip = null;
        }
        map.getContainer().style.cursor = "";
      }
    });
    const instance2 = new glLayer2();
    instance2.addTo(map);
    instance2.layerType = type;
    return instance2;
  }
  if (type === "polygon") {
    const features = [];
    for (const layer of layersList) {
      let geojsonCoords = [];
      if (layer.type === "polygon") {
        geojsonCoords = layer.locations.map((c) => [c[1], c[0]]);
        if (geojsonCoords.length > 0) {
          const first = geojsonCoords[0];
          const last = geojsonCoords[geojsonCoords.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            geojsonCoords.push([first[0], first[1]]);
          }
        }
      } else if (layer.type === "circle") {
        const lat = layer.location[0];
        const lon = layer.location[1];
        const radiusMeters = layer.radius || 10;
        const earthRadius = 6378137;
        for (let i = 0; i <= 32; i++) {
          const angle = i * 360 / 32;
          const angleRad = angle * Math.PI / 180;
          const dLat = radiusMeters * Math.cos(angleRad) / earthRadius;
          const dLon = radiusMeters * Math.sin(angleRad) / (earthRadius * Math.cos(lat * Math.PI / 180));
          const newLat = lat + dLat * 180 / Math.PI;
          const newLon = lon + dLon * 180 / Math.PI;
          geojsonCoords.push([newLon, newLat]);
        }
      }
      if (geojsonCoords.length === 0) continue;
      const style = styleFor(layer, 0);
      const rgb = parseColor(style.color, "#3388ff");
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [geojsonCoords]
        },
        properties: {
          layer,
          colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.fillOpacity || 0.2 }
        }
      });
    }
    if (features.length === 0) return null;
    const geojson = {
      type: "FeatureCollection",
      features
    };
    const glLayer2 = L.Layer.extend({
      onAdd: function(m) {
        this._map = m;
        this._isHovering = false;
        this._mapMouseMoveHandler = (e) => {
          setTimeout(() => {
            if (!this._isHovering) {
              map.getContainer().style.cursor = "";
              if (this._sharedTooltip) {
                this._sharedTooltip.remove();
                this._sharedTooltip = null;
              }
            }
            this._isHovering = false;
          }, 0);
        };
        m.on("mousemove", this._mapMouseMoveHandler);
        this.glShapes = L.glify.shapes({
          map: m,
          data: geojson,
          pane: "polygonsPane",
          color: (index, feature) => {
            return feature.properties.colorRGB;
          },
          click: (e, feature) => {
            registerClickMatch(map, 3, () => {
              if (feature && feature.properties && feature.properties.layer) {
                const layer = feature.properties.layer;
                bindPopup(map, e.latlng, layer.properties, layer);
                if (model.comm) {
                  model.set("clicked_layer_id", layer.id);
                  model.set("selected_index", 0);
                  model.save_changes();
                }
              }
            });
          },
          hover: (e, feature) => {
            this._isHovering = true;
            if (feature && feature.properties && feature.properties.layer) {
              registerHoverMatch(map, 3, () => {
                const layer = feature.properties.layer;
                map.getContainer().style.cursor = "pointer";
                bindTooltip(map, e.latlng, layer.properties, layer, this);
              });
            }
          }
        });
        setupGlifyProjection(this.glShapes);
      },
      onRemove: function(m) {
        if (this._mapMouseMoveHandler) {
          m.off("mousemove", this._mapMouseMoveHandler);
        }
        if (this.glShapes) this.glShapes.remove();
        if (this._sharedTooltip) {
          this._sharedTooltip.remove();
          this._sharedTooltip = null;
        }
        map.getContainer().style.cursor = "";
      }
    });
    const instance2 = new glLayer2();
    instance2.addTo(map);
    instance2.layerType = type;
    return instance2;
  }
  const pointsList = [];
  const indexMapping = [];
  const fallbackColor = type === "markers" ? "#e61a26" : "#3388ff";
  const defaultSize = type === "markers" ? 64 : 5;
  for (const layer of layersList) {
    const colorRGB = parseColor(layer.color, fallbackColor);
    const layerSize = layer.radius != null ? Number(layer.radius) : defaultSize;
    const coordBuffer = coordinateBuffers[layer.id];
    if (!coordBuffer) {
      if (layer.location && layerInWindow(layer, coordinateBuffers, timeState)) {
        pointsList.push([layer.location[0], layer.location[1]]);
        indexMapping.push({
          layer,
          originalIndex: 0,
          colorRGB,
          size: layerSize
        });
      }
      continue;
    }
    const coords = new Float64Array(
      coordBuffer.buffer,
      coordBuffer.byteOffset,
      coordBuffer.byteLength / 8
    );
    const count = coords.length / 2;
    const perFeature = Array.isArray(layer.feature_styles) ? layer.feature_styles : null;
    const highlight = layer.highlight_style || null;
    const overrides = layer.style_overrides || null;
    const win = timeState && layer.time ? windowFor(timeState.tick, layer.time.duration, timeState.period) : null;
    const times = win ? timesFor(layer, coordinateBuffers) : null;
    for (let i = 0; i < count; i++) {
      if (times && !featureInWindow(times[i * 2], times[i * 2 + 1], win)) continue;
      const fromData = perFeature ? perFeature[i] : null;
      const selected = overrides ? overrides[i] : null;
      const color = selected && selected.color || highlight && highlight.color || fromData && fromData.color;
      const radius = selected && selected.radius != null ? selected.radius : highlight && highlight.radius != null ? highlight.radius : fromData && fromData.radius != null ? fromData.radius : null;
      pointsList.push([coords[i * 2], coords[i * 2 + 1]]);
      indexMapping.push({
        layer,
        originalIndex: i,
        colorRGB: color ? parseColor(color, fallbackColor) : colorRGB,
        size: radius != null ? Number(radius) : layerSize
      });
    }
  }
  if (pointsList.length === 0) return null;
  const glLayer = L.Layer.extend({
    onAdd: function(m) {
      this._map = m;
      this._isHovering = false;
      const getInteractiveEl = () => {
        return map.getPane("pointsPane").querySelector("canvas") || map.getContainer();
      };
      this._mapMouseMoveHandler = (e) => {
        setTimeout(() => {
          if (!this._isHovering) {
            map.getContainer().style.cursor = "";
            const el = getInteractiveEl();
            if (el) el.style.cursor = "";
            if (this._sharedTooltip) {
              this._sharedTooltip.remove();
              this._sharedTooltip = null;
            }
          }
          this._isHovering = false;
        }, 0);
      };
      m.on("mousemove", this._mapMouseMoveHandler);
      const glifyOptions = {
        map: m,
        data: pointsList,
        pane: "pointsPane",
        // Resolved per point, like colour: several layers share one glify instance,
        // so a single constant here silently discarded every layer's own radius.
        size: (index) => {
          const info = indexMapping[index];
          return info && info.size != null ? info.size : defaultSize;
        },
        color: (index, point) => {
          const info = indexMapping[index];
          return info ? info.colorRGB : { r: 0.2, g: 0.5, b: 1 };
        },
        picking: true,
        sensitivity: type === "markers" ? 20 : 8,
        click: (e, point) => {
          if (!point) return;
          const clickPoint = map.latLngToContainerPoint(e.latlng);
          const markerPoint = map.latLngToContainerPoint(L.latLng(point[0], point[1]));
          const pixelDist = clickPoint.distanceTo(markerPoint);
          const maxDist = type === "markers" ? 25 : 12;
          if (pixelDist > maxDist) return;
          registerClickMatch(map, 1, () => {
            const idx = pointsList.indexOf(point);
            const info = indexMapping[idx];
            if (info) {
              const layer = info.layer;
              const originalIndex = info.originalIndex;
              const props = getIndexedProperties(layer.properties, originalIndex);
              bindPopup(map, point, props, layer);
              if (model.comm) {
                model.set("clicked_layer_id", layer.id);
                model.set("selected_index", originalIndex);
                model.save_changes();
              }
            }
          });
        },
        hover: (e, point) => {
          this._isHovering = true;
          if (point) {
            const hoverPoint = map.latLngToContainerPoint(e.latlng);
            const markerPoint = map.latLngToContainerPoint(L.latLng(point[0], point[1]));
            const pixelDist = hoverPoint.distanceTo(markerPoint);
            const maxDist = type === "markers" ? 25 : 12;
            if (pixelDist > maxDist) return;
            registerHoverMatch(map, 1, () => {
              map.getContainer().style.cursor = "pointer";
              const el = getInteractiveEl();
              if (el) el.style.cursor = "pointer";
              const idx = pointsList.indexOf(point);
              const info = indexMapping[idx];
              if (info) {
                const layer = info.layer;
                const originalIndex = info.originalIndex;
                const props = getIndexedProperties(layer.properties, originalIndex);
                bindTooltip(map, point, props, layer, this);
              }
            });
          }
        }
      };
      if (type === "markers") {
        glifyOptions.fragmentShaderSource = () => pinShader;
      }
      this.glPoints = L.glify.points(glifyOptions);
      setupGlifyProjection(this.glPoints);
    },
    onRemove: function(m) {
      if (this._mapMouseMoveHandler) {
        m.off("mousemove", this._mapMouseMoveHandler);
      }
      if (this.glPoints) this.glPoints.remove();
      if (this._sharedTooltip) {
        this._sharedTooltip.remove();
        this._sharedTooltip = null;
      }
      map.getContainer().style.cursor = "";
      const canvas = map.getPane("pointsPane").querySelector("canvas");
      if (canvas) canvas.style.cursor = "";
    }
  });
  const instance = new glLayer();
  instance.addTo(map);
  instance.layerType = type;
  return instance;
}

// src/map.js
function isLayerEffectiveVisible(layer, groupConfigs) {
  if (layer.visible === false) return false;
  let runningPath = "";
  for (const part of (layer.layer_group || "Layers").split("/")) {
    runningPath = runningPath ? `${runningPath}/${part}` : part;
    const config = groupConfigs[runningPath];
    if (config && config.visible === false) return false;
  }
  return true;
}
function collectWebglLayers(layers, groupConfigs) {
  const buckets = { circle_markers: [], markers: [], polyline: [], polygon: [] };
  function collect(layer, parentVisible, isSubLayer) {
    if (!parentVisible) return;
    if (layer.type === "group" && layer.layers) {
      layer.layers.forEach((sub) => collect(sub, parentVisible, true));
      return;
    }
    if (!isSubLayer && layer.visible === false) return;
    const bucket = layer.type === "circle" ? "polygon" : layer.type;
    if (buckets[bucket]) buckets[bucket].push(layer);
  }
  for (const layer of layers) {
    collect(layer, isLayerEffectiveVisible(layer, groupConfigs), false);
  }
  return buckets;
}
function updateLayerById(layers, id, update) {
  let hit = false;
  const next = layers.map((l) => {
    if (l.id === id) {
      hit = true;
      return update(l);
    }
    if (l.type === "group" && Array.isArray(l.layers)) {
      const subs = updateLayerById(l.layers, id, update);
      if (subs !== l.layers) {
        hit = true;
        return { ...l, layers: subs };
      }
    }
    return l;
  });
  return hit ? next : layers;
}
function applySwiftmapPatch(state, ops, buffers) {
  let layers = state.layers || [];
  let bufferMap = state.buffers || {};
  for (const op of ops) {
    if (op.op === "snapshot") {
      layers = op.layers || [];
      bufferMap = {};
      (op.buffer_ids || []).forEach((id, i) => {
        if (buffers && buffers[i]) bufferMap[id] = buffers[i];
      });
    } else if (op.op === "add" || op.op === "replace") {
      const incoming = op.layer;
      const id = incoming ? incoming.id : op.id;
      const idx = layers.findIndex((l) => l.id === id);
      if (idx === -1) {
        layers = [...layers, incoming];
      } else {
        layers = layers.map((l, i) => i === idx ? incoming : l);
      }
    } else if (op.op === "set") {
      layers = updateLayerById(layers, op.id, (l) => ({ ...l, ...op.fields || {} }));
    } else if (op.op === "style") {
      layers = updateLayerById(layers, op.id, (l) => ({
        ...l,
        style_overrides: op.overrides || {}
      }));
    } else if (op.op === "remove") {
      layers = layers.filter((l) => l.id !== op.id);
    } else if (op.op === "buffer") {
      const buf = buffers && buffers[op.buffer_index];
      if (buf) bufferMap = { ...bufferMap, [op.id]: buf };
    } else if (op.op === "buffer_remove") {
      bufferMap = { ...bufferMap };
      delete bufferMap[op.id];
    }
  }
  return { layers, buffers: bufferMap };
}
var map_default = {
  async render({ model, el }) {
    const originalError = console.error;
    const originalWarn = console.warn;
    const MAX_CONSOLE_LOGS = 200;
    const appendLog = (entry) => {
      const logs = model.get("js_console_logs") || [];
      const next = [...logs, entry];
      return next.length > MAX_CONSOLE_LOGS ? next.slice(-MAX_CONSOLE_LOGS) : next;
    };
    function safeSetAndSave(key, value) {
      if (model.comm && document.body.contains(el)) {
        try {
          model.set(key, value);
          model.save_changes();
        } catch (e) {
          originalWarn.call(console, "[SwiftMap] Suppressed sync write error:", e);
        }
      }
    }
    function safeSaveChanges() {
      if (model.comm && document.body.contains(el)) {
        try {
          model.save_changes();
        } catch (e) {
          originalWarn.call(console, "[SwiftMap] Suppressed sync save error:", e);
        }
      }
    }
    console.error = function(...args) {
      originalError.apply(console, args);
      safeSetAndSave(
        "js_console_logs",
        appendLog("CONSOLE.ERROR: " + args.map((a) => String(a)).join(" "))
      );
    };
    let loggedReprojected = false;
    console.warn = function(...args) {
      const msg = args.map((a) => String(a)).join(" ");
      if (msg.includes("layer designed for SphericalMercator") || msg.includes("alternate detected")) {
        if (!loggedReprojected) {
          loggedReprojected = true;
          const crs = model.get("crs") || "EPSG:3857";
          const cleanMsg = `[SwiftMap] Layer was reprojected to "${crs}"`;
          originalWarn.call(console, cleanMsg);
          safeSetAndSave("js_console_logs", appendLog(cleanMsg));
        }
        return;
      }
      originalWarn.apply(console, args);
    };
    window.onerror = function(message, source, lineno, colno, error) {
      safeSetAndSave(
        "js_console_logs",
        appendLog(`WINDOW.ONERROR: ${message} at ${source}:${lineno}:${colno}`)
      );
    };
    loadCSS("leaflet-css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    await loadJS("leaflet-js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    await loadJS("leaflet-glify", "https://unpkg.com/leaflet.glify@3.3.0/dist/glify-browser.js");
    const container = document.createElement("div");
    container.className = "swiftmap-container";
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.position = "relative";
    el.appendChild(container);
    const crsName = model.get("crs");
    let mapCrs = L.CRS.EPSG3857;
    if (crsName === "EPSG:4326") {
      mapCrs = L.CRS.EPSG4326;
    }
    const map = L.map(container, {
      crs: mapCrs,
      center: model.get("center"),
      zoom: model.get("zoom"),
      scrollWheelZoom: true,
      preferCanvas: true
    });
    map.createPane("polygonsPane");
    map.getPane("polygonsPane").style.zIndex = "410";
    map.createPane("polylinesPane");
    map.getPane("polylinesPane").style.zIndex = "420";
    map.createPane("pointsPane");
    map.getPane("pointsPane").style.zIndex = "430";
    let layerState = model.get("layers") || [];
    let bufferState = { ...model.get("coordinate_buffers") || {} };
    function applyPatchOps(ops, buffers) {
      const next = applySwiftmapPatch({ layers: layerState, buffers: bufferState }, ops, buffers);
      layerState = next.layers;
      bufferState = next.buffers;
    }
    const activeTileLayers = {};
    const activeOverlayLayers = {};
    const glStates = {
      circle_markers: { layer: null, ids: "", meta: "" },
      markers: { layer: null, ids: "", meta: "" },
      polyline: { layer: null, ids: "", meta: "" },
      polygon: { layer: null, ids: "", meta: "" }
    };
    let timeState = null;
    const timeUI = {
      ticks: [],
      key: "",
      index: 0,
      playing: false,
      loop: false,
      speed: 1,
      timer: null,
      lastWrite: 0,
      started: false
    };
    function stopPlayback() {
      if (timeUI.timer) clearInterval(timeUI.timer);
      timeUI.timer = null;
      timeUI.playing = false;
    }
    function writeTimeCurrent(force) {
      const now = Date.now();
      if (!force && now - timeUI.lastWrite < 1e3) return;
      timeUI.lastWrite = now;
      if (model.comm) {
        model.set("time_current", timeUI.ticks[timeUI.index]);
        model.save_changes();
      }
    }
    function seekTo(index, { write = true } = {}) {
      timeUI.index = Math.max(0, Math.min(index, timeUI.ticks.length - 1));
      timeState = { tick: timeUI.ticks[timeUI.index], period: timeState.period };
      if (write) writeTimeCurrent(!timeUI.playing);
      renderTimeControl(el, timeUI, timeHandlers);
      queueSync();
    }
    function startPlayback() {
      stopPlayback();
      timeUI.playing = true;
      timeUI.timer = setInterval(() => {
        const next = advance(timeUI.index, timeUI.ticks.length, timeUI.loop);
        if (!next.playing) {
          stopPlayback();
          renderTimeControl(el, timeUI, timeHandlers);
          writeTimeCurrent(true);
          return;
        }
        seekTo(next.index);
      }, 1e3 / timeUI.speed);
    }
    const timeHandlers = {
      onSeek: (index) => seekTo(index),
      onStepBack: () => seekTo(timeUI.index - 1),
      onStepForward: () => seekTo(timeUI.index + 1),
      onPlayToggle: () => {
        if (timeUI.playing) {
          stopPlayback();
          writeTimeCurrent(true);
        } else {
          if (timeUI.index >= timeUI.ticks.length - 1) seekTo(0);
          startPlayback();
        }
        renderTimeControl(el, timeUI, timeHandlers);
      },
      onLoopToggle: () => {
        timeUI.loop = !timeUI.loop;
        renderTimeControl(el, timeUI, timeHandlers);
      },
      onSpeed: (speed) => {
        timeUI.speed = speed;
        if (timeUI.playing) startPlayback();
      }
    };
    function updateTimeDimension() {
      if (!hasTimeLayers(layerState)) {
        if (timeState) {
          stopPlayback();
          renderTimeControl(el, { ticks: [] }, timeHandlers);
          timeState = null;
          timeUI.key = "";
          timeUI.started = false;
        }
        return;
      }
      const cfg = model.get("time_config") || {};
      const period = parsePeriod(cfg.period || "P1D") || parsePeriod("P1D");
      const extent = collectTimeExtent(layerState, bufferState);
      if (!extent) return;
      const key = `${extent.min}|${extent.max}|${cfg.period || "P1D"}`;
      if (key !== timeUI.key) {
        timeUI.key = key;
        timeUI.ticks = generateTicks(extent.min, extent.max, period);
        timeUI.index = Math.min(timeUI.index, timeUI.ticks.length - 1);
      }
      timeState = { tick: timeUI.ticks[timeUI.index], period };
      timeUI.position = cfg.position || "top-center";
      if (!timeUI.started) {
        timeUI.started = true;
        timeUI.speed = cfg.speed || 1;
        timeUI.loop = Boolean(cfg.loop);
        if (cfg.auto_play) startPlayback();
      }
      renderTimeControl(el, timeUI, timeHandlers);
    }
    const sidebar = document.createElement("div");
    sidebar.className = "swiftmap-sidebar";
    sidebar.style.position = "absolute";
    sidebar.style.top = "10px";
    sidebar.style.right = "10px";
    sidebar.style.zIndex = "1000";
    sidebar.style.background = "white";
    sidebar.style.padding = "10px";
    sidebar.style.borderRadius = "5px";
    sidebar.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
    sidebar.style.maxHeight = "80%";
    sidebar.style.overflowY = "auto";
    sidebar.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    sidebar.style.fontSize = "12px";
    sidebar.style.color = "#333";
    container.appendChild(sidebar);
    const logoDiv = document.createElement("div");
    logoDiv.style.position = "absolute";
    logoDiv.style.bottom = "10px";
    logoDiv.style.right = "10px";
    logoDiv.style.zIndex = "1000";
    logoDiv.style.background = "white";
    logoDiv.style.padding = "5px";
    logoDiv.style.borderRadius = "4px";
    logoDiv.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
    logoDiv.style.display = "none";
    logoDiv.innerHTML = `
            <div style="display: flex; align-items: center;">
                <img src="https://repo/assets/image.png" alt="Company" style="height: 35px; margin-right: 5px;">
                <img src="https://repo/assets/image2.png" alt="Parent Company" style="height: 35px;">
            </div>
        `;
    container.appendChild(logoDiv);
    function getTileLayer(layer) {
      return L.tileLayer(layer.url, {
        attribution: layer.attribution || "",
        maxZoom: layer.max_zoom || 22,
        maxNativeZoom: layer.max_native_zoom || 19
      });
    }
    async function syncMapState() {
      console.time("[Performance] syncMapState Total");
      updateTimeDimension();
      const layers = layerState;
      const groupConfigs = model.get("group_configs") || {};
      const coordinateBuffers = bufferState;
      const radioChanged = normalizeRadioLayers(layers, groupConfigs);
      if (radioChanged && model.comm && document.body.contains(el)) {
        model.set("layers", [...layers]);
        model.set("group_configs", groupConfigs);
        model.save_changes();
      }
      logoDiv.style.display = model.get("show_logo") ? "block" : "none";
      const {
        circle_markers: webglCircleMarkerLayers,
        markers: webglMarkerLayers,
        polyline: webglPolylineLayers,
        polygon: webglPolygonLayers
      } = collectWebglLayers(layers, groupConfigs);
      const webglLayerIds = /* @__PURE__ */ new Set([
        ...webglCircleMarkerLayers.map((l) => l.id),
        ...webglMarkerLayers.map((l) => l.id),
        ...webglPolylineLayers.map((l) => l.id),
        ...webglPolygonLayers.map((l) => l.id)
      ]);
      Object.keys(activeOverlayLayers).forEach((id) => {
        if (!layers.find((l) => l.id === id) || webglLayerIds.has(id)) {
          activeOverlayLayers[id].remove();
          delete activeOverlayLayers[id];
        }
      });
      for (const layer of layers) {
        const effectiveVisible = isLayerEffectiveVisible(layer, groupConfigs);
        if (layer.type === "basemap") {
          if (effectiveVisible) {
            if (!activeTileLayers[layer.name]) {
              const tile = getTileLayer(layer);
              tile.addTo(map);
              activeTileLayers[layer.name] = tile;
            }
          } else {
            if (activeTileLayers[layer.name]) {
              activeTileLayers[layer.name].remove();
              delete activeTileLayers[layer.name];
            }
          }
          continue;
        }
        if (webglLayerIds.has(layer.id)) {
          continue;
        }
        if (!effectiveVisible || !layerInWindow(layer, bufferState, timeState)) {
          if (activeOverlayLayers[layer.id]) {
            activeOverlayLayers[layer.id].remove();
            delete activeOverlayLayers[layer.id];
          }
          continue;
        }
        if (activeOverlayLayers[layer.id]) {
          const existing = activeOverlayLayers[layer.id];
          if (existing.layerType !== layer.type) {
            existing.remove();
            delete activeOverlayLayers[layer.id];
          } else {
            continue;
          }
        }
        const instance = await renderLayer(map, layer, coordinateBuffers[layer.id], model);
        if (instance) {
          activeOverlayLayers[layer.id] = instance;
        }
      }
      async function syncGlLayer(type, visibleLayers) {
        const idsString = visibleLayers.map((l) => l.id).sort().join(",");
        const metaString = JSON.stringify(visibleLayers.map((l) => ({
          id: l.id,
          color: l.color,
          radius: l.radius,
          weight: l.weight,
          opacity: l.opacity,
          fillOpacity: l.fillOpacity,
          highlight: l.highlight_style,
          overrides: l.style_overrides,
          featureStyles: l.feature_styles,
          time: l.time,
          tick: l.time && timeState ? timeState.tick : 0,
          bufLen: coordinateBuffers[l.id]?.byteLength || 0,
          locLen: l.locations?.length || 0
        })));
        const state = glStates[type];
        const stateChanged = state.ids !== idsString || state.meta !== metaString;
        if (stateChanged) {
          if (state.layer) {
            state.layer.remove();
          }
          if (visibleLayers.length > 0) {
            state.layer = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, model, timeState);
            if (state.layer) {
              state.layer.addTo(map);
            }
          } else {
            state.layer = null;
          }
          state.ids = idsString;
          state.meta = metaString;
        }
      }
      await syncGlLayer("circle_markers", webglCircleMarkerLayers);
      await syncGlLayer("markers", webglMarkerLayers);
      await syncGlLayer("polyline", webglPolylineLayers);
      await syncGlLayer("polygon", webglPolygonLayers);
      renderSidebarControls(sidebar, layers, model, map, () => {
        performSync();
      });
      console.timeEnd("[Performance] syncMapState Total");
    }
    let isUpdatingCenterFromMap = false;
    let isUpdatingZoomFromMap = false;
    map.on("moveend", () => {
      try {
        const center = map.getCenter();
        const currentZoom = map.getZoom();
        const modelCenter = model.get("center");
        const modelZoom = model.get("zoom");
        const zoomChanged = modelZoom !== currentZoom;
        const centerChanged = !modelCenter || !Array.isArray(modelCenter) || modelCenter.length < 2 || Math.abs(modelCenter[0] - center.lat) > 1e-4 || Math.abs(modelCenter[1] - center.lng) > 1e-4;
        if (centerChanged) {
          isUpdatingCenterFromMap = true;
          model.set("center", [center.lat, center.lng]);
        }
        if (zoomChanged) {
          isUpdatingZoomFromMap = true;
          model.set("zoom", currentZoom);
        }
        if (centerChanged || zoomChanged) {
          safeSaveChanges();
        }
      } catch (err) {
        console.error("Error in moveend handler:", err);
      }
    });
    function updateMapView() {
      const center = model.get("center");
      const zoom = model.get("zoom");
      if (center && Array.isArray(center) && center.length >= 2) {
        const mapCenter = map.getCenter();
        const mapZoom = map.getZoom();
        const centerChanged = Math.abs(mapCenter.lat - center[0]) > 1e-4 || Math.abs(mapCenter.lng - center[1]) > 1e-4;
        const zoomChanged = mapZoom !== zoom;
        if (centerChanged || zoomChanged) {
          map.setView(center, typeof zoom === "number" ? zoom : mapZoom);
        }
      } else {
        const zoom2 = model.get("zoom");
        if (typeof zoom2 === "number" && map.getZoom() !== zoom2) {
          map.setZoom(zoom2);
        }
      }
    }
    model.on("change:center", () => {
      if (isUpdatingCenterFromMap) {
        isUpdatingCenterFromMap = false;
        return;
      }
      updateMapView();
    });
    model.on("change:zoom", () => {
      if (isUpdatingZoomFromMap) {
        isUpdatingZoomFromMap = false;
        return;
      }
      updateMapView();
    });
    model.on("change:fit_bounds_request", () => {
      const req = model.get("fit_bounds_request") || {};
      const bounds = req.bounds;
      if (!bounds || bounds.length === 0) return;
      const options = {};
      if (req.padding != null) options.padding = [req.padding, req.padding];
      if (req.max_zoom != null) options.maxZoom = req.max_zoom;
      map.fitBounds(bounds, options);
      if (req.zoom_offset) {
        map.setZoom(map.getZoom() + req.zoom_offset);
      }
    });
    let syncTimeout = null;
    let isSyncing = false;
    let needsSync = false;
    async function performSync() {
      if (isSyncing) {
        needsSync = true;
        return;
      }
      isSyncing = true;
      try {
        await syncMapState();
      } catch (err) {
        console.error("Error in syncMapState:", err);
      } finally {
        isSyncing = false;
        if (needsSync) {
          needsSync = false;
          performSync();
        }
      }
    }
    function queueSync() {
      if (!model.get("auto_sync")) {
        return;
      }
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }
      syncTimeout = setTimeout(() => {
        syncTimeout = null;
        performSync();
      }, 50);
    }
    model.on("change:sync_trigger", () => {
      performSync();
    });
    model.on("msg:custom", (msg, buffers) => {
      if (!msg || msg.kind !== "swiftmap_patch") return;
      applyPatchOps(msg.ops || [], buffers);
      queueSync();
    });
    model.on("change:layers", () => {
      layerState = model.get("layers") || [];
      queueSync();
    });
    model.on("change:coordinate_buffers", () => {
      bufferState = { ...model.get("coordinate_buffers") || {} };
      queueSync();
    });
    model.on("change:group_configs", queueSync);
    model.on("change:time_config", () => {
      timeUI.started = false;
      queueSync();
    });
    model.on("change:time_current", () => {
      const wanted = model.get("time_current");
      if (!timeState || !timeUI.ticks.length) return;
      if (Math.abs(wanted - timeUI.ticks[timeUI.index]) < 1) return;
      let idx = timeUI.ticks.findIndex((t) => t >= wanted);
      if (idx === -1) idx = timeUI.ticks.length - 1;
      seekTo(idx, { write: false });
    });
    model.on("change:show_logo", queueSync);
    if (model.comm) {
      model.send({ kind: "swiftmap_ready" });
    }
    if (model.get("auto_sync") || model.get("sync_trigger") > 0) {
      performSync();
    }
  }
};
export {
  applySwiftmapPatch,
  collectWebglLayers,
  map_default as default,
  isLayerEffectiveVisible
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9tYXAuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBmdW5jdGlvbiBsb2FkQ1NTKGlkLCB1cmwpIHtcbiAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICBjb25zdCBsaW5rID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImxpbmtcIik7XG4gICAgICAgIGxpbmsuaWQgPSBpZDtcbiAgICAgICAgbGluay5yZWwgPSBcInN0eWxlc2hlZXRcIjtcbiAgICAgICAgbGluay5ocmVmID0gdXJsO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKGxpbmspO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlTG9hZGVycyA9IHt9O1xuXG5leHBvcnQgZnVuY3Rpb24gbG9hZEpTKGlkLCB1cmwpIHtcbiAgICBpZiAoYWN0aXZlTG9hZGVyc1tpZF0pIHtcbiAgICAgICAgcmV0dXJuIGFjdGl2ZUxvYWRlcnNbaWRdO1xuICAgIH1cbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNjcmlwdFwiKTtcbiAgICAgICAgc2NyaXB0LmlkID0gaWQ7XG4gICAgICAgIHNjcmlwdC5zcmMgPSB1cmw7XG4gICAgICAgIHNjcmlwdC5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgICAgIHNjcmlwdC5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgc2NyaXB0OiAke3VybH1gKSk7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc2NyaXB0KTtcbiAgICB9KTtcbiAgICBhY3RpdmVMb2FkZXJzW2lkXSA9IHByb21pc2U7XG4gICAgcmV0dXJuIHByb21pc2U7XG59XG5cbmZ1bmN0aW9uIGhleFRvUmdiKGhleCkge1xuICAgIGlmICghaGV4KSByZXR1cm4gbnVsbDtcbiAgICBoZXggPSBoZXgucmVwbGFjZSgvXiMvLCAnJyk7XG4gICAgaWYgKGhleC5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgaGV4ID0gaGV4LnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyICsgY2hhcikuam9pbignJyk7XG4gICAgfVxuICAgIGlmIChoZXgubGVuZ3RoICE9PSA2KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBudW0gPSBwYXJzZUludChoZXgsIDE2KTtcbiAgICByZXR1cm4ge1xuICAgICAgICByOiAoKG51bSA+PiAxNikgJiAyNTUpIC8gMjU1LFxuICAgICAgICBnOiAoKG51bSA+PiA4KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGI6IChudW0gJiAyNTUpIC8gMjU1XG4gICAgfTtcbn1cblxubGV0IGNvbG9yUHJvYmUgPSBudWxsO1xuXG4vLyBCcm93c2VycyBzaGlwIGEgY29tcGxldGUgQ1NTIGNvbG9yIHBhcnNlciAtLSBldmVyeSBuYW1lZCBjb2xvciwgcmdiKCksIGhzbCgpLCBod2IoKS5cbi8vIEJvcnJvdyBpdCBpbnN0ZWFkIG9mIG1haW50YWluaW5nIGEgbG9va3VwIHRhYmxlLiBSZXR1cm5zIG51bGwgb3V0c2lkZSBhIERPTSAoTm9kZSB0ZXN0cyksXG4vLyB3aGVyZSB0aGUgaGV4IGZhbGxiYWNrIGluIHBhcnNlQ29sb3Igc3RpbGwgYXBwbGllcy5cbmZ1bmN0aW9uIGNzc0NvbG9yVG9SZ2IodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIGRvY3VtZW50ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIWNvbG9yUHJvYmUpIGNvbG9yUHJvYmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpLmdldENvbnRleHQoXCIyZFwiKTtcblxuICAgIC8vIEFzc2lnbmluZyBhbiBpbnZhbGlkIGNvbG9yIGxlYXZlcyBmaWxsU3R5bGUgdW50b3VjaGVkLCBzbyBwcm9iZSBhZ2FpbnN0IHR3byBkaWZmZXJlbnRcbiAgICAvLyBzZW50aW5lbHM6IG9ubHkgYSB2YWx1ZSB0aGUgYnJvd3NlciBhY3R1YWxseSBwYXJzZWQgcHJvZHVjZXMgdGhlIHNhbWUgcmVzdWx0IHR3aWNlLlxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjMDAwMDAwXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBjb25zdCBmaXJzdCA9IGNvbG9yUHJvYmUuZmlsbFN0eWxlO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjZmZmZmZmXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBpZiAoZmlyc3QgIT09IGNvbG9yUHJvYmUuZmlsbFN0eWxlKSByZXR1cm4gbnVsbDtcblxuICAgIGlmIChmaXJzdC5zdGFydHNXaXRoKFwiI1wiKSkgcmV0dXJuIGhleFRvUmdiKGZpcnN0KTtcbiAgICBjb25zdCBtYXRjaCA9IGZpcnN0Lm1hdGNoKC9yZ2JhP1xcKChbXildKylcXCkvKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXJ0cyA9IG1hdGNoWzFdLnNwbGl0KFwiLFwiKS5tYXAocCA9PiBwYXJzZUZsb2F0KHAudHJpbSgpKSk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMgfHwgcGFydHMuc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyByOiBwYXJ0c1swXSAvIDI1NSwgZzogcGFydHNbMV0gLyAyNTUsIGI6IHBhcnRzWzJdIC8gMjU1IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbG9yKGNvbG9yU3RyLCBmYWxsYmFja0hleCA9IFwiIzMzODhmZlwiKSB7XG4gICAgaWYgKCFjb2xvclN0cikgY29sb3JTdHIgPSBmYWxsYmFja0hleDtcbiAgICByZXR1cm4gY3NzQ29sb3JUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgaGV4VG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGNzc0NvbG9yVG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IGhleFRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcbn1cblxuY29uc3QgVVJMX0FUVFJfQkVGT1JFID0gLyg/OmhyZWZ8c3JjKVxccyo9XFxzKlsnXCJdPyQvaTtcbmNvbnN0IFNBRkVfVVJMID0gL14oPzpodHRwcz86XFwvXFwvfG1haWx0bzp8dGVsOnxkYXRhOmltYWdlXFwvfFsuLyM/XXxbXFx3Li1dKyg/OlsvPyNdfCQpKS9pO1xuXG4vLyBQcm9wZXJ0eSB2YWx1ZXMgY29tZSBmcm9tIHVzZXIgZGF0YSBhbmQgZW5kIHVwIGluIGlubmVySFRNTCwgc28gdGhleSBhcmUgZXNjYXBlZC5cbi8vIE1hcmt1cCB0aGUgYXBwIGF1dGhvciB3cm90ZSAodGVtcGxhdGVzLCBzdHlsZSBzdHJpbmdzKSBpcyBsZWZ0IGludGFjdC5cbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVIdG1sKHZhbHVlKSB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSlcbiAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxuICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXG4gICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxuICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMzk7XCIpO1xufVxuXG4vLyBFc2NhcGluZyBzdG9wcyBhdHRyaWJ1dGUgYnJlYWtvdXQgYnV0IG5vdCBcImphdmFzY3JpcHQ6XCIgaW4gYW4gaHJlZiwgc28gdmFsdWVzIGxhbmRpbmdcbi8vIGluIGEgVVJMIGF0dHJpYnV0ZSBnZXQgYSBzY2hlbWUgY2hlY2suIENvbnRyb2wgY2hhcmFjdGVycyBhcmUgc3RyaXBwZWQgZmlyc3QgYmVjYXVzZVxuLy8gXCJqYXZhXFx0c2NyaXB0OlwiIHN1cnZpdmVzIGEgbmFpdmUgY29tcGFyaXNvbi5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlKSB7XG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcbiAgICByZXR1cm4gU0FGRV9VUkwudGVzdChjb2xsYXBzZWQpID8gU3RyaW5nKHZhbHVlKSA6IFwiXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIGNvbnN0IHRhcmdldEZpZWxkcyA9IChBcnJheS5pc0FycmF5KGZpZWxkcykgJiYgZmllbGRzLmxlbmd0aCkgPyBmaWVsZHMgOiBPYmplY3Qua2V5cyhwcm9wcyk7XG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcbiAgICBjb25zdCBsaW5lcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGFyZ2V0RmllbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XG4gICAgICAgIGlmIChwcm9wc1tmXSA9PT0gdW5kZWZpbmVkIHx8IHByb3BzW2ZdID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgbGluZXMucHVzaChgPGI+JHtlc2NhcGVIdG1sKGxhYmVsc1tpXSl9PC9iPjogJHtlc2NhcGVIdG1sKHByb3BzW2ZdKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oXCI8YnI+XCIpO1xufVxuXG4vLyBcIntjb2x1bW59XCIgaW5zZXJ0cyBvbmUgZXNjYXBlZCB2YWx1ZTsgXCJ7Kn1cIiBpbnNlcnRzIHRoZSBkZWZhdWx0IGZpZWxkIGxpc3QuXG5mdW5jdGlvbiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiKlwiKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BzW2tleV07XG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHJldHVybiBcIlwiO1xuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XG4gICAgICAgIHJldHVybiBlc2NhcGVIdG1sKFVSTF9BVFRSX0JFRk9SRS50ZXN0KHByZWNlZGluZykgPyBzYWZlVXJsKHZhbCkgOiB2YWwpO1xuICAgIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIGtpbmQpIHtcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGxheWVyW2tpbmQgKyBcIl90ZW1wbGF0ZVwiXTtcbiAgICBjb25zdCBmaWVsZHMgPSBsYXllcltraW5kICsgXCJfZmllbGRzXCJdO1xuICAgIGNvbnN0IG5hbWVzID0gbGF5ZXJba2luZCArIFwiX25hbWVzXCJdO1xuICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgPT09IFwic3RyaW5nXCIgJiYgdGVtcGxhdGUpIHtcbiAgICAgICAgcmV0dXJuIHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBwcm9wcywgZmllbGRzLCBuYW1lcyk7XG4gICAgfVxuICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XG59XG5cbmZ1bmN0aW9uIHdyYXBTdHlsZWQoaHRtbCwgc3R5bGUpIHtcbiAgICBpZiAoIXN0eWxlKSByZXR1cm4gaHRtbDtcbiAgICByZXR1cm4gYDxkaXYgc3R5bGU9XCIke2VzY2FwZUh0bWwoc3R5bGUpfVwiPiR7aHRtbH08L2Rpdj5gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFBvcHVwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwicG9wdXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3BvcHVwIHx8IGxheWVyLnBvcHVwX2ZpZWxkcyB8fCBsYXllci5wb3B1cF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICBpZiAobGF5ZXIucG9wdXBfbWF4X3dpZHRoKSBvcHRpb25zLm1heFdpZHRoID0gbGF5ZXIucG9wdXBfbWF4X3dpZHRoO1xuICAgICAgICBMLnBvcHVwKG9wdGlvbnMpXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIucG9wdXBfc3R5bGUpKVxuICAgICAgICAgICAgLm9wZW5PbihtYXApO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRUb29sdGlwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIsIGxheWVySW5zdGFuY2UpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwidG9vbHRpcFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfdG9vbHRpcCB8fCBsYXllci50b29sdGlwX2ZpZWxkcyB8fCBsYXllci50b29sdGlwX3RlbXBsYXRlKSkge1xuICAgICAgICBpZiAoIWxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXAgPSBMLnRvb2x0aXAoeyBkaXJlY3Rpb246ICd0b3AnLCBvZmZzZXQ6IFswLCAtNV0gfSk7XG4gICAgICAgIH1cbiAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcFxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnRvb2x0aXBfc3R5bGUpKVxuICAgICAgICAgICAgLmFkZFRvKG1hcCk7XG4gICAgfVxufVxuIiwgImNvbnN0IGNvbGxhcHNlZFBhdGhzID0ge307ICAvLyBwYXRoIC0+IGNvbGxhcHNlZD9cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllckJvdW5kcyhsLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKCFsKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAvLyBTdXBwb3J0IGZvbGRlciB0cmVlIG5vZGVzIChncm91cHMgaW4gc2lkZWJhciB0cmVlKVxyXG4gICAgaWYgKGwuaXNHcm91cCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkcmVuIGdyb3Vwc1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGwuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGwuY2hpbGRyZW5ba2V5XSwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZCBsYXllcnNcclxuICAgICAgICBsLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhseXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGwuYm91bmRzICYmIGwuYm91bmRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICByZXR1cm4gbC5ib3VuZHM7XHJcbiAgICB9XHJcbiAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgbC5sYXllcnMpIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsLmxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMoc3ViLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChsLmxvY2F0aW9ucyAmJiBsLmxvY2F0aW9ucy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgY29uc3QgY29vcmRzID0gbC5sb2NhdGlvbnMuZmxhdChJbmZpbml0eSk7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2ldO1xyXG4gICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSArIDFdO1xyXG4gICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF07XHJcbiAgICAgICAgaWYgKGJ1Zikge1xyXG4gICAgICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KGJ1Zi5idWZmZXIsIGJ1Zi5ieXRlT2Zmc2V0LCBidWYuYnl0ZUxlbmd0aCAvIDgpO1xyXG4gICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aCAvIDI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2kgKiAyXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgbW9kZWxOZWVkc1VwZGF0ZSA9IGZhbHNlO1xyXG4gICAgZnVuY3Rpb24gZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZiA9IGdyb3VwQ29uZmlnc1tub2RlLnBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNSYWRpb0dyb3VwID0gY29uZi5tdWx0aV9zZWxlY3QgPT09IGZhbHNlO1xyXG4gICAgICAgIGlmIChpc1JhZGlvR3JvdXApIHtcclxuICAgICAgICAgICAgbGV0IGZvdW5kQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkR3JvdXAgPSBub2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBseXIudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZS5jaGlsZHJlbltrZXldKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXModHJlZSk7XHJcbiAgICByZXR1cm4gbW9kZWxOZWVkc1VwZGF0ZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYWdhaW5zdCB0aGUgbGlzdCB0aGlzIHNpZGViYXIgcmVuZGVyZWQgZnJvbSwgbmV2ZXIgbW9kZWwuZ2V0KFwibGF5ZXJzXCIpLlxyXG4gICAgICAgICAgICAgICAgLy8gTGF5ZXJzIGFkZGVkIGFmdGVyIHRoZSB3aWRnZXQgaXMgZGlzcGxheWVkIGFycml2ZSBhcyBwYXRjaGVzIHRoYXQgdXBkYXRlIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gZnJvbnRlbmQncyBsb2NhbCBzdGF0ZSB3aXRob3V0IHRvdWNoaW5nIHRoZSB0cmFpdCwgc28gdGhlIG1vZGVsJ3MgY29weSBpc1xyXG4gICAgICAgICAgICAgICAgLy8gZnJvemVuIGF0IHdoYXRldmVyIHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgY2FycmllZC4gQnVpbGRpbmcgdGhlIHVwZGF0ZSBmcm9tXHJcbiAgICAgICAgICAgICAgICAvLyBpdCBkcm9wcyBldmVyeSBsYXRlciBsYXllcjogdGhlIHRvZ2dsZSBtYXRjaGVzIG5vIGlkLCB3cml0ZXMgdGhlIHN0YWxlIGxpc3RcclxuICAgICAgICAgICAgICAgIC8vIGJhY2ssIGFuZCB0aGUgY2hhbmdlIGhhbmRsZXIgdGhlbiByZXNldHMgbG9jYWwgc3RhdGUgdG8gaXQgLS0gc28gdGhlIGJveFxyXG4gICAgICAgICAgICAgICAgLy8gcmUtY2hlY2tzIGl0c2VsZiBhbmQgdGhlIGxheWVyIG5ldmVyIGhpZGVzLlxyXG4gICAgICAgICAgICAgICAgbGV0IHVwZGF0ZWRMYXllcnMgPSBbLi4ubGF5ZXJzXTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSYWRpbyBidXR0b24gbG9naWM6IHNldCBhbGwgc2libGluZ3MgdG8gdmlzaWJsZT1mYWxzZSwgYW5kIHRoaXMgdG8gdmlzaWJsZT10cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMocGFyZW50Tm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJHcm91cCA9IHBhcmVudE5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gc2liR3JvdXAucGF0aCA9PT0gcGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmUgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3NpYkdyb3VwLnBhdGhdID0gIWFjdGl2ZTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBwYXJlbnROb2RlLmxheWVycy5mb3JFYWNoKHNpYkx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkx5ci5pZCA9PT0gaWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRMYXllcnMgPSB1cGRhdGVkTGF5ZXJzLm1hcChvcmlnTGF5ZXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9yaWdMYXllci5pZCA9PT0gc2liTHlyLmlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5vcmlnTGF5ZXIsIHZpc2libGU6IGFjdGl2ZSB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9yaWdMYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1twYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBpc0NoZWNrZWQgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVkTGF5ZXJzID0gdXBkYXRlZExheWVycy5tYXAob3JpZ0xheWVyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcmlnTGF5ZXIuaWQgPT09IGlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4ub3JpZ0xheWVyLCB2aXNpYmxlOiBpc0NoZWNrZWQgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBvcmlnTGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJsYXllcnNcIiwgdXBkYXRlZExheWVycyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldExheWVyQm91bmRzKG5vZGUsIG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb25MYXllclRvZ2dsZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcmVudEVsLmFwcGVuZENoaWxkKG5vZGVEaXYpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbmRlciB0cmVlIGZyb20gcm9vdCBub2RlXHJcbiAgICByZW5kZXJOb2RlKHRyZWUsIHNpZGViYXIsIDAsIG51bGwsIHRydWUpO1xyXG59XHJcbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IHRoZSBmaXJzdCB0aWNrIHNpdHMgb25lIHBlcmlvZCBhZnRlciB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24sXG4vLyBzbyB0aGUgZmlyc3Qgd2luZG93ICh0aWNrIC0gcGVyaW9kLCB0aWNrXSBjb250YWlucyBpdDsgdGhlIGxhc3QgdGljayBpcyB0aGUgZmlyc3QgdG9cbi8vIHJlYWNoIHBhc3QgdGhlIGZpbmFsIG9ic2VydmF0aW9uLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIGNvbnN0IHRpY2tzID0gW107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIHdoaWxlICh0aWNrcy5sZW5ndGggPCBNQVhfVElDS1MpIHtcbiAgICAgICAgdCA9IGFkZFBlcmlvZCh0LCBwKTtcbiAgICAgICAgdGlja3MucHVzaCh0KTtcbiAgICAgICAgaWYgKHQgPj0gZW5kTXMpIHJldHVybiB0aWNrcztcbiAgICB9XG4gICAgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIHRpbWUgc2xpZGVyIGNhcHBlZCBhdCAke01BWF9USUNLU30gdGlja3M7IGAgK1xuICAgICAgICBgdGhlIHBlcmlvZCBpcyB0b28gZmluZSBmb3IgdGhlIGRhdGEncyBleHRlbnQuIFVzZSBhIGNvYXJzZXIgcGVyaW9kLmApO1xuICAgIHJldHVybiB0aWNrcztcbn1cblxuLy8gLS0tIHdpbmRvd3MgYW5kIGZpbHRlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBUaGUgaW50ZXJ2YWwgc2hvd24gYXQgb25lIHRpY2suIGR1cmF0aW9uIFwicGVyaW9kXCIgaXMgdGhlIHRpY2sncyBvd24gcGVyaW9kLCBzbyBhYnNlbmNlXG4vLyBpcyB2aXNpYmxlOyBudWxsIGFjY3VtdWxhdGVzIGV2ZXJ5dGhpbmcgc28gZmFyOyBhbiBJU08gc3RyaW5nIHRyYWlscyBhIGZpeGVkIHdpbmRvdy5cbmV4cG9ydCBmdW5jdGlvbiB3aW5kb3dGb3IodGljaywgZHVyYXRpb25TcGVjLCBwZXJpb2QpIHtcbiAgICBpZiAoZHVyYXRpb25TcGVjID09PSBudWxsIHx8IGR1cmF0aW9uU3BlYyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIH1cbiAgICBjb25zdCBwID0gZHVyYXRpb25TcGVjID09PSBcInBlcmlvZFwiID8gcGVyaW9kIDogcGFyc2VQZXJpb2QoZHVyYXRpb25TcGVjKTtcbiAgICBpZiAoIXApIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIHJldHVybiB7IHN0YXJ0OiBhZGRQZXJpb2QodGljaywgcCwgLTEpLCBlbmQ6IHRpY2sgfTtcbn1cblxuLy8gSGFsZi1vcGVuIChzdGFydCwgZW5kXTogYSBmZWF0dXJlIHN0YW1wZWQgZXhhY3RseSBvbiBhIHRpY2sgYm91bmRhcnkgYmVsb25ncyB0byB0aGVcbi8vIHBlcmlvZCB0aGF0IGVuZHMgdGhlcmUsIGFuZCBuZXZlciB0byB0d28gbmVpZ2hib3VyaW5nIHRpY2tzIGF0IG9uY2UuIE5hTiB0aW1lcyBtYXJrXG4vLyBmZWF0dXJlcyB0aGF0IGNhcnJpZWQgbm8gcmVhZGFibGUgdGltZTsgdGhleSBzdGF5IHZpc2libGUgcmF0aGVyIHRoYW4gdmFuaXNoaW5nLlxuZXhwb3J0IGZ1bmN0aW9uIGZlYXR1cmVJbldpbmRvdyhzdGFydE1zLCBlbmRNcywgd2luKSB7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydE1zKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGVuZE1zID4gd2luLnN0YXJ0ICYmIHN0YXJ0TXMgPD0gd2luLmVuZDtcbn1cblxuLy8gVGltZXMgdHJhdmVsIGFzIGEgRmxvYXQ2NEFycmF5IG9mIGludGVybGVhdmVkIFtzdGFydCwgZW5kXSBwYWlycyBpbiB0aGUgYnVmZmVyIG1hcCxcbi8vIHVuZGVyIFwiPGxheWVyIGlkPjo6dGltZXNcIiAtLSB0aGUgc2FtZSB0cmFuc3BvcnQgY29vcmRpbmF0ZXMgdXNlLlxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKSB7XG4gICAgY29uc3QgcmF3ID0gYnVmZmVycyAmJiBidWZmZXJzW2Ake2xheWVyLmlkfTo6dGltZXNgXTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xufVxuXG4vLyBXaGF0IHJlbmRlcmluZyB0aHJlYWRzIHRocm91Z2g6IHRoZSBjdXJyZW50IHRpY2sgcGx1cyB0aGUgc2hhcmVkIHBlcmlvZCwgb3IgbnVsbCB3aGVuXG4vLyBubyBzbGlkZXIgaXMgYWN0aXZlLiBFYWNoIGxheWVyIGRlcml2ZXMgaXRzIG93biB3aW5kb3cgZnJvbSB0aGVzZSwgc2luY2UgZHVyYXRpb24gaXNcbi8vIHBlciBsYXllciB3aGlsZSB0aGUgdGljayBpcyBzaGFyZWQuXG4vL1xuLy8gV2hldGhlciBhIHdob2xlIGxheWVyIHNob3dzIGF0IHRoZSBjdXJyZW50IHRpY2suIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lXG4vLyBnZW9tZXRyeSBwZXIgbGF5ZXIsIHNvIHRoZXkgYXJlIGluIG9yIG91dCBhcyBhIHVuaXQ7IGEgbGF5ZXIgd2l0aCBubyB0aW1lIG1ldGFkYXRhIGlzXG4vLyBub3QgdGhlIHNsaWRlcidzIHRvIGhpZGUuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBsYXllci50aW1lLmR1cmF0aW9uLCB0aW1lU3RhdGUucGVyaW9kKTtcbiAgICByZXR1cm4gZmVhdHVyZUluV2luZG93KHRpbWVzWzBdLCB0aW1lc1sxXSwgd2luKTtcbn1cblxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XG59XG5cbi8vIE9uZSBwbGF5YmFjayBzdGVwOiB0aGUgbmV4dCBpbmRleCBhbmQgd2hldGhlciBwbGF5YmFjayBzdXJ2aXZlcyBpdC4gUHVyZSBzbyB0aGUgbG9vcFxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxuLy8gd2l0aG91dCBsb29wIHN0b3BzIHdoZXJlIGl0IGlzLlxuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2UoaW5kZXgsIGxlbmd0aCwgbG9vcCkge1xuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcbiAgICBpZiAobG9vcCkgcmV0dXJuIHsgaW5kZXg6IDAsIHBsYXlpbmc6IHRydWUgfTtcbiAgICByZXR1cm4geyBpbmRleCwgcGxheWluZzogZmFsc2UgfTtcbn1cblxuLy8gV2hlcmUgdGhlIGNvbnRyb2wgc2l0cywgYXMgaW5saW5lIHN0eWxlcyBzbyB0aGUgY2hvaWNlIHRyYXZlbHMgd2l0aCB0aGUgc3RhdGUgcmF0aGVyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cbi8vIGluY2x1ZGluZyB0aGUgb25lcyBhIHBvc2l0aW9uIGRvZXMgbm90IHVzZSAtLSBzbyBtb3ZpbmcgdGhlIGNvbnRyb2wgY2xlYXJzIHRoZSBvbGRcbi8vIGFuY2hvciBpbnN0ZWFkIG9mIGFjY3VtdWxhdGluZyBib3RoLlxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcbiAgICBcInRvcC1sZWZ0XCI6ICAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJ0b3AtY2VudGVyXCI6ICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImxlZnQtY2VudGVyXCI6ICAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJyaWdodC1jZW50ZXJcIjogIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImJvdHRvbS1jZW50ZXJcIjogeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tcmlnaHRcIjogIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxufTtcblxuZnVuY3Rpb24gYXBwbHlQb3NpdGlvbihlbCwgcG9zaXRpb24pIHtcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XG4gICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN0eWxlcykpIHtcbiAgICAgICAgZWwuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XG59XG5cbi8vIEdseXBocyBhcyBpbmxpbmUgU1ZHIHJhdGhlciB0aGFuIHRleHQ6IFwiXHUyMUJCXCIgcmVhZHMgYXMgcmVmcmVzaCAtLSBhIGxvb3AgdG9nZ2xlIGRyYXduIHdpdGhcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xuLy8gdGhlIHByZXNzZWQgc3RhdGUgcmVzdHlsZSB0aGVtIGZyb20gQ1NTLlxuY29uc3QgSUNPTlMgPSB7XG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcbiAgICBwbGF5OiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAybDkgNi05IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGF1c2U6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJoM3YxMkg0ek05IDJoM3YxMkg5elwiLz48L3N2Zz4nLFxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXG4gICAgbG9vcDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTggMmE2IDYgMCAwIDEgNS42NSA0SDE2bC0yLjggMy41TDEwLjQgNmgyLjFBNC41IDQuNSAwIDEgMCAxMi41IDEwbDEuMy43NUE2IDYgMCAxIDEgOCAyelwiLz48L3N2Zz4nLFxufTtcblxuLy8gLS0tIHRoZSBjb250cm9sIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQbGFpbiBET00gaW5zaWRlIHRoZSB3aWRnZXQgY29udGFpbmVyLCBsaWtlIHRoZSBzaWRlYmFyOiBubyBMZWFmbGV0IGNvbnRyb2wgbWFjaGluZXJ5LFxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xuLy8gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MgY29udHJvbCAtLSBzdGVwL3BsYXkvc3RlcC9sb29wIGFzIGEgam9pbmVkIGJ1dHRvbiBiYXIsIHRoZW4gdGhlXG4vLyBkYXRlLCBzbGlkZXIgYW5kIHNwZWVkIC0tIHNpbmNlIHRoYXQgaXMgdGhlIHNsaWRlciB1c2VycyBvZiB0aGUgZm9saXVtIGFwcHMga25vdy5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJUaW1lQ29udHJvbChjb250YWluZXIsIHN0YXRlLCBoYW5kbGVycykge1xuICAgIGxldCBlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtY29udHJvbFwiKTtcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoZWwpIGVsLnJlbW92ZSgpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKCFlbCkge1xuICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XG4gICAgICAgIGVsLmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1idXR0b25zXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1wbGF5XCIgYXJpYS1sYWJlbD1cIlBsYXlcIj4ke0lDT05TLnBsYXl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtZndkXCIgdGl0bGU9XCJTdGVwIGZvcndhcmRcIiBhcmlhLWxhYmVsPVwiU3RlcCBmb3J3YXJkXCI+JHtJQ09OUy5md2R9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxhYmVsXCI+PC9zcGFuPlxuICAgICAgICAgICAgPGlucHV0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zbGlkZXJcIiB0eXBlPVwicmFuZ2VcIiBtaW49XCIwXCIgc3RlcD1cIjFcIj5cbiAgICAgICAgICAgIDxzZWxlY3QgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwZWVkXCIgdGl0bGU9XCJQbGF5YmFjayBzcGVlZFwiPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIwLjVcIj4wLjV4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjFcIj4xeDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIyXCI+Mng8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiNFwiPjR4PC9vcHRpb24+XG4gICAgICAgICAgICA8L3NlbGVjdD5gO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoZWwpO1xuXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1iYWNrXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBCYWNrKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWZ3ZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwRm9yd2FyZCk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblBsYXlUb2dnbGUpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25Mb29wVG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIixcbiAgICAgICAgICAgIGUgPT4gaGFuZGxlcnMub25TcGVlZChwYXJzZUZsb2F0KGUudGFyZ2V0LnZhbHVlKSkpO1xuICAgICAgICBjb25zdCBzbGlkZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpO1xuICAgICAgICAvLyBgaW5wdXRgIGZpcmVzIHBlciBkcmFnIHN0ZXAgZm9yIGxpdmUgc2NydWJiaW5nOyB0aGUgbW9kZWwgd3JpdGViYWNrIGlzIHRoZVxuICAgICAgICAvLyBoYW5kbGVyJ3MgcHJvYmxlbSwgdGhyb3R0bGVkIHRoZXJlIHNvIGRyYWdnaW5nIGRvZXMgbm90IGZsb29kIHRoZSBrZXJuZWwuXG4gICAgICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgZSA9PiBoYW5kbGVycy5vblNlZWsocGFyc2VJbnQoZS50YXJnZXQudmFsdWUsIDEwKSkpO1xuICAgIH1cblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikubWF4ID0gU3RyaW5nKHN0YXRlLnRpY2tzLmxlbmd0aCAtIDEpO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuaW5kZXgpO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sYWJlbFwiKS50ZXh0Q29udGVudCA9IGZvcm1hdFVUQyhzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF0pO1xuXG4gICAgY29uc3QgcGxheSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpO1xuICAgIHBsYXkuaW5uZXJIVE1MID0gc3RhdGUucGxheWluZyA/IElDT05TLnBhdXNlIDogSUNPTlMucGxheTtcbiAgICBwbGF5LnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiKTtcbiAgICBwbGF5LnRpdGxlID0gc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiO1xuXG4gICAgLy8gQSBtb2RlLCBub3QgYW4gYWN0aW9uOiBwcmVzc2VkIHN0eWxpbmcgYW5kIGFyaWEtcHJlc3NlZCBzYXkgXCJ0aGlzIHN0YXlzIG9uXCIsXG4gICAgLy8gd2hlcmUgYSBiYXJlIGljb24gaW52aXRlZCBhIGNsaWNrIGV4cGVjdGluZyBzb21ldGhpbmcgdG8gaGFwcGVuIHJpZ2h0IG5vdy5cbiAgICBjb25zdCBsb29wID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIik7XG4gICAgbG9vcC5jbGFzc0xpc3QudG9nZ2xlKFwiYWN0aXZlXCIsIEJvb2xlYW4oc3RhdGUubG9vcCkpO1xuICAgIGxvb3Auc2V0QXR0cmlidXRlKFwiYXJpYS1wcmVzc2VkXCIsIFN0cmluZyhCb29sZWFuKHN0YXRlLmxvb3ApKSk7XG4gICAgbG9vcC50aXRsZSA9IHN0YXRlLmxvb3AgPyBcIkxvb3A6IG9uXCIgOiBcIkxvb3A6IG9mZlwiO1xuXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLnNwZWVkIHx8IDEpO1xuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcbiAgICByZXR1cm4gZWw7XG59XG4iLCAiaW1wb3J0IHsgbG9hZEpTLCBiaW5kUG9wdXAsIGJpbmRUb29sdGlwLCBwYXJzZUNvbG9yIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHBpblNoYWRlciB9IGZyb20gXCIuL3NoYWRlcnMuanNcIjtcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdyB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XG5cbmZ1bmN0aW9uIHNldHVwR2xpZnlQcm9qZWN0aW9uKGdsSW5zdGFuY2UpIHtcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIuX3VuY2xhbXBlZFByb2plY3QgPSBmdW5jdGlvbihsYXRsbmcsIHpvb20pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAub3B0aW9ucy5jcnMubGF0TG5nVG9Qb2ludChsYXRsbmcsIHpvb20pO1xuICAgICAgICB9O1xuICAgICAgICBnbEluc3RhbmNlLmxheWVyLnJlZHJhdygpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xuICAgIGlmICghbWFwLl9jbGlja01hdGNoZXMpIHtcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcbiAgICB9XG4gICAgbWFwLl9jbGlja01hdGNoZXMucHVzaCh7IHByaW9yaXR5LCBhY3Rpb24gfSk7XG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xuICAgICAgICBtYXAuX2NsaWNrVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXMuc29ydCgoYSwgYikgPT4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHkpO1xuICAgICAgICAgICAgaWYgKG1hcC5fY2xpY2tNYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlc1swXS5hY3Rpb24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XG4gICAgICAgICAgICBtYXAuX2NsaWNrVGltZW91dCA9IG51bGw7XG4gICAgICAgIH0sIDApO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xuICAgIGlmICghbWFwLl9ob3Zlck1hdGNoZXMpIHtcbiAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMgPSBbXTtcbiAgICB9XG4gICAgbWFwLl9ob3Zlck1hdGNoZXMucHVzaCh7IHByaW9yaXR5LCBhY3Rpb24gfSk7XG4gICAgaWYgKCFtYXAuX2hvdmVyVGltZW91dCkge1xuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMuc29ydCgoYSwgYikgPT4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHkpO1xuICAgICAgICAgICAgaWYgKG1hcC5faG92ZXJNYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XG4gICAgICAgIH0sIDApO1xuICAgIH1cbn1cblxuLy8gU3R5bGUgZm9yIG9uZSBmZWF0dXJlOiBpdHMgb3duIGVudHJ5IGZyb20gYGZlYXR1cmVfc3R5bGVzYCB3aGVuIHRoZSBsYXllciBjYXJyaWVzXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcbi8vIHdoZW4gZmVhdHVyZXMgYWN0dWFsbHkgZGlmZmVyLCBzbyBhIHVuaWZvcm0gbGF5ZXIgY29zdHMgbm90aGluZyBleHRyYSBoZXJlLlxuLy8gRm91ciBzb3VyY2VzLCBsZWFzdCBzcGVjaWZpYyBmaXJzdC4gRWFjaCB0cmFuc2llbnQgb25lIGxpdmVzIGluIGl0cyBvd24gZmllbGQgcmF0aGVyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxuLy8gbm90aGluZyB0byByZW1lbWJlciBhbmQgbm90aGluZyB0byBwdXQgYmFjay5cbi8vXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcbi8vICAgZmVhdHVyZV9zdHlsZXNbaV0gICAgICAgcGVyIGZlYXR1cmUsIGZyb20gdGhlIGRhdGFcbi8vICAgaGlnaGxpZ2h0X3N0eWxlICAgICAgICAgdGhlIHdob2xlIGxheWVyIGlzIHNlbGVjdGVkXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXG5leHBvcnQgZnVuY3Rpb24gc3R5bGVGb3IobGF5ZXIsIGluZGV4KSB7XG4gICAgY29uc3QgZnJvbURhdGEgPSBBcnJheS5pc0FycmF5KGxheWVyLmZlYXR1cmVfc3R5bGVzKSA/IGxheWVyLmZlYXR1cmVfc3R5bGVzW2luZGV4XSA6IG51bGw7XG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xuICAgIGNvbnN0IHNlbGVjdGVkID0gbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzICYmIGxheWVyLnN0eWxlX292ZXJyaWRlc1tpbmRleF07XG4gICAgaWYgKCFmcm9tRGF0YSAmJiAhaGlnaGxpZ2h0ICYmICFzZWxlY3RlZCkgcmV0dXJuIGxheWVyO1xuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcbiAgICBpZiAoIXByb3BlcnRpZXMpIHJldHVybiB7fTtcbiAgICBjb25zdCBwcm9wcyA9IHt9O1xuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BlcnRpZXNba107XG4gICAgICAgIHByb3BzW2tdID0gQXJyYXkuaXNBcnJheSh2YWwpID8gdmFsW2luZGV4XSA6IHZhbDtcbiAgICB9KTtcbiAgICByZXR1cm4gcHJvcHM7XG59XG5cblxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRCdWZmZXIsIG1vZGVsKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIikge1xuICAgICAgICBjb25zdCBncm91cCA9IEwubGF5ZXJHcm91cCgpO1xuICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fTtcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBpZiAoc3ViLnR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJtYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWxpbmVcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgc3ViLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBzdWIsIGNvb3JkaW5hdGVCdWZmZXJzW3N1Yi5pZF0sIG1vZGVsKTtcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgIGdyb3VwLmFkZExheWVyKGluc3RhbmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBncm91cC5hZGRUbyhtYXApO1xuICAgICAgICBncm91cC5sYXllclR5cGUgPSBsYXllci50eXBlO1xuICAgICAgICByZXR1cm4gZ3JvdXA7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBtb2RlbCwgdGltZVN0YXRlID0gbnVsbCkge1xuICAgIC8vIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhlIHRpbWUgc2xpZGVyIGluY2x1ZGVzXG4gICAgLy8gb3IgZXhjbHVkZXMgdGhlbSB3aG9sZS4gUG9pbnRzIGNhcnJ5IHBlci1mZWF0dXJlIHRpbWVzIGFuZCBmaWx0ZXIgaW5zaWRlIHRoZWlyIGxvb3AuXG4gICAgaWYgKHRpbWVTdGF0ZSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCIpIHtcbiAgICAgICAgbGF5ZXJzTGlzdCA9IGxheWVyc0xpc3QuZmlsdGVyKGwgPT4gbGF5ZXJJbldpbmRvdyhsLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSk7XG4gICAgICAgIGlmIChsYXllcnNMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmICh0eXBlID09PSBcInBvbHlsaW5lXCIpIHtcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgICAgICBjb25zdCBnZW9qc29uQ29vcmRzID0gbGF5ZXIubG9jYXRpb25zLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiTGluZVN0cmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBjb29yZGluYXRlczogZ2VvanNvbkNvb3Jkc1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmdsTGluZXMgPSBMLmdsaWZ5LmxpbmVzKHtcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlsaW5lc1BhbmVcIixcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobW9kZWwuY29tbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBsYXllci5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbExpbmVzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbExpbmVzKSB0aGlzLmdsTGluZXMucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSBcInBvbHlnb25cIikge1xuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgICAgIGxldCBnZW9qc29uQ29vcmRzID0gW107XG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcbiAgICAgICAgICAgICAgICBnZW9qc29uQ29vcmRzID0gbGF5ZXIubG9jYXRpb25zLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XG4gICAgICAgICAgICAgICAgaWYgKGdlb2pzb25Db29yZHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaXJzdCA9IGdlb2pzb25Db29yZHNbMF07XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxhc3QgPSBnZW9qc29uQ29vcmRzW2dlb2pzb25Db29yZHMubGVuZ3RoIC0gMV07XG4gICAgICAgICAgICAgICAgICAgIGlmIChmaXJzdFswXSAhPT0gbGFzdFswXSB8fCBmaXJzdFsxXSAhPT0gbGFzdFsxXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ2VvanNvbkNvb3Jkcy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAobGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGxheWVyLmxvY2F0aW9uWzBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGxheWVyLmxvY2F0aW9uWzFdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJhZGl1c01ldGVycyA9IGxheWVyLnJhZGl1cyB8fCAxMDtcbiAgICAgICAgICAgICAgICBjb25zdCBlYXJ0aFJhZGl1cyA9IDYzNzgxMzc7XG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gMzI7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbmdsZSA9IChpICogMzYwKSAvIDMyO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbmdsZVJhZCA9IChhbmdsZSAqIE1hdGguUEkpIC8gMTgwO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkTGF0ID0gKHJhZGl1c01ldGVycyAqIE1hdGguY29zKGFuZ2xlUmFkKSkgLyBlYXJ0aFJhZGl1cztcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZExvbiA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLnNpbihhbmdsZVJhZCkpIC8gKGVhcnRoUmFkaXVzICogTWF0aC5jb3MoKGxhdCAqIE1hdGguUEkpIC8gMTgwKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0xhdCA9IGxhdCArIChkTGF0ICogMTgwKSAvIE1hdGguUEk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0xvbiA9IGxvbiArIChkTG9uICogMTgwKSAvIE1hdGguUEk7XG4gICAgICAgICAgICAgICAgICAgIGdlb2pzb25Db29yZHMucHVzaChbbmV3TG9uLCBuZXdMYXRdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChnZW9qc29uQ29vcmRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xuICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJQb2x5Z29uXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvb3JkaW5hdGVzOiBbZ2VvanNvbkNvb3Jkc11cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5maWxsT3BhY2l0eSB8fCAwLjIgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgY29uc3QgZ2VvanNvbiA9IHtcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcblxuICAgICAgICAgICAgICAgIHRoaXMuZ2xTaGFwZXMgPSBMLmdsaWZ5LnNoYXBlcyh7XG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogZ2VvanNvbixcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5Z29uc1BhbmVcIixcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAzLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG1vZGVsLmNvbW0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xTaGFwZXMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsU2hhcGVzKSB0aGlzLmdsU2hhcGVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XG4gICAgY29uc3QgaW5kZXhNYXBwaW5nID0gW107XG5cbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xuICAgIC8vIGdsaWZ5J3MgZmFsbGJhY2sgd2hlbiBhIGxheWVyIGRlY2xhcmVzIG5vIHJhZGl1cy4gUGlucyBuZWVkIGZhciBtb3JlIHJvb20gdGhhbiBhXG4gICAgLy8gY2lyY2xlIGJlY2F1c2UgdGhlIGdseXBoIGlzIGRyYXduIGluc2lkZSB0aGUgcG9pbnQncyBvd24gcXVhZCBieSB0aGUgc2hhZGVyLlxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgY29sb3JSR0IgPSBwYXJzZUNvbG9yKGxheWVyLmNvbG9yLCBmYWxsYmFja0NvbG9yKTtcbiAgICAgICAgY29uc3QgbGF5ZXJTaXplID0gbGF5ZXIucmFkaXVzICE9IG51bGwgPyBOdW1iZXIobGF5ZXIucmFkaXVzKSA6IGRlZmF1bHRTaXplO1xuXG4gICAgICAgIGNvbnN0IGNvb3JkQnVmZmVyID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICBpZiAoIWNvb3JkQnVmZmVyKSB7XG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2xheWVyLmxvY2F0aW9uWzBdLCBsYXllci5sb2NhdGlvblsxXV0pO1xuICAgICAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiAwLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3JSR0IsXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnVmZmVyLFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZU9mZnNldCxcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGNvdW50ID0gY29vcmRzLmxlbmd0aCAvIDI7XG5cbiAgICAgICAgY29uc3QgcGVyRmVhdHVyZSA9IEFycmF5LmlzQXJyYXkobGF5ZXIuZmVhdHVyZV9zdHlsZXMpID8gbGF5ZXIuZmVhdHVyZV9zdHlsZXMgOiBudWxsO1xuICAgICAgICAvLyBTZWxlY3Rpb24gc3R5bGluZywgYXBwbGllZCBvdmVyIHRoZSBsYXllcidzIG93biBhbmQgaXRzIGRhdGEtZHJpdmVuIHN0eWxlcy5cbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cbiAgICAgICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlIHx8IG51bGw7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlcyA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyB8fCBudWxsO1xuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxuICAgICAgICAvLyBzaW1wbHkgbm90IHB1c2hlZDsgaW5kZXhNYXBwaW5nIGNhcnJpZXMgb3JpZ2luYWxJbmRleCwgc28gcG9wdXBzIGFuZCBwcm9wZXJ0aWVzXG4gICAgICAgIC8vIG9uIHRoZSBzdXJ2aXZvcnMga2VlcCBwb2ludGluZyBhdCB0aGUgcmlnaHQgcm93cy5cbiAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcbiAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBsYXllci50aW1lLmR1cmF0aW9uLCB0aW1lU3RhdGUucGVyaW9kKSA6IG51bGw7XG4gICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAodGltZXMgJiYgIWZlYXR1cmVJbldpbmRvdyh0aW1lc1tpICogMl0sIHRpbWVzW2kgKiAyICsgMV0sIHdpbikpIGNvbnRpbnVlO1xuICAgICAgICAgICAgY29uc3QgZnJvbURhdGEgPSBwZXJGZWF0dXJlID8gcGVyRmVhdHVyZVtpXSA6IG51bGw7XG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XG4gICAgICAgICAgICBjb25zdCBjb2xvciA9IChzZWxlY3RlZCAmJiBzZWxlY3RlZC5jb2xvcilcbiAgICAgICAgICAgICAgICB8fCAoaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5jb2xvcilcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xuICAgICAgICAgICAgY29uc3QgcmFkaXVzID0gc2VsZWN0ZWQgJiYgc2VsZWN0ZWQucmFkaXVzICE9IG51bGwgPyBzZWxlY3RlZC5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IGhpZ2hsaWdodCAmJiBoaWdobGlnaHQucmFkaXVzICE9IG51bGwgPyBoaWdobGlnaHQucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xuICAgICAgICAgICAgICAgIDogbnVsbDtcblxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xuICAgICAgICAgICAgaW5kZXhNYXBwaW5nLnB1c2goe1xuICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxuICAgICAgICAgICAgICAgIGNvbG9yUkdCOiBjb2xvciA/IHBhcnNlQ29sb3IoY29sb3IsIGZhbGxiYWNrQ29sb3IpIDogY29sb3JSR0IsXG4gICAgICAgICAgICAgICAgc2l6ZTogcmFkaXVzICE9IG51bGwgPyBOdW1iZXIocmFkaXVzKSA6IGxheWVyU2l6ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9pbnRzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XG4gICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpIHx8IG1hcC5nZXRDb250YWluZXIoKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gZ2V0SW50ZXJhY3RpdmVFbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcblxuICAgICAgICAgICAgY29uc3QgZ2xpZnlPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIG1hcDogbSxcbiAgICAgICAgICAgICAgICBkYXRhOiBwb2ludHNMaXN0LFxuICAgICAgICAgICAgICAgIHBhbmU6IFwicG9pbnRzUGFuZVwiLFxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcbiAgICAgICAgICAgICAgICAvLyBzbyBhIHNpbmdsZSBjb25zdGFudCBoZXJlIHNpbGVudGx5IGRpc2NhcmRlZCBldmVyeSBsYXllcidzIG93biByYWRpdXMuXG4gICAgICAgICAgICAgICAgc2l6ZTogKGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyAmJiBpbmZvLnNpemUgIT0gbnVsbCA/IGluZm8uc2l6ZSA6IGRlZmF1bHRTaXplO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvID8gaW5mby5jb2xvclJHQiA6IHsgcjogMC4yLCBnOiAwLjUsIGI6IDEuMCB9O1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcGlja2luZzogdHJ1ZSxcbiAgICAgICAgICAgICAgICBzZW5zaXRpdml0eTogdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyMCA6IDgsXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXBvaW50KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsaWNrUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChlLmxhdGxuZyk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoTC5sYXRMbmcocG9pbnRbMF0sIHBvaW50WzFdKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1heERpc3QgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDI1IDogMTI7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwaXhlbERpc3QgPiBtYXhEaXN0KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBwb2ludCwgcHJvcHMsIGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobW9kZWwuY29tbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgb3JpZ2luYWxJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBob3ZlcjogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBpZiAocG9pbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuZm9yY2UgYSBzdHJpY3QgcGl4ZWwtZGlzdGFuY2UgdGhyZXNob2xkIHRvIHByZXZlbnQgdG9vbHRpcHMgb24gZmFyIGF3YXkgaG92ZXJzXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBob3ZlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGhvdmVyUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2lkeF07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT09IFwibWFya2Vyc1wiKSB7XG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLmZyYWdtZW50U2hhZGVyU291cmNlID0gKCkgPT4gcGluU2hhZGVyO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmdsUG9pbnRzID0gTC5nbGlmeS5wb2ludHMoZ2xpZnlPcHRpb25zKTtcbiAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xQb2ludHMpO1xuICAgICAgICB9LFxuICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLmdsUG9pbnRzKSB0aGlzLmdsUG9pbnRzLnJlbW92ZSgpO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgY29uc3QgY2FudmFzID0gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIik7XG4gICAgICAgICAgICBpZiAoY2FudmFzKSBjYW52YXMuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcbiAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xuICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgcmV0dXJuIGluc3RhbmNlO1xufVxuIiwgImltcG9ydCB7IGxvYWRDU1MsIGxvYWRKUyB9IGZyb20gXCIuL3V0aWxzLmpzXCI7XG5pbXBvcnQgeyByZW5kZXJTaWRlYmFyQ29udHJvbHMsIG5vcm1hbGl6ZVJhZGlvTGF5ZXJzIH0gZnJvbSBcIi4vc2lkZWJhci5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyTGF5ZXIsIHJlbmRlck1lcmdlZEdsTGF5ZXIgfSBmcm9tIFwiLi9sYXllcnMuanNcIjtcbmltcG9ydCB7IHBhcnNlUGVyaW9kLCBnZW5lcmF0ZVRpY2tzLCBjb2xsZWN0VGltZUV4dGVudCwgaGFzVGltZUxheWVycyxcbiAgICAgICAgIGxheWVySW5XaW5kb3csIHJlbmRlclRpbWVDb250cm9sLCBhZHZhbmNlIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcblxuLy8gVHJ1ZSBpZiBhIGxheWVyIGlzIHZpc2libGUgYW5kIG5vIGZvbGRlciBhYm92ZSBpdCBpcyBzd2l0Y2hlZCBvZmYuXG4vL1xuLy8gVmlzaWJpbGl0eSBpcyBpbmhlcml0ZWQgZG93biB0aGUgZm9sZGVyIHBhdGg6IGEgbGF5ZXIgaW5zaWRlIFwiRmVlZHMvQWN0aXZlXCIgaXMgaGlkZGVuXG4vLyB3aGVuIGVpdGhlciBcIkZlZWRzXCIgb3IgXCJGZWVkcy9BY3RpdmVcIiBpcyBvZmYsIHJlZ2FyZGxlc3Mgb2YgaXRzIG93biBmbGFnLiBHZXR0aW5nIHRoaXNcbi8vIHdyb25nIHNob3dzIHVwIGFzIFwidGhhdCBsYXllciBqdXN0IHdpbGwgbm90IGFwcGVhclwiLCB3aXRoIG5vdGhpbmcgbG9nZ2VkLlxuZXhwb3J0IGZ1bmN0aW9uIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpIHtcbiAgICBpZiAobGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xuICAgIGZvciAoY29uc3QgcGFydCBvZiAobGF5ZXIubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIikuc3BsaXQoXCIvXCIpKSB7XG4gICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xuICAgICAgICBjb25zdCBjb25maWcgPSBncm91cENvbmZpZ3NbcnVubmluZ1BhdGhdO1xuICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gU29ydHMgdGhlIHZpc2libGUgbGF5ZXJzIGludG8gb25lIGJ1Y2tldCBwZXIgV2ViR0wgZHJhdyBwYXNzLlxuLy9cbi8vIFN1Yi1sYXllcnMgb2YgYSBtZXJnZWQgZ3JvdXAgaW5oZXJpdCB0aGVpciBwYXJlbnQncyB2aXNpYmlsaXR5IHJhdGhlciB0aGFuIGNhcnJ5aW5nXG4vLyB0aGVpciBvd24sIHNvIGEgZ3JvdXAgdG9nZ2xlZCBvZmYgY29udHJpYnV0ZXMgbm90aGluZyBldmVuIHdoZW4gaXRzIGNoaWxkcmVuIHNheVxuLy8gdmlzaWJsZS4gQ2lyY2xlcyBqb2luIHRoZSBwb2x5Z29uIGJ1Y2tldDogdGhleSBhcmUgZHJhd24gYXMgZ2VuZXJhdGVkIHJpbmdzLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xuICAgIGNvbnN0IGJ1Y2tldHMgPSB7IGNpcmNsZV9tYXJrZXJzOiBbXSwgbWFya2VyczogW10sIHBvbHlsaW5lOiBbXSwgcG9seWdvbjogW10gfTtcblxuICAgIGZ1bmN0aW9uIGNvbGxlY3QobGF5ZXIsIHBhcmVudFZpc2libGUsIGlzU3ViTGF5ZXIpIHtcbiAgICAgICAgaWYgKCFwYXJlbnRWaXNpYmxlKSByZXR1cm47XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gY29sbGVjdChzdWIsIHBhcmVudFZpc2libGUsIHRydWUpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWlzU3ViTGF5ZXIgJiYgbGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybjtcblxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xuICAgICAgICBpZiAoYnVja2V0c1tidWNrZXRdKSBidWNrZXRzW2J1Y2tldF0ucHVzaChsYXllcik7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgY29sbGVjdChsYXllciwgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyksIGZhbHNlKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ1Y2tldHM7XG59XG5cbi8vIEFwcGxpZXMgaW5jcmVtZW50YWwgcGF0Y2ggb3BzIHRvIHtsYXllcnMsIGJ1ZmZlcnN9LCByZXR1cm5pbmcgdGhlIG5ldyBzdGF0ZS5cbi8vXG4vLyBPcHMgYXJlIGFkZHJlc3NlZCBieSBsYXllciBpZCBhbmQgYXBwbGllZCBpZGVtcG90ZW50bHk6IFwiYWRkXCIgdXBzZXJ0cyByYXRoZXIgdGhhblxuLy8gYXBwZW5kaW5nIGJsaW5kbHksIHNvIGEgcGF0Y2ggdGhhdCByYWNlcyB0aGUgaW5pdGlhbCB0cmFpdCBzbmFwc2hvdCBjYW5ub3QgZHVwbGljYXRlXG4vLyBhIGxheWVyLCBhbmQgYSBcInJlbW92ZVwiIGZvciBzb21ldGhpbmcgYWxyZWFkeSBnb25lIGlzIGEgbm8tb3AuXG4vLyBBcHBsaWVzIGB1cGRhdGVgIHRvIG9uZSBsYXllciB3aGVyZXZlciBpdCBzaXRzLCBkZXNjZW5kaW5nIGludG8gZ3JvdXBzLiBhZGRfY29sbGVjdGlvblxuLy8gbmVzdHMgaXRzIHBvaW50LCBsaW5lIGFuZCBwb2x5Z29uIGxheWVycyBpbnNpZGUgYSBncm91cCBsYXllciwgc28gYW4gb3AgYWRkcmVzc2VkIGF0IGFcbi8vIG5lc3RlZCBpZCB3b3VsZCBvdGhlcndpc2UgbWF0Y2ggbm90aGluZyBhbmQgc2lsZW50bHkgZG8gbm90aGluZy4gUmV0dXJucyB0aGUgb3JpZ2luYWxcbi8vIGFycmF5IHVudG91Y2hlZCB3aGVuIHRoZSBpZCBpcyBub3QgZm91bmQsIHNvIGFuIHVubWF0Y2hlZCBvcCBjb3N0cyBubyByZS1yZW5kZXIuXG5mdW5jdGlvbiB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBpZCwgdXBkYXRlKSB7XG4gICAgbGV0IGhpdCA9IGZhbHNlO1xuICAgIGNvbnN0IG5leHQgPSBsYXllcnMubWFwKGwgPT4ge1xuICAgICAgICBpZiAobC5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgIGhpdCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm4gdXBkYXRlKGwpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBBcnJheS5pc0FycmF5KGwubGF5ZXJzKSkge1xuICAgICAgICAgICAgY29uc3Qgc3VicyA9IHVwZGF0ZUxheWVyQnlJZChsLmxheWVycywgaWQsIHVwZGF0ZSk7XG4gICAgICAgICAgICBpZiAoc3VicyAhPT0gbC5sYXllcnMpIHtcbiAgICAgICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IC4uLmwsIGxheWVyczogc3VicyB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBsO1xuICAgIH0pO1xuICAgIHJldHVybiBoaXQgPyBuZXh0IDogbGF5ZXJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTd2lmdG1hcFBhdGNoKHN0YXRlLCBvcHMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbGF5ZXJzID0gc3RhdGUubGF5ZXJzIHx8IFtdO1xuICAgIGxldCBidWZmZXJNYXAgPSBzdGF0ZS5idWZmZXJzIHx8IHt9O1xuXG4gICAgZm9yIChjb25zdCBvcCBvZiBvcHMpIHtcbiAgICAgICAgaWYgKG9wLm9wID09PSBcInNuYXBzaG90XCIpIHtcbiAgICAgICAgICAgIGxheWVycyA9IG9wLmxheWVycyB8fCBbXTtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHt9O1xuICAgICAgICAgICAgKG9wLmJ1ZmZlcl9pZHMgfHwgW10pLmZvckVhY2goKGlkLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcnMgJiYgYnVmZmVyc1tpXSkgYnVmZmVyTWFwW2lkXSA9IGJ1ZmZlcnNbaV07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJhZGRcIiB8fCBvcC5vcCA9PT0gXCJyZXBsYWNlXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGluY29taW5nID0gb3AubGF5ZXI7XG4gICAgICAgICAgICBjb25zdCBpZCA9IGluY29taW5nID8gaW5jb21pbmcuaWQgOiBvcC5pZDtcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IGxheWVycy5maW5kSW5kZXgobCA9PiBsLmlkID09PSBpZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IFsuLi5sYXllcnMsIGluY29taW5nXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLm1hcCgobCwgaSkgPT4gKGkgPT09IGlkeCA/IGluY29taW5nIDogbCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInNldFwiKSB7XG4gICAgICAgICAgICAvLyBGaWVsZC1sZXZlbCB1cGRhdGUuIFwicmVwbGFjZVwiIGNhcnJpZXMgdGhlIHdob2xlIGxheWVyLCBzbyBmbGlwcGluZyBgdmlzaWJsZWBcbiAgICAgICAgICAgIC8vIG9uIGEgNTBrLXBvaW50IGxheWVyIHJlc2VudCBldmVyeSBwcm9wZXJ0eSBpdCBob2xkcyAtLSBoYWxmIGEgbWVnYWJ5dGUgdG9cbiAgICAgICAgICAgIC8vIGNoYW5nZSBvbmUgYm9vbGVhbiwgb24gZXZlcnkgY2xpY2sgb2YgYSBjaGVja2JveC5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7IC4uLmwsIC4uLihvcC5maWVsZHMgfHwge30pIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzdHlsZVwiKSB7XG4gICAgICAgICAgICAvLyBQZXItZmVhdHVyZSBzdHlsZSBvdmVycmlkZXMsIHJlcGxhY2VkIHdob2xlc2FsZSByYXRoZXIgdGhhbiBtZXJnZWQ6IGFcbiAgICAgICAgICAgIC8vIHNlbGVjdGlvbiBkZXNjcmliZXMgaXRzIGNvbXBsZXRlIHN0YXRlLCBzbyBzZW5kaW5nIHt9IGNsZWFycyBpdCBhbmQgbm9cbiAgICAgICAgICAgIC8vIGNhbGxlciBoYXMgdG8gdHJhY2sgd2hhdCB0aGUgcHJldmlvdXMgaGlnaGxpZ2h0IHRvdWNoZWQuXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmwsIHN0eWxlX292ZXJyaWRlczogb3Aub3ZlcnJpZGVzIHx8IHt9LFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInJlbW92ZVwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBsYXllcnMuZmlsdGVyKGwgPT4gbC5pZCAhPT0gb3AuaWQpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlclwiKSB7XG4gICAgICAgICAgICBjb25zdCBidWYgPSBidWZmZXJzICYmIGJ1ZmZlcnNbb3AuYnVmZmVyX2luZGV4XTtcbiAgICAgICAgICAgIGlmIChidWYpIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwLCBbb3AuaWRdOiBidWYgfTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJfcmVtb3ZlXCIpIHtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwIH07XG4gICAgICAgICAgICBkZWxldGUgYnVmZmVyTWFwW29wLmlkXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7IGxheWVycywgYnVmZmVyczogYnVmZmVyTWFwIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgICBhc3luYyByZW5kZXIoeyBtb2RlbCwgZWwgfSkge1xuICAgICAgICBjb25zdCBvcmlnaW5hbEVycm9yID0gY29uc29sZS5lcnJvcjtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxXYXJuID0gY29uc29sZS53YXJuO1xuXG4gICAgICAgIC8vIGpzX2NvbnNvbGVfbG9ncyBpcyBhIHN5bmNlZCBsaXN0LCBzbyBlYWNoIGFwcGVuZCByZXNlbmRzIHRoZSB3aG9sZSBhcnJheS4gS2VlcGluZ1xuICAgICAgICAvLyBvbmx5IHRoZSBtb3N0IHJlY2VudCBlbnRyaWVzIGJvdW5kcyBib3RoIHRoZSBwYXlsb2FkIGFuZCB0aGUgbWVtb3J5IGEgbG9uZy1saXZlZFxuICAgICAgICAvLyBzZXNzaW9uIGFjY3VtdWxhdGVzOyB0aGUgbmV3ZXN0IGFyZSB0aGUgb25lcyB3b3J0aCBoYXZpbmcgYW55d2F5LlxuICAgICAgICBjb25zdCBNQVhfQ09OU09MRV9MT0dTID0gMjAwO1xuICAgICAgICBjb25zdCBhcHBlbmRMb2cgPSBlbnRyeSA9PiB7XG4gICAgICAgICAgICBjb25zdCBsb2dzID0gbW9kZWwuZ2V0KFwianNfY29uc29sZV9sb2dzXCIpIHx8IFtdO1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IFsuLi5sb2dzLCBlbnRyeV07XG4gICAgICAgICAgICByZXR1cm4gbmV4dC5sZW5ndGggPiBNQVhfQ09OU09MRV9MT0dTID8gbmV4dC5zbGljZSgtTUFYX0NPTlNPTEVfTE9HUykgOiBuZXh0O1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEhlbHBlciB0byBzYWZlbHkgd3JpdGUgYmFjayB0byBQeXRob24gb25seSBpZiB0aGUgd2lkZ2V0IHZpZXcgaXMgYWN0aXZlIGFuZCBhdHRhY2hlZFxuICAgICAgICBmdW5jdGlvbiBzYWZlU2V0QW5kU2F2ZShrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICBpZiAobW9kZWwuY29tbSAmJiBkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHdyaXRlIGVycm9yOlwiLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzYWZlU2F2ZUNoYW5nZXMoKSB7XG4gICAgICAgICAgICBpZiAobW9kZWwuY29tbSAmJiBkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyBzYXZlIGVycm9yOlwiLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yID0gZnVuY3Rpb24oLi4uYXJncykge1xuICAgICAgICAgICAgb3JpZ2luYWxFcnJvci5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpKTtcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xuICAgICAgICBjb25zb2xlLndhcm4gPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XG4gICAgICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xuICAgICAgICAgICAgICAgIGlmICghbG9nZ2VkUmVwcm9qZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBtb2RlbC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xlYW5Nc2cgPSBgW1N3aWZ0TWFwXSBMYXllciB3YXMgcmVwcm9qZWN0ZWQgdG8gXCIke2Nyc31cImA7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIGFwcGVuZExvZyhjbGVhbk1zZykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvcmlnaW5hbFdhcm4uYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgd2luZG93Lm9uZXJyb3IgPSBmdW5jdGlvbihtZXNzYWdlLCBzb3VyY2UsIGxpbmVubywgY29sbm8sIGVycm9yKSB7XG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxuICAgICAgICAgICAgICAgIGFwcGVuZExvZyhgV0lORE9XLk9ORVJST1I6ICR7bWVzc2FnZX0gYXQgJHtzb3VyY2V9OiR7bGluZW5vfToke2NvbG5vfWApKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBMb2FkIENTUyBhbmQgTGVhZmxldCBsaWJyYXJpZXMgKGluY2x1ZGluZyBXZWJHTCBnbGlmeSlcbiAgICAgICAgbG9hZENTUyhcImxlYWZsZXQtY3NzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuY3NzXCIpO1xuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWpzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2xpZnlcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0LmdsaWZ5QDMuMy4wL2Rpc3QvZ2xpZnktYnJvd3Nlci5qc1wiKTtcblxuICAgICAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5oZWlnaHQgPSBcIjEwMCVcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xuICAgICAgICBlbC5hcHBlbmRDaGlsZChjb250YWluZXIpO1xuXG4gICAgICAgIGNvbnN0IGNyc05hbWUgPSBtb2RlbC5nZXQoXCJjcnNcIik7XG4gICAgICAgIGxldCBtYXBDcnMgPSBMLkNSUy5FUFNHMzg1NztcbiAgICAgICAgaWYgKGNyc05hbWUgPT09IFwiRVBTRzo0MzI2XCIpIHtcbiAgICAgICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbWFwID0gTC5tYXAoY29udGFpbmVyLCB7XG4gICAgICAgICAgICBjcnM6IG1hcENycyxcbiAgICAgICAgICAgIGNlbnRlcjogbW9kZWwuZ2V0KFwiY2VudGVyXCIpLFxuICAgICAgICAgICAgem9vbTogbW9kZWwuZ2V0KFwiem9vbVwiKSxcbiAgICAgICAgICAgIHNjcm9sbFdoZWVsWm9vbTogdHJ1ZSxcbiAgICAgICAgICAgIHByZWZlckNhbnZhczogdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgY3VzdG9tIHBhbmVzIGZvciBzdHJpY3QgWi1pbmRleCBvcmRlcmluZ1xuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5Z29uc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MTBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5bGluZXNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDIwXCI7XG4gICAgICAgIFxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQzMFwiO1xuXG4gICAgICAgIC8vIExvY2FsIG1pcnJvcnMgb2YgdGhlIGxheWVyIGxpc3QgYW5kIGNvb3JkaW5hdGUgYnVmZmVycy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gUHl0aG9uIHVwZGF0ZXMgdGhlc2UgaW5jcmVtZW50YWxseSB2aWEgXCJzd2lmdG1hcF9wYXRjaFwiIG1lc3NhZ2VzIGluc3RlYWQgb2ZcbiAgICAgICAgLy8gcmVhc3NpZ25pbmcgdGhlIHRyYWl0cywgYmVjYXVzZSBhIHRyYWl0IHJlYXNzaWdubWVudCByZS1zZXJpYWxpemVzIGFuZCByZS1zZW5kc1xuICAgICAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxuICAgICAgICAvLyB3aGVuIGEgdmlldyBhdHRhY2hlcywgYW5kIHRoZSBzaWRlYmFyIHN0aWxsIHdyaXRlcyBgbGF5ZXJzYCBiYWNrIG9uIHRvZ2dsZSwgc29cbiAgICAgICAgLy8gYm90aCBhcmUgc2VlZGVkIGhlcmUgYW5kIGtlcHQgaW4gc3RlcCBieSB0aGUgY2hhbmdlIGhhbmRsZXJzIGZ1cnRoZXIgZG93bi5cbiAgICAgICAgbGV0IGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcblxuICAgICAgICBmdW5jdGlvbiBhcHBseVBhdGNoT3BzKG9wcywgYnVmZmVycykge1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBuZXh0LmxheWVycztcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0gbmV4dC5idWZmZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWN0aXZlVGlsZUxheWVycyA9IHt9O1xuICAgICAgICBjb25zdCBhY3RpdmVPdmVybGF5TGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGdsU3RhdGVzID0ge1xuICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5Z29uOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFRoZSBzaGFyZWQgdGltZSBzbGlkZXIuIGB0aW1lU3RhdGVgIGlzIHdoYXQgcmVuZGVyaW5nIHJlYWRzIC0tIHRoZSBjdXJyZW50IHRpY2tcbiAgICAgICAgLy8gYW5kIHRoZSBwZXJpb2QsIG9yIG51bGwgd2hlbiBub3RoaW5nIGlzIGFuaW1hdGVkIC0tIGFuZCBgdGltZVVJYCBpcyB0aGUgc2xpZGVyJ3NcbiAgICAgICAgLy8gb3duIGJvb2trZWVwaW5nLiBQbGF5YmFjayBuZXZlciByb3VuZC10cmlwcyB0aHJvdWdoIFB5dGhvbjogdGlja3MgcmUtcmVuZGVyXG4gICAgICAgIC8vIGxvY2FsbHksIGFuZCB0aW1lX2N1cnJlbnQgaXMgd3JpdHRlbiBiYWNrIGF0IG1vc3Qgb25jZSBhIHNlY29uZCB3aGlsZSBwbGF5aW5nLlxuICAgICAgICBsZXQgdGltZVN0YXRlID0gbnVsbDtcbiAgICAgICAgY29uc3QgdGltZVVJID0geyB0aWNrczogW10sIGtleTogXCJcIiwgaW5kZXg6IDAsIHBsYXlpbmc6IGZhbHNlLCBsb29wOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBzcGVlZDogMSwgdGltZXI6IG51bGwsIGxhc3RXcml0ZTogMCwgc3RhcnRlZDogZmFsc2UgfTtcblxuICAgICAgICBmdW5jdGlvbiBzdG9wUGxheWJhY2soKSB7XG4gICAgICAgICAgICBpZiAodGltZVVJLnRpbWVyKSBjbGVhckludGVydmFsKHRpbWVVSS50aW1lcik7XG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBudWxsO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHdyaXRlVGltZUN1cnJlbnQoZm9yY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICBpZiAoIWZvcmNlICYmIG5vdyAtIHRpbWVVSS5sYXN0V3JpdGUgPCAxMDAwKSByZXR1cm47XG4gICAgICAgICAgICB0aW1lVUkubGFzdFdyaXRlID0gbm93O1xuICAgICAgICAgICAgaWYgKG1vZGVsLmNvbW0pIHtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ0aW1lX2N1cnJlbnRcIiwgdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc2Vla1RvKGluZGV4LCB7IHdyaXRlID0gdHJ1ZSB9ID0ge30pIHtcbiAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkpO1xuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kIH07XG4gICAgICAgICAgICBpZiAod3JpdGUpIHdyaXRlVGltZUN1cnJlbnQoIXRpbWVVSS5wbGF5aW5nKTtcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHN0YXJ0UGxheWJhY2soKSB7XG4gICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgIHRpbWVVSS5wbGF5aW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIHRpbWVVSS50aW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBuZXh0ID0gYWR2YW5jZSh0aW1lVUkuaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGgsIHRpbWVVSS5sb29wKTtcbiAgICAgICAgICAgICAgICBpZiAoIW5leHQucGxheWluZykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzZWVrVG8obmV4dC5pbmRleCk7XG4gICAgICAgICAgICB9LCAxMDAwIC8gdGltZVVJLnNwZWVkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRpbWVIYW5kbGVycyA9IHtcbiAgICAgICAgICAgIG9uU2VlazogKGluZGV4KSA9PiBzZWVrVG8oaW5kZXgpLFxuICAgICAgICAgICAgb25TdGVwQmFjazogKCkgPT4gc2Vla1RvKHRpbWVVSS5pbmRleCAtIDEpLFxuICAgICAgICAgICAgb25TdGVwRm9yd2FyZDogKCkgPT4gc2Vla1RvKHRpbWVVSS5pbmRleCArIDEpLFxuICAgICAgICAgICAgb25QbGF5VG9nZ2xlOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5wbGF5aW5nKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHN0YXJ0T3ZlciwgYXMgdGhlIGZvbGl1bSBwbGF5ZXIgd2FzIGNvbmZpZ3VyZWQ6IHByZXNzaW5nIHBsYXkgYXRcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCByZXN0YXJ0cyBmcm9tIHRoZSBiZWdpbm5pbmcgaW1tZWRpYXRlbHksIHJhdGhlciB0aGFuIG9uZVxuICAgICAgICAgICAgICAgICAgICAvLyBzaWxlbnQgaW50ZXJ2YWwgbGF0ZXIgZGVjaWRpbmcgdGhlcmUgaXMgbm93aGVyZSB0byBnbyBhbmQgc3RvcHBpbmcuXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aW1lVUkuaW5kZXggPj0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpIHNlZWtUbygwKTtcbiAgICAgICAgICAgICAgICAgICAgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uTG9vcFRvZ2dsZTogKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5sb29wID0gIXRpbWVVSS5sb29wO1xuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25TcGVlZDogKHNwZWVkKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gc3BlZWQ7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5wbGF5aW5nKSBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIENyZWF0ZXMsIHJldHVuZXMgb3IgcmVtb3ZlcyB0aGUgc2xpZGVyIHRvIG1hdGNoIHRoZSBsYXllcnMgcHJlc2VudC4gVGlja3MgYXJlXG4gICAgICAgIC8vIHJlZ2VuZXJhdGVkIG9ubHkgd2hlbiB0aGUgZGF0YSdzIHRpbWUgZXh0ZW50IG9yIHRoZSBwZXJpb2QgY2hhbmdlcywgc28gYVxuICAgICAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVUaW1lRGltZW5zaW9uKCkge1xuICAgICAgICAgICAgaWYgKCFoYXNUaW1lTGF5ZXJzKGxheWVyU3RhdGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHsgdGlja3M6IFtdIH0sIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBcIlwiO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XG4gICAgICAgICAgICBjb25zdCBleHRlbnQgPSBjb2xsZWN0VGltZUV4dGVudChsYXllclN0YXRlLCBidWZmZXJTdGF0ZSk7XG4gICAgICAgICAgICBpZiAoIWV4dGVudCkgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtleHRlbnQubWlufXwke2V4dGVudC5tYXh9fCR7Y2ZnLnBlcmlvZCB8fCBcIlAxRFwifWA7XG4gICAgICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IGtleTtcbiAgICAgICAgICAgICAgICB0aW1lVUkudGlja3MgPSBnZW5lcmF0ZVRpY2tzKGV4dGVudC5taW4sIGV4dGVudC5tYXgsIHBlcmlvZCk7XG4gICAgICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5taW4odGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QgfTtcbiAgICAgICAgICAgIHRpbWVVSS5wb3NpdGlvbiA9IGNmZy5wb3NpdGlvbiB8fCBcInRvcC1jZW50ZXJcIjtcblxuICAgICAgICAgICAgaWYgKCF0aW1lVUkuc3RhcnRlZCkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBjZmcuc3BlZWQgfHwgMTtcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9IEJvb2xlYW4oY2ZnLmxvb3ApO1xuICAgICAgICAgICAgICAgIGlmIChjZmcuYXV0b19wbGF5KSBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2lkZWJhciBMYXllcnMgQ29udHJvbCBVSVxuICAgICAgICBjb25zdCBzaWRlYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgc2lkZWJhci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXNpZGViYXJcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS50b3AgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUubWF4SGVpZ2h0ID0gXCI4MCVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250RmFtaWx5ID0gXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTZWdvZSBVSScsIFJvYm90bywgc2Fucy1zZXJpZlwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHNpZGViYXIpO1xuXG4gICAgICAgIC8vIExvZ29cbiAgICAgICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm90dG9tID0gXCIxMHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBsb2dvRGl2LmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyO1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZS5wbmdcIiBhbHQ9XCJDb21wYW55XCIgc3R5bGU9XCJoZWlnaHQ6IDM1cHg7IG1hcmdpbi1yaWdodDogNXB4O1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZTIucG5nXCIgYWx0PVwiUGFyZW50IENvbXBhbnlcIiBzdHlsZT1cImhlaWdodDogMzVweDtcIj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICBgO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobG9nb0Rpdik7XG5cblxuXG4gICAgICAgIGZ1bmN0aW9uIGdldFRpbGVMYXllcihsYXllcikge1xuICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyKGxheWVyLnVybCwge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0aW9uOiBsYXllci5hdHRyaWJ1dGlvbiB8fCAnJyxcbiAgICAgICAgICAgICAgICBtYXhab29tOiBsYXllci5tYXhfem9vbSB8fCAyMixcbiAgICAgICAgICAgICAgICBtYXhOYXRpdmVab29tOiBsYXllci5tYXhfbmF0aXZlX3pvb20gfHwgMTlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY01hcFN0YXRlKCkge1xuICAgICAgICAgICAgY29uc29sZS50aW1lKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XG4gICAgICAgICAgICB1cGRhdGVUaW1lRGltZW5zaW9uKCk7XG4gICAgICAgICAgICBjb25zdCBsYXllcnMgPSBsYXllclN0YXRlO1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBDb25maWdzID0gbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gYnVmZmVyU3RhdGU7XG5cbiAgICAgICAgICAgIC8vIEVuZm9yY2UgbXV0dWFsbHkgZXhjbHVzaXZlIHJhZGlvIGdyb3VwIHZpc2liaWxpdHkgYmVmb3JlIGNvbGxlY3Rpbmcgb3IgcmVuZGVyaW5nIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgY29uc3QgcmFkaW9DaGFuZ2VkID0gbm9ybWFsaXplUmFkaW9MYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgaWYgKHJhZGlvQ2hhbmdlZCAmJiBtb2RlbC5jb21tICYmIGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwibGF5ZXJzXCIsIFsuLi5sYXllcnNdKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IG1vZGVsLmdldChcInNob3dfbG9nb1wiKSA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xuXG4gICAgICAgICAgICAvLyBHcm91cCB2aXNpYmxlIGxheWVycyAoaW5jbHVkaW5nIHN1Yi1sYXllcnMgaW5zaWRlIGdyb3VwcykgdG8gYWx3YXlzIHVzZSBXZWJHTFxuICAgICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgICAgIGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICBwb2x5bGluZTogd2ViZ2xQb2x5bGluZUxheWVycyxcbiAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMsXG4gICAgICAgICAgICB9ID0gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcblxuICAgICAgICAgICAgLy8gU2V0IG9mIGxheWVyIElEcyBwcm9jZXNzZWQgdmlhIG1lcmdlZCBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGNvbnN0IHdlYmdsTGF5ZXJJZHMgPSBuZXcgU2V0KFtcbiAgICAgICAgICAgICAgICAuLi53ZWJnbENpcmNsZU1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbE1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsUG9seWdvbkxheWVycy5tYXAobCA9PiBsLmlkKVxuICAgICAgICAgICAgXSk7XG5cbiAgICAgICAgICAgIC8vIFJlbW92ZSByZXRpcmVkIG92ZXJsYXkgbGF5ZXJzLCBpbmNsdWRpbmcgdGhvc2UgdGhhdCB0cmFuc2l0aW9uZWQgdG8gV2ViR0xcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGFjdGl2ZU92ZXJsYXlMYXllcnMpLmZvckVhY2goaWQgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghbGF5ZXJzLmZpbmQobCA9PiBsLmlkID09PSBpZCkgfHwgd2ViZ2xMYXllcklkcy5oYXMoaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3Mgbm9uLVdlYkdMIGxheWVyc1xuICAgICAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBlZmZlY3RpdmVWaXNpYmxlID0gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlZmZlY3RpdmVWaXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0aWxlID0gZ2V0VGlsZUxheWVyKGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aWxlLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSA9IHRpbGU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBsYXllcnMgbWFuYWdlZCBieSB0aGUgbWVyZ2VkIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgICAgIGlmICh3ZWJnbExheWVySWRzLmhhcyhsYXllci5pZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFlZmZlY3RpdmVWaXNpYmxlIHx8ICFsYXllckluV2luZG93KGxheWVyLCBidWZmZXJTdGF0ZSwgdGltZVN0YXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmcubGF5ZXJUeXBlICE9PSBsYXllci50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0sIG1vZGVsKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0gPSBpbnN0YW5jZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEhlbHBlciB0byBzeW5jIFdlYkdMIGxheWVyIHN0YXRlcyBhbmQgcmVidWlsZCBvbmx5IGlmIGNoYW5nZWRcbiAgICAgICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZHNTdHJpbmcgPSB2aXNpYmxlTGF5ZXJzLm1hcChsID0+IGwuaWQpLnNvcnQoKS5qb2luKFwiLFwiKTtcbiAgICAgICAgICAgICAgICAvLyBFdmVyeXRoaW5nIHRoZSBidWlsdCBidWZmZXJzIGRlcGVuZCBvbiBiZWxvbmdzIGluIHRoaXMga2V5OiBhIGNoYW5nZSB0aGF0XG4gICAgICAgICAgICAgICAgLy8gaXMgbm90IGluIGl0IHJlbmRlcnMgc3RhbGUuIGhpZ2hsaWdodF9zdHlsZSBhbmQgc3R5bGVfb3ZlcnJpZGVzIHdlcmVcbiAgICAgICAgICAgICAgICAvLyBtaXNzaW5nIGF0IGZpcnN0LCBzbyBhIGhpZ2hsaWdodCBsYW5kZWQgaW4gc3RhdGUgYW5kIG5ldmVyIHJlcGFpbnRlZC5cbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkodmlzaWJsZUxheWVycy5tYXAobCA9PiAoe1xuICAgICAgICAgICAgICAgICAgICBpZDogbC5pZCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IGwuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogbC5yYWRpdXMsXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogbC53ZWlnaHQsXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IGwub3BhY2l0eSxcbiAgICAgICAgICAgICAgICAgICAgZmlsbE9wYWNpdHk6IGwuZmlsbE9wYWNpdHksXG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodDogbC5oaWdobGlnaHRfc3R5bGUsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlczogbC5zdHlsZV9vdmVycmlkZXMsXG4gICAgICAgICAgICAgICAgICAgIGZlYXR1cmVTdHlsZXM6IGwuZmVhdHVyZV9zdHlsZXMsXG4gICAgICAgICAgICAgICAgICAgIHRpbWU6IGwudGltZSxcbiAgICAgICAgICAgICAgICAgICAgdGljazogbC50aW1lICYmIHRpbWVTdGF0ZSA/IHRpbWVTdGF0ZS50aWNrIDogMCxcbiAgICAgICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBsb2NMZW46IGwubG9jYXRpb25zPy5sZW5ndGggfHwgMFxuICAgICAgICAgICAgICAgIH0pKSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlQ2hhbmdlZCA9IHN0YXRlLmlkcyAhPT0gaWRzU3RyaW5nIHx8IHN0YXRlLm1ldGEgIT09IG1ldGFTdHJpbmc7XG5cbiAgICAgICAgICAgICAgICBpZiAoc3RhdGVDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBhd2FpdCByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgdmlzaWJsZUxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsLCB0aW1lU3RhdGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIuYWRkVG8obWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5pZHMgPSBpZHNTdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLm1ldGEgPSBtZXRhU3RyaW5nO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJjaXJjbGVfbWFya2Vyc1wiLCB3ZWJnbENpcmNsZU1hcmtlckxheWVycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcIm1hcmtlcnNcIiwgd2ViZ2xNYXJrZXJMYXllcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCB3ZWJnbFBvbHlsaW5lTGF5ZXJzKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWdvblwiLCB3ZWJnbFBvbHlnb25MYXllcnMpO1xuXG4gICAgICAgICAgICByZW5kZXJTaWRlYmFyQ29udHJvbHMoc2lkZWJhciwgbGF5ZXJzLCBtb2RlbCwgbWFwLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc29sZS50aW1lRW5kKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgbGV0IGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xuXG4gICAgICAgIC8vIEJpbmQgem9vbSBhbmQgY2VudGVyIGNoYW5nZXMgYmFjayB0byBQeXRob24gc2FmZWx5XG4gICAgICAgIG1hcC5vbihcIm1vdmVlbmRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGVsQ2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGVsWm9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtb2RlbFpvb20gIT09IGN1cnJlbnRab29tO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSAhbW9kZWxDZW50ZXIgfHwgXG4gICAgICAgICAgICAgICAgICAgICFBcnJheS5pc0FycmF5KG1vZGVsQ2VudGVyKSB8fFxuICAgICAgICAgICAgICAgICAgICBtb2RlbENlbnRlci5sZW5ndGggPCAyIHx8XG4gICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzBdIC0gY2VudGVyLmxhdCkgPiAwLjAwMDEgfHwgXG4gICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzFdIC0gY2VudGVyLmxuZykgPiAwLjAwMDE7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2VudGVyXCIsIFtjZW50ZXIubGF0LCBjZW50ZXIubG5nXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ6b29tXCIsIGN1cnJlbnRab29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgc2FmZVNhdmVDaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIG1vdmVlbmQgaGFuZGxlcjpcIiwgZXJyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlTWFwVmlldygpIHtcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1vZGVsLmdldChcImNlbnRlclwiKTtcbiAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgaWYgKGNlbnRlciAmJiBBcnJheS5pc0FycmF5KGNlbnRlcikgJiYgY2VudGVyLmxlbmd0aCA+PSAyKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWFwQ2VudGVyID0gbWFwLmdldENlbnRlcigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hcFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSBNYXRoLmFicyhtYXBDZW50ZXIubGF0IC0gY2VudGVyWzBdKSA+IDAuMDAwMSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobWFwQ2VudGVyLmxuZyAtIGNlbnRlclsxXSkgPiAwLjAwMDE7XG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtYXBab29tICE9PSB6b29tO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkIHx8IHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRWaWV3KGNlbnRlciwgdHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgPyB6b29tIDogbWFwWm9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgJiYgbWFwLmdldFpvb20oKSAhPT0gem9vbSkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbSh6b29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYXRjaCBmb3IgbWFwIHZpZXcgdXBkYXRlcyBmcm9tIFB5dGhvblxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpjZW50ZXJcIiwgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwKSB7XG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp6b29tXCIsICgpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nWm9vbUZyb21NYXApIHtcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBGaXR0aW5nIHRoZSB2aWV3IGlzIGEgY29tbWFuZCwgbm90IHN0YXRlOiBhc2tpbmcgdG8gZml0IHRoZSBzYW1lIGJvdW5kcyB0d2ljZVxuICAgICAgICAvLyBtdXN0IG1vdmUgdGhlIG1hcCBib3RoIHRpbWVzLCBzaW5jZSB0aGUgdXNlciBtYXkgaGF2ZSBwYW5uZWQgYXdheSBpbiBiZXR3ZWVuLlxuICAgICAgICAvLyBUaGUgcmVxdWVzdCBjYXJyaWVzIGEgc2VxdWVuY2UgbnVtYmVyIHNvIGFuIGlkZW50aWNhbCBmaXQgc3RpbGwgZmlyZXMgYSBjaGFuZ2UuXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmZpdF9ib3VuZHNfcmVxdWVzdFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCByZXEgPSBtb2RlbC5nZXQoXCJmaXRfYm91bmRzX3JlcXVlc3RcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBib3VuZHMgPSByZXEuYm91bmRzO1xuICAgICAgICAgICAgaWYgKCFib3VuZHMgfHwgYm91bmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBvcHRpb25zID0ge307XG4gICAgICAgICAgICBpZiAocmVxLnBhZGRpbmcgIT0gbnVsbCkgb3B0aW9ucy5wYWRkaW5nID0gW3JlcS5wYWRkaW5nLCByZXEucGFkZGluZ107XG4gICAgICAgICAgICBpZiAocmVxLm1heF96b29tICE9IG51bGwpIG9wdGlvbnMubWF4Wm9vbSA9IHJlcS5tYXhfem9vbTtcbiAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgLy8gQXBwbGllZCBhZnRlciB0aGUgZml0LCBzaW5jZSBpdCBpcyByZWxhdGl2ZSB0byB3aGF0ZXZlciB6b29tIHRoZSBmaXQgY2hvc2UuXG4gICAgICAgICAgICBpZiAocmVxLnpvb21fb2Zmc2V0KSB7XG4gICAgICAgICAgICAgICAgbWFwLnNldFpvb20obWFwLmdldFpvb20oKSArIHJlcS56b29tX29mZnNldCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCBzeW5jVGltZW91dCA9IG51bGw7XG4gICAgICAgIGxldCBpc1N5bmNpbmcgPSBmYWxzZTtcbiAgICAgICAgbGV0IG5lZWRzU3luYyA9IGZhbHNlO1xuXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1TeW5jKCkge1xuICAgICAgICAgICAgaWYgKGlzU3luY2luZykge1xuICAgICAgICAgICAgICAgIG5lZWRzU3luYyA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaXNTeW5jaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgc3luY01hcFN0YXRlKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gc3luY01hcFN0YXRlOlwiLCBlcnIpO1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICBpc1N5bmNpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBpZiAobmVlZHNTeW5jKSB7XG4gICAgICAgICAgICAgICAgICAgIG5lZWRzU3luYyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHF1ZXVlU3luYygpIHtcbiAgICAgICAgICAgIGlmICghbW9kZWwuZ2V0KFwiYXV0b19zeW5jXCIpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHN5bmNUaW1lb3V0KSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lb3V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBudWxsO1xuICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICB9LCA1MCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMaXN0ZW4gZm9yIG1hbnVhbCBzeW5jIHRyaWdnZXIgY2hhbmdlcyBmcm9tIFB5dGhvblxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzeW5jX3RyaWdnZXJcIiwgKCkgPT4ge1xuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSW5jcmVtZW50YWwgdXBkYXRlcyBmcm9tIFB5dGhvbi4gQXBwbGllZCBldmVuIHdoZW4gYXV0b19zeW5jIGlzIG9mZiBzbyB0aGUgbWlycm9yXG4gICAgICAgIC8vIHN0YXlzIGN1cnJlbnQ7IHF1ZXVlU3luYyBkZWNpZGVzIHdoZXRoZXIgdG8gYWN0dWFsbHkgcmUtcmVuZGVyLlxuICAgICAgICBtb2RlbC5vbihcIm1zZzpjdXN0b21cIiwgKG1zZywgYnVmZmVycykgPT4ge1xuICAgICAgICAgICAgaWYgKCFtc2cgfHwgbXNnLmtpbmQgIT09IFwic3dpZnRtYXBfcGF0Y2hcIikgcmV0dXJuO1xuICAgICAgICAgICAgYXBwbHlQYXRjaE9wcyhtc2cub3BzIHx8IFtdLCBidWZmZXJzKTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBGdWxsLXNuYXBzaG90IHBhdGhzOiB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlLCBhbmQgdGhlIHNpZGViYXIgd3JpdGluZyBgbGF5ZXJzYFxuICAgICAgICAvLyBiYWNrIGFmdGVyIGEgdG9nZ2xlLiBFaXRoZXIgd2F5IHRoZSB0cmFpdCBiZWNvbWVzIGF1dGhvcml0YXRpdmUgYWdhaW4uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmxheWVyc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICBsYXllclN0YXRlID0gbW9kZWwuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpjb29yZGluYXRlX2J1ZmZlcnNcIiwgKCkgPT4ge1xuICAgICAgICAgICAgYnVmZmVyU3RhdGUgPSB7IC4uLihtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pIH07XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmdyb3VwX2NvbmZpZ3NcIiwgcXVldWVTeW5jKTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jb25maWdcIiwgKCkgPT4ge1xuICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTsgICAvLyByZS1hcHBseSBzcGVlZC9sb29wL2F1dG9fcGxheSBmcm9tIHRoZSBuZXcgY29uZmlnXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIFB5dGhvbiBzdGVlcmluZyB0aGUgc2xpZGVyOiBzbmFwIHRvIHRoZSBuZWFyZXN0IHRpY2sgYXQgb3IgYWZ0ZXIgdGhlIHJlcXVlc3RlZFxuICAgICAgICAvLyB0aW1lLiBHdWFyZGVkIHNvIHRoZSB3aWRnZXQncyBvd24gd3JpdGViYWNrIGRvZXMgbm90IGxvb3AgdGhyb3VnaCBoZXJlLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2N1cnJlbnRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgd2FudGVkID0gbW9kZWwuZ2V0KFwidGltZV9jdXJyZW50XCIpO1xuICAgICAgICAgICAgaWYgKCF0aW1lU3RhdGUgfHwgIXRpbWVVSS50aWNrcy5sZW5ndGgpIHJldHVybjtcbiAgICAgICAgICAgIGlmIChNYXRoLmFicyh3YW50ZWQgLSB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSkgPCAxKSByZXR1cm47XG4gICAgICAgICAgICBsZXQgaWR4ID0gdGltZVVJLnRpY2tzLmZpbmRJbmRleCh0ID0+IHQgPj0gd2FudGVkKTtcbiAgICAgICAgICAgIGlmIChpZHggPT09IC0xKSBpZHggPSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMTtcbiAgICAgICAgICAgIHNlZWtUbyhpZHgsIHsgd3JpdGU6IGZhbHNlIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19sb2dvXCIsIHF1ZXVlU3luYyk7XG5cbiAgICAgICAgLy8gQW5ub3VuY2UgdGhpcyB2aWV3IHNvIFB5dGhvbiByZXBsaWVzIHdpdGggYSBmdWxsIHNuYXBzaG90LiBMYXllcnMgYWRkZWQgYmVmb3JlXG4gICAgICAgIC8vIHRoZSB2aWV3IGF0dGFjaGVkIHdvdWxkIG90aGVyd2lzZSBiZSBtaXNzaW5nOiB0aGVpciBwYXRjaGVzIHdlcmUgZW1pdHRlZCBpbnRvIGFcbiAgICAgICAgLy8gd2luZG93IHdoZXJlIG5vdGhpbmcgd2FzIGxpc3RlbmluZy5cbiAgICAgICAgaWYgKG1vZGVsLmNvbW0pIHtcbiAgICAgICAgICAgIG1vZGVsLnNlbmQoeyBraW5kOiBcInN3aWZ0bWFwX3JlYWR5XCIgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXNwZWN0IGluaXRpYWwgYXV0b19zeW5jIHN0YXRlIG9yIG1hbnVhbCBzeW5jIHJlcXVlc3RzIHNlbnQgZHVyaW5nIG1hcCBidWlsZGluZ1xuICAgICAgICBpZiAobW9kZWwuZ2V0KFwiYXV0b19zeW5jXCIpIHx8IG1vZGVsLmdldChcInN5bmNfdHJpZ2dlclwiKSA+IDApIHtcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFPLFNBQVMsUUFBUSxJQUFJLEtBQUs7QUFDN0IsTUFBSSxDQUFDLFNBQVMsZUFBZSxFQUFFLEdBQUc7QUFDOUIsVUFBTSxPQUFPLFNBQVMsY0FBYyxNQUFNO0FBQzFDLFNBQUssS0FBSztBQUNWLFNBQUssTUFBTTtBQUNYLFNBQUssT0FBTztBQUNaLGFBQVMsS0FBSyxZQUFZLElBQUk7QUFBQSxFQUNsQztBQUNKO0FBRUEsSUFBTSxnQkFBZ0IsQ0FBQztBQUVoQixTQUFTLE9BQU8sSUFBSSxLQUFLO0FBQzVCLE1BQUksY0FBYyxFQUFFLEdBQUc7QUFDbkIsV0FBTyxjQUFjLEVBQUU7QUFBQSxFQUMzQjtBQUNBLFFBQU0sVUFBVSxJQUFJLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFDN0MsUUFBSSxTQUFTLGVBQWUsRUFBRSxHQUFHO0FBQzdCLGNBQVE7QUFDUjtBQUFBLElBQ0o7QUFDQSxVQUFNLFNBQVMsU0FBUyxjQUFjLFFBQVE7QUFDOUMsV0FBTyxLQUFLO0FBQ1osV0FBTyxNQUFNO0FBQ2IsV0FBTyxTQUFTLE1BQU0sUUFBUTtBQUM5QixXQUFPLFVBQVUsTUFBTSxPQUFPLElBQUksTUFBTSwwQkFBMEIsR0FBRyxFQUFFLENBQUM7QUFDeEUsYUFBUyxLQUFLLFlBQVksTUFBTTtBQUFBLEVBQ3BDLENBQUM7QUFDRCxnQkFBYyxFQUFFLElBQUk7QUFDcEIsU0FBTztBQUNYO0FBRUEsU0FBUyxTQUFTLEtBQUs7QUFDbkIsTUFBSSxDQUFDLElBQUssUUFBTztBQUNqQixRQUFNLElBQUksUUFBUSxNQUFNLEVBQUU7QUFDMUIsTUFBSSxJQUFJLFdBQVcsR0FBRztBQUNsQixVQUFN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
