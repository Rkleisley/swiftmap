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
var collapsedByContainer = /* @__PURE__ */ new WeakMap();
function sidebarCollapseState(container) {
  let state = collapsedByContainer.get(container);
  if (!state) {
    state = {};
    collapsedByContainer.set(container, state);
  }
  return state;
}
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
function normalizeRadioLayers(layers, groupConfigs, collapsedPaths = {}) {
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
function renderSidebarControls(sidebar, layers, ctx, map, onLayerToggle) {
  sidebar.innerHTML = "<b style='font-size: 13px; border-bottom: 2px solid #eee; padding-bottom: 4px; display: block; margin-bottom: 8px;'>Layers Control</b>";
  const collapsedPaths = sidebarCollapseState(sidebar);
  const groupConfigs = ctx && ctx.groupConfigs || {};
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
        if (ctx && ctx.onLayerWrite) ctx.onLayerWrite(changes);
        if (ctx && ctx.onGroupConfigsChange) ctx.onGroupConfigsChange(groupConfigs);
        if (isChecked && map) {
          const bounds = getLayerBounds(node, ctx && ctx.coordinateBuffers || {});
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

// src/patch.js
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
var bufferSerials = /* @__PURE__ */ new WeakMap();
var nextBufferSerial = 1;
function bufferSerial(buf) {
  if (!buf || typeof buf !== "object") return 0;
  let serial = bufferSerials.get(buf);
  if (!serial) {
    serial = nextBufferSerial++;
    bufferSerials.set(buf, serial);
  }
  return serial;
}
function concatViews(head, tail) {
  const out = new Uint8Array(head.byteLength + tail.byteLength);
  out.set(new Uint8Array(head.buffer, head.byteOffset, head.byteLength), 0);
  out.set(new Uint8Array(tail.buffer, tail.byteOffset, tail.byteLength), head.byteLength);
  return new DataView(out.buffer);
}
function appendRows(layer, op) {
  const base = op.base || 0;
  const count = op.count || 0;
  const incoming = op.properties || {};
  const props = { ...layer.properties || {} };
  for (const key of /* @__PURE__ */ new Set([...Object.keys(props), ...Object.keys(incoming)])) {
    const head = Array.isArray(props[key]) ? props[key] : new Array(base).fill(props[key] === void 0 ? null : props[key]);
    const tail = Array.isArray(incoming[key]) ? incoming[key] : new Array(count).fill(null);
    props[key] = head.concat(tail);
  }
  const next = { ...layer, properties: props };
  for (const [field, tail] of Object.entries(op.lists || {})) {
    next[field] = (Array.isArray(layer[field]) ? layer[field] : []).concat(tail);
  }
  return next;
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
    } else if (op.op === "buffer_append") {
      const tail = buffers && buffers[op.buffer_index];
      if (tail) {
        const head = bufferMap[op.id];
        bufferMap = { ...bufferMap, [op.id]: head ? concatViews(head, tail) : tail };
      }
    } else if (op.op === "append") {
      layers = updateLayerById(layers, op.id, (l) => appendRows(l, op));
    } else if (op.op === "buffer_remove") {
      bufferMap = { ...bufferMap };
      delete bufferMap[op.id];
    }
  }
  return { layers, buffers: bufferMap };
}

// src/legend.js
var GLYPHS = {
  circle_markers: "circle",
  markers: "pin",
  polyline: "line",
  polygon: "polygon",
  circle: "circle"
};
function swatchEntry(layer, hidden) {
  return {
    kind: "swatch",
    label: layer.name || "Layer",
    shape: GLYPHS[layer.type] || "square",
    color: layer.color || "#3388ff",
    fillColor: layer.fillColor || layer.fill_color || layer.color || "#3388ff",
    hidden
  };
}
function blockEntry(layer, hidden) {
  return { ...layer.legend, label: layer.name || "Layer", hidden };
}
function entriesForLayer(layer, groupConfigs) {
  if (layer.type === "basemap") return [];
  const hidden = !isLayerEffectiveVisible(layer, groupConfigs);
  if (layer.type === "group") {
    return (layer.layers || []).filter((sub) => GLYPHS[sub.type]).map((sub) => sub.legend ? blockEntry({ ...sub, name: layer.name }, hidden) : swatchEntry({ ...sub, name: layer.name }, hidden));
  }
  if (!GLYPHS[layer.type]) return [];
  const entries = [layer.legend ? blockEntry(layer, hidden) : swatchEntry(layer, hidden)];
  if (layer.legend_size) {
    entries.push({
      ...layer.legend_size,
      label: layer.legend_size.field || layer.name || "Size",
      hidden
    });
  }
  return entries;
}
function payloadKey(entry) {
  const { label, hidden, layerId, layer, group, ...payload } = entry;
  return JSON.stringify(payload);
}
function dedupeDataEntries(groups) {
  const seen = /* @__PURE__ */ new Map();
  for (const group of groups) {
    group.entries = group.entries.filter((entry) => {
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
function deriveLegendSpec(layers, groupConfigs, config) {
  const cfg = config || {};
  const groups = [];
  const byName = /* @__PURE__ */ new Map();
  const groupFor = (name) => {
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
  const removes = cfg.remove || [];
  if (removes.length > 0) {
    for (const group of groups) {
      group.entries = group.entries.filter(
        (entry) => !removes.some((m) => matcherHits(m, entry, group.name))
      );
    }
  }
  for (const added of cfg.add || []) {
    const entry = { hidden: false, ...added };
    if (entry.layer != null) {
      const bound = (layers || []).find(
        (l) => l.id === entry.layer || l.name === entry.layer
      );
      entry.hidden = !bound || !isLayerEffectiveVisible(bound, groupConfigs || {});
      if (cfg.scope === "visible" && entry.hidden) continue;
    }
    if (removes.some((m) => matcherHits(m, entry, entry.group || ""))) continue;
    groupFor(entry.group || "").entries.push(entry);
  }
  const populated = groups.filter((g) => g.entries.length > 0);
  return { title: cfg.title || "Legend", groups: populated };
}
function div(styles, text) {
  const el = document.createElement("div");
  Object.assign(el.style, styles);
  if (text != null) el.textContent = text;
  return el;
}
function glyph(entry) {
  if (entry.shape === "line") {
    return div({
      width: "20px",
      height: "4px",
      background: entry.color,
      marginRight: "6px",
      flex: "none"
    });
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
    path.setAttribute(
      "d",
      "M12 0C5.4 0 0 5.4 0 12c0 9 12 16 12 16s12-7 12-16C24 5.4 18.6 0 12 0z"
    );
    path.setAttribute("fill", entry.color);
    svg.appendChild(path);
    el.appendChild(svg);
    return el;
  }
  const radius = entry.shape === "circle" ? "50%" : entry.shape === "polygon" ? "2px" : "0";
  return div({
    width: "12px",
    height: "12px",
    background: entry.fillColor,
    border: `2px solid ${entry.color}`,
    borderRadius: radius,
    marginRight: "6px",
    flex: "none",
    boxSizing: "border-box"
  });
}
function rampRow(entry) {
  const row = div({ marginTop: "5px" });
  row.appendChild(div({}, entry.label));
  const stops = (entry.anchors || []).map((color, i, all) => `${color} ${all.length > 1 ? i / (all.length - 1) * 100 : 0}%`);
  row.appendChild(div({
    width: "120px",
    height: "12px",
    borderRadius: "2px",
    backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`
  }));
  const ends = div({
    display: "flex",
    justifyContent: "space-between",
    width: "120px",
    fontSize: "11px",
    color: "#555"
  });
  ends.appendChild(div({}, String(entry.vmin)));
  ends.appendChild(div({}, String(entry.vmax)));
  row.appendChild(ends);
  return row;
}
var MAX_CATEGORY_ROWS = 12;
function categoriesRow(entry) {
  const row = div({ marginTop: "5px" });
  row.appendChild(div({}, entry.label));
  const items = entry.items || [];
  for (const item of items.slice(0, MAX_CATEGORY_ROWS)) {
    const line = div({
      display: "flex",
      alignItems: "center",
      marginTop: "3px",
      marginLeft: "8px"
    });
    line.appendChild(glyph({ shape: "square", color: item.color, fillColor: item.color }));
    line.appendChild(div({}, String(item.value)));
    row.appendChild(line);
  }
  if (items.length > MAX_CATEGORY_ROWS) {
    row.appendChild(div(
      { marginLeft: "8px", marginTop: "3px", color: "#555" },
      `+ ${items.length - MAX_CATEGORY_ROWS} more`
    ));
  }
  return row;
}
function binsRow(entry) {
  const row = div({ marginTop: "5px" });
  row.appendChild(div({}, entry.label));
  const edges = entry.edges || [];
  const colors = entry.colors || [];
  const labelFor = (i) => i === 0 ? `< ${edges[0]}` : i === edges.length ? `\u2265 ${edges[edges.length - 1]}` : `${edges[i - 1]} \u2013 ${edges[i]}`;
  colors.forEach((color, i) => {
    const line = div({
      display: "flex",
      alignItems: "center",
      marginTop: "3px",
      marginLeft: "8px"
    });
    line.appendChild(glyph({ shape: "square", color, fillColor: color }));
    line.appendChild(div({}, labelFor(i)));
    row.appendChild(line);
  });
  return row;
}
function sizesRow(entry) {
  const row = div({ display: "flex", alignItems: "center", marginTop: "5px" });
  row.appendChild(div({ marginRight: "6px", flex: "none", color: "#666" }, "\u25CF"));
  const range = entry.vmin != null && entry.vmax != null ? ` (${entry.vmin} \u2013 ${entry.vmax})` : "";
  row.appendChild(div({}, `size \u221D ${entry.field || entry.label}${range}`));
  return row;
}
function swatchRow(entry) {
  const row = div({ display: "flex", alignItems: "center", marginTop: "5px" });
  row.appendChild(glyph(entry));
  row.appendChild(div({}, entry.label));
  return row;
}
var collapsedByContainer2 = /* @__PURE__ */ new WeakMap();
function renderLegend(container, spec, options = {}) {
  container.innerHTML = "";
  const dimHidden = options.dimHidden !== false;
  let collapsed = collapsedByContainer2.get(container);
  if (!collapsed) {
    collapsed = /* @__PURE__ */ new Set();
    collapsedByContainer2.set(container, collapsed);
  }
  container.appendChild(div({
    fontSize: "13px",
    fontWeight: "bold",
    borderBottom: "2px solid #eee",
    paddingBottom: "4px",
    marginBottom: "4px"
  }, spec.title));
  for (const group of spec.groups) {
    const isCollapsed = group.name && collapsed.has(group.name);
    if (group.name) {
      const header = div({
        fontWeight: "bold",
        marginTop: "6px",
        cursor: "pointer",
        userSelect: "none"
      });
      header.textContent = `${isCollapsed ? "\u25B8" : "\u25BE"} ${group.name}`;
      header.addEventListener("click", () => {
        if (collapsed.has(group.name)) collapsed.delete(group.name);
        else collapsed.add(group.name);
        renderLegend(container, spec, options);
      });
      container.appendChild(header);
    }
    if (isCollapsed) continue;
    for (const entry of group.entries) {
      const row = entry.kind === "ramp" ? rampRow(entry) : entry.kind === "categories" ? categoriesRow(entry) : entry.kind === "bins" ? binsRow(entry) : entry.kind === "sizes" ? sizesRow(entry) : swatchRow(entry);
      if (entry.hidden && dimHidden) row.style.opacity = "0.5";
      container.appendChild(row);
    }
  }
  return container;
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
var MONDAY_EPOCH = Date.UTC(1970, 0, 5);
function alignToPeriod(ms, p) {
  const fixed = periodToMs(p);
  const hasClock = Boolean(p.weeks || p.days || p.hours || p.minutes || p.seconds);
  if (fixed) {
    const wholeWeeks = p.weeks && !p.days && !p.hours && !p.minutes && !p.seconds;
    const origin = wholeWeeks ? MONDAY_EPOCH : 0;
    return origin + Math.ceil((ms - origin) / fixed) * fixed;
  }
  if ((p.years || p.months) && !hasClock) {
    const span = p.years * 12 + p.months;
    const d = new Date(ms);
    let index = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) < ms) index += 1;
    index = Math.ceil(index / span) * span;
    return Date.UTC(Math.floor(index / 12), index % 12, 1);
  }
  return ms;
}
function nearestTickIndex(ticks, moment) {
  if (!ticks.length || !Number.isFinite(moment)) return 0;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < ticks.length; i++) {
    const distance = Math.abs(ticks[i] - moment);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}
function generateTicks(startMs, endMs, p) {
  const first = alignToPeriod(startMs, p);
  const ticks = [first];
  let t = first;
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
  for (let i = 0; i < times.length; i += 2) {
    if (featureInWindow(times[i], times[i + 1], win)) return true;
  }
  return false;
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
    if (!times) continue;
    for (let i = 0; i < times.length; i += 2) {
      if (!Number.isNaN(times[i]) && times[i] < base) base = times[i];
    }
  }
  if (base === Infinity) base = 0;
  const perFeature = layersList.map((layer, idx) => {
    const times = layer.time ? timesFor(layer, coordinateBuffers) : null;
    const dur = layer.time ? durationSeconds(layer.time.duration, periodMs) : ALWAYS;
    const signedDur = layer.time && layer.time.fade ? -dur : dur;
    if (!times || times.length === 2 && Number.isNaN(times[0])) {
      return { start: -ALWAYS, end: ALWAYS, dur: ALWAYS, idx };
    }
    const nVerts = vertexCountOf(layer, coordinateBuffers);
    if (layer.type === "polyline" && times.length > 2 && times.length === nVerts * 2) {
      const lengths = Array.isArray(layer.parts) && layer.parts.length > 1 ? layer.parts : [nVerts];
      const segs = lengths.reduce((a, n) => a + Math.max(0, n - 1), 0);
      const seg = new Float64Array(segs * 2);
      let k = 0, offset = 0;
      for (const n of lengths) {
        for (let j = 0; j + 1 < n; j++) {
          const s = times[(offset + j) * 2];
          const e = times[(offset + j + 1) * 2 + 1];
          if (Number.isNaN(s) || Number.isNaN(e)) {
            seg[k * 2] = -ALWAYS;
            seg[k * 2 + 1] = ALWAYS;
          } else {
            seg[k * 2] = (s - base) / 1e3;
            seg[k * 2 + 1] = (e - base) / 1e3;
          }
          k++;
        }
        offset += n;
      }
      return {
        seg,
        start: seg[0],
        end: seg[seg.length - 1],
        dur: signedDur,
        idx
      };
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
function vertexCountOf(layer, coordinateBuffers) {
  const raw = coordinateBuffers[layer.id];
  if (raw) return (raw.byteLength || raw.length || 0) / 16;
  return (layer.locations || []).length;
}
function expandPerFeature(perFeature, counts) {
  let total = 0;
  for (const c of counts) total += c;
  const spans = new Float32Array(total * 2);
  const durs = new Float32Array(total);
  const layerIdx = new Float32Array(total);
  let out = 0;
  perFeature.forEach((f, i) => {
    const perSegment = f.seg && f.seg.length === counts[i] ? f.seg : null;
    for (let v = 0; v < counts[i]; v++) {
      const k = perSegment ? (v >> 1) * 2 : -1;
      spans[out * 2] = perSegment ? perSegment[k] : f.start;
      spans[out * 2 + 1] = perSegment ? perSegment[k + 1] : f.end;
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
      if (map._clickMatches.length > 0 && !map._pmModeActive) {
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
function imageMetaKey(layer) {
  return JSON.stringify([
    layer.url || null,
    layer.bounds,
    layer.opacity ?? 1,
    layer.image_format || null
  ]);
}
function renderImageLayer(map, layer, coordBuffer) {
  if (!layer.bounds) return null;
  let url = layer.url;
  let objectUrl = null;
  if (!url && coordBuffer) {
    const blob = new Blob(
      [coordBuffer],
      { type: layer.image_format || "image/png" }
    );
    objectUrl = url = URL.createObjectURL(blob);
  }
  if (!url) return null;
  const overlay = L.imageOverlay(url, layer.bounds, {
    opacity: layer.opacity ?? 1,
    // Context, not a click target: clicks fall through to features and the
    // empty-map coordinate fallback. The default overlayPane (z 400)
    // already sits above tiles (200) and below the GL panes (410+).
    interactive: false
  });
  if (objectUrl) {
    overlay.on("remove", () => URL.revokeObjectURL(objectUrl));
  }
  overlay.addTo(map);
  overlay.layerType = layer.type;
  overlay.imageMeta = imageMetaKey(layer);
  overlay.imageSource = coordBuffer || null;
  return overlay;
}
async function renderLayer(map, layer, coordBuffer, coordinateBuffers = {}) {
  if (layer.type === "image") {
    return renderImageLayer(map, layer, coordBuffer);
  }
  if (layer.type === "group") {
    const group = L.layerGroup();
    for (const sub of layer.layers) {
      if (sub.type === "circle_markers" || sub.type === "markers" || sub.type === "polyline" || sub.type === "polygon" || sub.type === "circle") {
        continue;
      }
      const instance = await renderLayer(map, sub, coordinateBuffers[sub.id], coordinateBuffers);
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
function lineParts(layer, coordinateBuffers) {
  const locs = vectorCoords(layer, coordinateBuffers) || [];
  const lengths = Array.isArray(layer.parts) && layer.parts.length > 1 ? layer.parts : null;
  if (!lengths) return locs.length ? [locs] : [];
  const parts = [];
  let offset = 0;
  for (const n of lengths) {
    const part = locs.slice(offset, offset + n);
    offset += n;
    if (part.length >= 2) parts.push(part);
  }
  return parts;
}
function closeRing(ring) {
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return ring;
}
var LINE_HIT_SLACK_PX = 8;
function trackLineSensitivity(map, instance) {
  const apply = () => {
    const slack = LINE_HIT_SLACK_PX / Math.pow(2, map.getZoom());
    instance.settings.sensitivity = slack;
    instance.settings.sensitivityHover = slack;
  };
  apply();
  map.on("zoomend", apply);
  return () => map.off("zoomend", apply);
}
function areaParts(layer, coordinateBuffers) {
  if (layer.type === "circle") {
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
      ring.push([lon + dLon * 180 / Math.PI, lat + dLat * 180 / Math.PI]);
    }
    return [[ring]];
  }
  const locs = vectorCoords(layer, coordinateBuffers) || [];
  const lonlat = locs.map((c) => [c[1], c[0]]);
  const ringTable = layer.rings || (lonlat.length > 0 ? [[lonlat.length]] : []);
  const parts = [];
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
  return parts;
}
async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, events, timeState = null, vectorGpu = false, isFeatureVisible = null) {
  const onFeatureClick = events && events.onFeatureClick || (() => {
  });
  const visibleNow = isFeatureVisible || ((l) => l.visible !== false);
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
      const style = styleFor(layer, 0);
      const rgb = parseColor(style.color, "#3388ff");
      if (layer.type === "polygon" || layer.type === "circle") {
        let count2 = 0;
        if ((style.weight ?? 3) > 0 && (style.opacity ?? 1) > 0) {
          for (const rings of areaParts(layer, coordinateBuffers)) {
            for (const ring of rings) {
              count2 += Math.max(0, 2 * (ring.length - 1));
              features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: ring },
                properties: {
                  layer,
                  // Outline pixels only -- the area's shapes instance
                  // owns interaction with exact containment. Left
                  // clickable, these rings answered through glify's
                  // line tolerance (0.1 DEGREES for clicks vs 0.03
                  // for hovers): popups well outside the shape and
                  // inside holes, hover disagreeing with click.
                  isBorder: true,
                  colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.opacity || 1 },
                  weight: style.weight || 3
                }
              });
            }
          }
        }
        vertexCounts.push(count2);
        continue;
      }
      let count = 0;
      for (const part of lineParts(layer, coordinateBuffers)) {
        const geojsonCoords = part.map((c) => [c[1], c[0]]);
        count += Math.max(0, 2 * (geojsonCoords.length - 1));
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
      vertexCounts.push(count);
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
            if (!feature || !feature.properties || feature.properties.isBorder || !feature.properties.layer || !visibleNow(feature.properties.layer)) return;
            registerClickMatch(map, 2, () => {
              if (feature && feature.properties && feature.properties.layer) {
                const layer = feature.properties.layer;
                bindPopup(map, e.latlng, layer.properties, layer);
                onFeatureClick({
                  layer,
                  index: 0,
                  latlng: [
                    Math.round(e.latlng.wrap().lat * 1e5) / 1e5,
                    Math.round(e.latlng.wrap().lng * 1e5) / 1e5
                  ]
                });
              }
            });
          },
          hover: (e, feature) => {
            this._isHovering = true;
            if (feature && feature.properties && !feature.properties.isBorder && feature.properties.layer && visibleNow(feature.properties.layer)) {
              registerHoverMatch(map, 2, () => {
                const layer = feature.properties.layer;
                map.getContainer().style.cursor = "pointer";
                bindTooltip(map, e.latlng, layer.properties, layer, this);
              });
            }
          }
        });
        setupGlifyProjection(this.glLines);
        this._sensitivityOff = trackLineSensitivity(m, this.glLines);
        if (vectorTime) {
          this._swiftmapTime = attachTimeToVectorInstance(this.glLines, vectorMeta, vertexCounts);
        }
      },
      onRemove: function(m) {
        if (this._mapMouseMoveHandler) {
          m.off("mousemove", this._mapMouseMoveHandler);
        }
        if (this._sensitivityOff) this._sensitivityOff();
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
      const parts = areaParts(layer, coordinateBuffers);
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
      const rgb = parseColor(style.fillColor || style.fill_color || style.color, "#3388ff");
      for (const rings of parts) {
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: rings },
          properties: {
            layer,
            colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.fillOpacity || 0.2 }
          }
        });
      }
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
            if (!feature || !feature.properties || !feature.properties.layer || !visibleNow(feature.properties.layer)) return;
            registerClickMatch(map, 3, () => {
              if (feature && feature.properties && feature.properties.layer) {
                const layer = feature.properties.layer;
                bindPopup(map, e.latlng, layer.properties, layer);
                onFeatureClick({
                  layer,
                  index: 0,
                  latlng: [
                    Math.round(e.latlng.wrap().lat * 1e5) / 1e5,
                    Math.round(e.latlng.wrap().lng * 1e5) / 1e5
                  ]
                });
              }
            });
          },
          hover: (e, feature) => {
            this._isHovering = true;
            if (feature && feature.properties && feature.properties.layer && visibleNow(feature.properties.layer)) {
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
    const colorsRaw = coordinateBuffers[`${layer.id}::colors`];
    const bufColors = colorsRaw ? new Uint8Array(
      colorsRaw.buffer || colorsRaw,
      colorsRaw.byteOffset || 0,
      colorsRaw.byteLength
    ) : null;
    const radiiRaw = coordinateBuffers[`${layer.id}::radii`];
    const bufRadii = radiiRaw ? new Float32Array(
      radiiRaw.buffer || radiiRaw,
      radiiRaw.byteOffset || 0,
      radiiRaw.byteLength / 4
    ) : null;
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
        colorRGB: color ? parseColor(color, fallbackColor) : bufColors ? {
          r: bufColors[i * 4] / 255,
          g: bufColors[i * 4 + 1] / 255,
          b: bufColors[i * 4 + 2] / 255,
          a: bufColors[i * 4 + 3] / 255
        } : colorRGB,
        size: radius != null ? Number(radius) : bufRadii ? bufRadii[i] : layerSize
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
          const idx = pointsList.indexOf(point);
          const preInfo = indexMapping[idx];
          if (!preInfo || !visibleNow(preInfo.layer, preInfo.originalIndex)) {
            return;
          }
          registerClickMatch(map, 1, () => {
            const info = preInfo;
            if (info) {
              const layer = info.layer;
              const originalIndex = info.originalIndex;
              const props = getIndexedProperties(layer.properties, originalIndex);
              bindPopup(map, point, props, layer);
              onFeatureClick({
                layer,
                index: originalIndex,
                latlng: [point[0], point[1]]
              });
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
            const idx = pointsList.indexOf(point);
            const info = indexMapping[idx];
            if (!info || !visibleNow(info.layer, info.originalIndex)) {
              return;
            }
            registerHoverMatch(map, 1, () => {
              map.getContainer().style.cursor = "pointer";
              const el = getInteractiveEl();
              if (el) el.style.cursor = "pointer";
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

// src/labels.js
function timeVisible(layer, buffers, timeState) {
  if (!timeState || !layer.time) return true;
  const times = timesFor(layer, buffers);
  if (!times || times.length < 2) return true;
  const win = windowFor(
    timeState.tick,
    effectiveDuration(layer, timeState),
    timeState.period
  );
  for (let i = 0; i < times.length; i += 2) {
    if (Number.isNaN(times[i])) return true;
    if (featureInWindow(times[i], times[i + 1], win)) return true;
  }
  return false;
}
function planarLength(part) {
  let total = 0;
  for (let i = 1; i < part.length; i++) {
    const dLat = part[i][0] - part[i - 1][0];
    const dLng = part[i][1] - part[i - 1][1];
    total += Math.sqrt(dLat * dLat + dLng * dLng);
  }
  return total;
}
function collectLabels(layers, buffers, groupConfigs, timeState = null) {
  const out = [];
  for (const layer of layers || []) {
    if (!isLayerEffectiveVisible(layer, groupConfigs || {})) continue;
    if (layer.type === "group") {
      out.push(...collectLabels(layer.layers || [], buffers, groupConfigs, timeState));
      continue;
    }
    if (Array.isArray(layer.labels)) {
      const raw = buffers && buffers[layer.id];
      if (!raw) continue;
      const coords = new Float64Array(
        raw.buffer || raw,
        raw.byteOffset || 0,
        (raw.byteLength || raw.length) / 8
      );
      const win = timeState && layer.time ? windowFor(
        timeState.tick,
        effectiveDuration(layer, timeState),
        timeState.period
      ) : null;
      const times = win ? timesFor(layer, buffers) : null;
      const count = Math.min(layer.labels.length, coords.length / 2);
      for (let i = 0; i < count; i++) {
        if (!layer.labels[i]) continue;
        if (times && !Number.isNaN(times[i * 2]) && !featureInWindow(times[i * 2], times[i * 2 + 1], win)) {
          continue;
        }
        out.push({
          lat: coords[i * 2],
          lng: coords[i * 2 + 1],
          text: String(layer.labels[i]),
          center: false
        });
      }
    } else if (layer.label) {
      if (!timeVisible(layer, buffers, timeState)) continue;
      if (layer.type === "polyline") {
        const parts = lineParts(layer, buffers || {});
        if (parts.length === 0) continue;
        const longest = parts.reduce((best, part) => planarLength(part) > planarLength(best) ? part : best, parts[0]);
        const mid = longest[Math.floor((longest.length - 1) / 2)];
        out.push({
          lat: mid[0],
          lng: mid[1],
          text: String(layer.label),
          center: false
        });
      } else if (layer.bounds) {
        const [[aLat, aLon], [bLat, bLon]] = layer.bounds;
        out.push({
          lat: (aLat + bLat) / 2,
          lng: (aLon + bLon) / 2,
          text: String(layer.label),
          center: true
        });
      } else if (layer.location) {
        out.push({
          lat: layer.location[0],
          lng: layer.location[1],
          text: String(layer.label),
          center: true
        });
      } else {
        const locs = vectorCoords(layer, buffers || {}) || [];
        if (locs.length === 0) continue;
        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        for (const [lat, lng] of locs) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
        out.push({
          lat: (minLat + maxLat) / 2,
          lng: (minLng + maxLng) / 2,
          text: String(layer.label),
          center: true
        });
      }
    }
  }
  return out;
}
function renderLabels(L2, group, layers, buffers, groupConfigs, timeState = null) {
  const labels = collectLabels(layers, buffers, groupConfigs, timeState);
  const key = JSON.stringify(labels);
  if (group._swiftmapLabelKey === key) return;
  group._swiftmapLabelKey = key;
  group.clearLayers();
  for (const item of labels) {
    const span = document.createElement("span");
    span.textContent = item.text;
    const tooltip = L2.tooltip({
      permanent: true,
      direction: item.center ? "center" : "top",
      className: "swiftmap-feature-label",
      offset: item.center ? [0, 0] : [0, -6]
    }).setLatLng([item.lat, item.lng]).setContent(span);
    group.addLayer(tooltip);
  }
}

// src/core.js
function sendLayerWrite(host, changes) {
  if (!changes.length) return;
  try {
    host.send({
      kind: "swiftmap_write",
      ops: changes.map((c) => ({ op: "set", id: c.id, fields: { visible: c.visible } }))
    });
  } catch (err) {
  }
}
async function createSwiftMap({ host, el }) {
  const subscriptions = [];
  function listen(event, fn) {
    subscriptions.push([event, fn]);
    host.on(event, fn);
  }
  let destroyed = false;
  const originalError = console.error;
  const originalWarn = console.warn;
  const MAX_CONSOLE_LOGS = 200;
  const appendLog = (entry) => {
    const logs = host.get("js_console_logs") || [];
    const next = [...logs, entry];
    return next.length > MAX_CONSOLE_LOGS ? next.slice(-MAX_CONSOLE_LOGS) : next;
  };
  function safeSetAndSave(key, value) {
    if (document.body.contains(el)) {
      try {
        host.set(key, value);
        host.save_changes();
      } catch (e) {
        originalWarn.call(console, "[SwiftMap] Suppressed sync write error:", e);
      }
    }
  }
  function safeSaveChanges() {
    if (document.body.contains(el)) {
      try {
        host.save_changes();
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
        const crs = host.get("crs") || "EPSG:3857";
        const cleanMsg = `[SwiftMap] Layer was reprojected to "${crs}"`;
        originalWarn.call(console, cleanMsg);
        safeSetAndSave("js_console_logs", appendLog(cleanMsg));
      }
      return;
    }
    originalWarn.apply(console, args);
  };
  const onWindowError = function(message, source, lineno, colno, error) {
    safeSetAndSave(
      "js_console_logs",
      appendLog(`WINDOW.ONERROR: ${message} at ${source}:${lineno}:${colno}`)
    );
  };
  window.onerror = onWindowError;
  loadCSS("leaflet-css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
  await loadJS("leaflet-js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
  await loadJS("leaflet-glify", "https://unpkg.com/leaflet.glify@3.3.0/dist/glify-browser.js");
  loadCSS(
    "leaflet-geoman-css",
    "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.css"
  );
  await loadJS(
    "leaflet-geoman",
    "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.min.js"
  );
  const container = document.createElement("div");
  container.className = "swiftmap-container";
  container.style.width = "100%";
  container.style.position = "relative";
  el.appendChild(container);
  function applyHeight() {
    const h = host.get("height");
    container.style.height = h || "100%";
    container.style.minHeight = h ? "0" : "";
  }
  applyHeight();
  let labelsGroup = null;
  const crsName = host.get("crs");
  let mapCrs = L.CRS.EPSG3857;
  if (crsName === "EPSG:4326") {
    mapCrs = L.CRS.EPSG4326;
  }
  const map = L.map(container, {
    crs: mapCrs,
    center: host.get("center"),
    zoom: host.get("zoom"),
    scrollWheelZoom: true,
    preferCanvas: true
  });
  map.createPane("polygonsPane");
  map.getPane("polygonsPane").style.zIndex = "410";
  map.createPane("polylinesPane");
  map.getPane("polylinesPane").style.zIndex = "420";
  map.createPane("pointsPane");
  map.getPane("pointsPane").style.zIndex = "430";
  map.createPane("swiftmapDrawPane");
  map.getPane("swiftmapDrawPane").style.zIndex = "440";
  labelsGroup = L.layerGroup().addTo(map);
  let layerState = host.get("layers") || [];
  let bufferState = { ...host.get("coordinate_buffers") || {} };
  function applyPatchOps(ops, buffers) {
    const next = applySwiftmapPatch({ layers: layerState, buffers: bufferState }, ops, buffers);
    layerState = next.layers;
    bufferState = next.buffers;
  }
  function findLayerNow(list, id) {
    for (const l of list) {
      if (l.id === id) return l;
      if (l.type === "group") {
        const sub = findLayerNow(l.layers || [], id);
        if (sub) return sub;
      }
    }
    return null;
  }
  function featureVisibleNow(layer, index) {
    const current = findLayerNow(layerState, layer.id) || layer;
    if (!isLayerEffectiveVisible(current, host.get("group_configs") || {})) {
      return false;
    }
    if (!current.time || !timeState) return true;
    const times = timesFor(current, bufferState);
    if (!times) return true;
    const win = windowFor(
      timeState.tick,
      effectiveDuration(current, timeState),
      timeState.period
    );
    if (index != null && times.length > 2) {
      const start = times[index * 2];
      return Number.isNaN(start) || featureInWindow(start, times[index * 2 + 1], win);
    }
    for (let i = 0; i < times.length; i += 2) {
      if (Number.isNaN(times[i]) || featureInWindow(times[i], times[i + 1], win)) return true;
    }
    return false;
  }
  const layerEvents = {
    onFeatureClick: ({ layer, index, latlng }) => {
      try {
        host.set("clicked_layer_id", layer.id);
        host.set("selected_index", index);
        host.set("clicked_latlng", latlng);
        host.set("click_seq", (host.get("click_seq") || 0) + 1);
        host.save_changes();
      } catch (err) {
      }
    }
  };
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
      host.set("time_current", timeUI.ticks[timeUI.index]);
      host.save_changes();
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
      const cfg = { ...host.get("time_config") || {} };
      if (iso) cfg.window = iso;
      else delete cfg.window;
      try {
        host.set("time_config", cfg);
        host.save_changes();
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
    const cfg = host.get("time_config") || {};
    const period = parsePeriod(cfg.period || "P1D") || parsePeriod("P1D");
    const extent = collectTimeExtent(layerState, bufferState);
    if (!extent) return;
    const key = `${extent.min}|${extent.max}|${cfg.period || "P1D"}`;
    if (key !== timeUI.key) {
      const moment = timeUI.ticks.length ? timeUI.ticks[timeUI.index] : null;
      timeUI.key = key;
      timeUI.ticks = generateTicks(extent.min, extent.max, period);
      timeUI.index = moment === null ? 0 : nearestTickIndex(timeUI.ticks, moment);
      if (moment !== null && timeUI.ticks[timeUI.index] !== moment) {
        writeTimeCurrent(true);
      }
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
  const legendDiv = document.createElement("div");
  legendDiv.className = "swiftmap-legend";
  legendDiv.style.position = "absolute";
  legendDiv.style.zIndex = "1000";
  legendDiv.style.background = "white";
  legendDiv.style.padding = "10px";
  legendDiv.style.borderRadius = "5px";
  legendDiv.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
  legendDiv.style.maxWidth = "260px";
  legendDiv.style.maxHeight = "45%";
  legendDiv.style.overflowY = "auto";
  legendDiv.style.fontFamily = sidebar.style.fontFamily;
  legendDiv.style.fontSize = "12px";
  legendDiv.style.color = "#333";
  legendDiv.style.display = "none";
  container.appendChild(legendDiv);
  const LOGO_POSITIONS = /* @__PURE__ */ new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
  const DEFAULT_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 40"><rect width="140" height="40" rx="8" fill="#1f6feb"/><text x="70" y="26" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="18" font-weight="600" fill="#fff" text-anchor="middle">swiftmap</text></svg>'
  );
  const logoDiv = document.createElement("div");
  logoDiv.className = "swiftmap-logo";
  logoDiv.style.position = "absolute";
  logoDiv.style.zIndex = "1000";
  logoDiv.style.background = "white";
  logoDiv.style.padding = "5px";
  logoDiv.style.borderRadius = "4px";
  logoDiv.style.boxShadow = "0 1px 5px rgba(0,0,0,0.4)";
  logoDiv.style.display = "none";
  container.appendChild(logoDiv);
  function syncLogo() {
    const show = Boolean(host.get("show_logo"));
    logoDiv.style.display = show ? "block" : "none";
    logoDiv.replaceChildren();
    if (!show) return;
    const cfg = host.get("logo_config") || {};
    const height = Number(cfg.height) > 0 ? Number(cfg.height) : 35;
    const position = LOGO_POSITIONS.has(cfg.position) ? cfg.position : "bottom-right";
    for (const side of ["top", "bottom", "left", "right"]) logoDiv.style[side] = "";
    logoDiv.style[position.startsWith("top") ? "top" : "bottom"] = "10px";
    logoDiv.style[position.endsWith("left") ? "left" : "right"] = "10px";
    const slots = [cfg.company, cfg.parent_company].filter((s) => s && s.url);
    const images = slots.length ? slots : [{ url: DEFAULT_LOGO, alt: "swiftmap" }];
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "5px";
    for (const image of images) {
      const img = document.createElement("img");
      img.src = image.url;
      img.alt = image.alt || "";
      img.style.height = `${height}px`;
      row.appendChild(img);
    }
    logoDiv.appendChild(row);
  }
  syncLogo();
  listen("change:logo_config", syncLogo);
  function getTileLayer(layer) {
    const options = {
      attribution: layer.attribution || "",
      maxZoom: layer.max_zoom || 22,
      maxNativeZoom: layer.max_native_zoom || 19
    };
    if (layer.subdomains) options.subdomains = layer.subdomains;
    if (layer.wms) {
      return L.tileLayer.wms(layer.url, {
        ...options,
        layers: layer.wms.layers,
        format: layer.wms.format || "image/png",
        version: layer.wms.version || "1.1.1",
        transparent: !!layer.wms.transparent,
        ...layer.wms.styles ? { styles: layer.wms.styles } : {}
      });
    }
    return L.tileLayer(layer.url, options);
  }
  async function syncMapState() {
    console.time("[Performance] syncMapState Total");
    updateTimeDimension();
    const layers = layerState;
    const groupConfigs = host.get("group_configs") || {};
    const coordinateBuffers = bufferState;
    const radio = normalizeRadioLayers(layers, groupConfigs, sidebarCollapseState(sidebar));
    if ((radio.changes.length > 0 || radio.groupsChanged) && document.body.contains(el)) {
      sendLayerWrite(host, radio.changes);
      host.set("group_configs", { ...groupConfigs });
      host.save_changes();
    }
    syncLogo();
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
        const staleImage = layer.type === "image" && (existing.imageMeta !== imageMetaKey(layer) || existing.imageSource !== (coordinateBuffers[layer.id] || null));
        if (existing.layerType !== layer.type || staleImage) {
          existing.remove();
          delete activeOverlayLayers[layer.id];
        } else {
          continue;
        }
      }
      const instance = await renderLayer(map, layer, coordinateBuffers[layer.id], coordinateBuffers);
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
        // Identity of every buffer the bucket reads for this layer:
        // same-length replacements must rebuild too.
        bufSerial: [l.id, `${l.id}::colors`, `${l.id}::radii`, `${l.id}::times`].map((k) => bufferSerial(coordinateBuffers[k])),
        locLen: l.locations?.length || 0
      })));
      const state = glStates[type];
      const stateChanged = state.ids !== idsString || state.meta !== metaString;
      if (stateChanged) {
        if (state.layer) {
          state.layer.remove();
        }
        if (visibleLayers.length > 0) {
          state.layer = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, layerEvents, timeState, vectorGpu, featureVisibleNow);
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
    allByType.polyline = [...allByType.polyline, ...allByType.polygon];
    const bucket = {
      circle_markers: webglCircleMarkerLayers,
      markers: webglMarkerLayers,
      polyline: [...webglPolylineLayers, ...webglPolygonLayers],
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
    renderSidebarControls(sidebar, layers, {
      groupConfigs,
      coordinateBuffers,
      onLayerWrite: (changes) => sendLayerWrite(host, changes),
      // group_configs stays on the host: a handful of folder flags, and the
      // spread gives Backbone a fresh reference so in-place edits register.
      onGroupConfigsChange: (cfg) => {
        host.set("group_configs", { ...cfg });
        host.save_changes();
      }
    }, map, () => {
      performSync();
    });
    if (labelsGroup) {
      renderLabels(
        L,
        labelsGroup,
        layers,
        coordinateBuffers,
        groupConfigs,
        timeState
      );
    }
    const legendCfg = host.get("legend_config") || {};
    if (host.get("show_legend")) {
      const spec = deriveLegendSpec(layers, groupConfigs, legendCfg);
      renderLegend(
        legendDiv,
        spec,
        { dimHidden: legendCfg.dim_hidden !== false }
      );
      const pos = POSITIONS[legendCfg.position] || POSITIONS["bottom-left"];
      for (const [prop, value] of Object.entries(pos)) {
        legendDiv.style[prop] = value;
      }
      legendDiv.style.display = spec.groups.length > 0 ? "block" : "none";
    } else {
      legendDiv.style.display = "none";
    }
    console.timeEnd("[Performance] syncMapState Total");
  }
  let isUpdatingCenterFromMap = false;
  let isUpdatingZoomFromMap = false;
  let drawReady = false;
  let drawingsGroup = null;
  let drawIdCounter = 0;
  let suppressDrawingsEcho = false;
  function drawingToFeature(l) {
    const gj = l.toGeoJSON();
    gj.properties = { ...gj.properties || {}, draw_id: l._swiftmapDrawId };
    if (typeof l.getRadius === "function" && l instanceof L.Circle) {
      gj.properties.kind = "circle";
      gj.properties.radius = l.getRadius();
    }
    return gj;
  }
  function writeDrawings() {
    const features = [];
    drawingsGroup.eachLayer((l) => features.push(drawingToFeature(l)));
    suppressDrawingsEcho = true;
    try {
      host.set("drawings", features);
      host.set("draw_seq", (host.get("draw_seq") || 0) + 1);
      host.save_changes();
    } catch (err) {
    }
    suppressDrawingsEcho = false;
  }
  function adoptDrawing(layer) {
    if (!layer._swiftmapDrawId) {
      layer._swiftmapDrawId = `draw_${++drawIdCounter}`;
    }
    drawingsGroup.addLayer(layer);
    layer.on("pm:update pm:dragend pm:rotateend", writeDrawings);
  }
  function rehydrateDrawings() {
    drawingsGroup.clearLayers();
    for (const feature of host.get("drawings") || []) {
      const props = feature.properties || {};
      let layer;
      if (props.kind === "circle" && feature.geometry.type === "Point") {
        const [lng, lat] = feature.geometry.coordinates;
        layer = L.circle([lat, lng], {
          radius: props.radius || 100,
          pane: "swiftmapDrawPane"
        });
      } else {
        layer = L.geoJSON(feature, { pane: "swiftmapDrawPane" }).getLayers()[0];
      }
      if (!layer) continue;
      layer._swiftmapDrawId = props.draw_id || `draw_${++drawIdCounter}`;
      adoptDrawing(layer);
    }
  }
  function syncDraw() {
    const show = host.get("show_draw");
    const cfg = host.get("draw_config") || {};
    if (show && !drawReady) {
      drawReady = true;
      map.pm.setGlobalOptions({
        panes: {
          layerPane: "swiftmapDrawPane",
          vertexPane: "markerPane",
          markerPane: "markerPane"
        }
      });
      drawingsGroup = L.featureGroup().addTo(map);
      rehydrateDrawings();
      map.on("pm:create", (e) => {
        adoptDrawing(e.layer);
        writeDrawings();
      });
      map.on("pm:remove", (e) => {
        drawingsGroup.removeLayer(e.layer);
        writeDrawings();
      });
      listen("change:drawings", () => {
        if (!suppressDrawingsEcho) rehydrateDrawings();
      });
    }
    if (!drawReady) return;
    if (show) {
      const tools = cfg.tools || ["marker", "polyline", "rectangle", "polygon", "circle"];
      map.pm.addControls({
        position: (cfg.position || "top-left").replace("-", ""),
        drawMarker: tools.includes("marker"),
        drawPolyline: tools.includes("polyline"),
        drawRectangle: tools.includes("rectangle"),
        drawPolygon: tools.includes("polygon"),
        drawCircle: tools.includes("circle"),
        drawCircleMarker: false,
        drawText: false,
        rotateMode: false,
        cutPolygon: false,
        editMode: true,
        dragMode: true,
        removalMode: true
      });
    } else {
      map.pm.removeControls();
    }
  }
  syncDraw();
  listen("change:show_draw", syncDraw);
  listen("change:draw_config", syncDraw);
  const NauticalScale = L.Control.Scale.extend({
    onAdd: function(m) {
      const container2 = L.Control.Scale.prototype.onAdd.call(this, m);
      this._nauticalScale = L.DomUtil.create(
        "div",
        "leaflet-control-scale-line",
        container2
      );
      this._update();
      return container2;
    },
    _updateScales: function(maxMeters) {
      L.Control.Scale.prototype._updateScales.call(this, maxMeters);
      if (this._nauticalScale && maxMeters) {
        const maxNm = maxMeters / 1852;
        const nm = this._getRoundNum(maxNm);
        this._updateScale(this._nauticalScale, `${nm} nm`, nm / maxNm);
      }
    }
  });
  let scaleControl = null;
  function syncScale() {
    if (scaleControl) {
      scaleControl.remove();
      scaleControl = null;
    }
    if (!host.get("show_scale")) return;
    const cfg = host.get("scale_config") || {};
    const units = cfg.units || "metric";
    const options = {
      position: (cfg.position || "bottom-left").replace("-", ""),
      maxWidth: cfg.max_width || 120,
      metric: units === "metric" || units === "both",
      imperial: units === "imperial" || units === "both"
    };
    scaleControl = units === "nautical" ? new NauticalScale(options) : L.control.scale(options);
    scaleControl.addTo(map);
  }
  syncScale();
  listen("change:show_scale", syncScale);
  listen("change:scale_config", syncScale);
  map.on("click", (e) => {
    const pm = map.pm;
    map._pmModeActive = Boolean(pm && (pm.globalRemovalModeEnabled && pm.globalRemovalModeEnabled() || pm.globalEditModeEnabled && pm.globalEditModeEnabled() || pm.globalDragModeEnabled && pm.globalDragModeEnabled() || pm.globalDrawModeEnabled && pm.globalDrawModeEnabled()));
    registerClickMatch(map, 99, () => {
      const ll = e.latlng.wrap();
      const lat = Math.round(ll.lat * 1e5) / 1e5;
      const lng = Math.round(ll.lng * 1e5) / 1e5;
      try {
        host.set("clicked_layer_id", "");
        host.set("selected_index", -1);
        host.set("clicked_latlng", [lat, lng]);
        host.set("click_seq", (host.get("click_seq") || 0) + 1);
        host.save_changes();
      } catch (err) {
      }
      if (host.get("show_click_coordinates")) {
        L.popup({ className: "swiftmap-coords-popup", closeButton: false }).setLatLng(e.latlng).setContent(`${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`).openOn(map);
      }
    });
  });
  map.on("moveend", () => {
    try {
      const center = map.getCenter();
      const currentZoom = map.getZoom();
      const modelCenter = host.get("center");
      const modelZoom = host.get("zoom");
      const zoomChanged = modelZoom !== currentZoom;
      const centerChanged = !modelCenter || !Array.isArray(modelCenter) || modelCenter.length < 2 || Math.abs(modelCenter[0] - center.lat) > 1e-4 || Math.abs(modelCenter[1] - center.lng) > 1e-4;
      if (centerChanged) {
        isUpdatingCenterFromMap = true;
        host.set("center", [center.lat, center.lng]);
      }
      if (zoomChanged) {
        isUpdatingZoomFromMap = true;
        host.set("zoom", currentZoom);
      }
      if (centerChanged || zoomChanged) {
        safeSaveChanges();
      }
    } catch (err) {
      console.error("Error in moveend handler:", err);
    }
  });
  function updateMapView() {
    const center = host.get("center");
    const zoom = host.get("zoom");
    if (center && Array.isArray(center) && center.length >= 2) {
      const mapCenter = map.getCenter();
      const mapZoom = map.getZoom();
      const centerChanged = Math.abs(mapCenter.lat - center[0]) > 1e-4 || Math.abs(mapCenter.lng - center[1]) > 1e-4;
      const zoomChanged = mapZoom !== zoom;
      if (centerChanged || zoomChanged) {
        map.setView(center, typeof zoom === "number" ? zoom : mapZoom);
      }
    } else {
      const zoom2 = host.get("zoom");
      if (typeof zoom2 === "number" && map.getZoom() !== zoom2) {
        map.setZoom(zoom2);
      }
    }
  }
  listen("change:center", () => {
    if (isUpdatingCenterFromMap) {
      isUpdatingCenterFromMap = false;
      return;
    }
    updateMapView();
  });
  listen("change:zoom", () => {
    if (isUpdatingZoomFromMap) {
      isUpdatingZoomFromMap = false;
      return;
    }
    updateMapView();
  });
  function applyFitRequest() {
    const req = host.get("fit_bounds_request") || {};
    const bounds = req.bounds;
    if (!bounds || bounds.length === 0) return;
    const options = {};
    if (req.padding != null) options.padding = [req.padding, req.padding];
    if (req.max_zoom != null) options.maxZoom = req.max_zoom;
    map.fitBounds(bounds, options);
    if (req.zoom_offset) {
      map.setZoom(map.getZoom() + req.zoom_offset);
    }
  }
  listen("change:fit_bounds_request", applyFitRequest);
  map.whenReady(() => applyFitRequest());
  let containerResize = null;
  if (typeof ResizeObserver !== "undefined") {
    let hadSize = container.clientWidth > 0 && container.clientHeight > 0;
    containerResize = new ResizeObserver(() => {
      const hasSize = container.clientWidth > 0 && container.clientHeight > 0;
      if (hasSize) {
        map.invalidateSize();
        if (!hadSize) applyFitRequest();
      }
      hadSize = hasSize;
    });
    containerResize.observe(container);
  }
  let syncTimeout = null;
  let isSyncing = false;
  let needsSync = false;
  async function performSync() {
    if (destroyed) return;
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
    if (destroyed || !host.get("auto_sync")) {
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
  listen("change:sync_trigger", () => {
    performSync();
  });
  listen("msg:custom", (msg, buffers) => {
    if (!msg || msg.kind !== "swiftmap_patch") return;
    applyPatchOps(msg.ops || [], buffers);
    queueSync();
  });
  listen("change:layers", () => {
    layerState = host.get("layers") || [];
    queueSync();
  });
  listen("change:coordinate_buffers", () => {
    bufferState = { ...host.get("coordinate_buffers") || {} };
    queueSync();
  });
  listen("change:group_configs", queueSync);
  listen("change:time_config", () => {
    timeUI.started = false;
    queueSync();
  });
  listen("change:time_current", () => {
    const wanted = host.get("time_current");
    if (!timeState || !timeUI.ticks.length) return;
    if (Math.abs(wanted - timeUI.ticks[timeUI.index]) < 1) return;
    let idx = timeUI.ticks.findIndex((t) => t >= wanted);
    if (idx === -1) idx = timeUI.ticks.length - 1;
    seekTo(idx, { write: false });
  });
  listen("change:show_logo", queueSync);
  listen("change:show_legend", queueSync);
  listen("change:legend_config", queueSync);
  listen("change:height", () => {
    applyHeight();
    map.invalidateSize();
  });
  try {
    host.send({ kind: "swiftmap_ready" });
  } catch (err) {
  }
  if (host.get("auto_sync") || host.get("sync_trigger") > 0) {
    performSync();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopPlayback();
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = null;
    }
    if (containerResize) containerResize.disconnect();
    if (typeof host.off === "function") {
      for (const [event, fn] of subscriptions) host.off(event, fn);
    }
    console.error = originalError;
    console.warn = originalWarn;
    if (window.onerror === onWindowError) window.onerror = null;
    try {
      map.remove();
    } catch (err) {
    }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
  return { map, container, sync: performSync, destroy };
}

// src/host.js
function createHostStub(initial = {}, hooks = {}) {
  const state = { ...initial };
  const listeners = {};
  const host = {
    comm: hooks.comm === void 0 ? null : hooks.comm,
    state,
    sets: [],
    // every set(), in order, for assertions
    sent: [],
    // every send()
    saves: 0,
    get: (key) => state[key],
    set(key, value) {
      state[key] = value;
      host.sets.push([key, value]);
      (listeners[`change:${key}`] || []).forEach((fn) => fn());
    },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    off(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
    },
    send(content, buffers) {
      host.sent.push({ content, buffers });
      if (hooks.onSend) hooks.onSend(content, buffers);
    },
    save_changes() {
      host.saves += 1;
      if (hooks.onSave) hooks.onSave();
    },
    // Fires listeners directly: how a test or an export pushes a real
    // swiftmap_patch through `msg:custom`, exactly as a kernel would.
    emit(event, ...args) {
      (listeners[event] || []).forEach((fn) => fn(...args));
    }
  };
  return host;
}

// src/anywidget.js
var anywidget_default = {
  async render({ model, el }) {
    const handle = await createSwiftMap({ host: model, el });
    return () => handle.destroy();
  }
};
export {
  createHostStub,
  anywidget_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9wYXRjaC5qcyIsICIuLi8uLi9zcmMvbGVnZW5kLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvZ3B1dGltZS5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9sYWJlbHMuanMiLCAiLi4vLi4vc3JjL2NvcmUuanMiLCAiLi4vLi4vc3JjL2hvc3QuanMiLCAiLi4vLi4vc3JjL2FueXdpZGdldC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGZ1bmN0aW9uIGxvYWRDU1MoaWQsIHVybCkge1xuICAgIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgIGNvbnN0IGxpbmsgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwibGlua1wiKTtcbiAgICAgICAgbGluay5pZCA9IGlkO1xuICAgICAgICBsaW5rLnJlbCA9IFwic3R5bGVzaGVldFwiO1xuICAgICAgICBsaW5rLmhyZWYgPSB1cmw7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQobGluayk7XG4gICAgfVxufVxuXG5jb25zdCBhY3RpdmVMb2FkZXJzID0ge307XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSlMoaWQsIHVybCkge1xuICAgIGlmIChhY3RpdmVMb2FkZXJzW2lkXSkge1xuICAgICAgICByZXR1cm4gYWN0aXZlTG9hZGVyc1tpZF07XG4gICAgfVxuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzY3JpcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic2NyaXB0XCIpO1xuICAgICAgICBzY3JpcHQuaWQgPSBpZDtcbiAgICAgICAgc2NyaXB0LnNyYyA9IHVybDtcbiAgICAgICAgc2NyaXB0Lm9ubG9hZCA9ICgpID0+IHJlc29sdmUoKTtcbiAgICAgICAgc2NyaXB0Lm9uZXJyb3IgPSAoKSA9PiByZWplY3QobmV3IEVycm9yKGBGYWlsZWQgdG8gbG9hZCBzY3JpcHQ6ICR7dXJsfWApKTtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzY3JpcHQpO1xuICAgIH0pO1xuICAgIGFjdGl2ZUxvYWRlcnNbaWRdID0gcHJvbWlzZTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gaGV4VG9SZ2IoaGV4KSB7XG4gICAgaWYgKCFoZXgpIHJldHVybiBudWxsO1xuICAgIGhleCA9IGhleC5yZXBsYWNlKC9eIy8sICcnKTtcbiAgICBpZiAoaGV4Lmxlbmd0aCA9PT0gMykge1xuICAgICAgICBoZXggPSBoZXguc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIgKyBjaGFyKS5qb2luKCcnKTtcbiAgICB9XG4gICAgaWYgKGhleC5sZW5ndGggIT09IDYpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG51bSA9IHBhcnNlSW50KGhleCwgMTYpO1xuICAgIHJldHVybiB7XG4gICAgICAgIHI6ICgobnVtID4+IDE2KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGc6ICgobnVtID4+IDgpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgYjogKG51bSAmIDI1NSkgLyAyNTVcbiAgICB9O1xufVxuXG5sZXQgY29sb3JQcm9iZSA9IG51bGw7XG5cbi8vIEJyb3dzZXJzIHNoaXAgYSBjb21wbGV0ZSBDU1MgY29sb3IgcGFyc2VyIC0tIGV2ZXJ5IG5hbWVkIGNvbG9yLCByZ2IoKSwgaHNsKCksIGh3YigpLlxuLy8gQm9ycm93IGl0IGluc3RlYWQgb2YgbWFpbnRhaW5pbmcgYSBsb29rdXAgdGFibGUuIFJldHVybnMgbnVsbCBvdXRzaWRlIGEgRE9NIChOb2RlIHRlc3RzKSxcbi8vIHdoZXJlIHRoZSBoZXggZmFsbGJhY2sgaW4gcGFyc2VDb2xvciBzdGlsbCBhcHBsaWVzLlxuZnVuY3Rpb24gY3NzQ29sb3JUb1JnYih2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgZG9jdW1lbnQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsO1xuICAgIGlmICghY29sb3JQcm9iZSkgY29sb3JQcm9iZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjYW52YXNcIikuZ2V0Q29udGV4dChcIjJkXCIpO1xuXG4gICAgLy8gQXNzaWduaW5nIGFuIGludmFsaWQgY29sb3IgbGVhdmVzIGZpbGxTdHlsZSB1bnRvdWNoZWQsIHNvIHByb2JlIGFnYWluc3QgdHdvIGRpZmZlcmVudFxuICAgIC8vIHNlbnRpbmVsczogb25seSBhIHZhbHVlIHRoZSBicm93c2VyIGFjdHVhbGx5IHBhcnNlZCBwcm9kdWNlcyB0aGUgc2FtZSByZXN1bHQgdHdpY2UuXG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiMwMDAwMDBcIjtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xuICAgIGNvbnN0IGZpcnN0ID0gY29sb3JQcm9iZS5maWxsU3R5bGU7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiNmZmZmZmZcIjtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xuICAgIGlmIChmaXJzdCAhPT0gY29sb3JQcm9iZS5maWxsU3R5bGUpIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGZpcnN0LnN0YXJ0c1dpdGgoXCIjXCIpKSByZXR1cm4gaGV4VG9SZ2IoZmlyc3QpO1xuICAgIGNvbnN0IG1hdGNoID0gZmlyc3QubWF0Y2goL3JnYmE/XFwoKFteKV0rKVxcKS8pO1xuICAgIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHBhcnRzID0gbWF0Y2hbMV0uc3BsaXQoXCIsXCIpLm1hcChwID0+IHBhcnNlRmxvYXQocC50cmltKCkpKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMyB8fCBwYXJ0cy5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHI6IHBhcnRzWzBdIC8gMjU1LCBnOiBwYXJ0c1sxXSAvIDI1NSwgYjogcGFydHNbMl0gLyAyNTUgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29sb3IoY29sb3JTdHIsIGZhbGxiYWNrSGV4ID0gXCIjMzM4OGZmXCIpIHtcbiAgICBpZiAoIWNvbG9yU3RyKSBjb2xvclN0ciA9IGZhbGxiYWNrSGV4O1xuICAgIHJldHVybiBjc3NDb2xvclRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBoZXhUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgY3NzQ29sb3JUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgaGV4VG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IHsgcjogMC4yLCBnOiAwLjUsIGI6IDEuMCB9O1xufVxuXG5jb25zdCBVUkxfQVRUUl9CRUZPUkUgPSAvKD86aHJlZnxzcmMpXFxzKj1cXHMqWydcIl0/JC9pO1xuY29uc3QgU0FGRV9VUkwgPSAvXig/Omh0dHBzPzpcXC9cXC98bWFpbHRvOnx0ZWw6fGRhdGE6aW1hZ2VcXC98Wy4vIz9dfFtcXHcuLV0rKD86Wy8/I118JCkpL2k7XG5cbi8vIFByb3BlcnR5IHZhbHVlcyBjb21lIGZyb20gdXNlciBkYXRhIGFuZCBlbmQgdXAgaW4gaW5uZXJIVE1MLCBzbyB0aGV5IGFyZSBlc2NhcGVkLlxuLy8gTWFya3VwIHRoZSBhcHAgYXV0aG9yIHdyb3RlICh0ZW1wbGF0ZXMsIHN0eWxlIHN0cmluZ3MpIGlzIGxlZnQgaW50YWN0LlxuZXhwb3J0IGZ1bmN0aW9uIGVzY2FwZUh0bWwodmFsdWUpIHtcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlKVxuICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXG4gICAgICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxuICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcbiAgICAgICAgLnJlcGxhY2UoL1wiL2csIFwiJnF1b3Q7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8nL2csIFwiJiMzOTtcIik7XG59XG5cbi8vIEVzY2FwaW5nIHN0b3BzIGF0dHJpYnV0ZSBicmVha291dCBidXQgbm90IFwiamF2YXNjcmlwdDpcIiBpbiBhbiBocmVmLCBzbyB2YWx1ZXMgbGFuZGluZ1xuLy8gaW4gYSBVUkwgYXR0cmlidXRlIGdldCBhIHNjaGVtZSBjaGVjay4gQ29udHJvbCBjaGFyYWN0ZXJzIGFyZSBzdHJpcHBlZCBmaXJzdCBiZWNhdXNlXG4vLyBcImphdmFcXHRzY3JpcHQ6XCIgc3Vydml2ZXMgYSBuYWl2ZSBjb21wYXJpc29uLlxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVVcmwodmFsdWUpIHtcbiAgICBjb25zdCBjb2xsYXBzZWQgPSBTdHJpbmcodmFsdWUpLnNwbGl0KFwiXCIpLmZpbHRlcihjID0+IGMuY2hhckNvZGVBdCgwKSA+IDMyKS5qb2luKFwiXCIpO1xuICAgIHJldHVybiBTQUZFX1VSTC50ZXN0KGNvbGxhcHNlZCkgPyBTdHJpbmcodmFsdWUpIDogXCJcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XG4gICAgY29uc3QgdGFyZ2V0RmllbGRzID0gKEFycmF5LmlzQXJyYXkoZmllbGRzKSAmJiBmaWVsZHMubGVuZ3RoKSA/IGZpZWxkcyA6IE9iamVjdC5rZXlzKHByb3BzKTtcbiAgICBjb25zdCBsYWJlbHMgPSAoQXJyYXkuaXNBcnJheShuYW1lcykgJiYgbmFtZXMubGVuZ3RoID09PSB0YXJnZXRGaWVsZHMubGVuZ3RoKSA/IG5hbWVzIDogdGFyZ2V0RmllbGRzO1xuICAgIGNvbnN0IGxpbmVzID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0YXJnZXRGaWVsZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgZiA9IHRhcmdldEZpZWxkc1tpXTtcbiAgICAgICAgaWYgKHByb3BzW2ZdID09PSB1bmRlZmluZWQgfHwgcHJvcHNbZl0gPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgICBsaW5lcy5wdXNoKGA8Yj4ke2VzY2FwZUh0bWwobGFiZWxzW2ldKX08L2I+OiAke2VzY2FwZUh0bWwocHJvcHNbZl0pfWApO1xuICAgIH1cbiAgICByZXR1cm4gbGluZXMuam9pbihcIjxicj5cIik7XG59XG5cbi8vIFwie2NvbHVtbn1cIiBpbnNlcnRzIG9uZSBlc2NhcGVkIHZhbHVlOyBcInsqfVwiIGluc2VydHMgdGhlIGRlZmF1bHQgZmllbGQgbGlzdC5cbmZ1bmN0aW9uIHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIHJldHVybiB0ZW1wbGF0ZS5yZXBsYWNlKC9cXHsoXFwqfFxcdyspXFx9L2csIChtYXRjaCwga2V5LCBvZmZzZXQpID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCIqXCIpIHtcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdmFsID0gcHJvcHNba2V5XTtcbiAgICAgICAgaWYgKHZhbCA9PT0gdW5kZWZpbmVkIHx8IHZhbCA9PT0gbnVsbCkgcmV0dXJuIFwiXCI7XG4gICAgICAgIGNvbnN0IHByZWNlZGluZyA9IHRlbXBsYXRlLnNsaWNlKE1hdGgubWF4KDAsIG9mZnNldCAtIDE2KSwgb2Zmc2V0KTtcbiAgICAgICAgcmV0dXJuIGVzY2FwZUh0bWwoVVJMX0FUVFJfQkVGT1JFLnRlc3QocHJlY2VkaW5nKSA/IHNhZmVVcmwodmFsKSA6IHZhbCk7XG4gICAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwga2luZCkge1xuICAgIGNvbnN0IHRlbXBsYXRlID0gbGF5ZXJba2luZCArIFwiX3RlbXBsYXRlXCJdO1xuICAgIGNvbnN0IGZpZWxkcyA9IGxheWVyW2tpbmQgKyBcIl9maWVsZHNcIl07XG4gICAgY29uc3QgbmFtZXMgPSBsYXllcltraW5kICsgXCJfbmFtZXNcIl07XG4gICAgaWYgKHR5cGVvZiB0ZW1wbGF0ZSA9PT0gXCJzdHJpbmdcIiAmJiB0ZW1wbGF0ZSkge1xuICAgICAgICByZXR1cm4gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICB9XG4gICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbn1cblxuZnVuY3Rpb24gd3JhcFN0eWxlZChodG1sLCBzdHlsZSkge1xuICAgIGlmICghc3R5bGUpIHJldHVybiBodG1sO1xuICAgIHJldHVybiBgPGRpdiBzdHlsZT1cIiR7ZXNjYXBlSHRtbChzdHlsZSl9XCI+JHtodG1sfTwvZGl2PmA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kUG9wdXAobWFwLCBsYXRsbmcsIHByb3BzLCBsYXllcikge1xuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJwb3B1cFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfcG9wdXAgfHwgbGF5ZXIucG9wdXBfZmllbGRzIHx8IGxheWVyLnBvcHVwX3RlbXBsYXRlKSkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge307XG4gICAgICAgIGlmIChsYXllci5wb3B1cF9tYXhfd2lkdGgpIG9wdGlvbnMubWF4V2lkdGggPSBsYXllci5wb3B1cF9tYXhfd2lkdGg7XG4gICAgICAgIEwucG9wdXAob3B0aW9ucylcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci5wb3B1cF9zdHlsZSkpXG4gICAgICAgICAgICAub3Blbk9uKG1hcCk7XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFRvb2x0aXAobWFwLCBsYXRsbmcsIHByb3BzLCBsYXllciwgbGF5ZXJJbnN0YW5jZSkge1xuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJ0b29sdGlwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF90b29sdGlwIHx8IGxheWVyLnRvb2x0aXBfZmllbGRzIHx8IGxheWVyLnRvb2x0aXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGlmICghbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcCA9IEwudG9vbHRpcCh7IGRpcmVjdGlvbjogJ3RvcCcsIG9mZnNldDogWzAsIC01XSB9KTtcbiAgICAgICAgfVxuICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIudG9vbHRpcF9zdHlsZSkpXG4gICAgICAgICAgICAuYWRkVG8obWFwKTtcbiAgICB9XG59XG4iLCAiLy8gRm9sZGVyIGNvbGxhcHNlIHN0YXRlLCBQRVIgU0lERUJBUi4gSXQgdXNlZCB0byBiZSBvbmUgbW9kdWxlLWxldmVsIG9iamVjdCwgc29cclxuLy8gdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmVkIGl0IC0tIGNvbGxhcHNpbmcgYSBmb2xkZXIgaW4gb25lIGNvbGxhcHNlZCBpdCBpblxyXG4vLyB0aGUgb3RoZXIuIEtleWVkIGJ5IHRoZSBjb250YWluZXIgZWxlbWVudCwgZXhhY3RseSBhcyB0aGUgbGVnZW5kIGtlZXBzIGl0cyBvd25cclxuLy8gY29sbGFwc2Ugc3RhdGUgKDNiOWM5NmMpLCBhbmQgc3Vydml2aW5nIHRoZSBmdWxsIHJlLXJlbmRlciBldmVyeSBzeW5jIHBlcmZvcm1zLlxyXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2lkZWJhckNvbGxhcHNlU3RhdGUoY29udGFpbmVyKSB7XHJcbiAgICBsZXQgc3RhdGUgPSBjb2xsYXBzZWRCeUNvbnRhaW5lci5nZXQoY29udGFpbmVyKTtcclxuICAgIGlmICghc3RhdGUpIHtcclxuICAgICAgICBzdGF0ZSA9IHt9O1xyXG4gICAgICAgIGNvbGxhcHNlZEJ5Q29udGFpbmVyLnNldChjb250YWluZXIsIHN0YXRlKTtcclxuICAgIH1cclxuICAgIHJldHVybiBzdGF0ZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldExheWVyQm91bmRzKGwsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICBpZiAoIWwpIHJldHVybiBudWxsO1xyXG5cclxuICAgIC8vIFN1cHBvcnQgZm9sZGVyIHRyZWUgbm9kZXMgKGdyb3VwcyBpbiBzaWRlYmFyIHRyZWUpXHJcbiAgICBpZiAobC5pc0dyb3VwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGRyZW4gZ3JvdXBzXHJcbiAgICAgICAgT2JqZWN0LmtleXMobC5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobC5jaGlsZHJlbltrZXldLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkIGxheWVyc1xyXG4gICAgICAgIGwubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGx5ciwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobC5ib3VuZHMgJiYgbC5ib3VuZHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHJldHVybiBsLmJvdW5kcztcclxuICAgIH1cclxuICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsLmxheWVycykge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhzdWIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGwubG9jYXRpb25zICYmIGwubG9jYXRpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBjb25zdCBjb29yZHMgPSBsLmxvY2F0aW9ucy5mbGF0KEluZmluaXR5KTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBjb25zdCBsYXQgPSBjb29yZHNbaV07XHJcbiAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICsgMV07XHJcbiAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobG9uIDwgbWluTG9uKSBtaW5Mb24gPSBsb247XHJcbiAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgICAgICBjb25zdCBidWYgPSBjb29yZGluYXRlQnVmZmVyc1tsLmlkXTtcclxuICAgICAgICBpZiAoYnVmKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoYnVmLmJ1ZmZlciwgYnVmLmJ5dGVPZmZzZXQsIGJ1Zi5ieXRlTGVuZ3RoIC8gOCk7XHJcbiAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoIC8gMjsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsYXQgPSBjb29yZHNbaSAqIDJdO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKiAyICsgMV07XHJcbiAgICAgICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICBpZiAobG9uIDwgbWluTG9uKSBtaW5Mb24gPSBsb247XHJcbiAgICAgICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gVGhlIHdyaXRlIGhhbGYgb2YgYSB2aXNpYmlsaXR5IHRvZ2dsZTogb25lIGN1c3RvbSBtZXNzYWdlIG5hbWluZyB0aGUgZmxpcHBlZCBpZHMsXHJcbi8vIGluc3RlYWQgb2YgdGhlIHdob2xlIGxheWVycyB0cmFpdC4gUHl0aG9uIGFwcGxpZXMgdGhlIGZpZWxkcyBhbmQgcmUtZW1pdHMgdGhlbSBhc1xyXG4vLyBgc2V0YCBwYXRjaCBvcHMsIHdoaWNoIGlzIGhvdyBvdGhlciB2aWV3cyBvZiB0aGUgc2FtZSBtYXAgKG5vdGVib29rIG91dHB1dHMpIHN0YXlcclxuLy8gaW4gc3RlcCBub3cgdGhhdCB0aGUgdHJhaXQgbm8gbG9uZ2VyIGNhcnJpZXMgdG9nZ2xlcy5cclxuLy8gYGNvbGxhcHNlZFBhdGhzYCBpcyB0aGUgY2FsbGluZyBzaWRlYmFyJ3Mgb3duIHN0YXRlIChzaWRlYmFyQ29sbGFwc2VTdGF0ZSksIHNvXHJcbi8vIGEgcmFkaW8gZ3JvdXAncyBhdXRvLWNvbGxhcHNlIGxhbmRzIG9uIHRoYXQgc2lkZWJhciBhbG9uZS5cclxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzLCBjb2xsYXBzZWRQYXRocyA9IHt9KSB7XHJcbiAgICBjb25zdCB0cmVlID0geyBuYW1lOiBcIlJvb3RcIiwgcGF0aDogXCJcIiwgY2hpbGRyZW46IHt9LCBsYXllcnM6IFtdLCBpc0dyb3VwOiB0cnVlIH07XHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcbiAgICBsYXllcnMuZm9yRWFjaChsID0+IHtcclxuICAgICAgICBjb25zdCBwYXRoU3RyID0gbC5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiO1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gcGF0aFN0ci5zcGxpdChcIi9cIik7XHJcbiAgICAgICAgbGV0IGN1cnIgPSB0cmVlO1xyXG4gICAgICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XHJcbiAgICAgICAgcGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcclxuICAgICAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XHJcbiAgICAgICAgICAgIGlmICghY3Vyci5jaGlsZHJlbltwYXJ0XSkge1xyXG4gICAgICAgICAgICAgICAgY3Vyci5jaGlsZHJlbltwYXJ0XSA9IHtcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LFxyXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHJ1bm5pbmdQYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiB7fSxcclxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IFtdLFxyXG4gICAgICAgICAgICAgICAgICAgIGlzR3JvdXA6IHRydWVcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY3VyciA9IGN1cnIuY2hpbGRyZW5bcGFydF07XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY3Vyci5sYXllcnMucHVzaChsKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJlcG9ydHMgd2hhdCBpdCBjaGFuZ2VkIC0tIHtjaGFuZ2VzOiBbe2lkLCB2aXNpYmxlfV0sIGdyb3Vwc0NoYW5nZWR9IC0tIHNvIHRoZVxyXG4gICAgLy8gY2FsbGVyIGNhbiB3cml0ZSBiYWNrIGV4YWN0bHkgdGhvc2UgZmxpcHMgcmF0aGVyIHRoYW4gdGhlIHdob2xlIGxheWVycyBsaXN0LlxyXG4gICAgY29uc3QgY2hhbmdlcyA9IFtdO1xyXG4gICAgbGV0IGdyb3Vwc0NoYW5nZWQgPSBmYWxzZTtcclxuICAgIGZ1bmN0aW9uIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZSkge1xyXG4gICAgICAgIGNvbnN0IGNvbmYgPSBncm91cENvbmZpZ3Nbbm9kZS5wYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzUmFkaW9Hcm91cCA9IGNvbmYubXVsdGlfc2VsZWN0ID09PSBmYWxzZTtcclxuICAgICAgICBpZiAoaXNSYWRpb0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxldCBmb3VuZEFjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjaGlsZEdyb3VwID0gbm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdID0geyB2aXNpYmxlOiB0cnVlLCBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZEFjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cHNDaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZEFjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbm9kZS5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gbHlyLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZEFjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBseXIudmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VzLnB1c2goeyBpZDogbHlyLmlkLCB2aXNpYmxlOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZEFjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUuY2hpbGRyZW5ba2V5XSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKHRyZWUpO1xyXG4gICAgcmV0dXJuIHsgY2hhbmdlcywgZ3JvdXBzQ2hhbmdlZCB9O1xyXG59XHJcblxyXG4vLyBgY3R4YCBpcyB3aGF0IHRoZSBzaWRlYmFyIG5lZWRzIGZyb20gaXRzIGhvc3QsIGhhbmRlZCBpbiByYXRoZXIgdGhhbiByZWFjaGVkIGZvcjpcclxuLy8gICBncm91cENvbmZpZ3MgICAgICAgICAgIHRoZSBmb2xkZXIgZmxhZ3MgKG11dGF0ZWQgaW4gcGxhY2UgYXMgdGhlIHRyZWUgdG9nZ2xlcylcclxuLy8gICBjb29yZGluYXRlQnVmZmVycyAgICAgIHRoZSBsaXZlIGJ1ZmZlciBtYXAsIGZvciBmaXR0aW5nIGEgdG9nZ2xlZCBub2RlXHJcbi8vICAgb25MYXllcldyaXRlKGNoYW5nZXMpICB0YXJnZXRlZCB2aXNpYmlsaXR5IGZsaXBzIHRvIHNlbmQgb25cclxuLy8gICBvbkdyb3VwQ29uZmlnc0NoYW5nZShncm91cENvbmZpZ3MpICB0aGUgZm9sZGVyIGZsYWdzIHRvIGNvbW1pdFxyXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgY3R4LCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG5cclxuICAgIGNvbnN0IGNvbGxhcHNlZFBhdGhzID0gc2lkZWJhckNvbGxhcHNlU3RhdGUoc2lkZWJhcik7XHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSAoY3R4ICYmIGN0eC5ncm91cENvbmZpZ3MpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZsaXBwZWQgb24gdGhlIGxpc3QgdGhpcyBzaWRlYmFyIHJlbmRlcmVkIGZyb20sIG5ldmVyIG1vZGVsLmdldChcImxheWVyc1wiKS5cclxuICAgICAgICAgICAgICAgIC8vIExheWVycyBhZGRlZCBhZnRlciB0aGUgd2lkZ2V0IGlzIGRpc3BsYXllZCBhcnJpdmUgYXMgcGF0Y2hlcyB0aGF0IHVwZGF0ZSB0aGVcclxuICAgICAgICAgICAgICAgIC8vIGZyb250ZW5kJ3MgbG9jYWwgc3RhdGUgd2l0aG91dCB0b3VjaGluZyB0aGUgdHJhaXQsIHNvIHRoZSBtb2RlbCdzIGNvcHkgaXNcclxuICAgICAgICAgICAgICAgIC8vIGZyb3plbiBhdCB3aGF0ZXZlciB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGNhcnJpZWQuIEJ1aWxkaW5nIHRoZSB1cGRhdGUgZnJvbVxyXG4gICAgICAgICAgICAgICAgLy8gaXQgZHJvcHMgZXZlcnkgbGF0ZXIgbGF5ZXI6IHRoZSB0b2dnbGUgbWF0Y2hlcyBubyBpZCwgd3JpdGVzIHRoZSBzdGFsZSBsaXN0XHJcbiAgICAgICAgICAgICAgICAvLyBiYWNrLCBhbmQgdGhlIGNoYW5nZSBoYW5kbGVyIHRoZW4gcmVzZXRzIGxvY2FsIHN0YXRlIHRvIGl0IC0tIHNvIHRoZSBib3hcclxuICAgICAgICAgICAgICAgIC8vIHJlLWNoZWNrcyBpdHNlbGYgYW5kIHRoZSBsYXllciBuZXZlciBoaWRlcy5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgZmxpcHMgbXV0YXRlIHRoZSByZW5kZXJlZCBsaXN0IGluIHBsYWNlIGFuZCByZWFjaCBQeXRob24gYXMgYSB0YXJnZXRlZFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUgKHNlbmRMYXllcldyaXRlKSwgbmV2ZXIgYnkgc2V0dGluZyB0aGUgbGF5ZXJzIHRyYWl0OiB0aGUgZnVsbFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUtYmFjayBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlIGNsaWNrLiBBdCAyNSB0cmFja3MgeCAyMDBrXHJcbiAgICAgICAgICAgICAgICAvLyB2ZXJ0aWNlcyBpdCB3YXMgYSAzNiBNQiBmcmFtZSAtLSBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0IHdlYnNvY2tldFxyXG4gICAgICAgICAgICAgICAgLy8gY2FwLCBzbyB0aGUgc2VydmVyIGNsb3NlZCB0aGUgY29ubmVjdGlvbiBhbmQgdGhlIFNoaW55IHNlc3Npb24gZGllZCBvblxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGNoZWNrYm94LiBTZXR0aW5nIHRoZSB0cmFpdCB3aXRob3V0IHNhdmluZyBpcyBqdXN0IGFzIGZhdGFsOlxyXG4gICAgICAgICAgICAgICAgLy8gaXQgc3RheXMgZGlydHkgYW5kIHRoZSBuZXh0IHNhdmVfY2hhbmdlcyAoYW55IHBhbikgZmx1c2hlcyBpdC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZsaXAgPSAobHlyLCB2aXNpYmxlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKChseXIudmlzaWJsZSAhPT0gZmFsc2UpID09PSB2aXNpYmxlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSB2aXNpYmxlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGUgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGlvIGJ1dHRvbiBsb2dpYzogc2V0IGFsbCBzaWJsaW5ncyB0byB2aXNpYmxlPWZhbHNlLCBhbmQgdGhpcyB0byB2aXNpYmxlPXRydWVcclxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYkdyb3VwID0gcGFyZW50Tm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBzaWJHcm91cC5wYXRoID09PSBwYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbc2liR3JvdXAucGF0aF0gPSAhYWN0aXZlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IGZsaXAoc2liTHlyLCBzaWJMeXIuaWQgPT09IGlkKSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3BhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBseXIgPSBsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGx5cikgZmxpcChseXIsIGlzQ2hlY2tlZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChjdHggJiYgY3R4Lm9uTGF5ZXJXcml0ZSkgY3R4Lm9uTGF5ZXJXcml0ZShjaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIGlmIChjdHggJiYgY3R4Lm9uR3JvdXBDb25maWdzQ2hhbmdlKSBjdHgub25Hcm91cENvbmZpZ3NDaGFuZ2UoZ3JvdXBDb25maWdzKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldExheWVyQm91bmRzKG5vZGUsIChjdHggJiYgY3R4LmNvb3JkaW5hdGVCdWZmZXJzKSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb25MYXllclRvZ2dsZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcmVudEVsLmFwcGVuZENoaWxkKG5vZGVEaXYpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbmRlciB0cmVlIGZyb20gcm9vdCBub2RlXHJcbiAgICByZW5kZXJOb2RlKHRyZWUsIHNpZGViYXIsIDAsIG51bGwsIHRydWUpO1xyXG59XHJcbiIsICIvLyBMYXllci1zdGF0ZSBmdW5jdGlvbnM6IHZpc2liaWxpdHksIGJ1Y2tldGluZywgYW5kIHBhdGNoIGFwcGxpY2F0aW9uLlxuLy9cbi8vIFB1cmUgZGF0YSBpbiwgZGF0YSBvdXQgLS0gbm8gbWFwLCBubyBET00sIG5vIGhvc3QuIFRoaXMgaXMgdGhlIHBhcnQgb2YgdGhlIGNvcmVcbi8vIHRoYXQgZXZlcnkgY29uc3VtZXIgc2hhcmVzIHZlcmJhdGltOiB0aGUgYW55d2lkZ2V0IHdpZGdldCwgYSBzdGF0aWMgZXhwb3J0IGFuZCBhXG4vLyBSZWFjdCBhcHAgYWxsIGFwcGx5IHRoZSBzYW1lIHBhdGNoIG9wcyB0byB0aGUgc2FtZSB7bGF5ZXJzLCBidWZmZXJzfSBzdGF0ZS5cblxuLy8gVHJ1ZSBpZiBhIGxheWVyIGlzIHZpc2libGUgYW5kIG5vIGZvbGRlciBhYm92ZSBpdCBpcyBzd2l0Y2hlZCBvZmYuXG4vL1xuLy8gVmlzaWJpbGl0eSBpcyBpbmhlcml0ZWQgZG93biB0aGUgZm9sZGVyIHBhdGg6IGEgbGF5ZXIgaW5zaWRlIFwiRmVlZHMvQWN0aXZlXCIgaXMgaGlkZGVuXG4vLyB3aGVuIGVpdGhlciBcIkZlZWRzXCIgb3IgXCJGZWVkcy9BY3RpdmVcIiBpcyBvZmYsIHJlZ2FyZGxlc3Mgb2YgaXRzIG93biBmbGFnLiBHZXR0aW5nIHRoaXNcbi8vIHdyb25nIHNob3dzIHVwIGFzIFwidGhhdCBsYXllciBqdXN0IHdpbGwgbm90IGFwcGVhclwiLCB3aXRoIG5vdGhpbmcgbG9nZ2VkLlxuZXhwb3J0IGZ1bmN0aW9uIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpIHtcbiAgICBpZiAobGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xuICAgIGZvciAoY29uc3QgcGFydCBvZiAobGF5ZXIubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIikuc3BsaXQoXCIvXCIpKSB7XG4gICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xuICAgICAgICBjb25zdCBjb25maWcgPSBncm91cENvbmZpZ3NbcnVubmluZ1BhdGhdO1xuICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gU29ydHMgdGhlIHZpc2libGUgbGF5ZXJzIGludG8gb25lIGJ1Y2tldCBwZXIgV2ViR0wgZHJhdyBwYXNzLlxuLy9cbi8vIFN1Yi1sYXllcnMgb2YgYSBtZXJnZWQgZ3JvdXAgaW5oZXJpdCB0aGVpciBwYXJlbnQncyB2aXNpYmlsaXR5IHJhdGhlciB0aGFuIGNhcnJ5aW5nXG4vLyB0aGVpciBvd24sIHNvIGEgZ3JvdXAgdG9nZ2xlZCBvZmYgY29udHJpYnV0ZXMgbm90aGluZyBldmVuIHdoZW4gaXRzIGNoaWxkcmVuIHNheVxuLy8gdmlzaWJsZS4gQ2lyY2xlcyBqb2luIHRoZSBwb2x5Z29uIGJ1Y2tldDogdGhleSBhcmUgZHJhd24gYXMgZ2VuZXJhdGVkIHJpbmdzLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xuICAgIGNvbnN0IGJ1Y2tldHMgPSB7IGNpcmNsZV9tYXJrZXJzOiBbXSwgbWFya2VyczogW10sIHBvbHlsaW5lOiBbXSwgcG9seWdvbjogW10gfTtcblxuICAgIGZ1bmN0aW9uIGNvbGxlY3QobGF5ZXIsIHBhcmVudFZpc2libGUsIGlzU3ViTGF5ZXIpIHtcbiAgICAgICAgaWYgKCFwYXJlbnRWaXNpYmxlKSByZXR1cm47XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gY29sbGVjdChzdWIsIHBhcmVudFZpc2libGUsIHRydWUpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWlzU3ViTGF5ZXIgJiYgbGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybjtcblxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xuICAgICAgICBpZiAoYnVja2V0c1tidWNrZXRdKSBidWNrZXRzW2J1Y2tldF0ucHVzaChsYXllcik7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgY29sbGVjdChsYXllciwgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyksIGZhbHNlKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ1Y2tldHM7XG59XG5cbi8vIEFwcGxpZXMgaW5jcmVtZW50YWwgcGF0Y2ggb3BzIHRvIHtsYXllcnMsIGJ1ZmZlcnN9LCByZXR1cm5pbmcgdGhlIG5ldyBzdGF0ZS5cbi8vXG4vLyBPcHMgYXJlIGFkZHJlc3NlZCBieSBsYXllciBpZCBhbmQgYXBwbGllZCBpZGVtcG90ZW50bHk6IFwiYWRkXCIgdXBzZXJ0cyByYXRoZXIgdGhhblxuLy8gYXBwZW5kaW5nIGJsaW5kbHksIHNvIGEgcGF0Y2ggdGhhdCByYWNlcyB0aGUgaW5pdGlhbCB0cmFpdCBzbmFwc2hvdCBjYW5ub3QgZHVwbGljYXRlXG4vLyBhIGxheWVyLCBhbmQgYSBcInJlbW92ZVwiIGZvciBzb21ldGhpbmcgYWxyZWFkeSBnb25lIGlzIGEgbm8tb3AuXG4vLyBBcHBsaWVzIGB1cGRhdGVgIHRvIG9uZSBsYXllciB3aGVyZXZlciBpdCBzaXRzLCBkZXNjZW5kaW5nIGludG8gZ3JvdXBzLiBhZGRfY29sbGVjdGlvblxuLy8gbmVzdHMgaXRzIHBvaW50LCBsaW5lIGFuZCBwb2x5Z29uIGxheWVycyBpbnNpZGUgYSBncm91cCBsYXllciwgc28gYW4gb3AgYWRkcmVzc2VkIGF0IGFcbi8vIG5lc3RlZCBpZCB3b3VsZCBvdGhlcndpc2UgbWF0Y2ggbm90aGluZyBhbmQgc2lsZW50bHkgZG8gbm90aGluZy4gUmV0dXJucyB0aGUgb3JpZ2luYWxcbi8vIGFycmF5IHVudG91Y2hlZCB3aGVuIHRoZSBpZCBpcyBub3QgZm91bmQsIHNvIGFuIHVubWF0Y2hlZCBvcCBjb3N0cyBubyByZS1yZW5kZXIuXG5mdW5jdGlvbiB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBpZCwgdXBkYXRlKSB7XG4gICAgbGV0IGhpdCA9IGZhbHNlO1xuICAgIGNvbnN0IG5leHQgPSBsYXllcnMubWFwKGwgPT4ge1xuICAgICAgICBpZiAobC5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgIGhpdCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm4gdXBkYXRlKGwpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBBcnJheS5pc0FycmF5KGwubGF5ZXJzKSkge1xuICAgICAgICAgICAgY29uc3Qgc3VicyA9IHVwZGF0ZUxheWVyQnlJZChsLmxheWVycywgaWQsIHVwZGF0ZSk7XG4gICAgICAgICAgICBpZiAoc3VicyAhPT0gbC5sYXllcnMpIHtcbiAgICAgICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IC4uLmwsIGxheWVyczogc3VicyB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBsO1xuICAgIH0pO1xuICAgIHJldHVybiBoaXQgPyBuZXh0IDogbGF5ZXJzO1xufVxuXG4vLyBFdmVyeSBwb2ludCBsYXllciwgdmlzaWJsZSBvciBub3QsIHdpdGggaXRzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5IHJlY29yZGVkIC0tIHRoZVxuLy8gR1BVLXZpc2liaWxpdHkgcGF0aCBrZWVwcyBoaWRkZW4gbGF5ZXJzIGluIHRoZSBidWNrZXQgKHN0YWJsZSBpZHMsIG5vIHJlYnVpbGQgb24gYVxuLy8gdG9nZ2xlKSBhbmQgaGlkZXMgdGhlbSB3aXRoIGEgdW5pZm9ybSBpbnN0ZWFkLiBNaXJyb3JzIGNvbGxlY3RXZWJnbExheWVycycgcnVsZXM6XG4vLyBzdWItbGF5ZXJzIGluaGVyaXQgdGhlaXIgcGFyZW50J3MgZWZmZWN0aXZlIHZpc2liaWxpdHksIHRvcC1sZXZlbCBsYXllcnMgYW5zd2VyIGZvclxuLy8gdGhlaXIgb3duIGZsYWcgYW5kIHRoZWlyIGZvbGRlciBjaGFpbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0UG9pbnRMYXllcnNBbGwobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcbiAgICBjb25zdCBvdXQgPSB7IGNpcmNsZV9tYXJrZXJzOiBbXSwgbWFya2VyczogW10sIHBvbHlsaW5lOiBbXSwgcG9seWdvbjogW10gfTtcbiAgICBmdW5jdGlvbiB3YWxrKGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1Yikge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgY29uc3Qgc2VsZlZpcyA9IHBhcmVudFZpc2libGUgJiYgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gd2FsayhzdWIsIHNlbGZWaXMsIHRydWUpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xuICAgICAgICBpZiAoIW91dFtidWNrZXRdKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHZpcyA9IGlzU3ViID8gcGFyZW50VmlzaWJsZVxuICAgICAgICAgICAgOiBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICBvdXRbYnVja2V0XS5wdXNoKHsgbGF5ZXIsIHZpcyB9KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHdhbGsobGF5ZXIsIHRydWUsIGZhbHNlKTtcbiAgICByZXR1cm4gb3V0O1xufVxuXG4vLyBCdWZmZXIgaWRlbnRpdHkgZm9yIHRoZSBHTCBtZXRhIGtleS4gQSBuZXcgRGF0YVZpZXcgdW5kZXIgYSBsYXllciBpZCAtLSBhXG4vLyBidWZmZXIgb3AgZnJvbSB1cGRhdGVfbGF5ZXIoZGF0YT0uLi4pLCBvciB0aGUgdHJhaXQgcmVzZWVkZWQgLS0gbXVzdCByZWJ1aWxkXG4vLyB0aGUgYnVja2V0IGV2ZW4gd2hlbiB0aGUgYnl0ZSBsZW5ndGggaXMgdW5jaGFuZ2VkIChwb2ludHMgbW92ZWQsIGNvbG91cnNcbi8vIHJlY29tcHV0ZWQpLiBUaGUgc2VyaWFsIGlzIHBlciBvYmplY3QsIHNvIGFuIHVudG91Y2hlZCBidWZmZXIga2VlcHMgaXRzIG51bWJlclxuLy8gYW5kIGNvc3RzIG5vIHJlYnVpbGQuIFdvcmtzIGZvciBhbnkgY29uc3VtZXIgdGhhdCBzd2FwcyBhIGJ1ZmZlciwgUHl0aG9uIG9yIG5vdC5cbmNvbnN0IGJ1ZmZlclNlcmlhbHMgPSBuZXcgV2Vha01hcCgpO1xubGV0IG5leHRCdWZmZXJTZXJpYWwgPSAxO1xuZXhwb3J0IGZ1bmN0aW9uIGJ1ZmZlclNlcmlhbChidWYpIHtcbiAgICBpZiAoIWJ1ZiB8fCB0eXBlb2YgYnVmICE9PSBcIm9iamVjdFwiKSByZXR1cm4gMDtcbiAgICBsZXQgc2VyaWFsID0gYnVmZmVyU2VyaWFscy5nZXQoYnVmKTtcbiAgICBpZiAoIXNlcmlhbCkge1xuICAgICAgICBzZXJpYWwgPSBuZXh0QnVmZmVyU2VyaWFsKys7XG4gICAgICAgIGJ1ZmZlclNlcmlhbHMuc2V0KGJ1Ziwgc2VyaWFsKTtcbiAgICB9XG4gICAgcmV0dXJuIHNlcmlhbDtcbn1cblxuZnVuY3Rpb24gY29uY2F0Vmlld3MoaGVhZCwgdGFpbCkge1xuICAgIGNvbnN0IG91dCA9IG5ldyBVaW50OEFycmF5KGhlYWQuYnl0ZUxlbmd0aCArIHRhaWwuYnl0ZUxlbmd0aCk7XG4gICAgb3V0LnNldChuZXcgVWludDhBcnJheShoZWFkLmJ1ZmZlciwgaGVhZC5ieXRlT2Zmc2V0LCBoZWFkLmJ5dGVMZW5ndGgpLCAwKTtcbiAgICBvdXQuc2V0KG5ldyBVaW50OEFycmF5KHRhaWwuYnVmZmVyLCB0YWlsLmJ5dGVPZmZzZXQsIHRhaWwuYnl0ZUxlbmd0aCksIGhlYWQuYnl0ZUxlbmd0aCk7XG4gICAgcmV0dXJuIG5ldyBEYXRhVmlldyhvdXQuYnVmZmVyKTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kUm93cyhsYXllciwgb3ApIHtcbiAgICBjb25zdCBiYXNlID0gb3AuYmFzZSB8fCAwO1xuICAgIGNvbnN0IGNvdW50ID0gb3AuY291bnQgfHwgMDtcbiAgICBjb25zdCBpbmNvbWluZyA9IG9wLnByb3BlcnRpZXMgfHwge307XG4gICAgY29uc3QgcHJvcHMgPSB7IC4uLihsYXllci5wcm9wZXJ0aWVzIHx8IHt9KSB9O1xuICAgIGZvciAoY29uc3Qga2V5IG9mIG5ldyBTZXQoWy4uLk9iamVjdC5rZXlzKHByb3BzKSwgLi4uT2JqZWN0LmtleXMoaW5jb21pbmcpXSkpIHtcbiAgICAgICAgY29uc3QgaGVhZCA9IEFycmF5LmlzQXJyYXkocHJvcHNba2V5XSkgPyBwcm9wc1trZXldXG4gICAgICAgICAgICA6IG5ldyBBcnJheShiYXNlKS5maWxsKHByb3BzW2tleV0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcm9wc1trZXldKTtcbiAgICAgICAgY29uc3QgdGFpbCA9IEFycmF5LmlzQXJyYXkoaW5jb21pbmdba2V5XSkgPyBpbmNvbWluZ1trZXldIDogbmV3IEFycmF5KGNvdW50KS5maWxsKG51bGwpO1xuICAgICAgICBwcm9wc1trZXldID0gaGVhZC5jb25jYXQodGFpbCk7XG4gICAgfVxuICAgIGNvbnN0IG5leHQgPSB7IC4uLmxheWVyLCBwcm9wZXJ0aWVzOiBwcm9wcyB9O1xuICAgIGZvciAoY29uc3QgW2ZpZWxkLCB0YWlsXSBvZiBPYmplY3QuZW50cmllcyhvcC5saXN0cyB8fCB7fSkpIHtcbiAgICAgICAgbmV4dFtmaWVsZF0gPSAoQXJyYXkuaXNBcnJheShsYXllcltmaWVsZF0pID8gbGF5ZXJbZmllbGRdIDogW10pLmNvbmNhdCh0YWlsKTtcbiAgICB9XG4gICAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVN3aWZ0bWFwUGF0Y2goc3RhdGUsIG9wcywgYnVmZmVycykge1xuICAgIGxldCBsYXllcnMgPSBzdGF0ZS5sYXllcnMgfHwgW107XG4gICAgbGV0IGJ1ZmZlck1hcCA9IHN0YXRlLmJ1ZmZlcnMgfHwge307XG5cbiAgICBmb3IgKGNvbnN0IG9wIG9mIG9wcykge1xuICAgICAgICBpZiAob3Aub3AgPT09IFwic25hcHNob3RcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gb3AubGF5ZXJzIHx8IFtdO1xuICAgICAgICAgICAgYnVmZmVyTWFwID0ge307XG4gICAgICAgICAgICAob3AuYnVmZmVyX2lkcyB8fCBbXSkuZm9yRWFjaCgoaWQsIGkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoYnVmZmVycyAmJiBidWZmZXJzW2ldKSBidWZmZXJNYXBbaWRdID0gYnVmZmVyc1tpXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImFkZFwiIHx8IG9wLm9wID09PSBcInJlcGxhY2VcIikge1xuICAgICAgICAgICAgY29uc3QgaW5jb21pbmcgPSBvcC5sYXllcjtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gaW5jb21pbmcgPyBpbmNvbWluZy5pZCA6IG9wLmlkO1xuICAgICAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJzLmZpbmRJbmRleChsID0+IGwuaWQgPT09IGlkKTtcbiAgICAgICAgICAgIGlmIChpZHggPT09IC0xKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gWy4uLmxheWVycywgaW5jb21pbmddO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBsYXllcnMubWFwKChsLCBpKSA9PiAoaSA9PT0gaWR4ID8gaW5jb21pbmcgOiBsKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic2V0XCIpIHtcbiAgICAgICAgICAgIC8vIEZpZWxkLWxldmVsIHVwZGF0ZS4gXCJyZXBsYWNlXCIgY2FycmllcyB0aGUgd2hvbGUgbGF5ZXIsIHNvIGZsaXBwaW5nIGB2aXNpYmxlYFxuICAgICAgICAgICAgLy8gb24gYSA1MGstcG9pbnQgbGF5ZXIgcmVzZW50IGV2ZXJ5IHByb3BlcnR5IGl0IGhvbGRzIC0tIGhhbGYgYSBtZWdhYnl0ZSB0b1xuICAgICAgICAgICAgLy8gY2hhbmdlIG9uZSBib29sZWFuLCBvbiBldmVyeSBjbGljayBvZiBhIGNoZWNrYm94LlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHsgLi4ubCwgLi4uKG9wLmZpZWxkcyB8fCB7fSkgfSkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInN0eWxlXCIpIHtcbiAgICAgICAgICAgIC8vIFBlci1mZWF0dXJlIHN0eWxlIG92ZXJyaWRlcywgcmVwbGFjZWQgd2hvbGVzYWxlIHJhdGhlciB0aGFuIG1lcmdlZDogYVxuICAgICAgICAgICAgLy8gc2VsZWN0aW9uIGRlc2NyaWJlcyBpdHMgY29tcGxldGUgc3RhdGUsIHNvIHNlbmRpbmcge30gY2xlYXJzIGl0IGFuZCBub1xuICAgICAgICAgICAgLy8gY2FsbGVyIGhhcyB0byB0cmFjayB3aGF0IHRoZSBwcmV2aW91cyBoaWdobGlnaHQgdG91Y2hlZC5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7XG4gICAgICAgICAgICAgICAgLi4ubCwgc3R5bGVfb3ZlcnJpZGVzOiBvcC5vdmVycmlkZXMgfHwge30sXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwicmVtb3ZlXCIpIHtcbiAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5maWx0ZXIobCA9PiBsLmlkICE9PSBvcC5pZCk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGJ1ZiA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tvcC5idWZmZXJfaW5kZXhdO1xuICAgICAgICAgICAgaWYgKGJ1ZikgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAsIFtvcC5pZF06IGJ1ZiB9O1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlcl9hcHBlbmRcIikge1xuICAgICAgICAgICAgLy8gQSB0YWlsIGZvciBhbiBleGlzdGluZyBidWZmZXIgLS0gdGhlIGZlZWQgcHJpbWl0aXZlJ3Mgd2lyZSBzaGFwZSxcbiAgICAgICAgICAgIC8vIHByb3BvcnRpb25hbCB0byB0aGUgYmF0Y2guIENvbmNhdGVuYXRpb24geWllbGRzIGEgTkVXIERhdGFWaWV3LCBhbmRcbiAgICAgICAgICAgIC8vIHRoZSBHTCBtZXRhIGtleSBrZXlzIG9uIGJ1ZmZlciBpZGVudGl0eSwgc28gdGhlIGJ1Y2tldCByZWJ1aWxkcy5cbiAgICAgICAgICAgIGNvbnN0IHRhaWwgPSBidWZmZXJzICYmIGJ1ZmZlcnNbb3AuYnVmZmVyX2luZGV4XTtcbiAgICAgICAgICAgIGlmICh0YWlsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaGVhZCA9IGJ1ZmZlck1hcFtvcC5pZF07XG4gICAgICAgICAgICAgICAgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAsIFtvcC5pZF06IGhlYWQgPyBjb25jYXRWaWV3cyhoZWFkLCB0YWlsKSA6IHRhaWwgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJhcHBlbmRcIikge1xuICAgICAgICAgICAgLy8gTmV3IHJvd3MgZm9yIHRoZSBwcm9wZXJ0eSBsaXN0cyAoYW5kIG90aGVyIHBlci1mZWF0dXJlIGxpc3RzKSwgYWZ0ZXJcbiAgICAgICAgICAgIC8vIHRoZSBleGlzdGluZyBvbmVzLiBDb2x1bW5zIG1pc3Npbmcgb24gZWl0aGVyIHNpZGUgZmlsbCBudWxsLCBleGFjdGx5XG4gICAgICAgICAgICAvLyBhcyB0aGUgUHl0aG9uIHNpZGUgZG9lcywgc28gYSBsYXRlciBwb3B1cCByZWFkcyB0aGUgc2FtZSB0YWJsZS5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+IGFwcGVuZFJvd3MobCwgb3ApKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJfcmVtb3ZlXCIpIHtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwIH07XG4gICAgICAgICAgICBkZWxldGUgYnVmZmVyTWFwW29wLmlkXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7IGxheWVycywgYnVmZmVyczogYnVmZmVyTWFwIH07XG59XG4iLCAiLy8gVGhlIGxlZ2VuZDogZGVyaXZlZCBmcm9tIHRoZSBzYW1lIGxheWVyIHN0YXRlIGV2ZXJ5dGhpbmcgZWxzZSByZW5kZXJzIGZyb20sIHdpdGhcclxuLy8gZGVjbGFyYXRpdmUgb3ZlcnJpZGVzIG9uIHRvcC4gRGVsaWJlcmF0ZWx5IG1vZGVsLWZyZWUgLS0gcHVyZSBkYXRhIGluLCBET00gb3V0IC0tXHJcbi8vIHNvIGEgcGxhaW4tSlMgY29uc3VtZXIgb2YgZGlzdC9pbmRleC5qcyBnZXRzIHRoZSB3aG9sZSBmZWF0dXJlLCBhbmQgdGhlIGFueXdpZGdldFxyXG4vLyBnbHVlIGluIG1hcC5qcyBpcyBhIGZldyBsaW5lcy4gKHNpZGViYXIuanMgc3RpbGwgdGFrZXMgYG1vZGVsYCBhbmQgaXMgZmlsZWQgZm9yXHJcbi8vIGV4dHJhY3Rpb247IHRoaXMgbW9kdWxlIG11c3QgbmV2ZXIgbmVlZCB0aGF0IHVucGlja2luZy4pXHJcbi8vXHJcbi8vIFRoZSBwaXBlbGluZTogZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgY29uZmlnKSB3YWxrcyB0aGUgbGF5ZXJzIGludG9cclxuLy8gZW50cmllcyAoc2tpcHBlZCBlbnRpcmVseSB3aGVuIGNvbmZpZy5hdXRvID09PSBmYWxzZSksIGFwcGxpZXMgdGhlIHBlcnNpc3RlbnRcclxuLy8gcmVtb3ZlLW1hdGNoZXJzLCBhcHBlbmRzIHRoZSBtYW51YWwgYWRkcywgYW5kIHJldHVybnMgYSBzcGVjIHRoYXQgcmVuZGVyTGVnZW5kXHJcbi8vIHR1cm5zIGludG8gRE9NLiBOb3RoaW5nIGhlcmUga25vd3MgYWJvdXQgY29sb3JtYXBzOiByYW1wL2NhdGVnb3J5L2JpbiBlbnRyaWVzXHJcbi8vIGFycml2ZSB3aXRoIHRoZWlyIGNvbG91cnMgYWxyZWFkeSByZXNvbHZlZCAoUHl0aG9uIHJlc29sdmVzIGF0IHRoZSBhZGRfKiBib3VuZGFyeSxcclxuLy8gbWFudWFsIGVudHJpZXMgYXQgbGVnZW5kX2FkZCksIHNvIHRoZXJlIGlzIG5vIGFuY2hvciB0YWJsZSB0byBkcmlmdC5cclxuXHJcbmltcG9ydCB7IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlIH0gZnJvbSBcIi4vcGF0Y2guanNcIjtcclxuXHJcbmNvbnN0IEdMWVBIUyA9IHtcclxuICAgIGNpcmNsZV9tYXJrZXJzOiBcImNpcmNsZVwiLFxyXG4gICAgbWFya2VyczogXCJwaW5cIixcclxuICAgIHBvbHlsaW5lOiBcImxpbmVcIixcclxuICAgIHBvbHlnb246IFwicG9seWdvblwiLFxyXG4gICAgY2lyY2xlOiBcImNpcmNsZVwiLFxyXG59O1xyXG5cclxuZnVuY3Rpb24gc3dhdGNoRW50cnkobGF5ZXIsIGhpZGRlbikge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBraW5kOiBcInN3YXRjaFwiLFxyXG4gICAgICAgIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIixcclxuICAgICAgICBzaGFwZTogR0xZUEhTW2xheWVyLnR5cGVdIHx8IFwic3F1YXJlXCIsXHJcbiAgICAgICAgY29sb3I6IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxyXG4gICAgICAgIGZpbGxDb2xvcjogbGF5ZXIuZmlsbENvbG9yIHx8IGxheWVyLmZpbGxfY29sb3IgfHwgbGF5ZXIuY29sb3IgfHwgXCIjMzM4OGZmXCIsXHJcbiAgICAgICAgaGlkZGVuLFxyXG4gICAgfTtcclxufVxyXG5cclxuLy8gQSBkYXRhLWRyaXZlbiBibG9jayByZWNvcmRlZCBhdCBhZGQgdGltZSAoe2tpbmQsIGFuY2hvcnN8aXRlbXN8ZWRnZXMrY29sb3JzLCAuLi59KVxyXG4vLyBiZWNvbWVzIHRoZSBsYXllcidzIGVudHJ5IGFzLWlzOyB0aGUgbGF5ZXIgb25seSBjb250cmlidXRlcyBsYWJlbCBhbmQgdmlzaWJpbGl0eS5cclxuZnVuY3Rpb24gYmxvY2tFbnRyeShsYXllciwgaGlkZGVuKSB7XHJcbiAgICByZXR1cm4geyAuLi5sYXllci5sZWdlbmQsIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIiwgaGlkZGVuIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzKSB7XHJcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJiYXNlbWFwXCIpIHJldHVybiBbXTtcclxuICAgIGNvbnN0IGhpZGRlbiA9ICFpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICAvLyBBIGNvbGxlY3Rpb246IG9uZSBlbnRyeSBwZXIgZ2VvbWV0cnkgcGFydCwgc2FtZSBsYWJlbCBieSBkZXNpZ24gLS0gdGhlXHJcbiAgICAgICAgLy8gZ2x5cGhzIGFyZSB3aGF0IHRlbGwgdGhlbSBhcGFydCwgbWF0Y2hpbmcgaG93IHRoZSBwYXJ0cyByZW5kZXIuXHJcbiAgICAgICAgcmV0dXJuIChsYXllci5sYXllcnMgfHwgW10pXHJcbiAgICAgICAgICAgIC5maWx0ZXIoc3ViID0+IEdMWVBIU1tzdWIudHlwZV0pXHJcbiAgICAgICAgICAgIC5tYXAoc3ViID0+IHN1Yi5sZWdlbmRcclxuICAgICAgICAgICAgICAgID8gYmxvY2tFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pXHJcbiAgICAgICAgICAgICAgICA6IHN3YXRjaEVudHJ5KHsgLi4uc3ViLCBuYW1lOiBsYXllci5uYW1lIH0sIGhpZGRlbikpO1xyXG4gICAgfVxyXG4gICAgaWYgKCFHTFlQSFNbbGF5ZXIudHlwZV0pIHJldHVybiBbXTtcclxuICAgIGNvbnN0IGVudHJpZXMgPSBbbGF5ZXIubGVnZW5kID8gYmxvY2tFbnRyeShsYXllciwgaGlkZGVuKSA6IHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pXTtcclxuICAgIC8vIHJhZGl1c19jb2wgcmVjb3JkcyBhIHNpemUga2V5IGJlc2lkZSB0aGUgY29sb3VyIHN0b3J5OiBib3RoIGVuY29kaW5ncyBvbiB0aGVcclxuICAgIC8vIG1hcCBkZXNlcnZlIGJvdGggZXhwbGFuYXRpb25zIGluIHRoZSBsZWdlbmQuXHJcbiAgICBpZiAobGF5ZXIubGVnZW5kX3NpemUpIHtcclxuICAgICAgICBlbnRyaWVzLnB1c2goeyAuLi5sYXllci5sZWdlbmRfc2l6ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogbGF5ZXIubGVnZW5kX3NpemUuZmllbGQgfHwgbGF5ZXIubmFtZSB8fCBcIlNpemVcIiwgaGlkZGVuIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGVudHJpZXM7XHJcbn1cclxuXHJcbi8vIElkZW50aWNhbCBkYXRhLWRyaXZlbiBwYXlsb2FkcyBjb2xsYXBzZSBpbnRvIG9uZSByb3cuIEdyb3VwaW5nIHBvaW50cyBieSBhIGNvbHVtblxyXG4vLyBnaXZlcyBldmVyeSBzdWItbGF5ZXIgdGhlIHNhbWUgcmFtcDsgYSByYW1wIHBlciBzdWItbGF5ZXIgaXMgbm9pc2UsIGFuZCB0aGUgZmllbGRcclxuLy8gbmFtZSBpcyB0aGUgaG9uZXN0IGxhYmVsIGZvciB0aGUgc2hhcmVkIG1hcHBpbmcuIFRoZSBzdXJ2aXZvciBrZWVwcyB0aGUgZmlyc3RcclxuLy8gb2NjdXJyZW5jZSdzIHBvc2l0aW9uIGFuZCBoaWRlcyBvbmx5IHdoZW4gZXZlcnkgY29udHJpYnV0b3IgaXMgaGlkZGVuLlxyXG5mdW5jdGlvbiBwYXlsb2FkS2V5KGVudHJ5KSB7XHJcbiAgICAvLyBJZGVudGl0eSBmaWVsZHMgc3RheSBvdXQgb2YgdGhlIGtleTogdGhlIHdob2xlIHBvaW50IGlzIHRoYXQgZW50cmllcyBmcm9tXHJcbiAgICAvLyBESUZGRVJFTlQgbGF5ZXJzIGNvbGxhcHNlIHdoZW4gdGhlaXIgbWFwcGluZyBwYXlsb2FkIGlzIHRoZSBzYW1lLlxyXG4gICAgY29uc3QgeyBsYWJlbCwgaGlkZGVuLCBsYXllcklkLCBsYXllciwgZ3JvdXAsIC4uLnBheWxvYWQgfSA9IGVudHJ5O1xyXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWR1cGVEYXRhRW50cmllcyhncm91cHMpIHtcclxuICAgIGNvbnN0IHNlZW4gPSBuZXcgTWFwKCk7ICAgLy8gcGF5bG9hZCBrZXkgLT4gc3Vydml2aW5nIGVudHJ5XHJcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG4gICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihlbnRyeSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChlbnRyeS5raW5kID09PSBcInN3YXRjaFwiKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGF5bG9hZEtleShlbnRyeSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHN1cnZpdm9yID0gc2Vlbi5nZXQoa2V5KTtcclxuICAgICAgICAgICAgaWYgKCFzdXJ2aXZvcikge1xyXG4gICAgICAgICAgICAgICAgc2Vlbi5zZXQoa2V5LCBlbnRyeSk7XHJcbiAgICAgICAgICAgICAgICBpZiAoZW50cnkuZmllbGQpIGVudHJ5LmxhYmVsID0gZW50cnkuZmllbGQ7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBzdXJ2aXZvci5oaWRkZW4gPSBzdXJ2aXZvci5oaWRkZW4gJiYgZW50cnkuaGlkZGVuO1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZ3JvdXBzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYXRjaGVySGl0cyhtYXRjaGVyLCBlbnRyeSwgZ3JvdXBOYW1lKSB7XHJcbiAgICBpZiAoIW1hdGNoZXIpIHJldHVybiBmYWxzZTtcclxuICAgIGxldCBjb25zdHJhaW5lZCA9IGZhbHNlO1xyXG4gICAgaWYgKG1hdGNoZXIubGFiZWwgIT0gbnVsbCkge1xyXG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAoZW50cnkubGFiZWwgIT09IG1hdGNoZXIubGFiZWwpIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIGlmIChtYXRjaGVyLmdyb3VwICE9IG51bGwpIHtcclxuICAgICAgICBjb25zdHJhaW5lZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKGdyb3VwTmFtZSAhPT0gbWF0Y2hlci5ncm91cCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgaWYgKG1hdGNoZXIuaWQgIT0gbnVsbCkge1xyXG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAoZW50cnkubGF5ZXJJZCAhPT0gbWF0Y2hlci5pZCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvbnN0cmFpbmVkO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgY29uZmlnKSB7XHJcbiAgICBjb25zdCBjZmcgPSBjb25maWcgfHwge307XHJcbiAgICBjb25zdCBncm91cHMgPSBbXTtcclxuICAgIGNvbnN0IGJ5TmFtZSA9IG5ldyBNYXAoKTtcclxuICAgIGNvbnN0IGdyb3VwRm9yID0gbmFtZSA9PiB7XHJcbiAgICAgICAgaWYgKCFieU5hbWUuaGFzKG5hbWUpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwID0geyBuYW1lLCBlbnRyaWVzOiBbXSB9O1xyXG4gICAgICAgICAgICBieU5hbWUuc2V0KG5hbWUsIGdyb3VwKTtcclxuICAgICAgICAgICAgZ3JvdXBzLnB1c2goZ3JvdXApO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gYnlOYW1lLmdldChuYW1lKTtcclxuICAgIH07XHJcblxyXG4gICAgaWYgKGNmZy5hdXRvICE9PSBmYWxzZSkge1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzIHx8IFtdKSB7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllc0ZvckxheWVyKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSB7XHJcbiAgICAgICAgICAgICAgICBlbnRyeS5sYXllcklkID0gbGF5ZXIuaWQ7XHJcbiAgICAgICAgICAgICAgICBpZiAoY2ZnLnNjb3BlID09PSBcInZpc2libGVcIiAmJiBlbnRyeS5oaWRkZW4pIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgZ3JvdXBGb3IobGF5ZXIubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIikuZW50cmllcy5wdXNoKGVudHJ5KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBkZWR1cGVEYXRhRW50cmllcyhncm91cHMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFBlcnNpc3RlbnQgc3VwcHJlc3Npb246IG1hdGNoZXJzIG91dGxpdmUgZXZlcnkgcmUtZGVyaXZhdGlvbiwgd2hpY2ggaXMgdGhlXHJcbiAgICAvLyBkaWZmZXJlbmNlIGZyb20gYSByZWdpc3RyeSByZW1vdmUgdGhhdCB0aGUgbmV4dCBhZGQgd291bGQganVzdCByZXBvcHVsYXRlLlxyXG4gICAgY29uc3QgcmVtb3ZlcyA9IGNmZy5yZW1vdmUgfHwgW107XHJcbiAgICBpZiAocmVtb3Zlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcclxuICAgICAgICAgICAgZ3JvdXAuZW50cmllcyA9IGdyb3VwLmVudHJpZXMuZmlsdGVyKFxyXG4gICAgICAgICAgICAgICAgZW50cnkgPT4gIXJlbW92ZXMuc29tZShtID0+IG1hdGNoZXJIaXRzKG0sIGVudHJ5LCBncm91cC5uYW1lKSkpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBNYW51YWwgZW50cmllczogdGhlIHVzZXIncyBvd24gY2xhaW1zLiBzY29wZSBuZXZlciBkcm9wcyB0aGVtOyBhIGBsYXllcmBcclxuICAgIC8vIGJpbmRpbmcgbWFrZXMgb25lIGZvbGxvdyBhIGxpdmUgbGF5ZXIncyB2aXNpYmlsaXR5IChhbmQgdmFuaXNoIHdpdGggaXQgdW5kZXJcclxuICAgIC8vIHNjb3BlIFwidmlzaWJsZVwiKSwgZm9yIHdoZW4gYSBtYW51YWwgcm93IGlzIHJlYWxseSBhIHJlbGFiZWxsaW5nLlxyXG4gICAgZm9yIChjb25zdCBhZGRlZCBvZiBjZmcuYWRkIHx8IFtdKSB7XHJcbiAgICAgICAgY29uc3QgZW50cnkgPSB7IGhpZGRlbjogZmFsc2UsIC4uLmFkZGVkIH07XHJcbiAgICAgICAgaWYgKGVudHJ5LmxheWVyICE9IG51bGwpIHtcclxuICAgICAgICAgICAgY29uc3QgYm91bmQgPSAobGF5ZXJzIHx8IFtdKS5maW5kKFxyXG4gICAgICAgICAgICAgICAgbCA9PiBsLmlkID09PSBlbnRyeS5sYXllciB8fCBsLm5hbWUgPT09IGVudHJ5LmxheWVyKTtcclxuICAgICAgICAgICAgZW50cnkuaGlkZGVuID0gIWJvdW5kIHx8ICFpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShib3VuZCwgZ3JvdXBDb25maWdzIHx8IHt9KTtcclxuICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHJlbW92ZXMuc29tZShtID0+IG1hdGNoZXJIaXRzKG0sIGVudHJ5LCBlbnRyeS5ncm91cCB8fCBcIlwiKSkpIGNvbnRpbnVlO1xyXG4gICAgICAgIGdyb3VwRm9yKGVudHJ5Lmdyb3VwIHx8IFwiXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcG9wdWxhdGVkID0gZ3JvdXBzLmZpbHRlcihnID0+IGcuZW50cmllcy5sZW5ndGggPiAwKTtcclxuICAgIHJldHVybiB7IHRpdGxlOiBjZmcudGl0bGUgfHwgXCJMZWdlbmRcIiwgZ3JvdXBzOiBwb3B1bGF0ZWQgfTtcclxufVxyXG5cclxuLy8gLS0tIHJlbmRlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRE9NIGJ1aWx0IHdpdGggY3JlYXRlRWxlbWVudC90ZXh0Q29udGVudCB0aHJvdWdob3V0OiBsYWJlbHMgYW5kIGNhdGVnb3J5IHZhbHVlcyBjb21lXHJcbi8vIGZyb20gdXNlciBkYXRhIGFuZCBtdXN0IG5ldmVyIGJlIHBhcnNlZCBhcyBIVE1MLlxyXG5cclxuZnVuY3Rpb24gZGl2KHN0eWxlcywgdGV4dCkge1xyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGVzKTtcclxuICAgIGlmICh0ZXh0ICE9IG51bGwpIGVsLnRleHRDb250ZW50ID0gdGV4dDtcclxuICAgIHJldHVybiBlbDtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2x5cGgoZW50cnkpIHtcclxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJsaW5lXCIpIHtcclxuICAgICAgICByZXR1cm4gZGl2KHsgd2lkdGg6IFwiMjBweFwiLCBoZWlnaHQ6IFwiNHB4XCIsIGJhY2tncm91bmQ6IGVudHJ5LmNvbG9yLFxyXG4gICAgICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIgfSk7XHJcbiAgICB9XHJcbiAgICBpZiAoZW50cnkuc2hhcGUgPT09IFwicGluXCIpIHtcclxuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgIGVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICBlbC5zdHlsZS5mbGV4ID0gXCJub25lXCI7XHJcbiAgICAgICAgY29uc3Qgc3ZnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJzdmdcIik7XHJcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZShcIndpZHRoXCIsIFwiMTJcIik7XHJcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZShcImhlaWdodFwiLCBcIjE0XCIpO1xyXG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIsIFwiMCAwIDI0IDI4XCIpO1xyXG4gICAgICAgIGNvbnN0IHBhdGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcInBhdGhcIik7XHJcbiAgICAgICAgcGF0aC5zZXRBdHRyaWJ1dGUoXCJkXCIsXHJcbiAgICAgICAgICAgIFwiTTEyIDBDNS40IDAgMCA1LjQgMCAxMmMwIDkgMTIgMTYgMTIgMTZzMTItNyAxMi0xNkMyNCA1LjQgMTguNiAwIDEyIDB6XCIpO1xyXG4gICAgICAgIHBhdGguc2V0QXR0cmlidXRlKFwiZmlsbFwiLCBlbnRyeS5jb2xvcik7XHJcbiAgICAgICAgc3ZnLmFwcGVuZENoaWxkKHBhdGgpO1xyXG4gICAgICAgIGVsLmFwcGVuZENoaWxkKHN2Zyk7XHJcbiAgICAgICAgcmV0dXJuIGVsO1xyXG4gICAgfVxyXG4gICAgLy8gY2lyY2xlIC8gcG9seWdvbiAvIHNxdWFyZTogZmlsbCBpbnNpZGUgYSBib3JkZXIsIHdoaWNoIGlzIGhvdyBhcmVhcyBkcmF3LlxyXG4gICAgY29uc3QgcmFkaXVzID0gZW50cnkuc2hhcGUgPT09IFwiY2lyY2xlXCIgPyBcIjUwJVwiXHJcbiAgICAgICAgOiBlbnRyeS5zaGFwZSA9PT0gXCJwb2x5Z29uXCIgPyBcIjJweFwiIDogXCIwXCI7XHJcbiAgICByZXR1cm4gZGl2KHsgd2lkdGg6IFwiMTJweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5maWxsQ29sb3IsXHJcbiAgICAgICAgICAgICAgICAgYm9yZGVyOiBgMnB4IHNvbGlkICR7ZW50cnkuY29sb3J9YCwgYm9yZGVyUmFkaXVzOiByYWRpdXMsXHJcbiAgICAgICAgICAgICAgICAgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiByYW1wUm93KGVudHJ5KSB7XHJcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xyXG4gICAgY29uc3Qgc3RvcHMgPSAoZW50cnkuYW5jaG9ycyB8fCBbXSkubWFwKChjb2xvciwgaSwgYWxsKSA9PlxyXG4gICAgICAgIGAke2NvbG9yfSAke2FsbC5sZW5ndGggPiAxID8gKGkgLyAoYWxsLmxlbmd0aCAtIDEpKSAqIDEwMCA6IDB9JWApO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7XHJcbiAgICAgICAgd2lkdGg6IFwiMTIwcHhcIiwgaGVpZ2h0OiBcIjEycHhcIiwgYm9yZGVyUmFkaXVzOiBcIjJweFwiLFxyXG4gICAgICAgIGJhY2tncm91bmRJbWFnZTogYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWAsXHJcbiAgICB9KSk7XHJcbiAgICBjb25zdCBlbmRzID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGp1c3RpZnlDb250ZW50OiBcInNwYWNlLWJldHdlZW5cIiwgd2lkdGg6IFwiMTIwcHhcIixcclxuICAgICAgICAgICAgICAgICAgICAgICBmb250U2l6ZTogXCIxMXB4XCIsIGNvbG9yOiBcIiM1NTVcIiB9KTtcclxuICAgIGVuZHMuYXBwZW5kQ2hpbGQoZGl2KHt9LCBTdHJpbmcoZW50cnkudm1pbikpKTtcclxuICAgIGVuZHMuYXBwZW5kQ2hpbGQoZGl2KHt9LCBTdHJpbmcoZW50cnkudm1heCkpKTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChlbmRzKTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbmNvbnN0IE1BWF9DQVRFR09SWV9ST1dTID0gMTI7XHJcblxyXG5mdW5jdGlvbiBjYXRlZ29yaWVzUm93KGVudHJ5KSB7XHJcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xyXG4gICAgY29uc3QgaXRlbXMgPSBlbnRyeS5pdGVtcyB8fCBbXTtcclxuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcy5zbGljZSgwLCBNQVhfQ0FURUdPUllfUk9XUykpIHtcclxuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcclxuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGdseXBoKHsgc2hhcGU6IFwic3F1YXJlXCIsIGNvbG9yOiBpdGVtLmNvbG9yLCBmaWxsQ29sb3I6IGl0ZW0uY29sb3IgfSkpO1xyXG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZGl2KHt9LCBTdHJpbmcoaXRlbS52YWx1ZSkpKTtcclxuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XHJcbiAgICB9XHJcbiAgICBpZiAoaXRlbXMubGVuZ3RoID4gTUFYX0NBVEVHT1JZX1JPV1MpIHtcclxuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luTGVmdDogXCI4cHhcIiwgbWFyZ2luVG9wOiBcIjNweFwiLCBjb2xvcjogXCIjNTU1XCIgfSxcclxuICAgICAgICAgICAgYCsgJHtpdGVtcy5sZW5ndGggLSBNQVhfQ0FURUdPUllfUk9XU30gbW9yZWApKTtcclxuICAgIH1cclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJpbnNSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XHJcbiAgICBjb25zdCBlZGdlcyA9IGVudHJ5LmVkZ2VzIHx8IFtdO1xyXG4gICAgY29uc3QgY29sb3JzID0gZW50cnkuY29sb3JzIHx8IFtdO1xyXG4gICAgY29uc3QgbGFiZWxGb3IgPSBpID0+IGkgPT09IDAgPyBgPCAke2VkZ2VzWzBdfWBcclxuICAgICAgICA6IGkgPT09IGVkZ2VzLmxlbmd0aCA/IGBcdTIyNjUgJHtlZGdlc1tlZGdlcy5sZW5ndGggLSAxXX1gXHJcbiAgICAgICAgOiBgJHtlZGdlc1tpIC0gMV19IFx1MjAxMyAke2VkZ2VzW2ldfWA7XHJcbiAgICBjb2xvcnMuZm9yRWFjaCgoY29sb3IsIGkpID0+IHtcclxuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcclxuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGdseXBoKHsgc2hhcGU6IFwic3F1YXJlXCIsIGNvbG9yLCBmaWxsQ29sb3I6IGNvbG9yIH0pKTtcclxuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgbGFiZWxGb3IoaSkpKTtcclxuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbi8vIEEgc2l6ZSBrZXkgaXMgYSBzdGF0ZW1lbnQsIG5vdCBhIGRyYXdpbmc6IFwiXHUyNUNGIHNpemUgXHUyMjFEIGZpZWxkIChtaW4gXHUyMDEzIG1heClcIi4gVGhlIGdseXBoXHJcbi8vIGlzIGZpeGVkIGFuZCBub3RoaW5nIGluIHRoZSByb3cgZGVyaXZlcyBmcm9tIHJhZGl1c19yYW5nZSBvciB0aGUgZGF0YSdzIHNwcmVhZCAtLVxyXG4vLyBsZWdlbmQgQ1NTIHBpeGVscyBhcmUgbm90IG1hcCBwaXhlbHMgYXQgYW55IHpvb20sIHNvIGRyYXduIHNhbXBsZSBjaXJjbGVzIHdvdWxkXHJcbi8vIGFzc2VydCBhIHByZWNpc2lvbiB0aGF0IGRvZXMgbm90IGV4aXN0LiBUaGUgcm93IG5hbWVzIHRoZSBlbmNvZGluZyBhbmQgaXRzIGRvbWFpbi5cclxuZnVuY3Rpb24gc2l6ZXNSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBjb2xvcjogXCIjNjY2XCIgfSwgXCJcdTI1Q0ZcIikpO1xyXG4gICAgY29uc3QgcmFuZ2UgPSBlbnRyeS52bWluICE9IG51bGwgJiYgZW50cnkudm1heCAhPSBudWxsXHJcbiAgICAgICAgPyBgICgke2VudHJ5LnZtaW59IFx1MjAxMyAke2VudHJ5LnZtYXh9KWAgOiBcIlwiO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgYHNpemUgXHUyMjFEICR7ZW50cnkuZmllbGQgfHwgZW50cnkubGFiZWx9JHtyYW5nZX1gKSk7XHJcbiAgICByZXR1cm4gcm93O1xyXG59XHJcblxyXG5mdW5jdGlvbiBzd2F0Y2hSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZ2x5cGgoZW50cnkpKTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XHJcbiAgICByZXR1cm4gcm93O1xyXG59XHJcblxyXG4vLyBDb2xsYXBzZSBzdGF0ZSwgcGVyIGNvbnRhaW5lciByYXRoZXIgdGhhbiBtb2R1bGUgc2NvcGU6IHRoZSBzaWRlYmFyIGtleXMgaXRzXHJcbi8vIGNvbGxhcHNlZFBhdGhzIGF0IG1vZHVsZSBsZXZlbCBhbmQgdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmUgaXQgLS0gYSBmaWxlZCBidWdcclxuLy8gdGhpcyBkZWxpYmVyYXRlbHkgZG9lcyBub3QgaW5oZXJpdC4gS2V5ZWQgYnkgZ3JvdXAgbmFtZSwgc3Vydml2aW5nIHRoZSBmdWxsXHJcbi8vIHJlLXJlbmRlciBldmVyeSBzeW5jIHBlcmZvcm1zLlxyXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyTGVnZW5kKGNvbnRhaW5lciwgc3BlYywgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb250YWluZXIuaW5uZXJIVE1MID0gXCJcIjtcclxuICAgIGNvbnN0IGRpbUhpZGRlbiA9IG9wdGlvbnMuZGltSGlkZGVuICE9PSBmYWxzZTtcclxuICAgIGxldCBjb2xsYXBzZWQgPSBjb2xsYXBzZWRCeUNvbnRhaW5lci5nZXQoY29udGFpbmVyKTtcclxuICAgIGlmICghY29sbGFwc2VkKSB7XHJcbiAgICAgICAgY29sbGFwc2VkID0gbmV3IFNldCgpO1xyXG4gICAgICAgIGNvbGxhcHNlZEJ5Q29udGFpbmVyLnNldChjb250YWluZXIsIGNvbGxhcHNlZCk7XHJcbiAgICB9XHJcbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoZGl2KHtcclxuICAgICAgICBmb250U2l6ZTogXCIxM3B4XCIsIGZvbnRXZWlnaHQ6IFwiYm9sZFwiLCBib3JkZXJCb3R0b206IFwiMnB4IHNvbGlkICNlZWVcIixcclxuICAgICAgICBwYWRkaW5nQm90dG9tOiBcIjRweFwiLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIsXHJcbiAgICB9LCBzcGVjLnRpdGxlKSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBzcGVjLmdyb3Vwcykge1xyXG4gICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gZ3JvdXAubmFtZSAmJiBjb2xsYXBzZWQuaGFzKGdyb3VwLm5hbWUpO1xyXG4gICAgICAgIGlmIChncm91cC5uYW1lKSB7XHJcbiAgICAgICAgICAgIC8vIFRoZSBzaWRlYmFyJ3MgYWZmb3JkYW5jZSBleGFjdGx5OiBhbiBhcnJvdyB0aGF0IGZvbGRzIHRoZSBzZWN0aW9uLlxyXG4gICAgICAgICAgICBjb25zdCBoZWFkZXIgPSBkaXYoeyBmb250V2VpZ2h0OiBcImJvbGRcIiwgbWFyZ2luVG9wOiBcIjZweFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdXJzb3I6IFwicG9pbnRlclwiLCB1c2VyU2VsZWN0OiBcIm5vbmVcIiB9KTtcclxuICAgICAgICAgICAgaGVhZGVyLnRleHRDb250ZW50ID0gYCR7aXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIn0gJHtncm91cC5uYW1lfWA7XHJcbiAgICAgICAgICAgIGhlYWRlci5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbGxhcHNlZC5oYXMoZ3JvdXAubmFtZSkpIGNvbGxhcHNlZC5kZWxldGUoZ3JvdXAubmFtZSk7XHJcbiAgICAgICAgICAgICAgICBlbHNlIGNvbGxhcHNlZC5hZGQoZ3JvdXAubmFtZSk7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChoZWFkZXIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoaXNDb2xsYXBzZWQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZ3JvdXAuZW50cmllcykge1xyXG4gICAgICAgICAgICBjb25zdCByb3cgPSBlbnRyeS5raW5kID09PSBcInJhbXBcIiA/IHJhbXBSb3coZW50cnkpXHJcbiAgICAgICAgICAgICAgICA6IGVudHJ5LmtpbmQgPT09IFwiY2F0ZWdvcmllc1wiID8gY2F0ZWdvcmllc1JvdyhlbnRyeSlcclxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJiaW5zXCIgPyBiaW5zUm93KGVudHJ5KVxyXG4gICAgICAgICAgICAgICAgOiBlbnRyeS5raW5kID09PSBcInNpemVzXCIgPyBzaXplc1JvdyhlbnRyeSlcclxuICAgICAgICAgICAgICAgIDogc3dhdGNoUm93KGVudHJ5KTtcclxuICAgICAgICAgICAgLy8gRGltbWVkLCBub3QgZHJvcHBlZDogdW5kZXIgc2NvcGUgXCJhbGxcIiB0aGUgbGVnZW5kIGlzIHRoZSBtYXAncyB3aG9sZVxyXG4gICAgICAgICAgICAvLyB2b2NhYnVsYXJ5LCBhbmQgdGhlIGRpbSBpcyB3aGF0IHN0aWxsIHRlbGxzIHRoZSBjdXJyZW50IHNjcmVlbiBzdGF0ZS5cclxuICAgICAgICAgICAgaWYgKGVudHJ5LmhpZGRlbiAmJiBkaW1IaWRkZW4pIHJvdy5zdHlsZS5vcGFjaXR5ID0gXCIwLjVcIjtcclxuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHJvdyk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcclxufVxyXG4iLCAiZXhwb3J0IGNvbnN0IHBpblNoYWRlciA9IGBcclxucHJlY2lzaW9uIG1lZGl1bXAgZmxvYXQ7XHJcbnZhcnlpbmcgdmVjNCBfY29sb3I7XHJcbnZvaWQgbWFpbigpIHtcclxuICAgIC8vIHV2IHJhbmdlcyBmcm9tIC0wLjUgdG8gMC41LiBUaGUgY2VudGVyICgwLjAsIDAuMCkgaXMgdGhlIGV4YWN0IGNvb3JkaW5hdGUuXHJcbiAgICB2ZWMyIHV2ID0gZ2xfUG9pbnRDb29yZC54eSAtIHZlYzIoMC41KTtcclxuXHJcbiAgICAvLyBQaW4gaGVhZCBjaXJjbGUgY2VudGVyZWQgYXQgKDAuMCwgLTAuMzApIHdpdGggcmFkaXVzIDAuMTZcclxuICAgIGZsb2F0IGRfY2lyY2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgXHJcbiAgICAvLyBQaW4gYm9keSB0cmlhbmdsZSBwb2ludGluZyBleGFjdGx5IHRvICgwLjAsIDAuMClcclxuICAgIGZsb2F0IGRfdHJpYW5nbGUgPSBtYXgoYWJzKHV2LngpICogMS44NzUgKyB1di55LCAtdXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9waW4gPSBtaW4oZF9jaXJjbGUsIGRfdHJpYW5nbGUpO1xyXG5cclxuICAgIC8vIElubmVyIGhvbGUgY2VudGVyZWQgYXQgKDAuMCwgLTAuMzApIHdpdGggcmFkaXVzIDAuMDZcclxuICAgIGZsb2F0IGRfaG9sZSA9IGxlbmd0aCh1diAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4wNjtcclxuXHJcbiAgICAvLyBEcm9wIHNoYWRvdyBzaGlmdGVkIHNsaWdodGx5IGRvd24gYW5kIGJsdXJyZWRcclxuICAgIHZlYzIgc2hhZG93VXYgPSB1diAtIHZlYzIoMC4wLCAwLjA0KTtcclxuICAgIGZsb2F0IGRfc2hhZG93X2NpcmNsZSA9IGxlbmd0aChzaGFkb3dVdiAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4xNjtcclxuICAgIGZsb2F0IGRfc2hhZG93X3RyaWFuZ2xlID0gbWF4KGFicyhzaGFkb3dVdi54KSAqIDEuODc1ICsgc2hhZG93VXYueSwgLXNoYWRvd1V2LnkgLSAwLjMwKTtcclxuICAgIGZsb2F0IGRfc2hhZG93ID0gbWluKGRfc2hhZG93X2NpcmNsZSwgZF9zaGFkb3dfdHJpYW5nbGUpO1xyXG5cclxuICAgIC8vIEFudGktYWxpYXNlZCBtYXNrc1xyXG4gICAgZmxvYXQgbWFza19waW4gPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluKTtcclxuICAgIGZsb2F0IG1hc2tfaG9sZSA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9ob2xlKTtcclxuICAgIGZsb2F0IG1hc2tfYm9yZGVyID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX3BpbiArIDAuMDI1KTtcclxuICAgIGZsb2F0IG1hc2tfc2hhZG93ID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMywgMC4wNCwgZF9zaGFkb3cpO1xyXG5cclxuICAgIC8vIENvbXBvc2l0ZSBsYXllcnNcclxuICAgIHZlYzQgc2hhZG93Q29sb3IgPSB2ZWM0KDAuMCwgMC4wLCAwLjAsIDAuMjUpICogbWFza19zaGFkb3c7XHJcbiAgICB2ZWM0IGJvZHlDb2xvciA9IG1peCh2ZWM0KDAuMCwgMC4wLCAwLjAsIDAuODUpLCB2ZWM0KF9jb2xvci5yZ2IsIF9jb2xvci5hKSwgbWFza19ib3JkZXIpO1xyXG4gICAgdmVjNCB3aXRoSG9sZSA9IG1peChib2R5Q29sb3IsIHZlYzQoMS4wLCAxLjAsIDEuMCwgMS4wKSwgbWFza19ob2xlKTtcclxuXHJcbiAgICBnbF9GcmFnQ29sb3IgPSBtaXgoc2hhZG93Q29sb3IsIHdpdGhIb2xlLCBtYXNrX3Bpbik7XHJcbn1gO1xyXG4iLCAiLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlcjogb25lIGNvbnRyb2wgc2VydmluZyBldmVyeSB0aW1lIGxheWVyIG9uIHRoZSBtYXAuXHJcbi8vXHJcbi8vIFRpY2tzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhbiBJU084NjAxIHBlcmlvZCByYXRoZXIgdGhhbiB0YWtlbiBmcm9tIHRoZSBvYnNlcnZlZFxyXG4vLyB0aW1lc3RhbXBzLCBkZWxpYmVyYXRlbHk6IGEgcGVyaW9kIGluIHdoaWNoIG5vdGhpbmcgaGFwcGVuZWQgc3RpbGwgZ2V0cyBpdHMgdGljaywgc28gYW5cclxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXHJcbi8vXHJcbi8vIFRoaXMgaXMgc3dpZnRtYXAncyBvd24gY29udHJvbCByYXRoZXIgdGhhbiBMZWFmbGV0LlRpbWVEaW1lbnNpb24ncy4gVGhhdCBsaWJyYXJ5IHNwbGl0c1xyXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cclxuLy8gdGhlIGFkYXB0ZXJzIGFyZSB1bnVzYWJsZSBhZ2FpbnN0IFdlYkdMIGxheWVycywgdGhlIG1vZGVsIGlzIGEgZmV3IGRvemVuIGxpbmVzLCBhbmQgdGhlXHJcbi8vIGNvbnRyb2wgYWxvbmUgd2FzIG5vdCB3b3J0aCBhIHZlbmRvcmVkIGRlcGVuZGVuY3kgb24gYSBuZXR3b3JrIHdoZXJlIGV2ZXJ5IGZpbGUgaXNcclxuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cclxuXHJcbi8vIC0tLSBJU084NjAxIHBlcmlvZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cclxuY29uc3QgUEVSSU9EX1JFID1cclxuICAgIC9eUCg/ISQpKD86KFxcZCspWSk/KD86KFxcZCspTSk/KD86KFxcZCspVyk/KD86KFxcZCspRCk/KD86VCg/ISQpKD86KFxcZCspSCk/KD86KFxcZCspTSk/KD86KFxcZCsoPzpcXC5cXGQrKT8pUyk/KT8kLztcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBlcmlvZCh0ZXh0KSB7XHJcbiAgICBjb25zdCBtID0gUEVSSU9EX1JFLmV4ZWModGV4dCB8fCBcIlwiKTtcclxuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIHllYXJzOiArKG1bMV0gfHwgMCksIG1vbnRoczogKyhtWzJdIHx8IDApLCB3ZWVrczogKyhtWzNdIHx8IDApLCBkYXlzOiArKG1bNF0gfHwgMCksXHJcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXHJcbiAgICB9O1xyXG59XHJcblxyXG4vLyBZZWFycyBhbmQgbW9udGhzIG1vdmUgdGhyb3VnaCB0aGUgVVRDIGNhbGVuZGFyIC0tIFAxTSBmcm9tIEphbiAzMSBsYW5kcyB3aGVyZSBEYXRlXHJcbi8vIGFyaXRobWV0aWMgcHV0cyBpdCwgbm90IGEgZml4ZWQgMzAgZGF5cyAtLSB3aGlsZSB0aGUgcmVzdCBpcyBwbGFpbiBtaWxsaXNlY29uZHMuXHJcbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XHJcbiAgICBjb25zdCBkID0gbmV3IERhdGUobXMpO1xyXG4gICAgaWYgKHAueWVhcnMpIGQuc2V0VVRDRnVsbFllYXIoZC5nZXRVVENGdWxsWWVhcigpICsgc2lnbiAqIHAueWVhcnMpO1xyXG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XHJcbiAgICByZXR1cm4gZC5nZXRUaW1lKCkgKyBzaWduICogKCgocC53ZWVrcyAqIDcgKyBwLmRheXMpICogMjQgKiAzNjAwXHJcbiAgICAgICAgKyBwLmhvdXJzICogMzYwMCArIHAubWludXRlcyAqIDYwICsgcC5zZWNvbmRzKSAqIDEwMDApO1xyXG59XHJcblxyXG4vLyBUaGUgc2xpZGVyJ3MgcG9zaXRpb25zOiBmcm9tIHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbiB0byB0aGUgZmlyc3QgdGljayBhdCBvciBwYXN0IHRoZVxyXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxyXG4vLyB3b3VsZCBvdGhlcndpc2UgaGFuZyB0aGUgdGFiIGJ1aWxkaW5nIGFuIGFycmF5IG9mIG1pbGxpb25zLlxyXG5leHBvcnQgY29uc3QgTUFYX1RJQ0tTID0gNTAwMDtcclxuXHJcbi8vIC0tLSBwZXJpb2QgYm91bmRhcmllcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIFRpY2tzIGFuY2hvciB0byBQRVJJT0QgQk9VTkRBUklFUywgbm90IHRvIHRoZSBkYXRhLiBUaGUgZmlyc3QgdGljayBpcyB0aGUgZmlyc3RcclxuLy8gYm91bmRhcnkgYXQgb3IgYWZ0ZXIgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBzbyB0aGUgZWFybGllc3QgcG9pbnQgc3RpbGwgZmFsbHNcclxuLy8gaW5zaWRlIHRoZSBoYWxmLW9wZW4gd2luZG93IChmaXJzdFRpY2sgLSBQLCBmaXJzdFRpY2tdIC0tIHRoZSBjb25zdHJhaW50IHRoYXQgcHV0XHJcbi8vIHRoZSBmaXJzdCB0aWNrIEFUIHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbiBob2xkcyAtLSB3aGlsZSBkYXRhIGFycml2aW5nIEVBUkxJRVJcclxuLy8gb25seSBwcmVwZW5kcyBib3VuZGFyaWVzIGFuZCBtb3ZlcyBub3RoaW5nIGEgdXNlciBub3RlZC4gKEFuY2hvcmVkIHRvIHRoZSBkYXRhLFxyXG4vLyBhIGxhdGUgb2JzZXJ2YXRpb24gc2hpZnRlZCBldmVyeSB0aWNrIGJ5IHRoZSByZW1haW5kZXIgYW5kIHRoZSBtb21lbnQgdGhlIHVzZXJcclxuLy8gd2FzIGxvb2tpbmcgYXQgYmVjYW1lIGEgZGlmZmVyZW50IHRpY2suKSBSb3VuZCB0aW1lcyBmYWxsIG91dCBmb3IgZnJlZTogMDM6MDAsXHJcbi8vIDA0OjAwIGZvciBQVDFILCBuZXZlciAwMzoxNy5cclxuLy9cclxuLy8gRml4ZWQtd2lkdGggcGVyaW9kcyBhbGlnbiB0byBlcG9jaCBtdWx0aXBsZXMsIHdlZWtzIHRvIE1vbmRheSAwMDowMCBVVEMuIE1vbnRoc1xyXG4vLyBhbmQgeWVhcnMgYWxpZ24gdG8gbW9udGgveWVhciBzdGFydHMgaW4gdGhlIFVUQyBjYWxlbmRhciwgaW4gbXVsdGlwbGVzIG9mIHRoZVxyXG4vLyBwZXJpb2QgY291bnRlZCBmcm9tIHllYXIgMCAoUDNNOiBxdWFydGVycykuIEEgcGVyaW9kIG1peGluZyBjYWxlbmRhciBhbmQgY2xvY2tcclxuLy8gdW5pdHMgKFAxTTFEKSBoYXMgbm8gc2Vuc2libGUgYm91bmRhcnkgZ3JpZCwgc28gdGhhdCBvbmUgYWxvbmUga2VlcHMgdGhlIG9sZFxyXG4vLyBiZWhhdmlvdXI6IGl0cyBmaXJzdCB0aWNrIHNpdHMgYXQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLlxyXG5jb25zdCBNT05EQVlfRVBPQ0ggPSBEYXRlLlVUQygxOTcwLCAwLCA1KTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBhbGlnblRvUGVyaW9kKG1zLCBwKSB7XHJcbiAgICBjb25zdCBmaXhlZCA9IHBlcmlvZFRvTXMocCk7XHJcbiAgICBjb25zdCBoYXNDbG9jayA9IEJvb2xlYW4ocC53ZWVrcyB8fCBwLmRheXMgfHwgcC5ob3VycyB8fCBwLm1pbnV0ZXMgfHwgcC5zZWNvbmRzKTtcclxuICAgIGlmIChmaXhlZCkge1xyXG4gICAgICAgIGNvbnN0IHdob2xlV2Vla3MgPSBwLndlZWtzICYmICFwLmRheXMgJiYgIXAuaG91cnMgJiYgIXAubWludXRlcyAmJiAhcC5zZWNvbmRzO1xyXG4gICAgICAgIGNvbnN0IG9yaWdpbiA9IHdob2xlV2Vla3MgPyBNT05EQVlfRVBPQ0ggOiAwO1xyXG4gICAgICAgIHJldHVybiBvcmlnaW4gKyBNYXRoLmNlaWwoKG1zIC0gb3JpZ2luKSAvIGZpeGVkKSAqIGZpeGVkO1xyXG4gICAgfVxyXG4gICAgaWYgKChwLnllYXJzIHx8IHAubW9udGhzKSAmJiAhaGFzQ2xvY2spIHtcclxuICAgICAgICBjb25zdCBzcGFuID0gcC55ZWFycyAqIDEyICsgcC5tb250aHM7XHJcbiAgICAgICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcclxuICAgICAgICBsZXQgaW5kZXggPSBkLmdldFVUQ0Z1bGxZZWFyKCkgKiAxMiArIGQuZ2V0VVRDTW9udGgoKTtcclxuICAgICAgICBpZiAoRGF0ZS5VVEMoZC5nZXRVVENGdWxsWWVhcigpLCBkLmdldFVUQ01vbnRoKCksIDEpIDwgbXMpIGluZGV4ICs9IDE7XHJcbiAgICAgICAgaW5kZXggPSBNYXRoLmNlaWwoaW5kZXggLyBzcGFuKSAqIHNwYW47XHJcbiAgICAgICAgcmV0dXJuIERhdGUuVVRDKE1hdGguZmxvb3IoaW5kZXggLyAxMiksIGluZGV4ICUgMTIsIDEpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG1zO1xyXG59XHJcblxyXG4vLyBUaGUgdGljayBuZWFyZXN0IHRvIGFuIGFic29sdXRlIG1vbWVudCAtLSBob3cgdGhlIHBsYXloZWFkIHN1cnZpdmVzIGEgcmUtZ2VuZXJhdGVkXHJcbi8vIHNlcmllczogaXQgaXMgYSBNT01FTlQgdGhlIHVzZXIgY2hvc2UsIG5ldmVyIGFuIGluZGV4IGludG8gYSBsaXN0IHRoYXQganVzdCBncmV3LlxyXG5leHBvcnQgZnVuY3Rpb24gbmVhcmVzdFRpY2tJbmRleCh0aWNrcywgbW9tZW50KSB7XHJcbiAgICBpZiAoIXRpY2tzLmxlbmd0aCB8fCAhTnVtYmVyLmlzRmluaXRlKG1vbWVudCkpIHJldHVybiAwO1xyXG4gICAgbGV0IGJlc3QgPSAwO1xyXG4gICAgbGV0IGJlc3REaXN0YW5jZSA9IEluZmluaXR5O1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aWNrcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIGNvbnN0IGRpc3RhbmNlID0gTWF0aC5hYnModGlja3NbaV0gLSBtb21lbnQpO1xyXG4gICAgICAgIGlmIChkaXN0YW5jZSA8IGJlc3REaXN0YW5jZSkge1xyXG4gICAgICAgICAgICBiZXN0ID0gaTtcclxuICAgICAgICAgICAgYmVzdERpc3RhbmNlID0gZGlzdGFuY2U7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGJlc3Q7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZVRpY2tzKHN0YXJ0TXMsIGVuZE1zLCBwKSB7XHJcbiAgICBjb25zdCBmaXJzdCA9IGFsaWduVG9QZXJpb2Qoc3RhcnRNcywgcCk7XHJcbiAgICBjb25zdCB0aWNrcyA9IFtmaXJzdF07XHJcbiAgICBsZXQgdCA9IGZpcnN0O1xyXG4gICAgaWYgKHQgPj0gZW5kTXMpIHJldHVybiB0aWNrcztcclxuICAgIHdoaWxlICh0aWNrcy5sZW5ndGggPCBNQVhfVElDS1MpIHtcclxuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xyXG4gICAgICAgIHRpY2tzLnB1c2godCk7XHJcbiAgICAgICAgaWYgKHQgPj0gZW5kTXMpIHJldHVybiB0aWNrcztcclxuICAgIH1cclxuICAgIGNvbnNvbGUud2FybihgW1N3aWZ0TWFwXSB0aW1lIHNsaWRlciBjYXBwZWQgYXQgJHtNQVhfVElDS1N9IHRpY2tzOyBgICtcclxuICAgICAgICBgdGhlIHBlcmlvZCBpcyB0b28gZmluZSBmb3IgdGhlIGRhdGEncyBleHRlbnQuIFVzZSBhIGNvYXJzZXIgcGVyaW9kLmApO1xyXG4gICAgcmV0dXJuIHRpY2tzO1xyXG59XHJcblxyXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4vLyBUaGUgaW50ZXJ2YWwgc2hvd24gYXQgb25lIHRpY2suIGR1cmF0aW9uIFwicGVyaW9kXCIgaXMgdGhlIHRpY2sncyBvd24gcGVyaW9kLCBzbyBhYnNlbmNlXHJcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxyXG5leHBvcnQgZnVuY3Rpb24gd2luZG93Rm9yKHRpY2ssIGR1cmF0aW9uU3BlYywgcGVyaW9kKSB7XHJcbiAgICBpZiAoZHVyYXRpb25TcGVjID09PSBudWxsIHx8IGR1cmF0aW9uU3BlYyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XHJcbiAgICB9XHJcbiAgICBjb25zdCBwID0gZHVyYXRpb25TcGVjID09PSBcInBlcmlvZFwiID8gcGVyaW9kIDogcGFyc2VQZXJpb2QoZHVyYXRpb25TcGVjKTtcclxuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XHJcbiAgICByZXR1cm4geyBzdGFydDogYWRkUGVyaW9kKHRpY2ssIHAsIC0xKSwgZW5kOiB0aWNrIH07XHJcbn1cclxuXHJcbi8vIEhhbGYtb3BlbiAoc3RhcnQsIGVuZF06IGEgZmVhdHVyZSBzdGFtcGVkIGV4YWN0bHkgb24gYSB0aWNrIGJvdW5kYXJ5IGJlbG9uZ3MgdG8gdGhlXHJcbi8vIHBlcmlvZCB0aGF0IGVuZHMgdGhlcmUsIGFuZCBuZXZlciB0byB0d28gbmVpZ2hib3VyaW5nIHRpY2tzIGF0IG9uY2UuIE5hTiB0aW1lcyBtYXJrXHJcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXHJcbmV4cG9ydCBmdW5jdGlvbiBmZWF0dXJlSW5XaW5kb3coc3RhcnRNcywgZW5kTXMsIHdpbikge1xyXG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydE1zKSkgcmV0dXJuIHRydWU7XHJcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xyXG59XHJcblxyXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxyXG4vLyB1bmRlciBcIjxsYXllciBpZD46OnRpbWVzXCIgLS0gdGhlIHNhbWUgdHJhbnNwb3J0IGNvb3JkaW5hdGVzIHVzZS5cclxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKSB7XHJcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xyXG4gICAgaWYgKCFyYXcpIHJldHVybiBudWxsO1xyXG4gICAgcmV0dXJuIG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XHJcbn1cclxuXHJcbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cclxuLy8gbm8gc2xpZGVyIGlzIGFjdGl2ZS4gRWFjaCBsYXllciBkZXJpdmVzIGl0cyBvd24gd2luZG93IGZyb20gdGhlc2UsIHNpbmNlIGR1cmF0aW9uIGlzXHJcbi8vIHBlciBsYXllciB3aGlsZSB0aGUgdGljayBpcyBzaGFyZWQuXHJcbi8vXHJcbi8vIFdoZXRoZXIgYSB3aG9sZSBsYXllciBzaG93cyBhdCB0aGUgY3VycmVudCB0aWNrLiBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZVxyXG4vLyBnZW9tZXRyeSBwZXIgbGF5ZXIsIHNvIHRoZXkgYXJlIGluIG9yIG91dCBhcyBhIHVuaXQ7IGEgbGF5ZXIgd2l0aCBubyB0aW1lIG1ldGFkYXRhIGlzXHJcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cclxuLy8gVGhlIGR1cmF0aW9uIGEgbGF5ZXIgc2hvd3MgcmlnaHQgbm93LiBBIHdpbmRvdyBkcmFnZ2VkIG91dCBvbiB0aGUgYmFyIGlzIGEgdXNlclxyXG4vLyBnZXN0dXJlIGFuZCBvdXRyYW5rcyBldmVyeSBsYXllcidzIGNvbmZpZ3VyZWQgZHVyYXRpb24gd2hpbGUgaXQgaXMgYWN0aXZlIC0tIHdoZW4gdGhlXHJcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xyXG4vLyBvbnRvIHRoZSB0aHVtYiBjbGVhcnMgdGhlIG92ZXJyaWRlIGFuZCBsYXllcnMgcmV0dXJuIHRvIHRoZWlyIG93biBzZXR0aW5ncy5cclxuZXhwb3J0IGZ1bmN0aW9uIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpIHtcclxuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XHJcbiAgICBpZiAoIWxheWVyLnRpbWUgfHwgIXRpbWVTdGF0ZSkgcmV0dXJuIHRydWU7XHJcbiAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcclxuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XHJcbiAgICBjb25zdCB3aW4gPSB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKTtcclxuICAgIC8vIEEgcGVyLXZlcnRleC10aW1lZCBsaW5lIGhvbGRzIG1hbnkgcGFpcnM7IG9uIHRoaXMgd2hvbGUtbGF5ZXIgcGF0aCBpdCBzaG93c1xyXG4gICAgLy8gd2hpbGUgQU5ZIG9mIHRoZW0gaXMgaW4gdGhlIHdpbmRvdyAtLSB0aGUgR1BVIHBhdGggaXMgd2hhdCB0cmltcyBwZXIgc2VnbWVudC5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICBpZiAoZmVhdHVyZUluV2luZG93KHRpbWVzW2ldLCB0aW1lc1tpICsgMV0sIHdpbikpIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG4vLyBUaGUgZXh0ZW50IG9mIGV2ZXJ5IHRpbWUgbGF5ZXIncyBvYnNlcnZhdGlvbnMsIE5hTi1ibGluZC4gRmVlZHMgdGljayBnZW5lcmF0aW9uLlxyXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJzLCBidWZmZXJzKSB7XHJcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcclxuICAgIGNvbnN0IHZpc2l0ID0gKGxpc3QpID0+IGxpc3QuZm9yRWFjaChsYXllciA9PiB7XHJcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIikgcmV0dXJuIHZpc2l0KGxheWVyLmxheWVycyB8fCBbXSk7XHJcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihsYXllciwgYnVmZmVycyk7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgcmV0dXJuO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBpZiAodGltZXNbaV0gPCBtaW4pIG1pbiA9IHRpbWVzW2ldO1xyXG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICB2aXNpdChsYXllcnMpO1xyXG4gICAgcmV0dXJuIG1pbiA9PT0gSW5maW5pdHkgPyBudWxsIDogeyBtaW4sIG1heCB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaGFzVGltZUxheWVycyhsYXllcnMpIHtcclxuICAgIHJldHVybiBsYXllcnMuc29tZShsID0+IGwudHlwZSA9PT0gXCJncm91cFwiXHJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxyXG4gICAgICAgIDogQm9vbGVhbihsLnRpbWUpKTtcclxufVxyXG5cclxuLy8gT25lIHBsYXliYWNrIHN0ZXA6IHRoZSBuZXh0IGluZGV4IGFuZCB3aGV0aGVyIHBsYXliYWNrIHN1cnZpdmVzIGl0LiBQdXJlIHNvIHRoZSBsb29wXHJcbi8vIHNlbWFudGljcyBhcmUgdGVzdGFibGUgd2l0aG91dCBhIHRpbWVyIC0tIGxvb3Bpbmcgd3JhcHMgYW5kIGtlZXBzIHBsYXlpbmcsIHRoZSBlbmRcclxuLy8gd2l0aG91dCBsb29wIHN0b3BzIHdoZXJlIGl0IGlzLlxyXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZShpbmRleCwgbGVuZ3RoLCBsb29wKSB7XHJcbiAgICBpZiAoaW5kZXggPCBsZW5ndGggLSAxKSByZXR1cm4geyBpbmRleDogaW5kZXggKyAxLCBwbGF5aW5nOiB0cnVlIH07XHJcbiAgICBpZiAobG9vcCkgcmV0dXJuIHsgaW5kZXg6IDAsIHBsYXlpbmc6IHRydWUgfTtcclxuICAgIHJldHVybiB7IGluZGV4LCBwbGF5aW5nOiBmYWxzZSB9O1xyXG59XHJcblxyXG4vLyBXaGVyZSB0aGUgY29udHJvbCBzaXRzLCBhcyBpbmxpbmUgc3R5bGVzIHNvIHRoZSBjaG9pY2UgdHJhdmVscyB3aXRoIHRoZSBzdGF0ZSByYXRoZXJcclxuLy8gdGhhbiBuZWVkaW5nIGEgc3R5bGVzaGVldCBydWxlIHBlciBjb3JuZXIuIEV2ZXJ5IHByb3BlcnR5IGlzIHdyaXR0ZW4gb24gZXZlcnkgcmVuZGVyIC0tXHJcbi8vIGluY2x1ZGluZyB0aGUgb25lcyBhIHBvc2l0aW9uIGRvZXMgbm90IHVzZSAtLSBzbyBtb3ZpbmcgdGhlIGNvbnRyb2wgY2xlYXJzIHRoZSBvbGRcclxuLy8gYW5jaG9yIGluc3RlYWQgb2YgYWNjdW11bGF0aW5nIGJvdGguXHJcbmV4cG9ydCBjb25zdCBQT1NJVElPTlMgPSB7XHJcbiAgICBcInRvcC1sZWZ0XCI6ICAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXHJcbiAgICBcInRvcC1jZW50ZXJcIjogICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXHJcbiAgICBcInRvcC1yaWdodFwiOiAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXHJcbiAgICBcImxlZnQtY2VudGVyXCI6ICAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXHJcbiAgICBcInJpZ2h0LWNlbnRlclwiOiAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXHJcbiAgICBcImJvdHRvbS1sZWZ0XCI6ICAgeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXHJcbiAgICBcImJvdHRvbS1jZW50ZXJcIjogeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXHJcbiAgICBcImJvdHRvbS1yaWdodFwiOiAgeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXHJcbn07XHJcblxyXG5mdW5jdGlvbiBhcHBseVBvc2l0aW9uKGVsLCBwb3NpdGlvbikge1xyXG4gICAgY29uc3Qgc3R5bGVzID0gUE9TSVRJT05TW3Bvc2l0aW9uXSB8fCBQT1NJVElPTlNbXCJ0b3AtY2VudGVyXCJdO1xyXG4gICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN0eWxlcykpIHtcclxuICAgICAgICBlbC5zdHlsZVtwcm9wXSA9IHZhbHVlO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXRVVEMobXMpIHtcclxuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XHJcbn1cclxuXHJcbi8vIC0tLSB0aGUgd2luZG93IGFuZCB0aGUgcnVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbi8vIEZpeGVkIG1pbGxpc2Vjb25kcyBmb3IgYSBwZXJpb2QsIG9yIG51bGwgd2hlbiBpdCBtb3ZlcyB0aHJvdWdoIHRoZSBjYWxlbmRhciAobW9udGhzLFxyXG4vLyB5ZWFycykgYW5kIGhhcyBubyBmaXhlZCB3aWR0aC4gVGhlIHJ1bGVyIGFuZCB0aGUgZHJhZyBncmlkIG5lZWQgZml4ZWQgd2lkdGhzOyBjYWxlbmRhclxyXG4vLyBwZXJpb2RzIGZhbGwgYmFjayB0byB0aGUgdGljayBwb3NpdGlvbnMgdGhlbXNlbHZlcy5cclxuZXhwb3J0IGZ1bmN0aW9uIHBlcmlvZFRvTXMocCkge1xyXG4gICAgaWYgKCFwIHx8IHAueWVhcnMgfHwgcC5tb250aHMpIHJldHVybiBudWxsO1xyXG4gICAgcmV0dXJuICgocC53ZWVrcyAqIDcgKyBwLmRheXMpICogMjQgKiAzNjAwICsgcC5ob3VycyAqIDM2MDBcclxuICAgICAgICArIHAubWludXRlcyAqIDYwICsgcC5zZWNvbmRzKSAqIDEwMDA7XHJcbn1cclxuXHJcbi8vIE1pbGxpc2Vjb25kcyBhcyBhbiBJU084NjAxIGR1cmF0aW9uLCBob3Vycy9taW51dGVzL3NlY29uZHMgb25seSAtLSBQVDI2SCBpcyB2YWxpZCBhbmRcclxuLy8gYXZvaWRzIGNhbGVuZGFyIHVuaXRzIGVudGlyZWx5LCBzbyB3aGF0IHRoZSBkcmFnIHdyaXRlcyBhbHdheXMgcGFyc2VzIGJhY2sgZXhhY3RseS5cclxuZXhwb3J0IGZ1bmN0aW9uIG1zVG9QZXJpb2RJU08obXMpIHtcclxuICAgIGxldCByZXN0ID0gTWF0aC5yb3VuZChtcyAvIDEwMDApO1xyXG4gICAgY29uc3QgaCA9IE1hdGguZmxvb3IocmVzdCAvIDM2MDApOyByZXN0IC09IGggKiAzNjAwO1xyXG4gICAgY29uc3QgbSA9IE1hdGguZmxvb3IocmVzdCAvIDYwKTsgcmVzdCAtPSBtICogNjA7XHJcbiAgICBsZXQgb3V0ID0gXCJQVFwiO1xyXG4gICAgaWYgKGgpIG91dCArPSBgJHtofUhgO1xyXG4gICAgaWYgKG0pIG91dCArPSBgJHttfU1gO1xyXG4gICAgaWYgKHJlc3QgfHwgb3V0ID09PSBcIlBUXCIpIG91dCArPSBgJHtyZXN0fVNgO1xyXG4gICAgcmV0dXJuIG91dDtcclxufVxyXG5cclxuLy8gVGhlIHJ1bGVyJ3MgaW5jcmVtZW50OiB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gZXZlcnkgYm91bmRhcnkgdGhlIHVzZXIgY2FuIGNhcmVcclxuLy8gYWJvdXQgLS0gdGhlIGdjZCBvZiB0aGUgaW50ZXJ2YWwgYW5kIGV2ZXJ5IGF0dGFjaGVkIGR1cmF0aW9uLiBBbiBpbnRlcnZhbCBvZiAxaCB3aXRoIGFcclxuLy8gMi41aCBkdXJhdGlvbiBuZWVkcyAzMC1taW51dGUgbWFya3MgZm9yIHRoZSBkdXJhdGlvbiB0byBzaXQgb24gb25lOyAxaCBhbmQgMmggbmVlZCBvbmx5XHJcbi8vIHRoZSBob3Vycy4gXCJMb3dlc3QgZHVyYXRpb25cIiBpcyB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIG9uZSBkaXZpZGVzIHRoZSBvdGhlci5cclxuZXhwb3J0IGZ1bmN0aW9uIGdjZEdyaWRNcyhwZXJpb2RNcywgZHVyYXRpb25zTXMpIHtcclxuICAgIGNvbnN0IGdjZCA9IChhLCBiKSA9PiAoYiA/IGdjZChiLCBhICUgYikgOiBhKTtcclxuICAgIGxldCBncmlkID0gcGVyaW9kTXM7XHJcbiAgICBmb3IgKGNvbnN0IGQgb2YgZHVyYXRpb25zTXMpIHtcclxuICAgICAgICBpZiAoZCA+IDApIGdyaWQgPSBnY2QoZ3JpZCwgTWF0aC5yb3VuZChkKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gTWF0aC5tYXgoZ3JpZCwgMTAwMCk7XHJcbn1cclxuXHJcbi8vIEV2ZXJ5IGZpbml0ZSBkdXJhdGlvbiBhdHRhY2hlZCB0byBhIHRpbWUgbGF5ZXIsIGluIG1zLCBmb3IgdGhlIGdyaWQuIFwicGVyaW9kXCIgYW5kIG51bGxcclxuLy8gY29udHJpYnV0ZSBub3RoaW5nIG5ldzsgY2FsZW5kYXIgZHVyYXRpb25zIGNhbm5vdCBqb2luIGEgZml4ZWQtbXMgZ3JpZCBhbmQgYXJlIHNraXBwZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJzLCB3aW5kb3dJc28pIHtcclxuICAgIGNvbnN0IG91dCA9IFtdO1xyXG4gICAgY29uc3QgdmlzaXQgPSBsaXN0ID0+IGxpc3QuZm9yRWFjaChsID0+IHtcclxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsLmxheWVycyB8fCBbXSk7XHJcbiAgICAgICAgY29uc3Qgc3BlYyA9IGwudGltZSAmJiBsLnRpbWUuZHVyYXRpb247XHJcbiAgICAgICAgaWYgKHR5cGVvZiBzcGVjID09PSBcInN0cmluZ1wiICYmIHNwZWMgIT09IFwicGVyaW9kXCIpIHtcclxuICAgICAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcclxuICAgICAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICB2aXNpdChsYXllcnMpO1xyXG4gICAgaWYgKHdpbmRvd0lzbykge1xyXG4gICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh3aW5kb3dJc28pKTtcclxuICAgICAgICBpZiAobXMpIG91dC5wdXNoKG1zKTtcclxuICAgIH1cclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIFRpY2sgbWFya3MgZm9yIHRoZSB0cmFjazogbWFqb3JzIGF0IGV2ZXJ5IGludGVydmFsIGJvdW5kYXJ5IChzcGFyc2VseSBsYWJlbGxlZCBzbyBsb25nXHJcbi8vIHRpbWVsaW5lcyBzdGF5IHJlYWRhYmxlKSwgdW5sYWJlbGxlZCBtaW5vcnMgYXQgdGhlIGdyaWQgaW4gYmV0d2Vlbi4gTWlub3IgRElTUExBWSBpc1xyXG4vLyB0aGlubmVkIHdoZW4gZGVuc2U7IHRoZSBzbmFwIGdyaWQgc3RheXMgZXhhY3QsIHNvIGEgbWFyayBpcyBhIGd1aWRlLCBub3QgYSBjb25zdHJhaW50LlxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSdWxlcih0aWNrcywgZ3JpZE1zLCBmb3JtYXRMYWJlbCwgeyBtYXhMYWJlbHMgPSA2LCBtYXhNaW5vcnMgPSAyNDAgfSA9IHt9KSB7XHJcbiAgICBpZiAodGlja3MubGVuZ3RoIDwgMikgcmV0dXJuIFtdO1xyXG4gICAgY29uc3QgdDAgPSB0aWNrc1swXSwgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdDA7XHJcbiAgICBjb25zdCBtYXJrcyA9IFtdO1xyXG4gICAgY29uc3QgbGFiZWxFdmVyeSA9IE1hdGgubWF4KDEsIE1hdGguY2VpbCh0aWNrcy5sZW5ndGggLyBtYXhMYWJlbHMpKTtcclxuICAgIHRpY2tzLmZvckVhY2goKHQsIGkpID0+IG1hcmtzLnB1c2goe1xyXG4gICAgICAgIGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiB0cnVlLFxyXG4gICAgICAgIGxhYmVsOiBpICUgbGFiZWxFdmVyeSA9PT0gMCA/IGZvcm1hdExhYmVsKHQpIDogbnVsbCxcclxuICAgIH0pKTtcclxuICAgIGlmIChncmlkTXMgJiYgZ3JpZE1zIDwgc3Bhbikge1xyXG4gICAgICAgIGNvbnN0IHRvdGFsID0gTWF0aC5mbG9vcihzcGFuIC8gZ3JpZE1zKTtcclxuICAgICAgICBjb25zdCB0aGluID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRvdGFsIC8gbWF4TWlub3JzKSk7XHJcbiAgICAgICAgZm9yIChsZXQgayA9IDE7IGsgKiBncmlkTXMgPCBzcGFuOyBrICs9IHRoaW4pIHtcclxuICAgICAgICAgICAgY29uc3QgdCA9IHQwICsgayAqIGdyaWRNcztcclxuICAgICAgICAgICAgaWYgKHRpY2tzLmluY2x1ZGVzKHQpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgbWFya3MucHVzaCh7IGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiBmYWxzZSwgbGFiZWw6IG51bGwgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG1hcmtzO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGlja0xhYmVsKG1zLCBwZXJpb2RNcykge1xyXG4gICAgY29uc3QgaXNvID0gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBpZiAocGVyaW9kTXMgIT0gbnVsbCAmJiBwZXJpb2RNcyA8IDYwICogMTAwMCkgcmV0dXJuIGlzby5zbGljZSgxMSwgMTkpO1xyXG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCAyNCAqIDM2MDAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxNik7XHJcbiAgICByZXR1cm4gaXNvLnNsaWNlKDUsIDEwKTtcclxufVxyXG5cclxuLy8gR2x5cGhzIGFzIGlubGluZSBTVkcgcmF0aGVyIHRoYW4gdGV4dDogXCJcdTIxQkJcIiByZWFkcyBhcyByZWZyZXNoIC0tIGEgbG9vcCB0b2dnbGUgZHJhd24gd2l0aFxyXG4vLyBpdCBsb29rcyBsaWtlIGEgcmVzZXQgYnV0dG9uLCB3aGljaCBpcyBleGFjdGx5IGhvdyBpdCBnb3QgbWlzcmVhZC4gY3VycmVudENvbG9yIGxldHNcclxuLy8gdGhlIHByZXNzZWQgc3RhdGUgcmVzdHlsZSB0aGVtIGZyb20gQ1NTLlxyXG5jb25zdCBJQ09OUyA9IHtcclxuICAgIGJhY2s6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk0zIDJoMnYxMkgzek0xMyAyIDYgOGw3IDZ6XCIvPjwvc3ZnPicsXHJcbiAgICBwbGF5OiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAybDkgNi05IDZ6XCIvPjwvc3ZnPicsXHJcbiAgICBwYXVzZTogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTQgMmgzdjEySDR6TTkgMmgzdjEySDl6XCIvPjwvc3ZnPicsXHJcbiAgICBmd2Q6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk0xMSAyaDJ2MTJoLTJ6TTMgMmw3IDYtNyA2elwiLz48L3N2Zz4nLFxyXG4gICAgbG9vcDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTggMmE2IDYgMCAwIDEgNS42NSA0SDE2bC0yLjggMy41TDEwLjQgNmgyLjFBNC41IDQuNSAwIDEgMCAxMi41IDEwbDEuMy43NUE2IDYgMCAxIDEgOCAyelwiLz48L3N2Zz4nLFxyXG59O1xyXG5cclxuLy8gLS0tIHRoZSBjb250cm9sIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIFBsYWluIERPTSBpbnNpZGUgdGhlIHdpZGdldCBjb250YWluZXIsIGxpa2UgdGhlIHNpZGViYXI6IG5vIExlYWZsZXQgY29udHJvbCBtYWNoaW5lcnksXHJcbi8vIHdoaWNoIGtlZXBzIGl0IHRlc3RhYmxlIGluIGpzZG9tIGFuZCBzdHlsZWFibGUgZnJvbSBtYXAuY3NzLiBUaGUgbGF5b3V0IGZvbGxvd3NcclxuLy8gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MgY29udHJvbCAtLSBzdGVwL3BsYXkvc3RlcC9sb29wIGFzIGEgam9pbmVkIGJ1dHRvbiBiYXIsIHRoZW4gdGhlXHJcbi8vIGRhdGUsIHNsaWRlciBhbmQgc3BlZWQgLS0gc2luY2UgdGhhdCBpcyB0aGUgc2xpZGVyIHVzZXJzIG9mIHRoZSBmb2xpdW0gYXBwcyBrbm93LlxyXG4vL1xyXG4vLyBUaGUgc2xpZGVyIGlzIGEgY29tcG9zaXRlLiBBIG5hdGl2ZSA8aW5wdXQgdHlwZT1yYW5nZT4gc3RheXMgb24gdG9wIGFzIHRoZSB0aHVtYjogaXRcclxuLy8ga2VlcHMga2V5Ym9hcmQgYXJyb3dzLCBzY3JlZW4gcmVhZGVycyBhbmQgZXZlcnkgZXhpc3RpbmcgdGVzdCB3b3JraW5nLCBhbmQgcGxheWJhY2tcclxuLy8gZHJpdmVzIGl0IGFzIGJlZm9yZS4gVW5kZXJuZWF0aCBzaXQgdGhlIHBhcnRzIGEgbmF0aXZlIGlucHV0IGNhbm5vdCBkcmF3OiB0aGUgd2luZG93XHJcbi8vIHNwYW4gc2hvd2luZyBleGFjdGx5IHdoYXQgaW50ZXJ2YWwgaXMgb24gdGhlIG1hcCwgYSBydWxlciB3aXRoIGxhYmVsbGVkIGludGVydmFsIG1hcmtzXHJcbi8vIGFuZCB1bmxhYmVsbGVkIGdjZCBtaW5vcnMsIGFuZCB0aGUgdHJhaWwgaGFuZGxlIC0tIGRyYWcgaXQgYmFjayB0byB3aWRlbiB0aGUgd2luZG93IGZvclxyXG4vLyBldmVyeSBsYXllciBhdCBvbmNlLCBkcm9wIGl0IG9udG8gdGhlIHRodW1iIHRvIGhhbmQgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJUaW1lQ29udHJvbChjb250YWluZXIsIHN0YXRlLCBoYW5kbGVycykge1xyXG4gICAgbGV0IGVsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1jb250cm9sXCIpO1xyXG4gICAgaWYgKCFzdGF0ZS50aWNrcyB8fCBzdGF0ZS50aWNrcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBpZiAoZWwpIGVsLnJlbW92ZSgpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKCFlbCkge1xyXG4gICAgICAgIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBlbC5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXRpbWUtY29udHJvbFwiO1xyXG4gICAgICAgIGVsLmlubmVySFRNTCA9IGBcclxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJ1dHRvbnNcIj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhY2tcIiB0aXRsZT1cIlN0ZXAgYmFja1wiIGFyaWEtbGFiZWw9XCJTdGVwIGJhY2tcIj4ke0lDT05TLmJhY2t9PC9idXR0b24+XHJcbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1wbGF5XCIgYXJpYS1sYWJlbD1cIlBsYXlcIj4ke0lDT05TLnBsYXl9PC9idXR0b24+XHJcbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1md2RcIiB0aXRsZT1cIlN0ZXAgZm9yd2FyZFwiIGFyaWEtbGFiZWw9XCJTdGVwIGZvcndhcmRcIj4ke0lDT05TLmZ3ZH08L2J1dHRvbj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxvb3BcIiBhcmlhLWxhYmVsPVwiTG9vcFwiPiR7SUNPTlMubG9vcH08L2J1dHRvbj5cclxuICAgICAgICAgICAgPC9zcGFuPlxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbGFiZWxcIj48L3NwYW4+XHJcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS10cmFja1wiPlxyXG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhc2VcIj48L3NwYW4+XHJcbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc3BhblwiPjwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1ydWxlclwiPjwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDxpbnB1dCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIgdHlwZT1cInJhbmdlXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCI+XHJcbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtdHJhaWxcIiByb2xlPVwic2xpZGVyXCIgdGFiaW5kZXg9XCIwXCJcclxuICAgICAgICAgICAgICAgICAgICAgIGFyaWEtbGFiZWw9XCJUcmFpbGluZyB3aW5kb3dcIiB0aXRsZT1cIkRyYWcgYmFjayB0byB3aWRlbiB0aGUgdGltZSB3aW5kb3c7IGRyb3Agb24gdGhlIHRodW1iIHRvIGNsZWFyXCI+PC9zcGFuPlxyXG4gICAgICAgICAgICA8L3NwYW4+XHJcbiAgICAgICAgICAgIDxzZWxlY3QgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwZWVkXCIgdGl0bGU9XCJQbGF5YmFjayBzcGVlZFwiPlxyXG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjAuNVwiPjAuNXg8L29wdGlvbj5cclxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIxXCI+MXg8L29wdGlvbj5cclxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIyXCI+Mng8L29wdGlvbj5cclxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCI0XCI+NHg8L29wdGlvbj5cclxuICAgICAgICAgICAgPC9zZWxlY3Q+YDtcclxuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoZWwpO1xyXG5cclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtYmFja1wiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwQmFjayk7XHJcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWZ3ZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwRm9yd2FyZCk7XHJcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uUGxheVRvZ2dsZSk7XHJcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uTG9vcFRvZ2dsZSk7XHJcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIixcclxuICAgICAgICAgICAgZSA9PiBoYW5kbGVycy5vblNwZWVkKHBhcnNlRmxvYXQoZS50YXJnZXQudmFsdWUpKSk7XHJcbiAgICAgICAgY29uc3Qgc2xpZGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKTtcclxuICAgICAgICAvLyBgaW5wdXRgIGZpcmVzIHBlciBkcmFnIHN0ZXAgZm9yIGxpdmUgc2NydWJiaW5nOyB0aGUgbW9kZWwgd3JpdGViYWNrIGlzIHRoZVxyXG4gICAgICAgIC8vIGhhbmRsZXIncyBwcm9ibGVtLCB0aHJvdHRsZWQgdGhlcmUgc28gZHJhZ2dpbmcgZG9lcyBub3QgZmxvb2QgdGhlIGtlcm5lbC5cclxuICAgICAgICBzbGlkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGUgPT4gaGFuZGxlcnMub25TZWVrKHBhcnNlSW50KGUudGFyZ2V0LnZhbHVlLCAxMCkpKTtcclxuXHJcbiAgICAgICAgYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS5tYXggPSBTdHJpbmcoc3RhdGUudGlja3MubGVuZ3RoIC0gMSk7XHJcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLmluZGV4KTtcclxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sYWJlbFwiKS50ZXh0Q29udGVudCA9IGZvcm1hdFVUQyhzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF0pO1xyXG5cclxuICAgIGNvbnN0IHBsYXkgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKTtcclxuICAgIHBsYXkuaW5uZXJIVE1MID0gc3RhdGUucGxheWluZyA/IElDT05TLnBhdXNlIDogSUNPTlMucGxheTtcclxuICAgIHBsYXkuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBzdGF0ZS5wbGF5aW5nID8gXCJQYXVzZVwiIDogXCJQbGF5XCIpO1xyXG4gICAgcGxheS50aXRsZSA9IHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIjtcclxuXHJcbiAgICAvLyBBIG1vZGUsIG5vdCBhbiBhY3Rpb246IHByZXNzZWQgc3R5bGluZyBhbmQgYXJpYS1wcmVzc2VkIHNheSBcInRoaXMgc3RheXMgb25cIixcclxuICAgIC8vIHdoZXJlIGEgYmFyZSBpY29uIGludml0ZWQgYSBjbGljayBleHBlY3Rpbmcgc29tZXRoaW5nIHRvIGhhcHBlbiByaWdodCBub3cuXHJcbiAgICBjb25zdCBsb29wID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIik7XHJcbiAgICBsb29wLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgQm9vbGVhbihzdGF0ZS5sb29wKSk7XHJcbiAgICBsb29wLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcoQm9vbGVhbihzdGF0ZS5sb29wKSkpO1xyXG4gICAgbG9vcC50aXRsZSA9IHN0YXRlLmxvb3AgPyBcIkxvb3A6IG9uXCIgOiBcIkxvb3A6IG9mZlwiO1xyXG5cclxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5zcGVlZCB8fCAxKTtcclxuICAgIHJlbmRlclRyYWNrKGVsLCBzdGF0ZSk7XHJcbiAgICBhcHBseVBvc2l0aW9uKGVsLCBzdGF0ZS5wb3NpdGlvbik7XHJcbiAgICByZXR1cm4gZWw7XHJcbn1cclxuXHJcbi8vIEdlb21ldHJ5IHNoYXJlZCBieSByZW5kZXJpbmcgYW5kIGRyYWdnaW5nOiB3aGVyZSBhIHRpbWUgc2l0cyBvbiB0aGUgdHJhY2ssIDAuLjEuXHJcbmZ1bmN0aW9uIHRyYWNrRnJhY3Rpb24odGlja3MsIHQpIHtcclxuICAgIGNvbnN0IHNwYW4gPSB0aWNrc1t0aWNrcy5sZW5ndGggLSAxXSAtIHRpY2tzWzBdO1xyXG4gICAgaWYgKHNwYW4gPD0gMCkgcmV0dXJuIDE7XHJcbiAgICByZXR1cm4gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgKHQgLSB0aWNrc1swXSkgLyBzcGFuKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclRyYWNrKGVsLCBzdGF0ZSkge1xyXG4gICAgY29uc3QgeyB0aWNrcywgaW5kZXggfSA9IHN0YXRlO1xyXG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XHJcbiAgICB0cmFjay5fc3RhdGUgPSBzdGF0ZTsgICAgICAvLyB0aGUgZHJhZyBoYW5kbGVyIHJlYWRzIHRoZSBmcmVzaGVzdCBzdGF0ZSBmcm9tIGhlcmVcclxuXHJcbiAgICBjb25zdCB0aHVtYlQgPSB0aWNrc1tpbmRleF07XHJcbiAgICBjb25zdCBwZXJpb2RNcyA9IHN0YXRlLnBlcmlvZE1zO1xyXG4gICAgY29uc3Qgd2luZG93TXMgPSBzdGF0ZS53aW5kb3cgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHN0YXRlLndpbmRvdykpIDogbnVsbDtcclxuICAgIGNvbnN0IHNob3duTXMgPSB3aW5kb3dNcyAhPSBudWxsID8gd2luZG93TXMgOiBwZXJpb2RNcztcclxuXHJcbiAgICAvLyBUaGUgc3Bhbjogd2hhdCBpbnRlcnZhbCB0aGUgbWFwIGlzIHNob3dpbmcgcmlnaHQgbm93LiBUaGUgc3BhbiBkZXBpY3RzIHRoZSBzaGFyZWRcclxuICAgIC8vIHdpbmRvdyAtLSBvbmUgcGVyaW9kIGJ5IGRlZmF1bHQgLS0gYW5kIHBlci1sYXllciBkdXJhdGlvbnMgcmVtYWluIGFuIEFQSSBjb25jZXJuXHJcbiAgICAvLyB1bnRpbCBhIGRyYWcgb3ZlcnJpZGVzIHRoZW0gZm9yIGV2ZXJ5dGhpbmcgYXQgb25jZS5cclxuICAgIGNvbnN0IHNwYW4gPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BhblwiKTtcclxuICAgIGNvbnN0IHJpZ2h0ID0gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUKTtcclxuICAgIGNvbnN0IGxlZnQgPSBzaG93bk1zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSBzaG93bk1zKSA6IDA7XHJcbiAgICBzcGFuLnN0eWxlLmxlZnQgPSBgJHsobGVmdCAqIDEwMCkudG9GaXhlZCgyKX0lYDtcclxuICAgIHNwYW4uc3R5bGUud2lkdGggPSBgJHsoTWF0aC5tYXgoMCwgcmlnaHQgLSBsZWZ0KSAqIDEwMCkudG9GaXhlZCgyKX0lYDtcclxuICAgIHNwYW4uY2xhc3NMaXN0LnRvZ2dsZShcIm92ZXJyaWRlXCIsIHdpbmRvd01zICE9IG51bGwpO1xyXG5cclxuICAgIC8vIFRoZSB0cmFpbCBoYW5kbGUgcGFya3MgT04gdGhlIHRodW1iIHdoZW4gbm8gb3ZlcnJpZGUgaXMgYWN0aXZlIC0tIFwibm90IGdyYWJiZWRcIiAtLVxyXG4gICAgLy8gYW5kIHNpdHMgYXQgdGhlIHdpbmRvdydzIHN0YXJ0IHdoaWxlIG9uZSBpcy4gRHJvcHBpbmcgaXQgYmFjayBvbiB0aGUgdGh1bWIgY2xlYXJzLlxyXG4gICAgY29uc3QgdHJhaWwgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhaWxcIik7XHJcbiAgICBjb25zdCBhdCA9IHdpbmRvd01zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSB3aW5kb3dNcykgOiByaWdodDtcclxuICAgIHRyYWlsLnN0eWxlLmxlZnQgPSBgJHsoYXQgKiAxMDApLnRvRml4ZWQoMil9JWA7XHJcbiAgICB0cmFpbC5jbGFzc0xpc3QudG9nZ2xlKFwiYWN0aXZlXCIsIHdpbmRvd01zICE9IG51bGwpO1xyXG4gICAgdHJhaWwuc2V0QXR0cmlidXRlKFwiYXJpYS12YWx1ZXRleHRcIiwgc3RhdGUud2luZG93IHx8IFwibm8gdHJhaWxpbmcgd2luZG93XCIpO1xyXG4gICAgLy8gTm8gZml4ZWQtbXMgZ3JpZCAoY2FsZW5kYXIgcGVyaW9kcykgbWVhbnMgbm90aGluZyBzZW5zaWJsZSB0byBzbmFwIHRvLlxyXG4gICAgdHJhaWwuc3R5bGUuZGlzcGxheSA9IHN0YXRlLmdyaWRNcyA/IFwiXCIgOiBcIm5vbmVcIjtcclxuXHJcbiAgICBjb25zdCBydWxlciA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1ydWxlclwiKTtcclxuICAgIGNvbnN0IGtleSA9IGAke3RpY2tzWzBdfXwke3RpY2tzLmxlbmd0aH18JHtzdGF0ZS5ncmlkTXN9fCR7cGVyaW9kTXN9YDtcclxuICAgIGlmIChydWxlci5fa2V5ICE9PSBrZXkpIHtcclxuICAgICAgICBydWxlci5fa2V5ID0ga2V5O1xyXG4gICAgICAgIHJ1bGVyLmlubmVySFRNTCA9IFwiXCI7XHJcbiAgICAgICAgZm9yIChjb25zdCBtYXJrIG9mIGJ1aWxkUnVsZXIodGlja3MsIHN0YXRlLmdyaWRNcywgdCA9PiBmb3JtYXRUaWNrTGFiZWwodCwgcGVyaW9kTXMpKSkge1xyXG4gICAgICAgICAgICBjb25zdCBtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIG0uY2xhc3NOYW1lID0gbWFyay5tYWpvciA/IFwic3dpZnRtYXAtdGltZS1tYXJrIG1ham9yXCIgOiBcInN3aWZ0bWFwLXRpbWUtbWFya1wiO1xyXG4gICAgICAgICAgICBtLnN0eWxlLmxlZnQgPSBgJHsobWFyay5mcmFjdGlvbiAqIDEwMCkudG9GaXhlZCgyKX0lYDtcclxuICAgICAgICAgICAgaWYgKG1hcmsubGFiZWwpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgICAgICAgICAgbGFiLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1tYXJrLWxhYmVsXCI7XHJcbiAgICAgICAgICAgICAgICBsYWIudGV4dENvbnRlbnQgPSBtYXJrLmxhYmVsO1xyXG4gICAgICAgICAgICAgICAgbS5hcHBlbmRDaGlsZChsYWIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJ1bGVyLmFwcGVuZENoaWxkKG0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuLy8gRHJhZ2dpbmcgdGhlIHRyYWlsIGhhbmRsZS4gU25hcHMgdG8gdGhlIGdjZCBncmlkIHNvIGV2ZXJ5IHN0b3AgaXMgYSBib3VuZGFyeSB0aGUgZGF0YVxyXG4vLyBvciB0aGUgaW50ZXJ2YWwgYWN0dWFsbHkgbmFtZXM7IHRoZSBkaXN0YW5jZSB0byB0aGUgdGh1bWIsIGluIHdob2xlIGdyaWQgc3RlcHMsIElTIHRoZVxyXG4vLyB3aW5kb3cuIFplcm8gc3RlcHMgLS0gZHJvcHBlZCBvbiB0aGUgdGh1bWIgLS0gY2xlYXJzIHRoZSBvdmVycmlkZS5cclxuZnVuY3Rpb24gYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycykge1xyXG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XHJcbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcclxuXHJcbiAgICBmdW5jdGlvbiBpc29Gcm9tRXZlbnQoZXYpIHtcclxuICAgICAgICBjb25zdCBzdGF0ZSA9IHRyYWNrLl9zdGF0ZTtcclxuICAgICAgICBjb25zdCByZWN0ID0gdHJhY2suZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUuZ3JpZE1zIHx8IHJlY3Qud2lkdGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHVuY2xhbXBlZCBvbiB0aGUgbGVmdDogdGhlIHdpbmRvdyBpcyBcImhvdyBmYXIgYmFjayBmcm9tIHRoZVxyXG4gICAgICAgIC8vIGxlYWQgcG9pbnRcIiwgYW5kIHRoYXQgbWF5IHJlYWNoIHBhc3QgdGhlIGJhcidzIHN0YXJ0IC0tIGVzcGVjaWFsbHkgd2hlbiB0aGVcclxuICAgICAgICAvLyBsZWFkIHNpdHMgZWFybHkgb24gdGhlIGJhciBhbmQgbW9zdCBvZiBpdHMgdHJhaWwgaXMgb2ZmLXNjcmVlbi4gQ2xhbXBpbmcgaGVyZVxyXG4gICAgICAgIC8vIGNhcHBlZCB0aGUgd2luZG93IGF0IHRoZSB2aXNpYmxlIHBhc3QsIHdoaWNoIHBpbm5lZCB0aGUgaGFuZGxlIHRvIHRoZSBiYXInc1xyXG4gICAgICAgIC8vIHN0YXJ0IGFuZCBtYWRlIGFueXRoaW5nIHdpZGVyIGltcG9zc2libGUgdG8gc2V0LiBPbmx5IHRoZSBEUkFXSU5HIGNsYW1wcy5cclxuICAgICAgICBjb25zdCBmcmFjID0gTWF0aC5taW4oMSwgKGV2LmNsaWVudFggLSByZWN0LmxlZnQpIC8gcmVjdC53aWR0aCk7XHJcbiAgICAgICAgY29uc3QgdDAgPSBzdGF0ZS50aWNrc1swXTtcclxuICAgICAgICBjb25zdCBzcGFuTXMgPSBzdGF0ZS50aWNrc1tzdGF0ZS50aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xyXG4gICAgICAgIGNvbnN0IHRodW1iVCA9IHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XTtcclxuICAgICAgICBjb25zdCBkaXN0ID0gdGh1bWJUIC0gKHQwICsgZnJhYyAqIHNwYW5Ncyk7XHJcbiAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGRpc3QgLyBzdGF0ZS5ncmlkTXMpKTtcclxuICAgICAgICByZXR1cm4gc3RlcHMgPT09IDAgPyBudWxsIDogbXNUb1BlcmlvZElTTyhzdGVwcyAqIHN0YXRlLmdyaWRNcyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTW92ZSBhbmQgcmVsZWFzZSBsaXN0ZW4gb24gdGhlIGRvY3VtZW50IGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIGRyYWc6IHRoZSBoYW5kbGVcclxuICAgIC8vIGlzIDEycHggd2lkZSwgdGhlIGN1cnNvciBsZWF2ZXMgaXQgb24gdGhlIGZpcnN0IGZhc3QgbW92ZW1lbnQsIGFuZCBldmVudHMgdGhhdFxyXG4gICAgLy8gdGFyZ2V0IHdoYXRldmVyIGlzIHVuZGVybmVhdGggd291bGQgc3R1dHRlciB0aGUgZHJhZyBhbmQgY291bGQgc3dhbGxvdyB0aGUgcmVsZWFzZVxyXG4gICAgLy8gZW50aXJlbHkgLS0gYW4gdW5jb21taXR0ZWQgZHJhZyB0aGVuIHNuYXBzIGJhY2sgb24gdGhlIG5leHQgc3luYy5cclxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCBldiA9PiB7XHJcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBldi5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAvLyBDYXB0dXJlIHJldGFyZ2V0cyBldmVyeSBwb2ludGVyIGV2ZW50IHRvIHRoZSBoYW5kbGUgdW50aWwgcmVsZWFzZSwgbm8gbWF0dGVyXHJcbiAgICAgICAgLy8gd2hlcmUgdGhlIGN1cnNvciBpcy4gV2l0aG91dCBpdCwgbGV0dGluZyBnbyB3aXRoIHRoZSBwb2ludGVyIG92ZXIgdGhlIG1hcCBoYW5kc1xyXG4gICAgICAgIC8vIHBvaW50ZXJ1cCB0byBMZWFmbGV0J3MgY29udGFpbmVyIGhhbmRsZXJzLCBhbmQgYSByZWxlYXNlIHRoZXkgc3dhbGxvdyBuZXZlclxyXG4gICAgICAgIC8vIHJlYWNoZXMgdGhlIGRvY3VtZW50IGxpc3RlbmVyIC0tIHRoZSBkcmFnIHN0YXlzIHVuY29tbWl0dGVkIGFuZCB0aGUgbmV4dCBzeW5jXHJcbiAgICAgICAgLy8gc25hcHMgdGhlIGhhbmRsZSBob21lLiBUaGUgZG9jdW1lbnQgbGlzdGVuZXJzIGJlbG93IHJlbWFpbiBhcyB0aGUgZmFsbGJhY2sgZm9yXHJcbiAgICAgICAgLy8gZW52aXJvbm1lbnRzIHdpdGhvdXQgY2FwdHVyZTsgd2l0aCBpdCwgcmV0YXJnZXRlZCBldmVudHMgc3RpbGwgYnViYmxlIHRvIHRoZW0uXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKSB0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZShldi5wb2ludGVySWQpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBzeW50aGV0aWMgZXZlbnRzIGhhdmUgbm8gYWN0aXZlIHBvaW50ZXI7IGZhbGwgYmFjayB0byBidWJibGluZyAqLyB9XHJcblxyXG4gICAgICAgIGNvbnN0IG1vdmUgPSBlID0+IHtcclxuICAgICAgICAgICAgY29uc3QgaXNvID0gaXNvRnJvbUV2ZW50KGUpO1xyXG4gICAgICAgICAgICBpZiAoaXNvICE9PSB1bmRlZmluZWQpIGhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29uc3QgZmluaXNoID0gZSA9PiB7XHJcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcclxuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xyXG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBmaW5pc2gpO1xyXG4gICAgICAgICAgICBjb25zdCBpc28gPSBpc29Gcm9tRXZlbnQoZSk7XHJcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dDb21taXQoaXNvKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcclxuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XHJcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEtleWJvYXJkOiBvbmUgZ3JpZCBzdGVwIHBlciBhcnJvdywgRGVsZXRlL0hvbWUgdG8gY2xlYXIuIFNhbWUgY29udHJhY3QgYXMgdGhlIGRyYWcuXHJcbiAgICB0cmFpbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBldiA9PiB7XHJcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XHJcbiAgICAgICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUuZ3JpZE1zKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgY3VycmVudCA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiAwO1xyXG4gICAgICAgIGxldCBuZXh0O1xyXG4gICAgICAgIGlmIChldi5rZXkgPT09IFwiQXJyb3dMZWZ0XCIpIG5leHQgPSBjdXJyZW50ICsgc3RhdGUuZ3JpZE1zO1xyXG4gICAgICAgIGVsc2UgaWYgKGV2LmtleSA9PT0gXCJBcnJvd1JpZ2h0XCIpIG5leHQgPSBNYXRoLm1heCgwLCBjdXJyZW50IC0gc3RhdGUuZ3JpZE1zKTtcclxuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiRGVsZXRlXCIgfHwgZXYua2V5ID09PSBcIkhvbWVcIikgbmV4dCA9IDA7XHJcbiAgICAgICAgZWxzZSByZXR1cm47XHJcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChuZXh0ID4gMCA/IG1zVG9QZXJpb2RJU08obmV4dCkgOiBudWxsKTtcclxuICAgIH0pO1xyXG59XHJcbiIsICIvLyBUaW1lIGZpbHRlcmluZyBvbiB0aGUgR1BVLCBmb3IgcG9pbnQgbGF5ZXJzLlxyXG4vL1xyXG4vLyBUaGUgY29vcmRpbmF0ZXMgYWxyZWFkeSBsaXZlIGluIEdQVSBidWZmZXJzOyByZWJ1aWxkaW5nIHRoZSBtZXJnZWQgbGF5ZXIgcGVyIHRpY2sgdGhyZXdcclxuLy8gdGhhdCBhd2F5IGFuZCByZS1mZWQgZ2xpZnkgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTIC0tIG1lYXN1cmVkIGF0IH4yLjZzIHBlciB3aW5kb3dcclxuLy8gY2hhbmdlIGF0IHRoYXQgc2NhbGUsIHdpdGggYWxsb2NhdGlvbiBjaHVybiB0aGF0IGNvdWxkIGNyYXNoIHRoZSB0YWIgd2hlbiBjaGFuZ2VzXHJcbi8vIHN0YWNrZWQuIEluc3RlYWQsIGVhY2ggcG9pbnQncyB0aW1lIGludGVydmFsIGFuZCBpdHMgbGF5ZXIncyBkdXJhdGlvbiByaWRlIGFsb25nIGFzXHJcbi8vIHZlcnRleCBhdHRyaWJ1dGVzIHVwbG9hZGVkIG9uY2UsIGFuZCB0aGUgY3VycmVudCB0aWNrIGlzIGEgdW5pZm9ybTogYSB0aWNrIG9yIHdpbmRvd1xyXG4vLyBjaGFuZ2UgY29zdHMgdHdvIGZsb2F0cyBhbmQgYSByZWRyYXcuXHJcbi8vXHJcbi8vIGdsaWZ5IG1ha2VzIHRoaXMgcG9zc2libGUgd2l0aG91dCBmb3JraW5nIGl0OiB2ZXJ0ZXhTaGFkZXJTb3VyY2UgaXMgYW4gb3ZlcnJpZGFibGVcclxuLy8gc2V0dGluZyAodGhlIHBpbiBmcmFnbWVudCBzaGFkZXIgYWxyZWFkeSB1c2VzIHRoZSBzYW1lIGRvb3IpLCBpbnN0YW5jZXMgZXhwb3NlIHRoZWlyXHJcbi8vIGdsL3Byb2dyYW0vY2FudmFzLCBhdHRyaWJ1dGVzIGFyZSBib3VuZCBvbmNlIGF0IHNldHVwLCBhbmQgdGhlIHBlci1mcmFtZSBkcmF3IHRvdWNoZXNcclxuLy8gb25seSB0aGUgbWF0cml4IHVuaWZvcm0gLS0gc28gZXh0cmEgYXR0cmlidXRlcyBib3VuZCBhZnRlciBzZXR1cCBwZXJzaXN0LCBhbmQgdW5pZm9ybVxyXG4vLyB1cGRhdGVzIHRha2UgZWZmZWN0IG9uIHRoZSBuZXh0IHJlZHJhdy5cclxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIHBlcmlvZFRvTXMsIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFRpbWVzIHRyYXZlbCBhcyBmbG9hdDMyIG9uIHRoZSBHUFUsIHdob3NlIGludGVnZXJzIGFyZSBleGFjdCBvbmx5IHRvIDJeMjQuIEVwb2NoIG1zIGlzXHJcbi8vIGhvcGVsZXNzIGF0IHRoYXQgcHJlY2lzaW9uLCBzbyB0aW1lcyBhcmUgcmViYXNlZCB0byB0aGUgYnVja2V0J3MgZWFybGllc3Qgc3RhcnQgYW5kXHJcbi8vIGV4cHJlc3NlZCBpbiBzZWNvbmRzOiBleGFjdCB0byB+MTk0IGRheXMgb2Ygc3BhbiwgYW5kIGEgMnMgcm91bmRpbmcgYmV5b25kIHRoYXQgaXNcclxuLy8gaW52aXNpYmxlIGF0IGFueSB6b29tIGEgdGltZSBzbGlkZXIgbWFrZXMgc2Vuc2UgYXQuXHJcbmNvbnN0IEFMV0FZUyA9IDYuM2U4OyAgIC8vIH4yMCB5ZWFycywgaW4gc2Vjb25kczogdGhlIFwiZHVyYXRpb25cIiBvZiBjdW11bGF0aXZlIGxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHRoZSBzcGFuIGhhbGYtd2lkdGggb2YgcG9pbnRzIHdpdGggbm8gcmVhZGFibGUgdGltZS5cclxuXHJcbi8vIFBlci1idWNrZXQgbGF5ZXItdmlzaWJpbGl0eSBzbG90cyBpbiB0aGUgdmVydGV4IHNoYWRlci4gRWFjaCBmbG9hdCBhcnJheSBlbGVtZW50XHJcbi8vIG9jY3VwaWVzIGEgZnVsbCB1bmlmb3JtIHZlY3RvciBpbiBFUyBHTFNMIHBhY2tpbmcsIGFuZCB0aGUgc3BlYyBndWFyYW50ZWVzIG9ubHkgMTI4XHJcbi8vIHZlcnRleCB1bmlmb3JtIHZlY3RvcnMgLS0gNjQgc2xvdHMgbGVhdmVzIGNvbWZvcnRhYmxlIHJvb20gZm9yIHRoZSBtYXRyaXggYW5kIHRoZSB0aW1lXHJcbi8vIHVuaWZvcm1zLiBBIGJ1Y2tldCB3aXRoIG1vcmUgbGF5ZXJzIHRoYW4gc2xvdHMgZmFsbHMgYmFjayB0byByZWJ1aWxkLXBlci10b2dnbGUuXHJcbi8vIChQYWNraW5nIGZvdXIgbGF5ZXJzIHBlciB2ZWM0IHdvdWxkIHF1YWRydXBsZSB0aGlzIGlmIGFueW9uZSBldmVyIG5lZWRzIGl0LilcclxuZXhwb3J0IGNvbnN0IExBWUVSX1NMT1RTID0gNjQ7XHJcblxyXG4vLyBDaGVhcCBraWxsIHN3aXRjaGVzOiBpZiB3aXJpbmcgdGhlIEdMIHN0YXRlIGV2ZXIgZmFpbHMgKGEgZnV0dXJlIGdsaWZ5IHZlcnNpb24gbW92aW5nXHJcbi8vIGl0cyBpbnRlcm5hbHMpLCB0aGUgYWZmZWN0ZWQgZmFtaWx5IGZhbGxzIGJhY2sgdG8gdGhlIENQVSByZWJ1aWxkIHBhdGguIFBvaW50cyBhbmRcclxuLy8gdmVjdG9ycyBhcmUgc2VwYXJhdGUgZmxhZ3MgLS0gYSB2ZWN0b3IgaW50cm9zcGVjdGlvbiBmYWlsdXJlIG11c3Qgbm90IGNvc3QgcG9pbnRzXHJcbi8vIHRoZWlyIEdQVSBwYXRoLlxyXG5sZXQgZ3B1T2sgPSB0cnVlO1xyXG5leHBvcnQgZnVuY3Rpb24gZ3B1VGltZUF2YWlsYWJsZSgpIHsgcmV0dXJuIGdwdU9rOyB9XHJcbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlR3B1VGltZShyZWFzb24pIHtcclxuICAgIGlmIChncHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZpbHRlcmluZyBkaXNhYmxlZDogJHtyZWFzb259LiBgICtcclxuICAgICAgICBgRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2suYCk7XHJcbiAgICBncHVPayA9IGZhbHNlO1xyXG59XHJcbmxldCB2ZWN0b3JHcHVPayA9IHRydWU7XHJcbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JHcHVBdmFpbGFibGUoKSB7IHJldHVybiB2ZWN0b3JHcHVPazsgfVxyXG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZVZlY3RvckdwdShyZWFzb24pIHtcclxuICAgIGlmICh2ZWN0b3JHcHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZvciBsaW5lcy9wb2x5Z29ucyBkaXNhYmxlZDogYCArXHJcbiAgICAgICAgYCR7cmVhc29ufS4gRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2sgZm9yIHRob3NlIGJ1Y2tldHMuYCk7XHJcbiAgICB2ZWN0b3JHcHVPayA9IGZhbHNlO1xyXG59XHJcblxyXG4vLyBUaGUgZGVmYXVsdCBwb2ludHMgdmVydGV4IHNoYWRlciAocmVhZCBvdXQgb2YgbGVhZmxldC5nbGlmeSAzLjMuMCkgd2l0aCB0aGUgd2luZG93XHJcbi8vIHRlc3QgYWRkZWQuIEEgaGlkZGVuIHBvaW50IGdldHMgc2l6ZSAwIGFuZCBhIHBvc2l0aW9uIG91dHNpZGUgY2xpcCBzcGFjZSwgc28gbmVpdGhlclxyXG4vLyB0aGUgdmlzaWJsZSBwYXNzIG5vciB0aGUgc2hhcmVkLXByb2dyYW0gcGlja2luZyBwYXNzIGV2ZXIgcmFzdGVyaXNlcyBpdC5cclxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVWZXJ0ZXhTaGFkZXIoKSB7XHJcbiAgICByZXR1cm4gYHVuaWZvcm0gbWF0NCBtYXRyaXg7XHJcbmF0dHJpYnV0ZSB2ZWM0IHZlcnRleDtcclxuYXR0cmlidXRlIHZlYzQgY29sb3I7XHJcbmF0dHJpYnV0ZSBmbG9hdCBwb2ludFNpemU7XHJcbmF0dHJpYnV0ZSB2ZWMyIGFUaW1lU3BhbjtcclxuYXR0cmlidXRlIGZsb2F0IGFEdXJhdGlvbjtcclxuYXR0cmlidXRlIGZsb2F0IGFMYXllcjtcclxudW5pZm9ybSBmbG9hdCB1VGljaztcclxudW5pZm9ybSBmbG9hdCB1T3ZlcnJpZGU7XHJcbnVuaWZvcm0gZmxvYXQgdUxheWVyVmlzWyR7TEFZRVJfU0xPVFN9XTtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxuXHJcbnZvaWQgbWFpbigpIHtcclxuICAvLyBBIG5lZ2F0aXZlIGR1cmF0aW9uIGlzIHRoZSBmYWRlIGZsYWc6IHxhRHVyYXRpb258IGlzIHRoZSB3aW5kb3csIHRoZSBzaWduIHNheXMgdGhpc1xyXG4gIC8vIHBvaW50IGRpbXMgd2l0aCBhZ2UuIEEgc2hhcmVkIG92ZXJyaWRlIGtlZXBzIHRoZSBwb2ludCdzIG93biBmYWRlIHByZWZlcmVuY2UuXHJcbiAgYm9vbCBmYWRlcyA9IGFEdXJhdGlvbiA8IDAuMDtcclxuICBmbG9hdCBkdXIgPSB1T3ZlcnJpZGUgPj0gMC4wID8gdU92ZXJyaWRlIDogYWJzKGFEdXJhdGlvbik7XHJcbiAgLy8gSGFsZi1vcGVuICh0aWNrIC0gZHVyLCB0aWNrXSwgbWF0Y2hpbmcgZmVhdHVyZUluV2luZG93IG9uIHRoZSBDUFUgc2lkZSAtLSBBTkRlZCB3aXRoXHJcbiAgLy8gdGhlIHBvaW50J3MgbGF5ZXIgYmVpbmcgdmlzaWJsZS4gTGF5ZXIgdG9nZ2xlcyBhcmUgb25lIHVuaWZvcm0gZWxlbWVudCwgbm90IGFcclxuICAvLyByZWJ1aWxkOiB1bmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZS1mZWVkIGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUy5cclxuICBib29sIHZpc2libGUgPSBhVGltZVNwYW4ueSA+ICh1VGljayAtIGR1cikgJiYgYVRpbWVTcGFuLnggPD0gdVRpY2tcclxuICAgICAgJiYgdUxheWVyVmlzW2ludChhTGF5ZXIpXSA+IDAuNTtcclxuICBnbF9Qb2ludFNpemUgPSB2aXNpYmxlID8gcG9pbnRTaXplIDogMC4wO1xyXG4gIGdsX1Bvc2l0aW9uID0gdmlzaWJsZSA/IG1hdHJpeCAqIHZlcnRleCA6IHZlYzQoMi4wLCAyLjAsIDIuMCwgMS4wKTtcclxuICAvLyBBZ2UgcnVucyBmcm9tIHRoZSBmZWF0dXJlJ3MgZW5kOyBuZXdlc3QgaXMgb3BhcXVlLCB0aGUgdHJhaWxpbmcgZWRnZSByZWFjaGVzIHplcm8uXHJcbiAgZmxvYXQgYWxwaGEgPSBmYWRlcyA/IGNsYW1wKDEuMCAtICh1VGljayAtIGFUaW1lU3Bhbi55KSAvIGR1ciwgMC4wLCAxLjApIDogMS4wO1xyXG4gIF9jb2xvciA9IHZlYzQoY29sb3IucmdiLCBjb2xvci5hICogYWxwaGEpO1xyXG59XHJcbmA7XHJcbn1cclxuXHJcbi8vIFBlci1sYXllciBkdXJhdGlvbiBpbiBzZWNvbmRzOiBudWxsIGFjY3VtdWxhdGVzLCBcInBlcmlvZFwiIGlzIHRoZSBzaGFyZWQgaW50ZXJ2YWwsXHJcbi8vIGFuIElTTyBzdHJpbmcgaXMgaXRzZWxmOyBhbnl0aGluZyB1bnBhcnNlYWJsZSBmYWxscyBiYWNrIHRvIHRoZSBpbnRlcnZhbC5cclxuZnVuY3Rpb24gZHVyYXRpb25TZWNvbmRzKHNwZWMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoc3BlYyA9PT0gbnVsbCB8fCBzcGVjID09PSB1bmRlZmluZWQpIHJldHVybiBBTFdBWVM7XHJcbiAgICBpZiAoc3BlYyA9PT0gXCJwZXJpb2RcIikgcmV0dXJuIChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XHJcbiAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xyXG4gICAgcmV0dXJuIG1zID8gbXMgLyAxMDAwIDogKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcclxufVxyXG5cclxuLy8gQnVpbGRzIHRoZSBwZXItcG9pbnQgYXR0cmlidXRlIGFycmF5cyBmb3Igb25lIG1lcmdlZCBidWNrZXQsIGluIHRoZSBleGFjdCBvcmRlciB0aGVcclxuLy8gYnVja2V0IGZlZWRzIHBvaW50cyB0byBnbGlmeTogbGF5ZXIgYnkgbGF5ZXIsIGluZGV4IDAuLm4tMSwgd2l0aCBzaW5nbGUtYGxvY2F0aW9uYFxyXG4vLyBsYXllcnMgY29udHJpYnV0aW5nIG9uZSBwb2ludC4gUG9pbnRzIGluIGxheWVycyB3aXRob3V0IHRpbWUgbWV0YWRhdGEgLS0gYW5kIHBvaW50c1xyXG4vLyB3aG9zZSB0aW1lIHdhcyB1bnJlYWRhYmxlIChOYU4pIC0tIGdldCBhIHNwYW4gdGhhdCBpcyB2aXNpYmxlIGF0IGV2ZXJ5IHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGxldCBoYXNUaW1lID0gZmFsc2U7XHJcbiAgICBjb25zdCBwZXJMYXllciA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgIGNvbnN0IGNvdW50ID0gYnVmID8gYnVmLmJ5dGVMZW5ndGggLyAxNiA6IChsYXllci5sb2NhdGlvbiA/IDEgOiAwKTtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBpZiAobGF5ZXIudGltZSkgaGFzVGltZSA9IHRydWU7XHJcbiAgICAgICAgcGVyTGF5ZXIucHVzaCh7IGxheWVyLCBjb3VudCwgdGltZXMgfSk7XHJcbiAgICAgICAgdG90YWwgKz0gY291bnQ7XHJcbiAgICB9XHJcbiAgICBpZiAoIWhhc1RpbWUpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcblxyXG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcclxuICAgIGZvciAoY29uc3QgeyB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBjb25zdCBsYXllcklkcyA9IFtdO1xyXG4gICAgbGV0IG91dCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJJZHMubGVuZ3RoO1xyXG4gICAgICAgIGxheWVySWRzLnB1c2gobGF5ZXIuaWQpO1xyXG4gICAgICAgIGNvbnN0IGR1ciA9IGxheWVyLnRpbWUgPyBkdXJhdGlvblNlY29uZHMobGF5ZXIudGltZS5kdXJhdGlvbiwgcGVyaW9kTXMpIDogQUxXQVlTO1xyXG4gICAgICAgIC8vIFRoZSBmYWRlIGZsYWcgcmlkZXMgdGhlIGR1cmF0aW9uJ3Mgc2lnbiwgc28gaXQgY29zdHMgbm8gZXh0cmEgYXR0cmlidXRlLlxyXG4gICAgICAgIC8vIFRpbWVsZXNzIChOYU4pIHBvaW50cyBrZWVwIGEgcG9zaXRpdmUgZHVyYXRpb246IHdpdGggbm8gYWdlLCBub3RoaW5nIHRvIGZhZGUuXHJcbiAgICAgICAgY29uc3Qgc2lnbmVkRHVyID0gbGF5ZXIudGltZSAmJiBsYXllci50aW1lLmZhZGUgPyAtZHVyIDogZHVyO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IHRpbWVzID8gdGltZXNbaSAqIDJdIDogTmFOO1xyXG4gICAgICAgICAgICBjb25zdCBlbmQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyICsgMV0gOiBOYU47XHJcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpKSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IC1BTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IChzdGFydCAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IChlbmQgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBzaWduZWREdXI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGlkeDtcclxuICAgICAgICAgICAgb3V0Kys7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgc3BhbnMsIGR1cnMsIGxheWVySWR4LCBsYXllcklkcywgY291bnQ6IHRvdGFsIH07XHJcbn1cclxuXHJcbi8vIFBlci1mZWF0dXJlIHRpbWUgbWV0YWRhdGEgZm9yIGEgdmVjdG9yIGJ1Y2tldCAobGluZXMvcG9seWdvbnMpLiBTYW1lIGVuY29kaW5ncyBhc1xyXG4vLyB0aGUgcG9pbnQgcGF0aCAtLSByZWJhc2VkIGZsb2F0MzIgc2Vjb25kcywgc2lnbi1wYWNrZWQgZmFkZSwgYWx3YXlzLXZpc2libGUgc3BhbnNcclxuLy8gZm9yIHRpbWVsZXNzIG9yIG5vbi10aW1lIGxheWVycy5cclxuLy9cclxuLy8gQSBwb2x5bGluZSB3aG9zZSA6OnRpbWVzIGJ1ZmZlciBob2xkcyBvbmUgW3N0YXJ0LCBlbmRdIHBhaXIgUEVSIFZFUlRFWCBhbmltYXRlc1xyXG4vLyBwZXIgc2VnbWVudCB3aXRoaW4gb25lIGxheWVyOiBzZWdtZW50IGsgc3BhbnMgdmVydGV4IGsncyBzdGFydCB0byB2ZXJ0ZXggaysxJ3NcclxuLy8gZW5kLCBhbmQgYmVjYXVzZSBnbGlmeSBidWlsZHMgMiBkZWRpY2F0ZWQgR0wgdmVydGljZXMgcGVyIHNlZ21lbnQgLS0gc2VnbWVudHNcclxuLy8gbmV2ZXIgc2hhcmUgdmVydGljZXMgLS0gYm90aCBlbmRwb2ludHMgY2FycnkgdGhlIHNhbWUgc3BhbiBhbmQgc2VnbWVudHMgYXBwZWFyXHJcbi8vIGF0b21pY2FsbHkuIFRoYXQgaXMgd2hhdCBsZXRzIGEgd2hvbGUgc2VnbWVudGVkIHRyYWNrIHJpZGUgT05FIGxheWVyIHNsb3QgdGhlIHdheVxyXG4vLyBhIDIwMGstcG9pbnQgbGF5ZXIgZG9lcywgaW5zdGVhZCBvZiBvbmUgc2xvdCBwZXIgY2h1bmsgYWdhaW5zdCB0aGUgNjQgY2VpbGluZy5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBwZXJGZWF0dXJlID0gbGF5ZXJzTGlzdC5tYXAoKGxheWVyLCBpZHgpID0+IHtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcclxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XHJcbiAgICAgICAgaWYgKCF0aW1lcyB8fCAodGltZXMubGVuZ3RoID09PSAyICYmIE51bWJlci5pc05hTih0aW1lc1swXSkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiAtQUxXQVlTLCBlbmQ6IEFMV0FZUywgZHVyOiBBTFdBWVMsIGlkeCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBuVmVydHMgPSB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIiAmJiB0aW1lcy5sZW5ndGggPiAyXHJcbiAgICAgICAgICAgICAgICAmJiB0aW1lcy5sZW5ndGggPT09IG5WZXJ0cyAqIDIpIHtcclxuICAgICAgICAgICAgLy8gU2VnbWVudHMgbmV2ZXIgY3Jvc3MgYSBwYXJ0IGJvdW5kYXJ5OiBhIG11bHRpLXBhcnQgbGluZSBkcmF3c1xyXG4gICAgICAgICAgICAvLyBuVmVydHMgLSBwYXJ0cyBzZWdtZW50cywgYW5kIGEgc3BhbiBidWlsdCBmcm9tIG9uZSBwYXJ0J3MgbGFzdFxyXG4gICAgICAgICAgICAvLyB2ZXJ0ZXggdG8gdGhlIG5leHQgcGFydCdzIGZpcnN0IHdvdWxkIGJlIHRoZSBwaGFudG9tIHNlZ21lbnRcclxuICAgICAgICAgICAgLy8gcmVhcHBlYXJpbmcgaW4gdGhlIHRpbWUgcGF0aCAtLSBvbmUgZXh0cmEgc3BhbiwgYW5kIGV2ZXJ5IGF0dHJpYnV0ZVxyXG4gICAgICAgICAgICAvLyBhZnRlciBpdCBzaGVhcnMgKHRoZSBsZW5ndGggY2hlY2sgdGhlbiBkcm9wcyB0aGUgd2hvbGUgZmVhdHVyZSB0b1xyXG4gICAgICAgICAgICAvLyBpdHMgb3ZlcmFsbCBzcGFuKS4gV2FsayB0aGUgcGFydHMgdGhlIHdheSB0aGUgcmVuZGVyZXIgZHJhd3MgdGhlbS5cclxuICAgICAgICAgICAgY29uc3QgbGVuZ3RocyA9IEFycmF5LmlzQXJyYXkobGF5ZXIucGFydHMpICYmIGxheWVyLnBhcnRzLmxlbmd0aCA+IDFcclxuICAgICAgICAgICAgICAgID8gbGF5ZXIucGFydHMgOiBbblZlcnRzXTtcclxuICAgICAgICAgICAgY29uc3Qgc2VncyA9IGxlbmd0aHMucmVkdWNlKChhLCBuKSA9PiBhICsgTWF0aC5tYXgoMCwgbiAtIDEpLCAwKTtcclxuICAgICAgICAgICAgY29uc3Qgc2VnID0gbmV3IEZsb2F0NjRBcnJheShzZWdzICogMik7XHJcbiAgICAgICAgICAgIGxldCBrID0gMCwgb2Zmc2V0ID0gMDtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBuIG9mIGxlbmd0aHMpIHtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGogPSAwOyBqICsgMSA8IG47IGorKykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHMgPSB0aW1lc1sob2Zmc2V0ICsgaikgKiAyXTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBlID0gdGltZXNbKG9mZnNldCArIGogKyAxKSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHMpIHx8IE51bWJlci5pc05hTihlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gLUFMV0FZUzsgICAgICAvLyBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDIgKyAxXSA9IEFMV0FZUztcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gKHMgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gKGUgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGsrKztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG9mZnNldCArPSBuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIE92ZXJhbGwgc3BhbiByaWRlcyBhbG9uZyBhcyB0aGUgZmFsbGJhY2sgaWYgY291bnRzIGV2ZXIgbWlzYWxpZ24uXHJcbiAgICAgICAgICAgIHJldHVybiB7IHNlZywgc3RhcnQ6IHNlZ1swXSwgZW5kOiBzZWdbc2VnLmxlbmd0aCAtIDFdLFxyXG4gICAgICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAodGltZXNbMF0gLSBiYXNlKSAvIDEwMDAsIGVuZDogKHRpbWVzWzFdIC0gYmFzZSkgLyAxMDAwLFxyXG4gICAgICAgICAgICAgICAgIGR1cjogc2lnbmVkRHVyLCBpZHggfTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgcGVyRmVhdHVyZSwgbGF5ZXJJZHM6IGxheWVyc0xpc3QubWFwKGwgPT4gbC5pZCkgfTtcclxufVxyXG5cclxuLy8gQSB2ZWN0b3IgbGF5ZXIncyB2ZXJ0ZXggY291bnQgZnJvbSB3aGljaGV2ZXIgdHJhbnNwb3J0IGNhcnJpZXMgaXRzIGNvb3JkaW5hdGVzOlxyXG4vLyB0aGUgYmluYXJ5IGJ1ZmZlciAoMiBmbG9hdDY0IHBlciB2ZXJ0ZXgpIG9yIGlubGluZSBgbG9jYXRpb25zYC5cclxuZnVuY3Rpb24gdmVydGV4Q291bnRPZihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmIChyYXcpIHJldHVybiAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCB8fCAwKSAvIDE2O1xyXG4gICAgcmV0dXJuIChsYXllci5sb2NhdGlvbnMgfHwgW10pLmxlbmd0aDtcclxufVxyXG5cclxuLy8gRXhwYW5kcyBwZXItZmVhdHVyZSB2YWx1ZXMgdG8gcGVyLUdMLXZlcnRleCBhcnJheXMgZ2l2ZW4gZWFjaCBmZWF0dXJlJ3MgdmVydGV4IGNvdW50LlxyXG4vLyBQdXJlLCBzbyB0aGUgYWxpZ25tZW50IGxvZ2ljIGlzIHRpZXItMSB0ZXN0YWJsZSBhd2F5IGZyb20gYW55IEdMIGNvbnRleHQuXHJcbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQZXJGZWF0dXJlKHBlckZlYXR1cmUsIGNvdW50cykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGZvciAoY29uc3QgYyBvZiBjb3VudHMpIHRvdGFsICs9IGM7XHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBsZXQgb3V0ID0gMDtcclxuICAgIHBlckZlYXR1cmUuZm9yRWFjaCgoZiwgaSkgPT4ge1xyXG4gICAgICAgIC8vIFBlci1zZWdtZW50IHNwYW5zOiBHTCB2ZXJ0ZXggdiBiZWxvbmdzIHRvIHNlZ21lbnQgdiA+PiAxIChnbGlmeSBkcmF3c1xyXG4gICAgICAgIC8vIDIgZGVkaWNhdGVkIHZlcnRpY2VzIHBlciBzZWdtZW50KSwgc28gYm90aCBlbmRwb2ludHMgdGFrZSB0aGUgc2VnbWVudCdzXHJcbiAgICAgICAgLy8gc3BhbiBhbmQgYSBzZWdtZW50IGFwcGVhcnMgb3IgZGlzYXBwZWFycyBhdG9taWNhbGx5LiBzZWcgaG9sZHMgc2VncyoyXHJcbiAgICAgICAgLy8gZmxvYXRzIGFuZCB0aGUgZmVhdHVyZSBkcmF3cyBzZWdzKjIgR0wgdmVydGljZXMsIHNvIHRoZSBsZW5ndGhzIGFncmVlaW5nXHJcbiAgICAgICAgLy8gaXMgdGhlIGFsaWdubWVudCBjaGVjazsgYSBtaXNtYXRjaCBmYWxscyBiYWNrIHRvIHRoZSB3aG9sZS1mZWF0dXJlIHNwYW5cclxuICAgICAgICAvLyByYXRoZXIgdGhhbiBzaGVhcmluZyBldmVyeSBhdHRyaWJ1dGUgYWZ0ZXIgaXQuXHJcbiAgICAgICAgY29uc3QgcGVyU2VnbWVudCA9IGYuc2VnICYmIGYuc2VnLmxlbmd0aCA9PT0gY291bnRzW2ldID8gZi5zZWcgOiBudWxsO1xyXG4gICAgICAgIGZvciAobGV0IHYgPSAwOyB2IDwgY291bnRzW2ldOyB2KyspIHtcclxuICAgICAgICAgICAgY29uc3QgayA9IHBlclNlZ21lbnQgPyAodiA+PiAxKSAqIDIgOiAtMTtcclxuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrXSA6IGYuc3RhcnQ7XHJcbiAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IHBlclNlZ21lbnQgPyBwZXJTZWdtZW50W2sgKyAxXSA6IGYuZW5kO1xyXG4gICAgICAgICAgICBkdXJzW291dF0gPSBmLmR1cjtcclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGYuaWR4O1xyXG4gICAgICAgICAgICBvdXQrKztcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB7IHNwYW5zLCBkdXJzLCBsYXllcklkeCB9O1xyXG59XHJcblxyXG4vLyBnbGlmeSdzIHZlcnRleCBsYXlvdXQ6IDYgZmxvYXRzIHBlciBHTCB2ZXJ0ZXggKHgsIHksIHIsIGcsIGIsIGEpLCBjb25maXJtZWQgZm9yIDMuMy4wXHJcbi8vIGJvdGggYnkgcmVhZGluZyB0aGUgc291cmNlIGFuZCBieSB0aGUgVmFsaGFsbGEtVlJFIHJlcG9ydCdzIGRlYnVnIGR1bXAgLS0gdHdvXHJcbi8vIG9uZS1zZWdtZW50IGxpbmVzIHByb2R1Y2VkIGFsbFZlcnRpY2VzVHlwZWQgb2YgMjQgZmxvYXRzOiAyIGZlYXR1cmVzIHggMiB2ZXJ0aWNlcyB4IDYuXHJcbmNvbnN0IEZMT0FUU19QRVJfVkVSVEVYID0gNjtcclxuXHJcbi8vIFdpcmVzIHRpbWUgKyBsYXllci12aXNpYmlsaXR5IGludG8gYSBsaXZlIGdsaWZ5IExJTkVTIG9yIFNIQVBFUyBpbnN0YW5jZS4gVGhlIGNhbGxlclxyXG4vLyBzdXBwbGllcyBwZXItZmVhdHVyZSBHTC12ZXJ0ZXggY291bnRzIGNvbXB1dGVkIGZyb20gdGhlIGdlb21ldHJ5IGl0IGJ1aWx0IGl0c2VsZjpcclxuLy8gbGluZXMgZHJhdyAyKihwb2ludHMtMSkgdmVydGljZXMgcGVyIGZlYXR1cmUsIGFuZCBhbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHNpbXBsZSByaW5nXHJcbi8vIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3MgZWFyY3V0LiBUaGUgY291bnRzXHJcbi8vIGFyZSB2YWxpZGF0ZWQgYWdhaW5zdCB0aGUgaW5zdGFuY2UncyBhY3R1YWwgYnVmZmVyIGxlbmd0aCwgYW5kIGFueSBtaXNtYXRjaCBkaXNhYmxlc1xyXG4vLyB0aGUgdmVjdG9yIEdQVSBwYXRoIHJhdGhlciB0aGFuIG1pcy1hbGlnbmluZyBhdHRyaWJ1dGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UoaW5zdGFuY2UsIG1ldGEsIGNvdW50cykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY291bnRzKSB8fCBjb3VudHMubGVuZ3RoICE9PSBtZXRhLnBlckZlYXR1cmUubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgZXhwZWN0ZWQgJHttZXRhLnBlckZlYXR1cmUubGVuZ3RofSB2ZXJ0ZXggY291bnRzLCBgICtcclxuICAgICAgICAgICAgICAgIGBnb3QgJHtjb3VudHMgJiYgY291bnRzLmxlbmd0aH1gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgZXhwZWN0ZWQgPSBjb3VudHMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgKiBGTE9BVFNfUEVSX1ZFUlRFWDtcclxuICAgICAgICAvLyBMaW5lcyBrZWVwIGEgdHlwZWQgZmxhdCBidWZmZXI7IHNoYXBlcyBrZWVwIGEgcGxhaW4gZmxhdCBhcnJheS4gRWl0aGVyIGlzIHRoZVxyXG4gICAgICAgIC8vIGdyb3VuZCB0cnV0aCBmb3IgaG93IG1hbnkgR0wgdmVydGljZXMgZ2xpZnkgYWN0dWFsbHkgYnVpbHQuXHJcbiAgICAgICAgY29uc3QgYWN0dWFsID0gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZCA/IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQubGVuZ3RoXHJcbiAgICAgICAgICAgIDogKEFycmF5LmlzQXJyYXkoaW5zdGFuY2UudmVydGljZXMpID8gaW5zdGFuY2UudmVydGljZXMubGVuZ3RoIDogLTEpO1xyXG4gICAgICAgIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4IGNvdW50IG1pc21hdGNoOiBnZW9tZXRyeSBzYXlzICR7ZXhwZWN0ZWR9IGZsb2F0cywgYCArXHJcbiAgICAgICAgICAgICAgICBgdGhlIGluc3RhbmNlIGhvbGRzICR7YWN0dWFsfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBhdHRycyA9IGV4cGFuZFBlckZlYXR1cmUobWV0YS5wZXJGZWF0dXJlLCBjb3VudHMpO1xyXG4gICAgICAgIGF0dHJzLmJhc2UgPSBtZXRhLmJhc2U7XHJcbiAgICAgICAgYXR0cnMubGF5ZXJJZHMgPSBtZXRhLmxheWVySWRzO1xyXG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGRpc2FibGVWZWN0b3JHcHUoZXJyLm1lc3NhZ2UpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBXaXJlcyB0aGUgYXR0cmlidXRlIGJ1ZmZlcnMgYW5kIHVuaWZvcm1zIGludG8gYSBsaXZlIGdsaWZ5IHBvaW50cyBpbnN0YW5jZS4gUmV0dXJucyBhXHJcbi8vIGhhbmRsZSB3aG9zZSBzZXRXaW5kb3cgY29zdHMgdHdvIHVuaWZvcm1zIGFuZCBhIHJlZHJhdywgb3IgbnVsbCBpZiBhbnl0aGluZyBhYm91dCB0aGVcclxuLy8gaW5zdGFuY2UgaXMgbm90IHdoZXJlIGdsaWZ5IDMuMy4wIGtlZXBzIGl0IC0tIGluIHdoaWNoIGNhc2UgR1BVIHRpbWUgaXMgZGlzYWJsZWQgYW5kXHJcbi8vIHRoZSBjYWxsZXIncyByZWJ1aWxkIHBhdGggdGFrZXMgb3Zlci5cclxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb0luc3RhbmNlKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycyk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICBkaXNhYmxlR3B1VGltZShlcnIubWVzc2FnZSk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFRoZSBjb21tb24gR0wgd2lyaW5nOiBidWZmZXJzIGZvciBzcGFuL2R1cmF0aW9uL2xheWVyIGF0dHJpYnV0ZXMsIHVuaWZvcm1zIGZvciB0aGVcclxuLy8gdGljaywgdGhlIHNoYXJlZCBvdmVycmlkZSBhbmQgdGhlIHBlci1sYXllciB2aXNpYmlsaXR5IHNsb3RzLiBUaHJvd3Mgb24gYW55dGhpbmdcclxuLy8gdW5leHBlY3RlZDsgdGhlIGNhbGxlcnMgZGVjaWRlIHdoaWNoIGZhbGxiYWNrIGZsYWcgdGhhdCBmbGlwcy5cclxuZnVuY3Rpb24gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAge1xyXG4gICAgICAgIGNvbnN0IGdsID0gaW5zdGFuY2UuZ2w7XHJcbiAgICAgICAgY29uc3QgcHJvZ3JhbSA9IGluc3RhbmNlLnByb2dyYW07XHJcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBpbnN0YW5jZS5sYXllcjtcclxuICAgICAgICBpZiAoIWdsIHx8ICFwcm9ncmFtIHx8ICFsYXllcikgdGhyb3cgbmV3IEVycm9yKFwiaW5zdGFuY2UgbGFja3MgZ2wvcHJvZ3JhbS9sYXllclwiKTtcclxuXHJcbiAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3BhbkxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYVRpbWVTcGFuXCIpO1xyXG4gICAgICAgIGNvbnN0IGR1ckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUR1cmF0aW9uXCIpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhTGF5ZXJcIik7XHJcbiAgICAgICAgY29uc3QgdGlja0xvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVUaWNrXCIpO1xyXG4gICAgICAgIGNvbnN0IG92ZXJyaWRlTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidU92ZXJyaWRlXCIpO1xyXG4gICAgICAgIC8vIFNvbWUgZHJpdmVycyBuYW1lIHRoZSBhcnJheSBoZWFkIFwidUxheWVyVmlzWzBdXCI7IGFjY2VwdCBlaXRoZXIuXHJcbiAgICAgICAgY29uc3QgdmlzTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzXCIpXHJcbiAgICAgICAgICAgIHx8IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1swXVwiKTtcclxuICAgICAgICBpZiAoc3BhbkxvYyA8IDAgfHwgZHVyTG9jIDwgMCB8fCBsYXllckxvYyA8IDAgfHwgIXRpY2tMb2MgfHwgIW92ZXJyaWRlTG9jIHx8ICF2aXNMb2MpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidGltZSBhdHRyaWJ1dGVzL3VuaWZvcm1zIG1pc3NpbmcgZnJvbSB0aGUgbGlua2VkIHByb2dyYW1cIik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBzcGFuQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHNwYW5CdWYpO1xyXG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5zcGFucywgZ2wuU1RBVElDX0RSQVcpO1xyXG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoc3BhbkxvYywgMiwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShzcGFuTG9jKTtcclxuXHJcbiAgICAgICAgY29uc3QgZHVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGR1ckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmR1cnMsIGdsLlNUQVRJQ19EUkFXKTtcclxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGR1ckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShkdXJMb2MpO1xyXG5cclxuICAgICAgICBjb25zdCBsYXllckJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xyXG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBsYXllckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmxheWVySWR4LCBnbC5TVEFUSUNfRFJBVyk7XHJcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihsYXllckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShsYXllckxvYyk7XHJcblxyXG4gICAgICAgIC8vIFVudGlsIHRoZSBzbGlkZXIgc2F5cyBvdGhlcndpc2UsIGV2ZXJ5dGhpbmcgaXMgdmlzaWJsZSAtLSBpbiB0aW1lIEFORCBsYXllci5cclxuICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgQUxXQVlTKTtcclxuICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIC0xKTtcclxuICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKSk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIGxheWVySWRzOiBhdHRycy5sYXllcklkcyxcclxuICAgICAgICAgICAgLy8gdGlja01zIGluIGVwb2NoIG1zOyBvdmVycmlkZU1zIGEgc2hhcmVkLXdpbmRvdyB3aWR0aCBvciBudWxsLlxyXG4gICAgICAgICAgICBzZXRXaW5kb3codGlja01zLCBvdmVycmlkZU1zKSB7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIHRpY2tNcyA9PT0gbnVsbCA/IEFMV0FZUyA6ICh0aWNrTXMgLSBhdHRycy5iYXNlKSAvIDEwMDApO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCBvdmVycmlkZU1zID09PSBudWxsID8gLTEgOiBvdmVycmlkZU1zIC8gMTAwMCk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gT25lIGZsb2F0IHBlciBsYXllciBzbG90LCBpbiBhdHRycy5sYXllcklkcyBvcmRlci4gQSBzaWRlYmFyIHRvZ2dsZSBsYW5kc1xyXG4gICAgICAgICAgICAvLyBoZXJlIGluc3RlYWQgb2YgcmVidWlsZGluZyB0aGUgYnVja2V0LlxyXG4gICAgICAgICAgICBzZXRMYXllclZpc2liaWxpdHkodmlzQXJyYXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IG5ldyBGbG9hdDMyQXJyYXkoTEFZRVJfU0xPVFMpLmZpbGwoMSk7XHJcbiAgICAgICAgICAgICAgICB2aXMuc2V0KHZpc0FycmF5LnNsaWNlKDAsIExBWUVSX1NMT1RTKSk7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmdih2aXNMb2MsIHZpcyk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkSlMsIGJpbmRQb3B1cCwgYmluZFRvb2x0aXAsIHBhcnNlQ29sb3IgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XHJcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXHJcbiAgICAgICAgIHBlcmlvZFRvTXMgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcclxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XHJcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XHJcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XHJcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XHJcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcclxuICAgIH1cclxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xyXG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xyXG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcclxuICAgICAgICAgICAgLy8gV2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZCAodGhlIHdpZGdldCdzIGNsaWNrIGhhbmRsZXIgc3RhbXBzIHRoaXNcclxuICAgICAgICAgICAgLy8gcGVyIGNsaWNrLCBiZWZvcmUgYW55IGZlYXR1cmUgaGFuZGxlciBydW5zKSwgRVZFUlkgbWF0Y2ggc3RhbmRzIGRvd246XHJcbiAgICAgICAgICAgIC8vIGEgY2xpY2sgaW4gcmVtb3ZhbCBtb2RlIGlzIGEgZGVsZXRpb24gYXR0ZW1wdCwgYW5kIGFuc3dlcmluZyBpdCB3aXRoXHJcbiAgICAgICAgICAgIC8vIGEgZmVhdHVyZSBwb3B1cCBvciBhIGNvb3JkcyByZWFkb3V0IHJlYWRzIGFzIFwicmVtb3ZlIGlzIGJyb2tlblwiLlxyXG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCAmJiAhbWFwLl9wbU1vZGVBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xyXG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xyXG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XHJcbiAgICB9XHJcbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcclxuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcclxuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XHJcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgfSwgMCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xyXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcclxuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXHJcbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxyXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxyXG4vL1xyXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcclxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxyXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxyXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXHJcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcclxuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xyXG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xyXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcclxuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcclxuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcclxuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xyXG4gICAgY29uc3QgcHJvcHMgPSB7fTtcclxuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcclxuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwcm9wcztcclxufVxyXG5cclxuXHJcblxyXG4vLyBBbiBpbWFnZXJ5IG92ZXJsYXkncyBpZGVudGl0eTogZXZlcnl0aGluZyB0aGUgcmVuZGVyZWQgZWxlbWVudCBkZXJpdmVzIGZyb20gaXRzXHJcbi8vIGNvbmZpZy4gVGhlIHN5bmMgbG9vcCByZWNyZWF0ZXMgdGhlIG92ZXJsYXkgd2hlbiB0aGlzIGNoYW5nZXMgKG9yIHdoZW4gdGhlXHJcbi8vIGJpbmFyeSBidWZmZXIgb2JqZWN0IHVuZGVyIHRoZSBsYXllciBpZCBpcyByZXBsYWNlZCksIHNpbmNlIGEgRE9NIGltYWdlIGlzIGFcclxuLy8gc2luZ2xlIGNoZWFwIG5vZGUgLS0gbm8gaW5jcmVtZW50YWwgdXBkYXRlIG1hY2hpbmVyeSBuZWVkZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbWFnZU1ldGFLZXkobGF5ZXIpIHtcclxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShbbGF5ZXIudXJsIHx8IG51bGwsIGxheWVyLmJvdW5kcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIub3BhY2l0eSA/PyAxLCBsYXllci5pbWFnZV9mb3JtYXQgfHwgbnVsbF0pO1xyXG59XHJcblxyXG4vLyBHZW9yZWZlcmVuY2VkIHBpeGVscyBwaW5uZWQgdG8gYSBsYXQvbG9uIGJveC4gVGhlIGNvbmZpZyBpcyBwdXJlIGRhdGEgLS1cclxuLy8ge3R5cGU6IFwiaW1hZ2VcIiwgYm91bmRzLCBvcGFjaXR5LCB1cmwgfCBieXRlcyB1bmRlciB0aGUgbGF5ZXIgaWR9IC0tIHNvIGFcclxuLy8gcGxhaW4tSlMgY29uc3VtZXIgcGFzc2VzIGEgVVJMIGFuZCB0aGUgd2lkZ2V0IHBhdGggc2hpcHMgYnl0ZXMgb3ZlciB0aGVcclxuLy8gYmluYXJ5IGJ1ZmZlciB0cmFuc3BvcnQuIFB5dGhvbiBoYXMgYWxyZWFkeSB3YXJwZWQgdGhlIHJhc3RlciBpbnRvIHRoZSBNQVAnc1xyXG4vLyBvd24gQ1JTIGdyaWQgKHJhc3RlcmlvIHNpZGUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIExlYWZsZXQncyBsaW5lYXIgY29ybmVyXHJcbi8vIHN0cmV0Y2ggZXhhY3RseSBjb3JyZWN0OyB0aGlzIHN0YXlzIGEgZHVtYiByZW5kZXJlci5cclxuZnVuY3Rpb24gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcikge1xyXG4gICAgaWYgKCFsYXllci5ib3VuZHMpIHJldHVybiBudWxsO1xyXG4gICAgbGV0IHVybCA9IGxheWVyLnVybDtcclxuICAgIGxldCBvYmplY3RVcmwgPSBudWxsO1xyXG4gICAgaWYgKCF1cmwgJiYgY29vcmRCdWZmZXIpIHtcclxuICAgICAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2Nvb3JkQnVmZmVyXSxcclxuICAgICAgICAgICAgeyB0eXBlOiBsYXllci5pbWFnZV9mb3JtYXQgfHwgXCJpbWFnZS9wbmdcIiB9KTtcclxuICAgICAgICBvYmplY3RVcmwgPSB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgfVxyXG4gICAgaWYgKCF1cmwpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IEwuaW1hZ2VPdmVybGF5KHVybCwgbGF5ZXIuYm91bmRzLCB7XHJcbiAgICAgICAgb3BhY2l0eTogbGF5ZXIub3BhY2l0eSA/PyAxLFxyXG4gICAgICAgIC8vIENvbnRleHQsIG5vdCBhIGNsaWNrIHRhcmdldDogY2xpY2tzIGZhbGwgdGhyb3VnaCB0byBmZWF0dXJlcyBhbmQgdGhlXHJcbiAgICAgICAgLy8gZW1wdHktbWFwIGNvb3JkaW5hdGUgZmFsbGJhY2suIFRoZSBkZWZhdWx0IG92ZXJsYXlQYW5lICh6IDQwMClcclxuICAgICAgICAvLyBhbHJlYWR5IHNpdHMgYWJvdmUgdGlsZXMgKDIwMCkgYW5kIGJlbG93IHRoZSBHTCBwYW5lcyAoNDEwKykuXHJcbiAgICAgICAgaW50ZXJhY3RpdmU6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAob2JqZWN0VXJsKSB7XHJcbiAgICAgICAgb3ZlcmxheS5vbihcInJlbW92ZVwiLCAoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKG9iamVjdFVybCkpO1xyXG4gICAgfVxyXG4gICAgb3ZlcmxheS5hZGRUbyhtYXApO1xyXG4gICAgb3ZlcmxheS5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgb3ZlcmxheS5pbWFnZU1ldGEgPSBpbWFnZU1ldGFLZXkobGF5ZXIpO1xyXG4gICAgb3ZlcmxheS5pbWFnZVNvdXJjZSA9IGNvb3JkQnVmZmVyIHx8IG51bGw7XHJcbiAgICByZXR1cm4gb3ZlcmxheTtcclxufVxyXG5cclxuLy8gQSBub24tR0wgbGF5ZXIgKGltYWdlIG92ZXJsYXksIG9yIGEgZ3JvdXAgb2YgdGhlbSkgYXMgYSBMZWFmbGV0IGxheWVyLiBUYWtlcyB0aGVcclxuLy8gTElWRSBidWZmZXIgbWFwIHRoZSBjb3JlIGtlZXBzIC0tIHBhdGNoZXMgbGFuZCB0aGVyZSwgbmV2ZXIgaW4gYSBob3N0IHRyYWl0LlxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRCdWZmZXIsIGNvb3JkaW5hdGVCdWZmZXJzID0ge30pIHtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImltYWdlXCIpIHtcclxuICAgICAgICByZXR1cm4gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcik7XHJcbiAgICB9XHJcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsYXllci5sYXllcnMpIHtcclxuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgZ3JvdXAuYWRkTGF5ZXIoaW5zdGFuY2UpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGdyb3VwLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcclxuICAgICAgICByZXR1cm4gZ3JvdXA7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQSB2ZWN0b3IgbGF5ZXIncyBjb29yZGluYXRlczogdGhlIGJpbmFyeSBidWZmZXIgdW5kZXIgaXRzIGlkIHdoZW4gUHl0aG9uIGJ1aWx0IGl0XHJcbi8vICh0aGUgbGF5ZXJzIEpTT04gdGhlbiBjYXJyaWVzIG5vIGNvb3JkaW5hdGVzIGF0IGFsbCksIG9yIGlubGluZSBgbG9jYXRpb25zYCBmb3JcclxuLy8gaGFuZC1idWlsdCBjb25maWdzIGFuZCBmaXh0dXJlcy4gTWF0ZXJpYWxpc2VkIG9ubHkgb24gcmVidWlsZCwgd2hpY2ggdmVjdG9yIGJ1Y2tldHNcclxuLy8gb24gdGhlIEdQVSBwYXRoIHJhcmVseSBkby5cclxuZXhwb3J0IGZ1bmN0aW9uIHZlY3RvckNvb3JkcyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmIChsYXllci5sb2NhdGlvbnMpIHJldHVybiBsYXllci5sb2NhdGlvbnM7XHJcbiAgICBjb25zdCByYXcgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBmbGF0ID0gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgIGNvbnN0IG91dCA9IG5ldyBBcnJheShmbGF0Lmxlbmd0aCAvIDIpO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvdXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBvdXRbaV0gPSBbZmxhdFtpICogMl0sIGZsYXRbaSAqIDIgKyAxXV07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBBIGxpbmUgbGF5ZXIncyBjb29yZGluYXRlcyBhcyBwYXJ0czogdGhlIGZsYXQgcnVuIHNsaWNlZCBieSB0aGUgY29uZmlnJ3MgYHBhcnRzYFxyXG4vLyBsZW5ndGggdGFibGUsIG9yIG9uZSBwYXJ0IHdpdGhvdXQgaXQuIEEgbXVsdGktcGFydCBsaW5lIC0tIE1VTFRJTElORVNUUklORyxcclxuLy8gTXVsdGlMaW5lU3RyaW5nIC0tIGlzIE9ORSBsYXllciBkcmF3biBhcyBkaXNqb2ludCBydW5zOyBub3RoaW5nIG1heSBldmVyIGRyYXcgYVxyXG4vLyBzZWdtZW50IGZyb20gb25lIHBhcnQncyBsYXN0IHZlcnRleCB0byB0aGUgbmV4dCBwYXJ0J3MgZmlyc3QuXHJcbmV4cG9ydCBmdW5jdGlvbiBsaW5lUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XHJcbiAgICBjb25zdCBsZW5ndGhzID0gQXJyYXkuaXNBcnJheShsYXllci5wYXJ0cykgJiYgbGF5ZXIucGFydHMubGVuZ3RoID4gMSA/IGxheWVyLnBhcnRzIDogbnVsbDtcclxuICAgIGlmICghbGVuZ3RocykgcmV0dXJuIGxvY3MubGVuZ3RoID8gW2xvY3NdIDogW107XHJcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xyXG4gICAgbGV0IG9mZnNldCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IG4gb2YgbGVuZ3Rocykge1xyXG4gICAgICAgIGNvbnN0IHBhcnQgPSBsb2NzLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgbik7XHJcbiAgICAgICAgb2Zmc2V0ICs9IG47XHJcbiAgICAgICAgaWYgKHBhcnQubGVuZ3RoID49IDIpIHBhcnRzLnB1c2gocGFydCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFydHM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNsb3NlUmluZyhyaW5nKSB7XHJcbiAgICBpZiAocmluZy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc3QgZmlyc3QgPSByaW5nWzBdO1xyXG4gICAgICAgIGNvbnN0IGxhc3QgPSByaW5nW3JpbmcubGVuZ3RoIC0gMV07XHJcbiAgICAgICAgaWYgKGZpcnN0WzBdICE9PSBsYXN0WzBdIHx8IGZpcnN0WzFdICE9PSBsYXN0WzFdKSB7XHJcbiAgICAgICAgICAgIHJpbmcucHVzaChbZmlyc3RbMF0sIGZpcnN0WzFdXSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJpbmc7XHJcbn1cclxuXHJcbi8vIGdsaWZ5J3MgbGluZSBoaXQgdG9sZXJhbmNlIGlzIGBzZW5zaXRpdml0eSArIHdlaWdodC9zY2FsZWAsIGFuZCBzZW5zaXRpdml0eSBpcyBhXHJcbi8vIENPTlNUQU5UIGluIGxhdGxuZyBkZWdyZWVzIC0tIDAuMSBmb3IgY2xpY2tzICh+MTEga20pIGFuZCAwLjAzIGZvciBob3ZlcnMsXHJcbi8vIHpvb20tYmxpbmQsIHNvIGEgY2xpY2sgd2l0aGluIHNpZ2h0IG9mIGEgbGluZSBtYXRjaGVkIGl0IGFuZCBzdGFydmVkIHRoZVxyXG4vLyBlbXB0eS1tYXAgZmFsbGJhY2suIFRoZSB3ZWlnaHQvc2NhbGUgdGVybSBhbHJlYWR5IGNvdmVycyB0aGUgZHJhd24gd2lkdGg7XHJcbi8vIHJlcGxhY2UgdGhlIGNvbnN0YW50IHdpdGggYSBmZXcgcGl4ZWxzJyB3b3J0aCBhdCB0aGUgY3VycmVudCB6b29tLiBUaGUgaW5zdGFuY2VcclxuLy8gZ2V0dGVycyByZWFkIGBzZXR0aW5nc2AgbGl2ZSBwZXIgZXZlbnQsIHNvIHVwZGF0aW5nIG9uIHpvb20gaXMgZW5vdWdoIC0tIG5vXHJcbi8vIGdsaWZ5IHBhdGNoaW5nLiBSZXR1cm5zIHRoZSB1bnN1YnNjcmliZSBmb3Igb25SZW1vdmUuXHJcbmNvbnN0IExJTkVfSElUX1NMQUNLX1BYID0gODtcclxuZnVuY3Rpb24gdHJhY2tMaW5lU2Vuc2l0aXZpdHkobWFwLCBpbnN0YW5jZSkge1xyXG4gICAgY29uc3QgYXBwbHkgPSAoKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgc2xhY2sgPSBMSU5FX0hJVF9TTEFDS19QWCAvIE1hdGgucG93KDIsIG1hcC5nZXRab29tKCkpO1xyXG4gICAgICAgIGluc3RhbmNlLnNldHRpbmdzLnNlbnNpdGl2aXR5ID0gc2xhY2s7XHJcbiAgICAgICAgaW5zdGFuY2Uuc2V0dGluZ3Muc2Vuc2l0aXZpdHlIb3ZlciA9IHNsYWNrO1xyXG4gICAgfTtcclxuICAgIGFwcGx5KCk7XHJcbiAgICBtYXAub24oXCJ6b29tZW5kXCIsIGFwcGx5KTtcclxuICAgIHJldHVybiAoKSA9PiBtYXAub2ZmKFwiem9vbWVuZFwiLCBhcHBseSk7XHJcbn1cclxuXHJcbi8vIEFuIGFyZWEgbGF5ZXIncyBnZW9tZXRyeSBhcyBwYXJ0cyAtPiBjbG9zZWQgW2xvbiwgbGF0XSByaW5nczogYSBwb2x5Z29uJ3MgZmxhdFxyXG4vLyBjb29yZGluYXRlIHJ1biBzbGljZWQgYnkgaXRzIGByaW5nc2AgdGFibGUgKG9uZSBob2xlLWZyZWUgcmluZyB3aXRob3V0IGl0KSwgb3IgYVxyXG4vLyBjaXJjbGUncyBnZW5lcmF0ZWQgcmluZy4gRmVlZHMgYm90aCB0aGUgZmlsbCAoZWFyY3V0LCBpbiB0aGUgcG9seWdvbiBidWNrZXQpIGFuZFxyXG4vLyB0aGUgb3V0bGluZSAoTGluZVN0cmluZ3MgaW4gdGhlIGxpbmVzIGJ1Y2tldCkuXHJcbmZ1bmN0aW9uIGFyZWFQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XHJcbiAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XHJcbiAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xyXG4gICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcclxuICAgICAgICBjb25zdCByaW5nID0gW107XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gMzI7IGkrKykge1xyXG4gICAgICAgICAgICBjb25zdCBhbmdsZSA9IChpICogMzYwKSAvIDMyO1xyXG4gICAgICAgICAgICBjb25zdCBhbmdsZVJhZCA9IChhbmdsZSAqIE1hdGguUEkpIC8gMTgwO1xyXG4gICAgICAgICAgICBjb25zdCBkTGF0ID0gKHJhZGl1c01ldGVycyAqIE1hdGguY29zKGFuZ2xlUmFkKSkgLyBlYXJ0aFJhZGl1cztcclxuICAgICAgICAgICAgY29uc3QgZExvbiA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLnNpbihhbmdsZVJhZCkpIC8gKGVhcnRoUmFkaXVzICogTWF0aC5jb3MoKGxhdCAqIE1hdGguUEkpIC8gMTgwKSk7XHJcbiAgICAgICAgICAgIHJpbmcucHVzaChbbG9uICsgKGRMb24gKiAxODApIC8gTWF0aC5QSSwgbGF0ICsgKGRMYXQgKiAxODApIC8gTWF0aC5QSV0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gW1tyaW5nXV07XHJcbiAgICB9XHJcbiAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XHJcbiAgICBjb25zdCBsb25sYXQgPSBsb2NzLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XHJcbiAgICBjb25zdCByaW5nVGFibGUgPSBsYXllci5yaW5ncyB8fCAobG9ubGF0Lmxlbmd0aCA+IDAgPyBbW2xvbmxhdC5sZW5ndGhdXSA6IFtdKTtcclxuICAgIGNvbnN0IHBhcnRzID0gW107XHJcbiAgICBsZXQgYXQgPSAwO1xyXG4gICAgZm9yIChjb25zdCBwYXJ0TGVucyBvZiByaW5nVGFibGUpIHtcclxuICAgICAgICBjb25zdCByaW5ncyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGVuIG9mIHBhcnRMZW5zKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJpbmcgPSBjbG9zZVJpbmcobG9ubGF0LnNsaWNlKGF0LCBhdCArIGxlbikpO1xyXG4gICAgICAgICAgICBhdCArPSBsZW47XHJcbiAgICAgICAgICAgIGlmIChyaW5nLmxlbmd0aCA+PSA0KSByaW5ncy5wdXNoKHJpbmcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocmluZ3MubGVuZ3RoID4gMCkgcGFydHMucHVzaChyaW5ncyk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFydHM7XHJcbn1cclxuXHJcbi8vIGBldmVudHMub25GZWF0dXJlQ2xpY2soeyBsYXllciwgaW5kZXgsIGxhdGxuZyB9KWAgaXMgaG93IGEgY2xpY2sgcmVhY2hlcyB3aGF0ZXZlclxyXG4vLyBob3N0cyB0aGUgbWFwOyB0aGlzIG1vZHVsZSBuZXZlciB3cml0ZXMgc3RhdGUgaXRzZWxmLlxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBldmVudHMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRmVhdHVyZVZpc2libGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBvbkZlYXR1cmVDbGljayA9IChldmVudHMgJiYgZXZlbnRzLm9uRmVhdHVyZUNsaWNrKSB8fCAoKCkgPT4ge30pO1xyXG4gICAgLy8gSGl0LXRlc3QgZ3VhcmQ6IEdQVS1wYXRoIGJ1Y2tldHMgaG9sZCBoaWRkZW4gbGF5ZXJzIChhbmQgb3V0LW9mLXdpbmRvd1xyXG4gICAgLy8gZmVhdHVyZXMpLCBtYXNrZWQgb25seSBieSBzaGFkZXIgdW5pZm9ybXMgZ2xpZnkncyBoaXQtdGVzdHMgY2Fubm90IHNlZS4gVGhlXHJcbiAgICAvLyB3aWRnZXQgcGFzc2VzIGEgbGl2ZSBsb29rdXA7IHRoZSBmYWxsYmFjayBjb3ZlcnMgcGxhaW4tSlMgY29uc3VtZXJzIHdpdGggdGhlXHJcbiAgICAvLyBjb25maWcncyBvd24gZmxhZy5cclxuICAgIGNvbnN0IHZpc2libGVOb3cgPSBpc0ZlYXR1cmVWaXNpYmxlIHx8ICgobCkgPT4gbC52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAvLyBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZSBnZW9tZXRyeSBwZXIgbGF5ZXIuIE9uIHRoZSBHUFUgcGF0aCAobWFwLmpzXHJcbiAgICAvLyBwYXNzZXMgdmVjdG9yR3B1IHdoZW4gdGhlIGJ1Y2tldCBxdWFsaWZpZXMpIGV2ZXJ5IGZlYXR1cmUgc3RheXMgaW4gdGhlIGJ1ZmZlcnMgYW5kXHJcbiAgICAvLyB0aGUgc2hhZGVyIGRlY2lkZXMgdmlzaWJpbGl0eSBwZXIgdGljayBhbmQgcGVyIGxheWVyIHRvZ2dsZSAtLSBhIGxpbmUtc2hhcGVkIHRyYWNrXHJcbiAgICAvLyBoYXMgYXMgbWFueSB2ZXJ0aWNlcyBhcyBhIHBvaW50IHRyYWNrIGhhcyBwb2ludHMsIHNvIGl0cyByZWJ1aWxkcyBjb3N0IHRoZSBzYW1lXHJcbiAgICAvLyBhbmQgY3Jhc2hlZCB0aGUgc2FtZSB3YXkuIE9mZiB0aGUgR1BVIHBhdGgsIHRoZSB3aG9sZS1mZWF0dXJlIENQVSBmaWx0ZXIgcmVtYWlucy5cclxuICAgIGNvbnN0IHZlY3Rvck1ldGEgPSB2ZWN0b3JHcHUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiXHJcbiAgICAgICAgPyBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxyXG4gICAgICAgICAgICB0aW1lU3RhdGUgJiYgdGltZVN0YXRlLnBlcmlvZCA/IHBlcmlvZFRvTXModGltZVN0YXRlLnBlcmlvZCkgOiBudWxsKVxyXG4gICAgICAgIDogeyBoYXNUaW1lOiBmYWxzZSB9O1xyXG4gICAgY29uc3QgdmVjdG9yVGltZSA9IEJvb2xlYW4odmVjdG9yTWV0YS5oYXNUaW1lKTtcclxuICAgIGlmICh0aW1lU3RhdGUgJiYgIXZlY3RvclRpbWUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiKSB7XHJcbiAgICAgICAgbGF5ZXJzTGlzdCA9IGxheWVyc0xpc3QuZmlsdGVyKGwgPT4gbGF5ZXJJbldpbmRvdyhsLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSk7XHJcbiAgICAgICAgaWYgKGxheWVyc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmICh0eXBlID09PSBcInBvbHlsaW5lXCIpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcclxuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xyXG5cclxuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lczogYSBwb2x5Z29uIG9yIGNpcmNsZSBpbiB0aGlzIGJ1Y2tldCBjb250cmlidXRlcyBlYWNoIG9mIGl0c1xyXG4gICAgICAgICAgICAvLyByaW5ncyBhcyBvbmUgTGluZVN0cmluZywgZHJhd24gd2l0aCB0aGUgYXJlYSdzIHN0cm9rZSBvcHRpb25zIC0tIGNvbG9yLFxyXG4gICAgICAgICAgICAvLyB3ZWlnaHQsIG9wYWNpdHksIExlYWZsZXQncyBvd24gc2VtYW50aWNzLiBPdXRsaW5lIHdlaWdodCBhbmQgb3BhY2l0eSBuZXZlclxyXG4gICAgICAgICAgICAvLyByZW5kZXJlZCBiZWZvcmUgdGhpczsgdGhlIGZpbGwgbWFjaGluZXJ5IGNhbm5vdCBkcmF3IHRoZW0gKGdsaWZ5J3MgYm9yZGVyXHJcbiAgICAgICAgICAgIC8vIGlzIDFweCBhbmQgZmlsbC1jb2xvdXJlZCksIHRoZSBsaW5lcyBtYWNoaW5lcnkgYWxyZWFkeSBkb2VzLlxyXG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xyXG4gICAgICAgICAgICAgICAgbGV0IGNvdW50ID0gMDtcclxuICAgICAgICAgICAgICAgIGlmICgoc3R5bGUud2VpZ2h0ID8/IDMpID4gMCAmJiAoc3R5bGUub3BhY2l0eSA/PyAxLjApID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5nIG9mIHJpbmdzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3VudCArPSBNYXRoLm1heCgwLCAyICogKHJpbmcubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHsgdHlwZTogXCJMaW5lU3RyaW5nXCIsIGNvb3JkaW5hdGVzOiByaW5nIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE91dGxpbmUgcGl4ZWxzIG9ubHkgLS0gdGhlIGFyZWEncyBzaGFwZXMgaW5zdGFuY2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gb3ducyBpbnRlcmFjdGlvbiB3aXRoIGV4YWN0IGNvbnRhaW5tZW50LiBMZWZ0XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNsaWNrYWJsZSwgdGhlc2UgcmluZ3MgYW5zd2VyZWQgdGhyb3VnaCBnbGlmeSdzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGxpbmUgdG9sZXJhbmNlICgwLjEgREVHUkVFUyBmb3IgY2xpY2tzIHZzIDAuMDNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZm9yIGhvdmVycyk6IHBvcHVwcyB3ZWxsIG91dHNpZGUgdGhlIHNoYXBlIGFuZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnNpZGUgaG9sZXMsIGhvdmVyIGRpc2FncmVlaW5nIHdpdGggY2xpY2suXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQm9yZGVyOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaChjb3VudCk7ICAgLy8gMCBrZWVwcyB0aGUgc2xvdCBhbGlnbmVkIHdoZW4gc3Ryb2tlbGVzc1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIE9uZSBMaW5lU3RyaW5nIGZlYXR1cmUgUEVSIFBBUlQsIGV2ZXJ5IHBhcnQgY2FycnlpbmcgdGhlIGxheWVyIC0tIG5ldmVyXHJcbiAgICAgICAgICAgIC8vIGEgTXVsdGlMaW5lU3RyaW5nOiBnbGlmeSdzIE11bHRpTGluZVN0cmluZyBwYXRoIGhpdC10ZXN0cyB0aGUgY29ubmVjdG9yXHJcbiAgICAgICAgICAgIC8vIGJldHdlZW4gcGFydHMsIHdoaWNoIGlzIHRoZSBwaGFudG9tIHNlZ21lbnQgYnkgYW5vdGhlciByb3V0ZS4gVGhlIEdMXHJcbiAgICAgICAgICAgIC8vIHZlcnRleCBzdHJlYW0gc3RheXMgY29uc2VjdXRpdmUsIHNvIHRoZSBwZXItbGF5ZXIgY291bnQgc3RpbGwgYWxpZ25zXHJcbiAgICAgICAgICAgIC8vIHRoZSB0aW1lIGF0dHJpYnV0ZXM7IGEgc3Ryb2tlbGVzcyBvciBkZWdlbmVyYXRlIGxheWVyIGtlZXBzIGl0cyBzbG90LlxyXG4gICAgICAgICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgbGluZVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGdlb2pzb25Db29yZHMgPSBwYXJ0Lm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XHJcbiAgICAgICAgICAgICAgICBjb3VudCArPSBNYXRoLm1heCgwLCAyICogKGdlb2pzb25Db29yZHMubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJMaW5lU3RyaW5nXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb3JkaW5hdGVzOiBnZW9qc29uQ29vcmRzXHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUub3BhY2l0eSB8fCAxLjAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBzdHlsZS53ZWlnaHQgfHwgM1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG5cclxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXHJcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XHJcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3QgbGluZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXHJcbiAgICAgICAgICAgICAgICAgICAgPyB7IHZlcnRleFNoYWRlclNvdXJjZTogKCkgPT4gdGltZVZlcnRleFNoYWRlcigpIH0gOiB7fTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZ2xMaW5lcyA9IEwuZ2xpZnkubGluZXMoe1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLmxpbmVPcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxyXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWxpbmVzUGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoZSBkYXRhIGFib3ZlIGlzIEdlb0pTT04sIHdob3NlIGNvb3JkaW5hdGVzIGFyZSBbbG9uLCBsYXRdOyBnbGlmeVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGRlZmF1bHRzIHRvIGxhdGl0dWRlLWZpcnN0IGFuZCBpdHMgTElORSB2ZXJ0ZXggYnVpbGRlciByZWFkc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGNvb3JkaW5hdGVzIHRocm91Z2ggdGhlc2Uga2V5cyAtLSB1bnNldCwgaXQgdG9vayBsb25naXR1ZGUgYXNcclxuICAgICAgICAgICAgICAgICAgICAvLyBsYXRpdHVkZSBhbmQgcHJvamVjdGVkIGV2ZXJ5IGxpbmUgb2ZmLXZpZXdwb3J0LiBTaWxlbnRseTogbm8gR0xcclxuICAgICAgICAgICAgICAgICAgICAvLyBlcnJvciwgYSBoZWFsdGh5IGNhbnZhcywgemVybyBmcmFnbWVudHMuIFNldCBwZXIgaW5zdGFuY2UgcmF0aGVyXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiBvbiB0aGUgTC5nbGlmeSBnbG9iYWwsIHdoaWNoIGFub3RoZXIgbGlicmFyeSBjb3VsZCBhbHNvXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gbXV0YXRlLiBUaGUgcG9seWdvbiBwYXRoIGlzIGRlbGliZXJhdGVseSBOT1QgZ2l2ZW4gdGhlc2Uga2V5czpcclxuICAgICAgICAgICAgICAgICAgICAvLyBpdCB0cmlhbmd1bGF0ZXMgdmlhIGVhcmN1dCBvbiB0aGUgR2VvSlNPTiBkaXJlY3RseSwgbmF0aXZlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gW2xvbiwgbGF0XSwgYW5kIGtleXMgdGhlcmUgd291bGQgdHJhbnNwb3NlIGl0IHRoZSBzYW1lIHdheS5cclxuICAgICAgICAgICAgICAgICAgICAvLyBGb3VuZCBieSB0aGUgVmFsaGFsbGEtVlJFIGJ1ZyByZXBvcnQsIGRyaXZpbmcgdGhlIHBsYWluLUpTXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYnVuZGxlIHdoZXJlIG5vIHBvaW50cyBtYXNrZWQgdGhlIGJsYW5rIGxpbmVzLlxyXG4gICAgICAgICAgICAgICAgICAgIGxhdGl0dWRlS2V5OiAxLFxyXG4gICAgICAgICAgICAgICAgICAgIGxvbmdpdHVkZUtleTogMCxcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLndlaWdodDtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZlYXR1cmUgfHwgIWZlYXR1cmUucHJvcGVydGllcyB8fCBmZWF0dXJlLnByb3BlcnRpZXMuaXNCb3JkZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIXZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAyLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkOiB0aGUgaG9zdCByZWNvcmRzIFwid2hlcmVcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCBcIm9uIHdoYXRcIiAtLSBzZWUgb25GZWF0dXJlQ2xpY2sgaW4gY29yZS5qcy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyLCBpbmRleDogMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubGF0ICogMWU1KSAvIDFlNSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgIWZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIHZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xMaW5lcyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zZW5zaXRpdml0eU9mZiA9IHRyYWNrTGluZVNlbnNpdGl2aXR5KG0sIHRoaXMuZ2xMaW5lcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xMaW5lcywgdmVjdG9yTWV0YSwgdmVydGV4Q291bnRzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2Vuc2l0aXZpdHlPZmYpIHRoaXMuX3NlbnNpdGl2aXR5T2ZmKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbExpbmVzKSB0aGlzLmdsTGluZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgICAgICBjb25zdCBwYXJ0cyA9IGFyZWFQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaCgwKTsgICAvLyBubyBmZWF0dXJlLCBidXQgdGhlIHNsb3QgbXVzdCBzdGF5IGFsaWduZWRcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIEFueSB0cmlhbmd1bGF0aW9uIG9mIGEgcG9seWdvbiB3aXRoIEQgZGlzdGluY3QgdmVydGljZXMgYW5kIGggaG9sZXMgaGFzXHJcbiAgICAgICAgICAgIC8vIGV4YWN0bHkgRCArIDJoIC0gMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3NcclxuICAgICAgICAgICAgLy8gZWFyY3V0OyBoID0gMCBnaXZlcyB0aGUgZmFtaWxpYXIgRCAtIDIuIFJpbmdzIGFyZSBjbG9zZWQgYnkgbm93LCBzbyBlYWNoXHJcbiAgICAgICAgICAgIC8vIGNvbnRyaWJ1dGVzIGxlbmd0aCAtIDEgZGlzdGluY3QgdmVydGljZXMuIFBhcnRzIHRyaWFuZ3VsYXRlIHNlcGFyYXRlbHlcclxuICAgICAgICAgICAgLy8gYW5kIHN1bS5cclxuICAgICAgICAgICAgbGV0IHRyaWFuZ2xlcyA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgcGFydHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGRpc3RpbmN0ID0gcmluZ3MucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIubGVuZ3RoIC0gMSwgMCk7XHJcbiAgICAgICAgICAgICAgICB0cmlhbmdsZXMgKz0gTWF0aC5tYXgoMCwgZGlzdGluY3QgKyAyICogKHJpbmdzLmxlbmd0aCAtIDEpIC0gMik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMyAqIHRyaWFuZ2xlcyk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcclxuICAgICAgICAgICAgLy8gTGVhZmxldCdzIG93biBzZW1hbnRpY3M6IHRoZSBmaWxsIGlzIGZpbGxDb2xvciwgZGVmYXVsdGluZyB0byB0aGUgc3Ryb2tlXHJcbiAgICAgICAgICAgIC8vIGNvbG9yIHdoZW4gdW5zZXQuIEl0IHVzZWQgdG8gYWx3YXlzIGZpbGwgd2l0aCBgY29sb3JgLCB3aGljaCBtYWRlXHJcbiAgICAgICAgICAgIC8vIFwicmVkIG91dGxpbmUsIHBhbGUgYmx1ZSBmaWxsXCIgLS0gdGhlIG1vc3QgYmFzaWMgcG9seWdvbiBzdHlsaW5nIGFzayAtLVxyXG4gICAgICAgICAgICAvLyBpbXBvc3NpYmxlOyB0aGUgb3V0bGluZSBpdHNlbGYgaXMgZHJhd24gYnkgdGhlIGxpbmVzIGJ1Y2tldC5cclxuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5maWxsQ29sb3IgfHwgc3R5bGUuZmlsbF9jb2xvciB8fCBzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xyXG4gICAgICAgICAgICAvLyBPbmUgRmVhdHVyZSBQRVIgUEFSVCwgbmV2ZXIgYSBNdWx0aVBvbHlnb246IGdsaWZ5J3Mgc2hhcGVzIG9ubHlcclxuICAgICAgICAgICAgLy8gZXhwbG9kZXMgTXVsdGlQb2x5Z29uIHdoZW4gaGFuZGVkIGEgYmFyZSBGZWF0dXJlIG9yIGdlb21ldHJ5IC0tIGluIGFcclxuICAgICAgICAgICAgLy8gRmVhdHVyZUNvbGxlY3Rpb24gdGhlIGNvb3JkaW5hdGVzIHJlYWNoIGVhcmN1dC5mbGF0dGVuIHVuZXhwbG9kZWQsXHJcbiAgICAgICAgICAgIC8vIGVhcmN1dCByZXR1cm5zIG5vIGluZGljZXMsIGFuZCB0aGUgZmVhdHVyZSBzaWxlbnRseSBkcmF3cyBaRVJPIGZpbGxcclxuICAgICAgICAgICAgLy8gdHJpYW5nbGVzICh2ZXJpZmllZCBhZ2FpbnN0IGdsaWZ5IDMuMy4wOyBpdHMgXCJ1bmhhbmRsZWQgcG9seWdvblwiXHJcbiAgICAgICAgICAgIC8vIHRocm93IHNpdHMgaW5zaWRlIHRoZSBlbXB0eSBsb29wIGFuZCBuZXZlciBmaXJlcykuIFBhcnRzIHN0YXlcclxuICAgICAgICAgICAgLy8gY29uc2VjdXRpdmUsIHNvIHBlci1sYXllciB2ZXJ0ZXhDb3VudHMgc3RpbGwgYWxpZ24gZm9yIEdQVSB0aW1lLlxyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmdzIG9mIHBhcnRzKSB7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIlBvbHlnb25cIiwgY29vcmRpbmF0ZXM6IHJpbmdzIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLmZpbGxPcGFjaXR5IHx8IDAuMiB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG5cclxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXHJcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XHJcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hhcGVPcHRpb25zID0gdmVjdG9yVGltZVxyXG4gICAgICAgICAgICAgICAgICAgID8geyB2ZXJ0ZXhTaGFkZXJTb3VyY2U6ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKSB9IDoge307XHJcbiAgICAgICAgICAgICAgICB0aGlzLmdsU2hhcGVzID0gTC5nbGlmeS5zaGFwZXMoe1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLnNoYXBlT3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogZ2VvanNvbixcclxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZlYXR1cmUgfHwgIWZlYXR1cmUucHJvcGVydGllcyB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIXZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkOiB0aGUgaG9zdCByZWNvcmRzIFwid2hlcmVcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCBcIm9uIHdoYXRcIiAtLSBzZWUgb25GZWF0dXJlQ2xpY2sgaW4gY29yZS5qcy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyLCBpbmRleDogMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubGF0ICogMWU1KSAvIDFlNSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XHJcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcclxuXHJcbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xyXG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcclxuICAgIC8vIGNpcmNsZSBiZWNhdXNlIHRoZSBnbHlwaCBpcyBkcmF3biBpbnNpZGUgdGhlIHBvaW50J3Mgb3duIHF1YWQgYnkgdGhlIHNoYWRlci5cclxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XHJcblxyXG4gICAgLy8gR1BVIHRpbWUgcGF0aDogd2hlbiB0aGlzIGJ1Y2tldCBob2xkcyB0aW1lIGxheWVycywgZXZlcnkgcG9pbnQgaXMgZmVkIHRvIGdsaWZ5IGFuZFxyXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXHJcbiAgICAvLyB2ZXJ0ZXggc2hhZGVyLCBzbyBhIHRpY2sgY29zdHMgdHdvIHVuaWZvcm1zIGluc3RlYWQgb2YgcmVidWlsZGluZyA1TSBwb2ludHMgaW4gSlMuXHJcbiAgICAvLyBUaGUgQ1BVIGZpbHRlciBiZWxvdyBzdGF5cyBhcyB0aGUgZmFsbGJhY2sgd2hlbiB0aGUgR0wgd2lyaW5nIGlzIHVuYXZhaWxhYmxlLlxyXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcclxuICAgICAgICA/IGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCBncHVUaW1lID0gQm9vbGVhbihncHVBdHRycy5oYXNUaW1lKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyU2l6ZSA9IGxheWVyLnJhZGl1cyAhPSBudWxsID8gTnVtYmVyKGxheWVyLnJhZGl1cykgOiBkZWZhdWx0U2l6ZTtcclxuXHJcbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XHJcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCLFxyXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxyXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVPZmZzZXQsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGNvb3Jkcy5sZW5ndGggLyAyO1xyXG5cclxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XHJcbiAgICAgICAgLy8gU2VsZWN0aW9uIHN0eWxpbmcsIGFwcGxpZWQgb3ZlciB0aGUgbGF5ZXIncyBvd24gYW5kIGl0cyBkYXRhLWRyaXZlbiBzdHlsZXMuXHJcbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cclxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcclxuICAgICAgICBjb25zdCBvdmVycmlkZXMgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgfHwgbnVsbDtcclxuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxyXG4gICAgICAgIC8vIHU4IFJHQkEgdW5kZXIgXCI8aWQ+Ojpjb2xvcnNcIiwgZjMyIHBpeGVscyB1bmRlciBcIjxpZD46OnJhZGlpXCIgLS0gY29tcHV0ZWRcclxuICAgICAgICAvLyBpbiBQeXRob24gZnJvbSBjb2xvcl9jb2wvcmFkaXVzX2NvbC4gQnVmZmVycywgbmV2ZXIgcGVyLWZlYXR1cmUgc3R5bGVcclxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxyXG4gICAgICAgIC8vIHBheWxvYWQgdGhhdCB1c2VkIHRvIGtpbGwgc2Vzc2lvbnMuIEV4cGxpY2l0IHN0eWxlcyBzdGlsbCBvdXRyYW5rIHRoZW0uXHJcbiAgICAgICAgY29uc3QgY29sb3JzUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojpjb2xvcnNgXTtcclxuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcclxuICAgICAgICAgICAgPyBuZXcgVWludDhBcnJheShjb2xvcnNSYXcuYnVmZmVyIHx8IGNvbG9yc1JhdywgY29sb3JzUmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcnNSYXcuYnl0ZUxlbmd0aClcclxuICAgICAgICAgICAgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IHJhZGlpUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9OjpyYWRpaWBdO1xyXG4gICAgICAgIGNvbnN0IGJ1ZlJhZGlpID0gcmFkaWlSYXdcclxuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmFkaWlSYXcuYnl0ZUxlbmd0aCAvIDQpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxyXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcclxuICAgICAgICAvLyBvbiB0aGUgc3Vydml2b3JzIGtlZXAgcG9pbnRpbmcgYXQgdGhlIHJpZ2h0IHJvd3MuXHJcbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGZyb21EYXRhID0gcGVyRmVhdHVyZSA/IHBlckZlYXR1cmVbaV0gOiBudWxsO1xyXG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxyXG4gICAgICAgICAgICAgICAgfHwgKGhpZ2hsaWdodCAmJiBoaWdobGlnaHQuY29sb3IpXHJcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xyXG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LnJhZGl1cyAhPSBudWxsID8gaGlnaGxpZ2h0LnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xyXG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxyXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZkNvbG9ycyA/IHsgcjogYnVmQ29sb3JzW2kgKiA0XSAvIDI1NSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZzogYnVmQ29sb3JzW2kgKiA0ICsgMV0gLyAyNTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhOiBidWZDb2xvcnNbaSAqIDQgKyAzXSAvIDI1NSB9XHJcbiAgICAgICAgICAgICAgICAgICAgOiBjb2xvclJHQixcclxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZlJhZGlpID8gYnVmUmFkaWlbaV1cclxuICAgICAgICAgICAgICAgICAgICA6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXHJcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcclxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcclxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cclxuICAgICAgICAgICAgICAgIHNpemU6IChpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyA/IGluZm8uY29sb3JSR0IgOiB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc2Vuc2l0aXZpdHk6IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjAgOiA4LFxyXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlZCBCRUZPUkUgY29tcGV0aW5nIGZvciB0aGUgY2xpY2s6IGEgaGlkZGVuIG9yXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gb3V0LW9mLXdpbmRvdyBwb2ludCBtdXN0IG5vdCBlbnRlciB0aGUgYXJiaXRyYXRpb24gYXQgYWxsLCBzb1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoYXRldmVyIHNpdHMgYmVuZWF0aCBpdCAtLSBhIHZpc2libGUgZmVhdHVyZSwgb3IgdGhlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZW1wdHktbWFwIGZhbGxiYWNrIC0tIHdpbnMgaW5zdGVhZC5cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZUluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXByZUluZm8gfHwgIXZpc2libGVOb3cocHJlSW5mby5sYXllciwgcHJlSW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHByZUluZm87XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGNsaWNrZWQgcG9pbnQncyBvd24gY29vcmRpbmF0ZXMgLS0gbW9yZSB0cnV0aGZ1bFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiB0aGUgbW91c2UgcG9zaXRpb24gZm9yIGEgcG9pbnQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7IGxheWVyLCBpbmRleDogb3JpZ2luYWxJbmRleCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbcG9pbnRbMF0sIHBvaW50WzFdXSB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocG9pbnQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCB0b29sdGlwcyBvbiBmYXIgYXdheSBob3ZlcnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaG92ZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gaG92ZXJQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFpbmZvIHx8ICF2aXNpYmxlTm93KGluZm8ubGF5ZXIsIGluZm8ub3JpZ2luYWxJbmRleCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAxLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICBpZiAodHlwZSA9PT0gXCJtYXJrZXJzXCIpIHtcclxuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy5mcmFnbWVudFNoYWRlclNvdXJjZSA9ICgpID0+IHBpblNoYWRlcjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcclxuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy52ZXJ0ZXhTaGFkZXJTb3VyY2UgPSAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhpcy5nbFBvaW50cyA9IEwuZ2xpZnkucG9pbnRzKGdsaWZ5T3B0aW9ucyk7XHJcbiAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xQb2ludHMpO1xyXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gTnVsbCBvbiBmYWlsdXJlLCB3aGljaCBhbHNvIGZsaXBzIHRoZSBnbG9iYWwgZmxhZzogdGhlIG5leHQgc3luYydzXHJcbiAgICAgICAgICAgICAgICAvLyByZWJ1aWxkIGtleSBjaGFuZ2VzIHdpdGggaXQgYW5kIHRoZSBDUFUgcGF0aCB0YWtlcyBvdmVyLlxyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvSW5zdGFuY2UodGhpcy5nbFBvaW50cywgZ3B1QXR0cnMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcclxuICAgICAgICAgICAgaWYgKGNhbnZhcykgY2FudmFzLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcclxuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XHJcbiAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgcmV0dXJuIGluc3RhbmNlO1xyXG59XHJcbiIsICIvLyBQZXJtYW5lbnQgZmVhdHVyZSBsYWJlbHM6IHRleHQgcGlubmVkIHRvIHRoZSBtYXAsIGZyb20gYSBsYXllcidzIGBsYWJlbGAgKG9uZVxyXG4vLyB2ZWN0b3IgZmVhdHVyZSkgb3IgYGxhYmVsc2AgKG9uZSBwZXIgcG9pbnQsIGFsaWduZWQgd2l0aCB0aGUgY29vcmRpbmF0ZSBidWZmZXIpLlxyXG4vLyBET00gZWxlbWVudHMgYnkgZGVzaWduIC0tIExlYWZsZXQgcGVybWFuZW50IHRvb2x0aXBzIC0tIHdoaWNoIGlzIHdoeSB0aGV5IGFyZSBmb3JcclxuLy8gc2l0ZS1zY2FsZSBsYXllcnM7IFB5dGhvbiB3YXJucyBwYXN0IGEgdGhvdXNhbmQuIE1vZGVsLWZyZWUgbGlrZSB0aGUgbGVnZW5kOiBwdXJlXHJcbi8vIGRhdGEgaW4sIExlYWZsZXQgbGF5ZXJzIG91dCwgcmUtZGVyaXZlZCBlYWNoIHN5bmMgc28gbGFiZWxzIGZvbGxvdyB2aXNpYmlsaXR5XHJcbi8vIHdpdGhvdXQgdG91Y2hpbmcgdGhlIEdMIGJ1Y2tldHMgb3IgdGhlaXIgbWV0YSBrZXlzLlxyXG5cclxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9wYXRjaC5qc1wiO1xyXG5pbXBvcnQgeyB2ZWN0b3JDb29yZHMsIGxpbmVQYXJ0cyB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xyXG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFdoZXRoZXIgYSB3aG9sZSBsYWJlbGxlZCBmZWF0dXJlIGlzIGluc2lkZSB0aGUgY3VycmVudCB0aW1lIHdpbmRvdy4gTmFOIHRpbWVzXHJcbi8vIGtlZXAgdGhlIGxhYmVsLCBtYXRjaGluZyB0aGUgbWFwOiBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YSwgc28gaXRcclxuLy8gbXVzdCBuZXZlciBoaWRlIHRoZSBkYXRhJ3MgbGFiZWwgZWl0aGVyLiBBIG11bHRpLXNwYW4gbGluZSBjb3VudHMgYXMgdmlzaWJsZVxyXG4vLyB3aGlsZSBBTlkgb2YgaXRzIHNlZ21lbnRzIGlzIC0tIHRoZSBsYWJlbCBmb2xsb3dzIHRoZSBsYXllciwgbm90IG9uZSBsZWcuXHJcbmZ1bmN0aW9uIHRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghdGltZVN0YXRlIHx8ICFsYXllci50aW1lKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIHJldHVybiB0cnVlO1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIE9uZSBhbmNob3IgcGVyIGxhYmVsbGVkIGZlYXR1cmUuIFBvaW50cyBsYWJlbCBhdCB0aGUgcG9pbnQ7IGEgbGluZSBsYWJlbHMgYXQgaXRzXHJcbi8vIG1pZGRsZSB2ZXJ0ZXggKG9uIHRoZSBsaW5lLCBub3QgZmxvYXRpbmcgaW4gaXRzIGJvdW5kaW5nIGJveCk7IGEgcG9seWdvbiBvclxyXG4vLyBjaXJjbGUgbGFiZWxzIGF0IGl0cyBib3VuZHMgY2VudHJlLiBXaXRoIGEgdGltZVN0YXRlLCBsYWJlbHMgZm9sbG93IHRoZSB3aW5kb3c6XHJcbi8vIHBvaW50cyBkcm9wIHBlciBwb2ludCwgdmVjdG9ycyBhcyBhIHdob2xlLlxyXG4vLyBEZWdyZWUtc3BhY2UgbGVuZ3RoIG9mIGEgW2xhdCwgbG5nXSBydW4gLS0gb25seSBldmVyIGNvbXBhcmVkIGFnYWluc3QgYW5vdGhlclxyXG4vLyBwYXJ0IG9mIHRoZSBzYW1lIGxpbmUsIHNvIG5vIHByb2plY3Rpb24gaXMgbmVlZGVkIHRvIHBpY2sgdGhlIGxvbmdlciBvbmUuXHJcbmZ1bmN0aW9uIHBsYW5hckxlbmd0aChwYXJ0KSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBwYXJ0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZExhdCA9IHBhcnRbaV1bMF0gLSBwYXJ0W2kgLSAxXVswXTtcclxuICAgICAgICBjb25zdCBkTG5nID0gcGFydFtpXVsxXSAtIHBhcnRbaSAtIDFdWzFdO1xyXG4gICAgICAgIHRvdGFsICs9IE1hdGguc3FydChkTGF0ICogZExhdCArIGRMbmcgKiBkTG5nKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0b3RhbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IG91dCA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSBjb250aW51ZTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLmNvbGxlY3RMYWJlbHMobGF5ZXIubGF5ZXJzIHx8IFtdLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSkpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobGF5ZXIubGFiZWxzKSkge1xyXG4gICAgICAgICAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICBpZiAoIXJhdykgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgICAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihsYXllci5sYWJlbHMubGVuZ3RoLCBjb29yZHMubGVuZ3RoIC8gMik7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllci5sYWJlbHNbaV0pIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbaSAqIDJdKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGNvb3Jkc1tpICogMl0sIGxuZzogY29vcmRzW2kgKiAyICsgMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbHNbaV0pLCBjZW50ZXI6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChsYXllci5sYWJlbCkge1xyXG4gICAgICAgICAgICBpZiAoIXRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgICAgICAgICAgLy8gQW5jaG9yIE9OIGEgcGFydCAtLSB0aGUgbWlkZGxlIHZlcnRleCBvZiB0aGUgbG9uZ2VzdCBwYXJ0LiBUaGVcclxuICAgICAgICAgICAgICAgIC8vIG1pZGRsZSBvZiBhIG11bHRpLXBhcnQgbGluZSdzIHdob2xlIHZlcnRleCBydW4gY2FuIHNpdCBpbiB0aGUgZ2FwXHJcbiAgICAgICAgICAgICAgICAvLyBiZXR3ZWVuIHBhcnRzLCB3aGVyZSB0aGVyZSBpcyBub3RoaW5nIHRvIGxhYmVsLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFydHMgPSBsaW5lUGFydHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb25nZXN0ID0gcGFydHMucmVkdWNlKChiZXN0LCBwYXJ0KSA9PlxyXG4gICAgICAgICAgICAgICAgICAgIHBsYW5hckxlbmd0aChwYXJ0KSA+IHBsYW5hckxlbmd0aChiZXN0KSA/IHBhcnQgOiBiZXN0LCBwYXJ0c1swXSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtaWQgPSBsb25nZXN0W01hdGguZmxvb3IoKGxvbmdlc3QubGVuZ3RoIC0gMSkgLyAyKV07XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbWlkWzBdLCBsbmc6IG1pZFsxXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5ib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtbYUxhdCwgYUxvbl0sIFtiTGF0LCBiTG9uXV0gPSBsYXllci5ib3VuZHM7XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKGFMYXQgKyBiTGF0KSAvIDIsIGxuZzogKGFMb24gKyBiTG9uKSAvIDIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5sb2NhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGxheWVyLmxvY2F0aW9uWzBdLCBsbmc6IGxheWVyLmxvY2F0aW9uWzFdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBObyBib3VuZHMgb24gdGhlIGNvbmZpZyAtLSB0aGUgY29sbGVjdGlvbiBtZXJnZSBkcm9wcGVkIHRoZW0gZm9yXHJcbiAgICAgICAgICAgICAgICAvLyBpdHMgd2hvbGUgaGlzdG9yeSwgYW5kIGhhbmQtYnVpbHQgY29uZmlncyBtYXkgbmV2ZXIgY2FycnkgdGhlbS5cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBjb29yZGluYXRlcyBhcmUgc3RpbGwgaW4gdGhlIGJ1ZmZlciB1bmRlciB0aGUgbGF5ZXIncyBvd24gaWQsXHJcbiAgICAgICAgICAgICAgICAvLyBleGFjdGx5IGFzIHRoZSBwb2x5bGluZSBicmFuY2ggcmVhZHMgdGhlbTsgYSBtaXNzaW5nIGJveCBtdXN0XHJcbiAgICAgICAgICAgICAgICAvLyBkZWdyYWRlIHRvIGNvbXB1dGluZyBvbmUsIG5ldmVyIHRvIHNpbGVudGx5IGRyb3BwaW5nIHRoZSBsYWJlbC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvY3MubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICAgICAgbGV0IG1pbkxuZyA9IEluZmluaXR5LCBtYXhMbmcgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtsYXQsIGxuZ10gb2YgbG9jcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA8IG1pbkxuZykgbWluTG5nID0gbG5nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsbmcgPiBtYXhMbmcpIG1heExuZyA9IGxuZztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAobWluTGF0ICsgbWF4TGF0KSAvIDIsIGxuZzogKG1pbkxuZyArIG1heExuZykgLyAyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBSZWJ1aWxkcyBgZ3JvdXBgIChhbiBMLmxheWVyR3JvdXApIHRvIGhvbGQgZXhhY3RseSB0aGUgY3VycmVudCBsYWJlbHMsIHNraXBwaW5nXHJcbi8vIHRoZSB3b3JrIHdoZW4gbm90aGluZyBjaGFuZ2VkIC0tIHN5bmNzIHJ1biBvbiBldmVyeSB0b2dnbGUgYW5kIHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMYWJlbHMoTCwgZ3JvdXAsIGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBsYWJlbHMgPSBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUpO1xyXG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkobGFiZWxzKTtcclxuICAgIGlmIChncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9PT0ga2V5KSByZXR1cm47XHJcbiAgICBncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9IGtleTtcclxuICAgIGdyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbGFiZWxzKSB7XHJcbiAgICAgICAgLy8gQ29udGVudCBhcyBhbiBlbGVtZW50IHdpdGggdGV4dENvbnRlbnQ6IHRvb2x0aXAgc3RyaW5nIGNvbnRlbnQgaXMgSFRNTCxcclxuICAgICAgICAvLyBhbmQgbGFiZWxzIGNvbWUgZnJvbSB1c2VyIGRhdGEsIHdoaWNoIG11c3QgbmV2ZXIgcGFyc2UgYXMgbWFya3VwLlxyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gaXRlbS50ZXh0O1xyXG4gICAgICAgIGNvbnN0IHRvb2x0aXAgPSBMLnRvb2x0aXAoe1xyXG4gICAgICAgICAgICBwZXJtYW5lbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGRpcmVjdGlvbjogaXRlbS5jZW50ZXIgPyBcImNlbnRlclwiIDogXCJ0b3BcIixcclxuICAgICAgICAgICAgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWZlYXR1cmUtbGFiZWxcIixcclxuICAgICAgICAgICAgb2Zmc2V0OiBpdGVtLmNlbnRlciA/IFswLCAwXSA6IFswLCAtNl0sXHJcbiAgICAgICAgfSkuc2V0TGF0TG5nKFtpdGVtLmxhdCwgaXRlbS5sbmddKS5zZXRDb250ZW50KHNwYW4pO1xyXG4gICAgICAgIGdyb3VwLmFkZExheWVyKHRvb2x0aXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkQ1NTLCBsb2FkSlMgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJTaWRlYmFyQ29udHJvbHMsIG5vcm1hbGl6ZVJhZGlvTGF5ZXJzLCBzaWRlYmFyQ29sbGFwc2VTdGF0ZSB9IGZyb20gXCIuL3NpZGViYXIuanNcIjtcclxuaW1wb3J0IHsgZGVyaXZlTGVnZW5kU3BlYywgcmVuZGVyTGVnZW5kIH0gZnJvbSBcIi4vbGVnZW5kLmpzXCI7XHJcbmltcG9ydCB7IHJlbmRlckxhYmVscyB9IGZyb20gXCIuL2xhYmVscy5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJMYXllciwgcmVuZGVyTWVyZ2VkR2xMYXllciwgcmVnaXN0ZXJDbGlja01hdGNoLCBpbWFnZU1ldGFLZXkgfSBmcm9tIFwiLi9sYXllcnMuanNcIjtcclxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIGdlbmVyYXRlVGlja3MsIGNvbGxlY3RUaW1lRXh0ZW50LCBoYXNUaW1lTGF5ZXJzLFxyXG4gICAgICAgICBsYXllckluV2luZG93LCByZW5kZXJUaW1lQ29udHJvbCwgYWR2YW5jZSwgcGVyaW9kVG9NcywgZ2NkR3JpZE1zLFxyXG4gICAgICAgICBjb2xsZWN0RHVyYXRpb25zTXMsIFBPU0lUSU9OUywgdGltZXNGb3IsIHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LFxyXG4gICAgICAgICBlZmZlY3RpdmVEdXJhdGlvbiwgbmVhcmVzdFRpY2tJbmRleCB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XHJcbmltcG9ydCB7IGdwdVRpbWVBdmFpbGFibGUsIHZlY3RvckdwdUF2YWlsYWJsZSwgTEFZRVJfU0xPVFMgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcbmltcG9ydCB7IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlLCBjb2xsZWN0V2ViZ2xMYXllcnMsIGNvbGxlY3RQb2ludExheWVyc0FsbCxcclxuICAgICAgICAgYXBwbHlTd2lmdG1hcFBhdGNoLCBidWZmZXJTZXJpYWwgfSBmcm9tIFwiLi9wYXRjaC5qc1wiO1xyXG5cclxuLy8gVGhlIHNpZGViYXIncyB0b2dnbGUgd3JpdGUtYmFjazogdGFyZ2V0ZWQgdmlzaWJpbGl0eSBmbGlwcyB0aHJvdWdoIHNlbmQoKSxcclxuLy8gbmV2ZXIgdGhlIGxheWVycyB0cmFpdC4gVGhlIGZ1bGwgd3JpdGUgc2NhbGVkIHdpdGggdGhlIG1hcCBpbnN0ZWFkIG9mIHRoZVxyXG4vLyBjbGljayAtLSAzNiBNQiBhdCAyNSB0cmFja3MgeCAyMDBrIHZlcnRpY2VzLCBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0XHJcbi8vIHdlYnNvY2tldCBjYXAsIHdoaWNoIGNsb3NlcyB0aGUgY29ubmVjdGlvbiBhbmQgZW5kcyB0aGUgU2hpbnkgc2Vzc2lvbi5cclxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRMYXllcldyaXRlKGhvc3QsIGNoYW5nZXMpIHtcclxuICAgIGlmICghY2hhbmdlcy5sZW5ndGgpIHJldHVybjtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgaG9zdC5zZW5kKHtcclxuICAgICAgICAgICAga2luZDogXCJzd2lmdG1hcF93cml0ZVwiLFxyXG4gICAgICAgICAgICBvcHM6IGNoYW5nZXMubWFwKGMgPT4gKHsgb3A6IFwic2V0XCIsIGlkOiBjLmlkLCBmaWVsZHM6IHsgdmlzaWJsZTogYy52aXNpYmxlIH0gfSkpLFxyXG4gICAgICAgIH0pO1xyXG4gICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIHJlbmRlcmVkIGxpc3QgYWxyZWFkeSBob2xkcyB0aGUgY2hhbmdlICovIH1cclxufVxyXG5cclxuLy8gTW91bnRzIG9uZSBzd2lmdG1hcCBtYXAgaW50byBgZWxgLCBkcml2ZW4gYnkgYSBob3N0IC0tIHNlZSBzcmMvaG9zdC5qcyBmb3IgdGhlXHJcbi8vIGludGVyZmFjZS4gVGhlIHdpZGdldCwgYSBzdGF0aWMgZXhwb3J0IGFuZCBhIFJlYWN0IGNvbXBvbmVudCBhcmUgYWxsIGhvc3RzIG92ZXJcclxuLy8gdGhpcyBvbmUgZnVuY3Rpb247IGl0IG5ldmVyIHNlZXMgYW4gYW55d2lkZ2V0IG1vZGVsLCBvbmx5IHRoZSBmaXZlIGhvc3QgbWV0aG9kcy5cclxuLy9cclxuLy8gUmV0dXJucyBhIGhhbmRsZTogdGhlIExlYWZsZXQgbWFwLCB0aGUgY29udGFpbmVyIGVsZW1lbnQsIGEgYHN5bmNgIHRvIGZvcmNlIGFcclxuLy8gcmUtcmVuZGVyLCBhbmQgYGRlc3Ryb3lgIHRvIHRlYXIgZXZlcnl0aGluZyBkb3duLlxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlU3dpZnRNYXAoeyBob3N0LCBlbCB9KSB7XHJcbiAgICAvLyBFdmVyeSBob3N0IHN1YnNjcmlwdGlvbiwgc28gZGVzdHJveSgpIGNhbiB1bnN1YnNjcmliZSBmcm9tIGEgaG9zdCB0aGF0XHJcbiAgICAvLyBvZmZlcnMgYG9mZmAgKGFueXdpZGdldCdzIG1vZGVsIGRvZXM7IGEgbWluaW1hbCBzdHViIG1heSBub3QpLlxyXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IFtdO1xyXG4gICAgZnVuY3Rpb24gbGlzdGVuKGV2ZW50LCBmbikge1xyXG4gICAgICAgIHN1YnNjcmlwdGlvbnMucHVzaChbZXZlbnQsIGZuXSk7XHJcbiAgICAgICAgaG9zdC5vbihldmVudCwgZm4pO1xyXG4gICAgfVxyXG4gICAgbGV0IGRlc3Ryb3llZCA9IGZhbHNlO1xyXG5cclxuICAgIGNvbnN0IG9yaWdpbmFsRXJyb3IgPSBjb25zb2xlLmVycm9yO1xyXG4gICAgY29uc3Qgb3JpZ2luYWxXYXJuID0gY29uc29sZS53YXJuO1xyXG5cclxuICAgIC8vIGpzX2NvbnNvbGVfbG9ncyBpcyBhIHN5bmNlZCBsaXN0LCBzbyBlYWNoIGFwcGVuZCByZXNlbmRzIHRoZSB3aG9sZSBhcnJheS4gS2VlcGluZ1xyXG4gICAgLy8gb25seSB0aGUgbW9zdCByZWNlbnQgZW50cmllcyBib3VuZHMgYm90aCB0aGUgcGF5bG9hZCBhbmQgdGhlIG1lbW9yeSBhIGxvbmctbGl2ZWRcclxuICAgIC8vIHNlc3Npb24gYWNjdW11bGF0ZXM7IHRoZSBuZXdlc3QgYXJlIHRoZSBvbmVzIHdvcnRoIGhhdmluZyBhbnl3YXkuXHJcbiAgICBjb25zdCBNQVhfQ09OU09MRV9MT0dTID0gMjAwO1xyXG4gICAgY29uc3QgYXBwZW5kTG9nID0gZW50cnkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGxvZ3MgPSBob3N0LmdldChcImpzX2NvbnNvbGVfbG9nc1wiKSB8fCBbXTtcclxuICAgICAgICBjb25zdCBuZXh0ID0gWy4uLmxvZ3MsIGVudHJ5XTtcclxuICAgICAgICByZXR1cm4gbmV4dC5sZW5ndGggPiBNQVhfQ09OU09MRV9MT0dTID8gbmV4dC5zbGljZSgtTUFYX0NPTlNPTEVfTE9HUykgOiBuZXh0O1xyXG4gICAgfTtcclxuXHJcbiAgICAvLyBIZWxwZXIgdG8gc2FmZWx5IHdyaXRlIGJhY2sgdG8gUHl0aG9uIG9ubHkgaWYgdGhlIHdpZGdldCB2aWV3IGlzIGFjdGl2ZSBhbmQgYXR0YWNoZWRcclxuICAgIGZ1bmN0aW9uIHNhZmVTZXRBbmRTYXZlKGtleSwgdmFsdWUpIHtcclxuICAgICAgICBpZiAoZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KGtleSwgdmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyB3cml0ZSBlcnJvcjpcIiwgZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gc2FmZVNhdmVDaGFuZ2VzKCkge1xyXG4gICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyBzYXZlIGVycm9yOlwiLCBlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmVycm9yID0gZnVuY3Rpb24oLi4uYXJncykge1xyXG4gICAgICAgIG9yaWdpbmFsRXJyb3IuYXBwbHkoY29uc29sZSwgYXJncyk7XHJcbiAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIixcclxuICAgICAgICAgICAgYXBwZW5kTG9nKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xyXG4gICAgY29uc29sZS53YXJuID0gZnVuY3Rpb24oLi4uYXJncykge1xyXG4gICAgICAgIGNvbnN0IG1zZyA9IGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKTtcclxuICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xyXG4gICAgICAgICAgICBpZiAoIWxvZ2dlZFJlcHJvamVjdGVkKSB7XHJcbiAgICAgICAgICAgICAgICBsb2dnZWRSZXByb2plY3RlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBob3N0LmdldChcImNyc1wiKSB8fCBcIkVQU0c6Mzg1N1wiO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2xlYW5Nc2cgPSBgW1N3aWZ0TWFwXSBMYXllciB3YXMgcmVwcm9qZWN0ZWQgdG8gXCIke2Nyc31cImA7XHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBjbGVhbk1zZyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIGFwcGVuZExvZyhjbGVhbk1zZykpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybjsgLy8gc3VwcHJlc3MgZHVwbGljYXRlIGNvbnNvbGUgd2FybmluZ3NcclxuICAgICAgICB9XHJcbiAgICAgICAgb3JpZ2luYWxXYXJuLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBvbldpbmRvd0Vycm9yID0gZnVuY3Rpb24obWVzc2FnZSwgc291cmNlLCBsaW5lbm8sIGNvbG5vLCBlcnJvcikge1xyXG4gICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXHJcbiAgICAgICAgICAgIGFwcGVuZExvZyhgV0lORE9XLk9ORVJST1I6ICR7bWVzc2FnZX0gYXQgJHtzb3VyY2V9OiR7bGluZW5vfToke2NvbG5vfWApKTtcclxuICAgIH07XHJcbiAgICB3aW5kb3cub25lcnJvciA9IG9uV2luZG93RXJyb3I7XHJcblxyXG4gICAgLy8gTG9hZCBDU1MgYW5kIExlYWZsZXQgbGlicmFyaWVzIChpbmNsdWRpbmcgV2ViR0wgZ2xpZnkpXHJcbiAgICBsb2FkQ1NTKFwibGVhZmxldC1jc3NcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5jc3NcIik7XHJcbiAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWpzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIik7XHJcbiAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdsaWZ5XCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldC5nbGlmeUAzLjMuMC9kaXN0L2dsaWZ5LWJyb3dzZXIuanNcIik7XHJcbiAgICAvLyBHZW9tYW4gbXVzdCBsb2FkIEJFRk9SRSB0aGUgbWFwIGlzIGNvbnN0cnVjdGVkOiBpdCBhdHRhY2hlcyBtYXAucG0gdGhyb3VnaFxyXG4gICAgLy8gYSBMZWFmbGV0IGluaXQgaG9vaywgd2hpY2ggb25seSBydW5zIGZvciBtYXBzIGNyZWF0ZWQgYWZ0ZXIgdGhlIHBsdWdpblxyXG4gICAgLy8gZXhpc3RzIC0tIGxhenktbG9hZGluZyBpdCBsYXRlciBsZWF2ZXMgbWFwLnBtIHVuZGVmaW5lZCBmb3JldmVyLlxyXG4gICAgbG9hZENTUyhcImxlYWZsZXQtZ2VvbWFuLWNzc1wiLFxyXG4gICAgICAgIFwiaHR0cHM6Ly91bnBrZy5jb20vQGdlb21hbi1pby9sZWFmbGV0LWdlb21hbi1mcmVlQDIuMTguMy9kaXN0L2xlYWZsZXQtZ2VvbWFuLmNzc1wiKTtcclxuICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2VvbWFuXCIsXHJcbiAgICAgICAgXCJodHRwczovL3VucGtnLmNvbS9AZ2VvbWFuLWlvL2xlYWZsZXQtZ2VvbWFuLWZyZWVAMi4xOC4zL2Rpc3QvbGVhZmxldC1nZW9tYW4ubWluLmpzXCIpO1xyXG5cclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcclxuICAgIGNvbnRhaW5lci5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xyXG4gICAgY29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xyXG4gICAgZWwuYXBwZW5kQ2hpbGQoY29udGFpbmVyKTtcclxuXHJcbiAgICAvLyBNYXAoaGVpZ2h0PS4uLikgc2l6aW5nLiBBbiBleHBsaWNpdCBoZWlnaHQgYWxzbyBkcm9wcyB0aGUgc3R5bGVzaGVldCdzXHJcbiAgICAvLyA0MDBweCBmbG9vciAtLSBhbiBleHBsaWNpdCAyMDBweCBtdXN0IG5vdCBsb3NlIHRvIGEgZGVmYXVsdCBtaW5pbXVtLlxyXG4gICAgLy8gSGVpZ2h0IHdhcyBhY2NlcHRlZCBhbmQgZG9jdW1lbnRlZCBsb25nIGJlZm9yZSBpdCByZWFjaGVkIHRoZSBET007IHRoaXNcclxuICAgIC8vIGlzIHdoZXJlIGl0IGZpbmFsbHkgZG9lcy5cclxuICAgIGZ1bmN0aW9uIGFwcGx5SGVpZ2h0KCkge1xyXG4gICAgICAgIGNvbnN0IGggPSBob3N0LmdldChcImhlaWdodFwiKTtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUuaGVpZ2h0ID0gaCB8fCBcIjEwMCVcIjtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUubWluSGVpZ2h0ID0gaCA/IFwiMFwiIDogXCJcIjtcclxuICAgIH1cclxuICAgIGFwcGx5SGVpZ2h0KCk7XHJcblxyXG4gICAgbGV0IGxhYmVsc0dyb3VwID0gbnVsbDsgICAvLyBjcmVhdGVkIGFmdGVyIHRoZSBtYXA7IGZpbGxlZCBieSBlYWNoIHN5bmNcclxuXHJcbiAgICBjb25zdCBjcnNOYW1lID0gaG9zdC5nZXQoXCJjcnNcIik7XHJcbiAgICBsZXQgbWFwQ3JzID0gTC5DUlMuRVBTRzM4NTc7XHJcbiAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xyXG4gICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1hcCA9IEwubWFwKGNvbnRhaW5lciwge1xyXG4gICAgICAgIGNyczogbWFwQ3JzLFxyXG4gICAgICAgIGNlbnRlcjogaG9zdC5nZXQoXCJjZW50ZXJcIiksXHJcbiAgICAgICAgem9vbTogaG9zdC5nZXQoXCJ6b29tXCIpLFxyXG4gICAgICAgIHNjcm9sbFdoZWVsWm9vbTogdHJ1ZSxcclxuICAgICAgICBwcmVmZXJDYW52YXM6IHRydWVcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcclxuICAgIG1hcC5nZXRQYW5lKFwicG9seWdvbnNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDEwXCI7XHJcbiAgICBcclxuICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcclxuICAgIG1hcC5nZXRQYW5lKFwicG9seWxpbmVzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQyMFwiO1xyXG4gICAgXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MzBcIjtcclxuXHJcbiAgICAvLyBEcmF3biB2ZWN0b3JzIGxpdmUgQUJPVkUgdGhlIEdMIHBhbmVzLiBHZW9tYW4gZGVmYXVsdHMgdGhlbSBpbnRvIExlYWZsZXQnc1xyXG4gICAgLy8gb3ZlcmxheVBhbmUgKDQwMCksIHdoaWNoIHNpdHMgdW5kZXIgdGhlIEdMIGNhbnZhc2VzICg0MTAvNDIwLzQzMCkgd2hvc2VcclxuICAgIC8vIHBvaW50ZXItZXZlbnRzIGFyZSBmb3JjZWQgb24gLS0gc28gd2l0aCBhbnkgR0wgbGF5ZXIgcHJlc2VudCwgY2xpY2tzIG1lYW50XHJcbiAgICAvLyBmb3IgYSBkcmF3biBzaGFwZSBuZXZlciBhcnJpdmVkOiBkcmF3aW5nIHdvcmtlZCAoR2VvbWFuIGxpc3RlbnMgb24gdGhlXHJcbiAgICAvLyBjb250YWluZXIpIHdoaWxlIHJlbW92YWwsIGVkaXQgYW5kIGRyYWcgc2lsZW50bHkgZGlkIG5vdGhpbmcuXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0NDBcIjtcclxuXHJcbiAgICBsYWJlbHNHcm91cCA9IEwubGF5ZXJHcm91cCgpLmFkZFRvKG1hcCk7XHJcblxyXG4gICAgLy8gTG9jYWwgbWlycm9ycyBvZiB0aGUgbGF5ZXIgbGlzdCBhbmQgY29vcmRpbmF0ZSBidWZmZXJzLlxyXG4gICAgLy9cclxuICAgIC8vIFB5dGhvbiB1cGRhdGVzIHRoZXNlIGluY3JlbWVudGFsbHkgdmlhIFwic3dpZnRtYXBfcGF0Y2hcIiBtZXNzYWdlcyBpbnN0ZWFkIG9mXHJcbiAgICAvLyByZWFzc2lnbmluZyB0aGUgdHJhaXRzLCBiZWNhdXNlIGEgdHJhaXQgcmVhc3NpZ25tZW50IHJlLXNlcmlhbGl6ZXMgYW5kIHJlLXNlbmRzXHJcbiAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxyXG4gICAgLy8gd2hlbiBhIHZpZXcgYXR0YWNoZXMsIGFuZCB0aGUgc2lkZWJhciBzdGlsbCB3cml0ZXMgYGxheWVyc2AgYmFjayBvbiB0b2dnbGUsIHNvXHJcbiAgICAvLyBib3RoIGFyZSBzZWVkZWQgaGVyZSBhbmQga2VwdCBpbiBzdGVwIGJ5IHRoZSBjaGFuZ2UgaGFuZGxlcnMgZnVydGhlciBkb3duLlxyXG4gICAgbGV0IGxheWVyU3RhdGUgPSBob3N0LmdldChcImxheWVyc1wiKSB8fCBbXTtcclxuICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKGhvc3QuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIGFwcGx5UGF0Y2hPcHMob3BzLCBidWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcclxuICAgICAgICBsYXllclN0YXRlID0gbmV4dC5sYXllcnM7XHJcbiAgICAgICAgYnVmZmVyU3RhdGUgPSBuZXh0LmJ1ZmZlcnM7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTGl2ZSBmZWF0dXJlIHZpc2liaWxpdHksIGZvciBoaXQtdGVzdGluZy4gR1BVLXBhdGggYnVja2V0cyBrZWVwIEVWRVJZXHJcbiAgICAvLyBsYXllciAtLSBoaWRkZW4gb25lcyBhcmUgbWFza2VkIGJ5IGEgc2hhZGVyIHVuaWZvcm0gLS0gYW5kIGdsaWZ5J3NcclxuICAgIC8vIGhpdC10ZXN0cyBydW4gYWdhaW5zdCB0aGUgYnVja2V0J3MgZGF0YSwgd2hpY2ggY2Fubm90IHNlZSB1bmlmb3JtczogYVxyXG4gICAgLy8gcmFkaW8taGlkZGVuIGxheWVyJ3MgZmVhdHVyZXMgc3RpbGwgd29uIGNsaWNrcyBhbmQgYW5zd2VyZWQgd2l0aCBwb3B1cHMuXHJcbiAgICAvLyBMb29rZWQgdXAgZnJlc2ggcGVyIGV2ZW50LCBiZWNhdXNlIHRoZSBjb25maWcgY2FwdHVyZWQgYXQgYnVpbGQgdGltZSBnb2VzXHJcbiAgICAvLyBzdGFsZSB0aGUgbW9tZW50IGEgcGF0Y2ggb3AgcmVwbGFjZXMgaXQ7IHRoZSB0aW1lIGNoZWNrIHJlYWRzIHRoZSBsaXZlXHJcbiAgICAvLyB0aWNrIHRoZSBzYW1lIHdheSwgc2luY2UgdGlja3MgY2hhbmdlIHdpdGhvdXQgcmVidWlsZGluZyB0aGUgYnVja2V0LlxyXG4gICAgZnVuY3Rpb24gZmluZExheWVyTm93KGxpc3QsIGlkKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBsIG9mIGxpc3QpIHtcclxuICAgICAgICAgICAgaWYgKGwuaWQgPT09IGlkKSByZXR1cm4gbDtcclxuICAgICAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdWIgPSBmaW5kTGF5ZXJOb3cobC5sYXllcnMgfHwgW10sIGlkKTtcclxuICAgICAgICAgICAgICAgIGlmIChzdWIpIHJldHVybiBzdWI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiBmZWF0dXJlVmlzaWJsZU5vdyhsYXllciwgaW5kZXgpIHtcclxuICAgICAgICBjb25zdCBjdXJyZW50ID0gZmluZExheWVyTm93KGxheWVyU3RhdGUsIGxheWVyLmlkKSB8fCBsYXllcjtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGN1cnJlbnQsIGhvc3QuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWN1cnJlbnQudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGN1cnJlbnQsIGJ1ZmZlclN0YXRlKTtcclxuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICBjb25zdCB3aW4gPSB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssXHJcbiAgICAgICAgICAgIGVmZmVjdGl2ZUR1cmF0aW9uKGN1cnJlbnQsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xyXG4gICAgICAgIGlmIChpbmRleCAhPSBudWxsICYmIHRpbWVzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lc1tpbmRleCAqIDJdO1xyXG4gICAgICAgICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHN0YXJ0KVxyXG4gICAgICAgICAgICAgICAgfHwgZmVhdHVyZUluV2luZG93KHN0YXJ0LCB0aW1lc1tpbmRleCAqIDIgKyAxXSwgd2luKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKVxyXG4gICAgICAgICAgICAgICAgICAgIHx8IGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEZlYXR1cmUgY2xpY2tzLCB3cml0dGVuIHRvIHRoZSBob3N0IEJBUkUgLS0gbm8gZ2F0aW5nIG9uIGEgY29tbSBwcm9wZXJ0eTpcclxuICAgIC8vIHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vbmUsIGFuZCBnYXRpbmcgb24gaXQgc2lsZW50bHkga2lsbGVkIGV2ZXJ5XHJcbiAgICAvLyB3cml0ZWJhY2sgdW5kZXIgU2hpbnkuIE9uZSBrZXkgYWx3YXlzIGFuc3dlcnMgXCJ3aGVyZVwiIChjbGlja2VkX2xhdGxuZyksXHJcbiAgICAvLyBjbGlja2VkX2xheWVyX2lkIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKSwgYW5kIGNsaWNrX3NlcSBidW1wc1xyXG4gICAgLy8gb24gRVZFUlkgY2xpY2sgc28gYSByZXBlYXQgY2xpY2sgb24gdGhlIHNhbWUgZmVhdHVyZSBzdGlsbCBmaXJlcy5cclxuICAgIGNvbnN0IGxheWVyRXZlbnRzID0ge1xyXG4gICAgICAgIG9uRmVhdHVyZUNsaWNrOiAoeyBsYXllciwgaW5kZXgsIGxhdGxuZyB9KSA9PiB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBpbmRleCk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF0bG5nXCIsIGxhdGxuZyk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrX3NlcVwiLCAoaG9zdC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGFjdGl2ZVRpbGVMYXllcnMgPSB7fTtcclxuICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcclxuICAgIGNvbnN0IGdsU3RhdGVzID0ge1xyXG4gICAgICAgIGNpcmNsZV9tYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcclxuICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcclxuICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXHJcbiAgICAgICAgcG9seWdvbjogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH1cclxuICAgIH07XHJcblxyXG4gICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xyXG4gICAgLy8gYW5kIHRoZSBwZXJpb2QsIG9yIG51bGwgd2hlbiBub3RoaW5nIGlzIGFuaW1hdGVkIC0tIGFuZCBgdGltZVVJYCBpcyB0aGUgc2xpZGVyJ3NcclxuICAgIC8vIG93biBib29ra2VlcGluZy4gUGxheWJhY2sgbmV2ZXIgcm91bmQtdHJpcHMgdGhyb3VnaCBQeXRob246IHRpY2tzIHJlLXJlbmRlclxyXG4gICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXHJcbiAgICBsZXQgdGltZVN0YXRlID0gbnVsbDtcclxuICAgIGNvbnN0IHRpbWVVSSA9IHsgdGlja3M6IFtdLCBrZXk6IFwiXCIsIGluZGV4OiAwLCBwbGF5aW5nOiBmYWxzZSwgbG9vcDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgd2luZG93OiBudWxsLCBwZXJpb2RNczogbnVsbCwgZ3JpZE1zOiBudWxsIH07XHJcblxyXG4gICAgZnVuY3Rpb24gc3RvcFBsYXliYWNrKCkge1xyXG4gICAgICAgIGlmICh0aW1lVUkudGltZXIpIGNsZWFySW50ZXJ2YWwodGltZVVJLnRpbWVyKTtcclxuICAgICAgICB0aW1lVUkudGltZXIgPSBudWxsO1xyXG4gICAgICAgIHRpbWVVSS5wbGF5aW5nID0gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gd3JpdGVUaW1lQ3VycmVudChmb3JjZSkge1xyXG4gICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgaWYgKCFmb3JjZSAmJiBub3cgLSB0aW1lVUkubGFzdFdyaXRlIDwgMTAwMCkgcmV0dXJuO1xyXG4gICAgICAgIHRpbWVVSS5sYXN0V3JpdGUgPSBub3c7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaG9zdC5zZXQoXCJ0aW1lX2N1cnJlbnRcIiwgdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pO1xyXG4gICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHNlZWtUbyhpbmRleCwgeyB3cml0ZSA9IHRydWUgfSA9IHt9KSB7XHJcbiAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kLFxyXG4gICAgICAgICAgICAgICAgICAgICAgd2luZG93OiB0aW1lVUkud2luZG93IH07XHJcbiAgICAgICAgaWYgKHdyaXRlKSB3cml0ZVRpbWVDdXJyZW50KCF0aW1lVUkucGxheWluZyk7XHJcbiAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBzdGFydFBsYXliYWNrKCkge1xyXG4gICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgIHRpbWVVSS5wbGF5aW5nID0gdHJ1ZTtcclxuICAgICAgICB0aW1lVUkudGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhZHZhbmNlKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCwgdGltZVVJLmxvb3ApO1xyXG4gICAgICAgICAgICBpZiAoIW5leHQucGxheWluZykge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBzZWVrVG8obmV4dC5pbmRleCk7XHJcbiAgICAgICAgfSwgMTAwMCAvIHRpbWVVSS5zcGVlZCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdGltZUhhbmRsZXJzID0ge1xyXG4gICAgICAgIG9uU2VlazogKGluZGV4KSA9PiBzZWVrVG8oaW5kZXgpLFxyXG4gICAgICAgIG9uU3RlcEJhY2s6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggLSAxKSxcclxuICAgICAgICBvblN0ZXBGb3J3YXJkOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4ICsgMSksXHJcbiAgICAgICAgb25QbGF5VG9nZ2xlOiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gc3RhcnRPdmVyLCBhcyB0aGUgZm9saXVtIHBsYXllciB3YXMgY29uZmlndXJlZDogcHJlc3NpbmcgcGxheSBhdFxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGVuZCByZXN0YXJ0cyBmcm9tIHRoZSBiZWdpbm5pbmcgaW1tZWRpYXRlbHksIHJhdGhlciB0aGFuIG9uZVxyXG4gICAgICAgICAgICAgICAgLy8gc2lsZW50IGludGVydmFsIGxhdGVyIGRlY2lkaW5nIHRoZXJlIGlzIG5vd2hlcmUgdG8gZ28gYW5kIHN0b3BwaW5nLlxyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5pbmRleCA+PSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkgc2Vla1RvKDApO1xyXG4gICAgICAgICAgICAgICAgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLmxvb3AgPSAhdGltZVVJLmxvb3A7XHJcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvblNwZWVkOiAoc3BlZWQpID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gc3BlZWQ7XHJcbiAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gTGl2ZSBkdXJpbmcgdGhlIGRyYWc6IGxvY2FsIHN0YXRlIGFuZCBhIHJlLXJlbmRlciBvZiB0aGUgY29udHJvbCBvbiBldmVyeVxyXG4gICAgICAgIC8vIG1vdmUsIGJ1dCBtYXAgcmVidWlsZHMgYXQgbW9zdCBldmVyeSAzMDBtcy4gQXQgNU0gcG9pbnRzIGEgcmVidWlsZCBjb3N0c1xyXG4gICAgICAgIC8vIHNlY29uZHMsIGFuZCBhIGRyYWcgZmlyZXMgZG96ZW5zIG9mIG1vdmVzIC0tIHVudGhyb3R0bGVkLCB0aGUgcmVidWlsZHNcclxuICAgICAgICAvLyBzdGFjayBmYXN0ZXIgdGhhbiB0aGV5IGZpbmlzaCBhbmQgdGhlIGFsbG9jYXRpb24gY2h1cm4gY3Jhc2hlcyB0aGUgdGFiLlxyXG4gICAgICAgIG9uV2luZG93RHJhZzogKGlzbykgPT4ge1xyXG4gICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBpc287XHJcbiAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHRpbWVTdGF0ZSA9IHsgLi4udGltZVN0YXRlLCB3aW5kb3c6IGlzbyB9O1xyXG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICBpZiAobm93IC0gKHRpbWVVSS5sYXN0RHJhZ1N5bmMgfHwgMCkgPj0gMzAwKSB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkubGFzdERyYWdTeW5jID0gbm93O1xyXG4gICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIE9uIHJlbGVhc2UgKG9yIGEga2V5Ym9hcmQgc3RlcCk6IHRoZSBvdmVycmlkZSBsYW5kcyBpbiB0aW1lX2NvbmZpZyBzb1xyXG4gICAgICAgIC8vIFB5dGhvbiBhbmQgU2hpbnkgc2VlIHRoZSBzYW1lIHdpbmRvdyB0aGUgYmFyIHNob3dzLiBudWxsIGNsZWFycyB0aGUga2V5LFxyXG4gICAgICAgIC8vIGhhbmRpbmcgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXHJcbiAgICAgICAgb25XaW5kb3dDb21taXQ6IChpc28pID0+IHtcclxuICAgICAgICAgICAgdGltZUhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xyXG4gICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTsgICAgICAgLy8gdGhlIHJlbGVhc2UgYWx3YXlzIGxhbmRzLCB0aHJvdHRsZSBvciBub3RcclxuICAgICAgICAgICAgY29uc3QgY2ZnID0geyAuLi4oaG9zdC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fSkgfTtcclxuICAgICAgICAgICAgaWYgKGlzbykgY2ZnLndpbmRvdyA9IGlzbztcclxuICAgICAgICAgICAgZWxzZSBkZWxldGUgY2ZnLndpbmRvdztcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwidGltZV9jb25maWdcIiwgY2ZnKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBsb2NhbCBob3N0IHN0aWxsIGhvbGRzIGl0ICovIH1cclxuICAgICAgICB9LFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBDcmVhdGVzLCByZXR1bmVzIG9yIHJlbW92ZXMgdGhlIHNsaWRlciB0byBtYXRjaCB0aGUgbGF5ZXJzIHByZXNlbnQuIFRpY2tzIGFyZVxyXG4gICAgLy8gcmVnZW5lcmF0ZWQgb25seSB3aGVuIHRoZSBkYXRhJ3MgdGltZSBleHRlbnQgb3IgdGhlIHBlcmlvZCBjaGFuZ2VzLCBzbyBhXHJcbiAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxyXG4gICAgZnVuY3Rpb24gdXBkYXRlVGltZURpbWVuc2lvbigpIHtcclxuICAgICAgICBpZiAoIWhhc1RpbWVMYXllcnMobGF5ZXJTdGF0ZSkpIHtcclxuICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgeyB0aWNrczogW10gfSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0gXCJcIjtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XHJcbiAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xyXG4gICAgICAgIGlmICghZXh0ZW50KSByZXR1cm47XHJcblxyXG4gICAgICAgIGNvbnN0IGtleSA9IGAke2V4dGVudC5taW59fCR7ZXh0ZW50Lm1heH18JHtjZmcucGVyaW9kIHx8IFwiUDFEXCJ9YDtcclxuICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XHJcbiAgICAgICAgICAgIC8vIFRoZSBwbGF5aGVhZCBpcyBhIE1PTUVOVCwgbm90IGFuIGluZGV4LiBMYXRlIGRhdGEgcHJlcGVuZHMgdGlja3NcclxuICAgICAgICAgICAgLy8gYW5kIGEgZ3Jvd24gZXh0ZW50IGFwcGVuZHMgdGhlbTsgdGhlIHVzZXIncyBwb3NpdGlvbiBpbiB0aW1lIGlzIGFcclxuICAgICAgICAgICAgLy8gY2hvc2VuIHZpZXcgLS0gdGhlIHNhbWUgcnVsZSB0aGF0IGtlZXBzIGEgZGF0YSB1cGRhdGUgZnJvbSBtb3ZpbmdcclxuICAgICAgICAgICAgLy8gYSBjaG9zZW4gdmlld3BvcnQgLS0gc28gaXQgc25hcHMgdG8gdGhlIG5lYXJlc3QgdGljayBvZiB0aGUgbmV3XHJcbiAgICAgICAgICAgIC8vIHNlcmllcyBhbmQgbmV2ZXIgcmVzZXRzIHRvIHRoZSBzdGFydCwgcGF1c2VkIG9yIHBsYXlpbmcgKHBsYXliYWNrXHJcbiAgICAgICAgICAgIC8vIHNpbXBseSBjb250aW51ZXMgZnJvbSB0aGUgc25hcHBlZCBpbmRleCkuXHJcbiAgICAgICAgICAgIGNvbnN0IG1vbWVudCA9IHRpbWVVSS50aWNrcy5sZW5ndGggPyB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSA6IG51bGw7XHJcbiAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBrZXk7XHJcbiAgICAgICAgICAgIHRpbWVVSS50aWNrcyA9IGdlbmVyYXRlVGlja3MoZXh0ZW50Lm1pbiwgZXh0ZW50Lm1heCwgcGVyaW9kKTtcclxuICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gbW9tZW50ID09PSBudWxsID8gMCA6IG5lYXJlc3RUaWNrSW5kZXgodGltZVVJLnRpY2tzLCBtb21lbnQpO1xyXG4gICAgICAgICAgICBpZiAobW9tZW50ICE9PSBudWxsICYmIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdICE9PSBtb21lbnQpIHtcclxuICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7ICAgLy8gdGhlIHNlcmllcyByZWFsaWduZWQ6IHRlbGwgUHl0aG9uIHdoZXJlIHdlIGxhbmRlZFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUaGUgc2hhcmVkIHdpbmRvdyBvdmVycmlkZSwgY29uZmlnLWRyaXZlbjsgYSBiYWQgc3RyaW5nIGNsZWFycyByYXRoZXIgdGhhblxyXG4gICAgICAgIC8vIGd1ZXNzaW5nLiBUaGUgZHJhZyBncmlkIGlzIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZFxyXG4gICAgICAgIC8vIGR1cmF0aW9uIC0tIHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBhbGwgb2YgdGhlbSAtLSBzbyBhIDIuNWggdHJhaWxcclxuICAgICAgICAvLyBpcyBkcmFnZ2FibGUgb24gYSAxaCBiYXIuIENhbGVuZGFyIHBlcmlvZHMgaGF2ZSBubyBmaXhlZCB3aWR0aDsgdGhlIHJ1bGVyXHJcbiAgICAgICAgLy8gdGhlbiBzaG93cyBpbnRlcnZhbCBtYXJrcyBvbmx5IGFuZCB0aGUgdHJhaWwgaGFuZGxlIGhpZGVzLlxyXG4gICAgICAgIC8vIE5ldmVyIHdoaWxlIGEgZHJhZyBpcyBsaXZlOiB0aGUgZHJhZ2dlZCB3aW5kb3cgZXhpc3RzIG9ubHkgbG9jYWxseSB1bnRpbFxyXG4gICAgICAgIC8vIHJlbGVhc2UgY29tbWl0cyBpdCwgYW5kIHJlYWRpbmcgY29uZmlnIGhlcmUgbWlkLWRyYWcgcmVzZXQgdGhlIGhhbmRsZSB0b1xyXG4gICAgICAgIC8vIFwibm8gd2luZG93XCIgb24gZXZlcnkgZGVib3VuY2VkIHN5bmMgLS0gdGhlIGhhbmRsZSBmb2xsb3dlZCB0aGUgbW91c2UsIHRoZW5cclxuICAgICAgICAvLyBzbmFwcGVkIGhvbWUsIHRoZW4gZm9sbG93ZWQgYWdhaW4sIG9uY2UgcGVyIHN5bmMuXHJcbiAgICAgICAgaWYgKCF0aW1lVUkuZHJhZ0FjdGl2ZSkge1xyXG4gICAgICAgICAgICB0aW1lVUkud2luZG93ID0gY2ZnLndpbmRvdyAmJiBwYXJzZVBlcmlvZChjZmcud2luZG93KSA/IGNmZy53aW5kb3cgOiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aW1lVUkucGVyaW9kTXMgPSBwZXJpb2RUb01zKHBlcmlvZCk7XHJcbiAgICAgICAgdGltZVVJLmdyaWRNcyA9IHRpbWVVSS5wZXJpb2RNc1xyXG4gICAgICAgICAgICA/IGdjZEdyaWRNcyh0aW1lVUkucGVyaW9kTXMsIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllclN0YXRlLCB0aW1lVUkud2luZG93KSlcclxuICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QsIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xyXG4gICAgICAgIHRpbWVVSS5wb3NpdGlvbiA9IGNmZy5wb3NpdGlvbiB8fCBcInRvcC1jZW50ZXJcIjtcclxuXHJcbiAgICAgICAgaWYgKCF0aW1lVUkuc3RhcnRlZCkge1xyXG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IGNmZy5zcGVlZCB8fCAxO1xyXG4gICAgICAgICAgICB0aW1lVUkubG9vcCA9IEJvb2xlYW4oY2ZnLmxvb3ApO1xyXG4gICAgICAgICAgICAvLyBPbmx5IHRoZSBmaXJzdCBjb25maWd1cmF0aW9uIG1heSBhdXRvLXN0YXJ0LiBFdmVyeSBjb25maWcgY2hhbmdlIHJlc2V0c1xyXG4gICAgICAgICAgICAvLyBgc3RhcnRlZGAgdG8gcmUtcmVhZCBzcGVlZCBhbmQgbG9vcCAtLSBpbmNsdWRpbmcgdGhlIGNoYW5nZSBhIHdpbmRvd1xyXG4gICAgICAgICAgICAvLyBkcmFnIGNvbW1pdHMgLS0gYW5kIHJlLXJ1bm5pbmcgYXV0b19wbGF5IHRoZXJlIHdvdWxkIHN0YXJ0IHBsYXliYWNrIGFzXHJcbiAgICAgICAgICAgIC8vIGEgc2lkZSBlZmZlY3Qgb2YgcmVsZWFzaW5nIHRoZSBoYW5kbGUuXHJcbiAgICAgICAgICAgIGlmIChjZmcuYXV0b19wbGF5ICYmICF0aW1lVUkuZXZlclN0YXJ0ZWQpIHN0YXJ0UGxheWJhY2soKTtcclxuICAgICAgICAgICAgdGltZVVJLmV2ZXJTdGFydGVkID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTaWRlYmFyIExheWVycyBDb250cm9sIFVJXHJcbiAgICBjb25zdCBzaWRlYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS50b3AgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLm92ZXJmbG93WSA9IFwiYXV0b1wiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5mb250RmFtaWx5ID0gXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTZWdvZSBVSScsIFJvYm90bywgc2Fucy1zZXJpZlwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5jb2xvciA9IFwiIzMzM1wiO1xyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHNpZGViYXIpO1xyXG5cclxuICAgIC8vIExlZ2VuZDogZGVyaXZlZCBmcmVzaCBvbiBldmVyeSBzeW5jIGZyb20gdGhlIHNhbWUgbGF5ZXIgc3RhdGUgdGhlIHNpZGViYXJcclxuICAgIC8vIHJlbmRlcnMgZnJvbSwgc28gdG9nZ2xlcyBkaW0gb3IgZHJvcCByb3dzIHdpdGggbm8gZXh0cmEgd2lyaW5nLiBIaWRkZW5cclxuICAgIC8vIHVudGlsIHNob3dfbGVnZW5kIGFza3MgZm9yIGl0LlxyXG4gICAgY29uc3QgbGVnZW5kRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIGxlZ2VuZERpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxlZ2VuZFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUubWF4V2lkdGggPSBcIjI2MHB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUubWF4SGVpZ2h0ID0gXCI0NSVcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5mb250RmFtaWx5ID0gc2lkZWJhci5zdHlsZS5mb250RmFtaWx5O1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobGVnZW5kRGl2KTtcclxuXHJcbiAgICAvLyBMb2dvXHJcbiAgICAvLyBUaGUgbG9nbyBjYXJkOiB0d28gYXBwLXN1cHBsaWVkIHNsb3RzIGZyb20gbG9nb19jb25maWcsIG5vIGJyYW5kaW5nIG9mXHJcbiAgICAvLyBpdHMgb3duLiBXaXRoIHRoZSBjYXJkIG9uIGFuZCBuZWl0aGVyIHNsb3Qgc2V0LCBhIGdlbmVyaWMgbWFyayBzdGFuZHMgaW5cclxuICAgIC8vIC0tIGlubGluZSBTVkcsIHNvIGl0IG5lZWRzIG5vIG5ldHdvcmsgYW5kIHN1cnZpdmVzIGEgc3RhdGljIGV4cG9ydC5cclxuICAgIC8vIEJ1aWx0IHdpdGggZWxlbWVudHMsIG5vdCBpbm5lckhUTUwsIHNvIGFuIGFsdCB0ZXh0IGNhbm5vdCBpbmplY3QgbWFya3VwLlxyXG4gICAgY29uc3QgTE9HT19QT1NJVElPTlMgPSBuZXcgU2V0KFtcInRvcC1sZWZ0XCIsIFwidG9wLXJpZ2h0XCIsIFwiYm90dG9tLWxlZnRcIiwgXCJib3R0b20tcmlnaHRcIl0pO1xyXG4gICAgY29uc3QgREVGQVVMVF9MT0dPID0gXCJkYXRhOmltYWdlL3N2Zyt4bWw7dXRmOCxcIiArIGVuY29kZVVSSUNvbXBvbmVudChcclxuICAgICAgICAnPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgdmlld0JveD1cIjAgMCAxNDAgNDBcIj4nXHJcbiAgICAgICAgKyAnPHJlY3Qgd2lkdGg9XCIxNDBcIiBoZWlnaHQ9XCI0MFwiIHJ4PVwiOFwiIGZpbGw9XCIjMWY2ZmViXCIvPidcclxuICAgICAgICArICc8dGV4dCB4PVwiNzBcIiB5PVwiMjZcIiBmb250LWZhbWlseT1cIlNlZ29lIFVJLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmXCIgJ1xyXG4gICAgICAgICsgJ2ZvbnQtc2l6ZT1cIjE4XCIgZm9udC13ZWlnaHQ9XCI2MDBcIiBmaWxsPVwiI2ZmZlwiIHRleHQtYW5jaG9yPVwibWlkZGxlXCI+c3dpZnRtYXA8L3RleHQ+J1xyXG4gICAgICAgICsgJzwvc3ZnPicpO1xyXG4gICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBsb2dvRGl2LmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtbG9nb1wiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjRweFwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxvZ29EaXYpO1xyXG5cclxuICAgIGZ1bmN0aW9uIHN5bmNMb2dvKCkge1xyXG4gICAgICAgIGNvbnN0IHNob3cgPSBCb29sZWFuKGhvc3QuZ2V0KFwic2hvd19sb2dvXCIpKTtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBzaG93ID8gXCJibG9ja1wiIDogXCJub25lXCI7XHJcbiAgICAgICAgbG9nb0Rpdi5yZXBsYWNlQ2hpbGRyZW4oKTtcclxuICAgICAgICBpZiAoIXNob3cpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcImxvZ29fY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IGhlaWdodCA9IE51bWJlcihjZmcuaGVpZ2h0KSA+IDAgPyBOdW1iZXIoY2ZnLmhlaWdodCkgOiAzNTtcclxuICAgICAgICBjb25zdCBwb3NpdGlvbiA9IExPR09fUE9TSVRJT05TLmhhcyhjZmcucG9zaXRpb24pID8gY2ZnLnBvc2l0aW9uIDogXCJib3R0b20tcmlnaHRcIjtcclxuICAgICAgICBmb3IgKGNvbnN0IHNpZGUgb2YgW1widG9wXCIsIFwiYm90dG9tXCIsIFwibGVmdFwiLCBcInJpZ2h0XCJdKSBsb2dvRGl2LnN0eWxlW3NpZGVdID0gXCJcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlW3Bvc2l0aW9uLnN0YXJ0c1dpdGgoXCJ0b3BcIikgPyBcInRvcFwiIDogXCJib3R0b21cIl0gPSBcIjEwcHhcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlW3Bvc2l0aW9uLmVuZHNXaXRoKFwibGVmdFwiKSA/IFwibGVmdFwiIDogXCJyaWdodFwiXSA9IFwiMTBweFwiO1xyXG4gICAgICAgIGNvbnN0IHNsb3RzID0gW2NmZy5jb21wYW55LCBjZmcucGFyZW50X2NvbXBhbnldLmZpbHRlcihzID0+IHMgJiYgcy51cmwpO1xyXG4gICAgICAgIGNvbnN0IGltYWdlcyA9IHNsb3RzLmxlbmd0aCA/IHNsb3RzIDogW3sgdXJsOiBERUZBVUxUX0xPR08sIGFsdDogXCJzd2lmdG1hcFwiIH1dO1xyXG4gICAgICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgcm93LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICByb3cuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgcm93LnN0eWxlLmdhcCA9IFwiNXB4XCI7XHJcbiAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBpbWFnZXMpIHtcclxuICAgICAgICAgICAgY29uc3QgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImltZ1wiKTtcclxuICAgICAgICAgICAgaW1nLnNyYyA9IGltYWdlLnVybDtcclxuICAgICAgICAgICAgaW1nLmFsdCA9IGltYWdlLmFsdCB8fCBcIlwiO1xyXG4gICAgICAgICAgICBpbWcuc3R5bGUuaGVpZ2h0ID0gYCR7aGVpZ2h0fXB4YDtcclxuICAgICAgICAgICAgcm93LmFwcGVuZENoaWxkKGltZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ29EaXYuYXBwZW5kQ2hpbGQocm93KTtcclxuICAgIH1cclxuICAgIHN5bmNMb2dvKCk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6bG9nb19jb25maWdcIiwgc3luY0xvZ28pO1xyXG5cclxuXHJcblxyXG4gICAgZnVuY3Rpb24gZ2V0VGlsZUxheWVyKGxheWVyKSB7XHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxyXG4gICAgICAgICAgICBtYXhab29tOiBsYXllci5tYXhfem9vbSB8fCAyMixcclxuICAgICAgICAgICAgbWF4TmF0aXZlWm9vbTogbGF5ZXIubWF4X25hdGl2ZV96b29tIHx8IDE5XHJcbiAgICAgICAgfTtcclxuICAgICAgICAvLyB4eXpzZXJ2aWNlcyBwcm92aWRlcnMgZGVjbGFyZSB0aGVpciBvd24ge3N9IGhvc3RzOyBMZWFmbGV0J3NcclxuICAgICAgICAvLyBkZWZhdWx0IFwiYWJjXCIgaXMgd3JvbmcgZm9yIGFueXRoaW5nIGVsc2UuXHJcbiAgICAgICAgaWYgKGxheWVyLnN1YmRvbWFpbnMpIG9wdGlvbnMuc3ViZG9tYWlucyA9IGxheWVyLnN1YmRvbWFpbnM7XHJcbiAgICAgICAgaWYgKGxheWVyLndtcykge1xyXG4gICAgICAgICAgICAvLyBXTVMgcmVxdWVzdCBDUlMgZm9sbG93cyB0aGUgbWFwJ3MsIHNvIDQzMjYgbWFwcyBhc2sgaW4gNDMyNi5cclxuICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyLndtcyhsYXllci51cmwsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBsYXllcnM6IGxheWVyLndtcy5sYXllcnMsXHJcbiAgICAgICAgICAgICAgICBmb3JtYXQ6IGxheWVyLndtcy5mb3JtYXQgfHwgJ2ltYWdlL3BuZycsXHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiBsYXllci53bXMudmVyc2lvbiB8fCAnMS4xLjEnLFxyXG4gICAgICAgICAgICAgICAgdHJhbnNwYXJlbnQ6ICEhbGF5ZXIud21zLnRyYW5zcGFyZW50LFxyXG4gICAgICAgICAgICAgICAgLi4uKGxheWVyLndtcy5zdHlsZXMgPyB7IHN0eWxlczogbGF5ZXIud21zLnN0eWxlcyB9IDoge30pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCBvcHRpb25zKTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBmdW5jdGlvbiBzeW5jTWFwU3RhdGUoKSB7XHJcbiAgICAgICAgY29uc29sZS50aW1lKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XHJcbiAgICAgICAgdXBkYXRlVGltZURpbWVuc2lvbigpO1xyXG4gICAgICAgIGNvbnN0IGxheWVycyA9IGxheWVyU3RhdGU7XHJcbiAgICAgICAgY29uc3QgZ3JvdXBDb25maWdzID0gaG9zdC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gYnVmZmVyU3RhdGU7XHJcblxyXG4gICAgICAgIC8vIEVuZm9yY2UgbXV0dWFsbHkgZXhjbHVzaXZlIHJhZGlvIGdyb3VwIHZpc2liaWxpdHkgYmVmb3JlIGNvbGxlY3Rpbmcgb3IgcmVuZGVyaW5nIFdlYkdMIGxheWVycy5cclxuICAgICAgICAvLyBXcml0dGVuIGJhY2sgYXMgdGFyZ2V0ZWQgZmxpcHMsIG5ldmVyIHRoZSBsYXllcnMgdHJhaXQgLS0gdGhlIGZ1bGwgd3JpdGUgd2FzXHJcbiAgICAgICAgLy8gdGhlIGZyYW1lIHRoYXQga2lsbGVkIGxhcmdlIHNlc3Npb25zIChzZWUgdGhlIHNpZGViYXIncyBjaGFuZ2UgaGFuZGxlcikuXHJcbiAgICAgICAgY29uc3QgcmFkaW8gPSBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncywgc2lkZWJhckNvbGxhcHNlU3RhdGUoc2lkZWJhcikpO1xyXG4gICAgICAgIGlmICgocmFkaW8uY2hhbmdlcy5sZW5ndGggPiAwIHx8IHJhZGlvLmdyb3Vwc0NoYW5nZWQpICYmIGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XHJcbiAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKGhvc3QsIHJhZGlvLmNoYW5nZXMpO1xyXG4gICAgICAgICAgICBob3N0LnNldChcImdyb3VwX2NvbmZpZ3NcIiwgeyAuLi5ncm91cENvbmZpZ3MgfSk7XHJcbiAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBzeW5jTG9nbygpO1xyXG5cclxuICAgICAgICAvLyBHcm91cCB2aXNpYmxlIGxheWVycyAoaW5jbHVkaW5nIHN1Yi1sYXllcnMgaW5zaWRlIGdyb3VwcykgdG8gYWx3YXlzIHVzZSBXZWJHTFxyXG4gICAgICAgIGNvbnN0IHtcclxuICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcclxuICAgICAgICAgICAgcG9seWxpbmU6IHdlYmdsUG9seWxpbmVMYXllcnMsXHJcbiAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyxcclxuICAgICAgICB9ID0gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcclxuXHJcbiAgICAgICAgLy8gU2V0IG9mIGxheWVyIElEcyBwcm9jZXNzZWQgdmlhIG1lcmdlZCBXZWJHTCBsYXllcnNcclxuICAgICAgICBjb25zdCB3ZWJnbExheWVySWRzID0gbmV3IFNldChbXHJcbiAgICAgICAgICAgIC4uLndlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxyXG4gICAgICAgICAgICAuLi53ZWJnbE1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcclxuICAgICAgICAgICAgLi4ud2ViZ2xQb2x5bGluZUxheWVycy5tYXAobCA9PiBsLmlkKSxcclxuICAgICAgICAgICAgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzLm1hcChsID0+IGwuaWQpXHJcbiAgICAgICAgXSk7XHJcblxyXG4gICAgICAgIC8vIFJlbW92ZSByZXRpcmVkIG92ZXJsYXkgbGF5ZXJzLCBpbmNsdWRpbmcgdGhvc2UgdGhhdCB0cmFuc2l0aW9uZWQgdG8gV2ViR0xcclxuICAgICAgICBPYmplY3Qua2V5cyhhY3RpdmVPdmVybGF5TGF5ZXJzKS5mb3JFYWNoKGlkID0+IHtcclxuICAgICAgICAgICAgaWYgKCFsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKSB8fCB3ZWJnbExheWVySWRzLmhhcyhpZCkpIHtcclxuICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIFByb2Nlc3Mgbm9uLVdlYkdMIGxheWVyc1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVmZmVjdGl2ZVZpc2libGUgPSBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcclxuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoZWZmZWN0aXZlVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0aWxlID0gZ2V0VGlsZUxheWVyKGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGlsZS5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdID0gdGlsZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0ucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBTa2lwIGxheWVycyBtYW5hZ2VkIGJ5IHRoZSBtZXJnZWQgV2ViR0wgbGF5ZXJzXHJcbiAgICAgICAgICAgIGlmICh3ZWJnbExheWVySWRzLmhhcyhsYXllci5pZCkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoIWVmZmVjdGl2ZVZpc2libGUgfHwgIWxheWVySW5XaW5kb3cobGF5ZXIsIGJ1ZmZlclN0YXRlLCB0aW1lU3RhdGUpKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICAgICAgLy8gSW1hZ2Ugb3ZlcmxheXMgcmVjcmVhdGUgd2hlbiB0aGVpciBjb25maWcgb3IgdGhlaXIgYnVmZmVyXHJcbiAgICAgICAgICAgICAgICAvLyBjaGFuZ2VzIC0tIGEgcmVwbGFjZSBvcCBzd2FwcyB0aGUgY29uZmlnIG9iamVjdCBhbmQgYVxyXG4gICAgICAgICAgICAgICAgLy8gYnVmZmVyIG9wIHN3YXBzIHRoZSBEYXRhVmlldywgYW5kIGEgc3RhbGUgaW1hZ2Ugd291bGRcclxuICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSBzaXQgdW50aWwgYSB2aXNpYmlsaXR5IGJvdW5jZS5cclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YWxlSW1hZ2UgPSBsYXllci50eXBlID09PSBcImltYWdlXCJcclxuICAgICAgICAgICAgICAgICAgICAmJiAoZXhpc3RpbmcuaW1hZ2VNZXRhICE9PSBpbWFnZU1ldGFLZXkobGF5ZXIpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHx8IGV4aXN0aW5nLmltYWdlU291cmNlICE9PSAoY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdIHx8IG51bGwpKTtcclxuICAgICAgICAgICAgICAgIGlmIChleGlzdGluZy5sYXllclR5cGUgIT09IGxheWVyLnR5cGUgfHwgc3RhbGVJbWFnZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0gPSBpbnN0YW5jZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSGVscGVyIHRvIHN5bmMgV2ViR0wgbGF5ZXIgc3RhdGVzIGFuZCByZWJ1aWxkIG9ubHkgaWYgY2hhbmdlZFxyXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMsIHZlY3RvckdwdSA9IGZhbHNlKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkc1N0cmluZyA9IHZpc2libGVMYXllcnMubWFwKGwgPT4gbC5pZCkuc29ydCgpLmpvaW4oXCIsXCIpO1xyXG4gICAgICAgICAgICAvLyBFdmVyeXRoaW5nIHRoZSBidWlsdCBidWZmZXJzIGRlcGVuZCBvbiBiZWxvbmdzIGluIHRoaXMga2V5OiBhIGNoYW5nZSB0aGF0XHJcbiAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXHJcbiAgICAgICAgICAgIC8vIG1pc3NpbmcgYXQgZmlyc3QsIHNvIGEgaGlnaGxpZ2h0IGxhbmRlZCBpbiBzdGF0ZSBhbmQgbmV2ZXIgcmVwYWludGVkLlxyXG4gICAgICAgICAgICAvLyBQb2ludCBidWNrZXRzIG9uIHRoZSBHUFUgcGF0aCBleGNsdWRlIHRoZSB0aWNrIGFuZCB3aW5kb3cgZnJvbSB0aGUga2V5OlxyXG4gICAgICAgICAgICAvLyB0aG9zZSBjaGFuZ2UgcGVyIHRpY2sgYW5kIGFyZSBhcHBsaWVkIGFzIHVuaWZvcm1zLCBub3QgYnkgcmVidWlsZGluZy5cclxuICAgICAgICAgICAgLy8gVGhlIHBlcmlvZCBzdGF5cyBpbiwgc2luY2UgaXQgaXMgYmFrZWQgaW50byB0aGUgZHVyYXRpb24gYXR0cmlidXRlcy5cclxuICAgICAgICAgICAgLy8gRXZlcnl0aGluZyBlbHNlIC0tIGFuZCBldmVyeSBub24tcG9pbnQgYnVja2V0IC0tIHJlYnVpbGRzIGFzIGJlZm9yZS5cclxuICAgICAgICAgICAgY29uc3QgZ3B1UG9pbnRzID0gKCh0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCIpXHJcbiAgICAgICAgICAgICAgICAmJiBncHVUaW1lQXZhaWxhYmxlKCkpIHx8IHZlY3RvckdwdTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHZpc2libGVMYXllcnMubWFwKGwgPT4gKHtcclxuICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IGwuY29sb3IsXHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IGwucmFkaXVzLFxyXG4gICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcclxuICAgICAgICAgICAgICAgIG9wYWNpdHk6IGwub3BhY2l0eSxcclxuICAgICAgICAgICAgICAgIGZpbGxPcGFjaXR5OiBsLmZpbGxPcGFjaXR5LFxyXG4gICAgICAgICAgICAgICAgaGlnaGxpZ2h0OiBsLmhpZ2hsaWdodF9zdHlsZSxcclxuICAgICAgICAgICAgICAgIG92ZXJyaWRlczogbC5zdHlsZV9vdmVycmlkZXMsXHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlU3R5bGVzOiBsLmZlYXR1cmVfc3R5bGVzLFxyXG4gICAgICAgICAgICAgICAgdGltZTogbC50aW1lLFxyXG4gICAgICAgICAgICAgICAgZ3B1OiBncHVQb2ludHMsXHJcbiAgICAgICAgICAgICAgICB0aWNrOiBsLnRpbWUgJiYgdGltZVN0YXRlICYmICFncHVQb2ludHMgPyB0aW1lU3RhdGUudGljayA6IDAsXHJcbiAgICAgICAgICAgICAgICB3aW46IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgcGVyOiBsLnRpbWUgJiYgZ3B1UG9pbnRzICYmIHRpbWVTdGF0ZVxyXG4gICAgICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodGltZVN0YXRlLnBlcmlvZCkgOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgLy8gSWRlbnRpdHkgb2YgZXZlcnkgYnVmZmVyIHRoZSBidWNrZXQgcmVhZHMgZm9yIHRoaXMgbGF5ZXI6XHJcbiAgICAgICAgICAgICAgICAvLyBzYW1lLWxlbmd0aCByZXBsYWNlbWVudHMgbXVzdCByZWJ1aWxkIHRvby5cclxuICAgICAgICAgICAgICAgIGJ1ZlNlcmlhbDogW2wuaWQsIGAke2wuaWR9Ojpjb2xvcnNgLCBgJHtsLmlkfTo6cmFkaWlgLCBgJHtsLmlkfTo6dGltZXNgXVxyXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoayA9PiBidWZmZXJTZXJpYWwoY29vcmRpbmF0ZUJ1ZmZlcnNba10pKSxcclxuICAgICAgICAgICAgICAgIGxvY0xlbjogbC5sb2NhdGlvbnM/Lmxlbmd0aCB8fCAwXHJcbiAgICAgICAgICAgIH0pKSk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZUNoYW5nZWQgPSBzdGF0ZS5pZHMgIT09IGlkc1N0cmluZyB8fCBzdGF0ZS5tZXRhICE9PSBtZXRhU3RyaW5nO1xyXG5cclxuICAgICAgICAgICAgaWYgKHN0YXRlQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAodmlzaWJsZUxheWVycy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBhd2FpdCByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgdmlzaWJsZUxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIGxheWVyRXZlbnRzLCB0aW1lU3RhdGUsIHZlY3RvckdwdSwgZmVhdHVyZVZpc2libGVOb3cpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgc3RhdGUuaWRzID0gaWRzU3RyaW5nO1xyXG4gICAgICAgICAgICAgICAgc3RhdGUubWV0YSA9IG1ldGFTdHJpbmc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgaG9sZGluZyB0aW1lIGxheWVycyBrZWVwIEVWRVJZIHBvaW50IGxheWVyIC0tIGhpZGRlbiBvbmVzXHJcbiAgICAgICAgLy8gaW5jbHVkZWQgLS0gc28gYSBzaWRlYmFyIHRvZ2dsZSBjaGFuZ2VzIGEgdmlzaWJpbGl0eSB1bmlmb3JtIGluc3RlYWQgb2ZcclxuICAgICAgICAvLyB0aGUgYnVja2V0J3MgaWRzLiBVbmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZWJ1aWxkIGFsbCA1TVxyXG4gICAgICAgIC8vIHBvaW50czsgY2xpY2tpbmcgZG93biB0aGUgc2lkZWJhciBzdGFja2VkIHRob3NlIHJlYnVpbGRzIGludG8gYSBjcmFzaC5cclxuICAgICAgICBjb25zdCBhbGxCeVR5cGUgPSBjb2xsZWN0UG9pbnRMYXllcnNBbGwobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgIC8vIEFyZWEgb3V0bGluZXMgcmlkZSB0aGUgbGluZXMgYnVja2V0OiBldmVyeSBwb2x5Z29uIGFuZCBjaXJjbGUgam9pbnMgaXQgYXNcclxuICAgICAgICAvLyBhbiBleHRyYSBlbnRyeSB3aG9zZSByaW5ncyByZW5kZXIgYXMgd2VpZ2h0ZWQgTGluZVN0cmluZ3MgKHRoZSBwb2x5Z29uXHJcbiAgICAgICAgLy8gYnVja2V0IGRyYXdzIG9ubHkgdGhlIGZpbGwpLiBKb2luaW5nIHVuY29uZGl0aW9uYWxseSAtLSBzdHJva2VsZXNzIGFyZWFzXHJcbiAgICAgICAgLy8gY29udHJpYnV0ZSBhbiBlbXB0eSBzbG90IC0tIGtlZXBzIHRoZSBidWNrZXQncyBtZW1iZXJzaGlwIGluZGVwZW5kZW50IG9mXHJcbiAgICAgICAgLy8gc3R5bGUgY2hhbmdlcywgc28gcmVzdHlsaW5nIGEgYm9yZGVyIHN0YXlzIGEgcmVidWlsZCwgbmV2ZXIgYSByZS1idWNrZXQuXHJcbiAgICAgICAgYWxsQnlUeXBlLnBvbHlsaW5lID0gWy4uLmFsbEJ5VHlwZS5wb2x5bGluZSwgLi4uYWxsQnlUeXBlLnBvbHlnb25dO1xyXG4gICAgICAgIGNvbnN0IGJ1Y2tldCA9IHsgY2lyY2xlX21hcmtlcnM6IHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBwb2x5bGluZTogWy4uLndlYmdsUG9seWxpbmVMYXllcnMsIC4uLndlYmdsUG9seWdvbkxheWVyc10sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMgfTtcclxuICAgICAgICBjb25zdCB2ZWN0b3JHcHVCdWNrZXQgPSB7IHBvbHlsaW5lOiBmYWxzZSwgcG9seWdvbjogZmFsc2UgfTtcclxuICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2YgW1wiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCJdKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVudHJpZXMgPSBhbGxCeVR5cGVbdHlwZV07XHJcbiAgICAgICAgICAgIGNvbnN0IGlzUG9pbnRzID0gdHlwZSA9PT0gXCJjaXJjbGVfbWFya2Vyc1wiIHx8IHR5cGUgPT09IFwibWFya2Vyc1wiO1xyXG4gICAgICAgICAgICBjb25zdCBhdmFpbGFibGUgPSBpc1BvaW50cyA/IGdwdVRpbWVBdmFpbGFibGUoKSA6IHZlY3RvckdwdUF2YWlsYWJsZSgpO1xyXG4gICAgICAgICAgICBjb25zdCBncHVWaXMgPSBhdmFpbGFibGUgJiYgZW50cmllcy5sZW5ndGggPiAwXHJcbiAgICAgICAgICAgICAgICAmJiBlbnRyaWVzLmxlbmd0aCA8PSBMQVlFUl9TTE9UU1xyXG4gICAgICAgICAgICAgICAgJiYgZW50cmllcy5zb21lKGUgPT4gZS5sYXllci50aW1lKTtcclxuICAgICAgICAgICAgZ2xTdGF0ZXNbdHlwZV0udmlzVmVjdG9yID0gZ3B1VmlzID8gZW50cmllcy5tYXAoZSA9PiAoZS52aXMgPyAxIDogMCkpIDogbnVsbDtcclxuICAgICAgICAgICAgaWYgKGdwdVZpcykgYnVja2V0W3R5cGVdID0gZW50cmllcy5tYXAoZSA9PiBlLmxheWVyKTtcclxuICAgICAgICAgICAgaWYgKCFpc1BvaW50cykgdmVjdG9yR3B1QnVja2V0W3R5cGVdID0gZ3B1VmlzO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJjaXJjbGVfbWFya2Vyc1wiLCBidWNrZXQuY2lyY2xlX21hcmtlcnMpO1xyXG4gICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwibWFya2Vyc1wiLCBidWNrZXQubWFya2Vycyk7XHJcbiAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCBidWNrZXQucG9seWxpbmUsIHZlY3RvckdwdUJ1Y2tldC5wb2x5bGluZSk7XHJcbiAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5Z29uXCIsIGJ1Y2tldC5wb2x5Z29uLCB2ZWN0b3JHcHVCdWNrZXQucG9seWdvbik7XHJcblxyXG4gICAgICAgIC8vIFB1c2ggdGhlIGN1cnJlbnQgd2luZG93IGludG8gdGhlIEdQVS1maWx0ZXJlZCBwb2ludCBidWNrZXRzOiB0d28gdW5pZm9ybXNcclxuICAgICAgICAvLyBhbmQgYSByZWRyYXcsIHdoaWNoIGlzIHRoZSBlbnRpcmUgcGVyLXRpY2sgY29zdCBvZiB0aGUgdGltZSBzbGlkZXIgdGhlcmUuXHJcbiAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xyXG4gICAgICAgICAgICBjb25zdCBoYW5kbGUgPSBzdGF0ZS5sYXllciAmJiBzdGF0ZS5sYXllci5fc3dpZnRtYXBUaW1lO1xyXG4gICAgICAgICAgICBpZiAoIWhhbmRsZSkgY29udGludWU7XHJcbiAgICAgICAgICAgIC8vIExheWVyIHZpc2liaWxpdHkgZmlyc3QsIGFuZCBvbmx5IHdoZW4gaXQgY2hhbmdlZDogYSB0b2dnbGUgY29zdHMgb25lXHJcbiAgICAgICAgICAgIC8vIHVuaWZvcm0gYXJyYXkgd3JpdGUgYW5kIGEgcmVkcmF3LCBuZXZlciBhIHJlYnVpbGQuXHJcbiAgICAgICAgICAgIGNvbnN0IHZpcyA9IHN0YXRlLnZpc1ZlY3RvcjtcclxuICAgICAgICAgICAgaWYgKHZpcykge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gdmlzLmpvaW4oXCJcIik7XHJcbiAgICAgICAgICAgICAgICBpZiAoc3RhdGUudmlzS2V5ICE9PSBrZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS52aXNLZXkgPSBrZXk7XHJcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldExheWVyVmlzaWJpbGl0eSh2aXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG92ZXJyaWRlTXMgPSB0aW1lU3RhdGUud2luZG93XHJcbiAgICAgICAgICAgICAgICAgICAgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHRpbWVTdGF0ZS53aW5kb3cpKSA6IG51bGw7XHJcbiAgICAgICAgICAgICAgICBoYW5kbGUuc2V0V2luZG93KHRpbWVTdGF0ZS50aWNrLCBvdmVycmlkZU1zKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3cobnVsbCwgbnVsbCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIHtcclxuICAgICAgICAgICAgZ3JvdXBDb25maWdzLFxyXG4gICAgICAgICAgICBjb29yZGluYXRlQnVmZmVycyxcclxuICAgICAgICAgICAgb25MYXllcldyaXRlOiAoY2hhbmdlcykgPT4gc2VuZExheWVyV3JpdGUoaG9zdCwgY2hhbmdlcyksXHJcbiAgICAgICAgICAgIC8vIGdyb3VwX2NvbmZpZ3Mgc3RheXMgb24gdGhlIGhvc3Q6IGEgaGFuZGZ1bCBvZiBmb2xkZXIgZmxhZ3MsIGFuZCB0aGVcclxuICAgICAgICAgICAgLy8gc3ByZWFkIGdpdmVzIEJhY2tib25lIGEgZnJlc2ggcmVmZXJlbmNlIHNvIGluLXBsYWNlIGVkaXRzIHJlZ2lzdGVyLlxyXG4gICAgICAgICAgICBvbkdyb3VwQ29uZmlnc0NoYW5nZTogKGNmZykgPT4ge1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJncm91cF9jb25maWdzXCIsIHsgLi4uY2ZnIH0pO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9LCBtYXAsICgpID0+IHtcclxuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gUGVybWFuZW50IGxhYmVscyBmb2xsb3cgdGhlIHNhbWUgZGVyaXZlLXBlci1zeW5jIHBhdHRlcm4gYXMgdGhlIGxlZ2VuZCxcclxuICAgICAgICAvLyBzbyB0aGV5IHRyYWNrIHZpc2liaWxpdHkgd2l0aCBubyBidWNrZXQgb3IgbWV0YS1rZXkgaW52b2x2ZW1lbnQgLS0gYW5kXHJcbiAgICAgICAgLy8gc2luY2UgZXZlcnkgcGxheWJhY2sgdGljayByZS1lbnRlcnMgdGhpcyBzeW5jLCBwYXNzaW5nIHRpbWVTdGF0ZSBtYWtlc1xyXG4gICAgICAgIC8vIHRoZW0gZm9sbG93IHRoZSB3aW5kb3cgdG9vOiBjaGlwcyBhcHBlYXIgYW5kIHZhbmlzaCB3aXRoIHRoZWlyIGZlYXR1cmVzLlxyXG4gICAgICAgIGlmIChsYWJlbHNHcm91cCkge1xyXG4gICAgICAgICAgICByZW5kZXJMYWJlbHMoTCwgbGFiZWxzR3JvdXAsIGxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIGdyb3VwQ29uZmlncyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBsZWdlbmRDZmcgPSBob3N0LmdldChcImxlZ2VuZF9jb25maWdcIikgfHwge307XHJcbiAgICAgICAgaWYgKGhvc3QuZ2V0KFwic2hvd19sZWdlbmRcIikpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BlYyA9IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGxlZ2VuZENmZyk7XHJcbiAgICAgICAgICAgIHJlbmRlckxlZ2VuZChsZWdlbmREaXYsIHNwZWMsXHJcbiAgICAgICAgICAgICAgICB7IGRpbUhpZGRlbjogbGVnZW5kQ2ZnLmRpbV9oaWRkZW4gIT09IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBwb3MgPSBQT1NJVElPTlNbbGVnZW5kQ2ZnLnBvc2l0aW9uXSB8fCBQT1NJVElPTlNbXCJib3R0b20tbGVmdFwiXTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBvcykpIHtcclxuICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZVtwcm9wXSA9IHZhbHVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gc3BlYy5ncm91cHMubGVuZ3RoID4gMCA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUudGltZUVuZChcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xyXG4gICAgbGV0IGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xyXG5cclxuICAgIC8vIERyYXcgLyBBT0kgdG9vbHM6IExlYWZsZXQtR2VvbWFuICh0aGUgbWFpbnRhaW5lZCBzdWNjZXNzb3IgdG8gTGVhZmxldC5kcmF3LFxyXG4gICAgLy8gd2hpY2ggYnJlYWtzIG9uIExlYWZsZXQgMS45KSwgbG9hZGVkIGZyb20gdW5wa2cgbGlrZSBMZWFmbGV0IGFuZCBnbGlmeSAtLVxyXG4gICAgLy8gbGF6aWx5LCBvbmx5IHdoZW4gYSBtYXAgdHVybnMgZHJhd2luZyBvbiwgc28gZXZlcnkgb3RoZXIgbWFwIHBheXMgbm90aGluZy5cclxuICAgIC8vIERyYXduIHNoYXBlcyBsaXZlIGluIHRoZWlyIG93biBmZWF0dXJlIGdyb3VwIGFuZCBzeW5jIHRvIFB5dGhvbiBhcyBHZW9KU09OXHJcbiAgICAvLyBmZWF0dXJlcyB1bmRlciB0aGUgYGRyYXdpbmdzYCB0cmFpdCwgd2l0aCBgZHJhd19zZXFgIGJ1bXBpbmcgcGVyIGNoYW5nZSBzb1xyXG4gICAgLy8gb25lIG9ic2VydmVyIGNhdGNoZXMgY3JlYXRlLCBlZGl0IGFuZCBkZWxldGUgYWxpa2UuIFRoZSB0cmFpdCBzeW5jcyBib3RoXHJcbiAgICAvLyB3YXlzOiBQeXRob24gY2FuIHNlZWQgQU9JcyBvciBjbGVhciB0aGVtLCBhbmQgZXhwb3J0cyBjYXJyeSB0aGUgZHJhd2luZ3MuXHJcbiAgICBsZXQgZHJhd1JlYWR5ID0gZmFsc2U7XHJcbiAgICBsZXQgZHJhd2luZ3NHcm91cCA9IG51bGw7XHJcbiAgICBsZXQgZHJhd0lkQ291bnRlciA9IDA7XHJcbiAgICBsZXQgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSBmYWxzZTtcclxuXHJcbiAgICBmdW5jdGlvbiBkcmF3aW5nVG9GZWF0dXJlKGwpIHtcclxuICAgICAgICBjb25zdCBnaiA9IGwudG9HZW9KU09OKCk7XHJcbiAgICAgICAgZ2oucHJvcGVydGllcyA9IHsgLi4uKGdqLnByb3BlcnRpZXMgfHwge30pLCBkcmF3X2lkOiBsLl9zd2lmdG1hcERyYXdJZCB9O1xyXG4gICAgICAgIGlmICh0eXBlb2YgbC5nZXRSYWRpdXMgPT09IFwiZnVuY3Rpb25cIiAmJiBsIGluc3RhbmNlb2YgTC5DaXJjbGUpIHtcclxuICAgICAgICAgICAgZ2oucHJvcGVydGllcy5raW5kID0gXCJjaXJjbGVcIjtcclxuICAgICAgICAgICAgZ2oucHJvcGVydGllcy5yYWRpdXMgPSBsLmdldFJhZGl1cygpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gZ2o7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gd3JpdGVEcmF3aW5ncygpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGRyYXdpbmdzR3JvdXAuZWFjaExheWVyKGwgPT4gZmVhdHVyZXMucHVzaChkcmF3aW5nVG9GZWF0dXJlKGwpKSk7XHJcbiAgICAgICAgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSB0cnVlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0KFwiZHJhd2luZ3NcIiwgZmVhdHVyZXMpO1xyXG4gICAgICAgICAgICBob3N0LnNldChcImRyYXdfc2VxXCIsIChob3N0LmdldChcImRyYXdfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGRyYXdpbmdzIHN0aWxsIGxpdmUgb24gdGhlIG1hcCAqLyB9XHJcbiAgICAgICAgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSBmYWxzZTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBhZG9wdERyYXdpbmcobGF5ZXIpIHtcclxuICAgICAgICBpZiAoIWxheWVyLl9zd2lmdG1hcERyYXdJZCkge1xyXG4gICAgICAgICAgICBsYXllci5fc3dpZnRtYXBEcmF3SWQgPSBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xyXG4gICAgICAgIH1cclxuICAgICAgICBkcmF3aW5nc0dyb3VwLmFkZExheWVyKGxheWVyKTtcclxuICAgICAgICBsYXllci5vbihcInBtOnVwZGF0ZSBwbTpkcmFnZW5kIHBtOnJvdGF0ZWVuZFwiLCB3cml0ZURyYXdpbmdzKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiByZWh5ZHJhdGVEcmF3aW5ncygpIHtcclxuICAgICAgICBkcmF3aW5nc0dyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICAgICAgZm9yIChjb25zdCBmZWF0dXJlIG9mIGhvc3QuZ2V0KFwiZHJhd2luZ3NcIikgfHwgW10pIHtcclxuICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBmZWF0dXJlLnByb3BlcnRpZXMgfHwge307XHJcbiAgICAgICAgICAgIGxldCBsYXllcjtcclxuICAgICAgICAgICAgaWYgKHByb3BzLmtpbmQgPT09IFwiY2lyY2xlXCIgJiYgZmVhdHVyZS5nZW9tZXRyeS50eXBlID09PSBcIlBvaW50XCIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtsbmcsIGxhdF0gPSBmZWF0dXJlLmdlb21ldHJ5LmNvb3JkaW5hdGVzO1xyXG4gICAgICAgICAgICAgICAgbGF5ZXIgPSBMLmNpcmNsZShbbGF0LCBsbmddLCB7IHJhZGl1czogcHJvcHMucmFkaXVzIHx8IDEwMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInN3aWZ0bWFwRHJhd1BhbmVcIiB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGxheWVyID0gTC5nZW9KU09OKGZlYXR1cmUsIHsgcGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIgfSlcclxuICAgICAgICAgICAgICAgICAgICAuZ2V0TGF5ZXJzKClbMF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKCFsYXllcikgY29udGludWU7XHJcbiAgICAgICAgICAgIGxheWVyLl9zd2lmdG1hcERyYXdJZCA9IHByb3BzLmRyYXdfaWQgfHwgYGRyYXdfJHsrK2RyYXdJZENvdW50ZXJ9YDtcclxuICAgICAgICAgICAgYWRvcHREcmF3aW5nKGxheWVyKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gc3luY0RyYXcoKSB7XHJcbiAgICAgICAgY29uc3Qgc2hvdyA9IGhvc3QuZ2V0KFwic2hvd19kcmF3XCIpO1xyXG4gICAgICAgIGNvbnN0IGNmZyA9IGhvc3QuZ2V0KFwiZHJhd19jb25maWdcIikgfHwge307XHJcbiAgICAgICAgaWYgKHNob3cgJiYgIWRyYXdSZWFkeSkge1xyXG4gICAgICAgICAgICBkcmF3UmVhZHkgPSB0cnVlO1xyXG4gICAgICAgICAgICAvLyBFdmVyeXRoaW5nIEdlb21hbiBjcmVhdGVzIGdvZXMgdG8gdGhlIHBhbmUgYWJvdmUgdGhlIEdMIHN0YWNrLlxyXG4gICAgICAgICAgICBtYXAucG0uc2V0R2xvYmFsT3B0aW9ucyh7XHJcbiAgICAgICAgICAgICAgICBwYW5lczogeyBsYXllclBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdmVydGV4UGFuZTogXCJtYXJrZXJQYW5lXCIsIG1hcmtlclBhbmU6IFwibWFya2VyUGFuZVwiIH0sXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBkcmF3aW5nc0dyb3VwID0gTC5mZWF0dXJlR3JvdXAoKS5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICByZWh5ZHJhdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICBtYXAub24oXCJwbTpjcmVhdGVcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGFkb3B0RHJhd2luZyhlLmxheWVyKTtcclxuICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG1hcC5vbihcInBtOnJlbW92ZVwiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gR2VvbWFuIHJlbW92ZXMgdGhlIGxheWVyIGZyb20gdGhlIE1BUDsgdGhlIGZlYXR1cmUgZ3JvdXAgc3RpbGxcclxuICAgICAgICAgICAgICAgIC8vIGhvbGRzIGl0LCBhbmQgd3JpdGVEcmF3aW5ncyByZWFkcyB0aGUgZ3JvdXAgLS0gZXZpY3QgaXQgZmlyc3RcclxuICAgICAgICAgICAgICAgIC8vIG9yIHRoZSBkZWxldGlvbiBuZXZlciByZWFjaGVzIHRoZSB0cmFpdC5cclxuICAgICAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAucmVtb3ZlTGF5ZXIoZS5sYXllcik7XHJcbiAgICAgICAgICAgICAgICB3cml0ZURyYXdpbmdzKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBsaXN0ZW4oXCJjaGFuZ2U6ZHJhd2luZ3NcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzdXBwcmVzc0RyYXdpbmdzRWNobykgcmVoeWRyYXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghZHJhd1JlYWR5KSByZXR1cm47XHJcbiAgICAgICAgaWYgKHNob3cpIHtcclxuICAgICAgICAgICAgY29uc3QgdG9vbHMgPSBjZmcudG9vbHNcclxuICAgICAgICAgICAgICAgIHx8IFtcIm1hcmtlclwiLCBcInBvbHlsaW5lXCIsIFwicmVjdGFuZ2xlXCIsIFwicG9seWdvblwiLCBcImNpcmNsZVwiXTtcclxuICAgICAgICAgICAgbWFwLnBtLmFkZENvbnRyb2xzKHtcclxuICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAoY2ZnLnBvc2l0aW9uIHx8IFwidG9wLWxlZnRcIikucmVwbGFjZShcIi1cIiwgXCJcIiksXHJcbiAgICAgICAgICAgICAgICBkcmF3TWFya2VyOiB0b29scy5pbmNsdWRlcyhcIm1hcmtlclwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdQb2x5bGluZTogdG9vbHMuaW5jbHVkZXMoXCJwb2x5bGluZVwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdSZWN0YW5nbGU6IHRvb2xzLmluY2x1ZGVzKFwicmVjdGFuZ2xlXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd1BvbHlnb246IHRvb2xzLmluY2x1ZGVzKFwicG9seWdvblwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdDaXJjbGU6IHRvb2xzLmluY2x1ZGVzKFwiY2lyY2xlXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd0NpcmNsZU1hcmtlcjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBkcmF3VGV4dDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICByb3RhdGVNb2RlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGN1dFBvbHlnb246IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgZWRpdE1vZGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBkcmFnTW9kZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHJlbW92YWxNb2RlOiB0cnVlLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBtYXAucG0ucmVtb3ZlQ29udHJvbHMoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBzeW5jRHJhdygpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnNob3dfZHJhd1wiLCBzeW5jRHJhdyk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6ZHJhd19jb25maWdcIiwgc3luY0RyYXcpO1xyXG5cclxuICAgIC8vIFRoZSBzY2FsZSBiYXI6IExlYWZsZXQncyBvd24gY29udHJvbCwgd2hpY2ggbWVhc3VyZXMgdGhyb3VnaCB0aGUgbWFwJ3MgQ1JTXHJcbiAgICAvLyAoaGF2ZXJzaW5lIHVuZGVyIDM4NTcgYW5kIDQzMjYgYWxpa2UgLS0gbm8gcGl4ZWwgbWF0aCBvZiBvdXJzKSwgZXh0ZW5kZWRcclxuICAgIC8vIHdpdGggdGhlIHVuaXQgTGVhZmxldCBsYWNrcyBhbmQgdGhpcyBkb21haW4gcnVucyBvbjogbmF1dGljYWwgbWlsZXMuXHJcbiAgICBjb25zdCBOYXV0aWNhbFNjYWxlID0gTC5Db250cm9sLlNjYWxlLmV4dGVuZCh7XHJcbiAgICAgICAgb25BZGQ6IGZ1bmN0aW9uIChtKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IEwuQ29udHJvbC5TY2FsZS5wcm90b3R5cGUub25BZGQuY2FsbCh0aGlzLCBtKTtcclxuICAgICAgICAgICAgdGhpcy5fbmF1dGljYWxTY2FsZSA9IEwuRG9tVXRpbC5jcmVhdGUoXHJcbiAgICAgICAgICAgICAgICBcImRpdlwiLCBcImxlYWZsZXQtY29udHJvbC1zY2FsZS1saW5lXCIsIGNvbnRhaW5lcik7XHJcbiAgICAgICAgICAgIHRoaXMuX3VwZGF0ZSgpO1xyXG4gICAgICAgICAgICByZXR1cm4gY29udGFpbmVyO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgX3VwZGF0ZVNjYWxlczogZnVuY3Rpb24gKG1heE1ldGVycykge1xyXG4gICAgICAgICAgICBMLkNvbnRyb2wuU2NhbGUucHJvdG90eXBlLl91cGRhdGVTY2FsZXMuY2FsbCh0aGlzLCBtYXhNZXRlcnMpO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fbmF1dGljYWxTY2FsZSAmJiBtYXhNZXRlcnMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1heE5tID0gbWF4TWV0ZXJzIC8gMTg1MjtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG5tID0gdGhpcy5fZ2V0Um91bmROdW0obWF4Tm0pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlU2NhbGUodGhpcy5fbmF1dGljYWxTY2FsZSwgYCR7bm19IG5tYCwgbm0gLyBtYXhObSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgbGV0IHNjYWxlQ29udHJvbCA9IG51bGw7XHJcbiAgICBmdW5jdGlvbiBzeW5jU2NhbGUoKSB7XHJcbiAgICAgICAgaWYgKHNjYWxlQ29udHJvbCkge1xyXG4gICAgICAgICAgICBzY2FsZUNvbnRyb2wucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbCA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghaG9zdC5nZXQoXCJzaG93X3NjYWxlXCIpKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgY2ZnID0gaG9zdC5nZXQoXCJzY2FsZV9jb25maWdcIikgfHwge307XHJcbiAgICAgICAgY29uc3QgdW5pdHMgPSBjZmcudW5pdHMgfHwgXCJtZXRyaWNcIjtcclxuICAgICAgICBjb25zdCBvcHRpb25zID0ge1xyXG4gICAgICAgICAgICBwb3NpdGlvbjogKGNmZy5wb3NpdGlvbiB8fCBcImJvdHRvbS1sZWZ0XCIpLnJlcGxhY2UoXCItXCIsIFwiXCIpLFxyXG4gICAgICAgICAgICBtYXhXaWR0aDogY2ZnLm1heF93aWR0aCB8fCAxMjAsXHJcbiAgICAgICAgICAgIG1ldHJpYzogdW5pdHMgPT09IFwibWV0cmljXCIgfHwgdW5pdHMgPT09IFwiYm90aFwiLFxyXG4gICAgICAgICAgICBpbXBlcmlhbDogdW5pdHMgPT09IFwiaW1wZXJpYWxcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBzY2FsZUNvbnRyb2wgPSB1bml0cyA9PT0gXCJuYXV0aWNhbFwiXHJcbiAgICAgICAgICAgID8gbmV3IE5hdXRpY2FsU2NhbGUob3B0aW9ucylcclxuICAgICAgICAgICAgOiBMLmNvbnRyb2wuc2NhbGUob3B0aW9ucyk7XHJcbiAgICAgICAgc2NhbGVDb250cm9sLmFkZFRvKG1hcCk7XHJcbiAgICB9XHJcbiAgICBzeW5jU2NhbGUoKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzaG93X3NjYWxlXCIsIHN5bmNTY2FsZSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2NhbGVfY29uZmlnXCIsIHN5bmNTY2FsZSk7XHJcblxyXG4gICAgLy8gRW1wdHktbWFwIGNsaWNrczogcmVwb3J0IHdoZXJlLiBSZWdpc3RlcmVkIHRocm91Z2ggdGhlIHNhbWUgYXJiaXRyYXRpb24gdGhlXHJcbiAgICAvLyBmZWF0dXJlIGhhbmRsZXJzIHVzZSwgYXQgdGhlIGxvd2VzdCBwcmlvcml0eSwgc28gYSBjbGljayB0aGF0IGhpdCBhIGZlYXR1cmVcclxuICAgIC8vIHN0YXlzIHRoYXQgZmVhdHVyZSdzIGNsaWNrIC0tIHRoaXMgd2lucyBvbmx5IHdoZW4gbm90aGluZyBjbGFpbWVkIHRoZSBldmVudC5cclxuICAgIC8vIGUubGF0bG5nIGlzIGFscmVhZHkgdW5wcm9qZWN0ZWQgdGhyb3VnaCB3aGljaGV2ZXIgQ1JTIHRoZSBtYXAgcnVucyAoMzg1NyBhbmRcclxuICAgIC8vIDQzMjYgYWxpa2UpLCBzbyB0aGVyZSBpcyBubyBwaXhlbCBtYXRoIHRvIGdldCB3cm9uZyBoZXJlOyB3cmFwKCkga2VlcHMgYVxyXG4gICAgLy8gd29ybGQtcGFubmVkIG1hcCBmcm9tIHJlcG9ydGluZyBsb25naXR1ZGUgLTM2NC5cclxuICAgIG1hcC5vbihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgLy8gU3RhbXBlZCBzeW5jaHJvbm91c2x5LCBiZWZvcmUgYW55IGdsaWZ5IGhhbmRsZXIgcmVnaXN0ZXJzIGl0cyBtYXRjaFxyXG4gICAgICAgIC8vICh0aGlzIGhhbmRsZXIgd2FzIGJvdW5kIGZpcnN0LCBzbyBMZWFmbGV0IHJ1bnMgaXQgZmlyc3QpOiB0aGUgd2hvbGVcclxuICAgICAgICAvLyBjbGljayBwaXBlbGluZSAtLSBmZWF0dXJlIHBvcHVwcyBhbmQgdGhpcyBmYWxsYmFjayBhbGlrZSAtLSBzdGFuZHNcclxuICAgICAgICAvLyBkb3duIHdoaWxlIGEgR2VvbWFuIG1vZGUgaXMgYXJtZWQuIERlZmVycmVkIGNoZWNrcyBtaXNzIG1vZGVzIHRoYXRcclxuICAgICAgICAvLyBjbG9zZSB0aGVtc2VsdmVzIG9uIHRoZWlyIGZpbmlzaGluZyBjbGljayAoYSBjb21wbGV0ZWQgcmVjdGFuZ2xlKSxcclxuICAgICAgICAvLyB3aGljaCBpcyB3aHkgdGhlIHN0YXRlIGlzIGNhcHR1cmVkIGF0IGNsaWNrIHRpbWUuXHJcbiAgICAgICAgY29uc3QgcG0gPSBtYXAucG07XHJcbiAgICAgICAgbWFwLl9wbU1vZGVBY3RpdmUgPSBCb29sZWFuKHBtXHJcbiAgICAgICAgICAgICYmICgocG0uZ2xvYmFsUmVtb3ZhbE1vZGVFbmFibGVkICYmIHBtLmdsb2JhbFJlbW92YWxNb2RlRW5hYmxlZCgpKVxyXG4gICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbEVkaXRNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxFZGl0TW9kZUVuYWJsZWQoKSlcclxuICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmFnTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhZ01vZGVFbmFibGVkKCkpXHJcbiAgICAgICAgICAgICAgICB8fCAocG0uZ2xvYmFsRHJhd01vZGVFbmFibGVkICYmIHBtLmdsb2JhbERyYXdNb2RlRW5hYmxlZCgpKSkpO1xyXG4gICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDk5LCAoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxsID0gZS5sYXRsbmcud3JhcCgpO1xyXG4gICAgICAgICAgICBjb25zdCBsYXQgPSBNYXRoLnJvdW5kKGxsLmxhdCAqIDFlNSkgLyAxZTU7XHJcbiAgICAgICAgICAgIGNvbnN0IGxuZyA9IE1hdGgucm91bmQobGwubG5nICogMWU1KSAvIDFlNTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBcIlwiKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgLTEpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLCBbbGF0LCBsbmddKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiY2xpY2tfc2VxXCIsIChob3N0LmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XHJcbiAgICAgICAgICAgIGlmIChob3N0LmdldChcInNob3dfY2xpY2tfY29vcmRpbmF0ZXNcIikpIHtcclxuICAgICAgICAgICAgICAgIEwucG9wdXAoeyBjbGFzc05hbWU6IFwic3dpZnRtYXAtY29vcmRzLXBvcHVwXCIsIGNsb3NlQnV0dG9uOiBmYWxzZSB9KVxyXG4gICAgICAgICAgICAgICAgICAgIC5zZXRMYXRMbmcoZS5sYXRsbmcpXHJcbiAgICAgICAgICAgICAgICAgICAgLnNldENvbnRlbnQoYCR7bGwubGF0LnRvRml4ZWQoNSl9LCAke2xsLmxuZy50b0ZpeGVkKDUpfWApXHJcbiAgICAgICAgICAgICAgICAgICAgLm9wZW5PbihtYXApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBCaW5kIHpvb20gYW5kIGNlbnRlciBjaGFuZ2VzIGJhY2sgdG8gUHl0aG9uIHNhZmVseVxyXG4gICAgbWFwLm9uKFwibW92ZWVuZFwiLCAoKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbWFwLmdldENlbnRlcigpO1xyXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50Wm9vbSA9IG1hcC5nZXRab29tKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBtb2RlbENlbnRlciA9IGhvc3QuZ2V0KFwiY2VudGVyXCIpO1xyXG4gICAgICAgICAgICBjb25zdCBtb2RlbFpvb20gPSBob3N0LmdldChcInpvb21cIik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1vZGVsWm9vbSAhPT0gY3VycmVudFpvb207XHJcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSAhbW9kZWxDZW50ZXIgfHwgXHJcbiAgICAgICAgICAgICAgICAhQXJyYXkuaXNBcnJheShtb2RlbENlbnRlcikgfHxcclxuICAgICAgICAgICAgICAgIG1vZGVsQ2VudGVyLmxlbmd0aCA8IDIgfHxcclxuICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzBdIC0gY2VudGVyLmxhdCkgPiAwLjAwMDEgfHwgXHJcbiAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclsxXSAtIGNlbnRlci5sbmcpID4gMC4wMDAxO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNlbnRlclwiLCBbY2VudGVyLmxhdCwgY2VudGVyLmxuZ10pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiem9vbVwiLCBjdXJyZW50Wm9vbSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgIHNhZmVTYXZlQ2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBtb3ZlZW5kIGhhbmRsZXI6XCIsIGVycik7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgZnVuY3Rpb24gdXBkYXRlTWFwVmlldygpIHtcclxuICAgICAgICBjb25zdCBjZW50ZXIgPSBob3N0LmdldChcImNlbnRlclwiKTtcclxuICAgICAgICBjb25zdCB6b29tID0gaG9zdC5nZXQoXCJ6b29tXCIpO1xyXG4gICAgICAgIGlmIChjZW50ZXIgJiYgQXJyYXkuaXNBcnJheShjZW50ZXIpICYmIGNlbnRlci5sZW5ndGggPj0gMikge1xyXG4gICAgICAgICAgICBjb25zdCBtYXBDZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xyXG4gICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gTWF0aC5hYnMobWFwQ2VudGVyLmxhdCAtIGNlbnRlclswXSkgPiAwLjAwMDEgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtYXBDZW50ZXIubG5nIC0gY2VudGVyWzFdKSA+IDAuMDAwMTtcclxuICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtYXBab29tICE9PSB6b29tO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5zZXRWaWV3KGNlbnRlciwgdHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgPyB6b29tIDogbWFwWm9vbSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCB6b29tID0gaG9zdC5nZXQoXCJ6b29tXCIpO1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgJiYgbWFwLmdldFpvb20oKSAhPT0gem9vbSkge1xyXG4gICAgICAgICAgICAgICAgbWFwLnNldFpvb20oem9vbSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gV2F0Y2ggZm9yIG1hcCB2aWV3IHVwZGF0ZXMgZnJvbSBQeXRob25cclxuICAgIGxpc3RlbihcImNoYW5nZTpjZW50ZXJcIiwgKCkgPT4ge1xyXG4gICAgICAgIGlmIChpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCkge1xyXG4gICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcclxuICAgIH0pO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnpvb21cIiwgKCkgPT4ge1xyXG4gICAgICAgIGlmIChpc1VwZGF0aW5nWm9vbUZyb21NYXApIHtcclxuICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgdXBkYXRlTWFwVmlldygpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBGaXR0aW5nIHRoZSB2aWV3IGlzIGEgY29tbWFuZCwgbm90IHN0YXRlOiBhc2tpbmcgdG8gZml0IHRoZSBzYW1lIGJvdW5kcyB0d2ljZVxyXG4gICAgLy8gbXVzdCBtb3ZlIHRoZSBtYXAgYm90aCB0aW1lcywgc2luY2UgdGhlIHVzZXIgbWF5IGhhdmUgcGFubmVkIGF3YXkgaW4gYmV0d2Vlbi5cclxuICAgIC8vIFRoZSByZXF1ZXN0IGNhcnJpZXMgYSBzZXF1ZW5jZSBudW1iZXIgc28gYW4gaWRlbnRpY2FsIGZpdCBzdGlsbCBmaXJlcyBhIGNoYW5nZS5cclxuICAgIGZ1bmN0aW9uIGFwcGx5Rml0UmVxdWVzdCgpIHtcclxuICAgICAgICBjb25zdCByZXEgPSBob3N0LmdldChcImZpdF9ib3VuZHNfcmVxdWVzdFwiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCBib3VuZHMgPSByZXEuYm91bmRzO1xyXG4gICAgICAgIGlmICghYm91bmRzIHx8IGJvdW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xyXG4gICAgICAgIGlmIChyZXEucGFkZGluZyAhPSBudWxsKSBvcHRpb25zLnBhZGRpbmcgPSBbcmVxLnBhZGRpbmcsIHJlcS5wYWRkaW5nXTtcclxuICAgICAgICBpZiAocmVxLm1heF96b29tICE9IG51bGwpIG9wdGlvbnMubWF4Wm9vbSA9IHJlcS5tYXhfem9vbTtcclxuICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcywgb3B0aW9ucyk7XHJcblxyXG4gICAgICAgIC8vIEFwcGxpZWQgYWZ0ZXIgdGhlIGZpdCwgc2luY2UgaXQgaXMgcmVsYXRpdmUgdG8gd2hhdGV2ZXIgem9vbSB0aGUgZml0IGNob3NlLlxyXG4gICAgICAgIGlmIChyZXEuem9vbV9vZmZzZXQpIHtcclxuICAgICAgICAgICAgbWFwLnNldFpvb20obWFwLmdldFpvb20oKSArIHJlcS56b29tX29mZnNldCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmZpdF9ib3VuZHNfcmVxdWVzdFwiLCBhcHBseUZpdFJlcXVlc3QpO1xyXG4gICAgLy8gQSByZXF1ZXN0IHNldCBiZWZvcmUgdGhpcyB2aWV3IGF0dGFjaGVkIC0tIGEgcHJlLWRpc3BsYXkgZml0X2JvdW5kcygpIGNhbGwsXHJcbiAgICAvLyBvciB0aGUgdW5pb24gYSBmcmVzaCBtYXAgbWFpbnRhaW5zIGFzIGF1dG8tZml0IHdoaWxlIGxheWVycyBhcmUgYWRkZWQgLS0gaXNcclxuICAgIC8vIGFscmVhZHkgc3RhdGUgYnkgbm93LCBzbyB0aGUgY2hhbmdlIGV2ZW50IHdpbGwgbmV2ZXIgZmlyZSBmb3IgaXQuIEl0IHVzZWRcclxuICAgIC8vIHRvIGJlIHNpbGVudGx5IGRyb3BwZWQ7IGFwcGx5IGl0IG9uY2UgdGhlIG1hcCBpcyByZWFkeSBpbnN0ZWFkLlxyXG4gICAgbWFwLndoZW5SZWFkeSgoKSA9PiBhcHBseUZpdFJlcXVlc3QoKSk7XHJcbiAgICAvLyBBIG1hcCBjb25zdHJ1Y3RlZCBpbnNpZGUgYSBoaWRkZW4gY29udGFpbmVyIC0tIGEgU2hpbnkgbmF2X3BhbmVsIHRoYXQgaXNcclxuICAgIC8vIG5vdCB0aGUgc2VsZWN0ZWQgdGFiIC0tIGluaXRpYWxpc2VzIGF0IDB4MCwgYW5kIExlYWZsZXQgY2FjaGVzIHRoYXQgc2l6ZTpcclxuICAgIC8vIGl0cyBvd24gdHJhY2tSZXNpemUgd2F0Y2hlcyB0aGUgV0lORE9XLCBub3QgdGhlIGNvbnRhaW5lciwgc28gbm90aGluZyBldmVyXHJcbiAgICAvLyBjb3JyZWN0cyBpdC4gVGhlIGZpdCBhYm92ZSB0aGVuIGNvbXB1dGVzIGl0cyB6b29tIGZyb20gYSB6ZXJvLXNpemUgbGllIGFuZFxyXG4gICAgLy8gdGhlIHZpZXcgbGFuZHMgd3JvbmcgcGVybWFuZW50bHkuIFdhdGNoIHRoZSBjb250YWluZXIgaXRzZWxmOiBldmVyeSByZXNpemVcclxuICAgIC8vIHJlLW1lYXN1cmVzLCBhbmQgdGhlIGZpcnN0IHRyYW5zaXRpb24gZnJvbSB6ZXJvIHRvIHJlYWwgc2l6ZSByZS1hcHBsaWVzXHJcbiAgICAvLyB0aGUgcGVuZGluZyBmaXQgd2l0aCBhIHNpemUgdGhhdCBjYW4gYWN0dWFsbHkgaG9sZCBpdC5cclxuICAgIGxldCBjb250YWluZXJSZXNpemUgPSBudWxsO1xyXG4gICAgaWYgKHR5cGVvZiBSZXNpemVPYnNlcnZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgICAgIGxldCBoYWRTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcclxuICAgICAgICBjb250YWluZXJSZXNpemUgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBoYXNTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcclxuICAgICAgICAgICAgaWYgKGhhc1NpemUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5pbnZhbGlkYXRlU2l6ZSgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFoYWRTaXplKSBhcHBseUZpdFJlcXVlc3QoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBoYWRTaXplID0gaGFzU2l6ZTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250YWluZXJSZXNpemUub2JzZXJ2ZShjb250YWluZXIpO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBzeW5jVGltZW91dCA9IG51bGw7XHJcbiAgICBsZXQgaXNTeW5jaW5nID0gZmFsc2U7XHJcbiAgICBsZXQgbmVlZHNTeW5jID0gZmFsc2U7XHJcblxyXG4gICAgYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVN5bmMoKSB7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGlmIChpc1N5bmNpbmcpIHtcclxuICAgICAgICAgICAgbmVlZHNTeW5jID0gdHJ1ZTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpc1N5bmNpbmcgPSB0cnVlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHN5bmNNYXBTdGF0ZSgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gc3luY01hcFN0YXRlOlwiLCBlcnIpO1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgIGlzU3luY2luZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBpZiAobmVlZHNTeW5jKSB7XHJcbiAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gcXVldWVTeW5jKCkge1xyXG4gICAgICAgIGlmIChkZXN0cm95ZWQgfHwgIWhvc3QuZ2V0KFwiYXV0b19zeW5jXCIpKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHN5bmNUaW1lb3V0KSB7XHJcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHN5bmNUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICB9LCA1MCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTGlzdGVuIGZvciBtYW51YWwgc3luYyB0cmlnZ2VyIGNoYW5nZXMgZnJvbSBQeXRob25cclxuICAgIGxpc3RlbihcImNoYW5nZTpzeW5jX3RyaWdnZXJcIiwgKCkgPT4ge1xyXG4gICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBJbmNyZW1lbnRhbCB1cGRhdGVzIGZyb20gUHl0aG9uLiBBcHBsaWVkIGV2ZW4gd2hlbiBhdXRvX3N5bmMgaXMgb2ZmIHNvIHRoZSBtaXJyb3JcclxuICAgIC8vIHN0YXlzIGN1cnJlbnQ7IHF1ZXVlU3luYyBkZWNpZGVzIHdoZXRoZXIgdG8gYWN0dWFsbHkgcmUtcmVuZGVyLlxyXG4gICAgbGlzdGVuKFwibXNnOmN1c3RvbVwiLCAobXNnLCBidWZmZXJzKSA9PiB7XHJcbiAgICAgICAgaWYgKCFtc2cgfHwgbXNnLmtpbmQgIT09IFwic3dpZnRtYXBfcGF0Y2hcIikgcmV0dXJuO1xyXG4gICAgICAgIGFwcGx5UGF0Y2hPcHMobXNnLm9wcyB8fCBbXSwgYnVmZmVycyk7XHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBGdWxsLXNuYXBzaG90IHBhdGhzOiB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlLCBhbmQgdGhlIHNpZGViYXIgd3JpdGluZyBgbGF5ZXJzYFxyXG4gICAgLy8gYmFjayBhZnRlciBhIHRvZ2dsZS4gRWl0aGVyIHdheSB0aGUgdHJhaXQgYmVjb21lcyBhdXRob3JpdGF0aXZlIGFnYWluLlxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmxheWVyc1wiLCAoKSA9PiB7XHJcbiAgICAgICAgbGF5ZXJTdGF0ZSA9IGhvc3QuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xyXG4gICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6Y29vcmRpbmF0ZV9idWZmZXJzXCIsICgpID0+IHtcclxuICAgICAgICBidWZmZXJTdGF0ZSA9IHsgLi4uKGhvc3QuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xyXG4gICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6Z3JvdXBfY29uZmlnc1wiLCBxdWV1ZVN5bmMpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnRpbWVfY29uZmlnXCIsICgpID0+IHtcclxuICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlOyAgIC8vIHJlLWFwcGx5IHNwZWVkL2xvb3AgZnJvbSB0aGUgbmV3IGNvbmZpZ1xyXG4gICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcclxuICAgIC8vIHRpbWUuIEd1YXJkZWQgc28gdGhlIHdpZGdldCdzIG93biB3cml0ZWJhY2sgZG9lcyBub3QgbG9vcCB0aHJvdWdoIGhlcmUuXHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6dGltZV9jdXJyZW50XCIsICgpID0+IHtcclxuICAgICAgICBjb25zdCB3YW50ZWQgPSBob3N0LmdldChcInRpbWVfY3VycmVudFwiKTtcclxuICAgICAgICBpZiAoIXRpbWVTdGF0ZSB8fCAhdGltZVVJLnRpY2tzLmxlbmd0aCkgcmV0dXJuO1xyXG4gICAgICAgIGlmIChNYXRoLmFicyh3YW50ZWQgLSB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSkgPCAxKSByZXR1cm47XHJcbiAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XHJcbiAgICAgICAgaWYgKGlkeCA9PT0gLTEpIGlkeCA9IHRpbWVVSS50aWNrcy5sZW5ndGggLSAxO1xyXG4gICAgICAgIHNlZWtUbyhpZHgsIHsgd3JpdGU6IGZhbHNlIH0pO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2hvd19sb2dvXCIsIHF1ZXVlU3luYyk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2hvd19sZWdlbmRcIiwgcXVldWVTeW5jKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpsZWdlbmRfY29uZmlnXCIsIHF1ZXVlU3luYyk7XHJcbiAgICAvLyBMaXZlIHJlc2l6ZXMgKGEgU2hpbnkgbGF5b3V0LCBhIG5vdGVib29rIGNlbGwpOiBMZWFmbGV0IGNhY2hlcyBpdHMgYm94LCBzb1xyXG4gICAgLy8gaXQgbXVzdCBiZSB0b2xkIHRvIHJlLW1lYXN1cmUgb3IgdGlsZXMgcmVuZGVyIGZvciB0aGUgb2xkIHNpemUuXHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6aGVpZ2h0XCIsICgpID0+IHtcclxuICAgICAgICBhcHBseUhlaWdodCgpO1xyXG4gICAgICAgIG1hcC5pbnZhbGlkYXRlU2l6ZSgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQW5ub3VuY2UgdGhpcyB2aWV3IHNvIFB5dGhvbiByZXBsaWVzIHdpdGggYSBmdWxsIHNuYXBzaG90LiBMYXllcnMgYWRkZWQgYmVmb3JlXHJcbiAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXHJcbiAgICAvLyB3aW5kb3cgd2hlcmUgbm90aGluZyB3YXMgbGlzdGVuaW5nLlxyXG4gICAgdHJ5IHtcclxuICAgICAgICBob3N0LnNlbmQoeyBraW5kOiBcInN3aWZ0bWFwX3JlYWR5XCIgfSk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGlzIGFsbCB0aGVyZSBpcyAqLyB9XHJcblxyXG4gICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcclxuICAgIGlmIChob3N0LmdldChcImF1dG9fc3luY1wiKSB8fCBob3N0LmdldChcInN5bmNfdHJpZ2dlclwiKSA+IDApIHtcclxuICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFRoZSBoYW5kbGUgYSBob3N0IGtlZXBzOiB0aGUgbGl2ZSBtYXAgYW5kIGEgdGVhcmRvd24gdGhhdCByZWxlYXNlcyB3aGF0IHRoZVxyXG4gICAgLy8gcGFnZSBjYW5ub3QgcmVjbGFpbSBvbiBpdHMgb3duIC0tIHBsYXliYWNrIHRpbWVycywgdGhlIHBlbmRpbmcgc3luYywgdGhlXHJcbiAgICAvLyBjb250YWluZXIncyByZXNpemUgb2JzZXJ2ZXIsIHRoZSBjb25zb2xlIGhvb2tzLCB0aGUgaG9zdCBzdWJzY3JpcHRpb25zLCBhbmRcclxuICAgIC8vIHRoZSBMZWFmbGV0IG1hcCB3aXRoIGV2ZXJ5IEdMIGNvbnRleHQgYW5kIGJsb2IgVVJMIGl0cyBsYXllcnMgaG9sZC5cclxuICAgIGZ1bmN0aW9uIGRlc3Ryb3koKSB7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGRlc3Ryb3llZCA9IHRydWU7XHJcbiAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgaWYgKHN5bmNUaW1lb3V0KSB7XHJcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XHJcbiAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGNvbnRhaW5lclJlc2l6ZSkgY29udGFpbmVyUmVzaXplLmRpc2Nvbm5lY3QoKTtcclxuICAgICAgICBpZiAodHlwZW9mIGhvc3Qub2ZmID09PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbZXZlbnQsIGZuXSBvZiBzdWJzY3JpcHRpb25zKSBob3N0Lm9mZihldmVudCwgZm4pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmVycm9yID0gb3JpZ2luYWxFcnJvcjtcclxuICAgICAgICBjb25zb2xlLndhcm4gPSBvcmlnaW5hbFdhcm47XHJcbiAgICAgICAgaWYgKHdpbmRvdy5vbmVycm9yID09PSBvbldpbmRvd0Vycm9yKSB3aW5kb3cub25lcnJvciA9IG51bGw7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgbWFwLnJlbW92ZSgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBhbHJlYWR5IHRvcm4gZG93biAqLyB9XHJcbiAgICAgICAgaWYgKGNvbnRhaW5lci5wYXJlbnROb2RlKSBjb250YWluZXIucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChjb250YWluZXIpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgbWFwLCBjb250YWluZXIsIHN5bmM6IHBlcmZvcm1TeW5jLCBkZXN0cm95IH07XHJcbn1cclxuIiwgIi8qKlxyXG4gKiBUaGUgaG9zdCBpbnRlcmZhY2U6IHdoYXQgYSBzd2lmdG1hcCBjb3JlIGluc3RhbmNlIG5lZWRzIGZyb20gd2hhdGV2ZXIgZW1iZWRzIGl0LlxyXG4gKlxyXG4gKiBGaXZlIG1ldGhvZHMsIGFscmVhZHkgcHJvdmVuIGJ5IGV2ZXJ5IHN0YXRpYyBleHBvcnQsIHdoaWNoIHJ1bnMgdGhlIHJlYWwgYnVuZGxlXHJcbiAqIGFnYWluc3QgZXhhY3RseSB0aGlzIHN1cmZhY2Ugd2l0aCBubyBQeXRob24gYmVoaW5kIGl0OlxyXG4gKlxyXG4gKiAgIGdldChrZXkpICAgICAgICAgICAgICAtPiB0aGUgY3VycmVudCB2YWx1ZSBvZiBhIHN0YXRlIGtleVxyXG4gKiAgIHNldChrZXksIHZhbHVlKSAgICAgICAtPiBzdG9yZSBpdCBhbmQgZmlyZSB0aGUgYGNoYW5nZTo8a2V5PmAgbGlzdGVuZXJzXHJcbiAqICAgb24oZXZlbnQsIGZuKSAgICAgICAgIC0+IHN1YnNjcmliZTsgYGNoYW5nZTo8a2V5PmAsIGFuZCBgbXNnOmN1c3RvbWAgZm9yIHBhdGNoZXNcclxuICogICBzZW5kKGNvbnRlbnQsIGJ1ZmZlcnMpLT4gYSBtZXNzYWdlIHRvIHRoZSBvdGhlciBzaWRlIChtYXkgZ28gbm93aGVyZSlcclxuICogICBzYXZlX2NoYW5nZXMoKSAgICAgICAgLT4gZmx1c2ggcGVuZGluZyB3cml0ZXMgKG1heSBiZSBhIG5vLW9wKVxyXG4gKlxyXG4gKiBPcHRpb25hbDogb2ZmKGV2ZW50LCBmbiksIGhvbm91cmVkIGJ5IGRlc3Ryb3koKSB3aGVuIHByZXNlbnQuXHJcbiAqXHJcbiAqIFRoZSBjb3JlIHJlYWRzIHRoZXNlIGtleXMgdGhyb3VnaCBnZXQoKTogbGF5ZXJzLCBjb29yZGluYXRlX2J1ZmZlcnMsIGdyb3VwX2NvbmZpZ3MsXHJcbiAqIGNlbnRlciwgem9vbSwgY3JzLCBoZWlnaHQsIGF1dG9fc3luYywgc3luY190cmlnZ2VyLCBzaG93X2xvZ28sIGxvZ29fY29uZmlnLFxyXG4gKiBzaG93X2xlZ2VuZCwgbGVnZW5kX2NvbmZpZywgc2hvd19zY2FsZSwgc2NhbGVfY29uZmlnLCBzaG93X2RyYXcsIGRyYXdfY29uZmlnLFxyXG4gKiBkcmF3aW5ncywgZHJhd19zZXEsIHNob3dfY2xpY2tfY29vcmRpbmF0ZXMsIHRpbWVfY29uZmlnLCB0aW1lX2N1cnJlbnQsXHJcbiAqIGZpdF9ib3VuZHNfcmVxdWVzdCwganNfY29uc29sZV9sb2dzLiBJdCB3cml0ZXMgYmFjayB0aHJvdWdoIHNldCgpOiBjZW50ZXIsIHpvb20sXHJcbiAqIGNsaWNrZWRfbGF5ZXJfaWQsIHNlbGVjdGVkX2luZGV4LCBjbGlja2VkX2xhdGxuZywgY2xpY2tfc2VxLCBkcmF3aW5ncywgZHJhd19zZXEsXHJcbiAqIHRpbWVfY3VycmVudCwgdGltZV9jb25maWcsIGdyb3VwX2NvbmZpZ3MsIGpzX2NvbnNvbGVfbG9ncy4gU2lkZWJhciB0b2dnbGVzIGdvIG91dFxyXG4gKiB0aHJvdWdoIHNlbmQoKSBhcyB7a2luZDogXCJzd2lmdG1hcF93cml0ZVwiLCBvcHN9OyB0aGUgd2lkZ2V0IGFubm91bmNlcyBpdHNlbGYgd2l0aFxyXG4gKiB7a2luZDogXCJzd2lmdG1hcF9yZWFkeVwifS4gSW5jcmVtZW50YWwgdXBkYXRlcyBhcnJpdmUgb24gdGhlIGBtc2c6Y3VzdG9tYCBldmVudCBhc1xyXG4gKiAoe2tpbmQ6IFwic3dpZnRtYXBfcGF0Y2hcIiwgb3BzfSwgYnVmZmVycykuXHJcbiAqXHJcbiAqIGFueXdpZGdldCdzIG1vZGVsIHNhdGlzZmllcyB0aGlzIGFzLWlzOyB0aGUgc3R1YiBiZWxvdyBpcyB0aGUgcmVmZXJlbmNlIGhvc3QgZm9yXHJcbiAqIGV4cG9ydHMsIHRlc3RzLCBhbmQgYW55IGVtYmVkZGluZyB3aXRoIG5vIGtlcm5lbCBiZWhpbmQgaXQuXHJcbiAqL1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhvc3RTdHViKGluaXRpYWwgPSB7fSwgaG9va3MgPSB7fSkge1xyXG4gICAgY29uc3Qgc3RhdGUgPSB7IC4uLmluaXRpYWwgfTtcclxuICAgIGNvbnN0IGxpc3RlbmVycyA9IHt9O1xyXG4gICAgY29uc3QgaG9zdCA9IHtcclxuICAgICAgICBjb21tOiBob29rcy5jb21tID09PSB1bmRlZmluZWQgPyBudWxsIDogaG9va3MuY29tbSxcclxuICAgICAgICBzdGF0ZSxcclxuICAgICAgICBzZXRzOiBbXSwgICAgICAvLyBldmVyeSBzZXQoKSwgaW4gb3JkZXIsIGZvciBhc3NlcnRpb25zXHJcbiAgICAgICAgc2VudDogW10sICAgICAgLy8gZXZlcnkgc2VuZCgpXHJcbiAgICAgICAgc2F2ZXM6IDAsXHJcbiAgICAgICAgZ2V0OiBrZXkgPT4gc3RhdGVba2V5XSxcclxuICAgICAgICBzZXQoa2V5LCB2YWx1ZSkge1xyXG4gICAgICAgICAgICBzdGF0ZVtrZXldID0gdmFsdWU7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0cy5wdXNoKFtrZXksIHZhbHVlXSk7XHJcbiAgICAgICAgICAgIChsaXN0ZW5lcnNbYGNoYW5nZToke2tleX1gXSB8fCBbXSkuZm9yRWFjaChmbiA9PiBmbigpKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uKGV2ZW50LCBmbikge1xyXG4gICAgICAgICAgICAobGlzdGVuZXJzW2V2ZW50XSA9IGxpc3RlbmVyc1tldmVudF0gfHwgW10pLnB1c2goZm4pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb2ZmKGV2ZW50LCBmbikge1xyXG4gICAgICAgICAgICBsaXN0ZW5lcnNbZXZlbnRdID0gKGxpc3RlbmVyc1tldmVudF0gfHwgW10pLmZpbHRlcihmID0+IGYgIT09IGZuKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNlbmQoY29udGVudCwgYnVmZmVycykge1xyXG4gICAgICAgICAgICBob3N0LnNlbnQucHVzaCh7IGNvbnRlbnQsIGJ1ZmZlcnMgfSk7XHJcbiAgICAgICAgICAgIGlmIChob29rcy5vblNlbmQpIGhvb2tzLm9uU2VuZChjb250ZW50LCBidWZmZXJzKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNhdmVfY2hhbmdlcygpIHtcclxuICAgICAgICAgICAgaG9zdC5zYXZlcyArPSAxO1xyXG4gICAgICAgICAgICBpZiAoaG9va3Mub25TYXZlKSBob29rcy5vblNhdmUoKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIEZpcmVzIGxpc3RlbmVycyBkaXJlY3RseTogaG93IGEgdGVzdCBvciBhbiBleHBvcnQgcHVzaGVzIGEgcmVhbFxyXG4gICAgICAgIC8vIHN3aWZ0bWFwX3BhdGNoIHRocm91Z2ggYG1zZzpjdXN0b21gLCBleGFjdGx5IGFzIGEga2VybmVsIHdvdWxkLlxyXG4gICAgICAgIGVtaXQoZXZlbnQsIC4uLmFyZ3MpIHtcclxuICAgICAgICAgICAgKGxpc3RlbmVyc1tldmVudF0gfHwgW10pLmZvckVhY2goZm4gPT4gZm4oLi4uYXJncykpO1xyXG4gICAgICAgIH0sXHJcbiAgICB9O1xyXG4gICAgcmV0dXJuIGhvc3Q7XHJcbn1cclxuIiwgIi8vIFRoZSBhbnl3aWRnZXQgYWRhcHRlcjogb25lIGhvc3Qgb3ZlciB0aGUgc3dpZnRtYXAgY29yZS5cclxuLy9cclxuLy8gYW55d2lkZ2V0J3MgbW9kZWwgYWxyZWFkeSBJUyBhIGhvc3QgLS0gZ2V0L3NldC9vbi9zZW5kL3NhdmVfY2hhbmdlcywgd2l0aFxyXG4vLyBgY2hhbmdlOjxrZXk+YCBhbmQgYG1zZzpjdXN0b21gIGV2ZW50cyAtLSBzbyBub3RoaW5nIGlzIHRyYW5zbGF0ZWQgaGVyZS4gVGhlXHJcbi8vIGNsZWFudXAgcmV0dXJuZWQgdGVhcnMgdGhlIG1hcCBkb3duIHdoZW4gYW55d2lkZ2V0IGRpc2NhcmRzIHRoZSB2aWV3LlxyXG5pbXBvcnQgeyBjcmVhdGVTd2lmdE1hcCB9IGZyb20gXCIuL2NvcmUuanNcIjtcclxuXHJcbmV4cG9ydCB7IGNyZWF0ZUhvc3RTdHViIH0gZnJvbSBcIi4vaG9zdC5qc1wiO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQge1xyXG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcclxuICAgICAgICBjb25zdCBoYW5kbGUgPSBhd2FpdCBjcmVhdGVTd2lmdE1hcCh7IGhvc3Q6IG1vZGVsLCBlbCB9KTtcclxuICAgICAgICByZXR1cm4gKCkgPT4gaGFuZGxlLmRlc3Ryb3koKTtcclxuICAgIH0sXHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBTyxTQUFTLFFBQVEsSUFBSSxLQUFLO0FBQzdCLE1BQUksQ0FBQyxTQUFTLGVBQWUsRUFBRSxHQUFHO0FBQzlCLFVBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTTtBQUMxQyxTQUFLLEtBQUs7QUFDVixTQUFLLE1BQU07QUFDWCxTQUFLLE9BQU87QUFDWixhQUFTLEtBQUssWUFBWSxJQUFJO0FBQUEsRUFDbEM7QUFDSjtBQUVBLElBQU0sZ0JBQWdCLENBQUM7QUFFaEIsU0FBUyxPQUFPLElBQUksS0FBSztBQUM1QixNQUFJLGNBQWMsRUFBRSxHQUFHO0FBQ25CLFdBQU8sY0FBYyxFQUFFO0FBQUEsRUFDM0I7QUFDQSxRQUFNLFVBQVUsSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQzdDLFFBQUksU0FBUyxlQUFlLEVBQUUsR0FBRztBQUM3QixjQUFRO0FBQ1I7QUFBQSxJQUNKO0FBQ0EsVUFBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLFdBQU8sS0FBSztBQUNaLFdBQU8sTUFBTTtBQUNiLFdBQU8sU0FBUyxNQUFNLFFBQVE7QUFDOUIsV0FBTyxVQUFVLE1BQU0sT0FBTyxJQUFJLE1BQU0sMEJBQTBCLEdBQUcsRUFBRSxDQUFDO0FBQ3hFLGFBQVMsS0FBSyxZQUFZLE1BQU07QUFBQSxFQUNwQyxDQUFDO0FBQ0QsZ0JBQWMsRUFBRSxJQUFJO0FBQ3BCLFNBQU87QUFDWDtBQUVBLFNBQVMsU0FBUyxLQUFLO0FBQ25CLE1BQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsUUFBTSxJQUFJLFFBQVEsTUFBTSxFQUFFO0FBQzFCLE1BQUksSUFBSSxXQUFXLEdBQUc7QUFDbEIsVUFB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QUFDLEdBQUcsUUFBUSxDQUFDLEdBQUc7QUFDckQsUUFBTSxRQUFRLEVBQUUsR0FBRyxRQUFRO0FBQzNCLFFBQU0sWUFBWSxDQUFDO0FBQ25CLFFBQU0sT0FBTztBQUFBLElBQ1QsTUFBTSxNQUFNLFNBQVMsU0FBWSxPQUFPLE1BQU07QUFBQSxJQUM5QztBQUFBLElBQ0EsTUFBTSxDQUFDO0FBQUE7QUFBQSxJQUNQLE1BQU0sQ0FBQztBQUFBO0FBQUEsSUFDUCxPQUFPO0FBQUEsSUFDUCxLQUFLLFNBQU8sTUFBTSxHQUFHO0FBQUEsSUFDckIsSUFBSSxLQUFLLE9BQU87QUFDWixZQUFNLEdBQUcsSUFBSTtBQUNiLFdBQUssS0FBSyxLQUFLLENBQUMsS0FBSyxLQUFLLENBQUM7QUFDM0IsT0FBQyxVQUFVLFVBQVUsR0FBRyxFQUFFLEtBQUssQ0FBQyxHQUFHLFFBQVEsUUFBTSxHQUFHLENBQUM7QUFBQSxJQUN6RDtBQUFBLElBQ0EsR0FBRyxPQUFPLElBQUk7QUFDVixPQUFDLFVBQVUsS0FBSyxJQUFJLFVBQVUsS0FBSyxLQUFLLENBQUMsR0FBRyxLQUFLLEVBQUU7QUFBQSxJQUN2RDtBQUFBLElBQ0EsSUFBSSxPQUFPLElBQUk7QUFDWCxnQkFBVSxLQUFLLEtBQUssVUFBVSxLQUFLLEtBQUssQ0FBQyxHQUFHLE9BQU8sT0FBSyxNQUFNLEVBQUU7QUFBQSxJQUNwRTtBQUFBLElBQ0EsS0FBSyxTQUFTLFNBQVM7QUFDbkIsV0FBSyxLQUFLLEtBQUssRUFBRSxTQUFTLFFBQVEsQ0FBQztBQUNuQyxVQUFJLE1BQU0sT0FBUSxPQUFNLE9BQU8sU0FBUyxPQUFPO0FBQUEsSUFDbkQ7QUFBQSxJQUNBLGVBQWU7QUFDWCxXQUFLLFNBQVM7QUFDZCxVQUFJLE1BQU0sT0FBUSxPQUFNLE9BQU87QUFBQSxJQUNuQztBQUFBO0FBQUE7QUFBQSxJQUdBLEtBQUssVUFBVSxNQUFNO0FBQ2pCLE9BQUMsVUFBVSxLQUFLLEtBQUssQ0FBQyxHQUFHLFFBQVEsUUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDO0FBQUEsSUFDdEQ7QUFBQSxFQUNKO0FBQ0EsU0FBTztBQUNYOzs7QUN4REEsSUFBTyxvQkFBUTtBQUFBLEVBQ1gsTUFBTSxPQUFPLEVBQUUsT0FBTyxHQUFHLEdBQUc7QUFDeEIsVUFBTSxTQUFTLE1BQU0sZUFBZSxFQUFFLE1BQU0sT0FBTyxHQUFHLENBQUM7QUFDdkQsV0FBTyxNQUFNLE9BQU8sUUFBUTtBQUFBLEVBQ2hDO0FBQ0o7IiwKICAibmFtZXMiOiBbImNvbGxhcHNlZEJ5Q29udGFpbmVyIiwgImNvdW50IiwgImdsTGF5ZXIiLCAiaW5zdGFuY2UiLCAiTCIsICJjb250YWluZXIiLCAiem9vbSJdCn0K
