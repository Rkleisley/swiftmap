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
  const ticks = [startMs];
  let t = startMs;
  if (t >= endMs) return ticks;
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
function effectiveDuration(layer, timeState) {
  return timeState.window || layer.time && layer.time.duration;
}
function layerInWindow(layer, buffers, timeState) {
  if (!layer.time || !timeState) return true;
  const times = timesFor(layer, buffers);
  if (!times || times.length < 2) return true;
  const win = windowFor(timeState.tick, effectiveDuration(layer, timeState), timeState.period);
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
function periodToMs(p) {
  if (!p || p.years || p.months) return null;
  return ((p.weeks * 7 + p.days) * 24 * 3600 + p.hours * 3600 + p.minutes * 60 + p.seconds) * 1e3;
}
function msToPeriodISO(ms) {
  let rest = Math.round(ms / 1e3);
  const h = Math.floor(rest / 3600);
  rest -= h * 3600;
  const m = Math.floor(rest / 60);
  rest -= m * 60;
  let out = "PT";
  if (h) out += `${h}H`;
  if (m) out += `${m}M`;
  if (rest || out === "PT") out += `${rest}S`;
  return out;
}
function gcdGridMs(periodMs, durationsMs) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  let grid = periodMs;
  for (const d of durationsMs) {
    if (d > 0) grid = gcd(grid, Math.round(d));
  }
  return Math.max(grid, 1e3);
}
function collectDurationsMs(layers, windowIso) {
  const out = [];
  const visit = (list) => list.forEach((l) => {
    if (l.type === "group") return visit(l.layers || []);
    const spec = l.time && l.time.duration;
    if (typeof spec === "string" && spec !== "period") {
      const ms = periodToMs(parsePeriod(spec));
      if (ms) out.push(ms);
    }
  });
  visit(layers);
  if (windowIso) {
    const ms = periodToMs(parsePeriod(windowIso));
    if (ms) out.push(ms);
  }
  return out;
}
function buildRuler(ticks, gridMs, formatLabel, { maxLabels = 6, maxMinors = 240 } = {}) {
  if (ticks.length < 2) return [];
  const t0 = ticks[0], span = ticks[ticks.length - 1] - t0;
  const marks = [];
  const labelEvery = Math.max(1, Math.ceil(ticks.length / maxLabels));
  ticks.forEach((t, i) => marks.push({
    fraction: (t - t0) / span,
    major: true,
    label: i % labelEvery === 0 ? formatLabel(t) : null
  }));
  if (gridMs && gridMs < span) {
    const total = Math.floor(span / gridMs);
    const thin = Math.max(1, Math.ceil(total / maxMinors));
    for (let k = 1; k * gridMs < span; k += thin) {
      const t = t0 + k * gridMs;
      if (ticks.includes(t)) continue;
      marks.push({ fraction: (t - t0) / span, major: false, label: null });
    }
  }
  return marks;
}
function formatTickLabel(ms, periodMs) {
  const iso = new Date(ms).toISOString();
  if (periodMs != null && periodMs < 60 * 1e3) return iso.slice(11, 19);
  if (periodMs != null && periodMs < 24 * 3600 * 1e3) return iso.slice(11, 16);
  return iso.slice(5, 10);
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
            <span class="swiftmap-time-track">
                <span class="swiftmap-time-base"></span>
                <span class="swiftmap-time-span"></span>
                <span class="swiftmap-time-ruler"></span>
                <input class="swiftmap-time-slider" type="range" min="0" step="1">
                <span class="swiftmap-time-trail" role="slider" tabindex="0"
                      aria-label="Trailing window" title="Drag back to widen the time window; drop on the thumb to clear"></span>
            </span>
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
    attachTrailDrag(el, handlers);
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
  renderTrack(el, state);
  applyPosition(el, state.position);
  return el;
}
function trackFraction(ticks, t) {
  const span = ticks[ticks.length - 1] - ticks[0];
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (t - ticks[0]) / span));
}
function renderTrack(el, state) {
  const { ticks, index } = state;
  const track = el.querySelector(".swiftmap-time-track");
  track._state = state;
  const thumbT = ticks[index];
  const periodMs = state.periodMs;
  const windowMs = state.window ? periodToMs(parsePeriod(state.window)) : null;
  const shownMs = windowMs != null ? windowMs : periodMs;
  const span = el.querySelector(".swiftmap-time-span");
  const right = trackFraction(ticks, thumbT);
  const left = shownMs != null ? trackFraction(ticks, thumbT - shownMs) : 0;
  span.style.left = `${(left * 100).toFixed(2)}%`;
  span.style.width = `${(Math.max(0, right - left) * 100).toFixed(2)}%`;
  span.classList.toggle("override", windowMs != null);
  const trail = el.querySelector(".swiftmap-time-trail");
  const at = windowMs != null ? trackFraction(ticks, thumbT - windowMs) : right;
  trail.style.left = `${(at * 100).toFixed(2)}%`;
  trail.classList.toggle("active", windowMs != null);
  trail.setAttribute("aria-valuetext", state.window || "no trailing window");
  trail.style.display = state.gridMs ? "" : "none";
  const ruler = el.querySelector(".swiftmap-time-ruler");
  const key = `${ticks[0]}|${ticks.length}|${state.gridMs}|${periodMs}`;
  if (ruler._key !== key) {
    ruler._key = key;
    ruler.innerHTML = "";
    for (const mark of buildRuler(ticks, state.gridMs, (t) => formatTickLabel(t, periodMs))) {
      const m = document.createElement("span");
      m.className = mark.major ? "swiftmap-time-mark major" : "swiftmap-time-mark";
      m.style.left = `${(mark.fraction * 100).toFixed(2)}%`;
      if (mark.label) {
        const lab = document.createElement("span");
        lab.className = "swiftmap-time-mark-label";
        lab.textContent = mark.label;
        m.appendChild(lab);
      }
      ruler.appendChild(m);
    }
  }
}
function attachTrailDrag(el, handlers) {
  const track = el.querySelector(".swiftmap-time-track");
  const trail = el.querySelector(".swiftmap-time-trail");
  function isoFromEvent(ev) {
    const state = track._state;
    const rect = track.getBoundingClientRect();
    if (!state || !state.gridMs || rect.width === 0) return void 0;
    const frac = Math.min(1, (ev.clientX - rect.left) / rect.width);
    const t0 = state.ticks[0];
    const spanMs = state.ticks[state.ticks.length - 1] - t0;
    const thumbT = state.ticks[state.index];
    const dist = thumbT - (t0 + frac * spanMs);
    const steps = Math.max(0, Math.round(dist / state.gridMs));
    return steps === 0 ? null : msToPeriodISO(steps * state.gridMs);
  }
  trail.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      if (trail.setPointerCapture) trail.setPointerCapture(ev.pointerId);
    } catch (err) {
    }
    const move = (e) => {
      const iso = isoFromEvent(e);
      if (iso !== void 0) handlers.onWindowDrag(iso);
    };
    const finish = (e) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      const iso = isoFromEvent(e);
      if (iso !== void 0) handlers.onWindowCommit(iso);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  });
  trail.addEventListener("keydown", (ev) => {
    const state = track._state;
    if (!state || !state.gridMs) return;
    const current = state.window ? periodToMs(parsePeriod(state.window)) : 0;
    let next;
    if (ev.key === "ArrowLeft") next = current + state.gridMs;
    else if (ev.key === "ArrowRight") next = Math.max(0, current - state.gridMs);
    else if (ev.key === "Delete" || ev.key === "Home") next = 0;
    else return;
    ev.preventDefault();
    handlers.onWindowCommit(next > 0 ? msToPeriodISO(next) : null);
  });
}

// src/gputime.js
var ALWAYS = 63e7;
var LAYER_SLOTS = 64;
var gpuOk = true;
function gpuTimeAvailable() {
  return gpuOk;
}
function disableGpuTime(reason) {
  if (gpuOk) console.warn(`[SwiftMap] GPU time filtering disabled: ${reason}. Falling back to rebuild-per-tick.`);
  gpuOk = false;
}
var vectorGpuOk = true;
function vectorGpuAvailable() {
  return vectorGpuOk;
}
function disableVectorGpu(reason) {
  if (vectorGpuOk) console.warn(`[SwiftMap] GPU time for lines/polygons disabled: ${reason}. Falling back to rebuild-per-tick for those buckets.`);
  vectorGpuOk = false;
}
function timeVertexShader() {
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
function durationSeconds(spec, periodMs) {
  if (spec === null || spec === void 0) return ALWAYS;
  if (spec === "period") return (periodMs || 24 * 3600 * 1e3) / 1e3;
  const ms = periodToMs(parsePeriod(spec));
  return ms ? ms / 1e3 : (periodMs || 24 * 3600 * 1e3) / 1e3;
}
function buildTimeAttributes(layersList, coordinateBuffers, periodMs) {
  let total = 0;
  let hasTime = false;
  const perLayer = [];
  for (const layer of layersList) {
    const buf = coordinateBuffers[layer.id];
    const count = buf ? buf.byteLength / 16 : layer.location ? 1 : 0;
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
    const signedDur = layer.time && layer.time.fade ? -dur : dur;
    for (let i = 0; i < count; i++) {
      const start = times ? times[i * 2] : NaN;
      const end = times ? times[i * 2 + 1] : NaN;
      if (Number.isNaN(start)) {
        spans[out * 2] = -ALWAYS;
        spans[out * 2 + 1] = ALWAYS;
        durs[out] = ALWAYS;
      } else {
        spans[out * 2] = (start - base) / 1e3;
        spans[out * 2 + 1] = (end - base) / 1e3;
        durs[out] = signedDur;
      }
      layerIdx[out] = idx;
      out++;
    }
  }
  return { hasTime: true, base, spans, durs, layerIdx, layerIds, count: total };
}
function buildVectorTimeMeta(layersList, coordinateBuffers, periodMs) {
  if (!layersList.some((l) => l.time)) return { hasTime: false };
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
    return {
      start: (times[0] - base) / 1e3,
      end: (times[1] - base) / 1e3,
      dur: signedDur,
      idx
    };
  });
  return { hasTime: true, base, perFeature, layerIds: layersList.map((l) => l.id) };
}
function expandPerFeature(perFeature, counts) {
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
var FLOATS_PER_VERTEX = 6;
function attachTimeToVectorInstance(instance, meta, counts) {
  try {
    if (!Array.isArray(counts) || counts.length !== meta.perFeature.length) {
      throw new Error(`expected ${meta.perFeature.length} vertex counts, got ${counts && counts.length}`);
    }
    const expected = counts.reduce((a, b) => a + b, 0) * FLOATS_PER_VERTEX;
    const actual = instance.allVerticesTyped ? instance.allVerticesTyped.length : Array.isArray(instance.vertices) ? instance.vertices.length : -1;
    if (actual !== expected) {
      throw new Error(`vertex count mismatch: geometry says ${expected} floats, the instance holds ${actual}`);
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
function attachTimeToInstance(instance, attrs) {
  try {
    return wireTimeAttributes(instance, attrs);
  } catch (err) {
    disableGpuTime(err.message);
    return null;
  }
}
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
    const visLoc = gl.getUniformLocation(program, "uLayerVis") || gl.getUniformLocation(program, "uLayerVis[0]");
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
    gl.uniform1f(tickLoc, ALWAYS);
    gl.uniform1f(overrideLoc, -1);
    gl.uniform1fv(visLoc, new Float32Array(LAYER_SLOTS).fill(1));
    return {
      layerIds: attrs.layerIds,
      // tickMs in epoch ms; overrideMs a shared-window width or null.
      setWindow(tickMs, overrideMs) {
        gl.useProgram(program);
        gl.uniform1f(tickLoc, tickMs === null ? ALWAYS : (tickMs - attrs.base) / 1e3);
        gl.uniform1f(overrideLoc, overrideMs === null ? -1 : overrideMs / 1e3);
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
      }
    };
  }
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
async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, model, timeState = null, vectorGpu = false) {
  const vectorMeta = vectorGpu && type !== "circle_markers" && type !== "markers" ? buildVectorTimeMeta(
    layersList,
    coordinateBuffers,
    timeState && timeState.period ? periodToMs(timeState.period) : null
  ) : { hasTime: false };
  const vectorTime = Boolean(vectorMeta.hasTime);
  if (timeState && !vectorTime && type !== "circle_markers" && type !== "markers") {
    layersList = layersList.filter((l) => layerInWindow(l, coordinateBuffers, timeState));
    if (layersList.length === 0) return null;
  }
  if (type === "polyline") {
    const features = [];
    const vertexCounts = [];
    for (const layer of layersList) {
      const geojsonCoords = layer.locations.map((c) => [c[1], c[0]]);
      vertexCounts.push(Math.max(0, 2 * (geojsonCoords.length - 1)));
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
        const lineOptions = vectorTime ? { vertexShaderSource: () => timeVertexShader() } : {};
        this.glLines = L.glify.lines({
          ...lineOptions,
          map: m,
          data: geojson,
          pane: "polylinesPane",
          // The data above is GeoJSON, whose coordinates are [lon, lat]; glify
          // defaults to latitude-first and its LINE vertex builder reads
          // coordinates through these keys -- unset, it took longitude as
          // latitude and projected every line off-viewport. Silently: no GL
          // error, a healthy canvas, zero fragments. Set per instance rather
          // than on the L.glify global, which another library could also
          // mutate. The polygon path is deliberately NOT given these keys:
          // it triangulates via earcut on the GeoJSON directly, native
          // [lon, lat], and keys there would transpose it the same way.
          // Found by the Valhalla-VRE bug report, driving the plain-JS
          // bundle where no points masked the blank lines.
          latitudeKey: 1,
          longitudeKey: 0,
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
                try {
                  model.set("clicked_layer_id", layer.id);
                  model.set("selected_index", 0);
                  model.save_changes();
                } catch (err) {
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
        if (vectorTime) {
          this._swiftmapTime = attachTimeToVectorInstance(this.glLines, vectorMeta, vertexCounts);
        }
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
    const vertexCounts = [];
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
      if (geojsonCoords.length === 0) {
        vertexCounts.push(0);
        continue;
      }
      const distinct = geojsonCoords.length - 1;
      vertexCounts.push(Math.max(0, 3 * (distinct - 2)));
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
        const shapeOptions = vectorTime ? { vertexShaderSource: () => timeVertexShader() } : {};
        this.glShapes = L.glify.shapes({
          ...shapeOptions,
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
                try {
                  model.set("clicked_layer_id", layer.id);
                  model.set("selected_index", 0);
                  model.save_changes();
                } catch (err) {
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
        if (vectorTime) {
          this._swiftmapTime = attachTimeToVectorInstance(this.glShapes, vectorMeta, vertexCounts);
        }
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
  const gpuAttrs = gpuTimeAvailable() ? buildTimeAttributes(
    layersList,
    coordinateBuffers,
    timeState && timeState.period ? periodToMs(timeState.period) : null
  ) : { hasTime: false };
  const gpuTime = Boolean(gpuAttrs.hasTime);
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
    const win = !gpuTime && timeState && layer.time ? windowFor(timeState.tick, effectiveDuration(layer, timeState), timeState.period) : null;
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
              try {
                model.set("clicked_layer_id", layer.id);
                model.set("selected_index", originalIndex);
                model.save_changes();
              } catch (err) {
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
      if (gpuTime) {
        glifyOptions.vertexShaderSource = () => timeVertexShader();
      }
      this.glPoints = L.glify.points(glifyOptions);
      setupGlifyProjection(this.glPoints);
      if (gpuTime) {
        this._swiftmapTime = attachTimeToInstance(this.glPoints, gpuAttrs);
      }
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
function collectPointLayersAll(layers, groupConfigs) {
  const out = { circle_markers: [], markers: [], polyline: [], polygon: [] };
  function walk(layer, parentVisible, isSub) {
    if (layer.type === "group" && layer.layers) {
      const selfVis = parentVisible && isLayerEffectiveVisible(layer, groupConfigs);
      layer.layers.forEach((sub) => walk(sub, selfVis, true));
      return;
    }
    const bucket = layer.type === "circle" ? "polygon" : layer.type;
    if (!out[bucket]) return;
    const vis = isSub ? parentVisible : parentVisible && isLayerEffectiveVisible(layer, groupConfigs);
    out[bucket].push({ layer, vis });
  }
  for (const layer of layers) walk(layer, true, false);
  return out;
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
      if (document.body.contains(el)) {
        try {
          model.set(key, value);
          model.save_changes();
        } catch (e) {
          originalWarn.call(console, "[SwiftMap] Suppressed sync write error:", e);
        }
      }
    }
    function safeSaveChanges() {
      if (document.body.contains(el)) {
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
      started: false,
      window: null,
      periodMs: null,
      gridMs: null
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
      try {
        model.set("time_current", timeUI.ticks[timeUI.index]);
        model.save_changes();
      } catch (err) {
      }
    }
    function seekTo(index, { write = true } = {}) {
      timeUI.index = Math.max(0, Math.min(index, timeUI.ticks.length - 1));
      timeState = {
        tick: timeUI.ticks[timeUI.index],
        period: timeState.period,
        window: timeUI.window
      };
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
      },
      // Live during the drag: local state and a re-render of the control on every
      // move, but map rebuilds at most every 300ms. At 5M points a rebuild costs
      // seconds, and a drag fires dozens of moves -- unthrottled, the rebuilds
      // stack faster than they finish and the allocation churn crashes the tab.
      onWindowDrag: (iso) => {
        timeUI.dragActive = true;
        timeUI.window = iso;
        if (timeState) timeState = { ...timeState, window: iso };
        renderTimeControl(el, timeUI, timeHandlers);
        const now = Date.now();
        if (now - (timeUI.lastDragSync || 0) >= 300) {
          timeUI.lastDragSync = now;
          queueSync();
        }
      },
      // On release (or a keyboard step): the override lands in time_config so
      // Python and Shiny see the same window the bar shows. null clears the key,
      // handing control back to per-layer durations.
      onWindowCommit: (iso) => {
        timeHandlers.onWindowDrag(iso);
        timeUI.dragActive = false;
        queueSync();
        const cfg = { ...model.get("time_config") || {} };
        if (iso) cfg.window = iso;
        else delete cfg.window;
        try {
          model.set("time_config", cfg);
          model.save_changes();
        } catch (err) {
        }
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
      if (!timeUI.dragActive) {
        timeUI.window = cfg.window && parsePeriod(cfg.window) ? cfg.window : null;
      }
      timeUI.periodMs = periodToMs(period);
      timeUI.gridMs = timeUI.periodMs ? gcdGridMs(timeUI.periodMs, collectDurationsMs(layerState, timeUI.window)) : null;
      timeState = { tick: timeUI.ticks[timeUI.index], period, window: timeUI.window };
      timeUI.position = cfg.position || "top-center";
      if (!timeUI.started) {
        timeUI.started = true;
        timeUI.speed = cfg.speed || 1;
        timeUI.loop = Boolean(cfg.loop);
        if (cfg.auto_play && !timeUI.everStarted) startPlayback();
        timeUI.everStarted = true;
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
      if (radioChanged && document.body.contains(el)) {
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
      async function syncGlLayer(type, visibleLayers, vectorGpu = false) {
        const idsString = visibleLayers.map((l) => l.id).sort().join(",");
        const gpuPoints = (type === "circle_markers" || type === "markers") && gpuTimeAvailable() || vectorGpu;
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
          gpu: gpuPoints,
          tick: l.time && timeState && !gpuPoints ? timeState.tick : 0,
          win: l.time && timeState && !gpuPoints ? timeState.window : null,
          per: l.time && gpuPoints && timeState ? JSON.stringify(timeState.period) : null,
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
            state.layer = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, model, timeState, vectorGpu);
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
      const allByType = collectPointLayersAll(layers, groupConfigs);
      const bucket = {
        circle_markers: webglCircleMarkerLayers,
        markers: webglMarkerLayers,
        polyline: webglPolylineLayers,
        polygon: webglPolygonLayers
      };
      const vectorGpuBucket = { polyline: false, polygon: false };
      for (const type of ["circle_markers", "markers", "polyline", "polygon"]) {
        const entries = allByType[type];
        const isPoints = type === "circle_markers" || type === "markers";
        const available = isPoints ? gpuTimeAvailable() : vectorGpuAvailable();
        const gpuVis = available && entries.length > 0 && entries.length <= LAYER_SLOTS && entries.some((e) => e.layer.time);
        glStates[type].visVector = gpuVis ? entries.map((e) => e.vis ? 1 : 0) : null;
        if (gpuVis) bucket[type] = entries.map((e) => e.layer);
        if (!isPoints) vectorGpuBucket[type] = gpuVis;
      }
      await syncGlLayer("circle_markers", bucket.circle_markers);
      await syncGlLayer("markers", bucket.markers);
      await syncGlLayer("polyline", bucket.polyline, vectorGpuBucket.polyline);
      await syncGlLayer("polygon", bucket.polygon, vectorGpuBucket.polygon);
      for (const type of ["circle_markers", "markers", "polyline", "polygon"]) {
        const state = glStates[type];
        const handle = state.layer && state.layer._swiftmapTime;
        if (!handle) continue;
        const vis = state.visVector;
        if (vis) {
          const key = vis.join("");
          if (state.visKey !== key) {
            state.visKey = key;
            handle.setLayerVisibility(vis);
          }
        }
        if (timeState) {
          const overrideMs = timeState.window ? periodToMs(parsePeriod(timeState.window)) : null;
          handle.setWindow(timeState.tick, overrideMs);
        } else {
          handle.setWindow(null, null);
        }
      }
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
    try {
      model.send({ kind: "swiftmap_ready" });
    } catch (err) {
    }
    if (model.get("auto_sync") || model.get("sync_trigger") > 0) {
      performSync();
    }
  }
};
export {
  applySwiftmapPatch,
  collectPointLayersAll,
  collectWebglLayers,
  map_default as default,
  isLayerEffectiveVisible
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvZ3B1dGltZS5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9tYXAuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBmdW5jdGlvbiBsb2FkQ1NTKGlkLCB1cmwpIHtcbiAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICBjb25zdCBsaW5rID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImxpbmtcIik7XG4gICAgICAgIGxpbmsuaWQgPSBpZDtcbiAgICAgICAgbGluay5yZWwgPSBcInN0eWxlc2hlZXRcIjtcbiAgICAgICAgbGluay5ocmVmID0gdXJsO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKGxpbmspO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlTG9hZGVycyA9IHt9O1xuXG5leHBvcnQgZnVuY3Rpb24gbG9hZEpTKGlkLCB1cmwpIHtcbiAgICBpZiAoYWN0aXZlTG9hZGVyc1tpZF0pIHtcbiAgICAgICAgcmV0dXJuIGFjdGl2ZUxvYWRlcnNbaWRdO1xuICAgIH1cbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNjcmlwdFwiKTtcbiAgICAgICAgc2NyaXB0LmlkID0gaWQ7XG4gICAgICAgIHNjcmlwdC5zcmMgPSB1cmw7XG4gICAgICAgIHNjcmlwdC5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgICAgIHNjcmlwdC5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgc2NyaXB0OiAke3VybH1gKSk7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc2NyaXB0KTtcbiAgICB9KTtcbiAgICBhY3RpdmVMb2FkZXJzW2lkXSA9IHByb21pc2U7XG4gICAgcmV0dXJuIHByb21pc2U7XG59XG5cbmZ1bmN0aW9uIGhleFRvUmdiKGhleCkge1xuICAgIGlmICghaGV4KSByZXR1cm4gbnVsbDtcbiAgICBoZXggPSBoZXgucmVwbGFjZSgvXiMvLCAnJyk7XG4gICAgaWYgKGhleC5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgaGV4ID0gaGV4LnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyICsgY2hhcikuam9pbignJyk7XG4gICAgfVxuICAgIGlmIChoZXgubGVuZ3RoICE9PSA2KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBudW0gPSBwYXJzZUludChoZXgsIDE2KTtcbiAgICByZXR1cm4ge1xuICAgICAgICByOiAoKG51bSA+PiAxNikgJiAyNTUpIC8gMjU1LFxuICAgICAgICBnOiAoKG51bSA+PiA4KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGI6IChudW0gJiAyNTUpIC8gMjU1XG4gICAgfTtcbn1cblxubGV0IGNvbG9yUHJvYmUgPSBudWxsO1xuXG4vLyBCcm93c2VycyBzaGlwIGEgY29tcGxldGUgQ1NTIGNvbG9yIHBhcnNlciAtLSBldmVyeSBuYW1lZCBjb2xvciwgcmdiKCksIGhzbCgpLCBod2IoKS5cbi8vIEJvcnJvdyBpdCBpbnN0ZWFkIG9mIG1haW50YWluaW5nIGEgbG9va3VwIHRhYmxlLiBSZXR1cm5zIG51bGwgb3V0c2lkZSBhIERPTSAoTm9kZSB0ZXN0cyksXG4vLyB3aGVyZSB0aGUgaGV4IGZhbGxiYWNrIGluIHBhcnNlQ29sb3Igc3RpbGwgYXBwbGllcy5cbmZ1bmN0aW9uIGNzc0NvbG9yVG9SZ2IodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIGRvY3VtZW50ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIWNvbG9yUHJvYmUpIGNvbG9yUHJvYmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpLmdldENvbnRleHQoXCIyZFwiKTtcblxuICAgIC8vIEFzc2lnbmluZyBhbiBpbnZhbGlkIGNvbG9yIGxlYXZlcyBmaWxsU3R5bGUgdW50b3VjaGVkLCBzbyBwcm9iZSBhZ2FpbnN0IHR3byBkaWZmZXJlbnRcbiAgICAvLyBzZW50aW5lbHM6IG9ubHkgYSB2YWx1ZSB0aGUgYnJvd3NlciBhY3R1YWxseSBwYXJzZWQgcHJvZHVjZXMgdGhlIHNhbWUgcmVzdWx0IHR3aWNlLlxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjMDAwMDAwXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBjb25zdCBmaXJzdCA9IGNvbG9yUHJvYmUuZmlsbFN0eWxlO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjZmZmZmZmXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBpZiAoZmlyc3QgIT09IGNvbG9yUHJvYmUuZmlsbFN0eWxlKSByZXR1cm4gbnVsbDtcblxuICAgIGlmIChmaXJzdC5zdGFydHNXaXRoKFwiI1wiKSkgcmV0dXJuIGhleFRvUmdiKGZpcnN0KTtcbiAgICBjb25zdCBtYXRjaCA9IGZpcnN0Lm1hdGNoKC9yZ2JhP1xcKChbXildKylcXCkvKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXJ0cyA9IG1hdGNoWzFdLnNwbGl0KFwiLFwiKS5tYXAocCA9PiBwYXJzZUZsb2F0KHAudHJpbSgpKSk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMgfHwgcGFydHMuc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyByOiBwYXJ0c1swXSAvIDI1NSwgZzogcGFydHNbMV0gLyAyNTUsIGI6IHBhcnRzWzJdIC8gMjU1IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbG9yKGNvbG9yU3RyLCBmYWxsYmFja0hleCA9IFwiIzMzODhmZlwiKSB7XG4gICAgaWYgKCFjb2xvclN0cikgY29sb3JTdHIgPSBmYWxsYmFja0hleDtcbiAgICByZXR1cm4gY3NzQ29sb3JUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgaGV4VG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGNzc0NvbG9yVG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IGhleFRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcbn1cblxuY29uc3QgVVJMX0FUVFJfQkVGT1JFID0gLyg/OmhyZWZ8c3JjKVxccyo9XFxzKlsnXCJdPyQvaTtcbmNvbnN0IFNBRkVfVVJMID0gL14oPzpodHRwcz86XFwvXFwvfG1haWx0bzp8dGVsOnxkYXRhOmltYWdlXFwvfFsuLyM/XXxbXFx3Li1dKyg/OlsvPyNdfCQpKS9pO1xuXG4vLyBQcm9wZXJ0eSB2YWx1ZXMgY29tZSBmcm9tIHVzZXIgZGF0YSBhbmQgZW5kIHVwIGluIGlubmVySFRNTCwgc28gdGhleSBhcmUgZXNjYXBlZC5cbi8vIE1hcmt1cCB0aGUgYXBwIGF1dGhvciB3cm90ZSAodGVtcGxhdGVzLCBzdHlsZSBzdHJpbmdzKSBpcyBsZWZ0IGludGFjdC5cbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVIdG1sKHZhbHVlKSB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSlcbiAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxuICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXG4gICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxuICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMzk7XCIpO1xufVxuXG4vLyBFc2NhcGluZyBzdG9wcyBhdHRyaWJ1dGUgYnJlYWtvdXQgYnV0IG5vdCBcImphdmFzY3JpcHQ6XCIgaW4gYW4gaHJlZiwgc28gdmFsdWVzIGxhbmRpbmdcbi8vIGluIGEgVVJMIGF0dHJpYnV0ZSBnZXQgYSBzY2hlbWUgY2hlY2suIENvbnRyb2wgY2hhcmFjdGVycyBhcmUgc3RyaXBwZWQgZmlyc3QgYmVjYXVzZVxuLy8gXCJqYXZhXFx0c2NyaXB0OlwiIHN1cnZpdmVzIGEgbmFpdmUgY29tcGFyaXNvbi5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlKSB7XG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcbiAgICByZXR1cm4gU0FGRV9VUkwudGVzdChjb2xsYXBzZWQpID8gU3RyaW5nKHZhbHVlKSA6IFwiXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIGNvbnN0IHRhcmdldEZpZWxkcyA9IChBcnJheS5pc0FycmF5KGZpZWxkcykgJiYgZmllbGRzLmxlbmd0aCkgPyBmaWVsZHMgOiBPYmplY3Qua2V5cyhwcm9wcyk7XG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcbiAgICBjb25zdCBsaW5lcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGFyZ2V0RmllbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XG4gICAgICAgIGlmIChwcm9wc1tmXSA9PT0gdW5kZWZpbmVkIHx8IHByb3BzW2ZdID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgbGluZXMucHVzaChgPGI+JHtlc2NhcGVIdG1sKGxhYmVsc1tpXSl9PC9iPjogJHtlc2NhcGVIdG1sKHByb3BzW2ZdKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oXCI8YnI+XCIpO1xufVxuXG4vLyBcIntjb2x1bW59XCIgaW5zZXJ0cyBvbmUgZXNjYXBlZCB2YWx1ZTsgXCJ7Kn1cIiBpbnNlcnRzIHRoZSBkZWZhdWx0IGZpZWxkIGxpc3QuXG5mdW5jdGlvbiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiKlwiKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BzW2tleV07XG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHJldHVybiBcIlwiO1xuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XG4gICAgICAgIHJldHVybiBlc2NhcGVIdG1sKFVSTF9BVFRSX0JFRk9SRS50ZXN0KHByZWNlZGluZykgPyBzYWZlVXJsKHZhbCkgOiB2YWwpO1xuICAgIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIGtpbmQpIHtcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGxheWVyW2tpbmQgKyBcIl90ZW1wbGF0ZVwiXTtcbiAgICBjb25zdCBmaWVsZHMgPSBsYXllcltraW5kICsgXCJfZmllbGRzXCJdO1xuICAgIGNvbnN0IG5hbWVzID0gbGF5ZXJba2luZCArIFwiX25hbWVzXCJdO1xuICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgPT09IFwic3RyaW5nXCIgJiYgdGVtcGxhdGUpIHtcbiAgICAgICAgcmV0dXJuIHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBwcm9wcywgZmllbGRzLCBuYW1lcyk7XG4gICAgfVxuICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XG59XG5cbmZ1bmN0aW9uIHdyYXBTdHlsZWQoaHRtbCwgc3R5bGUpIHtcbiAgICBpZiAoIXN0eWxlKSByZXR1cm4gaHRtbDtcbiAgICByZXR1cm4gYDxkaXYgc3R5bGU9XCIke2VzY2FwZUh0bWwoc3R5bGUpfVwiPiR7aHRtbH08L2Rpdj5gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFBvcHVwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwicG9wdXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3BvcHVwIHx8IGxheWVyLnBvcHVwX2ZpZWxkcyB8fCBsYXllci5wb3B1cF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICBpZiAobGF5ZXIucG9wdXBfbWF4X3dpZHRoKSBvcHRpb25zLm1heFdpZHRoID0gbGF5ZXIucG9wdXBfbWF4X3dpZHRoO1xuICAgICAgICBMLnBvcHVwKG9wdGlvbnMpXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIucG9wdXBfc3R5bGUpKVxuICAgICAgICAgICAgLm9wZW5PbihtYXApO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRUb29sdGlwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIsIGxheWVySW5zdGFuY2UpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwidG9vbHRpcFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfdG9vbHRpcCB8fCBsYXllci50b29sdGlwX2ZpZWxkcyB8fCBsYXllci50b29sdGlwX3RlbXBsYXRlKSkge1xuICAgICAgICBpZiAoIWxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXAgPSBMLnRvb2x0aXAoeyBkaXJlY3Rpb246ICd0b3AnLCBvZmZzZXQ6IFswLCAtNV0gfSk7XG4gICAgICAgIH1cbiAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcFxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnRvb2x0aXBfc3R5bGUpKVxuICAgICAgICAgICAgLmFkZFRvKG1hcCk7XG4gICAgfVxufVxuIiwgImNvbnN0IGNvbGxhcHNlZFBhdGhzID0ge307ICAvLyBwYXRoIC0+IGNvbGxhcHNlZD9cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllckJvdW5kcyhsLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKCFsKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAvLyBTdXBwb3J0IGZvbGRlciB0cmVlIG5vZGVzIChncm91cHMgaW4gc2lkZWJhciB0cmVlKVxyXG4gICAgaWYgKGwuaXNHcm91cCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkcmVuIGdyb3Vwc1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGwuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGwuY2hpbGRyZW5ba2V5XSwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZCBsYXllcnNcclxuICAgICAgICBsLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhseXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGwuYm91bmRzICYmIGwuYm91bmRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICByZXR1cm4gbC5ib3VuZHM7XHJcbiAgICB9XHJcbiAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgbC5sYXllcnMpIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsLmxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMoc3ViLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChsLmxvY2F0aW9ucyAmJiBsLmxvY2F0aW9ucy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgY29uc3QgY29vcmRzID0gbC5sb2NhdGlvbnMuZmxhdChJbmZpbml0eSk7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2ldO1xyXG4gICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSArIDFdO1xyXG4gICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF07XHJcbiAgICAgICAgaWYgKGJ1Zikge1xyXG4gICAgICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KGJ1Zi5idWZmZXIsIGJ1Zi5ieXRlT2Zmc2V0LCBidWYuYnl0ZUxlbmd0aCAvIDgpO1xyXG4gICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aCAvIDI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2kgKiAyXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgbW9kZWxOZWVkc1VwZGF0ZSA9IGZhbHNlO1xyXG4gICAgZnVuY3Rpb24gZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZiA9IGdyb3VwQ29uZmlnc1tub2RlLnBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNSYWRpb0dyb3VwID0gY29uZi5tdWx0aV9zZWxlY3QgPT09IGZhbHNlO1xyXG4gICAgICAgIGlmIChpc1JhZGlvR3JvdXApIHtcclxuICAgICAgICAgICAgbGV0IGZvdW5kQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkR3JvdXAgPSBub2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBseXIudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZS5jaGlsZHJlbltrZXldKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXModHJlZSk7XHJcbiAgICByZXR1cm4gbW9kZWxOZWVkc1VwZGF0ZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYWdhaW5zdCB0aGUgbGlzdCB0aGlzIHNpZGViYXIgcmVuZGVyZWQgZnJvbSwgbmV2ZXIgbW9kZWwuZ2V0KFwibGF5ZXJzXCIpLlxyXG4gICAgICAgICAgICAgICAgLy8gTGF5ZXJzIGFkZGVkIGFmdGVyIHRoZSB3aWRnZXQgaXMgZGlzcGxheWVkIGFycml2ZSBhcyBwYXRjaGVzIHRoYXQgdXBkYXRlIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gZnJvbnRlbmQncyBsb2NhbCBzdGF0ZSB3aXRob3V0IHRvdWNoaW5nIHRoZSB0cmFpdCwgc28gdGhlIG1vZGVsJ3MgY29weSBpc1xyXG4gICAgICAgICAgICAgICAgLy8gZnJvemVuIGF0IHdoYXRldmVyIHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgY2FycmllZC4gQnVpbGRpbmcgdGhlIHVwZGF0ZSBmcm9tXHJcbiAgICAgICAgICAgICAgICAvLyBpdCBkcm9wcyBldmVyeSBsYXRlciBsYXllcjogdGhlIHRvZ2dsZSBtYXRjaGVzIG5vIGlkLCB3cml0ZXMgdGhlIHN0YWxlIGxpc3RcclxuICAgICAgICAgICAgICAgIC8vIGJhY2ssIGFuZCB0aGUgY2hhbmdlIGhhbmRsZXIgdGhlbiByZXNldHMgbG9jYWwgc3RhdGUgdG8gaXQgLS0gc28gdGhlIGJveFxyXG4gICAgICAgICAgICAgICAgLy8gcmUtY2hlY2tzIGl0c2VsZiBhbmQgdGhlIGxheWVyIG5ldmVyIGhpZGVzLlxyXG4gICAgICAgICAgICAgICAgbGV0IHVwZGF0ZWRMYXllcnMgPSBbLi4ubGF5ZXJzXTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSYWRpbyBidXR0b24gbG9naWM6IHNldCBhbGwgc2libGluZ3MgdG8gdmlzaWJsZT1mYWxzZSwgYW5kIHRoaXMgdG8gdmlzaWJsZT10cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMocGFyZW50Tm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJHcm91cCA9IHBhcmVudE5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gc2liR3JvdXAucGF0aCA9PT0gcGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmUgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3NpYkdyb3VwLnBhdGhdID0gIWFjdGl2ZTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBwYXJlbnROb2RlLmxheWVycy5mb3JFYWNoKHNpYkx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkx5ci5pZCA9PT0gaWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRMYXllcnMgPSB1cGRhdGVkTGF5ZXJzLm1hcChvcmlnTGF5ZXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9yaWdMYXllci5pZCA9PT0gc2liTHlyLmlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5vcmlnTGF5ZXIsIHZpc2libGU6IGFjdGl2ZSB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9yaWdMYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1twYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBpc0NoZWNrZWQgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVkTGF5ZXJzID0gdXBkYXRlZExheWVycy5tYXAob3JpZ0xheWVyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcmlnTGF5ZXIuaWQgPT09IGlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4ub3JpZ0xheWVyLCB2aXNpYmxlOiBpc0NoZWNrZWQgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBvcmlnTGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJsYXllcnNcIiwgdXBkYXRlZExheWVycyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldExheWVyQm91bmRzKG5vZGUsIG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb25MYXllclRvZ2dsZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcmVudEVsLmFwcGVuZENoaWxkKG5vZGVEaXYpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbmRlciB0cmVlIGZyb20gcm9vdCBub2RlXHJcbiAgICByZW5kZXJOb2RlKHRyZWUsIHNpZGViYXIsIDAsIG51bGwsIHRydWUpO1xyXG59XHJcbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIC8vIFRoZSBmaXJzdCB0aWNrIHNpdHMgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBub3Qgb25lIHBlcmlvZCBhZnRlciBpdDogd2luZG93c1xuICAgIC8vIGFyZSBoYWxmLW9wZW4gKHN0YXJ0LCBlbmRdLCBzbyBhIGZpcnN0IHRpY2sgYXQgc3RhcnQrUCB3b3VsZCBleGNsdWRlIHRoZSBlYXJsaWVzdFxuICAgIC8vIHBvaW50IGZyb20gaXRzIG93biB3aW5kb3cgYW5kIGl0IHdvdWxkIG5ldmVyIGRpc3BsYXkgYXQgYW55IHRpY2suXG4gICAgY29uc3QgdGlja3MgPSBbc3RhcnRNc107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xuICAgICAgICB0aWNrcy5wdXNoKHQpO1xuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XG4gICAgcmV0dXJuIHRpY2tzO1xufVxuXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2Vcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgfVxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xufVxuXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xufVxuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG59XG5cbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cbi8vXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgcmV0dXJuIGZlYXR1cmVJbldpbmRvdyh0aW1lc1swXSwgdGltZXNbMV0sIHdpbik7XG59XG5cbi8vIFRoZSBleHRlbnQgb2YgZXZlcnkgdGltZSBsYXllcidzIG9ic2VydmF0aW9ucywgTmFOLWJsaW5kLiBGZWVkcyB0aWNrIGdlbmVyYXRpb24uXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJzLCBidWZmZXJzKSB7XG4gICAgbGV0IG1pbiA9IEluZmluaXR5LCBtYXggPSAtSW5maW5pdHk7XG4gICAgY29uc3QgdmlzaXQgPSAobGlzdCkgPT4gbGlzdC5mb3JFYWNoKGxheWVyID0+IHtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIikgcmV0dXJuIHZpc2l0KGxheWVyLmxheWVycyB8fCBbXSk7XG4gICAgICAgIGlmICghbGF5ZXIudGltZSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcbiAgICAgICAgaWYgKCF0aW1lcykgcmV0dXJuO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSkgY29udGludWU7XG4gICAgICAgICAgICBpZiAodGltZXNbaV0gPCBtaW4pIG1pbiA9IHRpbWVzW2ldO1xuICAgICAgICAgICAgaWYgKHRpbWVzW2kgKyAxXSA+IG1heCkgbWF4ID0gdGltZXNbaSArIDFdO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdmlzaXQobGF5ZXJzKTtcbiAgICByZXR1cm4gbWluID09PSBJbmZpbml0eSA/IG51bGwgOiB7IG1pbiwgbWF4IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNUaW1lTGF5ZXJzKGxheWVycykge1xuICAgIHJldHVybiBsYXllcnMuc29tZShsID0+IGwudHlwZSA9PT0gXCJncm91cFwiXG4gICAgICAgID8gaGFzVGltZUxheWVycyhsLmxheWVycyB8fCBbXSlcbiAgICAgICAgOiBCb29sZWFuKGwudGltZSkpO1xufVxuXG4vLyBPbmUgcGxheWJhY2sgc3RlcDogdGhlIG5leHQgaW5kZXggYW5kIHdoZXRoZXIgcGxheWJhY2sgc3Vydml2ZXMgaXQuIFB1cmUgc28gdGhlIGxvb3Bcbi8vIHNlbWFudGljcyBhcmUgdGVzdGFibGUgd2l0aG91dCBhIHRpbWVyIC0tIGxvb3Bpbmcgd3JhcHMgYW5kIGtlZXBzIHBsYXlpbmcsIHRoZSBlbmRcbi8vIHdpdGhvdXQgbG9vcCBzdG9wcyB3aGVyZSBpdCBpcy5cbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlKGluZGV4LCBsZW5ndGgsIGxvb3ApIHtcbiAgICBpZiAoaW5kZXggPCBsZW5ndGggLSAxKSByZXR1cm4geyBpbmRleDogaW5kZXggKyAxLCBwbGF5aW5nOiB0cnVlIH07XG4gICAgaWYgKGxvb3ApIHJldHVybiB7IGluZGV4OiAwLCBwbGF5aW5nOiB0cnVlIH07XG4gICAgcmV0dXJuIHsgaW5kZXgsIHBsYXlpbmc6IGZhbHNlIH07XG59XG5cbi8vIFdoZXJlIHRoZSBjb250cm9sIHNpdHMsIGFzIGlubGluZSBzdHlsZXMgc28gdGhlIGNob2ljZSB0cmF2ZWxzIHdpdGggdGhlIHN0YXRlIHJhdGhlclxuLy8gdGhhbiBuZWVkaW5nIGEgc3R5bGVzaGVldCBydWxlIHBlciBjb3JuZXIuIEV2ZXJ5IHByb3BlcnR5IGlzIHdyaXR0ZW4gb24gZXZlcnkgcmVuZGVyIC0tXG4vLyBpbmNsdWRpbmcgdGhlIG9uZXMgYSBwb3NpdGlvbiBkb2VzIG5vdCB1c2UgLS0gc28gbW92aW5nIHRoZSBjb250cm9sIGNsZWFycyB0aGUgb2xkXG4vLyBhbmNob3IgaW5zdGVhZCBvZiBhY2N1bXVsYXRpbmcgYm90aC5cbmV4cG9ydCBjb25zdCBQT1NJVElPTlMgPSB7XG4gICAgXCJ0b3AtbGVmdFwiOiAgICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJcIiB9LFxuICAgIFwidG9wLWNlbnRlclwiOiAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcbiAgICBcInRvcC1yaWdodFwiOiAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJsZWZ0LWNlbnRlclwiOiAgIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwicmlnaHQtY2VudGVyXCI6ICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcbiAgICBcImJvdHRvbS1sZWZ0XCI6ICAgeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJib3R0b20tY2VudGVyXCI6IHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLXJpZ2h0XCI6ICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbn07XG5cbmZ1bmN0aW9uIGFwcGx5UG9zaXRpb24oZWwsIHBvc2l0aW9uKSB7XG4gICAgY29uc3Qgc3R5bGVzID0gUE9TSVRJT05TW3Bvc2l0aW9uXSB8fCBQT1NJVElPTlNbXCJ0b3AtY2VudGVyXCJdO1xuICAgIGZvciAoY29uc3QgW3Byb3AsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzdHlsZXMpKSB7XG4gICAgICAgIGVsLnN0eWxlW3Byb3BdID0gdmFsdWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmb3JtYXRVVEMobXMpIHtcbiAgICByZXR1cm4gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTkpLnJlcGxhY2UoXCJUXCIsIFwiIFwiKSArIFwiWlwiO1xufVxuXG4vLyAtLS0gdGhlIHdpbmRvdyBhbmQgdGhlIHJ1bGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEZpeGVkIG1pbGxpc2Vjb25kcyBmb3IgYSBwZXJpb2QsIG9yIG51bGwgd2hlbiBpdCBtb3ZlcyB0aHJvdWdoIHRoZSBjYWxlbmRhciAobW9udGhzLFxuLy8geWVhcnMpIGFuZCBoYXMgbm8gZml4ZWQgd2lkdGguIFRoZSBydWxlciBhbmQgdGhlIGRyYWcgZ3JpZCBuZWVkIGZpeGVkIHdpZHRoczsgY2FsZW5kYXJcbi8vIHBlcmlvZHMgZmFsbCBiYWNrIHRvIHRoZSB0aWNrIHBvc2l0aW9ucyB0aGVtc2VsdmVzLlxuZXhwb3J0IGZ1bmN0aW9uIHBlcmlvZFRvTXMocCkge1xuICAgIGlmICghcCB8fCBwLnllYXJzIHx8IHAubW9udGhzKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDAgKyBwLmhvdXJzICogMzYwMFxuICAgICAgICArIHAubWludXRlcyAqIDYwICsgcC5zZWNvbmRzKSAqIDEwMDA7XG59XG5cbi8vIE1pbGxpc2Vjb25kcyBhcyBhbiBJU084NjAxIGR1cmF0aW9uLCBob3Vycy9taW51dGVzL3NlY29uZHMgb25seSAtLSBQVDI2SCBpcyB2YWxpZCBhbmRcbi8vIGF2b2lkcyBjYWxlbmRhciB1bml0cyBlbnRpcmVseSwgc28gd2hhdCB0aGUgZHJhZyB3cml0ZXMgYWx3YXlzIHBhcnNlcyBiYWNrIGV4YWN0bHkuXG5leHBvcnQgZnVuY3Rpb24gbXNUb1BlcmlvZElTTyhtcykge1xuICAgIGxldCByZXN0ID0gTWF0aC5yb3VuZChtcyAvIDEwMDApO1xuICAgIGNvbnN0IGggPSBNYXRoLmZsb29yKHJlc3QgLyAzNjAwKTsgcmVzdCAtPSBoICogMzYwMDtcbiAgICBjb25zdCBtID0gTWF0aC5mbG9vcihyZXN0IC8gNjApOyByZXN0IC09IG0gKiA2MDtcbiAgICBsZXQgb3V0ID0gXCJQVFwiO1xuICAgIGlmIChoKSBvdXQgKz0gYCR7aH1IYDtcbiAgICBpZiAobSkgb3V0ICs9IGAke219TWA7XG4gICAgaWYgKHJlc3QgfHwgb3V0ID09PSBcIlBUXCIpIG91dCArPSBgJHtyZXN0fVNgO1xuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFRoZSBydWxlcidzIGluY3JlbWVudDogdGhlIGxhcmdlc3Qgc3RlcCB0aGF0IGxhbmRzIG9uIGV2ZXJ5IGJvdW5kYXJ5IHRoZSB1c2VyIGNhbiBjYXJlXG4vLyBhYm91dCAtLSB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWQgZHVyYXRpb24uIEFuIGludGVydmFsIG9mIDFoIHdpdGggYVxuLy8gMi41aCBkdXJhdGlvbiBuZWVkcyAzMC1taW51dGUgbWFya3MgZm9yIHRoZSBkdXJhdGlvbiB0byBzaXQgb24gb25lOyAxaCBhbmQgMmggbmVlZCBvbmx5XG4vLyB0aGUgaG91cnMuIFwiTG93ZXN0IGR1cmF0aW9uXCIgaXMgdGhlIHNwZWNpYWwgY2FzZSB3aGVyZSBvbmUgZGl2aWRlcyB0aGUgb3RoZXIuXG5leHBvcnQgZnVuY3Rpb24gZ2NkR3JpZE1zKHBlcmlvZE1zLCBkdXJhdGlvbnNNcykge1xuICAgIGNvbnN0IGdjZCA9IChhLCBiKSA9PiAoYiA/IGdjZChiLCBhICUgYikgOiBhKTtcbiAgICBsZXQgZ3JpZCA9IHBlcmlvZE1zO1xuICAgIGZvciAoY29uc3QgZCBvZiBkdXJhdGlvbnNNcykge1xuICAgICAgICBpZiAoZCA+IDApIGdyaWQgPSBnY2QoZ3JpZCwgTWF0aC5yb3VuZChkKSk7XG4gICAgfVxuICAgIHJldHVybiBNYXRoLm1heChncmlkLCAxMDAwKTtcbn1cblxuLy8gRXZlcnkgZmluaXRlIGR1cmF0aW9uIGF0dGFjaGVkIHRvIGEgdGltZSBsYXllciwgaW4gbXMsIGZvciB0aGUgZ3JpZC4gXCJwZXJpb2RcIiBhbmQgbnVsbFxuLy8gY29udHJpYnV0ZSBub3RoaW5nIG5ldzsgY2FsZW5kYXIgZHVyYXRpb25zIGNhbm5vdCBqb2luIGEgZml4ZWQtbXMgZ3JpZCBhbmQgYXJlIHNraXBwZWQuXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdER1cmF0aW9uc01zKGxheWVycywgd2luZG93SXNvKSB7XG4gICAgY29uc3Qgb3V0ID0gW107XG4gICAgY29uc3QgdmlzaXQgPSBsaXN0ID0+IGxpc3QuZm9yRWFjaChsID0+IHtcbiAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobC5sYXllcnMgfHwgW10pO1xuICAgICAgICBjb25zdCBzcGVjID0gbC50aW1lICYmIGwudGltZS5kdXJhdGlvbjtcbiAgICAgICAgaWYgKHR5cGVvZiBzcGVjID09PSBcInN0cmluZ1wiICYmIHNwZWMgIT09IFwicGVyaW9kXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzcGVjKSk7XG4gICAgICAgICAgICBpZiAobXMpIG91dC5wdXNoKG1zKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHZpc2l0KGxheWVycyk7XG4gICAgaWYgKHdpbmRvd0lzbykge1xuICAgICAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qod2luZG93SXNvKSk7XG4gICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xuICAgIH1cbiAgICByZXR1cm4gb3V0O1xufVxuXG4vLyBUaWNrIG1hcmtzIGZvciB0aGUgdHJhY2s6IG1ham9ycyBhdCBldmVyeSBpbnRlcnZhbCBib3VuZGFyeSAoc3BhcnNlbHkgbGFiZWxsZWQgc28gbG9uZ1xuLy8gdGltZWxpbmVzIHN0YXkgcmVhZGFibGUpLCB1bmxhYmVsbGVkIG1pbm9ycyBhdCB0aGUgZ3JpZCBpbiBiZXR3ZWVuLiBNaW5vciBESVNQTEFZIGlzXG4vLyB0aGlubmVkIHdoZW4gZGVuc2U7IHRoZSBzbmFwIGdyaWQgc3RheXMgZXhhY3QsIHNvIGEgbWFyayBpcyBhIGd1aWRlLCBub3QgYSBjb25zdHJhaW50LlxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUnVsZXIodGlja3MsIGdyaWRNcywgZm9ybWF0TGFiZWwsIHsgbWF4TGFiZWxzID0gNiwgbWF4TWlub3JzID0gMjQwIH0gPSB7fSkge1xuICAgIGlmICh0aWNrcy5sZW5ndGggPCAyKSByZXR1cm4gW107XG4gICAgY29uc3QgdDAgPSB0aWNrc1swXSwgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdDA7XG4gICAgY29uc3QgbWFya3MgPSBbXTtcbiAgICBjb25zdCBsYWJlbEV2ZXJ5ID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRpY2tzLmxlbmd0aCAvIG1heExhYmVscykpO1xuICAgIHRpY2tzLmZvckVhY2goKHQsIGkpID0+IG1hcmtzLnB1c2goe1xuICAgICAgICBmcmFjdGlvbjogKHQgLSB0MCkgLyBzcGFuLCBtYWpvcjogdHJ1ZSxcbiAgICAgICAgbGFiZWw6IGkgJSBsYWJlbEV2ZXJ5ID09PSAwID8gZm9ybWF0TGFiZWwodCkgOiBudWxsLFxuICAgIH0pKTtcbiAgICBpZiAoZ3JpZE1zICYmIGdyaWRNcyA8IHNwYW4pIHtcbiAgICAgICAgY29uc3QgdG90YWwgPSBNYXRoLmZsb29yKHNwYW4gLyBncmlkTXMpO1xuICAgICAgICBjb25zdCB0aGluID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRvdGFsIC8gbWF4TWlub3JzKSk7XG4gICAgICAgIGZvciAobGV0IGsgPSAxOyBrICogZ3JpZE1zIDwgc3BhbjsgayArPSB0aGluKSB7XG4gICAgICAgICAgICBjb25zdCB0ID0gdDAgKyBrICogZ3JpZE1zO1xuICAgICAgICAgICAgaWYgKHRpY2tzLmluY2x1ZGVzKHQpKSBjb250aW51ZTtcbiAgICAgICAgICAgIG1hcmtzLnB1c2goeyBmcmFjdGlvbjogKHQgLSB0MCkgLyBzcGFuLCBtYWpvcjogZmFsc2UsIGxhYmVsOiBudWxsIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBtYXJrcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFRpY2tMYWJlbChtcywgcGVyaW9kTXMpIHtcbiAgICBjb25zdCBpc28gPSBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKTtcbiAgICBpZiAocGVyaW9kTXMgIT0gbnVsbCAmJiBwZXJpb2RNcyA8IDYwICogMTAwMCkgcmV0dXJuIGlzby5zbGljZSgxMSwgMTkpO1xuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgMjQgKiAzNjAwICogMTAwMCkgcmV0dXJuIGlzby5zbGljZSgxMSwgMTYpO1xuICAgIHJldHVybiBpc28uc2xpY2UoNSwgMTApO1xufVxuXG4vLyBHbHlwaHMgYXMgaW5saW5lIFNWRyByYXRoZXIgdGhhbiB0ZXh0OiBcIlx1MjFCQlwiIHJlYWRzIGFzIHJlZnJlc2ggLS0gYSBsb29wIHRvZ2dsZSBkcmF3biB3aXRoXG4vLyBpdCBsb29rcyBsaWtlIGEgcmVzZXQgYnV0dG9uLCB3aGljaCBpcyBleGFjdGx5IGhvdyBpdCBnb3QgbWlzcmVhZC4gY3VycmVudENvbG9yIGxldHNcbi8vIHRoZSBwcmVzc2VkIHN0YXRlIHJlc3R5bGUgdGhlbSBmcm9tIENTUy5cbmNvbnN0IElDT05TID0ge1xuICAgIGJhY2s6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk0zIDJoMnYxMkgzek0xMyAyIDYgOGw3IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGxheTogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTQgMmw5IDYtOSA2elwiLz48L3N2Zz4nLFxuICAgIHBhdXNlOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAyaDN2MTJINHpNOSAyaDN2MTJIOXpcIi8+PC9zdmc+JyxcbiAgICBmd2Q6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk0xMSAyaDJ2MTJoLTJ6TTMgMmw3IDYtNyA2elwiLz48L3N2Zz4nLFxuICAgIGxvb3A6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk04IDJhNiA2IDAgMCAxIDUuNjUgNEgxNmwtMi44IDMuNUwxMC40IDZoMi4xQTQuNSA0LjUgMCAxIDAgMTIuNSAxMGwxLjMuNzVBNiA2IDAgMSAxIDggMnpcIi8+PC9zdmc+Jyxcbn07XG5cbi8vIC0tLSB0aGUgY29udHJvbCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGxhaW4gRE9NIGluc2lkZSB0aGUgd2lkZ2V0IGNvbnRhaW5lciwgbGlrZSB0aGUgc2lkZWJhcjogbm8gTGVhZmxldCBjb250cm9sIG1hY2hpbmVyeSxcbi8vIHdoaWNoIGtlZXBzIGl0IHRlc3RhYmxlIGluIGpzZG9tIGFuZCBzdHlsZWFibGUgZnJvbSBtYXAuY3NzLiBUaGUgbGF5b3V0IGZvbGxvd3Ncbi8vIExlYWZsZXQuVGltZURpbWVuc2lvbidzIGNvbnRyb2wgLS0gc3RlcC9wbGF5L3N0ZXAvbG9vcCBhcyBhIGpvaW5lZCBidXR0b24gYmFyLCB0aGVuIHRoZVxuLy8gZGF0ZSwgc2xpZGVyIGFuZCBzcGVlZCAtLSBzaW5jZSB0aGF0IGlzIHRoZSBzbGlkZXIgdXNlcnMgb2YgdGhlIGZvbGl1bSBhcHBzIGtub3cuXG4vL1xuLy8gVGhlIHNsaWRlciBpcyBhIGNvbXBvc2l0ZS4gQSBuYXRpdmUgPGlucHV0IHR5cGU9cmFuZ2U+IHN0YXlzIG9uIHRvcCBhcyB0aGUgdGh1bWI6IGl0XG4vLyBrZWVwcyBrZXlib2FyZCBhcnJvd3MsIHNjcmVlbiByZWFkZXJzIGFuZCBldmVyeSBleGlzdGluZyB0ZXN0IHdvcmtpbmcsIGFuZCBwbGF5YmFja1xuLy8gZHJpdmVzIGl0IGFzIGJlZm9yZS4gVW5kZXJuZWF0aCBzaXQgdGhlIHBhcnRzIGEgbmF0aXZlIGlucHV0IGNhbm5vdCBkcmF3OiB0aGUgd2luZG93XG4vLyBzcGFuIHNob3dpbmcgZXhhY3RseSB3aGF0IGludGVydmFsIGlzIG9uIHRoZSBtYXAsIGEgcnVsZXIgd2l0aCBsYWJlbGxlZCBpbnRlcnZhbCBtYXJrc1xuLy8gYW5kIHVubGFiZWxsZWQgZ2NkIG1pbm9ycywgYW5kIHRoZSB0cmFpbCBoYW5kbGUgLS0gZHJhZyBpdCBiYWNrIHRvIHdpZGVuIHRoZSB3aW5kb3cgZm9yXG4vLyBldmVyeSBsYXllciBhdCBvbmNlLCBkcm9wIGl0IG9udG8gdGhlIHRodW1iIHRvIGhhbmQgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyVGltZUNvbnRyb2woY29udGFpbmVyLCBzdGF0ZSwgaGFuZGxlcnMpIHtcbiAgICBsZXQgZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWNvbnRyb2xcIik7XG4gICAgaWYgKCFzdGF0ZS50aWNrcyB8fCBzdGF0ZS50aWNrcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKGVsKSBlbC5yZW1vdmUoKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmICghZWwpIHtcbiAgICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBlbC5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXRpbWUtY29udHJvbFwiO1xuICAgICAgICBlbC5pbm5lckhUTUwgPSBgXG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYnV0dG9uc1wiPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhY2tcIiB0aXRsZT1cIlN0ZXAgYmFja1wiIGFyaWEtbGFiZWw9XCJTdGVwIGJhY2tcIj4ke0lDT05TLmJhY2t9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtcGxheVwiIGFyaWEtbGFiZWw9XCJQbGF5XCI+JHtJQ09OUy5wbGF5fTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWZ3ZFwiIHRpdGxlPVwiU3RlcCBmb3J3YXJkXCIgYXJpYS1sYWJlbD1cIlN0ZXAgZm9yd2FyZFwiPiR7SUNPTlMuZndkfTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxvb3BcIiBhcmlhLWxhYmVsPVwiTG9vcFwiPiR7SUNPTlMubG9vcH08L2J1dHRvbj5cbiAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sYWJlbFwiPjwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS10cmFja1wiPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1iYXNlXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGFuXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1ydWxlclwiPjwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8aW5wdXQgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNsaWRlclwiIHR5cGU9XCJyYW5nZVwiIG1pbj1cIjBcIiBzdGVwPVwiMVwiPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS10cmFpbFwiIHJvbGU9XCJzbGlkZXJcIiB0YWJpbmRleD1cIjBcIlxuICAgICAgICAgICAgICAgICAgICAgIGFyaWEtbGFiZWw9XCJUcmFpbGluZyB3aW5kb3dcIiB0aXRsZT1cIkRyYWcgYmFjayB0byB3aWRlbiB0aGUgdGltZSB3aW5kb3c7IGRyb3Agb24gdGhlIHRodW1iIHRvIGNsZWFyXCI+PC9zcGFuPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNlbGVjdCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc3BlZWRcIiB0aXRsZT1cIlBsYXliYWNrIHNwZWVkXCI+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjAuNVwiPjAuNXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMVwiPjF4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjJcIj4yeDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCI0XCI+NHg8L29wdGlvbj5cbiAgICAgICAgICAgIDwvc2VsZWN0PmA7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChlbCk7XG5cbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWJhY2tcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEJhY2spO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtZndkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBGb3J3YXJkKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uUGxheVRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vbkxvb3BUb2dnbGUpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLFxuICAgICAgICAgICAgZSA9PiBoYW5kbGVycy5vblNwZWVkKHBhcnNlRmxvYXQoZS50YXJnZXQudmFsdWUpKSk7XG4gICAgICAgIGNvbnN0IHNsaWRlciA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIik7XG4gICAgICAgIC8vIGBpbnB1dGAgZmlyZXMgcGVyIGRyYWcgc3RlcCBmb3IgbGl2ZSBzY3J1YmJpbmc7IHRoZSBtb2RlbCB3cml0ZWJhY2sgaXMgdGhlXG4gICAgICAgIC8vIGhhbmRsZXIncyBwcm9ibGVtLCB0aHJvdHRsZWQgdGhlcmUgc28gZHJhZ2dpbmcgZG9lcyBub3QgZmxvb2QgdGhlIGtlcm5lbC5cbiAgICAgICAgc2xpZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBlID0+IGhhbmRsZXJzLm9uU2VlayhwYXJzZUludChlLnRhcmdldC52YWx1ZSwgMTApKSk7XG5cbiAgICAgICAgYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycyk7XG4gICAgfVxuXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS5tYXggPSBTdHJpbmcoc3RhdGUudGlja3MubGVuZ3RoIC0gMSk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5pbmRleCk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxhYmVsXCIpLnRleHRDb250ZW50ID0gZm9ybWF0VVRDKHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XSk7XG5cbiAgICBjb25zdCBwbGF5ID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIik7XG4gICAgcGxheS5pbm5lckhUTUwgPSBzdGF0ZS5wbGF5aW5nID8gSUNPTlMucGF1c2UgOiBJQ09OUy5wbGF5O1xuICAgIHBsYXkuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBzdGF0ZS5wbGF5aW5nID8gXCJQYXVzZVwiIDogXCJQbGF5XCIpO1xuICAgIHBsYXkudGl0bGUgPSBzdGF0ZS5wbGF5aW5nID8gXCJQYXVzZVwiIDogXCJQbGF5XCI7XG5cbiAgICAvLyBBIG1vZGUsIG5vdCBhbiBhY3Rpb246IHByZXNzZWQgc3R5bGluZyBhbmQgYXJpYS1wcmVzc2VkIHNheSBcInRoaXMgc3RheXMgb25cIixcbiAgICAvLyB3aGVyZSBhIGJhcmUgaWNvbiBpbnZpdGVkIGEgY2xpY2sgZXhwZWN0aW5nIHNvbWV0aGluZyB0byBoYXBwZW4gcmlnaHQgbm93LlxuICAgIGNvbnN0IGxvb3AgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKTtcbiAgICBsb29wLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgQm9vbGVhbihzdGF0ZS5sb29wKSk7XG4gICAgbG9vcC5zZXRBdHRyaWJ1dGUoXCJhcmlhLXByZXNzZWRcIiwgU3RyaW5nKEJvb2xlYW4oc3RhdGUubG9vcCkpKTtcbiAgICBsb29wLnRpdGxlID0gc3RhdGUubG9vcCA/IFwiTG9vcDogb25cIiA6IFwiTG9vcDogb2ZmXCI7XG5cbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuc3BlZWQgfHwgMSk7XG4gICAgcmVuZGVyVHJhY2soZWwsIHN0YXRlKTtcbiAgICBhcHBseVBvc2l0aW9uKGVsLCBzdGF0ZS5wb3NpdGlvbik7XG4gICAgcmV0dXJuIGVsO1xufVxuXG4vLyBHZW9tZXRyeSBzaGFyZWQgYnkgcmVuZGVyaW5nIGFuZCBkcmFnZ2luZzogd2hlcmUgYSB0aW1lIHNpdHMgb24gdGhlIHRyYWNrLCAwLi4xLlxuZnVuY3Rpb24gdHJhY2tGcmFjdGlvbih0aWNrcywgdCkge1xuICAgIGNvbnN0IHNwYW4gPSB0aWNrc1t0aWNrcy5sZW5ndGggLSAxXSAtIHRpY2tzWzBdO1xuICAgIGlmIChzcGFuIDw9IDApIHJldHVybiAxO1xuICAgIHJldHVybiBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCAodCAtIHRpY2tzWzBdKSAvIHNwYW4pKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyVHJhY2soZWwsIHN0YXRlKSB7XG4gICAgY29uc3QgeyB0aWNrcywgaW5kZXggfSA9IHN0YXRlO1xuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xuICAgIHRyYWNrLl9zdGF0ZSA9IHN0YXRlOyAgICAgIC8vIHRoZSBkcmFnIGhhbmRsZXIgcmVhZHMgdGhlIGZyZXNoZXN0IHN0YXRlIGZyb20gaGVyZVxuXG4gICAgY29uc3QgdGh1bWJUID0gdGlja3NbaW5kZXhdO1xuICAgIGNvbnN0IHBlcmlvZE1zID0gc3RhdGUucGVyaW9kTXM7XG4gICAgY29uc3Qgd2luZG93TXMgPSBzdGF0ZS53aW5kb3cgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHN0YXRlLndpbmRvdykpIDogbnVsbDtcbiAgICBjb25zdCBzaG93bk1zID0gd2luZG93TXMgIT0gbnVsbCA/IHdpbmRvd01zIDogcGVyaW9kTXM7XG5cbiAgICAvLyBUaGUgc3Bhbjogd2hhdCBpbnRlcnZhbCB0aGUgbWFwIGlzIHNob3dpbmcgcmlnaHQgbm93LiBUaGUgc3BhbiBkZXBpY3RzIHRoZSBzaGFyZWRcbiAgICAvLyB3aW5kb3cgLS0gb25lIHBlcmlvZCBieSBkZWZhdWx0IC0tIGFuZCBwZXItbGF5ZXIgZHVyYXRpb25zIHJlbWFpbiBhbiBBUEkgY29uY2VyblxuICAgIC8vIHVudGlsIGEgZHJhZyBvdmVycmlkZXMgdGhlbSBmb3IgZXZlcnl0aGluZyBhdCBvbmNlLlxuICAgIGNvbnN0IHNwYW4gPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BhblwiKTtcbiAgICBjb25zdCByaWdodCA9IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCk7XG4gICAgY29uc3QgbGVmdCA9IHNob3duTXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHNob3duTXMpIDogMDtcbiAgICBzcGFuLnN0eWxlLmxlZnQgPSBgJHsobGVmdCAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICBzcGFuLnN0eWxlLndpZHRoID0gYCR7KE1hdGgubWF4KDAsIHJpZ2h0IC0gbGVmdCkgKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgc3Bhbi5jbGFzc0xpc3QudG9nZ2xlKFwib3ZlcnJpZGVcIiwgd2luZG93TXMgIT0gbnVsbCk7XG5cbiAgICAvLyBUaGUgdHJhaWwgaGFuZGxlIHBhcmtzIE9OIHRoZSB0aHVtYiB3aGVuIG5vIG92ZXJyaWRlIGlzIGFjdGl2ZSAtLSBcIm5vdCBncmFiYmVkXCIgLS1cbiAgICAvLyBhbmQgc2l0cyBhdCB0aGUgd2luZG93J3Mgc3RhcnQgd2hpbGUgb25lIGlzLiBEcm9wcGluZyBpdCBiYWNrIG9uIHRoZSB0aHVtYiBjbGVhcnMuXG4gICAgY29uc3QgdHJhaWwgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhaWxcIik7XG4gICAgY29uc3QgYXQgPSB3aW5kb3dNcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gd2luZG93TXMpIDogcmlnaHQ7XG4gICAgdHJhaWwuc3R5bGUubGVmdCA9IGAkeyhhdCAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICB0cmFpbC5jbGFzc0xpc3QudG9nZ2xlKFwiYWN0aXZlXCIsIHdpbmRvd01zICE9IG51bGwpO1xuICAgIHRyYWlsLnNldEF0dHJpYnV0ZShcImFyaWEtdmFsdWV0ZXh0XCIsIHN0YXRlLndpbmRvdyB8fCBcIm5vIHRyYWlsaW5nIHdpbmRvd1wiKTtcbiAgICAvLyBObyBmaXhlZC1tcyBncmlkIChjYWxlbmRhciBwZXJpb2RzKSBtZWFucyBub3RoaW5nIHNlbnNpYmxlIHRvIHNuYXAgdG8uXG4gICAgdHJhaWwuc3R5bGUuZGlzcGxheSA9IHN0YXRlLmdyaWRNcyA/IFwiXCIgOiBcIm5vbmVcIjtcblxuICAgIGNvbnN0IHJ1bGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXJ1bGVyXCIpO1xuICAgIGNvbnN0IGtleSA9IGAke3RpY2tzWzBdfXwke3RpY2tzLmxlbmd0aH18JHtzdGF0ZS5ncmlkTXN9fCR7cGVyaW9kTXN9YDtcbiAgICBpZiAocnVsZXIuX2tleSAhPT0ga2V5KSB7XG4gICAgICAgIHJ1bGVyLl9rZXkgPSBrZXk7XG4gICAgICAgIHJ1bGVyLmlubmVySFRNTCA9IFwiXCI7XG4gICAgICAgIGZvciAoY29uc3QgbWFyayBvZiBidWlsZFJ1bGVyKHRpY2tzLCBzdGF0ZS5ncmlkTXMsIHQgPT4gZm9ybWF0VGlja0xhYmVsKHQsIHBlcmlvZE1zKSkpIHtcbiAgICAgICAgICAgIGNvbnN0IG0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgICAgIG0uY2xhc3NOYW1lID0gbWFyay5tYWpvciA/IFwic3dpZnRtYXAtdGltZS1tYXJrIG1ham9yXCIgOiBcInN3aWZ0bWFwLXRpbWUtbWFya1wiO1xuICAgICAgICAgICAgbS5zdHlsZS5sZWZ0ID0gYCR7KG1hcmsuZnJhY3Rpb24gKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgICAgICAgICBpZiAobWFyay5sYWJlbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgICAgIGxhYi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXRpbWUtbWFyay1sYWJlbFwiO1xuICAgICAgICAgICAgICAgIGxhYi50ZXh0Q29udGVudCA9IG1hcmsubGFiZWw7XG4gICAgICAgICAgICAgICAgbS5hcHBlbmRDaGlsZChsYWIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcnVsZXIuYXBwZW5kQ2hpbGQobSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8vIERyYWdnaW5nIHRoZSB0cmFpbCBoYW5kbGUuIFNuYXBzIHRvIHRoZSBnY2QgZ3JpZCBzbyBldmVyeSBzdG9wIGlzIGEgYm91bmRhcnkgdGhlIGRhdGFcbi8vIG9yIHRoZSBpbnRlcnZhbCBhY3R1YWxseSBuYW1lczsgdGhlIGRpc3RhbmNlIHRvIHRoZSB0aHVtYiwgaW4gd2hvbGUgZ3JpZCBzdGVwcywgSVMgdGhlXG4vLyB3aW5kb3cuIFplcm8gc3RlcHMgLS0gZHJvcHBlZCBvbiB0aGUgdGh1bWIgLS0gY2xlYXJzIHRoZSBvdmVycmlkZS5cbmZ1bmN0aW9uIGF0dGFjaFRyYWlsRHJhZyhlbCwgaGFuZGxlcnMpIHtcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcblxuICAgIGZ1bmN0aW9uIGlzb0Zyb21FdmVudChldikge1xuICAgICAgICBjb25zdCBzdGF0ZSA9IHRyYWNrLl9zdGF0ZTtcbiAgICAgICAgY29uc3QgcmVjdCA9IHRyYWNrLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMgfHwgcmVjdC53aWR0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHVuY2xhbXBlZCBvbiB0aGUgbGVmdDogdGhlIHdpbmRvdyBpcyBcImhvdyBmYXIgYmFjayBmcm9tIHRoZVxuICAgICAgICAvLyBsZWFkIHBvaW50XCIsIGFuZCB0aGF0IG1heSByZWFjaCBwYXN0IHRoZSBiYXIncyBzdGFydCAtLSBlc3BlY2lhbGx5IHdoZW4gdGhlXG4gICAgICAgIC8vIGxlYWQgc2l0cyBlYXJseSBvbiB0aGUgYmFyIGFuZCBtb3N0IG9mIGl0cyB0cmFpbCBpcyBvZmYtc2NyZWVuLiBDbGFtcGluZyBoZXJlXG4gICAgICAgIC8vIGNhcHBlZCB0aGUgd2luZG93IGF0IHRoZSB2aXNpYmxlIHBhc3QsIHdoaWNoIHBpbm5lZCB0aGUgaGFuZGxlIHRvIHRoZSBiYXInc1xuICAgICAgICAvLyBzdGFydCBhbmQgbWFkZSBhbnl0aGluZyB3aWRlciBpbXBvc3NpYmxlIHRvIHNldC4gT25seSB0aGUgRFJBV0lORyBjbGFtcHMuXG4gICAgICAgIGNvbnN0IGZyYWMgPSBNYXRoLm1pbigxLCAoZXYuY2xpZW50WCAtIHJlY3QubGVmdCkgLyByZWN0LndpZHRoKTtcbiAgICAgICAgY29uc3QgdDAgPSBzdGF0ZS50aWNrc1swXTtcbiAgICAgICAgY29uc3Qgc3Bhbk1zID0gc3RhdGUudGlja3Nbc3RhdGUudGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcbiAgICAgICAgY29uc3QgdGh1bWJUID0gc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdO1xuICAgICAgICBjb25zdCBkaXN0ID0gdGh1bWJUIC0gKHQwICsgZnJhYyAqIHNwYW5Ncyk7XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5tYXgoMCwgTWF0aC5yb3VuZChkaXN0IC8gc3RhdGUuZ3JpZE1zKSk7XG4gICAgICAgIHJldHVybiBzdGVwcyA9PT0gMCA/IG51bGwgOiBtc1RvUGVyaW9kSVNPKHN0ZXBzICogc3RhdGUuZ3JpZE1zKTtcbiAgICB9XG5cbiAgICAvLyBNb3ZlIGFuZCByZWxlYXNlIGxpc3RlbiBvbiB0aGUgZG9jdW1lbnQgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgZHJhZzogdGhlIGhhbmRsZVxuICAgIC8vIGlzIDEycHggd2lkZSwgdGhlIGN1cnNvciBsZWF2ZXMgaXQgb24gdGhlIGZpcnN0IGZhc3QgbW92ZW1lbnQsIGFuZCBldmVudHMgdGhhdFxuICAgIC8vIHRhcmdldCB3aGF0ZXZlciBpcyB1bmRlcm5lYXRoIHdvdWxkIHN0dXR0ZXIgdGhlIGRyYWcgYW5kIGNvdWxkIHN3YWxsb3cgdGhlIHJlbGVhc2VcbiAgICAvLyBlbnRpcmVseSAtLSBhbiB1bmNvbW1pdHRlZCBkcmFnIHRoZW4gc25hcHMgYmFjayBvbiB0aGUgbmV4dCBzeW5jLlxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCBldiA9PiB7XG4gICAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAvLyBDYXB0dXJlIHJldGFyZ2V0cyBldmVyeSBwb2ludGVyIGV2ZW50IHRvIHRoZSBoYW5kbGUgdW50aWwgcmVsZWFzZSwgbm8gbWF0dGVyXG4gICAgICAgIC8vIHdoZXJlIHRoZSBjdXJzb3IgaXMuIFdpdGhvdXQgaXQsIGxldHRpbmcgZ28gd2l0aCB0aGUgcG9pbnRlciBvdmVyIHRoZSBtYXAgaGFuZHNcbiAgICAgICAgLy8gcG9pbnRlcnVwIHRvIExlYWZsZXQncyBjb250YWluZXIgaGFuZGxlcnMsIGFuZCBhIHJlbGVhc2UgdGhleSBzd2FsbG93IG5ldmVyXG4gICAgICAgIC8vIHJlYWNoZXMgdGhlIGRvY3VtZW50IGxpc3RlbmVyIC0tIHRoZSBkcmFnIHN0YXlzIHVuY29tbWl0dGVkIGFuZCB0aGUgbmV4dCBzeW5jXG4gICAgICAgIC8vIHNuYXBzIHRoZSBoYW5kbGUgaG9tZS4gVGhlIGRvY3VtZW50IGxpc3RlbmVycyBiZWxvdyByZW1haW4gYXMgdGhlIGZhbGxiYWNrIGZvclxuICAgICAgICAvLyBlbnZpcm9ubWVudHMgd2l0aG91dCBjYXB0dXJlOyB3aXRoIGl0LCByZXRhcmdldGVkIGV2ZW50cyBzdGlsbCBidWJibGUgdG8gdGhlbS5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZSkgdHJhaWwuc2V0UG9pbnRlckNhcHR1cmUoZXYucG9pbnRlcklkKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIHN5bnRoZXRpYyBldmVudHMgaGF2ZSBubyBhY3RpdmUgcG9pbnRlcjsgZmFsbCBiYWNrIHRvIGJ1YmJsaW5nICovIH1cblxuICAgICAgICBjb25zdCBtb3ZlID0gZSA9PiB7XG4gICAgICAgICAgICBjb25zdCBpc28gPSBpc29Gcm9tRXZlbnQoZSk7XG4gICAgICAgICAgICBpZiAoaXNvICE9PSB1bmRlZmluZWQpIGhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBmaW5pc2ggPSBlID0+IHtcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgZmluaXNoKTtcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XG4gICAgICAgICAgICBjb25zdCBpc28gPSBpc29Gcm9tRXZlbnQoZSk7XG4gICAgICAgICAgICBpZiAoaXNvICE9PSB1bmRlZmluZWQpIGhhbmRsZXJzLm9uV2luZG93Q29tbWl0KGlzbyk7XG4gICAgICAgIH07XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBmaW5pc2gpO1xuICAgIH0pO1xuXG4gICAgLy8gS2V5Ym9hcmQ6IG9uZSBncmlkIHN0ZXAgcGVyIGFycm93LCBEZWxldGUvSG9tZSB0byBjbGVhci4gU2FtZSBjb250cmFjdCBhcyB0aGUgZHJhZy5cbiAgICB0cmFpbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBldiA9PiB7XG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMpIHJldHVybjtcbiAgICAgICAgY29uc3QgY3VycmVudCA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiAwO1xuICAgICAgICBsZXQgbmV4dDtcbiAgICAgICAgaWYgKGV2LmtleSA9PT0gXCJBcnJvd0xlZnRcIikgbmV4dCA9IGN1cnJlbnQgKyBzdGF0ZS5ncmlkTXM7XG4gICAgICAgIGVsc2UgaWYgKGV2LmtleSA9PT0gXCJBcnJvd1JpZ2h0XCIpIG5leHQgPSBNYXRoLm1heCgwLCBjdXJyZW50IC0gc3RhdGUuZ3JpZE1zKTtcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkRlbGV0ZVwiIHx8IGV2LmtleSA9PT0gXCJIb21lXCIpIG5leHQgPSAwO1xuICAgICAgICBlbHNlIHJldHVybjtcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgaGFuZGxlcnMub25XaW5kb3dDb21taXQobmV4dCA+IDAgPyBtc1RvUGVyaW9kSVNPKG5leHQpIDogbnVsbCk7XG4gICAgfSk7XG59XG4iLCAiLy8gVGltZSBmaWx0ZXJpbmcgb24gdGhlIEdQVSwgZm9yIHBvaW50IGxheWVycy5cbi8vXG4vLyBUaGUgY29vcmRpbmF0ZXMgYWxyZWFkeSBsaXZlIGluIEdQVSBidWZmZXJzOyByZWJ1aWxkaW5nIHRoZSBtZXJnZWQgbGF5ZXIgcGVyIHRpY2sgdGhyZXdcbi8vIHRoYXQgYXdheSBhbmQgcmUtZmVkIGdsaWZ5IGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUyAtLSBtZWFzdXJlZCBhdCB+Mi42cyBwZXIgd2luZG93XG4vLyBjaGFuZ2UgYXQgdGhhdCBzY2FsZSwgd2l0aCBhbGxvY2F0aW9uIGNodXJuIHRoYXQgY291bGQgY3Jhc2ggdGhlIHRhYiB3aGVuIGNoYW5nZXNcbi8vIHN0YWNrZWQuIEluc3RlYWQsIGVhY2ggcG9pbnQncyB0aW1lIGludGVydmFsIGFuZCBpdHMgbGF5ZXIncyBkdXJhdGlvbiByaWRlIGFsb25nIGFzXG4vLyB2ZXJ0ZXggYXR0cmlidXRlcyB1cGxvYWRlZCBvbmNlLCBhbmQgdGhlIGN1cnJlbnQgdGljayBpcyBhIHVuaWZvcm06IGEgdGljayBvciB3aW5kb3dcbi8vIGNoYW5nZSBjb3N0cyB0d28gZmxvYXRzIGFuZCBhIHJlZHJhdy5cbi8vXG4vLyBnbGlmeSBtYWtlcyB0aGlzIHBvc3NpYmxlIHdpdGhvdXQgZm9ya2luZyBpdDogdmVydGV4U2hhZGVyU291cmNlIGlzIGFuIG92ZXJyaWRhYmxlXG4vLyBzZXR0aW5nICh0aGUgcGluIGZyYWdtZW50IHNoYWRlciBhbHJlYWR5IHVzZXMgdGhlIHNhbWUgZG9vciksIGluc3RhbmNlcyBleHBvc2UgdGhlaXJcbi8vIGdsL3Byb2dyYW0vY2FudmFzLCBhdHRyaWJ1dGVzIGFyZSBib3VuZCBvbmNlIGF0IHNldHVwLCBhbmQgdGhlIHBlci1mcmFtZSBkcmF3IHRvdWNoZXNcbi8vIG9ubHkgdGhlIG1hdHJpeCB1bmlmb3JtIC0tIHNvIGV4dHJhIGF0dHJpYnV0ZXMgYm91bmQgYWZ0ZXIgc2V0dXAgcGVyc2lzdCwgYW5kIHVuaWZvcm1cbi8vIHVwZGF0ZXMgdGFrZSBlZmZlY3Qgb24gdGhlIG5leHQgcmVkcmF3LlxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIHBlcmlvZFRvTXMsIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcblxuLy8gVGltZXMgdHJhdmVsIGFzIGZsb2F0MzIgb24gdGhlIEdQVSwgd2hvc2UgaW50ZWdlcnMgYXJlIGV4YWN0IG9ubHkgdG8gMl4yNC4gRXBvY2ggbXMgaXNcbi8vIGhvcGVsZXNzIGF0IHRoYXQgcHJlY2lzaW9uLCBzbyB0aW1lcyBhcmUgcmViYXNlZCB0byB0aGUgYnVja2V0J3MgZWFybGllc3Qgc3RhcnQgYW5kXG4vLyBleHByZXNzZWQgaW4gc2Vjb25kczogZXhhY3QgdG8gfjE5NCBkYXlzIG9mIHNwYW4sIGFuZCBhIDJzIHJvdW5kaW5nIGJleW9uZCB0aGF0IGlzXG4vLyBpbnZpc2libGUgYXQgYW55IHpvb20gYSB0aW1lIHNsaWRlciBtYWtlcyBzZW5zZSBhdC5cbmNvbnN0IEFMV0FZUyA9IDYuM2U4OyAgIC8vIH4yMCB5ZWFycywgaW4gc2Vjb25kczogdGhlIFwiZHVyYXRpb25cIiBvZiBjdW11bGF0aXZlIGxheWVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB0aGUgc3BhbiBoYWxmLXdpZHRoIG9mIHBvaW50cyB3aXRoIG5vIHJlYWRhYmxlIHRpbWUuXG5cbi8vIFBlci1idWNrZXQgbGF5ZXItdmlzaWJpbGl0eSBzbG90cyBpbiB0aGUgdmVydGV4IHNoYWRlci4gRWFjaCBmbG9hdCBhcnJheSBlbGVtZW50XG4vLyBvY2N1cGllcyBhIGZ1bGwgdW5pZm9ybSB2ZWN0b3IgaW4gRVMgR0xTTCBwYWNraW5nLCBhbmQgdGhlIHNwZWMgZ3VhcmFudGVlcyBvbmx5IDEyOFxuLy8gdmVydGV4IHVuaWZvcm0gdmVjdG9ycyAtLSA2NCBzbG90cyBsZWF2ZXMgY29tZm9ydGFibGUgcm9vbSBmb3IgdGhlIG1hdHJpeCBhbmQgdGhlIHRpbWVcbi8vIHVuaWZvcm1zLiBBIGJ1Y2tldCB3aXRoIG1vcmUgbGF5ZXJzIHRoYW4gc2xvdHMgZmFsbHMgYmFjayB0byByZWJ1aWxkLXBlci10b2dnbGUuXG4vLyAoUGFja2luZyBmb3VyIGxheWVycyBwZXIgdmVjNCB3b3VsZCBxdWFkcnVwbGUgdGhpcyBpZiBhbnlvbmUgZXZlciBuZWVkcyBpdC4pXG5leHBvcnQgY29uc3QgTEFZRVJfU0xPVFMgPSA2NDtcblxuLy8gQ2hlYXAga2lsbCBzd2l0Y2hlczogaWYgd2lyaW5nIHRoZSBHTCBzdGF0ZSBldmVyIGZhaWxzIChhIGZ1dHVyZSBnbGlmeSB2ZXJzaW9uIG1vdmluZ1xuLy8gaXRzIGludGVybmFscyksIHRoZSBhZmZlY3RlZCBmYW1pbHkgZmFsbHMgYmFjayB0byB0aGUgQ1BVIHJlYnVpbGQgcGF0aC4gUG9pbnRzIGFuZFxuLy8gdmVjdG9ycyBhcmUgc2VwYXJhdGUgZmxhZ3MgLS0gYSB2ZWN0b3IgaW50cm9zcGVjdGlvbiBmYWlsdXJlIG11c3Qgbm90IGNvc3QgcG9pbnRzXG4vLyB0aGVpciBHUFUgcGF0aC5cbmxldCBncHVPayA9IHRydWU7XG5leHBvcnQgZnVuY3Rpb24gZ3B1VGltZUF2YWlsYWJsZSgpIHsgcmV0dXJuIGdwdU9rOyB9XG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZUdwdVRpbWUocmVhc29uKSB7XG4gICAgaWYgKGdwdU9rKSBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gR1BVIHRpbWUgZmlsdGVyaW5nIGRpc2FibGVkOiAke3JlYXNvbn0uIGAgK1xuICAgICAgICBgRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2suYCk7XG4gICAgZ3B1T2sgPSBmYWxzZTtcbn1cbmxldCB2ZWN0b3JHcHVPayA9IHRydWU7XG5leHBvcnQgZnVuY3Rpb24gdmVjdG9yR3B1QXZhaWxhYmxlKCkgeyByZXR1cm4gdmVjdG9yR3B1T2s7IH1cbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlVmVjdG9yR3B1KHJlYXNvbikge1xuICAgIGlmICh2ZWN0b3JHcHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZvciBsaW5lcy9wb2x5Z29ucyBkaXNhYmxlZDogYCArXG4gICAgICAgIGAke3JlYXNvbn0uIEZhbGxpbmcgYmFjayB0byByZWJ1aWxkLXBlci10aWNrIGZvciB0aG9zZSBidWNrZXRzLmApO1xuICAgIHZlY3RvckdwdU9rID0gZmFsc2U7XG59XG5cbi8vIFRoZSBkZWZhdWx0IHBvaW50cyB2ZXJ0ZXggc2hhZGVyIChyZWFkIG91dCBvZiBsZWFmbGV0LmdsaWZ5IDMuMy4wKSB3aXRoIHRoZSB3aW5kb3dcbi8vIHRlc3QgYWRkZWQuIEEgaGlkZGVuIHBvaW50IGdldHMgc2l6ZSAwIGFuZCBhIHBvc2l0aW9uIG91dHNpZGUgY2xpcCBzcGFjZSwgc28gbmVpdGhlclxuLy8gdGhlIHZpc2libGUgcGFzcyBub3IgdGhlIHNoYXJlZC1wcm9ncmFtIHBpY2tpbmcgcGFzcyBldmVyIHJhc3RlcmlzZXMgaXQuXG5leHBvcnQgZnVuY3Rpb24gdGltZVZlcnRleFNoYWRlcigpIHtcbiAgICByZXR1cm4gYHVuaWZvcm0gbWF0NCBtYXRyaXg7XG5hdHRyaWJ1dGUgdmVjNCB2ZXJ0ZXg7XG5hdHRyaWJ1dGUgdmVjNCBjb2xvcjtcbmF0dHJpYnV0ZSBmbG9hdCBwb2ludFNpemU7XG5hdHRyaWJ1dGUgdmVjMiBhVGltZVNwYW47XG5hdHRyaWJ1dGUgZmxvYXQgYUR1cmF0aW9uO1xuYXR0cmlidXRlIGZsb2F0IGFMYXllcjtcbnVuaWZvcm0gZmxvYXQgdVRpY2s7XG51bmlmb3JtIGZsb2F0IHVPdmVycmlkZTtcbnVuaWZvcm0gZmxvYXQgdUxheWVyVmlzWyR7TEFZRVJfU0xPVFN9XTtcbnZhcnlpbmcgdmVjNCBfY29sb3I7XG5cbnZvaWQgbWFpbigpIHtcbiAgLy8gQSBuZWdhdGl2ZSBkdXJhdGlvbiBpcyB0aGUgZmFkZSBmbGFnOiB8YUR1cmF0aW9ufCBpcyB0aGUgd2luZG93LCB0aGUgc2lnbiBzYXlzIHRoaXNcbiAgLy8gcG9pbnQgZGltcyB3aXRoIGFnZS4gQSBzaGFyZWQgb3ZlcnJpZGUga2VlcHMgdGhlIHBvaW50J3Mgb3duIGZhZGUgcHJlZmVyZW5jZS5cbiAgYm9vbCBmYWRlcyA9IGFEdXJhdGlvbiA8IDAuMDtcbiAgZmxvYXQgZHVyID0gdU92ZXJyaWRlID49IDAuMCA/IHVPdmVycmlkZSA6IGFicyhhRHVyYXRpb24pO1xuICAvLyBIYWxmLW9wZW4gKHRpY2sgLSBkdXIsIHRpY2tdLCBtYXRjaGluZyBmZWF0dXJlSW5XaW5kb3cgb24gdGhlIENQVSBzaWRlIC0tIEFORGVkIHdpdGhcbiAgLy8gdGhlIHBvaW50J3MgbGF5ZXIgYmVpbmcgdmlzaWJsZS4gTGF5ZXIgdG9nZ2xlcyBhcmUgb25lIHVuaWZvcm0gZWxlbWVudCwgbm90IGFcbiAgLy8gcmVidWlsZDogdW5jaGVja2luZyBvbmUgb2YgMjUgdHJhY2tzIHVzZWQgdG8gcmUtZmVlZCBhbGwgNU0gcG9pbnRzIHRocm91Z2ggSlMuXG4gIGJvb2wgdmlzaWJsZSA9IGFUaW1lU3Bhbi55ID4gKHVUaWNrIC0gZHVyKSAmJiBhVGltZVNwYW4ueCA8PSB1VGlja1xuICAgICAgJiYgdUxheWVyVmlzW2ludChhTGF5ZXIpXSA+IDAuNTtcbiAgZ2xfUG9pbnRTaXplID0gdmlzaWJsZSA/IHBvaW50U2l6ZSA6IDAuMDtcbiAgZ2xfUG9zaXRpb24gPSB2aXNpYmxlID8gbWF0cml4ICogdmVydGV4IDogdmVjNCgyLjAsIDIuMCwgMi4wLCAxLjApO1xuICAvLyBBZ2UgcnVucyBmcm9tIHRoZSBmZWF0dXJlJ3MgZW5kOyBuZXdlc3QgaXMgb3BhcXVlLCB0aGUgdHJhaWxpbmcgZWRnZSByZWFjaGVzIHplcm8uXG4gIGZsb2F0IGFscGhhID0gZmFkZXMgPyBjbGFtcCgxLjAgLSAodVRpY2sgLSBhVGltZVNwYW4ueSkgLyBkdXIsIDAuMCwgMS4wKSA6IDEuMDtcbiAgX2NvbG9yID0gdmVjNChjb2xvci5yZ2IsIGNvbG9yLmEgKiBhbHBoYSk7XG59XG5gO1xufVxuXG4vLyBQZXItbGF5ZXIgZHVyYXRpb24gaW4gc2Vjb25kczogbnVsbCBhY2N1bXVsYXRlcywgXCJwZXJpb2RcIiBpcyB0aGUgc2hhcmVkIGludGVydmFsLFxuLy8gYW4gSVNPIHN0cmluZyBpcyBpdHNlbGY7IGFueXRoaW5nIHVucGFyc2VhYmxlIGZhbGxzIGJhY2sgdG8gdGhlIGludGVydmFsLlxuZnVuY3Rpb24gZHVyYXRpb25TZWNvbmRzKHNwZWMsIHBlcmlvZE1zKSB7XG4gICAgaWYgKHNwZWMgPT09IG51bGwgfHwgc3BlYyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gQUxXQVlTO1xuICAgIGlmIChzcGVjID09PSBcInBlcmlvZFwiKSByZXR1cm4gKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcbiAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xuICAgIHJldHVybiBtcyA/IG1zIC8gMTAwMCA6IChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XG59XG5cbi8vIEJ1aWxkcyB0aGUgcGVyLXBvaW50IGF0dHJpYnV0ZSBhcnJheXMgZm9yIG9uZSBtZXJnZWQgYnVja2V0LCBpbiB0aGUgZXhhY3Qgb3JkZXIgdGhlXG4vLyBidWNrZXQgZmVlZHMgcG9pbnRzIHRvIGdsaWZ5OiBsYXllciBieSBsYXllciwgaW5kZXggMC4ubi0xLCB3aXRoIHNpbmdsZS1gbG9jYXRpb25gXG4vLyBsYXllcnMgY29udHJpYnV0aW5nIG9uZSBwb2ludC4gUG9pbnRzIGluIGxheWVycyB3aXRob3V0IHRpbWUgbWV0YWRhdGEgLS0gYW5kIHBvaW50c1xuLy8gd2hvc2UgdGltZSB3YXMgdW5yZWFkYWJsZSAoTmFOKSAtLSBnZXQgYSBzcGFuIHRoYXQgaXMgdmlzaWJsZSBhdCBldmVyeSB0aWNrLlxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHBlcmlvZE1zKSB7XG4gICAgbGV0IHRvdGFsID0gMDtcbiAgICBsZXQgaGFzVGltZSA9IGZhbHNlO1xuICAgIGNvbnN0IHBlckxheWVyID0gW107XG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcbiAgICAgICAgY29uc3QgY291bnQgPSBidWYgPyBidWYuYnl0ZUxlbmd0aCAvIDE2IDogKGxheWVyLmxvY2F0aW9uID8gMSA6IDApO1xuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcbiAgICAgICAgaWYgKGxheWVyLnRpbWUpIGhhc1RpbWUgPSB0cnVlO1xuICAgICAgICBwZXJMYXllci5wdXNoKHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9KTtcbiAgICAgICAgdG90YWwgKz0gY291bnQ7XG4gICAgfVxuICAgIGlmICghaGFzVGltZSkgcmV0dXJuIHsgaGFzVGltZTogZmFsc2UgfTtcblxuICAgIGxldCBiYXNlID0gSW5maW5pdHk7XG4gICAgZm9yIChjb25zdCB7IHRpbWVzIH0gb2YgcGVyTGF5ZXIpIHtcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSAmJiB0aW1lc1tpXSA8IGJhc2UpIGJhc2UgPSB0aW1lc1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZiAoYmFzZSA9PT0gSW5maW5pdHkpIGJhc2UgPSAwO1xuXG4gICAgY29uc3Qgc3BhbnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsICogMik7XG4gICAgY29uc3QgZHVycyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XG4gICAgY29uc3QgbGF5ZXJJZHMgPSBbXTtcbiAgICBsZXQgb3V0ID0gMDtcbiAgICBmb3IgKGNvbnN0IHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9IG9mIHBlckxheWVyKSB7XG4gICAgICAgIGNvbnN0IGlkeCA9IGxheWVySWRzLmxlbmd0aDtcbiAgICAgICAgbGF5ZXJJZHMucHVzaChsYXllci5pZCk7XG4gICAgICAgIGNvbnN0IGR1ciA9IGxheWVyLnRpbWUgPyBkdXJhdGlvblNlY29uZHMobGF5ZXIudGltZS5kdXJhdGlvbiwgcGVyaW9kTXMpIDogQUxXQVlTO1xuICAgICAgICAvLyBUaGUgZmFkZSBmbGFnIHJpZGVzIHRoZSBkdXJhdGlvbidzIHNpZ24sIHNvIGl0IGNvc3RzIG5vIGV4dHJhIGF0dHJpYnV0ZS5cbiAgICAgICAgLy8gVGltZWxlc3MgKE5hTikgcG9pbnRzIGtlZXAgYSBwb3NpdGl2ZSBkdXJhdGlvbjogd2l0aCBubyBhZ2UsIG5vdGhpbmcgdG8gZmFkZS5cbiAgICAgICAgY29uc3Qgc2lnbmVkRHVyID0gbGF5ZXIudGltZSAmJiBsYXllci50aW1lLmZhZGUgPyAtZHVyIDogZHVyO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gdGltZXMgPyB0aW1lc1tpICogMl0gOiBOYU47XG4gICAgICAgICAgICBjb25zdCBlbmQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyICsgMV0gOiBOYU47XG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSkge1xuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gLUFMV0FZUztcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBBTFdBWVM7XG4gICAgICAgICAgICAgICAgZHVyc1tvdXRdID0gQUxXQVlTO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IChzdGFydCAtIGJhc2UpIC8gMTAwMDtcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSAoZW5kIC0gYmFzZSkgLyAxMDAwO1xuICAgICAgICAgICAgICAgIGR1cnNbb3V0XSA9IHNpZ25lZER1cjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxheWVySWR4W291dF0gPSBpZHg7XG4gICAgICAgICAgICBvdXQrKztcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBoYXNUaW1lOiB0cnVlLCBiYXNlLCBzcGFucywgZHVycywgbGF5ZXJJZHgsIGxheWVySWRzLCBjb3VudDogdG90YWwgfTtcbn1cblxuLy8gUGVyLWZlYXR1cmUgdGltZSBtZXRhZGF0YSBmb3IgYSB2ZWN0b3IgYnVja2V0IChsaW5lcy9wb2x5Z29ucyk6IG9uZSBlbnRyeSBwZXIgbGF5ZXIsXG4vLyBzaW5jZSB0aG9zZSBsYXllcnMgaG9sZCBleGFjdGx5IG9uZSBnZW9tZXRyeS4gU2FtZSBlbmNvZGluZ3MgYXMgdGhlIHBvaW50IHBhdGggLS1cbi8vIHJlYmFzZWQgZmxvYXQzMiBzZWNvbmRzLCBzaWduLXBhY2tlZCBmYWRlLCBhbHdheXMtdmlzaWJsZSBzcGFucyBmb3IgdGltZWxlc3Mgb3Jcbi8vIG5vbi10aW1lIGxheWVycy5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xuICAgIGlmICghbGF5ZXJzTGlzdC5zb21lKGwgPT4gbC50aW1lKSkgcmV0dXJuIHsgaGFzVGltZTogZmFsc2UgfTtcbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcbiAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbMF0pICYmIHRpbWVzWzBdIDwgYmFzZSkgYmFzZSA9IHRpbWVzWzBdO1xuICAgIH1cbiAgICBpZiAoYmFzZSA9PT0gSW5maW5pdHkpIGJhc2UgPSAwO1xuXG4gICAgY29uc3QgcGVyRmVhdHVyZSA9IGxheWVyc0xpc3QubWFwKChsYXllciwgaWR4KSA9PiB7XG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcbiAgICAgICAgY29uc3Qgc2lnbmVkRHVyID0gbGF5ZXIudGltZSAmJiBsYXllci50aW1lLmZhZGUgPyAtZHVyIDogZHVyO1xuICAgICAgICBpZiAoIXRpbWVzIHx8IE51bWJlci5pc05hTih0aW1lc1swXSkpIHtcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiAtQUxXQVlTLCBlbmQ6IEFMV0FZUywgZHVyOiBBTFdBWVMsIGlkeCB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAodGltZXNbMF0gLSBiYXNlKSAvIDEwMDAsIGVuZDogKHRpbWVzWzFdIC0gYmFzZSkgLyAxMDAwLFxuICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XG4gICAgfSk7XG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgcGVyRmVhdHVyZSwgbGF5ZXJJZHM6IGxheWVyc0xpc3QubWFwKGwgPT4gbC5pZCkgfTtcbn1cblxuLy8gRXhwYW5kcyBwZXItZmVhdHVyZSB2YWx1ZXMgdG8gcGVyLUdMLXZlcnRleCBhcnJheXMgZ2l2ZW4gZWFjaCBmZWF0dXJlJ3MgdmVydGV4IGNvdW50LlxuLy8gUHVyZSwgc28gdGhlIGFsaWdubWVudCBsb2dpYyBpcyB0aWVyLTEgdGVzdGFibGUgYXdheSBmcm9tIGFueSBHTCBjb250ZXh0LlxuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZFBlckZlYXR1cmUocGVyRmVhdHVyZSwgY291bnRzKSB7XG4gICAgbGV0IHRvdGFsID0gMDtcbiAgICBmb3IgKGNvbnN0IGMgb2YgY291bnRzKSB0b3RhbCArPSBjO1xuICAgIGNvbnN0IHNwYW5zID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCAqIDIpO1xuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcbiAgICBjb25zdCBsYXllcklkeCA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xuICAgIGxldCBvdXQgPSAwO1xuICAgIHBlckZlYXR1cmUuZm9yRWFjaCgoZiwgaSkgPT4ge1xuICAgICAgICBmb3IgKGxldCB2ID0gMDsgdiA8IGNvdW50c1tpXTsgdisrKSB7XG4gICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IGYuc3RhcnQ7XG4gICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBmLmVuZDtcbiAgICAgICAgICAgIGR1cnNbb3V0XSA9IGYuZHVyO1xuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGYuaWR4O1xuICAgICAgICAgICAgb3V0Kys7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4geyBzcGFucywgZHVycywgbGF5ZXJJZHggfTtcbn1cblxuLy8gZ2xpZnkncyB2ZXJ0ZXggbGF5b3V0OiA2IGZsb2F0cyBwZXIgR0wgdmVydGV4ICh4LCB5LCByLCBnLCBiLCBhKSwgY29uZmlybWVkIGZvciAzLjMuMFxuLy8gYm90aCBieSByZWFkaW5nIHRoZSBzb3VyY2UgYW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgcmVwb3J0J3MgZGVidWcgZHVtcCAtLSB0d29cbi8vIG9uZS1zZWdtZW50IGxpbmVzIHByb2R1Y2VkIGFsbFZlcnRpY2VzVHlwZWQgb2YgMjQgZmxvYXRzOiAyIGZlYXR1cmVzIHggMiB2ZXJ0aWNlcyB4IDYuXG5jb25zdCBGTE9BVFNfUEVSX1ZFUlRFWCA9IDY7XG5cbi8vIFdpcmVzIHRpbWUgKyBsYXllci12aXNpYmlsaXR5IGludG8gYSBsaXZlIGdsaWZ5IExJTkVTIG9yIFNIQVBFUyBpbnN0YW5jZS4gVGhlIGNhbGxlclxuLy8gc3VwcGxpZXMgcGVyLWZlYXR1cmUgR0wtdmVydGV4IGNvdW50cyBjb21wdXRlZCBmcm9tIHRoZSBnZW9tZXRyeSBpdCBidWlsdCBpdHNlbGY6XG4vLyBsaW5lcyBkcmF3IDIqKHBvaW50cy0xKSB2ZXJ0aWNlcyBwZXIgZmVhdHVyZSwgYW5kIGFueSB0cmlhbmd1bGF0aW9uIG9mIGEgc2ltcGxlIHJpbmdcbi8vIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3MgZWFyY3V0LiBUaGUgY291bnRzXG4vLyBhcmUgdmFsaWRhdGVkIGFnYWluc3QgdGhlIGluc3RhbmNlJ3MgYWN0dWFsIGJ1ZmZlciBsZW5ndGgsIGFuZCBhbnkgbWlzbWF0Y2ggZGlzYWJsZXNcbi8vIHRoZSB2ZWN0b3IgR1BVIHBhdGggcmF0aGVyIHRoYW4gbWlzLWFsaWduaW5nIGF0dHJpYnV0ZXMuXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UoaW5zdGFuY2UsIG1ldGEsIGNvdW50cykge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb3VudHMpIHx8IGNvdW50cy5sZW5ndGggIT09IG1ldGEucGVyRmVhdHVyZS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgZXhwZWN0ZWQgJHttZXRhLnBlckZlYXR1cmUubGVuZ3RofSB2ZXJ0ZXggY291bnRzLCBgICtcbiAgICAgICAgICAgICAgICBgZ290ICR7Y291bnRzICYmIGNvdW50cy5sZW5ndGh9YCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXhwZWN0ZWQgPSBjb3VudHMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgKiBGTE9BVFNfUEVSX1ZFUlRFWDtcbiAgICAgICAgLy8gTGluZXMga2VlcCBhIHR5cGVkIGZsYXQgYnVmZmVyOyBzaGFwZXMga2VlcCBhIHBsYWluIGZsYXQgYXJyYXkuIEVpdGhlciBpcyB0aGVcbiAgICAgICAgLy8gZ3JvdW5kIHRydXRoIGZvciBob3cgbWFueSBHTCB2ZXJ0aWNlcyBnbGlmeSBhY3R1YWxseSBidWlsdC5cbiAgICAgICAgY29uc3QgYWN0dWFsID0gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZCA/IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQubGVuZ3RoXG4gICAgICAgICAgICA6IChBcnJheS5pc0FycmF5KGluc3RhbmNlLnZlcnRpY2VzKSA/IGluc3RhbmNlLnZlcnRpY2VzLmxlbmd0aCA6IC0xKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZXhwZWN0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4IGNvdW50IG1pc21hdGNoOiBnZW9tZXRyeSBzYXlzICR7ZXhwZWN0ZWR9IGZsb2F0cywgYCArXG4gICAgICAgICAgICAgICAgYHRoZSBpbnN0YW5jZSBob2xkcyAke2FjdHVhbH1gKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhdHRycyA9IGV4cGFuZFBlckZlYXR1cmUobWV0YS5wZXJGZWF0dXJlLCBjb3VudHMpO1xuICAgICAgICBhdHRycy5iYXNlID0gbWV0YS5iYXNlO1xuICAgICAgICBhdHRycy5sYXllcklkcyA9IG1ldGEubGF5ZXJJZHM7XG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgZGlzYWJsZVZlY3RvckdwdShlcnIubWVzc2FnZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuLy8gV2lyZXMgdGhlIGF0dHJpYnV0ZSBidWZmZXJzIGFuZCB1bmlmb3JtcyBpbnRvIGEgbGl2ZSBnbGlmeSBwb2ludHMgaW5zdGFuY2UuIFJldHVybnMgYVxuLy8gaGFuZGxlIHdob3NlIHNldFdpbmRvdyBjb3N0cyB0d28gdW5pZm9ybXMgYW5kIGEgcmVkcmF3LCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IHRoZVxuLy8gaW5zdGFuY2UgaXMgbm90IHdoZXJlIGdsaWZ5IDMuMy4wIGtlZXBzIGl0IC0tIGluIHdoaWNoIGNhc2UgR1BVIHRpbWUgaXMgZGlzYWJsZWQgYW5kXG4vLyB0aGUgY2FsbGVyJ3MgcmVidWlsZCBwYXRoIHRha2VzIG92ZXIuXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvSW5zdGFuY2UoaW5zdGFuY2UsIGF0dHJzKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIHdpcmVUaW1lQXR0cmlidXRlcyhpbnN0YW5jZSwgYXR0cnMpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBkaXNhYmxlR3B1VGltZShlcnIubWVzc2FnZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuLy8gVGhlIGNvbW1vbiBHTCB3aXJpbmc6IGJ1ZmZlcnMgZm9yIHNwYW4vZHVyYXRpb24vbGF5ZXIgYXR0cmlidXRlcywgdW5pZm9ybXMgZm9yIHRoZVxuLy8gdGljaywgdGhlIHNoYXJlZCBvdmVycmlkZSBhbmQgdGhlIHBlci1sYXllciB2aXNpYmlsaXR5IHNsb3RzLiBUaHJvd3Mgb24gYW55dGhpbmdcbi8vIHVuZXhwZWN0ZWQ7IHRoZSBjYWxsZXJzIGRlY2lkZSB3aGljaCBmYWxsYmFjayBmbGFnIHRoYXQgZmxpcHMuXG5mdW5jdGlvbiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKSB7XG4gICAge1xuICAgICAgICBjb25zdCBnbCA9IGluc3RhbmNlLmdsO1xuICAgICAgICBjb25zdCBwcm9ncmFtID0gaW5zdGFuY2UucHJvZ3JhbTtcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBpbnN0YW5jZS5sYXllcjtcbiAgICAgICAgaWYgKCFnbCB8fCAhcHJvZ3JhbSB8fCAhbGF5ZXIpIHRocm93IG5ldyBFcnJvcihcImluc3RhbmNlIGxhY2tzIGdsL3Byb2dyYW0vbGF5ZXJcIik7XG5cbiAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcblxuICAgICAgICBjb25zdCBzcGFuTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhVGltZVNwYW5cIik7XG4gICAgICAgIGNvbnN0IGR1ckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUR1cmF0aW9uXCIpO1xuICAgICAgICBjb25zdCBsYXllckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUxheWVyXCIpO1xuICAgICAgICBjb25zdCB0aWNrTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidVRpY2tcIik7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidU92ZXJyaWRlXCIpO1xuICAgICAgICAvLyBTb21lIGRyaXZlcnMgbmFtZSB0aGUgYXJyYXkgaGVhZCBcInVMYXllclZpc1swXVwiOyBhY2NlcHQgZWl0aGVyLlxuICAgICAgICBjb25zdCB2aXNMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNcIilcbiAgICAgICAgICAgIHx8IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1swXVwiKTtcbiAgICAgICAgaWYgKHNwYW5Mb2MgPCAwIHx8IGR1ckxvYyA8IDAgfHwgbGF5ZXJMb2MgPCAwIHx8ICF0aWNrTG9jIHx8ICFvdmVycmlkZUxvYyB8fCAhdmlzTG9jKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0aW1lIGF0dHJpYnV0ZXMvdW5pZm9ybXMgbWlzc2luZyBmcm9tIHRoZSBsaW5rZWQgcHJvZ3JhbVwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwYW5CdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHNwYW5CdWYpO1xuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuc3BhbnMsIGdsLlNUQVRJQ19EUkFXKTtcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihzcGFuTG9jLCAyLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShzcGFuTG9jKTtcblxuICAgICAgICBjb25zdCBkdXJCdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGR1ckJ1Zik7XG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5kdXJzLCBnbC5TVEFUSUNfRFJBVyk7XG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoZHVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShkdXJMb2MpO1xuXG4gICAgICAgIGNvbnN0IGxheWVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBsYXllckJ1Zik7XG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5sYXllcklkeCwgZ2wuU1RBVElDX0RSQVcpO1xuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGxheWVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShsYXllckxvYyk7XG5cbiAgICAgICAgLy8gVW50aWwgdGhlIHNsaWRlciBzYXlzIG90aGVyd2lzZSwgZXZlcnl0aGluZyBpcyB2aXNpYmxlIC0tIGluIHRpbWUgQU5EIGxheWVyLlxuICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgQUxXQVlTKTtcbiAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCAtMSk7XG4gICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbGF5ZXJJZHM6IGF0dHJzLmxheWVySWRzLFxuICAgICAgICAgICAgLy8gdGlja01zIGluIGVwb2NoIG1zOyBvdmVycmlkZU1zIGEgc2hhcmVkLXdpbmRvdyB3aWR0aCBvciBudWxsLlxuICAgICAgICAgICAgc2V0V2luZG93KHRpY2tNcywgb3ZlcnJpZGVNcykge1xuICAgICAgICAgICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIHRpY2tNcyA9PT0gbnVsbCA/IEFMV0FZUyA6ICh0aWNrTXMgLSBhdHRycy5iYXNlKSAvIDEwMDApO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgb3ZlcnJpZGVNcyA9PT0gbnVsbCA/IC0xIDogb3ZlcnJpZGVNcyAvIDEwMDApO1xuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIE9uZSBmbG9hdCBwZXIgbGF5ZXIgc2xvdCwgaW4gYXR0cnMubGF5ZXJJZHMgb3JkZXIuIEEgc2lkZWJhciB0b2dnbGUgbGFuZHNcbiAgICAgICAgICAgIC8vIGhlcmUgaW5zdGVhZCBvZiByZWJ1aWxkaW5nIHRoZSBidWNrZXQuXG4gICAgICAgICAgICBzZXRMYXllclZpc2liaWxpdHkodmlzQXJyYXkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2aXMgPSBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpO1xuICAgICAgICAgICAgICAgIHZpcy5zZXQodmlzQXJyYXkuc2xpY2UoMCwgTEFZRVJfU0xPVFMpKTtcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCB2aXMpO1xuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICB9XG59XG4iLCAiaW1wb3J0IHsgbG9hZEpTLCBiaW5kUG9wdXAsIGJpbmRUb29sdGlwLCBwYXJzZUNvbG9yIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHBpblNoYWRlciB9IGZyb20gXCIuL3NoYWRlcnMuanNcIjtcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXG4gICAgICAgICBwZXJpb2RUb01zIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcbmltcG9ydCB7IGJ1aWxkVGltZUF0dHJpYnV0ZXMsIGF0dGFjaFRpbWVUb0luc3RhbmNlLCB0aW1lVmVydGV4U2hhZGVyLFxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XG5cbmZ1bmN0aW9uIHNldHVwR2xpZnlQcm9qZWN0aW9uKGdsSW5zdGFuY2UpIHtcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIuX3VuY2xhbXBlZFByb2plY3QgPSBmdW5jdGlvbihsYXRsbmcsIHpvb20pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAub3B0aW9ucy5jcnMubGF0TG5nVG9Qb2ludChsYXRsbmcsIHpvb20pO1xuICAgICAgICB9O1xuICAgICAgICBnbEluc3RhbmNlLmxheWVyLnJlZHJhdygpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xuICAgIGlmICghbWFwLl9jbGlja01hdGNoZXMpIHtcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcbiAgICB9XG4gICAgbWFwLl9jbGlja01hdGNoZXMucHVzaCh7IHByaW9yaXR5LCBhY3Rpb24gfSk7XG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xuICAgICAgICBtYXAuX2NsaWNrVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXMuc29ydCgoYSwgYikgPT4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHkpO1xuICAgICAgICAgICAgaWYgKG1hcC5fY2xpY2tNYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlc1swXS5hY3Rpb24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XG4gICAgICAgICAgICBtYXAuX2NsaWNrVGltZW91dCA9IG51bGw7XG4gICAgICAgIH0sIDApO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xuICAgIGlmICghbWFwLl9ob3Zlck1hdGNoZXMpIHtcbiAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMgPSBbXTtcbiAgICB9XG4gICAgbWFwLl9ob3Zlck1hdGNoZXMucHVzaCh7IHByaW9yaXR5LCBhY3Rpb24gfSk7XG4gICAgaWYgKCFtYXAuX2hvdmVyVGltZW91dCkge1xuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMuc29ydCgoYSwgYikgPT4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHkpO1xuICAgICAgICAgICAgaWYgKG1hcC5faG92ZXJNYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XG4gICAgICAgIH0sIDApO1xuICAgIH1cbn1cblxuLy8gU3R5bGUgZm9yIG9uZSBmZWF0dXJlOiBpdHMgb3duIGVudHJ5IGZyb20gYGZlYXR1cmVfc3R5bGVzYCB3aGVuIHRoZSBsYXllciBjYXJyaWVzXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcbi8vIHdoZW4gZmVhdHVyZXMgYWN0dWFsbHkgZGlmZmVyLCBzbyBhIHVuaWZvcm0gbGF5ZXIgY29zdHMgbm90aGluZyBleHRyYSBoZXJlLlxuLy8gRm91ciBzb3VyY2VzLCBsZWFzdCBzcGVjaWZpYyBmaXJzdC4gRWFjaCB0cmFuc2llbnQgb25lIGxpdmVzIGluIGl0cyBvd24gZmllbGQgcmF0aGVyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxuLy8gbm90aGluZyB0byByZW1lbWJlciBhbmQgbm90aGluZyB0byBwdXQgYmFjay5cbi8vXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcbi8vICAgZmVhdHVyZV9zdHlsZXNbaV0gICAgICAgcGVyIGZlYXR1cmUsIGZyb20gdGhlIGRhdGFcbi8vICAgaGlnaGxpZ2h0X3N0eWxlICAgICAgICAgdGhlIHdob2xlIGxheWVyIGlzIHNlbGVjdGVkXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXG5leHBvcnQgZnVuY3Rpb24gc3R5bGVGb3IobGF5ZXIsIGluZGV4KSB7XG4gICAgY29uc3QgZnJvbURhdGEgPSBBcnJheS5pc0FycmF5KGxheWVyLmZlYXR1cmVfc3R5bGVzKSA/IGxheWVyLmZlYXR1cmVfc3R5bGVzW2luZGV4XSA6IG51bGw7XG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xuICAgIGNvbnN0IHNlbGVjdGVkID0gbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzICYmIGxheWVyLnN0eWxlX292ZXJyaWRlc1tpbmRleF07XG4gICAgaWYgKCFmcm9tRGF0YSAmJiAhaGlnaGxpZ2h0ICYmICFzZWxlY3RlZCkgcmV0dXJuIGxheWVyO1xuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcbiAgICBpZiAoIXByb3BlcnRpZXMpIHJldHVybiB7fTtcbiAgICBjb25zdCBwcm9wcyA9IHt9O1xuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BlcnRpZXNba107XG4gICAgICAgIHByb3BzW2tdID0gQXJyYXkuaXNBcnJheSh2YWwpID8gdmFsW2luZGV4XSA6IHZhbDtcbiAgICB9KTtcbiAgICByZXR1cm4gcHJvcHM7XG59XG5cblxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRCdWZmZXIsIG1vZGVsKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIikge1xuICAgICAgICBjb25zdCBncm91cCA9IEwubGF5ZXJHcm91cCgpO1xuICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fTtcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBpZiAoc3ViLnR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJtYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWxpbmVcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgc3ViLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBzdWIsIGNvb3JkaW5hdGVCdWZmZXJzW3N1Yi5pZF0sIG1vZGVsKTtcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgIGdyb3VwLmFkZExheWVyKGluc3RhbmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBncm91cC5hZGRUbyhtYXApO1xuICAgICAgICBncm91cC5sYXllclR5cGUgPSBsYXllci50eXBlO1xuICAgICAgICByZXR1cm4gZ3JvdXA7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBtb2RlbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSkge1xuICAgIC8vIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lIGdlb21ldHJ5IHBlciBsYXllci4gT24gdGhlIEdQVSBwYXRoIChtYXAuanNcbiAgICAvLyBwYXNzZXMgdmVjdG9yR3B1IHdoZW4gdGhlIGJ1Y2tldCBxdWFsaWZpZXMpIGV2ZXJ5IGZlYXR1cmUgc3RheXMgaW4gdGhlIGJ1ZmZlcnMgYW5kXG4gICAgLy8gdGhlIHNoYWRlciBkZWNpZGVzIHZpc2liaWxpdHkgcGVyIHRpY2sgYW5kIHBlciBsYXllciB0b2dnbGUgLS0gYSBsaW5lLXNoYXBlZCB0cmFja1xuICAgIC8vIGhhcyBhcyBtYW55IHZlcnRpY2VzIGFzIGEgcG9pbnQgdHJhY2sgaGFzIHBvaW50cywgc28gaXRzIHJlYnVpbGRzIGNvc3QgdGhlIHNhbWVcbiAgICAvLyBhbmQgY3Jhc2hlZCB0aGUgc2FtZSB3YXkuIE9mZiB0aGUgR1BVIHBhdGgsIHRoZSB3aG9sZS1mZWF0dXJlIENQVSBmaWx0ZXIgcmVtYWlucy5cbiAgICBjb25zdCB2ZWN0b3JNZXRhID0gdmVjdG9yR3B1ICYmIHR5cGUgIT09IFwiY2lyY2xlX21hcmtlcnNcIiAmJiB0eXBlICE9PSBcIm1hcmtlcnNcIlxuICAgICAgICA/IGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXG4gICAgICAgICAgICB0aW1lU3RhdGUgJiYgdGltZVN0YXRlLnBlcmlvZCA/IHBlcmlvZFRvTXModGltZVN0YXRlLnBlcmlvZCkgOiBudWxsKVxuICAgICAgICA6IHsgaGFzVGltZTogZmFsc2UgfTtcbiAgICBjb25zdCB2ZWN0b3JUaW1lID0gQm9vbGVhbih2ZWN0b3JNZXRhLmhhc1RpbWUpO1xuICAgIGlmICh0aW1lU3RhdGUgJiYgIXZlY3RvclRpbWUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiKSB7XG4gICAgICAgIGxheWVyc0xpc3QgPSBsYXllcnNMaXN0LmZpbHRlcihsID0+IGxheWVySW5XaW5kb3cobCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpO1xuICAgICAgICBpZiAobGF5ZXJzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5bGluZVwiKSB7XG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgICAgIGNvbnN0IGdlb2pzb25Db29yZHMgPSBsYXllci5sb2NhdGlvbnMubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKE1hdGgubWF4KDAsIDIgKiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxKSkpO1xuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XG4gICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcbiAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkxpbmVTdHJpbmdcIixcbiAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IGdlb2pzb25Db29yZHNcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgbGluZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXG4gICAgICAgICAgICAgICAgICAgID8geyB2ZXJ0ZXhTaGFkZXJTb3VyY2U6ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKSB9IDoge307XG4gICAgICAgICAgICAgICAgdGhpcy5nbExpbmVzID0gTC5nbGlmeS5saW5lcyh7XG4gICAgICAgICAgICAgICAgICAgIC4uLmxpbmVPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWxpbmVzUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICAvLyBUaGUgZGF0YSBhYm92ZSBpcyBHZW9KU09OLCB3aG9zZSBjb29yZGluYXRlcyBhcmUgW2xvbiwgbGF0XTsgZ2xpZnlcbiAgICAgICAgICAgICAgICAgICAgLy8gZGVmYXVsdHMgdG8gbGF0aXR1ZGUtZmlyc3QgYW5kIGl0cyBMSU5FIHZlcnRleCBidWlsZGVyIHJlYWRzXG4gICAgICAgICAgICAgICAgICAgIC8vIGNvb3JkaW5hdGVzIHRocm91Z2ggdGhlc2Uga2V5cyAtLSB1bnNldCwgaXQgdG9vayBsb25naXR1ZGUgYXNcbiAgICAgICAgICAgICAgICAgICAgLy8gbGF0aXR1ZGUgYW5kIHByb2plY3RlZCBldmVyeSBsaW5lIG9mZi12aWV3cG9ydC4gU2lsZW50bHk6IG5vIEdMXG4gICAgICAgICAgICAgICAgICAgIC8vIGVycm9yLCBhIGhlYWx0aHkgY2FudmFzLCB6ZXJvIGZyYWdtZW50cy4gU2V0IHBlciBpbnN0YW5jZSByYXRoZXJcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiBvbiB0aGUgTC5nbGlmeSBnbG9iYWwsIHdoaWNoIGFub3RoZXIgbGlicmFyeSBjb3VsZCBhbHNvXG4gICAgICAgICAgICAgICAgICAgIC8vIG11dGF0ZS4gVGhlIHBvbHlnb24gcGF0aCBpcyBkZWxpYmVyYXRlbHkgTk9UIGdpdmVuIHRoZXNlIGtleXM6XG4gICAgICAgICAgICAgICAgICAgIC8vIGl0IHRyaWFuZ3VsYXRlcyB2aWEgZWFyY3V0IG9uIHRoZSBHZW9KU09OIGRpcmVjdGx5LCBuYXRpdmVcbiAgICAgICAgICAgICAgICAgICAgLy8gW2xvbiwgbGF0XSwgYW5kIGtleXMgdGhlcmUgd291bGQgdHJhbnNwb3NlIGl0IHRoZSBzYW1lIHdheS5cbiAgICAgICAgICAgICAgICAgICAgLy8gRm91bmQgYnkgdGhlIFZhbGhhbGxhLVZSRSBidWcgcmVwb3J0LCBkcml2aW5nIHRoZSBwbGFpbi1KU1xuICAgICAgICAgICAgICAgICAgICAvLyBidW5kbGUgd2hlcmUgbm8gcG9pbnRzIG1hc2tlZCB0aGUgYmxhbmsgbGluZXMuXG4gICAgICAgICAgICAgICAgICAgIGxhdGl0dWRlS2V5OiAxLFxuICAgICAgICAgICAgICAgICAgICBsb25naXR1ZGVLZXk6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLndlaWdodDtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdHRlbiBiYXJlOiBzaGlueXdpZGdldHMnIG1vZGVsIGhhcyBubyBgY29tbWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvcGVydHksIHNvIGdhdGluZyBvbiBpdCBzaWxlbnRseSBraWxsZWQgdGhpc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB3cml0ZWJhY2sgdW5kZXIgU2hpbnkuIFRoZSBzaWRlYmFyIGFsd2F5cyB3cm90ZSBiYXJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB3YXMgdGhlIG9uZSBwYXRoIHRoYXQgd29ya2VkIHRoZXJlLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBsYXllci5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsTGluZXMpO1xuICAgICAgICAgICAgICAgIGlmICh2ZWN0b3JUaW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xMaW5lcywgdmVjdG9yTWV0YSwgdmVydGV4Q291bnRzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xMaW5lcykgdGhpcy5nbExpbmVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICAgICAgbGV0IGdlb2pzb25Db29yZHMgPSBbXTtcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIikge1xuICAgICAgICAgICAgICAgIGdlb2pzb25Db29yZHMgPSBsYXllci5sb2NhdGlvbnMubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICAgICAgICAgICAgICBpZiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpcnN0ID0gZ2VvanNvbkNvb3Jkc1swXTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFzdCA9IGdlb2pzb25Db29yZHNbZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZpcnN0WzBdICE9PSBsYXN0WzBdIHx8IGZpcnN0WzFdICE9PSBsYXN0WzFdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBnZW9qc29uQ29vcmRzLnB1c2goW2ZpcnN0WzBdLCBmaXJzdFsxXV0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XG4gICAgICAgICAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XG4gICAgICAgICAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcbiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3TGF0ID0gbGF0ICsgKGRMYXQgKiAxODApIC8gTWF0aC5QSTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3TG9uID0gbG9uICsgKGRMb24gKiAxODApIC8gTWF0aC5QSTtcbiAgICAgICAgICAgICAgICAgICAgZ2VvanNvbkNvb3Jkcy5wdXNoKFtuZXdMb24sIG5ld0xhdF0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGdlb2pzb25Db29yZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMCk7ICAgLy8gbm8gZmVhdHVyZSwgYnV0IHRoZSBzbG90IG11c3Qgc3RheSBhbGlnbmVkXG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBBbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHNpbXBsZSByaW5nIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMsIG4gY291bnRpbmdcbiAgICAgICAgICAgIC8vIGRpc3RpbmN0IHZlcnRpY2VzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzIGVhcmN1dC4gVGhlXG4gICAgICAgICAgICAvLyByaW5nIGlzIGNsb3NlZCBieSBub3cgKGZpcnN0ID09IGxhc3QpLCBzbyBkaXN0aW5jdCA9IGxlbmd0aCAtIDEuXG4gICAgICAgICAgICBjb25zdCBkaXN0aW5jdCA9IGdlb2pzb25Db29yZHMubGVuZ3RoIC0gMTtcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKE1hdGgubWF4KDAsIDMgKiAoZGlzdGluY3QgLSAyKSkpO1xuXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiUG9seWdvblwiLFxuICAgICAgICAgICAgICAgICAgICBjb29yZGluYXRlczogW2dlb2pzb25Db29yZHNdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUuZmlsbE9wYWNpdHkgfHwgMC4yIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzaGFwZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXG4gICAgICAgICAgICAgICAgICAgID8geyB2ZXJ0ZXhTaGFkZXJTb3VyY2U6ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKSB9IDoge307XG4gICAgICAgICAgICAgICAgdGhpcy5nbFNoYXBlcyA9IEwuZ2xpZnkuc2hhcGVzKHtcbiAgICAgICAgICAgICAgICAgICAgLi4uc2hhcGVPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWdvbnNQYW5lXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMywgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFyZTogc2hpbnl3aWRnZXRzJyBtb2RlbCBoYXMgbm8gYGNvbW1gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHByb3BlcnR5LCBzbyBnYXRpbmcgb24gaXQgc2lsZW50bHkga2lsbGVkIHRoaXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBUaGUgc2lkZWJhciBhbHdheXMgd3JvdGUgYmFyZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgd2FzIHRoZSBvbmUgcGF0aCB0aGF0IHdvcmtlZCB0aGVyZS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMywgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XG4gICAgICAgICAgICAgICAgaWYgKHZlY3RvclRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UodGhpcy5nbFNoYXBlcywgdmVjdG9yTWV0YSwgdmVydGV4Q291bnRzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIGNvbnN0IHBvaW50c0xpc3QgPSBbXTtcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcblxuICAgIGNvbnN0IGZhbGxiYWNrQ29sb3IgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IFwiI2U2MWEyNlwiIDogXCIjMzM4OGZmXCI7XG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcbiAgICAvLyBjaXJjbGUgYmVjYXVzZSB0aGUgZ2x5cGggaXMgZHJhd24gaW5zaWRlIHRoZSBwb2ludCdzIG93biBxdWFkIGJ5IHRoZSBzaGFkZXIuXG4gICAgY29uc3QgZGVmYXVsdFNpemUgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDY0IDogNTtcblxuICAgIC8vIEdQVSB0aW1lIHBhdGg6IHdoZW4gdGhpcyBidWNrZXQgaG9sZHMgdGltZSBsYXllcnMsIGV2ZXJ5IHBvaW50IGlzIGZlZCB0byBnbGlmeSBhbmRcbiAgICAvLyBwZXItcG9pbnQgdGltZSByaWRlcyBhbG9uZyBhcyB2ZXJ0ZXggYXR0cmlidXRlcyAtLSB0aGUgd2luZG93IHRlc3QgaGFwcGVucyBpbiB0aGVcbiAgICAvLyB2ZXJ0ZXggc2hhZGVyLCBzbyBhIHRpY2sgY29zdHMgdHdvIHVuaWZvcm1zIGluc3RlYWQgb2YgcmVidWlsZGluZyA1TSBwb2ludHMgaW4gSlMuXG4gICAgLy8gVGhlIENQVSBmaWx0ZXIgYmVsb3cgc3RheXMgYXMgdGhlIGZhbGxiYWNrIHdoZW4gdGhlIEdMIHdpcmluZyBpcyB1bmF2YWlsYWJsZS5cbiAgICBjb25zdCBncHVBdHRycyA9IGdwdVRpbWVBdmFpbGFibGUoKVxuICAgICAgICA/IGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXG4gICAgICAgICAgICB0aW1lU3RhdGUgJiYgdGltZVN0YXRlLnBlcmlvZCA/IHBlcmlvZFRvTXModGltZVN0YXRlLnBlcmlvZCkgOiBudWxsKVxuICAgICAgICA6IHsgaGFzVGltZTogZmFsc2UgfTtcbiAgICBjb25zdCBncHVUaW1lID0gQm9vbGVhbihncHVBdHRycy5oYXNUaW1lKTtcblxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xuICAgICAgICBjb25zdCBsYXllclNpemUgPSBsYXllci5yYWRpdXMgIT0gbnVsbCA/IE51bWJlcihsYXllci5yYWRpdXMpIDogZGVmYXVsdFNpemU7XG5cbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XG4gICAgICAgIGlmICghY29vcmRCdWZmZXIpIHtcbiAgICAgICAgICAgIGlmIChsYXllci5sb2NhdGlvbiAmJiBsYXllckluV2luZG93KGxheWVyLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSkge1xuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XG4gICAgICAgICAgICAgICAgaW5kZXhNYXBwaW5nLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiBjb2xvclJHQixcbiAgICAgICAgICAgICAgICAgICAgc2l6ZTogbGF5ZXJTaXplXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5ieXRlT2Zmc2V0LFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZUxlbmd0aCAvIDhcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgY291bnQgPSBjb29yZHMubGVuZ3RoIC8gMjtcblxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XG4gICAgICAgIC8vIFNlbGVjdGlvbiBzdHlsaW5nLCBhcHBsaWVkIG92ZXIgdGhlIGxheWVyJ3Mgb3duIGFuZCBpdHMgZGF0YS1kcml2ZW4gc3R5bGVzLlxuICAgICAgICAvLyBTYW1lIHByZWNlZGVuY2UgYXMgc3R5bGVGb3I6IGRhdGEsIHRoZW4gd2hvbGUtbGF5ZXIgaGlnaGxpZ2h0LCB0aGVuIHBlci1mZWF0dXJlLlxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGVzID0gbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzIHx8IG51bGw7XG4gICAgICAgIC8vIFRoZSBjdXJyZW50IHRpbWUgd2luZG93LCB3aGVuIHRoaXMgbGF5ZXIgaXMgYW5pbWF0ZWQuIEZlYXR1cmVzIG91dHNpZGUgaXQgYXJlXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcbiAgICAgICAgLy8gb24gdGhlIHN1cnZpdm9ycyBrZWVwIHBvaW50aW5nIGF0IHRoZSByaWdodCByb3dzLlxuICAgICAgICBjb25zdCB3aW4gPSAhZ3B1VGltZSAmJiB0aW1lU3RhdGUgJiYgbGF5ZXIudGltZVxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKVxuICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICBjb25zdCB0aW1lcyA9IHdpbiA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xuXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgICAgICAgaWYgKHRpbWVzICYmICFmZWF0dXJlSW5XaW5kb3codGltZXNbaSAqIDJdLCB0aW1lc1tpICogMiArIDFdLCB3aW4pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGNvbnN0IGZyb21EYXRhID0gcGVyRmVhdHVyZSA/IHBlckZlYXR1cmVbaV0gOiBudWxsO1xuICAgICAgICAgICAgY29uc3Qgc2VsZWN0ZWQgPSBvdmVycmlkZXMgPyBvdmVycmlkZXNbaV0gOiBudWxsO1xuICAgICAgICAgICAgY29uc3QgY29sb3IgPSAoc2VsZWN0ZWQgJiYgc2VsZWN0ZWQuY29sb3IpXG4gICAgICAgICAgICAgICAgfHwgKGhpZ2hsaWdodCAmJiBoaWdobGlnaHQuY29sb3IpXG4gICAgICAgICAgICAgICAgfHwgKGZyb21EYXRhICYmIGZyb21EYXRhLmNvbG9yKTtcbiAgICAgICAgICAgIGNvbnN0IHJhZGl1cyA9IHNlbGVjdGVkICYmIHNlbGVjdGVkLnJhZGl1cyAhPSBudWxsID8gc2VsZWN0ZWQucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LnJhZGl1cyAhPSBudWxsID8gaGlnaGxpZ2h0LnJhZGl1c1xuICAgICAgICAgICAgICAgIDogZnJvbURhdGEgJiYgZnJvbURhdGEucmFkaXVzICE9IG51bGwgPyBmcm9tRGF0YS5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IG51bGw7XG5cbiAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbY29vcmRzW2kgKiAyXSwgY29vcmRzW2kgKiAyICsgMV1dKTtcbiAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxJbmRleDogaSxcbiAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3IgPyBwYXJzZUNvbG9yKGNvbG9yLCBmYWxsYmFja0NvbG9yKSA6IGNvbG9yUkdCLFxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cykgOiBsYXllclNpemVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjb25zdCBnZXRJbnRlcmFjdGl2ZUVsID0gKCkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKSB8fCBtYXAuZ2V0Q29udGFpbmVyKCk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgZGF0YTogcG9pbnRzTGlzdCxcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcbiAgICAgICAgICAgICAgICAvLyBSZXNvbHZlZCBwZXIgcG9pbnQsIGxpa2UgY29sb3VyOiBzZXZlcmFsIGxheWVycyBzaGFyZSBvbmUgZ2xpZnkgaW5zdGFuY2UsXG4gICAgICAgICAgICAgICAgLy8gc28gYSBzaW5nbGUgY29uc3RhbnQgaGVyZSBzaWxlbnRseSBkaXNjYXJkZWQgZXZlcnkgbGF5ZXIncyBvd24gcmFkaXVzLlxuICAgICAgICAgICAgICAgIHNpemU6IChpbmRleCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gJiYgaW5mby5zaXplICE9IG51bGwgPyBpbmZvLnNpemUgOiBkZWZhdWx0U2l6ZTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyA/IGluZm8uY29sb3JSR0IgOiB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHBpY2tpbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgc2Vuc2l0aXZpdHk6IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjAgOiA4LFxuICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgcG9pbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFwb2ludCkgcmV0dXJuO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuZm9yY2UgYSBzdHJpY3QgcGl4ZWwtZGlzdGFuY2UgdGhyZXNob2xkIHRvIHByZXZlbnQgcG9wdXBzIG9uIGZhciBhd2F5IGNsaWNrc1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGlja1BvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBjbGlja1BvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xuICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xuXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDEsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2lkeF07XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5mbykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gaW5mby5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb3BzID0gZ2V0SW5kZXhlZFByb3BlcnRpZXMobGF5ZXIucHJvcGVydGllcywgb3JpZ2luYWxJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBsYXllci5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBob3ZlcjogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBpZiAocG9pbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuZm9yY2UgYSBzdHJpY3QgcGl4ZWwtZGlzdGFuY2UgdGhyZXNob2xkIHRvIHByZXZlbnQgdG9vbHRpcHMgb24gZmFyIGF3YXkgaG92ZXJzXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBob3ZlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGhvdmVyUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2lkeF07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT09IFwibWFya2Vyc1wiKSB7XG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLmZyYWdtZW50U2hhZGVyU291cmNlID0gKCkgPT4gcGluU2hhZGVyO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy52ZXJ0ZXhTaGFkZXJTb3VyY2UgPSAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmdsUG9pbnRzID0gTC5nbGlmeS5wb2ludHMoZ2xpZnlPcHRpb25zKTtcbiAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xQb2ludHMpO1xuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBOdWxsIG9uIGZhaWx1cmUsIHdoaWNoIGFsc28gZmxpcHMgdGhlIGdsb2JhbCBmbGFnOiB0aGUgbmV4dCBzeW5jJ3NcbiAgICAgICAgICAgICAgICAvLyByZWJ1aWxkIGtleSBjaGFuZ2VzIHdpdGggaXQgYW5kIHRoZSBDUFUgcGF0aCB0YWtlcyBvdmVyLlxuICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb0luc3RhbmNlKHRoaXMuZ2xQb2ludHMsIGdwdUF0dHJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5nbFBvaW50cykgdGhpcy5nbFBvaW50cy5yZW1vdmUoKTtcbiAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIGNvbnN0IGNhbnZhcyA9IG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xuICAgICAgICAgICAgaWYgKGNhbnZhcykgY2FudmFzLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgIHJldHVybiBpbnN0YW5jZTtcbn1cbiIsICJpbXBvcnQgeyBsb2FkQ1NTLCBsb2FkSlMgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyU2lkZWJhckNvbnRyb2xzLCBub3JtYWxpemVSYWRpb0xheWVycyB9IGZyb20gXCIuL3NpZGViYXIuanNcIjtcbmltcG9ydCB7IHJlbmRlckxheWVyLCByZW5kZXJNZXJnZWRHbExheWVyIH0gZnJvbSBcIi4vbGF5ZXJzLmpzXCI7XG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgZ2VuZXJhdGVUaWNrcywgY29sbGVjdFRpbWVFeHRlbnQsIGhhc1RpbWVMYXllcnMsXG4gICAgICAgICBsYXllckluV2luZG93LCByZW5kZXJUaW1lQ29udHJvbCwgYWR2YW5jZSwgcGVyaW9kVG9NcywgZ2NkR3JpZE1zLFxuICAgICAgICAgY29sbGVjdER1cmF0aW9uc01zIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcbmltcG9ydCB7IGdwdVRpbWVBdmFpbGFibGUsIHZlY3RvckdwdUF2YWlsYWJsZSwgTEFZRVJfU0xPVFMgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XG5cbi8vIFRydWUgaWYgYSBsYXllciBpcyB2aXNpYmxlIGFuZCBubyBmb2xkZXIgYWJvdmUgaXQgaXMgc3dpdGNoZWQgb2ZmLlxuLy9cbi8vIFZpc2liaWxpdHkgaXMgaW5oZXJpdGVkIGRvd24gdGhlIGZvbGRlciBwYXRoOiBhIGxheWVyIGluc2lkZSBcIkZlZWRzL0FjdGl2ZVwiIGlzIGhpZGRlblxuLy8gd2hlbiBlaXRoZXIgXCJGZWVkc1wiIG9yIFwiRmVlZHMvQWN0aXZlXCIgaXMgb2ZmLCByZWdhcmRsZXNzIG9mIGl0cyBvd24gZmxhZy4gR2V0dGluZyB0aGlzXG4vLyB3cm9uZyBzaG93cyB1cCBhcyBcInRoYXQgbGF5ZXIganVzdCB3aWxsIG5vdCBhcHBlYXJcIiwgd2l0aCBub3RoaW5nIGxvZ2dlZC5cbmV4cG9ydCBmdW5jdGlvbiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLnNwbGl0KFwiL1wiKSkge1xuICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZ3JvdXBDb25maWdzW3J1bm5pbmdQYXRoXTtcbiAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFNvcnRzIHRoZSB2aXNpYmxlIGxheWVycyBpbnRvIG9uZSBidWNrZXQgcGVyIFdlYkdMIGRyYXcgcGFzcy5cbi8vXG4vLyBTdWItbGF5ZXJzIG9mIGEgbWVyZ2VkIGdyb3VwIGluaGVyaXQgdGhlaXIgcGFyZW50J3MgdmlzaWJpbGl0eSByYXRoZXIgdGhhbiBjYXJyeWluZ1xuLy8gdGhlaXIgb3duLCBzbyBhIGdyb3VwIHRvZ2dsZWQgb2ZmIGNvbnRyaWJ1dGVzIG5vdGhpbmcgZXZlbiB3aGVuIGl0cyBjaGlsZHJlbiBzYXlcbi8vIHZpc2libGUuIENpcmNsZXMgam9pbiB0aGUgcG9seWdvbiBidWNrZXQ6IHRoZXkgYXJlIGRyYXduIGFzIGdlbmVyYXRlZCByaW5ncy5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcbiAgICBjb25zdCBidWNrZXRzID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG5cbiAgICBmdW5jdGlvbiBjb2xsZWN0KGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1YkxheWVyKSB7XG4gICAgICAgIGlmICghcGFyZW50VmlzaWJsZSkgcmV0dXJuO1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IGNvbGxlY3Qoc3ViLCBwYXJlbnRWaXNpYmxlLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFpc1N1YkxheWVyICYmIGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKGJ1Y2tldHNbYnVja2V0XSkgYnVja2V0c1tidWNrZXRdLnB1c2gobGF5ZXIpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgIGNvbGxlY3QobGF5ZXIsIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpLCBmYWxzZSk7XG4gICAgfVxuICAgIHJldHVybiBidWNrZXRzO1xufVxuXG4vLyBBcHBsaWVzIGluY3JlbWVudGFsIHBhdGNoIG9wcyB0byB7bGF5ZXJzLCBidWZmZXJzfSwgcmV0dXJuaW5nIHRoZSBuZXcgc3RhdGUuXG4vL1xuLy8gT3BzIGFyZSBhZGRyZXNzZWQgYnkgbGF5ZXIgaWQgYW5kIGFwcGxpZWQgaWRlbXBvdGVudGx5OiBcImFkZFwiIHVwc2VydHMgcmF0aGVyIHRoYW5cbi8vIGFwcGVuZGluZyBibGluZGx5LCBzbyBhIHBhdGNoIHRoYXQgcmFjZXMgdGhlIGluaXRpYWwgdHJhaXQgc25hcHNob3QgY2Fubm90IGR1cGxpY2F0ZVxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxuLy8gQXBwbGllcyBgdXBkYXRlYCB0byBvbmUgbGF5ZXIgd2hlcmV2ZXIgaXQgc2l0cywgZGVzY2VuZGluZyBpbnRvIGdyb3Vwcy4gYWRkX2NvbGxlY3Rpb25cbi8vIG5lc3RzIGl0cyBwb2ludCwgbGluZSBhbmQgcG9seWdvbiBsYXllcnMgaW5zaWRlIGEgZ3JvdXAgbGF5ZXIsIHNvIGFuIG9wIGFkZHJlc3NlZCBhdCBhXG4vLyBuZXN0ZWQgaWQgd291bGQgb3RoZXJ3aXNlIG1hdGNoIG5vdGhpbmcgYW5kIHNpbGVudGx5IGRvIG5vdGhpbmcuIFJldHVybnMgdGhlIG9yaWdpbmFsXG4vLyBhcnJheSB1bnRvdWNoZWQgd2hlbiB0aGUgaWQgaXMgbm90IGZvdW5kLCBzbyBhbiB1bm1hdGNoZWQgb3AgY29zdHMgbm8gcmUtcmVuZGVyLlxuZnVuY3Rpb24gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgaWQsIHVwZGF0ZSkge1xuICAgIGxldCBoaXQgPSBmYWxzZTtcbiAgICBjb25zdCBuZXh0ID0gbGF5ZXJzLm1hcChsID0+IHtcbiAgICAgICAgaWYgKGwuaWQgPT09IGlkKSB7XG4gICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIHVwZGF0ZShsKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgQXJyYXkuaXNBcnJheShsLmxheWVycykpIHtcbiAgICAgICAgICAgIGNvbnN0IHN1YnMgPSB1cGRhdGVMYXllckJ5SWQobC5sYXllcnMsIGlkLCB1cGRhdGUpO1xuICAgICAgICAgICAgaWYgKHN1YnMgIT09IGwubGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5sLCBsYXllcnM6IHN1YnMgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbDtcbiAgICB9KTtcbiAgICByZXR1cm4gaGl0ID8gbmV4dCA6IGxheWVycztcbn1cblxuLy8gRXZlcnkgcG9pbnQgbGF5ZXIsIHZpc2libGUgb3Igbm90LCB3aXRoIGl0cyBlZmZlY3RpdmUgdmlzaWJpbGl0eSByZWNvcmRlZCAtLSB0aGVcbi8vIEdQVS12aXNpYmlsaXR5IHBhdGgga2VlcHMgaGlkZGVuIGxheWVycyBpbiB0aGUgYnVja2V0IChzdGFibGUgaWRzLCBubyByZWJ1aWxkIG9uIGFcbi8vIHRvZ2dsZSkgYW5kIGhpZGVzIHRoZW0gd2l0aCBhIHVuaWZvcm0gaW5zdGVhZC4gTWlycm9ycyBjb2xsZWN0V2ViZ2xMYXllcnMnIHJ1bGVzOlxuLy8gc3ViLWxheWVycyBpbmhlcml0IHRoZWlyIHBhcmVudCdzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5LCB0b3AtbGV2ZWwgbGF5ZXJzIGFuc3dlciBmb3Jcbi8vIHRoZWlyIG93biBmbGFnIGFuZCB0aGVpciBmb2xkZXIgY2hhaW4uXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3Qgb3V0ID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG4gICAgZnVuY3Rpb24gd2FsayhsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWIpIHtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlbGZWaXMgPSBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IHdhbGsoc3ViLCBzZWxmVmlzLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKCFvdXRbYnVja2V0XSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2aXMgPSBpc1N1YiA/IHBhcmVudFZpc2libGVcbiAgICAgICAgICAgIDogcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgb3V0W2J1Y2tldF0ucHVzaCh7IGxheWVyLCB2aXMgfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB3YWxrKGxheWVyLCB0cnVlLCBmYWxzZSk7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3dpZnRtYXBQYXRjaChzdGF0ZSwgb3BzLCBidWZmZXJzKSB7XG4gICAgbGV0IGxheWVycyA9IHN0YXRlLmxheWVycyB8fCBbXTtcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcblxuICAgIGZvciAoY29uc3Qgb3Agb2Ygb3BzKSB7XG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBvcC5sYXllcnMgfHwgW107XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7fTtcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJzICYmIGJ1ZmZlcnNbaV0pIGJ1ZmZlck1hcFtpZF0gPSBidWZmZXJzW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICAgICAgICBjb25zdCBpbmNvbWluZyA9IG9wLmxheWVyO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBpbmNvbWluZyA/IGluY29taW5nLmlkIDogb3AuaWQ7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBbLi4ubGF5ZXJzLCBpbmNvbWluZ107XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5tYXAoKGwsIGkpID0+IChpID09PSBpZHggPyBpbmNvbWluZyA6IGwpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzZXRcIikge1xuICAgICAgICAgICAgLy8gRmllbGQtbGV2ZWwgdXBkYXRlLiBcInJlcGxhY2VcIiBjYXJyaWVzIHRoZSB3aG9sZSBsYXllciwgc28gZmxpcHBpbmcgYHZpc2libGVgXG4gICAgICAgICAgICAvLyBvbiBhIDUway1wb2ludCBsYXllciByZXNlbnQgZXZlcnkgcHJvcGVydHkgaXQgaG9sZHMgLS0gaGFsZiBhIG1lZ2FieXRlIHRvXG4gICAgICAgICAgICAvLyBjaGFuZ2Ugb25lIGJvb2xlYW4sIG9uIGV2ZXJ5IGNsaWNrIG9mIGEgY2hlY2tib3guXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoeyAuLi5sLCAuLi4ob3AuZmllbGRzIHx8IHt9KSB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic3R5bGVcIikge1xuICAgICAgICAgICAgLy8gUGVyLWZlYXR1cmUgc3R5bGUgb3ZlcnJpZGVzLCByZXBsYWNlZCB3aG9sZXNhbGUgcmF0aGVyIHRoYW4gbWVyZ2VkOiBhXG4gICAgICAgICAgICAvLyBzZWxlY3Rpb24gZGVzY3JpYmVzIGl0cyBjb21wbGV0ZSBzdGF0ZSwgc28gc2VuZGluZyB7fSBjbGVhcnMgaXQgYW5kIG5vXG4gICAgICAgICAgICAvLyBjYWxsZXIgaGFzIHRvIHRyYWNrIHdoYXQgdGhlIHByZXZpb3VzIGhpZ2hsaWdodCB0b3VjaGVkLlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5sLCBzdHlsZV9vdmVycmlkZXM6IG9wLm92ZXJyaWRlcyB8fCB7fSxcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLmZpbHRlcihsID0+IGwuaWQgIT09IG9wLmlkKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJcIikge1xuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XG4gICAgICAgICAgICBpZiAoYnVmKSBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogYnVmIH07XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX3JlbW92ZVwiKSB7XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xuICAgICAgICAgICAgZGVsZXRlIGJ1ZmZlck1hcFtvcC5pZF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBsYXllcnMsIGJ1ZmZlcnM6IGJ1ZmZlck1hcCB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxFcnJvciA9IGNvbnNvbGUuZXJyb3I7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcblxuICAgICAgICAvLyBqc19jb25zb2xlX2xvZ3MgaXMgYSBzeW5jZWQgbGlzdCwgc28gZWFjaCBhcHBlbmQgcmVzZW5kcyB0aGUgd2hvbGUgYXJyYXkuIEtlZXBpbmdcbiAgICAgICAgLy8gb25seSB0aGUgbW9zdCByZWNlbnQgZW50cmllcyBib3VuZHMgYm90aCB0aGUgcGF5bG9hZCBhbmQgdGhlIG1lbW9yeSBhIGxvbmctbGl2ZWRcbiAgICAgICAgLy8gc2Vzc2lvbiBhY2N1bXVsYXRlczsgdGhlIG5ld2VzdCBhcmUgdGhlIG9uZXMgd29ydGggaGF2aW5nIGFueXdheS5cbiAgICAgICAgY29uc3QgTUFYX0NPTlNPTEVfTE9HUyA9IDIwMDtcbiAgICAgICAgY29uc3QgYXBwZW5kTG9nID0gZW50cnkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbG9ncyA9IG1vZGVsLmdldChcImpzX2NvbnNvbGVfbG9nc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBbLi4ubG9ncywgZW50cnldO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQubGVuZ3RoID4gTUFYX0NPTlNPTEVfTE9HUyA/IG5leHQuc2xpY2UoLU1BWF9DT05TT0xFX0xPR1MpIDogbmV4dDtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBIZWxwZXIgdG8gc2FmZWx5IHdyaXRlIGJhY2sgdG8gUHl0aG9uIG9ubHkgaWYgdGhlIHdpZGdldCB2aWV3IGlzIGFjdGl2ZSBhbmQgYXR0YWNoZWRcbiAgICAgICAgZnVuY3Rpb24gc2FmZVNldEFuZFNhdmUoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcbiAgICAgICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyBzYXZlIGVycm9yOlwiLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yID0gZnVuY3Rpb24oLi4uYXJncykge1xuICAgICAgICAgICAgb3JpZ2luYWxFcnJvci5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpKTtcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xuICAgICAgICBjb25zb2xlLndhcm4gPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XG4gICAgICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xuICAgICAgICAgICAgICAgIGlmICghbG9nZ2VkUmVwcm9qZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBtb2RlbC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xlYW5Nc2cgPSBgW1N3aWZ0TWFwXSBMYXllciB3YXMgcmVwcm9qZWN0ZWQgdG8gXCIke2Nyc31cImA7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIGFwcGVuZExvZyhjbGVhbk1zZykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvcmlnaW5hbFdhcm4uYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgd2luZG93Lm9uZXJyb3IgPSBmdW5jdGlvbihtZXNzYWdlLCBzb3VyY2UsIGxpbmVubywgY29sbm8sIGVycm9yKSB7XG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxuICAgICAgICAgICAgICAgIGFwcGVuZExvZyhgV0lORE9XLk9ORVJST1I6ICR7bWVzc2FnZX0gYXQgJHtzb3VyY2V9OiR7bGluZW5vfToke2NvbG5vfWApKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBMb2FkIENTUyBhbmQgTGVhZmxldCBsaWJyYXJpZXMgKGluY2x1ZGluZyBXZWJHTCBnbGlmeSlcbiAgICAgICAgbG9hZENTUyhcImxlYWZsZXQtY3NzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuY3NzXCIpO1xuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWpzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2xpZnlcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0LmdsaWZ5QDMuMy4wL2Rpc3QvZ2xpZnktYnJvd3Nlci5qc1wiKTtcblxuICAgICAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5oZWlnaHQgPSBcIjEwMCVcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xuICAgICAgICBlbC5hcHBlbmRDaGlsZChjb250YWluZXIpO1xuXG4gICAgICAgIGNvbnN0IGNyc05hbWUgPSBtb2RlbC5nZXQoXCJjcnNcIik7XG4gICAgICAgIGxldCBtYXBDcnMgPSBMLkNSUy5FUFNHMzg1NztcbiAgICAgICAgaWYgKGNyc05hbWUgPT09IFwiRVBTRzo0MzI2XCIpIHtcbiAgICAgICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbWFwID0gTC5tYXAoY29udGFpbmVyLCB7XG4gICAgICAgICAgICBjcnM6IG1hcENycyxcbiAgICAgICAgICAgIGNlbnRlcjogbW9kZWwuZ2V0KFwiY2VudGVyXCIpLFxuICAgICAgICAgICAgem9vbTogbW9kZWwuZ2V0KFwiem9vbVwiKSxcbiAgICAgICAgICAgIHNjcm9sbFdoZWVsWm9vbTogdHJ1ZSxcbiAgICAgICAgICAgIHByZWZlckNhbnZhczogdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgY3VzdG9tIHBhbmVzIGZvciBzdHJpY3QgWi1pbmRleCBvcmRlcmluZ1xuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5Z29uc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MTBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5bGluZXNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDIwXCI7XG4gICAgICAgIFxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQzMFwiO1xuXG4gICAgICAgIC8vIExvY2FsIG1pcnJvcnMgb2YgdGhlIGxheWVyIGxpc3QgYW5kIGNvb3JkaW5hdGUgYnVmZmVycy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gUHl0aG9uIHVwZGF0ZXMgdGhlc2UgaW5jcmVtZW50YWxseSB2aWEgXCJzd2lmdG1hcF9wYXRjaFwiIG1lc3NhZ2VzIGluc3RlYWQgb2ZcbiAgICAgICAgLy8gcmVhc3NpZ25pbmcgdGhlIHRyYWl0cywgYmVjYXVzZSBhIHRyYWl0IHJlYXNzaWdubWVudCByZS1zZXJpYWxpemVzIGFuZCByZS1zZW5kc1xuICAgICAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxuICAgICAgICAvLyB3aGVuIGEgdmlldyBhdHRhY2hlcywgYW5kIHRoZSBzaWRlYmFyIHN0aWxsIHdyaXRlcyBgbGF5ZXJzYCBiYWNrIG9uIHRvZ2dsZSwgc29cbiAgICAgICAgLy8gYm90aCBhcmUgc2VlZGVkIGhlcmUgYW5kIGtlcHQgaW4gc3RlcCBieSB0aGUgY2hhbmdlIGhhbmRsZXJzIGZ1cnRoZXIgZG93bi5cbiAgICAgICAgbGV0IGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcblxuICAgICAgICBmdW5jdGlvbiBhcHBseVBhdGNoT3BzKG9wcywgYnVmZmVycykge1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBuZXh0LmxheWVycztcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0gbmV4dC5idWZmZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWN0aXZlVGlsZUxheWVycyA9IHt9O1xuICAgICAgICBjb25zdCBhY3RpdmVPdmVybGF5TGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGdsU3RhdGVzID0ge1xuICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5Z29uOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFRoZSBzaGFyZWQgdGltZSBzbGlkZXIuIGB0aW1lU3RhdGVgIGlzIHdoYXQgcmVuZGVyaW5nIHJlYWRzIC0tIHRoZSBjdXJyZW50IHRpY2tcbiAgICAgICAgLy8gYW5kIHRoZSBwZXJpb2QsIG9yIG51bGwgd2hlbiBub3RoaW5nIGlzIGFuaW1hdGVkIC0tIGFuZCBgdGltZVVJYCBpcyB0aGUgc2xpZGVyJ3NcbiAgICAgICAgLy8gb3duIGJvb2trZWVwaW5nLiBQbGF5YmFjayBuZXZlciByb3VuZC10cmlwcyB0aHJvdWdoIFB5dGhvbjogdGlja3MgcmUtcmVuZGVyXG4gICAgICAgIC8vIGxvY2FsbHksIGFuZCB0aW1lX2N1cnJlbnQgaXMgd3JpdHRlbiBiYWNrIGF0IG1vc3Qgb25jZSBhIHNlY29uZCB3aGlsZSBwbGF5aW5nLlxuICAgICAgICBsZXQgdGltZVN0YXRlID0gbnVsbDtcbiAgICAgICAgY29uc3QgdGltZVVJID0geyB0aWNrczogW10sIGtleTogXCJcIiwgaW5kZXg6IDAsIHBsYXlpbmc6IGZhbHNlLCBsb29wOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBzcGVlZDogMSwgdGltZXI6IG51bGwsIGxhc3RXcml0ZTogMCwgc3RhcnRlZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93OiBudWxsLCBwZXJpb2RNczogbnVsbCwgZ3JpZE1zOiBudWxsIH07XG5cbiAgICAgICAgZnVuY3Rpb24gc3RvcFBsYXliYWNrKCkge1xuICAgICAgICAgICAgaWYgKHRpbWVVSS50aW1lcikgY2xlYXJJbnRlcnZhbCh0aW1lVUkudGltZXIpO1xuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gbnVsbDtcbiAgICAgICAgICAgIHRpbWVVSS5wbGF5aW5nID0gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiB3cml0ZVRpbWVDdXJyZW50KGZvcmNlKSB7XG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgaWYgKCFmb3JjZSAmJiBub3cgLSB0aW1lVUkubGFzdFdyaXRlIDwgMTAwMCkgcmV0dXJuO1xuICAgICAgICAgICAgdGltZVVJLmxhc3RXcml0ZSA9IG5vdztcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwidGltZV9jdXJyZW50XCIsIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc2Vla1RvKGluZGV4LCB7IHdyaXRlID0gdHJ1ZSB9ID0ge30pIHtcbiAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkpO1xuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3c6IHRpbWVVSS53aW5kb3cgfTtcbiAgICAgICAgICAgIGlmICh3cml0ZSkgd3JpdGVUaW1lQ3VycmVudCghdGltZVVJLnBsYXlpbmcpO1xuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc3RhcnRQbGF5YmFjaygpIHtcbiAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhZHZhbmNlKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCwgdGltZVVJLmxvb3ApO1xuICAgICAgICAgICAgICAgIGlmICghbmV4dC5wbGF5aW5nKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHNlZWtUbyhuZXh0LmluZGV4KTtcbiAgICAgICAgICAgIH0sIDEwMDAgLyB0aW1lVUkuc3BlZWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGltZUhhbmRsZXJzID0ge1xuICAgICAgICAgICAgb25TZWVrOiAoaW5kZXgpID0+IHNlZWtUbyhpbmRleCksXG4gICAgICAgICAgICBvblN0ZXBCYWNrOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4IC0gMSksXG4gICAgICAgICAgICBvblN0ZXBGb3J3YXJkOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4ICsgMSksXG4gICAgICAgICAgICBvblBsYXlUb2dnbGU6ICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gc3RhcnRPdmVyLCBhcyB0aGUgZm9saXVtIHBsYXllciB3YXMgY29uZmlndXJlZDogcHJlc3NpbmcgcGxheSBhdFxuICAgICAgICAgICAgICAgICAgICAvLyB0aGUgZW5kIHJlc3RhcnRzIGZyb20gdGhlIGJlZ2lubmluZyBpbW1lZGlhdGVseSwgcmF0aGVyIHRoYW4gb25lXG4gICAgICAgICAgICAgICAgICAgIC8vIHNpbGVudCBpbnRlcnZhbCBsYXRlciBkZWNpZGluZyB0aGVyZSBpcyBub3doZXJlIHRvIGdvIGFuZCBzdG9wcGluZy5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5pbmRleCA+PSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkgc2Vla1RvKDApO1xuICAgICAgICAgICAgICAgICAgICBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25Mb29wVG9nZ2xlOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmxvb3AgPSAhdGltZVVJLmxvb3A7XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblNwZWVkOiAoc3BlZWQpID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBzcGVlZDtcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBMaXZlIGR1cmluZyB0aGUgZHJhZzogbG9jYWwgc3RhdGUgYW5kIGEgcmUtcmVuZGVyIG9mIHRoZSBjb250cm9sIG9uIGV2ZXJ5XG4gICAgICAgICAgICAvLyBtb3ZlLCBidXQgbWFwIHJlYnVpbGRzIGF0IG1vc3QgZXZlcnkgMzAwbXMuIEF0IDVNIHBvaW50cyBhIHJlYnVpbGQgY29zdHNcbiAgICAgICAgICAgIC8vIHNlY29uZHMsIGFuZCBhIGRyYWcgZmlyZXMgZG96ZW5zIG9mIG1vdmVzIC0tIHVudGhyb3R0bGVkLCB0aGUgcmVidWlsZHNcbiAgICAgICAgICAgIC8vIHN0YWNrIGZhc3RlciB0aGFuIHRoZXkgZmluaXNoIGFuZCB0aGUgYWxsb2NhdGlvbiBjaHVybiBjcmFzaGVzIHRoZSB0YWIuXG4gICAgICAgICAgICBvbldpbmRvd0RyYWc6IChpc28pID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGlzbztcbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB0aW1lU3RhdGUgPSB7IC4uLnRpbWVTdGF0ZSwgd2luZG93OiBpc28gfTtcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vdyAtICh0aW1lVUkubGFzdERyYWdTeW5jIHx8IDApID49IDMwMCkge1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkubGFzdERyYWdTeW5jID0gbm93O1xuICAgICAgICAgICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gT24gcmVsZWFzZSAob3IgYSBrZXlib2FyZCBzdGVwKTogdGhlIG92ZXJyaWRlIGxhbmRzIGluIHRpbWVfY29uZmlnIHNvXG4gICAgICAgICAgICAvLyBQeXRob24gYW5kIFNoaW55IHNlZSB0aGUgc2FtZSB3aW5kb3cgdGhlIGJhciBzaG93cy4gbnVsbCBjbGVhcnMgdGhlIGtleSxcbiAgICAgICAgICAgIC8vIGhhbmRpbmcgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXG4gICAgICAgICAgICBvbldpbmRvd0NvbW1pdDogKGlzbykgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVIYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpOyAgICAgICAvLyB0aGUgcmVsZWFzZSBhbHdheXMgbGFuZHMsIHRocm90dGxlIG9yIG5vdFxuICAgICAgICAgICAgICAgIGNvbnN0IGNmZyA9IHsgLi4uKG1vZGVsLmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9KSB9O1xuICAgICAgICAgICAgICAgIGlmIChpc28pIGNmZy53aW5kb3cgPSBpc287XG4gICAgICAgICAgICAgICAgZWxzZSBkZWxldGUgY2ZnLndpbmRvdztcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ0aW1lX2NvbmZpZ1wiLCBjZmcpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgbG9jYWwgbW9kZWwgc3RpbGwgaG9sZHMgaXQgKi8gfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDcmVhdGVzLCByZXR1bmVzIG9yIHJlbW92ZXMgdGhlIHNsaWRlciB0byBtYXRjaCB0aGUgbGF5ZXJzIHByZXNlbnQuIFRpY2tzIGFyZVxuICAgICAgICAvLyByZWdlbmVyYXRlZCBvbmx5IHdoZW4gdGhlIGRhdGEncyB0aW1lIGV4dGVudCBvciB0aGUgcGVyaW9kIGNoYW5nZXMsIHNvIGFcbiAgICAgICAgLy8gcGxheWJhY2sgdGljayAtLSB3aGljaCByZS1lbnRlcnMgaGVyZSB2aWEgcXVldWVTeW5jIC0tIGRvZXMgbm90IHJlYnVpbGQgdGhlbS5cbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlVGltZURpbWVuc2lvbigpIHtcbiAgICAgICAgICAgIGlmICghaGFzVGltZUxheWVycyhsYXllclN0YXRlKSkge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB7IHRpY2tzOiBbXSB9LCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0gXCJcIjtcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBwZXJpb2QgPSBwYXJzZVBlcmlvZChjZmcucGVyaW9kIHx8IFwiUDFEXCIpIHx8IHBhcnNlUGVyaW9kKFwiUDFEXCIpO1xuICAgICAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xuICAgICAgICAgICAgaWYgKCFleHRlbnQpIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7ZXh0ZW50Lm1pbn18JHtleHRlbnQubWF4fXwke2NmZy5wZXJpb2QgfHwgXCJQMURcIn1gO1xuICAgICAgICAgICAgaWYgKGtleSAhPT0gdGltZVVJLmtleSkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBrZXk7XG4gICAgICAgICAgICAgICAgdGltZVVJLnRpY2tzID0gZ2VuZXJhdGVUaWNrcyhleHRlbnQubWluLCBleHRlbnQubWF4LCBwZXJpb2QpO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWluKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBUaGUgc2hhcmVkIHdpbmRvdyBvdmVycmlkZSwgY29uZmlnLWRyaXZlbjsgYSBiYWQgc3RyaW5nIGNsZWFycyByYXRoZXIgdGhhblxuICAgICAgICAgICAgLy8gZ3Vlc3NpbmcuIFRoZSBkcmFnIGdyaWQgaXMgdGhlIGdjZCBvZiB0aGUgaW50ZXJ2YWwgYW5kIGV2ZXJ5IGF0dGFjaGVkXG4gICAgICAgICAgICAvLyBkdXJhdGlvbiAtLSB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gYWxsIG9mIHRoZW0gLS0gc28gYSAyLjVoIHRyYWlsXG4gICAgICAgICAgICAvLyBpcyBkcmFnZ2FibGUgb24gYSAxaCBiYXIuIENhbGVuZGFyIHBlcmlvZHMgaGF2ZSBubyBmaXhlZCB3aWR0aDsgdGhlIHJ1bGVyXG4gICAgICAgICAgICAvLyB0aGVuIHNob3dzIGludGVydmFsIG1hcmtzIG9ubHkgYW5kIHRoZSB0cmFpbCBoYW5kbGUgaGlkZXMuXG4gICAgICAgICAgICAvLyBOZXZlciB3aGlsZSBhIGRyYWcgaXMgbGl2ZTogdGhlIGRyYWdnZWQgd2luZG93IGV4aXN0cyBvbmx5IGxvY2FsbHkgdW50aWxcbiAgICAgICAgICAgIC8vIHJlbGVhc2UgY29tbWl0cyBpdCwgYW5kIHJlYWRpbmcgY29uZmlnIGhlcmUgbWlkLWRyYWcgcmVzZXQgdGhlIGhhbmRsZSB0b1xuICAgICAgICAgICAgLy8gXCJubyB3aW5kb3dcIiBvbiBldmVyeSBkZWJvdW5jZWQgc3luYyAtLSB0aGUgaGFuZGxlIGZvbGxvd2VkIHRoZSBtb3VzZSwgdGhlblxuICAgICAgICAgICAgLy8gc25hcHBlZCBob21lLCB0aGVuIGZvbGxvd2VkIGFnYWluLCBvbmNlIHBlciBzeW5jLlxuICAgICAgICAgICAgaWYgKCF0aW1lVUkuZHJhZ0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBjZmcud2luZG93ICYmIHBhcnNlUGVyaW9kKGNmZy53aW5kb3cpID8gY2ZnLndpbmRvdyA6IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aW1lVUkucGVyaW9kTXMgPSBwZXJpb2RUb01zKHBlcmlvZCk7XG4gICAgICAgICAgICB0aW1lVUkuZ3JpZE1zID0gdGltZVVJLnBlcmlvZE1zXG4gICAgICAgICAgICAgICAgPyBnY2RHcmlkTXModGltZVVJLnBlcmlvZE1zLCBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJTdGF0ZSwgdGltZVVJLndpbmRvdykpXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QsIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xuICAgICAgICAgICAgdGltZVVJLnBvc2l0aW9uID0gY2ZnLnBvc2l0aW9uIHx8IFwidG9wLWNlbnRlclwiO1xuXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5zdGFydGVkKSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IGNmZy5zcGVlZCB8fCAxO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5sb29wID0gQm9vbGVhbihjZmcubG9vcCk7XG4gICAgICAgICAgICAgICAgLy8gT25seSB0aGUgZmlyc3QgY29uZmlndXJhdGlvbiBtYXkgYXV0by1zdGFydC4gRXZlcnkgY29uZmlnIGNoYW5nZSByZXNldHNcbiAgICAgICAgICAgICAgICAvLyBgc3RhcnRlZGAgdG8gcmUtcmVhZCBzcGVlZCBhbmQgbG9vcCAtLSBpbmNsdWRpbmcgdGhlIGNoYW5nZSBhIHdpbmRvd1xuICAgICAgICAgICAgICAgIC8vIGRyYWcgY29tbWl0cyAtLSBhbmQgcmUtcnVubmluZyBhdXRvX3BsYXkgdGhlcmUgd291bGQgc3RhcnQgcGxheWJhY2sgYXNcbiAgICAgICAgICAgICAgICAvLyBhIHNpZGUgZWZmZWN0IG9mIHJlbGVhc2luZyB0aGUgaGFuZGxlLlxuICAgICAgICAgICAgICAgIGlmIChjZmcuYXV0b19wbGF5ICYmICF0aW1lVUkuZXZlclN0YXJ0ZWQpIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZXZlclN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNpZGViYXIgTGF5ZXJzIENvbnRyb2wgVUlcbiAgICAgICAgY29uc3Qgc2lkZWJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUudG9wID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjVweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUub3ZlcmZsb3dZID0gXCJhdXRvXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuZm9udEZhbWlseSA9IFwiLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU2Vnb2UgVUknLCBSb2JvdG8sIHNhbnMtc2VyaWZcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmNvbG9yID0gXCIjMzMzXCI7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChzaWRlYmFyKTtcblxuICAgICAgICAvLyBMb2dvXG4gICAgICAgIGNvbnN0IGxvZ29EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJvdHRvbSA9IFwiMTBweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnJpZ2h0ID0gXCIxMHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5wYWRkaW5nID0gXCI1cHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjRweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgbG9nb0Rpdi5pbm5lckhUTUwgPSBgXG4gICAgICAgICAgICA8ZGl2IHN0eWxlPVwiZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjtcIj5cbiAgICAgICAgICAgICAgICA8aW1nIHNyYz1cImh0dHBzOi8vcmVwby9hc3NldHMvaW1hZ2UucG5nXCIgYWx0PVwiQ29tcGFueVwiIHN0eWxlPVwiaGVpZ2h0OiAzNXB4OyBtYXJnaW4tcmlnaHQ6IDVweDtcIj5cbiAgICAgICAgICAgICAgICA8aW1nIHNyYz1cImh0dHBzOi8vcmVwby9hc3NldHMvaW1hZ2UyLnBuZ1wiIGFsdD1cIlBhcmVudCBDb21wYW55XCIgc3R5bGU9XCJoZWlnaHQ6IDM1cHg7XCI+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgYDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxvZ29EaXYpO1xuXG5cblxuICAgICAgICBmdW5jdGlvbiBnZXRUaWxlTGF5ZXIobGF5ZXIpIHtcbiAgICAgICAgICAgIHJldHVybiBMLnRpbGVMYXllcihsYXllci51cmwsIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGlvbjogbGF5ZXIuYXR0cmlidXRpb24gfHwgJycsXG4gICAgICAgICAgICAgICAgbWF4Wm9vbTogbGF5ZXIubWF4X3pvb20gfHwgMjIsXG4gICAgICAgICAgICAgICAgbWF4TmF0aXZlWm9vbTogbGF5ZXIubWF4X25hdGl2ZV96b29tIHx8IDE5XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNNYXBTdGF0ZSgpIHtcbiAgICAgICAgICAgIGNvbnNvbGUudGltZShcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xuICAgICAgICAgICAgdXBkYXRlVGltZURpbWVuc2lvbigpO1xuICAgICAgICAgICAgY29uc3QgbGF5ZXJzID0gbGF5ZXJTdGF0ZTtcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IG1vZGVsLmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IGJ1ZmZlclN0YXRlO1xuXG4gICAgICAgICAgICAvLyBFbmZvcmNlIG11dHVhbGx5IGV4Y2x1c2l2ZSByYWRpbyBncm91cCB2aXNpYmlsaXR5IGJlZm9yZSBjb2xsZWN0aW5nIG9yIHJlbmRlcmluZyBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGNvbnN0IHJhZGlvQ2hhbmdlZCA9IG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIGlmIChyYWRpb0NoYW5nZWQgJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJsYXllcnNcIiwgWy4uLmxheWVyc10pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImdyb3VwX2NvbmZpZ3NcIiwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gbW9kZWwuZ2V0KFwic2hvd19sb2dvXCIpID8gXCJibG9ja1wiIDogXCJub25lXCI7XG5cbiAgICAgICAgICAgIC8vIEdyb3VwIHZpc2libGUgbGF5ZXJzIChpbmNsdWRpbmcgc3ViLWxheWVycyBpbnNpZGUgZ3JvdXBzKSB0byBhbHdheXMgdXNlIFdlYkdMXG4gICAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgIHBvbHlsaW5lOiB3ZWJnbFBvbHlsaW5lTGF5ZXJzLFxuICAgICAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyxcbiAgICAgICAgICAgIH0gPSBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xuXG4gICAgICAgICAgICAvLyBTZXQgb2YgbGF5ZXIgSURzIHByb2Nlc3NlZCB2aWEgbWVyZ2VkIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgY29uc3Qgd2ViZ2xMYXllcklkcyA9IG5ldyBTZXQoW1xuICAgICAgICAgICAgICAgIC4uLndlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsUG9seWxpbmVMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzLm1hcChsID0+IGwuaWQpXG4gICAgICAgICAgICBdKTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHJldGlyZWQgb3ZlcmxheSBsYXllcnMsIGluY2x1ZGluZyB0aG9zZSB0aGF0IHRyYW5zaXRpb25lZCB0byBXZWJHTFxuICAgICAgICAgICAgT2JqZWN0LmtleXMoYWN0aXZlT3ZlcmxheUxheWVycykuZm9yRWFjaChpZCA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKSB8fCB3ZWJnbExheWVySWRzLmhhcyhpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gUHJvY2VzcyBub24tV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGVmZmVjdGl2ZVZpc2libGUgPSBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJiYXNlbWFwXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVmZmVjdGl2ZVZpc2libGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRpbGUgPSBnZXRUaWxlTGF5ZXIobGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbGUuYWRkVG8obWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdID0gdGlsZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvLyBTa2lwIGxheWVycyBtYW5hZ2VkIGJ5IHRoZSBtZXJnZWQgV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICAgICAgaWYgKHdlYmdsTGF5ZXJJZHMuaGFzKGxheWVyLmlkKSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWVmZmVjdGl2ZVZpc2libGUgfHwgIWxheWVySW5XaW5kb3cobGF5ZXIsIGJ1ZmZlclN0YXRlLCB0aW1lU3RhdGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZy5sYXllclR5cGUgIT09IGxheWVyLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXSwgbW9kZWwpO1xuICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSA9IGluc3RhbmNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSGVscGVyIHRvIHN5bmMgV2ViR0wgbGF5ZXIgc3RhdGVzIGFuZCByZWJ1aWxkIG9ubHkgaWYgY2hhbmdlZFxuICAgICAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY0dsTGF5ZXIodHlwZSwgdmlzaWJsZUxheWVycywgdmVjdG9yR3B1ID0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZHNTdHJpbmcgPSB2aXNpYmxlTGF5ZXJzLm1hcChsID0+IGwuaWQpLnNvcnQoKS5qb2luKFwiLFwiKTtcbiAgICAgICAgICAgICAgICAvLyBFdmVyeXRoaW5nIHRoZSBidWlsdCBidWZmZXJzIGRlcGVuZCBvbiBiZWxvbmdzIGluIHRoaXMga2V5OiBhIGNoYW5nZSB0aGF0XG4gICAgICAgICAgICAgICAgLy8gaXMgbm90IGluIGl0IHJlbmRlcnMgc3RhbGUuIGhpZ2hsaWdodF9zdHlsZSBhbmQgc3R5bGVfb3ZlcnJpZGVzIHdlcmVcbiAgICAgICAgICAgICAgICAvLyBtaXNzaW5nIGF0IGZpcnN0LCBzbyBhIGhpZ2hsaWdodCBsYW5kZWQgaW4gc3RhdGUgYW5kIG5ldmVyIHJlcGFpbnRlZC5cbiAgICAgICAgICAgICAgICAvLyBQb2ludCBidWNrZXRzIG9uIHRoZSBHUFUgcGF0aCBleGNsdWRlIHRoZSB0aWNrIGFuZCB3aW5kb3cgZnJvbSB0aGUga2V5OlxuICAgICAgICAgICAgICAgIC8vIHRob3NlIGNoYW5nZSBwZXIgdGljayBhbmQgYXJlIGFwcGxpZWQgYXMgdW5pZm9ybXMsIG5vdCBieSByZWJ1aWxkaW5nLlxuICAgICAgICAgICAgICAgIC8vIFRoZSBwZXJpb2Qgc3RheXMgaW4sIHNpbmNlIGl0IGlzIGJha2VkIGludG8gdGhlIGR1cmF0aW9uIGF0dHJpYnV0ZXMuXG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyBlbHNlIC0tIGFuZCBldmVyeSBub24tcG9pbnQgYnVja2V0IC0tIHJlYnVpbGRzIGFzIGJlZm9yZS5cbiAgICAgICAgICAgICAgICBjb25zdCBncHVQb2ludHMgPSAoKHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIilcbiAgICAgICAgICAgICAgICAgICAgJiYgZ3B1VGltZUF2YWlsYWJsZSgpKSB8fCB2ZWN0b3JHcHU7XG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHZpc2libGVMYXllcnMubWFwKGwgPT4gKHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGwuaWQsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBsLmNvbG9yLFxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IGwucmFkaXVzLFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IGwud2VpZ2h0LFxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiBsLm9wYWNpdHksXG4gICAgICAgICAgICAgICAgICAgIGZpbGxPcGFjaXR5OiBsLmZpbGxPcGFjaXR5LFxuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHQ6IGwuaGlnaGxpZ2h0X3N0eWxlLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZXM6IGwuc3R5bGVfb3ZlcnJpZGVzLFxuICAgICAgICAgICAgICAgICAgICBmZWF0dXJlU3R5bGVzOiBsLmZlYXR1cmVfc3R5bGVzLFxuICAgICAgICAgICAgICAgICAgICB0aW1lOiBsLnRpbWUsXG4gICAgICAgICAgICAgICAgICAgIGdwdTogZ3B1UG9pbnRzLFxuICAgICAgICAgICAgICAgICAgICB0aWNrOiBsLnRpbWUgJiYgdGltZVN0YXRlICYmICFncHVQb2ludHMgPyB0aW1lU3RhdGUudGljayA6IDAsXG4gICAgICAgICAgICAgICAgICAgIHdpbjogbC50aW1lICYmIHRpbWVTdGF0ZSAmJiAhZ3B1UG9pbnRzID8gdGltZVN0YXRlLndpbmRvdyA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIHBlcjogbC50aW1lICYmIGdwdVBvaW50cyAmJiB0aW1lU3RhdGVcbiAgICAgICAgICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodGltZVN0YXRlLnBlcmlvZCkgOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBidWZMZW46IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdPy5ieXRlTGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGxvY0xlbjogbC5sb2NhdGlvbnM/Lmxlbmd0aCB8fCAwXG4gICAgICAgICAgICAgICAgfSkpKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGVDaGFuZ2VkID0gc3RhdGUuaWRzICE9PSBpZHNTdHJpbmcgfHwgc3RhdGUubWV0YSAhPT0gbWV0YVN0cmluZztcblxuICAgICAgICAgICAgICAgIGlmIChzdGF0ZUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAodmlzaWJsZUxheWVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IGF3YWl0IHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCB2aXNpYmxlTGF5ZXJzLCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsIHRpbWVTdGF0ZSwgdmVjdG9yR3B1KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc3RhdGUuaWRzID0gaWRzU3RyaW5nO1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5tZXRhID0gbWV0YVN0cmluZztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgaG9sZGluZyB0aW1lIGxheWVycyBrZWVwIEVWRVJZIHBvaW50IGxheWVyIC0tIGhpZGRlbiBvbmVzXG4gICAgICAgICAgICAvLyBpbmNsdWRlZCAtLSBzbyBhIHNpZGViYXIgdG9nZ2xlIGNoYW5nZXMgYSB2aXNpYmlsaXR5IHVuaWZvcm0gaW5zdGVhZCBvZlxuICAgICAgICAgICAgLy8gdGhlIGJ1Y2tldCdzIGlkcy4gVW5jaGVja2luZyBvbmUgb2YgMjUgdHJhY2tzIHVzZWQgdG8gcmVidWlsZCBhbGwgNU1cbiAgICAgICAgICAgIC8vIHBvaW50czsgY2xpY2tpbmcgZG93biB0aGUgc2lkZWJhciBzdGFja2VkIHRob3NlIHJlYnVpbGRzIGludG8gYSBjcmFzaC5cbiAgICAgICAgICAgIGNvbnN0IGFsbEJ5VHlwZSA9IGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICBjb25zdCBidWNrZXQgPSB7IGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlsaW5lOiB3ZWJnbFBvbHlsaW5lTGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMgfTtcbiAgICAgICAgICAgIGNvbnN0IHZlY3RvckdwdUJ1Y2tldCA9IHsgcG9seWxpbmU6IGZhbHNlLCBwb2x5Z29uOiBmYWxzZSB9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGVudHJpZXMgPSBhbGxCeVR5cGVbdHlwZV07XG4gICAgICAgICAgICAgICAgY29uc3QgaXNQb2ludHMgPSB0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCI7XG4gICAgICAgICAgICAgICAgY29uc3QgYXZhaWxhYmxlID0gaXNQb2ludHMgPyBncHVUaW1lQXZhaWxhYmxlKCkgOiB2ZWN0b3JHcHVBdmFpbGFibGUoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBncHVWaXMgPSBhdmFpbGFibGUgJiYgZW50cmllcy5sZW5ndGggPiAwXG4gICAgICAgICAgICAgICAgICAgICYmIGVudHJpZXMubGVuZ3RoIDw9IExBWUVSX1NMT1RTXG4gICAgICAgICAgICAgICAgICAgICYmIGVudHJpZXMuc29tZShlID0+IGUubGF5ZXIudGltZSk7XG4gICAgICAgICAgICAgICAgZ2xTdGF0ZXNbdHlwZV0udmlzVmVjdG9yID0gZ3B1VmlzID8gZW50cmllcy5tYXAoZSA9PiAoZS52aXMgPyAxIDogMCkpIDogbnVsbDtcbiAgICAgICAgICAgICAgICBpZiAoZ3B1VmlzKSBidWNrZXRbdHlwZV0gPSBlbnRyaWVzLm1hcChlID0+IGUubGF5ZXIpO1xuICAgICAgICAgICAgICAgIGlmICghaXNQb2ludHMpIHZlY3RvckdwdUJ1Y2tldFt0eXBlXSA9IGdwdVZpcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJjaXJjbGVfbWFya2Vyc1wiLCBidWNrZXQuY2lyY2xlX21hcmtlcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJtYXJrZXJzXCIsIGJ1Y2tldC5tYXJrZXJzKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWxpbmVcIiwgYnVja2V0LnBvbHlsaW5lLCB2ZWN0b3JHcHVCdWNrZXQucG9seWxpbmUpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5Z29uXCIsIGJ1Y2tldC5wb2x5Z29uLCB2ZWN0b3JHcHVCdWNrZXQucG9seWdvbik7XG5cbiAgICAgICAgICAgIC8vIFB1c2ggdGhlIGN1cnJlbnQgd2luZG93IGludG8gdGhlIEdQVS1maWx0ZXJlZCBwb2ludCBidWNrZXRzOiB0d28gdW5pZm9ybXNcbiAgICAgICAgICAgIC8vIGFuZCBhIHJlZHJhdywgd2hpY2ggaXMgdGhlIGVudGlyZSBwZXItdGljayBjb3N0IG9mIHRoZSB0aW1lIHNsaWRlciB0aGVyZS5cbiAgICAgICAgICAgIGZvciAoY29uc3QgdHlwZSBvZiBbXCJjaXJjbGVfbWFya2Vyc1wiLCBcIm1hcmtlcnNcIiwgXCJwb2x5bGluZVwiLCBcInBvbHlnb25cIl0pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGhhbmRsZSA9IHN0YXRlLmxheWVyICYmIHN0YXRlLmxheWVyLl9zd2lmdG1hcFRpbWU7XG4gICAgICAgICAgICAgICAgaWYgKCFoYW5kbGUpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIC8vIExheWVyIHZpc2liaWxpdHkgZmlyc3QsIGFuZCBvbmx5IHdoZW4gaXQgY2hhbmdlZDogYSB0b2dnbGUgY29zdHMgb25lXG4gICAgICAgICAgICAgICAgLy8gdW5pZm9ybSBhcnJheSB3cml0ZSBhbmQgYSByZWRyYXcsIG5ldmVyIGEgcmVidWlsZC5cbiAgICAgICAgICAgICAgICBjb25zdCB2aXMgPSBzdGF0ZS52aXNWZWN0b3I7XG4gICAgICAgICAgICAgICAgaWYgKHZpcykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSB2aXMuam9pbihcIlwiKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLnZpc0tleSAhPT0ga2V5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS52aXNLZXkgPSBrZXk7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0TGF5ZXJWaXNpYmlsaXR5KHZpcyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBvdmVycmlkZU1zID0gdGltZVN0YXRlLndpbmRvd1xuICAgICAgICAgICAgICAgICAgICAgICAgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHRpbWVTdGF0ZS53aW5kb3cpKSA6IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3codGltZVN0YXRlLnRpY2ssIG92ZXJyaWRlTXMpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3cobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZW5kZXJTaWRlYmFyQ29udHJvbHMoc2lkZWJhciwgbGF5ZXJzLCBtb2RlbCwgbWFwLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc29sZS50aW1lRW5kKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgbGV0IGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xuXG4gICAgICAgIC8vIEJpbmQgem9vbSBhbmQgY2VudGVyIGNoYW5nZXMgYmFjayB0byBQeXRob24gc2FmZWx5XG4gICAgICAgIG1hcC5vbihcIm1vdmVlbmRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGVsQ2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGVsWm9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtb2RlbFpvb20gIT09IGN1cnJlbnRab29tO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSAhbW9kZWxDZW50ZXIgfHwgXG4gICAgICAgICAgICAgICAgICAgICFBcnJheS5pc0FycmF5KG1vZGVsQ2VudGVyKSB8fFxuICAgICAgICAgICAgICAgICAgICBtb2RlbENlbnRlci5sZW5ndGggPCAyIHx8XG4gICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzBdIC0gY2VudGVyLmxhdCkgPiAwLjAwMDEgfHwgXG4gICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzFdIC0gY2VudGVyLmxuZykgPiAwLjAwMDE7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2VudGVyXCIsIFtjZW50ZXIubGF0LCBjZW50ZXIubG5nXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ6b29tXCIsIGN1cnJlbnRab29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgc2FmZVNhdmVDaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIG1vdmVlbmQgaGFuZGxlcjpcIiwgZXJyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlTWFwVmlldygpIHtcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1vZGVsLmdldChcImNlbnRlclwiKTtcbiAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgaWYgKGNlbnRlciAmJiBBcnJheS5pc0FycmF5KGNlbnRlcikgJiYgY2VudGVyLmxlbmd0aCA+PSAyKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWFwQ2VudGVyID0gbWFwLmdldENlbnRlcigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hcFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSBNYXRoLmFicyhtYXBDZW50ZXIubGF0IC0gY2VudGVyWzBdKSA+IDAuMDAwMSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobWFwQ2VudGVyLmxuZyAtIGNlbnRlclsxXSkgPiAwLjAwMDE7XG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtYXBab29tICE9PSB6b29tO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkIHx8IHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRWaWV3KGNlbnRlciwgdHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgPyB6b29tIDogbWFwWm9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgJiYgbWFwLmdldFpvb20oKSAhPT0gem9vbSkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbSh6b29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYXRjaCBmb3IgbWFwIHZpZXcgdXBkYXRlcyBmcm9tIFB5dGhvblxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpjZW50ZXJcIiwgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwKSB7XG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp6b29tXCIsICgpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nWm9vbUZyb21NYXApIHtcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBGaXR0aW5nIHRoZSB2aWV3IGlzIGEgY29tbWFuZCwgbm90IHN0YXRlOiBhc2tpbmcgdG8gZml0IHRoZSBzYW1lIGJvdW5kcyB0d2ljZVxuICAgICAgICAvLyBtdXN0IG1vdmUgdGhlIG1hcCBib3RoIHRpbWVzLCBzaW5jZSB0aGUgdXNlciBtYXkgaGF2ZSBwYW5uZWQgYXdheSBpbiBiZXR3ZWVuLlxuICAgICAgICAvLyBUaGUgcmVxdWVzdCBjYXJyaWVzIGEgc2VxdWVuY2UgbnVtYmVyIHNvIGFuIGlkZW50aWNhbCBmaXQgc3RpbGwgZmlyZXMgYSBjaGFuZ2UuXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmZpdF9ib3VuZHNfcmVxdWVzdFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCByZXEgPSBtb2RlbC5nZXQoXCJmaXRfYm91bmRzX3JlcXVlc3RcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBib3VuZHMgPSByZXEuYm91bmRzO1xuICAgICAgICAgICAgaWYgKCFib3VuZHMgfHwgYm91bmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBvcHRpb25zID0ge307XG4gICAgICAgICAgICBpZiAocmVxLnBhZGRpbmcgIT0gbnVsbCkgb3B0aW9ucy5wYWRkaW5nID0gW3JlcS5wYWRkaW5nLCByZXEucGFkZGluZ107XG4gICAgICAgICAgICBpZiAocmVxLm1heF96b29tICE9IG51bGwpIG9wdGlvbnMubWF4Wm9vbSA9IHJlcS5tYXhfem9vbTtcbiAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgLy8gQXBwbGllZCBhZnRlciB0aGUgZml0LCBzaW5jZSBpdCBpcyByZWxhdGl2ZSB0byB3aGF0ZXZlciB6b29tIHRoZSBmaXQgY2hvc2UuXG4gICAgICAgICAgICBpZiAocmVxLnpvb21fb2Zmc2V0KSB7XG4gICAgICAgICAgICAgICAgbWFwLnNldFpvb20obWFwLmdldFpvb20oKSArIHJlcS56b29tX29mZnNldCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCBzeW5jVGltZW91dCA9IG51bGw7XG4gICAgICAgIGxldCBpc1N5bmNpbmcgPSBmYWxzZTtcbiAgICAgICAgbGV0IG5lZWRzU3luYyA9IGZhbHNlO1xuXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1TeW5jKCkge1xuICAgICAgICAgICAgaWYgKGlzU3luY2luZykge1xuICAgICAgICAgICAgICAgIG5lZWRzU3luYyA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaXNTeW5jaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgc3luY01hcFN0YXRlKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gc3luY01hcFN0YXRlOlwiLCBlcnIpO1xuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICBpc1N5bmNpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBpZiAobmVlZHNTeW5jKSB7XG4gICAgICAgICAgICAgICAgICAgIG5lZWRzU3luYyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHF1ZXVlU3luYygpIHtcbiAgICAgICAgICAgIGlmICghbW9kZWwuZ2V0KFwiYXV0b19zeW5jXCIpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHN5bmNUaW1lb3V0KSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lb3V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBudWxsO1xuICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICB9LCA1MCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMaXN0ZW4gZm9yIG1hbnVhbCBzeW5jIHRyaWdnZXIgY2hhbmdlcyBmcm9tIFB5dGhvblxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzeW5jX3RyaWdnZXJcIiwgKCkgPT4ge1xuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSW5jcmVtZW50YWwgdXBkYXRlcyBmcm9tIFB5dGhvbi4gQXBwbGllZCBldmVuIHdoZW4gYXV0b19zeW5jIGlzIG9mZiBzbyB0aGUgbWlycm9yXG4gICAgICAgIC8vIHN0YXlzIGN1cnJlbnQ7IHF1ZXVlU3luYyBkZWNpZGVzIHdoZXRoZXIgdG8gYWN0dWFsbHkgcmUtcmVuZGVyLlxuICAgICAgICBtb2RlbC5vbihcIm1zZzpjdXN0b21cIiwgKG1zZywgYnVmZmVycykgPT4ge1xuICAgICAgICAgICAgaWYgKCFtc2cgfHwgbXNnLmtpbmQgIT09IFwic3dpZnRtYXBfcGF0Y2hcIikgcmV0dXJuO1xuICAgICAgICAgICAgYXBwbHlQYXRjaE9wcyhtc2cub3BzIHx8IFtdLCBidWZmZXJzKTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBGdWxsLXNuYXBzaG90IHBhdGhzOiB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlLCBhbmQgdGhlIHNpZGViYXIgd3JpdGluZyBgbGF5ZXJzYFxuICAgICAgICAvLyBiYWNrIGFmdGVyIGEgdG9nZ2xlLiBFaXRoZXIgd2F5IHRoZSB0cmFpdCBiZWNvbWVzIGF1dGhvcml0YXRpdmUgYWdhaW4uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmxheWVyc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICBsYXllclN0YXRlID0gbW9kZWwuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpjb29yZGluYXRlX2J1ZmZlcnNcIiwgKCkgPT4ge1xuICAgICAgICAgICAgYnVmZmVyU3RhdGUgPSB7IC4uLihtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pIH07XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmdyb3VwX2NvbmZpZ3NcIiwgcXVldWVTeW5jKTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jb25maWdcIiwgKCkgPT4ge1xuICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTsgICAvLyByZS1hcHBseSBzcGVlZC9sb29wIGZyb20gdGhlIG5ldyBjb25maWdcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gUHl0aG9uIHN0ZWVyaW5nIHRoZSBzbGlkZXI6IHNuYXAgdG8gdGhlIG5lYXJlc3QgdGljayBhdCBvciBhZnRlciB0aGUgcmVxdWVzdGVkXG4gICAgICAgIC8vIHRpbWUuIEd1YXJkZWQgc28gdGhlIHdpZGdldCdzIG93biB3cml0ZWJhY2sgZG9lcyBub3QgbG9vcCB0aHJvdWdoIGhlcmUuXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnRpbWVfY3VycmVudFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB3YW50ZWQgPSBtb2RlbC5nZXQoXCJ0aW1lX2N1cnJlbnRcIik7XG4gICAgICAgICAgICBpZiAoIXRpbWVTdGF0ZSB8fCAhdGltZVVJLnRpY2tzLmxlbmd0aCkgcmV0dXJuO1xuICAgICAgICAgICAgaWYgKE1hdGguYWJzKHdhbnRlZCAtIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKSA8IDEpIHJldHVybjtcbiAgICAgICAgICAgIGxldCBpZHggPSB0aW1lVUkudGlja3MuZmluZEluZGV4KHQgPT4gdCA+PSB3YW50ZWQpO1xuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIGlkeCA9IHRpbWVVSS50aWNrcy5sZW5ndGggLSAxO1xuICAgICAgICAgICAgc2Vla1RvKGlkeCwgeyB3cml0ZTogZmFsc2UgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzaG93X2xvZ29cIiwgcXVldWVTeW5jKTtcblxuICAgICAgICAvLyBBbm5vdW5jZSB0aGlzIHZpZXcgc28gUHl0aG9uIHJlcGxpZXMgd2l0aCBhIGZ1bGwgc25hcHNob3QuIExheWVycyBhZGRlZCBiZWZvcmVcbiAgICAgICAgLy8gdGhlIHZpZXcgYXR0YWNoZWQgd291bGQgb3RoZXJ3aXNlIGJlIG1pc3Npbmc6IHRoZWlyIHBhdGNoZXMgd2VyZSBlbWl0dGVkIGludG8gYVxuICAgICAgICAvLyB3aW5kb3cgd2hlcmUgbm90aGluZyB3YXMgbGlzdGVuaW5nLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbW9kZWwuc2VuZCh7IGtpbmQ6IFwic3dpZnRtYXBfcmVhZHlcIiB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSBpcyBhbGwgdGhlcmUgaXMgKi8gfVxuXG4gICAgICAgIC8vIFJlc3BlY3QgaW5pdGlhbCBhdXRvX3N5bmMgc3RhdGUgb3IgbWFudWFsIHN5bmMgcmVxdWVzdHMgc2VudCBkdXJpbmcgbWFwIGJ1aWxkaW5nXG4gICAgICAgIGlmIChtb2RlbC5nZXQoXCJhdXRvX3N5bmNcIikgfHwgbW9kZWwuZ2V0KFwic3luY190cmlnZ2VyXCIpID4gMCkge1xuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgfVxuICAgIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQU8sU0FBUyxRQUFRLElBQUksS0FBSztBQUM3QixNQUFJLENBQUMsU0FBUyxlQUFlLEVBQUUsR0FBRztBQUM5QixVQUFNLE9BQU8sU0FBUyxjQUFjLE1BQU07QUFDMUMsU0FBSyxLQUFLO0FBQ1YsU0FBSyxNQUFNO0FBQ1gsU0FBSyxPQUFPO0FBQ1osYUFBUyxLQUFLLFlBQVksSUFBSTtBQUFBLEVBQ2xDO0FBQ0o7QUFFQSxJQUFNLGdCQUFnQixDQUFDO0FBRWhCLFNBQVMsT0FBTyxJQUFJLEtBQUs7QUFDNUIsTUFBSSxjQUFjLEVBQUUsR0FBRztBQUNuQixXQUFPLGNBQWMsRUFBRTtBQUFBLEVBQzNCO0FBQ0EsUUFBTSxVQUFVLElBQUksUUFBUSxDQUFDLFNBQVMsV0FBVztBQUM3QyxRQUFJLFNBQVMsZUFBZSxFQUFFLEdBQUc7QUFDN0IsY0FBUTtBQUNSO0FBQUEsSUFDSjtBQUNBLFVBQU0sU0FBUyxTQUFTLGNBQWMsUUFBUTtBQUM5QyxXQUFPLEtBQUs7QUFDWixXQUFPLE1BQU07QUFDYixXQUFPLFNBQVMsTUFBTSxRQUFRO0FBQzlCLFdBQU8sVUFBVSxNQUFNLE9BQU8sSUFBSSxNQUFNLDBCQUEwQixHQUFHLEVBQUUsQ0FBQztBQUN4RSxhQUFTLEtBQUssWUFBWSxNQUFNO0FBQUEsRUFDcEMsQ0FBQztBQUNELGdCQUFjLEVBQUUsSUFBSTtBQUNwQixTQUFPO0FBQ1g7QUFFQSxTQUFTLFNBQVMsS0FBSztBQUNuQixNQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2pCLFFBQU0sSUFBSSxRQUFRLE1BQU0sRUFBRTtBQUMxQixNQUFJLElBQUksV0FBVyxHQUFHO0FBQ2xCLFVBQU0sSUFBSSxNQUFNLEVBQUUsRUFBRSxJQUFJLFVBQVEsT0FBTyxJQUFJLEVBQUUsS0FBSyxFQUFFO0FBQUEsRUFDeEQ7QUFDQSxNQUFJLElBQUksV0FBVyxFQUFHLFFBQU87QUFDN0IsUUFBTSxNQUFNLFNBQVMsS0FBSyxFQUFFO0FBQzVCLFNBQU87QUFBQSxJQUNILElBQUssT0FBTyxLQUFNLE9BQU87QUFBQSxJQUN6QixJQUFLLE9BQU8sSUFBSyxPQUFPO0FBQUEsSUFDeEIsSUFBSSxNQUFNLE9BQU87QUFBQSxFQUNyQjtBQUNKO0FBRUEsSUFBSSxhQUFhO0FBS2pCLFNBQVMsY0FBYyxPQUFPO0FBQzFCLE1BQUksT0FBTyxhQUFhLFlBQWEsUUFBTztBQUM1QyxNQUFJLENBQUMsV0FBWSxjQUFhLFNBQVMsY0FBYyxRQUFRLEVBQUUsV0FBVyxJQUFJO0FBSTlFLGFBQVcsWUFBWTtBQUN2QixhQUFXLFlBQVk7QUFDdkIsUUFBTSxRQUFRLFdBQVc7QUFDekIsYUFBVyxZQUFZO0FBQ3ZCLGFBQVcsWUFBWTtBQUN2QixNQUFJLFVBQVUsV0FBVyxVQUFXLFFBQU87QUFFM0MsTUFBSSxNQUFNLFdBQVcsR0FBRyxFQUFHLFFBQU8sU0FBUyxLQUFLO0FBQ2hELFFBQU0sUUFBUSxNQUFNLE1BQU0sa0JBQWtCO0FBQzVDLE1BQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsUUFBTSxRQUFRLE1BQU0sQ0FBQyxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUksT0FBSyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDL0QsTUFBSSxNQUFNLFNBQVMsS0FBSyxNQUFNLEtBQUssT0FBTyxLQUFLLEVBQUcsUUFBTztBQUN6RCxTQUFPLEVBQUUsR0FBRyxNQUFNLENBQUMsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUk7QUFDckU7QUFFTyxTQUFTLFdBQVcsVUFBVSxjQUFjLFdBQVc7QUFDMUQsTUFBSSxDQUFDLFNBQVUsWUFBVztBQUMxQixTQUFPLGNBQWMsUUFBUSxLQUN0QixTQUFTLFFBQVEsS0FDakIsY0FBYyxXQUFXLEtBQ3pCLFNBQVMsV0FBVyxLQUNwQixFQUFFLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxFQUFJO0FBQ3BDO0FBRUEsSUFBTSxrQkFBa0I7QUFDeEIsSUFBTSxXQUFXO0FBSVYsU0FBUyxXQUFXLE9BQU87QUFDOUIsU0FBTyxPQUFPLEtBQUssRUFDZCxRQUFRLE1BQU0sT0FBTyxFQUNyQixRQUFRLE1BQU0sTUFBTSxFQUNwQixRQUFRLE1BQU0sTUFBTSxFQUNwQixRQUFRLE1BQU0sUUFBUSxFQUN0QixRQUFRLE1BQU0sT0FBTztBQUM5QjtBQUtPLFNBQVMsUUFBUSxPQUFPO0FBQzNCLFFBQU0sWUFBWSxPQUFPLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxPQUFPLE9BQUssRUFBRSxXQUFXLENBQUMsSUFBSSxFQUFFLEVBQUUsS0FBSyxFQUFFO0FBQ25GLFNBQU8sU0FBUyxLQUFLLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSTtBQUN0RDtBQUVPLFNBQVMscUJBQXFCLE9BQU8sUUFBUSxPQUFPO0FBQ3ZELFFBQU0sZUFBZ0IsTUFBTSxRQUFRLE1BQU0sS0FBSyxPQUFPLFNBQVUsU0FBUyxPQUFPLEtBQUssS0FBSztBQUMxRixRQUFNLFNBQVUsTUFBTSxRQUFRLEtBQUssS0FBSyxNQUFNLFdBQVcsYUFBYSxTQUFVLFFBQVE7QUFDeEYsUUFBTSxRQUFRLENBQUM7QUFDZixXQUFTLElBQUksR0FBRyxJQUFJLGFBQWEsUUFBUSxLQUFLO0FBQzFDLFVBQU0sSUFBSSxhQUFhLENBQUM7QUFDeEIsUUFBSSxNQUFNLENBQUMsTUFBTSxVQUFhLE1BQU0sQ0FBQyxNQUFNLEtBQU07QUFDakQsVUFBTSxLQUFLLE1BQU0sV0FBVyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsV0FBVyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUU7QUFBQSxFQUN6RTtBQUNBLFNBQU8sTUFBTSxLQUFLLE1BQU07QUFDNUI7QUFHQSxTQUFTLGVBQWUsVUFBVSxPQUFPLFFBQVEsT0FBTztBQUNwRCxTQUFPLFNBQVMsUUFBUSxpQkFBaUIsQ0FBQyxPQUFPLEtBQUssV0FBVztBQUM3RCxRQUFJLFFBQVEsS0FBSztBQUNiLGFBQU8scUJBQXFCLE9BQU8sUUFBUSxLQUFLO0FBQUEsSUFDcEQ7QUFDQSxVQUFNLE1BQU0sTUFBTSxHQUFHO0FBQ3JCLFFBQUksUUFBUSxVQUFhLFFBQVEsS0FBTSxRQUFPO0FBQzlDLFVBQU0sWUFBWSxTQUFTLE1BQU0sS0FBSyxJQUFJLEdBQUcsU0FBUyxFQUFFLEdBQUcsTUFBTTtBQUNqRSxXQUFPLFdBQVcsZ0JBQWdCLEtBQUssU0FBUyxJQUFJLFFBQVEsR0FBRyxJQUFJLEdBQUc7QUFBQSxFQUMxRSxDQUFDO0FBQ0w7QUFFTyxTQUFTLGNBQWMsT0FBTyxPQUFPLE1BQU07QUFDOUMsUUFBTSxXQUFXLE1BQU0sT0FBTyxXQUFXO0FBQ3pDLFFBQU0sU0FBUyxNQUFNLE9BQU8sU0FBUztBQUNyQyxRQUFNLFFBQVEsTUFBTSxPQUFPLFFBQVE7QUFDbkMsTUFBSSxPQUFPLGFBQWEsWUFBWSxVQUFVO0FBQzFDLFdBQU8sZUFBZSxVQUFVLE9BQU8sUUFBUSxLQUFLO0FBQUEsRUFDeEQ7QUFDQSxTQUFPLHFCQUFxQixPQUFPLFFBQVEsS0FBSztBQUNwRDtBQUVBLFNBQVMsV0FBVyxNQUFNLE9BQU87QUFDN0IsTUFBSSxDQUFDLE1BQU8sUUFBTztBQUNuQixTQUFPLGVBQWUsV0FBVyxLQUFLLENBQUMsS0FBSyxJQUFJO0FBQ3BEO0FBRU8sU0FBUyxVQUFVLEtBQUssUUFBUSxPQUFPLE9BQU87QUFDakQsUUFBTSxPQUFPLGNBQWMsT0FBTyxPQUFPLE9BQU87QUFDaEQsTUFBSSxTQUFTLE1BQU0sa0JBQWtCLE1BQU0sZ0JBQWdCLE1BQU0saUJBQWlCO0FBQzlFLFVBQU0sVUFBVSxDQUFDO0FBQ2pCLFFBQUksTUFBTSxnQkFBaUIsU0FBUSxXQUFXLE1BQU07QUFDcEQsTUFBRSxNQUFNLE9BQU8sRUFDVixVQUFVLE1BQU0sRUFDaEIsV0FBVyxXQUFXLE1BQU0sTUFBTSxXQUFXLENBQUMsRUFDOUMsT0FBTyxHQUFHO0FBQUEsRUFDbkI7QUFDSjtBQUVPLFNBQVMsWUFBWSxLQUFLLFFBQVEsT0FBTyxPQUFPLGVBQWU7QUFDbEUsUUFBTSxPQUFPLGNBQWMsT0FBTyxPQUFPLFNBQVM7QUFDbEQsTUFBSSxTQUFTLE1BQU0sb0JBQW9CLE1BQU0sa0JBQWtCLE1BQU0sbUJBQW1CO0FBQ3BGLFFBQUksQ0FBQyxjQUFjLGdCQUFnQjtBQUMvQixvQkFBYyxpQkFBaUIsRUFBRSxRQUFRLEVBQUUsV0FBVyxPQUFPLFFBQVEsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDO0FBQUEsSUFDbEY7QUFDQSxrQkFBYyxlQUNULFVBQVUsTUFBTSxFQUNoQixXQUFXLFdBQVcsTUFBTSxNQUFNLGFBQWEsQ0FBQyxFQUNoRCxNQUFNLEdBQUc7QUFBQSxFQUNsQjtBQUNKOzs7QUN2S0EsSUFBTSxpQkFBaUIsQ0FBQztBQUVqQixTQUFTLGVBQWUsR0FBRyxtQkFBbUI7QUFDakQsTUFBSSxDQUFDLEVBQUcsUUFBTztBQUdmLE1BQUksRUFBRSxTQUFTO0FBQ1gsUUFBSSxTQUFTLFVBQVUsU0FBUztBQUNoQyxRQUFJLFNBQVMsVUFBVSxTQUFTO0FBR2hDLFdBQU8sS0FBSyxFQUFFLFFBQVEsRUFBRSxRQUFRLFNBQU87QUFDbkMsWUFBTSxJQUFJLGVBQWUsRUFBRSxTQUFTLEdBQUcsR0FBRyxpQkFBaUI7QUFDM0QsVUFBSSxHQUFHO0FBQ0gsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFBQSxNQUN6QztBQUFBLElBQ0osQ0FBQztBQUdELE1BQUUsT0FBTyxRQUFRLFNBQU87QUFDcEIsWUFBTSxJQUFJLGVBQWUsS0FBSyxpQkFBaUI7QUFDL0MsVUFBSSxHQUFHO0FBQ0gsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFBQSxNQUN6QztBQUFBLElBQ0osQ0FBQztBQUVELFFBQUksV0FBVyxVQUFVO0FBQ3JCLGFBQU8sQ0FBQyxDQUFDLFFBQVEsTUFBTSxHQUFHLENBQUMsUUFBUSxNQUFNLENBQUM7QUFBQSxJQUM5QztBQUNBLFdBQU87QUFBQSxFQUNYO0FBRUEsTUFBSSxFQUFFLFVBQVUsRUFBRSxPQUFPLFNBQVMsR0FBRztBQUNqQyxXQUFPLEVBQUU7QUFBQSxFQUNiO0FBQ0EsTUFBSSxFQUFFLFNBQVMsV0FBVyxFQUFFLFFBQVE7QUFDaEMsUUFBSSxTQUFTLFVBQVUsU0FBUztBQUNoQyxRQUFJLFNBQVMsVUFBVSxTQUFTO0FBQ2hDLGVBQVcsT0FBTyxFQUFFLFFBQVE7QUFDeEIsWUFBTSxJQUFJLGVBQWUsS0FBSyxpQkFBaUI7QUFDL0MsVUFBSSxHQUFHO0FBQ0gsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDckMsWUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksT0FBUSxVQUFTLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFBQSxNQUN6QztBQUFBLElBQ0o7QUFDQSxRQUFJLFdBQVcsVUFBVTtBQUNyQixhQUFPLENBQUMsQ0FBQyxRQUFRLE1BQU0sR0FBRyxDQUFDLFFBQVEsTUFBTSxDQUFDO0FBQUEsSUFDOUM7QUFBQSxFQUNKO0FBQ0EsTUFBSSxFQUFFLGFBQWEsRUFBRSxVQUFVLFNBQVMsR0FBRztBQUN2QyxRQUFJLFNBQVMsVUFBVSxTQUFTO0FBQ2hDLFFBQUksU0FBUyxVQUFVLFNBQVM7QUFDaEMsVUFBTSxTQUFTLEVBQUUsVUFBVSxLQUFLLFFBQVE7QUFDeEMsYUFBUyxJQUFJLEdBQUcsSUFBSSxPQUFPLFFBQVEsS0FBSyxHQUFHO0FBQ3ZDLFlBQU0sTUFBTSxPQUFPLENBQUM7QUFDcEIsWUFBTSxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBQ3hCLFVBQUksTUFBTSxPQUFRLFVBQVM7QUFDM0IsVUFBSSxNQUFNLE9BQVEsVUFBUztBQUMzQixVQUFJLE1BQU0sT0FBUSxVQUFTO0FBQzNCLFVBQUksTUFBTSxPQUFRLFVBQVM7QUFBQSxJQUMvQjtBQUNBLFFBQUksV0FBVyxVQUFVO0FBQ3JCLGFBQU8sQ0FBQyxDQUFDLFFBQVEsTUFBTSxHQUFHLENBQUMsUUFBUSxNQUFNLENBQUM7QUFBQSxJQUM5QztBQUFBLEVBQ0o7QUFDQSxNQUFJLG1CQUFtQjtBQUNuQixVQUFNLE1BQU0sa0JBQWtCLEVBQUUsRUFBRTtBQUNsQyxRQUFJLEtBQUs7QUFDTCxZQUFNLFNBQVMsSUFBSSxhQUFhLElBQUksUUFBUSxJQUFJLFlBQVksSUFBSSxhQUFhLENBQUM7QUFDOUUsVUFBSSxTQUFTLFVBQVUsU0FBUztBQUNoQyxVQUFJLFNBQVMsVUFBVSxTQUFTO0FBQ2hDLGVBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxTQUFTLEdBQUcsS0FBSztBQUN4QyxjQUFNLE1BQU0sT0FBTyxJQUFJLENBQUM7QUFDeEIsY0FBTSxNQUFNLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFDNUIsWUFBSSxNQUFNLE9BQVEsVUFBUztBQUMzQixZQUFJLE1BQU0sT0FBUSxVQUFTO0FBQzNCLFlBQUksTUFBTSxPQUFRLFVBQVM7QUFDM0IsWUFBSSxNQUFNLE9BQVEsVUFBUztBQUFBLE1BQy9CO0FBQ0EsVUFBSSxXQUFXLFVBQVU7QUFDckIsZUFBTyxDQUFDLENBQUMsUUFBUSxNQUFNLEdBQUcsQ0FBQyxRQUFRLE1BQU0sQ0FBQztBQUFBLE1BQzlDO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFDQSxTQUFPO0FBQ1g7QUFFTyxTQUFTLHFCQUFxQixRQUFRLGNBQWM7QUFDdkQsUUFBTSxPQUFPLEVBQUUsTUFBTSxRQUFRLE1BQU0sSUFBSSxVQUFVLENBQUMsR0FBRyxRQUFRLENBQUMsR0FBRyxTQUFTLEtBQUs7QUFDL0UsTUFBSSxDQUFDLGFBQWEsRUFBRSxHQUFHO0FBQ25CLGlCQUFhLEVBQUUsSUFBSSxFQUFFLGNBQWMsTUFBTSxTQUFTLEtBQUs7QUFBQSxFQUMzRDtBQUNBLFNBQU8sUUFBUSxPQUFLO0FBQ2hCLFVBQU0sVUFBVSxFQUFFLGVBQWU7QUFDakMsVUFBTSxRQUFRLFFBQVEsTUFBTSxHQUFHO0FBQy9CLFFBQUksT0FBTztBQUNYLFFBQUksY0FBYztBQUNsQixVQUFNLFFBQVEsVUFBUTtBQUNsQixvQkFBYyxjQUFjLEdBQUcsV0FBVyxJQUFJLElBQUksS0FBSztBQUN2RCxVQUFJLENBQUMsS0FBSyxTQUFTLElBQUksR0FBRztBQUN0QixhQUFLLFNBQVMsSUFBSSxJQUFJO0FBQUEsVUFDbEIsTUFBTTtBQUFBLFVBQ04sTUFBTTtBQUFBLFVBQ04sVUFBVSxDQUFDO0FBQUEsVUFDWCxRQUFRLENBQUM7QUFBQSxVQUNULFNBQVM7QUFBQSxRQUNiO0FBQUEsTUFDSjtBQUNBLGFBQU8sS0FBSyxTQUFTLElBQUk7QUFBQSxJQUM3QixDQUFDO0FBQ0QsU0FBSyxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQ3RCLENBQUM7QUFFRCxNQUFJLG1CQUFtQjtBQUN2QixXQUFTLG9CQUFvQixNQUFNO0FBQy9CLFVBQU0sT0FBTyxhQUFhLEtBQUssSUFBSSxLQUFLLEVBQUUsY0FBYyxLQUFLO0FBQzdELFVBQU0sZUFBZSxLQUFLLGlCQUFpQjtBQUMzQyxRQUFJLGNBQWM7QUFDZCxVQUFJLGNBQWM7QUFDbEIsYUFBTyxLQUFLLEtBQUssUUFBUSxFQUFFLFFBQVEsU0FBTztBQUN0QyxjQUFNLGFBQWEsS0FBSyxTQUFTLEdBQUc7QUFDcEMsWUFBSSxDQUFDLGFBQWEsV0FBVyxJQUFJLEdBQUc7QUFDaEMsdUJBQWEsV0FBVyxJQUFJLElBQUksRUFBRSxTQUFTLE1BQU0sY0FBYyxLQUFLO0FBQUEsUUFDeEU7QUFDQSxjQUFNLFlBQVksYUFBYSxXQUFXLElBQUksRUFBRSxZQUFZO0FBQzVELFlBQUksV0FBVztBQUNYLGNBQUksYUFBYTtBQUNiLHlCQUFhLFdBQVcsSUFBSSxFQUFFLFVBQVU7QUFDeEMsMkJBQWUsV0FBVyxJQUFJLElBQUk7QUFDbEMsK0JBQW1CO0FBQUEsVUFDdkIsT0FBTztBQUNILDBCQUFjO0FBQ2QsMkJBQWUsV0FBVyxJQUFJLElBQUk7QUFBQSxVQUN0QztBQUFBLFFBQ0osT0FBTztBQUNILHlCQUFlLFdBQVcsSUFBSSxJQUFJO0FBQUEsUUFDdEM7QUFBQSxNQUNKLENBQUM7QUFDRCxXQUFLLE9BQU8sUUFBUSxTQUFPO0FBQ3ZCLGNBQU0sWUFBWSxJQUFJLFlBQVk7QUFDbEMsWUFBSSxXQUFXO0FBQ1gsY0FBSSxhQUFhO0FBQ2IsZ0JBQUksVUFBVTtBQUNkLCtCQUFtQjtBQUFBLFVBQ3ZCLE9BQU87QUFDSCwwQkFBYztBQUFBLFVBQ2xCO0FBQUEsUUFDSjtBQUFBLE1BQ0osQ0FBQztBQUFBLElBQ0w7QUFDQSxXQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsUUFBUSxTQUFPO0FBQ3RDLDBCQUFvQixLQUFLLFNBQVMsR0FBRyxDQUFDO0FBQUEsSUFDMUMsQ0FBQztBQUFBLEVBQ0w7QUFDQSxzQkFBb0IsSUFBSTtBQUN4QixTQUFPO0FBQ1g7QUFFTyxTQUFTLHNCQUFzQixTQUFTLFFBQVEsT0FBTyxLQUFLLGVBQWU7QUFDOUUsVUFBUSxZQUFZO0FBRXBCLFFBQU0sZUFBZSxNQUFNLElBQUksZUFBZSxLQUFLLENBQUM7QUFHcEQsUUFBTSxPQUFPLEVBQUUsTUFBTSxRQUFRLE1BQU0sSUFBSSxVQUFVLENBQUMsR0FBRyxRQUFRLENBQUMsR0FBRyxTQUFTLEtBQUs7QUFHL0UsTUFBSSxDQUFDLGFBQWEsRUFBRSxHQUFHO0FBQ25CLGlCQUFhLEVBQUUsSUFBSSxFQUFFLGNBQWMsTUFBTSxTQUFTLEtBQUs7QUFBQSxFQUMzRDtBQUVBLFNBQU8sUUFBUSxPQUFLO0FBQ2hCLFVBQU0sVUFBVSxFQUFFLGVBQWU7QUFDakMsVUFBTSxRQUFRLFFBQVEsTUFBTSxHQUFHO0FBQy9CLFFBQUksT0FBTztBQUNYLFFBQUksY0FBYztBQUNsQixVQUFNLFFBQVEsVUFBUTtBQUNsQixvQkFBYyxjQUFjLEdBQUcsV0FBVyxJQUFJLElBQUksS0FBSztBQUN2RCxVQUFJLENBQUMsS0FBSyxTQUFTLElBQUksR0FBRztBQUN0QixhQUFLLFNBQVMsSUFBSSxJQUFJO0FBQUEsVUFDbEIsTUFBTTtBQUFBLFVBQ04sTUFBTTtBQUFBLFVBQ04sVUFBVSxDQUFDO0FBQUEsVUFDWCxRQUFRLENBQUM7QUFBQSxVQUNULFNBQVM7QUFBQSxRQUNiO0FBQUEsTUFDSjtBQUNBLGFBQU8sS0FBSyxTQUFTLElBQUk7QUFBQSxJQUM3QixDQUFDO0FBQ0QsU0FBSyxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQ3RCLENBQUM7QUFHRCxXQUFTLFdBQVcsTUFBTSxVQUFVLE9BQU8sWUFBWSx3QkFBd0I7QUFFM0UsUUFBSSxLQUFLLFNBQVMsSUFBSTtBQUVsQixhQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsUUFBUSxTQUFPO0FBQ3RDLG1CQUFXLEtBQUssU0FBUyxHQUFHLEdBQUcsVUFBVSxPQUFPLE1BQU0sSUFBSTtBQUFBLE1BQzlELENBQUM7QUFDRCxXQUFLLE9BQU8sUUFBUSxTQUFPO0FBQ3ZCLG1CQUFXLEtBQUssVUFBVSxPQUFPLE1BQU0sSUFBSTtBQUFBLE1BQy9DLENBQUM7QUFDRDtBQUFBLElBQ0o7QUFFQSxVQUFNLFVBQVUsS0FBSyxZQUFZO0FBQ2pDLFVBQU0sT0FBTyxVQUFVLEtBQUssT0FBTztBQUNuQyxVQUFNLE9BQU8sS0FBSztBQUNsQixVQUFNLEtBQUssVUFBVSxPQUFPLEtBQUs7QUFHakMsVUFBTSxhQUFhLGFBQWEsV0FBVyxPQUFPO0FBQ2xELFVBQU0sYUFBYSxhQUFhLFVBQVUsS0FBSyxFQUFFLGNBQWMsS0FBSztBQUNwRSxVQUFNLGdCQUFnQixXQUFXLGlCQUFpQjtBQUVsRCxVQUFNLFVBQVUsU0FBUyxjQUFjLEtBQUs7QUFDNUMsWUFBUSxNQUFNLGVBQWU7QUFFN0IsUUFBSSxjQUFjO0FBQ2xCLFFBQUksU0FBUztBQUNULG9CQUFjLFNBQVMsYUFBYSxPQUFRLGFBQWEsSUFBSSxHQUFHLFlBQVk7QUFBQSxJQUNoRixPQUFPO0FBQ0gsb0JBQWMsS0FBSyxZQUFZO0FBQUEsSUFDbkM7QUFDQSxVQUFNLHVCQUF1QiwwQkFBMEI7QUFFdkQsVUFBTSxZQUFZLFNBQVMsY0FBYyxLQUFLO0FBQzlDLGNBQVUsTUFBTSxVQUFVO0FBQzFCLGNBQVUsTUFBTSxhQUFhO0FBQzdCLGNBQVUsTUFBTSxTQUFTO0FBQ3pCLGNBQVUsTUFBTSxhQUFhO0FBQzdCLGNBQVUsTUFBTSxtQkFBbUI7QUFDbkMsY0FBVSxNQUFNLFdBQVc7QUFFM0IsUUFBSSxDQUFDLHdCQUF3QjtBQUN6QixnQkFBVSxNQUFNLFVBQVU7QUFDMUIsZ0JBQVUsTUFBTSxRQUFRO0FBQUEsSUFDNUI7QUFHQSxRQUFJLFdBQVc7QUFDZixRQUFJLFNBQVM7QUFDVCxpQkFBVyxTQUFTLGNBQWMsTUFBTTtBQUN4QyxlQUFTLE1BQU0sY0FBYztBQUM3QixlQUFTLE1BQU0sUUFBUTtBQUN2QixlQUFTLE1BQU0sV0FBVztBQUMxQixlQUFTLE1BQU0sYUFBYTtBQUM1QixlQUFTLE1BQU0sVUFBVTtBQUN6QixlQUFTLE1BQU0sWUFBWTtBQUMzQixZQUFNLGNBQWMsZUFBZSxJQUFJLE1BQU07QUFDN0MsZUFBUyxjQUFjLGNBQWMsV0FBTTtBQUMzQyxlQUFTLE1BQU0sYUFBYTtBQUM1QixnQkFBVSxZQUFZLFFBQVE7QUFBQSxJQUNsQyxPQUFPO0FBQ0gsWUFBTSxTQUFTLFNBQVMsY0FBYyxNQUFNO0FBQzVDLGFBQU8sTUFBTSxjQUFjO0FBQzNCLGFBQU8sTUFBTSxRQUFRO0FBQ3JCLGFBQU8sTUFBTSxVQUFVO0FBQ3ZCLGdCQUFVLFlBQVksTUFBTTtBQUFBLElBQ2hDO0FBR0EsUUFBSSxRQUFRO0FBQ1osUUFBSSxDQUFDLFdBQVcsU0FBUyxZQUFZO0FBQ2pDLGNBQVEsU0FBUyxjQUFjLE9BQU87QUFDdEMsWUFBTSxPQUFPLGdCQUFnQixhQUFhO0FBQzFDLFlBQU0sT0FBTyxnQkFBaUIsVUFBVSxTQUFTLElBQUksS0FBSyxTQUFTLEVBQUUsS0FBTSxVQUFVLFVBQVU7QUFDL0YsWUFBTSxNQUFNLGNBQWM7QUFDMUIsWUFBTSxNQUFNLFNBQVM7QUFDckIsWUFBTSxpQkFBaUIsU0FBUyxDQUFDLE1BQU07QUFDbkMsVUFBRSxnQkFBZ0I7QUFBQSxNQUN0QixDQUFDO0FBRUQsVUFBSSxTQUFTO0FBQ1QsWUFBSSxDQUFDLGFBQWEsSUFBSSxHQUFHO0FBQ3JCLHVCQUFhLElBQUksSUFBSSxFQUFFLFNBQVMsTUFBTSxjQUFjLEtBQUs7QUFBQSxRQUM3RDtBQUNBLGNBQU0sVUFBVSxhQUFhLElBQUksRUFBRSxZQUFZO0FBQUEsTUFDbkQsT0FBTztBQUNILGNBQU0sVUFBVSxLQUFLLFlBQVk7QUFBQSxNQUNyQztBQUVBLGdCQUFVLFlBQVksS0FBSztBQUFBLElBQy9CO0FBR0EsVUFBTSxRQUFRLFNBQVMsY0FBYyxNQUFNO0FBQzNDLFVBQU0sY0FBYztBQUNwQixRQUFJLFNBQVM7QUFDVCxZQUFNLE1BQU0sYUFBYTtBQUFBLElBQzdCO0FBQ0EsY0FBVSxZQUFZLEtBQUs7QUFFM0IsWUFBUSxZQUFZLFNBQVM7QUFHN0IsUUFBSSxjQUFjO0FBQ2xCLFFBQUksU0FBUztBQUNULG9CQUFjLFNBQVMsY0FBYyxLQUFLO0FBQzFDLFlBQU0sY0FBYyxlQUFlLElBQUksTUFBTTtBQUM3QyxrQkFBWSxNQUFNLFVBQVUsY0FBYyxTQUFTO0FBQ25ELGtCQUFZLE1BQU0sYUFBYTtBQUMvQixrQkFBWSxNQUFNLGFBQWE7QUFDL0Isa0JBQVksTUFBTSxjQUFjO0FBR2hDLGFBQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxRQUFRLFNBQU87QUFDdEMsbUJBQVcsS0FBSyxTQUFTLEdBQUcsR0FBRyxhQUFhLFFBQVEsR0FBRyxNQUFNLG9CQUFvQjtBQUFBLE1BQ3JGLENBQUM7QUFDRCxXQUFLLE9BQU8sUUFBUSxTQUFPO0FBQ3ZCLG1CQUFXLEtBQUssYUFBYSxRQUFRLEdBQUcsTUFBTSxvQkFBb0I7QUFBQSxNQUN0RSxDQUFDO0FBRUQsY0FBUSxZQUFZLFdBQVc7QUFBQSxJQUNuQztBQUdBLFFBQUksU0FBUztBQUNULGdCQUFVLGlCQUFpQixTQUFTLE1BQU07QUFDdEMsY0FBTSxjQUFjLGVBQWUsSUFBSSxNQUFNO0FBQzdDLHVCQUFlLElBQUksSUFBSSxDQUFDO0FBQ3hCLFlBQUksVUFBVTtBQUNWLG1CQUFTLGNBQWMsQ0FBQyxjQUFjLFdBQU07QUFBQSxRQUNoRDtBQUNBLFlBQUksYUFBYTtBQUNiLHNCQUFZLE1BQU0sVUFBVSxDQUFDLGNBQWMsU0FBUztBQUFBLFFBQ3hEO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDTDtBQUdBLFFBQUksT0FBTztBQUNQLFlBQU0saUJBQWlCLFNBQVMsQ0FBQyxNQUFNO0FBQ25DLFVBQUUsZ0JBQWdCO0FBQ2xCLFlBQUksZUFBZTtBQUNmLGdCQUFNLFVBQVUsQ0FBQyxNQUFNO0FBQUEsUUFDM0IsT0FBTztBQUNILGdCQUFNLFVBQVU7QUFBQSxRQUNwQjtBQUNBLGNBQU0sY0FBYyxJQUFJLE1BQU0sUUFBUSxDQUFDO0FBQUEsTUFDM0MsQ0FBQztBQUFBLElBQ0w7QUFHQSxRQUFJLE9BQU87QUFDUCxZQUFNLGlCQUFpQixVQUFVLE1BQU07QUFDbkMsY0FBTSxZQUFZLE1BQU07QUFHeEIsWUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVc7QUFDOUI7QUFBQSxRQUNKO0FBU0EsWUFBSSxnQkFBZ0IsQ0FBQyxHQUFHLE1BQU07QUFFOUIsWUFBSSxDQUFDLGVBQWU7QUFFaEIsaUJBQU8sS0FBSyxXQUFXLFFBQVEsRUFBRSxRQUFRLFNBQU87QUFDNUMsa0JBQU0sV0FBVyxXQUFXLFNBQVMsR0FBRztBQUN4QyxrQkFBTSxTQUFTLFNBQVMsU0FBUztBQUNqQyx5QkFBYSxTQUFTLElBQUksSUFBSTtBQUFBLGNBQzFCLEdBQUcsYUFBYSxTQUFTLElBQUk7QUFBQSxjQUM3QixTQUFTO0FBQUEsWUFDYjtBQUNBLDJCQUFlLFNBQVMsSUFBSSxJQUFJLENBQUM7QUFBQSxVQUNyQyxDQUFDO0FBQ0QscUJBQVcsT0FBTyxRQUFRLFlBQVU7QUFDaEMsa0JBQU0sU0FBUyxPQUFPLE9BQU87QUFDN0IsNEJBQWdCLGNBQWMsSUFBSSxlQUFhO0FBQzNDLGtCQUFJLFVBQVUsT0FBTyxPQUFPLElBQUk7QUFDN0IsdUJBQU8sRUFBRSxHQUFHLFdBQVcsU0FBUyxPQUFPO0FBQUEsY0FDMUM7QUFDQSxxQkFBTztBQUFBLFlBQ1gsQ0FBQztBQUFBLFVBQ0wsQ0FBQztBQUFBLFFBQ0wsT0FBTztBQUVILGNBQUksU0FBUztBQUNULHlCQUFhLElBQUksSUFBSTtBQUFBLGNBQ2pCLEdBQUcsYUFBYSxJQUFJO0FBQUEsY0FDcEIsU0FBUztBQUFBLFlBQ2I7QUFDQSwyQkFBZSxJQUFJLElBQUksQ0FBQztBQUFBLFVBQzVCLE9BQU87QUFDSCw0QkFBZ0IsY0FBYyxJQUFJLGVBQWE7QUFDM0Msa0JBQUksVUFBVSxPQUFPLElBQUk7QUFDckIsdUJBQU8sRUFBRSxHQUFHLFdBQVcsU0FBUyxVQUFVO0FBQUEsY0FDOUM7QUFDQSxxQkFBTztBQUFBLFlBQ1gsQ0FBQztBQUFBLFVBQ0w7QUFBQSxRQUNKO0FBRUEsY0FBTSxJQUFJLFVBQVUsYUFBYTtBQUNqQyxjQUFNLElBQUksaUJBQWlCLFlBQVk7QUFDdkMsY0FBTSxhQUFhO0FBRW5CLFlBQUksYUFBYSxLQUFLO0FBQ2xCLGdCQUFNLFNBQVMsZUFBZSxNQUFNLE1BQU0sSUFBSSxvQkFBb0IsS0FBSyxDQUFDLENBQUM7QUFDekUsY0FBSSxRQUFRO0FBQ1IsZ0JBQUksVUFBVSxNQUFNO0FBQUEsVUFDeEI7QUFBQSxRQUNKO0FBRUEsWUFBSSxlQUFlO0FBQ2Ysd0JBQWM7QUFBQSxRQUNsQjtBQUFBLE1BQ0osQ0FBQztBQUFBLElBQ0w7QUFFQSxhQUFTLFlBQVksT0FBTztBQUFBLEVBQ2hDO0FBR0EsYUFBVyxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUk7QUFDM0M7OztBQy9hTyxJQUFNLFlBQVk7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBOzs7QUNjekIsSUFBTSxZQUNGO0FBRUcsU0FBUyxZQUFZLE1BQU07QUFDOUIsUUFBTSxJQUFJLFVBQVUsS0FBSyxRQUFRLEVBQUU7QUFDbkMsTUFBSSxDQUFDLEVBQUcsUUFBTztBQUNmLFNBQU87QUFBQSxJQUNILE9BQU8sRUFBRSxFQUFFLENBQUMsS0FBSztBQUFBLElBQUksUUFBUSxFQUFFLEVBQUUsQ0FBQyxLQUFLO0FBQUEsSUFBSSxPQUFPLEVBQUUsRUFBRSxDQUFDLEtBQUs7QUFBQSxJQUFJLE1BQU0sRUFBRSxFQUFFLENBQUMsS0FBSztBQUFBLElBQ2hGLE9BQU8sRUFBRSxFQUFFLENBQUMsS0FBSztBQUFBLElBQUksU0FBUyxFQUFFLEVBQUUsQ0FBQyxLQUFLO0FBQUEsSUFBSSxTQUFTLEVBQUUsRUFBRSxDQUFDLEtBQUs7QUFBQSxFQUNuRTtBQUNKO0FBSU8sU0FBUyxVQUFVLElBQUksR0FBRyxPQUFPLEdBQUc7QUFDdkMsUUFBTSxJQUFJLElBQUksS0FBSyxFQUFFO0FBQ3JCLE1BQUksRUFBRSxNQUFPLEdBQUUsZUFBZSxFQUFFLGVBQWUsSUFBSSxPQUFPLEVBQUUsS0FBSztBQUNqRSxNQUFJLEVBQUUsT0FBUSxHQUFFLFlBQVksRUFBRSxZQUFZLElBQUksT0FBTyxFQUFFLE1BQU07QUFDN0QsU0FBTyxFQUFFLFFBQVEsSUFBSSxVQUFVLEVBQUUsUUFBUSxJQUFJLEVBQUUsUUFBUSxLQUFLLE9BQ3RELEVBQUUsUUFBUSxPQUFPLEVBQUUsVUFBVSxLQUFLLEVBQUUsV0FBVztBQUN6RDtBQUtPLElBQU0sWUFBWTtBQUVsQixTQUFTLGNBQWMsU0FBUyxPQUFPLEdBQUc7QUFJN0MsUUFBTSxRQUFRLENBQUMsT0FBTztBQUN0QixNQUFJLElBQUk7QUFDUixNQUFJLEtBQUssTUFBTyxRQUFPO0FBQ3ZCLFNBQU8sTUFBTSxTQUFTLFdBQVc7QUFDN0IsUUFBSSxVQUFVLEdBQUcsQ0FBQztBQUNsQixVQUFNLEtBQUssQ0FBQztBQUNaLFFBQUksS0FBSyxNQUFPLFFBQU87QUFBQSxFQUMzQjtBQUNBLFVBQVEsS0FBSyxvQ0FBb0MsU0FBUyw2RUFDZTtBQUN6RSxTQUFPO0FBQ1g7QUFNTyxTQUFTLFVBQVUsTUFBTSxjQUFjLFFBQVE7QUFDbEQsTUFBSSxpQkFBaUIsUUFBUSxpQkFBaUIsUUFBVztBQUNyRCxXQUFPLEVBQUUsT0FBTyxXQUFXLEtBQUssS0FBSztBQUFBLEVBQ3pDO0FBQ0EsUUFBTSxJQUFJLGlCQUFpQixXQUFXLFNBQVMsWUFBWSxZQUFZO0FBQ3ZFLE1BQUksQ0FBQyxFQUFHLFFBQU8sRUFBRSxPQUFPLFdBQVcsS0FBSyxLQUFLO0FBQzdDLFNBQU8sRUFBRSxPQUFPLFVBQVUsTUFBTSxHQUFHLEVBQUUsR0FBRyxLQUFLLEtBQUs7QUFDdEQ7QUFLTyxTQUFTLGdCQUFnQixTQUFTLE9BQU8sS0FBSztBQUNqRCxNQUFJLE9BQU8sTUFBTSxPQUFPLEVBQUcsUUFBTztBQUNsQyxTQUFPLFFBQVEsSUFBSSxTQUFTLFdBQVcsSUFBSTtBQUMvQztBQUlPLFNBQVMsU0FBUyxPQUFPLFNBQVM7QUFDckMsUUFBTSxNQUFNLFdBQVcsUUFBUSxHQUFHLE1BQU0sRUFBRSxTQUFTO0FBQ25ELE1BQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsU0FBTyxJQUFJO0FBQUEsSUFBYSxJQUFJLFVBQVU7QUFBQSxJQUFLLElBQUksY0FBYztBQUFBLEtBQ3hELElBQUksY0FBYyxJQUFJLFVBQVU7QUFBQSxFQUFDO0FBQzFDO0FBYU8sU0FBUyxrQkFBa0IsT0FBTyxXQUFXO0FBQ2hELFNBQU8sVUFBVSxVQUFXLE1BQU0sUUFBUSxNQUFNLEtBQUs7QUFDekQ7QUFFTyxTQUFTLGNBQWMsT0FBTyxTQUFTLFdBQVc7QUFDckQsTUFBSSxDQUFDLE1BQU0sUUFBUSxDQUFDLFVBQVcsUUFBTztBQUN0QyxRQUFNLFFBQVEsU0FBUyxPQUFPLE9BQU87QUFDckMsTUFBSSxDQUFDLFNBQVMsTUFBTSxTQUFTLEVBQUcsUUFBTztBQUN2QyxRQUFNLE1BQU0sVUFBVSxVQUFVLE1BQU0sa0JBQWtCLE9BQU8sU0FBUyxHQUFHLFVBQVUsTUFBTTtBQUMzRixTQUFPLGdCQUFnQixNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsR0FBRyxHQUFHO0FBQ2xEO0FBR08sU0FBUyxrQkFBa0IsUUFBUSxTQUFTO0FBQy9DLE1BQUksTUFBTSxVQUFVLE1BQU07QUFDMUIsUUFBTSxRQUFRLENBQUMsU0FBUyxLQUFLLFFBQVEsV0FBUztBQUMxQyxRQUFJLE1BQU0sU0FBUyxRQUFTLFFBQU8sTUFBTSxNQUFNLFVBQVUsQ0FBQyxDQUFDO0FBQzNELFFBQUksQ0FBQyxNQUFNLEtBQU07QUFDakIsVUFBTSxRQUFRLFNBQVMsT0FBTyxPQUFPO0FBQ3JDLFFBQUksQ0FBQyxNQUFPO0FBQ1osYUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQ3RDLFVBQUksT0FBTyxNQUFNLE1BQU0sQ0FBQyxDQUFDLEVBQUc7QUFDNUIsVUFBSSxNQUFNLENBQUMsSUFBSSxJQUFLLE9BQU0sTUFBTSxDQUFDO0FBQ2pDLFVBQUksTUFBTSxJQUFJLENBQUMsSUFBSSxJQUFLLE9BQU0sTUFBTSxJQUFJLENBQUM7QUFBQSxJQUM3QztBQUFBLEVBQ0osQ0FBQztBQUNELFFBQU0sTUFBTTtBQUNaLFNBQU8sUUFBUSxXQUFXLE9BQU8sRUFBRSxLQUFLLElBQUk7QUFDaEQ7QUFFTyxTQUFTLGNBQWMsUUFBUTtBQUNsQyxTQUFPLE9BQU8sS0FBSyxPQUFLLEVBQUUsU0FBUyxVQUM3QixjQUFjLEVBQUUsVUFBVSxDQUFDLENBQUMsSUFDNUIsUUFBUSxFQUFFLElBQUksQ0FBQztBQUN6QjtBQUtPLFNBQVMsUUFBUSxPQUFPLFFBQVEsTUFBTTtBQUN6QyxNQUFJLFFBQVEsU0FBUyxFQUFHLFFBQU8sRUFBRSxPQUFPLFFBQVEsR0FBRyxTQUFTLEtBQUs7QUFDakUsTUFBSSxLQUFNLFFBQU8sRUFBRSxPQUFPLEdBQUcsU0FBUyxLQUFLO0FBQzNDLFNBQU8sRUFBRSxPQUFPLFNBQVMsTUFBTTtBQUNuQztBQU1PLElBQU0sWUFBWTtBQUFBLEVBQ3JCLFlBQWlCLEVBQUUsS0FBSyxRQUFRLFFBQVEsSUFBSSxNQUFNLFFBQVEsT0FBTyxJQUFJLFdBQVcsR0FBRztBQUFBLEVBQ25GLGNBQWlCLEVBQUUsS0FBSyxRQUFRLFFBQVEsSUFBSSxNQUFNLE9BQU8sT0FBTyxJQUFJLFdBQVcsbUJBQW1CO0FBQUEsRUFDbEcsYUFBaUIsRUFBRSxLQUFLLFFBQVEsUUFBUSxJQUFJLE1BQU0sSUFBSSxPQUFPLFFBQVEsV0FBVyxHQUFHO0FBQUEsRUFDbkYsZUFBaUIsRUFBRSxLQUFLLE9BQU8sUUFBUSxJQUFJLE1BQU0sUUFBUSxPQUFPLElBQUksV0FBVyxtQkFBbUI7QUFBQSxFQUNsRyxnQkFBaUIsRUFBRSxLQUFLLE9BQU8sUUFBUSxJQUFJLE1BQU0sSUFBSSxPQUFPLFFBQVEsV0FBVyxtQkFBbUI7QUFBQSxFQUNsRyxlQUFpQixFQUFFLEtBQUssSUFBSSxRQUFRLFFBQVEsTUFBTSxRQUFRLE9BQU8sSUFBSSxXQUFXLEdBQUc7QUFBQSxFQUNuRixpQkFBaUIsRUFBRSxLQUFLLElBQUksUUFBUSxRQUFRLE1BQU0sT0FBTyxPQUFPLElBQUksV0FBVyxtQkFBbUI7QUFBQSxFQUNsRyxnQkFBaUIsRUFBRSxLQUFLLElBQUksUUFBUSxRQUFRLE1BQU0sSUFBSSxPQUFPLFFBQVEsV0FBVyxHQUFHO0FBQ3ZGO0FBRUEsU0FBUyxjQUFjLElBQUksVUFBVTtBQUNqQyxRQUFNLFNBQVMsVUFBVSxRQUFRLEtBQUssVUFBVSxZQUFZO0FBQzVELGFBQVcsQ0FBQyxNQUFNLEtBQUssS0FBSyxPQUFPLFFBQVEsTUFBTSxHQUFHO0FBQ2hELE9BQUcsTUFBTSxJQUFJLElBQUk7QUFBQSxFQUNyQjtBQUNKO0FBRUEsU0FBUyxVQUFVLElBQUk7QUFDbkIsU0FBTyxJQUFJLEtBQUssRUFBRSxFQUFFLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRSxFQUFFLFFBQVEsS0FBSyxHQUFHLElBQUk7QUFDdkU7QUFPTyxTQUFTLFdBQVcsR0FBRztBQUMxQixNQUFJLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxPQUFRLFFBQU87QUFDdEMsV0FBUyxFQUFFLFFBQVEsSUFBSSxFQUFFLFFBQVEsS0FBSyxPQUFPLEVBQUUsUUFBUSxPQUNqRCxFQUFFLFVBQVUsS0FBSyxFQUFFLFdBQVc7QUFDeEM7QUFJTyxTQUFTLGNBQWMsSUFBSTtBQUM5QixNQUFJLE9BQU8sS0FBSyxNQUFNLEtBQUssR0FBSTtBQUMvQixRQUFNLElBQUksS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUFHLFVBQVEsSUFBSTtBQUMvQyxRQUFNLElBQUksS0FBSyxNQUFNLE9BQU8sRUFBRTtBQUFHLFVBQVEsSUFBSTtBQUM3QyxNQUFJLE1BQU07QUFDVixNQUFJLEVBQUcsUUFBTyxHQUFHLENBQUM7QUFDbEIsTUFBSSxFQUFHLFFBQU8sR0FBRyxDQUFDO0FBQ2xCLE1BQUksUUFBUSxRQUFRLEtBQU0sUUFBTyxHQUFHLElBQUk7QUFDeEMsU0FBTztBQUNYO0FBTU8sU0FBUyxVQUFVLFVBQVUsYUFBYTtBQUM3QyxRQUFNLE1BQU0sQ0FBQyxHQUFHLE1BQU8sSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLElBQUk7QUFDM0MsTUFBSSxPQUFPO0FBQ1gsYUFBVyxLQUFLLGFBQWE7QUFDekIsUUFBSSxJQUFJLEVBQUcsUUFBTyxJQUFJLE1BQU0sS0FBSyxNQUFNLENBQUMsQ0FBQztBQUFBLEVBQzdDO0FBQ0EsU0FBTyxLQUFLLElBQUksTUFBTSxHQUFJO0FBQzlCO0FBSU8sU0FBUyxtQkFBbUIsUUFBUSxXQUFXO0FBQ2xELFFBQU0sTUFBTSxDQUFDO0FBQ2IsUUFBTSxRQUFRLFVBQVEsS0FBSyxRQUFRLE9BQUs7QUFDcEMsUUFBSSxFQUFFLFNBQVMsUUFBUyxRQUFPLE1BQU0sRUFBRSxVQUFVLENBQUMsQ0FBQztBQUNuRCxVQUFNLE9BQU8sRUFBRSxRQUFRLEVBQUUsS0FBSztBQUM5QixRQUFJLE9BQU8sU0FBUyxZQUFZLFNBQVMsVUFBVTtBQUMvQyxZQUFNLEtBQUssV0FBVyxZQUFZLElBQUksQ0FBQztBQUN2QyxVQUFJLEdBQUksS0FBSSxLQUFLLEVBQUU7QUFBQSxJQUN2QjtBQUFBLEVBQ0osQ0FBQztBQUNELFFBQU0sTUFBTTtBQUNaLE1BQUksV0FBVztBQUNYLFVBQU0sS0FBSyxXQUFXLFlBQVksU0FBUyxDQUFDO0FBQzVDLFFBQUksR0FBSSxLQUFJLEtBQUssRUFBRTtBQUFBLEVBQ3ZCO0FBQ0EsU0FBTztBQUNYO0FBS08sU0FBUyxXQUFXLE9BQU8sUUFBUSxhQUFhLEVBQUUsWUFBWSxHQUFHLFlBQVksSUFBSSxJQUFJLENBQUMsR0FBRztBQUM1RixNQUFJLE1BQU0sU0FBUyxFQUFHLFFBQU8sQ0FBQztBQUM5QixRQUFNLEtBQUssTUFBTSxDQUFDLEdBQUcsT0FBTyxNQUFNLE1BQU0sU0FBUyxDQUFDLElBQUk7QUFDdEQsUUFBTSxRQUFRLENBQUM7QUFDZixRQUFNLGFBQWEsS0FBSyxJQUFJLEdBQUcsS0FBSyxLQUFLLE1BQU0sU0FBUyxTQUFTLENBQUM7QUFDbEUsUUFBTSxRQUFRLENBQUMsR0FBRyxNQUFNLE1BQU0sS0FBSztBQUFBLElBQy9CLFdBQVcsSUFBSSxNQUFNO0FBQUEsSUFBTSxPQUFPO0FBQUEsSUFDbEMsT0FBTyxJQUFJLGVBQWUsSUFBSSxZQUFZLENBQUMsSUFBSTtBQUFBLEVBQ25ELENBQUMsQ0FBQztBQUNGLE1BQUksVUFBVSxTQUFTLE1BQU07QUFDekIsVUFBTSxRQUFRLEtBQUssTUFBTSxPQUFPLE1BQU07QUFDdEMsVUFBTSxPQUFPLEtBQUssSUFBSSxHQUFHLEtBQUssS0FBSyxRQUFRLFNBQVMsQ0FBQztBQUNyRCxhQUFTLElBQUksR0FBRyxJQUFJLFNBQVMsTUFBTSxLQUFLLE1BQU07QUFDMUMsWUFBTSxJQUFJLEtBQUssSUFBSTtBQUNuQixVQUFJLE1BQU0sU0FBUyxDQUFDLEVBQUc7QUFDdkIsWUFBTSxLQUFLLEVBQUUsV0FBVyxJQUFJLE1BQU0sTUFBTSxPQUFPLE9BQU8sT0FBTyxLQUFLLENBQUM7QUFBQSxJQUN2RTtBQUFBLEVBQ0o7QUFDQSxTQUFPO0FBQ1g7QUFFTyxTQUFTLGdCQUFnQixJQUFJLFVBQVU7QUFDMUMsUUFBTSxNQUFNLElBQUksS0FBSyxFQUFFLEVBQUUsWUFBWTtBQUNyQyxNQUFJLFlBQVksUUFBUSxXQUFXLEtBQUssSUFBTSxRQUFPLElBQUksTUFBTSxJQUFJLEVBQUU7QUFDckUsTUFBSSxZQUFZLFFBQVEsV0FBVyxLQUFLLE9BQU8sSUFBTSxRQUFPLElBQUksTUFBTSxJQUFJLEVBQUU7QUFDNUUsU0FBTyxJQUFJLE1BQU0sR0FBRyxFQUFFO0FBQzFCO0FBS0EsSUFBTSxRQUFRO0FBQUEsRUFDVixNQUFNO0FBQUEsRUFDTixNQUFNO0FBQUEsRUFDTixPQUFPO0FBQUEsRUFDUCxLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQ1Y7QUFjTyxTQUFTLGtCQUFrQixXQUFXLE9BQU8sVUFBVTtBQUMxRCxNQUFJLEtBQUssVUFBVSxjQUFjLHdCQUF3QjtBQUN6RCxNQUFJLENBQUMsTUFBTSxTQUFTLE1BQU0sTUFBTSxXQUFXLEdBQUc7QUFDMUMsUUFBSSxHQUFJLElBQUcsT0FBTztBQUNsQixXQUFPO0FBQUEsRUFDWDtBQUNBLE1BQUksQ0FBQyxJQUFJO0FBQ0wsU0FBSyxTQUFTLGNBQWMsS0FBSztBQUNqQyxPQUFHLFlBQVk7QUFDZixPQUFHLFlBQVk7QUFBQTtBQUFBLDhGQUV1RSxNQUFNLElBQUk7QUFBQSx1RUFDakMsTUFBTSxJQUFJO0FBQUEsbUdBQ2tCLE1BQU0sR0FBRztBQUFBLHVFQUNyQyxNQUFNLElBQUk7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQWlCekUsY0FBVSxZQUFZLEVBQUU7QUFFeEIsT0FBRyxjQUFjLHFCQUFxQixFQUFFLGlCQUFpQixTQUFTLFNBQVMsVUFBVTtBQUNyRixPQUFHLGNBQWMsb0JBQW9CLEVBQUUsaUJBQWlCLFNBQVMsU0FBUyxhQUFhO0FBQ3ZGLE9BQUcsY0FBYyxxQkFBcUIsRUFBRSxpQkFBaUIsU0FBUyxTQUFTLFlBQVk7QUFDdkYsT0FBRyxjQUFjLHFCQUFxQixFQUFFLGlCQUFpQixTQUFTLFNBQVMsWUFBWTtBQUN2RixPQUFHLGNBQWMsc0JBQXNCLEVBQUU7QUFBQSxNQUFpQjtBQUFBLE1BQ3RELE9BQUssU0FBUyxRQUFRLFdBQVcsRUFBRSxPQUFPLEtBQUssQ0FBQztBQUFBLElBQUM7QUFDckQsVUFBTSxTQUFTLEdBQUcsY0FBYyx1QkFBdUI7QUFHdkQsV0FBTyxpQkFBaUIsU0FBUyxPQUFLLFNBQVMsT0FBTyxTQUFTLEVBQUUsT0FBTyxPQUFPLEVBQUUsQ0FBQyxDQUFDO0FBRW5GLG9CQUFnQixJQUFJLFFBQVE7QUFBQSxFQUNoQztBQUVBLEtBQUcsY0FBYyx1QkFBdUIsRUFBRSxNQUFNLE9BQU8sTUFBTSxNQUFNLFNBQVMsQ0FBQztBQUM3RSxLQUFHLGNBQWMsdUJBQXVCLEVBQUUsUUFBUSxPQUFPLE1BQU0sS0FBSztBQUNwRSxLQUFHLGNBQWMsc0JBQXNCLEVBQUUsY0FBYyxVQUFVLE1BQU0sTUFBTSxNQUFNLEtBQUssQ0FBQztBQUV6RixRQUFNLE9BQU8sR0FBRyxjQUFjLHFCQUFxQjtBQUNuRCxPQUFLLFlBQVksTUFBTSxVQUFVLE1BQU0sUUFBUSxNQUFNO0FBQ3JELE9BQUssYUFBYSxjQUFjLE1BQU0sVUFBVSxVQUFVLE1BQU07QUFDaEUsT0FBSyxRQUFRLE1BQU0sVUFBVSxVQUFVO0FBSXZDLFFBQU0sT0FBTyxHQUFHLGNBQWMscUJBQXFCO0FBQ25ELE9BQUssVUFBVSxPQUFPLFVBQVUsUUFBUSxNQUFNLElBQUksQ0FBQztBQUNuRCxPQUFLLGFBQWEsZ0JBQWdCLE9BQU8sUUFBUSxNQUFNLElBQUksQ0FBQyxDQUFDO0FBQzdELE9BQUssUUFBUSxNQUFNLE9BQU8sYUFBYTtBQUV2QyxLQUFHLGNBQWMsc0JBQXNCLEVBQUUsUUFBUSxPQUFPLE1BQU0sU0FBUyxDQUFDO0FBQ3hFLGNBQVksSUFBSSxLQUFLO0FBQ3JCLGdCQUFjLElBQUksTUFBTSxRQUFRO0FBQ2hDLFNBQU87QUFDWDtBQUdBLFNBQVMsY0FBYyxPQUFPLEdBQUc7QUFDN0IsUUFBTSxPQUFPLE1BQU0sTUFBTSxTQUFTLENBQUMsSUFBSSxNQUFNLENBQUM7QUFDOUMsTUFBSSxRQUFRLEVBQUcsUUFBTztBQUN0QixTQUFPLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxJQUFJLElBQUksTUFBTSxDQUFDLEtBQUssSUFBSSxDQUFDO0FBQ3pEO0FBRUEsU0FBUyxZQUFZLElBQUksT0FBTztBQUM1QixRQUFNLEVBQUUsT0FBTyxNQUFNLElBQUk7QUFDekIsUUFBTSxRQUFRLEdBQUcsY0FBYyxzQkFBc0I7QUFDckQsUUFBTSxTQUFTO0FBRWYsUUFBTSxTQUFTLE1BQU0sS0FBSztBQUMxQixRQUFNLFdBQVcsTUFBTTtBQUN2QixRQUFNLFdBQVcsTUFBTSxTQUFTLFdBQVcsWUFBWSxNQUFNLE1BQU0sQ0FBQyxJQUFJO0FBQ3hFLFFBQU0sVUFBVSxZQUFZLE9BQU8sV0FBVztBQUs5QyxRQUFNLE9BQU8sR0FBRyxjQUFjLHFCQUFxQjtBQUNuRCxRQUFNLFFBQVEsY0FBYyxPQUFPLE1BQU07QUFDekMsUUFBTSxPQUFPLFdBQVcsT0FBTyxjQUFjLE9BQU8sU0FBUyxPQUFPLElBQUk7QUFDeEUsT0FBSyxNQUFNLE9BQU8sSUFBSSxPQUFPLEtBQUssUUFBUSxDQUFDLENBQUM7QUFDNUMsT0FBSyxNQUFNLFFBQVEsSUFBSSxLQUFLLElBQUksR0FBRyxRQUFRLElBQUksSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDO0FBQ2xFLE9BQUssVUFBVSxPQUFPLFlBQVksWUFBWSxJQUFJO0FBSWxELFFBQU0sUUFBUSxHQUFHLGNBQWMsc0JBQXNCO0FBQ3JELFFBQU0sS0FBSyxZQUFZLE9BQU8sY0FBYyxPQUFPLFNBQVMsUUFBUSxJQUFJO0FBQ3hFLFFBQU0sTUFBTSxPQUFPLElBQUksS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDO0FBQzNDLFFBQU0sVUFBVSxPQUFPLFVBQVUsWUFBWSxJQUFJO0FBQ2pELFFBQU0sYUFBYSxrQkFBa0IsTUFBTSxVQUFVLG9CQUFvQjtBQUV6RSxRQUFNLE1BQU0sVUFBVSxNQUFNLFNBQVMsS0FBSztBQUUxQyxRQUFNLFFBQVEsR0FBRyxjQUFjLHNCQUFzQjtBQUNyRCxRQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsQ0FBQyxJQUFJLE1BQU0sTUFBTSxJQUFJLE1BQU0sTUFBTSxJQUFJLFFBQVE7QUFDbkUsTUFBSSxNQUFNLFNBQVMsS0FBSztBQUNwQixVQUFNLE9BQU87QUFDYixVQUFNLFlBQVk7QUFDbEIsZUFBVyxRQUFRLFdBQVcsT0FBTyxNQUFNLFFBQVEsT0FBSyxnQkFBZ0IsR0FBRyxRQUFRLENBQUMsR0FBRztBQUNuRixZQUFNLElBQUksU0FBUyxjQUFjLE1BQU07QUFDdkMsUUFBRSxZQUFZLEtBQUssUUFBUSw2QkFBNkI7QUFDeEQsUUFBRSxNQUFNLE9BQU8sSUFBSSxLQUFLLFdBQVcsS0FBSyxRQUFRLENBQUMsQ0FBQztBQUNsRCxVQUFJLEtBQUssT0FBTztBQUNaLGNBQU0sTUFBTSxTQUFTLGNBQWMsTUFBTTtBQUN6QyxZQUFJLFlBQVk7QUFDaEIsWUFBSSxjQUFjLEtBQUs7QUFDdkIsVUFBRSxZQUFZLEdBQUc7QUFBQSxNQUNyQjtBQUNBLFlBQU0sWUFBWSxDQUFDO0FBQUEsSUFDdkI7QUFBQSxFQUNKO0FBQ0o7QUFLQSxTQUFTLGdCQUFnQixJQUFJLFVBQVU7QUFDbkMsUUFBTSxRQUFRLEdBQUcsY0FBYyxzQkFBc0I7QUFDckQsUUFBTSxRQUFRLEdBQUcsY0FBYyxzQkFBc0I7QUFFckQsV0FBUyxhQUFhLElBQUk7QUFDdEIsVUFBTSxRQUFRLE1BQU07QUFDcEIsVUFBTSxPQUFPLE1BQU0sc0JBQXNCO0FBQ3pDLFFBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxVQUFVLEtBQUssVUFBVSxFQUFHLFFBQU87QUFNeEQsVUFBTSxPQUFPLEtBQUssSUFBSSxJQUFJLEdBQUcsVUFBVSxLQUFLLFFBQVEsS0FBSyxLQUFLO0FBQzlELFVBQU0sS0FBSyxNQUFNLE1BQU0sQ0FBQztBQUN4QixVQUFNLFNBQVMsTUFBTSxNQUFNLE1BQU0sTUFBTSxTQUFTLENBQUMsSUFBSTtBQUNyRCxVQUFNLFNBQVMsTUFBTSxNQUFNLE1BQU0sS0FBSztBQUN0QyxVQUFNLE9BQU8sVUFBVSxLQUFLLE9BQU87QUFDbkMsVUFBTSxRQUFRLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxPQUFPLE1BQU0sTUFBTSxDQUFDO0FBQ3pELFdBQU8sVUFBVSxJQUFJLE9BQU8sY0FBYyxRQUFRLE1BQU0sTUFBTTtBQUFBLEVBQ2xFO0FBTUEsUUFBTSxpQkFBaUIsZUFBZSxRQUFNO0FBQ3hDLE9BQUcsZUFBZTtBQUNsQixPQUFHLGdCQUFnQjtBQU9uQixRQUFJO0FBQ0EsVUFBSSxNQUFNLGtCQUFtQixPQUFNLGtCQUFrQixHQUFHLFNBQVM7QUFBQSxJQUNyRSxTQUFTLEtBQUs7QUFBQSxJQUF1RTtBQUVyRixVQUFNLE9BQU8sT0FBSztBQUNkLFlBQU0sTUFBTSxhQUFhLENBQUM7QUFDMUIsVUFBSSxRQUFRLE9BQVcsVUFBUyxhQUFhLEdBQUc7QUFBQSxJQUNwRDtBQUNBLFVBQU0sU0FBUyxPQUFLO0FBQ2hCLGVBQVMsb0JBQW9CLGVBQWUsSUFBSTtBQUNoRCxlQUFTLG9CQUFvQixhQUFhLE1BQU07QUFDaEQsZUFBUyxvQkFBb0IsaUJBQWlCLE1BQU07QUFDcEQsWUFBTSxNQUFNLGFBQWEsQ0FBQztBQUMxQixVQUFJLFFBQVEsT0FBVyxVQUFTLGVBQWUsR0FBRztBQUFBLElBQ3REO0FBQ0EsYUFBUyxpQkFBaUIsZUFBZSxJQUFJO0FBQzdDLGFBQVMsaUJBQWlCLGFBQWEsTUFBTTtBQUM3QyxhQUFTLGlCQUFpQixpQkFBaUIsTUFBTTtBQUFBLEVBQ3JELENBQUM7QUFHRCxRQUFNLGlCQUFpQixXQUFXLFFBQU07QUFDcEMsVUFBTSxRQUFRLE1BQU07QUFDcEIsUUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLE9BQVE7QUFDN0IsVUFBTSxVQUFVLE1BQU0sU0FBUyxXQUFXLFlBQVksTUFBTSxNQUFNLENBQUMsSUFBSTtBQUN2RSxRQUFJO0FBQ0osUUFBSSxHQUFHLFFBQVEsWUFBYSxRQUFPLFVBQVUsTUFBTTtBQUFBLGFBQzFDLEdBQUcsUUFBUSxhQUFjLFFBQU8sS0FBSyxJQUFJLEdBQUcsVUFBVSxNQUFNLE1BQU07QUFBQSxhQUNsRSxHQUFHLFFBQVEsWUFBWSxHQUFHLFFBQVEsT0FBUSxRQUFPO0FBQUEsUUFDckQ7QUFDTCxPQUFHLGVBQWU7QUFDbEIsYUFBUyxlQUFlLE9BQU8sSUFBSSxjQUFjLElBQUksSUFBSSxJQUFJO0FBQUEsRUFDakUsQ0FBQztBQUNMOzs7QUMxY0EsSUFBTSxTQUFTO0FBUVIsSUFBTSxjQUFjO0FBTTNCLElBQUksUUFBUTtBQUNMLFNBQVMsbUJBQW1CO0FBQUUsU0FBTztBQUFPO0FBQzVDLFNBQVMsZUFBZSxRQUFRO0FBQ25DLE1BQUksTUFBTyxTQUFRLEtBQUssMkNBQTJDLE1BQU0scUNBQ2xDO0FBQ3ZDLFVBQVE7QUFDWjtBQUNBLElBQUksY0FBYztBQUNYLFNBQVMscUJBQXFCO0FBQUUsU0FBTztBQUFhO0FBQ3BELFNBQVMsaUJBQWlCLFFBQVE7QUFDckMsTUFBSSxZQUFhLFNBQVEsS0FBSyxvREFDdkIsTUFBTSx1REFBdUQ7QUFDcEUsZ0JBQWM7QUFDbEI7QUFLTyxTQUFTLG1CQUFtQjtBQUMvQixTQUFPO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLDBCQVNlLFdBQVc7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQW9CckM7QUFJQSxTQUFTLGdCQUFnQixNQUFNLFVBQVU7QUFDckMsTUFBSSxTQUFTLFFBQVEsU0FBUyxPQUFXLFFBQU87QUFDaEQsTUFBSSxTQUFTLFNBQVUsU0FBUSxZQUFZLEtBQUssT0FBTyxPQUFRO0FBQy9ELFFBQU0sS0FBSyxXQUFXLFlBQVksSUFBSSxDQUFDO0FBQ3ZDLFNBQU8sS0FBSyxLQUFLLE9BQVEsWUFBWSxLQUFLLE9BQU8sT0FBUTtBQUM3RDtBQU1PLFNBQVMsb0JBQW9CLFlBQVksbUJBQW1CLFVBQVU7QUFDekUsTUFBSSxRQUFRO0FBQ1osTUFBSSxVQUFVO0FBQ2QsUUFBTSxXQUFXLENBQUM7QUFDbEIsYUFBVyxTQUFTLFlBQVk7QUFDNUIsVUFBTSxNQUFNLGtCQUFrQixNQUFNLEVBQUU7QUFDdEMsVUFBTSxRQUFRLE1BQU0sSUFBSSxhQUFhLEtBQU0sTUFBTSxXQUFXLElBQUk7QUFDaEUsVUFBTSxRQUFRLE1BQU0sT0FBTyxTQUFTLE9BQU8saUJBQWlCLElBQUk7QUFDaEUsUUFBSSxNQUFNLEtBQU0sV0FBVTtBQUMxQixhQUFTLEtBQUssRUFBRSxPQUFPLE9BQU8sTUFBTSxDQUFDO0FBQ3JDLGFBQVM7QUFBQSxFQUNiO0FBQ0EsTUFBSSxDQUFDLFFBQVMsUUFBTyxFQUFFLFNBQVMsTUFBTTtBQUV0QyxNQUFJLE9BQU87QUFDWCxhQUFXLEVBQUUsTUFBTSxLQUFLLFVBQVU7QUFDOUIsUUFBSSxDQUFDLE1BQU87QUFDWixhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDdEMsVUFBSSxDQUFDLE9BQU8sTUFBTSxNQUFNLENBQUMsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxJQUFJLEtBQU0sUUFBTyxNQUFNLENBQUM7QUFBQSxJQUNsRTtBQUFBLEVBQ0o7QUFDQSxNQUFJLFNBQVMsU0FBVSxRQUFPO0FBRTlCLFFBQU0sUUFBUSxJQUFJLGFBQWEsUUFBUSxDQUFDO0FBQ3hDLFFBQU0sT0FBTyxJQUFJLGFBQWEsS0FBSztBQUNuQyxRQUFNLFdBQVcsSUFBSSxhQUFhLEtBQUs7QUFDdkMsUUFBTSxXQUFXLENBQUM7QUFDbEIsTUFBSSxNQUFNO0FBQ1YsYUFBVyxFQUFFLE9BQU8sT0FBTyxNQUFNLEtBQUssVUFBVTtBQUM1QyxVQUFNLE1BQU0sU0FBUztBQUNyQixhQUFTLEtBQUssTUFBTSxFQUFFO0FBQ3RCLFVBQU0sTUFBTSxNQUFNLE9BQU8sZ0JBQWdCLE1BQU0sS0FBSyxVQUFVLFFBQVEsSUFBSTtBQUcxRSxVQUFNLFlBQVksTUFBTSxRQUFRLE1BQU0sS0FBSyxPQUFPLENBQUMsTUFBTTtBQUN6RCxhQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sS0FBSztBQUM1QixZQUFNLFFBQVEsUUFBUSxNQUFNLElBQUksQ0FBQyxJQUFJO0FBQ3JDLFlBQU0sTUFBTSxRQUFRLE1BQU0sSUFBSSxJQUFJLENBQUMsSUFBSTtBQUN2QyxVQUFJLE9BQU8sTUFBTSxLQUFLLEdBQUc7QUFDckIsY0FBTSxNQUFNLENBQUMsSUFBSSxDQUFDO0FBQ2xCLGNBQU0sTUFBTSxJQUFJLENBQUMsSUFBSTtBQUNyQixhQUFLLEdBQUcsSUFBSTtBQUFBLE1BQ2hCLE9BQU87QUFDSCxjQUFNLE1BQU0sQ0FBQyxLQUFLLFFBQVEsUUFBUTtBQUNsQyxjQUFNLE1BQU0sSUFBSSxDQUFDLEtBQUssTUFBTSxRQUFRO0FBQ3BDLGFBQUssR0FBRyxJQUFJO0FBQUEsTUFDaEI7QUFDQSxlQUFTLEdBQUcsSUFBSTtBQUNoQjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQ0EsU0FBTyxFQUFFLFNBQVMsTUFBTSxNQUFNLE9BQU8sTUFBTSxVQUFVLFVBQVUsT0FBTyxNQUFNO0FBQ2hGO0FBTU8sU0FBUyxvQkFBb0IsWUFBWSxtQkFBbUIsVUFBVTtBQUN6RSxNQUFJLENBQUMsV0FBVyxLQUFLLE9BQUssRUFBRSxJQUFJLEVBQUcsUUFBTyxFQUFFLFNBQVMsTUFBTTtBQUMzRCxNQUFJLE9BQU87QUFDWCxhQUFXLFNBQVMsWUFBWTtBQUM1QixVQUFNLFFBQVEsTUFBTSxPQUFPLFNBQVMsT0FBTyxpQkFBaUIsSUFBSTtBQUNoRSxRQUFJLFNBQVMsQ0FBQyxPQUFPLE1BQU0sTUFBTSxDQUFDLENBQUMsS0FBSyxNQUFNLENBQUMsSUFBSSxLQUFNLFFBQU8sTUFBTSxDQUFDO0FBQUEsRUFDM0U7QUFDQSxNQUFJLFNBQVMsU0FBVSxRQUFPO0FBRTlCLFFBQU0sYUFBYSxXQUFXLElBQUksQ0FBQyxPQUFPLFFBQVE7QUFDOUMsVUFBTSxRQUFRLE1BQU0sT0FBTyxTQUFTLE9BQU8saUJBQWlCLElBQUk7QUFDaEUsVUFBTSxNQUFNLE1BQU0sT0FBTyxnQkFBZ0IsTUFBTSxLQUFLLFVBQVUsUUFBUSxJQUFJO0FBQzFFLFVBQU0sWUFBWSxNQUFNLFFBQVEsTUFBTSxLQUFLLE9BQU8sQ0FBQyxNQUFNO0FBQ3pELFFBQUksQ0FBQyxTQUFTLE9BQU8sTUFBTSxNQUFNLENBQUMsQ0FBQyxHQUFHO0FBQ2xDLGFBQU8sRUFBRSxPQUFPLENBQUMsUUFBUSxLQUFLLFFBQVEsS0FBSyxRQUFRLElBQUk7QUFBQSxJQUMzRDtBQUNBLFdBQU87QUFBQSxNQUFFLFFBQVEsTUFBTSxDQUFDLElBQUksUUFBUTtBQUFBLE1BQU0sTUFBTSxNQUFNLENBQUMsSUFBSSxRQUFRO0FBQUEsTUFDMUQsS0FBSztBQUFBLE1BQVc7QUFBQSxJQUFJO0FBQUEsRUFDakMsQ0FBQztBQUNELFNBQU8sRUFBRSxTQUFTLE1BQU0sTUFBTSxZQUFZLFVBQVUsV0FBVyxJQUFJLE9BQUssRUFBRSxFQUFFLEVBQUU7QUFDbEY7QUFJTyxTQUFTLGlCQUFpQixZQUFZLFFBQVE7QUFDakQsTUFBSSxRQUFRO0FBQ1osYUFBVyxLQUFLLE9BQVEsVUFBUztBQUNqQyxRQUFNLFFBQVEsSUFBSSxhQUFhLFFBQVEsQ0FBQztBQUN4QyxRQUFNLE9BQU8sSUFBSSxhQUFhLEtBQUs7QUFDbkMsUUFBTSxXQUFXLElBQUksYUFBYSxLQUFLO0FBQ3ZDLE1BQUksTUFBTTtBQUNWLGFBQVcsUUFBUSxDQUFDLEdBQUcsTUFBTTtBQUN6QixhQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sQ0FBQyxHQUFHLEtBQUs7QUFDaEMsWUFBTSxNQUFNLENBQUMsSUFBSSxFQUFFO0FBQ25CLFlBQU0sTUFBTSxJQUFJLENBQUMsSUFBSSxFQUFFO0FBQ3ZCLFdBQUssR0FBRyxJQUFJLEVBQUU7QUFDZCxlQUFTLEdBQUcsSUFBSSxFQUFFO0FBQ2xCO0FBQUEsSUFDSjtBQUFBLEVBQ0osQ0FBQztBQUNELFNBQU8sRUFBRSxPQUFPLE1BQU0sU0FBUztBQUNuQztBQUtBLElBQU0sb0JBQW9CO0FBUW5CLFNBQVMsMkJBQTJCLFVBQVUsTUFBTSxRQUFRO0FBQy9ELE1BQUk7QUFDQSxRQUFJLENBQUMsTUFBTSxRQUFRLE1BQU0sS0FBSyxPQUFPLFdBQVcsS0FBSyxXQUFXLFFBQVE7QUFDcEUsWUFBTSxJQUFJLE1BQU0sWUFBWSxLQUFLLFdBQVcsTUFBTSx1QkFDdkMsVUFBVSxPQUFPLE1BQU0sRUFBRTtBQUFBLElBQ3hDO0FBQ0EsVUFBTSxXQUFXLE9BQU8sT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsQ0FBQyxJQUFJO0FBR3JELFVBQU0sU0FBUyxTQUFTLG1CQUFtQixTQUFTLGlCQUFpQixTQUM5RCxNQUFNLFFBQVEsU0FBUyxRQUFRLElBQUksU0FBUyxTQUFTLFNBQVM7QUFDckUsUUFBSSxXQUFXLFVBQVU7QUFDckIsWUFBTSxJQUFJLE1BQU0sd0NBQXdDLFFBQVEsK0JBQ3RDLE1BQU0sRUFBRTtBQUFBLElBQ3RDO0FBQ0EsVUFBTSxRQUFRLGlCQUFpQixLQUFLLFlBQVksTUFBTTtBQUN0RCxVQUFNLE9BQU8sS0FBSztBQUNsQixVQUFNLFdBQVcsS0FBSztBQUN0QixXQUFPLG1CQUFtQixVQUFVLEtBQUs7QUFBQSxFQUM3QyxTQUFTLEtBQUs7QUFDVixxQkFBaUIsSUFBSSxPQUFPO0FBQzVCLFdBQU87QUFBQSxFQUNYO0FBQ0o7QUFNTyxTQUFTLHFCQUFxQixVQUFVLE9BQU87QUFDbEQsTUFBSTtBQUNBLFdBQU8sbUJBQW1CLFVBQVUsS0FBSztBQUFBLEVBQzdDLFNBQVMsS0FBSztBQUNWLG1CQUFlLElBQUksT0FBTztBQUMxQixXQUFPO0FBQUEsRUFDWDtBQUNKO0FBS0EsU0FBUyxtQkFBbUIsVUFBVSxPQUFPO0FBQ3pDO0FBQ0ksVUFBTSxLQUFLLFNBQVM7QUFDcEIsVUFBTSxVQUFVLFNBQVM7QUFDekIsVUFBTSxRQUFRLFNBQVM7QUFDdkIsUUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsTUFBTyxPQUFNLElBQUksTUFBTSxpQ0FBaUM7QUFFaEYsT0FBRyxXQUFXLE9BQU87QUFFckIsVUFBTSxVQUFVLEdBQUcsa0JBQWtCLFNBQVMsV0FBVztBQUN6RCxVQUFNLFNBQVMsR0FBRyxrQkFBa0IsU0FBUyxXQUFXO0FBQ3hELFVBQU0sV0FBVyxHQUFHLGtCQUFrQixTQUFTLFFBQVE7QUFDdkQsVUFBTSxVQUFVLEdBQUcsbUJBQW1CLFNBQVMsT0FBTztBQUN0RCxVQUFNLGNBQWMsR0FBRyxtQkFBbUIsU0FBUyxXQUFXO0FBRTlELFVBQU0sU0FBUyxHQUFHLG1CQUFtQixTQUFTLFdBQVcsS0FDbEQsR0FBRyxtQkFBbUIsU0FBUyxjQUFjO0FBQ3BELFFBQUksVUFBVSxLQUFLLFNBQVMsS0FBSyxXQUFXLEtBQUssQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLFFBQVE7QUFDbEYsWUFBTSxJQUFJLE1BQU0sMERBQTBEO0FBQUEsSUFDOUU7QUFFQSxVQUFNLFVBQVUsR0FBRyxhQUFhO0FBQ2hDLE9BQUcsV0FBVyxHQUFHLGNBQWMsT0FBTztBQUN0QyxPQUFHLFdBQVcsR0FBRyxjQUFjLE1BQU0sT0FBTyxHQUFHLFdBQVc7QUFDMUQsT0FBRyxvQkFBb0IsU0FBUyxHQUFHLEdBQUcsT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUN4RCxPQUFHLHdCQUF3QixPQUFPO0FBRWxDLFVBQU0sU0FBUyxHQUFHLGFBQWE7QUFDL0IsT0FBRyxXQUFXLEdBQUcsY0FBYyxNQUFNO0FBQ3JDLE9BQUcsV0FBVyxHQUFHLGNBQWMsTUFBTSxNQUFNLEdBQUcsV0FBVztBQUN6RCxPQUFHLG9CQUFvQixRQUFRLEdBQUcsR0FBRyxPQUFPLE9BQU8sR0FBRyxDQUFDO0FBQ3ZELE9BQUcsd0JBQXdCLE1BQU07QUFFakMsVUFBTSxXQUFXLEdBQUcsYUFBYTtBQUNqQyxPQUFHLFdBQVcsR0FBRyxjQUFjLFFBQVE7QUFDdkMsT0FBRyxXQUFXLEdBQUcsY0FBYyxNQUFNLFVBQVUsR0FBRyxXQUFXO0FBQzdELE9BQUcsb0JBQW9CLFVBQVUsR0FBRyxHQUFHLE9BQU8sT0FBTyxHQUFHLENBQUM7QUFDekQsT0FBRyx3QkFBd0IsUUFBUTtBQUduQyxPQUFHLFVBQVUsU0FBUyxNQUFNO0FBQzVCLE9BQUcsVUFBVSxhQUFhLEVBQUU7QUFDNUIsT0FBRyxXQUFXLFFBQVEsSUFBSSxhQUFhLFdBQVcsRUFBRSxLQUFLLENBQUMsQ0FBQztBQUUzRCxXQUFPO0FBQUEsTUFDSCxVQUFVLE1BQU07QUFBQTtBQUFBLE1BRWhCLFVBQVUsUUFBUSxZQUFZO0FBQzFCLFdBQUcsV0FBVyxPQUFPO0FBQ3JCLFdBQUcsVUFBVSxTQUFTLFdBQVcsT0FBTyxVQUFVLFNBQVMsTUFBTSxRQUFRLEdBQUk7QUFDN0UsV0FBRyxVQUFVLGFBQWEsZUFBZSxPQUFPLEtBQUssYUFBYSxHQUFJO0FBQ3RFLGNBQU0sT0FBTztBQUFBLE1BQ2pCO0FBQUE7QUFBQTtBQUFBLE1BR0EsbUJBQW1CLFVBQVU7QUFDekIsY0FBTSxNQUFNLElBQUksYUFBYSxXQUFXLEVBQUUsS0FBSyxDQUFDO0FBQ2hELFlBQUksSUFBSSxTQUFTLE1BQU0sR0FBRyxXQUFXLENBQUM7QUFDdEMsV0FBRyxXQUFXLE9BQU87QUFDckIsV0FBRyxXQUFXLFFBQVEsR0FBRztBQUN6QixjQUFNLE9BQU87QUFBQSxNQUNqQjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQ0o7OztBQ25UQSxTQUFTLHFCQUFxQixZQUFZO0FBQ3RDLE1BQUksY0FBYyxXQUFXLE9BQU87QUFDaEMsZUFBVyxNQUFNLG9CQUFvQixTQUFTLFFBQVEsTUFBTTtBQUN4RCxhQUFPLEtBQUssS0FBSyxRQUFRLElBQUksY0FBYyxRQUFRLElBQUk7QUFBQSxJQUMzRDtBQUNBLGVBQVcsTUFBTSxPQUFPO0FBQUEsRUFDNUI7QUFDSjtBQUVBLFNBQVMsbUJBQW1CLEtBQUssVUFBVSxRQUFRO0FBQy9DLE1BQUksQ0FBQyxJQUFJLGVBQWU7QUFDcEIsUUFBSSxnQkFBZ0IsQ0FBQztBQUFBLEVBQ3pCO0FBQ0EsTUFBSSxjQUFjLEtBQUssRUFBRSxVQUFVLE9BQU8sQ0FBQztBQUMzQyxNQUFJLENBQUMsSUFBSSxlQUFlO0FBQ3BCLFFBQUksZ0JBQWdCLFdBQVcsTUFBTTtBQUNqQyxVQUFJLGNBQWMsS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLFdBQVcsRUFBRSxRQUFRO0FBQ3hELFVBQUksSUFBSSxjQUFjLFNBQVMsR0FBRztBQUM5QixZQUFJLGNBQWMsQ0FBQyxFQUFFLE9BQU87QUFBQSxNQUNoQztBQUNBLFVBQUksZ0JBQWdCLENBQUM7QUFDckIsVUFBSSxnQkFBZ0I7QUFBQSxJQUN4QixHQUFHLENBQUM7QUFBQSxFQUNSO0FBQ0o7QUFFQSxTQUFTLG1CQUFtQixLQUFLLFVBQVUsUUFBUTtBQUMvQyxNQUFJLENBQUMsSUFBSSxlQUFlO0FBQ3BCLFFBQUksZ0JBQWdCLENBQUM7QUFBQSxFQUN6QjtBQUNBLE1BQUksY0FBYyxLQUFLLEVBQUUsVUFBVSxPQUFPLENBQUM7QUFDM0MsTUFBSSxDQUFDLElBQUksZUFBZTtBQUNwQixRQUFJLGdCQUFnQixXQUFXLE1BQU07QUFDakMsVUFBSSxjQUFjLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxXQUFXLEVBQUUsUUFBUTtBQUN4RCxVQUFJLElBQUksY0FBYyxTQUFTLEdBQUc7QUFDOUIsWUFBSSxjQUFjLENBQUMsRUFBRSxPQUFPO0FBQUEsTUFDaEM7QUFDQSxVQUFJLGdCQUFnQixDQUFDO0FBQ3JCLFVBQUksZ0JBQWdCO0FBQUEsSUFDeEIsR0FBRyxDQUFDO0FBQUEsRUFDUjtBQUNKO0FBYU8sU0FBUyxTQUFTLE9BQU8sT0FBTztBQUNuQyxRQUFNLFdBQVcsTUFBTSxRQUFRLE1BQU0sY0FBYyxJQUFJLE1BQU0sZUFBZSxLQUFLLElBQUk7QUFDckYsUUFBTSxZQUFZLE1BQU07QUFDeEIsUUFBTSxXQUFXLE1BQU0sbUJBQW1CLE1BQU0sZ0JBQWdCLEtBQUs7QUFDckUsTUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLENBQUMsU0FBVSxRQUFPO0FBQ2pELFNBQU8sRUFBRSxHQUFHLE9BQU8sR0FBSSxZQUFZLENBQUMsR0FBSSxHQUFJLGFBQWEsQ0FBQyxHQUFJLEdBQUksWUFBWSxDQUFDLEVBQUc7QUFDdEY7QUFFTyxTQUFTLHFCQUFxQixZQUFZLE9BQU87QUFDcEQsTUFBSSxDQUFDLFdBQVksUUFBTyxDQUFDO0FBQ3pCLFFBQU0sUUFBUSxDQUFDO0FBQ2YsU0FBTyxLQUFLLFVBQVUsRUFBRSxRQUFRLE9BQUs7QUFDakMsVUFBTSxNQUFNLFdBQVcsQ0FBQztBQUN4QixVQUFNLENBQUMsSUFBSSxNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksS0FBSyxJQUFJO0FBQUEsRUFDakQsQ0FBQztBQUNELFNBQU87QUFDWDtBQUlBLGVBQXNCLFlBQVksS0FBSyxPQUFPLGFBQWEsT0FBTztBQUM5RCxNQUFJLE1BQU0sU0FBUyxTQUFTO0FBQ3hCLFVBQU0sUUFBUSxFQUFFLFdBQVc7QUFDM0IsVUFBTSxvQkFBb0IsTUFBTSxJQUFJLG9CQUFvQixLQUFLLENBQUM7QUFDOUQsZUFBVyxPQUFPLE1BQU0sUUFBUTtBQUM1QixVQUFJLElBQUksU0FBUyxvQkFBb0IsSUFBSSxTQUFTLGFBQWEsSUFBSSxTQUFTLGNBQWMsSUFBSSxTQUFTLGFBQWEsSUFBSSxTQUFTLFVBQVU7QUFDdkk7QUFBQSxNQUNKO0FBQ0EsWUFBTSxXQUFXLE1BQU0sWUFBWSxLQUFLLEtBQUssa0JBQWtCLElBQUksRUFBRSxHQUFHLEtBQUs7QUFDN0UsVUFBSSxVQUFVO0FBQ1YsY0FBTSxTQUFTLFFBQVE7QUFBQSxNQUMzQjtBQUFBLElBQ0o7QUFDQSxVQUFNLE1BQU0sR0FBRztBQUNmLFVBQU0sWUFBWSxNQUFNO0FBQ3hCLFdBQU87QUFBQSxFQUNYO0FBQ0EsU0FBTztBQUNYO0FBRUEsZUFBc0Isb0JBQW9CLEtBQUssTUFBTSxZQUFZLG1CQUFtQixPQUN6QyxZQUFZLE1BQU0sWUFBWSxPQUFPO0FBTTVFLFFBQU0sYUFBYSxhQUFhLFNBQVMsb0JBQW9CLFNBQVMsWUFDaEU7QUFBQSxJQUFvQjtBQUFBLElBQVk7QUFBQSxJQUM5QixhQUFhLFVBQVUsU0FBUyxXQUFXLFVBQVUsTUFBTSxJQUFJO0FBQUEsRUFBSSxJQUNyRSxFQUFFLFNBQVMsTUFBTTtBQUN2QixRQUFNLGFBQWEsUUFBUSxXQUFXLE9BQU87QUFDN0MsTUFBSSxhQUFhLENBQUMsY0FBYyxTQUFTLG9CQUFvQixTQUFTLFdBQVc7QUFDN0UsaUJBQWEsV0FBVyxPQUFPLE9BQUssY0FBYyxHQUFHLG1CQUFtQixTQUFTLENBQUM7QUFDbEYsUUFBSSxXQUFXLFdBQVcsRUFBRyxRQUFPO0FBQUEsRUFDeEM7QUFDQSxNQUFJLFNBQVMsWUFBWTtBQUNyQixVQUFNLFdBQVcsQ0FBQztBQUNsQixVQUFNLGVBQWUsQ0FBQztBQUN0QixlQUFXLFNBQVMsWUFBWTtBQUM1QixZQUFNLGdCQUFnQixNQUFNLFVBQVUsSUFBSSxPQUFLLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUMzRCxtQkFBYSxLQUFLLEtBQUssSUFBSSxHQUFHLEtBQUssY0FBYyxTQUFTLEVBQUUsQ0FBQztBQUM3RCxZQUFNLFFBQVEsU0FBUyxPQUFPLENBQUM7QUFDL0IsWUFBTSxNQUFNLFdBQVcsTUFBTSxPQUFPLFNBQVM7QUFDN0MsZUFBUyxLQUFLO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixVQUFVO0FBQUEsVUFDTixNQUFNO0FBQUEsVUFDTixhQUFhO0FBQUEsUUFDakI7QUFBQSxRQUNBLFlBQVk7QUFBQSxVQUNSO0FBQUEsVUFDQSxVQUFVLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxNQUFNLFdBQVcsRUFBSTtBQUFBLFVBQ2xFLFFBQVEsTUFBTSxVQUFVO0FBQUEsUUFDNUI7QUFBQSxNQUNKLENBQUM7QUFBQSxJQUNMO0FBRUEsUUFBSSxTQUFTLFdBQVcsRUFBRyxRQUFPO0FBRWxDLFVBQU0sVUFBVTtBQUFBLE1BQ1osTUFBTTtBQUFBLE1BQ047QUFBQSxJQUNKO0FBRUEsVUFBTUEsV0FBVSxFQUFFLE1BQU0sT0FBTztBQUFBLE1BQzNCLE9BQU8sU0FBUyxHQUFHO0FBQ2YsYUFBSyxPQUFPO0FBQ1osYUFBSyxjQUFjO0FBRW5CLGFBQUssdUJBQXVCLENBQUMsTUFBTTtBQUMvQixxQkFBVyxNQUFNO0FBQ2IsZ0JBQUksQ0FBQyxLQUFLLGFBQWE7QUFDbkIsa0JBQUksYUFBYSxFQUFFLE1BQU0sU0FBUztBQUNsQyxrQkFBSSxLQUFLLGdCQUFnQjtBQUNyQixxQkFBSyxlQUFlLE9BQU87QUFDM0IscUJBQUssaUJBQWlCO0FBQUEsY0FDMUI7QUFBQSxZQUNKO0FBQ0EsaUJBQUssY0FBYztBQUFBLFVBQ3ZCLEdBQUcsQ0FBQztBQUFBLFFBQ1I7QUFDQSxVQUFFLEdBQUcsYUFBYSxLQUFLLG9CQUFvQjtBQUUzQyxjQUFNLGNBQWMsYUFDZCxFQUFFLG9CQUFvQixNQUFNLGlCQUFpQixFQUFFLElBQUksQ0FBQztBQUMxRCxhQUFLLFVBQVUsRUFBRSxNQUFNLE1BQU07QUFBQSxVQUN6QixHQUFHO0FBQUEsVUFDSCxLQUFLO0FBQUEsVUFDTCxNQUFNO0FBQUEsVUFDTixNQUFNO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBWU4sYUFBYTtBQUFBLFVBQ2IsY0FBYztBQUFBLFVBQ2QsT0FBTyxDQUFDLE9BQU8sWUFBWTtBQUN2QixtQkFBTyxRQUFRLFdBQVc7QUFBQSxVQUM5QjtBQUFBLFVBQ0EsUUFBUSxDQUFDLE9BQU8sWUFBWTtBQUN4QixtQkFBTyxRQUFRLFdBQVc7QUFBQSxVQUM5QjtBQUFBLFVBQ0EsT0FBTyxDQUFDLEdBQUcsWUFBWTtBQUNuQiwrQkFBbUIsS0FBSyxHQUFHLE1BQU07QUFDN0Isa0JBQUksV0FBVyxRQUFRLGNBQWMsUUFBUSxXQUFXLE9BQU87QUFDM0Qsc0JBQU0sUUFBUSxRQUFRLFdBQVc7QUFDakMsMEJBQVUsS0FBSyxFQUFFLFFBQVEsTUFBTSxZQUFZLEtBQUs7QUFLaEQsb0JBQUk7QUFDQSx3QkFBTSxJQUFJLG9CQUFvQixNQUFNLEVBQUU7QUFDdEMsd0JBQU0sSUFBSSxrQkFBa0IsQ0FBQztBQUM3Qix3QkFBTSxhQUFhO0FBQUEsZ0JBQ3ZCLFNBQVMsS0FBSztBQUFBLGdCQUF3QjtBQUFBLGNBQzFDO0FBQUEsWUFDSixDQUFDO0FBQUEsVUFDTDtBQUFBLFVBQ0EsT0FBTyxDQUFDLEdBQUcsWUFBWTtBQUNuQixpQkFBSyxjQUFjO0FBQ25CLGdCQUFJLFdBQVcsUUFBUSxjQUFjLFFBQVEsV0FBVyxPQUFPO0FBQzNELGlDQUFtQixLQUFLLEdBQUcsTUFBTTtBQUM3QixzQkFBTSxRQUFRLFFBQVEsV0FBVztBQUNqQyxvQkFBSSxhQUFhLEVBQUUsTUFBTSxTQUFTO0FBQ2xDLDRCQUFZLEtBQUssRUFBRSxRQUFRLE1BQU0sWUFBWSxPQUFPLElBQUk7QUFBQSxjQUM1RCxDQUFDO0FBQUEsWUFDTDtBQUFBLFVBQ0o7QUFBQSxRQUNKLENBQUM7QUFDRCw2QkFBcUIsS0FBSyxPQUFPO0FBQ2pDLFlBQUksWUFBWTtBQUNaLGVBQUssZ0JBQWdCLDJCQUEyQixLQUFLLFNBQVMsWUFBWSxZQUFZO0FBQUEsUUFDMUY7QUFBQSxNQUNKO0FBQUEsTUFDQSxVQUFVLFNBQVMsR0FBRztBQUNsQixZQUFJLEtBQUssc0JBQXNCO0FBQzNCLFlBQUUsSUFBSSxhQUFhLEtBQUssb0JBQW9CO0FBQUEsUUFDaEQ7QUFDQSxZQUFJLEtBQUssUUFBUyxNQUFLLFFBQVEsT0FBTztBQUN0QyxZQUFJLEtBQUssZ0JBQWdCO0FBQ3JCLGVBQUssZUFBZSxPQUFPO0FBQzNCLGVBQUssaUJBQWlCO0FBQUEsUUFDMUI7QUFDQSxZQUFJLGFBQWEsRUFBRSxNQUFNLFNBQVM7QUFBQSxNQUN0QztBQUFBLElBQ0osQ0FBQztBQUNELFVBQU1DLFlBQVcsSUFBSUQsU0FBUTtBQUM3QixJQUFBQyxVQUFTLE1BQU0sR0FBRztBQUNsQixJQUFBQSxVQUFTLFlBQVk7QUFDckIsV0FBT0E7QUFBQSxFQUNYO0FBRUEsTUFBSSxTQUFTLFdBQVc7QUFDcEIsVUFBTSxXQUFXLENBQUM7QUFDbEIsVUFBTSxlQUFlLENBQUM7QUFDdEIsZUFBVyxTQUFTLFlBQVk7QUFDNUIsVUFBSSxnQkFBZ0IsQ0FBQztBQUNyQixVQUFJLE1BQU0sU0FBUyxXQUFXO0FBQzFCLHdCQUFnQixNQUFNLFVBQVUsSUFBSSxPQUFLLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNyRCxZQUFJLGNBQWMsU0FBUyxHQUFHO0FBQzFCLGdCQUFNLFFBQVEsY0FBYyxDQUFDO0FBQzdCLGdCQUFNLE9BQU8sY0FBYyxjQUFjLFNBQVMsQ0FBQztBQUNuRCxjQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxLQUFLLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxHQUFHO0FBQzlDLDBCQUFjLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQUEsVUFDM0M7QUFBQSxRQUNKO0FBQUEsTUFDSixXQUFXLE1BQU0sU0FBUyxVQUFVO0FBQ2hDLGNBQU0sTUFBTSxNQUFNLFNBQVMsQ0FBQztBQUM1QixjQUFNLE1BQU0sTUFBTSxTQUFTLENBQUM7QUFDNUIsY0FBTSxlQUFlLE1BQU0sVUFBVTtBQUNyQyxjQUFNLGNBQWM7QUFDcEIsaUJBQVMsSUFBSSxHQUFHLEtBQUssSUFBSSxLQUFLO0FBQzFCLGdCQUFNLFFBQVMsSUFBSSxNQUFPO0FBQzFCLGdCQUFNLFdBQVksUUFBUSxLQUFLLEtBQU07QUFDckMsZ0JBQU0sT0FBUSxlQUFlLEtBQUssSUFBSSxRQUFRLElBQUs7QUFDbkQsZ0JBQU0sT0FBUSxlQUFlLEtBQUssSUFBSSxRQUFRLEtBQU0sY0FBYyxLQUFLLElBQUssTUFBTSxLQUFLLEtBQU0sR0FBRztBQUNoRyxnQkFBTSxTQUFTLE1BQU8sT0FBTyxNQUFPLEtBQUs7QUFDekMsZ0JBQU0sU0FBUyxNQUFPLE9BQU8sTUFBTyxLQUFLO0FBQ3pDLHdCQUFjLEtBQUssQ0FBQyxRQUFRLE1BQU0sQ0FBQztBQUFBLFFBQ3ZDO0FBQUEsTUFDSjtBQUVBLFVBQUksY0FBYyxXQUFXLEdBQUc7QUFDNUIscUJBQWEsS0FBSyxDQUFDO0FBQ25CO0FBQUEsTUFDSjtBQUlBLFlBQU0sV0FBVyxjQUFjLFNBQVM7QUFDeEMsbUJBQWEsS0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLFdBQVcsRUFBRSxDQUFDO0FBRWpELFlBQU0sUUFBUSxTQUFTLE9BQU8sQ0FBQztBQUMvQixZQUFNLE1BQU0sV0FBVyxNQUFNLE9BQU8sU0FBUztBQUM3QyxlQUFTLEtBQUs7QUFBQSxRQUNWLE1BQU07QUFBQSxRQUNOLFVBQVU7QUFBQSxVQUNOLE1BQU07QUFBQSxVQUNOLGFBQWEsQ0FBQyxhQUFhO0FBQUEsUUFDL0I7QUFBQSxRQUNBLFlBQVk7QUFBQSxVQUNSO0FBQUEsVUFDQSxVQUFVLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxNQUFNLGVBQWUsSUFBSTtBQUFBLFFBQzFFO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDTDtBQUVBLFFBQUksU0FBUyxXQUFXLEVBQUcsUUFBTztBQUVsQyxVQUFNLFVBQVU7QUFBQSxNQUNaLE1BQU07QUFBQSxNQUNOO0FBQUEsSUFDSjtBQUVBLFVBQU1ELFdBQVUsRUFBRSxNQUFNLE9BQU87QUFBQSxNQUMzQixPQUFPLFNBQVMsR0FBRztBQUNmLGFBQUssT0FBTztBQUNaLGFBQUssY0FBYztBQUVuQixhQUFLLHVCQUF1QixDQUFDLE1BQU07QUFDL0IscUJBQVcsTUFBTTtBQUNiLGdCQUFJLENBQUMsS0FBSyxhQUFhO0FBQ25CLGtCQUFJLGFBQWEsRUFBRSxNQUFNLFNBQVM7QUFDbEMsa0JBQUksS0FBSyxnQkFBZ0I7QUFDckIscUJBQUssZUFBZSxPQUFPO0FBQzNCLHFCQUFLLGlCQUFpQjtBQUFBLGNBQzFCO0FBQUEsWUFDSjtBQUNBLGlCQUFLLGNBQWM7QUFBQSxVQUN2QixHQUFHLENBQUM7QUFBQSxRQUNSO0FBQ0EsVUFBRSxHQUFHLGFBQWEsS0FBSyxvQkFBb0I7QUFFM0MsY0FBTSxlQUFlLGFBQ2YsRUFBRSxvQkFBb0IsTUFBTSxpQkFBaUIsRUFBRSxJQUFJLENBQUM7QUFDMUQsYUFBSyxXQUFXLEVBQUUsTUFBTSxPQUFPO0FBQUEsVUFDM0IsR0FBRztBQUFBLFVBQ0gsS0FBSztBQUFBLFVBQ0wsTUFBTTtBQUFBLFVBQ04sTUFBTTtBQUFBLFVBQ04sT0FBTyxDQUFDLE9BQU8sWUFBWTtBQUN2QixtQkFBTyxRQUFRLFdBQVc7QUFBQSxVQUM5QjtBQUFBLFVBQ0EsT0FBTyxDQUFDLEdBQUcsWUFBWTtBQUNuQiwrQkFBbUIsS0FBSyxHQUFHLE1BQU07QUFDN0Isa0JBQUksV0FBVyxRQUFRLGNBQWMsUUFBUSxXQUFXLE9BQU87QUFDM0Qsc0JBQU0sUUFBUSxRQUFRLFdBQVc7QUFDakMsMEJBQVUsS0FBSyxFQUFFLFFBQVEsTUFBTSxZQUFZLEtBQUs7QUFLaEQsb0JBQUk7QUFDQSx3QkFBTSxJQUFJLG9CQUFvQixNQUFNLEVBQUU7QUFDdEMsd0JBQU0sSUFBSSxrQkFBa0IsQ0FBQztBQUM3Qix3QkFBTSxhQUFhO0FBQUEsZ0JBQ3ZCLFNBQVMsS0FBSztBQUFBLGdCQUF3QjtBQUFBLGNBQzFDO0FBQUEsWUFDSixDQUFDO0FBQUEsVUFDTDtBQUFBLFVBQ0EsT0FBTyxDQUFDLEdBQUcsWUFBWTtBQUNuQixpQkFBSyxjQUFjO0FBQ25CLGdCQUFJLFdBQVcsUUFBUSxjQUFjLFFBQVEsV0FBVyxPQUFPO0FBQzNELGlDQUFtQixLQUFLLEdBQUcsTUFBTTtBQUM3QixzQkFBTSxRQUFRLFFBQVEsV0FBVztBQUNqQyxvQkFBSSxhQUFhLEVBQUUsTUFBTSxTQUFTO0FBQ2xDLDRCQUFZLEtBQUssRUFBRSxRQUFRLE1BQU0sWUFBWSxPQUFPLElBQUk7QUFBQSxjQUM1RCxDQUFDO0FBQUEsWUFDTDtBQUFBLFVBQ0o7QUFBQSxRQUNKLENBQUM7QUFDRCw2QkFBcUIsS0FBSyxRQUFRO0FBQ2xDLFlBQUksWUFBWTtBQUNaLGVBQUssZ0JBQWdCLDJCQUEyQixLQUFLLFVBQVUsWUFBWSxZQUFZO0FBQUEsUUFDM0Y7QUFBQSxNQUNKO0FBQUEsTUFDQSxVQUFVLFNBQVMsR0FBRztBQUNsQixZQUFJLEtBQUssc0JBQXNCO0FBQzNCLFlBQUUsSUFBSSxhQUFhLEtBQUssb0JBQW9CO0FBQUEsUUFDaEQ7QUFDQSxZQUFJLEtBQUssU0FBVSxNQUFLLFNBQVMsT0FBTztBQUN4QyxZQUFJLEtBQUssZ0JBQWdCO0FBQ3JCLGVBQUssZUFBZSxPQUFPO0FBQzNCLGVBQUssaUJBQWlCO0FBQUEsUUFDMUI7QUFDQSxZQUFJLGFBQWEsRUFBRSxNQUFNLFNBQVM7QUFBQSxNQUN0QztBQUFBLElBQ0osQ0FBQztBQUNELFVBQU1DLFlBQVcsSUFBSUQsU0FBUTtBQUM3QixJQUFBQyxVQUFTLE1BQU0sR0FBRztBQUNsQixJQUFBQSxVQUFTLFlBQVk7QUFDckIsV0FBT0E7QUFBQSxFQUNYO0FBRUEsUUFBTSxhQUFhLENBQUM7QUFDcEIsUUFBTSxlQUFlLENBQUM7QUFFdEIsUUFBTSxnQkFBZ0IsU0FBUyxZQUFZLFlBQVk7QUFHdkQsUUFBTSxjQUFjLFNBQVMsWUFBWSxLQUFLO0FBTTlDLFFBQU0sV0FBVyxpQkFBaUIsSUFDNUI7QUFBQSxJQUFvQjtBQUFBLElBQVk7QUFBQSxJQUM5QixhQUFhLFVBQVUsU0FBUyxXQUFXLFVBQVUsTUFBTSxJQUFJO0FBQUEsRUFBSSxJQUNyRSxFQUFFLFNBQVMsTUFBTTtBQUN2QixRQUFNLFVBQVUsUUFBUSxTQUFTLE9BQU87QUFFeEMsYUFBVyxTQUFTLFlBQVk7QUFDNUIsVUFBTSxXQUFXLFdBQVcsTUFBTSxPQUFPLGFBQWE7QUFDdEQsVUFBTSxZQUFZLE1BQU0sVUFBVSxPQUFPLE9BQU8sTUFBTSxNQUFNLElBQUk7QUFFaEUsVUFBTSxjQUFjLGtCQUFrQixNQUFNLEVBQUU7QUFDOUMsUUFBSSxDQUFDLGFBQWE7QUFDZCxVQUFJLE1BQU0sWUFBWSxjQUFjLE9BQU8sbUJBQW1CLFNBQVMsR0FBRztBQUN0RSxtQkFBVyxLQUFLLENBQUMsTUFBTSxTQUFTLENBQUMsR0FBRyxNQUFNLFNBQVMsQ0FBQyxDQUFDLENBQUM7QUFDdEQscUJBQWEsS0FBSztBQUFBLFVBQ2Q7QUFBQSxVQUNBLGVBQWU7QUFBQSxVQUNmO0FBQUEsVUFDQSxNQUFNO0FBQUEsUUFDVixDQUFDO0FBQUEsTUFDTDtBQUNBO0FBQUEsSUFDSjtBQUVBLFVBQU0sU0FBUyxJQUFJO0FBQUEsTUFDZixZQUFZO0FBQUEsTUFDWixZQUFZO0FBQUEsTUFDWixZQUFZLGFBQWE7QUFBQSxJQUM3QjtBQUNBLFVBQU0sUUFBUSxPQUFPLFNBQVM7QUFFOUIsVUFBTSxhQUFhLE1BQU0sUUFBUSxNQUFNLGNBQWMsSUFBSSxNQUFNLGlCQUFpQjtBQUdoRixVQUFNLFlBQVksTUFBTSxtQkFBbUI7QUFDM0MsVUFBTSxZQUFZLE1BQU0sbUJBQW1CO0FBSTNDLFVBQU0sTUFBTSxDQUFDLFdBQVcsYUFBYSxNQUFNLE9BQ3JDLFVBQVUsVUFBVSxNQUFNLGtCQUFrQixPQUFPLFNBQVMsR0FBRyxVQUFVLE1BQU0sSUFDL0U7QUFDTixVQUFNLFFBQVEsTUFBTSxTQUFTLE9BQU8saUJBQWlCLElBQUk7QUFFekQsYUFBUyxJQUFJLEdBQUcsSUFBSSxPQUFPLEtBQUs7QUFDNUIsVUFBSSxTQUFTLENBQUMsZ0JBQWdCLE1BQU0sSUFBSSxDQUFDLEdBQUcsTUFBTSxJQUFJLElBQUksQ0FBQyxHQUFHLEdBQUcsRUFBRztBQUNwRSxZQUFNLFdBQVcsYUFBYSxXQUFXLENBQUMsSUFBSTtBQUM5QyxZQUFNLFdBQVcsWUFBWSxVQUFVLENBQUMsSUFBSTtBQUM1QyxZQUFNLFFBQVMsWUFBWSxTQUFTLFNBQzVCLGFBQWEsVUFBVSxTQUN2QixZQUFZLFNBQVM7QUFDN0IsWUFBTSxTQUFTLFlBQVksU0FBUyxVQUFVLE9BQU8sU0FBUyxTQUN4RCxhQUFhLFVBQVUsVUFBVSxPQUFPLFVBQVUsU0FDbEQsWUFBWSxTQUFTLFVBQVUsT0FBTyxTQUFTLFNBQy9DO0FBRU4saUJBQVcsS0FBSyxDQUFDLE9BQU8sSUFBSSxDQUFDLEdBQUcsT0FBTyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDbEQsbUJBQWEsS0FBSztBQUFBLFFBQ2Q7QUFBQSxRQUNBLGVBQWU7QUFBQSxRQUNmLFVBQVUsUUFBUSxXQUFXLE9BQU8sYUFBYSxJQUFJO0FBQUEsUUFDckQsTUFBTSxVQUFVLE9BQU8sT0FBTyxNQUFNLElBQUk7QUFBQSxNQUM1QyxDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0o7QUFFQSxNQUFJLFdBQVcsV0FBVyxFQUFHLFFBQU87QUFFcEMsUUFBTSxVQUFVLEVBQUUsTUFBTSxPQUFPO0FBQUEsSUFDM0IsT0FBTyxTQUFTLEdBQUc7QUFDZixXQUFLLE9BQU87QUFDWixXQUFLLGNBQWM7QUFFbkIsWUFBTSxtQkFBbUIsTUFBTTtBQUMzQixlQUFPLElBQUksUUFBUSxZQUFZLEVBQUUsY0FBYyxRQUFRLEtBQUssSUFBSSxhQUFhO0FBQUEsTUFDakY7QUFFQSxXQUFLLHVCQUF1QixDQUFDLE1BQU07QUFDL0IsbUJBQVcsTUFBTTtBQUNiLGNBQUksQ0FBQyxLQUFLLGFBQWE7QUFDbkIsZ0JBQUksYUFBYSxFQUFFLE1BQU0sU0FBUztBQUNsQyxrQkFBTSxLQUFLLGlCQUFpQjtBQUM1QixnQkFBSSxHQUFJLElBQUcsTUFBTSxTQUFTO0FBQzFCLGdCQUFJLEtBQUssZ0JBQWdCO0FBQ3JCLG1CQUFLLGVBQWUsT0FBTztBQUMzQixtQkFBSyxpQkFBaUI7QUFBQSxZQUMxQjtBQUFBLFVBQ0o7QUFDQSxlQUFLLGNBQWM7QUFBQSxRQUN2QixHQUFHLENBQUM7QUFBQSxNQUNSO0FBQ0EsUUFBRSxHQUFHLGFBQWEsS0FBSyxvQkFBb0I7QUFFM0MsWUFBTSxlQUFlO0FBQUEsUUFDakIsS0FBSztBQUFBLFFBQ0wsTUFBTTtBQUFBLFFBQ04sTUFBTTtBQUFBO0FBQUE7QUFBQSxRQUdOLE1BQU0sQ0FBQyxVQUFVO0FBQ2IsZ0JBQU0sT0FBTyxhQUFhLEtBQUs7QUFDL0IsaUJBQU8sUUFBUSxLQUFLLFFBQVEsT0FBTyxLQUFLLE9BQU87QUFBQSxRQUNuRDtBQUFBLFFBQ0EsT0FBTyxDQUFDLE9BQU8sVUFBVTtBQUNyQixnQkFBTSxPQUFPLGFBQWEsS0FBSztBQUMvQixpQkFBTyxPQUFPLEtBQUssV0FBVyxFQUFFLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxFQUFJO0FBQUEsUUFDM0Q7QUFBQSxRQUNBLFNBQVM7QUFBQSxRQUNULGFBQWEsU0FBUyxZQUFZLEtBQUs7QUFBQSxRQUN2QyxPQUFPLENBQUMsR0FBRyxVQUFVO0FBQ2pCLGNBQUksQ0FBQyxNQUFPO0FBR1osZ0JBQU0sYUFBYSxJQUFJLHVCQUF1QixFQUFFLE1BQU07QUFDdEQsZ0JBQU0sY0FBYyxJQUFJLHVCQUF1QixFQUFFLE9BQU8sTUFBTSxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUMzRSxnQkFBTSxZQUFZLFdBQVcsV0FBVyxXQUFXO0FBQ25ELGdCQUFNLFVBQVUsU0FBUyxZQUFZLEtBQUs7QUFDMUMsY0FBSSxZQUFZLFFBQVM7QUFFekIsNkJBQW1CLEtBQUssR0FBRyxNQUFNO0FBQzdCLGtCQUFNLE1BQU0sV0FBVyxRQUFRLEtBQUs7QUFDcEMsa0JBQU0sT0FBTyxhQUFhLEdBQUc7QUFDN0IsZ0JBQUksTUFBTTtBQUNOLG9CQUFNLFFBQVEsS0FBSztBQUNuQixvQkFBTSxnQkFBZ0IsS0FBSztBQUMzQixvQkFBTSxRQUFRLHFCQUFxQixNQUFNLFlBQVksYUFBYTtBQUNsRSx3QkFBVSxLQUFLLE9BQU8sT0FBTyxLQUFLO0FBQ2xDLGtCQUFJO0FBQ0Esc0JBQU0sSUFBSSxvQkFBb0IsTUFBTSxFQUFFO0FBQ3RDLHNCQUFNLElBQUksa0JBQWtCLGFBQWE7QUFDekMsc0JBQU0sYUFBYTtBQUFBLGNBQ3ZCLFNBQVMsS0FBSztBQUFBLGNBQXdCO0FBQUEsWUFDMUM7QUFBQSxVQUNKLENBQUM7QUFBQSxRQUNMO0FBQUEsUUFDQSxPQUFPLENBQUMsR0FBRyxVQUFVO0FBQ2pCLGVBQUssY0FBYztBQUNuQixjQUFJLE9BQU87QUFFUCxrQkFBTSxhQUFhLElBQUksdUJBQXVCLEVBQUUsTUFBTTtBQUN0RCxrQkFBTSxjQUFjLElBQUksdUJBQXVCLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQzNFLGtCQUFNLFlBQVksV0FBVyxXQUFXLFdBQVc7QUFDbkQsa0JBQU0sVUFBVSxTQUFTLFlBQVksS0FBSztBQUMxQyxnQkFBSSxZQUFZLFFBQVM7QUFFekIsK0JBQW1CLEtBQUssR0FBRyxNQUFNO0FBQzdCLGtCQUFJLGFBQWEsRUFBRSxNQUFNLFNBQVM7QUFDbEMsb0JBQU0sS0FBSyxpQkFBaUI7QUFDNUIsa0JBQUksR0FBSSxJQUFHLE1BQU0sU0FBUztBQUMxQixvQkFBTSxNQUFNLFdBQVcsUUFBUSxLQUFLO0FBQ3BDLG9CQUFNLE9BQU8sYUFBYSxHQUFHO0FBQzdCLGtCQUFJLE1BQU07QUFDTixzQkFBTSxRQUFRLEtBQUs7QUFDbkIsc0JBQU0sZ0JBQWdCLEtBQUs7QUFDM0Isc0JBQU0sUUFBUSxxQkFBcUIsTUFBTSxZQUFZLGFBQWE7QUFDbEUsNEJBQVksS0FBSyxPQUFPLE9BQU8sT0FBTyxJQUFJO0FBQUEsY0FDOUM7QUFBQSxZQUNKLENBQUM7QUFBQSxVQUNMO0FBQUEsUUFDSjtBQUFBLE1BQ0o7QUFFQSxVQUFJLFNBQVMsV0FBVztBQUNwQixxQkFBYSx1QkFBdUIsTUFBTTtBQUFBLE1BQzlDO0FBRUEsVUFBSSxTQUFTO0FBQ1QscUJBQWEscUJBQXFCLE1BQU0saUJBQWlCO0FBQUEsTUFDN0Q7QUFDQSxXQUFLLFdBQVcsRUFBRSxNQUFNLE9BQU8sWUFBWTtBQUMzQywyQkFBcUIsS0FBSyxRQUFRO0FBQ2xDLFVBQUksU0FBUztBQUdULGFBQUssZ0JBQWdCLHFCQUFxQixLQUFLLFVBQVUsUUFBUTtBQUFBLE1BQ3JFO0FBQUEsSUFDSjtBQUFBLElBQ0EsVUFBVSxTQUFTLEdBQUc7QUFDbEIsVUFBSSxLQUFLLHNCQUFzQjtBQUMzQixVQUFFLElBQUksYUFBYSxLQUFLLG9CQUFvQjtBQUFBLE1BQ2hEO0FBQ0EsVUFBSSxLQUFLLFNBQVUsTUFBSyxTQUFTLE9BQU87QUFDeEMsVUFBSSxLQUFLLGdCQUFnQjtBQUNyQixhQUFLLGVBQWUsT0FBTztBQUMzQixhQUFLLGlCQUFpQjtBQUFBLE1BQzFCO0FBQ0EsVUFBSSxhQUFhLEVBQUUsTUFBTSxTQUFTO0FBQ2xDLFlBQU0sU0FBUyxJQUFJLFFBQVEsWUFBWSxFQUFFLGNBQWMsUUFBUTtBQUMvRCxVQUFJLE9BQVEsUUFBTyxNQUFNLFNBQVM7QUFBQSxJQUN0QztBQUFBLEVBQ0osQ0FBQztBQUVELFFBQU0sV0FBVyxJQUFJLFFBQVE7QUFDN0IsV0FBUyxNQUFNLEdBQUc7QUFDbEIsV0FBUyxZQUFZO0FBQ3JCLFNBQU87QUFDWDs7O0FDbmtCTyxTQUFTLHdCQUF3QixPQUFPLGNBQWM7QUFDekQsTUFBSSxNQUFNLFlBQVksTUFBTyxRQUFPO0FBQ3BDLE1BQUksY0FBYztBQUNsQixhQUFXLFNBQVMsTUFBTSxlQUFlLFVBQVUsTUFBTSxHQUFHLEdBQUc7QUFDM0Qsa0JBQWMsY0FBYyxHQUFHLFdBQVcsSUFBSSxJQUFJLEtBQUs7QUFDdkQsVUFBTSxTQUFTLGFBQWEsV0FBVztBQUN2QyxRQUFJLFVBQVUsT0FBTyxZQUFZLE1BQU8sUUFBTztBQUFBLEVBQ25EO0FBQ0EsU0FBTztBQUNYO0FBT08sU0FBUyxtQkFBbUIsUUFBUSxjQUFjO0FBQ3JELFFBQU0sVUFBVSxFQUFFLGdCQUFnQixDQUFDLEdBQUcsU0FBUyxDQUFDLEdBQUcsVUFBVSxDQUFDLEdBQUcsU0FBUyxDQUFDLEVBQUU7QUFFN0UsV0FBUyxRQUFRLE9BQU8sZUFBZSxZQUFZO0FBQy9DLFFBQUksQ0FBQyxjQUFlO0FBQ3BCLFFBQUksTUFBTSxTQUFTLFdBQVcsTUFBTSxRQUFRO0FBQ3hDLFlBQU0sT0FBTyxRQUFRLFNBQU8sUUFBUSxLQUFLLGVBQWUsSUFBSSxDQUFDO0FBQzdEO0FBQUEsSUFDSjtBQUNBLFFBQUksQ0FBQyxjQUFjLE1BQU0sWUFBWSxNQUFPO0FBRTVDLFVBQU0sU0FBUyxNQUFNLFNBQVMsV0FBVyxZQUFZLE1BQU07QUFDM0QsUUFBSSxRQUFRLE1BQU0sRUFBRyxTQUFRLE1BQU0sRUFBRSxLQUFLLEtBQUs7QUFBQSxFQUNuRDtBQUVBLGFBQVcsU0FBUyxRQUFRO0FBQ3hCLFlBQVEsT0FBTyx3QkFBd0IsT0FBTyxZQUFZLEdBQUcsS0FBSztBQUFBLEVBQ3RFO0FBQ0EsU0FBTztBQUNYO0FBV0EsU0FBUyxnQkFBZ0IsUUFBUSxJQUFJLFFBQVE7QUFDekMsTUFBSSxNQUFNO0FBQ1YsUUFBTSxPQUFPLE9BQU8sSUFBSSxPQUFLO0FBQ3pCLFFBQUksRUFBRSxPQUFPLElBQUk7QUFDYixZQUFNO0FBQ04sYUFBTyxPQUFPLENBQUM7QUFBQSxJQUNuQjtBQUNBLFFBQUksRUFBRSxTQUFTLFdBQVcsTUFBTSxRQUFRLEVBQUUsTUFBTSxHQUFHO0FBQy9DLFlBQU0sT0FBTyxnQkFBZ0IsRUFBRSxRQUFRLElBQUksTUFBTTtBQUNqRCxVQUFJLFNBQVMsRUFBRSxRQUFRO0FBQ25CLGNBQU07QUFDTixlQUFPLEVBQUUsR0FBRyxHQUFHLFFBQVEsS0FBSztBQUFBLE1BQ2hDO0FBQUEsSUFDSjtBQUNBLFdBQU87QUFBQSxFQUNYLENBQUM7QUFDRCxTQUFPLE1BQU0sT0FBTztBQUN4QjtBQU9PLFNBQVMsc0JBQXNCLFFBQVEsY0FBYztBQUN4RCxRQUFNLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxFQUFFO0FBQ3pFLFdBQVMsS0FBSyxPQUFPLGVBQWUsT0FBTztBQUN2QyxRQUFJLE1BQU0sU0FBUyxXQUFXLE1BQU0sUUFBUTtBQUN4QyxZQUFNLFVBQVUsaUJBQWlCLHdCQUF3QixPQUFPLFlBQVk7QUFDNUUsWUFBTSxPQUFPLFFBQVEsU0FBTyxLQUFLLEtBQUssU0FBUyxJQUFJLENBQUM7QUFDcEQ7QUFBQSxJQUNKO0FBQ0EsVUFBTSxTQUFTLE1BQU0sU0FBUyxXQUFXLFlBQVksTUFBTTtBQUMzRCxRQUFJLENBQUMsSUFBSSxNQUFNLEVBQUc7QUFDbEIsVUFBTSxNQUFNLFFBQVEsZ0JBQ2QsaUJBQWlCLHdCQUF3QixPQUFPLFlBQVk7QUFDbEUsUUFBSSxNQUFNLEVBQUUsS0FBSyxFQUFFLE9BQU8sSUFBSSxDQUFDO0FBQUEsRUFDbkM7QUFDQSxhQUFXLFNBQVMsT0FBUSxNQUFLLE9BQU8sTUFBTSxLQUFLO0FBQ25ELFNBQU87QUFDWDtBQUVPLFNBQVMsbUJBQW1CLE9BQU8sS0FBSyxTQUFTO0FBQ3BELE1BQUksU0FBUyxNQUFNLFVBQVUsQ0FBQztBQUM5QixNQUFJLFlBQVksTUFBTSxXQUFXLENBQUM7QUFFbEMsYUFBVyxNQUFNLEtBQUs7QUFDbEIsUUFBSSxHQUFHLE9BQU8sWUFBWTtBQUN0QixlQUFTLEdBQUcsVUFBVSxDQUFDO0FBQ3ZCLGtCQUFZLENBQUM7QUFDYixPQUFDLEdBQUcsY0FBYyxDQUFDLEdBQUcsUUFBUSxDQUFDLElBQUksTUFBTTtBQUNyQyxZQUFJLFdBQVcsUUFBUSxDQUFDLEVBQUcsV0FBVSxFQUFFLElBQUksUUFBUSxDQUFDO0FBQUEsTUFDeEQsQ0FBQztBQUFBLElBQ0wsV0FBVyxHQUFHLE9BQU8sU0FBUyxHQUFHLE9BQU8sV0FBVztBQUMvQyxZQUFNLFdBQVcsR0FBRztBQUNwQixZQUFNLEtBQUssV0FBVyxTQUFTLEtBQUssR0FBRztBQUN2QyxZQUFNLE1BQU0sT0FBTyxVQUFVLE9BQUssRUFBRSxPQUFPLEVBQUU7QUFDN0MsVUFBSSxRQUFRLElBQUk7QUFDWixpQkFBUyxDQUFDLEdBQUcsUUFBUSxRQUFRO0FBQUEsTUFDakMsT0FBTztBQUNILGlCQUFTLE9BQU8sSUFBSSxDQUFDLEdBQUcsTUFBTyxNQUFNLE1BQU0sV0FBVyxDQUFFO0FBQUEsTUFDNUQ7QUFBQSxJQUNKLFdBQVcsR0FBRyxPQUFPLE9BQU87QUFJeEIsZUFBUyxnQkFBZ0IsUUFBUSxHQUFHLElBQUksUUFBTSxFQUFFLEdBQUcsR0FBRyxHQUFJLEdBQUcsVUFBVSxDQUFDLEVBQUcsRUFBRTtBQUFBLElBQ2pGLFdBQVcsR0FBRyxPQUFPLFNBQVM7QUFJMUIsZUFBUyxnQkFBZ0IsUUFBUSxHQUFHLElBQUksUUFBTTtBQUFBLFFBQzFDLEdBQUc7QUFBQSxRQUFHLGlCQUFpQixHQUFHLGFBQWEsQ0FBQztBQUFBLE1BQzVDLEVBQUU7QUFBQSxJQUNOLFdBQVcsR0FBRyxPQUFPLFVBQVU7QUFDM0IsZUFBUyxPQUFPLE9BQU8sT0FBSyxFQUFFLE9BQU8sR0FBRyxFQUFFO0FBQUEsSUFDOUMsV0FBVyxHQUFHLE9BQU8sVUFBVTtBQUMzQixZQUFNLE1BQU0sV0FBVyxRQUFRLEdBQUcsWUFBWTtBQUM5QyxVQUFJLElBQUssYUFBWSxFQUFFLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUk7QUFBQSxJQUN0RCxXQUFXLEdBQUcsT0FBTyxpQkFBaUI7QUFDbEMsa0JBQVksRUFBRSxHQUFHLFVBQVU7QUFDM0IsYUFBTyxVQUFVLEdBQUcsRUFBRTtBQUFBLElBQzFCO0FBQUEsRUFDSjtBQUVBLFNBQU8sRUFBRSxRQUFRLFNBQVMsVUFBVTtBQUN4QztBQUVBLElBQU8sY0FBUTtBQUFBLEVBQ1gsTUFBTSxPQUFPLEVBQUUsT0FBTyxHQUFHLEdBQUc7QUFDeEIsVUFBTSxnQkFBZ0IsUUFBUTtBQUM5QixVQUFNLGVBQWUsUUFBUTtBQUs3QixVQUFNLG1CQUFtQjtBQUN6QixVQUFNLFlBQVksV0FBUztBQUN2QixZQUFNLE9BQU8sTUFBTSxJQUFJLGlCQUFpQixLQUFLLENBQUM7QUFDOUMsWUFBTSxPQUFPLENBQUMsR0FBRyxNQUFNLEtBQUs7QUFDNUIsYUFBTyxLQUFLLFNBQVMsbUJBQW1CLEtBQUssTUFBTSxDQUFDLGdCQUFnQixJQUFJO0FBQUEsSUFDNUU7QUFHQSxhQUFTLGVBQWUsS0FBSyxPQUFPO0FBQ2hDLFVBQUksU0FBUyxLQUFLLFNBQVMsRUFBRSxHQUFHO0FBQzVCLFlBQUk7QUFDQSxnQkFBTSxJQUFJLEtBQUssS0FBSztBQUNwQixnQkFBTSxhQUFhO0FBQUEsUUFDdkIsU0FBUyxHQUFHO0FBQ1IsdUJBQWEsS0FBSyxTQUFTLDJDQUEyQyxDQUFDO0FBQUEsUUFDM0U7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUVBLGFBQVMsa0JBQWtCO0FBQ3ZCLFVBQUksU0FBUyxLQUFLLFNBQVMsRUFBRSxHQUFHO0FBQzVCLFlBQUk7QUFDQSxnQkFBTSxhQUFhO0FBQUEsUUFDdkIsU0FBUyxHQUFHO0FBQ1IsdUJBQWEsS0FBSyxTQUFTLDBDQUEwQyxDQUFDO0FBQUEsUUFDMUU7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUVBLFlBQVEsUUFBUSxZQUFZLE1BQU07QUFDOUIsb0JBQWMsTUFBTSxTQUFTLElBQUk7QUFDakM7QUFBQSxRQUFlO0FBQUEsUUFDWCxVQUFVLG9CQUFvQixLQUFLLElBQUksT0FBSyxPQUFPLENBQUMsQ0FBQyxFQUFFLEtBQUssR0FBRyxDQUFDO0FBQUEsTUFBQztBQUFBLElBQ3pFO0FBRUEsUUFBSSxvQkFBb0I7QUFDeEIsWUFBUSxPQUFPLFlBQVksTUFBTTtBQUM3QixZQUFNLE1BQU0sS0FBSyxJQUFJLE9BQUssT0FBTyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFDN0MsVUFBSSxJQUFJLFNBQVMsc0NBQXNDLEtBQUssSUFBSSxTQUFTLG9CQUFvQixHQUFHO0FBQzVGLFlBQUksQ0FBQyxtQkFBbUI7QUFDcEIsOEJBQW9CO0FBQ3BCLGdCQUFNLE1BQU0sTUFBTSxJQUFJLEtBQUssS0FBSztBQUNoQyxnQkFBTSxXQUFXLHdDQUF3QyxHQUFHO0FBQzVELHVCQUFhLEtBQUssU0FBUyxRQUFRO0FBRW5DLHlCQUFlLG1CQUFtQixVQUFVLFFBQVEsQ0FBQztBQUFBLFFBQ3pEO0FBQ0E7QUFBQSxNQUNKO0FBQ0EsbUJBQWEsTUFBTSxTQUFTLElBQUk7QUFBQSxJQUNwQztBQUVBLFdBQU8sVUFBVSxTQUFTLFNBQVMsUUFBUSxRQUFRLE9BQU8sT0FBTztBQUM3RDtBQUFBLFFBQWU7QUFBQSxRQUNYLFVBQVUsbUJBQW1CLE9BQU8sT0FBTyxNQUFNLElBQUksTUFBTSxJQUFJLEtBQUssRUFBRTtBQUFBLE1BQUM7QUFBQSxJQUMvRTtBQUdBLFlBQVEsZUFBZSxrREFBa0Q7QUFDekUsVUFBTSxPQUFPLGNBQWMsaURBQWlEO0FBQzVFLFVBQU0sT0FBTyxpQkFBaUIsNkRBQTZEO0FBRTNGLFVBQU0sWUFBWSxTQUFTLGNBQWMsS0FBSztBQUM5QyxjQUFVLFlBQVk7QUFDdEIsY0FBVSxNQUFNLFFBQVE7QUFDeEIsY0FBVSxNQUFNLFNBQVM7QUFDekIsY0FBVSxNQUFNLFdBQVc7QUFDM0IsT0FBRyxZQUFZLFNBQVM7QUFFeEIsVUFBTSxVQUFVLE1BQU0sSUFBSSxLQUFLO0FBQy9CLFFBQUksU0FBUyxFQUFFLElBQUk7QUFDbkIsUUFBSSxZQUFZLGFBQWE7QUFDekIsZUFBUyxFQUFFLElBQUk7QUFBQSxJQUNuQjtBQUVBLFVBQU0sTUFBTSxFQUFFLElBQUksV0FBVztBQUFBLE1BQ3pCLEtBQUs7QUFBQSxNQUNMLFFBQVEsTUFBTSxJQUFJLFFBQVE7QUFBQSxNQUMxQixNQUFNLE1BQU0sSUFBSSxNQUFNO0FBQUEsTUFDdEIsaUJBQWlCO0FBQUEsTUFDakIsY0FBYztBQUFBLElBQ2xCLENBQUM7QUFHRCxRQUFJLFdBQVcsY0FBYztBQUM3QixRQUFJLFFBQVEsY0FBYyxFQUFFLE1BQU0sU0FBUztBQUUzQyxRQUFJLFdBQVcsZUFBZTtBQUM5QixRQUFJLFFBQVEsZUFBZSxFQUFFLE1BQU0sU0FBUztBQUU1QyxRQUFJLFdBQVcsWUFBWTtBQUMzQixRQUFJLFFBQVEsWUFBWSxFQUFFLE1BQU0sU0FBUztBQVN6QyxRQUFJLGFBQWEsTUFBTSxJQUFJLFFBQVEsS0FBSyxDQUFDO0FBQ3pDLFFBQUksY0FBYyxFQUFFLEdBQUksTUFBTSxJQUFJLG9CQUFvQixLQUFLLENBQUMsRUFBRztBQUUvRCxhQUFTLGNBQWMsS0FBSyxTQUFTO0FBQ2pDLFlBQU0sT0FBTyxtQkFBbUIsRUFBRSxRQUFRLFlBQVksU0FBUyxZQUFZLEdBQUcsS0FBSyxPQUFPO0FBQzFGLG1CQUFhLEtBQUs7QUFDbEIsb0JBQWMsS0FBSztBQUFBLElBQ3ZCO0FBRUEsVUFBTSxtQkFBbUIsQ0FBQztBQUMxQixVQUFNLHNCQUFzQixDQUFDO0FBQzdCLFVBQU0sV0FBVztBQUFBLE1BQ2IsZ0JBQWdCLEVBQUUsT0FBTyxNQUFNLEtBQUssSUFBSSxNQUFNLEdBQUc7QUFBQSxNQUNqRCxTQUFTLEVBQUUsT0FBTyxNQUFNLEtBQUssSUFBSSxNQUFNLEdBQUc7QUFBQSxNQUMxQyxVQUFVLEVBQUUsT0FBTyxNQUFNLEtBQUssSUFBSSxNQUFNLEdBQUc7QUFBQSxNQUMzQyxTQUFTLEVBQUUsT0FBTyxNQUFNLEtBQUssSUFBSSxNQUFNLEdBQUc7QUFBQSxJQUM5QztBQU1BLFFBQUksWUFBWTtBQUNoQixVQUFNLFNBQVM7QUFBQSxNQUFFLE9BQU8sQ0FBQztBQUFBLE1BQUcsS0FBSztBQUFBLE1BQUksT0FBTztBQUFBLE1BQUcsU0FBUztBQUFBLE1BQU8sTUFBTTtBQUFBLE1BQ3BELE9BQU87QUFBQSxNQUFHLE9BQU87QUFBQSxNQUFNLFdBQVc7QUFBQSxNQUFHLFNBQVM7QUFBQSxNQUM5QyxRQUFRO0FBQUEsTUFBTSxVQUFVO0FBQUEsTUFBTSxRQUFRO0FBQUEsSUFBSztBQUU1RCxhQUFTLGVBQWU7QUFDcEIsVUFBSSxPQUFPLE1BQU8sZUFBYyxPQUFPLEtBQUs7QUFDNUMsYUFBTyxRQUFRO0FBQ2YsYUFBTyxVQUFVO0FBQUEsSUFDckI7QUFFQSxhQUFTLGlCQUFpQixPQUFPO0FBQzdCLFlBQU0sTUFBTSxLQUFLLElBQUk7QUFDckIsVUFBSSxDQUFDLFNBQVMsTUFBTSxPQUFPLFlBQVksSUFBTTtBQUM3QyxhQUFPLFlBQVk7QUFDbkIsVUFBSTtBQUNBLGNBQU0sSUFBSSxnQkFBZ0IsT0FBTyxNQUFNLE9BQU8sS0FBSyxDQUFDO0FBQ3BELGNBQU0sYUFBYTtBQUFBLE1BQ3ZCLFNBQVMsS0FBSztBQUFBLE1BQXdCO0FBQUEsSUFDMUM7QUFFQSxhQUFTLE9BQU8sT0FBTyxFQUFFLFFBQVEsS0FBSyxJQUFJLENBQUMsR0FBRztBQUMxQyxhQUFPLFFBQVEsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLE9BQU8sT0FBTyxNQUFNLFNBQVMsQ0FBQyxDQUFDO0FBQ25FLGtCQUFZO0FBQUEsUUFBRSxNQUFNLE9BQU8sTUFBTSxPQUFPLEtBQUs7QUFBQSxRQUFHLFFBQVEsVUFBVTtBQUFBLFFBQ3BELFFBQVEsT0FBTztBQUFBLE1BQU87QUFDcEMsVUFBSSxNQUFPLGtCQUFpQixDQUFDLE9BQU8sT0FBTztBQUMzQyx3QkFBa0IsSUFBSSxRQUFRLFlBQVk7QUFDMUMsZ0JBQVU7QUFBQSxJQUNkO0FBRUEsYUFBUyxnQkFBZ0I7QUFDckIsbUJBQWE7QUFDYixhQUFPLFVBQVU7QUFDakIsYUFBTyxRQUFRLFlBQVksTUFBTTtBQUM3QixjQUFNLE9BQU8sUUFBUSxPQUFPLE9BQU8sT0FBTyxNQUFNLFFBQVEsT0FBTyxJQUFJO0FBQ25FLFlBQUksQ0FBQyxLQUFLLFNBQVM7QUFDZix1QkFBYTtBQUNiLDRCQUFrQixJQUFJLFFBQVEsWUFBWTtBQUMxQywyQkFBaUIsSUFBSTtBQUNyQjtBQUFBLFFBQ0o7QUFDQSxlQUFPLEtBQUssS0FBSztBQUFBLE1BQ3JCLEdBQUcsTUFBTyxPQUFPLEtBQUs7QUFBQSxJQUMxQjtBQUVBLFVBQU0sZUFBZTtBQUFBLE1BQ2pCLFFBQVEsQ0FBQyxVQUFVLE9BQU8sS0FBSztBQUFBLE1BQy9CLFlBQVksTUFBTSxPQUFPLE9BQU8sUUFBUSxDQUFDO0FBQUEsTUFDekMsZUFBZSxNQUFNLE9BQU8sT0FBTyxRQUFRLENBQUM7QUFBQSxNQUM1QyxjQUFjLE1BQU07QUFDaEIsWUFBSSxPQUFPLFNBQVM7QUFDaEIsdUJBQWE7QUFDYiwyQkFBaUIsSUFBSTtBQUFBLFFBQ3pCLE9BQU87QUFJSCxjQUFJLE9BQU8sU0FBUyxPQUFPLE1BQU0sU0FBUyxFQUFHLFFBQU8sQ0FBQztBQUNyRCx3QkFBYztBQUFBLFFBQ2xCO0FBQ0EsMEJBQWtCLElBQUksUUFBUSxZQUFZO0FBQUEsTUFDOUM7QUFBQSxNQUNBLGNBQWMsTUFBTTtBQUNoQixlQUFPLE9BQU8sQ0FBQyxPQUFPO0FBQ3RCLDBCQUFrQixJQUFJLFFBQVEsWUFBWTtBQUFBLE1BQzlDO0FBQUEsTUFDQSxTQUFTLENBQUMsVUFBVTtBQUNoQixlQUFPLFFBQVE7QUFDZixZQUFJLE9BQU8sUUFBUyxlQUFjO0FBQUEsTUFDdEM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BS0EsY0FBYyxDQUFDLFFBQVE7QUFDbkIsZUFBTyxhQUFhO0FBQ3BCLGVBQU8sU0FBUztBQUNoQixZQUFJLFVBQVcsYUFBWSxFQUFFLEdBQUcsV0FBVyxRQUFRLElBQUk7QUFDdkQsMEJBQWtCLElBQUksUUFBUSxZQUFZO0FBQzFDLGNBQU0sTUFBTSxLQUFLLElBQUk7QUFDckIsWUFBSSxPQUFPLE9BQU8sZ0JBQWdCLE1BQU0sS0FBSztBQUN6QyxpQkFBTyxlQUFlO0FBQ3RCLG9CQUFVO0FBQUEsUUFDZDtBQUFBLE1BQ0o7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUlBLGdCQUFnQixDQUFDLFFBQVE7QUFDckIscUJBQWEsYUFBYSxHQUFHO0FBQzdCLGVBQU8sYUFBYTtBQUNwQixrQkFBVTtBQUNWLGNBQU0sTUFBTSxFQUFFLEdBQUksTUFBTSxJQUFJLGFBQWEsS0FBSyxDQUFDLEVBQUc7QUFDbEQsWUFBSSxJQUFLLEtBQUksU0FBUztBQUFBLFlBQ2pCLFFBQU8sSUFBSTtBQUNoQixZQUFJO0FBQ0EsZ0JBQU0sSUFBSSxlQUFlLEdBQUc7QUFDNUIsZ0JBQU0sYUFBYTtBQUFBLFFBQ3ZCLFNBQVMsS0FBSztBQUFBLFFBQXdEO0FBQUEsTUFDMUU7QUFBQSxJQUNKO0FBS0EsYUFBUyxzQkFBc0I7QUFDM0IsVUFBSSxDQUFDLGNBQWMsVUFBVSxHQUFHO0FBQzVCLFlBQUksV0FBVztBQUNYLHVCQUFhO0FBQ2IsNEJBQWtCLElBQUksRUFBRSxPQUFPLENBQUMsRUFBRSxHQUFHLFlBQVk7QUFDakQsc0JBQVk7QUFDWixpQkFBTyxNQUFNO0FBQ2IsaUJBQU8sVUFBVTtBQUFBLFFBQ3JCO0FBQ0E7QUFBQSxNQUNKO0FBQ0EsWUFBTSxNQUFNLE1BQU0sSUFBSSxhQUFhLEtBQUssQ0FBQztBQUN6QyxZQUFNLFNBQVMsWUFBWSxJQUFJLFVBQVUsS0FBSyxLQUFLLFlBQVksS0FBSztBQUNwRSxZQUFNLFNBQVMsa0JBQWtCLFlBQVksV0FBVztBQUN4RCxVQUFJLENBQUMsT0FBUTtBQUViLFlBQU0sTUFBTSxHQUFHLE9BQU8sR0FBRyxJQUFJLE9BQU8sR0FBRyxJQUFJLElBQUksVUFBVSxLQUFLO0FBQzlELFVBQUksUUFBUSxPQUFPLEtBQUs7QUFDcEIsZUFBTyxNQUFNO0FBQ2IsZUFBTyxRQUFRLGNBQWMsT0FBTyxLQUFLLE9BQU8sS0FBSyxNQUFNO0FBQzNELGVBQU8sUUFBUSxLQUFLLElBQUksT0FBTyxPQUFPLE9BQU8sTUFBTSxTQUFTLENBQUM7QUFBQSxNQUNqRTtBQVdBLFVBQUksQ0FBQyxPQUFPLFlBQVk7QUFDcEIsZUFBTyxTQUFTLElBQUksVUFBVSxZQUFZLElBQUksTUFBTSxJQUFJLElBQUksU0FBUztBQUFBLE1BQ3pFO0FBQ0EsYUFBTyxXQUFXLFdBQVcsTUFBTTtBQUNuQyxhQUFPLFNBQVMsT0FBTyxXQUNqQixVQUFVLE9BQU8sVUFBVSxtQkFBbUIsWUFBWSxPQUFPLE1BQU0sQ0FBQyxJQUN4RTtBQUVOLGtCQUFZLEVBQUUsTUFBTSxPQUFPLE1BQU0sT0FBTyxLQUFLLEdBQUcsUUFBUSxRQUFRLE9BQU8sT0FBTztBQUM5RSxhQUFPLFdBQVcsSUFBSSxZQUFZO0FBRWxDLFVBQUksQ0FBQyxPQUFPLFNBQVM7QUFDakIsZUFBTyxVQUFVO0FBQ2pCLGVBQU8sUUFBUSxJQUFJLFNBQVM7QUFDNUIsZUFBTyxPQUFPLFFBQVEsSUFBSSxJQUFJO0FBSzlCLFlBQUksSUFBSSxhQUFhLENBQUMsT0FBTyxZQUFhLGVBQWM7QUFDeEQsZUFBTyxjQUFjO0FBQUEsTUFDekI7QUFDQSx3QkFBa0IsSUFBSSxRQUFRLFlBQVk7QUFBQSxJQUM5QztBQUdBLFVBQU0sVUFBVSxTQUFTLGNBQWMsS0FBSztBQUM1QyxZQUFRLFlBQVk7QUFDcEIsWUFBUSxNQUFNLFdBQVc7QUFDekIsWUFBUSxNQUFNLE1BQU07QUFDcEIsWUFBUSxNQUFNLFFBQVE7QUFDdEIsWUFBUSxNQUFNLFNBQVM7QUFDdkIsWUFBUSxNQUFNLGFBQWE7QUFDM0IsWUFBUSxNQUFNLFVBQVU7QUFDeEIsWUFBUSxNQUFNLGVBQWU7QUFDN0IsWUFBUSxNQUFNLFlBQVk7QUFDMUIsWUFBUSxNQUFNLFlBQVk7QUFDMUIsWUFBUSxNQUFNLFlBQVk7QUFDMUIsWUFBUSxNQUFNLGFBQWE7QUFDM0IsWUFBUSxNQUFNLFdBQVc7QUFDekIsWUFBUSxNQUFNLFFBQVE7QUFDdEIsY0FBVSxZQUFZLE9BQU87QUFHN0IsVUFBTSxVQUFVLFNBQVMsY0FBYyxLQUFLO0FBQzVDLFlBQVEsTUFBTSxXQUFXO0FBQ3pCLFlBQVEsTUFBTSxTQUFTO0FBQ3ZCLFlBQVEsTUFBTSxRQUFRO0FBQ3RCLFlBQVEsTUFBTSxTQUFTO0FBQ3ZCLFlBQVEsTUFBTSxhQUFhO0FBQzNCLFlBQVEsTUFBTSxVQUFVO0FBQ3hCLFlBQVEsTUFBTSxlQUFlO0FBQzdCLFlBQVEsTUFBTSxZQUFZO0FBQzFCLFlBQVEsTUFBTSxVQUFVO0FBQ3hCLFlBQVEsWUFBWTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFNcEIsY0FBVSxZQUFZLE9BQU87QUFJN0IsYUFBUyxhQUFhLE9BQU87QUFDekIsYUFBTyxFQUFFLFVBQVUsTUFBTSxLQUFLO0FBQUEsUUFDMUIsYUFBYSxNQUFNLGVBQWU7QUFBQSxRQUNsQyxTQUFTLE1BQU0sWUFBWTtBQUFBLFFBQzNCLGVBQWUsTUFBTSxtQkFBbUI7QUFBQSxNQUM1QyxDQUFDO0FBQUEsSUFDTDtBQUVBLG1CQUFlLGVBQWU7QUFDMUIsY0FBUSxLQUFLLGtDQUFrQztBQUMvQywwQkFBb0I7QUFDcEIsWUFBTSxTQUFTO0FBQ2YsWUFBTSxlQUFlLE1BQU0sSUFBSSxlQUFlLEtBQUssQ0FBQztBQUNwRCxZQUFNLG9CQUFvQjtBQUcxQixZQUFNLGVBQWUscUJBQXFCLFFBQVEsWUFBWTtBQUM5RCxVQUFJLGdCQUFnQixTQUFTLEtBQUssU0FBUyxFQUFFLEdBQUc7QUFDNUMsY0FBTSxJQUFJLFVBQVUsQ0FBQyxHQUFHLE1BQU0sQ0FBQztBQUMvQixjQUFNLElBQUksaUJBQWlCLFlBQVk7QUFDdkMsY0FBTSxhQUFhO0FBQUEsTUFDdkI7QUFFQSxjQUFRLE1BQU0sVUFBVSxNQUFNLElBQUksV0FBVyxJQUFJLFVBQVU7QUFHM0QsWUFBTTtBQUFBLFFBQ0YsZ0JBQWdCO0FBQUEsUUFDaEIsU0FBUztBQUFBLFFBQ1QsVUFBVTtBQUFBLFFBQ1YsU0FBUztBQUFBLE1BQ2IsSUFBSSxtQkFBbUIsUUFBUSxZQUFZO0FBRzNDLFlBQU0sZ0JBQWdCLG9CQUFJLElBQUk7QUFBQSxRQUMxQixHQUFHLHdCQUF3QixJQUFJLE9BQUssRUFBRSxFQUFFO0FBQUEsUUFDeEMsR0FBRyxrQkFBa0IsSUFBSSxPQUFLLEVBQUUsRUFBRTtBQUFBLFFBQ2xDLEdBQUcsb0JBQW9CLElBQUksT0FBSyxFQUFFLEVBQUU7QUFBQSxRQUNwQyxHQUFHLG1CQUFtQixJQUFJLE9BQUssRUFBRSxFQUFFO0FBQUEsTUFDdkMsQ0FBQztBQUdELGFBQU8sS0FBSyxtQkFBbUIsRUFBRSxRQUFRLFFBQU07QUFDM0MsWUFBSSxDQUFDLE9BQU8sS0FBSyxPQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssY0FBYyxJQUFJLEVBQUUsR0FBRztBQUN6RCw4QkFBb0IsRUFBRSxFQUFFLE9BQU87QUFDL0IsaUJBQU8sb0JBQW9CLEVBQUU7QUFBQSxRQUNqQztBQUFBLE1BQ0osQ0FBQztBQUdELGlCQUFXLFNBQVMsUUFBUTtBQUN4QixjQUFNLG1CQUFtQix3QkFBd0IsT0FBTyxZQUFZO0FBQ3BFLFlBQUksTUFBTSxTQUFTLFdBQVc7QUFDMUIsY0FBSSxrQkFBa0I7QUFDbEIsZ0JBQUksQ0FBQyxpQkFBaUIsTUFBTSxJQUFJLEdBQUc7QUFDL0Isb0JBQU0sT0FBTyxhQUFhLEtBQUs7QUFDL0IsbUJBQUssTUFBTSxHQUFHO0FBQ2QsK0JBQWlCLE1BQU0sSUFBSSxJQUFJO0FBQUEsWUFDbkM7QUFBQSxVQUNKLE9BQU87QUFDSCxnQkFBSSxpQkFBaUIsTUFBTSxJQUFJLEdBQUc7QUFDOUIsK0JBQWlCLE1BQU0sSUFBSSxFQUFFLE9BQU87QUFDcEMscUJBQU8saUJBQWlCLE1BQU0sSUFBSTtBQUFBLFlBQ3RDO0FBQUEsVUFDSjtBQUNBO0FBQUEsUUFDSjtBQUdBLFlBQUksY0FBYyxJQUFJLE1BQU0sRUFBRSxHQUFHO0FBQzdCO0FBQUEsUUFDSjtBQUVBLFlBQUksQ0FBQyxvQkFBb0IsQ0FBQyxjQUFjLE9BQU8sYUFBYSxTQUFTLEdBQUc7QUFDcEUsY0FBSSxvQkFBb0IsTUFBTSxFQUFFLEdBQUc7QUFDL0IsZ0NBQW9CLE1BQU0sRUFBRSxFQUFFLE9BQU87QUFDckMsbUJBQU8sb0JBQW9CLE1BQU0sRUFBRTtBQUFBLFVBQ3ZDO0FBQ0E7QUFBQSxRQUNKO0FBRUEsWUFBSSxvQkFBb0IsTUFBTSxFQUFFLEdBQUc7QUFDL0IsZ0JBQU0sV0FBVyxvQkFBb0IsTUFBTSxFQUFFO0FBQzdDLGNBQUksU0FBUyxjQUFjLE1BQU0sTUFBTTtBQUNuQyxxQkFBUyxPQUFPO0FBQ2hCLG1CQUFPLG9CQUFvQixNQUFNLEVBQUU7QUFBQSxVQUN2QyxPQUFPO0FBQ0g7QUFBQSxVQUNKO0FBQUEsUUFDSjtBQUVBLGNBQU0sV0FBVyxNQUFNLFlBQVksS0FBSyxPQUFPLGtCQUFrQixNQUFNLEVBQUUsR0FBRyxLQUFLO0FBQ2pGLFlBQUksVUFBVTtBQUNWLDhCQUFvQixNQUFNLEVBQUUsSUFBSTtBQUFBLFFBQ3BDO0FBQUEsTUFDSjtBQUdBLHFCQUFlLFlBQVksTUFBTSxlQUFlLFlBQVksT0FBTztBQUMvRCxjQUFNLFlBQVksY0FBYyxJQUFJLE9BQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssR0FBRztBQVE5RCxjQUFNLGFBQWMsU0FBUyxvQkFBb0IsU0FBUyxjQUNuRCxpQkFBaUIsS0FBTTtBQUM5QixjQUFNLGFBQWEsS0FBSyxVQUFVLGNBQWMsSUFBSSxRQUFNO0FBQUEsVUFDdEQsSUFBSSxFQUFFO0FBQUEsVUFDTixPQUFPLEVBQUU7QUFBQSxVQUNULFFBQVEsRUFBRTtBQUFBLFVBQ1YsUUFBUSxFQUFFO0FBQUEsVUFDVixTQUFTLEVBQUU7QUFBQSxVQUNYLGFBQWEsRUFBRTtBQUFBLFVBQ2YsV0FBVyxFQUFFO0FBQUEsVUFDYixXQUFXLEVBQUU7QUFBQSxVQUNiLGVBQWUsRUFBRTtBQUFBLFVBQ2pCLE1BQU0sRUFBRTtBQUFBLFVBQ1IsS0FBSztBQUFBLFVBQ0wsTUFBTSxFQUFFLFFBQVEsYUFBYSxDQUFDLFlBQVksVUFBVSxPQUFPO0FBQUEsVUFDM0QsS0FBSyxFQUFFLFFBQVEsYUFBYSxDQUFDLFlBQVksVUFBVSxTQUFTO0FBQUEsVUFDNUQsS0FBSyxFQUFFLFFBQVEsYUFBYSxZQUN0QixLQUFLLFVBQVUsVUFBVSxNQUFNLElBQUk7QUFBQSxVQUN6QyxRQUFRLGtCQUFrQixFQUFFLEVBQUUsR0FBRyxjQUFjO0FBQUEsVUFDL0MsUUFBUSxFQUFFLFdBQVcsVUFBVTtBQUFBLFFBQ25DLEVBQUUsQ0FBQztBQUVILGNBQU0sUUFBUSxTQUFTLElBQUk7QUFDM0IsY0FBTSxlQUFlLE1BQU0sUUFBUSxhQUFhLE1BQU0sU0FBUztBQUUvRCxZQUFJLGNBQWM7QUFDZCxjQUFJLE1BQU0sT0FBTztBQUNiLGtCQUFNLE1BQU0sT0FBTztBQUFBLFVBQ3ZCO0FBQ0EsY0FBSSxjQUFjLFNBQVMsR0FBRztBQUMxQixrQkFBTSxRQUFRLE1BQU0sb0JBQW9CLEtBQUssTUFBTSxlQUFlLG1CQUFtQixPQUFPLFdBQVcsU0FBUztBQUNoSCxnQkFBSSxNQUFNLE9BQU87QUFDYixvQkFBTSxNQUFNLE1BQU0sR0FBRztBQUFBLFlBQ3pCO0FBQUEsVUFDSixPQUFPO0FBQ0gsa0JBQU0sUUFBUTtBQUFBLFVBQ2xCO0FBQ0EsZ0JBQU0sTUFBTTtBQUNaLGdCQUFNLE9BQU87QUFBQSxRQUNqQjtBQUFBLE1BQ0o7QUFNQSxZQUFNLFlBQVksc0JBQXNCLFFBQVEsWUFBWTtBQUM1RCxZQUFNLFNBQVM7QUFBQSxRQUFFLGdCQUFnQjtBQUFBLFFBQ2hCLFNBQVM7QUFBQSxRQUNULFVBQVU7QUFBQSxRQUNWLFNBQVM7QUFBQSxNQUFtQjtBQUM3QyxZQUFNLGtCQUFrQixFQUFFLFVBQVUsT0FBTyxTQUFTLE1BQU07QUFDMUQsaUJBQVcsUUFBUSxDQUFDLGtCQUFrQixXQUFXLFlBQVksU0FBUyxHQUFHO0FBQ3JFLGNBQU0sVUFBVSxVQUFVLElBQUk7QUFDOUIsY0FBTSxXQUFXLFNBQVMsb0JBQW9CLFNBQVM7QUFDdkQsY0FBTSxZQUFZLFdBQVcsaUJBQWlCLElBQUksbUJBQW1CO0FBQ3JFLGNBQU0sU0FBUyxhQUFhLFFBQVEsU0FBUyxLQUN0QyxRQUFRLFVBQVUsZUFDbEIsUUFBUSxLQUFLLE9BQUssRUFBRSxNQUFNLElBQUk7QUFDckMsaUJBQVMsSUFBSSxFQUFFLFlBQVksU0FBUyxRQUFRLElBQUksT0FBTSxFQUFFLE1BQU0sSUFBSSxDQUFFLElBQUk7QUFDeEUsWUFBSSxPQUFRLFFBQU8sSUFBSSxJQUFJLFFBQVEsSUFBSSxPQUFLLEVBQUUsS0FBSztBQUNuRCxZQUFJLENBQUMsU0FBVSxpQkFBZ0IsSUFBSSxJQUFJO0FBQUEsTUFDM0M7QUFFQSxZQUFNLFlBQVksa0JBQWtCLE9BQU8sY0FBYztBQUN6RCxZQUFNLFlBQVksV0FBVyxPQUFPLE9BQU87QUFDM0MsWUFBTSxZQUFZLFlBQVksT0FBTyxVQUFVLGdCQUFnQixRQUFRO0FBQ3ZFLFlBQU0sWUFBWSxXQUFXLE9BQU8sU0FBUyxnQkFBZ0IsT0FBTztBQUlwRSxpQkFBVyxRQUFRLENBQUMsa0JBQWtCLFdBQVcsWUFBWSxTQUFTLEdBQUc7QUFDckUsY0FBTSxRQUFRLFNBQVMsSUFBSTtBQUMzQixjQUFNLFNBQVMsTUFBTSxTQUFTLE1BQU0sTUFBTTtBQUMxQyxZQUFJLENBQUMsT0FBUTtBQUdiLGNBQU0sTUFBTSxNQUFNO0FBQ2xCLFlBQUksS0FBSztBQUNMLGdCQUFNLE1BQU0sSUFBSSxLQUFLLEVBQUU7QUFDdkIsY0FBSSxNQUFNLFdBQVcsS0FBSztBQUN0QixrQkFBTSxTQUFTO0FBQ2YsbUJBQU8sbUJBQW1CLEdBQUc7QUFBQSxVQUNqQztBQUFBLFFBQ0o7QUFDQSxZQUFJLFdBQVc7QUFDWCxnQkFBTSxhQUFhLFVBQVUsU0FDdkIsV0FBVyxZQUFZLFVBQVUsTUFBTSxDQUFDLElBQUk7QUFDbEQsaUJBQU8sVUFBVSxVQUFVLE1BQU0sVUFBVTtBQUFBLFFBQy9DLE9BQU87QUFDSCxpQkFBTyxVQUFVLE1BQU0sSUFBSTtBQUFBLFFBQy9CO0FBQUEsTUFDSjtBQUVBLDRCQUFzQixTQUFTLFFBQVEsT0FBTyxLQUFLLE1BQU07QUFDckQsb0JBQVk7QUFBQSxNQUNoQixDQUFDO0FBQ0QsY0FBUSxRQUFRLGtDQUFrQztBQUFBLElBQ3REO0FBRUEsUUFBSSwwQkFBMEI7QUFDOUIsUUFBSSx3QkFBd0I7QUFHNUIsUUFBSSxHQUFHLFdBQVcsTUFBTTtBQUNwQixVQUFJO0FBQ0EsY0FBTSxTQUFTLElBQUksVUFBVTtBQUM3QixjQUFNLGNBQWMsSUFBSSxRQUFRO0FBRWhDLGNBQU0sY0FBYyxNQUFNLElBQUksUUFBUTtBQUN0QyxjQUFNLFlBQVksTUFBTSxJQUFJLE1BQU07QUFFbEMsY0FBTSxjQUFjLGNBQWM7QUFDbEMsY0FBTSxnQkFBZ0IsQ0FBQyxlQUNuQixDQUFDLE1BQU0sUUFBUSxXQUFXLEtBQzFCLFlBQVksU0FBUyxLQUNyQixLQUFLLElBQUksWUFBWSxDQUFDLElBQUksT0FBTyxHQUFHLElBQUksUUFDeEMsS0FBSyxJQUFJLFlBQVksQ0FBQyxJQUFJLE9BQU8sR0FBRyxJQUFJO0FBRTVDLFlBQUksZUFBZTtBQUNmLG9DQUEwQjtBQUMxQixnQkFBTSxJQUFJLFVBQVUsQ0FBQyxPQUFPLEtBQUssT0FBTyxHQUFHLENBQUM7QUFBQSxRQUNoRDtBQUNBLFlBQUksYUFBYTtBQUNiLGtDQUF3QjtBQUN4QixnQkFBTSxJQUFJLFFBQVEsV0FBVztBQUFBLFFBQ2pDO0FBQ0EsWUFBSSxpQkFBaUIsYUFBYTtBQUM5QiwwQkFBZ0I7QUFBQSxRQUNwQjtBQUFBLE1BQ0osU0FBUyxLQUFLO0FBQ1YsZ0JBQVEsTUFBTSw2QkFBNkIsR0FBRztBQUFBLE1BQ2xEO0FBQUEsSUFDSixDQUFDO0FBRUQsYUFBUyxnQkFBZ0I7QUFDckIsWUFBTSxTQUFTLE1BQU0sSUFBSSxRQUFRO0FBQ2pDLFlBQU0sT0FBTyxNQUFNLElBQUksTUFBTTtBQUM3QixVQUFJLFVBQVUsTUFBTSxRQUFRLE1BQU0sS0FBSyxPQUFPLFVBQVUsR0FBRztBQUN2RCxjQUFNLFlBQVksSUFBSSxVQUFVO0FBQ2hDLGNBQU0sVUFBVSxJQUFJLFFBQVE7QUFDNUIsY0FBTSxnQkFBZ0IsS0FBSyxJQUFJLFVBQVUsTUFBTSxPQUFPLENBQUMsQ0FBQyxJQUFJLFFBQ3RDLEtBQUssSUFBSSxVQUFVLE1BQU0sT0FBTyxDQUFDLENBQUMsSUFBSTtBQUM1RCxjQUFNLGNBQWMsWUFBWTtBQUVoQyxZQUFJLGlCQUFpQixhQUFhO0FBQzlCLGNBQUksUUFBUSxRQUFRLE9BQU8sU0FBUyxXQUFXLE9BQU8sT0FBTztBQUFBLFFBQ2pFO0FBQUEsTUFDSixPQUFPO0FBQ0gsY0FBTUMsUUFBTyxNQUFNLElBQUksTUFBTTtBQUM3QixZQUFJLE9BQU9BLFVBQVMsWUFBWSxJQUFJLFFBQVEsTUFBTUEsT0FBTTtBQUNwRCxjQUFJLFFBQVFBLEtBQUk7QUFBQSxRQUNwQjtBQUFBLE1BQ0o7QUFBQSxJQUNKO0FBR0EsVUFBTSxHQUFHLGlCQUFpQixNQUFNO0FBQzVCLFVBQUkseUJBQXlCO0FBQ3pCLGtDQUEwQjtBQUMxQjtBQUFBLE1BQ0o7QUFDQSxvQkFBYztBQUFBLElBQ2xCLENBQUM7QUFDRCxVQUFNLEdBQUcsZUFBZSxNQUFNO0FBQzFCLFVBQUksdUJBQXVCO0FBQ3ZCLGdDQUF3QjtBQUN4QjtBQUFBLE1BQ0o7QUFDQSxvQkFBYztBQUFBLElBQ2xCLENBQUM7QUFJRCxVQUFNLEdBQUcsNkJBQTZCLE1BQU07QUFDeEMsWUFBTSxNQUFNLE1BQU0sSUFBSSxvQkFBb0IsS0FBSyxDQUFDO0FBQ2hELFlBQU0sU0FBUyxJQUFJO0FBQ25CLFVBQUksQ0FBQyxVQUFVLE9BQU8sV0FBVyxFQUFHO0FBRXBDLFlBQU0sVUFBVSxDQUFDO0FBQ2pCLFVBQUksSUFBSSxXQUFXLEtBQU0sU0FBUSxVQUFVLENBQUMsSUFBSSxTQUFTLElBQUksT0FBTztBQUNwRSxVQUFJLElBQUksWUFBWSxLQUFNLFNBQVEsVUFBVSxJQUFJO0FBQ2hELFVBQUksVUFBVSxRQUFRLE9BQU87QUFHN0IsVUFBSSxJQUFJLGFBQWE7QUFDakIsWUFBSSxRQUFRLElBQUksUUFBUSxJQUFJLElBQUksV0FBVztBQUFBLE1BQy9DO0FBQUEsSUFDSixDQUFDO0FBRUQsUUFBSSxjQUFjO0FBQ2xCLFFBQUksWUFBWTtBQUNoQixRQUFJLFlBQVk7QUFFaEIsbUJBQWUsY0FBYztBQUN6QixVQUFJLFdBQVc7QUFDWCxvQkFBWTtBQUNaO0FBQUEsTUFDSjtBQUNBLGtCQUFZO0FBQ1osVUFBSTtBQUNBLGNBQU0sYUFBYTtBQUFBLE1BQ3ZCLFNBQVMsS0FBSztBQUNWLGdCQUFRLE1BQU0sMEJBQTBCLEdBQUc7QUFBQSxNQUMvQyxVQUFFO0FBQ0Usb0JBQVk7QUFDWixZQUFJLFdBQVc7QUFDWCxzQkFBWTtBQUNaLHNCQUFZO0FBQUEsUUFDaEI7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUVBLGFBQVMsWUFBWTtBQUNqQixVQUFJLENBQUMsTUFBTSxJQUFJLFdBQVcsR0FBRztBQUN6QjtBQUFBLE1BQ0o7QUFDQSxVQUFJLGFBQWE7QUFDYixxQkFBYSxXQUFXO0FBQUEsTUFDNUI7QUFDQSxvQkFBYyxXQUFXLE1BQU07QUFDM0Isc0JBQWM7QUFDZCxvQkFBWTtBQUFBLE1BQ2hCLEdBQUcsRUFBRTtBQUFBLElBQ1Q7QUFHQSxVQUFNLEdBQUcsdUJBQXVCLE1BQU07QUFDbEMsa0JBQVk7QUFBQSxJQUNoQixDQUFDO0FBSUQsVUFBTSxHQUFHLGNBQWMsQ0FBQyxLQUFLLFlBQVk7QUFDckMsVUFBSSxDQUFDLE9BQU8sSUFBSSxTQUFTLGlCQUFrQjtBQUMzQyxvQkFBYyxJQUFJLE9BQU8sQ0FBQyxHQUFHLE9BQU87QUFDcEMsZ0JBQVU7QUFBQSxJQUNkLENBQUM7QUFJRCxVQUFNLEdBQUcsaUJBQWlCLE1BQU07QUFDNUIsbUJBQWEsTUFBTSxJQUFJLFFBQVEsS0FBSyxDQUFDO0FBQ3JDLGdCQUFVO0FBQUEsSUFDZCxDQUFDO0FBQ0QsVUFBTSxHQUFHLDZCQUE2QixNQUFNO0FBQ3hDLG9CQUFjLEVBQUUsR0FBSSxNQUFNLElBQUksb0JBQW9CLEtBQUssQ0FBQyxFQUFHO0FBQzNELGdCQUFVO0FBQUEsSUFDZCxDQUFDO0FBQ0QsVUFBTSxHQUFHLHdCQUF3QixTQUFTO0FBQzFDLFVBQU0sR0FBRyxzQkFBc0IsTUFBTTtBQUNqQyxhQUFPLFVBQVU7QUFDakIsZ0JBQVU7QUFBQSxJQUNkLENBQUM7QUFHRCxVQUFNLEdBQUcsdUJBQXVCLE1BQU07QUFDbEMsWUFBTSxTQUFTLE1BQU0sSUFBSSxjQUFjO0FBQ3ZDLFVBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxNQUFNLE9BQVE7QUFDeEMsVUFBSSxLQUFLLElBQUksU0FBUyxPQUFPLE1BQU0sT0FBTyxLQUFLLENBQUMsSUFBSSxFQUFHO0FBQ3ZELFVBQUksTUFBTSxPQUFPLE1BQU0sVUFBVSxPQUFLLEtBQUssTUFBTTtBQUNqRCxVQUFJLFFBQVEsR0FBSSxPQUFNLE9BQU8sTUFBTSxTQUFTO0FBQzVDLGFBQU8sS0FBSyxFQUFFLE9BQU8sTUFBTSxDQUFDO0FBQUEsSUFDaEMsQ0FBQztBQUNELFVBQU0sR0FBRyxvQkFBb0IsU0FBUztBQUt0QyxRQUFJO0FBQ0EsWUFBTSxLQUFLLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUFBLElBQ3pDLFNBQVMsS0FBSztBQUFBLElBQW1FO0FBR2pGLFFBQUksTUFBTSxJQUFJLFdBQVcsS0FBSyxNQUFNLElBQUksY0FBYyxJQUFJLEdBQUc7QUFDekQsa0JBQVk7QUFBQSxJQUNoQjtBQUFBLEVBQ0o7QUFDSjsiLAogICJuYW1lcyI6IFsiZ2xMYXllciIsICJpbnN0YW5jZSIsICJ6b29tIl0KfQo=
