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
function sendLayerWrite(model, changes) {
  if (!changes.length) return;
  try {
    model.send({
      kind: "swiftmap_write",
      ops: changes.map((c) => ({ op: "set", id: c.id, fields: { visible: c.visible } }))
    });
  } catch (err) {
  }
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
  const changes = [];
  let groupsChanged = false;
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
            groupsChanged = true;
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
            changes.push({ id: lyr.id, visible: false });
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
  return { changes, groupsChanged };
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
        const changes = [];
        const flip = (lyr, visible) => {
          if (lyr.visible !== false === visible) return;
          lyr.visible = visible;
          changes.push({ id: lyr.id, visible });
        };
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
          parentNode.layers.forEach((sibLyr) => flip(sibLyr, sibLyr.id === id));
        } else {
          if (isGroup) {
            groupConfigs[path] = {
              ...groupConfigs[path],
              visible: isChecked
            };
            collapsedPaths[path] = !isChecked;
          } else {
            const lyr = layers.find((l) => l.id === id);
            if (lyr) flip(lyr, isChecked);
          }
        }
        sendLayerWrite(model, changes);
        model.set("group_configs", { ...groupConfigs });
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
function vectorCoords(layer, coordinateBuffers) {
  if (layer.locations) return layer.locations;
  const raw = coordinateBuffers[layer.id];
  if (!raw) return null;
  const flat = new Float64Array(
    raw.buffer || raw,
    raw.byteOffset || 0,
    (raw.byteLength || raw.length) / 8
  );
  const out = new Array(flat.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = [flat[i * 2], flat[i * 2 + 1]];
  }
  return out;
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
      const locs = vectorCoords(layer, coordinateBuffers) || [];
      const geojsonCoords = locs.map((c) => [c[1], c[0]]);
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
    const closeRing = (ring) => {
      if (ring.length > 0) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([first[0], first[1]]);
        }
      }
      return ring;
    };
    const features = [];
    const vertexCounts = [];
    for (const layer of layersList) {
      let parts = [];
      if (layer.type === "polygon") {
        const locs = vectorCoords(layer, coordinateBuffers) || [];
        const lonlat = locs.map((c) => [c[1], c[0]]);
        const ringTable = layer.rings || (lonlat.length > 0 ? [[lonlat.length]] : []);
        let at = 0;
        for (const partLens of ringTable) {
          const rings = [];
          for (const len of partLens) {
            const ring = closeRing(lonlat.slice(at, at + len));
            at += len;
            if (ring.length >= 4) rings.push(ring);
          }
          if (rings.length > 0) parts.push(rings);
        }
      } else if (layer.type === "circle") {
        const lat = layer.location[0];
        const lon = layer.location[1];
        const radiusMeters = layer.radius || 10;
        const earthRadius = 6378137;
        const ring = [];
        for (let i = 0; i <= 32; i++) {
          const angle = i * 360 / 32;
          const angleRad = angle * Math.PI / 180;
          const dLat = radiusMeters * Math.cos(angleRad) / earthRadius;
          const dLon = radiusMeters * Math.sin(angleRad) / (earthRadius * Math.cos(lat * Math.PI / 180));
          const newLat = lat + dLat * 180 / Math.PI;
          const newLon = lon + dLon * 180 / Math.PI;
          ring.push([newLon, newLat]);
        }
        parts = [[ring]];
      }
      if (parts.length === 0) {
        vertexCounts.push(0);
        continue;
      }
      let triangles = 0;
      for (const rings of parts) {
        const distinct = rings.reduce((sum, r) => sum + r.length - 1, 0);
        triangles += Math.max(0, distinct + 2 * (rings.length - 1) - 2);
      }
      vertexCounts.push(3 * triangles);
      const style = styleFor(layer, 0);
      const rgb = parseColor(style.color, "#3388ff");
      features.push({
        type: "Feature",
        geometry: parts.length === 1 ? { type: "Polygon", coordinates: parts[0] } : { type: "MultiPolygon", coordinates: parts },
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
      const radio = normalizeRadioLayers(layers, groupConfigs);
      if ((radio.changes.length > 0 || radio.groupsChanged) && document.body.contains(el)) {
        sendLayerWrite(model, radio.changes);
        model.set("group_configs", { ...groupConfigs });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvZ3B1dGltZS5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9tYXAuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBmdW5jdGlvbiBsb2FkQ1NTKGlkLCB1cmwpIHtcbiAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICBjb25zdCBsaW5rID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImxpbmtcIik7XG4gICAgICAgIGxpbmsuaWQgPSBpZDtcbiAgICAgICAgbGluay5yZWwgPSBcInN0eWxlc2hlZXRcIjtcbiAgICAgICAgbGluay5ocmVmID0gdXJsO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKGxpbmspO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlTG9hZGVycyA9IHt9O1xuXG5leHBvcnQgZnVuY3Rpb24gbG9hZEpTKGlkLCB1cmwpIHtcbiAgICBpZiAoYWN0aXZlTG9hZGVyc1tpZF0pIHtcbiAgICAgICAgcmV0dXJuIGFjdGl2ZUxvYWRlcnNbaWRdO1xuICAgIH1cbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNjcmlwdFwiKTtcbiAgICAgICAgc2NyaXB0LmlkID0gaWQ7XG4gICAgICAgIHNjcmlwdC5zcmMgPSB1cmw7XG4gICAgICAgIHNjcmlwdC5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgICAgIHNjcmlwdC5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgc2NyaXB0OiAke3VybH1gKSk7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc2NyaXB0KTtcbiAgICB9KTtcbiAgICBhY3RpdmVMb2FkZXJzW2lkXSA9IHByb21pc2U7XG4gICAgcmV0dXJuIHByb21pc2U7XG59XG5cbmZ1bmN0aW9uIGhleFRvUmdiKGhleCkge1xuICAgIGlmICghaGV4KSByZXR1cm4gbnVsbDtcbiAgICBoZXggPSBoZXgucmVwbGFjZSgvXiMvLCAnJyk7XG4gICAgaWYgKGhleC5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgaGV4ID0gaGV4LnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyICsgY2hhcikuam9pbignJyk7XG4gICAgfVxuICAgIGlmIChoZXgubGVuZ3RoICE9PSA2KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBudW0gPSBwYXJzZUludChoZXgsIDE2KTtcbiAgICByZXR1cm4ge1xuICAgICAgICByOiAoKG51bSA+PiAxNikgJiAyNTUpIC8gMjU1LFxuICAgICAgICBnOiAoKG51bSA+PiA4KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGI6IChudW0gJiAyNTUpIC8gMjU1XG4gICAgfTtcbn1cblxubGV0IGNvbG9yUHJvYmUgPSBudWxsO1xuXG4vLyBCcm93c2VycyBzaGlwIGEgY29tcGxldGUgQ1NTIGNvbG9yIHBhcnNlciAtLSBldmVyeSBuYW1lZCBjb2xvciwgcmdiKCksIGhzbCgpLCBod2IoKS5cbi8vIEJvcnJvdyBpdCBpbnN0ZWFkIG9mIG1haW50YWluaW5nIGEgbG9va3VwIHRhYmxlLiBSZXR1cm5zIG51bGwgb3V0c2lkZSBhIERPTSAoTm9kZSB0ZXN0cyksXG4vLyB3aGVyZSB0aGUgaGV4IGZhbGxiYWNrIGluIHBhcnNlQ29sb3Igc3RpbGwgYXBwbGllcy5cbmZ1bmN0aW9uIGNzc0NvbG9yVG9SZ2IodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIGRvY3VtZW50ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIWNvbG9yUHJvYmUpIGNvbG9yUHJvYmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpLmdldENvbnRleHQoXCIyZFwiKTtcblxuICAgIC8vIEFzc2lnbmluZyBhbiBpbnZhbGlkIGNvbG9yIGxlYXZlcyBmaWxsU3R5bGUgdW50b3VjaGVkLCBzbyBwcm9iZSBhZ2FpbnN0IHR3byBkaWZmZXJlbnRcbiAgICAvLyBzZW50aW5lbHM6IG9ubHkgYSB2YWx1ZSB0aGUgYnJvd3NlciBhY3R1YWxseSBwYXJzZWQgcHJvZHVjZXMgdGhlIHNhbWUgcmVzdWx0IHR3aWNlLlxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjMDAwMDAwXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBjb25zdCBmaXJzdCA9IGNvbG9yUHJvYmUuZmlsbFN0eWxlO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjZmZmZmZmXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBpZiAoZmlyc3QgIT09IGNvbG9yUHJvYmUuZmlsbFN0eWxlKSByZXR1cm4gbnVsbDtcblxuICAgIGlmIChmaXJzdC5zdGFydHNXaXRoKFwiI1wiKSkgcmV0dXJuIGhleFRvUmdiKGZpcnN0KTtcbiAgICBjb25zdCBtYXRjaCA9IGZpcnN0Lm1hdGNoKC9yZ2JhP1xcKChbXildKylcXCkvKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXJ0cyA9IG1hdGNoWzFdLnNwbGl0KFwiLFwiKS5tYXAocCA9PiBwYXJzZUZsb2F0KHAudHJpbSgpKSk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMgfHwgcGFydHMuc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyByOiBwYXJ0c1swXSAvIDI1NSwgZzogcGFydHNbMV0gLyAyNTUsIGI6IHBhcnRzWzJdIC8gMjU1IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbG9yKGNvbG9yU3RyLCBmYWxsYmFja0hleCA9IFwiIzMzODhmZlwiKSB7XG4gICAgaWYgKCFjb2xvclN0cikgY29sb3JTdHIgPSBmYWxsYmFja0hleDtcbiAgICByZXR1cm4gY3NzQ29sb3JUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgaGV4VG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGNzc0NvbG9yVG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IGhleFRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcbn1cblxuY29uc3QgVVJMX0FUVFJfQkVGT1JFID0gLyg/OmhyZWZ8c3JjKVxccyo9XFxzKlsnXCJdPyQvaTtcbmNvbnN0IFNBRkVfVVJMID0gL14oPzpodHRwcz86XFwvXFwvfG1haWx0bzp8dGVsOnxkYXRhOmltYWdlXFwvfFsuLyM/XXxbXFx3Li1dKyg/OlsvPyNdfCQpKS9pO1xuXG4vLyBQcm9wZXJ0eSB2YWx1ZXMgY29tZSBmcm9tIHVzZXIgZGF0YSBhbmQgZW5kIHVwIGluIGlubmVySFRNTCwgc28gdGhleSBhcmUgZXNjYXBlZC5cbi8vIE1hcmt1cCB0aGUgYXBwIGF1dGhvciB3cm90ZSAodGVtcGxhdGVzLCBzdHlsZSBzdHJpbmdzKSBpcyBsZWZ0IGludGFjdC5cbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVIdG1sKHZhbHVlKSB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSlcbiAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxuICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXG4gICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxuICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMzk7XCIpO1xufVxuXG4vLyBFc2NhcGluZyBzdG9wcyBhdHRyaWJ1dGUgYnJlYWtvdXQgYnV0IG5vdCBcImphdmFzY3JpcHQ6XCIgaW4gYW4gaHJlZiwgc28gdmFsdWVzIGxhbmRpbmdcbi8vIGluIGEgVVJMIGF0dHJpYnV0ZSBnZXQgYSBzY2hlbWUgY2hlY2suIENvbnRyb2wgY2hhcmFjdGVycyBhcmUgc3RyaXBwZWQgZmlyc3QgYmVjYXVzZVxuLy8gXCJqYXZhXFx0c2NyaXB0OlwiIHN1cnZpdmVzIGEgbmFpdmUgY29tcGFyaXNvbi5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlKSB7XG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcbiAgICByZXR1cm4gU0FGRV9VUkwudGVzdChjb2xsYXBzZWQpID8gU3RyaW5nKHZhbHVlKSA6IFwiXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIGNvbnN0IHRhcmdldEZpZWxkcyA9IChBcnJheS5pc0FycmF5KGZpZWxkcykgJiYgZmllbGRzLmxlbmd0aCkgPyBmaWVsZHMgOiBPYmplY3Qua2V5cyhwcm9wcyk7XG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcbiAgICBjb25zdCBsaW5lcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGFyZ2V0RmllbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XG4gICAgICAgIGlmIChwcm9wc1tmXSA9PT0gdW5kZWZpbmVkIHx8IHByb3BzW2ZdID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgbGluZXMucHVzaChgPGI+JHtlc2NhcGVIdG1sKGxhYmVsc1tpXSl9PC9iPjogJHtlc2NhcGVIdG1sKHByb3BzW2ZdKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oXCI8YnI+XCIpO1xufVxuXG4vLyBcIntjb2x1bW59XCIgaW5zZXJ0cyBvbmUgZXNjYXBlZCB2YWx1ZTsgXCJ7Kn1cIiBpbnNlcnRzIHRoZSBkZWZhdWx0IGZpZWxkIGxpc3QuXG5mdW5jdGlvbiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiKlwiKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BzW2tleV07XG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHJldHVybiBcIlwiO1xuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XG4gICAgICAgIHJldHVybiBlc2NhcGVIdG1sKFVSTF9BVFRSX0JFRk9SRS50ZXN0KHByZWNlZGluZykgPyBzYWZlVXJsKHZhbCkgOiB2YWwpO1xuICAgIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIGtpbmQpIHtcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGxheWVyW2tpbmQgKyBcIl90ZW1wbGF0ZVwiXTtcbiAgICBjb25zdCBmaWVsZHMgPSBsYXllcltraW5kICsgXCJfZmllbGRzXCJdO1xuICAgIGNvbnN0IG5hbWVzID0gbGF5ZXJba2luZCArIFwiX25hbWVzXCJdO1xuICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgPT09IFwic3RyaW5nXCIgJiYgdGVtcGxhdGUpIHtcbiAgICAgICAgcmV0dXJuIHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBwcm9wcywgZmllbGRzLCBuYW1lcyk7XG4gICAgfVxuICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XG59XG5cbmZ1bmN0aW9uIHdyYXBTdHlsZWQoaHRtbCwgc3R5bGUpIHtcbiAgICBpZiAoIXN0eWxlKSByZXR1cm4gaHRtbDtcbiAgICByZXR1cm4gYDxkaXYgc3R5bGU9XCIke2VzY2FwZUh0bWwoc3R5bGUpfVwiPiR7aHRtbH08L2Rpdj5gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFBvcHVwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwicG9wdXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3BvcHVwIHx8IGxheWVyLnBvcHVwX2ZpZWxkcyB8fCBsYXllci5wb3B1cF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICBpZiAobGF5ZXIucG9wdXBfbWF4X3dpZHRoKSBvcHRpb25zLm1heFdpZHRoID0gbGF5ZXIucG9wdXBfbWF4X3dpZHRoO1xuICAgICAgICBMLnBvcHVwKG9wdGlvbnMpXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIucG9wdXBfc3R5bGUpKVxuICAgICAgICAgICAgLm9wZW5PbihtYXApO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRUb29sdGlwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIsIGxheWVySW5zdGFuY2UpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwidG9vbHRpcFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfdG9vbHRpcCB8fCBsYXllci50b29sdGlwX2ZpZWxkcyB8fCBsYXllci50b29sdGlwX3RlbXBsYXRlKSkge1xuICAgICAgICBpZiAoIWxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXAgPSBMLnRvb2x0aXAoeyBkaXJlY3Rpb246ICd0b3AnLCBvZmZzZXQ6IFswLCAtNV0gfSk7XG4gICAgICAgIH1cbiAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcFxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnRvb2x0aXBfc3R5bGUpKVxuICAgICAgICAgICAgLmFkZFRvKG1hcCk7XG4gICAgfVxufVxuIiwgImNvbnN0IGNvbGxhcHNlZFBhdGhzID0ge307ICAvLyBwYXRoIC0+IGNvbGxhcHNlZD9cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllckJvdW5kcyhsLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKCFsKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAvLyBTdXBwb3J0IGZvbGRlciB0cmVlIG5vZGVzIChncm91cHMgaW4gc2lkZWJhciB0cmVlKVxyXG4gICAgaWYgKGwuaXNHcm91cCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkcmVuIGdyb3Vwc1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGwuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGwuY2hpbGRyZW5ba2V5XSwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZCBsYXllcnNcclxuICAgICAgICBsLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhseXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGwuYm91bmRzICYmIGwuYm91bmRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICByZXR1cm4gbC5ib3VuZHM7XHJcbiAgICB9XHJcbiAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgbC5sYXllcnMpIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsLmxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMoc3ViLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChsLmxvY2F0aW9ucyAmJiBsLmxvY2F0aW9ucy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgY29uc3QgY29vcmRzID0gbC5sb2NhdGlvbnMuZmxhdChJbmZpbml0eSk7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2ldO1xyXG4gICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSArIDFdO1xyXG4gICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF07XHJcbiAgICAgICAgaWYgKGJ1Zikge1xyXG4gICAgICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KGJ1Zi5idWZmZXIsIGJ1Zi5ieXRlT2Zmc2V0LCBidWYuYnl0ZUxlbmd0aCAvIDgpO1xyXG4gICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aCAvIDI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2kgKiAyXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8vIFRoZSB3cml0ZSBoYWxmIG9mIGEgdmlzaWJpbGl0eSB0b2dnbGU6IG9uZSBjdXN0b20gbWVzc2FnZSBuYW1pbmcgdGhlIGZsaXBwZWQgaWRzLFxyXG4vLyBpbnN0ZWFkIG9mIHRoZSB3aG9sZSBsYXllcnMgdHJhaXQuIFB5dGhvbiBhcHBsaWVzIHRoZSBmaWVsZHMgYW5kIHJlLWVtaXRzIHRoZW0gYXNcclxuLy8gYHNldGAgcGF0Y2ggb3BzLCB3aGljaCBpcyBob3cgb3RoZXIgdmlld3Mgb2YgdGhlIHNhbWUgbWFwIChub3RlYm9vayBvdXRwdXRzKSBzdGF5XHJcbi8vIGluIHN0ZXAgbm93IHRoYXQgdGhlIHRyYWl0IG5vIGxvbmdlciBjYXJyaWVzIHRvZ2dsZXMuXHJcbmV4cG9ydCBmdW5jdGlvbiBzZW5kTGF5ZXJXcml0ZShtb2RlbCwgY2hhbmdlcykge1xyXG4gICAgaWYgKCFjaGFuZ2VzLmxlbmd0aCkgcmV0dXJuO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBtb2RlbC5zZW5kKHtcclxuICAgICAgICAgICAga2luZDogXCJzd2lmdG1hcF93cml0ZVwiLFxyXG4gICAgICAgICAgICBvcHM6IGNoYW5nZXMubWFwKGMgPT4gKHsgb3A6IFwic2V0XCIsIGlkOiBjLmlkLCBmaWVsZHM6IHsgdmlzaWJsZTogYy52aXNpYmxlIH0gfSkpLFxyXG4gICAgICAgIH0pO1xyXG4gICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIHJlbmRlcmVkIGxpc3QgYWxyZWFkeSBob2xkcyB0aGUgY2hhbmdlICovIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKSB7XHJcbiAgICBjb25zdCB0cmVlID0geyBuYW1lOiBcIlJvb3RcIiwgcGF0aDogXCJcIiwgY2hpbGRyZW46IHt9LCBsYXllcnM6IFtdLCBpc0dyb3VwOiB0cnVlIH07XHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcbiAgICBsYXllcnMuZm9yRWFjaChsID0+IHtcclxuICAgICAgICBjb25zdCBwYXRoU3RyID0gbC5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiO1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gcGF0aFN0ci5zcGxpdChcIi9cIik7XHJcbiAgICAgICAgbGV0IGN1cnIgPSB0cmVlO1xyXG4gICAgICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XHJcbiAgICAgICAgcGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcclxuICAgICAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XHJcbiAgICAgICAgICAgIGlmICghY3Vyci5jaGlsZHJlbltwYXJ0XSkge1xyXG4gICAgICAgICAgICAgICAgY3Vyci5jaGlsZHJlbltwYXJ0XSA9IHtcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LFxyXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHJ1bm5pbmdQYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiB7fSxcclxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IFtdLFxyXG4gICAgICAgICAgICAgICAgICAgIGlzR3JvdXA6IHRydWVcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY3VyciA9IGN1cnIuY2hpbGRyZW5bcGFydF07XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY3Vyci5sYXllcnMucHVzaChsKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJlcG9ydHMgd2hhdCBpdCBjaGFuZ2VkIC0tIHtjaGFuZ2VzOiBbe2lkLCB2aXNpYmxlfV0sIGdyb3Vwc0NoYW5nZWR9IC0tIHNvIHRoZVxyXG4gICAgLy8gY2FsbGVyIGNhbiB3cml0ZSBiYWNrIGV4YWN0bHkgdGhvc2UgZmxpcHMgcmF0aGVyIHRoYW4gdGhlIHdob2xlIGxheWVycyBsaXN0LlxyXG4gICAgY29uc3QgY2hhbmdlcyA9IFtdO1xyXG4gICAgbGV0IGdyb3Vwc0NoYW5nZWQgPSBmYWxzZTtcclxuICAgIGZ1bmN0aW9uIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZSkge1xyXG4gICAgICAgIGNvbnN0IGNvbmYgPSBncm91cENvbmZpZ3Nbbm9kZS5wYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzUmFkaW9Hcm91cCA9IGNvbmYubXVsdGlfc2VsZWN0ID09PSBmYWxzZTtcclxuICAgICAgICBpZiAoaXNSYWRpb0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxldCBmb3VuZEFjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjaGlsZEdyb3VwID0gbm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdID0geyB2aXNpYmxlOiB0cnVlLCBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZEFjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cHNDaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZEFjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbm9kZS5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gbHlyLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZEFjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBseXIudmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VzLnB1c2goeyBpZDogbHlyLmlkLCB2aXNpYmxlOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZEFjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUuY2hpbGRyZW5ba2V5XSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKHRyZWUpO1xyXG4gICAgcmV0dXJuIHsgY2hhbmdlcywgZ3JvdXBzQ2hhbmdlZCB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgbW9kZWwsIG1hcCwgb25MYXllclRvZ2dsZSkge1xyXG4gICAgc2lkZWJhci5pbm5lckhUTUwgPSBcIjxiIHN0eWxlPSdmb250LXNpemU6IDEzcHg7IGJvcmRlci1ib3R0b206IDJweCBzb2xpZCAjZWVlOyBwYWRkaW5nLWJvdHRvbTogNHB4OyBkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogOHB4Oyc+TGF5ZXJzIENvbnRyb2w8L2I+XCI7XHJcbiAgICBcclxuICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IG1vZGVsLmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge307XHJcblxyXG4gICAgLy8gMS4gQnVpbGQgYSBuZXN0ZWQgaGllcmFyY2hpY2FsIHRyZWUgZnJvbSB0aGUgZmxhdCBsYXllcnMgbGlzdFxyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgcm9vdC1sZXZlbCBjb25maWdzIGRlZmF1bHQgdG8gbXVsdGlfc2VsZWN0OiB0cnVlIGlmIG5vdCBzcGVjaWZpZWRcclxuICAgIGlmICghZ3JvdXBDb25maWdzW1wiXCJdKSB7XHJcbiAgICAgICAgZ3JvdXBDb25maWdzW1wiXCJdID0geyBtdWx0aV9zZWxlY3Q6IHRydWUsIHZpc2libGU6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICBsYXllcnMuZm9yRWFjaChsID0+IHtcclxuICAgICAgICBjb25zdCBwYXRoU3RyID0gbC5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiO1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gcGF0aFN0ci5zcGxpdChcIi9cIik7XHJcbiAgICAgICAgbGV0IGN1cnIgPSB0cmVlO1xyXG4gICAgICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XHJcbiAgICAgICAgcGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcclxuICAgICAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XHJcbiAgICAgICAgICAgIGlmICghY3Vyci5jaGlsZHJlbltwYXJ0XSkge1xyXG4gICAgICAgICAgICAgICAgY3Vyci5jaGlsZHJlbltwYXJ0XSA9IHtcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LFxyXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHJ1bm5pbmdQYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiB7fSxcclxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IFtdLFxyXG4gICAgICAgICAgICAgICAgICAgIGlzR3JvdXA6IHRydWVcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY3VyciA9IGN1cnIuY2hpbGRyZW5bcGFydF07XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY3Vyci5sYXllcnMucHVzaChsKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIDIuIFJlY3Vyc2l2ZSBmdW5jdGlvbiB0byByZW5kZXIgYSB0cmVlIG5vZGVcclxuICAgIGZ1bmN0aW9uIHJlbmRlck5vZGUobm9kZSwgcGFyZW50RWwsIGRlcHRoLCBwYXJlbnROb2RlLCBwYXJlbnRFZmZlY3RpdmVWaXNpYmxlKSB7XHJcblxyXG4gICAgICAgIGlmIChub2RlLnBhdGggPT09IFwiXCIpIHtcclxuICAgICAgICAgICAgLy8gUmVuZGVyIHJvb3QncyBjaGlsZCBncm91cHMgYW5kIGNoaWxkIGxheWVycyBkaXJlY3RseSB3aXRob3V0IGhlYWRlclxyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKG5vZGUuY2hpbGRyZW5ba2V5XSwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBwYXJlbnRFbCwgZGVwdGgsIG5vZGUsIHRydWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaXNHcm91cCA9IG5vZGUuaXNHcm91cCA9PT0gdHJ1ZTtcclxuICAgICAgICBjb25zdCBwYXRoID0gaXNHcm91cCA/IG5vZGUucGF0aCA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgbmFtZSA9IG5vZGUubmFtZTtcclxuICAgICAgICBjb25zdCBpZCA9IGlzR3JvdXAgPyBudWxsIDogbm9kZS5pZDtcclxuXHJcbiAgICAgICAgLy8gRGV0ZXJtaW5lIHNlbGVjdGlvbiB0eXBlIChjaGVja2JveCB2cyByYWRpbykgYmFzZWQgb24gcGFyZW50J3MgbXVsdGlfc2VsZWN0IGNvbmZpZ1xyXG4gICAgICAgIGNvbnN0IHBhcmVudFBhdGggPSBwYXJlbnROb2RlID8gcGFyZW50Tm9kZS5wYXRoIDogXCJcIjtcclxuICAgICAgICBjb25zdCBwYXJlbnRDb25mID0gZ3JvdXBDb25maWdzW3BhcmVudFBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNNdWx0aVNlbGVjdCA9IHBhcmVudENvbmYubXVsdGlfc2VsZWN0ICE9PSBmYWxzZTtcclxuXHJcbiAgICAgICAgY29uc3Qgbm9kZURpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgbm9kZURpdi5zdHlsZS5tYXJnaW5Cb3R0b20gPSBcIjRweFwiO1xyXG5cclxuICAgICAgICBsZXQgc2VsZlZpc2libGUgPSB0cnVlO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHNlbGZWaXNpYmxlID0gcGF0aCA9PT0gXCJCYXNlbWFwc1wiID8gdHJ1ZSA6IChncm91cENvbmZpZ3NbcGF0aF0/LnZpc2libGUgIT09IGZhbHNlKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IG5vZGUudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHNlbGZFZmZlY3RpdmVWaXNpYmxlID0gcGFyZW50RWZmZWN0aXZlVmlzaWJsZSAmJiBzZWxmVmlzaWJsZTtcclxuXHJcbiAgICAgICAgY29uc3QgaGVhZGVyRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZGlzcGxheSA9IFwiZmxleFwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5hbGlnbkl0ZW1zID0gXCJjZW50ZXJcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLnVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUud2Via2l0VXNlclNlbGVjdCA9IFwibm9uZVwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUub3BhY2l0eSA9IFwiMC41XCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5zdHlsZS5jb2xvciA9IFwiIzg4OFwiO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVG9nZ2xlIEV4cGFuZC9Db2xsYXBzZSBhcnJvd1xyXG4gICAgICAgIGxldCB0b2dnbGVFbCA9IG51bGw7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgdG9nZ2xlRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjRweFwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250U2l6ZSA9IFwiMTZweFwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5saW5lSGVpZ2h0ID0gXCIxXCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmRpc3BsYXkgPSBcImlubGluZS1ibG9ja1wiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS50ZXh0QWxpZ24gPSBcImNlbnRlclwiO1xyXG4gICAgICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGNvbGxhcHNlZFBhdGhzW3BhdGhdID09PSB0cnVlO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC50ZXh0Q29udGVudCA9IGlzQ29sbGFwc2VkID8gXCJcdTI1QjhcIiA6IFwiXHUyNUJFXCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKHRvZ2dsZUVsKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCBzcGFjZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLndpZHRoID0gXCIxNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKHNwYWNlcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDaGVja2JveCBvciBSYWRpbyBpbnB1dCBlbGVtZW50XHJcbiAgICAgICAgbGV0IGlucHV0ID0gbnVsbDtcclxuICAgICAgICBpZiAoIWlzR3JvdXAgfHwgcGF0aCAhPT0gXCJCYXNlbWFwc1wiKSB7XHJcbiAgICAgICAgICAgIGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlucHV0XCIpO1xyXG4gICAgICAgICAgICBpbnB1dC50eXBlID0gaXNNdWx0aVNlbGVjdCA/IFwiY2hlY2tib3hcIiA6IFwicmFkaW9cIjtcclxuICAgICAgICAgICAgaW5wdXQubmFtZSA9IGlzTXVsdGlTZWxlY3QgPyAoaXNHcm91cCA/IGBncm91cF8ke3BhdGh9YCA6IGBsYXllcl8ke2lkfWApIDogYHBhcmVudF8ke3BhcmVudFBhdGh9YDtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjZweFwiO1xyXG4gICAgICAgICAgICBpbnB1dC5zdHlsZS5jdXJzb3IgPSBcInBvaW50ZXJcIjtcclxuICAgICAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1twYXRoXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1twYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gZ3JvdXBDb25maWdzW3BhdGhdLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IG5vZGUudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChpbnB1dCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBUZXh0XHJcbiAgICAgICAgY29uc3QgbGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBsYWJlbC50ZXh0Q29udGVudCA9IG5hbWU7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgbGFiZWwuc3R5bGUuZm9udFdlaWdodCA9IFwiYm9sZFwiO1xyXG4gICAgICAgIH1cclxuICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQobGFiZWwpO1xyXG5cclxuICAgICAgICBub2RlRGl2LmFwcGVuZENoaWxkKGhlYWRlckRpdik7XHJcblxyXG4gICAgICAgIC8vIENoaWxkcmVuIERyYXdlciAoZm9yIGdyb3VwcylcclxuICAgICAgICBsZXQgY2hpbGRyZW5EaXYgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuZGlzcGxheSA9IGlzQ29sbGFwc2VkID8gXCJub25lXCIgOiBcImJsb2NrXCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmJvcmRlckxlZnQgPSBcIjFweCBkYXNoZWQgI2NjY1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5tYXJnaW5MZWZ0ID0gXCI1cHhcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUucGFkZGluZ0xlZnQgPSBcIjhweFwiO1xyXG5cclxuICAgICAgICAgICAgLy8gUmVuZGVyIHN1Yi1ncm91cHMgYW5kIGxheWVycyByZWN1cnNpdmVseVxyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKG5vZGUuY2hpbGRyZW5ba2V5XSwgY2hpbGRyZW5EaXYsIGRlcHRoICsgMSwgbm9kZSwgc2VsZkVmZmVjdGl2ZVZpc2libGUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbm9kZS5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShseXIsIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBub2RlRGl2LmFwcGVuZENoaWxkKGNoaWxkcmVuRGl2KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2Ugd2hlbiBjbGlja2luZyBoZWFkZXIgcm93IChiYWNrZ3JvdW5kLCBlbXB0eSBzcGFjZSwgb3IgYXJyb3cpXHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGNvbGxhcHNlZFBhdGhzW3BhdGhdID09PSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbcGF0aF0gPSAhaXNDb2xsYXBzZWQ7XHJcbiAgICAgICAgICAgICAgICBpZiAodG9nZ2xlRWwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0b2dnbGVFbC50ZXh0Q29udGVudCA9ICFpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkcmVuRGl2KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuZGlzcGxheSA9ICFpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIExhYmVsIGNsaWNrIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGxhYmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgICAgIGlmIChpc011bHRpU2VsZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9ICFpbnB1dC5jaGVja2VkO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlucHV0LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KFwiY2hhbmdlXCIpKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBJbnB1dCBjaGFuZ2UgbGlzdGVuZXJcclxuICAgICAgICBpZiAoaW5wdXQpIHtcclxuICAgICAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc0NoZWNrZWQgPSBpbnB1dC5jaGVja2VkO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBGb3IgcmFkaW8gYnV0dG9ucywgb25seSBwcm9jZXNzIHRoZSBzZWxlY3Rpb24gZXZlbnQgKGlnbm9yZSBkZS1zZWxlY3Rpb24gZXZlbnRzKVxyXG4gICAgICAgICAgICAgICAgaWYgKCFpc011bHRpU2VsZWN0ICYmICFpc0NoZWNrZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gRmxpcHBlZCBvbiB0aGUgbGlzdCB0aGlzIHNpZGViYXIgcmVuZGVyZWQgZnJvbSwgbmV2ZXIgbW9kZWwuZ2V0KFwibGF5ZXJzXCIpLlxyXG4gICAgICAgICAgICAgICAgLy8gTGF5ZXJzIGFkZGVkIGFmdGVyIHRoZSB3aWRnZXQgaXMgZGlzcGxheWVkIGFycml2ZSBhcyBwYXRjaGVzIHRoYXQgdXBkYXRlIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gZnJvbnRlbmQncyBsb2NhbCBzdGF0ZSB3aXRob3V0IHRvdWNoaW5nIHRoZSB0cmFpdCwgc28gdGhlIG1vZGVsJ3MgY29weSBpc1xyXG4gICAgICAgICAgICAgICAgLy8gZnJvemVuIGF0IHdoYXRldmVyIHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgY2FycmllZC4gQnVpbGRpbmcgdGhlIHVwZGF0ZSBmcm9tXHJcbiAgICAgICAgICAgICAgICAvLyBpdCBkcm9wcyBldmVyeSBsYXRlciBsYXllcjogdGhlIHRvZ2dsZSBtYXRjaGVzIG5vIGlkLCB3cml0ZXMgdGhlIHN0YWxlIGxpc3RcclxuICAgICAgICAgICAgICAgIC8vIGJhY2ssIGFuZCB0aGUgY2hhbmdlIGhhbmRsZXIgdGhlbiByZXNldHMgbG9jYWwgc3RhdGUgdG8gaXQgLS0gc28gdGhlIGJveFxyXG4gICAgICAgICAgICAgICAgLy8gcmUtY2hlY2tzIGl0c2VsZiBhbmQgdGhlIGxheWVyIG5ldmVyIGhpZGVzLlxyXG4gICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBmbGlwcyBtdXRhdGUgdGhlIHJlbmRlcmVkIGxpc3QgaW4gcGxhY2UgYW5kIHJlYWNoIFB5dGhvbiBhcyBhIHRhcmdldGVkXHJcbiAgICAgICAgICAgICAgICAvLyB3cml0ZSAoc2VuZExheWVyV3JpdGUpLCBuZXZlciBieSBzZXR0aW5nIHRoZSBsYXllcnMgdHJhaXQ6IHRoZSBmdWxsXHJcbiAgICAgICAgICAgICAgICAvLyB3cml0ZS1iYWNrIHNjYWxlZCB3aXRoIHRoZSBtYXAgaW5zdGVhZCBvZiB0aGUgY2xpY2suIEF0IDI1IHRyYWNrcyB4IDIwMGtcclxuICAgICAgICAgICAgICAgIC8vIHZlcnRpY2VzIGl0IHdhcyBhIDM2IE1CIGZyYW1lIC0tIHBhc3QgdXZpY29ybidzIDE2IE1CIGRlZmF1bHQgd2Vic29ja2V0XHJcbiAgICAgICAgICAgICAgICAvLyBjYXAsIHNvIHRoZSBzZXJ2ZXIgY2xvc2VkIHRoZSBjb25uZWN0aW9uIGFuZCB0aGUgU2hpbnkgc2Vzc2lvbiBkaWVkIG9uXHJcbiAgICAgICAgICAgICAgICAvLyB0aGUgZmlyc3QgY2hlY2tib3guIFNldHRpbmcgdGhlIHRyYWl0IHdpdGhvdXQgc2F2aW5nIGlzIGp1c3QgYXMgZmF0YWw6XHJcbiAgICAgICAgICAgICAgICAvLyBpdCBzdGF5cyBkaXJ0eSBhbmQgdGhlIG5leHQgc2F2ZV9jaGFuZ2VzIChhbnkgcGFuKSBmbHVzaGVzIGl0LlxyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hhbmdlcyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZmxpcCA9IChseXIsIHZpc2libGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoKGx5ci52aXNpYmxlICE9PSBmYWxzZSkgPT09IHZpc2libGUpIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICBseXIudmlzaWJsZSA9IHZpc2libGU7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZSB9KTtcclxuICAgICAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCFpc011bHRpU2VsZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUmFkaW8gYnV0dG9uIGxvZ2ljOiBzZXQgYWxsIHNpYmxpbmdzIHRvIHZpc2libGU9ZmFsc2UsIGFuZCB0aGlzIHRvIHZpc2libGU9dHJ1ZVxyXG4gICAgICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKHBhcmVudE5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2liR3JvdXAgPSBwYXJlbnROb2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkdyb3VwLnBhdGggPT09IHBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU6IGFjdGl2ZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tzaWJHcm91cC5wYXRoXSA9ICFhY3RpdmU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50Tm9kZS5sYXllcnMuZm9yRWFjaChzaWJMeXIgPT4gZmxpcChzaWJMeXIsIHNpYkx5ci5pZCA9PT0gaWQpKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2tib3ggbG9naWNcclxuICAgICAgICAgICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3NbcGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBpc0NoZWNrZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbcGF0aF0gPSAhaXNDaGVja2VkO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGx5ciA9IGxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobHlyKSBmbGlwKGx5ciwgaXNDaGVja2VkKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgc2VuZExheWVyV3JpdGUobW9kZWwsIGNoYW5nZXMpO1xyXG4gICAgICAgICAgICAgICAgLy8gZ3JvdXBfY29uZmlncyBzdGF5cyBvbiB0aGUgdHJhaXQ6IGl0IGlzIGEgaGFuZGZ1bCBvZiBmb2xkZXIgZmxhZ3MsIGFuZCB0aGVcclxuICAgICAgICAgICAgICAgIC8vIHNwcmVhZCBnaXZlcyBCYWNrYm9uZSBhIGZyZXNoIHJlZmVyZW5jZSBzbyB0aGUgaW4tcGxhY2UgZWRpdHMgcmVnaXN0ZXIuXHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIHsgLi4uZ3JvdXBDb25maWdzIH0pO1xyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGlzQ2hlY2tlZCAmJiBtYXApIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBib3VuZHMgPSBnZXRMYXllckJvdW5kcyhub2RlLCBtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmZpdEJvdW5kcyhib3VuZHMpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAob25MYXllclRvZ2dsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG9uTGF5ZXJUb2dnbGUoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBwYXJlbnRFbC5hcHBlbmRDaGlsZChub2RlRGl2KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZW5kZXIgdHJlZSBmcm9tIHJvb3Qgbm9kZVxyXG4gICAgcmVuZGVyTm9kZSh0cmVlLCBzaWRlYmFyLCAwLCBudWxsLCB0cnVlKTtcclxufVxyXG4iLCAiZXhwb3J0IGNvbnN0IHBpblNoYWRlciA9IGBcclxucHJlY2lzaW9uIG1lZGl1bXAgZmxvYXQ7XHJcbnZhcnlpbmcgdmVjNCBfY29sb3I7XHJcbnZvaWQgbWFpbigpIHtcclxuICAgIC8vIHV2IHJhbmdlcyBmcm9tIC0wLjUgdG8gMC41LiBUaGUgY2VudGVyICgwLjAsIDAuMCkgaXMgdGhlIGV4YWN0IGNvb3JkaW5hdGUuXHJcbiAgICB2ZWMyIHV2ID0gZ2xfUG9pbnRDb29yZC54eSAtIHZlYzIoMC41KTtcclxuXHJcbiAgICAvLyBQaW4gaGVhZCBjaXJjbGUgY2VudGVyZWQgYXQgKDAuMCwgLTAuMzApIHdpdGggcmFkaXVzIDAuMTZcclxuICAgIGZsb2F0IGRfY2lyY2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgXHJcbiAgICAvLyBQaW4gYm9keSB0cmlhbmdsZSBwb2ludGluZyBleGFjdGx5IHRvICgwLjAsIDAuMClcclxuICAgIGZsb2F0IGRfdHJpYW5nbGUgPSBtYXgoYWJzKHV2LngpICogMS44NzUgKyB1di55LCAtdXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9waW4gPSBtaW4oZF9jaXJjbGUsIGRfdHJpYW5nbGUpO1xyXG5cclxuICAgIC8vIElubmVyIGhvbGUgY2VudGVyZWQgYXQgKDAuMCwgLTAuMzApIHdpdGggcmFkaXVzIDAuMDZcclxuICAgIGZsb2F0IGRfaG9sZSA9IGxlbmd0aCh1diAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4wNjtcclxuXHJcbiAgICAvLyBEcm9wIHNoYWRvdyBzaGlmdGVkIHNsaWdodGx5IGRvd24gYW5kIGJsdXJyZWRcclxuICAgIHZlYzIgc2hhZG93VXYgPSB1diAtIHZlYzIoMC4wLCAwLjA0KTtcclxuICAgIGZsb2F0IGRfc2hhZG93X2NpcmNsZSA9IGxlbmd0aChzaGFkb3dVdiAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4xNjtcclxuICAgIGZsb2F0IGRfc2hhZG93X3RyaWFuZ2xlID0gbWF4KGFicyhzaGFkb3dVdi54KSAqIDEuODc1ICsgc2hhZG93VXYueSwgLXNoYWRvd1V2LnkgLSAwLjMwKTtcclxuICAgIGZsb2F0IGRfc2hhZG93ID0gbWluKGRfc2hhZG93X2NpcmNsZSwgZF9zaGFkb3dfdHJpYW5nbGUpO1xyXG5cclxuICAgIC8vIEFudGktYWxpYXNlZCBtYXNrc1xyXG4gICAgZmxvYXQgbWFza19waW4gPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluKTtcclxuICAgIGZsb2F0IG1hc2tfaG9sZSA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9ob2xlKTtcclxuICAgIGZsb2F0IG1hc2tfYm9yZGVyID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX3BpbiArIDAuMDI1KTtcclxuICAgIGZsb2F0IG1hc2tfc2hhZG93ID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMywgMC4wNCwgZF9zaGFkb3cpO1xyXG5cclxuICAgIC8vIENvbXBvc2l0ZSBsYXllcnNcclxuICAgIHZlYzQgc2hhZG93Q29sb3IgPSB2ZWM0KDAuMCwgMC4wLCAwLjAsIDAuMjUpICogbWFza19zaGFkb3c7XHJcbiAgICB2ZWM0IGJvZHlDb2xvciA9IG1peCh2ZWM0KDAuMCwgMC4wLCAwLjAsIDAuODUpLCB2ZWM0KF9jb2xvci5yZ2IsIF9jb2xvci5hKSwgbWFza19ib3JkZXIpO1xyXG4gICAgdmVjNCB3aXRoSG9sZSA9IG1peChib2R5Q29sb3IsIHZlYzQoMS4wLCAxLjAsIDEuMCwgMS4wKSwgbWFza19ob2xlKTtcclxuXHJcbiAgICBnbF9GcmFnQ29sb3IgPSBtaXgoc2hhZG93Q29sb3IsIHdpdGhIb2xlLCBtYXNrX3Bpbik7XHJcbn1gO1xyXG4iLCAiLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlcjogb25lIGNvbnRyb2wgc2VydmluZyBldmVyeSB0aW1lIGxheWVyIG9uIHRoZSBtYXAuXG4vL1xuLy8gVGlja3MgYXJlIGdlbmVyYXRlZCBmcm9tIGFuIElTTzg2MDEgcGVyaW9kIHJhdGhlciB0aGFuIHRha2VuIGZyb20gdGhlIG9ic2VydmVkXG4vLyB0aW1lc3RhbXBzLCBkZWxpYmVyYXRlbHk6IGEgcGVyaW9kIGluIHdoaWNoIG5vdGhpbmcgaGFwcGVuZWQgc3RpbGwgZ2V0cyBpdHMgdGljaywgc28gYW5cbi8vIGVtcHR5IG1hcCBhdCAwMzowMCByZWFkcyBhcyBhYnNlbmNlIHJhdGhlciB0aGFuIHRoZSBzbGlkZXIgc2tpcHBpbmcgdGhlIHF1aWV0IGhvdXJzLlxuLy9cbi8vIFRoaXMgaXMgc3dpZnRtYXAncyBvd24gY29udHJvbCByYXRoZXIgdGhhbiBMZWFmbGV0LlRpbWVEaW1lbnNpb24ncy4gVGhhdCBsaWJyYXJ5IHNwbGl0c1xuLy8gaW50byBhIHRpbWUgbW9kZWwsIGEgY29udHJvbCwgYW5kIHBlci1sYXllciBhZGFwdGVycyB0aGF0IHJlLXJlbmRlciBHZW9KU09OIHBlciB0aWNrIC0tXG4vLyB0aGUgYWRhcHRlcnMgYXJlIHVudXNhYmxlIGFnYWluc3QgV2ViR0wgbGF5ZXJzLCB0aGUgbW9kZWwgaXMgYSBmZXcgZG96ZW4gbGluZXMsIGFuZCB0aGVcbi8vIGNvbnRyb2wgYWxvbmUgd2FzIG5vdCB3b3J0aCBhIHZlbmRvcmVkIGRlcGVuZGVuY3kgb24gYSBuZXR3b3JrIHdoZXJlIGV2ZXJ5IGZpbGUgaXNcbi8vIGNhcnJpZWQgYWNyb3NzIGJ5IGhhbmQuXG5cbi8vIC0tLSBJU084NjAxIHBlcmlvZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNaXJyb3JzIGlzX3ZhbGlkX3BlcmlvZCgpIGluIHN3aWZ0bWFwL2xheWVycy9fdGltZS5weTsgdGhlIGdyYW1tYXIgbXVzdCBub3QgZHJpZnQuXG5jb25zdCBQRVJJT0RfUkUgPVxuICAgIC9eUCg/ISQpKD86KFxcZCspWSk/KD86KFxcZCspTSk/KD86KFxcZCspVyk/KD86KFxcZCspRCk/KD86VCg/ISQpKD86KFxcZCspSCk/KD86KFxcZCspTSk/KD86KFxcZCsoPzpcXC5cXGQrKT8pUyk/KT8kLztcblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUGVyaW9kKHRleHQpIHtcbiAgICBjb25zdCBtID0gUEVSSU9EX1JFLmV4ZWModGV4dCB8fCBcIlwiKTtcbiAgICBpZiAoIW0pIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICAgIHllYXJzOiArKG1bMV0gfHwgMCksIG1vbnRoczogKyhtWzJdIHx8IDApLCB3ZWVrczogKyhtWzNdIHx8IDApLCBkYXlzOiArKG1bNF0gfHwgMCksXG4gICAgICAgIGhvdXJzOiArKG1bNV0gfHwgMCksIG1pbnV0ZXM6ICsobVs2XSB8fCAwKSwgc2Vjb25kczogKyhtWzddIHx8IDApLFxuICAgIH07XG59XG5cbi8vIFllYXJzIGFuZCBtb250aHMgbW92ZSB0aHJvdWdoIHRoZSBVVEMgY2FsZW5kYXIgLS0gUDFNIGZyb20gSmFuIDMxIGxhbmRzIHdoZXJlIERhdGVcbi8vIGFyaXRobWV0aWMgcHV0cyBpdCwgbm90IGEgZml4ZWQgMzAgZGF5cyAtLSB3aGlsZSB0aGUgcmVzdCBpcyBwbGFpbiBtaWxsaXNlY29uZHMuXG5leHBvcnQgZnVuY3Rpb24gYWRkUGVyaW9kKG1zLCBwLCBzaWduID0gMSkge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShtcyk7XG4gICAgaWYgKHAueWVhcnMpIGQuc2V0VVRDRnVsbFllYXIoZC5nZXRVVENGdWxsWWVhcigpICsgc2lnbiAqIHAueWVhcnMpO1xuICAgIGlmIChwLm1vbnRocykgZC5zZXRVVENNb250aChkLmdldFVUQ01vbnRoKCkgKyBzaWduICogcC5tb250aHMpO1xuICAgIHJldHVybiBkLmdldFRpbWUoKSArIHNpZ24gKiAoKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDBcbiAgICAgICAgKyBwLmhvdXJzICogMzYwMCArIHAubWludXRlcyAqIDYwICsgcC5zZWNvbmRzKSAqIDEwMDApO1xufVxuXG4vLyBUaGUgc2xpZGVyJ3MgcG9zaXRpb25zOiBmcm9tIHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbiB0byB0aGUgZmlyc3QgdGljayBhdCBvciBwYXN0IHRoZVxuLy8gZmluYWwgb25lLCBvbmUgcGVyIHBlcmlvZC4gQ2FwcGVkIGJlY2F1c2UgYSBtaXN0eXBlZCBQVDFTIG92ZXIgYSB5ZWFyIG9mIGRhdGFcbi8vIHdvdWxkIG90aGVyd2lzZSBoYW5nIHRoZSB0YWIgYnVpbGRpbmcgYW4gYXJyYXkgb2YgbWlsbGlvbnMuXG5leHBvcnQgY29uc3QgTUFYX1RJQ0tTID0gNTAwMDtcblxuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlVGlja3Moc3RhcnRNcywgZW5kTXMsIHApIHtcbiAgICAvLyBUaGUgZmlyc3QgdGljayBzaXRzIEFUIHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbiwgbm90IG9uZSBwZXJpb2QgYWZ0ZXIgaXQ6IHdpbmRvd3NcbiAgICAvLyBhcmUgaGFsZi1vcGVuIChzdGFydCwgZW5kXSwgc28gYSBmaXJzdCB0aWNrIGF0IHN0YXJ0K1Agd291bGQgZXhjbHVkZSB0aGUgZWFybGllc3RcbiAgICAvLyBwb2ludCBmcm9tIGl0cyBvd24gd2luZG93IGFuZCBpdCB3b3VsZCBuZXZlciBkaXNwbGF5IGF0IGFueSB0aWNrLlxuICAgIGNvbnN0IHRpY2tzID0gW3N0YXJ0TXNdO1xuICAgIGxldCB0ID0gc3RhcnRNcztcbiAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIHdoaWxlICh0aWNrcy5sZW5ndGggPCBNQVhfVElDS1MpIHtcbiAgICAgICAgdCA9IGFkZFBlcmlvZCh0LCBwKTtcbiAgICAgICAgdGlja3MucHVzaCh0KTtcbiAgICAgICAgaWYgKHQgPj0gZW5kTXMpIHJldHVybiB0aWNrcztcbiAgICB9XG4gICAgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIHRpbWUgc2xpZGVyIGNhcHBlZCBhdCAke01BWF9USUNLU30gdGlja3M7IGAgK1xuICAgICAgICBgdGhlIHBlcmlvZCBpcyB0b28gZmluZSBmb3IgdGhlIGRhdGEncyBleHRlbnQuIFVzZSBhIGNvYXJzZXIgcGVyaW9kLmApO1xuICAgIHJldHVybiB0aWNrcztcbn1cblxuLy8gLS0tIHdpbmRvd3MgYW5kIGZpbHRlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBUaGUgaW50ZXJ2YWwgc2hvd24gYXQgb25lIHRpY2suIGR1cmF0aW9uIFwicGVyaW9kXCIgaXMgdGhlIHRpY2sncyBvd24gcGVyaW9kLCBzbyBhYnNlbmNlXG4vLyBpcyB2aXNpYmxlOyBudWxsIGFjY3VtdWxhdGVzIGV2ZXJ5dGhpbmcgc28gZmFyOyBhbiBJU08gc3RyaW5nIHRyYWlscyBhIGZpeGVkIHdpbmRvdy5cbmV4cG9ydCBmdW5jdGlvbiB3aW5kb3dGb3IodGljaywgZHVyYXRpb25TcGVjLCBwZXJpb2QpIHtcbiAgICBpZiAoZHVyYXRpb25TcGVjID09PSBudWxsIHx8IGR1cmF0aW9uU3BlYyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIH1cbiAgICBjb25zdCBwID0gZHVyYXRpb25TcGVjID09PSBcInBlcmlvZFwiID8gcGVyaW9kIDogcGFyc2VQZXJpb2QoZHVyYXRpb25TcGVjKTtcbiAgICBpZiAoIXApIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIHJldHVybiB7IHN0YXJ0OiBhZGRQZXJpb2QodGljaywgcCwgLTEpLCBlbmQ6IHRpY2sgfTtcbn1cblxuLy8gSGFsZi1vcGVuIChzdGFydCwgZW5kXTogYSBmZWF0dXJlIHN0YW1wZWQgZXhhY3RseSBvbiBhIHRpY2sgYm91bmRhcnkgYmVsb25ncyB0byB0aGVcbi8vIHBlcmlvZCB0aGF0IGVuZHMgdGhlcmUsIGFuZCBuZXZlciB0byB0d28gbmVpZ2hib3VyaW5nIHRpY2tzIGF0IG9uY2UuIE5hTiB0aW1lcyBtYXJrXG4vLyBmZWF0dXJlcyB0aGF0IGNhcnJpZWQgbm8gcmVhZGFibGUgdGltZTsgdGhleSBzdGF5IHZpc2libGUgcmF0aGVyIHRoYW4gdmFuaXNoaW5nLlxuZXhwb3J0IGZ1bmN0aW9uIGZlYXR1cmVJbldpbmRvdyhzdGFydE1zLCBlbmRNcywgd2luKSB7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydE1zKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGVuZE1zID4gd2luLnN0YXJ0ICYmIHN0YXJ0TXMgPD0gd2luLmVuZDtcbn1cblxuLy8gVGltZXMgdHJhdmVsIGFzIGEgRmxvYXQ2NEFycmF5IG9mIGludGVybGVhdmVkIFtzdGFydCwgZW5kXSBwYWlycyBpbiB0aGUgYnVmZmVyIG1hcCxcbi8vIHVuZGVyIFwiPGxheWVyIGlkPjo6dGltZXNcIiAtLSB0aGUgc2FtZSB0cmFuc3BvcnQgY29vcmRpbmF0ZXMgdXNlLlxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKSB7XG4gICAgY29uc3QgcmF3ID0gYnVmZmVycyAmJiBidWZmZXJzW2Ake2xheWVyLmlkfTo6dGltZXNgXTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xufVxuXG4vLyBXaGF0IHJlbmRlcmluZyB0aHJlYWRzIHRocm91Z2g6IHRoZSBjdXJyZW50IHRpY2sgcGx1cyB0aGUgc2hhcmVkIHBlcmlvZCwgb3IgbnVsbCB3aGVuXG4vLyBubyBzbGlkZXIgaXMgYWN0aXZlLiBFYWNoIGxheWVyIGRlcml2ZXMgaXRzIG93biB3aW5kb3cgZnJvbSB0aGVzZSwgc2luY2UgZHVyYXRpb24gaXNcbi8vIHBlciBsYXllciB3aGlsZSB0aGUgdGljayBpcyBzaGFyZWQuXG4vL1xuLy8gV2hldGhlciBhIHdob2xlIGxheWVyIHNob3dzIGF0IHRoZSBjdXJyZW50IHRpY2suIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lXG4vLyBnZW9tZXRyeSBwZXIgbGF5ZXIsIHNvIHRoZXkgYXJlIGluIG9yIG91dCBhcyBhIHVuaXQ7IGEgbGF5ZXIgd2l0aCBubyB0aW1lIG1ldGFkYXRhIGlzXG4vLyBub3QgdGhlIHNsaWRlcidzIHRvIGhpZGUuXG4vLyBUaGUgZHVyYXRpb24gYSBsYXllciBzaG93cyByaWdodCBub3cuIEEgd2luZG93IGRyYWdnZWQgb3V0IG9uIHRoZSBiYXIgaXMgYSB1c2VyXG4vLyBnZXN0dXJlIGFuZCBvdXRyYW5rcyBldmVyeSBsYXllcidzIGNvbmZpZ3VyZWQgZHVyYXRpb24gd2hpbGUgaXQgaXMgYWN0aXZlIC0tIHdoZW4gdGhlXG4vLyB1c2VyIGdyYWJzIHRoZSBiYXIsIHRoZSBiYXIgdGVsbHMgdGhlIHRydXRoIGZvciBldmVyeXRoaW5nLiBTbmFwcGluZyB0aGUgaGFuZGxlIGJhY2tcbi8vIG9udG8gdGhlIHRodW1iIGNsZWFycyB0aGUgb3ZlcnJpZGUgYW5kIGxheWVycyByZXR1cm4gdG8gdGhlaXIgb3duIHNldHRpbmdzLlxuZXhwb3J0IGZ1bmN0aW9uIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpIHtcbiAgICByZXR1cm4gdGltZVN0YXRlLndpbmRvdyB8fCAobGF5ZXIudGltZSAmJiBsYXllci50aW1lLmR1cmF0aW9uKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxheWVySW5XaW5kb3cobGF5ZXIsIGJ1ZmZlcnMsIHRpbWVTdGF0ZSkge1xuICAgIGlmICghbGF5ZXIudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcbiAgICBpZiAoIXRpbWVzIHx8IHRpbWVzLmxlbmd0aCA8IDIpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xuICAgIHJldHVybiBmZWF0dXJlSW5XaW5kb3codGltZXNbMF0sIHRpbWVzWzFdLCB3aW4pO1xufVxuXG4vLyBUaGUgZXh0ZW50IG9mIGV2ZXJ5IHRpbWUgbGF5ZXIncyBvYnNlcnZhdGlvbnMsIE5hTi1ibGluZC4gRmVlZHMgdGljayBnZW5lcmF0aW9uLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RUaW1lRXh0ZW50KGxheWVycywgYnVmZmVycykge1xuICAgIGxldCBtaW4gPSBJbmZpbml0eSwgbWF4ID0gLUluZmluaXR5O1xuICAgIGNvbnN0IHZpc2l0ID0gKGxpc3QpID0+IGxpc3QuZm9yRWFjaChsYXllciA9PiB7XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsYXllci5sYXllcnMgfHwgW10pO1xuICAgICAgICBpZiAoIWxheWVyLnRpbWUpIHJldHVybjtcbiAgICAgICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihsYXllciwgYnVmZmVycyk7XG4gICAgICAgIGlmICghdGltZXMpIHJldHVybjtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgaWYgKHRpbWVzW2ldIDwgbWluKSBtaW4gPSB0aW1lc1tpXTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpICsgMV0gPiBtYXgpIG1heCA9IHRpbWVzW2kgKyAxXTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHZpc2l0KGxheWVycyk7XG4gICAgcmV0dXJuIG1pbiA9PT0gSW5maW5pdHkgPyBudWxsIDogeyBtaW4sIG1heCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzVGltZUxheWVycyhsYXllcnMpIHtcbiAgICByZXR1cm4gbGF5ZXJzLnNvbWUobCA9PiBsLnR5cGUgPT09IFwiZ3JvdXBcIlxuICAgICAgICA/IGhhc1RpbWVMYXllcnMobC5sYXllcnMgfHwgW10pXG4gICAgICAgIDogQm9vbGVhbihsLnRpbWUpKTtcbn1cblxuLy8gT25lIHBsYXliYWNrIHN0ZXA6IHRoZSBuZXh0IGluZGV4IGFuZCB3aGV0aGVyIHBsYXliYWNrIHN1cnZpdmVzIGl0LiBQdXJlIHNvIHRoZSBsb29wXG4vLyBzZW1hbnRpY3MgYXJlIHRlc3RhYmxlIHdpdGhvdXQgYSB0aW1lciAtLSBsb29waW5nIHdyYXBzIGFuZCBrZWVwcyBwbGF5aW5nLCB0aGUgZW5kXG4vLyB3aXRob3V0IGxvb3Agc3RvcHMgd2hlcmUgaXQgaXMuXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZShpbmRleCwgbGVuZ3RoLCBsb29wKSB7XG4gICAgaWYgKGluZGV4IDwgbGVuZ3RoIC0gMSkgcmV0dXJuIHsgaW5kZXg6IGluZGV4ICsgMSwgcGxheWluZzogdHJ1ZSB9O1xuICAgIGlmIChsb29wKSByZXR1cm4geyBpbmRleDogMCwgcGxheWluZzogdHJ1ZSB9O1xuICAgIHJldHVybiB7IGluZGV4LCBwbGF5aW5nOiBmYWxzZSB9O1xufVxuXG4vLyBXaGVyZSB0aGUgY29udHJvbCBzaXRzLCBhcyBpbmxpbmUgc3R5bGVzIHNvIHRoZSBjaG9pY2UgdHJhdmVscyB3aXRoIHRoZSBzdGF0ZSByYXRoZXJcbi8vIHRoYW4gbmVlZGluZyBhIHN0eWxlc2hlZXQgcnVsZSBwZXIgY29ybmVyLiBFdmVyeSBwcm9wZXJ0eSBpcyB3cml0dGVuIG9uIGV2ZXJ5IHJlbmRlciAtLVxuLy8gaW5jbHVkaW5nIHRoZSBvbmVzIGEgcG9zaXRpb24gZG9lcyBub3QgdXNlIC0tIHNvIG1vdmluZyB0aGUgY29udHJvbCBjbGVhcnMgdGhlIG9sZFxuLy8gYW5jaG9yIGluc3RlYWQgb2YgYWNjdW11bGF0aW5nIGJvdGguXG5leHBvcnQgY29uc3QgUE9TSVRJT05TID0ge1xuICAgIFwidG9wLWxlZnRcIjogICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcInRvcC1jZW50ZXJcIjogICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJ0b3AtcmlnaHRcIjogICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxuICAgIFwibGVmdC1jZW50ZXJcIjogICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcbiAgICBcInJpZ2h0LWNlbnRlclwiOiAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tbGVmdFwiOiAgIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJcIiB9LFxuICAgIFwiYm90dG9tLWNlbnRlclwiOiB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcbiAgICBcImJvdHRvbS1yaWdodFwiOiAgeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG59O1xuXG5mdW5jdGlvbiBhcHBseVBvc2l0aW9uKGVsLCBwb3NpdGlvbikge1xuICAgIGNvbnN0IHN0eWxlcyA9IFBPU0lUSU9OU1twb3NpdGlvbl0gfHwgUE9TSVRJT05TW1widG9wLWNlbnRlclwiXTtcbiAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3R5bGVzKSkge1xuICAgICAgICBlbC5zdHlsZVtwcm9wXSA9IHZhbHVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0VVRDKG1zKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDE5KS5yZXBsYWNlKFwiVFwiLCBcIiBcIikgKyBcIlpcIjtcbn1cblxuLy8gLS0tIHRoZSB3aW5kb3cgYW5kIHRoZSBydWxlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBGaXhlZCBtaWxsaXNlY29uZHMgZm9yIGEgcGVyaW9kLCBvciBudWxsIHdoZW4gaXQgbW92ZXMgdGhyb3VnaCB0aGUgY2FsZW5kYXIgKG1vbnRocyxcbi8vIHllYXJzKSBhbmQgaGFzIG5vIGZpeGVkIHdpZHRoLiBUaGUgcnVsZXIgYW5kIHRoZSBkcmFnIGdyaWQgbmVlZCBmaXhlZCB3aWR0aHM7IGNhbGVuZGFyXG4vLyBwZXJpb2RzIGZhbGwgYmFjayB0byB0aGUgdGljayBwb3NpdGlvbnMgdGhlbXNlbHZlcy5cbmV4cG9ydCBmdW5jdGlvbiBwZXJpb2RUb01zKHApIHtcbiAgICBpZiAoIXAgfHwgcC55ZWFycyB8fCBwLm1vbnRocykgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuICgocC53ZWVrcyAqIDcgKyBwLmRheXMpICogMjQgKiAzNjAwICsgcC5ob3VycyAqIDM2MDBcbiAgICAgICAgKyBwLm1pbnV0ZXMgKiA2MCArIHAuc2Vjb25kcykgKiAxMDAwO1xufVxuXG4vLyBNaWxsaXNlY29uZHMgYXMgYW4gSVNPODYwMSBkdXJhdGlvbiwgaG91cnMvbWludXRlcy9zZWNvbmRzIG9ubHkgLS0gUFQyNkggaXMgdmFsaWQgYW5kXG4vLyBhdm9pZHMgY2FsZW5kYXIgdW5pdHMgZW50aXJlbHksIHNvIHdoYXQgdGhlIGRyYWcgd3JpdGVzIGFsd2F5cyBwYXJzZXMgYmFjayBleGFjdGx5LlxuZXhwb3J0IGZ1bmN0aW9uIG1zVG9QZXJpb2RJU08obXMpIHtcbiAgICBsZXQgcmVzdCA9IE1hdGgucm91bmQobXMgLyAxMDAwKTtcbiAgICBjb25zdCBoID0gTWF0aC5mbG9vcihyZXN0IC8gMzYwMCk7IHJlc3QgLT0gaCAqIDM2MDA7XG4gICAgY29uc3QgbSA9IE1hdGguZmxvb3IocmVzdCAvIDYwKTsgcmVzdCAtPSBtICogNjA7XG4gICAgbGV0IG91dCA9IFwiUFRcIjtcbiAgICBpZiAoaCkgb3V0ICs9IGAke2h9SGA7XG4gICAgaWYgKG0pIG91dCArPSBgJHttfU1gO1xuICAgIGlmIChyZXN0IHx8IG91dCA9PT0gXCJQVFwiKSBvdXQgKz0gYCR7cmVzdH1TYDtcbiAgICByZXR1cm4gb3V0O1xufVxuXG4vLyBUaGUgcnVsZXIncyBpbmNyZW1lbnQ6IHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBldmVyeSBib3VuZGFyeSB0aGUgdXNlciBjYW4gY2FyZVxuLy8gYWJvdXQgLS0gdGhlIGdjZCBvZiB0aGUgaW50ZXJ2YWwgYW5kIGV2ZXJ5IGF0dGFjaGVkIGR1cmF0aW9uLiBBbiBpbnRlcnZhbCBvZiAxaCB3aXRoIGFcbi8vIDIuNWggZHVyYXRpb24gbmVlZHMgMzAtbWludXRlIG1hcmtzIGZvciB0aGUgZHVyYXRpb24gdG8gc2l0IG9uIG9uZTsgMWggYW5kIDJoIG5lZWQgb25seVxuLy8gdGhlIGhvdXJzLiBcIkxvd2VzdCBkdXJhdGlvblwiIGlzIHRoZSBzcGVjaWFsIGNhc2Ugd2hlcmUgb25lIGRpdmlkZXMgdGhlIG90aGVyLlxuZXhwb3J0IGZ1bmN0aW9uIGdjZEdyaWRNcyhwZXJpb2RNcywgZHVyYXRpb25zTXMpIHtcbiAgICBjb25zdCBnY2QgPSAoYSwgYikgPT4gKGIgPyBnY2QoYiwgYSAlIGIpIDogYSk7XG4gICAgbGV0IGdyaWQgPSBwZXJpb2RNcztcbiAgICBmb3IgKGNvbnN0IGQgb2YgZHVyYXRpb25zTXMpIHtcbiAgICAgICAgaWYgKGQgPiAwKSBncmlkID0gZ2NkKGdyaWQsIE1hdGgucm91bmQoZCkpO1xuICAgIH1cbiAgICByZXR1cm4gTWF0aC5tYXgoZ3JpZCwgMTAwMCk7XG59XG5cbi8vIEV2ZXJ5IGZpbml0ZSBkdXJhdGlvbiBhdHRhY2hlZCB0byBhIHRpbWUgbGF5ZXIsIGluIG1zLCBmb3IgdGhlIGdyaWQuIFwicGVyaW9kXCIgYW5kIG51bGxcbi8vIGNvbnRyaWJ1dGUgbm90aGluZyBuZXc7IGNhbGVuZGFyIGR1cmF0aW9ucyBjYW5ub3Qgam9pbiBhIGZpeGVkLW1zIGdyaWQgYW5kIGFyZSBza2lwcGVkLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllcnMsIHdpbmRvd0lzbykge1xuICAgIGNvbnN0IG91dCA9IFtdO1xuICAgIGNvbnN0IHZpc2l0ID0gbGlzdCA9PiBsaXN0LmZvckVhY2gobCA9PiB7XG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIikgcmV0dXJuIHZpc2l0KGwubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgY29uc3Qgc3BlYyA9IGwudGltZSAmJiBsLnRpbWUuZHVyYXRpb247XG4gICAgICAgIGlmICh0eXBlb2Ygc3BlYyA9PT0gXCJzdHJpbmdcIiAmJiBzcGVjICE9PSBcInBlcmlvZFwiKSB7XG4gICAgICAgICAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xuICAgICAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIGlmICh3aW5kb3dJc28pIHtcbiAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHdpbmRvd0lzbykpO1xuICAgICAgICBpZiAobXMpIG91dC5wdXNoKG1zKTtcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gVGljayBtYXJrcyBmb3IgdGhlIHRyYWNrOiBtYWpvcnMgYXQgZXZlcnkgaW50ZXJ2YWwgYm91bmRhcnkgKHNwYXJzZWx5IGxhYmVsbGVkIHNvIGxvbmdcbi8vIHRpbWVsaW5lcyBzdGF5IHJlYWRhYmxlKSwgdW5sYWJlbGxlZCBtaW5vcnMgYXQgdGhlIGdyaWQgaW4gYmV0d2Vlbi4gTWlub3IgRElTUExBWSBpc1xuLy8gdGhpbm5lZCB3aGVuIGRlbnNlOyB0aGUgc25hcCBncmlkIHN0YXlzIGV4YWN0LCBzbyBhIG1hcmsgaXMgYSBndWlkZSwgbm90IGEgY29uc3RyYWludC5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJ1bGVyKHRpY2tzLCBncmlkTXMsIGZvcm1hdExhYmVsLCB7IG1heExhYmVscyA9IDYsIG1heE1pbm9ycyA9IDI0MCB9ID0ge30pIHtcbiAgICBpZiAodGlja3MubGVuZ3RoIDwgMikgcmV0dXJuIFtdO1xuICAgIGNvbnN0IHQwID0gdGlja3NbMF0sIHNwYW4gPSB0aWNrc1t0aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xuICAgIGNvbnN0IG1hcmtzID0gW107XG4gICAgY29uc3QgbGFiZWxFdmVyeSA9IE1hdGgubWF4KDEsIE1hdGguY2VpbCh0aWNrcy5sZW5ndGggLyBtYXhMYWJlbHMpKTtcbiAgICB0aWNrcy5mb3JFYWNoKCh0LCBpKSA9PiBtYXJrcy5wdXNoKHtcbiAgICAgICAgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IHRydWUsXG4gICAgICAgIGxhYmVsOiBpICUgbGFiZWxFdmVyeSA9PT0gMCA/IGZvcm1hdExhYmVsKHQpIDogbnVsbCxcbiAgICB9KSk7XG4gICAgaWYgKGdyaWRNcyAmJiBncmlkTXMgPCBzcGFuKSB7XG4gICAgICAgIGNvbnN0IHRvdGFsID0gTWF0aC5mbG9vcihzcGFuIC8gZ3JpZE1zKTtcbiAgICAgICAgY29uc3QgdGhpbiA9IE1hdGgubWF4KDEsIE1hdGguY2VpbCh0b3RhbCAvIG1heE1pbm9ycykpO1xuICAgICAgICBmb3IgKGxldCBrID0gMTsgayAqIGdyaWRNcyA8IHNwYW47IGsgKz0gdGhpbikge1xuICAgICAgICAgICAgY29uc3QgdCA9IHQwICsgayAqIGdyaWRNcztcbiAgICAgICAgICAgIGlmICh0aWNrcy5pbmNsdWRlcyh0KSkgY29udGludWU7XG4gICAgICAgICAgICBtYXJrcy5wdXNoKHsgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IGZhbHNlLCBsYWJlbDogbnVsbCB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbWFya3M7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRUaWNrTGFiZWwobXMsIHBlcmlvZE1zKSB7XG4gICAgY29uc3QgaXNvID0gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKCk7XG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCA2MCAqIDEwMDApIHJldHVybiBpc28uc2xpY2UoMTEsIDE5KTtcbiAgICBpZiAocGVyaW9kTXMgIT0gbnVsbCAmJiBwZXJpb2RNcyA8IDI0ICogMzYwMCAqIDEwMDApIHJldHVybiBpc28uc2xpY2UoMTEsIDE2KTtcbiAgICByZXR1cm4gaXNvLnNsaWNlKDUsIDEwKTtcbn1cblxuLy8gR2x5cGhzIGFzIGlubGluZSBTVkcgcmF0aGVyIHRoYW4gdGV4dDogXCJcdTIxQkJcIiByZWFkcyBhcyByZWZyZXNoIC0tIGEgbG9vcCB0b2dnbGUgZHJhd24gd2l0aFxuLy8gaXQgbG9va3MgbGlrZSBhIHJlc2V0IGJ1dHRvbiwgd2hpY2ggaXMgZXhhY3RseSBob3cgaXQgZ290IG1pc3JlYWQuIGN1cnJlbnRDb2xvciBsZXRzXG4vLyB0aGUgcHJlc3NlZCBzdGF0ZSByZXN0eWxlIHRoZW0gZnJvbSBDU1MuXG5jb25zdCBJQ09OUyA9IHtcbiAgICBiYWNrOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNMyAyaDJ2MTJIM3pNMTMgMiA2IDhsNyA2elwiLz48L3N2Zz4nLFxuICAgIHBsYXk6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJsOSA2LTkgNnpcIi8+PC9zdmc+JyxcbiAgICBwYXVzZTogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTQgMmgzdjEySDR6TTkgMmgzdjEySDl6XCIvPjwvc3ZnPicsXG4gICAgZndkOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNMTEgMmgydjEyaC0yek0zIDJsNyA2LTcgNnpcIi8+PC9zdmc+JyxcbiAgICBsb29wOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNOCAyYTYgNiAwIDAgMSA1LjY1IDRIMTZsLTIuOCAzLjVMMTAuNCA2aDIuMUE0LjUgNC41IDAgMSAwIDEyLjUgMTBsMS4zLjc1QTYgNiAwIDEgMSA4IDJ6XCIvPjwvc3ZnPicsXG59O1xuXG4vLyAtLS0gdGhlIGNvbnRyb2wgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBsYWluIERPTSBpbnNpZGUgdGhlIHdpZGdldCBjb250YWluZXIsIGxpa2UgdGhlIHNpZGViYXI6IG5vIExlYWZsZXQgY29udHJvbCBtYWNoaW5lcnksXG4vLyB3aGljaCBrZWVwcyBpdCB0ZXN0YWJsZSBpbiBqc2RvbSBhbmQgc3R5bGVhYmxlIGZyb20gbWFwLmNzcy4gVGhlIGxheW91dCBmb2xsb3dzXG4vLyBMZWFmbGV0LlRpbWVEaW1lbnNpb24ncyBjb250cm9sIC0tIHN0ZXAvcGxheS9zdGVwL2xvb3AgYXMgYSBqb2luZWQgYnV0dG9uIGJhciwgdGhlbiB0aGVcbi8vIGRhdGUsIHNsaWRlciBhbmQgc3BlZWQgLS0gc2luY2UgdGhhdCBpcyB0aGUgc2xpZGVyIHVzZXJzIG9mIHRoZSBmb2xpdW0gYXBwcyBrbm93LlxuLy9cbi8vIFRoZSBzbGlkZXIgaXMgYSBjb21wb3NpdGUuIEEgbmF0aXZlIDxpbnB1dCB0eXBlPXJhbmdlPiBzdGF5cyBvbiB0b3AgYXMgdGhlIHRodW1iOiBpdFxuLy8ga2VlcHMga2V5Ym9hcmQgYXJyb3dzLCBzY3JlZW4gcmVhZGVycyBhbmQgZXZlcnkgZXhpc3RpbmcgdGVzdCB3b3JraW5nLCBhbmQgcGxheWJhY2tcbi8vIGRyaXZlcyBpdCBhcyBiZWZvcmUuIFVuZGVybmVhdGggc2l0IHRoZSBwYXJ0cyBhIG5hdGl2ZSBpbnB1dCBjYW5ub3QgZHJhdzogdGhlIHdpbmRvd1xuLy8gc3BhbiBzaG93aW5nIGV4YWN0bHkgd2hhdCBpbnRlcnZhbCBpcyBvbiB0aGUgbWFwLCBhIHJ1bGVyIHdpdGggbGFiZWxsZWQgaW50ZXJ2YWwgbWFya3Ncbi8vIGFuZCB1bmxhYmVsbGVkIGdjZCBtaW5vcnMsIGFuZCB0aGUgdHJhaWwgaGFuZGxlIC0tIGRyYWcgaXQgYmFjayB0byB3aWRlbiB0aGUgd2luZG93IGZvclxuLy8gZXZlcnkgbGF5ZXIgYXQgb25jZSwgZHJvcCBpdCBvbnRvIHRoZSB0aHVtYiB0byBoYW5kIGNvbnRyb2wgYmFjayB0byBwZXItbGF5ZXIgZHVyYXRpb25zLlxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclRpbWVDb250cm9sKGNvbnRhaW5lciwgc3RhdGUsIGhhbmRsZXJzKSB7XG4gICAgbGV0IGVsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1jb250cm9sXCIpO1xuICAgIGlmICghc3RhdGUudGlja3MgfHwgc3RhdGUudGlja3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmIChlbCkgZWwucmVtb3ZlKCk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoIWVsKSB7XG4gICAgICAgIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgZWwuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLWNvbnRyb2xcIjtcbiAgICAgICAgZWwuaW5uZXJIVE1MID0gYFxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1iYWNrXCIgdGl0bGU9XCJTdGVwIGJhY2tcIiBhcmlhLWxhYmVsPVwiU3RlcCBiYWNrXCI+JHtJQ09OUy5iYWNrfTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXBsYXlcIiBhcmlhLWxhYmVsPVwiUGxheVwiPiR7SUNPTlMucGxheX08L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1md2RcIiB0aXRsZT1cIlN0ZXAgZm9yd2FyZFwiIGFyaWEtbGFiZWw9XCJTdGVwIGZvcndhcmRcIj4ke0lDT05TLmZ3ZH08L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sb29wXCIgYXJpYS1sYWJlbD1cIkxvb3BcIj4ke0lDT05TLmxvb3B9PC9idXR0b24+XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbGFiZWxcIj48L3NwYW4+XG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtdHJhY2tcIj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFzZVwiPjwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc3BhblwiPjwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtcnVsZXJcIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPGlucHV0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zbGlkZXJcIiB0eXBlPVwicmFuZ2VcIiBtaW49XCIwXCIgc3RlcD1cIjFcIj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtdHJhaWxcIiByb2xlPVwic2xpZGVyXCIgdGFiaW5kZXg9XCIwXCJcbiAgICAgICAgICAgICAgICAgICAgICBhcmlhLWxhYmVsPVwiVHJhaWxpbmcgd2luZG93XCIgdGl0bGU9XCJEcmFnIGJhY2sgdG8gd2lkZW4gdGhlIHRpbWUgd2luZG93OyBkcm9wIG9uIHRoZSB0aHVtYiB0byBjbGVhclwiPjwvc3Bhbj5cbiAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgIDxzZWxlY3QgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwZWVkXCIgdGl0bGU9XCJQbGF5YmFjayBzcGVlZFwiPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIwLjVcIj4wLjV4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjFcIj4xeDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIyXCI+Mng8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiNFwiPjR4PC9vcHRpb24+XG4gICAgICAgICAgICA8L3NlbGVjdD5gO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoZWwpO1xuXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1iYWNrXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBCYWNrKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWZ3ZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwRm9yd2FyZCk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblBsYXlUb2dnbGUpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25Mb29wVG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIixcbiAgICAgICAgICAgIGUgPT4gaGFuZGxlcnMub25TcGVlZChwYXJzZUZsb2F0KGUudGFyZ2V0LnZhbHVlKSkpO1xuICAgICAgICBjb25zdCBzbGlkZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpO1xuICAgICAgICAvLyBgaW5wdXRgIGZpcmVzIHBlciBkcmFnIHN0ZXAgZm9yIGxpdmUgc2NydWJiaW5nOyB0aGUgbW9kZWwgd3JpdGViYWNrIGlzIHRoZVxuICAgICAgICAvLyBoYW5kbGVyJ3MgcHJvYmxlbSwgdGhyb3R0bGVkIHRoZXJlIHNvIGRyYWdnaW5nIGRvZXMgbm90IGZsb29kIHRoZSBrZXJuZWwuXG4gICAgICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgZSA9PiBoYW5kbGVycy5vblNlZWsocGFyc2VJbnQoZS50YXJnZXQudmFsdWUsIDEwKSkpO1xuXG4gICAgICAgIGF0dGFjaFRyYWlsRHJhZyhlbCwgaGFuZGxlcnMpO1xuICAgIH1cblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikubWF4ID0gU3RyaW5nKHN0YXRlLnRpY2tzLmxlbmd0aCAtIDEpO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuaW5kZXgpO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sYWJlbFwiKS50ZXh0Q29udGVudCA9IGZvcm1hdFVUQyhzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF0pO1xuXG4gICAgY29uc3QgcGxheSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpO1xuICAgIHBsYXkuaW5uZXJIVE1MID0gc3RhdGUucGxheWluZyA/IElDT05TLnBhdXNlIDogSUNPTlMucGxheTtcbiAgICBwbGF5LnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiKTtcbiAgICBwbGF5LnRpdGxlID0gc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiO1xuXG4gICAgLy8gQSBtb2RlLCBub3QgYW4gYWN0aW9uOiBwcmVzc2VkIHN0eWxpbmcgYW5kIGFyaWEtcHJlc3NlZCBzYXkgXCJ0aGlzIHN0YXlzIG9uXCIsXG4gICAgLy8gd2hlcmUgYSBiYXJlIGljb24gaW52aXRlZCBhIGNsaWNrIGV4cGVjdGluZyBzb21ldGhpbmcgdG8gaGFwcGVuIHJpZ2h0IG5vdy5cbiAgICBjb25zdCBsb29wID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIik7XG4gICAgbG9vcC5jbGFzc0xpc3QudG9nZ2xlKFwiYWN0aXZlXCIsIEJvb2xlYW4oc3RhdGUubG9vcCkpO1xuICAgIGxvb3Auc2V0QXR0cmlidXRlKFwiYXJpYS1wcmVzc2VkXCIsIFN0cmluZyhCb29sZWFuKHN0YXRlLmxvb3ApKSk7XG4gICAgbG9vcC50aXRsZSA9IHN0YXRlLmxvb3AgPyBcIkxvb3A6IG9uXCIgOiBcIkxvb3A6IG9mZlwiO1xuXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLnNwZWVkIHx8IDEpO1xuICAgIHJlbmRlclRyYWNrKGVsLCBzdGF0ZSk7XG4gICAgYXBwbHlQb3NpdGlvbihlbCwgc3RhdGUucG9zaXRpb24pO1xuICAgIHJldHVybiBlbDtcbn1cblxuLy8gR2VvbWV0cnkgc2hhcmVkIGJ5IHJlbmRlcmluZyBhbmQgZHJhZ2dpbmc6IHdoZXJlIGEgdGltZSBzaXRzIG9uIHRoZSB0cmFjaywgMC4uMS5cbmZ1bmN0aW9uIHRyYWNrRnJhY3Rpb24odGlja3MsIHQpIHtcbiAgICBjb25zdCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0aWNrc1swXTtcbiAgICBpZiAoc3BhbiA8PSAwKSByZXR1cm4gMTtcbiAgICByZXR1cm4gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgKHQgLSB0aWNrc1swXSkgLyBzcGFuKSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclRyYWNrKGVsLCBzdGF0ZSkge1xuICAgIGNvbnN0IHsgdGlja3MsIGluZGV4IH0gPSBzdGF0ZTtcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcbiAgICB0cmFjay5fc3RhdGUgPSBzdGF0ZTsgICAgICAvLyB0aGUgZHJhZyBoYW5kbGVyIHJlYWRzIHRoZSBmcmVzaGVzdCBzdGF0ZSBmcm9tIGhlcmVcblxuICAgIGNvbnN0IHRodW1iVCA9IHRpY2tzW2luZGV4XTtcbiAgICBjb25zdCBwZXJpb2RNcyA9IHN0YXRlLnBlcmlvZE1zO1xuICAgIGNvbnN0IHdpbmRvd01zID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IG51bGw7XG4gICAgY29uc3Qgc2hvd25NcyA9IHdpbmRvd01zICE9IG51bGwgPyB3aW5kb3dNcyA6IHBlcmlvZE1zO1xuXG4gICAgLy8gVGhlIHNwYW46IHdoYXQgaW50ZXJ2YWwgdGhlIG1hcCBpcyBzaG93aW5nIHJpZ2h0IG5vdy4gVGhlIHNwYW4gZGVwaWN0cyB0aGUgc2hhcmVkXG4gICAgLy8gd2luZG93IC0tIG9uZSBwZXJpb2QgYnkgZGVmYXVsdCAtLSBhbmQgcGVyLWxheWVyIGR1cmF0aW9ucyByZW1haW4gYW4gQVBJIGNvbmNlcm5cbiAgICAvLyB1bnRpbCBhIGRyYWcgb3ZlcnJpZGVzIHRoZW0gZm9yIGV2ZXJ5dGhpbmcgYXQgb25jZS5cbiAgICBjb25zdCBzcGFuID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwYW5cIik7XG4gICAgY29uc3QgcmlnaHQgPSB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQpO1xuICAgIGNvbnN0IGxlZnQgPSBzaG93bk1zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSBzaG93bk1zKSA6IDA7XG4gICAgc3Bhbi5zdHlsZS5sZWZ0ID0gYCR7KGxlZnQgKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgc3Bhbi5zdHlsZS53aWR0aCA9IGAkeyhNYXRoLm1heCgwLCByaWdodCAtIGxlZnQpICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHNwYW4uY2xhc3NMaXN0LnRvZ2dsZShcIm92ZXJyaWRlXCIsIHdpbmRvd01zICE9IG51bGwpO1xuXG4gICAgLy8gVGhlIHRyYWlsIGhhbmRsZSBwYXJrcyBPTiB0aGUgdGh1bWIgd2hlbiBubyBvdmVycmlkZSBpcyBhY3RpdmUgLS0gXCJub3QgZ3JhYmJlZFwiIC0tXG4gICAgLy8gYW5kIHNpdHMgYXQgdGhlIHdpbmRvdydzIHN0YXJ0IHdoaWxlIG9uZSBpcy4gRHJvcHBpbmcgaXQgYmFjayBvbiB0aGUgdGh1bWIgY2xlYXJzLlxuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xuICAgIGNvbnN0IGF0ID0gd2luZG93TXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHdpbmRvd01zKSA6IHJpZ2h0O1xuICAgIHRyYWlsLnN0eWxlLmxlZnQgPSBgJHsoYXQgKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgdHJhaWwuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcbiAgICB0cmFpbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLXZhbHVldGV4dFwiLCBzdGF0ZS53aW5kb3cgfHwgXCJubyB0cmFpbGluZyB3aW5kb3dcIik7XG4gICAgLy8gTm8gZml4ZWQtbXMgZ3JpZCAoY2FsZW5kYXIgcGVyaW9kcykgbWVhbnMgbm90aGluZyBzZW5zaWJsZSB0byBzbmFwIHRvLlxuICAgIHRyYWlsLnN0eWxlLmRpc3BsYXkgPSBzdGF0ZS5ncmlkTXMgPyBcIlwiIDogXCJub25lXCI7XG5cbiAgICBjb25zdCBydWxlciA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1ydWxlclwiKTtcbiAgICBjb25zdCBrZXkgPSBgJHt0aWNrc1swXX18JHt0aWNrcy5sZW5ndGh9fCR7c3RhdGUuZ3JpZE1zfXwke3BlcmlvZE1zfWA7XG4gICAgaWYgKHJ1bGVyLl9rZXkgIT09IGtleSkge1xuICAgICAgICBydWxlci5fa2V5ID0ga2V5O1xuICAgICAgICBydWxlci5pbm5lckhUTUwgPSBcIlwiO1xuICAgICAgICBmb3IgKGNvbnN0IG1hcmsgb2YgYnVpbGRSdWxlcih0aWNrcywgc3RhdGUuZ3JpZE1zLCB0ID0+IGZvcm1hdFRpY2tMYWJlbCh0LCBwZXJpb2RNcykpKSB7XG4gICAgICAgICAgICBjb25zdCBtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICBtLmNsYXNzTmFtZSA9IG1hcmsubWFqb3IgPyBcInN3aWZ0bWFwLXRpbWUtbWFyayBtYWpvclwiIDogXCJzd2lmdG1hcC10aW1lLW1hcmtcIjtcbiAgICAgICAgICAgIG0uc3R5bGUubGVmdCA9IGAkeyhtYXJrLmZyYWN0aW9uICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgICAgICAgICAgaWYgKG1hcmsubGFiZWwpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsYWIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgICAgICAgICBsYWIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLW1hcmstbGFiZWxcIjtcbiAgICAgICAgICAgICAgICBsYWIudGV4dENvbnRlbnQgPSBtYXJrLmxhYmVsO1xuICAgICAgICAgICAgICAgIG0uYXBwZW5kQ2hpbGQobGFiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJ1bGVyLmFwcGVuZENoaWxkKG0pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyBEcmFnZ2luZyB0aGUgdHJhaWwgaGFuZGxlLiBTbmFwcyB0byB0aGUgZ2NkIGdyaWQgc28gZXZlcnkgc3RvcCBpcyBhIGJvdW5kYXJ5IHRoZSBkYXRhXG4vLyBvciB0aGUgaW50ZXJ2YWwgYWN0dWFsbHkgbmFtZXM7IHRoZSBkaXN0YW5jZSB0byB0aGUgdGh1bWIsIGluIHdob2xlIGdyaWQgc3RlcHMsIElTIHRoZVxuLy8gd2luZG93LiBaZXJvIHN0ZXBzIC0tIGRyb3BwZWQgb24gdGhlIHRodW1iIC0tIGNsZWFycyB0aGUgb3ZlcnJpZGUuXG5mdW5jdGlvbiBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKSB7XG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XG4gICAgY29uc3QgdHJhaWwgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhaWxcIik7XG5cbiAgICBmdW5jdGlvbiBpc29Gcm9tRXZlbnQoZXYpIHtcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XG4gICAgICAgIGNvbnN0IHJlY3QgPSB0cmFjay5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUuZ3JpZE1zIHx8IHJlY3Qud2lkdGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIC8vIERlbGliZXJhdGVseSB1bmNsYW1wZWQgb24gdGhlIGxlZnQ6IHRoZSB3aW5kb3cgaXMgXCJob3cgZmFyIGJhY2sgZnJvbSB0aGVcbiAgICAgICAgLy8gbGVhZCBwb2ludFwiLCBhbmQgdGhhdCBtYXkgcmVhY2ggcGFzdCB0aGUgYmFyJ3Mgc3RhcnQgLS0gZXNwZWNpYWxseSB3aGVuIHRoZVxuICAgICAgICAvLyBsZWFkIHNpdHMgZWFybHkgb24gdGhlIGJhciBhbmQgbW9zdCBvZiBpdHMgdHJhaWwgaXMgb2ZmLXNjcmVlbi4gQ2xhbXBpbmcgaGVyZVxuICAgICAgICAvLyBjYXBwZWQgdGhlIHdpbmRvdyBhdCB0aGUgdmlzaWJsZSBwYXN0LCB3aGljaCBwaW5uZWQgdGhlIGhhbmRsZSB0byB0aGUgYmFyJ3NcbiAgICAgICAgLy8gc3RhcnQgYW5kIG1hZGUgYW55dGhpbmcgd2lkZXIgaW1wb3NzaWJsZSB0byBzZXQuIE9ubHkgdGhlIERSQVdJTkcgY2xhbXBzLlxuICAgICAgICBjb25zdCBmcmFjID0gTWF0aC5taW4oMSwgKGV2LmNsaWVudFggLSByZWN0LmxlZnQpIC8gcmVjdC53aWR0aCk7XG4gICAgICAgIGNvbnN0IHQwID0gc3RhdGUudGlja3NbMF07XG4gICAgICAgIGNvbnN0IHNwYW5NcyA9IHN0YXRlLnRpY2tzW3N0YXRlLnRpY2tzLmxlbmd0aCAtIDFdIC0gdDA7XG4gICAgICAgIGNvbnN0IHRodW1iVCA9IHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XTtcbiAgICAgICAgY29uc3QgZGlzdCA9IHRodW1iVCAtICh0MCArIGZyYWMgKiBzcGFuTXMpO1xuICAgICAgICBjb25zdCBzdGVwcyA9IE1hdGgubWF4KDAsIE1hdGgucm91bmQoZGlzdCAvIHN0YXRlLmdyaWRNcykpO1xuICAgICAgICByZXR1cm4gc3RlcHMgPT09IDAgPyBudWxsIDogbXNUb1BlcmlvZElTTyhzdGVwcyAqIHN0YXRlLmdyaWRNcyk7XG4gICAgfVxuXG4gICAgLy8gTW92ZSBhbmQgcmVsZWFzZSBsaXN0ZW4gb24gdGhlIGRvY3VtZW50IGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIGRyYWc6IHRoZSBoYW5kbGVcbiAgICAvLyBpcyAxMnB4IHdpZGUsIHRoZSBjdXJzb3IgbGVhdmVzIGl0IG9uIHRoZSBmaXJzdCBmYXN0IG1vdmVtZW50LCBhbmQgZXZlbnRzIHRoYXRcbiAgICAvLyB0YXJnZXQgd2hhdGV2ZXIgaXMgdW5kZXJuZWF0aCB3b3VsZCBzdHV0dGVyIHRoZSBkcmFnIGFuZCBjb3VsZCBzd2FsbG93IHRoZSByZWxlYXNlXG4gICAgLy8gZW50aXJlbHkgLS0gYW4gdW5jb21taXR0ZWQgZHJhZyB0aGVuIHNuYXBzIGJhY2sgb24gdGhlIG5leHQgc3luYy5cbiAgICB0cmFpbC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgZXYgPT4ge1xuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldi5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgLy8gQ2FwdHVyZSByZXRhcmdldHMgZXZlcnkgcG9pbnRlciBldmVudCB0byB0aGUgaGFuZGxlIHVudGlsIHJlbGVhc2UsIG5vIG1hdHRlclxuICAgICAgICAvLyB3aGVyZSB0aGUgY3Vyc29yIGlzLiBXaXRob3V0IGl0LCBsZXR0aW5nIGdvIHdpdGggdGhlIHBvaW50ZXIgb3ZlciB0aGUgbWFwIGhhbmRzXG4gICAgICAgIC8vIHBvaW50ZXJ1cCB0byBMZWFmbGV0J3MgY29udGFpbmVyIGhhbmRsZXJzLCBhbmQgYSByZWxlYXNlIHRoZXkgc3dhbGxvdyBuZXZlclxuICAgICAgICAvLyByZWFjaGVzIHRoZSBkb2N1bWVudCBsaXN0ZW5lciAtLSB0aGUgZHJhZyBzdGF5cyB1bmNvbW1pdHRlZCBhbmQgdGhlIG5leHQgc3luY1xuICAgICAgICAvLyBzbmFwcyB0aGUgaGFuZGxlIGhvbWUuIFRoZSBkb2N1bWVudCBsaXN0ZW5lcnMgYmVsb3cgcmVtYWluIGFzIHRoZSBmYWxsYmFjayBmb3JcbiAgICAgICAgLy8gZW52aXJvbm1lbnRzIHdpdGhvdXQgY2FwdHVyZTsgd2l0aCBpdCwgcmV0YXJnZXRlZCBldmVudHMgc3RpbGwgYnViYmxlIHRvIHRoZW0uXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAodHJhaWwuc2V0UG9pbnRlckNhcHR1cmUpIHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKGV2LnBvaW50ZXJJZCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBzeW50aGV0aWMgZXZlbnRzIGhhdmUgbm8gYWN0aXZlIHBvaW50ZXI7IGZhbGwgYmFjayB0byBidWJibGluZyAqLyB9XG5cbiAgICAgICAgY29uc3QgbW92ZSA9IGUgPT4ge1xuICAgICAgICAgICAgY29uc3QgaXNvID0gaXNvRnJvbUV2ZW50KGUpO1xuICAgICAgICAgICAgaWYgKGlzbyAhPT0gdW5kZWZpbmVkKSBoYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgZmluaXNoID0gZSA9PiB7XG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBmaW5pc2gpO1xuICAgICAgICAgICAgY29uc3QgaXNvID0gaXNvRnJvbUV2ZW50KGUpO1xuICAgICAgICAgICAgaWYgKGlzbyAhPT0gdW5kZWZpbmVkKSBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChpc28pO1xuICAgICAgICB9O1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgZmluaXNoKTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcbiAgICB9KTtcblxuICAgIC8vIEtleWJvYXJkOiBvbmUgZ3JpZCBzdGVwIHBlciBhcnJvdywgRGVsZXRlL0hvbWUgdG8gY2xlYXIuIFNhbWUgY29udHJhY3QgYXMgdGhlIGRyYWcuXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgZXYgPT4ge1xuICAgICAgICBjb25zdCBzdGF0ZSA9IHRyYWNrLl9zdGF0ZTtcbiAgICAgICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUuZ3JpZE1zKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGN1cnJlbnQgPSBzdGF0ZS53aW5kb3cgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHN0YXRlLndpbmRvdykpIDogMDtcbiAgICAgICAgbGV0IG5leHQ7XG4gICAgICAgIGlmIChldi5rZXkgPT09IFwiQXJyb3dMZWZ0XCIpIG5leHQgPSBjdXJyZW50ICsgc3RhdGUuZ3JpZE1zO1xuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiQXJyb3dSaWdodFwiKSBuZXh0ID0gTWF0aC5tYXgoMCwgY3VycmVudCAtIHN0YXRlLmdyaWRNcyk7XG4gICAgICAgIGVsc2UgaWYgKGV2LmtleSA9PT0gXCJEZWxldGVcIiB8fCBldi5rZXkgPT09IFwiSG9tZVwiKSBuZXh0ID0gMDtcbiAgICAgICAgZWxzZSByZXR1cm47XG4gICAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGhhbmRsZXJzLm9uV2luZG93Q29tbWl0KG5leHQgPiAwID8gbXNUb1BlcmlvZElTTyhuZXh0KSA6IG51bGwpO1xuICAgIH0pO1xufVxuIiwgIi8vIFRpbWUgZmlsdGVyaW5nIG9uIHRoZSBHUFUsIGZvciBwb2ludCBsYXllcnMuXG4vL1xuLy8gVGhlIGNvb3JkaW5hdGVzIGFscmVhZHkgbGl2ZSBpbiBHUFUgYnVmZmVyczsgcmVidWlsZGluZyB0aGUgbWVyZ2VkIGxheWVyIHBlciB0aWNrIHRocmV3XG4vLyB0aGF0IGF3YXkgYW5kIHJlLWZlZCBnbGlmeSBhbGwgNU0gcG9pbnRzIHRocm91Z2ggSlMgLS0gbWVhc3VyZWQgYXQgfjIuNnMgcGVyIHdpbmRvd1xuLy8gY2hhbmdlIGF0IHRoYXQgc2NhbGUsIHdpdGggYWxsb2NhdGlvbiBjaHVybiB0aGF0IGNvdWxkIGNyYXNoIHRoZSB0YWIgd2hlbiBjaGFuZ2VzXG4vLyBzdGFja2VkLiBJbnN0ZWFkLCBlYWNoIHBvaW50J3MgdGltZSBpbnRlcnZhbCBhbmQgaXRzIGxheWVyJ3MgZHVyYXRpb24gcmlkZSBhbG9uZyBhc1xuLy8gdmVydGV4IGF0dHJpYnV0ZXMgdXBsb2FkZWQgb25jZSwgYW5kIHRoZSBjdXJyZW50IHRpY2sgaXMgYSB1bmlmb3JtOiBhIHRpY2sgb3Igd2luZG93XG4vLyBjaGFuZ2UgY29zdHMgdHdvIGZsb2F0cyBhbmQgYSByZWRyYXcuXG4vL1xuLy8gZ2xpZnkgbWFrZXMgdGhpcyBwb3NzaWJsZSB3aXRob3V0IGZvcmtpbmcgaXQ6IHZlcnRleFNoYWRlclNvdXJjZSBpcyBhbiBvdmVycmlkYWJsZVxuLy8gc2V0dGluZyAodGhlIHBpbiBmcmFnbWVudCBzaGFkZXIgYWxyZWFkeSB1c2VzIHRoZSBzYW1lIGRvb3IpLCBpbnN0YW5jZXMgZXhwb3NlIHRoZWlyXG4vLyBnbC9wcm9ncmFtL2NhbnZhcywgYXR0cmlidXRlcyBhcmUgYm91bmQgb25jZSBhdCBzZXR1cCwgYW5kIHRoZSBwZXItZnJhbWUgZHJhdyB0b3VjaGVzXG4vLyBvbmx5IHRoZSBtYXRyaXggdW5pZm9ybSAtLSBzbyBleHRyYSBhdHRyaWJ1dGVzIGJvdW5kIGFmdGVyIHNldHVwIHBlcnNpc3QsIGFuZCB1bmlmb3JtXG4vLyB1cGRhdGVzIHRha2UgZWZmZWN0IG9uIHRoZSBuZXh0IHJlZHJhdy5cbmltcG9ydCB7IHBhcnNlUGVyaW9kLCBwZXJpb2RUb01zLCB0aW1lc0ZvciB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XG5cbi8vIFRpbWVzIHRyYXZlbCBhcyBmbG9hdDMyIG9uIHRoZSBHUFUsIHdob3NlIGludGVnZXJzIGFyZSBleGFjdCBvbmx5IHRvIDJeMjQuIEVwb2NoIG1zIGlzXG4vLyBob3BlbGVzcyBhdCB0aGF0IHByZWNpc2lvbiwgc28gdGltZXMgYXJlIHJlYmFzZWQgdG8gdGhlIGJ1Y2tldCdzIGVhcmxpZXN0IHN0YXJ0IGFuZFxuLy8gZXhwcmVzc2VkIGluIHNlY29uZHM6IGV4YWN0IHRvIH4xOTQgZGF5cyBvZiBzcGFuLCBhbmQgYSAycyByb3VuZGluZyBiZXlvbmQgdGhhdCBpc1xuLy8gaW52aXNpYmxlIGF0IGFueSB6b29tIGEgdGltZSBzbGlkZXIgbWFrZXMgc2Vuc2UgYXQuXG5jb25zdCBBTFdBWVMgPSA2LjNlODsgICAvLyB+MjAgeWVhcnMsIGluIHNlY29uZHM6IHRoZSBcImR1cmF0aW9uXCIgb2YgY3VtdWxhdGl2ZSBsYXllcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgdGhlIHNwYW4gaGFsZi13aWR0aCBvZiBwb2ludHMgd2l0aCBubyByZWFkYWJsZSB0aW1lLlxuXG4vLyBQZXItYnVja2V0IGxheWVyLXZpc2liaWxpdHkgc2xvdHMgaW4gdGhlIHZlcnRleCBzaGFkZXIuIEVhY2ggZmxvYXQgYXJyYXkgZWxlbWVudFxuLy8gb2NjdXBpZXMgYSBmdWxsIHVuaWZvcm0gdmVjdG9yIGluIEVTIEdMU0wgcGFja2luZywgYW5kIHRoZSBzcGVjIGd1YXJhbnRlZXMgb25seSAxMjhcbi8vIHZlcnRleCB1bmlmb3JtIHZlY3RvcnMgLS0gNjQgc2xvdHMgbGVhdmVzIGNvbWZvcnRhYmxlIHJvb20gZm9yIHRoZSBtYXRyaXggYW5kIHRoZSB0aW1lXG4vLyB1bmlmb3Jtcy4gQSBidWNrZXQgd2l0aCBtb3JlIGxheWVycyB0aGFuIHNsb3RzIGZhbGxzIGJhY2sgdG8gcmVidWlsZC1wZXItdG9nZ2xlLlxuLy8gKFBhY2tpbmcgZm91ciBsYXllcnMgcGVyIHZlYzQgd291bGQgcXVhZHJ1cGxlIHRoaXMgaWYgYW55b25lIGV2ZXIgbmVlZHMgaXQuKVxuZXhwb3J0IGNvbnN0IExBWUVSX1NMT1RTID0gNjQ7XG5cbi8vIENoZWFwIGtpbGwgc3dpdGNoZXM6IGlmIHdpcmluZyB0aGUgR0wgc3RhdGUgZXZlciBmYWlscyAoYSBmdXR1cmUgZ2xpZnkgdmVyc2lvbiBtb3Zpbmdcbi8vIGl0cyBpbnRlcm5hbHMpLCB0aGUgYWZmZWN0ZWQgZmFtaWx5IGZhbGxzIGJhY2sgdG8gdGhlIENQVSByZWJ1aWxkIHBhdGguIFBvaW50cyBhbmRcbi8vIHZlY3RvcnMgYXJlIHNlcGFyYXRlIGZsYWdzIC0tIGEgdmVjdG9yIGludHJvc3BlY3Rpb24gZmFpbHVyZSBtdXN0IG5vdCBjb3N0IHBvaW50c1xuLy8gdGhlaXIgR1BVIHBhdGguXG5sZXQgZ3B1T2sgPSB0cnVlO1xuZXhwb3J0IGZ1bmN0aW9uIGdwdVRpbWVBdmFpbGFibGUoKSB7IHJldHVybiBncHVPazsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpc2FibGVHcHVUaW1lKHJlYXNvbikge1xuICAgIGlmIChncHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZpbHRlcmluZyBkaXNhYmxlZDogJHtyZWFzb259LiBgICtcbiAgICAgICAgYEZhbGxpbmcgYmFjayB0byByZWJ1aWxkLXBlci10aWNrLmApO1xuICAgIGdwdU9rID0gZmFsc2U7XG59XG5sZXQgdmVjdG9yR3B1T2sgPSB0cnVlO1xuZXhwb3J0IGZ1bmN0aW9uIHZlY3RvckdwdUF2YWlsYWJsZSgpIHsgcmV0dXJuIHZlY3RvckdwdU9rOyB9XG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZVZlY3RvckdwdShyZWFzb24pIHtcbiAgICBpZiAodmVjdG9yR3B1T2spIGNvbnNvbGUud2FybihgW1N3aWZ0TWFwXSBHUFUgdGltZSBmb3IgbGluZXMvcG9seWdvbnMgZGlzYWJsZWQ6IGAgK1xuICAgICAgICBgJHtyZWFzb259LiBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljayBmb3IgdGhvc2UgYnVja2V0cy5gKTtcbiAgICB2ZWN0b3JHcHVPayA9IGZhbHNlO1xufVxuXG4vLyBUaGUgZGVmYXVsdCBwb2ludHMgdmVydGV4IHNoYWRlciAocmVhZCBvdXQgb2YgbGVhZmxldC5nbGlmeSAzLjMuMCkgd2l0aCB0aGUgd2luZG93XG4vLyB0ZXN0IGFkZGVkLiBBIGhpZGRlbiBwb2ludCBnZXRzIHNpemUgMCBhbmQgYSBwb3NpdGlvbiBvdXRzaWRlIGNsaXAgc3BhY2UsIHNvIG5laXRoZXJcbi8vIHRoZSB2aXNpYmxlIHBhc3Mgbm9yIHRoZSBzaGFyZWQtcHJvZ3JhbSBwaWNraW5nIHBhc3MgZXZlciByYXN0ZXJpc2VzIGl0LlxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVWZXJ0ZXhTaGFkZXIoKSB7XG4gICAgcmV0dXJuIGB1bmlmb3JtIG1hdDQgbWF0cml4O1xuYXR0cmlidXRlIHZlYzQgdmVydGV4O1xuYXR0cmlidXRlIHZlYzQgY29sb3I7XG5hdHRyaWJ1dGUgZmxvYXQgcG9pbnRTaXplO1xuYXR0cmlidXRlIHZlYzIgYVRpbWVTcGFuO1xuYXR0cmlidXRlIGZsb2F0IGFEdXJhdGlvbjtcbmF0dHJpYnV0ZSBmbG9hdCBhTGF5ZXI7XG51bmlmb3JtIGZsb2F0IHVUaWNrO1xudW5pZm9ybSBmbG9hdCB1T3ZlcnJpZGU7XG51bmlmb3JtIGZsb2F0IHVMYXllclZpc1ske0xBWUVSX1NMT1RTfV07XG52YXJ5aW5nIHZlYzQgX2NvbG9yO1xuXG52b2lkIG1haW4oKSB7XG4gIC8vIEEgbmVnYXRpdmUgZHVyYXRpb24gaXMgdGhlIGZhZGUgZmxhZzogfGFEdXJhdGlvbnwgaXMgdGhlIHdpbmRvdywgdGhlIHNpZ24gc2F5cyB0aGlzXG4gIC8vIHBvaW50IGRpbXMgd2l0aCBhZ2UuIEEgc2hhcmVkIG92ZXJyaWRlIGtlZXBzIHRoZSBwb2ludCdzIG93biBmYWRlIHByZWZlcmVuY2UuXG4gIGJvb2wgZmFkZXMgPSBhRHVyYXRpb24gPCAwLjA7XG4gIGZsb2F0IGR1ciA9IHVPdmVycmlkZSA+PSAwLjAgPyB1T3ZlcnJpZGUgOiBhYnMoYUR1cmF0aW9uKTtcbiAgLy8gSGFsZi1vcGVuICh0aWNrIC0gZHVyLCB0aWNrXSwgbWF0Y2hpbmcgZmVhdHVyZUluV2luZG93IG9uIHRoZSBDUFUgc2lkZSAtLSBBTkRlZCB3aXRoXG4gIC8vIHRoZSBwb2ludCdzIGxheWVyIGJlaW5nIHZpc2libGUuIExheWVyIHRvZ2dsZXMgYXJlIG9uZSB1bmlmb3JtIGVsZW1lbnQsIG5vdCBhXG4gIC8vIHJlYnVpbGQ6IHVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlLWZlZWQgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTLlxuICBib29sIHZpc2libGUgPSBhVGltZVNwYW4ueSA+ICh1VGljayAtIGR1cikgJiYgYVRpbWVTcGFuLnggPD0gdVRpY2tcbiAgICAgICYmIHVMYXllclZpc1tpbnQoYUxheWVyKV0gPiAwLjU7XG4gIGdsX1BvaW50U2l6ZSA9IHZpc2libGUgPyBwb2ludFNpemUgOiAwLjA7XG4gIGdsX1Bvc2l0aW9uID0gdmlzaWJsZSA/IG1hdHJpeCAqIHZlcnRleCA6IHZlYzQoMi4wLCAyLjAsIDIuMCwgMS4wKTtcbiAgLy8gQWdlIHJ1bnMgZnJvbSB0aGUgZmVhdHVyZSdzIGVuZDsgbmV3ZXN0IGlzIG9wYXF1ZSwgdGhlIHRyYWlsaW5nIGVkZ2UgcmVhY2hlcyB6ZXJvLlxuICBmbG9hdCBhbHBoYSA9IGZhZGVzID8gY2xhbXAoMS4wIC0gKHVUaWNrIC0gYVRpbWVTcGFuLnkpIC8gZHVyLCAwLjAsIDEuMCkgOiAxLjA7XG4gIF9jb2xvciA9IHZlYzQoY29sb3IucmdiLCBjb2xvci5hICogYWxwaGEpO1xufVxuYDtcbn1cblxuLy8gUGVyLWxheWVyIGR1cmF0aW9uIGluIHNlY29uZHM6IG51bGwgYWNjdW11bGF0ZXMsIFwicGVyaW9kXCIgaXMgdGhlIHNoYXJlZCBpbnRlcnZhbCxcbi8vIGFuIElTTyBzdHJpbmcgaXMgaXRzZWxmOyBhbnl0aGluZyB1bnBhcnNlYWJsZSBmYWxscyBiYWNrIHRvIHRoZSBpbnRlcnZhbC5cbmZ1bmN0aW9uIGR1cmF0aW9uU2Vjb25kcyhzcGVjLCBwZXJpb2RNcykge1xuICAgIGlmIChzcGVjID09PSBudWxsIHx8IHNwZWMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIEFMV0FZUztcbiAgICBpZiAoc3BlYyA9PT0gXCJwZXJpb2RcIikgcmV0dXJuIChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XG4gICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcbiAgICByZXR1cm4gbXMgPyBtcyAvIDEwMDAgOiAocGVyaW9kTXMgfHwgMjQgKiAzNjAwICogMTAwMCkgLyAxMDAwO1xufVxuXG4vLyBCdWlsZHMgdGhlIHBlci1wb2ludCBhdHRyaWJ1dGUgYXJyYXlzIGZvciBvbmUgbWVyZ2VkIGJ1Y2tldCwgaW4gdGhlIGV4YWN0IG9yZGVyIHRoZVxuLy8gYnVja2V0IGZlZWRzIHBvaW50cyB0byBnbGlmeTogbGF5ZXIgYnkgbGF5ZXIsIGluZGV4IDAuLm4tMSwgd2l0aCBzaW5nbGUtYGxvY2F0aW9uYFxuLy8gbGF5ZXJzIGNvbnRyaWJ1dGluZyBvbmUgcG9pbnQuIFBvaW50cyBpbiBsYXllcnMgd2l0aG91dCB0aW1lIG1ldGFkYXRhIC0tIGFuZCBwb2ludHNcbi8vIHdob3NlIHRpbWUgd2FzIHVucmVhZGFibGUgKE5hTikgLS0gZ2V0IGEgc3BhbiB0aGF0IGlzIHZpc2libGUgYXQgZXZlcnkgdGljay5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xuICAgIGxldCB0b3RhbCA9IDA7XG4gICAgbGV0IGhhc1RpbWUgPSBmYWxzZTtcbiAgICBjb25zdCBwZXJMYXllciA9IFtdO1xuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICBjb25zdCBidWYgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XG4gICAgICAgIGNvbnN0IGNvdW50ID0gYnVmID8gYnVmLmJ5dGVMZW5ndGggLyAxNiA6IChsYXllci5sb2NhdGlvbiA/IDEgOiAwKTtcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG4gICAgICAgIGlmIChsYXllci50aW1lKSBoYXNUaW1lID0gdHJ1ZTtcbiAgICAgICAgcGVyTGF5ZXIucHVzaCh7IGxheWVyLCBjb3VudCwgdGltZXMgfSk7XG4gICAgICAgIHRvdGFsICs9IGNvdW50O1xuICAgIH1cbiAgICBpZiAoIWhhc1RpbWUpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XG5cbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgeyB0aW1lcyB9IG9mIHBlckxheWVyKSB7XG4gICAgICAgIGlmICghdGltZXMpIGNvbnRpbnVlO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcblxuICAgIGNvbnN0IHNwYW5zID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCAqIDIpO1xuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcbiAgICBjb25zdCBsYXllcklkeCA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xuICAgIGNvbnN0IGxheWVySWRzID0gW107XG4gICAgbGV0IG91dCA9IDA7XG4gICAgZm9yIChjb25zdCB7IGxheWVyLCBjb3VudCwgdGltZXMgfSBvZiBwZXJMYXllcikge1xuICAgICAgICBjb25zdCBpZHggPSBsYXllcklkcy5sZW5ndGg7XG4gICAgICAgIGxheWVySWRzLnB1c2gobGF5ZXIuaWQpO1xuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcbiAgICAgICAgLy8gVGhlIGZhZGUgZmxhZyByaWRlcyB0aGUgZHVyYXRpb24ncyBzaWduLCBzbyBpdCBjb3N0cyBubyBleHRyYSBhdHRyaWJ1dGUuXG4gICAgICAgIC8vIFRpbWVsZXNzIChOYU4pIHBvaW50cyBrZWVwIGEgcG9zaXRpdmUgZHVyYXRpb246IHdpdGggbm8gYWdlLCBub3RoaW5nIHRvIGZhZGUuXG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IHRpbWVzID8gdGltZXNbaSAqIDJdIDogTmFOO1xuICAgICAgICAgICAgY29uc3QgZW5kID0gdGltZXMgPyB0aW1lc1tpICogMiArIDFdIDogTmFOO1xuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTihzdGFydCkpIHtcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IC1BTFdBWVM7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gQUxXQVlTO1xuICAgICAgICAgICAgICAgIGR1cnNbb3V0XSA9IEFMV0FZUztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSAoc3RhcnQgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gKGVuZCAtIGJhc2UpIC8gMTAwMDtcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBzaWduZWREdXI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsYXllcklkeFtvdXRdID0gaWR4O1xuICAgICAgICAgICAgb3V0Kys7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgc3BhbnMsIGR1cnMsIGxheWVySWR4LCBsYXllcklkcywgY291bnQ6IHRvdGFsIH07XG59XG5cbi8vIFBlci1mZWF0dXJlIHRpbWUgbWV0YWRhdGEgZm9yIGEgdmVjdG9yIGJ1Y2tldCAobGluZXMvcG9seWdvbnMpOiBvbmUgZW50cnkgcGVyIGxheWVyLFxuLy8gc2luY2UgdGhvc2UgbGF5ZXJzIGhvbGQgZXhhY3RseSBvbmUgZ2VvbWV0cnkuIFNhbWUgZW5jb2RpbmdzIGFzIHRoZSBwb2ludCBwYXRoIC0tXG4vLyByZWJhc2VkIGZsb2F0MzIgc2Vjb25kcywgc2lnbi1wYWNrZWQgZmFkZSwgYWx3YXlzLXZpc2libGUgc3BhbnMgZm9yIHRpbWVsZXNzIG9yXG4vLyBub24tdGltZSBsYXllcnMuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZWN0b3JUaW1lTWV0YShsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG4gICAgICAgIGlmICh0aW1lcyAmJiAhTnVtYmVyLmlzTmFOKHRpbWVzWzBdKSAmJiB0aW1lc1swXSA8IGJhc2UpIGJhc2UgPSB0aW1lc1swXTtcbiAgICB9XG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcblxuICAgIGNvbnN0IHBlckZlYXR1cmUgPSBsYXllcnNMaXN0Lm1hcCgobGF5ZXIsIGlkeCkgPT4ge1xuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcbiAgICAgICAgaWYgKCF0aW1lcyB8fCBOdW1iZXIuaXNOYU4odGltZXNbMF0pKSB7XG4gICAgICAgICAgICByZXR1cm4geyBzdGFydDogLUFMV0FZUywgZW5kOiBBTFdBWVMsIGR1cjogQUxXQVlTLCBpZHggfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBzdGFydDogKHRpbWVzWzBdIC0gYmFzZSkgLyAxMDAwLCBlbmQ6ICh0aW1lc1sxXSAtIGJhc2UpIC8gMTAwMCxcbiAgICAgICAgICAgICAgICAgZHVyOiBzaWduZWREdXIsIGlkeCB9O1xuICAgIH0pO1xuICAgIHJldHVybiB7IGhhc1RpbWU6IHRydWUsIGJhc2UsIHBlckZlYXR1cmUsIGxheWVySWRzOiBsYXllcnNMaXN0Lm1hcChsID0+IGwuaWQpIH07XG59XG5cbi8vIEV4cGFuZHMgcGVyLWZlYXR1cmUgdmFsdWVzIHRvIHBlci1HTC12ZXJ0ZXggYXJyYXlzIGdpdmVuIGVhY2ggZmVhdHVyZSdzIHZlcnRleCBjb3VudC5cbi8vIFB1cmUsIHNvIHRoZSBhbGlnbm1lbnQgbG9naWMgaXMgdGllci0xIHRlc3RhYmxlIGF3YXkgZnJvbSBhbnkgR0wgY29udGV4dC5cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQZXJGZWF0dXJlKHBlckZlYXR1cmUsIGNvdW50cykge1xuICAgIGxldCB0b3RhbCA9IDA7XG4gICAgZm9yIChjb25zdCBjIG9mIGNvdW50cykgdG90YWwgKz0gYztcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcbiAgICBjb25zdCBkdXJzID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcbiAgICBsZXQgb3V0ID0gMDtcbiAgICBwZXJGZWF0dXJlLmZvckVhY2goKGYsIGkpID0+IHtcbiAgICAgICAgZm9yIChsZXQgdiA9IDA7IHYgPCBjb3VudHNbaV07IHYrKykge1xuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBmLnN0YXJ0O1xuICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gZi5lbmQ7XG4gICAgICAgICAgICBkdXJzW291dF0gPSBmLmR1cjtcbiAgICAgICAgICAgIGxheWVySWR4W291dF0gPSBmLmlkeDtcbiAgICAgICAgICAgIG91dCsrO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIHsgc3BhbnMsIGR1cnMsIGxheWVySWR4IH07XG59XG5cbi8vIGdsaWZ5J3MgdmVydGV4IGxheW91dDogNiBmbG9hdHMgcGVyIEdMIHZlcnRleCAoeCwgeSwgciwgZywgYiwgYSksIGNvbmZpcm1lZCBmb3IgMy4zLjBcbi8vIGJvdGggYnkgcmVhZGluZyB0aGUgc291cmNlIGFuZCBieSB0aGUgVmFsaGFsbGEtVlJFIHJlcG9ydCdzIGRlYnVnIGR1bXAgLS0gdHdvXG4vLyBvbmUtc2VnbWVudCBsaW5lcyBwcm9kdWNlZCBhbGxWZXJ0aWNlc1R5cGVkIG9mIDI0IGZsb2F0czogMiBmZWF0dXJlcyB4IDIgdmVydGljZXMgeCA2LlxuY29uc3QgRkxPQVRTX1BFUl9WRVJURVggPSA2O1xuXG4vLyBXaXJlcyB0aW1lICsgbGF5ZXItdmlzaWJpbGl0eSBpbnRvIGEgbGl2ZSBnbGlmeSBMSU5FUyBvciBTSEFQRVMgaW5zdGFuY2UuIFRoZSBjYWxsZXJcbi8vIHN1cHBsaWVzIHBlci1mZWF0dXJlIEdMLXZlcnRleCBjb3VudHMgY29tcHV0ZWQgZnJvbSB0aGUgZ2VvbWV0cnkgaXQgYnVpbHQgaXRzZWxmOlxuLy8gbGluZXMgZHJhdyAyKihwb2ludHMtMSkgdmVydGljZXMgcGVyIGZlYXR1cmUsIGFuZCBhbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHNpbXBsZSByaW5nXG4vLyBoYXMgZXhhY3RseSBuLTIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzIGVhcmN1dC4gVGhlIGNvdW50c1xuLy8gYXJlIHZhbGlkYXRlZCBhZ2FpbnN0IHRoZSBpbnN0YW5jZSdzIGFjdHVhbCBidWZmZXIgbGVuZ3RoLCBhbmQgYW55IG1pc21hdGNoIGRpc2FibGVzXG4vLyB0aGUgdmVjdG9yIEdQVSBwYXRoIHJhdGhlciB0aGFuIG1pcy1hbGlnbmluZyBhdHRyaWJ1dGVzLlxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKGluc3RhbmNlLCBtZXRhLCBjb3VudHMpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY291bnRzKSB8fCBjb3VudHMubGVuZ3RoICE9PSBtZXRhLnBlckZlYXR1cmUubGVuZ3RoKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGV4cGVjdGVkICR7bWV0YS5wZXJGZWF0dXJlLmxlbmd0aH0gdmVydGV4IGNvdW50cywgYCArXG4gICAgICAgICAgICAgICAgYGdvdCAke2NvdW50cyAmJiBjb3VudHMubGVuZ3RofWApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGV4cGVjdGVkID0gY291bnRzLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApICogRkxPQVRTX1BFUl9WRVJURVg7XG4gICAgICAgIC8vIExpbmVzIGtlZXAgYSB0eXBlZCBmbGF0IGJ1ZmZlcjsgc2hhcGVzIGtlZXAgYSBwbGFpbiBmbGF0IGFycmF5LiBFaXRoZXIgaXMgdGhlXG4gICAgICAgIC8vIGdyb3VuZCB0cnV0aCBmb3IgaG93IG1hbnkgR0wgdmVydGljZXMgZ2xpZnkgYWN0dWFsbHkgYnVpbHQuXG4gICAgICAgIGNvbnN0IGFjdHVhbCA9IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQgPyBpbnN0YW5jZS5hbGxWZXJ0aWNlc1R5cGVkLmxlbmd0aFxuICAgICAgICAgICAgOiAoQXJyYXkuaXNBcnJheShpbnN0YW5jZS52ZXJ0aWNlcykgPyBpbnN0YW5jZS52ZXJ0aWNlcy5sZW5ndGggOiAtMSk7XG4gICAgICAgIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHZlcnRleCBjb3VudCBtaXNtYXRjaDogZ2VvbWV0cnkgc2F5cyAke2V4cGVjdGVkfSBmbG9hdHMsIGAgK1xuICAgICAgICAgICAgICAgIGB0aGUgaW5zdGFuY2UgaG9sZHMgJHthY3R1YWx9YCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYXR0cnMgPSBleHBhbmRQZXJGZWF0dXJlKG1ldGEucGVyRmVhdHVyZSwgY291bnRzKTtcbiAgICAgICAgYXR0cnMuYmFzZSA9IG1ldGEuYmFzZTtcbiAgICAgICAgYXR0cnMubGF5ZXJJZHMgPSBtZXRhLmxheWVySWRzO1xuICAgICAgICByZXR1cm4gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycyk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGRpc2FibGVWZWN0b3JHcHUoZXJyLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbi8vIFdpcmVzIHRoZSBhdHRyaWJ1dGUgYnVmZmVycyBhbmQgdW5pZm9ybXMgaW50byBhIGxpdmUgZ2xpZnkgcG9pbnRzIGluc3RhbmNlLiBSZXR1cm5zIGFcbi8vIGhhbmRsZSB3aG9zZSBzZXRXaW5kb3cgY29zdHMgdHdvIHVuaWZvcm1zIGFuZCBhIHJlZHJhdywgb3IgbnVsbCBpZiBhbnl0aGluZyBhYm91dCB0aGVcbi8vIGluc3RhbmNlIGlzIG5vdCB3aGVyZSBnbGlmeSAzLjMuMCBrZWVwcyBpdCAtLSBpbiB3aGljaCBjYXNlIEdQVSB0aW1lIGlzIGRpc2FibGVkIGFuZFxuLy8gdGhlIGNhbGxlcidzIHJlYnVpbGQgcGF0aCB0YWtlcyBvdmVyLlxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb0luc3RhbmNlKGluc3RhbmNlLCBhdHRycykge1xuICAgIHRyeSB7XG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgZGlzYWJsZUdwdVRpbWUoZXJyLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbi8vIFRoZSBjb21tb24gR0wgd2lyaW5nOiBidWZmZXJzIGZvciBzcGFuL2R1cmF0aW9uL2xheWVyIGF0dHJpYnV0ZXMsIHVuaWZvcm1zIGZvciB0aGVcbi8vIHRpY2ssIHRoZSBzaGFyZWQgb3ZlcnJpZGUgYW5kIHRoZSBwZXItbGF5ZXIgdmlzaWJpbGl0eSBzbG90cy4gVGhyb3dzIG9uIGFueXRoaW5nXG4vLyB1bmV4cGVjdGVkOyB0aGUgY2FsbGVycyBkZWNpZGUgd2hpY2ggZmFsbGJhY2sgZmxhZyB0aGF0IGZsaXBzLlxuZnVuY3Rpb24gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycykge1xuICAgIHtcbiAgICAgICAgY29uc3QgZ2wgPSBpbnN0YW5jZS5nbDtcbiAgICAgICAgY29uc3QgcHJvZ3JhbSA9IGluc3RhbmNlLnByb2dyYW07XG4gICAgICAgIGNvbnN0IGxheWVyID0gaW5zdGFuY2UubGF5ZXI7XG4gICAgICAgIGlmICghZ2wgfHwgIXByb2dyYW0gfHwgIWxheWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnN0YW5jZSBsYWNrcyBnbC9wcm9ncmFtL2xheWVyXCIpO1xuXG4gICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XG5cbiAgICAgICAgY29uc3Qgc3BhbkxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYVRpbWVTcGFuXCIpO1xuICAgICAgICBjb25zdCBkdXJMb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFEdXJhdGlvblwiKTtcbiAgICAgICAgY29uc3QgbGF5ZXJMb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFMYXllclwiKTtcbiAgICAgICAgY29uc3QgdGlja0xvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVUaWNrXCIpO1xuICAgICAgICBjb25zdCBvdmVycmlkZUxvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVPdmVycmlkZVwiKTtcbiAgICAgICAgLy8gU29tZSBkcml2ZXJzIG5hbWUgdGhlIGFycmF5IGhlYWQgXCJ1TGF5ZXJWaXNbMF1cIjsgYWNjZXB0IGVpdGhlci5cbiAgICAgICAgY29uc3QgdmlzTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzXCIpXG4gICAgICAgICAgICB8fCBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNbMF1cIik7XG4gICAgICAgIGlmIChzcGFuTG9jIDwgMCB8fCBkdXJMb2MgPCAwIHx8IGxheWVyTG9jIDwgMCB8fCAhdGlja0xvYyB8fCAhb3ZlcnJpZGVMb2MgfHwgIXZpc0xvYykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidGltZSBhdHRyaWJ1dGVzL3VuaWZvcm1zIG1pc3NpbmcgZnJvbSB0aGUgbGlua2VkIHByb2dyYW1cIik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzcGFuQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBzcGFuQnVmKTtcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLnNwYW5zLCBnbC5TVEFUSUNfRFJBVyk7XG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoc3BhbkxvYywgMiwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkoc3BhbkxvYyk7XG5cbiAgICAgICAgY29uc3QgZHVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBkdXJCdWYpO1xuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuZHVycywgZ2wuU1RBVElDX0RSQVcpO1xuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGR1ckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkoZHVyTG9jKTtcblxuICAgICAgICBjb25zdCBsYXllckJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgbGF5ZXJCdWYpO1xuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMubGF5ZXJJZHgsIGdsLlNUQVRJQ19EUkFXKTtcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihsYXllckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkobGF5ZXJMb2MpO1xuXG4gICAgICAgIC8vIFVudGlsIHRoZSBzbGlkZXIgc2F5cyBvdGhlcndpc2UsIGV2ZXJ5dGhpbmcgaXMgdmlzaWJsZSAtLSBpbiB0aW1lIEFORCBsYXllci5cbiAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIEFMV0FZUyk7XG4gICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgLTEpO1xuICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGxheWVySWRzOiBhdHRycy5sYXllcklkcyxcbiAgICAgICAgICAgIC8vIHRpY2tNcyBpbiBlcG9jaCBtczsgb3ZlcnJpZGVNcyBhIHNoYXJlZC13aW5kb3cgd2lkdGggb3IgbnVsbC5cbiAgICAgICAgICAgIHNldFdpbmRvdyh0aWNrTXMsIG92ZXJyaWRlTXMpIHtcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZih0aWNrTG9jLCB0aWNrTXMgPT09IG51bGwgPyBBTFdBWVMgOiAodGlja01zIC0gYXR0cnMuYmFzZSkgLyAxMDAwKTtcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIG92ZXJyaWRlTXMgPT09IG51bGwgPyAtMSA6IG92ZXJyaWRlTXMgLyAxMDAwKTtcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBPbmUgZmxvYXQgcGVyIGxheWVyIHNsb3QsIGluIGF0dHJzLmxheWVySWRzIG9yZGVyLiBBIHNpZGViYXIgdG9nZ2xlIGxhbmRzXG4gICAgICAgICAgICAvLyBoZXJlIGluc3RlYWQgb2YgcmVidWlsZGluZyB0aGUgYnVja2V0LlxuICAgICAgICAgICAgc2V0TGF5ZXJWaXNpYmlsaXR5KHZpc0FycmF5KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdmlzID0gbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKTtcbiAgICAgICAgICAgICAgICB2aXMuc2V0KHZpc0FycmF5LnNsaWNlKDAsIExBWUVSX1NMT1RTKSk7XG4gICAgICAgICAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgdmlzKTtcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgfVxufVxuIiwgImltcG9ydCB7IGxvYWRKUywgYmluZFBvcHVwLCBiaW5kVG9vbHRpcCwgcGFyc2VDb2xvciB9IGZyb20gXCIuL3V0aWxzLmpzXCI7XG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgdGltZXNGb3IsIGxheWVySW5XaW5kb3csIGVmZmVjdGl2ZUR1cmF0aW9uLFxuICAgICAgICAgcGVyaW9kVG9NcyB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcbiAgICAgICAgIGdwdVRpbWVBdmFpbGFibGUsIGJ1aWxkVmVjdG9yVGltZU1ldGEsIGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlIH0gZnJvbSBcIi4vZ3B1dGltZS5qc1wiO1xuXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XG4gICAgaWYgKGdsSW5zdGFuY2UgJiYgZ2xJbnN0YW5jZS5sYXllcikge1xuICAgICAgICBnbEluc3RhbmNlLmxheWVyLl91bmNsYW1wZWRQcm9qZWN0ID0gZnVuY3Rpb24obGF0bG5nLCB6b29tKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcbiAgICAgICAgfTtcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5yZWRyYXcoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9jbGlja1RpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2NsaWNrTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5faG92ZXJNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5faG92ZXJNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xuLy8gdmFyaWVkIHN0eWxpbmcsIG90aGVyd2lzZSB0aGUgbGF5ZXIncyBzaW5nbGUgc3R5bGUuIFB5dGhvbiBvbmx5IGVtaXRzIGZlYXR1cmVfc3R5bGVzXG4vLyB3aGVuIGZlYXR1cmVzIGFjdHVhbGx5IGRpZmZlciwgc28gYSB1bmlmb3JtIGxheWVyIGNvc3RzIG5vdGhpbmcgZXh0cmEgaGVyZS5cbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxuLy8gdGhhbiBlZGl0aW5nIHRoZSBsYXllcidzIHN0eWxlLCBzbyBjbGVhcmluZyBpdCByZXN0b3JlcyB3aGF0IHdhcyB1bmRlcm5lYXRoIHdpdGhcbi8vIG5vdGhpbmcgdG8gcmVtZW1iZXIgYW5kIG5vdGhpbmcgdG8gcHV0IGJhY2suXG4vL1xuLy8gICB0aGUgbGF5ZXIncyBvd24gc3R5bGUgICB3aGF0IGl0IHdhcyBkcmF3biB3aXRoXG4vLyAgIGZlYXR1cmVfc3R5bGVzW2ldICAgICAgIHBlciBmZWF0dXJlLCBmcm9tIHRoZSBkYXRhXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxuLy8gICBzdHlsZV9vdmVycmlkZXNbaV0gICAgICB0aGlzIGZlYXR1cmUgaXMgc2VsZWN0ZWQgLS0gbW9zdCBzcGVjaWZpYywgc28gaXQgd2luc1xuZXhwb3J0IGZ1bmN0aW9uIHN0eWxlRm9yKGxheWVyLCBpbmRleCkge1xuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xuICAgIGNvbnN0IGhpZ2hsaWdodCA9IGxheWVyLmhpZ2hsaWdodF9zdHlsZTtcbiAgICBjb25zdCBzZWxlY3RlZCA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyAmJiBsYXllci5zdHlsZV9vdmVycmlkZXNbaW5kZXhdO1xuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcbiAgICByZXR1cm4geyAuLi5sYXllciwgLi4uKGZyb21EYXRhIHx8IHt9KSwgLi4uKGhpZ2hsaWdodCB8fCB7fSksIC4uLihzZWxlY3RlZCB8fCB7fSkgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEluZGV4ZWRQcm9wZXJ0aWVzKHByb3BlcnRpZXMsIGluZGV4KSB7XG4gICAgaWYgKCFwcm9wZXJ0aWVzKSByZXR1cm4ge307XG4gICAgY29uc3QgcHJvcHMgPSB7fTtcbiAgICBPYmplY3Qua2V5cyhwcm9wZXJ0aWVzKS5mb3JFYWNoKGsgPT4ge1xuICAgICAgICBjb25zdCB2YWwgPSBwcm9wZXJ0aWVzW2tdO1xuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XG4gICAgfSk7XG4gICAgcmV0dXJuIHByb3BzO1xufVxuXG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyLCBtb2RlbCkge1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcbiAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge307XG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcbiAgICAgICAgcmV0dXJuIGdyb3VwO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQSB2ZWN0b3IgbGF5ZXIncyBjb29yZGluYXRlczogdGhlIGJpbmFyeSBidWZmZXIgdW5kZXIgaXRzIGlkIHdoZW4gUHl0aG9uIGJ1aWx0IGl0XG4vLyAodGhlIGxheWVycyBKU09OIHRoZW4gY2FycmllcyBubyBjb29yZGluYXRlcyBhdCBhbGwpLCBvciBpbmxpbmUgYGxvY2F0aW9uc2AgZm9yXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xuLy8gb24gdGhlIEdQVSBwYXRoIHJhcmVseSBkby5cbmZ1bmN0aW9uIHZlY3RvckNvb3JkcyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcbiAgICBpZiAobGF5ZXIubG9jYXRpb25zKSByZXR1cm4gbGF5ZXIubG9jYXRpb25zO1xuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZmxhdCA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xuICAgIGNvbnN0IG91dCA9IG5ldyBBcnJheShmbGF0Lmxlbmd0aCAvIDIpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb3V0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIG91dFtpXSA9IFtmbGF0W2kgKiAyXSwgZmxhdFtpICogMiArIDFdXTtcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCBsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlID0gbnVsbCwgdmVjdG9yR3B1ID0gZmFsc2UpIHtcbiAgICAvLyBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZSBnZW9tZXRyeSBwZXIgbGF5ZXIuIE9uIHRoZSBHUFUgcGF0aCAobWFwLmpzXG4gICAgLy8gcGFzc2VzIHZlY3RvckdwdSB3aGVuIHRoZSBidWNrZXQgcXVhbGlmaWVzKSBldmVyeSBmZWF0dXJlIHN0YXlzIGluIHRoZSBidWZmZXJzIGFuZFxuICAgIC8vIHRoZSBzaGFkZXIgZGVjaWRlcyB2aXNpYmlsaXR5IHBlciB0aWNrIGFuZCBwZXIgbGF5ZXIgdG9nZ2xlIC0tIGEgbGluZS1zaGFwZWQgdHJhY2tcbiAgICAvLyBoYXMgYXMgbWFueSB2ZXJ0aWNlcyBhcyBhIHBvaW50IHRyYWNrIGhhcyBwb2ludHMsIHNvIGl0cyByZWJ1aWxkcyBjb3N0IHRoZSBzYW1lXG4gICAgLy8gYW5kIGNyYXNoZWQgdGhlIHNhbWUgd2F5LiBPZmYgdGhlIEdQVSBwYXRoLCB0aGUgd2hvbGUtZmVhdHVyZSBDUFUgZmlsdGVyIHJlbWFpbnMuXG4gICAgY29uc3QgdmVjdG9yTWV0YSA9IHZlY3RvckdwdSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCJcbiAgICAgICAgPyBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxuICAgICAgICAgICAgdGltZVN0YXRlICYmIHRpbWVTdGF0ZS5wZXJpb2QgPyBwZXJpb2RUb01zKHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbClcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgY29uc3QgdmVjdG9yVGltZSA9IEJvb2xlYW4odmVjdG9yTWV0YS5oYXNUaW1lKTtcbiAgICBpZiAodGltZVN0YXRlICYmICF2ZWN0b3JUaW1lICYmIHR5cGUgIT09IFwiY2lyY2xlX21hcmtlcnNcIiAmJiB0eXBlICE9PSBcIm1hcmtlcnNcIikge1xuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcbiAgICAgICAgaWYgKGxheWVyc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBjb25zdCB2ZXJ0ZXhDb3VudHMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgICAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XG4gICAgICAgICAgICBjb25zdCBnZW9qc29uQ29vcmRzID0gbG9jcy5tYXAoYyA9PiBbY1sxXSwgY1swXV0pO1xuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goTWF0aC5tYXgoMCwgMiAqIChnZW9qc29uQ29vcmRzLmxlbmd0aCAtIDEpKSk7XG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiTGluZVN0cmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBjb29yZGluYXRlczogZ2VvanNvbkNvb3Jkc1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lT3B0aW9ucyA9IHZlY3RvclRpbWVcbiAgICAgICAgICAgICAgICAgICAgPyB7IHZlcnRleFNoYWRlclNvdXJjZTogKCkgPT4gdGltZVZlcnRleFNoYWRlcigpIH0gOiB7fTtcbiAgICAgICAgICAgICAgICB0aGlzLmdsTGluZXMgPSBMLmdsaWZ5LmxpbmVzKHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubGluZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogZ2VvanNvbixcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5bGluZXNQYW5lXCIsXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoZSBkYXRhIGFib3ZlIGlzIEdlb0pTT04sIHdob3NlIGNvb3JkaW5hdGVzIGFyZSBbbG9uLCBsYXRdOyBnbGlmeVxuICAgICAgICAgICAgICAgICAgICAvLyBkZWZhdWx0cyB0byBsYXRpdHVkZS1maXJzdCBhbmQgaXRzIExJTkUgdmVydGV4IGJ1aWxkZXIgcmVhZHNcbiAgICAgICAgICAgICAgICAgICAgLy8gY29vcmRpbmF0ZXMgdGhyb3VnaCB0aGVzZSBrZXlzIC0tIHVuc2V0LCBpdCB0b29rIGxvbmdpdHVkZSBhc1xuICAgICAgICAgICAgICAgICAgICAvLyBsYXRpdHVkZSBhbmQgcHJvamVjdGVkIGV2ZXJ5IGxpbmUgb2ZmLXZpZXdwb3J0LiBTaWxlbnRseTogbm8gR0xcbiAgICAgICAgICAgICAgICAgICAgLy8gZXJyb3IsIGEgaGVhbHRoeSBjYW52YXMsIHplcm8gZnJhZ21lbnRzLiBTZXQgcGVyIGluc3RhbmNlIHJhdGhlclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGFuIG9uIHRoZSBMLmdsaWZ5IGdsb2JhbCwgd2hpY2ggYW5vdGhlciBsaWJyYXJ5IGNvdWxkIGFsc29cbiAgICAgICAgICAgICAgICAgICAgLy8gbXV0YXRlLiBUaGUgcG9seWdvbiBwYXRoIGlzIGRlbGliZXJhdGVseSBOT1QgZ2l2ZW4gdGhlc2Uga2V5czpcbiAgICAgICAgICAgICAgICAgICAgLy8gaXQgdHJpYW5ndWxhdGVzIHZpYSBlYXJjdXQgb24gdGhlIEdlb0pTT04gZGlyZWN0bHksIG5hdGl2ZVxuICAgICAgICAgICAgICAgICAgICAvLyBbbG9uLCBsYXRdLCBhbmQga2V5cyB0aGVyZSB3b3VsZCB0cmFuc3Bvc2UgaXQgdGhlIHNhbWUgd2F5LlxuICAgICAgICAgICAgICAgICAgICAvLyBGb3VuZCBieSB0aGUgVmFsaGFsbGEtVlJFIGJ1ZyByZXBvcnQsIGRyaXZpbmcgdGhlIHBsYWluLUpTXG4gICAgICAgICAgICAgICAgICAgIC8vIGJ1bmRsZSB3aGVyZSBubyBwb2ludHMgbWFza2VkIHRoZSBibGFuayBsaW5lcy5cbiAgICAgICAgICAgICAgICAgICAgbGF0aXR1ZGVLZXk6IDEsXG4gICAgICAgICAgICAgICAgICAgIGxvbmdpdHVkZUtleTogMCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXcml0dGVuIGJhcmU6IHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vIGBjb21tYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHdhcyB0aGUgb25lIHBhdGggdGhhdCB3b3JrZWQgdGhlcmUuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xMaW5lcyk7XG4gICAgICAgICAgICAgICAgaWYgKHZlY3RvclRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UodGhpcy5nbExpbmVzLCB2ZWN0b3JNZXRhLCB2ZXJ0ZXhDb3VudHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbExpbmVzKSB0aGlzLmdsTGluZXMucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSBcInBvbHlnb25cIikge1xuICAgICAgICBjb25zdCBjbG9zZVJpbmcgPSByaW5nID0+IHtcbiAgICAgICAgICAgIGlmIChyaW5nLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaXJzdCA9IHJpbmdbMF07XG4gICAgICAgICAgICAgICAgY29uc3QgbGFzdCA9IHJpbmdbcmluZy5sZW5ndGggLSAxXTtcbiAgICAgICAgICAgICAgICBpZiAoZmlyc3RbMF0gIT09IGxhc3RbMF0gfHwgZmlyc3RbMV0gIT09IGxhc3RbMV0pIHtcbiAgICAgICAgICAgICAgICAgICAgcmluZy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcmluZztcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBjb25zdCB2ZXJ0ZXhDb3VudHMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgICAgICAvLyBwYXJ0cyAtPiByaW5ncyAtPiBjbG9zZWQgW2xvbiwgbGF0XSBwYWlycy4gYGxheWVyLnJpbmdzYCBzbGljZXMgdGhlIGZsYXRcbiAgICAgICAgICAgIC8vIGNvb3JkaW5hdGUgcnVuIGludG8gcGFydHMgYW5kIGhvbGVzIChbW291dGVyLCBob2xlLCAuLi5dLCAuLi5dKTsgd2l0aG91dFxuICAgICAgICAgICAgLy8gaXQgdGhlIHJ1biBpcyB0aGUgY2xhc3NpYyBzaW5nbGUgaG9sZS1mcmVlIHJpbmcuXG4gICAgICAgICAgICBsZXQgcGFydHMgPSBbXTtcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcbiAgICAgICAgICAgICAgICBjb25zdCBsb25sYXQgPSBsb2NzLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XG4gICAgICAgICAgICAgICAgY29uc3QgcmluZ1RhYmxlID0gbGF5ZXIucmluZ3MgfHxcbiAgICAgICAgICAgICAgICAgICAgKGxvbmxhdC5sZW5ndGggPiAwID8gW1tsb25sYXQubGVuZ3RoXV0gOiBbXSk7XG4gICAgICAgICAgICAgICAgbGV0IGF0ID0gMDtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBhcnRMZW5zIG9mIHJpbmdUYWJsZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByaW5ncyA9IFtdO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGxlbiBvZiBwYXJ0TGVucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmluZyA9IGNsb3NlUmluZyhsb25sYXQuc2xpY2UoYXQsIGF0ICsgbGVuKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBhdCArPSBsZW47XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmluZy5sZW5ndGggPj0gNCkgcmluZ3MucHVzaChyaW5nKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAocmluZ3MubGVuZ3RoID4gMCkgcGFydHMucHVzaChyaW5ncyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XG4gICAgICAgICAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XG4gICAgICAgICAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcbiAgICAgICAgICAgICAgICBjb25zdCByaW5nID0gW107XG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gMzI7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbmdsZSA9IChpICogMzYwKSAvIDMyO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbmdsZVJhZCA9IChhbmdsZSAqIE1hdGguUEkpIC8gMTgwO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkTGF0ID0gKHJhZGl1c01ldGVycyAqIE1hdGguY29zKGFuZ2xlUmFkKSkgLyBlYXJ0aFJhZGl1cztcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZExvbiA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLnNpbihhbmdsZVJhZCkpIC8gKGVhcnRoUmFkaXVzICogTWF0aC5jb3MoKGxhdCAqIE1hdGguUEkpIC8gMTgwKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0xhdCA9IGxhdCArIChkTGF0ICogMTgwKSAvIE1hdGguUEk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0xvbiA9IGxvbiArIChkTG9uICogMTgwKSAvIE1hdGguUEk7XG4gICAgICAgICAgICAgICAgICAgIHJpbmcucHVzaChbbmV3TG9uLCBuZXdMYXRdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcGFydHMgPSBbW3JpbmddXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKDApOyAgIC8vIG5vIGZlYXR1cmUsIGJ1dCB0aGUgc2xvdCBtdXN0IHN0YXkgYWxpZ25lZFxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gQW55IHRyaWFuZ3VsYXRpb24gb2YgYSBwb2x5Z29uIHdpdGggRCBkaXN0aW5jdCB2ZXJ0aWNlcyBhbmQgaCBob2xlcyBoYXNcbiAgICAgICAgICAgIC8vIGV4YWN0bHkgRCArIDJoIC0gMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3NcbiAgICAgICAgICAgIC8vIGVhcmN1dDsgaCA9IDAgZ2l2ZXMgdGhlIGZhbWlsaWFyIEQgLSAyLiBSaW5ncyBhcmUgY2xvc2VkIGJ5IG5vdywgc28gZWFjaFxuICAgICAgICAgICAgLy8gY29udHJpYnV0ZXMgbGVuZ3RoIC0gMSBkaXN0aW5jdCB2ZXJ0aWNlcy4gUGFydHMgdHJpYW5ndWxhdGUgc2VwYXJhdGVseVxuICAgICAgICAgICAgLy8gKGdsaWZ5IGV4cGxvZGVzIGEgTXVsdGlQb2x5Z29uIGludG8gcGVyLXBhcnQgZHJhd3MpIGFuZCBzdW0uXG4gICAgICAgICAgICBsZXQgdHJpYW5nbGVzID0gMDtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgcGFydHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0aW5jdCA9IHJpbmdzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLmxlbmd0aCAtIDEsIDApO1xuICAgICAgICAgICAgICAgIHRyaWFuZ2xlcyArPSBNYXRoLm1heCgwLCBkaXN0aW5jdCArIDIgKiAocmluZ3MubGVuZ3RoIC0gMSkgLSAyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKDMgKiB0cmlhbmdsZXMpO1xuXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBwYXJ0cy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgICAgICAgICAgPyB7IHR5cGU6IFwiUG9seWdvblwiLCBjb29yZGluYXRlczogcGFydHNbMF0gfVxuICAgICAgICAgICAgICAgICAgICA6IHsgdHlwZTogXCJNdWx0aVBvbHlnb25cIiwgY29vcmRpbmF0ZXM6IHBhcnRzIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLmZpbGxPcGFjaXR5IHx8IDAuMiB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hhcGVPcHRpb25zID0gdmVjdG9yVGltZVxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xuICAgICAgICAgICAgICAgIHRoaXMuZ2xTaGFwZXMgPSBMLmdsaWZ5LnNoYXBlcyh7XG4gICAgICAgICAgICAgICAgICAgIC4uLnNoYXBlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXcml0dGVuIGJhcmU6IHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vIGBjb21tYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHdhcyB0aGUgb25lIHBhdGggdGhhdCB3b3JrZWQgdGhlcmUuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xTaGFwZXMpO1xuICAgICAgICAgICAgICAgIGlmICh2ZWN0b3JUaW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsU2hhcGVzKSB0aGlzLmdsU2hhcGVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XG4gICAgY29uc3QgaW5kZXhNYXBwaW5nID0gW107XG5cbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xuICAgIC8vIGdsaWZ5J3MgZmFsbGJhY2sgd2hlbiBhIGxheWVyIGRlY2xhcmVzIG5vIHJhZGl1cy4gUGlucyBuZWVkIGZhciBtb3JlIHJvb20gdGhhbiBhXG4gICAgLy8gY2lyY2xlIGJlY2F1c2UgdGhlIGdseXBoIGlzIGRyYXduIGluc2lkZSB0aGUgcG9pbnQncyBvd24gcXVhZCBieSB0aGUgc2hhZGVyLlxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XG5cbiAgICAvLyBHUFUgdGltZSBwYXRoOiB3aGVuIHRoaXMgYnVja2V0IGhvbGRzIHRpbWUgbGF5ZXJzLCBldmVyeSBwb2ludCBpcyBmZWQgdG8gZ2xpZnkgYW5kXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXG4gICAgLy8gdmVydGV4IHNoYWRlciwgc28gYSB0aWNrIGNvc3RzIHR3byB1bmlmb3JtcyBpbnN0ZWFkIG9mIHJlYnVpbGRpbmcgNU0gcG9pbnRzIGluIEpTLlxuICAgIC8vIFRoZSBDUFUgZmlsdGVyIGJlbG93IHN0YXlzIGFzIHRoZSBmYWxsYmFjayB3aGVuIHRoZSBHTCB3aXJpbmcgaXMgdW5hdmFpbGFibGUuXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcbiAgICAgICAgPyBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxuICAgICAgICAgICAgdGltZVN0YXRlICYmIHRpbWVTdGF0ZS5wZXJpb2QgPyBwZXJpb2RUb01zKHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbClcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgY29uc3QgZ3B1VGltZSA9IEJvb2xlYW4oZ3B1QXR0cnMuaGFzVGltZSk7XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgY29sb3JSR0IgPSBwYXJzZUNvbG9yKGxheWVyLmNvbG9yLCBmYWxsYmFja0NvbG9yKTtcbiAgICAgICAgY29uc3QgbGF5ZXJTaXplID0gbGF5ZXIucmFkaXVzICE9IG51bGwgPyBOdW1iZXIobGF5ZXIucmFkaXVzKSA6IGRlZmF1bHRTaXplO1xuXG4gICAgICAgIGNvbnN0IGNvb3JkQnVmZmVyID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICBpZiAoIWNvb3JkQnVmZmVyKSB7XG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2xheWVyLmxvY2F0aW9uWzBdLCBsYXllci5sb2NhdGlvblsxXV0pO1xuICAgICAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiAwLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3JSR0IsXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnVmZmVyLFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZU9mZnNldCxcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGNvdW50ID0gY29vcmRzLmxlbmd0aCAvIDI7XG5cbiAgICAgICAgY29uc3QgcGVyRmVhdHVyZSA9IEFycmF5LmlzQXJyYXkobGF5ZXIuZmVhdHVyZV9zdHlsZXMpID8gbGF5ZXIuZmVhdHVyZV9zdHlsZXMgOiBudWxsO1xuICAgICAgICAvLyBTZWxlY3Rpb24gc3R5bGluZywgYXBwbGllZCBvdmVyIHRoZSBsYXllcidzIG93biBhbmQgaXRzIGRhdGEtZHJpdmVuIHN0eWxlcy5cbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cbiAgICAgICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlIHx8IG51bGw7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlcyA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyB8fCBudWxsO1xuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxuICAgICAgICAvLyBzaW1wbHkgbm90IHB1c2hlZDsgaW5kZXhNYXBwaW5nIGNhcnJpZXMgb3JpZ2luYWxJbmRleCwgc28gcG9wdXBzIGFuZCBwcm9wZXJ0aWVzXG4gICAgICAgIC8vIG9uIHRoZSBzdXJ2aXZvcnMga2VlcCBwb2ludGluZyBhdCB0aGUgcmlnaHQgcm93cy5cbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcbiAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZClcbiAgICAgICAgICAgIDogbnVsbDtcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBmcm9tRGF0YSA9IHBlckZlYXR1cmUgPyBwZXJGZWF0dXJlW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gb3ZlcnJpZGVzID8gb3ZlcnJpZGVzW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChmcm9tRGF0YSAmJiBmcm9tRGF0YS5jb2xvcik7XG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xuICAgICAgICAgICAgICAgIDogaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5yYWRpdXMgIT0gbnVsbCA/IGhpZ2hsaWdodC5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IGZyb21EYXRhICYmIGZyb21EYXRhLnJhZGl1cyAhPSBudWxsID8gZnJvbURhdGEucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2Nvb3Jkc1tpICogMl0sIGNvb3Jkc1tpICogMiArIDFdXSk7XG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XG4gICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IGksXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcikgOiBjb2xvclJHQixcbiAgICAgICAgICAgICAgICBzaXplOiByYWRpdXMgIT0gbnVsbCA/IE51bWJlcihyYWRpdXMpIDogbGF5ZXJTaXplXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb2ludHNMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3QgZ2V0SW50ZXJhY3RpdmVFbCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICBjb25zdCBnbGlmeU9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXG4gICAgICAgICAgICAgICAgcGFuZTogXCJwb2ludHNQYW5lXCIsXG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZWQgcGVyIHBvaW50LCBsaWtlIGNvbG91cjogc2V2ZXJhbCBsYXllcnMgc2hhcmUgb25lIGdsaWZ5IGluc3RhbmNlLFxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cbiAgICAgICAgICAgICAgICBzaXplOiAoaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gPyBpbmZvLmNvbG9yUkdCIDogeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlbnNpdGl2aXR5OiB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDIwIDogOCxcbiAgICAgICAgICAgICAgICBjbGljazogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHBvcHVwcyBvbiBmYXIgYXdheSBjbGlja3NcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gY2xpY2tQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBvaW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaG92ZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoTC5sYXRMbmcocG9pbnRbMF0sIHBvaW50WzFdKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaXhlbERpc3QgPiBtYXhEaXN0KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gZ2V0SW50ZXJhY3RpdmVFbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gaW5mby5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBwb2ludCwgcHJvcHMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy5mcmFnbWVudFNoYWRlclNvdXJjZSA9ICgpID0+IHBpblNoYWRlcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcbiAgICAgICAgICAgICAgICBnbGlmeU9wdGlvbnMudmVydGV4U2hhZGVyU291cmNlID0gKCkgPT4gdGltZVZlcnRleFNoYWRlcigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5nbFBvaW50cyA9IEwuZ2xpZnkucG9pbnRzKGdsaWZ5T3B0aW9ucyk7XG4gICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsUG9pbnRzKTtcbiAgICAgICAgICAgIGlmIChncHVUaW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gTnVsbCBvbiBmYWlsdXJlLCB3aGljaCBhbHNvIGZsaXBzIHRoZSBnbG9iYWwgZmxhZzogdGhlIG5leHQgc3luYydzXG4gICAgICAgICAgICAgICAgLy8gcmVidWlsZCBrZXkgY2hhbmdlcyB3aXRoIGl0IGFuZCB0aGUgQ1BVIHBhdGggdGFrZXMgb3Zlci5cbiAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9JbnN0YW5jZSh0aGlzLmdsUG9pbnRzLCBncHVBdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XG4gICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcbiAgICAgICAgICAgIGlmIChjYW52YXMpIGNhbnZhcy5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICByZXR1cm4gaW5zdGFuY2U7XG59XG4iLCAiaW1wb3J0IHsgbG9hZENTUywgbG9hZEpTIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHJlbmRlclNpZGViYXJDb250cm9scywgbm9ybWFsaXplUmFkaW9MYXllcnMsIHNlbmRMYXllcldyaXRlIH0gZnJvbSBcIi4vc2lkZWJhci5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyTGF5ZXIsIHJlbmRlck1lcmdlZEdsTGF5ZXIgfSBmcm9tIFwiLi9sYXllcnMuanNcIjtcbmltcG9ydCB7IHBhcnNlUGVyaW9kLCBnZW5lcmF0ZVRpY2tzLCBjb2xsZWN0VGltZUV4dGVudCwgaGFzVGltZUxheWVycyxcbiAgICAgICAgIGxheWVySW5XaW5kb3csIHJlbmRlclRpbWVDb250cm9sLCBhZHZhbmNlLCBwZXJpb2RUb01zLCBnY2RHcmlkTXMsXG4gICAgICAgICBjb2xsZWN0RHVyYXRpb25zTXMgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xuaW1wb3J0IHsgZ3B1VGltZUF2YWlsYWJsZSwgdmVjdG9yR3B1QXZhaWxhYmxlLCBMQVlFUl9TTE9UUyB9IGZyb20gXCIuL2dwdXRpbWUuanNcIjtcblxuLy8gVHJ1ZSBpZiBhIGxheWVyIGlzIHZpc2libGUgYW5kIG5vIGZvbGRlciBhYm92ZSBpdCBpcyBzd2l0Y2hlZCBvZmYuXG4vL1xuLy8gVmlzaWJpbGl0eSBpcyBpbmhlcml0ZWQgZG93biB0aGUgZm9sZGVyIHBhdGg6IGEgbGF5ZXIgaW5zaWRlIFwiRmVlZHMvQWN0aXZlXCIgaXMgaGlkZGVuXG4vLyB3aGVuIGVpdGhlciBcIkZlZWRzXCIgb3IgXCJGZWVkcy9BY3RpdmVcIiBpcyBvZmYsIHJlZ2FyZGxlc3Mgb2YgaXRzIG93biBmbGFnLiBHZXR0aW5nIHRoaXNcbi8vIHdyb25nIHNob3dzIHVwIGFzIFwidGhhdCBsYXllciBqdXN0IHdpbGwgbm90IGFwcGVhclwiLCB3aXRoIG5vdGhpbmcgbG9nZ2VkLlxuZXhwb3J0IGZ1bmN0aW9uIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpIHtcbiAgICBpZiAobGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xuICAgIGZvciAoY29uc3QgcGFydCBvZiAobGF5ZXIubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIikuc3BsaXQoXCIvXCIpKSB7XG4gICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xuICAgICAgICBjb25zdCBjb25maWcgPSBncm91cENvbmZpZ3NbcnVubmluZ1BhdGhdO1xuICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gU29ydHMgdGhlIHZpc2libGUgbGF5ZXJzIGludG8gb25lIGJ1Y2tldCBwZXIgV2ViR0wgZHJhdyBwYXNzLlxuLy9cbi8vIFN1Yi1sYXllcnMgb2YgYSBtZXJnZWQgZ3JvdXAgaW5oZXJpdCB0aGVpciBwYXJlbnQncyB2aXNpYmlsaXR5IHJhdGhlciB0aGFuIGNhcnJ5aW5nXG4vLyB0aGVpciBvd24sIHNvIGEgZ3JvdXAgdG9nZ2xlZCBvZmYgY29udHJpYnV0ZXMgbm90aGluZyBldmVuIHdoZW4gaXRzIGNoaWxkcmVuIHNheVxuLy8gdmlzaWJsZS4gQ2lyY2xlcyBqb2luIHRoZSBwb2x5Z29uIGJ1Y2tldDogdGhleSBhcmUgZHJhd24gYXMgZ2VuZXJhdGVkIHJpbmdzLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xuICAgIGNvbnN0IGJ1Y2tldHMgPSB7IGNpcmNsZV9tYXJrZXJzOiBbXSwgbWFya2VyczogW10sIHBvbHlsaW5lOiBbXSwgcG9seWdvbjogW10gfTtcblxuICAgIGZ1bmN0aW9uIGNvbGxlY3QobGF5ZXIsIHBhcmVudFZpc2libGUsIGlzU3ViTGF5ZXIpIHtcbiAgICAgICAgaWYgKCFwYXJlbnRWaXNpYmxlKSByZXR1cm47XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gY29sbGVjdChzdWIsIHBhcmVudFZpc2libGUsIHRydWUpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWlzU3ViTGF5ZXIgJiYgbGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybjtcblxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xuICAgICAgICBpZiAoYnVja2V0c1tidWNrZXRdKSBidWNrZXRzW2J1Y2tldF0ucHVzaChsYXllcik7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgY29sbGVjdChsYXllciwgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyksIGZhbHNlKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ1Y2tldHM7XG59XG5cbi8vIEFwcGxpZXMgaW5jcmVtZW50YWwgcGF0Y2ggb3BzIHRvIHtsYXllcnMsIGJ1ZmZlcnN9LCByZXR1cm5pbmcgdGhlIG5ldyBzdGF0ZS5cbi8vXG4vLyBPcHMgYXJlIGFkZHJlc3NlZCBieSBsYXllciBpZCBhbmQgYXBwbGllZCBpZGVtcG90ZW50bHk6IFwiYWRkXCIgdXBzZXJ0cyByYXRoZXIgdGhhblxuLy8gYXBwZW5kaW5nIGJsaW5kbHksIHNvIGEgcGF0Y2ggdGhhdCByYWNlcyB0aGUgaW5pdGlhbCB0cmFpdCBzbmFwc2hvdCBjYW5ub3QgZHVwbGljYXRlXG4vLyBhIGxheWVyLCBhbmQgYSBcInJlbW92ZVwiIGZvciBzb21ldGhpbmcgYWxyZWFkeSBnb25lIGlzIGEgbm8tb3AuXG4vLyBBcHBsaWVzIGB1cGRhdGVgIHRvIG9uZSBsYXllciB3aGVyZXZlciBpdCBzaXRzLCBkZXNjZW5kaW5nIGludG8gZ3JvdXBzLiBhZGRfY29sbGVjdGlvblxuLy8gbmVzdHMgaXRzIHBvaW50LCBsaW5lIGFuZCBwb2x5Z29uIGxheWVycyBpbnNpZGUgYSBncm91cCBsYXllciwgc28gYW4gb3AgYWRkcmVzc2VkIGF0IGFcbi8vIG5lc3RlZCBpZCB3b3VsZCBvdGhlcndpc2UgbWF0Y2ggbm90aGluZyBhbmQgc2lsZW50bHkgZG8gbm90aGluZy4gUmV0dXJucyB0aGUgb3JpZ2luYWxcbi8vIGFycmF5IHVudG91Y2hlZCB3aGVuIHRoZSBpZCBpcyBub3QgZm91bmQsIHNvIGFuIHVubWF0Y2hlZCBvcCBjb3N0cyBubyByZS1yZW5kZXIuXG5mdW5jdGlvbiB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBpZCwgdXBkYXRlKSB7XG4gICAgbGV0IGhpdCA9IGZhbHNlO1xuICAgIGNvbnN0IG5leHQgPSBsYXllcnMubWFwKGwgPT4ge1xuICAgICAgICBpZiAobC5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgIGhpdCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm4gdXBkYXRlKGwpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBBcnJheS5pc0FycmF5KGwubGF5ZXJzKSkge1xuICAgICAgICAgICAgY29uc3Qgc3VicyA9IHVwZGF0ZUxheWVyQnlJZChsLmxheWVycywgaWQsIHVwZGF0ZSk7XG4gICAgICAgICAgICBpZiAoc3VicyAhPT0gbC5sYXllcnMpIHtcbiAgICAgICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IC4uLmwsIGxheWVyczogc3VicyB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBsO1xuICAgIH0pO1xuICAgIHJldHVybiBoaXQgPyBuZXh0IDogbGF5ZXJzO1xufVxuXG4vLyBFdmVyeSBwb2ludCBsYXllciwgdmlzaWJsZSBvciBub3QsIHdpdGggaXRzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5IHJlY29yZGVkIC0tIHRoZVxuLy8gR1BVLXZpc2liaWxpdHkgcGF0aCBrZWVwcyBoaWRkZW4gbGF5ZXJzIGluIHRoZSBidWNrZXQgKHN0YWJsZSBpZHMsIG5vIHJlYnVpbGQgb24gYVxuLy8gdG9nZ2xlKSBhbmQgaGlkZXMgdGhlbSB3aXRoIGEgdW5pZm9ybSBpbnN0ZWFkLiBNaXJyb3JzIGNvbGxlY3RXZWJnbExheWVycycgcnVsZXM6XG4vLyBzdWItbGF5ZXJzIGluaGVyaXQgdGhlaXIgcGFyZW50J3MgZWZmZWN0aXZlIHZpc2liaWxpdHksIHRvcC1sZXZlbCBsYXllcnMgYW5zd2VyIGZvclxuLy8gdGhlaXIgb3duIGZsYWcgYW5kIHRoZWlyIGZvbGRlciBjaGFpbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0UG9pbnRMYXllcnNBbGwobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcbiAgICBjb25zdCBvdXQgPSB7IGNpcmNsZV9tYXJrZXJzOiBbXSwgbWFya2VyczogW10sIHBvbHlsaW5lOiBbXSwgcG9seWdvbjogW10gfTtcbiAgICBmdW5jdGlvbiB3YWxrKGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1Yikge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgY29uc3Qgc2VsZlZpcyA9IHBhcmVudFZpc2libGUgJiYgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gd2FsayhzdWIsIHNlbGZWaXMsIHRydWUpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xuICAgICAgICBpZiAoIW91dFtidWNrZXRdKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHZpcyA9IGlzU3ViID8gcGFyZW50VmlzaWJsZVxuICAgICAgICAgICAgOiBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICBvdXRbYnVja2V0XS5wdXNoKHsgbGF5ZXIsIHZpcyB9KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHdhbGsobGF5ZXIsIHRydWUsIGZhbHNlKTtcbiAgICByZXR1cm4gb3V0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTd2lmdG1hcFBhdGNoKHN0YXRlLCBvcHMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbGF5ZXJzID0gc3RhdGUubGF5ZXJzIHx8IFtdO1xuICAgIGxldCBidWZmZXJNYXAgPSBzdGF0ZS5idWZmZXJzIHx8IHt9O1xuXG4gICAgZm9yIChjb25zdCBvcCBvZiBvcHMpIHtcbiAgICAgICAgaWYgKG9wLm9wID09PSBcInNuYXBzaG90XCIpIHtcbiAgICAgICAgICAgIGxheWVycyA9IG9wLmxheWVycyB8fCBbXTtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHt9O1xuICAgICAgICAgICAgKG9wLmJ1ZmZlcl9pZHMgfHwgW10pLmZvckVhY2goKGlkLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcnMgJiYgYnVmZmVyc1tpXSkgYnVmZmVyTWFwW2lkXSA9IGJ1ZmZlcnNbaV07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJhZGRcIiB8fCBvcC5vcCA9PT0gXCJyZXBsYWNlXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGluY29taW5nID0gb3AubGF5ZXI7XG4gICAgICAgICAgICBjb25zdCBpZCA9IGluY29taW5nID8gaW5jb21pbmcuaWQgOiBvcC5pZDtcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IGxheWVycy5maW5kSW5kZXgobCA9PiBsLmlkID09PSBpZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IFsuLi5sYXllcnMsIGluY29taW5nXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLm1hcCgobCwgaSkgPT4gKGkgPT09IGlkeCA/IGluY29taW5nIDogbCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInNldFwiKSB7XG4gICAgICAgICAgICAvLyBGaWVsZC1sZXZlbCB1cGRhdGUuIFwicmVwbGFjZVwiIGNhcnJpZXMgdGhlIHdob2xlIGxheWVyLCBzbyBmbGlwcGluZyBgdmlzaWJsZWBcbiAgICAgICAgICAgIC8vIG9uIGEgNTBrLXBvaW50IGxheWVyIHJlc2VudCBldmVyeSBwcm9wZXJ0eSBpdCBob2xkcyAtLSBoYWxmIGEgbWVnYWJ5dGUgdG9cbiAgICAgICAgICAgIC8vIGNoYW5nZSBvbmUgYm9vbGVhbiwgb24gZXZlcnkgY2xpY2sgb2YgYSBjaGVja2JveC5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7IC4uLmwsIC4uLihvcC5maWVsZHMgfHwge30pIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzdHlsZVwiKSB7XG4gICAgICAgICAgICAvLyBQZXItZmVhdHVyZSBzdHlsZSBvdmVycmlkZXMsIHJlcGxhY2VkIHdob2xlc2FsZSByYXRoZXIgdGhhbiBtZXJnZWQ6IGFcbiAgICAgICAgICAgIC8vIHNlbGVjdGlvbiBkZXNjcmliZXMgaXRzIGNvbXBsZXRlIHN0YXRlLCBzbyBzZW5kaW5nIHt9IGNsZWFycyBpdCBhbmQgbm9cbiAgICAgICAgICAgIC8vIGNhbGxlciBoYXMgdG8gdHJhY2sgd2hhdCB0aGUgcHJldmlvdXMgaGlnaGxpZ2h0IHRvdWNoZWQuXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmwsIHN0eWxlX292ZXJyaWRlczogb3Aub3ZlcnJpZGVzIHx8IHt9LFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInJlbW92ZVwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBsYXllcnMuZmlsdGVyKGwgPT4gbC5pZCAhPT0gb3AuaWQpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlclwiKSB7XG4gICAgICAgICAgICBjb25zdCBidWYgPSBidWZmZXJzICYmIGJ1ZmZlcnNbb3AuYnVmZmVyX2luZGV4XTtcbiAgICAgICAgICAgIGlmIChidWYpIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwLCBbb3AuaWRdOiBidWYgfTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJfcmVtb3ZlXCIpIHtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwIH07XG4gICAgICAgICAgICBkZWxldGUgYnVmZmVyTWFwW29wLmlkXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7IGxheWVycywgYnVmZmVyczogYnVmZmVyTWFwIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgICBhc3luYyByZW5kZXIoeyBtb2RlbCwgZWwgfSkge1xuICAgICAgICBjb25zdCBvcmlnaW5hbEVycm9yID0gY29uc29sZS5lcnJvcjtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxXYXJuID0gY29uc29sZS53YXJuO1xuXG4gICAgICAgIC8vIGpzX2NvbnNvbGVfbG9ncyBpcyBhIHN5bmNlZCBsaXN0LCBzbyBlYWNoIGFwcGVuZCByZXNlbmRzIHRoZSB3aG9sZSBhcnJheS4gS2VlcGluZ1xuICAgICAgICAvLyBvbmx5IHRoZSBtb3N0IHJlY2VudCBlbnRyaWVzIGJvdW5kcyBib3RoIHRoZSBwYXlsb2FkIGFuZCB0aGUgbWVtb3J5IGEgbG9uZy1saXZlZFxuICAgICAgICAvLyBzZXNzaW9uIGFjY3VtdWxhdGVzOyB0aGUgbmV3ZXN0IGFyZSB0aGUgb25lcyB3b3J0aCBoYXZpbmcgYW55d2F5LlxuICAgICAgICBjb25zdCBNQVhfQ09OU09MRV9MT0dTID0gMjAwO1xuICAgICAgICBjb25zdCBhcHBlbmRMb2cgPSBlbnRyeSA9PiB7XG4gICAgICAgICAgICBjb25zdCBsb2dzID0gbW9kZWwuZ2V0KFwianNfY29uc29sZV9sb2dzXCIpIHx8IFtdO1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IFsuLi5sb2dzLCBlbnRyeV07XG4gICAgICAgICAgICByZXR1cm4gbmV4dC5sZW5ndGggPiBNQVhfQ09OU09MRV9MT0dTID8gbmV4dC5zbGljZSgtTUFYX0NPTlNPTEVfTE9HUykgOiBuZXh0O1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEhlbHBlciB0byBzYWZlbHkgd3JpdGUgYmFjayB0byBQeXRob24gb25seSBpZiB0aGUgd2lkZ2V0IHZpZXcgaXMgYWN0aXZlIGFuZCBhdHRhY2hlZFxuICAgICAgICBmdW5jdGlvbiBzYWZlU2V0QW5kU2F2ZShrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyB3cml0ZSBlcnJvcjpcIiwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc2FmZVNhdmVDaGFuZ2VzKCkge1xuICAgICAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHNhdmUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IgPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBvcmlnaW5hbEVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIixcbiAgICAgICAgICAgICAgICBhcHBlbmRMb2coXCJDT05TT0xFLkVSUk9SOiBcIiArIGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKSkpO1xuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgbGV0IGxvZ2dlZFJlcHJvamVjdGVkID0gZmFsc2U7XG4gICAgICAgIGNvbnNvbGUud2FybiA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKTtcbiAgICAgICAgICAgIGlmIChtc2cuaW5jbHVkZXMoXCJsYXllciBkZXNpZ25lZCBmb3IgU3BoZXJpY2FsTWVyY2F0b3JcIikgfHwgbXNnLmluY2x1ZGVzKFwiYWx0ZXJuYXRlIGRldGVjdGVkXCIpKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFsb2dnZWRSZXByb2plY3RlZCkge1xuICAgICAgICAgICAgICAgICAgICBsb2dnZWRSZXByb2plY3RlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNycyA9IG1vZGVsLmdldChcImNyc1wiKSB8fCBcIkVQU0c6Mzg1N1wiO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGVhbk1zZyA9IGBbU3dpZnRNYXBdIExheWVyIHdhcyByZXByb2plY3RlZCB0byBcIiR7Y3JzfVwiYDtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgY2xlYW5Nc2cpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIiwgYXBwZW5kTG9nKGNsZWFuTXNnKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gc3VwcHJlc3MgZHVwbGljYXRlIGNvbnNvbGUgd2FybmluZ3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgfTtcblxuICAgICAgICB3aW5kb3cub25lcnJvciA9IGZ1bmN0aW9uKG1lc3NhZ2UsIHNvdXJjZSwgbGluZW5vLCBjb2xubywgZXJyb3IpIHtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKGBXSU5ET1cuT05FUlJPUjogJHttZXNzYWdlfSBhdCAke3NvdXJjZX06JHtsaW5lbm99OiR7Y29sbm99YCkpO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIExvYWQgQ1NTIGFuZCBMZWFmbGV0IGxpYnJhcmllcyAoaW5jbHVkaW5nIFdlYkdMIGdsaWZ5KVxuICAgICAgICBsb2FkQ1NTKFwibGVhZmxldC1jc3NcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5jc3NcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtanNcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5qc1wiKTtcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1nbGlmeVwiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXQuZ2xpZnlAMy4zLjAvZGlzdC9nbGlmeS1icm93c2VyLmpzXCIpO1xuXG4gICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGNvbnRhaW5lci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWNvbnRhaW5lclwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLmhlaWdodCA9IFwiMTAwJVwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUucG9zaXRpb24gPSBcInJlbGF0aXZlXCI7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKGNvbnRhaW5lcik7XG5cbiAgICAgICAgY29uc3QgY3JzTmFtZSA9IG1vZGVsLmdldChcImNyc1wiKTtcbiAgICAgICAgbGV0IG1hcENycyA9IEwuQ1JTLkVQU0czODU3O1xuICAgICAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xuICAgICAgICAgICAgbWFwQ3JzID0gTC5DUlMuRVBTRzQzMjY7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYXAgPSBMLm1hcChjb250YWluZXIsIHtcbiAgICAgICAgICAgIGNyczogbWFwQ3JzLFxuICAgICAgICAgICAgY2VudGVyOiBtb2RlbC5nZXQoXCJjZW50ZXJcIiksXG4gICAgICAgICAgICB6b29tOiBtb2RlbC5nZXQoXCJ6b29tXCIpLFxuICAgICAgICAgICAgc2Nyb2xsV2hlZWxab29tOiB0cnVlLFxuICAgICAgICAgICAgcHJlZmVyQ2FudmFzOiB0cnVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWdvbnNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlnb25zUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQxMFwiO1xuICAgICAgICBcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5bGluZXNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlsaW5lc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MjBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9pbnRzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDMwXCI7XG5cbiAgICAgICAgLy8gTG9jYWwgbWlycm9ycyBvZiB0aGUgbGF5ZXIgbGlzdCBhbmQgY29vcmRpbmF0ZSBidWZmZXJzLlxuICAgICAgICAvL1xuICAgICAgICAvLyBQeXRob24gdXBkYXRlcyB0aGVzZSBpbmNyZW1lbnRhbGx5IHZpYSBcInN3aWZ0bWFwX3BhdGNoXCIgbWVzc2FnZXMgaW5zdGVhZCBvZlxuICAgICAgICAvLyByZWFzc2lnbmluZyB0aGUgdHJhaXRzLCBiZWNhdXNlIGEgdHJhaXQgcmVhc3NpZ25tZW50IHJlLXNlcmlhbGl6ZXMgYW5kIHJlLXNlbmRzXG4gICAgICAgIC8vIHRoZSBlbnRpcmUgbWFwIG9uIGV2ZXJ5IG11dGF0aW9uLiBUaGUgdHJhaXRzIHN0aWxsIGNhcnJ5IHRoZSBpbml0aWFsIHNuYXBzaG90XG4gICAgICAgIC8vIHdoZW4gYSB2aWV3IGF0dGFjaGVzLCBhbmQgdGhlIHNpZGViYXIgc3RpbGwgd3JpdGVzIGBsYXllcnNgIGJhY2sgb24gdG9nZ2xlLCBzb1xuICAgICAgICAvLyBib3RoIGFyZSBzZWVkZWQgaGVyZSBhbmQga2VwdCBpbiBzdGVwIGJ5IHRoZSBjaGFuZ2UgaGFuZGxlcnMgZnVydGhlciBkb3duLlxuICAgICAgICBsZXQgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcbiAgICAgICAgbGV0IGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xuXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5UGF0Y2hPcHMob3BzLCBidWZmZXJzKSB7XG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gYXBwbHlTd2lmdG1hcFBhdGNoKHsgbGF5ZXJzOiBsYXllclN0YXRlLCBidWZmZXJzOiBidWZmZXJTdGF0ZSB9LCBvcHMsIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG5leHQubGF5ZXJzO1xuICAgICAgICAgICAgYnVmZmVyU3RhdGUgPSBuZXh0LmJ1ZmZlcnM7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY3RpdmVUaWxlTGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcbiAgICAgICAgY29uc3QgZ2xTdGF0ZXMgPSB7XG4gICAgICAgICAgICBjaXJjbGVfbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlsaW5lOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlnb246IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xuICAgICAgICAvLyBhbmQgdGhlIHBlcmlvZCwgb3IgbnVsbCB3aGVuIG5vdGhpbmcgaXMgYW5pbWF0ZWQgLS0gYW5kIGB0aW1lVUlgIGlzIHRoZSBzbGlkZXInc1xuICAgICAgICAvLyBvd24gYm9va2tlZXBpbmcuIFBsYXliYWNrIG5ldmVyIHJvdW5kLXRyaXBzIHRocm91Z2ggUHl0aG9uOiB0aWNrcyByZS1yZW5kZXJcbiAgICAgICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXG4gICAgICAgIGxldCB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICBjb25zdCB0aW1lVUkgPSB7IHRpY2tzOiBbXSwga2V5OiBcIlwiLCBpbmRleDogMCwgcGxheWluZzogZmFsc2UsIGxvb3A6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3c6IG51bGwsIHBlcmlvZE1zOiBudWxsLCBncmlkTXM6IG51bGwgfTtcblxuICAgICAgICBmdW5jdGlvbiBzdG9wUGxheWJhY2soKSB7XG4gICAgICAgICAgICBpZiAodGltZVVJLnRpbWVyKSBjbGVhckludGVydmFsKHRpbWVVSS50aW1lcik7XG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBudWxsO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHdyaXRlVGltZUN1cnJlbnQoZm9yY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICBpZiAoIWZvcmNlICYmIG5vdyAtIHRpbWVVSS5sYXN0V3JpdGUgPCAxMDAwKSByZXR1cm47XG4gICAgICAgICAgICB0aW1lVUkubGFzdFdyaXRlID0gbm93O1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ0aW1lX2N1cnJlbnRcIiwgdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzZWVrVG8oaW5kZXgsIHsgd3JpdGUgPSB0cnVlIH0gPSB7fSkge1xuICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSk7XG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2Q6IHRpbWVTdGF0ZS5wZXJpb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xuICAgICAgICAgICAgaWYgKHdyaXRlKSB3cml0ZVRpbWVDdXJyZW50KCF0aW1lVUkucGxheWluZyk7XG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzdGFydFBsYXliYWNrKCkge1xuICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICB0aW1lVUkucGxheWluZyA9IHRydWU7XG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFkdmFuY2UodGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoLCB0aW1lVUkubG9vcCk7XG4gICAgICAgICAgICAgICAgaWYgKCFuZXh0LnBsYXlpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2Vla1RvKG5leHQuaW5kZXgpO1xuICAgICAgICAgICAgfSwgMTAwMCAvIHRpbWVVSS5zcGVlZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0aW1lSGFuZGxlcnMgPSB7XG4gICAgICAgICAgICBvblNlZWs6IChpbmRleCkgPT4gc2Vla1RvKGluZGV4KSxcbiAgICAgICAgICAgIG9uU3RlcEJhY2s6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggLSAxKSxcbiAgICAgICAgICAgIG9uU3RlcEZvcndhcmQ6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggKyAxKSxcbiAgICAgICAgICAgIG9uUGxheVRvZ2dsZTogKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBzdGFydE92ZXIsIGFzIHRoZSBmb2xpdW0gcGxheWVyIHdhcyBjb25maWd1cmVkOiBwcmVzc2luZyBwbGF5IGF0XG4gICAgICAgICAgICAgICAgICAgIC8vIHRoZSBlbmQgcmVzdGFydHMgZnJvbSB0aGUgYmVnaW5uaW5nIGltbWVkaWF0ZWx5LCByYXRoZXIgdGhhbiBvbmVcbiAgICAgICAgICAgICAgICAgICAgLy8gc2lsZW50IGludGVydmFsIGxhdGVyIGRlY2lkaW5nIHRoZXJlIGlzIG5vd2hlcmUgdG8gZ28gYW5kIHN0b3BwaW5nLlxuICAgICAgICAgICAgICAgICAgICBpZiAodGltZVVJLmluZGV4ID49IHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSBzZWVrVG8oMCk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9ICF0aW1lVUkubG9vcDtcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uU3BlZWQ6IChzcGVlZCkgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IHNwZWVkO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIExpdmUgZHVyaW5nIHRoZSBkcmFnOiBsb2NhbCBzdGF0ZSBhbmQgYSByZS1yZW5kZXIgb2YgdGhlIGNvbnRyb2wgb24gZXZlcnlcbiAgICAgICAgICAgIC8vIG1vdmUsIGJ1dCBtYXAgcmVidWlsZHMgYXQgbW9zdCBldmVyeSAzMDBtcy4gQXQgNU0gcG9pbnRzIGEgcmVidWlsZCBjb3N0c1xuICAgICAgICAgICAgLy8gc2Vjb25kcywgYW5kIGEgZHJhZyBmaXJlcyBkb3plbnMgb2YgbW92ZXMgLS0gdW50aHJvdHRsZWQsIHRoZSByZWJ1aWxkc1xuICAgICAgICAgICAgLy8gc3RhY2sgZmFzdGVyIHRoYW4gdGhleSBmaW5pc2ggYW5kIHRoZSBhbGxvY2F0aW9uIGNodXJuIGNyYXNoZXMgdGhlIHRhYi5cbiAgICAgICAgICAgIG9uV2luZG93RHJhZzogKGlzbykgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aW1lVUkud2luZG93ID0gaXNvO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHRpbWVTdGF0ZSA9IHsgLi4udGltZVN0YXRlLCB3aW5kb3c6IGlzbyB9O1xuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICAgICAgICBpZiAobm93IC0gKHRpbWVVSS5sYXN0RHJhZ1N5bmMgfHwgMCkgPj0gMzAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5sYXN0RHJhZ1N5bmMgPSBub3c7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBPbiByZWxlYXNlIChvciBhIGtleWJvYXJkIHN0ZXApOiB0aGUgb3ZlcnJpZGUgbGFuZHMgaW4gdGltZV9jb25maWcgc29cbiAgICAgICAgICAgIC8vIFB5dGhvbiBhbmQgU2hpbnkgc2VlIHRoZSBzYW1lIHdpbmRvdyB0aGUgYmFyIHNob3dzLiBudWxsIGNsZWFycyB0aGUga2V5LFxuICAgICAgICAgICAgLy8gaGFuZGluZyBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbiAgICAgICAgICAgIG9uV2luZG93Q29tbWl0OiAoaXNvKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZUhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7ICAgICAgIC8vIHRoZSByZWxlYXNlIGFsd2F5cyBsYW5kcywgdGhyb3R0bGUgb3Igbm90XG4gICAgICAgICAgICAgICAgY29uc3QgY2ZnID0geyAuLi4obW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge30pIH07XG4gICAgICAgICAgICAgICAgaWYgKGlzbykgY2ZnLndpbmRvdyA9IGlzbztcbiAgICAgICAgICAgICAgICBlbHNlIGRlbGV0ZSBjZmcud2luZG93O1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInRpbWVfY29uZmlnXCIsIGNmZyk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBsb2NhbCBtb2RlbCBzdGlsbCBob2xkcyBpdCAqLyB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIENyZWF0ZXMsIHJldHVuZXMgb3IgcmVtb3ZlcyB0aGUgc2xpZGVyIHRvIG1hdGNoIHRoZSBsYXllcnMgcHJlc2VudC4gVGlja3MgYXJlXG4gICAgICAgIC8vIHJlZ2VuZXJhdGVkIG9ubHkgd2hlbiB0aGUgZGF0YSdzIHRpbWUgZXh0ZW50IG9yIHRoZSBwZXJpb2QgY2hhbmdlcywgc28gYVxuICAgICAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVUaW1lRGltZW5zaW9uKCkge1xuICAgICAgICAgICAgaWYgKCFoYXNUaW1lTGF5ZXJzKGxheWVyU3RhdGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHsgdGlja3M6IFtdIH0sIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBcIlwiO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XG4gICAgICAgICAgICBjb25zdCBleHRlbnQgPSBjb2xsZWN0VGltZUV4dGVudChsYXllclN0YXRlLCBidWZmZXJTdGF0ZSk7XG4gICAgICAgICAgICBpZiAoIWV4dGVudCkgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtleHRlbnQubWlufXwke2V4dGVudC5tYXh9fCR7Y2ZnLnBlcmlvZCB8fCBcIlAxRFwifWA7XG4gICAgICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IGtleTtcbiAgICAgICAgICAgICAgICB0aW1lVUkudGlja3MgPSBnZW5lcmF0ZVRpY2tzKGV4dGVudC5taW4sIGV4dGVudC5tYXgsIHBlcmlvZCk7XG4gICAgICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5taW4odGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFRoZSBzaGFyZWQgd2luZG93IG92ZXJyaWRlLCBjb25maWctZHJpdmVuOyBhIGJhZCBzdHJpbmcgY2xlYXJzIHJhdGhlciB0aGFuXG4gICAgICAgICAgICAvLyBndWVzc2luZy4gVGhlIGRyYWcgZ3JpZCBpcyB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWRcbiAgICAgICAgICAgIC8vIGR1cmF0aW9uIC0tIHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBhbGwgb2YgdGhlbSAtLSBzbyBhIDIuNWggdHJhaWxcbiAgICAgICAgICAgIC8vIGlzIGRyYWdnYWJsZSBvbiBhIDFoIGJhci4gQ2FsZW5kYXIgcGVyaW9kcyBoYXZlIG5vIGZpeGVkIHdpZHRoOyB0aGUgcnVsZXJcbiAgICAgICAgICAgIC8vIHRoZW4gc2hvd3MgaW50ZXJ2YWwgbWFya3Mgb25seSBhbmQgdGhlIHRyYWlsIGhhbmRsZSBoaWRlcy5cbiAgICAgICAgICAgIC8vIE5ldmVyIHdoaWxlIGEgZHJhZyBpcyBsaXZlOiB0aGUgZHJhZ2dlZCB3aW5kb3cgZXhpc3RzIG9ubHkgbG9jYWxseSB1bnRpbFxuICAgICAgICAgICAgLy8gcmVsZWFzZSBjb21taXRzIGl0LCBhbmQgcmVhZGluZyBjb25maWcgaGVyZSBtaWQtZHJhZyByZXNldCB0aGUgaGFuZGxlIHRvXG4gICAgICAgICAgICAvLyBcIm5vIHdpbmRvd1wiIG9uIGV2ZXJ5IGRlYm91bmNlZCBzeW5jIC0tIHRoZSBoYW5kbGUgZm9sbG93ZWQgdGhlIG1vdXNlLCB0aGVuXG4gICAgICAgICAgICAvLyBzbmFwcGVkIGhvbWUsIHRoZW4gZm9sbG93ZWQgYWdhaW4sIG9uY2UgcGVyIHN5bmMuXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5kcmFnQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGNmZy53aW5kb3cgJiYgcGFyc2VQZXJpb2QoY2ZnLndpbmRvdykgPyBjZmcud2luZG93IDogbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRpbWVVSS5wZXJpb2RNcyA9IHBlcmlvZFRvTXMocGVyaW9kKTtcbiAgICAgICAgICAgIHRpbWVVSS5ncmlkTXMgPSB0aW1lVUkucGVyaW9kTXNcbiAgICAgICAgICAgICAgICA/IGdjZEdyaWRNcyh0aW1lVUkucGVyaW9kTXMsIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllclN0YXRlLCB0aW1lVUkud2luZG93KSlcbiAgICAgICAgICAgICAgICA6IG51bGw7XG5cbiAgICAgICAgICAgIHRpbWVTdGF0ZSA9IHsgdGljazogdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0sIHBlcmlvZCwgd2luZG93OiB0aW1lVUkud2luZG93IH07XG4gICAgICAgICAgICB0aW1lVUkucG9zaXRpb24gPSBjZmcucG9zaXRpb24gfHwgXCJ0b3AtY2VudGVyXCI7XG5cbiAgICAgICAgICAgIGlmICghdGltZVVJLnN0YXJ0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gY2ZnLnNwZWVkIHx8IDE7XG4gICAgICAgICAgICAgICAgdGltZVVJLmxvb3AgPSBCb29sZWFuKGNmZy5sb29wKTtcbiAgICAgICAgICAgICAgICAvLyBPbmx5IHRoZSBmaXJzdCBjb25maWd1cmF0aW9uIG1heSBhdXRvLXN0YXJ0LiBFdmVyeSBjb25maWcgY2hhbmdlIHJlc2V0c1xuICAgICAgICAgICAgICAgIC8vIGBzdGFydGVkYCB0byByZS1yZWFkIHNwZWVkIGFuZCBsb29wIC0tIGluY2x1ZGluZyB0aGUgY2hhbmdlIGEgd2luZG93XG4gICAgICAgICAgICAgICAgLy8gZHJhZyBjb21taXRzIC0tIGFuZCByZS1ydW5uaW5nIGF1dG9fcGxheSB0aGVyZSB3b3VsZCBzdGFydCBwbGF5YmFjayBhc1xuICAgICAgICAgICAgICAgIC8vIGEgc2lkZSBlZmZlY3Qgb2YgcmVsZWFzaW5nIHRoZSBoYW5kbGUuXG4gICAgICAgICAgICAgICAgaWYgKGNmZy5hdXRvX3BsYXkgJiYgIXRpbWVVSS5ldmVyU3RhcnRlZCkgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5ldmVyU3RhcnRlZCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2lkZWJhciBMYXllcnMgQ29udHJvbCBVSVxuICAgICAgICBjb25zdCBzaWRlYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgc2lkZWJhci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXNpZGViYXJcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS50b3AgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUubWF4SGVpZ2h0ID0gXCI4MCVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250RmFtaWx5ID0gXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTZWdvZSBVSScsIFJvYm90bywgc2Fucy1zZXJpZlwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHNpZGViYXIpO1xuXG4gICAgICAgIC8vIExvZ29cbiAgICAgICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm90dG9tID0gXCIxMHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBsb2dvRGl2LmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyO1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZS5wbmdcIiBhbHQ9XCJDb21wYW55XCIgc3R5bGU9XCJoZWlnaHQ6IDM1cHg7IG1hcmdpbi1yaWdodDogNXB4O1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZTIucG5nXCIgYWx0PVwiUGFyZW50IENvbXBhbnlcIiBzdHlsZT1cImhlaWdodDogMzVweDtcIj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICBgO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobG9nb0Rpdik7XG5cblxuXG4gICAgICAgIGZ1bmN0aW9uIGdldFRpbGVMYXllcihsYXllcikge1xuICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyKGxheWVyLnVybCwge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0aW9uOiBsYXllci5hdHRyaWJ1dGlvbiB8fCAnJyxcbiAgICAgICAgICAgICAgICBtYXhab29tOiBsYXllci5tYXhfem9vbSB8fCAyMixcbiAgICAgICAgICAgICAgICBtYXhOYXRpdmVab29tOiBsYXllci5tYXhfbmF0aXZlX3pvb20gfHwgMTlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY01hcFN0YXRlKCkge1xuICAgICAgICAgICAgY29uc29sZS50aW1lKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XG4gICAgICAgICAgICB1cGRhdGVUaW1lRGltZW5zaW9uKCk7XG4gICAgICAgICAgICBjb25zdCBsYXllcnMgPSBsYXllclN0YXRlO1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBDb25maWdzID0gbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gYnVmZmVyU3RhdGU7XG5cbiAgICAgICAgICAgIC8vIEVuZm9yY2UgbXV0dWFsbHkgZXhjbHVzaXZlIHJhZGlvIGdyb3VwIHZpc2liaWxpdHkgYmVmb3JlIGNvbGxlY3Rpbmcgb3IgcmVuZGVyaW5nIFdlYkdMIGxheWVycy5cbiAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFjayBhcyB0YXJnZXRlZCBmbGlwcywgbmV2ZXIgdGhlIGxheWVycyB0cmFpdCAtLSB0aGUgZnVsbCB3cml0ZSB3YXNcbiAgICAgICAgICAgIC8vIHRoZSBmcmFtZSB0aGF0IGtpbGxlZCBsYXJnZSBzZXNzaW9ucyAoc2VlIHRoZSBzaWRlYmFyJ3MgY2hhbmdlIGhhbmRsZXIpLlxuICAgICAgICAgICAgY29uc3QgcmFkaW8gPSBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICBpZiAoKHJhZGlvLmNoYW5nZXMubGVuZ3RoID4gMCB8fCByYWRpby5ncm91cHNDaGFuZ2VkKSAmJiBkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCByYWRpby5jaGFuZ2VzKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIHsgLi4uZ3JvdXBDb25maWdzIH0pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBtb2RlbC5nZXQoXCJzaG93X2xvZ29cIikgPyBcImJsb2NrXCIgOiBcIm5vbmVcIjtcblxuICAgICAgICAgICAgLy8gR3JvdXAgdmlzaWJsZSBsYXllcnMgKGluY2x1ZGluZyBzdWItbGF5ZXJzIGluc2lkZSBncm91cHMpIHRvIGFsd2F5cyB1c2UgV2ViR0xcbiAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgICBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWxpbmU6IHdlYmdsUG9seWxpbmVMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzLFxuICAgICAgICAgICAgfSA9IGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XG5cbiAgICAgICAgICAgIC8vIFNldCBvZiBsYXllciBJRHMgcHJvY2Vzc2VkIHZpYSBtZXJnZWQgV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBjb25zdCB3ZWJnbExheWVySWRzID0gbmV3IFNldChbXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5bGluZUxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlnb25MYXllcnMubWFwKGwgPT4gbC5pZClcbiAgICAgICAgICAgIF0pO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgcmV0aXJlZCBvdmVybGF5IGxheWVycywgaW5jbHVkaW5nIHRob3NlIHRoYXQgdHJhbnNpdGlvbmVkIHRvIFdlYkdMXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhhY3RpdmVPdmVybGF5TGF5ZXJzKS5mb3JFYWNoKGlkID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpIHx8IHdlYmdsTGF5ZXJJZHMuaGFzKGlkKSkge1xuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBQcm9jZXNzIG5vbi1XZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcImJhc2VtYXBcIikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZWZmZWN0aXZlVmlzaWJsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGlsZSA9IGdldFRpbGVMYXllcihsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGlsZS5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0gPSB0aWxlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIFNraXAgbGF5ZXJzIG1hbmFnZWQgYnkgdGhlIG1lcmdlZCBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgICAgICBpZiAod2ViZ2xMYXllcklkcy5oYXMobGF5ZXIuaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZWZmZWN0aXZlVmlzaWJsZSB8fCAhbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVyU3RhdGUsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nLmxheWVyVHlwZSAhPT0gbGF5ZXIudHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdID0gaW5zdGFuY2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBIZWxwZXIgdG8gc3luYyBXZWJHTCBsYXllciBzdGF0ZXMgYW5kIHJlYnVpbGQgb25seSBpZiBjaGFuZ2VkXG4gICAgICAgICAgICBhc3luYyBmdW5jdGlvbiBzeW5jR2xMYXllcih0eXBlLCB2aXNpYmxlTGF5ZXJzLCB2ZWN0b3JHcHUgPSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkc1N0cmluZyA9IHZpc2libGVMYXllcnMubWFwKGwgPT4gbC5pZCkuc29ydCgpLmpvaW4oXCIsXCIpO1xuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgdGhlIGJ1aWx0IGJ1ZmZlcnMgZGVwZW5kIG9uIGJlbG9uZ3MgaW4gdGhpcyBrZXk6IGEgY2hhbmdlIHRoYXRcbiAgICAgICAgICAgICAgICAvLyBpcyBub3QgaW4gaXQgcmVuZGVycyBzdGFsZS4gaGlnaGxpZ2h0X3N0eWxlIGFuZCBzdHlsZV9vdmVycmlkZXMgd2VyZVxuICAgICAgICAgICAgICAgIC8vIG1pc3NpbmcgYXQgZmlyc3QsIHNvIGEgaGlnaGxpZ2h0IGxhbmRlZCBpbiBzdGF0ZSBhbmQgbmV2ZXIgcmVwYWludGVkLlxuICAgICAgICAgICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgb24gdGhlIEdQVSBwYXRoIGV4Y2x1ZGUgdGhlIHRpY2sgYW5kIHdpbmRvdyBmcm9tIHRoZSBrZXk6XG4gICAgICAgICAgICAgICAgLy8gdGhvc2UgY2hhbmdlIHBlciB0aWNrIGFuZCBhcmUgYXBwbGllZCBhcyB1bmlmb3Jtcywgbm90IGJ5IHJlYnVpbGRpbmcuXG4gICAgICAgICAgICAgICAgLy8gVGhlIHBlcmlvZCBzdGF5cyBpbiwgc2luY2UgaXQgaXMgYmFrZWQgaW50byB0aGUgZHVyYXRpb24gYXR0cmlidXRlcy5cbiAgICAgICAgICAgICAgICAvLyBFdmVyeXRoaW5nIGVsc2UgLS0gYW5kIGV2ZXJ5IG5vbi1wb2ludCBidWNrZXQgLS0gcmVidWlsZHMgYXMgYmVmb3JlLlxuICAgICAgICAgICAgICAgIGNvbnN0IGdwdVBvaW50cyA9ICgodHlwZSA9PT0gXCJjaXJjbGVfbWFya2Vyc1wiIHx8IHR5cGUgPT09IFwibWFya2Vyc1wiKVxuICAgICAgICAgICAgICAgICAgICAmJiBncHVUaW1lQXZhaWxhYmxlKCkpIHx8IHZlY3RvckdwdTtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkodmlzaWJsZUxheWVycy5tYXAobCA9PiAoe1xuICAgICAgICAgICAgICAgICAgICBpZDogbC5pZCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IGwuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogbC5yYWRpdXMsXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogbC53ZWlnaHQsXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IGwub3BhY2l0eSxcbiAgICAgICAgICAgICAgICAgICAgZmlsbE9wYWNpdHk6IGwuZmlsbE9wYWNpdHksXG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodDogbC5oaWdobGlnaHRfc3R5bGUsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlczogbC5zdHlsZV9vdmVycmlkZXMsXG4gICAgICAgICAgICAgICAgICAgIGZlYXR1cmVTdHlsZXM6IGwuZmVhdHVyZV9zdHlsZXMsXG4gICAgICAgICAgICAgICAgICAgIHRpbWU6IGwudGltZSxcbiAgICAgICAgICAgICAgICAgICAgZ3B1OiBncHVQb2ludHMsXG4gICAgICAgICAgICAgICAgICAgIHRpY2s6IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS50aWNrIDogMCxcbiAgICAgICAgICAgICAgICAgICAgd2luOiBsLnRpbWUgJiYgdGltZVN0YXRlICYmICFncHVQb2ludHMgPyB0aW1lU3RhdGUud2luZG93IDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgcGVyOiBsLnRpbWUgJiYgZ3B1UG9pbnRzICYmIHRpbWVTdGF0ZVxuICAgICAgICAgICAgICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGJ1ZkxlbjogY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF0/LmJ5dGVMZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgbG9jTGVuOiBsLmxvY2F0aW9ucz8ubGVuZ3RoIHx8IDBcbiAgICAgICAgICAgICAgICB9KSkpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGUgPSBnbFN0YXRlc1t0eXBlXTtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZUNoYW5nZWQgPSBzdGF0ZS5pZHMgIT09IGlkc1N0cmluZyB8fCBzdGF0ZS5tZXRhICE9PSBtZXRhU3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh2aXNpYmxlTGF5ZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gYXdhaXQgcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIHZpc2libGVMYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBtb2RlbCwgdGltZVN0YXRlLCB2ZWN0b3JHcHUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIuYWRkVG8obWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5pZHMgPSBpZHNTdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLm1ldGEgPSBtZXRhU3RyaW5nO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gUG9pbnQgYnVja2V0cyBob2xkaW5nIHRpbWUgbGF5ZXJzIGtlZXAgRVZFUlkgcG9pbnQgbGF5ZXIgLS0gaGlkZGVuIG9uZXNcbiAgICAgICAgICAgIC8vIGluY2x1ZGVkIC0tIHNvIGEgc2lkZWJhciB0b2dnbGUgY2hhbmdlcyBhIHZpc2liaWxpdHkgdW5pZm9ybSBpbnN0ZWFkIG9mXG4gICAgICAgICAgICAvLyB0aGUgYnVja2V0J3MgaWRzLiBVbmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZWJ1aWxkIGFsbCA1TVxuICAgICAgICAgICAgLy8gcG9pbnRzOyBjbGlja2luZyBkb3duIHRoZSBzaWRlYmFyIHN0YWNrZWQgdGhvc2UgcmVidWlsZHMgaW50byBhIGNyYXNoLlxuICAgICAgICAgICAgY29uc3QgYWxsQnlUeXBlID0gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIGNvbnN0IGJ1Y2tldCA9IHsgY2lyY2xlX21hcmtlcnM6IHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9seWxpbmU6IHdlYmdsUG9seWxpbmVMYXllcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyB9O1xuICAgICAgICAgICAgY29uc3QgdmVjdG9yR3B1QnVja2V0ID0geyBwb2x5bGluZTogZmFsc2UsIHBvbHlnb246IGZhbHNlIH07XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2YgW1wiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCJdKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZW50cmllcyA9IGFsbEJ5VHlwZVt0eXBlXTtcbiAgICAgICAgICAgICAgICBjb25zdCBpc1BvaW50cyA9IHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIjtcbiAgICAgICAgICAgICAgICBjb25zdCBhdmFpbGFibGUgPSBpc1BvaW50cyA/IGdwdVRpbWVBdmFpbGFibGUoKSA6IHZlY3RvckdwdUF2YWlsYWJsZSgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGdwdVZpcyA9IGF2YWlsYWJsZSAmJiBlbnRyaWVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICAgICAgJiYgZW50cmllcy5sZW5ndGggPD0gTEFZRVJfU0xPVFNcbiAgICAgICAgICAgICAgICAgICAgJiYgZW50cmllcy5zb21lKGUgPT4gZS5sYXllci50aW1lKTtcbiAgICAgICAgICAgICAgICBnbFN0YXRlc1t0eXBlXS52aXNWZWN0b3IgPSBncHVWaXMgPyBlbnRyaWVzLm1hcChlID0+IChlLnZpcyA/IDEgOiAwKSkgOiBudWxsO1xuICAgICAgICAgICAgICAgIGlmIChncHVWaXMpIGJ1Y2tldFt0eXBlXSA9IGVudHJpZXMubWFwKGUgPT4gZS5sYXllcik7XG4gICAgICAgICAgICAgICAgaWYgKCFpc1BvaW50cykgdmVjdG9yR3B1QnVja2V0W3R5cGVdID0gZ3B1VmlzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcImNpcmNsZV9tYXJrZXJzXCIsIGJ1Y2tldC5jaXJjbGVfbWFya2Vycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcIm1hcmtlcnNcIiwgYnVja2V0Lm1hcmtlcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCBidWNrZXQucG9seWxpbmUsIHZlY3RvckdwdUJ1Y2tldC5wb2x5bGluZSk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlnb25cIiwgYnVja2V0LnBvbHlnb24sIHZlY3RvckdwdUJ1Y2tldC5wb2x5Z29uKTtcblxuICAgICAgICAgICAgLy8gUHVzaCB0aGUgY3VycmVudCB3aW5kb3cgaW50byB0aGUgR1BVLWZpbHRlcmVkIHBvaW50IGJ1Y2tldHM6IHR3byB1bmlmb3Jtc1xuICAgICAgICAgICAgLy8gYW5kIGEgcmVkcmF3LCB3aGljaCBpcyB0aGUgZW50aXJlIHBlci10aWNrIGNvc3Qgb2YgdGhlIHRpbWUgc2xpZGVyIHRoZXJlLlxuICAgICAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XG4gICAgICAgICAgICAgICAgY29uc3QgaGFuZGxlID0gc3RhdGUubGF5ZXIgJiYgc3RhdGUubGF5ZXIuX3N3aWZ0bWFwVGltZTtcbiAgICAgICAgICAgICAgICBpZiAoIWhhbmRsZSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgLy8gTGF5ZXIgdmlzaWJpbGl0eSBmaXJzdCwgYW5kIG9ubHkgd2hlbiBpdCBjaGFuZ2VkOiBhIHRvZ2dsZSBjb3N0cyBvbmVcbiAgICAgICAgICAgICAgICAvLyB1bmlmb3JtIGFycmF5IHdyaXRlIGFuZCBhIHJlZHJhdywgbmV2ZXIgYSByZWJ1aWxkLlxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IHN0YXRlLnZpc1ZlY3RvcjtcbiAgICAgICAgICAgICAgICBpZiAodmlzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IHZpcy5qb2luKFwiXCIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUudmlzS2V5ICE9PSBrZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLnZpc0tleSA9IGtleTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRMYXllclZpc2liaWxpdHkodmlzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG92ZXJyaWRlTXMgPSB0aW1lU3RhdGUud2luZG93XG4gICAgICAgICAgICAgICAgICAgICAgICA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2QodGltZVN0YXRlLndpbmRvdykpIDogbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyh0aW1lU3RhdGUudGljaywgb3ZlcnJpZGVNcyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyhudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsICgpID0+IHtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zb2xlLnRpbWVFbmQoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICBsZXQgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XG5cbiAgICAgICAgLy8gQmluZCB6b29tIGFuZCBjZW50ZXIgY2hhbmdlcyBiYWNrIHRvIFB5dGhvbiBzYWZlbHlcbiAgICAgICAgbWFwLm9uKFwibW92ZWVuZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50Wm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxDZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxab29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1vZGVsWm9vbSAhPT0gY3VycmVudFpvb207XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9ICFtb2RlbENlbnRlciB8fCBcbiAgICAgICAgICAgICAgICAgICAgIUFycmF5LmlzQXJyYXkobW9kZWxDZW50ZXIpIHx8XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsQ2VudGVyLmxlbmd0aCA8IDIgfHxcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMF0gLSBjZW50ZXIubGF0KSA+IDAuMDAwMSB8fCBcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMV0gLSBjZW50ZXIubG5nKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjZW50ZXJcIiwgW2NlbnRlci5sYXQsIGNlbnRlci5sbmddKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInpvb21cIiwgY3VycmVudFpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBzYWZlU2F2ZUNoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gbW92ZWVuZCBoYW5kbGVyOlwiLCBlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVNYXBWaWV3KCkge1xuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xuICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICBpZiAoY2VudGVyICYmIEFycmF5LmlzQXJyYXkoY2VudGVyKSAmJiBjZW50ZXIubGVuZ3RoID49IDIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBDZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWFwWm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9IE1hdGguYWJzKG1hcENlbnRlci5sYXQgLSBjZW50ZXJbMF0pID4gMC4wMDAxIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtYXBDZW50ZXIubG5nIC0gY2VudGVyWzFdKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1hcFpvb20gIT09IHpvb207XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFZpZXcoY2VudGVyLCB0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiA/IHpvb20gOiBtYXBab29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiAmJiBtYXAuZ2V0Wm9vbSgpICE9PSB6b29tKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKHpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdhdGNoIGZvciBtYXAgdmlldyB1cGRhdGVzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNlbnRlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ0NlbnRlckZyb21NYXApIHtcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnpvb21cIiwgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVXBkYXRpbmdab29tRnJvbU1hcCkge1xuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIEZpdHRpbmcgdGhlIHZpZXcgaXMgYSBjb21tYW5kLCBub3Qgc3RhdGU6IGFza2luZyB0byBmaXQgdGhlIHNhbWUgYm91bmRzIHR3aWNlXG4gICAgICAgIC8vIG11c3QgbW92ZSB0aGUgbWFwIGJvdGggdGltZXMsIHNpbmNlIHRoZSB1c2VyIG1heSBoYXZlIHBhbm5lZCBhd2F5IGluIGJldHdlZW4uXG4gICAgICAgIC8vIFRoZSByZXF1ZXN0IGNhcnJpZXMgYSBzZXF1ZW5jZSBudW1iZXIgc28gYW4gaWRlbnRpY2FsIGZpdCBzdGlsbCBmaXJlcyBhIGNoYW5nZS5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Zml0X2JvdW5kc19yZXF1ZXN0XCIsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJlcSA9IG1vZGVsLmdldChcImZpdF9ib3VuZHNfcmVxdWVzdFwiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IHJlcS5ib3VuZHM7XG4gICAgICAgICAgICBpZiAoIWJvdW5kcyB8fCBib3VuZHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgICAgIGlmIChyZXEucGFkZGluZyAhPSBudWxsKSBvcHRpb25zLnBhZGRpbmcgPSBbcmVxLnBhZGRpbmcsIHJlcS5wYWRkaW5nXTtcbiAgICAgICAgICAgIGlmIChyZXEubWF4X3pvb20gIT0gbnVsbCkgb3B0aW9ucy5tYXhab29tID0gcmVxLm1heF96b29tO1xuICAgICAgICAgICAgbWFwLmZpdEJvdW5kcyhib3VuZHMsIG9wdGlvbnMpO1xuXG4gICAgICAgICAgICAvLyBBcHBsaWVkIGFmdGVyIHRoZSBmaXQsIHNpbmNlIGl0IGlzIHJlbGF0aXZlIHRvIHdoYXRldmVyIHpvb20gdGhlIGZpdCBjaG9zZS5cbiAgICAgICAgICAgIGlmIChyZXEuem9vbV9vZmZzZXQpIHtcbiAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbShtYXAuZ2V0Wm9vbSgpICsgcmVxLnpvb21fb2Zmc2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGV0IHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgbGV0IGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICBsZXQgbmVlZHNTeW5jID0gZmFsc2U7XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoaXNTeW5jaW5nKSB7XG4gICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpc1N5bmNpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCBzeW5jTWFwU3RhdGUoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBzeW5jTWFwU3RhdGU6XCIsIGVycik7XG4gICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGlmIChuZWVkc1N5bmMpIHtcbiAgICAgICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gcXVldWVTeW5jKCkge1xuICAgICAgICAgICAgaWYgKCFtb2RlbC5nZXQoXCJhdXRvX3N5bmNcIikpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoc3luY1RpbWVvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICBzeW5jVGltZW91dCA9IG51bGw7XG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgIH0sIDUwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgbWFudWFsIHN5bmMgdHJpZ2dlciBjaGFuZ2VzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnN5bmNfdHJpZ2dlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJbmNyZW1lbnRhbCB1cGRhdGVzIGZyb20gUHl0aG9uLiBBcHBsaWVkIGV2ZW4gd2hlbiBhdXRvX3N5bmMgaXMgb2ZmIHNvIHRoZSBtaXJyb3JcbiAgICAgICAgLy8gc3RheXMgY3VycmVudDsgcXVldWVTeW5jIGRlY2lkZXMgd2hldGhlciB0byBhY3R1YWxseSByZS1yZW5kZXIuXG4gICAgICAgIG1vZGVsLm9uKFwibXNnOmN1c3RvbVwiLCAobXNnLCBidWZmZXJzKSA9PiB7XG4gICAgICAgICAgICBpZiAoIW1zZyB8fCBtc2cua2luZCAhPT0gXCJzd2lmdG1hcF9wYXRjaFwiKSByZXR1cm47XG4gICAgICAgICAgICBhcHBseVBhdGNoT3BzKG1zZy5vcHMgfHwgW10sIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEZ1bGwtc25hcHNob3QgcGF0aHM6IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UsIGFuZCB0aGUgc2lkZWJhciB3cml0aW5nIGBsYXllcnNgXG4gICAgICAgIC8vIGJhY2sgYWZ0ZXIgYSB0b2dnbGUuIEVpdGhlciB3YXkgdGhlIHRyYWl0IGJlY29tZXMgYXV0aG9yaXRhdGl2ZSBhZ2Fpbi5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6bGF5ZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNvb3JkaW5hdGVfYnVmZmVyc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Z3JvdXBfY29uZmlnc1wiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2NvbmZpZ1wiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlOyAgIC8vIHJlLWFwcGx5IHNwZWVkL2xvb3AgZnJvbSB0aGUgbmV3IGNvbmZpZ1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcbiAgICAgICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jdXJyZW50XCIsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdhbnRlZCA9IG1vZGVsLmdldChcInRpbWVfY3VycmVudFwiKTtcbiAgICAgICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XG4gICAgICAgICAgICBpZiAoTWF0aC5hYnMod2FudGVkIC0gdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pIDwgMSkgcmV0dXJuO1xuICAgICAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBzZWVrVG8oaWR4LCB7IHdyaXRlOiBmYWxzZSB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbG9nb1wiLCBxdWV1ZVN5bmMpO1xuXG4gICAgICAgIC8vIEFubm91bmNlIHRoaXMgdmlldyBzbyBQeXRob24gcmVwbGllcyB3aXRoIGEgZnVsbCBzbmFwc2hvdC4gTGF5ZXJzIGFkZGVkIGJlZm9yZVxuICAgICAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXG4gICAgICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBtb2RlbC5zZW5kKHsga2luZDogXCJzd2lmdG1hcF9yZWFkeVwiIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGlzIGFsbCB0aGVyZSBpcyAqLyB9XG5cbiAgICAgICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcbiAgICAgICAgaWYgKG1vZGVsLmdldChcImF1dG9fc3luY1wiKSB8fCBtb2RlbC5nZXQoXCJzeW5jX3RyaWdnZXJcIikgPiAwKSB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBTyxTQUFTLFFBQVEsSUFBSSxLQUFLO0FBQzdCLE1BQUksQ0FBQyxTQUFTLGVBQWUsRUFBRSxHQUFHO0FBQzlCLFVBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTTtBQUMxQyxTQUFLLEtBQUs7QUFDVixTQUFLLE1BQU07QUFDWCxTQUFLLE9BQU87QUFDWixhQUFTLEtBQUssWUFBWSxJQUFJO0FBQUEsRUFDbEM7QUFDSjtBQUVBLElBQU0sZ0JBQWdCLENBQUM7QUFFaEIsU0FBUyxPQUFPLElBQUksS0FBSztBQUM1QixNQUFJLGNBQWMsRUFBRSxHQUFHO0FBQ25CLFdBQU8sY0FBYyxFQUFFO0FBQUEsRUFDM0I7QUFDQSxRQUFNLFVBQVUsSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQzdDLFFBQUksU0FBUyxlQUFlLEVBQUUsR0FBRztBQUM3QixjQUFRO0FBQ1I7QUFBQSxJQUNKO0FBQ0EsVUFBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLFdBQU8sS0FBSztBQUNaLFdBQU8sTUFBTTtBQUNiLFdBQU8sU0FBUyxNQUFNLFFBQVE7QUFDOUIsV0FBTyxVQUFVLE1BQU0sT0FBTyxJQUFJLE1BQU0sMEJBQTBCLEdBQUcsRUFBRSxDQUFDO0FBQ3hFLGFBQVMsS0FBSyxZQUFZLE1BQU07QUFBQSxFQUNwQyxDQUFDO0FBQ0QsZ0JBQWMsRUFBRSxJQUFJO0FB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
