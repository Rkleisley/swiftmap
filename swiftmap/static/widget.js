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
        state.visKey = null;
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

// src/transport.js
function decodeBase64Buffers(encoded) {
  const out = {};
  for (const [key, b64] of Object.entries(encoded || {})) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    out[key] = new DataView(bytes.buffer);
  }
  return out;
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
  decodeBase64Buffers,
  anywidget_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL2xpYnMuanMiLCAiLi4vLi4vc3JjL3NpZGViYXIuanMiLCAiLi4vLi4vc3JjL3BhdGNoLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy90aW1lY29udHJvbC5qcyIsICIuLi8uLi9zcmMvZ3B1dGltZS5qcyIsICIuLi8uLi9zcmMvbGF5ZXJzLmpzIiwgIi4uLy4uL3NyYy9sYWJlbHMuanMiLCAiLi4vLi4vc3JjL2NvcmUuanMiLCAiLi4vLi4vc3JjL2xvYWRlci5qcyIsICIuLi8uLi9zcmMvaG9zdC5qcyIsICIuLi8uLi9zcmMvdHJhbnNwb3J0LmpzIiwgIi4uLy4uL3NyYy9hbnl3aWRnZXQuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFRoZSBsaWJyYXJpZXMgdGhlIGNvcmUgcmVuZGVycyB3aXRoLCBQUk9WSURFRCBieSB0aGUgaG9zdCBiZWZvcmUgdGhlIG1hcCBpc1xyXG4vLyBjb25zdHJ1Y3RlZCAtLSBuZXZlciByZWFjaGVkIGZvciBhcyBnbG9iYWxzLiBgTGAgaXMgYSBsaXZlIGJpbmRpbmc6IGV2ZXJ5XHJcbi8vIG1vZHVsZSBpbXBvcnRzIGl0IGZyb20gaGVyZSBhbmQgc2VlcyB3aGF0ZXZlciBwcm92aWRlTGVhZmxldCBzZXQuXHJcbi8vXHJcbi8vIFR3byBraW5kcyBvZiBob3N0LiBUaGUgd2lkZ2V0IGFuZCBhIHN0YXRpYyBleHBvcnQgZmV0Y2ggTGVhZmxldCwgZ2xpZnkgYW5kXHJcbi8vIEdlb21hbiBhdCBydW50aW1lIChzcmMvbG9hZGVyLmpzKSwgYmVjYXVzZSB0aGVpciBwYWdlIGhhcyBubyBidW5kbGVyOyBhbiBucG1cclxuLy8gY29uc3VtZXIgaW1wb3J0cyB0aGVtIGFzIHJlYWwgZGVwZW5kZW5jaWVzIGFuZCBwYXNzZXMgdGhlIHJlc3VsdCBpbi4gRWl0aGVyXHJcbi8vIHdheSB0aGUgT1JERVIgaXMgZml4ZWQgYnkgY29uc3RydWN0aW9uOiBHZW9tYW4gYXR0YWNoZXMgbWFwLnBtIHRocm91Z2ggYVxyXG4vLyBMZWFmbGV0IGluaXQgaG9vayB0aGF0IG9ubHkgcnVucyBmb3IgbWFwcyBjcmVhdGVkIGFmdGVyIHRoZSBwbHVnaW4gZXhpc3RzXHJcbi8vICg1Mzk0ZDFlKSwgc28gcHJvdmlkaW5nIG11c3QgZmluaXNoIGJlZm9yZSBjcmVhdGVTd2lmdE1hcCBidWlsZHMgdGhlIG1hcCAtLVxyXG4vLyB3aGljaCBpcyB3aHkgdGhlIGNvcmUgdGFrZXMgTGVhZmxldCBhcyBhbiBhcmd1bWVudCBhbmQgbmV2ZXIgbG9hZHMgaXQgbGF6aWx5LlxyXG5leHBvcnQgbGV0IEwgPSBudWxsO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHByb3ZpZGVMZWFmbGV0KGxlYWZsZXQpIHtcclxuICAgIGlmICghbGVhZmxldCB8fCB0eXBlb2YgbGVhZmxldC5tYXAgIT09IFwiZnVuY3Rpb25cIikge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcInN3aWZ0bWFwOiBwcm92aWRlTGVhZmxldCBleHBlY3RzIHRoZSBMZWFmbGV0IG5hbWVzcGFjZSAoTClcIik7XHJcbiAgICB9XHJcbiAgICBpZiAoIWxlYWZsZXQuZ2xpZnkpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oXCJbU3dpZnRNYXBdIHByb3ZpZGVMZWFmbGV0OiBMLmdsaWZ5IGlzIG1pc3NpbmcgLS0gaW1wb3J0IFwiXHJcbiAgICAgICAgICAgICsgXCJsZWFmbGV0LmdsaWZ5IGJlZm9yZSBwcm92aWRpbmcsIG9yIG5vIFdlYkdMIGxheWVyIHdpbGwgZHJhdy5cIik7XHJcbiAgICB9XHJcbiAgICBpZiAoIWxlYWZsZXQuUE0pIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oXCJbU3dpZnRNYXBdIHByb3ZpZGVMZWFmbGV0OiBMZWFmbGV0LUdlb21hbiBpcyBtaXNzaW5nIC0tIHRoZSBcIlxyXG4gICAgICAgICAgICArIFwiZHJhdy9BT0kgdG9vbGJhciB3aWxsIGJlIHVuYXZhaWxhYmxlLlwiKTtcclxuICAgIH1cclxuICAgIEwgPSBsZWFmbGV0O1xyXG4gICAgcmV0dXJuIEw7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZXF1aXJlTGVhZmxldCgpIHtcclxuICAgIGlmICghTCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcInN3aWZ0bWFwOiBubyBMZWFmbGV0IHByb3ZpZGVkLiBQYXNzIGBsZWFmbGV0YCB0byBcIlxyXG4gICAgICAgICAgICArIFwiY3JlYXRlU3dpZnRNYXAsIGNhbGwgcHJvdmlkZUxlYWZsZXQoTCksIG9yIHVzZSBsb2FkTGlicmFyaWVzKCkgb24gYSBcIlxyXG4gICAgICAgICAgICArIFwicGFnZSB0aGF0IGxvYWRzIGZyb20gYSBDRE4uXCIpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIEw7XHJcbn1cclxuIiwgIi8vIEZvbGRlciBjb2xsYXBzZSBzdGF0ZSwgUEVSIFNJREVCQVIuIEl0IHVzZWQgdG8gYmUgb25lIG1vZHVsZS1sZXZlbCBvYmplY3QsIHNvXHJcbi8vIHR3byBtYXBzIG9uIG9uZSBwYWdlIHNoYXJlZCBpdCAtLSBjb2xsYXBzaW5nIGEgZm9sZGVyIGluIG9uZSBjb2xsYXBzZWQgaXQgaW5cclxuLy8gdGhlIG90aGVyLiBLZXllZCBieSB0aGUgY29udGFpbmVyIGVsZW1lbnQsIGV4YWN0bHkgYXMgdGhlIGxlZ2VuZCBrZWVwcyBpdHMgb3duXHJcbi8vIGNvbGxhcHNlIHN0YXRlICgzYjljOTZjKSwgYW5kIHN1cnZpdmluZyB0aGUgZnVsbCByZS1yZW5kZXIgZXZlcnkgc3luYyBwZXJmb3Jtcy5cclxuY29uc3QgY29sbGFwc2VkQnlDb250YWluZXIgPSBuZXcgV2Vha01hcCgpO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNpZGViYXJDb2xsYXBzZVN0YXRlKGNvbnRhaW5lcikge1xyXG4gICAgbGV0IHN0YXRlID0gY29sbGFwc2VkQnlDb250YWluZXIuZ2V0KGNvbnRhaW5lcik7XHJcbiAgICBpZiAoIXN0YXRlKSB7XHJcbiAgICAgICAgc3RhdGUgPSB7fTtcclxuICAgICAgICBjb2xsYXBzZWRCeUNvbnRhaW5lci5zZXQoY29udGFpbmVyLCBzdGF0ZSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc3RhdGU7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRMYXllckJvdW5kcyhsLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKCFsKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAvLyBTdXBwb3J0IGZvbGRlciB0cmVlIG5vZGVzIChncm91cHMgaW4gc2lkZWJhciB0cmVlKVxyXG4gICAgaWYgKGwuaXNHcm91cCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkcmVuIGdyb3Vwc1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGwuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGwuY2hpbGRyZW5ba2V5XSwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZCBsYXllcnNcclxuICAgICAgICBsLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhseXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGwuYm91bmRzICYmIGwuYm91bmRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICByZXR1cm4gbC5ib3VuZHM7XHJcbiAgICB9XHJcbiAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgbC5sYXllcnMpIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsLmxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMoc3ViLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChsLmxvY2F0aW9ucyAmJiBsLmxvY2F0aW9ucy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgY29uc3QgY29vcmRzID0gbC5sb2NhdGlvbnMuZmxhdChJbmZpbml0eSk7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2ldO1xyXG4gICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSArIDFdO1xyXG4gICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF07XHJcbiAgICAgICAgaWYgKGJ1Zikge1xyXG4gICAgICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KGJ1Zi5idWZmZXIsIGJ1Zi5ieXRlT2Zmc2V0LCBidWYuYnl0ZUxlbmd0aCAvIDgpO1xyXG4gICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aCAvIDI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2kgKiAyXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA8IG1pbkxvbikgbWluTG9uID0gbG9uO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8vIFRoZSB3cml0ZSBoYWxmIG9mIGEgdmlzaWJpbGl0eSB0b2dnbGU6IG9uZSBjdXN0b20gbWVzc2FnZSBuYW1pbmcgdGhlIGZsaXBwZWQgaWRzLFxyXG4vLyBpbnN0ZWFkIG9mIHRoZSB3aG9sZSBsYXllcnMgdHJhaXQuIFB5dGhvbiBhcHBsaWVzIHRoZSBmaWVsZHMgYW5kIHJlLWVtaXRzIHRoZW0gYXNcclxuLy8gYHNldGAgcGF0Y2ggb3BzLCB3aGljaCBpcyBob3cgb3RoZXIgdmlld3Mgb2YgdGhlIHNhbWUgbWFwIChub3RlYm9vayBvdXRwdXRzKSBzdGF5XHJcbi8vIGluIHN0ZXAgbm93IHRoYXQgdGhlIHRyYWl0IG5vIGxvbmdlciBjYXJyaWVzIHRvZ2dsZXMuXHJcbi8vIGBjb2xsYXBzZWRQYXRoc2AgaXMgdGhlIGNhbGxpbmcgc2lkZWJhcidzIG93biBzdGF0ZSAoc2lkZWJhckNvbGxhcHNlU3RhdGUpLCBzb1xyXG4vLyBhIHJhZGlvIGdyb3VwJ3MgYXV0by1jb2xsYXBzZSBsYW5kcyBvbiB0aGF0IHNpZGViYXIgYWxvbmUuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncywgY29sbGFwc2VkUGF0aHMgPSB7fSkge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZXBvcnRzIHdoYXQgaXQgY2hhbmdlZCAtLSB7Y2hhbmdlczogW3tpZCwgdmlzaWJsZX1dLCBncm91cHNDaGFuZ2VkfSAtLSBzbyB0aGVcclxuICAgIC8vIGNhbGxlciBjYW4gd3JpdGUgYmFjayBleGFjdGx5IHRob3NlIGZsaXBzIHJhdGhlciB0aGFuIHRoZSB3aG9sZSBsYXllcnMgbGlzdC5cclxuICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgIGxldCBncm91cHNDaGFuZ2VkID0gZmFsc2U7XHJcbiAgICBmdW5jdGlvbiBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUpIHtcclxuICAgICAgICBjb25zdCBjb25mID0gZ3JvdXBDb25maWdzW25vZGUucGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc1JhZGlvR3JvdXAgPSBjb25mLm11bHRpX3NlbGVjdCA9PT0gZmFsc2U7XHJcbiAgICAgICAgaWYgKGlzUmFkaW9Hcm91cCkge1xyXG4gICAgICAgICAgICBsZXQgZm91bmRBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRHcm91cCA9IG5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBzQ2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGx5ci52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZTogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlLmNoaWxkcmVuW2tleV0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyh0cmVlKTtcclxuICAgIHJldHVybiB7IGNoYW5nZXMsIGdyb3Vwc0NoYW5nZWQgfTtcclxufVxyXG5cclxuLy8gYGN0eGAgaXMgd2hhdCB0aGUgc2lkZWJhciBuZWVkcyBmcm9tIGl0cyBob3N0LCBoYW5kZWQgaW4gcmF0aGVyIHRoYW4gcmVhY2hlZCBmb3I6XHJcbi8vICAgZ3JvdXBDb25maWdzICAgICAgICAgICB0aGUgZm9sZGVyIGZsYWdzIChtdXRhdGVkIGluIHBsYWNlIGFzIHRoZSB0cmVlIHRvZ2dsZXMpXHJcbi8vICAgY29vcmRpbmF0ZUJ1ZmZlcnMgICAgICB0aGUgbGl2ZSBidWZmZXIgbWFwLCBmb3IgZml0dGluZyBhIHRvZ2dsZWQgbm9kZVxyXG4vLyAgIG9uTGF5ZXJXcml0ZShjaGFuZ2VzKSAgdGFyZ2V0ZWQgdmlzaWJpbGl0eSBmbGlwcyB0byBzZW5kIG9uXHJcbi8vICAgb25Hcm91cENvbmZpZ3NDaGFuZ2UoZ3JvdXBDb25maWdzKSAgdGhlIGZvbGRlciBmbGFncyB0byBjb21taXRcclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIGN0eCwgbWFwLCBvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICBzaWRlYmFyLmlubmVySFRNTCA9IFwiPGIgc3R5bGU9J2ZvbnQtc2l6ZTogMTNweDsgYm9yZGVyLWJvdHRvbTogMnB4IHNvbGlkICNlZWU7IHBhZGRpbmctYm90dG9tOiA0cHg7IGRpc3BsYXk6IGJsb2NrOyBtYXJnaW4tYm90dG9tOiA4cHg7Jz5MYXllcnMgQ29udHJvbDwvYj5cIjtcclxuXHJcbiAgICBjb25zdCBjb2xsYXBzZWRQYXRocyA9IHNpZGViYXJDb2xsYXBzZVN0YXRlKHNpZGViYXIpO1xyXG4gICAgY29uc3QgZ3JvdXBDb25maWdzID0gKGN0eCAmJiBjdHguZ3JvdXBDb25maWdzKSB8fCB7fTtcclxuXHJcbiAgICAvLyAxLiBCdWlsZCBhIG5lc3RlZCBoaWVyYXJjaGljYWwgdHJlZSBmcm9tIHRoZSBmbGF0IGxheWVycyBsaXN0XHJcbiAgICBjb25zdCB0cmVlID0geyBuYW1lOiBcIlJvb3RcIiwgcGF0aDogXCJcIiwgY2hpbGRyZW46IHt9LCBsYXllcnM6IFtdLCBpc0dyb3VwOiB0cnVlIH07XHJcbiAgICBcclxuICAgIC8vIEVuc3VyZSByb290LWxldmVsIGNvbmZpZ3MgZGVmYXVsdCB0byBtdWx0aV9zZWxlY3Q6IHRydWUgaWYgbm90IHNwZWNpZmllZFxyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG5cclxuICAgIGxheWVycy5mb3JFYWNoKGwgPT4ge1xyXG4gICAgICAgIGNvbnN0IHBhdGhTdHIgPSBsLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCI7XHJcbiAgICAgICAgY29uc3QgcGFydHMgPSBwYXRoU3RyLnNwbGl0KFwiL1wiKTtcclxuICAgICAgICBsZXQgY3VyciA9IHRyZWU7XHJcbiAgICAgICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcclxuICAgICAgICBwYXJ0cy5mb3JFYWNoKHBhcnQgPT4ge1xyXG4gICAgICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcclxuICAgICAgICAgICAgaWYgKCFjdXJyLmNoaWxkcmVuW3BhcnRdKSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyLmNoaWxkcmVuW3BhcnRdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHBhcnQsXHJcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogcnVubmluZ1BhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IHt9LFxyXG4gICAgICAgICAgICAgICAgICAgIGxheWVyczogW10sXHJcbiAgICAgICAgICAgICAgICAgICAgaXNHcm91cDogdHJ1ZVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjdXJyID0gY3Vyci5jaGlsZHJlbltwYXJ0XTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjdXJyLmxheWVycy5wdXNoKGwpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gMi4gUmVjdXJzaXZlIGZ1bmN0aW9uIHRvIHJlbmRlciBhIHRyZWUgbm9kZVxyXG4gICAgZnVuY3Rpb24gcmVuZGVyTm9kZShub2RlLCBwYXJlbnRFbCwgZGVwdGgsIHBhcmVudE5vZGUsIHBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuXHJcbiAgICAgICAgaWYgKG5vZGUucGF0aCA9PT0gXCJcIikge1xyXG4gICAgICAgICAgICAvLyBSZW5kZXIgcm9vdCdzIGNoaWxkIGdyb3VwcyBhbmQgY2hpbGQgbGF5ZXJzIGRpcmVjdGx5IHdpdGhvdXQgaGVhZGVyXHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobm9kZS5jaGlsZHJlbltrZXldLCBwYXJlbnRFbCwgZGVwdGgsIG5vZGUsIHRydWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbm9kZS5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShseXIsIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBpc0dyb3VwID0gbm9kZS5pc0dyb3VwID09PSB0cnVlO1xyXG4gICAgICAgIGNvbnN0IHBhdGggPSBpc0dyb3VwID8gbm9kZS5wYXRoIDogbnVsbDtcclxuICAgICAgICBjb25zdCBuYW1lID0gbm9kZS5uYW1lO1xyXG4gICAgICAgIGNvbnN0IGlkID0gaXNHcm91cCA/IG51bGwgOiBub2RlLmlkO1xyXG5cclxuICAgICAgICAvLyBEZXRlcm1pbmUgc2VsZWN0aW9uIHR5cGUgKGNoZWNrYm94IHZzIHJhZGlvKSBiYXNlZCBvbiBwYXJlbnQncyBtdWx0aV9zZWxlY3QgY29uZmlnXHJcbiAgICAgICAgY29uc3QgcGFyZW50UGF0aCA9IHBhcmVudE5vZGUgPyBwYXJlbnROb2RlLnBhdGggOiBcIlwiO1xyXG4gICAgICAgIGNvbnN0IHBhcmVudENvbmYgPSBncm91cENvbmZpZ3NbcGFyZW50UGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc011bHRpU2VsZWN0ID0gcGFyZW50Q29uZi5tdWx0aV9zZWxlY3QgIT09IGZhbHNlO1xyXG5cclxuICAgICAgICBjb25zdCBub2RlRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBub2RlRGl2LnN0eWxlLm1hcmdpbkJvdHRvbSA9IFwiNHB4XCI7XHJcblxyXG4gICAgICAgIGxldCBzZWxmVmlzaWJsZSA9IHRydWU7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBwYXRoID09PSBcIkJhc2VtYXBzXCIgPyB0cnVlIDogKGdyb3VwQ29uZmlnc1twYXRoXT8udmlzaWJsZSAhPT0gZmFsc2UpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHNlbGZWaXNpYmxlID0gbm9kZS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3Qgc2VsZkVmZmVjdGl2ZVZpc2libGUgPSBwYXJlbnRFZmZlY3RpdmVWaXNpYmxlICYmIHNlbGZWaXNpYmxlO1xyXG5cclxuICAgICAgICBjb25zdCBoZWFkZXJEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5kaXNwbGF5ID0gXCJmbGV4XCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmFsaWduSXRlbXMgPSBcImNlbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5jdXJzb3IgPSBcInBvaW50ZXJcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUudXNlclNlbGVjdCA9IFwibm9uZVwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS53ZWJraXRVc2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFwYXJlbnRFZmZlY3RpdmVWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5zdHlsZS5vcGFjaXR5ID0gXCIwLjVcIjtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmNvbG9yID0gXCIjODg4XCI7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIGFycm93XHJcbiAgICAgICAgbGV0IHRvZ2dsZUVsID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICB0b2dnbGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLndpZHRoID0gXCIxNHB4XCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmZvbnRTaXplID0gXCIxNnB4XCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmxpbmVIZWlnaHQgPSBcIjFcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLnRleHRBbGlnbiA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnRleHRDb250ZW50ID0gaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFdlaWdodCA9IFwiYm9sZFwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQodG9nZ2xlRWwpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNwYWNlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLmRpc3BsYXkgPSBcImlubGluZS1ibG9ja1wiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoc3BhY2VyKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENoZWNrYm94IG9yIFJhZGlvIGlucHV0IGVsZW1lbnRcclxuICAgICAgICBsZXQgaW5wdXQgPSBudWxsO1xyXG4gICAgICAgIGlmICghaXNHcm91cCB8fCBwYXRoICE9PSBcIkJhc2VtYXBzXCIpIHtcclxuICAgICAgICAgICAgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW5wdXRcIik7XHJcbiAgICAgICAgICAgIGlucHV0LnR5cGUgPSBpc011bHRpU2VsZWN0ID8gXCJjaGVja2JveFwiIDogXCJyYWRpb1wiO1xyXG4gICAgICAgICAgICBpbnB1dC5uYW1lID0gaXNNdWx0aVNlbGVjdCA/IChpc0dyb3VwID8gYGdyb3VwXyR7cGF0aH1gIDogYGxheWVyXyR7aWR9YCkgOiBgcGFyZW50XyR7cGFyZW50UGF0aH1gO1xyXG4gICAgICAgICAgICBpbnB1dC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW3BhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0geyB2aXNpYmxlOiB0cnVlLCBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBncm91cENvbmZpZ3NbcGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gbm9kZS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGlucHV0KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIExhYmVsIFRleHRcclxuICAgICAgICBjb25zdCBsYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgIGxhYmVsLnRleHRDb250ZW50ID0gbmFtZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBsYWJlbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChsYWJlbCk7XHJcblxyXG4gICAgICAgIG5vZGVEaXYuYXBwZW5kQ2hpbGQoaGVhZGVyRGl2KTtcclxuXHJcbiAgICAgICAgLy8gQ2hpbGRyZW4gRHJhd2VyIChmb3IgZ3JvdXBzKVxyXG4gICAgICAgIGxldCBjaGlsZHJlbkRpdiA9IG51bGw7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGNvbGxhcHNlZFBhdGhzW3BhdGhdID09PSB0cnVlO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5kaXNwbGF5ID0gaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuYm9yZGVyTGVmdCA9IFwiMXB4IGRhc2hlZCAjY2NjXCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLm1hcmdpbkxlZnQgPSBcIjVweFwiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5wYWRkaW5nTGVmdCA9IFwiOHB4XCI7XHJcblxyXG4gICAgICAgICAgICAvLyBSZW5kZXIgc3ViLWdyb3VwcyBhbmQgbGF5ZXJzIHJlY3Vyc2l2ZWx5XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobm9kZS5jaGlsZHJlbltrZXldLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgY2hpbGRyZW5EaXYsIGRlcHRoICsgMSwgbm9kZSwgc2VsZkVmZmVjdGl2ZVZpc2libGUpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIG5vZGVEaXYuYXBwZW5kQ2hpbGQoY2hpbGRyZW5EaXYpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVG9nZ2xlIEV4cGFuZC9Db2xsYXBzZSB3aGVuIGNsaWNraW5nIGhlYWRlciByb3cgKGJhY2tncm91bmQsIGVtcHR5IHNwYWNlLCBvciBhcnJvdylcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1twYXRoXSA9ICFpc0NvbGxhcHNlZDtcclxuICAgICAgICAgICAgICAgIGlmICh0b2dnbGVFbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRvZ2dsZUVsLnRleHRDb250ZW50ID0gIWlzQ29sbGFwc2VkID8gXCJcdTI1QjhcIiA6IFwiXHUyNUJFXCI7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoY2hpbGRyZW5EaXYpIHtcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5kaXNwbGF5ID0gIWlzQ29sbGFwc2VkID8gXCJub25lXCIgOiBcImJsb2NrXCI7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgY2xpY2sgbGlzdGVuZXJcclxuICAgICAgICBpZiAoaW5wdXQpIHtcclxuICAgICAgICAgICAgbGFiZWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gIWlucHV0LmNoZWNrZWQ7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoXCJjaGFuZ2VcIikpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIElucHV0IGNoYW5nZSBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzQ2hlY2tlZCA9IGlucHV0LmNoZWNrZWQ7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEZvciByYWRpbyBidXR0b25zLCBvbmx5IHByb2Nlc3MgdGhlIHNlbGVjdGlvbiBldmVudCAoaWdub3JlIGRlLXNlbGVjdGlvbiBldmVudHMpXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QgJiYgIWlzQ2hlY2tlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBGbGlwcGVkIG9uIHRoZSBsaXN0IHRoaXMgc2lkZWJhciByZW5kZXJlZCBmcm9tLCBuZXZlciBtb2RlbC5nZXQoXCJsYXllcnNcIikuXHJcbiAgICAgICAgICAgICAgICAvLyBMYXllcnMgYWRkZWQgYWZ0ZXIgdGhlIHdpZGdldCBpcyBkaXNwbGF5ZWQgYXJyaXZlIGFzIHBhdGNoZXMgdGhhdCB1cGRhdGUgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyBmcm9udGVuZCdzIGxvY2FsIHN0YXRlIHdpdGhvdXQgdG91Y2hpbmcgdGhlIHRyYWl0LCBzbyB0aGUgbW9kZWwncyBjb3B5IGlzXHJcbiAgICAgICAgICAgICAgICAvLyBmcm96ZW4gYXQgd2hhdGV2ZXIgdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSBjYXJyaWVkLiBCdWlsZGluZyB0aGUgdXBkYXRlIGZyb21cclxuICAgICAgICAgICAgICAgIC8vIGl0IGRyb3BzIGV2ZXJ5IGxhdGVyIGxheWVyOiB0aGUgdG9nZ2xlIG1hdGNoZXMgbm8gaWQsIHdyaXRlcyB0aGUgc3RhbGUgbGlzdFxyXG4gICAgICAgICAgICAgICAgLy8gYmFjaywgYW5kIHRoZSBjaGFuZ2UgaGFuZGxlciB0aGVuIHJlc2V0cyBsb2NhbCBzdGF0ZSB0byBpdCAtLSBzbyB0aGUgYm94XHJcbiAgICAgICAgICAgICAgICAvLyByZS1jaGVja3MgaXRzZWxmIGFuZCB0aGUgbGF5ZXIgbmV2ZXIgaGlkZXMuXHJcbiAgICAgICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAgICAgLy8gVGhlIGZsaXBzIG11dGF0ZSB0aGUgcmVuZGVyZWQgbGlzdCBpbiBwbGFjZSBhbmQgcmVhY2ggUHl0aG9uIGFzIGEgdGFyZ2V0ZWRcclxuICAgICAgICAgICAgICAgIC8vIHdyaXRlIChzZW5kTGF5ZXJXcml0ZSksIG5ldmVyIGJ5IHNldHRpbmcgdGhlIGxheWVycyB0cmFpdDogdGhlIGZ1bGxcclxuICAgICAgICAgICAgICAgIC8vIHdyaXRlLWJhY2sgc2NhbGVkIHdpdGggdGhlIG1hcCBpbnN0ZWFkIG9mIHRoZSBjbGljay4gQXQgMjUgdHJhY2tzIHggMjAwa1xyXG4gICAgICAgICAgICAgICAgLy8gdmVydGljZXMgaXQgd2FzIGEgMzYgTUIgZnJhbWUgLS0gcGFzdCB1dmljb3JuJ3MgMTYgTUIgZGVmYXVsdCB3ZWJzb2NrZXRcclxuICAgICAgICAgICAgICAgIC8vIGNhcCwgc28gdGhlIHNlcnZlciBjbG9zZWQgdGhlIGNvbm5lY3Rpb24gYW5kIHRoZSBTaGlueSBzZXNzaW9uIGRpZWQgb25cclxuICAgICAgICAgICAgICAgIC8vIHRoZSBmaXJzdCBjaGVja2JveC4gU2V0dGluZyB0aGUgdHJhaXQgd2l0aG91dCBzYXZpbmcgaXMganVzdCBhcyBmYXRhbDpcclxuICAgICAgICAgICAgICAgIC8vIGl0IHN0YXlzIGRpcnR5IGFuZCB0aGUgbmV4dCBzYXZlX2NoYW5nZXMgKGFueSBwYW4pIGZsdXNoZXMgaXQuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBjaGFuZ2VzID0gW107XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmbGlwID0gKGx5ciwgdmlzaWJsZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICgobHlyLnZpc2libGUgIT09IGZhbHNlKSA9PT0gdmlzaWJsZSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gdmlzaWJsZTtcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VzLnB1c2goeyBpZDogbHlyLmlkLCB2aXNpYmxlIH0pO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSYWRpbyBidXR0b24gbG9naWM6IHNldCBhbGwgc2libGluZ3MgdG8gdmlzaWJsZT1mYWxzZSwgYW5kIHRoaXMgdG8gdmlzaWJsZT10cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMocGFyZW50Tm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJHcm91cCA9IHBhcmVudE5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gc2liR3JvdXAucGF0aCA9PT0gcGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogYWN0aXZlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3NpYkdyb3VwLnBhdGhdID0gIWFjdGl2ZTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBwYXJlbnROb2RlLmxheWVycy5mb3JFYWNoKHNpYkx5ciA9PiBmbGlwKHNpYkx5ciwgc2liTHlyLmlkID09PSBpZCkpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVja2JveCBsb2dpY1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1twYXRoXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1twYXRoXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU6IGlzQ2hlY2tlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1twYXRoXSA9ICFpc0NoZWNrZWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbHlyID0gbGF5ZXJzLmZpbmQobCA9PiBsLmlkID09PSBpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChseXIpIGZsaXAobHlyLCBpc0NoZWNrZWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoY3R4ICYmIGN0eC5vbkxheWVyV3JpdGUpIGN0eC5vbkxheWVyV3JpdGUoY2hhbmdlcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAoY3R4ICYmIGN0eC5vbkdyb3VwQ29uZmlnc0NoYW5nZSkgY3R4Lm9uR3JvdXBDb25maWdzQ2hhbmdlKGdyb3VwQ29uZmlncyk7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGlzQ2hlY2tlZCAmJiBtYXApIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBib3VuZHMgPSBnZXRMYXllckJvdW5kcyhub2RlLCAoY3R4ICYmIGN0eC5jb29yZGluYXRlQnVmZmVycykgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmZpdEJvdW5kcyhib3VuZHMpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAob25MYXllclRvZ2dsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG9uTGF5ZXJUb2dnbGUoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBwYXJlbnRFbC5hcHBlbmRDaGlsZChub2RlRGl2KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZW5kZXIgdHJlZSBmcm9tIHJvb3Qgbm9kZVxyXG4gICAgcmVuZGVyTm9kZSh0cmVlLCBzaWRlYmFyLCAwLCBudWxsLCB0cnVlKTtcclxufVxyXG4iLCAiLy8gTGF5ZXItc3RhdGUgZnVuY3Rpb25zOiB2aXNpYmlsaXR5LCBidWNrZXRpbmcsIGFuZCBwYXRjaCBhcHBsaWNhdGlvbi5cbi8vXG4vLyBQdXJlIGRhdGEgaW4sIGRhdGEgb3V0IC0tIG5vIG1hcCwgbm8gRE9NLCBubyBob3N0LiBUaGlzIGlzIHRoZSBwYXJ0IG9mIHRoZSBjb3JlXG4vLyB0aGF0IGV2ZXJ5IGNvbnN1bWVyIHNoYXJlcyB2ZXJiYXRpbTogdGhlIGFueXdpZGdldCB3aWRnZXQsIGEgc3RhdGljIGV4cG9ydCBhbmQgYVxuLy8gUmVhY3QgYXBwIGFsbCBhcHBseSB0aGUgc2FtZSBwYXRjaCBvcHMgdG8gdGhlIHNhbWUge2xheWVycywgYnVmZmVyc30gc3RhdGUuXG5cbi8vIFRydWUgaWYgYSBsYXllciBpcyB2aXNpYmxlIGFuZCBubyBmb2xkZXIgYWJvdmUgaXQgaXMgc3dpdGNoZWQgb2ZmLlxuLy9cbi8vIFZpc2liaWxpdHkgaXMgaW5oZXJpdGVkIGRvd24gdGhlIGZvbGRlciBwYXRoOiBhIGxheWVyIGluc2lkZSBcIkZlZWRzL0FjdGl2ZVwiIGlzIGhpZGRlblxuLy8gd2hlbiBlaXRoZXIgXCJGZWVkc1wiIG9yIFwiRmVlZHMvQWN0aXZlXCIgaXMgb2ZmLCByZWdhcmRsZXNzIG9mIGl0cyBvd24gZmxhZy4gR2V0dGluZyB0aGlzXG4vLyB3cm9uZyBzaG93cyB1cCBhcyBcInRoYXQgbGF5ZXIganVzdCB3aWxsIG5vdCBhcHBlYXJcIiwgd2l0aCBub3RoaW5nIGxvZ2dlZC5cbmV4cG9ydCBmdW5jdGlvbiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLnNwbGl0KFwiL1wiKSkge1xuICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZ3JvdXBDb25maWdzW3J1bm5pbmdQYXRoXTtcbiAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFNvcnRzIHRoZSB2aXNpYmxlIGxheWVycyBpbnRvIG9uZSBidWNrZXQgcGVyIFdlYkdMIGRyYXcgcGFzcy5cbi8vXG4vLyBTdWItbGF5ZXJzIG9mIGEgbWVyZ2VkIGdyb3VwIGluaGVyaXQgdGhlaXIgcGFyZW50J3MgdmlzaWJpbGl0eSByYXRoZXIgdGhhbiBjYXJyeWluZ1xuLy8gdGhlaXIgb3duLCBzbyBhIGdyb3VwIHRvZ2dsZWQgb2ZmIGNvbnRyaWJ1dGVzIG5vdGhpbmcgZXZlbiB3aGVuIGl0cyBjaGlsZHJlbiBzYXlcbi8vIHZpc2libGUuIENpcmNsZXMgam9pbiB0aGUgcG9seWdvbiBidWNrZXQ6IHRoZXkgYXJlIGRyYXduIGFzIGdlbmVyYXRlZCByaW5ncy5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcbiAgICBjb25zdCBidWNrZXRzID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG5cbiAgICBmdW5jdGlvbiBjb2xsZWN0KGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1YkxheWVyKSB7XG4gICAgICAgIGlmICghcGFyZW50VmlzaWJsZSkgcmV0dXJuO1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IGNvbGxlY3Qoc3ViLCBwYXJlbnRWaXNpYmxlLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFpc1N1YkxheWVyICYmIGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKGJ1Y2tldHNbYnVja2V0XSkgYnVja2V0c1tidWNrZXRdLnB1c2gobGF5ZXIpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgIGNvbGxlY3QobGF5ZXIsIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpLCBmYWxzZSk7XG4gICAgfVxuICAgIHJldHVybiBidWNrZXRzO1xufVxuXG4vLyBBcHBsaWVzIGluY3JlbWVudGFsIHBhdGNoIG9wcyB0byB7bGF5ZXJzLCBidWZmZXJzfSwgcmV0dXJuaW5nIHRoZSBuZXcgc3RhdGUuXG4vL1xuLy8gT3BzIGFyZSBhZGRyZXNzZWQgYnkgbGF5ZXIgaWQgYW5kIGFwcGxpZWQgaWRlbXBvdGVudGx5OiBcImFkZFwiIHVwc2VydHMgcmF0aGVyIHRoYW5cbi8vIGFwcGVuZGluZyBibGluZGx5LCBzbyBhIHBhdGNoIHRoYXQgcmFjZXMgdGhlIGluaXRpYWwgdHJhaXQgc25hcHNob3QgY2Fubm90IGR1cGxpY2F0ZVxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxuLy8gQXBwbGllcyBgdXBkYXRlYCB0byBvbmUgbGF5ZXIgd2hlcmV2ZXIgaXQgc2l0cywgZGVzY2VuZGluZyBpbnRvIGdyb3Vwcy4gYWRkX2NvbGxlY3Rpb25cbi8vIG5lc3RzIGl0cyBwb2ludCwgbGluZSBhbmQgcG9seWdvbiBsYXllcnMgaW5zaWRlIGEgZ3JvdXAgbGF5ZXIsIHNvIGFuIG9wIGFkZHJlc3NlZCBhdCBhXG4vLyBuZXN0ZWQgaWQgd291bGQgb3RoZXJ3aXNlIG1hdGNoIG5vdGhpbmcgYW5kIHNpbGVudGx5IGRvIG5vdGhpbmcuIFJldHVybnMgdGhlIG9yaWdpbmFsXG4vLyBhcnJheSB1bnRvdWNoZWQgd2hlbiB0aGUgaWQgaXMgbm90IGZvdW5kLCBzbyBhbiB1bm1hdGNoZWQgb3AgY29zdHMgbm8gcmUtcmVuZGVyLlxuZnVuY3Rpb24gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgaWQsIHVwZGF0ZSkge1xuICAgIGxldCBoaXQgPSBmYWxzZTtcbiAgICBjb25zdCBuZXh0ID0gbGF5ZXJzLm1hcChsID0+IHtcbiAgICAgICAgaWYgKGwuaWQgPT09IGlkKSB7XG4gICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIHVwZGF0ZShsKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgQXJyYXkuaXNBcnJheShsLmxheWVycykpIHtcbiAgICAgICAgICAgIGNvbnN0IHN1YnMgPSB1cGRhdGVMYXllckJ5SWQobC5sYXllcnMsIGlkLCB1cGRhdGUpO1xuICAgICAgICAgICAgaWYgKHN1YnMgIT09IGwubGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5sLCBsYXllcnM6IHN1YnMgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbDtcbiAgICB9KTtcbiAgICByZXR1cm4gaGl0ID8gbmV4dCA6IGxheWVycztcbn1cblxuLy8gRXZlcnkgcG9pbnQgbGF5ZXIsIHZpc2libGUgb3Igbm90LCB3aXRoIGl0cyBlZmZlY3RpdmUgdmlzaWJpbGl0eSByZWNvcmRlZCAtLSB0aGVcbi8vIEdQVS12aXNpYmlsaXR5IHBhdGgga2VlcHMgaGlkZGVuIGxheWVycyBpbiB0aGUgYnVja2V0IChzdGFibGUgaWRzLCBubyByZWJ1aWxkIG9uIGFcbi8vIHRvZ2dsZSkgYW5kIGhpZGVzIHRoZW0gd2l0aCBhIHVuaWZvcm0gaW5zdGVhZC4gTWlycm9ycyBjb2xsZWN0V2ViZ2xMYXllcnMnIHJ1bGVzOlxuLy8gc3ViLWxheWVycyBpbmhlcml0IHRoZWlyIHBhcmVudCdzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5LCB0b3AtbGV2ZWwgbGF5ZXJzIGFuc3dlciBmb3Jcbi8vIHRoZWlyIG93biBmbGFnIGFuZCB0aGVpciBmb2xkZXIgY2hhaW4uXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3Qgb3V0ID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG4gICAgZnVuY3Rpb24gd2FsayhsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWIpIHtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlbGZWaXMgPSBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IHdhbGsoc3ViLCBzZWxmVmlzLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKCFvdXRbYnVja2V0XSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2aXMgPSBpc1N1YiA/IHBhcmVudFZpc2libGVcbiAgICAgICAgICAgIDogcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgb3V0W2J1Y2tldF0ucHVzaCh7IGxheWVyLCB2aXMgfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB3YWxrKGxheWVyLCB0cnVlLCBmYWxzZSk7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gQnVmZmVyIGlkZW50aXR5IGZvciB0aGUgR0wgbWV0YSBrZXkuIEEgbmV3IERhdGFWaWV3IHVuZGVyIGEgbGF5ZXIgaWQgLS0gYVxuLy8gYnVmZmVyIG9wIGZyb20gdXBkYXRlX2xheWVyKGRhdGE9Li4uKSwgb3IgdGhlIHRyYWl0IHJlc2VlZGVkIC0tIG11c3QgcmVidWlsZFxuLy8gdGhlIGJ1Y2tldCBldmVuIHdoZW4gdGhlIGJ5dGUgbGVuZ3RoIGlzIHVuY2hhbmdlZCAocG9pbnRzIG1vdmVkLCBjb2xvdXJzXG4vLyByZWNvbXB1dGVkKS4gVGhlIHNlcmlhbCBpcyBwZXIgb2JqZWN0LCBzbyBhbiB1bnRvdWNoZWQgYnVmZmVyIGtlZXBzIGl0cyBudW1iZXJcbi8vIGFuZCBjb3N0cyBubyByZWJ1aWxkLiBXb3JrcyBmb3IgYW55IGNvbnN1bWVyIHRoYXQgc3dhcHMgYSBidWZmZXIsIFB5dGhvbiBvciBub3QuXG5jb25zdCBidWZmZXJTZXJpYWxzID0gbmV3IFdlYWtNYXAoKTtcbmxldCBuZXh0QnVmZmVyU2VyaWFsID0gMTtcbmV4cG9ydCBmdW5jdGlvbiBidWZmZXJTZXJpYWwoYnVmKSB7XG4gICAgaWYgKCFidWYgfHwgdHlwZW9mIGJ1ZiAhPT0gXCJvYmplY3RcIikgcmV0dXJuIDA7XG4gICAgbGV0IHNlcmlhbCA9IGJ1ZmZlclNlcmlhbHMuZ2V0KGJ1Zik7XG4gICAgaWYgKCFzZXJpYWwpIHtcbiAgICAgICAgc2VyaWFsID0gbmV4dEJ1ZmZlclNlcmlhbCsrO1xuICAgICAgICBidWZmZXJTZXJpYWxzLnNldChidWYsIHNlcmlhbCk7XG4gICAgfVxuICAgIHJldHVybiBzZXJpYWw7XG59XG5cbmZ1bmN0aW9uIGNvbmNhdFZpZXdzKGhlYWQsIHRhaWwpIHtcbiAgICBjb25zdCBvdXQgPSBuZXcgVWludDhBcnJheShoZWFkLmJ5dGVMZW5ndGggKyB0YWlsLmJ5dGVMZW5ndGgpO1xuICAgIG91dC5zZXQobmV3IFVpbnQ4QXJyYXkoaGVhZC5idWZmZXIsIGhlYWQuYnl0ZU9mZnNldCwgaGVhZC5ieXRlTGVuZ3RoKSwgMCk7XG4gICAgb3V0LnNldChuZXcgVWludDhBcnJheSh0YWlsLmJ1ZmZlciwgdGFpbC5ieXRlT2Zmc2V0LCB0YWlsLmJ5dGVMZW5ndGgpLCBoZWFkLmJ5dGVMZW5ndGgpO1xuICAgIHJldHVybiBuZXcgRGF0YVZpZXcob3V0LmJ1ZmZlcik7XG59XG5cbmZ1bmN0aW9uIGFwcGVuZFJvd3MobGF5ZXIsIG9wKSB7XG4gICAgY29uc3QgYmFzZSA9IG9wLmJhc2UgfHwgMDtcbiAgICBjb25zdCBjb3VudCA9IG9wLmNvdW50IHx8IDA7XG4gICAgY29uc3QgaW5jb21pbmcgPSBvcC5wcm9wZXJ0aWVzIHx8IHt9O1xuICAgIGNvbnN0IHByb3BzID0geyAuLi4obGF5ZXIucHJvcGVydGllcyB8fCB7fSkgfTtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBuZXcgU2V0KFsuLi5PYmplY3Qua2V5cyhwcm9wcyksIC4uLk9iamVjdC5rZXlzKGluY29taW5nKV0pKSB7XG4gICAgICAgIGNvbnN0IGhlYWQgPSBBcnJheS5pc0FycmF5KHByb3BzW2tleV0pID8gcHJvcHNba2V5XVxuICAgICAgICAgICAgOiBuZXcgQXJyYXkoYmFzZSkuZmlsbChwcm9wc1trZXldID09PSB1bmRlZmluZWQgPyBudWxsIDogcHJvcHNba2V5XSk7XG4gICAgICAgIGNvbnN0IHRhaWwgPSBBcnJheS5pc0FycmF5KGluY29taW5nW2tleV0pID8gaW5jb21pbmdba2V5XSA6IG5ldyBBcnJheShjb3VudCkuZmlsbChudWxsKTtcbiAgICAgICAgcHJvcHNba2V5XSA9IGhlYWQuY29uY2F0KHRhaWwpO1xuICAgIH1cbiAgICBjb25zdCBuZXh0ID0geyAuLi5sYXllciwgcHJvcGVydGllczogcHJvcHMgfTtcbiAgICBmb3IgKGNvbnN0IFtmaWVsZCwgdGFpbF0gb2YgT2JqZWN0LmVudHJpZXMob3AubGlzdHMgfHwge30pKSB7XG4gICAgICAgIG5leHRbZmllbGRdID0gKEFycmF5LmlzQXJyYXkobGF5ZXJbZmllbGRdKSA/IGxheWVyW2ZpZWxkXSA6IFtdKS5jb25jYXQodGFpbCk7XG4gICAgfVxuICAgIHJldHVybiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTd2lmdG1hcFBhdGNoKHN0YXRlLCBvcHMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbGF5ZXJzID0gc3RhdGUubGF5ZXJzIHx8IFtdO1xuICAgIGxldCBidWZmZXJNYXAgPSBzdGF0ZS5idWZmZXJzIHx8IHt9O1xuXG4gICAgZm9yIChjb25zdCBvcCBvZiBvcHMpIHtcbiAgICAgICAgaWYgKG9wLm9wID09PSBcInNuYXBzaG90XCIpIHtcbiAgICAgICAgICAgIGxheWVycyA9IG9wLmxheWVycyB8fCBbXTtcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHt9O1xuICAgICAgICAgICAgKG9wLmJ1ZmZlcl9pZHMgfHwgW10pLmZvckVhY2goKGlkLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcnMgJiYgYnVmZmVyc1tpXSkgYnVmZmVyTWFwW2lkXSA9IGJ1ZmZlcnNbaV07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJhZGRcIiB8fCBvcC5vcCA9PT0gXCJyZXBsYWNlXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGluY29taW5nID0gb3AubGF5ZXI7XG4gICAgICAgICAgICBjb25zdCBpZCA9IGluY29taW5nID8gaW5jb21pbmcuaWQgOiBvcC5pZDtcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IGxheWVycy5maW5kSW5kZXgobCA9PiBsLmlkID09PSBpZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IFsuLi5sYXllcnMsIGluY29taW5nXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLm1hcCgobCwgaSkgPT4gKGkgPT09IGlkeCA/IGluY29taW5nIDogbCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInNldFwiKSB7XG4gICAgICAgICAgICAvLyBGaWVsZC1sZXZlbCB1cGRhdGUuIFwicmVwbGFjZVwiIGNhcnJpZXMgdGhlIHdob2xlIGxheWVyLCBzbyBmbGlwcGluZyBgdmlzaWJsZWBcbiAgICAgICAgICAgIC8vIG9uIGEgNTBrLXBvaW50IGxheWVyIHJlc2VudCBldmVyeSBwcm9wZXJ0eSBpdCBob2xkcyAtLSBoYWxmIGEgbWVnYWJ5dGUgdG9cbiAgICAgICAgICAgIC8vIGNoYW5nZSBvbmUgYm9vbGVhbiwgb24gZXZlcnkgY2xpY2sgb2YgYSBjaGVja2JveC5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7IC4uLmwsIC4uLihvcC5maWVsZHMgfHwge30pIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzdHlsZVwiKSB7XG4gICAgICAgICAgICAvLyBQZXItZmVhdHVyZSBzdHlsZSBvdmVycmlkZXMsIHJlcGxhY2VkIHdob2xlc2FsZSByYXRoZXIgdGhhbiBtZXJnZWQ6IGFcbiAgICAgICAgICAgIC8vIHNlbGVjdGlvbiBkZXNjcmliZXMgaXRzIGNvbXBsZXRlIHN0YXRlLCBzbyBzZW5kaW5nIHt9IGNsZWFycyBpdCBhbmQgbm9cbiAgICAgICAgICAgIC8vIGNhbGxlciBoYXMgdG8gdHJhY2sgd2hhdCB0aGUgcHJldmlvdXMgaGlnaGxpZ2h0IHRvdWNoZWQuXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmwsIHN0eWxlX292ZXJyaWRlczogb3Aub3ZlcnJpZGVzIHx8IHt9LFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInJlbW92ZVwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBsYXllcnMuZmlsdGVyKGwgPT4gbC5pZCAhPT0gb3AuaWQpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlclwiKSB7XG4gICAgICAgICAgICBjb25zdCBidWYgPSBidWZmZXJzICYmIGJ1ZmZlcnNbb3AuYnVmZmVyX2luZGV4XTtcbiAgICAgICAgICAgIGlmIChidWYpIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwLCBbb3AuaWRdOiBidWYgfTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJfYXBwZW5kXCIpIHtcbiAgICAgICAgICAgIC8vIEEgdGFpbCBmb3IgYW4gZXhpc3RpbmcgYnVmZmVyIC0tIHRoZSBmZWVkIHByaW1pdGl2ZSdzIHdpcmUgc2hhcGUsXG4gICAgICAgICAgICAvLyBwcm9wb3J0aW9uYWwgdG8gdGhlIGJhdGNoLiBDb25jYXRlbmF0aW9uIHlpZWxkcyBhIE5FVyBEYXRhVmlldywgYW5kXG4gICAgICAgICAgICAvLyB0aGUgR0wgbWV0YSBrZXkga2V5cyBvbiBidWZmZXIgaWRlbnRpdHksIHNvIHRoZSBidWNrZXQgcmVidWlsZHMuXG4gICAgICAgICAgICBjb25zdCB0YWlsID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XG4gICAgICAgICAgICBpZiAodGFpbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGhlYWQgPSBidWZmZXJNYXBbb3AuaWRdO1xuICAgICAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwLCBbb3AuaWRdOiBoZWFkID8gY29uY2F0Vmlld3MoaGVhZCwgdGFpbCkgOiB0YWlsIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYXBwZW5kXCIpIHtcbiAgICAgICAgICAgIC8vIE5ldyByb3dzIGZvciB0aGUgcHJvcGVydHkgbGlzdHMgKGFuZCBvdGhlciBwZXItZmVhdHVyZSBsaXN0cyksIGFmdGVyXG4gICAgICAgICAgICAvLyB0aGUgZXhpc3Rpbmcgb25lcy4gQ29sdW1ucyBtaXNzaW5nIG9uIGVpdGhlciBzaWRlIGZpbGwgbnVsbCwgZXhhY3RseVxuICAgICAgICAgICAgLy8gYXMgdGhlIFB5dGhvbiBzaWRlIGRvZXMsIHNvIGEgbGF0ZXIgcG9wdXAgcmVhZHMgdGhlIHNhbWUgdGFibGUuXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiBhcHBlbmRSb3dzKGwsIG9wKSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX3JlbW92ZVwiKSB7XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xuICAgICAgICAgICAgZGVsZXRlIGJ1ZmZlck1hcFtvcC5pZF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBsYXllcnMsIGJ1ZmZlcnM6IGJ1ZmZlck1hcCB9O1xufVxuIiwgIi8vIFRoZSBsZWdlbmQ6IGRlcml2ZWQgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSBldmVyeXRoaW5nIGVsc2UgcmVuZGVycyBmcm9tLCB3aXRoXHJcbi8vIGRlY2xhcmF0aXZlIG92ZXJyaWRlcyBvbiB0b3AuIERlbGliZXJhdGVseSBtb2RlbC1mcmVlIC0tIHB1cmUgZGF0YSBpbiwgRE9NIG91dCAtLVxyXG4vLyBzbyBhIHBsYWluLUpTIGNvbnN1bWVyIG9mIGRpc3QvaW5kZXguanMgZ2V0cyB0aGUgd2hvbGUgZmVhdHVyZSwgYW5kIHRoZSBhbnl3aWRnZXRcclxuLy8gZ2x1ZSBpbiBtYXAuanMgaXMgYSBmZXcgbGluZXMuIChzaWRlYmFyLmpzIHN0aWxsIHRha2VzIGBtb2RlbGAgYW5kIGlzIGZpbGVkIGZvclxyXG4vLyBleHRyYWN0aW9uOyB0aGlzIG1vZHVsZSBtdXN0IG5ldmVyIG5lZWQgdGhhdCB1bnBpY2tpbmcuKVxyXG4vL1xyXG4vLyBUaGUgcGlwZWxpbmU6IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykgd2Fsa3MgdGhlIGxheWVycyBpbnRvXHJcbi8vIGVudHJpZXMgKHNraXBwZWQgZW50aXJlbHkgd2hlbiBjb25maWcuYXV0byA9PT0gZmFsc2UpLCBhcHBsaWVzIHRoZSBwZXJzaXN0ZW50XHJcbi8vIHJlbW92ZS1tYXRjaGVycywgYXBwZW5kcyB0aGUgbWFudWFsIGFkZHMsIGFuZCByZXR1cm5zIGEgc3BlYyB0aGF0IHJlbmRlckxlZ2VuZFxyXG4vLyB0dXJucyBpbnRvIERPTS4gTm90aGluZyBoZXJlIGtub3dzIGFib3V0IGNvbG9ybWFwczogcmFtcC9jYXRlZ29yeS9iaW4gZW50cmllc1xyXG4vLyBhcnJpdmUgd2l0aCB0aGVpciBjb2xvdXJzIGFscmVhZHkgcmVzb2x2ZWQgKFB5dGhvbiByZXNvbHZlcyBhdCB0aGUgYWRkXyogYm91bmRhcnksXHJcbi8vIG1hbnVhbCBlbnRyaWVzIGF0IGxlZ2VuZF9hZGQpLCBzbyB0aGVyZSBpcyBubyBhbmNob3IgdGFibGUgdG8gZHJpZnQuXHJcblxyXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSB9IGZyb20gXCIuL3BhdGNoLmpzXCI7XHJcblxyXG5jb25zdCBHTFlQSFMgPSB7XHJcbiAgICBjaXJjbGVfbWFya2VyczogXCJjaXJjbGVcIixcclxuICAgIG1hcmtlcnM6IFwicGluXCIsXHJcbiAgICBwb2x5bGluZTogXCJsaW5lXCIsXHJcbiAgICBwb2x5Z29uOiBcInBvbHlnb25cIixcclxuICAgIGNpcmNsZTogXCJjaXJjbGVcIixcclxufTtcclxuXHJcbmZ1bmN0aW9uIHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAga2luZDogXCJzd2F0Y2hcIixcclxuICAgICAgICBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsXHJcbiAgICAgICAgc2hhcGU6IEdMWVBIU1tsYXllci50eXBlXSB8fCBcInNxdWFyZVwiLFxyXG4gICAgICAgIGNvbG9yOiBsYXllci5jb2xvciB8fCBcIiMzMzg4ZmZcIixcclxuICAgICAgICBmaWxsQ29sb3I6IGxheWVyLmZpbGxDb2xvciB8fCBsYXllci5maWxsX2NvbG9yIHx8IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxyXG4gICAgICAgIGhpZGRlbixcclxuICAgIH07XHJcbn1cclxuXHJcbi8vIEEgZGF0YS1kcml2ZW4gYmxvY2sgcmVjb3JkZWQgYXQgYWRkIHRpbWUgKHtraW5kLCBhbmNob3JzfGl0ZW1zfGVkZ2VzK2NvbG9ycywgLi4ufSlcclxuLy8gYmVjb21lcyB0aGUgbGF5ZXIncyBlbnRyeSBhcy1pczsgdGhlIGxheWVyIG9ubHkgY29udHJpYnV0ZXMgbGFiZWwgYW5kIHZpc2liaWxpdHkuXHJcbmZ1bmN0aW9uIGJsb2NrRW50cnkobGF5ZXIsIGhpZGRlbikge1xyXG4gICAgcmV0dXJuIHsgLi4ubGF5ZXIubGVnZW5kLCBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsIGhpZGRlbiB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncykge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSByZXR1cm4gW107XHJcbiAgICBjb25zdCBoaWRkZW4gPSAhaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XHJcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgLy8gQSBjb2xsZWN0aW9uOiBvbmUgZW50cnkgcGVyIGdlb21ldHJ5IHBhcnQsIHNhbWUgbGFiZWwgYnkgZGVzaWduIC0tIHRoZVxyXG4gICAgICAgIC8vIGdseXBocyBhcmUgd2hhdCB0ZWxsIHRoZW0gYXBhcnQsIG1hdGNoaW5nIGhvdyB0aGUgcGFydHMgcmVuZGVyLlxyXG4gICAgICAgIHJldHVybiAobGF5ZXIubGF5ZXJzIHx8IFtdKVxyXG4gICAgICAgICAgICAuZmlsdGVyKHN1YiA9PiBHTFlQSFNbc3ViLnR5cGVdKVxyXG4gICAgICAgICAgICAubWFwKHN1YiA9PiBzdWIubGVnZW5kXHJcbiAgICAgICAgICAgICAgICA/IGJsb2NrRW50cnkoeyAuLi5zdWIsIG5hbWU6IGxheWVyLm5hbWUgfSwgaGlkZGVuKVxyXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pKTtcclxuICAgIH1cclxuICAgIGlmICghR0xZUEhTW2xheWVyLnR5cGVdKSByZXR1cm4gW107XHJcbiAgICBjb25zdCBlbnRyaWVzID0gW2xheWVyLmxlZ2VuZCA/IGJsb2NrRW50cnkobGF5ZXIsIGhpZGRlbikgOiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKV07XHJcbiAgICAvLyByYWRpdXNfY29sIHJlY29yZHMgYSBzaXplIGtleSBiZXNpZGUgdGhlIGNvbG91ciBzdG9yeTogYm90aCBlbmNvZGluZ3Mgb24gdGhlXHJcbiAgICAvLyBtYXAgZGVzZXJ2ZSBib3RoIGV4cGxhbmF0aW9ucyBpbiB0aGUgbGVnZW5kLlxyXG4gICAgaWYgKGxheWVyLmxlZ2VuZF9zaXplKSB7XHJcbiAgICAgICAgZW50cmllcy5wdXNoKHsgLi4ubGF5ZXIubGVnZW5kX3NpemUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6IGxheWVyLmxlZ2VuZF9zaXplLmZpZWxkIHx8IGxheWVyLm5hbWUgfHwgXCJTaXplXCIsIGhpZGRlbiB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiBlbnRyaWVzO1xyXG59XHJcblxyXG4vLyBJZGVudGljYWwgZGF0YS1kcml2ZW4gcGF5bG9hZHMgY29sbGFwc2UgaW50byBvbmUgcm93LiBHcm91cGluZyBwb2ludHMgYnkgYSBjb2x1bW5cclxuLy8gZ2l2ZXMgZXZlcnkgc3ViLWxheWVyIHRoZSBzYW1lIHJhbXA7IGEgcmFtcCBwZXIgc3ViLWxheWVyIGlzIG5vaXNlLCBhbmQgdGhlIGZpZWxkXHJcbi8vIG5hbWUgaXMgdGhlIGhvbmVzdCBsYWJlbCBmb3IgdGhlIHNoYXJlZCBtYXBwaW5nLiBUaGUgc3Vydml2b3Iga2VlcHMgdGhlIGZpcnN0XHJcbi8vIG9jY3VycmVuY2UncyBwb3NpdGlvbiBhbmQgaGlkZXMgb25seSB3aGVuIGV2ZXJ5IGNvbnRyaWJ1dG9yIGlzIGhpZGRlbi5cclxuZnVuY3Rpb24gcGF5bG9hZEtleShlbnRyeSkge1xyXG4gICAgLy8gSWRlbnRpdHkgZmllbGRzIHN0YXkgb3V0IG9mIHRoZSBrZXk6IHRoZSB3aG9sZSBwb2ludCBpcyB0aGF0IGVudHJpZXMgZnJvbVxyXG4gICAgLy8gRElGRkVSRU5UIGxheWVycyBjb2xsYXBzZSB3aGVuIHRoZWlyIG1hcHBpbmcgcGF5bG9hZCBpcyB0aGUgc2FtZS5cclxuICAgIGNvbnN0IHsgbGFiZWwsIGhpZGRlbiwgbGF5ZXJJZCwgbGF5ZXIsIGdyb3VwLCAuLi5wYXlsb2FkIH0gPSBlbnRyeTtcclxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKSB7XHJcbiAgICBjb25zdCBzZWVuID0gbmV3IE1hcCgpOyAgIC8vIHBheWxvYWQga2V5IC0+IHN1cnZpdmluZyBlbnRyeVxyXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcclxuICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoZW50cnkgPT4ge1xyXG4gICAgICAgICAgICBpZiAoZW50cnkua2luZCA9PT0gXCJzd2F0Y2hcIikgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGtleSA9IHBheWxvYWRLZXkoZW50cnkpO1xyXG4gICAgICAgICAgICBjb25zdCBzdXJ2aXZvciA9IHNlZW4uZ2V0KGtleSk7XHJcbiAgICAgICAgICAgIGlmICghc3Vydml2b3IpIHtcclxuICAgICAgICAgICAgICAgIHNlZW4uc2V0KGtleSwgZW50cnkpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGVudHJ5LmZpZWxkKSBlbnRyeS5sYWJlbCA9IGVudHJ5LmZpZWxkO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgc3Vydml2b3IuaGlkZGVuID0gc3Vydml2b3IuaGlkZGVuICYmIGVudHJ5LmhpZGRlbjtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGdyb3VwcztcclxufVxyXG5cclxuZnVuY3Rpb24gbWF0Y2hlckhpdHMobWF0Y2hlciwgZW50cnksIGdyb3VwTmFtZSkge1xyXG4gICAgaWYgKCFtYXRjaGVyKSByZXR1cm4gZmFsc2U7XHJcbiAgICBsZXQgY29uc3RyYWluZWQgPSBmYWxzZTtcclxuICAgIGlmIChtYXRjaGVyLmxhYmVsICE9IG51bGwpIHtcclxuICAgICAgICBjb25zdHJhaW5lZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKGVudHJ5LmxhYmVsICE9PSBtYXRjaGVyLmxhYmVsKSByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBpZiAobWF0Y2hlci5ncm91cCAhPSBudWxsKSB7XHJcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xyXG4gICAgICAgIGlmIChncm91cE5hbWUgIT09IG1hdGNoZXIuZ3JvdXApIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIGlmIChtYXRjaGVyLmlkICE9IG51bGwpIHtcclxuICAgICAgICBjb25zdHJhaW5lZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKGVudHJ5LmxheWVySWQgIT09IG1hdGNoZXIuaWQpIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiBjb25zdHJhaW5lZDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykge1xyXG4gICAgY29uc3QgY2ZnID0gY29uZmlnIHx8IHt9O1xyXG4gICAgY29uc3QgZ3JvdXBzID0gW107XHJcbiAgICBjb25zdCBieU5hbWUgPSBuZXcgTWFwKCk7XHJcbiAgICBjb25zdCBncm91cEZvciA9IG5hbWUgPT4ge1xyXG4gICAgICAgIGlmICghYnlOYW1lLmhhcyhuYW1lKSkge1xyXG4gICAgICAgICAgICBjb25zdCBncm91cCA9IHsgbmFtZSwgZW50cmllczogW10gfTtcclxuICAgICAgICAgICAgYnlOYW1lLnNldChuYW1lLCBncm91cCk7XHJcbiAgICAgICAgICAgIGdyb3Vwcy5wdXNoKGdyb3VwKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGJ5TmFtZS5nZXQobmFtZSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGlmIChjZmcuYXV0byAhPT0gZmFsc2UpIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzIHx8IHt9KSkge1xyXG4gICAgICAgICAgICAgICAgZW50cnkubGF5ZXJJZCA9IGxheWVyLmlkO1xyXG4gICAgICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGdyb3VwRm9yKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBQZXJzaXN0ZW50IHN1cHByZXNzaW9uOiBtYXRjaGVycyBvdXRsaXZlIGV2ZXJ5IHJlLWRlcml2YXRpb24sIHdoaWNoIGlzIHRoZVxyXG4gICAgLy8gZGlmZmVyZW5jZSBmcm9tIGEgcmVnaXN0cnkgcmVtb3ZlIHRoYXQgdGhlIG5leHQgYWRkIHdvdWxkIGp1c3QgcmVwb3B1bGF0ZS5cclxuICAgIGNvbnN0IHJlbW92ZXMgPSBjZmcucmVtb3ZlIHx8IFtdO1xyXG4gICAgaWYgKHJlbW92ZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XHJcbiAgICAgICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihcclxuICAgICAgICAgICAgICAgIGVudHJ5ID0+ICFyZW1vdmVzLnNvbWUobSA9PiBtYXRjaGVySGl0cyhtLCBlbnRyeSwgZ3JvdXAubmFtZSkpKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTWFudWFsIGVudHJpZXM6IHRoZSB1c2VyJ3Mgb3duIGNsYWltcy4gc2NvcGUgbmV2ZXIgZHJvcHMgdGhlbTsgYSBgbGF5ZXJgXHJcbiAgICAvLyBiaW5kaW5nIG1ha2VzIG9uZSBmb2xsb3cgYSBsaXZlIGxheWVyJ3MgdmlzaWJpbGl0eSAoYW5kIHZhbmlzaCB3aXRoIGl0IHVuZGVyXHJcbiAgICAvLyBzY29wZSBcInZpc2libGVcIiksIGZvciB3aGVuIGEgbWFudWFsIHJvdyBpcyByZWFsbHkgYSByZWxhYmVsbGluZy5cclxuICAgIGZvciAoY29uc3QgYWRkZWQgb2YgY2ZnLmFkZCB8fCBbXSkge1xyXG4gICAgICAgIGNvbnN0IGVudHJ5ID0geyBoaWRkZW46IGZhbHNlLCAuLi5hZGRlZCB9O1xyXG4gICAgICAgIGlmIChlbnRyeS5sYXllciAhPSBudWxsKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGJvdW5kID0gKGxheWVycyB8fCBbXSkuZmluZChcclxuICAgICAgICAgICAgICAgIGwgPT4gbC5pZCA9PT0gZW50cnkubGF5ZXIgfHwgbC5uYW1lID09PSBlbnRyeS5sYXllcik7XHJcbiAgICAgICAgICAgIGVudHJ5LmhpZGRlbiA9ICFib3VuZCB8fCAhaXNMYXllckVmZmVjdGl2ZVZpc2libGUoYm91bmQsIGdyb3VwQ29uZmlncyB8fCB7fSk7XHJcbiAgICAgICAgICAgIGlmIChjZmcuc2NvcGUgPT09IFwidmlzaWJsZVwiICYmIGVudHJ5LmhpZGRlbikgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChyZW1vdmVzLnNvbWUobSA9PiBtYXRjaGVySGl0cyhtLCBlbnRyeSwgZW50cnkuZ3JvdXAgfHwgXCJcIikpKSBjb250aW51ZTtcclxuICAgICAgICBncm91cEZvcihlbnRyeS5ncm91cCB8fCBcIlwiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBvcHVsYXRlZCA9IGdyb3Vwcy5maWx0ZXIoZyA9PiBnLmVudHJpZXMubGVuZ3RoID4gMCk7XHJcbiAgICByZXR1cm4geyB0aXRsZTogY2ZnLnRpdGxlIHx8IFwiTGVnZW5kXCIsIGdyb3VwczogcG9wdWxhdGVkIH07XHJcbn1cclxuXHJcbi8vIC0tLSByZW5kZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIERPTSBidWlsdCB3aXRoIGNyZWF0ZUVsZW1lbnQvdGV4dENvbnRlbnQgdGhyb3VnaG91dDogbGFiZWxzIGFuZCBjYXRlZ29yeSB2YWx1ZXMgY29tZVxyXG4vLyBmcm9tIHVzZXIgZGF0YSBhbmQgbXVzdCBuZXZlciBiZSBwYXJzZWQgYXMgSFRNTC5cclxuXHJcbmZ1bmN0aW9uIGRpdihzdHlsZXMsIHRleHQpIHtcclxuICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlcyk7XHJcbiAgICBpZiAodGV4dCAhPSBudWxsKSBlbC50ZXh0Q29udGVudCA9IHRleHQ7XHJcbiAgICByZXR1cm4gZWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdseXBoKGVudHJ5KSB7XHJcbiAgICBpZiAoZW50cnkuc2hhcGUgPT09IFwibGluZVwiKSB7XHJcbiAgICAgICAgcmV0dXJuIGRpdih7IHdpZHRoOiBcIjIwcHhcIiwgaGVpZ2h0OiBcIjRweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5jb2xvcixcclxuICAgICAgICAgICAgICAgICAgICAgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiIH0pO1xyXG4gICAgfVxyXG4gICAgaWYgKGVudHJ5LnNoYXBlID09PSBcInBpblwiKSB7XHJcbiAgICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBlbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XHJcbiAgICAgICAgZWwuc3R5bGUuZmxleCA9IFwibm9uZVwiO1xyXG4gICAgICAgIGNvbnN0IHN2ZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsIFwic3ZnXCIpO1xyXG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBcIjEyXCIpO1xyXG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJoZWlnaHRcIiwgXCIxNFwiKTtcclxuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwidmlld0JveFwiLCBcIjAgMCAyNCAyOFwiKTtcclxuICAgICAgICBjb25zdCBwYXRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJwYXRoXCIpO1xyXG4gICAgICAgIHBhdGguc2V0QXR0cmlidXRlKFwiZFwiLFxyXG4gICAgICAgICAgICBcIk0xMiAwQzUuNCAwIDAgNS40IDAgMTJjMCA5IDEyIDE2IDEyIDE2czEyLTcgMTItMTZDMjQgNS40IDE4LjYgMCAxMiAwelwiKTtcclxuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImZpbGxcIiwgZW50cnkuY29sb3IpO1xyXG4gICAgICAgIHN2Zy5hcHBlbmRDaGlsZChwYXRoKTtcclxuICAgICAgICBlbC5hcHBlbmRDaGlsZChzdmcpO1xyXG4gICAgICAgIHJldHVybiBlbDtcclxuICAgIH1cclxuICAgIC8vIGNpcmNsZSAvIHBvbHlnb24gLyBzcXVhcmU6IGZpbGwgaW5zaWRlIGEgYm9yZGVyLCB3aGljaCBpcyBob3cgYXJlYXMgZHJhdy5cclxuICAgIGNvbnN0IHJhZGl1cyA9IGVudHJ5LnNoYXBlID09PSBcImNpcmNsZVwiID8gXCI1MCVcIlxyXG4gICAgICAgIDogZW50cnkuc2hhcGUgPT09IFwicG9seWdvblwiID8gXCIycHhcIiA6IFwiMFwiO1xyXG4gICAgcmV0dXJuIGRpdih7IHdpZHRoOiBcIjEycHhcIiwgaGVpZ2h0OiBcIjEycHhcIiwgYmFja2dyb3VuZDogZW50cnkuZmlsbENvbG9yLFxyXG4gICAgICAgICAgICAgICAgIGJvcmRlcjogYDJweCBzb2xpZCAke2VudHJ5LmNvbG9yfWAsIGJvcmRlclJhZGl1czogcmFkaXVzLFxyXG4gICAgICAgICAgICAgICAgIG1hcmdpblJpZ2h0OiBcIjZweFwiLCBmbGV4OiBcIm5vbmVcIiwgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIiB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmFtcFJvdyhlbnRyeSkge1xyXG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcclxuICAgIGNvbnN0IHN0b3BzID0gKGVudHJ5LmFuY2hvcnMgfHwgW10pLm1hcCgoY29sb3IsIGksIGFsbCkgPT5cclxuICAgICAgICBgJHtjb2xvcn0gJHthbGwubGVuZ3RoID4gMSA/IChpIC8gKGFsbC5sZW5ndGggLSAxKSkgKiAxMDAgOiAwfSVgKTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe1xyXG4gICAgICAgIHdpZHRoOiBcIjEyMHB4XCIsIGhlaWdodDogXCIxMnB4XCIsIGJvcmRlclJhZGl1czogXCIycHhcIixcclxuICAgICAgICBiYWNrZ3JvdW5kSW1hZ2U6IGBsaW5lYXItZ3JhZGllbnQodG8gcmlnaHQsICR7c3RvcHMuam9pbihcIiwgXCIpfSlgLFxyXG4gICAgfSkpO1xyXG4gICAgY29uc3QgZW5kcyA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBqdXN0aWZ5Q29udGVudDogXCJzcGFjZS1iZXR3ZWVuXCIsIHdpZHRoOiBcIjEyMHB4XCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgZm9udFNpemU6IFwiMTFweFwiLCBjb2xvcjogXCIjNTU1XCIgfSk7XHJcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtaW4pKSk7XHJcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtYXgpKSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZW5kcyk7XHJcbiAgICByZXR1cm4gcm93O1xyXG59XHJcblxyXG5jb25zdCBNQVhfQ0FURUdPUllfUk9XUyA9IDEyO1xyXG5cclxuZnVuY3Rpb24gY2F0ZWdvcmllc1JvdyhlbnRyeSkge1xyXG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcclxuICAgIGNvbnN0IGl0ZW1zID0gZW50cnkuaXRlbXMgfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMuc2xpY2UoMCwgTUFYX0NBVEVHT1JZX1JPV1MpKSB7XHJcbiAgICAgICAgY29uc3QgbGluZSA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBtYXJnaW5Ub3A6IFwiM3B4XCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmdpbkxlZnQ6IFwiOHB4XCIgfSk7XHJcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvcjogaXRlbS5jb2xvciwgZmlsbENvbG9yOiBpdGVtLmNvbG9yIH0pKTtcclxuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGl0ZW0udmFsdWUpKSk7XHJcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGxpbmUpO1xyXG4gICAgfVxyXG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA+IE1BWF9DQVRFR09SWV9ST1dTKSB7XHJcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGRpdih7IG1hcmdpbkxlZnQ6IFwiOHB4XCIsIG1hcmdpblRvcDogXCIzcHhcIiwgY29sb3I6IFwiIzU1NVwiIH0sXHJcbiAgICAgICAgICAgIGArICR7aXRlbXMubGVuZ3RoIC0gTUFYX0NBVEVHT1JZX1JPV1N9IG1vcmVgKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcm93O1xyXG59XHJcblxyXG5mdW5jdGlvbiBiaW5zUm93KGVudHJ5KSB7XHJcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xyXG4gICAgY29uc3QgZWRnZXMgPSBlbnRyeS5lZGdlcyB8fCBbXTtcclxuICAgIGNvbnN0IGNvbG9ycyA9IGVudHJ5LmNvbG9ycyB8fCBbXTtcclxuICAgIGNvbnN0IGxhYmVsRm9yID0gaSA9PiBpID09PSAwID8gYDwgJHtlZGdlc1swXX1gXHJcbiAgICAgICAgOiBpID09PSBlZGdlcy5sZW5ndGggPyBgXHUyMjY1ICR7ZWRnZXNbZWRnZXMubGVuZ3RoIC0gMV19YFxyXG4gICAgICAgIDogYCR7ZWRnZXNbaSAtIDFdfSBcdTIwMTMgJHtlZGdlc1tpXX1gO1xyXG4gICAgY29sb3JzLmZvckVhY2goKGNvbG9yLCBpKSA9PiB7XHJcbiAgICAgICAgY29uc3QgbGluZSA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBtYXJnaW5Ub3A6IFwiM3B4XCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmdpbkxlZnQ6IFwiOHB4XCIgfSk7XHJcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvciwgZmlsbENvbG9yOiBjb2xvciB9KSk7XHJcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChkaXYoe30sIGxhYmVsRm9yKGkpKSk7XHJcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGxpbmUpO1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gcm93O1xyXG59XHJcblxyXG4vLyBBIHNpemUga2V5IGlzIGEgc3RhdGVtZW50LCBub3QgYSBkcmF3aW5nOiBcIlx1MjVDRiBzaXplIFx1MjIxRCBmaWVsZCAobWluIFx1MjAxMyBtYXgpXCIuIFRoZSBnbHlwaFxyXG4vLyBpcyBmaXhlZCBhbmQgbm90aGluZyBpbiB0aGUgcm93IGRlcml2ZXMgZnJvbSByYWRpdXNfcmFuZ2Ugb3IgdGhlIGRhdGEncyBzcHJlYWQgLS1cclxuLy8gbGVnZW5kIENTUyBwaXhlbHMgYXJlIG5vdCBtYXAgcGl4ZWxzIGF0IGFueSB6b29tLCBzbyBkcmF3biBzYW1wbGUgY2lyY2xlcyB3b3VsZFxyXG4vLyBhc3NlcnQgYSBwcmVjaXNpb24gdGhhdCBkb2VzIG5vdCBleGlzdC4gVGhlIHJvdyBuYW1lcyB0aGUgZW5jb2RpbmcgYW5kIGl0cyBkb21haW4uXHJcbmZ1bmN0aW9uIHNpemVzUm93KGVudHJ5KSB7XHJcbiAgICBjb25zdCByb3cgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7IG1hcmdpblJpZ2h0OiBcIjZweFwiLCBmbGV4OiBcIm5vbmVcIiwgY29sb3I6IFwiIzY2NlwiIH0sIFwiXHUyNUNGXCIpKTtcclxuICAgIGNvbnN0IHJhbmdlID0gZW50cnkudm1pbiAhPSBudWxsICYmIGVudHJ5LnZtYXggIT0gbnVsbFxyXG4gICAgICAgID8gYCAoJHtlbnRyeS52bWlufSBcdTIwMTMgJHtlbnRyeS52bWF4fSlgIDogXCJcIjtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGBzaXplIFx1MjIxRCAke2VudHJ5LmZpZWxkIHx8IGVudHJ5LmxhYmVsfSR7cmFuZ2V9YCkpO1xyXG4gICAgcmV0dXJuIHJvdztcclxufVxyXG5cclxuZnVuY3Rpb24gc3dhdGNoUm93KGVudHJ5KSB7XHJcbiAgICBjb25zdCByb3cgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGdseXBoKGVudHJ5KSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xyXG4gICAgcmV0dXJuIHJvdztcclxufVxyXG5cclxuLy8gQ29sbGFwc2Ugc3RhdGUsIHBlciBjb250YWluZXIgcmF0aGVyIHRoYW4gbW9kdWxlIHNjb3BlOiB0aGUgc2lkZWJhciBrZXlzIGl0c1xyXG4vLyBjb2xsYXBzZWRQYXRocyBhdCBtb2R1bGUgbGV2ZWwgYW5kIHR3byBtYXBzIG9uIG9uZSBwYWdlIHNoYXJlIGl0IC0tIGEgZmlsZWQgYnVnXHJcbi8vIHRoaXMgZGVsaWJlcmF0ZWx5IGRvZXMgbm90IGluaGVyaXQuIEtleWVkIGJ5IGdyb3VwIG5hbWUsIHN1cnZpdmluZyB0aGUgZnVsbFxyXG4vLyByZS1yZW5kZXIgZXZlcnkgc3luYyBwZXJmb3Jtcy5cclxuY29uc3QgY29sbGFwc2VkQnlDb250YWluZXIgPSBuZXcgV2Vha01hcCgpO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckxlZ2VuZChjb250YWluZXIsIHNwZWMsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29udGFpbmVyLmlubmVySFRNTCA9IFwiXCI7XHJcbiAgICBjb25zdCBkaW1IaWRkZW4gPSBvcHRpb25zLmRpbUhpZGRlbiAhPT0gZmFsc2U7XHJcbiAgICBsZXQgY29sbGFwc2VkID0gY29sbGFwc2VkQnlDb250YWluZXIuZ2V0KGNvbnRhaW5lcik7XHJcbiAgICBpZiAoIWNvbGxhcHNlZCkge1xyXG4gICAgICAgIGNvbGxhcHNlZCA9IG5ldyBTZXQoKTtcclxuICAgICAgICBjb2xsYXBzZWRCeUNvbnRhaW5lci5zZXQoY29udGFpbmVyLCBjb2xsYXBzZWQpO1xyXG4gICAgfVxyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7XHJcbiAgICAgICAgZm9udFNpemU6IFwiMTNweFwiLCBmb250V2VpZ2h0OiBcImJvbGRcIiwgYm9yZGVyQm90dG9tOiBcIjJweCBzb2xpZCAjZWVlXCIsXHJcbiAgICAgICAgcGFkZGluZ0JvdHRvbTogXCI0cHhcIiwgbWFyZ2luQm90dG9tOiBcIjRweFwiLFxyXG4gICAgfSwgc3BlYy50aXRsZSkpO1xyXG5cclxuICAgIGZvciAoY29uc3QgZ3JvdXAgb2Ygc3BlYy5ncm91cHMpIHtcclxuICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGdyb3VwLm5hbWUgJiYgY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKTtcclxuICAgICAgICBpZiAoZ3JvdXAubmFtZSkge1xyXG4gICAgICAgICAgICAvLyBUaGUgc2lkZWJhcidzIGFmZm9yZGFuY2UgZXhhY3RseTogYW4gYXJyb3cgdGhhdCBmb2xkcyB0aGUgc2VjdGlvbi5cclxuICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gZGl2KHsgZm9udFdlaWdodDogXCJib2xkXCIsIG1hcmdpblRvcDogXCI2cHhcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3Vyc29yOiBcInBvaW50ZXJcIiwgdXNlclNlbGVjdDogXCJub25lXCIgfSk7XHJcbiAgICAgICAgICAgIGhlYWRlci50ZXh0Q29udGVudCA9IGAke2lzQ29sbGFwc2VkID8gXCJcdTI1QjhcIiA6IFwiXHUyNUJFXCJ9ICR7Z3JvdXAubmFtZX1gO1xyXG4gICAgICAgICAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChjb2xsYXBzZWQuaGFzKGdyb3VwLm5hbWUpKSBjb2xsYXBzZWQuZGVsZXRlKGdyb3VwLm5hbWUpO1xyXG4gICAgICAgICAgICAgICAgZWxzZSBjb2xsYXBzZWQuYWRkKGdyb3VwLm5hbWUpO1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGNvbnRhaW5lciwgc3BlYywgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoaGVhZGVyKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGlzQ29sbGFwc2VkKSBjb250aW51ZTtcclxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGdyb3VwLmVudHJpZXMpIHtcclxuICAgICAgICAgICAgY29uc3Qgcm93ID0gZW50cnkua2luZCA9PT0gXCJyYW1wXCIgPyByYW1wUm93KGVudHJ5KVxyXG4gICAgICAgICAgICAgICAgOiBlbnRyeS5raW5kID09PSBcImNhdGVnb3JpZXNcIiA/IGNhdGVnb3JpZXNSb3coZW50cnkpXHJcbiAgICAgICAgICAgICAgICA6IGVudHJ5LmtpbmQgPT09IFwiYmluc1wiID8gYmluc1JvdyhlbnRyeSlcclxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJzaXplc1wiID8gc2l6ZXNSb3coZW50cnkpXHJcbiAgICAgICAgICAgICAgICA6IHN3YXRjaFJvdyhlbnRyeSk7XHJcbiAgICAgICAgICAgIC8vIERpbW1lZCwgbm90IGRyb3BwZWQ6IHVuZGVyIHNjb3BlIFwiYWxsXCIgdGhlIGxlZ2VuZCBpcyB0aGUgbWFwJ3Mgd2hvbGVcclxuICAgICAgICAgICAgLy8gdm9jYWJ1bGFyeSwgYW5kIHRoZSBkaW0gaXMgd2hhdCBzdGlsbCB0ZWxscyB0aGUgY3VycmVudCBzY3JlZW4gc3RhdGUuXHJcbiAgICAgICAgICAgIGlmIChlbnRyeS5oaWRkZW4gJiYgZGltSGlkZGVuKSByb3cuc3R5bGUub3BhY2l0eSA9IFwiMC41XCI7XHJcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChyb3cpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBjb250YWluZXI7XHJcbn1cclxuIiwgImltcG9ydCB7IEwgfSBmcm9tIFwiLi9saWJzLmpzXCI7XHJcbmV4cG9ydCBmdW5jdGlvbiBsb2FkQ1NTKGlkLCB1cmwpIHtcclxuICAgIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XHJcbiAgICAgICAgY29uc3QgbGluayA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJsaW5rXCIpO1xyXG4gICAgICAgIGxpbmsuaWQgPSBpZDtcclxuICAgICAgICBsaW5rLnJlbCA9IFwic3R5bGVzaGVldFwiO1xyXG4gICAgICAgIGxpbmsuaHJlZiA9IHVybDtcclxuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKGxpbmspO1xyXG4gICAgfVxyXG59XHJcblxyXG5jb25zdCBhY3RpdmVMb2FkZXJzID0ge307XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gbG9hZEpTKGlkLCB1cmwpIHtcclxuICAgIGlmIChhY3RpdmVMb2FkZXJzW2lkXSkge1xyXG4gICAgICAgIHJldHVybiBhY3RpdmVMb2FkZXJzW2lkXTtcclxuICAgIH1cclxuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgaWYgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xyXG4gICAgICAgICAgICByZXNvbHZlKCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3Qgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNjcmlwdFwiKTtcclxuICAgICAgICBzY3JpcHQuaWQgPSBpZDtcclxuICAgICAgICBzY3JpcHQuc3JjID0gdXJsO1xyXG4gICAgICAgIHNjcmlwdC5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XHJcbiAgICAgICAgc2NyaXB0Lm9uZXJyb3IgPSAoKSA9PiByZWplY3QobmV3IEVycm9yKGBGYWlsZWQgdG8gbG9hZCBzY3JpcHQ6ICR7dXJsfWApKTtcclxuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHNjcmlwdCk7XHJcbiAgICB9KTtcclxuICAgIGFjdGl2ZUxvYWRlcnNbaWRdID0gcHJvbWlzZTtcclxuICAgIHJldHVybiBwcm9taXNlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBoZXhUb1JnYihoZXgpIHtcclxuICAgIGlmICghaGV4KSByZXR1cm4gbnVsbDtcclxuICAgIGhleCA9IGhleC5yZXBsYWNlKC9eIy8sICcnKTtcclxuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyICsgY2hhcikuam9pbignJyk7XHJcbiAgICB9XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCAhPT0gNikgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBudW0gPSBwYXJzZUludChoZXgsIDE2KTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgcjogKChudW0gPj4gMTYpICYgMjU1KSAvIDI1NSxcclxuICAgICAgICBnOiAoKG51bSA+PiA4KSAmIDI1NSkgLyAyNTUsXHJcbiAgICAgICAgYjogKG51bSAmIDI1NSkgLyAyNTVcclxuICAgIH07XHJcbn1cclxuXHJcbmxldCBjb2xvclByb2JlID0gbnVsbDtcclxuXHJcbi8vIEJyb3dzZXJzIHNoaXAgYSBjb21wbGV0ZSBDU1MgY29sb3IgcGFyc2VyIC0tIGV2ZXJ5IG5hbWVkIGNvbG9yLCByZ2IoKSwgaHNsKCksIGh3YigpLlxyXG4vLyBCb3Jyb3cgaXQgaW5zdGVhZCBvZiBtYWludGFpbmluZyBhIGxvb2t1cCB0YWJsZS4gUmV0dXJucyBudWxsIG91dHNpZGUgYSBET00gKE5vZGUgdGVzdHMpLFxyXG4vLyB3aGVyZSB0aGUgaGV4IGZhbGxiYWNrIGluIHBhcnNlQ29sb3Igc3RpbGwgYXBwbGllcy5cclxuZnVuY3Rpb24gY3NzQ29sb3JUb1JnYih2YWx1ZSkge1xyXG4gICAgaWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGw7XHJcbiAgICBpZiAoIWNvbG9yUHJvYmUpIGNvbG9yUHJvYmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpLmdldENvbnRleHQoXCIyZFwiKTtcclxuXHJcbiAgICAvLyBBc3NpZ25pbmcgYW4gaW52YWxpZCBjb2xvciBsZWF2ZXMgZmlsbFN0eWxlIHVudG91Y2hlZCwgc28gcHJvYmUgYWdhaW5zdCB0d28gZGlmZmVyZW50XHJcbiAgICAvLyBzZW50aW5lbHM6IG9ubHkgYSB2YWx1ZSB0aGUgYnJvd3NlciBhY3R1YWxseSBwYXJzZWQgcHJvZHVjZXMgdGhlIHNhbWUgcmVzdWx0IHR3aWNlLlxyXG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiMwMDAwMDBcIjtcclxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XHJcbiAgICBjb25zdCBmaXJzdCA9IGNvbG9yUHJvYmUuZmlsbFN0eWxlO1xyXG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiNmZmZmZmZcIjtcclxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XHJcbiAgICBpZiAoZmlyc3QgIT09IGNvbG9yUHJvYmUuZmlsbFN0eWxlKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICBpZiAoZmlyc3Quc3RhcnRzV2l0aChcIiNcIikpIHJldHVybiBoZXhUb1JnYihmaXJzdCk7XHJcbiAgICBjb25zdCBtYXRjaCA9IGZpcnN0Lm1hdGNoKC9yZ2JhP1xcKChbXildKylcXCkvKTtcclxuICAgIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3QgcGFydHMgPSBtYXRjaFsxXS5zcGxpdChcIixcIikubWFwKHAgPT4gcGFyc2VGbG9hdChwLnRyaW0oKSkpO1xyXG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMgfHwgcGFydHMuc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcclxuICAgIHJldHVybiB7IHI6IHBhcnRzWzBdIC8gMjU1LCBnOiBwYXJ0c1sxXSAvIDI1NSwgYjogcGFydHNbMl0gLyAyNTUgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29sb3IoY29sb3JTdHIsIGZhbGxiYWNrSGV4ID0gXCIjMzM4OGZmXCIpIHtcclxuICAgIGlmICghY29sb3JTdHIpIGNvbG9yU3RyID0gZmFsbGJhY2tIZXg7XHJcbiAgICByZXR1cm4gY3NzQ29sb3JUb1JnYihjb2xvclN0cilcclxuICAgICAgICB8fCBoZXhUb1JnYihjb2xvclN0cilcclxuICAgICAgICB8fCBjc3NDb2xvclRvUmdiKGZhbGxiYWNrSGV4KVxyXG4gICAgICAgIHx8IGhleFRvUmdiKGZhbGxiYWNrSGV4KVxyXG4gICAgICAgIHx8IHsgcjogMC4yLCBnOiAwLjUsIGI6IDEuMCB9O1xyXG59XHJcblxyXG5jb25zdCBVUkxfQVRUUl9CRUZPUkUgPSAvKD86aHJlZnxzcmMpXFxzKj1cXHMqWydcIl0/JC9pO1xyXG5jb25zdCBTQUZFX1VSTCA9IC9eKD86aHR0cHM/OlxcL1xcL3xtYWlsdG86fHRlbDp8ZGF0YTppbWFnZVxcL3xbLi8jP118W1xcdy4tXSsoPzpbLz8jXXwkKSkvaTtcclxuXHJcbi8vIFByb3BlcnR5IHZhbHVlcyBjb21lIGZyb20gdXNlciBkYXRhIGFuZCBlbmQgdXAgaW4gaW5uZXJIVE1MLCBzbyB0aGV5IGFyZSBlc2NhcGVkLlxyXG4vLyBNYXJrdXAgdGhlIGFwcCBhdXRob3Igd3JvdGUgKHRlbXBsYXRlcywgc3R5bGUgc3RyaW5ncykgaXMgbGVmdCBpbnRhY3QuXHJcbmV4cG9ydCBmdW5jdGlvbiBlc2NhcGVIdG1sKHZhbHVlKSB7XHJcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlKVxyXG4gICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcclxuICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcclxuICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcclxuICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcclxuICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMzk7XCIpO1xyXG59XHJcblxyXG4vLyBFc2NhcGluZyBzdG9wcyBhdHRyaWJ1dGUgYnJlYWtvdXQgYnV0IG5vdCBcImphdmFzY3JpcHQ6XCIgaW4gYW4gaHJlZiwgc28gdmFsdWVzIGxhbmRpbmdcclxuLy8gaW4gYSBVUkwgYXR0cmlidXRlIGdldCBhIHNjaGVtZSBjaGVjay4gQ29udHJvbCBjaGFyYWN0ZXJzIGFyZSBzdHJpcHBlZCBmaXJzdCBiZWNhdXNlXHJcbi8vIFwiamF2YVxcdHNjcmlwdDpcIiBzdXJ2aXZlcyBhIG5haXZlIGNvbXBhcmlzb24uXHJcbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlKSB7XHJcbiAgICBjb25zdCBjb2xsYXBzZWQgPSBTdHJpbmcodmFsdWUpLnNwbGl0KFwiXCIpLmZpbHRlcihjID0+IGMuY2hhckNvZGVBdCgwKSA+IDMyKS5qb2luKFwiXCIpO1xyXG4gICAgcmV0dXJuIFNBRkVfVVJMLnRlc3QoY29sbGFwc2VkKSA/IFN0cmluZyh2YWx1ZSkgOiBcIlwiO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcclxuICAgIGNvbnN0IHRhcmdldEZpZWxkcyA9IChBcnJheS5pc0FycmF5KGZpZWxkcykgJiYgZmllbGRzLmxlbmd0aCkgPyBmaWVsZHMgOiBPYmplY3Qua2V5cyhwcm9wcyk7XHJcbiAgICBjb25zdCBsYWJlbHMgPSAoQXJyYXkuaXNBcnJheShuYW1lcykgJiYgbmFtZXMubGVuZ3RoID09PSB0YXJnZXRGaWVsZHMubGVuZ3RoKSA/IG5hbWVzIDogdGFyZ2V0RmllbGRzO1xyXG4gICAgY29uc3QgbGluZXMgPSBbXTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGFyZ2V0RmllbGRzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZiA9IHRhcmdldEZpZWxkc1tpXTtcclxuICAgICAgICBpZiAocHJvcHNbZl0gPT09IHVuZGVmaW5lZCB8fCBwcm9wc1tmXSA9PT0gbnVsbCkgY29udGludWU7XHJcbiAgICAgICAgbGluZXMucHVzaChgPGI+JHtlc2NhcGVIdG1sKGxhYmVsc1tpXSl9PC9iPjogJHtlc2NhcGVIdG1sKHByb3BzW2ZdKX1gKTtcclxuICAgIH1cclxuICAgIHJldHVybiBsaW5lcy5qb2luKFwiPGJyPlwiKTtcclxufVxyXG5cclxuLy8gXCJ7Y29sdW1ufVwiIGluc2VydHMgb25lIGVzY2FwZWQgdmFsdWU7IFwieyp9XCIgaW5zZXJ0cyB0aGUgZGVmYXVsdCBmaWVsZCBsaXN0LlxyXG5mdW5jdGlvbiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcclxuICAgIHJldHVybiB0ZW1wbGF0ZS5yZXBsYWNlKC9cXHsoXFwqfFxcdyspXFx9L2csIChtYXRjaCwga2V5LCBvZmZzZXQpID0+IHtcclxuICAgICAgICBpZiAoa2V5ID09PSBcIipcIikge1xyXG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCB2YWwgPSBwcm9wc1trZXldO1xyXG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHJldHVybiBcIlwiO1xyXG4gICAgICAgIGNvbnN0IHByZWNlZGluZyA9IHRlbXBsYXRlLnNsaWNlKE1hdGgubWF4KDAsIG9mZnNldCAtIDE2KSwgb2Zmc2V0KTtcclxuICAgICAgICByZXR1cm4gZXNjYXBlSHRtbChVUkxfQVRUUl9CRUZPUkUudGVzdChwcmVjZWRpbmcpID8gc2FmZVVybCh2YWwpIDogdmFsKTtcclxuICAgIH0pO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIGtpbmQpIHtcclxuICAgIGNvbnN0IHRlbXBsYXRlID0gbGF5ZXJba2luZCArIFwiX3RlbXBsYXRlXCJdO1xyXG4gICAgY29uc3QgZmllbGRzID0gbGF5ZXJba2luZCArIFwiX2ZpZWxkc1wiXTtcclxuICAgIGNvbnN0IG5hbWVzID0gbGF5ZXJba2luZCArIFwiX25hbWVzXCJdO1xyXG4gICAgaWYgKHR5cGVvZiB0ZW1wbGF0ZSA9PT0gXCJzdHJpbmdcIiAmJiB0ZW1wbGF0ZSkge1xyXG4gICAgICAgIHJldHVybiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcclxufVxyXG5cclxuZnVuY3Rpb24gd3JhcFN0eWxlZChodG1sLCBzdHlsZSkge1xyXG4gICAgaWYgKCFzdHlsZSkgcmV0dXJuIGh0bWw7XHJcbiAgICByZXR1cm4gYDxkaXYgc3R5bGU9XCIke2VzY2FwZUh0bWwoc3R5bGUpfVwiPiR7aHRtbH08L2Rpdj5gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYmluZFBvcHVwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIpIHtcclxuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJwb3B1cFwiKTtcclxuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF9wb3B1cCB8fCBsYXllci5wb3B1cF9maWVsZHMgfHwgbGF5ZXIucG9wdXBfdGVtcGxhdGUpKSB7XHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xyXG4gICAgICAgIGlmIChsYXllci5wb3B1cF9tYXhfd2lkdGgpIG9wdGlvbnMubWF4V2lkdGggPSBsYXllci5wb3B1cF9tYXhfd2lkdGg7XHJcbiAgICAgICAgTC5wb3B1cChvcHRpb25zKVxyXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcclxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci5wb3B1cF9zdHlsZSkpXHJcbiAgICAgICAgICAgIC5vcGVuT24obWFwKTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRUb29sdGlwKG1hcCwgbGF0bG5nLCBwcm9wcywgbGF5ZXIsIGxheWVySW5zdGFuY2UpIHtcclxuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJ0b29sdGlwXCIpO1xyXG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3Rvb2x0aXAgfHwgbGF5ZXIudG9vbHRpcF9maWVsZHMgfHwgbGF5ZXIudG9vbHRpcF90ZW1wbGF0ZSkpIHtcclxuICAgICAgICBpZiAoIWxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcCA9IEwudG9vbHRpcCh7IGRpcmVjdGlvbjogJ3RvcCcsIG9mZnNldDogWzAsIC01XSB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcFxyXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcclxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci50b29sdGlwX3N0eWxlKSlcclxuICAgICAgICAgICAgLmFkZFRvKG1hcCk7XHJcbiAgICB9XHJcbn1cclxuIiwgImV4cG9ydCBjb25zdCBwaW5TaGFkZXIgPSBgXHJcbnByZWNpc2lvbiBtZWRpdW1wIGZsb2F0O1xyXG52YXJ5aW5nIHZlYzQgX2NvbG9yO1xyXG52b2lkIG1haW4oKSB7XHJcbiAgICAvLyB1diByYW5nZXMgZnJvbSAtMC41IHRvIDAuNS4gVGhlIGNlbnRlciAoMC4wLCAwLjApIGlzIHRoZSBleGFjdCBjb29yZGluYXRlLlxyXG4gICAgdmVjMiB1diA9IGdsX1BvaW50Q29vcmQueHkgLSB2ZWMyKDAuNSk7XHJcblxyXG4gICAgLy8gUGluIGhlYWQgY2lyY2xlIGNlbnRlcmVkIGF0ICgwLjAsIC0wLjMwKSB3aXRoIHJhZGl1cyAwLjE2XHJcbiAgICBmbG9hdCBkX2NpcmNsZSA9IGxlbmd0aCh1diAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4xNjtcclxuICAgIFxyXG4gICAgLy8gUGluIGJvZHkgdHJpYW5nbGUgcG9pbnRpbmcgZXhhY3RseSB0byAoMC4wLCAwLjApXHJcbiAgICBmbG9hdCBkX3RyaWFuZ2xlID0gbWF4KGFicyh1di54KSAqIDEuODc1ICsgdXYueSwgLXV2LnkgLSAwLjMwKTtcclxuICAgIGZsb2F0IGRfcGluID0gbWluKGRfY2lyY2xlLCBkX3RyaWFuZ2xlKTtcclxuXHJcbiAgICAvLyBJbm5lciBob2xlIGNlbnRlcmVkIGF0ICgwLjAsIC0wLjMwKSB3aXRoIHJhZGl1cyAwLjA2XHJcbiAgICBmbG9hdCBkX2hvbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMDY7XHJcblxyXG4gICAgLy8gRHJvcCBzaGFkb3cgc2hpZnRlZCBzbGlnaHRseSBkb3duIGFuZCBibHVycmVkXHJcbiAgICB2ZWMyIHNoYWRvd1V2ID0gdXYgLSB2ZWMyKDAuMCwgMC4wNCk7XHJcbiAgICBmbG9hdCBkX3NoYWRvd19jaXJjbGUgPSBsZW5ndGgoc2hhZG93VXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBmbG9hdCBkX3NoYWRvd190cmlhbmdsZSA9IG1heChhYnMoc2hhZG93VXYueCkgKiAxLjg3NSArIHNoYWRvd1V2LnksIC1zaGFkb3dVdi55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3NoYWRvdyA9IG1pbihkX3NoYWRvd19jaXJjbGUsIGRfc2hhZG93X3RyaWFuZ2xlKTtcclxuXHJcbiAgICAvLyBBbnRpLWFsaWFzZWQgbWFza3NcclxuICAgIGZsb2F0IG1hc2tfcGluID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX3Bpbik7XHJcbiAgICBmbG9hdCBtYXNrX2hvbGUgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfaG9sZSk7XHJcbiAgICBmbG9hdCBtYXNrX2JvcmRlciA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4gKyAwLjAyNSk7XHJcbiAgICBmbG9hdCBtYXNrX3NoYWRvdyA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDMsIDAuMDQsIGRfc2hhZG93KTtcclxuXHJcbiAgICAvLyBDb21wb3NpdGUgbGF5ZXJzXHJcbiAgICB2ZWM0IHNoYWRvd0NvbG9yID0gdmVjNCgwLjAsIDAuMCwgMC4wLCAwLjI1KSAqIG1hc2tfc2hhZG93O1xyXG4gICAgdmVjNCBib2R5Q29sb3IgPSBtaXgodmVjNCgwLjAsIDAuMCwgMC4wLCAwLjg1KSwgdmVjNChfY29sb3IucmdiLCBfY29sb3IuYSksIG1hc2tfYm9yZGVyKTtcclxuICAgIHZlYzQgd2l0aEhvbGUgPSBtaXgoYm9keUNvbG9yLCB2ZWM0KDEuMCwgMS4wLCAxLjAsIDEuMCksIG1hc2tfaG9sZSk7XHJcblxyXG4gICAgZ2xfRnJhZ0NvbG9yID0gbWl4KHNoYWRvd0NvbG9yLCB3aXRoSG9sZSwgbWFza19waW4pO1xyXG59YDtcclxuIiwgIi8vIFRoZSBzaGFyZWQgdGltZSBzbGlkZXI6IG9uZSBjb250cm9sIHNlcnZpbmcgZXZlcnkgdGltZSBsYXllciBvbiB0aGUgbWFwLlxyXG4vL1xyXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcclxuLy8gdGltZXN0YW1wcywgZGVsaWJlcmF0ZWx5OiBhIHBlcmlvZCBpbiB3aGljaCBub3RoaW5nIGhhcHBlbmVkIHN0aWxsIGdldHMgaXRzIHRpY2ssIHNvIGFuXHJcbi8vIGVtcHR5IG1hcCBhdCAwMzowMCByZWFkcyBhcyBhYnNlbmNlIHJhdGhlciB0aGFuIHRoZSBzbGlkZXIgc2tpcHBpbmcgdGhlIHF1aWV0IGhvdXJzLlxyXG4vL1xyXG4vLyBUaGlzIGlzIHN3aWZ0bWFwJ3Mgb3duIGNvbnRyb2wgcmF0aGVyIHRoYW4gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MuIFRoYXQgbGlicmFyeSBzcGxpdHNcclxuLy8gaW50byBhIHRpbWUgbW9kZWwsIGEgY29udHJvbCwgYW5kIHBlci1sYXllciBhZGFwdGVycyB0aGF0IHJlLXJlbmRlciBHZW9KU09OIHBlciB0aWNrIC0tXHJcbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxyXG4vLyBjb250cm9sIGFsb25lIHdhcyBub3Qgd29ydGggYSB2ZW5kb3JlZCBkZXBlbmRlbmN5IG9uIGEgbmV0d29yayB3aGVyZSBldmVyeSBmaWxlIGlzXHJcbi8vIGNhcnJpZWQgYWNyb3NzIGJ5IGhhbmQuXHJcblxyXG4vLyAtLS0gSVNPODYwMSBwZXJpb2RzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBNaXJyb3JzIGlzX3ZhbGlkX3BlcmlvZCgpIGluIHN3aWZ0bWFwL2xheWVycy9fdGltZS5weTsgdGhlIGdyYW1tYXIgbXVzdCBub3QgZHJpZnQuXHJcbmNvbnN0IFBFUklPRF9SRSA9XHJcbiAgICAvXlAoPyEkKSg/OihcXGQrKVkpPyg/OihcXGQrKU0pPyg/OihcXGQrKVcpPyg/OihcXGQrKUQpPyg/OlQoPyEkKSg/OihcXGQrKUgpPyg/OihcXGQrKU0pPyg/OihcXGQrKD86XFwuXFxkKyk/KVMpPyk/JC87XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xyXG4gICAgY29uc3QgbSA9IFBFUklPRF9SRS5leGVjKHRleHQgfHwgXCJcIik7XHJcbiAgICBpZiAoIW0pIHJldHVybiBudWxsO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICB5ZWFyczogKyhtWzFdIHx8IDApLCBtb250aHM6ICsobVsyXSB8fCAwKSwgd2Vla3M6ICsobVszXSB8fCAwKSwgZGF5czogKyhtWzRdIHx8IDApLFxyXG4gICAgICAgIGhvdXJzOiArKG1bNV0gfHwgMCksIG1pbnV0ZXM6ICsobVs2XSB8fCAwKSwgc2Vjb25kczogKyhtWzddIHx8IDApLFxyXG4gICAgfTtcclxufVxyXG5cclxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxyXG4vLyBhcml0aG1ldGljIHB1dHMgaXQsIG5vdCBhIGZpeGVkIDMwIGRheXMgLS0gd2hpbGUgdGhlIHJlc3QgaXMgcGxhaW4gbWlsbGlzZWNvbmRzLlxyXG5leHBvcnQgZnVuY3Rpb24gYWRkUGVyaW9kKG1zLCBwLCBzaWduID0gMSkge1xyXG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcclxuICAgIGlmIChwLnllYXJzKSBkLnNldFVUQ0Z1bGxZZWFyKGQuZ2V0VVRDRnVsbFllYXIoKSArIHNpZ24gKiBwLnllYXJzKTtcclxuICAgIGlmIChwLm1vbnRocykgZC5zZXRVVENNb250aChkLmdldFVUQ01vbnRoKCkgKyBzaWduICogcC5tb250aHMpO1xyXG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxyXG4gICAgICAgICsgcC5ob3VycyAqIDM2MDAgKyBwLm1pbnV0ZXMgKiA2MCArIHAuc2Vjb25kcykgKiAxMDAwKTtcclxufVxyXG5cclxuLy8gVGhlIHNsaWRlcidzIHBvc2l0aW9uczogZnJvbSB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24gdG8gdGhlIGZpcnN0IHRpY2sgYXQgb3IgcGFzdCB0aGVcclxuLy8gZmluYWwgb25lLCBvbmUgcGVyIHBlcmlvZC4gQ2FwcGVkIGJlY2F1c2UgYSBtaXN0eXBlZCBQVDFTIG92ZXIgYSB5ZWFyIG9mIGRhdGFcclxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cclxuZXhwb3J0IGNvbnN0IE1BWF9USUNLUyA9IDUwMDA7XHJcblxyXG4vLyAtLS0gcGVyaW9kIGJvdW5kYXJpZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBUaWNrcyBhbmNob3IgdG8gUEVSSU9EIEJPVU5EQVJJRVMsIG5vdCB0byB0aGUgZGF0YS4gVGhlIGZpcnN0IHRpY2sgaXMgdGhlIGZpcnN0XHJcbi8vIGJvdW5kYXJ5IGF0IG9yIGFmdGVyIHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbiwgc28gdGhlIGVhcmxpZXN0IHBvaW50IHN0aWxsIGZhbGxzXHJcbi8vIGluc2lkZSB0aGUgaGFsZi1vcGVuIHdpbmRvdyAoZmlyc3RUaWNrIC0gUCwgZmlyc3RUaWNrXSAtLSB0aGUgY29uc3RyYWludCB0aGF0IHB1dFxyXG4vLyB0aGUgZmlyc3QgdGljayBBVCB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24gaG9sZHMgLS0gd2hpbGUgZGF0YSBhcnJpdmluZyBFQVJMSUVSXHJcbi8vIG9ubHkgcHJlcGVuZHMgYm91bmRhcmllcyBhbmQgbW92ZXMgbm90aGluZyBhIHVzZXIgbm90ZWQuIChBbmNob3JlZCB0byB0aGUgZGF0YSxcclxuLy8gYSBsYXRlIG9ic2VydmF0aW9uIHNoaWZ0ZWQgZXZlcnkgdGljayBieSB0aGUgcmVtYWluZGVyIGFuZCB0aGUgbW9tZW50IHRoZSB1c2VyXHJcbi8vIHdhcyBsb29raW5nIGF0IGJlY2FtZSBhIGRpZmZlcmVudCB0aWNrLikgUm91bmQgdGltZXMgZmFsbCBvdXQgZm9yIGZyZWU6IDAzOjAwLFxyXG4vLyAwNDowMCBmb3IgUFQxSCwgbmV2ZXIgMDM6MTcuXHJcbi8vXHJcbi8vIEZpeGVkLXdpZHRoIHBlcmlvZHMgYWxpZ24gdG8gZXBvY2ggbXVsdGlwbGVzLCB3ZWVrcyB0byBNb25kYXkgMDA6MDAgVVRDLiBNb250aHNcclxuLy8gYW5kIHllYXJzIGFsaWduIHRvIG1vbnRoL3llYXIgc3RhcnRzIGluIHRoZSBVVEMgY2FsZW5kYXIsIGluIG11bHRpcGxlcyBvZiB0aGVcclxuLy8gcGVyaW9kIGNvdW50ZWQgZnJvbSB5ZWFyIDAgKFAzTTogcXVhcnRlcnMpLiBBIHBlcmlvZCBtaXhpbmcgY2FsZW5kYXIgYW5kIGNsb2NrXHJcbi8vIHVuaXRzIChQMU0xRCkgaGFzIG5vIHNlbnNpYmxlIGJvdW5kYXJ5IGdyaWQsIHNvIHRoYXQgb25lIGFsb25lIGtlZXBzIHRoZSBvbGRcclxuLy8gYmVoYXZpb3VyOiBpdHMgZmlyc3QgdGljayBzaXRzIGF0IHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbi5cclxuY29uc3QgTU9OREFZX0VQT0NIID0gRGF0ZS5VVEMoMTk3MCwgMCwgNSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYWxpZ25Ub1BlcmlvZChtcywgcCkge1xyXG4gICAgY29uc3QgZml4ZWQgPSBwZXJpb2RUb01zKHApO1xyXG4gICAgY29uc3QgaGFzQ2xvY2sgPSBCb29sZWFuKHAud2Vla3MgfHwgcC5kYXlzIHx8IHAuaG91cnMgfHwgcC5taW51dGVzIHx8IHAuc2Vjb25kcyk7XHJcbiAgICBpZiAoZml4ZWQpIHtcclxuICAgICAgICBjb25zdCB3aG9sZVdlZWtzID0gcC53ZWVrcyAmJiAhcC5kYXlzICYmICFwLmhvdXJzICYmICFwLm1pbnV0ZXMgJiYgIXAuc2Vjb25kcztcclxuICAgICAgICBjb25zdCBvcmlnaW4gPSB3aG9sZVdlZWtzID8gTU9OREFZX0VQT0NIIDogMDtcclxuICAgICAgICByZXR1cm4gb3JpZ2luICsgTWF0aC5jZWlsKChtcyAtIG9yaWdpbikgLyBmaXhlZCkgKiBmaXhlZDtcclxuICAgIH1cclxuICAgIGlmICgocC55ZWFycyB8fCBwLm1vbnRocykgJiYgIWhhc0Nsb2NrKSB7XHJcbiAgICAgICAgY29uc3Qgc3BhbiA9IHAueWVhcnMgKiAxMiArIHAubW9udGhzO1xyXG4gICAgICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShtcyk7XHJcbiAgICAgICAgbGV0IGluZGV4ID0gZC5nZXRVVENGdWxsWWVhcigpICogMTIgKyBkLmdldFVUQ01vbnRoKCk7XHJcbiAgICAgICAgaWYgKERhdGUuVVRDKGQuZ2V0VVRDRnVsbFllYXIoKSwgZC5nZXRVVENNb250aCgpLCAxKSA8IG1zKSBpbmRleCArPSAxO1xyXG4gICAgICAgIGluZGV4ID0gTWF0aC5jZWlsKGluZGV4IC8gc3BhbikgKiBzcGFuO1xyXG4gICAgICAgIHJldHVybiBEYXRlLlVUQyhNYXRoLmZsb29yKGluZGV4IC8gMTIpLCBpbmRleCAlIDEyLCAxKTtcclxuICAgIH1cclxuICAgIHJldHVybiBtcztcclxufVxyXG5cclxuLy8gVGhlIHRpY2sgbmVhcmVzdCB0byBhbiBhYnNvbHV0ZSBtb21lbnQgLS0gaG93IHRoZSBwbGF5aGVhZCBzdXJ2aXZlcyBhIHJlLWdlbmVyYXRlZFxyXG4vLyBzZXJpZXM6IGl0IGlzIGEgTU9NRU5UIHRoZSB1c2VyIGNob3NlLCBuZXZlciBhbiBpbmRleCBpbnRvIGEgbGlzdCB0aGF0IGp1c3QgZ3Jldy5cclxuZXhwb3J0IGZ1bmN0aW9uIG5lYXJlc3RUaWNrSW5kZXgodGlja3MsIG1vbWVudCkge1xyXG4gICAgaWYgKCF0aWNrcy5sZW5ndGggfHwgIU51bWJlci5pc0Zpbml0ZShtb21lbnQpKSByZXR1cm4gMDtcclxuICAgIGxldCBiZXN0ID0gMDtcclxuICAgIGxldCBiZXN0RGlzdGFuY2UgPSBJbmZpbml0eTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGlja3MubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBjb25zdCBkaXN0YW5jZSA9IE1hdGguYWJzKHRpY2tzW2ldIC0gbW9tZW50KTtcclxuICAgICAgICBpZiAoZGlzdGFuY2UgPCBiZXN0RGlzdGFuY2UpIHtcclxuICAgICAgICAgICAgYmVzdCA9IGk7XHJcbiAgICAgICAgICAgIGJlc3REaXN0YW5jZSA9IGRpc3RhbmNlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBiZXN0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xyXG4gICAgY29uc3QgZmlyc3QgPSBhbGlnblRvUGVyaW9kKHN0YXJ0TXMsIHApO1xyXG4gICAgY29uc3QgdGlja3MgPSBbZmlyc3RdO1xyXG4gICAgbGV0IHQgPSBmaXJzdDtcclxuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XHJcbiAgICB3aGlsZSAodGlja3MubGVuZ3RoIDwgTUFYX1RJQ0tTKSB7XHJcbiAgICAgICAgdCA9IGFkZFBlcmlvZCh0LCBwKTtcclxuICAgICAgICB0aWNrcy5wdXNoKHQpO1xyXG4gICAgICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XHJcbiAgICB9XHJcbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXHJcbiAgICAgICAgYHRoZSBwZXJpb2QgaXMgdG9vIGZpbmUgZm9yIHRoZSBkYXRhJ3MgZXh0ZW50LiBVc2UgYSBjb2Fyc2VyIHBlcmlvZC5gKTtcclxuICAgIHJldHVybiB0aWNrcztcclxufVxyXG5cclxuLy8gLS0tIHdpbmRvd3MgYW5kIGZpbHRlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuLy8gVGhlIGludGVydmFsIHNob3duIGF0IG9uZSB0aWNrLiBkdXJhdGlvbiBcInBlcmlvZFwiIGlzIHRoZSB0aWNrJ3Mgb3duIHBlcmlvZCwgc28gYWJzZW5jZVxyXG4vLyBpcyB2aXNpYmxlOyBudWxsIGFjY3VtdWxhdGVzIGV2ZXJ5dGhpbmcgc28gZmFyOyBhbiBJU08gc3RyaW5nIHRyYWlscyBhIGZpeGVkIHdpbmRvdy5cclxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xyXG4gICAgaWYgKGR1cmF0aW9uU3BlYyA9PT0gbnVsbCB8fCBkdXJhdGlvblNwZWMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xyXG4gICAgfVxyXG4gICAgY29uc3QgcCA9IGR1cmF0aW9uU3BlYyA9PT0gXCJwZXJpb2RcIiA/IHBlcmlvZCA6IHBhcnNlUGVyaW9kKGR1cmF0aW9uU3BlYyk7XHJcbiAgICBpZiAoIXApIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xyXG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xyXG59XHJcblxyXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxyXG4vLyBwZXJpb2QgdGhhdCBlbmRzIHRoZXJlLCBhbmQgbmV2ZXIgdG8gdHdvIG5laWdoYm91cmluZyB0aWNrcyBhdCBvbmNlLiBOYU4gdGltZXMgbWFya1xyXG4vLyBmZWF0dXJlcyB0aGF0IGNhcnJpZWQgbm8gcmVhZGFibGUgdGltZTsgdGhleSBzdGF5IHZpc2libGUgcmF0aGVyIHRoYW4gdmFuaXNoaW5nLlxyXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcclxuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnRNcykpIHJldHVybiB0cnVlO1xyXG4gICAgcmV0dXJuIGVuZE1zID4gd2luLnN0YXJ0ICYmIHN0YXJ0TXMgPD0gd2luLmVuZDtcclxufVxyXG5cclxuLy8gVGltZXMgdHJhdmVsIGFzIGEgRmxvYXQ2NEFycmF5IG9mIGludGVybGVhdmVkIFtzdGFydCwgZW5kXSBwYWlycyBpbiB0aGUgYnVmZmVyIG1hcCxcclxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXHJcbmV4cG9ydCBmdW5jdGlvbiB0aW1lc0ZvcihsYXllciwgYnVmZmVycykge1xyXG4gICAgY29uc3QgcmF3ID0gYnVmZmVycyAmJiBidWZmZXJzW2Ake2xheWVyLmlkfTo6dGltZXNgXTtcclxuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcclxuICAgIHJldHVybiBuZXcgRmxvYXQ2NEFycmF5KHJhdy5idWZmZXIgfHwgcmF3LCByYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xyXG59XHJcblxyXG4vLyBXaGF0IHJlbmRlcmluZyB0aHJlYWRzIHRocm91Z2g6IHRoZSBjdXJyZW50IHRpY2sgcGx1cyB0aGUgc2hhcmVkIHBlcmlvZCwgb3IgbnVsbCB3aGVuXHJcbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xyXG4vLyBwZXIgbGF5ZXIgd2hpbGUgdGhlIHRpY2sgaXMgc2hhcmVkLlxyXG4vL1xyXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcclxuLy8gZ2VvbWV0cnkgcGVyIGxheWVyLCBzbyB0aGV5IGFyZSBpbiBvciBvdXQgYXMgYSB1bml0OyBhIGxheWVyIHdpdGggbm8gdGltZSBtZXRhZGF0YSBpc1xyXG4vLyBub3QgdGhlIHNsaWRlcidzIHRvIGhpZGUuXHJcbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcclxuLy8gZ2VzdHVyZSBhbmQgb3V0cmFua3MgZXZlcnkgbGF5ZXIncyBjb25maWd1cmVkIGR1cmF0aW9uIHdoaWxlIGl0IGlzIGFjdGl2ZSAtLSB3aGVuIHRoZVxyXG4vLyB1c2VyIGdyYWJzIHRoZSBiYXIsIHRoZSBiYXIgdGVsbHMgdGhlIHRydXRoIGZvciBldmVyeXRoaW5nLiBTbmFwcGluZyB0aGUgaGFuZGxlIGJhY2tcclxuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXHJcbmV4cG9ydCBmdW5jdGlvbiBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSB7XHJcbiAgICByZXR1cm4gdGltZVN0YXRlLndpbmRvdyB8fCAobGF5ZXIudGltZSAmJiBsYXllci50aW1lLmR1cmF0aW9uKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGxheWVySW5XaW5kb3cobGF5ZXIsIGJ1ZmZlcnMsIHRpbWVTdGF0ZSkge1xyXG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xyXG4gICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihsYXllciwgYnVmZmVycyk7XHJcbiAgICBpZiAoIXRpbWVzIHx8IHRpbWVzLmxlbmd0aCA8IDIpIHJldHVybiB0cnVlO1xyXG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICAvLyBBIHBlci12ZXJ0ZXgtdGltZWQgbGluZSBob2xkcyBtYW55IHBhaXJzOyBvbiB0aGlzIHdob2xlLWxheWVyIHBhdGggaXQgc2hvd3NcclxuICAgIC8vIHdoaWxlIEFOWSBvZiB0aGVtIGlzIGluIHRoZSB3aW5kb3cgLS0gdGhlIEdQVSBwYXRoIGlzIHdoYXQgdHJpbXMgcGVyIHNlZ21lbnQuXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgaWYgKGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICAgIHJldHVybiBmYWxzZTtcclxufVxyXG5cclxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RUaW1lRXh0ZW50KGxheWVycywgYnVmZmVycykge1xyXG4gICAgbGV0IG1pbiA9IEluZmluaXR5LCBtYXggPSAtSW5maW5pdHk7XHJcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xyXG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsYXllci5sYXllcnMgfHwgW10pO1xyXG4gICAgICAgIGlmICghbGF5ZXIudGltZSkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgICAgIGlmICghdGltZXMpIHJldHVybjtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKHRpbWVzW2ldIDwgbWluKSBtaW4gPSB0aW1lc1tpXTtcclxuICAgICAgICAgICAgaWYgKHRpbWVzW2kgKyAxXSA+IG1heCkgbWF4ID0gdGltZXNbaSArIDFdO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgdmlzaXQobGF5ZXJzKTtcclxuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XHJcbiAgICByZXR1cm4gbGF5ZXJzLnNvbWUobCA9PiBsLnR5cGUgPT09IFwiZ3JvdXBcIlxyXG4gICAgICAgID8gaGFzVGltZUxheWVycyhsLmxheWVycyB8fCBbXSlcclxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XHJcbn1cclxuXHJcbi8vIE9uZSBwbGF5YmFjayBzdGVwOiB0aGUgbmV4dCBpbmRleCBhbmQgd2hldGhlciBwbGF5YmFjayBzdXJ2aXZlcyBpdC4gUHVyZSBzbyB0aGUgbG9vcFxyXG4vLyBzZW1hbnRpY3MgYXJlIHRlc3RhYmxlIHdpdGhvdXQgYSB0aW1lciAtLSBsb29waW5nIHdyYXBzIGFuZCBrZWVwcyBwbGF5aW5nLCB0aGUgZW5kXHJcbi8vIHdpdGhvdXQgbG9vcCBzdG9wcyB3aGVyZSBpdCBpcy5cclxuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2UoaW5kZXgsIGxlbmd0aCwgbG9vcCkge1xyXG4gICAgaWYgKGluZGV4IDwgbGVuZ3RoIC0gMSkgcmV0dXJuIHsgaW5kZXg6IGluZGV4ICsgMSwgcGxheWluZzogdHJ1ZSB9O1xyXG4gICAgaWYgKGxvb3ApIHJldHVybiB7IGluZGV4OiAwLCBwbGF5aW5nOiB0cnVlIH07XHJcbiAgICByZXR1cm4geyBpbmRleCwgcGxheWluZzogZmFsc2UgfTtcclxufVxyXG5cclxuLy8gV2hlcmUgdGhlIGNvbnRyb2wgc2l0cywgYXMgaW5saW5lIHN0eWxlcyBzbyB0aGUgY2hvaWNlIHRyYXZlbHMgd2l0aCB0aGUgc3RhdGUgcmF0aGVyXHJcbi8vIHRoYW4gbmVlZGluZyBhIHN0eWxlc2hlZXQgcnVsZSBwZXIgY29ybmVyLiBFdmVyeSBwcm9wZXJ0eSBpcyB3cml0dGVuIG9uIGV2ZXJ5IHJlbmRlciAtLVxyXG4vLyBpbmNsdWRpbmcgdGhlIG9uZXMgYSBwb3NpdGlvbiBkb2VzIG5vdCB1c2UgLS0gc28gbW92aW5nIHRoZSBjb250cm9sIGNsZWFycyB0aGUgb2xkXHJcbi8vIGFuY2hvciBpbnN0ZWFkIG9mIGFjY3VtdWxhdGluZyBib3RoLlxyXG5leHBvcnQgY29uc3QgUE9TSVRJT05TID0ge1xyXG4gICAgXCJ0b3AtbGVmdFwiOiAgICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJcIiB9LFxyXG4gICAgXCJ0b3AtY2VudGVyXCI6ICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxyXG4gICAgXCJ0b3AtcmlnaHRcIjogICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxyXG4gICAgXCJsZWZ0LWNlbnRlclwiOiAgIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxyXG4gICAgXCJyaWdodC1jZW50ZXJcIjogIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxyXG4gICAgXCJib3R0b20tbGVmdFwiOiAgIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJcIiB9LFxyXG4gICAgXCJib3R0b20tY2VudGVyXCI6IHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxyXG4gICAgXCJib3R0b20tcmlnaHRcIjogIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxyXG59O1xyXG5cclxuZnVuY3Rpb24gYXBwbHlQb3NpdGlvbihlbCwgcG9zaXRpb24pIHtcclxuICAgIGNvbnN0IHN0eWxlcyA9IFBPU0lUSU9OU1twb3NpdGlvbl0gfHwgUE9TSVRJT05TW1widG9wLWNlbnRlclwiXTtcclxuICAgIGZvciAoY29uc3QgW3Byb3AsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzdHlsZXMpKSB7XHJcbiAgICAgICAgZWwuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0VVRDKG1zKSB7XHJcbiAgICByZXR1cm4gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTkpLnJlcGxhY2UoXCJUXCIsIFwiIFwiKSArIFwiWlwiO1xyXG59XHJcblxyXG4vLyAtLS0gdGhlIHdpbmRvdyBhbmQgdGhlIHJ1bGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4vLyBGaXhlZCBtaWxsaXNlY29uZHMgZm9yIGEgcGVyaW9kLCBvciBudWxsIHdoZW4gaXQgbW92ZXMgdGhyb3VnaCB0aGUgY2FsZW5kYXIgKG1vbnRocyxcclxuLy8geWVhcnMpIGFuZCBoYXMgbm8gZml4ZWQgd2lkdGguIFRoZSBydWxlciBhbmQgdGhlIGRyYWcgZ3JpZCBuZWVkIGZpeGVkIHdpZHRoczsgY2FsZW5kYXJcclxuLy8gcGVyaW9kcyBmYWxsIGJhY2sgdG8gdGhlIHRpY2sgcG9zaXRpb25zIHRoZW1zZWx2ZXMuXHJcbmV4cG9ydCBmdW5jdGlvbiBwZXJpb2RUb01zKHApIHtcclxuICAgIGlmICghcCB8fCBwLnllYXJzIHx8IHAubW9udGhzKSByZXR1cm4gbnVsbDtcclxuICAgIHJldHVybiAoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMCArIHAuaG91cnMgKiAzNjAwXHJcbiAgICAgICAgKyBwLm1pbnV0ZXMgKiA2MCArIHAuc2Vjb25kcykgKiAxMDAwO1xyXG59XHJcblxyXG4vLyBNaWxsaXNlY29uZHMgYXMgYW4gSVNPODYwMSBkdXJhdGlvbiwgaG91cnMvbWludXRlcy9zZWNvbmRzIG9ubHkgLS0gUFQyNkggaXMgdmFsaWQgYW5kXHJcbi8vIGF2b2lkcyBjYWxlbmRhciB1bml0cyBlbnRpcmVseSwgc28gd2hhdCB0aGUgZHJhZyB3cml0ZXMgYWx3YXlzIHBhcnNlcyBiYWNrIGV4YWN0bHkuXHJcbmV4cG9ydCBmdW5jdGlvbiBtc1RvUGVyaW9kSVNPKG1zKSB7XHJcbiAgICBsZXQgcmVzdCA9IE1hdGgucm91bmQobXMgLyAxMDAwKTtcclxuICAgIGNvbnN0IGggPSBNYXRoLmZsb29yKHJlc3QgLyAzNjAwKTsgcmVzdCAtPSBoICogMzYwMDtcclxuICAgIGNvbnN0IG0gPSBNYXRoLmZsb29yKHJlc3QgLyA2MCk7IHJlc3QgLT0gbSAqIDYwO1xyXG4gICAgbGV0IG91dCA9IFwiUFRcIjtcclxuICAgIGlmIChoKSBvdXQgKz0gYCR7aH1IYDtcclxuICAgIGlmIChtKSBvdXQgKz0gYCR7bX1NYDtcclxuICAgIGlmIChyZXN0IHx8IG91dCA9PT0gXCJQVFwiKSBvdXQgKz0gYCR7cmVzdH1TYDtcclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIFRoZSBydWxlcidzIGluY3JlbWVudDogdGhlIGxhcmdlc3Qgc3RlcCB0aGF0IGxhbmRzIG9uIGV2ZXJ5IGJvdW5kYXJ5IHRoZSB1c2VyIGNhbiBjYXJlXHJcbi8vIGFib3V0IC0tIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZCBkdXJhdGlvbi4gQW4gaW50ZXJ2YWwgb2YgMWggd2l0aCBhXHJcbi8vIDIuNWggZHVyYXRpb24gbmVlZHMgMzAtbWludXRlIG1hcmtzIGZvciB0aGUgZHVyYXRpb24gdG8gc2l0IG9uIG9uZTsgMWggYW5kIDJoIG5lZWQgb25seVxyXG4vLyB0aGUgaG91cnMuIFwiTG93ZXN0IGR1cmF0aW9uXCIgaXMgdGhlIHNwZWNpYWwgY2FzZSB3aGVyZSBvbmUgZGl2aWRlcyB0aGUgb3RoZXIuXHJcbmV4cG9ydCBmdW5jdGlvbiBnY2RHcmlkTXMocGVyaW9kTXMsIGR1cmF0aW9uc01zKSB7XHJcbiAgICBjb25zdCBnY2QgPSAoYSwgYikgPT4gKGIgPyBnY2QoYiwgYSAlIGIpIDogYSk7XHJcbiAgICBsZXQgZ3JpZCA9IHBlcmlvZE1zO1xyXG4gICAgZm9yIChjb25zdCBkIG9mIGR1cmF0aW9uc01zKSB7XHJcbiAgICAgICAgaWYgKGQgPiAwKSBncmlkID0gZ2NkKGdyaWQsIE1hdGgucm91bmQoZCkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIE1hdGgubWF4KGdyaWQsIDEwMDApO1xyXG59XHJcblxyXG4vLyBFdmVyeSBmaW5pdGUgZHVyYXRpb24gYXR0YWNoZWQgdG8gYSB0aW1lIGxheWVyLCBpbiBtcywgZm9yIHRoZSBncmlkLiBcInBlcmlvZFwiIGFuZCBudWxsXHJcbi8vIGNvbnRyaWJ1dGUgbm90aGluZyBuZXc7IGNhbGVuZGFyIGR1cmF0aW9ucyBjYW5ub3Qgam9pbiBhIGZpeGVkLW1zIGdyaWQgYW5kIGFyZSBza2lwcGVkLlxyXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdER1cmF0aW9uc01zKGxheWVycywgd2luZG93SXNvKSB7XHJcbiAgICBjb25zdCBvdXQgPSBbXTtcclxuICAgIGNvbnN0IHZpc2l0ID0gbGlzdCA9PiBsaXN0LmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobC5sYXllcnMgfHwgW10pO1xyXG4gICAgICAgIGNvbnN0IHNwZWMgPSBsLnRpbWUgJiYgbC50aW1lLmR1cmF0aW9uO1xyXG4gICAgICAgIGlmICh0eXBlb2Ygc3BlYyA9PT0gXCJzdHJpbmdcIiAmJiBzcGVjICE9PSBcInBlcmlvZFwiKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzcGVjKSk7XHJcbiAgICAgICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgdmlzaXQobGF5ZXJzKTtcclxuICAgIGlmICh3aW5kb3dJc28pIHtcclxuICAgICAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qod2luZG93SXNvKSk7XHJcbiAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBUaWNrIG1hcmtzIGZvciB0aGUgdHJhY2s6IG1ham9ycyBhdCBldmVyeSBpbnRlcnZhbCBib3VuZGFyeSAoc3BhcnNlbHkgbGFiZWxsZWQgc28gbG9uZ1xyXG4vLyB0aW1lbGluZXMgc3RheSByZWFkYWJsZSksIHVubGFiZWxsZWQgbWlub3JzIGF0IHRoZSBncmlkIGluIGJldHdlZW4uIE1pbm9yIERJU1BMQVkgaXNcclxuLy8gdGhpbm5lZCB3aGVuIGRlbnNlOyB0aGUgc25hcCBncmlkIHN0YXlzIGV4YWN0LCBzbyBhIG1hcmsgaXMgYSBndWlkZSwgbm90IGEgY29uc3RyYWludC5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUnVsZXIodGlja3MsIGdyaWRNcywgZm9ybWF0TGFiZWwsIHsgbWF4TGFiZWxzID0gNiwgbWF4TWlub3JzID0gMjQwIH0gPSB7fSkge1xyXG4gICAgaWYgKHRpY2tzLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcclxuICAgIGNvbnN0IHQwID0gdGlja3NbMF0sIHNwYW4gPSB0aWNrc1t0aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xyXG4gICAgY29uc3QgbWFya3MgPSBbXTtcclxuICAgIGNvbnN0IGxhYmVsRXZlcnkgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodGlja3MubGVuZ3RoIC8gbWF4TGFiZWxzKSk7XHJcbiAgICB0aWNrcy5mb3JFYWNoKCh0LCBpKSA9PiBtYXJrcy5wdXNoKHtcclxuICAgICAgICBmcmFjdGlvbjogKHQgLSB0MCkgLyBzcGFuLCBtYWpvcjogdHJ1ZSxcclxuICAgICAgICBsYWJlbDogaSAlIGxhYmVsRXZlcnkgPT09IDAgPyBmb3JtYXRMYWJlbCh0KSA6IG51bGwsXHJcbiAgICB9KSk7XHJcbiAgICBpZiAoZ3JpZE1zICYmIGdyaWRNcyA8IHNwYW4pIHtcclxuICAgICAgICBjb25zdCB0b3RhbCA9IE1hdGguZmxvb3Ioc3BhbiAvIGdyaWRNcyk7XHJcbiAgICAgICAgY29uc3QgdGhpbiA9IE1hdGgubWF4KDEsIE1hdGguY2VpbCh0b3RhbCAvIG1heE1pbm9ycykpO1xyXG4gICAgICAgIGZvciAobGV0IGsgPSAxOyBrICogZ3JpZE1zIDwgc3BhbjsgayArPSB0aGluKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHQgPSB0MCArIGsgKiBncmlkTXM7XHJcbiAgICAgICAgICAgIGlmICh0aWNrcy5pbmNsdWRlcyh0KSkgY29udGludWU7XHJcbiAgICAgICAgICAgIG1hcmtzLnB1c2goeyBmcmFjdGlvbjogKHQgLSB0MCkgLyBzcGFuLCBtYWpvcjogZmFsc2UsIGxhYmVsOiBudWxsIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBtYXJrcztcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFRpY2tMYWJlbChtcywgcGVyaW9kTXMpIHtcclxuICAgIGNvbnN0IGlzbyA9IG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpO1xyXG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCA2MCAqIDEwMDApIHJldHVybiBpc28uc2xpY2UoMTEsIDE5KTtcclxuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgMjQgKiAzNjAwICogMTAwMCkgcmV0dXJuIGlzby5zbGljZSgxMSwgMTYpO1xyXG4gICAgcmV0dXJuIGlzby5zbGljZSg1LCAxMCk7XHJcbn1cclxuXHJcbi8vIEdseXBocyBhcyBpbmxpbmUgU1ZHIHJhdGhlciB0aGFuIHRleHQ6IFwiXHUyMUJCXCIgcmVhZHMgYXMgcmVmcmVzaCAtLSBhIGxvb3AgdG9nZ2xlIGRyYXduIHdpdGhcclxuLy8gaXQgbG9va3MgbGlrZSBhIHJlc2V0IGJ1dHRvbiwgd2hpY2ggaXMgZXhhY3RseSBob3cgaXQgZ290IG1pc3JlYWQuIGN1cnJlbnRDb2xvciBsZXRzXHJcbi8vIHRoZSBwcmVzc2VkIHN0YXRlIHJlc3R5bGUgdGhlbSBmcm9tIENTUy5cclxuY29uc3QgSUNPTlMgPSB7XHJcbiAgICBiYWNrOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNMyAyaDJ2MTJIM3pNMTMgMiA2IDhsNyA2elwiLz48L3N2Zz4nLFxyXG4gICAgcGxheTogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTQgMmw5IDYtOSA2elwiLz48L3N2Zz4nLFxyXG4gICAgcGF1c2U6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJoM3YxMkg0ek05IDJoM3YxMkg5elwiLz48L3N2Zz4nLFxyXG4gICAgZndkOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNMTEgMmgydjEyaC0yek0zIDJsNyA2LTcgNnpcIi8+PC9zdmc+JyxcclxuICAgIGxvb3A6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk04IDJhNiA2IDAgMCAxIDUuNjUgNEgxNmwtMi44IDMuNUwxMC40IDZoMi4xQTQuNSA0LjUgMCAxIDAgMTIuNSAxMGwxLjMuNzVBNiA2IDAgMSAxIDggMnpcIi8+PC9zdmc+JyxcclxufTtcclxuXHJcbi8vIC0tLSB0aGUgY29udHJvbCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBQbGFpbiBET00gaW5zaWRlIHRoZSB3aWRnZXQgY29udGFpbmVyLCBsaWtlIHRoZSBzaWRlYmFyOiBubyBMZWFmbGV0IGNvbnRyb2wgbWFjaGluZXJ5LFxyXG4vLyB3aGljaCBrZWVwcyBpdCB0ZXN0YWJsZSBpbiBqc2RvbSBhbmQgc3R5bGVhYmxlIGZyb20gbWFwLmNzcy4gVGhlIGxheW91dCBmb2xsb3dzXHJcbi8vIExlYWZsZXQuVGltZURpbWVuc2lvbidzIGNvbnRyb2wgLS0gc3RlcC9wbGF5L3N0ZXAvbG9vcCBhcyBhIGpvaW5lZCBidXR0b24gYmFyLCB0aGVuIHRoZVxyXG4vLyBkYXRlLCBzbGlkZXIgYW5kIHNwZWVkIC0tIHNpbmNlIHRoYXQgaXMgdGhlIHNsaWRlciB1c2VycyBvZiB0aGUgZm9saXVtIGFwcHMga25vdy5cclxuLy9cclxuLy8gVGhlIHNsaWRlciBpcyBhIGNvbXBvc2l0ZS4gQSBuYXRpdmUgPGlucHV0IHR5cGU9cmFuZ2U+IHN0YXlzIG9uIHRvcCBhcyB0aGUgdGh1bWI6IGl0XHJcbi8vIGtlZXBzIGtleWJvYXJkIGFycm93cywgc2NyZWVuIHJlYWRlcnMgYW5kIGV2ZXJ5IGV4aXN0aW5nIHRlc3Qgd29ya2luZywgYW5kIHBsYXliYWNrXHJcbi8vIGRyaXZlcyBpdCBhcyBiZWZvcmUuIFVuZGVybmVhdGggc2l0IHRoZSBwYXJ0cyBhIG5hdGl2ZSBpbnB1dCBjYW5ub3QgZHJhdzogdGhlIHdpbmRvd1xyXG4vLyBzcGFuIHNob3dpbmcgZXhhY3RseSB3aGF0IGludGVydmFsIGlzIG9uIHRoZSBtYXAsIGEgcnVsZXIgd2l0aCBsYWJlbGxlZCBpbnRlcnZhbCBtYXJrc1xyXG4vLyBhbmQgdW5sYWJlbGxlZCBnY2QgbWlub3JzLCBhbmQgdGhlIHRyYWlsIGhhbmRsZSAtLSBkcmFnIGl0IGJhY2sgdG8gd2lkZW4gdGhlIHdpbmRvdyBmb3JcclxuLy8gZXZlcnkgbGF5ZXIgYXQgb25jZSwgZHJvcCBpdCBvbnRvIHRoZSB0aHVtYiB0byBoYW5kIGNvbnRyb2wgYmFjayB0byBwZXItbGF5ZXIgZHVyYXRpb25zLlxyXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyVGltZUNvbnRyb2woY29udGFpbmVyLCBzdGF0ZSwgaGFuZGxlcnMpIHtcclxuICAgIGxldCBlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtY29udHJvbFwiKTtcclxuICAgIGlmICghc3RhdGUudGlja3MgfHwgc3RhdGUudGlja3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgaWYgKGVsKSBlbC5yZW1vdmUoKTtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmICghZWwpIHtcclxuICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgZWwuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLWNvbnRyb2xcIjtcclxuICAgICAgICBlbC5pbm5lckhUTUwgPSBgXHJcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1idXR0b25zXCI+XHJcbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1iYWNrXCIgdGl0bGU9XCJTdGVwIGJhY2tcIiBhcmlhLWxhYmVsPVwiU3RlcCBiYWNrXCI+JHtJQ09OUy5iYWNrfTwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtcGxheVwiIGFyaWEtbGFiZWw9XCJQbGF5XCI+JHtJQ09OUy5wbGF5fTwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtZndkXCIgdGl0bGU9XCJTdGVwIGZvcndhcmRcIiBhcmlhLWxhYmVsPVwiU3RlcCBmb3J3YXJkXCI+JHtJQ09OUy5md2R9PC9idXR0b24+XHJcbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sb29wXCIgYXJpYS1sYWJlbD1cIkxvb3BcIj4ke0lDT05TLmxvb3B9PC9idXR0b24+XHJcbiAgICAgICAgICAgIDwvc3Bhbj5cclxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxhYmVsXCI+PC9zcGFuPlxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtdHJhY2tcIj5cclxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1iYXNlXCI+PC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwYW5cIj48L3NwYW4+XHJcbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtcnVsZXJcIj48L3NwYW4+XHJcbiAgICAgICAgICAgICAgICA8aW5wdXQgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNsaWRlclwiIHR5cGU9XCJyYW5nZVwiIG1pbj1cIjBcIiBzdGVwPVwiMVwiPlxyXG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWlsXCIgcm9sZT1cInNsaWRlclwiIHRhYmluZGV4PVwiMFwiXHJcbiAgICAgICAgICAgICAgICAgICAgICBhcmlhLWxhYmVsPVwiVHJhaWxpbmcgd2luZG93XCIgdGl0bGU9XCJEcmFnIGJhY2sgdG8gd2lkZW4gdGhlIHRpbWUgd2luZG93OyBkcm9wIG9uIHRoZSB0aHVtYiB0byBjbGVhclwiPjwvc3Bhbj5cclxuICAgICAgICAgICAgPC9zcGFuPlxyXG4gICAgICAgICAgICA8c2VsZWN0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGVlZFwiIHRpdGxlPVwiUGxheWJhY2sgc3BlZWRcIj5cclxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIwLjVcIj4wLjV4PC9vcHRpb24+XHJcbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMVwiPjF4PC9vcHRpb24+XHJcbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMlwiPjJ4PC9vcHRpb24+XHJcbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiNFwiPjR4PC9vcHRpb24+XHJcbiAgICAgICAgICAgIDwvc2VsZWN0PmA7XHJcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGVsKTtcclxuXHJcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWJhY2tcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEJhY2spO1xyXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1md2RcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEZvcndhcmQpO1xyXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblBsYXlUb2dnbGUpO1xyXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vbkxvb3BUb2dnbGUpO1xyXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsXHJcbiAgICAgICAgICAgIGUgPT4gaGFuZGxlcnMub25TcGVlZChwYXJzZUZsb2F0KGUudGFyZ2V0LnZhbHVlKSkpO1xyXG4gICAgICAgIGNvbnN0IHNsaWRlciA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIik7XHJcbiAgICAgICAgLy8gYGlucHV0YCBmaXJlcyBwZXIgZHJhZyBzdGVwIGZvciBsaXZlIHNjcnViYmluZzsgdGhlIG1vZGVsIHdyaXRlYmFjayBpcyB0aGVcclxuICAgICAgICAvLyBoYW5kbGVyJ3MgcHJvYmxlbSwgdGhyb3R0bGVkIHRoZXJlIHNvIGRyYWdnaW5nIGRvZXMgbm90IGZsb29kIHRoZSBrZXJuZWwuXHJcbiAgICAgICAgc2xpZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBlID0+IGhhbmRsZXJzLm9uU2VlayhwYXJzZUludChlLnRhcmdldC52YWx1ZSwgMTApKSk7XHJcblxyXG4gICAgICAgIGF0dGFjaFRyYWlsRHJhZyhlbCwgaGFuZGxlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikubWF4ID0gU3RyaW5nKHN0YXRlLnRpY2tzLmxlbmd0aCAtIDEpO1xyXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5pbmRleCk7XHJcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbGFiZWxcIikudGV4dENvbnRlbnQgPSBmb3JtYXRVVEMoc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdKTtcclxuXHJcbiAgICBjb25zdCBwbGF5ID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXBsYXlcIik7XHJcbiAgICBwbGF5LmlubmVySFRNTCA9IHN0YXRlLnBsYXlpbmcgPyBJQ09OUy5wYXVzZSA6IElDT05TLnBsYXk7XHJcbiAgICBwbGF5LnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiKTtcclxuICAgIHBsYXkudGl0bGUgPSBzdGF0ZS5wbGF5aW5nID8gXCJQYXVzZVwiIDogXCJQbGF5XCI7XHJcblxyXG4gICAgLy8gQSBtb2RlLCBub3QgYW4gYWN0aW9uOiBwcmVzc2VkIHN0eWxpbmcgYW5kIGFyaWEtcHJlc3NlZCBzYXkgXCJ0aGlzIHN0YXlzIG9uXCIsXHJcbiAgICAvLyB3aGVyZSBhIGJhcmUgaWNvbiBpbnZpdGVkIGEgY2xpY2sgZXhwZWN0aW5nIHNvbWV0aGluZyB0byBoYXBwZW4gcmlnaHQgbm93LlxyXG4gICAgY29uc3QgbG9vcCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpO1xyXG4gICAgbG9vcC5jbGFzc0xpc3QudG9nZ2xlKFwiYWN0aXZlXCIsIEJvb2xlYW4oc3RhdGUubG9vcCkpO1xyXG4gICAgbG9vcC5zZXRBdHRyaWJ1dGUoXCJhcmlhLXByZXNzZWRcIiwgU3RyaW5nKEJvb2xlYW4oc3RhdGUubG9vcCkpKTtcclxuICAgIGxvb3AudGl0bGUgPSBzdGF0ZS5sb29wID8gXCJMb29wOiBvblwiIDogXCJMb29wOiBvZmZcIjtcclxuXHJcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuc3BlZWQgfHwgMSk7XHJcbiAgICByZW5kZXJUcmFjayhlbCwgc3RhdGUpO1xyXG4gICAgYXBwbHlQb3NpdGlvbihlbCwgc3RhdGUucG9zaXRpb24pO1xyXG4gICAgcmV0dXJuIGVsO1xyXG59XHJcblxyXG4vLyBHZW9tZXRyeSBzaGFyZWQgYnkgcmVuZGVyaW5nIGFuZCBkcmFnZ2luZzogd2hlcmUgYSB0aW1lIHNpdHMgb24gdGhlIHRyYWNrLCAwLi4xLlxyXG5mdW5jdGlvbiB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0KSB7XHJcbiAgICBjb25zdCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0aWNrc1swXTtcclxuICAgIGlmIChzcGFuIDw9IDApIHJldHVybiAxO1xyXG4gICAgcmV0dXJuIE1hdGgubWluKDEsIE1hdGgubWF4KDAsICh0IC0gdGlja3NbMF0pIC8gc3BhbikpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJUcmFjayhlbCwgc3RhdGUpIHtcclxuICAgIGNvbnN0IHsgdGlja3MsIGluZGV4IH0gPSBzdGF0ZTtcclxuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xyXG4gICAgdHJhY2suX3N0YXRlID0gc3RhdGU7ICAgICAgLy8gdGhlIGRyYWcgaGFuZGxlciByZWFkcyB0aGUgZnJlc2hlc3Qgc3RhdGUgZnJvbSBoZXJlXHJcblxyXG4gICAgY29uc3QgdGh1bWJUID0gdGlja3NbaW5kZXhdO1xyXG4gICAgY29uc3QgcGVyaW9kTXMgPSBzdGF0ZS5wZXJpb2RNcztcclxuICAgIGNvbnN0IHdpbmRvd01zID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IG51bGw7XHJcbiAgICBjb25zdCBzaG93bk1zID0gd2luZG93TXMgIT0gbnVsbCA/IHdpbmRvd01zIDogcGVyaW9kTXM7XHJcblxyXG4gICAgLy8gVGhlIHNwYW46IHdoYXQgaW50ZXJ2YWwgdGhlIG1hcCBpcyBzaG93aW5nIHJpZ2h0IG5vdy4gVGhlIHNwYW4gZGVwaWN0cyB0aGUgc2hhcmVkXHJcbiAgICAvLyB3aW5kb3cgLS0gb25lIHBlcmlvZCBieSBkZWZhdWx0IC0tIGFuZCBwZXItbGF5ZXIgZHVyYXRpb25zIHJlbWFpbiBhbiBBUEkgY29uY2VyblxyXG4gICAgLy8gdW50aWwgYSBkcmFnIG92ZXJyaWRlcyB0aGVtIGZvciBldmVyeXRoaW5nIGF0IG9uY2UuXHJcbiAgICBjb25zdCBzcGFuID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwYW5cIik7XHJcbiAgICBjb25zdCByaWdodCA9IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCk7XHJcbiAgICBjb25zdCBsZWZ0ID0gc2hvd25NcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gc2hvd25NcykgOiAwO1xyXG4gICAgc3Bhbi5zdHlsZS5sZWZ0ID0gYCR7KGxlZnQgKiAxMDApLnRvRml4ZWQoMil9JWA7XHJcbiAgICBzcGFuLnN0eWxlLndpZHRoID0gYCR7KE1hdGgubWF4KDAsIHJpZ2h0IC0gbGVmdCkgKiAxMDApLnRvRml4ZWQoMil9JWA7XHJcbiAgICBzcGFuLmNsYXNzTGlzdC50b2dnbGUoXCJvdmVycmlkZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcclxuXHJcbiAgICAvLyBUaGUgdHJhaWwgaGFuZGxlIHBhcmtzIE9OIHRoZSB0aHVtYiB3aGVuIG5vIG92ZXJyaWRlIGlzIGFjdGl2ZSAtLSBcIm5vdCBncmFiYmVkXCIgLS1cclxuICAgIC8vIGFuZCBzaXRzIGF0IHRoZSB3aW5kb3cncyBzdGFydCB3aGlsZSBvbmUgaXMuIERyb3BwaW5nIGl0IGJhY2sgb24gdGhlIHRodW1iIGNsZWFycy5cclxuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xyXG4gICAgY29uc3QgYXQgPSB3aW5kb3dNcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gd2luZG93TXMpIDogcmlnaHQ7XHJcbiAgICB0cmFpbC5zdHlsZS5sZWZ0ID0gYCR7KGF0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xyXG4gICAgdHJhaWwuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcclxuICAgIHRyYWlsLnNldEF0dHJpYnV0ZShcImFyaWEtdmFsdWV0ZXh0XCIsIHN0YXRlLndpbmRvdyB8fCBcIm5vIHRyYWlsaW5nIHdpbmRvd1wiKTtcclxuICAgIC8vIE5vIGZpeGVkLW1zIGdyaWQgKGNhbGVuZGFyIHBlcmlvZHMpIG1lYW5zIG5vdGhpbmcgc2Vuc2libGUgdG8gc25hcCB0by5cclxuICAgIHRyYWlsLnN0eWxlLmRpc3BsYXkgPSBzdGF0ZS5ncmlkTXMgPyBcIlwiIDogXCJub25lXCI7XHJcblxyXG4gICAgY29uc3QgcnVsZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcnVsZXJcIik7XHJcbiAgICBjb25zdCBrZXkgPSBgJHt0aWNrc1swXX18JHt0aWNrcy5sZW5ndGh9fCR7c3RhdGUuZ3JpZE1zfXwke3BlcmlvZE1zfWA7XHJcbiAgICBpZiAocnVsZXIuX2tleSAhPT0ga2V5KSB7XHJcbiAgICAgICAgcnVsZXIuX2tleSA9IGtleTtcclxuICAgICAgICBydWxlci5pbm5lckhUTUwgPSBcIlwiO1xyXG4gICAgICAgIGZvciAoY29uc3QgbWFyayBvZiBidWlsZFJ1bGVyKHRpY2tzLCBzdGF0ZS5ncmlkTXMsIHQgPT4gZm9ybWF0VGlja0xhYmVsKHQsIHBlcmlvZE1zKSkpIHtcclxuICAgICAgICAgICAgY29uc3QgbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgICAgICBtLmNsYXNzTmFtZSA9IG1hcmsubWFqb3IgPyBcInN3aWZ0bWFwLXRpbWUtbWFyayBtYWpvclwiIDogXCJzd2lmdG1hcC10aW1lLW1hcmtcIjtcclxuICAgICAgICAgICAgbS5zdHlsZS5sZWZ0ID0gYCR7KG1hcmsuZnJhY3Rpb24gKiAxMDApLnRvRml4ZWQoMil9JWA7XHJcbiAgICAgICAgICAgIGlmIChtYXJrLmxhYmVsKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsYWIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICAgICAgICAgIGxhYi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXRpbWUtbWFyay1sYWJlbFwiO1xyXG4gICAgICAgICAgICAgICAgbGFiLnRleHRDb250ZW50ID0gbWFyay5sYWJlbDtcclxuICAgICAgICAgICAgICAgIG0uYXBwZW5kQ2hpbGQobGFiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBydWxlci5hcHBlbmRDaGlsZChtKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIERyYWdnaW5nIHRoZSB0cmFpbCBoYW5kbGUuIFNuYXBzIHRvIHRoZSBnY2QgZ3JpZCBzbyBldmVyeSBzdG9wIGlzIGEgYm91bmRhcnkgdGhlIGRhdGFcclxuLy8gb3IgdGhlIGludGVydmFsIGFjdHVhbGx5IG5hbWVzOyB0aGUgZGlzdGFuY2UgdG8gdGhlIHRodW1iLCBpbiB3aG9sZSBncmlkIHN0ZXBzLCBJUyB0aGVcclxuLy8gd2luZG93LiBaZXJvIHN0ZXBzIC0tIGRyb3BwZWQgb24gdGhlIHRodW1iIC0tIGNsZWFycyB0aGUgb3ZlcnJpZGUuXHJcbmZ1bmN0aW9uIGF0dGFjaFRyYWlsRHJhZyhlbCwgaGFuZGxlcnMpIHtcclxuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xyXG4gICAgY29uc3QgdHJhaWwgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhaWxcIik7XHJcblxyXG4gICAgZnVuY3Rpb24gaXNvRnJvbUV2ZW50KGV2KSB7XHJcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XHJcbiAgICAgICAgY29uc3QgcmVjdCA9IHRyYWNrLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcyB8fCByZWN0LndpZHRoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgIC8vIERlbGliZXJhdGVseSB1bmNsYW1wZWQgb24gdGhlIGxlZnQ6IHRoZSB3aW5kb3cgaXMgXCJob3cgZmFyIGJhY2sgZnJvbSB0aGVcclxuICAgICAgICAvLyBsZWFkIHBvaW50XCIsIGFuZCB0aGF0IG1heSByZWFjaCBwYXN0IHRoZSBiYXIncyBzdGFydCAtLSBlc3BlY2lhbGx5IHdoZW4gdGhlXHJcbiAgICAgICAgLy8gbGVhZCBzaXRzIGVhcmx5IG9uIHRoZSBiYXIgYW5kIG1vc3Qgb2YgaXRzIHRyYWlsIGlzIG9mZi1zY3JlZW4uIENsYW1waW5nIGhlcmVcclxuICAgICAgICAvLyBjYXBwZWQgdGhlIHdpbmRvdyBhdCB0aGUgdmlzaWJsZSBwYXN0LCB3aGljaCBwaW5uZWQgdGhlIGhhbmRsZSB0byB0aGUgYmFyJ3NcclxuICAgICAgICAvLyBzdGFydCBhbmQgbWFkZSBhbnl0aGluZyB3aWRlciBpbXBvc3NpYmxlIHRvIHNldC4gT25seSB0aGUgRFJBV0lORyBjbGFtcHMuXHJcbiAgICAgICAgY29uc3QgZnJhYyA9IE1hdGgubWluKDEsIChldi5jbGllbnRYIC0gcmVjdC5sZWZ0KSAvIHJlY3Qud2lkdGgpO1xyXG4gICAgICAgIGNvbnN0IHQwID0gc3RhdGUudGlja3NbMF07XHJcbiAgICAgICAgY29uc3Qgc3Bhbk1zID0gc3RhdGUudGlja3Nbc3RhdGUudGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcclxuICAgICAgICBjb25zdCB0aHVtYlQgPSBzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF07XHJcbiAgICAgICAgY29uc3QgZGlzdCA9IHRodW1iVCAtICh0MCArIGZyYWMgKiBzcGFuTXMpO1xyXG4gICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5tYXgoMCwgTWF0aC5yb3VuZChkaXN0IC8gc3RhdGUuZ3JpZE1zKSk7XHJcbiAgICAgICAgcmV0dXJuIHN0ZXBzID09PSAwID8gbnVsbCA6IG1zVG9QZXJpb2RJU08oc3RlcHMgKiBzdGF0ZS5ncmlkTXMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIE1vdmUgYW5kIHJlbGVhc2UgbGlzdGVuIG9uIHRoZSBkb2N1bWVudCBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBkcmFnOiB0aGUgaGFuZGxlXHJcbiAgICAvLyBpcyAxMnB4IHdpZGUsIHRoZSBjdXJzb3IgbGVhdmVzIGl0IG9uIHRoZSBmaXJzdCBmYXN0IG1vdmVtZW50LCBhbmQgZXZlbnRzIHRoYXRcclxuICAgIC8vIHRhcmdldCB3aGF0ZXZlciBpcyB1bmRlcm5lYXRoIHdvdWxkIHN0dXR0ZXIgdGhlIGRyYWcgYW5kIGNvdWxkIHN3YWxsb3cgdGhlIHJlbGVhc2VcclxuICAgIC8vIGVudGlyZWx5IC0tIGFuIHVuY29tbWl0dGVkIGRyYWcgdGhlbiBzbmFwcyBiYWNrIG9uIHRoZSBuZXh0IHN5bmMuXHJcbiAgICB0cmFpbC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgZXYgPT4ge1xyXG4gICAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgLy8gQ2FwdHVyZSByZXRhcmdldHMgZXZlcnkgcG9pbnRlciBldmVudCB0byB0aGUgaGFuZGxlIHVudGlsIHJlbGVhc2UsIG5vIG1hdHRlclxyXG4gICAgICAgIC8vIHdoZXJlIHRoZSBjdXJzb3IgaXMuIFdpdGhvdXQgaXQsIGxldHRpbmcgZ28gd2l0aCB0aGUgcG9pbnRlciBvdmVyIHRoZSBtYXAgaGFuZHNcclxuICAgICAgICAvLyBwb2ludGVydXAgdG8gTGVhZmxldCdzIGNvbnRhaW5lciBoYW5kbGVycywgYW5kIGEgcmVsZWFzZSB0aGV5IHN3YWxsb3cgbmV2ZXJcclxuICAgICAgICAvLyByZWFjaGVzIHRoZSBkb2N1bWVudCBsaXN0ZW5lciAtLSB0aGUgZHJhZyBzdGF5cyB1bmNvbW1pdHRlZCBhbmQgdGhlIG5leHQgc3luY1xyXG4gICAgICAgIC8vIHNuYXBzIHRoZSBoYW5kbGUgaG9tZS4gVGhlIGRvY3VtZW50IGxpc3RlbmVycyBiZWxvdyByZW1haW4gYXMgdGhlIGZhbGxiYWNrIGZvclxyXG4gICAgICAgIC8vIGVudmlyb25tZW50cyB3aXRob3V0IGNhcHR1cmU7IHdpdGggaXQsIHJldGFyZ2V0ZWQgZXZlbnRzIHN0aWxsIGJ1YmJsZSB0byB0aGVtLlxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmICh0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZSkgdHJhaWwuc2V0UG9pbnRlckNhcHR1cmUoZXYucG9pbnRlcklkKTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogc3ludGhldGljIGV2ZW50cyBoYXZlIG5vIGFjdGl2ZSBwb2ludGVyOyBmYWxsIGJhY2sgdG8gYnViYmxpbmcgKi8gfVxyXG5cclxuICAgICAgICBjb25zdCBtb3ZlID0gZSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcclxuICAgICAgICAgICAgaWYgKGlzbyAhPT0gdW5kZWZpbmVkKSBoYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGNvbnN0IGZpbmlzaCA9IGUgPT4ge1xyXG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XHJcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgZmluaXNoKTtcclxuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcclxuICAgICAgICAgICAgY29uc3QgaXNvID0gaXNvRnJvbUV2ZW50KGUpO1xyXG4gICAgICAgICAgICBpZiAoaXNvICE9PSB1bmRlZmluZWQpIGhhbmRsZXJzLm9uV2luZG93Q29tbWl0KGlzbyk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XHJcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xyXG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBLZXlib2FyZDogb25lIGdyaWQgc3RlcCBwZXIgYXJyb3csIERlbGV0ZS9Ib21lIHRvIGNsZWFyLiBTYW1lIGNvbnRyYWN0IGFzIHRoZSBkcmFnLlxyXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgZXYgPT4ge1xyXG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xyXG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcykgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IGN1cnJlbnQgPSBzdGF0ZS53aW5kb3cgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHN0YXRlLndpbmRvdykpIDogMDtcclxuICAgICAgICBsZXQgbmV4dDtcclxuICAgICAgICBpZiAoZXYua2V5ID09PSBcIkFycm93TGVmdFwiKSBuZXh0ID0gY3VycmVudCArIHN0YXRlLmdyaWRNcztcclxuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiQXJyb3dSaWdodFwiKSBuZXh0ID0gTWF0aC5tYXgoMCwgY3VycmVudCAtIHN0YXRlLmdyaWRNcyk7XHJcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkRlbGV0ZVwiIHx8IGV2LmtleSA9PT0gXCJIb21lXCIpIG5leHQgPSAwO1xyXG4gICAgICAgIGVsc2UgcmV0dXJuO1xyXG4gICAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgaGFuZGxlcnMub25XaW5kb3dDb21taXQobmV4dCA+IDAgPyBtc1RvUGVyaW9kSVNPKG5leHQpIDogbnVsbCk7XHJcbiAgICB9KTtcclxufVxyXG4iLCAiLy8gVGltZSBmaWx0ZXJpbmcgb24gdGhlIEdQVSwgZm9yIHBvaW50IGxheWVycy5cclxuLy9cclxuLy8gVGhlIGNvb3JkaW5hdGVzIGFscmVhZHkgbGl2ZSBpbiBHUFUgYnVmZmVyczsgcmVidWlsZGluZyB0aGUgbWVyZ2VkIGxheWVyIHBlciB0aWNrIHRocmV3XHJcbi8vIHRoYXQgYXdheSBhbmQgcmUtZmVkIGdsaWZ5IGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUyAtLSBtZWFzdXJlZCBhdCB+Mi42cyBwZXIgd2luZG93XHJcbi8vIGNoYW5nZSBhdCB0aGF0IHNjYWxlLCB3aXRoIGFsbG9jYXRpb24gY2h1cm4gdGhhdCBjb3VsZCBjcmFzaCB0aGUgdGFiIHdoZW4gY2hhbmdlc1xyXG4vLyBzdGFja2VkLiBJbnN0ZWFkLCBlYWNoIHBvaW50J3MgdGltZSBpbnRlcnZhbCBhbmQgaXRzIGxheWVyJ3MgZHVyYXRpb24gcmlkZSBhbG9uZyBhc1xyXG4vLyB2ZXJ0ZXggYXR0cmlidXRlcyB1cGxvYWRlZCBvbmNlLCBhbmQgdGhlIGN1cnJlbnQgdGljayBpcyBhIHVuaWZvcm06IGEgdGljayBvciB3aW5kb3dcclxuLy8gY2hhbmdlIGNvc3RzIHR3byBmbG9hdHMgYW5kIGEgcmVkcmF3LlxyXG4vL1xyXG4vLyBnbGlmeSBtYWtlcyB0aGlzIHBvc3NpYmxlIHdpdGhvdXQgZm9ya2luZyBpdDogdmVydGV4U2hhZGVyU291cmNlIGlzIGFuIG92ZXJyaWRhYmxlXHJcbi8vIHNldHRpbmcgKHRoZSBwaW4gZnJhZ21lbnQgc2hhZGVyIGFscmVhZHkgdXNlcyB0aGUgc2FtZSBkb29yKSwgaW5zdGFuY2VzIGV4cG9zZSB0aGVpclxyXG4vLyBnbC9wcm9ncmFtL2NhbnZhcywgYXR0cmlidXRlcyBhcmUgYm91bmQgb25jZSBhdCBzZXR1cCwgYW5kIHRoZSBwZXItZnJhbWUgZHJhdyB0b3VjaGVzXHJcbi8vIG9ubHkgdGhlIG1hdHJpeCB1bmlmb3JtIC0tIHNvIGV4dHJhIGF0dHJpYnV0ZXMgYm91bmQgYWZ0ZXIgc2V0dXAgcGVyc2lzdCwgYW5kIHVuaWZvcm1cclxuLy8gdXBkYXRlcyB0YWtlIGVmZmVjdCBvbiB0aGUgbmV4dCByZWRyYXcuXHJcbmltcG9ydCB7IHBhcnNlUGVyaW9kLCBwZXJpb2RUb01zLCB0aW1lc0ZvciB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XHJcblxyXG4vLyBUaW1lcyB0cmF2ZWwgYXMgZmxvYXQzMiBvbiB0aGUgR1BVLCB3aG9zZSBpbnRlZ2VycyBhcmUgZXhhY3Qgb25seSB0byAyXjI0LiBFcG9jaCBtcyBpc1xyXG4vLyBob3BlbGVzcyBhdCB0aGF0IHByZWNpc2lvbiwgc28gdGltZXMgYXJlIHJlYmFzZWQgdG8gdGhlIGJ1Y2tldCdzIGVhcmxpZXN0IHN0YXJ0IGFuZFxyXG4vLyBleHByZXNzZWQgaW4gc2Vjb25kczogZXhhY3QgdG8gfjE5NCBkYXlzIG9mIHNwYW4sIGFuZCBhIDJzIHJvdW5kaW5nIGJleW9uZCB0aGF0IGlzXHJcbi8vIGludmlzaWJsZSBhdCBhbnkgem9vbSBhIHRpbWUgc2xpZGVyIG1ha2VzIHNlbnNlIGF0LlxyXG5jb25zdCBBTFdBWVMgPSA2LjNlODsgICAvLyB+MjAgeWVhcnMsIGluIHNlY29uZHM6IHRoZSBcImR1cmF0aW9uXCIgb2YgY3VtdWxhdGl2ZSBsYXllcnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB0aGUgc3BhbiBoYWxmLXdpZHRoIG9mIHBvaW50cyB3aXRoIG5vIHJlYWRhYmxlIHRpbWUuXHJcblxyXG4vLyBQZXItYnVja2V0IGxheWVyLXZpc2liaWxpdHkgc2xvdHMgaW4gdGhlIHZlcnRleCBzaGFkZXIuIEVhY2ggZmxvYXQgYXJyYXkgZWxlbWVudFxyXG4vLyBvY2N1cGllcyBhIGZ1bGwgdW5pZm9ybSB2ZWN0b3IgaW4gRVMgR0xTTCBwYWNraW5nLCBhbmQgdGhlIHNwZWMgZ3VhcmFudGVlcyBvbmx5IDEyOFxyXG4vLyB2ZXJ0ZXggdW5pZm9ybSB2ZWN0b3JzIC0tIDY0IHNsb3RzIGxlYXZlcyBjb21mb3J0YWJsZSByb29tIGZvciB0aGUgbWF0cml4IGFuZCB0aGUgdGltZVxyXG4vLyB1bmlmb3Jtcy4gQSBidWNrZXQgd2l0aCBtb3JlIGxheWVycyB0aGFuIHNsb3RzIGZhbGxzIGJhY2sgdG8gcmVidWlsZC1wZXItdG9nZ2xlLlxyXG4vLyAoUGFja2luZyBmb3VyIGxheWVycyBwZXIgdmVjNCB3b3VsZCBxdWFkcnVwbGUgdGhpcyBpZiBhbnlvbmUgZXZlciBuZWVkcyBpdC4pXHJcbmV4cG9ydCBjb25zdCBMQVlFUl9TTE9UUyA9IDY0O1xyXG5cclxuLy8gQ2hlYXAga2lsbCBzd2l0Y2hlczogaWYgd2lyaW5nIHRoZSBHTCBzdGF0ZSBldmVyIGZhaWxzIChhIGZ1dHVyZSBnbGlmeSB2ZXJzaW9uIG1vdmluZ1xyXG4vLyBpdHMgaW50ZXJuYWxzKSwgdGhlIGFmZmVjdGVkIGZhbWlseSBmYWxscyBiYWNrIHRvIHRoZSBDUFUgcmVidWlsZCBwYXRoLiBQb2ludHMgYW5kXHJcbi8vIHZlY3RvcnMgYXJlIHNlcGFyYXRlIGZsYWdzIC0tIGEgdmVjdG9yIGludHJvc3BlY3Rpb24gZmFpbHVyZSBtdXN0IG5vdCBjb3N0IHBvaW50c1xyXG4vLyB0aGVpciBHUFUgcGF0aC5cclxubGV0IGdwdU9rID0gdHJ1ZTtcclxuZXhwb3J0IGZ1bmN0aW9uIGdwdVRpbWVBdmFpbGFibGUoKSB7IHJldHVybiBncHVPazsgfVxyXG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZUdwdVRpbWUocmVhc29uKSB7XHJcbiAgICBpZiAoZ3B1T2spIGNvbnNvbGUud2FybihgW1N3aWZ0TWFwXSBHUFUgdGltZSBmaWx0ZXJpbmcgZGlzYWJsZWQ6ICR7cmVhc29ufS4gYCArXHJcbiAgICAgICAgYEZhbGxpbmcgYmFjayB0byByZWJ1aWxkLXBlci10aWNrLmApO1xyXG4gICAgZ3B1T2sgPSBmYWxzZTtcclxufVxyXG5sZXQgdmVjdG9yR3B1T2sgPSB0cnVlO1xyXG5leHBvcnQgZnVuY3Rpb24gdmVjdG9yR3B1QXZhaWxhYmxlKCkgeyByZXR1cm4gdmVjdG9yR3B1T2s7IH1cclxuZXhwb3J0IGZ1bmN0aW9uIGRpc2FibGVWZWN0b3JHcHUocmVhc29uKSB7XHJcbiAgICBpZiAodmVjdG9yR3B1T2spIGNvbnNvbGUud2FybihgW1N3aWZ0TWFwXSBHUFUgdGltZSBmb3IgbGluZXMvcG9seWdvbnMgZGlzYWJsZWQ6IGAgK1xyXG4gICAgICAgIGAke3JlYXNvbn0uIEZhbGxpbmcgYmFjayB0byByZWJ1aWxkLXBlci10aWNrIGZvciB0aG9zZSBidWNrZXRzLmApO1xyXG4gICAgdmVjdG9yR3B1T2sgPSBmYWxzZTtcclxufVxyXG5cclxuLy8gVGhlIGRlZmF1bHQgcG9pbnRzIHZlcnRleCBzaGFkZXIgKHJlYWQgb3V0IG9mIGxlYWZsZXQuZ2xpZnkgMy4zLjApIHdpdGggdGhlIHdpbmRvd1xyXG4vLyB0ZXN0IGFkZGVkLiBBIGhpZGRlbiBwb2ludCBnZXRzIHNpemUgMCBhbmQgYSBwb3NpdGlvbiBvdXRzaWRlIGNsaXAgc3BhY2UsIHNvIG5laXRoZXJcclxuLy8gdGhlIHZpc2libGUgcGFzcyBub3IgdGhlIHNoYXJlZC1wcm9ncmFtIHBpY2tpbmcgcGFzcyBldmVyIHJhc3RlcmlzZXMgaXQuXHJcbmV4cG9ydCBmdW5jdGlvbiB0aW1lVmVydGV4U2hhZGVyKCkge1xyXG4gICAgcmV0dXJuIGB1bmlmb3JtIG1hdDQgbWF0cml4O1xyXG5hdHRyaWJ1dGUgdmVjNCB2ZXJ0ZXg7XHJcbmF0dHJpYnV0ZSB2ZWM0IGNvbG9yO1xyXG5hdHRyaWJ1dGUgZmxvYXQgcG9pbnRTaXplO1xyXG5hdHRyaWJ1dGUgdmVjMiBhVGltZVNwYW47XHJcbmF0dHJpYnV0ZSBmbG9hdCBhRHVyYXRpb247XHJcbmF0dHJpYnV0ZSBmbG9hdCBhTGF5ZXI7XHJcbnVuaWZvcm0gZmxvYXQgdVRpY2s7XHJcbnVuaWZvcm0gZmxvYXQgdU92ZXJyaWRlO1xyXG51bmlmb3JtIGZsb2F0IHVMYXllclZpc1ske0xBWUVSX1NMT1RTfV07XHJcbnZhcnlpbmcgdmVjNCBfY29sb3I7XHJcblxyXG52b2lkIG1haW4oKSB7XHJcbiAgLy8gQSBuZWdhdGl2ZSBkdXJhdGlvbiBpcyB0aGUgZmFkZSBmbGFnOiB8YUR1cmF0aW9ufCBpcyB0aGUgd2luZG93LCB0aGUgc2lnbiBzYXlzIHRoaXNcclxuICAvLyBwb2ludCBkaW1zIHdpdGggYWdlLiBBIHNoYXJlZCBvdmVycmlkZSBrZWVwcyB0aGUgcG9pbnQncyBvd24gZmFkZSBwcmVmZXJlbmNlLlxyXG4gIGJvb2wgZmFkZXMgPSBhRHVyYXRpb24gPCAwLjA7XHJcbiAgZmxvYXQgZHVyID0gdU92ZXJyaWRlID49IDAuMCA/IHVPdmVycmlkZSA6IGFicyhhRHVyYXRpb24pO1xyXG4gIC8vIEhhbGYtb3BlbiAodGljayAtIGR1ciwgdGlja10sIG1hdGNoaW5nIGZlYXR1cmVJbldpbmRvdyBvbiB0aGUgQ1BVIHNpZGUgLS0gQU5EZWQgd2l0aFxyXG4gIC8vIHRoZSBwb2ludCdzIGxheWVyIGJlaW5nIHZpc2libGUuIExheWVyIHRvZ2dsZXMgYXJlIG9uZSB1bmlmb3JtIGVsZW1lbnQsIG5vdCBhXHJcbiAgLy8gcmVidWlsZDogdW5jaGVja2luZyBvbmUgb2YgMjUgdHJhY2tzIHVzZWQgdG8gcmUtZmVlZCBhbGwgNU0gcG9pbnRzIHRocm91Z2ggSlMuXHJcbiAgYm9vbCB2aXNpYmxlID0gYVRpbWVTcGFuLnkgPiAodVRpY2sgLSBkdXIpICYmIGFUaW1lU3Bhbi54IDw9IHVUaWNrXHJcbiAgICAgICYmIHVMYXllclZpc1tpbnQoYUxheWVyKV0gPiAwLjU7XHJcbiAgZ2xfUG9pbnRTaXplID0gdmlzaWJsZSA/IHBvaW50U2l6ZSA6IDAuMDtcclxuICBnbF9Qb3NpdGlvbiA9IHZpc2libGUgPyBtYXRyaXggKiB2ZXJ0ZXggOiB2ZWM0KDIuMCwgMi4wLCAyLjAsIDEuMCk7XHJcbiAgLy8gQWdlIHJ1bnMgZnJvbSB0aGUgZmVhdHVyZSdzIGVuZDsgbmV3ZXN0IGlzIG9wYXF1ZSwgdGhlIHRyYWlsaW5nIGVkZ2UgcmVhY2hlcyB6ZXJvLlxyXG4gIGZsb2F0IGFscGhhID0gZmFkZXMgPyBjbGFtcCgxLjAgLSAodVRpY2sgLSBhVGltZVNwYW4ueSkgLyBkdXIsIDAuMCwgMS4wKSA6IDEuMDtcclxuICBfY29sb3IgPSB2ZWM0KGNvbG9yLnJnYiwgY29sb3IuYSAqIGFscGhhKTtcclxufVxyXG5gO1xyXG59XHJcblxyXG4vLyBQZXItbGF5ZXIgZHVyYXRpb24gaW4gc2Vjb25kczogbnVsbCBhY2N1bXVsYXRlcywgXCJwZXJpb2RcIiBpcyB0aGUgc2hhcmVkIGludGVydmFsLFxyXG4vLyBhbiBJU08gc3RyaW5nIGlzIGl0c2VsZjsgYW55dGhpbmcgdW5wYXJzZWFibGUgZmFsbHMgYmFjayB0byB0aGUgaW50ZXJ2YWwuXHJcbmZ1bmN0aW9uIGR1cmF0aW9uU2Vjb25kcyhzcGVjLCBwZXJpb2RNcykge1xyXG4gICAgaWYgKHNwZWMgPT09IG51bGwgfHwgc3BlYyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gQUxXQVlTO1xyXG4gICAgaWYgKHNwZWMgPT09IFwicGVyaW9kXCIpIHJldHVybiAocGVyaW9kTXMgfHwgMjQgKiAzNjAwICogMTAwMCkgLyAxMDAwO1xyXG4gICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcclxuICAgIHJldHVybiBtcyA/IG1zIC8gMTAwMCA6IChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XHJcbn1cclxuXHJcbi8vIEJ1aWxkcyB0aGUgcGVyLXBvaW50IGF0dHJpYnV0ZSBhcnJheXMgZm9yIG9uZSBtZXJnZWQgYnVja2V0LCBpbiB0aGUgZXhhY3Qgb3JkZXIgdGhlXHJcbi8vIGJ1Y2tldCBmZWVkcyBwb2ludHMgdG8gZ2xpZnk6IGxheWVyIGJ5IGxheWVyLCBpbmRleCAwLi5uLTEsIHdpdGggc2luZ2xlLWBsb2NhdGlvbmBcclxuLy8gbGF5ZXJzIGNvbnRyaWJ1dGluZyBvbmUgcG9pbnQuIFBvaW50cyBpbiBsYXllcnMgd2l0aG91dCB0aW1lIG1ldGFkYXRhIC0tIGFuZCBwb2ludHNcclxuLy8gd2hvc2UgdGltZSB3YXMgdW5yZWFkYWJsZSAoTmFOKSAtLSBnZXQgYSBzcGFuIHRoYXQgaXMgdmlzaWJsZSBhdCBldmVyeSB0aWNrLlxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRUaW1lQXR0cmlidXRlcyhsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcclxuICAgIGxldCB0b3RhbCA9IDA7XHJcbiAgICBsZXQgaGFzVGltZSA9IGZhbHNlO1xyXG4gICAgY29uc3QgcGVyTGF5ZXIgPSBbXTtcclxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGJ1ZiA/IGJ1Zi5ieXRlTGVuZ3RoIC8gMTYgOiAobGF5ZXIubG9jYXRpb24gPyAxIDogMCk7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XHJcbiAgICAgICAgaWYgKGxheWVyLnRpbWUpIGhhc1RpbWUgPSB0cnVlO1xyXG4gICAgICAgIHBlckxheWVyLnB1c2goeyBsYXllciwgY291bnQsIHRpbWVzIH0pO1xyXG4gICAgICAgIHRvdGFsICs9IGNvdW50O1xyXG4gICAgfVxyXG4gICAgaWYgKCFoYXNUaW1lKSByZXR1cm4geyBoYXNUaW1lOiBmYWxzZSB9O1xyXG5cclxuICAgIGxldCBiYXNlID0gSW5maW5pdHk7XHJcbiAgICBmb3IgKGNvbnN0IHsgdGltZXMgfSBvZiBwZXJMYXllcikge1xyXG4gICAgICAgIGlmICghdGltZXMpIGNvbnRpbnVlO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4odGltZXNbaV0pICYmIHRpbWVzW2ldIDwgYmFzZSkgYmFzZSA9IHRpbWVzW2ldO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChiYXNlID09PSBJbmZpbml0eSkgYmFzZSA9IDA7XHJcblxyXG4gICAgY29uc3Qgc3BhbnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsICogMik7XHJcbiAgICBjb25zdCBkdXJzID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBjb25zdCBsYXllcklkeCA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xyXG4gICAgY29uc3QgbGF5ZXJJZHMgPSBbXTtcclxuICAgIGxldCBvdXQgPSAwO1xyXG4gICAgZm9yIChjb25zdCB7IGxheWVyLCBjb3VudCwgdGltZXMgfSBvZiBwZXJMYXllcikge1xyXG4gICAgICAgIGNvbnN0IGlkeCA9IGxheWVySWRzLmxlbmd0aDtcclxuICAgICAgICBsYXllcklkcy5wdXNoKGxheWVyLmlkKTtcclxuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcclxuICAgICAgICAvLyBUaGUgZmFkZSBmbGFnIHJpZGVzIHRoZSBkdXJhdGlvbidzIHNpZ24sIHNvIGl0IGNvc3RzIG5vIGV4dHJhIGF0dHJpYnV0ZS5cclxuICAgICAgICAvLyBUaW1lbGVzcyAoTmFOKSBwb2ludHMga2VlcCBhIHBvc2l0aXZlIGR1cmF0aW9uOiB3aXRoIG5vIGFnZSwgbm90aGluZyB0byBmYWRlLlxyXG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcclxuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyXSA6IE5hTjtcclxuICAgICAgICAgICAgY29uc3QgZW5kID0gdGltZXMgPyB0aW1lc1tpICogMiArIDFdIDogTmFOO1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSkge1xyXG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSAtQUxXQVlTO1xyXG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gQUxXQVlTO1xyXG4gICAgICAgICAgICAgICAgZHVyc1tvdXRdID0gQUxXQVlTO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSAoc3RhcnQgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSAoZW5kIC0gYmFzZSkgLyAxMDAwO1xyXG4gICAgICAgICAgICAgICAgZHVyc1tvdXRdID0gc2lnbmVkRHVyO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxheWVySWR4W291dF0gPSBpZHg7XHJcbiAgICAgICAgICAgIG91dCsrO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiB7IGhhc1RpbWU6IHRydWUsIGJhc2UsIHNwYW5zLCBkdXJzLCBsYXllcklkeCwgbGF5ZXJJZHMsIGNvdW50OiB0b3RhbCB9O1xyXG59XHJcblxyXG4vLyBQZXItZmVhdHVyZSB0aW1lIG1ldGFkYXRhIGZvciBhIHZlY3RvciBidWNrZXQgKGxpbmVzL3BvbHlnb25zKS4gU2FtZSBlbmNvZGluZ3MgYXNcclxuLy8gdGhlIHBvaW50IHBhdGggLS0gcmViYXNlZCBmbG9hdDMyIHNlY29uZHMsIHNpZ24tcGFja2VkIGZhZGUsIGFsd2F5cy12aXNpYmxlIHNwYW5zXHJcbi8vIGZvciB0aW1lbGVzcyBvciBub24tdGltZSBsYXllcnMuXHJcbi8vXHJcbi8vIEEgcG9seWxpbmUgd2hvc2UgOjp0aW1lcyBidWZmZXIgaG9sZHMgb25lIFtzdGFydCwgZW5kXSBwYWlyIFBFUiBWRVJURVggYW5pbWF0ZXNcclxuLy8gcGVyIHNlZ21lbnQgd2l0aGluIG9uZSBsYXllcjogc2VnbWVudCBrIHNwYW5zIHZlcnRleCBrJ3Mgc3RhcnQgdG8gdmVydGV4IGsrMSdzXHJcbi8vIGVuZCwgYW5kIGJlY2F1c2UgZ2xpZnkgYnVpbGRzIDIgZGVkaWNhdGVkIEdMIHZlcnRpY2VzIHBlciBzZWdtZW50IC0tIHNlZ21lbnRzXHJcbi8vIG5ldmVyIHNoYXJlIHZlcnRpY2VzIC0tIGJvdGggZW5kcG9pbnRzIGNhcnJ5IHRoZSBzYW1lIHNwYW4gYW5kIHNlZ21lbnRzIGFwcGVhclxyXG4vLyBhdG9taWNhbGx5LiBUaGF0IGlzIHdoYXQgbGV0cyBhIHdob2xlIHNlZ21lbnRlZCB0cmFjayByaWRlIE9ORSBsYXllciBzbG90IHRoZSB3YXlcclxuLy8gYSAyMDBrLXBvaW50IGxheWVyIGRvZXMsIGluc3RlYWQgb2Ygb25lIHNsb3QgcGVyIGNodW5rIGFnYWluc3QgdGhlIDY0IGNlaWxpbmcuXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xyXG4gICAgaWYgKCFsYXllcnNMaXN0LnNvbWUobCA9PiBsLnRpbWUpKSByZXR1cm4geyBoYXNUaW1lOiBmYWxzZSB9O1xyXG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcclxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xyXG4gICAgICAgIGlmICghdGltZXMpIGNvbnRpbnVlO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4odGltZXNbaV0pICYmIHRpbWVzW2ldIDwgYmFzZSkgYmFzZSA9IHRpbWVzW2ldO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChiYXNlID09PSBJbmZpbml0eSkgYmFzZSA9IDA7XHJcblxyXG4gICAgY29uc3QgcGVyRmVhdHVyZSA9IGxheWVyc0xpc3QubWFwKChsYXllciwgaWR4KSA9PiB7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XHJcbiAgICAgICAgY29uc3Qgc2lnbmVkRHVyID0gbGF5ZXIudGltZSAmJiBsYXllci50aW1lLmZhZGUgPyAtZHVyIDogZHVyO1xyXG4gICAgICAgIGlmICghdGltZXMgfHwgKHRpbWVzLmxlbmd0aCA9PT0gMiAmJiBOdW1iZXIuaXNOYU4odGltZXNbMF0pKSkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdGFydDogLUFMV0FZUywgZW5kOiBBTFdBWVMsIGR1cjogQUxXQVlTLCBpZHggfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgblZlcnRzID0gdmVydGV4Q291bnRPZihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlsaW5lXCIgJiYgdGltZXMubGVuZ3RoID4gMlxyXG4gICAgICAgICAgICAgICAgJiYgdGltZXMubGVuZ3RoID09PSBuVmVydHMgKiAyKSB7XHJcbiAgICAgICAgICAgIC8vIFNlZ21lbnRzIG5ldmVyIGNyb3NzIGEgcGFydCBib3VuZGFyeTogYSBtdWx0aS1wYXJ0IGxpbmUgZHJhd3NcclxuICAgICAgICAgICAgLy8gblZlcnRzIC0gcGFydHMgc2VnbWVudHMsIGFuZCBhIHNwYW4gYnVpbHQgZnJvbSBvbmUgcGFydCdzIGxhc3RcclxuICAgICAgICAgICAgLy8gdmVydGV4IHRvIHRoZSBuZXh0IHBhcnQncyBmaXJzdCB3b3VsZCBiZSB0aGUgcGhhbnRvbSBzZWdtZW50XHJcbiAgICAgICAgICAgIC8vIHJlYXBwZWFyaW5nIGluIHRoZSB0aW1lIHBhdGggLS0gb25lIGV4dHJhIHNwYW4sIGFuZCBldmVyeSBhdHRyaWJ1dGVcclxuICAgICAgICAgICAgLy8gYWZ0ZXIgaXQgc2hlYXJzICh0aGUgbGVuZ3RoIGNoZWNrIHRoZW4gZHJvcHMgdGhlIHdob2xlIGZlYXR1cmUgdG9cclxuICAgICAgICAgICAgLy8gaXRzIG92ZXJhbGwgc3BhbikuIFdhbGsgdGhlIHBhcnRzIHRoZSB3YXkgdGhlIHJlbmRlcmVyIGRyYXdzIHRoZW0uXHJcbiAgICAgICAgICAgIGNvbnN0IGxlbmd0aHMgPSBBcnJheS5pc0FycmF5KGxheWVyLnBhcnRzKSAmJiBsYXllci5wYXJ0cy5sZW5ndGggPiAxXHJcbiAgICAgICAgICAgICAgICA/IGxheWVyLnBhcnRzIDogW25WZXJ0c107XHJcbiAgICAgICAgICAgIGNvbnN0IHNlZ3MgPSBsZW5ndGhzLnJlZHVjZSgoYSwgbikgPT4gYSArIE1hdGgubWF4KDAsIG4gLSAxKSwgMCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHNlZyA9IG5ldyBGbG9hdDY0QXJyYXkoc2VncyAqIDIpO1xyXG4gICAgICAgICAgICBsZXQgayA9IDAsIG9mZnNldCA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbiBvZiBsZW5ndGhzKSB7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGxldCBqID0gMDsgaiArIDEgPCBuOyBqKyspIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzID0gdGltZXNbKG9mZnNldCArIGopICogMl07XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZSA9IHRpbWVzWyhvZmZzZXQgKyBqICsgMSkgKiAyICsgMV07XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTihzKSB8fCBOdW1iZXIuaXNOYU4oZSkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VnW2sgKiAyXSA9IC1BTFdBWVM7ICAgICAgLy8gYW4gdW5yZWFkYWJsZSB0aW1lIG5ldmVyIGhpZGVzIGRhdGFcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VnW2sgKiAyICsgMV0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VnW2sgKiAyXSA9IChzIC0gYmFzZSkgLyAxMDAwO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDIgKyAxXSA9IChlIC0gYmFzZSkgLyAxMDAwO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBrKys7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBvZmZzZXQgKz0gbjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBPdmVyYWxsIHNwYW4gcmlkZXMgYWxvbmcgYXMgdGhlIGZhbGxiYWNrIGlmIGNvdW50cyBldmVyIG1pc2FsaWduLlxyXG4gICAgICAgICAgICByZXR1cm4geyBzZWcsIHN0YXJ0OiBzZWdbMF0sIGVuZDogc2VnW3NlZy5sZW5ndGggLSAxXSxcclxuICAgICAgICAgICAgICAgICAgICAgZHVyOiBzaWduZWREdXIsIGlkeCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4geyBzdGFydDogKHRpbWVzWzBdIC0gYmFzZSkgLyAxMDAwLCBlbmQ6ICh0aW1lc1sxXSAtIGJhc2UpIC8gMTAwMCxcclxuICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB7IGhhc1RpbWU6IHRydWUsIGJhc2UsIHBlckZlYXR1cmUsIGxheWVySWRzOiBsYXllcnNMaXN0Lm1hcChsID0+IGwuaWQpIH07XHJcbn1cclxuXHJcbi8vIEEgdmVjdG9yIGxheWVyJ3MgdmVydGV4IGNvdW50IGZyb20gd2hpY2hldmVyIHRyYW5zcG9ydCBjYXJyaWVzIGl0cyBjb29yZGluYXRlczpcclxuLy8gdGhlIGJpbmFyeSBidWZmZXIgKDIgZmxvYXQ2NCBwZXIgdmVydGV4KSBvciBpbmxpbmUgYGxvY2F0aW9uc2AuXHJcbmZ1bmN0aW9uIHZlcnRleENvdW50T2YobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICBjb25zdCByYXcgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICBpZiAocmF3KSByZXR1cm4gKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGggfHwgMCkgLyAxNjtcclxuICAgIHJldHVybiAobGF5ZXIubG9jYXRpb25zIHx8IFtdKS5sZW5ndGg7XHJcbn1cclxuXHJcbi8vIEV4cGFuZHMgcGVyLWZlYXR1cmUgdmFsdWVzIHRvIHBlci1HTC12ZXJ0ZXggYXJyYXlzIGdpdmVuIGVhY2ggZmVhdHVyZSdzIHZlcnRleCBjb3VudC5cclxuLy8gUHVyZSwgc28gdGhlIGFsaWdubWVudCBsb2dpYyBpcyB0aWVyLTEgdGVzdGFibGUgYXdheSBmcm9tIGFueSBHTCBjb250ZXh0LlxyXG5leHBvcnQgZnVuY3Rpb24gZXhwYW5kUGVyRmVhdHVyZShwZXJGZWF0dXJlLCBjb3VudHMpIHtcclxuICAgIGxldCB0b3RhbCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IGMgb2YgY291bnRzKSB0b3RhbCArPSBjO1xyXG4gICAgY29uc3Qgc3BhbnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsICogMik7XHJcbiAgICBjb25zdCBkdXJzID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBjb25zdCBsYXllcklkeCA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xyXG4gICAgbGV0IG91dCA9IDA7XHJcbiAgICBwZXJGZWF0dXJlLmZvckVhY2goKGYsIGkpID0+IHtcclxuICAgICAgICAvLyBQZXItc2VnbWVudCBzcGFuczogR0wgdmVydGV4IHYgYmVsb25ncyB0byBzZWdtZW50IHYgPj4gMSAoZ2xpZnkgZHJhd3NcclxuICAgICAgICAvLyAyIGRlZGljYXRlZCB2ZXJ0aWNlcyBwZXIgc2VnbWVudCksIHNvIGJvdGggZW5kcG9pbnRzIHRha2UgdGhlIHNlZ21lbnQnc1xyXG4gICAgICAgIC8vIHNwYW4gYW5kIGEgc2VnbWVudCBhcHBlYXJzIG9yIGRpc2FwcGVhcnMgYXRvbWljYWxseS4gc2VnIGhvbGRzIHNlZ3MqMlxyXG4gICAgICAgIC8vIGZsb2F0cyBhbmQgdGhlIGZlYXR1cmUgZHJhd3Mgc2VncyoyIEdMIHZlcnRpY2VzLCBzbyB0aGUgbGVuZ3RocyBhZ3JlZWluZ1xyXG4gICAgICAgIC8vIGlzIHRoZSBhbGlnbm1lbnQgY2hlY2s7IGEgbWlzbWF0Y2ggZmFsbHMgYmFjayB0byB0aGUgd2hvbGUtZmVhdHVyZSBzcGFuXHJcbiAgICAgICAgLy8gcmF0aGVyIHRoYW4gc2hlYXJpbmcgZXZlcnkgYXR0cmlidXRlIGFmdGVyIGl0LlxyXG4gICAgICAgIGNvbnN0IHBlclNlZ21lbnQgPSBmLnNlZyAmJiBmLnNlZy5sZW5ndGggPT09IGNvdW50c1tpXSA/IGYuc2VnIDogbnVsbDtcclxuICAgICAgICBmb3IgKGxldCB2ID0gMDsgdiA8IGNvdW50c1tpXTsgdisrKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGsgPSBwZXJTZWdtZW50ID8gKHYgPj4gMSkgKiAyIDogLTE7XHJcbiAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gcGVyU2VnbWVudCA/IHBlclNlZ21lbnRba10gOiBmLnN0YXJ0O1xyXG4gICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrICsgMV0gOiBmLmVuZDtcclxuICAgICAgICAgICAgZHVyc1tvdXRdID0gZi5kdXI7XHJcbiAgICAgICAgICAgIGxheWVySWR4W291dF0gPSBmLmlkeDtcclxuICAgICAgICAgICAgb3V0Kys7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICByZXR1cm4geyBzcGFucywgZHVycywgbGF5ZXJJZHggfTtcclxufVxyXG5cclxuLy8gZ2xpZnkncyB2ZXJ0ZXggbGF5b3V0OiA2IGZsb2F0cyBwZXIgR0wgdmVydGV4ICh4LCB5LCByLCBnLCBiLCBhKSwgY29uZmlybWVkIGZvciAzLjMuMFxyXG4vLyBib3RoIGJ5IHJlYWRpbmcgdGhlIHNvdXJjZSBhbmQgYnkgdGhlIFZhbGhhbGxhLVZSRSByZXBvcnQncyBkZWJ1ZyBkdW1wIC0tIHR3b1xyXG4vLyBvbmUtc2VnbWVudCBsaW5lcyBwcm9kdWNlZCBhbGxWZXJ0aWNlc1R5cGVkIG9mIDI0IGZsb2F0czogMiBmZWF0dXJlcyB4IDIgdmVydGljZXMgeCA2LlxyXG5jb25zdCBGTE9BVFNfUEVSX1ZFUlRFWCA9IDY7XHJcblxyXG4vLyBXaXJlcyB0aW1lICsgbGF5ZXItdmlzaWJpbGl0eSBpbnRvIGEgbGl2ZSBnbGlmeSBMSU5FUyBvciBTSEFQRVMgaW5zdGFuY2UuIFRoZSBjYWxsZXJcclxuLy8gc3VwcGxpZXMgcGVyLWZlYXR1cmUgR0wtdmVydGV4IGNvdW50cyBjb21wdXRlZCBmcm9tIHRoZSBnZW9tZXRyeSBpdCBidWlsdCBpdHNlbGY6XHJcbi8vIGxpbmVzIGRyYXcgMioocG9pbnRzLTEpIHZlcnRpY2VzIHBlciBmZWF0dXJlLCBhbmQgYW55IHRyaWFuZ3VsYXRpb24gb2YgYSBzaW1wbGUgcmluZ1xyXG4vLyBoYXMgZXhhY3RseSBuLTIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzIGVhcmN1dC4gVGhlIGNvdW50c1xyXG4vLyBhcmUgdmFsaWRhdGVkIGFnYWluc3QgdGhlIGluc3RhbmNlJ3MgYWN0dWFsIGJ1ZmZlciBsZW5ndGgsIGFuZCBhbnkgbWlzbWF0Y2ggZGlzYWJsZXNcclxuLy8gdGhlIHZlY3RvciBHUFUgcGF0aCByYXRoZXIgdGhhbiBtaXMtYWxpZ25pbmcgYXR0cmlidXRlcy5cclxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKGluc3RhbmNlLCBtZXRhLCBjb3VudHMpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGNvdW50cykgfHwgY291bnRzLmxlbmd0aCAhPT0gbWV0YS5wZXJGZWF0dXJlLmxlbmd0aCkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGV4cGVjdGVkICR7bWV0YS5wZXJGZWF0dXJlLmxlbmd0aH0gdmVydGV4IGNvdW50cywgYCArXHJcbiAgICAgICAgICAgICAgICBgZ290ICR7Y291bnRzICYmIGNvdW50cy5sZW5ndGh9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IGV4cGVjdGVkID0gY291bnRzLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApICogRkxPQVRTX1BFUl9WRVJURVg7XHJcbiAgICAgICAgLy8gTGluZXMga2VlcCBhIHR5cGVkIGZsYXQgYnVmZmVyOyBzaGFwZXMga2VlcCBhIHBsYWluIGZsYXQgYXJyYXkuIEVpdGhlciBpcyB0aGVcclxuICAgICAgICAvLyBncm91bmQgdHJ1dGggZm9yIGhvdyBtYW55IEdMIHZlcnRpY2VzIGdsaWZ5IGFjdHVhbGx5IGJ1aWx0LlxyXG4gICAgICAgIGNvbnN0IGFjdHVhbCA9IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQgPyBpbnN0YW5jZS5hbGxWZXJ0aWNlc1R5cGVkLmxlbmd0aFxyXG4gICAgICAgICAgICA6IChBcnJheS5pc0FycmF5KGluc3RhbmNlLnZlcnRpY2VzKSA/IGluc3RhbmNlLnZlcnRpY2VzLmxlbmd0aCA6IC0xKTtcclxuICAgICAgICBpZiAoYWN0dWFsICE9PSBleHBlY3RlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHZlcnRleCBjb3VudCBtaXNtYXRjaDogZ2VvbWV0cnkgc2F5cyAke2V4cGVjdGVkfSBmbG9hdHMsIGAgK1xyXG4gICAgICAgICAgICAgICAgYHRoZSBpbnN0YW5jZSBob2xkcyAke2FjdHVhbH1gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgYXR0cnMgPSBleHBhbmRQZXJGZWF0dXJlKG1ldGEucGVyRmVhdHVyZSwgY291bnRzKTtcclxuICAgICAgICBhdHRycy5iYXNlID0gbWV0YS5iYXNlO1xyXG4gICAgICAgIGF0dHJzLmxheWVySWRzID0gbWV0YS5sYXllcklkcztcclxuICAgICAgICByZXR1cm4gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycyk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICBkaXNhYmxlVmVjdG9yR3B1KGVyci5tZXNzYWdlKTtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxufVxyXG5cclxuLy8gV2lyZXMgdGhlIGF0dHJpYnV0ZSBidWZmZXJzIGFuZCB1bmlmb3JtcyBpbnRvIGEgbGl2ZSBnbGlmeSBwb2ludHMgaW5zdGFuY2UuIFJldHVybnMgYVxyXG4vLyBoYW5kbGUgd2hvc2Ugc2V0V2luZG93IGNvc3RzIHR3byB1bmlmb3JtcyBhbmQgYSByZWRyYXcsIG9yIG51bGwgaWYgYW55dGhpbmcgYWJvdXQgdGhlXHJcbi8vIGluc3RhbmNlIGlzIG5vdCB3aGVyZSBnbGlmeSAzLjMuMCBrZWVwcyBpdCAtLSBpbiB3aGljaCBjYXNlIEdQVSB0aW1lIGlzIGRpc2FibGVkIGFuZFxyXG4vLyB0aGUgY2FsbGVyJ3MgcmVidWlsZCBwYXRoIHRha2VzIG92ZXIuXHJcbmV4cG9ydCBmdW5jdGlvbiBhdHRhY2hUaW1lVG9JbnN0YW5jZShpbnN0YW5jZSwgYXR0cnMpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgcmV0dXJuIHdpcmVUaW1lQXR0cmlidXRlcyhpbnN0YW5jZSwgYXR0cnMpO1xyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgZGlzYWJsZUdwdVRpbWUoZXJyLm1lc3NhZ2UpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBUaGUgY29tbW9uIEdMIHdpcmluZzogYnVmZmVycyBmb3Igc3Bhbi9kdXJhdGlvbi9sYXllciBhdHRyaWJ1dGVzLCB1bmlmb3JtcyBmb3IgdGhlXHJcbi8vIHRpY2ssIHRoZSBzaGFyZWQgb3ZlcnJpZGUgYW5kIHRoZSBwZXItbGF5ZXIgdmlzaWJpbGl0eSBzbG90cy4gVGhyb3dzIG9uIGFueXRoaW5nXHJcbi8vIHVuZXhwZWN0ZWQ7IHRoZSBjYWxsZXJzIGRlY2lkZSB3aGljaCBmYWxsYmFjayBmbGFnIHRoYXQgZmxpcHMuXHJcbmZ1bmN0aW9uIHdpcmVUaW1lQXR0cmlidXRlcyhpbnN0YW5jZSwgYXR0cnMpIHtcclxuICAgIHtcclxuICAgICAgICBjb25zdCBnbCA9IGluc3RhbmNlLmdsO1xyXG4gICAgICAgIGNvbnN0IHByb2dyYW0gPSBpbnN0YW5jZS5wcm9ncmFtO1xyXG4gICAgICAgIGNvbnN0IGxheWVyID0gaW5zdGFuY2UubGF5ZXI7XHJcbiAgICAgICAgaWYgKCFnbCB8fCAhcHJvZ3JhbSB8fCAhbGF5ZXIpIHRocm93IG5ldyBFcnJvcihcImluc3RhbmNlIGxhY2tzIGdsL3Byb2dyYW0vbGF5ZXJcIik7XHJcblxyXG4gICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XHJcblxyXG4gICAgICAgIGNvbnN0IHNwYW5Mb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFUaW1lU3BhblwiKTtcclxuICAgICAgICBjb25zdCBkdXJMb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFEdXJhdGlvblwiKTtcclxuICAgICAgICBjb25zdCBsYXllckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUxheWVyXCIpO1xyXG4gICAgICAgIGNvbnN0IHRpY2tMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1VGlja1wiKTtcclxuICAgICAgICBjb25zdCBvdmVycmlkZUxvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVPdmVycmlkZVwiKTtcclxuICAgICAgICAvLyBTb21lIGRyaXZlcnMgbmFtZSB0aGUgYXJyYXkgaGVhZCBcInVMYXllclZpc1swXVwiOyBhY2NlcHQgZWl0aGVyLlxyXG4gICAgICAgIGNvbnN0IHZpc0xvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1wiKVxyXG4gICAgICAgICAgICB8fCBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNbMF1cIik7XHJcbiAgICAgICAgaWYgKHNwYW5Mb2MgPCAwIHx8IGR1ckxvYyA8IDAgfHwgbGF5ZXJMb2MgPCAwIHx8ICF0aWNrTG9jIHx8ICFvdmVycmlkZUxvYyB8fCAhdmlzTG9jKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInRpbWUgYXR0cmlidXRlcy91bmlmb3JtcyBtaXNzaW5nIGZyb20gdGhlIGxpbmtlZCBwcm9ncmFtXCIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qgc3BhbkJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xyXG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBzcGFuQnVmKTtcclxuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuc3BhbnMsIGdsLlNUQVRJQ19EUkFXKTtcclxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKHNwYW5Mb2MsIDIsIGdsLkZMT0FULCBmYWxzZSwgMCwgMCk7XHJcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkoc3BhbkxvYyk7XHJcblxyXG4gICAgICAgIGNvbnN0IGR1ckJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xyXG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBkdXJCdWYpO1xyXG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5kdXJzLCBnbC5TVEFUSUNfRFJBVyk7XHJcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihkdXJMb2MsIDEsIGdsLkZMT0FULCBmYWxzZSwgMCwgMCk7XHJcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkoZHVyTG9jKTtcclxuXHJcbiAgICAgICAgY29uc3QgbGF5ZXJCdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcclxuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgbGF5ZXJCdWYpO1xyXG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5sYXllcklkeCwgZ2wuU1RBVElDX0RSQVcpO1xyXG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIobGF5ZXJMb2MsIDEsIGdsLkZMT0FULCBmYWxzZSwgMCwgMCk7XHJcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkobGF5ZXJMb2MpO1xyXG5cclxuICAgICAgICAvLyBVbnRpbCB0aGUgc2xpZGVyIHNheXMgb3RoZXJ3aXNlLCBldmVyeXRoaW5nIGlzIHZpc2libGUgLS0gaW4gdGltZSBBTkQgbGF5ZXIuXHJcbiAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIEFMV0FZUyk7XHJcbiAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCAtMSk7XHJcbiAgICAgICAgZ2wudW5pZm9ybTFmdih2aXNMb2MsIG5ldyBGbG9hdDMyQXJyYXkoTEFZRVJfU0xPVFMpLmZpbGwoMSkpO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBsYXllcklkczogYXR0cnMubGF5ZXJJZHMsXHJcbiAgICAgICAgICAgIC8vIHRpY2tNcyBpbiBlcG9jaCBtczsgb3ZlcnJpZGVNcyBhIHNoYXJlZC13aW5kb3cgd2lkdGggb3IgbnVsbC5cclxuICAgICAgICAgICAgc2V0V2luZG93KHRpY2tNcywgb3ZlcnJpZGVNcykge1xyXG4gICAgICAgICAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcclxuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZih0aWNrTG9jLCB0aWNrTXMgPT09IG51bGwgPyBBTFdBWVMgOiAodGlja01zIC0gYXR0cnMuYmFzZSkgLyAxMDAwKTtcclxuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgb3ZlcnJpZGVNcyA9PT0gbnVsbCA/IC0xIDogb3ZlcnJpZGVNcyAvIDEwMDApO1xyXG4gICAgICAgICAgICAgICAgbGF5ZXIucmVkcmF3KCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8vIE9uZSBmbG9hdCBwZXIgbGF5ZXIgc2xvdCwgaW4gYXR0cnMubGF5ZXJJZHMgb3JkZXIuIEEgc2lkZWJhciB0b2dnbGUgbGFuZHNcclxuICAgICAgICAgICAgLy8gaGVyZSBpbnN0ZWFkIG9mIHJlYnVpbGRpbmcgdGhlIGJ1Y2tldC5cclxuICAgICAgICAgICAgc2V0TGF5ZXJWaXNpYmlsaXR5KHZpc0FycmF5KSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB2aXMgPSBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpO1xyXG4gICAgICAgICAgICAgICAgdmlzLnNldCh2aXNBcnJheS5zbGljZSgwLCBMQVlFUl9TTE9UUykpO1xyXG4gICAgICAgICAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcclxuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCB2aXMpO1xyXG4gICAgICAgICAgICAgICAgbGF5ZXIucmVkcmF3KCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgYmluZFBvcHVwLCBiaW5kVG9vbHRpcCwgcGFyc2VDb2xvciB9IGZyb20gXCIuL3V0aWxzLmpzXCI7XHJcbmltcG9ydCB7IEwgfSBmcm9tIFwiLi9saWJzLmpzXCI7XHJcbmltcG9ydCB7IHBpblNoYWRlciB9IGZyb20gXCIuL3NoYWRlcnMuanNcIjtcclxuaW1wb3J0IHsgd2luZG93Rm9yLCBmZWF0dXJlSW5XaW5kb3csIHRpbWVzRm9yLCBsYXllckluV2luZG93LCBlZmZlY3RpdmVEdXJhdGlvbixcclxuICAgICAgICAgcGVyaW9kVG9NcyB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XHJcbmltcG9ydCB7IGJ1aWxkVGltZUF0dHJpYnV0ZXMsIGF0dGFjaFRpbWVUb0luc3RhbmNlLCB0aW1lVmVydGV4U2hhZGVyLFxyXG4gICAgICAgICBncHVUaW1lQXZhaWxhYmxlLCBidWlsZFZlY3RvclRpbWVNZXRhLCBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZSB9IGZyb20gXCIuL2dwdXRpbWUuanNcIjtcclxuXHJcbmZ1bmN0aW9uIHNldHVwR2xpZnlQcm9qZWN0aW9uKGdsSW5zdGFuY2UpIHtcclxuICAgIGlmIChnbEluc3RhbmNlICYmIGdsSW5zdGFuY2UubGF5ZXIpIHtcclxuICAgICAgICBnbEluc3RhbmNlLmxheWVyLl91bmNsYW1wZWRQcm9qZWN0ID0gZnVuY3Rpb24obGF0bG5nLCB6b29tKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAub3B0aW9ucy5jcnMubGF0TG5nVG9Qb2ludChsYXRsbmcsIHpvb20pO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5yZWRyYXcoKTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcclxuICAgIGlmICghbWFwLl9jbGlja01hdGNoZXMpIHtcclxuICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcyA9IFtdO1xyXG4gICAgfVxyXG4gICAgbWFwLl9jbGlja01hdGNoZXMucHVzaCh7IHByaW9yaXR5LCBhY3Rpb24gfSk7XHJcbiAgICBpZiAoIW1hcC5fY2xpY2tUaW1lb3V0KSB7XHJcbiAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXMuc29ydCgoYSwgYikgPT4gYS5wcmlvcml0eSAtIGIucHJpb3JpdHkpO1xyXG4gICAgICAgICAgICAvLyBXaGlsZSBhIEdlb21hbiBtb2RlIGlzIGFybWVkICh0aGUgd2lkZ2V0J3MgY2xpY2sgaGFuZGxlciBzdGFtcHMgdGhpc1xyXG4gICAgICAgICAgICAvLyBwZXIgY2xpY2ssIGJlZm9yZSBhbnkgZmVhdHVyZSBoYW5kbGVyIHJ1bnMpLCBFVkVSWSBtYXRjaCBzdGFuZHMgZG93bjpcclxuICAgICAgICAgICAgLy8gYSBjbGljayBpbiByZW1vdmFsIG1vZGUgaXMgYSBkZWxldGlvbiBhdHRlbXB0LCBhbmQgYW5zd2VyaW5nIGl0IHdpdGhcclxuICAgICAgICAgICAgLy8gYSBmZWF0dXJlIHBvcHVwIG9yIGEgY29vcmRzIHJlYWRvdXQgcmVhZHMgYXMgXCJyZW1vdmUgaXMgYnJva2VuXCIuXHJcbiAgICAgICAgICAgIGlmIChtYXAuX2NsaWNrTWF0Y2hlcy5sZW5ndGggPiAwICYmICFtYXAuX3BtTW9kZUFjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXNbMF0uYWN0aW9uKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcclxuICAgICAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgIH0sIDApO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XHJcbiAgICBpZiAoIW1hcC5faG92ZXJNYXRjaGVzKSB7XHJcbiAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMgPSBbXTtcclxuICAgIH1cclxuICAgIG1hcC5faG92ZXJNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xyXG4gICAgaWYgKCFtYXAuX2hvdmVyVGltZW91dCkge1xyXG4gICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcclxuICAgICAgICAgICAgaWYgKG1hcC5faG92ZXJNYXRjaGVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzWzBdLmFjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XHJcbiAgICAgICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuLy8gU3R5bGUgZm9yIG9uZSBmZWF0dXJlOiBpdHMgb3duIGVudHJ5IGZyb20gYGZlYXR1cmVfc3R5bGVzYCB3aGVuIHRoZSBsYXllciBjYXJyaWVzXHJcbi8vIHZhcmllZCBzdHlsaW5nLCBvdGhlcndpc2UgdGhlIGxheWVyJ3Mgc2luZ2xlIHN0eWxlLiBQeXRob24gb25seSBlbWl0cyBmZWF0dXJlX3N0eWxlc1xyXG4vLyB3aGVuIGZlYXR1cmVzIGFjdHVhbGx5IGRpZmZlciwgc28gYSB1bmlmb3JtIGxheWVyIGNvc3RzIG5vdGhpbmcgZXh0cmEgaGVyZS5cclxuLy8gRm91ciBzb3VyY2VzLCBsZWFzdCBzcGVjaWZpYyBmaXJzdC4gRWFjaCB0cmFuc2llbnQgb25lIGxpdmVzIGluIGl0cyBvd24gZmllbGQgcmF0aGVyXHJcbi8vIHRoYW4gZWRpdGluZyB0aGUgbGF5ZXIncyBzdHlsZSwgc28gY2xlYXJpbmcgaXQgcmVzdG9yZXMgd2hhdCB3YXMgdW5kZXJuZWF0aCB3aXRoXHJcbi8vIG5vdGhpbmcgdG8gcmVtZW1iZXIgYW5kIG5vdGhpbmcgdG8gcHV0IGJhY2suXHJcbi8vXHJcbi8vICAgdGhlIGxheWVyJ3Mgb3duIHN0eWxlICAgd2hhdCBpdCB3YXMgZHJhd24gd2l0aFxyXG4vLyAgIGZlYXR1cmVfc3R5bGVzW2ldICAgICAgIHBlciBmZWF0dXJlLCBmcm9tIHRoZSBkYXRhXHJcbi8vICAgaGlnaGxpZ2h0X3N0eWxlICAgICAgICAgdGhlIHdob2xlIGxheWVyIGlzIHNlbGVjdGVkXHJcbi8vICAgc3R5bGVfb3ZlcnJpZGVzW2ldICAgICAgdGhpcyBmZWF0dXJlIGlzIHNlbGVjdGVkIC0tIG1vc3Qgc3BlY2lmaWMsIHNvIGl0IHdpbnNcclxuZXhwb3J0IGZ1bmN0aW9uIHN0eWxlRm9yKGxheWVyLCBpbmRleCkge1xyXG4gICAgY29uc3QgZnJvbURhdGEgPSBBcnJheS5pc0FycmF5KGxheWVyLmZlYXR1cmVfc3R5bGVzKSA/IGxheWVyLmZlYXR1cmVfc3R5bGVzW2luZGV4XSA6IG51bGw7XHJcbiAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGU7XHJcbiAgICBjb25zdCBzZWxlY3RlZCA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyAmJiBsYXllci5zdHlsZV9vdmVycmlkZXNbaW5kZXhdO1xyXG4gICAgaWYgKCFmcm9tRGF0YSAmJiAhaGlnaGxpZ2h0ICYmICFzZWxlY3RlZCkgcmV0dXJuIGxheWVyO1xyXG4gICAgcmV0dXJuIHsgLi4ubGF5ZXIsIC4uLihmcm9tRGF0YSB8fCB7fSksIC4uLihoaWdobGlnaHQgfHwge30pLCAuLi4oc2VsZWN0ZWQgfHwge30pIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRJbmRleGVkUHJvcGVydGllcyhwcm9wZXJ0aWVzLCBpbmRleCkge1xyXG4gICAgaWYgKCFwcm9wZXJ0aWVzKSByZXR1cm4ge307XHJcbiAgICBjb25zdCBwcm9wcyA9IHt9O1xyXG4gICAgT2JqZWN0LmtleXMocHJvcGVydGllcykuZm9yRWFjaChrID0+IHtcclxuICAgICAgICBjb25zdCB2YWwgPSBwcm9wZXJ0aWVzW2tdO1xyXG4gICAgICAgIHByb3BzW2tdID0gQXJyYXkuaXNBcnJheSh2YWwpID8gdmFsW2luZGV4XSA6IHZhbDtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHByb3BzO1xyXG59XHJcblxyXG5cclxuXHJcbi8vIEFuIGltYWdlcnkgb3ZlcmxheSdzIGlkZW50aXR5OiBldmVyeXRoaW5nIHRoZSByZW5kZXJlZCBlbGVtZW50IGRlcml2ZXMgZnJvbSBpdHNcclxuLy8gY29uZmlnLiBUaGUgc3luYyBsb29wIHJlY3JlYXRlcyB0aGUgb3ZlcmxheSB3aGVuIHRoaXMgY2hhbmdlcyAob3Igd2hlbiB0aGVcclxuLy8gYmluYXJ5IGJ1ZmZlciBvYmplY3QgdW5kZXIgdGhlIGxheWVyIGlkIGlzIHJlcGxhY2VkKSwgc2luY2UgYSBET00gaW1hZ2UgaXMgYVxyXG4vLyBzaW5nbGUgY2hlYXAgbm9kZSAtLSBubyBpbmNyZW1lbnRhbCB1cGRhdGUgbWFjaGluZXJ5IG5lZWRlZC5cclxuZXhwb3J0IGZ1bmN0aW9uIGltYWdlTWV0YUtleShsYXllcikge1xyXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KFtsYXllci51cmwgfHwgbnVsbCwgbGF5ZXIuYm91bmRzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBsYXllci5vcGFjaXR5ID8/IDEsIGxheWVyLmltYWdlX2Zvcm1hdCB8fCBudWxsXSk7XHJcbn1cclxuXHJcbi8vIEdlb3JlZmVyZW5jZWQgcGl4ZWxzIHBpbm5lZCB0byBhIGxhdC9sb24gYm94LiBUaGUgY29uZmlnIGlzIHB1cmUgZGF0YSAtLVxyXG4vLyB7dHlwZTogXCJpbWFnZVwiLCBib3VuZHMsIG9wYWNpdHksIHVybCB8IGJ5dGVzIHVuZGVyIHRoZSBsYXllciBpZH0gLS0gc28gYVxyXG4vLyBwbGFpbi1KUyBjb25zdW1lciBwYXNzZXMgYSBVUkwgYW5kIHRoZSB3aWRnZXQgcGF0aCBzaGlwcyBieXRlcyBvdmVyIHRoZVxyXG4vLyBiaW5hcnkgYnVmZmVyIHRyYW5zcG9ydC4gUHl0aG9uIGhhcyBhbHJlYWR5IHdhcnBlZCB0aGUgcmFzdGVyIGludG8gdGhlIE1BUCdzXHJcbi8vIG93biBDUlMgZ3JpZCAocmFzdGVyaW8gc2lkZSksIHdoaWNoIGlzIHdoYXQgbWFrZXMgTGVhZmxldCdzIGxpbmVhciBjb3JuZXJcclxuLy8gc3RyZXRjaCBleGFjdGx5IGNvcnJlY3Q7IHRoaXMgc3RheXMgYSBkdW1iIHJlbmRlcmVyLlxyXG5mdW5jdGlvbiByZW5kZXJJbWFnZUxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyKSB7XHJcbiAgICBpZiAoIWxheWVyLmJvdW5kcykgcmV0dXJuIG51bGw7XHJcbiAgICBsZXQgdXJsID0gbGF5ZXIudXJsO1xyXG4gICAgbGV0IG9iamVjdFVybCA9IG51bGw7XHJcbiAgICBpZiAoIXVybCAmJiBjb29yZEJ1ZmZlcikge1xyXG4gICAgICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbY29vcmRCdWZmZXJdLFxyXG4gICAgICAgICAgICB7IHR5cGU6IGxheWVyLmltYWdlX2Zvcm1hdCB8fCBcImltYWdlL3BuZ1wiIH0pO1xyXG4gICAgICAgIG9iamVjdFVybCA9IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICB9XHJcbiAgICBpZiAoIXVybCkgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBvdmVybGF5ID0gTC5pbWFnZU92ZXJsYXkodXJsLCBsYXllci5ib3VuZHMsIHtcclxuICAgICAgICBvcGFjaXR5OiBsYXllci5vcGFjaXR5ID8/IDEsXHJcbiAgICAgICAgLy8gQ29udGV4dCwgbm90IGEgY2xpY2sgdGFyZ2V0OiBjbGlja3MgZmFsbCB0aHJvdWdoIHRvIGZlYXR1cmVzIGFuZCB0aGVcclxuICAgICAgICAvLyBlbXB0eS1tYXAgY29vcmRpbmF0ZSBmYWxsYmFjay4gVGhlIGRlZmF1bHQgb3ZlcmxheVBhbmUgKHogNDAwKVxyXG4gICAgICAgIC8vIGFscmVhZHkgc2l0cyBhYm92ZSB0aWxlcyAoMjAwKSBhbmQgYmVsb3cgdGhlIEdMIHBhbmVzICg0MTArKS5cclxuICAgICAgICBpbnRlcmFjdGl2ZTogZmFsc2UsXHJcbiAgICB9KTtcclxuICAgIGlmIChvYmplY3RVcmwpIHtcclxuICAgICAgICBvdmVybGF5Lm9uKFwicmVtb3ZlXCIsICgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwob2JqZWN0VXJsKSk7XHJcbiAgICB9XHJcbiAgICBvdmVybGF5LmFkZFRvKG1hcCk7XHJcbiAgICBvdmVybGF5LmxheWVyVHlwZSA9IGxheWVyLnR5cGU7XHJcbiAgICBvdmVybGF5LmltYWdlTWV0YSA9IGltYWdlTWV0YUtleShsYXllcik7XHJcbiAgICBvdmVybGF5LmltYWdlU291cmNlID0gY29vcmRCdWZmZXIgfHwgbnVsbDtcclxuICAgIHJldHVybiBvdmVybGF5O1xyXG59XHJcblxyXG4vLyBBIG5vbi1HTCBsYXllciAoaW1hZ2Ugb3ZlcmxheSwgb3IgYSBncm91cCBvZiB0aGVtKSBhcyBhIExlYWZsZXQgbGF5ZXIuIFRha2VzIHRoZVxyXG4vLyBMSVZFIGJ1ZmZlciBtYXAgdGhlIGNvcmUga2VlcHMgLS0gcGF0Y2hlcyBsYW5kIHRoZXJlLCBuZXZlciBpbiBhIGhvc3QgdHJhaXQuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlciwgY29vcmRpbmF0ZUJ1ZmZlcnMgPSB7fSkge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIikge1xyXG4gICAgICAgIHJldHVybiByZW5kZXJJbWFnZUxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyKTtcclxuICAgIH1cclxuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICBjb25zdCBncm91cCA9IEwubGF5ZXJHcm91cCgpO1xyXG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xyXG4gICAgICAgICAgICBpZiAoc3ViLnR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJtYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWxpbmVcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgc3ViLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBzdWIsIGNvb3JkaW5hdGVCdWZmZXJzW3N1Yi5pZF0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XHJcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcclxuICAgICAgICBncm91cC5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgICAgIHJldHVybiBncm91cDtcclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBBIHZlY3RvciBsYXllcidzIGNvb3JkaW5hdGVzOiB0aGUgYmluYXJ5IGJ1ZmZlciB1bmRlciBpdHMgaWQgd2hlbiBQeXRob24gYnVpbHQgaXRcclxuLy8gKHRoZSBsYXllcnMgSlNPTiB0aGVuIGNhcnJpZXMgbm8gY29vcmRpbmF0ZXMgYXQgYWxsKSwgb3IgaW5saW5lIGBsb2NhdGlvbnNgIGZvclxyXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xyXG4vLyBvbiB0aGUgR1BVIHBhdGggcmFyZWx5IGRvLlxyXG5leHBvcnQgZnVuY3Rpb24gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLmxvY2F0aW9ucykgcmV0dXJuIGxheWVyLmxvY2F0aW9ucztcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IGZsYXQgPSBuZXcgRmxvYXQ2NEFycmF5KHJhdy5idWZmZXIgfHwgcmF3LCByYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xyXG4gICAgY29uc3Qgb3V0ID0gbmV3IEFycmF5KGZsYXQubGVuZ3RoIC8gMik7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG91dC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG91dFtpXSA9IFtmbGF0W2kgKiAyXSwgZmxhdFtpICogMiArIDFdXTtcclxuICAgIH1cclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIEEgbGluZSBsYXllcidzIGNvb3JkaW5hdGVzIGFzIHBhcnRzOiB0aGUgZmxhdCBydW4gc2xpY2VkIGJ5IHRoZSBjb25maWcncyBgcGFydHNgXHJcbi8vIGxlbmd0aCB0YWJsZSwgb3Igb25lIHBhcnQgd2l0aG91dCBpdC4gQSBtdWx0aS1wYXJ0IGxpbmUgLS0gTVVMVElMSU5FU1RSSU5HLFxyXG4vLyBNdWx0aUxpbmVTdHJpbmcgLS0gaXMgT05FIGxheWVyIGRyYXduIGFzIGRpc2pvaW50IHJ1bnM7IG5vdGhpbmcgbWF5IGV2ZXIgZHJhdyBhXHJcbi8vIHNlZ21lbnQgZnJvbSBvbmUgcGFydCdzIGxhc3QgdmVydGV4IHRvIHRoZSBuZXh0IHBhcnQncyBmaXJzdC5cclxuZXhwb3J0IGZ1bmN0aW9uIGxpbmVQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxlbmd0aHMgPSBBcnJheS5pc0FycmF5KGxheWVyLnBhcnRzKSAmJiBsYXllci5wYXJ0cy5sZW5ndGggPiAxID8gbGF5ZXIucGFydHMgOiBudWxsO1xyXG4gICAgaWYgKCFsZW5ndGhzKSByZXR1cm4gbG9jcy5sZW5ndGggPyBbbG9jc10gOiBbXTtcclxuICAgIGNvbnN0IHBhcnRzID0gW107XHJcbiAgICBsZXQgb2Zmc2V0ID0gMDtcclxuICAgIGZvciAoY29uc3QgbiBvZiBsZW5ndGhzKSB7XHJcbiAgICAgICAgY29uc3QgcGFydCA9IGxvY3Muc2xpY2Uob2Zmc2V0LCBvZmZzZXQgKyBuKTtcclxuICAgICAgICBvZmZzZXQgKz0gbjtcclxuICAgICAgICBpZiAocGFydC5sZW5ndGggPj0gMikgcGFydHMucHVzaChwYXJ0KTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuZnVuY3Rpb24gY2xvc2VSaW5nKHJpbmcpIHtcclxuICAgIGlmIChyaW5nLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBmaXJzdCA9IHJpbmdbMF07XHJcbiAgICAgICAgY29uc3QgbGFzdCA9IHJpbmdbcmluZy5sZW5ndGggLSAxXTtcclxuICAgICAgICBpZiAoZmlyc3RbMF0gIT09IGxhc3RbMF0gfHwgZmlyc3RbMV0gIT09IGxhc3RbMV0pIHtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmluZztcclxufVxyXG5cclxuLy8gZ2xpZnkncyBsaW5lIGhpdCB0b2xlcmFuY2UgaXMgYHNlbnNpdGl2aXR5ICsgd2VpZ2h0L3NjYWxlYCwgYW5kIHNlbnNpdGl2aXR5IGlzIGFcclxuLy8gQ09OU1RBTlQgaW4gbGF0bG5nIGRlZ3JlZXMgLS0gMC4xIGZvciBjbGlja3MgKH4xMSBrbSkgYW5kIDAuMDMgZm9yIGhvdmVycyxcclxuLy8gem9vbS1ibGluZCwgc28gYSBjbGljayB3aXRoaW4gc2lnaHQgb2YgYSBsaW5lIG1hdGNoZWQgaXQgYW5kIHN0YXJ2ZWQgdGhlXHJcbi8vIGVtcHR5LW1hcCBmYWxsYmFjay4gVGhlIHdlaWdodC9zY2FsZSB0ZXJtIGFscmVhZHkgY292ZXJzIHRoZSBkcmF3biB3aWR0aDtcclxuLy8gcmVwbGFjZSB0aGUgY29uc3RhbnQgd2l0aCBhIGZldyBwaXhlbHMnIHdvcnRoIGF0IHRoZSBjdXJyZW50IHpvb20uIFRoZSBpbnN0YW5jZVxyXG4vLyBnZXR0ZXJzIHJlYWQgYHNldHRpbmdzYCBsaXZlIHBlciBldmVudCwgc28gdXBkYXRpbmcgb24gem9vbSBpcyBlbm91Z2ggLS0gbm9cclxuLy8gZ2xpZnkgcGF0Y2hpbmcuIFJldHVybnMgdGhlIHVuc3Vic2NyaWJlIGZvciBvblJlbW92ZS5cclxuY29uc3QgTElORV9ISVRfU0xBQ0tfUFggPSA4O1xyXG5mdW5jdGlvbiB0cmFja0xpbmVTZW5zaXRpdml0eShtYXAsIGluc3RhbmNlKSB7XHJcbiAgICBjb25zdCBhcHBseSA9ICgpID0+IHtcclxuICAgICAgICBjb25zdCBzbGFjayA9IExJTkVfSElUX1NMQUNLX1BYIC8gTWF0aC5wb3coMiwgbWFwLmdldFpvb20oKSk7XHJcbiAgICAgICAgaW5zdGFuY2Uuc2V0dGluZ3Muc2Vuc2l0aXZpdHkgPSBzbGFjaztcclxuICAgICAgICBpbnN0YW5jZS5zZXR0aW5ncy5zZW5zaXRpdml0eUhvdmVyID0gc2xhY2s7XHJcbiAgICB9O1xyXG4gICAgYXBwbHkoKTtcclxuICAgIG1hcC5vbihcInpvb21lbmRcIiwgYXBwbHkpO1xyXG4gICAgcmV0dXJuICgpID0+IG1hcC5vZmYoXCJ6b29tZW5kXCIsIGFwcGx5KTtcclxufVxyXG5cclxuLy8gQW4gYXJlYSBsYXllcidzIGdlb21ldHJ5IGFzIHBhcnRzIC0+IGNsb3NlZCBbbG9uLCBsYXRdIHJpbmdzOiBhIHBvbHlnb24ncyBmbGF0XHJcbi8vIGNvb3JkaW5hdGUgcnVuIHNsaWNlZCBieSBpdHMgYHJpbmdzYCB0YWJsZSAob25lIGhvbGUtZnJlZSByaW5nIHdpdGhvdXQgaXQpLCBvciBhXHJcbi8vIGNpcmNsZSdzIGdlbmVyYXRlZCByaW5nLiBGZWVkcyBib3RoIHRoZSBmaWxsIChlYXJjdXQsIGluIHRoZSBwb2x5Z29uIGJ1Y2tldCkgYW5kXHJcbi8vIHRoZSBvdXRsaW5lIChMaW5lU3RyaW5ncyBpbiB0aGUgbGluZXMgYnVja2V0KS5cclxuZnVuY3Rpb24gYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICBjb25zdCBsYXQgPSBsYXllci5sb2NhdGlvblswXTtcclxuICAgICAgICBjb25zdCBsb24gPSBsYXllci5sb2NhdGlvblsxXTtcclxuICAgICAgICBjb25zdCByYWRpdXNNZXRlcnMgPSBsYXllci5yYWRpdXMgfHwgMTA7XHJcbiAgICAgICAgY29uc3QgZWFydGhSYWRpdXMgPSA2Mzc4MTM3O1xyXG4gICAgICAgIGNvbnN0IHJpbmcgPSBbXTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XHJcbiAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xyXG4gICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtsb24gKyAoZExvbiAqIDE4MCkgLyBNYXRoLlBJLCBsYXQgKyAoZExhdCAqIDE4MCkgLyBNYXRoLlBJXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBbW3JpbmddXTtcclxuICAgIH1cclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxvbmxhdCA9IGxvY3MubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgIGNvbnN0IHJpbmdUYWJsZSA9IGxheWVyLnJpbmdzIHx8IChsb25sYXQubGVuZ3RoID4gMCA/IFtbbG9ubGF0Lmxlbmd0aF1dIDogW10pO1xyXG4gICAgY29uc3QgcGFydHMgPSBbXTtcclxuICAgIGxldCBhdCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHBhcnRMZW5zIG9mIHJpbmdUYWJsZSkge1xyXG4gICAgICAgIGNvbnN0IHJpbmdzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsZW4gb2YgcGFydExlbnMpIHtcclxuICAgICAgICAgICAgY29uc3QgcmluZyA9IGNsb3NlUmluZyhsb25sYXQuc2xpY2UoYXQsIGF0ICsgbGVuKSk7XHJcbiAgICAgICAgICAgIGF0ICs9IGxlbjtcclxuICAgICAgICAgICAgaWYgKHJpbmcubGVuZ3RoID49IDQpIHJpbmdzLnB1c2gocmluZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChyaW5ncy5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKHJpbmdzKTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuLy8gYGV2ZW50cy5vbkZlYXR1cmVDbGljayh7IGxheWVyLCBpbmRleCwgbGF0bG5nIH0pYCBpcyBob3cgYSBjbGljayByZWFjaGVzIHdoYXRldmVyXHJcbi8vIGhvc3RzIHRoZSBtYXA7IHRoaXMgbW9kdWxlIG5ldmVyIHdyaXRlcyBzdGF0ZSBpdHNlbGYuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgbGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIGV2ZW50cyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGwsIHZlY3RvckdwdSA9IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNGZWF0dXJlVmlzaWJsZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IG9uRmVhdHVyZUNsaWNrID0gKGV2ZW50cyAmJiBldmVudHMub25GZWF0dXJlQ2xpY2spIHx8ICgoKSA9PiB7fSk7XHJcbiAgICAvLyBIaXQtdGVzdCBndWFyZDogR1BVLXBhdGggYnVja2V0cyBob2xkIGhpZGRlbiBsYXllcnMgKGFuZCBvdXQtb2Ytd2luZG93XHJcbiAgICAvLyBmZWF0dXJlcyksIG1hc2tlZCBvbmx5IGJ5IHNoYWRlciB1bmlmb3JtcyBnbGlmeSdzIGhpdC10ZXN0cyBjYW5ub3Qgc2VlLiBUaGVcclxuICAgIC8vIHdpZGdldCBwYXNzZXMgYSBsaXZlIGxvb2t1cDsgdGhlIGZhbGxiYWNrIGNvdmVycyBwbGFpbi1KUyBjb25zdW1lcnMgd2l0aCB0aGVcclxuICAgIC8vIGNvbmZpZydzIG93biBmbGFnLlxyXG4gICAgY29uc3QgdmlzaWJsZU5vdyA9IGlzRmVhdHVyZVZpc2libGUgfHwgKChsKSA9PiBsLnZpc2libGUgIT09IGZhbHNlKTtcclxuICAgIC8vIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lIGdlb21ldHJ5IHBlciBsYXllci4gT24gdGhlIEdQVSBwYXRoIChtYXAuanNcclxuICAgIC8vIHBhc3NlcyB2ZWN0b3JHcHUgd2hlbiB0aGUgYnVja2V0IHF1YWxpZmllcykgZXZlcnkgZmVhdHVyZSBzdGF5cyBpbiB0aGUgYnVmZmVycyBhbmRcclxuICAgIC8vIHRoZSBzaGFkZXIgZGVjaWRlcyB2aXNpYmlsaXR5IHBlciB0aWNrIGFuZCBwZXIgbGF5ZXIgdG9nZ2xlIC0tIGEgbGluZS1zaGFwZWQgdHJhY2tcclxuICAgIC8vIGhhcyBhcyBtYW55IHZlcnRpY2VzIGFzIGEgcG9pbnQgdHJhY2sgaGFzIHBvaW50cywgc28gaXRzIHJlYnVpbGRzIGNvc3QgdGhlIHNhbWVcclxuICAgIC8vIGFuZCBjcmFzaGVkIHRoZSBzYW1lIHdheS4gT2ZmIHRoZSBHUFUgcGF0aCwgdGhlIHdob2xlLWZlYXR1cmUgQ1BVIGZpbHRlciByZW1haW5zLlxyXG4gICAgY29uc3QgdmVjdG9yTWV0YSA9IHZlY3RvckdwdSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCJcclxuICAgICAgICA/IGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCB2ZWN0b3JUaW1lID0gQm9vbGVhbih2ZWN0b3JNZXRhLmhhc1RpbWUpO1xyXG4gICAgaWYgKHRpbWVTdGF0ZSAmJiAhdmVjdG9yVGltZSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCIpIHtcclxuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcclxuICAgICAgICBpZiAobGF5ZXJzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xyXG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XHJcblxyXG4gICAgICAgICAgICAvLyBBcmVhIG91dGxpbmVzOiBhIHBvbHlnb24gb3IgY2lyY2xlIGluIHRoaXMgYnVja2V0IGNvbnRyaWJ1dGVzIGVhY2ggb2YgaXRzXHJcbiAgICAgICAgICAgIC8vIHJpbmdzIGFzIG9uZSBMaW5lU3RyaW5nLCBkcmF3biB3aXRoIHRoZSBhcmVhJ3Mgc3Ryb2tlIG9wdGlvbnMgLS0gY29sb3IsXHJcbiAgICAgICAgICAgIC8vIHdlaWdodCwgb3BhY2l0eSwgTGVhZmxldCdzIG93biBzZW1hbnRpY3MuIE91dGxpbmUgd2VpZ2h0IGFuZCBvcGFjaXR5IG5ldmVyXHJcbiAgICAgICAgICAgIC8vIHJlbmRlcmVkIGJlZm9yZSB0aGlzOyB0aGUgZmlsbCBtYWNoaW5lcnkgY2Fubm90IGRyYXcgdGhlbSAoZ2xpZnkncyBib3JkZXJcclxuICAgICAgICAgICAgLy8gaXMgMXB4IGFuZCBmaWxsLWNvbG91cmVkKSwgdGhlIGxpbmVzIG1hY2hpbmVyeSBhbHJlYWR5IGRvZXMuXHJcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIiB8fCBsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICAgICAgICAgICAgaWYgKChzdHlsZS53ZWlnaHQgPz8gMykgPiAwICYmIChzdHlsZS5vcGFjaXR5ID8/IDEuMCkgPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmcgb2YgcmluZ3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAocmluZy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIkxpbmVTdHJpbmdcIiwgY29vcmRpbmF0ZXM6IHJpbmcgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT3V0bGluZSBwaXhlbHMgb25seSAtLSB0aGUgYXJlYSdzIHNoYXBlcyBpbnN0YW5jZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvd25zIGludGVyYWN0aW9uIHdpdGggZXhhY3QgY29udGFpbm1lbnQuIExlZnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2xpY2thYmxlLCB0aGVzZSByaW5ncyBhbnN3ZXJlZCB0aHJvdWdoIGdsaWZ5J3NcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGluZSB0b2xlcmFuY2UgKDAuMSBERUdSRUVTIGZvciBjbGlja3MgdnMgMC4wM1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmb3IgaG92ZXJzKTogcG9wdXBzIHdlbGwgb3V0c2lkZSB0aGUgc2hhcGUgYW5kXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc2lkZSBob2xlcywgaG92ZXIgZGlzYWdyZWVpbmcgd2l0aCBjbGljay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCb3JkZXI6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTsgICAvLyAwIGtlZXBzIHRoZSBzbG90IGFsaWduZWQgd2hlbiBzdHJva2VsZXNzXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gT25lIExpbmVTdHJpbmcgZmVhdHVyZSBQRVIgUEFSVCwgZXZlcnkgcGFydCBjYXJyeWluZyB0aGUgbGF5ZXIgLS0gbmV2ZXJcclxuICAgICAgICAgICAgLy8gYSBNdWx0aUxpbmVTdHJpbmc6IGdsaWZ5J3MgTXVsdGlMaW5lU3RyaW5nIHBhdGggaGl0LXRlc3RzIHRoZSBjb25uZWN0b3JcclxuICAgICAgICAgICAgLy8gYmV0d2VlbiBwYXJ0cywgd2hpY2ggaXMgdGhlIHBoYW50b20gc2VnbWVudCBieSBhbm90aGVyIHJvdXRlLiBUaGUgR0xcclxuICAgICAgICAgICAgLy8gdmVydGV4IHN0cmVhbSBzdGF5cyBjb25zZWN1dGl2ZSwgc28gdGhlIHBlci1sYXllciBjb3VudCBzdGlsbCBhbGlnbnNcclxuICAgICAgICAgICAgLy8gdGhlIHRpbWUgYXR0cmlidXRlczsgYSBzdHJva2VsZXNzIG9yIGRlZ2VuZXJhdGUgbGF5ZXIga2VlcHMgaXRzIHNsb3QuXHJcbiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGFydCBvZiBsaW5lUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZ2VvanNvbkNvb3JkcyA9IHBhcnQubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkxpbmVTdHJpbmdcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IGdlb2pzb25Db29yZHNcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goY291bnQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcclxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcclxuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lT3B0aW9ucyA9IHZlY3RvclRpbWVcclxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5nbExpbmVzID0gTC5nbGlmeS5saW5lcyh7XHJcbiAgICAgICAgICAgICAgICAgICAgLi4ubGluZU9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5bGluZXNQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGRhdGEgYWJvdmUgaXMgR2VvSlNPTiwgd2hvc2UgY29vcmRpbmF0ZXMgYXJlIFtsb24sIGxhdF07IGdsaWZ5XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZGVmYXVsdHMgdG8gbGF0aXR1ZGUtZmlyc3QgYW5kIGl0cyBMSU5FIHZlcnRleCBidWlsZGVyIHJlYWRzXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gY29vcmRpbmF0ZXMgdGhyb3VnaCB0aGVzZSBrZXlzIC0tIHVuc2V0LCBpdCB0b29rIGxvbmdpdHVkZSBhc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGxhdGl0dWRlIGFuZCBwcm9qZWN0ZWQgZXZlcnkgbGluZSBvZmYtdmlld3BvcnQuIFNpbGVudGx5OiBubyBHTFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGVycm9yLCBhIGhlYWx0aHkgY2FudmFzLCB6ZXJvIGZyYWdtZW50cy4gU2V0IHBlciBpbnN0YW5jZSByYXRoZXJcclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGFuIG9uIHRoZSBMLmdsaWZ5IGdsb2JhbCwgd2hpY2ggYW5vdGhlciBsaWJyYXJ5IGNvdWxkIGFsc29cclxuICAgICAgICAgICAgICAgICAgICAvLyBtdXRhdGUuIFRoZSBwb2x5Z29uIHBhdGggaXMgZGVsaWJlcmF0ZWx5IE5PVCBnaXZlbiB0aGVzZSBrZXlzOlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGl0IHRyaWFuZ3VsYXRlcyB2aWEgZWFyY3V0IG9uIHRoZSBHZW9KU09OIGRpcmVjdGx5LCBuYXRpdmVcclxuICAgICAgICAgICAgICAgICAgICAvLyBbbG9uLCBsYXRdLCBhbmQga2V5cyB0aGVyZSB3b3VsZCB0cmFuc3Bvc2UgaXQgdGhlIHNhbWUgd2F5LlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZvdW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgYnVnIHJlcG9ydCwgZHJpdmluZyB0aGUgcGxhaW4tSlNcclxuICAgICAgICAgICAgICAgICAgICAvLyBidW5kbGUgd2hlcmUgbm8gcG9pbnRzIG1hc2tlZCB0aGUgYmxhbmsgbGluZXMuXHJcbiAgICAgICAgICAgICAgICAgICAgbGF0aXR1ZGVLZXk6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgbG9uZ2l0dWRlS2V5OiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZmVhdHVyZSB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzIHx8IGZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXJlIHRoZSBjbGljayBsYW5kZWQ6IHRoZSBob3N0IHJlY29yZHMgXCJ3aGVyZVwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIFwib24gd2hhdFwiIC0tIHNlZSBvbkZlYXR1cmVDbGljayBpbiBjb3JlLmpzLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uRmVhdHVyZUNsaWNrKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIsIGluZGV4OiAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXRsbmc6IFtNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sYXQgKiAxZTUpIC8gMWU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sbmcgKiAxZTUpIC8gMWU1XSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiAhZmVhdHVyZS5wcm9wZXJ0aWVzLmlzQm9yZGVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAyLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbExpbmVzKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NlbnNpdGl2aXR5T2ZmID0gdHJhY2tMaW5lU2Vuc2l0aXZpdHkobSwgdGhpcy5nbExpbmVzKTtcclxuICAgICAgICAgICAgICAgIGlmICh2ZWN0b3JUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UodGhpcy5nbExpbmVzLCB2ZWN0b3JNZXRhLCB2ZXJ0ZXhDb3VudHMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zZW5zaXRpdml0eU9mZikgdGhpcy5fc2Vuc2l0aXZpdHlPZmYoKTtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsTGluZXMpIHRoaXMuZ2xMaW5lcy5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcclxuICAgICAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xyXG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XHJcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlID09PSBcInBvbHlnb25cIikge1xyXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKDApOyAgIC8vIG5vIGZlYXR1cmUsIGJ1dCB0aGUgc2xvdCBtdXN0IHN0YXkgYWxpZ25lZFxyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gQW55IHRyaWFuZ3VsYXRpb24gb2YgYSBwb2x5Z29uIHdpdGggRCBkaXN0aW5jdCB2ZXJ0aWNlcyBhbmQgaCBob2xlcyBoYXNcclxuICAgICAgICAgICAgLy8gZXhhY3RseSBEICsgMmggLSAyIHRyaWFuZ2xlcyAtLSBhIHByb3BlcnR5IG9mIGdlb21ldHJ5LCBub3Qgb2YgZ2xpZnknc1xyXG4gICAgICAgICAgICAvLyBlYXJjdXQ7IGggPSAwIGdpdmVzIHRoZSBmYW1pbGlhciBEIC0gMi4gUmluZ3MgYXJlIGNsb3NlZCBieSBub3csIHNvIGVhY2hcclxuICAgICAgICAgICAgLy8gY29udHJpYnV0ZXMgbGVuZ3RoIC0gMSBkaXN0aW5jdCB2ZXJ0aWNlcy4gUGFydHMgdHJpYW5ndWxhdGUgc2VwYXJhdGVseVxyXG4gICAgICAgICAgICAvLyBhbmQgc3VtLlxyXG4gICAgICAgICAgICBsZXQgdHJpYW5nbGVzID0gMDtcclxuICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBwYXJ0cykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGlzdGluY3QgPSByaW5ncy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgci5sZW5ndGggLSAxLCAwKTtcclxuICAgICAgICAgICAgICAgIHRyaWFuZ2xlcyArPSBNYXRoLm1heCgwLCBkaXN0aW5jdCArIDIgKiAocmluZ3MubGVuZ3RoIC0gMSkgLSAyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaCgzICogdHJpYW5nbGVzKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xyXG4gICAgICAgICAgICAvLyBMZWFmbGV0J3Mgb3duIHNlbWFudGljczogdGhlIGZpbGwgaXMgZmlsbENvbG9yLCBkZWZhdWx0aW5nIHRvIHRoZSBzdHJva2VcclxuICAgICAgICAgICAgLy8gY29sb3Igd2hlbiB1bnNldC4gSXQgdXNlZCB0byBhbHdheXMgZmlsbCB3aXRoIGBjb2xvcmAsIHdoaWNoIG1hZGVcclxuICAgICAgICAgICAgLy8gXCJyZWQgb3V0bGluZSwgcGFsZSBibHVlIGZpbGxcIiAtLSB0aGUgbW9zdCBiYXNpYyBwb2x5Z29uIHN0eWxpbmcgYXNrIC0tXHJcbiAgICAgICAgICAgIC8vIGltcG9zc2libGU7IHRoZSBvdXRsaW5lIGl0c2VsZiBpcyBkcmF3biBieSB0aGUgbGluZXMgYnVja2V0LlxyXG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmZpbGxDb2xvciB8fCBzdHlsZS5maWxsX2NvbG9yIHx8IHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XHJcbiAgICAgICAgICAgIC8vIE9uZSBGZWF0dXJlIFBFUiBQQVJULCBuZXZlciBhIE11bHRpUG9seWdvbjogZ2xpZnkncyBzaGFwZXMgb25seVxyXG4gICAgICAgICAgICAvLyBleHBsb2RlcyBNdWx0aVBvbHlnb24gd2hlbiBoYW5kZWQgYSBiYXJlIEZlYXR1cmUgb3IgZ2VvbWV0cnkgLS0gaW4gYVxyXG4gICAgICAgICAgICAvLyBGZWF0dXJlQ29sbGVjdGlvbiB0aGUgY29vcmRpbmF0ZXMgcmVhY2ggZWFyY3V0LmZsYXR0ZW4gdW5leHBsb2RlZCxcclxuICAgICAgICAgICAgLy8gZWFyY3V0IHJldHVybnMgbm8gaW5kaWNlcywgYW5kIHRoZSBmZWF0dXJlIHNpbGVudGx5IGRyYXdzIFpFUk8gZmlsbFxyXG4gICAgICAgICAgICAvLyB0cmlhbmdsZXMgKHZlcmlmaWVkIGFnYWluc3QgZ2xpZnkgMy4zLjA7IGl0cyBcInVuaGFuZGxlZCBwb2x5Z29uXCJcclxuICAgICAgICAgICAgLy8gdGhyb3cgc2l0cyBpbnNpZGUgdGhlIGVtcHR5IGxvb3AgYW5kIG5ldmVyIGZpcmVzKS4gUGFydHMgc3RheVxyXG4gICAgICAgICAgICAvLyBjb25zZWN1dGl2ZSwgc28gcGVyLWxheWVyIHZlcnRleENvdW50cyBzdGlsbCBhbGlnbiBmb3IgR1BVIHRpbWUuXHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgcGFydHMpIHtcclxuICAgICAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7IHR5cGU6IFwiUG9seWdvblwiLCBjb29yZGluYXRlczogcmluZ3MgfSxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUuZmlsbE9wYWNpdHkgfHwgMC4yIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcclxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcclxuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzaGFwZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXHJcbiAgICAgICAgICAgICAgICAgICAgPyB7IHZlcnRleFNoYWRlclNvdXJjZTogKCkgPT4gdGltZVZlcnRleFNoYWRlcigpIH0gOiB7fTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZ2xTaGFwZXMgPSBMLmdsaWZ5LnNoYXBlcyh7XHJcbiAgICAgICAgICAgICAgICAgICAgLi4uc2hhcGVPcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxyXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWdvbnNQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZmVhdHVyZSB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDMsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXJlIHRoZSBjbGljayBsYW5kZWQ6IHRoZSBob3N0IHJlY29yZHMgXCJ3aGVyZVwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIFwib24gd2hhdFwiIC0tIHNlZSBvbkZlYXR1cmVDbGljayBpbiBjb3JlLmpzLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uRmVhdHVyZUNsaWNrKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIsIGluZGV4OiAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXRsbmc6IFtNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sYXQgKiAxZTUpIC8gMWU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sbmcgKiAxZTUpIC8gMWU1XSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiB2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDMsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsU2hhcGVzKTtcclxuICAgICAgICAgICAgICAgIGlmICh2ZWN0b3JUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UodGhpcy5nbFNoYXBlcywgdmVjdG9yTWV0YSwgdmVydGV4Q291bnRzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbFNoYXBlcykgdGhpcy5nbFNoYXBlcy5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcclxuICAgICAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xyXG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XHJcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBvaW50c0xpc3QgPSBbXTtcclxuICAgIGNvbnN0IGluZGV4TWFwcGluZyA9IFtdO1xyXG5cclxuICAgIGNvbnN0IGZhbGxiYWNrQ29sb3IgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IFwiI2U2MWEyNlwiIDogXCIjMzM4OGZmXCI7XHJcbiAgICAvLyBnbGlmeSdzIGZhbGxiYWNrIHdoZW4gYSBsYXllciBkZWNsYXJlcyBubyByYWRpdXMuIFBpbnMgbmVlZCBmYXIgbW9yZSByb29tIHRoYW4gYVxyXG4gICAgLy8gY2lyY2xlIGJlY2F1c2UgdGhlIGdseXBoIGlzIGRyYXduIGluc2lkZSB0aGUgcG9pbnQncyBvd24gcXVhZCBieSB0aGUgc2hhZGVyLlxyXG4gICAgY29uc3QgZGVmYXVsdFNpemUgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDY0IDogNTtcclxuXHJcbiAgICAvLyBHUFUgdGltZSBwYXRoOiB3aGVuIHRoaXMgYnVja2V0IGhvbGRzIHRpbWUgbGF5ZXJzLCBldmVyeSBwb2ludCBpcyBmZWQgdG8gZ2xpZnkgYW5kXHJcbiAgICAvLyBwZXItcG9pbnQgdGltZSByaWRlcyBhbG9uZyBhcyB2ZXJ0ZXggYXR0cmlidXRlcyAtLSB0aGUgd2luZG93IHRlc3QgaGFwcGVucyBpbiB0aGVcclxuICAgIC8vIHZlcnRleCBzaGFkZXIsIHNvIGEgdGljayBjb3N0cyB0d28gdW5pZm9ybXMgaW5zdGVhZCBvZiByZWJ1aWxkaW5nIDVNIHBvaW50cyBpbiBKUy5cclxuICAgIC8vIFRoZSBDUFUgZmlsdGVyIGJlbG93IHN0YXlzIGFzIHRoZSBmYWxsYmFjayB3aGVuIHRoZSBHTCB3aXJpbmcgaXMgdW5hdmFpbGFibGUuXHJcbiAgICBjb25zdCBncHVBdHRycyA9IGdwdVRpbWVBdmFpbGFibGUoKVxyXG4gICAgICAgID8gYnVpbGRUaW1lQXR0cmlidXRlcyhsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycyxcclxuICAgICAgICAgICAgdGltZVN0YXRlICYmIHRpbWVTdGF0ZS5wZXJpb2QgPyBwZXJpb2RUb01zKHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbClcclxuICAgICAgICA6IHsgaGFzVGltZTogZmFsc2UgfTtcclxuICAgIGNvbnN0IGdwdVRpbWUgPSBCb29sZWFuKGdwdUF0dHJzLmhhc1RpbWUpO1xyXG5cclxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgIGNvbnN0IGNvbG9yUkdCID0gcGFyc2VDb2xvcihsYXllci5jb2xvciwgZmFsbGJhY2tDb2xvcik7XHJcbiAgICAgICAgY29uc3QgbGF5ZXJTaXplID0gbGF5ZXIucmFkaXVzICE9IG51bGwgPyBOdW1iZXIobGF5ZXIucmFkaXVzKSA6IGRlZmF1bHRTaXplO1xyXG5cclxuICAgICAgICBjb25zdCBjb29yZEJ1ZmZlciA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgICAgICBpZiAoIWNvb3JkQnVmZmVyKSB7XHJcbiAgICAgICAgICAgIGlmIChsYXllci5sb2NhdGlvbiAmJiBsYXllckluV2luZG93KGxheWVyLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSkge1xyXG4gICAgICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtsYXllci5sb2NhdGlvblswXSwgbGF5ZXIubG9jYXRpb25bMV1dKTtcclxuICAgICAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxJbmRleDogMCxcclxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3JSR0IsXHJcbiAgICAgICAgICAgICAgICAgICAgc2l6ZTogbGF5ZXJTaXplXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ1ZmZlcixcclxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZU9mZnNldCxcclxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZUxlbmd0aCAvIDhcclxuICAgICAgICApO1xyXG4gICAgICAgIGNvbnN0IGNvdW50ID0gY29vcmRzLmxlbmd0aCAvIDI7XHJcblxyXG4gICAgICAgIGNvbnN0IHBlckZlYXR1cmUgPSBBcnJheS5pc0FycmF5KGxheWVyLmZlYXR1cmVfc3R5bGVzKSA/IGxheWVyLmZlYXR1cmVfc3R5bGVzIDogbnVsbDtcclxuICAgICAgICAvLyBTZWxlY3Rpb24gc3R5bGluZywgYXBwbGllZCBvdmVyIHRoZSBsYXllcidzIG93biBhbmQgaXRzIGRhdGEtZHJpdmVuIHN0eWxlcy5cclxuICAgICAgICAvLyBTYW1lIHByZWNlZGVuY2UgYXMgc3R5bGVGb3I6IGRhdGEsIHRoZW4gd2hvbGUtbGF5ZXIgaGlnaGxpZ2h0LCB0aGVuIHBlci1mZWF0dXJlLlxyXG4gICAgICAgIGNvbnN0IGhpZ2hsaWdodCA9IGxheWVyLmhpZ2hsaWdodF9zdHlsZSB8fCBudWxsO1xyXG4gICAgICAgIGNvbnN0IG92ZXJyaWRlcyA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyB8fCBudWxsO1xyXG4gICAgICAgIC8vIERhdGEtZHJpdmVuIHN0eWxpbmcgYXJyaXZlcyBhcyBiaW5hcnkgYnVmZmVycyBiZXNpZGUgdGhlIGNvb3JkaW5hdGVzIC0tXHJcbiAgICAgICAgLy8gdTggUkdCQSB1bmRlciBcIjxpZD46OmNvbG9yc1wiLCBmMzIgcGl4ZWxzIHVuZGVyIFwiPGlkPjo6cmFkaWlcIiAtLSBjb21wdXRlZFxyXG4gICAgICAgIC8vIGluIFB5dGhvbiBmcm9tIGNvbG9yX2NvbC9yYWRpdXNfY29sLiBCdWZmZXJzLCBuZXZlciBwZXItZmVhdHVyZSBzdHlsZVxyXG4gICAgICAgIC8vIGRpY3RzOiBhdCBtaWxsaW9ucyBvZiBwb2ludHMsIHN0eWxlIGRpY3RzIGluIHRoZSBsYXllcnMgSlNPTiBhcmUgdGhlXHJcbiAgICAgICAgLy8gcGF5bG9hZCB0aGF0IHVzZWQgdG8ga2lsbCBzZXNzaW9ucy4gRXhwbGljaXQgc3R5bGVzIHN0aWxsIG91dHJhbmsgdGhlbS5cclxuICAgICAgICBjb25zdCBjb2xvcnNSYXcgPSBjb29yZGluYXRlQnVmZmVyc1tgJHtsYXllci5pZH06OmNvbG9yc2BdO1xyXG4gICAgICAgIGNvbnN0IGJ1ZkNvbG9ycyA9IGNvbG9yc1Jhd1xyXG4gICAgICAgICAgICA/IG5ldyBVaW50OEFycmF5KGNvbG9yc1Jhdy5idWZmZXIgfHwgY29sb3JzUmF3LCBjb2xvcnNSYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yc1Jhdy5ieXRlTGVuZ3RoKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgcmFkaWlSYXcgPSBjb29yZGluYXRlQnVmZmVyc1tgJHtsYXllci5pZH06OnJhZGlpYF07XHJcbiAgICAgICAgY29uc3QgYnVmUmFkaWkgPSByYWRpaVJhd1xyXG4gICAgICAgICAgICA/IG5ldyBGbG9hdDMyQXJyYXkocmFkaWlSYXcuYnVmZmVyIHx8IHJhZGlpUmF3LCByYWRpaVJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByYWRpaVJhdy5ieXRlTGVuZ3RoIC8gNClcclxuICAgICAgICAgICAgOiBudWxsO1xyXG4gICAgICAgIC8vIFRoZSBjdXJyZW50IHRpbWUgd2luZG93LCB3aGVuIHRoaXMgbGF5ZXIgaXMgYW5pbWF0ZWQuIEZlYXR1cmVzIG91dHNpZGUgaXQgYXJlXHJcbiAgICAgICAgLy8gc2ltcGx5IG5vdCBwdXNoZWQ7IGluZGV4TWFwcGluZyBjYXJyaWVzIG9yaWdpbmFsSW5kZXgsIHNvIHBvcHVwcyBhbmQgcHJvcGVydGllc1xyXG4gICAgICAgIC8vIG9uIHRoZSBzdXJ2aXZvcnMga2VlcCBwb2ludGluZyBhdCB0aGUgcmlnaHQgcm93cy5cclxuICAgICAgICBjb25zdCB3aW4gPSAhZ3B1VGltZSAmJiB0aW1lU3RhdGUgJiYgbGF5ZXIudGltZVxyXG4gICAgICAgICAgICA/IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IHdpbiA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xyXG5cclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcclxuICAgICAgICAgICAgaWYgKHRpbWVzICYmICFmZWF0dXJlSW5XaW5kb3codGltZXNbaSAqIDJdLCB0aW1lc1tpICogMiArIDFdLCB3aW4pKSBjb250aW51ZTtcclxuICAgICAgICAgICAgY29uc3QgZnJvbURhdGEgPSBwZXJGZWF0dXJlID8gcGVyRmVhdHVyZVtpXSA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gb3ZlcnJpZGVzID8gb3ZlcnJpZGVzW2ldIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgY29sb3IgPSAoc2VsZWN0ZWQgJiYgc2VsZWN0ZWQuY29sb3IpXHJcbiAgICAgICAgICAgICAgICB8fCAoaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5jb2xvcilcclxuICAgICAgICAgICAgICAgIHx8IChmcm9tRGF0YSAmJiBmcm9tRGF0YS5jb2xvcik7XHJcbiAgICAgICAgICAgIGNvbnN0IHJhZGl1cyA9IHNlbGVjdGVkICYmIHNlbGVjdGVkLnJhZGl1cyAhPSBudWxsID8gc2VsZWN0ZWQucmFkaXVzXHJcbiAgICAgICAgICAgICAgICA6IGhpZ2hsaWdodCAmJiBoaWdobGlnaHQucmFkaXVzICE9IG51bGwgPyBoaWdobGlnaHQucmFkaXVzXHJcbiAgICAgICAgICAgICAgICA6IGZyb21EYXRhICYmIGZyb21EYXRhLnJhZGl1cyAhPSBudWxsID8gZnJvbURhdGEucmFkaXVzXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcblxyXG4gICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2Nvb3Jkc1tpICogMl0sIGNvb3Jkc1tpICogMiArIDFdXSk7XHJcbiAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IGksXHJcbiAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3IgPyBwYXJzZUNvbG9yKGNvbG9yLCBmYWxsYmFja0NvbG9yKVxyXG4gICAgICAgICAgICAgICAgICAgIDogYnVmQ29sb3JzID8geyByOiBidWZDb2xvcnNbaSAqIDRdIC8gMjU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnOiBidWZDb2xvcnNbaSAqIDQgKyAxXSAvIDI1NSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYjogYnVmQ29sb3JzW2kgKiA0ICsgMl0gLyAyNTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGE6IGJ1ZkNvbG9yc1tpICogNCArIDNdIC8gMjU1IH1cclxuICAgICAgICAgICAgICAgICAgICA6IGNvbG9yUkdCLFxyXG4gICAgICAgICAgICAgICAgc2l6ZTogcmFkaXVzICE9IG51bGwgPyBOdW1iZXIocmFkaXVzKVxyXG4gICAgICAgICAgICAgICAgICAgIDogYnVmUmFkaWkgPyBidWZSYWRpaVtpXVxyXG4gICAgICAgICAgICAgICAgICAgIDogbGF5ZXJTaXplXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAocG9pbnRzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG5cclxuICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XHJcbiAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcclxuICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgZ2V0SW50ZXJhY3RpdmVFbCA9ICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKSB8fCBtYXAuZ2V0Q29udGFpbmVyKCk7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gZ2V0SW50ZXJhY3RpdmVFbCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgZ2xpZnlPcHRpb25zID0ge1xyXG4gICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgZGF0YTogcG9pbnRzTGlzdCxcclxuICAgICAgICAgICAgICAgIHBhbmU6IFwicG9pbnRzUGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZWQgcGVyIHBvaW50LCBsaWtlIGNvbG91cjogc2V2ZXJhbCBsYXllcnMgc2hhcmUgb25lIGdsaWZ5IGluc3RhbmNlLFxyXG4gICAgICAgICAgICAgICAgLy8gc28gYSBzaW5nbGUgY29uc3RhbnQgaGVyZSBzaWxlbnRseSBkaXNjYXJkZWQgZXZlcnkgbGF5ZXIncyBvd24gcmFkaXVzLlxyXG4gICAgICAgICAgICAgICAgc2l6ZTogKGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gJiYgaW5mby5zaXplICE9IG51bGwgPyBpbmZvLnNpemUgOiBkZWZhdWx0U2l6ZTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvID8gaW5mby5jb2xvclJHQiA6IHsgcjogMC4yLCBnOiAwLjUsIGI6IDEuMCB9O1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHBpY2tpbmc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBzZW5zaXRpdml0eTogdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyMCA6IDgsXHJcbiAgICAgICAgICAgICAgICBjbGljazogKGUsIHBvaW50KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFwb2ludCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHBvcHVwcyBvbiBmYXIgYXdheSBjbGlja3NcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGlja1BvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoTC5sYXRMbmcocG9pbnRbMF0sIHBvaW50WzFdKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gY2xpY2tQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwaXhlbERpc3QgPiBtYXhEaXN0KSByZXR1cm47XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIEJFRk9SRSBjb21wZXRpbmcgZm9yIHRoZSBjbGljazogYSBoaWRkZW4gb3JcclxuICAgICAgICAgICAgICAgICAgICAvLyBvdXQtb2Ytd2luZG93IHBvaW50IG11c3Qgbm90IGVudGVyIHRoZSBhcmJpdHJhdGlvbiBhdCBhbGwsIHNvXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gd2hhdGV2ZXIgc2l0cyBiZW5lYXRoIGl0IC0tIGEgdmlzaWJsZSBmZWF0dXJlLCBvciB0aGVcclxuICAgICAgICAgICAgICAgICAgICAvLyBlbXB0eS1tYXAgZmFsbGJhY2sgLS0gd2lucyBpbnN0ZWFkLlxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJlSW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcHJlSW5mbyB8fCAhdmlzaWJsZU5vdyhwcmVJbmZvLmxheWVyLCBwcmVJbmZvLm9yaWdpbmFsSW5kZXgpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMSwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gcHJlSW5mbztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gaW5mby5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBUaGUgY2xpY2tlZCBwb2ludCdzIG93biBjb29yZGluYXRlcyAtLSBtb3JlIHRydXRoZnVsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGFuIHRoZSBtb3VzZSBwb3NpdGlvbiBmb3IgYSBwb2ludC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uRmVhdHVyZUNsaWNrKHsgbGF5ZXIsIGluZGV4OiBvcmlnaW5hbEluZGV4LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXRsbmc6IFtwb2ludFswXSwgcG9pbnRbMV1dIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwb2ludCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBob3ZlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWluZm8gfHwgIXZpc2libGVOb3coaW5mby5sYXllciwgaW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLmZyYWdtZW50U2hhZGVyU291cmNlID0gKCkgPT4gcGluU2hhZGVyO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLnZlcnRleFNoYWRlclNvdXJjZSA9ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLmdsUG9pbnRzID0gTC5nbGlmeS5wb2ludHMoZ2xpZnlPcHRpb25zKTtcclxuICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFBvaW50cyk7XHJcbiAgICAgICAgICAgIGlmIChncHVUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBOdWxsIG9uIGZhaWx1cmUsIHdoaWNoIGFsc28gZmxpcHMgdGhlIGdsb2JhbCBmbGFnOiB0aGUgbmV4dCBzeW5jJ3NcclxuICAgICAgICAgICAgICAgIC8vIHJlYnVpbGQga2V5IGNoYW5nZXMgd2l0aCBpdCBhbmQgdGhlIENQVSBwYXRoIHRha2VzIG92ZXIuXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9JbnN0YW5jZSh0aGlzLmdsUG9pbnRzLCBncHVBdHRycyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5nbFBvaW50cykgdGhpcy5nbFBvaW50cy5yZW1vdmUoKTtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhbnZhcyA9IG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xyXG4gICAgICAgICAgICBpZiAoY2FudmFzKSBjYW52YXMuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xyXG4gICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XHJcbiAgICByZXR1cm4gaW5zdGFuY2U7XHJcbn1cclxuIiwgIi8vIFBlcm1hbmVudCBmZWF0dXJlIGxhYmVsczogdGV4dCBwaW5uZWQgdG8gdGhlIG1hcCwgZnJvbSBhIGxheWVyJ3MgYGxhYmVsYCAob25lXHJcbi8vIHZlY3RvciBmZWF0dXJlKSBvciBgbGFiZWxzYCAob25lIHBlciBwb2ludCwgYWxpZ25lZCB3aXRoIHRoZSBjb29yZGluYXRlIGJ1ZmZlcikuXHJcbi8vIERPTSBlbGVtZW50cyBieSBkZXNpZ24gLS0gTGVhZmxldCBwZXJtYW5lbnQgdG9vbHRpcHMgLS0gd2hpY2ggaXMgd2h5IHRoZXkgYXJlIGZvclxyXG4vLyBzaXRlLXNjYWxlIGxheWVyczsgUHl0aG9uIHdhcm5zIHBhc3QgYSB0aG91c2FuZC4gTW9kZWwtZnJlZSBsaWtlIHRoZSBsZWdlbmQ6IHB1cmVcclxuLy8gZGF0YSBpbiwgTGVhZmxldCBsYXllcnMgb3V0LCByZS1kZXJpdmVkIGVhY2ggc3luYyBzbyBsYWJlbHMgZm9sbG93IHZpc2liaWxpdHlcclxuLy8gd2l0aG91dCB0b3VjaGluZyB0aGUgR0wgYnVja2V0cyBvciB0aGVpciBtZXRhIGtleXMuXHJcblxyXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSB9IGZyb20gXCIuL3BhdGNoLmpzXCI7XHJcbmltcG9ydCB7IHZlY3RvckNvb3JkcywgbGluZVBhcnRzIH0gZnJvbSBcIi4vbGF5ZXJzLmpzXCI7XHJcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCBlZmZlY3RpdmVEdXJhdGlvbiwgdGltZXNGb3IgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5cclxuLy8gV2hldGhlciBhIHdob2xlIGxhYmVsbGVkIGZlYXR1cmUgaXMgaW5zaWRlIHRoZSBjdXJyZW50IHRpbWUgd2luZG93LiBOYU4gdGltZXNcclxuLy8ga2VlcCB0aGUgbGFiZWwsIG1hdGNoaW5nIHRoZSBtYXA6IGFuIHVucmVhZGFibGUgdGltZSBuZXZlciBoaWRlcyBkYXRhLCBzbyBpdFxyXG4vLyBtdXN0IG5ldmVyIGhpZGUgdGhlIGRhdGEncyBsYWJlbCBlaXRoZXIuIEEgbXVsdGktc3BhbiBsaW5lIGNvdW50cyBhcyB2aXNpYmxlXHJcbi8vIHdoaWxlIEFOWSBvZiBpdHMgc2VnbWVudHMgaXMgLS0gdGhlIGxhYmVsIGZvbGxvd3MgdGhlIGxheWVyLCBub3Qgb25lIGxlZy5cclxuZnVuY3Rpb24gdGltZVZpc2libGUobGF5ZXIsIGJ1ZmZlcnMsIHRpbWVTdGF0ZSkge1xyXG4gICAgaWYgKCF0aW1lU3RhdGUgfHwgIWxheWVyLnRpbWUpIHJldHVybiB0cnVlO1xyXG4gICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihsYXllciwgYnVmZmVycyk7XHJcbiAgICBpZiAoIXRpbWVzIHx8IHRpbWVzLmxlbmd0aCA8IDIpIHJldHVybiB0cnVlO1xyXG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUucGVyaW9kKTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgaWYgKGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICAgIHJldHVybiBmYWxzZTtcclxufVxyXG5cclxuLy8gT25lIGFuY2hvciBwZXIgbGFiZWxsZWQgZmVhdHVyZS4gUG9pbnRzIGxhYmVsIGF0IHRoZSBwb2ludDsgYSBsaW5lIGxhYmVscyBhdCBpdHNcclxuLy8gbWlkZGxlIHZlcnRleCAob24gdGhlIGxpbmUsIG5vdCBmbG9hdGluZyBpbiBpdHMgYm91bmRpbmcgYm94KTsgYSBwb2x5Z29uIG9yXHJcbi8vIGNpcmNsZSBsYWJlbHMgYXQgaXRzIGJvdW5kcyBjZW50cmUuIFdpdGggYSB0aW1lU3RhdGUsIGxhYmVscyBmb2xsb3cgdGhlIHdpbmRvdzpcclxuLy8gcG9pbnRzIGRyb3AgcGVyIHBvaW50LCB2ZWN0b3JzIGFzIGEgd2hvbGUuXHJcbi8vIERlZ3JlZS1zcGFjZSBsZW5ndGggb2YgYSBbbGF0LCBsbmddIHJ1biAtLSBvbmx5IGV2ZXIgY29tcGFyZWQgYWdhaW5zdCBhbm90aGVyXHJcbi8vIHBhcnQgb2YgdGhlIHNhbWUgbGluZSwgc28gbm8gcHJvamVjdGlvbiBpcyBuZWVkZWQgdG8gcGljayB0aGUgbG9uZ2VyIG9uZS5cclxuZnVuY3Rpb24gcGxhbmFyTGVuZ3RoKHBhcnQpIHtcclxuICAgIGxldCB0b3RhbCA9IDA7XHJcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IHBhcnQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBjb25zdCBkTGF0ID0gcGFydFtpXVswXSAtIHBhcnRbaSAtIDFdWzBdO1xyXG4gICAgICAgIGNvbnN0IGRMbmcgPSBwYXJ0W2ldWzFdIC0gcGFydFtpIC0gMV1bMV07XHJcbiAgICAgICAgdG90YWwgKz0gTWF0aC5zcXJ0KGRMYXQgKiBkTGF0ICsgZExuZyAqIGRMbmcpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRvdGFsO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdExhYmVscyhsYXllcnMsIGJ1ZmZlcnMsIGdyb3VwQ29uZmlncywgdGltZVN0YXRlID0gbnVsbCkge1xyXG4gICAgY29uc3Qgb3V0ID0gW107XHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xyXG4gICAgICAgIGlmICghaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIGNvbnRpbnVlO1xyXG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICAgICAgb3V0LnB1c2goLi4uY29sbGVjdExhYmVscyhsYXllci5sYXllcnMgfHwgW10sIGJ1ZmZlcnMsIGdyb3VwQ29uZmlncywgdGltZVN0YXRlKSk7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShsYXllci5sYWJlbHMpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJhdyA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgIGlmICghcmF3KSBjb250aW51ZTtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAgICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xyXG4gICAgICAgICAgICBjb25zdCB3aW4gPSB0aW1lU3RhdGUgJiYgbGF5ZXIudGltZVxyXG4gICAgICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlLnBlcmlvZClcclxuICAgICAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgYnVmZmVycykgOiBudWxsO1xyXG4gICAgICAgICAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKGxheWVyLmxhYmVscy5sZW5ndGgsIGNvb3Jkcy5sZW5ndGggLyAyKTtcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWxheWVyLmxhYmVsc1tpXSkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBpZiAodGltZXMgJiYgIU51bWJlci5pc05hTih0aW1lc1tpICogMl0pXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICYmICFmZWF0dXJlSW5XaW5kb3codGltZXNbaSAqIDJdLCB0aW1lc1tpICogMiArIDFdLCB3aW4pKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogY29vcmRzW2kgKiAyXSwgbG5nOiBjb29yZHNbaSAqIDIgKyAxXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsc1tpXSksIGNlbnRlcjogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgaWYgKGxheWVyLmxhYmVsKSB7XHJcbiAgICAgICAgICAgIGlmICghdGltZVZpc2libGUobGF5ZXIsIGJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5bGluZVwiKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBbmNob3IgT04gYSBwYXJ0IC0tIHRoZSBtaWRkbGUgdmVydGV4IG9mIHRoZSBsb25nZXN0IHBhcnQuIFRoZVxyXG4gICAgICAgICAgICAgICAgLy8gbWlkZGxlIG9mIGEgbXVsdGktcGFydCBsaW5lJ3Mgd2hvbGUgdmVydGV4IHJ1biBjYW4gc2l0IGluIHRoZSBnYXBcclxuICAgICAgICAgICAgICAgIC8vIGJldHdlZW4gcGFydHMsIHdoZXJlIHRoZXJlIGlzIG5vdGhpbmcgdG8gbGFiZWwuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBwYXJ0cyA9IGxpbmVQYXJ0cyhsYXllciwgYnVmZmVycyB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvbmdlc3QgPSBwYXJ0cy5yZWR1Y2UoKGJlc3QsIHBhcnQpID0+XHJcbiAgICAgICAgICAgICAgICAgICAgcGxhbmFyTGVuZ3RoKHBhcnQpID4gcGxhbmFyTGVuZ3RoKGJlc3QpID8gcGFydCA6IGJlc3QsIHBhcnRzWzBdKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1pZCA9IGxvbmdlc3RbTWF0aC5mbG9vcigobG9uZ2VzdC5sZW5ndGggLSAxKSAvIDIpXTtcclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiBtaWRbMF0sIGxuZzogbWlkWzFdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGxheWVyLmJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgW1thTGF0LCBhTG9uXSwgW2JMYXQsIGJMb25dXSA9IGxheWVyLmJvdW5kcztcclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAoYUxhdCArIGJMYXQpIC8gMiwgbG5nOiAoYUxvbiArIGJMb24pIC8gMixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGxheWVyLmxvY2F0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbGF5ZXIubG9jYXRpb25bMF0sIGxuZzogbGF5ZXIubG9jYXRpb25bMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vIE5vIGJvdW5kcyBvbiB0aGUgY29uZmlnIC0tIHRoZSBjb2xsZWN0aW9uIG1lcmdlIGRyb3BwZWQgdGhlbSBmb3JcclxuICAgICAgICAgICAgICAgIC8vIGl0cyB3aG9sZSBoaXN0b3J5LCBhbmQgaGFuZC1idWlsdCBjb25maWdzIG1heSBuZXZlciBjYXJyeSB0aGVtLlxyXG4gICAgICAgICAgICAgICAgLy8gVGhlIGNvb3JkaW5hdGVzIGFyZSBzdGlsbCBpbiB0aGUgYnVmZmVyIHVuZGVyIHRoZSBsYXllcidzIG93biBpZCxcclxuICAgICAgICAgICAgICAgIC8vIGV4YWN0bHkgYXMgdGhlIHBvbHlsaW5lIGJyYW5jaCByZWFkcyB0aGVtOyBhIG1pc3NpbmcgYm94IG11c3RcclxuICAgICAgICAgICAgICAgIC8vIGRlZ3JhZGUgdG8gY29tcHV0aW5nIG9uZSwgbmV2ZXIgdG8gc2lsZW50bHkgZHJvcHBpbmcgdGhlIGxhYmVsLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgbG9jcyA9IHZlY3RvckNvb3JkcyhsYXllciwgYnVmZmVycyB8fCB7fSkgfHwgW107XHJcbiAgICAgICAgICAgICAgICBpZiAobG9jcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgICAgICBsZXQgbWluTG5nID0gSW5maW5pdHksIG1heExuZyA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgW2xhdCwgbG5nXSBvZiBsb2NzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobG5nIDwgbWluTG5nKSBtaW5MbmcgPSBsbmc7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA+IG1heExuZykgbWF4TG5nID0gbG5nO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IChtaW5MYXQgKyBtYXhMYXQpIC8gMiwgbG5nOiAobWluTG5nICsgbWF4TG5nKSAvIDIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIFJlYnVpbGRzIGBncm91cGAgKGFuIEwubGF5ZXJHcm91cCkgdG8gaG9sZCBleGFjdGx5IHRoZSBjdXJyZW50IGxhYmVscywgc2tpcHBpbmdcclxuLy8gdGhlIHdvcmsgd2hlbiBub3RoaW5nIGNoYW5nZWQgLS0gc3luY3MgcnVuIG9uIGV2ZXJ5IHRvZ2dsZSBhbmQgdGljay5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckxhYmVscyhMLCBncm91cCwgbGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IGxhYmVscyA9IGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSk7XHJcbiAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShsYWJlbHMpO1xyXG4gICAgaWYgKGdyb3VwLl9zd2lmdG1hcExhYmVsS2V5ID09PSBrZXkpIHJldHVybjtcclxuICAgIGdyb3VwLl9zd2lmdG1hcExhYmVsS2V5ID0ga2V5O1xyXG4gICAgZ3JvdXAuY2xlYXJMYXllcnMoKTtcclxuICAgIGZvciAoY29uc3QgaXRlbSBvZiBsYWJlbHMpIHtcclxuICAgICAgICAvLyBDb250ZW50IGFzIGFuIGVsZW1lbnQgd2l0aCB0ZXh0Q29udGVudDogdG9vbHRpcCBzdHJpbmcgY29udGVudCBpcyBIVE1MLFxyXG4gICAgICAgIC8vIGFuZCBsYWJlbHMgY29tZSBmcm9tIHVzZXIgZGF0YSwgd2hpY2ggbXVzdCBuZXZlciBwYXJzZSBhcyBtYXJrdXAuXHJcbiAgICAgICAgY29uc3Qgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgIHNwYW4udGV4dENvbnRlbnQgPSBpdGVtLnRleHQ7XHJcbiAgICAgICAgY29uc3QgdG9vbHRpcCA9IEwudG9vbHRpcCh7XHJcbiAgICAgICAgICAgIHBlcm1hbmVudDogdHJ1ZSxcclxuICAgICAgICAgICAgZGlyZWN0aW9uOiBpdGVtLmNlbnRlciA/IFwiY2VudGVyXCIgOiBcInRvcFwiLFxyXG4gICAgICAgICAgICBjbGFzc05hbWU6IFwic3dpZnRtYXAtZmVhdHVyZS1sYWJlbFwiLFxyXG4gICAgICAgICAgICBvZmZzZXQ6IGl0ZW0uY2VudGVyID8gWzAsIDBdIDogWzAsIC02XSxcclxuICAgICAgICB9KS5zZXRMYXRMbmcoW2l0ZW0ubGF0LCBpdGVtLmxuZ10pLnNldENvbnRlbnQoc3Bhbik7XHJcbiAgICAgICAgZ3JvdXAuYWRkTGF5ZXIodG9vbHRpcCk7XHJcbiAgICB9XHJcbn1cclxuIiwgImltcG9ydCB7IEwsIHByb3ZpZGVMZWFmbGV0LCByZXF1aXJlTGVhZmxldCB9IGZyb20gXCIuL2xpYnMuanNcIjtcclxuaW1wb3J0IHsgcmVuZGVyU2lkZWJhckNvbnRyb2xzLCBub3JtYWxpemVSYWRpb0xheWVycywgc2lkZWJhckNvbGxhcHNlU3RhdGUgfSBmcm9tIFwiLi9zaWRlYmFyLmpzXCI7XHJcbmltcG9ydCB7IGRlcml2ZUxlZ2VuZFNwZWMsIHJlbmRlckxlZ2VuZCB9IGZyb20gXCIuL2xlZ2VuZC5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJMYWJlbHMgfSBmcm9tIFwiLi9sYWJlbHMuanNcIjtcclxuaW1wb3J0IHsgcmVuZGVyTGF5ZXIsIHJlbmRlck1lcmdlZEdsTGF5ZXIsIHJlZ2lzdGVyQ2xpY2tNYXRjaCwgaW1hZ2VNZXRhS2V5IH0gZnJvbSBcIi4vbGF5ZXJzLmpzXCI7XHJcbmltcG9ydCB7IHBhcnNlUGVyaW9kLCBnZW5lcmF0ZVRpY2tzLCBjb2xsZWN0VGltZUV4dGVudCwgaGFzVGltZUxheWVycyxcclxuICAgICAgICAgbGF5ZXJJbldpbmRvdywgcmVuZGVyVGltZUNvbnRyb2wsIGFkdmFuY2UsIHBlcmlvZFRvTXMsIGdjZEdyaWRNcyxcclxuICAgICAgICAgY29sbGVjdER1cmF0aW9uc01zLCBQT1NJVElPTlMsIHRpbWVzRm9yLCB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdyxcclxuICAgICAgICAgZWZmZWN0aXZlRHVyYXRpb24sIG5lYXJlc3RUaWNrSW5kZXggfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBncHVUaW1lQXZhaWxhYmxlLCB2ZWN0b3JHcHVBdmFpbGFibGUsIExBWUVSX1NMT1RTIH0gZnJvbSBcIi4vZ3B1dGltZS5qc1wiO1xyXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSwgY29sbGVjdFdlYmdsTGF5ZXJzLCBjb2xsZWN0UG9pbnRMYXllcnNBbGwsXHJcbiAgICAgICAgIGFwcGx5U3dpZnRtYXBQYXRjaCwgYnVmZmVyU2VyaWFsIH0gZnJvbSBcIi4vcGF0Y2guanNcIjtcclxuXHJcbi8vIFRoZSBzaWRlYmFyJ3MgdG9nZ2xlIHdyaXRlLWJhY2s6IHRhcmdldGVkIHZpc2liaWxpdHkgZmxpcHMgdGhyb3VnaCBzZW5kKCksXHJcbi8vIG5ldmVyIHRoZSBsYXllcnMgdHJhaXQuIFRoZSBmdWxsIHdyaXRlIHNjYWxlZCB3aXRoIHRoZSBtYXAgaW5zdGVhZCBvZiB0aGVcclxuLy8gY2xpY2sgLS0gMzYgTUIgYXQgMjUgdHJhY2tzIHggMjAwayB2ZXJ0aWNlcywgcGFzdCB1dmljb3JuJ3MgMTYgTUIgZGVmYXVsdFxyXG4vLyB3ZWJzb2NrZXQgY2FwLCB3aGljaCBjbG9zZXMgdGhlIGNvbm5lY3Rpb24gYW5kIGVuZHMgdGhlIFNoaW55IHNlc3Npb24uXHJcbmV4cG9ydCBmdW5jdGlvbiBzZW5kTGF5ZXJXcml0ZShob3N0LCBjaGFuZ2VzKSB7XHJcbiAgICBpZiAoIWNoYW5nZXMubGVuZ3RoKSByZXR1cm47XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGhvc3Quc2VuZCh7XHJcbiAgICAgICAgICAgIGtpbmQ6IFwic3dpZnRtYXBfd3JpdGVcIixcclxuICAgICAgICAgICAgb3BzOiBjaGFuZ2VzLm1hcChjID0+ICh7IG9wOiBcInNldFwiLCBpZDogYy5pZCwgZmllbGRzOiB7IHZpc2libGU6IGMudmlzaWJsZSB9IH0pKSxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSByZW5kZXJlZCBsaXN0IGFscmVhZHkgaG9sZHMgdGhlIGNoYW5nZSAqLyB9XHJcbn1cclxuXHJcbi8vIE1vdW50cyBvbmUgc3dpZnRtYXAgbWFwIGludG8gYGVsYCwgZHJpdmVuIGJ5IGEgaG9zdCAtLSBzZWUgc3JjL2hvc3QuanMgZm9yIHRoZVxyXG4vLyBpbnRlcmZhY2UuIFRoZSB3aWRnZXQsIGEgc3RhdGljIGV4cG9ydCBhbmQgYSBSZWFjdCBjb21wb25lbnQgYXJlIGFsbCBob3N0cyBvdmVyXHJcbi8vIHRoaXMgb25lIGZ1bmN0aW9uOyBpdCBuZXZlciBzZWVzIGFuIGFueXdpZGdldCBtb2RlbCwgb25seSB0aGUgZml2ZSBob3N0IG1ldGhvZHMuXHJcbi8vXHJcbi8vIFJldHVybnMgYSBoYW5kbGU6IHRoZSBMZWFmbGV0IG1hcCwgdGhlIGNvbnRhaW5lciBlbGVtZW50LCBhIGBzeW5jYCB0byBmb3JjZSBhXHJcbi8vIHJlLXJlbmRlciwgYW5kIGBkZXN0cm95YCB0byB0ZWFyIGV2ZXJ5dGhpbmcgZG93bi5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVN3aWZ0TWFwKHsgaG9zdCwgZWwsIGxlYWZsZXQgPSBudWxsIH0pIHtcclxuICAgIC8vIExlYWZsZXQgLS0gd2l0aCBnbGlmeSBhbmQgR2VvbWFuIGF0dGFjaGVkIC0tIGNvbWVzIGZyb20gdGhlIGhvc3QsIGFuZCBpdFxyXG4gICAgLy8gbXVzdCBhbHJlYWR5IGJlIGhlcmU6IHRoZSBtYXAgYmVsb3cgaXMgYnVpbHQgZnJvbSBpdCwgYW5kIEdlb21hbidzIGluaXRcclxuICAgIC8vIGhvb2sgb25seSByZWFjaGVzIG1hcHMgY3JlYXRlZCBhZnRlciB0aGUgcGx1Z2luIGV4aXN0cy5cclxuICAgIGlmIChsZWFmbGV0KSBwcm92aWRlTGVhZmxldChsZWFmbGV0KTtcclxuICAgIHJlcXVpcmVMZWFmbGV0KCk7XHJcblxyXG4gICAgLy8gRXZlcnkgaG9zdCBzdWJzY3JpcHRpb24sIHNvIGRlc3Ryb3koKSBjYW4gdW5zdWJzY3JpYmUgZnJvbSBhIGhvc3QgdGhhdFxyXG4gICAgLy8gb2ZmZXJzIGBvZmZgIChhbnl3aWRnZXQncyBtb2RlbCBkb2VzOyBhIG1pbmltYWwgc3R1YiBtYXkgbm90KS5cclxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBbXTtcclxuICAgIGZ1bmN0aW9uIGxpc3RlbihldmVudCwgZm4pIHtcclxuICAgICAgICBzdWJzY3JpcHRpb25zLnB1c2goW2V2ZW50LCBmbl0pO1xyXG4gICAgICAgIGhvc3Qub24oZXZlbnQsIGZuKTtcclxuICAgIH1cclxuICAgIGxldCBkZXN0cm95ZWQgPSBmYWxzZTtcclxuXHJcbiAgICBjb25zdCBvcmlnaW5hbEVycm9yID0gY29uc29sZS5lcnJvcjtcclxuICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcclxuXHJcbiAgICAvLyBqc19jb25zb2xlX2xvZ3MgaXMgYSBzeW5jZWQgbGlzdCwgc28gZWFjaCBhcHBlbmQgcmVzZW5kcyB0aGUgd2hvbGUgYXJyYXkuIEtlZXBpbmdcclxuICAgIC8vIG9ubHkgdGhlIG1vc3QgcmVjZW50IGVudHJpZXMgYm91bmRzIGJvdGggdGhlIHBheWxvYWQgYW5kIHRoZSBtZW1vcnkgYSBsb25nLWxpdmVkXHJcbiAgICAvLyBzZXNzaW9uIGFjY3VtdWxhdGVzOyB0aGUgbmV3ZXN0IGFyZSB0aGUgb25lcyB3b3J0aCBoYXZpbmcgYW55d2F5LlxyXG4gICAgY29uc3QgTUFYX0NPTlNPTEVfTE9HUyA9IDIwMDtcclxuICAgIGNvbnN0IGFwcGVuZExvZyA9IGVudHJ5ID0+IHtcclxuICAgICAgICBjb25zdCBsb2dzID0gaG9zdC5nZXQoXCJqc19jb25zb2xlX2xvZ3NcIikgfHwgW107XHJcbiAgICAgICAgY29uc3QgbmV4dCA9IFsuLi5sb2dzLCBlbnRyeV07XHJcbiAgICAgICAgcmV0dXJuIG5leHQubGVuZ3RoID4gTUFYX0NPTlNPTEVfTE9HUyA/IG5leHQuc2xpY2UoLU1BWF9DT05TT0xFX0xPR1MpIDogbmV4dDtcclxuICAgIH07XHJcblxyXG4gICAgLy8gSGVscGVyIHRvIHNhZmVseSB3cml0ZSBiYWNrIHRvIFB5dGhvbiBvbmx5IGlmIHRoZSB3aWRnZXQgdmlldyBpcyBhY3RpdmUgYW5kIGF0dGFjaGVkXHJcbiAgICBmdW5jdGlvbiBzYWZlU2V0QW5kU2F2ZShrZXksIHZhbHVlKSB7XHJcbiAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChrZXksIHZhbHVlKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcclxuICAgICAgICBpZiAoZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgc2F2ZSBlcnJvcjpcIiwgZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5lcnJvciA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcclxuICAgICAgICBvcmlnaW5hbEVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xyXG4gICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXHJcbiAgICAgICAgICAgIGFwcGVuZExvZyhcIkNPTlNPTEUuRVJST1I6IFwiICsgYXJncy5tYXAoYSA9PiBTdHJpbmcoYSkpLmpvaW4oXCIgXCIpKSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBsZXQgbG9nZ2VkUmVwcm9qZWN0ZWQgPSBmYWxzZTtcclxuICAgIGNvbnNvbGUud2FybiA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcclxuICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XHJcbiAgICAgICAgaWYgKG1zZy5pbmNsdWRlcyhcImxheWVyIGRlc2lnbmVkIGZvciBTcGhlcmljYWxNZXJjYXRvclwiKSB8fCBtc2cuaW5jbHVkZXMoXCJhbHRlcm5hdGUgZGV0ZWN0ZWRcIikpIHtcclxuICAgICAgICAgICAgaWYgKCFsb2dnZWRSZXByb2plY3RlZCkge1xyXG4gICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY3JzID0gaG9zdC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNsZWFuTXNnID0gYFtTd2lmdE1hcF0gTGF5ZXIgd2FzIHJlcHJvamVjdGVkIHRvIFwiJHtjcnN9XCJgO1xyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgY2xlYW5Nc2cpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLCBhcHBlbmRMb2coY2xlYW5Nc2cpKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXHJcbiAgICAgICAgfVxyXG4gICAgICAgIG9yaWdpbmFsV2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3Qgb25XaW5kb3dFcnJvciA9IGZ1bmN0aW9uKG1lc3NhZ2UsIHNvdXJjZSwgbGluZW5vLCBjb2xubywgZXJyb3IpIHtcclxuICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxyXG4gICAgICAgICAgICBhcHBlbmRMb2coYFdJTkRPVy5PTkVSUk9SOiAke21lc3NhZ2V9IGF0ICR7c291cmNlfToke2xpbmVub306JHtjb2xub31gKSk7XHJcbiAgICB9O1xyXG4gICAgd2luZG93Lm9uZXJyb3IgPSBvbldpbmRvd0Vycm9yO1xyXG5cclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcclxuICAgIGNvbnRhaW5lci5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xyXG4gICAgY29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xyXG4gICAgZWwuYXBwZW5kQ2hpbGQoY29udGFpbmVyKTtcclxuXHJcbiAgICAvLyBNYXAoaGVpZ2h0PS4uLikgc2l6aW5nLiBBbiBleHBsaWNpdCBoZWlnaHQgYWxzbyBkcm9wcyB0aGUgc3R5bGVzaGVldCdzXHJcbiAgICAvLyA0MDBweCBmbG9vciAtLSBhbiBleHBsaWNpdCAyMDBweCBtdXN0IG5vdCBsb3NlIHRvIGEgZGVmYXVsdCBtaW5pbXVtLlxyXG4gICAgLy8gSGVpZ2h0IHdhcyBhY2NlcHRlZCBhbmQgZG9jdW1lbnRlZCBsb25nIGJlZm9yZSBpdCByZWFjaGVkIHRoZSBET007IHRoaXNcclxuICAgIC8vIGlzIHdoZXJlIGl0IGZpbmFsbHkgZG9lcy5cclxuICAgIGZ1bmN0aW9uIGFwcGx5SGVpZ2h0KCkge1xyXG4gICAgICAgIGNvbnN0IGggPSBob3N0LmdldChcImhlaWdodFwiKTtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUuaGVpZ2h0ID0gaCB8fCBcIjEwMCVcIjtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUubWluSGVpZ2h0ID0gaCA/IFwiMFwiIDogXCJcIjtcclxuICAgIH1cclxuICAgIGFwcGx5SGVpZ2h0KCk7XHJcblxyXG4gICAgbGV0IGxhYmVsc0dyb3VwID0gbnVsbDsgICAvLyBjcmVhdGVkIGFmdGVyIHRoZSBtYXA7IGZpbGxlZCBieSBlYWNoIHN5bmNcclxuXHJcbiAgICBjb25zdCBjcnNOYW1lID0gaG9zdC5nZXQoXCJjcnNcIik7XHJcbiAgICBsZXQgbWFwQ3JzID0gTC5DUlMuRVBTRzM4NTc7XHJcbiAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xyXG4gICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1hcCA9IEwubWFwKGNvbnRhaW5lciwge1xyXG4gICAgICAgIGNyczogbWFwQ3JzLFxyXG4gICAgICAgIGNlbnRlcjogaG9zdC5nZXQoXCJjZW50ZXJcIiksXHJcbiAgICAgICAgem9vbTogaG9zdC5nZXQoXCJ6b29tXCIpLFxyXG4gICAgICAgIHNjcm9sbFdoZWVsWm9vbTogdHJ1ZSxcclxuICAgICAgICBwcmVmZXJDYW52YXM6IHRydWVcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcclxuICAgIG1hcC5nZXRQYW5lKFwicG9seWdvbnNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDEwXCI7XHJcbiAgICBcclxuICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcclxuICAgIG1hcC5nZXRQYW5lKFwicG9seWxpbmVzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQyMFwiO1xyXG4gICAgXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MzBcIjtcclxuXHJcbiAgICAvLyBEcmF3biB2ZWN0b3JzIGxpdmUgQUJPVkUgdGhlIEdMIHBhbmVzLiBHZW9tYW4gZGVmYXVsdHMgdGhlbSBpbnRvIExlYWZsZXQnc1xyXG4gICAgLy8gb3ZlcmxheVBhbmUgKDQwMCksIHdoaWNoIHNpdHMgdW5kZXIgdGhlIEdMIGNhbnZhc2VzICg0MTAvNDIwLzQzMCkgd2hvc2VcclxuICAgIC8vIHBvaW50ZXItZXZlbnRzIGFyZSBmb3JjZWQgb24gLS0gc28gd2l0aCBhbnkgR0wgbGF5ZXIgcHJlc2VudCwgY2xpY2tzIG1lYW50XHJcbiAgICAvLyBmb3IgYSBkcmF3biBzaGFwZSBuZXZlciBhcnJpdmVkOiBkcmF3aW5nIHdvcmtlZCAoR2VvbWFuIGxpc3RlbnMgb24gdGhlXHJcbiAgICAvLyBjb250YWluZXIpIHdoaWxlIHJlbW92YWwsIGVkaXQgYW5kIGRyYWcgc2lsZW50bHkgZGlkIG5vdGhpbmcuXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0NDBcIjtcclxuXHJcbiAgICBsYWJlbHNHcm91cCA9IEwubGF5ZXJHcm91cCgpLmFkZFRvKG1hcCk7XHJcblxyXG4gICAgLy8gTG9jYWwgbWlycm9ycyBvZiB0aGUgbGF5ZXIgbGlzdCBhbmQgY29vcmRpbmF0ZSBidWZmZXJzLlxyXG4gICAgLy9cclxuICAgIC8vIFB5dGhvbiB1cGRhdGVzIHRoZXNlIGluY3JlbWVudGFsbHkgdmlhIFwic3dpZnRtYXBfcGF0Y2hcIiBtZXNzYWdlcyBpbnN0ZWFkIG9mXHJcbiAgICAvLyByZWFzc2lnbmluZyB0aGUgdHJhaXRzLCBiZWNhdXNlIGEgdHJhaXQgcmVhc3NpZ25tZW50IHJlLXNlcmlhbGl6ZXMgYW5kIHJlLXNlbmRzXHJcbiAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxyXG4gICAgLy8gd2hlbiBhIHZpZXcgYXR0YWNoZXMsIGFuZCB0aGUgc2lkZWJhciBzdGlsbCB3cml0ZXMgYGxheWVyc2AgYmFjayBvbiB0b2dnbGUsIHNvXHJcbiAgICAvLyBib3RoIGFyZSBzZWVkZWQgaGVyZSBhbmQga2VwdCBpbiBzdGVwIGJ5IHRoZSBjaGFuZ2UgaGFuZGxlcnMgZnVydGhlciBkb3duLlxyXG4gICAgbGV0IGxheWVyU3RhdGUgPSBob3N0LmdldChcImxheWVyc1wiKSB8fCBbXTtcclxuICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKGhvc3QuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIGFwcGx5UGF0Y2hPcHMob3BzLCBidWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcclxuICAgICAgICBsYXllclN0YXRlID0gbmV4dC5sYXllcnM7XHJcbiAgICAgICAgYnVmZmVyU3RhdGUgPSBuZXh0LmJ1ZmZlcnM7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTGl2ZSBmZWF0dXJlIHZpc2liaWxpdHksIGZvciBoaXQtdGVzdGluZy4gR1BVLXBhdGggYnVja2V0cyBrZWVwIEVWRVJZXHJcbiAgICAvLyBsYXllciAtLSBoaWRkZW4gb25lcyBhcmUgbWFza2VkIGJ5IGEgc2hhZGVyIHVuaWZvcm0gLS0gYW5kIGdsaWZ5J3NcclxuICAgIC8vIGhpdC10ZXN0cyBydW4gYWdhaW5zdCB0aGUgYnVja2V0J3MgZGF0YSwgd2hpY2ggY2Fubm90IHNlZSB1bmlmb3JtczogYVxyXG4gICAgLy8gcmFkaW8taGlkZGVuIGxheWVyJ3MgZmVhdHVyZXMgc3RpbGwgd29uIGNsaWNrcyBhbmQgYW5zd2VyZWQgd2l0aCBwb3B1cHMuXHJcbiAgICAvLyBMb29rZWQgdXAgZnJlc2ggcGVyIGV2ZW50LCBiZWNhdXNlIHRoZSBjb25maWcgY2FwdHVyZWQgYXQgYnVpbGQgdGltZSBnb2VzXHJcbiAgICAvLyBzdGFsZSB0aGUgbW9tZW50IGEgcGF0Y2ggb3AgcmVwbGFjZXMgaXQ7IHRoZSB0aW1lIGNoZWNrIHJlYWRzIHRoZSBsaXZlXHJcbiAgICAvLyB0aWNrIHRoZSBzYW1lIHdheSwgc2luY2UgdGlja3MgY2hhbmdlIHdpdGhvdXQgcmVidWlsZGluZyB0aGUgYnVja2V0LlxyXG4gICAgZnVuY3Rpb24gZmluZExheWVyTm93KGxpc3QsIGlkKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBsIG9mIGxpc3QpIHtcclxuICAgICAgICAgICAgaWYgKGwuaWQgPT09IGlkKSByZXR1cm4gbDtcclxuICAgICAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdWIgPSBmaW5kTGF5ZXJOb3cobC5sYXllcnMgfHwgW10sIGlkKTtcclxuICAgICAgICAgICAgICAgIGlmIChzdWIpIHJldHVybiBzdWI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiBmZWF0dXJlVmlzaWJsZU5vdyhsYXllciwgaW5kZXgpIHtcclxuICAgICAgICBjb25zdCBjdXJyZW50ID0gZmluZExheWVyTm93KGxheWVyU3RhdGUsIGxheWVyLmlkKSB8fCBsYXllcjtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGN1cnJlbnQsIGhvc3QuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWN1cnJlbnQudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGN1cnJlbnQsIGJ1ZmZlclN0YXRlKTtcclxuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICBjb25zdCB3aW4gPSB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssXHJcbiAgICAgICAgICAgIGVmZmVjdGl2ZUR1cmF0aW9uKGN1cnJlbnQsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xyXG4gICAgICAgIGlmIChpbmRleCAhPSBudWxsICYmIHRpbWVzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lc1tpbmRleCAqIDJdO1xyXG4gICAgICAgICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHN0YXJ0KVxyXG4gICAgICAgICAgICAgICAgfHwgZmVhdHVyZUluV2luZG93KHN0YXJ0LCB0aW1lc1tpbmRleCAqIDIgKyAxXSwgd2luKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKVxyXG4gICAgICAgICAgICAgICAgICAgIHx8IGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEZlYXR1cmUgY2xpY2tzLCB3cml0dGVuIHRvIHRoZSBob3N0IEJBUkUgLS0gbm8gZ2F0aW5nIG9uIGEgY29tbSBwcm9wZXJ0eTpcclxuICAgIC8vIHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vbmUsIGFuZCBnYXRpbmcgb24gaXQgc2lsZW50bHkga2lsbGVkIGV2ZXJ5XHJcbiAgICAvLyB3cml0ZWJhY2sgdW5kZXIgU2hpbnkuIE9uZSBrZXkgYWx3YXlzIGFuc3dlcnMgXCJ3aGVyZVwiIChjbGlja2VkX2xhdGxuZyksXHJcbiAgICAvLyBjbGlja2VkX2xheWVyX2lkIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKSwgYW5kIGNsaWNrX3NlcSBidW1wc1xyXG4gICAgLy8gb24gRVZFUlkgY2xpY2sgc28gYSByZXBlYXQgY2xpY2sgb24gdGhlIHNhbWUgZmVhdHVyZSBzdGlsbCBmaXJlcy5cclxuICAgIGNvbnN0IGxheWVyRXZlbnRzID0ge1xyXG4gICAgICAgIG9uRmVhdHVyZUNsaWNrOiAoeyBsYXllciwgaW5kZXgsIGxhdGxuZyB9KSA9PiB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBpbmRleCk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF0bG5nXCIsIGxhdGxuZyk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrX3NlcVwiLCAoaG9zdC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGFjdGl2ZVRpbGVMYXllcnMgPSB7fTtcclxuICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcclxuICAgIGNvbnN0IGdsU3RhdGVzID0ge1xyXG4gICAgICAgIGNpcmNsZV9tYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcclxuICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcclxuICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXHJcbiAgICAgICAgcG9seWdvbjogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH1cclxuICAgIH07XHJcblxyXG4gICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xyXG4gICAgLy8gYW5kIHRoZSBwZXJpb2QsIG9yIG51bGwgd2hlbiBub3RoaW5nIGlzIGFuaW1hdGVkIC0tIGFuZCBgdGltZVVJYCBpcyB0aGUgc2xpZGVyJ3NcclxuICAgIC8vIG93biBib29ra2VlcGluZy4gUGxheWJhY2sgbmV2ZXIgcm91bmQtdHJpcHMgdGhyb3VnaCBQeXRob246IHRpY2tzIHJlLXJlbmRlclxyXG4gICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXHJcbiAgICBsZXQgdGltZVN0YXRlID0gbnVsbDtcclxuICAgIGNvbnN0IHRpbWVVSSA9IHsgdGlja3M6IFtdLCBrZXk6IFwiXCIsIGluZGV4OiAwLCBwbGF5aW5nOiBmYWxzZSwgbG9vcDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgd2luZG93OiBudWxsLCBwZXJpb2RNczogbnVsbCwgZ3JpZE1zOiBudWxsIH07XHJcblxyXG4gICAgZnVuY3Rpb24gc3RvcFBsYXliYWNrKCkge1xyXG4gICAgICAgIGlmICh0aW1lVUkudGltZXIpIGNsZWFySW50ZXJ2YWwodGltZVVJLnRpbWVyKTtcclxuICAgICAgICB0aW1lVUkudGltZXIgPSBudWxsO1xyXG4gICAgICAgIHRpbWVVSS5wbGF5aW5nID0gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gd3JpdGVUaW1lQ3VycmVudChmb3JjZSkge1xyXG4gICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgaWYgKCFmb3JjZSAmJiBub3cgLSB0aW1lVUkubGFzdFdyaXRlIDwgMTAwMCkgcmV0dXJuO1xyXG4gICAgICAgIHRpbWVVSS5sYXN0V3JpdGUgPSBub3c7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaG9zdC5zZXQoXCJ0aW1lX2N1cnJlbnRcIiwgdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pO1xyXG4gICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHNlZWtUbyhpbmRleCwgeyB3cml0ZSA9IHRydWUgfSA9IHt9KSB7XHJcbiAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kLFxyXG4gICAgICAgICAgICAgICAgICAgICAgd2luZG93OiB0aW1lVUkud2luZG93IH07XHJcbiAgICAgICAgaWYgKHdyaXRlKSB3cml0ZVRpbWVDdXJyZW50KCF0aW1lVUkucGxheWluZyk7XHJcbiAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBzdGFydFBsYXliYWNrKCkge1xyXG4gICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgIHRpbWVVSS5wbGF5aW5nID0gdHJ1ZTtcclxuICAgICAgICB0aW1lVUkudGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhZHZhbmNlKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCwgdGltZVVJLmxvb3ApO1xyXG4gICAgICAgICAgICBpZiAoIW5leHQucGxheWluZykge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBzZWVrVG8obmV4dC5pbmRleCk7XHJcbiAgICAgICAgfSwgMTAwMCAvIHRpbWVVSS5zcGVlZCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdGltZUhhbmRsZXJzID0ge1xyXG4gICAgICAgIG9uU2VlazogKGluZGV4KSA9PiBzZWVrVG8oaW5kZXgpLFxyXG4gICAgICAgIG9uU3RlcEJhY2s6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggLSAxKSxcclxuICAgICAgICBvblN0ZXBGb3J3YXJkOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4ICsgMSksXHJcbiAgICAgICAgb25QbGF5VG9nZ2xlOiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gc3RhcnRPdmVyLCBhcyB0aGUgZm9saXVtIHBsYXllciB3YXMgY29uZmlndXJlZDogcHJlc3NpbmcgcGxheSBhdFxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGVuZCByZXN0YXJ0cyBmcm9tIHRoZSBiZWdpbm5pbmcgaW1tZWRpYXRlbHksIHJhdGhlciB0aGFuIG9uZVxyXG4gICAgICAgICAgICAgICAgLy8gc2lsZW50IGludGVydmFsIGxhdGVyIGRlY2lkaW5nIHRoZXJlIGlzIG5vd2hlcmUgdG8gZ28gYW5kIHN0b3BwaW5nLlxyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5pbmRleCA+PSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkgc2Vla1RvKDApO1xyXG4gICAgICAgICAgICAgICAgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLmxvb3AgPSAhdGltZVVJLmxvb3A7XHJcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvblNwZWVkOiAoc3BlZWQpID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gc3BlZWQ7XHJcbiAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gTGl2ZSBkdXJpbmcgdGhlIGRyYWc6IGxvY2FsIHN0YXRlIGFuZCBhIHJlLXJlbmRlciBvZiB0aGUgY29udHJvbCBvbiBldmVyeVxyXG4gICAgICAgIC8vIG1vdmUsIGJ1dCBtYXAgcmVidWlsZHMgYXQgbW9zdCBldmVyeSAzMDBtcy4gQXQgNU0gcG9pbnRzIGEgcmVidWlsZCBjb3N0c1xyXG4gICAgICAgIC8vIHNlY29uZHMsIGFuZCBhIGRyYWcgZmlyZXMgZG96ZW5zIG9mIG1vdmVzIC0tIHVudGhyb3R0bGVkLCB0aGUgcmVidWlsZHNcclxuICAgICAgICAvLyBzdGFjayBmYXN0ZXIgdGhhbiB0aGV5IGZpbmlzaCBhbmQgdGhlIGFsbG9jYXRpb24gY2h1cm4gY3Jhc2hlcyB0aGUgdGFiLlxyXG4gICAgICAgIG9uV2luZG93RHJhZzogKGlzbykgPT4ge1xyXG4gICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBpc287XHJcbiAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHRpbWVTdGF0ZSA9IHsgLi4udGltZVN0YXRlLCB3aW5kb3c6IGlzbyB9O1xyXG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICBpZiAobm93IC0gKHRpbWVVSS5sYXN0RHJhZ1N5bmMgfHwgMCkgPj0gMzAwKSB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkubGFzdERyYWdTeW5jID0gbm93O1xyXG4gICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIE9uIHJlbGVhc2UgKG9yIGEga2V5Ym9hcmQgc3RlcCk6IHRoZSBvdmVycmlkZSBsYW5kcyBpbiB0aW1lX2NvbmZpZyBzb1xyXG4gICAgICAgIC8vIFB5dGhvbiBhbmQgU2hpbnkgc2VlIHRoZSBzYW1lIHdpbmRvdyB0aGUgYmFyIHNob3dzLiBudWxsIGNsZWFycyB0aGUga2V5LFxyXG4gICAgICAgIC8vIGhhbmRpbmcgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXHJcbiAgICAgICAgb25XaW5kb3dDb21taXQ6IChpc28pID0+IHtcclxuICAgICAgICAgICAgdGltZUhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xyXG4gICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTsgICAgICAgLy8gdGhlIHJlbGVhc2UgYWx3YXlzIGxhbmRzLCB0aHJvdHRsZSBvciBub3RcclxuICAgICAgICAgICAgY29uc3QgY2ZnID0geyAuLi4oaG9zdC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fSkgfTtcclxuICAgICAgICAgICAgaWYgKGlzbykgY2ZnLndpbmRvdyA9IGlzbztcclxuICAgICAgICAgICAgZWxzZSBkZWxldGUgY2ZnLndpbmRvdztcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwidGltZV9jb25maWdcIiwgY2ZnKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBsb2NhbCBob3N0IHN0aWxsIGhvbGRzIGl0ICovIH1cclxuICAgICAgICB9LFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBDcmVhdGVzLCByZXR1bmVzIG9yIHJlbW92ZXMgdGhlIHNsaWRlciB0byBtYXRjaCB0aGUgbGF5ZXJzIHByZXNlbnQuIFRpY2tzIGFyZVxyXG4gICAgLy8gcmVnZW5lcmF0ZWQgb25seSB3aGVuIHRoZSBkYXRhJ3MgdGltZSBleHRlbnQgb3IgdGhlIHBlcmlvZCBjaGFuZ2VzLCBzbyBhXHJcbiAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxyXG4gICAgZnVuY3Rpb24gdXBkYXRlVGltZURpbWVuc2lvbigpIHtcclxuICAgICAgICBpZiAoIWhhc1RpbWVMYXllcnMobGF5ZXJTdGF0ZSkpIHtcclxuICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgeyB0aWNrczogW10gfSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0gXCJcIjtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XHJcbiAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xyXG4gICAgICAgIGlmICghZXh0ZW50KSByZXR1cm47XHJcblxyXG4gICAgICAgIGNvbnN0IGtleSA9IGAke2V4dGVudC5taW59fCR7ZXh0ZW50Lm1heH18JHtjZmcucGVyaW9kIHx8IFwiUDFEXCJ9YDtcclxuICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XHJcbiAgICAgICAgICAgIC8vIFRoZSBwbGF5aGVhZCBpcyBhIE1PTUVOVCwgbm90IGFuIGluZGV4LiBMYXRlIGRhdGEgcHJlcGVuZHMgdGlja3NcclxuICAgICAgICAgICAgLy8gYW5kIGEgZ3Jvd24gZXh0ZW50IGFwcGVuZHMgdGhlbTsgdGhlIHVzZXIncyBwb3NpdGlvbiBpbiB0aW1lIGlzIGFcclxuICAgICAgICAgICAgLy8gY2hvc2VuIHZpZXcgLS0gdGhlIHNhbWUgcnVsZSB0aGF0IGtlZXBzIGEgZGF0YSB1cGRhdGUgZnJvbSBtb3ZpbmdcclxuICAgICAgICAgICAgLy8gYSBjaG9zZW4gdmlld3BvcnQgLS0gc28gaXQgc25hcHMgdG8gdGhlIG5lYXJlc3QgdGljayBvZiB0aGUgbmV3XHJcbiAgICAgICAgICAgIC8vIHNlcmllcyBhbmQgbmV2ZXIgcmVzZXRzIHRvIHRoZSBzdGFydCwgcGF1c2VkIG9yIHBsYXlpbmcgKHBsYXliYWNrXHJcbiAgICAgICAgICAgIC8vIHNpbXBseSBjb250aW51ZXMgZnJvbSB0aGUgc25hcHBlZCBpbmRleCkuXHJcbiAgICAgICAgICAgIGNvbnN0IG1vbWVudCA9IHRpbWVVSS50aWNrcy5sZW5ndGggPyB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSA6IG51bGw7XHJcbiAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBrZXk7XHJcbiAgICAgICAgICAgIHRpbWVVSS50aWNrcyA9IGdlbmVyYXRlVGlja3MoZXh0ZW50Lm1pbiwgZXh0ZW50Lm1heCwgcGVyaW9kKTtcclxuICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gbW9tZW50ID09PSBudWxsID8gMCA6IG5lYXJlc3RUaWNrSW5kZXgodGltZVVJLnRpY2tzLCBtb21lbnQpO1xyXG4gICAgICAgICAgICBpZiAobW9tZW50ICE9PSBudWxsICYmIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdICE9PSBtb21lbnQpIHtcclxuICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7ICAgLy8gdGhlIHNlcmllcyByZWFsaWduZWQ6IHRlbGwgUHl0aG9uIHdoZXJlIHdlIGxhbmRlZFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUaGUgc2hhcmVkIHdpbmRvdyBvdmVycmlkZSwgY29uZmlnLWRyaXZlbjsgYSBiYWQgc3RyaW5nIGNsZWFycyByYXRoZXIgdGhhblxyXG4gICAgICAgIC8vIGd1ZXNzaW5nLiBUaGUgZHJhZyBncmlkIGlzIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZFxyXG4gICAgICAgIC8vIGR1cmF0aW9uIC0tIHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBhbGwgb2YgdGhlbSAtLSBzbyBhIDIuNWggdHJhaWxcclxuICAgICAgICAvLyBpcyBkcmFnZ2FibGUgb24gYSAxaCBiYXIuIENhbGVuZGFyIHBlcmlvZHMgaGF2ZSBubyBmaXhlZCB3aWR0aDsgdGhlIHJ1bGVyXHJcbiAgICAgICAgLy8gdGhlbiBzaG93cyBpbnRlcnZhbCBtYXJrcyBvbmx5IGFuZCB0aGUgdHJhaWwgaGFuZGxlIGhpZGVzLlxyXG4gICAgICAgIC8vIE5ldmVyIHdoaWxlIGEgZHJhZyBpcyBsaXZlOiB0aGUgZHJhZ2dlZCB3aW5kb3cgZXhpc3RzIG9ubHkgbG9jYWxseSB1bnRpbFxyXG4gICAgICAgIC8vIHJlbGVhc2UgY29tbWl0cyBpdCwgYW5kIHJlYWRpbmcgY29uZmlnIGhlcmUgbWlkLWRyYWcgcmVzZXQgdGhlIGhhbmRsZSB0b1xyXG4gICAgICAgIC8vIFwibm8gd2luZG93XCIgb24gZXZlcnkgZGVib3VuY2VkIHN5bmMgLS0gdGhlIGhhbmRsZSBmb2xsb3dlZCB0aGUgbW91c2UsIHRoZW5cclxuICAgICAgICAvLyBzbmFwcGVkIGhvbWUsIHRoZW4gZm9sbG93ZWQgYWdhaW4sIG9uY2UgcGVyIHN5bmMuXHJcbiAgICAgICAgaWYgKCF0aW1lVUkuZHJhZ0FjdGl2ZSkge1xyXG4gICAgICAgICAgICB0aW1lVUkud2luZG93ID0gY2ZnLndpbmRvdyAmJiBwYXJzZVBlcmlvZChjZmcud2luZG93KSA/IGNmZy53aW5kb3cgOiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aW1lVUkucGVyaW9kTXMgPSBwZXJpb2RUb01zKHBlcmlvZCk7XHJcbiAgICAgICAgdGltZVVJLmdyaWRNcyA9IHRpbWVVSS5wZXJpb2RNc1xyXG4gICAgICAgICAgICA/IGdjZEdyaWRNcyh0aW1lVUkucGVyaW9kTXMsIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllclN0YXRlLCB0aW1lVUkud2luZG93KSlcclxuICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QsIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xyXG4gICAgICAgIHRpbWVVSS5wb3NpdGlvbiA9IGNmZy5wb3NpdGlvbiB8fCBcInRvcC1jZW50ZXJcIjtcclxuXHJcbiAgICAgICAgaWYgKCF0aW1lVUkuc3RhcnRlZCkge1xyXG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IGNmZy5zcGVlZCB8fCAxO1xyXG4gICAgICAgICAgICB0aW1lVUkubG9vcCA9IEJvb2xlYW4oY2ZnLmxvb3ApO1xyXG4gICAgICAgICAgICAvLyBPbmx5IHRoZSBmaXJzdCBjb25maWd1cmF0aW9uIG1heSBhdXRvLXN0YXJ0LiBFdmVyeSBjb25maWcgY2hhbmdlIHJlc2V0c1xyXG4gICAgICAgICAgICAvLyBgc3RhcnRlZGAgdG8gcmUtcmVhZCBzcGVlZCBhbmQgbG9vcCAtLSBpbmNsdWRpbmcgdGhlIGNoYW5nZSBhIHdpbmRvd1xyXG4gICAgICAgICAgICAvLyBkcmFnIGNvbW1pdHMgLS0gYW5kIHJlLXJ1bm5pbmcgYXV0b19wbGF5IHRoZXJlIHdvdWxkIHN0YXJ0IHBsYXliYWNrIGFzXHJcbiAgICAgICAgICAgIC8vIGEgc2lkZSBlZmZlY3Qgb2YgcmVsZWFzaW5nIHRoZSBoYW5kbGUuXHJcbiAgICAgICAgICAgIGlmIChjZmcuYXV0b19wbGF5ICYmICF0aW1lVUkuZXZlclN0YXJ0ZWQpIHN0YXJ0UGxheWJhY2soKTtcclxuICAgICAgICAgICAgdGltZVVJLmV2ZXJTdGFydGVkID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTaWRlYmFyIExheWVycyBDb250cm9sIFVJXHJcbiAgICBjb25zdCBzaWRlYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS50b3AgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLm92ZXJmbG93WSA9IFwiYXV0b1wiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5mb250RmFtaWx5ID0gXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTZWdvZSBVSScsIFJvYm90bywgc2Fucy1zZXJpZlwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5jb2xvciA9IFwiIzMzM1wiO1xyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHNpZGViYXIpO1xyXG5cclxuICAgIC8vIExlZ2VuZDogZGVyaXZlZCBmcmVzaCBvbiBldmVyeSBzeW5jIGZyb20gdGhlIHNhbWUgbGF5ZXIgc3RhdGUgdGhlIHNpZGViYXJcclxuICAgIC8vIHJlbmRlcnMgZnJvbSwgc28gdG9nZ2xlcyBkaW0gb3IgZHJvcCByb3dzIHdpdGggbm8gZXh0cmEgd2lyaW5nLiBIaWRkZW5cclxuICAgIC8vIHVudGlsIHNob3dfbGVnZW5kIGFza3MgZm9yIGl0LlxyXG4gICAgY29uc3QgbGVnZW5kRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIGxlZ2VuZERpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxlZ2VuZFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUubWF4V2lkdGggPSBcIjI2MHB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUubWF4SGVpZ2h0ID0gXCI0NSVcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5mb250RmFtaWx5ID0gc2lkZWJhci5zdHlsZS5mb250RmFtaWx5O1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobGVnZW5kRGl2KTtcclxuXHJcbiAgICAvLyBMb2dvXHJcbiAgICAvLyBUaGUgbG9nbyBjYXJkOiB0d28gYXBwLXN1cHBsaWVkIHNsb3RzIGZyb20gbG9nb19jb25maWcsIG5vIGJyYW5kaW5nIG9mXHJcbiAgICAvLyBpdHMgb3duLiBXaXRoIHRoZSBjYXJkIG9uIGFuZCBuZWl0aGVyIHNsb3Qgc2V0LCBhIGdlbmVyaWMgbWFyayBzdGFuZHMgaW5cclxuICAgIC8vIC0tIGlubGluZSBTVkcsIHNvIGl0IG5lZWRzIG5vIG5ldHdvcmsgYW5kIHN1cnZpdmVzIGEgc3RhdGljIGV4cG9ydC5cclxuICAgIC8vIEJ1aWx0IHdpdGggZWxlbWVudHMsIG5vdCBpbm5lckhUTUwsIHNvIGFuIGFsdCB0ZXh0IGNhbm5vdCBpbmplY3QgbWFya3VwLlxyXG4gICAgY29uc3QgTE9HT19QT1NJVElPTlMgPSBuZXcgU2V0KFtcInRvcC1sZWZ0XCIsIFwidG9wLXJpZ2h0XCIsIFwiYm90dG9tLWxlZnRcIiwgXCJib3R0b20tcmlnaHRcIl0pO1xyXG4gICAgY29uc3QgREVGQVVMVF9MT0dPID0gXCJkYXRhOmltYWdlL3N2Zyt4bWw7dXRmOCxcIiArIGVuY29kZVVSSUNvbXBvbmVudChcclxuICAgICAgICAnPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgdmlld0JveD1cIjAgMCAxNDAgNDBcIj4nXHJcbiAgICAgICAgKyAnPHJlY3Qgd2lkdGg9XCIxNDBcIiBoZWlnaHQ9XCI0MFwiIHJ4PVwiOFwiIGZpbGw9XCIjMWY2ZmViXCIvPidcclxuICAgICAgICArICc8dGV4dCB4PVwiNzBcIiB5PVwiMjZcIiBmb250LWZhbWlseT1cIlNlZ29lIFVJLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmXCIgJ1xyXG4gICAgICAgICsgJ2ZvbnQtc2l6ZT1cIjE4XCIgZm9udC13ZWlnaHQ9XCI2MDBcIiBmaWxsPVwiI2ZmZlwiIHRleHQtYW5jaG9yPVwibWlkZGxlXCI+c3dpZnRtYXA8L3RleHQ+J1xyXG4gICAgICAgICsgJzwvc3ZnPicpO1xyXG4gICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBsb2dvRGl2LmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtbG9nb1wiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjRweFwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxvZ29EaXYpO1xyXG5cclxuICAgIGZ1bmN0aW9uIHN5bmNMb2dvKCkge1xyXG4gICAgICAgIGNvbnN0IHNob3cgPSBCb29sZWFuKGhvc3QuZ2V0KFwic2hvd19sb2dvXCIpKTtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBzaG93ID8gXCJibG9ja1wiIDogXCJub25lXCI7XHJcbiAgICAgICAgbG9nb0Rpdi5yZXBsYWNlQ2hpbGRyZW4oKTtcclxuICAgICAgICBpZiAoIXNob3cpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcImxvZ29fY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IGhlaWdodCA9IE51bWJlcihjZmcuaGVpZ2h0KSA+IDAgPyBOdW1iZXIoY2ZnLmhlaWdodCkgOiAzNTtcclxuICAgICAgICBjb25zdCBwb3NpdGlvbiA9IExPR09fUE9TSVRJT05TLmhhcyhjZmcucG9zaXRpb24pID8gY2ZnLnBvc2l0aW9uIDogXCJib3R0b20tcmlnaHRcIjtcclxuICAgICAgICBmb3IgKGNvbnN0IHNpZGUgb2YgW1widG9wXCIsIFwiYm90dG9tXCIsIFwibGVmdFwiLCBcInJpZ2h0XCJdKSBsb2dvRGl2LnN0eWxlW3NpZGVdID0gXCJcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlW3Bvc2l0aW9uLnN0YXJ0c1dpdGgoXCJ0b3BcIikgPyBcInRvcFwiIDogXCJib3R0b21cIl0gPSBcIjEwcHhcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlW3Bvc2l0aW9uLmVuZHNXaXRoKFwibGVmdFwiKSA/IFwibGVmdFwiIDogXCJyaWdodFwiXSA9IFwiMTBweFwiO1xyXG4gICAgICAgIGNvbnN0IHNsb3RzID0gW2NmZy5jb21wYW55LCBjZmcucGFyZW50X2NvbXBhbnldLmZpbHRlcihzID0+IHMgJiYgcy51cmwpO1xyXG4gICAgICAgIGNvbnN0IGltYWdlcyA9IHNsb3RzLmxlbmd0aCA/IHNsb3RzIDogW3sgdXJsOiBERUZBVUxUX0xPR08sIGFsdDogXCJzd2lmdG1hcFwiIH1dO1xyXG4gICAgICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgcm93LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICByb3cuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgcm93LnN0eWxlLmdhcCA9IFwiNXB4XCI7XHJcbiAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBpbWFnZXMpIHtcclxuICAgICAgICAgICAgY29uc3QgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImltZ1wiKTtcclxuICAgICAgICAgICAgaW1nLnNyYyA9IGltYWdlLnVybDtcclxuICAgICAgICAgICAgaW1nLmFsdCA9IGltYWdlLmFsdCB8fCBcIlwiO1xyXG4gICAgICAgICAgICBpbWcuc3R5bGUuaGVpZ2h0ID0gYCR7aGVpZ2h0fXB4YDtcclxuICAgICAgICAgICAgcm93LmFwcGVuZENoaWxkKGltZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ29EaXYuYXBwZW5kQ2hpbGQocm93KTtcclxuICAgIH1cclxuICAgIHN5bmNMb2dvKCk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6bG9nb19jb25maWdcIiwgc3luY0xvZ28pO1xyXG5cclxuXHJcblxyXG4gICAgZnVuY3Rpb24gZ2V0VGlsZUxheWVyKGxheWVyKSB7XHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxyXG4gICAgICAgICAgICBtYXhab29tOiBsYXllci5tYXhfem9vbSB8fCAyMixcclxuICAgICAgICAgICAgbWF4TmF0aXZlWm9vbTogbGF5ZXIubWF4X25hdGl2ZV96b29tIHx8IDE5XHJcbiAgICAgICAgfTtcclxuICAgICAgICAvLyB4eXpzZXJ2aWNlcyBwcm92aWRlcnMgZGVjbGFyZSB0aGVpciBvd24ge3N9IGhvc3RzOyBMZWFmbGV0J3NcclxuICAgICAgICAvLyBkZWZhdWx0IFwiYWJjXCIgaXMgd3JvbmcgZm9yIGFueXRoaW5nIGVsc2UuXHJcbiAgICAgICAgaWYgKGxheWVyLnN1YmRvbWFpbnMpIG9wdGlvbnMuc3ViZG9tYWlucyA9IGxheWVyLnN1YmRvbWFpbnM7XHJcbiAgICAgICAgaWYgKGxheWVyLndtcykge1xyXG4gICAgICAgICAgICAvLyBXTVMgcmVxdWVzdCBDUlMgZm9sbG93cyB0aGUgbWFwJ3MsIHNvIDQzMjYgbWFwcyBhc2sgaW4gNDMyNi5cclxuICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyLndtcyhsYXllci51cmwsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBsYXllcnM6IGxheWVyLndtcy5sYXllcnMsXHJcbiAgICAgICAgICAgICAgICBmb3JtYXQ6IGxheWVyLndtcy5mb3JtYXQgfHwgJ2ltYWdlL3BuZycsXHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiBsYXllci53bXMudmVyc2lvbiB8fCAnMS4xLjEnLFxyXG4gICAgICAgICAgICAgICAgdHJhbnNwYXJlbnQ6ICEhbGF5ZXIud21zLnRyYW5zcGFyZW50LFxyXG4gICAgICAgICAgICAgICAgLi4uKGxheWVyLndtcy5zdHlsZXMgPyB7IHN0eWxlczogbGF5ZXIud21zLnN0eWxlcyB9IDoge30pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCBvcHRpb25zKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZXRpcmUgYSBnbGlmeSBpbnN0YW5jZSB0aGUgc2FmZSB3YXk6IGl0cyBjYW52YXMgb3ZlcmxheSBuZXZlciBjYW5jZWxzIHRoZVxyXG4gICAgLy8gcmVkcmF3IGZyYW1lIGl0IHNjaGVkdWxlcywgYW5kIHRoYXQgZnJhbWUgZGVyZWZlcmVuY2VzIHRoZSBtYXAgdW5ndWFyZGVkIC0tXHJcbiAgICAvLyByZW1vdmluZyBhIGxheWVyIHdpdGhpbiBhIGZyYW1lIG9mIGl0cyBjcmVhdGlvbiB3b3VsZCB0aHJvdyBmcm9tIGluc2lkZVxyXG4gICAgLy8gcmVxdWVzdEFuaW1hdGlvbkZyYW1lLCB3aGVyZSBubyBjYWxsZXIgY2FuIGNhdGNoIGl0LlxyXG4gICAgLy8gVGFrZXMgZWl0aGVyIGEgbWVyZ2VkIHdyYXBwZXIgbGF5ZXIgKHdoaWNoIGtlZXBzIGl0cyBnbGlmeSBpbnN0YW5jZSBhc1xyXG4gICAgLy8gZ2xQb2ludHMgLyBnbExpbmVzIC8gZ2xTaGFwZXMpIG9yIGEgYmFyZSBnbGlmeSBpbnN0YW5jZS5cclxuICAgIGZ1bmN0aW9uIGNhbmNlbEdsRnJhbWUoZ2xJbnN0YW5jZSkge1xyXG4gICAgICAgIGNvbnN0IG92ZXJsYXkgPSBnbEluc3RhbmNlICYmIGdsSW5zdGFuY2UubGF5ZXI7XHJcbiAgICAgICAgaWYgKG92ZXJsYXkgJiYgb3ZlcmxheS5fZnJhbWUgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICBMLlV0aWwuY2FuY2VsQW5pbUZyYW1lKG92ZXJsYXkuX2ZyYW1lKTtcclxuICAgICAgICAgICAgb3ZlcmxheS5fZnJhbWUgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGZ1bmN0aW9uIHJldGlyZUdsKGluc3RhbmNlKSB7XHJcbiAgICAgICAgaWYgKCFpbnN0YW5jZSkgcmV0dXJuO1xyXG4gICAgICAgIGZvciAoY29uc3QgZ2wgb2YgW2luc3RhbmNlLmdsUG9pbnRzLCBpbnN0YW5jZS5nbExpbmVzLCBpbnN0YW5jZS5nbFNoYXBlcywgaW5zdGFuY2VdKSB7XHJcbiAgICAgICAgICAgIGNhbmNlbEdsRnJhbWUoZ2wpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0cnkgeyBpbnN0YW5jZS5yZW1vdmUoKTsgfSBjYXRjaCAoZXJyKSB7IC8qIGFscmVhZHkgZ29uZSAqLyB9XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZnVuY3Rpb24gc3luY01hcFN0YXRlKCkge1xyXG4gICAgICAgIGNvbnNvbGUudGltZShcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xyXG4gICAgICAgIHVwZGF0ZVRpbWVEaW1lbnNpb24oKTtcclxuICAgICAgICBjb25zdCBsYXllcnMgPSBsYXllclN0YXRlO1xyXG4gICAgICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IGhvc3QuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IGJ1ZmZlclN0YXRlO1xyXG5cclxuICAgICAgICAvLyBFbmZvcmNlIG11dHVhbGx5IGV4Y2x1c2l2ZSByYWRpbyBncm91cCB2aXNpYmlsaXR5IGJlZm9yZSBjb2xsZWN0aW5nIG9yIHJlbmRlcmluZyBXZWJHTCBsYXllcnMuXHJcbiAgICAgICAgLy8gV3JpdHRlbiBiYWNrIGFzIHRhcmdldGVkIGZsaXBzLCBuZXZlciB0aGUgbGF5ZXJzIHRyYWl0IC0tIHRoZSBmdWxsIHdyaXRlIHdhc1xyXG4gICAgICAgIC8vIHRoZSBmcmFtZSB0aGF0IGtpbGxlZCBsYXJnZSBzZXNzaW9ucyAoc2VlIHRoZSBzaWRlYmFyJ3MgY2hhbmdlIGhhbmRsZXIpLlxyXG4gICAgICAgIGNvbnN0IHJhZGlvID0gbm9ybWFsaXplUmFkaW9MYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MsIHNpZGViYXJDb2xsYXBzZVN0YXRlKHNpZGViYXIpKTtcclxuICAgICAgICBpZiAoKHJhZGlvLmNoYW5nZXMubGVuZ3RoID4gMCB8fCByYWRpby5ncm91cHNDaGFuZ2VkKSAmJiBkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xyXG4gICAgICAgICAgICBzZW5kTGF5ZXJXcml0ZShob3N0LCByYWRpby5jaGFuZ2VzKTtcclxuICAgICAgICAgICAgaG9zdC5zZXQoXCJncm91cF9jb25maWdzXCIsIHsgLi4uZ3JvdXBDb25maWdzIH0pO1xyXG4gICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc3luY0xvZ28oKTtcclxuXHJcbiAgICAgICAgLy8gR3JvdXAgdmlzaWJsZSBsYXllcnMgKGluY2x1ZGluZyBzdWItbGF5ZXJzIGluc2lkZSBncm91cHMpIHRvIGFsd2F5cyB1c2UgV2ViR0xcclxuICAgICAgICBjb25zdCB7XHJcbiAgICAgICAgICAgIGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcclxuICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgIHBvbHlsaW5lOiB3ZWJnbFBvbHlsaW5lTGF5ZXJzLFxyXG4gICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMsXHJcbiAgICAgICAgfSA9IGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XHJcblxyXG4gICAgICAgIC8vIFNldCBvZiBsYXllciBJRHMgcHJvY2Vzc2VkIHZpYSBtZXJnZWQgV2ViR0wgbGF5ZXJzXHJcbiAgICAgICAgY29uc3Qgd2ViZ2xMYXllcklkcyA9IG5ldyBTZXQoW1xyXG4gICAgICAgICAgICAuLi53ZWJnbENpcmNsZU1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcclxuICAgICAgICAgICAgLi4ud2ViZ2xNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXHJcbiAgICAgICAgICAgIC4uLndlYmdsUG9seWxpbmVMYXllcnMubWFwKGwgPT4gbC5pZCksXHJcbiAgICAgICAgICAgIC4uLndlYmdsUG9seWdvbkxheWVycy5tYXAobCA9PiBsLmlkKVxyXG4gICAgICAgIF0pO1xyXG5cclxuICAgICAgICAvLyBSZW1vdmUgcmV0aXJlZCBvdmVybGF5IGxheWVycywgaW5jbHVkaW5nIHRob3NlIHRoYXQgdHJhbnNpdGlvbmVkIHRvIFdlYkdMXHJcbiAgICAgICAgT2JqZWN0LmtleXMoYWN0aXZlT3ZlcmxheUxheWVycykuZm9yRWFjaChpZCA9PiB7XHJcbiAgICAgICAgICAgIGlmICghbGF5ZXJzLmZpbmQobCA9PiBsLmlkID09PSBpZCkgfHwgd2ViZ2xMYXllcklkcy5oYXMoaWQpKSB7XHJcbiAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBQcm9jZXNzIG5vbi1XZWJHTCBsYXllcnNcclxuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBlZmZlY3RpdmVWaXNpYmxlID0gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcImJhc2VtYXBcIikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGlsZSA9IGdldFRpbGVMYXllcihsYXllcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpbGUuYWRkVG8obWFwKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSA9IHRpbGU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gU2tpcCBsYXllcnMgbWFuYWdlZCBieSB0aGUgbWVyZ2VkIFdlYkdMIGxheWVyc1xyXG4gICAgICAgICAgICBpZiAod2ViZ2xMYXllcklkcy5oYXMobGF5ZXIuaWQpKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKCFlZmZlY3RpdmVWaXNpYmxlIHx8ICFsYXllckluV2luZG93KGxheWVyLCBidWZmZXJTdGF0ZSwgdGltZVN0YXRlKSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0ucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcclxuICAgICAgICAgICAgICAgIC8vIEltYWdlIG92ZXJsYXlzIHJlY3JlYXRlIHdoZW4gdGhlaXIgY29uZmlnIG9yIHRoZWlyIGJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgLy8gY2hhbmdlcyAtLSBhIHJlcGxhY2Ugb3Agc3dhcHMgdGhlIGNvbmZpZyBvYmplY3QgYW5kIGFcclxuICAgICAgICAgICAgICAgIC8vIGJ1ZmZlciBvcCBzd2FwcyB0aGUgRGF0YVZpZXcsIGFuZCBhIHN0YWxlIGltYWdlIHdvdWxkXHJcbiAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2Ugc2l0IHVudGlsIGEgdmlzaWJpbGl0eSBib3VuY2UuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFsZUltYWdlID0gbGF5ZXIudHlwZSA9PT0gXCJpbWFnZVwiXHJcbiAgICAgICAgICAgICAgICAgICAgJiYgKGV4aXN0aW5nLmltYWdlTWV0YSAhPT0gaW1hZ2VNZXRhS2V5KGxheWVyKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB8fCBleGlzdGluZy5pbWFnZVNvdXJjZSAhPT0gKGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXSB8fCBudWxsKSk7XHJcbiAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmcubGF5ZXJUeXBlICE9PSBsYXllci50eXBlIHx8IHN0YWxlSW1hZ2UpIHtcclxuICAgICAgICAgICAgICAgICAgICBleGlzdGluZy5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXSwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICAvLyBBIGhvc3QgbWF5IGRlc3Ryb3kgdGhlIG1hcCB3aGlsZSBhIHN5bmMgaXMgaW4gZmxpZ2h0IChhbiB1bm1vdW50LCBvclxyXG4gICAgICAgICAgICAvLyBSZWFjdCBzdHJpY3QgbW9kZSdzIHRocm93YXdheSBtb3VudCk6IG5vdGhpbmcgcGFzdCB0aGlzIHBvaW50IG1heVxyXG4gICAgICAgICAgICAvLyB0b3VjaCBhIG1hcCB0aGF0IG5vIGxvbmdlciBoYXMgcGFuZXMuXHJcbiAgICAgICAgICAgIGlmIChkZXN0cm95ZWQpIHJldHVybjtcclxuICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XHJcbiAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSA9IGluc3RhbmNlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBIZWxwZXIgdG8gc3luYyBXZWJHTCBsYXllciBzdGF0ZXMgYW5kIHJlYnVpbGQgb25seSBpZiBjaGFuZ2VkXHJcbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY0dsTGF5ZXIodHlwZSwgdmlzaWJsZUxheWVycywgdmVjdG9yR3B1ID0gZmFsc2UpIHtcclxuICAgICAgICAgICAgY29uc3QgaWRzU3RyaW5nID0gdmlzaWJsZUxheWVycy5tYXAobCA9PiBsLmlkKS5zb3J0KCkuam9pbihcIixcIik7XHJcbiAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgdGhlIGJ1aWx0IGJ1ZmZlcnMgZGVwZW5kIG9uIGJlbG9uZ3MgaW4gdGhpcyBrZXk6IGEgY2hhbmdlIHRoYXRcclxuICAgICAgICAgICAgLy8gaXMgbm90IGluIGl0IHJlbmRlcnMgc3RhbGUuIGhpZ2hsaWdodF9zdHlsZSBhbmQgc3R5bGVfb3ZlcnJpZGVzIHdlcmVcclxuICAgICAgICAgICAgLy8gbWlzc2luZyBhdCBmaXJzdCwgc28gYSBoaWdobGlnaHQgbGFuZGVkIGluIHN0YXRlIGFuZCBuZXZlciByZXBhaW50ZWQuXHJcbiAgICAgICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgb24gdGhlIEdQVSBwYXRoIGV4Y2x1ZGUgdGhlIHRpY2sgYW5kIHdpbmRvdyBmcm9tIHRoZSBrZXk6XHJcbiAgICAgICAgICAgIC8vIHRob3NlIGNoYW5nZSBwZXIgdGljayBhbmQgYXJlIGFwcGxpZWQgYXMgdW5pZm9ybXMsIG5vdCBieSByZWJ1aWxkaW5nLlxyXG4gICAgICAgICAgICAvLyBUaGUgcGVyaW9kIHN0YXlzIGluLCBzaW5jZSBpdCBpcyBiYWtlZCBpbnRvIHRoZSBkdXJhdGlvbiBhdHRyaWJ1dGVzLlxyXG4gICAgICAgICAgICAvLyBFdmVyeXRoaW5nIGVsc2UgLS0gYW5kIGV2ZXJ5IG5vbi1wb2ludCBidWNrZXQgLS0gcmVidWlsZHMgYXMgYmVmb3JlLlxyXG4gICAgICAgICAgICBjb25zdCBncHVQb2ludHMgPSAoKHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIilcclxuICAgICAgICAgICAgICAgICYmIGdwdVRpbWVBdmFpbGFibGUoKSkgfHwgdmVjdG9yR3B1O1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkodmlzaWJsZUxheWVycy5tYXAobCA9PiAoe1xyXG4gICAgICAgICAgICAgICAgaWQ6IGwuaWQsXHJcbiAgICAgICAgICAgICAgICBjb2xvcjogbC5jb2xvcixcclxuICAgICAgICAgICAgICAgIHJhZGl1czogbC5yYWRpdXMsXHJcbiAgICAgICAgICAgICAgICB3ZWlnaHQ6IGwud2VpZ2h0LFxyXG4gICAgICAgICAgICAgICAgb3BhY2l0eTogbC5vcGFjaXR5LFxyXG4gICAgICAgICAgICAgICAgZmlsbE9wYWNpdHk6IGwuZmlsbE9wYWNpdHksXHJcbiAgICAgICAgICAgICAgICBoaWdobGlnaHQ6IGwuaGlnaGxpZ2h0X3N0eWxlLFxyXG4gICAgICAgICAgICAgICAgb3ZlcnJpZGVzOiBsLnN0eWxlX292ZXJyaWRlcyxcclxuICAgICAgICAgICAgICAgIGZlYXR1cmVTdHlsZXM6IGwuZmVhdHVyZV9zdHlsZXMsXHJcbiAgICAgICAgICAgICAgICB0aW1lOiBsLnRpbWUsXHJcbiAgICAgICAgICAgICAgICBncHU6IGdwdVBvaW50cyxcclxuICAgICAgICAgICAgICAgIHRpY2s6IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS50aWNrIDogMCxcclxuICAgICAgICAgICAgICAgIHdpbjogbC50aW1lICYmIHRpbWVTdGF0ZSAmJiAhZ3B1UG9pbnRzID8gdGltZVN0YXRlLndpbmRvdyA6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBwZXI6IGwudGltZSAmJiBncHVQb2ludHMgJiYgdGltZVN0YXRlXHJcbiAgICAgICAgICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBidWZMZW46IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdPy5ieXRlTGVuZ3RoIHx8IDAsXHJcbiAgICAgICAgICAgICAgICAvLyBJZGVudGl0eSBvZiBldmVyeSBidWZmZXIgdGhlIGJ1Y2tldCByZWFkcyBmb3IgdGhpcyBsYXllcjpcclxuICAgICAgICAgICAgICAgIC8vIHNhbWUtbGVuZ3RoIHJlcGxhY2VtZW50cyBtdXN0IHJlYnVpbGQgdG9vLlxyXG4gICAgICAgICAgICAgICAgYnVmU2VyaWFsOiBbbC5pZCwgYCR7bC5pZH06OmNvbG9yc2AsIGAke2wuaWR9OjpyYWRpaWAsIGAke2wuaWR9Ojp0aW1lc2BdXHJcbiAgICAgICAgICAgICAgICAgICAgLm1hcChrID0+IGJ1ZmZlclNlcmlhbChjb29yZGluYXRlQnVmZmVyc1trXSkpLFxyXG4gICAgICAgICAgICAgICAgbG9jTGVuOiBsLmxvY2F0aW9ucz8ubGVuZ3RoIHx8IDBcclxuICAgICAgICAgICAgfSkpKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRlQ2hhbmdlZCA9IHN0YXRlLmlkcyAhPT0gaWRzU3RyaW5nIHx8IHN0YXRlLm1ldGEgIT09IG1ldGFTdHJpbmc7XHJcblxyXG4gICAgICAgICAgICBpZiAoc3RhdGVDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXRpcmVHbChzdGF0ZS5sYXllcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAodmlzaWJsZUxheWVycy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnVpbHQgPSBhd2FpdCByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgdmlzaWJsZUxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIGxheWVyRXZlbnRzLCB0aW1lU3RhdGUsIHZlY3RvckdwdSwgZmVhdHVyZVZpc2libGVOb3cpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChkZXN0cm95ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGVzdHJveWVkIG1pZC1idWlsZDogcmV0aXJlIHRoZSBpbnN0YW5jZSBnbGlmeSByZWdpc3RlcmVkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIChpdHMgR0wgY29udGV4dCBnb2VzIHdpdGggaXQpIGluc3RlYWQgb2YgYWRkaW5nIGl0IHRvIGFcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVtb3ZlZCBtYXAuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldGlyZUdsKGJ1aWx0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IGJ1aWx0O1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgc3RhdGUuaWRzID0gaWRzU3RyaW5nO1xyXG4gICAgICAgICAgICAgICAgc3RhdGUubWV0YSA9IG1ldGFTdHJpbmc7XHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgdmlzaWJpbGl0eSBjYWNoZSBkZXNjcmliZWQgdGhlIGhhbmRsZSBqdXN0IHJldGlyZWQuIEEgcmVidWlsdFxyXG4gICAgICAgICAgICAgICAgLy8gYnVja2V0IGlzIGJvcm4gYWxsLXZpc2libGUsIHNvIHRoZSBuZXh0IHBhc3MgbXVzdCB1cGxvYWQgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyB2ZWN0b3IgZXZlbiB3aGVuIGl0IGRpZCBub3QgY2hhbmdlIC0tIG90aGVyd2lzZSBldmVyeSByZWJ1aWxkXHJcbiAgICAgICAgICAgICAgICAvLyAoYW4gYXBwZW5kIG1vdmVzIGJ1ZkxlbiwgYSBoaWdobGlnaHQgbW92ZXMgdGhlIHN0eWxlIGtleSkgZHJld1xyXG4gICAgICAgICAgICAgICAgLy8gaGlkZGVuIGxheWVycyBhZ2FpbiB1bnRpbCB0aGUgdXNlciByZS10b2dnbGVkIHRoZW0uXHJcbiAgICAgICAgICAgICAgICBzdGF0ZS52aXNLZXkgPSBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBQb2ludCBidWNrZXRzIGhvbGRpbmcgdGltZSBsYXllcnMga2VlcCBFVkVSWSBwb2ludCBsYXllciAtLSBoaWRkZW4gb25lc1xyXG4gICAgICAgIC8vIGluY2x1ZGVkIC0tIHNvIGEgc2lkZWJhciB0b2dnbGUgY2hhbmdlcyBhIHZpc2liaWxpdHkgdW5pZm9ybSBpbnN0ZWFkIG9mXHJcbiAgICAgICAgLy8gdGhlIGJ1Y2tldCdzIGlkcy4gVW5jaGVja2luZyBvbmUgb2YgMjUgdHJhY2tzIHVzZWQgdG8gcmVidWlsZCBhbGwgNU1cclxuICAgICAgICAvLyBwb2ludHM7IGNsaWNraW5nIGRvd24gdGhlIHNpZGViYXIgc3RhY2tlZCB0aG9zZSByZWJ1aWxkcyBpbnRvIGEgY3Jhc2guXHJcbiAgICAgICAgY29uc3QgYWxsQnlUeXBlID0gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKTtcclxuICAgICAgICAvLyBBcmVhIG91dGxpbmVzIHJpZGUgdGhlIGxpbmVzIGJ1Y2tldDogZXZlcnkgcG9seWdvbiBhbmQgY2lyY2xlIGpvaW5zIGl0IGFzXHJcbiAgICAgICAgLy8gYW4gZXh0cmEgZW50cnkgd2hvc2UgcmluZ3MgcmVuZGVyIGFzIHdlaWdodGVkIExpbmVTdHJpbmdzICh0aGUgcG9seWdvblxyXG4gICAgICAgIC8vIGJ1Y2tldCBkcmF3cyBvbmx5IHRoZSBmaWxsKS4gSm9pbmluZyB1bmNvbmRpdGlvbmFsbHkgLS0gc3Ryb2tlbGVzcyBhcmVhc1xyXG4gICAgICAgIC8vIGNvbnRyaWJ1dGUgYW4gZW1wdHkgc2xvdCAtLSBrZWVwcyB0aGUgYnVja2V0J3MgbWVtYmVyc2hpcCBpbmRlcGVuZGVudCBvZlxyXG4gICAgICAgIC8vIHN0eWxlIGNoYW5nZXMsIHNvIHJlc3R5bGluZyBhIGJvcmRlciBzdGF5cyBhIHJlYnVpbGQsIG5ldmVyIGEgcmUtYnVja2V0LlxyXG4gICAgICAgIGFsbEJ5VHlwZS5wb2x5bGluZSA9IFsuLi5hbGxCeVR5cGUucG9seWxpbmUsIC4uLmFsbEJ5VHlwZS5wb2x5Z29uXTtcclxuICAgICAgICBjb25zdCBidWNrZXQgPSB7IGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgcG9seWxpbmU6IFsuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLCAuLi53ZWJnbFBvbHlnb25MYXllcnNdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzIH07XHJcbiAgICAgICAgY29uc3QgdmVjdG9yR3B1QnVja2V0ID0geyBwb2x5bGluZTogZmFsc2UsIHBvbHlnb246IGZhbHNlIH07XHJcbiAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xyXG4gICAgICAgICAgICBjb25zdCBlbnRyaWVzID0gYWxsQnlUeXBlW3R5cGVdO1xyXG4gICAgICAgICAgICBjb25zdCBpc1BvaW50cyA9IHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIjtcclxuICAgICAgICAgICAgY29uc3QgYXZhaWxhYmxlID0gaXNQb2ludHMgPyBncHVUaW1lQXZhaWxhYmxlKCkgOiB2ZWN0b3JHcHVBdmFpbGFibGUoKTtcclxuICAgICAgICAgICAgY29uc3QgZ3B1VmlzID0gYXZhaWxhYmxlICYmIGVudHJpZXMubGVuZ3RoID4gMFxyXG4gICAgICAgICAgICAgICAgJiYgZW50cmllcy5sZW5ndGggPD0gTEFZRVJfU0xPVFNcclxuICAgICAgICAgICAgICAgICYmIGVudHJpZXMuc29tZShlID0+IGUubGF5ZXIudGltZSk7XHJcbiAgICAgICAgICAgIGdsU3RhdGVzW3R5cGVdLnZpc1ZlY3RvciA9IGdwdVZpcyA/IGVudHJpZXMubWFwKGUgPT4gKGUudmlzID8gMSA6IDApKSA6IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChncHVWaXMpIGJ1Y2tldFt0eXBlXSA9IGVudHJpZXMubWFwKGUgPT4gZS5sYXllcik7XHJcbiAgICAgICAgICAgIGlmICghaXNQb2ludHMpIHZlY3RvckdwdUJ1Y2tldFt0eXBlXSA9IGdwdVZpcztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwiY2lyY2xlX21hcmtlcnNcIiwgYnVja2V0LmNpcmNsZV9tYXJrZXJzKTtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJtYXJrZXJzXCIsIGJ1Y2tldC5tYXJrZXJzKTtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCBidWNrZXQucG9seWxpbmUsIHZlY3RvckdwdUJ1Y2tldC5wb2x5bGluZSk7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWdvblwiLCBidWNrZXQucG9seWdvbiwgdmVjdG9yR3B1QnVja2V0LnBvbHlnb24pO1xyXG4gICAgICAgIGlmIChkZXN0cm95ZWQpIHJldHVybjtcclxuXHJcbiAgICAgICAgLy8gUHVzaCB0aGUgY3VycmVudCB3aW5kb3cgaW50byB0aGUgR1BVLWZpbHRlcmVkIHBvaW50IGJ1Y2tldHM6IHR3byB1bmlmb3Jtc1xyXG4gICAgICAgIC8vIGFuZCBhIHJlZHJhdywgd2hpY2ggaXMgdGhlIGVudGlyZSBwZXItdGljayBjb3N0IG9mIHRoZSB0aW1lIHNsaWRlciB0aGVyZS5cclxuICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2YgW1wiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCJdKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XHJcbiAgICAgICAgICAgIGNvbnN0IGhhbmRsZSA9IHN0YXRlLmxheWVyICYmIHN0YXRlLmxheWVyLl9zd2lmdG1hcFRpbWU7XHJcbiAgICAgICAgICAgIGlmICghaGFuZGxlKSBjb250aW51ZTtcclxuICAgICAgICAgICAgLy8gTGF5ZXIgdmlzaWJpbGl0eSBmaXJzdCwgYW5kIG9ubHkgd2hlbiBpdCBjaGFuZ2VkOiBhIHRvZ2dsZSBjb3N0cyBvbmVcclxuICAgICAgICAgICAgLy8gdW5pZm9ybSBhcnJheSB3cml0ZSBhbmQgYSByZWRyYXcsIG5ldmVyIGEgcmVidWlsZC5cclxuICAgICAgICAgICAgY29uc3QgdmlzID0gc3RhdGUudmlzVmVjdG9yO1xyXG4gICAgICAgICAgICBpZiAodmlzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSB2aXMuam9pbihcIlwiKTtcclxuICAgICAgICAgICAgICAgIGlmIChzdGF0ZS52aXNLZXkgIT09IGtleSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnZpc0tleSA9IGtleTtcclxuICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0TGF5ZXJWaXNpYmlsaXR5KHZpcyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgb3ZlcnJpZGVNcyA9IHRpbWVTdGF0ZS53aW5kb3dcclxuICAgICAgICAgICAgICAgICAgICA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2QodGltZVN0YXRlLndpbmRvdykpIDogbnVsbDtcclxuICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3codGltZVN0YXRlLnRpY2ssIG92ZXJyaWRlTXMpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyhudWxsLCBudWxsKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywge1xyXG4gICAgICAgICAgICBncm91cENvbmZpZ3MsXHJcbiAgICAgICAgICAgIGNvb3JkaW5hdGVCdWZmZXJzLFxyXG4gICAgICAgICAgICBvbkxheWVyV3JpdGU6IChjaGFuZ2VzKSA9PiBzZW5kTGF5ZXJXcml0ZShob3N0LCBjaGFuZ2VzKSxcclxuICAgICAgICAgICAgLy8gZ3JvdXBfY29uZmlncyBzdGF5cyBvbiB0aGUgaG9zdDogYSBoYW5kZnVsIG9mIGZvbGRlciBmbGFncywgYW5kIHRoZVxyXG4gICAgICAgICAgICAvLyBzcHJlYWQgZ2l2ZXMgQmFja2JvbmUgYSBmcmVzaCByZWZlcmVuY2Ugc28gaW4tcGxhY2UgZWRpdHMgcmVnaXN0ZXIuXHJcbiAgICAgICAgICAgIG9uR3JvdXBDb25maWdzQ2hhbmdlOiAoY2ZnKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImdyb3VwX2NvbmZpZ3NcIiwgeyAuLi5jZmcgfSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH0sIG1hcCwgKCkgPT4ge1xyXG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBQZXJtYW5lbnQgbGFiZWxzIGZvbGxvdyB0aGUgc2FtZSBkZXJpdmUtcGVyLXN5bmMgcGF0dGVybiBhcyB0aGUgbGVnZW5kLFxyXG4gICAgICAgIC8vIHNvIHRoZXkgdHJhY2sgdmlzaWJpbGl0eSB3aXRoIG5vIGJ1Y2tldCBvciBtZXRhLWtleSBpbnZvbHZlbWVudCAtLSBhbmRcclxuICAgICAgICAvLyBzaW5jZSBldmVyeSBwbGF5YmFjayB0aWNrIHJlLWVudGVycyB0aGlzIHN5bmMsIHBhc3NpbmcgdGltZVN0YXRlIG1ha2VzXHJcbiAgICAgICAgLy8gdGhlbSBmb2xsb3cgdGhlIHdpbmRvdyB0b286IGNoaXBzIGFwcGVhciBhbmQgdmFuaXNoIHdpdGggdGhlaXIgZmVhdHVyZXMuXHJcbiAgICAgICAgaWYgKGxhYmVsc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHJlbmRlckxhYmVscyhMLCBsYWJlbHNHcm91cCwgbGF5ZXJzLCBjb29yZGluYXRlQnVmZmVycywgZ3JvdXBDb25maWdzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGxlZ2VuZENmZyA9IGhvc3QuZ2V0KFwibGVnZW5kX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBpZiAoaG9zdC5nZXQoXCJzaG93X2xlZ2VuZFwiKSkge1xyXG4gICAgICAgICAgICBjb25zdCBzcGVjID0gZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgbGVnZW5kQ2ZnKTtcclxuICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGxlZ2VuZERpdiwgc3BlYyxcclxuICAgICAgICAgICAgICAgIHsgZGltSGlkZGVuOiBsZWdlbmRDZmcuZGltX2hpZGRlbiAhPT0gZmFsc2UgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBvcyA9IFBPU0lUSU9OU1tsZWdlbmRDZmcucG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcImJvdHRvbS1sZWZ0XCJdO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocG9zKSkge1xyXG4gICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlW3Byb3BdID0gdmFsdWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBzcGVjLmdyb3Vwcy5sZW5ndGggPiAwID8gXCJibG9ja1wiIDogXCJub25lXCI7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc29sZS50aW1lRW5kKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XHJcbiAgICBsZXQgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XHJcblxyXG4gICAgLy8gRHJhdyAvIEFPSSB0b29sczogTGVhZmxldC1HZW9tYW4gKHRoZSBtYWludGFpbmVkIHN1Y2Nlc3NvciB0byBMZWFmbGV0LmRyYXcsXHJcbiAgICAvLyB3aGljaCBicmVha3Mgb24gTGVhZmxldCAxLjkpLCBsb2FkZWQgZnJvbSB1bnBrZyBsaWtlIExlYWZsZXQgYW5kIGdsaWZ5IC0tXHJcbiAgICAvLyBsYXppbHksIG9ubHkgd2hlbiBhIG1hcCB0dXJucyBkcmF3aW5nIG9uLCBzbyBldmVyeSBvdGhlciBtYXAgcGF5cyBub3RoaW5nLlxyXG4gICAgLy8gRHJhd24gc2hhcGVzIGxpdmUgaW4gdGhlaXIgb3duIGZlYXR1cmUgZ3JvdXAgYW5kIHN5bmMgdG8gUHl0aG9uIGFzIEdlb0pTT05cclxuICAgIC8vIGZlYXR1cmVzIHVuZGVyIHRoZSBgZHJhd2luZ3NgIHRyYWl0LCB3aXRoIGBkcmF3X3NlcWAgYnVtcGluZyBwZXIgY2hhbmdlIHNvXHJcbiAgICAvLyBvbmUgb2JzZXJ2ZXIgY2F0Y2hlcyBjcmVhdGUsIGVkaXQgYW5kIGRlbGV0ZSBhbGlrZS4gVGhlIHRyYWl0IHN5bmNzIGJvdGhcclxuICAgIC8vIHdheXM6IFB5dGhvbiBjYW4gc2VlZCBBT0lzIG9yIGNsZWFyIHRoZW0sIGFuZCBleHBvcnRzIGNhcnJ5IHRoZSBkcmF3aW5ncy5cclxuICAgIGxldCBkcmF3UmVhZHkgPSBmYWxzZTtcclxuICAgIGxldCBkcmF3aW5nc0dyb3VwID0gbnVsbDtcclxuICAgIGxldCBkcmF3SWRDb3VudGVyID0gMDtcclxuICAgIGxldCBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xyXG5cclxuICAgIGZ1bmN0aW9uIGRyYXdpbmdUb0ZlYXR1cmUobCkge1xyXG4gICAgICAgIGNvbnN0IGdqID0gbC50b0dlb0pTT04oKTtcclxuICAgICAgICBnai5wcm9wZXJ0aWVzID0geyAuLi4oZ2oucHJvcGVydGllcyB8fCB7fSksIGRyYXdfaWQ6IGwuX3N3aWZ0bWFwRHJhd0lkIH07XHJcbiAgICAgICAgaWYgKHR5cGVvZiBsLmdldFJhZGl1cyA9PT0gXCJmdW5jdGlvblwiICYmIGwgaW5zdGFuY2VvZiBMLkNpcmNsZSkge1xyXG4gICAgICAgICAgICBnai5wcm9wZXJ0aWVzLmtpbmQgPSBcImNpcmNsZVwiO1xyXG4gICAgICAgICAgICBnai5wcm9wZXJ0aWVzLnJhZGl1cyA9IGwuZ2V0UmFkaXVzKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBnajtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB3cml0ZURyYXdpbmdzKCkge1xyXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgZHJhd2luZ3NHcm91cC5lYWNoTGF5ZXIobCA9PiBmZWF0dXJlcy5wdXNoKGRyYXdpbmdUb0ZlYXR1cmUobCkpKTtcclxuICAgICAgICBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IHRydWU7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaG9zdC5zZXQoXCJkcmF3aW5nc1wiLCBmZWF0dXJlcyk7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0KFwiZHJhd19zZXFcIiwgKGhvc3QuZ2V0KFwiZHJhd19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgZHJhd2luZ3Mgc3RpbGwgbGl2ZSBvbiB0aGUgbWFwICovIH1cclxuICAgICAgICBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGFkb3B0RHJhd2luZyhsYXllcikge1xyXG4gICAgICAgIGlmICghbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkKSB7XHJcbiAgICAgICAgICAgIGxheWVyLl9zd2lmdG1hcERyYXdJZCA9IGBkcmF3XyR7KytkcmF3SWRDb3VudGVyfWA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRyYXdpbmdzR3JvdXAuYWRkTGF5ZXIobGF5ZXIpO1xyXG4gICAgICAgIGxheWVyLm9uKFwicG06dXBkYXRlIHBtOmRyYWdlbmQgcG06cm90YXRlZW5kXCIsIHdyaXRlRHJhd2luZ3MpO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHJlaHlkcmF0ZURyYXdpbmdzKCkge1xyXG4gICAgICAgIGRyYXdpbmdzR3JvdXAuY2xlYXJMYXllcnMoKTtcclxuICAgICAgICBmb3IgKGNvbnN0IGZlYXR1cmUgb2YgaG9zdC5nZXQoXCJkcmF3aW5nc1wiKSB8fCBbXSkge1xyXG4gICAgICAgICAgICBjb25zdCBwcm9wcyA9IGZlYXR1cmUucHJvcGVydGllcyB8fCB7fTtcclxuICAgICAgICAgICAgbGV0IGxheWVyO1xyXG4gICAgICAgICAgICBpZiAocHJvcHMua2luZCA9PT0gXCJjaXJjbGVcIiAmJiBmZWF0dXJlLmdlb21ldHJ5LnR5cGUgPT09IFwiUG9pbnRcIikge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgW2xuZywgbGF0XSA9IGZlYXR1cmUuZ2VvbWV0cnkuY29vcmRpbmF0ZXM7XHJcbiAgICAgICAgICAgICAgICBsYXllciA9IEwuY2lyY2xlKFtsYXQsIGxuZ10sIHsgcmFkaXVzOiBwcm9wcy5yYWRpdXMgfHwgMTAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiIH0pO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbGF5ZXIgPSBMLmdlb0pTT04oZmVhdHVyZSwgeyBwYW5lOiBcInN3aWZ0bWFwRHJhd1BhbmVcIiB9KVxyXG4gICAgICAgICAgICAgICAgICAgIC5nZXRMYXllcnMoKVswXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoIWxheWVyKSBjb250aW51ZTtcclxuICAgICAgICAgICAgbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkID0gcHJvcHMuZHJhd19pZCB8fCBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xyXG4gICAgICAgICAgICBhZG9wdERyYXdpbmcobGF5ZXIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBzeW5jRHJhdygpIHtcclxuICAgICAgICBjb25zdCBzaG93ID0gaG9zdC5nZXQoXCJzaG93X2RyYXdcIik7XHJcbiAgICAgICAgY29uc3QgY2ZnID0gaG9zdC5nZXQoXCJkcmF3X2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBpZiAoc2hvdyAmJiAhZHJhd1JlYWR5KSB7XHJcbiAgICAgICAgICAgIGRyYXdSZWFkeSA9IHRydWU7XHJcbiAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgR2VvbWFuIGNyZWF0ZXMgZ29lcyB0byB0aGUgcGFuZSBhYm92ZSB0aGUgR0wgc3RhY2suXHJcbiAgICAgICAgICAgIG1hcC5wbS5zZXRHbG9iYWxPcHRpb25zKHtcclxuICAgICAgICAgICAgICAgIHBhbmVzOiB7IGxheWVyUGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICB2ZXJ0ZXhQYW5lOiBcIm1hcmtlclBhbmVcIiwgbWFya2VyUGFuZTogXCJtYXJrZXJQYW5lXCIgfSxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAgPSBMLmZlYXR1cmVHcm91cCgpLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgICAgIHJlaHlkcmF0ZURyYXdpbmdzKCk7XHJcbiAgICAgICAgICAgIG1hcC5vbihcInBtOmNyZWF0ZVwiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgYWRvcHREcmF3aW5nKGUubGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgd3JpdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbWFwLm9uKFwicG06cmVtb3ZlXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAvLyBHZW9tYW4gcmVtb3ZlcyB0aGUgbGF5ZXIgZnJvbSB0aGUgTUFQOyB0aGUgZmVhdHVyZSBncm91cCBzdGlsbFxyXG4gICAgICAgICAgICAgICAgLy8gaG9sZHMgaXQsIGFuZCB3cml0ZURyYXdpbmdzIHJlYWRzIHRoZSBncm91cCAtLSBldmljdCBpdCBmaXJzdFxyXG4gICAgICAgICAgICAgICAgLy8gb3IgdGhlIGRlbGV0aW9uIG5ldmVyIHJlYWNoZXMgdGhlIHRyYWl0LlxyXG4gICAgICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5yZW1vdmVMYXllcihlLmxheWVyKTtcclxuICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGxpc3RlbihcImNoYW5nZTpkcmF3aW5nc1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXN1cHByZXNzRHJhd2luZ3NFY2hvKSByZWh5ZHJhdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFkcmF3UmVhZHkpIHJldHVybjtcclxuICAgICAgICBpZiAoc2hvdykge1xyXG4gICAgICAgICAgICBjb25zdCB0b29scyA9IGNmZy50b29sc1xyXG4gICAgICAgICAgICAgICAgfHwgW1wibWFya2VyXCIsIFwicG9seWxpbmVcIiwgXCJyZWN0YW5nbGVcIiwgXCJwb2x5Z29uXCIsIFwiY2lyY2xlXCJdO1xyXG4gICAgICAgICAgICBtYXAucG0uYWRkQ29udHJvbHMoe1xyXG4gICAgICAgICAgICAgICAgcG9zaXRpb246IChjZmcucG9zaXRpb24gfHwgXCJ0b3AtbGVmdFwiKS5yZXBsYWNlKFwiLVwiLCBcIlwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdNYXJrZXI6IHRvb2xzLmluY2x1ZGVzKFwibWFya2VyXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd1BvbHlsaW5lOiB0b29scy5pbmNsdWRlcyhcInBvbHlsaW5lXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd1JlY3RhbmdsZTogdG9vbHMuaW5jbHVkZXMoXCJyZWN0YW5nbGVcIiksXHJcbiAgICAgICAgICAgICAgICBkcmF3UG9seWdvbjogdG9vbHMuaW5jbHVkZXMoXCJwb2x5Z29uXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd0NpcmNsZTogdG9vbHMuaW5jbHVkZXMoXCJjaXJjbGVcIiksXHJcbiAgICAgICAgICAgICAgICBkcmF3Q2lyY2xlTWFya2VyOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGRyYXdUZXh0OiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHJvdGF0ZU1vZGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgY3V0UG9seWdvbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBlZGl0TW9kZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGRyYWdNb2RlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgcmVtb3ZhbE1vZGU6IHRydWUsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG1hcC5wbS5yZW1vdmVDb250cm9scygpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHN5bmNEcmF3KCk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2hvd19kcmF3XCIsIHN5bmNEcmF3KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpkcmF3X2NvbmZpZ1wiLCBzeW5jRHJhdyk7XHJcblxyXG4gICAgLy8gVGhlIHNjYWxlIGJhcjogTGVhZmxldCdzIG93biBjb250cm9sLCB3aGljaCBtZWFzdXJlcyB0aHJvdWdoIHRoZSBtYXAncyBDUlNcclxuICAgIC8vIChoYXZlcnNpbmUgdW5kZXIgMzg1NyBhbmQgNDMyNiBhbGlrZSAtLSBubyBwaXhlbCBtYXRoIG9mIG91cnMpLCBleHRlbmRlZFxyXG4gICAgLy8gd2l0aCB0aGUgdW5pdCBMZWFmbGV0IGxhY2tzIGFuZCB0aGlzIGRvbWFpbiBydW5zIG9uOiBuYXV0aWNhbCBtaWxlcy5cclxuICAgIGNvbnN0IE5hdXRpY2FsU2NhbGUgPSBMLkNvbnRyb2wuU2NhbGUuZXh0ZW5kKHtcclxuICAgICAgICBvbkFkZDogZnVuY3Rpb24gKG0pIHtcclxuICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5vbkFkZC5jYWxsKHRoaXMsIG0pO1xyXG4gICAgICAgICAgICB0aGlzLl9uYXV0aWNhbFNjYWxlID0gTC5Eb21VdGlsLmNyZWF0ZShcclxuICAgICAgICAgICAgICAgIFwiZGl2XCIsIFwibGVhZmxldC1jb250cm9sLXNjYWxlLWxpbmVcIiwgY29udGFpbmVyKTtcclxuICAgICAgICAgICAgdGhpcy5fdXBkYXRlKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBjb250YWluZXI7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBfdXBkYXRlU2NhbGVzOiBmdW5jdGlvbiAobWF4TWV0ZXJzKSB7XHJcbiAgICAgICAgICAgIEwuQ29udHJvbC5TY2FsZS5wcm90b3R5cGUuX3VwZGF0ZVNjYWxlcy5jYWxsKHRoaXMsIG1heE1ldGVycyk7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9uYXV0aWNhbFNjYWxlICYmIG1heE1ldGVycykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbWF4Tm0gPSBtYXhNZXRlcnMgLyAxODUyO1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgbm0gPSB0aGlzLl9nZXRSb3VuZE51bShtYXhObSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl91cGRhdGVTY2FsZSh0aGlzLl9uYXV0aWNhbFNjYWxlLCBgJHtubX0gbm1gLCBubSAvIG1heE5tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgc2NhbGVDb250cm9sID0gbnVsbDtcclxuICAgIGZ1bmN0aW9uIHN5bmNTY2FsZSgpIHtcclxuICAgICAgICBpZiAoc2NhbGVDb250cm9sKSB7XHJcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgc2NhbGVDb250cm9sID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFob3N0LmdldChcInNob3dfc2NhbGVcIikpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcInNjYWxlX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCB1bml0cyA9IGNmZy51bml0cyB8fCBcIm1ldHJpY1wiO1xyXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgIHBvc2l0aW9uOiAoY2ZnLnBvc2l0aW9uIHx8IFwiYm90dG9tLWxlZnRcIikucmVwbGFjZShcIi1cIiwgXCJcIiksXHJcbiAgICAgICAgICAgIG1heFdpZHRoOiBjZmcubWF4X3dpZHRoIHx8IDEyMCxcclxuICAgICAgICAgICAgbWV0cmljOiB1bml0cyA9PT0gXCJtZXRyaWNcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXHJcbiAgICAgICAgICAgIGltcGVyaWFsOiB1bml0cyA9PT0gXCJpbXBlcmlhbFwiIHx8IHVuaXRzID09PSBcImJvdGhcIixcclxuICAgICAgICB9O1xyXG4gICAgICAgIHNjYWxlQ29udHJvbCA9IHVuaXRzID09PSBcIm5hdXRpY2FsXCJcclxuICAgICAgICAgICAgPyBuZXcgTmF1dGljYWxTY2FsZShvcHRpb25zKVxyXG4gICAgICAgICAgICA6IEwuY29udHJvbC5zY2FsZShvcHRpb25zKTtcclxuICAgICAgICBzY2FsZUNvbnRyb2wuYWRkVG8obWFwKTtcclxuICAgIH1cclxuICAgIHN5bmNTY2FsZSgpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnNob3dfc2NhbGVcIiwgc3luY1NjYWxlKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzY2FsZV9jb25maWdcIiwgc3luY1NjYWxlKTtcclxuXHJcbiAgICAvLyBFbXB0eS1tYXAgY2xpY2tzOiByZXBvcnQgd2hlcmUuIFJlZ2lzdGVyZWQgdGhyb3VnaCB0aGUgc2FtZSBhcmJpdHJhdGlvbiB0aGVcclxuICAgIC8vIGZlYXR1cmUgaGFuZGxlcnMgdXNlLCBhdCB0aGUgbG93ZXN0IHByaW9yaXR5LCBzbyBhIGNsaWNrIHRoYXQgaGl0IGEgZmVhdHVyZVxyXG4gICAgLy8gc3RheXMgdGhhdCBmZWF0dXJlJ3MgY2xpY2sgLS0gdGhpcyB3aW5zIG9ubHkgd2hlbiBub3RoaW5nIGNsYWltZWQgdGhlIGV2ZW50LlxyXG4gICAgLy8gZS5sYXRsbmcgaXMgYWxyZWFkeSB1bnByb2plY3RlZCB0aHJvdWdoIHdoaWNoZXZlciBDUlMgdGhlIG1hcCBydW5zICgzODU3IGFuZFxyXG4gICAgLy8gNDMyNiBhbGlrZSksIHNvIHRoZXJlIGlzIG5vIHBpeGVsIG1hdGggdG8gZ2V0IHdyb25nIGhlcmU7IHdyYXAoKSBrZWVwcyBhXHJcbiAgICAvLyB3b3JsZC1wYW5uZWQgbWFwIGZyb20gcmVwb3J0aW5nIGxvbmdpdHVkZSAtMzY0LlxyXG4gICAgbWFwLm9uKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAvLyBTdGFtcGVkIHN5bmNocm9ub3VzbHksIGJlZm9yZSBhbnkgZ2xpZnkgaGFuZGxlciByZWdpc3RlcnMgaXRzIG1hdGNoXHJcbiAgICAgICAgLy8gKHRoaXMgaGFuZGxlciB3YXMgYm91bmQgZmlyc3QsIHNvIExlYWZsZXQgcnVucyBpdCBmaXJzdCk6IHRoZSB3aG9sZVxyXG4gICAgICAgIC8vIGNsaWNrIHBpcGVsaW5lIC0tIGZlYXR1cmUgcG9wdXBzIGFuZCB0aGlzIGZhbGxiYWNrIGFsaWtlIC0tIHN0YW5kc1xyXG4gICAgICAgIC8vIGRvd24gd2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZC4gRGVmZXJyZWQgY2hlY2tzIG1pc3MgbW9kZXMgdGhhdFxyXG4gICAgICAgIC8vIGNsb3NlIHRoZW1zZWx2ZXMgb24gdGhlaXIgZmluaXNoaW5nIGNsaWNrIChhIGNvbXBsZXRlZCByZWN0YW5nbGUpLFxyXG4gICAgICAgIC8vIHdoaWNoIGlzIHdoeSB0aGUgc3RhdGUgaXMgY2FwdHVyZWQgYXQgY2xpY2sgdGltZS5cclxuICAgICAgICBjb25zdCBwbSA9IG1hcC5wbTtcclxuICAgICAgICBtYXAuX3BtTW9kZUFjdGl2ZSA9IEJvb2xlYW4ocG1cclxuICAgICAgICAgICAgJiYgKChwbS5nbG9iYWxSZW1vdmFsTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsUmVtb3ZhbE1vZGVFbmFibGVkKCkpXHJcbiAgICAgICAgICAgICAgICB8fCAocG0uZ2xvYmFsRWRpdE1vZGVFbmFibGVkICYmIHBtLmdsb2JhbEVkaXRNb2RlRW5hYmxlZCgpKVxyXG4gICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbERyYWdNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxEcmFnTW9kZUVuYWJsZWQoKSlcclxuICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmF3TW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhd01vZGVFbmFibGVkKCkpKSk7XHJcbiAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgOTksICgpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgbGwgPSBlLmxhdGxuZy53cmFwKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IE1hdGgucm91bmQobGwubGF0ICogMWU1KSAvIDFlNTtcclxuICAgICAgICAgICAgY29uc3QgbG5nID0gTWF0aC5yb3VuZChsbC5sbmcgKiAxZTUpIC8gMWU1O1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIFwiXCIpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAtMSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF0bG5nXCIsIFtsYXQsIGxuZ10pO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja19zZXFcIiwgKGhvc3QuZ2V0KFwiY2xpY2tfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cclxuICAgICAgICAgICAgaWYgKGhvc3QuZ2V0KFwic2hvd19jbGlja19jb29yZGluYXRlc1wiKSkge1xyXG4gICAgICAgICAgICAgICAgTC5wb3B1cCh7IGNsYXNzTmFtZTogXCJzd2lmdG1hcC1jb29yZHMtcG9wdXBcIiwgY2xvc2VCdXR0b246IGZhbHNlIH0pXHJcbiAgICAgICAgICAgICAgICAgICAgLnNldExhdExuZyhlLmxhdGxuZylcclxuICAgICAgICAgICAgICAgICAgICAuc2V0Q29udGVudChgJHtsbC5sYXQudG9GaXhlZCg1KX0sICR7bGwubG5nLnRvRml4ZWQoNSl9YClcclxuICAgICAgICAgICAgICAgICAgICAub3Blbk9uKG1hcCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEJpbmQgem9vbSBhbmQgY2VudGVyIGNoYW5nZXMgYmFjayB0byBQeXRob24gc2FmZWx5XHJcbiAgICBtYXAub24oXCJtb3ZlZW5kXCIsICgpID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRab29tID0gbWFwLmdldFpvb20oKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IG1vZGVsQ2VudGVyID0gaG9zdC5nZXQoXCJjZW50ZXJcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IG1vZGVsWm9vbSA9IGhvc3QuZ2V0KFwiem9vbVwiKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbW9kZWxab29tICE9PSBjdXJyZW50Wm9vbTtcclxuICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9ICFtb2RlbENlbnRlciB8fCBcclxuICAgICAgICAgICAgICAgICFBcnJheS5pc0FycmF5KG1vZGVsQ2VudGVyKSB8fFxyXG4gICAgICAgICAgICAgICAgbW9kZWxDZW50ZXIubGVuZ3RoIDwgMiB8fFxyXG4gICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMF0gLSBjZW50ZXIubGF0KSA+IDAuMDAwMSB8fCBcclxuICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzFdIC0gY2VudGVyLmxuZykgPiAwLjAwMDE7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiY2VudGVyXCIsIFtjZW50ZXIubGF0LCBjZW50ZXIubG5nXSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHpvb21DaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJ6b29tXCIsIGN1cnJlbnRab29tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgc2FmZVNhdmVDaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIG1vdmVlbmQgaGFuZGxlcjpcIiwgZXJyKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBmdW5jdGlvbiB1cGRhdGVNYXBWaWV3KCkge1xyXG4gICAgICAgIGNvbnN0IGNlbnRlciA9IGhvc3QuZ2V0KFwiY2VudGVyXCIpO1xyXG4gICAgICAgIGNvbnN0IHpvb20gPSBob3N0LmdldChcInpvb21cIik7XHJcbiAgICAgICAgaWYgKGNlbnRlciAmJiBBcnJheS5pc0FycmF5KGNlbnRlcikgJiYgY2VudGVyLmxlbmd0aCA+PSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcENlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcclxuICAgICAgICAgICAgY29uc3QgbWFwWm9vbSA9IG1hcC5nZXRab29tKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSBNYXRoLmFicyhtYXBDZW50ZXIubGF0IC0gY2VudGVyWzBdKSA+IDAuMDAwMSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1hcENlbnRlci5sbmcgLSBjZW50ZXJbMV0pID4gMC4wMDAxO1xyXG4gICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1hcFpvb20gIT09IHpvb207XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgbWFwLnNldFZpZXcoY2VudGVyLCB0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiA/IHpvb20gOiBtYXBab29tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHpvb20gPSBob3N0LmdldChcInpvb21cIik7XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiAmJiBtYXAuZ2V0Wm9vbSgpICE9PSB6b29tKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbSh6b29tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBXYXRjaCBmb3IgbWFwIHZpZXcgdXBkYXRlcyBmcm9tIFB5dGhvblxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmNlbnRlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgaWYgKGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwKSB7XHJcbiAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgdXBkYXRlTWFwVmlldygpO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6em9vbVwiLCAoKSA9PiB7XHJcbiAgICAgICAgaWYgKGlzVXBkYXRpbmdab29tRnJvbU1hcCkge1xyXG4gICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XHJcbiAgICB9KTtcclxuICAgIC8vIEZpdHRpbmcgdGhlIHZpZXcgaXMgYSBjb21tYW5kLCBub3Qgc3RhdGU6IGFza2luZyB0byBmaXQgdGhlIHNhbWUgYm91bmRzIHR3aWNlXHJcbiAgICAvLyBtdXN0IG1vdmUgdGhlIG1hcCBib3RoIHRpbWVzLCBzaW5jZSB0aGUgdXNlciBtYXkgaGF2ZSBwYW5uZWQgYXdheSBpbiBiZXR3ZWVuLlxyXG4gICAgLy8gVGhlIHJlcXVlc3QgY2FycmllcyBhIHNlcXVlbmNlIG51bWJlciBzbyBhbiBpZGVudGljYWwgZml0IHN0aWxsIGZpcmVzIGEgY2hhbmdlLlxyXG4gICAgZnVuY3Rpb24gYXBwbHlGaXRSZXF1ZXN0KCkge1xyXG4gICAgICAgIGNvbnN0IHJlcSA9IGhvc3QuZ2V0KFwiZml0X2JvdW5kc19yZXF1ZXN0XCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IGJvdW5kcyA9IHJlcS5ib3VuZHM7XHJcbiAgICAgICAgaWYgKCFib3VuZHMgfHwgYm91bmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG5cclxuICAgICAgICBjb25zdCBvcHRpb25zID0ge307XHJcbiAgICAgICAgaWYgKHJlcS5wYWRkaW5nICE9IG51bGwpIG9wdGlvbnMucGFkZGluZyA9IFtyZXEucGFkZGluZywgcmVxLnBhZGRpbmddO1xyXG4gICAgICAgIGlmIChyZXEubWF4X3pvb20gIT0gbnVsbCkgb3B0aW9ucy5tYXhab29tID0gcmVxLm1heF96b29tO1xyXG4gICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzLCBvcHRpb25zKTtcclxuXHJcbiAgICAgICAgLy8gQXBwbGllZCBhZnRlciB0aGUgZml0LCBzaW5jZSBpdCBpcyByZWxhdGl2ZSB0byB3aGF0ZXZlciB6b29tIHRoZSBmaXQgY2hvc2UuXHJcbiAgICAgICAgaWYgKHJlcS56b29tX29mZnNldCkge1xyXG4gICAgICAgICAgICBtYXAuc2V0Wm9vbShtYXAuZ2V0Wm9vbSgpICsgcmVxLnpvb21fb2Zmc2V0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6Zml0X2JvdW5kc19yZXF1ZXN0XCIsIGFwcGx5Rml0UmVxdWVzdCk7XHJcbiAgICAvLyBBIHJlcXVlc3Qgc2V0IGJlZm9yZSB0aGlzIHZpZXcgYXR0YWNoZWQgLS0gYSBwcmUtZGlzcGxheSBmaXRfYm91bmRzKCkgY2FsbCxcclxuICAgIC8vIG9yIHRoZSB1bmlvbiBhIGZyZXNoIG1hcCBtYWludGFpbnMgYXMgYXV0by1maXQgd2hpbGUgbGF5ZXJzIGFyZSBhZGRlZCAtLSBpc1xyXG4gICAgLy8gYWxyZWFkeSBzdGF0ZSBieSBub3csIHNvIHRoZSBjaGFuZ2UgZXZlbnQgd2lsbCBuZXZlciBmaXJlIGZvciBpdC4gSXQgdXNlZFxyXG4gICAgLy8gdG8gYmUgc2lsZW50bHkgZHJvcHBlZDsgYXBwbHkgaXQgb25jZSB0aGUgbWFwIGlzIHJlYWR5IGluc3RlYWQuXHJcbiAgICBtYXAud2hlblJlYWR5KCgpID0+IGFwcGx5Rml0UmVxdWVzdCgpKTtcclxuICAgIC8vIEEgbWFwIGNvbnN0cnVjdGVkIGluc2lkZSBhIGhpZGRlbiBjb250YWluZXIgLS0gYSBTaGlueSBuYXZfcGFuZWwgdGhhdCBpc1xyXG4gICAgLy8gbm90IHRoZSBzZWxlY3RlZCB0YWIgLS0gaW5pdGlhbGlzZXMgYXQgMHgwLCBhbmQgTGVhZmxldCBjYWNoZXMgdGhhdCBzaXplOlxyXG4gICAgLy8gaXRzIG93biB0cmFja1Jlc2l6ZSB3YXRjaGVzIHRoZSBXSU5ET1csIG5vdCB0aGUgY29udGFpbmVyLCBzbyBub3RoaW5nIGV2ZXJcclxuICAgIC8vIGNvcnJlY3RzIGl0LiBUaGUgZml0IGFib3ZlIHRoZW4gY29tcHV0ZXMgaXRzIHpvb20gZnJvbSBhIHplcm8tc2l6ZSBsaWUgYW5kXHJcbiAgICAvLyB0aGUgdmlldyBsYW5kcyB3cm9uZyBwZXJtYW5lbnRseS4gV2F0Y2ggdGhlIGNvbnRhaW5lciBpdHNlbGY6IGV2ZXJ5IHJlc2l6ZVxyXG4gICAgLy8gcmUtbWVhc3VyZXMsIGFuZCB0aGUgZmlyc3QgdHJhbnNpdGlvbiBmcm9tIHplcm8gdG8gcmVhbCBzaXplIHJlLWFwcGxpZXNcclxuICAgIC8vIHRoZSBwZW5kaW5nIGZpdCB3aXRoIGEgc2l6ZSB0aGF0IGNhbiBhY3R1YWxseSBob2xkIGl0LlxyXG4gICAgbGV0IGNvbnRhaW5lclJlc2l6ZSA9IG51bGw7XHJcbiAgICBpZiAodHlwZW9mIFJlc2l6ZU9ic2VydmVyICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgbGV0IGhhZFNpemUgPSBjb250YWluZXIuY2xpZW50V2lkdGggPiAwICYmIGNvbnRhaW5lci5jbGllbnRIZWlnaHQgPiAwO1xyXG4gICAgICAgIGNvbnRhaW5lclJlc2l6ZSA9IG5ldyBSZXNpemVPYnNlcnZlcigoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGhhc1NpemUgPSBjb250YWluZXIuY2xpZW50V2lkdGggPiAwICYmIGNvbnRhaW5lci5jbGllbnRIZWlnaHQgPiAwO1xyXG4gICAgICAgICAgICBpZiAoaGFzU2l6ZSkge1xyXG4gICAgICAgICAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWhhZFNpemUpIGFwcGx5Rml0UmVxdWVzdCgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGhhZFNpemUgPSBoYXNTaXplO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRhaW5lclJlc2l6ZS5vYnNlcnZlKGNvbnRhaW5lcik7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHN5bmNUaW1lb3V0ID0gbnVsbDtcclxuICAgIGxldCBpc1N5bmNpbmcgPSBmYWxzZTtcclxuICAgIGxldCBuZWVkc1N5bmMgPSBmYWxzZTtcclxuXHJcbiAgICBhc3luYyBmdW5jdGlvbiBwZXJmb3JtU3luYygpIHtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgaWYgKGlzU3luY2luZykge1xyXG4gICAgICAgICAgICBuZWVkc1N5bmMgPSB0cnVlO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlzU3luY2luZyA9IHRydWU7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgc3luY01hcFN0YXRlKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBzeW5jTWFwU3RhdGU6XCIsIGVycik7XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgaXNTeW5jaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgIGlmIChuZWVkc1N5bmMpIHtcclxuICAgICAgICAgICAgICAgIG5lZWRzU3luYyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBxdWV1ZVN5bmMoKSB7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCB8fCAhaG9zdC5nZXQoXCJhdXRvX3N5bmNcIikpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcclxuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lb3V0KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgc3luY1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgIH0sIDUwKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBMaXN0ZW4gZm9yIG1hbnVhbCBzeW5jIHRyaWdnZXIgY2hhbmdlcyBmcm9tIFB5dGhvblxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnN5bmNfdHJpZ2dlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEluY3JlbWVudGFsIHVwZGF0ZXMgZnJvbSBQeXRob24uIEFwcGxpZWQgZXZlbiB3aGVuIGF1dG9fc3luYyBpcyBvZmYgc28gdGhlIG1pcnJvclxyXG4gICAgLy8gc3RheXMgY3VycmVudDsgcXVldWVTeW5jIGRlY2lkZXMgd2hldGhlciB0byBhY3R1YWxseSByZS1yZW5kZXIuXHJcbiAgICBsaXN0ZW4oXCJtc2c6Y3VzdG9tXCIsIChtc2csIGJ1ZmZlcnMpID0+IHtcclxuICAgICAgICBpZiAoIW1zZyB8fCBtc2cua2luZCAhPT0gXCJzd2lmdG1hcF9wYXRjaFwiKSByZXR1cm47XHJcbiAgICAgICAgYXBwbHlQYXRjaE9wcyhtc2cub3BzIHx8IFtdLCBidWZmZXJzKTtcclxuICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEZ1bGwtc25hcHNob3QgcGF0aHM6IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UsIGFuZCB0aGUgc2lkZWJhciB3cml0aW5nIGBsYXllcnNgXHJcbiAgICAvLyBiYWNrIGFmdGVyIGEgdG9nZ2xlLiBFaXRoZXIgd2F5IHRoZSB0cmFpdCBiZWNvbWVzIGF1dGhvcml0YXRpdmUgYWdhaW4uXHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6bGF5ZXJzXCIsICgpID0+IHtcclxuICAgICAgICBsYXllclN0YXRlID0gaG9zdC5nZXQoXCJsYXllcnNcIikgfHwgW107XHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpjb29yZGluYXRlX2J1ZmZlcnNcIiwgKCkgPT4ge1xyXG4gICAgICAgIGJ1ZmZlclN0YXRlID0geyAuLi4oaG9zdC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pIH07XHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpncm91cF9jb25maWdzXCIsIHF1ZXVlU3luYyk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6dGltZV9jb25maWdcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7ICAgLy8gcmUtYXBwbHkgc3BlZWQvbG9vcCBmcm9tIHRoZSBuZXcgY29uZmlnXHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuICAgIC8vIFB5dGhvbiBzdGVlcmluZyB0aGUgc2xpZGVyOiBzbmFwIHRvIHRoZSBuZWFyZXN0IHRpY2sgYXQgb3IgYWZ0ZXIgdGhlIHJlcXVlc3RlZFxyXG4gICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cclxuICAgIGxpc3RlbihcImNoYW5nZTp0aW1lX2N1cnJlbnRcIiwgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHdhbnRlZCA9IGhvc3QuZ2V0KFwidGltZV9jdXJyZW50XCIpO1xyXG4gICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XHJcbiAgICAgICAgaWYgKE1hdGguYWJzKHdhbnRlZCAtIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKSA8IDEpIHJldHVybjtcclxuICAgICAgICBsZXQgaWR4ID0gdGltZVVJLnRpY2tzLmZpbmRJbmRleCh0ID0+IHQgPj0gd2FudGVkKTtcclxuICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XHJcbiAgICAgICAgc2Vla1RvKGlkeCwgeyB3cml0ZTogZmFsc2UgfSk7XHJcbiAgICB9KTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzaG93X2xvZ29cIiwgcXVldWVTeW5jKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzaG93X2xlZ2VuZFwiLCBxdWV1ZVN5bmMpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmxlZ2VuZF9jb25maWdcIiwgcXVldWVTeW5jKTtcclxuICAgIC8vIExpdmUgcmVzaXplcyAoYSBTaGlueSBsYXlvdXQsIGEgbm90ZWJvb2sgY2VsbCk6IExlYWZsZXQgY2FjaGVzIGl0cyBib3gsIHNvXHJcbiAgICAvLyBpdCBtdXN0IGJlIHRvbGQgdG8gcmUtbWVhc3VyZSBvciB0aWxlcyByZW5kZXIgZm9yIHRoZSBvbGQgc2l6ZS5cclxuICAgIGxpc3RlbihcImNoYW5nZTpoZWlnaHRcIiwgKCkgPT4ge1xyXG4gICAgICAgIGFwcGx5SGVpZ2h0KCk7XHJcbiAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBbm5vdW5jZSB0aGlzIHZpZXcgc28gUHl0aG9uIHJlcGxpZXMgd2l0aCBhIGZ1bGwgc25hcHNob3QuIExheWVycyBhZGRlZCBiZWZvcmVcclxuICAgIC8vIHRoZSB2aWV3IGF0dGFjaGVkIHdvdWxkIG90aGVyd2lzZSBiZSBtaXNzaW5nOiB0aGVpciBwYXRjaGVzIHdlcmUgZW1pdHRlZCBpbnRvIGFcclxuICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIGhvc3Quc2VuZCh7IGtpbmQ6IFwic3dpZnRtYXBfcmVhZHlcIiB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgaXMgYWxsIHRoZXJlIGlzICovIH1cclxuXHJcbiAgICAvLyBSZXNwZWN0IGluaXRpYWwgYXV0b19zeW5jIHN0YXRlIG9yIG1hbnVhbCBzeW5jIHJlcXVlc3RzIHNlbnQgZHVyaW5nIG1hcCBidWlsZGluZ1xyXG4gICAgaWYgKGhvc3QuZ2V0KFwiYXV0b19zeW5jXCIpIHx8IGhvc3QuZ2V0KFwic3luY190cmlnZ2VyXCIpID4gMCkge1xyXG4gICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVGhlIGhhbmRsZSBhIGhvc3Qga2VlcHM6IHRoZSBsaXZlIG1hcCBhbmQgYSB0ZWFyZG93biB0aGF0IHJlbGVhc2VzIHdoYXQgdGhlXHJcbiAgICAvLyBwYWdlIGNhbm5vdCByZWNsYWltIG9uIGl0cyBvd24gLS0gcGxheWJhY2sgdGltZXJzLCB0aGUgcGVuZGluZyBzeW5jLCB0aGVcclxuICAgIC8vIGNvbnRhaW5lcidzIHJlc2l6ZSBvYnNlcnZlciwgdGhlIGNvbnNvbGUgaG9va3MsIHRoZSBob3N0IHN1YnNjcmlwdGlvbnMsIGFuZFxyXG4gICAgLy8gdGhlIExlYWZsZXQgbWFwIHdpdGggZXZlcnkgR0wgY29udGV4dCBhbmQgYmxvYiBVUkwgaXRzIGxheWVycyBob2xkLlxyXG4gICAgZnVuY3Rpb24gZGVzdHJveSgpIHtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgZGVzdHJveWVkID0gdHJ1ZTtcclxuICAgICAgICBzdG9wUGxheWJhY2soKTtcclxuICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcclxuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lb3V0KTtcclxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoY29udGFpbmVyUmVzaXplKSBjb250YWluZXJSZXNpemUuZGlzY29ubmVjdCgpO1xyXG4gICAgICAgIGlmICh0eXBlb2YgaG9zdC5vZmYgPT09IFwiZnVuY3Rpb25cIikge1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtldmVudCwgZm5dIG9mIHN1YnNjcmlwdGlvbnMpIGhvc3Qub2ZmKGV2ZW50LCBmbik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IgPSBvcmlnaW5hbEVycm9yO1xyXG4gICAgICAgIGNvbnNvbGUud2FybiA9IG9yaWdpbmFsV2FybjtcclxuICAgICAgICBpZiAod2luZG93Lm9uZXJyb3IgPT09IG9uV2luZG93RXJyb3IpIHdpbmRvdy5vbmVycm9yID0gbnVsbDtcclxuICAgICAgICAvLyBnbGlmeSBrZWVwcyBldmVyeSBpbnN0YW5jZSBpbiBhIG1vZHVsZS1sZXZlbCBsaXN0OyBtYXAucmVtb3ZlKCkgYWxvbmVcclxuICAgICAgICAvLyB3b3VsZCBsZWF2ZSBlYWNoIG9uZSAtLSBhbmQgaXRzIEdMIGNvbnRleHQgLS0gcmVnaXN0ZXJlZCB0aGVyZS4gVGhlXHJcbiAgICAgICAgLy8gc3dlZXAgb3ZlciB0aG9zZSBsaXN0cyBhbHNvIGNhdGNoZXMgYW4gaW5zdGFuY2UgYSBzeW5jIGJ1aWx0IGZvciB0aGlzXHJcbiAgICAgICAgLy8gbWFwIGFuZCBoYWQgbm90IHlldCByZWNvcmRlZCB3aGVuIHRoZSBob3N0IGRlc3Ryb3llZCBpdC5cclxuICAgICAgICBmb3IgKGNvbnN0IHN0YXRlIG9mIE9iamVjdC52YWx1ZXMoZ2xTdGF0ZXMpKSB7XHJcbiAgICAgICAgICAgIHJldGlyZUdsKHN0YXRlLmxheWVyKTtcclxuICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBnbGlmeSA9IEwuZ2xpZnk7XHJcbiAgICAgICAgaWYgKGdsaWZ5KSB7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGlzdCBvZiBbZ2xpZnkucG9pbnRzSW5zdGFuY2VzLCBnbGlmeS5saW5lc0luc3RhbmNlcywgZ2xpZnkuc2hhcGVzSW5zdGFuY2VzXSkge1xyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBpbnN0YW5jZSBvZiBbLi4uKGxpc3QgfHwgW10pXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZS5tYXAgPT09IG1hcCkgcmV0aXJlR2woaW5zdGFuY2UpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIG1hcC5yZW1vdmUoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogYWxyZWFkeSB0b3JuIGRvd24gKi8gfVxyXG4gICAgICAgIGlmIChjb250YWluZXIucGFyZW50Tm9kZSkgY29udGFpbmVyLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoY29udGFpbmVyKTtcclxuICAgIH1cclxuICAgIHJldHVybiB7IG1hcCwgY29udGFpbmVyLCBzeW5jOiBwZXJmb3JtU3luYywgZGVzdHJveSB9O1xyXG59XHJcbiIsICIvLyBUaGUgQ0ROIGxvYWRlciwgZm9yIGhvc3RzIHdob3NlIHBhZ2UgaGFzIG5vIGJ1bmRsZXI6IHRoZSBhbnl3aWRnZXQgd2lkZ2V0IGFuZFxyXG4vLyBhIHN0YXRpYyBleHBvcnQuIEZldGNoZXMgTGVhZmxldCwgZ2xpZnkgYW5kIEdlb21hbiBmcm9tIHVucGtnIC0tIGEgcmVjZWl2aW5nXHJcbi8vIG5ldHdvcmsncyBwYXRjaGVyIHJld3JpdGVzIHRoZXNlIFVSTHMgbGlrZSBhbnkgb3RoZXIgQ0ROIHJlZmVyZW5jZSAtLSBhbmQgdGhlblxyXG4vLyBwcm92aWRlcyB0aGUgZ2xvYmFsIHRoZXkgaW5zdGFsbC4gRXZlcnl0aGluZyBpcyBhd2FpdGVkIGJlZm9yZSByZXR1cm5pbmcsIHNvXHJcbi8vIEdlb21hbiBleGlzdHMgYmVmb3JlIGFueSBtYXAgaXMgYnVpbHQuIFRoZSBVUkwgdGFibGUgaXMgYSBwYXJhbWV0ZXIgc28gYVxyXG4vLyB2ZW5kb3JlZCBvciBpbmxpbmVkIHZhcmlhbnQgaXMgYSBtYXR0ZXIgb2YgcGFzc2luZyBkaWZmZXJlbnQgb25lcy5cclxuaW1wb3J0IHsgbG9hZENTUywgbG9hZEpTIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcclxuaW1wb3J0IHsgcHJvdmlkZUxlYWZsZXQgfSBmcm9tIFwiLi9saWJzLmpzXCI7XHJcblxyXG5leHBvcnQgY29uc3QgTElCUkFSWV9VUkxTID0ge1xyXG4gICAgbGVhZmxldENzczogXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5jc3NcIixcclxuICAgIGxlYWZsZXRKczogXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5qc1wiLFxyXG4gICAgZ2xpZnlKczogXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0LmdsaWZ5QDMuMy4wL2Rpc3QvZ2xpZnktYnJvd3Nlci5qc1wiLFxyXG4gICAgZ2VvbWFuQ3NzOiBcImh0dHBzOi8vdW5wa2cuY29tL0BnZW9tYW4taW8vbGVhZmxldC1nZW9tYW4tZnJlZUAyLjE4LjMvZGlzdC9sZWFmbGV0LWdlb21hbi5jc3NcIixcclxuICAgIGdlb21hbkpzOiBcImh0dHBzOi8vdW5wa2cuY29tL0BnZW9tYW4taW8vbGVhZmxldC1nZW9tYW4tZnJlZUAyLjE4LjMvZGlzdC9sZWFmbGV0LWdlb21hbi5taW4uanNcIixcclxufTtcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkTGlicmFyaWVzKHVybHMgPSBMSUJSQVJZX1VSTFMpIHtcclxuICAgIGxvYWRDU1MoXCJsZWFmbGV0LWNzc1wiLCB1cmxzLmxlYWZsZXRDc3MpO1xyXG4gICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1qc1wiLCB1cmxzLmxlYWZsZXRKcyk7XHJcbiAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdsaWZ5XCIsIHVybHMuZ2xpZnlKcyk7XHJcbiAgICBsb2FkQ1NTKFwibGVhZmxldC1nZW9tYW4tY3NzXCIsIHVybHMuZ2VvbWFuQ3NzKTtcclxuICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2VvbWFuXCIsIHVybHMuZ2VvbWFuSnMpO1xyXG4gICAgcmV0dXJuIHByb3ZpZGVMZWFmbGV0KHdpbmRvdy5MKTtcclxufVxyXG4iLCAiLyoqXHJcbiAqIFRoZSBob3N0IGludGVyZmFjZTogd2hhdCBhIHN3aWZ0bWFwIGNvcmUgaW5zdGFuY2UgbmVlZHMgZnJvbSB3aGF0ZXZlciBlbWJlZHMgaXQuXHJcbiAqXHJcbiAqIEZpdmUgbWV0aG9kcywgYWxyZWFkeSBwcm92ZW4gYnkgZXZlcnkgc3RhdGljIGV4cG9ydCwgd2hpY2ggcnVucyB0aGUgcmVhbCBidW5kbGVcclxuICogYWdhaW5zdCBleGFjdGx5IHRoaXMgc3VyZmFjZSB3aXRoIG5vIFB5dGhvbiBiZWhpbmQgaXQ6XHJcbiAqXHJcbiAqICAgZ2V0KGtleSkgICAgICAgICAgICAgIC0+IHRoZSBjdXJyZW50IHZhbHVlIG9mIGEgc3RhdGUga2V5XHJcbiAqICAgc2V0KGtleSwgdmFsdWUpICAgICAgIC0+IHN0b3JlIGl0IGFuZCBmaXJlIHRoZSBgY2hhbmdlOjxrZXk+YCBsaXN0ZW5lcnNcclxuICogICBvbihldmVudCwgZm4pICAgICAgICAgLT4gc3Vic2NyaWJlOyBgY2hhbmdlOjxrZXk+YCwgYW5kIGBtc2c6Y3VzdG9tYCBmb3IgcGF0Y2hlc1xyXG4gKiAgIHNlbmQoY29udGVudCwgYnVmZmVycyktPiBhIG1lc3NhZ2UgdG8gdGhlIG90aGVyIHNpZGUgKG1heSBnbyBub3doZXJlKVxyXG4gKiAgIHNhdmVfY2hhbmdlcygpICAgICAgICAtPiBmbHVzaCBwZW5kaW5nIHdyaXRlcyAobWF5IGJlIGEgbm8tb3ApXHJcbiAqXHJcbiAqIE9wdGlvbmFsOiBvZmYoZXZlbnQsIGZuKSwgaG9ub3VyZWQgYnkgZGVzdHJveSgpIHdoZW4gcHJlc2VudC5cclxuICpcclxuICogVGhlIGNvcmUgcmVhZHMgdGhlc2Uga2V5cyB0aHJvdWdoIGdldCgpOiBsYXllcnMsIGNvb3JkaW5hdGVfYnVmZmVycywgZ3JvdXBfY29uZmlncyxcclxuICogY2VudGVyLCB6b29tLCBjcnMsIGhlaWdodCwgYXV0b19zeW5jLCBzeW5jX3RyaWdnZXIsIHNob3dfbG9nbywgbG9nb19jb25maWcsXHJcbiAqIHNob3dfbGVnZW5kLCBsZWdlbmRfY29uZmlnLCBzaG93X3NjYWxlLCBzY2FsZV9jb25maWcsIHNob3dfZHJhdywgZHJhd19jb25maWcsXHJcbiAqIGRyYXdpbmdzLCBkcmF3X3NlcSwgc2hvd19jbGlja19jb29yZGluYXRlcywgdGltZV9jb25maWcsIHRpbWVfY3VycmVudCxcclxuICogZml0X2JvdW5kc19yZXF1ZXN0LCBqc19jb25zb2xlX2xvZ3MuIEl0IHdyaXRlcyBiYWNrIHRocm91Z2ggc2V0KCk6IGNlbnRlciwgem9vbSxcclxuICogY2xpY2tlZF9sYXllcl9pZCwgc2VsZWN0ZWRfaW5kZXgsIGNsaWNrZWRfbGF0bG5nLCBjbGlja19zZXEsIGRyYXdpbmdzLCBkcmF3X3NlcSxcclxuICogdGltZV9jdXJyZW50LCB0aW1lX2NvbmZpZywgZ3JvdXBfY29uZmlncywganNfY29uc29sZV9sb2dzLiBTaWRlYmFyIHRvZ2dsZXMgZ28gb3V0XHJcbiAqIHRocm91Z2ggc2VuZCgpIGFzIHtraW5kOiBcInN3aWZ0bWFwX3dyaXRlXCIsIG9wc307IHRoZSB3aWRnZXQgYW5ub3VuY2VzIGl0c2VsZiB3aXRoXHJcbiAqIHtraW5kOiBcInN3aWZ0bWFwX3JlYWR5XCJ9LiBJbmNyZW1lbnRhbCB1cGRhdGVzIGFycml2ZSBvbiB0aGUgYG1zZzpjdXN0b21gIGV2ZW50IGFzXHJcbiAqICh7a2luZDogXCJzd2lmdG1hcF9wYXRjaFwiLCBvcHN9LCBidWZmZXJzKS5cclxuICpcclxuICogYW55d2lkZ2V0J3MgbW9kZWwgc2F0aXNmaWVzIHRoaXMgYXMtaXM7IHRoZSBzdHViIGJlbG93IGlzIHRoZSByZWZlcmVuY2UgaG9zdCBmb3JcclxuICogZXhwb3J0cywgdGVzdHMsIGFuZCBhbnkgZW1iZWRkaW5nIHdpdGggbm8ga2VybmVsIGJlaGluZCBpdC5cclxuICovXHJcblxyXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSG9zdFN0dWIoaW5pdGlhbCA9IHt9LCBob29rcyA9IHt9KSB7XHJcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uaW5pdGlhbCB9O1xyXG4gICAgY29uc3QgbGlzdGVuZXJzID0ge307XHJcbiAgICBjb25zdCBob3N0ID0ge1xyXG4gICAgICAgIGNvbW06IGhvb2tzLmNvbW0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBob29rcy5jb21tLFxyXG4gICAgICAgIHN0YXRlLFxyXG4gICAgICAgIHNldHM6IFtdLCAgICAgIC8vIGV2ZXJ5IHNldCgpLCBpbiBvcmRlciwgZm9yIGFzc2VydGlvbnNcclxuICAgICAgICBzZW50OiBbXSwgICAgICAvLyBldmVyeSBzZW5kKClcclxuICAgICAgICBzYXZlczogMCxcclxuICAgICAgICBnZXQ6IGtleSA9PiBzdGF0ZVtrZXldLFxyXG4gICAgICAgIHNldChrZXksIHZhbHVlKSB7XHJcbiAgICAgICAgICAgIHN0YXRlW2tleV0gPSB2YWx1ZTtcclxuICAgICAgICAgICAgaG9zdC5zZXRzLnB1c2goW2tleSwgdmFsdWVdKTtcclxuICAgICAgICAgICAgKGxpc3RlbmVyc1tgY2hhbmdlOiR7a2V5fWBdIHx8IFtdKS5mb3JFYWNoKGZuID0+IGZuKCkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb24oZXZlbnQsIGZuKSB7XHJcbiAgICAgICAgICAgIChsaXN0ZW5lcnNbZXZlbnRdID0gbGlzdGVuZXJzW2V2ZW50XSB8fCBbXSkucHVzaChmbik7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvZmYoZXZlbnQsIGZuKSB7XHJcbiAgICAgICAgICAgIGxpc3RlbmVyc1tldmVudF0gPSAobGlzdGVuZXJzW2V2ZW50XSB8fCBbXSkuZmlsdGVyKGYgPT4gZiAhPT0gZm4pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2VuZChjb250ZW50LCBidWZmZXJzKSB7XHJcbiAgICAgICAgICAgIGhvc3Quc2VudC5wdXNoKHsgY29udGVudCwgYnVmZmVycyB9KTtcclxuICAgICAgICAgICAgaWYgKGhvb2tzLm9uU2VuZCkgaG9va3Mub25TZW5kKGNvbnRlbnQsIGJ1ZmZlcnMpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2F2ZV9jaGFuZ2VzKCkge1xyXG4gICAgICAgICAgICBob3N0LnNhdmVzICs9IDE7XHJcbiAgICAgICAgICAgIGlmIChob29rcy5vblNhdmUpIGhvb2tzLm9uU2F2ZSgpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gRmlyZXMgbGlzdGVuZXJzIGRpcmVjdGx5OiBob3cgYSB0ZXN0IG9yIGFuIGV4cG9ydCBwdXNoZXMgYSByZWFsXHJcbiAgICAgICAgLy8gc3dpZnRtYXBfcGF0Y2ggdGhyb3VnaCBgbXNnOmN1c3RvbWAsIGV4YWN0bHkgYXMgYSBrZXJuZWwgd291bGQuXHJcbiAgICAgICAgZW1pdChldmVudCwgLi4uYXJncykge1xyXG4gICAgICAgICAgICAobGlzdGVuZXJzW2V2ZW50XSB8fCBbXSkuZm9yRWFjaChmbiA9PiBmbiguLi5hcmdzKSk7XHJcbiAgICAgICAgfSxcclxuICAgIH07XHJcbiAgICByZXR1cm4gaG9zdDtcclxufVxyXG4iLCAiLy8gVGhlIGJhc2U2NCBidWZmZXIgdHJhbnNwb3J0OiBob3cgYSBKU09OLW9ubHkgY2hhbm5lbCBjYXJyaWVzIGJpbmFyeS5cbi8vXG4vLyBUaGUgc3RhdGljIGV4cG9ydCBiYWtlcyBldmVyeSBjb29yZGluYXRlL3RpbWUvc3R5bGUgYnVmZmVyIGludG8gaXRzIEhUTUwgYXNcbi8vIGJhc2U2NCwgYW5kIHRoZSBTdHJlYW1saXQgY29tcG9uZW50IHJlY2VpdmVzIHRoZW0gdGhlIHNhbWUgd2F5IC0tIGNvbXBvbmVudFxuLy8gYXJncyBhcmUgSlNPTiB0aHJvdWdoIGFuIGlmcmFtZTsgdGhlcmUgaXMgbm8gQXJyYXlCdWZmZXIgY2hhbm5lbC4gUHl0aG9uXG4vLyBlbmNvZGVzIHdpdGggc3dpZnRtYXAuZXhwb3J0LmVuY29kZV9idWZmZXJzOyB0aGlzIGlzIHRoZSBvbmUgZGVjb2RlciBib3RoXG4vLyBjb25zdW1lcnMgdXNlLCBzbyB0aGUgZW5jb2RpbmcgY2Fubm90IGRyaWZ0IGJldHdlZW4gc3RhY2tzLlxuZXhwb3J0IGZ1bmN0aW9uIGRlY29kZUJhc2U2NEJ1ZmZlcnMoZW5jb2RlZCkge1xuICAgIGNvbnN0IG91dCA9IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgYjY0XSBvZiBPYmplY3QuZW50cmllcyhlbmNvZGVkIHx8IHt9KSkge1xuICAgICAgICBjb25zdCBiaW4gPSBhdG9iKGI2NCk7XG4gICAgICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluLmxlbmd0aCk7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbi5jaGFyQ29kZUF0KGkpO1xuICAgICAgICBvdXRba2V5XSA9IG5ldyBEYXRhVmlldyhieXRlcy5idWZmZXIpO1xuICAgIH1cbiAgICByZXR1cm4gb3V0O1xufVxuXG4vLyBEZWNvZGVzIGEgbmV3IHNldCBvZiBlbmNvZGVkIGJ1ZmZlcnMsIGtlZXBpbmcgdGhlIHByZXZpb3VzbHkgZGVjb2RlZCB2aWV3IGZvclxuLy8gZXZlcnkga2V5IHdob3NlIGJhc2U2NCBpcyBieXRlLWlkZW50aWNhbC4gQnVmZmVyIGlkZW50aXR5IGlzIHBhcnQgb2YgdGhlIEdMXG4vLyBtZXRhIGtleSwgc28gYSBsYXllciB3aG9zZSBkYXRhIGRpZCBub3QgY2hhbmdlIGtlZXBzIGl0cyBHUFUgYnVmZmVycyBhY3Jvc3MgYVxuLy8gZnVsbC1zdGF0ZSByZS1zZW5kIC0tIHRoZSB2MSB0cmFuc3BvcnQncyBvbmUgY2hlYXAgdHJpY2suXG5leHBvcnQgZnVuY3Rpb24gZGVjb2RlQmFzZTY0QnVmZmVyc1JldXNpbmcoZW5jb2RlZCwgcHJldmlvdXNFbmNvZGVkLCBwcmV2aW91c0RlY29kZWQpIHtcbiAgICBjb25zdCBvdXQgPSB7fTtcbiAgICBjb25zdCBmcmVzaCA9IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgYjY0XSBvZiBPYmplY3QuZW50cmllcyhlbmNvZGVkIHx8IHt9KSkge1xuICAgICAgICBpZiAocHJldmlvdXNFbmNvZGVkICYmIHByZXZpb3VzRGVjb2RlZCAmJiBwcmV2aW91c0VuY29kZWRba2V5XSA9PT0gYjY0ICYmIHByZXZpb3VzRGVjb2RlZFtrZXldKSB7XG4gICAgICAgICAgICBvdXRba2V5XSA9IHByZXZpb3VzRGVjb2RlZFtrZXldO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZnJlc2hba2V5XSA9IGI2NDtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihvdXQsIGRlY29kZUJhc2U2NEJ1ZmZlcnMoZnJlc2gpKTtcbn1cbiIsICIvLyBUaGUgYW55d2lkZ2V0IGFkYXB0ZXI6IG9uZSBob3N0IG92ZXIgdGhlIHN3aWZ0bWFwIGNvcmUuXHJcbi8vXHJcbi8vIGFueXdpZGdldCdzIG1vZGVsIGFscmVhZHkgSVMgYSBob3N0IC0tIGdldC9zZXQvb24vc2VuZC9zYXZlX2NoYW5nZXMsIHdpdGhcclxuLy8gYGNoYW5nZTo8a2V5PmAgYW5kIGBtc2c6Y3VzdG9tYCBldmVudHMgLS0gc28gbm90aGluZyBpcyB0cmFuc2xhdGVkIGhlcmUuIFRoZVxyXG4vLyBjbGVhbnVwIHJldHVybmVkIHRlYXJzIHRoZSBtYXAgZG93biB3aGVuIGFueXdpZGdldCBkaXNjYXJkcyB0aGUgdmlldy5cclxuaW1wb3J0IHsgY3JlYXRlU3dpZnRNYXAgfSBmcm9tIFwiLi9jb3JlLmpzXCI7XHJcbmltcG9ydCB7IGxvYWRMaWJyYXJpZXMgfSBmcm9tIFwiLi9sb2FkZXIuanNcIjtcclxuXHJcbmV4cG9ydCB7IGNyZWF0ZUhvc3RTdHViIH0gZnJvbSBcIi4vaG9zdC5qc1wiO1xyXG4vLyBUaGUgc3RhdGljIGV4cG9ydCBkZWNvZGVzIGl0cyBiYXNlNjQgYnVmZmVycyB3aXRoIHRoaXMgKHNlZSBzd2lmdG1hcC9leHBvcnQucHkpLlxyXG5leHBvcnQgeyBkZWNvZGVCYXNlNjRCdWZmZXJzIH0gZnJvbSBcIi4vdHJhbnNwb3J0LmpzXCI7XHJcblxyXG5leHBvcnQgZGVmYXVsdCB7XHJcbiAgICBhc3luYyByZW5kZXIoeyBtb2RlbCwgZWwgfSkge1xyXG4gICAgICAgIC8vIFRoaXMgaG9zdCdzIHBhZ2UgaGFzIG5vIGJ1bmRsZXI6IExlYWZsZXQsIGdsaWZ5IGFuZCBHZW9tYW4gY29tZSBmcm9tXHJcbiAgICAgICAgLy8gdGhlIENETiwgZnVsbHkgbG9hZGVkIGJlZm9yZSB0aGUgbWFwIGlzIGNvbnN0cnVjdGVkLlxyXG4gICAgICAgIGNvbnN0IGxlYWZsZXQgPSBhd2FpdCBsb2FkTGlicmFyaWVzKCk7XHJcbiAgICAgICAgY29uc3QgaGFuZGxlID0gYXdhaXQgY3JlYXRlU3dpZnRNYXAoeyBob3N0OiBtb2RlbCwgZWwsIGxlYWZsZXQgfSk7XHJcbiAgICAgICAgcmV0dXJuICgpID0+IGhhbmRsZS5kZXN0cm95KCk7XHJcbiAgICB9LFxyXG59O1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBV08sSUFBSSxJQUFJO0FBRVIsU0FBUyxlQUFlLFNBQVM7QUFDcEMsTUFBSSxDQUFDLFdBQVcsT0FBTyxRQUFRLFFBQVEsWUFBWTtBQUMvQyxVQUFNLElBQUksTUFBTSw0REFBNEQ7QUFBQSxFQUNoRjtBQUNBLE1BQUksQ0FBQyxRQUFRLE9BQU87QUFDaEIsWUFBUSxLQUFLLHNIQUN1RDtBQUFBLEVBQ3hFO0FBQ0EsTUFBSSxDQUFDLFFBQVEsSUFBSTtBQUNiLFlBQVEsS0FBSyxtR0FDZ0M7QUFBQSxFQUNqRDtBQUNBLE1BQUk7QUFDSixTQUFPO0FBQ1g7QUFFTyxTQUFTLGlCQUFpQjtBQUM3QixNQUFJLENBQUMsR0FBRztBQUNKLFVBQU0sSUFBSSxNQUFNLGtKQUVtQjtBQUFBLEVBQ3ZDO0FBQ0EsU0FBTztBQUNYOzs7QUNoQ0EsSUFBTSx1QkFBdUIsb0JBQUksUUFBUTtBQUVsQyxTQUFTLHFCQUFxQixXQUFXO0FBQzVDLE1BQUksUUFBUSxxQkFBcUIsSUFBSSxTQUFTO0FBQzlDLE1BQUksQ0FBQyxPQUFPO0FBQ1IsWUFBUSxDQUFDO0FBQ1QseUJBQXFCLElBQUksV0FBVyxLQUFLO0FBQUEsRUFD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QUFLLE9BQU87QUFDWixZQUFNLEdBQUcsSUFBSTtBQUNiLFdBQUssS0FBSyxLQUFLLENBQUMsS0FBSyxLQUFLLENBQUM7QUFDM0IsT0FBQyxVQUFVLFVBQVUsR0FBRyxFQUFFLEtBQUssQ0FBQyxHQUFHLFFBQVEsUUFBTSxHQUFHLENBQUM7QUFBQSxJQUN6RDtBQUFBLElBQ0EsR0FBRyxPQUFPLElBQUk7QUFDVixPQUFDLFVBQVUsS0FBSyxJQUFJLFVBQVUsS0FBSyxLQUFLLENBQUMsR0FBRyxLQUFLLEVBQUU7QUFBQSxJQUN2RDtBQUFBLElBQ0EsSUFBSSxPQUFPLElBQUk7QUFDWCxnQkFBVSxLQUFLLEtBQUssVUFBVSxLQUFLLEtBQUssQ0FBQyxHQUFHLE9BQU8sT0FBSyxNQUFNLEVBQUU7QUFBQSxJQUNwRTtBQUFBLElBQ0EsS0FBSyxTQUFTLFNBQVM7QUFDbkIsV0FBSyxLQUFLLEtBQUssRUFBRSxTQUFTLFFBQVEsQ0FBQztBQUNuQyxVQUFJLE1BQU0sT0FBUSxPQUFNLE9BQU8sU0FBUyxPQUFPO0FBQUEsSUFDbkQ7QUFBQSxJQUNBLGVBQWU7QUFDWCxXQUFLLFNBQVM7QUFDZCxVQUFJLE1BQU0sT0FBUSxPQUFNLE9BQU87QUFBQSxJQUNuQztBQUFBO0FBQUE7QUFBQSxJQUdBLEtBQUssVUFBVSxNQUFNO0FBQ2pCLE9BQUMsVUFBVSxLQUFLLEtBQUssQ0FBQyxHQUFHLFFBQVEsUUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDO0FBQUEsSUFDdEQ7QUFBQSxFQUNKO0FBQ0EsU0FBTztBQUNYOzs7QUMxRE8sU0FBUyxvQkFBb0IsU0FBUztBQUN6QyxRQUFNLE1BQU0sQ0FBQztBQUNiLGFBQVcsQ0FBQyxLQUFLLEdBQUcsS0FBSyxPQUFPLFFBQVEsV0FBVyxDQUFDLENBQUMsR0FBRztBQUNwRCxVQUFNLE1BQU0sS0FBSyxHQUFHO0FBQ3BCLFVBQU0sUUFBUSxJQUFJLFdBQVcsSUFBSSxNQUFNO0FBQ3ZDLGFBQVMsSUFBSSxHQUFHLElBQUksSUFBSSxRQUFRLElBQUssT0FBTSxDQUFDLElBQUksSUFBSSxXQUFXLENBQUM7QUFDaEUsUUFBSSxHQUFHLElBQUksSUFBSSxTQUFTLE1BQU0sTUFBTTtBQUFBLEVBQ3hDO0FBQ0EsU0FBTztBQUNYOzs7QUNKQSxJQUFPLG9CQUFRO0FBQUEsRUFDWCxNQUFNLE9BQU8sRUFBRSxPQUFPLEdBQUcsR0FBRztBQUd4QixVQUFNLFVBQVUsTUFBTSxjQUFjO0FBQ3BDLFVBQU0sU0FBUyxNQUFNLGVBQWUsRUFBRSxNQUFNLE9BQU8sSUFBSSxRQUFRLENBQUM7QUFDaEUsV0FBTyxNQUFNLE9BQU8sUUFBUTtBQUFBLEVBQ2hDO0FBQ0o7IiwKICAibmFtZXMiOiBbImNvbGxhcHNlZEJ5Q29udGFpbmVyIiwgImNvdW50IiwgImdsTGF5ZXIiLCAiaW5zdGFuY2UiLCAiTCIsICJjb250YWluZXIiLCAiem9vbSJdCn0K
