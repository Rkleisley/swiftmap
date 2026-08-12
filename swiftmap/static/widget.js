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
function formatUTC(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + "Z";
}
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
            <button class="swiftmap-time-play" title="Play/Pause"></button>
            <input class="swiftmap-time-slider" type="range" min="0" step="1">
            <span class="swiftmap-time-label"></span>
            <select class="swiftmap-time-speed" title="Ticks per second">
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
            </select>
            <button class="swiftmap-time-loop" title="Loop"></button>`;
    container.appendChild(el);
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
  el.querySelector(".swiftmap-time-play").textContent = state.playing ? "\u23F8" : "\u25B6";
  el.querySelector(".swiftmap-time-loop").textContent = "\u21BB";
  el.querySelector(".swiftmap-time-loop").classList.toggle("active", Boolean(state.loop));
  el.querySelector(".swiftmap-time-speed").value = String(state.speed || 1);
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
        if (timeUI.index >= timeUI.ticks.length - 1) {
          if (timeUI.loop) return seekTo(0);
          stopPlayback();
          renderTimeControl(el, timeUI, timeHandlers);
          writeTimeCurrent(true);
          return;
        }
        seekTo(timeUI.index + 1);
      }, 1e3 / timeUI.speed);
    }
    const timeHandlers = {
      onSeek: (index) => seekTo(index),
      onPlayToggle: () => {
        if (timeUI.playing) {
          stopPlayback();
          writeTimeCurrent(true);
        } else startPlayback();
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9tYXAuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBmdW5jdGlvbiBsb2FkQ1NTKGlkLCB1cmwpIHtcbiAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICBjb25zdCBsaW5rID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImxpbmtcIik7XG4gICAgICAgIGxpbmsuaWQgPSBpZDtcbiAgICAgICAgbGluay5yZWwgPSBcInN0eWxlc2hlZXRcIjtcbiAgICAgICAgbGluay5ocmVmID0gdXJsO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKGxpbmspO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlTG9hZGVycyA9IHt9O1xuXG5leHBvcnQgZnVuY3Rpb24gbG9hZEpTKGlkLCB1cmwpIHtcbiAgICBpZiAoYWN0aXZlTG9hZGVyc1tpZF0pIHtcbiAgICAgICAgcmV0dXJuIGFjdGl2ZUxvYWRlcnNbaWRdO1xuICAgIH1cbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNjcmlwdFwiKTtcbiAgICAgICAgc2NyaXB0LmlkID0gaWQ7XG4gICAgICAgIHNjcmlwdC5zcmMgPSB1cmw7XG4gICAgICAgIHNjcmlwdC5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgICAgIHNjcmlwdC5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgc2NyaXB0OiAke3VybH1gKSk7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc2NyaXB0KTtcbiAgICB9KTtcbiAgICBhY3RpdmVMb2FkZXJzW2lkXSA9IHByb21pc2U7XG4gICAgcmV0dXJuIHByb21pc2U7XG59XG5cbmZ1bmN0aW9uIGhleFRvUmdiKGhleCkge1xuICAgIGlmICghaGV4KSByZXR1cm4gbnVsbDtcbiAgICBoZXggPSBoZXgucmVwbGFjZSgvXiMvLCAnJyk7XG4gICAgaWYgKGhleC5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgaGV4ID0gaGV4LnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyICsgY2hhcikuam9pbignJyk7XG4gICAgfVxuICAgIGlmIChoZXgubGVuZ3RoICE9PSA2KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBudW0gPSBwYXJzZUludChoZXgsIDE2KTtcbiAgICByZXR1cm4ge1xuICAgICAgICByOiAoKG51bSA+PiAxNikgJiAyNTUpIC8gMjU1LFxuICAgICAgICBnOiAoKG51bSA+PiA4KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGI6IChudW0gJiAyNTUpIC8gMjU1XG4gICAgfTtcbn1cblxubGV0IGNvbG9yUHJvYmUgPSBudWxsO1xuXG4vLyBCcm93c2VycyBzaGlwIGEgY29tcGxldGUgQ1NTIGNvbG9yIHBhcnNlciAtLSBldmVyeSBuYW1lZCBjb2xvciwgcmdiKCksIGhzbCgpLCBod2IoKS5cbi8vIEJvcnJvdyBpdCBpbnN0ZWFkIG9mIG1haW50YWluaW5nIGEgbG9va3VwIHRhYmxlLiBSZXR1cm5zIG51bGwgb3V0c2lkZSBhIERPTSAoTm9kZSB0ZXN0cyksXG4vLyB3aGVyZSB0aGUgaGV4IGZhbGxiYWNrIGluIHBhcnNlQ29sb3Igc3RpbGwgYXBwbGllcy5cbmZ1bmN0aW9uIGNzc0NvbG9yVG9SZ2IodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIGRvY3VtZW50ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIWNvbG9yUHJvYmUpIGNvbG9yUHJvYmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpLmdldENvbnRleHQoXCIyZFwiKTtcblxuICAgIC8vIEFzc2lnbmluZyBhbiBpbnZhbGlkIGNvbG9yIGxlYXZlcyBmaWxsU3R5bGUgdW50b3VjaGVkLCBzbyBwcm9iZSBhZ2FpbnN0IHR3byBkaWZmZXJlbnRcbiAgICAvLyBzZW50aW5lbHM6IG9ubHkgYSB2YWx1ZSB0aGUgYnJvd3NlciBhY3R1YWxseSBwYXJzZWQgcHJvZHVjZXMgdGhlIHNhbWUgcmVzdWx0IHR3aWNlLlxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjMDAwMDAwXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBjb25zdCBmaXJzdCA9IGNvbG9yUHJvYmUuZmlsbFN0eWxlO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjZmZmZmZmXCI7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSB2YWx1ZTtcbiAgICBpZiAoZmlyc3QgIT09IGNvbG9yUHJvYmUuZmlsbFN0eWxlKSByZXR1cm4gbnVsbDtcblxuICAgIGlmIChmaXJzdC5zdGFydHNXaXRoKFwiI1wiKSkgcmV0dXJuIGhleFRvUmdiKGZpcnN0KTtcbiAgICBjb25zdCBtYXRjaCA9IGZpcnN0Lm1hdGNoKC9yZ2JhP1xcKChbXildKylcXCkvKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXJ0cyA9IG1hdGNoWzFdLnNwbGl0KFwiLFwiKS5tYXAocCA9PiBwYXJzZUZsb2F0KHAudHJpbSgpKSk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMgfHwgcGFydHMuc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyByOiBwYXJ0c1swXSAvIDI1NSwgZzogcGFydHNbMV0gLyAyNTUsIGI6IHBhcnRzWzJdIC8gMjU1IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbG9yKGNvbG9yU3RyLCBmYWxsYmFja0hleCA9IFwiIzMzODhmZlwiKSB7XG4gICAgaWYgKCFjb2xvclN0cikgY29sb3JTdHIgPSBmYWxsYmFja0hleDtcbiAgICByZXR1cm4gY3NzQ29sb3JUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgaGV4VG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGNzc0NvbG9yVG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IGhleFRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcbn1cblxuY29uc3QgVVJMX0FUVFJfQkVGT1JFID0gLyg/OmhyZWZ8c3JjKVxccyo9XFxzKlsnXCJdPyQvaTtcbmNvbnN0IFNBRkVfVVJMID0gL14oPzpodHRwcz86XFwvXFwvfG1haWx0bzp8dGVsOnxkYXRhOmltYWdlXFwvfFsuLyM/XXxbXFx3Li1dKyg/OlsvPyNdfCQpKS9pO1xuXG4vLyBQcm9wZXJ0eSB2YWx1ZXMgY29tZSBmcm9tIHVzZXIgZGF0YSBhbmQgZW5kIHVwIGluIGlubmVySFRNTCwgc28gdGhleSBhcmUgZXNjYXBlZC5cbi8vIE1hcmt1cCB0aGUgYXBwIGF1dGhvciB3cm90ZSAodGVtcGxhdGVzLCBzdHlsZSBzdHJpbmdzKSBpcyBsZWZ0IGludGFjdC5cbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVIdG1sKHZhbHVlKSB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSlcbiAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxuICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXG4gICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxuICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMzk7XCIpO1xufVxuXG4vLyBFc2NhcGluZyBzdG9wcyBhdHRyaWJ1dGUgYnJlYWtvdXQgYnV0IG5vdCBcImphdmFzY3JpcHQ6XCIgaW4gYW4gaHJlZiwgc28gdmFsdWVzIGxhbmRpbmdcbi8vIGluIGEgVVJMIGF0dHJpYnV0ZSBnZXQgYSBzY2hlbWUgY2hlY2suIENvbnRyb2wgY2hhcmFjdGVycyBhcmUgc3RyaXBwZWQgZmlyc3QgYmVjYXVzZVxuLy8gXCJqYXZhXFx0c2NyaXB0OlwiIHN1cnZpdmVzIGEgbmFpdmUgY29tcGFyaXNvbi5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlKSB7XG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcbiAgICByZXR1cm4gU0FGRV9VUkwudGVzdChjb2xsYXBzZWQpID8gU3RyaW5nKHZhbHVlKSA6IFwiXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIGNvbnN0IHRhcmdldEZpZWxkcyA9IChBcnJheS5pc0FycmF5KGZpZWxkcykgJiYgZmllbGRzLmxlbmd0aCkgPyBmaWVsZHMgOiBPYmplY3Qua2V5cyhwcm9wcyk7XG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcbiAgICBjb25zdCBsaW5lcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGFyZ2V0RmllbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XG4gICAgICAgIGlmIChwcm9wc1tmXSA9PT0gdW5kZWZpbmVkIHx8IHByb3BzW2ZdID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgbGluZXMucHVzaChgPGI+JHtlc2NhcGVIdG1sKGxhYmVsc1tpXSl9PC9iPjogJHtlc2NhcGVIdG1sKHByb3BzW2ZdKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oXCI8YnI+XCIpO1xufVxuXG4vLyBcIntjb2x1bW59XCIgaW5zZXJ0cyBvbmUgZXNjYXBlZCB2YWx1ZTsgXCJ7Kn1cIiBpbnNlcnRzIHRoZSBkZWZhdWx0IGZpZWxkIGxpc3QuXG5mdW5jdGlvbiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiKlwiKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BzW2tleV07XG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHJldHVybiBcIlwiO1xuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XG4gICAgICAgIHJldHVybiBlc2NhcGVIdG1sKFVSTF9BVFRSX0JFRk9SRS50ZXN0KHByZWNlZGluZykgPyBzYWZlVXJsKHZhbCkgOiB2YWwpO1xuICAgIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIGtpbmQpIHtcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGxheWVyW2tpbmQgKyBcIl90ZW1wbGF0ZVwiXTtcbiAgICBjb25zdCBmaWVsZHMgPSBsYXllcltraW5kICsgXCJfZmllbGRzXCJdO1xuICAgIGNvbnN0IG5hbWVzID0gbGF5ZXJba2luZCArIFwiX25hbWVzXCJdO1xuICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgPT09IFwic3RyaW5nXCIgJiYgdGVtcGxhdGUpIHtcbiAgICAgICAgcmV0dXJuIHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBwcm9wcywgZmllbGRzLCBuYW1lcyk7XG4gICAgfVxuICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XG59XG5cbmZ1bmN0aW9uIHdyYXBTdHlsZWQoaHRtbCwgc3R5bGUpIHtcbiAgICBpZiAoIXN0eWxlKSByZXR1cm4gaHRtbDtcbiAgICByZXR1cm4gYDxkaXYgc3R5bGU9XCIke2VzY2FwZUh0bWwoc3R5bGUpfVwiPiR7aHRtbH08L2Rpdj5gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFBvcHVwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwicG9wdXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3BvcHVwIHx8IGxheWVyLnBvcHVwX2ZpZWxkcyB8fCBsYXllci5wb3B1cF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICBpZiAobGF5ZXIucG9wdXBfbWF4X3dpZHRoKSBvcHRpb25zLm1heFdpZHRoID0gbGF5ZXIucG9wdXBfbWF4X3dpZHRoO1xuICAgICAgICBMLnBvcHVwKG9wdGlvbnMpXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIucG9wdXBfc3R5bGUpKVxuICAgICAgICAgICAgLm9wZW5PbihtYXApO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRUb29sdGlwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIsIGxheWVySW5zdGFuY2UpIHtcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwidG9vbHRpcFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfdG9vbHRpcCB8fCBsYXllci50b29sdGlwX2ZpZWxkcyB8fCBsYXllci50b29sdGlwX3RlbXBsYXRlKSkge1xuICAgICAgICBpZiAoIWxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXAgPSBMLnRvb2x0aXAoeyBkaXJlY3Rpb246ICd0b3AnLCBvZmZzZXQ6IFswLCAtNV0gfSk7XG4gICAgICAgIH1cbiAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcFxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnRvb2x0aXBfc3R5bGUpKVxuICAgICAgICAgICAgLmFkZFRvKG1hcCk7XG4gICAgfVxufVxuIiwgImNvbnN0IGNvbGxhcHNlZFBhdGhzID0ge307ICAvLyBwYXRoIC0+IGNvbGxhcHNlZD9cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllckJvdW5kcyhsLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKCFsKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAvLyBTdXBwb3J0IGZvbGRlciB0cmVlIG5vZGVzIChncm91cHMgaW4gc2lkZWJhciB0cmVlKVxyXG4gICAgaWYgKGwuaXNHcm91cCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkcmVuIGdyb3Vwc1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGwuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGwuY2hpbGRyZW5ba2V5XSwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZCBsYXllcnNcclxuICAgICAgICBsLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhseXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGwuYm91bmRzICYmIGwuYm91bmRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICByZXR1cm4gbC5ib3VuZHM7XHJcbiAgICB9XHJcbiAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgbC5sYXllcnMpIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsLmxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMoc3ViLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChsLmxvY2F0aW9ucyAmJiBsLmxvY2F0aW9ucy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgY29uc3QgY29vcmRzID0gbC5sb2NhdGlvbnMuZmxhdChJbmZpbml0eSk7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2ldO1xyXG4gICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSArIDFdO1xyXG4gICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF07XHJcbiAgICAgICAgaWYgKGJ1Zikge1xyXG4gICAgICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KGJ1Zi5idWZmZXIsIGJ1Zi5ieXRlT2Zmc2V0LCBidWYuYnl0ZUxlbmd0aCAvIDgpO1xyXG4gICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aCAvIDI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2kgKiAyXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgbW9kZWxOZWVkc1VwZGF0ZSA9IGZhbHNlO1xyXG4gICAgZnVuY3Rpb24gZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZiA9IGdyb3VwQ29uZmlnc1tub2RlLnBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNSYWRpb0dyb3VwID0gY29uZi5tdWx0aV9zZWxlY3QgPT09IGZhbHNlO1xyXG4gICAgICAgIGlmIChpc1JhZGlvR3JvdXApIHtcclxuICAgICAgICAgICAgbGV0IGZvdW5kQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkR3JvdXAgPSBub2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBseXIudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZS5jaGlsZHJlbltrZXldKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXModHJlZSk7XHJcbiAgICByZXR1cm4gbW9kZWxOZWVkc1VwZGF0ZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYWdhaW5zdCB0aGUgbGlzdCB0aGlzIHNpZGViYXIgcmVuZGVyZWQgZnJvbSwgbmV2ZXIgbW9kZWwuZ2V0KFwibGF5ZXJzXCIpLlxyXG4gICAgICAgICAgICAgICAgLy8gTGF5ZXJzIGFkZGVkIGFmdGVyIHRoZSB3aWRnZXQgaXMgZGlzcGxheWVkIGFycml2ZSBhcyBwYXRjaGVzIHRoYXQgdXBkYXRlIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gZnJvbnRlbmQncyBsb2NhbCBzdGF0ZSB3aXRob3V0IHRvdWNoaW5nIHRoZSB0cmFpdCwgc28gdGhlIG1vZGVsJ3MgY29weSBpc1xyXG4gICAgICAgICAgICAgICAgLy8gZnJvemVuIGF0IHdoYXRldmVyIHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgY2FycmllZC4gQnVpbGRpbmcgdGhlIHVwZGF0ZSBmcm9tXHJcbiAgICAgICAgICAgICAgICAvLyBpdCBkcm9wcyBldmVyeSBsYXRlciBsYXllcjogdGhlIHRvZ2dsZSBtYXRjaGVzIG5vIGlkLCB3cml0ZXMgdGhlIHN0YWxlIGxpc3RcclxuICAgICAgICAgICAgICAgIC8vIGJhY2ssIGFuZCB0aGUgY2hhbmdlIGhhbmRsZXIgdGhlbiByZXNldHMgbG9jYWwgc3RhdGUgdG8gaXQgLS0gc28gdGhlIGJveFxyXG4gICAgICAgICAgICAgICAgLy8gcmUtY2hlY2tzIGl0c2VsZiBhbmQgdGhlIGxheWVyIG5ldmVyIGhpZGVzLlxyXG4gICAgICAgICAgICAgICAgbGV0IHVwZGF0ZWRMYXllcnMgPSBbLi4ubGF5ZXJzXTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSYWRpbyBidXR0b24gbG9naWM6IHNldCBhbGwgc2libGluZ3MgdG8gdmlzaWJsZT1mYWxzZSwgYW5kIHRoaXMgdG8gdmlzaWJsZT10cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMocGFyZW50Tm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJHcm91cCA9IHBhcmVudE5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gc2liR3JvdXAucGF0aCA9PT0gcGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmUgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3NpYkdyb3VwLnBhdGhdID0gIWFjdGl2ZTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBwYXJlbnROb2RlLmxheWVycy5mb3JFYWNoKHNpYkx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkx5ci5pZCA9PT0gaWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRMYXllcnMgPSB1cGRhdGVkTGF5ZXJzLm1hcChvcmlnTGF5ZXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9yaWdMYXllci5pZCA9PT0gc2liTHlyLmlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5vcmlnTGF5ZXIsIHZpc2libGU6IGFjdGl2ZSB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9yaWdMYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0geyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1twYXRoXSwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBpc0NoZWNrZWQgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVkTGF5ZXJzID0gdXBkYXRlZExheWVycy5tYXAob3JpZ0xheWVyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcmlnTGF5ZXIuaWQgPT09IGlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4ub3JpZ0xheWVyLCB2aXNpYmxlOiBpc0NoZWNrZWQgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBvcmlnTGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJsYXllcnNcIiwgdXBkYXRlZExheWVycyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldExheWVyQm91bmRzKG5vZGUsIG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb25MYXllclRvZ2dsZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcmVudEVsLmFwcGVuZENoaWxkKG5vZGVEaXYpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbmRlciB0cmVlIGZyb20gcm9vdCBub2RlXHJcbiAgICByZW5kZXJOb2RlKHRyZWUsIHNpZGViYXIsIDAsIG51bGwsIHRydWUpO1xyXG59XHJcbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IHRoZSBmaXJzdCB0aWNrIHNpdHMgb25lIHBlcmlvZCBhZnRlciB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24sXG4vLyBzbyB0aGUgZmlyc3Qgd2luZG93ICh0aWNrIC0gcGVyaW9kLCB0aWNrXSBjb250YWlucyBpdDsgdGhlIGxhc3QgdGljayBpcyB0aGUgZmlyc3QgdG9cbi8vIHJlYWNoIHBhc3QgdGhlIGZpbmFsIG9ic2VydmF0aW9uLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIGNvbnN0IHRpY2tzID0gW107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIHdoaWxlICh0aWNrcy5sZW5ndGggPCBNQVhfVElDS1MpIHtcbiAgICAgICAgdCA9IGFkZFBlcmlvZCh0LCBwKTtcbiAgICAgICAgdGlja3MucHVzaCh0KTtcbiAgICAgICAgaWYgKHQgPj0gZW5kTXMpIHJldHVybiB0aWNrcztcbiAgICB9XG4gICAgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIHRpbWUgc2xpZGVyIGNhcHBlZCBhdCAke01BWF9USUNLU30gdGlja3M7IGAgK1xuICAgICAgICBgdGhlIHBlcmlvZCBpcyB0b28gZmluZSBmb3IgdGhlIGRhdGEncyBleHRlbnQuIFVzZSBhIGNvYXJzZXIgcGVyaW9kLmApO1xuICAgIHJldHVybiB0aWNrcztcbn1cblxuLy8gLS0tIHdpbmRvd3MgYW5kIGZpbHRlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBUaGUgaW50ZXJ2YWwgc2hvd24gYXQgb25lIHRpY2suIGR1cmF0aW9uIFwicGVyaW9kXCIgaXMgdGhlIHRpY2sncyBvd24gcGVyaW9kLCBzbyBhYnNlbmNlXG4vLyBpcyB2aXNpYmxlOyBudWxsIGFjY3VtdWxhdGVzIGV2ZXJ5dGhpbmcgc28gZmFyOyBhbiBJU08gc3RyaW5nIHRyYWlscyBhIGZpeGVkIHdpbmRvdy5cbmV4cG9ydCBmdW5jdGlvbiB3aW5kb3dGb3IodGljaywgZHVyYXRpb25TcGVjLCBwZXJpb2QpIHtcbiAgICBpZiAoZHVyYXRpb25TcGVjID09PSBudWxsIHx8IGR1cmF0aW9uU3BlYyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIH1cbiAgICBjb25zdCBwID0gZHVyYXRpb25TcGVjID09PSBcInBlcmlvZFwiID8gcGVyaW9kIDogcGFyc2VQZXJpb2QoZHVyYXRpb25TcGVjKTtcbiAgICBpZiAoIXApIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIHJldHVybiB7IHN0YXJ0OiBhZGRQZXJpb2QodGljaywgcCwgLTEpLCBlbmQ6IHRpY2sgfTtcbn1cblxuLy8gSGFsZi1vcGVuIChzdGFydCwgZW5kXTogYSBmZWF0dXJlIHN0YW1wZWQgZXhhY3RseSBvbiBhIHRpY2sgYm91bmRhcnkgYmVsb25ncyB0byB0aGVcbi8vIHBlcmlvZCB0aGF0IGVuZHMgdGhlcmUsIGFuZCBuZXZlciB0byB0d28gbmVpZ2hib3VyaW5nIHRpY2tzIGF0IG9uY2UuIE5hTiB0aW1lcyBtYXJrXG4vLyBmZWF0dXJlcyB0aGF0IGNhcnJpZWQgbm8gcmVhZGFibGUgdGltZTsgdGhleSBzdGF5IHZpc2libGUgcmF0aGVyIHRoYW4gdmFuaXNoaW5nLlxuZXhwb3J0IGZ1bmN0aW9uIGZlYXR1cmVJbldpbmRvdyhzdGFydE1zLCBlbmRNcywgd2luKSB7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydE1zKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGVuZE1zID4gd2luLnN0YXJ0ICYmIHN0YXJ0TXMgPD0gd2luLmVuZDtcbn1cblxuLy8gVGltZXMgdHJhdmVsIGFzIGEgRmxvYXQ2NEFycmF5IG9mIGludGVybGVhdmVkIFtzdGFydCwgZW5kXSBwYWlycyBpbiB0aGUgYnVmZmVyIG1hcCxcbi8vIHVuZGVyIFwiPGxheWVyIGlkPjo6dGltZXNcIiAtLSB0aGUgc2FtZSB0cmFuc3BvcnQgY29vcmRpbmF0ZXMgdXNlLlxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKSB7XG4gICAgY29uc3QgcmF3ID0gYnVmZmVycyAmJiBidWZmZXJzW2Ake2xheWVyLmlkfTo6dGltZXNgXTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xufVxuXG4vLyBXaGF0IHJlbmRlcmluZyB0aHJlYWRzIHRocm91Z2g6IHRoZSBjdXJyZW50IHRpY2sgcGx1cyB0aGUgc2hhcmVkIHBlcmlvZCwgb3IgbnVsbCB3aGVuXG4vLyBubyBzbGlkZXIgaXMgYWN0aXZlLiBFYWNoIGxheWVyIGRlcml2ZXMgaXRzIG93biB3aW5kb3cgZnJvbSB0aGVzZSwgc2luY2UgZHVyYXRpb24gaXNcbi8vIHBlciBsYXllciB3aGlsZSB0aGUgdGljayBpcyBzaGFyZWQuXG4vL1xuLy8gV2hldGhlciBhIHdob2xlIGxheWVyIHNob3dzIGF0IHRoZSBjdXJyZW50IHRpY2suIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lXG4vLyBnZW9tZXRyeSBwZXIgbGF5ZXIsIHNvIHRoZXkgYXJlIGluIG9yIG91dCBhcyBhIHVuaXQ7IGEgbGF5ZXIgd2l0aCBubyB0aW1lIG1ldGFkYXRhIGlzXG4vLyBub3QgdGhlIHNsaWRlcidzIHRvIGhpZGUuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBsYXllci50aW1lLmR1cmF0aW9uLCB0aW1lU3RhdGUucGVyaW9kKTtcbiAgICByZXR1cm4gZmVhdHVyZUluV2luZG93KHRpbWVzWzBdLCB0aW1lc1sxXSwgd2luKTtcbn1cblxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XG59XG5cbi8vIC0tLSB0aGUgY29udHJvbCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGxhaW4gRE9NIGluc2lkZSB0aGUgd2lkZ2V0IGNvbnRhaW5lciwgbGlrZSB0aGUgc2lkZWJhcjogbm8gTGVhZmxldCBjb250cm9sIG1hY2hpbmVyeSxcbi8vIHdoaWNoIGtlZXBzIGl0IHRlc3RhYmxlIGluIGpzZG9tIGFuZCBzdHlsZWFibGUgZnJvbSBtYXAuY3NzLlxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclRpbWVDb250cm9sKGNvbnRhaW5lciwgc3RhdGUsIGhhbmRsZXJzKSB7XG4gICAgbGV0IGVsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1jb250cm9sXCIpO1xuICAgIGlmICghc3RhdGUudGlja3MgfHwgc3RhdGUudGlja3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmIChlbCkgZWwucmVtb3ZlKCk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoIWVsKSB7XG4gICAgICAgIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgZWwuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLWNvbnRyb2xcIjtcbiAgICAgICAgZWwuaW5uZXJIVE1MID0gYFxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtcGxheVwiIHRpdGxlPVwiUGxheS9QYXVzZVwiPjwvYnV0dG9uPlxuICAgICAgICAgICAgPGlucHV0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zbGlkZXJcIiB0eXBlPVwicmFuZ2VcIiBtaW49XCIwXCIgc3RlcD1cIjFcIj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sYWJlbFwiPjwvc3Bhbj5cbiAgICAgICAgICAgIDxzZWxlY3QgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwZWVkXCIgdGl0bGU9XCJUaWNrcyBwZXIgc2Vjb25kXCI+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjAuNVwiPjAuNXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMVwiPjF4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjJcIj4yeDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCI0XCI+NHg8L29wdGlvbj5cbiAgICAgICAgICAgIDwvc2VsZWN0PlxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIHRpdGxlPVwiTG9vcFwiPjwvYnV0dG9uPmA7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChlbCk7XG5cbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uUGxheVRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vbkxvb3BUb2dnbGUpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLFxuICAgICAgICAgICAgZSA9PiBoYW5kbGVycy5vblNwZWVkKHBhcnNlRmxvYXQoZS50YXJnZXQudmFsdWUpKSk7XG4gICAgICAgIGNvbnN0IHNsaWRlciA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIik7XG4gICAgICAgIC8vIGBpbnB1dGAgZmlyZXMgcGVyIGRyYWcgc3RlcCBmb3IgbGl2ZSBzY3J1YmJpbmc7IHRoZSBtb2RlbCB3cml0ZWJhY2sgaXMgdGhlXG4gICAgICAgIC8vIGhhbmRsZXIncyBwcm9ibGVtLCB0aHJvdHRsZWQgdGhlcmUgc28gZHJhZ2dpbmcgZG9lcyBub3QgZmxvb2QgdGhlIGtlcm5lbC5cbiAgICAgICAgc2xpZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBlID0+IGhhbmRsZXJzLm9uU2VlayhwYXJzZUludChlLnRhcmdldC52YWx1ZSwgMTApKSk7XG4gICAgfVxuXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS5tYXggPSBTdHJpbmcoc3RhdGUudGlja3MubGVuZ3RoIC0gMSk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5pbmRleCk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxhYmVsXCIpLnRleHRDb250ZW50ID0gZm9ybWF0VVRDKHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XSk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIikudGV4dENvbnRlbnQgPSBzdGF0ZS5wbGF5aW5nID8gXCJcdTIzRjhcIiA6IFwiXHUyNUI2XCI7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIikudGV4dENvbnRlbnQgPSBcIlx1MjFCQlwiO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgQm9vbGVhbihzdGF0ZS5sb29wKSk7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLnNwZWVkIHx8IDEpO1xuICAgIHJldHVybiBlbDtcbn1cbiIsICJpbXBvcnQgeyBsb2FkSlMsIGJpbmRQb3B1cCwgYmluZFRvb2x0aXAsIHBhcnNlQ29sb3IgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xuaW1wb3J0IHsgcGluU2hhZGVyIH0gZnJvbSBcIi4vc2hhZGVycy5qc1wiO1xuaW1wb3J0IHsgd2luZG93Rm9yLCBmZWF0dXJlSW5XaW5kb3csIHRpbWVzRm9yLCBsYXllckluV2luZG93IH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcblxuZnVuY3Rpb24gc2V0dXBHbGlmeVByb2plY3Rpb24oZ2xJbnN0YW5jZSkge1xuICAgIGlmIChnbEluc3RhbmNlICYmIGdsSW5zdGFuY2UubGF5ZXIpIHtcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX21hcC5vcHRpb25zLmNycy5sYXRMbmdUb1BvaW50KGxhdGxuZywgem9vbSk7XG4gICAgICAgIH07XG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XG4gICAgaWYgKCFtYXAuX2NsaWNrTWF0Y2hlcykge1xuICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcyA9IFtdO1xuICAgIH1cbiAgICBtYXAuX2NsaWNrTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcbiAgICBpZiAoIW1hcC5fY2xpY2tUaW1lb3V0KSB7XG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgMCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xuICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xuICAgIH1cbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcbiAgICBpZiAoIW1hcC5faG92ZXJUaW1lb3V0KSB7XG4gICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XG4gICAgICAgICAgICBpZiAobWFwLl9ob3Zlck1hdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzWzBdLmFjdGlvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMgPSBbXTtcbiAgICAgICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgMCk7XG4gICAgfVxufVxuXG4vLyBTdHlsZSBmb3Igb25lIGZlYXR1cmU6IGl0cyBvd24gZW50cnkgZnJvbSBgZmVhdHVyZV9zdHlsZXNgIHdoZW4gdGhlIGxheWVyIGNhcnJpZXNcbi8vIHZhcmllZCBzdHlsaW5nLCBvdGhlcndpc2UgdGhlIGxheWVyJ3Mgc2luZ2xlIHN0eWxlLiBQeXRob24gb25seSBlbWl0cyBmZWF0dXJlX3N0eWxlc1xuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXG4vLyBGb3VyIHNvdXJjZXMsIGxlYXN0IHNwZWNpZmljIGZpcnN0LiBFYWNoIHRyYW5zaWVudCBvbmUgbGl2ZXMgaW4gaXRzIG93biBmaWVsZCByYXRoZXJcbi8vIHRoYW4gZWRpdGluZyB0aGUgbGF5ZXIncyBzdHlsZSwgc28gY2xlYXJpbmcgaXQgcmVzdG9yZXMgd2hhdCB3YXMgdW5kZXJuZWF0aCB3aXRoXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxuLy9cbi8vICAgdGhlIGxheWVyJ3Mgb3duIHN0eWxlICAgd2hhdCBpdCB3YXMgZHJhd24gd2l0aFxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxuLy8gICBoaWdobGlnaHRfc3R5bGUgICAgICAgICB0aGUgd2hvbGUgbGF5ZXIgaXMgc2VsZWN0ZWRcbi8vICAgc3R5bGVfb3ZlcnJpZGVzW2ldICAgICAgdGhpcyBmZWF0dXJlIGlzIHNlbGVjdGVkIC0tIG1vc3Qgc3BlY2lmaWMsIHNvIGl0IHdpbnNcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcbiAgICBjb25zdCBmcm9tRGF0YSA9IEFycmF5LmlzQXJyYXkobGF5ZXIuZmVhdHVyZV9zdHlsZXMpID8gbGF5ZXIuZmVhdHVyZV9zdHlsZXNbaW5kZXhdIDogbnVsbDtcbiAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGU7XG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcbiAgICBpZiAoIWZyb21EYXRhICYmICFoaWdobGlnaHQgJiYgIXNlbGVjdGVkKSByZXR1cm4gbGF5ZXI7XG4gICAgcmV0dXJuIHsgLi4ubGF5ZXIsIC4uLihmcm9tRGF0YSB8fCB7fSksIC4uLihoaWdobGlnaHQgfHwge30pLCAuLi4oc2VsZWN0ZWQgfHwge30pIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRJbmRleGVkUHJvcGVydGllcyhwcm9wZXJ0aWVzLCBpbmRleCkge1xuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xuICAgIGNvbnN0IHByb3BzID0ge307XG4gICAgT2JqZWN0LmtleXMocHJvcGVydGllcykuZm9yRWFjaChrID0+IHtcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcbiAgICAgICAgcHJvcHNba10gPSBBcnJheS5pc0FycmF5KHZhbCkgPyB2YWxbaW5kZXhdIDogdmFsO1xuICAgIH0pO1xuICAgIHJldHVybiBwcm9wcztcbn1cblxuXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlciwgbW9kZWwpIHtcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XG4gICAgICAgIGNvbnN0IGdyb3VwID0gTC5sYXllckdyb3VwKCk7XG4gICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGlmIChzdWIudHlwZSA9PT0gXCJjaXJjbGVfbWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcIm1hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5bGluZVwiIHx8IHN1Yi50eXBlID09PSBcInBvbHlnb25cIiB8fCBzdWIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnNbc3ViLmlkXSwgbW9kZWwpO1xuICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgZ3JvdXAuYWRkTGF5ZXIoaW5zdGFuY2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGdyb3VwLmFkZFRvKG1hcCk7XG4gICAgICAgIGdyb3VwLmxheWVyVHlwZSA9IGxheWVyLnR5cGU7XG4gICAgICAgIHJldHVybiBncm91cDtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgbGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsLCB0aW1lU3RhdGUgPSBudWxsKSB7XG4gICAgLy8gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmUgZ2VvbWV0cnkgcGVyIGxheWVyLCBzbyB0aGUgdGltZSBzbGlkZXIgaW5jbHVkZXNcbiAgICAvLyBvciBleGNsdWRlcyB0aGVtIHdob2xlLiBQb2ludHMgY2FycnkgcGVyLWZlYXR1cmUgdGltZXMgYW5kIGZpbHRlciBpbnNpZGUgdGhlaXIgbG9vcC5cbiAgICBpZiAodGltZVN0YXRlICYmIHR5cGUgIT09IFwiY2lyY2xlX21hcmtlcnNcIiAmJiB0eXBlICE9PSBcIm1hcmtlcnNcIikge1xuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcbiAgICAgICAgaWYgKGxheWVyc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgICAgIGNvbnN0IGdlb2pzb25Db29yZHMgPSBsYXllci5sb2NhdGlvbnMubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xuICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJMaW5lU3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvb3JkaW5hdGVzOiBnZW9qc29uQ29vcmRzXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUub3BhY2l0eSB8fCAxLjAgfSxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBzdHlsZS53ZWlnaHQgfHwgM1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgY29uc3QgZ2VvanNvbiA9IHtcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcblxuICAgICAgICAgICAgICAgIHRoaXMuZ2xMaW5lcyA9IEwuZ2xpZnkubGluZXMoe1xuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWxpbmVzUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy53ZWlnaHQ7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2RlbC5jb21tKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsTGluZXMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsTGluZXMpIHRoaXMuZ2xMaW5lcy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgICAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWdvblwiKSB7XG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICAgICAgbGV0IGdlb2pzb25Db29yZHMgPSBbXTtcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIikge1xuICAgICAgICAgICAgICAgIGdlb2pzb25Db29yZHMgPSBsYXllci5sb2NhdGlvbnMubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICAgICAgICAgICAgICBpZiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpcnN0ID0gZ2VvanNvbkNvb3Jkc1swXTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFzdCA9IGdlb2pzb25Db29yZHNbZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZpcnN0WzBdICE9PSBsYXN0WzBdIHx8IGZpcnN0WzFdICE9PSBsYXN0WzFdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBnZW9qc29uQ29vcmRzLnB1c2goW2ZpcnN0WzBdLCBmaXJzdFsxXV0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XG4gICAgICAgICAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XG4gICAgICAgICAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcbiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3TGF0ID0gbGF0ICsgKGRMYXQgKiAxODApIC8gTWF0aC5QSTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3TG9uID0gbG9uICsgKGRMb24gKiAxODApIC8gTWF0aC5QSTtcbiAgICAgICAgICAgICAgICAgICAgZ2VvanNvbkNvb3Jkcy5wdXNoKFtuZXdMb24sIG5ld0xhdF0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGdlb2pzb25Db29yZHMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblxuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XG4gICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcbiAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIlBvbHlnb25cIixcbiAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IFtnZW9qc29uQ29vcmRzXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLmZpbGxPcGFjaXR5IHx8IDAuMiB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5nbFNoYXBlcyA9IEwuZ2xpZnkuc2hhcGVzKHtcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobW9kZWwuY29tbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBsYXllci5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMywgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIGNvbnN0IHBvaW50c0xpc3QgPSBbXTtcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcblxuICAgIGNvbnN0IGZhbGxiYWNrQ29sb3IgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IFwiI2U2MWEyNlwiIDogXCIjMzM4OGZmXCI7XG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcbiAgICAvLyBjaXJjbGUgYmVjYXVzZSB0aGUgZ2x5cGggaXMgZHJhd24gaW5zaWRlIHRoZSBwb2ludCdzIG93biBxdWFkIGJ5IHRoZSBzaGFkZXIuXG4gICAgY29uc3QgZGVmYXVsdFNpemUgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDY0IDogNTtcblxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xuICAgICAgICBjb25zdCBsYXllclNpemUgPSBsYXllci5yYWRpdXMgIT0gbnVsbCA/IE51bWJlcihsYXllci5yYWRpdXMpIDogZGVmYXVsdFNpemU7XG5cbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XG4gICAgICAgIGlmICghY29vcmRCdWZmZXIpIHtcbiAgICAgICAgICAgIGlmIChsYXllci5sb2NhdGlvbiAmJiBsYXllckluV2luZG93KGxheWVyLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSkge1xuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XG4gICAgICAgICAgICAgICAgaW5kZXhNYXBwaW5nLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiBjb2xvclJHQixcbiAgICAgICAgICAgICAgICAgICAgc2l6ZTogbGF5ZXJTaXplXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5ieXRlT2Zmc2V0LFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZUxlbmd0aCAvIDhcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgY291bnQgPSBjb29yZHMubGVuZ3RoIC8gMjtcblxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XG4gICAgICAgIC8vIFNlbGVjdGlvbiBzdHlsaW5nLCBhcHBsaWVkIG92ZXIgdGhlIGxheWVyJ3Mgb3duIGFuZCBpdHMgZGF0YS1kcml2ZW4gc3R5bGVzLlxuICAgICAgICAvLyBTYW1lIHByZWNlZGVuY2UgYXMgc3R5bGVGb3I6IGRhdGEsIHRoZW4gd2hvbGUtbGF5ZXIgaGlnaGxpZ2h0LCB0aGVuIHBlci1mZWF0dXJlLlxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGVzID0gbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzIHx8IG51bGw7XG4gICAgICAgIC8vIFRoZSBjdXJyZW50IHRpbWUgd2luZG93LCB3aGVuIHRoaXMgbGF5ZXIgaXMgYW5pbWF0ZWQuIEZlYXR1cmVzIG91dHNpZGUgaXQgYXJlXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcbiAgICAgICAgLy8gb24gdGhlIHN1cnZpdm9ycyBrZWVwIHBvaW50aW5nIGF0IHRoZSByaWdodCByb3dzLlxuICAgICAgICBjb25zdCB3aW4gPSB0aW1lU3RhdGUgJiYgbGF5ZXIudGltZVxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGxheWVyLnRpbWUuZHVyYXRpb24sIHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbDtcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBmcm9tRGF0YSA9IHBlckZlYXR1cmUgPyBwZXJGZWF0dXJlW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gb3ZlcnJpZGVzID8gb3ZlcnJpZGVzW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChmcm9tRGF0YSAmJiBmcm9tRGF0YS5jb2xvcik7XG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xuICAgICAgICAgICAgICAgIDogaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5yYWRpdXMgIT0gbnVsbCA/IGhpZ2hsaWdodC5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IGZyb21EYXRhICYmIGZyb21EYXRhLnJhZGl1cyAhPSBudWxsID8gZnJvbURhdGEucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2Nvb3Jkc1tpICogMl0sIGNvb3Jkc1tpICogMiArIDFdXSk7XG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XG4gICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IGksXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcikgOiBjb2xvclJHQixcbiAgICAgICAgICAgICAgICBzaXplOiByYWRpdXMgIT0gbnVsbCA/IE51bWJlcihyYWRpdXMpIDogbGF5ZXJTaXplXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb2ludHNMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3QgZ2V0SW50ZXJhY3RpdmVFbCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICBjb25zdCBnbGlmeU9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXG4gICAgICAgICAgICAgICAgcGFuZTogXCJwb2ludHNQYW5lXCIsXG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZWQgcGVyIHBvaW50LCBsaWtlIGNvbG91cjogc2V2ZXJhbCBsYXllcnMgc2hhcmUgb25lIGdsaWZ5IGluc3RhbmNlLFxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cbiAgICAgICAgICAgICAgICBzaXplOiAoaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gPyBpbmZvLmNvbG9yUkdCIDogeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlbnNpdGl2aXR5OiB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDIwIDogOCxcbiAgICAgICAgICAgICAgICBjbGljazogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHBvcHVwcyBvbiBmYXIgYXdheSBjbGlja3NcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gY2xpY2tQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2RlbC5jb21tKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgcG9pbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwb2ludCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCB0b29sdGlwcyBvbiBmYXIgYXdheSBob3ZlcnNcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGhvdmVyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChlLmxhdGxuZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gaG92ZXJQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1heERpc3QgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDI1IDogMTI7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5mbykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb3BzID0gZ2V0SW5kZXhlZFByb3BlcnRpZXMobGF5ZXIucHJvcGVydGllcywgb3JpZ2luYWxJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAodHlwZSA9PT0gXCJtYXJrZXJzXCIpIHtcbiAgICAgICAgICAgICAgICBnbGlmeU9wdGlvbnMuZnJhZ21lbnRTaGFkZXJTb3VyY2UgPSAoKSA9PiBwaW5TaGFkZXI7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuZ2xQb2ludHMgPSBMLmdsaWZ5LnBvaW50cyhnbGlmeU9wdGlvbnMpO1xuICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFBvaW50cyk7XG4gICAgICAgIH0sXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XG4gICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcbiAgICAgICAgICAgIGlmIChjYW52YXMpIGNhbnZhcy5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICByZXR1cm4gaW5zdGFuY2U7XG59XG4iLCAiaW1wb3J0IHsgbG9hZENTUywgbG9hZEpTIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHJlbmRlclNpZGViYXJDb250cm9scywgbm9ybWFsaXplUmFkaW9MYXllcnMgfSBmcm9tIFwiLi9zaWRlYmFyLmpzXCI7XG5pbXBvcnQgeyByZW5kZXJMYXllciwgcmVuZGVyTWVyZ2VkR2xMYXllciB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIGdlbmVyYXRlVGlja3MsIGNvbGxlY3RUaW1lRXh0ZW50LCBoYXNUaW1lTGF5ZXJzLFxuICAgICAgICAgbGF5ZXJJbldpbmRvdywgcmVuZGVyVGltZUNvbnRyb2wgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xuXG4vLyBUcnVlIGlmIGEgbGF5ZXIgaXMgdmlzaWJsZSBhbmQgbm8gZm9sZGVyIGFib3ZlIGl0IGlzIHN3aXRjaGVkIG9mZi5cbi8vXG4vLyBWaXNpYmlsaXR5IGlzIGluaGVyaXRlZCBkb3duIHRoZSBmb2xkZXIgcGF0aDogYSBsYXllciBpbnNpZGUgXCJGZWVkcy9BY3RpdmVcIiBpcyBoaWRkZW5cbi8vIHdoZW4gZWl0aGVyIFwiRmVlZHNcIiBvciBcIkZlZWRzL0FjdGl2ZVwiIGlzIG9mZiwgcmVnYXJkbGVzcyBvZiBpdHMgb3duIGZsYWcuIEdldHRpbmcgdGhpc1xuLy8gd3Jvbmcgc2hvd3MgdXAgYXMgXCJ0aGF0IGxheWVyIGp1c3Qgd2lsbCBub3QgYXBwZWFyXCIsIHdpdGggbm90aGluZyBsb2dnZWQuXG5leHBvcnQgZnVuY3Rpb24gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncykge1xuICAgIGlmIChsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XG4gICAgZm9yIChjb25zdCBwYXJ0IG9mIChsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5zcGxpdChcIi9cIikpIHtcbiAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGdyb3VwQ29uZmlnc1tydW5uaW5nUGF0aF07XG4gICAgICAgIGlmIChjb25maWcgJiYgY29uZmlnLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufVxuXG4vLyBTb3J0cyB0aGUgdmlzaWJsZSBsYXllcnMgaW50byBvbmUgYnVja2V0IHBlciBXZWJHTCBkcmF3IHBhc3MuXG4vL1xuLy8gU3ViLWxheWVycyBvZiBhIG1lcmdlZCBncm91cCBpbmhlcml0IHRoZWlyIHBhcmVudCdzIHZpc2liaWxpdHkgcmF0aGVyIHRoYW4gY2Fycnlpbmdcbi8vIHRoZWlyIG93biwgc28gYSBncm91cCB0b2dnbGVkIG9mZiBjb250cmlidXRlcyBub3RoaW5nIGV2ZW4gd2hlbiBpdHMgY2hpbGRyZW4gc2F5XG4vLyB2aXNpYmxlLiBDaXJjbGVzIGpvaW4gdGhlIHBvbHlnb24gYnVja2V0OiB0aGV5IGFyZSBkcmF3biBhcyBnZW5lcmF0ZWQgcmluZ3MuXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3QgYnVja2V0cyA9IHsgY2lyY2xlX21hcmtlcnM6IFtdLCBtYXJrZXJzOiBbXSwgcG9seWxpbmU6IFtdLCBwb2x5Z29uOiBbXSB9O1xuXG4gICAgZnVuY3Rpb24gY29sbGVjdChsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWJMYXllcikge1xuICAgICAgICBpZiAoIXBhcmVudFZpc2libGUpIHJldHVybjtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGxheWVyLmxheWVycy5mb3JFYWNoKHN1YiA9PiBjb2xsZWN0KHN1YiwgcGFyZW50VmlzaWJsZSwgdHJ1ZSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghaXNTdWJMYXllciAmJiBsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGJ1Y2tldCA9IGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIgPyBcInBvbHlnb25cIiA6IGxheWVyLnR5cGU7XG4gICAgICAgIGlmIChidWNrZXRzW2J1Y2tldF0pIGJ1Y2tldHNbYnVja2V0XS5wdXNoKGxheWVyKTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xuICAgICAgICBjb2xsZWN0KGxheWVyLCBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSwgZmFsc2UpO1xuICAgIH1cbiAgICByZXR1cm4gYnVja2V0cztcbn1cblxuLy8gQXBwbGllcyBpbmNyZW1lbnRhbCBwYXRjaCBvcHMgdG8ge2xheWVycywgYnVmZmVyc30sIHJldHVybmluZyB0aGUgbmV3IHN0YXRlLlxuLy9cbi8vIE9wcyBhcmUgYWRkcmVzc2VkIGJ5IGxheWVyIGlkIGFuZCBhcHBsaWVkIGlkZW1wb3RlbnRseTogXCJhZGRcIiB1cHNlcnRzIHJhdGhlciB0aGFuXG4vLyBhcHBlbmRpbmcgYmxpbmRseSwgc28gYSBwYXRjaCB0aGF0IHJhY2VzIHRoZSBpbml0aWFsIHRyYWl0IHNuYXBzaG90IGNhbm5vdCBkdXBsaWNhdGVcbi8vIGEgbGF5ZXIsIGFuZCBhIFwicmVtb3ZlXCIgZm9yIHNvbWV0aGluZyBhbHJlYWR5IGdvbmUgaXMgYSBuby1vcC5cbi8vIEFwcGxpZXMgYHVwZGF0ZWAgdG8gb25lIGxheWVyIHdoZXJldmVyIGl0IHNpdHMsIGRlc2NlbmRpbmcgaW50byBncm91cHMuIGFkZF9jb2xsZWN0aW9uXG4vLyBuZXN0cyBpdHMgcG9pbnQsIGxpbmUgYW5kIHBvbHlnb24gbGF5ZXJzIGluc2lkZSBhIGdyb3VwIGxheWVyLCBzbyBhbiBvcCBhZGRyZXNzZWQgYXQgYVxuLy8gbmVzdGVkIGlkIHdvdWxkIG90aGVyd2lzZSBtYXRjaCBub3RoaW5nIGFuZCBzaWxlbnRseSBkbyBub3RoaW5nLiBSZXR1cm5zIHRoZSBvcmlnaW5hbFxuLy8gYXJyYXkgdW50b3VjaGVkIHdoZW4gdGhlIGlkIGlzIG5vdCBmb3VuZCwgc28gYW4gdW5tYXRjaGVkIG9wIGNvc3RzIG5vIHJlLXJlbmRlci5cbmZ1bmN0aW9uIHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIGlkLCB1cGRhdGUpIHtcbiAgICBsZXQgaGl0ID0gZmFsc2U7XG4gICAgY29uc3QgbmV4dCA9IGxheWVycy5tYXAobCA9PiB7XG4gICAgICAgIGlmIChsLmlkID09PSBpZCkge1xuICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgIHJldHVybiB1cGRhdGUobCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIEFycmF5LmlzQXJyYXkobC5sYXllcnMpKSB7XG4gICAgICAgICAgICBjb25zdCBzdWJzID0gdXBkYXRlTGF5ZXJCeUlkKGwubGF5ZXJzLCBpZCwgdXBkYXRlKTtcbiAgICAgICAgICAgIGlmIChzdWJzICE9PSBsLmxheWVycykge1xuICAgICAgICAgICAgICAgIGhpdCA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4ubCwgbGF5ZXJzOiBzdWJzIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGw7XG4gICAgfSk7XG4gICAgcmV0dXJuIGhpdCA/IG5leHQgOiBsYXllcnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVN3aWZ0bWFwUGF0Y2goc3RhdGUsIG9wcywgYnVmZmVycykge1xuICAgIGxldCBsYXllcnMgPSBzdGF0ZS5sYXllcnMgfHwgW107XG4gICAgbGV0IGJ1ZmZlck1hcCA9IHN0YXRlLmJ1ZmZlcnMgfHwge307XG5cbiAgICBmb3IgKGNvbnN0IG9wIG9mIG9wcykge1xuICAgICAgICBpZiAob3Aub3AgPT09IFwic25hcHNob3RcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gb3AubGF5ZXJzIHx8IFtdO1xuICAgICAgICAgICAgYnVmZmVyTWFwID0ge307XG4gICAgICAgICAgICAob3AuYnVmZmVyX2lkcyB8fCBbXSkuZm9yRWFjaCgoaWQsIGkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoYnVmZmVycyAmJiBidWZmZXJzW2ldKSBidWZmZXJNYXBbaWRdID0gYnVmZmVyc1tpXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImFkZFwiIHx8IG9wLm9wID09PSBcInJlcGxhY2VcIikge1xuICAgICAgICAgICAgY29uc3QgaW5jb21pbmcgPSBvcC5sYXllcjtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gaW5jb21pbmcgPyBpbmNvbWluZy5pZCA6IG9wLmlkO1xuICAgICAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJzLmZpbmRJbmRleChsID0+IGwuaWQgPT09IGlkKTtcbiAgICAgICAgICAgIGlmIChpZHggPT09IC0xKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gWy4uLmxheWVycywgaW5jb21pbmddO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBsYXllcnMubWFwKChsLCBpKSA9PiAoaSA9PT0gaWR4ID8gaW5jb21pbmcgOiBsKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic2V0XCIpIHtcbiAgICAgICAgICAgIC8vIEZpZWxkLWxldmVsIHVwZGF0ZS4gXCJyZXBsYWNlXCIgY2FycmllcyB0aGUgd2hvbGUgbGF5ZXIsIHNvIGZsaXBwaW5nIGB2aXNpYmxlYFxuICAgICAgICAgICAgLy8gb24gYSA1MGstcG9pbnQgbGF5ZXIgcmVzZW50IGV2ZXJ5IHByb3BlcnR5IGl0IGhvbGRzIC0tIGhhbGYgYSBtZWdhYnl0ZSB0b1xuICAgICAgICAgICAgLy8gY2hhbmdlIG9uZSBib29sZWFuLCBvbiBldmVyeSBjbGljayBvZiBhIGNoZWNrYm94LlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHsgLi4ubCwgLi4uKG9wLmZpZWxkcyB8fCB7fSkgfSkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInN0eWxlXCIpIHtcbiAgICAgICAgICAgIC8vIFBlci1mZWF0dXJlIHN0eWxlIG92ZXJyaWRlcywgcmVwbGFjZWQgd2hvbGVzYWxlIHJhdGhlciB0aGFuIG1lcmdlZDogYVxuICAgICAgICAgICAgLy8gc2VsZWN0aW9uIGRlc2NyaWJlcyBpdHMgY29tcGxldGUgc3RhdGUsIHNvIHNlbmRpbmcge30gY2xlYXJzIGl0IGFuZCBub1xuICAgICAgICAgICAgLy8gY2FsbGVyIGhhcyB0byB0cmFjayB3aGF0IHRoZSBwcmV2aW91cyBoaWdobGlnaHQgdG91Y2hlZC5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7XG4gICAgICAgICAgICAgICAgLi4ubCwgc3R5bGVfb3ZlcnJpZGVzOiBvcC5vdmVycmlkZXMgfHwge30sXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwicmVtb3ZlXCIpIHtcbiAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5maWx0ZXIobCA9PiBsLmlkICE9PSBvcC5pZCk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGJ1ZiA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tvcC5idWZmZXJfaW5kZXhdO1xuICAgICAgICAgICAgaWYgKGJ1ZikgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAsIFtvcC5pZF06IGJ1ZiB9O1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlcl9yZW1vdmVcIikge1xuICAgICAgICAgICAgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAgfTtcbiAgICAgICAgICAgIGRlbGV0ZSBidWZmZXJNYXBbb3AuaWRdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgbGF5ZXJzLCBidWZmZXJzOiBidWZmZXJNYXAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQge1xuICAgIGFzeW5jIHJlbmRlcih7IG1vZGVsLCBlbCB9KSB7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsRXJyb3IgPSBjb25zb2xlLmVycm9yO1xuICAgICAgICBjb25zdCBvcmlnaW5hbFdhcm4gPSBjb25zb2xlLndhcm47XG5cbiAgICAgICAgLy8ganNfY29uc29sZV9sb2dzIGlzIGEgc3luY2VkIGxpc3QsIHNvIGVhY2ggYXBwZW5kIHJlc2VuZHMgdGhlIHdob2xlIGFycmF5LiBLZWVwaW5nXG4gICAgICAgIC8vIG9ubHkgdGhlIG1vc3QgcmVjZW50IGVudHJpZXMgYm91bmRzIGJvdGggdGhlIHBheWxvYWQgYW5kIHRoZSBtZW1vcnkgYSBsb25nLWxpdmVkXG4gICAgICAgIC8vIHNlc3Npb24gYWNjdW11bGF0ZXM7IHRoZSBuZXdlc3QgYXJlIHRoZSBvbmVzIHdvcnRoIGhhdmluZyBhbnl3YXkuXG4gICAgICAgIGNvbnN0IE1BWF9DT05TT0xFX0xPR1MgPSAyMDA7XG4gICAgICAgIGNvbnN0IGFwcGVuZExvZyA9IGVudHJ5ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxvZ3MgPSBtb2RlbC5nZXQoXCJqc19jb25zb2xlX2xvZ3NcIikgfHwgW107XG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gWy4uLmxvZ3MsIGVudHJ5XTtcbiAgICAgICAgICAgIHJldHVybiBuZXh0Lmxlbmd0aCA+IE1BWF9DT05TT0xFX0xPR1MgPyBuZXh0LnNsaWNlKC1NQVhfQ09OU09MRV9MT0dTKSA6IG5leHQ7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gSGVscGVyIHRvIHNhZmVseSB3cml0ZSBiYWNrIHRvIFB5dGhvbiBvbmx5IGlmIHRoZSB3aWRnZXQgdmlldyBpcyBhY3RpdmUgYW5kIGF0dGFjaGVkXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTZXRBbmRTYXZlKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChtb2RlbC5jb21tICYmIGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcbiAgICAgICAgICAgIGlmIChtb2RlbC5jb21tICYmIGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHNhdmUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IgPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBvcmlnaW5hbEVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIixcbiAgICAgICAgICAgICAgICBhcHBlbmRMb2coXCJDT05TT0xFLkVSUk9SOiBcIiArIGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKSkpO1xuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgbGV0IGxvZ2dlZFJlcHJvamVjdGVkID0gZmFsc2U7XG4gICAgICAgIGNvbnNvbGUud2FybiA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKTtcbiAgICAgICAgICAgIGlmIChtc2cuaW5jbHVkZXMoXCJsYXllciBkZXNpZ25lZCBmb3IgU3BoZXJpY2FsTWVyY2F0b3JcIikgfHwgbXNnLmluY2x1ZGVzKFwiYWx0ZXJuYXRlIGRldGVjdGVkXCIpKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFsb2dnZWRSZXByb2plY3RlZCkge1xuICAgICAgICAgICAgICAgICAgICBsb2dnZWRSZXByb2plY3RlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNycyA9IG1vZGVsLmdldChcImNyc1wiKSB8fCBcIkVQU0c6Mzg1N1wiO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGVhbk1zZyA9IGBbU3dpZnRNYXBdIExheWVyIHdhcyByZXByb2plY3RlZCB0byBcIiR7Y3JzfVwiYDtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgY2xlYW5Nc2cpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIiwgYXBwZW5kTG9nKGNsZWFuTXNnKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gc3VwcHJlc3MgZHVwbGljYXRlIGNvbnNvbGUgd2FybmluZ3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgfTtcblxuICAgICAgICB3aW5kb3cub25lcnJvciA9IGZ1bmN0aW9uKG1lc3NhZ2UsIHNvdXJjZSwgbGluZW5vLCBjb2xubywgZXJyb3IpIHtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKGBXSU5ET1cuT05FUlJPUjogJHttZXNzYWdlfSBhdCAke3NvdXJjZX06JHtsaW5lbm99OiR7Y29sbm99YCkpO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIExvYWQgQ1NTIGFuZCBMZWFmbGV0IGxpYnJhcmllcyAoaW5jbHVkaW5nIFdlYkdMIGdsaWZ5KVxuICAgICAgICBsb2FkQ1NTKFwibGVhZmxldC1jc3NcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5jc3NcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtanNcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5qc1wiKTtcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1nbGlmeVwiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXQuZ2xpZnlAMy4zLjAvZGlzdC9nbGlmeS1icm93c2VyLmpzXCIpO1xuXG4gICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGNvbnRhaW5lci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWNvbnRhaW5lclwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLmhlaWdodCA9IFwiMTAwJVwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUucG9zaXRpb24gPSBcInJlbGF0aXZlXCI7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKGNvbnRhaW5lcik7XG5cbiAgICAgICAgY29uc3QgY3JzTmFtZSA9IG1vZGVsLmdldChcImNyc1wiKTtcbiAgICAgICAgbGV0IG1hcENycyA9IEwuQ1JTLkVQU0czODU3O1xuICAgICAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xuICAgICAgICAgICAgbWFwQ3JzID0gTC5DUlMuRVBTRzQzMjY7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYXAgPSBMLm1hcChjb250YWluZXIsIHtcbiAgICAgICAgICAgIGNyczogbWFwQ3JzLFxuICAgICAgICAgICAgY2VudGVyOiBtb2RlbC5nZXQoXCJjZW50ZXJcIiksXG4gICAgICAgICAgICB6b29tOiBtb2RlbC5nZXQoXCJ6b29tXCIpLFxuICAgICAgICAgICAgc2Nyb2xsV2hlZWxab29tOiB0cnVlLFxuICAgICAgICAgICAgcHJlZmVyQ2FudmFzOiB0cnVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWdvbnNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlnb25zUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQxMFwiO1xuICAgICAgICBcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5bGluZXNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlsaW5lc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MjBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9pbnRzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDMwXCI7XG5cbiAgICAgICAgLy8gTG9jYWwgbWlycm9ycyBvZiB0aGUgbGF5ZXIgbGlzdCBhbmQgY29vcmRpbmF0ZSBidWZmZXJzLlxuICAgICAgICAvL1xuICAgICAgICAvLyBQeXRob24gdXBkYXRlcyB0aGVzZSBpbmNyZW1lbnRhbGx5IHZpYSBcInN3aWZ0bWFwX3BhdGNoXCIgbWVzc2FnZXMgaW5zdGVhZCBvZlxuICAgICAgICAvLyByZWFzc2lnbmluZyB0aGUgdHJhaXRzLCBiZWNhdXNlIGEgdHJhaXQgcmVhc3NpZ25tZW50IHJlLXNlcmlhbGl6ZXMgYW5kIHJlLXNlbmRzXG4gICAgICAgIC8vIHRoZSBlbnRpcmUgbWFwIG9uIGV2ZXJ5IG11dGF0aW9uLiBUaGUgdHJhaXRzIHN0aWxsIGNhcnJ5IHRoZSBpbml0aWFsIHNuYXBzaG90XG4gICAgICAgIC8vIHdoZW4gYSB2aWV3IGF0dGFjaGVzLCBhbmQgdGhlIHNpZGViYXIgc3RpbGwgd3JpdGVzIGBsYXllcnNgIGJhY2sgb24gdG9nZ2xlLCBzb1xuICAgICAgICAvLyBib3RoIGFyZSBzZWVkZWQgaGVyZSBhbmQga2VwdCBpbiBzdGVwIGJ5IHRoZSBjaGFuZ2UgaGFuZGxlcnMgZnVydGhlciBkb3duLlxuICAgICAgICBsZXQgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcbiAgICAgICAgbGV0IGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xuXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5UGF0Y2hPcHMob3BzLCBidWZmZXJzKSB7XG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gYXBwbHlTd2lmdG1hcFBhdGNoKHsgbGF5ZXJzOiBsYXllclN0YXRlLCBidWZmZXJzOiBidWZmZXJTdGF0ZSB9LCBvcHMsIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG5leHQubGF5ZXJzO1xuICAgICAgICAgICAgYnVmZmVyU3RhdGUgPSBuZXh0LmJ1ZmZlcnM7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY3RpdmVUaWxlTGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcbiAgICAgICAgY29uc3QgZ2xTdGF0ZXMgPSB7XG4gICAgICAgICAgICBjaXJjbGVfbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlsaW5lOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlnb246IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xuICAgICAgICAvLyBhbmQgdGhlIHBlcmlvZCwgb3IgbnVsbCB3aGVuIG5vdGhpbmcgaXMgYW5pbWF0ZWQgLS0gYW5kIGB0aW1lVUlgIGlzIHRoZSBzbGlkZXInc1xuICAgICAgICAvLyBvd24gYm9va2tlZXBpbmcuIFBsYXliYWNrIG5ldmVyIHJvdW5kLXRyaXBzIHRocm91Z2ggUHl0aG9uOiB0aWNrcyByZS1yZW5kZXJcbiAgICAgICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXG4gICAgICAgIGxldCB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICBjb25zdCB0aW1lVUkgPSB7IHRpY2tzOiBbXSwga2V5OiBcIlwiLCBpbmRleDogMCwgcGxheWluZzogZmFsc2UsIGxvb3A6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSB9O1xuXG4gICAgICAgIGZ1bmN0aW9uIHN0b3BQbGF5YmFjaygpIHtcbiAgICAgICAgICAgIGlmICh0aW1lVUkudGltZXIpIGNsZWFySW50ZXJ2YWwodGltZVVJLnRpbWVyKTtcbiAgICAgICAgICAgIHRpbWVVSS50aW1lciA9IG51bGw7XG4gICAgICAgICAgICB0aW1lVUkucGxheWluZyA9IGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gd3JpdGVUaW1lQ3VycmVudChmb3JjZSkge1xuICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICAgIGlmICghZm9yY2UgJiYgbm93IC0gdGltZVVJLmxhc3RXcml0ZSA8IDEwMDApIHJldHVybjtcbiAgICAgICAgICAgIHRpbWVVSS5sYXN0V3JpdGUgPSBub3c7XG4gICAgICAgICAgICBpZiAobW9kZWwuY29tbSkge1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInRpbWVfY3VycmVudFwiLCB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzZWVrVG8oaW5kZXgsIHsgd3JpdGUgPSB0cnVlIH0gPSB7fSkge1xuICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSk7XG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2Q6IHRpbWVTdGF0ZS5wZXJpb2QgfTtcbiAgICAgICAgICAgIGlmICh3cml0ZSkgd3JpdGVUaW1lQ3VycmVudCghdGltZVVJLnBsYXlpbmcpO1xuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc3RhcnRQbGF5YmFjaygpIHtcbiAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkuaW5kZXggPj0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5sb29wKSByZXR1cm4gc2Vla1RvKDApO1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzZWVrVG8odGltZVVJLmluZGV4ICsgMSk7XG4gICAgICAgICAgICB9LCAxMDAwIC8gdGltZVVJLnNwZWVkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRpbWVIYW5kbGVycyA9IHtcbiAgICAgICAgICAgIG9uU2VlazogKGluZGV4KSA9PiBzZWVrVG8oaW5kZXgpLFxuICAgICAgICAgICAgb25QbGF5VG9nZ2xlOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5wbGF5aW5nKSB7IHN0b3BQbGF5YmFjaygpOyB3cml0ZVRpbWVDdXJyZW50KHRydWUpOyB9XG4gICAgICAgICAgICAgICAgZWxzZSBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9ICF0aW1lVUkubG9vcDtcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uU3BlZWQ6IChzcGVlZCkgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IHNwZWVkO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDcmVhdGVzLCByZXR1bmVzIG9yIHJlbW92ZXMgdGhlIHNsaWRlciB0byBtYXRjaCB0aGUgbGF5ZXJzIHByZXNlbnQuIFRpY2tzIGFyZVxuICAgICAgICAvLyByZWdlbmVyYXRlZCBvbmx5IHdoZW4gdGhlIGRhdGEncyB0aW1lIGV4dGVudCBvciB0aGUgcGVyaW9kIGNoYW5nZXMsIHNvIGFcbiAgICAgICAgLy8gcGxheWJhY2sgdGljayAtLSB3aGljaCByZS1lbnRlcnMgaGVyZSB2aWEgcXVldWVTeW5jIC0tIGRvZXMgbm90IHJlYnVpbGQgdGhlbS5cbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlVGltZURpbWVuc2lvbigpIHtcbiAgICAgICAgICAgIGlmICghaGFzVGltZUxheWVycyhsYXllclN0YXRlKSkge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB7IHRpY2tzOiBbXSB9LCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0gXCJcIjtcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBwZXJpb2QgPSBwYXJzZVBlcmlvZChjZmcucGVyaW9kIHx8IFwiUDFEXCIpIHx8IHBhcnNlUGVyaW9kKFwiUDFEXCIpO1xuICAgICAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xuICAgICAgICAgICAgaWYgKCFleHRlbnQpIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7ZXh0ZW50Lm1pbn18JHtleHRlbnQubWF4fXwke2NmZy5wZXJpb2QgfHwgXCJQMURcIn1gO1xuICAgICAgICAgICAgaWYgKGtleSAhPT0gdGltZVVJLmtleSkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBrZXk7XG4gICAgICAgICAgICAgICAgdGltZVVJLnRpY2tzID0gZ2VuZXJhdGVUaWNrcyhleHRlbnQubWluLCBleHRlbnQubWF4LCBwZXJpb2QpO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWluKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kIH07XG5cbiAgICAgICAgICAgIGlmICghdGltZVVJLnN0YXJ0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gY2ZnLnNwZWVkIHx8IDE7XG4gICAgICAgICAgICAgICAgdGltZVVJLmxvb3AgPSBCb29sZWFuKGNmZy5sb29wKTtcbiAgICAgICAgICAgICAgICBpZiAoY2ZnLmF1dG9fcGxheSkgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNpZGViYXIgTGF5ZXJzIENvbnRyb2wgVUlcbiAgICAgICAgY29uc3Qgc2lkZWJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUudG9wID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjVweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUub3ZlcmZsb3dZID0gXCJhdXRvXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuZm9udEZhbWlseSA9IFwiLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU2Vnb2UgVUknLCBSb2JvdG8sIHNhbnMtc2VyaWZcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmNvbG9yID0gXCIjMzMzXCI7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChzaWRlYmFyKTtcblxuICAgICAgICAvLyBMb2dvXG4gICAgICAgIGNvbnN0IGxvZ29EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJvdHRvbSA9IFwiMTBweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnJpZ2h0ID0gXCIxMHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5wYWRkaW5nID0gXCI1cHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjRweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgbG9nb0Rpdi5pbm5lckhUTUwgPSBgXG4gICAgICAgICAgICA8ZGl2IHN0eWxlPVwiZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjtcIj5cbiAgICAgICAgICAgICAgICA8aW1nIHNyYz1cImh0dHBzOi8vcmVwby9hc3NldHMvaW1hZ2UucG5nXCIgYWx0PVwiQ29tcGFueVwiIHN0eWxlPVwiaGVpZ2h0OiAzNXB4OyBtYXJnaW4tcmlnaHQ6IDVweDtcIj5cbiAgICAgICAgICAgICAgICA8aW1nIHNyYz1cImh0dHBzOi8vcmVwby9hc3NldHMvaW1hZ2UyLnBuZ1wiIGFsdD1cIlBhcmVudCBDb21wYW55XCIgc3R5bGU9XCJoZWlnaHQ6IDM1cHg7XCI+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgYDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxvZ29EaXYpO1xuXG5cblxuICAgICAgICBmdW5jdGlvbiBnZXRUaWxlTGF5ZXIobGF5ZXIpIHtcbiAgICAgICAgICAgIHJldHVybiBMLnRpbGVMYXllcihsYXllci51cmwsIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGlvbjogbGF5ZXIuYXR0cmlidXRpb24gfHwgJycsXG4gICAgICAgICAgICAgICAgbWF4Wm9vbTogbGF5ZXIubWF4X3pvb20gfHwgMjIsXG4gICAgICAgICAgICAgICAgbWF4TmF0aXZlWm9vbTogbGF5ZXIubWF4X25hdGl2ZV96b29tIHx8IDE5XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNNYXBTdGF0ZSgpIHtcbiAgICAgICAgICAgIGNvbnNvbGUudGltZShcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xuICAgICAgICAgICAgdXBkYXRlVGltZURpbWVuc2lvbigpO1xuICAgICAgICAgICAgY29uc3QgbGF5ZXJzID0gbGF5ZXJTdGF0ZTtcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IG1vZGVsLmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IGJ1ZmZlclN0YXRlO1xuXG4gICAgICAgICAgICAvLyBFbmZvcmNlIG11dHVhbGx5IGV4Y2x1c2l2ZSByYWRpbyBncm91cCB2aXNpYmlsaXR5IGJlZm9yZSBjb2xsZWN0aW5nIG9yIHJlbmRlcmluZyBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGNvbnN0IHJhZGlvQ2hhbmdlZCA9IG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIGlmIChyYWRpb0NoYW5nZWQgJiYgbW9kZWwuY29tbSAmJiBkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImxheWVyc1wiLCBbLi4ubGF5ZXJzXSk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBtb2RlbC5nZXQoXCJzaG93X2xvZ29cIikgPyBcImJsb2NrXCIgOiBcIm5vbmVcIjtcblxuICAgICAgICAgICAgLy8gR3JvdXAgdmlzaWJsZSBsYXllcnMgKGluY2x1ZGluZyBzdWItbGF5ZXJzIGluc2lkZSBncm91cHMpIHRvIGFsd2F5cyB1c2UgV2ViR0xcbiAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgICBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWxpbmU6IHdlYmdsUG9seWxpbmVMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzLFxuICAgICAgICAgICAgfSA9IGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XG5cbiAgICAgICAgICAgIC8vIFNldCBvZiBsYXllciBJRHMgcHJvY2Vzc2VkIHZpYSBtZXJnZWQgV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBjb25zdCB3ZWJnbExheWVySWRzID0gbmV3IFNldChbXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5bGluZUxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlnb25MYXllcnMubWFwKGwgPT4gbC5pZClcbiAgICAgICAgICAgIF0pO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgcmV0aXJlZCBvdmVybGF5IGxheWVycywgaW5jbHVkaW5nIHRob3NlIHRoYXQgdHJhbnNpdGlvbmVkIHRvIFdlYkdMXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhhY3RpdmVPdmVybGF5TGF5ZXJzKS5mb3JFYWNoKGlkID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpIHx8IHdlYmdsTGF5ZXJJZHMuaGFzKGlkKSkge1xuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBQcm9jZXNzIG5vbi1XZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcImJhc2VtYXBcIikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZWZmZWN0aXZlVmlzaWJsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGlsZSA9IGdldFRpbGVMYXllcihsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGlsZS5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0gPSB0aWxlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIFNraXAgbGF5ZXJzIG1hbmFnZWQgYnkgdGhlIG1lcmdlZCBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgICAgICBpZiAod2ViZ2xMYXllcklkcy5oYXMobGF5ZXIuaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZWZmZWN0aXZlVmlzaWJsZSB8fCAhbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVyU3RhdGUsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nLmxheWVyVHlwZSAhPT0gbGF5ZXIudHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdID0gaW5zdGFuY2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBIZWxwZXIgdG8gc3luYyBXZWJHTCBsYXllciBzdGF0ZXMgYW5kIHJlYnVpbGQgb25seSBpZiBjaGFuZ2VkXG4gICAgICAgICAgICBhc3luYyBmdW5jdGlvbiBzeW5jR2xMYXllcih0eXBlLCB2aXNpYmxlTGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRzU3RyaW5nID0gdmlzaWJsZUxheWVycy5tYXAobCA9PiBsLmlkKS5zb3J0KCkuam9pbihcIixcIik7XG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyB0aGUgYnVpbHQgYnVmZmVycyBkZXBlbmQgb24gYmVsb25ncyBpbiB0aGlzIGtleTogYSBjaGFuZ2UgdGhhdFxuICAgICAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXG4gICAgICAgICAgICAgICAgLy8gbWlzc2luZyBhdCBmaXJzdCwgc28gYSBoaWdobGlnaHQgbGFuZGVkIGluIHN0YXRlIGFuZCBuZXZlciByZXBhaW50ZWQuXG4gICAgICAgICAgICAgICAgY29uc3QgbWV0YVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHZpc2libGVMYXllcnMubWFwKGwgPT4gKHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGwuaWQsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBsLmNvbG9yLFxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IGwucmFkaXVzLFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IGwud2VpZ2h0LFxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiBsLm9wYWNpdHksXG4gICAgICAgICAgICAgICAgICAgIGZpbGxPcGFjaXR5OiBsLmZpbGxPcGFjaXR5LFxuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHQ6IGwuaGlnaGxpZ2h0X3N0eWxlLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZXM6IGwuc3R5bGVfb3ZlcnJpZGVzLFxuICAgICAgICAgICAgICAgICAgICBmZWF0dXJlU3R5bGVzOiBsLmZlYXR1cmVfc3R5bGVzLFxuICAgICAgICAgICAgICAgICAgICB0aW1lOiBsLnRpbWUsXG4gICAgICAgICAgICAgICAgICAgIHRpY2s6IGwudGltZSAmJiB0aW1lU3RhdGUgPyB0aW1lU3RhdGUudGljayA6IDAsXG4gICAgICAgICAgICAgICAgICAgIGJ1ZkxlbjogY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF0/LmJ5dGVMZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgbG9jTGVuOiBsLmxvY2F0aW9ucz8ubGVuZ3RoIHx8IDBcbiAgICAgICAgICAgICAgICB9KSkpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGUgPSBnbFN0YXRlc1t0eXBlXTtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZUNoYW5nZWQgPSBzdGF0ZS5pZHMgIT09IGlkc1N0cmluZyB8fCBzdGF0ZS5tZXRhICE9PSBtZXRhU3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh2aXNpYmxlTGF5ZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gYXdhaXQgcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIHZpc2libGVMYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBtb2RlbCwgdGltZVN0YXRlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc3RhdGUuaWRzID0gaWRzU3RyaW5nO1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5tZXRhID0gbWV0YVN0cmluZztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwiY2lyY2xlX21hcmtlcnNcIiwgd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJtYXJrZXJzXCIsIHdlYmdsTWFya2VyTGF5ZXJzKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWxpbmVcIiwgd2ViZ2xQb2x5bGluZUxheWVycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlnb25cIiwgd2ViZ2xQb2x5Z29uTGF5ZXJzKTtcblxuICAgICAgICAgICAgcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgbW9kZWwsIG1hcCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnNvbGUudGltZUVuZChcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XG4gICAgICAgIGxldCBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcblxuICAgICAgICAvLyBCaW5kIHpvb20gYW5kIGNlbnRlciBjaGFuZ2VzIGJhY2sgdG8gUHl0aG9uIHNhZmVseVxuICAgICAgICBtYXAub24oXCJtb3ZlZW5kXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbWFwLmdldENlbnRlcigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRab29tID0gbWFwLmdldFpvb20oKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCBtb2RlbENlbnRlciA9IG1vZGVsLmdldChcImNlbnRlclwiKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2RlbFpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbW9kZWxab29tICE9PSBjdXJyZW50Wm9vbTtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gIW1vZGVsQ2VudGVyIHx8IFxuICAgICAgICAgICAgICAgICAgICAhQXJyYXkuaXNBcnJheShtb2RlbENlbnRlcikgfHxcbiAgICAgICAgICAgICAgICAgICAgbW9kZWxDZW50ZXIubGVuZ3RoIDwgMiB8fFxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclswXSAtIGNlbnRlci5sYXQpID4gMC4wMDAxIHx8IFxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclsxXSAtIGNlbnRlci5sbmcpID4gMC4wMDAxO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNlbnRlclwiLCBbY2VudGVyLmxhdCwgY2VudGVyLmxuZ10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiem9vbVwiLCBjdXJyZW50Wm9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkIHx8IHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIHNhZmVTYXZlQ2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBtb3ZlZW5kIGhhbmRsZXI6XCIsIGVycik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZ1bmN0aW9uIHVwZGF0ZU1hcFZpZXcoKSB7XG4gICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XG4gICAgICAgICAgICBjb25zdCB6b29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgIGlmIChjZW50ZXIgJiYgQXJyYXkuaXNBcnJheShjZW50ZXIpICYmIGNlbnRlci5sZW5ndGggPj0gMikge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hcENlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBab29tID0gbWFwLmdldFpvb20oKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gTWF0aC5hYnMobWFwQ2VudGVyLmxhdCAtIGNlbnRlclswXSkgPiAwLjAwMDEgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1hcENlbnRlci5sbmcgLSBjZW50ZXJbMV0pID4gMC4wMDAxO1xuICAgICAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbWFwWm9vbSAhPT0gem9vbTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0VmlldyhjZW50ZXIsIHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiID8gem9vbSA6IG1hcFpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiICYmIG1hcC5nZXRab29tKCkgIT09IHpvb20pIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFpvb20oem9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gV2F0Y2ggZm9yIG1hcCB2aWV3IHVwZGF0ZXMgZnJvbSBQeXRob25cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Y2VudGVyXCIsICgpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCkge1xuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXBkYXRlTWFwVmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6em9vbVwiLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ1pvb21Gcm9tTWFwKSB7XG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXBkYXRlTWFwVmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gRml0dGluZyB0aGUgdmlldyBpcyBhIGNvbW1hbmQsIG5vdCBzdGF0ZTogYXNraW5nIHRvIGZpdCB0aGUgc2FtZSBib3VuZHMgdHdpY2VcbiAgICAgICAgLy8gbXVzdCBtb3ZlIHRoZSBtYXAgYm90aCB0aW1lcywgc2luY2UgdGhlIHVzZXIgbWF5IGhhdmUgcGFubmVkIGF3YXkgaW4gYmV0d2Vlbi5cbiAgICAgICAgLy8gVGhlIHJlcXVlc3QgY2FycmllcyBhIHNlcXVlbmNlIG51bWJlciBzbyBhbiBpZGVudGljYWwgZml0IHN0aWxsIGZpcmVzIGEgY2hhbmdlLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpmaXRfYm91bmRzX3JlcXVlc3RcIiwgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcmVxID0gbW9kZWwuZ2V0KFwiZml0X2JvdW5kc19yZXF1ZXN0XCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgYm91bmRzID0gcmVxLmJvdW5kcztcbiAgICAgICAgICAgIGlmICghYm91bmRzIHx8IGJvdW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICAgICAgaWYgKHJlcS5wYWRkaW5nICE9IG51bGwpIG9wdGlvbnMucGFkZGluZyA9IFtyZXEucGFkZGluZywgcmVxLnBhZGRpbmddO1xuICAgICAgICAgICAgaWYgKHJlcS5tYXhfem9vbSAhPSBudWxsKSBvcHRpb25zLm1heFpvb20gPSByZXEubWF4X3pvb207XG4gICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcywgb3B0aW9ucyk7XG5cbiAgICAgICAgICAgIC8vIEFwcGxpZWQgYWZ0ZXIgdGhlIGZpdCwgc2luY2UgaXQgaXMgcmVsYXRpdmUgdG8gd2hhdGV2ZXIgem9vbSB0aGUgZml0IGNob3NlLlxuICAgICAgICAgICAgaWYgKHJlcS56b29tX29mZnNldCkge1xuICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKG1hcC5nZXRab29tKCkgKyByZXEuem9vbV9vZmZzZXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgc3luY1RpbWVvdXQgPSBudWxsO1xuICAgICAgICBsZXQgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgIGxldCBuZWVkc1N5bmMgPSBmYWxzZTtcblxuICAgICAgICBhc3luYyBmdW5jdGlvbiBwZXJmb3JtU3luYygpIHtcbiAgICAgICAgICAgIGlmIChpc1N5bmNpbmcpIHtcbiAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlzU3luY2luZyA9IHRydWU7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHN5bmNNYXBTdGF0ZSgpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIHN5bmNNYXBTdGF0ZTpcIiwgZXJyKTtcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYgKG5lZWRzU3luYykge1xuICAgICAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBxdWV1ZVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoIW1vZGVsLmdldChcImF1dG9fc3luY1wiKSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzeW5jVGltZW91dCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzeW5jVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSwgNTApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTGlzdGVuIGZvciBtYW51YWwgc3luYyB0cmlnZ2VyIGNoYW5nZXMgZnJvbSBQeXRob25cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c3luY190cmlnZ2VyXCIsICgpID0+IHtcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEluY3JlbWVudGFsIHVwZGF0ZXMgZnJvbSBQeXRob24uIEFwcGxpZWQgZXZlbiB3aGVuIGF1dG9fc3luYyBpcyBvZmYgc28gdGhlIG1pcnJvclxuICAgICAgICAvLyBzdGF5cyBjdXJyZW50OyBxdWV1ZVN5bmMgZGVjaWRlcyB3aGV0aGVyIHRvIGFjdHVhbGx5IHJlLXJlbmRlci5cbiAgICAgICAgbW9kZWwub24oXCJtc2c6Y3VzdG9tXCIsIChtc2csIGJ1ZmZlcnMpID0+IHtcbiAgICAgICAgICAgIGlmICghbXNnIHx8IG1zZy5raW5kICE9PSBcInN3aWZ0bWFwX3BhdGNoXCIpIHJldHVybjtcbiAgICAgICAgICAgIGFwcGx5UGF0Y2hPcHMobXNnLm9wcyB8fCBbXSwgYnVmZmVycyk7XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRnVsbC1zbmFwc2hvdCBwYXRoczogdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSwgYW5kIHRoZSBzaWRlYmFyIHdyaXRpbmcgYGxheWVyc2BcbiAgICAgICAgLy8gYmFjayBhZnRlciBhIHRvZ2dsZS4gRWl0aGVyIHdheSB0aGUgdHJhaXQgYmVjb21lcyBhdXRob3JpdGF0aXZlIGFnYWluLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsYXllcnNcIiwgKCkgPT4ge1xuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Y29vcmRpbmF0ZV9idWZmZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpncm91cF9jb25maWdzXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnRpbWVfY29uZmlnXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7ICAgLy8gcmUtYXBwbHkgc3BlZWQvbG9vcC9hdXRvX3BsYXkgZnJvbSB0aGUgbmV3IGNvbmZpZ1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcbiAgICAgICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jdXJyZW50XCIsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdhbnRlZCA9IG1vZGVsLmdldChcInRpbWVfY3VycmVudFwiKTtcbiAgICAgICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XG4gICAgICAgICAgICBpZiAoTWF0aC5hYnMod2FudGVkIC0gdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pIDwgMSkgcmV0dXJuO1xuICAgICAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBzZWVrVG8oaWR4LCB7IHdyaXRlOiBmYWxzZSB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbG9nb1wiLCBxdWV1ZVN5bmMpO1xuXG4gICAgICAgIC8vIEFubm91bmNlIHRoaXMgdmlldyBzbyBQeXRob24gcmVwbGllcyB3aXRoIGEgZnVsbCBzbmFwc2hvdC4gTGF5ZXJzIGFkZGVkIGJlZm9yZVxuICAgICAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXG4gICAgICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXG4gICAgICAgIGlmIChtb2RlbC5jb21tKSB7XG4gICAgICAgICAgICBtb2RlbC5zZW5kKHsga2luZDogXCJzd2lmdG1hcF9yZWFkeVwiIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcbiAgICAgICAgaWYgKG1vZGVsLmdldChcImF1dG9fc3luY1wiKSB8fCBtb2RlbC5nZXQoXCJzeW5jX3RyaWdnZXJcIikgPiAwKSB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBTyxTQUFT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
