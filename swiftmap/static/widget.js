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
    const win = timeState && layer.time ? windowFor(timeState.tick, effectiveDuration(layer, timeState), timeState.period) : null;
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
          win: l.time && timeState ? timeState.window : null,
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
  collectWebglLayers,
  map_default as default,
  isLayerEffectiveVisible
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9tYXAuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBmdW5jdGlvbiBsb2FkQ1NTKGlkLCB1cmwpIHtcbiAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICBjb25zdCBsaW5rID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImxpbmtcIik7XG4gICAgICAgIGxpbmsuaWQgPSBpZDtcbiAgICAgICAgbGluay5yZWwgPSBcInN0eWxlc2hlZXRcIjtcbiAgICAgICAgbGluay5ocmVmID0gdXJsO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKGxpbmspO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlTG9hZGVycyA9IHt9O1xuXG5leHBvcnQgZnVuY3Rpb24gbG9hZEpTKGlkLCB1cmwpIHtcbiAgICBpZiAoYWN0aXZlTG9hZGVyc1tpZF0pIHtcbiAgICAgICAgcmV0dXJuIGFjdGl2ZUxvYWRlcnNbaWRdO1xuICAgIH1cbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNjcmlwdFwiKTtcbiAgICAgICAgc2NyaXB0LmlkID0gaWQ7XG4gICAgICAgIHNjcmlwdC5zcmMgPSB1cmw7XG4gICAgICAgIHNjcmlwdC5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgICAgIHNjcmlwdC5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgc2NyaXB0OiAke3VybH1gKSk7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc2NyaXB0KTtcbiAgICB9KTtcbiAgICBhY3RpdmVMb2FkZXJzW2lkXSA9IHByb21pc2U7XG4gICAgcmV0dXJuIHByb21pc2U7XG59XG5cbmZ1bmN0aW9uIGhleFRvUmdiKGhleCkge1xuICAgIGlmICghaGV4KSByZXR1cm4gbnVsbDtcbiAgICBoZXggPSBoZXgucmVwbGFjZSgvXiMvLCAnJyk7XG4gICAgaWYgKGhleC5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgaGV4ID0gaGV4LnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyICsgY2hhcikuam9pbignJyk7XG4gICAgfVxuICAgIGlmIChoZXgubGVuZ3RoICE9PSA2KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBudW0gPSBwYXJzZUludChoZXgsIDE2KTtcbiAgICByZXR1cm4ge1xuICAgICAgICByOiAoKG51bSA+PiAxNikgJiAyNTUpIC8gMjU1LFxuICAgICAgICBnOiAoKG51bSA+PiA4KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGI6IChudW0gJiAyNTUpIC8gMjU1XG4gICAgfTtcbn1cblxubGV0IGNvbG9yUHJvYmUgPSBudWxsO1xuXG4vLyBCcm93c2VycyBzaGlwIGEgY29tcGxldGUgQ1NTIGNvbG9yIHBhcnNlciAtLSBldmVyeSBuYW1lZCBjb2xvciwgcmdiKCksIGhzbCgpLCBod2IoKS5cbi8vIEJvcnJvdyBpdCBpbnN0ZWFkIG9mIG1haW50YWluaW5nIGEgbG9va3VwIHRhYmxlLiBSZXR1cm5zIG51bGwgb3V0c2lkZSBhIERPTSAoTm9kZSB0ZXN0cyksXG4vLyB3aGVyZSB0aGUgaGV4IGZhbGxiYWNrIGluIHBhcnNlQ29sb3Igc3RpbGwgYXBwbGllcy5cbmZ1bmN0aW9uIGNzc0NvbG9yVG9SZ2IodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIGRvY3VtZW50ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIWNvbG9yUHJvYmUpIGNvbG9yUHJvYmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpLmdldENvbnRleHQoXCIyZFwiKTtcblxuICAgIC8vIEFzc2lnbmluZyBhbiBpbnZhbGlkIGNvbG9yIGxlYXZlcyBmaWxsU3R5bGUgdW50b3VjaGVkLCBzbyBwcm9iZSBhZ2FpbnN0IHR3byBkaWZmZXJlbnRcbiAgICAvLyBzZW50aW5lbHM6IG9ubHkgYSB2YWx1ZSB0aGUgYnJvd3NlciBhY3R1YWxseSBwYXJzZWQgcHJvZHVjZXMgdGhlIHNhbWUgcmVzdWx0IHR3aWNlLlxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjMDAwMDAwXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBjb25zdCBmaXJzdCA9IGNvbG9yUHJvYmUuZmlsbFN0eWxlO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjZmZmZmZmXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBpZiAoZmlyc3QgIT09IGNvbG9yUHJvYmUuZmlsbFN0eWxlKSByZXR1cm4gbnVsbDtcblxuICAgIGlmIChmaXJzdC5zdGFydHNXaXRoKFwiI1wiKSkgcmV0dXJuIGhleFRvUmdiKGZpcnN0KTtcbiAgICBjb25zdCBtYXRjaCA9IGZpcnN0Lm1hdGNoKC9yZ2JhP1xcKChbXildKylcXCkvKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXJ0cyA9IG1hdGNoWzFdLnNwbGl0KFwiLFwiKS5tYXAocCA9PiBwYXJzZUZsb2F0KHAudHJpbSgpKSk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMgfHwgcGFydHMuc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyByOiBwYXJ0c1swXSAvIDI1NSwgZzogcGFydHNbMV0gLyAyNTUsIGI6IHBhcnRzWzJdIC8gMjU1IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbG9yKGNvbG9yU3RyLCBmYWxsYmFja0hleCA9IFwiIzMzODhmZlwiKSB7XG4gICAgaWYgKCFjb2xvclN0cikgY29sb3JTdHIgPSBmYWxsYmFja0hleDtcbiAgICByZXR1cm4gY3NzQ29sb3JUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgaGV4VG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGNzc0NvbG9yVG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IGhleFRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcbn1cblxuY29uc3QgVVJMX0FUVFJfQkVGT1JFID0gLyg/OmhyZWZ8c3JjKVxccyo9XFxzKlsnXCJdPyQvaTtcbmNvbnN0IFNBRkVfVVJMID0gL14oPzpodHRwcz86XFwvXFwvfG1haWx0bzp8dGVsOnxkYXRhOmltYWdlXFwvfFsuLyM/XXxbXFx3Li1dKyg/OlsvPyNdfCQpKS9pO1xuXG4vLyBQcm9wZXJ0eSB2YWx1ZXMgY29tZSBmcm9tIHVzZXIgZGF0YSBhbmQgZW5kIHVwIGluIGlubmVySFRNTCwgc28gdGhleSBhcmUgZXNjYXBlZC5cbi8vIE1hcmt1cCB0aGUgYXBwIGF1dGhvciB3cm90ZSAodGVtcGxhdGVzLCBzdHlsZSBzdHJpbmdzKSBpcyBsZWZ0IGludGFjdC5cbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVIdG1sKHZhbHVlKSB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSlcbiAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxuICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXG4gICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxuICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMzk7XCIpO1xufVxuXG4vLyBFc2NhcGluZyBzdG9wcyBhdHRyaWJ1dGUgYnJlYWtvdXQgYnV0IG5vdCBcImphdmFzY3JpcHQ6XCIgaW4gYW4gaHJlZiwgc28gdmFsdWVzIGxhbmRpbmdcbi8vIGluIGEgVVJMIGF0dHJpYnV0ZSBnZXQgYSBzY2hlbWUgY2hlY2suIENvbnRyb2wgY2hhcmFjdGVycyBhcmUgc3RyaXBwZWQgZmlyc3QgYmVjYXVzZVxuLy8gXCJqYXZhXFx0c2NyaXB0OlwiIHN1cnZpdmVzIGEgbmFpdmUgY29tcGFyaXNvbi5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlKSB7XG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcbiAgICByZXR1cm4gU0FGRV9VUkwudGVzdChjb2xsYXBzZWQpID8gU3RyaW5nKHZhbHVlKSA6IFwiXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIGNvbnN0IHRhcmdldEZpZWxkcyA9IChBcnJheS5pc0FycmF5KGZpZWxkcykgJiYgZmllbGRzLmxlbmd0aCkgPyBmaWVsZHMgOiBPYmplY3Qua2V5cyhwcm9wcyk7XG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcbiAgICBjb25zdCBsaW5lcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGFyZ2V0RmllbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XG4gICAgICAgIGlmIChwcm9wc1tmXSA9PT0gdW5kZWZpbmVkIHx8IHByb3BzW2ZdID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgbGluZXMucHVzaChgPGI+JHtlc2NhcGVIdG1sKGxhYmVsc1tpXSl9PC9iPjogJHtlc2NhcGVIdG1sKHByb3BzW2ZdKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oXCI8YnI+XCIpO1xufVxuXG4vLyBcIntjb2x1bW59XCIgaW5zZXJ0cyBvbmUgZXNjYXBlZCB2YWx1ZTsgXCJ7Kn1cIiBpbnNlcnRzIHRoZSBkZWZhdWx0IGZpZWxkIGxpc3QuXG5mdW5jdGlvbiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiKlwiKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BzW2tleV07XG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHJldHVybiBcIlwiO1xuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XG4gICAgICAgIHJldHVybiBlc2NhcGVIdG1sKFVSTF9BVFRSX0JFRk9SRS50ZXN0KHByZWNlZGluZykgPyBzYWZlVXJsKHZhbCkgOiB2YWwpO1xuICAgIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIGtpbmQpIHtcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGxheWVyW2tpbmQgKyBcIl90ZW1wbGF0ZVwiXTtcbiAgICBjb25zdCBmaWVsZHMgPSBsYXllcltraW5kICsgXCJfZmllbGRzXCJdO1xuICAgIGNvbnN0IG5hbWVzID0gbGF5ZXJba2luZCArIFwiX25hbWVzXCJdO1xuICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgPT09IFwic3RyaW5nXCIgJiYgdGVtcGxhdGUpIHtcbiAgICAgICAgcmV0dXJuIHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBwcm9wcywgZmllbGRzLCBuYW1lcyk7XG4gICAgfVxuICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XG59XG5cbmZ1bmN0aW9uIHdyYXBTdHlsZWQoaHRtbCwgc3R5bGUpIHtcbiAgICBpZiAoIXN0eWxlKSByZXR1cm4gaHRtbDtcbiAgICByZXR1cm4gYDxkaXYgc3R5bGU9XCIke2VzY2FwZUh0bWwoc3R5bGUpfVwiPiR7aHRtbH08L2Rpdj5gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFBvcHVwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwicG9wdXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3BvcHVwIHx8IGxheWVyLnBvcHVwX2ZpZWxkcyB8fCBsYXllci5wb3B1cF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICBpZiAobGF5ZXIucG9wdXBfbWF4X3dpZHRoKSBvcHRpb25zLm1heFdpZHRoID0gbGF5ZXIucG9wdXBfbWF4X3dpZHRoO1xuICAgICAgICBMLnBvcHVwKG9wdGlvbnMpXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIucG9wdXBfc3R5bGUpKVxuICAgICAgICAgICAgLm9wZW5PbihtYXApO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRUb29sdGlwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIsIGxheWVySW5zdGFuY2UpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwidG9vbHRpcFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfdG9vbHRpcCB8fCBsYXllci50b29sdGlwX2ZpZWxkcyB8fCBsYXllci50b29sdGlwX3RlbXBsYXRlKSkge1xuICAgICAgICBpZiAoIWxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXAgPSBMLnRvb2x0aXAoeyBkaXJlY3Rpb246ICd0b3AnLCBvZmZzZXQ6IFswLCAtNV0gfSk7XG4gICAgICAgIH1cbiAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcFxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnRvb2x0aXBfc3R5bGUpKVxuICAgICAgICAgICAgLmFkZFRvKG1hcCk7XG4gICAgfVxufVxuIiwgImNvbnN0IGNvbGxhcHNlZFBhdGhzID0ge307ICAvLyBwYXRoIC0+IGNvbGxhcHNlZD9cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllckJvdW5kcyhsLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKCFsKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAvLyBTdXBwb3J0IGZvbGRlciB0cmVlIG5vZGVzIChncm91cHMgaW4gc2lkZWJhciB0cmVlKVxyXG4gICAgaWYgKGwuaXNHcm91cCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkcmVuIGdyb3Vwc1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGwuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGwuY2hpbGRyZW5ba2V5XSwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZCBsYXllcnNcclxuICAgICAgICBsLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhseXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGwuYm91bmRzICYmIGwuYm91bmRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICByZXR1cm4gbC5ib3VuZHM7XHJcbiAgICB9XHJcbiAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgbC5sYXllcnMpIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsLmxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMoc3ViLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChsLmxvY2F0aW9ucyAmJiBsLmxvY2F0aW9ucy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgY29uc3QgY29vcmRzID0gbC5sb2NhdGlvbnMuZmxhdChJbmZpbml0eSk7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2ldO1xyXG4gICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSArIDFdO1xyXG4gICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF07XHJcbiAgICAgICAgaWYgKGJ1Zikge1xyXG4gICAgICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KGJ1Zi5idWZmZXIsIGJ1Zi5ieXRlT2Zmc2V0LCBidWYuYnl0ZUxlbmd0aCAvIDgpO1xyXG4gICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aCAvIDI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2kgKiAyXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgbW9kZWxOZWVkc1VwZGF0ZSA9IGZhbHNlO1xyXG4gICAgZnVuY3Rpb24gZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZiA9IGdyb3VwQ29uZmlnc1tub2RlLnBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNSYWRpb0dyb3VwID0gY29uZi5tdWx0aV9zZWxlY3QgPT09IGZhbHNlO1xyXG4gICAgICAgIGlmIChpc1JhZGlvR3JvdXApIHtcclxuICAgICAgICAgICAgbGV0IGZvdW5kQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkR3JvdXAgPSBub2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBseXIudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZS5jaGlsZHJlbltrZXldKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXModHJlZSk7XHJcbiAgICByZXR1cm4gbW9kZWxOZWVkc1VwZGF0ZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYWdhaW5zdCB0aGUgbGlzdCB0aGlzIHNpZGViYXIgcmVuZGVyZWQgZnJvbSwgbmV2ZXIgbW9kZWwuZ2V0KFwibGF5ZXJzXCIpLlxyXG4gICAgICAgICAgICAgICAgLy8gTGF5ZXJzIGFkZGVkIGFmdGVyIHRoZSB3aWRnZXQgaXMgZGlzcGxheWVkIGFycml2ZSBhcyBwYXRjaGVzIHRoYXQgdXBkYXRlIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gZnJvbnRlbmQncyBsb2NhbCBzdGF0ZSB3aXRob3V0IHRvdWNoaW5nIHRoZSB0cmFpdCwgc28gdGhlIG1vZGVsJ3MgY29weSBpc1xyXG4gICAgICAgICAgICAgICAgLy8gZnJvemVuIGF0IHdoYXRldmVyIHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgY2FycmllZC4gQnVpbGRpbmcgdGhlIHVwZGF0ZSBmcm9tXHJcbiAgICAgICAgICAgICAgICAvLyBpdCBkcm9wcyBldmVyeSBsYXRlciBsYXllcjogdGhlIHRvZ2dsZSBtYXRjaGVzIG5vIGlkLCB3cml0ZXMgdGhlIHN0YWxlIGxpc3RcclxuICAgICAgICAgICAgICAgIC8vIGJhY2ssIGFuZCB0aGUgY2hhbmdlIGhhbmRsZXIgdGhlbiByZXNldHMgbG9jYWwgc3RhdGUgdG8gaXQgLS0gc28gdGhlIGJveFxyXG4gICAgICAgICAgICAgICAgLy8gcmUtY2hlY2tzIGl0c2VsZiBhbmQgdGhlIGxheWVyIG5ldmVyIGhpZGVzLlxyXG4gICAgICAgICAgICAgICAgbGV0IHVwZGF0ZWRMYXllcnMgPSBbLi4ubGF5ZXJzXTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSYWRpbyBidXR0b24gbG9naWM6IHNldCBhbGwgc2libGluZ3MgdG8gdmlzaWJsZT1mYWxzZSwgYW5kIHRoaXMgdG8gdmlzaWJsZT10cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMocGFyZW50Tm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJHcm91cCA9IHBhcmVudE5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gc2liR3JvdXAucGF0aCA9PT0gcGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmUgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3NpYkdyb3VwLnBhdGhdID0gIWFjdGl2ZTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBwYXJlbnROb2RlLmxheWVycy5mb3JFYWNoKHNpYkx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkx5ci5pZCA9PT0gaWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRMYXllcnMgPSB1cGRhdGVkTGF5ZXJzLm1hcChvcmlnTGF5ZXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9yaWdMYXllci5pZCA9PT0gc2liTHlyLmlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5vcmlnTGF5ZXIsIHZpc2libGU6IGFjdGl2ZSB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9yaWdMYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1twYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBpc0NoZWNrZWQgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVkTGF5ZXJzID0gdXBkYXRlZExheWVycy5tYXAob3JpZ0xheWVyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcmlnTGF5ZXIuaWQgPT09IGlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4ub3JpZ0xheWVyLCB2aXNpYmxlOiBpc0NoZWNrZWQgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBvcmlnTGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJsYXllcnNcIiwgdXBkYXRlZExheWVycyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldExheWVyQm91bmRzKG5vZGUsIG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb25MYXllclRvZ2dsZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcmVudEVsLmFwcGVuZENoaWxkKG5vZGVEaXYpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbmRlciB0cmVlIGZyb20gcm9vdCBub2RlXHJcbiAgICByZW5kZXJOb2RlKHRyZWUsIHNpZGViYXIsIDAsIG51bGwsIHRydWUpO1xyXG59XHJcbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIC8vIFRoZSBmaXJzdCB0aWNrIHNpdHMgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBub3Qgb25lIHBlcmlvZCBhZnRlciBpdDogd2luZG93c1xuICAgIC8vIGFyZSBoYWxmLW9wZW4gKHN0YXJ0LCBlbmRdLCBzbyBhIGZpcnN0IHRpY2sgYXQgc3RhcnQrUCB3b3VsZCBleGNsdWRlIHRoZSBlYXJsaWVzdFxuICAgIC8vIHBvaW50IGZyb20gaXRzIG93biB3aW5kb3cgYW5kIGl0IHdvdWxkIG5ldmVyIGRpc3BsYXkgYXQgYW55IHRpY2suXG4gICAgY29uc3QgdGlja3MgPSBbc3RhcnRNc107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xuICAgICAgICB0aWNrcy5wdXNoKHQpO1xuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XG4gICAgcmV0dXJuIHRpY2tzO1xufVxuXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2Vcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgfVxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xufVxuXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xufVxuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG59XG5cbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cbi8vXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgcmV0dXJuIGZlYXR1cmVJbldpbmRvdyh0aW1lc1swXSwgdGltZXNbMV0sIHdpbik7XG59XG5cbi8vIFRoZSBleHRlbnQgb2YgZXZlcnkgdGltZSBsYXllcidzIG9ic2VydmF0aW9ucywgTmFOLWJsaW5kLiBGZWVkcyB0aWNrIGdlbmVyYXRpb24uXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJzLCBidWZmZXJzKSB7XG4gICAgbGV0IG1pbiA9IEluZmluaXR5LCBtYXggPSAtSW5maW5pdHk7XG4gICAgY29uc3QgdmlzaXQgPSAobGlzdCkgPT4gbGlzdC5mb3JFYWNoKGxheWVyID0+IHtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIikgcmV0dXJuIHZpc2l0KGxheWVyLmxheWVycyB8fCBbXSk7XG4gICAgICAgIGlmICghbGF5ZXIudGltZSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcbiAgICAgICAgaWYgKCF0aW1lcykgcmV0dXJuO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSkgY29udGludWU7XG4gICAgICAgICAgICBpZiAodGltZXNbaV0gPCBtaW4pIG1pbiA9IHRpbWVzW2ldO1xuICAgICAgICAgICAgaWYgKHRpbWVzW2kgKyAxXSA+IG1heCkgbWF4ID0gdGltZXNbaSArIDFdO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdmlzaXQobGF5ZXJzKTtcbiAgICByZXR1cm4gbWluID09PSBJbmZpbml0eSA/IG51bGwgOiB7IG1pbiwgbWF4IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNUaW1lTGF5ZXJzKGxheWVycykge1xuICAgIHJldHVybiBsYXllcnMuc29tZShsID0+IGwudHlwZSA9PT0gXCJncm91cFwiXG4gICAgICAgID8gaGFzVGltZUxheWVycyhsLmxheWVycyB8fCBbXSlcbiAgICAgICAgOiBCb29sZWFuKGwudGltZSkpO1xufVxuXG4vLyBPbmUgcGxheWJhY2sgc3RlcDogdGhlIG5leHQgaW5kZXggYW5kIHdoZXRoZXIgcGxheWJhY2sgc3Vydml2ZXMgaXQuIFB1cmUgc28gdGhlIGxvb3Bcbi8vIHNlbWFudGljcyBhcmUgdGVzdGFibGUgd2l0aG91dCBhIHRpbWVyIC0tIGxvb3Bpbmcgd3JhcHMgYW5kIGtlZXBzIHBsYXlpbmcsIHRoZSBlbmRcbi8vIHdpdGhvdXQgbG9vcCBzdG9wcyB3aGVyZSBpdCBpcy5cbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlKGluZGV4LCBsZW5ndGgsIGxvb3ApIHtcbiAgICBpZiAoaW5kZXggPCBsZW5ndGggLSAxKSByZXR1cm4geyBpbmRleDogaW5kZXggKyAxLCBwbGF5aW5nOiB0cnVlIH07XG4gICAgaWYgKGxvb3ApIHJldHVybiB7IGluZGV4OiAwLCBwbGF5aW5nOiB0cnVlIH07XG4gICAgcmV0dXJuIHsgaW5kZXgsIHBsYXlpbmc6IGZhbHNlIH07XG59XG5cbi8vIFdoZXJlIHRoZSBjb250cm9sIHNpdHMsIGFzIGlubGluZSBzdHlsZXMgc28gdGhlIGNob2ljZSB0cmF2ZWxzIHdpdGggdGhlIHN0YXRlIHJhdGhlclxuLy8gdGhhbiBuZWVkaW5nIGEgc3R5bGVzaGVldCBydWxlIHBlciBjb3JuZXIuIEV2ZXJ5IHByb3BlcnR5IGlzIHdyaXR0ZW4gb24gZXZlcnkgcmVuZGVyIC0tXG4vLyBpbmNsdWRpbmcgdGhlIG9uZXMgYSBwb3NpdGlvbiBkb2VzIG5vdCB1c2UgLS0gc28gbW92aW5nIHRoZSBjb250cm9sIGNsZWFycyB0aGUgb2xkXG4vLyBhbmNob3IgaW5zdGVhZCBvZiBhY2N1bXVsYXRpbmcgYm90aC5cbmV4cG9ydCBjb25zdCBQT1NJVElPTlMgPSB7XG4gICAgXCJ0b3AtbGVmdFwiOiAgICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJcIiB9LFxuICAgIFwidG9wLWNlbnRlclwiOiAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcbiAgICBcInRvcC1yaWdodFwiOiAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJsZWZ0LWNlbnRlclwiOiAgIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwicmlnaHQtY2VudGVyXCI6ICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcbiAgICBcImJvdHRvbS1sZWZ0XCI6ICAgeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJib3R0b20tY2VudGVyXCI6IHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLXJpZ2h0XCI6ICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbn07XG5cbmZ1bmN0aW9uIGFwcGx5UG9zaXRpb24oZWwsIHBvc2l0aW9uKSB7XG4gICAgY29uc3Qgc3R5bGVzID0gUE9TSVRJT05TW3Bvc2l0aW9uXSB8fCBQT1NJVElPTlNbXCJ0b3AtY2VudGVyXCJdO1xuICAgIGZvciAoY29uc3QgW3Byb3AsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzdHlsZXMpKSB7XG4gICAgICAgIGVsLnN0eWxlW3Byb3BdID0gdmFsdWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmb3JtYXRVVEMobXMpIHtcbiAgICByZXR1cm4gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTkpLnJlcGxhY2UoXCJUXCIsIFwiIFwiKSArIFwiWlwiO1xufVxuXG4vLyAtLS0gdGhlIHdpbmRvdyBhbmQgdGhlIHJ1bGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEZpeGVkIG1pbGxpc2Vjb25kcyBmb3IgYSBwZXJpb2QsIG9yIG51bGwgd2hlbiBpdCBtb3ZlcyB0aHJvdWdoIHRoZSBjYWxlbmRhciAobW9udGhzLFxuLy8geWVhcnMpIGFuZCBoYXMgbm8gZml4ZWQgd2lkdGguIFRoZSBydWxlciBhbmQgdGhlIGRyYWcgZ3JpZCBuZWVkIGZpeGVkIHdpZHRoczsgY2FsZW5kYXJcbi8vIHBlcmlvZHMgZmFsbCBiYWNrIHRvIHRoZSB0aWNrIHBvc2l0aW9ucyB0aGVtc2VsdmVzLlxuZXhwb3J0IGZ1bmN0aW9uIHBlcmlvZFRvTXMocCkge1xuICAgIGlmICghcCB8fCBwLnllYXJzIHx8IHAubW9udGhzKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDAgKyBwLmhvdXJzICogMzYwMFxuICAgICAgICArIHAubWludXRlcyAqIDYwICsgcC5zZWNvbmRzKSAqIDEwMDA7XG59XG5cbi8vIE1pbGxpc2Vjb25kcyBhcyBhbiBJU084NjAxIGR1cmF0aW9uLCBob3Vycy9taW51dGVzL3NlY29uZHMgb25seSAtLSBQVDI2SCBpcyB2YWxpZCBhbmRcbi8vIGF2b2lkcyBjYWxlbmRhciB1bml0cyBlbnRpcmVseSwgc28gd2hhdCB0aGUgZHJhZyB3cml0ZXMgYWx3YXlzIHBhcnNlcyBiYWNrIGV4YWN0bHkuXG5leHBvcnQgZnVuY3Rpb24gbXNUb1BlcmlvZElTTyhtcykge1xuICAgIGxldCByZXN0ID0gTWF0aC5yb3VuZChtcyAvIDEwMDApO1xuICAgIGNvbnN0IGggPSBNYXRoLmZsb29yKHJlc3QgLyAzNjAwKTsgcmVzdCAtPSBoICogMzYwMDtcbiAgICBjb25zdCBtID0gTWF0aC5mbG9vcihyZXN0IC8gNjApOyByZXN0IC09IG0gKiA2MDtcbiAgICBsZXQgb3V0ID0gXCJQVFwiO1xuICAgIGlmIChoKSBvdXQgKz0gYCR7aH1IYDtcbiAgICBpZiAobSkgb3V0ICs9IGAke219TWA7XG4gICAgaWYgKHJlc3QgfHwgb3V0ID09PSBcIlBUXCIpIG91dCArPSBgJHtyZXN0fVNgO1xuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFRoZSBydWxlcidzIGluY3JlbWVudDogdGhlIGxhcmdlc3Qgc3RlcCB0aGF0IGxhbmRzIG9uIGV2ZXJ5IGJvdW5kYXJ5IHRoZSB1c2VyIGNhbiBjYXJlXG4vLyBhYm91dCAtLSB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWQgZHVyYXRpb24uIEFuIGludGVydmFsIG9mIDFoIHdpdGggYVxuLy8gMi41aCBkdXJhdGlvbiBuZWVkcyAzMC1taW51dGUgbWFya3MgZm9yIHRoZSBkdXJhdGlvbiB0byBzaXQgb24gb25lOyAxaCBhbmQgMmggbmVlZCBvbmx5XG4vLyB0aGUgaG91cnMuIFwiTG93ZXN0IGR1cmF0aW9uXCIgaXMgdGhlIHNwZWNpYWwgY2FzZSB3aGVyZSBvbmUgZGl2aWRlcyB0aGUgb3RoZXIuXG5leHBvcnQgZnVuY3Rpb24gZ2NkR3JpZE1zKHBlcmlvZE1zLCBkdXJhdGlvbnNNcykge1xuICAgIGNvbnN0IGdjZCA9IChhLCBiKSA9PiAoYiA/IGdjZChiLCBhICUgYikgOiBhKTtcbiAgICBsZXQgZ3JpZCA9IHBlcmlvZE1zO1xuICAgIGZvciAoY29uc3QgZCBvZiBkdXJhdGlvbnNNcykge1xuICAgICAgICBpZiAoZCA+IDApIGdyaWQgPSBnY2QoZ3JpZCwgTWF0aC5yb3VuZChkKSk7XG4gICAgfVxuICAgIHJldHVybiBNYXRoLm1heChncmlkLCAxMDAwKTtcbn1cblxuLy8gRXZlcnkgZmluaXRlIGR1cmF0aW9uIGF0dGFjaGVkIHRvIGEgdGltZSBsYXllciwgaW4gbXMsIGZvciB0aGUgZ3JpZC4gXCJwZXJpb2RcIiBhbmQgbnVsbFxuLy8gY29udHJpYnV0ZSBub3RoaW5nIG5ldzsgY2FsZW5kYXIgZHVyYXRpb25zIGNhbm5vdCBqb2luIGEgZml4ZWQtbXMgZ3JpZCBhbmQgYXJlIHNraXBwZWQuXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdER1cmF0aW9uc01zKGxheWVycywgd2luZG93SXNvKSB7XG4gICAgY29uc3Qgb3V0ID0gW107XG4gICAgY29uc3QgdmlzaXQgPSBsaXN0ID0+IGxpc3QuZm9yRWFjaChsID0+IHtcbiAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobC5sYXllcnMgfHwgW10pO1xuICAgICAgICBjb25zdCBzcGVjID0gbC50aW1lICYmIGwudGltZS5kdXJhdGlvbjtcbiAgICAgICAgaWYgKHR5cGVvZiBzcGVjID09PSBcInN0cmluZ1wiICYmIHNwZWMgIT09IFwicGVyaW9kXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzcGVjKSk7XG4gICAgICAgICAgICBpZiAobXMpIG91dC5wdXNoKG1zKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHZpc2l0KGxheWVycyk7XG4gICAgaWYgKHdpbmRvd0lzbykge1xuICAgICAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qod2luZG93SXNvKSk7XG4gICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xuICAgIH1cbiAgICByZXR1cm4gb3V0O1xufVxuXG4vLyBUaWNrIG1hcmtzIGZvciB0aGUgdHJhY2s6IG1ham9ycyBhdCBldmVyeSBpbnRlcnZhbCBib3VuZGFyeSAoc3BhcnNlbHkgbGFiZWxsZWQgc28gbG9uZ1xuLy8gdGltZWxpbmVzIHN0YXkgcmVhZGFibGUpLCB1bmxhYmVsbGVkIG1pbm9ycyBhdCB0aGUgZ3JpZCBpbiBiZXR3ZWVuLiBNaW5vciBESVNQTEFZIGlzXG4vLyB0aGlubmVkIHdoZW4gZGVuc2U7IHRoZSBzbmFwIGdyaWQgc3RheXMgZXhhY3QsIHNvIGEgbWFyayBpcyBhIGd1aWRlLCBub3QgYSBjb25zdHJhaW50LlxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUnVsZXIodGlja3MsIGdyaWRNcywgZm9ybWF0TGFiZWwsIHsgbWF4TGFiZWxzID0gNiwgbWF4TWlub3JzID0gMjQwIH0gPSB7fSkge1xuICAgIGlmICh0aWNrcy5sZW5ndGggPCAyKSByZXR1cm4gW107XG4gICAgY29uc3QgdDAgPSB0aWNrc1swXSwgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdDA7XG4gICAgY29uc3QgbWFya3MgPSBbXTtcbiAgICBjb25zdCBsYWJlbEV2ZXJ5ID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRpY2tzLmxlbmd0aCAvIG1heExhYmVscykpO1xuICAgIHRpY2tzLmZvckVhY2goKHQsIGkpID0+IG1hcmtzLnB1c2goe1xuICAgICAgICBmcmFjdGlvbjogKHQgLSB0MCkgLyBzcGFuLCBtYWpvcjogdHJ1ZSxcbiAgICAgICAgbGFiZWw6IGkgJSBsYWJlbEV2ZXJ5ID09PSAwID8gZm9ybWF0TGFiZWwodCkgOiBudWxsLFxuICAgIH0pKTtcbiAgICBpZiAoZ3JpZE1zICYmIGdyaWRNcyA8IHNwYW4pIHtcbiAgICAgICAgY29uc3QgdG90YWwgPSBNYXRoLmZsb29yKHNwYW4gLyBncmlkTXMpO1xuICAgICAgICBjb25zdCB0aGluID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRvdGFsIC8gbWF4TWlub3JzKSk7XG4gICAgICAgIGZvciAobGV0IGsgPSAxOyBrICogZ3JpZE1zIDwgc3BhbjsgayArPSB0aGluKSB7XG4gICAgICAgICAgICBjb25zdCB0ID0gdDAgKyBrICogZ3JpZE1zO1xuICAgICAgICAgICAgaWYgKHRpY2tzLmluY2x1ZGVzKHQpKSBjb250aW51ZTtcbiAgICAgICAgICAgIG1hcmtzLnB1c2goeyBmcmFjdGlvbjogKHQgLSB0MCkgLyBzcGFuLCBtYWpvcjogZmFsc2UsIGxhYmVsOiBudWxsIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBtYXJrcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFRpY2tMYWJlbChtcywgcGVyaW9kTXMpIHtcbiAgICBjb25zdCBpc28gPSBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKTtcbiAgICBpZiAocGVyaW9kTXMgIT0gbnVsbCAmJiBwZXJpb2RNcyA8IDYwICogMTAwMCkgcmV0dXJuIGlzby5zbGljZSgxMSwgMTkpO1xuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgMjQgKiAzNjAwICogMTAwMCkgcmV0dXJuIGlzby5zbGljZSgxMSwgMTYpO1xuICAgIHJldHVybiBpc28uc2xpY2UoNSwgMTApO1xufVxuXG4vLyBHbHlwaHMgYXMgaW5saW5lIFNWRyByYXRoZXIgdGhhbiB0ZXh0OiBcIlx1MjFCQlwiIHJlYWRzIGFzIHJlZnJlc2ggLS0gYSBsb29wIHRvZ2dsZSBkcmF3biB3aXRoXG4vLyBpdCBsb29rcyBsaWtlIGEgcmVzZXQgYnV0dG9uLCB3aGljaCBpcyBleGFjdGx5IGhvdyBpdCBnb3QgbWlzcmVhZC4gY3VycmVudENvbG9yIGxldHNcbi8vIHRoZSBwcmVzc2VkIHN0YXRlIHJlc3R5bGUgdGhlbSBmcm9tIENTUy5cbmNvbnN0IElDT05TID0ge1xuICAgIGJhY2s6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk0zIDJoMnYxMkgzek0xMyAyIDYgOGw3IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGxheTogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTQgMmw5IDYtOSA2elwiLz48L3N2Zz4nLFxuICAgIHBhdXNlOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAyaDN2MTJINHpNOSAyaDN2MTJIOXpcIi8+PC9zdmc+JyxcbiAgICBmd2Q6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk0xMSAyaDJ2MTJoLTJ6TTMgMmw3IDYtNyA2elwiLz48L3N2Zz4nLFxuICAgIGxvb3A6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk04IDJhNiA2IDAgMCAxIDUuNjUgNEgxNmwtMi44IDMuNUwxMC40IDZoMi4xQTQuNSA0LjUgMCAxIDAgMTIuNSAxMGwxLjMuNzVBNiA2IDAgMSAxIDggMnpcIi8+PC9zdmc+Jyxcbn07XG5cbi8vIC0tLSB0aGUgY29udHJvbCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGxhaW4gRE9NIGluc2lkZSB0aGUgd2lkZ2V0IGNvbnRhaW5lciwgbGlrZSB0aGUgc2lkZWJhcjogbm8gTGVhZmxldCBjb250cm9sIG1hY2hpbmVyeSxcbi8vIHdoaWNoIGtlZXBzIGl0IHRlc3RhYmxlIGluIGpzZG9tIGFuZCBzdHlsZWFibGUgZnJvbSBtYXAuY3NzLiBUaGUgbGF5b3V0IGZvbGxvd3Ncbi8vIExlYWZsZXQuVGltZURpbWVuc2lvbidzIGNvbnRyb2wgLS0gc3RlcC9wbGF5L3N0ZXAvbG9vcCBhcyBhIGpvaW5lZCBidXR0b24gYmFyLCB0aGVuIHRoZVxuLy8gZGF0ZSwgc2xpZGVyIGFuZCBzcGVlZCAtLSBzaW5jZSB0aGF0IGlzIHRoZSBzbGlkZXIgdXNlcnMgb2YgdGhlIGZvbGl1bSBhcHBzIGtub3cuXG4vL1xuLy8gVGhlIHNsaWRlciBpcyBhIGNvbXBvc2l0ZS4gQSBuYXRpdmUgPGlucHV0IHR5cGU9cmFuZ2U+IHN0YXlzIG9uIHRvcCBhcyB0aGUgdGh1bWI6IGl0XG4vLyBrZWVwcyBrZXlib2FyZCBhcnJvd3MsIHNjcmVlbiByZWFkZXJzIGFuZCBldmVyeSBleGlzdGluZyB0ZXN0IHdvcmtpbmcsIGFuZCBwbGF5YmFja1xuLy8gZHJpdmVzIGl0IGFzIGJlZm9yZS4gVW5kZXJuZWF0aCBzaXQgdGhlIHBhcnRzIGEgbmF0aXZlIGlucHV0IGNhbm5vdCBkcmF3OiB0aGUgd2luZG93XG4vLyBzcGFuIHNob3dpbmcgZXhhY3RseSB3aGF0IGludGVydmFsIGlzIG9uIHRoZSBtYXAsIGEgcnVsZXIgd2l0aCBsYWJlbGxlZCBpbnRlcnZhbCBtYXJrc1xuLy8gYW5kIHVubGFiZWxsZWQgZ2NkIG1pbm9ycywgYW5kIHRoZSB0cmFpbCBoYW5kbGUgLS0gZHJhZyBpdCBiYWNrIHRvIHdpZGVuIHRoZSB3aW5kb3cgZm9yXG4vLyBldmVyeSBsYXllciBhdCBvbmNlLCBkcm9wIGl0IG9udG8gdGhlIHRodW1iIHRvIGhhbmQgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyVGltZUNvbnRyb2woY29udGFpbmVyLCBzdGF0ZSwgaGFuZGxlcnMpIHtcbiAgICBsZXQgZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWNvbnRyb2xcIik7XG4gICAgaWYgKCFzdGF0ZS50aWNrcyB8fCBzdGF0ZS50aWNrcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKGVsKSBlbC5yZW1vdmUoKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmICghZWwpIHtcbiAgICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBlbC5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXRpbWUtY29udHJvbFwiO1xuICAgICAgICBlbC5pbm5lckhUTUwgPSBgXG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYnV0dG9uc1wiPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhY2tcIiB0aXRsZT1cIlN0ZXAgYmFja1wiIGFyaWEtbGFiZWw9XCJTdGVwIGJhY2tcIj4ke0lDT05TLmJhY2t9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtcGxheVwiIGFyaWEtbGFiZWw9XCJQbGF5XCI+JHtJQ09OUy5wbGF5fTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWZ3ZFwiIHRpdGxlPVwiU3RlcCBmb3J3YXJkXCIgYXJpYS1sYWJlbD1cIlN0ZXAgZm9yd2FyZFwiPiR7SUNPTlMuZndkfTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxvb3BcIiBhcmlhLWxhYmVsPVwiTG9vcFwiPiR7SUNPTlMubG9vcH08L2J1dHRvbj5cbiAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sYWJlbFwiPjwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS10cmFja1wiPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1iYXNlXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGFuXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1ydWxlclwiPjwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8aW5wdXQgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNsaWRlclwiIHR5cGU9XCJyYW5nZVwiIG1pbj1cIjBcIiBzdGVwPVwiMVwiPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS10cmFpbFwiIHJvbGU9XCJzbGlkZXJcIiB0YWJpbmRleD1cIjBcIlxuICAgICAgICAgICAgICAgICAgICAgIGFyaWEtbGFiZWw9XCJUcmFpbGluZyB3aW5kb3dcIiB0aXRsZT1cIkRyYWcgYmFjayB0byB3aWRlbiB0aGUgdGltZSB3aW5kb3c7IGRyb3Agb24gdGhlIHRodW1iIHRvIGNsZWFyXCI+PC9zcGFuPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNlbGVjdCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc3BlZWRcIiB0aXRsZT1cIlBsYXliYWNrIHNwZWVkXCI+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjAuNVwiPjAuNXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMVwiPjF4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjJcIj4yeDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCI0XCI+NHg8L29wdGlvbj5cbiAgICAgICAgICAgIDwvc2VsZWN0PmA7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChlbCk7XG5cbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWJhY2tcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEJhY2spO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtZndkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBGb3J3YXJkKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uUGxheVRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vbkxvb3BUb2dnbGUpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLFxuICAgICAgICAgICAgZSA9PiBoYW5kbGVycy5vblNwZWVkKHBhcnNlRmxvYXQoZS50YXJnZXQudmFsdWUpKSk7XG4gICAgICAgIGNvbnN0IHNsaWRlciA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIik7XG4gICAgICAgIC8vIGBpbnB1dGAgZmlyZXMgcGVyIGRyYWcgc3RlcCBmb3IgbGl2ZSBzY3J1YmJpbmc7IHRoZSBtb2RlbCB3cml0ZWJhY2sgaXMgdGhlXG4gICAgICAgIC8vIGhhbmRsZXIncyBwcm9ibGVtLCB0aHJvdHRsZWQgdGhlcmUgc28gZHJhZ2dpbmcgZG9lcyBub3QgZmxvb2QgdGhlIGtlcm5lbC5cbiAgICAgICAgc2xpZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBlID0+IGhhbmRsZXJzLm9uU2VlayhwYXJzZUludChlLnRhcmdldC52YWx1ZSwgMTApKSk7XG5cbiAgICAgICAgYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycyk7XG4gICAgfVxuXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS5tYXggPSBTdHJpbmcoc3RhdGUudGlja3MubGVuZ3RoIC0gMSk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5pbmRleCk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxhYmVsXCIpLnRleHRDb250ZW50ID0gZm9ybWF0VVRDKHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XSk7XG5cbiAgICBjb25zdCBwbGF5ID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIik7XG4gICAgcGxheS5pbm5lckhUTUwgPSBzdGF0ZS5wbGF5aW5nID8gSUNPTlMucGF1c2UgOiBJQ09OUy5wbGF5O1xuICAgIHBsYXkuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBzdGF0ZS5wbGF5aW5nID8gXCJQYXVzZVwiIDogXCJQbGF5XCIpO1xuICAgIHBsYXkudGl0bGUgPSBzdGF0ZS5wbGF5aW5nID8gXCJQYXVzZVwiIDogXCJQbGF5XCI7XG5cbiAgICAvLyBBIG1vZGUsIG5vdCBhbiBhY3Rpb246IHByZXNzZWQgc3R5bGluZyBhbmQgYXJpYS1wcmVzc2VkIHNheSBcInRoaXMgc3RheXMgb25cIixcbiAgICAvLyB3aGVyZSBhIGJhcmUgaWNvbiBpbnZpdGVkIGEgY2xpY2sgZXhwZWN0aW5nIHNvbWV0aGluZyB0byBoYXBwZW4gcmlnaHQgbm93LlxuICAgIGNvbnN0IGxvb3AgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKTtcbiAgICBsb29wLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgQm9vbGVhbihzdGF0ZS5sb29wKSk7XG4gICAgbG9vcC5zZXRBdHRyaWJ1dGUoXCJhcmlhLXByZXNzZWRcIiwgU3RyaW5nKEJvb2xlYW4oc3RhdGUubG9vcCkpKTtcbiAgICBsb29wLnRpdGxlID0gc3RhdGUubG9vcCA/IFwiTG9vcDogb25cIiA6IFwiTG9vcDogb2ZmXCI7XG5cbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuc3BlZWQgfHwgMSk7XG4gICAgcmVuZGVyVHJhY2soZWwsIHN0YXRlKTtcbiAgICBhcHBseVBvc2l0aW9uKGVsLCBzdGF0ZS5wb3NpdGlvbik7XG4gICAgcmV0dXJuIGVsO1xufVxuXG4vLyBHZW9tZXRyeSBzaGFyZWQgYnkgcmVuZGVyaW5nIGFuZCBkcmFnZ2luZzogd2hlcmUgYSB0aW1lIHNpdHMgb24gdGhlIHRyYWNrLCAwLi4xLlxuZnVuY3Rpb24gdHJhY2tGcmFjdGlvbih0aWNrcywgdCkge1xuICAgIGNvbnN0IHNwYW4gPSB0aWNrc1t0aWNrcy5sZW5ndGggLSAxXSAtIHRpY2tzWzBdO1xuICAgIGlmIChzcGFuIDw9IDApIHJldHVybiAxO1xuICAgIHJldHVybiBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCAodCAtIHRpY2tzWzBdKSAvIHNwYW4pKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyVHJhY2soZWwsIHN0YXRlKSB7XG4gICAgY29uc3QgeyB0aWNrcywgaW5kZXggfSA9IHN0YXRlO1xuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xuICAgIHRyYWNrLl9zdGF0ZSA9IHN0YXRlOyAgICAgIC8vIHRoZSBkcmFnIGhhbmRsZXIgcmVhZHMgdGhlIGZyZXNoZXN0IHN0YXRlIGZyb20gaGVyZVxuXG4gICAgY29uc3QgdGh1bWJUID0gdGlja3NbaW5kZXhdO1xuICAgIGNvbnN0IHBlcmlvZE1zID0gc3RhdGUucGVyaW9kTXM7XG4gICAgY29uc3Qgd2luZG93TXMgPSBzdGF0ZS53aW5kb3cgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHN0YXRlLndpbmRvdykpIDogbnVsbDtcbiAgICBjb25zdCBzaG93bk1zID0gd2luZG93TXMgIT0gbnVsbCA/IHdpbmRvd01zIDogcGVyaW9kTXM7XG5cbiAgICAvLyBUaGUgc3Bhbjogd2hhdCBpbnRlcnZhbCB0aGUgbWFwIGlzIHNob3dpbmcgcmlnaHQgbm93LiBUaGUgc3BhbiBkZXBpY3RzIHRoZSBzaGFyZWRcbiAgICAvLyB3aW5kb3cgLS0gb25lIHBlcmlvZCBieSBkZWZhdWx0IC0tIGFuZCBwZXItbGF5ZXIgZHVyYXRpb25zIHJlbWFpbiBhbiBBUEkgY29uY2VyblxuICAgIC8vIHVudGlsIGEgZHJhZyBvdmVycmlkZXMgdGhlbSBmb3IgZXZlcnl0aGluZyBhdCBvbmNlLlxuICAgIGNvbnN0IHNwYW4gPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BhblwiKTtcbiAgICBjb25zdCByaWdodCA9IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCk7XG4gICAgY29uc3QgbGVmdCA9IHNob3duTXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHNob3duTXMpIDogMDtcbiAgICBzcGFuLnN0eWxlLmxlZnQgPSBgJHsobGVmdCAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICBzcGFuLnN0eWxlLndpZHRoID0gYCR7KE1hdGgubWF4KDAsIHJpZ2h0IC0gbGVmdCkgKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgc3Bhbi5jbGFzc0xpc3QudG9nZ2xlKFwib3ZlcnJpZGVcIiwgd2luZG93TXMgIT0gbnVsbCk7XG5cbiAgICAvLyBUaGUgdHJhaWwgaGFuZGxlIHBhcmtzIE9OIHRoZSB0aHVtYiB3aGVuIG5vIG92ZXJyaWRlIGlzIGFjdGl2ZSAtLSBcIm5vdCBncmFiYmVkXCIgLS1cbiAgICAvLyBhbmQgc2l0cyBhdCB0aGUgd2luZG93J3Mgc3RhcnQgd2hpbGUgb25lIGlzLiBEcm9wcGluZyBpdCBiYWNrIG9uIHRoZSB0aHVtYiBjbGVhcnMuXG4gICAgY29uc3QgdHJhaWwgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhaWxcIik7XG4gICAgY29uc3QgYXQgPSB3aW5kb3dNcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gd2luZG93TXMpIDogcmlnaHQ7XG4gICAgdHJhaWwuc3R5bGUubGVmdCA9IGAkeyhhdCAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICB0cmFpbC5jbGFzc0xpc3QudG9nZ2xlKFwiYWN0aXZlXCIsIHdpbmRvd01zICE9IG51bGwpO1xuICAgIHRyYWlsLnNldEF0dHJpYnV0ZShcImFyaWEtdmFsdWV0ZXh0XCIsIHN0YXRlLndpbmRvdyB8fCBcIm5vIHRyYWlsaW5nIHdpbmRvd1wiKTtcbiAgICAvLyBObyBmaXhlZC1tcyBncmlkIChjYWxlbmRhciBwZXJpb2RzKSBtZWFucyBub3RoaW5nIHNlbnNpYmxlIHRvIHNuYXAgdG8uXG4gICAgdHJhaWwuc3R5bGUuZGlzcGxheSA9IHN0YXRlLmdyaWRNcyA/IFwiXCIgOiBcIm5vbmVcIjtcblxuICAgIGNvbnN0IHJ1bGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXJ1bGVyXCIpO1xuICAgIGNvbnN0IGtleSA9IGAke3RpY2tzWzBdfXwke3RpY2tzLmxlbmd0aH18JHtzdGF0ZS5ncmlkTXN9fCR7cGVyaW9kTXN9YDtcbiAgICBpZiAocnVsZXIuX2tleSAhPT0ga2V5KSB7XG4gICAgICAgIHJ1bGVyLl9rZXkgPSBrZXk7XG4gICAgICAgIHJ1bGVyLmlubmVySFRNTCA9IFwiXCI7XG4gICAgICAgIGZvciAoY29uc3QgbWFyayBvZiBidWlsZFJ1bGVyKHRpY2tzLCBzdGF0ZS5ncmlkTXMsIHQgPT4gZm9ybWF0VGlja0xhYmVsKHQsIHBlcmlvZE1zKSkpIHtcbiAgICAgICAgICAgIGNvbnN0IG0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgICAgIG0uY2xhc3NOYW1lID0gbWFyay5tYWpvciA/IFwic3dpZnRtYXAtdGltZS1tYXJrIG1ham9yXCIgOiBcInN3aWZ0bWFwLXRpbWUtbWFya1wiO1xuICAgICAgICAgICAgbS5zdHlsZS5sZWZ0ID0gYCR7KG1hcmsuZnJhY3Rpb24gKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgICAgICAgICBpZiAobWFyay5sYWJlbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgICAgIGxhYi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXRpbWUtbWFyay1sYWJlbFwiO1xuICAgICAgICAgICAgICAgIGxhYi50ZXh0Q29udGVudCA9IG1hcmsubGFiZWw7XG4gICAgICAgICAgICAgICAgbS5hcHBlbmRDaGlsZChsYWIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcnVsZXIuYXBwZW5kQ2hpbGQobSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8vIERyYWdnaW5nIHRoZSB0cmFpbCBoYW5kbGUuIFNuYXBzIHRvIHRoZSBnY2QgZ3JpZCBzbyBldmVyeSBzdG9wIGlzIGEgYm91bmRhcnkgdGhlIGRhdGFcbi8vIG9yIHRoZSBpbnRlcnZhbCBhY3R1YWxseSBuYW1lczsgdGhlIGRpc3RhbmNlIHRvIHRoZSB0aHVtYiwgaW4gd2hvbGUgZ3JpZCBzdGVwcywgSVMgdGhlXG4vLyB3aW5kb3cuIFplcm8gc3RlcHMgLS0gZHJvcHBlZCBvbiB0aGUgdGh1bWIgLS0gY2xlYXJzIHRoZSBvdmVycmlkZS5cbmZ1bmN0aW9uIGF0dGFjaFRyYWlsRHJhZyhlbCwgaGFuZGxlcnMpIHtcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcblxuICAgIGZ1bmN0aW9uIGlzb0Zyb21FdmVudChldikge1xuICAgICAgICBjb25zdCBzdGF0ZSA9IHRyYWNrLl9zdGF0ZTtcbiAgICAgICAgY29uc3QgcmVjdCA9IHRyYWNrLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMgfHwgcmVjdC53aWR0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHVuY2xhbXBlZCBvbiB0aGUgbGVmdDogdGhlIHdpbmRvdyBpcyBcImhvdyBmYXIgYmFjayBmcm9tIHRoZVxuICAgICAgICAvLyBsZWFkIHBvaW50XCIsIGFuZCB0aGF0IG1heSByZWFjaCBwYXN0IHRoZSBiYXIncyBzdGFydCAtLSBlc3BlY2lhbGx5IHdoZW4gdGhlXG4gICAgICAgIC8vIGxlYWQgc2l0cyBlYXJseSBvbiB0aGUgYmFyIGFuZCBtb3N0IG9mIGl0cyB0cmFpbCBpcyBvZmYtc2NyZWVuLiBDbGFtcGluZyBoZXJlXG4gICAgICAgIC8vIGNhcHBlZCB0aGUgd2luZG93IGF0IHRoZSB2aXNpYmxlIHBhc3QsIHdoaWNoIHBpbm5lZCB0aGUgaGFuZGxlIHRvIHRoZSBiYXInc1xuICAgICAgICAvLyBzdGFydCBhbmQgbWFkZSBhbnl0aGluZyB3aWRlciBpbXBvc3NpYmxlIHRvIHNldC4gT25seSB0aGUgRFJBV0lORyBjbGFtcHMuXG4gICAgICAgIGNvbnN0IGZyYWMgPSBNYXRoLm1pbigxLCAoZXYuY2xpZW50WCAtIHJlY3QubGVmdCkgLyByZWN0LndpZHRoKTtcbiAgICAgICAgY29uc3QgdDAgPSBzdGF0ZS50aWNrc1swXTtcbiAgICAgICAgY29uc3Qgc3Bhbk1zID0gc3RhdGUudGlja3Nbc3RhdGUudGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcbiAgICAgICAgY29uc3QgdGh1bWJUID0gc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdO1xuICAgICAgICBjb25zdCBkaXN0ID0gdGh1bWJUIC0gKHQwICsgZnJhYyAqIHNwYW5Ncyk7XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5tYXgoMCwgTWF0aC5yb3VuZChkaXN0IC8gc3RhdGUuZ3JpZE1zKSk7XG4gICAgICAgIHJldHVybiBzdGVwcyA9PT0gMCA/IG51bGwgOiBtc1RvUGVyaW9kSVNPKHN0ZXBzICogc3RhdGUuZ3JpZE1zKTtcbiAgICB9XG5cbiAgICAvLyBNb3ZlIGFuZCByZWxlYXNlIGxpc3RlbiBvbiB0aGUgZG9jdW1lbnQgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgZHJhZzogdGhlIGhhbmRsZVxuICAgIC8vIGlzIDEycHggd2lkZSwgdGhlIGN1cnNvciBsZWF2ZXMgaXQgb24gdGhlIGZpcnN0IGZhc3QgbW92ZW1lbnQsIGFuZCBldmVudHMgdGhhdFxuICAgIC8vIHRhcmdldCB3aGF0ZXZlciBpcyB1bmRlcm5lYXRoIHdvdWxkIHN0dXR0ZXIgdGhlIGRyYWcgYW5kIGNvdWxkIHN3YWxsb3cgdGhlIHJlbGVhc2VcbiAgICAvLyBlbnRpcmVseSAtLSBhbiB1bmNvbW1pdHRlZCBkcmFnIHRoZW4gc25hcHMgYmFjayBvbiB0aGUgbmV4dCBzeW5jLlxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCBldiA9PiB7XG4gICAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAvLyBDYXB0dXJlIHJldGFyZ2V0cyBldmVyeSBwb2ludGVyIGV2ZW50IHRvIHRoZSBoYW5kbGUgdW50aWwgcmVsZWFzZSwgbm8gbWF0dGVyXG4gICAgICAgIC8vIHdoZXJlIHRoZSBjdXJzb3IgaXMuIFdpdGhvdXQgaXQsIGxldHRpbmcgZ28gd2l0aCB0aGUgcG9pbnRlciBvdmVyIHRoZSBtYXAgaGFuZHNcbiAgICAgICAgLy8gcG9pbnRlcnVwIHRvIExlYWZsZXQncyBjb250YWluZXIgaGFuZGxlcnMsIGFuZCBhIHJlbGVhc2UgdGhleSBzd2FsbG93IG5ldmVyXG4gICAgICAgIC8vIHJlYWNoZXMgdGhlIGRvY3VtZW50IGxpc3RlbmVyIC0tIHRoZSBkcmFnIHN0YXlzIHVuY29tbWl0dGVkIGFuZCB0aGUgbmV4dCBzeW5jXG4gICAgICAgIC8vIHNuYXBzIHRoZSBoYW5kbGUgaG9tZS4gVGhlIGRvY3VtZW50IGxpc3RlbmVycyBiZWxvdyByZW1haW4gYXMgdGhlIGZhbGxiYWNrIGZvclxuICAgICAgICAvLyBlbnZpcm9ubWVudHMgd2l0aG91dCBjYXB0dXJlOyB3aXRoIGl0LCByZXRhcmdldGVkIGV2ZW50cyBzdGlsbCBidWJibGUgdG8gdGhlbS5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZSkgdHJhaWwuc2V0UG9pbnRlckNhcHR1cmUoZXYucG9pbnRlcklkKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIHN5bnRoZXRpYyBldmVudHMgaGF2ZSBubyBhY3RpdmUgcG9pbnRlcjsgZmFsbCBiYWNrIHRvIGJ1YmJsaW5nICovIH1cblxuICAgICAgICBjb25zdCBtb3ZlID0gZSA9PiB7XG4gICAgICAgICAgICBjb25zdCBpc28gPSBpc29Gcm9tRXZlbnQoZSk7XG4gICAgICAgICAgICBpZiAoaXNvICE9PSB1bmRlZmluZWQpIGhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBmaW5pc2ggPSBlID0+IHtcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgZmluaXNoKTtcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XG4gICAgICAgICAgICBjb25zdCBpc28gPSBpc29Gcm9tRXZlbnQoZSk7XG4gICAgICAgICAgICBpZiAoaXNvICE9PSB1bmRlZmluZWQpIGhhbmRsZXJzLm9uV2luZG93Q29tbWl0KGlzbyk7XG4gICAgICAgIH07XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBmaW5pc2gpO1xuICAgIH0pO1xuXG4gICAgLy8gS2V5Ym9hcmQ6IG9uZSBncmlkIHN0ZXAgcGVyIGFycm93LCBEZWxldGUvSG9tZSB0byBjbGVhci4gU2FtZSBjb250cmFjdCBhcyB0aGUgZHJhZy5cbiAgICB0cmFpbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBldiA9PiB7XG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMpIHJldHVybjtcbiAgICAgICAgY29uc3QgY3VycmVudCA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiAwO1xuICAgICAgICBsZXQgbmV4dDtcbiAgICAgICAgaWYgKGV2LmtleSA9PT0gXCJBcnJvd0xlZnRcIikgbmV4dCA9IGN1cnJlbnQgKyBzdGF0ZS5ncmlkTXM7XG4gICAgICAgIGVsc2UgaWYgKGV2LmtleSA9PT0gXCJBcnJvd1JpZ2h0XCIpIG5leHQgPSBNYXRoLm1heCgwLCBjdXJyZW50IC0gc3RhdGUuZ3JpZE1zKTtcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkRlbGV0ZVwiIHx8IGV2LmtleSA9PT0gXCJIb21lXCIpIG5leHQgPSAwO1xuICAgICAgICBlbHNlIHJldHVybjtcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgaGFuZGxlcnMub25XaW5kb3dDb21taXQobmV4dCA+IDAgPyBtc1RvUGVyaW9kSVNPKG5leHQpIDogbnVsbCk7XG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgbG9hZEpTLCBiaW5kUG9wdXAsIGJpbmRUb29sdGlwLCBwYXJzZUNvbG9yIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHBpblNoYWRlciB9IGZyb20gXCIuL3NoYWRlcnMuanNcIjtcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24gfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xuXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XG4gICAgaWYgKGdsSW5zdGFuY2UgJiYgZ2xJbnN0YW5jZS5sYXllcikge1xuICAgICAgICBnbEluc3RhbmNlLmxheWVyLl91bmNsYW1wZWRQcm9qZWN0ID0gZnVuY3Rpb24obGF0bG5nLCB6b29tKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcbiAgICAgICAgfTtcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5yZWRyYXcoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9jbGlja1RpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2NsaWNrTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5faG92ZXJNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5faG92ZXJNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xuLy8gdmFyaWVkIHN0eWxpbmcsIG90aGVyd2lzZSB0aGUgbGF5ZXIncyBzaW5nbGUgc3R5bGUuIFB5dGhvbiBvbmx5IGVtaXRzIGZlYXR1cmVfc3R5bGVzXG4vLyB3aGVuIGZlYXR1cmVzIGFjdHVhbGx5IGRpZmZlciwgc28gYSB1bmlmb3JtIGxheWVyIGNvc3RzIG5vdGhpbmcgZXh0cmEgaGVyZS5cbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxuLy8gdGhhbiBlZGl0aW5nIHRoZSBsYXllcidzIHN0eWxlLCBzbyBjbGVhcmluZyBpdCByZXN0b3JlcyB3aGF0IHdhcyB1bmRlcm5lYXRoIHdpdGhcbi8vIG5vdGhpbmcgdG8gcmVtZW1iZXIgYW5kIG5vdGhpbmcgdG8gcHV0IGJhY2suXG4vL1xuLy8gICB0aGUgbGF5ZXIncyBvd24gc3R5bGUgICB3aGF0IGl0IHdhcyBkcmF3biB3aXRoXG4vLyAgIGZlYXR1cmVfc3R5bGVzW2ldICAgICAgIHBlciBmZWF0dXJlLCBmcm9tIHRoZSBkYXRhXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxuLy8gICBzdHlsZV9vdmVycmlkZXNbaV0gICAgICB0aGlzIGZlYXR1cmUgaXMgc2VsZWN0ZWQgLS0gbW9zdCBzcGVjaWZpYywgc28gaXQgd2luc1xuZXhwb3J0IGZ1bmN0aW9uIHN0eWxlRm9yKGxheWVyLCBpbmRleCkge1xuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xuICAgIGNvbnN0IGhpZ2hsaWdodCA9IGxheWVyLmhpZ2hsaWdodF9zdHlsZTtcbiAgICBjb25zdCBzZWxlY3RlZCA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyAmJiBsYXllci5zdHlsZV9vdmVycmlkZXNbaW5kZXhdO1xuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcbiAgICByZXR1cm4geyAuLi5sYXllciwgLi4uKGZyb21EYXRhIHx8IHt9KSwgLi4uKGhpZ2hsaWdodCB8fCB7fSksIC4uLihzZWxlY3RlZCB8fCB7fSkgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEluZGV4ZWRQcm9wZXJ0aWVzKHByb3BlcnRpZXMsIGluZGV4KSB7XG4gICAgaWYgKCFwcm9wZXJ0aWVzKSByZXR1cm4ge307XG4gICAgY29uc3QgcHJvcHMgPSB7fTtcbiAgICBPYmplY3Qua2V5cyhwcm9wZXJ0aWVzKS5mb3JFYWNoKGsgPT4ge1xuICAgICAgICBjb25zdCB2YWwgPSBwcm9wZXJ0aWVzW2tdO1xuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XG4gICAgfSk7XG4gICAgcmV0dXJuIHByb3BzO1xufVxuXG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyLCBtb2RlbCkge1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcbiAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge307XG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcbiAgICAgICAgcmV0dXJuIGdyb3VwO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCBsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsIHRpbWVTdGF0ZSA9IG51bGwpIHtcbiAgICAvLyBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZSBnZW9tZXRyeSBwZXIgbGF5ZXIsIHNvIHRoZSB0aW1lIHNsaWRlciBpbmNsdWRlc1xuICAgIC8vIG9yIGV4Y2x1ZGVzIHRoZW0gd2hvbGUuIFBvaW50cyBjYXJyeSBwZXItZmVhdHVyZSB0aW1lcyBhbmQgZmlsdGVyIGluc2lkZSB0aGVpciBsb29wLlxuICAgIGlmICh0aW1lU3RhdGUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiKSB7XG4gICAgICAgIGxheWVyc0xpc3QgPSBsYXllcnNMaXN0LmZpbHRlcihsID0+IGxheWVySW5XaW5kb3cobCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpO1xuICAgICAgICBpZiAobGF5ZXJzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5bGluZVwiKSB7XG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICAgICAgY29uc3QgZ2VvanNvbkNvb3JkcyA9IGxheWVyLmxvY2F0aW9ucy5tYXAoYyA9PiBbY1sxXSwgY1swXV0pO1xuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XG4gICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcbiAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkxpbmVTdHJpbmdcIixcbiAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IGdlb2pzb25Db29yZHNcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5nbExpbmVzID0gTC5nbGlmeS5saW5lcyh7XG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogZ2VvanNvbixcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5bGluZXNQYW5lXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLndlaWdodDtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdHRlbiBiYXJlOiBzaGlueXdpZGdldHMnIG1vZGVsIGhhcyBubyBgY29tbWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvcGVydHksIHNvIGdhdGluZyBvbiBpdCBzaWxlbnRseSBraWxsZWQgdGhpc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB3cml0ZWJhY2sgdW5kZXIgU2hpbnkuIFRoZSBzaWRlYmFyIGFsd2F5cyB3cm90ZSBiYXJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB3YXMgdGhlIG9uZSBwYXRoIHRoYXQgd29ya2VkIHRoZXJlLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBsYXllci5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsTGluZXMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsTGluZXMpIHRoaXMuZ2xMaW5lcy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgICAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWdvblwiKSB7XG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICAgICAgbGV0IGdlb2pzb25Db29yZHMgPSBbXTtcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIikge1xuICAgICAgICAgICAgICAgIGdlb2pzb25Db29yZHMgPSBsYXllci5sb2NhdGlvbnMubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICAgICAgICAgICAgICBpZiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpcnN0ID0gZ2VvanNvbkNvb3Jkc1swXTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFzdCA9IGdlb2pzb25Db29yZHNbZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZpcnN0WzBdICE9PSBsYXN0WzBdIHx8IGZpcnN0WzFdICE9PSBsYXN0WzFdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBnZW9qc29uQ29vcmRzLnB1c2goW2ZpcnN0WzBdLCBmaXJzdFsxXV0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XG4gICAgICAgICAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XG4gICAgICAgICAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcbiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3TGF0ID0gbGF0ICsgKGRMYXQgKiAxODApIC8gTWF0aC5QSTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3TG9uID0gbG9uICsgKGRMb24gKiAxODApIC8gTWF0aC5QSTtcbiAgICAgICAgICAgICAgICAgICAgZ2VvanNvbkNvb3Jkcy5wdXNoKFtuZXdMb24sIG5ld0xhdF0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGdlb2pzb25Db29yZHMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblxuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XG4gICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcbiAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIlBvbHlnb25cIixcbiAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IFtnZW9qc29uQ29vcmRzXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLmZpbGxPcGFjaXR5IHx8IDAuMiB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5nbFNoYXBlcyA9IEwuZ2xpZnkuc2hhcGVzKHtcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXcml0dGVuIGJhcmU6IHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vIGBjb21tYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHdhcyB0aGUgb25lIHBhdGggdGhhdCB3b3JrZWQgdGhlcmUuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xTaGFwZXMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsU2hhcGVzKSB0aGlzLmdsU2hhcGVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XG4gICAgY29uc3QgaW5kZXhNYXBwaW5nID0gW107XG5cbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xuICAgIC8vIGdsaWZ5J3MgZmFsbGJhY2sgd2hlbiBhIGxheWVyIGRlY2xhcmVzIG5vIHJhZGl1cy4gUGlucyBuZWVkIGZhciBtb3JlIHJvb20gdGhhbiBhXG4gICAgLy8gY2lyY2xlIGJlY2F1c2UgdGhlIGdseXBoIGlzIGRyYXduIGluc2lkZSB0aGUgcG9pbnQncyBvd24gcXVhZCBieSB0aGUgc2hhZGVyLlxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgY29sb3JSR0IgPSBwYXJzZUNvbG9yKGxheWVyLmNvbG9yLCBmYWxsYmFja0NvbG9yKTtcbiAgICAgICAgY29uc3QgbGF5ZXJTaXplID0gbGF5ZXIucmFkaXVzICE9IG51bGwgPyBOdW1iZXIobGF5ZXIucmFkaXVzKSA6IGRlZmF1bHRTaXplO1xuXG4gICAgICAgIGNvbnN0IGNvb3JkQnVmZmVyID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICBpZiAoIWNvb3JkQnVmZmVyKSB7XG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2xheWVyLmxvY2F0aW9uWzBdLCBsYXllci5sb2NhdGlvblsxXV0pO1xuICAgICAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiAwLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3JSR0IsXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnVmZmVyLFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZU9mZnNldCxcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGNvdW50ID0gY29vcmRzLmxlbmd0aCAvIDI7XG5cbiAgICAgICAgY29uc3QgcGVyRmVhdHVyZSA9IEFycmF5LmlzQXJyYXkobGF5ZXIuZmVhdHVyZV9zdHlsZXMpID8gbGF5ZXIuZmVhdHVyZV9zdHlsZXMgOiBudWxsO1xuICAgICAgICAvLyBTZWxlY3Rpb24gc3R5bGluZywgYXBwbGllZCBvdmVyIHRoZSBsYXllcidzIG93biBhbmQgaXRzIGRhdGEtZHJpdmVuIHN0eWxlcy5cbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cbiAgICAgICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlIHx8IG51bGw7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlcyA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyB8fCBudWxsO1xuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxuICAgICAgICAvLyBzaW1wbHkgbm90IHB1c2hlZDsgaW5kZXhNYXBwaW5nIGNhcnJpZXMgb3JpZ2luYWxJbmRleCwgc28gcG9wdXBzIGFuZCBwcm9wZXJ0aWVzXG4gICAgICAgIC8vIG9uIHRoZSBzdXJ2aXZvcnMga2VlcCBwb2ludGluZyBhdCB0aGUgcmlnaHQgcm93cy5cbiAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcbiAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZClcbiAgICAgICAgICAgIDogbnVsbDtcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBmcm9tRGF0YSA9IHBlckZlYXR1cmUgPyBwZXJGZWF0dXJlW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gb3ZlcnJpZGVzID8gb3ZlcnJpZGVzW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChmcm9tRGF0YSAmJiBmcm9tRGF0YS5jb2xvcik7XG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xuICAgICAgICAgICAgICAgIDogaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5yYWRpdXMgIT0gbnVsbCA/IGhpZ2hsaWdodC5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IGZyb21EYXRhICYmIGZyb21EYXRhLnJhZGl1cyAhPSBudWxsID8gZnJvbURhdGEucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2Nvb3Jkc1tpICogMl0sIGNvb3Jkc1tpICogMiArIDFdXSk7XG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XG4gICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IGksXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcikgOiBjb2xvclJHQixcbiAgICAgICAgICAgICAgICBzaXplOiByYWRpdXMgIT0gbnVsbCA/IE51bWJlcihyYWRpdXMpIDogbGF5ZXJTaXplXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb2ludHNMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3QgZ2V0SW50ZXJhY3RpdmVFbCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICBjb25zdCBnbGlmeU9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXG4gICAgICAgICAgICAgICAgcGFuZTogXCJwb2ludHNQYW5lXCIsXG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZWQgcGVyIHBvaW50LCBsaWtlIGNvbG91cjogc2V2ZXJhbCBsYXllcnMgc2hhcmUgb25lIGdsaWZ5IGluc3RhbmNlLFxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cbiAgICAgICAgICAgICAgICBzaXplOiAoaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gPyBpbmZvLmNvbG9yUkdCIDogeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlbnNpdGl2aXR5OiB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDIwIDogOCxcbiAgICAgICAgICAgICAgICBjbGljazogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHBvcHVwcyBvbiBmYXIgYXdheSBjbGlja3NcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gY2xpY2tQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBvaW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaG92ZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoTC5sYXRMbmcocG9pbnRbMF0sIHBvaW50WzFdKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaXhlbERpc3QgPiBtYXhEaXN0KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gZ2V0SW50ZXJhY3RpdmVFbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gaW5mby5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBwb2ludCwgcHJvcHMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy5mcmFnbWVudFNoYWRlclNvdXJjZSA9ICgpID0+IHBpblNoYWRlcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5nbFBvaW50cyA9IEwuZ2xpZnkucG9pbnRzKGdsaWZ5T3B0aW9ucyk7XG4gICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsUG9pbnRzKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5nbFBvaW50cykgdGhpcy5nbFBvaW50cy5yZW1vdmUoKTtcbiAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIGNvbnN0IGNhbnZhcyA9IG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xuICAgICAgICAgICAgaWYgKGNhbnZhcykgY2FudmFzLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgIHJldHVybiBpbnN0YW5jZTtcbn1cbiIsICJpbXBvcnQgeyBsb2FkQ1NTLCBsb2FkSlMgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyU2lkZWJhckNvbnRyb2xzLCBub3JtYWxpemVSYWRpb0xheWVycyB9IGZyb20gXCIuL3NpZGViYXIuanNcIjtcbmltcG9ydCB7IHJlbmRlckxheWVyLCByZW5kZXJNZXJnZWRHbExheWVyIH0gZnJvbSBcIi4vbGF5ZXJzLmpzXCI7XG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgZ2VuZXJhdGVUaWNrcywgY29sbGVjdFRpbWVFeHRlbnQsIGhhc1RpbWVMYXllcnMsXG4gICAgICAgICBsYXllckluV2luZG93LCByZW5kZXJUaW1lQ29udHJvbCwgYWR2YW5jZSwgcGVyaW9kVG9NcywgZ2NkR3JpZE1zLFxuICAgICAgICAgY29sbGVjdER1cmF0aW9uc01zIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcblxuLy8gVHJ1ZSBpZiBhIGxheWVyIGlzIHZpc2libGUgYW5kIG5vIGZvbGRlciBhYm92ZSBpdCBpcyBzd2l0Y2hlZCBvZmYuXG4vL1xuLy8gVmlzaWJpbGl0eSBpcyBpbmhlcml0ZWQgZG93biB0aGUgZm9sZGVyIHBhdGg6IGEgbGF5ZXIgaW5zaWRlIFwiRmVlZHMvQWN0aXZlXCIgaXMgaGlkZGVuXG4vLyB3aGVuIGVpdGhlciBcIkZlZWRzXCIgb3IgXCJGZWVkcy9BY3RpdmVcIiBpcyBvZmYsIHJlZ2FyZGxlc3Mgb2YgaXRzIG93biBmbGFnLiBHZXR0aW5nIHRoaXNcbi8vIHdyb25nIHNob3dzIHVwIGFzIFwidGhhdCBsYXllciBqdXN0IHdpbGwgbm90IGFwcGVhclwiLCB3aXRoIG5vdGhpbmcgbG9nZ2VkLlxuZXhwb3J0IGZ1bmN0aW9uIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpIHtcbiAgICBpZiAobGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xuICAgIGZvciAoY29uc3QgcGFydCBvZiAobGF5ZXIubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIikuc3BsaXQoXCIvXCIpKSB7XG4gICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xuICAgICAgICBjb25zdCBjb25maWcgPSBncm91cENvbmZpZ3NbcnVubmluZ1BhdGhdO1xuICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gU29ydHMgdGhlIHZpc2libGUgbGF5ZXJzIGludG8gb25lIGJ1Y2tldCBwZXIgV2ViR0wgZHJhdyBwYXNzLlxuLy9cbi8vIFN1Yi1sYXllcnMgb2YgYSBtZXJnZWQgZ3JvdXAgaW5oZXJpdCB0aGVpciBwYXJlbnQncyB2aXNpYmlsaXR5IHJhdGhlciB0aGFuIGNhcnJ5aW5nXG4vLyB0aGVpciBvd24sIHNvIGEgZ3JvdXAgdG9nZ2xlZCBvZmYgY29udHJpYnV0ZXMgbm90aGluZyBldmVuIHdoZW4gaXRzIGNoaWxkcmVuIHNheVxuLy8gdmlzaWJsZS4gQ2lyY2xlcyBqb2luIHRoZSBwb2x5Z29uIGJ1Y2tldDogdGhleSBhcmUgZHJhd24gYXMgZ2VuZXJhdGVkIHJpbmdzLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xuICAgIGNvbnN0IGJ1Y2tldHMgPSB7IGNpcmNsZV9tYXJrZXJzOiBbXSwgbWFya2VyczogW10sIHBvbHlsaW5lOiBbXSwgcG9seWdvbjogW10gfTtcblxuICAgIGZ1bmN0aW9uIGNvbGxlY3QobGF5ZXIsIHBhcmVudFZpc2libGUsIGlzU3ViTGF5ZXIpIHtcbiAgICAgICAgaWYgKCFwYXJlbnRWaXNpYmxlKSByZXR1cm47XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gY29sbGVjdChzdWIsIHBhcmVudFZpc2libGUsIHRydWUpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWlzU3ViTGF5ZXIgJiYgbGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybjtcblxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xuICAgICAgICBpZiAoYnVja2V0c1tidWNrZXRdKSBidWNrZXRzW2J1Y2tldF0ucHVzaChsYXllcik7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgY29sbGVjdChsYXllciwgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyksIGZhbHNlKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ1Y2tldHM7XG59XG5cbi8vIEFwcGxpZXMgaW5jcmVtZW50YWwgcGF0Y2ggb3BzIHRvIHtsYXllcnMsIGJ1ZmZlcnN9LCByZXR1cm5pbmcgdGhlIG5ldyBzdGF0ZS5cbi8vXG4vLyBPcHMgYXJlIGFkZHJlc3NlZCBieSBsYXllciBpZCBhbmQgYXBwbGllZCBpZGVtcG90ZW50bHk6IFwiYWRkXCIgdXBzZXJ0cyByYXRoZXIgdGhhblxuLy8gYXBwZW5kaW5nIGJsaW5kbHksIHNvIGEgcGF0Y2ggdGhhdCByYWNlcyB0aGUgaW5pdGlhbCB0cmFpdCBzbmFwc2hvdCBjYW5ub3QgZHVwbGljYXRlXG4vLyBhIGxheWVyLCBhbmQgYSBcInJlbW92ZVwiIGZvciBzb21ldGhpbmcgYWxyZWFkeSBnb25lIGlzIGEgbm8tb3AuXG4vLyBBcHBsaWVzIGB1cGRhdGVgIHRvIG9uZSBsYXllciB3aGVyZXZlciBpdCBzaXRzLCBkZXNjZW5kaW5nIGludG8gZ3JvdXBzLiBhZGRfY29sbGVjdGlvblxuLy8gbmVzdHMgaXRzIHBvaW50LCBsaW5lIGFuZCBwb2x5Z29uIGxheWVycyBpbnNpZGUgYSBncm91cCBsYXllciwgc28gYW4gb3AgYWRkcmVzc2VkIGF0IGFcbi8vIG5lc3RlZCBpZCB3b3VsZCBvdGhlcndpc2UgbWF0Y2ggbm90aGluZyBhbmQgc2lsZW50bHkgZG8gbm90aGluZy4gUmV0dXJucyB0aGUgb3JpZ2luYWxcbi8vIGFycmF5IHVudG91Y2hlZCB3aGVuIHRoZSBpZCBpcyBub3QgZm91bmQsIHNvIGFuIHVubWF0Y2hlZCBvcCBjb3N0cyBubyByZS1yZW5kZXIuXG5mdW5jdGlvbiB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBpZCwgdXBkYXRlKSB7XG4gICAgbGV0IGhpdCA9IGZhbHNlO1xuICAgIGNvbnN0IG5leHQgPSBsYXllcnMubWFwKGwgPT4ge1xuICAgICAgICBpZiAobC5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgIGhpdCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm4gdXBkYXRlKGwpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBBcnJheS5pc0FycmF5KGwubGF5ZXJzKSkge1xuICAgICAgICAgICAgY29uc3Qgc3VicyA9IHVwZGF0ZUxheWVyQnlJZChsLmxheWVycywgaWQsIHVwZGF0ZSk7XG4gICAgICAgICAgICBpZiAoc3VicyAhPT0gbC5sYXllcnMpIHtcbiAgICAgICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IC4uLmwsIGxheWVyczogc3VicyB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBsO1xuICAgIH0pO1xuICAgIHJldHVybiBoaXQgPyBuZXh0IDogbGF5ZXJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTd2lmdG1hcFBhdGNoKHN0YXRlLCBvcHMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbGF5ZXJzID0gc3RhdGUubGF5ZXJzIHx8IFtdO1xuICAgIGxldCBidWZmZXJNYXAgPSBzdGF0ZS5idWZmZXJzIHx8IHt9O1xuXG4gICAgZm9yIChjb25zdCBvcCBvZiBvcHMpIHtcbiAgICAgICAgaWYgKG9wLm9wID09PSBcInNuYXBzaG90XCIpIHtcbiAgICAgICAgICAgIGxheWVycyA9IG9wLmxheWVycyB8fCBbXTtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHt9O1xuICAgICAgICAgICAgKG9wLmJ1ZmZlcl9pZHMgfHwgW10pLmZvckVhY2goKGlkLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcnMgJiYgYnVmZmVyc1tpXSkgYnVmZmVyTWFwW2lkXSA9IGJ1ZmZlcnNbaV07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJhZGRcIiB8fCBvcC5vcCA9PT0gXCJyZXBsYWNlXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGluY29taW5nID0gb3AubGF5ZXI7XG4gICAgICAgICAgICBjb25zdCBpZCA9IGluY29taW5nID8gaW5jb21pbmcuaWQgOiBvcC5pZDtcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IGxheWVycy5maW5kSW5kZXgobCA9PiBsLmlkID09PSBpZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IFsuLi5sYXllcnMsIGluY29taW5nXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLm1hcCgobCwgaSkgPT4gKGkgPT09IGlkeCA/IGluY29taW5nIDogbCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInNldFwiKSB7XG4gICAgICAgICAgICAvLyBGaWVsZC1sZXZlbCB1cGRhdGUuIFwicmVwbGFjZVwiIGNhcnJpZXMgdGhlIHdob2xlIGxheWVyLCBzbyBmbGlwcGluZyBgdmlzaWJsZWBcbiAgICAgICAgICAgIC8vIG9uIGEgNTBrLXBvaW50IGxheWVyIHJlc2VudCBldmVyeSBwcm9wZXJ0eSBpdCBob2xkcyAtLSBoYWxmIGEgbWVnYWJ5dGUgdG9cbiAgICAgICAgICAgIC8vIGNoYW5nZSBvbmUgYm9vbGVhbiwgb24gZXZlcnkgY2xpY2sgb2YgYSBjaGVja2JveC5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7IC4uLmwsIC4uLihvcC5maWVsZHMgfHwge30pIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzdHlsZVwiKSB7XG4gICAgICAgICAgICAvLyBQZXItZmVhdHVyZSBzdHlsZSBvdmVycmlkZXMsIHJlcGxhY2VkIHdob2xlc2FsZSByYXRoZXIgdGhhbiBtZXJnZWQ6IGFcbiAgICAgICAgICAgIC8vIHNlbGVjdGlvbiBkZXNjcmliZXMgaXRzIGNvbXBsZXRlIHN0YXRlLCBzbyBzZW5kaW5nIHt9IGNsZWFycyBpdCBhbmQgbm9cbiAgICAgICAgICAgIC8vIGNhbGxlciBoYXMgdG8gdHJhY2sgd2hhdCB0aGUgcHJldmlvdXMgaGlnaGxpZ2h0IHRvdWNoZWQuXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmwsIHN0eWxlX292ZXJyaWRlczogb3Aub3ZlcnJpZGVzIHx8IHt9LFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInJlbW92ZVwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBsYXllcnMuZmlsdGVyKGwgPT4gbC5pZCAhPT0gb3AuaWQpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlclwiKSB7XG4gICAgICAgICAgICBjb25zdCBidWYgPSBidWZmZXJzICYmIGJ1ZmZlcnNbb3AuYnVmZmVyX2luZGV4XTtcbiAgICAgICAgICAgIGlmIChidWYpIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwLCBbb3AuaWRdOiBidWYgfTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJfcmVtb3ZlXCIpIHtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwIH07XG4gICAgICAgICAgICBkZWxldGUgYnVmZmVyTWFwW29wLmlkXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7IGxheWVycywgYnVmZmVyczogYnVmZmVyTWFwIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgICBhc3luYyByZW5kZXIoeyBtb2RlbCwgZWwgfSkge1xuICAgICAgICBjb25zdCBvcmlnaW5hbEVycm9yID0gY29uc29sZS5lcnJvcjtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxXYXJuID0gY29uc29sZS53YXJuO1xuXG4gICAgICAgIC8vIGpzX2NvbnNvbGVfbG9ncyBpcyBhIHN5bmNlZCBsaXN0LCBzbyBlYWNoIGFwcGVuZCByZXNlbmRzIHRoZSB3aG9sZSBhcnJheS4gS2VlcGluZ1xuICAgICAgICAvLyBvbmx5IHRoZSBtb3N0IHJlY2VudCBlbnRyaWVzIGJvdW5kcyBib3RoIHRoZSBwYXlsb2FkIGFuZCB0aGUgbWVtb3J5IGEgbG9uZy1saXZlZFxuICAgICAgICAvLyBzZXNzaW9uIGFjY3VtdWxhdGVzOyB0aGUgbmV3ZXN0IGFyZSB0aGUgb25lcyB3b3J0aCBoYXZpbmcgYW55d2F5LlxuICAgICAgICBjb25zdCBNQVhfQ09OU09MRV9MT0dTID0gMjAwO1xuICAgICAgICBjb25zdCBhcHBlbmRMb2cgPSBlbnRyeSA9PiB7XG4gICAgICAgICAgICBjb25zdCBsb2dzID0gbW9kZWwuZ2V0KFwianNfY29uc29sZV9sb2dzXCIpIHx8IFtdO1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IFsuLi5sb2dzLCBlbnRyeV07XG4gICAgICAgICAgICByZXR1cm4gbmV4dC5sZW5ndGggPiBNQVhfQ09OU09MRV9MT0dTID8gbmV4dC5zbGljZSgtTUFYX0NPTlNPTEVfTE9HUykgOiBuZXh0O1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEhlbHBlciB0byBzYWZlbHkgd3JpdGUgYmFjayB0byBQeXRob24gb25seSBpZiB0aGUgd2lkZ2V0IHZpZXcgaXMgYWN0aXZlIGFuZCBhdHRhY2hlZFxuICAgICAgICBmdW5jdGlvbiBzYWZlU2V0QW5kU2F2ZShrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyB3cml0ZSBlcnJvcjpcIiwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc2FmZVNhdmVDaGFuZ2VzKCkge1xuICAgICAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHNhdmUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IgPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBvcmlnaW5hbEVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIixcbiAgICAgICAgICAgICAgICBhcHBlbmRMb2coXCJDT05TT0xFLkVSUk9SOiBcIiArIGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKSkpO1xuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgbGV0IGxvZ2dlZFJlcHJvamVjdGVkID0gZmFsc2U7XG4gICAgICAgIGNvbnNvbGUud2FybiA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKTtcbiAgICAgICAgICAgIGlmIChtc2cuaW5jbHVkZXMoXCJsYXllciBkZXNpZ25lZCBmb3IgU3BoZXJpY2FsTWVyY2F0b3JcIikgfHwgbXNnLmluY2x1ZGVzKFwiYWx0ZXJuYXRlIGRldGVjdGVkXCIpKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFsb2dnZWRSZXByb2plY3RlZCkge1xuICAgICAgICAgICAgICAgICAgICBsb2dnZWRSZXByb2plY3RlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNycyA9IG1vZGVsLmdldChcImNyc1wiKSB8fCBcIkVQU0c6Mzg1N1wiO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGVhbk1zZyA9IGBbU3dpZnRNYXBdIExheWVyIHdhcyByZXByb2plY3RlZCB0byBcIiR7Y3JzfVwiYDtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgY2xlYW5Nc2cpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIiwgYXBwZW5kTG9nKGNsZWFuTXNnKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gc3VwcHJlc3MgZHVwbGljYXRlIGNvbnNvbGUgd2FybmluZ3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgfTtcblxuICAgICAgICB3aW5kb3cub25lcnJvciA9IGZ1bmN0aW9uKG1lc3NhZ2UsIHNvdXJjZSwgbGluZW5vLCBjb2xubywgZXJyb3IpIHtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKGBXSU5ET1cuT05FUlJPUjogJHttZXNzYWdlfSBhdCAke3NvdXJjZX06JHtsaW5lbm99OiR7Y29sbm99YCkpO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIExvYWQgQ1NTIGFuZCBMZWFmbGV0IGxpYnJhcmllcyAoaW5jbHVkaW5nIFdlYkdMIGdsaWZ5KVxuICAgICAgICBsb2FkQ1NTKFwibGVhZmxldC1jc3NcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5jc3NcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtanNcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5qc1wiKTtcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1nbGlmeVwiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXQuZ2xpZnlAMy4zLjAvZGlzdC9nbGlmeS1icm93c2VyLmpzXCIpO1xuXG4gICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGNvbnRhaW5lci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWNvbnRhaW5lclwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLmhlaWdodCA9IFwiMTAwJVwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUucG9zaXRpb24gPSBcInJlbGF0aXZlXCI7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKGNvbnRhaW5lcik7XG5cbiAgICAgICAgY29uc3QgY3JzTmFtZSA9IG1vZGVsLmdldChcImNyc1wiKTtcbiAgICAgICAgbGV0IG1hcENycyA9IEwuQ1JTLkVQU0czODU3O1xuICAgICAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xuICAgICAgICAgICAgbWFwQ3JzID0gTC5DUlMuRVBTRzQzMjY7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYXAgPSBMLm1hcChjb250YWluZXIsIHtcbiAgICAgICAgICAgIGNyczogbWFwQ3JzLFxuICAgICAgICAgICAgY2VudGVyOiBtb2RlbC5nZXQoXCJjZW50ZXJcIiksXG4gICAgICAgICAgICB6b29tOiBtb2RlbC5nZXQoXCJ6b29tXCIpLFxuICAgICAgICAgICAgc2Nyb2xsV2hlZWxab29tOiB0cnVlLFxuICAgICAgICAgICAgcHJlZmVyQ2FudmFzOiB0cnVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWdvbnNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlnb25zUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQxMFwiO1xuICAgICAgICBcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5bGluZXNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlsaW5lc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MjBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9pbnRzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDMwXCI7XG5cbiAgICAgICAgLy8gTG9jYWwgbWlycm9ycyBvZiB0aGUgbGF5ZXIgbGlzdCBhbmQgY29vcmRpbmF0ZSBidWZmZXJzLlxuICAgICAgICAvL1xuICAgICAgICAvLyBQeXRob24gdXBkYXRlcyB0aGVzZSBpbmNyZW1lbnRhbGx5IHZpYSBcInN3aWZ0bWFwX3BhdGNoXCIgbWVzc2FnZXMgaW5zdGVhZCBvZlxuICAgICAgICAvLyByZWFzc2lnbmluZyB0aGUgdHJhaXRzLCBiZWNhdXNlIGEgdHJhaXQgcmVhc3NpZ25tZW50IHJlLXNlcmlhbGl6ZXMgYW5kIHJlLXNlbmRzXG4gICAgICAgIC8vIHRoZSBlbnRpcmUgbWFwIG9uIGV2ZXJ5IG11dGF0aW9uLiBUaGUgdHJhaXRzIHN0aWxsIGNhcnJ5IHRoZSBpbml0aWFsIHNuYXBzaG90XG4gICAgICAgIC8vIHdoZW4gYSB2aWV3IGF0dGFjaGVzLCBhbmQgdGhlIHNpZGViYXIgc3RpbGwgd3JpdGVzIGBsYXllcnNgIGJhY2sgb24gdG9nZ2xlLCBzb1xuICAgICAgICAvLyBib3RoIGFyZSBzZWVkZWQgaGVyZSBhbmQga2VwdCBpbiBzdGVwIGJ5IHRoZSBjaGFuZ2UgaGFuZGxlcnMgZnVydGhlciBkb3duLlxuICAgICAgICBsZXQgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcbiAgICAgICAgbGV0IGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xuXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5UGF0Y2hPcHMob3BzLCBidWZmZXJzKSB7XG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gYXBwbHlTd2lmdG1hcFBhdGNoKHsgbGF5ZXJzOiBsYXllclN0YXRlLCBidWZmZXJzOiBidWZmZXJTdGF0ZSB9LCBvcHMsIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG5leHQubGF5ZXJzO1xuICAgICAgICAgICAgYnVmZmVyU3RhdGUgPSBuZXh0LmJ1ZmZlcnM7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY3RpdmVUaWxlTGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcbiAgICAgICAgY29uc3QgZ2xTdGF0ZXMgPSB7XG4gICAgICAgICAgICBjaXJjbGVfbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlsaW5lOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlnb246IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xuICAgICAgICAvLyBhbmQgdGhlIHBlcmlvZCwgb3IgbnVsbCB3aGVuIG5vdGhpbmcgaXMgYW5pbWF0ZWQgLS0gYW5kIGB0aW1lVUlgIGlzIHRoZSBzbGlkZXInc1xuICAgICAgICAvLyBvd24gYm9va2tlZXBpbmcuIFBsYXliYWNrIG5ldmVyIHJvdW5kLXRyaXBzIHRocm91Z2ggUHl0aG9uOiB0aWNrcyByZS1yZW5kZXJcbiAgICAgICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXG4gICAgICAgIGxldCB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICBjb25zdCB0aW1lVUkgPSB7IHRpY2tzOiBbXSwga2V5OiBcIlwiLCBpbmRleDogMCwgcGxheWluZzogZmFsc2UsIGxvb3A6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3c6IG51bGwsIHBlcmlvZE1zOiBudWxsLCBncmlkTXM6IG51bGwgfTtcblxuICAgICAgICBmdW5jdGlvbiBzdG9wUGxheWJhY2soKSB7XG4gICAgICAgICAgICBpZiAodGltZVVJLnRpbWVyKSBjbGVhckludGVydmFsKHRpbWVVSS50aW1lcik7XG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBudWxsO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHdyaXRlVGltZUN1cnJlbnQoZm9yY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICBpZiAoIWZvcmNlICYmIG5vdyAtIHRpbWVVSS5sYXN0V3JpdGUgPCAxMDAwKSByZXR1cm47XG4gICAgICAgICAgICB0aW1lVUkubGFzdFdyaXRlID0gbm93O1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ0aW1lX2N1cnJlbnRcIiwgdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzZWVrVG8oaW5kZXgsIHsgd3JpdGUgPSB0cnVlIH0gPSB7fSkge1xuICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSk7XG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2Q6IHRpbWVTdGF0ZS5wZXJpb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xuICAgICAgICAgICAgaWYgKHdyaXRlKSB3cml0ZVRpbWVDdXJyZW50KCF0aW1lVUkucGxheWluZyk7XG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzdGFydFBsYXliYWNrKCkge1xuICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICB0aW1lVUkucGxheWluZyA9IHRydWU7XG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFkdmFuY2UodGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoLCB0aW1lVUkubG9vcCk7XG4gICAgICAgICAgICAgICAgaWYgKCFuZXh0LnBsYXlpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2Vla1RvKG5leHQuaW5kZXgpO1xuICAgICAgICAgICAgfSwgMTAwMCAvIHRpbWVVSS5zcGVlZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0aW1lSGFuZGxlcnMgPSB7XG4gICAgICAgICAgICBvblNlZWs6IChpbmRleCkgPT4gc2Vla1RvKGluZGV4KSxcbiAgICAgICAgICAgIG9uU3RlcEJhY2s6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggLSAxKSxcbiAgICAgICAgICAgIG9uU3RlcEZvcndhcmQ6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggKyAxKSxcbiAgICAgICAgICAgIG9uUGxheVRvZ2dsZTogKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBzdGFydE92ZXIsIGFzIHRoZSBmb2xpdW0gcGxheWVyIHdhcyBjb25maWd1cmVkOiBwcmVzc2luZyBwbGF5IGF0XG4gICAgICAgICAgICAgICAgICAgIC8vIHRoZSBlbmQgcmVzdGFydHMgZnJvbSB0aGUgYmVnaW5uaW5nIGltbWVkaWF0ZWx5LCByYXRoZXIgdGhhbiBvbmVcbiAgICAgICAgICAgICAgICAgICAgLy8gc2lsZW50IGludGVydmFsIGxhdGVyIGRlY2lkaW5nIHRoZXJlIGlzIG5vd2hlcmUgdG8gZ28gYW5kIHN0b3BwaW5nLlxuICAgICAgICAgICAgICAgICAgICBpZiAodGltZVVJLmluZGV4ID49IHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSBzZWVrVG8oMCk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9ICF0aW1lVUkubG9vcDtcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uU3BlZWQ6IChzcGVlZCkgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IHNwZWVkO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIExpdmUgZHVyaW5nIHRoZSBkcmFnOiBsb2NhbCBzdGF0ZSBhbmQgYSByZS1yZW5kZXIgb2YgdGhlIGNvbnRyb2wgb24gZXZlcnlcbiAgICAgICAgICAgIC8vIG1vdmUsIGJ1dCBtYXAgcmVidWlsZHMgYXQgbW9zdCBldmVyeSAzMDBtcy4gQXQgNU0gcG9pbnRzIGEgcmVidWlsZCBjb3N0c1xuICAgICAgICAgICAgLy8gc2Vjb25kcywgYW5kIGEgZHJhZyBmaXJlcyBkb3plbnMgb2YgbW92ZXMgLS0gdW50aHJvdHRsZWQsIHRoZSByZWJ1aWxkc1xuICAgICAgICAgICAgLy8gc3RhY2sgZmFzdGVyIHRoYW4gdGhleSBmaW5pc2ggYW5kIHRoZSBhbGxvY2F0aW9uIGNodXJuIGNyYXNoZXMgdGhlIHRhYi5cbiAgICAgICAgICAgIG9uV2luZG93RHJhZzogKGlzbykgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aW1lVUkud2luZG93ID0gaXNvO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHRpbWVTdGF0ZSA9IHsgLi4udGltZVN0YXRlLCB3aW5kb3c6IGlzbyB9O1xuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICAgICAgICBpZiAobm93IC0gKHRpbWVVSS5sYXN0RHJhZ1N5bmMgfHwgMCkgPj0gMzAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5sYXN0RHJhZ1N5bmMgPSBub3c7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBPbiByZWxlYXNlIChvciBhIGtleWJvYXJkIHN0ZXApOiB0aGUgb3ZlcnJpZGUgbGFuZHMgaW4gdGltZV9jb25maWcgc29cbiAgICAgICAgICAgIC8vIFB5dGhvbiBhbmQgU2hpbnkgc2VlIHRoZSBzYW1lIHdpbmRvdyB0aGUgYmFyIHNob3dzLiBudWxsIGNsZWFycyB0aGUga2V5LFxuICAgICAgICAgICAgLy8gaGFuZGluZyBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbiAgICAgICAgICAgIG9uV2luZG93Q29tbWl0OiAoaXNvKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZUhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7ICAgICAgIC8vIHRoZSByZWxlYXNlIGFsd2F5cyBsYW5kcywgdGhyb3R0bGUgb3Igbm90XG4gICAgICAgICAgICAgICAgY29uc3QgY2ZnID0geyAuLi4obW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge30pIH07XG4gICAgICAgICAgICAgICAgaWYgKGlzbykgY2ZnLndpbmRvdyA9IGlzbztcbiAgICAgICAgICAgICAgICBlbHNlIGRlbGV0ZSBjZmcud2luZG93O1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInRpbWVfY29uZmlnXCIsIGNmZyk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBsb2NhbCBtb2RlbCBzdGlsbCBob2xkcyBpdCAqLyB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIENyZWF0ZXMsIHJldHVuZXMgb3IgcmVtb3ZlcyB0aGUgc2xpZGVyIHRvIG1hdGNoIHRoZSBsYXllcnMgcHJlc2VudC4gVGlja3MgYXJlXG4gICAgICAgIC8vIHJlZ2VuZXJhdGVkIG9ubHkgd2hlbiB0aGUgZGF0YSdzIHRpbWUgZXh0ZW50IG9yIHRoZSBwZXJpb2QgY2hhbmdlcywgc28gYVxuICAgICAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVUaW1lRGltZW5zaW9uKCkge1xuICAgICAgICAgICAgaWYgKCFoYXNUaW1lTGF5ZXJzKGxheWVyU3RhdGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHsgdGlja3M6IFtdIH0sIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBcIlwiO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XG4gICAgICAgICAgICBjb25zdCBleHRlbnQgPSBjb2xsZWN0VGltZUV4dGVudChsYXllclN0YXRlLCBidWZmZXJTdGF0ZSk7XG4gICAgICAgICAgICBpZiAoIWV4dGVudCkgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtleHRlbnQubWlufXwke2V4dGVudC5tYXh9fCR7Y2ZnLnBlcmlvZCB8fCBcIlAxRFwifWA7XG4gICAgICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IGtleTtcbiAgICAgICAgICAgICAgICB0aW1lVUkudGlja3MgPSBnZW5lcmF0ZVRpY2tzKGV4dGVudC5taW4sIGV4dGVudC5tYXgsIHBlcmlvZCk7XG4gICAgICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5taW4odGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFRoZSBzaGFyZWQgd2luZG93IG92ZXJyaWRlLCBjb25maWctZHJpdmVuOyBhIGJhZCBzdHJpbmcgY2xlYXJzIHJhdGhlciB0aGFuXG4gICAgICAgICAgICAvLyBndWVzc2luZy4gVGhlIGRyYWcgZ3JpZCBpcyB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWRcbiAgICAgICAgICAgIC8vIGR1cmF0aW9uIC0tIHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBhbGwgb2YgdGhlbSAtLSBzbyBhIDIuNWggdHJhaWxcbiAgICAgICAgICAgIC8vIGlzIGRyYWdnYWJsZSBvbiBhIDFoIGJhci4gQ2FsZW5kYXIgcGVyaW9kcyBoYXZlIG5vIGZpeGVkIHdpZHRoOyB0aGUgcnVsZXJcbiAgICAgICAgICAgIC8vIHRoZW4gc2hvd3MgaW50ZXJ2YWwgbWFya3Mgb25seSBhbmQgdGhlIHRyYWlsIGhhbmRsZSBoaWRlcy5cbiAgICAgICAgICAgIC8vIE5ldmVyIHdoaWxlIGEgZHJhZyBpcyBsaXZlOiB0aGUgZHJhZ2dlZCB3aW5kb3cgZXhpc3RzIG9ubHkgbG9jYWxseSB1bnRpbFxuICAgICAgICAgICAgLy8gcmVsZWFzZSBjb21taXRzIGl0LCBhbmQgcmVhZGluZyBjb25maWcgaGVyZSBtaWQtZHJhZyByZXNldCB0aGUgaGFuZGxlIHRvXG4gICAgICAgICAgICAvLyBcIm5vIHdpbmRvd1wiIG9uIGV2ZXJ5IGRlYm91bmNlZCBzeW5jIC0tIHRoZSBoYW5kbGUgZm9sbG93ZWQgdGhlIG1vdXNlLCB0aGVuXG4gICAgICAgICAgICAvLyBzbmFwcGVkIGhvbWUsIHRoZW4gZm9sbG93ZWQgYWdhaW4sIG9uY2UgcGVyIHN5bmMuXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5kcmFnQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGNmZy53aW5kb3cgJiYgcGFyc2VQZXJpb2QoY2ZnLndpbmRvdykgPyBjZmcud2luZG93IDogbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRpbWVVSS5wZXJpb2RNcyA9IHBlcmlvZFRvTXMocGVyaW9kKTtcbiAgICAgICAgICAgIHRpbWVVSS5ncmlkTXMgPSB0aW1lVUkucGVyaW9kTXNcbiAgICAgICAgICAgICAgICA/IGdjZEdyaWRNcyh0aW1lVUkucGVyaW9kTXMsIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllclN0YXRlLCB0aW1lVUkud2luZG93KSlcbiAgICAgICAgICAgICAgICA6IG51bGw7XG5cbiAgICAgICAgICAgIHRpbWVTdGF0ZSA9IHsgdGljazogdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0sIHBlcmlvZCwgd2luZG93OiB0aW1lVUkud2luZG93IH07XG4gICAgICAgICAgICB0aW1lVUkucG9zaXRpb24gPSBjZmcucG9zaXRpb24gfHwgXCJ0b3AtY2VudGVyXCI7XG5cbiAgICAgICAgICAgIGlmICghdGltZVVJLnN0YXJ0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gY2ZnLnNwZWVkIHx8IDE7XG4gICAgICAgICAgICAgICAgdGltZVVJLmxvb3AgPSBCb29sZWFuKGNmZy5sb29wKTtcbiAgICAgICAgICAgICAgICAvLyBPbmx5IHRoZSBmaXJzdCBjb25maWd1cmF0aW9uIG1heSBhdXRvLXN0YXJ0LiBFdmVyeSBjb25maWcgY2hhbmdlIHJlc2V0c1xuICAgICAgICAgICAgICAgIC8vIGBzdGFydGVkYCB0byByZS1yZWFkIHNwZWVkIGFuZCBsb29wIC0tIGluY2x1ZGluZyB0aGUgY2hhbmdlIGEgd2luZG93XG4gICAgICAgICAgICAgICAgLy8gZHJhZyBjb21taXRzIC0tIGFuZCByZS1ydW5uaW5nIGF1dG9fcGxheSB0aGVyZSB3b3VsZCBzdGFydCBwbGF5YmFjayBhc1xuICAgICAgICAgICAgICAgIC8vIGEgc2lkZSBlZmZlY3Qgb2YgcmVsZWFzaW5nIHRoZSBoYW5kbGUuXG4gICAgICAgICAgICAgICAgaWYgKGNmZy5hdXRvX3BsYXkgJiYgIXRpbWVVSS5ldmVyU3RhcnRlZCkgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5ldmVyU3RhcnRlZCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2lkZWJhciBMYXllcnMgQ29udHJvbCBVSVxuICAgICAgICBjb25zdCBzaWRlYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgc2lkZWJhci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXNpZGViYXJcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS50b3AgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUubWF4SGVpZ2h0ID0gXCI4MCVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250RmFtaWx5ID0gXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTZWdvZSBVSScsIFJvYm90bywgc2Fucy1zZXJpZlwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHNpZGViYXIpO1xuXG4gICAgICAgIC8vIExvZ29cbiAgICAgICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm90dG9tID0gXCIxMHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBsb2dvRGl2LmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyO1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZS5wbmdcIiBhbHQ9XCJDb21wYW55XCIgc3R5bGU9XCJoZWlnaHQ6IDM1cHg7IG1hcmdpbi1yaWdodDogNXB4O1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZTIucG5nXCIgYWx0PVwiUGFyZW50IENvbXBhbnlcIiBzdHlsZT1cImhlaWdodDogMzVweDtcIj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICBgO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobG9nb0Rpdik7XG5cblxuXG4gICAgICAgIGZ1bmN0aW9uIGdldFRpbGVMYXllcihsYXllcikge1xuICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyKGxheWVyLnVybCwge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0aW9uOiBsYXllci5hdHRyaWJ1dGlvbiB8fCAnJyxcbiAgICAgICAgICAgICAgICBtYXhab29tOiBsYXllci5tYXhfem9vbSB8fCAyMixcbiAgICAgICAgICAgICAgICBtYXhOYXRpdmVab29tOiBsYXllci5tYXhfbmF0aXZlX3pvb20gfHwgMTlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY01hcFN0YXRlKCkge1xuICAgICAgICAgICAgY29uc29sZS50aW1lKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XG4gICAgICAgICAgICB1cGRhdGVUaW1lRGltZW5zaW9uKCk7XG4gICAgICAgICAgICBjb25zdCBsYXllcnMgPSBsYXllclN0YXRlO1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBDb25maWdzID0gbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gYnVmZmVyU3RhdGU7XG5cbiAgICAgICAgICAgIC8vIEVuZm9yY2UgbXV0dWFsbHkgZXhjbHVzaXZlIHJhZGlvIGdyb3VwIHZpc2liaWxpdHkgYmVmb3JlIGNvbGxlY3Rpbmcgb3IgcmVuZGVyaW5nIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgY29uc3QgcmFkaW9DaGFuZ2VkID0gbm9ybWFsaXplUmFkaW9MYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgaWYgKHJhZGlvQ2hhbmdlZCAmJiBkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImxheWVyc1wiLCBbLi4ubGF5ZXJzXSk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBtb2RlbC5nZXQoXCJzaG93X2xvZ29cIikgPyBcImJsb2NrXCIgOiBcIm5vbmVcIjtcblxuICAgICAgICAgICAgLy8gR3JvdXAgdmlzaWJsZSBsYXllcnMgKGluY2x1ZGluZyBzdWItbGF5ZXJzIGluc2lkZSBncm91cHMpIHRvIGFsd2F5cyB1c2UgV2ViR0xcbiAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgICBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWxpbmU6IHdlYmdsUG9seWxpbmVMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzLFxuICAgICAgICAgICAgfSA9IGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XG5cbiAgICAgICAgICAgIC8vIFNldCBvZiBsYXllciBJRHMgcHJvY2Vzc2VkIHZpYSBtZXJnZWQgV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBjb25zdCB3ZWJnbExheWVySWRzID0gbmV3IFNldChbXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5bGluZUxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlnb25MYXllcnMubWFwKGwgPT4gbC5pZClcbiAgICAgICAgICAgIF0pO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgcmV0aXJlZCBvdmVybGF5IGxheWVycywgaW5jbHVkaW5nIHRob3NlIHRoYXQgdHJhbnNpdGlvbmVkIHRvIFdlYkdMXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhhY3RpdmVPdmVybGF5TGF5ZXJzKS5mb3JFYWNoKGlkID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpIHx8IHdlYmdsTGF5ZXJJZHMuaGFzKGlkKSkge1xuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBQcm9jZXNzIG5vbi1XZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcImJhc2VtYXBcIikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZWZmZWN0aXZlVmlzaWJsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGlsZSA9IGdldFRpbGVMYXllcihsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGlsZS5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0gPSB0aWxlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIFNraXAgbGF5ZXJzIG1hbmFnZWQgYnkgdGhlIG1lcmdlZCBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgICAgICBpZiAod2ViZ2xMYXllcklkcy5oYXMobGF5ZXIuaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZWZmZWN0aXZlVmlzaWJsZSB8fCAhbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVyU3RhdGUsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nLmxheWVyVHlwZSAhPT0gbGF5ZXIudHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdID0gaW5zdGFuY2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBIZWxwZXIgdG8gc3luYyBXZWJHTCBsYXllciBzdGF0ZXMgYW5kIHJlYnVpbGQgb25seSBpZiBjaGFuZ2VkXG4gICAgICAgICAgICBhc3luYyBmdW5jdGlvbiBzeW5jR2xMYXllcih0eXBlLCB2aXNpYmxlTGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRzU3RyaW5nID0gdmlzaWJsZUxheWVycy5tYXAobCA9PiBsLmlkKS5zb3J0KCkuam9pbihcIixcIik7XG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyB0aGUgYnVpbHQgYnVmZmVycyBkZXBlbmQgb24gYmVsb25ncyBpbiB0aGlzIGtleTogYSBjaGFuZ2UgdGhhdFxuICAgICAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXG4gICAgICAgICAgICAgICAgLy8gbWlzc2luZyBhdCBmaXJzdCwgc28gYSBoaWdobGlnaHQgbGFuZGVkIGluIHN0YXRlIGFuZCBuZXZlciByZXBhaW50ZWQuXG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHZpc2libGVMYXllcnMubWFwKGwgPT4gKHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGwuaWQsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBsLmNvbG9yLFxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IGwucmFkaXVzLFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IGwud2VpZ2h0LFxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiBsLm9wYWNpdHksXG4gICAgICAgICAgICAgICAgICAgIGZpbGxPcGFjaXR5OiBsLmZpbGxPcGFjaXR5LFxuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHQ6IGwuaGlnaGxpZ2h0X3N0eWxlLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZXM6IGwuc3R5bGVfb3ZlcnJpZGVzLFxuICAgICAgICAgICAgICAgICAgICBmZWF0dXJlU3R5bGVzOiBsLmZlYXR1cmVfc3R5bGVzLFxuICAgICAgICAgICAgICAgICAgICB0aW1lOiBsLnRpbWUsXG4gICAgICAgICAgICAgICAgICAgIHRpY2s6IGwudGltZSAmJiB0aW1lU3RhdGUgPyB0aW1lU3RhdGUudGljayA6IDAsXG4gICAgICAgICAgICAgICAgICAgIHdpbjogbC50aW1lICYmIHRpbWVTdGF0ZSA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBidWZMZW46IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdPy5ieXRlTGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGxvY0xlbjogbC5sb2NhdGlvbnM/Lmxlbmd0aCB8fCAwXG4gICAgICAgICAgICAgICAgfSkpKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGVDaGFuZ2VkID0gc3RhdGUuaWRzICE9PSBpZHNTdHJpbmcgfHwgc3RhdGUubWV0YSAhPT0gbWV0YVN0cmluZztcblxuICAgICAgICAgICAgICAgIGlmIChzdGF0ZUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAodmlzaWJsZUxheWVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IGF3YWl0IHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCB2aXNpYmxlTGF5ZXJzLCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsIHRpbWVTdGF0ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLmlkcyA9IGlkc1N0cmluZztcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubWV0YSA9IG1ldGFTdHJpbmc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcImNpcmNsZV9tYXJrZXJzXCIsIHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwibWFya2Vyc1wiLCB3ZWJnbE1hcmtlckxheWVycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlsaW5lXCIsIHdlYmdsUG9seWxpbmVMYXllcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5Z29uXCIsIHdlYmdsUG9seWdvbkxheWVycyk7XG5cbiAgICAgICAgICAgIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsICgpID0+IHtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zb2xlLnRpbWVFbmQoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICBsZXQgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XG5cbiAgICAgICAgLy8gQmluZCB6b29tIGFuZCBjZW50ZXIgY2hhbmdlcyBiYWNrIHRvIFB5dGhvbiBzYWZlbHlcbiAgICAgICAgbWFwLm9uKFwibW92ZWVuZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50Wm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxDZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxab29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1vZGVsWm9vbSAhPT0gY3VycmVudFpvb207XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9ICFtb2RlbENlbnRlciB8fCBcbiAgICAgICAgICAgICAgICAgICAgIUFycmF5LmlzQXJyYXkobW9kZWxDZW50ZXIpIHx8XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsQ2VudGVyLmxlbmd0aCA8IDIgfHxcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMF0gLSBjZW50ZXIubGF0KSA+IDAuMDAwMSB8fCBcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMV0gLSBjZW50ZXIubG5nKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjZW50ZXJcIiwgW2NlbnRlci5sYXQsIGNlbnRlci5sbmddKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInpvb21cIiwgY3VycmVudFpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBzYWZlU2F2ZUNoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gbW92ZWVuZCBoYW5kbGVyOlwiLCBlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVNYXBWaWV3KCkge1xuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xuICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICBpZiAoY2VudGVyICYmIEFycmF5LmlzQXJyYXkoY2VudGVyKSAmJiBjZW50ZXIubGVuZ3RoID49IDIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBDZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWFwWm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9IE1hdGguYWJzKG1hcENlbnRlci5sYXQgLSBjZW50ZXJbMF0pID4gMC4wMDAxIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtYXBDZW50ZXIubG5nIC0gY2VudGVyWzFdKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1hcFpvb20gIT09IHpvb207XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFZpZXcoY2VudGVyLCB0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiA/IHpvb20gOiBtYXBab29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiAmJiBtYXAuZ2V0Wm9vbSgpICE9PSB6b29tKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKHpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdhdGNoIGZvciBtYXAgdmlldyB1cGRhdGVzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNlbnRlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ0NlbnRlckZyb21NYXApIHtcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnpvb21cIiwgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVXBkYXRpbmdab29tRnJvbU1hcCkge1xuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIEZpdHRpbmcgdGhlIHZpZXcgaXMgYSBjb21tYW5kLCBub3Qgc3RhdGU6IGFza2luZyB0byBmaXQgdGhlIHNhbWUgYm91bmRzIHR3aWNlXG4gICAgICAgIC8vIG11c3QgbW92ZSB0aGUgbWFwIGJvdGggdGltZXMsIHNpbmNlIHRoZSB1c2VyIG1heSBoYXZlIHBhbm5lZCBhd2F5IGluIGJldHdlZW4uXG4gICAgICAgIC8vIFRoZSByZXF1ZXN0IGNhcnJpZXMgYSBzZXF1ZW5jZSBudW1iZXIgc28gYW4gaWRlbnRpY2FsIGZpdCBzdGlsbCBmaXJlcyBhIGNoYW5nZS5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Zml0X2JvdW5kc19yZXF1ZXN0XCIsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJlcSA9IG1vZGVsLmdldChcImZpdF9ib3VuZHNfcmVxdWVzdFwiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IHJlcS5ib3VuZHM7XG4gICAgICAgICAgICBpZiAoIWJvdW5kcyB8fCBib3VuZHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgICAgIGlmIChyZXEucGFkZGluZyAhPSBudWxsKSBvcHRpb25zLnBhZGRpbmcgPSBbcmVxLnBhZGRpbmcsIHJlcS5wYWRkaW5nXTtcbiAgICAgICAgICAgIGlmIChyZXEubWF4X3pvb20gIT0gbnVsbCkgb3B0aW9ucy5tYXhab29tID0gcmVxLm1heF96b29tO1xuICAgICAgICAgICAgbWFwLmZpdEJvdW5kcyhib3VuZHMsIG9wdGlvbnMpO1xuXG4gICAgICAgICAgICAvLyBBcHBsaWVkIGFmdGVyIHRoZSBmaXQsIHNpbmNlIGl0IGlzIHJlbGF0aXZlIHRvIHdoYXRldmVyIHpvb20gdGhlIGZpdCBjaG9zZS5cbiAgICAgICAgICAgIGlmIChyZXEuem9vbV9vZmZzZXQpIHtcbiAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbShtYXAuZ2V0Wm9vbSgpICsgcmVxLnpvb21fb2Zmc2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGV0IHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgbGV0IGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICBsZXQgbmVlZHNTeW5jID0gZmFsc2U7XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoaXNTeW5jaW5nKSB7XG4gICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpc1N5bmNpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCBzeW5jTWFwU3RhdGUoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBzeW5jTWFwU3RhdGU6XCIsIGVycik7XG4gICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGlmIChuZWVkc1N5bmMpIHtcbiAgICAgICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gcXVldWVTeW5jKCkge1xuICAgICAgICAgICAgaWYgKCFtb2RlbC5nZXQoXCJhdXRvX3N5bmNcIikpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoc3luY1RpbWVvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICBzeW5jVGltZW91dCA9IG51bGw7XG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgIH0sIDUwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgbWFudWFsIHN5bmMgdHJpZ2dlciBjaGFuZ2VzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnN5bmNfdHJpZ2dlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJbmNyZW1lbnRhbCB1cGRhdGVzIGZyb20gUHl0aG9uLiBBcHBsaWVkIGV2ZW4gd2hlbiBhdXRvX3N5bmMgaXMgb2ZmIHNvIHRoZSBtaXJyb3JcbiAgICAgICAgLy8gc3RheXMgY3VycmVudDsgcXVldWVTeW5jIGRlY2lkZXMgd2hldGhlciB0byBhY3R1YWxseSByZS1yZW5kZXIuXG4gICAgICAgIG1vZGVsLm9uKFwibXNnOmN1c3RvbVwiLCAobXNnLCBidWZmZXJzKSA9PiB7XG4gICAgICAgICAgICBpZiAoIW1zZyB8fCBtc2cua2luZCAhPT0gXCJzd2lmdG1hcF9wYXRjaFwiKSByZXR1cm47XG4gICAgICAgICAgICBhcHBseVBhdGNoT3BzKG1zZy5vcHMgfHwgW10sIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEZ1bGwtc25hcHNob3QgcGF0aHM6IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UsIGFuZCB0aGUgc2lkZWJhciB3cml0aW5nIGBsYXllcnNgXG4gICAgICAgIC8vIGJhY2sgYWZ0ZXIgYSB0b2dnbGUuIEVpdGhlciB3YXkgdGhlIHRyYWl0IGJlY29tZXMgYXV0aG9yaXRhdGl2ZSBhZ2Fpbi5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6bGF5ZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNvb3JkaW5hdGVfYnVmZmVyc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Z3JvdXBfY29uZmlnc1wiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2NvbmZpZ1wiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlOyAgIC8vIHJlLWFwcGx5IHNwZWVkL2xvb3AgZnJvbSB0aGUgbmV3IGNvbmZpZ1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcbiAgICAgICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jdXJyZW50XCIsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdhbnRlZCA9IG1vZGVsLmdldChcInRpbWVfY3VycmVudFwiKTtcbiAgICAgICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XG4gICAgICAgICAgICBpZiAoTWF0aC5hYnMod2FudGVkIC0gdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pIDwgMSkgcmV0dXJuO1xuICAgICAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBzZWVrVG8oaWR4LCB7IHdyaXRlOiBmYWxzZSB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbG9nb1wiLCBxdWV1ZVN5bmMpO1xuXG4gICAgICAgIC8vIEFubm91bmNlIHRoaXMgdmlldyBzbyBQeXRob24gcmVwbGllcyB3aXRoIGEgZnVsbCBzbmFwc2hvdC4gTGF5ZXJzIGFkZGVkIGJlZm9yZVxuICAgICAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXG4gICAgICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBtb2RlbC5zZW5kKHsga2luZDogXCJzd2lmdG1hcF9yZWFkeVwiIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGlzIGFsbCB0aGVyZSBpcyAqLyB9XG5cbiAgICAgICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcbiAgICAgICAgaWYgKG1vZGVsLmdldChcImF1dG9fc3luY1wiKSB8fCBtb2RlbC5nZXQoXCJzeW5jX3RyaWdnZXJcIikgPiAwKSB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBTyxTQUFTLFFBQVEsSUFBSSxLQUFLO0FBQzdCLE1BQUksQ0FB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QSxRQUNoQjtBQUFBLE1BQ0o7QUFBQSxJQUNKO0FBRUEsYUFBUyxZQUFZO0FBQ2pCLFVBQUksQ0FBQyxNQUFNLElBQUksV0FBVyxHQUFHO0FBQ3pCO0FBQUEsTUFDSjtBQUNBLFVBQUksYUFBYTtBQUNiLHFCQUFhLFdBQVc7QUFBQSxNQUM1QjtBQUNBLG9CQUFjLFdBQVcsTUFBTTtBQUMzQixzQkFBYztBQUNkLG9CQUFZO0FBQUEsTUFDaEIsR0FBRyxFQUFFO0FBQUEsSUFDVDtBQUdBLFVBQU0sR0FBRyx1QkFBdUIsTUFBTTtBQUNsQyxrQkFBWTtBQUFBLElBQ2hCLENBQUM7QUFJRCxVQUFNLEdBQUcsY0FBYyxDQUFDLEtBQUssWUFBWTtBQUNyQyxVQUFJLENBQUMsT0FBTyxJQUFJLFNBQVMsaUJBQWtCO0FBQzNDLG9CQUFjLElBQUksT0FBTyxDQUFDLEdBQUcsT0FBTztBQUNwQyxnQkFBVTtBQUFBLElBQ2QsQ0FBQztBQUlELFVBQU0sR0FBRyxpQkFBaUIsTUFBTTtBQUM1QixtQkFBYSxNQUFNLElBQUksUUFBUSxLQUFLLENBQUM7QUFDckMsZ0JBQVU7QUFBQSxJQUNkLENBQUM7QUFDRCxVQUFNLEdBQUcsNkJBQTZCLE1BQU07QUFDeEMsb0JBQWMsRUFBRSxHQUFJLE1BQU0sSUFBSSxvQkFBb0IsS0FBSyxDQUFDLEVBQUc7QUFDM0QsZ0JBQVU7QUFBQSxJQUNkLENBQUM7QUFDRCxVQUFNLEdBQUcsd0JBQXdCLFNBQVM7QUFDMUMsVUFBTSxHQUFHLHNCQUFzQixNQUFNO0FBQ2pDLGFBQU8sVUFBVTtBQUNqQixnQkFBVTtBQUFBLElBQ2QsQ0FBQztBQUdELFVBQU0sR0FBRyx1QkFBdUIsTUFBTTtBQUNsQyxZQUFNLFNBQVMsTUFBTSxJQUFJLGNBQWM7QUFDdkMsVUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLE1BQU0sT0FBUTtBQUN4QyxVQUFJLEtBQUssSUFBSSxTQUFTLE9BQU8sTUFBTSxPQUFPLEtBQUssQ0FBQyxJQUFJLEVBQUc7QUFDdkQsVUFBSSxNQUFNLE9BQU8sTUFBTSxVQUFVLE9BQUssS0FBSyxNQUFNO0FBQ2pELFVBQUksUUFBUSxHQUFJLE9BQU0sT0FBTyxNQUFNLFNBQVM7QUFDNUMsYUFBTyxLQUFLLEVBQUUsT0FBTyxNQUFNLENBQUM7QUFBQSxJQUNoQyxDQUFDO0FBQ0QsVUFBTSxHQUFHLG9CQUFvQixTQUFTO0FBS3RDLFFBQUk7QUFDQSxZQUFNLEtBQUssRUFBRSxNQUFNLGlCQUFpQixDQUFDO0FBQUEsSUFDekMsU0FBUyxLQUFLO0FBQUEsSUFBbUU7QUFHakYsUUFBSSxNQUFNLElBQUksV0FBVyxLQUFLLE1BQU0sSUFBSSxjQUFjLElBQUksR0FBRztBQUN6RCxrQkFBWTtBQUFBLElBQ2hCO0FBQUEsRUFDSjtBQUNKOyIsCiAgIm5hbWVzIjogWyJnbExheWVyIiwgImluc3RhbmNlIiwgInpvb20iXQp9Cg==
