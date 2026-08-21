// src/libs.js
var L = null;
function provideLeaflet(leaflet) {
  if (!leaflet || typeof leaflet.map !== "function") {
    throw new Error("swiftmap: provideLeaflet expects the Leaflet namespace (L)");
  }
  if (!leaflet.glify) {
    console.warn("[SwiftMap] provideLeaflet: L.glify is missing -- import leaflet.glify before providing, or no WebGL layer will draw.");
  }
  if (!leaflet.PM) {
    console.warn("[SwiftMap] provideLeaflet: Leaflet-Geoman is missing -- the draw/AOI toolbar will be unavailable.");
  }
  L = leaflet;
  return L;
}
function requireLeaflet() {
  if (!L) {
    throw new Error("swiftmap: no Leaflet provided. Pass `leaflet` to createSwiftMap, call provideLeaflet(L), or use loadLibraries() on a page that loads from a CDN.");
  }
  return L;
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
async function createSwiftMap({ host, el, leaflet = null }) {
  if (leaflet) provideLeaflet(leaflet);
  requireLeaflet();
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
  function cancelGlFrame(glInstance) {
    const overlay = glInstance && glInstance.layer;
    if (overlay && overlay._frame != null) {
      L.Util.cancelAnimFrame(overlay._frame);
      overlay._frame = null;
    }
  }
  function retireGl(instance) {
    if (!instance) return;
    for (const gl of [instance.glPoints, instance.glLines, instance.glShapes, instance]) {
      cancelGlFrame(gl);
    }
    try {
      instance.remove();
    } catch (err) {
    }
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
      if (destroyed) return;
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
          retireGl(state.layer);
        }
        if (visibleLayers.length > 0) {
          const built = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, layerEvents, timeState, vectorGpu, featureVisibleNow);
          if (destroyed) {
            retireGl(built);
            return;
          }
          state.layer = built;
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
    if (destroyed) return;
    await syncGlLayer("markers", bucket.markers);
    if (destroyed) return;
    await syncGlLayer("polyline", bucket.polyline, vectorGpuBucket.polyline);
    if (destroyed) return;
    await syncGlLayer("polygon", bucket.polygon, vectorGpuBucket.polygon);
    if (destroyed) return;
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
    for (const state of Object.values(glStates)) {
      retireGl(state.layer);
      state.layer = null;
    }
    const glify = L.glify;
    if (glify) {
      for (const list of [glify.pointsInstances, glify.linesInstances, glify.shapesInstances]) {
        for (const instance of [...list || []]) {
          if (instance.map === map) retireGl(instance);
        }
      }
    }
    try {
      map.remove();
    } catch (err) {
    }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
  return { map, container, sync: performSync, destroy };
}

// src/loader.js
var LIBRARY_URLS = {
  leafletCss: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  leafletJs: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  glifyJs: "https://unpkg.com/leaflet.glify@3.3.0/dist/glify-browser.js",
  geomanCss: "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.css",
  geomanJs: "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.18.3/dist/leaflet-geoman.min.js"
};
async function loadLibraries(urls = LIBRARY_URLS) {
  loadCSS("leaflet-css", urls.leafletCss);
  await loadJS("leaflet-js", urls.leafletJs);
  await loadJS("leaflet-glify", urls.glifyJs);
  loadCSS("leaflet-geoman-css", urls.geomanCss);
  await loadJS("leaflet-geoman", urls.geomanJs);
  return provideLeaflet(window.L);
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
    const leaflet = await loadLibraries();
    const handle = await createSwiftMap({ host: model, el, leaflet });
    return () => handle.destroy();
  }
};
export {
  createHostStub,
  anywidget_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL2xpYnMuanMiLCAiLi4vLi4vc3JjL3NpZGViYXIuanMiLCAiLi4vLi4vc3JjL3BhdGNoLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvZ3B1dGltZS5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9sYWJlbHMuanMiLCAiLi4vLi4vc3JjL2NvcmUuanMiLCAiLi4vLi4vc3JjL2xvYWRlci5qcyIsICIuLi8uLi9zcmMvaG9zdC5qcyIsICIuLi8uLi9zcmMvYW55d2lkZ2V0LmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBUaGUgbGlicmFyaWVzIHRoZSBjb3JlIHJlbmRlcnMgd2l0aCwgUFJPVklERUQgYnkgdGhlIGhvc3QgYmVmb3JlIHRoZSBtYXAgaXNcclxuLy8gY29uc3RydWN0ZWQgLS0gbmV2ZXIgcmVhY2hlZCBmb3IgYXMgZ2xvYmFscy4gYExgIGlzIGEgbGl2ZSBiaW5kaW5nOiBldmVyeVxyXG4vLyBtb2R1bGUgaW1wb3J0cyBpdCBmcm9tIGhlcmUgYW5kIHNlZXMgd2hhdGV2ZXIgcHJvdmlkZUxlYWZsZXQgc2V0LlxyXG4vL1xyXG4vLyBUd28ga2luZHMgb2YgaG9zdC4gVGhlIHdpZGdldCBhbmQgYSBzdGF0aWMgZXhwb3J0IGZldGNoIExlYWZsZXQsIGdsaWZ5IGFuZFxyXG4vLyBHZW9tYW4gYXQgcnVudGltZSAoc3JjL2xvYWRlci5qcyksIGJlY2F1c2UgdGhlaXIgcGFnZSBoYXMgbm8gYnVuZGxlcjsgYW4gbnBtXHJcbi8vIGNvbnN1bWVyIGltcG9ydHMgdGhlbSBhcyByZWFsIGRlcGVuZGVuY2llcyBhbmQgcGFzc2VzIHRoZSByZXN1bHQgaW4uIEVpdGhlclxyXG4vLyB3YXkgdGhlIE9SREVSIGlzIGZpeGVkIGJ5IGNvbnN0cnVjdGlvbjogR2VvbWFuIGF0dGFjaGVzIG1hcC5wbSB0aHJvdWdoIGFcclxuLy8gTGVhZmxldCBpbml0IGhvb2sgdGhhdCBvbmx5IHJ1bnMgZm9yIG1hcHMgY3JlYXRlZCBhZnRlciB0aGUgcGx1Z2luIGV4aXN0c1xyXG4vLyAoNTM5NGQxZSksIHNvIHByb3ZpZGluZyBtdXN0IGZpbmlzaCBiZWZvcmUgY3JlYXRlU3dpZnRNYXAgYnVpbGRzIHRoZSBtYXAgLS1cclxuLy8gd2hpY2ggaXMgd2h5IHRoZSBjb3JlIHRha2VzIExlYWZsZXQgYXMgYW4gYXJndW1lbnQgYW5kIG5ldmVyIGxvYWRzIGl0IGxhemlseS5cclxuZXhwb3J0IGxldCBMID0gbnVsbDtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwcm92aWRlTGVhZmxldChsZWFmbGV0KSB7XHJcbiAgICBpZiAoIWxlYWZsZXQgfHwgdHlwZW9mIGxlYWZsZXQubWFwICE9PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzd2lmdG1hcDogcHJvdmlkZUxlYWZsZXQgZXhwZWN0cyB0aGUgTGVhZmxldCBuYW1lc3BhY2UgKEwpXCIpO1xyXG4gICAgfVxyXG4gICAgaWYgKCFsZWFmbGV0LmdsaWZ5KSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKFwiW1N3aWZ0TWFwXSBwcm92aWRlTGVhZmxldDogTC5nbGlmeSBpcyBtaXNzaW5nIC0tIGltcG9ydCBcIlxyXG4gICAgICAgICAgICArIFwibGVhZmxldC5nbGlmeSBiZWZvcmUgcHJvdmlkaW5nLCBvciBubyBXZWJHTCBsYXllciB3aWxsIGRyYXcuXCIpO1xyXG4gICAgfVxyXG4gICAgaWYgKCFsZWFmbGV0LlBNKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKFwiW1N3aWZ0TWFwXSBwcm92aWRlTGVhZmxldDogTGVhZmxldC1HZW9tYW4gaXMgbWlzc2luZyAtLSB0aGUgXCJcclxuICAgICAgICAgICAgKyBcImRyYXcvQU9JIHRvb2xiYXIgd2lsbCBiZSB1bmF2YWlsYWJsZS5cIik7XHJcbiAgICB9XHJcbiAgICBMID0gbGVhZmxldDtcclxuICAgIHJldHVybiBMO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVxdWlyZUxlYWZsZXQoKSB7XHJcbiAgICBpZiAoIUwpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzd2lmdG1hcDogbm8gTGVhZmxldCBwcm92aWRlZC4gUGFzcyBgbGVhZmxldGAgdG8gXCJcclxuICAgICAgICAgICAgKyBcImNyZWF0ZVN3aWZ0TWFwLCBjYWxsIHByb3ZpZGVMZWFmbGV0KEwpLCBvciB1c2UgbG9hZExpYnJhcmllcygpIG9uIGEgXCJcclxuICAgICAgICAgICAgKyBcInBhZ2UgdGhhdCBsb2FkcyBmcm9tIGEgQ0ROLlwiKTtcclxuICAgIH1cclxuICAgIHJldHVybiBMO1xyXG59XHJcbiIsICIvLyBGb2xkZXIgY29sbGFwc2Ugc3RhdGUsIFBFUiBTSURFQkFSLiBJdCB1c2VkIHRvIGJlIG9uZSBtb2R1bGUtbGV2ZWwgb2JqZWN0LCBzb1xyXG4vLyB0d28gbWFwcyBvbiBvbmUgcGFnZSBzaGFyZWQgaXQgLS0gY29sbGFwc2luZyBhIGZvbGRlciBpbiBvbmUgY29sbGFwc2VkIGl0IGluXHJcbi8vIHRoZSBvdGhlci4gS2V5ZWQgYnkgdGhlIGNvbnRhaW5lciBlbGVtZW50LCBleGFjdGx5IGFzIHRoZSBsZWdlbmQga2VlcHMgaXRzIG93blxyXG4vLyBjb2xsYXBzZSBzdGF0ZSAoM2I5Yzk2YyksIGFuZCBzdXJ2aXZpbmcgdGhlIGZ1bGwgcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXHJcbmNvbnN0IGNvbGxhcHNlZEJ5Q29udGFpbmVyID0gbmV3IFdlYWtNYXAoKTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzaWRlYmFyQ29sbGFwc2VTdGF0ZShjb250YWluZXIpIHtcclxuICAgIGxldCBzdGF0ZSA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xyXG4gICAgaWYgKCFzdGF0ZSkge1xyXG4gICAgICAgIHN0YXRlID0ge307XHJcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgc3RhdGUpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHN0YXRlO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJCb3VuZHMobCwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmICghbCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgLy8gU3VwcG9ydCBmb2xkZXIgdHJlZSBub2RlcyAoZ3JvdXBzIGluIHNpZGViYXIgdHJlZSlcclxuICAgIGlmIChsLmlzR3JvdXApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZHJlbiBncm91cHNcclxuICAgICAgICBPYmplY3Qua2V5cyhsLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhsLmNoaWxkcmVuW2tleV0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGQgbGF5ZXJzXHJcbiAgICAgICAgbC5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobHlyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChsLmJvdW5kcyAmJiBsLmJvdW5kcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgcmV0dXJuIGwuYm91bmRzO1xyXG4gICAgfVxyXG4gICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbC5sYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobC5sb2NhdGlvbnMgJiYgbC5sb2NhdGlvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IGwubG9jYXRpb25zLmZsYXQoSW5maW5pdHkpO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpXTtcclxuICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKyAxXTtcclxuICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdO1xyXG4gICAgICAgIGlmIChidWYpIHtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShidWYuYnVmZmVyLCBidWYuYnl0ZU9mZnNldCwgYnVmLmJ5dGVMZW5ndGggLyA4KTtcclxuICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGggLyAyOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpICogMl07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBUaGUgd3JpdGUgaGFsZiBvZiBhIHZpc2liaWxpdHkgdG9nZ2xlOiBvbmUgY3VzdG9tIG1lc3NhZ2UgbmFtaW5nIHRoZSBmbGlwcGVkIGlkcyxcclxuLy8gaW5zdGVhZCBvZiB0aGUgd2hvbGUgbGF5ZXJzIHRyYWl0LiBQeXRob24gYXBwbGllcyB0aGUgZmllbGRzIGFuZCByZS1lbWl0cyB0aGVtIGFzXHJcbi8vIGBzZXRgIHBhdGNoIG9wcywgd2hpY2ggaXMgaG93IG90aGVyIHZpZXdzIG9mIHRoZSBzYW1lIG1hcCAobm90ZWJvb2sgb3V0cHV0cykgc3RheVxyXG4vLyBpbiBzdGVwIG5vdyB0aGF0IHRoZSB0cmFpdCBubyBsb25nZXIgY2FycmllcyB0b2dnbGVzLlxyXG4vLyBgY29sbGFwc2VkUGF0aHNgIGlzIHRoZSBjYWxsaW5nIHNpZGViYXIncyBvd24gc3RhdGUgKHNpZGViYXJDb2xsYXBzZVN0YXRlKSwgc29cclxuLy8gYSByYWRpbyBncm91cCdzIGF1dG8tY29sbGFwc2UgbGFuZHMgb24gdGhhdCBzaWRlYmFyIGFsb25lLlxyXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUmFkaW9MYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbGxhcHNlZFBhdGhzID0ge30pIHtcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIGlmICghZ3JvdXBDb25maWdzW1wiXCJdKSB7XHJcbiAgICAgICAgZ3JvdXBDb25maWdzW1wiXCJdID0geyBtdWx0aV9zZWxlY3Q6IHRydWUsIHZpc2libGU6IHRydWUgfTtcclxuICAgIH1cclxuICAgIGxheWVycy5mb3JFYWNoKGwgPT4ge1xyXG4gICAgICAgIGNvbnN0IHBhdGhTdHIgPSBsLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCI7XHJcbiAgICAgICAgY29uc3QgcGFydHMgPSBwYXRoU3RyLnNwbGl0KFwiL1wiKTtcclxuICAgICAgICBsZXQgY3VyciA9IHRyZWU7XHJcbiAgICAgICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcclxuICAgICAgICBwYXJ0cy5mb3JFYWNoKHBhcnQgPT4ge1xyXG4gICAgICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcclxuICAgICAgICAgICAgaWYgKCFjdXJyLmNoaWxkcmVuW3BhcnRdKSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyLmNoaWxkcmVuW3BhcnRdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHBhcnQsXHJcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogcnVubmluZ1BhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IHt9LFxyXG4gICAgICAgICAgICAgICAgICAgIGxheWVyczogW10sXHJcbiAgICAgICAgICAgICAgICAgICAgaXNHcm91cDogdHJ1ZVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjdXJyID0gY3Vyci5jaGlsZHJlbltwYXJ0XTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjdXJyLmxheWVycy5wdXNoKGwpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUmVwb3J0cyB3aGF0IGl0IGNoYW5nZWQgLS0ge2NoYW5nZXM6IFt7aWQsIHZpc2libGV9XSwgZ3JvdXBzQ2hhbmdlZH0gLS0gc28gdGhlXHJcbiAgICAvLyBjYWxsZXIgY2FuIHdyaXRlIGJhY2sgZXhhY3RseSB0aG9zZSBmbGlwcyByYXRoZXIgdGhhbiB0aGUgd2hvbGUgbGF5ZXJzIGxpc3QuXHJcbiAgICBjb25zdCBjaGFuZ2VzID0gW107XHJcbiAgICBsZXQgZ3JvdXBzQ2hhbmdlZCA9IGZhbHNlO1xyXG4gICAgZnVuY3Rpb24gZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZiA9IGdyb3VwQ29uZmlnc1tub2RlLnBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNSYWRpb0dyb3VwID0gY29uZi5tdWx0aV9zZWxlY3QgPT09IGZhbHNlO1xyXG4gICAgICAgIGlmIChpc1JhZGlvR3JvdXApIHtcclxuICAgICAgICAgICAgbGV0IGZvdW5kQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkR3JvdXAgPSBub2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3Vwc0NoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBseXIudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGU6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZS5jaGlsZHJlbltrZXldKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXModHJlZSk7XHJcbiAgICByZXR1cm4geyBjaGFuZ2VzLCBncm91cHNDaGFuZ2VkIH07XHJcbn1cclxuXHJcbi8vIGBjdHhgIGlzIHdoYXQgdGhlIHNpZGViYXIgbmVlZHMgZnJvbSBpdHMgaG9zdCwgaGFuZGVkIGluIHJhdGhlciB0aGFuIHJlYWNoZWQgZm9yOlxyXG4vLyAgIGdyb3VwQ29uZmlncyAgICAgICAgICAgdGhlIGZvbGRlciBmbGFncyAobXV0YXRlZCBpbiBwbGFjZSBhcyB0aGUgdHJlZSB0b2dnbGVzKVxyXG4vLyAgIGNvb3JkaW5hdGVCdWZmZXJzICAgICAgdGhlIGxpdmUgYnVmZmVyIG1hcCwgZm9yIGZpdHRpbmcgYSB0b2dnbGVkIG5vZGVcclxuLy8gICBvbkxheWVyV3JpdGUoY2hhbmdlcykgIHRhcmdldGVkIHZpc2liaWxpdHkgZmxpcHMgdG8gc2VuZCBvblxyXG4vLyAgIG9uR3JvdXBDb25maWdzQ2hhbmdlKGdyb3VwQ29uZmlncykgIHRoZSBmb2xkZXIgZmxhZ3MgdG8gY29tbWl0XHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJTaWRlYmFyQ29udHJvbHMoc2lkZWJhciwgbGF5ZXJzLCBjdHgsIG1hcCwgb25MYXllclRvZ2dsZSkge1xyXG4gICAgc2lkZWJhci5pbm5lckhUTUwgPSBcIjxiIHN0eWxlPSdmb250LXNpemU6IDEzcHg7IGJvcmRlci1ib3R0b206IDJweCBzb2xpZCAjZWVlOyBwYWRkaW5nLWJvdHRvbTogNHB4OyBkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogOHB4Oyc+TGF5ZXJzIENvbnRyb2w8L2I+XCI7XHJcblxyXG4gICAgY29uc3QgY29sbGFwc2VkUGF0aHMgPSBzaWRlYmFyQ29sbGFwc2VTdGF0ZShzaWRlYmFyKTtcclxuICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IChjdHggJiYgY3R4Lmdyb3VwQ29uZmlncykgfHwge307XHJcblxyXG4gICAgLy8gMS4gQnVpbGQgYSBuZXN0ZWQgaGllcmFyY2hpY2FsIHRyZWUgZnJvbSB0aGUgZmxhdCBsYXllcnMgbGlzdFxyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgcm9vdC1sZXZlbCBjb25maWdzIGRlZmF1bHQgdG8gbXVsdGlfc2VsZWN0OiB0cnVlIGlmIG5vdCBzcGVjaWZpZWRcclxuICAgIGlmICghZ3JvdXBDb25maWdzW1wiXCJdKSB7XHJcbiAgICAgICAgZ3JvdXBDb25maWdzW1wiXCJdID0geyBtdWx0aV9zZWxlY3Q6IHRydWUsIHZpc2libGU6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICBsYXllcnMuZm9yRWFjaChsID0+IHtcclxuICAgICAgICBjb25zdCBwYXRoU3RyID0gbC5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiO1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gcGF0aFN0ci5zcGxpdChcIi9cIik7XHJcbiAgICAgICAgbGV0IGN1cnIgPSB0cmVlO1xyXG4gICAgICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XHJcbiAgICAgICAgcGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcclxuICAgICAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XHJcbiAgICAgICAgICAgIGlmICghY3Vyci5jaGlsZHJlbltwYXJ0XSkge1xyXG4gICAgICAgICAgICAgICAgY3Vyci5jaGlsZHJlbltwYXJ0XSA9IHtcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LFxyXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHJ1bm5pbmdQYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiB7fSxcclxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IFtdLFxyXG4gICAgICAgICAgICAgICAgICAgIGlzR3JvdXA6IHRydWVcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY3VyciA9IGN1cnIuY2hpbGRyZW5bcGFydF07XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY3Vyci5sYXllcnMucHVzaChsKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIDIuIFJlY3Vyc2l2ZSBmdW5jdGlvbiB0byByZW5kZXIgYSB0cmVlIG5vZGVcclxuICAgIGZ1bmN0aW9uIHJlbmRlck5vZGUobm9kZSwgcGFyZW50RWwsIGRlcHRoLCBwYXJlbnROb2RlLCBwYXJlbnRFZmZlY3RpdmVWaXNpYmxlKSB7XHJcblxyXG4gICAgICAgIGlmIChub2RlLnBhdGggPT09IFwiXCIpIHtcclxuICAgICAgICAgICAgLy8gUmVuZGVyIHJvb3QncyBjaGlsZCBncm91cHMgYW5kIGNoaWxkIGxheWVycyBkaXJlY3RseSB3aXRob3V0IGhlYWRlclxyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKG5vZGUuY2hpbGRyZW5ba2V5XSwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBwYXJlbnRFbCwgZGVwdGgsIG5vZGUsIHRydWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaXNHcm91cCA9IG5vZGUuaXNHcm91cCA9PT0gdHJ1ZTtcclxuICAgICAgICBjb25zdCBwYXRoID0gaXNHcm91cCA/IG5vZGUucGF0aCA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgbmFtZSA9IG5vZGUubmFtZTtcclxuICAgICAgICBjb25zdCBpZCA9IGlzR3JvdXAgPyBudWxsIDogbm9kZS5pZDtcclxuXHJcbiAgICAgICAgLy8gRGV0ZXJtaW5lIHNlbGVjdGlvbiB0eXBlIChjaGVja2JveCB2cyByYWRpbykgYmFzZWQgb24gcGFyZW50J3MgbXVsdGlfc2VsZWN0IGNvbmZpZ1xyXG4gICAgICAgIGNvbnN0IHBhcmVudFBhdGggPSBwYXJlbnROb2RlID8gcGFyZW50Tm9kZS5wYXRoIDogXCJcIjtcclxuICAgICAgICBjb25zdCBwYXJlbnRDb25mID0gZ3JvdXBDb25maWdzW3BhcmVudFBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNNdWx0aVNlbGVjdCA9IHBhcmVudENvbmYubXVsdGlfc2VsZWN0ICE9PSBmYWxzZTtcclxuXHJcbiAgICAgICAgY29uc3Qgbm9kZURpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgbm9kZURpdi5zdHlsZS5tYXJnaW5Cb3R0b20gPSBcIjRweFwiO1xyXG5cclxuICAgICAgICBsZXQgc2VsZlZpc2libGUgPSB0cnVlO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHNlbGZWaXNpYmxlID0gcGF0aCA9PT0gXCJCYXNlbWFwc1wiID8gdHJ1ZSA6IChncm91cENvbmZpZ3NbcGF0aF0/LnZpc2libGUgIT09IGZhbHNlKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IG5vZGUudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHNlbGZFZmZlY3RpdmVWaXNpYmxlID0gcGFyZW50RWZmZWN0aXZlVmlzaWJsZSAmJiBzZWxmVmlzaWJsZTtcclxuXHJcbiAgICAgICAgY29uc3QgaGVhZGVyRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZGlzcGxheSA9IFwiZmxleFwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5hbGlnbkl0ZW1zID0gXCJjZW50ZXJcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLnVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUud2Via2l0VXNlclNlbGVjdCA9IFwibm9uZVwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUub3BhY2l0eSA9IFwiMC41XCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5zdHlsZS5jb2xvciA9IFwiIzg4OFwiO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVG9nZ2xlIEV4cGFuZC9Db2xsYXBzZSBhcnJvd1xyXG4gICAgICAgIGxldCB0b2dnbGVFbCA9IG51bGw7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgdG9nZ2xlRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjRweFwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250U2l6ZSA9IFwiMTZweFwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5saW5lSGVpZ2h0ID0gXCIxXCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmRpc3BsYXkgPSBcImlubGluZS1ibG9ja1wiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS50ZXh0QWxpZ24gPSBcImNlbnRlclwiO1xyXG4gICAgICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGNvbGxhcHNlZFBhdGhzW3BhdGhdID09PSB0cnVlO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC50ZXh0Q29udGVudCA9IGlzQ29sbGFwc2VkID8gXCJcdTI1QjhcIiA6IFwiXHUyNUJFXCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKHRvZ2dsZUVsKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCBzcGFjZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLndpZHRoID0gXCIxNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKHNwYWNlcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDaGVja2JveCBvciBSYWRpbyBpbnB1dCBlbGVtZW50XHJcbiAgICAgICAgbGV0IGlucHV0ID0gbnVsbDtcclxuICAgICAgICBpZiAoIWlzR3JvdXAgfHwgcGF0aCAhPT0gXCJCYXNlbWFwc1wiKSB7XHJcbiAgICAgICAgICAgIGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlucHV0XCIpO1xyXG4gICAgICAgICAgICBpbnB1dC50eXBlID0gaXNNdWx0aVNlbGVjdCA/IFwiY2hlY2tib3hcIiA6IFwicmFkaW9cIjtcclxuICAgICAgICAgICAgaW5wdXQubmFtZSA9IGlzTXVsdGlTZWxlY3QgPyAoaXNHcm91cCA/IGBncm91cF8ke3BhdGh9YCA6IGBsYXllcl8ke2lkfWApIDogYHBhcmVudF8ke3BhcmVudFBhdGh9YDtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjZweFwiO1xyXG4gICAgICAgICAgICBpbnB1dC5zdHlsZS5jdXJzb3IgPSBcInBvaW50ZXJcIjtcclxuICAgICAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1twYXRoXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1twYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gZ3JvdXBDb25maWdzW3BhdGhdLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IG5vZGUudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChpbnB1dCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBUZXh0XHJcbiAgICAgICAgY29uc3QgbGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBsYWJlbC50ZXh0Q29udGVudCA9IG5hbWU7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgbGFiZWwuc3R5bGUuZm9udFdlaWdodCA9IFwiYm9sZFwiO1xyXG4gICAgICAgIH1cclxuICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQobGFiZWwpO1xyXG5cclxuICAgICAgICBub2RlRGl2LmFwcGVuZENoaWxkKGhlYWRlckRpdik7XHJcblxyXG4gICAgICAgIC8vIENoaWxkcmVuIERyYXdlciAoZm9yIGdyb3VwcylcclxuICAgICAgICBsZXQgY2hpbGRyZW5EaXYgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuZGlzcGxheSA9IGlzQ29sbGFwc2VkID8gXCJub25lXCIgOiBcImJsb2NrXCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmJvcmRlckxlZnQgPSBcIjFweCBkYXNoZWQgI2NjY1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5tYXJnaW5MZWZ0ID0gXCI1cHhcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUucGFkZGluZ0xlZnQgPSBcIjhweFwiO1xyXG5cclxuICAgICAgICAgICAgLy8gUmVuZGVyIHN1Yi1ncm91cHMgYW5kIGxheWVycyByZWN1cnNpdmVseVxyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKG5vZGUuY2hpbGRyZW5ba2V5XSwgY2hpbGRyZW5EaXYsIGRlcHRoICsgMSwgbm9kZSwgc2VsZkVmZmVjdGl2ZVZpc2libGUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbm9kZS5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShseXIsIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBub2RlRGl2LmFwcGVuZENoaWxkKGNoaWxkcmVuRGl2KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2Ugd2hlbiBjbGlja2luZyBoZWFkZXIgcm93IChiYWNrZ3JvdW5kLCBlbXB0eSBzcGFjZSwgb3IgYXJyb3cpXHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGNvbGxhcHNlZFBhdGhzW3BhdGhdID09PSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbcGF0aF0gPSAhaXNDb2xsYXBzZWQ7XHJcbiAgICAgICAgICAgICAgICBpZiAodG9nZ2xlRWwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0b2dnbGVFbC50ZXh0Q29udGVudCA9ICFpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkcmVuRGl2KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuZGlzcGxheSA9ICFpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIExhYmVsIGNsaWNrIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGxhYmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgICAgIGlmIChpc011bHRpU2VsZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9ICFpbnB1dC5jaGVja2VkO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlucHV0LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KFwiY2hhbmdlXCIpKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBJbnB1dCBjaGFuZ2UgbGlzdGVuZXJcclxuICAgICAgICBpZiAoaW5wdXQpIHtcclxuICAgICAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc0NoZWNrZWQgPSBpbnB1dC5jaGVja2VkO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBGb3IgcmFkaW8gYnV0dG9ucywgb25seSBwcm9jZXNzIHRoZSBzZWxlY3Rpb24gZXZlbnQgKGlnbm9yZSBkZS1zZWxlY3Rpb24gZXZlbnRzKVxyXG4gICAgICAgICAgICAgICAgaWYgKCFpc011bHRpU2VsZWN0ICYmICFpc0NoZWNrZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gRmxpcHBlZCBvbiB0aGUgbGlzdCB0aGlzIHNpZGViYXIgcmVuZGVyZWQgZnJvbSwgbmV2ZXIgbW9kZWwuZ2V0KFwibGF5ZXJzXCIpLlxyXG4gICAgICAgICAgICAgICAgLy8gTGF5ZXJzIGFkZGVkIGFmdGVyIHRoZSB3aWRnZXQgaXMgZGlzcGxheWVkIGFycml2ZSBhcyBwYXRjaGVzIHRoYXQgdXBkYXRlIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gZnJvbnRlbmQncyBsb2NhbCBzdGF0ZSB3aXRob3V0IHRvdWNoaW5nIHRoZSB0cmFpdCwgc28gdGhlIG1vZGVsJ3MgY29weSBpc1xyXG4gICAgICAgICAgICAgICAgLy8gZnJvemVuIGF0IHdoYXRldmVyIHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgY2FycmllZC4gQnVpbGRpbmcgdGhlIHVwZGF0ZSBmcm9tXHJcbiAgICAgICAgICAgICAgICAvLyBpdCBkcm9wcyBldmVyeSBsYXRlciBsYXllcjogdGhlIHRvZ2dsZSBtYXRjaGVzIG5vIGlkLCB3cml0ZXMgdGhlIHN0YWxlIGxpc3RcclxuICAgICAgICAgICAgICAgIC8vIGJhY2ssIGFuZCB0aGUgY2hhbmdlIGhhbmRsZXIgdGhlbiByZXNldHMgbG9jYWwgc3RhdGUgdG8gaXQgLS0gc28gdGhlIGJveFxyXG4gICAgICAgICAgICAgICAgLy8gcmUtY2hlY2tzIGl0c2VsZiBhbmQgdGhlIGxheWVyIG5ldmVyIGhpZGVzLlxyXG4gICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBmbGlwcyBtdXRhdGUgdGhlIHJlbmRlcmVkIGxpc3QgaW4gcGxhY2UgYW5kIHJlYWNoIFB5dGhvbiBhcyBhIHRhcmdldGVkXHJcbiAgICAgICAgICAgICAgICAvLyB3cml0ZSAoc2VuZExheWVyV3JpdGUpLCBuZXZlciBieSBzZXR0aW5nIHRoZSBsYXllcnMgdHJhaXQ6IHRoZSBmdWxsXHJcbiAgICAgICAgICAgICAgICAvLyB3cml0ZS1iYWNrIHNjYWxlZCB3aXRoIHRoZSBtYXAgaW5zdGVhZCBvZiB0aGUgY2xpY2suIEF0IDI1IHRyYWNrcyB4IDIwMGtcclxuICAgICAgICAgICAgICAgIC8vIHZlcnRpY2VzIGl0IHdhcyBhIDM2IE1CIGZyYW1lIC0tIHBhc3QgdXZpY29ybidzIDE2IE1CIGRlZmF1bHQgd2Vic29ja2V0XHJcbiAgICAgICAgICAgICAgICAvLyBjYXAsIHNvIHRoZSBzZXJ2ZXIgY2xvc2VkIHRoZSBjb25uZWN0aW9uIGFuZCB0aGUgU2hpbnkgc2Vzc2lvbiBkaWVkIG9uXHJcbiAgICAgICAgICAgICAgICAvLyB0aGUgZmlyc3QgY2hlY2tib3guIFNldHRpbmcgdGhlIHRyYWl0IHdpdGhvdXQgc2F2aW5nIGlzIGp1c3QgYXMgZmF0YWw6XHJcbiAgICAgICAgICAgICAgICAvLyBpdCBzdGF5cyBkaXJ0eSBhbmQgdGhlIG5leHQgc2F2ZV9jaGFuZ2VzIChhbnkgcGFuKSBmbHVzaGVzIGl0LlxyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hhbmdlcyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZmxpcCA9IChseXIsIHZpc2libGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoKGx5ci52aXNpYmxlICE9PSBmYWxzZSkgPT09IHZpc2libGUpIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICBseXIudmlzaWJsZSA9IHZpc2libGU7XHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZSB9KTtcclxuICAgICAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCFpc011bHRpU2VsZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUmFkaW8gYnV0dG9uIGxvZ2ljOiBzZXQgYWxsIHNpYmxpbmdzIHRvIHZpc2libGU9ZmFsc2UsIGFuZCB0aGlzIHRvIHZpc2libGU9dHJ1ZVxyXG4gICAgICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKHBhcmVudE5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2liR3JvdXAgPSBwYXJlbnROb2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkdyb3VwLnBhdGggPT09IHBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU6IGFjdGl2ZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tzaWJHcm91cC5wYXRoXSA9ICFhY3RpdmU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50Tm9kZS5sYXllcnMuZm9yRWFjaChzaWJMeXIgPT4gZmxpcChzaWJMeXIsIHNpYkx5ci5pZCA9PT0gaWQpKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2tib3ggbG9naWNcclxuICAgICAgICAgICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3NbcGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBpc0NoZWNrZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbcGF0aF0gPSAhaXNDaGVja2VkO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGx5ciA9IGxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobHlyKSBmbGlwKGx5ciwgaXNDaGVja2VkKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGN0eCAmJiBjdHgub25MYXllcldyaXRlKSBjdHgub25MYXllcldyaXRlKGNoYW5nZXMpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGN0eCAmJiBjdHgub25Hcm91cENvbmZpZ3NDaGFuZ2UpIGN0eC5vbkdyb3VwQ29uZmlnc0NoYW5nZShncm91cENvbmZpZ3MpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0NoZWNrZWQgJiYgbWFwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYm91bmRzID0gZ2V0TGF5ZXJCb3VuZHMobm9kZSwgKGN0eCAmJiBjdHguY29vcmRpbmF0ZUJ1ZmZlcnMpIHx8IHt9KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYm91bmRzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBvbkxheWVyVG9nZ2xlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQobm9kZURpdik7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVuZGVyIHRyZWUgZnJvbSByb290IG5vZGVcclxuICAgIHJlbmRlck5vZGUodHJlZSwgc2lkZWJhciwgMCwgbnVsbCwgdHJ1ZSk7XHJcbn1cclxuIiwgIi8vIExheWVyLXN0YXRlIGZ1bmN0aW9uczogdmlzaWJpbGl0eSwgYnVja2V0aW5nLCBhbmQgcGF0Y2ggYXBwbGljYXRpb24uXG4vL1xuLy8gUHVyZSBkYXRhIGluLCBkYXRhIG91dCAtLSBubyBtYXAsIG5vIERPTSwgbm8gaG9zdC4gVGhpcyBpcyB0aGUgcGFydCBvZiB0aGUgY29yZVxuLy8gdGhhdCBldmVyeSBjb25zdW1lciBzaGFyZXMgdmVyYmF0aW06IHRoZSBhbnl3aWRnZXQgd2lkZ2V0LCBhIHN0YXRpYyBleHBvcnQgYW5kIGFcbi8vIFJlYWN0IGFwcCBhbGwgYXBwbHkgdGhlIHNhbWUgcGF0Y2ggb3BzIHRvIHRoZSBzYW1lIHtsYXllcnMsIGJ1ZmZlcnN9IHN0YXRlLlxuXG4vLyBUcnVlIGlmIGEgbGF5ZXIgaXMgdmlzaWJsZSBhbmQgbm8gZm9sZGVyIGFib3ZlIGl0IGlzIHN3aXRjaGVkIG9mZi5cbi8vXG4vLyBWaXNpYmlsaXR5IGlzIGluaGVyaXRlZCBkb3duIHRoZSBmb2xkZXIgcGF0aDogYSBsYXllciBpbnNpZGUgXCJGZWVkcy9BY3RpdmVcIiBpcyBoaWRkZW5cbi8vIHdoZW4gZWl0aGVyIFwiRmVlZHNcIiBvciBcIkZlZWRzL0FjdGl2ZVwiIGlzIG9mZiwgcmVnYXJkbGVzcyBvZiBpdHMgb3duIGZsYWcuIEdldHRpbmcgdGhpc1xuLy8gd3Jvbmcgc2hvd3MgdXAgYXMgXCJ0aGF0IGxheWVyIGp1c3Qgd2lsbCBub3QgYXBwZWFyXCIsIHdpdGggbm90aGluZyBsb2dnZWQuXG5leHBvcnQgZnVuY3Rpb24gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncykge1xuICAgIGlmIChsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XG4gICAgZm9yIChjb25zdCBwYXJ0IG9mIChsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5zcGxpdChcIi9cIikpIHtcbiAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGdyb3VwQ29uZmlnc1tydW5uaW5nUGF0aF07XG4gICAgICAgIGlmIChjb25maWcgJiYgY29uZmlnLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufVxuXG4vLyBTb3J0cyB0aGUgdmlzaWJsZSBsYXllcnMgaW50byBvbmUgYnVja2V0IHBlciBXZWJHTCBkcmF3IHBhc3MuXG4vL1xuLy8gU3ViLWxheWVycyBvZiBhIG1lcmdlZCBncm91cCBpbmhlcml0IHRoZWlyIHBhcmVudCdzIHZpc2liaWxpdHkgcmF0aGVyIHRoYW4gY2Fycnlpbmdcbi8vIHRoZWlyIG93biwgc28gYSBncm91cCB0b2dnbGVkIG9mZiBjb250cmlidXRlcyBub3RoaW5nIGV2ZW4gd2hlbiBpdHMgY2hpbGRyZW4gc2F5XG4vLyB2aXNpYmxlLiBDaXJjbGVzIGpvaW4gdGhlIHBvbHlnb24gYnVja2V0OiB0aGV5IGFyZSBkcmF3biBhcyBnZW5lcmF0ZWQgcmluZ3MuXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3QgYnVja2V0cyA9IHsgY2lyY2xlX21hcmtlcnM6IFtdLCBtYXJrZXJzOiBbXSwgcG9seWxpbmU6IFtdLCBwb2x5Z29uOiBbXSB9O1xuXG4gICAgZnVuY3Rpb24gY29sbGVjdChsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWJMYXllcikge1xuICAgICAgICBpZiAoIXBhcmVudFZpc2libGUpIHJldHVybjtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGxheWVyLmxheWVycy5mb3JFYWNoKHN1YiA9PiBjb2xsZWN0KHN1YiwgcGFyZW50VmlzaWJsZSwgdHJ1ZSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghaXNTdWJMYXllciAmJiBsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGJ1Y2tldCA9IGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIgPyBcInBvbHlnb25cIiA6IGxheWVyLnR5cGU7XG4gICAgICAgIGlmIChidWNrZXRzW2J1Y2tldF0pIGJ1Y2tldHNbYnVja2V0XS5wdXNoKGxheWVyKTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xuICAgICAgICBjb2xsZWN0KGxheWVyLCBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSwgZmFsc2UpO1xuICAgIH1cbiAgICByZXR1cm4gYnVja2V0cztcbn1cblxuLy8gQXBwbGllcyBpbmNyZW1lbnRhbCBwYXRjaCBvcHMgdG8ge2xheWVycywgYnVmZmVyc30sIHJldHVybmluZyB0aGUgbmV3IHN0YXRlLlxuLy9cbi8vIE9wcyBhcmUgYWRkcmVzc2VkIGJ5IGxheWVyIGlkIGFuZCBhcHBsaWVkIGlkZW1wb3RlbnRseTogXCJhZGRcIiB1cHNlcnRzIHJhdGhlciB0aGFuXG4vLyBhcHBlbmRpbmcgYmxpbmRseSwgc28gYSBwYXRjaCB0aGF0IHJhY2VzIHRoZSBpbml0aWFsIHRyYWl0IHNuYXBzaG90IGNhbm5vdCBkdXBsaWNhdGVcbi8vIGEgbGF5ZXIsIGFuZCBhIFwicmVtb3ZlXCIgZm9yIHNvbWV0aGluZyBhbHJlYWR5IGdvbmUgaXMgYSBuby1vcC5cbi8vIEFwcGxpZXMgYHVwZGF0ZWAgdG8gb25lIGxheWVyIHdoZXJldmVyIGl0IHNpdHMsIGRlc2NlbmRpbmcgaW50byBncm91cHMuIGFkZF9jb2xsZWN0aW9uXG4vLyBuZXN0cyBpdHMgcG9pbnQsIGxpbmUgYW5kIHBvbHlnb24gbGF5ZXJzIGluc2lkZSBhIGdyb3VwIGxheWVyLCBzbyBhbiBvcCBhZGRyZXNzZWQgYXQgYVxuLy8gbmVzdGVkIGlkIHdvdWxkIG90aGVyd2lzZSBtYXRjaCBub3RoaW5nIGFuZCBzaWxlbnRseSBkbyBub3RoaW5nLiBSZXR1cm5zIHRoZSBvcmlnaW5hbFxuLy8gYXJyYXkgdW50b3VjaGVkIHdoZW4gdGhlIGlkIGlzIG5vdCBmb3VuZCwgc28gYW4gdW5tYXRjaGVkIG9wIGNvc3RzIG5vIHJlLXJlbmRlci5cbmZ1bmN0aW9uIHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIGlkLCB1cGRhdGUpIHtcbiAgICBsZXQgaGl0ID0gZmFsc2U7XG4gICAgY29uc3QgbmV4dCA9IGxheWVycy5tYXAobCA9PiB7XG4gICAgICAgIGlmIChsLmlkID09PSBpZCkge1xuICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgIHJldHVybiB1cGRhdGUobCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIEFycmF5LmlzQXJyYXkobC5sYXllcnMpKSB7XG4gICAgICAgICAgICBjb25zdCBzdWJzID0gdXBkYXRlTGF5ZXJCeUlkKGwubGF5ZXJzLCBpZCwgdXBkYXRlKTtcbiAgICAgICAgICAgIGlmIChzdWJzICE9PSBsLmxheWVycykge1xuICAgICAgICAgICAgICAgIGhpdCA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4ubCwgbGF5ZXJzOiBzdWJzIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGw7XG4gICAgfSk7XG4gICAgcmV0dXJuIGhpdCA/IG5leHQgOiBsYXllcnM7XG59XG5cbi8vIEV2ZXJ5IHBvaW50IGxheWVyLCB2aXNpYmxlIG9yIG5vdCwgd2l0aCBpdHMgZWZmZWN0aXZlIHZpc2liaWxpdHkgcmVjb3JkZWQgLS0gdGhlXG4vLyBHUFUtdmlzaWJpbGl0eSBwYXRoIGtlZXBzIGhpZGRlbiBsYXllcnMgaW4gdGhlIGJ1Y2tldCAoc3RhYmxlIGlkcywgbm8gcmVidWlsZCBvbiBhXG4vLyB0b2dnbGUpIGFuZCBoaWRlcyB0aGVtIHdpdGggYSB1bmlmb3JtIGluc3RlYWQuIE1pcnJvcnMgY29sbGVjdFdlYmdsTGF5ZXJzJyBydWxlczpcbi8vIHN1Yi1sYXllcnMgaW5oZXJpdCB0aGVpciBwYXJlbnQncyBlZmZlY3RpdmUgdmlzaWJpbGl0eSwgdG9wLWxldmVsIGxheWVycyBhbnN3ZXIgZm9yXG4vLyB0aGVpciBvd24gZmxhZyBhbmQgdGhlaXIgZm9sZGVyIGNoYWluLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncykge1xuICAgIGNvbnN0IG91dCA9IHsgY2lyY2xlX21hcmtlcnM6IFtdLCBtYXJrZXJzOiBbXSwgcG9seWxpbmU6IFtdLCBwb2x5Z29uOiBbXSB9O1xuICAgIGZ1bmN0aW9uIHdhbGsobGF5ZXIsIHBhcmVudFZpc2libGUsIGlzU3ViKSB7XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBjb25zdCBzZWxmVmlzID0gcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIGxheWVyLmxheWVycy5mb3JFYWNoKHN1YiA9PiB3YWxrKHN1Yiwgc2VsZlZpcywgdHJ1ZSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGJ1Y2tldCA9IGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIgPyBcInBvbHlnb25cIiA6IGxheWVyLnR5cGU7XG4gICAgICAgIGlmICghb3V0W2J1Y2tldF0pIHJldHVybjtcbiAgICAgICAgY29uc3QgdmlzID0gaXNTdWIgPyBwYXJlbnRWaXNpYmxlXG4gICAgICAgICAgICA6IHBhcmVudFZpc2libGUgJiYgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgIG91dFtidWNrZXRdLnB1c2goeyBsYXllciwgdmlzIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykgd2FsayhsYXllciwgdHJ1ZSwgZmFsc2UpO1xuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIEJ1ZmZlciBpZGVudGl0eSBmb3IgdGhlIEdMIG1ldGEga2V5LiBBIG5ldyBEYXRhVmlldyB1bmRlciBhIGxheWVyIGlkIC0tIGFcbi8vIGJ1ZmZlciBvcCBmcm9tIHVwZGF0ZV9sYXllcihkYXRhPS4uLiksIG9yIHRoZSB0cmFpdCByZXNlZWRlZCAtLSBtdXN0IHJlYnVpbGRcbi8vIHRoZSBidWNrZXQgZXZlbiB3aGVuIHRoZSBieXRlIGxlbmd0aCBpcyB1bmNoYW5nZWQgKHBvaW50cyBtb3ZlZCwgY29sb3Vyc1xuLy8gcmVjb21wdXRlZCkuIFRoZSBzZXJpYWwgaXMgcGVyIG9iamVjdCwgc28gYW4gdW50b3VjaGVkIGJ1ZmZlciBrZWVwcyBpdHMgbnVtYmVyXG4vLyBhbmQgY29zdHMgbm8gcmVidWlsZC4gV29ya3MgZm9yIGFueSBjb25zdW1lciB0aGF0IHN3YXBzIGEgYnVmZmVyLCBQeXRob24gb3Igbm90LlxuY29uc3QgYnVmZmVyU2VyaWFscyA9IG5ldyBXZWFrTWFwKCk7XG5sZXQgbmV4dEJ1ZmZlclNlcmlhbCA9IDE7XG5leHBvcnQgZnVuY3Rpb24gYnVmZmVyU2VyaWFsKGJ1Zikge1xuICAgIGlmICghYnVmIHx8IHR5cGVvZiBidWYgIT09IFwib2JqZWN0XCIpIHJldHVybiAwO1xuICAgIGxldCBzZXJpYWwgPSBidWZmZXJTZXJpYWxzLmdldChidWYpO1xuICAgIGlmICghc2VyaWFsKSB7XG4gICAgICAgIHNlcmlhbCA9IG5leHRCdWZmZXJTZXJpYWwrKztcbiAgICAgICAgYnVmZmVyU2VyaWFscy5zZXQoYnVmLCBzZXJpYWwpO1xuICAgIH1cbiAgICByZXR1cm4gc2VyaWFsO1xufVxuXG5mdW5jdGlvbiBjb25jYXRWaWV3cyhoZWFkLCB0YWlsKSB7XG4gICAgY29uc3Qgb3V0ID0gbmV3IFVpbnQ4QXJyYXkoaGVhZC5ieXRlTGVuZ3RoICsgdGFpbC5ieXRlTGVuZ3RoKTtcbiAgICBvdXQuc2V0KG5ldyBVaW50OEFycmF5KGhlYWQuYnVmZmVyLCBoZWFkLmJ5dGVPZmZzZXQsIGhlYWQuYnl0ZUxlbmd0aCksIDApO1xuICAgIG91dC5zZXQobmV3IFVpbnQ4QXJyYXkodGFpbC5idWZmZXIsIHRhaWwuYnl0ZU9mZnNldCwgdGFpbC5ieXRlTGVuZ3RoKSwgaGVhZC5ieXRlTGVuZ3RoKTtcbiAgICByZXR1cm4gbmV3IERhdGFWaWV3KG91dC5idWZmZXIpO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRSb3dzKGxheWVyLCBvcCkge1xuICAgIGNvbnN0IGJhc2UgPSBvcC5iYXNlIHx8IDA7XG4gICAgY29uc3QgY291bnQgPSBvcC5jb3VudCB8fCAwO1xuICAgIGNvbnN0IGluY29taW5nID0gb3AucHJvcGVydGllcyB8fCB7fTtcbiAgICBjb25zdCBwcm9wcyA9IHsgLi4uKGxheWVyLnByb3BlcnRpZXMgfHwge30pIH07XG4gICAgZm9yIChjb25zdCBrZXkgb2YgbmV3IFNldChbLi4uT2JqZWN0LmtleXMocHJvcHMpLCAuLi5PYmplY3Qua2V5cyhpbmNvbWluZyldKSkge1xuICAgICAgICBjb25zdCBoZWFkID0gQXJyYXkuaXNBcnJheShwcm9wc1trZXldKSA/IHByb3BzW2tleV1cbiAgICAgICAgICAgIDogbmV3IEFycmF5KGJhc2UpLmZpbGwocHJvcHNba2V5XSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHByb3BzW2tleV0pO1xuICAgICAgICBjb25zdCB0YWlsID0gQXJyYXkuaXNBcnJheShpbmNvbWluZ1trZXldKSA/IGluY29taW5nW2tleV0gOiBuZXcgQXJyYXkoY291bnQpLmZpbGwobnVsbCk7XG4gICAgICAgIHByb3BzW2tleV0gPSBoZWFkLmNvbmNhdCh0YWlsKTtcbiAgICB9XG4gICAgY29uc3QgbmV4dCA9IHsgLi4ubGF5ZXIsIHByb3BlcnRpZXM6IHByb3BzIH07XG4gICAgZm9yIChjb25zdCBbZmllbGQsIHRhaWxdIG9mIE9iamVjdC5lbnRyaWVzKG9wLmxpc3RzIHx8IHt9KSkge1xuICAgICAgICBuZXh0W2ZpZWxkXSA9IChBcnJheS5pc0FycmF5KGxheWVyW2ZpZWxkXSkgPyBsYXllcltmaWVsZF0gOiBbXSkuY29uY2F0KHRhaWwpO1xuICAgIH1cbiAgICByZXR1cm4gbmV4dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3dpZnRtYXBQYXRjaChzdGF0ZSwgb3BzLCBidWZmZXJzKSB7XG4gICAgbGV0IGxheWVycyA9IHN0YXRlLmxheWVycyB8fCBbXTtcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcblxuICAgIGZvciAoY29uc3Qgb3Agb2Ygb3BzKSB7XG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBvcC5sYXllcnMgfHwgW107XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7fTtcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJzICYmIGJ1ZmZlcnNbaV0pIGJ1ZmZlck1hcFtpZF0gPSBidWZmZXJzW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICAgICAgICBjb25zdCBpbmNvbWluZyA9IG9wLmxheWVyO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBpbmNvbWluZyA/IGluY29taW5nLmlkIDogb3AuaWQ7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBbLi4ubGF5ZXJzLCBpbmNvbWluZ107XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5tYXAoKGwsIGkpID0+IChpID09PSBpZHggPyBpbmNvbWluZyA6IGwpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzZXRcIikge1xuICAgICAgICAgICAgLy8gRmllbGQtbGV2ZWwgdXBkYXRlLiBcInJlcGxhY2VcIiBjYXJyaWVzIHRoZSB3aG9sZSBsYXllciwgc28gZmxpcHBpbmcgYHZpc2libGVgXG4gICAgICAgICAgICAvLyBvbiBhIDUway1wb2ludCBsYXllciByZXNlbnQgZXZlcnkgcHJvcGVydHkgaXQgaG9sZHMgLS0gaGFsZiBhIG1lZ2FieXRlIHRvXG4gICAgICAgICAgICAvLyBjaGFuZ2Ugb25lIGJvb2xlYW4sIG9uIGV2ZXJ5IGNsaWNrIG9mIGEgY2hlY2tib3guXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoeyAuLi5sLCAuLi4ob3AuZmllbGRzIHx8IHt9KSB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic3R5bGVcIikge1xuICAgICAgICAgICAgLy8gUGVyLWZlYXR1cmUgc3R5bGUgb3ZlcnJpZGVzLCByZXBsYWNlZCB3aG9sZXNhbGUgcmF0aGVyIHRoYW4gbWVyZ2VkOiBhXG4gICAgICAgICAgICAvLyBzZWxlY3Rpb24gZGVzY3JpYmVzIGl0cyBjb21wbGV0ZSBzdGF0ZSwgc28gc2VuZGluZyB7fSBjbGVhcnMgaXQgYW5kIG5vXG4gICAgICAgICAgICAvLyBjYWxsZXIgaGFzIHRvIHRyYWNrIHdoYXQgdGhlIHByZXZpb3VzIGhpZ2hsaWdodCB0b3VjaGVkLlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5sLCBzdHlsZV9vdmVycmlkZXM6IG9wLm92ZXJyaWRlcyB8fCB7fSxcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLmZpbHRlcihsID0+IGwuaWQgIT09IG9wLmlkKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJcIikge1xuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XG4gICAgICAgICAgICBpZiAoYnVmKSBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogYnVmIH07XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX2FwcGVuZFwiKSB7XG4gICAgICAgICAgICAvLyBBIHRhaWwgZm9yIGFuIGV4aXN0aW5nIGJ1ZmZlciAtLSB0aGUgZmVlZCBwcmltaXRpdmUncyB3aXJlIHNoYXBlLFxuICAgICAgICAgICAgLy8gcHJvcG9ydGlvbmFsIHRvIHRoZSBiYXRjaC4gQ29uY2F0ZW5hdGlvbiB5aWVsZHMgYSBORVcgRGF0YVZpZXcsIGFuZFxuICAgICAgICAgICAgLy8gdGhlIEdMIG1ldGEga2V5IGtleXMgb24gYnVmZmVyIGlkZW50aXR5LCBzbyB0aGUgYnVja2V0IHJlYnVpbGRzLlxuICAgICAgICAgICAgY29uc3QgdGFpbCA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tvcC5idWZmZXJfaW5kZXhdO1xuICAgICAgICAgICAgaWYgKHRhaWwpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBoZWFkID0gYnVmZmVyTWFwW29wLmlkXTtcbiAgICAgICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogaGVhZCA/IGNvbmNhdFZpZXdzKGhlYWQsIHRhaWwpIDogdGFpbCB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImFwcGVuZFwiKSB7XG4gICAgICAgICAgICAvLyBOZXcgcm93cyBmb3IgdGhlIHByb3BlcnR5IGxpc3RzIChhbmQgb3RoZXIgcGVyLWZlYXR1cmUgbGlzdHMpLCBhZnRlclxuICAgICAgICAgICAgLy8gdGhlIGV4aXN0aW5nIG9uZXMuIENvbHVtbnMgbWlzc2luZyBvbiBlaXRoZXIgc2lkZSBmaWxsIG51bGwsIGV4YWN0bHlcbiAgICAgICAgICAgIC8vIGFzIHRoZSBQeXRob24gc2lkZSBkb2VzLCBzbyBhIGxhdGVyIHBvcHVwIHJlYWRzIHRoZSBzYW1lIHRhYmxlLlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gYXBwZW5kUm93cyhsLCBvcCkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlcl9yZW1vdmVcIikge1xuICAgICAgICAgICAgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAgfTtcbiAgICAgICAgICAgIGRlbGV0ZSBidWZmZXJNYXBbb3AuaWRdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgbGF5ZXJzLCBidWZmZXJzOiBidWZmZXJNYXAgfTtcbn1cbiIsICIvLyBUaGUgbGVnZW5kOiBkZXJpdmVkIGZyb20gdGhlIHNhbWUgbGF5ZXIgc3RhdGUgZXZlcnl0aGluZyBlbHNlIHJlbmRlcnMgZnJvbSwgd2l0aFxyXG4vLyBkZWNsYXJhdGl2ZSBvdmVycmlkZXMgb24gdG9wLiBEZWxpYmVyYXRlbHkgbW9kZWwtZnJlZSAtLSBwdXJlIGRhdGEgaW4sIERPTSBvdXQgLS1cclxuLy8gc28gYSBwbGFpbi1KUyBjb25zdW1lciBvZiBkaXN0L2luZGV4LmpzIGdldHMgdGhlIHdob2xlIGZlYXR1cmUsIGFuZCB0aGUgYW55d2lkZ2V0XHJcbi8vIGdsdWUgaW4gbWFwLmpzIGlzIGEgZmV3IGxpbmVzLiAoc2lkZWJhci5qcyBzdGlsbCB0YWtlcyBgbW9kZWxgIGFuZCBpcyBmaWxlZCBmb3JcclxuLy8gZXh0cmFjdGlvbjsgdGhpcyBtb2R1bGUgbXVzdCBuZXZlciBuZWVkIHRoYXQgdW5waWNraW5nLilcclxuLy9cclxuLy8gVGhlIHBpcGVsaW5lOiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHdhbGtzIHRoZSBsYXllcnMgaW50b1xyXG4vLyBlbnRyaWVzIChza2lwcGVkIGVudGlyZWx5IHdoZW4gY29uZmlnLmF1dG8gPT09IGZhbHNlKSwgYXBwbGllcyB0aGUgcGVyc2lzdGVudFxyXG4vLyByZW1vdmUtbWF0Y2hlcnMsIGFwcGVuZHMgdGhlIG1hbnVhbCBhZGRzLCBhbmQgcmV0dXJucyBhIHNwZWMgdGhhdCByZW5kZXJMZWdlbmRcclxuLy8gdHVybnMgaW50byBET00uIE5vdGhpbmcgaGVyZSBrbm93cyBhYm91dCBjb2xvcm1hcHM6IHJhbXAvY2F0ZWdvcnkvYmluIGVudHJpZXNcclxuLy8gYXJyaXZlIHdpdGggdGhlaXIgY29sb3VycyBhbHJlYWR5IHJlc29sdmVkIChQeXRob24gcmVzb2x2ZXMgYXQgdGhlIGFkZF8qIGJvdW5kYXJ5LFxyXG4vLyBtYW51YWwgZW50cmllcyBhdCBsZWdlbmRfYWRkKSwgc28gdGhlcmUgaXMgbm8gYW5jaG9yIHRhYmxlIHRvIGRyaWZ0LlxyXG5cclxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9wYXRjaC5qc1wiO1xyXG5cclxuY29uc3QgR0xZUEhTID0ge1xyXG4gICAgY2lyY2xlX21hcmtlcnM6IFwiY2lyY2xlXCIsXHJcbiAgICBtYXJrZXJzOiBcInBpblwiLFxyXG4gICAgcG9seWxpbmU6IFwibGluZVwiLFxyXG4gICAgcG9seWdvbjogXCJwb2x5Z29uXCIsXHJcbiAgICBjaXJjbGU6IFwiY2lyY2xlXCIsXHJcbn07XHJcblxyXG5mdW5jdGlvbiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGtpbmQ6IFwic3dhdGNoXCIsXHJcbiAgICAgICAgbGFiZWw6IGxheWVyLm5hbWUgfHwgXCJMYXllclwiLFxyXG4gICAgICAgIHNoYXBlOiBHTFlQSFNbbGF5ZXIudHlwZV0gfHwgXCJzcXVhcmVcIixcclxuICAgICAgICBjb2xvcjogbGF5ZXIuY29sb3IgfHwgXCIjMzM4OGZmXCIsXHJcbiAgICAgICAgZmlsbENvbG9yOiBsYXllci5maWxsQ29sb3IgfHwgbGF5ZXIuZmlsbF9jb2xvciB8fCBsYXllci5jb2xvciB8fCBcIiMzMzg4ZmZcIixcclxuICAgICAgICBoaWRkZW4sXHJcbiAgICB9O1xyXG59XHJcblxyXG4vLyBBIGRhdGEtZHJpdmVuIGJsb2NrIHJlY29yZGVkIGF0IGFkZCB0aW1lICh7a2luZCwgYW5jaG9yc3xpdGVtc3xlZGdlcytjb2xvcnMsIC4uLn0pXHJcbi8vIGJlY29tZXMgdGhlIGxheWVyJ3MgZW50cnkgYXMtaXM7IHRoZSBsYXllciBvbmx5IGNvbnRyaWJ1dGVzIGxhYmVsIGFuZCB2aXNpYmlsaXR5LlxyXG5mdW5jdGlvbiBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIHtcclxuICAgIHJldHVybiB7IC4uLmxheWVyLmxlZ2VuZCwgbGFiZWw6IGxheWVyLm5hbWUgfHwgXCJMYXllclwiLCBoaWRkZW4gfTtcclxufVxyXG5cclxuZnVuY3Rpb24gZW50cmllc0ZvckxheWVyKGxheWVyLCBncm91cENvbmZpZ3MpIHtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImJhc2VtYXBcIikgcmV0dXJuIFtdO1xyXG4gICAgY29uc3QgaGlkZGVuID0gIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIikge1xyXG4gICAgICAgIC8vIEEgY29sbGVjdGlvbjogb25lIGVudHJ5IHBlciBnZW9tZXRyeSBwYXJ0LCBzYW1lIGxhYmVsIGJ5IGRlc2lnbiAtLSB0aGVcclxuICAgICAgICAvLyBnbHlwaHMgYXJlIHdoYXQgdGVsbCB0aGVtIGFwYXJ0LCBtYXRjaGluZyBob3cgdGhlIHBhcnRzIHJlbmRlci5cclxuICAgICAgICByZXR1cm4gKGxheWVyLmxheWVycyB8fCBbXSlcclxuICAgICAgICAgICAgLmZpbHRlcihzdWIgPT4gR0xZUEhTW3N1Yi50eXBlXSlcclxuICAgICAgICAgICAgLm1hcChzdWIgPT4gc3ViLmxlZ2VuZFxyXG4gICAgICAgICAgICAgICAgPyBibG9ja0VudHJ5KHsgLi4uc3ViLCBuYW1lOiBsYXllci5uYW1lIH0sIGhpZGRlbilcclxuICAgICAgICAgICAgICAgIDogc3dhdGNoRW50cnkoeyAuLi5zdWIsIG5hbWU6IGxheWVyLm5hbWUgfSwgaGlkZGVuKSk7XHJcbiAgICB9XHJcbiAgICBpZiAoIUdMWVBIU1tsYXllci50eXBlXSkgcmV0dXJuIFtdO1xyXG4gICAgY29uc3QgZW50cmllcyA9IFtsYXllci5sZWdlbmQgPyBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIDogc3dhdGNoRW50cnkobGF5ZXIsIGhpZGRlbildO1xyXG4gICAgLy8gcmFkaXVzX2NvbCByZWNvcmRzIGEgc2l6ZSBrZXkgYmVzaWRlIHRoZSBjb2xvdXIgc3Rvcnk6IGJvdGggZW5jb2RpbmdzIG9uIHRoZVxyXG4gICAgLy8gbWFwIGRlc2VydmUgYm90aCBleHBsYW5hdGlvbnMgaW4gdGhlIGxlZ2VuZC5cclxuICAgIGlmIChsYXllci5sZWdlbmRfc2l6ZSkge1xyXG4gICAgICAgIGVudHJpZXMucHVzaCh7IC4uLmxheWVyLmxlZ2VuZF9zaXplLFxyXG4gICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiBsYXllci5sZWdlbmRfc2l6ZS5maWVsZCB8fCBsYXllci5uYW1lIHx8IFwiU2l6ZVwiLCBoaWRkZW4gfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZW50cmllcztcclxufVxyXG5cclxuLy8gSWRlbnRpY2FsIGRhdGEtZHJpdmVuIHBheWxvYWRzIGNvbGxhcHNlIGludG8gb25lIHJvdy4gR3JvdXBpbmcgcG9pbnRzIGJ5IGEgY29sdW1uXHJcbi8vIGdpdmVzIGV2ZXJ5IHN1Yi1sYXllciB0aGUgc2FtZSByYW1wOyBhIHJhbXAgcGVyIHN1Yi1sYXllciBpcyBub2lzZSwgYW5kIHRoZSBmaWVsZFxyXG4vLyBuYW1lIGlzIHRoZSBob25lc3QgbGFiZWwgZm9yIHRoZSBzaGFyZWQgbWFwcGluZy4gVGhlIHN1cnZpdm9yIGtlZXBzIHRoZSBmaXJzdFxyXG4vLyBvY2N1cnJlbmNlJ3MgcG9zaXRpb24gYW5kIGhpZGVzIG9ubHkgd2hlbiBldmVyeSBjb250cmlidXRvciBpcyBoaWRkZW4uXHJcbmZ1bmN0aW9uIHBheWxvYWRLZXkoZW50cnkpIHtcclxuICAgIC8vIElkZW50aXR5IGZpZWxkcyBzdGF5IG91dCBvZiB0aGUga2V5OiB0aGUgd2hvbGUgcG9pbnQgaXMgdGhhdCBlbnRyaWVzIGZyb21cclxuICAgIC8vIERJRkZFUkVOVCBsYXllcnMgY29sbGFwc2Ugd2hlbiB0aGVpciBtYXBwaW5nIHBheWxvYWQgaXMgdGhlIHNhbWUuXHJcbiAgICBjb25zdCB7IGxhYmVsLCBoaWRkZW4sIGxheWVySWQsIGxheWVyLCBncm91cCwgLi4ucGF5bG9hZCB9ID0gZW50cnk7XHJcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocGF5bG9hZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcykge1xyXG4gICAgY29uc3Qgc2VlbiA9IG5ldyBNYXAoKTsgICAvLyBwYXlsb2FkIGtleSAtPiBzdXJ2aXZpbmcgZW50cnlcclxuICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XHJcbiAgICAgICAgZ3JvdXAuZW50cmllcyA9IGdyb3VwLmVudHJpZXMuZmlsdGVyKGVudHJ5ID0+IHtcclxuICAgICAgICAgICAgaWYgKGVudHJ5LmtpbmQgPT09IFwic3dhdGNoXCIpIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICBjb25zdCBrZXkgPSBwYXlsb2FkS2V5KGVudHJ5KTtcclxuICAgICAgICAgICAgY29uc3Qgc3Vydml2b3IgPSBzZWVuLmdldChrZXkpO1xyXG4gICAgICAgICAgICBpZiAoIXN1cnZpdm9yKSB7XHJcbiAgICAgICAgICAgICAgICBzZWVuLnNldChrZXksIGVudHJ5KTtcclxuICAgICAgICAgICAgICAgIGlmIChlbnRyeS5maWVsZCkgZW50cnkubGFiZWwgPSBlbnRyeS5maWVsZDtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHN1cnZpdm9yLmhpZGRlbiA9IHN1cnZpdm9yLmhpZGRlbiAmJiBlbnRyeS5oaWRkZW47XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiBncm91cHM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1hdGNoZXJIaXRzKG1hdGNoZXIsIGVudHJ5LCBncm91cE5hbWUpIHtcclxuICAgIGlmICghbWF0Y2hlcikgcmV0dXJuIGZhbHNlO1xyXG4gICAgbGV0IGNvbnN0cmFpbmVkID0gZmFsc2U7XHJcbiAgICBpZiAobWF0Y2hlci5sYWJlbCAhPSBudWxsKSB7XHJcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xyXG4gICAgICAgIGlmIChlbnRyeS5sYWJlbCAhPT0gbWF0Y2hlci5sYWJlbCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgaWYgKG1hdGNoZXIuZ3JvdXAgIT0gbnVsbCkge1xyXG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAoZ3JvdXBOYW1lICE9PSBtYXRjaGVyLmdyb3VwKSByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBpZiAobWF0Y2hlci5pZCAhPSBudWxsKSB7XHJcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xyXG4gICAgICAgIGlmIChlbnRyeS5sYXllcklkICE9PSBtYXRjaGVyLmlkKSByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29uc3RyYWluZWQ7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHtcclxuICAgIGNvbnN0IGNmZyA9IGNvbmZpZyB8fCB7fTtcclxuICAgIGNvbnN0IGdyb3VwcyA9IFtdO1xyXG4gICAgY29uc3QgYnlOYW1lID0gbmV3IE1hcCgpO1xyXG4gICAgY29uc3QgZ3JvdXBGb3IgPSBuYW1lID0+IHtcclxuICAgICAgICBpZiAoIWJ5TmFtZS5oYXMobmFtZSkpIHtcclxuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IG5hbWUsIGVudHJpZXM6IFtdIH07XHJcbiAgICAgICAgICAgIGJ5TmFtZS5zZXQobmFtZSwgZ3JvdXApO1xyXG4gICAgICAgICAgICBncm91cHMucHVzaChncm91cCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBieU5hbWUuZ2V0KG5hbWUpO1xyXG4gICAgfTtcclxuXHJcbiAgICBpZiAoY2ZnLmF1dG8gIT09IGZhbHNlKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIHtcclxuICAgICAgICAgICAgICAgIGVudHJ5LmxheWVySWQgPSBsYXllci5pZDtcclxuICAgICAgICAgICAgICAgIGlmIChjZmcuc2NvcGUgPT09IFwidmlzaWJsZVwiICYmIGVudHJ5LmhpZGRlbikgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBncm91cEZvcihsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUGVyc2lzdGVudCBzdXBwcmVzc2lvbjogbWF0Y2hlcnMgb3V0bGl2ZSBldmVyeSByZS1kZXJpdmF0aW9uLCB3aGljaCBpcyB0aGVcclxuICAgIC8vIGRpZmZlcmVuY2UgZnJvbSBhIHJlZ2lzdHJ5IHJlbW92ZSB0aGF0IHRoZSBuZXh0IGFkZCB3b3VsZCBqdXN0IHJlcG9wdWxhdGUuXHJcbiAgICBjb25zdCByZW1vdmVzID0gY2ZnLnJlbW92ZSB8fCBbXTtcclxuICAgIGlmIChyZW1vdmVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG4gICAgICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoXHJcbiAgICAgICAgICAgICAgICBlbnRyeSA9PiAhcmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGdyb3VwLm5hbWUpKSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIE1hbnVhbCBlbnRyaWVzOiB0aGUgdXNlcidzIG93biBjbGFpbXMuIHNjb3BlIG5ldmVyIGRyb3BzIHRoZW07IGEgYGxheWVyYFxyXG4gICAgLy8gYmluZGluZyBtYWtlcyBvbmUgZm9sbG93IGEgbGl2ZSBsYXllcidzIHZpc2liaWxpdHkgKGFuZCB2YW5pc2ggd2l0aCBpdCB1bmRlclxyXG4gICAgLy8gc2NvcGUgXCJ2aXNpYmxlXCIpLCBmb3Igd2hlbiBhIG1hbnVhbCByb3cgaXMgcmVhbGx5IGEgcmVsYWJlbGxpbmcuXHJcbiAgICBmb3IgKGNvbnN0IGFkZGVkIG9mIGNmZy5hZGQgfHwgW10pIHtcclxuICAgICAgICBjb25zdCBlbnRyeSA9IHsgaGlkZGVuOiBmYWxzZSwgLi4uYWRkZWQgfTtcclxuICAgICAgICBpZiAoZW50cnkubGF5ZXIgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICBjb25zdCBib3VuZCA9IChsYXllcnMgfHwgW10pLmZpbmQoXHJcbiAgICAgICAgICAgICAgICBsID0+IGwuaWQgPT09IGVudHJ5LmxheWVyIHx8IGwubmFtZSA9PT0gZW50cnkubGF5ZXIpO1xyXG4gICAgICAgICAgICBlbnRyeS5oaWRkZW4gPSAhYm91bmQgfHwgIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGJvdW5kLCBncm91cENvbmZpZ3MgfHwge30pO1xyXG4gICAgICAgICAgICBpZiAoY2ZnLnNjb3BlID09PSBcInZpc2libGVcIiAmJiBlbnRyeS5oaWRkZW4pIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGVudHJ5Lmdyb3VwIHx8IFwiXCIpKSkgY29udGludWU7XHJcbiAgICAgICAgZ3JvdXBGb3IoZW50cnkuZ3JvdXAgfHwgXCJcIikuZW50cmllcy5wdXNoKGVudHJ5KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb3B1bGF0ZWQgPSBncm91cHMuZmlsdGVyKGcgPT4gZy5lbnRyaWVzLmxlbmd0aCA+IDApO1xyXG4gICAgcmV0dXJuIHsgdGl0bGU6IGNmZy50aXRsZSB8fCBcIkxlZ2VuZFwiLCBncm91cHM6IHBvcHVsYXRlZCB9O1xyXG59XHJcblxyXG4vLyAtLS0gcmVuZGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBET00gYnVpbHQgd2l0aCBjcmVhdGVFbGVtZW50L3RleHRDb250ZW50IHRocm91Z2hvdXQ6IGxhYmVscyBhbmQgY2F0ZWdvcnkgdmFsdWVzIGNvbWVcclxuLy8gZnJvbSB1c2VyIGRhdGEgYW5kIG11c3QgbmV2ZXIgYmUgcGFyc2VkIGFzIEhUTUwuXHJcblxyXG5mdW5jdGlvbiBkaXYoc3R5bGVzLCB0ZXh0KSB7XHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZXMpO1xyXG4gICAgaWYgKHRleHQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xyXG4gICAgcmV0dXJuIGVsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnbHlwaChlbnRyeSkge1xyXG4gICAgaWYgKGVudHJ5LnNoYXBlID09PSBcImxpbmVcIikge1xyXG4gICAgICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIyMHB4XCIsIGhlaWdodDogXCI0cHhcIiwgYmFja2dyb3VuZDogZW50cnkuY29sb3IsXHJcbiAgICAgICAgICAgICAgICAgICAgIG1hcmdpblJpZ2h0OiBcIjZweFwiLCBmbGV4OiBcIm5vbmVcIiB9KTtcclxuICAgIH1cclxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJwaW5cIikge1xyXG4gICAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgZWwuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjZweFwiO1xyXG4gICAgICAgIGVsLnN0eWxlLmZsZXggPSBcIm5vbmVcIjtcclxuICAgICAgICBjb25zdCBzdmcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcInN2Z1wiKTtcclxuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwid2lkdGhcIiwgXCIxMlwiKTtcclxuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMTRcIik7XHJcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZShcInZpZXdCb3hcIiwgXCIwIDAgMjQgMjhcIik7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsIFwicGF0aFwiKTtcclxuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImRcIixcclxuICAgICAgICAgICAgXCJNMTIgMEM1LjQgMCAwIDUuNCAwIDEyYzAgOSAxMiAxNiAxMiAxNnMxMi03IDEyLTE2QzI0IDUuNCAxOC42IDAgMTIgMHpcIik7XHJcbiAgICAgICAgcGF0aC5zZXRBdHRyaWJ1dGUoXCJmaWxsXCIsIGVudHJ5LmNvbG9yKTtcclxuICAgICAgICBzdmcuYXBwZW5kQ2hpbGQocGF0aCk7XHJcbiAgICAgICAgZWwuYXBwZW5kQ2hpbGQoc3ZnKTtcclxuICAgICAgICByZXR1cm4gZWw7XHJcbiAgICB9XHJcbiAgICAvLyBjaXJjbGUgLyBwb2x5Z29uIC8gc3F1YXJlOiBmaWxsIGluc2lkZSBhIGJvcmRlciwgd2hpY2ggaXMgaG93IGFyZWFzIGRyYXcuXHJcbiAgICBjb25zdCByYWRpdXMgPSBlbnRyeS5zaGFwZSA9PT0gXCJjaXJjbGVcIiA/IFwiNTAlXCJcclxuICAgICAgICA6IGVudHJ5LnNoYXBlID09PSBcInBvbHlnb25cIiA/IFwiMnB4XCIgOiBcIjBcIjtcclxuICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIxMnB4XCIsIGhlaWdodDogXCIxMnB4XCIsIGJhY2tncm91bmQ6IGVudHJ5LmZpbGxDb2xvcixcclxuICAgICAgICAgICAgICAgICBib3JkZXI6IGAycHggc29saWQgJHtlbnRyeS5jb2xvcn1gLCBib3JkZXJSYWRpdXM6IHJhZGl1cyxcclxuICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGJveFNpemluZzogXCJib3JkZXItYm94XCIgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJhbXBSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XHJcbiAgICBjb25zdCBzdG9wcyA9IChlbnRyeS5hbmNob3JzIHx8IFtdKS5tYXAoKGNvbG9yLCBpLCBhbGwpID0+XHJcbiAgICAgICAgYCR7Y29sb3J9ICR7YWxsLmxlbmd0aCA+IDEgPyAoaSAvIChhbGwubGVuZ3RoIC0gMSkpICogMTAwIDogMH0lYCk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHtcclxuICAgICAgICB3aWR0aDogXCIxMjBweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBib3JkZXJSYWRpdXM6IFwiMnB4XCIsXHJcbiAgICAgICAgYmFja2dyb3VuZEltYWdlOiBgbGluZWFyLWdyYWRpZW50KHRvIHJpZ2h0LCAke3N0b3BzLmpvaW4oXCIsIFwiKX0pYCxcclxuICAgIH0pKTtcclxuICAgIGNvbnN0IGVuZHMgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwganVzdGlmeUNvbnRlbnQ6IFwic3BhY2UtYmV0d2VlblwiLCB3aWR0aDogXCIxMjBweFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgIGZvbnRTaXplOiBcIjExcHhcIiwgY29sb3I6IFwiIzU1NVwiIH0pO1xyXG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhlbnRyeS52bWluKSkpO1xyXG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhlbnRyeS52bWF4KSkpO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGVuZHMpO1xyXG4gICAgcmV0dXJuIHJvdztcclxufVxyXG5cclxuY29uc3QgTUFYX0NBVEVHT1JZX1JPV1MgPSAxMjtcclxuXHJcbmZ1bmN0aW9uIGNhdGVnb3JpZXNSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XHJcbiAgICBjb25zdCBpdGVtcyA9IGVudHJ5Lml0ZW1zIHx8IFtdO1xyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zLnNsaWNlKDAsIE1BWF9DQVRFR09SWV9ST1dTKSkge1xyXG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJnaW5MZWZ0OiBcIjhweFwiIH0pO1xyXG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZ2x5cGgoeyBzaGFwZTogXCJzcXVhcmVcIiwgY29sb3I6IGl0ZW0uY29sb3IsIGZpbGxDb2xvcjogaXRlbS5jb2xvciB9KSk7XHJcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhpdGVtLnZhbHVlKSkpO1xyXG4gICAgICAgIHJvdy5hcHBlbmRDaGlsZChsaW5lKTtcclxuICAgIH1cclxuICAgIGlmIChpdGVtcy5sZW5ndGggPiBNQVhfQ0FURUdPUllfUk9XUykge1xyXG4gICAgICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoeyBtYXJnaW5MZWZ0OiBcIjhweFwiLCBtYXJnaW5Ub3A6IFwiM3B4XCIsIGNvbG9yOiBcIiM1NTVcIiB9LFxyXG4gICAgICAgICAgICBgKyAke2l0ZW1zLmxlbmd0aCAtIE1BWF9DQVRFR09SWV9ST1dTfSBtb3JlYCkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJvdztcclxufVxyXG5cclxuZnVuY3Rpb24gYmluc1JvdyhlbnRyeSkge1xyXG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcclxuICAgIGNvbnN0IGVkZ2VzID0gZW50cnkuZWRnZXMgfHwgW107XHJcbiAgICBjb25zdCBjb2xvcnMgPSBlbnRyeS5jb2xvcnMgfHwgW107XHJcbiAgICBjb25zdCBsYWJlbEZvciA9IGkgPT4gaSA9PT0gMCA/IGA8ICR7ZWRnZXNbMF19YFxyXG4gICAgICAgIDogaSA9PT0gZWRnZXMubGVuZ3RoID8gYFx1MjI2NSAke2VkZ2VzW2VkZ2VzLmxlbmd0aCAtIDFdfWBcclxuICAgICAgICA6IGAke2VkZ2VzW2kgLSAxXX0gXHUyMDEzICR7ZWRnZXNbaV19YDtcclxuICAgIGNvbG9ycy5mb3JFYWNoKChjb2xvciwgaSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJnaW5MZWZ0OiBcIjhweFwiIH0pO1xyXG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZ2x5cGgoeyBzaGFwZTogXCJzcXVhcmVcIiwgY29sb3IsIGZpbGxDb2xvcjogY29sb3IgfSkpO1xyXG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZGl2KHt9LCBsYWJlbEZvcihpKSkpO1xyXG4gICAgICAgIHJvdy5hcHBlbmRDaGlsZChsaW5lKTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHJvdztcclxufVxyXG5cclxuLy8gQSBzaXplIGtleSBpcyBhIHN0YXRlbWVudCwgbm90IGEgZHJhd2luZzogXCJcdTI1Q0Ygc2l6ZSBcdTIyMUQgZmllbGQgKG1pbiBcdTIwMTMgbWF4KVwiLiBUaGUgZ2x5cGhcclxuLy8gaXMgZml4ZWQgYW5kIG5vdGhpbmcgaW4gdGhlIHJvdyBkZXJpdmVzIGZyb20gcmFkaXVzX3JhbmdlIG9yIHRoZSBkYXRhJ3Mgc3ByZWFkIC0tXHJcbi8vIGxlZ2VuZCBDU1MgcGl4ZWxzIGFyZSBub3QgbWFwIHBpeGVscyBhdCBhbnkgem9vbSwgc28gZHJhd24gc2FtcGxlIGNpcmNsZXMgd291bGRcclxuLy8gYXNzZXJ0IGEgcHJlY2lzaW9uIHRoYXQgZG9lcyBub3QgZXhpc3QuIFRoZSByb3cgbmFtZXMgdGhlIGVuY29kaW5nIGFuZCBpdHMgZG9tYWluLlxyXG5mdW5jdGlvbiBzaXplc1JvdyhlbnRyeSkge1xyXG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoeyBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGNvbG9yOiBcIiM2NjZcIiB9LCBcIlx1MjVDRlwiKSk7XHJcbiAgICBjb25zdCByYW5nZSA9IGVudHJ5LnZtaW4gIT0gbnVsbCAmJiBlbnRyeS52bWF4ICE9IG51bGxcclxuICAgICAgICA/IGAgKCR7ZW50cnkudm1pbn0gXHUyMDEzICR7ZW50cnkudm1heH0pYCA6IFwiXCI7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBgc2l6ZSBcdTIyMUQgJHtlbnRyeS5maWVsZCB8fCBlbnRyeS5sYWJlbH0ke3JhbmdlfWApKTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHN3YXRjaFJvdyhlbnRyeSkge1xyXG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChnbHlwaChlbnRyeSkpO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbi8vIENvbGxhcHNlIHN0YXRlLCBwZXIgY29udGFpbmVyIHJhdGhlciB0aGFuIG1vZHVsZSBzY29wZTogdGhlIHNpZGViYXIga2V5cyBpdHNcclxuLy8gY29sbGFwc2VkUGF0aHMgYXQgbW9kdWxlIGxldmVsIGFuZCB0d28gbWFwcyBvbiBvbmUgcGFnZSBzaGFyZSBpdCAtLSBhIGZpbGVkIGJ1Z1xyXG4vLyB0aGlzIGRlbGliZXJhdGVseSBkb2VzIG5vdCBpbmhlcml0LiBLZXllZCBieSBncm91cCBuYW1lLCBzdXJ2aXZpbmcgdGhlIGZ1bGxcclxuLy8gcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXHJcbmNvbnN0IGNvbGxhcHNlZEJ5Q29udGFpbmVyID0gbmV3IFdlYWtNYXAoKTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnRhaW5lci5pbm5lckhUTUwgPSBcIlwiO1xyXG4gICAgY29uc3QgZGltSGlkZGVuID0gb3B0aW9ucy5kaW1IaWRkZW4gIT09IGZhbHNlO1xyXG4gICAgbGV0IGNvbGxhcHNlZCA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xyXG4gICAgaWYgKCFjb2xsYXBzZWQpIHtcclxuICAgICAgICBjb2xsYXBzZWQgPSBuZXcgU2V0KCk7XHJcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgY29sbGFwc2VkKTtcclxuICAgIH1cclxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChkaXYoe1xyXG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxyXG4gICAgICAgIHBhZGRpbmdCb3R0b206IFwiNHB4XCIsIG1hcmdpbkJvdHRvbTogXCI0cHhcIixcclxuICAgIH0sIHNwZWMudGl0bGUpKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIHNwZWMuZ3JvdXBzKSB7XHJcbiAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBncm91cC5uYW1lICYmIGNvbGxhcHNlZC5oYXMoZ3JvdXAubmFtZSk7XHJcbiAgICAgICAgaWYgKGdyb3VwLm5hbWUpIHtcclxuICAgICAgICAgICAgLy8gVGhlIHNpZGViYXIncyBhZmZvcmRhbmNlIGV4YWN0bHk6IGFuIGFycm93IHRoYXQgZm9sZHMgdGhlIHNlY3Rpb24uXHJcbiAgICAgICAgICAgIGNvbnN0IGhlYWRlciA9IGRpdih7IGZvbnRXZWlnaHQ6IFwiYm9sZFwiLCBtYXJnaW5Ub3A6IFwiNnB4XCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsIHVzZXJTZWxlY3Q6IFwibm9uZVwiIH0pO1xyXG4gICAgICAgICAgICBoZWFkZXIudGV4dENvbnRlbnQgPSBgJHtpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwifSAke2dyb3VwLm5hbWV9YDtcclxuICAgICAgICAgICAgaGVhZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKSkgY29sbGFwc2VkLmRlbGV0ZShncm91cC5uYW1lKTtcclxuICAgICAgICAgICAgICAgIGVsc2UgY29sbGFwc2VkLmFkZChncm91cC5uYW1lKTtcclxuICAgICAgICAgICAgICAgIHJlbmRlckxlZ2VuZChjb250YWluZXIsIHNwZWMsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGhlYWRlcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChpc0NvbGxhcHNlZCkgY29udGludWU7XHJcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBncm91cC5lbnRyaWVzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJvdyA9IGVudHJ5LmtpbmQgPT09IFwicmFtcFwiID8gcmFtcFJvdyhlbnRyeSlcclxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxyXG4gICAgICAgICAgICAgICAgOiBlbnRyeS5raW5kID09PSBcImJpbnNcIiA/IGJpbnNSb3coZW50cnkpXHJcbiAgICAgICAgICAgICAgICA6IGVudHJ5LmtpbmQgPT09IFwic2l6ZXNcIiA/IHNpemVzUm93KGVudHJ5KVxyXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hSb3coZW50cnkpO1xyXG4gICAgICAgICAgICAvLyBEaW1tZWQsIG5vdCBkcm9wcGVkOiB1bmRlciBzY29wZSBcImFsbFwiIHRoZSBsZWdlbmQgaXMgdGhlIG1hcCdzIHdob2xlXHJcbiAgICAgICAgICAgIC8vIHZvY2FidWxhcnksIGFuZCB0aGUgZGltIGlzIHdoYXQgc3RpbGwgdGVsbHMgdGhlIGN1cnJlbnQgc2NyZWVuIHN0YXRlLlxyXG4gICAgICAgICAgICBpZiAoZW50cnkuaGlkZGVuICYmIGRpbUhpZGRlbikgcm93LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQocm93KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29udGFpbmVyO1xyXG59XHJcbiIsICJpbXBvcnQgeyBMIH0gZnJvbSBcIi4vbGlicy5qc1wiO1xyXG5leHBvcnQgZnVuY3Rpb24gbG9hZENTUyhpZCwgdXJsKSB7XHJcbiAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xyXG4gICAgICAgIGNvbnN0IGxpbmsgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwibGlua1wiKTtcclxuICAgICAgICBsaW5rLmlkID0gaWQ7XHJcbiAgICAgICAgbGluay5yZWwgPSBcInN0eWxlc2hlZXRcIjtcclxuICAgICAgICBsaW5rLmhyZWYgPSB1cmw7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChsaW5rKTtcclxuICAgIH1cclxufVxyXG5cclxuY29uc3QgYWN0aXZlTG9hZGVycyA9IHt9O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKUyhpZCwgdXJsKSB7XHJcbiAgICBpZiAoYWN0aXZlTG9hZGVyc1tpZF0pIHtcclxuICAgICAgICByZXR1cm4gYWN0aXZlTG9hZGVyc1tpZF07XHJcbiAgICB9XHJcbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcclxuICAgICAgICAgICAgcmVzb2x2ZSgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzY3JpcHRcIik7XHJcbiAgICAgICAgc2NyaXB0LmlkID0gaWQ7XHJcbiAgICAgICAgc2NyaXB0LnNyYyA9IHVybDtcclxuICAgICAgICBzY3JpcHQub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xyXG4gICAgICAgIHNjcmlwdC5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgc2NyaXB0OiAke3VybH1gKSk7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzY3JpcHQpO1xyXG4gICAgfSk7XHJcbiAgICBhY3RpdmVMb2FkZXJzW2lkXSA9IHByb21pc2U7XHJcbiAgICByZXR1cm4gcHJvbWlzZTtcclxufVxyXG5cclxuZnVuY3Rpb24gaGV4VG9SZ2IoaGV4KSB7XHJcbiAgICBpZiAoIWhleCkgcmV0dXJuIG51bGw7XHJcbiAgICBoZXggPSBoZXgucmVwbGFjZSgvXiMvLCAnJyk7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA9PT0gMykge1xyXG4gICAgICAgIGhleCA9IGhleC5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhciArIGNoYXIpLmpvaW4oJycpO1xyXG4gICAgfVxyXG4gICAgaWYgKGhleC5sZW5ndGggIT09IDYpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3QgbnVtID0gcGFyc2VJbnQoaGV4LCAxNik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIHI6ICgobnVtID4+IDE2KSAmIDI1NSkgLyAyNTUsXHJcbiAgICAgICAgZzogKChudW0gPj4gOCkgJiAyNTUpIC8gMjU1LFxyXG4gICAgICAgIGI6IChudW0gJiAyNTUpIC8gMjU1XHJcbiAgICB9O1xyXG59XHJcblxyXG5sZXQgY29sb3JQcm9iZSA9IG51bGw7XHJcblxyXG4vLyBCcm93c2VycyBzaGlwIGEgY29tcGxldGUgQ1NTIGNvbG9yIHBhcnNlciAtLSBldmVyeSBuYW1lZCBjb2xvciwgcmdiKCksIGhzbCgpLCBod2IoKS5cclxuLy8gQm9ycm93IGl0IGluc3RlYWQgb2YgbWFpbnRhaW5pbmcgYSBsb29rdXAgdGFibGUuIFJldHVybnMgbnVsbCBvdXRzaWRlIGEgRE9NIChOb2RlIHRlc3RzKSxcclxuLy8gd2hlcmUgdGhlIGhleCBmYWxsYmFjayBpbiBwYXJzZUNvbG9yIHN0aWxsIGFwcGxpZXMuXHJcbmZ1bmN0aW9uIGNzc0NvbG9yVG9SZ2IodmFsdWUpIHtcclxuICAgIGlmICh0eXBlb2YgZG9jdW1lbnQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsO1xyXG4gICAgaWYgKCFjb2xvclByb2JlKSBjb2xvclByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKS5nZXRDb250ZXh0KFwiMmRcIik7XHJcblxyXG4gICAgLy8gQXNzaWduaW5nIGFuIGludmFsaWQgY29sb3IgbGVhdmVzIGZpbGxTdHlsZSB1bnRvdWNoZWQsIHNvIHByb2JlIGFnYWluc3QgdHdvIGRpZmZlcmVudFxyXG4gICAgLy8gc2VudGluZWxzOiBvbmx5IGEgdmFsdWUgdGhlIGJyb3dzZXIgYWN0dWFsbHkgcGFyc2VkIHByb2R1Y2VzIHRoZSBzYW1lIHJlc3VsdCB0d2ljZS5cclxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjMDAwMDAwXCI7XHJcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xyXG4gICAgY29uc3QgZmlyc3QgPSBjb2xvclByb2JlLmZpbGxTdHlsZTtcclxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjZmZmZmZmXCI7XHJcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xyXG4gICAgaWYgKGZpcnN0ICE9PSBjb2xvclByb2JlLmZpbGxTdHlsZSkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgaWYgKGZpcnN0LnN0YXJ0c1dpdGgoXCIjXCIpKSByZXR1cm4gaGV4VG9SZ2IoZmlyc3QpO1xyXG4gICAgY29uc3QgbWF0Y2ggPSBmaXJzdC5tYXRjaCgvcmdiYT9cXCgoW14pXSspXFwpLyk7XHJcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IHBhcnRzID0gbWF0Y2hbMV0uc3BsaXQoXCIsXCIpLm1hcChwID0+IHBhcnNlRmxvYXQocC50cmltKCkpKTtcclxuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzIHx8IHBhcnRzLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4geyByOiBwYXJ0c1swXSAvIDI1NSwgZzogcGFydHNbMV0gLyAyNTUsIGI6IHBhcnRzWzJdIC8gMjU1IH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbG9yKGNvbG9yU3RyLCBmYWxsYmFja0hleCA9IFwiIzMzODhmZlwiKSB7XHJcbiAgICBpZiAoIWNvbG9yU3RyKSBjb2xvclN0ciA9IGZhbGxiYWNrSGV4O1xyXG4gICAgcmV0dXJuIGNzc0NvbG9yVG9SZ2IoY29sb3JTdHIpXHJcbiAgICAgICAgfHwgaGV4VG9SZ2IoY29sb3JTdHIpXHJcbiAgICAgICAgfHwgY3NzQ29sb3JUb1JnYihmYWxsYmFja0hleClcclxuICAgICAgICB8fCBoZXhUb1JnYihmYWxsYmFja0hleClcclxuICAgICAgICB8fCB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxufVxyXG5cclxuY29uc3QgVVJMX0FUVFJfQkVGT1JFID0gLyg/OmhyZWZ8c3JjKVxccyo9XFxzKlsnXCJdPyQvaTtcclxuY29uc3QgU0FGRV9VUkwgPSAvXig/Omh0dHBzPzpcXC9cXC98bWFpbHRvOnx0ZWw6fGRhdGE6aW1hZ2VcXC98Wy4vIz9dfFtcXHcuLV0rKD86Wy8/I118JCkpL2k7XHJcblxyXG4vLyBQcm9wZXJ0eSB2YWx1ZXMgY29tZSBmcm9tIHVzZXIgZGF0YSBhbmQgZW5kIHVwIGluIGlubmVySFRNTCwgc28gdGhleSBhcmUgZXNjYXBlZC5cclxuLy8gTWFya3VwIHRoZSBhcHAgYXV0aG9yIHdyb3RlICh0ZW1wbGF0ZXMsIHN0eWxlIHN0cmluZ3MpIGlzIGxlZnQgaW50YWN0LlxyXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xyXG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSlcclxuICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoL1wiL2csIFwiJnF1b3Q7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcclxufVxyXG5cclxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXHJcbi8vIGluIGEgVVJMIGF0dHJpYnV0ZSBnZXQgYSBzY2hlbWUgY2hlY2suIENvbnRyb2wgY2hhcmFjdGVycyBhcmUgc3RyaXBwZWQgZmlyc3QgYmVjYXVzZVxyXG4vLyBcImphdmFcXHRzY3JpcHQ6XCIgc3Vydml2ZXMgYSBuYWl2ZSBjb21wYXJpc29uLlxyXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZSkge1xyXG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcclxuICAgIHJldHVybiBTQUZFX1VSTC50ZXN0KGNvbGxhcHNlZCkgPyBTdHJpbmcodmFsdWUpIDogXCJcIjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XHJcbiAgICBjb25zdCB0YXJnZXRGaWVsZHMgPSAoQXJyYXkuaXNBcnJheShmaWVsZHMpICYmIGZpZWxkcy5sZW5ndGgpID8gZmllbGRzIDogT2JqZWN0LmtleXMocHJvcHMpO1xyXG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcclxuICAgIGNvbnN0IGxpbmVzID0gW107XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldEZpZWxkcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XHJcbiAgICAgICAgaWYgKHByb3BzW2ZdID09PSB1bmRlZmluZWQgfHwgcHJvcHNbZl0gPT09IG51bGwpIGNvbnRpbnVlO1xyXG4gICAgICAgIGxpbmVzLnB1c2goYDxiPiR7ZXNjYXBlSHRtbChsYWJlbHNbaV0pfTwvYj46ICR7ZXNjYXBlSHRtbChwcm9wc1tmXSl9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbGluZXMuam9pbihcIjxicj5cIik7XHJcbn1cclxuXHJcbi8vIFwie2NvbHVtbn1cIiBpbnNlcnRzIG9uZSBlc2NhcGVkIHZhbHVlOyBcInsqfVwiIGluc2VydHMgdGhlIGRlZmF1bHQgZmllbGQgbGlzdC5cclxuZnVuY3Rpb24gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XHJcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XHJcbiAgICAgICAgaWYgKGtleSA9PT0gXCIqXCIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcHNba2V5XTtcclxuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSByZXR1cm4gXCJcIjtcclxuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XHJcbiAgICAgICAgcmV0dXJuIGVzY2FwZUh0bWwoVVJMX0FUVFJfQkVGT1JFLnRlc3QocHJlY2VkaW5nKSA/IHNhZmVVcmwodmFsKSA6IHZhbCk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBraW5kKSB7XHJcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGxheWVyW2tpbmQgKyBcIl90ZW1wbGF0ZVwiXTtcclxuICAgIGNvbnN0IGZpZWxkcyA9IGxheWVyW2tpbmQgKyBcIl9maWVsZHNcIl07XHJcbiAgICBjb25zdCBuYW1lcyA9IGxheWVyW2tpbmQgKyBcIl9uYW1lc1wiXTtcclxuICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgPT09IFwic3RyaW5nXCIgJiYgdGVtcGxhdGUpIHtcclxuICAgICAgICByZXR1cm4gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcclxuICAgIH1cclxuICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHdyYXBTdHlsZWQoaHRtbCwgc3R5bGUpIHtcclxuICAgIGlmICghc3R5bGUpIHJldHVybiBodG1sO1xyXG4gICAgcmV0dXJuIGA8ZGl2IHN0eWxlPVwiJHtlc2NhcGVIdG1sKHN0eWxlKX1cIj4ke2h0bWx9PC9kaXY+YDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQb3B1cChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyKSB7XHJcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwicG9wdXBcIik7XHJcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfcG9wdXAgfHwgbGF5ZXIucG9wdXBfZmllbGRzIHx8IGxheWVyLnBvcHVwX3RlbXBsYXRlKSkge1xyXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcclxuICAgICAgICBpZiAobGF5ZXIucG9wdXBfbWF4X3dpZHRoKSBvcHRpb25zLm1heFdpZHRoID0gbGF5ZXIucG9wdXBfbWF4X3dpZHRoO1xyXG4gICAgICAgIEwucG9wdXAob3B0aW9ucylcclxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXHJcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIucG9wdXBfc3R5bGUpKVxyXG4gICAgICAgICAgICAub3Blbk9uKG1hcCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBiaW5kVG9vbHRpcChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyLCBsYXllckluc3RhbmNlKSB7XHJcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwidG9vbHRpcFwiKTtcclxuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF90b29sdGlwIHx8IGxheWVyLnRvb2x0aXBfZmllbGRzIHx8IGxheWVyLnRvb2x0aXBfdGVtcGxhdGUpKSB7XHJcbiAgICAgICAgaWYgKCFsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXAgPSBMLnRvb2x0aXAoeyBkaXJlY3Rpb246ICd0b3AnLCBvZmZzZXQ6IFswLCAtNV0gfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXBcclxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXHJcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIudG9vbHRpcF9zdHlsZSkpXHJcbiAgICAgICAgICAgIC5hZGRUbyhtYXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cclxuLy9cclxuLy8gVGlja3MgYXJlIGdlbmVyYXRlZCBmcm9tIGFuIElTTzg2MDEgcGVyaW9kIHJhdGhlciB0aGFuIHRha2VuIGZyb20gdGhlIG9ic2VydmVkXHJcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxyXG4vLyBlbXB0eSBtYXAgYXQgMDM6MDAgcmVhZHMgYXMgYWJzZW5jZSByYXRoZXIgdGhhbiB0aGUgc2xpZGVyIHNraXBwaW5nIHRoZSBxdWlldCBob3Vycy5cclxuLy9cclxuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXHJcbi8vIGludG8gYSB0aW1lIG1vZGVsLCBhIGNvbnRyb2wsIGFuZCBwZXItbGF5ZXIgYWRhcHRlcnMgdGhhdCByZS1yZW5kZXIgR2VvSlNPTiBwZXIgdGljayAtLVxyXG4vLyB0aGUgYWRhcHRlcnMgYXJlIHVudXNhYmxlIGFnYWluc3QgV2ViR0wgbGF5ZXJzLCB0aGUgbW9kZWwgaXMgYSBmZXcgZG96ZW4gbGluZXMsIGFuZCB0aGVcclxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xyXG4vLyBjYXJyaWVkIGFjcm9zcyBieSBoYW5kLlxyXG5cclxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gTWlycm9ycyBpc192YWxpZF9wZXJpb2QoKSBpbiBzd2lmdG1hcC9sYXllcnMvX3RpbWUucHk7IHRoZSBncmFtbWFyIG11c3Qgbm90IGRyaWZ0LlxyXG5jb25zdCBQRVJJT0RfUkUgPVxyXG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUGVyaW9kKHRleHQpIHtcclxuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xyXG4gICAgaWYgKCFtKSByZXR1cm4gbnVsbDtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcclxuICAgICAgICBob3VyczogKyhtWzVdIHx8IDApLCBtaW51dGVzOiArKG1bNl0gfHwgMCksIHNlY29uZHM6ICsobVs3XSB8fCAwKSxcclxuICAgIH07XHJcbn1cclxuXHJcbi8vIFllYXJzIGFuZCBtb250aHMgbW92ZSB0aHJvdWdoIHRoZSBVVEMgY2FsZW5kYXIgLS0gUDFNIGZyb20gSmFuIDMxIGxhbmRzIHdoZXJlIERhdGVcclxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cclxuZXhwb3J0IGZ1bmN0aW9uIGFkZFBlcmlvZChtcywgcCwgc2lnbiA9IDEpIHtcclxuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShtcyk7XHJcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XHJcbiAgICBpZiAocC5tb250aHMpIGQuc2V0VVRDTW9udGgoZC5nZXRVVENNb250aCgpICsgc2lnbiAqIHAubW9udGhzKTtcclxuICAgIHJldHVybiBkLmdldFRpbWUoKSArIHNpZ24gKiAoKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDBcclxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XHJcbn1cclxuXHJcbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXHJcbi8vIGZpbmFsIG9uZSwgb25lIHBlciBwZXJpb2QuIENhcHBlZCBiZWNhdXNlIGEgbWlzdHlwZWQgUFQxUyBvdmVyIGEgeWVhciBvZiBkYXRhXHJcbi8vIHdvdWxkIG90aGVyd2lzZSBoYW5nIHRoZSB0YWIgYnVpbGRpbmcgYW4gYXJyYXkgb2YgbWlsbGlvbnMuXHJcbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xyXG5cclxuLy8gLS0tIHBlcmlvZCBib3VuZGFyaWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gVGlja3MgYW5jaG9yIHRvIFBFUklPRCBCT1VOREFSSUVTLCBub3QgdG8gdGhlIGRhdGEuIFRoZSBmaXJzdCB0aWNrIGlzIHRoZSBmaXJzdFxyXG4vLyBib3VuZGFyeSBhdCBvciBhZnRlciB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24sIHNvIHRoZSBlYXJsaWVzdCBwb2ludCBzdGlsbCBmYWxsc1xyXG4vLyBpbnNpZGUgdGhlIGhhbGYtb3BlbiB3aW5kb3cgKGZpcnN0VGljayAtIFAsIGZpcnN0VGlja10gLS0gdGhlIGNvbnN0cmFpbnQgdGhhdCBwdXRcclxuLy8gdGhlIGZpcnN0IHRpY2sgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIGhvbGRzIC0tIHdoaWxlIGRhdGEgYXJyaXZpbmcgRUFSTElFUlxyXG4vLyBvbmx5IHByZXBlbmRzIGJvdW5kYXJpZXMgYW5kIG1vdmVzIG5vdGhpbmcgYSB1c2VyIG5vdGVkLiAoQW5jaG9yZWQgdG8gdGhlIGRhdGEsXHJcbi8vIGEgbGF0ZSBvYnNlcnZhdGlvbiBzaGlmdGVkIGV2ZXJ5IHRpY2sgYnkgdGhlIHJlbWFpbmRlciBhbmQgdGhlIG1vbWVudCB0aGUgdXNlclxyXG4vLyB3YXMgbG9va2luZyBhdCBiZWNhbWUgYSBkaWZmZXJlbnQgdGljay4pIFJvdW5kIHRpbWVzIGZhbGwgb3V0IGZvciBmcmVlOiAwMzowMCxcclxuLy8gMDQ6MDAgZm9yIFBUMUgsIG5ldmVyIDAzOjE3LlxyXG4vL1xyXG4vLyBGaXhlZC13aWR0aCBwZXJpb2RzIGFsaWduIHRvIGVwb2NoIG11bHRpcGxlcywgd2Vla3MgdG8gTW9uZGF5IDAwOjAwIFVUQy4gTW9udGhzXHJcbi8vIGFuZCB5ZWFycyBhbGlnbiB0byBtb250aC95ZWFyIHN0YXJ0cyBpbiB0aGUgVVRDIGNhbGVuZGFyLCBpbiBtdWx0aXBsZXMgb2YgdGhlXHJcbi8vIHBlcmlvZCBjb3VudGVkIGZyb20geWVhciAwIChQM006IHF1YXJ0ZXJzKS4gQSBwZXJpb2QgbWl4aW5nIGNhbGVuZGFyIGFuZCBjbG9ja1xyXG4vLyB1bml0cyAoUDFNMUQpIGhhcyBubyBzZW5zaWJsZSBib3VuZGFyeSBncmlkLCBzbyB0aGF0IG9uZSBhbG9uZSBrZWVwcyB0aGUgb2xkXHJcbi8vIGJlaGF2aW91cjogaXRzIGZpcnN0IHRpY2sgc2l0cyBhdCB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24uXHJcbmNvbnN0IE1PTkRBWV9FUE9DSCA9IERhdGUuVVRDKDE5NzAsIDAsIDUpO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGFsaWduVG9QZXJpb2QobXMsIHApIHtcclxuICAgIGNvbnN0IGZpeGVkID0gcGVyaW9kVG9NcyhwKTtcclxuICAgIGNvbnN0IGhhc0Nsb2NrID0gQm9vbGVhbihwLndlZWtzIHx8IHAuZGF5cyB8fCBwLmhvdXJzIHx8IHAubWludXRlcyB8fCBwLnNlY29uZHMpO1xyXG4gICAgaWYgKGZpeGVkKSB7XHJcbiAgICAgICAgY29uc3Qgd2hvbGVXZWVrcyA9IHAud2Vla3MgJiYgIXAuZGF5cyAmJiAhcC5ob3VycyAmJiAhcC5taW51dGVzICYmICFwLnNlY29uZHM7XHJcbiAgICAgICAgY29uc3Qgb3JpZ2luID0gd2hvbGVXZWVrcyA/IE1PTkRBWV9FUE9DSCA6IDA7XHJcbiAgICAgICAgcmV0dXJuIG9yaWdpbiArIE1hdGguY2VpbCgobXMgLSBvcmlnaW4pIC8gZml4ZWQpICogZml4ZWQ7XHJcbiAgICB9XHJcbiAgICBpZiAoKHAueWVhcnMgfHwgcC5tb250aHMpICYmICFoYXNDbG9jaykge1xyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBwLnllYXJzICogMTIgKyBwLm1vbnRocztcclxuICAgICAgICBjb25zdCBkID0gbmV3IERhdGUobXMpO1xyXG4gICAgICAgIGxldCBpbmRleCA9IGQuZ2V0VVRDRnVsbFllYXIoKSAqIDEyICsgZC5nZXRVVENNb250aCgpO1xyXG4gICAgICAgIGlmIChEYXRlLlVUQyhkLmdldFVUQ0Z1bGxZZWFyKCksIGQuZ2V0VVRDTW9udGgoKSwgMSkgPCBtcykgaW5kZXggKz0gMTtcclxuICAgICAgICBpbmRleCA9IE1hdGguY2VpbChpbmRleCAvIHNwYW4pICogc3BhbjtcclxuICAgICAgICByZXR1cm4gRGF0ZS5VVEMoTWF0aC5mbG9vcihpbmRleCAvIDEyKSwgaW5kZXggJSAxMiwgMSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbXM7XHJcbn1cclxuXHJcbi8vIFRoZSB0aWNrIG5lYXJlc3QgdG8gYW4gYWJzb2x1dGUgbW9tZW50IC0tIGhvdyB0aGUgcGxheWhlYWQgc3Vydml2ZXMgYSByZS1nZW5lcmF0ZWRcclxuLy8gc2VyaWVzOiBpdCBpcyBhIE1PTUVOVCB0aGUgdXNlciBjaG9zZSwgbmV2ZXIgYW4gaW5kZXggaW50byBhIGxpc3QgdGhhdCBqdXN0IGdyZXcuXHJcbmV4cG9ydCBmdW5jdGlvbiBuZWFyZXN0VGlja0luZGV4KHRpY2tzLCBtb21lbnQpIHtcclxuICAgIGlmICghdGlja3MubGVuZ3RoIHx8ICFOdW1iZXIuaXNGaW5pdGUobW9tZW50KSkgcmV0dXJuIDA7XHJcbiAgICBsZXQgYmVzdCA9IDA7XHJcbiAgICBsZXQgYmVzdERpc3RhbmNlID0gSW5maW5pdHk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpY2tzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZGlzdGFuY2UgPSBNYXRoLmFicyh0aWNrc1tpXSAtIG1vbWVudCk7XHJcbiAgICAgICAgaWYgKGRpc3RhbmNlIDwgYmVzdERpc3RhbmNlKSB7XHJcbiAgICAgICAgICAgIGJlc3QgPSBpO1xyXG4gICAgICAgICAgICBiZXN0RGlzdGFuY2UgPSBkaXN0YW5jZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYmVzdDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlVGlja3Moc3RhcnRNcywgZW5kTXMsIHApIHtcclxuICAgIGNvbnN0IGZpcnN0ID0gYWxpZ25Ub1BlcmlvZChzdGFydE1zLCBwKTtcclxuICAgIGNvbnN0IHRpY2tzID0gW2ZpcnN0XTtcclxuICAgIGxldCB0ID0gZmlyc3Q7XHJcbiAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xyXG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xyXG4gICAgICAgIHQgPSBhZGRQZXJpb2QodCwgcCk7XHJcbiAgICAgICAgdGlja3MucHVzaCh0KTtcclxuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIHRpbWUgc2xpZGVyIGNhcHBlZCBhdCAke01BWF9USUNLU30gdGlja3M7IGAgK1xyXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XHJcbiAgICByZXR1cm4gdGlja3M7XHJcbn1cclxuXHJcbi8vIC0tLSB3aW5kb3dzIGFuZCBmaWx0ZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2VcclxuLy8gaXMgdmlzaWJsZTsgbnVsbCBhY2N1bXVsYXRlcyBldmVyeXRoaW5nIHNvIGZhcjsgYW4gSVNPIHN0cmluZyB0cmFpbHMgYSBmaXhlZCB3aW5kb3cuXHJcbmV4cG9ydCBmdW5jdGlvbiB3aW5kb3dGb3IodGljaywgZHVyYXRpb25TcGVjLCBwZXJpb2QpIHtcclxuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4geyBzdGFydDogLUluZmluaXR5LCBlbmQ6IHRpY2sgfTtcclxuICAgIH1cclxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xyXG4gICAgaWYgKCFwKSByZXR1cm4geyBzdGFydDogLUluZmluaXR5LCBlbmQ6IHRpY2sgfTtcclxuICAgIHJldHVybiB7IHN0YXJ0OiBhZGRQZXJpb2QodGljaywgcCwgLTEpLCBlbmQ6IHRpY2sgfTtcclxufVxyXG5cclxuLy8gSGFsZi1vcGVuIChzdGFydCwgZW5kXTogYSBmZWF0dXJlIHN0YW1wZWQgZXhhY3RseSBvbiBhIHRpY2sgYm91bmRhcnkgYmVsb25ncyB0byB0aGVcclxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcclxuLy8gZmVhdHVyZXMgdGhhdCBjYXJyaWVkIG5vIHJlYWRhYmxlIHRpbWU7IHRoZXkgc3RheSB2aXNpYmxlIHJhdGhlciB0aGFuIHZhbmlzaGluZy5cclxuZXhwb3J0IGZ1bmN0aW9uIGZlYXR1cmVJbldpbmRvdyhzdGFydE1zLCBlbmRNcywgd2luKSB7XHJcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcclxuICAgIHJldHVybiBlbmRNcyA+IHdpbi5zdGFydCAmJiBzdGFydE1zIDw9IHdpbi5lbmQ7XHJcbn1cclxuXHJcbi8vIFRpbWVzIHRyYXZlbCBhcyBhIEZsb2F0NjRBcnJheSBvZiBpbnRlcmxlYXZlZCBbc3RhcnQsIGVuZF0gcGFpcnMgaW4gdGhlIGJ1ZmZlciBtYXAsXHJcbi8vIHVuZGVyIFwiPGxheWVyIGlkPjo6dGltZXNcIiAtLSB0aGUgc2FtZSB0cmFuc3BvcnQgY29vcmRpbmF0ZXMgdXNlLlxyXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IHJhdyA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tgJHtsYXllci5pZH06OnRpbWVzYF07XHJcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxufVxyXG5cclxuLy8gV2hhdCByZW5kZXJpbmcgdGhyZWFkcyB0aHJvdWdoOiB0aGUgY3VycmVudCB0aWNrIHBsdXMgdGhlIHNoYXJlZCBwZXJpb2QsIG9yIG51bGwgd2hlblxyXG4vLyBubyBzbGlkZXIgaXMgYWN0aXZlLiBFYWNoIGxheWVyIGRlcml2ZXMgaXRzIG93biB3aW5kb3cgZnJvbSB0aGVzZSwgc2luY2UgZHVyYXRpb24gaXNcclxuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cclxuLy9cclxuLy8gV2hldGhlciBhIHdob2xlIGxheWVyIHNob3dzIGF0IHRoZSBjdXJyZW50IHRpY2suIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lXHJcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcclxuLy8gbm90IHRoZSBzbGlkZXIncyB0byBoaWRlLlxyXG4vLyBUaGUgZHVyYXRpb24gYSBsYXllciBzaG93cyByaWdodCBub3cuIEEgd2luZG93IGRyYWdnZWQgb3V0IG9uIHRoZSBiYXIgaXMgYSB1c2VyXHJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcclxuLy8gdXNlciBncmFicyB0aGUgYmFyLCB0aGUgYmFyIHRlbGxzIHRoZSB0cnV0aCBmb3IgZXZlcnl0aGluZy4gU25hcHBpbmcgdGhlIGhhbmRsZSBiYWNrXHJcbi8vIG9udG8gdGhlIHRodW1iIGNsZWFycyB0aGUgb3ZlcnJpZGUgYW5kIGxheWVycyByZXR1cm4gdG8gdGhlaXIgb3duIHNldHRpbmdzLlxyXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xyXG4gICAgcmV0dXJuIHRpbWVTdGF0ZS53aW5kb3cgfHwgKGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5kdXJhdGlvbik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBsYXllckluV2luZG93KGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghbGF5ZXIudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xyXG4gICAgLy8gQSBwZXItdmVydGV4LXRpbWVkIGxpbmUgaG9sZHMgbWFueSBwYWlyczsgb24gdGhpcyB3aG9sZS1sYXllciBwYXRoIGl0IHNob3dzXHJcbiAgICAvLyB3aGlsZSBBTlkgb2YgdGhlbSBpcyBpbiB0aGUgd2luZG93IC0tIHRoZSBHUFUgcGF0aCBpcyB3aGF0IHRyaW1zIHBlciBzZWdtZW50LlxyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIFRoZSBleHRlbnQgb2YgZXZlcnkgdGltZSBsYXllcidzIG9ic2VydmF0aW9ucywgTmFOLWJsaW5kLiBGZWVkcyB0aWNrIGdlbmVyYXRpb24uXHJcbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcclxuICAgIGxldCBtaW4gPSBJbmZpbml0eSwgbWF4ID0gLUluZmluaXR5O1xyXG4gICAgY29uc3QgdmlzaXQgPSAobGlzdCkgPT4gbGlzdC5mb3JFYWNoKGxheWVyID0+IHtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcclxuICAgICAgICBpZiAoIWxheWVyLnRpbWUpIHJldHVybjtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcclxuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XHJcbiAgICAgICAgICAgIGlmICh0aW1lc1tpICsgMV0gPiBtYXgpIG1heCA9IHRpbWVzW2kgKyAxXTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHZpc2l0KGxheWVycyk7XHJcbiAgICByZXR1cm4gbWluID09PSBJbmZpbml0eSA/IG51bGwgOiB7IG1pbiwgbWF4IH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBoYXNUaW1lTGF5ZXJzKGxheWVycykge1xyXG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcclxuICAgICAgICA/IGhhc1RpbWVMYXllcnMobC5sYXllcnMgfHwgW10pXHJcbiAgICAgICAgOiBCb29sZWFuKGwudGltZSkpO1xyXG59XHJcblxyXG4vLyBPbmUgcGxheWJhY2sgc3RlcDogdGhlIG5leHQgaW5kZXggYW5kIHdoZXRoZXIgcGxheWJhY2sgc3Vydml2ZXMgaXQuIFB1cmUgc28gdGhlIGxvb3BcclxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxyXG4vLyB3aXRob3V0IGxvb3Agc3RvcHMgd2hlcmUgaXQgaXMuXHJcbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlKGluZGV4LCBsZW5ndGgsIGxvb3ApIHtcclxuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcclxuICAgIGlmIChsb29wKSByZXR1cm4geyBpbmRleDogMCwgcGxheWluZzogdHJ1ZSB9O1xyXG4gICAgcmV0dXJuIHsgaW5kZXgsIHBsYXlpbmc6IGZhbHNlIH07XHJcbn1cclxuXHJcbi8vIFdoZXJlIHRoZSBjb250cm9sIHNpdHMsIGFzIGlubGluZSBzdHlsZXMgc28gdGhlIGNob2ljZSB0cmF2ZWxzIHdpdGggdGhlIHN0YXRlIHJhdGhlclxyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cclxuLy8gaW5jbHVkaW5nIHRoZSBvbmVzIGEgcG9zaXRpb24gZG9lcyBub3QgdXNlIC0tIHNvIG1vdmluZyB0aGUgY29udHJvbCBjbGVhcnMgdGhlIG9sZFxyXG4vLyBhbmNob3IgaW5zdGVhZCBvZiBhY2N1bXVsYXRpbmcgYm90aC5cclxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcclxuICAgIFwidG9wLWxlZnRcIjogICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxuICAgIFwidG9wLWNlbnRlclwiOiAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcclxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxuICAgIFwibGVmdC1jZW50ZXJcIjogICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcclxuICAgIFwicmlnaHQtY2VudGVyXCI6ICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcclxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxuICAgIFwiYm90dG9tLWNlbnRlclwiOiB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcclxuICAgIFwiYm90dG9tLXJpZ2h0XCI6ICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxufTtcclxuXHJcbmZ1bmN0aW9uIGFwcGx5UG9zaXRpb24oZWwsIHBvc2l0aW9uKSB7XHJcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XHJcbiAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3R5bGVzKSkge1xyXG4gICAgICAgIGVsLnN0eWxlW3Byb3BdID0gdmFsdWU7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xyXG4gICAgcmV0dXJuIG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDE5KS5yZXBsYWNlKFwiVFwiLCBcIiBcIikgKyBcIlpcIjtcclxufVxyXG5cclxuLy8gLS0tIHRoZSB3aW5kb3cgYW5kIHRoZSBydWxlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuLy8gRml4ZWQgbWlsbGlzZWNvbmRzIGZvciBhIHBlcmlvZCwgb3IgbnVsbCB3aGVuIGl0IG1vdmVzIHRocm91Z2ggdGhlIGNhbGVuZGFyIChtb250aHMsXHJcbi8vIHllYXJzKSBhbmQgaGFzIG5vIGZpeGVkIHdpZHRoLiBUaGUgcnVsZXIgYW5kIHRoZSBkcmFnIGdyaWQgbmVlZCBmaXhlZCB3aWR0aHM7IGNhbGVuZGFyXHJcbi8vIHBlcmlvZHMgZmFsbCBiYWNrIHRvIHRoZSB0aWNrIHBvc2l0aW9ucyB0aGVtc2VsdmVzLlxyXG5leHBvcnQgZnVuY3Rpb24gcGVyaW9kVG9NcyhwKSB7XHJcbiAgICBpZiAoIXAgfHwgcC55ZWFycyB8fCBwLm1vbnRocykgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDAgKyBwLmhvdXJzICogMzYwMFxyXG4gICAgICAgICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMDtcclxufVxyXG5cclxuLy8gTWlsbGlzZWNvbmRzIGFzIGFuIElTTzg2MDEgZHVyYXRpb24sIGhvdXJzL21pbnV0ZXMvc2Vjb25kcyBvbmx5IC0tIFBUMjZIIGlzIHZhbGlkIGFuZFxyXG4vLyBhdm9pZHMgY2FsZW5kYXIgdW5pdHMgZW50aXJlbHksIHNvIHdoYXQgdGhlIGRyYWcgd3JpdGVzIGFsd2F5cyBwYXJzZXMgYmFjayBleGFjdGx5LlxyXG5leHBvcnQgZnVuY3Rpb24gbXNUb1BlcmlvZElTTyhtcykge1xyXG4gICAgbGV0IHJlc3QgPSBNYXRoLnJvdW5kKG1zIC8gMTAwMCk7XHJcbiAgICBjb25zdCBoID0gTWF0aC5mbG9vcihyZXN0IC8gMzYwMCk7IHJlc3QgLT0gaCAqIDM2MDA7XHJcbiAgICBjb25zdCBtID0gTWF0aC5mbG9vcihyZXN0IC8gNjApOyByZXN0IC09IG0gKiA2MDtcclxuICAgIGxldCBvdXQgPSBcIlBUXCI7XHJcbiAgICBpZiAoaCkgb3V0ICs9IGAke2h9SGA7XHJcbiAgICBpZiAobSkgb3V0ICs9IGAke219TWA7XHJcbiAgICBpZiAocmVzdCB8fCBvdXQgPT09IFwiUFRcIikgb3V0ICs9IGAke3Jlc3R9U2A7XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBUaGUgcnVsZXIncyBpbmNyZW1lbnQ6IHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBldmVyeSBib3VuZGFyeSB0aGUgdXNlciBjYW4gY2FyZVxyXG4vLyBhYm91dCAtLSB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWQgZHVyYXRpb24uIEFuIGludGVydmFsIG9mIDFoIHdpdGggYVxyXG4vLyAyLjVoIGR1cmF0aW9uIG5lZWRzIDMwLW1pbnV0ZSBtYXJrcyBmb3IgdGhlIGR1cmF0aW9uIHRvIHNpdCBvbiBvbmU7IDFoIGFuZCAyaCBuZWVkIG9ubHlcclxuLy8gdGhlIGhvdXJzLiBcIkxvd2VzdCBkdXJhdGlvblwiIGlzIHRoZSBzcGVjaWFsIGNhc2Ugd2hlcmUgb25lIGRpdmlkZXMgdGhlIG90aGVyLlxyXG5leHBvcnQgZnVuY3Rpb24gZ2NkR3JpZE1zKHBlcmlvZE1zLCBkdXJhdGlvbnNNcykge1xyXG4gICAgY29uc3QgZ2NkID0gKGEsIGIpID0+IChiID8gZ2NkKGIsIGEgJSBiKSA6IGEpO1xyXG4gICAgbGV0IGdyaWQgPSBwZXJpb2RNcztcclxuICAgIGZvciAoY29uc3QgZCBvZiBkdXJhdGlvbnNNcykge1xyXG4gICAgICAgIGlmIChkID4gMCkgZ3JpZCA9IGdjZChncmlkLCBNYXRoLnJvdW5kKGQpKTtcclxuICAgIH1cclxuICAgIHJldHVybiBNYXRoLm1heChncmlkLCAxMDAwKTtcclxufVxyXG5cclxuLy8gRXZlcnkgZmluaXRlIGR1cmF0aW9uIGF0dGFjaGVkIHRvIGEgdGltZSBsYXllciwgaW4gbXMsIGZvciB0aGUgZ3JpZC4gXCJwZXJpb2RcIiBhbmQgbnVsbFxyXG4vLyBjb250cmlidXRlIG5vdGhpbmcgbmV3OyBjYWxlbmRhciBkdXJhdGlvbnMgY2Fubm90IGpvaW4gYSBmaXhlZC1tcyBncmlkIGFuZCBhcmUgc2tpcHBlZC5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllcnMsIHdpbmRvd0lzbykge1xyXG4gICAgY29uc3Qgb3V0ID0gW107XHJcbiAgICBjb25zdCB2aXNpdCA9IGxpc3QgPT4gbGlzdC5mb3JFYWNoKGwgPT4ge1xyXG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIikgcmV0dXJuIHZpc2l0KGwubGF5ZXJzIHx8IFtdKTtcclxuICAgICAgICBjb25zdCBzcGVjID0gbC50aW1lICYmIGwudGltZS5kdXJhdGlvbjtcclxuICAgICAgICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgJiYgc3BlYyAhPT0gXCJwZXJpb2RcIikge1xyXG4gICAgICAgICAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xyXG4gICAgICAgICAgICBpZiAobXMpIG91dC5wdXNoKG1zKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHZpc2l0KGxheWVycyk7XHJcbiAgICBpZiAod2luZG93SXNvKSB7XHJcbiAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHdpbmRvd0lzbykpO1xyXG4gICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG91dDtcclxufVxyXG5cclxuLy8gVGljayBtYXJrcyBmb3IgdGhlIHRyYWNrOiBtYWpvcnMgYXQgZXZlcnkgaW50ZXJ2YWwgYm91bmRhcnkgKHNwYXJzZWx5IGxhYmVsbGVkIHNvIGxvbmdcclxuLy8gdGltZWxpbmVzIHN0YXkgcmVhZGFibGUpLCB1bmxhYmVsbGVkIG1pbm9ycyBhdCB0aGUgZ3JpZCBpbiBiZXR3ZWVuLiBNaW5vciBESVNQTEFZIGlzXHJcbi8vIHRoaW5uZWQgd2hlbiBkZW5zZTsgdGhlIHNuYXAgZ3JpZCBzdGF5cyBleGFjdCwgc28gYSBtYXJrIGlzIGEgZ3VpZGUsIG5vdCBhIGNvbnN0cmFpbnQuXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJ1bGVyKHRpY2tzLCBncmlkTXMsIGZvcm1hdExhYmVsLCB7IG1heExhYmVscyA9IDYsIG1heE1pbm9ycyA9IDI0MCB9ID0ge30pIHtcclxuICAgIGlmICh0aWNrcy5sZW5ndGggPCAyKSByZXR1cm4gW107XHJcbiAgICBjb25zdCB0MCA9IHRpY2tzWzBdLCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcclxuICAgIGNvbnN0IG1hcmtzID0gW107XHJcbiAgICBjb25zdCBsYWJlbEV2ZXJ5ID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRpY2tzLmxlbmd0aCAvIG1heExhYmVscykpO1xyXG4gICAgdGlja3MuZm9yRWFjaCgodCwgaSkgPT4gbWFya3MucHVzaCh7XHJcbiAgICAgICAgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IHRydWUsXHJcbiAgICAgICAgbGFiZWw6IGkgJSBsYWJlbEV2ZXJ5ID09PSAwID8gZm9ybWF0TGFiZWwodCkgOiBudWxsLFxyXG4gICAgfSkpO1xyXG4gICAgaWYgKGdyaWRNcyAmJiBncmlkTXMgPCBzcGFuKSB7XHJcbiAgICAgICAgY29uc3QgdG90YWwgPSBNYXRoLmZsb29yKHNwYW4gLyBncmlkTXMpO1xyXG4gICAgICAgIGNvbnN0IHRoaW4gPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodG90YWwgLyBtYXhNaW5vcnMpKTtcclxuICAgICAgICBmb3IgKGxldCBrID0gMTsgayAqIGdyaWRNcyA8IHNwYW47IGsgKz0gdGhpbikge1xyXG4gICAgICAgICAgICBjb25zdCB0ID0gdDAgKyBrICogZ3JpZE1zO1xyXG4gICAgICAgICAgICBpZiAodGlja3MuaW5jbHVkZXModCkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBtYXJrcy5wdXNoKHsgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IGZhbHNlLCBsYWJlbDogbnVsbCB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbWFya3M7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRUaWNrTGFiZWwobXMsIHBlcmlvZE1zKSB7XHJcbiAgICBjb25zdCBpc28gPSBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKTtcclxuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgNjAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxOSk7XHJcbiAgICBpZiAocGVyaW9kTXMgIT0gbnVsbCAmJiBwZXJpb2RNcyA8IDI0ICogMzYwMCAqIDEwMDApIHJldHVybiBpc28uc2xpY2UoMTEsIDE2KTtcclxuICAgIHJldHVybiBpc28uc2xpY2UoNSwgMTApO1xyXG59XHJcblxyXG4vLyBHbHlwaHMgYXMgaW5saW5lIFNWRyByYXRoZXIgdGhhbiB0ZXh0OiBcIlx1MjFCQlwiIHJlYWRzIGFzIHJlZnJlc2ggLS0gYSBsb29wIHRvZ2dsZSBkcmF3biB3aXRoXHJcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xyXG4vLyB0aGUgcHJlc3NlZCBzdGF0ZSByZXN0eWxlIHRoZW0gZnJvbSBDU1MuXHJcbmNvbnN0IElDT05TID0ge1xyXG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcclxuICAgIHBsYXk6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJsOSA2LTkgNnpcIi8+PC9zdmc+JyxcclxuICAgIHBhdXNlOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAyaDN2MTJINHpNOSAyaDN2MTJIOXpcIi8+PC9zdmc+JyxcclxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXHJcbiAgICBsb29wOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNOCAyYTYgNiAwIDAgMSA1LjY1IDRIMTZsLTIuOCAzLjVMMTAuNCA2aDIuMUE0LjUgNC41IDAgMSAwIDEyLjUgMTBsMS4zLjc1QTYgNiAwIDEgMSA4IDJ6XCIvPjwvc3ZnPicsXHJcbn07XHJcblxyXG4vLyAtLS0gdGhlIGNvbnRyb2wgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gUGxhaW4gRE9NIGluc2lkZSB0aGUgd2lkZ2V0IGNvbnRhaW5lciwgbGlrZSB0aGUgc2lkZWJhcjogbm8gTGVhZmxldCBjb250cm9sIG1hY2hpbmVyeSxcclxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xyXG4vLyBMZWFmbGV0LlRpbWVEaW1lbnNpb24ncyBjb250cm9sIC0tIHN0ZXAvcGxheS9zdGVwL2xvb3AgYXMgYSBqb2luZWQgYnV0dG9uIGJhciwgdGhlbiB0aGVcclxuLy8gZGF0ZSwgc2xpZGVyIGFuZCBzcGVlZCAtLSBzaW5jZSB0aGF0IGlzIHRoZSBzbGlkZXIgdXNlcnMgb2YgdGhlIGZvbGl1bSBhcHBzIGtub3cuXHJcbi8vXHJcbi8vIFRoZSBzbGlkZXIgaXMgYSBjb21wb3NpdGUuIEEgbmF0aXZlIDxpbnB1dCB0eXBlPXJhbmdlPiBzdGF5cyBvbiB0b3AgYXMgdGhlIHRodW1iOiBpdFxyXG4vLyBrZWVwcyBrZXlib2FyZCBhcnJvd3MsIHNjcmVlbiByZWFkZXJzIGFuZCBldmVyeSBleGlzdGluZyB0ZXN0IHdvcmtpbmcsIGFuZCBwbGF5YmFja1xyXG4vLyBkcml2ZXMgaXQgYXMgYmVmb3JlLiBVbmRlcm5lYXRoIHNpdCB0aGUgcGFydHMgYSBuYXRpdmUgaW5wdXQgY2Fubm90IGRyYXc6IHRoZSB3aW5kb3dcclxuLy8gc3BhbiBzaG93aW5nIGV4YWN0bHkgd2hhdCBpbnRlcnZhbCBpcyBvbiB0aGUgbWFwLCBhIHJ1bGVyIHdpdGggbGFiZWxsZWQgaW50ZXJ2YWwgbWFya3NcclxuLy8gYW5kIHVubGFiZWxsZWQgZ2NkIG1pbm9ycywgYW5kIHRoZSB0cmFpbCBoYW5kbGUgLS0gZHJhZyBpdCBiYWNrIHRvIHdpZGVuIHRoZSB3aW5kb3cgZm9yXHJcbi8vIGV2ZXJ5IGxheWVyIGF0IG9uY2UsIGRyb3AgaXQgb250byB0aGUgdGh1bWIgdG8gaGFuZCBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclRpbWVDb250cm9sKGNvbnRhaW5lciwgc3RhdGUsIGhhbmRsZXJzKSB7XHJcbiAgICBsZXQgZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWNvbnRyb2xcIik7XHJcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIGlmIChlbCkgZWwucmVtb3ZlKCk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAoIWVsKSB7XHJcbiAgICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XHJcbiAgICAgICAgZWwuaW5uZXJIVE1MID0gYFxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYnV0dG9uc1wiPlxyXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXBsYXlcIiBhcmlhLWxhYmVsPVwiUGxheVwiPiR7SUNPTlMucGxheX08L2J1dHRvbj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWZ3ZFwiIHRpdGxlPVwiU3RlcCBmb3J3YXJkXCIgYXJpYS1sYWJlbD1cIlN0ZXAgZm9yd2FyZFwiPiR7SUNPTlMuZndkfTwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxyXG4gICAgICAgICAgICA8L3NwYW4+XHJcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sYWJlbFwiPjwvc3Bhbj5cclxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWNrXCI+XHJcbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFzZVwiPjwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGFuXCI+PC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXJ1bGVyXCI+PC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgPGlucHV0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zbGlkZXJcIiB0eXBlPVwicmFuZ2VcIiBtaW49XCIwXCIgc3RlcD1cIjFcIj5cclxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS10cmFpbFwiIHJvbGU9XCJzbGlkZXJcIiB0YWJpbmRleD1cIjBcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgYXJpYS1sYWJlbD1cIlRyYWlsaW5nIHdpbmRvd1wiIHRpdGxlPVwiRHJhZyBiYWNrIHRvIHdpZGVuIHRoZSB0aW1lIHdpbmRvdzsgZHJvcCBvbiB0aGUgdGh1bWIgdG8gY2xlYXJcIj48L3NwYW4+XHJcbiAgICAgICAgICAgIDwvc3Bhbj5cclxuICAgICAgICAgICAgPHNlbGVjdCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc3BlZWRcIiB0aXRsZT1cIlBsYXliYWNrIHNwZWVkXCI+XHJcbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMC41XCI+MC41eDwvb3B0aW9uPlxyXG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjFcIj4xeDwvb3B0aW9uPlxyXG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjJcIj4yeDwvb3B0aW9uPlxyXG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjRcIj40eDwvb3B0aW9uPlxyXG4gICAgICAgICAgICA8L3NlbGVjdD5gO1xyXG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChlbCk7XHJcblxyXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1iYWNrXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBCYWNrKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtZndkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBGb3J3YXJkKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25QbGF5VG9nZ2xlKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25Mb29wVG9nZ2xlKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLFxyXG4gICAgICAgICAgICBlID0+IGhhbmRsZXJzLm9uU3BlZWQocGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkpKTtcclxuICAgICAgICBjb25zdCBzbGlkZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpO1xyXG4gICAgICAgIC8vIGBpbnB1dGAgZmlyZXMgcGVyIGRyYWcgc3RlcCBmb3IgbGl2ZSBzY3J1YmJpbmc7IHRoZSBtb2RlbCB3cml0ZWJhY2sgaXMgdGhlXHJcbiAgICAgICAgLy8gaGFuZGxlcidzIHByb2JsZW0sIHRocm90dGxlZCB0aGVyZSBzbyBkcmFnZ2luZyBkb2VzIG5vdCBmbG9vZCB0aGUga2VybmVsLlxyXG4gICAgICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgZSA9PiBoYW5kbGVycy5vblNlZWsocGFyc2VJbnQoZS50YXJnZXQudmFsdWUsIDEwKSkpO1xyXG5cclxuICAgICAgICBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLm1heCA9IFN0cmluZyhzdGF0ZS50aWNrcy5sZW5ndGggLSAxKTtcclxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuaW5kZXgpO1xyXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxhYmVsXCIpLnRleHRDb250ZW50ID0gZm9ybWF0VVRDKHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XSk7XHJcblxyXG4gICAgY29uc3QgcGxheSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpO1xyXG4gICAgcGxheS5pbm5lckhUTUwgPSBzdGF0ZS5wbGF5aW5nID8gSUNPTlMucGF1c2UgOiBJQ09OUy5wbGF5O1xyXG4gICAgcGxheS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIik7XHJcbiAgICBwbGF5LnRpdGxlID0gc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiO1xyXG5cclxuICAgIC8vIEEgbW9kZSwgbm90IGFuIGFjdGlvbjogcHJlc3NlZCBzdHlsaW5nIGFuZCBhcmlhLXByZXNzZWQgc2F5IFwidGhpcyBzdGF5cyBvblwiLFxyXG4gICAgLy8gd2hlcmUgYSBiYXJlIGljb24gaW52aXRlZCBhIGNsaWNrIGV4cGVjdGluZyBzb21ldGhpbmcgdG8gaGFwcGVuIHJpZ2h0IG5vdy5cclxuICAgIGNvbnN0IGxvb3AgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKTtcclxuICAgIGxvb3AuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCBCb29sZWFuKHN0YXRlLmxvb3ApKTtcclxuICAgIGxvb3Auc2V0QXR0cmlidXRlKFwiYXJpYS1wcmVzc2VkXCIsIFN0cmluZyhCb29sZWFuKHN0YXRlLmxvb3ApKSk7XHJcbiAgICBsb29wLnRpdGxlID0gc3RhdGUubG9vcCA/IFwiTG9vcDogb25cIiA6IFwiTG9vcDogb2ZmXCI7XHJcblxyXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLnNwZWVkIHx8IDEpO1xyXG4gICAgcmVuZGVyVHJhY2soZWwsIHN0YXRlKTtcclxuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcclxuICAgIHJldHVybiBlbDtcclxufVxyXG5cclxuLy8gR2VvbWV0cnkgc2hhcmVkIGJ5IHJlbmRlcmluZyBhbmQgZHJhZ2dpbmc6IHdoZXJlIGEgdGltZSBzaXRzIG9uIHRoZSB0cmFjaywgMC4uMS5cclxuZnVuY3Rpb24gdHJhY2tGcmFjdGlvbih0aWNrcywgdCkge1xyXG4gICAgY29uc3Qgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdGlja3NbMF07XHJcbiAgICBpZiAoc3BhbiA8PSAwKSByZXR1cm4gMTtcclxuICAgIHJldHVybiBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCAodCAtIHRpY2tzWzBdKSAvIHNwYW4pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyVHJhY2soZWwsIHN0YXRlKSB7XHJcbiAgICBjb25zdCB7IHRpY2tzLCBpbmRleCB9ID0gc3RhdGU7XHJcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcclxuICAgIHRyYWNrLl9zdGF0ZSA9IHN0YXRlOyAgICAgIC8vIHRoZSBkcmFnIGhhbmRsZXIgcmVhZHMgdGhlIGZyZXNoZXN0IHN0YXRlIGZyb20gaGVyZVxyXG5cclxuICAgIGNvbnN0IHRodW1iVCA9IHRpY2tzW2luZGV4XTtcclxuICAgIGNvbnN0IHBlcmlvZE1zID0gc3RhdGUucGVyaW9kTXM7XHJcbiAgICBjb25zdCB3aW5kb3dNcyA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiBudWxsO1xyXG4gICAgY29uc3Qgc2hvd25NcyA9IHdpbmRvd01zICE9IG51bGwgPyB3aW5kb3dNcyA6IHBlcmlvZE1zO1xyXG5cclxuICAgIC8vIFRoZSBzcGFuOiB3aGF0IGludGVydmFsIHRoZSBtYXAgaXMgc2hvd2luZyByaWdodCBub3cuIFRoZSBzcGFuIGRlcGljdHMgdGhlIHNoYXJlZFxyXG4gICAgLy8gd2luZG93IC0tIG9uZSBwZXJpb2QgYnkgZGVmYXVsdCAtLSBhbmQgcGVyLWxheWVyIGR1cmF0aW9ucyByZW1haW4gYW4gQVBJIGNvbmNlcm5cclxuICAgIC8vIHVudGlsIGEgZHJhZyBvdmVycmlkZXMgdGhlbSBmb3IgZXZlcnl0aGluZyBhdCBvbmNlLlxyXG4gICAgY29uc3Qgc3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGFuXCIpO1xyXG4gICAgY29uc3QgcmlnaHQgPSB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQpO1xyXG4gICAgY29uc3QgbGVmdCA9IHNob3duTXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHNob3duTXMpIDogMDtcclxuICAgIHNwYW4uc3R5bGUubGVmdCA9IGAkeyhsZWZ0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xyXG4gICAgc3Bhbi5zdHlsZS53aWR0aCA9IGAkeyhNYXRoLm1heCgwLCByaWdodCAtIGxlZnQpICogMTAwKS50b0ZpeGVkKDIpfSVgO1xyXG4gICAgc3Bhbi5jbGFzc0xpc3QudG9nZ2xlKFwib3ZlcnJpZGVcIiwgd2luZG93TXMgIT0gbnVsbCk7XHJcblxyXG4gICAgLy8gVGhlIHRyYWlsIGhhbmRsZSBwYXJrcyBPTiB0aGUgdGh1bWIgd2hlbiBubyBvdmVycmlkZSBpcyBhY3RpdmUgLS0gXCJub3QgZ3JhYmJlZFwiIC0tXHJcbiAgICAvLyBhbmQgc2l0cyBhdCB0aGUgd2luZG93J3Mgc3RhcnQgd2hpbGUgb25lIGlzLiBEcm9wcGluZyBpdCBiYWNrIG9uIHRoZSB0aHVtYiBjbGVhcnMuXHJcbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcclxuICAgIGNvbnN0IGF0ID0gd2luZG93TXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHdpbmRvd01zKSA6IHJpZ2h0O1xyXG4gICAgdHJhaWwuc3R5bGUubGVmdCA9IGAkeyhhdCAqIDEwMCkudG9GaXhlZCgyKX0lYDtcclxuICAgIHRyYWlsLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgd2luZG93TXMgIT0gbnVsbCk7XHJcbiAgICB0cmFpbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLXZhbHVldGV4dFwiLCBzdGF0ZS53aW5kb3cgfHwgXCJubyB0cmFpbGluZyB3aW5kb3dcIik7XHJcbiAgICAvLyBObyBmaXhlZC1tcyBncmlkIChjYWxlbmRhciBwZXJpb2RzKSBtZWFucyBub3RoaW5nIHNlbnNpYmxlIHRvIHNuYXAgdG8uXHJcbiAgICB0cmFpbC5zdHlsZS5kaXNwbGF5ID0gc3RhdGUuZ3JpZE1zID8gXCJcIiA6IFwibm9uZVwiO1xyXG5cclxuICAgIGNvbnN0IHJ1bGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXJ1bGVyXCIpO1xyXG4gICAgY29uc3Qga2V5ID0gYCR7dGlja3NbMF19fCR7dGlja3MubGVuZ3RofXwke3N0YXRlLmdyaWRNc318JHtwZXJpb2RNc31gO1xyXG4gICAgaWYgKHJ1bGVyLl9rZXkgIT09IGtleSkge1xyXG4gICAgICAgIHJ1bGVyLl9rZXkgPSBrZXk7XHJcbiAgICAgICAgcnVsZXIuaW5uZXJIVE1MID0gXCJcIjtcclxuICAgICAgICBmb3IgKGNvbnN0IG1hcmsgb2YgYnVpbGRSdWxlcih0aWNrcywgc3RhdGUuZ3JpZE1zLCB0ID0+IGZvcm1hdFRpY2tMYWJlbCh0LCBwZXJpb2RNcykpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICAgICAgbS5jbGFzc05hbWUgPSBtYXJrLm1ham9yID8gXCJzd2lmdG1hcC10aW1lLW1hcmsgbWFqb3JcIiA6IFwic3dpZnRtYXAtdGltZS1tYXJrXCI7XHJcbiAgICAgICAgICAgIG0uc3R5bGUubGVmdCA9IGAkeyhtYXJrLmZyYWN0aW9uICogMTAwKS50b0ZpeGVkKDIpfSVgO1xyXG4gICAgICAgICAgICBpZiAobWFyay5sYWJlbCkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGFiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgICAgICBsYWIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLW1hcmstbGFiZWxcIjtcclxuICAgICAgICAgICAgICAgIGxhYi50ZXh0Q29udGVudCA9IG1hcmsubGFiZWw7XHJcbiAgICAgICAgICAgICAgICBtLmFwcGVuZENoaWxkKGxhYik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcnVsZXIuYXBwZW5kQ2hpbGQobSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG4vLyBEcmFnZ2luZyB0aGUgdHJhaWwgaGFuZGxlLiBTbmFwcyB0byB0aGUgZ2NkIGdyaWQgc28gZXZlcnkgc3RvcCBpcyBhIGJvdW5kYXJ5IHRoZSBkYXRhXHJcbi8vIG9yIHRoZSBpbnRlcnZhbCBhY3R1YWxseSBuYW1lczsgdGhlIGRpc3RhbmNlIHRvIHRoZSB0aHVtYiwgaW4gd2hvbGUgZ3JpZCBzdGVwcywgSVMgdGhlXHJcbi8vIHdpbmRvdy4gWmVybyBzdGVwcyAtLSBkcm9wcGVkIG9uIHRoZSB0aHVtYiAtLSBjbGVhcnMgdGhlIG92ZXJyaWRlLlxyXG5mdW5jdGlvbiBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKSB7XHJcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcclxuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xyXG5cclxuICAgIGZ1bmN0aW9uIGlzb0Zyb21FdmVudChldikge1xyXG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xyXG4gICAgICAgIGNvbnN0IHJlY3QgPSB0cmFjay5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMgfHwgcmVjdC53aWR0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdW5jbGFtcGVkIG9uIHRoZSBsZWZ0OiB0aGUgd2luZG93IGlzIFwiaG93IGZhciBiYWNrIGZyb20gdGhlXHJcbiAgICAgICAgLy8gbGVhZCBwb2ludFwiLCBhbmQgdGhhdCBtYXkgcmVhY2ggcGFzdCB0aGUgYmFyJ3Mgc3RhcnQgLS0gZXNwZWNpYWxseSB3aGVuIHRoZVxyXG4gICAgICAgIC8vIGxlYWQgc2l0cyBlYXJseSBvbiB0aGUgYmFyIGFuZCBtb3N0IG9mIGl0cyB0cmFpbCBpcyBvZmYtc2NyZWVuLiBDbGFtcGluZyBoZXJlXHJcbiAgICAgICAgLy8gY2FwcGVkIHRoZSB3aW5kb3cgYXQgdGhlIHZpc2libGUgcGFzdCwgd2hpY2ggcGlubmVkIHRoZSBoYW5kbGUgdG8gdGhlIGJhcidzXHJcbiAgICAgICAgLy8gc3RhcnQgYW5kIG1hZGUgYW55dGhpbmcgd2lkZXIgaW1wb3NzaWJsZSB0byBzZXQuIE9ubHkgdGhlIERSQVdJTkcgY2xhbXBzLlxyXG4gICAgICAgIGNvbnN0IGZyYWMgPSBNYXRoLm1pbigxLCAoZXYuY2xpZW50WCAtIHJlY3QubGVmdCkgLyByZWN0LndpZHRoKTtcclxuICAgICAgICBjb25zdCB0MCA9IHN0YXRlLnRpY2tzWzBdO1xyXG4gICAgICAgIGNvbnN0IHNwYW5NcyA9IHN0YXRlLnRpY2tzW3N0YXRlLnRpY2tzLmxlbmd0aCAtIDFdIC0gdDA7XHJcbiAgICAgICAgY29uc3QgdGh1bWJUID0gc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdO1xyXG4gICAgICAgIGNvbnN0IGRpc3QgPSB0aHVtYlQgLSAodDAgKyBmcmFjICogc3Bhbk1zKTtcclxuICAgICAgICBjb25zdCBzdGVwcyA9IE1hdGgubWF4KDAsIE1hdGgucm91bmQoZGlzdCAvIHN0YXRlLmdyaWRNcykpO1xyXG4gICAgICAgIHJldHVybiBzdGVwcyA9PT0gMCA/IG51bGwgOiBtc1RvUGVyaW9kSVNPKHN0ZXBzICogc3RhdGUuZ3JpZE1zKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBNb3ZlIGFuZCByZWxlYXNlIGxpc3RlbiBvbiB0aGUgZG9jdW1lbnQgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgZHJhZzogdGhlIGhhbmRsZVxyXG4gICAgLy8gaXMgMTJweCB3aWRlLCB0aGUgY3Vyc29yIGxlYXZlcyBpdCBvbiB0aGUgZmlyc3QgZmFzdCBtb3ZlbWVudCwgYW5kIGV2ZW50cyB0aGF0XHJcbiAgICAvLyB0YXJnZXQgd2hhdGV2ZXIgaXMgdW5kZXJuZWF0aCB3b3VsZCBzdHV0dGVyIHRoZSBkcmFnIGFuZCBjb3VsZCBzd2FsbG93IHRoZSByZWxlYXNlXHJcbiAgICAvLyBlbnRpcmVseSAtLSBhbiB1bmNvbW1pdHRlZCBkcmFnIHRoZW4gc25hcHMgYmFjayBvbiB0aGUgbmV4dCBzeW5jLlxyXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGV2ID0+IHtcclxuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIC8vIENhcHR1cmUgcmV0YXJnZXRzIGV2ZXJ5IHBvaW50ZXIgZXZlbnQgdG8gdGhlIGhhbmRsZSB1bnRpbCByZWxlYXNlLCBubyBtYXR0ZXJcclxuICAgICAgICAvLyB3aGVyZSB0aGUgY3Vyc29yIGlzLiBXaXRob3V0IGl0LCBsZXR0aW5nIGdvIHdpdGggdGhlIHBvaW50ZXIgb3ZlciB0aGUgbWFwIGhhbmRzXHJcbiAgICAgICAgLy8gcG9pbnRlcnVwIHRvIExlYWZsZXQncyBjb250YWluZXIgaGFuZGxlcnMsIGFuZCBhIHJlbGVhc2UgdGhleSBzd2FsbG93IG5ldmVyXHJcbiAgICAgICAgLy8gcmVhY2hlcyB0aGUgZG9jdW1lbnQgbGlzdGVuZXIgLS0gdGhlIGRyYWcgc3RheXMgdW5jb21taXR0ZWQgYW5kIHRoZSBuZXh0IHN5bmNcclxuICAgICAgICAvLyBzbmFwcyB0aGUgaGFuZGxlIGhvbWUuIFRoZSBkb2N1bWVudCBsaXN0ZW5lcnMgYmVsb3cgcmVtYWluIGFzIHRoZSBmYWxsYmFjayBmb3JcclxuICAgICAgICAvLyBlbnZpcm9ubWVudHMgd2l0aG91dCBjYXB0dXJlOyB3aXRoIGl0LCByZXRhcmdldGVkIGV2ZW50cyBzdGlsbCBidWJibGUgdG8gdGhlbS5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBpZiAodHJhaWwuc2V0UG9pbnRlckNhcHR1cmUpIHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKGV2LnBvaW50ZXJJZCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIHN5bnRoZXRpYyBldmVudHMgaGF2ZSBubyBhY3RpdmUgcG9pbnRlcjsgZmFsbCBiYWNrIHRvIGJ1YmJsaW5nICovIH1cclxuXHJcbiAgICAgICAgY29uc3QgbW92ZSA9IGUgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBpc28gPSBpc29Gcm9tRXZlbnQoZSk7XHJcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBjb25zdCBmaW5pc2ggPSBlID0+IHtcclxuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xyXG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XHJcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcclxuICAgICAgICAgICAgaWYgKGlzbyAhPT0gdW5kZWZpbmVkKSBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChpc28pO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xyXG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgZmluaXNoKTtcclxuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBmaW5pc2gpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gS2V5Ym9hcmQ6IG9uZSBncmlkIHN0ZXAgcGVyIGFycm93LCBEZWxldGUvSG9tZSB0byBjbGVhci4gU2FtZSBjb250cmFjdCBhcyB0aGUgZHJhZy5cclxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGV2ID0+IHtcclxuICAgICAgICBjb25zdCBzdGF0ZSA9IHRyYWNrLl9zdGF0ZTtcclxuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IDA7XHJcbiAgICAgICAgbGV0IG5leHQ7XHJcbiAgICAgICAgaWYgKGV2LmtleSA9PT0gXCJBcnJvd0xlZnRcIikgbmV4dCA9IGN1cnJlbnQgKyBzdGF0ZS5ncmlkTXM7XHJcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkFycm93UmlnaHRcIikgbmV4dCA9IE1hdGgubWF4KDAsIGN1cnJlbnQgLSBzdGF0ZS5ncmlkTXMpO1xyXG4gICAgICAgIGVsc2UgaWYgKGV2LmtleSA9PT0gXCJEZWxldGVcIiB8fCBldi5rZXkgPT09IFwiSG9tZVwiKSBuZXh0ID0gMDtcclxuICAgICAgICBlbHNlIHJldHVybjtcclxuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGhhbmRsZXJzLm9uV2luZG93Q29tbWl0KG5leHQgPiAwID8gbXNUb1BlcmlvZElTTyhuZXh0KSA6IG51bGwpO1xyXG4gICAgfSk7XHJcbn1cclxuIiwgIi8vIFRpbWUgZmlsdGVyaW5nIG9uIHRoZSBHUFUsIGZvciBwb2ludCBsYXllcnMuXHJcbi8vXHJcbi8vIFRoZSBjb29yZGluYXRlcyBhbHJlYWR5IGxpdmUgaW4gR1BVIGJ1ZmZlcnM7IHJlYnVpbGRpbmcgdGhlIG1lcmdlZCBsYXllciBwZXIgdGljayB0aHJld1xyXG4vLyB0aGF0IGF3YXkgYW5kIHJlLWZlZCBnbGlmeSBhbGwgNU0gcG9pbnRzIHRocm91Z2ggSlMgLS0gbWVhc3VyZWQgYXQgfjIuNnMgcGVyIHdpbmRvd1xyXG4vLyBjaGFuZ2UgYXQgdGhhdCBzY2FsZSwgd2l0aCBhbGxvY2F0aW9uIGNodXJuIHRoYXQgY291bGQgY3Jhc2ggdGhlIHRhYiB3aGVuIGNoYW5nZXNcclxuLy8gc3RhY2tlZC4gSW5zdGVhZCwgZWFjaCBwb2ludCdzIHRpbWUgaW50ZXJ2YWwgYW5kIGl0cyBsYXllcidzIGR1cmF0aW9uIHJpZGUgYWxvbmcgYXNcclxuLy8gdmVydGV4IGF0dHJpYnV0ZXMgdXBsb2FkZWQgb25jZSwgYW5kIHRoZSBjdXJyZW50IHRpY2sgaXMgYSB1bmlmb3JtOiBhIHRpY2sgb3Igd2luZG93XHJcbi8vIGNoYW5nZSBjb3N0cyB0d28gZmxvYXRzIGFuZCBhIHJlZHJhdy5cclxuLy9cclxuLy8gZ2xpZnkgbWFrZXMgdGhpcyBwb3NzaWJsZSB3aXRob3V0IGZvcmtpbmcgaXQ6IHZlcnRleFNoYWRlclNvdXJjZSBpcyBhbiBvdmVycmlkYWJsZVxyXG4vLyBzZXR0aW5nICh0aGUgcGluIGZyYWdtZW50IHNoYWRlciBhbHJlYWR5IHVzZXMgdGhlIHNhbWUgZG9vciksIGluc3RhbmNlcyBleHBvc2UgdGhlaXJcclxuLy8gZ2wvcHJvZ3JhbS9jYW52YXMsIGF0dHJpYnV0ZXMgYXJlIGJvdW5kIG9uY2UgYXQgc2V0dXAsIGFuZCB0aGUgcGVyLWZyYW1lIGRyYXcgdG91Y2hlc1xyXG4vLyBvbmx5IHRoZSBtYXRyaXggdW5pZm9ybSAtLSBzbyBleHRyYSBhdHRyaWJ1dGVzIGJvdW5kIGFmdGVyIHNldHVwIHBlcnNpc3QsIGFuZCB1bmlmb3JtXHJcbi8vIHVwZGF0ZXMgdGFrZSBlZmZlY3Qgb24gdGhlIG5leHQgcmVkcmF3LlxyXG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgcGVyaW9kVG9NcywgdGltZXNGb3IgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5cclxuLy8gVGltZXMgdHJhdmVsIGFzIGZsb2F0MzIgb24gdGhlIEdQVSwgd2hvc2UgaW50ZWdlcnMgYXJlIGV4YWN0IG9ubHkgdG8gMl4yNC4gRXBvY2ggbXMgaXNcclxuLy8gaG9wZWxlc3MgYXQgdGhhdCBwcmVjaXNpb24sIHNvIHRpbWVzIGFyZSByZWJhc2VkIHRvIHRoZSBidWNrZXQncyBlYXJsaWVzdCBzdGFydCBhbmRcclxuLy8gZXhwcmVzc2VkIGluIHNlY29uZHM6IGV4YWN0IHRvIH4xOTQgZGF5cyBvZiBzcGFuLCBhbmQgYSAycyByb3VuZGluZyBiZXlvbmQgdGhhdCBpc1xyXG4vLyBpbnZpc2libGUgYXQgYW55IHpvb20gYSB0aW1lIHNsaWRlciBtYWtlcyBzZW5zZSBhdC5cclxuY29uc3QgQUxXQVlTID0gNi4zZTg7ICAgLy8gfjIwIHllYXJzLCBpbiBzZWNvbmRzOiB0aGUgXCJkdXJhdGlvblwiIG9mIGN1bXVsYXRpdmUgbGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgdGhlIHNwYW4gaGFsZi13aWR0aCBvZiBwb2ludHMgd2l0aCBubyByZWFkYWJsZSB0aW1lLlxyXG5cclxuLy8gUGVyLWJ1Y2tldCBsYXllci12aXNpYmlsaXR5IHNsb3RzIGluIHRoZSB2ZXJ0ZXggc2hhZGVyLiBFYWNoIGZsb2F0IGFycmF5IGVsZW1lbnRcclxuLy8gb2NjdXBpZXMgYSBmdWxsIHVuaWZvcm0gdmVjdG9yIGluIEVTIEdMU0wgcGFja2luZywgYW5kIHRoZSBzcGVjIGd1YXJhbnRlZXMgb25seSAxMjhcclxuLy8gdmVydGV4IHVuaWZvcm0gdmVjdG9ycyAtLSA2NCBzbG90cyBsZWF2ZXMgY29tZm9ydGFibGUgcm9vbSBmb3IgdGhlIG1hdHJpeCBhbmQgdGhlIHRpbWVcclxuLy8gdW5pZm9ybXMuIEEgYnVja2V0IHdpdGggbW9yZSBsYXllcnMgdGhhbiBzbG90cyBmYWxscyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRvZ2dsZS5cclxuLy8gKFBhY2tpbmcgZm91ciBsYXllcnMgcGVyIHZlYzQgd291bGQgcXVhZHJ1cGxlIHRoaXMgaWYgYW55b25lIGV2ZXIgbmVlZHMgaXQuKVxyXG5leHBvcnQgY29uc3QgTEFZRVJfU0xPVFMgPSA2NDtcclxuXHJcbi8vIENoZWFwIGtpbGwgc3dpdGNoZXM6IGlmIHdpcmluZyB0aGUgR0wgc3RhdGUgZXZlciBmYWlscyAoYSBmdXR1cmUgZ2xpZnkgdmVyc2lvbiBtb3ZpbmdcclxuLy8gaXRzIGludGVybmFscyksIHRoZSBhZmZlY3RlZCBmYW1pbHkgZmFsbHMgYmFjayB0byB0aGUgQ1BVIHJlYnVpbGQgcGF0aC4gUG9pbnRzIGFuZFxyXG4vLyB2ZWN0b3JzIGFyZSBzZXBhcmF0ZSBmbGFncyAtLSBhIHZlY3RvciBpbnRyb3NwZWN0aW9uIGZhaWx1cmUgbXVzdCBub3QgY29zdCBwb2ludHNcclxuLy8gdGhlaXIgR1BVIHBhdGguXHJcbmxldCBncHVPayA9IHRydWU7XHJcbmV4cG9ydCBmdW5jdGlvbiBncHVUaW1lQXZhaWxhYmxlKCkgeyByZXR1cm4gZ3B1T2s7IH1cclxuZXhwb3J0IGZ1bmN0aW9uIGRpc2FibGVHcHVUaW1lKHJlYXNvbikge1xyXG4gICAgaWYgKGdwdU9rKSBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gR1BVIHRpbWUgZmlsdGVyaW5nIGRpc2FibGVkOiAke3JlYXNvbn0uIGAgK1xyXG4gICAgICAgIGBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljay5gKTtcclxuICAgIGdwdU9rID0gZmFsc2U7XHJcbn1cclxubGV0IHZlY3RvckdwdU9rID0gdHJ1ZTtcclxuZXhwb3J0IGZ1bmN0aW9uIHZlY3RvckdwdUF2YWlsYWJsZSgpIHsgcmV0dXJuIHZlY3RvckdwdU9rOyB9XHJcbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlVmVjdG9yR3B1KHJlYXNvbikge1xyXG4gICAgaWYgKHZlY3RvckdwdU9rKSBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gR1BVIHRpbWUgZm9yIGxpbmVzL3BvbHlnb25zIGRpc2FibGVkOiBgICtcclxuICAgICAgICBgJHtyZWFzb259LiBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljayBmb3IgdGhvc2UgYnVja2V0cy5gKTtcclxuICAgIHZlY3RvckdwdU9rID0gZmFsc2U7XHJcbn1cclxuXHJcbi8vIFRoZSBkZWZhdWx0IHBvaW50cyB2ZXJ0ZXggc2hhZGVyIChyZWFkIG91dCBvZiBsZWFmbGV0LmdsaWZ5IDMuMy4wKSB3aXRoIHRoZSB3aW5kb3dcclxuLy8gdGVzdCBhZGRlZC4gQSBoaWRkZW4gcG9pbnQgZ2V0cyBzaXplIDAgYW5kIGEgcG9zaXRpb24gb3V0c2lkZSBjbGlwIHNwYWNlLCBzbyBuZWl0aGVyXHJcbi8vIHRoZSB2aXNpYmxlIHBhc3Mgbm9yIHRoZSBzaGFyZWQtcHJvZ3JhbSBwaWNraW5nIHBhc3MgZXZlciByYXN0ZXJpc2VzIGl0LlxyXG5leHBvcnQgZnVuY3Rpb24gdGltZVZlcnRleFNoYWRlcigpIHtcclxuICAgIHJldHVybiBgdW5pZm9ybSBtYXQ0IG1hdHJpeDtcclxuYXR0cmlidXRlIHZlYzQgdmVydGV4O1xyXG5hdHRyaWJ1dGUgdmVjNCBjb2xvcjtcclxuYXR0cmlidXRlIGZsb2F0IHBvaW50U2l6ZTtcclxuYXR0cmlidXRlIHZlYzIgYVRpbWVTcGFuO1xyXG5hdHRyaWJ1dGUgZmxvYXQgYUR1cmF0aW9uO1xyXG5hdHRyaWJ1dGUgZmxvYXQgYUxheWVyO1xyXG51bmlmb3JtIGZsb2F0IHVUaWNrO1xyXG51bmlmb3JtIGZsb2F0IHVPdmVycmlkZTtcclxudW5pZm9ybSBmbG9hdCB1TGF5ZXJWaXNbJHtMQVlFUl9TTE9UU31dO1xyXG52YXJ5aW5nIHZlYzQgX2NvbG9yO1xyXG5cclxudm9pZCBtYWluKCkge1xyXG4gIC8vIEEgbmVnYXRpdmUgZHVyYXRpb24gaXMgdGhlIGZhZGUgZmxhZzogfGFEdXJhdGlvbnwgaXMgdGhlIHdpbmRvdywgdGhlIHNpZ24gc2F5cyB0aGlzXHJcbiAgLy8gcG9pbnQgZGltcyB3aXRoIGFnZS4gQSBzaGFyZWQgb3ZlcnJpZGUga2VlcHMgdGhlIHBvaW50J3Mgb3duIGZhZGUgcHJlZmVyZW5jZS5cclxuICBib29sIGZhZGVzID0gYUR1cmF0aW9uIDwgMC4wO1xyXG4gIGZsb2F0IGR1ciA9IHVPdmVycmlkZSA+PSAwLjAgPyB1T3ZlcnJpZGUgOiBhYnMoYUR1cmF0aW9uKTtcclxuICAvLyBIYWxmLW9wZW4gKHRpY2sgLSBkdXIsIHRpY2tdLCBtYXRjaGluZyBmZWF0dXJlSW5XaW5kb3cgb24gdGhlIENQVSBzaWRlIC0tIEFORGVkIHdpdGhcclxuICAvLyB0aGUgcG9pbnQncyBsYXllciBiZWluZyB2aXNpYmxlLiBMYXllciB0b2dnbGVzIGFyZSBvbmUgdW5pZm9ybSBlbGVtZW50LCBub3QgYVxyXG4gIC8vIHJlYnVpbGQ6IHVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlLWZlZWQgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTLlxyXG4gIGJvb2wgdmlzaWJsZSA9IGFUaW1lU3Bhbi55ID4gKHVUaWNrIC0gZHVyKSAmJiBhVGltZVNwYW4ueCA8PSB1VGlja1xyXG4gICAgICAmJiB1TGF5ZXJWaXNbaW50KGFMYXllcildID4gMC41O1xyXG4gIGdsX1BvaW50U2l6ZSA9IHZpc2libGUgPyBwb2ludFNpemUgOiAwLjA7XHJcbiAgZ2xfUG9zaXRpb24gPSB2aXNpYmxlID8gbWF0cml4ICogdmVydGV4IDogdmVjNCgyLjAsIDIuMCwgMi4wLCAxLjApO1xyXG4gIC8vIEFnZSBydW5zIGZyb20gdGhlIGZlYXR1cmUncyBlbmQ7IG5ld2VzdCBpcyBvcGFxdWUsIHRoZSB0cmFpbGluZyBlZGdlIHJlYWNoZXMgemVyby5cclxuICBmbG9hdCBhbHBoYSA9IGZhZGVzID8gY2xhbXAoMS4wIC0gKHVUaWNrIC0gYVRpbWVTcGFuLnkpIC8gZHVyLCAwLjAsIDEuMCkgOiAxLjA7XHJcbiAgX2NvbG9yID0gdmVjNChjb2xvci5yZ2IsIGNvbG9yLmEgKiBhbHBoYSk7XHJcbn1cclxuYDtcclxufVxyXG5cclxuLy8gUGVyLWxheWVyIGR1cmF0aW9uIGluIHNlY29uZHM6IG51bGwgYWNjdW11bGF0ZXMsIFwicGVyaW9kXCIgaXMgdGhlIHNoYXJlZCBpbnRlcnZhbCxcclxuLy8gYW4gSVNPIHN0cmluZyBpcyBpdHNlbGY7IGFueXRoaW5nIHVucGFyc2VhYmxlIGZhbGxzIGJhY2sgdG8gdGhlIGludGVydmFsLlxyXG5mdW5jdGlvbiBkdXJhdGlvblNlY29uZHMoc3BlYywgcGVyaW9kTXMpIHtcclxuICAgIGlmIChzcGVjID09PSBudWxsIHx8IHNwZWMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIEFMV0FZUztcclxuICAgIGlmIChzcGVjID09PSBcInBlcmlvZFwiKSByZXR1cm4gKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcclxuICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzcGVjKSk7XHJcbiAgICByZXR1cm4gbXMgPyBtcyAvIDEwMDAgOiAocGVyaW9kTXMgfHwgMjQgKiAzNjAwICogMTAwMCkgLyAxMDAwO1xyXG59XHJcblxyXG4vLyBCdWlsZHMgdGhlIHBlci1wb2ludCBhdHRyaWJ1dGUgYXJyYXlzIGZvciBvbmUgbWVyZ2VkIGJ1Y2tldCwgaW4gdGhlIGV4YWN0IG9yZGVyIHRoZVxyXG4vLyBidWNrZXQgZmVlZHMgcG9pbnRzIHRvIGdsaWZ5OiBsYXllciBieSBsYXllciwgaW5kZXggMC4ubi0xLCB3aXRoIHNpbmdsZS1gbG9jYXRpb25gXHJcbi8vIGxheWVycyBjb250cmlidXRpbmcgb25lIHBvaW50LiBQb2ludHMgaW4gbGF5ZXJzIHdpdGhvdXQgdGltZSBtZXRhZGF0YSAtLSBhbmQgcG9pbnRzXHJcbi8vIHdob3NlIHRpbWUgd2FzIHVucmVhZGFibGUgKE5hTikgLS0gZ2V0IGEgc3BhbiB0aGF0IGlzIHZpc2libGUgYXQgZXZlcnkgdGljay5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHBlcmlvZE1zKSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgbGV0IGhhc1RpbWUgPSBmYWxzZTtcclxuICAgIGNvbnN0IHBlckxheWVyID0gW107XHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBidWYgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgY29uc3QgY291bnQgPSBidWYgPyBidWYuYnl0ZUxlbmd0aCAvIDE2IDogKGxheWVyLmxvY2F0aW9uID8gMSA6IDApO1xyXG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xyXG4gICAgICAgIGlmIChsYXllci50aW1lKSBoYXNUaW1lID0gdHJ1ZTtcclxuICAgICAgICBwZXJMYXllci5wdXNoKHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9KTtcclxuICAgICAgICB0b3RhbCArPSBjb3VudDtcclxuICAgIH1cclxuICAgIGlmICghaGFzVGltZSkgcmV0dXJuIHsgaGFzVGltZTogZmFsc2UgfTtcclxuXHJcbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xyXG4gICAgZm9yIChjb25zdCB7IHRpbWVzIH0gb2YgcGVyTGF5ZXIpIHtcclxuICAgICAgICBpZiAoIXRpbWVzKSBjb250aW51ZTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSAmJiB0aW1lc1tpXSA8IGJhc2UpIGJhc2UgPSB0aW1lc1tpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoYmFzZSA9PT0gSW5maW5pdHkpIGJhc2UgPSAwO1xyXG5cclxuICAgIGNvbnN0IHNwYW5zID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCAqIDIpO1xyXG4gICAgY29uc3QgZHVycyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xyXG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWRzID0gW107XHJcbiAgICBsZXQgb3V0ID0gMDtcclxuICAgIGZvciAoY29uc3QgeyBsYXllciwgY291bnQsIHRpbWVzIH0gb2YgcGVyTGF5ZXIpIHtcclxuICAgICAgICBjb25zdCBpZHggPSBsYXllcklkcy5sZW5ndGg7XHJcbiAgICAgICAgbGF5ZXJJZHMucHVzaChsYXllci5pZCk7XHJcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XHJcbiAgICAgICAgLy8gVGhlIGZhZGUgZmxhZyByaWRlcyB0aGUgZHVyYXRpb24ncyBzaWduLCBzbyBpdCBjb3N0cyBubyBleHRyYSBhdHRyaWJ1dGUuXHJcbiAgICAgICAgLy8gVGltZWxlc3MgKE5hTikgcG9pbnRzIGtlZXAgYSBwb3NpdGl2ZSBkdXJhdGlvbjogd2l0aCBubyBhZ2UsIG5vdGhpbmcgdG8gZmFkZS5cclxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gdGltZXMgPyB0aW1lc1tpICogMl0gOiBOYU47XHJcbiAgICAgICAgICAgIGNvbnN0IGVuZCA9IHRpbWVzID8gdGltZXNbaSAqIDIgKyAxXSA6IE5hTjtcclxuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTihzdGFydCkpIHtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gLUFMV0FZUztcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IEFMV0FZUztcclxuICAgICAgICAgICAgICAgIGR1cnNbb3V0XSA9IEFMV0FZUztcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gKHN0YXJ0IC0gYmFzZSkgLyAxMDAwO1xyXG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gKGVuZCAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgIGR1cnNbb3V0XSA9IHNpZ25lZER1cjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsYXllcklkeFtvdXRdID0gaWR4O1xyXG4gICAgICAgICAgICBvdXQrKztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4geyBoYXNUaW1lOiB0cnVlLCBiYXNlLCBzcGFucywgZHVycywgbGF5ZXJJZHgsIGxheWVySWRzLCBjb3VudDogdG90YWwgfTtcclxufVxyXG5cclxuLy8gUGVyLWZlYXR1cmUgdGltZSBtZXRhZGF0YSBmb3IgYSB2ZWN0b3IgYnVja2V0IChsaW5lcy9wb2x5Z29ucykuIFNhbWUgZW5jb2RpbmdzIGFzXHJcbi8vIHRoZSBwb2ludCBwYXRoIC0tIHJlYmFzZWQgZmxvYXQzMiBzZWNvbmRzLCBzaWduLXBhY2tlZCBmYWRlLCBhbHdheXMtdmlzaWJsZSBzcGFuc1xyXG4vLyBmb3IgdGltZWxlc3Mgb3Igbm9uLXRpbWUgbGF5ZXJzLlxyXG4vL1xyXG4vLyBBIHBvbHlsaW5lIHdob3NlIDo6dGltZXMgYnVmZmVyIGhvbGRzIG9uZSBbc3RhcnQsIGVuZF0gcGFpciBQRVIgVkVSVEVYIGFuaW1hdGVzXHJcbi8vIHBlciBzZWdtZW50IHdpdGhpbiBvbmUgbGF5ZXI6IHNlZ21lbnQgayBzcGFucyB2ZXJ0ZXggaydzIHN0YXJ0IHRvIHZlcnRleCBrKzEnc1xyXG4vLyBlbmQsIGFuZCBiZWNhdXNlIGdsaWZ5IGJ1aWxkcyAyIGRlZGljYXRlZCBHTCB2ZXJ0aWNlcyBwZXIgc2VnbWVudCAtLSBzZWdtZW50c1xyXG4vLyBuZXZlciBzaGFyZSB2ZXJ0aWNlcyAtLSBib3RoIGVuZHBvaW50cyBjYXJyeSB0aGUgc2FtZSBzcGFuIGFuZCBzZWdtZW50cyBhcHBlYXJcclxuLy8gYXRvbWljYWxseS4gVGhhdCBpcyB3aGF0IGxldHMgYSB3aG9sZSBzZWdtZW50ZWQgdHJhY2sgcmlkZSBPTkUgbGF5ZXIgc2xvdCB0aGUgd2F5XHJcbi8vIGEgMjAway1wb2ludCBsYXllciBkb2VzLCBpbnN0ZWFkIG9mIG9uZSBzbG90IHBlciBjaHVuayBhZ2FpbnN0IHRoZSA2NCBjZWlsaW5nLlxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZWN0b3JUaW1lTWV0YShsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcclxuICAgIGlmICghbGF5ZXJzTGlzdC5zb21lKGwgPT4gbC50aW1lKSkgcmV0dXJuIHsgaGFzVGltZTogZmFsc2UgfTtcclxuICAgIGxldCBiYXNlID0gSW5maW5pdHk7XHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBpZiAoIXRpbWVzKSBjb250aW51ZTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSAmJiB0aW1lc1tpXSA8IGJhc2UpIGJhc2UgPSB0aW1lc1tpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoYmFzZSA9PT0gSW5maW5pdHkpIGJhc2UgPSAwO1xyXG5cclxuICAgIGNvbnN0IHBlckZlYXR1cmUgPSBsYXllcnNMaXN0Lm1hcCgobGF5ZXIsIGlkeCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IGR1ciA9IGxheWVyLnRpbWUgPyBkdXJhdGlvblNlY29uZHMobGF5ZXIudGltZS5kdXJhdGlvbiwgcGVyaW9kTXMpIDogQUxXQVlTO1xyXG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcclxuICAgICAgICBpZiAoIXRpbWVzIHx8ICh0aW1lcy5sZW5ndGggPT09IDIgJiYgTnVtYmVyLmlzTmFOKHRpbWVzWzBdKSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1BTFdBWVMsIGVuZDogQUxXQVlTLCBkdXI6IEFMV0FZUywgaWR4IH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IG5WZXJ0cyA9IHZlcnRleENvdW50T2YobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5bGluZVwiICYmIHRpbWVzLmxlbmd0aCA+IDJcclxuICAgICAgICAgICAgICAgICYmIHRpbWVzLmxlbmd0aCA9PT0gblZlcnRzICogMikge1xyXG4gICAgICAgICAgICAvLyBTZWdtZW50cyBuZXZlciBjcm9zcyBhIHBhcnQgYm91bmRhcnk6IGEgbXVsdGktcGFydCBsaW5lIGRyYXdzXHJcbiAgICAgICAgICAgIC8vIG5WZXJ0cyAtIHBhcnRzIHNlZ21lbnRzLCBhbmQgYSBzcGFuIGJ1aWx0IGZyb20gb25lIHBhcnQncyBsYXN0XHJcbiAgICAgICAgICAgIC8vIHZlcnRleCB0byB0aGUgbmV4dCBwYXJ0J3MgZmlyc3Qgd291bGQgYmUgdGhlIHBoYW50b20gc2VnbWVudFxyXG4gICAgICAgICAgICAvLyByZWFwcGVhcmluZyBpbiB0aGUgdGltZSBwYXRoIC0tIG9uZSBleHRyYSBzcGFuLCBhbmQgZXZlcnkgYXR0cmlidXRlXHJcbiAgICAgICAgICAgIC8vIGFmdGVyIGl0IHNoZWFycyAodGhlIGxlbmd0aCBjaGVjayB0aGVuIGRyb3BzIHRoZSB3aG9sZSBmZWF0dXJlIHRvXHJcbiAgICAgICAgICAgIC8vIGl0cyBvdmVyYWxsIHNwYW4pLiBXYWxrIHRoZSBwYXJ0cyB0aGUgd2F5IHRoZSByZW5kZXJlciBkcmF3cyB0aGVtLlxyXG4gICAgICAgICAgICBjb25zdCBsZW5ndGhzID0gQXJyYXkuaXNBcnJheShsYXllci5wYXJ0cykgJiYgbGF5ZXIucGFydHMubGVuZ3RoID4gMVxyXG4gICAgICAgICAgICAgICAgPyBsYXllci5wYXJ0cyA6IFtuVmVydHNdO1xyXG4gICAgICAgICAgICBjb25zdCBzZWdzID0gbGVuZ3Rocy5yZWR1Y2UoKGEsIG4pID0+IGEgKyBNYXRoLm1heCgwLCBuIC0gMSksIDApO1xyXG4gICAgICAgICAgICBjb25zdCBzZWcgPSBuZXcgRmxvYXQ2NEFycmF5KHNlZ3MgKiAyKTtcclxuICAgICAgICAgICAgbGV0IGsgPSAwLCBvZmZzZXQgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG4gb2YgbGVuZ3Rocykge1xyXG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogKyAxIDwgbjsgaisrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcyA9IHRpbWVzWyhvZmZzZXQgKyBqKSAqIDJdO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGUgPSB0aW1lc1sob2Zmc2V0ICsgaiArIDEpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4ocykgfHwgTnVtYmVyLmlzTmFOKGUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMl0gPSAtQUxXQVlTOyAgICAgIC8vIGFuIHVucmVhZGFibGUgdGltZSBuZXZlciBoaWRlcyBkYXRhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gQUxXQVlTO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMl0gPSAocyAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VnW2sgKiAyICsgMV0gPSAoZSAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaysrO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IG47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gT3ZlcmFsbCBzcGFuIHJpZGVzIGFsb25nIGFzIHRoZSBmYWxsYmFjayBpZiBjb3VudHMgZXZlciBtaXNhbGlnbi5cclxuICAgICAgICAgICAgcmV0dXJuIHsgc2VnLCBzdGFydDogc2VnWzBdLCBlbmQ6IHNlZ1tzZWcubGVuZ3RoIC0gMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgIGR1cjogc2lnbmVkRHVyLCBpZHggfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6ICh0aW1lc1swXSAtIGJhc2UpIC8gMTAwMCwgZW5kOiAodGltZXNbMV0gLSBiYXNlKSAvIDEwMDAsXHJcbiAgICAgICAgICAgICAgICAgZHVyOiBzaWduZWREdXIsIGlkeCB9O1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4geyBoYXNUaW1lOiB0cnVlLCBiYXNlLCBwZXJGZWF0dXJlLCBsYXllcklkczogbGF5ZXJzTGlzdC5tYXAobCA9PiBsLmlkKSB9O1xyXG59XHJcblxyXG4vLyBBIHZlY3RvciBsYXllcidzIHZlcnRleCBjb3VudCBmcm9tIHdoaWNoZXZlciB0cmFuc3BvcnQgY2FycmllcyBpdHMgY29vcmRpbmF0ZXM6XHJcbi8vIHRoZSBiaW5hcnkgYnVmZmVyICgyIGZsb2F0NjQgcGVyIHZlcnRleCkgb3IgaW5saW5lIGBsb2NhdGlvbnNgLlxyXG5mdW5jdGlvbiB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgY29uc3QgcmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgaWYgKHJhdykgcmV0dXJuIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoIHx8IDApIC8gMTY7XHJcbiAgICByZXR1cm4gKGxheWVyLmxvY2F0aW9ucyB8fCBbXSkubGVuZ3RoO1xyXG59XHJcblxyXG4vLyBFeHBhbmRzIHBlci1mZWF0dXJlIHZhbHVlcyB0byBwZXItR0wtdmVydGV4IGFycmF5cyBnaXZlbiBlYWNoIGZlYXR1cmUncyB2ZXJ0ZXggY291bnQuXHJcbi8vIFB1cmUsIHNvIHRoZSBhbGlnbm1lbnQgbG9naWMgaXMgdGllci0xIHRlc3RhYmxlIGF3YXkgZnJvbSBhbnkgR0wgY29udGV4dC5cclxuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZFBlckZlYXR1cmUocGVyRmVhdHVyZSwgY291bnRzKSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChjb25zdCBjIG9mIGNvdW50cykgdG90YWwgKz0gYztcclxuICAgIGNvbnN0IHNwYW5zID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCAqIDIpO1xyXG4gICAgY29uc3QgZHVycyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xyXG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGxldCBvdXQgPSAwO1xyXG4gICAgcGVyRmVhdHVyZS5mb3JFYWNoKChmLCBpKSA9PiB7XHJcbiAgICAgICAgLy8gUGVyLXNlZ21lbnQgc3BhbnM6IEdMIHZlcnRleCB2IGJlbG9uZ3MgdG8gc2VnbWVudCB2ID4+IDEgKGdsaWZ5IGRyYXdzXHJcbiAgICAgICAgLy8gMiBkZWRpY2F0ZWQgdmVydGljZXMgcGVyIHNlZ21lbnQpLCBzbyBib3RoIGVuZHBvaW50cyB0YWtlIHRoZSBzZWdtZW50J3NcclxuICAgICAgICAvLyBzcGFuIGFuZCBhIHNlZ21lbnQgYXBwZWFycyBvciBkaXNhcHBlYXJzIGF0b21pY2FsbHkuIHNlZyBob2xkcyBzZWdzKjJcclxuICAgICAgICAvLyBmbG9hdHMgYW5kIHRoZSBmZWF0dXJlIGRyYXdzIHNlZ3MqMiBHTCB2ZXJ0aWNlcywgc28gdGhlIGxlbmd0aHMgYWdyZWVpbmdcclxuICAgICAgICAvLyBpcyB0aGUgYWxpZ25tZW50IGNoZWNrOyBhIG1pc21hdGNoIGZhbGxzIGJhY2sgdG8gdGhlIHdob2xlLWZlYXR1cmUgc3BhblxyXG4gICAgICAgIC8vIHJhdGhlciB0aGFuIHNoZWFyaW5nIGV2ZXJ5IGF0dHJpYnV0ZSBhZnRlciBpdC5cclxuICAgICAgICBjb25zdCBwZXJTZWdtZW50ID0gZi5zZWcgJiYgZi5zZWcubGVuZ3RoID09PSBjb3VudHNbaV0gPyBmLnNlZyA6IG51bGw7XHJcbiAgICAgICAgZm9yIChsZXQgdiA9IDA7IHYgPCBjb3VudHNbaV07IHYrKykge1xyXG4gICAgICAgICAgICBjb25zdCBrID0gcGVyU2VnbWVudCA/ICh2ID4+IDEpICogMiA6IC0xO1xyXG4gICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IHBlclNlZ21lbnQgPyBwZXJTZWdtZW50W2tdIDogZi5zdGFydDtcclxuICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gcGVyU2VnbWVudCA/IHBlclNlZ21lbnRbayArIDFdIDogZi5lbmQ7XHJcbiAgICAgICAgICAgIGR1cnNbb3V0XSA9IGYuZHVyO1xyXG4gICAgICAgICAgICBsYXllcklkeFtvdXRdID0gZi5pZHg7XHJcbiAgICAgICAgICAgIG91dCsrO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHsgc3BhbnMsIGR1cnMsIGxheWVySWR4IH07XHJcbn1cclxuXHJcbi8vIGdsaWZ5J3MgdmVydGV4IGxheW91dDogNiBmbG9hdHMgcGVyIEdMIHZlcnRleCAoeCwgeSwgciwgZywgYiwgYSksIGNvbmZpcm1lZCBmb3IgMy4zLjBcclxuLy8gYm90aCBieSByZWFkaW5nIHRoZSBzb3VyY2UgYW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgcmVwb3J0J3MgZGVidWcgZHVtcCAtLSB0d29cclxuLy8gb25lLXNlZ21lbnQgbGluZXMgcHJvZHVjZWQgYWxsVmVydGljZXNUeXBlZCBvZiAyNCBmbG9hdHM6IDIgZmVhdHVyZXMgeCAyIHZlcnRpY2VzIHggNi5cclxuY29uc3QgRkxPQVRTX1BFUl9WRVJURVggPSA2O1xyXG5cclxuLy8gV2lyZXMgdGltZSArIGxheWVyLXZpc2liaWxpdHkgaW50byBhIGxpdmUgZ2xpZnkgTElORVMgb3IgU0hBUEVTIGluc3RhbmNlLiBUaGUgY2FsbGVyXHJcbi8vIHN1cHBsaWVzIHBlci1mZWF0dXJlIEdMLXZlcnRleCBjb3VudHMgY29tcHV0ZWQgZnJvbSB0aGUgZ2VvbWV0cnkgaXQgYnVpbHQgaXRzZWxmOlxyXG4vLyBsaW5lcyBkcmF3IDIqKHBvaW50cy0xKSB2ZXJ0aWNlcyBwZXIgZmVhdHVyZSwgYW5kIGFueSB0cmlhbmd1bGF0aW9uIG9mIGEgc2ltcGxlIHJpbmdcclxuLy8gaGFzIGV4YWN0bHkgbi0yIHRyaWFuZ2xlcyAtLSBhIHByb3BlcnR5IG9mIGdlb21ldHJ5LCBub3Qgb2YgZ2xpZnkncyBlYXJjdXQuIFRoZSBjb3VudHNcclxuLy8gYXJlIHZhbGlkYXRlZCBhZ2FpbnN0IHRoZSBpbnN0YW5jZSdzIGFjdHVhbCBidWZmZXIgbGVuZ3RoLCBhbmQgYW55IG1pc21hdGNoIGRpc2FibGVzXHJcbi8vIHRoZSB2ZWN0b3IgR1BVIHBhdGggcmF0aGVyIHRoYW4gbWlzLWFsaWduaW5nIGF0dHJpYnV0ZXMuXHJcbmV4cG9ydCBmdW5jdGlvbiBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZShpbnN0YW5jZSwgbWV0YSwgY291bnRzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb3VudHMpIHx8IGNvdW50cy5sZW5ndGggIT09IG1ldGEucGVyRmVhdHVyZS5sZW5ndGgpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBleHBlY3RlZCAke21ldGEucGVyRmVhdHVyZS5sZW5ndGh9IHZlcnRleCBjb3VudHMsIGAgK1xyXG4gICAgICAgICAgICAgICAgYGdvdCAke2NvdW50cyAmJiBjb3VudHMubGVuZ3RofWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBleHBlY3RlZCA9IGNvdW50cy5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKSAqIEZMT0FUU19QRVJfVkVSVEVYO1xyXG4gICAgICAgIC8vIExpbmVzIGtlZXAgYSB0eXBlZCBmbGF0IGJ1ZmZlcjsgc2hhcGVzIGtlZXAgYSBwbGFpbiBmbGF0IGFycmF5LiBFaXRoZXIgaXMgdGhlXHJcbiAgICAgICAgLy8gZ3JvdW5kIHRydXRoIGZvciBob3cgbWFueSBHTCB2ZXJ0aWNlcyBnbGlmeSBhY3R1YWxseSBidWlsdC5cclxuICAgICAgICBjb25zdCBhY3R1YWwgPSBpbnN0YW5jZS5hbGxWZXJ0aWNlc1R5cGVkID8gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZC5sZW5ndGhcclxuICAgICAgICAgICAgOiAoQXJyYXkuaXNBcnJheShpbnN0YW5jZS52ZXJ0aWNlcykgPyBpbnN0YW5jZS52ZXJ0aWNlcy5sZW5ndGggOiAtMSk7XHJcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZXhwZWN0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGB2ZXJ0ZXggY291bnQgbWlzbWF0Y2g6IGdlb21ldHJ5IHNheXMgJHtleHBlY3RlZH0gZmxvYXRzLCBgICtcclxuICAgICAgICAgICAgICAgIGB0aGUgaW5zdGFuY2UgaG9sZHMgJHthY3R1YWx9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IGF0dHJzID0gZXhwYW5kUGVyRmVhdHVyZShtZXRhLnBlckZlYXR1cmUsIGNvdW50cyk7XHJcbiAgICAgICAgYXR0cnMuYmFzZSA9IG1ldGEuYmFzZTtcclxuICAgICAgICBhdHRycy5sYXllcklkcyA9IG1ldGEubGF5ZXJJZHM7XHJcbiAgICAgICAgcmV0dXJuIHdpcmVUaW1lQXR0cmlidXRlcyhpbnN0YW5jZSwgYXR0cnMpO1xyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgZGlzYWJsZVZlY3RvckdwdShlcnIubWVzc2FnZSk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFdpcmVzIHRoZSBhdHRyaWJ1dGUgYnVmZmVycyBhbmQgdW5pZm9ybXMgaW50byBhIGxpdmUgZ2xpZnkgcG9pbnRzIGluc3RhbmNlLiBSZXR1cm5zIGFcclxuLy8gaGFuZGxlIHdob3NlIHNldFdpbmRvdyBjb3N0cyB0d28gdW5pZm9ybXMgYW5kIGEgcmVkcmF3LCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IHRoZVxyXG4vLyBpbnN0YW5jZSBpcyBub3Qgd2hlcmUgZ2xpZnkgMy4zLjAga2VlcHMgaXQgLS0gaW4gd2hpY2ggY2FzZSBHUFUgdGltZSBpcyBkaXNhYmxlZCBhbmRcclxuLy8gdGhlIGNhbGxlcidzIHJlYnVpbGQgcGF0aCB0YWtlcyBvdmVyLlxyXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvSW5zdGFuY2UoaW5zdGFuY2UsIGF0dHJzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGRpc2FibGVHcHVUaW1lKGVyci5tZXNzYWdlKTtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxufVxyXG5cclxuLy8gVGhlIGNvbW1vbiBHTCB3aXJpbmc6IGJ1ZmZlcnMgZm9yIHNwYW4vZHVyYXRpb24vbGF5ZXIgYXR0cmlidXRlcywgdW5pZm9ybXMgZm9yIHRoZVxyXG4vLyB0aWNrLCB0aGUgc2hhcmVkIG92ZXJyaWRlIGFuZCB0aGUgcGVyLWxheWVyIHZpc2liaWxpdHkgc2xvdHMuIFRocm93cyBvbiBhbnl0aGluZ1xyXG4vLyB1bmV4cGVjdGVkOyB0aGUgY2FsbGVycyBkZWNpZGUgd2hpY2ggZmFsbGJhY2sgZmxhZyB0aGF0IGZsaXBzLlxyXG5mdW5jdGlvbiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKSB7XHJcbiAgICB7XHJcbiAgICAgICAgY29uc3QgZ2wgPSBpbnN0YW5jZS5nbDtcclxuICAgICAgICBjb25zdCBwcm9ncmFtID0gaW5zdGFuY2UucHJvZ3JhbTtcclxuICAgICAgICBjb25zdCBsYXllciA9IGluc3RhbmNlLmxheWVyO1xyXG4gICAgICAgIGlmICghZ2wgfHwgIXByb2dyYW0gfHwgIWxheWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnN0YW5jZSBsYWNrcyBnbC9wcm9ncmFtL2xheWVyXCIpO1xyXG5cclxuICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG5cclxuICAgICAgICBjb25zdCBzcGFuTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhVGltZVNwYW5cIik7XHJcbiAgICAgICAgY29uc3QgZHVyTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhRHVyYXRpb25cIik7XHJcbiAgICAgICAgY29uc3QgbGF5ZXJMb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFMYXllclwiKTtcclxuICAgICAgICBjb25zdCB0aWNrTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidVRpY2tcIik7XHJcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGVMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1T3ZlcnJpZGVcIik7XHJcbiAgICAgICAgLy8gU29tZSBkcml2ZXJzIG5hbWUgdGhlIGFycmF5IGhlYWQgXCJ1TGF5ZXJWaXNbMF1cIjsgYWNjZXB0IGVpdGhlci5cclxuICAgICAgICBjb25zdCB2aXNMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNcIilcclxuICAgICAgICAgICAgfHwgZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzWzBdXCIpO1xyXG4gICAgICAgIGlmIChzcGFuTG9jIDwgMCB8fCBkdXJMb2MgPCAwIHx8IGxheWVyTG9jIDwgMCB8fCAhdGlja0xvYyB8fCAhb3ZlcnJpZGVMb2MgfHwgIXZpc0xvYykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0aW1lIGF0dHJpYnV0ZXMvdW5pZm9ybXMgbWlzc2luZyBmcm9tIHRoZSBsaW5rZWQgcHJvZ3JhbVwiKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHNwYW5CdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcclxuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgc3BhbkJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLnNwYW5zLCBnbC5TVEFUSUNfRFJBVyk7XHJcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihzcGFuTG9jLCAyLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xyXG4gICAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KHNwYW5Mb2MpO1xyXG5cclxuICAgICAgICBjb25zdCBkdXJCdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcclxuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgZHVyQnVmKTtcclxuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuZHVycywgZ2wuU1RBVElDX0RSQVcpO1xyXG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoZHVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xyXG4gICAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KGR1ckxvYyk7XHJcblxyXG4gICAgICAgIGNvbnN0IGxheWVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGxheWVyQnVmKTtcclxuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMubGF5ZXJJZHgsIGdsLlNUQVRJQ19EUkFXKTtcclxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGxheWVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xyXG4gICAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KGxheWVyTG9jKTtcclxuXHJcbiAgICAgICAgLy8gVW50aWwgdGhlIHNsaWRlciBzYXlzIG90aGVyd2lzZSwgZXZlcnl0aGluZyBpcyB2aXNpYmxlIC0tIGluIHRpbWUgQU5EIGxheWVyLlxyXG4gICAgICAgIGdsLnVuaWZvcm0xZih0aWNrTG9jLCBBTFdBWVMpO1xyXG4gICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgLTEpO1xyXG4gICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbGF5ZXJJZHM6IGF0dHJzLmxheWVySWRzLFxyXG4gICAgICAgICAgICAvLyB0aWNrTXMgaW4gZXBvY2ggbXM7IG92ZXJyaWRlTXMgYSBzaGFyZWQtd2luZG93IHdpZHRoIG9yIG51bGwuXHJcbiAgICAgICAgICAgIHNldFdpbmRvdyh0aWNrTXMsIG92ZXJyaWRlTXMpIHtcclxuICAgICAgICAgICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XHJcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgdGlja01zID09PSBudWxsID8gQUxXQVlTIDogKHRpY2tNcyAtIGF0dHJzLmJhc2UpIC8gMTAwMCk7XHJcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIG92ZXJyaWRlTXMgPT09IG51bGwgPyAtMSA6IG92ZXJyaWRlTXMgLyAxMDAwKTtcclxuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvLyBPbmUgZmxvYXQgcGVyIGxheWVyIHNsb3QsIGluIGF0dHJzLmxheWVySWRzIG9yZGVyLiBBIHNpZGViYXIgdG9nZ2xlIGxhbmRzXHJcbiAgICAgICAgICAgIC8vIGhlcmUgaW5zdGVhZCBvZiByZWJ1aWxkaW5nIHRoZSBidWNrZXQuXHJcbiAgICAgICAgICAgIHNldExheWVyVmlzaWJpbGl0eSh2aXNBcnJheSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdmlzID0gbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKTtcclxuICAgICAgICAgICAgICAgIHZpcy5zZXQodmlzQXJyYXkuc2xpY2UoMCwgTEFZRVJfU0xPVFMpKTtcclxuICAgICAgICAgICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XHJcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgdmlzKTtcclxuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuIiwgImltcG9ydCB7IGJpbmRQb3B1cCwgYmluZFRvb2x0aXAsIHBhcnNlQ29sb3IgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyBMIH0gZnJvbSBcIi4vbGlicy5qc1wiO1xyXG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XHJcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXHJcbiAgICAgICAgIHBlcmlvZFRvTXMgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcclxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XHJcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XHJcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XHJcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XHJcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcclxuICAgIH1cclxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xyXG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xyXG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcclxuICAgICAgICAgICAgLy8gV2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZCAodGhlIHdpZGdldCdzIGNsaWNrIGhhbmRsZXIgc3RhbXBzIHRoaXNcclxuICAgICAgICAgICAgLy8gcGVyIGNsaWNrLCBiZWZvcmUgYW55IGZlYXR1cmUgaGFuZGxlciBydW5zKSwgRVZFUlkgbWF0Y2ggc3RhbmRzIGRvd246XHJcbiAgICAgICAgICAgIC8vIGEgY2xpY2sgaW4gcmVtb3ZhbCBtb2RlIGlzIGEgZGVsZXRpb24gYXR0ZW1wdCwgYW5kIGFuc3dlcmluZyBpdCB3aXRoXHJcbiAgICAgICAgICAgIC8vIGEgZmVhdHVyZSBwb3B1cCBvciBhIGNvb3JkcyByZWFkb3V0IHJlYWRzIGFzIFwicmVtb3ZlIGlzIGJyb2tlblwiLlxyXG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCAmJiAhbWFwLl9wbU1vZGVBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xyXG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xyXG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XHJcbiAgICB9XHJcbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcclxuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcclxuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XHJcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgfSwgMCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xyXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcclxuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXHJcbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxyXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxyXG4vL1xyXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcclxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxyXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxyXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXHJcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcclxuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xyXG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xyXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcclxuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcclxuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcclxuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xyXG4gICAgY29uc3QgcHJvcHMgPSB7fTtcclxuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcclxuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwcm9wcztcclxufVxyXG5cclxuXHJcblxyXG4vLyBBbiBpbWFnZXJ5IG92ZXJsYXkncyBpZGVudGl0eTogZXZlcnl0aGluZyB0aGUgcmVuZGVyZWQgZWxlbWVudCBkZXJpdmVzIGZyb20gaXRzXHJcbi8vIGNvbmZpZy4gVGhlIHN5bmMgbG9vcCByZWNyZWF0ZXMgdGhlIG92ZXJsYXkgd2hlbiB0aGlzIGNoYW5nZXMgKG9yIHdoZW4gdGhlXHJcbi8vIGJpbmFyeSBidWZmZXIgb2JqZWN0IHVuZGVyIHRoZSBsYXllciBpZCBpcyByZXBsYWNlZCksIHNpbmNlIGEgRE9NIGltYWdlIGlzIGFcclxuLy8gc2luZ2xlIGNoZWFwIG5vZGUgLS0gbm8gaW5jcmVtZW50YWwgdXBkYXRlIG1hY2hpbmVyeSBuZWVkZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbWFnZU1ldGFLZXkobGF5ZXIpIHtcclxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShbbGF5ZXIudXJsIHx8IG51bGwsIGxheWVyLmJvdW5kcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIub3BhY2l0eSA/PyAxLCBsYXllci5pbWFnZV9mb3JtYXQgfHwgbnVsbF0pO1xyXG59XHJcblxyXG4vLyBHZW9yZWZlcmVuY2VkIHBpeGVscyBwaW5uZWQgdG8gYSBsYXQvbG9uIGJveC4gVGhlIGNvbmZpZyBpcyBwdXJlIGRhdGEgLS1cclxuLy8ge3R5cGU6IFwiaW1hZ2VcIiwgYm91bmRzLCBvcGFjaXR5LCB1cmwgfCBieXRlcyB1bmRlciB0aGUgbGF5ZXIgaWR9IC0tIHNvIGFcclxuLy8gcGxhaW4tSlMgY29uc3VtZXIgcGFzc2VzIGEgVVJMIGFuZCB0aGUgd2lkZ2V0IHBhdGggc2hpcHMgYnl0ZXMgb3ZlciB0aGVcclxuLy8gYmluYXJ5IGJ1ZmZlciB0cmFuc3BvcnQuIFB5dGhvbiBoYXMgYWxyZWFkeSB3YXJwZWQgdGhlIHJhc3RlciBpbnRvIHRoZSBNQVAnc1xyXG4vLyBvd24gQ1JTIGdyaWQgKHJhc3RlcmlvIHNpZGUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIExlYWZsZXQncyBsaW5lYXIgY29ybmVyXHJcbi8vIHN0cmV0Y2ggZXhhY3RseSBjb3JyZWN0OyB0aGlzIHN0YXlzIGEgZHVtYiByZW5kZXJlci5cclxuZnVuY3Rpb24gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcikge1xyXG4gICAgaWYgKCFsYXllci5ib3VuZHMpIHJldHVybiBudWxsO1xyXG4gICAgbGV0IHVybCA9IGxheWVyLnVybDtcclxuICAgIGxldCBvYmplY3RVcmwgPSBudWxsO1xyXG4gICAgaWYgKCF1cmwgJiYgY29vcmRCdWZmZXIpIHtcclxuICAgICAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2Nvb3JkQnVmZmVyXSxcclxuICAgICAgICAgICAgeyB0eXBlOiBsYXllci5pbWFnZV9mb3JtYXQgfHwgXCJpbWFnZS9wbmdcIiB9KTtcclxuICAgICAgICBvYmplY3RVcmwgPSB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgfVxyXG4gICAgaWYgKCF1cmwpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IEwuaW1hZ2VPdmVybGF5KHVybCwgbGF5ZXIuYm91bmRzLCB7XHJcbiAgICAgICAgb3BhY2l0eTogbGF5ZXIub3BhY2l0eSA/PyAxLFxyXG4gICAgICAgIC8vIENvbnRleHQsIG5vdCBhIGNsaWNrIHRhcmdldDogY2xpY2tzIGZhbGwgdGhyb3VnaCB0byBmZWF0dXJlcyBhbmQgdGhlXHJcbiAgICAgICAgLy8gZW1wdHktbWFwIGNvb3JkaW5hdGUgZmFsbGJhY2suIFRoZSBkZWZhdWx0IG92ZXJsYXlQYW5lICh6IDQwMClcclxuICAgICAgICAvLyBhbHJlYWR5IHNpdHMgYWJvdmUgdGlsZXMgKDIwMCkgYW5kIGJlbG93IHRoZSBHTCBwYW5lcyAoNDEwKykuXHJcbiAgICAgICAgaW50ZXJhY3RpdmU6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAob2JqZWN0VXJsKSB7XHJcbiAgICAgICAgb3ZlcmxheS5vbihcInJlbW92ZVwiLCAoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKG9iamVjdFVybCkpO1xyXG4gICAgfVxyXG4gICAgb3ZlcmxheS5hZGRUbyhtYXApO1xyXG4gICAgb3ZlcmxheS5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgb3ZlcmxheS5pbWFnZU1ldGEgPSBpbWFnZU1ldGFLZXkobGF5ZXIpO1xyXG4gICAgb3ZlcmxheS5pbWFnZVNvdXJjZSA9IGNvb3JkQnVmZmVyIHx8IG51bGw7XHJcbiAgICByZXR1cm4gb3ZlcmxheTtcclxufVxyXG5cclxuLy8gQSBub24tR0wgbGF5ZXIgKGltYWdlIG92ZXJsYXksIG9yIGEgZ3JvdXAgb2YgdGhlbSkgYXMgYSBMZWFmbGV0IGxheWVyLiBUYWtlcyB0aGVcclxuLy8gTElWRSBidWZmZXIgbWFwIHRoZSBjb3JlIGtlZXBzIC0tIHBhdGNoZXMgbGFuZCB0aGVyZSwgbmV2ZXIgaW4gYSBob3N0IHRyYWl0LlxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRCdWZmZXIsIGNvb3JkaW5hdGVCdWZmZXJzID0ge30pIHtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImltYWdlXCIpIHtcclxuICAgICAgICByZXR1cm4gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcik7XHJcbiAgICB9XHJcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsYXllci5sYXllcnMpIHtcclxuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgZ3JvdXAuYWRkTGF5ZXIoaW5zdGFuY2UpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGdyb3VwLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcclxuICAgICAgICByZXR1cm4gZ3JvdXA7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQSB2ZWN0b3IgbGF5ZXIncyBjb29yZGluYXRlczogdGhlIGJpbmFyeSBidWZmZXIgdW5kZXIgaXRzIGlkIHdoZW4gUHl0aG9uIGJ1aWx0IGl0XHJcbi8vICh0aGUgbGF5ZXJzIEpTT04gdGhlbiBjYXJyaWVzIG5vIGNvb3JkaW5hdGVzIGF0IGFsbCksIG9yIGlubGluZSBgbG9jYXRpb25zYCBmb3JcclxuLy8gaGFuZC1idWlsdCBjb25maWdzIGFuZCBmaXh0dXJlcy4gTWF0ZXJpYWxpc2VkIG9ubHkgb24gcmVidWlsZCwgd2hpY2ggdmVjdG9yIGJ1Y2tldHNcclxuLy8gb24gdGhlIEdQVSBwYXRoIHJhcmVseSBkby5cclxuZXhwb3J0IGZ1bmN0aW9uIHZlY3RvckNvb3JkcyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmIChsYXllci5sb2NhdGlvbnMpIHJldHVybiBsYXllci5sb2NhdGlvbnM7XHJcbiAgICBjb25zdCByYXcgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBmbGF0ID0gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgIGNvbnN0IG91dCA9IG5ldyBBcnJheShmbGF0Lmxlbmd0aCAvIDIpO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvdXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBvdXRbaV0gPSBbZmxhdFtpICogMl0sIGZsYXRbaSAqIDIgKyAxXV07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBBIGxpbmUgbGF5ZXIncyBjb29yZGluYXRlcyBhcyBwYXJ0czogdGhlIGZsYXQgcnVuIHNsaWNlZCBieSB0aGUgY29uZmlnJ3MgYHBhcnRzYFxyXG4vLyBsZW5ndGggdGFibGUsIG9yIG9uZSBwYXJ0IHdpdGhvdXQgaXQuIEEgbXVsdGktcGFydCBsaW5lIC0tIE1VTFRJTElORVNUUklORyxcclxuLy8gTXVsdGlMaW5lU3RyaW5nIC0tIGlzIE9ORSBsYXllciBkcmF3biBhcyBkaXNqb2ludCBydW5zOyBub3RoaW5nIG1heSBldmVyIGRyYXcgYVxyXG4vLyBzZWdtZW50IGZyb20gb25lIHBhcnQncyBsYXN0IHZlcnRleCB0byB0aGUgbmV4dCBwYXJ0J3MgZmlyc3QuXHJcbmV4cG9ydCBmdW5jdGlvbiBsaW5lUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XHJcbiAgICBjb25zdCBsZW5ndGhzID0gQXJyYXkuaXNBcnJheShsYXllci5wYXJ0cykgJiYgbGF5ZXIucGFydHMubGVuZ3RoID4gMSA/IGxheWVyLnBhcnRzIDogbnVsbDtcclxuICAgIGlmICghbGVuZ3RocykgcmV0dXJuIGxvY3MubGVuZ3RoID8gW2xvY3NdIDogW107XHJcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xyXG4gICAgbGV0IG9mZnNldCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IG4gb2YgbGVuZ3Rocykge1xyXG4gICAgICAgIGNvbnN0IHBhcnQgPSBsb2NzLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgbik7XHJcbiAgICAgICAgb2Zmc2V0ICs9IG47XHJcbiAgICAgICAgaWYgKHBhcnQubGVuZ3RoID49IDIpIHBhcnRzLnB1c2gocGFydCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFydHM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNsb3NlUmluZyhyaW5nKSB7XHJcbiAgICBpZiAocmluZy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc3QgZmlyc3QgPSByaW5nWzBdO1xyXG4gICAgICAgIGNvbnN0IGxhc3QgPSByaW5nW3JpbmcubGVuZ3RoIC0gMV07XHJcbiAgICAgICAgaWYgKGZpcnN0WzBdICE9PSBsYXN0WzBdIHx8IGZpcnN0WzFdICE9PSBsYXN0WzFdKSB7XHJcbiAgICAgICAgICAgIHJpbmcucHVzaChbZmlyc3RbMF0sIGZpcnN0WzFdXSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJpbmc7XHJcbn1cclxuXHJcbi8vIGdsaWZ5J3MgbGluZSBoaXQgdG9sZXJhbmNlIGlzIGBzZW5zaXRpdml0eSArIHdlaWdodC9zY2FsZWAsIGFuZCBzZW5zaXRpdml0eSBpcyBhXHJcbi8vIENPTlNUQU5UIGluIGxhdGxuZyBkZWdyZWVzIC0tIDAuMSBmb3IgY2xpY2tzICh+MTEga20pIGFuZCAwLjAzIGZvciBob3ZlcnMsXHJcbi8vIHpvb20tYmxpbmQsIHNvIGEgY2xpY2sgd2l0aGluIHNpZ2h0IG9mIGEgbGluZSBtYXRjaGVkIGl0IGFuZCBzdGFydmVkIHRoZVxyXG4vLyBlbXB0eS1tYXAgZmFsbGJhY2suIFRoZSB3ZWlnaHQvc2NhbGUgdGVybSBhbHJlYWR5IGNvdmVycyB0aGUgZHJhd24gd2lkdGg7XHJcbi8vIHJlcGxhY2UgdGhlIGNvbnN0YW50IHdpdGggYSBmZXcgcGl4ZWxzJyB3b3J0aCBhdCB0aGUgY3VycmVudCB6b29tLiBUaGUgaW5zdGFuY2VcclxuLy8gZ2V0dGVycyByZWFkIGBzZXR0aW5nc2AgbGl2ZSBwZXIgZXZlbnQsIHNvIHVwZGF0aW5nIG9uIHpvb20gaXMgZW5vdWdoIC0tIG5vXHJcbi8vIGdsaWZ5IHBhdGNoaW5nLiBSZXR1cm5zIHRoZSB1bnN1YnNjcmliZSBmb3Igb25SZW1vdmUuXHJcbmNvbnN0IExJTkVfSElUX1NMQUNLX1BYID0gODtcclxuZnVuY3Rpb24gdHJhY2tMaW5lU2Vuc2l0aXZpdHkobWFwLCBpbnN0YW5jZSkge1xyXG4gICAgY29uc3QgYXBwbHkgPSAoKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgc2xhY2sgPSBMSU5FX0hJVF9TTEFDS19QWCAvIE1hdGgucG93KDIsIG1hcC5nZXRab29tKCkpO1xyXG4gICAgICAgIGluc3RhbmNlLnNldHRpbmdzLnNlbnNpdGl2aXR5ID0gc2xhY2s7XHJcbiAgICAgICAgaW5zdGFuY2Uuc2V0dGluZ3Muc2Vuc2l0aXZpdHlIb3ZlciA9IHNsYWNrO1xyXG4gICAgfTtcclxuICAgIGFwcGx5KCk7XHJcbiAgICBtYXAub24oXCJ6b29tZW5kXCIsIGFwcGx5KTtcclxuICAgIHJldHVybiAoKSA9PiBtYXAub2ZmKFwiem9vbWVuZFwiLCBhcHBseSk7XHJcbn1cclxuXHJcbi8vIEFuIGFyZWEgbGF5ZXIncyBnZW9tZXRyeSBhcyBwYXJ0cyAtPiBjbG9zZWQgW2xvbiwgbGF0XSByaW5nczogYSBwb2x5Z29uJ3MgZmxhdFxyXG4vLyBjb29yZGluYXRlIHJ1biBzbGljZWQgYnkgaXRzIGByaW5nc2AgdGFibGUgKG9uZSBob2xlLWZyZWUgcmluZyB3aXRob3V0IGl0KSwgb3IgYVxyXG4vLyBjaXJjbGUncyBnZW5lcmF0ZWQgcmluZy4gRmVlZHMgYm90aCB0aGUgZmlsbCAoZWFyY3V0LCBpbiB0aGUgcG9seWdvbiBidWNrZXQpIGFuZFxyXG4vLyB0aGUgb3V0bGluZSAoTGluZVN0cmluZ3MgaW4gdGhlIGxpbmVzIGJ1Y2tldCkuXHJcbmZ1bmN0aW9uIGFyZWFQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XHJcbiAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XHJcbiAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xyXG4gICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcclxuICAgICAgICBjb25zdCByaW5nID0gW107XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gMzI7IGkrKykge1xyXG4gICAgICAgICAgICBjb25zdCBhbmdsZSA9IChpICogMzYwKSAvIDMyO1xyXG4gICAgICAgICAgICBjb25zdCBhbmdsZVJhZCA9IChhbmdsZSAqIE1hdGguUEkpIC8gMTgwO1xyXG4gICAgICAgICAgICBjb25zdCBkTGF0ID0gKHJhZGl1c01ldGVycyAqIE1hdGguY29zKGFuZ2xlUmFkKSkgLyBlYXJ0aFJhZGl1cztcclxuICAgICAgICAgICAgY29uc3QgZExvbiA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLnNpbihhbmdsZVJhZCkpIC8gKGVhcnRoUmFkaXVzICogTWF0aC5jb3MoKGxhdCAqIE1hdGguUEkpIC8gMTgwKSk7XHJcbiAgICAgICAgICAgIHJpbmcucHVzaChbbG9uICsgKGRMb24gKiAxODApIC8gTWF0aC5QSSwgbGF0ICsgKGRMYXQgKiAxODApIC8gTWF0aC5QSV0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gW1tyaW5nXV07XHJcbiAgICB9XHJcbiAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XHJcbiAgICBjb25zdCBsb25sYXQgPSBsb2NzLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XHJcbiAgICBjb25zdCByaW5nVGFibGUgPSBsYXllci5yaW5ncyB8fCAobG9ubGF0Lmxlbmd0aCA+IDAgPyBbW2xvbmxhdC5sZW5ndGhdXSA6IFtdKTtcclxuICAgIGNvbnN0IHBhcnRzID0gW107XHJcbiAgICBsZXQgYXQgPSAwO1xyXG4gICAgZm9yIChjb25zdCBwYXJ0TGVucyBvZiByaW5nVGFibGUpIHtcclxuICAgICAgICBjb25zdCByaW5ncyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGVuIG9mIHBhcnRMZW5zKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJpbmcgPSBjbG9zZVJpbmcobG9ubGF0LnNsaWNlKGF0LCBhdCArIGxlbikpO1xyXG4gICAgICAgICAgICBhdCArPSBsZW47XHJcbiAgICAgICAgICAgIGlmIChyaW5nLmxlbmd0aCA+PSA0KSByaW5ncy5wdXNoKHJpbmcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocmluZ3MubGVuZ3RoID4gMCkgcGFydHMucHVzaChyaW5ncyk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFydHM7XHJcbn1cclxuXHJcbi8vIGBldmVudHMub25GZWF0dXJlQ2xpY2soeyBsYXllciwgaW5kZXgsIGxhdGxuZyB9KWAgaXMgaG93IGEgY2xpY2sgcmVhY2hlcyB3aGF0ZXZlclxyXG4vLyBob3N0cyB0aGUgbWFwOyB0aGlzIG1vZHVsZSBuZXZlciB3cml0ZXMgc3RhdGUgaXRzZWxmLlxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBldmVudHMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRmVhdHVyZVZpc2libGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBvbkZlYXR1cmVDbGljayA9IChldmVudHMgJiYgZXZlbnRzLm9uRmVhdHVyZUNsaWNrKSB8fCAoKCkgPT4ge30pO1xyXG4gICAgLy8gSGl0LXRlc3QgZ3VhcmQ6IEdQVS1wYXRoIGJ1Y2tldHMgaG9sZCBoaWRkZW4gbGF5ZXJzIChhbmQgb3V0LW9mLXdpbmRvd1xyXG4gICAgLy8gZmVhdHVyZXMpLCBtYXNrZWQgb25seSBieSBzaGFkZXIgdW5pZm9ybXMgZ2xpZnkncyBoaXQtdGVzdHMgY2Fubm90IHNlZS4gVGhlXHJcbiAgICAvLyB3aWRnZXQgcGFzc2VzIGEgbGl2ZSBsb29rdXA7IHRoZSBmYWxsYmFjayBjb3ZlcnMgcGxhaW4tSlMgY29uc3VtZXJzIHdpdGggdGhlXHJcbiAgICAvLyBjb25maWcncyBvd24gZmxhZy5cclxuICAgIGNvbnN0IHZpc2libGVOb3cgPSBpc0ZlYXR1cmVWaXNpYmxlIHx8ICgobCkgPT4gbC52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAvLyBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZSBnZW9tZXRyeSBwZXIgbGF5ZXIuIE9uIHRoZSBHUFUgcGF0aCAobWFwLmpzXHJcbiAgICAvLyBwYXNzZXMgdmVjdG9yR3B1IHdoZW4gdGhlIGJ1Y2tldCBxdWFsaWZpZXMpIGV2ZXJ5IGZlYXR1cmUgc3RheXMgaW4gdGhlIGJ1ZmZlcnMgYW5kXHJcbiAgICAvLyB0aGUgc2hhZGVyIGRlY2lkZXMgdmlzaWJpbGl0eSBwZXIgdGljayBhbmQgcGVyIGxheWVyIHRvZ2dsZSAtLSBhIGxpbmUtc2hhcGVkIHRyYWNrXHJcbiAgICAvLyBoYXMgYXMgbWFueSB2ZXJ0aWNlcyBhcyBhIHBvaW50IHRyYWNrIGhhcyBwb2ludHMsIHNvIGl0cyByZWJ1aWxkcyBjb3N0IHRoZSBzYW1lXHJcbiAgICAvLyBhbmQgY3Jhc2hlZCB0aGUgc2FtZSB3YXkuIE9mZiB0aGUgR1BVIHBhdGgsIHRoZSB3aG9sZS1mZWF0dXJlIENQVSBmaWx0ZXIgcmVtYWlucy5cclxuICAgIGNvbnN0IHZlY3Rvck1ldGEgPSB2ZWN0b3JHcHUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiXHJcbiAgICAgICAgPyBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxyXG4gICAgICAgICAgICB0aW1lU3RhdGUgJiYgdGltZVN0YXRlLnBlcmlvZCA/IHBlcmlvZFRvTXModGltZVN0YXRlLnBlcmlvZCkgOiBudWxsKVxyXG4gICAgICAgIDogeyBoYXNUaW1lOiBmYWxzZSB9O1xyXG4gICAgY29uc3QgdmVjdG9yVGltZSA9IEJvb2xlYW4odmVjdG9yTWV0YS5oYXNUaW1lKTtcclxuICAgIGlmICh0aW1lU3RhdGUgJiYgIXZlY3RvclRpbWUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiKSB7XHJcbiAgICAgICAgbGF5ZXJzTGlzdCA9IGxheWVyc0xpc3QuZmlsdGVyKGwgPT4gbGF5ZXJJbldpbmRvdyhsLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSk7XHJcbiAgICAgICAgaWYgKGxheWVyc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmICh0eXBlID09PSBcInBvbHlsaW5lXCIpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcclxuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xyXG5cclxuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lczogYSBwb2x5Z29uIG9yIGNpcmNsZSBpbiB0aGlzIGJ1Y2tldCBjb250cmlidXRlcyBlYWNoIG9mIGl0c1xyXG4gICAgICAgICAgICAvLyByaW5ncyBhcyBvbmUgTGluZVN0cmluZywgZHJhd24gd2l0aCB0aGUgYXJlYSdzIHN0cm9rZSBvcHRpb25zIC0tIGNvbG9yLFxyXG4gICAgICAgICAgICAvLyB3ZWlnaHQsIG9wYWNpdHksIExlYWZsZXQncyBvd24gc2VtYW50aWNzLiBPdXRsaW5lIHdlaWdodCBhbmQgb3BhY2l0eSBuZXZlclxyXG4gICAgICAgICAgICAvLyByZW5kZXJlZCBiZWZvcmUgdGhpczsgdGhlIGZpbGwgbWFjaGluZXJ5IGNhbm5vdCBkcmF3IHRoZW0gKGdsaWZ5J3MgYm9yZGVyXHJcbiAgICAgICAgICAgIC8vIGlzIDFweCBhbmQgZmlsbC1jb2xvdXJlZCksIHRoZSBsaW5lcyBtYWNoaW5lcnkgYWxyZWFkeSBkb2VzLlxyXG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xyXG4gICAgICAgICAgICAgICAgbGV0IGNvdW50ID0gMDtcclxuICAgICAgICAgICAgICAgIGlmICgoc3R5bGUud2VpZ2h0ID8/IDMpID4gMCAmJiAoc3R5bGUub3BhY2l0eSA/PyAxLjApID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5nIG9mIHJpbmdzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3VudCArPSBNYXRoLm1heCgwLCAyICogKHJpbmcubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHsgdHlwZTogXCJMaW5lU3RyaW5nXCIsIGNvb3JkaW5hdGVzOiByaW5nIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE91dGxpbmUgcGl4ZWxzIG9ubHkgLS0gdGhlIGFyZWEncyBzaGFwZXMgaW5zdGFuY2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gb3ducyBpbnRlcmFjdGlvbiB3aXRoIGV4YWN0IGNvbnRhaW5tZW50LiBMZWZ0XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNsaWNrYWJsZSwgdGhlc2UgcmluZ3MgYW5zd2VyZWQgdGhyb3VnaCBnbGlmeSdzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGxpbmUgdG9sZXJhbmNlICgwLjEgREVHUkVFUyBmb3IgY2xpY2tzIHZzIDAuMDNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZm9yIGhvdmVycyk6IHBvcHVwcyB3ZWxsIG91dHNpZGUgdGhlIHNoYXBlIGFuZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnNpZGUgaG9sZXMsIGhvdmVyIGRpc2FncmVlaW5nIHdpdGggY2xpY2suXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQm9yZGVyOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaChjb3VudCk7ICAgLy8gMCBrZWVwcyB0aGUgc2xvdCBhbGlnbmVkIHdoZW4gc3Ryb2tlbGVzc1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIE9uZSBMaW5lU3RyaW5nIGZlYXR1cmUgUEVSIFBBUlQsIGV2ZXJ5IHBhcnQgY2FycnlpbmcgdGhlIGxheWVyIC0tIG5ldmVyXHJcbiAgICAgICAgICAgIC8vIGEgTXVsdGlMaW5lU3RyaW5nOiBnbGlmeSdzIE11bHRpTGluZVN0cmluZyBwYXRoIGhpdC10ZXN0cyB0aGUgY29ubmVjdG9yXHJcbiAgICAgICAgICAgIC8vIGJldHdlZW4gcGFydHMsIHdoaWNoIGlzIHRoZSBwaGFudG9tIHNlZ21lbnQgYnkgYW5vdGhlciByb3V0ZS4gVGhlIEdMXHJcbiAgICAgICAgICAgIC8vIHZlcnRleCBzdHJlYW0gc3RheXMgY29uc2VjdXRpdmUsIHNvIHRoZSBwZXItbGF5ZXIgY291bnQgc3RpbGwgYWxpZ25zXHJcbiAgICAgICAgICAgIC8vIHRoZSB0aW1lIGF0dHJpYnV0ZXM7IGEgc3Ryb2tlbGVzcyBvciBkZWdlbmVyYXRlIGxheWVyIGtlZXBzIGl0cyBzbG90LlxyXG4gICAgICAgICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgbGluZVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGdlb2pzb25Db29yZHMgPSBwYXJ0Lm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XHJcbiAgICAgICAgICAgICAgICBjb3VudCArPSBNYXRoLm1heCgwLCAyICogKGdlb2pzb25Db29yZHMubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJMaW5lU3RyaW5nXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb3JkaW5hdGVzOiBnZW9qc29uQ29vcmRzXHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUub3BhY2l0eSB8fCAxLjAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBzdHlsZS53ZWlnaHQgfHwgM1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG5cclxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXHJcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XHJcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3QgbGluZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXHJcbiAgICAgICAgICAgICAgICAgICAgPyB7IHZlcnRleFNoYWRlclNvdXJjZTogKCkgPT4gdGltZVZlcnRleFNoYWRlcigpIH0gOiB7fTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZ2xMaW5lcyA9IEwuZ2xpZnkubGluZXMoe1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLmxpbmVPcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxyXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWxpbmVzUGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoZSBkYXRhIGFib3ZlIGlzIEdlb0pTT04sIHdob3NlIGNvb3JkaW5hdGVzIGFyZSBbbG9uLCBsYXRdOyBnbGlmeVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGRlZmF1bHRzIHRvIGxhdGl0dWRlLWZpcnN0IGFuZCBpdHMgTElORSB2ZXJ0ZXggYnVpbGRlciByZWFkc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGNvb3JkaW5hdGVzIHRocm91Z2ggdGhlc2Uga2V5cyAtLSB1bnNldCwgaXQgdG9vayBsb25naXR1ZGUgYXNcclxuICAgICAgICAgICAgICAgICAgICAvLyBsYXRpdHVkZSBhbmQgcHJvamVjdGVkIGV2ZXJ5IGxpbmUgb2ZmLXZpZXdwb3J0LiBTaWxlbnRseTogbm8gR0xcclxuICAgICAgICAgICAgICAgICAgICAvLyBlcnJvciwgYSBoZWFsdGh5IGNhbnZhcywgemVybyBmcmFnbWVudHMuIFNldCBwZXIgaW5zdGFuY2UgcmF0aGVyXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiBvbiB0aGUgTC5nbGlmeSBnbG9iYWwsIHdoaWNoIGFub3RoZXIgbGlicmFyeSBjb3VsZCBhbHNvXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gbXV0YXRlLiBUaGUgcG9seWdvbiBwYXRoIGlzIGRlbGliZXJhdGVseSBOT1QgZ2l2ZW4gdGhlc2Uga2V5czpcclxuICAgICAgICAgICAgICAgICAgICAvLyBpdCB0cmlhbmd1bGF0ZXMgdmlhIGVhcmN1dCBvbiB0aGUgR2VvSlNPTiBkaXJlY3RseSwgbmF0aXZlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gW2xvbiwgbGF0XSwgYW5kIGtleXMgdGhlcmUgd291bGQgdHJhbnNwb3NlIGl0IHRoZSBzYW1lIHdheS5cclxuICAgICAgICAgICAgICAgICAgICAvLyBGb3VuZCBieSB0aGUgVmFsaGFsbGEtVlJFIGJ1ZyByZXBvcnQsIGRyaXZpbmcgdGhlIHBsYWluLUpTXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYnVuZGxlIHdoZXJlIG5vIHBvaW50cyBtYXNrZWQgdGhlIGJsYW5rIGxpbmVzLlxyXG4gICAgICAgICAgICAgICAgICAgIGxhdGl0dWRlS2V5OiAxLFxyXG4gICAgICAgICAgICAgICAgICAgIGxvbmdpdHVkZUtleTogMCxcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLndlaWdodDtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZlYXR1cmUgfHwgIWZlYXR1cmUucHJvcGVydGllcyB8fCBmZWF0dXJlLnByb3BlcnRpZXMuaXNCb3JkZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIXZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAyLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkOiB0aGUgaG9zdCByZWNvcmRzIFwid2hlcmVcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCBcIm9uIHdoYXRcIiAtLSBzZWUgb25GZWF0dXJlQ2xpY2sgaW4gY29yZS5qcy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyLCBpbmRleDogMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubGF0ICogMWU1KSAvIDFlNSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgIWZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIHZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xMaW5lcyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zZW5zaXRpdml0eU9mZiA9IHRyYWNrTGluZVNlbnNpdGl2aXR5KG0sIHRoaXMuZ2xMaW5lcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xMaW5lcywgdmVjdG9yTWV0YSwgdmVydGV4Q291bnRzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2Vuc2l0aXZpdHlPZmYpIHRoaXMuX3NlbnNpdGl2aXR5T2ZmKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbExpbmVzKSB0aGlzLmdsTGluZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgICAgICBjb25zdCBwYXJ0cyA9IGFyZWFQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaCgwKTsgICAvLyBubyBmZWF0dXJlLCBidXQgdGhlIHNsb3QgbXVzdCBzdGF5IGFsaWduZWRcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIEFueSB0cmlhbmd1bGF0aW9uIG9mIGEgcG9seWdvbiB3aXRoIEQgZGlzdGluY3QgdmVydGljZXMgYW5kIGggaG9sZXMgaGFzXHJcbiAgICAgICAgICAgIC8vIGV4YWN0bHkgRCArIDJoIC0gMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3NcclxuICAgICAgICAgICAgLy8gZWFyY3V0OyBoID0gMCBnaXZlcyB0aGUgZmFtaWxpYXIgRCAtIDIuIFJpbmdzIGFyZSBjbG9zZWQgYnkgbm93LCBzbyBlYWNoXHJcbiAgICAgICAgICAgIC8vIGNvbnRyaWJ1dGVzIGxlbmd0aCAtIDEgZGlzdGluY3QgdmVydGljZXMuIFBhcnRzIHRyaWFuZ3VsYXRlIHNlcGFyYXRlbHlcclxuICAgICAgICAgICAgLy8gYW5kIHN1bS5cclxuICAgICAgICAgICAgbGV0IHRyaWFuZ2xlcyA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgcGFydHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGRpc3RpbmN0ID0gcmluZ3MucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIubGVuZ3RoIC0gMSwgMCk7XHJcbiAgICAgICAgICAgICAgICB0cmlhbmdsZXMgKz0gTWF0aC5tYXgoMCwgZGlzdGluY3QgKyAyICogKHJpbmdzLmxlbmd0aCAtIDEpIC0gMik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMyAqIHRyaWFuZ2xlcyk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcclxuICAgICAgICAgICAgLy8gTGVhZmxldCdzIG93biBzZW1hbnRpY3M6IHRoZSBmaWxsIGlzIGZpbGxDb2xvciwgZGVmYXVsdGluZyB0byB0aGUgc3Ryb2tlXHJcbiAgICAgICAgICAgIC8vIGNvbG9yIHdoZW4gdW5zZXQuIEl0IHVzZWQgdG8gYWx3YXlzIGZpbGwgd2l0aCBgY29sb3JgLCB3aGljaCBtYWRlXHJcbiAgICAgICAgICAgIC8vIFwicmVkIG91dGxpbmUsIHBhbGUgYmx1ZSBmaWxsXCIgLS0gdGhlIG1vc3QgYmFzaWMgcG9seWdvbiBzdHlsaW5nIGFzayAtLVxyXG4gICAgICAgICAgICAvLyBpbXBvc3NpYmxlOyB0aGUgb3V0bGluZSBpdHNlbGYgaXMgZHJhd24gYnkgdGhlIGxpbmVzIGJ1Y2tldC5cclxuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5maWxsQ29sb3IgfHwgc3R5bGUuZmlsbF9jb2xvciB8fCBzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xyXG4gICAgICAgICAgICAvLyBPbmUgRmVhdHVyZSBQRVIgUEFSVCwgbmV2ZXIgYSBNdWx0aVBvbHlnb246IGdsaWZ5J3Mgc2hhcGVzIG9ubHlcclxuICAgICAgICAgICAgLy8gZXhwbG9kZXMgTXVsdGlQb2x5Z29uIHdoZW4gaGFuZGVkIGEgYmFyZSBGZWF0dXJlIG9yIGdlb21ldHJ5IC0tIGluIGFcclxuICAgICAgICAgICAgLy8gRmVhdHVyZUNvbGxlY3Rpb24gdGhlIGNvb3JkaW5hdGVzIHJlYWNoIGVhcmN1dC5mbGF0dGVuIHVuZXhwbG9kZWQsXHJcbiAgICAgICAgICAgIC8vIGVhcmN1dCByZXR1cm5zIG5vIGluZGljZXMsIGFuZCB0aGUgZmVhdHVyZSBzaWxlbnRseSBkcmF3cyBaRVJPIGZpbGxcclxuICAgICAgICAgICAgLy8gdHJpYW5nbGVzICh2ZXJpZmllZCBhZ2FpbnN0IGdsaWZ5IDMuMy4wOyBpdHMgXCJ1bmhhbmRsZWQgcG9seWdvblwiXHJcbiAgICAgICAgICAgIC8vIHRocm93IHNpdHMgaW5zaWRlIHRoZSBlbXB0eSBsb29wIGFuZCBuZXZlciBmaXJlcykuIFBhcnRzIHN0YXlcclxuICAgICAgICAgICAgLy8gY29uc2VjdXRpdmUsIHNvIHBlci1sYXllciB2ZXJ0ZXhDb3VudHMgc3RpbGwgYWxpZ24gZm9yIEdQVSB0aW1lLlxyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmdzIG9mIHBhcnRzKSB7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIlBvbHlnb25cIiwgY29vcmRpbmF0ZXM6IHJpbmdzIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLmZpbGxPcGFjaXR5IHx8IDAuMiB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG5cclxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXHJcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XHJcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hhcGVPcHRpb25zID0gdmVjdG9yVGltZVxyXG4gICAgICAgICAgICAgICAgICAgID8geyB2ZXJ0ZXhTaGFkZXJTb3VyY2U6ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKSB9IDoge307XHJcbiAgICAgICAgICAgICAgICB0aGlzLmdsU2hhcGVzID0gTC5nbGlmeS5zaGFwZXMoe1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLnNoYXBlT3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogZ2VvanNvbixcclxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZlYXR1cmUgfHwgIWZlYXR1cmUucHJvcGVydGllcyB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIXZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkOiB0aGUgaG9zdCByZWNvcmRzIFwid2hlcmVcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCBcIm9uIHdoYXRcIiAtLSBzZWUgb25GZWF0dXJlQ2xpY2sgaW4gY29yZS5qcy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyLCBpbmRleDogMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubGF0ICogMWU1KSAvIDFlNSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XHJcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcclxuXHJcbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xyXG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcclxuICAgIC8vIGNpcmNsZSBiZWNhdXNlIHRoZSBnbHlwaCBpcyBkcmF3biBpbnNpZGUgdGhlIHBvaW50J3Mgb3duIHF1YWQgYnkgdGhlIHNoYWRlci5cclxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XHJcblxyXG4gICAgLy8gR1BVIHRpbWUgcGF0aDogd2hlbiB0aGlzIGJ1Y2tldCBob2xkcyB0aW1lIGxheWVycywgZXZlcnkgcG9pbnQgaXMgZmVkIHRvIGdsaWZ5IGFuZFxyXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXHJcbiAgICAvLyB2ZXJ0ZXggc2hhZGVyLCBzbyBhIHRpY2sgY29zdHMgdHdvIHVuaWZvcm1zIGluc3RlYWQgb2YgcmVidWlsZGluZyA1TSBwb2ludHMgaW4gSlMuXHJcbiAgICAvLyBUaGUgQ1BVIGZpbHRlciBiZWxvdyBzdGF5cyBhcyB0aGUgZmFsbGJhY2sgd2hlbiB0aGUgR0wgd2lyaW5nIGlzIHVuYXZhaWxhYmxlLlxyXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcclxuICAgICAgICA/IGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCBncHVUaW1lID0gQm9vbGVhbihncHVBdHRycy5oYXNUaW1lKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyU2l6ZSA9IGxheWVyLnJhZGl1cyAhPSBudWxsID8gTnVtYmVyKGxheWVyLnJhZGl1cykgOiBkZWZhdWx0U2l6ZTtcclxuXHJcbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XHJcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCLFxyXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxyXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVPZmZzZXQsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGNvb3Jkcy5sZW5ndGggLyAyO1xyXG5cclxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XHJcbiAgICAgICAgLy8gU2VsZWN0aW9uIHN0eWxpbmcsIGFwcGxpZWQgb3ZlciB0aGUgbGF5ZXIncyBvd24gYW5kIGl0cyBkYXRhLWRyaXZlbiBzdHlsZXMuXHJcbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cclxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcclxuICAgICAgICBjb25zdCBvdmVycmlkZXMgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgfHwgbnVsbDtcclxuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxyXG4gICAgICAgIC8vIHU4IFJHQkEgdW5kZXIgXCI8aWQ+Ojpjb2xvcnNcIiwgZjMyIHBpeGVscyB1bmRlciBcIjxpZD46OnJhZGlpXCIgLS0gY29tcHV0ZWRcclxuICAgICAgICAvLyBpbiBQeXRob24gZnJvbSBjb2xvcl9jb2wvcmFkaXVzX2NvbC4gQnVmZmVycywgbmV2ZXIgcGVyLWZlYXR1cmUgc3R5bGVcclxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxyXG4gICAgICAgIC8vIHBheWxvYWQgdGhhdCB1c2VkIHRvIGtpbGwgc2Vzc2lvbnMuIEV4cGxpY2l0IHN0eWxlcyBzdGlsbCBvdXRyYW5rIHRoZW0uXHJcbiAgICAgICAgY29uc3QgY29sb3JzUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojpjb2xvcnNgXTtcclxuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcclxuICAgICAgICAgICAgPyBuZXcgVWludDhBcnJheShjb2xvcnNSYXcuYnVmZmVyIHx8IGNvbG9yc1JhdywgY29sb3JzUmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcnNSYXcuYnl0ZUxlbmd0aClcclxuICAgICAgICAgICAgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IHJhZGlpUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9OjpyYWRpaWBdO1xyXG4gICAgICAgIGNvbnN0IGJ1ZlJhZGlpID0gcmFkaWlSYXdcclxuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmFkaWlSYXcuYnl0ZUxlbmd0aCAvIDQpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxyXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcclxuICAgICAgICAvLyBvbiB0aGUgc3Vydml2b3JzIGtlZXAgcG9pbnRpbmcgYXQgdGhlIHJpZ2h0IHJvd3MuXHJcbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGZyb21EYXRhID0gcGVyRmVhdHVyZSA/IHBlckZlYXR1cmVbaV0gOiBudWxsO1xyXG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxyXG4gICAgICAgICAgICAgICAgfHwgKGhpZ2hsaWdodCAmJiBoaWdobGlnaHQuY29sb3IpXHJcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xyXG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LnJhZGl1cyAhPSBudWxsID8gaGlnaGxpZ2h0LnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xyXG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxyXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZkNvbG9ycyA/IHsgcjogYnVmQ29sb3JzW2kgKiA0XSAvIDI1NSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZzogYnVmQ29sb3JzW2kgKiA0ICsgMV0gLyAyNTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhOiBidWZDb2xvcnNbaSAqIDQgKyAzXSAvIDI1NSB9XHJcbiAgICAgICAgICAgICAgICAgICAgOiBjb2xvclJHQixcclxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZlJhZGlpID8gYnVmUmFkaWlbaV1cclxuICAgICAgICAgICAgICAgICAgICA6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXHJcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcclxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcclxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cclxuICAgICAgICAgICAgICAgIHNpemU6IChpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyA/IGluZm8uY29sb3JSR0IgOiB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc2Vuc2l0aXZpdHk6IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjAgOiA4LFxyXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlZCBCRUZPUkUgY29tcGV0aW5nIGZvciB0aGUgY2xpY2s6IGEgaGlkZGVuIG9yXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gb3V0LW9mLXdpbmRvdyBwb2ludCBtdXN0IG5vdCBlbnRlciB0aGUgYXJiaXRyYXRpb24gYXQgYWxsLCBzb1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoYXRldmVyIHNpdHMgYmVuZWF0aCBpdCAtLSBhIHZpc2libGUgZmVhdHVyZSwgb3IgdGhlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZW1wdHktbWFwIGZhbGxiYWNrIC0tIHdpbnMgaW5zdGVhZC5cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZUluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXByZUluZm8gfHwgIXZpc2libGVOb3cocHJlSW5mby5sYXllciwgcHJlSW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHByZUluZm87XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGNsaWNrZWQgcG9pbnQncyBvd24gY29vcmRpbmF0ZXMgLS0gbW9yZSB0cnV0aGZ1bFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiB0aGUgbW91c2UgcG9zaXRpb24gZm9yIGEgcG9pbnQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7IGxheWVyLCBpbmRleDogb3JpZ2luYWxJbmRleCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbcG9pbnRbMF0sIHBvaW50WzFdXSB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocG9pbnQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCB0b29sdGlwcyBvbiBmYXIgYXdheSBob3ZlcnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaG92ZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gaG92ZXJQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFpbmZvIHx8ICF2aXNpYmxlTm93KGluZm8ubGF5ZXIsIGluZm8ub3JpZ2luYWxJbmRleCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAxLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICBpZiAodHlwZSA9PT0gXCJtYXJrZXJzXCIpIHtcclxuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy5mcmFnbWVudFNoYWRlclNvdXJjZSA9ICgpID0+IHBpblNoYWRlcjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcclxuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy52ZXJ0ZXhTaGFkZXJTb3VyY2UgPSAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhpcy5nbFBvaW50cyA9IEwuZ2xpZnkucG9pbnRzKGdsaWZ5T3B0aW9ucyk7XHJcbiAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xQb2ludHMpO1xyXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gTnVsbCBvbiBmYWlsdXJlLCB3aGljaCBhbHNvIGZsaXBzIHRoZSBnbG9iYWwgZmxhZzogdGhlIG5leHQgc3luYydzXHJcbiAgICAgICAgICAgICAgICAvLyByZWJ1aWxkIGtleSBjaGFuZ2VzIHdpdGggaXQgYW5kIHRoZSBDUFUgcGF0aCB0YWtlcyBvdmVyLlxyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvSW5zdGFuY2UodGhpcy5nbFBvaW50cywgZ3B1QXR0cnMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcclxuICAgICAgICAgICAgaWYgKGNhbnZhcykgY2FudmFzLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcclxuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XHJcbiAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgcmV0dXJuIGluc3RhbmNlO1xyXG59XHJcbiIsICIvLyBQZXJtYW5lbnQgZmVhdHVyZSBsYWJlbHM6IHRleHQgcGlubmVkIHRvIHRoZSBtYXAsIGZyb20gYSBsYXllcidzIGBsYWJlbGAgKG9uZVxyXG4vLyB2ZWN0b3IgZmVhdHVyZSkgb3IgYGxhYmVsc2AgKG9uZSBwZXIgcG9pbnQsIGFsaWduZWQgd2l0aCB0aGUgY29vcmRpbmF0ZSBidWZmZXIpLlxyXG4vLyBET00gZWxlbWVudHMgYnkgZGVzaWduIC0tIExlYWZsZXQgcGVybWFuZW50IHRvb2x0aXBzIC0tIHdoaWNoIGlzIHdoeSB0aGV5IGFyZSBmb3JcclxuLy8gc2l0ZS1zY2FsZSBsYXllcnM7IFB5dGhvbiB3YXJucyBwYXN0IGEgdGhvdXNhbmQuIE1vZGVsLWZyZWUgbGlrZSB0aGUgbGVnZW5kOiBwdXJlXHJcbi8vIGRhdGEgaW4sIExlYWZsZXQgbGF5ZXJzIG91dCwgcmUtZGVyaXZlZCBlYWNoIHN5bmMgc28gbGFiZWxzIGZvbGxvdyB2aXNpYmlsaXR5XHJcbi8vIHdpdGhvdXQgdG91Y2hpbmcgdGhlIEdMIGJ1Y2tldHMgb3IgdGhlaXIgbWV0YSBrZXlzLlxyXG5cclxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9wYXRjaC5qc1wiO1xyXG5pbXBvcnQgeyB2ZWN0b3JDb29yZHMsIGxpbmVQYXJ0cyB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xyXG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFdoZXRoZXIgYSB3aG9sZSBsYWJlbGxlZCBmZWF0dXJlIGlzIGluc2lkZSB0aGUgY3VycmVudCB0aW1lIHdpbmRvdy4gTmFOIHRpbWVzXHJcbi8vIGtlZXAgdGhlIGxhYmVsLCBtYXRjaGluZyB0aGUgbWFwOiBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YSwgc28gaXRcclxuLy8gbXVzdCBuZXZlciBoaWRlIHRoZSBkYXRhJ3MgbGFiZWwgZWl0aGVyLiBBIG11bHRpLXNwYW4gbGluZSBjb3VudHMgYXMgdmlzaWJsZVxyXG4vLyB3aGlsZSBBTlkgb2YgaXRzIHNlZ21lbnRzIGlzIC0tIHRoZSBsYWJlbCBmb2xsb3dzIHRoZSBsYXllciwgbm90IG9uZSBsZWcuXHJcbmZ1bmN0aW9uIHRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghdGltZVN0YXRlIHx8ICFsYXllci50aW1lKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIHJldHVybiB0cnVlO1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIE9uZSBhbmNob3IgcGVyIGxhYmVsbGVkIGZlYXR1cmUuIFBvaW50cyBsYWJlbCBhdCB0aGUgcG9pbnQ7IGEgbGluZSBsYWJlbHMgYXQgaXRzXHJcbi8vIG1pZGRsZSB2ZXJ0ZXggKG9uIHRoZSBsaW5lLCBub3QgZmxvYXRpbmcgaW4gaXRzIGJvdW5kaW5nIGJveCk7IGEgcG9seWdvbiBvclxyXG4vLyBjaXJjbGUgbGFiZWxzIGF0IGl0cyBib3VuZHMgY2VudHJlLiBXaXRoIGEgdGltZVN0YXRlLCBsYWJlbHMgZm9sbG93IHRoZSB3aW5kb3c6XHJcbi8vIHBvaW50cyBkcm9wIHBlciBwb2ludCwgdmVjdG9ycyBhcyBhIHdob2xlLlxyXG4vLyBEZWdyZWUtc3BhY2UgbGVuZ3RoIG9mIGEgW2xhdCwgbG5nXSBydW4gLS0gb25seSBldmVyIGNvbXBhcmVkIGFnYWluc3QgYW5vdGhlclxyXG4vLyBwYXJ0IG9mIHRoZSBzYW1lIGxpbmUsIHNvIG5vIHByb2plY3Rpb24gaXMgbmVlZGVkIHRvIHBpY2sgdGhlIGxvbmdlciBvbmUuXHJcbmZ1bmN0aW9uIHBsYW5hckxlbmd0aChwYXJ0KSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBwYXJ0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZExhdCA9IHBhcnRbaV1bMF0gLSBwYXJ0W2kgLSAxXVswXTtcclxuICAgICAgICBjb25zdCBkTG5nID0gcGFydFtpXVsxXSAtIHBhcnRbaSAtIDFdWzFdO1xyXG4gICAgICAgIHRvdGFsICs9IE1hdGguc3FydChkTGF0ICogZExhdCArIGRMbmcgKiBkTG5nKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0b3RhbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IG91dCA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSBjb250aW51ZTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLmNvbGxlY3RMYWJlbHMobGF5ZXIubGF5ZXJzIHx8IFtdLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSkpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobGF5ZXIubGFiZWxzKSkge1xyXG4gICAgICAgICAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICBpZiAoIXJhdykgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgICAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihsYXllci5sYWJlbHMubGVuZ3RoLCBjb29yZHMubGVuZ3RoIC8gMik7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllci5sYWJlbHNbaV0pIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbaSAqIDJdKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGNvb3Jkc1tpICogMl0sIGxuZzogY29vcmRzW2kgKiAyICsgMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbHNbaV0pLCBjZW50ZXI6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChsYXllci5sYWJlbCkge1xyXG4gICAgICAgICAgICBpZiAoIXRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgICAgICAgICAgLy8gQW5jaG9yIE9OIGEgcGFydCAtLSB0aGUgbWlkZGxlIHZlcnRleCBvZiB0aGUgbG9uZ2VzdCBwYXJ0LiBUaGVcclxuICAgICAgICAgICAgICAgIC8vIG1pZGRsZSBvZiBhIG11bHRpLXBhcnQgbGluZSdzIHdob2xlIHZlcnRleCBydW4gY2FuIHNpdCBpbiB0aGUgZ2FwXHJcbiAgICAgICAgICAgICAgICAvLyBiZXR3ZWVuIHBhcnRzLCB3aGVyZSB0aGVyZSBpcyBub3RoaW5nIHRvIGxhYmVsLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFydHMgPSBsaW5lUGFydHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb25nZXN0ID0gcGFydHMucmVkdWNlKChiZXN0LCBwYXJ0KSA9PlxyXG4gICAgICAgICAgICAgICAgICAgIHBsYW5hckxlbmd0aChwYXJ0KSA+IHBsYW5hckxlbmd0aChiZXN0KSA/IHBhcnQgOiBiZXN0LCBwYXJ0c1swXSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtaWQgPSBsb25nZXN0W01hdGguZmxvb3IoKGxvbmdlc3QubGVuZ3RoIC0gMSkgLyAyKV07XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbWlkWzBdLCBsbmc6IG1pZFsxXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5ib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtbYUxhdCwgYUxvbl0sIFtiTGF0LCBiTG9uXV0gPSBsYXllci5ib3VuZHM7XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKGFMYXQgKyBiTGF0KSAvIDIsIGxuZzogKGFMb24gKyBiTG9uKSAvIDIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5sb2NhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGxheWVyLmxvY2F0aW9uWzBdLCBsbmc6IGxheWVyLmxvY2F0aW9uWzFdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBObyBib3VuZHMgb24gdGhlIGNvbmZpZyAtLSB0aGUgY29sbGVjdGlvbiBtZXJnZSBkcm9wcGVkIHRoZW0gZm9yXHJcbiAgICAgICAgICAgICAgICAvLyBpdHMgd2hvbGUgaGlzdG9yeSwgYW5kIGhhbmQtYnVpbHQgY29uZmlncyBtYXkgbmV2ZXIgY2FycnkgdGhlbS5cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBjb29yZGluYXRlcyBhcmUgc3RpbGwgaW4gdGhlIGJ1ZmZlciB1bmRlciB0aGUgbGF5ZXIncyBvd24gaWQsXHJcbiAgICAgICAgICAgICAgICAvLyBleGFjdGx5IGFzIHRoZSBwb2x5bGluZSBicmFuY2ggcmVhZHMgdGhlbTsgYSBtaXNzaW5nIGJveCBtdXN0XHJcbiAgICAgICAgICAgICAgICAvLyBkZWdyYWRlIHRvIGNvbXB1dGluZyBvbmUsIG5ldmVyIHRvIHNpbGVudGx5IGRyb3BwaW5nIHRoZSBsYWJlbC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvY3MubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICAgICAgbGV0IG1pbkxuZyA9IEluZmluaXR5LCBtYXhMbmcgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtsYXQsIGxuZ10gb2YgbG9jcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA8IG1pbkxuZykgbWluTG5nID0gbG5nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsbmcgPiBtYXhMbmcpIG1heExuZyA9IGxuZztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAobWluTGF0ICsgbWF4TGF0KSAvIDIsIGxuZzogKG1pbkxuZyArIG1heExuZykgLyAyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBSZWJ1aWxkcyBgZ3JvdXBgIChhbiBMLmxheWVyR3JvdXApIHRvIGhvbGQgZXhhY3RseSB0aGUgY3VycmVudCBsYWJlbHMsIHNraXBwaW5nXHJcbi8vIHRoZSB3b3JrIHdoZW4gbm90aGluZyBjaGFuZ2VkIC0tIHN5bmNzIHJ1biBvbiBldmVyeSB0b2dnbGUgYW5kIHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMYWJlbHMoTCwgZ3JvdXAsIGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBsYWJlbHMgPSBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUpO1xyXG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkobGFiZWxzKTtcclxuICAgIGlmIChncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9PT0ga2V5KSByZXR1cm47XHJcbiAgICBncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9IGtleTtcclxuICAgIGdyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbGFiZWxzKSB7XHJcbiAgICAgICAgLy8gQ29udGVudCBhcyBhbiBlbGVtZW50IHdpdGggdGV4dENvbnRlbnQ6IHRvb2x0aXAgc3RyaW5nIGNvbnRlbnQgaXMgSFRNTCxcclxuICAgICAgICAvLyBhbmQgbGFiZWxzIGNvbWUgZnJvbSB1c2VyIGRhdGEsIHdoaWNoIG11c3QgbmV2ZXIgcGFyc2UgYXMgbWFya3VwLlxyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gaXRlbS50ZXh0O1xyXG4gICAgICAgIGNvbnN0IHRvb2x0aXAgPSBMLnRvb2x0aXAoe1xyXG4gICAgICAgICAgICBwZXJtYW5lbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGRpcmVjdGlvbjogaXRlbS5jZW50ZXIgPyBcImNlbnRlclwiIDogXCJ0b3BcIixcclxuICAgICAgICAgICAgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWZlYXR1cmUtbGFiZWxcIixcclxuICAgICAgICAgICAgb2Zmc2V0OiBpdGVtLmNlbnRlciA/IFswLCAwXSA6IFswLCAtNl0sXHJcbiAgICAgICAgfSkuc2V0TGF0TG5nKFtpdGVtLmxhdCwgaXRlbS5sbmddKS5zZXRDb250ZW50KHNwYW4pO1xyXG4gICAgICAgIGdyb3VwLmFkZExheWVyKHRvb2x0aXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBMLCBwcm92aWRlTGVhZmxldCwgcmVxdWlyZUxlYWZsZXQgfSBmcm9tIFwiLi9saWJzLmpzXCI7XHJcbmltcG9ydCB7IHJlbmRlclNpZGViYXJDb250cm9scywgbm9ybWFsaXplUmFkaW9MYXllcnMsIHNpZGViYXJDb2xsYXBzZVN0YXRlIH0gZnJvbSBcIi4vc2lkZWJhci5qc1wiO1xyXG5pbXBvcnQgeyBkZXJpdmVMZWdlbmRTcGVjLCByZW5kZXJMZWdlbmQgfSBmcm9tIFwiLi9sZWdlbmQuanNcIjtcclxuaW1wb3J0IHsgcmVuZGVyTGFiZWxzIH0gZnJvbSBcIi4vbGFiZWxzLmpzXCI7XHJcbmltcG9ydCB7IHJlbmRlckxheWVyLCByZW5kZXJNZXJnZWRHbExheWVyLCByZWdpc3RlckNsaWNrTWF0Y2gsIGltYWdlTWV0YUtleSB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xyXG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgZ2VuZXJhdGVUaWNrcywgY29sbGVjdFRpbWVFeHRlbnQsIGhhc1RpbWVMYXllcnMsXHJcbiAgICAgICAgIGxheWVySW5XaW5kb3csIHJlbmRlclRpbWVDb250cm9sLCBhZHZhbmNlLCBwZXJpb2RUb01zLCBnY2RHcmlkTXMsXHJcbiAgICAgICAgIGNvbGxlY3REdXJhdGlvbnNNcywgUE9TSVRJT05TLCB0aW1lc0Zvciwgd2luZG93Rm9yLCBmZWF0dXJlSW5XaW5kb3csXHJcbiAgICAgICAgIGVmZmVjdGl2ZUR1cmF0aW9uLCBuZWFyZXN0VGlja0luZGV4IH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuaW1wb3J0IHsgZ3B1VGltZUF2YWlsYWJsZSwgdmVjdG9yR3B1QXZhaWxhYmxlLCBMQVlFUl9TTE9UUyB9IGZyb20gXCIuL2dwdXRpbWUuanNcIjtcclxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUsIGNvbGxlY3RXZWJnbExheWVycywgY29sbGVjdFBvaW50TGF5ZXJzQWxsLFxyXG4gICAgICAgICBhcHBseVN3aWZ0bWFwUGF0Y2gsIGJ1ZmZlclNlcmlhbCB9IGZyb20gXCIuL3BhdGNoLmpzXCI7XHJcblxyXG4vLyBUaGUgc2lkZWJhcidzIHRvZ2dsZSB3cml0ZS1iYWNrOiB0YXJnZXRlZCB2aXNpYmlsaXR5IGZsaXBzIHRocm91Z2ggc2VuZCgpLFxyXG4vLyBuZXZlciB0aGUgbGF5ZXJzIHRyYWl0LiBUaGUgZnVsbCB3cml0ZSBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlXHJcbi8vIGNsaWNrIC0tIDM2IE1CIGF0IDI1IHRyYWNrcyB4IDIwMGsgdmVydGljZXMsIHBhc3QgdXZpY29ybidzIDE2IE1CIGRlZmF1bHRcclxuLy8gd2Vic29ja2V0IGNhcCwgd2hpY2ggY2xvc2VzIHRoZSBjb25uZWN0aW9uIGFuZCBlbmRzIHRoZSBTaGlueSBzZXNzaW9uLlxyXG5leHBvcnQgZnVuY3Rpb24gc2VuZExheWVyV3JpdGUoaG9zdCwgY2hhbmdlcykge1xyXG4gICAgaWYgKCFjaGFuZ2VzLmxlbmd0aCkgcmV0dXJuO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBob3N0LnNlbmQoe1xyXG4gICAgICAgICAgICBraW5kOiBcInN3aWZ0bWFwX3dyaXRlXCIsXHJcbiAgICAgICAgICAgIG9wczogY2hhbmdlcy5tYXAoYyA9PiAoeyBvcDogXCJzZXRcIiwgaWQ6IGMuaWQsIGZpZWxkczogeyB2aXNpYmxlOiBjLnZpc2libGUgfSB9KSksXHJcbiAgICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgcmVuZGVyZWQgbGlzdCBhbHJlYWR5IGhvbGRzIHRoZSBjaGFuZ2UgKi8gfVxyXG59XHJcblxyXG4vLyBNb3VudHMgb25lIHN3aWZ0bWFwIG1hcCBpbnRvIGBlbGAsIGRyaXZlbiBieSBhIGhvc3QgLS0gc2VlIHNyYy9ob3N0LmpzIGZvciB0aGVcclxuLy8gaW50ZXJmYWNlLiBUaGUgd2lkZ2V0LCBhIHN0YXRpYyBleHBvcnQgYW5kIGEgUmVhY3QgY29tcG9uZW50IGFyZSBhbGwgaG9zdHMgb3ZlclxyXG4vLyB0aGlzIG9uZSBmdW5jdGlvbjsgaXQgbmV2ZXIgc2VlcyBhbiBhbnl3aWRnZXQgbW9kZWwsIG9ubHkgdGhlIGZpdmUgaG9zdCBtZXRob2RzLlxyXG4vL1xyXG4vLyBSZXR1cm5zIGEgaGFuZGxlOiB0aGUgTGVhZmxldCBtYXAsIHRoZSBjb250YWluZXIgZWxlbWVudCwgYSBgc3luY2AgdG8gZm9yY2UgYVxyXG4vLyByZS1yZW5kZXIsIGFuZCBgZGVzdHJveWAgdG8gdGVhciBldmVyeXRoaW5nIGRvd24uXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVTd2lmdE1hcCh7IGhvc3QsIGVsLCBsZWFmbGV0ID0gbnVsbCB9KSB7XHJcbiAgICAvLyBMZWFmbGV0IC0tIHdpdGggZ2xpZnkgYW5kIEdlb21hbiBhdHRhY2hlZCAtLSBjb21lcyBmcm9tIHRoZSBob3N0LCBhbmQgaXRcclxuICAgIC8vIG11c3QgYWxyZWFkeSBiZSBoZXJlOiB0aGUgbWFwIGJlbG93IGlzIGJ1aWx0IGZyb20gaXQsIGFuZCBHZW9tYW4ncyBpbml0XHJcbiAgICAvLyBob29rIG9ubHkgcmVhY2hlcyBtYXBzIGNyZWF0ZWQgYWZ0ZXIgdGhlIHBsdWdpbiBleGlzdHMuXHJcbiAgICBpZiAobGVhZmxldCkgcHJvdmlkZUxlYWZsZXQobGVhZmxldCk7XHJcbiAgICByZXF1aXJlTGVhZmxldCgpO1xyXG5cclxuICAgIC8vIEV2ZXJ5IGhvc3Qgc3Vic2NyaXB0aW9uLCBzbyBkZXN0cm95KCkgY2FuIHVuc3Vic2NyaWJlIGZyb20gYSBob3N0IHRoYXRcclxuICAgIC8vIG9mZmVycyBgb2ZmYCAoYW55d2lkZ2V0J3MgbW9kZWwgZG9lczsgYSBtaW5pbWFsIHN0dWIgbWF5IG5vdCkuXHJcbiAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gW107XHJcbiAgICBmdW5jdGlvbiBsaXN0ZW4oZXZlbnQsIGZuKSB7XHJcbiAgICAgICAgc3Vic2NyaXB0aW9ucy5wdXNoKFtldmVudCwgZm5dKTtcclxuICAgICAgICBob3N0Lm9uKGV2ZW50LCBmbik7XHJcbiAgICB9XHJcbiAgICBsZXQgZGVzdHJveWVkID0gZmFsc2U7XHJcblxyXG4gICAgY29uc3Qgb3JpZ2luYWxFcnJvciA9IGNvbnNvbGUuZXJyb3I7XHJcbiAgICBjb25zdCBvcmlnaW5hbFdhcm4gPSBjb25zb2xlLndhcm47XHJcblxyXG4gICAgLy8ganNfY29uc29sZV9sb2dzIGlzIGEgc3luY2VkIGxpc3QsIHNvIGVhY2ggYXBwZW5kIHJlc2VuZHMgdGhlIHdob2xlIGFycmF5LiBLZWVwaW5nXHJcbiAgICAvLyBvbmx5IHRoZSBtb3N0IHJlY2VudCBlbnRyaWVzIGJvdW5kcyBib3RoIHRoZSBwYXlsb2FkIGFuZCB0aGUgbWVtb3J5IGEgbG9uZy1saXZlZFxyXG4gICAgLy8gc2Vzc2lvbiBhY2N1bXVsYXRlczsgdGhlIG5ld2VzdCBhcmUgdGhlIG9uZXMgd29ydGggaGF2aW5nIGFueXdheS5cclxuICAgIGNvbnN0IE1BWF9DT05TT0xFX0xPR1MgPSAyMDA7XHJcbiAgICBjb25zdCBhcHBlbmRMb2cgPSBlbnRyeSA9PiB7XHJcbiAgICAgICAgY29uc3QgbG9ncyA9IGhvc3QuZ2V0KFwianNfY29uc29sZV9sb2dzXCIpIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IG5leHQgPSBbLi4ubG9ncywgZW50cnldO1xyXG4gICAgICAgIHJldHVybiBuZXh0Lmxlbmd0aCA+IE1BWF9DT05TT0xFX0xPR1MgPyBuZXh0LnNsaWNlKC1NQVhfQ09OU09MRV9MT0dTKSA6IG5leHQ7XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEhlbHBlciB0byBzYWZlbHkgd3JpdGUgYmFjayB0byBQeXRob24gb25seSBpZiB0aGUgd2lkZ2V0IHZpZXcgaXMgYWN0aXZlIGFuZCBhdHRhY2hlZFxyXG4gICAgZnVuY3Rpb24gc2FmZVNldEFuZFNhdmUoa2V5LCB2YWx1ZSkge1xyXG4gICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoa2V5LCB2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHdyaXRlIGVycm9yOlwiLCBlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBzYWZlU2F2ZUNoYW5nZXMoKSB7XHJcbiAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHNhdmUgZXJyb3I6XCIsIGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUuZXJyb3IgPSBmdW5jdGlvbiguLi5hcmdzKSB7XHJcbiAgICAgICAgb3JpZ2luYWxFcnJvci5hcHBseShjb25zb2xlLCBhcmdzKTtcclxuICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxyXG4gICAgICAgICAgICBhcHBlbmRMb2coXCJDT05TT0xFLkVSUk9SOiBcIiArIGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKSkpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgbGV0IGxvZ2dlZFJlcHJvamVjdGVkID0gZmFsc2U7XHJcbiAgICBjb25zb2xlLndhcm4gPSBmdW5jdGlvbiguLi5hcmdzKSB7XHJcbiAgICAgICAgY29uc3QgbXNnID0gYXJncy5tYXAoYSA9PiBTdHJpbmcoYSkpLmpvaW4oXCIgXCIpO1xyXG4gICAgICAgIGlmIChtc2cuaW5jbHVkZXMoXCJsYXllciBkZXNpZ25lZCBmb3IgU3BoZXJpY2FsTWVyY2F0b3JcIikgfHwgbXNnLmluY2x1ZGVzKFwiYWx0ZXJuYXRlIGRldGVjdGVkXCIpKSB7XHJcbiAgICAgICAgICAgIGlmICghbG9nZ2VkUmVwcm9qZWN0ZWQpIHtcclxuICAgICAgICAgICAgICAgIGxvZ2dlZFJlcHJvamVjdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNycyA9IGhvc3QuZ2V0KFwiY3JzXCIpIHx8IFwiRVBTRzozODU3XCI7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjbGVhbk1zZyA9IGBbU3dpZnRNYXBdIExheWVyIHdhcyByZXByb2plY3RlZCB0byBcIiR7Y3JzfVwiYDtcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIiwgYXBwZW5kTG9nKGNsZWFuTXNnKSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuOyAvLyBzdXBwcmVzcyBkdXBsaWNhdGUgY29uc29sZSB3YXJuaW5nc1xyXG4gICAgICAgIH1cclxuICAgICAgICBvcmlnaW5hbFdhcm4uYXBwbHkoY29uc29sZSwgYXJncyk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG9uV2luZG93RXJyb3IgPSBmdW5jdGlvbihtZXNzYWdlLCBzb3VyY2UsIGxpbmVubywgY29sbm8sIGVycm9yKSB7XHJcbiAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIixcclxuICAgICAgICAgICAgYXBwZW5kTG9nKGBXSU5ET1cuT05FUlJPUjogJHttZXNzYWdlfSBhdCAke3NvdXJjZX06JHtsaW5lbm99OiR7Y29sbm99YCkpO1xyXG4gICAgfTtcclxuICAgIHdpbmRvdy5vbmVycm9yID0gb25XaW5kb3dFcnJvcjtcclxuXHJcbiAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgY29udGFpbmVyLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtY29udGFpbmVyXCI7XHJcbiAgICBjb250YWluZXIuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcclxuICAgIGNvbnRhaW5lci5zdHlsZS5wb3NpdGlvbiA9IFwicmVsYXRpdmVcIjtcclxuICAgIGVsLmFwcGVuZENoaWxkKGNvbnRhaW5lcik7XHJcblxyXG4gICAgLy8gTWFwKGhlaWdodD0uLi4pIHNpemluZy4gQW4gZXhwbGljaXQgaGVpZ2h0IGFsc28gZHJvcHMgdGhlIHN0eWxlc2hlZXQnc1xyXG4gICAgLy8gNDAwcHggZmxvb3IgLS0gYW4gZXhwbGljaXQgMjAwcHggbXVzdCBub3QgbG9zZSB0byBhIGRlZmF1bHQgbWluaW11bS5cclxuICAgIC8vIEhlaWdodCB3YXMgYWNjZXB0ZWQgYW5kIGRvY3VtZW50ZWQgbG9uZyBiZWZvcmUgaXQgcmVhY2hlZCB0aGUgRE9NOyB0aGlzXHJcbiAgICAvLyBpcyB3aGVyZSBpdCBmaW5hbGx5IGRvZXMuXHJcbiAgICBmdW5jdGlvbiBhcHBseUhlaWdodCgpIHtcclxuICAgICAgICBjb25zdCBoID0gaG9zdC5nZXQoXCJoZWlnaHRcIik7XHJcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLmhlaWdodCA9IGggfHwgXCIxMDAlXCI7XHJcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLm1pbkhlaWdodCA9IGggPyBcIjBcIiA6IFwiXCI7XHJcbiAgICB9XHJcbiAgICBhcHBseUhlaWdodCgpO1xyXG5cclxuICAgIGxldCBsYWJlbHNHcm91cCA9IG51bGw7ICAgLy8gY3JlYXRlZCBhZnRlciB0aGUgbWFwOyBmaWxsZWQgYnkgZWFjaCBzeW5jXHJcblxyXG4gICAgY29uc3QgY3JzTmFtZSA9IGhvc3QuZ2V0KFwiY3JzXCIpO1xyXG4gICAgbGV0IG1hcENycyA9IEwuQ1JTLkVQU0czODU3O1xyXG4gICAgaWYgKGNyc05hbWUgPT09IFwiRVBTRzo0MzI2XCIpIHtcclxuICAgICAgICBtYXBDcnMgPSBMLkNSUy5FUFNHNDMyNjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtYXAgPSBMLm1hcChjb250YWluZXIsIHtcclxuICAgICAgICBjcnM6IG1hcENycyxcclxuICAgICAgICBjZW50ZXI6IGhvc3QuZ2V0KFwiY2VudGVyXCIpLFxyXG4gICAgICAgIHpvb206IGhvc3QuZ2V0KFwiem9vbVwiKSxcclxuICAgICAgICBzY3JvbGxXaGVlbFpvb206IHRydWUsXHJcbiAgICAgICAgcHJlZmVyQ2FudmFzOiB0cnVlXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgY3VzdG9tIHBhbmVzIGZvciBzdHJpY3QgWi1pbmRleCBvcmRlcmluZ1xyXG4gICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5Z29uc1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInBvbHlnb25zUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQxMFwiO1xyXG4gICAgXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlsaW5lc1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInBvbHlsaW5lc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MjBcIjtcclxuICAgIFxyXG4gICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2ludHNQYW5lXCIpO1xyXG4gICAgbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDMwXCI7XHJcblxyXG4gICAgLy8gRHJhd24gdmVjdG9ycyBsaXZlIEFCT1ZFIHRoZSBHTCBwYW5lcy4gR2VvbWFuIGRlZmF1bHRzIHRoZW0gaW50byBMZWFmbGV0J3NcclxuICAgIC8vIG92ZXJsYXlQYW5lICg0MDApLCB3aGljaCBzaXRzIHVuZGVyIHRoZSBHTCBjYW52YXNlcyAoNDEwLzQyMC80MzApIHdob3NlXHJcbiAgICAvLyBwb2ludGVyLWV2ZW50cyBhcmUgZm9yY2VkIG9uIC0tIHNvIHdpdGggYW55IEdMIGxheWVyIHByZXNlbnQsIGNsaWNrcyBtZWFudFxyXG4gICAgLy8gZm9yIGEgZHJhd24gc2hhcGUgbmV2ZXIgYXJyaXZlZDogZHJhd2luZyB3b3JrZWQgKEdlb21hbiBsaXN0ZW5zIG9uIHRoZVxyXG4gICAgLy8gY29udGFpbmVyKSB3aGlsZSByZW1vdmFsLCBlZGl0IGFuZCBkcmFnIHNpbGVudGx5IGRpZCBub3RoaW5nLlxyXG4gICAgbWFwLmNyZWF0ZVBhbmUoXCJzd2lmdG1hcERyYXdQYW5lXCIpO1xyXG4gICAgbWFwLmdldFBhbmUoXCJzd2lmdG1hcERyYXdQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDQwXCI7XHJcblxyXG4gICAgbGFiZWxzR3JvdXAgPSBMLmxheWVyR3JvdXAoKS5hZGRUbyhtYXApO1xyXG5cclxuICAgIC8vIExvY2FsIG1pcnJvcnMgb2YgdGhlIGxheWVyIGxpc3QgYW5kIGNvb3JkaW5hdGUgYnVmZmVycy5cclxuICAgIC8vXHJcbiAgICAvLyBQeXRob24gdXBkYXRlcyB0aGVzZSBpbmNyZW1lbnRhbGx5IHZpYSBcInN3aWZ0bWFwX3BhdGNoXCIgbWVzc2FnZXMgaW5zdGVhZCBvZlxyXG4gICAgLy8gcmVhc3NpZ25pbmcgdGhlIHRyYWl0cywgYmVjYXVzZSBhIHRyYWl0IHJlYXNzaWdubWVudCByZS1zZXJpYWxpemVzIGFuZCByZS1zZW5kc1xyXG4gICAgLy8gdGhlIGVudGlyZSBtYXAgb24gZXZlcnkgbXV0YXRpb24uIFRoZSB0cmFpdHMgc3RpbGwgY2FycnkgdGhlIGluaXRpYWwgc25hcHNob3RcclxuICAgIC8vIHdoZW4gYSB2aWV3IGF0dGFjaGVzLCBhbmQgdGhlIHNpZGViYXIgc3RpbGwgd3JpdGVzIGBsYXllcnNgIGJhY2sgb24gdG9nZ2xlLCBzb1xyXG4gICAgLy8gYm90aCBhcmUgc2VlZGVkIGhlcmUgYW5kIGtlcHQgaW4gc3RlcCBieSB0aGUgY2hhbmdlIGhhbmRsZXJzIGZ1cnRoZXIgZG93bi5cclxuICAgIGxldCBsYXllclN0YXRlID0gaG9zdC5nZXQoXCJsYXllcnNcIikgfHwgW107XHJcbiAgICBsZXQgYnVmZmVyU3RhdGUgPSB7IC4uLihob3N0LmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcclxuXHJcbiAgICBmdW5jdGlvbiBhcHBseVBhdGNoT3BzKG9wcywgYnVmZmVycykge1xyXG4gICAgICAgIGNvbnN0IG5leHQgPSBhcHBseVN3aWZ0bWFwUGF0Y2goeyBsYXllcnM6IGxheWVyU3RhdGUsIGJ1ZmZlcnM6IGJ1ZmZlclN0YXRlIH0sIG9wcywgYnVmZmVycyk7XHJcbiAgICAgICAgbGF5ZXJTdGF0ZSA9IG5leHQubGF5ZXJzO1xyXG4gICAgICAgIGJ1ZmZlclN0YXRlID0gbmV4dC5idWZmZXJzO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIExpdmUgZmVhdHVyZSB2aXNpYmlsaXR5LCBmb3IgaGl0LXRlc3RpbmcuIEdQVS1wYXRoIGJ1Y2tldHMga2VlcCBFVkVSWVxyXG4gICAgLy8gbGF5ZXIgLS0gaGlkZGVuIG9uZXMgYXJlIG1hc2tlZCBieSBhIHNoYWRlciB1bmlmb3JtIC0tIGFuZCBnbGlmeSdzXHJcbiAgICAvLyBoaXQtdGVzdHMgcnVuIGFnYWluc3QgdGhlIGJ1Y2tldCdzIGRhdGEsIHdoaWNoIGNhbm5vdCBzZWUgdW5pZm9ybXM6IGFcclxuICAgIC8vIHJhZGlvLWhpZGRlbiBsYXllcidzIGZlYXR1cmVzIHN0aWxsIHdvbiBjbGlja3MgYW5kIGFuc3dlcmVkIHdpdGggcG9wdXBzLlxyXG4gICAgLy8gTG9va2VkIHVwIGZyZXNoIHBlciBldmVudCwgYmVjYXVzZSB0aGUgY29uZmlnIGNhcHR1cmVkIGF0IGJ1aWxkIHRpbWUgZ29lc1xyXG4gICAgLy8gc3RhbGUgdGhlIG1vbWVudCBhIHBhdGNoIG9wIHJlcGxhY2VzIGl0OyB0aGUgdGltZSBjaGVjayByZWFkcyB0aGUgbGl2ZVxyXG4gICAgLy8gdGljayB0aGUgc2FtZSB3YXksIHNpbmNlIHRpY2tzIGNoYW5nZSB3aXRob3V0IHJlYnVpbGRpbmcgdGhlIGJ1Y2tldC5cclxuICAgIGZ1bmN0aW9uIGZpbmRMYXllck5vdyhsaXN0LCBpZCkge1xyXG4gICAgICAgIGZvciAoY29uc3QgbCBvZiBsaXN0KSB7XHJcbiAgICAgICAgICAgIGlmIChsLmlkID09PSBpZCkgcmV0dXJuIGw7XHJcbiAgICAgICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIikge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3ViID0gZmluZExheWVyTm93KGwubGF5ZXJzIHx8IFtdLCBpZCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoc3ViKSByZXR1cm4gc3ViO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgZnVuY3Rpb24gZmVhdHVyZVZpc2libGVOb3cobGF5ZXIsIGluZGV4KSB7XHJcbiAgICAgICAgY29uc3QgY3VycmVudCA9IGZpbmRMYXllck5vdyhsYXllclN0YXRlLCBsYXllci5pZCkgfHwgbGF5ZXI7XHJcbiAgICAgICAgaWYgKCFpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShjdXJyZW50LCBob3N0LmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge30pKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFjdXJyZW50LnRpbWUgfHwgIXRpbWVTdGF0ZSkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihjdXJyZW50LCBidWZmZXJTdGF0ZSk7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLFxyXG4gICAgICAgICAgICBlZmZlY3RpdmVEdXJhdGlvbihjdXJyZW50LCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKTtcclxuICAgICAgICBpZiAoaW5kZXggIT0gbnVsbCAmJiB0aW1lcy5sZW5ndGggPiAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gdGltZXNbaW5kZXggKiAyXTtcclxuICAgICAgICAgICAgcmV0dXJuIE51bWJlci5pc05hTihzdGFydClcclxuICAgICAgICAgICAgICAgIHx8IGZlYXR1cmVJbldpbmRvdyhzdGFydCwgdGltZXNbaW5kZXggKiAyICsgMV0sIHdpbik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSlcclxuICAgICAgICAgICAgICAgICAgICB8fCBmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBGZWF0dXJlIGNsaWNrcywgd3JpdHRlbiB0byB0aGUgaG9zdCBCQVJFIC0tIG5vIGdhdGluZyBvbiBhIGNvbW0gcHJvcGVydHk6XHJcbiAgICAvLyBzaGlueXdpZGdldHMnIG1vZGVsIGhhcyBub25lLCBhbmQgZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCBldmVyeVxyXG4gICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBPbmUga2V5IGFsd2F5cyBhbnN3ZXJzIFwid2hlcmVcIiAoY2xpY2tlZF9sYXRsbmcpLFxyXG4gICAgLy8gY2xpY2tlZF9sYXllcl9pZCBhbnN3ZXJzIFwib24gd2hhdFwiIChcIlwiIGZvciBvcGVuIG1hcCksIGFuZCBjbGlja19zZXEgYnVtcHNcclxuICAgIC8vIG9uIEVWRVJZIGNsaWNrIHNvIGEgcmVwZWF0IGNsaWNrIG9uIHRoZSBzYW1lIGZlYXR1cmUgc3RpbGwgZmlyZXMuXHJcbiAgICBjb25zdCBsYXllckV2ZW50cyA9IHtcclxuICAgICAgICBvbkZlYXR1cmVDbGljazogKHsgbGF5ZXIsIGluZGV4LCBsYXRsbmcgfSkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgaW5kZXgpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLCBsYXRsbmcpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja19zZXFcIiwgKGhvc3QuZ2V0KFwiY2xpY2tfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cclxuICAgICAgICB9LFxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBhY3RpdmVUaWxlTGF5ZXJzID0ge307XHJcbiAgICBjb25zdCBhY3RpdmVPdmVybGF5TGF5ZXJzID0ge307XHJcbiAgICBjb25zdCBnbFN0YXRlcyA9IHtcclxuICAgICAgICBjaXJjbGVfbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXHJcbiAgICAgICAgbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXHJcbiAgICAgICAgcG9seWxpbmU6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxyXG4gICAgICAgIHBvbHlnb246IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFRoZSBzaGFyZWQgdGltZSBzbGlkZXIuIGB0aW1lU3RhdGVgIGlzIHdoYXQgcmVuZGVyaW5nIHJlYWRzIC0tIHRoZSBjdXJyZW50IHRpY2tcclxuICAgIC8vIGFuZCB0aGUgcGVyaW9kLCBvciBudWxsIHdoZW4gbm90aGluZyBpcyBhbmltYXRlZCAtLSBhbmQgYHRpbWVVSWAgaXMgdGhlIHNsaWRlcidzXHJcbiAgICAvLyBvd24gYm9va2tlZXBpbmcuIFBsYXliYWNrIG5ldmVyIHJvdW5kLXRyaXBzIHRocm91Z2ggUHl0aG9uOiB0aWNrcyByZS1yZW5kZXJcclxuICAgIC8vIGxvY2FsbHksIGFuZCB0aW1lX2N1cnJlbnQgaXMgd3JpdHRlbiBiYWNrIGF0IG1vc3Qgb25jZSBhIHNlY29uZCB3aGlsZSBwbGF5aW5nLlxyXG4gICAgbGV0IHRpbWVTdGF0ZSA9IG51bGw7XHJcbiAgICBjb25zdCB0aW1lVUkgPSB7IHRpY2tzOiBbXSwga2V5OiBcIlwiLCBpbmRleDogMCwgcGxheWluZzogZmFsc2UsIGxvb3A6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICBzcGVlZDogMSwgdGltZXI6IG51bGwsIGxhc3RXcml0ZTogMCwgc3RhcnRlZDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogbnVsbCwgcGVyaW9kTXM6IG51bGwsIGdyaWRNczogbnVsbCB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIHN0b3BQbGF5YmFjaygpIHtcclxuICAgICAgICBpZiAodGltZVVJLnRpbWVyKSBjbGVhckludGVydmFsKHRpbWVVSS50aW1lcik7XHJcbiAgICAgICAgdGltZVVJLnRpbWVyID0gbnVsbDtcclxuICAgICAgICB0aW1lVUkucGxheWluZyA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHdyaXRlVGltZUN1cnJlbnQoZm9yY2UpIHtcclxuICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgIGlmICghZm9yY2UgJiYgbm93IC0gdGltZVVJLmxhc3RXcml0ZSA8IDEwMDApIHJldHVybjtcclxuICAgICAgICB0aW1lVUkubGFzdFdyaXRlID0gbm93O1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0KFwidGltZV9jdXJyZW50XCIsIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKTtcclxuICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBzZWVrVG8oaW5kZXgsIHsgd3JpdGUgPSB0cnVlIH0gPSB7fSkge1xyXG4gICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgIHRpbWVTdGF0ZSA9IHsgdGljazogdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0sIHBlcmlvZDogdGltZVN0YXRlLnBlcmlvZCxcclxuICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xyXG4gICAgICAgIGlmICh3cml0ZSkgd3JpdGVUaW1lQ3VycmVudCghdGltZVVJLnBsYXlpbmcpO1xyXG4gICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gc3RhcnRQbGF5YmFjaygpIHtcclxuICAgICAgICBzdG9wUGxheWJhY2soKTtcclxuICAgICAgICB0aW1lVUkucGxheWluZyA9IHRydWU7XHJcbiAgICAgICAgdGltZVVJLnRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gYWR2YW5jZSh0aW1lVUkuaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGgsIHRpbWVVSS5sb29wKTtcclxuICAgICAgICAgICAgaWYgKCFuZXh0LnBsYXlpbmcpIHtcclxuICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgc2Vla1RvKG5leHQuaW5kZXgpO1xyXG4gICAgICAgIH0sIDEwMDAgLyB0aW1lVUkuc3BlZWQpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHRpbWVIYW5kbGVycyA9IHtcclxuICAgICAgICBvblNlZWs6IChpbmRleCkgPT4gc2Vla1RvKGluZGV4KSxcclxuICAgICAgICBvblN0ZXBCYWNrOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4IC0gMSksXHJcbiAgICAgICAgb25TdGVwRm9yd2FyZDogKCkgPT4gc2Vla1RvKHRpbWVVSS5pbmRleCArIDEpLFxyXG4gICAgICAgIG9uUGxheVRvZ2dsZTogKCkgPT4ge1xyXG4gICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHtcclxuICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vIHN0YXJ0T3ZlciwgYXMgdGhlIGZvbGl1bSBwbGF5ZXIgd2FzIGNvbmZpZ3VyZWQ6IHByZXNzaW5nIHBsYXkgYXRcclxuICAgICAgICAgICAgICAgIC8vIHRoZSBlbmQgcmVzdGFydHMgZnJvbSB0aGUgYmVnaW5uaW5nIGltbWVkaWF0ZWx5LCByYXRoZXIgdGhhbiBvbmVcclxuICAgICAgICAgICAgICAgIC8vIHNpbGVudCBpbnRlcnZhbCBsYXRlciBkZWNpZGluZyB0aGVyZSBpcyBub3doZXJlIHRvIGdvIGFuZCBzdG9wcGluZy5cclxuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkuaW5kZXggPj0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpIHNlZWtUbygwKTtcclxuICAgICAgICAgICAgICAgIHN0YXJ0UGxheWJhY2soKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb25Mb29wVG9nZ2xlOiAoKSA9PiB7XHJcbiAgICAgICAgICAgIHRpbWVVSS5sb29wID0gIXRpbWVVSS5sb29wO1xyXG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb25TcGVlZDogKHNwZWVkKSA9PiB7XHJcbiAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IHNwZWVkO1xyXG4gICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHN0YXJ0UGxheWJhY2soKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIExpdmUgZHVyaW5nIHRoZSBkcmFnOiBsb2NhbCBzdGF0ZSBhbmQgYSByZS1yZW5kZXIgb2YgdGhlIGNvbnRyb2wgb24gZXZlcnlcclxuICAgICAgICAvLyBtb3ZlLCBidXQgbWFwIHJlYnVpbGRzIGF0IG1vc3QgZXZlcnkgMzAwbXMuIEF0IDVNIHBvaW50cyBhIHJlYnVpbGQgY29zdHNcclxuICAgICAgICAvLyBzZWNvbmRzLCBhbmQgYSBkcmFnIGZpcmVzIGRvemVucyBvZiBtb3ZlcyAtLSB1bnRocm90dGxlZCwgdGhlIHJlYnVpbGRzXHJcbiAgICAgICAgLy8gc3RhY2sgZmFzdGVyIHRoYW4gdGhleSBmaW5pc2ggYW5kIHRoZSBhbGxvY2F0aW9uIGNodXJuIGNyYXNoZXMgdGhlIHRhYi5cclxuICAgICAgICBvbldpbmRvd0RyYWc6IChpc28pID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLmRyYWdBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICB0aW1lVUkud2luZG93ID0gaXNvO1xyXG4gICAgICAgICAgICBpZiAodGltZVN0YXRlKSB0aW1lU3RhdGUgPSB7IC4uLnRpbWVTdGF0ZSwgd2luZG93OiBpc28gfTtcclxuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICAgICAgaWYgKG5vdyAtICh0aW1lVUkubGFzdERyYWdTeW5jIHx8IDApID49IDMwMCkge1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLmxhc3REcmFnU3luYyA9IG5vdztcclxuICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICAvLyBPbiByZWxlYXNlIChvciBhIGtleWJvYXJkIHN0ZXApOiB0aGUgb3ZlcnJpZGUgbGFuZHMgaW4gdGltZV9jb25maWcgc29cclxuICAgICAgICAvLyBQeXRob24gYW5kIFNoaW55IHNlZSB0aGUgc2FtZSB3aW5kb3cgdGhlIGJhciBzaG93cy4gbnVsbCBjbGVhcnMgdGhlIGtleSxcclxuICAgICAgICAvLyBoYW5kaW5nIGNvbnRyb2wgYmFjayB0byBwZXItbGF5ZXIgZHVyYXRpb25zLlxyXG4gICAgICAgIG9uV2luZG93Q29tbWl0OiAoaXNvKSA9PiB7XHJcbiAgICAgICAgICAgIHRpbWVIYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcclxuICAgICAgICAgICAgdGltZVVJLmRyYWdBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgcXVldWVTeW5jKCk7ICAgICAgIC8vIHRoZSByZWxlYXNlIGFsd2F5cyBsYW5kcywgdGhyb3R0bGUgb3Igbm90XHJcbiAgICAgICAgICAgIGNvbnN0IGNmZyA9IHsgLi4uKGhvc3QuZ2V0KFwidGltZV9jb25maWdcIikgfHwge30pIH07XHJcbiAgICAgICAgICAgIGlmIChpc28pIGNmZy53aW5kb3cgPSBpc287XHJcbiAgICAgICAgICAgIGVsc2UgZGVsZXRlIGNmZy53aW5kb3c7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcInRpbWVfY29uZmlnXCIsIGNmZyk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgbG9jYWwgaG9zdCBzdGlsbCBob2xkcyBpdCAqLyB9XHJcbiAgICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgLy8gQ3JlYXRlcywgcmV0dW5lcyBvciByZW1vdmVzIHRoZSBzbGlkZXIgdG8gbWF0Y2ggdGhlIGxheWVycyBwcmVzZW50LiBUaWNrcyBhcmVcclxuICAgIC8vIHJlZ2VuZXJhdGVkIG9ubHkgd2hlbiB0aGUgZGF0YSdzIHRpbWUgZXh0ZW50IG9yIHRoZSBwZXJpb2QgY2hhbmdlcywgc28gYVxyXG4gICAgLy8gcGxheWJhY2sgdGljayAtLSB3aGljaCByZS1lbnRlcnMgaGVyZSB2aWEgcXVldWVTeW5jIC0tIGRvZXMgbm90IHJlYnVpbGQgdGhlbS5cclxuICAgIGZ1bmN0aW9uIHVwZGF0ZVRpbWVEaW1lbnNpb24oKSB7XHJcbiAgICAgICAgaWYgKCFoYXNUaW1lTGF5ZXJzKGxheWVyU3RhdGUpKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcclxuICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHsgdGlja3M6IFtdIH0sIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IFwiXCI7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgY2ZnID0gaG9zdC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCBwZXJpb2QgPSBwYXJzZVBlcmlvZChjZmcucGVyaW9kIHx8IFwiUDFEXCIpIHx8IHBhcnNlUGVyaW9kKFwiUDFEXCIpO1xyXG4gICAgICAgIGNvbnN0IGV4dGVudCA9IGNvbGxlY3RUaW1lRXh0ZW50KGxheWVyU3RhdGUsIGJ1ZmZlclN0YXRlKTtcclxuICAgICAgICBpZiAoIWV4dGVudCkgcmV0dXJuO1xyXG5cclxuICAgICAgICBjb25zdCBrZXkgPSBgJHtleHRlbnQubWlufXwke2V4dGVudC5tYXh9fCR7Y2ZnLnBlcmlvZCB8fCBcIlAxRFwifWA7XHJcbiAgICAgICAgaWYgKGtleSAhPT0gdGltZVVJLmtleSkge1xyXG4gICAgICAgICAgICAvLyBUaGUgcGxheWhlYWQgaXMgYSBNT01FTlQsIG5vdCBhbiBpbmRleC4gTGF0ZSBkYXRhIHByZXBlbmRzIHRpY2tzXHJcbiAgICAgICAgICAgIC8vIGFuZCBhIGdyb3duIGV4dGVudCBhcHBlbmRzIHRoZW07IHRoZSB1c2VyJ3MgcG9zaXRpb24gaW4gdGltZSBpcyBhXHJcbiAgICAgICAgICAgIC8vIGNob3NlbiB2aWV3IC0tIHRoZSBzYW1lIHJ1bGUgdGhhdCBrZWVwcyBhIGRhdGEgdXBkYXRlIGZyb20gbW92aW5nXHJcbiAgICAgICAgICAgIC8vIGEgY2hvc2VuIHZpZXdwb3J0IC0tIHNvIGl0IHNuYXBzIHRvIHRoZSBuZWFyZXN0IHRpY2sgb2YgdGhlIG5ld1xyXG4gICAgICAgICAgICAvLyBzZXJpZXMgYW5kIG5ldmVyIHJlc2V0cyB0byB0aGUgc3RhcnQsIHBhdXNlZCBvciBwbGF5aW5nIChwbGF5YmFja1xyXG4gICAgICAgICAgICAvLyBzaW1wbHkgY29udGludWVzIGZyb20gdGhlIHNuYXBwZWQgaW5kZXgpLlxyXG4gICAgICAgICAgICBjb25zdCBtb21lbnQgPSB0aW1lVUkudGlja3MubGVuZ3RoID8gdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0gOiBudWxsO1xyXG4gICAgICAgICAgICB0aW1lVUkua2V5ID0ga2V5O1xyXG4gICAgICAgICAgICB0aW1lVUkudGlja3MgPSBnZW5lcmF0ZVRpY2tzKGV4dGVudC5taW4sIGV4dGVudC5tYXgsIHBlcmlvZCk7XHJcbiAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IG1vbWVudCA9PT0gbnVsbCA/IDAgOiBuZWFyZXN0VGlja0luZGV4KHRpbWVVSS50aWNrcywgbW9tZW50KTtcclxuICAgICAgICAgICAgaWYgKG1vbWVudCAhPT0gbnVsbCAmJiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSAhPT0gbW9tZW50KSB7XHJcbiAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpOyAgIC8vIHRoZSBzZXJpZXMgcmVhbGlnbmVkOiB0ZWxsIFB5dGhvbiB3aGVyZSB3ZSBsYW5kZWRcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVGhlIHNoYXJlZCB3aW5kb3cgb3ZlcnJpZGUsIGNvbmZpZy1kcml2ZW47IGEgYmFkIHN0cmluZyBjbGVhcnMgcmF0aGVyIHRoYW5cclxuICAgICAgICAvLyBndWVzc2luZy4gVGhlIGRyYWcgZ3JpZCBpcyB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWRcclxuICAgICAgICAvLyBkdXJhdGlvbiAtLSB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gYWxsIG9mIHRoZW0gLS0gc28gYSAyLjVoIHRyYWlsXHJcbiAgICAgICAgLy8gaXMgZHJhZ2dhYmxlIG9uIGEgMWggYmFyLiBDYWxlbmRhciBwZXJpb2RzIGhhdmUgbm8gZml4ZWQgd2lkdGg7IHRoZSBydWxlclxyXG4gICAgICAgIC8vIHRoZW4gc2hvd3MgaW50ZXJ2YWwgbWFya3Mgb25seSBhbmQgdGhlIHRyYWlsIGhhbmRsZSBoaWRlcy5cclxuICAgICAgICAvLyBOZXZlciB3aGlsZSBhIGRyYWcgaXMgbGl2ZTogdGhlIGRyYWdnZWQgd2luZG93IGV4aXN0cyBvbmx5IGxvY2FsbHkgdW50aWxcclxuICAgICAgICAvLyByZWxlYXNlIGNvbW1pdHMgaXQsIGFuZCByZWFkaW5nIGNvbmZpZyBoZXJlIG1pZC1kcmFnIHJlc2V0IHRoZSBoYW5kbGUgdG9cclxuICAgICAgICAvLyBcIm5vIHdpbmRvd1wiIG9uIGV2ZXJ5IGRlYm91bmNlZCBzeW5jIC0tIHRoZSBoYW5kbGUgZm9sbG93ZWQgdGhlIG1vdXNlLCB0aGVuXHJcbiAgICAgICAgLy8gc25hcHBlZCBob21lLCB0aGVuIGZvbGxvd2VkIGFnYWluLCBvbmNlIHBlciBzeW5jLlxyXG4gICAgICAgIGlmICghdGltZVVJLmRyYWdBY3RpdmUpIHtcclxuICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGNmZy53aW5kb3cgJiYgcGFyc2VQZXJpb2QoY2ZnLndpbmRvdykgPyBjZmcud2luZG93IDogbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGltZVVJLnBlcmlvZE1zID0gcGVyaW9kVG9NcyhwZXJpb2QpO1xyXG4gICAgICAgIHRpbWVVSS5ncmlkTXMgPSB0aW1lVUkucGVyaW9kTXNcclxuICAgICAgICAgICAgPyBnY2RHcmlkTXModGltZVVJLnBlcmlvZE1zLCBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJTdGF0ZSwgdGltZVVJLndpbmRvdykpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuXHJcbiAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kLCB3aW5kb3c6IHRpbWVVSS53aW5kb3cgfTtcclxuICAgICAgICB0aW1lVUkucG9zaXRpb24gPSBjZmcucG9zaXRpb24gfHwgXCJ0b3AtY2VudGVyXCI7XHJcblxyXG4gICAgICAgIGlmICghdGltZVVJLnN0YXJ0ZWQpIHtcclxuICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBjZmcuc3BlZWQgfHwgMTtcclxuICAgICAgICAgICAgdGltZVVJLmxvb3AgPSBCb29sZWFuKGNmZy5sb29wKTtcclxuICAgICAgICAgICAgLy8gT25seSB0aGUgZmlyc3QgY29uZmlndXJhdGlvbiBtYXkgYXV0by1zdGFydC4gRXZlcnkgY29uZmlnIGNoYW5nZSByZXNldHNcclxuICAgICAgICAgICAgLy8gYHN0YXJ0ZWRgIHRvIHJlLXJlYWQgc3BlZWQgYW5kIGxvb3AgLS0gaW5jbHVkaW5nIHRoZSBjaGFuZ2UgYSB3aW5kb3dcclxuICAgICAgICAgICAgLy8gZHJhZyBjb21taXRzIC0tIGFuZCByZS1ydW5uaW5nIGF1dG9fcGxheSB0aGVyZSB3b3VsZCBzdGFydCBwbGF5YmFjayBhc1xyXG4gICAgICAgICAgICAvLyBhIHNpZGUgZWZmZWN0IG9mIHJlbGVhc2luZyB0aGUgaGFuZGxlLlxyXG4gICAgICAgICAgICBpZiAoY2ZnLmF1dG9fcGxheSAmJiAhdGltZVVJLmV2ZXJTdGFydGVkKSBzdGFydFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgIHRpbWVVSS5ldmVyU3RhcnRlZCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gU2lkZWJhciBMYXllcnMgQ29udHJvbCBVSVxyXG4gICAgY29uc3Qgc2lkZWJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBzaWRlYmFyLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtc2lkZWJhclwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgIHNpZGViYXIuc3R5bGUudG9wID0gXCIxMHB4XCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnJpZ2h0ID0gXCIxMHB4XCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5wYWRkaW5nID0gXCIxMHB4XCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5tYXhIZWlnaHQgPSBcIjgwJVwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcclxuICAgIHNpZGViYXIuc3R5bGUuZm9udEZhbWlseSA9IFwiLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU2Vnb2UgVUknLCBSb2JvdG8sIHNhbnMtc2VyaWZcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcclxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChzaWRlYmFyKTtcclxuXHJcbiAgICAvLyBMZWdlbmQ6IGRlcml2ZWQgZnJlc2ggb24gZXZlcnkgc3luYyBmcm9tIHRoZSBzYW1lIGxheWVyIHN0YXRlIHRoZSBzaWRlYmFyXHJcbiAgICAvLyByZW5kZXJzIGZyb20sIHNvIHRvZ2dsZXMgZGltIG9yIGRyb3Agcm93cyB3aXRoIG5vIGV4dHJhIHdpcmluZy4gSGlkZGVuXHJcbiAgICAvLyB1bnRpbCBzaG93X2xlZ2VuZCBhc2tzIGZvciBpdC5cclxuICAgIGNvbnN0IGxlZ2VuZERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBsZWdlbmREaXYuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1sZWdlbmRcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjVweFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLm1heFdpZHRoID0gXCIyNjBweFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLm1heEhlaWdodCA9IFwiNDUlXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUub3ZlcmZsb3dZID0gXCJhdXRvXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuZm9udEZhbWlseSA9IHNpZGViYXIuc3R5bGUuZm9udEZhbWlseTtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmNvbG9yID0gXCIjMzMzXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxlZ2VuZERpdik7XHJcblxyXG4gICAgLy8gTG9nb1xyXG4gICAgLy8gVGhlIGxvZ28gY2FyZDogdHdvIGFwcC1zdXBwbGllZCBzbG90cyBmcm9tIGxvZ29fY29uZmlnLCBubyBicmFuZGluZyBvZlxyXG4gICAgLy8gaXRzIG93bi4gV2l0aCB0aGUgY2FyZCBvbiBhbmQgbmVpdGhlciBzbG90IHNldCwgYSBnZW5lcmljIG1hcmsgc3RhbmRzIGluXHJcbiAgICAvLyAtLSBpbmxpbmUgU1ZHLCBzbyBpdCBuZWVkcyBubyBuZXR3b3JrIGFuZCBzdXJ2aXZlcyBhIHN0YXRpYyBleHBvcnQuXHJcbiAgICAvLyBCdWlsdCB3aXRoIGVsZW1lbnRzLCBub3QgaW5uZXJIVE1MLCBzbyBhbiBhbHQgdGV4dCBjYW5ub3QgaW5qZWN0IG1hcmt1cC5cclxuICAgIGNvbnN0IExPR09fUE9TSVRJT05TID0gbmV3IFNldChbXCJ0b3AtbGVmdFwiLCBcInRvcC1yaWdodFwiLCBcImJvdHRvbS1sZWZ0XCIsIFwiYm90dG9tLXJpZ2h0XCJdKTtcclxuICAgIGNvbnN0IERFRkFVTFRfTE9HTyA9IFwiZGF0YTppbWFnZS9zdmcreG1sO3V0ZjgsXCIgKyBlbmNvZGVVUklDb21wb25lbnQoXHJcbiAgICAgICAgJzxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHZpZXdCb3g9XCIwIDAgMTQwIDQwXCI+J1xyXG4gICAgICAgICsgJzxyZWN0IHdpZHRoPVwiMTQwXCIgaGVpZ2h0PVwiNDBcIiByeD1cIjhcIiBmaWxsPVwiIzFmNmZlYlwiLz4nXHJcbiAgICAgICAgKyAnPHRleHQgeD1cIjcwXCIgeT1cIjI2XCIgZm9udC1mYW1pbHk9XCJTZWdvZSBVSSwgSGVsdmV0aWNhLCBBcmlhbCwgc2Fucy1zZXJpZlwiICdcclxuICAgICAgICArICdmb250LXNpemU9XCIxOFwiIGZvbnQtd2VpZ2h0PVwiNjAwXCIgZmlsbD1cIiNmZmZcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiPnN3aWZ0bWFwPC90ZXh0PidcclxuICAgICAgICArICc8L3N2Zz4nKTtcclxuICAgIGNvbnN0IGxvZ29EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgbG9nb0Rpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxvZ29cIjtcclxuICAgIGxvZ29EaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5wYWRkaW5nID0gXCI1cHhcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI0cHhcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcclxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChsb2dvRGl2KTtcclxuXHJcbiAgICBmdW5jdGlvbiBzeW5jTG9nbygpIHtcclxuICAgICAgICBjb25zdCBzaG93ID0gQm9vbGVhbihob3N0LmdldChcInNob3dfbG9nb1wiKSk7XHJcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gc2hvdyA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xyXG4gICAgICAgIGxvZ29EaXYucmVwbGFjZUNoaWxkcmVuKCk7XHJcbiAgICAgICAgaWYgKCFzaG93KSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgY2ZnID0gaG9zdC5nZXQoXCJsb2dvX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCBoZWlnaHQgPSBOdW1iZXIoY2ZnLmhlaWdodCkgPiAwID8gTnVtYmVyKGNmZy5oZWlnaHQpIDogMzU7XHJcbiAgICAgICAgY29uc3QgcG9zaXRpb24gPSBMT0dPX1BPU0lUSU9OUy5oYXMoY2ZnLnBvc2l0aW9uKSA/IGNmZy5wb3NpdGlvbiA6IFwiYm90dG9tLXJpZ2h0XCI7XHJcbiAgICAgICAgZm9yIChjb25zdCBzaWRlIG9mIFtcInRvcFwiLCBcImJvdHRvbVwiLCBcImxlZnRcIiwgXCJyaWdodFwiXSkgbG9nb0Rpdi5zdHlsZVtzaWRlXSA9IFwiXCI7XHJcbiAgICAgICAgbG9nb0Rpdi5zdHlsZVtwb3NpdGlvbi5zdGFydHNXaXRoKFwidG9wXCIpID8gXCJ0b3BcIiA6IFwiYm90dG9tXCJdID0gXCIxMHB4XCI7XHJcbiAgICAgICAgbG9nb0Rpdi5zdHlsZVtwb3NpdGlvbi5lbmRzV2l0aChcImxlZnRcIikgPyBcImxlZnRcIiA6IFwicmlnaHRcIl0gPSBcIjEwcHhcIjtcclxuICAgICAgICBjb25zdCBzbG90cyA9IFtjZmcuY29tcGFueSwgY2ZnLnBhcmVudF9jb21wYW55XS5maWx0ZXIocyA9PiBzICYmIHMudXJsKTtcclxuICAgICAgICBjb25zdCBpbWFnZXMgPSBzbG90cy5sZW5ndGggPyBzbG90cyA6IFt7IHVybDogREVGQVVMVF9MT0dPLCBhbHQ6IFwic3dpZnRtYXBcIiB9XTtcclxuICAgICAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIHJvdy5zdHlsZS5kaXNwbGF5ID0gXCJmbGV4XCI7XHJcbiAgICAgICAgcm93LnN0eWxlLmFsaWduSXRlbXMgPSBcImNlbnRlclwiO1xyXG4gICAgICAgIHJvdy5zdHlsZS5nYXAgPSBcIjVweFwiO1xyXG4gICAgICAgIGZvciAoY29uc3QgaW1hZ2Ugb2YgaW1hZ2VzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGltZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbWdcIik7XHJcbiAgICAgICAgICAgIGltZy5zcmMgPSBpbWFnZS51cmw7XHJcbiAgICAgICAgICAgIGltZy5hbHQgPSBpbWFnZS5hbHQgfHwgXCJcIjtcclxuICAgICAgICAgICAgaW1nLnN0eWxlLmhlaWdodCA9IGAke2hlaWdodH1weGA7XHJcbiAgICAgICAgICAgIHJvdy5hcHBlbmRDaGlsZChpbWcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dvRGl2LmFwcGVuZENoaWxkKHJvdyk7XHJcbiAgICB9XHJcbiAgICBzeW5jTG9nbygpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmxvZ29fY29uZmlnXCIsIHN5bmNMb2dvKTtcclxuXHJcblxyXG5cclxuICAgIGZ1bmN0aW9uIGdldFRpbGVMYXllcihsYXllcikge1xyXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgIGF0dHJpYnV0aW9uOiBsYXllci5hdHRyaWJ1dGlvbiB8fCAnJyxcclxuICAgICAgICAgICAgbWF4Wm9vbTogbGF5ZXIubWF4X3pvb20gfHwgMjIsXHJcbiAgICAgICAgICAgIG1heE5hdGl2ZVpvb206IGxheWVyLm1heF9uYXRpdmVfem9vbSB8fCAxOVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgLy8geHl6c2VydmljZXMgcHJvdmlkZXJzIGRlY2xhcmUgdGhlaXIgb3duIHtzfSBob3N0czsgTGVhZmxldCdzXHJcbiAgICAgICAgLy8gZGVmYXVsdCBcImFiY1wiIGlzIHdyb25nIGZvciBhbnl0aGluZyBlbHNlLlxyXG4gICAgICAgIGlmIChsYXllci5zdWJkb21haW5zKSBvcHRpb25zLnN1YmRvbWFpbnMgPSBsYXllci5zdWJkb21haW5zO1xyXG4gICAgICAgIGlmIChsYXllci53bXMpIHtcclxuICAgICAgICAgICAgLy8gV01TIHJlcXVlc3QgQ1JTIGZvbGxvd3MgdGhlIG1hcCdzLCBzbyA0MzI2IG1hcHMgYXNrIGluIDQzMjYuXHJcbiAgICAgICAgICAgIHJldHVybiBMLnRpbGVMYXllci53bXMobGF5ZXIudXJsLCB7XHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgbGF5ZXJzOiBsYXllci53bXMubGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgZm9ybWF0OiBsYXllci53bXMuZm9ybWF0IHx8ICdpbWFnZS9wbmcnLFxyXG4gICAgICAgICAgICAgICAgdmVyc2lvbjogbGF5ZXIud21zLnZlcnNpb24gfHwgJzEuMS4xJyxcclxuICAgICAgICAgICAgICAgIHRyYW5zcGFyZW50OiAhIWxheWVyLndtcy50cmFuc3BhcmVudCxcclxuICAgICAgICAgICAgICAgIC4uLihsYXllci53bXMuc3R5bGVzID8geyBzdHlsZXM6IGxheWVyLndtcy5zdHlsZXMgfSA6IHt9KVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyKGxheWVyLnVybCwgb3B0aW9ucyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmV0aXJlIGEgZ2xpZnkgaW5zdGFuY2UgdGhlIHNhZmUgd2F5OiBpdHMgY2FudmFzIG92ZXJsYXkgbmV2ZXIgY2FuY2VscyB0aGVcclxuICAgIC8vIHJlZHJhdyBmcmFtZSBpdCBzY2hlZHVsZXMsIGFuZCB0aGF0IGZyYW1lIGRlcmVmZXJlbmNlcyB0aGUgbWFwIHVuZ3VhcmRlZCAtLVxyXG4gICAgLy8gcmVtb3ZpbmcgYSBsYXllciB3aXRoaW4gYSBmcmFtZSBvZiBpdHMgY3JlYXRpb24gd291bGQgdGhyb3cgZnJvbSBpbnNpZGVcclxuICAgIC8vIHJlcXVlc3RBbmltYXRpb25GcmFtZSwgd2hlcmUgbm8gY2FsbGVyIGNhbiBjYXRjaCBpdC5cclxuICAgIC8vIFRha2VzIGVpdGhlciBhIG1lcmdlZCB3cmFwcGVyIGxheWVyICh3aGljaCBrZWVwcyBpdHMgZ2xpZnkgaW5zdGFuY2UgYXNcclxuICAgIC8vIGdsUG9pbnRzIC8gZ2xMaW5lcyAvIGdsU2hhcGVzKSBvciBhIGJhcmUgZ2xpZnkgaW5zdGFuY2UuXHJcbiAgICBmdW5jdGlvbiBjYW5jZWxHbEZyYW1lKGdsSW5zdGFuY2UpIHtcclxuICAgICAgICBjb25zdCBvdmVybGF5ID0gZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyO1xyXG4gICAgICAgIGlmIChvdmVybGF5ICYmIG92ZXJsYXkuX2ZyYW1lICE9IG51bGwpIHtcclxuICAgICAgICAgICAgTC5VdGlsLmNhbmNlbEFuaW1GcmFtZShvdmVybGF5Ll9mcmFtZSk7XHJcbiAgICAgICAgICAgIG92ZXJsYXkuX2ZyYW1lID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiByZXRpcmVHbChpbnN0YW5jZSkge1xyXG4gICAgICAgIGlmICghaW5zdGFuY2UpIHJldHVybjtcclxuICAgICAgICBmb3IgKGNvbnN0IGdsIG9mIFtpbnN0YW5jZS5nbFBvaW50cywgaW5zdGFuY2UuZ2xMaW5lcywgaW5zdGFuY2UuZ2xTaGFwZXMsIGluc3RhbmNlXSkge1xyXG4gICAgICAgICAgICBjYW5jZWxHbEZyYW1lKGdsKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdHJ5IHsgaW5zdGFuY2UucmVtb3ZlKCk7IH0gY2F0Y2ggKGVycikgeyAvKiBhbHJlYWR5IGdvbmUgKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNNYXBTdGF0ZSgpIHtcclxuICAgICAgICBjb25zb2xlLnRpbWUoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcclxuICAgICAgICB1cGRhdGVUaW1lRGltZW5zaW9uKCk7XHJcbiAgICAgICAgY29uc3QgbGF5ZXJzID0gbGF5ZXJTdGF0ZTtcclxuICAgICAgICBjb25zdCBncm91cENvbmZpZ3MgPSBob3N0LmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge307XHJcbiAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBidWZmZXJTdGF0ZTtcclxuXHJcbiAgICAgICAgLy8gRW5mb3JjZSBtdXR1YWxseSBleGNsdXNpdmUgcmFkaW8gZ3JvdXAgdmlzaWJpbGl0eSBiZWZvcmUgY29sbGVjdGluZyBvciByZW5kZXJpbmcgV2ViR0wgbGF5ZXJzLlxyXG4gICAgICAgIC8vIFdyaXR0ZW4gYmFjayBhcyB0YXJnZXRlZCBmbGlwcywgbmV2ZXIgdGhlIGxheWVycyB0cmFpdCAtLSB0aGUgZnVsbCB3cml0ZSB3YXNcclxuICAgICAgICAvLyB0aGUgZnJhbWUgdGhhdCBraWxsZWQgbGFyZ2Ugc2Vzc2lvbnMgKHNlZSB0aGUgc2lkZWJhcidzIGNoYW5nZSBoYW5kbGVyKS5cclxuICAgICAgICBjb25zdCByYWRpbyA9IG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzLCBzaWRlYmFyQ29sbGFwc2VTdGF0ZShzaWRlYmFyKSk7XHJcbiAgICAgICAgaWYgKChyYWRpby5jaGFuZ2VzLmxlbmd0aCA+IDAgfHwgcmFkaW8uZ3JvdXBzQ2hhbmdlZCkgJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcclxuICAgICAgICAgICAgc2VuZExheWVyV3JpdGUoaG9zdCwgcmFkaW8uY2hhbmdlcyk7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcclxuICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHN5bmNMb2dvKCk7XHJcblxyXG4gICAgICAgIC8vIEdyb3VwIHZpc2libGUgbGF5ZXJzIChpbmNsdWRpbmcgc3ViLWxheWVycyBpbnNpZGUgZ3JvdXBzKSB0byBhbHdheXMgdXNlIFdlYkdMXHJcbiAgICAgICAgY29uc3Qge1xyXG4gICAgICAgICAgICBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICBwb2x5bGluZTogd2ViZ2xQb2x5bGluZUxheWVycyxcclxuICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzLFxyXG4gICAgICAgIH0gPSBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xyXG5cclxuICAgICAgICAvLyBTZXQgb2YgbGF5ZXIgSURzIHByb2Nlc3NlZCB2aWEgbWVyZ2VkIFdlYkdMIGxheWVyc1xyXG4gICAgICAgIGNvbnN0IHdlYmdsTGF5ZXJJZHMgPSBuZXcgU2V0KFtcclxuICAgICAgICAgICAgLi4ud2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXHJcbiAgICAgICAgICAgIC4uLndlYmdsTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxyXG4gICAgICAgICAgICAuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxyXG4gICAgICAgICAgICAuLi53ZWJnbFBvbHlnb25MYXllcnMubWFwKGwgPT4gbC5pZClcclxuICAgICAgICBdKTtcclxuXHJcbiAgICAgICAgLy8gUmVtb3ZlIHJldGlyZWQgb3ZlcmxheSBsYXllcnMsIGluY2x1ZGluZyB0aG9zZSB0aGF0IHRyYW5zaXRpb25lZCB0byBXZWJHTFxyXG4gICAgICAgIE9iamVjdC5rZXlzKGFjdGl2ZU92ZXJsYXlMYXllcnMpLmZvckVhY2goaWQgPT4ge1xyXG4gICAgICAgICAgICBpZiAoIWxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpIHx8IHdlYmdsTGF5ZXJJZHMuaGFzKGlkKSkge1xyXG4gICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF0ucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gUHJvY2VzcyBub24tV2ViR0wgbGF5ZXJzXHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJiYXNlbWFwXCIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChlZmZlY3RpdmVWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRpbGUgPSBnZXRUaWxlTGF5ZXIobGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aWxlLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0gPSB0aWxlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV07XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFNraXAgbGF5ZXJzIG1hbmFnZWQgYnkgdGhlIG1lcmdlZCBXZWJHTCBsYXllcnNcclxuICAgICAgICAgICAgaWYgKHdlYmdsTGF5ZXJJZHMuaGFzKGxheWVyLmlkKSkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghZWZmZWN0aXZlVmlzaWJsZSB8fCAhbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVyU3RhdGUsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgICAgICAvLyBJbWFnZSBvdmVybGF5cyByZWNyZWF0ZSB3aGVuIHRoZWlyIGNvbmZpZyBvciB0aGVpciBidWZmZXJcclxuICAgICAgICAgICAgICAgIC8vIGNoYW5nZXMgLS0gYSByZXBsYWNlIG9wIHN3YXBzIHRoZSBjb25maWcgb2JqZWN0IGFuZCBhXHJcbiAgICAgICAgICAgICAgICAvLyBidWZmZXIgb3Agc3dhcHMgdGhlIERhdGFWaWV3LCBhbmQgYSBzdGFsZSBpbWFnZSB3b3VsZFxyXG4gICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIHNpdCB1bnRpbCBhIHZpc2liaWxpdHkgYm91bmNlLlxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhbGVJbWFnZSA9IGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIlxyXG4gICAgICAgICAgICAgICAgICAgICYmIChleGlzdGluZy5pbWFnZU1ldGEgIT09IGltYWdlTWV0YUtleShsYXllcilcclxuICAgICAgICAgICAgICAgICAgICAgICAgfHwgZXhpc3RpbmcuaW1hZ2VTb3VyY2UgIT09IChjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0gfHwgbnVsbCkpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nLmxheWVyVHlwZSAhPT0gbGF5ZXIudHlwZSB8fCBzdGFsZUltYWdlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgLy8gQSBob3N0IG1heSBkZXN0cm95IHRoZSBtYXAgd2hpbGUgYSBzeW5jIGlzIGluIGZsaWdodCAoYW4gdW5tb3VudCwgb3JcclxuICAgICAgICAgICAgLy8gUmVhY3Qgc3RyaWN0IG1vZGUncyB0aHJvd2F3YXkgbW91bnQpOiBub3RoaW5nIHBhc3QgdGhpcyBwb2ludCBtYXlcclxuICAgICAgICAgICAgLy8gdG91Y2ggYSBtYXAgdGhhdCBubyBsb25nZXIgaGFzIHBhbmVzLlxyXG4gICAgICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0gPSBpbnN0YW5jZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSGVscGVyIHRvIHN5bmMgV2ViR0wgbGF5ZXIgc3RhdGVzIGFuZCByZWJ1aWxkIG9ubHkgaWYgY2hhbmdlZFxyXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMsIHZlY3RvckdwdSA9IGZhbHNlKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkc1N0cmluZyA9IHZpc2libGVMYXllcnMubWFwKGwgPT4gbC5pZCkuc29ydCgpLmpvaW4oXCIsXCIpO1xyXG4gICAgICAgICAgICAvLyBFdmVyeXRoaW5nIHRoZSBidWlsdCBidWZmZXJzIGRlcGVuZCBvbiBiZWxvbmdzIGluIHRoaXMga2V5OiBhIGNoYW5nZSB0aGF0XHJcbiAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXHJcbiAgICAgICAgICAgIC8vIG1pc3NpbmcgYXQgZmlyc3QsIHNvIGEgaGlnaGxpZ2h0IGxhbmRlZCBpbiBzdGF0ZSBhbmQgbmV2ZXIgcmVwYWludGVkLlxyXG4gICAgICAgICAgICAvLyBQb2ludCBidWNrZXRzIG9uIHRoZSBHUFUgcGF0aCBleGNsdWRlIHRoZSB0aWNrIGFuZCB3aW5kb3cgZnJvbSB0aGUga2V5OlxyXG4gICAgICAgICAgICAvLyB0aG9zZSBjaGFuZ2UgcGVyIHRpY2sgYW5kIGFyZSBhcHBsaWVkIGFzIHVuaWZvcm1zLCBub3QgYnkgcmVidWlsZGluZy5cclxuICAgICAgICAgICAgLy8gVGhlIHBlcmlvZCBzdGF5cyBpbiwgc2luY2UgaXQgaXMgYmFrZWQgaW50byB0aGUgZHVyYXRpb24gYXR0cmlidXRlcy5cclxuICAgICAgICAgICAgLy8gRXZlcnl0aGluZyBlbHNlIC0tIGFuZCBldmVyeSBub24tcG9pbnQgYnVja2V0IC0tIHJlYnVpbGRzIGFzIGJlZm9yZS5cclxuICAgICAgICAgICAgY29uc3QgZ3B1UG9pbnRzID0gKCh0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCIpXHJcbiAgICAgICAgICAgICAgICAmJiBncHVUaW1lQXZhaWxhYmxlKCkpIHx8IHZlY3RvckdwdTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHZpc2libGVMYXllcnMubWFwKGwgPT4gKHtcclxuICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IGwuY29sb3IsXHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IGwucmFkaXVzLFxyXG4gICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcclxuICAgICAgICAgICAgICAgIG9wYWNpdHk6IGwub3BhY2l0eSxcclxuICAgICAgICAgICAgICAgIGZpbGxPcGFjaXR5OiBsLmZpbGxPcGFjaXR5LFxyXG4gICAgICAgICAgICAgICAgaGlnaGxpZ2h0OiBsLmhpZ2hsaWdodF9zdHlsZSxcclxuICAgICAgICAgICAgICAgIG92ZXJyaWRlczogbC5zdHlsZV9vdmVycmlkZXMsXHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlU3R5bGVzOiBsLmZlYXR1cmVfc3R5bGVzLFxyXG4gICAgICAgICAgICAgICAgdGltZTogbC50aW1lLFxyXG4gICAgICAgICAgICAgICAgZ3B1OiBncHVQb2ludHMsXHJcbiAgICAgICAgICAgICAgICB0aWNrOiBsLnRpbWUgJiYgdGltZVN0YXRlICYmICFncHVQb2ludHMgPyB0aW1lU3RhdGUudGljayA6IDAsXHJcbiAgICAgICAgICAgICAgICB3aW46IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgcGVyOiBsLnRpbWUgJiYgZ3B1UG9pbnRzICYmIHRpbWVTdGF0ZVxyXG4gICAgICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodGltZVN0YXRlLnBlcmlvZCkgOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgLy8gSWRlbnRpdHkgb2YgZXZlcnkgYnVmZmVyIHRoZSBidWNrZXQgcmVhZHMgZm9yIHRoaXMgbGF5ZXI6XHJcbiAgICAgICAgICAgICAgICAvLyBzYW1lLWxlbmd0aCByZXBsYWNlbWVudHMgbXVzdCByZWJ1aWxkIHRvby5cclxuICAgICAgICAgICAgICAgIGJ1ZlNlcmlhbDogW2wuaWQsIGAke2wuaWR9Ojpjb2xvcnNgLCBgJHtsLmlkfTo6cmFkaWlgLCBgJHtsLmlkfTo6dGltZXNgXVxyXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoayA9PiBidWZmZXJTZXJpYWwoY29vcmRpbmF0ZUJ1ZmZlcnNba10pKSxcclxuICAgICAgICAgICAgICAgIGxvY0xlbjogbC5sb2NhdGlvbnM/Lmxlbmd0aCB8fCAwXHJcbiAgICAgICAgICAgIH0pKSk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZUNoYW5nZWQgPSBzdGF0ZS5pZHMgIT09IGlkc1N0cmluZyB8fCBzdGF0ZS5tZXRhICE9PSBtZXRhU3RyaW5nO1xyXG5cclxuICAgICAgICAgICAgaWYgKHN0YXRlQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0aXJlR2woc3RhdGUubGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJ1aWx0ID0gYXdhaXQgcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIHZpc2libGVMYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBsYXllckV2ZW50cywgdGltZVN0YXRlLCB2ZWN0b3JHcHUsIGZlYXR1cmVWaXNpYmxlTm93KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZGVzdHJveWVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIERlc3Ryb3llZCBtaWQtYnVpbGQ6IHJldGlyZSB0aGUgaW5zdGFuY2UgZ2xpZnkgcmVnaXN0ZXJlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyAoaXRzIEdMIGNvbnRleHQgZ29lcyB3aXRoIGl0KSBpbnN0ZWFkIG9mIGFkZGluZyBpdCB0byBhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlbW92ZWQgbWFwLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXRpcmVHbChidWlsdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBidWlsdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIuYWRkVG8obWFwKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHN0YXRlLmlkcyA9IGlkc1N0cmluZztcclxuICAgICAgICAgICAgICAgIHN0YXRlLm1ldGEgPSBtZXRhU3RyaW5nO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBQb2ludCBidWNrZXRzIGhvbGRpbmcgdGltZSBsYXllcnMga2VlcCBFVkVSWSBwb2ludCBsYXllciAtLSBoaWRkZW4gb25lc1xyXG4gICAgICAgIC8vIGluY2x1ZGVkIC0tIHNvIGEgc2lkZWJhciB0b2dnbGUgY2hhbmdlcyBhIHZpc2liaWxpdHkgdW5pZm9ybSBpbnN0ZWFkIG9mXHJcbiAgICAgICAgLy8gdGhlIGJ1Y2tldCdzIGlkcy4gVW5jaGVja2luZyBvbmUgb2YgMjUgdHJhY2tzIHVzZWQgdG8gcmVidWlsZCBhbGwgNU1cclxuICAgICAgICAvLyBwb2ludHM7IGNsaWNraW5nIGRvd24gdGhlIHNpZGViYXIgc3RhY2tlZCB0aG9zZSByZWJ1aWxkcyBpbnRvIGEgY3Jhc2guXHJcbiAgICAgICAgY29uc3QgYWxsQnlUeXBlID0gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKTtcclxuICAgICAgICAvLyBBcmVhIG91dGxpbmVzIHJpZGUgdGhlIGxpbmVzIGJ1Y2tldDogZXZlcnkgcG9seWdvbiBhbmQgY2lyY2xlIGpvaW5zIGl0IGFzXHJcbiAgICAgICAgLy8gYW4gZXh0cmEgZW50cnkgd2hvc2UgcmluZ3MgcmVuZGVyIGFzIHdlaWdodGVkIExpbmVTdHJpbmdzICh0aGUgcG9seWdvblxyXG4gICAgICAgIC8vIGJ1Y2tldCBkcmF3cyBvbmx5IHRoZSBmaWxsKS4gSm9pbmluZyB1bmNvbmRpdGlvbmFsbHkgLS0gc3Ryb2tlbGVzcyBhcmVhc1xyXG4gICAgICAgIC8vIGNvbnRyaWJ1dGUgYW4gZW1wdHkgc2xvdCAtLSBrZWVwcyB0aGUgYnVja2V0J3MgbWVtYmVyc2hpcCBpbmRlcGVuZGVudCBvZlxyXG4gICAgICAgIC8vIHN0eWxlIGNoYW5nZXMsIHNvIHJlc3R5bGluZyBhIGJvcmRlciBzdGF5cyBhIHJlYnVpbGQsIG5ldmVyIGEgcmUtYnVja2V0LlxyXG4gICAgICAgIGFsbEJ5VHlwZS5wb2x5bGluZSA9IFsuLi5hbGxCeVR5cGUucG9seWxpbmUsIC4uLmFsbEJ5VHlwZS5wb2x5Z29uXTtcclxuICAgICAgICBjb25zdCBidWNrZXQgPSB7IGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgcG9seWxpbmU6IFsuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLCAuLi53ZWJnbFBvbHlnb25MYXllcnNdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzIH07XHJcbiAgICAgICAgY29uc3QgdmVjdG9yR3B1QnVja2V0ID0geyBwb2x5bGluZTogZmFsc2UsIHBvbHlnb246IGZhbHNlIH07XHJcbiAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xyXG4gICAgICAgICAgICBjb25zdCBlbnRyaWVzID0gYWxsQnlUeXBlW3R5cGVdO1xyXG4gICAgICAgICAgICBjb25zdCBpc1BvaW50cyA9IHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIjtcclxuICAgICAgICAgICAgY29uc3QgYXZhaWxhYmxlID0gaXNQb2ludHMgPyBncHVUaW1lQXZhaWxhYmxlKCkgOiB2ZWN0b3JHcHVBdmFpbGFibGUoKTtcclxuICAgICAgICAgICAgY29uc3QgZ3B1VmlzID0gYXZhaWxhYmxlICYmIGVudHJpZXMubGVuZ3RoID4gMFxyXG4gICAgICAgICAgICAgICAgJiYgZW50cmllcy5sZW5ndGggPD0gTEFZRVJfU0xPVFNcclxuICAgICAgICAgICAgICAgICYmIGVudHJpZXMuc29tZShlID0+IGUubGF5ZXIudGltZSk7XHJcbiAgICAgICAgICAgIGdsU3RhdGVzW3R5cGVdLnZpc1ZlY3RvciA9IGdwdVZpcyA/IGVudHJpZXMubWFwKGUgPT4gKGUudmlzID8gMSA6IDApKSA6IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChncHVWaXMpIGJ1Y2tldFt0eXBlXSA9IGVudHJpZXMubWFwKGUgPT4gZS5sYXllcik7XHJcbiAgICAgICAgICAgIGlmICghaXNQb2ludHMpIHZlY3RvckdwdUJ1Y2tldFt0eXBlXSA9IGdwdVZpcztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwiY2lyY2xlX21hcmtlcnNcIiwgYnVja2V0LmNpcmNsZV9tYXJrZXJzKTtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJtYXJrZXJzXCIsIGJ1Y2tldC5tYXJrZXJzKTtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCBidWNrZXQucG9seWxpbmUsIHZlY3RvckdwdUJ1Y2tldC5wb2x5bGluZSk7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWdvblwiLCBidWNrZXQucG9seWdvbiwgdmVjdG9yR3B1QnVja2V0LnBvbHlnb24pO1xyXG4gICAgICAgIGlmIChkZXN0cm95ZWQpIHJldHVybjtcclxuXHJcbiAgICAgICAgLy8gUHVzaCB0aGUgY3VycmVudCB3aW5kb3cgaW50byB0aGUgR1BVLWZpbHRlcmVkIHBvaW50IGJ1Y2tldHM6IHR3byB1bmlmb3Jtc1xyXG4gICAgICAgIC8vIGFuZCBhIHJlZHJhdywgd2hpY2ggaXMgdGhlIGVudGlyZSBwZXItdGljayBjb3N0IG9mIHRoZSB0aW1lIHNsaWRlciB0aGVyZS5cclxuICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2YgW1wiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCJdKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XHJcbiAgICAgICAgICAgIGNvbnN0IGhhbmRsZSA9IHN0YXRlLmxheWVyICYmIHN0YXRlLmxheWVyLl9zd2lmdG1hcFRpbWU7XHJcbiAgICAgICAgICAgIGlmICghaGFuZGxlKSBjb250aW51ZTtcclxuICAgICAgICAgICAgLy8gTGF5ZXIgdmlzaWJpbGl0eSBmaXJzdCwgYW5kIG9ubHkgd2hlbiBpdCBjaGFuZ2VkOiBhIHRvZ2dsZSBjb3N0cyBvbmVcclxuICAgICAgICAgICAgLy8gdW5pZm9ybSBhcnJheSB3cml0ZSBhbmQgYSByZWRyYXcsIG5ldmVyIGEgcmVidWlsZC5cclxuICAgICAgICAgICAgY29uc3QgdmlzID0gc3RhdGUudmlzVmVjdG9yO1xyXG4gICAgICAgICAgICBpZiAodmlzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSB2aXMuam9pbihcIlwiKTtcclxuICAgICAgICAgICAgICAgIGlmIChzdGF0ZS52aXNLZXkgIT09IGtleSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnZpc0tleSA9IGtleTtcclxuICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0TGF5ZXJWaXNpYmlsaXR5KHZpcyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgb3ZlcnJpZGVNcyA9IHRpbWVTdGF0ZS53aW5kb3dcclxuICAgICAgICAgICAgICAgICAgICA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2QodGltZVN0YXRlLndpbmRvdykpIDogbnVsbDtcclxuICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3codGltZVN0YXRlLnRpY2ssIG92ZXJyaWRlTXMpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyhudWxsLCBudWxsKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywge1xyXG4gICAgICAgICAgICBncm91cENvbmZpZ3MsXHJcbiAgICAgICAgICAgIGNvb3JkaW5hdGVCdWZmZXJzLFxyXG4gICAgICAgICAgICBvbkxheWVyV3JpdGU6IChjaGFuZ2VzKSA9PiBzZW5kTGF5ZXJXcml0ZShob3N0LCBjaGFuZ2VzKSxcclxuICAgICAgICAgICAgLy8gZ3JvdXBfY29uZmlncyBzdGF5cyBvbiB0aGUgaG9zdDogYSBoYW5kZnVsIG9mIGZvbGRlciBmbGFncywgYW5kIHRoZVxyXG4gICAgICAgICAgICAvLyBzcHJlYWQgZ2l2ZXMgQmFja2JvbmUgYSBmcmVzaCByZWZlcmVuY2Ugc28gaW4tcGxhY2UgZWRpdHMgcmVnaXN0ZXIuXHJcbiAgICAgICAgICAgIG9uR3JvdXBDb25maWdzQ2hhbmdlOiAoY2ZnKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImdyb3VwX2NvbmZpZ3NcIiwgeyAuLi5jZmcgfSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH0sIG1hcCwgKCkgPT4ge1xyXG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBQZXJtYW5lbnQgbGFiZWxzIGZvbGxvdyB0aGUgc2FtZSBkZXJpdmUtcGVyLXN5bmMgcGF0dGVybiBhcyB0aGUgbGVnZW5kLFxyXG4gICAgICAgIC8vIHNvIHRoZXkgdHJhY2sgdmlzaWJpbGl0eSB3aXRoIG5vIGJ1Y2tldCBvciBtZXRhLWtleSBpbnZvbHZlbWVudCAtLSBhbmRcclxuICAgICAgICAvLyBzaW5jZSBldmVyeSBwbGF5YmFjayB0aWNrIHJlLWVudGVycyB0aGlzIHN5bmMsIHBhc3NpbmcgdGltZVN0YXRlIG1ha2VzXHJcbiAgICAgICAgLy8gdGhlbSBmb2xsb3cgdGhlIHdpbmRvdyB0b286IGNoaXBzIGFwcGVhciBhbmQgdmFuaXNoIHdpdGggdGhlaXIgZmVhdHVyZXMuXHJcbiAgICAgICAgaWYgKGxhYmVsc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHJlbmRlckxhYmVscyhMLCBsYWJlbHNHcm91cCwgbGF5ZXJzLCBjb29yZGluYXRlQnVmZmVycywgZ3JvdXBDb25maWdzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGxlZ2VuZENmZyA9IGhvc3QuZ2V0KFwibGVnZW5kX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBpZiAoaG9zdC5nZXQoXCJzaG93X2xlZ2VuZFwiKSkge1xyXG4gICAgICAgICAgICBjb25zdCBzcGVjID0gZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgbGVnZW5kQ2ZnKTtcclxuICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGxlZ2VuZERpdiwgc3BlYyxcclxuICAgICAgICAgICAgICAgIHsgZGltSGlkZGVuOiBsZWdlbmRDZmcuZGltX2hpZGRlbiAhPT0gZmFsc2UgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBvcyA9IFBPU0lUSU9OU1tsZWdlbmRDZmcucG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcImJvdHRvbS1sZWZ0XCJdO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocG9zKSkge1xyXG4gICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlW3Byb3BdID0gdmFsdWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBzcGVjLmdyb3Vwcy5sZW5ndGggPiAwID8gXCJibG9ja1wiIDogXCJub25lXCI7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc29sZS50aW1lRW5kKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XHJcbiAgICBsZXQgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XHJcblxyXG4gICAgLy8gRHJhdyAvIEFPSSB0b29sczogTGVhZmxldC1HZW9tYW4gKHRoZSBtYWludGFpbmVkIHN1Y2Nlc3NvciB0byBMZWFmbGV0LmRyYXcsXHJcbiAgICAvLyB3aGljaCBicmVha3Mgb24gTGVhZmxldCAxLjkpLCBsb2FkZWQgZnJvbSB1bnBrZyBsaWtlIExlYWZsZXQgYW5kIGdsaWZ5IC0tXHJcbiAgICAvLyBsYXppbHksIG9ubHkgd2hlbiBhIG1hcCB0dXJucyBkcmF3aW5nIG9uLCBzbyBldmVyeSBvdGhlciBtYXAgcGF5cyBub3RoaW5nLlxyXG4gICAgLy8gRHJhd24gc2hhcGVzIGxpdmUgaW4gdGhlaXIgb3duIGZlYXR1cmUgZ3JvdXAgYW5kIHN5bmMgdG8gUHl0aG9uIGFzIEdlb0pTT05cclxuICAgIC8vIGZlYXR1cmVzIHVuZGVyIHRoZSBgZHJhd2luZ3NgIHRyYWl0LCB3aXRoIGBkcmF3X3NlcWAgYnVtcGluZyBwZXIgY2hhbmdlIHNvXHJcbiAgICAvLyBvbmUgb2JzZXJ2ZXIgY2F0Y2hlcyBjcmVhdGUsIGVkaXQgYW5kIGRlbGV0ZSBhbGlrZS4gVGhlIHRyYWl0IHN5bmNzIGJvdGhcclxuICAgIC8vIHdheXM6IFB5dGhvbiBjYW4gc2VlZCBBT0lzIG9yIGNsZWFyIHRoZW0sIGFuZCBleHBvcnRzIGNhcnJ5IHRoZSBkcmF3aW5ncy5cclxuICAgIGxldCBkcmF3UmVhZHkgPSBmYWxzZTtcclxuICAgIGxldCBkcmF3aW5nc0dyb3VwID0gbnVsbDtcclxuICAgIGxldCBkcmF3SWRDb3VudGVyID0gMDtcclxuICAgIGxldCBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xyXG5cclxuICAgIGZ1bmN0aW9uIGRyYXdpbmdUb0ZlYXR1cmUobCkge1xyXG4gICAgICAgIGNvbnN0IGdqID0gbC50b0dlb0pTT04oKTtcclxuICAgICAgICBnai5wcm9wZXJ0aWVzID0geyAuLi4oZ2oucHJvcGVydGllcyB8fCB7fSksIGRyYXdfaWQ6IGwuX3N3aWZ0bWFwRHJhd0lkIH07XHJcbiAgICAgICAgaWYgKHR5cGVvZiBsLmdldFJhZGl1cyA9PT0gXCJmdW5jdGlvblwiICYmIGwgaW5zdGFuY2VvZiBMLkNpcmNsZSkge1xyXG4gICAgICAgICAgICBnai5wcm9wZXJ0aWVzLmtpbmQgPSBcImNpcmNsZVwiO1xyXG4gICAgICAgICAgICBnai5wcm9wZXJ0aWVzLnJhZGl1cyA9IGwuZ2V0UmFkaXVzKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBnajtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB3cml0ZURyYXdpbmdzKCkge1xyXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgZHJhd2luZ3NHcm91cC5lYWNoTGF5ZXIobCA9PiBmZWF0dXJlcy5wdXNoKGRyYXdpbmdUb0ZlYXR1cmUobCkpKTtcclxuICAgICAgICBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IHRydWU7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaG9zdC5zZXQoXCJkcmF3aW5nc1wiLCBmZWF0dXJlcyk7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0KFwiZHJhd19zZXFcIiwgKGhvc3QuZ2V0KFwiZHJhd19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgZHJhd2luZ3Mgc3RpbGwgbGl2ZSBvbiB0aGUgbWFwICovIH1cclxuICAgICAgICBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGFkb3B0RHJhd2luZyhsYXllcikge1xyXG4gICAgICAgIGlmICghbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkKSB7XHJcbiAgICAgICAgICAgIGxheWVyLl9zd2lmdG1hcERyYXdJZCA9IGBkcmF3XyR7KytkcmF3SWRDb3VudGVyfWA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRyYXdpbmdzR3JvdXAuYWRkTGF5ZXIobGF5ZXIpO1xyXG4gICAgICAgIGxheWVyLm9uKFwicG06dXBkYXRlIHBtOmRyYWdlbmQgcG06cm90YXRlZW5kXCIsIHdyaXRlRHJhd2luZ3MpO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHJlaHlkcmF0ZURyYXdpbmdzKCkge1xyXG4gICAgICAgIGRyYXdpbmdzR3JvdXAuY2xlYXJMYXllcnMoKTtcclxuICAgICAgICBmb3IgKGNvbnN0IGZlYXR1cmUgb2YgaG9zdC5nZXQoXCJkcmF3aW5nc1wiKSB8fCBbXSkge1xyXG4gICAgICAgICAgICBjb25zdCBwcm9wcyA9IGZlYXR1cmUucHJvcGVydGllcyB8fCB7fTtcclxuICAgICAgICAgICAgbGV0IGxheWVyO1xyXG4gICAgICAgICAgICBpZiAocHJvcHMua2luZCA9PT0gXCJjaXJjbGVcIiAmJiBmZWF0dXJlLmdlb21ldHJ5LnR5cGUgPT09IFwiUG9pbnRcIikge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgW2xuZywgbGF0XSA9IGZlYXR1cmUuZ2VvbWV0cnkuY29vcmRpbmF0ZXM7XHJcbiAgICAgICAgICAgICAgICBsYXllciA9IEwuY2lyY2xlKFtsYXQsIGxuZ10sIHsgcmFkaXVzOiBwcm9wcy5yYWRpdXMgfHwgMTAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiIH0pO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbGF5ZXIgPSBMLmdlb0pTT04oZmVhdHVyZSwgeyBwYW5lOiBcInN3aWZ0bWFwRHJhd1BhbmVcIiB9KVxyXG4gICAgICAgICAgICAgICAgICAgIC5nZXRMYXllcnMoKVswXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoIWxheWVyKSBjb250aW51ZTtcclxuICAgICAgICAgICAgbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkID0gcHJvcHMuZHJhd19pZCB8fCBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xyXG4gICAgICAgICAgICBhZG9wdERyYXdpbmcobGF5ZXIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBzeW5jRHJhdygpIHtcclxuICAgICAgICBjb25zdCBzaG93ID0gaG9zdC5nZXQoXCJzaG93X2RyYXdcIik7XHJcbiAgICAgICAgY29uc3QgY2ZnID0gaG9zdC5nZXQoXCJkcmF3X2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBpZiAoc2hvdyAmJiAhZHJhd1JlYWR5KSB7XHJcbiAgICAgICAgICAgIGRyYXdSZWFkeSA9IHRydWU7XHJcbiAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgR2VvbWFuIGNyZWF0ZXMgZ29lcyB0byB0aGUgcGFuZSBhYm92ZSB0aGUgR0wgc3RhY2suXHJcbiAgICAgICAgICAgIG1hcC5wbS5zZXRHbG9iYWxPcHRpb25zKHtcclxuICAgICAgICAgICAgICAgIHBhbmVzOiB7IGxheWVyUGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICB2ZXJ0ZXhQYW5lOiBcIm1hcmtlclBhbmVcIiwgbWFya2VyUGFuZTogXCJtYXJrZXJQYW5lXCIgfSxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAgPSBMLmZlYXR1cmVHcm91cCgpLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgICAgIHJlaHlkcmF0ZURyYXdpbmdzKCk7XHJcbiAgICAgICAgICAgIG1hcC5vbihcInBtOmNyZWF0ZVwiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgYWRvcHREcmF3aW5nKGUubGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgd3JpdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbWFwLm9uKFwicG06cmVtb3ZlXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAvLyBHZW9tYW4gcmVtb3ZlcyB0aGUgbGF5ZXIgZnJvbSB0aGUgTUFQOyB0aGUgZmVhdHVyZSBncm91cCBzdGlsbFxyXG4gICAgICAgICAgICAgICAgLy8gaG9sZHMgaXQsIGFuZCB3cml0ZURyYXdpbmdzIHJlYWRzIHRoZSBncm91cCAtLSBldmljdCBpdCBmaXJzdFxyXG4gICAgICAgICAgICAgICAgLy8gb3IgdGhlIGRlbGV0aW9uIG5ldmVyIHJlYWNoZXMgdGhlIHRyYWl0LlxyXG4gICAgICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5yZW1vdmVMYXllcihlLmxheWVyKTtcclxuICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGxpc3RlbihcImNoYW5nZTpkcmF3aW5nc1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXN1cHByZXNzRHJhd2luZ3NFY2hvKSByZWh5ZHJhdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFkcmF3UmVhZHkpIHJldHVybjtcclxuICAgICAgICBpZiAoc2hvdykge1xyXG4gICAgICAgICAgICBjb25zdCB0b29scyA9IGNmZy50b29sc1xyXG4gICAgICAgICAgICAgICAgfHwgW1wibWFya2VyXCIsIFwicG9seWxpbmVcIiwgXCJyZWN0YW5nbGVcIiwgXCJwb2x5Z29uXCIsIFwiY2lyY2xlXCJdO1xyXG4gICAgICAgICAgICBtYXAucG0uYWRkQ29udHJvbHMoe1xyXG4gICAgICAgICAgICAgICAgcG9zaXRpb246IChjZmcucG9zaXRpb24gfHwgXCJ0b3AtbGVmdFwiKS5yZXBsYWNlKFwiLVwiLCBcIlwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdNYXJrZXI6IHRvb2xzLmluY2x1ZGVzKFwibWFya2VyXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd1BvbHlsaW5lOiB0b29scy5pbmNsdWRlcyhcInBvbHlsaW5lXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd1JlY3RhbmdsZTogdG9vbHMuaW5jbHVkZXMoXCJyZWN0YW5nbGVcIiksXHJcbiAgICAgICAgICAgICAgICBkcmF3UG9seWdvbjogdG9vbHMuaW5jbHVkZXMoXCJwb2x5Z29uXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd0NpcmNsZTogdG9vbHMuaW5jbHVkZXMoXCJjaXJjbGVcIiksXHJcbiAgICAgICAgICAgICAgICBkcmF3Q2lyY2xlTWFya2VyOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGRyYXdUZXh0OiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHJvdGF0ZU1vZGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgY3V0UG9seWdvbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBlZGl0TW9kZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGRyYWdNb2RlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgcmVtb3ZhbE1vZGU6IHRydWUsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG1hcC5wbS5yZW1vdmVDb250cm9scygpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHN5bmNEcmF3KCk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2hvd19kcmF3XCIsIHN5bmNEcmF3KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpkcmF3X2NvbmZpZ1wiLCBzeW5jRHJhdyk7XHJcblxyXG4gICAgLy8gVGhlIHNjYWxlIGJhcjogTGVhZmxldCdzIG93biBjb250cm9sLCB3aGljaCBtZWFzdXJlcyB0aHJvdWdoIHRoZSBtYXAncyBDUlNcclxuICAgIC8vIChoYXZlcnNpbmUgdW5kZXIgMzg1NyBhbmQgNDMyNiBhbGlrZSAtLSBubyBwaXhlbCBtYXRoIG9mIG91cnMpLCBleHRlbmRlZFxyXG4gICAgLy8gd2l0aCB0aGUgdW5pdCBMZWFmbGV0IGxhY2tzIGFuZCB0aGlzIGRvbWFpbiBydW5zIG9uOiBuYXV0aWNhbCBtaWxlcy5cclxuICAgIGNvbnN0IE5hdXRpY2FsU2NhbGUgPSBMLkNvbnRyb2wuU2NhbGUuZXh0ZW5kKHtcclxuICAgICAgICBvbkFkZDogZnVuY3Rpb24gKG0pIHtcclxuICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5vbkFkZC5jYWxsKHRoaXMsIG0pO1xyXG4gICAgICAgICAgICB0aGlzLl9uYXV0aWNhbFNjYWxlID0gTC5Eb21VdGlsLmNyZWF0ZShcclxuICAgICAgICAgICAgICAgIFwiZGl2XCIsIFwibGVhZmxldC1jb250cm9sLXNjYWxlLWxpbmVcIiwgY29udGFpbmVyKTtcclxuICAgICAgICAgICAgdGhpcy5fdXBkYXRlKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBjb250YWluZXI7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBfdXBkYXRlU2NhbGVzOiBmdW5jdGlvbiAobWF4TWV0ZXJzKSB7XHJcbiAgICAgICAgICAgIEwuQ29udHJvbC5TY2FsZS5wcm90b3R5cGUuX3VwZGF0ZVNjYWxlcy5jYWxsKHRoaXMsIG1heE1ldGVycyk7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9uYXV0aWNhbFNjYWxlICYmIG1heE1ldGVycykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbWF4Tm0gPSBtYXhNZXRlcnMgLyAxODUyO1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgbm0gPSB0aGlzLl9nZXRSb3VuZE51bShtYXhObSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl91cGRhdGVTY2FsZSh0aGlzLl9uYXV0aWNhbFNjYWxlLCBgJHtubX0gbm1gLCBubSAvIG1heE5tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgc2NhbGVDb250cm9sID0gbnVsbDtcclxuICAgIGZ1bmN0aW9uIHN5bmNTY2FsZSgpIHtcclxuICAgICAgICBpZiAoc2NhbGVDb250cm9sKSB7XHJcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgc2NhbGVDb250cm9sID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFob3N0LmdldChcInNob3dfc2NhbGVcIikpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcInNjYWxlX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCB1bml0cyA9IGNmZy51bml0cyB8fCBcIm1ldHJpY1wiO1xyXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgIHBvc2l0aW9uOiAoY2ZnLnBvc2l0aW9uIHx8IFwiYm90dG9tLWxlZnRcIikucmVwbGFjZShcIi1cIiwgXCJcIiksXHJcbiAgICAgICAgICAgIG1heFdpZHRoOiBjZmcubWF4X3dpZHRoIHx8IDEyMCxcclxuICAgICAgICAgICAgbWV0cmljOiB1bml0cyA9PT0gXCJtZXRyaWNcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXHJcbiAgICAgICAgICAgIGltcGVyaWFsOiB1bml0cyA9PT0gXCJpbXBlcmlhbFwiIHx8IHVuaXRzID09PSBcImJvdGhcIixcclxuICAgICAgICB9O1xyXG4gICAgICAgIHNjYWxlQ29udHJvbCA9IHVuaXRzID09PSBcIm5hdXRpY2FsXCJcclxuICAgICAgICAgICAgPyBuZXcgTmF1dGljYWxTY2FsZShvcHRpb25zKVxyXG4gICAgICAgICAgICA6IEwuY29udHJvbC5zY2FsZShvcHRpb25zKTtcclxuICAgICAgICBzY2FsZUNvbnRyb2wuYWRkVG8obWFwKTtcclxuICAgIH1cclxuICAgIHN5bmNTY2FsZSgpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnNob3dfc2NhbGVcIiwgc3luY1NjYWxlKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzY2FsZV9jb25maWdcIiwgc3luY1NjYWxlKTtcclxuXHJcbiAgICAvLyBFbXB0eS1tYXAgY2xpY2tzOiByZXBvcnQgd2hlcmUuIFJlZ2lzdGVyZWQgdGhyb3VnaCB0aGUgc2FtZSBhcmJpdHJhdGlvbiB0aGVcclxuICAgIC8vIGZlYXR1cmUgaGFuZGxlcnMgdXNlLCBhdCB0aGUgbG93ZXN0IHByaW9yaXR5LCBzbyBhIGNsaWNrIHRoYXQgaGl0IGEgZmVhdHVyZVxyXG4gICAgLy8gc3RheXMgdGhhdCBmZWF0dXJlJ3MgY2xpY2sgLS0gdGhpcyB3aW5zIG9ubHkgd2hlbiBub3RoaW5nIGNsYWltZWQgdGhlIGV2ZW50LlxyXG4gICAgLy8gZS5sYXRsbmcgaXMgYWxyZWFkeSB1bnByb2plY3RlZCB0aHJvdWdoIHdoaWNoZXZlciBDUlMgdGhlIG1hcCBydW5zICgzODU3IGFuZFxyXG4gICAgLy8gNDMyNiBhbGlrZSksIHNvIHRoZXJlIGlzIG5vIHBpeGVsIG1hdGggdG8gZ2V0IHdyb25nIGhlcmU7IHdyYXAoKSBrZWVwcyBhXHJcbiAgICAvLyB3b3JsZC1wYW5uZWQgbWFwIGZyb20gcmVwb3J0aW5nIGxvbmdpdHVkZSAtMzY0LlxyXG4gICAgbWFwLm9uKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAvLyBTdGFtcGVkIHN5bmNocm9ub3VzbHksIGJlZm9yZSBhbnkgZ2xpZnkgaGFuZGxlciByZWdpc3RlcnMgaXRzIG1hdGNoXHJcbiAgICAgICAgLy8gKHRoaXMgaGFuZGxlciB3YXMgYm91bmQgZmlyc3QsIHNvIExlYWZsZXQgcnVucyBpdCBmaXJzdCk6IHRoZSB3aG9sZVxyXG4gICAgICAgIC8vIGNsaWNrIHBpcGVsaW5lIC0tIGZlYXR1cmUgcG9wdXBzIGFuZCB0aGlzIGZhbGxiYWNrIGFsaWtlIC0tIHN0YW5kc1xyXG4gICAgICAgIC8vIGRvd24gd2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZC4gRGVmZXJyZWQgY2hlY2tzIG1pc3MgbW9kZXMgdGhhdFxyXG4gICAgICAgIC8vIGNsb3NlIHRoZW1zZWx2ZXMgb24gdGhlaXIgZmluaXNoaW5nIGNsaWNrIChhIGNvbXBsZXRlZCByZWN0YW5nbGUpLFxyXG4gICAgICAgIC8vIHdoaWNoIGlzIHdoeSB0aGUgc3RhdGUgaXMgY2FwdHVyZWQgYXQgY2xpY2sgdGltZS5cclxuICAgICAgICBjb25zdCBwbSA9IG1hcC5wbTtcclxuICAgICAgICBtYXAuX3BtTW9kZUFjdGl2ZSA9IEJvb2xlYW4ocG1cclxuICAgICAgICAgICAgJiYgKChwbS5nbG9iYWxSZW1vdmFsTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsUmVtb3ZhbE1vZGVFbmFibGVkKCkpXHJcbiAgICAgICAgICAgICAgICB8fCAocG0uZ2xvYmFsRWRpdE1vZGVFbmFibGVkICYmIHBtLmdsb2JhbEVkaXRNb2RlRW5hYmxlZCgpKVxyXG4gICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbERyYWdNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxEcmFnTW9kZUVuYWJsZWQoKSlcclxuICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmF3TW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhd01vZGVFbmFibGVkKCkpKSk7XHJcbiAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgOTksICgpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgbGwgPSBlLmxhdGxuZy53cmFwKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IE1hdGgucm91bmQobGwubGF0ICogMWU1KSAvIDFlNTtcclxuICAgICAgICAgICAgY29uc3QgbG5nID0gTWF0aC5yb3VuZChsbC5sbmcgKiAxZTUpIC8gMWU1O1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIFwiXCIpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAtMSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF0bG5nXCIsIFtsYXQsIGxuZ10pO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja19zZXFcIiwgKGhvc3QuZ2V0KFwiY2xpY2tfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cclxuICAgICAgICAgICAgaWYgKGhvc3QuZ2V0KFwic2hvd19jbGlja19jb29yZGluYXRlc1wiKSkge1xyXG4gICAgICAgICAgICAgICAgTC5wb3B1cCh7IGNsYXNzTmFtZTogXCJzd2lmdG1hcC1jb29yZHMtcG9wdXBcIiwgY2xvc2VCdXR0b246IGZhbHNlIH0pXHJcbiAgICAgICAgICAgICAgICAgICAgLnNldExhdExuZyhlLmxhdGxuZylcclxuICAgICAgICAgICAgICAgICAgICAuc2V0Q29udGVudChgJHtsbC5sYXQudG9GaXhlZCg1KX0sICR7bGwubG5nLnRvRml4ZWQoNSl9YClcclxuICAgICAgICAgICAgICAgICAgICAub3Blbk9uKG1hcCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEJpbmQgem9vbSBhbmQgY2VudGVyIGNoYW5nZXMgYmFjayB0byBQeXRob24gc2FmZWx5XHJcbiAgICBtYXAub24oXCJtb3ZlZW5kXCIsICgpID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRab29tID0gbWFwLmdldFpvb20oKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IG1vZGVsQ2VudGVyID0gaG9zdC5nZXQoXCJjZW50ZXJcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IG1vZGVsWm9vbSA9IGhvc3QuZ2V0KFwiem9vbVwiKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbW9kZWxab29tICE9PSBjdXJyZW50Wm9vbTtcclxuICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9ICFtb2RlbENlbnRlciB8fCBcclxuICAgICAgICAgICAgICAgICFBcnJheS5pc0FycmF5KG1vZGVsQ2VudGVyKSB8fFxyXG4gICAgICAgICAgICAgICAgbW9kZWxDZW50ZXIubGVuZ3RoIDwgMiB8fFxyXG4gICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMF0gLSBjZW50ZXIubGF0KSA+IDAuMDAwMSB8fCBcclxuICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzFdIC0gY2VudGVyLmxuZykgPiAwLjAwMDE7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiY2VudGVyXCIsIFtjZW50ZXIubGF0LCBjZW50ZXIubG5nXSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHpvb21DaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJ6b29tXCIsIGN1cnJlbnRab29tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgc2FmZVNhdmVDaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIG1vdmVlbmQgaGFuZGxlcjpcIiwgZXJyKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBmdW5jdGlvbiB1cGRhdGVNYXBWaWV3KCkge1xyXG4gICAgICAgIGNvbnN0IGNlbnRlciA9IGhvc3QuZ2V0KFwiY2VudGVyXCIpO1xyXG4gICAgICAgIGNvbnN0IHpvb20gPSBob3N0LmdldChcInpvb21cIik7XHJcbiAgICAgICAgaWYgKGNlbnRlciAmJiBBcnJheS5pc0FycmF5KGNlbnRlcikgJiYgY2VudGVyLmxlbmd0aCA+PSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcENlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcclxuICAgICAgICAgICAgY29uc3QgbWFwWm9vbSA9IG1hcC5nZXRab29tKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSBNYXRoLmFicyhtYXBDZW50ZXIubGF0IC0gY2VudGVyWzBdKSA+IDAuMDAwMSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1hcENlbnRlci5sbmcgLSBjZW50ZXJbMV0pID4gMC4wMDAxO1xyXG4gICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1hcFpvb20gIT09IHpvb207XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgbWFwLnNldFZpZXcoY2VudGVyLCB0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiA/IHpvb20gOiBtYXBab29tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHpvb20gPSBob3N0LmdldChcInpvb21cIik7XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiAmJiBtYXAuZ2V0Wm9vbSgpICE9PSB6b29tKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbSh6b29tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBXYXRjaCBmb3IgbWFwIHZpZXcgdXBkYXRlcyBmcm9tIFB5dGhvblxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmNlbnRlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgaWYgKGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwKSB7XHJcbiAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgdXBkYXRlTWFwVmlldygpO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6em9vbVwiLCAoKSA9PiB7XHJcbiAgICAgICAgaWYgKGlzVXBkYXRpbmdab29tRnJvbU1hcCkge1xyXG4gICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XHJcbiAgICB9KTtcclxuICAgIC8vIEZpdHRpbmcgdGhlIHZpZXcgaXMgYSBjb21tYW5kLCBub3Qgc3RhdGU6IGFza2luZyB0byBmaXQgdGhlIHNhbWUgYm91bmRzIHR3aWNlXHJcbiAgICAvLyBtdXN0IG1vdmUgdGhlIG1hcCBib3RoIHRpbWVzLCBzaW5jZSB0aGUgdXNlciBtYXkgaGF2ZSBwYW5uZWQgYXdheSBpbiBiZXR3ZWVuLlxyXG4gICAgLy8gVGhlIHJlcXVlc3QgY2FycmllcyBhIHNlcXVlbmNlIG51bWJlciBzbyBhbiBpZGVudGljYWwgZml0IHN0aWxsIGZpcmVzIGEgY2hhbmdlLlxyXG4gICAgZnVuY3Rpb24gYXBwbHlGaXRSZXF1ZXN0KCkge1xyXG4gICAgICAgIGNvbnN0IHJlcSA9IGhvc3QuZ2V0KFwiZml0X2JvdW5kc19yZXF1ZXN0XCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IGJvdW5kcyA9IHJlcS5ib3VuZHM7XHJcbiAgICAgICAgaWYgKCFib3VuZHMgfHwgYm91bmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG5cclxuICAgICAgICBjb25zdCBvcHRpb25zID0ge307XHJcbiAgICAgICAgaWYgKHJlcS5wYWRkaW5nICE9IG51bGwpIG9wdGlvbnMucGFkZGluZyA9IFtyZXEucGFkZGluZywgcmVxLnBhZGRpbmddO1xyXG4gICAgICAgIGlmIChyZXEubWF4X3pvb20gIT0gbnVsbCkgb3B0aW9ucy5tYXhab29tID0gcmVxLm1heF96b29tO1xyXG4gICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzLCBvcHRpb25zKTtcclxuXHJcbiAgICAgICAgLy8gQXBwbGllZCBhZnRlciB0aGUgZml0LCBzaW5jZSBpdCBpcyByZWxhdGl2ZSB0byB3aGF0ZXZlciB6b29tIHRoZSBmaXQgY2hvc2UuXHJcbiAgICAgICAgaWYgKHJlcS56b29tX29mZnNldCkge1xyXG4gICAgICAgICAgICBtYXAuc2V0Wm9vbShtYXAuZ2V0Wm9vbSgpICsgcmVxLnpvb21fb2Zmc2V0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6Zml0X2JvdW5kc19yZXF1ZXN0XCIsIGFwcGx5Rml0UmVxdWVzdCk7XHJcbiAgICAvLyBBIHJlcXVlc3Qgc2V0IGJlZm9yZSB0aGlzIHZpZXcgYXR0YWNoZWQgLS0gYSBwcmUtZGlzcGxheSBmaXRfYm91bmRzKCkgY2FsbCxcclxuICAgIC8vIG9yIHRoZSB1bmlvbiBhIGZyZXNoIG1hcCBtYWludGFpbnMgYXMgYXV0by1maXQgd2hpbGUgbGF5ZXJzIGFyZSBhZGRlZCAtLSBpc1xyXG4gICAgLy8gYWxyZWFkeSBzdGF0ZSBieSBub3csIHNvIHRoZSBjaGFuZ2UgZXZlbnQgd2lsbCBuZXZlciBmaXJlIGZvciBpdC4gSXQgdXNlZFxyXG4gICAgLy8gdG8gYmUgc2lsZW50bHkgZHJvcHBlZDsgYXBwbHkgaXQgb25jZSB0aGUgbWFwIGlzIHJlYWR5IGluc3RlYWQuXHJcbiAgICBtYXAud2hlblJlYWR5KCgpID0+IGFwcGx5Rml0UmVxdWVzdCgpKTtcclxuICAgIC8vIEEgbWFwIGNvbnN0cnVjdGVkIGluc2lkZSBhIGhpZGRlbiBjb250YWluZXIgLS0gYSBTaGlueSBuYXZfcGFuZWwgdGhhdCBpc1xyXG4gICAgLy8gbm90IHRoZSBzZWxlY3RlZCB0YWIgLS0gaW5pdGlhbGlzZXMgYXQgMHgwLCBhbmQgTGVhZmxldCBjYWNoZXMgdGhhdCBzaXplOlxyXG4gICAgLy8gaXRzIG93biB0cmFja1Jlc2l6ZSB3YXRjaGVzIHRoZSBXSU5ET1csIG5vdCB0aGUgY29udGFpbmVyLCBzbyBub3RoaW5nIGV2ZXJcclxuICAgIC8vIGNvcnJlY3RzIGl0LiBUaGUgZml0IGFib3ZlIHRoZW4gY29tcHV0ZXMgaXRzIHpvb20gZnJvbSBhIHplcm8tc2l6ZSBsaWUgYW5kXHJcbiAgICAvLyB0aGUgdmlldyBsYW5kcyB3cm9uZyBwZXJtYW5lbnRseS4gV2F0Y2ggdGhlIGNvbnRhaW5lciBpdHNlbGY6IGV2ZXJ5IHJlc2l6ZVxyXG4gICAgLy8gcmUtbWVhc3VyZXMsIGFuZCB0aGUgZmlyc3QgdHJhbnNpdGlvbiBmcm9tIHplcm8gdG8gcmVhbCBzaXplIHJlLWFwcGxpZXNcclxuICAgIC8vIHRoZSBwZW5kaW5nIGZpdCB3aXRoIGEgc2l6ZSB0aGF0IGNhbiBhY3R1YWxseSBob2xkIGl0LlxyXG4gICAgbGV0IGNvbnRhaW5lclJlc2l6ZSA9IG51bGw7XHJcbiAgICBpZiAodHlwZW9mIFJlc2l6ZU9ic2VydmVyICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgbGV0IGhhZFNpemUgPSBjb250YWluZXIuY2xpZW50V2lkdGggPiAwICYmIGNvbnRhaW5lci5jbGllbnRIZWlnaHQgPiAwO1xyXG4gICAgICAgIGNvbnRhaW5lclJlc2l6ZSA9IG5ldyBSZXNpemVPYnNlcnZlcigoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGhhc1NpemUgPSBjb250YWluZXIuY2xpZW50V2lkdGggPiAwICYmIGNvbnRhaW5lci5jbGllbnRIZWlnaHQgPiAwO1xyXG4gICAgICAgICAgICBpZiAoaGFzU2l6ZSkge1xyXG4gICAgICAgICAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWhhZFNpemUpIGFwcGx5Rml0UmVxdWVzdCgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGhhZFNpemUgPSBoYXNTaXplO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRhaW5lclJlc2l6ZS5vYnNlcnZlKGNvbnRhaW5lcik7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHN5bmNUaW1lb3V0ID0gbnVsbDtcclxuICAgIGxldCBpc1N5bmNpbmcgPSBmYWxzZTtcclxuICAgIGxldCBuZWVkc1N5bmMgPSBmYWxzZTtcclxuXHJcbiAgICBhc3luYyBmdW5jdGlvbiBwZXJmb3JtU3luYygpIHtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgaWYgKGlzU3luY2luZykge1xyXG4gICAgICAgICAgICBuZWVkc1N5bmMgPSB0cnVlO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlzU3luY2luZyA9IHRydWU7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgc3luY01hcFN0YXRlKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBzeW5jTWFwU3RhdGU6XCIsIGVycik7XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgaXNTeW5jaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgIGlmIChuZWVkc1N5bmMpIHtcclxuICAgICAgICAgICAgICAgIG5lZWRzU3luYyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBxdWV1ZVN5bmMoKSB7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCB8fCAhaG9zdC5nZXQoXCJhdXRvX3N5bmNcIikpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcclxuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lb3V0KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgc3luY1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgIH0sIDUwKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBMaXN0ZW4gZm9yIG1hbnVhbCBzeW5jIHRyaWdnZXIgY2hhbmdlcyBmcm9tIFB5dGhvblxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnN5bmNfdHJpZ2dlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEluY3JlbWVudGFsIHVwZGF0ZXMgZnJvbSBQeXRob24uIEFwcGxpZWQgZXZlbiB3aGVuIGF1dG9fc3luYyBpcyBvZmYgc28gdGhlIG1pcnJvclxyXG4gICAgLy8gc3RheXMgY3VycmVudDsgcXVldWVTeW5jIGRlY2lkZXMgd2hldGhlciB0byBhY3R1YWxseSByZS1yZW5kZXIuXHJcbiAgICBsaXN0ZW4oXCJtc2c6Y3VzdG9tXCIsIChtc2csIGJ1ZmZlcnMpID0+IHtcclxuICAgICAgICBpZiAoIW1zZyB8fCBtc2cua2luZCAhPT0gXCJzd2lmdG1hcF9wYXRjaFwiKSByZXR1cm47XHJcbiAgICAgICAgYXBwbHlQYXRjaE9wcyhtc2cub3BzIHx8IFtdLCBidWZmZXJzKTtcclxuICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEZ1bGwtc25hcHNob3QgcGF0aHM6IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UsIGFuZCB0aGUgc2lkZWJhciB3cml0aW5nIGBsYXllcnNgXHJcbiAgICAvLyBiYWNrIGFmdGVyIGEgdG9nZ2xlLiBFaXRoZXIgd2F5IHRoZSB0cmFpdCBiZWNvbWVzIGF1dGhvcml0YXRpdmUgYWdhaW4uXHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6bGF5ZXJzXCIsICgpID0+IHtcclxuICAgICAgICBsYXllclN0YXRlID0gaG9zdC5nZXQoXCJsYXllcnNcIikgfHwgW107XHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpjb29yZGluYXRlX2J1ZmZlcnNcIiwgKCkgPT4ge1xyXG4gICAgICAgIGJ1ZmZlclN0YXRlID0geyAuLi4oaG9zdC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pIH07XHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpncm91cF9jb25maWdzXCIsIHF1ZXVlU3luYyk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6dGltZV9jb25maWdcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7ICAgLy8gcmUtYXBwbHkgc3BlZWQvbG9vcCBmcm9tIHRoZSBuZXcgY29uZmlnXHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuICAgIC8vIFB5dGhvbiBzdGVlcmluZyB0aGUgc2xpZGVyOiBzbmFwIHRvIHRoZSBuZWFyZXN0IHRpY2sgYXQgb3IgYWZ0ZXIgdGhlIHJlcXVlc3RlZFxyXG4gICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cclxuICAgIGxpc3RlbihcImNoYW5nZTp0aW1lX2N1cnJlbnRcIiwgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHdhbnRlZCA9IGhvc3QuZ2V0KFwidGltZV9jdXJyZW50XCIpO1xyXG4gICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XHJcbiAgICAgICAgaWYgKE1hdGguYWJzKHdhbnRlZCAtIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKSA8IDEpIHJldHVybjtcclxuICAgICAgICBsZXQgaWR4ID0gdGltZVVJLnRpY2tzLmZpbmRJbmRleCh0ID0+IHQgPj0gd2FudGVkKTtcclxuICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XHJcbiAgICAgICAgc2Vla1RvKGlkeCwgeyB3cml0ZTogZmFsc2UgfSk7XHJcbiAgICB9KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzaG93X2xvZ29cIiwgcXVldWVTeW5jKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzaG93X2xlZ2VuZFwiLCBxdWV1ZVN5bmMpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmxlZ2VuZF9jb25maWdcIiwgcXVldWVTeW5jKTtcclxuICAgIC8vIExpdmUgcmVzaXplcyAoYSBTaGlueSBsYXlvdXQsIGEgbm90ZWJvb2sgY2VsbCk6IExlYWZsZXQgY2FjaGVzIGl0cyBib3gsIHNvXHJcbiAgICAvLyBpdCBtdXN0IGJlIHRvbGQgdG8gcmUtbWVhc3VyZSBvciB0aWxlcyByZW5kZXIgZm9yIHRoZSBvbGQgc2l6ZS5cclxuICAgIGxpc3RlbihcImNoYW5nZTpoZWlnaHRcIiwgKCkgPT4ge1xyXG4gICAgICAgIGFwcGx5SGVpZ2h0KCk7XHJcbiAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBbm5vdW5jZSB0aGlzIHZpZXcgc28gUHl0aG9uIHJlcGxpZXMgd2l0aCBhIGZ1bGwgc25hcHNob3QuIExheWVycyBhZGRlZCBiZWZvcmVcclxuICAgIC8vIHRoZSB2aWV3IGF0dGFjaGVkIHdvdWxkIG90aGVyd2lzZSBiZSBtaXNzaW5nOiB0aGVpciBwYXRjaGVzIHdlcmUgZW1pdHRlZCBpbnRvIGFcclxuICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIGhvc3Quc2VuZCh7IGtpbmQ6IFwic3dpZnRtYXBfcmVhZHlcIiB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgaXMgYWxsIHRoZXJlIGlzICovIH1cclxuXHJcbiAgICAvLyBSZXNwZWN0IGluaXRpYWwgYXV0b19zeW5jIHN0YXRlIG9yIG1hbnVhbCBzeW5jIHJlcXVlc3RzIHNlbnQgZHVyaW5nIG1hcCBidWlsZGluZ1xyXG4gICAgaWYgKGhvc3QuZ2V0KFwiYXV0b19zeW5jXCIpIHx8IGhvc3QuZ2V0KFwic3luY190cmlnZ2VyXCIpID4gMCkge1xyXG4gICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVGhlIGhhbmRsZSBhIGhvc3Qga2VlcHM6IHRoZSBsaXZlIG1hcCBhbmQgYSB0ZWFyZG93biB0aGF0IHJlbGVhc2VzIHdoYXQgdGhlXHJcbiAgICAvLyBwYWdlIGNhbm5vdCByZWNsYWltIG9uIGl0cyBvd24gLS0gcGxheWJhY2sgdGltZXJzLCB0aGUgcGVuZGluZyBzeW5jLCB0aGVcclxuICAgIC8vIGNvbnRhaW5lcidzIHJlc2l6ZSBvYnNlcnZlciwgdGhlIGNvbnNvbGUgaG9va3MsIHRoZSBob3N0IHN1YnNjcmlwdGlvbnMsIGFuZFxyXG4gICAgLy8gdGhlIExlYWZsZXQgbWFwIHdpdGggZXZlcnkgR0wgY29udGV4dCBhbmQgYmxvYiBVUkwgaXRzIGxheWVycyBob2xkLlxyXG4gICAgZnVuY3Rpb24gZGVzdHJveSgpIHtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgZGVzdHJveWVkID0gdHJ1ZTtcclxuICAgICAgICBzdG9wUGxheWJhY2soKTtcclxuICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcclxuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lb3V0KTtcclxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoY29udGFpbmVyUmVzaXplKSBjb250YWluZXJSZXNpemUuZGlzY29ubmVjdCgpO1xyXG4gICAgICAgIGlmICh0eXBlb2YgaG9zdC5vZmYgPT09IFwiZnVuY3Rpb25cIikge1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtldmVudCwgZm5dIG9mIHN1YnNjcmlwdGlvbnMpIGhvc3Qub2ZmKGV2ZW50LCBmbik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IgPSBvcmlnaW5hbEVycm9yO1xyXG4gICAgICAgIGNvbnNvbGUud2FybiA9IG9yaWdpbmFsV2FybjtcclxuICAgICAgICBpZiAod2luZG93Lm9uZXJyb3IgPT09IG9uV2luZG93RXJyb3IpIHdpbmRvdy5vbmVycm9yID0gbnVsbDtcclxuICAgICAgICAvLyBnbGlmeSBrZWVwcyBldmVyeSBpbnN0YW5jZSBpbiBhIG1vZHVsZS1sZXZlbCBsaXN0OyBtYXAucmVtb3ZlKCkgYWxvbmVcclxuICAgICAgICAvLyB3b3VsZCBsZWF2ZSBlYWNoIG9uZSAtLSBhbmQgaXRzIEdMIGNvbnRleHQgLS0gcmVnaXN0ZXJlZCB0aGVyZS4gVGhlXHJcbiAgICAgICAgLy8gc3dlZXAgb3ZlciB0aG9zZSBsaXN0cyBhbHNvIGNhdGNoZXMgYW4gaW5zdGFuY2UgYSBzeW5jIGJ1aWx0IGZvciB0aGlzXHJcbiAgICAgICAgLy8gbWFwIGFuZCBoYWQgbm90IHlldCByZWNvcmRlZCB3aGVuIHRoZSBob3N0IGRlc3Ryb3llZCBpdC5cclxuICAgICAgICBmb3IgKGNvbnN0IHN0YXRlIG9mIE9iamVjdC52YWx1ZXMoZ2xTdGF0ZXMpKSB7XHJcbiAgICAgICAgICAgIHJldGlyZUdsKHN0YXRlLmxheWVyKTtcclxuICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBnbGlmeSA9IEwuZ2xpZnk7XHJcbiAgICAgICAgaWYgKGdsaWZ5KSB7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGlzdCBvZiBbZ2xpZnkucG9pbnRzSW5zdGFuY2VzLCBnbGlmeS5saW5lc0luc3RhbmNlcywgZ2xpZnkuc2hhcGVzSW5zdGFuY2VzXSkge1xyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBpbnN0YW5jZSBvZiBbLi4uKGxpc3QgfHwgW10pXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZS5tYXAgPT09IG1hcCkgcmV0aXJlR2woaW5zdGFuY2UpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIG1hcC5yZW1vdmUoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogYWxyZWFkeSB0b3JuIGRvd24gKi8gfVxyXG4gICAgICAgIGlmIChjb250YWluZXIucGFyZW50Tm9kZSkgY29udGFpbmVyLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoY29udGFpbmVyKTtcclxuICAgIH1cclxuICAgIHJldHVybiB7IG1hcCwgY29udGFpbmVyLCBzeW5jOiBwZXJmb3JtU3luYywgZGVzdHJveSB9O1xyXG59XHJcbiIsICIvLyBUaGUgQ0ROIGxvYWRlciwgZm9yIGhvc3RzIHdob3NlIHBhZ2UgaGFzIG5vIGJ1bmRsZXI6IHRoZSBhbnl3aWRnZXQgd2lkZ2V0IGFuZFxyXG4vLyBhIHN0YXRpYyBleHBvcnQuIEZldGNoZXMgTGVhZmxldCwgZ2xpZnkgYW5kIEdlb21hbiBmcm9tIHVucGtnIC0tIGEgcmVjZWl2aW5nXHJcbi8vIG5ldHdvcmsncyBwYXRjaGVyIHJld3JpdGVzIHRoZXNlIFVSTHMgbGlrZSBhbnkgb3RoZXIgQ0ROIHJlZmVyZW5jZSAtLSBhbmQgdGhlblxyXG4vLyBwcm92aWRlcyB0aGUgZ2xvYmFsIHRoZXkgaW5zdGFsbC4gRXZlcnl0aGluZyBpcyBhd2FpdGVkIGJlZm9yZSByZXR1cm5pbmcsIHNvXHJcbi8vIEdlb21hbiBleGlzdHMgYmVmb3JlIGFueSBtYXAgaXMgYnVpbHQuIFRoZSBVUkwgdGFibGUgaXMgYSBwYXJhbWV0ZXIgc28gYVxyXG4vLyB2ZW5kb3JlZCBvciBpbmxpbmVkIHZhcmlhbnQgaXMgYSBtYXR0ZXIgb2YgcGFzc2luZyBkaWZmZXJlbnQgb25lcy5cclxuaW1wb3J0IHsgbG9hZENTUywgbG9hZEpTIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcclxuaW1wb3J0IHsgcHJvdmlkZUxlYWZsZXQgfSBmcm9tIFwiLi9saWJzLmpzXCI7XHJcblxyXG5leHBvcnQgY29uc3QgTElCUkFSWV9VUkxTID0ge1xyXG4gICAgbGVhZmxldENzczogXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5jc3NcIixcclxuICAgIGxlYWZsZXRKczogXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5qc1wiLFxyXG4gICAgZ2xpZnlKczogXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0LmdsaWZ5QDMuMy4wL2Rpc3QvZ2xpZnktYnJvd3Nlci5qc1wiLFxyXG4gICAgZ2VvbWFuQ3NzOiBcImh0dHBzOi8vdW5wa2cuY29tL0BnZW9tYW4taW8vbGVhZmxldC1nZW9tYW4tZnJlZUAyLjE4LjMvZGlzdC9sZWFmbGV0LWdlb21hbi5jc3NcIixcclxuICAgIGdlb21hbkpzOiBcImh0dHBzOi8vdW5wa2cuY29tL0BnZW9tYW4taW8vbGVhZmxldC1nZW9tYW4tZnJlZUAyLjE4LjMvZGlzdC9sZWFmbGV0LWdlb21hbi5taW4uanNcIixcclxufTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkTGlicmFyaWVzKHVybHMgPSBMSUJSQVJZX1VSTFMpIHtcclxuICAgIGxvYWRDU1MoXCJsZWFmbGV0LWNzc1wiLCB1cmxzLmxlYWZsZXRDc3MpO1xyXG4gICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1qc1wiLCB1cmxzLmxlYWZsZXRKcyk7XHJcbiAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdsaWZ5XCIsIHVybHMuZ2xpZnlKcyk7XHJcbiAgICBsb2FkQ1NTKFwibGVhZmxldC1nZW9tYW4tY3NzXCIsIHVybHMuZ2VvbWFuQ3NzKTtcclxuICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2VvbWFuXCIsIHVybHMuZ2VvbWFuSnMpO1xyXG4gICAgcmV0dXJuIHByb3ZpZGVMZWFmbGV0KHdpbmRvdy5MKTtcclxufVxyXG4iLCAiLyoqXHJcbiAqIFRoZSBob3N0IGludGVyZmFjZTogd2hhdCBhIHN3aWZ0bWFwIGNvcmUgaW5zdGFuY2UgbmVlZHMgZnJvbSB3aGF0ZXZlciBlbWJlZHMgaXQuXHJcbiAqXHJcbiAqIEZpdmUgbWV0aG9kcywgYWxyZWFkeSBwcm92ZW4gYnkgZXZlcnkgc3RhdGljIGV4cG9ydCwgd2hpY2ggcnVucyB0aGUgcmVhbCBidW5kbGVcclxuICogYWdhaW5zdCBleGFjdGx5IHRoaXMgc3VyZmFjZSB3aXRoIG5vIFB5dGhvbiBiZWhpbmQgaXQ6XHJcbiAqXHJcbiAqICAgZ2V0KGtleSkgICAgICAgICAgICAgIC0+IHRoZSBjdXJyZW50IHZhbHVlIG9mIGEgc3RhdGUga2V5XHJcbiAqICAgc2V0KGtleSwgdmFsdWUpICAgICAgIC0+IHN0b3JlIGl0IGFuZCBmaXJlIHRoZSBgY2hhbmdlOjxrZXk+YCBsaXN0ZW5lcnNcclxuICogICBvbihldmVudCwgZm4pICAgICAgICAgLT4gc3Vic2NyaWJlOyBgY2hhbmdlOjxrZXk+YCwgYW5kIGBtc2c6Y3VzdG9tYCBmb3IgcGF0Y2hlc1xyXG4gKiAgIHNlbmQoY29udGVudCwgYnVmZmVycyktPiBhIG1lc3NhZ2UgdG8gdGhlIG90aGVyIHNpZGUgKG1heSBnbyBub3doZXJlKVxyXG4gKiAgIHNhdmVfY2hhbmdlcygpICAgICAgICAtPiBmbHVzaCBwZW5kaW5nIHdyaXRlcyAobWF5IGJlIGEgbm8tb3ApXHJcbiAqXHJcbiAqIE9wdGlvbmFsOiBvZmYoZXZlbnQsIGZuKSwgaG9ub3VyZWQgYnkgZGVzdHJveSgpIHdoZW4gcHJlc2VudC5cclxuICpcclxuICogVGhlIGNvcmUgcmVhZHMgdGhlc2Uga2V5cyB0aHJvdWdoIGdldCgpOiBsYXllcnMsIGNvb3JkaW5hdGVfYnVmZmVycywgZ3JvdXBfY29uZmlncyxcclxuICogY2VudGVyLCB6b29tLCBjcnMsIGhlaWdodCwgYXV0b19zeW5jLCBzeW5jX3RyaWdnZXIsIHNob3dfbG9nbywgbG9nb19jb25maWcsXHJcbiAqIHNob3dfbGVnZW5kLCBsZWdlbmRfY29uZmlnLCBzaG93X3NjYWxlLCBzY2FsZV9jb25maWcsIHNob3dfZHJhdywgZHJhd19jb25maWcsXHJcbiAqIGRyYXdpbmdzLCBkcmF3X3NlcSwgc2hvd19jbGlja19jb29yZGluYXRlcywgdGltZV9jb25maWcsIHRpbWVfY3VycmVudCxcclxuICogZml0X2JvdW5kc19yZXF1ZXN0LCBqc19jb25zb2xlX2xvZ3MuIEl0IHdyaXRlcyBiYWNrIHRocm91Z2ggc2V0KCk6IGNlbnRlciwgem9vbSxcclxuICogY2xpY2tlZF9sYXllcl9pZCwgc2VsZWN0ZWRfaW5kZXgsIGNsaWNrZWRfbGF0bG5nLCBjbGlja19zZXEsIGRyYXdpbmdzLCBkcmF3X3NlcSxcclxuICogdGltZV9jdXJyZW50LCB0aW1lX2NvbmZpZywgZ3JvdXBfY29uZmlncywganNfY29uc29sZV9sb2dzLiBTaWRlYmFyIHRvZ2dsZXMgZ28gb3V0XHJcbiAqIHRocm91Z2ggc2VuZCgpIGFzIHtraW5kOiBcInN3aWZ0bWFwX3dyaXRlXCIsIG9wc307IHRoZSB3aWRnZXQgYW5ub3VuY2VzIGl0c2VsZiB3aXRoXHJcbiAqIHtraW5kOiBcInN3aWZ0bWFwX3JlYWR5XCJ9LiBJbmNyZW1lbnRhbCB1cGRhdGVzIGFycml2ZSBvbiB0aGUgYG1zZzpjdXN0b21gIGV2ZW50IGFzXHJcbiAqICh7a2luZDogXCJzd2lmdG1hcF9wYXRjaFwiLCBvcHN9LCBidWZmZXJzKS5cclxuICpcclxuICogYW55d2lkZ2V0J3MgbW9kZWwgc2F0aXNmaWVzIHRoaXMgYXMtaXM7IHRoZSBzdHViIGJlbG93IGlzIHRoZSByZWZlcmVuY2UgaG9zdCBmb3JcclxuICogZXhwb3J0cywgdGVzdHMsIGFuZCBhbnkgZW1iZWRkaW5nIHdpdGggbm8ga2VybmVsIGJlaGluZCBpdC5cclxuICovXHJcblxyXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSG9zdFN0dWIoaW5pdGlhbCA9IHt9LCBob29rcyA9IHt9KSB7XHJcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uaW5pdGlhbCB9O1xyXG4gICAgY29uc3QgbGlzdGVuZXJzID0ge307XHJcbiAgICBjb25zdCBob3N0ID0ge1xyXG4gICAgICAgIGNvbW06IGhvb2tzLmNvbW0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBob29rcy5jb21tLFxyXG4gICAgICAgIHN0YXRlLFxyXG4gICAgICAgIHNldHM6IFtdLCAgICAgIC8vIGV2ZXJ5IHNldCgpLCBpbiBvcmRlciwgZm9yIGFzc2VydGlvbnNcclxuICAgICAgICBzZW50OiBbXSwgICAgICAvLyBldmVyeSBzZW5kKClcclxuICAgICAgICBzYXZlczogMCxcclxuICAgICAgICBnZXQ6IGtleSA9PiBzdGF0ZVtrZXldLFxyXG4gICAgICAgIHNldChrZXksIHZhbHVlKSB7XHJcbiAgICAgICAgICAgIHN0YXRlW2tleV0gPSB2YWx1ZTtcclxuICAgICAgICAgICAgaG9zdC5zZXRzLnB1c2goW2tleSwgdmFsdWVdKTtcclxuICAgICAgICAgICAgKGxpc3RlbmVyc1tgY2hhbmdlOiR7a2V5fWBdIHx8IFtdKS5mb3JFYWNoKGZuID0+IGZuKCkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb24oZXZlbnQsIGZuKSB7XHJcbiAgICAgICAgICAgIChsaXN0ZW5lcnNbZXZlbnRdID0gbGlzdGVuZXJzW2V2ZW50XSB8fCBbXSkucHVzaChmbik7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvZmYoZXZlbnQsIGZuKSB7XHJcbiAgICAgICAgICAgIGxpc3RlbmVyc1tldmVudF0gPSAobGlzdGVuZXJzW2V2ZW50XSB8fCBbXSkuZmlsdGVyKGYgPT4gZiAhPT0gZm4pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2VuZChjb250ZW50LCBidWZmZXJzKSB7XHJcbiAgICAgICAgICAgIGhvc3Quc2VudC5wdXNoKHsgY29udGVudCwgYnVmZmVycyB9KTtcclxuICAgICAgICAgICAgaWYgKGhvb2tzLm9uU2VuZCkgaG9va3Mub25TZW5kKGNvbnRlbnQsIGJ1ZmZlcnMpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2F2ZV9jaGFuZ2VzKCkge1xyXG4gICAgICAgICAgICBob3N0LnNhdmVzICs9IDE7XHJcbiAgICAgICAgICAgIGlmIChob29rcy5vblNhdmUpIGhvb2tzLm9uU2F2ZSgpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gRmlyZXMgbGlzdGVuZXJzIGRpcmVjdGx5OiBob3cgYSB0ZXN0IG9yIGFuIGV4cG9ydCBwdXNoZXMgYSByZWFsXHJcbiAgICAgICAgLy8gc3dpZnRtYXBfcGF0Y2ggdGhyb3VnaCBgbXNnOmN1c3RvbWAsIGV4YWN0bHkgYXMgYSBrZXJuZWwgd291bGQuXHJcbiAgICAgICAgZW1pdChldmVudCwgLi4uYXJncykge1xyXG4gICAgICAgICAgICAobGlzdGVuZXJzW2V2ZW50XSB8fCBbXSkuZm9yRWFjaChmbiA9PiBmbiguLi5hcmdzKSk7XHJcbiAgICAgICAgfSxcclxuICAgIH07XHJcbiAgICByZXR1cm4gaG9zdDtcclxufVxyXG4iLCAiLy8gVGhlIGFueXdpZGdldCBhZGFwdGVyOiBvbmUgaG9zdCBvdmVyIHRoZSBzd2lmdG1hcCBjb3JlLlxyXG4vL1xyXG4vLyBhbnl3aWRnZXQncyBtb2RlbCBhbHJlYWR5IElTIGEgaG9zdCAtLSBnZXQvc2V0L29uL3NlbmQvc2F2ZV9jaGFuZ2VzLCB3aXRoXHJcbi8vIGBjaGFuZ2U6PGtleT5gIGFuZCBgbXNnOmN1c3RvbWAgZXZlbnRzIC0tIHNvIG5vdGhpbmcgaXMgdHJhbnNsYXRlZCBoZXJlLiBUaGVcclxuLy8gY2xlYW51cCByZXR1cm5lZCB0ZWFycyB0aGUgbWFwIGRvd24gd2hlbiBhbnl3aWRnZXQgZGlzY2FyZHMgdGhlIHZpZXcuXHJcbmltcG9ydCB7IGNyZWF0ZVN3aWZ0TWFwIH0gZnJvbSBcIi4vY29yZS5qc1wiO1xyXG5pbXBvcnQgeyBsb2FkTGlicmFyaWVzIH0gZnJvbSBcIi4vbG9hZGVyLmpzXCI7XHJcblxyXG5leHBvcnQgeyBjcmVhdGVIb3N0U3R1YiB9IGZyb20gXCIuL2hvc3QuanNcIjtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IHtcclxuICAgIGFzeW5jIHJlbmRlcih7IG1vZGVsLCBlbCB9KSB7XHJcbiAgICAgICAgLy8gVGhpcyBob3N0J3MgcGFnZSBoYXMgbm8gYnVuZGxlcjogTGVhZmxldCwgZ2xpZnkgYW5kIEdlb21hbiBjb21lIGZyb21cclxuICAgICAgICAvLyB0aGUgQ0ROLCBmdWxseSBsb2FkZWQgYmVmb3JlIHRoZSBtYXAgaXMgY29uc3RydWN0ZWQuXHJcbiAgICAgICAgY29uc3QgbGVhZmxldCA9IGF3YWl0IGxvYWRMaWJyYXJpZXMoKTtcclxuICAgICAgICBjb25zdCBoYW5kbGUgPSBhd2FpdCBjcmVhdGVTd2lmdE1hcCh7IGhvc3Q6IG1vZGVsLCBlbCwgbGVhZmxldCB9KTtcclxuICAgICAgICByZXR1cm4gKCkgPT4gaGFuZGxlLmRlc3Ryb3koKTtcclxuICAgIH0sXHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFXTyxJQUFJLElBQUk7QUFFUixTQUFTLGVBQWUsU0FBUztBQUNwQyxNQUFJ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QSxJQUNuRDtBQUFBLElBQ0EsZUFBZTtBQUNYLFdBQUssU0FBUztBQUNkLFVBQUksTUFBTSxPQUFRLE9BQU0sT0FBTztBQUFBLElBQ25DO0FBQUE7QUFBQTtBQUFBLElBR0EsS0FBSyxVQUFVLE1BQU07QUFDakIsT0FBQyxVQUFVLEtBQUssS0FBSyxDQUFDLEdBQUcsUUFBUSxRQUFNLEdBQUcsR0FBRyxJQUFJLENBQUM7QUFBQSxJQUN0RDtBQUFBLEVBQ0o7QUFDQSxTQUFPO0FBQ1g7OztBQ3ZEQSxJQUFPLG9CQUFRO0FBQUEsRUFDWCxNQUFNLE9BQU8sRUFBRSxPQUFPLEdBQUcsR0FBRztBQUd4QixVQUFNLFVBQVUsTUFBTSxjQUFjO0FBQ3BDLFVBQU0sU0FBUyxNQUFNLGVBQWUsRUFBRSxNQUFNLE9BQU8sSUFBSSxRQUFRLENBQUM7QUFDaEUsV0FBTyxNQUFNLE9BQU8sUUFBUTtBQUFBLEVBQ2hDO0FBQ0o7IiwKICAibmFtZXMiOiBbImNvbGxhcHNlZEJ5Q29udGFpbmVyIiwgImNvdW50IiwgImdsTGF5ZXIiLCAiaW5zdGFuY2UiLCAiTCIsICJjb250YWluZXIiLCAiem9vbSJdCn0K
