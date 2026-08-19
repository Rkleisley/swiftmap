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
var collapsedByContainer = /* @__PURE__ */ new WeakMap();
function renderLegend(container, spec, options = {}) {
  container.innerHTML = "";
  const dimHidden = options.dimHidden !== false;
  let collapsed = collapsedByContainer.get(container);
  if (!collapsed) {
    collapsed = /* @__PURE__ */ new Set();
    collapsedByContainer.set(container, collapsed);
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
      const segs = nVerts - 1;
      const seg = new Float64Array(segs * 2);
      for (let k = 0; k < segs; k++) {
        const s = times[k * 2];
        const e = times[(k + 1) * 2 + 1];
        if (Number.isNaN(s) || Number.isNaN(e)) {
          seg[k * 2] = -ALWAYS;
          seg[k * 2 + 1] = ALWAYS;
        } else {
          seg[k * 2] = (s - base) / 1e3;
          seg[k * 2 + 1] = (e - base) / 1e3;
        }
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
      const style = styleFor(layer, 0);
      const rgb = parseColor(style.color, "#3388ff");
      if (layer.type === "polygon" || layer.type === "circle") {
        let count = 0;
        if ((style.weight ?? 3) > 0 && (style.opacity ?? 1) > 0) {
          for (const rings of areaParts(layer, coordinateBuffers)) {
            for (const ring of rings) {
              count += Math.max(0, 2 * (ring.length - 1));
              features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: ring },
                properties: {
                  layer,
                  colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: style.opacity || 1 },
                  weight: style.weight || 3
                }
              });
            }
          }
        }
        vertexCounts.push(count);
        continue;
      }
      const locs = vectorCoords(layer, coordinateBuffers) || [];
      const geojsonCoords = locs.map((c) => [c[1], c[0]]);
      vertexCounts.push(Math.max(0, 2 * (geojsonCoords.length - 1)));
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
                  model.set(
                    "clicked_latlng",
                    [
                      Math.round(e.latlng.wrap().lat * 1e5) / 1e5,
                      Math.round(e.latlng.wrap().lng * 1e5) / 1e5
                    ]
                  );
                  model.set("click_seq", (model.get("click_seq") || 0) + 1);
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
                  model.set(
                    "clicked_latlng",
                    [
                      Math.round(e.latlng.wrap().lat * 1e5) / 1e5,
                      Math.round(e.latlng.wrap().lng * 1e5) / 1e5
                    ]
                  );
                  model.set("click_seq", (model.get("click_seq") || 0) + 1);
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
                model.set("clicked_latlng", [point[0], point[1]]);
                model.set("click_seq", (model.get("click_seq") || 0) + 1);
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
        const locs = vectorCoords(layer, buffers || {}) || [];
        if (locs.length === 0) continue;
        const mid = locs[Math.floor((locs.length - 1) / 2)];
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
      const h = model.get("height");
      container.style.height = h || "100%";
      container.style.minHeight = h ? "0" : "";
    }
    applyHeight();
    let labelsGroup = null;
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
    labelsGroup = L.layerGroup().addTo(map);
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
      renderSidebarControls(sidebar, layers, model, map, () => {
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
      const legendCfg = model.get("legend_config") || {};
      if (model.get("show_legend")) {
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
        model.set("drawings", features);
        model.set("draw_seq", (model.get("draw_seq") || 0) + 1);
        model.save_changes();
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
      for (const feature of model.get("drawings") || []) {
        const props = feature.properties || {};
        let layer;
        if (props.kind === "circle" && feature.geometry.type === "Point") {
          const [lng, lat] = feature.geometry.coordinates;
          layer = L.circle([lat, lng], { radius: props.radius || 100 });
        } else {
          layer = L.geoJSON(feature).getLayers()[0];
        }
        if (!layer) continue;
        layer._swiftmapDrawId = props.draw_id || `draw_${++drawIdCounter}`;
        adoptDrawing(layer);
      }
    }
    function syncDraw() {
      const show = model.get("show_draw");
      const cfg = model.get("draw_config") || {};
      if (show && !drawReady) {
        drawReady = true;
        drawingsGroup = L.featureGroup().addTo(map);
        rehydrateDrawings();
        map.on("pm:create", (e) => {
          adoptDrawing(e.layer);
          writeDrawings();
        });
        map.on("pm:remove", () => writeDrawings());
        model.on("change:drawings", () => {
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
    model.on("change:show_draw", syncDraw);
    model.on("change:draw_config", syncDraw);
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
      if (!model.get("show_scale")) return;
      const cfg = model.get("scale_config") || {};
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
    model.on("change:show_scale", syncScale);
    model.on("change:scale_config", syncScale);
    map.on("click", (e) => {
      registerClickMatch(map, 99, () => {
        const ll = e.latlng.wrap();
        const lat = Math.round(ll.lat * 1e5) / 1e5;
        const lng = Math.round(ll.lng * 1e5) / 1e5;
        try {
          model.set("clicked_layer_id", "");
          model.set("selected_index", -1);
          model.set("clicked_latlng", [lat, lng]);
          model.set("click_seq", (model.get("click_seq") || 0) + 1);
          model.save_changes();
        } catch (err) {
        }
        if (model.get("show_click_coordinates")) {
          L.popup({ className: "swiftmap-coords-popup", closeButton: false }).setLatLng(e.latlng).setContent(`${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`).openOn(map);
        }
      });
    });
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
    function applyFitRequest() {
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
    }
    model.on("change:fit_bounds_request", applyFitRequest);
    map.whenReady(() => applyFitRequest());
    if (typeof ResizeObserver !== "undefined") {
      let hadSize = container.clientWidth > 0 && container.clientHeight > 0;
      const containerResize = new ResizeObserver(() => {
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
    model.on("change:show_legend", queueSync);
    model.on("change:legend_config", queueSync);
    model.on("change:height", () => {
      applyHeight();
      map.invalidateSize();
    });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3NoYWRlcnMuanMiLCAiLi4vLi4vc3JjL3RpbWVjb250cm9sLmpzIiwgIi4uLy4uL3NyYy9ncHV0aW1lLmpzIiwgIi4uLy4uL3NyYy9sYXllcnMuanMiLCAiLi4vLi4vc3JjL2xhYmVscy5qcyIsICIuLi8uLi9zcmMvbWFwLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgZnVuY3Rpb24gbG9hZENTUyhpZCwgdXJsKSB7XG4gICAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgY29uc3QgbGluayA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJsaW5rXCIpO1xuICAgICAgICBsaW5rLmlkID0gaWQ7XG4gICAgICAgIGxpbmsucmVsID0gXCJzdHlsZXNoZWV0XCI7XG4gICAgICAgIGxpbmsuaHJlZiA9IHVybDtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChsaW5rKTtcbiAgICB9XG59XG5cbmNvbnN0IGFjdGl2ZUxvYWRlcnMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKUyhpZCwgdXJsKSB7XG4gICAgaWYgKGFjdGl2ZUxvYWRlcnNbaWRdKSB7XG4gICAgICAgIHJldHVybiBhY3RpdmVMb2FkZXJzW2lkXTtcbiAgICB9XG4gICAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgaWYgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzY3JpcHRcIik7XG4gICAgICAgIHNjcmlwdC5pZCA9IGlkO1xuICAgICAgICBzY3JpcHQuc3JjID0gdXJsO1xuICAgICAgICBzY3JpcHQub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xuICAgICAgICBzY3JpcHQub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIHNjcmlwdDogJHt1cmx9YCkpO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHNjcmlwdCk7XG4gICAgfSk7XG4gICAgYWN0aXZlTG9hZGVyc1tpZF0gPSBwcm9taXNlO1xuICAgIHJldHVybiBwcm9taXNlO1xufVxuXG5mdW5jdGlvbiBoZXhUb1JnYihoZXgpIHtcbiAgICBpZiAoIWhleCkgcmV0dXJuIG51bGw7XG4gICAgaGV4ID0gaGV4LnJlcGxhY2UoL14jLywgJycpO1xuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XG4gICAgICAgIGhleCA9IGhleC5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhciArIGNoYXIpLmpvaW4oJycpO1xuICAgIH1cbiAgICBpZiAoaGV4Lmxlbmd0aCAhPT0gNikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbnVtID0gcGFyc2VJbnQoaGV4LCAxNik7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcjogKChudW0gPj4gMTYpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgZzogKChudW0gPj4gOCkgJiAyNTUpIC8gMjU1LFxuICAgICAgICBiOiAobnVtICYgMjU1KSAvIDI1NVxuICAgIH07XG59XG5cbmxldCBjb2xvclByb2JlID0gbnVsbDtcblxuLy8gQnJvd3NlcnMgc2hpcCBhIGNvbXBsZXRlIENTUyBjb2xvciBwYXJzZXIgLS0gZXZlcnkgbmFtZWQgY29sb3IsIHJnYigpLCBoc2woKSwgaHdiKCkuXG4vLyBCb3Jyb3cgaXQgaW5zdGVhZCBvZiBtYWludGFpbmluZyBhIGxvb2t1cCB0YWJsZS4gUmV0dXJucyBudWxsIG91dHNpZGUgYSBET00gKE5vZGUgdGVzdHMpLFxuLy8gd2hlcmUgdGhlIGhleCBmYWxsYmFjayBpbiBwYXJzZUNvbG9yIHN0aWxsIGFwcGxpZXMuXG5mdW5jdGlvbiBjc3NDb2xvclRvUmdiKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFjb2xvclByb2JlKSBjb2xvclByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKS5nZXRDb250ZXh0KFwiMmRcIik7XG5cbiAgICAvLyBBc3NpZ25pbmcgYW4gaW52YWxpZCBjb2xvciBsZWF2ZXMgZmlsbFN0eWxlIHVudG91Y2hlZCwgc28gcHJvYmUgYWdhaW5zdCB0d28gZGlmZmVyZW50XG4gICAgLy8gc2VudGluZWxzOiBvbmx5IGEgdmFsdWUgdGhlIGJyb3dzZXIgYWN0dWFsbHkgcGFyc2VkIHByb2R1Y2VzIHRoZSBzYW1lIHJlc3VsdCB0d2ljZS5cbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiIzAwMDAwMFwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgY29uc3QgZmlyc3QgPSBjb2xvclByb2JlLmZpbGxTdHlsZTtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiI2ZmZmZmZlwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgaWYgKGZpcnN0ICE9PSBjb2xvclByb2JlLmZpbGxTdHlsZSkgcmV0dXJuIG51bGw7XG5cbiAgICBpZiAoZmlyc3Quc3RhcnRzV2l0aChcIiNcIikpIHJldHVybiBoZXhUb1JnYihmaXJzdCk7XG4gICAgY29uc3QgbWF0Y2ggPSBmaXJzdC5tYXRjaCgvcmdiYT9cXCgoW14pXSspXFwpLyk7XG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcGFydHMgPSBtYXRjaFsxXS5zcGxpdChcIixcIikubWFwKHAgPT4gcGFyc2VGbG9hdChwLnRyaW0oKSkpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzIHx8IHBhcnRzLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsgcjogcGFydHNbMF0gLyAyNTUsIGc6IHBhcnRzWzFdIC8gMjU1LCBiOiBwYXJ0c1syXSAvIDI1NSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb2xvcihjb2xvclN0ciwgZmFsbGJhY2tIZXggPSBcIiMzMzg4ZmZcIikge1xuICAgIGlmICghY29sb3JTdHIpIGNvbG9yU3RyID0gZmFsbGJhY2tIZXg7XG4gICAgcmV0dXJuIGNzc0NvbG9yVG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGhleFRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBjc3NDb2xvclRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCBoZXhUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG59XG5cbmNvbnN0IFVSTF9BVFRSX0JFRk9SRSA9IC8oPzpocmVmfHNyYylcXHMqPVxccypbJ1wiXT8kL2k7XG5jb25zdCBTQUZFX1VSTCA9IC9eKD86aHR0cHM/OlxcL1xcL3xtYWlsdG86fHRlbDp8ZGF0YTppbWFnZVxcL3xbLi8jP118W1xcdy4tXSsoPzpbLz8jXXwkKSkvaTtcblxuLy8gUHJvcGVydHkgdmFsdWVzIGNvbWUgZnJvbSB1c2VyIGRhdGEgYW5kIGVuZCB1cCBpbiBpbm5lckhUTUwsIHNvIHRoZXkgYXJlIGVzY2FwZWQuXG4vLyBNYXJrdXAgdGhlIGFwcCBhdXRob3Igd3JvdGUgKHRlbXBsYXRlcywgc3R5bGUgc3RyaW5ncykgaXMgbGVmdCBpbnRhY3QuXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpXG4gICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcbn1cblxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXG4vLyBpbiBhIFVSTCBhdHRyaWJ1dGUgZ2V0IGEgc2NoZW1lIGNoZWNrLiBDb250cm9sIGNoYXJhY3RlcnMgYXJlIHN0cmlwcGVkIGZpcnN0IGJlY2F1c2Vcbi8vIFwiamF2YVxcdHNjcmlwdDpcIiBzdXJ2aXZlcyBhIG5haXZlIGNvbXBhcmlzb24uXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZSkge1xuICAgIGNvbnN0IGNvbGxhcHNlZCA9IFN0cmluZyh2YWx1ZSkuc3BsaXQoXCJcIikuZmlsdGVyKGMgPT4gYy5jaGFyQ29kZUF0KDApID4gMzIpLmpvaW4oXCJcIik7XG4gICAgcmV0dXJuIFNBRkVfVVJMLnRlc3QoY29sbGFwc2VkKSA/IFN0cmluZyh2YWx1ZSkgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICBjb25zdCB0YXJnZXRGaWVsZHMgPSAoQXJyYXkuaXNBcnJheShmaWVsZHMpICYmIGZpZWxkcy5sZW5ndGgpID8gZmllbGRzIDogT2JqZWN0LmtleXMocHJvcHMpO1xuICAgIGNvbnN0IGxhYmVscyA9IChBcnJheS5pc0FycmF5KG5hbWVzKSAmJiBuYW1lcy5sZW5ndGggPT09IHRhcmdldEZpZWxkcy5sZW5ndGgpID8gbmFtZXMgOiB0YXJnZXRGaWVsZHM7XG4gICAgY29uc3QgbGluZXMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldEZpZWxkcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBmID0gdGFyZ2V0RmllbGRzW2ldO1xuICAgICAgICBpZiAocHJvcHNbZl0gPT09IHVuZGVmaW5lZCB8fCBwcm9wc1tmXSA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGxpbmVzLnB1c2goYDxiPiR7ZXNjYXBlSHRtbChsYWJlbHNbaV0pfTwvYj46ICR7ZXNjYXBlSHRtbChwcm9wc1tmXSl9YCk7XG4gICAgfVxuICAgIHJldHVybiBsaW5lcy5qb2luKFwiPGJyPlwiKTtcbn1cblxuLy8gXCJ7Y29sdW1ufVwiIGluc2VydHMgb25lIGVzY2FwZWQgdmFsdWU7IFwieyp9XCIgaW5zZXJ0cyB0aGUgZGVmYXVsdCBmaWVsZCBsaXN0LlxuZnVuY3Rpb24gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlLnJlcGxhY2UoL1xceyhcXCp8XFx3KylcXH0vZywgKG1hdGNoLCBrZXksIG9mZnNldCkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcIipcIikge1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2YWwgPSBwcm9wc1trZXldO1xuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgICAgICAgY29uc3QgcHJlY2VkaW5nID0gdGVtcGxhdGUuc2xpY2UoTWF0aC5tYXgoMCwgb2Zmc2V0IC0gMTYpLCBvZmZzZXQpO1xuICAgICAgICByZXR1cm4gZXNjYXBlSHRtbChVUkxfQVRUUl9CRUZPUkUudGVzdChwcmVjZWRpbmcpID8gc2FmZVVybCh2YWwpIDogdmFsKTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBraW5kKSB7XG4gICAgY29uc3QgdGVtcGxhdGUgPSBsYXllcltraW5kICsgXCJfdGVtcGxhdGVcIl07XG4gICAgY29uc3QgZmllbGRzID0gbGF5ZXJba2luZCArIFwiX2ZpZWxkc1wiXTtcbiAgICBjb25zdCBuYW1lcyA9IGxheWVyW2tpbmQgKyBcIl9uYW1lc1wiXTtcbiAgICBpZiAodHlwZW9mIHRlbXBsYXRlID09PSBcInN0cmluZ1wiICYmIHRlbXBsYXRlKSB7XG4gICAgICAgIHJldHVybiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgIH1cbiAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xufVxuXG5mdW5jdGlvbiB3cmFwU3R5bGVkKGh0bWwsIHN0eWxlKSB7XG4gICAgaWYgKCFzdHlsZSkgcmV0dXJuIGh0bWw7XG4gICAgcmV0dXJuIGA8ZGl2IHN0eWxlPVwiJHtlc2NhcGVIdG1sKHN0eWxlKX1cIj4ke2h0bWx9PC9kaXY+YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQb3B1cChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInBvcHVwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF9wb3B1cCB8fCBsYXllci5wb3B1cF9maWVsZHMgfHwgbGF5ZXIucG9wdXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgaWYgKGxheWVyLnBvcHVwX21heF93aWR0aCkgb3B0aW9ucy5tYXhXaWR0aCA9IGxheWVyLnBvcHVwX21heF93aWR0aDtcbiAgICAgICAgTC5wb3B1cChvcHRpb25zKVxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnBvcHVwX3N0eWxlKSlcbiAgICAgICAgICAgIC5vcGVuT24obWFwKTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kVG9vbHRpcChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyLCBsYXllckluc3RhbmNlKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInRvb2x0aXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3Rvb2x0aXAgfHwgbGF5ZXIudG9vbHRpcF9maWVsZHMgfHwgbGF5ZXIudG9vbHRpcF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgaWYgKCFsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwID0gTC50b29sdGlwKHsgZGlyZWN0aW9uOiAndG9wJywgb2Zmc2V0OiBbMCwgLTVdIH0pO1xuICAgICAgICB9XG4gICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXBcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci50b29sdGlwX3N0eWxlKSlcbiAgICAgICAgICAgIC5hZGRUbyhtYXApO1xuICAgIH1cbn1cbiIsICJjb25zdCBjb2xsYXBzZWRQYXRocyA9IHt9OyAgLy8gcGF0aCAtPiBjb2xsYXBzZWQ/XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJCb3VuZHMobCwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmICghbCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgLy8gU3VwcG9ydCBmb2xkZXIgdHJlZSBub2RlcyAoZ3JvdXBzIGluIHNpZGViYXIgdHJlZSlcclxuICAgIGlmIChsLmlzR3JvdXApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZHJlbiBncm91cHNcclxuICAgICAgICBPYmplY3Qua2V5cyhsLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhsLmNoaWxkcmVuW2tleV0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGQgbGF5ZXJzXHJcbiAgICAgICAgbC5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobHlyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChsLmJvdW5kcyAmJiBsLmJvdW5kcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgcmV0dXJuIGwuYm91bmRzO1xyXG4gICAgfVxyXG4gICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbC5sYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobC5sb2NhdGlvbnMgJiYgbC5sb2NhdGlvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IGwubG9jYXRpb25zLmZsYXQoSW5maW5pdHkpO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpXTtcclxuICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKyAxXTtcclxuICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdO1xyXG4gICAgICAgIGlmIChidWYpIHtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShidWYuYnVmZmVyLCBidWYuYnl0ZU9mZnNldCwgYnVmLmJ5dGVMZW5ndGggLyA4KTtcclxuICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGggLyAyOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpICogMl07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBUaGUgd3JpdGUgaGFsZiBvZiBhIHZpc2liaWxpdHkgdG9nZ2xlOiBvbmUgY3VzdG9tIG1lc3NhZ2UgbmFtaW5nIHRoZSBmbGlwcGVkIGlkcyxcclxuLy8gaW5zdGVhZCBvZiB0aGUgd2hvbGUgbGF5ZXJzIHRyYWl0LiBQeXRob24gYXBwbGllcyB0aGUgZmllbGRzIGFuZCByZS1lbWl0cyB0aGVtIGFzXHJcbi8vIGBzZXRgIHBhdGNoIG9wcywgd2hpY2ggaXMgaG93IG90aGVyIHZpZXdzIG9mIHRoZSBzYW1lIG1hcCAobm90ZWJvb2sgb3V0cHV0cykgc3RheVxyXG4vLyBpbiBzdGVwIG5vdyB0aGF0IHRoZSB0cmFpdCBubyBsb25nZXIgY2FycmllcyB0b2dnbGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gc2VuZExheWVyV3JpdGUobW9kZWwsIGNoYW5nZXMpIHtcclxuICAgIGlmICghY2hhbmdlcy5sZW5ndGgpIHJldHVybjtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgbW9kZWwuc2VuZCh7XHJcbiAgICAgICAgICAgIGtpbmQ6IFwic3dpZnRtYXBfd3JpdGVcIixcclxuICAgICAgICAgICAgb3BzOiBjaGFuZ2VzLm1hcChjID0+ICh7IG9wOiBcInNldFwiLCBpZDogYy5pZCwgZmllbGRzOiB7IHZpc2libGU6IGMudmlzaWJsZSB9IH0pKSxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSByZW5kZXJlZCBsaXN0IGFscmVhZHkgaG9sZHMgdGhlIGNoYW5nZSAqLyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZXBvcnRzIHdoYXQgaXQgY2hhbmdlZCAtLSB7Y2hhbmdlczogW3tpZCwgdmlzaWJsZX1dLCBncm91cHNDaGFuZ2VkfSAtLSBzbyB0aGVcclxuICAgIC8vIGNhbGxlciBjYW4gd3JpdGUgYmFjayBleGFjdGx5IHRob3NlIGZsaXBzIHJhdGhlciB0aGFuIHRoZSB3aG9sZSBsYXllcnMgbGlzdC5cclxuICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgIGxldCBncm91cHNDaGFuZ2VkID0gZmFsc2U7XHJcbiAgICBmdW5jdGlvbiBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUpIHtcclxuICAgICAgICBjb25zdCBjb25mID0gZ3JvdXBDb25maWdzW25vZGUucGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc1JhZGlvR3JvdXAgPSBjb25mLm11bHRpX3NlbGVjdCA9PT0gZmFsc2U7XHJcbiAgICAgICAgaWYgKGlzUmFkaW9Hcm91cCkge1xyXG4gICAgICAgICAgICBsZXQgZm91bmRBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRHcm91cCA9IG5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBzQ2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGx5ci52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZTogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlLmNoaWxkcmVuW2tleV0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyh0cmVlKTtcclxuICAgIHJldHVybiB7IGNoYW5nZXMsIGdyb3Vwc0NoYW5nZWQgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZsaXBwZWQgb24gdGhlIGxpc3QgdGhpcyBzaWRlYmFyIHJlbmRlcmVkIGZyb20sIG5ldmVyIG1vZGVsLmdldChcImxheWVyc1wiKS5cclxuICAgICAgICAgICAgICAgIC8vIExheWVycyBhZGRlZCBhZnRlciB0aGUgd2lkZ2V0IGlzIGRpc3BsYXllZCBhcnJpdmUgYXMgcGF0Y2hlcyB0aGF0IHVwZGF0ZSB0aGVcclxuICAgICAgICAgICAgICAgIC8vIGZyb250ZW5kJ3MgbG9jYWwgc3RhdGUgd2l0aG91dCB0b3VjaGluZyB0aGUgdHJhaXQsIHNvIHRoZSBtb2RlbCdzIGNvcHkgaXNcclxuICAgICAgICAgICAgICAgIC8vIGZyb3plbiBhdCB3aGF0ZXZlciB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGNhcnJpZWQuIEJ1aWxkaW5nIHRoZSB1cGRhdGUgZnJvbVxyXG4gICAgICAgICAgICAgICAgLy8gaXQgZHJvcHMgZXZlcnkgbGF0ZXIgbGF5ZXI6IHRoZSB0b2dnbGUgbWF0Y2hlcyBubyBpZCwgd3JpdGVzIHRoZSBzdGFsZSBsaXN0XHJcbiAgICAgICAgICAgICAgICAvLyBiYWNrLCBhbmQgdGhlIGNoYW5nZSBoYW5kbGVyIHRoZW4gcmVzZXRzIGxvY2FsIHN0YXRlIHRvIGl0IC0tIHNvIHRoZSBib3hcclxuICAgICAgICAgICAgICAgIC8vIHJlLWNoZWNrcyBpdHNlbGYgYW5kIHRoZSBsYXllciBuZXZlciBoaWRlcy5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgZmxpcHMgbXV0YXRlIHRoZSByZW5kZXJlZCBsaXN0IGluIHBsYWNlIGFuZCByZWFjaCBQeXRob24gYXMgYSB0YXJnZXRlZFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUgKHNlbmRMYXllcldyaXRlKSwgbmV2ZXIgYnkgc2V0dGluZyB0aGUgbGF5ZXJzIHRyYWl0OiB0aGUgZnVsbFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUtYmFjayBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlIGNsaWNrLiBBdCAyNSB0cmFja3MgeCAyMDBrXHJcbiAgICAgICAgICAgICAgICAvLyB2ZXJ0aWNlcyBpdCB3YXMgYSAzNiBNQiBmcmFtZSAtLSBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0IHdlYnNvY2tldFxyXG4gICAgICAgICAgICAgICAgLy8gY2FwLCBzbyB0aGUgc2VydmVyIGNsb3NlZCB0aGUgY29ubmVjdGlvbiBhbmQgdGhlIFNoaW55IHNlc3Npb24gZGllZCBvblxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGNoZWNrYm94LiBTZXR0aW5nIHRoZSB0cmFpdCB3aXRob3V0IHNhdmluZyBpcyBqdXN0IGFzIGZhdGFsOlxyXG4gICAgICAgICAgICAgICAgLy8gaXQgc3RheXMgZGlydHkgYW5kIHRoZSBuZXh0IHNhdmVfY2hhbmdlcyAoYW55IHBhbikgZmx1c2hlcyBpdC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZsaXAgPSAobHlyLCB2aXNpYmxlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKChseXIudmlzaWJsZSAhPT0gZmFsc2UpID09PSB2aXNpYmxlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSB2aXNpYmxlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGUgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGlvIGJ1dHRvbiBsb2dpYzogc2V0IGFsbCBzaWJsaW5ncyB0byB2aXNpYmxlPWZhbHNlLCBhbmQgdGhpcyB0byB2aXNpYmxlPXRydWVcclxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYkdyb3VwID0gcGFyZW50Tm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBzaWJHcm91cC5wYXRoID09PSBwYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbc2liR3JvdXAucGF0aF0gPSAhYWN0aXZlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IGZsaXAoc2liTHlyLCBzaWJMeXIuaWQgPT09IGlkKSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3BhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBseXIgPSBsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGx5cikgZmxpcChseXIsIGlzQ2hlY2tlZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCBjaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIC8vIGdyb3VwX2NvbmZpZ3Mgc3RheXMgb24gdGhlIHRyYWl0OiBpdCBpcyBhIGhhbmRmdWwgb2YgZm9sZGVyIGZsYWdzLCBhbmQgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyBzcHJlYWQgZ2l2ZXMgQmFja2JvbmUgYSBmcmVzaCByZWZlcmVuY2Ugc28gdGhlIGluLXBsYWNlIGVkaXRzIHJlZ2lzdGVyLlxyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0NoZWNrZWQgJiYgbWFwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYm91bmRzID0gZ2V0TGF5ZXJCb3VuZHMobm9kZSwgbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYm91bmRzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBvbkxheWVyVG9nZ2xlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQobm9kZURpdik7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVuZGVyIHRyZWUgZnJvbSByb290IG5vZGVcclxuICAgIHJlbmRlck5vZGUodHJlZSwgc2lkZWJhciwgMCwgbnVsbCwgdHJ1ZSk7XHJcbn1cclxuIiwgIi8vIFRoZSBsZWdlbmQ6IGRlcml2ZWQgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSBldmVyeXRoaW5nIGVsc2UgcmVuZGVycyBmcm9tLCB3aXRoXG4vLyBkZWNsYXJhdGl2ZSBvdmVycmlkZXMgb24gdG9wLiBEZWxpYmVyYXRlbHkgbW9kZWwtZnJlZSAtLSBwdXJlIGRhdGEgaW4sIERPTSBvdXQgLS1cbi8vIHNvIGEgcGxhaW4tSlMgY29uc3VtZXIgb2YgZGlzdC9pbmRleC5qcyBnZXRzIHRoZSB3aG9sZSBmZWF0dXJlLCBhbmQgdGhlIGFueXdpZGdldFxuLy8gZ2x1ZSBpbiBtYXAuanMgaXMgYSBmZXcgbGluZXMuIChzaWRlYmFyLmpzIHN0aWxsIHRha2VzIGBtb2RlbGAgYW5kIGlzIGZpbGVkIGZvclxuLy8gZXh0cmFjdGlvbjsgdGhpcyBtb2R1bGUgbXVzdCBuZXZlciBuZWVkIHRoYXQgdW5waWNraW5nLilcbi8vXG4vLyBUaGUgcGlwZWxpbmU6IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykgd2Fsa3MgdGhlIGxheWVycyBpbnRvXG4vLyBlbnRyaWVzIChza2lwcGVkIGVudGlyZWx5IHdoZW4gY29uZmlnLmF1dG8gPT09IGZhbHNlKSwgYXBwbGllcyB0aGUgcGVyc2lzdGVudFxuLy8gcmVtb3ZlLW1hdGNoZXJzLCBhcHBlbmRzIHRoZSBtYW51YWwgYWRkcywgYW5kIHJldHVybnMgYSBzcGVjIHRoYXQgcmVuZGVyTGVnZW5kXG4vLyB0dXJucyBpbnRvIERPTS4gTm90aGluZyBoZXJlIGtub3dzIGFib3V0IGNvbG9ybWFwczogcmFtcC9jYXRlZ29yeS9iaW4gZW50cmllc1xuLy8gYXJyaXZlIHdpdGggdGhlaXIgY29sb3VycyBhbHJlYWR5IHJlc29sdmVkIChQeXRob24gcmVzb2x2ZXMgYXQgdGhlIGFkZF8qIGJvdW5kYXJ5LFxuLy8gbWFudWFsIGVudHJpZXMgYXQgbGVnZW5kX2FkZCksIHNvIHRoZXJlIGlzIG5vIGFuY2hvciB0YWJsZSB0byBkcmlmdC5cblxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9tYXAuanNcIjtcblxuY29uc3QgR0xZUEhTID0ge1xuICAgIGNpcmNsZV9tYXJrZXJzOiBcImNpcmNsZVwiLFxuICAgIG1hcmtlcnM6IFwicGluXCIsXG4gICAgcG9seWxpbmU6IFwibGluZVwiLFxuICAgIHBvbHlnb246IFwicG9seWdvblwiLFxuICAgIGNpcmNsZTogXCJjaXJjbGVcIixcbn07XG5cbmZ1bmN0aW9uIHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiBcInN3YXRjaFwiLFxuICAgICAgICBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsXG4gICAgICAgIHNoYXBlOiBHTFlQSFNbbGF5ZXIudHlwZV0gfHwgXCJzcXVhcmVcIixcbiAgICAgICAgY29sb3I6IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBmaWxsQ29sb3I6IGxheWVyLmZpbGxDb2xvciB8fCBsYXllci5maWxsX2NvbG9yIHx8IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBoaWRkZW4sXG4gICAgfTtcbn1cblxuLy8gQSBkYXRhLWRyaXZlbiBibG9jayByZWNvcmRlZCBhdCBhZGQgdGltZSAoe2tpbmQsIGFuY2hvcnN8aXRlbXN8ZWRnZXMrY29sb3JzLCAuLi59KVxuLy8gYmVjb21lcyB0aGUgbGF5ZXIncyBlbnRyeSBhcy1pczsgdGhlIGxheWVyIG9ubHkgY29udHJpYnV0ZXMgbGFiZWwgYW5kIHZpc2liaWxpdHkuXG5mdW5jdGlvbiBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4geyAuLi5sYXllci5sZWdlbmQsIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIiwgaGlkZGVuIH07XG59XG5cbmZ1bmN0aW9uIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSByZXR1cm4gW107XG4gICAgY29uc3QgaGlkZGVuID0gIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgLy8gQSBjb2xsZWN0aW9uOiBvbmUgZW50cnkgcGVyIGdlb21ldHJ5IHBhcnQsIHNhbWUgbGFiZWwgYnkgZGVzaWduIC0tIHRoZVxuICAgICAgICAvLyBnbHlwaHMgYXJlIHdoYXQgdGVsbCB0aGVtIGFwYXJ0LCBtYXRjaGluZyBob3cgdGhlIHBhcnRzIHJlbmRlci5cbiAgICAgICAgcmV0dXJuIChsYXllci5sYXllcnMgfHwgW10pXG4gICAgICAgICAgICAuZmlsdGVyKHN1YiA9PiBHTFlQSFNbc3ViLnR5cGVdKVxuICAgICAgICAgICAgLm1hcChzdWIgPT4gc3ViLmxlZ2VuZFxuICAgICAgICAgICAgICAgID8gYmxvY2tFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pKTtcbiAgICB9XG4gICAgaWYgKCFHTFlQSFNbbGF5ZXIudHlwZV0pIHJldHVybiBbXTtcbiAgICBjb25zdCBlbnRyaWVzID0gW2xheWVyLmxlZ2VuZCA/IGJsb2NrRW50cnkobGF5ZXIsIGhpZGRlbikgOiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKV07XG4gICAgLy8gcmFkaXVzX2NvbCByZWNvcmRzIGEgc2l6ZSBrZXkgYmVzaWRlIHRoZSBjb2xvdXIgc3Rvcnk6IGJvdGggZW5jb2RpbmdzIG9uIHRoZVxuICAgIC8vIG1hcCBkZXNlcnZlIGJvdGggZXhwbGFuYXRpb25zIGluIHRoZSBsZWdlbmQuXG4gICAgaWYgKGxheWVyLmxlZ2VuZF9zaXplKSB7XG4gICAgICAgIGVudHJpZXMucHVzaCh7IC4uLmxheWVyLmxlZ2VuZF9zaXplLFxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogbGF5ZXIubGVnZW5kX3NpemUuZmllbGQgfHwgbGF5ZXIubmFtZSB8fCBcIlNpemVcIiwgaGlkZGVuIH0pO1xuICAgIH1cbiAgICByZXR1cm4gZW50cmllcztcbn1cblxuLy8gSWRlbnRpY2FsIGRhdGEtZHJpdmVuIHBheWxvYWRzIGNvbGxhcHNlIGludG8gb25lIHJvdy4gR3JvdXBpbmcgcG9pbnRzIGJ5IGEgY29sdW1uXG4vLyBnaXZlcyBldmVyeSBzdWItbGF5ZXIgdGhlIHNhbWUgcmFtcDsgYSByYW1wIHBlciBzdWItbGF5ZXIgaXMgbm9pc2UsIGFuZCB0aGUgZmllbGRcbi8vIG5hbWUgaXMgdGhlIGhvbmVzdCBsYWJlbCBmb3IgdGhlIHNoYXJlZCBtYXBwaW5nLiBUaGUgc3Vydml2b3Iga2VlcHMgdGhlIGZpcnN0XG4vLyBvY2N1cnJlbmNlJ3MgcG9zaXRpb24gYW5kIGhpZGVzIG9ubHkgd2hlbiBldmVyeSBjb250cmlidXRvciBpcyBoaWRkZW4uXG5mdW5jdGlvbiBwYXlsb2FkS2V5KGVudHJ5KSB7XG4gICAgLy8gSWRlbnRpdHkgZmllbGRzIHN0YXkgb3V0IG9mIHRoZSBrZXk6IHRoZSB3aG9sZSBwb2ludCBpcyB0aGF0IGVudHJpZXMgZnJvbVxuICAgIC8vIERJRkZFUkVOVCBsYXllcnMgY29sbGFwc2Ugd2hlbiB0aGVpciBtYXBwaW5nIHBheWxvYWQgaXMgdGhlIHNhbWUuXG4gICAgY29uc3QgeyBsYWJlbCwgaGlkZGVuLCBsYXllcklkLCBsYXllciwgZ3JvdXAsIC4uLnBheWxvYWQgfSA9IGVudHJ5O1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbn1cblxuZnVuY3Rpb24gZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKSB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBNYXAoKTsgICAvLyBwYXlsb2FkIGtleSAtPiBzdXJ2aXZpbmcgZW50cnlcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoZW50cnkgPT4ge1xuICAgICAgICAgICAgaWYgKGVudHJ5LmtpbmQgPT09IFwic3dhdGNoXCIpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGF5bG9hZEtleShlbnRyeSk7XG4gICAgICAgICAgICBjb25zdCBzdXJ2aXZvciA9IHNlZW4uZ2V0KGtleSk7XG4gICAgICAgICAgICBpZiAoIXN1cnZpdm9yKSB7XG4gICAgICAgICAgICAgICAgc2Vlbi5zZXQoa2V5LCBlbnRyeSk7XG4gICAgICAgICAgICAgICAgaWYgKGVudHJ5LmZpZWxkKSBlbnRyeS5sYWJlbCA9IGVudHJ5LmZpZWxkO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3Vydml2b3IuaGlkZGVuID0gc3Vydml2b3IuaGlkZGVuICYmIGVudHJ5LmhpZGRlbjtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBncm91cHM7XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXJIaXRzKG1hdGNoZXIsIGVudHJ5LCBncm91cE5hbWUpIHtcbiAgICBpZiAoIW1hdGNoZXIpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgY29uc3RyYWluZWQgPSBmYWxzZTtcbiAgICBpZiAobWF0Y2hlci5sYWJlbCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKGVudHJ5LmxhYmVsICE9PSBtYXRjaGVyLmxhYmVsKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmdyb3VwICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZ3JvdXBOYW1lICE9PSBtYXRjaGVyLmdyb3VwKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmlkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZW50cnkubGF5ZXJJZCAhPT0gbWF0Y2hlci5pZCkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gY29uc3RyYWluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHtcbiAgICBjb25zdCBjZmcgPSBjb25maWcgfHwge307XG4gICAgY29uc3QgZ3JvdXBzID0gW107XG4gICAgY29uc3QgYnlOYW1lID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGdyb3VwRm9yID0gbmFtZSA9PiB7XG4gICAgICAgIGlmICghYnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IG5hbWUsIGVudHJpZXM6IFtdIH07XG4gICAgICAgICAgICBieU5hbWUuc2V0KG5hbWUsIGdyb3VwKTtcbiAgICAgICAgICAgIGdyb3Vwcy5wdXNoKGdyb3VwKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYnlOYW1lLmdldChuYW1lKTtcbiAgICB9O1xuXG4gICAgaWYgKGNmZy5hdXRvICE9PSBmYWxzZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIHtcbiAgICAgICAgICAgICAgICBlbnRyeS5sYXllcklkID0gbGF5ZXIuaWQ7XG4gICAgICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBncm91cEZvcihsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcyk7XG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzdXBwcmVzc2lvbjogbWF0Y2hlcnMgb3V0bGl2ZSBldmVyeSByZS1kZXJpdmF0aW9uLCB3aGljaCBpcyB0aGVcbiAgICAvLyBkaWZmZXJlbmNlIGZyb20gYSByZWdpc3RyeSByZW1vdmUgdGhhdCB0aGUgbmV4dCBhZGQgd291bGQganVzdCByZXBvcHVsYXRlLlxuICAgIGNvbnN0IHJlbW92ZXMgPSBjZmcucmVtb3ZlIHx8IFtdO1xuICAgIGlmIChyZW1vdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICBlbnRyeSA9PiAhcmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGdyb3VwLm5hbWUpKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYW51YWwgZW50cmllczogdGhlIHVzZXIncyBvd24gY2xhaW1zLiBzY29wZSBuZXZlciBkcm9wcyB0aGVtOyBhIGBsYXllcmBcbiAgICAvLyBiaW5kaW5nIG1ha2VzIG9uZSBmb2xsb3cgYSBsaXZlIGxheWVyJ3MgdmlzaWJpbGl0eSAoYW5kIHZhbmlzaCB3aXRoIGl0IHVuZGVyXG4gICAgLy8gc2NvcGUgXCJ2aXNpYmxlXCIpLCBmb3Igd2hlbiBhIG1hbnVhbCByb3cgaXMgcmVhbGx5IGEgcmVsYWJlbGxpbmcuXG4gICAgZm9yIChjb25zdCBhZGRlZCBvZiBjZmcuYWRkIHx8IFtdKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0geyBoaWRkZW46IGZhbHNlLCAuLi5hZGRlZCB9O1xuICAgICAgICBpZiAoZW50cnkubGF5ZXIgIT0gbnVsbCkge1xuICAgICAgICAgICAgY29uc3QgYm91bmQgPSAobGF5ZXJzIHx8IFtdKS5maW5kKFxuICAgICAgICAgICAgICAgIGwgPT4gbC5pZCA9PT0gZW50cnkubGF5ZXIgfHwgbC5uYW1lID09PSBlbnRyeS5sYXllcik7XG4gICAgICAgICAgICBlbnRyeS5oaWRkZW4gPSAhYm91bmQgfHwgIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGJvdW5kLCBncm91cENvbmZpZ3MgfHwge30pO1xuICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGVudHJ5Lmdyb3VwIHx8IFwiXCIpKSkgY29udGludWU7XG4gICAgICAgIGdyb3VwRm9yKGVudHJ5Lmdyb3VwIHx8IFwiXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XG4gICAgfVxuXG4gICAgY29uc3QgcG9wdWxhdGVkID0gZ3JvdXBzLmZpbHRlcihnID0+IGcuZW50cmllcy5sZW5ndGggPiAwKTtcbiAgICByZXR1cm4geyB0aXRsZTogY2ZnLnRpdGxlIHx8IFwiTGVnZW5kXCIsIGdyb3VwczogcG9wdWxhdGVkIH07XG59XG5cbi8vIC0tLSByZW5kZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBET00gYnVpbHQgd2l0aCBjcmVhdGVFbGVtZW50L3RleHRDb250ZW50IHRocm91Z2hvdXQ6IGxhYmVscyBhbmQgY2F0ZWdvcnkgdmFsdWVzIGNvbWVcbi8vIGZyb20gdXNlciBkYXRhIGFuZCBtdXN0IG5ldmVyIGJlIHBhcnNlZCBhcyBIVE1MLlxuXG5mdW5jdGlvbiBkaXYoc3R5bGVzLCB0ZXh0KSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlcyk7XG4gICAgaWYgKHRleHQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gZ2x5cGgoZW50cnkpIHtcbiAgICBpZiAoZW50cnkuc2hhcGUgPT09IFwibGluZVwiKSB7XG4gICAgICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIyMHB4XCIsIGhlaWdodDogXCI0cHhcIiwgYmFja2dyb3VuZDogZW50cnkuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIgfSk7XG4gICAgfVxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJwaW5cIikge1xuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBlbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XG4gICAgICAgIGVsLnN0eWxlLmZsZXggPSBcIm5vbmVcIjtcbiAgICAgICAgY29uc3Qgc3ZnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJzdmdcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBcIjEyXCIpO1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMTRcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIsIFwiMCAwIDI0IDI4XCIpO1xuICAgICAgICBjb25zdCBwYXRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJwYXRoXCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImRcIixcbiAgICAgICAgICAgIFwiTTEyIDBDNS40IDAgMCA1LjQgMCAxMmMwIDkgMTIgMTYgMTIgMTZzMTItNyAxMi0xNkMyNCA1LjQgMTguNiAwIDEyIDB6XCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImZpbGxcIiwgZW50cnkuY29sb3IpO1xuICAgICAgICBzdmcuYXBwZW5kQ2hpbGQocGF0aCk7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKHN2Zyk7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgLy8gY2lyY2xlIC8gcG9seWdvbiAvIHNxdWFyZTogZmlsbCBpbnNpZGUgYSBib3JkZXIsIHdoaWNoIGlzIGhvdyBhcmVhcyBkcmF3LlxuICAgIGNvbnN0IHJhZGl1cyA9IGVudHJ5LnNoYXBlID09PSBcImNpcmNsZVwiID8gXCI1MCVcIlxuICAgICAgICA6IGVudHJ5LnNoYXBlID09PSBcInBvbHlnb25cIiA/IFwiMnB4XCIgOiBcIjBcIjtcbiAgICByZXR1cm4gZGl2KHsgd2lkdGg6IFwiMTJweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5maWxsQ29sb3IsXG4gICAgICAgICAgICAgICAgIGJvcmRlcjogYDJweCBzb2xpZCAke2VudHJ5LmNvbG9yfWAsIGJvcmRlclJhZGl1czogcmFkaXVzLFxuICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGJveFNpemluZzogXCJib3JkZXItYm94XCIgfSk7XG59XG5cbmZ1bmN0aW9uIHJhbXBSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBzdG9wcyA9IChlbnRyeS5hbmNob3JzIHx8IFtdKS5tYXAoKGNvbG9yLCBpLCBhbGwpID0+XG4gICAgICAgIGAke2NvbG9yfSAke2FsbC5sZW5ndGggPiAxID8gKGkgLyAoYWxsLmxlbmd0aCAtIDEpKSAqIDEwMCA6IDB9JWApO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe1xuICAgICAgICB3aWR0aDogXCIxMjBweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBib3JkZXJSYWRpdXM6IFwiMnB4XCIsXG4gICAgICAgIGJhY2tncm91bmRJbWFnZTogYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWAsXG4gICAgfSkpO1xuICAgIGNvbnN0IGVuZHMgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwganVzdGlmeUNvbnRlbnQ6IFwic3BhY2UtYmV0d2VlblwiLCB3aWR0aDogXCIxMjBweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICBmb250U2l6ZTogXCIxMXB4XCIsIGNvbG9yOiBcIiM1NTVcIiB9KTtcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtaW4pKSk7XG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhlbnRyeS52bWF4KSkpO1xuICAgIHJvdy5hcHBlbmRDaGlsZChlbmRzKTtcbiAgICByZXR1cm4gcm93O1xufVxuXG5jb25zdCBNQVhfQ0FURUdPUllfUk9XUyA9IDEyO1xuXG5mdW5jdGlvbiBjYXRlZ29yaWVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XG4gICAgY29uc3QgaXRlbXMgPSBlbnRyeS5pdGVtcyB8fCBbXTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMuc2xpY2UoMCwgTUFYX0NBVEVHT1JZX1JPV1MpKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvcjogaXRlbS5jb2xvciwgZmlsbENvbG9yOiBpdGVtLmNvbG9yIH0pKTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhpdGVtLnZhbHVlKSkpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XG4gICAgfVxuICAgIGlmIChpdGVtcy5sZW5ndGggPiBNQVhfQ0FURUdPUllfUk9XUykge1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luTGVmdDogXCI4cHhcIiwgbWFyZ2luVG9wOiBcIjNweFwiLCBjb2xvcjogXCIjNTU1XCIgfSxcbiAgICAgICAgICAgIGArICR7aXRlbXMubGVuZ3RoIC0gTUFYX0NBVEVHT1JZX1JPV1N9IG1vcmVgKSk7XG4gICAgfVxuICAgIHJldHVybiByb3c7XG59XG5cbmZ1bmN0aW9uIGJpbnNSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBlZGdlcyA9IGVudHJ5LmVkZ2VzIHx8IFtdO1xuICAgIGNvbnN0IGNvbG9ycyA9IGVudHJ5LmNvbG9ycyB8fCBbXTtcbiAgICBjb25zdCBsYWJlbEZvciA9IGkgPT4gaSA9PT0gMCA/IGA8ICR7ZWRnZXNbMF19YFxuICAgICAgICA6IGkgPT09IGVkZ2VzLmxlbmd0aCA/IGBcdTIyNjUgJHtlZGdlc1tlZGdlcy5sZW5ndGggLSAxXX1gXG4gICAgICAgIDogYCR7ZWRnZXNbaSAtIDFdfSBcdTIwMTMgJHtlZGdlc1tpXX1gO1xuICAgIGNvbG9ycy5mb3JFYWNoKChjb2xvciwgaSkgPT4ge1xuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmdpbkxlZnQ6IFwiOHB4XCIgfSk7XG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZ2x5cGgoeyBzaGFwZTogXCJzcXVhcmVcIiwgY29sb3IsIGZpbGxDb2xvcjogY29sb3IgfSkpO1xuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgbGFiZWxGb3IoaSkpKTtcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGxpbmUpO1xuICAgIH0pO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIEEgc2l6ZSBrZXkgaXMgYSBzdGF0ZW1lbnQsIG5vdCBhIGRyYXdpbmc6IFwiXHUyNUNGIHNpemUgXHUyMjFEIGZpZWxkIChtaW4gXHUyMDEzIG1heClcIi4gVGhlIGdseXBoXG4vLyBpcyBmaXhlZCBhbmQgbm90aGluZyBpbiB0aGUgcm93IGRlcml2ZXMgZnJvbSByYWRpdXNfcmFuZ2Ugb3IgdGhlIGRhdGEncyBzcHJlYWQgLS1cbi8vIGxlZ2VuZCBDU1MgcGl4ZWxzIGFyZSBub3QgbWFwIHBpeGVscyBhdCBhbnkgem9vbSwgc28gZHJhd24gc2FtcGxlIGNpcmNsZXMgd291bGRcbi8vIGFzc2VydCBhIHByZWNpc2lvbiB0aGF0IGRvZXMgbm90IGV4aXN0LiBUaGUgcm93IG5hbWVzIHRoZSBlbmNvZGluZyBhbmQgaXRzIGRvbWFpbi5cbmZ1bmN0aW9uIHNpemVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBjb2xvcjogXCIjNjY2XCIgfSwgXCJcdTI1Q0ZcIikpO1xuICAgIGNvbnN0IHJhbmdlID0gZW50cnkudm1pbiAhPSBudWxsICYmIGVudHJ5LnZtYXggIT0gbnVsbFxuICAgICAgICA/IGAgKCR7ZW50cnkudm1pbn0gXHUyMDEzICR7ZW50cnkudm1heH0pYCA6IFwiXCI7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgYHNpemUgXHUyMjFEICR7ZW50cnkuZmllbGQgfHwgZW50cnkubGFiZWx9JHtyYW5nZX1gKSk7XG4gICAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gc3dhdGNoUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZ2x5cGgoZW50cnkpKTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIENvbGxhcHNlIHN0YXRlLCBwZXIgY29udGFpbmVyIHJhdGhlciB0aGFuIG1vZHVsZSBzY29wZTogdGhlIHNpZGViYXIga2V5cyBpdHNcbi8vIGNvbGxhcHNlZFBhdGhzIGF0IG1vZHVsZSBsZXZlbCBhbmQgdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmUgaXQgLS0gYSBmaWxlZCBidWdcbi8vIHRoaXMgZGVsaWJlcmF0ZWx5IGRvZXMgbm90IGluaGVyaXQuIEtleWVkIGJ5IGdyb3VwIG5hbWUsIHN1cnZpdmluZyB0aGUgZnVsbFxuLy8gcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBjb250YWluZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICBjb25zdCBkaW1IaWRkZW4gPSBvcHRpb25zLmRpbUhpZGRlbiAhPT0gZmFsc2U7XG4gICAgbGV0IGNvbGxhcHNlZCA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xuICAgIGlmICghY29sbGFwc2VkKSB7XG4gICAgICAgIGNvbGxhcHNlZCA9IG5ldyBTZXQoKTtcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgY29sbGFwc2VkKTtcbiAgICB9XG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7XG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxuICAgICAgICBwYWRkaW5nQm90dG9tOiBcIjRweFwiLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIsXG4gICAgfSwgc3BlYy50aXRsZSkpO1xuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBzcGVjLmdyb3Vwcykge1xuICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGdyb3VwLm5hbWUgJiYgY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKTtcbiAgICAgICAgaWYgKGdyb3VwLm5hbWUpIHtcbiAgICAgICAgICAgIC8vIFRoZSBzaWRlYmFyJ3MgYWZmb3JkYW5jZSBleGFjdGx5OiBhbiBhcnJvdyB0aGF0IGZvbGRzIHRoZSBzZWN0aW9uLlxuICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gZGl2KHsgZm9udFdlaWdodDogXCJib2xkXCIsIG1hcmdpblRvcDogXCI2cHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsIHVzZXJTZWxlY3Q6IFwibm9uZVwiIH0pO1xuICAgICAgICAgICAgaGVhZGVyLnRleHRDb250ZW50ID0gYCR7aXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIn0gJHtncm91cC5uYW1lfWA7XG4gICAgICAgICAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKSkgY29sbGFwc2VkLmRlbGV0ZShncm91cC5uYW1lKTtcbiAgICAgICAgICAgICAgICBlbHNlIGNvbGxhcHNlZC5hZGQoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGNvbnRhaW5lciwgc3BlYywgb3B0aW9ucyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChoZWFkZXIpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChpc0NvbGxhcHNlZCkgY29udGludWU7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZ3JvdXAuZW50cmllcykge1xuICAgICAgICAgICAgY29uc3Qgcm93ID0gZW50cnkua2luZCA9PT0gXCJyYW1wXCIgPyByYW1wUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJiaW5zXCIgPyBiaW5zUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJzaXplc1wiID8gc2l6ZXNSb3coZW50cnkpXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hSb3coZW50cnkpO1xuICAgICAgICAgICAgLy8gRGltbWVkLCBub3QgZHJvcHBlZDogdW5kZXIgc2NvcGUgXCJhbGxcIiB0aGUgbGVnZW5kIGlzIHRoZSBtYXAncyB3aG9sZVxuICAgICAgICAgICAgLy8gdm9jYWJ1bGFyeSwgYW5kIHRoZSBkaW0gaXMgd2hhdCBzdGlsbCB0ZWxscyB0aGUgY3VycmVudCBzY3JlZW4gc3RhdGUuXG4gICAgICAgICAgICBpZiAoZW50cnkuaGlkZGVuICYmIGRpbUhpZGRlbikgcm93LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHJvdyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbn1cbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIC8vIFRoZSBmaXJzdCB0aWNrIHNpdHMgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBub3Qgb25lIHBlcmlvZCBhZnRlciBpdDogd2luZG93c1xuICAgIC8vIGFyZSBoYWxmLW9wZW4gKHN0YXJ0LCBlbmRdLCBzbyBhIGZpcnN0IHRpY2sgYXQgc3RhcnQrUCB3b3VsZCBleGNsdWRlIHRoZSBlYXJsaWVzdFxuICAgIC8vIHBvaW50IGZyb20gaXRzIG93biB3aW5kb3cgYW5kIGl0IHdvdWxkIG5ldmVyIGRpc3BsYXkgYXQgYW55IHRpY2suXG4gICAgY29uc3QgdGlja3MgPSBbc3RhcnRNc107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xuICAgICAgICB0aWNrcy5wdXNoKHQpO1xuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XG4gICAgcmV0dXJuIHRpY2tzO1xufVxuXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2Vcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgfVxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xufVxuXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xufVxuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG59XG5cbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cbi8vXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgLy8gQSBwZXItdmVydGV4LXRpbWVkIGxpbmUgaG9sZHMgbWFueSBwYWlyczsgb24gdGhpcyB3aG9sZS1sYXllciBwYXRoIGl0IHNob3dzXG4gICAgLy8gd2hpbGUgQU5ZIG9mIHRoZW0gaXMgaW4gdGhlIHdpbmRvdyAtLSB0aGUgR1BVIHBhdGggaXMgd2hhdCB0cmltcyBwZXIgc2VnbWVudC5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XG59XG5cbi8vIE9uZSBwbGF5YmFjayBzdGVwOiB0aGUgbmV4dCBpbmRleCBhbmQgd2hldGhlciBwbGF5YmFjayBzdXJ2aXZlcyBpdC4gUHVyZSBzbyB0aGUgbG9vcFxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxuLy8gd2l0aG91dCBsb29wIHN0b3BzIHdoZXJlIGl0IGlzLlxuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2UoaW5kZXgsIGxlbmd0aCwgbG9vcCkge1xuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcbiAgICBpZiAobG9vcCkgcmV0dXJuIHsgaW5kZXg6IDAsIHBsYXlpbmc6IHRydWUgfTtcbiAgICByZXR1cm4geyBpbmRleCwgcGxheWluZzogZmFsc2UgfTtcbn1cblxuLy8gV2hlcmUgdGhlIGNvbnRyb2wgc2l0cywgYXMgaW5saW5lIHN0eWxlcyBzbyB0aGUgY2hvaWNlIHRyYXZlbHMgd2l0aCB0aGUgc3RhdGUgcmF0aGVyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cbi8vIGluY2x1ZGluZyB0aGUgb25lcyBhIHBvc2l0aW9uIGRvZXMgbm90IHVzZSAtLSBzbyBtb3ZpbmcgdGhlIGNvbnRyb2wgY2xlYXJzIHRoZSBvbGRcbi8vIGFuY2hvciBpbnN0ZWFkIG9mIGFjY3VtdWxhdGluZyBib3RoLlxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcbiAgICBcInRvcC1sZWZ0XCI6ICAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJ0b3AtY2VudGVyXCI6ICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImxlZnQtY2VudGVyXCI6ICAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJyaWdodC1jZW50ZXJcIjogIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImJvdHRvbS1jZW50ZXJcIjogeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tcmlnaHRcIjogIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxufTtcblxuZnVuY3Rpb24gYXBwbHlQb3NpdGlvbihlbCwgcG9zaXRpb24pIHtcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XG4gICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN0eWxlcykpIHtcbiAgICAgICAgZWwuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XG59XG5cbi8vIC0tLSB0aGUgd2luZG93IGFuZCB0aGUgcnVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gRml4ZWQgbWlsbGlzZWNvbmRzIGZvciBhIHBlcmlvZCwgb3IgbnVsbCB3aGVuIGl0IG1vdmVzIHRocm91Z2ggdGhlIGNhbGVuZGFyIChtb250aHMsXG4vLyB5ZWFycykgYW5kIGhhcyBubyBmaXhlZCB3aWR0aC4gVGhlIHJ1bGVyIGFuZCB0aGUgZHJhZyBncmlkIG5lZWQgZml4ZWQgd2lkdGhzOyBjYWxlbmRhclxuLy8gcGVyaW9kcyBmYWxsIGJhY2sgdG8gdGhlIHRpY2sgcG9zaXRpb25zIHRoZW1zZWx2ZXMuXG5leHBvcnQgZnVuY3Rpb24gcGVyaW9kVG9NcyhwKSB7XG4gICAgaWYgKCFwIHx8IHAueWVhcnMgfHwgcC5tb250aHMpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMCArIHAuaG91cnMgKiAzNjAwXG4gICAgICAgICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMDtcbn1cblxuLy8gTWlsbGlzZWNvbmRzIGFzIGFuIElTTzg2MDEgZHVyYXRpb24sIGhvdXJzL21pbnV0ZXMvc2Vjb25kcyBvbmx5IC0tIFBUMjZIIGlzIHZhbGlkIGFuZFxuLy8gYXZvaWRzIGNhbGVuZGFyIHVuaXRzIGVudGlyZWx5LCBzbyB3aGF0IHRoZSBkcmFnIHdyaXRlcyBhbHdheXMgcGFyc2VzIGJhY2sgZXhhY3RseS5cbmV4cG9ydCBmdW5jdGlvbiBtc1RvUGVyaW9kSVNPKG1zKSB7XG4gICAgbGV0IHJlc3QgPSBNYXRoLnJvdW5kKG1zIC8gMTAwMCk7XG4gICAgY29uc3QgaCA9IE1hdGguZmxvb3IocmVzdCAvIDM2MDApOyByZXN0IC09IGggKiAzNjAwO1xuICAgIGNvbnN0IG0gPSBNYXRoLmZsb29yKHJlc3QgLyA2MCk7IHJlc3QgLT0gbSAqIDYwO1xuICAgIGxldCBvdXQgPSBcIlBUXCI7XG4gICAgaWYgKGgpIG91dCArPSBgJHtofUhgO1xuICAgIGlmIChtKSBvdXQgKz0gYCR7bX1NYDtcbiAgICBpZiAocmVzdCB8fCBvdXQgPT09IFwiUFRcIikgb3V0ICs9IGAke3Jlc3R9U2A7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gVGhlIHJ1bGVyJ3MgaW5jcmVtZW50OiB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gZXZlcnkgYm91bmRhcnkgdGhlIHVzZXIgY2FuIGNhcmVcbi8vIGFib3V0IC0tIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZCBkdXJhdGlvbi4gQW4gaW50ZXJ2YWwgb2YgMWggd2l0aCBhXG4vLyAyLjVoIGR1cmF0aW9uIG5lZWRzIDMwLW1pbnV0ZSBtYXJrcyBmb3IgdGhlIGR1cmF0aW9uIHRvIHNpdCBvbiBvbmU7IDFoIGFuZCAyaCBuZWVkIG9ubHlcbi8vIHRoZSBob3Vycy4gXCJMb3dlc3QgZHVyYXRpb25cIiBpcyB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIG9uZSBkaXZpZGVzIHRoZSBvdGhlci5cbmV4cG9ydCBmdW5jdGlvbiBnY2RHcmlkTXMocGVyaW9kTXMsIGR1cmF0aW9uc01zKSB7XG4gICAgY29uc3QgZ2NkID0gKGEsIGIpID0+IChiID8gZ2NkKGIsIGEgJSBiKSA6IGEpO1xuICAgIGxldCBncmlkID0gcGVyaW9kTXM7XG4gICAgZm9yIChjb25zdCBkIG9mIGR1cmF0aW9uc01zKSB7XG4gICAgICAgIGlmIChkID4gMCkgZ3JpZCA9IGdjZChncmlkLCBNYXRoLnJvdW5kKGQpKTtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgubWF4KGdyaWQsIDEwMDApO1xufVxuXG4vLyBFdmVyeSBmaW5pdGUgZHVyYXRpb24gYXR0YWNoZWQgdG8gYSB0aW1lIGxheWVyLCBpbiBtcywgZm9yIHRoZSBncmlkLiBcInBlcmlvZFwiIGFuZCBudWxsXG4vLyBjb250cmlidXRlIG5vdGhpbmcgbmV3OyBjYWxlbmRhciBkdXJhdGlvbnMgY2Fubm90IGpvaW4gYSBmaXhlZC1tcyBncmlkIGFuZCBhcmUgc2tpcHBlZC5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJzLCB3aW5kb3dJc28pIHtcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBjb25zdCB2aXNpdCA9IGxpc3QgPT4gbGlzdC5mb3JFYWNoKGwgPT4ge1xuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsLmxheWVycyB8fCBbXSk7XG4gICAgICAgIGNvbnN0IHNwZWMgPSBsLnRpbWUgJiYgbC50aW1lLmR1cmF0aW9uO1xuICAgICAgICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgJiYgc3BlYyAhPT0gXCJwZXJpb2RcIikge1xuICAgICAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcbiAgICAgICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdmlzaXQobGF5ZXJzKTtcbiAgICBpZiAod2luZG93SXNvKSB7XG4gICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh3aW5kb3dJc28pKTtcbiAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFRpY2sgbWFya3MgZm9yIHRoZSB0cmFjazogbWFqb3JzIGF0IGV2ZXJ5IGludGVydmFsIGJvdW5kYXJ5IChzcGFyc2VseSBsYWJlbGxlZCBzbyBsb25nXG4vLyB0aW1lbGluZXMgc3RheSByZWFkYWJsZSksIHVubGFiZWxsZWQgbWlub3JzIGF0IHRoZSBncmlkIGluIGJldHdlZW4uIE1pbm9yIERJU1BMQVkgaXNcbi8vIHRoaW5uZWQgd2hlbiBkZW5zZTsgdGhlIHNuYXAgZ3JpZCBzdGF5cyBleGFjdCwgc28gYSBtYXJrIGlzIGEgZ3VpZGUsIG5vdCBhIGNvbnN0cmFpbnQuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSdWxlcih0aWNrcywgZ3JpZE1zLCBmb3JtYXRMYWJlbCwgeyBtYXhMYWJlbHMgPSA2LCBtYXhNaW5vcnMgPSAyNDAgfSA9IHt9KSB7XG4gICAgaWYgKHRpY2tzLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcbiAgICBjb25zdCB0MCA9IHRpY2tzWzBdLCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcbiAgICBjb25zdCBtYXJrcyA9IFtdO1xuICAgIGNvbnN0IGxhYmVsRXZlcnkgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodGlja3MubGVuZ3RoIC8gbWF4TGFiZWxzKSk7XG4gICAgdGlja3MuZm9yRWFjaCgodCwgaSkgPT4gbWFya3MucHVzaCh7XG4gICAgICAgIGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiB0cnVlLFxuICAgICAgICBsYWJlbDogaSAlIGxhYmVsRXZlcnkgPT09IDAgPyBmb3JtYXRMYWJlbCh0KSA6IG51bGwsXG4gICAgfSkpO1xuICAgIGlmIChncmlkTXMgJiYgZ3JpZE1zIDwgc3Bhbikge1xuICAgICAgICBjb25zdCB0b3RhbCA9IE1hdGguZmxvb3Ioc3BhbiAvIGdyaWRNcyk7XG4gICAgICAgIGNvbnN0IHRoaW4gPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodG90YWwgLyBtYXhNaW5vcnMpKTtcbiAgICAgICAgZm9yIChsZXQgayA9IDE7IGsgKiBncmlkTXMgPCBzcGFuOyBrICs9IHRoaW4pIHtcbiAgICAgICAgICAgIGNvbnN0IHQgPSB0MCArIGsgKiBncmlkTXM7XG4gICAgICAgICAgICBpZiAodGlja3MuaW5jbHVkZXModCkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgbWFya3MucHVzaCh7IGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiBmYWxzZSwgbGFiZWw6IG51bGwgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG1hcmtzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGlja0xhYmVsKG1zLCBwZXJpb2RNcykge1xuICAgIGNvbnN0IGlzbyA9IG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpO1xuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgNjAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxOSk7XG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCAyNCAqIDM2MDAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxNik7XG4gICAgcmV0dXJuIGlzby5zbGljZSg1LCAxMCk7XG59XG5cbi8vIEdseXBocyBhcyBpbmxpbmUgU1ZHIHJhdGhlciB0aGFuIHRleHQ6IFwiXHUyMUJCXCIgcmVhZHMgYXMgcmVmcmVzaCAtLSBhIGxvb3AgdG9nZ2xlIGRyYXduIHdpdGhcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xuLy8gdGhlIHByZXNzZWQgc3RhdGUgcmVzdHlsZSB0aGVtIGZyb20gQ1NTLlxuY29uc3QgSUNPTlMgPSB7XG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcbiAgICBwbGF5OiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAybDkgNi05IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGF1c2U6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJoM3YxMkg0ek05IDJoM3YxMkg5elwiLz48L3N2Zz4nLFxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXG4gICAgbG9vcDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTggMmE2IDYgMCAwIDEgNS42NSA0SDE2bC0yLjggMy41TDEwLjQgNmgyLjFBNC41IDQuNSAwIDEgMCAxMi41IDEwbDEuMy43NUE2IDYgMCAxIDEgOCAyelwiLz48L3N2Zz4nLFxufTtcblxuLy8gLS0tIHRoZSBjb250cm9sIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQbGFpbiBET00gaW5zaWRlIHRoZSB3aWRnZXQgY29udGFpbmVyLCBsaWtlIHRoZSBzaWRlYmFyOiBubyBMZWFmbGV0IGNvbnRyb2wgbWFjaGluZXJ5LFxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xuLy8gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MgY29udHJvbCAtLSBzdGVwL3BsYXkvc3RlcC9sb29wIGFzIGEgam9pbmVkIGJ1dHRvbiBiYXIsIHRoZW4gdGhlXG4vLyBkYXRlLCBzbGlkZXIgYW5kIHNwZWVkIC0tIHNpbmNlIHRoYXQgaXMgdGhlIHNsaWRlciB1c2VycyBvZiB0aGUgZm9saXVtIGFwcHMga25vdy5cbi8vXG4vLyBUaGUgc2xpZGVyIGlzIGEgY29tcG9zaXRlLiBBIG5hdGl2ZSA8aW5wdXQgdHlwZT1yYW5nZT4gc3RheXMgb24gdG9wIGFzIHRoZSB0aHVtYjogaXRcbi8vIGtlZXBzIGtleWJvYXJkIGFycm93cywgc2NyZWVuIHJlYWRlcnMgYW5kIGV2ZXJ5IGV4aXN0aW5nIHRlc3Qgd29ya2luZywgYW5kIHBsYXliYWNrXG4vLyBkcml2ZXMgaXQgYXMgYmVmb3JlLiBVbmRlcm5lYXRoIHNpdCB0aGUgcGFydHMgYSBuYXRpdmUgaW5wdXQgY2Fubm90IGRyYXc6IHRoZSB3aW5kb3dcbi8vIHNwYW4gc2hvd2luZyBleGFjdGx5IHdoYXQgaW50ZXJ2YWwgaXMgb24gdGhlIG1hcCwgYSBydWxlciB3aXRoIGxhYmVsbGVkIGludGVydmFsIG1hcmtzXG4vLyBhbmQgdW5sYWJlbGxlZCBnY2QgbWlub3JzLCBhbmQgdGhlIHRyYWlsIGhhbmRsZSAtLSBkcmFnIGl0IGJhY2sgdG8gd2lkZW4gdGhlIHdpbmRvdyBmb3Jcbi8vIGV2ZXJ5IGxheWVyIGF0IG9uY2UsIGRyb3AgaXQgb250byB0aGUgdGh1bWIgdG8gaGFuZCBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJUaW1lQ29udHJvbChjb250YWluZXIsIHN0YXRlLCBoYW5kbGVycykge1xuICAgIGxldCBlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtY29udHJvbFwiKTtcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoZWwpIGVsLnJlbW92ZSgpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKCFlbCkge1xuICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XG4gICAgICAgIGVsLmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1idXR0b25zXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1wbGF5XCIgYXJpYS1sYWJlbD1cIlBsYXlcIj4ke0lDT05TLnBsYXl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtZndkXCIgdGl0bGU9XCJTdGVwIGZvcndhcmRcIiBhcmlhLWxhYmVsPVwiU3RlcCBmb3J3YXJkXCI+JHtJQ09OUy5md2R9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxhYmVsXCI+PC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWNrXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhc2VcIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwYW5cIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXJ1bGVyXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxpbnB1dCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIgdHlwZT1cInJhbmdlXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWlsXCIgcm9sZT1cInNsaWRlclwiIHRhYmluZGV4PVwiMFwiXG4gICAgICAgICAgICAgICAgICAgICAgYXJpYS1sYWJlbD1cIlRyYWlsaW5nIHdpbmRvd1wiIHRpdGxlPVwiRHJhZyBiYWNrIHRvIHdpZGVuIHRoZSB0aW1lIHdpbmRvdzsgZHJvcCBvbiB0aGUgdGh1bWIgdG8gY2xlYXJcIj48L3NwYW4+XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8c2VsZWN0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGVlZFwiIHRpdGxlPVwiUGxheWJhY2sgc3BlZWRcIj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMC41XCI+MC41eDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIxXCI+MXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMlwiPjJ4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjRcIj40eDwvb3B0aW9uPlxuICAgICAgICAgICAgPC9zZWxlY3Q+YDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGVsKTtcblxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtYmFja1wiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwQmFjayk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1md2RcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEZvcndhcmQpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25QbGF5VG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uTG9vcFRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsXG4gICAgICAgICAgICBlID0+IGhhbmRsZXJzLm9uU3BlZWQocGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkpKTtcbiAgICAgICAgY29uc3Qgc2xpZGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKTtcbiAgICAgICAgLy8gYGlucHV0YCBmaXJlcyBwZXIgZHJhZyBzdGVwIGZvciBsaXZlIHNjcnViYmluZzsgdGhlIG1vZGVsIHdyaXRlYmFjayBpcyB0aGVcbiAgICAgICAgLy8gaGFuZGxlcidzIHByb2JsZW0sIHRocm90dGxlZCB0aGVyZSBzbyBkcmFnZ2luZyBkb2VzIG5vdCBmbG9vZCB0aGUga2VybmVsLlxuICAgICAgICBzbGlkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGUgPT4gaGFuZGxlcnMub25TZWVrKHBhcnNlSW50KGUudGFyZ2V0LnZhbHVlLCAxMCkpKTtcblxuICAgICAgICBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKTtcbiAgICB9XG5cbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLm1heCA9IFN0cmluZyhzdGF0ZS50aWNrcy5sZW5ndGggLSAxKTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLmluZGV4KTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbGFiZWxcIikudGV4dENvbnRlbnQgPSBmb3JtYXRVVEMoc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdKTtcblxuICAgIGNvbnN0IHBsYXkgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKTtcbiAgICBwbGF5LmlubmVySFRNTCA9IHN0YXRlLnBsYXlpbmcgPyBJQ09OUy5wYXVzZSA6IElDT05TLnBsYXk7XG4gICAgcGxheS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIik7XG4gICAgcGxheS50aXRsZSA9IHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIjtcblxuICAgIC8vIEEgbW9kZSwgbm90IGFuIGFjdGlvbjogcHJlc3NlZCBzdHlsaW5nIGFuZCBhcmlhLXByZXNzZWQgc2F5IFwidGhpcyBzdGF5cyBvblwiLFxuICAgIC8vIHdoZXJlIGEgYmFyZSBpY29uIGludml0ZWQgYSBjbGljayBleHBlY3Rpbmcgc29tZXRoaW5nIHRvIGhhcHBlbiByaWdodCBub3cuXG4gICAgY29uc3QgbG9vcCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpO1xuICAgIGxvb3AuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCBCb29sZWFuKHN0YXRlLmxvb3ApKTtcbiAgICBsb29wLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcoQm9vbGVhbihzdGF0ZS5sb29wKSkpO1xuICAgIGxvb3AudGl0bGUgPSBzdGF0ZS5sb29wID8gXCJMb29wOiBvblwiIDogXCJMb29wOiBvZmZcIjtcblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5zcGVlZCB8fCAxKTtcbiAgICByZW5kZXJUcmFjayhlbCwgc3RhdGUpO1xuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcbiAgICByZXR1cm4gZWw7XG59XG5cbi8vIEdlb21ldHJ5IHNoYXJlZCBieSByZW5kZXJpbmcgYW5kIGRyYWdnaW5nOiB3aGVyZSBhIHRpbWUgc2l0cyBvbiB0aGUgdHJhY2ssIDAuLjEuXG5mdW5jdGlvbiB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0KSB7XG4gICAgY29uc3Qgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdGlja3NbMF07XG4gICAgaWYgKHNwYW4gPD0gMCkgcmV0dXJuIDE7XG4gICAgcmV0dXJuIE1hdGgubWluKDEsIE1hdGgubWF4KDAsICh0IC0gdGlja3NbMF0pIC8gc3BhbikpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJUcmFjayhlbCwgc3RhdGUpIHtcbiAgICBjb25zdCB7IHRpY2tzLCBpbmRleCB9ID0gc3RhdGU7XG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XG4gICAgdHJhY2suX3N0YXRlID0gc3RhdGU7ICAgICAgLy8gdGhlIGRyYWcgaGFuZGxlciByZWFkcyB0aGUgZnJlc2hlc3Qgc3RhdGUgZnJvbSBoZXJlXG5cbiAgICBjb25zdCB0aHVtYlQgPSB0aWNrc1tpbmRleF07XG4gICAgY29uc3QgcGVyaW9kTXMgPSBzdGF0ZS5wZXJpb2RNcztcbiAgICBjb25zdCB3aW5kb3dNcyA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiBudWxsO1xuICAgIGNvbnN0IHNob3duTXMgPSB3aW5kb3dNcyAhPSBudWxsID8gd2luZG93TXMgOiBwZXJpb2RNcztcblxuICAgIC8vIFRoZSBzcGFuOiB3aGF0IGludGVydmFsIHRoZSBtYXAgaXMgc2hvd2luZyByaWdodCBub3cuIFRoZSBzcGFuIGRlcGljdHMgdGhlIHNoYXJlZFxuICAgIC8vIHdpbmRvdyAtLSBvbmUgcGVyaW9kIGJ5IGRlZmF1bHQgLS0gYW5kIHBlci1sYXllciBkdXJhdGlvbnMgcmVtYWluIGFuIEFQSSBjb25jZXJuXG4gICAgLy8gdW50aWwgYSBkcmFnIG92ZXJyaWRlcyB0aGVtIGZvciBldmVyeXRoaW5nIGF0IG9uY2UuXG4gICAgY29uc3Qgc3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGFuXCIpO1xuICAgIGNvbnN0IHJpZ2h0ID0gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUKTtcbiAgICBjb25zdCBsZWZ0ID0gc2hvd25NcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gc2hvd25NcykgOiAwO1xuICAgIHNwYW4uc3R5bGUubGVmdCA9IGAkeyhsZWZ0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHNwYW4uc3R5bGUud2lkdGggPSBgJHsoTWF0aC5tYXgoMCwgcmlnaHQgLSBsZWZ0KSAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICBzcGFuLmNsYXNzTGlzdC50b2dnbGUoXCJvdmVycmlkZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcblxuICAgIC8vIFRoZSB0cmFpbCBoYW5kbGUgcGFya3MgT04gdGhlIHRodW1iIHdoZW4gbm8gb3ZlcnJpZGUgaXMgYWN0aXZlIC0tIFwibm90IGdyYWJiZWRcIiAtLVxuICAgIC8vIGFuZCBzaXRzIGF0IHRoZSB3aW5kb3cncyBzdGFydCB3aGlsZSBvbmUgaXMuIERyb3BwaW5nIGl0IGJhY2sgb24gdGhlIHRodW1iIGNsZWFycy5cbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcbiAgICBjb25zdCBhdCA9IHdpbmRvd01zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSB3aW5kb3dNcykgOiByaWdodDtcbiAgICB0cmFpbC5zdHlsZS5sZWZ0ID0gYCR7KGF0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHRyYWlsLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgd2luZG93TXMgIT0gbnVsbCk7XG4gICAgdHJhaWwuc2V0QXR0cmlidXRlKFwiYXJpYS12YWx1ZXRleHRcIiwgc3RhdGUud2luZG93IHx8IFwibm8gdHJhaWxpbmcgd2luZG93XCIpO1xuICAgIC8vIE5vIGZpeGVkLW1zIGdyaWQgKGNhbGVuZGFyIHBlcmlvZHMpIG1lYW5zIG5vdGhpbmcgc2Vuc2libGUgdG8gc25hcCB0by5cbiAgICB0cmFpbC5zdHlsZS5kaXNwbGF5ID0gc3RhdGUuZ3JpZE1zID8gXCJcIiA6IFwibm9uZVwiO1xuXG4gICAgY29uc3QgcnVsZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcnVsZXJcIik7XG4gICAgY29uc3Qga2V5ID0gYCR7dGlja3NbMF19fCR7dGlja3MubGVuZ3RofXwke3N0YXRlLmdyaWRNc318JHtwZXJpb2RNc31gO1xuICAgIGlmIChydWxlci5fa2V5ICE9PSBrZXkpIHtcbiAgICAgICAgcnVsZXIuX2tleSA9IGtleTtcbiAgICAgICAgcnVsZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICAgICAgZm9yIChjb25zdCBtYXJrIG9mIGJ1aWxkUnVsZXIodGlja3MsIHN0YXRlLmdyaWRNcywgdCA9PiBmb3JtYXRUaWNrTGFiZWwodCwgcGVyaW9kTXMpKSkge1xuICAgICAgICAgICAgY29uc3QgbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgbS5jbGFzc05hbWUgPSBtYXJrLm1ham9yID8gXCJzd2lmdG1hcC10aW1lLW1hcmsgbWFqb3JcIiA6IFwic3dpZnRtYXAtdGltZS1tYXJrXCI7XG4gICAgICAgICAgICBtLnN0eWxlLmxlZnQgPSBgJHsobWFyay5mcmFjdGlvbiAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICAgICAgICAgIGlmIChtYXJrLmxhYmVsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICAgICAgbGFiLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1tYXJrLWxhYmVsXCI7XG4gICAgICAgICAgICAgICAgbGFiLnRleHRDb250ZW50ID0gbWFyay5sYWJlbDtcbiAgICAgICAgICAgICAgICBtLmFwcGVuZENoaWxkKGxhYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBydWxlci5hcHBlbmRDaGlsZChtKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gRHJhZ2dpbmcgdGhlIHRyYWlsIGhhbmRsZS4gU25hcHMgdG8gdGhlIGdjZCBncmlkIHNvIGV2ZXJ5IHN0b3AgaXMgYSBib3VuZGFyeSB0aGUgZGF0YVxuLy8gb3IgdGhlIGludGVydmFsIGFjdHVhbGx5IG5hbWVzOyB0aGUgZGlzdGFuY2UgdG8gdGhlIHRodW1iLCBpbiB3aG9sZSBncmlkIHN0ZXBzLCBJUyB0aGVcbi8vIHdpbmRvdy4gWmVybyBzdGVwcyAtLSBkcm9wcGVkIG9uIHRoZSB0aHVtYiAtLSBjbGVhcnMgdGhlIG92ZXJyaWRlLlxuZnVuY3Rpb24gYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycykge1xuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xuXG4gICAgZnVuY3Rpb24gaXNvRnJvbUV2ZW50KGV2KSB7XG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xuICAgICAgICBjb25zdCByZWN0ID0gdHJhY2suZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcyB8fCByZWN0LndpZHRoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdW5jbGFtcGVkIG9uIHRoZSBsZWZ0OiB0aGUgd2luZG93IGlzIFwiaG93IGZhciBiYWNrIGZyb20gdGhlXG4gICAgICAgIC8vIGxlYWQgcG9pbnRcIiwgYW5kIHRoYXQgbWF5IHJlYWNoIHBhc3QgdGhlIGJhcidzIHN0YXJ0IC0tIGVzcGVjaWFsbHkgd2hlbiB0aGVcbiAgICAgICAgLy8gbGVhZCBzaXRzIGVhcmx5IG9uIHRoZSBiYXIgYW5kIG1vc3Qgb2YgaXRzIHRyYWlsIGlzIG9mZi1zY3JlZW4uIENsYW1waW5nIGhlcmVcbiAgICAgICAgLy8gY2FwcGVkIHRoZSB3aW5kb3cgYXQgdGhlIHZpc2libGUgcGFzdCwgd2hpY2ggcGlubmVkIHRoZSBoYW5kbGUgdG8gdGhlIGJhcidzXG4gICAgICAgIC8vIHN0YXJ0IGFuZCBtYWRlIGFueXRoaW5nIHdpZGVyIGltcG9zc2libGUgdG8gc2V0LiBPbmx5IHRoZSBEUkFXSU5HIGNsYW1wcy5cbiAgICAgICAgY29uc3QgZnJhYyA9IE1hdGgubWluKDEsIChldi5jbGllbnRYIC0gcmVjdC5sZWZ0KSAvIHJlY3Qud2lkdGgpO1xuICAgICAgICBjb25zdCB0MCA9IHN0YXRlLnRpY2tzWzBdO1xuICAgICAgICBjb25zdCBzcGFuTXMgPSBzdGF0ZS50aWNrc1tzdGF0ZS50aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xuICAgICAgICBjb25zdCB0aHVtYlQgPSBzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF07XG4gICAgICAgIGNvbnN0IGRpc3QgPSB0aHVtYlQgLSAodDAgKyBmcmFjICogc3Bhbk1zKTtcbiAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGRpc3QgLyBzdGF0ZS5ncmlkTXMpKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBzID09PSAwID8gbnVsbCA6IG1zVG9QZXJpb2RJU08oc3RlcHMgKiBzdGF0ZS5ncmlkTXMpO1xuICAgIH1cblxuICAgIC8vIE1vdmUgYW5kIHJlbGVhc2UgbGlzdGVuIG9uIHRoZSBkb2N1bWVudCBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBkcmFnOiB0aGUgaGFuZGxlXG4gICAgLy8gaXMgMTJweCB3aWRlLCB0aGUgY3Vyc29yIGxlYXZlcyBpdCBvbiB0aGUgZmlyc3QgZmFzdCBtb3ZlbWVudCwgYW5kIGV2ZW50cyB0aGF0XG4gICAgLy8gdGFyZ2V0IHdoYXRldmVyIGlzIHVuZGVybmVhdGggd291bGQgc3R1dHRlciB0aGUgZHJhZyBhbmQgY291bGQgc3dhbGxvdyB0aGUgcmVsZWFzZVxuICAgIC8vIGVudGlyZWx5IC0tIGFuIHVuY29tbWl0dGVkIGRyYWcgdGhlbiBzbmFwcyBiYWNrIG9uIHRoZSBuZXh0IHN5bmMuXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIC8vIENhcHR1cmUgcmV0YXJnZXRzIGV2ZXJ5IHBvaW50ZXIgZXZlbnQgdG8gdGhlIGhhbmRsZSB1bnRpbCByZWxlYXNlLCBubyBtYXR0ZXJcbiAgICAgICAgLy8gd2hlcmUgdGhlIGN1cnNvciBpcy4gV2l0aG91dCBpdCwgbGV0dGluZyBnbyB3aXRoIHRoZSBwb2ludGVyIG92ZXIgdGhlIG1hcCBoYW5kc1xuICAgICAgICAvLyBwb2ludGVydXAgdG8gTGVhZmxldCdzIGNvbnRhaW5lciBoYW5kbGVycywgYW5kIGEgcmVsZWFzZSB0aGV5IHN3YWxsb3cgbmV2ZXJcbiAgICAgICAgLy8gcmVhY2hlcyB0aGUgZG9jdW1lbnQgbGlzdGVuZXIgLS0gdGhlIGRyYWcgc3RheXMgdW5jb21taXR0ZWQgYW5kIHRoZSBuZXh0IHN5bmNcbiAgICAgICAgLy8gc25hcHMgdGhlIGhhbmRsZSBob21lLiBUaGUgZG9jdW1lbnQgbGlzdGVuZXJzIGJlbG93IHJlbWFpbiBhcyB0aGUgZmFsbGJhY2sgZm9yXG4gICAgICAgIC8vIGVudmlyb25tZW50cyB3aXRob3V0IGNhcHR1cmU7IHdpdGggaXQsIHJldGFyZ2V0ZWQgZXZlbnRzIHN0aWxsIGJ1YmJsZSB0byB0aGVtLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKSB0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZShldi5wb2ludGVySWQpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogc3ludGhldGljIGV2ZW50cyBoYXZlIG5vIGFjdGl2ZSBwb2ludGVyOyBmYWxsIGJhY2sgdG8gYnViYmxpbmcgKi8gfVxuXG4gICAgICAgIGNvbnN0IG1vdmUgPSBlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGZpbmlzaCA9IGUgPT4ge1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dDb21taXQoaXNvKTtcbiAgICAgICAgfTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XG4gICAgfSk7XG5cbiAgICAvLyBLZXlib2FyZDogb25lIGdyaWQgc3RlcCBwZXIgYXJyb3csIERlbGV0ZS9Ib21lIHRvIGNsZWFyLiBTYW1lIGNvbnRyYWN0IGFzIHRoZSBkcmFnLlxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcykgcmV0dXJuO1xuICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IDA7XG4gICAgICAgIGxldCBuZXh0O1xuICAgICAgICBpZiAoZXYua2V5ID09PSBcIkFycm93TGVmdFwiKSBuZXh0ID0gY3VycmVudCArIHN0YXRlLmdyaWRNcztcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkFycm93UmlnaHRcIikgbmV4dCA9IE1hdGgubWF4KDAsIGN1cnJlbnQgLSBzdGF0ZS5ncmlkTXMpO1xuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiRGVsZXRlXCIgfHwgZXYua2V5ID09PSBcIkhvbWVcIikgbmV4dCA9IDA7XG4gICAgICAgIGVsc2UgcmV0dXJuO1xuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChuZXh0ID4gMCA/IG1zVG9QZXJpb2RJU08obmV4dCkgOiBudWxsKTtcbiAgICB9KTtcbn1cbiIsICIvLyBUaW1lIGZpbHRlcmluZyBvbiB0aGUgR1BVLCBmb3IgcG9pbnQgbGF5ZXJzLlxuLy9cbi8vIFRoZSBjb29yZGluYXRlcyBhbHJlYWR5IGxpdmUgaW4gR1BVIGJ1ZmZlcnM7IHJlYnVpbGRpbmcgdGhlIG1lcmdlZCBsYXllciBwZXIgdGljayB0aHJld1xuLy8gdGhhdCBhd2F5IGFuZCByZS1mZWQgZ2xpZnkgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTIC0tIG1lYXN1cmVkIGF0IH4yLjZzIHBlciB3aW5kb3dcbi8vIGNoYW5nZSBhdCB0aGF0IHNjYWxlLCB3aXRoIGFsbG9jYXRpb24gY2h1cm4gdGhhdCBjb3VsZCBjcmFzaCB0aGUgdGFiIHdoZW4gY2hhbmdlc1xuLy8gc3RhY2tlZC4gSW5zdGVhZCwgZWFjaCBwb2ludCdzIHRpbWUgaW50ZXJ2YWwgYW5kIGl0cyBsYXllcidzIGR1cmF0aW9uIHJpZGUgYWxvbmcgYXNcbi8vIHZlcnRleCBhdHRyaWJ1dGVzIHVwbG9hZGVkIG9uY2UsIGFuZCB0aGUgY3VycmVudCB0aWNrIGlzIGEgdW5pZm9ybTogYSB0aWNrIG9yIHdpbmRvd1xuLy8gY2hhbmdlIGNvc3RzIHR3byBmbG9hdHMgYW5kIGEgcmVkcmF3LlxuLy9cbi8vIGdsaWZ5IG1ha2VzIHRoaXMgcG9zc2libGUgd2l0aG91dCBmb3JraW5nIGl0OiB2ZXJ0ZXhTaGFkZXJTb3VyY2UgaXMgYW4gb3ZlcnJpZGFibGVcbi8vIHNldHRpbmcgKHRoZSBwaW4gZnJhZ21lbnQgc2hhZGVyIGFscmVhZHkgdXNlcyB0aGUgc2FtZSBkb29yKSwgaW5zdGFuY2VzIGV4cG9zZSB0aGVpclxuLy8gZ2wvcHJvZ3JhbS9jYW52YXMsIGF0dHJpYnV0ZXMgYXJlIGJvdW5kIG9uY2UgYXQgc2V0dXAsIGFuZCB0aGUgcGVyLWZyYW1lIGRyYXcgdG91Y2hlc1xuLy8gb25seSB0aGUgbWF0cml4IHVuaWZvcm0gLS0gc28gZXh0cmEgYXR0cmlidXRlcyBib3VuZCBhZnRlciBzZXR1cCBwZXJzaXN0LCBhbmQgdW5pZm9ybVxuLy8gdXBkYXRlcyB0YWtlIGVmZmVjdCBvbiB0aGUgbmV4dCByZWRyYXcuXG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgcGVyaW9kVG9NcywgdGltZXNGb3IgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgZmxvYXQzMiBvbiB0aGUgR1BVLCB3aG9zZSBpbnRlZ2VycyBhcmUgZXhhY3Qgb25seSB0byAyXjI0LiBFcG9jaCBtcyBpc1xuLy8gaG9wZWxlc3MgYXQgdGhhdCBwcmVjaXNpb24sIHNvIHRpbWVzIGFyZSByZWJhc2VkIHRvIHRoZSBidWNrZXQncyBlYXJsaWVzdCBzdGFydCBhbmRcbi8vIGV4cHJlc3NlZCBpbiBzZWNvbmRzOiBleGFjdCB0byB+MTk0IGRheXMgb2Ygc3BhbiwgYW5kIGEgMnMgcm91bmRpbmcgYmV5b25kIHRoYXQgaXNcbi8vIGludmlzaWJsZSBhdCBhbnkgem9vbSBhIHRpbWUgc2xpZGVyIG1ha2VzIHNlbnNlIGF0LlxuY29uc3QgQUxXQVlTID0gNi4zZTg7ICAgLy8gfjIwIHllYXJzLCBpbiBzZWNvbmRzOiB0aGUgXCJkdXJhdGlvblwiIG9mIGN1bXVsYXRpdmUgbGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHRoZSBzcGFuIGhhbGYtd2lkdGggb2YgcG9pbnRzIHdpdGggbm8gcmVhZGFibGUgdGltZS5cblxuLy8gUGVyLWJ1Y2tldCBsYXllci12aXNpYmlsaXR5IHNsb3RzIGluIHRoZSB2ZXJ0ZXggc2hhZGVyLiBFYWNoIGZsb2F0IGFycmF5IGVsZW1lbnRcbi8vIG9jY3VwaWVzIGEgZnVsbCB1bmlmb3JtIHZlY3RvciBpbiBFUyBHTFNMIHBhY2tpbmcsIGFuZCB0aGUgc3BlYyBndWFyYW50ZWVzIG9ubHkgMTI4XG4vLyB2ZXJ0ZXggdW5pZm9ybSB2ZWN0b3JzIC0tIDY0IHNsb3RzIGxlYXZlcyBjb21mb3J0YWJsZSByb29tIGZvciB0aGUgbWF0cml4IGFuZCB0aGUgdGltZVxuLy8gdW5pZm9ybXMuIEEgYnVja2V0IHdpdGggbW9yZSBsYXllcnMgdGhhbiBzbG90cyBmYWxscyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRvZ2dsZS5cbi8vIChQYWNraW5nIGZvdXIgbGF5ZXJzIHBlciB2ZWM0IHdvdWxkIHF1YWRydXBsZSB0aGlzIGlmIGFueW9uZSBldmVyIG5lZWRzIGl0LilcbmV4cG9ydCBjb25zdCBMQVlFUl9TTE9UUyA9IDY0O1xuXG4vLyBDaGVhcCBraWxsIHN3aXRjaGVzOiBpZiB3aXJpbmcgdGhlIEdMIHN0YXRlIGV2ZXIgZmFpbHMgKGEgZnV0dXJlIGdsaWZ5IHZlcnNpb24gbW92aW5nXG4vLyBpdHMgaW50ZXJuYWxzKSwgdGhlIGFmZmVjdGVkIGZhbWlseSBmYWxscyBiYWNrIHRvIHRoZSBDUFUgcmVidWlsZCBwYXRoLiBQb2ludHMgYW5kXG4vLyB2ZWN0b3JzIGFyZSBzZXBhcmF0ZSBmbGFncyAtLSBhIHZlY3RvciBpbnRyb3NwZWN0aW9uIGZhaWx1cmUgbXVzdCBub3QgY29zdCBwb2ludHNcbi8vIHRoZWlyIEdQVSBwYXRoLlxubGV0IGdwdU9rID0gdHJ1ZTtcbmV4cG9ydCBmdW5jdGlvbiBncHVUaW1lQXZhaWxhYmxlKCkgeyByZXR1cm4gZ3B1T2s7IH1cbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlR3B1VGltZShyZWFzb24pIHtcbiAgICBpZiAoZ3B1T2spIGNvbnNvbGUud2FybihgW1N3aWZ0TWFwXSBHUFUgdGltZSBmaWx0ZXJpbmcgZGlzYWJsZWQ6ICR7cmVhc29ufS4gYCArXG4gICAgICAgIGBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljay5gKTtcbiAgICBncHVPayA9IGZhbHNlO1xufVxubGV0IHZlY3RvckdwdU9rID0gdHJ1ZTtcbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JHcHVBdmFpbGFibGUoKSB7IHJldHVybiB2ZWN0b3JHcHVPazsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpc2FibGVWZWN0b3JHcHUocmVhc29uKSB7XG4gICAgaWYgKHZlY3RvckdwdU9rKSBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gR1BVIHRpbWUgZm9yIGxpbmVzL3BvbHlnb25zIGRpc2FibGVkOiBgICtcbiAgICAgICAgYCR7cmVhc29ufS4gRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2sgZm9yIHRob3NlIGJ1Y2tldHMuYCk7XG4gICAgdmVjdG9yR3B1T2sgPSBmYWxzZTtcbn1cblxuLy8gVGhlIGRlZmF1bHQgcG9pbnRzIHZlcnRleCBzaGFkZXIgKHJlYWQgb3V0IG9mIGxlYWZsZXQuZ2xpZnkgMy4zLjApIHdpdGggdGhlIHdpbmRvd1xuLy8gdGVzdCBhZGRlZC4gQSBoaWRkZW4gcG9pbnQgZ2V0cyBzaXplIDAgYW5kIGEgcG9zaXRpb24gb3V0c2lkZSBjbGlwIHNwYWNlLCBzbyBuZWl0aGVyXG4vLyB0aGUgdmlzaWJsZSBwYXNzIG5vciB0aGUgc2hhcmVkLXByb2dyYW0gcGlja2luZyBwYXNzIGV2ZXIgcmFzdGVyaXNlcyBpdC5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lVmVydGV4U2hhZGVyKCkge1xuICAgIHJldHVybiBgdW5pZm9ybSBtYXQ0IG1hdHJpeDtcbmF0dHJpYnV0ZSB2ZWM0IHZlcnRleDtcbmF0dHJpYnV0ZSB2ZWM0IGNvbG9yO1xuYXR0cmlidXRlIGZsb2F0IHBvaW50U2l6ZTtcbmF0dHJpYnV0ZSB2ZWMyIGFUaW1lU3BhbjtcbmF0dHJpYnV0ZSBmbG9hdCBhRHVyYXRpb247XG5hdHRyaWJ1dGUgZmxvYXQgYUxheWVyO1xudW5pZm9ybSBmbG9hdCB1VGljaztcbnVuaWZvcm0gZmxvYXQgdU92ZXJyaWRlO1xudW5pZm9ybSBmbG9hdCB1TGF5ZXJWaXNbJHtMQVlFUl9TTE9UU31dO1xudmFyeWluZyB2ZWM0IF9jb2xvcjtcblxudm9pZCBtYWluKCkge1xuICAvLyBBIG5lZ2F0aXZlIGR1cmF0aW9uIGlzIHRoZSBmYWRlIGZsYWc6IHxhRHVyYXRpb258IGlzIHRoZSB3aW5kb3csIHRoZSBzaWduIHNheXMgdGhpc1xuICAvLyBwb2ludCBkaW1zIHdpdGggYWdlLiBBIHNoYXJlZCBvdmVycmlkZSBrZWVwcyB0aGUgcG9pbnQncyBvd24gZmFkZSBwcmVmZXJlbmNlLlxuICBib29sIGZhZGVzID0gYUR1cmF0aW9uIDwgMC4wO1xuICBmbG9hdCBkdXIgPSB1T3ZlcnJpZGUgPj0gMC4wID8gdU92ZXJyaWRlIDogYWJzKGFEdXJhdGlvbik7XG4gIC8vIEhhbGYtb3BlbiAodGljayAtIGR1ciwgdGlja10sIG1hdGNoaW5nIGZlYXR1cmVJbldpbmRvdyBvbiB0aGUgQ1BVIHNpZGUgLS0gQU5EZWQgd2l0aFxuICAvLyB0aGUgcG9pbnQncyBsYXllciBiZWluZyB2aXNpYmxlLiBMYXllciB0b2dnbGVzIGFyZSBvbmUgdW5pZm9ybSBlbGVtZW50LCBub3QgYVxuICAvLyByZWJ1aWxkOiB1bmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZS1mZWVkIGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUy5cbiAgYm9vbCB2aXNpYmxlID0gYVRpbWVTcGFuLnkgPiAodVRpY2sgLSBkdXIpICYmIGFUaW1lU3Bhbi54IDw9IHVUaWNrXG4gICAgICAmJiB1TGF5ZXJWaXNbaW50KGFMYXllcildID4gMC41O1xuICBnbF9Qb2ludFNpemUgPSB2aXNpYmxlID8gcG9pbnRTaXplIDogMC4wO1xuICBnbF9Qb3NpdGlvbiA9IHZpc2libGUgPyBtYXRyaXggKiB2ZXJ0ZXggOiB2ZWM0KDIuMCwgMi4wLCAyLjAsIDEuMCk7XG4gIC8vIEFnZSBydW5zIGZyb20gdGhlIGZlYXR1cmUncyBlbmQ7IG5ld2VzdCBpcyBvcGFxdWUsIHRoZSB0cmFpbGluZyBlZGdlIHJlYWNoZXMgemVyby5cbiAgZmxvYXQgYWxwaGEgPSBmYWRlcyA/IGNsYW1wKDEuMCAtICh1VGljayAtIGFUaW1lU3Bhbi55KSAvIGR1ciwgMC4wLCAxLjApIDogMS4wO1xuICBfY29sb3IgPSB2ZWM0KGNvbG9yLnJnYiwgY29sb3IuYSAqIGFscGhhKTtcbn1cbmA7XG59XG5cbi8vIFBlci1sYXllciBkdXJhdGlvbiBpbiBzZWNvbmRzOiBudWxsIGFjY3VtdWxhdGVzLCBcInBlcmlvZFwiIGlzIHRoZSBzaGFyZWQgaW50ZXJ2YWwsXG4vLyBhbiBJU08gc3RyaW5nIGlzIGl0c2VsZjsgYW55dGhpbmcgdW5wYXJzZWFibGUgZmFsbHMgYmFjayB0byB0aGUgaW50ZXJ2YWwuXG5mdW5jdGlvbiBkdXJhdGlvblNlY29uZHMoc3BlYywgcGVyaW9kTXMpIHtcbiAgICBpZiAoc3BlYyA9PT0gbnVsbCB8fCBzcGVjID09PSB1bmRlZmluZWQpIHJldHVybiBBTFdBWVM7XG4gICAgaWYgKHNwZWMgPT09IFwicGVyaW9kXCIpIHJldHVybiAocGVyaW9kTXMgfHwgMjQgKiAzNjAwICogMTAwMCkgLyAxMDAwO1xuICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzcGVjKSk7XG4gICAgcmV0dXJuIG1zID8gbXMgLyAxMDAwIDogKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcbn1cblxuLy8gQnVpbGRzIHRoZSBwZXItcG9pbnQgYXR0cmlidXRlIGFycmF5cyBmb3Igb25lIG1lcmdlZCBidWNrZXQsIGluIHRoZSBleGFjdCBvcmRlciB0aGVcbi8vIGJ1Y2tldCBmZWVkcyBwb2ludHMgdG8gZ2xpZnk6IGxheWVyIGJ5IGxheWVyLCBpbmRleCAwLi5uLTEsIHdpdGggc2luZ2xlLWBsb2NhdGlvbmBcbi8vIGxheWVycyBjb250cmlidXRpbmcgb25lIHBvaW50LiBQb2ludHMgaW4gbGF5ZXJzIHdpdGhvdXQgdGltZSBtZXRhZGF0YSAtLSBhbmQgcG9pbnRzXG4vLyB3aG9zZSB0aW1lIHdhcyB1bnJlYWRhYmxlIChOYU4pIC0tIGdldCBhIHNwYW4gdGhhdCBpcyB2aXNpYmxlIGF0IGV2ZXJ5IHRpY2suXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRUaW1lQXR0cmlidXRlcyhsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcbiAgICBsZXQgdG90YWwgPSAwO1xuICAgIGxldCBoYXNUaW1lID0gZmFsc2U7XG4gICAgY29uc3QgcGVyTGF5ZXIgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICBjb25zdCBjb3VudCA9IGJ1ZiA/IGJ1Zi5ieXRlTGVuZ3RoIC8gMTYgOiAobGF5ZXIubG9jYXRpb24gPyAxIDogMCk7XG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xuICAgICAgICBpZiAobGF5ZXIudGltZSkgaGFzVGltZSA9IHRydWU7XG4gICAgICAgIHBlckxheWVyLnB1c2goeyBsYXllciwgY291bnQsIHRpbWVzIH0pO1xuICAgICAgICB0b3RhbCArPSBjb3VudDtcbiAgICB9XG4gICAgaWYgKCFoYXNUaW1lKSByZXR1cm4geyBoYXNUaW1lOiBmYWxzZSB9O1xuXG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IHsgdGltZXMgfSBvZiBwZXJMYXllcikge1xuICAgICAgICBpZiAoIXRpbWVzKSBjb250aW51ZTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4odGltZXNbaV0pICYmIHRpbWVzW2ldIDwgYmFzZSkgYmFzZSA9IHRpbWVzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChiYXNlID09PSBJbmZpbml0eSkgYmFzZSA9IDA7XG5cbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcbiAgICBjb25zdCBkdXJzID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcbiAgICBjb25zdCBsYXllcklkcyA9IFtdO1xuICAgIGxldCBvdXQgPSAwO1xuICAgIGZvciAoY29uc3QgeyBsYXllciwgY291bnQsIHRpbWVzIH0gb2YgcGVyTGF5ZXIpIHtcbiAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJJZHMubGVuZ3RoO1xuICAgICAgICBsYXllcklkcy5wdXNoKGxheWVyLmlkKTtcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XG4gICAgICAgIC8vIFRoZSBmYWRlIGZsYWcgcmlkZXMgdGhlIGR1cmF0aW9uJ3Mgc2lnbiwgc28gaXQgY29zdHMgbm8gZXh0cmEgYXR0cmlidXRlLlxuICAgICAgICAvLyBUaW1lbGVzcyAoTmFOKSBwb2ludHMga2VlcCBhIHBvc2l0aXZlIGR1cmF0aW9uOiB3aXRoIG5vIGFnZSwgbm90aGluZyB0byBmYWRlLlxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyXSA6IE5hTjtcbiAgICAgICAgICAgIGNvbnN0IGVuZCA9IHRpbWVzID8gdGltZXNbaSAqIDIgKyAxXSA6IE5hTjtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpKSB7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSAtQUxXQVlTO1xuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IEFMV0FZUztcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBBTFdBWVM7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gKHN0YXJ0IC0gYmFzZSkgLyAxMDAwO1xuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IChlbmQgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgZHVyc1tvdXRdID0gc2lnbmVkRHVyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGlkeDtcbiAgICAgICAgICAgIG91dCsrO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IGhhc1RpbWU6IHRydWUsIGJhc2UsIHNwYW5zLCBkdXJzLCBsYXllcklkeCwgbGF5ZXJJZHMsIGNvdW50OiB0b3RhbCB9O1xufVxuXG4vLyBQZXItZmVhdHVyZSB0aW1lIG1ldGFkYXRhIGZvciBhIHZlY3RvciBidWNrZXQgKGxpbmVzL3BvbHlnb25zKS4gU2FtZSBlbmNvZGluZ3MgYXNcbi8vIHRoZSBwb2ludCBwYXRoIC0tIHJlYmFzZWQgZmxvYXQzMiBzZWNvbmRzLCBzaWduLXBhY2tlZCBmYWRlLCBhbHdheXMtdmlzaWJsZSBzcGFuc1xuLy8gZm9yIHRpbWVsZXNzIG9yIG5vbi10aW1lIGxheWVycy5cbi8vXG4vLyBBIHBvbHlsaW5lIHdob3NlIDo6dGltZXMgYnVmZmVyIGhvbGRzIG9uZSBbc3RhcnQsIGVuZF0gcGFpciBQRVIgVkVSVEVYIGFuaW1hdGVzXG4vLyBwZXIgc2VnbWVudCB3aXRoaW4gb25lIGxheWVyOiBzZWdtZW50IGsgc3BhbnMgdmVydGV4IGsncyBzdGFydCB0byB2ZXJ0ZXggaysxJ3Ncbi8vIGVuZCwgYW5kIGJlY2F1c2UgZ2xpZnkgYnVpbGRzIDIgZGVkaWNhdGVkIEdMIHZlcnRpY2VzIHBlciBzZWdtZW50IC0tIHNlZ21lbnRzXG4vLyBuZXZlciBzaGFyZSB2ZXJ0aWNlcyAtLSBib3RoIGVuZHBvaW50cyBjYXJyeSB0aGUgc2FtZSBzcGFuIGFuZCBzZWdtZW50cyBhcHBlYXJcbi8vIGF0b21pY2FsbHkuIFRoYXQgaXMgd2hhdCBsZXRzIGEgd2hvbGUgc2VnbWVudGVkIHRyYWNrIHJpZGUgT05FIGxheWVyIHNsb3QgdGhlIHdheVxuLy8gYSAyMDBrLXBvaW50IGxheWVyIGRvZXMsIGluc3RlYWQgb2Ygb25lIHNsb3QgcGVyIGNodW5rIGFnYWluc3QgdGhlIDY0IGNlaWxpbmcuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZWN0b3JUaW1lTWV0YShsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG4gICAgICAgIGlmICghdGltZXMpIGNvbnRpbnVlO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcblxuICAgIGNvbnN0IHBlckZlYXR1cmUgPSBsYXllcnNMaXN0Lm1hcCgobGF5ZXIsIGlkeCkgPT4ge1xuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcbiAgICAgICAgaWYgKCF0aW1lcyB8fCAodGltZXMubGVuZ3RoID09PSAyICYmIE51bWJlci5pc05hTih0aW1lc1swXSkpKSB7XG4gICAgICAgICAgICByZXR1cm4geyBzdGFydDogLUFMV0FZUywgZW5kOiBBTFdBWVMsIGR1cjogQUxXQVlTLCBpZHggfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBuVmVydHMgPSB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlsaW5lXCIgJiYgdGltZXMubGVuZ3RoID4gMlxuICAgICAgICAgICAgICAgICYmIHRpbWVzLmxlbmd0aCA9PT0gblZlcnRzICogMikge1xuICAgICAgICAgICAgY29uc3Qgc2VncyA9IG5WZXJ0cyAtIDE7XG4gICAgICAgICAgICBjb25zdCBzZWcgPSBuZXcgRmxvYXQ2NEFycmF5KHNlZ3MgKiAyKTtcbiAgICAgICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgc2VnczsgaysrKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcyA9IHRpbWVzW2sgKiAyXTtcbiAgICAgICAgICAgICAgICBjb25zdCBlID0gdGltZXNbKGsgKyAxKSAqIDIgKyAxXTtcbiAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHMpIHx8IE51bWJlci5pc05hTihlKSkge1xuICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gLUFMV0FZUzsgICAgICAvLyBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YVxuICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDIgKyAxXSA9IEFMV0FZUztcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gKHMgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gKGUgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gT3ZlcmFsbCBzcGFuIHJpZGVzIGFsb25nIGFzIHRoZSBmYWxsYmFjayBpZiBjb3VudHMgZXZlciBtaXNhbGlnbi5cbiAgICAgICAgICAgIHJldHVybiB7IHNlZywgc3RhcnQ6IHNlZ1swXSwgZW5kOiBzZWdbc2VnLmxlbmd0aCAtIDFdLFxuICAgICAgICAgICAgICAgICAgICAgZHVyOiBzaWduZWREdXIsIGlkeCB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAodGltZXNbMF0gLSBiYXNlKSAvIDEwMDAsIGVuZDogKHRpbWVzWzFdIC0gYmFzZSkgLyAxMDAwLFxuICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XG4gICAgfSk7XG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgcGVyRmVhdHVyZSwgbGF5ZXJJZHM6IGxheWVyc0xpc3QubWFwKGwgPT4gbC5pZCkgfTtcbn1cblxuLy8gQSB2ZWN0b3IgbGF5ZXIncyB2ZXJ0ZXggY291bnQgZnJvbSB3aGljaGV2ZXIgdHJhbnNwb3J0IGNhcnJpZXMgaXRzIGNvb3JkaW5hdGVzOlxuLy8gdGhlIGJpbmFyeSBidWZmZXIgKDIgZmxvYXQ2NCBwZXIgdmVydGV4KSBvciBpbmxpbmUgYGxvY2F0aW9uc2AuXG5mdW5jdGlvbiB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcbiAgICBpZiAocmF3KSByZXR1cm4gKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGggfHwgMCkgLyAxNjtcbiAgICByZXR1cm4gKGxheWVyLmxvY2F0aW9ucyB8fCBbXSkubGVuZ3RoO1xufVxuXG4vLyBFeHBhbmRzIHBlci1mZWF0dXJlIHZhbHVlcyB0byBwZXItR0wtdmVydGV4IGFycmF5cyBnaXZlbiBlYWNoIGZlYXR1cmUncyB2ZXJ0ZXggY291bnQuXG4vLyBQdXJlLCBzbyB0aGUgYWxpZ25tZW50IGxvZ2ljIGlzIHRpZXItMSB0ZXN0YWJsZSBhd2F5IGZyb20gYW55IEdMIGNvbnRleHQuXG5leHBvcnQgZnVuY3Rpb24gZXhwYW5kUGVyRmVhdHVyZShwZXJGZWF0dXJlLCBjb3VudHMpIHtcbiAgICBsZXQgdG90YWwgPSAwO1xuICAgIGZvciAoY29uc3QgYyBvZiBjb3VudHMpIHRvdGFsICs9IGM7XG4gICAgY29uc3Qgc3BhbnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsICogMik7XG4gICAgY29uc3QgZHVycyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XG4gICAgbGV0IG91dCA9IDA7XG4gICAgcGVyRmVhdHVyZS5mb3JFYWNoKChmLCBpKSA9PiB7XG4gICAgICAgIC8vIFBlci1zZWdtZW50IHNwYW5zOiBHTCB2ZXJ0ZXggdiBiZWxvbmdzIHRvIHNlZ21lbnQgdiA+PiAxIChnbGlmeSBkcmF3c1xuICAgICAgICAvLyAyIGRlZGljYXRlZCB2ZXJ0aWNlcyBwZXIgc2VnbWVudCksIHNvIGJvdGggZW5kcG9pbnRzIHRha2UgdGhlIHNlZ21lbnQnc1xuICAgICAgICAvLyBzcGFuIGFuZCBhIHNlZ21lbnQgYXBwZWFycyBvciBkaXNhcHBlYXJzIGF0b21pY2FsbHkuIHNlZyBob2xkcyBzZWdzKjJcbiAgICAgICAgLy8gZmxvYXRzIGFuZCB0aGUgZmVhdHVyZSBkcmF3cyBzZWdzKjIgR0wgdmVydGljZXMsIHNvIHRoZSBsZW5ndGhzIGFncmVlaW5nXG4gICAgICAgIC8vIGlzIHRoZSBhbGlnbm1lbnQgY2hlY2s7IGEgbWlzbWF0Y2ggZmFsbHMgYmFjayB0byB0aGUgd2hvbGUtZmVhdHVyZSBzcGFuXG4gICAgICAgIC8vIHJhdGhlciB0aGFuIHNoZWFyaW5nIGV2ZXJ5IGF0dHJpYnV0ZSBhZnRlciBpdC5cbiAgICAgICAgY29uc3QgcGVyU2VnbWVudCA9IGYuc2VnICYmIGYuc2VnLmxlbmd0aCA9PT0gY291bnRzW2ldID8gZi5zZWcgOiBudWxsO1xuICAgICAgICBmb3IgKGxldCB2ID0gMDsgdiA8IGNvdW50c1tpXTsgdisrKSB7XG4gICAgICAgICAgICBjb25zdCBrID0gcGVyU2VnbWVudCA/ICh2ID4+IDEpICogMiA6IC0xO1xuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrXSA6IGYuc3RhcnQ7XG4gICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrICsgMV0gOiBmLmVuZDtcbiAgICAgICAgICAgIGR1cnNbb3V0XSA9IGYuZHVyO1xuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGYuaWR4O1xuICAgICAgICAgICAgb3V0Kys7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4geyBzcGFucywgZHVycywgbGF5ZXJJZHggfTtcbn1cblxuLy8gZ2xpZnkncyB2ZXJ0ZXggbGF5b3V0OiA2IGZsb2F0cyBwZXIgR0wgdmVydGV4ICh4LCB5LCByLCBnLCBiLCBhKSwgY29uZmlybWVkIGZvciAzLjMuMFxuLy8gYm90aCBieSByZWFkaW5nIHRoZSBzb3VyY2UgYW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgcmVwb3J0J3MgZGVidWcgZHVtcCAtLSB0d29cbi8vIG9uZS1zZWdtZW50IGxpbmVzIHByb2R1Y2VkIGFsbFZlcnRpY2VzVHlwZWQgb2YgMjQgZmxvYXRzOiAyIGZlYXR1cmVzIHggMiB2ZXJ0aWNlcyB4IDYuXG5jb25zdCBGTE9BVFNfUEVSX1ZFUlRFWCA9IDY7XG5cbi8vIFdpcmVzIHRpbWUgKyBsYXllci12aXNpYmlsaXR5IGludG8gYSBsaXZlIGdsaWZ5IExJTkVTIG9yIFNIQVBFUyBpbnN0YW5jZS4gVGhlIGNhbGxlclxuLy8gc3VwcGxpZXMgcGVyLWZlYXR1cmUgR0wtdmVydGV4IGNvdW50cyBjb21wdXRlZCBmcm9tIHRoZSBnZW9tZXRyeSBpdCBidWlsdCBpdHNlbGY6XG4vLyBsaW5lcyBkcmF3IDIqKHBvaW50cy0xKSB2ZXJ0aWNlcyBwZXIgZmVhdHVyZSwgYW5kIGFueSB0cmlhbmd1bGF0aW9uIG9mIGEgc2ltcGxlIHJpbmdcbi8vIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3MgZWFyY3V0LiBUaGUgY291bnRzXG4vLyBhcmUgdmFsaWRhdGVkIGFnYWluc3QgdGhlIGluc3RhbmNlJ3MgYWN0dWFsIGJ1ZmZlciBsZW5ndGgsIGFuZCBhbnkgbWlzbWF0Y2ggZGlzYWJsZXNcbi8vIHRoZSB2ZWN0b3IgR1BVIHBhdGggcmF0aGVyIHRoYW4gbWlzLWFsaWduaW5nIGF0dHJpYnV0ZXMuXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UoaW5zdGFuY2UsIG1ldGEsIGNvdW50cykge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb3VudHMpIHx8IGNvdW50cy5sZW5ndGggIT09IG1ldGEucGVyRmVhdHVyZS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgZXhwZWN0ZWQgJHttZXRhLnBlckZlYXR1cmUubGVuZ3RofSB2ZXJ0ZXggY291bnRzLCBgICtcbiAgICAgICAgICAgICAgICBgZ290ICR7Y291bnRzICYmIGNvdW50cy5sZW5ndGh9YCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXhwZWN0ZWQgPSBjb3VudHMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgKiBGTE9BVFNfUEVSX1ZFUlRFWDtcbiAgICAgICAgLy8gTGluZXMga2VlcCBhIHR5cGVkIGZsYXQgYnVmZmVyOyBzaGFwZXMga2VlcCBhIHBsYWluIGZsYXQgYXJyYXkuIEVpdGhlciBpcyB0aGVcbiAgICAgICAgLy8gZ3JvdW5kIHRydXRoIGZvciBob3cgbWFueSBHTCB2ZXJ0aWNlcyBnbGlmeSBhY3R1YWxseSBidWlsdC5cbiAgICAgICAgY29uc3QgYWN0dWFsID0gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZCA/IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQubGVuZ3RoXG4gICAgICAgICAgICA6IChBcnJheS5pc0FycmF5KGluc3RhbmNlLnZlcnRpY2VzKSA/IGluc3RhbmNlLnZlcnRpY2VzLmxlbmd0aCA6IC0xKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZXhwZWN0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4IGNvdW50IG1pc21hdGNoOiBnZW9tZXRyeSBzYXlzICR7ZXhwZWN0ZWR9IGZsb2F0cywgYCArXG4gICAgICAgICAgICAgICAgYHRoZSBpbnN0YW5jZSBob2xkcyAke2FjdHVhbH1gKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhdHRycyA9IGV4cGFuZFBlckZlYXR1cmUobWV0YS5wZXJGZWF0dXJlLCBjb3VudHMpO1xuICAgICAgICBhdHRycy5iYXNlID0gbWV0YS5iYXNlO1xuICAgICAgICBhdHRycy5sYXllcklkcyA9IG1ldGEubGF5ZXJJZHM7XG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgZGlzYWJsZVZlY3RvckdwdShlcnIubWVzc2FnZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuLy8gV2lyZXMgdGhlIGF0dHJpYnV0ZSBidWZmZXJzIGFuZCB1bmlmb3JtcyBpbnRvIGEgbGl2ZSBnbGlmeSBwb2ludHMgaW5zdGFuY2UuIFJldHVybnMgYVxuLy8gaGFuZGxlIHdob3NlIHNldFdpbmRvdyBjb3N0cyB0d28gdW5pZm9ybXMgYW5kIGEgcmVkcmF3LCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IHRoZVxuLy8gaW5zdGFuY2UgaXMgbm90IHdoZXJlIGdsaWZ5IDMuMy4wIGtlZXBzIGl0IC0tIGluIHdoaWNoIGNhc2UgR1BVIHRpbWUgaXMgZGlzYWJsZWQgYW5kXG4vLyB0aGUgY2FsbGVyJ3MgcmVidWlsZCBwYXRoIHRha2VzIG92ZXIuXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvSW5zdGFuY2UoaW5zdGFuY2UsIGF0dHJzKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIHdpcmVUaW1lQXR0cmlidXRlcyhpbnN0YW5jZSwgYXR0cnMpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBkaXNhYmxlR3B1VGltZShlcnIubWVzc2FnZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuLy8gVGhlIGNvbW1vbiBHTCB3aXJpbmc6IGJ1ZmZlcnMgZm9yIHNwYW4vZHVyYXRpb24vbGF5ZXIgYXR0cmlidXRlcywgdW5pZm9ybXMgZm9yIHRoZVxuLy8gdGljaywgdGhlIHNoYXJlZCBvdmVycmlkZSBhbmQgdGhlIHBlci1sYXllciB2aXNpYmlsaXR5IHNsb3RzLiBUaHJvd3Mgb24gYW55dGhpbmdcbi8vIHVuZXhwZWN0ZWQ7IHRoZSBjYWxsZXJzIGRlY2lkZSB3aGljaCBmYWxsYmFjayBmbGFnIHRoYXQgZmxpcHMuXG5mdW5jdGlvbiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKSB7XG4gICAge1xuICAgICAgICBjb25zdCBnbCA9IGluc3RhbmNlLmdsO1xuICAgICAgICBjb25zdCBwcm9ncmFtID0gaW5zdGFuY2UucHJvZ3JhbTtcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBpbnN0YW5jZS5sYXllcjtcbiAgICAgICAgaWYgKCFnbCB8fCAhcHJvZ3JhbSB8fCAhbGF5ZXIpIHRocm93IG5ldyBFcnJvcihcImluc3RhbmNlIGxhY2tzIGdsL3Byb2dyYW0vbGF5ZXJcIik7XG5cbiAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcblxuICAgICAgICBjb25zdCBzcGFuTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhVGltZVNwYW5cIik7XG4gICAgICAgIGNvbnN0IGR1ckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUR1cmF0aW9uXCIpO1xuICAgICAgICBjb25zdCBsYXllckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUxheWVyXCIpO1xuICAgICAgICBjb25zdCB0aWNrTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidVRpY2tcIik7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidU92ZXJyaWRlXCIpO1xuICAgICAgICAvLyBTb21lIGRyaXZlcnMgbmFtZSB0aGUgYXJyYXkgaGVhZCBcInVMYXllclZpc1swXVwiOyBhY2NlcHQgZWl0aGVyLlxuICAgICAgICBjb25zdCB2aXNMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNcIilcbiAgICAgICAgICAgIHx8IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1swXVwiKTtcbiAgICAgICAgaWYgKHNwYW5Mb2MgPCAwIHx8IGR1ckxvYyA8IDAgfHwgbGF5ZXJMb2MgPCAwIHx8ICF0aWNrTG9jIHx8ICFvdmVycmlkZUxvYyB8fCAhdmlzTG9jKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0aW1lIGF0dHJpYnV0ZXMvdW5pZm9ybXMgbWlzc2luZyBmcm9tIHRoZSBsaW5rZWQgcHJvZ3JhbVwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwYW5CdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHNwYW5CdWYpO1xuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuc3BhbnMsIGdsLlNUQVRJQ19EUkFXKTtcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihzcGFuTG9jLCAyLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShzcGFuTG9jKTtcblxuICAgICAgICBjb25zdCBkdXJCdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGR1ckJ1Zik7XG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5kdXJzLCBnbC5TVEFUSUNfRFJBVyk7XG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoZHVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShkdXJMb2MpO1xuXG4gICAgICAgIGNvbnN0IGxheWVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBsYXllckJ1Zik7XG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5sYXllcklkeCwgZ2wuU1RBVElDX0RSQVcpO1xuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGxheWVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShsYXllckxvYyk7XG5cbiAgICAgICAgLy8gVW50aWwgdGhlIHNsaWRlciBzYXlzIG90aGVyd2lzZSwgZXZlcnl0aGluZyBpcyB2aXNpYmxlIC0tIGluIHRpbWUgQU5EIGxheWVyLlxuICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgQUxXQVlTKTtcbiAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCAtMSk7XG4gICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbGF5ZXJJZHM6IGF0dHJzLmxheWVySWRzLFxuICAgICAgICAgICAgLy8gdGlja01zIGluIGVwb2NoIG1zOyBvdmVycmlkZU1zIGEgc2hhcmVkLXdpbmRvdyB3aWR0aCBvciBudWxsLlxuICAgICAgICAgICAgc2V0V2luZG93KHRpY2tNcywgb3ZlcnJpZGVNcykge1xuICAgICAgICAgICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIHRpY2tNcyA9PT0gbnVsbCA/IEFMV0FZUyA6ICh0aWNrTXMgLSBhdHRycy5iYXNlKSAvIDEwMDApO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgb3ZlcnJpZGVNcyA9PT0gbnVsbCA/IC0xIDogb3ZlcnJpZGVNcyAvIDEwMDApO1xuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIE9uZSBmbG9hdCBwZXIgbGF5ZXIgc2xvdCwgaW4gYXR0cnMubGF5ZXJJZHMgb3JkZXIuIEEgc2lkZWJhciB0b2dnbGUgbGFuZHNcbiAgICAgICAgICAgIC8vIGhlcmUgaW5zdGVhZCBvZiByZWJ1aWxkaW5nIHRoZSBidWNrZXQuXG4gICAgICAgICAgICBzZXRMYXllclZpc2liaWxpdHkodmlzQXJyYXkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2aXMgPSBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpO1xuICAgICAgICAgICAgICAgIHZpcy5zZXQodmlzQXJyYXkuc2xpY2UoMCwgTEFZRVJfU0xPVFMpKTtcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCB2aXMpO1xuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICB9XG59XG4iLCAiaW1wb3J0IHsgbG9hZEpTLCBiaW5kUG9wdXAsIGJpbmRUb29sdGlwLCBwYXJzZUNvbG9yIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHBpblNoYWRlciB9IGZyb20gXCIuL3NoYWRlcnMuanNcIjtcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXG4gICAgICAgICBwZXJpb2RUb01zIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcbmltcG9ydCB7IGJ1aWxkVGltZUF0dHJpYnV0ZXMsIGF0dGFjaFRpbWVUb0luc3RhbmNlLCB0aW1lVmVydGV4U2hhZGVyLFxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XG5cbmZ1bmN0aW9uIHNldHVwR2xpZnlQcm9qZWN0aW9uKGdsSW5zdGFuY2UpIHtcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIuX3VuY2xhbXBlZFByb2plY3QgPSBmdW5jdGlvbihsYXRsbmcsIHpvb20pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAub3B0aW9ucy5jcnMubGF0TG5nVG9Qb2ludChsYXRsbmcsIHpvb20pO1xuICAgICAgICB9O1xuICAgICAgICBnbEluc3RhbmNlLmxheWVyLnJlZHJhdygpO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9jbGlja1RpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2NsaWNrTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5faG92ZXJNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5faG92ZXJNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xuLy8gdmFyaWVkIHN0eWxpbmcsIG90aGVyd2lzZSB0aGUgbGF5ZXIncyBzaW5nbGUgc3R5bGUuIFB5dGhvbiBvbmx5IGVtaXRzIGZlYXR1cmVfc3R5bGVzXG4vLyB3aGVuIGZlYXR1cmVzIGFjdHVhbGx5IGRpZmZlciwgc28gYSB1bmlmb3JtIGxheWVyIGNvc3RzIG5vdGhpbmcgZXh0cmEgaGVyZS5cbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxuLy8gdGhhbiBlZGl0aW5nIHRoZSBsYXllcidzIHN0eWxlLCBzbyBjbGVhcmluZyBpdCByZXN0b3JlcyB3aGF0IHdhcyB1bmRlcm5lYXRoIHdpdGhcbi8vIG5vdGhpbmcgdG8gcmVtZW1iZXIgYW5kIG5vdGhpbmcgdG8gcHV0IGJhY2suXG4vL1xuLy8gICB0aGUgbGF5ZXIncyBvd24gc3R5bGUgICB3aGF0IGl0IHdhcyBkcmF3biB3aXRoXG4vLyAgIGZlYXR1cmVfc3R5bGVzW2ldICAgICAgIHBlciBmZWF0dXJlLCBmcm9tIHRoZSBkYXRhXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxuLy8gICBzdHlsZV9vdmVycmlkZXNbaV0gICAgICB0aGlzIGZlYXR1cmUgaXMgc2VsZWN0ZWQgLS0gbW9zdCBzcGVjaWZpYywgc28gaXQgd2luc1xuZXhwb3J0IGZ1bmN0aW9uIHN0eWxlRm9yKGxheWVyLCBpbmRleCkge1xuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xuICAgIGNvbnN0IGhpZ2hsaWdodCA9IGxheWVyLmhpZ2hsaWdodF9zdHlsZTtcbiAgICBjb25zdCBzZWxlY3RlZCA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyAmJiBsYXllci5zdHlsZV9vdmVycmlkZXNbaW5kZXhdO1xuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcbiAgICByZXR1cm4geyAuLi5sYXllciwgLi4uKGZyb21EYXRhIHx8IHt9KSwgLi4uKGhpZ2hsaWdodCB8fCB7fSksIC4uLihzZWxlY3RlZCB8fCB7fSkgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEluZGV4ZWRQcm9wZXJ0aWVzKHByb3BlcnRpZXMsIGluZGV4KSB7XG4gICAgaWYgKCFwcm9wZXJ0aWVzKSByZXR1cm4ge307XG4gICAgY29uc3QgcHJvcHMgPSB7fTtcbiAgICBPYmplY3Qua2V5cyhwcm9wZXJ0aWVzKS5mb3JFYWNoKGsgPT4ge1xuICAgICAgICBjb25zdCB2YWwgPSBwcm9wZXJ0aWVzW2tdO1xuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XG4gICAgfSk7XG4gICAgcmV0dXJuIHByb3BzO1xufVxuXG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyLCBtb2RlbCkge1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcbiAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge307XG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcbiAgICAgICAgcmV0dXJuIGdyb3VwO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQSB2ZWN0b3IgbGF5ZXIncyBjb29yZGluYXRlczogdGhlIGJpbmFyeSBidWZmZXIgdW5kZXIgaXRzIGlkIHdoZW4gUHl0aG9uIGJ1aWx0IGl0XG4vLyAodGhlIGxheWVycyBKU09OIHRoZW4gY2FycmllcyBubyBjb29yZGluYXRlcyBhdCBhbGwpLCBvciBpbmxpbmUgYGxvY2F0aW9uc2AgZm9yXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xuLy8gb24gdGhlIEdQVSBwYXRoIHJhcmVseSBkby5cbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XG4gICAgaWYgKGxheWVyLmxvY2F0aW9ucykgcmV0dXJuIGxheWVyLmxvY2F0aW9ucztcbiAgICBjb25zdCByYXcgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XG4gICAgaWYgKCFyYXcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZsYXQgPSBuZXcgRmxvYXQ2NEFycmF5KHJhdy5idWZmZXIgfHwgcmF3LCByYXcuYnl0ZU9mZnNldCB8fCAwLFxuICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcbiAgICBjb25zdCBvdXQgPSBuZXcgQXJyYXkoZmxhdC5sZW5ndGggLyAyKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG91dC5sZW5ndGg7IGkrKykge1xuICAgICAgICBvdXRbaV0gPSBbZmxhdFtpICogMl0sIGZsYXRbaSAqIDIgKyAxXV07XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIGNsb3NlUmluZyhyaW5nKSB7XG4gICAgaWYgKHJpbmcubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBmaXJzdCA9IHJpbmdbMF07XG4gICAgICAgIGNvbnN0IGxhc3QgPSByaW5nW3JpbmcubGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChmaXJzdFswXSAhPT0gbGFzdFswXSB8fCBmaXJzdFsxXSAhPT0gbGFzdFsxXSkge1xuICAgICAgICAgICAgcmluZy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmluZztcbn1cblxuLy8gQW4gYXJlYSBsYXllcidzIGdlb21ldHJ5IGFzIHBhcnRzIC0+IGNsb3NlZCBbbG9uLCBsYXRdIHJpbmdzOiBhIHBvbHlnb24ncyBmbGF0XG4vLyBjb29yZGluYXRlIHJ1biBzbGljZWQgYnkgaXRzIGByaW5nc2AgdGFibGUgKG9uZSBob2xlLWZyZWUgcmluZyB3aXRob3V0IGl0KSwgb3IgYVxuLy8gY2lyY2xlJ3MgZ2VuZXJhdGVkIHJpbmcuIEZlZWRzIGJvdGggdGhlIGZpbGwgKGVhcmN1dCwgaW4gdGhlIHBvbHlnb24gYnVja2V0KSBhbmRcbi8vIHRoZSBvdXRsaW5lIChMaW5lU3RyaW5ncyBpbiB0aGUgbGluZXMgYnVja2V0KS5cbmZ1bmN0aW9uIGFyZWFQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xuICAgICAgICBjb25zdCBsYXQgPSBsYXllci5sb2NhdGlvblswXTtcbiAgICAgICAgY29uc3QgbG9uID0gbGF5ZXIubG9jYXRpb25bMV07XG4gICAgICAgIGNvbnN0IHJhZGl1c01ldGVycyA9IGxheWVyLnJhZGl1cyB8fCAxMDtcbiAgICAgICAgY29uc3QgZWFydGhSYWRpdXMgPSA2Mzc4MTM3O1xuICAgICAgICBjb25zdCByaW5nID0gW107XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IDMyOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XG4gICAgICAgICAgICBjb25zdCBhbmdsZVJhZCA9IChhbmdsZSAqIE1hdGguUEkpIC8gMTgwO1xuICAgICAgICAgICAgY29uc3QgZExhdCA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLmNvcyhhbmdsZVJhZCkpIC8gZWFydGhSYWRpdXM7XG4gICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcbiAgICAgICAgICAgIHJpbmcucHVzaChbbG9uICsgKGRMb24gKiAxODApIC8gTWF0aC5QSSwgbGF0ICsgKGRMYXQgKiAxODApIC8gTWF0aC5QSV0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBbW3JpbmddXTtcbiAgICB9XG4gICAgY29uc3QgbG9jcyA9IHZlY3RvckNvb3JkcyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHx8IFtdO1xuICAgIGNvbnN0IGxvbmxhdCA9IGxvY3MubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICBjb25zdCByaW5nVGFibGUgPSBsYXllci5yaW5ncyB8fCAobG9ubGF0Lmxlbmd0aCA+IDAgPyBbW2xvbmxhdC5sZW5ndGhdXSA6IFtdKTtcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xuICAgIGxldCBhdCA9IDA7XG4gICAgZm9yIChjb25zdCBwYXJ0TGVucyBvZiByaW5nVGFibGUpIHtcbiAgICAgICAgY29uc3QgcmluZ3MgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBsZW4gb2YgcGFydExlbnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHJpbmcgPSBjbG9zZVJpbmcobG9ubGF0LnNsaWNlKGF0LCBhdCArIGxlbikpO1xuICAgICAgICAgICAgYXQgKz0gbGVuO1xuICAgICAgICAgICAgaWYgKHJpbmcubGVuZ3RoID49IDQpIHJpbmdzLnB1c2gocmluZyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJpbmdzLmxlbmd0aCA+IDApIHBhcnRzLnB1c2gocmluZ3MpO1xuICAgIH1cbiAgICByZXR1cm4gcGFydHM7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgbGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGwsIHZlY3RvckdwdSA9IGZhbHNlKSB7XG4gICAgLy8gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmUgZ2VvbWV0cnkgcGVyIGxheWVyLiBPbiB0aGUgR1BVIHBhdGggKG1hcC5qc1xuICAgIC8vIHBhc3NlcyB2ZWN0b3JHcHUgd2hlbiB0aGUgYnVja2V0IHF1YWxpZmllcykgZXZlcnkgZmVhdHVyZSBzdGF5cyBpbiB0aGUgYnVmZmVycyBhbmRcbiAgICAvLyB0aGUgc2hhZGVyIGRlY2lkZXMgdmlzaWJpbGl0eSBwZXIgdGljayBhbmQgcGVyIGxheWVyIHRvZ2dsZSAtLSBhIGxpbmUtc2hhcGVkIHRyYWNrXG4gICAgLy8gaGFzIGFzIG1hbnkgdmVydGljZXMgYXMgYSBwb2ludCB0cmFjayBoYXMgcG9pbnRzLCBzbyBpdHMgcmVidWlsZHMgY29zdCB0aGUgc2FtZVxuICAgIC8vIGFuZCBjcmFzaGVkIHRoZSBzYW1lIHdheS4gT2ZmIHRoZSBHUFUgcGF0aCwgdGhlIHdob2xlLWZlYXR1cmUgQ1BVIGZpbHRlciByZW1haW5zLlxuICAgIGNvbnN0IHZlY3Rvck1ldGEgPSB2ZWN0b3JHcHUgJiYgdHlwZSAhPT0gXCJjaXJjbGVfbWFya2Vyc1wiICYmIHR5cGUgIT09IFwibWFya2Vyc1wiXG4gICAgICAgID8gYnVpbGRWZWN0b3JUaW1lTWV0YShsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycyxcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXG4gICAgICAgIDogeyBoYXNUaW1lOiBmYWxzZSB9O1xuICAgIGNvbnN0IHZlY3RvclRpbWUgPSBCb29sZWFuKHZlY3Rvck1ldGEuaGFzVGltZSk7XG4gICAgaWYgKHRpbWVTdGF0ZSAmJiAhdmVjdG9yVGltZSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCIpIHtcbiAgICAgICAgbGF5ZXJzTGlzdCA9IGxheWVyc0xpc3QuZmlsdGVyKGwgPT4gbGF5ZXJJbldpbmRvdyhsLCBjb29yZGluYXRlQnVmZmVycywgdGltZVN0YXRlKSk7XG4gICAgICAgIGlmIChsYXllcnNMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmICh0eXBlID09PSBcInBvbHlsaW5lXCIpIHtcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XG5cbiAgICAgICAgICAgIC8vIEFyZWEgb3V0bGluZXM6IGEgcG9seWdvbiBvciBjaXJjbGUgaW4gdGhpcyBidWNrZXQgY29udHJpYnV0ZXMgZWFjaCBvZiBpdHNcbiAgICAgICAgICAgIC8vIHJpbmdzIGFzIG9uZSBMaW5lU3RyaW5nLCBkcmF3biB3aXRoIHRoZSBhcmVhJ3Mgc3Ryb2tlIG9wdGlvbnMgLS0gY29sb3IsXG4gICAgICAgICAgICAvLyB3ZWlnaHQsIG9wYWNpdHksIExlYWZsZXQncyBvd24gc2VtYW50aWNzLiBPdXRsaW5lIHdlaWdodCBhbmQgb3BhY2l0eSBuZXZlclxuICAgICAgICAgICAgLy8gcmVuZGVyZWQgYmVmb3JlIHRoaXM7IHRoZSBmaWxsIG1hY2hpbmVyeSBjYW5ub3QgZHJhdyB0aGVtIChnbGlmeSdzIGJvcmRlclxuICAgICAgICAgICAgLy8gaXMgMXB4IGFuZCBmaWxsLWNvbG91cmVkKSwgdGhlIGxpbmVzIG1hY2hpbmVyeSBhbHJlYWR5IGRvZXMuXG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xuICAgICAgICAgICAgICAgIGxldCBjb3VudCA9IDA7XG4gICAgICAgICAgICAgICAgaWYgKChzdHlsZS53ZWlnaHQgPz8gMykgPiAwICYmIChzdHlsZS5vcGFjaXR5ID8/IDEuMCkgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmluZyBvZiByaW5ncykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAocmluZy5sZW5ndGggLSAxKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIkxpbmVTdHJpbmdcIiwgY29vcmRpbmF0ZXM6IHJpbmcgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUub3BhY2l0eSB8fCAxLjAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTsgICAvLyAwIGtlZXBzIHRoZSBzbG90IGFsaWduZWQgd2hlbiBzdHJva2VsZXNzXG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IGdlb2pzb25Db29yZHMgPSBsb2NzLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XG4gICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaChNYXRoLm1heCgwLCAyICogKGdlb2pzb25Db29yZHMubGVuZ3RoIC0gMSkpKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiTGluZVN0cmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBjb29yZGluYXRlczogZ2VvanNvbkNvb3Jkc1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lT3B0aW9ucyA9IHZlY3RvclRpbWVcbiAgICAgICAgICAgICAgICAgICAgPyB7IHZlcnRleFNoYWRlclNvdXJjZTogKCkgPT4gdGltZVZlcnRleFNoYWRlcigpIH0gOiB7fTtcbiAgICAgICAgICAgICAgICB0aGlzLmdsTGluZXMgPSBMLmdsaWZ5LmxpbmVzKHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubGluZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIG1hcDogbSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogZ2VvanNvbixcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5bGluZXNQYW5lXCIsXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoZSBkYXRhIGFib3ZlIGlzIEdlb0pTT04sIHdob3NlIGNvb3JkaW5hdGVzIGFyZSBbbG9uLCBsYXRdOyBnbGlmeVxuICAgICAgICAgICAgICAgICAgICAvLyBkZWZhdWx0cyB0byBsYXRpdHVkZS1maXJzdCBhbmQgaXRzIExJTkUgdmVydGV4IGJ1aWxkZXIgcmVhZHNcbiAgICAgICAgICAgICAgICAgICAgLy8gY29vcmRpbmF0ZXMgdGhyb3VnaCB0aGVzZSBrZXlzIC0tIHVuc2V0LCBpdCB0b29rIGxvbmdpdHVkZSBhc1xuICAgICAgICAgICAgICAgICAgICAvLyBsYXRpdHVkZSBhbmQgcHJvamVjdGVkIGV2ZXJ5IGxpbmUgb2ZmLXZpZXdwb3J0LiBTaWxlbnRseTogbm8gR0xcbiAgICAgICAgICAgICAgICAgICAgLy8gZXJyb3IsIGEgaGVhbHRoeSBjYW52YXMsIHplcm8gZnJhZ21lbnRzLiBTZXQgcGVyIGluc3RhbmNlIHJhdGhlclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGFuIG9uIHRoZSBMLmdsaWZ5IGdsb2JhbCwgd2hpY2ggYW5vdGhlciBsaWJyYXJ5IGNvdWxkIGFsc29cbiAgICAgICAgICAgICAgICAgICAgLy8gbXV0YXRlLiBUaGUgcG9seWdvbiBwYXRoIGlzIGRlbGliZXJhdGVseSBOT1QgZ2l2ZW4gdGhlc2Uga2V5czpcbiAgICAgICAgICAgICAgICAgICAgLy8gaXQgdHJpYW5ndWxhdGVzIHZpYSBlYXJjdXQgb24gdGhlIEdlb0pTT04gZGlyZWN0bHksIG5hdGl2ZVxuICAgICAgICAgICAgICAgICAgICAvLyBbbG9uLCBsYXRdLCBhbmQga2V5cyB0aGVyZSB3b3VsZCB0cmFuc3Bvc2UgaXQgdGhlIHNhbWUgd2F5LlxuICAgICAgICAgICAgICAgICAgICAvLyBGb3VuZCBieSB0aGUgVmFsaGFsbGEtVlJFIGJ1ZyByZXBvcnQsIGRyaXZpbmcgdGhlIHBsYWluLUpTXG4gICAgICAgICAgICAgICAgICAgIC8vIGJ1bmRsZSB3aGVyZSBubyBwb2ludHMgbWFza2VkIHRoZSBibGFuayBsaW5lcy5cbiAgICAgICAgICAgICAgICAgICAgbGF0aXR1ZGVLZXk6IDEsXG4gICAgICAgICAgICAgICAgICAgIGxvbmdpdHVkZUtleTogMCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXcml0dGVuIGJhcmU6IHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vIGBjb21tYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHdhcyB0aGUgb25lIHBhdGggdGhhdCB3b3JrZWQgdGhlcmUuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV2hlcmUgdGhlIGNsaWNrIGxhbmRlZCwgZmVhdHVyZSBvciBub3Q6IG9uZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJhaXQgYWx3YXlzIGFuc3dlcnMgXCJ3aGVyZVwiLCBjbGlja2VkX2xheWVyX2lkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbnN3ZXJzIFwib24gd2hhdFwiIChcIlwiIGZvciBvcGVuIG1hcCkuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sYXQgKiAxZTUpIC8gMWU1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sbmcgKiAxZTUpIC8gMWU1XSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBCdW1wZWQgb24gRVZFUlkgY2xpY2s6IGNsaWNraW5nIHRoZSBzYW1lIGZlYXR1cmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHR3aWNlIGNoYW5nZXMgbmVpdGhlciBpZCBub3IgaW5kZXgsIHNvIHdpdGhvdXRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgbm8gdHJhaXQgZmlyZXMgYW5kIGhhbmRsZXJzIG1pc3MgdGhlIGNsaWNrLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsTGluZXMpO1xuICAgICAgICAgICAgICAgIGlmICh2ZWN0b3JUaW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xMaW5lcywgdmVjdG9yTWV0YSwgdmVydGV4Q291bnRzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xMaW5lcykgdGhpcy5nbExpbmVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcbiAgICAgICAgICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaCgwKTsgICAvLyBubyBmZWF0dXJlLCBidXQgdGhlIHNsb3QgbXVzdCBzdGF5IGFsaWduZWRcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIEFueSB0cmlhbmd1bGF0aW9uIG9mIGEgcG9seWdvbiB3aXRoIEQgZGlzdGluY3QgdmVydGljZXMgYW5kIGggaG9sZXMgaGFzXG4gICAgICAgICAgICAvLyBleGFjdGx5IEQgKyAyaCAtIDIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzXG4gICAgICAgICAgICAvLyBlYXJjdXQ7IGggPSAwIGdpdmVzIHRoZSBmYW1pbGlhciBEIC0gMi4gUmluZ3MgYXJlIGNsb3NlZCBieSBub3csIHNvIGVhY2hcbiAgICAgICAgICAgIC8vIGNvbnRyaWJ1dGVzIGxlbmd0aCAtIDEgZGlzdGluY3QgdmVydGljZXMuIFBhcnRzIHRyaWFuZ3VsYXRlIHNlcGFyYXRlbHlcbiAgICAgICAgICAgIC8vIChnbGlmeSBleHBsb2RlcyBhIE11bHRpUG9seWdvbiBpbnRvIHBlci1wYXJ0IGRyYXdzKSBhbmQgc3VtLlxuICAgICAgICAgICAgbGV0IHRyaWFuZ2xlcyA9IDA7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmdzIG9mIHBhcnRzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZGlzdGluY3QgPSByaW5ncy5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgci5sZW5ndGggLSAxLCAwKTtcbiAgICAgICAgICAgICAgICB0cmlhbmdsZXMgKz0gTWF0aC5tYXgoMCwgZGlzdGluY3QgKyAyICogKHJpbmdzLmxlbmd0aCAtIDEpIC0gMik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaCgzICogdHJpYW5nbGVzKTtcblxuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XG4gICAgICAgICAgICAvLyBMZWFmbGV0J3Mgb3duIHNlbWFudGljczogdGhlIGZpbGwgaXMgZmlsbENvbG9yLCBkZWZhdWx0aW5nIHRvIHRoZSBzdHJva2VcbiAgICAgICAgICAgIC8vIGNvbG9yIHdoZW4gdW5zZXQuIEl0IHVzZWQgdG8gYWx3YXlzIGZpbGwgd2l0aCBgY29sb3JgLCB3aGljaCBtYWRlXG4gICAgICAgICAgICAvLyBcInJlZCBvdXRsaW5lLCBwYWxlIGJsdWUgZmlsbFwiIC0tIHRoZSBtb3N0IGJhc2ljIHBvbHlnb24gc3R5bGluZyBhc2sgLS1cbiAgICAgICAgICAgIC8vIGltcG9zc2libGU7IHRoZSBvdXRsaW5lIGl0c2VsZiBpcyBkcmF3biBieSB0aGUgbGluZXMgYnVja2V0LlxuICAgICAgICAgICAgY29uc3QgcmdiID0gcGFyc2VDb2xvcihzdHlsZS5maWxsQ29sb3IgfHwgc3R5bGUuZmlsbF9jb2xvciB8fCBzdHlsZS5jb2xvciwgXCIjMzM4OGZmXCIpO1xuICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHBhcnRzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgICAgICAgICA/IHsgdHlwZTogXCJQb2x5Z29uXCIsIGNvb3JkaW5hdGVzOiBwYXJ0c1swXSB9XG4gICAgICAgICAgICAgICAgICAgIDogeyB0eXBlOiBcIk11bHRpUG9seWdvblwiLCBjb29yZGluYXRlczogcGFydHMgfSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUuZmlsbE9wYWNpdHkgfHwgMC4yIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzaGFwZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXG4gICAgICAgICAgICAgICAgICAgID8geyB2ZXJ0ZXhTaGFkZXJTb3VyY2U6ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKSB9IDoge307XG4gICAgICAgICAgICAgICAgdGhpcy5nbFNoYXBlcyA9IEwuZ2xpZnkuc2hhcGVzKHtcbiAgICAgICAgICAgICAgICAgICAgLi4uc2hhcGVPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWdvbnNQYW5lXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMywgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFyZTogc2hpbnl3aWRnZXRzJyBtb2RlbCBoYXMgbm8gYGNvbW1gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHByb3BlcnR5LCBzbyBnYXRpbmcgb24gaXQgc2lsZW50bHkga2lsbGVkIHRoaXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBUaGUgc2lkZWJhciBhbHdheXMgd3JvdGUgYmFyZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgd2FzIHRoZSBvbmUgcGF0aCB0aGF0IHdvcmtlZCB0aGVyZS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkLCBmZWF0dXJlIG9yIG5vdDogb25lXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0cmFpdCBhbHdheXMgYW5zd2VycyBcIndoZXJlXCIsIGNsaWNrZWRfbGF5ZXJfaWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF0bG5nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW01hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxhdCAqIDFlNSkgLyAxZTUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxuZyAqIDFlNSkgLyAxZTVdKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEJ1bXBlZCBvbiBFVkVSWSBjbGljazogY2xpY2tpbmcgdGhlIHNhbWUgZmVhdHVyZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHdpY2UgY2hhbmdlcyBuZWl0aGVyIGlkIG5vciBpbmRleCwgc28gd2l0aG91dFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBubyB0cmFpdCBmaXJlcyBhbmQgaGFuZGxlcnMgbWlzcyB0aGUgY2xpY2suXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja19zZXFcIiwgKG1vZGVsLmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xTaGFwZXMpO1xuICAgICAgICAgICAgICAgIGlmICh2ZWN0b3JUaW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsU2hhcGVzKSB0aGlzLmdsU2hhcGVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XG4gICAgY29uc3QgaW5kZXhNYXBwaW5nID0gW107XG5cbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xuICAgIC8vIGdsaWZ5J3MgZmFsbGJhY2sgd2hlbiBhIGxheWVyIGRlY2xhcmVzIG5vIHJhZGl1cy4gUGlucyBuZWVkIGZhciBtb3JlIHJvb20gdGhhbiBhXG4gICAgLy8gY2lyY2xlIGJlY2F1c2UgdGhlIGdseXBoIGlzIGRyYXduIGluc2lkZSB0aGUgcG9pbnQncyBvd24gcXVhZCBieSB0aGUgc2hhZGVyLlxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XG5cbiAgICAvLyBHUFUgdGltZSBwYXRoOiB3aGVuIHRoaXMgYnVja2V0IGhvbGRzIHRpbWUgbGF5ZXJzLCBldmVyeSBwb2ludCBpcyBmZWQgdG8gZ2xpZnkgYW5kXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXG4gICAgLy8gdmVydGV4IHNoYWRlciwgc28gYSB0aWNrIGNvc3RzIHR3byB1bmlmb3JtcyBpbnN0ZWFkIG9mIHJlYnVpbGRpbmcgNU0gcG9pbnRzIGluIEpTLlxuICAgIC8vIFRoZSBDUFUgZmlsdGVyIGJlbG93IHN0YXlzIGFzIHRoZSBmYWxsYmFjayB3aGVuIHRoZSBHTCB3aXJpbmcgaXMgdW5hdmFpbGFibGUuXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcbiAgICAgICAgPyBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxuICAgICAgICAgICAgdGltZVN0YXRlICYmIHRpbWVTdGF0ZS5wZXJpb2QgPyBwZXJpb2RUb01zKHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbClcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgY29uc3QgZ3B1VGltZSA9IEJvb2xlYW4oZ3B1QXR0cnMuaGFzVGltZSk7XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgY29sb3JSR0IgPSBwYXJzZUNvbG9yKGxheWVyLmNvbG9yLCBmYWxsYmFja0NvbG9yKTtcbiAgICAgICAgY29uc3QgbGF5ZXJTaXplID0gbGF5ZXIucmFkaXVzICE9IG51bGwgPyBOdW1iZXIobGF5ZXIucmFkaXVzKSA6IGRlZmF1bHRTaXplO1xuXG4gICAgICAgIGNvbnN0IGNvb3JkQnVmZmVyID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICBpZiAoIWNvb3JkQnVmZmVyKSB7XG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2xheWVyLmxvY2F0aW9uWzBdLCBsYXllci5sb2NhdGlvblsxXV0pO1xuICAgICAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiAwLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3JSR0IsXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnVmZmVyLFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZU9mZnNldCxcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGNvdW50ID0gY29vcmRzLmxlbmd0aCAvIDI7XG5cbiAgICAgICAgY29uc3QgcGVyRmVhdHVyZSA9IEFycmF5LmlzQXJyYXkobGF5ZXIuZmVhdHVyZV9zdHlsZXMpID8gbGF5ZXIuZmVhdHVyZV9zdHlsZXMgOiBudWxsO1xuICAgICAgICAvLyBTZWxlY3Rpb24gc3R5bGluZywgYXBwbGllZCBvdmVyIHRoZSBsYXllcidzIG93biBhbmQgaXRzIGRhdGEtZHJpdmVuIHN0eWxlcy5cbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cbiAgICAgICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlIHx8IG51bGw7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlcyA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyB8fCBudWxsO1xuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxuICAgICAgICAvLyB1OCBSR0JBIHVuZGVyIFwiPGlkPjo6Y29sb3JzXCIsIGYzMiBwaXhlbHMgdW5kZXIgXCI8aWQ+OjpyYWRpaVwiIC0tIGNvbXB1dGVkXG4gICAgICAgIC8vIGluIFB5dGhvbiBmcm9tIGNvbG9yX2NvbC9yYWRpdXNfY29sLiBCdWZmZXJzLCBuZXZlciBwZXItZmVhdHVyZSBzdHlsZVxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxuICAgICAgICAvLyBwYXlsb2FkIHRoYXQgdXNlZCB0byBraWxsIHNlc3Npb25zLiBFeHBsaWNpdCBzdHlsZXMgc3RpbGwgb3V0cmFuayB0aGVtLlxuICAgICAgICBjb25zdCBjb2xvcnNSYXcgPSBjb29yZGluYXRlQnVmZmVyc1tgJHtsYXllci5pZH06OmNvbG9yc2BdO1xuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcbiAgICAgICAgICAgID8gbmV3IFVpbnQ4QXJyYXkoY29sb3JzUmF3LmJ1ZmZlciB8fCBjb2xvcnNSYXcsIGNvbG9yc1Jhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yc1Jhdy5ieXRlTGVuZ3RoKVxuICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICBjb25zdCByYWRpaVJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2Ake2xheWVyLmlkfTo6cmFkaWlgXTtcbiAgICAgICAgY29uc3QgYnVmUmFkaWkgPSByYWRpaVJhd1xuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJhZGlpUmF3LmJ5dGVMZW5ndGggLyA0KVxuICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxuICAgICAgICAvLyBzaW1wbHkgbm90IHB1c2hlZDsgaW5kZXhNYXBwaW5nIGNhcnJpZXMgb3JpZ2luYWxJbmRleCwgc28gcG9wdXBzIGFuZCBwcm9wZXJ0aWVzXG4gICAgICAgIC8vIG9uIHRoZSBzdXJ2aXZvcnMga2VlcCBwb2ludGluZyBhdCB0aGUgcmlnaHQgcm93cy5cbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcbiAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZClcbiAgICAgICAgICAgIDogbnVsbDtcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBmcm9tRGF0YSA9IHBlckZlYXR1cmUgPyBwZXJGZWF0dXJlW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gb3ZlcnJpZGVzID8gb3ZlcnJpZGVzW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChmcm9tRGF0YSAmJiBmcm9tRGF0YS5jb2xvcik7XG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xuICAgICAgICAgICAgICAgIDogaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5yYWRpdXMgIT0gbnVsbCA/IGhpZ2hsaWdodC5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IGZyb21EYXRhICYmIGZyb21EYXRhLnJhZGl1cyAhPSBudWxsID8gZnJvbURhdGEucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2Nvb3Jkc1tpICogMl0sIGNvb3Jkc1tpICogMiArIDFdXSk7XG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XG4gICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IGksXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcbiAgICAgICAgICAgICAgICAgICAgOiBidWZDb2xvcnMgPyB7IHI6IGJ1ZkNvbG9yc1tpICogNF0gLyAyNTUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnOiBidWZDb2xvcnNbaSAqIDQgKyAxXSAvIDI1NSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYTogYnVmQ29sb3JzW2kgKiA0ICsgM10gLyAyNTUgfVxuICAgICAgICAgICAgICAgICAgICA6IGNvbG9yUkdCLFxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcbiAgICAgICAgICAgICAgICAgICAgOiBidWZSYWRpaSA/IGJ1ZlJhZGlpW2ldXG4gICAgICAgICAgICAgICAgICAgIDogbGF5ZXJTaXplXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb2ludHNMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3QgZ2V0SW50ZXJhY3RpdmVFbCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICBjb25zdCBnbGlmeU9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXG4gICAgICAgICAgICAgICAgcGFuZTogXCJwb2ludHNQYW5lXCIsXG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZWQgcGVyIHBvaW50LCBsaWtlIGNvbG91cjogc2V2ZXJhbCBsYXllcnMgc2hhcmUgb25lIGdsaWZ5IGluc3RhbmNlLFxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cbiAgICAgICAgICAgICAgICBzaXplOiAoaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gPyBpbmZvLmNvbG9yUkdCIDogeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlbnNpdGl2aXR5OiB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDIwIDogOCxcbiAgICAgICAgICAgICAgICBjbGljazogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHBvcHVwcyBvbiBmYXIgYXdheSBjbGlja3NcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gY2xpY2tQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGNsaWNrZWQgcG9pbnQncyBvd24gY29vcmRpbmF0ZXMgLS0gbW9yZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0cnV0aGZ1bCB0aGFuIHRoZSBtb3VzZSBwb3NpdGlvbiBmb3IgYSBwb2ludC5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIiwgW3BvaW50WzBdLCBwb2ludFsxXV0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBCdW1wZWQgb24gRVZFUlkgY2xpY2s7IHNlZSB0aGUgdmVjdG9yIGNsaWNrIGhhbmRsZXJzLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja19zZXFcIiwgKG1vZGVsLmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBob3ZlcjogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBpZiAocG9pbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuZm9yY2UgYSBzdHJpY3QgcGl4ZWwtZGlzdGFuY2UgdGhyZXNob2xkIHRvIHByZXZlbnQgdG9vbHRpcHMgb24gZmFyIGF3YXkgaG92ZXJzXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBob3ZlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGhvdmVyUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2lkeF07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT09IFwibWFya2Vyc1wiKSB7XG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLmZyYWdtZW50U2hhZGVyU291cmNlID0gKCkgPT4gcGluU2hhZGVyO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy52ZXJ0ZXhTaGFkZXJTb3VyY2UgPSAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmdsUG9pbnRzID0gTC5nbGlmeS5wb2ludHMoZ2xpZnlPcHRpb25zKTtcbiAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xQb2ludHMpO1xuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBOdWxsIG9uIGZhaWx1cmUsIHdoaWNoIGFsc28gZmxpcHMgdGhlIGdsb2JhbCBmbGFnOiB0aGUgbmV4dCBzeW5jJ3NcbiAgICAgICAgICAgICAgICAvLyByZWJ1aWxkIGtleSBjaGFuZ2VzIHdpdGggaXQgYW5kIHRoZSBDUFUgcGF0aCB0YWtlcyBvdmVyLlxuICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb0luc3RhbmNlKHRoaXMuZ2xQb2ludHMsIGdwdUF0dHJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5nbFBvaW50cykgdGhpcy5nbFBvaW50cy5yZW1vdmUoKTtcbiAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIGNvbnN0IGNhbnZhcyA9IG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xuICAgICAgICAgICAgaWYgKGNhbnZhcykgY2FudmFzLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgIHJldHVybiBpbnN0YW5jZTtcbn1cbiIsICIvLyBQZXJtYW5lbnQgZmVhdHVyZSBsYWJlbHM6IHRleHQgcGlubmVkIHRvIHRoZSBtYXAsIGZyb20gYSBsYXllcidzIGBsYWJlbGAgKG9uZVxuLy8gdmVjdG9yIGZlYXR1cmUpIG9yIGBsYWJlbHNgIChvbmUgcGVyIHBvaW50LCBhbGlnbmVkIHdpdGggdGhlIGNvb3JkaW5hdGUgYnVmZmVyKS5cbi8vIERPTSBlbGVtZW50cyBieSBkZXNpZ24gLS0gTGVhZmxldCBwZXJtYW5lbnQgdG9vbHRpcHMgLS0gd2hpY2ggaXMgd2h5IHRoZXkgYXJlIGZvclxuLy8gc2l0ZS1zY2FsZSBsYXllcnM7IFB5dGhvbiB3YXJucyBwYXN0IGEgdGhvdXNhbmQuIE1vZGVsLWZyZWUgbGlrZSB0aGUgbGVnZW5kOiBwdXJlXG4vLyBkYXRhIGluLCBMZWFmbGV0IGxheWVycyBvdXQsIHJlLWRlcml2ZWQgZWFjaCBzeW5jIHNvIGxhYmVscyBmb2xsb3cgdmlzaWJpbGl0eVxuLy8gd2l0aG91dCB0b3VjaGluZyB0aGUgR0wgYnVja2V0cyBvciB0aGVpciBtZXRhIGtleXMuXG5cbmltcG9ydCB7IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlIH0gZnJvbSBcIi4vbWFwLmpzXCI7XG5pbXBvcnQgeyB2ZWN0b3JDb29yZHMgfSBmcm9tIFwiLi9sYXllcnMuanNcIjtcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCBlZmZlY3RpdmVEdXJhdGlvbiwgdGltZXNGb3IgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xuXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGFiZWxsZWQgZmVhdHVyZSBpcyBpbnNpZGUgdGhlIGN1cnJlbnQgdGltZSB3aW5kb3cuIE5hTiB0aW1lc1xuLy8ga2VlcCB0aGUgbGFiZWwsIG1hdGNoaW5nIHRoZSBtYXA6IGFuIHVucmVhZGFibGUgdGltZSBuZXZlciBoaWRlcyBkYXRhLCBzbyBpdFxuLy8gbXVzdCBuZXZlciBoaWRlIHRoZSBkYXRhJ3MgbGFiZWwgZWl0aGVyLiBBIG11bHRpLXNwYW4gbGluZSBjb3VudHMgYXMgdmlzaWJsZVxuLy8gd2hpbGUgQU5ZIG9mIGl0cyBzZWdtZW50cyBpcyAtLSB0aGUgbGFiZWwgZm9sbG93cyB0aGUgbGF5ZXIsIG5vdCBvbmUgbGVnLlxuZnVuY3Rpb24gdGltZVZpc2libGUobGF5ZXIsIGJ1ZmZlcnMsIHRpbWVTdGF0ZSkge1xuICAgIGlmICghdGltZVN0YXRlIHx8ICFsYXllci50aW1lKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcbiAgICBpZiAoIXRpbWVzIHx8IHRpbWVzLmxlbmd0aCA8IDIpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIHJldHVybiB0cnVlO1xuICAgICAgICBpZiAoZmVhdHVyZUluV2luZG93KHRpbWVzW2ldLCB0aW1lc1tpICsgMV0sIHdpbikpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIE9uZSBhbmNob3IgcGVyIGxhYmVsbGVkIGZlYXR1cmUuIFBvaW50cyBsYWJlbCBhdCB0aGUgcG9pbnQ7IGEgbGluZSBsYWJlbHMgYXQgaXRzXG4vLyBtaWRkbGUgdmVydGV4IChvbiB0aGUgbGluZSwgbm90IGZsb2F0aW5nIGluIGl0cyBib3VuZGluZyBib3gpOyBhIHBvbHlnb24gb3Jcbi8vIGNpcmNsZSBsYWJlbHMgYXQgaXRzIGJvdW5kcyBjZW50cmUuIFdpdGggYSB0aW1lU3RhdGUsIGxhYmVscyBmb2xsb3cgdGhlIHdpbmRvdzpcbi8vIHBvaW50cyBkcm9wIHBlciBwb2ludCwgdmVjdG9ycyBhcyBhIHdob2xlLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSBjb250aW51ZTtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIikge1xuICAgICAgICAgICAgb3V0LnB1c2goLi4uY29sbGVjdExhYmVscyhsYXllci5sYXllcnMgfHwgW10sIGJ1ZmZlcnMsIGdyb3VwQ29uZmlncywgdGltZVN0YXRlKSk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShsYXllci5sYWJlbHMpKSB7XG4gICAgICAgICAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgaWYgKCFyYXcpIGNvbnRpbnVlO1xuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcbiAgICAgICAgICAgIGNvbnN0IHdpbiA9IHRpbWVTdGF0ZSAmJiBsYXllci50aW1lXG4gICAgICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgYnVmZmVycykgOiBudWxsO1xuICAgICAgICAgICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihsYXllci5sYWJlbHMubGVuZ3RoLCBjb29yZHMubGVuZ3RoIC8gMik7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgICAgICBpZiAoIWxheWVyLmxhYmVsc1tpXSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbaSAqIDJdKVxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgIWZlYXR1cmVJbldpbmRvdyh0aW1lc1tpICogMl0sIHRpbWVzW2kgKiAyICsgMV0sIHdpbikpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiBjb29yZHNbaSAqIDJdLCBsbmc6IGNvb3Jkc1tpICogMiArIDFdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsc1tpXSksIGNlbnRlcjogZmFsc2UgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobGF5ZXIubGFiZWwpIHtcbiAgICAgICAgICAgIGlmICghdGltZVZpc2libGUobGF5ZXIsIGJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xuICAgICAgICAgICAgICAgIGlmIChsb2NzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgICAgICAgICAgY29uc3QgbWlkID0gbG9jc1tNYXRoLmZsb29yKChsb2NzLmxlbmd0aCAtIDEpIC8gMildO1xuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiBtaWRbMF0sIGxuZzogbWlkWzFdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiBmYWxzZSB9KTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAobGF5ZXIuYm91bmRzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgW1thTGF0LCBhTG9uXSwgW2JMYXQsIGJMb25dXSA9IGxheWVyLmJvdW5kcztcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKGFMYXQgKyBiTGF0KSAvIDIsIGxuZzogKGFMb24gKyBiTG9uKSAvIDIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGxheWVyLmxvY2F0aW9uKSB7XG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGxheWVyLmxvY2F0aW9uWzBdLCBsbmc6IGxheWVyLmxvY2F0aW9uWzFdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiB0cnVlIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBObyBib3VuZHMgb24gdGhlIGNvbmZpZyAtLSB0aGUgY29sbGVjdGlvbiBtZXJnZSBkcm9wcGVkIHRoZW0gZm9yXG4gICAgICAgICAgICAgICAgLy8gaXRzIHdob2xlIGhpc3RvcnksIGFuZCBoYW5kLWJ1aWx0IGNvbmZpZ3MgbWF5IG5ldmVyIGNhcnJ5IHRoZW0uXG4gICAgICAgICAgICAgICAgLy8gVGhlIGNvb3JkaW5hdGVzIGFyZSBzdGlsbCBpbiB0aGUgYnVmZmVyIHVuZGVyIHRoZSBsYXllcidzIG93biBpZCxcbiAgICAgICAgICAgICAgICAvLyBleGFjdGx5IGFzIHRoZSBwb2x5bGluZSBicmFuY2ggcmVhZHMgdGhlbTsgYSBtaXNzaW5nIGJveCBtdXN0XG4gICAgICAgICAgICAgICAgLy8gZGVncmFkZSB0byBjb21wdXRpbmcgb25lLCBuZXZlciB0byBzaWxlbnRseSBkcm9wcGluZyB0aGUgbGFiZWwuXG4gICAgICAgICAgICAgICAgY29uc3QgbG9jcyA9IHZlY3RvckNvb3JkcyhsYXllciwgYnVmZmVycyB8fCB7fSkgfHwgW107XG4gICAgICAgICAgICAgICAgaWYgKGxvY3MubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcbiAgICAgICAgICAgICAgICBsZXQgbWluTG5nID0gSW5maW5pdHksIG1heExuZyA9IC1JbmZpbml0eTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtsYXQsIGxuZ10gb2YgbG9jcykge1xuICAgICAgICAgICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA8IG1pbkxuZykgbWluTG5nID0gbG5nO1xuICAgICAgICAgICAgICAgICAgICBpZiAobG5nID4gbWF4TG5nKSBtYXhMbmcgPSBsbmc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAobWluTGF0ICsgbWF4TGF0KSAvIDIsIGxuZzogKG1pbkxuZyArIG1heExuZykgLyAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFJlYnVpbGRzIGBncm91cGAgKGFuIEwubGF5ZXJHcm91cCkgdG8gaG9sZCBleGFjdGx5IHRoZSBjdXJyZW50IGxhYmVscywgc2tpcHBpbmdcbi8vIHRoZSB3b3JrIHdoZW4gbm90aGluZyBjaGFuZ2VkIC0tIHN5bmNzIHJ1biBvbiBldmVyeSB0b2dnbGUgYW5kIHRpY2suXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyTGFiZWxzKEwsIGdyb3VwLCBsYXllcnMsIGJ1ZmZlcnMsIGdyb3VwQ29uZmlncywgdGltZVN0YXRlID0gbnVsbCkge1xuICAgIGNvbnN0IGxhYmVscyA9IGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSk7XG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkobGFiZWxzKTtcbiAgICBpZiAoZ3JvdXAuX3N3aWZ0bWFwTGFiZWxLZXkgPT09IGtleSkgcmV0dXJuO1xuICAgIGdyb3VwLl9zd2lmdG1hcExhYmVsS2V5ID0ga2V5O1xuICAgIGdyb3VwLmNsZWFyTGF5ZXJzKCk7XG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGxhYmVscykge1xuICAgICAgICAvLyBDb250ZW50IGFzIGFuIGVsZW1lbnQgd2l0aCB0ZXh0Q29udGVudDogdG9vbHRpcCBzdHJpbmcgY29udGVudCBpcyBIVE1MLFxuICAgICAgICAvLyBhbmQgbGFiZWxzIGNvbWUgZnJvbSB1c2VyIGRhdGEsIHdoaWNoIG11c3QgbmV2ZXIgcGFyc2UgYXMgbWFya3VwLlxuICAgICAgICBjb25zdCBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgIHNwYW4udGV4dENvbnRlbnQgPSBpdGVtLnRleHQ7XG4gICAgICAgIGNvbnN0IHRvb2x0aXAgPSBMLnRvb2x0aXAoe1xuICAgICAgICAgICAgcGVybWFuZW50OiB0cnVlLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiBpdGVtLmNlbnRlciA/IFwiY2VudGVyXCIgOiBcInRvcFwiLFxuICAgICAgICAgICAgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWZlYXR1cmUtbGFiZWxcIixcbiAgICAgICAgICAgIG9mZnNldDogaXRlbS5jZW50ZXIgPyBbMCwgMF0gOiBbMCwgLTZdLFxuICAgICAgICB9KS5zZXRMYXRMbmcoW2l0ZW0ubGF0LCBpdGVtLmxuZ10pLnNldENvbnRlbnQoc3Bhbik7XG4gICAgICAgIGdyb3VwLmFkZExheWVyKHRvb2x0aXApO1xuICAgIH1cbn1cbiIsICJpbXBvcnQgeyBsb2FkQ1NTLCBsb2FkSlMgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyU2lkZWJhckNvbnRyb2xzLCBub3JtYWxpemVSYWRpb0xheWVycywgc2VuZExheWVyV3JpdGUgfSBmcm9tIFwiLi9zaWRlYmFyLmpzXCI7XG5pbXBvcnQgeyBkZXJpdmVMZWdlbmRTcGVjLCByZW5kZXJMZWdlbmQgfSBmcm9tIFwiLi9sZWdlbmQuanNcIjtcbmltcG9ydCB7IHJlbmRlckxhYmVscyB9IGZyb20gXCIuL2xhYmVscy5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyTGF5ZXIsIHJlbmRlck1lcmdlZEdsTGF5ZXIsIHJlZ2lzdGVyQ2xpY2tNYXRjaCB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIGdlbmVyYXRlVGlja3MsIGNvbGxlY3RUaW1lRXh0ZW50LCBoYXNUaW1lTGF5ZXJzLFxuICAgICAgICAgbGF5ZXJJbldpbmRvdywgcmVuZGVyVGltZUNvbnRyb2wsIGFkdmFuY2UsIHBlcmlvZFRvTXMsIGdjZEdyaWRNcyxcbiAgICAgICAgIGNvbGxlY3REdXJhdGlvbnNNcywgUE9TSVRJT05TIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcbmltcG9ydCB7IGdwdVRpbWVBdmFpbGFibGUsIHZlY3RvckdwdUF2YWlsYWJsZSwgTEFZRVJfU0xPVFMgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XG5cbi8vIFRydWUgaWYgYSBsYXllciBpcyB2aXNpYmxlIGFuZCBubyBmb2xkZXIgYWJvdmUgaXQgaXMgc3dpdGNoZWQgb2ZmLlxuLy9cbi8vIFZpc2liaWxpdHkgaXMgaW5oZXJpdGVkIGRvd24gdGhlIGZvbGRlciBwYXRoOiBhIGxheWVyIGluc2lkZSBcIkZlZWRzL0FjdGl2ZVwiIGlzIGhpZGRlblxuLy8gd2hlbiBlaXRoZXIgXCJGZWVkc1wiIG9yIFwiRmVlZHMvQWN0aXZlXCIgaXMgb2ZmLCByZWdhcmRsZXNzIG9mIGl0cyBvd24gZmxhZy4gR2V0dGluZyB0aGlzXG4vLyB3cm9uZyBzaG93cyB1cCBhcyBcInRoYXQgbGF5ZXIganVzdCB3aWxsIG5vdCBhcHBlYXJcIiwgd2l0aCBub3RoaW5nIGxvZ2dlZC5cbmV4cG9ydCBmdW5jdGlvbiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLnNwbGl0KFwiL1wiKSkge1xuICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZ3JvdXBDb25maWdzW3J1bm5pbmdQYXRoXTtcbiAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFNvcnRzIHRoZSB2aXNpYmxlIGxheWVycyBpbnRvIG9uZSBidWNrZXQgcGVyIFdlYkdMIGRyYXcgcGFzcy5cbi8vXG4vLyBTdWItbGF5ZXJzIG9mIGEgbWVyZ2VkIGdyb3VwIGluaGVyaXQgdGhlaXIgcGFyZW50J3MgdmlzaWJpbGl0eSByYXRoZXIgdGhhbiBjYXJyeWluZ1xuLy8gdGhlaXIgb3duLCBzbyBhIGdyb3VwIHRvZ2dsZWQgb2ZmIGNvbnRyaWJ1dGVzIG5vdGhpbmcgZXZlbiB3aGVuIGl0cyBjaGlsZHJlbiBzYXlcbi8vIHZpc2libGUuIENpcmNsZXMgam9pbiB0aGUgcG9seWdvbiBidWNrZXQ6IHRoZXkgYXJlIGRyYXduIGFzIGdlbmVyYXRlZCByaW5ncy5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcbiAgICBjb25zdCBidWNrZXRzID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG5cbiAgICBmdW5jdGlvbiBjb2xsZWN0KGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1YkxheWVyKSB7XG4gICAgICAgIGlmICghcGFyZW50VmlzaWJsZSkgcmV0dXJuO1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IGNvbGxlY3Qoc3ViLCBwYXJlbnRWaXNpYmxlLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFpc1N1YkxheWVyICYmIGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKGJ1Y2tldHNbYnVja2V0XSkgYnVja2V0c1tidWNrZXRdLnB1c2gobGF5ZXIpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgIGNvbGxlY3QobGF5ZXIsIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpLCBmYWxzZSk7XG4gICAgfVxuICAgIHJldHVybiBidWNrZXRzO1xufVxuXG4vLyBBcHBsaWVzIGluY3JlbWVudGFsIHBhdGNoIG9wcyB0byB7bGF5ZXJzLCBidWZmZXJzfSwgcmV0dXJuaW5nIHRoZSBuZXcgc3RhdGUuXG4vL1xuLy8gT3BzIGFyZSBhZGRyZXNzZWQgYnkgbGF5ZXIgaWQgYW5kIGFwcGxpZWQgaWRlbXBvdGVudGx5OiBcImFkZFwiIHVwc2VydHMgcmF0aGVyIHRoYW5cbi8vIGFwcGVuZGluZyBibGluZGx5LCBzbyBhIHBhdGNoIHRoYXQgcmFjZXMgdGhlIGluaXRpYWwgdHJhaXQgc25hcHNob3QgY2Fubm90IGR1cGxpY2F0ZVxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxuLy8gQXBwbGllcyBgdXBkYXRlYCB0byBvbmUgbGF5ZXIgd2hlcmV2ZXIgaXQgc2l0cywgZGVzY2VuZGluZyBpbnRvIGdyb3Vwcy4gYWRkX2NvbGxlY3Rpb25cbi8vIG5lc3RzIGl0cyBwb2ludCwgbGluZSBhbmQgcG9seWdvbiBsYXllcnMgaW5zaWRlIGEgZ3JvdXAgbGF5ZXIsIHNvIGFuIG9wIGFkZHJlc3NlZCBhdCBhXG4vLyBuZXN0ZWQgaWQgd291bGQgb3RoZXJ3aXNlIG1hdGNoIG5vdGhpbmcgYW5kIHNpbGVudGx5IGRvIG5vdGhpbmcuIFJldHVybnMgdGhlIG9yaWdpbmFsXG4vLyBhcnJheSB1bnRvdWNoZWQgd2hlbiB0aGUgaWQgaXMgbm90IGZvdW5kLCBzbyBhbiB1bm1hdGNoZWQgb3AgY29zdHMgbm8gcmUtcmVuZGVyLlxuZnVuY3Rpb24gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgaWQsIHVwZGF0ZSkge1xuICAgIGxldCBoaXQgPSBmYWxzZTtcbiAgICBjb25zdCBuZXh0ID0gbGF5ZXJzLm1hcChsID0+IHtcbiAgICAgICAgaWYgKGwuaWQgPT09IGlkKSB7XG4gICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIHVwZGF0ZShsKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgQXJyYXkuaXNBcnJheShsLmxheWVycykpIHtcbiAgICAgICAgICAgIGNvbnN0IHN1YnMgPSB1cGRhdGVMYXllckJ5SWQobC5sYXllcnMsIGlkLCB1cGRhdGUpO1xuICAgICAgICAgICAgaWYgKHN1YnMgIT09IGwubGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5sLCBsYXllcnM6IHN1YnMgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbDtcbiAgICB9KTtcbiAgICByZXR1cm4gaGl0ID8gbmV4dCA6IGxheWVycztcbn1cblxuLy8gRXZlcnkgcG9pbnQgbGF5ZXIsIHZpc2libGUgb3Igbm90LCB3aXRoIGl0cyBlZmZlY3RpdmUgdmlzaWJpbGl0eSByZWNvcmRlZCAtLSB0aGVcbi8vIEdQVS12aXNpYmlsaXR5IHBhdGgga2VlcHMgaGlkZGVuIGxheWVycyBpbiB0aGUgYnVja2V0IChzdGFibGUgaWRzLCBubyByZWJ1aWxkIG9uIGFcbi8vIHRvZ2dsZSkgYW5kIGhpZGVzIHRoZW0gd2l0aCBhIHVuaWZvcm0gaW5zdGVhZC4gTWlycm9ycyBjb2xsZWN0V2ViZ2xMYXllcnMnIHJ1bGVzOlxuLy8gc3ViLWxheWVycyBpbmhlcml0IHRoZWlyIHBhcmVudCdzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5LCB0b3AtbGV2ZWwgbGF5ZXJzIGFuc3dlciBmb3Jcbi8vIHRoZWlyIG93biBmbGFnIGFuZCB0aGVpciBmb2xkZXIgY2hhaW4uXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3Qgb3V0ID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG4gICAgZnVuY3Rpb24gd2FsayhsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWIpIHtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlbGZWaXMgPSBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IHdhbGsoc3ViLCBzZWxmVmlzLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKCFvdXRbYnVja2V0XSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2aXMgPSBpc1N1YiA/IHBhcmVudFZpc2libGVcbiAgICAgICAgICAgIDogcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgb3V0W2J1Y2tldF0ucHVzaCh7IGxheWVyLCB2aXMgfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB3YWxrKGxheWVyLCB0cnVlLCBmYWxzZSk7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3dpZnRtYXBQYXRjaChzdGF0ZSwgb3BzLCBidWZmZXJzKSB7XG4gICAgbGV0IGxheWVycyA9IHN0YXRlLmxheWVycyB8fCBbXTtcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcblxuICAgIGZvciAoY29uc3Qgb3Agb2Ygb3BzKSB7XG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBvcC5sYXllcnMgfHwgW107XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7fTtcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJzICYmIGJ1ZmZlcnNbaV0pIGJ1ZmZlck1hcFtpZF0gPSBidWZmZXJzW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICAgICAgICBjb25zdCBpbmNvbWluZyA9IG9wLmxheWVyO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBpbmNvbWluZyA/IGluY29taW5nLmlkIDogb3AuaWQ7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBbLi4ubGF5ZXJzLCBpbmNvbWluZ107XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5tYXAoKGwsIGkpID0+IChpID09PSBpZHggPyBpbmNvbWluZyA6IGwpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzZXRcIikge1xuICAgICAgICAgICAgLy8gRmllbGQtbGV2ZWwgdXBkYXRlLiBcInJlcGxhY2VcIiBjYXJyaWVzIHRoZSB3aG9sZSBsYXllciwgc28gZmxpcHBpbmcgYHZpc2libGVgXG4gICAgICAgICAgICAvLyBvbiBhIDUway1wb2ludCBsYXllciByZXNlbnQgZXZlcnkgcHJvcGVydHkgaXQgaG9sZHMgLS0gaGFsZiBhIG1lZ2FieXRlIHRvXG4gICAgICAgICAgICAvLyBjaGFuZ2Ugb25lIGJvb2xlYW4sIG9uIGV2ZXJ5IGNsaWNrIG9mIGEgY2hlY2tib3guXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoeyAuLi5sLCAuLi4ob3AuZmllbGRzIHx8IHt9KSB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic3R5bGVcIikge1xuICAgICAgICAgICAgLy8gUGVyLWZlYXR1cmUgc3R5bGUgb3ZlcnJpZGVzLCByZXBsYWNlZCB3aG9sZXNhbGUgcmF0aGVyIHRoYW4gbWVyZ2VkOiBhXG4gICAgICAgICAgICAvLyBzZWxlY3Rpb24gZGVzY3JpYmVzIGl0cyBjb21wbGV0ZSBzdGF0ZSwgc28gc2VuZGluZyB7fSBjbGVhcnMgaXQgYW5kIG5vXG4gICAgICAgICAgICAvLyBjYWxsZXIgaGFzIHRvIHRyYWNrIHdoYXQgdGhlIHByZXZpb3VzIGhpZ2hsaWdodCB0b3VjaGVkLlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5sLCBzdHlsZV9vdmVycmlkZXM6IG9wLm92ZXJyaWRlcyB8fCB7fSxcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLmZpbHRlcihsID0+IGwuaWQgIT09IG9wLmlkKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJcIikge1xuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XG4gICAgICAgICAgICBpZiAoYnVmKSBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogYnVmIH07XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX3JlbW92ZVwiKSB7XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xuICAgICAgICAgICAgZGVsZXRlIGJ1ZmZlck1hcFtvcC5pZF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBsYXllcnMsIGJ1ZmZlcnM6IGJ1ZmZlck1hcCB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxFcnJvciA9IGNvbnNvbGUuZXJyb3I7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcblxuICAgICAgICAvLyBqc19jb25zb2xlX2xvZ3MgaXMgYSBzeW5jZWQgbGlzdCwgc28gZWFjaCBhcHBlbmQgcmVzZW5kcyB0aGUgd2hvbGUgYXJyYXkuIEtlZXBpbmdcbiAgICAgICAgLy8gb25seSB0aGUgbW9zdCByZWNlbnQgZW50cmllcyBib3VuZHMgYm90aCB0aGUgcGF5bG9hZCBhbmQgdGhlIG1lbW9yeSBhIGxvbmctbGl2ZWRcbiAgICAgICAgLy8gc2Vzc2lvbiBhY2N1bXVsYXRlczsgdGhlIG5ld2VzdCBhcmUgdGhlIG9uZXMgd29ydGggaGF2aW5nIGFueXdheS5cbiAgICAgICAgY29uc3QgTUFYX0NPTlNPTEVfTE9HUyA9IDIwMDtcbiAgICAgICAgY29uc3QgYXBwZW5kTG9nID0gZW50cnkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbG9ncyA9IG1vZGVsLmdldChcImpzX2NvbnNvbGVfbG9nc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBbLi4ubG9ncywgZW50cnldO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQubGVuZ3RoID4gTUFYX0NPTlNPTEVfTE9HUyA/IG5leHQuc2xpY2UoLU1BWF9DT05TT0xFX0xPR1MpIDogbmV4dDtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBIZWxwZXIgdG8gc2FmZWx5IHdyaXRlIGJhY2sgdG8gUHl0aG9uIG9ubHkgaWYgdGhlIHdpZGdldCB2aWV3IGlzIGFjdGl2ZSBhbmQgYXR0YWNoZWRcbiAgICAgICAgZnVuY3Rpb24gc2FmZVNldEFuZFNhdmUoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcbiAgICAgICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyBzYXZlIGVycm9yOlwiLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yID0gZnVuY3Rpb24oLi4uYXJncykge1xuICAgICAgICAgICAgb3JpZ2luYWxFcnJvci5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpKTtcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xuICAgICAgICBjb25zb2xlLndhcm4gPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XG4gICAgICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xuICAgICAgICAgICAgICAgIGlmICghbG9nZ2VkUmVwcm9qZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBtb2RlbC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xlYW5Nc2cgPSBgW1N3aWZ0TWFwXSBMYXllciB3YXMgcmVwcm9qZWN0ZWQgdG8gXCIke2Nyc31cImA7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIGFwcGVuZExvZyhjbGVhbk1zZykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvcmlnaW5hbFdhcm4uYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgd2luZG93Lm9uZXJyb3IgPSBmdW5jdGlvbihtZXNzYWdlLCBzb3VyY2UsIGxpbmVubywgY29sbm8sIGVycm9yKSB7XG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxuICAgICAgICAgICAgICAgIGFwcGVuZExvZyhgV0lORE9XLk9ORVJST1I6ICR7bWVzc2FnZX0gYXQgJHtzb3VyY2V9OiR7bGluZW5vfToke2NvbG5vfWApKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBMb2FkIENTUyBhbmQgTGVhZmxldCBsaWJyYXJpZXMgKGluY2x1ZGluZyBXZWJHTCBnbGlmeSlcbiAgICAgICAgbG9hZENTUyhcImxlYWZsZXQtY3NzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuY3NzXCIpO1xuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWpzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2xpZnlcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0LmdsaWZ5QDMuMy4wL2Rpc3QvZ2xpZnktYnJvd3Nlci5qc1wiKTtcbiAgICAgICAgLy8gR2VvbWFuIG11c3QgbG9hZCBCRUZPUkUgdGhlIG1hcCBpcyBjb25zdHJ1Y3RlZDogaXQgYXR0YWNoZXMgbWFwLnBtIHRocm91Z2hcbiAgICAgICAgLy8gYSBMZWFmbGV0IGluaXQgaG9vaywgd2hpY2ggb25seSBydW5zIGZvciBtYXBzIGNyZWF0ZWQgYWZ0ZXIgdGhlIHBsdWdpblxuICAgICAgICAvLyBleGlzdHMgLS0gbGF6eS1sb2FkaW5nIGl0IGxhdGVyIGxlYXZlcyBtYXAucG0gdW5kZWZpbmVkIGZvcmV2ZXIuXG4gICAgICAgIGxvYWRDU1MoXCJsZWFmbGV0LWdlb21hbi1jc3NcIixcbiAgICAgICAgICAgIFwiaHR0cHM6Ly91bnBrZy5jb20vQGdlb21hbi1pby9sZWFmbGV0LWdlb21hbi1mcmVlQDIuMTguMy9kaXN0L2xlYWZsZXQtZ2VvbWFuLmNzc1wiKTtcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1nZW9tYW5cIixcbiAgICAgICAgICAgIFwiaHR0cHM6Ly91bnBrZy5jb20vQGdlb21hbi1pby9sZWFmbGV0LWdlb21hbi1mcmVlQDIuMTguMy9kaXN0L2xlYWZsZXQtZ2VvbWFuLm1pbi5qc1wiKTtcblxuICAgICAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5wb3NpdGlvbiA9IFwicmVsYXRpdmVcIjtcbiAgICAgICAgZWwuYXBwZW5kQ2hpbGQoY29udGFpbmVyKTtcblxuICAgICAgICAvLyBNYXAoaGVpZ2h0PS4uLikgc2l6aW5nLiBBbiBleHBsaWNpdCBoZWlnaHQgYWxzbyBkcm9wcyB0aGUgc3R5bGVzaGVldCdzXG4gICAgICAgIC8vIDQwMHB4IGZsb29yIC0tIGFuIGV4cGxpY2l0IDIwMHB4IG11c3Qgbm90IGxvc2UgdG8gYSBkZWZhdWx0IG1pbmltdW0uXG4gICAgICAgIC8vIEhlaWdodCB3YXMgYWNjZXB0ZWQgYW5kIGRvY3VtZW50ZWQgbG9uZyBiZWZvcmUgaXQgcmVhY2hlZCB0aGUgRE9NOyB0aGlzXG4gICAgICAgIC8vIGlzIHdoZXJlIGl0IGZpbmFsbHkgZG9lcy5cbiAgICAgICAgZnVuY3Rpb24gYXBwbHlIZWlnaHQoKSB7XG4gICAgICAgICAgICBjb25zdCBoID0gbW9kZWwuZ2V0KFwiaGVpZ2h0XCIpO1xuICAgICAgICAgICAgY29udGFpbmVyLnN0eWxlLmhlaWdodCA9IGggfHwgXCIxMDAlXCI7XG4gICAgICAgICAgICBjb250YWluZXIuc3R5bGUubWluSGVpZ2h0ID0gaCA/IFwiMFwiIDogXCJcIjtcbiAgICAgICAgfVxuICAgICAgICBhcHBseUhlaWdodCgpO1xuXG4gICAgICAgIGxldCBsYWJlbHNHcm91cCA9IG51bGw7ICAgLy8gY3JlYXRlZCBhZnRlciB0aGUgbWFwOyBmaWxsZWQgYnkgZWFjaCBzeW5jXG5cbiAgICAgICAgY29uc3QgY3JzTmFtZSA9IG1vZGVsLmdldChcImNyc1wiKTtcbiAgICAgICAgbGV0IG1hcENycyA9IEwuQ1JTLkVQU0czODU3O1xuICAgICAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xuICAgICAgICAgICAgbWFwQ3JzID0gTC5DUlMuRVBTRzQzMjY7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYXAgPSBMLm1hcChjb250YWluZXIsIHtcbiAgICAgICAgICAgIGNyczogbWFwQ3JzLFxuICAgICAgICAgICAgY2VudGVyOiBtb2RlbC5nZXQoXCJjZW50ZXJcIiksXG4gICAgICAgICAgICB6b29tOiBtb2RlbC5nZXQoXCJ6b29tXCIpLFxuICAgICAgICAgICAgc2Nyb2xsV2hlZWxab29tOiB0cnVlLFxuICAgICAgICAgICAgcHJlZmVyQ2FudmFzOiB0cnVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWdvbnNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlnb25zUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQxMFwiO1xuICAgICAgICBcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5bGluZXNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlsaW5lc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MjBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9pbnRzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDMwXCI7XG5cbiAgICAgICAgbGFiZWxzR3JvdXAgPSBMLmxheWVyR3JvdXAoKS5hZGRUbyhtYXApO1xuXG4gICAgICAgIC8vIExvY2FsIG1pcnJvcnMgb2YgdGhlIGxheWVyIGxpc3QgYW5kIGNvb3JkaW5hdGUgYnVmZmVycy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gUHl0aG9uIHVwZGF0ZXMgdGhlc2UgaW5jcmVtZW50YWxseSB2aWEgXCJzd2lmdG1hcF9wYXRjaFwiIG1lc3NhZ2VzIGluc3RlYWQgb2ZcbiAgICAgICAgLy8gcmVhc3NpZ25pbmcgdGhlIHRyYWl0cywgYmVjYXVzZSBhIHRyYWl0IHJlYXNzaWdubWVudCByZS1zZXJpYWxpemVzIGFuZCByZS1zZW5kc1xuICAgICAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxuICAgICAgICAvLyB3aGVuIGEgdmlldyBhdHRhY2hlcywgYW5kIHRoZSBzaWRlYmFyIHN0aWxsIHdyaXRlcyBgbGF5ZXJzYCBiYWNrIG9uIHRvZ2dsZSwgc29cbiAgICAgICAgLy8gYm90aCBhcmUgc2VlZGVkIGhlcmUgYW5kIGtlcHQgaW4gc3RlcCBieSB0aGUgY2hhbmdlIGhhbmRsZXJzIGZ1cnRoZXIgZG93bi5cbiAgICAgICAgbGV0IGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcblxuICAgICAgICBmdW5jdGlvbiBhcHBseVBhdGNoT3BzKG9wcywgYnVmZmVycykge1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBuZXh0LmxheWVycztcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0gbmV4dC5idWZmZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWN0aXZlVGlsZUxheWVycyA9IHt9O1xuICAgICAgICBjb25zdCBhY3RpdmVPdmVybGF5TGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGdsU3RhdGVzID0ge1xuICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5Z29uOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFRoZSBzaGFyZWQgdGltZSBzbGlkZXIuIGB0aW1lU3RhdGVgIGlzIHdoYXQgcmVuZGVyaW5nIHJlYWRzIC0tIHRoZSBjdXJyZW50IHRpY2tcbiAgICAgICAgLy8gYW5kIHRoZSBwZXJpb2QsIG9yIG51bGwgd2hlbiBub3RoaW5nIGlzIGFuaW1hdGVkIC0tIGFuZCBgdGltZVVJYCBpcyB0aGUgc2xpZGVyJ3NcbiAgICAgICAgLy8gb3duIGJvb2trZWVwaW5nLiBQbGF5YmFjayBuZXZlciByb3VuZC10cmlwcyB0aHJvdWdoIFB5dGhvbjogdGlja3MgcmUtcmVuZGVyXG4gICAgICAgIC8vIGxvY2FsbHksIGFuZCB0aW1lX2N1cnJlbnQgaXMgd3JpdHRlbiBiYWNrIGF0IG1vc3Qgb25jZSBhIHNlY29uZCB3aGlsZSBwbGF5aW5nLlxuICAgICAgICBsZXQgdGltZVN0YXRlID0gbnVsbDtcbiAgICAgICAgY29uc3QgdGltZVVJID0geyB0aWNrczogW10sIGtleTogXCJcIiwgaW5kZXg6IDAsIHBsYXlpbmc6IGZhbHNlLCBsb29wOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBzcGVlZDogMSwgdGltZXI6IG51bGwsIGxhc3RXcml0ZTogMCwgc3RhcnRlZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93OiBudWxsLCBwZXJpb2RNczogbnVsbCwgZ3JpZE1zOiBudWxsIH07XG5cbiAgICAgICAgZnVuY3Rpb24gc3RvcFBsYXliYWNrKCkge1xuICAgICAgICAgICAgaWYgKHRpbWVVSS50aW1lcikgY2xlYXJJbnRlcnZhbCh0aW1lVUkudGltZXIpO1xuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gbnVsbDtcbiAgICAgICAgICAgIHRpbWVVSS5wbGF5aW5nID0gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiB3cml0ZVRpbWVDdXJyZW50KGZvcmNlKSB7XG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgaWYgKCFmb3JjZSAmJiBub3cgLSB0aW1lVUkubGFzdFdyaXRlIDwgMTAwMCkgcmV0dXJuO1xuICAgICAgICAgICAgdGltZVVJLmxhc3RXcml0ZSA9IG5vdztcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwidGltZV9jdXJyZW50XCIsIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc2Vla1RvKGluZGV4LCB7IHdyaXRlID0gdHJ1ZSB9ID0ge30pIHtcbiAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkpO1xuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3c6IHRpbWVVSS53aW5kb3cgfTtcbiAgICAgICAgICAgIGlmICh3cml0ZSkgd3JpdGVUaW1lQ3VycmVudCghdGltZVVJLnBsYXlpbmcpO1xuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc3RhcnRQbGF5YmFjaygpIHtcbiAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhZHZhbmNlKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCwgdGltZVVJLmxvb3ApO1xuICAgICAgICAgICAgICAgIGlmICghbmV4dC5wbGF5aW5nKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHNlZWtUbyhuZXh0LmluZGV4KTtcbiAgICAgICAgICAgIH0sIDEwMDAgLyB0aW1lVUkuc3BlZWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGltZUhhbmRsZXJzID0ge1xuICAgICAgICAgICAgb25TZWVrOiAoaW5kZXgpID0+IHNlZWtUbyhpbmRleCksXG4gICAgICAgICAgICBvblN0ZXBCYWNrOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4IC0gMSksXG4gICAgICAgICAgICBvblN0ZXBGb3J3YXJkOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4ICsgMSksXG4gICAgICAgICAgICBvblBsYXlUb2dnbGU6ICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gc3RhcnRPdmVyLCBhcyB0aGUgZm9saXVtIHBsYXllciB3YXMgY29uZmlndXJlZDogcHJlc3NpbmcgcGxheSBhdFxuICAgICAgICAgICAgICAgICAgICAvLyB0aGUgZW5kIHJlc3RhcnRzIGZyb20gdGhlIGJlZ2lubmluZyBpbW1lZGlhdGVseSwgcmF0aGVyIHRoYW4gb25lXG4gICAgICAgICAgICAgICAgICAgIC8vIHNpbGVudCBpbnRlcnZhbCBsYXRlciBkZWNpZGluZyB0aGVyZSBpcyBub3doZXJlIHRvIGdvIGFuZCBzdG9wcGluZy5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5pbmRleCA+PSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkgc2Vla1RvKDApO1xuICAgICAgICAgICAgICAgICAgICBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25Mb29wVG9nZ2xlOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmxvb3AgPSAhdGltZVVJLmxvb3A7XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblNwZWVkOiAoc3BlZWQpID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBzcGVlZDtcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBMaXZlIGR1cmluZyB0aGUgZHJhZzogbG9jYWwgc3RhdGUgYW5kIGEgcmUtcmVuZGVyIG9mIHRoZSBjb250cm9sIG9uIGV2ZXJ5XG4gICAgICAgICAgICAvLyBtb3ZlLCBidXQgbWFwIHJlYnVpbGRzIGF0IG1vc3QgZXZlcnkgMzAwbXMuIEF0IDVNIHBvaW50cyBhIHJlYnVpbGQgY29zdHNcbiAgICAgICAgICAgIC8vIHNlY29uZHMsIGFuZCBhIGRyYWcgZmlyZXMgZG96ZW5zIG9mIG1vdmVzIC0tIHVudGhyb3R0bGVkLCB0aGUgcmVidWlsZHNcbiAgICAgICAgICAgIC8vIHN0YWNrIGZhc3RlciB0aGFuIHRoZXkgZmluaXNoIGFuZCB0aGUgYWxsb2NhdGlvbiBjaHVybiBjcmFzaGVzIHRoZSB0YWIuXG4gICAgICAgICAgICBvbldpbmRvd0RyYWc6IChpc28pID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGlzbztcbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB0aW1lU3RhdGUgPSB7IC4uLnRpbWVTdGF0ZSwgd2luZG93OiBpc28gfTtcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vdyAtICh0aW1lVUkubGFzdERyYWdTeW5jIHx8IDApID49IDMwMCkge1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkubGFzdERyYWdTeW5jID0gbm93O1xuICAgICAgICAgICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gT24gcmVsZWFzZSAob3IgYSBrZXlib2FyZCBzdGVwKTogdGhlIG92ZXJyaWRlIGxhbmRzIGluIHRpbWVfY29uZmlnIHNvXG4gICAgICAgICAgICAvLyBQeXRob24gYW5kIFNoaW55IHNlZSB0aGUgc2FtZSB3aW5kb3cgdGhlIGJhciBzaG93cy4gbnVsbCBjbGVhcnMgdGhlIGtleSxcbiAgICAgICAgICAgIC8vIGhhbmRpbmcgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXG4gICAgICAgICAgICBvbldpbmRvd0NvbW1pdDogKGlzbykgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVIYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpOyAgICAgICAvLyB0aGUgcmVsZWFzZSBhbHdheXMgbGFuZHMsIHRocm90dGxlIG9yIG5vdFxuICAgICAgICAgICAgICAgIGNvbnN0IGNmZyA9IHsgLi4uKG1vZGVsLmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9KSB9O1xuICAgICAgICAgICAgICAgIGlmIChpc28pIGNmZy53aW5kb3cgPSBpc287XG4gICAgICAgICAgICAgICAgZWxzZSBkZWxldGUgY2ZnLndpbmRvdztcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ0aW1lX2NvbmZpZ1wiLCBjZmcpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgbG9jYWwgbW9kZWwgc3RpbGwgaG9sZHMgaXQgKi8gfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDcmVhdGVzLCByZXR1bmVzIG9yIHJlbW92ZXMgdGhlIHNsaWRlciB0byBtYXRjaCB0aGUgbGF5ZXJzIHByZXNlbnQuIFRpY2tzIGFyZVxuICAgICAgICAvLyByZWdlbmVyYXRlZCBvbmx5IHdoZW4gdGhlIGRhdGEncyB0aW1lIGV4dGVudCBvciB0aGUgcGVyaW9kIGNoYW5nZXMsIHNvIGFcbiAgICAgICAgLy8gcGxheWJhY2sgdGljayAtLSB3aGljaCByZS1lbnRlcnMgaGVyZSB2aWEgcXVldWVTeW5jIC0tIGRvZXMgbm90IHJlYnVpbGQgdGhlbS5cbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlVGltZURpbWVuc2lvbigpIHtcbiAgICAgICAgICAgIGlmICghaGFzVGltZUxheWVycyhsYXllclN0YXRlKSkge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB7IHRpY2tzOiBbXSB9LCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0gXCJcIjtcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBwZXJpb2QgPSBwYXJzZVBlcmlvZChjZmcucGVyaW9kIHx8IFwiUDFEXCIpIHx8IHBhcnNlUGVyaW9kKFwiUDFEXCIpO1xuICAgICAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xuICAgICAgICAgICAgaWYgKCFleHRlbnQpIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7ZXh0ZW50Lm1pbn18JHtleHRlbnQubWF4fXwke2NmZy5wZXJpb2QgfHwgXCJQMURcIn1gO1xuICAgICAgICAgICAgaWYgKGtleSAhPT0gdGltZVVJLmtleSkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBrZXk7XG4gICAgICAgICAgICAgICAgdGltZVVJLnRpY2tzID0gZ2VuZXJhdGVUaWNrcyhleHRlbnQubWluLCBleHRlbnQubWF4LCBwZXJpb2QpO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWluKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBUaGUgc2hhcmVkIHdpbmRvdyBvdmVycmlkZSwgY29uZmlnLWRyaXZlbjsgYSBiYWQgc3RyaW5nIGNsZWFycyByYXRoZXIgdGhhblxuICAgICAgICAgICAgLy8gZ3Vlc3NpbmcuIFRoZSBkcmFnIGdyaWQgaXMgdGhlIGdjZCBvZiB0aGUgaW50ZXJ2YWwgYW5kIGV2ZXJ5IGF0dGFjaGVkXG4gICAgICAgICAgICAvLyBkdXJhdGlvbiAtLSB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gYWxsIG9mIHRoZW0gLS0gc28gYSAyLjVoIHRyYWlsXG4gICAgICAgICAgICAvLyBpcyBkcmFnZ2FibGUgb24gYSAxaCBiYXIuIENhbGVuZGFyIHBlcmlvZHMgaGF2ZSBubyBmaXhlZCB3aWR0aDsgdGhlIHJ1bGVyXG4gICAgICAgICAgICAvLyB0aGVuIHNob3dzIGludGVydmFsIG1hcmtzIG9ubHkgYW5kIHRoZSB0cmFpbCBoYW5kbGUgaGlkZXMuXG4gICAgICAgICAgICAvLyBOZXZlciB3aGlsZSBhIGRyYWcgaXMgbGl2ZTogdGhlIGRyYWdnZWQgd2luZG93IGV4aXN0cyBvbmx5IGxvY2FsbHkgdW50aWxcbiAgICAgICAgICAgIC8vIHJlbGVhc2UgY29tbWl0cyBpdCwgYW5kIHJlYWRpbmcgY29uZmlnIGhlcmUgbWlkLWRyYWcgcmVzZXQgdGhlIGhhbmRsZSB0b1xuICAgICAgICAgICAgLy8gXCJubyB3aW5kb3dcIiBvbiBldmVyeSBkZWJvdW5jZWQgc3luYyAtLSB0aGUgaGFuZGxlIGZvbGxvd2VkIHRoZSBtb3VzZSwgdGhlblxuICAgICAgICAgICAgLy8gc25hcHBlZCBob21lLCB0aGVuIGZvbGxvd2VkIGFnYWluLCBvbmNlIHBlciBzeW5jLlxuICAgICAgICAgICAgaWYgKCF0aW1lVUkuZHJhZ0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBjZmcud2luZG93ICYmIHBhcnNlUGVyaW9kKGNmZy53aW5kb3cpID8gY2ZnLndpbmRvdyA6IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aW1lVUkucGVyaW9kTXMgPSBwZXJpb2RUb01zKHBlcmlvZCk7XG4gICAgICAgICAgICB0aW1lVUkuZ3JpZE1zID0gdGltZVVJLnBlcmlvZE1zXG4gICAgICAgICAgICAgICAgPyBnY2RHcmlkTXModGltZVVJLnBlcmlvZE1zLCBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJTdGF0ZSwgdGltZVVJLndpbmRvdykpXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QsIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xuICAgICAgICAgICAgdGltZVVJLnBvc2l0aW9uID0gY2ZnLnBvc2l0aW9uIHx8IFwidG9wLWNlbnRlclwiO1xuXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5zdGFydGVkKSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IGNmZy5zcGVlZCB8fCAxO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5sb29wID0gQm9vbGVhbihjZmcubG9vcCk7XG4gICAgICAgICAgICAgICAgLy8gT25seSB0aGUgZmlyc3QgY29uZmlndXJhdGlvbiBtYXkgYXV0by1zdGFydC4gRXZlcnkgY29uZmlnIGNoYW5nZSByZXNldHNcbiAgICAgICAgICAgICAgICAvLyBgc3RhcnRlZGAgdG8gcmUtcmVhZCBzcGVlZCBhbmQgbG9vcCAtLSBpbmNsdWRpbmcgdGhlIGNoYW5nZSBhIHdpbmRvd1xuICAgICAgICAgICAgICAgIC8vIGRyYWcgY29tbWl0cyAtLSBhbmQgcmUtcnVubmluZyBhdXRvX3BsYXkgdGhlcmUgd291bGQgc3RhcnQgcGxheWJhY2sgYXNcbiAgICAgICAgICAgICAgICAvLyBhIHNpZGUgZWZmZWN0IG9mIHJlbGVhc2luZyB0aGUgaGFuZGxlLlxuICAgICAgICAgICAgICAgIGlmIChjZmcuYXV0b19wbGF5ICYmICF0aW1lVUkuZXZlclN0YXJ0ZWQpIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZXZlclN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNpZGViYXIgTGF5ZXJzIENvbnRyb2wgVUlcbiAgICAgICAgY29uc3Qgc2lkZWJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUudG9wID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjVweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUub3ZlcmZsb3dZID0gXCJhdXRvXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuZm9udEZhbWlseSA9IFwiLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU2Vnb2UgVUknLCBSb2JvdG8sIHNhbnMtc2VyaWZcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmNvbG9yID0gXCIjMzMzXCI7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChzaWRlYmFyKTtcblxuICAgICAgICAvLyBMZWdlbmQ6IGRlcml2ZWQgZnJlc2ggb24gZXZlcnkgc3luYyBmcm9tIHRoZSBzYW1lIGxheWVyIHN0YXRlIHRoZSBzaWRlYmFyXG4gICAgICAgIC8vIHJlbmRlcnMgZnJvbSwgc28gdG9nZ2xlcyBkaW0gb3IgZHJvcCByb3dzIHdpdGggbm8gZXh0cmEgd2lyaW5nLiBIaWRkZW5cbiAgICAgICAgLy8gdW50aWwgc2hvd19sZWdlbmQgYXNrcyBmb3IgaXQuXG4gICAgICAgIGNvbnN0IGxlZ2VuZERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGxlZ2VuZERpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxlZ2VuZFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5wYWRkaW5nID0gXCIxMHB4XCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjVweFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5tYXhXaWR0aCA9IFwiMjYwcHhcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLm1heEhlaWdodCA9IFwiNDUlXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRGYW1pbHkgPSBzaWRlYmFyLnN0eWxlLmZvbnRGYW1pbHk7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxlZ2VuZERpdik7XG5cbiAgICAgICAgLy8gTG9nb1xuICAgICAgICBjb25zdCBsb2dvRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3R0b20gPSBcIjEwcHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucGFkZGluZyA9IFwiNXB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI0cHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgIGxvZ29EaXYuaW5uZXJIVE1MID0gYFxuICAgICAgICAgICAgPGRpdiBzdHlsZT1cImRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7XCI+XG4gICAgICAgICAgICAgICAgPGltZyBzcmM9XCJodHRwczovL3JlcG8vYXNzZXRzL2ltYWdlLnBuZ1wiIGFsdD1cIkNvbXBhbnlcIiBzdHlsZT1cImhlaWdodDogMzVweDsgbWFyZ2luLXJpZ2h0OiA1cHg7XCI+XG4gICAgICAgICAgICAgICAgPGltZyBzcmM9XCJodHRwczovL3JlcG8vYXNzZXRzL2ltYWdlMi5wbmdcIiBhbHQ9XCJQYXJlbnQgQ29tcGFueVwiIHN0eWxlPVwiaGVpZ2h0OiAzNXB4O1wiPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgIGA7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChsb2dvRGl2KTtcblxuXG5cbiAgICAgICAgZnVuY3Rpb24gZ2V0VGlsZUxheWVyKGxheWVyKSB7XG4gICAgICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxuICAgICAgICAgICAgICAgIG1heFpvb206IGxheWVyLm1heF96b29tIHx8IDIyLFxuICAgICAgICAgICAgICAgIG1heE5hdGl2ZVpvb206IGxheWVyLm1heF9uYXRpdmVfem9vbSB8fCAxOVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBhc3luYyBmdW5jdGlvbiBzeW5jTWFwU3RhdGUoKSB7XG4gICAgICAgICAgICBjb25zb2xlLnRpbWUoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcbiAgICAgICAgICAgIHVwZGF0ZVRpbWVEaW1lbnNpb24oKTtcbiAgICAgICAgICAgIGNvbnN0IGxheWVycyA9IGxheWVyU3RhdGU7XG4gICAgICAgICAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBidWZmZXJTdGF0ZTtcblxuICAgICAgICAgICAgLy8gRW5mb3JjZSBtdXR1YWxseSBleGNsdXNpdmUgcmFkaW8gZ3JvdXAgdmlzaWJpbGl0eSBiZWZvcmUgY29sbGVjdGluZyBvciByZW5kZXJpbmcgV2ViR0wgbGF5ZXJzLlxuICAgICAgICAgICAgLy8gV3JpdHRlbiBiYWNrIGFzIHRhcmdldGVkIGZsaXBzLCBuZXZlciB0aGUgbGF5ZXJzIHRyYWl0IC0tIHRoZSBmdWxsIHdyaXRlIHdhc1xuICAgICAgICAgICAgLy8gdGhlIGZyYW1lIHRoYXQga2lsbGVkIGxhcmdlIHNlc3Npb25zIChzZWUgdGhlIHNpZGViYXIncyBjaGFuZ2UgaGFuZGxlcikuXG4gICAgICAgICAgICBjb25zdCByYWRpbyA9IG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIGlmICgocmFkaW8uY2hhbmdlcy5sZW5ndGggPiAwIHx8IHJhZGlvLmdyb3Vwc0NoYW5nZWQpICYmIGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgc2VuZExheWVyV3JpdGUobW9kZWwsIHJhZGlvLmNoYW5nZXMpO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImdyb3VwX2NvbmZpZ3NcIiwgeyAuLi5ncm91cENvbmZpZ3MgfSk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IG1vZGVsLmdldChcInNob3dfbG9nb1wiKSA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xuXG4gICAgICAgICAgICAvLyBHcm91cCB2aXNpYmxlIGxheWVycyAoaW5jbHVkaW5nIHN1Yi1sYXllcnMgaW5zaWRlIGdyb3VwcykgdG8gYWx3YXlzIHVzZSBXZWJHTFxuICAgICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgICAgIGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICBwb2x5bGluZTogd2ViZ2xQb2x5bGluZUxheWVycyxcbiAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMsXG4gICAgICAgICAgICB9ID0gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcblxuICAgICAgICAgICAgLy8gU2V0IG9mIGxheWVyIElEcyBwcm9jZXNzZWQgdmlhIG1lcmdlZCBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGNvbnN0IHdlYmdsTGF5ZXJJZHMgPSBuZXcgU2V0KFtcbiAgICAgICAgICAgICAgICAuLi53ZWJnbENpcmNsZU1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbE1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsUG9seWdvbkxheWVycy5tYXAobCA9PiBsLmlkKVxuICAgICAgICAgICAgXSk7XG5cbiAgICAgICAgICAgIC8vIFJlbW92ZSByZXRpcmVkIG92ZXJsYXkgbGF5ZXJzLCBpbmNsdWRpbmcgdGhvc2UgdGhhdCB0cmFuc2l0aW9uZWQgdG8gV2ViR0xcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGFjdGl2ZU92ZXJsYXlMYXllcnMpLmZvckVhY2goaWQgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghbGF5ZXJzLmZpbmQobCA9PiBsLmlkID09PSBpZCkgfHwgd2ViZ2xMYXllcklkcy5oYXMoaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3Mgbm9uLVdlYkdMIGxheWVyc1xuICAgICAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBlZmZlY3RpdmVWaXNpYmxlID0gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlZmZlY3RpdmVWaXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0aWxlID0gZ2V0VGlsZUxheWVyKGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aWxlLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSA9IHRpbGU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBsYXllcnMgbWFuYWdlZCBieSB0aGUgbWVyZ2VkIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgICAgIGlmICh3ZWJnbExheWVySWRzLmhhcyhsYXllci5pZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFlZmZlY3RpdmVWaXNpYmxlIHx8ICFsYXllckluV2luZG93KGxheWVyLCBidWZmZXJTdGF0ZSwgdGltZVN0YXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmcubGF5ZXJUeXBlICE9PSBsYXllci50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0sIG1vZGVsKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0gPSBpbnN0YW5jZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEhlbHBlciB0byBzeW5jIFdlYkdMIGxheWVyIHN0YXRlcyBhbmQgcmVidWlsZCBvbmx5IGlmIGNoYW5nZWRcbiAgICAgICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMsIHZlY3RvckdwdSA9IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRzU3RyaW5nID0gdmlzaWJsZUxheWVycy5tYXAobCA9PiBsLmlkKS5zb3J0KCkuam9pbihcIixcIik7XG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyB0aGUgYnVpbHQgYnVmZmVycyBkZXBlbmQgb24gYmVsb25ncyBpbiB0aGlzIGtleTogYSBjaGFuZ2UgdGhhdFxuICAgICAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXG4gICAgICAgICAgICAgICAgLy8gbWlzc2luZyBhdCBmaXJzdCwgc28gYSBoaWdobGlnaHQgbGFuZGVkIGluIHN0YXRlIGFuZCBuZXZlciByZXBhaW50ZWQuXG4gICAgICAgICAgICAgICAgLy8gUG9pbnQgYnVja2V0cyBvbiB0aGUgR1BVIHBhdGggZXhjbHVkZSB0aGUgdGljayBhbmQgd2luZG93IGZyb20gdGhlIGtleTpcbiAgICAgICAgICAgICAgICAvLyB0aG9zZSBjaGFuZ2UgcGVyIHRpY2sgYW5kIGFyZSBhcHBsaWVkIGFzIHVuaWZvcm1zLCBub3QgYnkgcmVidWlsZGluZy5cbiAgICAgICAgICAgICAgICAvLyBUaGUgcGVyaW9kIHN0YXlzIGluLCBzaW5jZSBpdCBpcyBiYWtlZCBpbnRvIHRoZSBkdXJhdGlvbiBhdHRyaWJ1dGVzLlxuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgZWxzZSAtLSBhbmQgZXZlcnkgbm9uLXBvaW50IGJ1Y2tldCAtLSByZWJ1aWxkcyBhcyBiZWZvcmUuXG4gICAgICAgICAgICAgICAgY29uc3QgZ3B1UG9pbnRzID0gKCh0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCIpXG4gICAgICAgICAgICAgICAgICAgICYmIGdwdVRpbWVBdmFpbGFibGUoKSkgfHwgdmVjdG9yR3B1O1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFTdHJpbmcgPSBKU09OLnN0cmluZ2lmeSh2aXNpYmxlTGF5ZXJzLm1hcChsID0+ICh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogbC5jb2xvcixcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiBsLnJhZGl1cyxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogbC5vcGFjaXR5LFxuICAgICAgICAgICAgICAgICAgICBmaWxsT3BhY2l0eTogbC5maWxsT3BhY2l0eSxcbiAgICAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0OiBsLmhpZ2hsaWdodF9zdHlsZSxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVzOiBsLnN0eWxlX292ZXJyaWRlcyxcbiAgICAgICAgICAgICAgICAgICAgZmVhdHVyZVN0eWxlczogbC5mZWF0dXJlX3N0eWxlcyxcbiAgICAgICAgICAgICAgICAgICAgdGltZTogbC50aW1lLFxuICAgICAgICAgICAgICAgICAgICBncHU6IGdwdVBvaW50cyxcbiAgICAgICAgICAgICAgICAgICAgdGljazogbC50aW1lICYmIHRpbWVTdGF0ZSAmJiAhZ3B1UG9pbnRzID8gdGltZVN0YXRlLnRpY2sgOiAwLFxuICAgICAgICAgICAgICAgICAgICB3aW46IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBwZXI6IGwudGltZSAmJiBncHVQb2ludHMgJiYgdGltZVN0YXRlXG4gICAgICAgICAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBsb2NMZW46IGwubG9jYXRpb25zPy5sZW5ndGggfHwgMFxuICAgICAgICAgICAgICAgIH0pKSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlQ2hhbmdlZCA9IHN0YXRlLmlkcyAhPT0gaWRzU3RyaW5nIHx8IHN0YXRlLm1ldGEgIT09IG1ldGFTdHJpbmc7XG5cbiAgICAgICAgICAgICAgICBpZiAoc3RhdGVDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBhd2FpdCByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgdmlzaWJsZUxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsLCB0aW1lU3RhdGUsIHZlY3RvckdwdSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLmlkcyA9IGlkc1N0cmluZztcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubWV0YSA9IG1ldGFTdHJpbmc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBQb2ludCBidWNrZXRzIGhvbGRpbmcgdGltZSBsYXllcnMga2VlcCBFVkVSWSBwb2ludCBsYXllciAtLSBoaWRkZW4gb25lc1xuICAgICAgICAgICAgLy8gaW5jbHVkZWQgLS0gc28gYSBzaWRlYmFyIHRvZ2dsZSBjaGFuZ2VzIGEgdmlzaWJpbGl0eSB1bmlmb3JtIGluc3RlYWQgb2ZcbiAgICAgICAgICAgIC8vIHRoZSBidWNrZXQncyBpZHMuIFVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlYnVpbGQgYWxsIDVNXG4gICAgICAgICAgICAvLyBwb2ludHM7IGNsaWNraW5nIGRvd24gdGhlIHNpZGViYXIgc3RhY2tlZCB0aG9zZSByZWJ1aWxkcyBpbnRvIGEgY3Jhc2guXG4gICAgICAgICAgICBjb25zdCBhbGxCeVR5cGUgPSBjb2xsZWN0UG9pbnRMYXllcnNBbGwobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lcyByaWRlIHRoZSBsaW5lcyBidWNrZXQ6IGV2ZXJ5IHBvbHlnb24gYW5kIGNpcmNsZSBqb2lucyBpdCBhc1xuICAgICAgICAgICAgLy8gYW4gZXh0cmEgZW50cnkgd2hvc2UgcmluZ3MgcmVuZGVyIGFzIHdlaWdodGVkIExpbmVTdHJpbmdzICh0aGUgcG9seWdvblxuICAgICAgICAgICAgLy8gYnVja2V0IGRyYXdzIG9ubHkgdGhlIGZpbGwpLiBKb2luaW5nIHVuY29uZGl0aW9uYWxseSAtLSBzdHJva2VsZXNzIGFyZWFzXG4gICAgICAgICAgICAvLyBjb250cmlidXRlIGFuIGVtcHR5IHNsb3QgLS0ga2VlcHMgdGhlIGJ1Y2tldCdzIG1lbWJlcnNoaXAgaW5kZXBlbmRlbnQgb2ZcbiAgICAgICAgICAgIC8vIHN0eWxlIGNoYW5nZXMsIHNvIHJlc3R5bGluZyBhIGJvcmRlciBzdGF5cyBhIHJlYnVpbGQsIG5ldmVyIGEgcmUtYnVja2V0LlxuICAgICAgICAgICAgYWxsQnlUeXBlLnBvbHlsaW5lID0gWy4uLmFsbEJ5VHlwZS5wb2x5bGluZSwgLi4uYWxsQnlUeXBlLnBvbHlnb25dO1xuICAgICAgICAgICAgY29uc3QgYnVja2V0ID0geyBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb2x5bGluZTogWy4uLndlYmdsUG9seWxpbmVMYXllcnMsIC4uLndlYmdsUG9seWdvbkxheWVyc10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyB9O1xuICAgICAgICAgICAgY29uc3QgdmVjdG9yR3B1QnVja2V0ID0geyBwb2x5bGluZTogZmFsc2UsIHBvbHlnb246IGZhbHNlIH07XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2YgW1wiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCJdKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZW50cmllcyA9IGFsbEJ5VHlwZVt0eXBlXTtcbiAgICAgICAgICAgICAgICBjb25zdCBpc1BvaW50cyA9IHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIjtcbiAgICAgICAgICAgICAgICBjb25zdCBhdmFpbGFibGUgPSBpc1BvaW50cyA/IGdwdVRpbWVBdmFpbGFibGUoKSA6IHZlY3RvckdwdUF2YWlsYWJsZSgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGdwdVZpcyA9IGF2YWlsYWJsZSAmJiBlbnRyaWVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICAgICAgJiYgZW50cmllcy5sZW5ndGggPD0gTEFZRVJfU0xPVFNcbiAgICAgICAgICAgICAgICAgICAgJiYgZW50cmllcy5zb21lKGUgPT4gZS5sYXllci50aW1lKTtcbiAgICAgICAgICAgICAgICBnbFN0YXRlc1t0eXBlXS52aXNWZWN0b3IgPSBncHVWaXMgPyBlbnRyaWVzLm1hcChlID0+IChlLnZpcyA/IDEgOiAwKSkgOiBudWxsO1xuICAgICAgICAgICAgICAgIGlmIChncHVWaXMpIGJ1Y2tldFt0eXBlXSA9IGVudHJpZXMubWFwKGUgPT4gZS5sYXllcik7XG4gICAgICAgICAgICAgICAgaWYgKCFpc1BvaW50cykgdmVjdG9yR3B1QnVja2V0W3R5cGVdID0gZ3B1VmlzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcImNpcmNsZV9tYXJrZXJzXCIsIGJ1Y2tldC5jaXJjbGVfbWFya2Vycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcIm1hcmtlcnNcIiwgYnVja2V0Lm1hcmtlcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCBidWNrZXQucG9seWxpbmUsIHZlY3RvckdwdUJ1Y2tldC5wb2x5bGluZSk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlnb25cIiwgYnVja2V0LnBvbHlnb24sIHZlY3RvckdwdUJ1Y2tldC5wb2x5Z29uKTtcblxuICAgICAgICAgICAgLy8gUHVzaCB0aGUgY3VycmVudCB3aW5kb3cgaW50byB0aGUgR1BVLWZpbHRlcmVkIHBvaW50IGJ1Y2tldHM6IHR3byB1bmlmb3Jtc1xuICAgICAgICAgICAgLy8gYW5kIGEgcmVkcmF3LCB3aGljaCBpcyB0aGUgZW50aXJlIHBlci10aWNrIGNvc3Qgb2YgdGhlIHRpbWUgc2xpZGVyIHRoZXJlLlxuICAgICAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XG4gICAgICAgICAgICAgICAgY29uc3QgaGFuZGxlID0gc3RhdGUubGF5ZXIgJiYgc3RhdGUubGF5ZXIuX3N3aWZ0bWFwVGltZTtcbiAgICAgICAgICAgICAgICBpZiAoIWhhbmRsZSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgLy8gTGF5ZXIgdmlzaWJpbGl0eSBmaXJzdCwgYW5kIG9ubHkgd2hlbiBpdCBjaGFuZ2VkOiBhIHRvZ2dsZSBjb3N0cyBvbmVcbiAgICAgICAgICAgICAgICAvLyB1bmlmb3JtIGFycmF5IHdyaXRlIGFuZCBhIHJlZHJhdywgbmV2ZXIgYSByZWJ1aWxkLlxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IHN0YXRlLnZpc1ZlY3RvcjtcbiAgICAgICAgICAgICAgICBpZiAodmlzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IHZpcy5qb2luKFwiXCIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUudmlzS2V5ICE9PSBrZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLnZpc0tleSA9IGtleTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRMYXllclZpc2liaWxpdHkodmlzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG92ZXJyaWRlTXMgPSB0aW1lU3RhdGUud2luZG93XG4gICAgICAgICAgICAgICAgICAgICAgICA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2QodGltZVN0YXRlLndpbmRvdykpIDogbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyh0aW1lU3RhdGUudGljaywgb3ZlcnJpZGVNcyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyhudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsICgpID0+IHtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFBlcm1hbmVudCBsYWJlbHMgZm9sbG93IHRoZSBzYW1lIGRlcml2ZS1wZXItc3luYyBwYXR0ZXJuIGFzIHRoZSBsZWdlbmQsXG4gICAgICAgICAgICAvLyBzbyB0aGV5IHRyYWNrIHZpc2liaWxpdHkgd2l0aCBubyBidWNrZXQgb3IgbWV0YS1rZXkgaW52b2x2ZW1lbnQgLS0gYW5kXG4gICAgICAgICAgICAvLyBzaW5jZSBldmVyeSBwbGF5YmFjayB0aWNrIHJlLWVudGVycyB0aGlzIHN5bmMsIHBhc3NpbmcgdGltZVN0YXRlIG1ha2VzXG4gICAgICAgICAgICAvLyB0aGVtIGZvbGxvdyB0aGUgd2luZG93IHRvbzogY2hpcHMgYXBwZWFyIGFuZCB2YW5pc2ggd2l0aCB0aGVpciBmZWF0dXJlcy5cbiAgICAgICAgICAgIGlmIChsYWJlbHNHcm91cCkge1xuICAgICAgICAgICAgICAgIHJlbmRlckxhYmVscyhMLCBsYWJlbHNHcm91cCwgbGF5ZXJzLCBjb29yZGluYXRlQnVmZmVycywgZ3JvdXBDb25maWdzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBsZWdlbmRDZmcgPSBtb2RlbC5nZXQoXCJsZWdlbmRfY29uZmlnXCIpIHx8IHt9O1xuICAgICAgICAgICAgaWYgKG1vZGVsLmdldChcInNob3dfbGVnZW5kXCIpKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3BlYyA9IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGxlZ2VuZENmZyk7XG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGxlZ2VuZERpdiwgc3BlYyxcbiAgICAgICAgICAgICAgICAgICAgeyBkaW1IaWRkZW46IGxlZ2VuZENmZy5kaW1faGlkZGVuICE9PSBmYWxzZSB9KTtcbiAgICAgICAgICAgICAgICBjb25zdCBwb3MgPSBQT1NJVElPTlNbbGVnZW5kQ2ZnLnBvc2l0aW9uXSB8fCBQT1NJVElPTlNbXCJib3R0b20tbGVmdFwiXTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocG9zKSkge1xuICAgICAgICAgICAgICAgICAgICBsZWdlbmREaXYuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBzcGVjLmdyb3Vwcy5sZW5ndGggPiAwID8gXCJibG9ja1wiIDogXCJub25lXCI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zb2xlLnRpbWVFbmQoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICBsZXQgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XG5cbiAgICAgICAgLy8gRHJhdyAvIEFPSSB0b29sczogTGVhZmxldC1HZW9tYW4gKHRoZSBtYWludGFpbmVkIHN1Y2Nlc3NvciB0byBMZWFmbGV0LmRyYXcsXG4gICAgICAgIC8vIHdoaWNoIGJyZWFrcyBvbiBMZWFmbGV0IDEuOSksIGxvYWRlZCBmcm9tIHVucGtnIGxpa2UgTGVhZmxldCBhbmQgZ2xpZnkgLS1cbiAgICAgICAgLy8gbGF6aWx5LCBvbmx5IHdoZW4gYSBtYXAgdHVybnMgZHJhd2luZyBvbiwgc28gZXZlcnkgb3RoZXIgbWFwIHBheXMgbm90aGluZy5cbiAgICAgICAgLy8gRHJhd24gc2hhcGVzIGxpdmUgaW4gdGhlaXIgb3duIGZlYXR1cmUgZ3JvdXAgYW5kIHN5bmMgdG8gUHl0aG9uIGFzIEdlb0pTT05cbiAgICAgICAgLy8gZmVhdHVyZXMgdW5kZXIgdGhlIGBkcmF3aW5nc2AgdHJhaXQsIHdpdGggYGRyYXdfc2VxYCBidW1waW5nIHBlciBjaGFuZ2Ugc29cbiAgICAgICAgLy8gb25lIG9ic2VydmVyIGNhdGNoZXMgY3JlYXRlLCBlZGl0IGFuZCBkZWxldGUgYWxpa2UuIFRoZSB0cmFpdCBzeW5jcyBib3RoXG4gICAgICAgIC8vIHdheXM6IFB5dGhvbiBjYW4gc2VlZCBBT0lzIG9yIGNsZWFyIHRoZW0sIGFuZCBleHBvcnRzIGNhcnJ5IHRoZSBkcmF3aW5ncy5cbiAgICAgICAgbGV0IGRyYXdSZWFkeSA9IGZhbHNlO1xuICAgICAgICBsZXQgZHJhd2luZ3NHcm91cCA9IG51bGw7XG4gICAgICAgIGxldCBkcmF3SWRDb3VudGVyID0gMDtcbiAgICAgICAgbGV0IHN1cHByZXNzRHJhd2luZ3NFY2hvID0gZmFsc2U7XG5cbiAgICAgICAgZnVuY3Rpb24gZHJhd2luZ1RvRmVhdHVyZShsKSB7XG4gICAgICAgICAgICBjb25zdCBnaiA9IGwudG9HZW9KU09OKCk7XG4gICAgICAgICAgICBnai5wcm9wZXJ0aWVzID0geyAuLi4oZ2oucHJvcGVydGllcyB8fCB7fSksIGRyYXdfaWQ6IGwuX3N3aWZ0bWFwRHJhd0lkIH07XG4gICAgICAgICAgICBpZiAodHlwZW9mIGwuZ2V0UmFkaXVzID09PSBcImZ1bmN0aW9uXCIgJiYgbCBpbnN0YW5jZW9mIEwuQ2lyY2xlKSB7XG4gICAgICAgICAgICAgICAgZ2oucHJvcGVydGllcy5raW5kID0gXCJjaXJjbGVcIjtcbiAgICAgICAgICAgICAgICBnai5wcm9wZXJ0aWVzLnJhZGl1cyA9IGwuZ2V0UmFkaXVzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZ2o7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiB3cml0ZURyYXdpbmdzKCkge1xuICAgICAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAuZWFjaExheWVyKGwgPT4gZmVhdHVyZXMucHVzaChkcmF3aW5nVG9GZWF0dXJlKGwpKSk7XG4gICAgICAgICAgICBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IHRydWU7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImRyYXdpbmdzXCIsIGZlYXR1cmVzKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJkcmF3X3NlcVwiLCAobW9kZWwuZ2V0KFwiZHJhd19zZXFcIikgfHwgMCkgKyAxKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBkcmF3aW5ncyBzdGlsbCBsaXZlIG9uIHRoZSBtYXAgKi8gfVxuICAgICAgICAgICAgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGFkb3B0RHJhd2luZyhsYXllcikge1xuICAgICAgICAgICAgaWYgKCFsYXllci5fc3dpZnRtYXBEcmF3SWQpIHtcbiAgICAgICAgICAgICAgICBsYXllci5fc3dpZnRtYXBEcmF3SWQgPSBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5hZGRMYXllcihsYXllcik7XG4gICAgICAgICAgICBsYXllci5vbihcInBtOnVwZGF0ZSBwbTpkcmFnZW5kIHBtOnJvdGF0ZWVuZFwiLCB3cml0ZURyYXdpbmdzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHJlaHlkcmF0ZURyYXdpbmdzKCkge1xuICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5jbGVhckxheWVycygpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBmZWF0dXJlIG9mIG1vZGVsLmdldChcImRyYXdpbmdzXCIpIHx8IFtdKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBmZWF0dXJlLnByb3BlcnRpZXMgfHwge307XG4gICAgICAgICAgICAgICAgbGV0IGxheWVyO1xuICAgICAgICAgICAgICAgIGlmIChwcm9wcy5raW5kID09PSBcImNpcmNsZVwiICYmIGZlYXR1cmUuZ2VvbWV0cnkudHlwZSA9PT0gXCJQb2ludFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IFtsbmcsIGxhdF0gPSBmZWF0dXJlLmdlb21ldHJ5LmNvb3JkaW5hdGVzO1xuICAgICAgICAgICAgICAgICAgICBsYXllciA9IEwuY2lyY2xlKFtsYXQsIGxuZ10sIHsgcmFkaXVzOiBwcm9wcy5yYWRpdXMgfHwgMTAwIH0pO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyID0gTC5nZW9KU09OKGZlYXR1cmUpLmdldExheWVycygpWzBdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoIWxheWVyKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBsYXllci5fc3dpZnRtYXBEcmF3SWQgPSBwcm9wcy5kcmF3X2lkIHx8IGBkcmF3XyR7KytkcmF3SWRDb3VudGVyfWA7XG4gICAgICAgICAgICAgICAgYWRvcHREcmF3aW5nKGxheWVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHN5bmNEcmF3KCkge1xuICAgICAgICAgICAgY29uc3Qgc2hvdyA9IG1vZGVsLmdldChcInNob3dfZHJhd1wiKTtcbiAgICAgICAgICAgIGNvbnN0IGNmZyA9IG1vZGVsLmdldChcImRyYXdfY29uZmlnXCIpIHx8IHt9O1xuICAgICAgICAgICAgaWYgKHNob3cgJiYgIWRyYXdSZWFkeSkge1xuICAgICAgICAgICAgICAgIGRyYXdSZWFkeSA9IHRydWU7XG4gICAgICAgICAgICAgICAgZHJhd2luZ3NHcm91cCA9IEwuZmVhdHVyZUdyb3VwKCkuYWRkVG8obWFwKTtcbiAgICAgICAgICAgICAgICByZWh5ZHJhdGVEcmF3aW5ncygpO1xuICAgICAgICAgICAgICAgIG1hcC5vbihcInBtOmNyZWF0ZVwiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhZG9wdERyYXdpbmcoZS5sYXllcik7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBtYXAub24oXCJwbTpyZW1vdmVcIiwgKCkgPT4gd3JpdGVEcmF3aW5ncygpKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpkcmF3aW5nc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc3VwcHJlc3NEcmF3aW5nc0VjaG8pIHJlaHlkcmF0ZURyYXdpbmdzKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWRyYXdSZWFkeSkgcmV0dXJuO1xuICAgICAgICAgICAgaWYgKHNob3cpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29scyA9IGNmZy50b29sc1xuICAgICAgICAgICAgICAgICAgICB8fCBbXCJtYXJrZXJcIiwgXCJwb2x5bGluZVwiLCBcInJlY3RhbmdsZVwiLCBcInBvbHlnb25cIiwgXCJjaXJjbGVcIl07XG4gICAgICAgICAgICAgICAgbWFwLnBtLmFkZENvbnRyb2xzKHtcbiAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IChjZmcucG9zaXRpb24gfHwgXCJ0b3AtbGVmdFwiKS5yZXBsYWNlKFwiLVwiLCBcIlwiKSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd01hcmtlcjogdG9vbHMuaW5jbHVkZXMoXCJtYXJrZXJcIiksXG4gICAgICAgICAgICAgICAgICAgIGRyYXdQb2x5bGluZTogdG9vbHMuaW5jbHVkZXMoXCJwb2x5bGluZVwiKSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd1JlY3RhbmdsZTogdG9vbHMuaW5jbHVkZXMoXCJyZWN0YW5nbGVcIiksXG4gICAgICAgICAgICAgICAgICAgIGRyYXdQb2x5Z29uOiB0b29scy5pbmNsdWRlcyhcInBvbHlnb25cIiksXG4gICAgICAgICAgICAgICAgICAgIGRyYXdDaXJjbGU6IHRvb2xzLmluY2x1ZGVzKFwiY2lyY2xlXCIpLFxuICAgICAgICAgICAgICAgICAgICBkcmF3Q2lyY2xlTWFya2VyOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd1RleHQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICByb3RhdGVNb2RlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgY3V0UG9seWdvbjogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIGVkaXRNb2RlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBkcmFnTW9kZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgcmVtb3ZhbE1vZGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1hcC5wbS5yZW1vdmVDb250cm9scygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHN5bmNEcmF3KCk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfZHJhd1wiLCBzeW5jRHJhdyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmRyYXdfY29uZmlnXCIsIHN5bmNEcmF3KTtcblxuICAgICAgICAvLyBUaGUgc2NhbGUgYmFyOiBMZWFmbGV0J3Mgb3duIGNvbnRyb2wsIHdoaWNoIG1lYXN1cmVzIHRocm91Z2ggdGhlIG1hcCdzIENSU1xuICAgICAgICAvLyAoaGF2ZXJzaW5lIHVuZGVyIDM4NTcgYW5kIDQzMjYgYWxpa2UgLS0gbm8gcGl4ZWwgbWF0aCBvZiBvdXJzKSwgZXh0ZW5kZWRcbiAgICAgICAgLy8gd2l0aCB0aGUgdW5pdCBMZWFmbGV0IGxhY2tzIGFuZCB0aGlzIGRvbWFpbiBydW5zIG9uOiBuYXV0aWNhbCBtaWxlcy5cbiAgICAgICAgY29uc3QgTmF1dGljYWxTY2FsZSA9IEwuQ29udHJvbC5TY2FsZS5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uIChtKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5vbkFkZC5jYWxsKHRoaXMsIG0pO1xuICAgICAgICAgICAgICAgIHRoaXMuX25hdXRpY2FsU2NhbGUgPSBMLkRvbVV0aWwuY3JlYXRlKFxuICAgICAgICAgICAgICAgICAgICBcImRpdlwiLCBcImxlYWZsZXQtY29udHJvbC1zY2FsZS1saW5lXCIsIGNvbnRhaW5lcik7XG4gICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRhaW5lcjtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBfdXBkYXRlU2NhbGVzOiBmdW5jdGlvbiAobWF4TWV0ZXJzKSB7XG4gICAgICAgICAgICAgICAgTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5fdXBkYXRlU2NhbGVzLmNhbGwodGhpcywgbWF4TWV0ZXJzKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbmF1dGljYWxTY2FsZSAmJiBtYXhNZXRlcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4Tm0gPSBtYXhNZXRlcnMgLyAxODUyO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBubSA9IHRoaXMuX2dldFJvdW5kTnVtKG1heE5tKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlU2NhbGUodGhpcy5fbmF1dGljYWxTY2FsZSwgYCR7bm19IG5tYCwgbm0gLyBtYXhObSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGV0IHNjYWxlQ29udHJvbCA9IG51bGw7XG4gICAgICAgIGZ1bmN0aW9uIHN5bmNTY2FsZSgpIHtcbiAgICAgICAgICAgIGlmIChzY2FsZUNvbnRyb2wpIHtcbiAgICAgICAgICAgICAgICBzY2FsZUNvbnRyb2wucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgc2NhbGVDb250cm9sID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghbW9kZWwuZ2V0KFwic2hvd19zY2FsZVwiKSkgcmV0dXJuO1xuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwic2NhbGVfY29uZmlnXCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgdW5pdHMgPSBjZmcudW5pdHMgfHwgXCJtZXRyaWNcIjtcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcG9zaXRpb246IChjZmcucG9zaXRpb24gfHwgXCJib3R0b20tbGVmdFwiKS5yZXBsYWNlKFwiLVwiLCBcIlwiKSxcbiAgICAgICAgICAgICAgICBtYXhXaWR0aDogY2ZnLm1heF93aWR0aCB8fCAxMjAsXG4gICAgICAgICAgICAgICAgbWV0cmljOiB1bml0cyA9PT0gXCJtZXRyaWNcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXG4gICAgICAgICAgICAgICAgaW1wZXJpYWw6IHVuaXRzID09PSBcImltcGVyaWFsXCIgfHwgdW5pdHMgPT09IFwiYm90aFwiLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbCA9IHVuaXRzID09PSBcIm5hdXRpY2FsXCJcbiAgICAgICAgICAgICAgICA/IG5ldyBOYXV0aWNhbFNjYWxlKG9wdGlvbnMpXG4gICAgICAgICAgICAgICAgOiBMLmNvbnRyb2wuc2NhbGUob3B0aW9ucyk7XG4gICAgICAgICAgICBzY2FsZUNvbnRyb2wuYWRkVG8obWFwKTtcbiAgICAgICAgfVxuICAgICAgICBzeW5jU2NhbGUoKTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19zY2FsZVwiLCBzeW5jU2NhbGUpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzY2FsZV9jb25maWdcIiwgc3luY1NjYWxlKTtcblxuICAgICAgICAvLyBFbXB0eS1tYXAgY2xpY2tzOiByZXBvcnQgd2hlcmUuIFJlZ2lzdGVyZWQgdGhyb3VnaCB0aGUgc2FtZSBhcmJpdHJhdGlvbiB0aGVcbiAgICAgICAgLy8gZmVhdHVyZSBoYW5kbGVycyB1c2UsIGF0IHRoZSBsb3dlc3QgcHJpb3JpdHksIHNvIGEgY2xpY2sgdGhhdCBoaXQgYSBmZWF0dXJlXG4gICAgICAgIC8vIHN0YXlzIHRoYXQgZmVhdHVyZSdzIGNsaWNrIC0tIHRoaXMgd2lucyBvbmx5IHdoZW4gbm90aGluZyBjbGFpbWVkIHRoZSBldmVudC5cbiAgICAgICAgLy8gZS5sYXRsbmcgaXMgYWxyZWFkeSB1bnByb2plY3RlZCB0aHJvdWdoIHdoaWNoZXZlciBDUlMgdGhlIG1hcCBydW5zICgzODU3IGFuZFxuICAgICAgICAvLyA0MzI2IGFsaWtlKSwgc28gdGhlcmUgaXMgbm8gcGl4ZWwgbWF0aCB0byBnZXQgd3JvbmcgaGVyZTsgd3JhcCgpIGtlZXBzIGFcbiAgICAgICAgLy8gd29ybGQtcGFubmVkIG1hcCBmcm9tIHJlcG9ydGluZyBsb25naXR1ZGUgLTM2NC5cbiAgICAgICAgbWFwLm9uKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDk5LCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGwgPSBlLmxhdGxuZy53cmFwKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gTWF0aC5yb3VuZChsbC5sYXQgKiAxZTUpIC8gMWU1O1xuICAgICAgICAgICAgICAgIGNvbnN0IGxuZyA9IE1hdGgucm91bmQobGwubG5nICogMWU1KSAvIDFlNTtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIFwiXCIpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAtMSk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF0bG5nXCIsIFtsYXQsIGxuZ10pO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja19zZXFcIiwgKG1vZGVsLmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgICAgICAgICBpZiAobW9kZWwuZ2V0KFwic2hvd19jbGlja19jb29yZGluYXRlc1wiKSkge1xuICAgICAgICAgICAgICAgICAgICBMLnBvcHVwKHsgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWNvb3Jkcy1wb3B1cFwiLCBjbG9zZUJ1dHRvbjogZmFsc2UgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5zZXRMYXRMbmcoZS5sYXRsbmcpXG4gICAgICAgICAgICAgICAgICAgICAgICAuc2V0Q29udGVudChgJHtsbC5sYXQudG9GaXhlZCg1KX0sICR7bGwubG5nLnRvRml4ZWQoNSl9YClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5vcGVuT24obWFwKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQmluZCB6b29tIGFuZCBjZW50ZXIgY2hhbmdlcyBiYWNrIHRvIFB5dGhvbiBzYWZlbHlcbiAgICAgICAgbWFwLm9uKFwibW92ZWVuZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50Wm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxDZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxab29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1vZGVsWm9vbSAhPT0gY3VycmVudFpvb207XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9ICFtb2RlbENlbnRlciB8fCBcbiAgICAgICAgICAgICAgICAgICAgIUFycmF5LmlzQXJyYXkobW9kZWxDZW50ZXIpIHx8XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsQ2VudGVyLmxlbmd0aCA8IDIgfHxcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMF0gLSBjZW50ZXIubGF0KSA+IDAuMDAwMSB8fCBcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMV0gLSBjZW50ZXIubG5nKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjZW50ZXJcIiwgW2NlbnRlci5sYXQsIGNlbnRlci5sbmddKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInpvb21cIiwgY3VycmVudFpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBzYWZlU2F2ZUNoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gbW92ZWVuZCBoYW5kbGVyOlwiLCBlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVNYXBWaWV3KCkge1xuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xuICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICBpZiAoY2VudGVyICYmIEFycmF5LmlzQXJyYXkoY2VudGVyKSAmJiBjZW50ZXIubGVuZ3RoID49IDIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBDZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWFwWm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9IE1hdGguYWJzKG1hcENlbnRlci5sYXQgLSBjZW50ZXJbMF0pID4gMC4wMDAxIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtYXBDZW50ZXIubG5nIC0gY2VudGVyWzFdKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1hcFpvb20gIT09IHpvb207XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFZpZXcoY2VudGVyLCB0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiA/IHpvb20gOiBtYXBab29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiAmJiBtYXAuZ2V0Wm9vbSgpICE9PSB6b29tKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKHpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdhdGNoIGZvciBtYXAgdmlldyB1cGRhdGVzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNlbnRlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ0NlbnRlckZyb21NYXApIHtcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnpvb21cIiwgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVXBkYXRpbmdab29tRnJvbU1hcCkge1xuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIEZpdHRpbmcgdGhlIHZpZXcgaXMgYSBjb21tYW5kLCBub3Qgc3RhdGU6IGFza2luZyB0byBmaXQgdGhlIHNhbWUgYm91bmRzIHR3aWNlXG4gICAgICAgIC8vIG11c3QgbW92ZSB0aGUgbWFwIGJvdGggdGltZXMsIHNpbmNlIHRoZSB1c2VyIG1heSBoYXZlIHBhbm5lZCBhd2F5IGluIGJldHdlZW4uXG4gICAgICAgIC8vIFRoZSByZXF1ZXN0IGNhcnJpZXMgYSBzZXF1ZW5jZSBudW1iZXIgc28gYW4gaWRlbnRpY2FsIGZpdCBzdGlsbCBmaXJlcyBhIGNoYW5nZS5cbiAgICAgICAgZnVuY3Rpb24gYXBwbHlGaXRSZXF1ZXN0KCkge1xuICAgICAgICAgICAgY29uc3QgcmVxID0gbW9kZWwuZ2V0KFwiZml0X2JvdW5kc19yZXF1ZXN0XCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgYm91bmRzID0gcmVxLmJvdW5kcztcbiAgICAgICAgICAgIGlmICghYm91bmRzIHx8IGJvdW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICAgICAgaWYgKHJlcS5wYWRkaW5nICE9IG51bGwpIG9wdGlvbnMucGFkZGluZyA9IFtyZXEucGFkZGluZywgcmVxLnBhZGRpbmddO1xuICAgICAgICAgICAgaWYgKHJlcS5tYXhfem9vbSAhPSBudWxsKSBvcHRpb25zLm1heFpvb20gPSByZXEubWF4X3pvb207XG4gICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcywgb3B0aW9ucyk7XG5cbiAgICAgICAgICAgIC8vIEFwcGxpZWQgYWZ0ZXIgdGhlIGZpdCwgc2luY2UgaXQgaXMgcmVsYXRpdmUgdG8gd2hhdGV2ZXIgem9vbSB0aGUgZml0IGNob3NlLlxuICAgICAgICAgICAgaWYgKHJlcS56b29tX29mZnNldCkge1xuICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKG1hcC5nZXRab29tKCkgKyByZXEuem9vbV9vZmZzZXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmZpdF9ib3VuZHNfcmVxdWVzdFwiLCBhcHBseUZpdFJlcXVlc3QpO1xuICAgICAgICAvLyBBIHJlcXVlc3Qgc2V0IGJlZm9yZSB0aGlzIHZpZXcgYXR0YWNoZWQgLS0gYSBwcmUtZGlzcGxheSBmaXRfYm91bmRzKCkgY2FsbCxcbiAgICAgICAgLy8gb3IgdGhlIHVuaW9uIGEgZnJlc2ggbWFwIG1haW50YWlucyBhcyBhdXRvLWZpdCB3aGlsZSBsYXllcnMgYXJlIGFkZGVkIC0tIGlzXG4gICAgICAgIC8vIGFscmVhZHkgc3RhdGUgYnkgbm93LCBzbyB0aGUgY2hhbmdlIGV2ZW50IHdpbGwgbmV2ZXIgZmlyZSBmb3IgaXQuIEl0IHVzZWRcbiAgICAgICAgLy8gdG8gYmUgc2lsZW50bHkgZHJvcHBlZDsgYXBwbHkgaXQgb25jZSB0aGUgbWFwIGlzIHJlYWR5IGluc3RlYWQuXG4gICAgICAgIG1hcC53aGVuUmVhZHkoKCkgPT4gYXBwbHlGaXRSZXF1ZXN0KCkpO1xuICAgICAgICAvLyBBIG1hcCBjb25zdHJ1Y3RlZCBpbnNpZGUgYSBoaWRkZW4gY29udGFpbmVyIC0tIGEgU2hpbnkgbmF2X3BhbmVsIHRoYXQgaXNcbiAgICAgICAgLy8gbm90IHRoZSBzZWxlY3RlZCB0YWIgLS0gaW5pdGlhbGlzZXMgYXQgMHgwLCBhbmQgTGVhZmxldCBjYWNoZXMgdGhhdCBzaXplOlxuICAgICAgICAvLyBpdHMgb3duIHRyYWNrUmVzaXplIHdhdGNoZXMgdGhlIFdJTkRPVywgbm90IHRoZSBjb250YWluZXIsIHNvIG5vdGhpbmcgZXZlclxuICAgICAgICAvLyBjb3JyZWN0cyBpdC4gVGhlIGZpdCBhYm92ZSB0aGVuIGNvbXB1dGVzIGl0cyB6b29tIGZyb20gYSB6ZXJvLXNpemUgbGllIGFuZFxuICAgICAgICAvLyB0aGUgdmlldyBsYW5kcyB3cm9uZyBwZXJtYW5lbnRseS4gV2F0Y2ggdGhlIGNvbnRhaW5lciBpdHNlbGY6IGV2ZXJ5IHJlc2l6ZVxuICAgICAgICAvLyByZS1tZWFzdXJlcywgYW5kIHRoZSBmaXJzdCB0cmFuc2l0aW9uIGZyb20gemVybyB0byByZWFsIHNpemUgcmUtYXBwbGllc1xuICAgICAgICAvLyB0aGUgcGVuZGluZyBmaXQgd2l0aCBhIHNpemUgdGhhdCBjYW4gYWN0dWFsbHkgaG9sZCBpdC5cbiAgICAgICAgaWYgKHR5cGVvZiBSZXNpemVPYnNlcnZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgbGV0IGhhZFNpemUgPSBjb250YWluZXIuY2xpZW50V2lkdGggPiAwICYmIGNvbnRhaW5lci5jbGllbnRIZWlnaHQgPiAwO1xuICAgICAgICAgICAgY29uc3QgY29udGFpbmVyUmVzaXplID0gbmV3IFJlc2l6ZU9ic2VydmVyKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBoYXNTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcbiAgICAgICAgICAgICAgICBpZiAoaGFzU2l6ZSkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuaW52YWxpZGF0ZVNpemUoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFoYWRTaXplKSBhcHBseUZpdFJlcXVlc3QoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaGFkU2l6ZSA9IGhhc1NpemU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lclJlc2l6ZS5vYnNlcnZlKGNvbnRhaW5lcik7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgc3luY1RpbWVvdXQgPSBudWxsO1xuICAgICAgICBsZXQgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgIGxldCBuZWVkc1N5bmMgPSBmYWxzZTtcblxuICAgICAgICBhc3luYyBmdW5jdGlvbiBwZXJmb3JtU3luYygpIHtcbiAgICAgICAgICAgIGlmIChpc1N5bmNpbmcpIHtcbiAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlzU3luY2luZyA9IHRydWU7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHN5bmNNYXBTdGF0ZSgpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIHN5bmNNYXBTdGF0ZTpcIiwgZXJyKTtcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYgKG5lZWRzU3luYykge1xuICAgICAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBxdWV1ZVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoIW1vZGVsLmdldChcImF1dG9fc3luY1wiKSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzeW5jVGltZW91dCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzeW5jVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSwgNTApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTGlzdGVuIGZvciBtYW51YWwgc3luYyB0cmlnZ2VyIGNoYW5nZXMgZnJvbSBQeXRob25cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c3luY190cmlnZ2VyXCIsICgpID0+IHtcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEluY3JlbWVudGFsIHVwZGF0ZXMgZnJvbSBQeXRob24uIEFwcGxpZWQgZXZlbiB3aGVuIGF1dG9fc3luYyBpcyBvZmYgc28gdGhlIG1pcnJvclxuICAgICAgICAvLyBzdGF5cyBjdXJyZW50OyBxdWV1ZVN5bmMgZGVjaWRlcyB3aGV0aGVyIHRvIGFjdHVhbGx5IHJlLXJlbmRlci5cbiAgICAgICAgbW9kZWwub24oXCJtc2c6Y3VzdG9tXCIsIChtc2csIGJ1ZmZlcnMpID0+IHtcbiAgICAgICAgICAgIGlmICghbXNnIHx8IG1zZy5raW5kICE9PSBcInN3aWZ0bWFwX3BhdGNoXCIpIHJldHVybjtcbiAgICAgICAgICAgIGFwcGx5UGF0Y2hPcHMobXNnLm9wcyB8fCBbXSwgYnVmZmVycyk7XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRnVsbC1zbmFwc2hvdCBwYXRoczogdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSwgYW5kIHRoZSBzaWRlYmFyIHdyaXRpbmcgYGxheWVyc2BcbiAgICAgICAgLy8gYmFjayBhZnRlciBhIHRvZ2dsZS4gRWl0aGVyIHdheSB0aGUgdHJhaXQgYmVjb21lcyBhdXRob3JpdGF0aXZlIGFnYWluLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsYXllcnNcIiwgKCkgPT4ge1xuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Y29vcmRpbmF0ZV9idWZmZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpncm91cF9jb25maWdzXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnRpbWVfY29uZmlnXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7ICAgLy8gcmUtYXBwbHkgc3BlZWQvbG9vcCBmcm9tIHRoZSBuZXcgY29uZmlnXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIFB5dGhvbiBzdGVlcmluZyB0aGUgc2xpZGVyOiBzbmFwIHRvIHRoZSBuZWFyZXN0IHRpY2sgYXQgb3IgYWZ0ZXIgdGhlIHJlcXVlc3RlZFxuICAgICAgICAvLyB0aW1lLiBHdWFyZGVkIHNvIHRoZSB3aWRnZXQncyBvd24gd3JpdGViYWNrIGRvZXMgbm90IGxvb3AgdGhyb3VnaCBoZXJlLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2N1cnJlbnRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgd2FudGVkID0gbW9kZWwuZ2V0KFwidGltZV9jdXJyZW50XCIpO1xuICAgICAgICAgICAgaWYgKCF0aW1lU3RhdGUgfHwgIXRpbWVVSS50aWNrcy5sZW5ndGgpIHJldHVybjtcbiAgICAgICAgICAgIGlmIChNYXRoLmFicyh3YW50ZWQgLSB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSkgPCAxKSByZXR1cm47XG4gICAgICAgICAgICBsZXQgaWR4ID0gdGltZVVJLnRpY2tzLmZpbmRJbmRleCh0ID0+IHQgPj0gd2FudGVkKTtcbiAgICAgICAgICAgIGlmIChpZHggPT09IC0xKSBpZHggPSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMTtcbiAgICAgICAgICAgIHNlZWtUbyhpZHgsIHsgd3JpdGU6IGZhbHNlIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19sb2dvXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbGVnZW5kXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmxlZ2VuZF9jb25maWdcIiwgcXVldWVTeW5jKTtcbiAgICAgICAgLy8gTGl2ZSByZXNpemVzIChhIFNoaW55IGxheW91dCwgYSBub3RlYm9vayBjZWxsKTogTGVhZmxldCBjYWNoZXMgaXRzIGJveCwgc29cbiAgICAgICAgLy8gaXQgbXVzdCBiZSB0b2xkIHRvIHJlLW1lYXN1cmUgb3IgdGlsZXMgcmVuZGVyIGZvciB0aGUgb2xkIHNpemUuXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmhlaWdodFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBhcHBseUhlaWdodCgpO1xuICAgICAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFubm91bmNlIHRoaXMgdmlldyBzbyBQeXRob24gcmVwbGllcyB3aXRoIGEgZnVsbCBzbmFwc2hvdC4gTGF5ZXJzIGFkZGVkIGJlZm9yZVxuICAgICAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXG4gICAgICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBtb2RlbC5zZW5kKHsga2luZDogXCJzd2lmdG1hcF9yZWFkeVwiIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGlzIGFsbCB0aGVyZSBpcyAqLyB9XG5cbiAgICAgICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcbiAgICAgICAgaWYgKG1vZGVsLmdldChcImF1dG9fc3luY1wiKSB8fCBtb2RlbC5nZXQoXCJzeW5jX3RyaWdnZXJcIikgPiAwKSB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBTyxTQUFTLFFBQVEsSUFBSSxLQUFLO0FBQzdCLE1BQUksQ0FBQyxTQUFTLGVBQWUsRUFBRSxHQUFHO0FBQzlCLFVBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTTtBQUMxQyxTQUFLLEtBQUs7QUFDVixTQUFLLE1BQU07QUFDWCxTQUFLLE9BQU87QUFDWixhQUFTLEtBQUssWUFBWSxJQUFJO0FBQUEsRUFDbEM7QUFDSjtBQUVBLElBQU0sZ0JBQWdCLENBQUM7QUFFaEIsU0FBUyxPQUFPLElBQUksS0FBSztBQUM1QixNQUFJLGNBQWMsRUFBRSxHQUFHO0FBQ25CLFdBQU8sY0FBYyxFQUFFO0FBQUEsRUFDM0I7QUFDQSxRQUFNLFVBQVUsSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQzdDLFFBQUksU0FBUyxlQUFlLEVBQUUsR0FBRztBQUM3QixjQUFRO0FBQ1I7QUFBQSxJQUNKO0FBQ0EsVUFBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLFdBQU8sS0FBSztBQUNaLFdBQU8sTUFBTTtBQUNiLFdBQU8sU0FBUyxNQUFNLFFBQVE7QUFDOUIsV0FBTyxVQUFVLE1BQU0sT0FBTyxJQUFJLE1BQU0sMEJBQTBCLEdBQUcsRUFBRSxDQUFDO0FBQ3hFLGFBQVMsS0FBSyxZQUFZLE1BQU07QUFBQSxFQUNwQyxDQUFDO0FBQ0QsZ0JBQWMsRUFBRSxJQUFJO0FBQ3BCLFNBQU87QUFDWDtBQUVBLFNBQVMsU0FBUyxLQUFLO0FBQ25CLE1BQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsUUFBTSxJQUFJLFFBQVEsTUFBTSxFQUFFO0FBQzFCLE1BQUksSUFBSSxXQUFXLEdBQUc7QUFDbEIsVUFBTSxJQUFJLE1BQU0sRUFBRSxFQUFFLElBQUksVUFBUSxPQUFPLElBQUksRUFBRSxLQUFLLEVBQUU7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QUFZO0FBQ3JDLFVBQUksQ0FBQyxPQUFPLElBQUksU0FBUyxpQkFBa0I7QUFDM0Msb0JBQWMsSUFBSSxPQUFPLENBQUMsR0FBRyxPQUFPO0FBQ3BDLGdCQUFVO0FBQUEsSUFDZCxDQUFDO0FBSUQsVUFBTSxHQUFHLGlCQUFpQixNQUFNO0FBQzVCLG1CQUFhLE1BQU0sSUFBSSxRQUFRLEtBQUssQ0FBQztBQUNyQyxnQkFBVTtBQUFBLElBQ2QsQ0FBQztBQUNELFVBQU0sR0FBRyw2QkFBNkIsTUFBTTtBQUN4QyxvQkFBYyxFQUFFLEdBQUksTUFBTSxJQUFJLG9CQUFvQixLQUFLLENBQUMsRUFBRztBQUMzRCxnQkFBVTtBQUFBLElBQ2QsQ0FBQztBQUNELFVBQU0sR0FBRyx3QkFBd0IsU0FBUztBQUMxQyxVQUFNLEdBQUcsc0JBQXNCLE1BQU07QUFDakMsYUFBTyxVQUFVO0FBQ2pCLGdCQUFVO0FBQUEsSUFDZCxDQUFDO0FBR0QsVUFBTSxHQUFHLHVCQUF1QixNQUFNO0FBQ2xDLFlBQU0sU0FBUyxNQUFNLElBQUksY0FBYztBQUN2QyxVQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sTUFBTSxPQUFRO0FBQ3hDLFVBQUksS0FBSyxJQUFJLFNBQVMsT0FBTyxNQUFNLE9BQU8sS0FBSyxDQUFDLElBQUksRUFBRztBQUN2RCxVQUFJLE1BQU0sT0FBTyxNQUFNLFVBQVUsT0FBSyxLQUFLLE1BQU07QUFDakQsVUFBSSxRQUFRLEdBQUksT0FBTSxPQUFPLE1BQU0sU0FBUztBQUM1QyxhQUFPLEtBQUssRUFBRSxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQ2hDLENBQUM7QUFDRCxVQUFNLEdBQUcsb0JBQW9CLFNBQVM7QUFDdEMsVUFBTSxHQUFHLHNCQUFzQixTQUFTO0FBQ3hDLFVBQU0sR0FBRyx3QkFBd0IsU0FBUztBQUcxQyxVQUFNLEdBQUcsaUJBQWlCLE1BQU07QUFDNUIsa0JBQVk7QUFDWixVQUFJLGVBQWU7QUFBQSxJQUN2QixDQUFDO0FBS0QsUUFBSTtBQUNBLFlBQU0sS0FBSyxFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFBQSxJQUN6QyxTQUFTLEtBQUs7QUFBQSxJQUFtRTtBQUdqRixRQUFJLE1BQU0sSUFBSSxXQUFXLEtBQUssTUFBTSxJQUFJLGNBQWMsSUFBSSxHQUFHO0FBQ3pELGtCQUFZO0FBQUEsSUFDaEI7QUFBQSxFQUNKO0FBQ0o7IiwKICAibmFtZXMiOiBbImdsTGF5ZXIiLCAiaW5zdGFuY2UiLCAiTCIsICJjb250YWluZXIiLCAiem9vbSJdCn0K
