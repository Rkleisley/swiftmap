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

// src/validate.js
var KNOWN_TYPES = /* @__PURE__ */ new Set([
  "basemap",
  "circle_markers",
  "markers",
  "polyline",
  "polygon",
  "circle",
  "image",
  "group"
]);
function collectLayerProblems(layer, buffers = {}) {
  const problems = [];
  const id = layer.id || "(no id)";
  const type = layer.type;
  if (type && !KNOWN_TYPES.has(type)) {
    problems.push(`layer ${id}: unknown type "${type}" -- it will not render`);
    return problems;
  }
  const view = buffers[layer.id];
  const bytes = view ? view.byteLength : 0;
  if (view && bytes % 16 !== 0) {
    problems.push(`layer ${id}: coordinate buffer is ${bytes} bytes, not a multiple of 16 (float64 [lat, lon] pairs)`);
  }
  const n = Math.floor(bytes / 16);
  const isPoints = type === "circle_markers" || type === "markers";
  if (isPoints && view) {
    const colors = buffers[`${layer.id}::colors`];
    if (colors && colors.byteLength !== 4 * n) {
      problems.push(`layer ${id}: colors buffer holds ${Math.floor(colors.byteLength / 4)} RGBA entries for ${n} points`);
    }
    const radii = buffers[`${layer.id}::radii`];
    if (radii && radii.byteLength !== 4 * n) {
      problems.push(`layer ${id}: radii buffer holds ${Math.floor(radii.byteLength / 4)} float32 entries for ${n} points`);
    }
    const times2 = buffers[`${layer.id}::times`];
    if (times2 && times2.byteLength !== 16 * n) {
      problems.push(`layer ${id}: times buffer holds ${Math.floor(times2.byteLength / 16)} [start, end] pairs for ${n} points`);
    }
    for (const [key, values] of Object.entries(layer.properties || {})) {
      if (Array.isArray(values) && values.length !== n) {
        problems.push(`layer ${id}: property "${key}" has ${values.length} rows for ${n} points -- popups and clicks will desync`);
        break;
      }
    }
  }
  const times = buffers[`${layer.id}::times`];
  if (times && times.byteLength >= 16) {
    const first = times.getFloat64(0, true);
    if (first > 0 && first < 1e11) {
      problems.push(`layer ${id}: times look like epoch SECONDS (first is ${first}); swiftmap times are epoch milliseconds`);
    }
  }
  if (type === "polygon" && Array.isArray(layer.rings) && view) {
    const total = layer.rings.flat().reduce((sum, count) => sum + count, 0);
    if (total * 16 !== bytes) {
      problems.push(`layer ${id}: rings sum to ${total} vertices but the buffer holds ${n}`);
    }
  }
  if (type === "polyline" && Array.isArray(layer.parts) && layer.parts.length > 1 && view) {
    const total = layer.parts.reduce((sum, count) => sum + count, 0);
    if (total * 16 !== bytes) {
      problems.push(`layer ${id}: parts sum to ${total} vertices but the buffer holds ${n}`);
    }
  }
  return problems;
}
var checked = /* @__PURE__ */ new WeakSet();
function warnLayerProblems(layer, buffers) {
  if (!layer || typeof layer !== "object" || checked.has(layer)) return;
  checked.add(layer);
  for (const problem of collectLayerProblems(layer, buffers)) {
    console.warn(`swiftmap: ${problem}`);
  }
  if (Array.isArray(layer.layers)) {
    for (const sub of layer.layers) warnLayerProblems(sub, buffers);
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
  const off = Object.keys(props).find((k) => Array.isArray(props[k]) && props[k].length !== base);
  if (off !== void 0) {
    console.warn(`swiftmap: append to ${layer.id}: base ${base} does not match property "${off}"'s ${props[off].length} rows -- rows will desync`);
  }
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
function formatBound(value) {
  const n = Number(value);
  if (value == null || value === "" || !isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)));
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
  ends.appendChild(div({}, formatBound(entry.vmin)));
  ends.appendChild(div({}, formatBound(entry.vmax)));
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
  const range = entry.vmin != null && entry.vmax != null ? ` (${formatBound(entry.vmin)} \u2013 ${formatBound(entry.vmax)})` : "";
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
    for (const layer of layers) warnLayerProblems(layer, coordinateBuffers);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL2xpYnMuanMiLCAiLi4vLi4vc3JjL3ZhbGlkYXRlLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9wYXRjaC5qcyIsICIuLi8uLi9zcmMvbGVnZW5kLmpzIiwgIi4uLy4uL3NyYy91dGlscy5qcyIsICIuLi8uLi9zcmMvc2hhZGVycy5qcyIsICIuLi8uLi9zcmMvdGltZWNvbnRyb2wuanMiLCAiLi4vLi4vc3JjL2dwdXRpbWUuanMiLCAiLi4vLi4vc3JjL2xheWVycy5qcyIsICIuLi8uLi9zcmMvbGFiZWxzLmpzIiwgIi4uLy4uL3NyYy9jb3JlLmpzIiwgIi4uLy4uL3NyYy9sb2FkZXIuanMiLCAiLi4vLi4vc3JjL2hvc3QuanMiLCAiLi4vLi4vc3JjL3RyYW5zcG9ydC5qcyIsICIuLi8uLi9zcmMvYW55d2lkZ2V0LmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBUaGUgbGlicmFyaWVzIHRoZSBjb3JlIHJlbmRlcnMgd2l0aCwgUFJPVklERUQgYnkgdGhlIGhvc3QgYmVmb3JlIHRoZSBtYXAgaXNcclxuLy8gY29uc3RydWN0ZWQgLS0gbmV2ZXIgcmVhY2hlZCBmb3IgYXMgZ2xvYmFscy4gYExgIGlzIGEgbGl2ZSBiaW5kaW5nOiBldmVyeVxyXG4vLyBtb2R1bGUgaW1wb3J0cyBpdCBmcm9tIGhlcmUgYW5kIHNlZXMgd2hhdGV2ZXIgcHJvdmlkZUxlYWZsZXQgc2V0LlxyXG4vL1xyXG4vLyBUd28ga2luZHMgb2YgaG9zdC4gVGhlIHdpZGdldCBhbmQgYSBzdGF0aWMgZXhwb3J0IGZldGNoIExlYWZsZXQsIGdsaWZ5IGFuZFxyXG4vLyBHZW9tYW4gYXQgcnVudGltZSAoc3JjL2xvYWRlci5qcyksIGJlY2F1c2UgdGhlaXIgcGFnZSBoYXMgbm8gYnVuZGxlcjsgYW4gbnBtXHJcbi8vIGNvbnN1bWVyIGltcG9ydHMgdGhlbSBhcyByZWFsIGRlcGVuZGVuY2llcyBhbmQgcGFzc2VzIHRoZSByZXN1bHQgaW4uIEVpdGhlclxyXG4vLyB3YXkgdGhlIE9SREVSIGlzIGZpeGVkIGJ5IGNvbnN0cnVjdGlvbjogR2VvbWFuIGF0dGFjaGVzIG1hcC5wbSB0aHJvdWdoIGFcclxuLy8gTGVhZmxldCBpbml0IGhvb2sgdGhhdCBvbmx5IHJ1bnMgZm9yIG1hcHMgY3JlYXRlZCBhZnRlciB0aGUgcGx1Z2luIGV4aXN0c1xyXG4vLyAoNTM5NGQxZSksIHNvIHByb3ZpZGluZyBtdXN0IGZpbmlzaCBiZWZvcmUgY3JlYXRlU3dpZnRNYXAgYnVpbGRzIHRoZSBtYXAgLS1cclxuLy8gd2hpY2ggaXMgd2h5IHRoZSBjb3JlIHRha2VzIExlYWZsZXQgYXMgYW4gYXJndW1lbnQgYW5kIG5ldmVyIGxvYWRzIGl0IGxhemlseS5cclxuZXhwb3J0IGxldCBMID0gbnVsbDtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwcm92aWRlTGVhZmxldChsZWFmbGV0KSB7XHJcbiAgICBpZiAoIWxlYWZsZXQgfHwgdHlwZW9mIGxlYWZsZXQubWFwICE9PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzd2lmdG1hcDogcHJvdmlkZUxlYWZsZXQgZXhwZWN0cyB0aGUgTGVhZmxldCBuYW1lc3BhY2UgKEwpXCIpO1xyXG4gICAgfVxyXG4gICAgaWYgKCFsZWFmbGV0LmdsaWZ5KSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKFwiW1N3aWZ0TWFwXSBwcm92aWRlTGVhZmxldDogTC5nbGlmeSBpcyBtaXNzaW5nIC0tIGltcG9ydCBcIlxyXG4gICAgICAgICAgICArIFwibGVhZmxldC5nbGlmeSBiZWZvcmUgcHJvdmlkaW5nLCBvciBubyBXZWJHTCBsYXllciB3aWxsIGRyYXcuXCIpO1xyXG4gICAgfVxyXG4gICAgaWYgKCFsZWFmbGV0LlBNKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKFwiW1N3aWZ0TWFwXSBwcm92aWRlTGVhZmxldDogTGVhZmxldC1HZW9tYW4gaXMgbWlzc2luZyAtLSB0aGUgXCJcclxuICAgICAgICAgICAgKyBcImRyYXcvQU9JIHRvb2xiYXIgd2lsbCBiZSB1bmF2YWlsYWJsZS5cIik7XHJcbiAgICB9XHJcbiAgICBMID0gbGVhZmxldDtcclxuICAgIHJldHVybiBMO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVxdWlyZUxlYWZsZXQoKSB7XHJcbiAgICBpZiAoIUwpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzd2lmdG1hcDogbm8gTGVhZmxldCBwcm92aWRlZC4gUGFzcyBgbGVhZmxldGAgdG8gXCJcclxuICAgICAgICAgICAgKyBcImNyZWF0ZVN3aWZ0TWFwLCBjYWxsIHByb3ZpZGVMZWFmbGV0KEwpLCBvciB1c2UgbG9hZExpYnJhcmllcygpIG9uIGEgXCJcclxuICAgICAgICAgICAgKyBcInBhZ2UgdGhhdCBsb2FkcyBmcm9tIGEgQ0ROLlwiKTtcclxuICAgIH1cclxuICAgIHJldHVybiBMO1xyXG59XHJcbiIsICIvLyBBdXRob3JpbmcgZ3VhcmRyYWlscyBmb3IgaGFuZC1idWlsdCBjb25maWdzIGFuZCBidWZmZXJzLlxuLy9cbi8vIFB5dGhvbiB3YXJucyBhdCBhZGQgdGltZSAtLSA4MCB3YXJuKCkgc2l0ZXMgYWNyb3NzIGxheWVycy8sIG1hcG9wcy8gYW5kXG4vLyBwYXJzZXJzLyAtLSBidXQgYSBKUyBhcHAgaGFuZHMgdGhlIGNvcmUgZmluaXNoZWQgY29uZmlncyBhbmQgcGFja2VkIGJ1ZmZlcnMsXG4vLyBhbmQgdW50aWwgbm93IGEgbWFsZm9ybWVkIGxheWVyLCBhIHdyb25nLWxlbmd0aCBidWZmZXIgb3IgYW4gdW5rbm93biB0eXBlIGFsbFxuLy8gcHJvZHVjZWQgdGhlIHNhbWUgcmVzdWx0OiBzaWxlbmNlLCBhbmQgYSBtYXAgdGhhdCBpcyBibGFuayBvciBzdWJ0bHkgd3Jvbmdcbi8vICh0aGUgUmVhY3QgcG9ydCdzIGdhcCByZXBvcnQsIGl0ZW0gMikuIFRoZXNlIGNoZWNrcyBhcmUgTyhsYXllcnMpIGFyaXRobWV0aWNcbi8vIG9uIGJ5dGUgbGVuZ3RocywgcnVuIG9uY2UgcGVyIGNvbmZpZyBvYmplY3QsIGFuZCBwcmludCB0aHJvdWdoIGNvbnNvbGUud2FybiAtLVxuLy8gdGhleSBuZXZlciB0aHJvdyBhbmQgbmV2ZXIgY2hhbmdlIHdoYXQgcmVuZGVycy5cbmNvbnN0IEtOT1dOX1RZUEVTID0gbmV3IFNldChbXG4gICAgXCJiYXNlbWFwXCIsIFwiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCIsIFwiY2lyY2xlXCIsXG4gICAgXCJpbWFnZVwiLCBcImdyb3VwXCIsXG5dKTtcblxuLy8gVGhlIHByb2JsZW1zIHdpdGggb25lIGxheWVyLCBhcyBzZW50ZW5jZXMuIEV4cG9ydGVkIGJhcmUgZm9yIHRlc3RzIGFuZCBmb3Jcbi8vIGFwcHMgdGhhdCB3YW50IHRvIGxpbnQgY29uZmlncyBiZWZvcmUgaGFuZGluZyB0aGVtIG92ZXIuXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdExheWVyUHJvYmxlbXMobGF5ZXIsIGJ1ZmZlcnMgPSB7fSkge1xuICAgIGNvbnN0IHByb2JsZW1zID0gW107XG4gICAgY29uc3QgaWQgPSBsYXllci5pZCB8fCBcIihubyBpZClcIjtcbiAgICBjb25zdCB0eXBlID0gbGF5ZXIudHlwZTtcbiAgICBpZiAodHlwZSAmJiAhS05PV05fVFlQRVMuaGFzKHR5cGUpKSB7XG4gICAgICAgIHByb2JsZW1zLnB1c2goYGxheWVyICR7aWR9OiB1bmtub3duIHR5cGUgXCIke3R5cGV9XCIgLS0gaXQgd2lsbCBub3QgcmVuZGVyYCk7XG4gICAgICAgIHJldHVybiBwcm9ibGVtcztcbiAgICB9XG4gICAgY29uc3QgdmlldyA9IGJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgIGNvbnN0IGJ5dGVzID0gdmlldyA/IHZpZXcuYnl0ZUxlbmd0aCA6IDA7XG4gICAgaWYgKHZpZXcgJiYgYnl0ZXMgJSAxNiAhPT0gMCkge1xuICAgICAgICBwcm9ibGVtcy5wdXNoKGBsYXllciAke2lkfTogY29vcmRpbmF0ZSBidWZmZXIgaXMgJHtieXRlc30gYnl0ZXMsIGBcbiAgICAgICAgICAgICsgYG5vdCBhIG11bHRpcGxlIG9mIDE2IChmbG9hdDY0IFtsYXQsIGxvbl0gcGFpcnMpYCk7XG4gICAgfVxuICAgIGNvbnN0IG4gPSBNYXRoLmZsb29yKGJ5dGVzIC8gMTYpO1xuXG4gICAgY29uc3QgaXNQb2ludHMgPSB0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCI7XG4gICAgaWYgKGlzUG9pbnRzICYmIHZpZXcpIHtcbiAgICAgICAgY29uc3QgY29sb3JzID0gYnVmZmVyc1tgJHtsYXllci5pZH06OmNvbG9yc2BdO1xuICAgICAgICBpZiAoY29sb3JzICYmIGNvbG9ycy5ieXRlTGVuZ3RoICE9PSA0ICogbikge1xuICAgICAgICAgICAgcHJvYmxlbXMucHVzaChgbGF5ZXIgJHtpZH06IGNvbG9ycyBidWZmZXIgaG9sZHMgYFxuICAgICAgICAgICAgICAgICsgYCR7TWF0aC5mbG9vcihjb2xvcnMuYnl0ZUxlbmd0aCAvIDQpfSBSR0JBIGVudHJpZXMgZm9yICR7bn0gcG9pbnRzYCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmFkaWkgPSBidWZmZXJzW2Ake2xheWVyLmlkfTo6cmFkaWlgXTtcbiAgICAgICAgaWYgKHJhZGlpICYmIHJhZGlpLmJ5dGVMZW5ndGggIT09IDQgKiBuKSB7XG4gICAgICAgICAgICBwcm9ibGVtcy5wdXNoKGBsYXllciAke2lkfTogcmFkaWkgYnVmZmVyIGhvbGRzIGBcbiAgICAgICAgICAgICAgICArIGAke01hdGguZmxvb3IocmFkaWkuYnl0ZUxlbmd0aCAvIDQpfSBmbG9hdDMyIGVudHJpZXMgZm9yICR7bn0gcG9pbnRzYCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdGltZXMgPSBidWZmZXJzW2Ake2xheWVyLmlkfTo6dGltZXNgXTtcbiAgICAgICAgaWYgKHRpbWVzICYmIHRpbWVzLmJ5dGVMZW5ndGggIT09IDE2ICogbikge1xuICAgICAgICAgICAgcHJvYmxlbXMucHVzaChgbGF5ZXIgJHtpZH06IHRpbWVzIGJ1ZmZlciBob2xkcyBgXG4gICAgICAgICAgICAgICAgKyBgJHtNYXRoLmZsb29yKHRpbWVzLmJ5dGVMZW5ndGggLyAxNil9IFtzdGFydCwgZW5kXSBwYWlycyBmb3IgJHtufSBwb2ludHNgKTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlc10gb2YgT2JqZWN0LmVudHJpZXMobGF5ZXIucHJvcGVydGllcyB8fCB7fSkpIHtcbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlcykgJiYgdmFsdWVzLmxlbmd0aCAhPT0gbikge1xuICAgICAgICAgICAgICAgIHByb2JsZW1zLnB1c2goYGxheWVyICR7aWR9OiBwcm9wZXJ0eSBcIiR7a2V5fVwiIGhhcyAke3ZhbHVlcy5sZW5ndGh9IGBcbiAgICAgICAgICAgICAgICAgICAgKyBgcm93cyBmb3IgJHtufSBwb2ludHMgLS0gcG9wdXBzIGFuZCBjbGlja3Mgd2lsbCBkZXN5bmNgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHRpbWVzID0gYnVmZmVyc1tgJHtsYXllci5pZH06OnRpbWVzYF07XG4gICAgaWYgKHRpbWVzICYmIHRpbWVzLmJ5dGVMZW5ndGggPj0gMTYpIHtcbiAgICAgICAgY29uc3QgZmlyc3QgPSB0aW1lcy5nZXRGbG9hdDY0KDAsIHRydWUpO1xuICAgICAgICBpZiAoZmlyc3QgPiAwICYmIGZpcnN0IDwgMWUxMSkge1xuICAgICAgICAgICAgcHJvYmxlbXMucHVzaChgbGF5ZXIgJHtpZH06IHRpbWVzIGxvb2sgbGlrZSBlcG9jaCBTRUNPTkRTIChmaXJzdCBpcyBgXG4gICAgICAgICAgICAgICAgKyBgJHtmaXJzdH0pOyBzd2lmdG1hcCB0aW1lcyBhcmUgZXBvY2ggbWlsbGlzZWNvbmRzYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5Z29uXCIgJiYgQXJyYXkuaXNBcnJheShsYXllci5yaW5ncykgJiYgdmlldykge1xuICAgICAgICBjb25zdCB0b3RhbCA9IGxheWVyLnJpbmdzLmZsYXQoKS5yZWR1Y2UoKHN1bSwgY291bnQpID0+IHN1bSArIGNvdW50LCAwKTtcbiAgICAgICAgaWYgKHRvdGFsICogMTYgIT09IGJ5dGVzKSB7XG4gICAgICAgICAgICBwcm9ibGVtcy5wdXNoKGBsYXllciAke2lkfTogcmluZ3Mgc3VtIHRvICR7dG90YWx9IHZlcnRpY2VzIGBcbiAgICAgICAgICAgICAgICArIGBidXQgdGhlIGJ1ZmZlciBob2xkcyAke259YCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIiAmJiBBcnJheS5pc0FycmF5KGxheWVyLnBhcnRzKSAmJiBsYXllci5wYXJ0cy5sZW5ndGggPiAxICYmIHZpZXcpIHtcbiAgICAgICAgY29uc3QgdG90YWwgPSBsYXllci5wYXJ0cy5yZWR1Y2UoKHN1bSwgY291bnQpID0+IHN1bSArIGNvdW50LCAwKTtcbiAgICAgICAgaWYgKHRvdGFsICogMTYgIT09IGJ5dGVzKSB7XG4gICAgICAgICAgICBwcm9ibGVtcy5wdXNoKGBsYXllciAke2lkfTogcGFydHMgc3VtIHRvICR7dG90YWx9IHZlcnRpY2VzIGBcbiAgICAgICAgICAgICAgICArIGBidXQgdGhlIGJ1ZmZlciBob2xkcyAke259YCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHByb2JsZW1zO1xufVxuXG4vLyBPbmNlIHBlciBjb25maWcgT0JKRUNUOiBwYXRjaGVzIGFuZCB0b2dnbGVzIHJlcGxhY2UgY29uZmlncywgc28gYSBjaGFuZ2VkXG4vLyBsYXllciBpcyBhIG5ldyBvYmplY3QgYW5kIGdldHMgcmUtY2hlY2tlZDsgYW4gdW5jaGFuZ2VkIG9uZSBjb3N0cyBhIHNldCBsb29rdXAuXG5jb25zdCBjaGVja2VkID0gbmV3IFdlYWtTZXQoKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHdhcm5MYXllclByb2JsZW1zKGxheWVyLCBidWZmZXJzKSB7XG4gICAgaWYgKCFsYXllciB8fCB0eXBlb2YgbGF5ZXIgIT09IFwib2JqZWN0XCIgfHwgY2hlY2tlZC5oYXMobGF5ZXIpKSByZXR1cm47XG4gICAgY2hlY2tlZC5hZGQobGF5ZXIpO1xuICAgIGZvciAoY29uc3QgcHJvYmxlbSBvZiBjb2xsZWN0TGF5ZXJQcm9ibGVtcyhsYXllciwgYnVmZmVycykpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBzd2lmdG1hcDogJHtwcm9ibGVtfWApO1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShsYXllci5sYXllcnMpKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykgd2FybkxheWVyUHJvYmxlbXMoc3ViLCBidWZmZXJzKTtcbiAgICB9XG59XG4iLCAiLy8gRm9sZGVyIGNvbGxhcHNlIHN0YXRlLCBQRVIgU0lERUJBUi4gSXQgdXNlZCB0byBiZSBvbmUgbW9kdWxlLWxldmVsIG9iamVjdCwgc29cclxuLy8gdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmVkIGl0IC0tIGNvbGxhcHNpbmcgYSBmb2xkZXIgaW4gb25lIGNvbGxhcHNlZCBpdCBpblxyXG4vLyB0aGUgb3RoZXIuIEtleWVkIGJ5IHRoZSBjb250YWluZXIgZWxlbWVudCwgZXhhY3RseSBhcyB0aGUgbGVnZW5kIGtlZXBzIGl0cyBvd25cclxuLy8gY29sbGFwc2Ugc3RhdGUgKDNiOWM5NmMpLCBhbmQgc3Vydml2aW5nIHRoZSBmdWxsIHJlLXJlbmRlciBldmVyeSBzeW5jIHBlcmZvcm1zLlxyXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2lkZWJhckNvbGxhcHNlU3RhdGUoY29udGFpbmVyKSB7XHJcbiAgICBsZXQgc3RhdGUgPSBjb2xsYXBzZWRCeUNvbnRhaW5lci5nZXQoY29udGFpbmVyKTtcclxuICAgIGlmICghc3RhdGUpIHtcclxuICAgICAgICBzdGF0ZSA9IHt9O1xyXG4gICAgICAgIGNvbGxhcHNlZEJ5Q29udGFpbmVyLnNldChjb250YWluZXIsIHN0YXRlKTtcclxuICAgIH1cclxuICAgIHJldHVybiBzdGF0ZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldExheWVyQm91bmRzKGwsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICBpZiAoIWwpIHJldHVybiBudWxsO1xyXG5cclxuICAgIC8vIFN1cHBvcnQgZm9sZGVyIHRyZWUgbm9kZXMgKGdyb3VwcyBpbiBzaWRlYmFyIHRyZWUpXHJcbiAgICBpZiAobC5pc0dyb3VwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGRyZW4gZ3JvdXBzXHJcbiAgICAgICAgT2JqZWN0LmtleXMobC5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobC5jaGlsZHJlbltrZXldLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkIGxheWVyc1xyXG4gICAgICAgIGwubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGx5ciwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobC5ib3VuZHMgJiYgbC5ib3VuZHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHJldHVybiBsLmJvdW5kcztcclxuICAgIH1cclxuICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsLmxheWVycykge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhzdWIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGwubG9jYXRpb25zICYmIGwubG9jYXRpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBjb25zdCBjb29yZHMgPSBsLmxvY2F0aW9ucy5mbGF0KEluZmluaXR5KTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBjb25zdCBsYXQgPSBjb29yZHNbaV07XHJcbiAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICsgMV07XHJcbiAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobG9uIDwgbWluTG9uKSBtaW5Mb24gPSBsb247XHJcbiAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgICAgICBjb25zdCBidWYgPSBjb29yZGluYXRlQnVmZmVyc1tsLmlkXTtcclxuICAgICAgICBpZiAoYnVmKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoYnVmLmJ1ZmZlciwgYnVmLmJ5dGVPZmZzZXQsIGJ1Zi5ieXRlTGVuZ3RoIC8gOCk7XHJcbiAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoIC8gMjsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsYXQgPSBjb29yZHNbaSAqIDJdO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKiAyICsgMV07XHJcbiAgICAgICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICBpZiAobG9uIDwgbWluTG9uKSBtaW5Mb24gPSBsb247XHJcbiAgICAgICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gVGhlIHdyaXRlIGhhbGYgb2YgYSB2aXNpYmlsaXR5IHRvZ2dsZTogb25lIGN1c3RvbSBtZXNzYWdlIG5hbWluZyB0aGUgZmxpcHBlZCBpZHMsXHJcbi8vIGluc3RlYWQgb2YgdGhlIHdob2xlIGxheWVycyB0cmFpdC4gUHl0aG9uIGFwcGxpZXMgdGhlIGZpZWxkcyBhbmQgcmUtZW1pdHMgdGhlbSBhc1xyXG4vLyBgc2V0YCBwYXRjaCBvcHMsIHdoaWNoIGlzIGhvdyBvdGhlciB2aWV3cyBvZiB0aGUgc2FtZSBtYXAgKG5vdGVib29rIG91dHB1dHMpIHN0YXlcclxuLy8gaW4gc3RlcCBub3cgdGhhdCB0aGUgdHJhaXQgbm8gbG9uZ2VyIGNhcnJpZXMgdG9nZ2xlcy5cclxuLy8gYGNvbGxhcHNlZFBhdGhzYCBpcyB0aGUgY2FsbGluZyBzaWRlYmFyJ3Mgb3duIHN0YXRlIChzaWRlYmFyQ29sbGFwc2VTdGF0ZSksIHNvXHJcbi8vIGEgcmFkaW8gZ3JvdXAncyBhdXRvLWNvbGxhcHNlIGxhbmRzIG9uIHRoYXQgc2lkZWJhciBhbG9uZS5cclxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzLCBjb2xsYXBzZWRQYXRocyA9IHt9KSB7XHJcbiAgICBjb25zdCB0cmVlID0geyBuYW1lOiBcIlJvb3RcIiwgcGF0aDogXCJcIiwgY2hpbGRyZW46IHt9LCBsYXllcnM6IFtdLCBpc0dyb3VwOiB0cnVlIH07XHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcbiAgICBsYXllcnMuZm9yRWFjaChsID0+IHtcclxuICAgICAgICBjb25zdCBwYXRoU3RyID0gbC5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiO1xyXG4gICAgICAgIGNvbnN0IHBhcnRzID0gcGF0aFN0ci5zcGxpdChcIi9cIik7XHJcbiAgICAgICAgbGV0IGN1cnIgPSB0cmVlO1xyXG4gICAgICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XHJcbiAgICAgICAgcGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcclxuICAgICAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XHJcbiAgICAgICAgICAgIGlmICghY3Vyci5jaGlsZHJlbltwYXJ0XSkge1xyXG4gICAgICAgICAgICAgICAgY3Vyci5jaGlsZHJlbltwYXJ0XSA9IHtcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LFxyXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHJ1bm5pbmdQYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiB7fSxcclxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IFtdLFxyXG4gICAgICAgICAgICAgICAgICAgIGlzR3JvdXA6IHRydWVcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY3VyciA9IGN1cnIuY2hpbGRyZW5bcGFydF07XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY3Vyci5sYXllcnMucHVzaChsKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJlcG9ydHMgd2hhdCBpdCBjaGFuZ2VkIC0tIHtjaGFuZ2VzOiBbe2lkLCB2aXNpYmxlfV0sIGdyb3Vwc0NoYW5nZWR9IC0tIHNvIHRoZVxyXG4gICAgLy8gY2FsbGVyIGNhbiB3cml0ZSBiYWNrIGV4YWN0bHkgdGhvc2UgZmxpcHMgcmF0aGVyIHRoYW4gdGhlIHdob2xlIGxheWVycyBsaXN0LlxyXG4gICAgY29uc3QgY2hhbmdlcyA9IFtdO1xyXG4gICAgbGV0IGdyb3Vwc0NoYW5nZWQgPSBmYWxzZTtcclxuICAgIGZ1bmN0aW9uIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZSkge1xyXG4gICAgICAgIGNvbnN0IGNvbmYgPSBncm91cENvbmZpZ3Nbbm9kZS5wYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzUmFkaW9Hcm91cCA9IGNvbmYubXVsdGlfc2VsZWN0ID09PSBmYWxzZTtcclxuICAgICAgICBpZiAoaXNSYWRpb0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxldCBmb3VuZEFjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjaGlsZEdyb3VwID0gbm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdID0geyB2aXNpYmxlOiB0cnVlLCBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZEFjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cHNDaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZEFjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW2NoaWxkR3JvdXAucGF0aF0gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbm9kZS5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gbHlyLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3VuZEFjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBseXIudmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VzLnB1c2goeyBpZDogbHlyLmlkLCB2aXNpYmxlOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZEFjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUuY2hpbGRyZW5ba2V5XSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKHRyZWUpO1xyXG4gICAgcmV0dXJuIHsgY2hhbmdlcywgZ3JvdXBzQ2hhbmdlZCB9O1xyXG59XHJcblxyXG4vLyBgY3R4YCBpcyB3aGF0IHRoZSBzaWRlYmFyIG5lZWRzIGZyb20gaXRzIGhvc3QsIGhhbmRlZCBpbiByYXRoZXIgdGhhbiByZWFjaGVkIGZvcjpcclxuLy8gICBncm91cENvbmZpZ3MgICAgICAgICAgIHRoZSBmb2xkZXIgZmxhZ3MgKG11dGF0ZWQgaW4gcGxhY2UgYXMgdGhlIHRyZWUgdG9nZ2xlcylcclxuLy8gICBjb29yZGluYXRlQnVmZmVycyAgICAgIHRoZSBsaXZlIGJ1ZmZlciBtYXAsIGZvciBmaXR0aW5nIGEgdG9nZ2xlZCBub2RlXHJcbi8vICAgb25MYXllcldyaXRlKGNoYW5nZXMpICB0YXJnZXRlZCB2aXNpYmlsaXR5IGZsaXBzIHRvIHNlbmQgb25cclxuLy8gICBvbkdyb3VwQ29uZmlnc0NoYW5nZShncm91cENvbmZpZ3MpICB0aGUgZm9sZGVyIGZsYWdzIHRvIGNvbW1pdFxyXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgY3R4LCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG5cclxuICAgIGNvbnN0IGNvbGxhcHNlZFBhdGhzID0gc2lkZWJhckNvbGxhcHNlU3RhdGUoc2lkZWJhcik7XHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSAoY3R4ICYmIGN0eC5ncm91cENvbmZpZ3MpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZsaXBwZWQgb24gdGhlIGxpc3QgdGhpcyBzaWRlYmFyIHJlbmRlcmVkIGZyb20sIG5ldmVyIG1vZGVsLmdldChcImxheWVyc1wiKS5cclxuICAgICAgICAgICAgICAgIC8vIExheWVycyBhZGRlZCBhZnRlciB0aGUgd2lkZ2V0IGlzIGRpc3BsYXllZCBhcnJpdmUgYXMgcGF0Y2hlcyB0aGF0IHVwZGF0ZSB0aGVcclxuICAgICAgICAgICAgICAgIC8vIGZyb250ZW5kJ3MgbG9jYWwgc3RhdGUgd2l0aG91dCB0b3VjaGluZyB0aGUgdHJhaXQsIHNvIHRoZSBtb2RlbCdzIGNvcHkgaXNcclxuICAgICAgICAgICAgICAgIC8vIGZyb3plbiBhdCB3aGF0ZXZlciB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGNhcnJpZWQuIEJ1aWxkaW5nIHRoZSB1cGRhdGUgZnJvbVxyXG4gICAgICAgICAgICAgICAgLy8gaXQgZHJvcHMgZXZlcnkgbGF0ZXIgbGF5ZXI6IHRoZSB0b2dnbGUgbWF0Y2hlcyBubyBpZCwgd3JpdGVzIHRoZSBzdGFsZSBsaXN0XHJcbiAgICAgICAgICAgICAgICAvLyBiYWNrLCBhbmQgdGhlIGNoYW5nZSBoYW5kbGVyIHRoZW4gcmVzZXRzIGxvY2FsIHN0YXRlIHRvIGl0IC0tIHNvIHRoZSBib3hcclxuICAgICAgICAgICAgICAgIC8vIHJlLWNoZWNrcyBpdHNlbGYgYW5kIHRoZSBsYXllciBuZXZlciBoaWRlcy5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgZmxpcHMgbXV0YXRlIHRoZSByZW5kZXJlZCBsaXN0IGluIHBsYWNlIGFuZCByZWFjaCBQeXRob24gYXMgYSB0YXJnZXRlZFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUgKHNlbmRMYXllcldyaXRlKSwgbmV2ZXIgYnkgc2V0dGluZyB0aGUgbGF5ZXJzIHRyYWl0OiB0aGUgZnVsbFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUtYmFjayBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlIGNsaWNrLiBBdCAyNSB0cmFja3MgeCAyMDBrXHJcbiAgICAgICAgICAgICAgICAvLyB2ZXJ0aWNlcyBpdCB3YXMgYSAzNiBNQiBmcmFtZSAtLSBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0IHdlYnNvY2tldFxyXG4gICAgICAgICAgICAgICAgLy8gY2FwLCBzbyB0aGUgc2VydmVyIGNsb3NlZCB0aGUgY29ubmVjdGlvbiBhbmQgdGhlIFNoaW55IHNlc3Npb24gZGllZCBvblxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGNoZWNrYm94LiBTZXR0aW5nIHRoZSB0cmFpdCB3aXRob3V0IHNhdmluZyBpcyBqdXN0IGFzIGZhdGFsOlxyXG4gICAgICAgICAgICAgICAgLy8gaXQgc3RheXMgZGlydHkgYW5kIHRoZSBuZXh0IHNhdmVfY2hhbmdlcyAoYW55IHBhbikgZmx1c2hlcyBpdC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZsaXAgPSAobHlyLCB2aXNpYmxlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKChseXIudmlzaWJsZSAhPT0gZmFsc2UpID09PSB2aXNpYmxlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSB2aXNpYmxlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGUgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGlvIGJ1dHRvbiBsb2dpYzogc2V0IGFsbCBzaWJsaW5ncyB0byB2aXNpYmxlPWZhbHNlLCBhbmQgdGhpcyB0byB2aXNpYmxlPXRydWVcclxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYkdyb3VwID0gcGFyZW50Tm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBzaWJHcm91cC5wYXRoID09PSBwYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbc2liR3JvdXAucGF0aF0gPSAhYWN0aXZlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IGZsaXAoc2liTHlyLCBzaWJMeXIuaWQgPT09IGlkKSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3BhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBseXIgPSBsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGx5cikgZmxpcChseXIsIGlzQ2hlY2tlZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChjdHggJiYgY3R4Lm9uTGF5ZXJXcml0ZSkgY3R4Lm9uTGF5ZXJXcml0ZShjaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIGlmIChjdHggJiYgY3R4Lm9uR3JvdXBDb25maWdzQ2hhbmdlKSBjdHgub25Hcm91cENvbmZpZ3NDaGFuZ2UoZ3JvdXBDb25maWdzKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldExheWVyQm91bmRzKG5vZGUsIChjdHggJiYgY3R4LmNvb3JkaW5hdGVCdWZmZXJzKSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb25MYXllclRvZ2dsZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcmVudEVsLmFwcGVuZENoaWxkKG5vZGVEaXYpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbmRlciB0cmVlIGZyb20gcm9vdCBub2RlXHJcbiAgICByZW5kZXJOb2RlKHRyZWUsIHNpZGViYXIsIDAsIG51bGwsIHRydWUpO1xyXG59XHJcbiIsICIvLyBMYXllci1zdGF0ZSBmdW5jdGlvbnM6IHZpc2liaWxpdHksIGJ1Y2tldGluZywgYW5kIHBhdGNoIGFwcGxpY2F0aW9uLlxyXG4vL1xyXG4vLyBQdXJlIGRhdGEgaW4sIGRhdGEgb3V0IC0tIG5vIG1hcCwgbm8gRE9NLCBubyBob3N0LiBUaGlzIGlzIHRoZSBwYXJ0IG9mIHRoZSBjb3JlXHJcbi8vIHRoYXQgZXZlcnkgY29uc3VtZXIgc2hhcmVzIHZlcmJhdGltOiB0aGUgYW55d2lkZ2V0IHdpZGdldCwgYSBzdGF0aWMgZXhwb3J0IGFuZCBhXHJcbi8vIFJlYWN0IGFwcCBhbGwgYXBwbHkgdGhlIHNhbWUgcGF0Y2ggb3BzIHRvIHRoZSBzYW1lIHtsYXllcnMsIGJ1ZmZlcnN9IHN0YXRlLlxyXG5cclxuLy8gVHJ1ZSBpZiBhIGxheWVyIGlzIHZpc2libGUgYW5kIG5vIGZvbGRlciBhYm92ZSBpdCBpcyBzd2l0Y2hlZCBvZmYuXHJcbi8vXHJcbi8vIFZpc2liaWxpdHkgaXMgaW5oZXJpdGVkIGRvd24gdGhlIGZvbGRlciBwYXRoOiBhIGxheWVyIGluc2lkZSBcIkZlZWRzL0FjdGl2ZVwiIGlzIGhpZGRlblxyXG4vLyB3aGVuIGVpdGhlciBcIkZlZWRzXCIgb3IgXCJGZWVkcy9BY3RpdmVcIiBpcyBvZmYsIHJlZ2FyZGxlc3Mgb2YgaXRzIG93biBmbGFnLiBHZXR0aW5nIHRoaXNcclxuLy8gd3Jvbmcgc2hvd3MgdXAgYXMgXCJ0aGF0IGxheWVyIGp1c3Qgd2lsbCBub3QgYXBwZWFyXCIsIHdpdGggbm90aGluZyBsb2dnZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSB7XHJcbiAgICBpZiAobGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcclxuICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XHJcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLnNwbGl0KFwiL1wiKSkge1xyXG4gICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGdyb3VwQ29uZmlnc1tydW5uaW5nUGF0aF07XHJcbiAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBTb3J0cyB0aGUgdmlzaWJsZSBsYXllcnMgaW50byBvbmUgYnVja2V0IHBlciBXZWJHTCBkcmF3IHBhc3MuXHJcbi8vXHJcbi8vIFN1Yi1sYXllcnMgb2YgYSBtZXJnZWQgZ3JvdXAgaW5oZXJpdCB0aGVpciBwYXJlbnQncyB2aXNpYmlsaXR5IHJhdGhlciB0aGFuIGNhcnJ5aW5nXHJcbi8vIHRoZWlyIG93biwgc28gYSBncm91cCB0b2dnbGVkIG9mZiBjb250cmlidXRlcyBub3RoaW5nIGV2ZW4gd2hlbiBpdHMgY2hpbGRyZW4gc2F5XHJcbi8vIHZpc2libGUuIENpcmNsZXMgam9pbiB0aGUgcG9seWdvbiBidWNrZXQ6IHRoZXkgYXJlIGRyYXduIGFzIGdlbmVyYXRlZCByaW5ncy5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgYnVja2V0cyA9IHsgY2lyY2xlX21hcmtlcnM6IFtdLCBtYXJrZXJzOiBbXSwgcG9seWxpbmU6IFtdLCBwb2x5Z29uOiBbXSB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIGNvbGxlY3QobGF5ZXIsIHBhcmVudFZpc2libGUsIGlzU3ViTGF5ZXIpIHtcclxuICAgICAgICBpZiAoIXBhcmVudFZpc2libGUpIHJldHVybjtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xyXG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gY29sbGVjdChzdWIsIHBhcmVudFZpc2libGUsIHRydWUpKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWlzU3ViTGF5ZXIgJiYgbGF5ZXIudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybjtcclxuXHJcbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcclxuICAgICAgICBpZiAoYnVja2V0c1tidWNrZXRdKSBidWNrZXRzW2J1Y2tldF0ucHVzaChsYXllcik7XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcclxuICAgICAgICBjb2xsZWN0KGxheWVyLCBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSwgZmFsc2UpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGJ1Y2tldHM7XHJcbn1cclxuXHJcbi8vIEFwcGxpZXMgaW5jcmVtZW50YWwgcGF0Y2ggb3BzIHRvIHtsYXllcnMsIGJ1ZmZlcnN9LCByZXR1cm5pbmcgdGhlIG5ldyBzdGF0ZS5cclxuLy9cclxuLy8gT3BzIGFyZSBhZGRyZXNzZWQgYnkgbGF5ZXIgaWQgYW5kIGFwcGxpZWQgaWRlbXBvdGVudGx5OiBcImFkZFwiIHVwc2VydHMgcmF0aGVyIHRoYW5cclxuLy8gYXBwZW5kaW5nIGJsaW5kbHksIHNvIGEgcGF0Y2ggdGhhdCByYWNlcyB0aGUgaW5pdGlhbCB0cmFpdCBzbmFwc2hvdCBjYW5ub3QgZHVwbGljYXRlXHJcbi8vIGEgbGF5ZXIsIGFuZCBhIFwicmVtb3ZlXCIgZm9yIHNvbWV0aGluZyBhbHJlYWR5IGdvbmUgaXMgYSBuby1vcC5cclxuLy8gQXBwbGllcyBgdXBkYXRlYCB0byBvbmUgbGF5ZXIgd2hlcmV2ZXIgaXQgc2l0cywgZGVzY2VuZGluZyBpbnRvIGdyb3Vwcy4gYWRkX2NvbGxlY3Rpb25cclxuLy8gbmVzdHMgaXRzIHBvaW50LCBsaW5lIGFuZCBwb2x5Z29uIGxheWVycyBpbnNpZGUgYSBncm91cCBsYXllciwgc28gYW4gb3AgYWRkcmVzc2VkIGF0IGFcclxuLy8gbmVzdGVkIGlkIHdvdWxkIG90aGVyd2lzZSBtYXRjaCBub3RoaW5nIGFuZCBzaWxlbnRseSBkbyBub3RoaW5nLiBSZXR1cm5zIHRoZSBvcmlnaW5hbFxyXG4vLyBhcnJheSB1bnRvdWNoZWQgd2hlbiB0aGUgaWQgaXMgbm90IGZvdW5kLCBzbyBhbiB1bm1hdGNoZWQgb3AgY29zdHMgbm8gcmUtcmVuZGVyLlxyXG5mdW5jdGlvbiB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBpZCwgdXBkYXRlKSB7XHJcbiAgICBsZXQgaGl0ID0gZmFsc2U7XHJcbiAgICBjb25zdCBuZXh0ID0gbGF5ZXJzLm1hcChsID0+IHtcclxuICAgICAgICBpZiAobC5pZCA9PT0gaWQpIHtcclxuICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgcmV0dXJuIHVwZGF0ZShsKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIEFycmF5LmlzQXJyYXkobC5sYXllcnMpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN1YnMgPSB1cGRhdGVMYXllckJ5SWQobC5sYXllcnMsIGlkLCB1cGRhdGUpO1xyXG4gICAgICAgICAgICBpZiAoc3VicyAhPT0gbC5sYXllcnMpIHtcclxuICAgICAgICAgICAgICAgIGhpdCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5sLCBsYXllcnM6IHN1YnMgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbDtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIGhpdCA/IG5leHQgOiBsYXllcnM7XHJcbn1cclxuXHJcbi8vIEV2ZXJ5IHBvaW50IGxheWVyLCB2aXNpYmxlIG9yIG5vdCwgd2l0aCBpdHMgZWZmZWN0aXZlIHZpc2liaWxpdHkgcmVjb3JkZWQgLS0gdGhlXHJcbi8vIEdQVS12aXNpYmlsaXR5IHBhdGgga2VlcHMgaGlkZGVuIGxheWVycyBpbiB0aGUgYnVja2V0IChzdGFibGUgaWRzLCBubyByZWJ1aWxkIG9uIGFcclxuLy8gdG9nZ2xlKSBhbmQgaGlkZXMgdGhlbSB3aXRoIGEgdW5pZm9ybSBpbnN0ZWFkLiBNaXJyb3JzIGNvbGxlY3RXZWJnbExheWVycycgcnVsZXM6XHJcbi8vIHN1Yi1sYXllcnMgaW5oZXJpdCB0aGVpciBwYXJlbnQncyBlZmZlY3RpdmUgdmlzaWJpbGl0eSwgdG9wLWxldmVsIGxheWVycyBhbnN3ZXIgZm9yXHJcbi8vIHRoZWlyIG93biBmbGFnIGFuZCB0aGVpciBmb2xkZXIgY2hhaW4uXHJcbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0UG9pbnRMYXllcnNBbGwobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcclxuICAgIGNvbnN0IG91dCA9IHsgY2lyY2xlX21hcmtlcnM6IFtdLCBtYXJrZXJzOiBbXSwgcG9seWxpbmU6IFtdLCBwb2x5Z29uOiBbXSB9O1xyXG4gICAgZnVuY3Rpb24gd2FsayhsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWIpIHtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xyXG4gICAgICAgICAgICBjb25zdCBzZWxmVmlzID0gcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcclxuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IHdhbGsoc3ViLCBzZWxmVmlzLCB0cnVlKSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcclxuICAgICAgICBpZiAoIW91dFtidWNrZXRdKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgdmlzID0gaXNTdWIgPyBwYXJlbnRWaXNpYmxlXHJcbiAgICAgICAgICAgIDogcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcclxuICAgICAgICBvdXRbYnVja2V0XS5wdXNoKHsgbGF5ZXIsIHZpcyB9KTtcclxuICAgIH1cclxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB3YWxrKGxheWVyLCB0cnVlLCBmYWxzZSk7XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBCdWZmZXIgaWRlbnRpdHkgZm9yIHRoZSBHTCBtZXRhIGtleS4gQSBuZXcgRGF0YVZpZXcgdW5kZXIgYSBsYXllciBpZCAtLSBhXHJcbi8vIGJ1ZmZlciBvcCBmcm9tIHVwZGF0ZV9sYXllcihkYXRhPS4uLiksIG9yIHRoZSB0cmFpdCByZXNlZWRlZCAtLSBtdXN0IHJlYnVpbGRcclxuLy8gdGhlIGJ1Y2tldCBldmVuIHdoZW4gdGhlIGJ5dGUgbGVuZ3RoIGlzIHVuY2hhbmdlZCAocG9pbnRzIG1vdmVkLCBjb2xvdXJzXHJcbi8vIHJlY29tcHV0ZWQpLiBUaGUgc2VyaWFsIGlzIHBlciBvYmplY3QsIHNvIGFuIHVudG91Y2hlZCBidWZmZXIga2VlcHMgaXRzIG51bWJlclxyXG4vLyBhbmQgY29zdHMgbm8gcmVidWlsZC4gV29ya3MgZm9yIGFueSBjb25zdW1lciB0aGF0IHN3YXBzIGEgYnVmZmVyLCBQeXRob24gb3Igbm90LlxyXG5jb25zdCBidWZmZXJTZXJpYWxzID0gbmV3IFdlYWtNYXAoKTtcclxubGV0IG5leHRCdWZmZXJTZXJpYWwgPSAxO1xyXG5leHBvcnQgZnVuY3Rpb24gYnVmZmVyU2VyaWFsKGJ1Zikge1xyXG4gICAgaWYgKCFidWYgfHwgdHlwZW9mIGJ1ZiAhPT0gXCJvYmplY3RcIikgcmV0dXJuIDA7XHJcbiAgICBsZXQgc2VyaWFsID0gYnVmZmVyU2VyaWFscy5nZXQoYnVmKTtcclxuICAgIGlmICghc2VyaWFsKSB7XHJcbiAgICAgICAgc2VyaWFsID0gbmV4dEJ1ZmZlclNlcmlhbCsrO1xyXG4gICAgICAgIGJ1ZmZlclNlcmlhbHMuc2V0KGJ1Ziwgc2VyaWFsKTtcclxuICAgIH1cclxuICAgIHJldHVybiBzZXJpYWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbmNhdFZpZXdzKGhlYWQsIHRhaWwpIHtcclxuICAgIGNvbnN0IG91dCA9IG5ldyBVaW50OEFycmF5KGhlYWQuYnl0ZUxlbmd0aCArIHRhaWwuYnl0ZUxlbmd0aCk7XHJcbiAgICBvdXQuc2V0KG5ldyBVaW50OEFycmF5KGhlYWQuYnVmZmVyLCBoZWFkLmJ5dGVPZmZzZXQsIGhlYWQuYnl0ZUxlbmd0aCksIDApO1xyXG4gICAgb3V0LnNldChuZXcgVWludDhBcnJheSh0YWlsLmJ1ZmZlciwgdGFpbC5ieXRlT2Zmc2V0LCB0YWlsLmJ5dGVMZW5ndGgpLCBoZWFkLmJ5dGVMZW5ndGgpO1xyXG4gICAgcmV0dXJuIG5ldyBEYXRhVmlldyhvdXQuYnVmZmVyKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYXBwZW5kUm93cyhsYXllciwgb3ApIHtcclxuICAgIGNvbnN0IGJhc2UgPSBvcC5iYXNlIHx8IDA7XHJcbiAgICBjb25zdCBjb3VudCA9IG9wLmNvdW50IHx8IDA7XHJcbiAgICBjb25zdCBpbmNvbWluZyA9IG9wLnByb3BlcnRpZXMgfHwge307XHJcbiAgICBjb25zdCBwcm9wcyA9IHsgLi4uKGxheWVyLnByb3BlcnRpZXMgfHwge30pIH07XHJcbiAgICAvLyBgYmFzZWAgbXVzdCBlcXVhbCB0aGUgbGF5ZXIncyBjdXJyZW50IHJvdyBjb3VudDogb2ZmIGJ5IG9uZSBhbmQgZXZlcnlcclxuICAgIC8vIHByb3BlcnR5IGRlc3luY3MgZnJvbSBpdHMgY29vcmRpbmF0ZXMgcGVybWFuZW50bHksIHdpdGggbm90aGluZyBvbiBzY3JlZW5cclxuICAgIC8vIHRvIHNheSBzby4gUHl0aG9uIGNvbXB1dGVzIGJhc2UgZm9yIGl0cyBvcHM7IGhhbmQtYnVpbHQgZmVlZHMgZ2V0IHRvbGQuXHJcbiAgICBjb25zdCBvZmYgPSBPYmplY3Qua2V5cyhwcm9wcykuZmluZChrID0+IEFycmF5LmlzQXJyYXkocHJvcHNba10pICYmIHByb3BzW2tdLmxlbmd0aCAhPT0gYmFzZSk7XHJcbiAgICBpZiAob2ZmICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYHN3aWZ0bWFwOiBhcHBlbmQgdG8gJHtsYXllci5pZH06IGJhc2UgJHtiYXNlfSBkb2VzIG5vdCBtYXRjaCBgXHJcbiAgICAgICAgICAgICsgYHByb3BlcnR5IFwiJHtvZmZ9XCIncyAke3Byb3BzW29mZl0ubGVuZ3RofSByb3dzIC0tIHJvd3Mgd2lsbCBkZXN5bmNgKTtcclxuICAgIH1cclxuICAgIGZvciAoY29uc3Qga2V5IG9mIG5ldyBTZXQoWy4uLk9iamVjdC5rZXlzKHByb3BzKSwgLi4uT2JqZWN0LmtleXMoaW5jb21pbmcpXSkpIHtcclxuICAgICAgICBjb25zdCBoZWFkID0gQXJyYXkuaXNBcnJheShwcm9wc1trZXldKSA/IHByb3BzW2tleV1cclxuICAgICAgICAgICAgOiBuZXcgQXJyYXkoYmFzZSkuZmlsbChwcm9wc1trZXldID09PSB1bmRlZmluZWQgPyBudWxsIDogcHJvcHNba2V5XSk7XHJcbiAgICAgICAgY29uc3QgdGFpbCA9IEFycmF5LmlzQXJyYXkoaW5jb21pbmdba2V5XSkgPyBpbmNvbWluZ1trZXldIDogbmV3IEFycmF5KGNvdW50KS5maWxsKG51bGwpO1xyXG4gICAgICAgIHByb3BzW2tleV0gPSBoZWFkLmNvbmNhdCh0YWlsKTtcclxuICAgIH1cclxuICAgIGNvbnN0IG5leHQgPSB7IC4uLmxheWVyLCBwcm9wZXJ0aWVzOiBwcm9wcyB9O1xyXG4gICAgZm9yIChjb25zdCBbZmllbGQsIHRhaWxdIG9mIE9iamVjdC5lbnRyaWVzKG9wLmxpc3RzIHx8IHt9KSkge1xyXG4gICAgICAgIG5leHRbZmllbGRdID0gKEFycmF5LmlzQXJyYXkobGF5ZXJbZmllbGRdKSA/IGxheWVyW2ZpZWxkXSA6IFtdKS5jb25jYXQodGFpbCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV4dDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3dpZnRtYXBQYXRjaChzdGF0ZSwgb3BzLCBidWZmZXJzKSB7XHJcbiAgICBsZXQgbGF5ZXJzID0gc3RhdGUubGF5ZXJzIHx8IFtdO1xyXG4gICAgbGV0IGJ1ZmZlck1hcCA9IHN0YXRlLmJ1ZmZlcnMgfHwge307XHJcblxyXG4gICAgZm9yIChjb25zdCBvcCBvZiBvcHMpIHtcclxuICAgICAgICBpZiAob3Aub3AgPT09IFwic25hcHNob3RcIikge1xyXG4gICAgICAgICAgICBsYXllcnMgPSBvcC5sYXllcnMgfHwgW107XHJcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHt9O1xyXG4gICAgICAgICAgICAob3AuYnVmZmVyX2lkcyB8fCBbXSkuZm9yRWFjaCgoaWQsIGkpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChidWZmZXJzICYmIGJ1ZmZlcnNbaV0pIGJ1ZmZlck1hcFtpZF0gPSBidWZmZXJzW2ldO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImFkZFwiIHx8IG9wLm9wID09PSBcInJlcGxhY2VcIikge1xyXG4gICAgICAgICAgICBjb25zdCBpbmNvbWluZyA9IG9wLmxheWVyO1xyXG4gICAgICAgICAgICBjb25zdCBpZCA9IGluY29taW5nID8gaW5jb21pbmcuaWQgOiBvcC5pZDtcclxuICAgICAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJzLmZpbmRJbmRleChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcclxuICAgICAgICAgICAgICAgIGxheWVycyA9IFsuLi5sYXllcnMsIGluY29taW5nXTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5tYXAoKGwsIGkpID0+IChpID09PSBpZHggPyBpbmNvbWluZyA6IGwpKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic2V0XCIpIHtcclxuICAgICAgICAgICAgLy8gRmllbGQtbGV2ZWwgdXBkYXRlLiBcInJlcGxhY2VcIiBjYXJyaWVzIHRoZSB3aG9sZSBsYXllciwgc28gZmxpcHBpbmcgYHZpc2libGVgXHJcbiAgICAgICAgICAgIC8vIG9uIGEgNTBrLXBvaW50IGxheWVyIHJlc2VudCBldmVyeSBwcm9wZXJ0eSBpdCBob2xkcyAtLSBoYWxmIGEgbWVnYWJ5dGUgdG9cclxuICAgICAgICAgICAgLy8gY2hhbmdlIG9uZSBib29sZWFuLCBvbiBldmVyeSBjbGljayBvZiBhIGNoZWNrYm94LlxyXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoeyAuLi5sLCAuLi4ob3AuZmllbGRzIHx8IHt9KSB9KSk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzdHlsZVwiKSB7XHJcbiAgICAgICAgICAgIC8vIFBlci1mZWF0dXJlIHN0eWxlIG92ZXJyaWRlcywgcmVwbGFjZWQgd2hvbGVzYWxlIHJhdGhlciB0aGFuIG1lcmdlZDogYVxyXG4gICAgICAgICAgICAvLyBzZWxlY3Rpb24gZGVzY3JpYmVzIGl0cyBjb21wbGV0ZSBzdGF0ZSwgc28gc2VuZGluZyB7fSBjbGVhcnMgaXQgYW5kIG5vXHJcbiAgICAgICAgICAgIC8vIGNhbGxlciBoYXMgdG8gdHJhY2sgd2hhdCB0aGUgcHJldmlvdXMgaGlnaGxpZ2h0IHRvdWNoZWQuXHJcbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7XHJcbiAgICAgICAgICAgICAgICAuLi5sLCBzdHlsZV9vdmVycmlkZXM6IG9wLm92ZXJyaWRlcyB8fCB7fSxcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwicmVtb3ZlXCIpIHtcclxuICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLmZpbHRlcihsID0+IGwuaWQgIT09IG9wLmlkKTtcclxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlclwiKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGJ1ZiA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tvcC5idWZmZXJfaW5kZXhdO1xyXG4gICAgICAgICAgICBpZiAoYnVmKSBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogYnVmIH07XHJcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJfYXBwZW5kXCIpIHtcclxuICAgICAgICAgICAgLy8gQSB0YWlsIGZvciBhbiBleGlzdGluZyBidWZmZXIgLS0gdGhlIGZlZWQgcHJpbWl0aXZlJ3Mgd2lyZSBzaGFwZSxcclxuICAgICAgICAgICAgLy8gcHJvcG9ydGlvbmFsIHRvIHRoZSBiYXRjaC4gQ29uY2F0ZW5hdGlvbiB5aWVsZHMgYSBORVcgRGF0YVZpZXcsIGFuZFxyXG4gICAgICAgICAgICAvLyB0aGUgR0wgbWV0YSBrZXkga2V5cyBvbiBidWZmZXIgaWRlbnRpdHksIHNvIHRoZSBidWNrZXQgcmVidWlsZHMuXHJcbiAgICAgICAgICAgIGNvbnN0IHRhaWwgPSBidWZmZXJzICYmIGJ1ZmZlcnNbb3AuYnVmZmVyX2luZGV4XTtcclxuICAgICAgICAgICAgaWYgKHRhaWwpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGhlYWQgPSBidWZmZXJNYXBbb3AuaWRdO1xyXG4gICAgICAgICAgICAgICAgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAsIFtvcC5pZF06IGhlYWQgPyBjb25jYXRWaWV3cyhoZWFkLCB0YWlsKSA6IHRhaWwgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYXBwZW5kXCIpIHtcclxuICAgICAgICAgICAgLy8gTmV3IHJvd3MgZm9yIHRoZSBwcm9wZXJ0eSBsaXN0cyAoYW5kIG90aGVyIHBlci1mZWF0dXJlIGxpc3RzKSwgYWZ0ZXJcclxuICAgICAgICAgICAgLy8gdGhlIGV4aXN0aW5nIG9uZXMuIENvbHVtbnMgbWlzc2luZyBvbiBlaXRoZXIgc2lkZSBmaWxsIG51bGwsIGV4YWN0bHlcclxuICAgICAgICAgICAgLy8gYXMgdGhlIFB5dGhvbiBzaWRlIGRvZXMsIHNvIGEgbGF0ZXIgcG9wdXAgcmVhZHMgdGhlIHNhbWUgdGFibGUuXHJcbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+IGFwcGVuZFJvd3MobCwgb3ApKTtcclxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlcl9yZW1vdmVcIikge1xyXG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xyXG4gICAgICAgICAgICBkZWxldGUgYnVmZmVyTWFwW29wLmlkXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHsgbGF5ZXJzLCBidWZmZXJzOiBidWZmZXJNYXAgfTtcclxufVxyXG4iLCAiLy8gVGhlIGxlZ2VuZDogZGVyaXZlZCBmcm9tIHRoZSBzYW1lIGxheWVyIHN0YXRlIGV2ZXJ5dGhpbmcgZWxzZSByZW5kZXJzIGZyb20sIHdpdGhcclxuLy8gZGVjbGFyYXRpdmUgb3ZlcnJpZGVzIG9uIHRvcC4gRGVsaWJlcmF0ZWx5IG1vZGVsLWZyZWUgLS0gcHVyZSBkYXRhIGluLCBET00gb3V0IC0tXHJcbi8vIHNvIGEgcGxhaW4tSlMgY29uc3VtZXIgb2YgZGlzdC9pbmRleC5qcyBnZXRzIHRoZSB3aG9sZSBmZWF0dXJlLCBhbmQgdGhlIGFueXdpZGdldFxyXG4vLyBnbHVlIGluIG1hcC5qcyBpcyBhIGZldyBsaW5lcy4gKHNpZGViYXIuanMgc3RpbGwgdGFrZXMgYG1vZGVsYCBhbmQgaXMgZmlsZWQgZm9yXHJcbi8vIGV4dHJhY3Rpb247IHRoaXMgbW9kdWxlIG11c3QgbmV2ZXIgbmVlZCB0aGF0IHVucGlja2luZy4pXHJcbi8vXHJcbi8vIFRoZSBwaXBlbGluZTogZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgY29uZmlnKSB3YWxrcyB0aGUgbGF5ZXJzIGludG9cclxuLy8gZW50cmllcyAoc2tpcHBlZCBlbnRpcmVseSB3aGVuIGNvbmZpZy5hdXRvID09PSBmYWxzZSksIGFwcGxpZXMgdGhlIHBlcnNpc3RlbnRcclxuLy8gcmVtb3ZlLW1hdGNoZXJzLCBhcHBlbmRzIHRoZSBtYW51YWwgYWRkcywgYW5kIHJldHVybnMgYSBzcGVjIHRoYXQgcmVuZGVyTGVnZW5kXHJcbi8vIHR1cm5zIGludG8gRE9NLiBOb3RoaW5nIGhlcmUga25vd3MgYWJvdXQgY29sb3JtYXBzOiByYW1wL2NhdGVnb3J5L2JpbiBlbnRyaWVzXHJcbi8vIGFycml2ZSB3aXRoIHRoZWlyIGNvbG91cnMgYWxyZWFkeSByZXNvbHZlZCAoUHl0aG9uIHJlc29sdmVzIGF0IHRoZSBhZGRfKiBib3VuZGFyeSxcclxuLy8gbWFudWFsIGVudHJpZXMgYXQgbGVnZW5kX2FkZCksIHNvIHRoZXJlIGlzIG5vIGFuY2hvciB0YWJsZSB0byBkcmlmdC5cclxuXHJcbmltcG9ydCB7IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlIH0gZnJvbSBcIi4vcGF0Y2guanNcIjtcclxuXHJcbmNvbnN0IEdMWVBIUyA9IHtcclxuICAgIGNpcmNsZV9tYXJrZXJzOiBcImNpcmNsZVwiLFxyXG4gICAgbWFya2VyczogXCJwaW5cIixcclxuICAgIHBvbHlsaW5lOiBcImxpbmVcIixcclxuICAgIHBvbHlnb246IFwicG9seWdvblwiLFxyXG4gICAgY2lyY2xlOiBcImNpcmNsZVwiLFxyXG59O1xyXG5cclxuZnVuY3Rpb24gc3dhdGNoRW50cnkobGF5ZXIsIGhpZGRlbikge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBraW5kOiBcInN3YXRjaFwiLFxyXG4gICAgICAgIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIixcclxuICAgICAgICBzaGFwZTogR0xZUEhTW2xheWVyLnR5cGVdIHx8IFwic3F1YXJlXCIsXHJcbiAgICAgICAgY29sb3I6IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxyXG4gICAgICAgIGZpbGxDb2xvcjogbGF5ZXIuZmlsbENvbG9yIHx8IGxheWVyLmZpbGxfY29sb3IgfHwgbGF5ZXIuY29sb3IgfHwgXCIjMzM4OGZmXCIsXHJcbiAgICAgICAgaGlkZGVuLFxyXG4gICAgfTtcclxufVxyXG5cclxuLy8gQSBkYXRhLWRyaXZlbiBibG9jayByZWNvcmRlZCBhdCBhZGQgdGltZSAoe2tpbmQsIGFuY2hvcnN8aXRlbXN8ZWRnZXMrY29sb3JzLCAuLi59KVxyXG4vLyBiZWNvbWVzIHRoZSBsYXllcidzIGVudHJ5IGFzLWlzOyB0aGUgbGF5ZXIgb25seSBjb250cmlidXRlcyBsYWJlbCBhbmQgdmlzaWJpbGl0eS5cclxuZnVuY3Rpb24gYmxvY2tFbnRyeShsYXllciwgaGlkZGVuKSB7XHJcbiAgICByZXR1cm4geyAuLi5sYXllci5sZWdlbmQsIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIiwgaGlkZGVuIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzKSB7XHJcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJiYXNlbWFwXCIpIHJldHVybiBbXTtcclxuICAgIGNvbnN0IGhpZGRlbiA9ICFpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICAvLyBBIGNvbGxlY3Rpb246IG9uZSBlbnRyeSBwZXIgZ2VvbWV0cnkgcGFydCwgc2FtZSBsYWJlbCBieSBkZXNpZ24gLS0gdGhlXHJcbiAgICAgICAgLy8gZ2x5cGhzIGFyZSB3aGF0IHRlbGwgdGhlbSBhcGFydCwgbWF0Y2hpbmcgaG93IHRoZSBwYXJ0cyByZW5kZXIuXHJcbiAgICAgICAgcmV0dXJuIChsYXllci5sYXllcnMgfHwgW10pXHJcbiAgICAgICAgICAgIC5maWx0ZXIoc3ViID0+IEdMWVBIU1tzdWIudHlwZV0pXHJcbiAgICAgICAgICAgIC5tYXAoc3ViID0+IHN1Yi5sZWdlbmRcclxuICAgICAgICAgICAgICAgID8gYmxvY2tFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pXHJcbiAgICAgICAgICAgICAgICA6IHN3YXRjaEVudHJ5KHsgLi4uc3ViLCBuYW1lOiBsYXllci5uYW1lIH0sIGhpZGRlbikpO1xyXG4gICAgfVxyXG4gICAgaWYgKCFHTFlQSFNbbGF5ZXIudHlwZV0pIHJldHVybiBbXTtcclxuICAgIGNvbnN0IGVudHJpZXMgPSBbbGF5ZXIubGVnZW5kID8gYmxvY2tFbnRyeShsYXllciwgaGlkZGVuKSA6IHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pXTtcclxuICAgIC8vIHJhZGl1c19jb2wgcmVjb3JkcyBhIHNpemUga2V5IGJlc2lkZSB0aGUgY29sb3VyIHN0b3J5OiBib3RoIGVuY29kaW5ncyBvbiB0aGVcclxuICAgIC8vIG1hcCBkZXNlcnZlIGJvdGggZXhwbGFuYXRpb25zIGluIHRoZSBsZWdlbmQuXHJcbiAgICBpZiAobGF5ZXIubGVnZW5kX3NpemUpIHtcclxuICAgICAgICBlbnRyaWVzLnB1c2goeyAuLi5sYXllci5sZWdlbmRfc2l6ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogbGF5ZXIubGVnZW5kX3NpemUuZmllbGQgfHwgbGF5ZXIubmFtZSB8fCBcIlNpemVcIiwgaGlkZGVuIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGVudHJpZXM7XHJcbn1cclxuXHJcbi8vIElkZW50aWNhbCBkYXRhLWRyaXZlbiBwYXlsb2FkcyBjb2xsYXBzZSBpbnRvIG9uZSByb3cuIEdyb3VwaW5nIHBvaW50cyBieSBhIGNvbHVtblxyXG4vLyBnaXZlcyBldmVyeSBzdWItbGF5ZXIgdGhlIHNhbWUgcmFtcDsgYSByYW1wIHBlciBzdWItbGF5ZXIgaXMgbm9pc2UsIGFuZCB0aGUgZmllbGRcclxuLy8gbmFtZSBpcyB0aGUgaG9uZXN0IGxhYmVsIGZvciB0aGUgc2hhcmVkIG1hcHBpbmcuIFRoZSBzdXJ2aXZvciBrZWVwcyB0aGUgZmlyc3RcclxuLy8gb2NjdXJyZW5jZSdzIHBvc2l0aW9uIGFuZCBoaWRlcyBvbmx5IHdoZW4gZXZlcnkgY29udHJpYnV0b3IgaXMgaGlkZGVuLlxyXG5mdW5jdGlvbiBwYXlsb2FkS2V5KGVudHJ5KSB7XHJcbiAgICAvLyBJZGVudGl0eSBmaWVsZHMgc3RheSBvdXQgb2YgdGhlIGtleTogdGhlIHdob2xlIHBvaW50IGlzIHRoYXQgZW50cmllcyBmcm9tXHJcbiAgICAvLyBESUZGRVJFTlQgbGF5ZXJzIGNvbGxhcHNlIHdoZW4gdGhlaXIgbWFwcGluZyBwYXlsb2FkIGlzIHRoZSBzYW1lLlxyXG4gICAgY29uc3QgeyBsYWJlbCwgaGlkZGVuLCBsYXllcklkLCBsYXllciwgZ3JvdXAsIC4uLnBheWxvYWQgfSA9IGVudHJ5O1xyXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWR1cGVEYXRhRW50cmllcyhncm91cHMpIHtcclxuICAgIGNvbnN0IHNlZW4gPSBuZXcgTWFwKCk7ICAgLy8gcGF5bG9hZCBrZXkgLT4gc3Vydml2aW5nIGVudHJ5XHJcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG4gICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihlbnRyeSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChlbnRyeS5raW5kID09PSBcInN3YXRjaFwiKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGF5bG9hZEtleShlbnRyeSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHN1cnZpdm9yID0gc2Vlbi5nZXQoa2V5KTtcclxuICAgICAgICAgICAgaWYgKCFzdXJ2aXZvcikge1xyXG4gICAgICAgICAgICAgICAgc2Vlbi5zZXQoa2V5LCBlbnRyeSk7XHJcbiAgICAgICAgICAgICAgICBpZiAoZW50cnkuZmllbGQpIGVudHJ5LmxhYmVsID0gZW50cnkuZmllbGQ7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBzdXJ2aXZvci5oaWRkZW4gPSBzdXJ2aXZvci5oaWRkZW4gJiYgZW50cnkuaGlkZGVuO1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZ3JvdXBzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYXRjaGVySGl0cyhtYXRjaGVyLCBlbnRyeSwgZ3JvdXBOYW1lKSB7XHJcbiAgICBpZiAoIW1hdGNoZXIpIHJldHVybiBmYWxzZTtcclxuICAgIGxldCBjb25zdHJhaW5lZCA9IGZhbHNlO1xyXG4gICAgaWYgKG1hdGNoZXIubGFiZWwgIT0gbnVsbCkge1xyXG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAoZW50cnkubGFiZWwgIT09IG1hdGNoZXIubGFiZWwpIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIGlmIChtYXRjaGVyLmdyb3VwICE9IG51bGwpIHtcclxuICAgICAgICBjb25zdHJhaW5lZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKGdyb3VwTmFtZSAhPT0gbWF0Y2hlci5ncm91cCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgaWYgKG1hdGNoZXIuaWQgIT0gbnVsbCkge1xyXG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAoZW50cnkubGF5ZXJJZCAhPT0gbWF0Y2hlci5pZCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvbnN0cmFpbmVkO1xyXG59XHJcblxyXG4vLyBBIHJhbXAgZW5kcG9pbnQgYXMgaXQgc2hvdWxkIHJlYWQgaW4gYSBsZWdlbmQ6IDEwLCBub3QgMTAuMDAwMDAwMDAxLCBhbmRcclxuLy8gMC4wMDM3NTcsIG5vdCAwLjAwMzc1NjcyNzA5MTk2ODA1OTUuIEZvdXIgc2lnbmlmaWNhbnQgZmlndXJlcywgaW50ZWdlcnMgd2hvbGUsXHJcbi8vIGFueXRoaW5nIG5vbi1udW1lcmljIHBhc3NlZCB0aHJvdWdoLiBQeXRob24gcm91bmRzIGl0cyBzaWRlIGJlZm9yZSBjb21wb3NpbmdcclxuLy8gYSBibG9jayAoX2xhYmVsX251bSksIGJ1dCBsZWdlbmRzIGRlcml2ZWQgb3IgaGFuZC1idWlsdCBpbiBKUyBhcnJpdmUgcmF3LlxyXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0Qm91bmQodmFsdWUpIHtcclxuICAgIGNvbnN0IG4gPSBOdW1iZXIodmFsdWUpO1xyXG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdmFsdWUgPT09IFwiXCIgfHwgIWlzRmluaXRlKG4pKSByZXR1cm4gU3RyaW5nKHZhbHVlKTtcclxuICAgIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKG4pID8gU3RyaW5nKG4pIDogU3RyaW5nKE51bWJlcihuLnRvUHJlY2lzaW9uKDQpKSk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHtcclxuICAgIGNvbnN0IGNmZyA9IGNvbmZpZyB8fCB7fTtcclxuICAgIGNvbnN0IGdyb3VwcyA9IFtdO1xyXG4gICAgY29uc3QgYnlOYW1lID0gbmV3IE1hcCgpO1xyXG4gICAgY29uc3QgZ3JvdXBGb3IgPSBuYW1lID0+IHtcclxuICAgICAgICBpZiAoIWJ5TmFtZS5oYXMobmFtZSkpIHtcclxuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IG5hbWUsIGVudHJpZXM6IFtdIH07XHJcbiAgICAgICAgICAgIGJ5TmFtZS5zZXQobmFtZSwgZ3JvdXApO1xyXG4gICAgICAgICAgICBncm91cHMucHVzaChncm91cCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBieU5hbWUuZ2V0KG5hbWUpO1xyXG4gICAgfTtcclxuXHJcbiAgICBpZiAoY2ZnLmF1dG8gIT09IGZhbHNlKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIHtcclxuICAgICAgICAgICAgICAgIGVudHJ5LmxheWVySWQgPSBsYXllci5pZDtcclxuICAgICAgICAgICAgICAgIGlmIChjZmcuc2NvcGUgPT09IFwidmlzaWJsZVwiICYmIGVudHJ5LmhpZGRlbikgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBncm91cEZvcihsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUGVyc2lzdGVudCBzdXBwcmVzc2lvbjogbWF0Y2hlcnMgb3V0bGl2ZSBldmVyeSByZS1kZXJpdmF0aW9uLCB3aGljaCBpcyB0aGVcclxuICAgIC8vIGRpZmZlcmVuY2UgZnJvbSBhIHJlZ2lzdHJ5IHJlbW92ZSB0aGF0IHRoZSBuZXh0IGFkZCB3b3VsZCBqdXN0IHJlcG9wdWxhdGUuXHJcbiAgICBjb25zdCByZW1vdmVzID0gY2ZnLnJlbW92ZSB8fCBbXTtcclxuICAgIGlmIChyZW1vdmVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG4gICAgICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoXHJcbiAgICAgICAgICAgICAgICBlbnRyeSA9PiAhcmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGdyb3VwLm5hbWUpKSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIE1hbnVhbCBlbnRyaWVzOiB0aGUgdXNlcidzIG93biBjbGFpbXMuIHNjb3BlIG5ldmVyIGRyb3BzIHRoZW07IGEgYGxheWVyYFxyXG4gICAgLy8gYmluZGluZyBtYWtlcyBvbmUgZm9sbG93IGEgbGl2ZSBsYXllcidzIHZpc2liaWxpdHkgKGFuZCB2YW5pc2ggd2l0aCBpdCB1bmRlclxyXG4gICAgLy8gc2NvcGUgXCJ2aXNpYmxlXCIpLCBmb3Igd2hlbiBhIG1hbnVhbCByb3cgaXMgcmVhbGx5IGEgcmVsYWJlbGxpbmcuXHJcbiAgICBmb3IgKGNvbnN0IGFkZGVkIG9mIGNmZy5hZGQgfHwgW10pIHtcclxuICAgICAgICBjb25zdCBlbnRyeSA9IHsgaGlkZGVuOiBmYWxzZSwgLi4uYWRkZWQgfTtcclxuICAgICAgICBpZiAoZW50cnkubGF5ZXIgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICBjb25zdCBib3VuZCA9IChsYXllcnMgfHwgW10pLmZpbmQoXHJcbiAgICAgICAgICAgICAgICBsID0+IGwuaWQgPT09IGVudHJ5LmxheWVyIHx8IGwubmFtZSA9PT0gZW50cnkubGF5ZXIpO1xyXG4gICAgICAgICAgICBlbnRyeS5oaWRkZW4gPSAhYm91bmQgfHwgIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGJvdW5kLCBncm91cENvbmZpZ3MgfHwge30pO1xyXG4gICAgICAgICAgICBpZiAoY2ZnLnNjb3BlID09PSBcInZpc2libGVcIiAmJiBlbnRyeS5oaWRkZW4pIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGVudHJ5Lmdyb3VwIHx8IFwiXCIpKSkgY29udGludWU7XHJcbiAgICAgICAgZ3JvdXBGb3IoZW50cnkuZ3JvdXAgfHwgXCJcIikuZW50cmllcy5wdXNoKGVudHJ5KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb3B1bGF0ZWQgPSBncm91cHMuZmlsdGVyKGcgPT4gZy5lbnRyaWVzLmxlbmd0aCA+IDApO1xyXG4gICAgcmV0dXJuIHsgdGl0bGU6IGNmZy50aXRsZSB8fCBcIkxlZ2VuZFwiLCBncm91cHM6IHBvcHVsYXRlZCB9O1xyXG59XHJcblxyXG4vLyAtLS0gcmVuZGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBET00gYnVpbHQgd2l0aCBjcmVhdGVFbGVtZW50L3RleHRDb250ZW50IHRocm91Z2hvdXQ6IGxhYmVscyBhbmQgY2F0ZWdvcnkgdmFsdWVzIGNvbWVcclxuLy8gZnJvbSB1c2VyIGRhdGEgYW5kIG11c3QgbmV2ZXIgYmUgcGFyc2VkIGFzIEhUTUwuXHJcblxyXG5mdW5jdGlvbiBkaXYoc3R5bGVzLCB0ZXh0KSB7XHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZXMpO1xyXG4gICAgaWYgKHRleHQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xyXG4gICAgcmV0dXJuIGVsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnbHlwaChlbnRyeSkge1xyXG4gICAgaWYgKGVudHJ5LnNoYXBlID09PSBcImxpbmVcIikge1xyXG4gICAgICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIyMHB4XCIsIGhlaWdodDogXCI0cHhcIiwgYmFja2dyb3VuZDogZW50cnkuY29sb3IsXHJcbiAgICAgICAgICAgICAgICAgICAgIG1hcmdpblJpZ2h0OiBcIjZweFwiLCBmbGV4OiBcIm5vbmVcIiB9KTtcclxuICAgIH1cclxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJwaW5cIikge1xyXG4gICAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgZWwuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjZweFwiO1xyXG4gICAgICAgIGVsLnN0eWxlLmZsZXggPSBcIm5vbmVcIjtcclxuICAgICAgICBjb25zdCBzdmcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcInN2Z1wiKTtcclxuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwid2lkdGhcIiwgXCIxMlwiKTtcclxuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMTRcIik7XHJcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZShcInZpZXdCb3hcIiwgXCIwIDAgMjQgMjhcIik7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsIFwicGF0aFwiKTtcclxuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImRcIixcclxuICAgICAgICAgICAgXCJNMTIgMEM1LjQgMCAwIDUuNCAwIDEyYzAgOSAxMiAxNiAxMiAxNnMxMi03IDEyLTE2QzI0IDUuNCAxOC42IDAgMTIgMHpcIik7XHJcbiAgICAgICAgcGF0aC5zZXRBdHRyaWJ1dGUoXCJmaWxsXCIsIGVudHJ5LmNvbG9yKTtcclxuICAgICAgICBzdmcuYXBwZW5kQ2hpbGQocGF0aCk7XHJcbiAgICAgICAgZWwuYXBwZW5kQ2hpbGQoc3ZnKTtcclxuICAgICAgICByZXR1cm4gZWw7XHJcbiAgICB9XHJcbiAgICAvLyBjaXJjbGUgLyBwb2x5Z29uIC8gc3F1YXJlOiBmaWxsIGluc2lkZSBhIGJvcmRlciwgd2hpY2ggaXMgaG93IGFyZWFzIGRyYXcuXHJcbiAgICBjb25zdCByYWRpdXMgPSBlbnRyeS5zaGFwZSA9PT0gXCJjaXJjbGVcIiA/IFwiNTAlXCJcclxuICAgICAgICA6IGVudHJ5LnNoYXBlID09PSBcInBvbHlnb25cIiA/IFwiMnB4XCIgOiBcIjBcIjtcclxuICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIxMnB4XCIsIGhlaWdodDogXCIxMnB4XCIsIGJhY2tncm91bmQ6IGVudHJ5LmZpbGxDb2xvcixcclxuICAgICAgICAgICAgICAgICBib3JkZXI6IGAycHggc29saWQgJHtlbnRyeS5jb2xvcn1gLCBib3JkZXJSYWRpdXM6IHJhZGl1cyxcclxuICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGJveFNpemluZzogXCJib3JkZXItYm94XCIgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJhbXBSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XHJcbiAgICBjb25zdCBzdG9wcyA9IChlbnRyeS5hbmNob3JzIHx8IFtdKS5tYXAoKGNvbG9yLCBpLCBhbGwpID0+XHJcbiAgICAgICAgYCR7Y29sb3J9ICR7YWxsLmxlbmd0aCA+IDEgPyAoaSAvIChhbGwubGVuZ3RoIC0gMSkpICogMTAwIDogMH0lYCk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHtcclxuICAgICAgICB3aWR0aDogXCIxMjBweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBib3JkZXJSYWRpdXM6IFwiMnB4XCIsXHJcbiAgICAgICAgYmFja2dyb3VuZEltYWdlOiBgbGluZWFyLWdyYWRpZW50KHRvIHJpZ2h0LCAke3N0b3BzLmpvaW4oXCIsIFwiKX0pYCxcclxuICAgIH0pKTtcclxuICAgIGNvbnN0IGVuZHMgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwganVzdGlmeUNvbnRlbnQ6IFwic3BhY2UtYmV0d2VlblwiLCB3aWR0aDogXCIxMjBweFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgIGZvbnRTaXplOiBcIjExcHhcIiwgY29sb3I6IFwiIzU1NVwiIH0pO1xyXG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIGZvcm1hdEJvdW5kKGVudHJ5LnZtaW4pKSk7XHJcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgZm9ybWF0Qm91bmQoZW50cnkudm1heCkpKTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChlbmRzKTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbmNvbnN0IE1BWF9DQVRFR09SWV9ST1dTID0gMTI7XHJcblxyXG5mdW5jdGlvbiBjYXRlZ29yaWVzUm93KGVudHJ5KSB7XHJcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xyXG4gICAgY29uc3QgaXRlbXMgPSBlbnRyeS5pdGVtcyB8fCBbXTtcclxuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcy5zbGljZSgwLCBNQVhfQ0FURUdPUllfUk9XUykpIHtcclxuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcclxuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGdseXBoKHsgc2hhcGU6IFwic3F1YXJlXCIsIGNvbG9yOiBpdGVtLmNvbG9yLCBmaWxsQ29sb3I6IGl0ZW0uY29sb3IgfSkpO1xyXG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZGl2KHt9LCBTdHJpbmcoaXRlbS52YWx1ZSkpKTtcclxuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XHJcbiAgICB9XHJcbiAgICBpZiAoaXRlbXMubGVuZ3RoID4gTUFYX0NBVEVHT1JZX1JPV1MpIHtcclxuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luTGVmdDogXCI4cHhcIiwgbWFyZ2luVG9wOiBcIjNweFwiLCBjb2xvcjogXCIjNTU1XCIgfSxcclxuICAgICAgICAgICAgYCsgJHtpdGVtcy5sZW5ndGggLSBNQVhfQ0FURUdPUllfUk9XU30gbW9yZWApKTtcclxuICAgIH1cclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJpbnNSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XHJcbiAgICBjb25zdCBlZGdlcyA9IGVudHJ5LmVkZ2VzIHx8IFtdO1xyXG4gICAgY29uc3QgY29sb3JzID0gZW50cnkuY29sb3JzIHx8IFtdO1xyXG4gICAgY29uc3QgbGFiZWxGb3IgPSBpID0+IGkgPT09IDAgPyBgPCAke2VkZ2VzWzBdfWBcclxuICAgICAgICA6IGkgPT09IGVkZ2VzLmxlbmd0aCA/IGBcdTIyNjUgJHtlZGdlc1tlZGdlcy5sZW5ndGggLSAxXX1gXHJcbiAgICAgICAgOiBgJHtlZGdlc1tpIC0gMV19IFx1MjAxMyAke2VkZ2VzW2ldfWA7XHJcbiAgICBjb2xvcnMuZm9yRWFjaCgoY29sb3IsIGkpID0+IHtcclxuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcclxuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGdseXBoKHsgc2hhcGU6IFwic3F1YXJlXCIsIGNvbG9yLCBmaWxsQ29sb3I6IGNvbG9yIH0pKTtcclxuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgbGFiZWxGb3IoaSkpKTtcclxuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbi8vIEEgc2l6ZSBrZXkgaXMgYSBzdGF0ZW1lbnQsIG5vdCBhIGRyYXdpbmc6IFwiXHUyNUNGIHNpemUgXHUyMjFEIGZpZWxkIChtaW4gXHUyMDEzIG1heClcIi4gVGhlIGdseXBoXHJcbi8vIGlzIGZpeGVkIGFuZCBub3RoaW5nIGluIHRoZSByb3cgZGVyaXZlcyBmcm9tIHJhZGl1c19yYW5nZSBvciB0aGUgZGF0YSdzIHNwcmVhZCAtLVxyXG4vLyBsZWdlbmQgQ1NTIHBpeGVscyBhcmUgbm90IG1hcCBwaXhlbHMgYXQgYW55IHpvb20sIHNvIGRyYXduIHNhbXBsZSBjaXJjbGVzIHdvdWxkXHJcbi8vIGFzc2VydCBhIHByZWNpc2lvbiB0aGF0IGRvZXMgbm90IGV4aXN0LiBUaGUgcm93IG5hbWVzIHRoZSBlbmNvZGluZyBhbmQgaXRzIGRvbWFpbi5cclxuZnVuY3Rpb24gc2l6ZXNSb3coZW50cnkpIHtcclxuICAgIGNvbnN0IHJvdyA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBjb2xvcjogXCIjNjY2XCIgfSwgXCJcdTI1Q0ZcIikpO1xyXG4gICAgY29uc3QgcmFuZ2UgPSBlbnRyeS52bWluICE9IG51bGwgJiYgZW50cnkudm1heCAhPSBudWxsXHJcbiAgICAgICAgPyBgICgke2Zvcm1hdEJvdW5kKGVudHJ5LnZtaW4pfSBcdTIwMTMgJHtmb3JtYXRCb3VuZChlbnRyeS52bWF4KX0pYCA6IFwiXCI7XHJcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBgc2l6ZSBcdTIyMUQgJHtlbnRyeS5maWVsZCB8fCBlbnRyeS5sYWJlbH0ke3JhbmdlfWApKTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHN3YXRjaFJvdyhlbnRyeSkge1xyXG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcclxuICAgIHJvdy5hcHBlbmRDaGlsZChnbHlwaChlbnRyeSkpO1xyXG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcclxuICAgIHJldHVybiByb3c7XHJcbn1cclxuXHJcbi8vIENvbGxhcHNlIHN0YXRlLCBwZXIgY29udGFpbmVyIHJhdGhlciB0aGFuIG1vZHVsZSBzY29wZTogdGhlIHNpZGViYXIga2V5cyBpdHNcclxuLy8gY29sbGFwc2VkUGF0aHMgYXQgbW9kdWxlIGxldmVsIGFuZCB0d28gbWFwcyBvbiBvbmUgcGFnZSBzaGFyZSBpdCAtLSBhIGZpbGVkIGJ1Z1xyXG4vLyB0aGlzIGRlbGliZXJhdGVseSBkb2VzIG5vdCBpbmhlcml0LiBLZXllZCBieSBncm91cCBuYW1lLCBzdXJ2aXZpbmcgdGhlIGZ1bGxcclxuLy8gcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXHJcbmNvbnN0IGNvbGxhcHNlZEJ5Q29udGFpbmVyID0gbmV3IFdlYWtNYXAoKTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnRhaW5lci5pbm5lckhUTUwgPSBcIlwiO1xyXG4gICAgY29uc3QgZGltSGlkZGVuID0gb3B0aW9ucy5kaW1IaWRkZW4gIT09IGZhbHNlO1xyXG4gICAgbGV0IGNvbGxhcHNlZCA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xyXG4gICAgaWYgKCFjb2xsYXBzZWQpIHtcclxuICAgICAgICBjb2xsYXBzZWQgPSBuZXcgU2V0KCk7XHJcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgY29sbGFwc2VkKTtcclxuICAgIH1cclxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChkaXYoe1xyXG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxyXG4gICAgICAgIHBhZGRpbmdCb3R0b206IFwiNHB4XCIsIG1hcmdpbkJvdHRvbTogXCI0cHhcIixcclxuICAgIH0sIHNwZWMudGl0bGUpKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIHNwZWMuZ3JvdXBzKSB7XHJcbiAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBncm91cC5uYW1lICYmIGNvbGxhcHNlZC5oYXMoZ3JvdXAubmFtZSk7XHJcbiAgICAgICAgaWYgKGdyb3VwLm5hbWUpIHtcclxuICAgICAgICAgICAgLy8gVGhlIHNpZGViYXIncyBhZmZvcmRhbmNlIGV4YWN0bHk6IGFuIGFycm93IHRoYXQgZm9sZHMgdGhlIHNlY3Rpb24uXHJcbiAgICAgICAgICAgIGNvbnN0IGhlYWRlciA9IGRpdih7IGZvbnRXZWlnaHQ6IFwiYm9sZFwiLCBtYXJnaW5Ub3A6IFwiNnB4XCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsIHVzZXJTZWxlY3Q6IFwibm9uZVwiIH0pO1xyXG4gICAgICAgICAgICBoZWFkZXIudGV4dENvbnRlbnQgPSBgJHtpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwifSAke2dyb3VwLm5hbWV9YDtcclxuICAgICAgICAgICAgaGVhZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKSkgY29sbGFwc2VkLmRlbGV0ZShncm91cC5uYW1lKTtcclxuICAgICAgICAgICAgICAgIGVsc2UgY29sbGFwc2VkLmFkZChncm91cC5uYW1lKTtcclxuICAgICAgICAgICAgICAgIHJlbmRlckxlZ2VuZChjb250YWluZXIsIHNwZWMsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGhlYWRlcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChpc0NvbGxhcHNlZCkgY29udGludWU7XHJcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBncm91cC5lbnRyaWVzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJvdyA9IGVudHJ5LmtpbmQgPT09IFwicmFtcFwiID8gcmFtcFJvdyhlbnRyeSlcclxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxyXG4gICAgICAgICAgICAgICAgOiBlbnRyeS5raW5kID09PSBcImJpbnNcIiA/IGJpbnNSb3coZW50cnkpXHJcbiAgICAgICAgICAgICAgICA6IGVudHJ5LmtpbmQgPT09IFwic2l6ZXNcIiA/IHNpemVzUm93KGVudHJ5KVxyXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hSb3coZW50cnkpO1xyXG4gICAgICAgICAgICAvLyBEaW1tZWQsIG5vdCBkcm9wcGVkOiB1bmRlciBzY29wZSBcImFsbFwiIHRoZSBsZWdlbmQgaXMgdGhlIG1hcCdzIHdob2xlXHJcbiAgICAgICAgICAgIC8vIHZvY2FidWxhcnksIGFuZCB0aGUgZGltIGlzIHdoYXQgc3RpbGwgdGVsbHMgdGhlIGN1cnJlbnQgc2NyZWVuIHN0YXRlLlxyXG4gICAgICAgICAgICBpZiAoZW50cnkuaGlkZGVuICYmIGRpbUhpZGRlbikgcm93LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQocm93KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29udGFpbmVyO1xyXG59XHJcbiIsICJpbXBvcnQgeyBMIH0gZnJvbSBcIi4vbGlicy5qc1wiO1xyXG5cclxuLy8gVGhlIHVuaW9uIG9mIGV2ZXJ5IGxheWVyJ3MgcmVjb3JkZWQgYm91bmRzLCBncm91cHMgaW5jbHVkZWQgLS0gdGhlIHNhbWUgYm94XHJcbi8vIFB5dGhvbidzIGF1dG8tZml0IGdyb3dzIHBlciBhZGQuIExheWVycyB3aXRob3V0IGJvdW5kcyAoYmFzZW1hcHMpIGNvbnRyaWJ1dGVcclxuLy8gbm90aGluZzsgbnVsbCB3aGVuIG5vdGhpbmcgY2FycmllcyBhbnkuXHJcbmV4cG9ydCBmdW5jdGlvbiBsYXllcnNCb3VuZHNVbmlvbihsYXllcnMsIGFjYyA9IG51bGwpIHtcclxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzIHx8IFtdKSB7XHJcbiAgICAgICAgY29uc3QgYiA9IGxheWVyICYmIGxheWVyLmJvdW5kcztcclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShiKSAmJiBiLmxlbmd0aCA9PT0gMikge1xyXG4gICAgICAgICAgICBhY2MgPSBhY2NcclxuICAgICAgICAgICAgICAgID8gW1tNYXRoLm1pbihhY2NbMF1bMF0sIGJbMF1bMF0pLCBNYXRoLm1pbihhY2NbMF1bMV0sIGJbMF1bMV0pXSxcclxuICAgICAgICAgICAgICAgICAgIFtNYXRoLm1heChhY2NbMV1bMF0sIGJbMV1bMF0pLCBNYXRoLm1heChhY2NbMV1bMV0sIGJbMV1bMV0pXV1cclxuICAgICAgICAgICAgICAgIDogW1tiWzBdWzBdLCBiWzBdWzFdXSwgW2JbMV1bMF0sIGJbMV1bMV1dXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGxheWVyICYmIEFycmF5LmlzQXJyYXkobGF5ZXIubGF5ZXJzKSkgYWNjID0gbGF5ZXJzQm91bmRzVW5pb24obGF5ZXIubGF5ZXJzLCBhY2MpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGFjYztcclxufVxyXG5leHBvcnQgZnVuY3Rpb24gbG9hZENTUyhpZCwgdXJsKSB7XHJcbiAgICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xyXG4gICAgICAgIGNvbnN0IGxpbmsgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwibGlua1wiKTtcclxuICAgICAgICBsaW5rLmlkID0gaWQ7XHJcbiAgICAgICAgbGluay5yZWwgPSBcInN0eWxlc2hlZXRcIjtcclxuICAgICAgICBsaW5rLmhyZWYgPSB1cmw7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChsaW5rKTtcclxuICAgIH1cclxufVxyXG5cclxuY29uc3QgYWN0aXZlTG9hZGVycyA9IHt9O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKUyhpZCwgdXJsKSB7XHJcbiAgICBpZiAoYWN0aXZlTG9hZGVyc1tpZF0pIHtcclxuICAgICAgICByZXR1cm4gYWN0aXZlTG9hZGVyc1tpZF07XHJcbiAgICB9XHJcbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcclxuICAgICAgICAgICAgcmVzb2x2ZSgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzY3JpcHRcIik7XHJcbiAgICAgICAgc2NyaXB0LmlkID0gaWQ7XHJcbiAgICAgICAgc2NyaXB0LnNyYyA9IHVybDtcclxuICAgICAgICBzY3JpcHQub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xyXG4gICAgICAgIHNjcmlwdC5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgc2NyaXB0OiAke3VybH1gKSk7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzY3JpcHQpO1xyXG4gICAgfSk7XHJcbiAgICBhY3RpdmVMb2FkZXJzW2lkXSA9IHByb21pc2U7XHJcbiAgICByZXR1cm4gcHJvbWlzZTtcclxufVxyXG5cclxuZnVuY3Rpb24gaGV4VG9SZ2IoaGV4KSB7XHJcbiAgICBpZiAoIWhleCkgcmV0dXJuIG51bGw7XHJcbiAgICBoZXggPSBoZXgucmVwbGFjZSgvXiMvLCAnJyk7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA9PT0gMykge1xyXG4gICAgICAgIGhleCA9IGhleC5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhciArIGNoYXIpLmpvaW4oJycpO1xyXG4gICAgfVxyXG4gICAgaWYgKGhleC5sZW5ndGggIT09IDYpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3QgbnVtID0gcGFyc2VJbnQoaGV4LCAxNik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIHI6ICgobnVtID4+IDE2KSAmIDI1NSkgLyAyNTUsXHJcbiAgICAgICAgZzogKChudW0gPj4gOCkgJiAyNTUpIC8gMjU1LFxyXG4gICAgICAgIGI6IChudW0gJiAyNTUpIC8gMjU1XHJcbiAgICB9O1xyXG59XHJcblxyXG5sZXQgY29sb3JQcm9iZSA9IG51bGw7XHJcblxyXG4vLyBCcm93c2VycyBzaGlwIGEgY29tcGxldGUgQ1NTIGNvbG9yIHBhcnNlciAtLSBldmVyeSBuYW1lZCBjb2xvciwgcmdiKCksIGhzbCgpLCBod2IoKS5cclxuLy8gQm9ycm93IGl0IGluc3RlYWQgb2YgbWFpbnRhaW5pbmcgYSBsb29rdXAgdGFibGUuIFJldHVybnMgbnVsbCBvdXRzaWRlIGEgRE9NIChOb2RlIHRlc3RzKSxcclxuLy8gd2hlcmUgdGhlIGhleCBmYWxsYmFjayBpbiBwYXJzZUNvbG9yIHN0aWxsIGFwcGxpZXMuXHJcbmZ1bmN0aW9uIGNzc0NvbG9yVG9SZ2IodmFsdWUpIHtcclxuICAgIGlmICh0eXBlb2YgZG9jdW1lbnQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsO1xyXG4gICAgaWYgKCFjb2xvclByb2JlKSBjb2xvclByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKS5nZXRDb250ZXh0KFwiMmRcIik7XHJcblxyXG4gICAgLy8gQXNzaWduaW5nIGFuIGludmFsaWQgY29sb3IgbGVhdmVzIGZpbGxTdHlsZSB1bnRvdWNoZWQsIHNvIHByb2JlIGFnYWluc3QgdHdvIGRpZmZlcmVudFxyXG4gICAgLy8gc2VudGluZWxzOiBvbmx5IGEgdmFsdWUgdGhlIGJyb3dzZXIgYWN0dWFsbHkgcGFyc2VkIHByb2R1Y2VzIHRoZSBzYW1lIHJlc3VsdCB0d2ljZS5cclxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjMDAwMDAwXCI7XHJcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xyXG4gICAgY29uc3QgZmlyc3QgPSBjb2xvclByb2JlLmZpbGxTdHlsZTtcclxuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gXCIjZmZmZmZmXCI7XHJcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xyXG4gICAgaWYgKGZpcnN0ICE9PSBjb2xvclByb2JlLmZpbGxTdHlsZSkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgaWYgKGZpcnN0LnN0YXJ0c1dpdGgoXCIjXCIpKSByZXR1cm4gaGV4VG9SZ2IoZmlyc3QpO1xyXG4gICAgY29uc3QgbWF0Y2ggPSBmaXJzdC5tYXRjaCgvcmdiYT9cXCgoW14pXSspXFwpLyk7XHJcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IHBhcnRzID0gbWF0Y2hbMV0uc3BsaXQoXCIsXCIpLm1hcChwID0+IHBhcnNlRmxvYXQocC50cmltKCkpKTtcclxuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzIHx8IHBhcnRzLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4geyByOiBwYXJ0c1swXSAvIDI1NSwgZzogcGFydHNbMV0gLyAyNTUsIGI6IHBhcnRzWzJdIC8gMjU1IH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbG9yKGNvbG9yU3RyLCBmYWxsYmFja0hleCA9IFwiIzMzODhmZlwiKSB7XHJcbiAgICBpZiAoIWNvbG9yU3RyKSBjb2xvclN0ciA9IGZhbGxiYWNrSGV4O1xyXG4gICAgcmV0dXJuIGNzc0NvbG9yVG9SZ2IoY29sb3JTdHIpXHJcbiAgICAgICAgfHwgaGV4VG9SZ2IoY29sb3JTdHIpXHJcbiAgICAgICAgfHwgY3NzQ29sb3JUb1JnYihmYWxsYmFja0hleClcclxuICAgICAgICB8fCBoZXhUb1JnYihmYWxsYmFja0hleClcclxuICAgICAgICB8fCB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxufVxyXG5cclxuY29uc3QgVVJMX0FUVFJfQkVGT1JFID0gLyg/OmhyZWZ8c3JjKVxccyo9XFxzKlsnXCJdPyQvaTtcclxuY29uc3QgU0FGRV9VUkwgPSAvXig/Omh0dHBzPzpcXC9cXC98bWFpbHRvOnx0ZWw6fGRhdGE6aW1hZ2VcXC98Wy4vIz9dfFtcXHcuLV0rKD86Wy8/I118JCkpL2k7XHJcblxyXG4vLyBQcm9wZXJ0eSB2YWx1ZXMgY29tZSBmcm9tIHVzZXIgZGF0YSBhbmQgZW5kIHVwIGluIGlubmVySFRNTCwgc28gdGhleSBhcmUgZXNjYXBlZC5cclxuLy8gTWFya3VwIHRoZSBhcHAgYXV0aG9yIHdyb3RlICh0ZW1wbGF0ZXMsIHN0eWxlIHN0cmluZ3MpIGlzIGxlZnQgaW50YWN0LlxyXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xyXG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSlcclxuICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoL1wiL2csIFwiJnF1b3Q7XCIpXHJcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcclxufVxyXG5cclxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXHJcbi8vIGluIGEgVVJMIGF0dHJpYnV0ZSBnZXQgYSBzY2hlbWUgY2hlY2suIENvbnRyb2wgY2hhcmFjdGVycyBhcmUgc3RyaXBwZWQgZmlyc3QgYmVjYXVzZVxyXG4vLyBcImphdmFcXHRzY3JpcHQ6XCIgc3Vydml2ZXMgYSBuYWl2ZSBjb21wYXJpc29uLlxyXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZSkge1xyXG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcclxuICAgIHJldHVybiBTQUZFX1VSTC50ZXN0KGNvbGxhcHNlZCkgPyBTdHJpbmcodmFsdWUpIDogXCJcIjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XHJcbiAgICBjb25zdCB0YXJnZXRGaWVsZHMgPSAoQXJyYXkuaXNBcnJheShmaWVsZHMpICYmIGZpZWxkcy5sZW5ndGgpID8gZmllbGRzIDogT2JqZWN0LmtleXMocHJvcHMpO1xyXG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcclxuICAgIGNvbnN0IGxpbmVzID0gW107XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldEZpZWxkcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XHJcbiAgICAgICAgaWYgKHByb3BzW2ZdID09PSB1bmRlZmluZWQgfHwgcHJvcHNbZl0gPT09IG51bGwpIGNvbnRpbnVlO1xyXG4gICAgICAgIGxpbmVzLnB1c2goYDxiPiR7ZXNjYXBlSHRtbChsYWJlbHNbaV0pfTwvYj46ICR7ZXNjYXBlSHRtbChwcm9wc1tmXSl9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbGluZXMuam9pbihcIjxicj5cIik7XHJcbn1cclxuXHJcbi8vIFwie2NvbHVtbn1cIiBpbnNlcnRzIG9uZSBlc2NhcGVkIHZhbHVlOyBcInsqfVwiIGluc2VydHMgdGhlIGRlZmF1bHQgZmllbGQgbGlzdC5cclxuZnVuY3Rpb24gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XHJcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XHJcbiAgICAgICAgaWYgKGtleSA9PT0gXCIqXCIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcHNba2V5XTtcclxuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSByZXR1cm4gXCJcIjtcclxuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XHJcbiAgICAgICAgcmV0dXJuIGVzY2FwZUh0bWwoVVJMX0FUVFJfQkVGT1JFLnRlc3QocHJlY2VkaW5nKSA/IHNhZmVVcmwodmFsKSA6IHZhbCk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBraW5kKSB7XHJcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGxheWVyW2tpbmQgKyBcIl90ZW1wbGF0ZVwiXTtcclxuICAgIGNvbnN0IGZpZWxkcyA9IGxheWVyW2tpbmQgKyBcIl9maWVsZHNcIl07XHJcbiAgICBjb25zdCBuYW1lcyA9IGxheWVyW2tpbmQgKyBcIl9uYW1lc1wiXTtcclxuICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgPT09IFwic3RyaW5nXCIgJiYgdGVtcGxhdGUpIHtcclxuICAgICAgICByZXR1cm4gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcclxuICAgIH1cclxuICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHdyYXBTdHlsZWQoaHRtbCwgc3R5bGUpIHtcclxuICAgIGlmICghc3R5bGUpIHJldHVybiBodG1sO1xyXG4gICAgcmV0dXJuIGA8ZGl2IHN0eWxlPVwiJHtlc2NhcGVIdG1sKHN0eWxlKX1cIj4ke2h0bWx9PC9kaXY+YDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQb3B1cChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyKSB7XHJcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwicG9wdXBcIik7XHJcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfcG9wdXAgfHwgbGF5ZXIucG9wdXBfZmllbGRzIHx8IGxheWVyLnBvcHVwX3RlbXBsYXRlKSkge1xyXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcclxuICAgICAgICBpZiAobGF5ZXIucG9wdXBfbWF4X3dpZHRoKSBvcHRpb25zLm1heFdpZHRoID0gbGF5ZXIucG9wdXBfbWF4X3dpZHRoO1xyXG4gICAgICAgIEwucG9wdXAob3B0aW9ucylcclxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXHJcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIucG9wdXBfc3R5bGUpKVxyXG4gICAgICAgICAgICAub3Blbk9uKG1hcCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBiaW5kVG9vbHRpcChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyLCBsYXllckluc3RhbmNlKSB7XHJcbiAgICBjb25zdCBodG1sID0gcmVuZGVyQ29udGVudChwcm9wcywgbGF5ZXIsIFwidG9vbHRpcFwiKTtcclxuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF90b29sdGlwIHx8IGxheWVyLnRvb2x0aXBfZmllbGRzIHx8IGxheWVyLnRvb2x0aXBfdGVtcGxhdGUpKSB7XHJcbiAgICAgICAgaWYgKCFsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXAgPSBMLnRvb2x0aXAoeyBkaXJlY3Rpb246ICd0b3AnLCBvZmZzZXQ6IFswLCAtNV0gfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXBcclxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXHJcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIudG9vbHRpcF9zdHlsZSkpXHJcbiAgICAgICAgICAgIC5hZGRUbyhtYXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cclxuLy9cclxuLy8gVGlja3MgYXJlIGdlbmVyYXRlZCBmcm9tIGFuIElTTzg2MDEgcGVyaW9kIHJhdGhlciB0aGFuIHRha2VuIGZyb20gdGhlIG9ic2VydmVkXHJcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxyXG4vLyBlbXB0eSBtYXAgYXQgMDM6MDAgcmVhZHMgYXMgYWJzZW5jZSByYXRoZXIgdGhhbiB0aGUgc2xpZGVyIHNraXBwaW5nIHRoZSBxdWlldCBob3Vycy5cclxuLy9cclxuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXHJcbi8vIGludG8gYSB0aW1lIG1vZGVsLCBhIGNvbnRyb2wsIGFuZCBwZXItbGF5ZXIgYWRhcHRlcnMgdGhhdCByZS1yZW5kZXIgR2VvSlNPTiBwZXIgdGljayAtLVxyXG4vLyB0aGUgYWRhcHRlcnMgYXJlIHVudXNhYmxlIGFnYWluc3QgV2ViR0wgbGF5ZXJzLCB0aGUgbW9kZWwgaXMgYSBmZXcgZG96ZW4gbGluZXMsIGFuZCB0aGVcclxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xyXG4vLyBjYXJyaWVkIGFjcm9zcyBieSBoYW5kLlxyXG5cclxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gTWlycm9ycyBpc192YWxpZF9wZXJpb2QoKSBpbiBzd2lmdG1hcC9sYXllcnMvX3RpbWUucHk7IHRoZSBncmFtbWFyIG11c3Qgbm90IGRyaWZ0LlxyXG5jb25zdCBQRVJJT0RfUkUgPVxyXG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUGVyaW9kKHRleHQpIHtcclxuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xyXG4gICAgaWYgKCFtKSByZXR1cm4gbnVsbDtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcclxuICAgICAgICBob3VyczogKyhtWzVdIHx8IDApLCBtaW51dGVzOiArKG1bNl0gfHwgMCksIHNlY29uZHM6ICsobVs3XSB8fCAwKSxcclxuICAgIH07XHJcbn1cclxuXHJcbi8vIFllYXJzIGFuZCBtb250aHMgbW92ZSB0aHJvdWdoIHRoZSBVVEMgY2FsZW5kYXIgLS0gUDFNIGZyb20gSmFuIDMxIGxhbmRzIHdoZXJlIERhdGVcclxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cclxuZXhwb3J0IGZ1bmN0aW9uIGFkZFBlcmlvZChtcywgcCwgc2lnbiA9IDEpIHtcclxuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShtcyk7XHJcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XHJcbiAgICBpZiAocC5tb250aHMpIGQuc2V0VVRDTW9udGgoZC5nZXRVVENNb250aCgpICsgc2lnbiAqIHAubW9udGhzKTtcclxuICAgIHJldHVybiBkLmdldFRpbWUoKSArIHNpZ24gKiAoKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDBcclxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XHJcbn1cclxuXHJcbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXHJcbi8vIGZpbmFsIG9uZSwgb25lIHBlciBwZXJpb2QuIENhcHBlZCBiZWNhdXNlIGEgbWlzdHlwZWQgUFQxUyBvdmVyIGEgeWVhciBvZiBkYXRhXHJcbi8vIHdvdWxkIG90aGVyd2lzZSBoYW5nIHRoZSB0YWIgYnVpbGRpbmcgYW4gYXJyYXkgb2YgbWlsbGlvbnMuXHJcbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xyXG5cclxuLy8gLS0tIHBlcmlvZCBib3VuZGFyaWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gVGlja3MgYW5jaG9yIHRvIFBFUklPRCBCT1VOREFSSUVTLCBub3QgdG8gdGhlIGRhdGEuIFRoZSBmaXJzdCB0aWNrIGlzIHRoZSBmaXJzdFxyXG4vLyBib3VuZGFyeSBhdCBvciBhZnRlciB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24sIHNvIHRoZSBlYXJsaWVzdCBwb2ludCBzdGlsbCBmYWxsc1xyXG4vLyBpbnNpZGUgdGhlIGhhbGYtb3BlbiB3aW5kb3cgKGZpcnN0VGljayAtIFAsIGZpcnN0VGlja10gLS0gdGhlIGNvbnN0cmFpbnQgdGhhdCBwdXRcclxuLy8gdGhlIGZpcnN0IHRpY2sgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIGhvbGRzIC0tIHdoaWxlIGRhdGEgYXJyaXZpbmcgRUFSTElFUlxyXG4vLyBvbmx5IHByZXBlbmRzIGJvdW5kYXJpZXMgYW5kIG1vdmVzIG5vdGhpbmcgYSB1c2VyIG5vdGVkLiAoQW5jaG9yZWQgdG8gdGhlIGRhdGEsXHJcbi8vIGEgbGF0ZSBvYnNlcnZhdGlvbiBzaGlmdGVkIGV2ZXJ5IHRpY2sgYnkgdGhlIHJlbWFpbmRlciBhbmQgdGhlIG1vbWVudCB0aGUgdXNlclxyXG4vLyB3YXMgbG9va2luZyBhdCBiZWNhbWUgYSBkaWZmZXJlbnQgdGljay4pIFJvdW5kIHRpbWVzIGZhbGwgb3V0IGZvciBmcmVlOiAwMzowMCxcclxuLy8gMDQ6MDAgZm9yIFBUMUgsIG5ldmVyIDAzOjE3LlxyXG4vL1xyXG4vLyBGaXhlZC13aWR0aCBwZXJpb2RzIGFsaWduIHRvIGVwb2NoIG11bHRpcGxlcywgd2Vla3MgdG8gTW9uZGF5IDAwOjAwIFVUQy4gTW9udGhzXHJcbi8vIGFuZCB5ZWFycyBhbGlnbiB0byBtb250aC95ZWFyIHN0YXJ0cyBpbiB0aGUgVVRDIGNhbGVuZGFyLCBpbiBtdWx0aXBsZXMgb2YgdGhlXHJcbi8vIHBlcmlvZCBjb3VudGVkIGZyb20geWVhciAwIChQM006IHF1YXJ0ZXJzKS4gQSBwZXJpb2QgbWl4aW5nIGNhbGVuZGFyIGFuZCBjbG9ja1xyXG4vLyB1bml0cyAoUDFNMUQpIGhhcyBubyBzZW5zaWJsZSBib3VuZGFyeSBncmlkLCBzbyB0aGF0IG9uZSBhbG9uZSBrZWVwcyB0aGUgb2xkXHJcbi8vIGJlaGF2aW91cjogaXRzIGZpcnN0IHRpY2sgc2l0cyBhdCB0aGUgZWFybGllc3Qgb2JzZXJ2YXRpb24uXHJcbmNvbnN0IE1PTkRBWV9FUE9DSCA9IERhdGUuVVRDKDE5NzAsIDAsIDUpO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGFsaWduVG9QZXJpb2QobXMsIHApIHtcclxuICAgIGNvbnN0IGZpeGVkID0gcGVyaW9kVG9NcyhwKTtcclxuICAgIGNvbnN0IGhhc0Nsb2NrID0gQm9vbGVhbihwLndlZWtzIHx8IHAuZGF5cyB8fCBwLmhvdXJzIHx8IHAubWludXRlcyB8fCBwLnNlY29uZHMpO1xyXG4gICAgaWYgKGZpeGVkKSB7XHJcbiAgICAgICAgY29uc3Qgd2hvbGVXZWVrcyA9IHAud2Vla3MgJiYgIXAuZGF5cyAmJiAhcC5ob3VycyAmJiAhcC5taW51dGVzICYmICFwLnNlY29uZHM7XHJcbiAgICAgICAgY29uc3Qgb3JpZ2luID0gd2hvbGVXZWVrcyA/IE1PTkRBWV9FUE9DSCA6IDA7XHJcbiAgICAgICAgcmV0dXJuIG9yaWdpbiArIE1hdGguY2VpbCgobXMgLSBvcmlnaW4pIC8gZml4ZWQpICogZml4ZWQ7XHJcbiAgICB9XHJcbiAgICBpZiAoKHAueWVhcnMgfHwgcC5tb250aHMpICYmICFoYXNDbG9jaykge1xyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBwLnllYXJzICogMTIgKyBwLm1vbnRocztcclxuICAgICAgICBjb25zdCBkID0gbmV3IERhdGUobXMpO1xyXG4gICAgICAgIGxldCBpbmRleCA9IGQuZ2V0VVRDRnVsbFllYXIoKSAqIDEyICsgZC5nZXRVVENNb250aCgpO1xyXG4gICAgICAgIGlmIChEYXRlLlVUQyhkLmdldFVUQ0Z1bGxZZWFyKCksIGQuZ2V0VVRDTW9udGgoKSwgMSkgPCBtcykgaW5kZXggKz0gMTtcclxuICAgICAgICBpbmRleCA9IE1hdGguY2VpbChpbmRleCAvIHNwYW4pICogc3BhbjtcclxuICAgICAgICByZXR1cm4gRGF0ZS5VVEMoTWF0aC5mbG9vcihpbmRleCAvIDEyKSwgaW5kZXggJSAxMiwgMSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbXM7XHJcbn1cclxuXHJcbi8vIFRoZSB0aWNrIG5lYXJlc3QgdG8gYW4gYWJzb2x1dGUgbW9tZW50IC0tIGhvdyB0aGUgcGxheWhlYWQgc3Vydml2ZXMgYSByZS1nZW5lcmF0ZWRcclxuLy8gc2VyaWVzOiBpdCBpcyBhIE1PTUVOVCB0aGUgdXNlciBjaG9zZSwgbmV2ZXIgYW4gaW5kZXggaW50byBhIGxpc3QgdGhhdCBqdXN0IGdyZXcuXHJcbmV4cG9ydCBmdW5jdGlvbiBuZWFyZXN0VGlja0luZGV4KHRpY2tzLCBtb21lbnQpIHtcclxuICAgIGlmICghdGlja3MubGVuZ3RoIHx8ICFOdW1iZXIuaXNGaW5pdGUobW9tZW50KSkgcmV0dXJuIDA7XHJcbiAgICBsZXQgYmVzdCA9IDA7XHJcbiAgICBsZXQgYmVzdERpc3RhbmNlID0gSW5maW5pdHk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpY2tzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZGlzdGFuY2UgPSBNYXRoLmFicyh0aWNrc1tpXSAtIG1vbWVudCk7XHJcbiAgICAgICAgaWYgKGRpc3RhbmNlIDwgYmVzdERpc3RhbmNlKSB7XHJcbiAgICAgICAgICAgIGJlc3QgPSBpO1xyXG4gICAgICAgICAgICBiZXN0RGlzdGFuY2UgPSBkaXN0YW5jZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYmVzdDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlVGlja3Moc3RhcnRNcywgZW5kTXMsIHApIHtcclxuICAgIGNvbnN0IGZpcnN0ID0gYWxpZ25Ub1BlcmlvZChzdGFydE1zLCBwKTtcclxuICAgIGNvbnN0IHRpY2tzID0gW2ZpcnN0XTtcclxuICAgIGxldCB0ID0gZmlyc3Q7XHJcbiAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xyXG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xyXG4gICAgICAgIHQgPSBhZGRQZXJpb2QodCwgcCk7XHJcbiAgICAgICAgdGlja3MucHVzaCh0KTtcclxuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIHRpbWUgc2xpZGVyIGNhcHBlZCBhdCAke01BWF9USUNLU30gdGlja3M7IGAgK1xyXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XHJcbiAgICByZXR1cm4gdGlja3M7XHJcbn1cclxuXHJcbi8vIC0tLSB3aW5kb3dzIGFuZCBmaWx0ZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2VcclxuLy8gaXMgdmlzaWJsZTsgbnVsbCBhY2N1bXVsYXRlcyBldmVyeXRoaW5nIHNvIGZhcjsgYW4gSVNPIHN0cmluZyB0cmFpbHMgYSBmaXhlZCB3aW5kb3cuXHJcbmV4cG9ydCBmdW5jdGlvbiB3aW5kb3dGb3IodGljaywgZHVyYXRpb25TcGVjLCBwZXJpb2QpIHtcclxuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4geyBzdGFydDogLUluZmluaXR5LCBlbmQ6IHRpY2sgfTtcclxuICAgIH1cclxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xyXG4gICAgaWYgKCFwKSByZXR1cm4geyBzdGFydDogLUluZmluaXR5LCBlbmQ6IHRpY2sgfTtcclxuICAgIHJldHVybiB7IHN0YXJ0OiBhZGRQZXJpb2QodGljaywgcCwgLTEpLCBlbmQ6IHRpY2sgfTtcclxufVxyXG5cclxuLy8gSGFsZi1vcGVuIChzdGFydCwgZW5kXTogYSBmZWF0dXJlIHN0YW1wZWQgZXhhY3RseSBvbiBhIHRpY2sgYm91bmRhcnkgYmVsb25ncyB0byB0aGVcclxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcclxuLy8gZmVhdHVyZXMgdGhhdCBjYXJyaWVkIG5vIHJlYWRhYmxlIHRpbWU7IHRoZXkgc3RheSB2aXNpYmxlIHJhdGhlciB0aGFuIHZhbmlzaGluZy5cclxuZXhwb3J0IGZ1bmN0aW9uIGZlYXR1cmVJbldpbmRvdyhzdGFydE1zLCBlbmRNcywgd2luKSB7XHJcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcclxuICAgIHJldHVybiBlbmRNcyA+IHdpbi5zdGFydCAmJiBzdGFydE1zIDw9IHdpbi5lbmQ7XHJcbn1cclxuXHJcbi8vIFRpbWVzIHRyYXZlbCBhcyBhIEZsb2F0NjRBcnJheSBvZiBpbnRlcmxlYXZlZCBbc3RhcnQsIGVuZF0gcGFpcnMgaW4gdGhlIGJ1ZmZlciBtYXAsXHJcbi8vIHVuZGVyIFwiPGxheWVyIGlkPjo6dGltZXNcIiAtLSB0aGUgc2FtZSB0cmFuc3BvcnQgY29vcmRpbmF0ZXMgdXNlLlxyXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IHJhdyA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tgJHtsYXllci5pZH06OnRpbWVzYF07XHJcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxufVxyXG5cclxuLy8gV2hhdCByZW5kZXJpbmcgdGhyZWFkcyB0aHJvdWdoOiB0aGUgY3VycmVudCB0aWNrIHBsdXMgdGhlIHNoYXJlZCBwZXJpb2QsIG9yIG51bGwgd2hlblxyXG4vLyBubyBzbGlkZXIgaXMgYWN0aXZlLiBFYWNoIGxheWVyIGRlcml2ZXMgaXRzIG93biB3aW5kb3cgZnJvbSB0aGVzZSwgc2luY2UgZHVyYXRpb24gaXNcclxuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cclxuLy9cclxuLy8gV2hldGhlciBhIHdob2xlIGxheWVyIHNob3dzIGF0IHRoZSBjdXJyZW50IHRpY2suIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lXHJcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcclxuLy8gbm90IHRoZSBzbGlkZXIncyB0byBoaWRlLlxyXG4vLyBUaGUgZHVyYXRpb24gYSBsYXllciBzaG93cyByaWdodCBub3cuIEEgd2luZG93IGRyYWdnZWQgb3V0IG9uIHRoZSBiYXIgaXMgYSB1c2VyXHJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcclxuLy8gdXNlciBncmFicyB0aGUgYmFyLCB0aGUgYmFyIHRlbGxzIHRoZSB0cnV0aCBmb3IgZXZlcnl0aGluZy4gU25hcHBpbmcgdGhlIGhhbmRsZSBiYWNrXHJcbi8vIG9udG8gdGhlIHRodW1iIGNsZWFycyB0aGUgb3ZlcnJpZGUgYW5kIGxheWVycyByZXR1cm4gdG8gdGhlaXIgb3duIHNldHRpbmdzLlxyXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xyXG4gICAgcmV0dXJuIHRpbWVTdGF0ZS53aW5kb3cgfHwgKGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5kdXJhdGlvbik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBsYXllckluV2luZG93KGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghbGF5ZXIudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xyXG4gICAgLy8gQSBwZXItdmVydGV4LXRpbWVkIGxpbmUgaG9sZHMgbWFueSBwYWlyczsgb24gdGhpcyB3aG9sZS1sYXllciBwYXRoIGl0IHNob3dzXHJcbiAgICAvLyB3aGlsZSBBTlkgb2YgdGhlbSBpcyBpbiB0aGUgd2luZG93IC0tIHRoZSBHUFUgcGF0aCBpcyB3aGF0IHRyaW1zIHBlciBzZWdtZW50LlxyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIFRoZSBleHRlbnQgb2YgZXZlcnkgdGltZSBsYXllcidzIG9ic2VydmF0aW9ucywgTmFOLWJsaW5kLiBGZWVkcyB0aWNrIGdlbmVyYXRpb24uXHJcbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcclxuICAgIGxldCBtaW4gPSBJbmZpbml0eSwgbWF4ID0gLUluZmluaXR5O1xyXG4gICAgY29uc3QgdmlzaXQgPSAobGlzdCkgPT4gbGlzdC5mb3JFYWNoKGxheWVyID0+IHtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcclxuICAgICAgICBpZiAoIWxheWVyLnRpbWUpIHJldHVybjtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcclxuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XHJcbiAgICAgICAgICAgIGlmICh0aW1lc1tpICsgMV0gPiBtYXgpIG1heCA9IHRpbWVzW2kgKyAxXTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHZpc2l0KGxheWVycyk7XHJcbiAgICByZXR1cm4gbWluID09PSBJbmZpbml0eSA/IG51bGwgOiB7IG1pbiwgbWF4IH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBoYXNUaW1lTGF5ZXJzKGxheWVycykge1xyXG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcclxuICAgICAgICA/IGhhc1RpbWVMYXllcnMobC5sYXllcnMgfHwgW10pXHJcbiAgICAgICAgOiBCb29sZWFuKGwudGltZSkpO1xyXG59XHJcblxyXG4vLyBPbmUgcGxheWJhY2sgc3RlcDogdGhlIG5leHQgaW5kZXggYW5kIHdoZXRoZXIgcGxheWJhY2sgc3Vydml2ZXMgaXQuIFB1cmUgc28gdGhlIGxvb3BcclxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxyXG4vLyB3aXRob3V0IGxvb3Agc3RvcHMgd2hlcmUgaXQgaXMuXHJcbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlKGluZGV4LCBsZW5ndGgsIGxvb3ApIHtcclxuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcclxuICAgIGlmIChsb29wKSByZXR1cm4geyBpbmRleDogMCwgcGxheWluZzogdHJ1ZSB9O1xyXG4gICAgcmV0dXJuIHsgaW5kZXgsIHBsYXlpbmc6IGZhbHNlIH07XHJcbn1cclxuXHJcbi8vIFdoZXJlIHRoZSBjb250cm9sIHNpdHMsIGFzIGlubGluZSBzdHlsZXMgc28gdGhlIGNob2ljZSB0cmF2ZWxzIHdpdGggdGhlIHN0YXRlIHJhdGhlclxyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cclxuLy8gaW5jbHVkaW5nIHRoZSBvbmVzIGEgcG9zaXRpb24gZG9lcyBub3QgdXNlIC0tIHNvIG1vdmluZyB0aGUgY29udHJvbCBjbGVhcnMgdGhlIG9sZFxyXG4vLyBhbmNob3IgaW5zdGVhZCBvZiBhY2N1bXVsYXRpbmcgYm90aC5cclxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcclxuICAgIFwidG9wLWxlZnRcIjogICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxuICAgIFwidG9wLWNlbnRlclwiOiAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcclxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxuICAgIFwibGVmdC1jZW50ZXJcIjogICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcclxuICAgIFwicmlnaHQtY2VudGVyXCI6ICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcclxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxuICAgIFwiYm90dG9tLWNlbnRlclwiOiB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcclxuICAgIFwiYm90dG9tLXJpZ2h0XCI6ICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcclxufTtcclxuXHJcbmZ1bmN0aW9uIGFwcGx5UG9zaXRpb24oZWwsIHBvc2l0aW9uKSB7XHJcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XHJcbiAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3R5bGVzKSkge1xyXG4gICAgICAgIGVsLnN0eWxlW3Byb3BdID0gdmFsdWU7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xyXG4gICAgcmV0dXJuIG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDE5KS5yZXBsYWNlKFwiVFwiLCBcIiBcIikgKyBcIlpcIjtcclxufVxyXG5cclxuLy8gLS0tIHRoZSB3aW5kb3cgYW5kIHRoZSBydWxlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuLy8gRml4ZWQgbWlsbGlzZWNvbmRzIGZvciBhIHBlcmlvZCwgb3IgbnVsbCB3aGVuIGl0IG1vdmVzIHRocm91Z2ggdGhlIGNhbGVuZGFyIChtb250aHMsXHJcbi8vIHllYXJzKSBhbmQgaGFzIG5vIGZpeGVkIHdpZHRoLiBUaGUgcnVsZXIgYW5kIHRoZSBkcmFnIGdyaWQgbmVlZCBmaXhlZCB3aWR0aHM7IGNhbGVuZGFyXHJcbi8vIHBlcmlvZHMgZmFsbCBiYWNrIHRvIHRoZSB0aWNrIHBvc2l0aW9ucyB0aGVtc2VsdmVzLlxyXG5leHBvcnQgZnVuY3Rpb24gcGVyaW9kVG9NcyhwKSB7XHJcbiAgICBpZiAoIXAgfHwgcC55ZWFycyB8fCBwLm1vbnRocykgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDAgKyBwLmhvdXJzICogMzYwMFxyXG4gICAgICAgICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMDtcclxufVxyXG5cclxuLy8gTWlsbGlzZWNvbmRzIGFzIGFuIElTTzg2MDEgZHVyYXRpb24sIGhvdXJzL21pbnV0ZXMvc2Vjb25kcyBvbmx5IC0tIFBUMjZIIGlzIHZhbGlkIGFuZFxyXG4vLyBhdm9pZHMgY2FsZW5kYXIgdW5pdHMgZW50aXJlbHksIHNvIHdoYXQgdGhlIGRyYWcgd3JpdGVzIGFsd2F5cyBwYXJzZXMgYmFjayBleGFjdGx5LlxyXG5leHBvcnQgZnVuY3Rpb24gbXNUb1BlcmlvZElTTyhtcykge1xyXG4gICAgbGV0IHJlc3QgPSBNYXRoLnJvdW5kKG1zIC8gMTAwMCk7XHJcbiAgICBjb25zdCBoID0gTWF0aC5mbG9vcihyZXN0IC8gMzYwMCk7IHJlc3QgLT0gaCAqIDM2MDA7XHJcbiAgICBjb25zdCBtID0gTWF0aC5mbG9vcihyZXN0IC8gNjApOyByZXN0IC09IG0gKiA2MDtcclxuICAgIGxldCBvdXQgPSBcIlBUXCI7XHJcbiAgICBpZiAoaCkgb3V0ICs9IGAke2h9SGA7XHJcbiAgICBpZiAobSkgb3V0ICs9IGAke219TWA7XHJcbiAgICBpZiAocmVzdCB8fCBvdXQgPT09IFwiUFRcIikgb3V0ICs9IGAke3Jlc3R9U2A7XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBUaGUgcnVsZXIncyBpbmNyZW1lbnQ6IHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBldmVyeSBib3VuZGFyeSB0aGUgdXNlciBjYW4gY2FyZVxyXG4vLyBhYm91dCAtLSB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWQgZHVyYXRpb24uIEFuIGludGVydmFsIG9mIDFoIHdpdGggYVxyXG4vLyAyLjVoIGR1cmF0aW9uIG5lZWRzIDMwLW1pbnV0ZSBtYXJrcyBmb3IgdGhlIGR1cmF0aW9uIHRvIHNpdCBvbiBvbmU7IDFoIGFuZCAyaCBuZWVkIG9ubHlcclxuLy8gdGhlIGhvdXJzLiBcIkxvd2VzdCBkdXJhdGlvblwiIGlzIHRoZSBzcGVjaWFsIGNhc2Ugd2hlcmUgb25lIGRpdmlkZXMgdGhlIG90aGVyLlxyXG5leHBvcnQgZnVuY3Rpb24gZ2NkR3JpZE1zKHBlcmlvZE1zLCBkdXJhdGlvbnNNcykge1xyXG4gICAgY29uc3QgZ2NkID0gKGEsIGIpID0+IChiID8gZ2NkKGIsIGEgJSBiKSA6IGEpO1xyXG4gICAgbGV0IGdyaWQgPSBwZXJpb2RNcztcclxuICAgIGZvciAoY29uc3QgZCBvZiBkdXJhdGlvbnNNcykge1xyXG4gICAgICAgIGlmIChkID4gMCkgZ3JpZCA9IGdjZChncmlkLCBNYXRoLnJvdW5kKGQpKTtcclxuICAgIH1cclxuICAgIHJldHVybiBNYXRoLm1heChncmlkLCAxMDAwKTtcclxufVxyXG5cclxuLy8gRXZlcnkgZmluaXRlIGR1cmF0aW9uIGF0dGFjaGVkIHRvIGEgdGltZSBsYXllciwgaW4gbXMsIGZvciB0aGUgZ3JpZC4gXCJwZXJpb2RcIiBhbmQgbnVsbFxyXG4vLyBjb250cmlidXRlIG5vdGhpbmcgbmV3OyBjYWxlbmRhciBkdXJhdGlvbnMgY2Fubm90IGpvaW4gYSBmaXhlZC1tcyBncmlkIGFuZCBhcmUgc2tpcHBlZC5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllcnMsIHdpbmRvd0lzbykge1xyXG4gICAgY29uc3Qgb3V0ID0gW107XHJcbiAgICBjb25zdCB2aXNpdCA9IGxpc3QgPT4gbGlzdC5mb3JFYWNoKGwgPT4ge1xyXG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIikgcmV0dXJuIHZpc2l0KGwubGF5ZXJzIHx8IFtdKTtcclxuICAgICAgICBjb25zdCBzcGVjID0gbC50aW1lICYmIGwudGltZS5kdXJhdGlvbjtcclxuICAgICAgICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgJiYgc3BlYyAhPT0gXCJwZXJpb2RcIikge1xyXG4gICAgICAgICAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xyXG4gICAgICAgICAgICBpZiAobXMpIG91dC5wdXNoKG1zKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHZpc2l0KGxheWVycyk7XHJcbiAgICBpZiAod2luZG93SXNvKSB7XHJcbiAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHdpbmRvd0lzbykpO1xyXG4gICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG91dDtcclxufVxyXG5cclxuLy8gVGljayBtYXJrcyBmb3IgdGhlIHRyYWNrOiBtYWpvcnMgYXQgZXZlcnkgaW50ZXJ2YWwgYm91bmRhcnkgKHNwYXJzZWx5IGxhYmVsbGVkIHNvIGxvbmdcclxuLy8gdGltZWxpbmVzIHN0YXkgcmVhZGFibGUpLCB1bmxhYmVsbGVkIG1pbm9ycyBhdCB0aGUgZ3JpZCBpbiBiZXR3ZWVuLiBNaW5vciBESVNQTEFZIGlzXHJcbi8vIHRoaW5uZWQgd2hlbiBkZW5zZTsgdGhlIHNuYXAgZ3JpZCBzdGF5cyBleGFjdCwgc28gYSBtYXJrIGlzIGEgZ3VpZGUsIG5vdCBhIGNvbnN0cmFpbnQuXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJ1bGVyKHRpY2tzLCBncmlkTXMsIGZvcm1hdExhYmVsLCB7IG1heExhYmVscyA9IDYsIG1heE1pbm9ycyA9IDI0MCB9ID0ge30pIHtcclxuICAgIGlmICh0aWNrcy5sZW5ndGggPCAyKSByZXR1cm4gW107XHJcbiAgICBjb25zdCB0MCA9IHRpY2tzWzBdLCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcclxuICAgIGNvbnN0IG1hcmtzID0gW107XHJcbiAgICBjb25zdCBsYWJlbEV2ZXJ5ID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRpY2tzLmxlbmd0aCAvIG1heExhYmVscykpO1xyXG4gICAgdGlja3MuZm9yRWFjaCgodCwgaSkgPT4gbWFya3MucHVzaCh7XHJcbiAgICAgICAgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IHRydWUsXHJcbiAgICAgICAgbGFiZWw6IGkgJSBsYWJlbEV2ZXJ5ID09PSAwID8gZm9ybWF0TGFiZWwodCkgOiBudWxsLFxyXG4gICAgfSkpO1xyXG4gICAgaWYgKGdyaWRNcyAmJiBncmlkTXMgPCBzcGFuKSB7XHJcbiAgICAgICAgY29uc3QgdG90YWwgPSBNYXRoLmZsb29yKHNwYW4gLyBncmlkTXMpO1xyXG4gICAgICAgIGNvbnN0IHRoaW4gPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodG90YWwgLyBtYXhNaW5vcnMpKTtcclxuICAgICAgICBmb3IgKGxldCBrID0gMTsgayAqIGdyaWRNcyA8IHNwYW47IGsgKz0gdGhpbikge1xyXG4gICAgICAgICAgICBjb25zdCB0ID0gdDAgKyBrICogZ3JpZE1zO1xyXG4gICAgICAgICAgICBpZiAodGlja3MuaW5jbHVkZXModCkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBtYXJrcy5wdXNoKHsgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IGZhbHNlLCBsYWJlbDogbnVsbCB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbWFya3M7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRUaWNrTGFiZWwobXMsIHBlcmlvZE1zKSB7XHJcbiAgICBjb25zdCBpc28gPSBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKTtcclxuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgNjAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxOSk7XHJcbiAgICBpZiAocGVyaW9kTXMgIT0gbnVsbCAmJiBwZXJpb2RNcyA8IDI0ICogMzYwMCAqIDEwMDApIHJldHVybiBpc28uc2xpY2UoMTEsIDE2KTtcclxuICAgIHJldHVybiBpc28uc2xpY2UoNSwgMTApO1xyXG59XHJcblxyXG4vLyBHbHlwaHMgYXMgaW5saW5lIFNWRyByYXRoZXIgdGhhbiB0ZXh0OiBcIlx1MjFCQlwiIHJlYWRzIGFzIHJlZnJlc2ggLS0gYSBsb29wIHRvZ2dsZSBkcmF3biB3aXRoXHJcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xyXG4vLyB0aGUgcHJlc3NlZCBzdGF0ZSByZXN0eWxlIHRoZW0gZnJvbSBDU1MuXHJcbmNvbnN0IElDT05TID0ge1xyXG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcclxuICAgIHBsYXk6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJsOSA2LTkgNnpcIi8+PC9zdmc+JyxcclxuICAgIHBhdXNlOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAyaDN2MTJINHpNOSAyaDN2MTJIOXpcIi8+PC9zdmc+JyxcclxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXHJcbiAgICBsb29wOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNOCAyYTYgNiAwIDAgMSA1LjY1IDRIMTZsLTIuOCAzLjVMMTAuNCA2aDIuMUE0LjUgNC41IDAgMSAwIDEyLjUgMTBsMS4zLjc1QTYgNiAwIDEgMSA4IDJ6XCIvPjwvc3ZnPicsXHJcbn07XHJcblxyXG4vLyAtLS0gdGhlIGNvbnRyb2wgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gUGxhaW4gRE9NIGluc2lkZSB0aGUgd2lkZ2V0IGNvbnRhaW5lciwgbGlrZSB0aGUgc2lkZWJhcjogbm8gTGVhZmxldCBjb250cm9sIG1hY2hpbmVyeSxcclxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xyXG4vLyBMZWFmbGV0LlRpbWVEaW1lbnNpb24ncyBjb250cm9sIC0tIHN0ZXAvcGxheS9zdGVwL2xvb3AgYXMgYSBqb2luZWQgYnV0dG9uIGJhciwgdGhlbiB0aGVcclxuLy8gZGF0ZSwgc2xpZGVyIGFuZCBzcGVlZCAtLSBzaW5jZSB0aGF0IGlzIHRoZSBzbGlkZXIgdXNlcnMgb2YgdGhlIGZvbGl1bSBhcHBzIGtub3cuXHJcbi8vXHJcbi8vIFRoZSBzbGlkZXIgaXMgYSBjb21wb3NpdGUuIEEgbmF0aXZlIDxpbnB1dCB0eXBlPXJhbmdlPiBzdGF5cyBvbiB0b3AgYXMgdGhlIHRodW1iOiBpdFxyXG4vLyBrZWVwcyBrZXlib2FyZCBhcnJvd3MsIHNjcmVlbiByZWFkZXJzIGFuZCBldmVyeSBleGlzdGluZyB0ZXN0IHdvcmtpbmcsIGFuZCBwbGF5YmFja1xyXG4vLyBkcml2ZXMgaXQgYXMgYmVmb3JlLiBVbmRlcm5lYXRoIHNpdCB0aGUgcGFydHMgYSBuYXRpdmUgaW5wdXQgY2Fubm90IGRyYXc6IHRoZSB3aW5kb3dcclxuLy8gc3BhbiBzaG93aW5nIGV4YWN0bHkgd2hhdCBpbnRlcnZhbCBpcyBvbiB0aGUgbWFwLCBhIHJ1bGVyIHdpdGggbGFiZWxsZWQgaW50ZXJ2YWwgbWFya3NcclxuLy8gYW5kIHVubGFiZWxsZWQgZ2NkIG1pbm9ycywgYW5kIHRoZSB0cmFpbCBoYW5kbGUgLS0gZHJhZyBpdCBiYWNrIHRvIHdpZGVuIHRoZSB3aW5kb3cgZm9yXHJcbi8vIGV2ZXJ5IGxheWVyIGF0IG9uY2UsIGRyb3AgaXQgb250byB0aGUgdGh1bWIgdG8gaGFuZCBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclRpbWVDb250cm9sKGNvbnRhaW5lciwgc3RhdGUsIGhhbmRsZXJzKSB7XHJcbiAgICBsZXQgZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWNvbnRyb2xcIik7XHJcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIGlmIChlbCkgZWwucmVtb3ZlKCk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAoIWVsKSB7XHJcbiAgICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XHJcbiAgICAgICAgZWwuaW5uZXJIVE1MID0gYFxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYnV0dG9uc1wiPlxyXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXBsYXlcIiBhcmlhLWxhYmVsPVwiUGxheVwiPiR7SUNPTlMucGxheX08L2J1dHRvbj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWZ3ZFwiIHRpdGxlPVwiU3RlcCBmb3J3YXJkXCIgYXJpYS1sYWJlbD1cIlN0ZXAgZm9yd2FyZFwiPiR7SUNPTlMuZndkfTwvYnV0dG9uPlxyXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxyXG4gICAgICAgICAgICA8L3NwYW4+XHJcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sYWJlbFwiPjwvc3Bhbj5cclxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWNrXCI+XHJcbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFzZVwiPjwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGFuXCI+PC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXJ1bGVyXCI+PC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgPGlucHV0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zbGlkZXJcIiB0eXBlPVwicmFuZ2VcIiBtaW49XCIwXCIgc3RlcD1cIjFcIj5cclxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS10cmFpbFwiIHJvbGU9XCJzbGlkZXJcIiB0YWJpbmRleD1cIjBcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgYXJpYS1sYWJlbD1cIlRyYWlsaW5nIHdpbmRvd1wiIHRpdGxlPVwiRHJhZyBiYWNrIHRvIHdpZGVuIHRoZSB0aW1lIHdpbmRvdzsgZHJvcCBvbiB0aGUgdGh1bWIgdG8gY2xlYXJcIj48L3NwYW4+XHJcbiAgICAgICAgICAgIDwvc3Bhbj5cclxuICAgICAgICAgICAgPHNlbGVjdCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc3BlZWRcIiB0aXRsZT1cIlBsYXliYWNrIHNwZWVkXCI+XHJcbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMC41XCI+MC41eDwvb3B0aW9uPlxyXG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjFcIj4xeDwvb3B0aW9uPlxyXG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjJcIj4yeDwvb3B0aW9uPlxyXG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjRcIj40eDwvb3B0aW9uPlxyXG4gICAgICAgICAgICA8L3NlbGVjdD5gO1xyXG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChlbCk7XHJcblxyXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1iYWNrXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBCYWNrKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtZndkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBGb3J3YXJkKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25QbGF5VG9nZ2xlKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25Mb29wVG9nZ2xlKTtcclxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc3BlZWRcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLFxyXG4gICAgICAgICAgICBlID0+IGhhbmRsZXJzLm9uU3BlZWQocGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkpKTtcclxuICAgICAgICBjb25zdCBzbGlkZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpO1xyXG4gICAgICAgIC8vIGBpbnB1dGAgZmlyZXMgcGVyIGRyYWcgc3RlcCBmb3IgbGl2ZSBzY3J1YmJpbmc7IHRoZSBtb2RlbCB3cml0ZWJhY2sgaXMgdGhlXHJcbiAgICAgICAgLy8gaGFuZGxlcidzIHByb2JsZW0sIHRocm90dGxlZCB0aGVyZSBzbyBkcmFnZ2luZyBkb2VzIG5vdCBmbG9vZCB0aGUga2VybmVsLlxyXG4gICAgICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgZSA9PiBoYW5kbGVycy5vblNlZWsocGFyc2VJbnQoZS50YXJnZXQudmFsdWUsIDEwKSkpO1xyXG5cclxuICAgICAgICBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLm1heCA9IFN0cmluZyhzdGF0ZS50aWNrcy5sZW5ndGggLSAxKTtcclxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuaW5kZXgpO1xyXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxhYmVsXCIpLnRleHRDb250ZW50ID0gZm9ybWF0VVRDKHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XSk7XHJcblxyXG4gICAgY29uc3QgcGxheSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpO1xyXG4gICAgcGxheS5pbm5lckhUTUwgPSBzdGF0ZS5wbGF5aW5nID8gSUNPTlMucGF1c2UgOiBJQ09OUy5wbGF5O1xyXG4gICAgcGxheS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIik7XHJcbiAgICBwbGF5LnRpdGxlID0gc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiO1xyXG5cclxuICAgIC8vIEEgbW9kZSwgbm90IGFuIGFjdGlvbjogcHJlc3NlZCBzdHlsaW5nIGFuZCBhcmlhLXByZXNzZWQgc2F5IFwidGhpcyBzdGF5cyBvblwiLFxyXG4gICAgLy8gd2hlcmUgYSBiYXJlIGljb24gaW52aXRlZCBhIGNsaWNrIGV4cGVjdGluZyBzb21ldGhpbmcgdG8gaGFwcGVuIHJpZ2h0IG5vdy5cclxuICAgIGNvbnN0IGxvb3AgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKTtcclxuICAgIGxvb3AuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCBCb29sZWFuKHN0YXRlLmxvb3ApKTtcclxuICAgIGxvb3Auc2V0QXR0cmlidXRlKFwiYXJpYS1wcmVzc2VkXCIsIFN0cmluZyhCb29sZWFuKHN0YXRlLmxvb3ApKSk7XHJcbiAgICBsb29wLnRpdGxlID0gc3RhdGUubG9vcCA/IFwiTG9vcDogb25cIiA6IFwiTG9vcDogb2ZmXCI7XHJcblxyXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLnNwZWVkIHx8IDEpO1xyXG4gICAgcmVuZGVyVHJhY2soZWwsIHN0YXRlKTtcclxuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcclxuICAgIHJldHVybiBlbDtcclxufVxyXG5cclxuLy8gR2VvbWV0cnkgc2hhcmVkIGJ5IHJlbmRlcmluZyBhbmQgZHJhZ2dpbmc6IHdoZXJlIGEgdGltZSBzaXRzIG9uIHRoZSB0cmFjaywgMC4uMS5cclxuZnVuY3Rpb24gdHJhY2tGcmFjdGlvbih0aWNrcywgdCkge1xyXG4gICAgY29uc3Qgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdGlja3NbMF07XHJcbiAgICBpZiAoc3BhbiA8PSAwKSByZXR1cm4gMTtcclxuICAgIHJldHVybiBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCAodCAtIHRpY2tzWzBdKSAvIHNwYW4pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyVHJhY2soZWwsIHN0YXRlKSB7XHJcbiAgICBjb25zdCB7IHRpY2tzLCBpbmRleCB9ID0gc3RhdGU7XHJcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcclxuICAgIHRyYWNrLl9zdGF0ZSA9IHN0YXRlOyAgICAgIC8vIHRoZSBkcmFnIGhhbmRsZXIgcmVhZHMgdGhlIGZyZXNoZXN0IHN0YXRlIGZyb20gaGVyZVxyXG5cclxuICAgIGNvbnN0IHRodW1iVCA9IHRpY2tzW2luZGV4XTtcclxuICAgIGNvbnN0IHBlcmlvZE1zID0gc3RhdGUucGVyaW9kTXM7XHJcbiAgICBjb25zdCB3aW5kb3dNcyA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiBudWxsO1xyXG4gICAgY29uc3Qgc2hvd25NcyA9IHdpbmRvd01zICE9IG51bGwgPyB3aW5kb3dNcyA6IHBlcmlvZE1zO1xyXG5cclxuICAgIC8vIFRoZSBzcGFuOiB3aGF0IGludGVydmFsIHRoZSBtYXAgaXMgc2hvd2luZyByaWdodCBub3cuIFRoZSBzcGFuIGRlcGljdHMgdGhlIHNoYXJlZFxyXG4gICAgLy8gd2luZG93IC0tIG9uZSBwZXJpb2QgYnkgZGVmYXVsdCAtLSBhbmQgcGVyLWxheWVyIGR1cmF0aW9ucyByZW1haW4gYW4gQVBJIGNvbmNlcm5cclxuICAgIC8vIHVudGlsIGEgZHJhZyBvdmVycmlkZXMgdGhlbSBmb3IgZXZlcnl0aGluZyBhdCBvbmNlLlxyXG4gICAgY29uc3Qgc3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGFuXCIpO1xyXG4gICAgY29uc3QgcmlnaHQgPSB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQpO1xyXG4gICAgY29uc3QgbGVmdCA9IHNob3duTXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHNob3duTXMpIDogMDtcclxuICAgIHNwYW4uc3R5bGUubGVmdCA9IGAkeyhsZWZ0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xyXG4gICAgc3Bhbi5zdHlsZS53aWR0aCA9IGAkeyhNYXRoLm1heCgwLCByaWdodCAtIGxlZnQpICogMTAwKS50b0ZpeGVkKDIpfSVgO1xyXG4gICAgc3Bhbi5jbGFzc0xpc3QudG9nZ2xlKFwib3ZlcnJpZGVcIiwgd2luZG93TXMgIT0gbnVsbCk7XHJcblxyXG4gICAgLy8gVGhlIHRyYWlsIGhhbmRsZSBwYXJrcyBPTiB0aGUgdGh1bWIgd2hlbiBubyBvdmVycmlkZSBpcyBhY3RpdmUgLS0gXCJub3QgZ3JhYmJlZFwiIC0tXHJcbiAgICAvLyBhbmQgc2l0cyBhdCB0aGUgd2luZG93J3Mgc3RhcnQgd2hpbGUgb25lIGlzLiBEcm9wcGluZyBpdCBiYWNrIG9uIHRoZSB0aHVtYiBjbGVhcnMuXHJcbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcclxuICAgIGNvbnN0IGF0ID0gd2luZG93TXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHdpbmRvd01zKSA6IHJpZ2h0O1xyXG4gICAgdHJhaWwuc3R5bGUubGVmdCA9IGAkeyhhdCAqIDEwMCkudG9GaXhlZCgyKX0lYDtcclxuICAgIHRyYWlsLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgd2luZG93TXMgIT0gbnVsbCk7XHJcbiAgICB0cmFpbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLXZhbHVldGV4dFwiLCBzdGF0ZS53aW5kb3cgfHwgXCJubyB0cmFpbGluZyB3aW5kb3dcIik7XHJcbiAgICAvLyBObyBmaXhlZC1tcyBncmlkIChjYWxlbmRhciBwZXJpb2RzKSBtZWFucyBub3RoaW5nIHNlbnNpYmxlIHRvIHNuYXAgdG8uXHJcbiAgICB0cmFpbC5zdHlsZS5kaXNwbGF5ID0gc3RhdGUuZ3JpZE1zID8gXCJcIiA6IFwibm9uZVwiO1xyXG5cclxuICAgIGNvbnN0IHJ1bGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXJ1bGVyXCIpO1xyXG4gICAgY29uc3Qga2V5ID0gYCR7dGlja3NbMF19fCR7dGlja3MubGVuZ3RofXwke3N0YXRlLmdyaWRNc318JHtwZXJpb2RNc31gO1xyXG4gICAgaWYgKHJ1bGVyLl9rZXkgIT09IGtleSkge1xyXG4gICAgICAgIHJ1bGVyLl9rZXkgPSBrZXk7XHJcbiAgICAgICAgcnVsZXIuaW5uZXJIVE1MID0gXCJcIjtcclxuICAgICAgICBmb3IgKGNvbnN0IG1hcmsgb2YgYnVpbGRSdWxlcih0aWNrcywgc3RhdGUuZ3JpZE1zLCB0ID0+IGZvcm1hdFRpY2tMYWJlbCh0LCBwZXJpb2RNcykpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICAgICAgbS5jbGFzc05hbWUgPSBtYXJrLm1ham9yID8gXCJzd2lmdG1hcC10aW1lLW1hcmsgbWFqb3JcIiA6IFwic3dpZnRtYXAtdGltZS1tYXJrXCI7XHJcbiAgICAgICAgICAgIG0uc3R5bGUubGVmdCA9IGAkeyhtYXJrLmZyYWN0aW9uICogMTAwKS50b0ZpeGVkKDIpfSVgO1xyXG4gICAgICAgICAgICBpZiAobWFyay5sYWJlbCkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGFiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgICAgICBsYWIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLW1hcmstbGFiZWxcIjtcclxuICAgICAgICAgICAgICAgIGxhYi50ZXh0Q29udGVudCA9IG1hcmsubGFiZWw7XHJcbiAgICAgICAgICAgICAgICBtLmFwcGVuZENoaWxkKGxhYik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcnVsZXIuYXBwZW5kQ2hpbGQobSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG4vLyBEcmFnZ2luZyB0aGUgdHJhaWwgaGFuZGxlLiBTbmFwcyB0byB0aGUgZ2NkIGdyaWQgc28gZXZlcnkgc3RvcCBpcyBhIGJvdW5kYXJ5IHRoZSBkYXRhXHJcbi8vIG9yIHRoZSBpbnRlcnZhbCBhY3R1YWxseSBuYW1lczsgdGhlIGRpc3RhbmNlIHRvIHRoZSB0aHVtYiwgaW4gd2hvbGUgZ3JpZCBzdGVwcywgSVMgdGhlXHJcbi8vIHdpbmRvdy4gWmVybyBzdGVwcyAtLSBkcm9wcGVkIG9uIHRoZSB0aHVtYiAtLSBjbGVhcnMgdGhlIG92ZXJyaWRlLlxyXG5mdW5jdGlvbiBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKSB7XHJcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcclxuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xyXG5cclxuICAgIGZ1bmN0aW9uIGlzb0Zyb21FdmVudChldikge1xyXG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xyXG4gICAgICAgIGNvbnN0IHJlY3QgPSB0cmFjay5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMgfHwgcmVjdC53aWR0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdW5jbGFtcGVkIG9uIHRoZSBsZWZ0OiB0aGUgd2luZG93IGlzIFwiaG93IGZhciBiYWNrIGZyb20gdGhlXHJcbiAgICAgICAgLy8gbGVhZCBwb2ludFwiLCBhbmQgdGhhdCBtYXkgcmVhY2ggcGFzdCB0aGUgYmFyJ3Mgc3RhcnQgLS0gZXNwZWNpYWxseSB3aGVuIHRoZVxyXG4gICAgICAgIC8vIGxlYWQgc2l0cyBlYXJseSBvbiB0aGUgYmFyIGFuZCBtb3N0IG9mIGl0cyB0cmFpbCBpcyBvZmYtc2NyZWVuLiBDbGFtcGluZyBoZXJlXHJcbiAgICAgICAgLy8gY2FwcGVkIHRoZSB3aW5kb3cgYXQgdGhlIHZpc2libGUgcGFzdCwgd2hpY2ggcGlubmVkIHRoZSBoYW5kbGUgdG8gdGhlIGJhcidzXHJcbiAgICAgICAgLy8gc3RhcnQgYW5kIG1hZGUgYW55dGhpbmcgd2lkZXIgaW1wb3NzaWJsZSB0byBzZXQuIE9ubHkgdGhlIERSQVdJTkcgY2xhbXBzLlxyXG4gICAgICAgIGNvbnN0IGZyYWMgPSBNYXRoLm1pbigxLCAoZXYuY2xpZW50WCAtIHJlY3QubGVmdCkgLyByZWN0LndpZHRoKTtcclxuICAgICAgICBjb25zdCB0MCA9IHN0YXRlLnRpY2tzWzBdO1xyXG4gICAgICAgIGNvbnN0IHNwYW5NcyA9IHN0YXRlLnRpY2tzW3N0YXRlLnRpY2tzLmxlbmd0aCAtIDFdIC0gdDA7XHJcbiAgICAgICAgY29uc3QgdGh1bWJUID0gc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdO1xyXG4gICAgICAgIGNvbnN0IGRpc3QgPSB0aHVtYlQgLSAodDAgKyBmcmFjICogc3Bhbk1zKTtcclxuICAgICAgICBjb25zdCBzdGVwcyA9IE1hdGgubWF4KDAsIE1hdGgucm91bmQoZGlzdCAvIHN0YXRlLmdyaWRNcykpO1xyXG4gICAgICAgIHJldHVybiBzdGVwcyA9PT0gMCA/IG51bGwgOiBtc1RvUGVyaW9kSVNPKHN0ZXBzICogc3RhdGUuZ3JpZE1zKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBNb3ZlIGFuZCByZWxlYXNlIGxpc3RlbiBvbiB0aGUgZG9jdW1lbnQgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgZHJhZzogdGhlIGhhbmRsZVxyXG4gICAgLy8gaXMgMTJweCB3aWRlLCB0aGUgY3Vyc29yIGxlYXZlcyBpdCBvbiB0aGUgZmlyc3QgZmFzdCBtb3ZlbWVudCwgYW5kIGV2ZW50cyB0aGF0XHJcbiAgICAvLyB0YXJnZXQgd2hhdGV2ZXIgaXMgdW5kZXJuZWF0aCB3b3VsZCBzdHV0dGVyIHRoZSBkcmFnIGFuZCBjb3VsZCBzd2FsbG93IHRoZSByZWxlYXNlXHJcbiAgICAvLyBlbnRpcmVseSAtLSBhbiB1bmNvbW1pdHRlZCBkcmFnIHRoZW4gc25hcHMgYmFjayBvbiB0aGUgbmV4dCBzeW5jLlxyXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGV2ID0+IHtcclxuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIC8vIENhcHR1cmUgcmV0YXJnZXRzIGV2ZXJ5IHBvaW50ZXIgZXZlbnQgdG8gdGhlIGhhbmRsZSB1bnRpbCByZWxlYXNlLCBubyBtYXR0ZXJcclxuICAgICAgICAvLyB3aGVyZSB0aGUgY3Vyc29yIGlzLiBXaXRob3V0IGl0LCBsZXR0aW5nIGdvIHdpdGggdGhlIHBvaW50ZXIgb3ZlciB0aGUgbWFwIGhhbmRzXHJcbiAgICAgICAgLy8gcG9pbnRlcnVwIHRvIExlYWZsZXQncyBjb250YWluZXIgaGFuZGxlcnMsIGFuZCBhIHJlbGVhc2UgdGhleSBzd2FsbG93IG5ldmVyXHJcbiAgICAgICAgLy8gcmVhY2hlcyB0aGUgZG9jdW1lbnQgbGlzdGVuZXIgLS0gdGhlIGRyYWcgc3RheXMgdW5jb21taXR0ZWQgYW5kIHRoZSBuZXh0IHN5bmNcclxuICAgICAgICAvLyBzbmFwcyB0aGUgaGFuZGxlIGhvbWUuIFRoZSBkb2N1bWVudCBsaXN0ZW5lcnMgYmVsb3cgcmVtYWluIGFzIHRoZSBmYWxsYmFjayBmb3JcclxuICAgICAgICAvLyBlbnZpcm9ubWVudHMgd2l0aG91dCBjYXB0dXJlOyB3aXRoIGl0LCByZXRhcmdldGVkIGV2ZW50cyBzdGlsbCBidWJibGUgdG8gdGhlbS5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBpZiAodHJhaWwuc2V0UG9pbnRlckNhcHR1cmUpIHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKGV2LnBvaW50ZXJJZCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIHN5bnRoZXRpYyBldmVudHMgaGF2ZSBubyBhY3RpdmUgcG9pbnRlcjsgZmFsbCBiYWNrIHRvIGJ1YmJsaW5nICovIH1cclxuXHJcbiAgICAgICAgY29uc3QgbW92ZSA9IGUgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBpc28gPSBpc29Gcm9tRXZlbnQoZSk7XHJcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBjb25zdCBmaW5pc2ggPSBlID0+IHtcclxuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xyXG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XHJcbiAgICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcclxuICAgICAgICAgICAgaWYgKGlzbyAhPT0gdW5kZWZpbmVkKSBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChpc28pO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xyXG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgZmluaXNoKTtcclxuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBmaW5pc2gpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gS2V5Ym9hcmQ6IG9uZSBncmlkIHN0ZXAgcGVyIGFycm93LCBEZWxldGUvSG9tZSB0byBjbGVhci4gU2FtZSBjb250cmFjdCBhcyB0aGUgZHJhZy5cclxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGV2ID0+IHtcclxuICAgICAgICBjb25zdCBzdGF0ZSA9IHRyYWNrLl9zdGF0ZTtcclxuICAgICAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5ncmlkTXMpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IDA7XHJcbiAgICAgICAgbGV0IG5leHQ7XHJcbiAgICAgICAgaWYgKGV2LmtleSA9PT0gXCJBcnJvd0xlZnRcIikgbmV4dCA9IGN1cnJlbnQgKyBzdGF0ZS5ncmlkTXM7XHJcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkFycm93UmlnaHRcIikgbmV4dCA9IE1hdGgubWF4KDAsIGN1cnJlbnQgLSBzdGF0ZS5ncmlkTXMpO1xyXG4gICAgICAgIGVsc2UgaWYgKGV2LmtleSA9PT0gXCJEZWxldGVcIiB8fCBldi5rZXkgPT09IFwiSG9tZVwiKSBuZXh0ID0gMDtcclxuICAgICAgICBlbHNlIHJldHVybjtcclxuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGhhbmRsZXJzLm9uV2luZG93Q29tbWl0KG5leHQgPiAwID8gbXNUb1BlcmlvZElTTyhuZXh0KSA6IG51bGwpO1xyXG4gICAgfSk7XHJcbn1cclxuIiwgIi8vIFRpbWUgZmlsdGVyaW5nIG9uIHRoZSBHUFUsIGZvciBwb2ludCBsYXllcnMuXHJcbi8vXHJcbi8vIFRoZSBjb29yZGluYXRlcyBhbHJlYWR5IGxpdmUgaW4gR1BVIGJ1ZmZlcnM7IHJlYnVpbGRpbmcgdGhlIG1lcmdlZCBsYXllciBwZXIgdGljayB0aHJld1xyXG4vLyB0aGF0IGF3YXkgYW5kIHJlLWZlZCBnbGlmeSBhbGwgNU0gcG9pbnRzIHRocm91Z2ggSlMgLS0gbWVhc3VyZWQgYXQgfjIuNnMgcGVyIHdpbmRvd1xyXG4vLyBjaGFuZ2UgYXQgdGhhdCBzY2FsZSwgd2l0aCBhbGxvY2F0aW9uIGNodXJuIHRoYXQgY291bGQgY3Jhc2ggdGhlIHRhYiB3aGVuIGNoYW5nZXNcclxuLy8gc3RhY2tlZC4gSW5zdGVhZCwgZWFjaCBwb2ludCdzIHRpbWUgaW50ZXJ2YWwgYW5kIGl0cyBsYXllcidzIGR1cmF0aW9uIHJpZGUgYWxvbmcgYXNcclxuLy8gdmVydGV4IGF0dHJpYnV0ZXMgdXBsb2FkZWQgb25jZSwgYW5kIHRoZSBjdXJyZW50IHRpY2sgaXMgYSB1bmlmb3JtOiBhIHRpY2sgb3Igd2luZG93XHJcbi8vIGNoYW5nZSBjb3N0cyB0d28gZmxvYXRzIGFuZCBhIHJlZHJhdy5cclxuLy9cclxuLy8gZ2xpZnkgbWFrZXMgdGhpcyBwb3NzaWJsZSB3aXRob3V0IGZvcmtpbmcgaXQ6IHZlcnRleFNoYWRlclNvdXJjZSBpcyBhbiBvdmVycmlkYWJsZVxyXG4vLyBzZXR0aW5nICh0aGUgcGluIGZyYWdtZW50IHNoYWRlciBhbHJlYWR5IHVzZXMgdGhlIHNhbWUgZG9vciksIGluc3RhbmNlcyBleHBvc2UgdGhlaXJcclxuLy8gZ2wvcHJvZ3JhbS9jYW52YXMsIGF0dHJpYnV0ZXMgYXJlIGJvdW5kIG9uY2UgYXQgc2V0dXAsIGFuZCB0aGUgcGVyLWZyYW1lIGRyYXcgdG91Y2hlc1xyXG4vLyBvbmx5IHRoZSBtYXRyaXggdW5pZm9ybSAtLSBzbyBleHRyYSBhdHRyaWJ1dGVzIGJvdW5kIGFmdGVyIHNldHVwIHBlcnNpc3QsIGFuZCB1bmlmb3JtXHJcbi8vIHVwZGF0ZXMgdGFrZSBlZmZlY3Qgb24gdGhlIG5leHQgcmVkcmF3LlxyXG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgcGVyaW9kVG9NcywgdGltZXNGb3IgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5cclxuLy8gVGltZXMgdHJhdmVsIGFzIGZsb2F0MzIgb24gdGhlIEdQVSwgd2hvc2UgaW50ZWdlcnMgYXJlIGV4YWN0IG9ubHkgdG8gMl4yNC4gRXBvY2ggbXMgaXNcclxuLy8gaG9wZWxlc3MgYXQgdGhhdCBwcmVjaXNpb24sIHNvIHRpbWVzIGFyZSByZWJhc2VkIHRvIHRoZSBidWNrZXQncyBlYXJsaWVzdCBzdGFydCBhbmRcclxuLy8gZXhwcmVzc2VkIGluIHNlY29uZHM6IGV4YWN0IHRvIH4xOTQgZGF5cyBvZiBzcGFuLCBhbmQgYSAycyByb3VuZGluZyBiZXlvbmQgdGhhdCBpc1xyXG4vLyBpbnZpc2libGUgYXQgYW55IHpvb20gYSB0aW1lIHNsaWRlciBtYWtlcyBzZW5zZSBhdC5cclxuY29uc3QgQUxXQVlTID0gNi4zZTg7ICAgLy8gfjIwIHllYXJzLCBpbiBzZWNvbmRzOiB0aGUgXCJkdXJhdGlvblwiIG9mIGN1bXVsYXRpdmUgbGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgdGhlIHNwYW4gaGFsZi13aWR0aCBvZiBwb2ludHMgd2l0aCBubyByZWFkYWJsZSB0aW1lLlxyXG5cclxuLy8gUGVyLWJ1Y2tldCBsYXllci12aXNpYmlsaXR5IHNsb3RzIGluIHRoZSB2ZXJ0ZXggc2hhZGVyLiBFYWNoIGZsb2F0IGFycmF5IGVsZW1lbnRcclxuLy8gb2NjdXBpZXMgYSBmdWxsIHVuaWZvcm0gdmVjdG9yIGluIEVTIEdMU0wgcGFja2luZywgYW5kIHRoZSBzcGVjIGd1YXJhbnRlZXMgb25seSAxMjhcclxuLy8gdmVydGV4IHVuaWZvcm0gdmVjdG9ycyAtLSA2NCBzbG90cyBsZWF2ZXMgY29tZm9ydGFibGUgcm9vbSBmb3IgdGhlIG1hdHJpeCBhbmQgdGhlIHRpbWVcclxuLy8gdW5pZm9ybXMuIEEgYnVja2V0IHdpdGggbW9yZSBsYXllcnMgdGhhbiBzbG90cyBmYWxscyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRvZ2dsZS5cclxuLy8gKFBhY2tpbmcgZm91ciBsYXllcnMgcGVyIHZlYzQgd291bGQgcXVhZHJ1cGxlIHRoaXMgaWYgYW55b25lIGV2ZXIgbmVlZHMgaXQuKVxyXG5leHBvcnQgY29uc3QgTEFZRVJfU0xPVFMgPSA2NDtcclxuXHJcbi8vIENoZWFwIGtpbGwgc3dpdGNoZXM6IGlmIHdpcmluZyB0aGUgR0wgc3RhdGUgZXZlciBmYWlscyAoYSBmdXR1cmUgZ2xpZnkgdmVyc2lvbiBtb3ZpbmdcclxuLy8gaXRzIGludGVybmFscyksIHRoZSBhZmZlY3RlZCBmYW1pbHkgZmFsbHMgYmFjayB0byB0aGUgQ1BVIHJlYnVpbGQgcGF0aC4gUG9pbnRzIGFuZFxyXG4vLyB2ZWN0b3JzIGFyZSBzZXBhcmF0ZSBmbGFncyAtLSBhIHZlY3RvciBpbnRyb3NwZWN0aW9uIGZhaWx1cmUgbXVzdCBub3QgY29zdCBwb2ludHNcclxuLy8gdGhlaXIgR1BVIHBhdGguXHJcbmxldCBncHVPayA9IHRydWU7XHJcbmV4cG9ydCBmdW5jdGlvbiBncHVUaW1lQXZhaWxhYmxlKCkgeyByZXR1cm4gZ3B1T2s7IH1cclxuZXhwb3J0IGZ1bmN0aW9uIGRpc2FibGVHcHVUaW1lKHJlYXNvbikge1xyXG4gICAgaWYgKGdwdU9rKSBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gR1BVIHRpbWUgZmlsdGVyaW5nIGRpc2FibGVkOiAke3JlYXNvbn0uIGAgK1xyXG4gICAgICAgIGBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljay5gKTtcclxuICAgIGdwdU9rID0gZmFsc2U7XHJcbn1cclxubGV0IHZlY3RvckdwdU9rID0gdHJ1ZTtcclxuZXhwb3J0IGZ1bmN0aW9uIHZlY3RvckdwdUF2YWlsYWJsZSgpIHsgcmV0dXJuIHZlY3RvckdwdU9rOyB9XHJcbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlVmVjdG9yR3B1KHJlYXNvbikge1xyXG4gICAgaWYgKHZlY3RvckdwdU9rKSBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gR1BVIHRpbWUgZm9yIGxpbmVzL3BvbHlnb25zIGRpc2FibGVkOiBgICtcclxuICAgICAgICBgJHtyZWFzb259LiBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljayBmb3IgdGhvc2UgYnVja2V0cy5gKTtcclxuICAgIHZlY3RvckdwdU9rID0gZmFsc2U7XHJcbn1cclxuXHJcbi8vIFRoZSBkZWZhdWx0IHBvaW50cyB2ZXJ0ZXggc2hhZGVyIChyZWFkIG91dCBvZiBsZWFmbGV0LmdsaWZ5IDMuMy4wKSB3aXRoIHRoZSB3aW5kb3dcclxuLy8gdGVzdCBhZGRlZC4gQSBoaWRkZW4gcG9pbnQgZ2V0cyBzaXplIDAgYW5kIGEgcG9zaXRpb24gb3V0c2lkZSBjbGlwIHNwYWNlLCBzbyBuZWl0aGVyXHJcbi8vIHRoZSB2aXNpYmxlIHBhc3Mgbm9yIHRoZSBzaGFyZWQtcHJvZ3JhbSBwaWNraW5nIHBhc3MgZXZlciByYXN0ZXJpc2VzIGl0LlxyXG5leHBvcnQgZnVuY3Rpb24gdGltZVZlcnRleFNoYWRlcigpIHtcclxuICAgIHJldHVybiBgdW5pZm9ybSBtYXQ0IG1hdHJpeDtcclxuYXR0cmlidXRlIHZlYzQgdmVydGV4O1xyXG5hdHRyaWJ1dGUgdmVjNCBjb2xvcjtcclxuYXR0cmlidXRlIGZsb2F0IHBvaW50U2l6ZTtcclxuYXR0cmlidXRlIHZlYzIgYVRpbWVTcGFuO1xyXG5hdHRyaWJ1dGUgZmxvYXQgYUR1cmF0aW9uO1xyXG5hdHRyaWJ1dGUgZmxvYXQgYUxheWVyO1xyXG51bmlmb3JtIGZsb2F0IHVUaWNrO1xyXG51bmlmb3JtIGZsb2F0IHVPdmVycmlkZTtcclxudW5pZm9ybSBmbG9hdCB1TGF5ZXJWaXNbJHtMQVlFUl9TTE9UU31dO1xyXG52YXJ5aW5nIHZlYzQgX2NvbG9yO1xyXG5cclxudm9pZCBtYWluKCkge1xyXG4gIC8vIEEgbmVnYXRpdmUgZHVyYXRpb24gaXMgdGhlIGZhZGUgZmxhZzogfGFEdXJhdGlvbnwgaXMgdGhlIHdpbmRvdywgdGhlIHNpZ24gc2F5cyB0aGlzXHJcbiAgLy8gcG9pbnQgZGltcyB3aXRoIGFnZS4gQSBzaGFyZWQgb3ZlcnJpZGUga2VlcHMgdGhlIHBvaW50J3Mgb3duIGZhZGUgcHJlZmVyZW5jZS5cclxuICBib29sIGZhZGVzID0gYUR1cmF0aW9uIDwgMC4wO1xyXG4gIGZsb2F0IGR1ciA9IHVPdmVycmlkZSA+PSAwLjAgPyB1T3ZlcnJpZGUgOiBhYnMoYUR1cmF0aW9uKTtcclxuICAvLyBIYWxmLW9wZW4gKHRpY2sgLSBkdXIsIHRpY2tdLCBtYXRjaGluZyBmZWF0dXJlSW5XaW5kb3cgb24gdGhlIENQVSBzaWRlIC0tIEFORGVkIHdpdGhcclxuICAvLyB0aGUgcG9pbnQncyBsYXllciBiZWluZyB2aXNpYmxlLiBMYXllciB0b2dnbGVzIGFyZSBvbmUgdW5pZm9ybSBlbGVtZW50LCBub3QgYVxyXG4gIC8vIHJlYnVpbGQ6IHVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlLWZlZWQgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTLlxyXG4gIGJvb2wgdmlzaWJsZSA9IGFUaW1lU3Bhbi55ID4gKHVUaWNrIC0gZHVyKSAmJiBhVGltZVNwYW4ueCA8PSB1VGlja1xyXG4gICAgICAmJiB1TGF5ZXJWaXNbaW50KGFMYXllcildID4gMC41O1xyXG4gIGdsX1BvaW50U2l6ZSA9IHZpc2libGUgPyBwb2ludFNpemUgOiAwLjA7XHJcbiAgZ2xfUG9zaXRpb24gPSB2aXNpYmxlID8gbWF0cml4ICogdmVydGV4IDogdmVjNCgyLjAsIDIuMCwgMi4wLCAxLjApO1xyXG4gIC8vIEFnZSBydW5zIGZyb20gdGhlIGZlYXR1cmUncyBlbmQ7IG5ld2VzdCBpcyBvcGFxdWUsIHRoZSB0cmFpbGluZyBlZGdlIHJlYWNoZXMgemVyby5cclxuICBmbG9hdCBhbHBoYSA9IGZhZGVzID8gY2xhbXAoMS4wIC0gKHVUaWNrIC0gYVRpbWVTcGFuLnkpIC8gZHVyLCAwLjAsIDEuMCkgOiAxLjA7XHJcbiAgX2NvbG9yID0gdmVjNChjb2xvci5yZ2IsIGNvbG9yLmEgKiBhbHBoYSk7XHJcbn1cclxuYDtcclxufVxyXG5cclxuLy8gUGVyLWxheWVyIGR1cmF0aW9uIGluIHNlY29uZHM6IG51bGwgYWNjdW11bGF0ZXMsIFwicGVyaW9kXCIgaXMgdGhlIHNoYXJlZCBpbnRlcnZhbCxcclxuLy8gYW4gSVNPIHN0cmluZyBpcyBpdHNlbGY7IGFueXRoaW5nIHVucGFyc2VhYmxlIGZhbGxzIGJhY2sgdG8gdGhlIGludGVydmFsLlxyXG5mdW5jdGlvbiBkdXJhdGlvblNlY29uZHMoc3BlYywgcGVyaW9kTXMpIHtcclxuICAgIGlmIChzcGVjID09PSBudWxsIHx8IHNwZWMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIEFMV0FZUztcclxuICAgIGlmIChzcGVjID09PSBcInBlcmlvZFwiKSByZXR1cm4gKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcclxuICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzcGVjKSk7XHJcbiAgICByZXR1cm4gbXMgPyBtcyAvIDEwMDAgOiAocGVyaW9kTXMgfHwgMjQgKiAzNjAwICogMTAwMCkgLyAxMDAwO1xyXG59XHJcblxyXG4vLyBCdWlsZHMgdGhlIHBlci1wb2ludCBhdHRyaWJ1dGUgYXJyYXlzIGZvciBvbmUgbWVyZ2VkIGJ1Y2tldCwgaW4gdGhlIGV4YWN0IG9yZGVyIHRoZVxyXG4vLyBidWNrZXQgZmVlZHMgcG9pbnRzIHRvIGdsaWZ5OiBsYXllciBieSBsYXllciwgaW5kZXggMC4ubi0xLCB3aXRoIHNpbmdsZS1gbG9jYXRpb25gXHJcbi8vIGxheWVycyBjb250cmlidXRpbmcgb25lIHBvaW50LiBQb2ludHMgaW4gbGF5ZXJzIHdpdGhvdXQgdGltZSBtZXRhZGF0YSAtLSBhbmQgcG9pbnRzXHJcbi8vIHdob3NlIHRpbWUgd2FzIHVucmVhZGFibGUgKE5hTikgLS0gZ2V0IGEgc3BhbiB0aGF0IGlzIHZpc2libGUgYXQgZXZlcnkgdGljay5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHBlcmlvZE1zKSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgbGV0IGhhc1RpbWUgPSBmYWxzZTtcclxuICAgIGNvbnN0IHBlckxheWVyID0gW107XHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBidWYgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgY29uc3QgY291bnQgPSBidWYgPyBidWYuYnl0ZUxlbmd0aCAvIDE2IDogKGxheWVyLmxvY2F0aW9uID8gMSA6IDApO1xyXG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xyXG4gICAgICAgIGlmIChsYXllci50aW1lKSBoYXNUaW1lID0gdHJ1ZTtcclxuICAgICAgICBwZXJMYXllci5wdXNoKHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9KTtcclxuICAgICAgICB0b3RhbCArPSBjb3VudDtcclxuICAgIH1cclxuICAgIGlmICghaGFzVGltZSkgcmV0dXJuIHsgaGFzVGltZTogZmFsc2UgfTtcclxuXHJcbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xyXG4gICAgZm9yIChjb25zdCB7IHRpbWVzIH0gb2YgcGVyTGF5ZXIpIHtcclxuICAgICAgICBpZiAoIXRpbWVzKSBjb250aW51ZTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSAmJiB0aW1lc1tpXSA8IGJhc2UpIGJhc2UgPSB0aW1lc1tpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoYmFzZSA9PT0gSW5maW5pdHkpIGJhc2UgPSAwO1xyXG5cclxuICAgIGNvbnN0IHNwYW5zID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCAqIDIpO1xyXG4gICAgY29uc3QgZHVycyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xyXG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWRzID0gW107XHJcbiAgICBsZXQgb3V0ID0gMDtcclxuICAgIGZvciAoY29uc3QgeyBsYXllciwgY291bnQsIHRpbWVzIH0gb2YgcGVyTGF5ZXIpIHtcclxuICAgICAgICBjb25zdCBpZHggPSBsYXllcklkcy5sZW5ndGg7XHJcbiAgICAgICAgbGF5ZXJJZHMucHVzaChsYXllci5pZCk7XHJcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XHJcbiAgICAgICAgLy8gVGhlIGZhZGUgZmxhZyByaWRlcyB0aGUgZHVyYXRpb24ncyBzaWduLCBzbyBpdCBjb3N0cyBubyBleHRyYSBhdHRyaWJ1dGUuXHJcbiAgICAgICAgLy8gVGltZWxlc3MgKE5hTikgcG9pbnRzIGtlZXAgYSBwb3NpdGl2ZSBkdXJhdGlvbjogd2l0aCBubyBhZ2UsIG5vdGhpbmcgdG8gZmFkZS5cclxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gdGltZXMgPyB0aW1lc1tpICogMl0gOiBOYU47XHJcbiAgICAgICAgICAgIGNvbnN0IGVuZCA9IHRpbWVzID8gdGltZXNbaSAqIDIgKyAxXSA6IE5hTjtcclxuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTihzdGFydCkpIHtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gLUFMV0FZUztcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IEFMV0FZUztcclxuICAgICAgICAgICAgICAgIGR1cnNbb3V0XSA9IEFMV0FZUztcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gKHN0YXJ0IC0gYmFzZSkgLyAxMDAwO1xyXG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gKGVuZCAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgIGR1cnNbb3V0XSA9IHNpZ25lZER1cjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsYXllcklkeFtvdXRdID0gaWR4O1xyXG4gICAgICAgICAgICBvdXQrKztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4geyBoYXNUaW1lOiB0cnVlLCBiYXNlLCBzcGFucywgZHVycywgbGF5ZXJJZHgsIGxheWVySWRzLCBjb3VudDogdG90YWwgfTtcclxufVxyXG5cclxuLy8gUGVyLWZlYXR1cmUgdGltZSBtZXRhZGF0YSBmb3IgYSB2ZWN0b3IgYnVja2V0IChsaW5lcy9wb2x5Z29ucykuIFNhbWUgZW5jb2RpbmdzIGFzXHJcbi8vIHRoZSBwb2ludCBwYXRoIC0tIHJlYmFzZWQgZmxvYXQzMiBzZWNvbmRzLCBzaWduLXBhY2tlZCBmYWRlLCBhbHdheXMtdmlzaWJsZSBzcGFuc1xyXG4vLyBmb3IgdGltZWxlc3Mgb3Igbm9uLXRpbWUgbGF5ZXJzLlxyXG4vL1xyXG4vLyBBIHBvbHlsaW5lIHdob3NlIDo6dGltZXMgYnVmZmVyIGhvbGRzIG9uZSBbc3RhcnQsIGVuZF0gcGFpciBQRVIgVkVSVEVYIGFuaW1hdGVzXHJcbi8vIHBlciBzZWdtZW50IHdpdGhpbiBvbmUgbGF5ZXI6IHNlZ21lbnQgayBzcGFucyB2ZXJ0ZXggaydzIHN0YXJ0IHRvIHZlcnRleCBrKzEnc1xyXG4vLyBlbmQsIGFuZCBiZWNhdXNlIGdsaWZ5IGJ1aWxkcyAyIGRlZGljYXRlZCBHTCB2ZXJ0aWNlcyBwZXIgc2VnbWVudCAtLSBzZWdtZW50c1xyXG4vLyBuZXZlciBzaGFyZSB2ZXJ0aWNlcyAtLSBib3RoIGVuZHBvaW50cyBjYXJyeSB0aGUgc2FtZSBzcGFuIGFuZCBzZWdtZW50cyBhcHBlYXJcclxuLy8gYXRvbWljYWxseS4gVGhhdCBpcyB3aGF0IGxldHMgYSB3aG9sZSBzZWdtZW50ZWQgdHJhY2sgcmlkZSBPTkUgbGF5ZXIgc2xvdCB0aGUgd2F5XHJcbi8vIGEgMjAway1wb2ludCBsYXllciBkb2VzLCBpbnN0ZWFkIG9mIG9uZSBzbG90IHBlciBjaHVuayBhZ2FpbnN0IHRoZSA2NCBjZWlsaW5nLlxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZWN0b3JUaW1lTWV0YShsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcclxuICAgIGlmICghbGF5ZXJzTGlzdC5zb21lKGwgPT4gbC50aW1lKSkgcmV0dXJuIHsgaGFzVGltZTogZmFsc2UgfTtcclxuICAgIGxldCBiYXNlID0gSW5maW5pdHk7XHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBpZiAoIXRpbWVzKSBjb250aW51ZTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHRpbWVzW2ldKSAmJiB0aW1lc1tpXSA8IGJhc2UpIGJhc2UgPSB0aW1lc1tpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoYmFzZSA9PT0gSW5maW5pdHkpIGJhc2UgPSAwO1xyXG5cclxuICAgIGNvbnN0IHBlckZlYXR1cmUgPSBsYXllcnNMaXN0Lm1hcCgobGF5ZXIsIGlkeCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IGR1ciA9IGxheWVyLnRpbWUgPyBkdXJhdGlvblNlY29uZHMobGF5ZXIudGltZS5kdXJhdGlvbiwgcGVyaW9kTXMpIDogQUxXQVlTO1xyXG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcclxuICAgICAgICBpZiAoIXRpbWVzIHx8ICh0aW1lcy5sZW5ndGggPT09IDIgJiYgTnVtYmVyLmlzTmFOKHRpbWVzWzBdKSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1BTFdBWVMsIGVuZDogQUxXQVlTLCBkdXI6IEFMV0FZUywgaWR4IH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IG5WZXJ0cyA9IHZlcnRleENvdW50T2YobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5bGluZVwiICYmIHRpbWVzLmxlbmd0aCA+IDJcclxuICAgICAgICAgICAgICAgICYmIHRpbWVzLmxlbmd0aCA9PT0gblZlcnRzICogMikge1xyXG4gICAgICAgICAgICAvLyBTZWdtZW50cyBuZXZlciBjcm9zcyBhIHBhcnQgYm91bmRhcnk6IGEgbXVsdGktcGFydCBsaW5lIGRyYXdzXHJcbiAgICAgICAgICAgIC8vIG5WZXJ0cyAtIHBhcnRzIHNlZ21lbnRzLCBhbmQgYSBzcGFuIGJ1aWx0IGZyb20gb25lIHBhcnQncyBsYXN0XHJcbiAgICAgICAgICAgIC8vIHZlcnRleCB0byB0aGUgbmV4dCBwYXJ0J3MgZmlyc3Qgd291bGQgYmUgdGhlIHBoYW50b20gc2VnbWVudFxyXG4gICAgICAgICAgICAvLyByZWFwcGVhcmluZyBpbiB0aGUgdGltZSBwYXRoIC0tIG9uZSBleHRyYSBzcGFuLCBhbmQgZXZlcnkgYXR0cmlidXRlXHJcbiAgICAgICAgICAgIC8vIGFmdGVyIGl0IHNoZWFycyAodGhlIGxlbmd0aCBjaGVjayB0aGVuIGRyb3BzIHRoZSB3aG9sZSBmZWF0dXJlIHRvXHJcbiAgICAgICAgICAgIC8vIGl0cyBvdmVyYWxsIHNwYW4pLiBXYWxrIHRoZSBwYXJ0cyB0aGUgd2F5IHRoZSByZW5kZXJlciBkcmF3cyB0aGVtLlxyXG4gICAgICAgICAgICBjb25zdCBsZW5ndGhzID0gQXJyYXkuaXNBcnJheShsYXllci5wYXJ0cykgJiYgbGF5ZXIucGFydHMubGVuZ3RoID4gMVxyXG4gICAgICAgICAgICAgICAgPyBsYXllci5wYXJ0cyA6IFtuVmVydHNdO1xyXG4gICAgICAgICAgICBjb25zdCBzZWdzID0gbGVuZ3Rocy5yZWR1Y2UoKGEsIG4pID0+IGEgKyBNYXRoLm1heCgwLCBuIC0gMSksIDApO1xyXG4gICAgICAgICAgICBjb25zdCBzZWcgPSBuZXcgRmxvYXQ2NEFycmF5KHNlZ3MgKiAyKTtcclxuICAgICAgICAgICAgbGV0IGsgPSAwLCBvZmZzZXQgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG4gb2YgbGVuZ3Rocykge1xyXG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogKyAxIDwgbjsgaisrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcyA9IHRpbWVzWyhvZmZzZXQgKyBqKSAqIDJdO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGUgPSB0aW1lc1sob2Zmc2V0ICsgaiArIDEpICogMiArIDFdO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4ocykgfHwgTnVtYmVyLmlzTmFOKGUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMl0gPSAtQUxXQVlTOyAgICAgIC8vIGFuIHVucmVhZGFibGUgdGltZSBuZXZlciBoaWRlcyBkYXRhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gQUxXQVlTO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMl0gPSAocyAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VnW2sgKiAyICsgMV0gPSAoZSAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaysrO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0ICs9IG47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gT3ZlcmFsbCBzcGFuIHJpZGVzIGFsb25nIGFzIHRoZSBmYWxsYmFjayBpZiBjb3VudHMgZXZlciBtaXNhbGlnbi5cclxuICAgICAgICAgICAgcmV0dXJuIHsgc2VnLCBzdGFydDogc2VnWzBdLCBlbmQ6IHNlZ1tzZWcubGVuZ3RoIC0gMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgIGR1cjogc2lnbmVkRHVyLCBpZHggfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6ICh0aW1lc1swXSAtIGJhc2UpIC8gMTAwMCwgZW5kOiAodGltZXNbMV0gLSBiYXNlKSAvIDEwMDAsXHJcbiAgICAgICAgICAgICAgICAgZHVyOiBzaWduZWREdXIsIGlkeCB9O1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4geyBoYXNUaW1lOiB0cnVlLCBiYXNlLCBwZXJGZWF0dXJlLCBsYXllcklkczogbGF5ZXJzTGlzdC5tYXAobCA9PiBsLmlkKSB9O1xyXG59XHJcblxyXG4vLyBBIHZlY3RvciBsYXllcidzIHZlcnRleCBjb3VudCBmcm9tIHdoaWNoZXZlciB0cmFuc3BvcnQgY2FycmllcyBpdHMgY29vcmRpbmF0ZXM6XHJcbi8vIHRoZSBiaW5hcnkgYnVmZmVyICgyIGZsb2F0NjQgcGVyIHZlcnRleCkgb3IgaW5saW5lIGBsb2NhdGlvbnNgLlxyXG5mdW5jdGlvbiB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgY29uc3QgcmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgaWYgKHJhdykgcmV0dXJuIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoIHx8IDApIC8gMTY7XHJcbiAgICByZXR1cm4gKGxheWVyLmxvY2F0aW9ucyB8fCBbXSkubGVuZ3RoO1xyXG59XHJcblxyXG4vLyBFeHBhbmRzIHBlci1mZWF0dXJlIHZhbHVlcyB0byBwZXItR0wtdmVydGV4IGFycmF5cyBnaXZlbiBlYWNoIGZlYXR1cmUncyB2ZXJ0ZXggY291bnQuXHJcbi8vIFB1cmUsIHNvIHRoZSBhbGlnbm1lbnQgbG9naWMgaXMgdGllci0xIHRlc3RhYmxlIGF3YXkgZnJvbSBhbnkgR0wgY29udGV4dC5cclxuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZFBlckZlYXR1cmUocGVyRmVhdHVyZSwgY291bnRzKSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChjb25zdCBjIG9mIGNvdW50cykgdG90YWwgKz0gYztcclxuICAgIGNvbnN0IHNwYW5zID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCAqIDIpO1xyXG4gICAgY29uc3QgZHVycyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xyXG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGxldCBvdXQgPSAwO1xyXG4gICAgcGVyRmVhdHVyZS5mb3JFYWNoKChmLCBpKSA9PiB7XHJcbiAgICAgICAgLy8gUGVyLXNlZ21lbnQgc3BhbnM6IEdMIHZlcnRleCB2IGJlbG9uZ3MgdG8gc2VnbWVudCB2ID4+IDEgKGdsaWZ5IGRyYXdzXHJcbiAgICAgICAgLy8gMiBkZWRpY2F0ZWQgdmVydGljZXMgcGVyIHNlZ21lbnQpLCBzbyBib3RoIGVuZHBvaW50cyB0YWtlIHRoZSBzZWdtZW50J3NcclxuICAgICAgICAvLyBzcGFuIGFuZCBhIHNlZ21lbnQgYXBwZWFycyBvciBkaXNhcHBlYXJzIGF0b21pY2FsbHkuIHNlZyBob2xkcyBzZWdzKjJcclxuICAgICAgICAvLyBmbG9hdHMgYW5kIHRoZSBmZWF0dXJlIGRyYXdzIHNlZ3MqMiBHTCB2ZXJ0aWNlcywgc28gdGhlIGxlbmd0aHMgYWdyZWVpbmdcclxuICAgICAgICAvLyBpcyB0aGUgYWxpZ25tZW50IGNoZWNrOyBhIG1pc21hdGNoIGZhbGxzIGJhY2sgdG8gdGhlIHdob2xlLWZlYXR1cmUgc3BhblxyXG4gICAgICAgIC8vIHJhdGhlciB0aGFuIHNoZWFyaW5nIGV2ZXJ5IGF0dHJpYnV0ZSBhZnRlciBpdC5cclxuICAgICAgICBjb25zdCBwZXJTZWdtZW50ID0gZi5zZWcgJiYgZi5zZWcubGVuZ3RoID09PSBjb3VudHNbaV0gPyBmLnNlZyA6IG51bGw7XHJcbiAgICAgICAgZm9yIChsZXQgdiA9IDA7IHYgPCBjb3VudHNbaV07IHYrKykge1xyXG4gICAgICAgICAgICBjb25zdCBrID0gcGVyU2VnbWVudCA/ICh2ID4+IDEpICogMiA6IC0xO1xyXG4gICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IHBlclNlZ21lbnQgPyBwZXJTZWdtZW50W2tdIDogZi5zdGFydDtcclxuICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gcGVyU2VnbWVudCA/IHBlclNlZ21lbnRbayArIDFdIDogZi5lbmQ7XHJcbiAgICAgICAgICAgIGR1cnNbb3V0XSA9IGYuZHVyO1xyXG4gICAgICAgICAgICBsYXllcklkeFtvdXRdID0gZi5pZHg7XHJcbiAgICAgICAgICAgIG91dCsrO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHsgc3BhbnMsIGR1cnMsIGxheWVySWR4IH07XHJcbn1cclxuXHJcbi8vIGdsaWZ5J3MgdmVydGV4IGxheW91dDogNiBmbG9hdHMgcGVyIEdMIHZlcnRleCAoeCwgeSwgciwgZywgYiwgYSksIGNvbmZpcm1lZCBmb3IgMy4zLjBcclxuLy8gYm90aCBieSByZWFkaW5nIHRoZSBzb3VyY2UgYW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgcmVwb3J0J3MgZGVidWcgZHVtcCAtLSB0d29cclxuLy8gb25lLXNlZ21lbnQgbGluZXMgcHJvZHVjZWQgYWxsVmVydGljZXNUeXBlZCBvZiAyNCBmbG9hdHM6IDIgZmVhdHVyZXMgeCAyIHZlcnRpY2VzIHggNi5cclxuY29uc3QgRkxPQVRTX1BFUl9WRVJURVggPSA2O1xyXG5cclxuLy8gV2lyZXMgdGltZSArIGxheWVyLXZpc2liaWxpdHkgaW50byBhIGxpdmUgZ2xpZnkgTElORVMgb3IgU0hBUEVTIGluc3RhbmNlLiBUaGUgY2FsbGVyXHJcbi8vIHN1cHBsaWVzIHBlci1mZWF0dXJlIEdMLXZlcnRleCBjb3VudHMgY29tcHV0ZWQgZnJvbSB0aGUgZ2VvbWV0cnkgaXQgYnVpbHQgaXRzZWxmOlxyXG4vLyBsaW5lcyBkcmF3IDIqKHBvaW50cy0xKSB2ZXJ0aWNlcyBwZXIgZmVhdHVyZSwgYW5kIGFueSB0cmlhbmd1bGF0aW9uIG9mIGEgc2ltcGxlIHJpbmdcclxuLy8gaGFzIGV4YWN0bHkgbi0yIHRyaWFuZ2xlcyAtLSBhIHByb3BlcnR5IG9mIGdlb21ldHJ5LCBub3Qgb2YgZ2xpZnkncyBlYXJjdXQuIFRoZSBjb3VudHNcclxuLy8gYXJlIHZhbGlkYXRlZCBhZ2FpbnN0IHRoZSBpbnN0YW5jZSdzIGFjdHVhbCBidWZmZXIgbGVuZ3RoLCBhbmQgYW55IG1pc21hdGNoIGRpc2FibGVzXHJcbi8vIHRoZSB2ZWN0b3IgR1BVIHBhdGggcmF0aGVyIHRoYW4gbWlzLWFsaWduaW5nIGF0dHJpYnV0ZXMuXHJcbmV4cG9ydCBmdW5jdGlvbiBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZShpbnN0YW5jZSwgbWV0YSwgY291bnRzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb3VudHMpIHx8IGNvdW50cy5sZW5ndGggIT09IG1ldGEucGVyRmVhdHVyZS5sZW5ndGgpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBleHBlY3RlZCAke21ldGEucGVyRmVhdHVyZS5sZW5ndGh9IHZlcnRleCBjb3VudHMsIGAgK1xyXG4gICAgICAgICAgICAgICAgYGdvdCAke2NvdW50cyAmJiBjb3VudHMubGVuZ3RofWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBleHBlY3RlZCA9IGNvdW50cy5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKSAqIEZMT0FUU19QRVJfVkVSVEVYO1xyXG4gICAgICAgIC8vIExpbmVzIGtlZXAgYSB0eXBlZCBmbGF0IGJ1ZmZlcjsgc2hhcGVzIGtlZXAgYSBwbGFpbiBmbGF0IGFycmF5LiBFaXRoZXIgaXMgdGhlXHJcbiAgICAgICAgLy8gZ3JvdW5kIHRydXRoIGZvciBob3cgbWFueSBHTCB2ZXJ0aWNlcyBnbGlmeSBhY3R1YWxseSBidWlsdC5cclxuICAgICAgICBjb25zdCBhY3R1YWwgPSBpbnN0YW5jZS5hbGxWZXJ0aWNlc1R5cGVkID8gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZC5sZW5ndGhcclxuICAgICAgICAgICAgOiAoQXJyYXkuaXNBcnJheShpbnN0YW5jZS52ZXJ0aWNlcykgPyBpbnN0YW5jZS52ZXJ0aWNlcy5sZW5ndGggOiAtMSk7XHJcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZXhwZWN0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGB2ZXJ0ZXggY291bnQgbWlzbWF0Y2g6IGdlb21ldHJ5IHNheXMgJHtleHBlY3RlZH0gZmxvYXRzLCBgICtcclxuICAgICAgICAgICAgICAgIGB0aGUgaW5zdGFuY2UgaG9sZHMgJHthY3R1YWx9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IGF0dHJzID0gZXhwYW5kUGVyRmVhdHVyZShtZXRhLnBlckZlYXR1cmUsIGNvdW50cyk7XHJcbiAgICAgICAgYXR0cnMuYmFzZSA9IG1ldGEuYmFzZTtcclxuICAgICAgICBhdHRycy5sYXllcklkcyA9IG1ldGEubGF5ZXJJZHM7XHJcbiAgICAgICAgcmV0dXJuIHdpcmVUaW1lQXR0cmlidXRlcyhpbnN0YW5jZSwgYXR0cnMpO1xyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgZGlzYWJsZVZlY3RvckdwdShlcnIubWVzc2FnZSk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFdpcmVzIHRoZSBhdHRyaWJ1dGUgYnVmZmVycyBhbmQgdW5pZm9ybXMgaW50byBhIGxpdmUgZ2xpZnkgcG9pbnRzIGluc3RhbmNlLiBSZXR1cm5zIGFcclxuLy8gaGFuZGxlIHdob3NlIHNldFdpbmRvdyBjb3N0cyB0d28gdW5pZm9ybXMgYW5kIGEgcmVkcmF3LCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IHRoZVxyXG4vLyBpbnN0YW5jZSBpcyBub3Qgd2hlcmUgZ2xpZnkgMy4zLjAga2VlcHMgaXQgLS0gaW4gd2hpY2ggY2FzZSBHUFUgdGltZSBpcyBkaXNhYmxlZCBhbmRcclxuLy8gdGhlIGNhbGxlcidzIHJlYnVpbGQgcGF0aCB0YWtlcyBvdmVyLlxyXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvSW5zdGFuY2UoaW5zdGFuY2UsIGF0dHJzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGRpc2FibGVHcHVUaW1lKGVyci5tZXNzYWdlKTtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxufVxyXG5cclxuLy8gVGhlIGNvbW1vbiBHTCB3aXJpbmc6IGJ1ZmZlcnMgZm9yIHNwYW4vZHVyYXRpb24vbGF5ZXIgYXR0cmlidXRlcywgdW5pZm9ybXMgZm9yIHRoZVxyXG4vLyB0aWNrLCB0aGUgc2hhcmVkIG92ZXJyaWRlIGFuZCB0aGUgcGVyLWxheWVyIHZpc2liaWxpdHkgc2xvdHMuIFRocm93cyBvbiBhbnl0aGluZ1xyXG4vLyB1bmV4cGVjdGVkOyB0aGUgY2FsbGVycyBkZWNpZGUgd2hpY2ggZmFsbGJhY2sgZmxhZyB0aGF0IGZsaXBzLlxyXG5mdW5jdGlvbiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKSB7XHJcbiAgICB7XHJcbiAgICAgICAgY29uc3QgZ2wgPSBpbnN0YW5jZS5nbDtcclxuICAgICAgICBjb25zdCBwcm9ncmFtID0gaW5zdGFuY2UucHJvZ3JhbTtcclxuICAgICAgICBjb25zdCBsYXllciA9IGluc3RhbmNlLmxheWVyO1xyXG4gICAgICAgIGlmICghZ2wgfHwgIXByb2dyYW0gfHwgIWxheWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnN0YW5jZSBsYWNrcyBnbC9wcm9ncmFtL2xheWVyXCIpO1xyXG5cclxuICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG5cclxuICAgICAgICBjb25zdCBzcGFuTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhVGltZVNwYW5cIik7XHJcbiAgICAgICAgY29uc3QgZHVyTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhRHVyYXRpb25cIik7XHJcbiAgICAgICAgY29uc3QgbGF5ZXJMb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFMYXllclwiKTtcclxuICAgICAgICBjb25zdCB0aWNrTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidVRpY2tcIik7XHJcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGVMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1T3ZlcnJpZGVcIik7XHJcbiAgICAgICAgLy8gU29tZSBkcml2ZXJzIG5hbWUgdGhlIGFycmF5IGhlYWQgXCJ1TGF5ZXJWaXNbMF1cIjsgYWNjZXB0IGVpdGhlci5cclxuICAgICAgICBjb25zdCB2aXNMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNcIilcclxuICAgICAgICAgICAgfHwgZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzWzBdXCIpO1xyXG4gICAgICAgIGlmIChzcGFuTG9jIDwgMCB8fCBkdXJMb2MgPCAwIHx8IGxheWVyTG9jIDwgMCB8fCAhdGlja0xvYyB8fCAhb3ZlcnJpZGVMb2MgfHwgIXZpc0xvYykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0aW1lIGF0dHJpYnV0ZXMvdW5pZm9ybXMgbWlzc2luZyBmcm9tIHRoZSBsaW5rZWQgcHJvZ3JhbVwiKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHNwYW5CdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcclxuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgc3BhbkJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLnNwYW5zLCBnbC5TVEFUSUNfRFJBVyk7XHJcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihzcGFuTG9jLCAyLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xyXG4gICAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KHNwYW5Mb2MpO1xyXG5cclxuICAgICAgICBjb25zdCBkdXJCdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcclxuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgZHVyQnVmKTtcclxuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuZHVycywgZ2wuU1RBVElDX0RSQVcpO1xyXG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoZHVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xyXG4gICAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KGR1ckxvYyk7XHJcblxyXG4gICAgICAgIGNvbnN0IGxheWVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGxheWVyQnVmKTtcclxuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMubGF5ZXJJZHgsIGdsLlNUQVRJQ19EUkFXKTtcclxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGxheWVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xyXG4gICAgICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KGxheWVyTG9jKTtcclxuXHJcbiAgICAgICAgLy8gVW50aWwgdGhlIHNsaWRlciBzYXlzIG90aGVyd2lzZSwgZXZlcnl0aGluZyBpcyB2aXNpYmxlIC0tIGluIHRpbWUgQU5EIGxheWVyLlxyXG4gICAgICAgIGdsLnVuaWZvcm0xZih0aWNrTG9jLCBBTFdBWVMpO1xyXG4gICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgLTEpO1xyXG4gICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbGF5ZXJJZHM6IGF0dHJzLmxheWVySWRzLFxyXG4gICAgICAgICAgICAvLyB0aWNrTXMgaW4gZXBvY2ggbXM7IG92ZXJyaWRlTXMgYSBzaGFyZWQtd2luZG93IHdpZHRoIG9yIG51bGwuXHJcbiAgICAgICAgICAgIHNldFdpbmRvdyh0aWNrTXMsIG92ZXJyaWRlTXMpIHtcclxuICAgICAgICAgICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XHJcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgdGlja01zID09PSBudWxsID8gQUxXQVlTIDogKHRpY2tNcyAtIGF0dHJzLmJhc2UpIC8gMTAwMCk7XHJcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIG92ZXJyaWRlTXMgPT09IG51bGwgPyAtMSA6IG92ZXJyaWRlTXMgLyAxMDAwKTtcclxuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvLyBPbmUgZmxvYXQgcGVyIGxheWVyIHNsb3QsIGluIGF0dHJzLmxheWVySWRzIG9yZGVyLiBBIHNpZGViYXIgdG9nZ2xlIGxhbmRzXHJcbiAgICAgICAgICAgIC8vIGhlcmUgaW5zdGVhZCBvZiByZWJ1aWxkaW5nIHRoZSBidWNrZXQuXHJcbiAgICAgICAgICAgIHNldExheWVyVmlzaWJpbGl0eSh2aXNBcnJheSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdmlzID0gbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKTtcclxuICAgICAgICAgICAgICAgIHZpcy5zZXQodmlzQXJyYXkuc2xpY2UoMCwgTEFZRVJfU0xPVFMpKTtcclxuICAgICAgICAgICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XHJcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgdmlzKTtcclxuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuIiwgImltcG9ydCB7IGJpbmRQb3B1cCwgYmluZFRvb2x0aXAsIHBhcnNlQ29sb3IgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyBMIH0gZnJvbSBcIi4vbGlicy5qc1wiO1xyXG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XHJcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXHJcbiAgICAgICAgIHBlcmlvZFRvTXMgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcclxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XHJcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XHJcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XHJcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XHJcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcclxuICAgIH1cclxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xyXG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xyXG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcclxuICAgICAgICAgICAgLy8gV2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZCAodGhlIHdpZGdldCdzIGNsaWNrIGhhbmRsZXIgc3RhbXBzIHRoaXNcclxuICAgICAgICAgICAgLy8gcGVyIGNsaWNrLCBiZWZvcmUgYW55IGZlYXR1cmUgaGFuZGxlciBydW5zKSwgRVZFUlkgbWF0Y2ggc3RhbmRzIGRvd246XHJcbiAgICAgICAgICAgIC8vIGEgY2xpY2sgaW4gcmVtb3ZhbCBtb2RlIGlzIGEgZGVsZXRpb24gYXR0ZW1wdCwgYW5kIGFuc3dlcmluZyBpdCB3aXRoXHJcbiAgICAgICAgICAgIC8vIGEgZmVhdHVyZSBwb3B1cCBvciBhIGNvb3JkcyByZWFkb3V0IHJlYWRzIGFzIFwicmVtb3ZlIGlzIGJyb2tlblwiLlxyXG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCAmJiAhbWFwLl9wbU1vZGVBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xyXG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xyXG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XHJcbiAgICB9XHJcbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcclxuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcclxuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XHJcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgfSwgMCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xyXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcclxuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXHJcbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxyXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxyXG4vL1xyXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcclxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxyXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxyXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXHJcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcclxuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xyXG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xyXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcclxuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcclxuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcclxuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xyXG4gICAgY29uc3QgcHJvcHMgPSB7fTtcclxuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcclxuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwcm9wcztcclxufVxyXG5cclxuXHJcblxyXG4vLyBBbiBpbWFnZXJ5IG92ZXJsYXkncyBpZGVudGl0eTogZXZlcnl0aGluZyB0aGUgcmVuZGVyZWQgZWxlbWVudCBkZXJpdmVzIGZyb20gaXRzXHJcbi8vIGNvbmZpZy4gVGhlIHN5bmMgbG9vcCByZWNyZWF0ZXMgdGhlIG92ZXJsYXkgd2hlbiB0aGlzIGNoYW5nZXMgKG9yIHdoZW4gdGhlXHJcbi8vIGJpbmFyeSBidWZmZXIgb2JqZWN0IHVuZGVyIHRoZSBsYXllciBpZCBpcyByZXBsYWNlZCksIHNpbmNlIGEgRE9NIGltYWdlIGlzIGFcclxuLy8gc2luZ2xlIGNoZWFwIG5vZGUgLS0gbm8gaW5jcmVtZW50YWwgdXBkYXRlIG1hY2hpbmVyeSBuZWVkZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbWFnZU1ldGFLZXkobGF5ZXIpIHtcclxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShbbGF5ZXIudXJsIHx8IG51bGwsIGxheWVyLmJvdW5kcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIub3BhY2l0eSA/PyAxLCBsYXllci5pbWFnZV9mb3JtYXQgfHwgbnVsbF0pO1xyXG59XHJcblxyXG4vLyBHZW9yZWZlcmVuY2VkIHBpeGVscyBwaW5uZWQgdG8gYSBsYXQvbG9uIGJveC4gVGhlIGNvbmZpZyBpcyBwdXJlIGRhdGEgLS1cclxuLy8ge3R5cGU6IFwiaW1hZ2VcIiwgYm91bmRzLCBvcGFjaXR5LCB1cmwgfCBieXRlcyB1bmRlciB0aGUgbGF5ZXIgaWR9IC0tIHNvIGFcclxuLy8gcGxhaW4tSlMgY29uc3VtZXIgcGFzc2VzIGEgVVJMIGFuZCB0aGUgd2lkZ2V0IHBhdGggc2hpcHMgYnl0ZXMgb3ZlciB0aGVcclxuLy8gYmluYXJ5IGJ1ZmZlciB0cmFuc3BvcnQuIFB5dGhvbiBoYXMgYWxyZWFkeSB3YXJwZWQgdGhlIHJhc3RlciBpbnRvIHRoZSBNQVAnc1xyXG4vLyBvd24gQ1JTIGdyaWQgKHJhc3RlcmlvIHNpZGUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIExlYWZsZXQncyBsaW5lYXIgY29ybmVyXHJcbi8vIHN0cmV0Y2ggZXhhY3RseSBjb3JyZWN0OyB0aGlzIHN0YXlzIGEgZHVtYiByZW5kZXJlci5cclxuZnVuY3Rpb24gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcikge1xyXG4gICAgaWYgKCFsYXllci5ib3VuZHMpIHJldHVybiBudWxsO1xyXG4gICAgbGV0IHVybCA9IGxheWVyLnVybDtcclxuICAgIGxldCBvYmplY3RVcmwgPSBudWxsO1xyXG4gICAgaWYgKCF1cmwgJiYgY29vcmRCdWZmZXIpIHtcclxuICAgICAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2Nvb3JkQnVmZmVyXSxcclxuICAgICAgICAgICAgeyB0eXBlOiBsYXllci5pbWFnZV9mb3JtYXQgfHwgXCJpbWFnZS9wbmdcIiB9KTtcclxuICAgICAgICBvYmplY3RVcmwgPSB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgfVxyXG4gICAgaWYgKCF1cmwpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IEwuaW1hZ2VPdmVybGF5KHVybCwgbGF5ZXIuYm91bmRzLCB7XHJcbiAgICAgICAgb3BhY2l0eTogbGF5ZXIub3BhY2l0eSA/PyAxLFxyXG4gICAgICAgIC8vIENvbnRleHQsIG5vdCBhIGNsaWNrIHRhcmdldDogY2xpY2tzIGZhbGwgdGhyb3VnaCB0byBmZWF0dXJlcyBhbmQgdGhlXHJcbiAgICAgICAgLy8gZW1wdHktbWFwIGNvb3JkaW5hdGUgZmFsbGJhY2suIFRoZSBkZWZhdWx0IG92ZXJsYXlQYW5lICh6IDQwMClcclxuICAgICAgICAvLyBhbHJlYWR5IHNpdHMgYWJvdmUgdGlsZXMgKDIwMCkgYW5kIGJlbG93IHRoZSBHTCBwYW5lcyAoNDEwKykuXHJcbiAgICAgICAgaW50ZXJhY3RpdmU6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAob2JqZWN0VXJsKSB7XHJcbiAgICAgICAgb3ZlcmxheS5vbihcInJlbW92ZVwiLCAoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKG9iamVjdFVybCkpO1xyXG4gICAgfVxyXG4gICAgb3ZlcmxheS5hZGRUbyhtYXApO1xyXG4gICAgb3ZlcmxheS5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgb3ZlcmxheS5pbWFnZU1ldGEgPSBpbWFnZU1ldGFLZXkobGF5ZXIpO1xyXG4gICAgb3ZlcmxheS5pbWFnZVNvdXJjZSA9IGNvb3JkQnVmZmVyIHx8IG51bGw7XHJcbiAgICByZXR1cm4gb3ZlcmxheTtcclxufVxyXG5cclxuLy8gQSBub24tR0wgbGF5ZXIgKGltYWdlIG92ZXJsYXksIG9yIGEgZ3JvdXAgb2YgdGhlbSkgYXMgYSBMZWFmbGV0IGxheWVyLiBUYWtlcyB0aGVcclxuLy8gTElWRSBidWZmZXIgbWFwIHRoZSBjb3JlIGtlZXBzIC0tIHBhdGNoZXMgbGFuZCB0aGVyZSwgbmV2ZXIgaW4gYSBob3N0IHRyYWl0LlxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRCdWZmZXIsIGNvb3JkaW5hdGVCdWZmZXJzID0ge30pIHtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImltYWdlXCIpIHtcclxuICAgICAgICByZXR1cm4gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcik7XHJcbiAgICB9XHJcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsYXllci5sYXllcnMpIHtcclxuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgZ3JvdXAuYWRkTGF5ZXIoaW5zdGFuY2UpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGdyb3VwLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcclxuICAgICAgICByZXR1cm4gZ3JvdXA7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQSB2ZWN0b3IgbGF5ZXIncyBjb29yZGluYXRlczogdGhlIGJpbmFyeSBidWZmZXIgdW5kZXIgaXRzIGlkIHdoZW4gUHl0aG9uIGJ1aWx0IGl0XHJcbi8vICh0aGUgbGF5ZXJzIEpTT04gdGhlbiBjYXJyaWVzIG5vIGNvb3JkaW5hdGVzIGF0IGFsbCksIG9yIGlubGluZSBgbG9jYXRpb25zYCBmb3JcclxuLy8gaGFuZC1idWlsdCBjb25maWdzIGFuZCBmaXh0dXJlcy4gTWF0ZXJpYWxpc2VkIG9ubHkgb24gcmVidWlsZCwgd2hpY2ggdmVjdG9yIGJ1Y2tldHNcclxuLy8gb24gdGhlIEdQVSBwYXRoIHJhcmVseSBkby5cclxuZXhwb3J0IGZ1bmN0aW9uIHZlY3RvckNvb3JkcyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmIChsYXllci5sb2NhdGlvbnMpIHJldHVybiBsYXllci5sb2NhdGlvbnM7XHJcbiAgICBjb25zdCByYXcgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBmbGF0ID0gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgIGNvbnN0IG91dCA9IG5ldyBBcnJheShmbGF0Lmxlbmd0aCAvIDIpO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvdXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBvdXRbaV0gPSBbZmxhdFtpICogMl0sIGZsYXRbaSAqIDIgKyAxXV07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBBIGxpbmUgbGF5ZXIncyBjb29yZGluYXRlcyBhcyBwYXJ0czogdGhlIGZsYXQgcnVuIHNsaWNlZCBieSB0aGUgY29uZmlnJ3MgYHBhcnRzYFxyXG4vLyBsZW5ndGggdGFibGUsIG9yIG9uZSBwYXJ0IHdpdGhvdXQgaXQuIEEgbXVsdGktcGFydCBsaW5lIC0tIE1VTFRJTElORVNUUklORyxcclxuLy8gTXVsdGlMaW5lU3RyaW5nIC0tIGlzIE9ORSBsYXllciBkcmF3biBhcyBkaXNqb2ludCBydW5zOyBub3RoaW5nIG1heSBldmVyIGRyYXcgYVxyXG4vLyBzZWdtZW50IGZyb20gb25lIHBhcnQncyBsYXN0IHZlcnRleCB0byB0aGUgbmV4dCBwYXJ0J3MgZmlyc3QuXHJcbmV4cG9ydCBmdW5jdGlvbiBsaW5lUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XHJcbiAgICBjb25zdCBsZW5ndGhzID0gQXJyYXkuaXNBcnJheShsYXllci5wYXJ0cykgJiYgbGF5ZXIucGFydHMubGVuZ3RoID4gMSA/IGxheWVyLnBhcnRzIDogbnVsbDtcclxuICAgIGlmICghbGVuZ3RocykgcmV0dXJuIGxvY3MubGVuZ3RoID8gW2xvY3NdIDogW107XHJcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xyXG4gICAgbGV0IG9mZnNldCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IG4gb2YgbGVuZ3Rocykge1xyXG4gICAgICAgIGNvbnN0IHBhcnQgPSBsb2NzLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgbik7XHJcbiAgICAgICAgb2Zmc2V0ICs9IG47XHJcbiAgICAgICAgaWYgKHBhcnQubGVuZ3RoID49IDIpIHBhcnRzLnB1c2gocGFydCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFydHM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNsb3NlUmluZyhyaW5nKSB7XHJcbiAgICBpZiAocmluZy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc3QgZmlyc3QgPSByaW5nWzBdO1xyXG4gICAgICAgIGNvbnN0IGxhc3QgPSByaW5nW3JpbmcubGVuZ3RoIC0gMV07XHJcbiAgICAgICAgaWYgKGZpcnN0WzBdICE9PSBsYXN0WzBdIHx8IGZpcnN0WzFdICE9PSBsYXN0WzFdKSB7XHJcbiAgICAgICAgICAgIHJpbmcucHVzaChbZmlyc3RbMF0sIGZpcnN0WzFdXSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJpbmc7XHJcbn1cclxuXHJcbi8vIGdsaWZ5J3MgbGluZSBoaXQgdG9sZXJhbmNlIGlzIGBzZW5zaXRpdml0eSArIHdlaWdodC9zY2FsZWAsIGFuZCBzZW5zaXRpdml0eSBpcyBhXHJcbi8vIENPTlNUQU5UIGluIGxhdGxuZyBkZWdyZWVzIC0tIDAuMSBmb3IgY2xpY2tzICh+MTEga20pIGFuZCAwLjAzIGZvciBob3ZlcnMsXHJcbi8vIHpvb20tYmxpbmQsIHNvIGEgY2xpY2sgd2l0aGluIHNpZ2h0IG9mIGEgbGluZSBtYXRjaGVkIGl0IGFuZCBzdGFydmVkIHRoZVxyXG4vLyBlbXB0eS1tYXAgZmFsbGJhY2suIFRoZSB3ZWlnaHQvc2NhbGUgdGVybSBhbHJlYWR5IGNvdmVycyB0aGUgZHJhd24gd2lkdGg7XHJcbi8vIHJlcGxhY2UgdGhlIGNvbnN0YW50IHdpdGggYSBmZXcgcGl4ZWxzJyB3b3J0aCBhdCB0aGUgY3VycmVudCB6b29tLiBUaGUgaW5zdGFuY2VcclxuLy8gZ2V0dGVycyByZWFkIGBzZXR0aW5nc2AgbGl2ZSBwZXIgZXZlbnQsIHNvIHVwZGF0aW5nIG9uIHpvb20gaXMgZW5vdWdoIC0tIG5vXHJcbi8vIGdsaWZ5IHBhdGNoaW5nLiBSZXR1cm5zIHRoZSB1bnN1YnNjcmliZSBmb3Igb25SZW1vdmUuXHJcbmNvbnN0IExJTkVfSElUX1NMQUNLX1BYID0gODtcclxuZnVuY3Rpb24gdHJhY2tMaW5lU2Vuc2l0aXZpdHkobWFwLCBpbnN0YW5jZSkge1xyXG4gICAgY29uc3QgYXBwbHkgPSAoKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgc2xhY2sgPSBMSU5FX0hJVF9TTEFDS19QWCAvIE1hdGgucG93KDIsIG1hcC5nZXRab29tKCkpO1xyXG4gICAgICAgIGluc3RhbmNlLnNldHRpbmdzLnNlbnNpdGl2aXR5ID0gc2xhY2s7XHJcbiAgICAgICAgaW5zdGFuY2Uuc2V0dGluZ3Muc2Vuc2l0aXZpdHlIb3ZlciA9IHNsYWNrO1xyXG4gICAgfTtcclxuICAgIGFwcGx5KCk7XHJcbiAgICBtYXAub24oXCJ6b29tZW5kXCIsIGFwcGx5KTtcclxuICAgIHJldHVybiAoKSA9PiBtYXAub2ZmKFwiem9vbWVuZFwiLCBhcHBseSk7XHJcbn1cclxuXHJcbi8vIEFuIGFyZWEgbGF5ZXIncyBnZW9tZXRyeSBhcyBwYXJ0cyAtPiBjbG9zZWQgW2xvbiwgbGF0XSByaW5nczogYSBwb2x5Z29uJ3MgZmxhdFxyXG4vLyBjb29yZGluYXRlIHJ1biBzbGljZWQgYnkgaXRzIGByaW5nc2AgdGFibGUgKG9uZSBob2xlLWZyZWUgcmluZyB3aXRob3V0IGl0KSwgb3IgYVxyXG4vLyBjaXJjbGUncyBnZW5lcmF0ZWQgcmluZy4gRmVlZHMgYm90aCB0aGUgZmlsbCAoZWFyY3V0LCBpbiB0aGUgcG9seWdvbiBidWNrZXQpIGFuZFxyXG4vLyB0aGUgb3V0bGluZSAoTGluZVN0cmluZ3MgaW4gdGhlIGxpbmVzIGJ1Y2tldCkuXHJcbmZ1bmN0aW9uIGFyZWFQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XHJcbiAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XHJcbiAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xyXG4gICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcclxuICAgICAgICBjb25zdCByaW5nID0gW107XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gMzI7IGkrKykge1xyXG4gICAgICAgICAgICBjb25zdCBhbmdsZSA9IChpICogMzYwKSAvIDMyO1xyXG4gICAgICAgICAgICBjb25zdCBhbmdsZVJhZCA9IChhbmdsZSAqIE1hdGguUEkpIC8gMTgwO1xyXG4gICAgICAgICAgICBjb25zdCBkTGF0ID0gKHJhZGl1c01ldGVycyAqIE1hdGguY29zKGFuZ2xlUmFkKSkgLyBlYXJ0aFJhZGl1cztcclxuICAgICAgICAgICAgY29uc3QgZExvbiA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLnNpbihhbmdsZVJhZCkpIC8gKGVhcnRoUmFkaXVzICogTWF0aC5jb3MoKGxhdCAqIE1hdGguUEkpIC8gMTgwKSk7XHJcbiAgICAgICAgICAgIHJpbmcucHVzaChbbG9uICsgKGRMb24gKiAxODApIC8gTWF0aC5QSSwgbGF0ICsgKGRMYXQgKiAxODApIC8gTWF0aC5QSV0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gW1tyaW5nXV07XHJcbiAgICB9XHJcbiAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XHJcbiAgICBjb25zdCBsb25sYXQgPSBsb2NzLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XHJcbiAgICBjb25zdCByaW5nVGFibGUgPSBsYXllci5yaW5ncyB8fCAobG9ubGF0Lmxlbmd0aCA+IDAgPyBbW2xvbmxhdC5sZW5ndGhdXSA6IFtdKTtcclxuICAgIGNvbnN0IHBhcnRzID0gW107XHJcbiAgICBsZXQgYXQgPSAwO1xyXG4gICAgZm9yIChjb25zdCBwYXJ0TGVucyBvZiByaW5nVGFibGUpIHtcclxuICAgICAgICBjb25zdCByaW5ncyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGVuIG9mIHBhcnRMZW5zKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJpbmcgPSBjbG9zZVJpbmcobG9ubGF0LnNsaWNlKGF0LCBhdCArIGxlbikpO1xyXG4gICAgICAgICAgICBhdCArPSBsZW47XHJcbiAgICAgICAgICAgIGlmIChyaW5nLmxlbmd0aCA+PSA0KSByaW5ncy5wdXNoKHJpbmcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocmluZ3MubGVuZ3RoID4gMCkgcGFydHMucHVzaChyaW5ncyk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFydHM7XHJcbn1cclxuXHJcbi8vIGBldmVudHMub25GZWF0dXJlQ2xpY2soeyBsYXllciwgaW5kZXgsIGxhdGxuZyB9KWAgaXMgaG93IGEgY2xpY2sgcmVhY2hlcyB3aGF0ZXZlclxyXG4vLyBob3N0cyB0aGUgbWFwOyB0aGlzIG1vZHVsZSBuZXZlciB3cml0ZXMgc3RhdGUgaXRzZWxmLlxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBldmVudHMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRmVhdHVyZVZpc2libGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBvbkZlYXR1cmVDbGljayA9IChldmVudHMgJiYgZXZlbnRzLm9uRmVhdHVyZUNsaWNrKSB8fCAoKCkgPT4ge30pO1xyXG4gICAgLy8gSGl0LXRlc3QgZ3VhcmQ6IEdQVS1wYXRoIGJ1Y2tldHMgaG9sZCBoaWRkZW4gbGF5ZXJzIChhbmQgb3V0LW9mLXdpbmRvd1xyXG4gICAgLy8gZmVhdHVyZXMpLCBtYXNrZWQgb25seSBieSBzaGFkZXIgdW5pZm9ybXMgZ2xpZnkncyBoaXQtdGVzdHMgY2Fubm90IHNlZS4gVGhlXHJcbiAgICAvLyB3aWRnZXQgcGFzc2VzIGEgbGl2ZSBsb29rdXA7IHRoZSBmYWxsYmFjayBjb3ZlcnMgcGxhaW4tSlMgY29uc3VtZXJzIHdpdGggdGhlXHJcbiAgICAvLyBjb25maWcncyBvd24gZmxhZy5cclxuICAgIGNvbnN0IHZpc2libGVOb3cgPSBpc0ZlYXR1cmVWaXNpYmxlIHx8ICgobCkgPT4gbC52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAvLyBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZSBnZW9tZXRyeSBwZXIgbGF5ZXIuIE9uIHRoZSBHUFUgcGF0aCAobWFwLmpzXHJcbiAgICAvLyBwYXNzZXMgdmVjdG9yR3B1IHdoZW4gdGhlIGJ1Y2tldCBxdWFsaWZpZXMpIGV2ZXJ5IGZlYXR1cmUgc3RheXMgaW4gdGhlIGJ1ZmZlcnMgYW5kXHJcbiAgICAvLyB0aGUgc2hhZGVyIGRlY2lkZXMgdmlzaWJpbGl0eSBwZXIgdGljayBhbmQgcGVyIGxheWVyIHRvZ2dsZSAtLSBhIGxpbmUtc2hhcGVkIHRyYWNrXHJcbiAgICAvLyBoYXMgYXMgbWFueSB2ZXJ0aWNlcyBhcyBhIHBvaW50IHRyYWNrIGhhcyBwb2ludHMsIHNvIGl0cyByZWJ1aWxkcyBjb3N0IHRoZSBzYW1lXHJcbiAgICAvLyBhbmQgY3Jhc2hlZCB0aGUgc2FtZSB3YXkuIE9mZiB0aGUgR1BVIHBhdGgsIHRoZSB3aG9sZS1mZWF0dXJlIENQVSBmaWx0ZXIgcmVtYWlucy5cclxuICAgIGNvbnN0IHZlY3Rvck1ldGEgPSB2ZWN0b3JHcHUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiXHJcbiAgICAgICAgPyBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxyXG4gICAgICAgICAgICB0aW1lU3RhdGUgJiYgdGltZVN0YXRlLnBlcmlvZCA/IHBlcmlvZFRvTXModGltZVN0YXRlLnBlcmlvZCkgOiBudWxsKVxyXG4gICAgICAgIDogeyBoYXNUaW1lOiBmYWxzZSB9O1xyXG4gICAgY29uc3QgdmVjdG9yVGltZSA9IEJvb2xlYW4odmVjdG9yTWV0YS5oYXNUaW1lKTtcclxuICAgIGlmICh0aW1lU3RhdGUgJiYgIXZlY3RvclRpbWUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiKSB7XHJcbiAgICAgICAgbGF5ZXJzTGlzdCA9IGxheWVyc0xpc3QuZmlsdGVyKGwgPT4gbGF5ZXJJbldpbmRvdyhsLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSk7XHJcbiAgICAgICAgaWYgKGxheWVyc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmICh0eXBlID09PSBcInBvbHlsaW5lXCIpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcclxuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xyXG5cclxuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lczogYSBwb2x5Z29uIG9yIGNpcmNsZSBpbiB0aGlzIGJ1Y2tldCBjb250cmlidXRlcyBlYWNoIG9mIGl0c1xyXG4gICAgICAgICAgICAvLyByaW5ncyBhcyBvbmUgTGluZVN0cmluZywgZHJhd24gd2l0aCB0aGUgYXJlYSdzIHN0cm9rZSBvcHRpb25zIC0tIGNvbG9yLFxyXG4gICAgICAgICAgICAvLyB3ZWlnaHQsIG9wYWNpdHksIExlYWZsZXQncyBvd24gc2VtYW50aWNzLiBPdXRsaW5lIHdlaWdodCBhbmQgb3BhY2l0eSBuZXZlclxyXG4gICAgICAgICAgICAvLyByZW5kZXJlZCBiZWZvcmUgdGhpczsgdGhlIGZpbGwgbWFjaGluZXJ5IGNhbm5vdCBkcmF3IHRoZW0gKGdsaWZ5J3MgYm9yZGVyXHJcbiAgICAgICAgICAgIC8vIGlzIDFweCBhbmQgZmlsbC1jb2xvdXJlZCksIHRoZSBsaW5lcyBtYWNoaW5lcnkgYWxyZWFkeSBkb2VzLlxyXG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xyXG4gICAgICAgICAgICAgICAgbGV0IGNvdW50ID0gMDtcclxuICAgICAgICAgICAgICAgIGlmICgoc3R5bGUud2VpZ2h0ID8/IDMpID4gMCAmJiAoc3R5bGUub3BhY2l0eSA/PyAxLjApID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5nIG9mIHJpbmdzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3VudCArPSBNYXRoLm1heCgwLCAyICogKHJpbmcubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHsgdHlwZTogXCJMaW5lU3RyaW5nXCIsIGNvb3JkaW5hdGVzOiByaW5nIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE91dGxpbmUgcGl4ZWxzIG9ubHkgLS0gdGhlIGFyZWEncyBzaGFwZXMgaW5zdGFuY2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gb3ducyBpbnRlcmFjdGlvbiB3aXRoIGV4YWN0IGNvbnRhaW5tZW50LiBMZWZ0XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNsaWNrYWJsZSwgdGhlc2UgcmluZ3MgYW5zd2VyZWQgdGhyb3VnaCBnbGlmeSdzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGxpbmUgdG9sZXJhbmNlICgwLjEgREVHUkVFUyBmb3IgY2xpY2tzIHZzIDAuMDNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZm9yIGhvdmVycyk6IHBvcHVwcyB3ZWxsIG91dHNpZGUgdGhlIHNoYXBlIGFuZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnNpZGUgaG9sZXMsIGhvdmVyIGRpc2FncmVlaW5nIHdpdGggY2xpY2suXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQm9yZGVyOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaChjb3VudCk7ICAgLy8gMCBrZWVwcyB0aGUgc2xvdCBhbGlnbmVkIHdoZW4gc3Ryb2tlbGVzc1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIE9uZSBMaW5lU3RyaW5nIGZlYXR1cmUgUEVSIFBBUlQsIGV2ZXJ5IHBhcnQgY2FycnlpbmcgdGhlIGxheWVyIC0tIG5ldmVyXHJcbiAgICAgICAgICAgIC8vIGEgTXVsdGlMaW5lU3RyaW5nOiBnbGlmeSdzIE11bHRpTGluZVN0cmluZyBwYXRoIGhpdC10ZXN0cyB0aGUgY29ubmVjdG9yXHJcbiAgICAgICAgICAgIC8vIGJldHdlZW4gcGFydHMsIHdoaWNoIGlzIHRoZSBwaGFudG9tIHNlZ21lbnQgYnkgYW5vdGhlciByb3V0ZS4gVGhlIEdMXHJcbiAgICAgICAgICAgIC8vIHZlcnRleCBzdHJlYW0gc3RheXMgY29uc2VjdXRpdmUsIHNvIHRoZSBwZXItbGF5ZXIgY291bnQgc3RpbGwgYWxpZ25zXHJcbiAgICAgICAgICAgIC8vIHRoZSB0aW1lIGF0dHJpYnV0ZXM7IGEgc3Ryb2tlbGVzcyBvciBkZWdlbmVyYXRlIGxheWVyIGtlZXBzIGl0cyBzbG90LlxyXG4gICAgICAgICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgbGluZVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGdlb2pzb25Db29yZHMgPSBwYXJ0Lm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XHJcbiAgICAgICAgICAgICAgICBjb3VudCArPSBNYXRoLm1heCgwLCAyICogKGdlb2pzb25Db29yZHMubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJMaW5lU3RyaW5nXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb3JkaW5hdGVzOiBnZW9qc29uQ29vcmRzXHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUub3BhY2l0eSB8fCAxLjAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBzdHlsZS53ZWlnaHQgfHwgM1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG5cclxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXHJcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XHJcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3QgbGluZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXHJcbiAgICAgICAgICAgICAgICAgICAgPyB7IHZlcnRleFNoYWRlclNvdXJjZTogKCkgPT4gdGltZVZlcnRleFNoYWRlcigpIH0gOiB7fTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZ2xMaW5lcyA9IEwuZ2xpZnkubGluZXMoe1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLmxpbmVPcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxyXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWxpbmVzUGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoZSBkYXRhIGFib3ZlIGlzIEdlb0pTT04sIHdob3NlIGNvb3JkaW5hdGVzIGFyZSBbbG9uLCBsYXRdOyBnbGlmeVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGRlZmF1bHRzIHRvIGxhdGl0dWRlLWZpcnN0IGFuZCBpdHMgTElORSB2ZXJ0ZXggYnVpbGRlciByZWFkc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGNvb3JkaW5hdGVzIHRocm91Z2ggdGhlc2Uga2V5cyAtLSB1bnNldCwgaXQgdG9vayBsb25naXR1ZGUgYXNcclxuICAgICAgICAgICAgICAgICAgICAvLyBsYXRpdHVkZSBhbmQgcHJvamVjdGVkIGV2ZXJ5IGxpbmUgb2ZmLXZpZXdwb3J0LiBTaWxlbnRseTogbm8gR0xcclxuICAgICAgICAgICAgICAgICAgICAvLyBlcnJvciwgYSBoZWFsdGh5IGNhbnZhcywgemVybyBmcmFnbWVudHMuIFNldCBwZXIgaW5zdGFuY2UgcmF0aGVyXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiBvbiB0aGUgTC5nbGlmeSBnbG9iYWwsIHdoaWNoIGFub3RoZXIgbGlicmFyeSBjb3VsZCBhbHNvXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gbXV0YXRlLiBUaGUgcG9seWdvbiBwYXRoIGlzIGRlbGliZXJhdGVseSBOT1QgZ2l2ZW4gdGhlc2Uga2V5czpcclxuICAgICAgICAgICAgICAgICAgICAvLyBpdCB0cmlhbmd1bGF0ZXMgdmlhIGVhcmN1dCBvbiB0aGUgR2VvSlNPTiBkaXJlY3RseSwgbmF0aXZlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gW2xvbiwgbGF0XSwgYW5kIGtleXMgdGhlcmUgd291bGQgdHJhbnNwb3NlIGl0IHRoZSBzYW1lIHdheS5cclxuICAgICAgICAgICAgICAgICAgICAvLyBGb3VuZCBieSB0aGUgVmFsaGFsbGEtVlJFIGJ1ZyByZXBvcnQsIGRyaXZpbmcgdGhlIHBsYWluLUpTXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYnVuZGxlIHdoZXJlIG5vIHBvaW50cyBtYXNrZWQgdGhlIGJsYW5rIGxpbmVzLlxyXG4gICAgICAgICAgICAgICAgICAgIGxhdGl0dWRlS2V5OiAxLFxyXG4gICAgICAgICAgICAgICAgICAgIGxvbmdpdHVkZUtleTogMCxcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLndlaWdodDtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZlYXR1cmUgfHwgIWZlYXR1cmUucHJvcGVydGllcyB8fCBmZWF0dXJlLnByb3BlcnRpZXMuaXNCb3JkZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIXZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAyLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkOiB0aGUgaG9zdCByZWNvcmRzIFwid2hlcmVcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCBcIm9uIHdoYXRcIiAtLSBzZWUgb25GZWF0dXJlQ2xpY2sgaW4gY29yZS5qcy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyLCBpbmRleDogMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubGF0ICogMWU1KSAvIDFlNSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgIWZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIHZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xMaW5lcyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zZW5zaXRpdml0eU9mZiA9IHRyYWNrTGluZVNlbnNpdGl2aXR5KG0sIHRoaXMuZ2xMaW5lcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xMaW5lcywgdmVjdG9yTWV0YSwgdmVydGV4Q291bnRzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2Vuc2l0aXZpdHlPZmYpIHRoaXMuX3NlbnNpdGl2aXR5T2ZmKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbExpbmVzKSB0aGlzLmdsTGluZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xyXG4gICAgICAgICAgICBjb25zdCBwYXJ0cyA9IGFyZWFQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaCgwKTsgICAvLyBubyBmZWF0dXJlLCBidXQgdGhlIHNsb3QgbXVzdCBzdGF5IGFsaWduZWRcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIEFueSB0cmlhbmd1bGF0aW9uIG9mIGEgcG9seWdvbiB3aXRoIEQgZGlzdGluY3QgdmVydGljZXMgYW5kIGggaG9sZXMgaGFzXHJcbiAgICAgICAgICAgIC8vIGV4YWN0bHkgRCArIDJoIC0gMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3NcclxuICAgICAgICAgICAgLy8gZWFyY3V0OyBoID0gMCBnaXZlcyB0aGUgZmFtaWxpYXIgRCAtIDIuIFJpbmdzIGFyZSBjbG9zZWQgYnkgbm93LCBzbyBlYWNoXHJcbiAgICAgICAgICAgIC8vIGNvbnRyaWJ1dGVzIGxlbmd0aCAtIDEgZGlzdGluY3QgdmVydGljZXMuIFBhcnRzIHRyaWFuZ3VsYXRlIHNlcGFyYXRlbHlcclxuICAgICAgICAgICAgLy8gYW5kIHN1bS5cclxuICAgICAgICAgICAgbGV0IHRyaWFuZ2xlcyA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgcGFydHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGRpc3RpbmN0ID0gcmluZ3MucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIubGVuZ3RoIC0gMSwgMCk7XHJcbiAgICAgICAgICAgICAgICB0cmlhbmdsZXMgKz0gTWF0aC5tYXgoMCwgZGlzdGluY3QgKyAyICogKHJpbmdzLmxlbmd0aCAtIDEpIC0gMik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMyAqIHRyaWFuZ2xlcyk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcclxuICAgICAgICAgICAgLy8gTGVhZmxldCdzIG93biBzZW1hbnRpY3M6IHRoZSBmaWxsIGlzIGZpbGxDb2xvciwgZGVmYXVsdGluZyB0byB0aGUgc3Ryb2tlXHJcbiAgICAgICAgICAgIC8vIGNvbG9yIHdoZW4gdW5zZXQuIEl0IHVzZWQgdG8gYWx3YXlzIGZpbGwgd2l0aCBgY29sb3JgLCB3aGljaCBtYWRlXHJcbiAgICAgICAgICAgIC8vIFwicmVkIG91dGxpbmUsIHBhbGUgYmx1ZSBmaWxsXCIgLS0gdGhlIG1vc3QgYmFzaWMgcG9seWdvbiBzdHlsaW5nIGFzayAtLVxyXG4gICAgICAgICAgICAvLyBpbXBvc3NpYmxlOyB0aGUgb3V0bGluZSBpdHNlbGYgaXMgZHJhd24gYnkgdGhlIGxpbmVzIGJ1Y2tldC5cclxuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5maWxsQ29sb3IgfHwgc3R5bGUuZmlsbF9jb2xvciB8fCBzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xyXG4gICAgICAgICAgICAvLyBPbmUgRmVhdHVyZSBQRVIgUEFSVCwgbmV2ZXIgYSBNdWx0aVBvbHlnb246IGdsaWZ5J3Mgc2hhcGVzIG9ubHlcclxuICAgICAgICAgICAgLy8gZXhwbG9kZXMgTXVsdGlQb2x5Z29uIHdoZW4gaGFuZGVkIGEgYmFyZSBGZWF0dXJlIG9yIGdlb21ldHJ5IC0tIGluIGFcclxuICAgICAgICAgICAgLy8gRmVhdHVyZUNvbGxlY3Rpb24gdGhlIGNvb3JkaW5hdGVzIHJlYWNoIGVhcmN1dC5mbGF0dGVuIHVuZXhwbG9kZWQsXHJcbiAgICAgICAgICAgIC8vIGVhcmN1dCByZXR1cm5zIG5vIGluZGljZXMsIGFuZCB0aGUgZmVhdHVyZSBzaWxlbnRseSBkcmF3cyBaRVJPIGZpbGxcclxuICAgICAgICAgICAgLy8gdHJpYW5nbGVzICh2ZXJpZmllZCBhZ2FpbnN0IGdsaWZ5IDMuMy4wOyBpdHMgXCJ1bmhhbmRsZWQgcG9seWdvblwiXHJcbiAgICAgICAgICAgIC8vIHRocm93IHNpdHMgaW5zaWRlIHRoZSBlbXB0eSBsb29wIGFuZCBuZXZlciBmaXJlcykuIFBhcnRzIHN0YXlcclxuICAgICAgICAgICAgLy8gY29uc2VjdXRpdmUsIHNvIHBlci1sYXllciB2ZXJ0ZXhDb3VudHMgc3RpbGwgYWxpZ24gZm9yIEdQVSB0aW1lLlxyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmdzIG9mIHBhcnRzKSB7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIlBvbHlnb25cIiwgY29vcmRpbmF0ZXM6IHJpbmdzIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLmZpbGxPcGFjaXR5IHx8IDAuMiB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG5cclxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xyXG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXHJcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XHJcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hhcGVPcHRpb25zID0gdmVjdG9yVGltZVxyXG4gICAgICAgICAgICAgICAgICAgID8geyB2ZXJ0ZXhTaGFkZXJTb3VyY2U6ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKSB9IDoge307XHJcbiAgICAgICAgICAgICAgICB0aGlzLmdsU2hhcGVzID0gTC5nbGlmeS5zaGFwZXMoe1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLnNoYXBlT3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogZ2VvanNvbixcclxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZlYXR1cmUgfHwgIWZlYXR1cmUucHJvcGVydGllcyB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIXZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkOiB0aGUgaG9zdCByZWNvcmRzIFwid2hlcmVcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCBcIm9uIHdoYXRcIiAtLSBzZWUgb25GZWF0dXJlQ2xpY2sgaW4gY29yZS5qcy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyLCBpbmRleDogMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubGF0ICogMWU1KSAvIDFlNSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XHJcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcclxuXHJcbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xyXG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcclxuICAgIC8vIGNpcmNsZSBiZWNhdXNlIHRoZSBnbHlwaCBpcyBkcmF3biBpbnNpZGUgdGhlIHBvaW50J3Mgb3duIHF1YWQgYnkgdGhlIHNoYWRlci5cclxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XHJcblxyXG4gICAgLy8gR1BVIHRpbWUgcGF0aDogd2hlbiB0aGlzIGJ1Y2tldCBob2xkcyB0aW1lIGxheWVycywgZXZlcnkgcG9pbnQgaXMgZmVkIHRvIGdsaWZ5IGFuZFxyXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXHJcbiAgICAvLyB2ZXJ0ZXggc2hhZGVyLCBzbyBhIHRpY2sgY29zdHMgdHdvIHVuaWZvcm1zIGluc3RlYWQgb2YgcmVidWlsZGluZyA1TSBwb2ludHMgaW4gSlMuXHJcbiAgICAvLyBUaGUgQ1BVIGZpbHRlciBiZWxvdyBzdGF5cyBhcyB0aGUgZmFsbGJhY2sgd2hlbiB0aGUgR0wgd2lyaW5nIGlzIHVuYXZhaWxhYmxlLlxyXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcclxuICAgICAgICA/IGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCBncHVUaW1lID0gQm9vbGVhbihncHVBdHRycy5oYXNUaW1lKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyU2l6ZSA9IGxheWVyLnJhZGl1cyAhPSBudWxsID8gTnVtYmVyKGxheWVyLnJhZGl1cykgOiBkZWZhdWx0U2l6ZTtcclxuXHJcbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XHJcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCLFxyXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxyXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVPZmZzZXQsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGNvb3Jkcy5sZW5ndGggLyAyO1xyXG5cclxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XHJcbiAgICAgICAgLy8gU2VsZWN0aW9uIHN0eWxpbmcsIGFwcGxpZWQgb3ZlciB0aGUgbGF5ZXIncyBvd24gYW5kIGl0cyBkYXRhLWRyaXZlbiBzdHlsZXMuXHJcbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cclxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcclxuICAgICAgICBjb25zdCBvdmVycmlkZXMgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgfHwgbnVsbDtcclxuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxyXG4gICAgICAgIC8vIHU4IFJHQkEgdW5kZXIgXCI8aWQ+Ojpjb2xvcnNcIiwgZjMyIHBpeGVscyB1bmRlciBcIjxpZD46OnJhZGlpXCIgLS0gY29tcHV0ZWRcclxuICAgICAgICAvLyBpbiBQeXRob24gZnJvbSBjb2xvcl9jb2wvcmFkaXVzX2NvbC4gQnVmZmVycywgbmV2ZXIgcGVyLWZlYXR1cmUgc3R5bGVcclxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxyXG4gICAgICAgIC8vIHBheWxvYWQgdGhhdCB1c2VkIHRvIGtpbGwgc2Vzc2lvbnMuIEV4cGxpY2l0IHN0eWxlcyBzdGlsbCBvdXRyYW5rIHRoZW0uXHJcbiAgICAgICAgY29uc3QgY29sb3JzUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojpjb2xvcnNgXTtcclxuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcclxuICAgICAgICAgICAgPyBuZXcgVWludDhBcnJheShjb2xvcnNSYXcuYnVmZmVyIHx8IGNvbG9yc1JhdywgY29sb3JzUmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcnNSYXcuYnl0ZUxlbmd0aClcclxuICAgICAgICAgICAgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IHJhZGlpUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9OjpyYWRpaWBdO1xyXG4gICAgICAgIGNvbnN0IGJ1ZlJhZGlpID0gcmFkaWlSYXdcclxuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmFkaWlSYXcuYnl0ZUxlbmd0aCAvIDQpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxyXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcclxuICAgICAgICAvLyBvbiB0aGUgc3Vydml2b3JzIGtlZXAgcG9pbnRpbmcgYXQgdGhlIHJpZ2h0IHJvd3MuXHJcbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGZyb21EYXRhID0gcGVyRmVhdHVyZSA/IHBlckZlYXR1cmVbaV0gOiBudWxsO1xyXG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxyXG4gICAgICAgICAgICAgICAgfHwgKGhpZ2hsaWdodCAmJiBoaWdobGlnaHQuY29sb3IpXHJcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xyXG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LnJhZGl1cyAhPSBudWxsID8gaGlnaGxpZ2h0LnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xyXG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxyXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZkNvbG9ycyA/IHsgcjogYnVmQ29sb3JzW2kgKiA0XSAvIDI1NSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZzogYnVmQ29sb3JzW2kgKiA0ICsgMV0gLyAyNTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhOiBidWZDb2xvcnNbaSAqIDQgKyAzXSAvIDI1NSB9XHJcbiAgICAgICAgICAgICAgICAgICAgOiBjb2xvclJHQixcclxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZlJhZGlpID8gYnVmUmFkaWlbaV1cclxuICAgICAgICAgICAgICAgICAgICA6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXHJcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcclxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcclxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cclxuICAgICAgICAgICAgICAgIHNpemU6IChpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyA/IGluZm8uY29sb3JSR0IgOiB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc2Vuc2l0aXZpdHk6IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjAgOiA4LFxyXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlZCBCRUZPUkUgY29tcGV0aW5nIGZvciB0aGUgY2xpY2s6IGEgaGlkZGVuIG9yXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gb3V0LW9mLXdpbmRvdyBwb2ludCBtdXN0IG5vdCBlbnRlciB0aGUgYXJiaXRyYXRpb24gYXQgYWxsLCBzb1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoYXRldmVyIHNpdHMgYmVuZWF0aCBpdCAtLSBhIHZpc2libGUgZmVhdHVyZSwgb3IgdGhlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZW1wdHktbWFwIGZhbGxiYWNrIC0tIHdpbnMgaW5zdGVhZC5cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZUluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXByZUluZm8gfHwgIXZpc2libGVOb3cocHJlSW5mby5sYXllciwgcHJlSW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHByZUluZm87XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGNsaWNrZWQgcG9pbnQncyBvd24gY29vcmRpbmF0ZXMgLS0gbW9yZSB0cnV0aGZ1bFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiB0aGUgbW91c2UgcG9zaXRpb24gZm9yIGEgcG9pbnQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZlYXR1cmVDbGljayh7IGxheWVyLCBpbmRleDogb3JpZ2luYWxJbmRleCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF0bG5nOiBbcG9pbnRbMF0sIHBvaW50WzFdXSB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocG9pbnQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCB0b29sdGlwcyBvbiBmYXIgYXdheSBob3ZlcnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaG92ZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gaG92ZXJQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFpbmZvIHx8ICF2aXNpYmxlTm93KGluZm8ubGF5ZXIsIGluZm8ub3JpZ2luYWxJbmRleCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAxLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICBpZiAodHlwZSA9PT0gXCJtYXJrZXJzXCIpIHtcclxuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy5mcmFnbWVudFNoYWRlclNvdXJjZSA9ICgpID0+IHBpblNoYWRlcjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcclxuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy52ZXJ0ZXhTaGFkZXJTb3VyY2UgPSAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhpcy5nbFBvaW50cyA9IEwuZ2xpZnkucG9pbnRzKGdsaWZ5T3B0aW9ucyk7XHJcbiAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xQb2ludHMpO1xyXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gTnVsbCBvbiBmYWlsdXJlLCB3aGljaCBhbHNvIGZsaXBzIHRoZSBnbG9iYWwgZmxhZzogdGhlIG5leHQgc3luYydzXHJcbiAgICAgICAgICAgICAgICAvLyByZWJ1aWxkIGtleSBjaGFuZ2VzIHdpdGggaXQgYW5kIHRoZSBDUFUgcGF0aCB0YWtlcyBvdmVyLlxyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvSW5zdGFuY2UodGhpcy5nbFBvaW50cywgZ3B1QXR0cnMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcclxuICAgICAgICAgICAgaWYgKGNhbnZhcykgY2FudmFzLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcclxuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XHJcbiAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgcmV0dXJuIGluc3RhbmNlO1xyXG59XHJcbiIsICIvLyBQZXJtYW5lbnQgZmVhdHVyZSBsYWJlbHM6IHRleHQgcGlubmVkIHRvIHRoZSBtYXAsIGZyb20gYSBsYXllcidzIGBsYWJlbGAgKG9uZVxyXG4vLyB2ZWN0b3IgZmVhdHVyZSkgb3IgYGxhYmVsc2AgKG9uZSBwZXIgcG9pbnQsIGFsaWduZWQgd2l0aCB0aGUgY29vcmRpbmF0ZSBidWZmZXIpLlxyXG4vLyBET00gZWxlbWVudHMgYnkgZGVzaWduIC0tIExlYWZsZXQgcGVybWFuZW50IHRvb2x0aXBzIC0tIHdoaWNoIGlzIHdoeSB0aGV5IGFyZSBmb3JcclxuLy8gc2l0ZS1zY2FsZSBsYXllcnM7IFB5dGhvbiB3YXJucyBwYXN0IGEgdGhvdXNhbmQuIE1vZGVsLWZyZWUgbGlrZSB0aGUgbGVnZW5kOiBwdXJlXHJcbi8vIGRhdGEgaW4sIExlYWZsZXQgbGF5ZXJzIG91dCwgcmUtZGVyaXZlZCBlYWNoIHN5bmMgc28gbGFiZWxzIGZvbGxvdyB2aXNpYmlsaXR5XHJcbi8vIHdpdGhvdXQgdG91Y2hpbmcgdGhlIEdMIGJ1Y2tldHMgb3IgdGhlaXIgbWV0YSBrZXlzLlxyXG5cclxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9wYXRjaC5qc1wiO1xyXG5pbXBvcnQgeyB2ZWN0b3JDb29yZHMsIGxpbmVQYXJ0cyB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xyXG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFdoZXRoZXIgYSB3aG9sZSBsYWJlbGxlZCBmZWF0dXJlIGlzIGluc2lkZSB0aGUgY3VycmVudCB0aW1lIHdpbmRvdy4gTmFOIHRpbWVzXHJcbi8vIGtlZXAgdGhlIGxhYmVsLCBtYXRjaGluZyB0aGUgbWFwOiBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YSwgc28gaXRcclxuLy8gbXVzdCBuZXZlciBoaWRlIHRoZSBkYXRhJ3MgbGFiZWwgZWl0aGVyLiBBIG11bHRpLXNwYW4gbGluZSBjb3VudHMgYXMgdmlzaWJsZVxyXG4vLyB3aGlsZSBBTlkgb2YgaXRzIHNlZ21lbnRzIGlzIC0tIHRoZSBsYWJlbCBmb2xsb3dzIHRoZSBsYXllciwgbm90IG9uZSBsZWcuXHJcbmZ1bmN0aW9uIHRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghdGltZVN0YXRlIHx8ICFsYXllci50aW1lKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIHJldHVybiB0cnVlO1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIE9uZSBhbmNob3IgcGVyIGxhYmVsbGVkIGZlYXR1cmUuIFBvaW50cyBsYWJlbCBhdCB0aGUgcG9pbnQ7IGEgbGluZSBsYWJlbHMgYXQgaXRzXHJcbi8vIG1pZGRsZSB2ZXJ0ZXggKG9uIHRoZSBsaW5lLCBub3QgZmxvYXRpbmcgaW4gaXRzIGJvdW5kaW5nIGJveCk7IGEgcG9seWdvbiBvclxyXG4vLyBjaXJjbGUgbGFiZWxzIGF0IGl0cyBib3VuZHMgY2VudHJlLiBXaXRoIGEgdGltZVN0YXRlLCBsYWJlbHMgZm9sbG93IHRoZSB3aW5kb3c6XHJcbi8vIHBvaW50cyBkcm9wIHBlciBwb2ludCwgdmVjdG9ycyBhcyBhIHdob2xlLlxyXG4vLyBEZWdyZWUtc3BhY2UgbGVuZ3RoIG9mIGEgW2xhdCwgbG5nXSBydW4gLS0gb25seSBldmVyIGNvbXBhcmVkIGFnYWluc3QgYW5vdGhlclxyXG4vLyBwYXJ0IG9mIHRoZSBzYW1lIGxpbmUsIHNvIG5vIHByb2plY3Rpb24gaXMgbmVlZGVkIHRvIHBpY2sgdGhlIGxvbmdlciBvbmUuXHJcbmZ1bmN0aW9uIHBsYW5hckxlbmd0aChwYXJ0KSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBwYXJ0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZExhdCA9IHBhcnRbaV1bMF0gLSBwYXJ0W2kgLSAxXVswXTtcclxuICAgICAgICBjb25zdCBkTG5nID0gcGFydFtpXVsxXSAtIHBhcnRbaSAtIDFdWzFdO1xyXG4gICAgICAgIHRvdGFsICs9IE1hdGguc3FydChkTGF0ICogZExhdCArIGRMbmcgKiBkTG5nKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0b3RhbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IG91dCA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSBjb250aW51ZTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLmNvbGxlY3RMYWJlbHMobGF5ZXIubGF5ZXJzIHx8IFtdLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSkpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobGF5ZXIubGFiZWxzKSkge1xyXG4gICAgICAgICAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICBpZiAoIXJhdykgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgICAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihsYXllci5sYWJlbHMubGVuZ3RoLCBjb29yZHMubGVuZ3RoIC8gMik7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllci5sYWJlbHNbaV0pIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbaSAqIDJdKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGNvb3Jkc1tpICogMl0sIGxuZzogY29vcmRzW2kgKiAyICsgMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbHNbaV0pLCBjZW50ZXI6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChsYXllci5sYWJlbCkge1xyXG4gICAgICAgICAgICBpZiAoIXRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgICAgICAgICAgLy8gQW5jaG9yIE9OIGEgcGFydCAtLSB0aGUgbWlkZGxlIHZlcnRleCBvZiB0aGUgbG9uZ2VzdCBwYXJ0LiBUaGVcclxuICAgICAgICAgICAgICAgIC8vIG1pZGRsZSBvZiBhIG11bHRpLXBhcnQgbGluZSdzIHdob2xlIHZlcnRleCBydW4gY2FuIHNpdCBpbiB0aGUgZ2FwXHJcbiAgICAgICAgICAgICAgICAvLyBiZXR3ZWVuIHBhcnRzLCB3aGVyZSB0aGVyZSBpcyBub3RoaW5nIHRvIGxhYmVsLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFydHMgPSBsaW5lUGFydHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb25nZXN0ID0gcGFydHMucmVkdWNlKChiZXN0LCBwYXJ0KSA9PlxyXG4gICAgICAgICAgICAgICAgICAgIHBsYW5hckxlbmd0aChwYXJ0KSA+IHBsYW5hckxlbmd0aChiZXN0KSA/IHBhcnQgOiBiZXN0LCBwYXJ0c1swXSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtaWQgPSBsb25nZXN0W01hdGguZmxvb3IoKGxvbmdlc3QubGVuZ3RoIC0gMSkgLyAyKV07XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbWlkWzBdLCBsbmc6IG1pZFsxXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5ib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtbYUxhdCwgYUxvbl0sIFtiTGF0LCBiTG9uXV0gPSBsYXllci5ib3VuZHM7XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKGFMYXQgKyBiTGF0KSAvIDIsIGxuZzogKGFMb24gKyBiTG9uKSAvIDIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5sb2NhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGxheWVyLmxvY2F0aW9uWzBdLCBsbmc6IGxheWVyLmxvY2F0aW9uWzFdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBObyBib3VuZHMgb24gdGhlIGNvbmZpZyAtLSB0aGUgY29sbGVjdGlvbiBtZXJnZSBkcm9wcGVkIHRoZW0gZm9yXHJcbiAgICAgICAgICAgICAgICAvLyBpdHMgd2hvbGUgaGlzdG9yeSwgYW5kIGhhbmQtYnVpbHQgY29uZmlncyBtYXkgbmV2ZXIgY2FycnkgdGhlbS5cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBjb29yZGluYXRlcyBhcmUgc3RpbGwgaW4gdGhlIGJ1ZmZlciB1bmRlciB0aGUgbGF5ZXIncyBvd24gaWQsXHJcbiAgICAgICAgICAgICAgICAvLyBleGFjdGx5IGFzIHRoZSBwb2x5bGluZSBicmFuY2ggcmVhZHMgdGhlbTsgYSBtaXNzaW5nIGJveCBtdXN0XHJcbiAgICAgICAgICAgICAgICAvLyBkZWdyYWRlIHRvIGNvbXB1dGluZyBvbmUsIG5ldmVyIHRvIHNpbGVudGx5IGRyb3BwaW5nIHRoZSBsYWJlbC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvY3MubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICAgICAgbGV0IG1pbkxuZyA9IEluZmluaXR5LCBtYXhMbmcgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtsYXQsIGxuZ10gb2YgbG9jcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA8IG1pbkxuZykgbWluTG5nID0gbG5nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsbmcgPiBtYXhMbmcpIG1heExuZyA9IGxuZztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAobWluTGF0ICsgbWF4TGF0KSAvIDIsIGxuZzogKG1pbkxuZyArIG1heExuZykgLyAyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBSZWJ1aWxkcyBgZ3JvdXBgIChhbiBMLmxheWVyR3JvdXApIHRvIGhvbGQgZXhhY3RseSB0aGUgY3VycmVudCBsYWJlbHMsIHNraXBwaW5nXHJcbi8vIHRoZSB3b3JrIHdoZW4gbm90aGluZyBjaGFuZ2VkIC0tIHN5bmNzIHJ1biBvbiBldmVyeSB0b2dnbGUgYW5kIHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMYWJlbHMoTCwgZ3JvdXAsIGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBsYWJlbHMgPSBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUpO1xyXG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkobGFiZWxzKTtcclxuICAgIGlmIChncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9PT0ga2V5KSByZXR1cm47XHJcbiAgICBncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9IGtleTtcclxuICAgIGdyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbGFiZWxzKSB7XHJcbiAgICAgICAgLy8gQ29udGVudCBhcyBhbiBlbGVtZW50IHdpdGggdGV4dENvbnRlbnQ6IHRvb2x0aXAgc3RyaW5nIGNvbnRlbnQgaXMgSFRNTCxcclxuICAgICAgICAvLyBhbmQgbGFiZWxzIGNvbWUgZnJvbSB1c2VyIGRhdGEsIHdoaWNoIG11c3QgbmV2ZXIgcGFyc2UgYXMgbWFya3VwLlxyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gaXRlbS50ZXh0O1xyXG4gICAgICAgIGNvbnN0IHRvb2x0aXAgPSBMLnRvb2x0aXAoe1xyXG4gICAgICAgICAgICBwZXJtYW5lbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGRpcmVjdGlvbjogaXRlbS5jZW50ZXIgPyBcImNlbnRlclwiIDogXCJ0b3BcIixcclxuICAgICAgICAgICAgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWZlYXR1cmUtbGFiZWxcIixcclxuICAgICAgICAgICAgb2Zmc2V0OiBpdGVtLmNlbnRlciA/IFswLCAwXSA6IFswLCAtNl0sXHJcbiAgICAgICAgfSkuc2V0TGF0TG5nKFtpdGVtLmxhdCwgaXRlbS5sbmddKS5zZXRDb250ZW50KHNwYW4pO1xyXG4gICAgICAgIGdyb3VwLmFkZExheWVyKHRvb2x0aXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBMLCBwcm92aWRlTGVhZmxldCwgcmVxdWlyZUxlYWZsZXQgfSBmcm9tIFwiLi9saWJzLmpzXCI7XHJcbmltcG9ydCB7IHdhcm5MYXllclByb2JsZW1zIH0gZnJvbSBcIi4vdmFsaWRhdGUuanNcIjtcclxuaW1wb3J0IHsgcmVuZGVyU2lkZWJhckNvbnRyb2xzLCBub3JtYWxpemVSYWRpb0xheWVycywgc2lkZWJhckNvbGxhcHNlU3RhdGUgfSBmcm9tIFwiLi9zaWRlYmFyLmpzXCI7XHJcbmltcG9ydCB7IGRlcml2ZUxlZ2VuZFNwZWMsIHJlbmRlckxlZ2VuZCB9IGZyb20gXCIuL2xlZ2VuZC5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJMYWJlbHMgfSBmcm9tIFwiLi9sYWJlbHMuanNcIjtcclxuaW1wb3J0IHsgcmVuZGVyTGF5ZXIsIHJlbmRlck1lcmdlZEdsTGF5ZXIsIHJlZ2lzdGVyQ2xpY2tNYXRjaCwgaW1hZ2VNZXRhS2V5IH0gZnJvbSBcIi4vbGF5ZXJzLmpzXCI7XHJcbmltcG9ydCB7IHBhcnNlUGVyaW9kLCBnZW5lcmF0ZVRpY2tzLCBjb2xsZWN0VGltZUV4dGVudCwgaGFzVGltZUxheWVycyxcclxuICAgICAgICAgbGF5ZXJJbldpbmRvdywgcmVuZGVyVGltZUNvbnRyb2wsIGFkdmFuY2UsIHBlcmlvZFRvTXMsIGdjZEdyaWRNcyxcclxuICAgICAgICAgY29sbGVjdER1cmF0aW9uc01zLCBQT1NJVElPTlMsIHRpbWVzRm9yLCB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdyxcclxuICAgICAgICAgZWZmZWN0aXZlRHVyYXRpb24sIG5lYXJlc3RUaWNrSW5kZXggfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBncHVUaW1lQXZhaWxhYmxlLCB2ZWN0b3JHcHVBdmFpbGFibGUsIExBWUVSX1NMT1RTIH0gZnJvbSBcIi4vZ3B1dGltZS5qc1wiO1xyXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSwgY29sbGVjdFdlYmdsTGF5ZXJzLCBjb2xsZWN0UG9pbnRMYXllcnNBbGwsXHJcbiAgICAgICAgIGFwcGx5U3dpZnRtYXBQYXRjaCwgYnVmZmVyU2VyaWFsIH0gZnJvbSBcIi4vcGF0Y2guanNcIjtcclxuXHJcbi8vIFRoZSBzaWRlYmFyJ3MgdG9nZ2xlIHdyaXRlLWJhY2s6IHRhcmdldGVkIHZpc2liaWxpdHkgZmxpcHMgdGhyb3VnaCBzZW5kKCksXHJcbi8vIG5ldmVyIHRoZSBsYXllcnMgdHJhaXQuIFRoZSBmdWxsIHdyaXRlIHNjYWxlZCB3aXRoIHRoZSBtYXAgaW5zdGVhZCBvZiB0aGVcclxuLy8gY2xpY2sgLS0gMzYgTUIgYXQgMjUgdHJhY2tzIHggMjAwayB2ZXJ0aWNlcywgcGFzdCB1dmljb3JuJ3MgMTYgTUIgZGVmYXVsdFxyXG4vLyB3ZWJzb2NrZXQgY2FwLCB3aGljaCBjbG9zZXMgdGhlIGNvbm5lY3Rpb24gYW5kIGVuZHMgdGhlIFNoaW55IHNlc3Npb24uXHJcbmV4cG9ydCBmdW5jdGlvbiBzZW5kTGF5ZXJXcml0ZShob3N0LCBjaGFuZ2VzKSB7XHJcbiAgICBpZiAoIWNoYW5nZXMubGVuZ3RoKSByZXR1cm47XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGhvc3Quc2VuZCh7XHJcbiAgICAgICAgICAgIGtpbmQ6IFwic3dpZnRtYXBfd3JpdGVcIixcclxuICAgICAgICAgICAgb3BzOiBjaGFuZ2VzLm1hcChjID0+ICh7IG9wOiBcInNldFwiLCBpZDogYy5pZCwgZmllbGRzOiB7IHZpc2libGU6IGMudmlzaWJsZSB9IH0pKSxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSByZW5kZXJlZCBsaXN0IGFscmVhZHkgaG9sZHMgdGhlIGNoYW5nZSAqLyB9XHJcbn1cclxuXHJcbi8vIE1vdW50cyBvbmUgc3dpZnRtYXAgbWFwIGludG8gYGVsYCwgZHJpdmVuIGJ5IGEgaG9zdCAtLSBzZWUgc3JjL2hvc3QuanMgZm9yIHRoZVxyXG4vLyBpbnRlcmZhY2UuIFRoZSB3aWRnZXQsIGEgc3RhdGljIGV4cG9ydCBhbmQgYSBSZWFjdCBjb21wb25lbnQgYXJlIGFsbCBob3N0cyBvdmVyXHJcbi8vIHRoaXMgb25lIGZ1bmN0aW9uOyBpdCBuZXZlciBzZWVzIGFuIGFueXdpZGdldCBtb2RlbCwgb25seSB0aGUgZml2ZSBob3N0IG1ldGhvZHMuXHJcbi8vXHJcbi8vIFJldHVybnMgYSBoYW5kbGU6IHRoZSBMZWFmbGV0IG1hcCwgdGhlIGNvbnRhaW5lciBlbGVtZW50LCBhIGBzeW5jYCB0byBmb3JjZSBhXHJcbi8vIHJlLXJlbmRlciwgYW5kIGBkZXN0cm95YCB0byB0ZWFyIGV2ZXJ5dGhpbmcgZG93bi5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVN3aWZ0TWFwKHsgaG9zdCwgZWwsIGxlYWZsZXQgPSBudWxsIH0pIHtcclxuICAgIC8vIExlYWZsZXQgLS0gd2l0aCBnbGlmeSBhbmQgR2VvbWFuIGF0dGFjaGVkIC0tIGNvbWVzIGZyb20gdGhlIGhvc3QsIGFuZCBpdFxyXG4gICAgLy8gbXVzdCBhbHJlYWR5IGJlIGhlcmU6IHRoZSBtYXAgYmVsb3cgaXMgYnVpbHQgZnJvbSBpdCwgYW5kIEdlb21hbidzIGluaXRcclxuICAgIC8vIGhvb2sgb25seSByZWFjaGVzIG1hcHMgY3JlYXRlZCBhZnRlciB0aGUgcGx1Z2luIGV4aXN0cy5cclxuICAgIGlmIChsZWFmbGV0KSBwcm92aWRlTGVhZmxldChsZWFmbGV0KTtcclxuICAgIHJlcXVpcmVMZWFmbGV0KCk7XHJcblxyXG4gICAgLy8gRXZlcnkgaG9zdCBzdWJzY3JpcHRpb24sIHNvIGRlc3Ryb3koKSBjYW4gdW5zdWJzY3JpYmUgZnJvbSBhIGhvc3QgdGhhdFxyXG4gICAgLy8gb2ZmZXJzIGBvZmZgIChhbnl3aWRnZXQncyBtb2RlbCBkb2VzOyBhIG1pbmltYWwgc3R1YiBtYXkgbm90KS5cclxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBbXTtcclxuICAgIGZ1bmN0aW9uIGxpc3RlbihldmVudCwgZm4pIHtcclxuICAgICAgICBzdWJzY3JpcHRpb25zLnB1c2goW2V2ZW50LCBmbl0pO1xyXG4gICAgICAgIGhvc3Qub24oZXZlbnQsIGZuKTtcclxuICAgIH1cclxuICAgIGxldCBkZXN0cm95ZWQgPSBmYWxzZTtcclxuXHJcbiAgICBjb25zdCBvcmlnaW5hbEVycm9yID0gY29uc29sZS5lcnJvcjtcclxuICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcclxuXHJcbiAgICAvLyBqc19jb25zb2xlX2xvZ3MgaXMgYSBzeW5jZWQgbGlzdCwgc28gZWFjaCBhcHBlbmQgcmVzZW5kcyB0aGUgd2hvbGUgYXJyYXkuIEtlZXBpbmdcclxuICAgIC8vIG9ubHkgdGhlIG1vc3QgcmVjZW50IGVudHJpZXMgYm91bmRzIGJvdGggdGhlIHBheWxvYWQgYW5kIHRoZSBtZW1vcnkgYSBsb25nLWxpdmVkXHJcbiAgICAvLyBzZXNzaW9uIGFjY3VtdWxhdGVzOyB0aGUgbmV3ZXN0IGFyZSB0aGUgb25lcyB3b3J0aCBoYXZpbmcgYW55d2F5LlxyXG4gICAgY29uc3QgTUFYX0NPTlNPTEVfTE9HUyA9IDIwMDtcclxuICAgIGNvbnN0IGFwcGVuZExvZyA9IGVudHJ5ID0+IHtcclxuICAgICAgICBjb25zdCBsb2dzID0gaG9zdC5nZXQoXCJqc19jb25zb2xlX2xvZ3NcIikgfHwgW107XHJcbiAgICAgICAgY29uc3QgbmV4dCA9IFsuLi5sb2dzLCBlbnRyeV07XHJcbiAgICAgICAgcmV0dXJuIG5leHQubGVuZ3RoID4gTUFYX0NPTlNPTEVfTE9HUyA/IG5leHQuc2xpY2UoLU1BWF9DT05TT0xFX0xPR1MpIDogbmV4dDtcclxuICAgIH07XHJcblxyXG4gICAgLy8gSGVscGVyIHRvIHNhZmVseSB3cml0ZSBiYWNrIHRvIFB5dGhvbiBvbmx5IGlmIHRoZSB3aWRnZXQgdmlldyBpcyBhY3RpdmUgYW5kIGF0dGFjaGVkXHJcbiAgICBmdW5jdGlvbiBzYWZlU2V0QW5kU2F2ZShrZXksIHZhbHVlKSB7XHJcbiAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChrZXksIHZhbHVlKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcclxuICAgICAgICBpZiAoZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgc2F2ZSBlcnJvcjpcIiwgZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5lcnJvciA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcclxuICAgICAgICBvcmlnaW5hbEVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xyXG4gICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXHJcbiAgICAgICAgICAgIGFwcGVuZExvZyhcIkNPTlNPTEUuRVJST1I6IFwiICsgYXJncy5tYXAoYSA9PiBTdHJpbmcoYSkpLmpvaW4oXCIgXCIpKSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBsZXQgbG9nZ2VkUmVwcm9qZWN0ZWQgPSBmYWxzZTtcclxuICAgIGNvbnNvbGUud2FybiA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcclxuICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XHJcbiAgICAgICAgaWYgKG1zZy5pbmNsdWRlcyhcImxheWVyIGRlc2lnbmVkIGZvciBTcGhlcmljYWxNZXJjYXRvclwiKSB8fCBtc2cuaW5jbHVkZXMoXCJhbHRlcm5hdGUgZGV0ZWN0ZWRcIikpIHtcclxuICAgICAgICAgICAgaWYgKCFsb2dnZWRSZXByb2plY3RlZCkge1xyXG4gICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY3JzID0gaG9zdC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNsZWFuTXNnID0gYFtTd2lmdE1hcF0gTGF5ZXIgd2FzIHJlcHJvamVjdGVkIHRvIFwiJHtjcnN9XCJgO1xyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgY2xlYW5Nc2cpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLCBhcHBlbmRMb2coY2xlYW5Nc2cpKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXHJcbiAgICAgICAgfVxyXG4gICAgICAgIG9yaWdpbmFsV2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3Qgb25XaW5kb3dFcnJvciA9IGZ1bmN0aW9uKG1lc3NhZ2UsIHNvdXJjZSwgbGluZW5vLCBjb2xubywgZXJyb3IpIHtcclxuICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxyXG4gICAgICAgICAgICBhcHBlbmRMb2coYFdJTkRPVy5PTkVSUk9SOiAke21lc3NhZ2V9IGF0ICR7c291cmNlfToke2xpbmVub306JHtjb2xub31gKSk7XHJcbiAgICB9O1xyXG4gICAgd2luZG93Lm9uZXJyb3IgPSBvbldpbmRvd0Vycm9yO1xyXG5cclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcclxuICAgIGNvbnRhaW5lci5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xyXG4gICAgY29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xyXG4gICAgZWwuYXBwZW5kQ2hpbGQoY29udGFpbmVyKTtcclxuXHJcbiAgICAvLyBNYXAoaGVpZ2h0PS4uLikgc2l6aW5nLiBBbiBleHBsaWNpdCBoZWlnaHQgYWxzbyBkcm9wcyB0aGUgc3R5bGVzaGVldCdzXHJcbiAgICAvLyA0MDBweCBmbG9vciAtLSBhbiBleHBsaWNpdCAyMDBweCBtdXN0IG5vdCBsb3NlIHRvIGEgZGVmYXVsdCBtaW5pbXVtLlxyXG4gICAgLy8gSGVpZ2h0IHdhcyBhY2NlcHRlZCBhbmQgZG9jdW1lbnRlZCBsb25nIGJlZm9yZSBpdCByZWFjaGVkIHRoZSBET007IHRoaXNcclxuICAgIC8vIGlzIHdoZXJlIGl0IGZpbmFsbHkgZG9lcy5cclxuICAgIGZ1bmN0aW9uIGFwcGx5SGVpZ2h0KCkge1xyXG4gICAgICAgIGNvbnN0IGggPSBob3N0LmdldChcImhlaWdodFwiKTtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUuaGVpZ2h0ID0gaCB8fCBcIjEwMCVcIjtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUubWluSGVpZ2h0ID0gaCA/IFwiMFwiIDogXCJcIjtcclxuICAgIH1cclxuICAgIGFwcGx5SGVpZ2h0KCk7XHJcblxyXG4gICAgbGV0IGxhYmVsc0dyb3VwID0gbnVsbDsgICAvLyBjcmVhdGVkIGFmdGVyIHRoZSBtYXA7IGZpbGxlZCBieSBlYWNoIHN5bmNcclxuXHJcbiAgICBjb25zdCBjcnNOYW1lID0gaG9zdC5nZXQoXCJjcnNcIik7XHJcbiAgICBsZXQgbWFwQ3JzID0gTC5DUlMuRVBTRzM4NTc7XHJcbiAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xyXG4gICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1hcCA9IEwubWFwKGNvbnRhaW5lciwge1xyXG4gICAgICAgIGNyczogbWFwQ3JzLFxyXG4gICAgICAgIGNlbnRlcjogaG9zdC5nZXQoXCJjZW50ZXJcIiksXHJcbiAgICAgICAgem9vbTogaG9zdC5nZXQoXCJ6b29tXCIpLFxyXG4gICAgICAgIHNjcm9sbFdoZWVsWm9vbTogdHJ1ZSxcclxuICAgICAgICBwcmVmZXJDYW52YXM6IHRydWVcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcclxuICAgIG1hcC5nZXRQYW5lKFwicG9seWdvbnNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDEwXCI7XHJcbiAgICBcclxuICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcclxuICAgIG1hcC5nZXRQYW5lKFwicG9seWxpbmVzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQyMFwiO1xyXG4gICAgXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MzBcIjtcclxuXHJcbiAgICAvLyBEcmF3biB2ZWN0b3JzIGxpdmUgQUJPVkUgdGhlIEdMIHBhbmVzLiBHZW9tYW4gZGVmYXVsdHMgdGhlbSBpbnRvIExlYWZsZXQnc1xyXG4gICAgLy8gb3ZlcmxheVBhbmUgKDQwMCksIHdoaWNoIHNpdHMgdW5kZXIgdGhlIEdMIGNhbnZhc2VzICg0MTAvNDIwLzQzMCkgd2hvc2VcclxuICAgIC8vIHBvaW50ZXItZXZlbnRzIGFyZSBmb3JjZWQgb24gLS0gc28gd2l0aCBhbnkgR0wgbGF5ZXIgcHJlc2VudCwgY2xpY2tzIG1lYW50XHJcbiAgICAvLyBmb3IgYSBkcmF3biBzaGFwZSBuZXZlciBhcnJpdmVkOiBkcmF3aW5nIHdvcmtlZCAoR2VvbWFuIGxpc3RlbnMgb24gdGhlXHJcbiAgICAvLyBjb250YWluZXIpIHdoaWxlIHJlbW92YWwsIGVkaXQgYW5kIGRyYWcgc2lsZW50bHkgZGlkIG5vdGhpbmcuXHJcbiAgICBtYXAuY3JlYXRlUGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIik7XHJcbiAgICBtYXAuZ2V0UGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0NDBcIjtcclxuXHJcbiAgICBsYWJlbHNHcm91cCA9IEwubGF5ZXJHcm91cCgpLmFkZFRvKG1hcCk7XHJcblxyXG4gICAgLy8gTG9jYWwgbWlycm9ycyBvZiB0aGUgbGF5ZXIgbGlzdCBhbmQgY29vcmRpbmF0ZSBidWZmZXJzLlxyXG4gICAgLy9cclxuICAgIC8vIFB5dGhvbiB1cGRhdGVzIHRoZXNlIGluY3JlbWVudGFsbHkgdmlhIFwic3dpZnRtYXBfcGF0Y2hcIiBtZXNzYWdlcyBpbnN0ZWFkIG9mXHJcbiAgICAvLyByZWFzc2lnbmluZyB0aGUgdHJhaXRzLCBiZWNhdXNlIGEgdHJhaXQgcmVhc3NpZ25tZW50IHJlLXNlcmlhbGl6ZXMgYW5kIHJlLXNlbmRzXHJcbiAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxyXG4gICAgLy8gd2hlbiBhIHZpZXcgYXR0YWNoZXMsIGFuZCB0aGUgc2lkZWJhciBzdGlsbCB3cml0ZXMgYGxheWVyc2AgYmFjayBvbiB0b2dnbGUsIHNvXHJcbiAgICAvLyBib3RoIGFyZSBzZWVkZWQgaGVyZSBhbmQga2VwdCBpbiBzdGVwIGJ5IHRoZSBjaGFuZ2UgaGFuZGxlcnMgZnVydGhlciBkb3duLlxyXG4gICAgbGV0IGxheWVyU3RhdGUgPSBob3N0LmdldChcImxheWVyc1wiKSB8fCBbXTtcclxuICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKGhvc3QuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIGFwcGx5UGF0Y2hPcHMob3BzLCBidWZmZXJzKSB7XHJcbiAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcclxuICAgICAgICBsYXllclN0YXRlID0gbmV4dC5sYXllcnM7XHJcbiAgICAgICAgYnVmZmVyU3RhdGUgPSBuZXh0LmJ1ZmZlcnM7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTGl2ZSBmZWF0dXJlIHZpc2liaWxpdHksIGZvciBoaXQtdGVzdGluZy4gR1BVLXBhdGggYnVja2V0cyBrZWVwIEVWRVJZXHJcbiAgICAvLyBsYXllciAtLSBoaWRkZW4gb25lcyBhcmUgbWFza2VkIGJ5IGEgc2hhZGVyIHVuaWZvcm0gLS0gYW5kIGdsaWZ5J3NcclxuICAgIC8vIGhpdC10ZXN0cyBydW4gYWdhaW5zdCB0aGUgYnVja2V0J3MgZGF0YSwgd2hpY2ggY2Fubm90IHNlZSB1bmlmb3JtczogYVxyXG4gICAgLy8gcmFkaW8taGlkZGVuIGxheWVyJ3MgZmVhdHVyZXMgc3RpbGwgd29uIGNsaWNrcyBhbmQgYW5zd2VyZWQgd2l0aCBwb3B1cHMuXHJcbiAgICAvLyBMb29rZWQgdXAgZnJlc2ggcGVyIGV2ZW50LCBiZWNhdXNlIHRoZSBjb25maWcgY2FwdHVyZWQgYXQgYnVpbGQgdGltZSBnb2VzXHJcbiAgICAvLyBzdGFsZSB0aGUgbW9tZW50IGEgcGF0Y2ggb3AgcmVwbGFjZXMgaXQ7IHRoZSB0aW1lIGNoZWNrIHJlYWRzIHRoZSBsaXZlXHJcbiAgICAvLyB0aWNrIHRoZSBzYW1lIHdheSwgc2luY2UgdGlja3MgY2hhbmdlIHdpdGhvdXQgcmVidWlsZGluZyB0aGUgYnVja2V0LlxyXG4gICAgZnVuY3Rpb24gZmluZExheWVyTm93KGxpc3QsIGlkKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBsIG9mIGxpc3QpIHtcclxuICAgICAgICAgICAgaWYgKGwuaWQgPT09IGlkKSByZXR1cm4gbDtcclxuICAgICAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdWIgPSBmaW5kTGF5ZXJOb3cobC5sYXllcnMgfHwgW10sIGlkKTtcclxuICAgICAgICAgICAgICAgIGlmIChzdWIpIHJldHVybiBzdWI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiBmZWF0dXJlVmlzaWJsZU5vdyhsYXllciwgaW5kZXgpIHtcclxuICAgICAgICBjb25zdCBjdXJyZW50ID0gZmluZExheWVyTm93KGxheWVyU3RhdGUsIGxheWVyLmlkKSB8fCBsYXllcjtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGN1cnJlbnQsIGhvc3QuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWN1cnJlbnQudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGN1cnJlbnQsIGJ1ZmZlclN0YXRlKTtcclxuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICBjb25zdCB3aW4gPSB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssXHJcbiAgICAgICAgICAgIGVmZmVjdGl2ZUR1cmF0aW9uKGN1cnJlbnQsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xyXG4gICAgICAgIGlmIChpbmRleCAhPSBudWxsICYmIHRpbWVzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lc1tpbmRleCAqIDJdO1xyXG4gICAgICAgICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHN0YXJ0KVxyXG4gICAgICAgICAgICAgICAgfHwgZmVhdHVyZUluV2luZG93KHN0YXJ0LCB0aW1lc1tpbmRleCAqIDIgKyAxXSwgd2luKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKVxyXG4gICAgICAgICAgICAgICAgICAgIHx8IGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEZlYXR1cmUgY2xpY2tzLCB3cml0dGVuIHRvIHRoZSBob3N0IEJBUkUgLS0gbm8gZ2F0aW5nIG9uIGEgY29tbSBwcm9wZXJ0eTpcclxuICAgIC8vIHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vbmUsIGFuZCBnYXRpbmcgb24gaXQgc2lsZW50bHkga2lsbGVkIGV2ZXJ5XHJcbiAgICAvLyB3cml0ZWJhY2sgdW5kZXIgU2hpbnkuIE9uZSBrZXkgYWx3YXlzIGFuc3dlcnMgXCJ3aGVyZVwiIChjbGlja2VkX2xhdGxuZyksXHJcbiAgICAvLyBjbGlja2VkX2xheWVyX2lkIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKSwgYW5kIGNsaWNrX3NlcSBidW1wc1xyXG4gICAgLy8gb24gRVZFUlkgY2xpY2sgc28gYSByZXBlYXQgY2xpY2sgb24gdGhlIHNhbWUgZmVhdHVyZSBzdGlsbCBmaXJlcy5cclxuICAgIGNvbnN0IGxheWVyRXZlbnRzID0ge1xyXG4gICAgICAgIG9uRmVhdHVyZUNsaWNrOiAoeyBsYXllciwgaW5kZXgsIGxhdGxuZyB9KSA9PiB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBpbmRleCk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrZWRfbGF0bG5nXCIsIGxhdGxuZyk7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNsaWNrX3NlcVwiLCAoaG9zdC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGFjdGl2ZVRpbGVMYXllcnMgPSB7fTtcclxuICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcclxuICAgIGNvbnN0IGdsU3RhdGVzID0ge1xyXG4gICAgICAgIGNpcmNsZV9tYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcclxuICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcclxuICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXHJcbiAgICAgICAgcG9seWdvbjogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH1cclxuICAgIH07XHJcblxyXG4gICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xyXG4gICAgLy8gYW5kIHRoZSBwZXJpb2QsIG9yIG51bGwgd2hlbiBub3RoaW5nIGlzIGFuaW1hdGVkIC0tIGFuZCBgdGltZVVJYCBpcyB0aGUgc2xpZGVyJ3NcclxuICAgIC8vIG93biBib29ra2VlcGluZy4gUGxheWJhY2sgbmV2ZXIgcm91bmQtdHJpcHMgdGhyb3VnaCBQeXRob246IHRpY2tzIHJlLXJlbmRlclxyXG4gICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXHJcbiAgICBsZXQgdGltZVN0YXRlID0gbnVsbDtcclxuICAgIGNvbnN0IHRpbWVVSSA9IHsgdGlja3M6IFtdLCBrZXk6IFwiXCIsIGluZGV4OiAwLCBwbGF5aW5nOiBmYWxzZSwgbG9vcDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgd2luZG93OiBudWxsLCBwZXJpb2RNczogbnVsbCwgZ3JpZE1zOiBudWxsIH07XHJcblxyXG4gICAgZnVuY3Rpb24gc3RvcFBsYXliYWNrKCkge1xyXG4gICAgICAgIGlmICh0aW1lVUkudGltZXIpIGNsZWFySW50ZXJ2YWwodGltZVVJLnRpbWVyKTtcclxuICAgICAgICB0aW1lVUkudGltZXIgPSBudWxsO1xyXG4gICAgICAgIHRpbWVVSS5wbGF5aW5nID0gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gd3JpdGVUaW1lQ3VycmVudChmb3JjZSkge1xyXG4gICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgaWYgKCFmb3JjZSAmJiBub3cgLSB0aW1lVUkubGFzdFdyaXRlIDwgMTAwMCkgcmV0dXJuO1xyXG4gICAgICAgIHRpbWVVSS5sYXN0V3JpdGUgPSBub3c7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaG9zdC5zZXQoXCJ0aW1lX2N1cnJlbnRcIiwgdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pO1xyXG4gICAgICAgICAgICBob3N0LnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHNlZWtUbyhpbmRleCwgeyB3cml0ZSA9IHRydWUgfSA9IHt9KSB7XHJcbiAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kLFxyXG4gICAgICAgICAgICAgICAgICAgICAgd2luZG93OiB0aW1lVUkud2luZG93IH07XHJcbiAgICAgICAgaWYgKHdyaXRlKSB3cml0ZVRpbWVDdXJyZW50KCF0aW1lVUkucGxheWluZyk7XHJcbiAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBzdGFydFBsYXliYWNrKCkge1xyXG4gICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgIHRpbWVVSS5wbGF5aW5nID0gdHJ1ZTtcclxuICAgICAgICB0aW1lVUkudGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhZHZhbmNlKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCwgdGltZVVJLmxvb3ApO1xyXG4gICAgICAgICAgICBpZiAoIW5leHQucGxheWluZykge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBzZWVrVG8obmV4dC5pbmRleCk7XHJcbiAgICAgICAgfSwgMTAwMCAvIHRpbWVVSS5zcGVlZCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdGltZUhhbmRsZXJzID0ge1xyXG4gICAgICAgIG9uU2VlazogKGluZGV4KSA9PiBzZWVrVG8oaW5kZXgpLFxyXG4gICAgICAgIG9uU3RlcEJhY2s6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggLSAxKSxcclxuICAgICAgICBvblN0ZXBGb3J3YXJkOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4ICsgMSksXHJcbiAgICAgICAgb25QbGF5VG9nZ2xlOiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gc3RhcnRPdmVyLCBhcyB0aGUgZm9saXVtIHBsYXllciB3YXMgY29uZmlndXJlZDogcHJlc3NpbmcgcGxheSBhdFxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGVuZCByZXN0YXJ0cyBmcm9tIHRoZSBiZWdpbm5pbmcgaW1tZWRpYXRlbHksIHJhdGhlciB0aGFuIG9uZVxyXG4gICAgICAgICAgICAgICAgLy8gc2lsZW50IGludGVydmFsIGxhdGVyIGRlY2lkaW5nIHRoZXJlIGlzIG5vd2hlcmUgdG8gZ28gYW5kIHN0b3BwaW5nLlxyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5pbmRleCA+PSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkgc2Vla1RvKDApO1xyXG4gICAgICAgICAgICAgICAgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLmxvb3AgPSAhdGltZVVJLmxvb3A7XHJcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvblNwZWVkOiAoc3BlZWQpID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gc3BlZWQ7XHJcbiAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gTGl2ZSBkdXJpbmcgdGhlIGRyYWc6IGxvY2FsIHN0YXRlIGFuZCBhIHJlLXJlbmRlciBvZiB0aGUgY29udHJvbCBvbiBldmVyeVxyXG4gICAgICAgIC8vIG1vdmUsIGJ1dCBtYXAgcmVidWlsZHMgYXQgbW9zdCBldmVyeSAzMDBtcy4gQXQgNU0gcG9pbnRzIGEgcmVidWlsZCBjb3N0c1xyXG4gICAgICAgIC8vIHNlY29uZHMsIGFuZCBhIGRyYWcgZmlyZXMgZG96ZW5zIG9mIG1vdmVzIC0tIHVudGhyb3R0bGVkLCB0aGUgcmVidWlsZHNcclxuICAgICAgICAvLyBzdGFjayBmYXN0ZXIgdGhhbiB0aGV5IGZpbmlzaCBhbmQgdGhlIGFsbG9jYXRpb24gY2h1cm4gY3Jhc2hlcyB0aGUgdGFiLlxyXG4gICAgICAgIG9uV2luZG93RHJhZzogKGlzbykgPT4ge1xyXG4gICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IHRydWU7XHJcbiAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBpc287XHJcbiAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHRpbWVTdGF0ZSA9IHsgLi4udGltZVN0YXRlLCB3aW5kb3c6IGlzbyB9O1xyXG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICBpZiAobm93IC0gKHRpbWVVSS5sYXN0RHJhZ1N5bmMgfHwgMCkgPj0gMzAwKSB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkubGFzdERyYWdTeW5jID0gbm93O1xyXG4gICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIE9uIHJlbGVhc2UgKG9yIGEga2V5Ym9hcmQgc3RlcCk6IHRoZSBvdmVycmlkZSBsYW5kcyBpbiB0aW1lX2NvbmZpZyBzb1xyXG4gICAgICAgIC8vIFB5dGhvbiBhbmQgU2hpbnkgc2VlIHRoZSBzYW1lIHdpbmRvdyB0aGUgYmFyIHNob3dzLiBudWxsIGNsZWFycyB0aGUga2V5LFxyXG4gICAgICAgIC8vIGhhbmRpbmcgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXHJcbiAgICAgICAgb25XaW5kb3dDb21taXQ6IChpc28pID0+IHtcclxuICAgICAgICAgICAgdGltZUhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xyXG4gICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTsgICAgICAgLy8gdGhlIHJlbGVhc2UgYWx3YXlzIGxhbmRzLCB0aHJvdHRsZSBvciBub3RcclxuICAgICAgICAgICAgY29uc3QgY2ZnID0geyAuLi4oaG9zdC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fSkgfTtcclxuICAgICAgICAgICAgaWYgKGlzbykgY2ZnLndpbmRvdyA9IGlzbztcclxuICAgICAgICAgICAgZWxzZSBkZWxldGUgY2ZnLndpbmRvdztcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwidGltZV9jb25maWdcIiwgY2ZnKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBsb2NhbCBob3N0IHN0aWxsIGhvbGRzIGl0ICovIH1cclxuICAgICAgICB9LFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBDcmVhdGVzLCByZXR1bmVzIG9yIHJlbW92ZXMgdGhlIHNsaWRlciB0byBtYXRjaCB0aGUgbGF5ZXJzIHByZXNlbnQuIFRpY2tzIGFyZVxyXG4gICAgLy8gcmVnZW5lcmF0ZWQgb25seSB3aGVuIHRoZSBkYXRhJ3MgdGltZSBleHRlbnQgb3IgdGhlIHBlcmlvZCBjaGFuZ2VzLCBzbyBhXHJcbiAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxyXG4gICAgZnVuY3Rpb24gdXBkYXRlVGltZURpbWVuc2lvbigpIHtcclxuICAgICAgICBpZiAoIWhhc1RpbWVMYXllcnMobGF5ZXJTdGF0ZSkpIHtcclxuICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgeyB0aWNrczogW10gfSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0gXCJcIjtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XHJcbiAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xyXG4gICAgICAgIGlmICghZXh0ZW50KSByZXR1cm47XHJcblxyXG4gICAgICAgIGNvbnN0IGtleSA9IGAke2V4dGVudC5taW59fCR7ZXh0ZW50Lm1heH18JHtjZmcucGVyaW9kIHx8IFwiUDFEXCJ9YDtcclxuICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XHJcbiAgICAgICAgICAgIC8vIFRoZSBwbGF5aGVhZCBpcyBhIE1PTUVOVCwgbm90IGFuIGluZGV4LiBMYXRlIGRhdGEgcHJlcGVuZHMgdGlja3NcclxuICAgICAgICAgICAgLy8gYW5kIGEgZ3Jvd24gZXh0ZW50IGFwcGVuZHMgdGhlbTsgdGhlIHVzZXIncyBwb3NpdGlvbiBpbiB0aW1lIGlzIGFcclxuICAgICAgICAgICAgLy8gY2hvc2VuIHZpZXcgLS0gdGhlIHNhbWUgcnVsZSB0aGF0IGtlZXBzIGEgZGF0YSB1cGRhdGUgZnJvbSBtb3ZpbmdcclxuICAgICAgICAgICAgLy8gYSBjaG9zZW4gdmlld3BvcnQgLS0gc28gaXQgc25hcHMgdG8gdGhlIG5lYXJlc3QgdGljayBvZiB0aGUgbmV3XHJcbiAgICAgICAgICAgIC8vIHNlcmllcyBhbmQgbmV2ZXIgcmVzZXRzIHRvIHRoZSBzdGFydCwgcGF1c2VkIG9yIHBsYXlpbmcgKHBsYXliYWNrXHJcbiAgICAgICAgICAgIC8vIHNpbXBseSBjb250aW51ZXMgZnJvbSB0aGUgc25hcHBlZCBpbmRleCkuXHJcbiAgICAgICAgICAgIGNvbnN0IG1vbWVudCA9IHRpbWVVSS50aWNrcy5sZW5ndGggPyB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSA6IG51bGw7XHJcbiAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBrZXk7XHJcbiAgICAgICAgICAgIHRpbWVVSS50aWNrcyA9IGdlbmVyYXRlVGlja3MoZXh0ZW50Lm1pbiwgZXh0ZW50Lm1heCwgcGVyaW9kKTtcclxuICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gbW9tZW50ID09PSBudWxsID8gMCA6IG5lYXJlc3RUaWNrSW5kZXgodGltZVVJLnRpY2tzLCBtb21lbnQpO1xyXG4gICAgICAgICAgICBpZiAobW9tZW50ICE9PSBudWxsICYmIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdICE9PSBtb21lbnQpIHtcclxuICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7ICAgLy8gdGhlIHNlcmllcyByZWFsaWduZWQ6IHRlbGwgUHl0aG9uIHdoZXJlIHdlIGxhbmRlZFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUaGUgc2hhcmVkIHdpbmRvdyBvdmVycmlkZSwgY29uZmlnLWRyaXZlbjsgYSBiYWQgc3RyaW5nIGNsZWFycyByYXRoZXIgdGhhblxyXG4gICAgICAgIC8vIGd1ZXNzaW5nLiBUaGUgZHJhZyBncmlkIGlzIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZFxyXG4gICAgICAgIC8vIGR1cmF0aW9uIC0tIHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBhbGwgb2YgdGhlbSAtLSBzbyBhIDIuNWggdHJhaWxcclxuICAgICAgICAvLyBpcyBkcmFnZ2FibGUgb24gYSAxaCBiYXIuIENhbGVuZGFyIHBlcmlvZHMgaGF2ZSBubyBmaXhlZCB3aWR0aDsgdGhlIHJ1bGVyXHJcbiAgICAgICAgLy8gdGhlbiBzaG93cyBpbnRlcnZhbCBtYXJrcyBvbmx5IGFuZCB0aGUgdHJhaWwgaGFuZGxlIGhpZGVzLlxyXG4gICAgICAgIC8vIE5ldmVyIHdoaWxlIGEgZHJhZyBpcyBsaXZlOiB0aGUgZHJhZ2dlZCB3aW5kb3cgZXhpc3RzIG9ubHkgbG9jYWxseSB1bnRpbFxyXG4gICAgICAgIC8vIHJlbGVhc2UgY29tbWl0cyBpdCwgYW5kIHJlYWRpbmcgY29uZmlnIGhlcmUgbWlkLWRyYWcgcmVzZXQgdGhlIGhhbmRsZSB0b1xyXG4gICAgICAgIC8vIFwibm8gd2luZG93XCIgb24gZXZlcnkgZGVib3VuY2VkIHN5bmMgLS0gdGhlIGhhbmRsZSBmb2xsb3dlZCB0aGUgbW91c2UsIHRoZW5cclxuICAgICAgICAvLyBzbmFwcGVkIGhvbWUsIHRoZW4gZm9sbG93ZWQgYWdhaW4sIG9uY2UgcGVyIHN5bmMuXHJcbiAgICAgICAgaWYgKCF0aW1lVUkuZHJhZ0FjdGl2ZSkge1xyXG4gICAgICAgICAgICB0aW1lVUkud2luZG93ID0gY2ZnLndpbmRvdyAmJiBwYXJzZVBlcmlvZChjZmcud2luZG93KSA/IGNmZy53aW5kb3cgOiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aW1lVUkucGVyaW9kTXMgPSBwZXJpb2RUb01zKHBlcmlvZCk7XHJcbiAgICAgICAgdGltZVVJLmdyaWRNcyA9IHRpbWVVSS5wZXJpb2RNc1xyXG4gICAgICAgICAgICA/IGdjZEdyaWRNcyh0aW1lVUkucGVyaW9kTXMsIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllclN0YXRlLCB0aW1lVUkud2luZG93KSlcclxuICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QsIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xyXG4gICAgICAgIHRpbWVVSS5wb3NpdGlvbiA9IGNmZy5wb3NpdGlvbiB8fCBcInRvcC1jZW50ZXJcIjtcclxuXHJcbiAgICAgICAgaWYgKCF0aW1lVUkuc3RhcnRlZCkge1xyXG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IGNmZy5zcGVlZCB8fCAxO1xyXG4gICAgICAgICAgICB0aW1lVUkubG9vcCA9IEJvb2xlYW4oY2ZnLmxvb3ApO1xyXG4gICAgICAgICAgICAvLyBPbmx5IHRoZSBmaXJzdCBjb25maWd1cmF0aW9uIG1heSBhdXRvLXN0YXJ0LiBFdmVyeSBjb25maWcgY2hhbmdlIHJlc2V0c1xyXG4gICAgICAgICAgICAvLyBgc3RhcnRlZGAgdG8gcmUtcmVhZCBzcGVlZCBhbmQgbG9vcCAtLSBpbmNsdWRpbmcgdGhlIGNoYW5nZSBhIHdpbmRvd1xyXG4gICAgICAgICAgICAvLyBkcmFnIGNvbW1pdHMgLS0gYW5kIHJlLXJ1bm5pbmcgYXV0b19wbGF5IHRoZXJlIHdvdWxkIHN0YXJ0IHBsYXliYWNrIGFzXHJcbiAgICAgICAgICAgIC8vIGEgc2lkZSBlZmZlY3Qgb2YgcmVsZWFzaW5nIHRoZSBoYW5kbGUuXHJcbiAgICAgICAgICAgIGlmIChjZmcuYXV0b19wbGF5ICYmICF0aW1lVUkuZXZlclN0YXJ0ZWQpIHN0YXJ0UGxheWJhY2soKTtcclxuICAgICAgICAgICAgdGltZVVJLmV2ZXJTdGFydGVkID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTaWRlYmFyIExheWVycyBDb250cm9sIFVJXHJcbiAgICBjb25zdCBzaWRlYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS50b3AgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcclxuICAgIHNpZGViYXIuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XHJcbiAgICBzaWRlYmFyLnN0eWxlLm92ZXJmbG93WSA9IFwiYXV0b1wiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5mb250RmFtaWx5ID0gXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTZWdvZSBVSScsIFJvYm90bywgc2Fucy1zZXJpZlwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xyXG4gICAgc2lkZWJhci5zdHlsZS5jb2xvciA9IFwiIzMzM1wiO1xyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHNpZGViYXIpO1xyXG5cclxuICAgIC8vIExlZ2VuZDogZGVyaXZlZCBmcmVzaCBvbiBldmVyeSBzeW5jIGZyb20gdGhlIHNhbWUgbGF5ZXIgc3RhdGUgdGhlIHNpZGViYXJcclxuICAgIC8vIHJlbmRlcnMgZnJvbSwgc28gdG9nZ2xlcyBkaW0gb3IgZHJvcCByb3dzIHdpdGggbm8gZXh0cmEgd2lyaW5nLiBIaWRkZW5cclxuICAgIC8vIHVudGlsIHNob3dfbGVnZW5kIGFza3MgZm9yIGl0LlxyXG4gICAgY29uc3QgbGVnZW5kRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIGxlZ2VuZERpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxlZ2VuZFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUubWF4V2lkdGggPSBcIjI2MHB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUubWF4SGVpZ2h0ID0gXCI0NSVcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5mb250RmFtaWx5ID0gc2lkZWJhci5zdHlsZS5mb250RmFtaWx5O1xyXG4gICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XHJcbiAgICBsZWdlbmREaXYuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcclxuICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobGVnZW5kRGl2KTtcclxuXHJcbiAgICAvLyBMb2dvXHJcbiAgICAvLyBUaGUgbG9nbyBjYXJkOiB0d28gYXBwLXN1cHBsaWVkIHNsb3RzIGZyb20gbG9nb19jb25maWcsIG5vIGJyYW5kaW5nIG9mXHJcbiAgICAvLyBpdHMgb3duLiBXaXRoIHRoZSBjYXJkIG9uIGFuZCBuZWl0aGVyIHNsb3Qgc2V0LCBhIGdlbmVyaWMgbWFyayBzdGFuZHMgaW5cclxuICAgIC8vIC0tIGlubGluZSBTVkcsIHNvIGl0IG5lZWRzIG5vIG5ldHdvcmsgYW5kIHN1cnZpdmVzIGEgc3RhdGljIGV4cG9ydC5cclxuICAgIC8vIEJ1aWx0IHdpdGggZWxlbWVudHMsIG5vdCBpbm5lckhUTUwsIHNvIGFuIGFsdCB0ZXh0IGNhbm5vdCBpbmplY3QgbWFya3VwLlxyXG4gICAgY29uc3QgTE9HT19QT1NJVElPTlMgPSBuZXcgU2V0KFtcInRvcC1sZWZ0XCIsIFwidG9wLXJpZ2h0XCIsIFwiYm90dG9tLWxlZnRcIiwgXCJib3R0b20tcmlnaHRcIl0pO1xyXG4gICAgY29uc3QgREVGQVVMVF9MT0dPID0gXCJkYXRhOmltYWdlL3N2Zyt4bWw7dXRmOCxcIiArIGVuY29kZVVSSUNvbXBvbmVudChcclxuICAgICAgICAnPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgdmlld0JveD1cIjAgMCAxNDAgNDBcIj4nXHJcbiAgICAgICAgKyAnPHJlY3Qgd2lkdGg9XCIxNDBcIiBoZWlnaHQ9XCI0MFwiIHJ4PVwiOFwiIGZpbGw9XCIjMWY2ZmViXCIvPidcclxuICAgICAgICArICc8dGV4dCB4PVwiNzBcIiB5PVwiMjZcIiBmb250LWZhbWlseT1cIlNlZ29lIFVJLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmXCIgJ1xyXG4gICAgICAgICsgJ2ZvbnQtc2l6ZT1cIjE4XCIgZm9udC13ZWlnaHQ9XCI2MDBcIiBmaWxsPVwiI2ZmZlwiIHRleHQtYW5jaG9yPVwibWlkZGxlXCI+c3dpZnRtYXA8L3RleHQ+J1xyXG4gICAgICAgICsgJzwvc3ZnPicpO1xyXG4gICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBsb2dvRGl2LmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtbG9nb1wiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjRweFwiO1xyXG4gICAgbG9nb0Rpdi5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcclxuICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxvZ29EaXYpO1xyXG5cclxuICAgIGZ1bmN0aW9uIHN5bmNMb2dvKCkge1xyXG4gICAgICAgIGNvbnN0IHNob3cgPSBCb29sZWFuKGhvc3QuZ2V0KFwic2hvd19sb2dvXCIpKTtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBzaG93ID8gXCJibG9ja1wiIDogXCJub25lXCI7XHJcbiAgICAgICAgbG9nb0Rpdi5yZXBsYWNlQ2hpbGRyZW4oKTtcclxuICAgICAgICBpZiAoIXNob3cpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjZmcgPSBob3N0LmdldChcImxvZ29fY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgIGNvbnN0IGhlaWdodCA9IE51bWJlcihjZmcuaGVpZ2h0KSA+IDAgPyBOdW1iZXIoY2ZnLmhlaWdodCkgOiAzNTtcclxuICAgICAgICBjb25zdCBwb3NpdGlvbiA9IExPR09fUE9TSVRJT05TLmhhcyhjZmcucG9zaXRpb24pID8gY2ZnLnBvc2l0aW9uIDogXCJib3R0b20tcmlnaHRcIjtcclxuICAgICAgICBmb3IgKGNvbnN0IHNpZGUgb2YgW1widG9wXCIsIFwiYm90dG9tXCIsIFwibGVmdFwiLCBcInJpZ2h0XCJdKSBsb2dvRGl2LnN0eWxlW3NpZGVdID0gXCJcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlW3Bvc2l0aW9uLnN0YXJ0c1dpdGgoXCJ0b3BcIikgPyBcInRvcFwiIDogXCJib3R0b21cIl0gPSBcIjEwcHhcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlW3Bvc2l0aW9uLmVuZHNXaXRoKFwibGVmdFwiKSA/IFwibGVmdFwiIDogXCJyaWdodFwiXSA9IFwiMTBweFwiO1xyXG4gICAgICAgIGNvbnN0IHNsb3RzID0gW2NmZy5jb21wYW55LCBjZmcucGFyZW50X2NvbXBhbnldLmZpbHRlcihzID0+IHMgJiYgcy51cmwpO1xyXG4gICAgICAgIGNvbnN0IGltYWdlcyA9IHNsb3RzLmxlbmd0aCA/IHNsb3RzIDogW3sgdXJsOiBERUZBVUxUX0xPR08sIGFsdDogXCJzd2lmdG1hcFwiIH1dO1xyXG4gICAgICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgcm93LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICByb3cuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgcm93LnN0eWxlLmdhcCA9IFwiNXB4XCI7XHJcbiAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBpbWFnZXMpIHtcclxuICAgICAgICAgICAgY29uc3QgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImltZ1wiKTtcclxuICAgICAgICAgICAgaW1nLnNyYyA9IGltYWdlLnVybDtcclxuICAgICAgICAgICAgaW1nLmFsdCA9IGltYWdlLmFsdCB8fCBcIlwiO1xyXG4gICAgICAgICAgICBpbWcuc3R5bGUuaGVpZ2h0ID0gYCR7aGVpZ2h0fXB4YDtcclxuICAgICAgICAgICAgcm93LmFwcGVuZENoaWxkKGltZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ29EaXYuYXBwZW5kQ2hpbGQocm93KTtcclxuICAgIH1cclxuICAgIHN5bmNMb2dvKCk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6bG9nb19jb25maWdcIiwgc3luY0xvZ28pO1xyXG5cclxuXHJcblxyXG4gICAgZnVuY3Rpb24gZ2V0VGlsZUxheWVyKGxheWVyKSB7XHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxyXG4gICAgICAgICAgICBtYXhab29tOiBsYXllci5tYXhfem9vbSB8fCAyMixcclxuICAgICAgICAgICAgbWF4TmF0aXZlWm9vbTogbGF5ZXIubWF4X25hdGl2ZV96b29tIHx8IDE5XHJcbiAgICAgICAgfTtcclxuICAgICAgICAvLyB4eXpzZXJ2aWNlcyBwcm92aWRlcnMgZGVjbGFyZSB0aGVpciBvd24ge3N9IGhvc3RzOyBMZWFmbGV0J3NcclxuICAgICAgICAvLyBkZWZhdWx0IFwiYWJjXCIgaXMgd3JvbmcgZm9yIGFueXRoaW5nIGVsc2UuXHJcbiAgICAgICAgaWYgKGxheWVyLnN1YmRvbWFpbnMpIG9wdGlvbnMuc3ViZG9tYWlucyA9IGxheWVyLnN1YmRvbWFpbnM7XHJcbiAgICAgICAgaWYgKGxheWVyLndtcykge1xyXG4gICAgICAgICAgICAvLyBXTVMgcmVxdWVzdCBDUlMgZm9sbG93cyB0aGUgbWFwJ3MsIHNvIDQzMjYgbWFwcyBhc2sgaW4gNDMyNi5cclxuICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyLndtcyhsYXllci51cmwsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBsYXllcnM6IGxheWVyLndtcy5sYXllcnMsXHJcbiAgICAgICAgICAgICAgICBmb3JtYXQ6IGxheWVyLndtcy5mb3JtYXQgfHwgJ2ltYWdlL3BuZycsXHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiBsYXllci53bXMudmVyc2lvbiB8fCAnMS4xLjEnLFxyXG4gICAgICAgICAgICAgICAgdHJhbnNwYXJlbnQ6ICEhbGF5ZXIud21zLnRyYW5zcGFyZW50LFxyXG4gICAgICAgICAgICAgICAgLi4uKGxheWVyLndtcy5zdHlsZXMgPyB7IHN0eWxlczogbGF5ZXIud21zLnN0eWxlcyB9IDoge30pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCBvcHRpb25zKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZXRpcmUgYSBnbGlmeSBpbnN0YW5jZSB0aGUgc2FmZSB3YXk6IGl0cyBjYW52YXMgb3ZlcmxheSBuZXZlciBjYW5jZWxzIHRoZVxyXG4gICAgLy8gcmVkcmF3IGZyYW1lIGl0IHNjaGVkdWxlcywgYW5kIHRoYXQgZnJhbWUgZGVyZWZlcmVuY2VzIHRoZSBtYXAgdW5ndWFyZGVkIC0tXHJcbiAgICAvLyByZW1vdmluZyBhIGxheWVyIHdpdGhpbiBhIGZyYW1lIG9mIGl0cyBjcmVhdGlvbiB3b3VsZCB0aHJvdyBmcm9tIGluc2lkZVxyXG4gICAgLy8gcmVxdWVzdEFuaW1hdGlvbkZyYW1lLCB3aGVyZSBubyBjYWxsZXIgY2FuIGNhdGNoIGl0LlxyXG4gICAgLy8gVGFrZXMgZWl0aGVyIGEgbWVyZ2VkIHdyYXBwZXIgbGF5ZXIgKHdoaWNoIGtlZXBzIGl0cyBnbGlmeSBpbnN0YW5jZSBhc1xyXG4gICAgLy8gZ2xQb2ludHMgLyBnbExpbmVzIC8gZ2xTaGFwZXMpIG9yIGEgYmFyZSBnbGlmeSBpbnN0YW5jZS5cclxuICAgIGZ1bmN0aW9uIGNhbmNlbEdsRnJhbWUoZ2xJbnN0YW5jZSkge1xyXG4gICAgICAgIGNvbnN0IG92ZXJsYXkgPSBnbEluc3RhbmNlICYmIGdsSW5zdGFuY2UubGF5ZXI7XHJcbiAgICAgICAgaWYgKG92ZXJsYXkgJiYgb3ZlcmxheS5fZnJhbWUgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICBMLlV0aWwuY2FuY2VsQW5pbUZyYW1lKG92ZXJsYXkuX2ZyYW1lKTtcclxuICAgICAgICAgICAgb3ZlcmxheS5fZnJhbWUgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGZ1bmN0aW9uIHJldGlyZUdsKGluc3RhbmNlKSB7XHJcbiAgICAgICAgaWYgKCFpbnN0YW5jZSkgcmV0dXJuO1xyXG4gICAgICAgIGZvciAoY29uc3QgZ2wgb2YgW2luc3RhbmNlLmdsUG9pbnRzLCBpbnN0YW5jZS5nbExpbmVzLCBpbnN0YW5jZS5nbFNoYXBlcywgaW5zdGFuY2VdKSB7XHJcbiAgICAgICAgICAgIGNhbmNlbEdsRnJhbWUoZ2wpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0cnkgeyBpbnN0YW5jZS5yZW1vdmUoKTsgfSBjYXRjaCAoZXJyKSB7IC8qIGFscmVhZHkgZ29uZSAqLyB9XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZnVuY3Rpb24gc3luY01hcFN0YXRlKCkge1xyXG4gICAgICAgIGNvbnNvbGUudGltZShcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xyXG4gICAgICAgIHVwZGF0ZVRpbWVEaW1lbnNpb24oKTtcclxuICAgICAgICBjb25zdCBsYXllcnMgPSBsYXllclN0YXRlO1xyXG4gICAgICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IGhvc3QuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IGJ1ZmZlclN0YXRlO1xyXG5cclxuICAgICAgICAvLyBBdXRob3JpbmcgZ3VhcmRyYWlscywgb25jZSBwZXIgY29uZmlnIG9iamVjdDogd2hlcmUgUHl0aG9uIHdhcm5zIGF0IGFkZFxyXG4gICAgICAgIC8vIHRpbWUsIGEgaGFuZC1idWlsdCBKUyBjb25maWcgdXNlZCB0byBmYWlsIHNpbGVudGx5IC0tIGEgYmxhbmsgb3Igc3VidGx5XHJcbiAgICAgICAgLy8gd3JvbmcgbWFwIHdpdGggbm90aGluZyBpbiB0aGUgY29uc29sZSAoc3JjL3ZhbGlkYXRlLmpzKS5cclxuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykgd2FybkxheWVyUHJvYmxlbXMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuXHJcbiAgICAgICAgLy8gRW5mb3JjZSBtdXR1YWxseSBleGNsdXNpdmUgcmFkaW8gZ3JvdXAgdmlzaWJpbGl0eSBiZWZvcmUgY29sbGVjdGluZyBvciByZW5kZXJpbmcgV2ViR0wgbGF5ZXJzLlxyXG4gICAgICAgIC8vIFdyaXR0ZW4gYmFjayBhcyB0YXJnZXRlZCBmbGlwcywgbmV2ZXIgdGhlIGxheWVycyB0cmFpdCAtLSB0aGUgZnVsbCB3cml0ZSB3YXNcclxuICAgICAgICAvLyB0aGUgZnJhbWUgdGhhdCBraWxsZWQgbGFyZ2Ugc2Vzc2lvbnMgKHNlZSB0aGUgc2lkZWJhcidzIGNoYW5nZSBoYW5kbGVyKS5cclxuICAgICAgICBjb25zdCByYWRpbyA9IG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzLCBzaWRlYmFyQ29sbGFwc2VTdGF0ZShzaWRlYmFyKSk7XHJcbiAgICAgICAgaWYgKChyYWRpby5jaGFuZ2VzLmxlbmd0aCA+IDAgfHwgcmFkaW8uZ3JvdXBzQ2hhbmdlZCkgJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcclxuICAgICAgICAgICAgc2VuZExheWVyV3JpdGUoaG9zdCwgcmFkaW8uY2hhbmdlcyk7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcclxuICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHN5bmNMb2dvKCk7XHJcblxyXG4gICAgICAgIC8vIEdyb3VwIHZpc2libGUgbGF5ZXJzIChpbmNsdWRpbmcgc3ViLWxheWVycyBpbnNpZGUgZ3JvdXBzKSB0byBhbHdheXMgdXNlIFdlYkdMXHJcbiAgICAgICAgY29uc3Qge1xyXG4gICAgICAgICAgICBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICBwb2x5bGluZTogd2ViZ2xQb2x5bGluZUxheWVycyxcclxuICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzLFxyXG4gICAgICAgIH0gPSBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xyXG5cclxuICAgICAgICAvLyBTZXQgb2YgbGF5ZXIgSURzIHByb2Nlc3NlZCB2aWEgbWVyZ2VkIFdlYkdMIGxheWVyc1xyXG4gICAgICAgIGNvbnN0IHdlYmdsTGF5ZXJJZHMgPSBuZXcgU2V0KFtcclxuICAgICAgICAgICAgLi4ud2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXHJcbiAgICAgICAgICAgIC4uLndlYmdsTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxyXG4gICAgICAgICAgICAuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxyXG4gICAgICAgICAgICAuLi53ZWJnbFBvbHlnb25MYXllcnMubWFwKGwgPT4gbC5pZClcclxuICAgICAgICBdKTtcclxuXHJcbiAgICAgICAgLy8gUmVtb3ZlIHJldGlyZWQgb3ZlcmxheSBsYXllcnMsIGluY2x1ZGluZyB0aG9zZSB0aGF0IHRyYW5zaXRpb25lZCB0byBXZWJHTFxyXG4gICAgICAgIE9iamVjdC5rZXlzKGFjdGl2ZU92ZXJsYXlMYXllcnMpLmZvckVhY2goaWQgPT4ge1xyXG4gICAgICAgICAgICBpZiAoIWxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpIHx8IHdlYmdsTGF5ZXJJZHMuaGFzKGlkKSkge1xyXG4gICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF0ucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gUHJvY2VzcyBub24tV2ViR0wgbGF5ZXJzXHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJiYXNlbWFwXCIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChlZmZlY3RpdmVWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRpbGUgPSBnZXRUaWxlTGF5ZXIobGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aWxlLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0gPSB0aWxlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV07XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFNraXAgbGF5ZXJzIG1hbmFnZWQgYnkgdGhlIG1lcmdlZCBXZWJHTCBsYXllcnNcclxuICAgICAgICAgICAgaWYgKHdlYmdsTGF5ZXJJZHMuaGFzKGxheWVyLmlkKSkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghZWZmZWN0aXZlVmlzaWJsZSB8fCAhbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVyU3RhdGUsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgICAgICAvLyBJbWFnZSBvdmVybGF5cyByZWNyZWF0ZSB3aGVuIHRoZWlyIGNvbmZpZyBvciB0aGVpciBidWZmZXJcclxuICAgICAgICAgICAgICAgIC8vIGNoYW5nZXMgLS0gYSByZXBsYWNlIG9wIHN3YXBzIHRoZSBjb25maWcgb2JqZWN0IGFuZCBhXHJcbiAgICAgICAgICAgICAgICAvLyBidWZmZXIgb3Agc3dhcHMgdGhlIERhdGFWaWV3LCBhbmQgYSBzdGFsZSBpbWFnZSB3b3VsZFxyXG4gICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIHNpdCB1bnRpbCBhIHZpc2liaWxpdHkgYm91bmNlLlxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhbGVJbWFnZSA9IGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIlxyXG4gICAgICAgICAgICAgICAgICAgICYmIChleGlzdGluZy5pbWFnZU1ldGEgIT09IGltYWdlTWV0YUtleShsYXllcilcclxuICAgICAgICAgICAgICAgICAgICAgICAgfHwgZXhpc3RpbmcuaW1hZ2VTb3VyY2UgIT09IChjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0gfHwgbnVsbCkpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nLmxheWVyVHlwZSAhPT0gbGF5ZXIudHlwZSB8fCBzdGFsZUltYWdlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgLy8gQSBob3N0IG1heSBkZXN0cm95IHRoZSBtYXAgd2hpbGUgYSBzeW5jIGlzIGluIGZsaWdodCAoYW4gdW5tb3VudCwgb3JcclxuICAgICAgICAgICAgLy8gUmVhY3Qgc3RyaWN0IG1vZGUncyB0aHJvd2F3YXkgbW91bnQpOiBub3RoaW5nIHBhc3QgdGhpcyBwb2ludCBtYXlcclxuICAgICAgICAgICAgLy8gdG91Y2ggYSBtYXAgdGhhdCBubyBsb25nZXIgaGFzIHBhbmVzLlxyXG4gICAgICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcbiAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0gPSBpbnN0YW5jZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSGVscGVyIHRvIHN5bmMgV2ViR0wgbGF5ZXIgc3RhdGVzIGFuZCByZWJ1aWxkIG9ubHkgaWYgY2hhbmdlZFxyXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMsIHZlY3RvckdwdSA9IGZhbHNlKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkc1N0cmluZyA9IHZpc2libGVMYXllcnMubWFwKGwgPT4gbC5pZCkuc29ydCgpLmpvaW4oXCIsXCIpO1xyXG4gICAgICAgICAgICAvLyBFdmVyeXRoaW5nIHRoZSBidWlsdCBidWZmZXJzIGRlcGVuZCBvbiBiZWxvbmdzIGluIHRoaXMga2V5OiBhIGNoYW5nZSB0aGF0XHJcbiAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXHJcbiAgICAgICAgICAgIC8vIG1pc3NpbmcgYXQgZmlyc3QsIHNvIGEgaGlnaGxpZ2h0IGxhbmRlZCBpbiBzdGF0ZSBhbmQgbmV2ZXIgcmVwYWludGVkLlxyXG4gICAgICAgICAgICAvLyBQb2ludCBidWNrZXRzIG9uIHRoZSBHUFUgcGF0aCBleGNsdWRlIHRoZSB0aWNrIGFuZCB3aW5kb3cgZnJvbSB0aGUga2V5OlxyXG4gICAgICAgICAgICAvLyB0aG9zZSBjaGFuZ2UgcGVyIHRpY2sgYW5kIGFyZSBhcHBsaWVkIGFzIHVuaWZvcm1zLCBub3QgYnkgcmVidWlsZGluZy5cclxuICAgICAgICAgICAgLy8gVGhlIHBlcmlvZCBzdGF5cyBpbiwgc2luY2UgaXQgaXMgYmFrZWQgaW50byB0aGUgZHVyYXRpb24gYXR0cmlidXRlcy5cclxuICAgICAgICAgICAgLy8gRXZlcnl0aGluZyBlbHNlIC0tIGFuZCBldmVyeSBub24tcG9pbnQgYnVja2V0IC0tIHJlYnVpbGRzIGFzIGJlZm9yZS5cclxuICAgICAgICAgICAgY29uc3QgZ3B1UG9pbnRzID0gKCh0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCIpXHJcbiAgICAgICAgICAgICAgICAmJiBncHVUaW1lQXZhaWxhYmxlKCkpIHx8IHZlY3RvckdwdTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHZpc2libGVMYXllcnMubWFwKGwgPT4gKHtcclxuICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IGwuY29sb3IsXHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IGwucmFkaXVzLFxyXG4gICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcclxuICAgICAgICAgICAgICAgIG9wYWNpdHk6IGwub3BhY2l0eSxcclxuICAgICAgICAgICAgICAgIGZpbGxPcGFjaXR5OiBsLmZpbGxPcGFjaXR5LFxyXG4gICAgICAgICAgICAgICAgaGlnaGxpZ2h0OiBsLmhpZ2hsaWdodF9zdHlsZSxcclxuICAgICAgICAgICAgICAgIG92ZXJyaWRlczogbC5zdHlsZV9vdmVycmlkZXMsXHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlU3R5bGVzOiBsLmZlYXR1cmVfc3R5bGVzLFxyXG4gICAgICAgICAgICAgICAgdGltZTogbC50aW1lLFxyXG4gICAgICAgICAgICAgICAgZ3B1OiBncHVQb2ludHMsXHJcbiAgICAgICAgICAgICAgICB0aWNrOiBsLnRpbWUgJiYgdGltZVN0YXRlICYmICFncHVQb2ludHMgPyB0aW1lU3RhdGUudGljayA6IDAsXHJcbiAgICAgICAgICAgICAgICB3aW46IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgcGVyOiBsLnRpbWUgJiYgZ3B1UG9pbnRzICYmIHRpbWVTdGF0ZVxyXG4gICAgICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodGltZVN0YXRlLnBlcmlvZCkgOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgLy8gSWRlbnRpdHkgb2YgZXZlcnkgYnVmZmVyIHRoZSBidWNrZXQgcmVhZHMgZm9yIHRoaXMgbGF5ZXI6XHJcbiAgICAgICAgICAgICAgICAvLyBzYW1lLWxlbmd0aCByZXBsYWNlbWVudHMgbXVzdCByZWJ1aWxkIHRvby5cclxuICAgICAgICAgICAgICAgIGJ1ZlNlcmlhbDogW2wuaWQsIGAke2wuaWR9Ojpjb2xvcnNgLCBgJHtsLmlkfTo6cmFkaWlgLCBgJHtsLmlkfTo6dGltZXNgXVxyXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoayA9PiBidWZmZXJTZXJpYWwoY29vcmRpbmF0ZUJ1ZmZlcnNba10pKSxcclxuICAgICAgICAgICAgICAgIGxvY0xlbjogbC5sb2NhdGlvbnM/Lmxlbmd0aCB8fCAwXHJcbiAgICAgICAgICAgIH0pKSk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZUNoYW5nZWQgPSBzdGF0ZS5pZHMgIT09IGlkc1N0cmluZyB8fCBzdGF0ZS5tZXRhICE9PSBtZXRhU3RyaW5nO1xyXG5cclxuICAgICAgICAgICAgaWYgKHN0YXRlQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0aXJlR2woc3RhdGUubGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJ1aWx0ID0gYXdhaXQgcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIHZpc2libGVMYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBsYXllckV2ZW50cywgdGltZVN0YXRlLCB2ZWN0b3JHcHUsIGZlYXR1cmVWaXNpYmxlTm93KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZGVzdHJveWVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIERlc3Ryb3llZCBtaWQtYnVpbGQ6IHJldGlyZSB0aGUgaW5zdGFuY2UgZ2xpZnkgcmVnaXN0ZXJlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyAoaXRzIEdMIGNvbnRleHQgZ29lcyB3aXRoIGl0KSBpbnN0ZWFkIG9mIGFkZGluZyBpdCB0byBhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlbW92ZWQgbWFwLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXRpcmVHbChidWlsdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBidWlsdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIuYWRkVG8obWFwKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHN0YXRlLmlkcyA9IGlkc1N0cmluZztcclxuICAgICAgICAgICAgICAgIHN0YXRlLm1ldGEgPSBtZXRhU3RyaW5nO1xyXG4gICAgICAgICAgICAgICAgLy8gVGhlIHZpc2liaWxpdHkgY2FjaGUgZGVzY3JpYmVkIHRoZSBoYW5kbGUganVzdCByZXRpcmVkLiBBIHJlYnVpbHRcclxuICAgICAgICAgICAgICAgIC8vIGJ1Y2tldCBpcyBib3JuIGFsbC12aXNpYmxlLCBzbyB0aGUgbmV4dCBwYXNzIG11c3QgdXBsb2FkIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gdmVjdG9yIGV2ZW4gd2hlbiBpdCBkaWQgbm90IGNoYW5nZSAtLSBvdGhlcndpc2UgZXZlcnkgcmVidWlsZFxyXG4gICAgICAgICAgICAgICAgLy8gKGFuIGFwcGVuZCBtb3ZlcyBidWZMZW4sIGEgaGlnaGxpZ2h0IG1vdmVzIHRoZSBzdHlsZSBrZXkpIGRyZXdcclxuICAgICAgICAgICAgICAgIC8vIGhpZGRlbiBsYXllcnMgYWdhaW4gdW50aWwgdGhlIHVzZXIgcmUtdG9nZ2xlZCB0aGVtLlxyXG4gICAgICAgICAgICAgICAgc3RhdGUudmlzS2V5ID0gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gUG9pbnQgYnVja2V0cyBob2xkaW5nIHRpbWUgbGF5ZXJzIGtlZXAgRVZFUlkgcG9pbnQgbGF5ZXIgLS0gaGlkZGVuIG9uZXNcclxuICAgICAgICAvLyBpbmNsdWRlZCAtLSBzbyBhIHNpZGViYXIgdG9nZ2xlIGNoYW5nZXMgYSB2aXNpYmlsaXR5IHVuaWZvcm0gaW5zdGVhZCBvZlxyXG4gICAgICAgIC8vIHRoZSBidWNrZXQncyBpZHMuIFVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlYnVpbGQgYWxsIDVNXHJcbiAgICAgICAgLy8gcG9pbnRzOyBjbGlja2luZyBkb3duIHRoZSBzaWRlYmFyIHN0YWNrZWQgdGhvc2UgcmVidWlsZHMgaW50byBhIGNyYXNoLlxyXG4gICAgICAgIGNvbnN0IGFsbEJ5VHlwZSA9IGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgLy8gQXJlYSBvdXRsaW5lcyByaWRlIHRoZSBsaW5lcyBidWNrZXQ6IGV2ZXJ5IHBvbHlnb24gYW5kIGNpcmNsZSBqb2lucyBpdCBhc1xyXG4gICAgICAgIC8vIGFuIGV4dHJhIGVudHJ5IHdob3NlIHJpbmdzIHJlbmRlciBhcyB3ZWlnaHRlZCBMaW5lU3RyaW5ncyAodGhlIHBvbHlnb25cclxuICAgICAgICAvLyBidWNrZXQgZHJhd3Mgb25seSB0aGUgZmlsbCkuIEpvaW5pbmcgdW5jb25kaXRpb25hbGx5IC0tIHN0cm9rZWxlc3MgYXJlYXNcclxuICAgICAgICAvLyBjb250cmlidXRlIGFuIGVtcHR5IHNsb3QgLS0ga2VlcHMgdGhlIGJ1Y2tldCdzIG1lbWJlcnNoaXAgaW5kZXBlbmRlbnQgb2ZcclxuICAgICAgICAvLyBzdHlsZSBjaGFuZ2VzLCBzbyByZXN0eWxpbmcgYSBib3JkZXIgc3RheXMgYSByZWJ1aWxkLCBuZXZlciBhIHJlLWJ1Y2tldC5cclxuICAgICAgICBhbGxCeVR5cGUucG9seWxpbmUgPSBbLi4uYWxsQnlUeXBlLnBvbHlsaW5lLCAuLi5hbGxCeVR5cGUucG9seWdvbl07XHJcbiAgICAgICAgY29uc3QgYnVja2V0ID0geyBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlsaW5lOiBbLi4ud2ViZ2xQb2x5bGluZUxheWVycywgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyB9O1xyXG4gICAgICAgIGNvbnN0IHZlY3RvckdwdUJ1Y2tldCA9IHsgcG9seWxpbmU6IGZhbHNlLCBwb2x5Z29uOiBmYWxzZSB9O1xyXG4gICAgICAgIGZvciAoY29uc3QgdHlwZSBvZiBbXCJjaXJjbGVfbWFya2Vyc1wiLCBcIm1hcmtlcnNcIiwgXCJwb2x5bGluZVwiLCBcInBvbHlnb25cIl0pIHtcclxuICAgICAgICAgICAgY29uc3QgZW50cmllcyA9IGFsbEJ5VHlwZVt0eXBlXTtcclxuICAgICAgICAgICAgY29uc3QgaXNQb2ludHMgPSB0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCI7XHJcbiAgICAgICAgICAgIGNvbnN0IGF2YWlsYWJsZSA9IGlzUG9pbnRzID8gZ3B1VGltZUF2YWlsYWJsZSgpIDogdmVjdG9yR3B1QXZhaWxhYmxlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGdwdVZpcyA9IGF2YWlsYWJsZSAmJiBlbnRyaWVzLmxlbmd0aCA+IDBcclxuICAgICAgICAgICAgICAgICYmIGVudHJpZXMubGVuZ3RoIDw9IExBWUVSX1NMT1RTXHJcbiAgICAgICAgICAgICAgICAmJiBlbnRyaWVzLnNvbWUoZSA9PiBlLmxheWVyLnRpbWUpO1xyXG4gICAgICAgICAgICBnbFN0YXRlc1t0eXBlXS52aXNWZWN0b3IgPSBncHVWaXMgPyBlbnRyaWVzLm1hcChlID0+IChlLnZpcyA/IDEgOiAwKSkgOiBudWxsO1xyXG4gICAgICAgICAgICBpZiAoZ3B1VmlzKSBidWNrZXRbdHlwZV0gPSBlbnRyaWVzLm1hcChlID0+IGUubGF5ZXIpO1xyXG4gICAgICAgICAgICBpZiAoIWlzUG9pbnRzKSB2ZWN0b3JHcHVCdWNrZXRbdHlwZV0gPSBncHVWaXM7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcImNpcmNsZV9tYXJrZXJzXCIsIGJ1Y2tldC5jaXJjbGVfbWFya2Vycyk7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwibWFya2Vyc1wiLCBidWNrZXQubWFya2Vycyk7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWxpbmVcIiwgYnVja2V0LnBvbHlsaW5lLCB2ZWN0b3JHcHVCdWNrZXQucG9seWxpbmUpO1xyXG4gICAgICAgIGlmIChkZXN0cm95ZWQpIHJldHVybjtcclxuICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlnb25cIiwgYnVja2V0LnBvbHlnb24sIHZlY3RvckdwdUJ1Y2tldC5wb2x5Z29uKTtcclxuICAgICAgICBpZiAoZGVzdHJveWVkKSByZXR1cm47XHJcblxyXG4gICAgICAgIC8vIFB1c2ggdGhlIGN1cnJlbnQgd2luZG93IGludG8gdGhlIEdQVS1maWx0ZXJlZCBwb2ludCBidWNrZXRzOiB0d28gdW5pZm9ybXNcclxuICAgICAgICAvLyBhbmQgYSByZWRyYXcsIHdoaWNoIGlzIHRoZSBlbnRpcmUgcGVyLXRpY2sgY29zdCBvZiB0aGUgdGltZSBzbGlkZXIgdGhlcmUuXHJcbiAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xyXG4gICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xyXG4gICAgICAgICAgICBjb25zdCBoYW5kbGUgPSBzdGF0ZS5sYXllciAmJiBzdGF0ZS5sYXllci5fc3dpZnRtYXBUaW1lO1xyXG4gICAgICAgICAgICBpZiAoIWhhbmRsZSkgY29udGludWU7XHJcbiAgICAgICAgICAgIC8vIExheWVyIHZpc2liaWxpdHkgZmlyc3QsIGFuZCBvbmx5IHdoZW4gaXQgY2hhbmdlZDogYSB0b2dnbGUgY29zdHMgb25lXHJcbiAgICAgICAgICAgIC8vIHVuaWZvcm0gYXJyYXkgd3JpdGUgYW5kIGEgcmVkcmF3LCBuZXZlciBhIHJlYnVpbGQuXHJcbiAgICAgICAgICAgIGNvbnN0IHZpcyA9IHN0YXRlLnZpc1ZlY3RvcjtcclxuICAgICAgICAgICAgaWYgKHZpcykge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gdmlzLmpvaW4oXCJcIik7XHJcbiAgICAgICAgICAgICAgICBpZiAoc3RhdGUudmlzS2V5ICE9PSBrZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS52aXNLZXkgPSBrZXk7XHJcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldExheWVyVmlzaWJpbGl0eSh2aXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG92ZXJyaWRlTXMgPSB0aW1lU3RhdGUud2luZG93XHJcbiAgICAgICAgICAgICAgICAgICAgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHRpbWVTdGF0ZS53aW5kb3cpKSA6IG51bGw7XHJcbiAgICAgICAgICAgICAgICBoYW5kbGUuc2V0V2luZG93KHRpbWVTdGF0ZS50aWNrLCBvdmVycmlkZU1zKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3cobnVsbCwgbnVsbCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIHtcclxuICAgICAgICAgICAgZ3JvdXBDb25maWdzLFxyXG4gICAgICAgICAgICBjb29yZGluYXRlQnVmZmVycyxcclxuICAgICAgICAgICAgb25MYXllcldyaXRlOiAoY2hhbmdlcykgPT4gc2VuZExheWVyV3JpdGUoaG9zdCwgY2hhbmdlcyksXHJcbiAgICAgICAgICAgIC8vIGdyb3VwX2NvbmZpZ3Mgc3RheXMgb24gdGhlIGhvc3Q6IGEgaGFuZGZ1bCBvZiBmb2xkZXIgZmxhZ3MsIGFuZCB0aGVcclxuICAgICAgICAgICAgLy8gc3ByZWFkIGdpdmVzIEJhY2tib25lIGEgZnJlc2ggcmVmZXJlbmNlIHNvIGluLXBsYWNlIGVkaXRzIHJlZ2lzdGVyLlxyXG4gICAgICAgICAgICBvbkdyb3VwQ29uZmlnc0NoYW5nZTogKGNmZykgPT4ge1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJncm91cF9jb25maWdzXCIsIHsgLi4uY2ZnIH0pO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9LCBtYXAsICgpID0+IHtcclxuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gUGVybWFuZW50IGxhYmVscyBmb2xsb3cgdGhlIHNhbWUgZGVyaXZlLXBlci1zeW5jIHBhdHRlcm4gYXMgdGhlIGxlZ2VuZCxcclxuICAgICAgICAvLyBzbyB0aGV5IHRyYWNrIHZpc2liaWxpdHkgd2l0aCBubyBidWNrZXQgb3IgbWV0YS1rZXkgaW52b2x2ZW1lbnQgLS0gYW5kXHJcbiAgICAgICAgLy8gc2luY2UgZXZlcnkgcGxheWJhY2sgdGljayByZS1lbnRlcnMgdGhpcyBzeW5jLCBwYXNzaW5nIHRpbWVTdGF0ZSBtYWtlc1xyXG4gICAgICAgIC8vIHRoZW0gZm9sbG93IHRoZSB3aW5kb3cgdG9vOiBjaGlwcyBhcHBlYXIgYW5kIHZhbmlzaCB3aXRoIHRoZWlyIGZlYXR1cmVzLlxyXG4gICAgICAgIGlmIChsYWJlbHNHcm91cCkge1xyXG4gICAgICAgICAgICByZW5kZXJMYWJlbHMoTCwgbGFiZWxzR3JvdXAsIGxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIGdyb3VwQ29uZmlncyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBsZWdlbmRDZmcgPSBob3N0LmdldChcImxlZ2VuZF9jb25maWdcIikgfHwge307XHJcbiAgICAgICAgaWYgKGhvc3QuZ2V0KFwic2hvd19sZWdlbmRcIikpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BlYyA9IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGxlZ2VuZENmZyk7XHJcbiAgICAgICAgICAgIHJlbmRlckxlZ2VuZChsZWdlbmREaXYsIHNwZWMsXHJcbiAgICAgICAgICAgICAgICB7IGRpbUhpZGRlbjogbGVnZW5kQ2ZnLmRpbV9oaWRkZW4gIT09IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBwb3MgPSBQT1NJVElPTlNbbGVnZW5kQ2ZnLnBvc2l0aW9uXSB8fCBQT1NJVElPTlNbXCJib3R0b20tbGVmdFwiXTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBvcykpIHtcclxuICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZVtwcm9wXSA9IHZhbHVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gc3BlYy5ncm91cHMubGVuZ3RoID4gMCA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUudGltZUVuZChcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xyXG4gICAgbGV0IGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xyXG5cclxuICAgIC8vIERyYXcgLyBBT0kgdG9vbHM6IExlYWZsZXQtR2VvbWFuICh0aGUgbWFpbnRhaW5lZCBzdWNjZXNzb3IgdG8gTGVhZmxldC5kcmF3LFxyXG4gICAgLy8gd2hpY2ggYnJlYWtzIG9uIExlYWZsZXQgMS45KSwgbG9hZGVkIGZyb20gdW5wa2cgbGlrZSBMZWFmbGV0IGFuZCBnbGlmeSAtLVxyXG4gICAgLy8gbGF6aWx5LCBvbmx5IHdoZW4gYSBtYXAgdHVybnMgZHJhd2luZyBvbiwgc28gZXZlcnkgb3RoZXIgbWFwIHBheXMgbm90aGluZy5cclxuICAgIC8vIERyYXduIHNoYXBlcyBsaXZlIGluIHRoZWlyIG93biBmZWF0dXJlIGdyb3VwIGFuZCBzeW5jIHRvIFB5dGhvbiBhcyBHZW9KU09OXHJcbiAgICAvLyBmZWF0dXJlcyB1bmRlciB0aGUgYGRyYXdpbmdzYCB0cmFpdCwgd2l0aCBgZHJhd19zZXFgIGJ1bXBpbmcgcGVyIGNoYW5nZSBzb1xyXG4gICAgLy8gb25lIG9ic2VydmVyIGNhdGNoZXMgY3JlYXRlLCBlZGl0IGFuZCBkZWxldGUgYWxpa2UuIFRoZSB0cmFpdCBzeW5jcyBib3RoXHJcbiAgICAvLyB3YXlzOiBQeXRob24gY2FuIHNlZWQgQU9JcyBvciBjbGVhciB0aGVtLCBhbmQgZXhwb3J0cyBjYXJyeSB0aGUgZHJhd2luZ3MuXHJcbiAgICBsZXQgZHJhd1JlYWR5ID0gZmFsc2U7XHJcbiAgICBsZXQgZHJhd2luZ3NHcm91cCA9IG51bGw7XHJcbiAgICBsZXQgZHJhd0lkQ291bnRlciA9IDA7XHJcbiAgICBsZXQgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSBmYWxzZTtcclxuXHJcbiAgICBmdW5jdGlvbiBkcmF3aW5nVG9GZWF0dXJlKGwpIHtcclxuICAgICAgICBjb25zdCBnaiA9IGwudG9HZW9KU09OKCk7XHJcbiAgICAgICAgZ2oucHJvcGVydGllcyA9IHsgLi4uKGdqLnByb3BlcnRpZXMgfHwge30pLCBkcmF3X2lkOiBsLl9zd2lmdG1hcERyYXdJZCB9O1xyXG4gICAgICAgIGlmICh0eXBlb2YgbC5nZXRSYWRpdXMgPT09IFwiZnVuY3Rpb25cIiAmJiBsIGluc3RhbmNlb2YgTC5DaXJjbGUpIHtcclxuICAgICAgICAgICAgZ2oucHJvcGVydGllcy5raW5kID0gXCJjaXJjbGVcIjtcclxuICAgICAgICAgICAgZ2oucHJvcGVydGllcy5yYWRpdXMgPSBsLmdldFJhZGl1cygpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gZ2o7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gd3JpdGVEcmF3aW5ncygpIHtcclxuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xyXG4gICAgICAgIGRyYXdpbmdzR3JvdXAuZWFjaExheWVyKGwgPT4gZmVhdHVyZXMucHVzaChkcmF3aW5nVG9GZWF0dXJlKGwpKSk7XHJcbiAgICAgICAgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSB0cnVlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0KFwiZHJhd2luZ3NcIiwgZmVhdHVyZXMpO1xyXG4gICAgICAgICAgICBob3N0LnNldChcImRyYXdfc2VxXCIsIChob3N0LmdldChcImRyYXdfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgIGhvc3Quc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGRyYXdpbmdzIHN0aWxsIGxpdmUgb24gdGhlIG1hcCAqLyB9XHJcbiAgICAgICAgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSBmYWxzZTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBhZG9wdERyYXdpbmcobGF5ZXIpIHtcclxuICAgICAgICBpZiAoIWxheWVyLl9zd2lmdG1hcERyYXdJZCkge1xyXG4gICAgICAgICAgICBsYXllci5fc3dpZnRtYXBEcmF3SWQgPSBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xyXG4gICAgICAgIH1cclxuICAgICAgICBkcmF3aW5nc0dyb3VwLmFkZExheWVyKGxheWVyKTtcclxuICAgICAgICBsYXllci5vbihcInBtOnVwZGF0ZSBwbTpkcmFnZW5kIHBtOnJvdGF0ZWVuZFwiLCB3cml0ZURyYXdpbmdzKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiByZWh5ZHJhdGVEcmF3aW5ncygpIHtcclxuICAgICAgICBkcmF3aW5nc0dyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICAgICAgZm9yIChjb25zdCBmZWF0dXJlIG9mIGhvc3QuZ2V0KFwiZHJhd2luZ3NcIikgfHwgW10pIHtcclxuICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBmZWF0dXJlLnByb3BlcnRpZXMgfHwge307XHJcbiAgICAgICAgICAgIGxldCBsYXllcjtcclxuICAgICAgICAgICAgaWYgKHByb3BzLmtpbmQgPT09IFwiY2lyY2xlXCIgJiYgZmVhdHVyZS5nZW9tZXRyeS50eXBlID09PSBcIlBvaW50XCIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtsbmcsIGxhdF0gPSBmZWF0dXJlLmdlb21ldHJ5LmNvb3JkaW5hdGVzO1xyXG4gICAgICAgICAgICAgICAgbGF5ZXIgPSBMLmNpcmNsZShbbGF0LCBsbmddLCB7IHJhZGl1czogcHJvcHMucmFkaXVzIHx8IDEwMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInN3aWZ0bWFwRHJhd1BhbmVcIiB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGxheWVyID0gTC5nZW9KU09OKGZlYXR1cmUsIHsgcGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIgfSlcclxuICAgICAgICAgICAgICAgICAgICAuZ2V0TGF5ZXJzKClbMF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKCFsYXllcikgY29udGludWU7XHJcbiAgICAgICAgICAgIGxheWVyLl9zd2lmdG1hcERyYXdJZCA9IHByb3BzLmRyYXdfaWQgfHwgYGRyYXdfJHsrK2RyYXdJZENvdW50ZXJ9YDtcclxuICAgICAgICAgICAgYWRvcHREcmF3aW5nKGxheWVyKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gc3luY0RyYXcoKSB7XHJcbiAgICAgICAgY29uc3Qgc2hvdyA9IGhvc3QuZ2V0KFwic2hvd19kcmF3XCIpO1xyXG4gICAgICAgIGNvbnN0IGNmZyA9IGhvc3QuZ2V0KFwiZHJhd19jb25maWdcIikgfHwge307XHJcbiAgICAgICAgaWYgKHNob3cgJiYgIWRyYXdSZWFkeSkge1xyXG4gICAgICAgICAgICBkcmF3UmVhZHkgPSB0cnVlO1xyXG4gICAgICAgICAgICAvLyBFdmVyeXRoaW5nIEdlb21hbiBjcmVhdGVzIGdvZXMgdG8gdGhlIHBhbmUgYWJvdmUgdGhlIEdMIHN0YWNrLlxyXG4gICAgICAgICAgICBtYXAucG0uc2V0R2xvYmFsT3B0aW9ucyh7XHJcbiAgICAgICAgICAgICAgICBwYW5lczogeyBsYXllclBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdmVydGV4UGFuZTogXCJtYXJrZXJQYW5lXCIsIG1hcmtlclBhbmU6IFwibWFya2VyUGFuZVwiIH0sXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBkcmF3aW5nc0dyb3VwID0gTC5mZWF0dXJlR3JvdXAoKS5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICByZWh5ZHJhdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICBtYXAub24oXCJwbTpjcmVhdGVcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGFkb3B0RHJhd2luZyhlLmxheWVyKTtcclxuICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG1hcC5vbihcInBtOnJlbW92ZVwiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gR2VvbWFuIHJlbW92ZXMgdGhlIGxheWVyIGZyb20gdGhlIE1BUDsgdGhlIGZlYXR1cmUgZ3JvdXAgc3RpbGxcclxuICAgICAgICAgICAgICAgIC8vIGhvbGRzIGl0LCBhbmQgd3JpdGVEcmF3aW5ncyByZWFkcyB0aGUgZ3JvdXAgLS0gZXZpY3QgaXQgZmlyc3RcclxuICAgICAgICAgICAgICAgIC8vIG9yIHRoZSBkZWxldGlvbiBuZXZlciByZWFjaGVzIHRoZSB0cmFpdC5cclxuICAgICAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAucmVtb3ZlTGF5ZXIoZS5sYXllcik7XHJcbiAgICAgICAgICAgICAgICB3cml0ZURyYXdpbmdzKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBsaXN0ZW4oXCJjaGFuZ2U6ZHJhd2luZ3NcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzdXBwcmVzc0RyYXdpbmdzRWNobykgcmVoeWRyYXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghZHJhd1JlYWR5KSByZXR1cm47XHJcbiAgICAgICAgaWYgKHNob3cpIHtcclxuICAgICAgICAgICAgY29uc3QgdG9vbHMgPSBjZmcudG9vbHNcclxuICAgICAgICAgICAgICAgIHx8IFtcIm1hcmtlclwiLCBcInBvbHlsaW5lXCIsIFwicmVjdGFuZ2xlXCIsIFwicG9seWdvblwiLCBcImNpcmNsZVwiXTtcclxuICAgICAgICAgICAgbWFwLnBtLmFkZENvbnRyb2xzKHtcclxuICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAoY2ZnLnBvc2l0aW9uIHx8IFwidG9wLWxlZnRcIikucmVwbGFjZShcIi1cIiwgXCJcIiksXHJcbiAgICAgICAgICAgICAgICBkcmF3TWFya2VyOiB0b29scy5pbmNsdWRlcyhcIm1hcmtlclwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdQb2x5bGluZTogdG9vbHMuaW5jbHVkZXMoXCJwb2x5bGluZVwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdSZWN0YW5nbGU6IHRvb2xzLmluY2x1ZGVzKFwicmVjdGFuZ2xlXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd1BvbHlnb246IHRvb2xzLmluY2x1ZGVzKFwicG9seWdvblwiKSxcclxuICAgICAgICAgICAgICAgIGRyYXdDaXJjbGU6IHRvb2xzLmluY2x1ZGVzKFwiY2lyY2xlXCIpLFxyXG4gICAgICAgICAgICAgICAgZHJhd0NpcmNsZU1hcmtlcjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBkcmF3VGV4dDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICByb3RhdGVNb2RlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGN1dFBvbHlnb246IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgZWRpdE1vZGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBkcmFnTW9kZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHJlbW92YWxNb2RlOiB0cnVlLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBtYXAucG0ucmVtb3ZlQ29udHJvbHMoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBzeW5jRHJhdygpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnNob3dfZHJhd1wiLCBzeW5jRHJhdyk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6ZHJhd19jb25maWdcIiwgc3luY0RyYXcpO1xyXG5cclxuICAgIC8vIFRoZSBzY2FsZSBiYXI6IExlYWZsZXQncyBvd24gY29udHJvbCwgd2hpY2ggbWVhc3VyZXMgdGhyb3VnaCB0aGUgbWFwJ3MgQ1JTXHJcbiAgICAvLyAoaGF2ZXJzaW5lIHVuZGVyIDM4NTcgYW5kIDQzMjYgYWxpa2UgLS0gbm8gcGl4ZWwgbWF0aCBvZiBvdXJzKSwgZXh0ZW5kZWRcclxuICAgIC8vIHdpdGggdGhlIHVuaXQgTGVhZmxldCBsYWNrcyBhbmQgdGhpcyBkb21haW4gcnVucyBvbjogbmF1dGljYWwgbWlsZXMuXHJcbiAgICBjb25zdCBOYXV0aWNhbFNjYWxlID0gTC5Db250cm9sLlNjYWxlLmV4dGVuZCh7XHJcbiAgICAgICAgb25BZGQ6IGZ1bmN0aW9uIChtKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IEwuQ29udHJvbC5TY2FsZS5wcm90b3R5cGUub25BZGQuY2FsbCh0aGlzLCBtKTtcclxuICAgICAgICAgICAgdGhpcy5fbmF1dGljYWxTY2FsZSA9IEwuRG9tVXRpbC5jcmVhdGUoXHJcbiAgICAgICAgICAgICAgICBcImRpdlwiLCBcImxlYWZsZXQtY29udHJvbC1zY2FsZS1saW5lXCIsIGNvbnRhaW5lcik7XHJcbiAgICAgICAgICAgIHRoaXMuX3VwZGF0ZSgpO1xyXG4gICAgICAgICAgICByZXR1cm4gY29udGFpbmVyO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgX3VwZGF0ZVNjYWxlczogZnVuY3Rpb24gKG1heE1ldGVycykge1xyXG4gICAgICAgICAgICBMLkNvbnRyb2wuU2NhbGUucHJvdG90eXBlLl91cGRhdGVTY2FsZXMuY2FsbCh0aGlzLCBtYXhNZXRlcnMpO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fbmF1dGljYWxTY2FsZSAmJiBtYXhNZXRlcnMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1heE5tID0gbWF4TWV0ZXJzIC8gMTg1MjtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG5tID0gdGhpcy5fZ2V0Um91bmROdW0obWF4Tm0pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlU2NhbGUodGhpcy5fbmF1dGljYWxTY2FsZSwgYCR7bm19IG5tYCwgbm0gLyBtYXhObSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgbGV0IHNjYWxlQ29udHJvbCA9IG51bGw7XHJcbiAgICBmdW5jdGlvbiBzeW5jU2NhbGUoKSB7XHJcbiAgICAgICAgaWYgKHNjYWxlQ29udHJvbCkge1xyXG4gICAgICAgICAgICBzY2FsZUNvbnRyb2wucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbCA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghaG9zdC5nZXQoXCJzaG93X3NjYWxlXCIpKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgY2ZnID0gaG9zdC5nZXQoXCJzY2FsZV9jb25maWdcIikgfHwge307XHJcbiAgICAgICAgY29uc3QgdW5pdHMgPSBjZmcudW5pdHMgfHwgXCJtZXRyaWNcIjtcclxuICAgICAgICBjb25zdCBvcHRpb25zID0ge1xyXG4gICAgICAgICAgICBwb3NpdGlvbjogKGNmZy5wb3NpdGlvbiB8fCBcImJvdHRvbS1sZWZ0XCIpLnJlcGxhY2UoXCItXCIsIFwiXCIpLFxyXG4gICAgICAgICAgICBtYXhXaWR0aDogY2ZnLm1heF93aWR0aCB8fCAxMjAsXHJcbiAgICAgICAgICAgIG1ldHJpYzogdW5pdHMgPT09IFwibWV0cmljXCIgfHwgdW5pdHMgPT09IFwiYm90aFwiLFxyXG4gICAgICAgICAgICBpbXBlcmlhbDogdW5pdHMgPT09IFwiaW1wZXJpYWxcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBzY2FsZUNvbnRyb2wgPSB1bml0cyA9PT0gXCJuYXV0aWNhbFwiXHJcbiAgICAgICAgICAgID8gbmV3IE5hdXRpY2FsU2NhbGUob3B0aW9ucylcclxuICAgICAgICAgICAgOiBMLmNvbnRyb2wuc2NhbGUob3B0aW9ucyk7XHJcbiAgICAgICAgc2NhbGVDb250cm9sLmFkZFRvKG1hcCk7XHJcbiAgICB9XHJcbiAgICBzeW5jU2NhbGUoKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpzaG93X3NjYWxlXCIsIHN5bmNTY2FsZSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2NhbGVfY29uZmlnXCIsIHN5bmNTY2FsZSk7XHJcblxyXG4gICAgLy8gRW1wdHktbWFwIGNsaWNrczogcmVwb3J0IHdoZXJlLiBSZWdpc3RlcmVkIHRocm91Z2ggdGhlIHNhbWUgYXJiaXRyYXRpb24gdGhlXHJcbiAgICAvLyBmZWF0dXJlIGhhbmRsZXJzIHVzZSwgYXQgdGhlIGxvd2VzdCBwcmlvcml0eSwgc28gYSBjbGljayB0aGF0IGhpdCBhIGZlYXR1cmVcclxuICAgIC8vIHN0YXlzIHRoYXQgZmVhdHVyZSdzIGNsaWNrIC0tIHRoaXMgd2lucyBvbmx5IHdoZW4gbm90aGluZyBjbGFpbWVkIHRoZSBldmVudC5cclxuICAgIC8vIGUubGF0bG5nIGlzIGFscmVhZHkgdW5wcm9qZWN0ZWQgdGhyb3VnaCB3aGljaGV2ZXIgQ1JTIHRoZSBtYXAgcnVucyAoMzg1NyBhbmRcclxuICAgIC8vIDQzMjYgYWxpa2UpLCBzbyB0aGVyZSBpcyBubyBwaXhlbCBtYXRoIHRvIGdldCB3cm9uZyBoZXJlOyB3cmFwKCkga2VlcHMgYVxyXG4gICAgLy8gd29ybGQtcGFubmVkIG1hcCBmcm9tIHJlcG9ydGluZyBsb25naXR1ZGUgLTM2NC5cclxuICAgIG1hcC5vbihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgLy8gU3RhbXBlZCBzeW5jaHJvbm91c2x5LCBiZWZvcmUgYW55IGdsaWZ5IGhhbmRsZXIgcmVnaXN0ZXJzIGl0cyBtYXRjaFxyXG4gICAgICAgIC8vICh0aGlzIGhhbmRsZXIgd2FzIGJvdW5kIGZpcnN0LCBzbyBMZWFmbGV0IHJ1bnMgaXQgZmlyc3QpOiB0aGUgd2hvbGVcclxuICAgICAgICAvLyBjbGljayBwaXBlbGluZSAtLSBmZWF0dXJlIHBvcHVwcyBhbmQgdGhpcyBmYWxsYmFjayBhbGlrZSAtLSBzdGFuZHNcclxuICAgICAgICAvLyBkb3duIHdoaWxlIGEgR2VvbWFuIG1vZGUgaXMgYXJtZWQuIERlZmVycmVkIGNoZWNrcyBtaXNzIG1vZGVzIHRoYXRcclxuICAgICAgICAvLyBjbG9zZSB0aGVtc2VsdmVzIG9uIHRoZWlyIGZpbmlzaGluZyBjbGljayAoYSBjb21wbGV0ZWQgcmVjdGFuZ2xlKSxcclxuICAgICAgICAvLyB3aGljaCBpcyB3aHkgdGhlIHN0YXRlIGlzIGNhcHR1cmVkIGF0IGNsaWNrIHRpbWUuXHJcbiAgICAgICAgY29uc3QgcG0gPSBtYXAucG07XHJcbiAgICAgICAgbWFwLl9wbU1vZGVBY3RpdmUgPSBCb29sZWFuKHBtXHJcbiAgICAgICAgICAgICYmICgocG0uZ2xvYmFsUmVtb3ZhbE1vZGVFbmFibGVkICYmIHBtLmdsb2JhbFJlbW92YWxNb2RlRW5hYmxlZCgpKVxyXG4gICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbEVkaXRNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxFZGl0TW9kZUVuYWJsZWQoKSlcclxuICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmFnTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhZ01vZGVFbmFibGVkKCkpXHJcbiAgICAgICAgICAgICAgICB8fCAocG0uZ2xvYmFsRHJhd01vZGVFbmFibGVkICYmIHBtLmdsb2JhbERyYXdNb2RlRW5hYmxlZCgpKSkpO1xyXG4gICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDk5LCAoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxsID0gZS5sYXRsbmcud3JhcCgpO1xyXG4gICAgICAgICAgICBjb25zdCBsYXQgPSBNYXRoLnJvdW5kKGxsLmxhdCAqIDFlNSkgLyAxZTU7XHJcbiAgICAgICAgICAgIGNvbnN0IGxuZyA9IE1hdGgucm91bmQobGwubG5nICogMWU1KSAvIDFlNTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBcIlwiKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgLTEpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLCBbbGF0LCBsbmddKTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiY2xpY2tfc2VxXCIsIChob3N0LmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xyXG4gICAgICAgICAgICAgICAgaG9zdC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XHJcbiAgICAgICAgICAgIGlmIChob3N0LmdldChcInNob3dfY2xpY2tfY29vcmRpbmF0ZXNcIikpIHtcclxuICAgICAgICAgICAgICAgIEwucG9wdXAoeyBjbGFzc05hbWU6IFwic3dpZnRtYXAtY29vcmRzLXBvcHVwXCIsIGNsb3NlQnV0dG9uOiBmYWxzZSB9KVxyXG4gICAgICAgICAgICAgICAgICAgIC5zZXRMYXRMbmcoZS5sYXRsbmcpXHJcbiAgICAgICAgICAgICAgICAgICAgLnNldENvbnRlbnQoYCR7bGwubGF0LnRvRml4ZWQoNSl9LCAke2xsLmxuZy50b0ZpeGVkKDUpfWApXHJcbiAgICAgICAgICAgICAgICAgICAgLm9wZW5PbihtYXApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBCaW5kIHpvb20gYW5kIGNlbnRlciBjaGFuZ2VzIGJhY2sgdG8gUHl0aG9uIHNhZmVseVxyXG4gICAgbWFwLm9uKFwibW92ZWVuZFwiLCAoKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbWFwLmdldENlbnRlcigpO1xyXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50Wm9vbSA9IG1hcC5nZXRab29tKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBtb2RlbENlbnRlciA9IGhvc3QuZ2V0KFwiY2VudGVyXCIpO1xyXG4gICAgICAgICAgICBjb25zdCBtb2RlbFpvb20gPSBob3N0LmdldChcInpvb21cIik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1vZGVsWm9vbSAhPT0gY3VycmVudFpvb207XHJcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSAhbW9kZWxDZW50ZXIgfHwgXHJcbiAgICAgICAgICAgICAgICAhQXJyYXkuaXNBcnJheShtb2RlbENlbnRlcikgfHxcclxuICAgICAgICAgICAgICAgIG1vZGVsQ2VudGVyLmxlbmd0aCA8IDIgfHxcclxuICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzBdIC0gY2VudGVyLmxhdCkgPiAwLjAwMDEgfHwgXHJcbiAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclsxXSAtIGNlbnRlci5sbmcpID4gMC4wMDAxO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICBob3N0LnNldChcImNlbnRlclwiLCBbY2VudGVyLmxhdCwgY2VudGVyLmxuZ10pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGhvc3Quc2V0KFwiem9vbVwiLCBjdXJyZW50Wm9vbSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgIHNhZmVTYXZlQ2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBtb3ZlZW5kIGhhbmRsZXI6XCIsIGVycik7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgZnVuY3Rpb24gdXBkYXRlTWFwVmlldygpIHtcclxuICAgICAgICBjb25zdCBjZW50ZXIgPSBob3N0LmdldChcImNlbnRlclwiKTtcclxuICAgICAgICBjb25zdCB6b29tID0gaG9zdC5nZXQoXCJ6b29tXCIpO1xyXG4gICAgICAgIGlmIChjZW50ZXIgJiYgQXJyYXkuaXNBcnJheShjZW50ZXIpICYmIGNlbnRlci5sZW5ndGggPj0gMikge1xyXG4gICAgICAgICAgICBjb25zdCBtYXBDZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xyXG4gICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gTWF0aC5hYnMobWFwQ2VudGVyLmxhdCAtIGNlbnRlclswXSkgPiAwLjAwMDEgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtYXBDZW50ZXIubG5nIC0gY2VudGVyWzFdKSA+IDAuMDAwMTtcclxuICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtYXBab29tICE9PSB6b29tO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5zZXRWaWV3KGNlbnRlciwgdHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgPyB6b29tIDogbWFwWm9vbSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCB6b29tID0gaG9zdC5nZXQoXCJ6b29tXCIpO1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgJiYgbWFwLmdldFpvb20oKSAhPT0gem9vbSkge1xyXG4gICAgICAgICAgICAgICAgbWFwLnNldFpvb20oem9vbSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gV2F0Y2ggZm9yIG1hcCB2aWV3IHVwZGF0ZXMgZnJvbSBQeXRob25cclxuICAgIGxpc3RlbihcImNoYW5nZTpjZW50ZXJcIiwgKCkgPT4ge1xyXG4gICAgICAgIGlmIChpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCkge1xyXG4gICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcclxuICAgIH0pO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnpvb21cIiwgKCkgPT4ge1xyXG4gICAgICAgIGlmIChpc1VwZGF0aW5nWm9vbUZyb21NYXApIHtcclxuICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgdXBkYXRlTWFwVmlldygpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBGaXR0aW5nIHRoZSB2aWV3IGlzIGEgY29tbWFuZCwgbm90IHN0YXRlOiBhc2tpbmcgdG8gZml0IHRoZSBzYW1lIGJvdW5kcyB0d2ljZVxyXG4gICAgLy8gbXVzdCBtb3ZlIHRoZSBtYXAgYm90aCB0aW1lcywgc2luY2UgdGhlIHVzZXIgbWF5IGhhdmUgcGFubmVkIGF3YXkgaW4gYmV0d2Vlbi5cclxuICAgIC8vIFRoZSByZXF1ZXN0IGNhcnJpZXMgYSBzZXF1ZW5jZSBudW1iZXIgc28gYW4gaWRlbnRpY2FsIGZpdCBzdGlsbCBmaXJlcyBhIGNoYW5nZS5cclxuICAgIGZ1bmN0aW9uIGFwcGx5Rml0UmVxdWVzdCgpIHtcclxuICAgICAgICBjb25zdCByZXEgPSBob3N0LmdldChcImZpdF9ib3VuZHNfcmVxdWVzdFwiKSB8fCB7fTtcclxuICAgICAgICBjb25zdCBib3VuZHMgPSByZXEuYm91bmRzO1xyXG4gICAgICAgIGlmICghYm91bmRzIHx8IGJvdW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xyXG4gICAgICAgIGlmIChyZXEucGFkZGluZyAhPSBudWxsKSBvcHRpb25zLnBhZGRpbmcgPSBbcmVxLnBhZGRpbmcsIHJlcS5wYWRkaW5nXTtcclxuICAgICAgICBpZiAocmVxLm1heF96b29tICE9IG51bGwpIG9wdGlvbnMubWF4Wm9vbSA9IHJlcS5tYXhfem9vbTtcclxuICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcywgb3B0aW9ucyk7XHJcblxyXG4gICAgICAgIC8vIEFwcGxpZWQgYWZ0ZXIgdGhlIGZpdCwgc2luY2UgaXQgaXMgcmVsYXRpdmUgdG8gd2hhdGV2ZXIgem9vbSB0aGUgZml0IGNob3NlLlxyXG4gICAgICAgIGlmIChyZXEuem9vbV9vZmZzZXQpIHtcclxuICAgICAgICAgICAgbWFwLnNldFpvb20obWFwLmdldFpvb20oKSArIHJlcS56b29tX29mZnNldCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmZpdF9ib3VuZHNfcmVxdWVzdFwiLCBhcHBseUZpdFJlcXVlc3QpO1xyXG4gICAgLy8gQSByZXF1ZXN0IHNldCBiZWZvcmUgdGhpcyB2aWV3IGF0dGFjaGVkIC0tIGEgcHJlLWRpc3BsYXkgZml0X2JvdW5kcygpIGNhbGwsXHJcbiAgICAvLyBvciB0aGUgdW5pb24gYSBmcmVzaCBtYXAgbWFpbnRhaW5zIGFzIGF1dG8tZml0IHdoaWxlIGxheWVycyBhcmUgYWRkZWQgLS0gaXNcclxuICAgIC8vIGFscmVhZHkgc3RhdGUgYnkgbm93LCBzbyB0aGUgY2hhbmdlIGV2ZW50IHdpbGwgbmV2ZXIgZmlyZSBmb3IgaXQuIEl0IHVzZWRcclxuICAgIC8vIHRvIGJlIHNpbGVudGx5IGRyb3BwZWQ7IGFwcGx5IGl0IG9uY2UgdGhlIG1hcCBpcyByZWFkeSBpbnN0ZWFkLlxyXG4gICAgbWFwLndoZW5SZWFkeSgoKSA9PiBhcHBseUZpdFJlcXVlc3QoKSk7XHJcbiAgICAvLyBBIG1hcCBjb25zdHJ1Y3RlZCBpbnNpZGUgYSBoaWRkZW4gY29udGFpbmVyIC0tIGEgU2hpbnkgbmF2X3BhbmVsIHRoYXQgaXNcclxuICAgIC8vIG5vdCB0aGUgc2VsZWN0ZWQgdGFiIC0tIGluaXRpYWxpc2VzIGF0IDB4MCwgYW5kIExlYWZsZXQgY2FjaGVzIHRoYXQgc2l6ZTpcclxuICAgIC8vIGl0cyBvd24gdHJhY2tSZXNpemUgd2F0Y2hlcyB0aGUgV0lORE9XLCBub3QgdGhlIGNvbnRhaW5lciwgc28gbm90aGluZyBldmVyXHJcbiAgICAvLyBjb3JyZWN0cyBpdC4gVGhlIGZpdCBhYm92ZSB0aGVuIGNvbXB1dGVzIGl0cyB6b29tIGZyb20gYSB6ZXJvLXNpemUgbGllIGFuZFxyXG4gICAgLy8gdGhlIHZpZXcgbGFuZHMgd3JvbmcgcGVybWFuZW50bHkuIFdhdGNoIHRoZSBjb250YWluZXIgaXRzZWxmOiBldmVyeSByZXNpemVcclxuICAgIC8vIHJlLW1lYXN1cmVzLCBhbmQgdGhlIGZpcnN0IHRyYW5zaXRpb24gZnJvbSB6ZXJvIHRvIHJlYWwgc2l6ZSByZS1hcHBsaWVzXHJcbiAgICAvLyB0aGUgcGVuZGluZyBmaXQgd2l0aCBhIHNpemUgdGhhdCBjYW4gYWN0dWFsbHkgaG9sZCBpdC5cclxuICAgIGxldCBjb250YWluZXJSZXNpemUgPSBudWxsO1xyXG4gICAgaWYgKHR5cGVvZiBSZXNpemVPYnNlcnZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgICAgIGxldCBoYWRTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcclxuICAgICAgICBjb250YWluZXJSZXNpemUgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBoYXNTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcclxuICAgICAgICAgICAgaWYgKGhhc1NpemUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5pbnZhbGlkYXRlU2l6ZSgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFoYWRTaXplKSBhcHBseUZpdFJlcXVlc3QoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBoYWRTaXplID0gaGFzU2l6ZTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250YWluZXJSZXNpemUub2JzZXJ2ZShjb250YWluZXIpO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBzeW5jVGltZW91dCA9IG51bGw7XHJcbiAgICBsZXQgaXNTeW5jaW5nID0gZmFsc2U7XHJcbiAgICBsZXQgbmVlZHNTeW5jID0gZmFsc2U7XHJcblxyXG4gICAgYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVN5bmMoKSB7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGlmIChpc1N5bmNpbmcpIHtcclxuICAgICAgICAgICAgbmVlZHNTeW5jID0gdHJ1ZTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpc1N5bmNpbmcgPSB0cnVlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHN5bmNNYXBTdGF0ZSgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gc3luY01hcFN0YXRlOlwiLCBlcnIpO1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgIGlzU3luY2luZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBpZiAobmVlZHNTeW5jKSB7XHJcbiAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gcXVldWVTeW5jKCkge1xyXG4gICAgICAgIGlmIChkZXN0cm95ZWQgfHwgIWhvc3QuZ2V0KFwiYXV0b19zeW5jXCIpKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHN5bmNUaW1lb3V0KSB7XHJcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHN5bmNUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICB9LCA1MCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTGlzdGVuIGZvciBtYW51YWwgc3luYyB0cmlnZ2VyIGNoYW5nZXMgZnJvbSBQeXRob25cclxuICAgIGxpc3RlbihcImNoYW5nZTpzeW5jX3RyaWdnZXJcIiwgKCkgPT4ge1xyXG4gICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBJbmNyZW1lbnRhbCB1cGRhdGVzIGZyb20gUHl0aG9uLiBBcHBsaWVkIGV2ZW4gd2hlbiBhdXRvX3N5bmMgaXMgb2ZmIHNvIHRoZSBtaXJyb3JcclxuICAgIC8vIHN0YXlzIGN1cnJlbnQ7IHF1ZXVlU3luYyBkZWNpZGVzIHdoZXRoZXIgdG8gYWN0dWFsbHkgcmUtcmVuZGVyLlxyXG4gICAgbGlzdGVuKFwibXNnOmN1c3RvbVwiLCAobXNnLCBidWZmZXJzKSA9PiB7XHJcbiAgICAgICAgaWYgKCFtc2cgfHwgbXNnLmtpbmQgIT09IFwic3dpZnRtYXBfcGF0Y2hcIikgcmV0dXJuO1xyXG4gICAgICAgIGFwcGx5UGF0Y2hPcHMobXNnLm9wcyB8fCBbXSwgYnVmZmVycyk7XHJcbiAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBGdWxsLXNuYXBzaG90IHBhdGhzOiB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlLCBhbmQgdGhlIHNpZGViYXIgd3JpdGluZyBgbGF5ZXJzYFxyXG4gICAgLy8gYmFjayBhZnRlciBhIHRvZ2dsZS4gRWl0aGVyIHdheSB0aGUgdHJhaXQgYmVjb21lcyBhdXRob3JpdGF0aXZlIGFnYWluLlxyXG4gICAgbGlzdGVuKFwiY2hhbmdlOmxheWVyc1wiLCAoKSA9PiB7XHJcbiAgICAgICAgbGF5ZXJTdGF0ZSA9IGhvc3QuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xyXG4gICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6Y29vcmRpbmF0ZV9idWZmZXJzXCIsICgpID0+IHtcclxuICAgICAgICBidWZmZXJTdGF0ZSA9IHsgLi4uKGhvc3QuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xyXG4gICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6Z3JvdXBfY29uZmlnc1wiLCBxdWV1ZVN5bmMpO1xyXG4gICAgbGlzdGVuKFwiY2hhbmdlOnRpbWVfY29uZmlnXCIsICgpID0+IHtcclxuICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlOyAgIC8vIHJlLWFwcGx5IHNwZWVkL2xvb3AgZnJvbSB0aGUgbmV3IGNvbmZpZ1xyXG4gICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcclxuICAgIC8vIHRpbWUuIEd1YXJkZWQgc28gdGhlIHdpZGdldCdzIG93biB3cml0ZWJhY2sgZG9lcyBub3QgbG9vcCB0aHJvdWdoIGhlcmUuXHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6dGltZV9jdXJyZW50XCIsICgpID0+IHtcclxuICAgICAgICBjb25zdCB3YW50ZWQgPSBob3N0LmdldChcInRpbWVfY3VycmVudFwiKTtcclxuICAgICAgICBpZiAoIXRpbWVTdGF0ZSB8fCAhdGltZVVJLnRpY2tzLmxlbmd0aCkgcmV0dXJuO1xyXG4gICAgICAgIGlmIChNYXRoLmFicyh3YW50ZWQgLSB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSkgPCAxKSByZXR1cm47XHJcbiAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XHJcbiAgICAgICAgaWYgKGlkeCA9PT0gLTEpIGlkeCA9IHRpbWVVSS50aWNrcy5sZW5ndGggLSAxO1xyXG4gICAgICAgIHNlZWtUbyhpZHgsIHsgd3JpdGU6IGZhbHNlIH0pO1xyXG4gICAgfSk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2hvd19sb2dvXCIsIHF1ZXVlU3luYyk7XHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6c2hvd19sZWdlbmRcIiwgcXVldWVTeW5jKTtcclxuICAgIGxpc3RlbihcImNoYW5nZTpsZWdlbmRfY29uZmlnXCIsIHF1ZXVlU3luYyk7XHJcbiAgICAvLyBMaXZlIHJlc2l6ZXMgKGEgU2hpbnkgbGF5b3V0LCBhIG5vdGVib29rIGNlbGwpOiBMZWFmbGV0IGNhY2hlcyBpdHMgYm94LCBzb1xyXG4gICAgLy8gaXQgbXVzdCBiZSB0b2xkIHRvIHJlLW1lYXN1cmUgb3IgdGlsZXMgcmVuZGVyIGZvciB0aGUgb2xkIHNpemUuXHJcbiAgICBsaXN0ZW4oXCJjaGFuZ2U6aGVpZ2h0XCIsICgpID0+IHtcclxuICAgICAgICBhcHBseUhlaWdodCgpO1xyXG4gICAgICAgIG1hcC5pbnZhbGlkYXRlU2l6ZSgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQW5ub3VuY2UgdGhpcyB2aWV3IHNvIFB5dGhvbiByZXBsaWVzIHdpdGggYSBmdWxsIHNuYXBzaG90LiBMYXllcnMgYWRkZWQgYmVmb3JlXHJcbiAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXHJcbiAgICAvLyB3aW5kb3cgd2hlcmUgbm90aGluZyB3YXMgbGlzdGVuaW5nLlxyXG4gICAgdHJ5IHtcclxuICAgICAgICBob3N0LnNlbmQoeyBraW5kOiBcInN3aWZ0bWFwX3JlYWR5XCIgfSk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGlzIGFsbCB0aGVyZSBpcyAqLyB9XHJcblxyXG4gICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcclxuICAgIGlmIChob3N0LmdldChcImF1dG9fc3luY1wiKSB8fCBob3N0LmdldChcInN5bmNfdHJpZ2dlclwiKSA+IDApIHtcclxuICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFRoZSBoYW5kbGUgYSBob3N0IGtlZXBzOiB0aGUgbGl2ZSBtYXAgYW5kIGEgdGVhcmRvd24gdGhhdCByZWxlYXNlcyB3aGF0IHRoZVxyXG4gICAgLy8gcGFnZSBjYW5ub3QgcmVjbGFpbSBvbiBpdHMgb3duIC0tIHBsYXliYWNrIHRpbWVycywgdGhlIHBlbmRpbmcgc3luYywgdGhlXHJcbiAgICAvLyBjb250YWluZXIncyByZXNpemUgb2JzZXJ2ZXIsIHRoZSBjb25zb2xlIGhvb2tzLCB0aGUgaG9zdCBzdWJzY3JpcHRpb25zLCBhbmRcclxuICAgIC8vIHRoZSBMZWFmbGV0IG1hcCB3aXRoIGV2ZXJ5IEdMIGNvbnRleHQgYW5kIGJsb2IgVVJMIGl0cyBsYXllcnMgaG9sZC5cclxuICAgIGZ1bmN0aW9uIGRlc3Ryb3koKSB7XHJcbiAgICAgICAgaWYgKGRlc3Ryb3llZCkgcmV0dXJuO1xyXG4gICAgICAgIGRlc3Ryb3llZCA9IHRydWU7XHJcbiAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgaWYgKHN5bmNUaW1lb3V0KSB7XHJcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XHJcbiAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGNvbnRhaW5lclJlc2l6ZSkgY29udGFpbmVyUmVzaXplLmRpc2Nvbm5lY3QoKTtcclxuICAgICAgICBpZiAodHlwZW9mIGhvc3Qub2ZmID09PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBbZXZlbnQsIGZuXSBvZiBzdWJzY3JpcHRpb25zKSBob3N0Lm9mZihldmVudCwgZm4pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmVycm9yID0gb3JpZ2luYWxFcnJvcjtcclxuICAgICAgICBjb25zb2xlLndhcm4gPSBvcmlnaW5hbFdhcm47XHJcbiAgICAgICAgaWYgKHdpbmRvdy5vbmVycm9yID09PSBvbldpbmRvd0Vycm9yKSB3aW5kb3cub25lcnJvciA9IG51bGw7XHJcbiAgICAgICAgLy8gZ2xpZnkga2VlcHMgZXZlcnkgaW5zdGFuY2UgaW4gYSBtb2R1bGUtbGV2ZWwgbGlzdDsgbWFwLnJlbW92ZSgpIGFsb25lXHJcbiAgICAgICAgLy8gd291bGQgbGVhdmUgZWFjaCBvbmUgLS0gYW5kIGl0cyBHTCBjb250ZXh0IC0tIHJlZ2lzdGVyZWQgdGhlcmUuIFRoZVxyXG4gICAgICAgIC8vIHN3ZWVwIG92ZXIgdGhvc2UgbGlzdHMgYWxzbyBjYXRjaGVzIGFuIGluc3RhbmNlIGEgc3luYyBidWlsdCBmb3IgdGhpc1xyXG4gICAgICAgIC8vIG1hcCBhbmQgaGFkIG5vdCB5ZXQgcmVjb3JkZWQgd2hlbiB0aGUgaG9zdCBkZXN0cm95ZWQgaXQuXHJcbiAgICAgICAgZm9yIChjb25zdCBzdGF0ZSBvZiBPYmplY3QudmFsdWVzKGdsU3RhdGVzKSkge1xyXG4gICAgICAgICAgICByZXRpcmVHbChzdGF0ZS5sYXllcik7XHJcbiAgICAgICAgICAgIHN0YXRlLmxheWVyID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgZ2xpZnkgPSBMLmdsaWZ5O1xyXG4gICAgICAgIGlmIChnbGlmeSkge1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxpc3Qgb2YgW2dsaWZ5LnBvaW50c0luc3RhbmNlcywgZ2xpZnkubGluZXNJbnN0YW5jZXMsIGdsaWZ5LnNoYXBlc0luc3RhbmNlc10pIHtcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgaW5zdGFuY2Ugb2YgWy4uLihsaXN0IHx8IFtdKV0pIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UubWFwID09PSBtYXApIHJldGlyZUdsKGluc3RhbmNlKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBtYXAucmVtb3ZlKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIGFscmVhZHkgdG9ybiBkb3duICovIH1cclxuICAgICAgICBpZiAoY29udGFpbmVyLnBhcmVudE5vZGUpIGNvbnRhaW5lci5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGNvbnRhaW5lcik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4geyBtYXAsIGNvbnRhaW5lciwgc3luYzogcGVyZm9ybVN5bmMsIGRlc3Ryb3kgfTtcclxufVxyXG4iLCAiLy8gVGhlIENETiBsb2FkZXIsIGZvciBob3N0cyB3aG9zZSBwYWdlIGhhcyBubyBidW5kbGVyOiB0aGUgYW55d2lkZ2V0IHdpZGdldCBhbmRcclxuLy8gYSBzdGF0aWMgZXhwb3J0LiBGZXRjaGVzIExlYWZsZXQsIGdsaWZ5IGFuZCBHZW9tYW4gZnJvbSB1bnBrZyAtLSBhIHJlY2VpdmluZ1xyXG4vLyBuZXR3b3JrJ3MgcGF0Y2hlciByZXdyaXRlcyB0aGVzZSBVUkxzIGxpa2UgYW55IG90aGVyIENETiByZWZlcmVuY2UgLS0gYW5kIHRoZW5cclxuLy8gcHJvdmlkZXMgdGhlIGdsb2JhbCB0aGV5IGluc3RhbGwuIEV2ZXJ5dGhpbmcgaXMgYXdhaXRlZCBiZWZvcmUgcmV0dXJuaW5nLCBzb1xyXG4vLyBHZW9tYW4gZXhpc3RzIGJlZm9yZSBhbnkgbWFwIGlzIGJ1aWx0LiBUaGUgVVJMIHRhYmxlIGlzIGEgcGFyYW1ldGVyIHNvIGFcclxuLy8gdmVuZG9yZWQgb3IgaW5saW5lZCB2YXJpYW50IGlzIGEgbWF0dGVyIG9mIHBhc3NpbmcgZGlmZmVyZW50IG9uZXMuXHJcbmltcG9ydCB7IGxvYWRDU1MsIGxvYWRKUyB9IGZyb20gXCIuL3V0aWxzLmpzXCI7XHJcbmltcG9ydCB7IHByb3ZpZGVMZWFmbGV0IH0gZnJvbSBcIi4vbGlicy5qc1wiO1xyXG5cclxuZXhwb3J0IGNvbnN0IExJQlJBUllfVVJMUyA9IHtcclxuICAgIGxlYWZsZXRDc3M6IFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuY3NzXCIsXHJcbiAgICBsZWFmbGV0SnM6IFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIixcclxuICAgIGdsaWZ5SnM6IFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldC5nbGlmeUAzLjMuMC9kaXN0L2dsaWZ5LWJyb3dzZXIuanNcIixcclxuICAgIGdlb21hbkNzczogXCJodHRwczovL3VucGtnLmNvbS9AZ2VvbWFuLWlvL2xlYWZsZXQtZ2VvbWFuLWZyZWVAMi4xOC4zL2Rpc3QvbGVhZmxldC1nZW9tYW4uY3NzXCIsXHJcbiAgICBnZW9tYW5KczogXCJodHRwczovL3VucGtnLmNvbS9AZ2VvbWFuLWlvL2xlYWZsZXQtZ2VvbWFuLWZyZWVAMi4xOC4zL2Rpc3QvbGVhZmxldC1nZW9tYW4ubWluLmpzXCIsXHJcbn07XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZExpYnJhcmllcyh1cmxzID0gTElCUkFSWV9VUkxTKSB7XHJcbiAgICBsb2FkQ1NTKFwibGVhZmxldC1jc3NcIiwgdXJscy5sZWFmbGV0Q3NzKTtcclxuICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtanNcIiwgdXJscy5sZWFmbGV0SnMpO1xyXG4gICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1nbGlmeVwiLCB1cmxzLmdsaWZ5SnMpO1xyXG4gICAgbG9hZENTUyhcImxlYWZsZXQtZ2VvbWFuLWNzc1wiLCB1cmxzLmdlb21hbkNzcyk7XHJcbiAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdlb21hblwiLCB1cmxzLmdlb21hbkpzKTtcclxuICAgIHJldHVybiBwcm92aWRlTGVhZmxldCh3aW5kb3cuTCk7XHJcbn1cclxuIiwgIi8qKlxyXG4gKiBUaGUgaG9zdCBpbnRlcmZhY2U6IHdoYXQgYSBzd2lmdG1hcCBjb3JlIGluc3RhbmNlIG5lZWRzIGZyb20gd2hhdGV2ZXIgZW1iZWRzIGl0LlxyXG4gKlxyXG4gKiBGaXZlIG1ldGhvZHMsIGFscmVhZHkgcHJvdmVuIGJ5IGV2ZXJ5IHN0YXRpYyBleHBvcnQsIHdoaWNoIHJ1bnMgdGhlIHJlYWwgYnVuZGxlXHJcbiAqIGFnYWluc3QgZXhhY3RseSB0aGlzIHN1cmZhY2Ugd2l0aCBubyBQeXRob24gYmVoaW5kIGl0OlxyXG4gKlxyXG4gKiAgIGdldChrZXkpICAgICAgICAgICAgICAtPiB0aGUgY3VycmVudCB2YWx1ZSBvZiBhIHN0YXRlIGtleVxyXG4gKiAgIHNldChrZXksIHZhbHVlKSAgICAgICAtPiBzdG9yZSBpdCBhbmQgZmlyZSB0aGUgYGNoYW5nZTo8a2V5PmAgbGlzdGVuZXJzXHJcbiAqICAgb24oZXZlbnQsIGZuKSAgICAgICAgIC0+IHN1YnNjcmliZTsgYGNoYW5nZTo8a2V5PmAsIGFuZCBgbXNnOmN1c3RvbWAgZm9yIHBhdGNoZXNcclxuICogICBzZW5kKGNvbnRlbnQsIGJ1ZmZlcnMpLT4gYSBtZXNzYWdlIHRvIHRoZSBvdGhlciBzaWRlIChtYXkgZ28gbm93aGVyZSlcclxuICogICBzYXZlX2NoYW5nZXMoKSAgICAgICAgLT4gZmx1c2ggcGVuZGluZyB3cml0ZXMgKG1heSBiZSBhIG5vLW9wKVxyXG4gKlxyXG4gKiBPcHRpb25hbDogb2ZmKGV2ZW50LCBmbiksIGhvbm91cmVkIGJ5IGRlc3Ryb3koKSB3aGVuIHByZXNlbnQuXHJcbiAqXHJcbiAqIFRoZSBjb3JlIHJlYWRzIHRoZXNlIGtleXMgdGhyb3VnaCBnZXQoKTogbGF5ZXJzLCBjb29yZGluYXRlX2J1ZmZlcnMsIGdyb3VwX2NvbmZpZ3MsXHJcbiAqIGNlbnRlciwgem9vbSwgY3JzLCBoZWlnaHQsIGF1dG9fc3luYywgc3luY190cmlnZ2VyLCBzaG93X2xvZ28sIGxvZ29fY29uZmlnLFxyXG4gKiBzaG93X2xlZ2VuZCwgbGVnZW5kX2NvbmZpZywgc2hvd19zY2FsZSwgc2NhbGVfY29uZmlnLCBzaG93X2RyYXcsIGRyYXdfY29uZmlnLFxyXG4gKiBkcmF3aW5ncywgZHJhd19zZXEsIHNob3dfY2xpY2tfY29vcmRpbmF0ZXMsIHRpbWVfY29uZmlnLCB0aW1lX2N1cnJlbnQsXHJcbiAqIGZpdF9ib3VuZHNfcmVxdWVzdCwganNfY29uc29sZV9sb2dzLiBJdCB3cml0ZXMgYmFjayB0aHJvdWdoIHNldCgpOiBjZW50ZXIsIHpvb20sXHJcbiAqIGNsaWNrZWRfbGF5ZXJfaWQsIHNlbGVjdGVkX2luZGV4LCBjbGlja2VkX2xhdGxuZywgY2xpY2tfc2VxLCBkcmF3aW5ncywgZHJhd19zZXEsXHJcbiAqIHRpbWVfY3VycmVudCwgdGltZV9jb25maWcsIGdyb3VwX2NvbmZpZ3MsIGpzX2NvbnNvbGVfbG9ncy4gU2lkZWJhciB0b2dnbGVzIGdvIG91dFxyXG4gKiB0aHJvdWdoIHNlbmQoKSBhcyB7a2luZDogXCJzd2lmdG1hcF93cml0ZVwiLCBvcHN9OyB0aGUgd2lkZ2V0IGFubm91bmNlcyBpdHNlbGYgd2l0aFxyXG4gKiB7a2luZDogXCJzd2lmdG1hcF9yZWFkeVwifS4gSW5jcmVtZW50YWwgdXBkYXRlcyBhcnJpdmUgb24gdGhlIGBtc2c6Y3VzdG9tYCBldmVudCBhc1xyXG4gKiAoe2tpbmQ6IFwic3dpZnRtYXBfcGF0Y2hcIiwgb3BzfSwgYnVmZmVycykuXHJcbiAqXHJcbiAqIGFueXdpZGdldCdzIG1vZGVsIHNhdGlzZmllcyB0aGlzIGFzLWlzOyB0aGUgc3R1YiBiZWxvdyBpcyB0aGUgcmVmZXJlbmNlIGhvc3QgZm9yXHJcbiAqIGV4cG9ydHMsIHRlc3RzLCBhbmQgYW55IGVtYmVkZGluZyB3aXRoIG5vIGtlcm5lbCBiZWhpbmQgaXQuXHJcbiAqL1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhvc3RTdHViKGluaXRpYWwgPSB7fSwgaG9va3MgPSB7fSkge1xyXG4gICAgY29uc3Qgc3RhdGUgPSB7IC4uLmluaXRpYWwgfTtcclxuICAgIGNvbnN0IGxpc3RlbmVycyA9IHt9O1xyXG4gICAgY29uc3QgaG9zdCA9IHtcclxuICAgICAgICBjb21tOiBob29rcy5jb21tID09PSB1bmRlZmluZWQgPyBudWxsIDogaG9va3MuY29tbSxcclxuICAgICAgICBzdGF0ZSxcclxuICAgICAgICBzZXRzOiBbXSwgICAgICAvLyBldmVyeSBzZXQoKSwgaW4gb3JkZXIsIGZvciBhc3NlcnRpb25zXHJcbiAgICAgICAgc2VudDogW10sICAgICAgLy8gZXZlcnkgc2VuZCgpXHJcbiAgICAgICAgc2F2ZXM6IDAsXHJcbiAgICAgICAgZ2V0OiBrZXkgPT4gc3RhdGVba2V5XSxcclxuICAgICAgICBzZXQoa2V5LCB2YWx1ZSkge1xyXG4gICAgICAgICAgICBzdGF0ZVtrZXldID0gdmFsdWU7XHJcbiAgICAgICAgICAgIGhvc3Quc2V0cy5wdXNoKFtrZXksIHZhbHVlXSk7XHJcbiAgICAgICAgICAgIChsaXN0ZW5lcnNbYGNoYW5nZToke2tleX1gXSB8fCBbXSkuZm9yRWFjaChmbiA9PiBmbigpKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uKGV2ZW50LCBmbikge1xyXG4gICAgICAgICAgICAobGlzdGVuZXJzW2V2ZW50XSA9IGxpc3RlbmVyc1tldmVudF0gfHwgW10pLnB1c2goZm4pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb2ZmKGV2ZW50LCBmbikge1xyXG4gICAgICAgICAgICBsaXN0ZW5lcnNbZXZlbnRdID0gKGxpc3RlbmVyc1tldmVudF0gfHwgW10pLmZpbHRlcihmID0+IGYgIT09IGZuKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNlbmQoY29udGVudCwgYnVmZmVycykge1xyXG4gICAgICAgICAgICBob3N0LnNlbnQucHVzaCh7IGNvbnRlbnQsIGJ1ZmZlcnMgfSk7XHJcbiAgICAgICAgICAgIGlmIChob29rcy5vblNlbmQpIGhvb2tzLm9uU2VuZChjb250ZW50LCBidWZmZXJzKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNhdmVfY2hhbmdlcygpIHtcclxuICAgICAgICAgICAgaG9zdC5zYXZlcyArPSAxO1xyXG4gICAgICAgICAgICBpZiAoaG9va3Mub25TYXZlKSBob29rcy5vblNhdmUoKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIEZpcmVzIGxpc3RlbmVycyBkaXJlY3RseTogaG93IGEgdGVzdCBvciBhbiBleHBvcnQgcHVzaGVzIGEgcmVhbFxyXG4gICAgICAgIC8vIHN3aWZ0bWFwX3BhdGNoIHRocm91Z2ggYG1zZzpjdXN0b21gLCBleGFjdGx5IGFzIGEga2VybmVsIHdvdWxkLlxyXG4gICAgICAgIGVtaXQoZXZlbnQsIC4uLmFyZ3MpIHtcclxuICAgICAgICAgICAgKGxpc3RlbmVyc1tldmVudF0gfHwgW10pLmZvckVhY2goZm4gPT4gZm4oLi4uYXJncykpO1xyXG4gICAgICAgIH0sXHJcbiAgICB9O1xyXG4gICAgcmV0dXJuIGhvc3Q7XHJcbn1cclxuIiwgIi8vIFRoZSBiYXNlNjQgYnVmZmVyIHRyYW5zcG9ydDogaG93IGEgSlNPTi1vbmx5IGNoYW5uZWwgY2FycmllcyBiaW5hcnkuXG4vL1xuLy8gVGhlIHN0YXRpYyBleHBvcnQgYmFrZXMgZXZlcnkgY29vcmRpbmF0ZS90aW1lL3N0eWxlIGJ1ZmZlciBpbnRvIGl0cyBIVE1MIGFzXG4vLyBiYXNlNjQsIGFuZCB0aGUgU3RyZWFtbGl0IGNvbXBvbmVudCByZWNlaXZlcyB0aGVtIHRoZSBzYW1lIHdheSAtLSBjb21wb25lbnRcbi8vIGFyZ3MgYXJlIEpTT04gdGhyb3VnaCBhbiBpZnJhbWU7IHRoZXJlIGlzIG5vIEFycmF5QnVmZmVyIGNoYW5uZWwuIFB5dGhvblxuLy8gZW5jb2RlcyB3aXRoIHN3aWZ0bWFwLmV4cG9ydC5lbmNvZGVfYnVmZmVyczsgdGhpcyBpcyB0aGUgb25lIGRlY29kZXIgYm90aFxuLy8gY29uc3VtZXJzIHVzZSwgc28gdGhlIGVuY29kaW5nIGNhbm5vdCBkcmlmdCBiZXR3ZWVuIHN0YWNrcy5cbmV4cG9ydCBmdW5jdGlvbiBkZWNvZGVCYXNlNjRCdWZmZXJzKGVuY29kZWQpIHtcbiAgICBjb25zdCBvdXQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIGI2NF0gb2YgT2JqZWN0LmVudHJpZXMoZW5jb2RlZCB8fCB7fSkpIHtcbiAgICAgICAgY29uc3QgYmluID0gYXRvYihiNjQpO1xuICAgICAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbi5sZW5ndGgpO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbi5sZW5ndGg7IGkrKykgYnl0ZXNbaV0gPSBiaW4uY2hhckNvZGVBdChpKTtcbiAgICAgICAgb3V0W2tleV0gPSBuZXcgRGF0YVZpZXcoYnl0ZXMuYnVmZmVyKTtcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gRGVjb2RlcyBhIG5ldyBzZXQgb2YgZW5jb2RlZCBidWZmZXJzLCBrZWVwaW5nIHRoZSBwcmV2aW91c2x5IGRlY29kZWQgdmlldyBmb3Jcbi8vIGV2ZXJ5IGtleSB3aG9zZSBiYXNlNjQgaXMgYnl0ZS1pZGVudGljYWwuIEJ1ZmZlciBpZGVudGl0eSBpcyBwYXJ0IG9mIHRoZSBHTFxuLy8gbWV0YSBrZXksIHNvIGEgbGF5ZXIgd2hvc2UgZGF0YSBkaWQgbm90IGNoYW5nZSBrZWVwcyBpdHMgR1BVIGJ1ZmZlcnMgYWNyb3NzIGFcbi8vIGZ1bGwtc3RhdGUgcmUtc2VuZCAtLSB0aGUgdjEgdHJhbnNwb3J0J3Mgb25lIGNoZWFwIHRyaWNrLlxuZXhwb3J0IGZ1bmN0aW9uIGRlY29kZUJhc2U2NEJ1ZmZlcnNSZXVzaW5nKGVuY29kZWQsIHByZXZpb3VzRW5jb2RlZCwgcHJldmlvdXNEZWNvZGVkKSB7XG4gICAgY29uc3Qgb3V0ID0ge307XG4gICAgY29uc3QgZnJlc2ggPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIGI2NF0gb2YgT2JqZWN0LmVudHJpZXMoZW5jb2RlZCB8fCB7fSkpIHtcbiAgICAgICAgaWYgKHByZXZpb3VzRW5jb2RlZCAmJiBwcmV2aW91c0RlY29kZWQgJiYgcHJldmlvdXNFbmNvZGVkW2tleV0gPT09IGI2NCAmJiBwcmV2aW91c0RlY29kZWRba2V5XSkge1xuICAgICAgICAgICAgb3V0W2tleV0gPSBwcmV2aW91c0RlY29kZWRba2V5XTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZyZXNoW2tleV0gPSBiNjQ7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24ob3V0LCBkZWNvZGVCYXNlNjRCdWZmZXJzKGZyZXNoKSk7XG59XG4iLCAiLy8gVGhlIGFueXdpZGdldCBhZGFwdGVyOiBvbmUgaG9zdCBvdmVyIHRoZSBzd2lmdG1hcCBjb3JlLlxyXG4vL1xyXG4vLyBhbnl3aWRnZXQncyBtb2RlbCBhbHJlYWR5IElTIGEgaG9zdCAtLSBnZXQvc2V0L29uL3NlbmQvc2F2ZV9jaGFuZ2VzLCB3aXRoXHJcbi8vIGBjaGFuZ2U6PGtleT5gIGFuZCBgbXNnOmN1c3RvbWAgZXZlbnRzIC0tIHNvIG5vdGhpbmcgaXMgdHJhbnNsYXRlZCBoZXJlLiBUaGVcclxuLy8gY2xlYW51cCByZXR1cm5lZCB0ZWFycyB0aGUgbWFwIGRvd24gd2hlbiBhbnl3aWRnZXQgZGlzY2FyZHMgdGhlIHZpZXcuXHJcbmltcG9ydCB7IGNyZWF0ZVN3aWZ0TWFwIH0gZnJvbSBcIi4vY29yZS5qc1wiO1xyXG5pbXBvcnQgeyBsb2FkTGlicmFyaWVzIH0gZnJvbSBcIi4vbG9hZGVyLmpzXCI7XHJcblxyXG5leHBvcnQgeyBjcmVhdGVIb3N0U3R1YiB9IGZyb20gXCIuL2hvc3QuanNcIjtcclxuLy8gVGhlIHN0YXRpYyBleHBvcnQgZGVjb2RlcyBpdHMgYmFzZTY0IGJ1ZmZlcnMgd2l0aCB0aGlzIChzZWUgc3dpZnRtYXAvZXhwb3J0LnB5KS5cclxuZXhwb3J0IHsgZGVjb2RlQmFzZTY0QnVmZmVycyB9IGZyb20gXCIuL3RyYW5zcG9ydC5qc1wiO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQge1xyXG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcclxuICAgICAgICAvLyBUaGlzIGhvc3QncyBwYWdlIGhhcyBubyBidW5kbGVyOiBMZWFmbGV0LCBnbGlmeSBhbmQgR2VvbWFuIGNvbWUgZnJvbVxyXG4gICAgICAgIC8vIHRoZSBDRE4sIGZ1bGx5IGxvYWRlZCBiZWZvcmUgdGhlIG1hcCBpcyBjb25zdHJ1Y3RlZC5cclxuICAgICAgICBjb25zdCBsZWFmbGV0ID0gYXdhaXQgbG9hZExpYnJhcmllcygpO1xyXG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IGF3YWl0IGNyZWF0ZVN3aWZ0TWFwKHsgaG9zdDogbW9kZWwsIGVsLCBsZWFmbGV0IH0pO1xyXG4gICAgICAgIHJldHVybiAoKSA9PiBoYW5kbGUuZGVzdHJveSgpO1xyXG4gICAgfSxcclxufTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQVdPLElBQUksSUFBSTtBQUVSLFNBQVMsZUFBZSxTQUFTO0FBQ3BDLE1BQUksQ0FBQyxXQUFXLE9BQU8sUUFBUSxRQUFRLFlBQVk7QUFDL0MsVUFBTSxJQUFJLE1BQU0sNERBQTREO0FBQUEsRUFDaEY7QUFDQSxNQUFJLENBQUMsUUFBUSxPQUFPO0FBQ2hCLFlBQVEsS0FBSyxzSEFDdUQ7QUFBQSxFQUN4RTtBQUNBLE1BQUksQ0FBQyxRQUFRLElBQUk7QUFDYixZQUFRLEtBQUssbUdBQ2dDO0FBQUEsRUFDakQ7QUFDQSxNQUFJO0FBQ0osU0FBTztBQUNYO0FBRU8sU0FBUyxpQkFBaUI7QUFDN0IsTUFBSSxDQUFDLEdBQUc7QUFDSixVQUFNLElBQUksTUFBTSxrSkFFbUI7QUFBQSxFQUN2QztBQUNBLFNBQU87QUFDWDs7O0FDM0JBLElBQU0sY0FBYyxvQkFBSSxJQUFJO0FBQUEsRUFDeEI7QUFBQSxFQUFXO0FBQUEsRUFBa0I7QUFBQSxF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QVcsQ0FBQyxDQUFDLEdBQUc7QUFDcEQsVUFBTSxNQUFNLEtBQUssR0FBRztBQUNwQixVQUFNLFFBQVEsSUFBSSxXQUFXLElBQUksTUFBTTtBQUN2QyxhQUFTLElBQUksR0FBRyxJQUFJLElBQUksUUFBUSxJQUFLLE9BQU0sQ0FBQyxJQUFJLElBQUksV0FBVyxDQUFDO0FBQ2hFLFFBQUksR0FBRyxJQUFJLElBQUksU0FBUyxNQUFNLE1BQU07QUFBQSxFQUN4QztBQUNBLFNBQU87QUFDWDs7O0FDSkEsSUFBTyxvQkFBUTtBQUFBLEVBQ1gsTUFBTSxPQUFPLEVBQUUsT0FBTyxHQUFHLEdBQUc7QUFHeEIsVUFBTSxVQUFVLE1BQU0sY0FBYztBQUNwQyxVQUFNLFNBQVMsTUFBTSxlQUFlLEVBQUUsTUFBTSxPQUFPLElBQUksUUFBUSxDQUFDO0FBQ2hFLFdBQU8sTUFBTSxPQUFPLFFBQVE7QUFBQSxFQUNoQztBQUNKOyIsCiAgIm5hbWVzIjogWyJ0aW1lcyIsICJjb2xsYXBzZWRCeUNvbnRhaW5lciIsICJjb3VudCIsICJnbExheWVyIiwgImluc3RhbmNlIiwgIkwiLCAiY29udGFpbmVyIiwgInpvb20iXQp9Cg==
