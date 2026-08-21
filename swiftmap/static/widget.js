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
async function renderLayer(map, layer, coordBuffer, model) {
  if (layer.type === "image") {
    return renderImageLayer(map, layer, coordBuffer);
  }
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
async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, model, timeState = null, vectorGpu = false, isFeatureVisible = null) {
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
    map.createPane("swiftmapDrawPane");
    map.getPane("swiftmapDrawPane").style.zIndex = "440";
    labelsGroup = L.layerGroup().addTo(map);
    let layerState = model.get("layers") || [];
    let bufferState = { ...model.get("coordinate_buffers") || {} };
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
      if (!isLayerEffectiveVisible(current, model.get("group_configs") || {})) {
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
          const staleImage = layer.type === "image" && (existing.imageMeta !== imageMetaKey(layer) || existing.imageSource !== (coordinateBuffers[layer.id] || null));
          if (existing.layerType !== layer.type || staleImage) {
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
            state.layer = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, model, timeState, vectorGpu, featureVisibleNow);
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
      const show = model.get("show_draw");
      const cfg = model.get("draw_config") || {};
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
      const pm = map.pm;
      map._pmModeActive = Boolean(pm && (pm.globalRemovalModeEnabled && pm.globalRemovalModeEnabled() || pm.globalEditModeEnabled && pm.globalEditModeEnabled() || pm.globalDragModeEnabled && pm.globalDragModeEnabled() || pm.globalDrawModeEnabled && pm.globalDrawModeEnabled()));
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3NoYWRlcnMuanMiLCAiLi4vLi4vc3JjL3RpbWVjb250cm9sLmpzIiwgIi4uLy4uL3NyYy9ncHV0aW1lLmpzIiwgIi4uLy4uL3NyYy9sYXllcnMuanMiLCAiLi4vLi4vc3JjL2xhYmVscy5qcyIsICIuLi8uLi9zcmMvbWFwLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgZnVuY3Rpb24gbG9hZENTUyhpZCwgdXJsKSB7XG4gICAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgY29uc3QgbGluayA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJsaW5rXCIpO1xuICAgICAgICBsaW5rLmlkID0gaWQ7XG4gICAgICAgIGxpbmsucmVsID0gXCJzdHlsZXNoZWV0XCI7XG4gICAgICAgIGxpbmsuaHJlZiA9IHVybDtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChsaW5rKTtcbiAgICB9XG59XG5cbmNvbnN0IGFjdGl2ZUxvYWRlcnMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKUyhpZCwgdXJsKSB7XG4gICAgaWYgKGFjdGl2ZUxvYWRlcnNbaWRdKSB7XG4gICAgICAgIHJldHVybiBhY3RpdmVMb2FkZXJzW2lkXTtcbiAgICB9XG4gICAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgaWYgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzY3JpcHRcIik7XG4gICAgICAgIHNjcmlwdC5pZCA9IGlkO1xuICAgICAgICBzY3JpcHQuc3JjID0gdXJsO1xuICAgICAgICBzY3JpcHQub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xuICAgICAgICBzY3JpcHQub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIHNjcmlwdDogJHt1cmx9YCkpO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHNjcmlwdCk7XG4gICAgfSk7XG4gICAgYWN0aXZlTG9hZGVyc1tpZF0gPSBwcm9taXNlO1xuICAgIHJldHVybiBwcm9taXNlO1xufVxuXG5mdW5jdGlvbiBoZXhUb1JnYihoZXgpIHtcbiAgICBpZiAoIWhleCkgcmV0dXJuIG51bGw7XG4gICAgaGV4ID0gaGV4LnJlcGxhY2UoL14jLywgJycpO1xuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XG4gICAgICAgIGhleCA9IGhleC5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhciArIGNoYXIpLmpvaW4oJycpO1xuICAgIH1cbiAgICBpZiAoaGV4Lmxlbmd0aCAhPT0gNikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbnVtID0gcGFyc2VJbnQoaGV4LCAxNik7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcjogKChudW0gPj4gMTYpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgZzogKChudW0gPj4gOCkgJiAyNTUpIC8gMjU1LFxuICAgICAgICBiOiAobnVtICYgMjU1KSAvIDI1NVxuICAgIH07XG59XG5cbmxldCBjb2xvclByb2JlID0gbnVsbDtcblxuLy8gQnJvd3NlcnMgc2hpcCBhIGNvbXBsZXRlIENTUyBjb2xvciBwYXJzZXIgLS0gZXZlcnkgbmFtZWQgY29sb3IsIHJnYigpLCBoc2woKSwgaHdiKCkuXG4vLyBCb3Jyb3cgaXQgaW5zdGVhZCBvZiBtYWludGFpbmluZyBhIGxvb2t1cCB0YWJsZS4gUmV0dXJucyBudWxsIG91dHNpZGUgYSBET00gKE5vZGUgdGVzdHMpLFxuLy8gd2hlcmUgdGhlIGhleCBmYWxsYmFjayBpbiBwYXJzZUNvbG9yIHN0aWxsIGFwcGxpZXMuXG5mdW5jdGlvbiBjc3NDb2xvclRvUmdiKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFjb2xvclByb2JlKSBjb2xvclByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKS5nZXRDb250ZXh0KFwiMmRcIik7XG5cbiAgICAvLyBBc3NpZ25pbmcgYW4gaW52YWxpZCBjb2xvciBsZWF2ZXMgZmlsbFN0eWxlIHVudG91Y2hlZCwgc28gcHJvYmUgYWdhaW5zdCB0d28gZGlmZmVyZW50XG4gICAgLy8gc2VudGluZWxzOiBvbmx5IGEgdmFsdWUgdGhlIGJyb3dzZXIgYWN0dWFsbHkgcGFyc2VkIHByb2R1Y2VzIHRoZSBzYW1lIHJlc3VsdCB0d2ljZS5cbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiIzAwMDAwMFwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgY29uc3QgZmlyc3QgPSBjb2xvclByb2JlLmZpbGxTdHlsZTtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiI2ZmZmZmZlwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgaWYgKGZpcnN0ICE9PSBjb2xvclByb2JlLmZpbGxTdHlsZSkgcmV0dXJuIG51bGw7XG5cbiAgICBpZiAoZmlyc3Quc3RhcnRzV2l0aChcIiNcIikpIHJldHVybiBoZXhUb1JnYihmaXJzdCk7XG4gICAgY29uc3QgbWF0Y2ggPSBmaXJzdC5tYXRjaCgvcmdiYT9cXCgoW14pXSspXFwpLyk7XG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcGFydHMgPSBtYXRjaFsxXS5zcGxpdChcIixcIikubWFwKHAgPT4gcGFyc2VGbG9hdChwLnRyaW0oKSkpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzIHx8IHBhcnRzLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsgcjogcGFydHNbMF0gLyAyNTUsIGc6IHBhcnRzWzFdIC8gMjU1LCBiOiBwYXJ0c1syXSAvIDI1NSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb2xvcihjb2xvclN0ciwgZmFsbGJhY2tIZXggPSBcIiMzMzg4ZmZcIikge1xuICAgIGlmICghY29sb3JTdHIpIGNvbG9yU3RyID0gZmFsbGJhY2tIZXg7XG4gICAgcmV0dXJuIGNzc0NvbG9yVG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGhleFRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBjc3NDb2xvclRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCBoZXhUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG59XG5cbmNvbnN0IFVSTF9BVFRSX0JFRk9SRSA9IC8oPzpocmVmfHNyYylcXHMqPVxccypbJ1wiXT8kL2k7XG5jb25zdCBTQUZFX1VSTCA9IC9eKD86aHR0cHM/OlxcL1xcL3xtYWlsdG86fHRlbDp8ZGF0YTppbWFnZVxcL3xbLi8jP118W1xcdy4tXSsoPzpbLz8jXXwkKSkvaTtcblxuLy8gUHJvcGVydHkgdmFsdWVzIGNvbWUgZnJvbSB1c2VyIGRhdGEgYW5kIGVuZCB1cCBpbiBpbm5lckhUTUwsIHNvIHRoZXkgYXJlIGVzY2FwZWQuXG4vLyBNYXJrdXAgdGhlIGFwcCBhdXRob3Igd3JvdGUgKHRlbXBsYXRlcywgc3R5bGUgc3RyaW5ncykgaXMgbGVmdCBpbnRhY3QuXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpXG4gICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcbn1cblxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXG4vLyBpbiBhIFVSTCBhdHRyaWJ1dGUgZ2V0IGEgc2NoZW1lIGNoZWNrLiBDb250cm9sIGNoYXJhY3RlcnMgYXJlIHN0cmlwcGVkIGZpcnN0IGJlY2F1c2Vcbi8vIFwiamF2YVxcdHNjcmlwdDpcIiBzdXJ2aXZlcyBhIG5haXZlIGNvbXBhcmlzb24uXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZSkge1xuICAgIGNvbnN0IGNvbGxhcHNlZCA9IFN0cmluZyh2YWx1ZSkuc3BsaXQoXCJcIikuZmlsdGVyKGMgPT4gYy5jaGFyQ29kZUF0KDApID4gMzIpLmpvaW4oXCJcIik7XG4gICAgcmV0dXJuIFNBRkVfVVJMLnRlc3QoY29sbGFwc2VkKSA/IFN0cmluZyh2YWx1ZSkgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICBjb25zdCB0YXJnZXRGaWVsZHMgPSAoQXJyYXkuaXNBcnJheShmaWVsZHMpICYmIGZpZWxkcy5sZW5ndGgpID8gZmllbGRzIDogT2JqZWN0LmtleXMocHJvcHMpO1xuICAgIGNvbnN0IGxhYmVscyA9IChBcnJheS5pc0FycmF5KG5hbWVzKSAmJiBuYW1lcy5sZW5ndGggPT09IHRhcmdldEZpZWxkcy5sZW5ndGgpID8gbmFtZXMgOiB0YXJnZXRGaWVsZHM7XG4gICAgY29uc3QgbGluZXMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldEZpZWxkcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBmID0gdGFyZ2V0RmllbGRzW2ldO1xuICAgICAgICBpZiAocHJvcHNbZl0gPT09IHVuZGVmaW5lZCB8fCBwcm9wc1tmXSA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGxpbmVzLnB1c2goYDxiPiR7ZXNjYXBlSHRtbChsYWJlbHNbaV0pfTwvYj46ICR7ZXNjYXBlSHRtbChwcm9wc1tmXSl9YCk7XG4gICAgfVxuICAgIHJldHVybiBsaW5lcy5qb2luKFwiPGJyPlwiKTtcbn1cblxuLy8gXCJ7Y29sdW1ufVwiIGluc2VydHMgb25lIGVzY2FwZWQgdmFsdWU7IFwieyp9XCIgaW5zZXJ0cyB0aGUgZGVmYXVsdCBmaWVsZCBsaXN0LlxuZnVuY3Rpb24gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlLnJlcGxhY2UoL1xceyhcXCp8XFx3KylcXH0vZywgKG1hdGNoLCBrZXksIG9mZnNldCkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcIipcIikge1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2YWwgPSBwcm9wc1trZXldO1xuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgICAgICAgY29uc3QgcHJlY2VkaW5nID0gdGVtcGxhdGUuc2xpY2UoTWF0aC5tYXgoMCwgb2Zmc2V0IC0gMTYpLCBvZmZzZXQpO1xuICAgICAgICByZXR1cm4gZXNjYXBlSHRtbChVUkxfQVRUUl9CRUZPUkUudGVzdChwcmVjZWRpbmcpID8gc2FmZVVybCh2YWwpIDogdmFsKTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBraW5kKSB7XG4gICAgY29uc3QgdGVtcGxhdGUgPSBsYXllcltraW5kICsgXCJfdGVtcGxhdGVcIl07XG4gICAgY29uc3QgZmllbGRzID0gbGF5ZXJba2luZCArIFwiX2ZpZWxkc1wiXTtcbiAgICBjb25zdCBuYW1lcyA9IGxheWVyW2tpbmQgKyBcIl9uYW1lc1wiXTtcbiAgICBpZiAodHlwZW9mIHRlbXBsYXRlID09PSBcInN0cmluZ1wiICYmIHRlbXBsYXRlKSB7XG4gICAgICAgIHJldHVybiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgIH1cbiAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xufVxuXG5mdW5jdGlvbiB3cmFwU3R5bGVkKGh0bWwsIHN0eWxlKSB7XG4gICAgaWYgKCFzdHlsZSkgcmV0dXJuIGh0bWw7XG4gICAgcmV0dXJuIGA8ZGl2IHN0eWxlPVwiJHtlc2NhcGVIdG1sKHN0eWxlKX1cIj4ke2h0bWx9PC9kaXY+YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQb3B1cChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInBvcHVwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF9wb3B1cCB8fCBsYXllci5wb3B1cF9maWVsZHMgfHwgbGF5ZXIucG9wdXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgaWYgKGxheWVyLnBvcHVwX21heF93aWR0aCkgb3B0aW9ucy5tYXhXaWR0aCA9IGxheWVyLnBvcHVwX21heF93aWR0aDtcbiAgICAgICAgTC5wb3B1cChvcHRpb25zKVxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnBvcHVwX3N0eWxlKSlcbiAgICAgICAgICAgIC5vcGVuT24obWFwKTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kVG9vbHRpcChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyLCBsYXllckluc3RhbmNlKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInRvb2x0aXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3Rvb2x0aXAgfHwgbGF5ZXIudG9vbHRpcF9maWVsZHMgfHwgbGF5ZXIudG9vbHRpcF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgaWYgKCFsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwID0gTC50b29sdGlwKHsgZGlyZWN0aW9uOiAndG9wJywgb2Zmc2V0OiBbMCwgLTVdIH0pO1xuICAgICAgICB9XG4gICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXBcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci50b29sdGlwX3N0eWxlKSlcbiAgICAgICAgICAgIC5hZGRUbyhtYXApO1xuICAgIH1cbn1cbiIsICJjb25zdCBjb2xsYXBzZWRQYXRocyA9IHt9OyAgLy8gcGF0aCAtPiBjb2xsYXBzZWQ/XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJCb3VuZHMobCwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmICghbCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgLy8gU3VwcG9ydCBmb2xkZXIgdHJlZSBub2RlcyAoZ3JvdXBzIGluIHNpZGViYXIgdHJlZSlcclxuICAgIGlmIChsLmlzR3JvdXApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZHJlbiBncm91cHNcclxuICAgICAgICBPYmplY3Qua2V5cyhsLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhsLmNoaWxkcmVuW2tleV0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGQgbGF5ZXJzXHJcbiAgICAgICAgbC5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobHlyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChsLmJvdW5kcyAmJiBsLmJvdW5kcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgcmV0dXJuIGwuYm91bmRzO1xyXG4gICAgfVxyXG4gICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbC5sYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobC5sb2NhdGlvbnMgJiYgbC5sb2NhdGlvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IGwubG9jYXRpb25zLmZsYXQoSW5maW5pdHkpO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpXTtcclxuICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKyAxXTtcclxuICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdO1xyXG4gICAgICAgIGlmIChidWYpIHtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShidWYuYnVmZmVyLCBidWYuYnl0ZU9mZnNldCwgYnVmLmJ5dGVMZW5ndGggLyA4KTtcclxuICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGggLyAyOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpICogMl07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBUaGUgd3JpdGUgaGFsZiBvZiBhIHZpc2liaWxpdHkgdG9nZ2xlOiBvbmUgY3VzdG9tIG1lc3NhZ2UgbmFtaW5nIHRoZSBmbGlwcGVkIGlkcyxcclxuLy8gaW5zdGVhZCBvZiB0aGUgd2hvbGUgbGF5ZXJzIHRyYWl0LiBQeXRob24gYXBwbGllcyB0aGUgZmllbGRzIGFuZCByZS1lbWl0cyB0aGVtIGFzXHJcbi8vIGBzZXRgIHBhdGNoIG9wcywgd2hpY2ggaXMgaG93IG90aGVyIHZpZXdzIG9mIHRoZSBzYW1lIG1hcCAobm90ZWJvb2sgb3V0cHV0cykgc3RheVxyXG4vLyBpbiBzdGVwIG5vdyB0aGF0IHRoZSB0cmFpdCBubyBsb25nZXIgY2FycmllcyB0b2dnbGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gc2VuZExheWVyV3JpdGUobW9kZWwsIGNoYW5nZXMpIHtcclxuICAgIGlmICghY2hhbmdlcy5sZW5ndGgpIHJldHVybjtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgbW9kZWwuc2VuZCh7XHJcbiAgICAgICAgICAgIGtpbmQ6IFwic3dpZnRtYXBfd3JpdGVcIixcclxuICAgICAgICAgICAgb3BzOiBjaGFuZ2VzLm1hcChjID0+ICh7IG9wOiBcInNldFwiLCBpZDogYy5pZCwgZmllbGRzOiB7IHZpc2libGU6IGMudmlzaWJsZSB9IH0pKSxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSByZW5kZXJlZCBsaXN0IGFscmVhZHkgaG9sZHMgdGhlIGNoYW5nZSAqLyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZXBvcnRzIHdoYXQgaXQgY2hhbmdlZCAtLSB7Y2hhbmdlczogW3tpZCwgdmlzaWJsZX1dLCBncm91cHNDaGFuZ2VkfSAtLSBzbyB0aGVcclxuICAgIC8vIGNhbGxlciBjYW4gd3JpdGUgYmFjayBleGFjdGx5IHRob3NlIGZsaXBzIHJhdGhlciB0aGFuIHRoZSB3aG9sZSBsYXllcnMgbGlzdC5cclxuICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgIGxldCBncm91cHNDaGFuZ2VkID0gZmFsc2U7XHJcbiAgICBmdW5jdGlvbiBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUpIHtcclxuICAgICAgICBjb25zdCBjb25mID0gZ3JvdXBDb25maWdzW25vZGUucGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc1JhZGlvR3JvdXAgPSBjb25mLm11bHRpX3NlbGVjdCA9PT0gZmFsc2U7XHJcbiAgICAgICAgaWYgKGlzUmFkaW9Hcm91cCkge1xyXG4gICAgICAgICAgICBsZXQgZm91bmRBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRHcm91cCA9IG5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBzQ2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGx5ci52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZTogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlLmNoaWxkcmVuW2tleV0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyh0cmVlKTtcclxuICAgIHJldHVybiB7IGNoYW5nZXMsIGdyb3Vwc0NoYW5nZWQgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZsaXBwZWQgb24gdGhlIGxpc3QgdGhpcyBzaWRlYmFyIHJlbmRlcmVkIGZyb20sIG5ldmVyIG1vZGVsLmdldChcImxheWVyc1wiKS5cclxuICAgICAgICAgICAgICAgIC8vIExheWVycyBhZGRlZCBhZnRlciB0aGUgd2lkZ2V0IGlzIGRpc3BsYXllZCBhcnJpdmUgYXMgcGF0Y2hlcyB0aGF0IHVwZGF0ZSB0aGVcclxuICAgICAgICAgICAgICAgIC8vIGZyb250ZW5kJ3MgbG9jYWwgc3RhdGUgd2l0aG91dCB0b3VjaGluZyB0aGUgdHJhaXQsIHNvIHRoZSBtb2RlbCdzIGNvcHkgaXNcclxuICAgICAgICAgICAgICAgIC8vIGZyb3plbiBhdCB3aGF0ZXZlciB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGNhcnJpZWQuIEJ1aWxkaW5nIHRoZSB1cGRhdGUgZnJvbVxyXG4gICAgICAgICAgICAgICAgLy8gaXQgZHJvcHMgZXZlcnkgbGF0ZXIgbGF5ZXI6IHRoZSB0b2dnbGUgbWF0Y2hlcyBubyBpZCwgd3JpdGVzIHRoZSBzdGFsZSBsaXN0XHJcbiAgICAgICAgICAgICAgICAvLyBiYWNrLCBhbmQgdGhlIGNoYW5nZSBoYW5kbGVyIHRoZW4gcmVzZXRzIGxvY2FsIHN0YXRlIHRvIGl0IC0tIHNvIHRoZSBib3hcclxuICAgICAgICAgICAgICAgIC8vIHJlLWNoZWNrcyBpdHNlbGYgYW5kIHRoZSBsYXllciBuZXZlciBoaWRlcy5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgZmxpcHMgbXV0YXRlIHRoZSByZW5kZXJlZCBsaXN0IGluIHBsYWNlIGFuZCByZWFjaCBQeXRob24gYXMgYSB0YXJnZXRlZFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUgKHNlbmRMYXllcldyaXRlKSwgbmV2ZXIgYnkgc2V0dGluZyB0aGUgbGF5ZXJzIHRyYWl0OiB0aGUgZnVsbFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUtYmFjayBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlIGNsaWNrLiBBdCAyNSB0cmFja3MgeCAyMDBrXHJcbiAgICAgICAgICAgICAgICAvLyB2ZXJ0aWNlcyBpdCB3YXMgYSAzNiBNQiBmcmFtZSAtLSBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0IHdlYnNvY2tldFxyXG4gICAgICAgICAgICAgICAgLy8gY2FwLCBzbyB0aGUgc2VydmVyIGNsb3NlZCB0aGUgY29ubmVjdGlvbiBhbmQgdGhlIFNoaW55IHNlc3Npb24gZGllZCBvblxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGNoZWNrYm94LiBTZXR0aW5nIHRoZSB0cmFpdCB3aXRob3V0IHNhdmluZyBpcyBqdXN0IGFzIGZhdGFsOlxyXG4gICAgICAgICAgICAgICAgLy8gaXQgc3RheXMgZGlydHkgYW5kIHRoZSBuZXh0IHNhdmVfY2hhbmdlcyAoYW55IHBhbikgZmx1c2hlcyBpdC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZsaXAgPSAobHlyLCB2aXNpYmxlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKChseXIudmlzaWJsZSAhPT0gZmFsc2UpID09PSB2aXNpYmxlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSB2aXNpYmxlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGUgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGlvIGJ1dHRvbiBsb2dpYzogc2V0IGFsbCBzaWJsaW5ncyB0byB2aXNpYmxlPWZhbHNlLCBhbmQgdGhpcyB0byB2aXNpYmxlPXRydWVcclxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYkdyb3VwID0gcGFyZW50Tm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBzaWJHcm91cC5wYXRoID09PSBwYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbc2liR3JvdXAucGF0aF0gPSAhYWN0aXZlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IGZsaXAoc2liTHlyLCBzaWJMeXIuaWQgPT09IGlkKSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3BhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBseXIgPSBsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGx5cikgZmxpcChseXIsIGlzQ2hlY2tlZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCBjaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIC8vIGdyb3VwX2NvbmZpZ3Mgc3RheXMgb24gdGhlIHRyYWl0OiBpdCBpcyBhIGhhbmRmdWwgb2YgZm9sZGVyIGZsYWdzLCBhbmQgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyBzcHJlYWQgZ2l2ZXMgQmFja2JvbmUgYSBmcmVzaCByZWZlcmVuY2Ugc28gdGhlIGluLXBsYWNlIGVkaXRzIHJlZ2lzdGVyLlxyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0NoZWNrZWQgJiYgbWFwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYm91bmRzID0gZ2V0TGF5ZXJCb3VuZHMobm9kZSwgbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYm91bmRzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBvbkxheWVyVG9nZ2xlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQobm9kZURpdik7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVuZGVyIHRyZWUgZnJvbSByb290IG5vZGVcclxuICAgIHJlbmRlck5vZGUodHJlZSwgc2lkZWJhciwgMCwgbnVsbCwgdHJ1ZSk7XHJcbn1cclxuIiwgIi8vIFRoZSBsZWdlbmQ6IGRlcml2ZWQgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSBldmVyeXRoaW5nIGVsc2UgcmVuZGVycyBmcm9tLCB3aXRoXG4vLyBkZWNsYXJhdGl2ZSBvdmVycmlkZXMgb24gdG9wLiBEZWxpYmVyYXRlbHkgbW9kZWwtZnJlZSAtLSBwdXJlIGRhdGEgaW4sIERPTSBvdXQgLS1cbi8vIHNvIGEgcGxhaW4tSlMgY29uc3VtZXIgb2YgZGlzdC9pbmRleC5qcyBnZXRzIHRoZSB3aG9sZSBmZWF0dXJlLCBhbmQgdGhlIGFueXdpZGdldFxuLy8gZ2x1ZSBpbiBtYXAuanMgaXMgYSBmZXcgbGluZXMuIChzaWRlYmFyLmpzIHN0aWxsIHRha2VzIGBtb2RlbGAgYW5kIGlzIGZpbGVkIGZvclxuLy8gZXh0cmFjdGlvbjsgdGhpcyBtb2R1bGUgbXVzdCBuZXZlciBuZWVkIHRoYXQgdW5waWNraW5nLilcbi8vXG4vLyBUaGUgcGlwZWxpbmU6IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykgd2Fsa3MgdGhlIGxheWVycyBpbnRvXG4vLyBlbnRyaWVzIChza2lwcGVkIGVudGlyZWx5IHdoZW4gY29uZmlnLmF1dG8gPT09IGZhbHNlKSwgYXBwbGllcyB0aGUgcGVyc2lzdGVudFxuLy8gcmVtb3ZlLW1hdGNoZXJzLCBhcHBlbmRzIHRoZSBtYW51YWwgYWRkcywgYW5kIHJldHVybnMgYSBzcGVjIHRoYXQgcmVuZGVyTGVnZW5kXG4vLyB0dXJucyBpbnRvIERPTS4gTm90aGluZyBoZXJlIGtub3dzIGFib3V0IGNvbG9ybWFwczogcmFtcC9jYXRlZ29yeS9iaW4gZW50cmllc1xuLy8gYXJyaXZlIHdpdGggdGhlaXIgY29sb3VycyBhbHJlYWR5IHJlc29sdmVkIChQeXRob24gcmVzb2x2ZXMgYXQgdGhlIGFkZF8qIGJvdW5kYXJ5LFxuLy8gbWFudWFsIGVudHJpZXMgYXQgbGVnZW5kX2FkZCksIHNvIHRoZXJlIGlzIG5vIGFuY2hvciB0YWJsZSB0byBkcmlmdC5cblxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9tYXAuanNcIjtcblxuY29uc3QgR0xZUEhTID0ge1xuICAgIGNpcmNsZV9tYXJrZXJzOiBcImNpcmNsZVwiLFxuICAgIG1hcmtlcnM6IFwicGluXCIsXG4gICAgcG9seWxpbmU6IFwibGluZVwiLFxuICAgIHBvbHlnb246IFwicG9seWdvblwiLFxuICAgIGNpcmNsZTogXCJjaXJjbGVcIixcbn07XG5cbmZ1bmN0aW9uIHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiBcInN3YXRjaFwiLFxuICAgICAgICBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsXG4gICAgICAgIHNoYXBlOiBHTFlQSFNbbGF5ZXIudHlwZV0gfHwgXCJzcXVhcmVcIixcbiAgICAgICAgY29sb3I6IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBmaWxsQ29sb3I6IGxheWVyLmZpbGxDb2xvciB8fCBsYXllci5maWxsX2NvbG9yIHx8IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBoaWRkZW4sXG4gICAgfTtcbn1cblxuLy8gQSBkYXRhLWRyaXZlbiBibG9jayByZWNvcmRlZCBhdCBhZGQgdGltZSAoe2tpbmQsIGFuY2hvcnN8aXRlbXN8ZWRnZXMrY29sb3JzLCAuLi59KVxuLy8gYmVjb21lcyB0aGUgbGF5ZXIncyBlbnRyeSBhcy1pczsgdGhlIGxheWVyIG9ubHkgY29udHJpYnV0ZXMgbGFiZWwgYW5kIHZpc2liaWxpdHkuXG5mdW5jdGlvbiBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4geyAuLi5sYXllci5sZWdlbmQsIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIiwgaGlkZGVuIH07XG59XG5cbmZ1bmN0aW9uIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSByZXR1cm4gW107XG4gICAgY29uc3QgaGlkZGVuID0gIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgLy8gQSBjb2xsZWN0aW9uOiBvbmUgZW50cnkgcGVyIGdlb21ldHJ5IHBhcnQsIHNhbWUgbGFiZWwgYnkgZGVzaWduIC0tIHRoZVxuICAgICAgICAvLyBnbHlwaHMgYXJlIHdoYXQgdGVsbCB0aGVtIGFwYXJ0LCBtYXRjaGluZyBob3cgdGhlIHBhcnRzIHJlbmRlci5cbiAgICAgICAgcmV0dXJuIChsYXllci5sYXllcnMgfHwgW10pXG4gICAgICAgICAgICAuZmlsdGVyKHN1YiA9PiBHTFlQSFNbc3ViLnR5cGVdKVxuICAgICAgICAgICAgLm1hcChzdWIgPT4gc3ViLmxlZ2VuZFxuICAgICAgICAgICAgICAgID8gYmxvY2tFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pKTtcbiAgICB9XG4gICAgaWYgKCFHTFlQSFNbbGF5ZXIudHlwZV0pIHJldHVybiBbXTtcbiAgICBjb25zdCBlbnRyaWVzID0gW2xheWVyLmxlZ2VuZCA/IGJsb2NrRW50cnkobGF5ZXIsIGhpZGRlbikgOiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKV07XG4gICAgLy8gcmFkaXVzX2NvbCByZWNvcmRzIGEgc2l6ZSBrZXkgYmVzaWRlIHRoZSBjb2xvdXIgc3Rvcnk6IGJvdGggZW5jb2RpbmdzIG9uIHRoZVxuICAgIC8vIG1hcCBkZXNlcnZlIGJvdGggZXhwbGFuYXRpb25zIGluIHRoZSBsZWdlbmQuXG4gICAgaWYgKGxheWVyLmxlZ2VuZF9zaXplKSB7XG4gICAgICAgIGVudHJpZXMucHVzaCh7IC4uLmxheWVyLmxlZ2VuZF9zaXplLFxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogbGF5ZXIubGVnZW5kX3NpemUuZmllbGQgfHwgbGF5ZXIubmFtZSB8fCBcIlNpemVcIiwgaGlkZGVuIH0pO1xuICAgIH1cbiAgICByZXR1cm4gZW50cmllcztcbn1cblxuLy8gSWRlbnRpY2FsIGRhdGEtZHJpdmVuIHBheWxvYWRzIGNvbGxhcHNlIGludG8gb25lIHJvdy4gR3JvdXBpbmcgcG9pbnRzIGJ5IGEgY29sdW1uXG4vLyBnaXZlcyBldmVyeSBzdWItbGF5ZXIgdGhlIHNhbWUgcmFtcDsgYSByYW1wIHBlciBzdWItbGF5ZXIgaXMgbm9pc2UsIGFuZCB0aGUgZmllbGRcbi8vIG5hbWUgaXMgdGhlIGhvbmVzdCBsYWJlbCBmb3IgdGhlIHNoYXJlZCBtYXBwaW5nLiBUaGUgc3Vydml2b3Iga2VlcHMgdGhlIGZpcnN0XG4vLyBvY2N1cnJlbmNlJ3MgcG9zaXRpb24gYW5kIGhpZGVzIG9ubHkgd2hlbiBldmVyeSBjb250cmlidXRvciBpcyBoaWRkZW4uXG5mdW5jdGlvbiBwYXlsb2FkS2V5KGVudHJ5KSB7XG4gICAgLy8gSWRlbnRpdHkgZmllbGRzIHN0YXkgb3V0IG9mIHRoZSBrZXk6IHRoZSB3aG9sZSBwb2ludCBpcyB0aGF0IGVudHJpZXMgZnJvbVxuICAgIC8vIERJRkZFUkVOVCBsYXllcnMgY29sbGFwc2Ugd2hlbiB0aGVpciBtYXBwaW5nIHBheWxvYWQgaXMgdGhlIHNhbWUuXG4gICAgY29uc3QgeyBsYWJlbCwgaGlkZGVuLCBsYXllcklkLCBsYXllciwgZ3JvdXAsIC4uLnBheWxvYWQgfSA9IGVudHJ5O1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbn1cblxuZnVuY3Rpb24gZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKSB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBNYXAoKTsgICAvLyBwYXlsb2FkIGtleSAtPiBzdXJ2aXZpbmcgZW50cnlcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoZW50cnkgPT4ge1xuICAgICAgICAgICAgaWYgKGVudHJ5LmtpbmQgPT09IFwic3dhdGNoXCIpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGF5bG9hZEtleShlbnRyeSk7XG4gICAgICAgICAgICBjb25zdCBzdXJ2aXZvciA9IHNlZW4uZ2V0KGtleSk7XG4gICAgICAgICAgICBpZiAoIXN1cnZpdm9yKSB7XG4gICAgICAgICAgICAgICAgc2Vlbi5zZXQoa2V5LCBlbnRyeSk7XG4gICAgICAgICAgICAgICAgaWYgKGVudHJ5LmZpZWxkKSBlbnRyeS5sYWJlbCA9IGVudHJ5LmZpZWxkO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3Vydml2b3IuaGlkZGVuID0gc3Vydml2b3IuaGlkZGVuICYmIGVudHJ5LmhpZGRlbjtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBncm91cHM7XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXJIaXRzKG1hdGNoZXIsIGVudHJ5LCBncm91cE5hbWUpIHtcbiAgICBpZiAoIW1hdGNoZXIpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgY29uc3RyYWluZWQgPSBmYWxzZTtcbiAgICBpZiAobWF0Y2hlci5sYWJlbCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKGVudHJ5LmxhYmVsICE9PSBtYXRjaGVyLmxhYmVsKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmdyb3VwICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZ3JvdXBOYW1lICE9PSBtYXRjaGVyLmdyb3VwKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmlkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZW50cnkubGF5ZXJJZCAhPT0gbWF0Y2hlci5pZCkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gY29uc3RyYWluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHtcbiAgICBjb25zdCBjZmcgPSBjb25maWcgfHwge307XG4gICAgY29uc3QgZ3JvdXBzID0gW107XG4gICAgY29uc3QgYnlOYW1lID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGdyb3VwRm9yID0gbmFtZSA9PiB7XG4gICAgICAgIGlmICghYnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IG5hbWUsIGVudHJpZXM6IFtdIH07XG4gICAgICAgICAgICBieU5hbWUuc2V0KG5hbWUsIGdyb3VwKTtcbiAgICAgICAgICAgIGdyb3Vwcy5wdXNoKGdyb3VwKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYnlOYW1lLmdldChuYW1lKTtcbiAgICB9O1xuXG4gICAgaWYgKGNmZy5hdXRvICE9PSBmYWxzZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIHtcbiAgICAgICAgICAgICAgICBlbnRyeS5sYXllcklkID0gbGF5ZXIuaWQ7XG4gICAgICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBncm91cEZvcihsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcyk7XG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzdXBwcmVzc2lvbjogbWF0Y2hlcnMgb3V0bGl2ZSBldmVyeSByZS1kZXJpdmF0aW9uLCB3aGljaCBpcyB0aGVcbiAgICAvLyBkaWZmZXJlbmNlIGZyb20gYSByZWdpc3RyeSByZW1vdmUgdGhhdCB0aGUgbmV4dCBhZGQgd291bGQganVzdCByZXBvcHVsYXRlLlxuICAgIGNvbnN0IHJlbW92ZXMgPSBjZmcucmVtb3ZlIHx8IFtdO1xuICAgIGlmIChyZW1vdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICBlbnRyeSA9PiAhcmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGdyb3VwLm5hbWUpKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYW51YWwgZW50cmllczogdGhlIHVzZXIncyBvd24gY2xhaW1zLiBzY29wZSBuZXZlciBkcm9wcyB0aGVtOyBhIGBsYXllcmBcbiAgICAvLyBiaW5kaW5nIG1ha2VzIG9uZSBmb2xsb3cgYSBsaXZlIGxheWVyJ3MgdmlzaWJpbGl0eSAoYW5kIHZhbmlzaCB3aXRoIGl0IHVuZGVyXG4gICAgLy8gc2NvcGUgXCJ2aXNpYmxlXCIpLCBmb3Igd2hlbiBhIG1hbnVhbCByb3cgaXMgcmVhbGx5IGEgcmVsYWJlbGxpbmcuXG4gICAgZm9yIChjb25zdCBhZGRlZCBvZiBjZmcuYWRkIHx8IFtdKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0geyBoaWRkZW46IGZhbHNlLCAuLi5hZGRlZCB9O1xuICAgICAgICBpZiAoZW50cnkubGF5ZXIgIT0gbnVsbCkge1xuICAgICAgICAgICAgY29uc3QgYm91bmQgPSAobGF5ZXJzIHx8IFtdKS5maW5kKFxuICAgICAgICAgICAgICAgIGwgPT4gbC5pZCA9PT0gZW50cnkubGF5ZXIgfHwgbC5uYW1lID09PSBlbnRyeS5sYXllcik7XG4gICAgICAgICAgICBlbnRyeS5oaWRkZW4gPSAhYm91bmQgfHwgIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGJvdW5kLCBncm91cENvbmZpZ3MgfHwge30pO1xuICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGVudHJ5Lmdyb3VwIHx8IFwiXCIpKSkgY29udGludWU7XG4gICAgICAgIGdyb3VwRm9yKGVudHJ5Lmdyb3VwIHx8IFwiXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XG4gICAgfVxuXG4gICAgY29uc3QgcG9wdWxhdGVkID0gZ3JvdXBzLmZpbHRlcihnID0+IGcuZW50cmllcy5sZW5ndGggPiAwKTtcbiAgICByZXR1cm4geyB0aXRsZTogY2ZnLnRpdGxlIHx8IFwiTGVnZW5kXCIsIGdyb3VwczogcG9wdWxhdGVkIH07XG59XG5cbi8vIC0tLSByZW5kZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBET00gYnVpbHQgd2l0aCBjcmVhdGVFbGVtZW50L3RleHRDb250ZW50IHRocm91Z2hvdXQ6IGxhYmVscyBhbmQgY2F0ZWdvcnkgdmFsdWVzIGNvbWVcbi8vIGZyb20gdXNlciBkYXRhIGFuZCBtdXN0IG5ldmVyIGJlIHBhcnNlZCBhcyBIVE1MLlxuXG5mdW5jdGlvbiBkaXYoc3R5bGVzLCB0ZXh0KSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlcyk7XG4gICAgaWYgKHRleHQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gZ2x5cGgoZW50cnkpIHtcbiAgICBpZiAoZW50cnkuc2hhcGUgPT09IFwibGluZVwiKSB7XG4gICAgICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIyMHB4XCIsIGhlaWdodDogXCI0cHhcIiwgYmFja2dyb3VuZDogZW50cnkuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIgfSk7XG4gICAgfVxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJwaW5cIikge1xuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBlbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XG4gICAgICAgIGVsLnN0eWxlLmZsZXggPSBcIm5vbmVcIjtcbiAgICAgICAgY29uc3Qgc3ZnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJzdmdcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBcIjEyXCIpO1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMTRcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIsIFwiMCAwIDI0IDI4XCIpO1xuICAgICAgICBjb25zdCBwYXRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJwYXRoXCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImRcIixcbiAgICAgICAgICAgIFwiTTEyIDBDNS40IDAgMCA1LjQgMCAxMmMwIDkgMTIgMTYgMTIgMTZzMTItNyAxMi0xNkMyNCA1LjQgMTguNiAwIDEyIDB6XCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImZpbGxcIiwgZW50cnkuY29sb3IpO1xuICAgICAgICBzdmcuYXBwZW5kQ2hpbGQocGF0aCk7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKHN2Zyk7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgLy8gY2lyY2xlIC8gcG9seWdvbiAvIHNxdWFyZTogZmlsbCBpbnNpZGUgYSBib3JkZXIsIHdoaWNoIGlzIGhvdyBhcmVhcyBkcmF3LlxuICAgIGNvbnN0IHJhZGl1cyA9IGVudHJ5LnNoYXBlID09PSBcImNpcmNsZVwiID8gXCI1MCVcIlxuICAgICAgICA6IGVudHJ5LnNoYXBlID09PSBcInBvbHlnb25cIiA/IFwiMnB4XCIgOiBcIjBcIjtcbiAgICByZXR1cm4gZGl2KHsgd2lkdGg6IFwiMTJweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5maWxsQ29sb3IsXG4gICAgICAgICAgICAgICAgIGJvcmRlcjogYDJweCBzb2xpZCAke2VudHJ5LmNvbG9yfWAsIGJvcmRlclJhZGl1czogcmFkaXVzLFxuICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGJveFNpemluZzogXCJib3JkZXItYm94XCIgfSk7XG59XG5cbmZ1bmN0aW9uIHJhbXBSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBzdG9wcyA9IChlbnRyeS5hbmNob3JzIHx8IFtdKS5tYXAoKGNvbG9yLCBpLCBhbGwpID0+XG4gICAgICAgIGAke2NvbG9yfSAke2FsbC5sZW5ndGggPiAxID8gKGkgLyAoYWxsLmxlbmd0aCAtIDEpKSAqIDEwMCA6IDB9JWApO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe1xuICAgICAgICB3aWR0aDogXCIxMjBweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBib3JkZXJSYWRpdXM6IFwiMnB4XCIsXG4gICAgICAgIGJhY2tncm91bmRJbWFnZTogYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWAsXG4gICAgfSkpO1xuICAgIGNvbnN0IGVuZHMgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwganVzdGlmeUNvbnRlbnQ6IFwic3BhY2UtYmV0d2VlblwiLCB3aWR0aDogXCIxMjBweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICBmb250U2l6ZTogXCIxMXB4XCIsIGNvbG9yOiBcIiM1NTVcIiB9KTtcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtaW4pKSk7XG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhlbnRyeS52bWF4KSkpO1xuICAgIHJvdy5hcHBlbmRDaGlsZChlbmRzKTtcbiAgICByZXR1cm4gcm93O1xufVxuXG5jb25zdCBNQVhfQ0FURUdPUllfUk9XUyA9IDEyO1xuXG5mdW5jdGlvbiBjYXRlZ29yaWVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XG4gICAgY29uc3QgaXRlbXMgPSBlbnRyeS5pdGVtcyB8fCBbXTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMuc2xpY2UoMCwgTUFYX0NBVEVHT1JZX1JPV1MpKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvcjogaXRlbS5jb2xvciwgZmlsbENvbG9yOiBpdGVtLmNvbG9yIH0pKTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhpdGVtLnZhbHVlKSkpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XG4gICAgfVxuICAgIGlmIChpdGVtcy5sZW5ndGggPiBNQVhfQ0FURUdPUllfUk9XUykge1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luTGVmdDogXCI4cHhcIiwgbWFyZ2luVG9wOiBcIjNweFwiLCBjb2xvcjogXCIjNTU1XCIgfSxcbiAgICAgICAgICAgIGArICR7aXRlbXMubGVuZ3RoIC0gTUFYX0NBVEVHT1JZX1JPV1N9IG1vcmVgKSk7XG4gICAgfVxuICAgIHJldHVybiByb3c7XG59XG5cbmZ1bmN0aW9uIGJpbnNSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBlZGdlcyA9IGVudHJ5LmVkZ2VzIHx8IFtdO1xuICAgIGNvbnN0IGNvbG9ycyA9IGVudHJ5LmNvbG9ycyB8fCBbXTtcbiAgICBjb25zdCBsYWJlbEZvciA9IGkgPT4gaSA9PT0gMCA/IGA8ICR7ZWRnZXNbMF19YFxuICAgICAgICA6IGkgPT09IGVkZ2VzLmxlbmd0aCA/IGBcdTIyNjUgJHtlZGdlc1tlZGdlcy5sZW5ndGggLSAxXX1gXG4gICAgICAgIDogYCR7ZWRnZXNbaSAtIDFdfSBcdTIwMTMgJHtlZGdlc1tpXX1gO1xuICAgIGNvbG9ycy5mb3JFYWNoKChjb2xvciwgaSkgPT4ge1xuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmdpbkxlZnQ6IFwiOHB4XCIgfSk7XG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZ2x5cGgoeyBzaGFwZTogXCJzcXVhcmVcIiwgY29sb3IsIGZpbGxDb2xvcjogY29sb3IgfSkpO1xuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgbGFiZWxGb3IoaSkpKTtcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGxpbmUpO1xuICAgIH0pO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIEEgc2l6ZSBrZXkgaXMgYSBzdGF0ZW1lbnQsIG5vdCBhIGRyYXdpbmc6IFwiXHUyNUNGIHNpemUgXHUyMjFEIGZpZWxkIChtaW4gXHUyMDEzIG1heClcIi4gVGhlIGdseXBoXG4vLyBpcyBmaXhlZCBhbmQgbm90aGluZyBpbiB0aGUgcm93IGRlcml2ZXMgZnJvbSByYWRpdXNfcmFuZ2Ugb3IgdGhlIGRhdGEncyBzcHJlYWQgLS1cbi8vIGxlZ2VuZCBDU1MgcGl4ZWxzIGFyZSBub3QgbWFwIHBpeGVscyBhdCBhbnkgem9vbSwgc28gZHJhd24gc2FtcGxlIGNpcmNsZXMgd291bGRcbi8vIGFzc2VydCBhIHByZWNpc2lvbiB0aGF0IGRvZXMgbm90IGV4aXN0LiBUaGUgcm93IG5hbWVzIHRoZSBlbmNvZGluZyBhbmQgaXRzIGRvbWFpbi5cbmZ1bmN0aW9uIHNpemVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBjb2xvcjogXCIjNjY2XCIgfSwgXCJcdTI1Q0ZcIikpO1xuICAgIGNvbnN0IHJhbmdlID0gZW50cnkudm1pbiAhPSBudWxsICYmIGVudHJ5LnZtYXggIT0gbnVsbFxuICAgICAgICA/IGAgKCR7ZW50cnkudm1pbn0gXHUyMDEzICR7ZW50cnkudm1heH0pYCA6IFwiXCI7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgYHNpemUgXHUyMjFEICR7ZW50cnkuZmllbGQgfHwgZW50cnkubGFiZWx9JHtyYW5nZX1gKSk7XG4gICAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gc3dhdGNoUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZ2x5cGgoZW50cnkpKTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIENvbGxhcHNlIHN0YXRlLCBwZXIgY29udGFpbmVyIHJhdGhlciB0aGFuIG1vZHVsZSBzY29wZTogdGhlIHNpZGViYXIga2V5cyBpdHNcbi8vIGNvbGxhcHNlZFBhdGhzIGF0IG1vZHVsZSBsZXZlbCBhbmQgdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmUgaXQgLS0gYSBmaWxlZCBidWdcbi8vIHRoaXMgZGVsaWJlcmF0ZWx5IGRvZXMgbm90IGluaGVyaXQuIEtleWVkIGJ5IGdyb3VwIG5hbWUsIHN1cnZpdmluZyB0aGUgZnVsbFxuLy8gcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBjb250YWluZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICBjb25zdCBkaW1IaWRkZW4gPSBvcHRpb25zLmRpbUhpZGRlbiAhPT0gZmFsc2U7XG4gICAgbGV0IGNvbGxhcHNlZCA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xuICAgIGlmICghY29sbGFwc2VkKSB7XG4gICAgICAgIGNvbGxhcHNlZCA9IG5ldyBTZXQoKTtcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgY29sbGFwc2VkKTtcbiAgICB9XG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7XG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxuICAgICAgICBwYWRkaW5nQm90dG9tOiBcIjRweFwiLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIsXG4gICAgfSwgc3BlYy50aXRsZSkpO1xuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBzcGVjLmdyb3Vwcykge1xuICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGdyb3VwLm5hbWUgJiYgY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKTtcbiAgICAgICAgaWYgKGdyb3VwLm5hbWUpIHtcbiAgICAgICAgICAgIC8vIFRoZSBzaWRlYmFyJ3MgYWZmb3JkYW5jZSBleGFjdGx5OiBhbiBhcnJvdyB0aGF0IGZvbGRzIHRoZSBzZWN0aW9uLlxuICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gZGl2KHsgZm9udFdlaWdodDogXCJib2xkXCIsIG1hcmdpblRvcDogXCI2cHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsIHVzZXJTZWxlY3Q6IFwibm9uZVwiIH0pO1xuICAgICAgICAgICAgaGVhZGVyLnRleHRDb250ZW50ID0gYCR7aXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIn0gJHtncm91cC5uYW1lfWA7XG4gICAgICAgICAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKSkgY29sbGFwc2VkLmRlbGV0ZShncm91cC5uYW1lKTtcbiAgICAgICAgICAgICAgICBlbHNlIGNvbGxhcHNlZC5hZGQoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGNvbnRhaW5lciwgc3BlYywgb3B0aW9ucyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChoZWFkZXIpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChpc0NvbGxhcHNlZCkgY29udGludWU7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZ3JvdXAuZW50cmllcykge1xuICAgICAgICAgICAgY29uc3Qgcm93ID0gZW50cnkua2luZCA9PT0gXCJyYW1wXCIgPyByYW1wUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJiaW5zXCIgPyBiaW5zUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJzaXplc1wiID8gc2l6ZXNSb3coZW50cnkpXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hSb3coZW50cnkpO1xuICAgICAgICAgICAgLy8gRGltbWVkLCBub3QgZHJvcHBlZDogdW5kZXIgc2NvcGUgXCJhbGxcIiB0aGUgbGVnZW5kIGlzIHRoZSBtYXAncyB3aG9sZVxuICAgICAgICAgICAgLy8gdm9jYWJ1bGFyeSwgYW5kIHRoZSBkaW0gaXMgd2hhdCBzdGlsbCB0ZWxscyB0aGUgY3VycmVudCBzY3JlZW4gc3RhdGUuXG4gICAgICAgICAgICBpZiAoZW50cnkuaGlkZGVuICYmIGRpbUhpZGRlbikgcm93LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHJvdyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbn1cbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIC8vIFRoZSBmaXJzdCB0aWNrIHNpdHMgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBub3Qgb25lIHBlcmlvZCBhZnRlciBpdDogd2luZG93c1xuICAgIC8vIGFyZSBoYWxmLW9wZW4gKHN0YXJ0LCBlbmRdLCBzbyBhIGZpcnN0IHRpY2sgYXQgc3RhcnQrUCB3b3VsZCBleGNsdWRlIHRoZSBlYXJsaWVzdFxuICAgIC8vIHBvaW50IGZyb20gaXRzIG93biB3aW5kb3cgYW5kIGl0IHdvdWxkIG5ldmVyIGRpc3BsYXkgYXQgYW55IHRpY2suXG4gICAgY29uc3QgdGlja3MgPSBbc3RhcnRNc107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xuICAgICAgICB0aWNrcy5wdXNoKHQpO1xuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XG4gICAgcmV0dXJuIHRpY2tzO1xufVxuXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2Vcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgfVxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xufVxuXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xufVxuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG59XG5cbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cbi8vXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgLy8gQSBwZXItdmVydGV4LXRpbWVkIGxpbmUgaG9sZHMgbWFueSBwYWlyczsgb24gdGhpcyB3aG9sZS1sYXllciBwYXRoIGl0IHNob3dzXG4gICAgLy8gd2hpbGUgQU5ZIG9mIHRoZW0gaXMgaW4gdGhlIHdpbmRvdyAtLSB0aGUgR1BVIHBhdGggaXMgd2hhdCB0cmltcyBwZXIgc2VnbWVudC5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XG59XG5cbi8vIE9uZSBwbGF5YmFjayBzdGVwOiB0aGUgbmV4dCBpbmRleCBhbmQgd2hldGhlciBwbGF5YmFjayBzdXJ2aXZlcyBpdC4gUHVyZSBzbyB0aGUgbG9vcFxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxuLy8gd2l0aG91dCBsb29wIHN0b3BzIHdoZXJlIGl0IGlzLlxuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2UoaW5kZXgsIGxlbmd0aCwgbG9vcCkge1xuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcbiAgICBpZiAobG9vcCkgcmV0dXJuIHsgaW5kZXg6IDAsIHBsYXlpbmc6IHRydWUgfTtcbiAgICByZXR1cm4geyBpbmRleCwgcGxheWluZzogZmFsc2UgfTtcbn1cblxuLy8gV2hlcmUgdGhlIGNvbnRyb2wgc2l0cywgYXMgaW5saW5lIHN0eWxlcyBzbyB0aGUgY2hvaWNlIHRyYXZlbHMgd2l0aCB0aGUgc3RhdGUgcmF0aGVyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cbi8vIGluY2x1ZGluZyB0aGUgb25lcyBhIHBvc2l0aW9uIGRvZXMgbm90IHVzZSAtLSBzbyBtb3ZpbmcgdGhlIGNvbnRyb2wgY2xlYXJzIHRoZSBvbGRcbi8vIGFuY2hvciBpbnN0ZWFkIG9mIGFjY3VtdWxhdGluZyBib3RoLlxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcbiAgICBcInRvcC1sZWZ0XCI6ICAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJ0b3AtY2VudGVyXCI6ICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImxlZnQtY2VudGVyXCI6ICAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJyaWdodC1jZW50ZXJcIjogIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImJvdHRvbS1jZW50ZXJcIjogeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tcmlnaHRcIjogIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxufTtcblxuZnVuY3Rpb24gYXBwbHlQb3NpdGlvbihlbCwgcG9zaXRpb24pIHtcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XG4gICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN0eWxlcykpIHtcbiAgICAgICAgZWwuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XG59XG5cbi8vIC0tLSB0aGUgd2luZG93IGFuZCB0aGUgcnVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gRml4ZWQgbWlsbGlzZWNvbmRzIGZvciBhIHBlcmlvZCwgb3IgbnVsbCB3aGVuIGl0IG1vdmVzIHRocm91Z2ggdGhlIGNhbGVuZGFyIChtb250aHMsXG4vLyB5ZWFycykgYW5kIGhhcyBubyBmaXhlZCB3aWR0aC4gVGhlIHJ1bGVyIGFuZCB0aGUgZHJhZyBncmlkIG5lZWQgZml4ZWQgd2lkdGhzOyBjYWxlbmRhclxuLy8gcGVyaW9kcyBmYWxsIGJhY2sgdG8gdGhlIHRpY2sgcG9zaXRpb25zIHRoZW1zZWx2ZXMuXG5leHBvcnQgZnVuY3Rpb24gcGVyaW9kVG9NcyhwKSB7XG4gICAgaWYgKCFwIHx8IHAueWVhcnMgfHwgcC5tb250aHMpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMCArIHAuaG91cnMgKiAzNjAwXG4gICAgICAgICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMDtcbn1cblxuLy8gTWlsbGlzZWNvbmRzIGFzIGFuIElTTzg2MDEgZHVyYXRpb24sIGhvdXJzL21pbnV0ZXMvc2Vjb25kcyBvbmx5IC0tIFBUMjZIIGlzIHZhbGlkIGFuZFxuLy8gYXZvaWRzIGNhbGVuZGFyIHVuaXRzIGVudGlyZWx5LCBzbyB3aGF0IHRoZSBkcmFnIHdyaXRlcyBhbHdheXMgcGFyc2VzIGJhY2sgZXhhY3RseS5cbmV4cG9ydCBmdW5jdGlvbiBtc1RvUGVyaW9kSVNPKG1zKSB7XG4gICAgbGV0IHJlc3QgPSBNYXRoLnJvdW5kKG1zIC8gMTAwMCk7XG4gICAgY29uc3QgaCA9IE1hdGguZmxvb3IocmVzdCAvIDM2MDApOyByZXN0IC09IGggKiAzNjAwO1xuICAgIGNvbnN0IG0gPSBNYXRoLmZsb29yKHJlc3QgLyA2MCk7IHJlc3QgLT0gbSAqIDYwO1xuICAgIGxldCBvdXQgPSBcIlBUXCI7XG4gICAgaWYgKGgpIG91dCArPSBgJHtofUhgO1xuICAgIGlmIChtKSBvdXQgKz0gYCR7bX1NYDtcbiAgICBpZiAocmVzdCB8fCBvdXQgPT09IFwiUFRcIikgb3V0ICs9IGAke3Jlc3R9U2A7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gVGhlIHJ1bGVyJ3MgaW5jcmVtZW50OiB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gZXZlcnkgYm91bmRhcnkgdGhlIHVzZXIgY2FuIGNhcmVcbi8vIGFib3V0IC0tIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZCBkdXJhdGlvbi4gQW4gaW50ZXJ2YWwgb2YgMWggd2l0aCBhXG4vLyAyLjVoIGR1cmF0aW9uIG5lZWRzIDMwLW1pbnV0ZSBtYXJrcyBmb3IgdGhlIGR1cmF0aW9uIHRvIHNpdCBvbiBvbmU7IDFoIGFuZCAyaCBuZWVkIG9ubHlcbi8vIHRoZSBob3Vycy4gXCJMb3dlc3QgZHVyYXRpb25cIiBpcyB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIG9uZSBkaXZpZGVzIHRoZSBvdGhlci5cbmV4cG9ydCBmdW5jdGlvbiBnY2RHcmlkTXMocGVyaW9kTXMsIGR1cmF0aW9uc01zKSB7XG4gICAgY29uc3QgZ2NkID0gKGEsIGIpID0+IChiID8gZ2NkKGIsIGEgJSBiKSA6IGEpO1xuICAgIGxldCBncmlkID0gcGVyaW9kTXM7XG4gICAgZm9yIChjb25zdCBkIG9mIGR1cmF0aW9uc01zKSB7XG4gICAgICAgIGlmIChkID4gMCkgZ3JpZCA9IGdjZChncmlkLCBNYXRoLnJvdW5kKGQpKTtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgubWF4KGdyaWQsIDEwMDApO1xufVxuXG4vLyBFdmVyeSBmaW5pdGUgZHVyYXRpb24gYXR0YWNoZWQgdG8gYSB0aW1lIGxheWVyLCBpbiBtcywgZm9yIHRoZSBncmlkLiBcInBlcmlvZFwiIGFuZCBudWxsXG4vLyBjb250cmlidXRlIG5vdGhpbmcgbmV3OyBjYWxlbmRhciBkdXJhdGlvbnMgY2Fubm90IGpvaW4gYSBmaXhlZC1tcyBncmlkIGFuZCBhcmUgc2tpcHBlZC5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJzLCB3aW5kb3dJc28pIHtcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBjb25zdCB2aXNpdCA9IGxpc3QgPT4gbGlzdC5mb3JFYWNoKGwgPT4ge1xuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsLmxheWVycyB8fCBbXSk7XG4gICAgICAgIGNvbnN0IHNwZWMgPSBsLnRpbWUgJiYgbC50aW1lLmR1cmF0aW9uO1xuICAgICAgICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgJiYgc3BlYyAhPT0gXCJwZXJpb2RcIikge1xuICAgICAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcbiAgICAgICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdmlzaXQobGF5ZXJzKTtcbiAgICBpZiAod2luZG93SXNvKSB7XG4gICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh3aW5kb3dJc28pKTtcbiAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFRpY2sgbWFya3MgZm9yIHRoZSB0cmFjazogbWFqb3JzIGF0IGV2ZXJ5IGludGVydmFsIGJvdW5kYXJ5IChzcGFyc2VseSBsYWJlbGxlZCBzbyBsb25nXG4vLyB0aW1lbGluZXMgc3RheSByZWFkYWJsZSksIHVubGFiZWxsZWQgbWlub3JzIGF0IHRoZSBncmlkIGluIGJldHdlZW4uIE1pbm9yIERJU1BMQVkgaXNcbi8vIHRoaW5uZWQgd2hlbiBkZW5zZTsgdGhlIHNuYXAgZ3JpZCBzdGF5cyBleGFjdCwgc28gYSBtYXJrIGlzIGEgZ3VpZGUsIG5vdCBhIGNvbnN0cmFpbnQuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSdWxlcih0aWNrcywgZ3JpZE1zLCBmb3JtYXRMYWJlbCwgeyBtYXhMYWJlbHMgPSA2LCBtYXhNaW5vcnMgPSAyNDAgfSA9IHt9KSB7XG4gICAgaWYgKHRpY2tzLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcbiAgICBjb25zdCB0MCA9IHRpY2tzWzBdLCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcbiAgICBjb25zdCBtYXJrcyA9IFtdO1xuICAgIGNvbnN0IGxhYmVsRXZlcnkgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodGlja3MubGVuZ3RoIC8gbWF4TGFiZWxzKSk7XG4gICAgdGlja3MuZm9yRWFjaCgodCwgaSkgPT4gbWFya3MucHVzaCh7XG4gICAgICAgIGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiB0cnVlLFxuICAgICAgICBsYWJlbDogaSAlIGxhYmVsRXZlcnkgPT09IDAgPyBmb3JtYXRMYWJlbCh0KSA6IG51bGwsXG4gICAgfSkpO1xuICAgIGlmIChncmlkTXMgJiYgZ3JpZE1zIDwgc3Bhbikge1xuICAgICAgICBjb25zdCB0b3RhbCA9IE1hdGguZmxvb3Ioc3BhbiAvIGdyaWRNcyk7XG4gICAgICAgIGNvbnN0IHRoaW4gPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodG90YWwgLyBtYXhNaW5vcnMpKTtcbiAgICAgICAgZm9yIChsZXQgayA9IDE7IGsgKiBncmlkTXMgPCBzcGFuOyBrICs9IHRoaW4pIHtcbiAgICAgICAgICAgIGNvbnN0IHQgPSB0MCArIGsgKiBncmlkTXM7XG4gICAgICAgICAgICBpZiAodGlja3MuaW5jbHVkZXModCkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgbWFya3MucHVzaCh7IGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiBmYWxzZSwgbGFiZWw6IG51bGwgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG1hcmtzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGlja0xhYmVsKG1zLCBwZXJpb2RNcykge1xuICAgIGNvbnN0IGlzbyA9IG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpO1xuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgNjAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxOSk7XG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCAyNCAqIDM2MDAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxNik7XG4gICAgcmV0dXJuIGlzby5zbGljZSg1LCAxMCk7XG59XG5cbi8vIEdseXBocyBhcyBpbmxpbmUgU1ZHIHJhdGhlciB0aGFuIHRleHQ6IFwiXHUyMUJCXCIgcmVhZHMgYXMgcmVmcmVzaCAtLSBhIGxvb3AgdG9nZ2xlIGRyYXduIHdpdGhcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xuLy8gdGhlIHByZXNzZWQgc3RhdGUgcmVzdHlsZSB0aGVtIGZyb20gQ1NTLlxuY29uc3QgSUNPTlMgPSB7XG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcbiAgICBwbGF5OiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAybDkgNi05IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGF1c2U6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJoM3YxMkg0ek05IDJoM3YxMkg5elwiLz48L3N2Zz4nLFxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXG4gICAgbG9vcDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTggMmE2IDYgMCAwIDEgNS42NSA0SDE2bC0yLjggMy41TDEwLjQgNmgyLjFBNC41IDQuNSAwIDEgMCAxMi41IDEwbDEuMy43NUE2IDYgMCAxIDEgOCAyelwiLz48L3N2Zz4nLFxufTtcblxuLy8gLS0tIHRoZSBjb250cm9sIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQbGFpbiBET00gaW5zaWRlIHRoZSB3aWRnZXQgY29udGFpbmVyLCBsaWtlIHRoZSBzaWRlYmFyOiBubyBMZWFmbGV0IGNvbnRyb2wgbWFjaGluZXJ5LFxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xuLy8gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MgY29udHJvbCAtLSBzdGVwL3BsYXkvc3RlcC9sb29wIGFzIGEgam9pbmVkIGJ1dHRvbiBiYXIsIHRoZW4gdGhlXG4vLyBkYXRlLCBzbGlkZXIgYW5kIHNwZWVkIC0tIHNpbmNlIHRoYXQgaXMgdGhlIHNsaWRlciB1c2VycyBvZiB0aGUgZm9saXVtIGFwcHMga25vdy5cbi8vXG4vLyBUaGUgc2xpZGVyIGlzIGEgY29tcG9zaXRlLiBBIG5hdGl2ZSA8aW5wdXQgdHlwZT1yYW5nZT4gc3RheXMgb24gdG9wIGFzIHRoZSB0aHVtYjogaXRcbi8vIGtlZXBzIGtleWJvYXJkIGFycm93cywgc2NyZWVuIHJlYWRlcnMgYW5kIGV2ZXJ5IGV4aXN0aW5nIHRlc3Qgd29ya2luZywgYW5kIHBsYXliYWNrXG4vLyBkcml2ZXMgaXQgYXMgYmVmb3JlLiBVbmRlcm5lYXRoIHNpdCB0aGUgcGFydHMgYSBuYXRpdmUgaW5wdXQgY2Fubm90IGRyYXc6IHRoZSB3aW5kb3dcbi8vIHNwYW4gc2hvd2luZyBleGFjdGx5IHdoYXQgaW50ZXJ2YWwgaXMgb24gdGhlIG1hcCwgYSBydWxlciB3aXRoIGxhYmVsbGVkIGludGVydmFsIG1hcmtzXG4vLyBhbmQgdW5sYWJlbGxlZCBnY2QgbWlub3JzLCBhbmQgdGhlIHRyYWlsIGhhbmRsZSAtLSBkcmFnIGl0IGJhY2sgdG8gd2lkZW4gdGhlIHdpbmRvdyBmb3Jcbi8vIGV2ZXJ5IGxheWVyIGF0IG9uY2UsIGRyb3AgaXQgb250byB0aGUgdGh1bWIgdG8gaGFuZCBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJUaW1lQ29udHJvbChjb250YWluZXIsIHN0YXRlLCBoYW5kbGVycykge1xuICAgIGxldCBlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtY29udHJvbFwiKTtcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoZWwpIGVsLnJlbW92ZSgpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKCFlbCkge1xuICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XG4gICAgICAgIGVsLmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1idXR0b25zXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1wbGF5XCIgYXJpYS1sYWJlbD1cIlBsYXlcIj4ke0lDT05TLnBsYXl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtZndkXCIgdGl0bGU9XCJTdGVwIGZvcndhcmRcIiBhcmlhLWxhYmVsPVwiU3RlcCBmb3J3YXJkXCI+JHtJQ09OUy5md2R9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxhYmVsXCI+PC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWNrXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhc2VcIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwYW5cIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXJ1bGVyXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxpbnB1dCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIgdHlwZT1cInJhbmdlXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWlsXCIgcm9sZT1cInNsaWRlclwiIHRhYmluZGV4PVwiMFwiXG4gICAgICAgICAgICAgICAgICAgICAgYXJpYS1sYWJlbD1cIlRyYWlsaW5nIHdpbmRvd1wiIHRpdGxlPVwiRHJhZyBiYWNrIHRvIHdpZGVuIHRoZSB0aW1lIHdpbmRvdzsgZHJvcCBvbiB0aGUgdGh1bWIgdG8gY2xlYXJcIj48L3NwYW4+XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8c2VsZWN0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGVlZFwiIHRpdGxlPVwiUGxheWJhY2sgc3BlZWRcIj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMC41XCI+MC41eDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIxXCI+MXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMlwiPjJ4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjRcIj40eDwvb3B0aW9uPlxuICAgICAgICAgICAgPC9zZWxlY3Q+YDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGVsKTtcblxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtYmFja1wiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwQmFjayk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1md2RcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEZvcndhcmQpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25QbGF5VG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uTG9vcFRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsXG4gICAgICAgICAgICBlID0+IGhhbmRsZXJzLm9uU3BlZWQocGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkpKTtcbiAgICAgICAgY29uc3Qgc2xpZGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKTtcbiAgICAgICAgLy8gYGlucHV0YCBmaXJlcyBwZXIgZHJhZyBzdGVwIGZvciBsaXZlIHNjcnViYmluZzsgdGhlIG1vZGVsIHdyaXRlYmFjayBpcyB0aGVcbiAgICAgICAgLy8gaGFuZGxlcidzIHByb2JsZW0sIHRocm90dGxlZCB0aGVyZSBzbyBkcmFnZ2luZyBkb2VzIG5vdCBmbG9vZCB0aGUga2VybmVsLlxuICAgICAgICBzbGlkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGUgPT4gaGFuZGxlcnMub25TZWVrKHBhcnNlSW50KGUudGFyZ2V0LnZhbHVlLCAxMCkpKTtcblxuICAgICAgICBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKTtcbiAgICB9XG5cbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLm1heCA9IFN0cmluZyhzdGF0ZS50aWNrcy5sZW5ndGggLSAxKTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLmluZGV4KTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbGFiZWxcIikudGV4dENvbnRlbnQgPSBmb3JtYXRVVEMoc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdKTtcblxuICAgIGNvbnN0IHBsYXkgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKTtcbiAgICBwbGF5LmlubmVySFRNTCA9IHN0YXRlLnBsYXlpbmcgPyBJQ09OUy5wYXVzZSA6IElDT05TLnBsYXk7XG4gICAgcGxheS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIik7XG4gICAgcGxheS50aXRsZSA9IHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIjtcblxuICAgIC8vIEEgbW9kZSwgbm90IGFuIGFjdGlvbjogcHJlc3NlZCBzdHlsaW5nIGFuZCBhcmlhLXByZXNzZWQgc2F5IFwidGhpcyBzdGF5cyBvblwiLFxuICAgIC8vIHdoZXJlIGEgYmFyZSBpY29uIGludml0ZWQgYSBjbGljayBleHBlY3Rpbmcgc29tZXRoaW5nIHRvIGhhcHBlbiByaWdodCBub3cuXG4gICAgY29uc3QgbG9vcCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpO1xuICAgIGxvb3AuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCBCb29sZWFuKHN0YXRlLmxvb3ApKTtcbiAgICBsb29wLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcoQm9vbGVhbihzdGF0ZS5sb29wKSkpO1xuICAgIGxvb3AudGl0bGUgPSBzdGF0ZS5sb29wID8gXCJMb29wOiBvblwiIDogXCJMb29wOiBvZmZcIjtcblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5zcGVlZCB8fCAxKTtcbiAgICByZW5kZXJUcmFjayhlbCwgc3RhdGUpO1xuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcbiAgICByZXR1cm4gZWw7XG59XG5cbi8vIEdlb21ldHJ5IHNoYXJlZCBieSByZW5kZXJpbmcgYW5kIGRyYWdnaW5nOiB3aGVyZSBhIHRpbWUgc2l0cyBvbiB0aGUgdHJhY2ssIDAuLjEuXG5mdW5jdGlvbiB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0KSB7XG4gICAgY29uc3Qgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdGlja3NbMF07XG4gICAgaWYgKHNwYW4gPD0gMCkgcmV0dXJuIDE7XG4gICAgcmV0dXJuIE1hdGgubWluKDEsIE1hdGgubWF4KDAsICh0IC0gdGlja3NbMF0pIC8gc3BhbikpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJUcmFjayhlbCwgc3RhdGUpIHtcbiAgICBjb25zdCB7IHRpY2tzLCBpbmRleCB9ID0gc3RhdGU7XG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XG4gICAgdHJhY2suX3N0YXRlID0gc3RhdGU7ICAgICAgLy8gdGhlIGRyYWcgaGFuZGxlciByZWFkcyB0aGUgZnJlc2hlc3Qgc3RhdGUgZnJvbSBoZXJlXG5cbiAgICBjb25zdCB0aHVtYlQgPSB0aWNrc1tpbmRleF07XG4gICAgY29uc3QgcGVyaW9kTXMgPSBzdGF0ZS5wZXJpb2RNcztcbiAgICBjb25zdCB3aW5kb3dNcyA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiBudWxsO1xuICAgIGNvbnN0IHNob3duTXMgPSB3aW5kb3dNcyAhPSBudWxsID8gd2luZG93TXMgOiBwZXJpb2RNcztcblxuICAgIC8vIFRoZSBzcGFuOiB3aGF0IGludGVydmFsIHRoZSBtYXAgaXMgc2hvd2luZyByaWdodCBub3cuIFRoZSBzcGFuIGRlcGljdHMgdGhlIHNoYXJlZFxuICAgIC8vIHdpbmRvdyAtLSBvbmUgcGVyaW9kIGJ5IGRlZmF1bHQgLS0gYW5kIHBlci1sYXllciBkdXJhdGlvbnMgcmVtYWluIGFuIEFQSSBjb25jZXJuXG4gICAgLy8gdW50aWwgYSBkcmFnIG92ZXJyaWRlcyB0aGVtIGZvciBldmVyeXRoaW5nIGF0IG9uY2UuXG4gICAgY29uc3Qgc3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGFuXCIpO1xuICAgIGNvbnN0IHJpZ2h0ID0gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUKTtcbiAgICBjb25zdCBsZWZ0ID0gc2hvd25NcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gc2hvd25NcykgOiAwO1xuICAgIHNwYW4uc3R5bGUubGVmdCA9IGAkeyhsZWZ0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHNwYW4uc3R5bGUud2lkdGggPSBgJHsoTWF0aC5tYXgoMCwgcmlnaHQgLSBsZWZ0KSAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICBzcGFuLmNsYXNzTGlzdC50b2dnbGUoXCJvdmVycmlkZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcblxuICAgIC8vIFRoZSB0cmFpbCBoYW5kbGUgcGFya3MgT04gdGhlIHRodW1iIHdoZW4gbm8gb3ZlcnJpZGUgaXMgYWN0aXZlIC0tIFwibm90IGdyYWJiZWRcIiAtLVxuICAgIC8vIGFuZCBzaXRzIGF0IHRoZSB3aW5kb3cncyBzdGFydCB3aGlsZSBvbmUgaXMuIERyb3BwaW5nIGl0IGJhY2sgb24gdGhlIHRodW1iIGNsZWFycy5cbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcbiAgICBjb25zdCBhdCA9IHdpbmRvd01zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSB3aW5kb3dNcykgOiByaWdodDtcbiAgICB0cmFpbC5zdHlsZS5sZWZ0ID0gYCR7KGF0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHRyYWlsLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgd2luZG93TXMgIT0gbnVsbCk7XG4gICAgdHJhaWwuc2V0QXR0cmlidXRlKFwiYXJpYS12YWx1ZXRleHRcIiwgc3RhdGUud2luZG93IHx8IFwibm8gdHJhaWxpbmcgd2luZG93XCIpO1xuICAgIC8vIE5vIGZpeGVkLW1zIGdyaWQgKGNhbGVuZGFyIHBlcmlvZHMpIG1lYW5zIG5vdGhpbmcgc2Vuc2libGUgdG8gc25hcCB0by5cbiAgICB0cmFpbC5zdHlsZS5kaXNwbGF5ID0gc3RhdGUuZ3JpZE1zID8gXCJcIiA6IFwibm9uZVwiO1xuXG4gICAgY29uc3QgcnVsZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcnVsZXJcIik7XG4gICAgY29uc3Qga2V5ID0gYCR7dGlja3NbMF19fCR7dGlja3MubGVuZ3RofXwke3N0YXRlLmdyaWRNc318JHtwZXJpb2RNc31gO1xuICAgIGlmIChydWxlci5fa2V5ICE9PSBrZXkpIHtcbiAgICAgICAgcnVsZXIuX2tleSA9IGtleTtcbiAgICAgICAgcnVsZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICAgICAgZm9yIChjb25zdCBtYXJrIG9mIGJ1aWxkUnVsZXIodGlja3MsIHN0YXRlLmdyaWRNcywgdCA9PiBmb3JtYXRUaWNrTGFiZWwodCwgcGVyaW9kTXMpKSkge1xuICAgICAgICAgICAgY29uc3QgbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgbS5jbGFzc05hbWUgPSBtYXJrLm1ham9yID8gXCJzd2lmdG1hcC10aW1lLW1hcmsgbWFqb3JcIiA6IFwic3dpZnRtYXAtdGltZS1tYXJrXCI7XG4gICAgICAgICAgICBtLnN0eWxlLmxlZnQgPSBgJHsobWFyay5mcmFjdGlvbiAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICAgICAgICAgIGlmIChtYXJrLmxhYmVsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICAgICAgbGFiLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1tYXJrLWxhYmVsXCI7XG4gICAgICAgICAgICAgICAgbGFiLnRleHRDb250ZW50ID0gbWFyay5sYWJlbDtcbiAgICAgICAgICAgICAgICBtLmFwcGVuZENoaWxkKGxhYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBydWxlci5hcHBlbmRDaGlsZChtKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gRHJhZ2dpbmcgdGhlIHRyYWlsIGhhbmRsZS4gU25hcHMgdG8gdGhlIGdjZCBncmlkIHNvIGV2ZXJ5IHN0b3AgaXMgYSBib3VuZGFyeSB0aGUgZGF0YVxuLy8gb3IgdGhlIGludGVydmFsIGFjdHVhbGx5IG5hbWVzOyB0aGUgZGlzdGFuY2UgdG8gdGhlIHRodW1iLCBpbiB3aG9sZSBncmlkIHN0ZXBzLCBJUyB0aGVcbi8vIHdpbmRvdy4gWmVybyBzdGVwcyAtLSBkcm9wcGVkIG9uIHRoZSB0aHVtYiAtLSBjbGVhcnMgdGhlIG92ZXJyaWRlLlxuZnVuY3Rpb24gYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycykge1xuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xuXG4gICAgZnVuY3Rpb24gaXNvRnJvbUV2ZW50KGV2KSB7XG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xuICAgICAgICBjb25zdCByZWN0ID0gdHJhY2suZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcyB8fCByZWN0LndpZHRoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdW5jbGFtcGVkIG9uIHRoZSBsZWZ0OiB0aGUgd2luZG93IGlzIFwiaG93IGZhciBiYWNrIGZyb20gdGhlXG4gICAgICAgIC8vIGxlYWQgcG9pbnRcIiwgYW5kIHRoYXQgbWF5IHJlYWNoIHBhc3QgdGhlIGJhcidzIHN0YXJ0IC0tIGVzcGVjaWFsbHkgd2hlbiB0aGVcbiAgICAgICAgLy8gbGVhZCBzaXRzIGVhcmx5IG9uIHRoZSBiYXIgYW5kIG1vc3Qgb2YgaXRzIHRyYWlsIGlzIG9mZi1zY3JlZW4uIENsYW1waW5nIGhlcmVcbiAgICAgICAgLy8gY2FwcGVkIHRoZSB3aW5kb3cgYXQgdGhlIHZpc2libGUgcGFzdCwgd2hpY2ggcGlubmVkIHRoZSBoYW5kbGUgdG8gdGhlIGJhcidzXG4gICAgICAgIC8vIHN0YXJ0IGFuZCBtYWRlIGFueXRoaW5nIHdpZGVyIGltcG9zc2libGUgdG8gc2V0LiBPbmx5IHRoZSBEUkFXSU5HIGNsYW1wcy5cbiAgICAgICAgY29uc3QgZnJhYyA9IE1hdGgubWluKDEsIChldi5jbGllbnRYIC0gcmVjdC5sZWZ0KSAvIHJlY3Qud2lkdGgpO1xuICAgICAgICBjb25zdCB0MCA9IHN0YXRlLnRpY2tzWzBdO1xuICAgICAgICBjb25zdCBzcGFuTXMgPSBzdGF0ZS50aWNrc1tzdGF0ZS50aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xuICAgICAgICBjb25zdCB0aHVtYlQgPSBzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF07XG4gICAgICAgIGNvbnN0IGRpc3QgPSB0aHVtYlQgLSAodDAgKyBmcmFjICogc3Bhbk1zKTtcbiAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGRpc3QgLyBzdGF0ZS5ncmlkTXMpKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBzID09PSAwID8gbnVsbCA6IG1zVG9QZXJpb2RJU08oc3RlcHMgKiBzdGF0ZS5ncmlkTXMpO1xuICAgIH1cblxuICAgIC8vIE1vdmUgYW5kIHJlbGVhc2UgbGlzdGVuIG9uIHRoZSBkb2N1bWVudCBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBkcmFnOiB0aGUgaGFuZGxlXG4gICAgLy8gaXMgMTJweCB3aWRlLCB0aGUgY3Vyc29yIGxlYXZlcyBpdCBvbiB0aGUgZmlyc3QgZmFzdCBtb3ZlbWVudCwgYW5kIGV2ZW50cyB0aGF0XG4gICAgLy8gdGFyZ2V0IHdoYXRldmVyIGlzIHVuZGVybmVhdGggd291bGQgc3R1dHRlciB0aGUgZHJhZyBhbmQgY291bGQgc3dhbGxvdyB0aGUgcmVsZWFzZVxuICAgIC8vIGVudGlyZWx5IC0tIGFuIHVuY29tbWl0dGVkIGRyYWcgdGhlbiBzbmFwcyBiYWNrIG9uIHRoZSBuZXh0IHN5bmMuXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIC8vIENhcHR1cmUgcmV0YXJnZXRzIGV2ZXJ5IHBvaW50ZXIgZXZlbnQgdG8gdGhlIGhhbmRsZSB1bnRpbCByZWxlYXNlLCBubyBtYXR0ZXJcbiAgICAgICAgLy8gd2hlcmUgdGhlIGN1cnNvciBpcy4gV2l0aG91dCBpdCwgbGV0dGluZyBnbyB3aXRoIHRoZSBwb2ludGVyIG92ZXIgdGhlIG1hcCBoYW5kc1xuICAgICAgICAvLyBwb2ludGVydXAgdG8gTGVhZmxldCdzIGNvbnRhaW5lciBoYW5kbGVycywgYW5kIGEgcmVsZWFzZSB0aGV5IHN3YWxsb3cgbmV2ZXJcbiAgICAgICAgLy8gcmVhY2hlcyB0aGUgZG9jdW1lbnQgbGlzdGVuZXIgLS0gdGhlIGRyYWcgc3RheXMgdW5jb21taXR0ZWQgYW5kIHRoZSBuZXh0IHN5bmNcbiAgICAgICAgLy8gc25hcHMgdGhlIGhhbmRsZSBob21lLiBUaGUgZG9jdW1lbnQgbGlzdGVuZXJzIGJlbG93IHJlbWFpbiBhcyB0aGUgZmFsbGJhY2sgZm9yXG4gICAgICAgIC8vIGVudmlyb25tZW50cyB3aXRob3V0IGNhcHR1cmU7IHdpdGggaXQsIHJldGFyZ2V0ZWQgZXZlbnRzIHN0aWxsIGJ1YmJsZSB0byB0aGVtLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKSB0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZShldi5wb2ludGVySWQpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogc3ludGhldGljIGV2ZW50cyBoYXZlIG5vIGFjdGl2ZSBwb2ludGVyOyBmYWxsIGJhY2sgdG8gYnViYmxpbmcgKi8gfVxuXG4gICAgICAgIGNvbnN0IG1vdmUgPSBlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGZpbmlzaCA9IGUgPT4ge1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dDb21taXQoaXNvKTtcbiAgICAgICAgfTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XG4gICAgfSk7XG5cbiAgICAvLyBLZXlib2FyZDogb25lIGdyaWQgc3RlcCBwZXIgYXJyb3csIERlbGV0ZS9Ib21lIHRvIGNsZWFyLiBTYW1lIGNvbnRyYWN0IGFzIHRoZSBkcmFnLlxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcykgcmV0dXJuO1xuICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IDA7XG4gICAgICAgIGxldCBuZXh0O1xuICAgICAgICBpZiAoZXYua2V5ID09PSBcIkFycm93TGVmdFwiKSBuZXh0ID0gY3VycmVudCArIHN0YXRlLmdyaWRNcztcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkFycm93UmlnaHRcIikgbmV4dCA9IE1hdGgubWF4KDAsIGN1cnJlbnQgLSBzdGF0ZS5ncmlkTXMpO1xuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiRGVsZXRlXCIgfHwgZXYua2V5ID09PSBcIkhvbWVcIikgbmV4dCA9IDA7XG4gICAgICAgIGVsc2UgcmV0dXJuO1xuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChuZXh0ID4gMCA/IG1zVG9QZXJpb2RJU08obmV4dCkgOiBudWxsKTtcbiAgICB9KTtcbn1cbiIsICIvLyBUaW1lIGZpbHRlcmluZyBvbiB0aGUgR1BVLCBmb3IgcG9pbnQgbGF5ZXJzLlxyXG4vL1xyXG4vLyBUaGUgY29vcmRpbmF0ZXMgYWxyZWFkeSBsaXZlIGluIEdQVSBidWZmZXJzOyByZWJ1aWxkaW5nIHRoZSBtZXJnZWQgbGF5ZXIgcGVyIHRpY2sgdGhyZXdcclxuLy8gdGhhdCBhd2F5IGFuZCByZS1mZWQgZ2xpZnkgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTIC0tIG1lYXN1cmVkIGF0IH4yLjZzIHBlciB3aW5kb3dcclxuLy8gY2hhbmdlIGF0IHRoYXQgc2NhbGUsIHdpdGggYWxsb2NhdGlvbiBjaHVybiB0aGF0IGNvdWxkIGNyYXNoIHRoZSB0YWIgd2hlbiBjaGFuZ2VzXHJcbi8vIHN0YWNrZWQuIEluc3RlYWQsIGVhY2ggcG9pbnQncyB0aW1lIGludGVydmFsIGFuZCBpdHMgbGF5ZXIncyBkdXJhdGlvbiByaWRlIGFsb25nIGFzXHJcbi8vIHZlcnRleCBhdHRyaWJ1dGVzIHVwbG9hZGVkIG9uY2UsIGFuZCB0aGUgY3VycmVudCB0aWNrIGlzIGEgdW5pZm9ybTogYSB0aWNrIG9yIHdpbmRvd1xyXG4vLyBjaGFuZ2UgY29zdHMgdHdvIGZsb2F0cyBhbmQgYSByZWRyYXcuXHJcbi8vXHJcbi8vIGdsaWZ5IG1ha2VzIHRoaXMgcG9zc2libGUgd2l0aG91dCBmb3JraW5nIGl0OiB2ZXJ0ZXhTaGFkZXJTb3VyY2UgaXMgYW4gb3ZlcnJpZGFibGVcclxuLy8gc2V0dGluZyAodGhlIHBpbiBmcmFnbWVudCBzaGFkZXIgYWxyZWFkeSB1c2VzIHRoZSBzYW1lIGRvb3IpLCBpbnN0YW5jZXMgZXhwb3NlIHRoZWlyXHJcbi8vIGdsL3Byb2dyYW0vY2FudmFzLCBhdHRyaWJ1dGVzIGFyZSBib3VuZCBvbmNlIGF0IHNldHVwLCBhbmQgdGhlIHBlci1mcmFtZSBkcmF3IHRvdWNoZXNcclxuLy8gb25seSB0aGUgbWF0cml4IHVuaWZvcm0gLS0gc28gZXh0cmEgYXR0cmlidXRlcyBib3VuZCBhZnRlciBzZXR1cCBwZXJzaXN0LCBhbmQgdW5pZm9ybVxyXG4vLyB1cGRhdGVzIHRha2UgZWZmZWN0IG9uIHRoZSBuZXh0IHJlZHJhdy5cclxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIHBlcmlvZFRvTXMsIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFRpbWVzIHRyYXZlbCBhcyBmbG9hdDMyIG9uIHRoZSBHUFUsIHdob3NlIGludGVnZXJzIGFyZSBleGFjdCBvbmx5IHRvIDJeMjQuIEVwb2NoIG1zIGlzXHJcbi8vIGhvcGVsZXNzIGF0IHRoYXQgcHJlY2lzaW9uLCBzbyB0aW1lcyBhcmUgcmViYXNlZCB0byB0aGUgYnVja2V0J3MgZWFybGllc3Qgc3RhcnQgYW5kXHJcbi8vIGV4cHJlc3NlZCBpbiBzZWNvbmRzOiBleGFjdCB0byB+MTk0IGRheXMgb2Ygc3BhbiwgYW5kIGEgMnMgcm91bmRpbmcgYmV5b25kIHRoYXQgaXNcclxuLy8gaW52aXNpYmxlIGF0IGFueSB6b29tIGEgdGltZSBzbGlkZXIgbWFrZXMgc2Vuc2UgYXQuXHJcbmNvbnN0IEFMV0FZUyA9IDYuM2U4OyAgIC8vIH4yMCB5ZWFycywgaW4gc2Vjb25kczogdGhlIFwiZHVyYXRpb25cIiBvZiBjdW11bGF0aXZlIGxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHRoZSBzcGFuIGhhbGYtd2lkdGggb2YgcG9pbnRzIHdpdGggbm8gcmVhZGFibGUgdGltZS5cclxuXHJcbi8vIFBlci1idWNrZXQgbGF5ZXItdmlzaWJpbGl0eSBzbG90cyBpbiB0aGUgdmVydGV4IHNoYWRlci4gRWFjaCBmbG9hdCBhcnJheSBlbGVtZW50XHJcbi8vIG9jY3VwaWVzIGEgZnVsbCB1bmlmb3JtIHZlY3RvciBpbiBFUyBHTFNMIHBhY2tpbmcsIGFuZCB0aGUgc3BlYyBndWFyYW50ZWVzIG9ubHkgMTI4XHJcbi8vIHZlcnRleCB1bmlmb3JtIHZlY3RvcnMgLS0gNjQgc2xvdHMgbGVhdmVzIGNvbWZvcnRhYmxlIHJvb20gZm9yIHRoZSBtYXRyaXggYW5kIHRoZSB0aW1lXHJcbi8vIHVuaWZvcm1zLiBBIGJ1Y2tldCB3aXRoIG1vcmUgbGF5ZXJzIHRoYW4gc2xvdHMgZmFsbHMgYmFjayB0byByZWJ1aWxkLXBlci10b2dnbGUuXHJcbi8vIChQYWNraW5nIGZvdXIgbGF5ZXJzIHBlciB2ZWM0IHdvdWxkIHF1YWRydXBsZSB0aGlzIGlmIGFueW9uZSBldmVyIG5lZWRzIGl0LilcclxuZXhwb3J0IGNvbnN0IExBWUVSX1NMT1RTID0gNjQ7XHJcblxyXG4vLyBDaGVhcCBraWxsIHN3aXRjaGVzOiBpZiB3aXJpbmcgdGhlIEdMIHN0YXRlIGV2ZXIgZmFpbHMgKGEgZnV0dXJlIGdsaWZ5IHZlcnNpb24gbW92aW5nXHJcbi8vIGl0cyBpbnRlcm5hbHMpLCB0aGUgYWZmZWN0ZWQgZmFtaWx5IGZhbGxzIGJhY2sgdG8gdGhlIENQVSByZWJ1aWxkIHBhdGguIFBvaW50cyBhbmRcclxuLy8gdmVjdG9ycyBhcmUgc2VwYXJhdGUgZmxhZ3MgLS0gYSB2ZWN0b3IgaW50cm9zcGVjdGlvbiBmYWlsdXJlIG11c3Qgbm90IGNvc3QgcG9pbnRzXHJcbi8vIHRoZWlyIEdQVSBwYXRoLlxyXG5sZXQgZ3B1T2sgPSB0cnVlO1xyXG5leHBvcnQgZnVuY3Rpb24gZ3B1VGltZUF2YWlsYWJsZSgpIHsgcmV0dXJuIGdwdU9rOyB9XHJcbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlR3B1VGltZShyZWFzb24pIHtcclxuICAgIGlmIChncHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZpbHRlcmluZyBkaXNhYmxlZDogJHtyZWFzb259LiBgICtcclxuICAgICAgICBgRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2suYCk7XHJcbiAgICBncHVPayA9IGZhbHNlO1xyXG59XHJcbmxldCB2ZWN0b3JHcHVPayA9IHRydWU7XHJcbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JHcHVBdmFpbGFibGUoKSB7IHJldHVybiB2ZWN0b3JHcHVPazsgfVxyXG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZVZlY3RvckdwdShyZWFzb24pIHtcclxuICAgIGlmICh2ZWN0b3JHcHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZvciBsaW5lcy9wb2x5Z29ucyBkaXNhYmxlZDogYCArXHJcbiAgICAgICAgYCR7cmVhc29ufS4gRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2sgZm9yIHRob3NlIGJ1Y2tldHMuYCk7XHJcbiAgICB2ZWN0b3JHcHVPayA9IGZhbHNlO1xyXG59XHJcblxyXG4vLyBUaGUgZGVmYXVsdCBwb2ludHMgdmVydGV4IHNoYWRlciAocmVhZCBvdXQgb2YgbGVhZmxldC5nbGlmeSAzLjMuMCkgd2l0aCB0aGUgd2luZG93XHJcbi8vIHRlc3QgYWRkZWQuIEEgaGlkZGVuIHBvaW50IGdldHMgc2l6ZSAwIGFuZCBhIHBvc2l0aW9uIG91dHNpZGUgY2xpcCBzcGFjZSwgc28gbmVpdGhlclxyXG4vLyB0aGUgdmlzaWJsZSBwYXNzIG5vciB0aGUgc2hhcmVkLXByb2dyYW0gcGlja2luZyBwYXNzIGV2ZXIgcmFzdGVyaXNlcyBpdC5cclxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVWZXJ0ZXhTaGFkZXIoKSB7XHJcbiAgICByZXR1cm4gYHVuaWZvcm0gbWF0NCBtYXRyaXg7XHJcbmF0dHJpYnV0ZSB2ZWM0IHZlcnRleDtcclxuYXR0cmlidXRlIHZlYzQgY29sb3I7XHJcbmF0dHJpYnV0ZSBmbG9hdCBwb2ludFNpemU7XHJcbmF0dHJpYnV0ZSB2ZWMyIGFUaW1lU3BhbjtcclxuYXR0cmlidXRlIGZsb2F0IGFEdXJhdGlvbjtcclxuYXR0cmlidXRlIGZsb2F0IGFMYXllcjtcclxudW5pZm9ybSBmbG9hdCB1VGljaztcclxudW5pZm9ybSBmbG9hdCB1T3ZlcnJpZGU7XHJcbnVuaWZvcm0gZmxvYXQgdUxheWVyVmlzWyR7TEFZRVJfU0xPVFN9XTtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxuXHJcbnZvaWQgbWFpbigpIHtcclxuICAvLyBBIG5lZ2F0aXZlIGR1cmF0aW9uIGlzIHRoZSBmYWRlIGZsYWc6IHxhRHVyYXRpb258IGlzIHRoZSB3aW5kb3csIHRoZSBzaWduIHNheXMgdGhpc1xyXG4gIC8vIHBvaW50IGRpbXMgd2l0aCBhZ2UuIEEgc2hhcmVkIG92ZXJyaWRlIGtlZXBzIHRoZSBwb2ludCdzIG93biBmYWRlIHByZWZlcmVuY2UuXHJcbiAgYm9vbCBmYWRlcyA9IGFEdXJhdGlvbiA8IDAuMDtcclxuICBmbG9hdCBkdXIgPSB1T3ZlcnJpZGUgPj0gMC4wID8gdU92ZXJyaWRlIDogYWJzKGFEdXJhdGlvbik7XHJcbiAgLy8gSGFsZi1vcGVuICh0aWNrIC0gZHVyLCB0aWNrXSwgbWF0Y2hpbmcgZmVhdHVyZUluV2luZG93IG9uIHRoZSBDUFUgc2lkZSAtLSBBTkRlZCB3aXRoXHJcbiAgLy8gdGhlIHBvaW50J3MgbGF5ZXIgYmVpbmcgdmlzaWJsZS4gTGF5ZXIgdG9nZ2xlcyBhcmUgb25lIHVuaWZvcm0gZWxlbWVudCwgbm90IGFcclxuICAvLyByZWJ1aWxkOiB1bmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZS1mZWVkIGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUy5cclxuICBib29sIHZpc2libGUgPSBhVGltZVNwYW4ueSA+ICh1VGljayAtIGR1cikgJiYgYVRpbWVTcGFuLnggPD0gdVRpY2tcclxuICAgICAgJiYgdUxheWVyVmlzW2ludChhTGF5ZXIpXSA+IDAuNTtcclxuICBnbF9Qb2ludFNpemUgPSB2aXNpYmxlID8gcG9pbnRTaXplIDogMC4wO1xyXG4gIGdsX1Bvc2l0aW9uID0gdmlzaWJsZSA/IG1hdHJpeCAqIHZlcnRleCA6IHZlYzQoMi4wLCAyLjAsIDIuMCwgMS4wKTtcclxuICAvLyBBZ2UgcnVucyBmcm9tIHRoZSBmZWF0dXJlJ3MgZW5kOyBuZXdlc3QgaXMgb3BhcXVlLCB0aGUgdHJhaWxpbmcgZWRnZSByZWFjaGVzIHplcm8uXHJcbiAgZmxvYXQgYWxwaGEgPSBmYWRlcyA/IGNsYW1wKDEuMCAtICh1VGljayAtIGFUaW1lU3Bhbi55KSAvIGR1ciwgMC4wLCAxLjApIDogMS4wO1xyXG4gIF9jb2xvciA9IHZlYzQoY29sb3IucmdiLCBjb2xvci5hICogYWxwaGEpO1xyXG59XHJcbmA7XHJcbn1cclxuXHJcbi8vIFBlci1sYXllciBkdXJhdGlvbiBpbiBzZWNvbmRzOiBudWxsIGFjY3VtdWxhdGVzLCBcInBlcmlvZFwiIGlzIHRoZSBzaGFyZWQgaW50ZXJ2YWwsXHJcbi8vIGFuIElTTyBzdHJpbmcgaXMgaXRzZWxmOyBhbnl0aGluZyB1bnBhcnNlYWJsZSBmYWxscyBiYWNrIHRvIHRoZSBpbnRlcnZhbC5cclxuZnVuY3Rpb24gZHVyYXRpb25TZWNvbmRzKHNwZWMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoc3BlYyA9PT0gbnVsbCB8fCBzcGVjID09PSB1bmRlZmluZWQpIHJldHVybiBBTFdBWVM7XHJcbiAgICBpZiAoc3BlYyA9PT0gXCJwZXJpb2RcIikgcmV0dXJuIChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XHJcbiAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xyXG4gICAgcmV0dXJuIG1zID8gbXMgLyAxMDAwIDogKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcclxufVxyXG5cclxuLy8gQnVpbGRzIHRoZSBwZXItcG9pbnQgYXR0cmlidXRlIGFycmF5cyBmb3Igb25lIG1lcmdlZCBidWNrZXQsIGluIHRoZSBleGFjdCBvcmRlciB0aGVcclxuLy8gYnVja2V0IGZlZWRzIHBvaW50cyB0byBnbGlmeTogbGF5ZXIgYnkgbGF5ZXIsIGluZGV4IDAuLm4tMSwgd2l0aCBzaW5nbGUtYGxvY2F0aW9uYFxyXG4vLyBsYXllcnMgY29udHJpYnV0aW5nIG9uZSBwb2ludC4gUG9pbnRzIGluIGxheWVycyB3aXRob3V0IHRpbWUgbWV0YWRhdGEgLS0gYW5kIHBvaW50c1xyXG4vLyB3aG9zZSB0aW1lIHdhcyB1bnJlYWRhYmxlIChOYU4pIC0tIGdldCBhIHNwYW4gdGhhdCBpcyB2aXNpYmxlIGF0IGV2ZXJ5IHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGxldCBoYXNUaW1lID0gZmFsc2U7XHJcbiAgICBjb25zdCBwZXJMYXllciA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgIGNvbnN0IGNvdW50ID0gYnVmID8gYnVmLmJ5dGVMZW5ndGggLyAxNiA6IChsYXllci5sb2NhdGlvbiA/IDEgOiAwKTtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBpZiAobGF5ZXIudGltZSkgaGFzVGltZSA9IHRydWU7XHJcbiAgICAgICAgcGVyTGF5ZXIucHVzaCh7IGxheWVyLCBjb3VudCwgdGltZXMgfSk7XHJcbiAgICAgICAgdG90YWwgKz0gY291bnQ7XHJcbiAgICB9XHJcbiAgICBpZiAoIWhhc1RpbWUpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcblxyXG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcclxuICAgIGZvciAoY29uc3QgeyB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBjb25zdCBsYXllcklkcyA9IFtdO1xyXG4gICAgbGV0IG91dCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJJZHMubGVuZ3RoO1xyXG4gICAgICAgIGxheWVySWRzLnB1c2gobGF5ZXIuaWQpO1xyXG4gICAgICAgIGNvbnN0IGR1ciA9IGxheWVyLnRpbWUgPyBkdXJhdGlvblNlY29uZHMobGF5ZXIudGltZS5kdXJhdGlvbiwgcGVyaW9kTXMpIDogQUxXQVlTO1xyXG4gICAgICAgIC8vIFRoZSBmYWRlIGZsYWcgcmlkZXMgdGhlIGR1cmF0aW9uJ3Mgc2lnbiwgc28gaXQgY29zdHMgbm8gZXh0cmEgYXR0cmlidXRlLlxyXG4gICAgICAgIC8vIFRpbWVsZXNzIChOYU4pIHBvaW50cyBrZWVwIGEgcG9zaXRpdmUgZHVyYXRpb246IHdpdGggbm8gYWdlLCBub3RoaW5nIHRvIGZhZGUuXHJcbiAgICAgICAgY29uc3Qgc2lnbmVkRHVyID0gbGF5ZXIudGltZSAmJiBsYXllci50aW1lLmZhZGUgPyAtZHVyIDogZHVyO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IHRpbWVzID8gdGltZXNbaSAqIDJdIDogTmFOO1xyXG4gICAgICAgICAgICBjb25zdCBlbmQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyICsgMV0gOiBOYU47XHJcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpKSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IC1BTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IChzdGFydCAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IChlbmQgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBzaWduZWREdXI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGlkeDtcclxuICAgICAgICAgICAgb3V0Kys7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgc3BhbnMsIGR1cnMsIGxheWVySWR4LCBsYXllcklkcywgY291bnQ6IHRvdGFsIH07XHJcbn1cclxuXHJcbi8vIFBlci1mZWF0dXJlIHRpbWUgbWV0YWRhdGEgZm9yIGEgdmVjdG9yIGJ1Y2tldCAobGluZXMvcG9seWdvbnMpLiBTYW1lIGVuY29kaW5ncyBhc1xyXG4vLyB0aGUgcG9pbnQgcGF0aCAtLSByZWJhc2VkIGZsb2F0MzIgc2Vjb25kcywgc2lnbi1wYWNrZWQgZmFkZSwgYWx3YXlzLXZpc2libGUgc3BhbnNcclxuLy8gZm9yIHRpbWVsZXNzIG9yIG5vbi10aW1lIGxheWVycy5cclxuLy9cclxuLy8gQSBwb2x5bGluZSB3aG9zZSA6OnRpbWVzIGJ1ZmZlciBob2xkcyBvbmUgW3N0YXJ0LCBlbmRdIHBhaXIgUEVSIFZFUlRFWCBhbmltYXRlc1xyXG4vLyBwZXIgc2VnbWVudCB3aXRoaW4gb25lIGxheWVyOiBzZWdtZW50IGsgc3BhbnMgdmVydGV4IGsncyBzdGFydCB0byB2ZXJ0ZXggaysxJ3NcclxuLy8gZW5kLCBhbmQgYmVjYXVzZSBnbGlmeSBidWlsZHMgMiBkZWRpY2F0ZWQgR0wgdmVydGljZXMgcGVyIHNlZ21lbnQgLS0gc2VnbWVudHNcclxuLy8gbmV2ZXIgc2hhcmUgdmVydGljZXMgLS0gYm90aCBlbmRwb2ludHMgY2FycnkgdGhlIHNhbWUgc3BhbiBhbmQgc2VnbWVudHMgYXBwZWFyXHJcbi8vIGF0b21pY2FsbHkuIFRoYXQgaXMgd2hhdCBsZXRzIGEgd2hvbGUgc2VnbWVudGVkIHRyYWNrIHJpZGUgT05FIGxheWVyIHNsb3QgdGhlIHdheVxyXG4vLyBhIDIwMGstcG9pbnQgbGF5ZXIgZG9lcywgaW5zdGVhZCBvZiBvbmUgc2xvdCBwZXIgY2h1bmsgYWdhaW5zdCB0aGUgNjQgY2VpbGluZy5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBwZXJGZWF0dXJlID0gbGF5ZXJzTGlzdC5tYXAoKGxheWVyLCBpZHgpID0+IHtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcclxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XHJcbiAgICAgICAgaWYgKCF0aW1lcyB8fCAodGltZXMubGVuZ3RoID09PSAyICYmIE51bWJlci5pc05hTih0aW1lc1swXSkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiAtQUxXQVlTLCBlbmQ6IEFMV0FZUywgZHVyOiBBTFdBWVMsIGlkeCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBuVmVydHMgPSB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIiAmJiB0aW1lcy5sZW5ndGggPiAyXHJcbiAgICAgICAgICAgICAgICAmJiB0aW1lcy5sZW5ndGggPT09IG5WZXJ0cyAqIDIpIHtcclxuICAgICAgICAgICAgLy8gU2VnbWVudHMgbmV2ZXIgY3Jvc3MgYSBwYXJ0IGJvdW5kYXJ5OiBhIG11bHRpLXBhcnQgbGluZSBkcmF3c1xyXG4gICAgICAgICAgICAvLyBuVmVydHMgLSBwYXJ0cyBzZWdtZW50cywgYW5kIGEgc3BhbiBidWlsdCBmcm9tIG9uZSBwYXJ0J3MgbGFzdFxyXG4gICAgICAgICAgICAvLyB2ZXJ0ZXggdG8gdGhlIG5leHQgcGFydCdzIGZpcnN0IHdvdWxkIGJlIHRoZSBwaGFudG9tIHNlZ21lbnRcclxuICAgICAgICAgICAgLy8gcmVhcHBlYXJpbmcgaW4gdGhlIHRpbWUgcGF0aCAtLSBvbmUgZXh0cmEgc3BhbiwgYW5kIGV2ZXJ5IGF0dHJpYnV0ZVxyXG4gICAgICAgICAgICAvLyBhZnRlciBpdCBzaGVhcnMgKHRoZSBsZW5ndGggY2hlY2sgdGhlbiBkcm9wcyB0aGUgd2hvbGUgZmVhdHVyZSB0b1xyXG4gICAgICAgICAgICAvLyBpdHMgb3ZlcmFsbCBzcGFuKS4gV2FsayB0aGUgcGFydHMgdGhlIHdheSB0aGUgcmVuZGVyZXIgZHJhd3MgdGhlbS5cclxuICAgICAgICAgICAgY29uc3QgbGVuZ3RocyA9IEFycmF5LmlzQXJyYXkobGF5ZXIucGFydHMpICYmIGxheWVyLnBhcnRzLmxlbmd0aCA+IDFcclxuICAgICAgICAgICAgICAgID8gbGF5ZXIucGFydHMgOiBbblZlcnRzXTtcclxuICAgICAgICAgICAgY29uc3Qgc2VncyA9IGxlbmd0aHMucmVkdWNlKChhLCBuKSA9PiBhICsgTWF0aC5tYXgoMCwgbiAtIDEpLCAwKTtcclxuICAgICAgICAgICAgY29uc3Qgc2VnID0gbmV3IEZsb2F0NjRBcnJheShzZWdzICogMik7XHJcbiAgICAgICAgICAgIGxldCBrID0gMCwgb2Zmc2V0ID0gMDtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBuIG9mIGxlbmd0aHMpIHtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGogPSAwOyBqICsgMSA8IG47IGorKykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHMgPSB0aW1lc1sob2Zmc2V0ICsgaikgKiAyXTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBlID0gdGltZXNbKG9mZnNldCArIGogKyAxKSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHMpIHx8IE51bWJlci5pc05hTihlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gLUFMV0FZUzsgICAgICAvLyBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDIgKyAxXSA9IEFMV0FZUztcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gKHMgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gKGUgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGsrKztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG9mZnNldCArPSBuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIE92ZXJhbGwgc3BhbiByaWRlcyBhbG9uZyBhcyB0aGUgZmFsbGJhY2sgaWYgY291bnRzIGV2ZXIgbWlzYWxpZ24uXHJcbiAgICAgICAgICAgIHJldHVybiB7IHNlZywgc3RhcnQ6IHNlZ1swXSwgZW5kOiBzZWdbc2VnLmxlbmd0aCAtIDFdLFxyXG4gICAgICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAodGltZXNbMF0gLSBiYXNlKSAvIDEwMDAsIGVuZDogKHRpbWVzWzFdIC0gYmFzZSkgLyAxMDAwLFxyXG4gICAgICAgICAgICAgICAgIGR1cjogc2lnbmVkRHVyLCBpZHggfTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgcGVyRmVhdHVyZSwgbGF5ZXJJZHM6IGxheWVyc0xpc3QubWFwKGwgPT4gbC5pZCkgfTtcclxufVxyXG5cclxuLy8gQSB2ZWN0b3IgbGF5ZXIncyB2ZXJ0ZXggY291bnQgZnJvbSB3aGljaGV2ZXIgdHJhbnNwb3J0IGNhcnJpZXMgaXRzIGNvb3JkaW5hdGVzOlxyXG4vLyB0aGUgYmluYXJ5IGJ1ZmZlciAoMiBmbG9hdDY0IHBlciB2ZXJ0ZXgpIG9yIGlubGluZSBgbG9jYXRpb25zYC5cclxuZnVuY3Rpb24gdmVydGV4Q291bnRPZihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmIChyYXcpIHJldHVybiAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCB8fCAwKSAvIDE2O1xyXG4gICAgcmV0dXJuIChsYXllci5sb2NhdGlvbnMgfHwgW10pLmxlbmd0aDtcclxufVxyXG5cclxuLy8gRXhwYW5kcyBwZXItZmVhdHVyZSB2YWx1ZXMgdG8gcGVyLUdMLXZlcnRleCBhcnJheXMgZ2l2ZW4gZWFjaCBmZWF0dXJlJ3MgdmVydGV4IGNvdW50LlxyXG4vLyBQdXJlLCBzbyB0aGUgYWxpZ25tZW50IGxvZ2ljIGlzIHRpZXItMSB0ZXN0YWJsZSBhd2F5IGZyb20gYW55IEdMIGNvbnRleHQuXHJcbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQZXJGZWF0dXJlKHBlckZlYXR1cmUsIGNvdW50cykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGZvciAoY29uc3QgYyBvZiBjb3VudHMpIHRvdGFsICs9IGM7XHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBsZXQgb3V0ID0gMDtcclxuICAgIHBlckZlYXR1cmUuZm9yRWFjaCgoZiwgaSkgPT4ge1xyXG4gICAgICAgIC8vIFBlci1zZWdtZW50IHNwYW5zOiBHTCB2ZXJ0ZXggdiBiZWxvbmdzIHRvIHNlZ21lbnQgdiA+PiAxIChnbGlmeSBkcmF3c1xyXG4gICAgICAgIC8vIDIgZGVkaWNhdGVkIHZlcnRpY2VzIHBlciBzZWdtZW50KSwgc28gYm90aCBlbmRwb2ludHMgdGFrZSB0aGUgc2VnbWVudCdzXHJcbiAgICAgICAgLy8gc3BhbiBhbmQgYSBzZWdtZW50IGFwcGVhcnMgb3IgZGlzYXBwZWFycyBhdG9taWNhbGx5LiBzZWcgaG9sZHMgc2VncyoyXHJcbiAgICAgICAgLy8gZmxvYXRzIGFuZCB0aGUgZmVhdHVyZSBkcmF3cyBzZWdzKjIgR0wgdmVydGljZXMsIHNvIHRoZSBsZW5ndGhzIGFncmVlaW5nXHJcbiAgICAgICAgLy8gaXMgdGhlIGFsaWdubWVudCBjaGVjazsgYSBtaXNtYXRjaCBmYWxscyBiYWNrIHRvIHRoZSB3aG9sZS1mZWF0dXJlIHNwYW5cclxuICAgICAgICAvLyByYXRoZXIgdGhhbiBzaGVhcmluZyBldmVyeSBhdHRyaWJ1dGUgYWZ0ZXIgaXQuXHJcbiAgICAgICAgY29uc3QgcGVyU2VnbWVudCA9IGYuc2VnICYmIGYuc2VnLmxlbmd0aCA9PT0gY291bnRzW2ldID8gZi5zZWcgOiBudWxsO1xyXG4gICAgICAgIGZvciAobGV0IHYgPSAwOyB2IDwgY291bnRzW2ldOyB2KyspIHtcclxuICAgICAgICAgICAgY29uc3QgayA9IHBlclNlZ21lbnQgPyAodiA+PiAxKSAqIDIgOiAtMTtcclxuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrXSA6IGYuc3RhcnQ7XHJcbiAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IHBlclNlZ21lbnQgPyBwZXJTZWdtZW50W2sgKyAxXSA6IGYuZW5kO1xyXG4gICAgICAgICAgICBkdXJzW291dF0gPSBmLmR1cjtcclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGYuaWR4O1xyXG4gICAgICAgICAgICBvdXQrKztcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB7IHNwYW5zLCBkdXJzLCBsYXllcklkeCB9O1xyXG59XHJcblxyXG4vLyBnbGlmeSdzIHZlcnRleCBsYXlvdXQ6IDYgZmxvYXRzIHBlciBHTCB2ZXJ0ZXggKHgsIHksIHIsIGcsIGIsIGEpLCBjb25maXJtZWQgZm9yIDMuMy4wXHJcbi8vIGJvdGggYnkgcmVhZGluZyB0aGUgc291cmNlIGFuZCBieSB0aGUgVmFsaGFsbGEtVlJFIHJlcG9ydCdzIGRlYnVnIGR1bXAgLS0gdHdvXHJcbi8vIG9uZS1zZWdtZW50IGxpbmVzIHByb2R1Y2VkIGFsbFZlcnRpY2VzVHlwZWQgb2YgMjQgZmxvYXRzOiAyIGZlYXR1cmVzIHggMiB2ZXJ0aWNlcyB4IDYuXHJcbmNvbnN0IEZMT0FUU19QRVJfVkVSVEVYID0gNjtcclxuXHJcbi8vIFdpcmVzIHRpbWUgKyBsYXllci12aXNpYmlsaXR5IGludG8gYSBsaXZlIGdsaWZ5IExJTkVTIG9yIFNIQVBFUyBpbnN0YW5jZS4gVGhlIGNhbGxlclxyXG4vLyBzdXBwbGllcyBwZXItZmVhdHVyZSBHTC12ZXJ0ZXggY291bnRzIGNvbXB1dGVkIGZyb20gdGhlIGdlb21ldHJ5IGl0IGJ1aWx0IGl0c2VsZjpcclxuLy8gbGluZXMgZHJhdyAyKihwb2ludHMtMSkgdmVydGljZXMgcGVyIGZlYXR1cmUsIGFuZCBhbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHNpbXBsZSByaW5nXHJcbi8vIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3MgZWFyY3V0LiBUaGUgY291bnRzXHJcbi8vIGFyZSB2YWxpZGF0ZWQgYWdhaW5zdCB0aGUgaW5zdGFuY2UncyBhY3R1YWwgYnVmZmVyIGxlbmd0aCwgYW5kIGFueSBtaXNtYXRjaCBkaXNhYmxlc1xyXG4vLyB0aGUgdmVjdG9yIEdQVSBwYXRoIHJhdGhlciB0aGFuIG1pcy1hbGlnbmluZyBhdHRyaWJ1dGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UoaW5zdGFuY2UsIG1ldGEsIGNvdW50cykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY291bnRzKSB8fCBjb3VudHMubGVuZ3RoICE9PSBtZXRhLnBlckZlYXR1cmUubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgZXhwZWN0ZWQgJHttZXRhLnBlckZlYXR1cmUubGVuZ3RofSB2ZXJ0ZXggY291bnRzLCBgICtcclxuICAgICAgICAgICAgICAgIGBnb3QgJHtjb3VudHMgJiYgY291bnRzLmxlbmd0aH1gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgZXhwZWN0ZWQgPSBjb3VudHMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgKiBGTE9BVFNfUEVSX1ZFUlRFWDtcclxuICAgICAgICAvLyBMaW5lcyBrZWVwIGEgdHlwZWQgZmxhdCBidWZmZXI7IHNoYXBlcyBrZWVwIGEgcGxhaW4gZmxhdCBhcnJheS4gRWl0aGVyIGlzIHRoZVxyXG4gICAgICAgIC8vIGdyb3VuZCB0cnV0aCBmb3IgaG93IG1hbnkgR0wgdmVydGljZXMgZ2xpZnkgYWN0dWFsbHkgYnVpbHQuXHJcbiAgICAgICAgY29uc3QgYWN0dWFsID0gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZCA/IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQubGVuZ3RoXHJcbiAgICAgICAgICAgIDogKEFycmF5LmlzQXJyYXkoaW5zdGFuY2UudmVydGljZXMpID8gaW5zdGFuY2UudmVydGljZXMubGVuZ3RoIDogLTEpO1xyXG4gICAgICAgIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4IGNvdW50IG1pc21hdGNoOiBnZW9tZXRyeSBzYXlzICR7ZXhwZWN0ZWR9IGZsb2F0cywgYCArXHJcbiAgICAgICAgICAgICAgICBgdGhlIGluc3RhbmNlIGhvbGRzICR7YWN0dWFsfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBhdHRycyA9IGV4cGFuZFBlckZlYXR1cmUobWV0YS5wZXJGZWF0dXJlLCBjb3VudHMpO1xyXG4gICAgICAgIGF0dHJzLmJhc2UgPSBtZXRhLmJhc2U7XHJcbiAgICAgICAgYXR0cnMubGF5ZXJJZHMgPSBtZXRhLmxheWVySWRzO1xyXG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGRpc2FibGVWZWN0b3JHcHUoZXJyLm1lc3NhZ2UpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBXaXJlcyB0aGUgYXR0cmlidXRlIGJ1ZmZlcnMgYW5kIHVuaWZvcm1zIGludG8gYSBsaXZlIGdsaWZ5IHBvaW50cyBpbnN0YW5jZS4gUmV0dXJucyBhXHJcbi8vIGhhbmRsZSB3aG9zZSBzZXRXaW5kb3cgY29zdHMgdHdvIHVuaWZvcm1zIGFuZCBhIHJlZHJhdywgb3IgbnVsbCBpZiBhbnl0aGluZyBhYm91dCB0aGVcclxuLy8gaW5zdGFuY2UgaXMgbm90IHdoZXJlIGdsaWZ5IDMuMy4wIGtlZXBzIGl0IC0tIGluIHdoaWNoIGNhc2UgR1BVIHRpbWUgaXMgZGlzYWJsZWQgYW5kXHJcbi8vIHRoZSBjYWxsZXIncyByZWJ1aWxkIHBhdGggdGFrZXMgb3Zlci5cclxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb0luc3RhbmNlKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycyk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICBkaXNhYmxlR3B1VGltZShlcnIubWVzc2FnZSk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFRoZSBjb21tb24gR0wgd2lyaW5nOiBidWZmZXJzIGZvciBzcGFuL2R1cmF0aW9uL2xheWVyIGF0dHJpYnV0ZXMsIHVuaWZvcm1zIGZvciB0aGVcclxuLy8gdGljaywgdGhlIHNoYXJlZCBvdmVycmlkZSBhbmQgdGhlIHBlci1sYXllciB2aXNpYmlsaXR5IHNsb3RzLiBUaHJvd3Mgb24gYW55dGhpbmdcclxuLy8gdW5leHBlY3RlZDsgdGhlIGNhbGxlcnMgZGVjaWRlIHdoaWNoIGZhbGxiYWNrIGZsYWcgdGhhdCBmbGlwcy5cclxuZnVuY3Rpb24gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAge1xyXG4gICAgICAgIGNvbnN0IGdsID0gaW5zdGFuY2UuZ2w7XHJcbiAgICAgICAgY29uc3QgcHJvZ3JhbSA9IGluc3RhbmNlLnByb2dyYW07XHJcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBpbnN0YW5jZS5sYXllcjtcclxuICAgICAgICBpZiAoIWdsIHx8ICFwcm9ncmFtIHx8ICFsYXllcikgdGhyb3cgbmV3IEVycm9yKFwiaW5zdGFuY2UgbGFja3MgZ2wvcHJvZ3JhbS9sYXllclwiKTtcclxuXHJcbiAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3BhbkxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYVRpbWVTcGFuXCIpO1xyXG4gICAgICAgIGNvbnN0IGR1ckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUR1cmF0aW9uXCIpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhTGF5ZXJcIik7XHJcbiAgICAgICAgY29uc3QgdGlja0xvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVUaWNrXCIpO1xyXG4gICAgICAgIGNvbnN0IG92ZXJyaWRlTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidU92ZXJyaWRlXCIpO1xyXG4gICAgICAgIC8vIFNvbWUgZHJpdmVycyBuYW1lIHRoZSBhcnJheSBoZWFkIFwidUxheWVyVmlzWzBdXCI7IGFjY2VwdCBlaXRoZXIuXHJcbiAgICAgICAgY29uc3QgdmlzTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzXCIpXHJcbiAgICAgICAgICAgIHx8IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1swXVwiKTtcclxuICAgICAgICBpZiAoc3BhbkxvYyA8IDAgfHwgZHVyTG9jIDwgMCB8fCBsYXllckxvYyA8IDAgfHwgIXRpY2tMb2MgfHwgIW92ZXJyaWRlTG9jIHx8ICF2aXNMb2MpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidGltZSBhdHRyaWJ1dGVzL3VuaWZvcm1zIG1pc3NpbmcgZnJvbSB0aGUgbGlua2VkIHByb2dyYW1cIik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBzcGFuQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHNwYW5CdWYpO1xyXG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5zcGFucywgZ2wuU1RBVElDX0RSQVcpO1xyXG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoc3BhbkxvYywgMiwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShzcGFuTG9jKTtcclxuXHJcbiAgICAgICAgY29uc3QgZHVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGR1ckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmR1cnMsIGdsLlNUQVRJQ19EUkFXKTtcclxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGR1ckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShkdXJMb2MpO1xyXG5cclxuICAgICAgICBjb25zdCBsYXllckJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xyXG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBsYXllckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmxheWVySWR4LCBnbC5TVEFUSUNfRFJBVyk7XHJcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihsYXllckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShsYXllckxvYyk7XHJcblxyXG4gICAgICAgIC8vIFVudGlsIHRoZSBzbGlkZXIgc2F5cyBvdGhlcndpc2UsIGV2ZXJ5dGhpbmcgaXMgdmlzaWJsZSAtLSBpbiB0aW1lIEFORCBsYXllci5cclxuICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgQUxXQVlTKTtcclxuICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIC0xKTtcclxuICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKSk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIGxheWVySWRzOiBhdHRycy5sYXllcklkcyxcclxuICAgICAgICAgICAgLy8gdGlja01zIGluIGVwb2NoIG1zOyBvdmVycmlkZU1zIGEgc2hhcmVkLXdpbmRvdyB3aWR0aCBvciBudWxsLlxyXG4gICAgICAgICAgICBzZXRXaW5kb3codGlja01zLCBvdmVycmlkZU1zKSB7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIHRpY2tNcyA9PT0gbnVsbCA/IEFMV0FZUyA6ICh0aWNrTXMgLSBhdHRycy5iYXNlKSAvIDEwMDApO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCBvdmVycmlkZU1zID09PSBudWxsID8gLTEgOiBvdmVycmlkZU1zIC8gMTAwMCk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gT25lIGZsb2F0IHBlciBsYXllciBzbG90LCBpbiBhdHRycy5sYXllcklkcyBvcmRlci4gQSBzaWRlYmFyIHRvZ2dsZSBsYW5kc1xyXG4gICAgICAgICAgICAvLyBoZXJlIGluc3RlYWQgb2YgcmVidWlsZGluZyB0aGUgYnVja2V0LlxyXG4gICAgICAgICAgICBzZXRMYXllclZpc2liaWxpdHkodmlzQXJyYXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IG5ldyBGbG9hdDMyQXJyYXkoTEFZRVJfU0xPVFMpLmZpbGwoMSk7XHJcbiAgICAgICAgICAgICAgICB2aXMuc2V0KHZpc0FycmF5LnNsaWNlKDAsIExBWUVSX1NMT1RTKSk7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmdih2aXNMb2MsIHZpcyk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkSlMsIGJpbmRQb3B1cCwgYmluZFRvb2x0aXAsIHBhcnNlQ29sb3IgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XHJcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXHJcbiAgICAgICAgIHBlcmlvZFRvTXMgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcclxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XHJcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XHJcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XHJcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XHJcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcclxuICAgIH1cclxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xyXG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xyXG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcclxuICAgICAgICAgICAgLy8gV2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZCAodGhlIHdpZGdldCdzIGNsaWNrIGhhbmRsZXIgc3RhbXBzIHRoaXNcclxuICAgICAgICAgICAgLy8gcGVyIGNsaWNrLCBiZWZvcmUgYW55IGZlYXR1cmUgaGFuZGxlciBydW5zKSwgRVZFUlkgbWF0Y2ggc3RhbmRzIGRvd246XHJcbiAgICAgICAgICAgIC8vIGEgY2xpY2sgaW4gcmVtb3ZhbCBtb2RlIGlzIGEgZGVsZXRpb24gYXR0ZW1wdCwgYW5kIGFuc3dlcmluZyBpdCB3aXRoXHJcbiAgICAgICAgICAgIC8vIGEgZmVhdHVyZSBwb3B1cCBvciBhIGNvb3JkcyByZWFkb3V0IHJlYWRzIGFzIFwicmVtb3ZlIGlzIGJyb2tlblwiLlxyXG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCAmJiAhbWFwLl9wbU1vZGVBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xyXG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xyXG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XHJcbiAgICB9XHJcbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcclxuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcclxuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XHJcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgfSwgMCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xyXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcclxuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXHJcbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxyXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxyXG4vL1xyXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcclxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxyXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxyXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXHJcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcclxuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xyXG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xyXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcclxuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcclxuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcclxuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xyXG4gICAgY29uc3QgcHJvcHMgPSB7fTtcclxuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcclxuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwcm9wcztcclxufVxyXG5cclxuXHJcblxyXG4vLyBBbiBpbWFnZXJ5IG92ZXJsYXkncyBpZGVudGl0eTogZXZlcnl0aGluZyB0aGUgcmVuZGVyZWQgZWxlbWVudCBkZXJpdmVzIGZyb20gaXRzXHJcbi8vIGNvbmZpZy4gVGhlIHN5bmMgbG9vcCByZWNyZWF0ZXMgdGhlIG92ZXJsYXkgd2hlbiB0aGlzIGNoYW5nZXMgKG9yIHdoZW4gdGhlXHJcbi8vIGJpbmFyeSBidWZmZXIgb2JqZWN0IHVuZGVyIHRoZSBsYXllciBpZCBpcyByZXBsYWNlZCksIHNpbmNlIGEgRE9NIGltYWdlIGlzIGFcclxuLy8gc2luZ2xlIGNoZWFwIG5vZGUgLS0gbm8gaW5jcmVtZW50YWwgdXBkYXRlIG1hY2hpbmVyeSBuZWVkZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbWFnZU1ldGFLZXkobGF5ZXIpIHtcclxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShbbGF5ZXIudXJsIHx8IG51bGwsIGxheWVyLmJvdW5kcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIub3BhY2l0eSA/PyAxLCBsYXllci5pbWFnZV9mb3JtYXQgfHwgbnVsbF0pO1xyXG59XHJcblxyXG4vLyBHZW9yZWZlcmVuY2VkIHBpeGVscyBwaW5uZWQgdG8gYSBsYXQvbG9uIGJveC4gVGhlIGNvbmZpZyBpcyBwdXJlIGRhdGEgLS1cclxuLy8ge3R5cGU6IFwiaW1hZ2VcIiwgYm91bmRzLCBvcGFjaXR5LCB1cmwgfCBieXRlcyB1bmRlciB0aGUgbGF5ZXIgaWR9IC0tIHNvIGFcclxuLy8gcGxhaW4tSlMgY29uc3VtZXIgcGFzc2VzIGEgVVJMIGFuZCB0aGUgd2lkZ2V0IHBhdGggc2hpcHMgYnl0ZXMgb3ZlciB0aGVcclxuLy8gYmluYXJ5IGJ1ZmZlciB0cmFuc3BvcnQuIFB5dGhvbiBoYXMgYWxyZWFkeSB3YXJwZWQgdGhlIHJhc3RlciBpbnRvIHRoZSBNQVAnc1xyXG4vLyBvd24gQ1JTIGdyaWQgKHJhc3RlcmlvIHNpZGUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIExlYWZsZXQncyBsaW5lYXIgY29ybmVyXHJcbi8vIHN0cmV0Y2ggZXhhY3RseSBjb3JyZWN0OyB0aGlzIHN0YXlzIGEgZHVtYiByZW5kZXJlci5cclxuZnVuY3Rpb24gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcikge1xyXG4gICAgaWYgKCFsYXllci5ib3VuZHMpIHJldHVybiBudWxsO1xyXG4gICAgbGV0IHVybCA9IGxheWVyLnVybDtcclxuICAgIGxldCBvYmplY3RVcmwgPSBudWxsO1xyXG4gICAgaWYgKCF1cmwgJiYgY29vcmRCdWZmZXIpIHtcclxuICAgICAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2Nvb3JkQnVmZmVyXSxcclxuICAgICAgICAgICAgeyB0eXBlOiBsYXllci5pbWFnZV9mb3JtYXQgfHwgXCJpbWFnZS9wbmdcIiB9KTtcclxuICAgICAgICBvYmplY3RVcmwgPSB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgfVxyXG4gICAgaWYgKCF1cmwpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IEwuaW1hZ2VPdmVybGF5KHVybCwgbGF5ZXIuYm91bmRzLCB7XHJcbiAgICAgICAgb3BhY2l0eTogbGF5ZXIub3BhY2l0eSA/PyAxLFxyXG4gICAgICAgIC8vIENvbnRleHQsIG5vdCBhIGNsaWNrIHRhcmdldDogY2xpY2tzIGZhbGwgdGhyb3VnaCB0byBmZWF0dXJlcyBhbmQgdGhlXHJcbiAgICAgICAgLy8gZW1wdHktbWFwIGNvb3JkaW5hdGUgZmFsbGJhY2suIFRoZSBkZWZhdWx0IG92ZXJsYXlQYW5lICh6IDQwMClcclxuICAgICAgICAvLyBhbHJlYWR5IHNpdHMgYWJvdmUgdGlsZXMgKDIwMCkgYW5kIGJlbG93IHRoZSBHTCBwYW5lcyAoNDEwKykuXHJcbiAgICAgICAgaW50ZXJhY3RpdmU6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAob2JqZWN0VXJsKSB7XHJcbiAgICAgICAgb3ZlcmxheS5vbihcInJlbW92ZVwiLCAoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKG9iamVjdFVybCkpO1xyXG4gICAgfVxyXG4gICAgb3ZlcmxheS5hZGRUbyhtYXApO1xyXG4gICAgb3ZlcmxheS5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgb3ZlcmxheS5pbWFnZU1ldGEgPSBpbWFnZU1ldGFLZXkobGF5ZXIpO1xyXG4gICAgb3ZlcmxheS5pbWFnZVNvdXJjZSA9IGNvb3JkQnVmZmVyIHx8IG51bGw7XHJcbiAgICByZXR1cm4gb3ZlcmxheTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyLCBtb2RlbCkge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIikge1xyXG4gICAgICAgIHJldHVybiByZW5kZXJJbWFnZUxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyKTtcclxuICAgIH1cclxuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICBjb25zdCBncm91cCA9IEwubGF5ZXJHcm91cCgpO1xyXG4gICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9O1xyXG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xyXG4gICAgICAgICAgICBpZiAoc3ViLnR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJtYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWxpbmVcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgc3ViLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBzdWIsIGNvb3JkaW5hdGVCdWZmZXJzW3N1Yi5pZF0sIG1vZGVsKTtcclxuICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XHJcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcclxuICAgICAgICBncm91cC5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgICAgIHJldHVybiBncm91cDtcclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBBIHZlY3RvciBsYXllcidzIGNvb3JkaW5hdGVzOiB0aGUgYmluYXJ5IGJ1ZmZlciB1bmRlciBpdHMgaWQgd2hlbiBQeXRob24gYnVpbHQgaXRcclxuLy8gKHRoZSBsYXllcnMgSlNPTiB0aGVuIGNhcnJpZXMgbm8gY29vcmRpbmF0ZXMgYXQgYWxsKSwgb3IgaW5saW5lIGBsb2NhdGlvbnNgIGZvclxyXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xyXG4vLyBvbiB0aGUgR1BVIHBhdGggcmFyZWx5IGRvLlxyXG5leHBvcnQgZnVuY3Rpb24gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLmxvY2F0aW9ucykgcmV0dXJuIGxheWVyLmxvY2F0aW9ucztcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IGZsYXQgPSBuZXcgRmxvYXQ2NEFycmF5KHJhdy5idWZmZXIgfHwgcmF3LCByYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xyXG4gICAgY29uc3Qgb3V0ID0gbmV3IEFycmF5KGZsYXQubGVuZ3RoIC8gMik7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG91dC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG91dFtpXSA9IFtmbGF0W2kgKiAyXSwgZmxhdFtpICogMiArIDFdXTtcclxuICAgIH1cclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIEEgbGluZSBsYXllcidzIGNvb3JkaW5hdGVzIGFzIHBhcnRzOiB0aGUgZmxhdCBydW4gc2xpY2VkIGJ5IHRoZSBjb25maWcncyBgcGFydHNgXHJcbi8vIGxlbmd0aCB0YWJsZSwgb3Igb25lIHBhcnQgd2l0aG91dCBpdC4gQSBtdWx0aS1wYXJ0IGxpbmUgLS0gTVVMVElMSU5FU1RSSU5HLFxyXG4vLyBNdWx0aUxpbmVTdHJpbmcgLS0gaXMgT05FIGxheWVyIGRyYXduIGFzIGRpc2pvaW50IHJ1bnM7IG5vdGhpbmcgbWF5IGV2ZXIgZHJhdyBhXHJcbi8vIHNlZ21lbnQgZnJvbSBvbmUgcGFydCdzIGxhc3QgdmVydGV4IHRvIHRoZSBuZXh0IHBhcnQncyBmaXJzdC5cclxuZXhwb3J0IGZ1bmN0aW9uIGxpbmVQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxlbmd0aHMgPSBBcnJheS5pc0FycmF5KGxheWVyLnBhcnRzKSAmJiBsYXllci5wYXJ0cy5sZW5ndGggPiAxID8gbGF5ZXIucGFydHMgOiBudWxsO1xyXG4gICAgaWYgKCFsZW5ndGhzKSByZXR1cm4gbG9jcy5sZW5ndGggPyBbbG9jc10gOiBbXTtcclxuICAgIGNvbnN0IHBhcnRzID0gW107XHJcbiAgICBsZXQgb2Zmc2V0ID0gMDtcclxuICAgIGZvciAoY29uc3QgbiBvZiBsZW5ndGhzKSB7XHJcbiAgICAgICAgY29uc3QgcGFydCA9IGxvY3Muc2xpY2Uob2Zmc2V0LCBvZmZzZXQgKyBuKTtcclxuICAgICAgICBvZmZzZXQgKz0gbjtcclxuICAgICAgICBpZiAocGFydC5sZW5ndGggPj0gMikgcGFydHMucHVzaChwYXJ0KTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuZnVuY3Rpb24gY2xvc2VSaW5nKHJpbmcpIHtcclxuICAgIGlmIChyaW5nLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBmaXJzdCA9IHJpbmdbMF07XHJcbiAgICAgICAgY29uc3QgbGFzdCA9IHJpbmdbcmluZy5sZW5ndGggLSAxXTtcclxuICAgICAgICBpZiAoZmlyc3RbMF0gIT09IGxhc3RbMF0gfHwgZmlyc3RbMV0gIT09IGxhc3RbMV0pIHtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmluZztcclxufVxyXG5cclxuLy8gZ2xpZnkncyBsaW5lIGhpdCB0b2xlcmFuY2UgaXMgYHNlbnNpdGl2aXR5ICsgd2VpZ2h0L3NjYWxlYCwgYW5kIHNlbnNpdGl2aXR5IGlzIGFcclxuLy8gQ09OU1RBTlQgaW4gbGF0bG5nIGRlZ3JlZXMgLS0gMC4xIGZvciBjbGlja3MgKH4xMSBrbSkgYW5kIDAuMDMgZm9yIGhvdmVycyxcclxuLy8gem9vbS1ibGluZCwgc28gYSBjbGljayB3aXRoaW4gc2lnaHQgb2YgYSBsaW5lIG1hdGNoZWQgaXQgYW5kIHN0YXJ2ZWQgdGhlXHJcbi8vIGVtcHR5LW1hcCBmYWxsYmFjay4gVGhlIHdlaWdodC9zY2FsZSB0ZXJtIGFscmVhZHkgY292ZXJzIHRoZSBkcmF3biB3aWR0aDtcclxuLy8gcmVwbGFjZSB0aGUgY29uc3RhbnQgd2l0aCBhIGZldyBwaXhlbHMnIHdvcnRoIGF0IHRoZSBjdXJyZW50IHpvb20uIFRoZSBpbnN0YW5jZVxyXG4vLyBnZXR0ZXJzIHJlYWQgYHNldHRpbmdzYCBsaXZlIHBlciBldmVudCwgc28gdXBkYXRpbmcgb24gem9vbSBpcyBlbm91Z2ggLS0gbm9cclxuLy8gZ2xpZnkgcGF0Y2hpbmcuIFJldHVybnMgdGhlIHVuc3Vic2NyaWJlIGZvciBvblJlbW92ZS5cclxuY29uc3QgTElORV9ISVRfU0xBQ0tfUFggPSA4O1xyXG5mdW5jdGlvbiB0cmFja0xpbmVTZW5zaXRpdml0eShtYXAsIGluc3RhbmNlKSB7XHJcbiAgICBjb25zdCBhcHBseSA9ICgpID0+IHtcclxuICAgICAgICBjb25zdCBzbGFjayA9IExJTkVfSElUX1NMQUNLX1BYIC8gTWF0aC5wb3coMiwgbWFwLmdldFpvb20oKSk7XHJcbiAgICAgICAgaW5zdGFuY2Uuc2V0dGluZ3Muc2Vuc2l0aXZpdHkgPSBzbGFjaztcclxuICAgICAgICBpbnN0YW5jZS5zZXR0aW5ncy5zZW5zaXRpdml0eUhvdmVyID0gc2xhY2s7XHJcbiAgICB9O1xyXG4gICAgYXBwbHkoKTtcclxuICAgIG1hcC5vbihcInpvb21lbmRcIiwgYXBwbHkpO1xyXG4gICAgcmV0dXJuICgpID0+IG1hcC5vZmYoXCJ6b29tZW5kXCIsIGFwcGx5KTtcclxufVxyXG5cclxuLy8gQW4gYXJlYSBsYXllcidzIGdlb21ldHJ5IGFzIHBhcnRzIC0+IGNsb3NlZCBbbG9uLCBsYXRdIHJpbmdzOiBhIHBvbHlnb24ncyBmbGF0XHJcbi8vIGNvb3JkaW5hdGUgcnVuIHNsaWNlZCBieSBpdHMgYHJpbmdzYCB0YWJsZSAob25lIGhvbGUtZnJlZSByaW5nIHdpdGhvdXQgaXQpLCBvciBhXHJcbi8vIGNpcmNsZSdzIGdlbmVyYXRlZCByaW5nLiBGZWVkcyBib3RoIHRoZSBmaWxsIChlYXJjdXQsIGluIHRoZSBwb2x5Z29uIGJ1Y2tldCkgYW5kXHJcbi8vIHRoZSBvdXRsaW5lIChMaW5lU3RyaW5ncyBpbiB0aGUgbGluZXMgYnVja2V0KS5cclxuZnVuY3Rpb24gYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICBjb25zdCBsYXQgPSBsYXllci5sb2NhdGlvblswXTtcclxuICAgICAgICBjb25zdCBsb24gPSBsYXllci5sb2NhdGlvblsxXTtcclxuICAgICAgICBjb25zdCByYWRpdXNNZXRlcnMgPSBsYXllci5yYWRpdXMgfHwgMTA7XHJcbiAgICAgICAgY29uc3QgZWFydGhSYWRpdXMgPSA2Mzc4MTM3O1xyXG4gICAgICAgIGNvbnN0IHJpbmcgPSBbXTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XHJcbiAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xyXG4gICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtsb24gKyAoZExvbiAqIDE4MCkgLyBNYXRoLlBJLCBsYXQgKyAoZExhdCAqIDE4MCkgLyBNYXRoLlBJXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBbW3JpbmddXTtcclxuICAgIH1cclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxvbmxhdCA9IGxvY3MubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgIGNvbnN0IHJpbmdUYWJsZSA9IGxheWVyLnJpbmdzIHx8IChsb25sYXQubGVuZ3RoID4gMCA/IFtbbG9ubGF0Lmxlbmd0aF1dIDogW10pO1xyXG4gICAgY29uc3QgcGFydHMgPSBbXTtcclxuICAgIGxldCBhdCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHBhcnRMZW5zIG9mIHJpbmdUYWJsZSkge1xyXG4gICAgICAgIGNvbnN0IHJpbmdzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsZW4gb2YgcGFydExlbnMpIHtcclxuICAgICAgICAgICAgY29uc3QgcmluZyA9IGNsb3NlUmluZyhsb25sYXQuc2xpY2UoYXQsIGF0ICsgbGVuKSk7XHJcbiAgICAgICAgICAgIGF0ICs9IGxlbjtcclxuICAgICAgICAgICAgaWYgKHJpbmcubGVuZ3RoID49IDQpIHJpbmdzLnB1c2gocmluZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChyaW5ncy5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKHJpbmdzKTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCBsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRmVhdHVyZVZpc2libGUgPSBudWxsKSB7XHJcbiAgICAvLyBIaXQtdGVzdCBndWFyZDogR1BVLXBhdGggYnVja2V0cyBob2xkIGhpZGRlbiBsYXllcnMgKGFuZCBvdXQtb2Ytd2luZG93XHJcbiAgICAvLyBmZWF0dXJlcyksIG1hc2tlZCBvbmx5IGJ5IHNoYWRlciB1bmlmb3JtcyBnbGlmeSdzIGhpdC10ZXN0cyBjYW5ub3Qgc2VlLiBUaGVcclxuICAgIC8vIHdpZGdldCBwYXNzZXMgYSBsaXZlIGxvb2t1cDsgdGhlIGZhbGxiYWNrIGNvdmVycyBwbGFpbi1KUyBjb25zdW1lcnMgd2l0aCB0aGVcclxuICAgIC8vIGNvbmZpZydzIG93biBmbGFnLlxyXG4gICAgY29uc3QgdmlzaWJsZU5vdyA9IGlzRmVhdHVyZVZpc2libGUgfHwgKChsKSA9PiBsLnZpc2libGUgIT09IGZhbHNlKTtcclxuICAgIC8vIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lIGdlb21ldHJ5IHBlciBsYXllci4gT24gdGhlIEdQVSBwYXRoIChtYXAuanNcclxuICAgIC8vIHBhc3NlcyB2ZWN0b3JHcHUgd2hlbiB0aGUgYnVja2V0IHF1YWxpZmllcykgZXZlcnkgZmVhdHVyZSBzdGF5cyBpbiB0aGUgYnVmZmVycyBhbmRcclxuICAgIC8vIHRoZSBzaGFkZXIgZGVjaWRlcyB2aXNpYmlsaXR5IHBlciB0aWNrIGFuZCBwZXIgbGF5ZXIgdG9nZ2xlIC0tIGEgbGluZS1zaGFwZWQgdHJhY2tcclxuICAgIC8vIGhhcyBhcyBtYW55IHZlcnRpY2VzIGFzIGEgcG9pbnQgdHJhY2sgaGFzIHBvaW50cywgc28gaXRzIHJlYnVpbGRzIGNvc3QgdGhlIHNhbWVcclxuICAgIC8vIGFuZCBjcmFzaGVkIHRoZSBzYW1lIHdheS4gT2ZmIHRoZSBHUFUgcGF0aCwgdGhlIHdob2xlLWZlYXR1cmUgQ1BVIGZpbHRlciByZW1haW5zLlxyXG4gICAgY29uc3QgdmVjdG9yTWV0YSA9IHZlY3RvckdwdSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCJcclxuICAgICAgICA/IGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCB2ZWN0b3JUaW1lID0gQm9vbGVhbih2ZWN0b3JNZXRhLmhhc1RpbWUpO1xyXG4gICAgaWYgKHRpbWVTdGF0ZSAmJiAhdmVjdG9yVGltZSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCIpIHtcclxuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcclxuICAgICAgICBpZiAobGF5ZXJzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xyXG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XHJcblxyXG4gICAgICAgICAgICAvLyBBcmVhIG91dGxpbmVzOiBhIHBvbHlnb24gb3IgY2lyY2xlIGluIHRoaXMgYnVja2V0IGNvbnRyaWJ1dGVzIGVhY2ggb2YgaXRzXHJcbiAgICAgICAgICAgIC8vIHJpbmdzIGFzIG9uZSBMaW5lU3RyaW5nLCBkcmF3biB3aXRoIHRoZSBhcmVhJ3Mgc3Ryb2tlIG9wdGlvbnMgLS0gY29sb3IsXHJcbiAgICAgICAgICAgIC8vIHdlaWdodCwgb3BhY2l0eSwgTGVhZmxldCdzIG93biBzZW1hbnRpY3MuIE91dGxpbmUgd2VpZ2h0IGFuZCBvcGFjaXR5IG5ldmVyXHJcbiAgICAgICAgICAgIC8vIHJlbmRlcmVkIGJlZm9yZSB0aGlzOyB0aGUgZmlsbCBtYWNoaW5lcnkgY2Fubm90IGRyYXcgdGhlbSAoZ2xpZnkncyBib3JkZXJcclxuICAgICAgICAgICAgLy8gaXMgMXB4IGFuZCBmaWxsLWNvbG91cmVkKSwgdGhlIGxpbmVzIG1hY2hpbmVyeSBhbHJlYWR5IGRvZXMuXHJcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIiB8fCBsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICAgICAgICAgICAgaWYgKChzdHlsZS53ZWlnaHQgPz8gMykgPiAwICYmIChzdHlsZS5vcGFjaXR5ID8/IDEuMCkgPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmcgb2YgcmluZ3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAocmluZy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIkxpbmVTdHJpbmdcIiwgY29vcmRpbmF0ZXM6IHJpbmcgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT3V0bGluZSBwaXhlbHMgb25seSAtLSB0aGUgYXJlYSdzIHNoYXBlcyBpbnN0YW5jZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvd25zIGludGVyYWN0aW9uIHdpdGggZXhhY3QgY29udGFpbm1lbnQuIExlZnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2xpY2thYmxlLCB0aGVzZSByaW5ncyBhbnN3ZXJlZCB0aHJvdWdoIGdsaWZ5J3NcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGluZSB0b2xlcmFuY2UgKDAuMSBERUdSRUVTIGZvciBjbGlja3MgdnMgMC4wM1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmb3IgaG92ZXJzKTogcG9wdXBzIHdlbGwgb3V0c2lkZSB0aGUgc2hhcGUgYW5kXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc2lkZSBob2xlcywgaG92ZXIgZGlzYWdyZWVpbmcgd2l0aCBjbGljay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCb3JkZXI6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTsgICAvLyAwIGtlZXBzIHRoZSBzbG90IGFsaWduZWQgd2hlbiBzdHJva2VsZXNzXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gT25lIExpbmVTdHJpbmcgZmVhdHVyZSBQRVIgUEFSVCwgZXZlcnkgcGFydCBjYXJyeWluZyB0aGUgbGF5ZXIgLS0gbmV2ZXJcclxuICAgICAgICAgICAgLy8gYSBNdWx0aUxpbmVTdHJpbmc6IGdsaWZ5J3MgTXVsdGlMaW5lU3RyaW5nIHBhdGggaGl0LXRlc3RzIHRoZSBjb25uZWN0b3JcclxuICAgICAgICAgICAgLy8gYmV0d2VlbiBwYXJ0cywgd2hpY2ggaXMgdGhlIHBoYW50b20gc2VnbWVudCBieSBhbm90aGVyIHJvdXRlLiBUaGUgR0xcclxuICAgICAgICAgICAgLy8gdmVydGV4IHN0cmVhbSBzdGF5cyBjb25zZWN1dGl2ZSwgc28gdGhlIHBlci1sYXllciBjb3VudCBzdGlsbCBhbGlnbnNcclxuICAgICAgICAgICAgLy8gdGhlIHRpbWUgYXR0cmlidXRlczsgYSBzdHJva2VsZXNzIG9yIGRlZ2VuZXJhdGUgbGF5ZXIga2VlcHMgaXRzIHNsb3QuXHJcbiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGFydCBvZiBsaW5lUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZ2VvanNvbkNvb3JkcyA9IHBhcnQubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkxpbmVTdHJpbmdcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IGdlb2pzb25Db29yZHNcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goY291bnQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcclxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcclxuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lT3B0aW9ucyA9IHZlY3RvclRpbWVcclxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5nbExpbmVzID0gTC5nbGlmeS5saW5lcyh7XHJcbiAgICAgICAgICAgICAgICAgICAgLi4ubGluZU9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5bGluZXNQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGRhdGEgYWJvdmUgaXMgR2VvSlNPTiwgd2hvc2UgY29vcmRpbmF0ZXMgYXJlIFtsb24sIGxhdF07IGdsaWZ5XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZGVmYXVsdHMgdG8gbGF0aXR1ZGUtZmlyc3QgYW5kIGl0cyBMSU5FIHZlcnRleCBidWlsZGVyIHJlYWRzXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gY29vcmRpbmF0ZXMgdGhyb3VnaCB0aGVzZSBrZXlzIC0tIHVuc2V0LCBpdCB0b29rIGxvbmdpdHVkZSBhc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGxhdGl0dWRlIGFuZCBwcm9qZWN0ZWQgZXZlcnkgbGluZSBvZmYtdmlld3BvcnQuIFNpbGVudGx5OiBubyBHTFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGVycm9yLCBhIGhlYWx0aHkgY2FudmFzLCB6ZXJvIGZyYWdtZW50cy4gU2V0IHBlciBpbnN0YW5jZSByYXRoZXJcclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGFuIG9uIHRoZSBMLmdsaWZ5IGdsb2JhbCwgd2hpY2ggYW5vdGhlciBsaWJyYXJ5IGNvdWxkIGFsc29cclxuICAgICAgICAgICAgICAgICAgICAvLyBtdXRhdGUuIFRoZSBwb2x5Z29uIHBhdGggaXMgZGVsaWJlcmF0ZWx5IE5PVCBnaXZlbiB0aGVzZSBrZXlzOlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGl0IHRyaWFuZ3VsYXRlcyB2aWEgZWFyY3V0IG9uIHRoZSBHZW9KU09OIGRpcmVjdGx5LCBuYXRpdmVcclxuICAgICAgICAgICAgICAgICAgICAvLyBbbG9uLCBsYXRdLCBhbmQga2V5cyB0aGVyZSB3b3VsZCB0cmFuc3Bvc2UgaXQgdGhlIHNhbWUgd2F5LlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZvdW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgYnVnIHJlcG9ydCwgZHJpdmluZyB0aGUgcGxhaW4tSlNcclxuICAgICAgICAgICAgICAgICAgICAvLyBidW5kbGUgd2hlcmUgbm8gcG9pbnRzIG1hc2tlZCB0aGUgYmxhbmsgbGluZXMuXHJcbiAgICAgICAgICAgICAgICAgICAgbGF0aXR1ZGVLZXk6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgbG9uZ2l0dWRlS2V5OiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZmVhdHVyZSB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzIHx8IGZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFyZTogc2hpbnl3aWRnZXRzJyBtb2RlbCBoYXMgbm8gYGNvbW1gXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvcGVydHksIHNvIGdhdGluZyBvbiBpdCBzaWxlbnRseSBraWxsZWQgdGhpc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgd2FzIHRoZSBvbmUgcGF0aCB0aGF0IHdvcmtlZCB0aGVyZS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXJlIHRoZSBjbGljayBsYW5kZWQsIGZlYXR1cmUgb3Igbm90OiBvbmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJhaXQgYWx3YXlzIGFuc3dlcnMgXCJ3aGVyZVwiLCBjbGlja2VkX2xheWVyX2lkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sYXQgKiAxZTUpIC8gMWU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxuZyAqIDFlNSkgLyAxZTVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQnVtcGVkIG9uIEVWRVJZIGNsaWNrOiBjbGlja2luZyB0aGUgc2FtZSBmZWF0dXJlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHR3aWNlIGNoYW5nZXMgbmVpdGhlciBpZCBub3IgaW5kZXgsIHNvIHdpdGhvdXRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBubyB0cmFpdCBmaXJlcyBhbmQgaGFuZGxlcnMgbWlzcyB0aGUgY2xpY2suXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrX3NlcVwiLCAobW9kZWwuZ2V0KFwiY2xpY2tfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmICFmZWF0dXJlLnByb3BlcnRpZXMuaXNCb3JkZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiB2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsTGluZXMpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2Vuc2l0aXZpdHlPZmYgPSB0cmFja0xpbmVTZW5zaXRpdml0eShtLCB0aGlzLmdsTGluZXMpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHZlY3RvclRpbWUpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZSh0aGlzLmdsTGluZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NlbnNpdGl2aXR5T2ZmKSB0aGlzLl9zZW5zaXRpdml0eU9mZigpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xMaW5lcykgdGhpcy5nbExpbmVzLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xyXG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWdvblwiKSB7XHJcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcclxuICAgICAgICBjb25zdCB2ZXJ0ZXhDb3VudHMgPSBbXTtcclxuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMCk7ICAgLy8gbm8gZmVhdHVyZSwgYnV0IHRoZSBzbG90IG11c3Qgc3RheSBhbGlnbmVkXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBBbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHBvbHlnb24gd2l0aCBEIGRpc3RpbmN0IHZlcnRpY2VzIGFuZCBoIGhvbGVzIGhhc1xyXG4gICAgICAgICAgICAvLyBleGFjdGx5IEQgKyAyaCAtIDIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzXHJcbiAgICAgICAgICAgIC8vIGVhcmN1dDsgaCA9IDAgZ2l2ZXMgdGhlIGZhbWlsaWFyIEQgLSAyLiBSaW5ncyBhcmUgY2xvc2VkIGJ5IG5vdywgc28gZWFjaFxyXG4gICAgICAgICAgICAvLyBjb250cmlidXRlcyBsZW5ndGggLSAxIGRpc3RpbmN0IHZlcnRpY2VzLiBQYXJ0cyB0cmlhbmd1bGF0ZSBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICAgIC8vIGFuZCBzdW0uXHJcbiAgICAgICAgICAgIGxldCB0cmlhbmdsZXMgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmdzIG9mIHBhcnRzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0aW5jdCA9IHJpbmdzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLmxlbmd0aCAtIDEsIDApO1xyXG4gICAgICAgICAgICAgICAgdHJpYW5nbGVzICs9IE1hdGgubWF4KDAsIGRpc3RpbmN0ICsgMiAqIChyaW5ncy5sZW5ndGggLSAxKSAtIDIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKDMgKiB0cmlhbmdsZXMpO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XHJcbiAgICAgICAgICAgIC8vIExlYWZsZXQncyBvd24gc2VtYW50aWNzOiB0aGUgZmlsbCBpcyBmaWxsQ29sb3IsIGRlZmF1bHRpbmcgdG8gdGhlIHN0cm9rZVxyXG4gICAgICAgICAgICAvLyBjb2xvciB3aGVuIHVuc2V0LiBJdCB1c2VkIHRvIGFsd2F5cyBmaWxsIHdpdGggYGNvbG9yYCwgd2hpY2ggbWFkZVxyXG4gICAgICAgICAgICAvLyBcInJlZCBvdXRsaW5lLCBwYWxlIGJsdWUgZmlsbFwiIC0tIHRoZSBtb3N0IGJhc2ljIHBvbHlnb24gc3R5bGluZyBhc2sgLS1cclxuICAgICAgICAgICAgLy8gaW1wb3NzaWJsZTsgdGhlIG91dGxpbmUgaXRzZWxmIGlzIGRyYXduIGJ5IHRoZSBsaW5lcyBidWNrZXQuXHJcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuZmlsbENvbG9yIHx8IHN0eWxlLmZpbGxfY29sb3IgfHwgc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcclxuICAgICAgICAgICAgLy8gT25lIEZlYXR1cmUgUEVSIFBBUlQsIG5ldmVyIGEgTXVsdGlQb2x5Z29uOiBnbGlmeSdzIHNoYXBlcyBvbmx5XHJcbiAgICAgICAgICAgIC8vIGV4cGxvZGVzIE11bHRpUG9seWdvbiB3aGVuIGhhbmRlZCBhIGJhcmUgRmVhdHVyZSBvciBnZW9tZXRyeSAtLSBpbiBhXHJcbiAgICAgICAgICAgIC8vIEZlYXR1cmVDb2xsZWN0aW9uIHRoZSBjb29yZGluYXRlcyByZWFjaCBlYXJjdXQuZmxhdHRlbiB1bmV4cGxvZGVkLFxyXG4gICAgICAgICAgICAvLyBlYXJjdXQgcmV0dXJucyBubyBpbmRpY2VzLCBhbmQgdGhlIGZlYXR1cmUgc2lsZW50bHkgZHJhd3MgWkVSTyBmaWxsXHJcbiAgICAgICAgICAgIC8vIHRyaWFuZ2xlcyAodmVyaWZpZWQgYWdhaW5zdCBnbGlmeSAzLjMuMDsgaXRzIFwidW5oYW5kbGVkIHBvbHlnb25cIlxyXG4gICAgICAgICAgICAvLyB0aHJvdyBzaXRzIGluc2lkZSB0aGUgZW1wdHkgbG9vcCBhbmQgbmV2ZXIgZmlyZXMpLiBQYXJ0cyBzdGF5XHJcbiAgICAgICAgICAgIC8vIGNvbnNlY3V0aXZlLCBzbyBwZXItbGF5ZXIgdmVydGV4Q291bnRzIHN0aWxsIGFsaWduIGZvciBHUFUgdGltZS5cclxuICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBwYXJ0cykge1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHsgdHlwZTogXCJQb2x5Z29uXCIsIGNvb3JkaW5hdGVzOiByaW5ncyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5maWxsT3BhY2l0eSB8fCAwLjIgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAgICAgY29uc3QgZ2VvanNvbiA9IHtcclxuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxyXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG5cclxuICAgICAgICAgICAgICAgIGNvbnN0IHNoYXBlT3B0aW9ucyA9IHZlY3RvclRpbWVcclxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5nbFNoYXBlcyA9IEwuZ2xpZnkuc2hhcGVzKHtcclxuICAgICAgICAgICAgICAgICAgICAuLi5zaGFwZU9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5Z29uc1BhbmVcIixcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFmZWF0dXJlIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMgfHwgIWZlYXR1cmUucHJvcGVydGllcy5sYXllclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8ICF2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMywgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdHRlbiBiYXJlOiBzaGlueXdpZGdldHMnIG1vZGVsIGhhcyBubyBgY29tbWBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBUaGUgc2lkZWJhciBhbHdheXMgd3JvdGUgYmFyZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB3YXMgdGhlIG9uZSBwYXRoIHRoYXQgd29ya2VkIHRoZXJlLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV2hlcmUgdGhlIGNsaWNrIGxhbmRlZCwgZmVhdHVyZSBvciBub3Q6IG9uZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0cmFpdCBhbHdheXMgYW5zd2VycyBcIndoZXJlXCIsIGNsaWNrZWRfbGF5ZXJfaWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5zd2VycyBcIm9uIHdoYXRcIiAoXCJcIiBmb3Igb3BlbiBtYXApLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW01hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxhdCAqIDFlNSkgLyAxZTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBCdW1wZWQgb24gRVZFUlkgY2xpY2s6IGNsaWNraW5nIHRoZSBzYW1lIGZlYXR1cmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHdpY2UgY2hhbmdlcyBuZWl0aGVyIGlkIG5vciBpbmRleCwgc28gd2l0aG91dFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIG5vIHRyYWl0IGZpcmVzIGFuZCBoYW5kbGVycyBtaXNzIHRoZSBjbGljay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XHJcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcclxuXHJcbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xyXG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcclxuICAgIC8vIGNpcmNsZSBiZWNhdXNlIHRoZSBnbHlwaCBpcyBkcmF3biBpbnNpZGUgdGhlIHBvaW50J3Mgb3duIHF1YWQgYnkgdGhlIHNoYWRlci5cclxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XHJcblxyXG4gICAgLy8gR1BVIHRpbWUgcGF0aDogd2hlbiB0aGlzIGJ1Y2tldCBob2xkcyB0aW1lIGxheWVycywgZXZlcnkgcG9pbnQgaXMgZmVkIHRvIGdsaWZ5IGFuZFxyXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXHJcbiAgICAvLyB2ZXJ0ZXggc2hhZGVyLCBzbyBhIHRpY2sgY29zdHMgdHdvIHVuaWZvcm1zIGluc3RlYWQgb2YgcmVidWlsZGluZyA1TSBwb2ludHMgaW4gSlMuXHJcbiAgICAvLyBUaGUgQ1BVIGZpbHRlciBiZWxvdyBzdGF5cyBhcyB0aGUgZmFsbGJhY2sgd2hlbiB0aGUgR0wgd2lyaW5nIGlzIHVuYXZhaWxhYmxlLlxyXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcclxuICAgICAgICA/IGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCBncHVUaW1lID0gQm9vbGVhbihncHVBdHRycy5oYXNUaW1lKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyU2l6ZSA9IGxheWVyLnJhZGl1cyAhPSBudWxsID8gTnVtYmVyKGxheWVyLnJhZGl1cykgOiBkZWZhdWx0U2l6ZTtcclxuXHJcbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XHJcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCLFxyXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxyXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVPZmZzZXQsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGNvb3Jkcy5sZW5ndGggLyAyO1xyXG5cclxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XHJcbiAgICAgICAgLy8gU2VsZWN0aW9uIHN0eWxpbmcsIGFwcGxpZWQgb3ZlciB0aGUgbGF5ZXIncyBvd24gYW5kIGl0cyBkYXRhLWRyaXZlbiBzdHlsZXMuXHJcbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cclxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcclxuICAgICAgICBjb25zdCBvdmVycmlkZXMgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgfHwgbnVsbDtcclxuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxyXG4gICAgICAgIC8vIHU4IFJHQkEgdW5kZXIgXCI8aWQ+Ojpjb2xvcnNcIiwgZjMyIHBpeGVscyB1bmRlciBcIjxpZD46OnJhZGlpXCIgLS0gY29tcHV0ZWRcclxuICAgICAgICAvLyBpbiBQeXRob24gZnJvbSBjb2xvcl9jb2wvcmFkaXVzX2NvbC4gQnVmZmVycywgbmV2ZXIgcGVyLWZlYXR1cmUgc3R5bGVcclxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxyXG4gICAgICAgIC8vIHBheWxvYWQgdGhhdCB1c2VkIHRvIGtpbGwgc2Vzc2lvbnMuIEV4cGxpY2l0IHN0eWxlcyBzdGlsbCBvdXRyYW5rIHRoZW0uXHJcbiAgICAgICAgY29uc3QgY29sb3JzUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojpjb2xvcnNgXTtcclxuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcclxuICAgICAgICAgICAgPyBuZXcgVWludDhBcnJheShjb2xvcnNSYXcuYnVmZmVyIHx8IGNvbG9yc1JhdywgY29sb3JzUmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcnNSYXcuYnl0ZUxlbmd0aClcclxuICAgICAgICAgICAgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IHJhZGlpUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9OjpyYWRpaWBdO1xyXG4gICAgICAgIGNvbnN0IGJ1ZlJhZGlpID0gcmFkaWlSYXdcclxuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmFkaWlSYXcuYnl0ZUxlbmd0aCAvIDQpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxyXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcclxuICAgICAgICAvLyBvbiB0aGUgc3Vydml2b3JzIGtlZXAgcG9pbnRpbmcgYXQgdGhlIHJpZ2h0IHJvd3MuXHJcbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGZyb21EYXRhID0gcGVyRmVhdHVyZSA/IHBlckZlYXR1cmVbaV0gOiBudWxsO1xyXG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxyXG4gICAgICAgICAgICAgICAgfHwgKGhpZ2hsaWdodCAmJiBoaWdobGlnaHQuY29sb3IpXHJcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xyXG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LnJhZGl1cyAhPSBudWxsID8gaGlnaGxpZ2h0LnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xyXG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxyXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZkNvbG9ycyA/IHsgcjogYnVmQ29sb3JzW2kgKiA0XSAvIDI1NSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZzogYnVmQ29sb3JzW2kgKiA0ICsgMV0gLyAyNTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhOiBidWZDb2xvcnNbaSAqIDQgKyAzXSAvIDI1NSB9XHJcbiAgICAgICAgICAgICAgICAgICAgOiBjb2xvclJHQixcclxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZlJhZGlpID8gYnVmUmFkaWlbaV1cclxuICAgICAgICAgICAgICAgICAgICA6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXHJcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcclxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcclxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cclxuICAgICAgICAgICAgICAgIHNpemU6IChpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyA/IGluZm8uY29sb3JSR0IgOiB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc2Vuc2l0aXZpdHk6IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjAgOiA4LFxyXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlZCBCRUZPUkUgY29tcGV0aW5nIGZvciB0aGUgY2xpY2s6IGEgaGlkZGVuIG9yXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gb3V0LW9mLXdpbmRvdyBwb2ludCBtdXN0IG5vdCBlbnRlciB0aGUgYXJiaXRyYXRpb24gYXQgYWxsLCBzb1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoYXRldmVyIHNpdHMgYmVuZWF0aCBpdCAtLSBhIHZpc2libGUgZmVhdHVyZSwgb3IgdGhlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZW1wdHktbWFwIGZhbGxiYWNrIC0tIHdpbnMgaW5zdGVhZC5cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZUluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXByZUluZm8gfHwgIXZpc2libGVOb3cocHJlSW5mby5sYXllciwgcHJlSW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHByZUluZm87XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBUaGUgY2xpY2tlZCBwb2ludCdzIG93biBjb29yZGluYXRlcyAtLSBtb3JlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJ1dGhmdWwgdGhhbiB0aGUgbW91c2UgcG9zaXRpb24gZm9yIGEgcG9pbnQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIiwgW3BvaW50WzBdLCBwb2ludFsxXV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEJ1bXBlZCBvbiBFVkVSWSBjbGljazsgc2VlIHRoZSB2ZWN0b3IgY2xpY2sgaGFuZGxlcnMuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwb2ludCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBob3ZlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWluZm8gfHwgIXZpc2libGVOb3coaW5mby5sYXllciwgaW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLmZyYWdtZW50U2hhZGVyU291cmNlID0gKCkgPT4gcGluU2hhZGVyO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLnZlcnRleFNoYWRlclNvdXJjZSA9ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLmdsUG9pbnRzID0gTC5nbGlmeS5wb2ludHMoZ2xpZnlPcHRpb25zKTtcclxuICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFBvaW50cyk7XHJcbiAgICAgICAgICAgIGlmIChncHVUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBOdWxsIG9uIGZhaWx1cmUsIHdoaWNoIGFsc28gZmxpcHMgdGhlIGdsb2JhbCBmbGFnOiB0aGUgbmV4dCBzeW5jJ3NcclxuICAgICAgICAgICAgICAgIC8vIHJlYnVpbGQga2V5IGNoYW5nZXMgd2l0aCBpdCBhbmQgdGhlIENQVSBwYXRoIHRha2VzIG92ZXIuXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9JbnN0YW5jZSh0aGlzLmdsUG9pbnRzLCBncHVBdHRycyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5nbFBvaW50cykgdGhpcy5nbFBvaW50cy5yZW1vdmUoKTtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhbnZhcyA9IG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xyXG4gICAgICAgICAgICBpZiAoY2FudmFzKSBjYW52YXMuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xyXG4gICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XHJcbiAgICByZXR1cm4gaW5zdGFuY2U7XHJcbn1cclxuIiwgIi8vIFBlcm1hbmVudCBmZWF0dXJlIGxhYmVsczogdGV4dCBwaW5uZWQgdG8gdGhlIG1hcCwgZnJvbSBhIGxheWVyJ3MgYGxhYmVsYCAob25lXHJcbi8vIHZlY3RvciBmZWF0dXJlKSBvciBgbGFiZWxzYCAob25lIHBlciBwb2ludCwgYWxpZ25lZCB3aXRoIHRoZSBjb29yZGluYXRlIGJ1ZmZlcikuXHJcbi8vIERPTSBlbGVtZW50cyBieSBkZXNpZ24gLS0gTGVhZmxldCBwZXJtYW5lbnQgdG9vbHRpcHMgLS0gd2hpY2ggaXMgd2h5IHRoZXkgYXJlIGZvclxyXG4vLyBzaXRlLXNjYWxlIGxheWVyczsgUHl0aG9uIHdhcm5zIHBhc3QgYSB0aG91c2FuZC4gTW9kZWwtZnJlZSBsaWtlIHRoZSBsZWdlbmQ6IHB1cmVcclxuLy8gZGF0YSBpbiwgTGVhZmxldCBsYXllcnMgb3V0LCByZS1kZXJpdmVkIGVhY2ggc3luYyBzbyBsYWJlbHMgZm9sbG93IHZpc2liaWxpdHlcclxuLy8gd2l0aG91dCB0b3VjaGluZyB0aGUgR0wgYnVja2V0cyBvciB0aGVpciBtZXRhIGtleXMuXHJcblxyXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSB9IGZyb20gXCIuL21hcC5qc1wiO1xyXG5pbXBvcnQgeyB2ZWN0b3JDb29yZHMsIGxpbmVQYXJ0cyB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xyXG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFdoZXRoZXIgYSB3aG9sZSBsYWJlbGxlZCBmZWF0dXJlIGlzIGluc2lkZSB0aGUgY3VycmVudCB0aW1lIHdpbmRvdy4gTmFOIHRpbWVzXHJcbi8vIGtlZXAgdGhlIGxhYmVsLCBtYXRjaGluZyB0aGUgbWFwOiBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YSwgc28gaXRcclxuLy8gbXVzdCBuZXZlciBoaWRlIHRoZSBkYXRhJ3MgbGFiZWwgZWl0aGVyLiBBIG11bHRpLXNwYW4gbGluZSBjb3VudHMgYXMgdmlzaWJsZVxyXG4vLyB3aGlsZSBBTlkgb2YgaXRzIHNlZ21lbnRzIGlzIC0tIHRoZSBsYWJlbCBmb2xsb3dzIHRoZSBsYXllciwgbm90IG9uZSBsZWcuXHJcbmZ1bmN0aW9uIHRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghdGltZVN0YXRlIHx8ICFsYXllci50aW1lKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIHJldHVybiB0cnVlO1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIE9uZSBhbmNob3IgcGVyIGxhYmVsbGVkIGZlYXR1cmUuIFBvaW50cyBsYWJlbCBhdCB0aGUgcG9pbnQ7IGEgbGluZSBsYWJlbHMgYXQgaXRzXHJcbi8vIG1pZGRsZSB2ZXJ0ZXggKG9uIHRoZSBsaW5lLCBub3QgZmxvYXRpbmcgaW4gaXRzIGJvdW5kaW5nIGJveCk7IGEgcG9seWdvbiBvclxyXG4vLyBjaXJjbGUgbGFiZWxzIGF0IGl0cyBib3VuZHMgY2VudHJlLiBXaXRoIGEgdGltZVN0YXRlLCBsYWJlbHMgZm9sbG93IHRoZSB3aW5kb3c6XHJcbi8vIHBvaW50cyBkcm9wIHBlciBwb2ludCwgdmVjdG9ycyBhcyBhIHdob2xlLlxyXG4vLyBEZWdyZWUtc3BhY2UgbGVuZ3RoIG9mIGEgW2xhdCwgbG5nXSBydW4gLS0gb25seSBldmVyIGNvbXBhcmVkIGFnYWluc3QgYW5vdGhlclxyXG4vLyBwYXJ0IG9mIHRoZSBzYW1lIGxpbmUsIHNvIG5vIHByb2plY3Rpb24gaXMgbmVlZGVkIHRvIHBpY2sgdGhlIGxvbmdlciBvbmUuXHJcbmZ1bmN0aW9uIHBsYW5hckxlbmd0aChwYXJ0KSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBwYXJ0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZExhdCA9IHBhcnRbaV1bMF0gLSBwYXJ0W2kgLSAxXVswXTtcclxuICAgICAgICBjb25zdCBkTG5nID0gcGFydFtpXVsxXSAtIHBhcnRbaSAtIDFdWzFdO1xyXG4gICAgICAgIHRvdGFsICs9IE1hdGguc3FydChkTGF0ICogZExhdCArIGRMbmcgKiBkTG5nKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0b3RhbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IG91dCA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSBjb250aW51ZTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLmNvbGxlY3RMYWJlbHMobGF5ZXIubGF5ZXJzIHx8IFtdLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSkpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobGF5ZXIubGFiZWxzKSkge1xyXG4gICAgICAgICAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICBpZiAoIXJhdykgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgICAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihsYXllci5sYWJlbHMubGVuZ3RoLCBjb29yZHMubGVuZ3RoIC8gMik7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllci5sYWJlbHNbaV0pIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbaSAqIDJdKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGNvb3Jkc1tpICogMl0sIGxuZzogY29vcmRzW2kgKiAyICsgMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbHNbaV0pLCBjZW50ZXI6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChsYXllci5sYWJlbCkge1xyXG4gICAgICAgICAgICBpZiAoIXRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgICAgICAgICAgLy8gQW5jaG9yIE9OIGEgcGFydCAtLSB0aGUgbWlkZGxlIHZlcnRleCBvZiB0aGUgbG9uZ2VzdCBwYXJ0LiBUaGVcclxuICAgICAgICAgICAgICAgIC8vIG1pZGRsZSBvZiBhIG11bHRpLXBhcnQgbGluZSdzIHdob2xlIHZlcnRleCBydW4gY2FuIHNpdCBpbiB0aGUgZ2FwXHJcbiAgICAgICAgICAgICAgICAvLyBiZXR3ZWVuIHBhcnRzLCB3aGVyZSB0aGVyZSBpcyBub3RoaW5nIHRvIGxhYmVsLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFydHMgPSBsaW5lUGFydHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb25nZXN0ID0gcGFydHMucmVkdWNlKChiZXN0LCBwYXJ0KSA9PlxyXG4gICAgICAgICAgICAgICAgICAgIHBsYW5hckxlbmd0aChwYXJ0KSA+IHBsYW5hckxlbmd0aChiZXN0KSA/IHBhcnQgOiBiZXN0LCBwYXJ0c1swXSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtaWQgPSBsb25nZXN0W01hdGguZmxvb3IoKGxvbmdlc3QubGVuZ3RoIC0gMSkgLyAyKV07XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbWlkWzBdLCBsbmc6IG1pZFsxXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5ib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtbYUxhdCwgYUxvbl0sIFtiTGF0LCBiTG9uXV0gPSBsYXllci5ib3VuZHM7XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKGFMYXQgKyBiTGF0KSAvIDIsIGxuZzogKGFMb24gKyBiTG9uKSAvIDIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5sb2NhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGxheWVyLmxvY2F0aW9uWzBdLCBsbmc6IGxheWVyLmxvY2F0aW9uWzFdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBObyBib3VuZHMgb24gdGhlIGNvbmZpZyAtLSB0aGUgY29sbGVjdGlvbiBtZXJnZSBkcm9wcGVkIHRoZW0gZm9yXHJcbiAgICAgICAgICAgICAgICAvLyBpdHMgd2hvbGUgaGlzdG9yeSwgYW5kIGhhbmQtYnVpbHQgY29uZmlncyBtYXkgbmV2ZXIgY2FycnkgdGhlbS5cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBjb29yZGluYXRlcyBhcmUgc3RpbGwgaW4gdGhlIGJ1ZmZlciB1bmRlciB0aGUgbGF5ZXIncyBvd24gaWQsXHJcbiAgICAgICAgICAgICAgICAvLyBleGFjdGx5IGFzIHRoZSBwb2x5bGluZSBicmFuY2ggcmVhZHMgdGhlbTsgYSBtaXNzaW5nIGJveCBtdXN0XHJcbiAgICAgICAgICAgICAgICAvLyBkZWdyYWRlIHRvIGNvbXB1dGluZyBvbmUsIG5ldmVyIHRvIHNpbGVudGx5IGRyb3BwaW5nIHRoZSBsYWJlbC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvY3MubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICAgICAgbGV0IG1pbkxuZyA9IEluZmluaXR5LCBtYXhMbmcgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtsYXQsIGxuZ10gb2YgbG9jcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA8IG1pbkxuZykgbWluTG5nID0gbG5nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsbmcgPiBtYXhMbmcpIG1heExuZyA9IGxuZztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAobWluTGF0ICsgbWF4TGF0KSAvIDIsIGxuZzogKG1pbkxuZyArIG1heExuZykgLyAyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBSZWJ1aWxkcyBgZ3JvdXBgIChhbiBMLmxheWVyR3JvdXApIHRvIGhvbGQgZXhhY3RseSB0aGUgY3VycmVudCBsYWJlbHMsIHNraXBwaW5nXHJcbi8vIHRoZSB3b3JrIHdoZW4gbm90aGluZyBjaGFuZ2VkIC0tIHN5bmNzIHJ1biBvbiBldmVyeSB0b2dnbGUgYW5kIHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMYWJlbHMoTCwgZ3JvdXAsIGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBsYWJlbHMgPSBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUpO1xyXG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkobGFiZWxzKTtcclxuICAgIGlmIChncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9PT0ga2V5KSByZXR1cm47XHJcbiAgICBncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9IGtleTtcclxuICAgIGdyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbGFiZWxzKSB7XHJcbiAgICAgICAgLy8gQ29udGVudCBhcyBhbiBlbGVtZW50IHdpdGggdGV4dENvbnRlbnQ6IHRvb2x0aXAgc3RyaW5nIGNvbnRlbnQgaXMgSFRNTCxcclxuICAgICAgICAvLyBhbmQgbGFiZWxzIGNvbWUgZnJvbSB1c2VyIGRhdGEsIHdoaWNoIG11c3QgbmV2ZXIgcGFyc2UgYXMgbWFya3VwLlxyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gaXRlbS50ZXh0O1xyXG4gICAgICAgIGNvbnN0IHRvb2x0aXAgPSBMLnRvb2x0aXAoe1xyXG4gICAgICAgICAgICBwZXJtYW5lbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGRpcmVjdGlvbjogaXRlbS5jZW50ZXIgPyBcImNlbnRlclwiIDogXCJ0b3BcIixcclxuICAgICAgICAgICAgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWZlYXR1cmUtbGFiZWxcIixcclxuICAgICAgICAgICAgb2Zmc2V0OiBpdGVtLmNlbnRlciA/IFswLCAwXSA6IFswLCAtNl0sXHJcbiAgICAgICAgfSkuc2V0TGF0TG5nKFtpdGVtLmxhdCwgaXRlbS5sbmddKS5zZXRDb250ZW50KHNwYW4pO1xyXG4gICAgICAgIGdyb3VwLmFkZExheWVyKHRvb2x0aXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkQ1NTLCBsb2FkSlMgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyU2lkZWJhckNvbnRyb2xzLCBub3JtYWxpemVSYWRpb0xheWVycywgc2VuZExheWVyV3JpdGUgfSBmcm9tIFwiLi9zaWRlYmFyLmpzXCI7XG5pbXBvcnQgeyBkZXJpdmVMZWdlbmRTcGVjLCByZW5kZXJMZWdlbmQgfSBmcm9tIFwiLi9sZWdlbmQuanNcIjtcbmltcG9ydCB7IHJlbmRlckxhYmVscyB9IGZyb20gXCIuL2xhYmVscy5qc1wiO1xuaW1wb3J0IHsgcmVuZGVyTGF5ZXIsIHJlbmRlck1lcmdlZEdsTGF5ZXIsIHJlZ2lzdGVyQ2xpY2tNYXRjaCwgaW1hZ2VNZXRhS2V5IH0gZnJvbSBcIi4vbGF5ZXJzLmpzXCI7XG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgZ2VuZXJhdGVUaWNrcywgY29sbGVjdFRpbWVFeHRlbnQsIGhhc1RpbWVMYXllcnMsXG4gICAgICAgICBsYXllckluV2luZG93LCByZW5kZXJUaW1lQ29udHJvbCwgYWR2YW5jZSwgcGVyaW9kVG9NcywgZ2NkR3JpZE1zLFxuICAgICAgICAgY29sbGVjdER1cmF0aW9uc01zLCBQT1NJVElPTlMsIHRpbWVzRm9yLCB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdyxcbiAgICAgICAgIGVmZmVjdGl2ZUR1cmF0aW9uIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcbmltcG9ydCB7IGdwdVRpbWVBdmFpbGFibGUsIHZlY3RvckdwdUF2YWlsYWJsZSwgTEFZRVJfU0xPVFMgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XG5cbi8vIFRydWUgaWYgYSBsYXllciBpcyB2aXNpYmxlIGFuZCBubyBmb2xkZXIgYWJvdmUgaXQgaXMgc3dpdGNoZWQgb2ZmLlxuLy9cbi8vIFZpc2liaWxpdHkgaXMgaW5oZXJpdGVkIGRvd24gdGhlIGZvbGRlciBwYXRoOiBhIGxheWVyIGluc2lkZSBcIkZlZWRzL0FjdGl2ZVwiIGlzIGhpZGRlblxuLy8gd2hlbiBlaXRoZXIgXCJGZWVkc1wiIG9yIFwiRmVlZHMvQWN0aXZlXCIgaXMgb2ZmLCByZWdhcmRsZXNzIG9mIGl0cyBvd24gZmxhZy4gR2V0dGluZyB0aGlzXG4vLyB3cm9uZyBzaG93cyB1cCBhcyBcInRoYXQgbGF5ZXIganVzdCB3aWxsIG5vdCBhcHBlYXJcIiwgd2l0aCBub3RoaW5nIGxvZ2dlZC5cbmV4cG9ydCBmdW5jdGlvbiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLnNwbGl0KFwiL1wiKSkge1xuICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZ3JvdXBDb25maWdzW3J1bm5pbmdQYXRoXTtcbiAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFNvcnRzIHRoZSB2aXNpYmxlIGxheWVycyBpbnRvIG9uZSBidWNrZXQgcGVyIFdlYkdMIGRyYXcgcGFzcy5cbi8vXG4vLyBTdWItbGF5ZXJzIG9mIGEgbWVyZ2VkIGdyb3VwIGluaGVyaXQgdGhlaXIgcGFyZW50J3MgdmlzaWJpbGl0eSByYXRoZXIgdGhhbiBjYXJyeWluZ1xuLy8gdGhlaXIgb3duLCBzbyBhIGdyb3VwIHRvZ2dsZWQgb2ZmIGNvbnRyaWJ1dGVzIG5vdGhpbmcgZXZlbiB3aGVuIGl0cyBjaGlsZHJlbiBzYXlcbi8vIHZpc2libGUuIENpcmNsZXMgam9pbiB0aGUgcG9seWdvbiBidWNrZXQ6IHRoZXkgYXJlIGRyYXduIGFzIGdlbmVyYXRlZCByaW5ncy5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcbiAgICBjb25zdCBidWNrZXRzID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG5cbiAgICBmdW5jdGlvbiBjb2xsZWN0KGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1YkxheWVyKSB7XG4gICAgICAgIGlmICghcGFyZW50VmlzaWJsZSkgcmV0dXJuO1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IGNvbGxlY3Qoc3ViLCBwYXJlbnRWaXNpYmxlLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFpc1N1YkxheWVyICYmIGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKGJ1Y2tldHNbYnVja2V0XSkgYnVja2V0c1tidWNrZXRdLnB1c2gobGF5ZXIpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgIGNvbGxlY3QobGF5ZXIsIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpLCBmYWxzZSk7XG4gICAgfVxuICAgIHJldHVybiBidWNrZXRzO1xufVxuXG4vLyBBcHBsaWVzIGluY3JlbWVudGFsIHBhdGNoIG9wcyB0byB7bGF5ZXJzLCBidWZmZXJzfSwgcmV0dXJuaW5nIHRoZSBuZXcgc3RhdGUuXG4vL1xuLy8gT3BzIGFyZSBhZGRyZXNzZWQgYnkgbGF5ZXIgaWQgYW5kIGFwcGxpZWQgaWRlbXBvdGVudGx5OiBcImFkZFwiIHVwc2VydHMgcmF0aGVyIHRoYW5cbi8vIGFwcGVuZGluZyBibGluZGx5LCBzbyBhIHBhdGNoIHRoYXQgcmFjZXMgdGhlIGluaXRpYWwgdHJhaXQgc25hcHNob3QgY2Fubm90IGR1cGxpY2F0ZVxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxuLy8gQXBwbGllcyBgdXBkYXRlYCB0byBvbmUgbGF5ZXIgd2hlcmV2ZXIgaXQgc2l0cywgZGVzY2VuZGluZyBpbnRvIGdyb3Vwcy4gYWRkX2NvbGxlY3Rpb25cbi8vIG5lc3RzIGl0cyBwb2ludCwgbGluZSBhbmQgcG9seWdvbiBsYXllcnMgaW5zaWRlIGEgZ3JvdXAgbGF5ZXIsIHNvIGFuIG9wIGFkZHJlc3NlZCBhdCBhXG4vLyBuZXN0ZWQgaWQgd291bGQgb3RoZXJ3aXNlIG1hdGNoIG5vdGhpbmcgYW5kIHNpbGVudGx5IGRvIG5vdGhpbmcuIFJldHVybnMgdGhlIG9yaWdpbmFsXG4vLyBhcnJheSB1bnRvdWNoZWQgd2hlbiB0aGUgaWQgaXMgbm90IGZvdW5kLCBzbyBhbiB1bm1hdGNoZWQgb3AgY29zdHMgbm8gcmUtcmVuZGVyLlxuZnVuY3Rpb24gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgaWQsIHVwZGF0ZSkge1xuICAgIGxldCBoaXQgPSBmYWxzZTtcbiAgICBjb25zdCBuZXh0ID0gbGF5ZXJzLm1hcChsID0+IHtcbiAgICAgICAgaWYgKGwuaWQgPT09IGlkKSB7XG4gICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIHVwZGF0ZShsKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgQXJyYXkuaXNBcnJheShsLmxheWVycykpIHtcbiAgICAgICAgICAgIGNvbnN0IHN1YnMgPSB1cGRhdGVMYXllckJ5SWQobC5sYXllcnMsIGlkLCB1cGRhdGUpO1xuICAgICAgICAgICAgaWYgKHN1YnMgIT09IGwubGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5sLCBsYXllcnM6IHN1YnMgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbDtcbiAgICB9KTtcbiAgICByZXR1cm4gaGl0ID8gbmV4dCA6IGxheWVycztcbn1cblxuLy8gRXZlcnkgcG9pbnQgbGF5ZXIsIHZpc2libGUgb3Igbm90LCB3aXRoIGl0cyBlZmZlY3RpdmUgdmlzaWJpbGl0eSByZWNvcmRlZCAtLSB0aGVcbi8vIEdQVS12aXNpYmlsaXR5IHBhdGgga2VlcHMgaGlkZGVuIGxheWVycyBpbiB0aGUgYnVja2V0IChzdGFibGUgaWRzLCBubyByZWJ1aWxkIG9uIGFcbi8vIHRvZ2dsZSkgYW5kIGhpZGVzIHRoZW0gd2l0aCBhIHVuaWZvcm0gaW5zdGVhZC4gTWlycm9ycyBjb2xsZWN0V2ViZ2xMYXllcnMnIHJ1bGVzOlxuLy8gc3ViLWxheWVycyBpbmhlcml0IHRoZWlyIHBhcmVudCdzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5LCB0b3AtbGV2ZWwgbGF5ZXJzIGFuc3dlciBmb3Jcbi8vIHRoZWlyIG93biBmbGFnIGFuZCB0aGVpciBmb2xkZXIgY2hhaW4uXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3Qgb3V0ID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG4gICAgZnVuY3Rpb24gd2FsayhsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWIpIHtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlbGZWaXMgPSBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IHdhbGsoc3ViLCBzZWxmVmlzLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKCFvdXRbYnVja2V0XSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2aXMgPSBpc1N1YiA/IHBhcmVudFZpc2libGVcbiAgICAgICAgICAgIDogcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgb3V0W2J1Y2tldF0ucHVzaCh7IGxheWVyLCB2aXMgfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB3YWxrKGxheWVyLCB0cnVlLCBmYWxzZSk7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3dpZnRtYXBQYXRjaChzdGF0ZSwgb3BzLCBidWZmZXJzKSB7XG4gICAgbGV0IGxheWVycyA9IHN0YXRlLmxheWVycyB8fCBbXTtcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcblxuICAgIGZvciAoY29uc3Qgb3Agb2Ygb3BzKSB7XG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBvcC5sYXllcnMgfHwgW107XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7fTtcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJzICYmIGJ1ZmZlcnNbaV0pIGJ1ZmZlck1hcFtpZF0gPSBidWZmZXJzW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICAgICAgICBjb25zdCBpbmNvbWluZyA9IG9wLmxheWVyO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBpbmNvbWluZyA/IGluY29taW5nLmlkIDogb3AuaWQ7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBbLi4ubGF5ZXJzLCBpbmNvbWluZ107XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5tYXAoKGwsIGkpID0+IChpID09PSBpZHggPyBpbmNvbWluZyA6IGwpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzZXRcIikge1xuICAgICAgICAgICAgLy8gRmllbGQtbGV2ZWwgdXBkYXRlLiBcInJlcGxhY2VcIiBjYXJyaWVzIHRoZSB3aG9sZSBsYXllciwgc28gZmxpcHBpbmcgYHZpc2libGVgXG4gICAgICAgICAgICAvLyBvbiBhIDUway1wb2ludCBsYXllciByZXNlbnQgZXZlcnkgcHJvcGVydHkgaXQgaG9sZHMgLS0gaGFsZiBhIG1lZ2FieXRlIHRvXG4gICAgICAgICAgICAvLyBjaGFuZ2Ugb25lIGJvb2xlYW4sIG9uIGV2ZXJ5IGNsaWNrIG9mIGEgY2hlY2tib3guXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoeyAuLi5sLCAuLi4ob3AuZmllbGRzIHx8IHt9KSB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic3R5bGVcIikge1xuICAgICAgICAgICAgLy8gUGVyLWZlYXR1cmUgc3R5bGUgb3ZlcnJpZGVzLCByZXBsYWNlZCB3aG9sZXNhbGUgcmF0aGVyIHRoYW4gbWVyZ2VkOiBhXG4gICAgICAgICAgICAvLyBzZWxlY3Rpb24gZGVzY3JpYmVzIGl0cyBjb21wbGV0ZSBzdGF0ZSwgc28gc2VuZGluZyB7fSBjbGVhcnMgaXQgYW5kIG5vXG4gICAgICAgICAgICAvLyBjYWxsZXIgaGFzIHRvIHRyYWNrIHdoYXQgdGhlIHByZXZpb3VzIGhpZ2hsaWdodCB0b3VjaGVkLlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5sLCBzdHlsZV9vdmVycmlkZXM6IG9wLm92ZXJyaWRlcyB8fCB7fSxcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLmZpbHRlcihsID0+IGwuaWQgIT09IG9wLmlkKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJcIikge1xuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XG4gICAgICAgICAgICBpZiAoYnVmKSBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogYnVmIH07XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX3JlbW92ZVwiKSB7XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xuICAgICAgICAgICAgZGVsZXRlIGJ1ZmZlck1hcFtvcC5pZF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBsYXllcnMsIGJ1ZmZlcnM6IGJ1ZmZlck1hcCB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxFcnJvciA9IGNvbnNvbGUuZXJyb3I7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcblxuICAgICAgICAvLyBqc19jb25zb2xlX2xvZ3MgaXMgYSBzeW5jZWQgbGlzdCwgc28gZWFjaCBhcHBlbmQgcmVzZW5kcyB0aGUgd2hvbGUgYXJyYXkuIEtlZXBpbmdcbiAgICAgICAgLy8gb25seSB0aGUgbW9zdCByZWNlbnQgZW50cmllcyBib3VuZHMgYm90aCB0aGUgcGF5bG9hZCBhbmQgdGhlIG1lbW9yeSBhIGxvbmctbGl2ZWRcbiAgICAgICAgLy8gc2Vzc2lvbiBhY2N1bXVsYXRlczsgdGhlIG5ld2VzdCBhcmUgdGhlIG9uZXMgd29ydGggaGF2aW5nIGFueXdheS5cbiAgICAgICAgY29uc3QgTUFYX0NPTlNPTEVfTE9HUyA9IDIwMDtcbiAgICAgICAgY29uc3QgYXBwZW5kTG9nID0gZW50cnkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbG9ncyA9IG1vZGVsLmdldChcImpzX2NvbnNvbGVfbG9nc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBbLi4ubG9ncywgZW50cnldO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQubGVuZ3RoID4gTUFYX0NPTlNPTEVfTE9HUyA/IG5leHQuc2xpY2UoLU1BWF9DT05TT0xFX0xPR1MpIDogbmV4dDtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBIZWxwZXIgdG8gc2FmZWx5IHdyaXRlIGJhY2sgdG8gUHl0aG9uIG9ubHkgaWYgdGhlIHdpZGdldCB2aWV3IGlzIGFjdGl2ZSBhbmQgYXR0YWNoZWRcbiAgICAgICAgZnVuY3Rpb24gc2FmZVNldEFuZFNhdmUoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcbiAgICAgICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyBzYXZlIGVycm9yOlwiLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yID0gZnVuY3Rpb24oLi4uYXJncykge1xuICAgICAgICAgICAgb3JpZ2luYWxFcnJvci5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpKTtcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xuICAgICAgICBjb25zb2xlLndhcm4gPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XG4gICAgICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xuICAgICAgICAgICAgICAgIGlmICghbG9nZ2VkUmVwcm9qZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBtb2RlbC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xlYW5Nc2cgPSBgW1N3aWZ0TWFwXSBMYXllciB3YXMgcmVwcm9qZWN0ZWQgdG8gXCIke2Nyc31cImA7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIGFwcGVuZExvZyhjbGVhbk1zZykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvcmlnaW5hbFdhcm4uYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgd2luZG93Lm9uZXJyb3IgPSBmdW5jdGlvbihtZXNzYWdlLCBzb3VyY2UsIGxpbmVubywgY29sbm8sIGVycm9yKSB7XG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxuICAgICAgICAgICAgICAgIGFwcGVuZExvZyhgV0lORE9XLk9ORVJST1I6ICR7bWVzc2FnZX0gYXQgJHtzb3VyY2V9OiR7bGluZW5vfToke2NvbG5vfWApKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBMb2FkIENTUyBhbmQgTGVhZmxldCBsaWJyYXJpZXMgKGluY2x1ZGluZyBXZWJHTCBnbGlmeSlcbiAgICAgICAgbG9hZENTUyhcImxlYWZsZXQtY3NzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuY3NzXCIpO1xuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWpzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2xpZnlcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0LmdsaWZ5QDMuMy4wL2Rpc3QvZ2xpZnktYnJvd3Nlci5qc1wiKTtcbiAgICAgICAgLy8gR2VvbWFuIG11c3QgbG9hZCBCRUZPUkUgdGhlIG1hcCBpcyBjb25zdHJ1Y3RlZDogaXQgYXR0YWNoZXMgbWFwLnBtIHRocm91Z2hcbiAgICAgICAgLy8gYSBMZWFmbGV0IGluaXQgaG9vaywgd2hpY2ggb25seSBydW5zIGZvciBtYXBzIGNyZWF0ZWQgYWZ0ZXIgdGhlIHBsdWdpblxuICAgICAgICAvLyBleGlzdHMgLS0gbGF6eS1sb2FkaW5nIGl0IGxhdGVyIGxlYXZlcyBtYXAucG0gdW5kZWZpbmVkIGZvcmV2ZXIuXG4gICAgICAgIGxvYWRDU1MoXCJsZWFmbGV0LWdlb21hbi1jc3NcIixcbiAgICAgICAgICAgIFwiaHR0cHM6Ly91bnBrZy5jb20vQGdlb21hbi1pby9sZWFmbGV0LWdlb21hbi1mcmVlQDIuMTguMy9kaXN0L2xlYWZsZXQtZ2VvbWFuLmNzc1wiKTtcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1nZW9tYW5cIixcbiAgICAgICAgICAgIFwiaHR0cHM6Ly91bnBrZy5jb20vQGdlb21hbi1pby9sZWFmbGV0LWdlb21hbi1mcmVlQDIuMTguMy9kaXN0L2xlYWZsZXQtZ2VvbWFuLm1pbi5qc1wiKTtcblxuICAgICAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5wb3NpdGlvbiA9IFwicmVsYXRpdmVcIjtcbiAgICAgICAgZWwuYXBwZW5kQ2hpbGQoY29udGFpbmVyKTtcblxuICAgICAgICAvLyBNYXAoaGVpZ2h0PS4uLikgc2l6aW5nLiBBbiBleHBsaWNpdCBoZWlnaHQgYWxzbyBkcm9wcyB0aGUgc3R5bGVzaGVldCdzXG4gICAgICAgIC8vIDQwMHB4IGZsb29yIC0tIGFuIGV4cGxpY2l0IDIwMHB4IG11c3Qgbm90IGxvc2UgdG8gYSBkZWZhdWx0IG1pbmltdW0uXG4gICAgICAgIC8vIEhlaWdodCB3YXMgYWNjZXB0ZWQgYW5kIGRvY3VtZW50ZWQgbG9uZyBiZWZvcmUgaXQgcmVhY2hlZCB0aGUgRE9NOyB0aGlzXG4gICAgICAgIC8vIGlzIHdoZXJlIGl0IGZpbmFsbHkgZG9lcy5cbiAgICAgICAgZnVuY3Rpb24gYXBwbHlIZWlnaHQoKSB7XG4gICAgICAgICAgICBjb25zdCBoID0gbW9kZWwuZ2V0KFwiaGVpZ2h0XCIpO1xuICAgICAgICAgICAgY29udGFpbmVyLnN0eWxlLmhlaWdodCA9IGggfHwgXCIxMDAlXCI7XG4gICAgICAgICAgICBjb250YWluZXIuc3R5bGUubWluSGVpZ2h0ID0gaCA/IFwiMFwiIDogXCJcIjtcbiAgICAgICAgfVxuICAgICAgICBhcHBseUhlaWdodCgpO1xuXG4gICAgICAgIGxldCBsYWJlbHNHcm91cCA9IG51bGw7ICAgLy8gY3JlYXRlZCBhZnRlciB0aGUgbWFwOyBmaWxsZWQgYnkgZWFjaCBzeW5jXG5cbiAgICAgICAgY29uc3QgY3JzTmFtZSA9IG1vZGVsLmdldChcImNyc1wiKTtcbiAgICAgICAgbGV0IG1hcENycyA9IEwuQ1JTLkVQU0czODU3O1xuICAgICAgICBpZiAoY3JzTmFtZSA9PT0gXCJFUFNHOjQzMjZcIikge1xuICAgICAgICAgICAgbWFwQ3JzID0gTC5DUlMuRVBTRzQzMjY7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYXAgPSBMLm1hcChjb250YWluZXIsIHtcbiAgICAgICAgICAgIGNyczogbWFwQ3JzLFxuICAgICAgICAgICAgY2VudGVyOiBtb2RlbC5nZXQoXCJjZW50ZXJcIiksXG4gICAgICAgICAgICB6b29tOiBtb2RlbC5nZXQoXCJ6b29tXCIpLFxuICAgICAgICAgICAgc2Nyb2xsV2hlZWxab29tOiB0cnVlLFxuICAgICAgICAgICAgcHJlZmVyQ2FudmFzOiB0cnVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBjdXN0b20gcGFuZXMgZm9yIHN0cmljdCBaLWluZGV4IG9yZGVyaW5nXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWdvbnNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlnb25zUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQxMFwiO1xuICAgICAgICBcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5bGluZXNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlsaW5lc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MjBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9pbnRzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDMwXCI7XG5cbiAgICAgICAgLy8gRHJhd24gdmVjdG9ycyBsaXZlIEFCT1ZFIHRoZSBHTCBwYW5lcy4gR2VvbWFuIGRlZmF1bHRzIHRoZW0gaW50byBMZWFmbGV0J3NcbiAgICAgICAgLy8gb3ZlcmxheVBhbmUgKDQwMCksIHdoaWNoIHNpdHMgdW5kZXIgdGhlIEdMIGNhbnZhc2VzICg0MTAvNDIwLzQzMCkgd2hvc2VcbiAgICAgICAgLy8gcG9pbnRlci1ldmVudHMgYXJlIGZvcmNlZCBvbiAtLSBzbyB3aXRoIGFueSBHTCBsYXllciBwcmVzZW50LCBjbGlja3MgbWVhbnRcbiAgICAgICAgLy8gZm9yIGEgZHJhd24gc2hhcGUgbmV2ZXIgYXJyaXZlZDogZHJhd2luZyB3b3JrZWQgKEdlb21hbiBsaXN0ZW5zIG9uIHRoZVxuICAgICAgICAvLyBjb250YWluZXIpIHdoaWxlIHJlbW92YWwsIGVkaXQgYW5kIGRyYWcgc2lsZW50bHkgZGlkIG5vdGhpbmcuXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwic3dpZnRtYXBEcmF3UGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJzd2lmdG1hcERyYXdQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDQwXCI7XG5cbiAgICAgICAgbGFiZWxzR3JvdXAgPSBMLmxheWVyR3JvdXAoKS5hZGRUbyhtYXApO1xuXG4gICAgICAgIC8vIExvY2FsIG1pcnJvcnMgb2YgdGhlIGxheWVyIGxpc3QgYW5kIGNvb3JkaW5hdGUgYnVmZmVycy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gUHl0aG9uIHVwZGF0ZXMgdGhlc2UgaW5jcmVtZW50YWxseSB2aWEgXCJzd2lmdG1hcF9wYXRjaFwiIG1lc3NhZ2VzIGluc3RlYWQgb2ZcbiAgICAgICAgLy8gcmVhc3NpZ25pbmcgdGhlIHRyYWl0cywgYmVjYXVzZSBhIHRyYWl0IHJlYXNzaWdubWVudCByZS1zZXJpYWxpemVzIGFuZCByZS1zZW5kc1xuICAgICAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxuICAgICAgICAvLyB3aGVuIGEgdmlldyBhdHRhY2hlcywgYW5kIHRoZSBzaWRlYmFyIHN0aWxsIHdyaXRlcyBgbGF5ZXJzYCBiYWNrIG9uIHRvZ2dsZSwgc29cbiAgICAgICAgLy8gYm90aCBhcmUgc2VlZGVkIGhlcmUgYW5kIGtlcHQgaW4gc3RlcCBieSB0aGUgY2hhbmdlIGhhbmRsZXJzIGZ1cnRoZXIgZG93bi5cbiAgICAgICAgbGV0IGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcblxuICAgICAgICBmdW5jdGlvbiBhcHBseVBhdGNoT3BzKG9wcywgYnVmZmVycykge1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBuZXh0LmxheWVycztcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0gbmV4dC5idWZmZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTGl2ZSBmZWF0dXJlIHZpc2liaWxpdHksIGZvciBoaXQtdGVzdGluZy4gR1BVLXBhdGggYnVja2V0cyBrZWVwIEVWRVJZXG4gICAgICAgIC8vIGxheWVyIC0tIGhpZGRlbiBvbmVzIGFyZSBtYXNrZWQgYnkgYSBzaGFkZXIgdW5pZm9ybSAtLSBhbmQgZ2xpZnknc1xuICAgICAgICAvLyBoaXQtdGVzdHMgcnVuIGFnYWluc3QgdGhlIGJ1Y2tldCdzIGRhdGEsIHdoaWNoIGNhbm5vdCBzZWUgdW5pZm9ybXM6IGFcbiAgICAgICAgLy8gcmFkaW8taGlkZGVuIGxheWVyJ3MgZmVhdHVyZXMgc3RpbGwgd29uIGNsaWNrcyBhbmQgYW5zd2VyZWQgd2l0aCBwb3B1cHMuXG4gICAgICAgIC8vIExvb2tlZCB1cCBmcmVzaCBwZXIgZXZlbnQsIGJlY2F1c2UgdGhlIGNvbmZpZyBjYXB0dXJlZCBhdCBidWlsZCB0aW1lIGdvZXNcbiAgICAgICAgLy8gc3RhbGUgdGhlIG1vbWVudCBhIHBhdGNoIG9wIHJlcGxhY2VzIGl0OyB0aGUgdGltZSBjaGVjayByZWFkcyB0aGUgbGl2ZVxuICAgICAgICAvLyB0aWNrIHRoZSBzYW1lIHdheSwgc2luY2UgdGlja3MgY2hhbmdlIHdpdGhvdXQgcmVidWlsZGluZyB0aGUgYnVja2V0LlxuICAgICAgICBmdW5jdGlvbiBmaW5kTGF5ZXJOb3cobGlzdCwgaWQpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgbCBvZiBsaXN0KSB7XG4gICAgICAgICAgICAgICAgaWYgKGwuaWQgPT09IGlkKSByZXR1cm4gbDtcbiAgICAgICAgICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3ViID0gZmluZExheWVyTm93KGwubGF5ZXJzIHx8IFtdLCBpZCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdWIpIHJldHVybiBzdWI7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgZnVuY3Rpb24gZmVhdHVyZVZpc2libGVOb3cobGF5ZXIsIGluZGV4KSB7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50ID0gZmluZExheWVyTm93KGxheWVyU3RhdGUsIGxheWVyLmlkKSB8fCBsYXllcjtcbiAgICAgICAgICAgIGlmICghaXNMYXllckVmZmVjdGl2ZVZpc2libGUoY3VycmVudCwgbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWN1cnJlbnQudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IoY3VycmVudCwgYnVmZmVyU3RhdGUpO1xuICAgICAgICAgICAgaWYgKCF0aW1lcykgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjb25zdCB3aW4gPSB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssXG4gICAgICAgICAgICAgICAgZWZmZWN0aXZlRHVyYXRpb24oY3VycmVudCwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgICAgICAgICBpZiAoaW5kZXggIT0gbnVsbCAmJiB0aW1lcy5sZW5ndGggPiAyKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lc1tpbmRleCAqIDJdO1xuICAgICAgICAgICAgICAgIHJldHVybiBOdW1iZXIuaXNOYU4oc3RhcnQpXG4gICAgICAgICAgICAgICAgICAgIHx8IGZlYXR1cmVJbldpbmRvdyhzdGFydCwgdGltZXNbaW5kZXggKiAyICsgMV0sIHdpbik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSlcbiAgICAgICAgICAgICAgICAgICAgICAgIHx8IGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFjdGl2ZVRpbGVMYXllcnMgPSB7fTtcbiAgICAgICAgY29uc3QgYWN0aXZlT3ZlcmxheUxheWVycyA9IHt9O1xuICAgICAgICBjb25zdCBnbFN0YXRlcyA9IHtcbiAgICAgICAgICAgIGNpcmNsZV9tYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIG1hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgcG9seWxpbmU6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgcG9seWdvbjogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyLiBgdGltZVN0YXRlYCBpcyB3aGF0IHJlbmRlcmluZyByZWFkcyAtLSB0aGUgY3VycmVudCB0aWNrXG4gICAgICAgIC8vIGFuZCB0aGUgcGVyaW9kLCBvciBudWxsIHdoZW4gbm90aGluZyBpcyBhbmltYXRlZCAtLSBhbmQgYHRpbWVVSWAgaXMgdGhlIHNsaWRlcidzXG4gICAgICAgIC8vIG93biBib29ra2VlcGluZy4gUGxheWJhY2sgbmV2ZXIgcm91bmQtdHJpcHMgdGhyb3VnaCBQeXRob246IHRpY2tzIHJlLXJlbmRlclxuICAgICAgICAvLyBsb2NhbGx5LCBhbmQgdGltZV9jdXJyZW50IGlzIHdyaXR0ZW4gYmFjayBhdCBtb3N0IG9uY2UgYSBzZWNvbmQgd2hpbGUgcGxheWluZy5cbiAgICAgICAgbGV0IHRpbWVTdGF0ZSA9IG51bGw7XG4gICAgICAgIGNvbnN0IHRpbWVVSSA9IHsgdGlja3M6IFtdLCBrZXk6IFwiXCIsIGluZGV4OiAwLCBwbGF5aW5nOiBmYWxzZSwgbG9vcDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgc3BlZWQ6IDEsIHRpbWVyOiBudWxsLCBsYXN0V3JpdGU6IDAsIHN0YXJ0ZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogbnVsbCwgcGVyaW9kTXM6IG51bGwsIGdyaWRNczogbnVsbCB9O1xuXG4gICAgICAgIGZ1bmN0aW9uIHN0b3BQbGF5YmFjaygpIHtcbiAgICAgICAgICAgIGlmICh0aW1lVUkudGltZXIpIGNsZWFySW50ZXJ2YWwodGltZVVJLnRpbWVyKTtcbiAgICAgICAgICAgIHRpbWVVSS50aW1lciA9IG51bGw7XG4gICAgICAgICAgICB0aW1lVUkucGxheWluZyA9IGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gd3JpdGVUaW1lQ3VycmVudChmb3JjZSkge1xuICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICAgIGlmICghZm9yY2UgJiYgbm93IC0gdGltZVVJLmxhc3RXcml0ZSA8IDEwMDApIHJldHVybjtcbiAgICAgICAgICAgIHRpbWVVSS5sYXN0V3JpdGUgPSBub3c7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInRpbWVfY3VycmVudFwiLCB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHNlZWtUbyhpbmRleCwgeyB3cml0ZSA9IHRydWUgfSA9IHt9KSB7XG4gICAgICAgICAgICB0aW1lVUkuaW5kZXggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihpbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpKTtcbiAgICAgICAgICAgIHRpbWVTdGF0ZSA9IHsgdGljazogdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0sIHBlcmlvZDogdGltZVN0YXRlLnBlcmlvZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93OiB0aW1lVUkud2luZG93IH07XG4gICAgICAgICAgICBpZiAod3JpdGUpIHdyaXRlVGltZUN1cnJlbnQoIXRpbWVVSS5wbGF5aW5nKTtcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHN0YXJ0UGxheWJhY2soKSB7XG4gICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgIHRpbWVVSS5wbGF5aW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIHRpbWVVSS50aW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBuZXh0ID0gYWR2YW5jZSh0aW1lVUkuaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGgsIHRpbWVVSS5sb29wKTtcbiAgICAgICAgICAgICAgICBpZiAoIW5leHQucGxheWluZykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzZWVrVG8obmV4dC5pbmRleCk7XG4gICAgICAgICAgICB9LCAxMDAwIC8gdGltZVVJLnNwZWVkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRpbWVIYW5kbGVycyA9IHtcbiAgICAgICAgICAgIG9uU2VlazogKGluZGV4KSA9PiBzZWVrVG8oaW5kZXgpLFxuICAgICAgICAgICAgb25TdGVwQmFjazogKCkgPT4gc2Vla1RvKHRpbWVVSS5pbmRleCAtIDEpLFxuICAgICAgICAgICAgb25TdGVwRm9yd2FyZDogKCkgPT4gc2Vla1RvKHRpbWVVSS5pbmRleCArIDEpLFxuICAgICAgICAgICAgb25QbGF5VG9nZ2xlOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5wbGF5aW5nKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHN0YXJ0T3ZlciwgYXMgdGhlIGZvbGl1bSBwbGF5ZXIgd2FzIGNvbmZpZ3VyZWQ6IHByZXNzaW5nIHBsYXkgYXRcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCByZXN0YXJ0cyBmcm9tIHRoZSBiZWdpbm5pbmcgaW1tZWRpYXRlbHksIHJhdGhlciB0aGFuIG9uZVxuICAgICAgICAgICAgICAgICAgICAvLyBzaWxlbnQgaW50ZXJ2YWwgbGF0ZXIgZGVjaWRpbmcgdGhlcmUgaXMgbm93aGVyZSB0byBnbyBhbmQgc3RvcHBpbmcuXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aW1lVUkuaW5kZXggPj0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpIHNlZWtUbygwKTtcbiAgICAgICAgICAgICAgICAgICAgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uTG9vcFRvZ2dsZTogKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5sb29wID0gIXRpbWVVSS5sb29wO1xuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25TcGVlZDogKHNwZWVkKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gc3BlZWQ7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5wbGF5aW5nKSBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gTGl2ZSBkdXJpbmcgdGhlIGRyYWc6IGxvY2FsIHN0YXRlIGFuZCBhIHJlLXJlbmRlciBvZiB0aGUgY29udHJvbCBvbiBldmVyeVxuICAgICAgICAgICAgLy8gbW92ZSwgYnV0IG1hcCByZWJ1aWxkcyBhdCBtb3N0IGV2ZXJ5IDMwMG1zLiBBdCA1TSBwb2ludHMgYSByZWJ1aWxkIGNvc3RzXG4gICAgICAgICAgICAvLyBzZWNvbmRzLCBhbmQgYSBkcmFnIGZpcmVzIGRvemVucyBvZiBtb3ZlcyAtLSB1bnRocm90dGxlZCwgdGhlIHJlYnVpbGRzXG4gICAgICAgICAgICAvLyBzdGFjayBmYXN0ZXIgdGhhbiB0aGV5IGZpbmlzaCBhbmQgdGhlIGFsbG9jYXRpb24gY2h1cm4gY3Jhc2hlcyB0aGUgdGFiLlxuICAgICAgICAgICAgb25XaW5kb3dEcmFnOiAoaXNvKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmRyYWdBY3RpdmUgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBpc287XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkgdGltZVN0YXRlID0geyAuLi50aW1lU3RhdGUsIHdpbmRvdzogaXNvIH07XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgICAgIGlmIChub3cgLSAodGltZVVJLmxhc3REcmFnU3luYyB8fCAwKSA+PSAzMDApIHtcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLmxhc3REcmFnU3luYyA9IG5vdztcbiAgICAgICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIE9uIHJlbGVhc2UgKG9yIGEga2V5Ym9hcmQgc3RlcCk6IHRoZSBvdmVycmlkZSBsYW5kcyBpbiB0aW1lX2NvbmZpZyBzb1xuICAgICAgICAgICAgLy8gUHl0aG9uIGFuZCBTaGlueSBzZWUgdGhlIHNhbWUgd2luZG93IHRoZSBiYXIgc2hvd3MuIG51bGwgY2xlYXJzIHRoZSBrZXksXG4gICAgICAgICAgICAvLyBoYW5kaW5nIGNvbnRyb2wgYmFjayB0byBwZXItbGF5ZXIgZHVyYXRpb25zLlxuICAgICAgICAgICAgb25XaW5kb3dDb21taXQ6IChpc28pID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lSGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XG4gICAgICAgICAgICAgICAgdGltZVVJLmRyYWdBY3RpdmUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBxdWV1ZVN5bmMoKTsgICAgICAgLy8gdGhlIHJlbGVhc2UgYWx3YXlzIGxhbmRzLCB0aHJvdHRsZSBvciBub3RcbiAgICAgICAgICAgICAgICBjb25zdCBjZmcgPSB7IC4uLihtb2RlbC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fSkgfTtcbiAgICAgICAgICAgICAgICBpZiAoaXNvKSBjZmcud2luZG93ID0gaXNvO1xuICAgICAgICAgICAgICAgIGVsc2UgZGVsZXRlIGNmZy53aW5kb3c7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwidGltZV9jb25maWdcIiwgY2ZnKTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGxvY2FsIG1vZGVsIHN0aWxsIGhvbGRzIGl0ICovIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gQ3JlYXRlcywgcmV0dW5lcyBvciByZW1vdmVzIHRoZSBzbGlkZXIgdG8gbWF0Y2ggdGhlIGxheWVycyBwcmVzZW50LiBUaWNrcyBhcmVcbiAgICAgICAgLy8gcmVnZW5lcmF0ZWQgb25seSB3aGVuIHRoZSBkYXRhJ3MgdGltZSBleHRlbnQgb3IgdGhlIHBlcmlvZCBjaGFuZ2VzLCBzbyBhXG4gICAgICAgIC8vIHBsYXliYWNrIHRpY2sgLS0gd2hpY2ggcmUtZW50ZXJzIGhlcmUgdmlhIHF1ZXVlU3luYyAtLSBkb2VzIG5vdCByZWJ1aWxkIHRoZW0uXG4gICAgICAgIGZ1bmN0aW9uIHVwZGF0ZVRpbWVEaW1lbnNpb24oKSB7XG4gICAgICAgICAgICBpZiAoIWhhc1RpbWVMYXllcnMobGF5ZXJTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgeyB0aWNrczogW10gfSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IFwiXCI7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGNmZyA9IG1vZGVsLmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgcGVyaW9kID0gcGFyc2VQZXJpb2QoY2ZnLnBlcmlvZCB8fCBcIlAxRFwiKSB8fCBwYXJzZVBlcmlvZChcIlAxRFwiKTtcbiAgICAgICAgICAgIGNvbnN0IGV4dGVudCA9IGNvbGxlY3RUaW1lRXh0ZW50KGxheWVyU3RhdGUsIGJ1ZmZlclN0YXRlKTtcbiAgICAgICAgICAgIGlmICghZXh0ZW50KSByZXR1cm47XG5cbiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2V4dGVudC5taW59fCR7ZXh0ZW50Lm1heH18JHtjZmcucGVyaW9kIHx8IFwiUDFEXCJ9YDtcbiAgICAgICAgICAgIGlmIChrZXkgIT09IHRpbWVVSS5rZXkpIHtcbiAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0ga2V5O1xuICAgICAgICAgICAgICAgIHRpbWVVSS50aWNrcyA9IGdlbmVyYXRlVGlja3MoZXh0ZW50Lm1pbiwgZXh0ZW50Lm1heCwgcGVyaW9kKTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuaW5kZXggPSBNYXRoLm1pbih0aW1lVUkuaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVGhlIHNoYXJlZCB3aW5kb3cgb3ZlcnJpZGUsIGNvbmZpZy1kcml2ZW47IGEgYmFkIHN0cmluZyBjbGVhcnMgcmF0aGVyIHRoYW5cbiAgICAgICAgICAgIC8vIGd1ZXNzaW5nLiBUaGUgZHJhZyBncmlkIGlzIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZFxuICAgICAgICAgICAgLy8gZHVyYXRpb24gLS0gdGhlIGxhcmdlc3Qgc3RlcCB0aGF0IGxhbmRzIG9uIGFsbCBvZiB0aGVtIC0tIHNvIGEgMi41aCB0cmFpbFxuICAgICAgICAgICAgLy8gaXMgZHJhZ2dhYmxlIG9uIGEgMWggYmFyLiBDYWxlbmRhciBwZXJpb2RzIGhhdmUgbm8gZml4ZWQgd2lkdGg7IHRoZSBydWxlclxuICAgICAgICAgICAgLy8gdGhlbiBzaG93cyBpbnRlcnZhbCBtYXJrcyBvbmx5IGFuZCB0aGUgdHJhaWwgaGFuZGxlIGhpZGVzLlxuICAgICAgICAgICAgLy8gTmV2ZXIgd2hpbGUgYSBkcmFnIGlzIGxpdmU6IHRoZSBkcmFnZ2VkIHdpbmRvdyBleGlzdHMgb25seSBsb2NhbGx5IHVudGlsXG4gICAgICAgICAgICAvLyByZWxlYXNlIGNvbW1pdHMgaXQsIGFuZCByZWFkaW5nIGNvbmZpZyBoZXJlIG1pZC1kcmFnIHJlc2V0IHRoZSBoYW5kbGUgdG9cbiAgICAgICAgICAgIC8vIFwibm8gd2luZG93XCIgb24gZXZlcnkgZGVib3VuY2VkIHN5bmMgLS0gdGhlIGhhbmRsZSBmb2xsb3dlZCB0aGUgbW91c2UsIHRoZW5cbiAgICAgICAgICAgIC8vIHNuYXBwZWQgaG9tZSwgdGhlbiBmb2xsb3dlZCBhZ2Fpbiwgb25jZSBwZXIgc3luYy5cbiAgICAgICAgICAgIGlmICghdGltZVVJLmRyYWdBY3RpdmUpIHtcbiAgICAgICAgICAgICAgICB0aW1lVUkud2luZG93ID0gY2ZnLndpbmRvdyAmJiBwYXJzZVBlcmlvZChjZmcud2luZG93KSA/IGNmZy53aW5kb3cgOiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGltZVVJLnBlcmlvZE1zID0gcGVyaW9kVG9NcyhwZXJpb2QpO1xuICAgICAgICAgICAgdGltZVVJLmdyaWRNcyA9IHRpbWVVSS5wZXJpb2RNc1xuICAgICAgICAgICAgICAgID8gZ2NkR3JpZE1zKHRpbWVVSS5wZXJpb2RNcywgY29sbGVjdER1cmF0aW9uc01zKGxheWVyU3RhdGUsIHRpbWVVSS53aW5kb3cpKVxuICAgICAgICAgICAgICAgIDogbnVsbDtcblxuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kLCB3aW5kb3c6IHRpbWVVSS53aW5kb3cgfTtcbiAgICAgICAgICAgIHRpbWVVSS5wb3NpdGlvbiA9IGNmZy5wb3NpdGlvbiB8fCBcInRvcC1jZW50ZXJcIjtcblxuICAgICAgICAgICAgaWYgKCF0aW1lVUkuc3RhcnRlZCkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBjZmcuc3BlZWQgfHwgMTtcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9IEJvb2xlYW4oY2ZnLmxvb3ApO1xuICAgICAgICAgICAgICAgIC8vIE9ubHkgdGhlIGZpcnN0IGNvbmZpZ3VyYXRpb24gbWF5IGF1dG8tc3RhcnQuIEV2ZXJ5IGNvbmZpZyBjaGFuZ2UgcmVzZXRzXG4gICAgICAgICAgICAgICAgLy8gYHN0YXJ0ZWRgIHRvIHJlLXJlYWQgc3BlZWQgYW5kIGxvb3AgLS0gaW5jbHVkaW5nIHRoZSBjaGFuZ2UgYSB3aW5kb3dcbiAgICAgICAgICAgICAgICAvLyBkcmFnIGNvbW1pdHMgLS0gYW5kIHJlLXJ1bm5pbmcgYXV0b19wbGF5IHRoZXJlIHdvdWxkIHN0YXJ0IHBsYXliYWNrIGFzXG4gICAgICAgICAgICAgICAgLy8gYSBzaWRlIGVmZmVjdCBvZiByZWxlYXNpbmcgdGhlIGhhbmRsZS5cbiAgICAgICAgICAgICAgICBpZiAoY2ZnLmF1dG9fcGxheSAmJiAhdGltZVVJLmV2ZXJTdGFydGVkKSBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgdGltZVVJLmV2ZXJTdGFydGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTaWRlYmFyIExheWVycyBDb250cm9sIFVJXG4gICAgICAgIGNvbnN0IHNpZGViYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBzaWRlYmFyLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtc2lkZWJhclwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnRvcCA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnJpZ2h0ID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5wYWRkaW5nID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5tYXhIZWlnaHQgPSBcIjgwJVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLm92ZXJmbG93WSA9IFwiYXV0b1wiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRGYW1pbHkgPSBcIi1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgJ1NlZ29lIFVJJywgUm9ib3RvLCBzYW5zLXNlcmlmXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5jb2xvciA9IFwiIzMzM1wiO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoc2lkZWJhcik7XG5cbiAgICAgICAgLy8gTGVnZW5kOiBkZXJpdmVkIGZyZXNoIG9uIGV2ZXJ5IHN5bmMgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSB0aGUgc2lkZWJhclxuICAgICAgICAvLyByZW5kZXJzIGZyb20sIHNvIHRvZ2dsZXMgZGltIG9yIGRyb3Agcm93cyB3aXRoIG5vIGV4dHJhIHdpcmluZy4gSGlkZGVuXG4gICAgICAgIC8vIHVudGlsIHNob3dfbGVnZW5kIGFza3MgZm9yIGl0LlxuICAgICAgICBjb25zdCBsZWdlbmREaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBsZWdlbmREaXYuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1sZWdlbmRcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUubWF4V2lkdGggPSBcIjI2MHB4XCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5tYXhIZWlnaHQgPSBcIjQ1JVwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUub3ZlcmZsb3dZID0gXCJhdXRvXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5mb250RmFtaWx5ID0gc2lkZWJhci5zdHlsZS5mb250RmFtaWx5O1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmNvbG9yID0gXCIjMzMzXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChsZWdlbmREaXYpO1xuXG4gICAgICAgIC8vIExvZ29cbiAgICAgICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm90dG9tID0gXCIxMHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBsb2dvRGl2LmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyO1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZS5wbmdcIiBhbHQ9XCJDb21wYW55XCIgc3R5bGU9XCJoZWlnaHQ6IDM1cHg7IG1hcmdpbi1yaWdodDogNXB4O1wiPlxuICAgICAgICAgICAgICAgIDxpbWcgc3JjPVwiaHR0cHM6Ly9yZXBvL2Fzc2V0cy9pbWFnZTIucG5nXCIgYWx0PVwiUGFyZW50IENvbXBhbnlcIiBzdHlsZT1cImhlaWdodDogMzVweDtcIj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICBgO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobG9nb0Rpdik7XG5cblxuXG4gICAgICAgIGZ1bmN0aW9uIGdldFRpbGVMYXllcihsYXllcikge1xuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGlvbjogbGF5ZXIuYXR0cmlidXRpb24gfHwgJycsXG4gICAgICAgICAgICAgICAgbWF4Wm9vbTogbGF5ZXIubWF4X3pvb20gfHwgMjIsXG4gICAgICAgICAgICAgICAgbWF4TmF0aXZlWm9vbTogbGF5ZXIubWF4X25hdGl2ZV96b29tIHx8IDE5XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgLy8geHl6c2VydmljZXMgcHJvdmlkZXJzIGRlY2xhcmUgdGhlaXIgb3duIHtzfSBob3N0czsgTGVhZmxldCdzXG4gICAgICAgICAgICAvLyBkZWZhdWx0IFwiYWJjXCIgaXMgd3JvbmcgZm9yIGFueXRoaW5nIGVsc2UuXG4gICAgICAgICAgICBpZiAobGF5ZXIuc3ViZG9tYWlucykgb3B0aW9ucy5zdWJkb21haW5zID0gbGF5ZXIuc3ViZG9tYWlucztcbiAgICAgICAgICAgIGlmIChsYXllci53bXMpIHtcbiAgICAgICAgICAgICAgICAvLyBXTVMgcmVxdWVzdCBDUlMgZm9sbG93cyB0aGUgbWFwJ3MsIHNvIDQzMjYgbWFwcyBhc2sgaW4gNDMyNi5cbiAgICAgICAgICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIud21zKGxheWVyLnVybCwge1xuICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IGxheWVyLndtcy5sYXllcnMsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1hdDogbGF5ZXIud21zLmZvcm1hdCB8fCAnaW1hZ2UvcG5nJyxcbiAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogbGF5ZXIud21zLnZlcnNpb24gfHwgJzEuMS4xJyxcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNwYXJlbnQ6ICEhbGF5ZXIud21zLnRyYW5zcGFyZW50LFxuICAgICAgICAgICAgICAgICAgICAuLi4obGF5ZXIud21zLnN0eWxlcyA/IHsgc3R5bGVzOiBsYXllci53bXMuc3R5bGVzIH0gOiB7fSlcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBMLnRpbGVMYXllcihsYXllci51cmwsIG9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY01hcFN0YXRlKCkge1xuICAgICAgICAgICAgY29uc29sZS50aW1lKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XG4gICAgICAgICAgICB1cGRhdGVUaW1lRGltZW5zaW9uKCk7XG4gICAgICAgICAgICBjb25zdCBsYXllcnMgPSBsYXllclN0YXRlO1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBDb25maWdzID0gbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gYnVmZmVyU3RhdGU7XG5cbiAgICAgICAgICAgIC8vIEVuZm9yY2UgbXV0dWFsbHkgZXhjbHVzaXZlIHJhZGlvIGdyb3VwIHZpc2liaWxpdHkgYmVmb3JlIGNvbGxlY3Rpbmcgb3IgcmVuZGVyaW5nIFdlYkdMIGxheWVycy5cbiAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFjayBhcyB0YXJnZXRlZCBmbGlwcywgbmV2ZXIgdGhlIGxheWVycyB0cmFpdCAtLSB0aGUgZnVsbCB3cml0ZSB3YXNcbiAgICAgICAgICAgIC8vIHRoZSBmcmFtZSB0aGF0IGtpbGxlZCBsYXJnZSBzZXNzaW9ucyAoc2VlIHRoZSBzaWRlYmFyJ3MgY2hhbmdlIGhhbmRsZXIpLlxuICAgICAgICAgICAgY29uc3QgcmFkaW8gPSBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICBpZiAoKHJhZGlvLmNoYW5nZXMubGVuZ3RoID4gMCB8fCByYWRpby5ncm91cHNDaGFuZ2VkKSAmJiBkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCByYWRpby5jaGFuZ2VzKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIHsgLi4uZ3JvdXBDb25maWdzIH0pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBtb2RlbC5nZXQoXCJzaG93X2xvZ29cIikgPyBcImJsb2NrXCIgOiBcIm5vbmVcIjtcblxuICAgICAgICAgICAgLy8gR3JvdXAgdmlzaWJsZSBsYXllcnMgKGluY2x1ZGluZyBzdWItbGF5ZXJzIGluc2lkZSBncm91cHMpIHRvIGFsd2F5cyB1c2UgV2ViR0xcbiAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgICBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWxpbmU6IHdlYmdsUG9seWxpbmVMYXllcnMsXG4gICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzLFxuICAgICAgICAgICAgfSA9IGNvbGxlY3RXZWJnbExheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XG5cbiAgICAgICAgICAgIC8vIFNldCBvZiBsYXllciBJRHMgcHJvY2Vzc2VkIHZpYSBtZXJnZWQgV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBjb25zdCB3ZWJnbExheWVySWRzID0gbmV3IFNldChbXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5bGluZUxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlnb25MYXllcnMubWFwKGwgPT4gbC5pZClcbiAgICAgICAgICAgIF0pO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgcmV0aXJlZCBvdmVybGF5IGxheWVycywgaW5jbHVkaW5nIHRob3NlIHRoYXQgdHJhbnNpdGlvbmVkIHRvIFdlYkdMXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhhY3RpdmVPdmVybGF5TGF5ZXJzKS5mb3JFYWNoKGlkID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWxheWVycy5maW5kKGwgPT4gbC5pZCA9PT0gaWQpIHx8IHdlYmdsTGF5ZXJJZHMuaGFzKGlkKSkge1xuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBQcm9jZXNzIG5vbi1XZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcImJhc2VtYXBcIikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZWZmZWN0aXZlVmlzaWJsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGlsZSA9IGdldFRpbGVMYXllcihsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGlsZS5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0gPSB0aWxlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIFNraXAgbGF5ZXJzIG1hbmFnZWQgYnkgdGhlIG1lcmdlZCBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgICAgICBpZiAod2ViZ2xMYXllcklkcy5oYXMobGF5ZXIuaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZWZmZWN0aXZlVmlzaWJsZSB8fCAhbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVyU3RhdGUsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgLy8gSW1hZ2Ugb3ZlcmxheXMgcmVjcmVhdGUgd2hlbiB0aGVpciBjb25maWcgb3IgdGhlaXIgYnVmZmVyXG4gICAgICAgICAgICAgICAgICAgIC8vIGNoYW5nZXMgLS0gYSByZXBsYWNlIG9wIHN3YXBzIHRoZSBjb25maWcgb2JqZWN0IGFuZCBhXG4gICAgICAgICAgICAgICAgICAgIC8vIGJ1ZmZlciBvcCBzd2FwcyB0aGUgRGF0YVZpZXcsIGFuZCBhIHN0YWxlIGltYWdlIHdvdWxkXG4gICAgICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSBzaXQgdW50aWwgYSB2aXNpYmlsaXR5IGJvdW5jZS5cbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhbGVJbWFnZSA9IGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIlxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgKGV4aXN0aW5nLmltYWdlTWV0YSAhPT0gaW1hZ2VNZXRhS2V5KGxheWVyKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8IGV4aXN0aW5nLmltYWdlU291cmNlICE9PSAoY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdIHx8IG51bGwpKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nLmxheWVyVHlwZSAhPT0gbGF5ZXIudHlwZSB8fCBzdGFsZUltYWdlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0sIG1vZGVsKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0gPSBpbnN0YW5jZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEhlbHBlciB0byBzeW5jIFdlYkdMIGxheWVyIHN0YXRlcyBhbmQgcmVidWlsZCBvbmx5IGlmIGNoYW5nZWRcbiAgICAgICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMsIHZlY3RvckdwdSA9IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRzU3RyaW5nID0gdmlzaWJsZUxheWVycy5tYXAobCA9PiBsLmlkKS5zb3J0KCkuam9pbihcIixcIik7XG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyB0aGUgYnVpbHQgYnVmZmVycyBkZXBlbmQgb24gYmVsb25ncyBpbiB0aGlzIGtleTogYSBjaGFuZ2UgdGhhdFxuICAgICAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXG4gICAgICAgICAgICAgICAgLy8gbWlzc2luZyBhdCBmaXJzdCwgc28gYSBoaWdobGlnaHQgbGFuZGVkIGluIHN0YXRlIGFuZCBuZXZlciByZXBhaW50ZWQuXG4gICAgICAgICAgICAgICAgLy8gUG9pbnQgYnVja2V0cyBvbiB0aGUgR1BVIHBhdGggZXhjbHVkZSB0aGUgdGljayBhbmQgd2luZG93IGZyb20gdGhlIGtleTpcbiAgICAgICAgICAgICAgICAvLyB0aG9zZSBjaGFuZ2UgcGVyIHRpY2sgYW5kIGFyZSBhcHBsaWVkIGFzIHVuaWZvcm1zLCBub3QgYnkgcmVidWlsZGluZy5cbiAgICAgICAgICAgICAgICAvLyBUaGUgcGVyaW9kIHN0YXlzIGluLCBzaW5jZSBpdCBpcyBiYWtlZCBpbnRvIHRoZSBkdXJhdGlvbiBhdHRyaWJ1dGVzLlxuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgZWxzZSAtLSBhbmQgZXZlcnkgbm9uLXBvaW50IGJ1Y2tldCAtLSByZWJ1aWxkcyBhcyBiZWZvcmUuXG4gICAgICAgICAgICAgICAgY29uc3QgZ3B1UG9pbnRzID0gKCh0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCIpXG4gICAgICAgICAgICAgICAgICAgICYmIGdwdVRpbWVBdmFpbGFibGUoKSkgfHwgdmVjdG9yR3B1O1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFTdHJpbmcgPSBKU09OLnN0cmluZ2lmeSh2aXNpYmxlTGF5ZXJzLm1hcChsID0+ICh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogbC5jb2xvcixcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiBsLnJhZGl1cyxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogbC5vcGFjaXR5LFxuICAgICAgICAgICAgICAgICAgICBmaWxsT3BhY2l0eTogbC5maWxsT3BhY2l0eSxcbiAgICAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0OiBsLmhpZ2hsaWdodF9zdHlsZSxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVzOiBsLnN0eWxlX292ZXJyaWRlcyxcbiAgICAgICAgICAgICAgICAgICAgZmVhdHVyZVN0eWxlczogbC5mZWF0dXJlX3N0eWxlcyxcbiAgICAgICAgICAgICAgICAgICAgdGltZTogbC50aW1lLFxuICAgICAgICAgICAgICAgICAgICBncHU6IGdwdVBvaW50cyxcbiAgICAgICAgICAgICAgICAgICAgdGljazogbC50aW1lICYmIHRpbWVTdGF0ZSAmJiAhZ3B1UG9pbnRzID8gdGltZVN0YXRlLnRpY2sgOiAwLFxuICAgICAgICAgICAgICAgICAgICB3aW46IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBwZXI6IGwudGltZSAmJiBncHVQb2ludHMgJiYgdGltZVN0YXRlXG4gICAgICAgICAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBsb2NMZW46IGwubG9jYXRpb25zPy5sZW5ndGggfHwgMFxuICAgICAgICAgICAgICAgIH0pKSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlQ2hhbmdlZCA9IHN0YXRlLmlkcyAhPT0gaWRzU3RyaW5nIHx8IHN0YXRlLm1ldGEgIT09IG1ldGFTdHJpbmc7XG5cbiAgICAgICAgICAgICAgICBpZiAoc3RhdGVDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBhd2FpdCByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgdmlzaWJsZUxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsLCB0aW1lU3RhdGUsIHZlY3RvckdwdSwgZmVhdHVyZVZpc2libGVOb3cpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIuYWRkVG8obWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5pZHMgPSBpZHNTdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLm1ldGEgPSBtZXRhU3RyaW5nO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gUG9pbnQgYnVja2V0cyBob2xkaW5nIHRpbWUgbGF5ZXJzIGtlZXAgRVZFUlkgcG9pbnQgbGF5ZXIgLS0gaGlkZGVuIG9uZXNcbiAgICAgICAgICAgIC8vIGluY2x1ZGVkIC0tIHNvIGEgc2lkZWJhciB0b2dnbGUgY2hhbmdlcyBhIHZpc2liaWxpdHkgdW5pZm9ybSBpbnN0ZWFkIG9mXG4gICAgICAgICAgICAvLyB0aGUgYnVja2V0J3MgaWRzLiBVbmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZWJ1aWxkIGFsbCA1TVxuICAgICAgICAgICAgLy8gcG9pbnRzOyBjbGlja2luZyBkb3duIHRoZSBzaWRlYmFyIHN0YWNrZWQgdGhvc2UgcmVidWlsZHMgaW50byBhIGNyYXNoLlxuICAgICAgICAgICAgY29uc3QgYWxsQnlUeXBlID0gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIC8vIEFyZWEgb3V0bGluZXMgcmlkZSB0aGUgbGluZXMgYnVja2V0OiBldmVyeSBwb2x5Z29uIGFuZCBjaXJjbGUgam9pbnMgaXQgYXNcbiAgICAgICAgICAgIC8vIGFuIGV4dHJhIGVudHJ5IHdob3NlIHJpbmdzIHJlbmRlciBhcyB3ZWlnaHRlZCBMaW5lU3RyaW5ncyAodGhlIHBvbHlnb25cbiAgICAgICAgICAgIC8vIGJ1Y2tldCBkcmF3cyBvbmx5IHRoZSBmaWxsKS4gSm9pbmluZyB1bmNvbmRpdGlvbmFsbHkgLS0gc3Ryb2tlbGVzcyBhcmVhc1xuICAgICAgICAgICAgLy8gY29udHJpYnV0ZSBhbiBlbXB0eSBzbG90IC0tIGtlZXBzIHRoZSBidWNrZXQncyBtZW1iZXJzaGlwIGluZGVwZW5kZW50IG9mXG4gICAgICAgICAgICAvLyBzdHlsZSBjaGFuZ2VzLCBzbyByZXN0eWxpbmcgYSBib3JkZXIgc3RheXMgYSByZWJ1aWxkLCBuZXZlciBhIHJlLWJ1Y2tldC5cbiAgICAgICAgICAgIGFsbEJ5VHlwZS5wb2x5bGluZSA9IFsuLi5hbGxCeVR5cGUucG9seWxpbmUsIC4uLmFsbEJ5VHlwZS5wb2x5Z29uXTtcbiAgICAgICAgICAgIGNvbnN0IGJ1Y2tldCA9IHsgY2lyY2xlX21hcmtlcnM6IHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9seWxpbmU6IFsuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLCAuLi53ZWJnbFBvbHlnb25MYXllcnNdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMgfTtcbiAgICAgICAgICAgIGNvbnN0IHZlY3RvckdwdUJ1Y2tldCA9IHsgcG9seWxpbmU6IGZhbHNlLCBwb2x5Z29uOiBmYWxzZSB9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGVudHJpZXMgPSBhbGxCeVR5cGVbdHlwZV07XG4gICAgICAgICAgICAgICAgY29uc3QgaXNQb2ludHMgPSB0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCI7XG4gICAgICAgICAgICAgICAgY29uc3QgYXZhaWxhYmxlID0gaXNQb2ludHMgPyBncHVUaW1lQXZhaWxhYmxlKCkgOiB2ZWN0b3JHcHVBdmFpbGFibGUoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBncHVWaXMgPSBhdmFpbGFibGUgJiYgZW50cmllcy5sZW5ndGggPiAwXG4gICAgICAgICAgICAgICAgICAgICYmIGVudHJpZXMubGVuZ3RoIDw9IExBWUVSX1NMT1RTXG4gICAgICAgICAgICAgICAgICAgICYmIGVudHJpZXMuc29tZShlID0+IGUubGF5ZXIudGltZSk7XG4gICAgICAgICAgICAgICAgZ2xTdGF0ZXNbdHlwZV0udmlzVmVjdG9yID0gZ3B1VmlzID8gZW50cmllcy5tYXAoZSA9PiAoZS52aXMgPyAxIDogMCkpIDogbnVsbDtcbiAgICAgICAgICAgICAgICBpZiAoZ3B1VmlzKSBidWNrZXRbdHlwZV0gPSBlbnRyaWVzLm1hcChlID0+IGUubGF5ZXIpO1xuICAgICAgICAgICAgICAgIGlmICghaXNQb2ludHMpIHZlY3RvckdwdUJ1Y2tldFt0eXBlXSA9IGdwdVZpcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJjaXJjbGVfbWFya2Vyc1wiLCBidWNrZXQuY2lyY2xlX21hcmtlcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJtYXJrZXJzXCIsIGJ1Y2tldC5tYXJrZXJzKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWxpbmVcIiwgYnVja2V0LnBvbHlsaW5lLCB2ZWN0b3JHcHVCdWNrZXQucG9seWxpbmUpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5Z29uXCIsIGJ1Y2tldC5wb2x5Z29uLCB2ZWN0b3JHcHVCdWNrZXQucG9seWdvbik7XG5cbiAgICAgICAgICAgIC8vIFB1c2ggdGhlIGN1cnJlbnQgd2luZG93IGludG8gdGhlIEdQVS1maWx0ZXJlZCBwb2ludCBidWNrZXRzOiB0d28gdW5pZm9ybXNcbiAgICAgICAgICAgIC8vIGFuZCBhIHJlZHJhdywgd2hpY2ggaXMgdGhlIGVudGlyZSBwZXItdGljayBjb3N0IG9mIHRoZSB0aW1lIHNsaWRlciB0aGVyZS5cbiAgICAgICAgICAgIGZvciAoY29uc3QgdHlwZSBvZiBbXCJjaXJjbGVfbWFya2Vyc1wiLCBcIm1hcmtlcnNcIiwgXCJwb2x5bGluZVwiLCBcInBvbHlnb25cIl0pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGhhbmRsZSA9IHN0YXRlLmxheWVyICYmIHN0YXRlLmxheWVyLl9zd2lmdG1hcFRpbWU7XG4gICAgICAgICAgICAgICAgaWYgKCFoYW5kbGUpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIC8vIExheWVyIHZpc2liaWxpdHkgZmlyc3QsIGFuZCBvbmx5IHdoZW4gaXQgY2hhbmdlZDogYSB0b2dnbGUgY29zdHMgb25lXG4gICAgICAgICAgICAgICAgLy8gdW5pZm9ybSBhcnJheSB3cml0ZSBhbmQgYSByZWRyYXcsIG5ldmVyIGEgcmVidWlsZC5cbiAgICAgICAgICAgICAgICBjb25zdCB2aXMgPSBzdGF0ZS52aXNWZWN0b3I7XG4gICAgICAgICAgICAgICAgaWYgKHZpcykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSB2aXMuam9pbihcIlwiKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLnZpc0tleSAhPT0ga2V5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS52aXNLZXkgPSBrZXk7XG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0TGF5ZXJWaXNpYmlsaXR5KHZpcyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBvdmVycmlkZU1zID0gdGltZVN0YXRlLndpbmRvd1xuICAgICAgICAgICAgICAgICAgICAgICAgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHRpbWVTdGF0ZS53aW5kb3cpKSA6IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3codGltZVN0YXRlLnRpY2ssIG92ZXJyaWRlTXMpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3cobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZW5kZXJTaWRlYmFyQ29udHJvbHMoc2lkZWJhciwgbGF5ZXJzLCBtb2RlbCwgbWFwLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBQZXJtYW5lbnQgbGFiZWxzIGZvbGxvdyB0aGUgc2FtZSBkZXJpdmUtcGVyLXN5bmMgcGF0dGVybiBhcyB0aGUgbGVnZW5kLFxuICAgICAgICAgICAgLy8gc28gdGhleSB0cmFjayB2aXNpYmlsaXR5IHdpdGggbm8gYnVja2V0IG9yIG1ldGEta2V5IGludm9sdmVtZW50IC0tIGFuZFxuICAgICAgICAgICAgLy8gc2luY2UgZXZlcnkgcGxheWJhY2sgdGljayByZS1lbnRlcnMgdGhpcyBzeW5jLCBwYXNzaW5nIHRpbWVTdGF0ZSBtYWtlc1xuICAgICAgICAgICAgLy8gdGhlbSBmb2xsb3cgdGhlIHdpbmRvdyB0b286IGNoaXBzIGFwcGVhciBhbmQgdmFuaXNoIHdpdGggdGhlaXIgZmVhdHVyZXMuXG4gICAgICAgICAgICBpZiAobGFiZWxzR3JvdXApIHtcbiAgICAgICAgICAgICAgICByZW5kZXJMYWJlbHMoTCwgbGFiZWxzR3JvdXAsIGxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIGdyb3VwQ29uZmlncyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgbGVnZW5kQ2ZnID0gbW9kZWwuZ2V0KFwibGVnZW5kX2NvbmZpZ1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGlmIChtb2RlbC5nZXQoXCJzaG93X2xlZ2VuZFwiKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNwZWMgPSBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBsZWdlbmRDZmcpO1xuICAgICAgICAgICAgICAgIHJlbmRlckxlZ2VuZChsZWdlbmREaXYsIHNwZWMsXG4gICAgICAgICAgICAgICAgICAgIHsgZGltSGlkZGVuOiBsZWdlbmRDZmcuZGltX2hpZGRlbiAhPT0gZmFsc2UgfSk7XG4gICAgICAgICAgICAgICAgY29uc3QgcG9zID0gUE9TSVRJT05TW2xlZ2VuZENmZy5wb3NpdGlvbl0gfHwgUE9TSVRJT05TW1wiYm90dG9tLWxlZnRcIl07XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBvcykpIHtcbiAgICAgICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlW3Byb3BdID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gc3BlYy5ncm91cHMubGVuZ3RoID4gMCA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsZWdlbmREaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc29sZS50aW1lRW5kKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgbGV0IGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xuXG4gICAgICAgIC8vIERyYXcgLyBBT0kgdG9vbHM6IExlYWZsZXQtR2VvbWFuICh0aGUgbWFpbnRhaW5lZCBzdWNjZXNzb3IgdG8gTGVhZmxldC5kcmF3LFxuICAgICAgICAvLyB3aGljaCBicmVha3Mgb24gTGVhZmxldCAxLjkpLCBsb2FkZWQgZnJvbSB1bnBrZyBsaWtlIExlYWZsZXQgYW5kIGdsaWZ5IC0tXG4gICAgICAgIC8vIGxhemlseSwgb25seSB3aGVuIGEgbWFwIHR1cm5zIGRyYXdpbmcgb24sIHNvIGV2ZXJ5IG90aGVyIG1hcCBwYXlzIG5vdGhpbmcuXG4gICAgICAgIC8vIERyYXduIHNoYXBlcyBsaXZlIGluIHRoZWlyIG93biBmZWF0dXJlIGdyb3VwIGFuZCBzeW5jIHRvIFB5dGhvbiBhcyBHZW9KU09OXG4gICAgICAgIC8vIGZlYXR1cmVzIHVuZGVyIHRoZSBgZHJhd2luZ3NgIHRyYWl0LCB3aXRoIGBkcmF3X3NlcWAgYnVtcGluZyBwZXIgY2hhbmdlIHNvXG4gICAgICAgIC8vIG9uZSBvYnNlcnZlciBjYXRjaGVzIGNyZWF0ZSwgZWRpdCBhbmQgZGVsZXRlIGFsaWtlLiBUaGUgdHJhaXQgc3luY3MgYm90aFxuICAgICAgICAvLyB3YXlzOiBQeXRob24gY2FuIHNlZWQgQU9JcyBvciBjbGVhciB0aGVtLCBhbmQgZXhwb3J0cyBjYXJyeSB0aGUgZHJhd2luZ3MuXG4gICAgICAgIGxldCBkcmF3UmVhZHkgPSBmYWxzZTtcbiAgICAgICAgbGV0IGRyYXdpbmdzR3JvdXAgPSBudWxsO1xuICAgICAgICBsZXQgZHJhd0lkQ291bnRlciA9IDA7XG4gICAgICAgIGxldCBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xuXG4gICAgICAgIGZ1bmN0aW9uIGRyYXdpbmdUb0ZlYXR1cmUobCkge1xuICAgICAgICAgICAgY29uc3QgZ2ogPSBsLnRvR2VvSlNPTigpO1xuICAgICAgICAgICAgZ2oucHJvcGVydGllcyA9IHsgLi4uKGdqLnByb3BlcnRpZXMgfHwge30pLCBkcmF3X2lkOiBsLl9zd2lmdG1hcERyYXdJZCB9O1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBsLmdldFJhZGl1cyA9PT0gXCJmdW5jdGlvblwiICYmIGwgaW5zdGFuY2VvZiBMLkNpcmNsZSkge1xuICAgICAgICAgICAgICAgIGdqLnByb3BlcnRpZXMua2luZCA9IFwiY2lyY2xlXCI7XG4gICAgICAgICAgICAgICAgZ2oucHJvcGVydGllcy5yYWRpdXMgPSBsLmdldFJhZGl1cygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGdqO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gd3JpdGVEcmF3aW5ncygpIHtcbiAgICAgICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgICAgICBkcmF3aW5nc0dyb3VwLmVhY2hMYXllcihsID0+IGZlYXR1cmVzLnB1c2goZHJhd2luZ1RvRmVhdHVyZShsKSkpO1xuICAgICAgICAgICAgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSB0cnVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJkcmF3aW5nc1wiLCBmZWF0dXJlcyk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZHJhd19zZXFcIiwgKG1vZGVsLmdldChcImRyYXdfc2VxXCIpIHx8IDApICsgMSk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgZHJhd2luZ3Mgc3RpbGwgbGl2ZSBvbiB0aGUgbWFwICovIH1cbiAgICAgICAgICAgIHN1cHByZXNzRHJhd2luZ3NFY2hvID0gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBhZG9wdERyYXdpbmcobGF5ZXIpIHtcbiAgICAgICAgICAgIGlmICghbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkID0gYGRyYXdfJHsrK2RyYXdJZENvdW50ZXJ9YDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAuYWRkTGF5ZXIobGF5ZXIpO1xuICAgICAgICAgICAgbGF5ZXIub24oXCJwbTp1cGRhdGUgcG06ZHJhZ2VuZCBwbTpyb3RhdGVlbmRcIiwgd3JpdGVEcmF3aW5ncyk7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiByZWh5ZHJhdGVEcmF3aW5ncygpIHtcbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAuY2xlYXJMYXllcnMoKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgZmVhdHVyZSBvZiBtb2RlbC5nZXQoXCJkcmF3aW5nc1wiKSB8fCBbXSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHByb3BzID0gZmVhdHVyZS5wcm9wZXJ0aWVzIHx8IHt9O1xuICAgICAgICAgICAgICAgIGxldCBsYXllcjtcbiAgICAgICAgICAgICAgICBpZiAocHJvcHMua2luZCA9PT0gXCJjaXJjbGVcIiAmJiBmZWF0dXJlLmdlb21ldHJ5LnR5cGUgPT09IFwiUG9pbnRcIikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBbbG5nLCBsYXRdID0gZmVhdHVyZS5nZW9tZXRyeS5jb29yZGluYXRlcztcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXIgPSBMLmNpcmNsZShbbGF0LCBsbmddLCB7IHJhZGl1czogcHJvcHMucmFkaXVzIHx8IDEwMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiIH0pO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyID0gTC5nZW9KU09OKGZlYXR1cmUsIHsgcGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5nZXRMYXllcnMoKVswXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFsYXllcikgY29udGludWU7XG4gICAgICAgICAgICAgICAgbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkID0gcHJvcHMuZHJhd19pZCB8fCBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xuICAgICAgICAgICAgICAgIGFkb3B0RHJhd2luZyhsYXllcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzeW5jRHJhdygpIHtcbiAgICAgICAgICAgIGNvbnN0IHNob3cgPSBtb2RlbC5nZXQoXCJzaG93X2RyYXdcIik7XG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJkcmF3X2NvbmZpZ1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGlmIChzaG93ICYmICFkcmF3UmVhZHkpIHtcbiAgICAgICAgICAgICAgICBkcmF3UmVhZHkgPSB0cnVlO1xuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgR2VvbWFuIGNyZWF0ZXMgZ29lcyB0byB0aGUgcGFuZSBhYm92ZSB0aGUgR0wgc3RhY2suXG4gICAgICAgICAgICAgICAgbWFwLnBtLnNldEdsb2JhbE9wdGlvbnMoe1xuICAgICAgICAgICAgICAgICAgICBwYW5lczogeyBsYXllclBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2ZXJ0ZXhQYW5lOiBcIm1hcmtlclBhbmVcIiwgbWFya2VyUGFuZTogXCJtYXJrZXJQYW5lXCIgfSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBkcmF3aW5nc0dyb3VwID0gTC5mZWF0dXJlR3JvdXAoKS5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgIHJlaHlkcmF0ZURyYXdpbmdzKCk7XG4gICAgICAgICAgICAgICAgbWFwLm9uKFwicG06Y3JlYXRlXCIsIChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGFkb3B0RHJhd2luZyhlLmxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVEcmF3aW5ncygpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIG1hcC5vbihcInBtOnJlbW92ZVwiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvLyBHZW9tYW4gcmVtb3ZlcyB0aGUgbGF5ZXIgZnJvbSB0aGUgTUFQOyB0aGUgZmVhdHVyZSBncm91cCBzdGlsbFxuICAgICAgICAgICAgICAgICAgICAvLyBob2xkcyBpdCwgYW5kIHdyaXRlRHJhd2luZ3MgcmVhZHMgdGhlIGdyb3VwIC0tIGV2aWN0IGl0IGZpcnN0XG4gICAgICAgICAgICAgICAgICAgIC8vIG9yIHRoZSBkZWxldGlvbiBuZXZlciByZWFjaGVzIHRoZSB0cmFpdC5cbiAgICAgICAgICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5yZW1vdmVMYXllcihlLmxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVEcmF3aW5ncygpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmRyYXdpbmdzXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzdXBwcmVzc0RyYXdpbmdzRWNobykgcmVoeWRyYXRlRHJhd2luZ3MoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghZHJhd1JlYWR5KSByZXR1cm47XG4gICAgICAgICAgICBpZiAoc2hvdykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvb2xzID0gY2ZnLnRvb2xzXG4gICAgICAgICAgICAgICAgICAgIHx8IFtcIm1hcmtlclwiLCBcInBvbHlsaW5lXCIsIFwicmVjdGFuZ2xlXCIsIFwicG9seWdvblwiLCBcImNpcmNsZVwiXTtcbiAgICAgICAgICAgICAgICBtYXAucG0uYWRkQ29udHJvbHMoe1xuICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogKGNmZy5wb3NpdGlvbiB8fCBcInRvcC1sZWZ0XCIpLnJlcGxhY2UoXCItXCIsIFwiXCIpLFxuICAgICAgICAgICAgICAgICAgICBkcmF3TWFya2VyOiB0b29scy5pbmNsdWRlcyhcIm1hcmtlclwiKSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd1BvbHlsaW5lOiB0b29scy5pbmNsdWRlcyhcInBvbHlsaW5lXCIpLFxuICAgICAgICAgICAgICAgICAgICBkcmF3UmVjdGFuZ2xlOiB0b29scy5pbmNsdWRlcyhcInJlY3RhbmdsZVwiKSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd1BvbHlnb246IHRvb2xzLmluY2x1ZGVzKFwicG9seWdvblwiKSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd0NpcmNsZTogdG9vbHMuaW5jbHVkZXMoXCJjaXJjbGVcIiksXG4gICAgICAgICAgICAgICAgICAgIGRyYXdDaXJjbGVNYXJrZXI6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBkcmF3VGV4dDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHJvdGF0ZU1vZGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBjdXRQb2x5Z29uOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgZWRpdE1vZGU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGRyYWdNb2RlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICByZW1vdmFsTW9kZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbWFwLnBtLnJlbW92ZUNvbnRyb2xzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3luY0RyYXcoKTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19kcmF3XCIsIHN5bmNEcmF3KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6ZHJhd19jb25maWdcIiwgc3luY0RyYXcpO1xuXG4gICAgICAgIC8vIFRoZSBzY2FsZSBiYXI6IExlYWZsZXQncyBvd24gY29udHJvbCwgd2hpY2ggbWVhc3VyZXMgdGhyb3VnaCB0aGUgbWFwJ3MgQ1JTXG4gICAgICAgIC8vIChoYXZlcnNpbmUgdW5kZXIgMzg1NyBhbmQgNDMyNiBhbGlrZSAtLSBubyBwaXhlbCBtYXRoIG9mIG91cnMpLCBleHRlbmRlZFxuICAgICAgICAvLyB3aXRoIHRoZSB1bml0IExlYWZsZXQgbGFja3MgYW5kIHRoaXMgZG9tYWluIHJ1bnMgb246IG5hdXRpY2FsIG1pbGVzLlxuICAgICAgICBjb25zdCBOYXV0aWNhbFNjYWxlID0gTC5Db250cm9sLlNjYWxlLmV4dGVuZCh7XG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24gKG0pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjb250YWluZXIgPSBMLkNvbnRyb2wuU2NhbGUucHJvdG90eXBlLm9uQWRkLmNhbGwodGhpcywgbSk7XG4gICAgICAgICAgICAgICAgdGhpcy5fbmF1dGljYWxTY2FsZSA9IEwuRG9tVXRpbC5jcmVhdGUoXG4gICAgICAgICAgICAgICAgICAgIFwiZGl2XCIsIFwibGVhZmxldC1jb250cm9sLXNjYWxlLWxpbmVcIiwgY29udGFpbmVyKTtcbiAgICAgICAgICAgICAgICB0aGlzLl91cGRhdGUoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udGFpbmVyO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF91cGRhdGVTY2FsZXM6IGZ1bmN0aW9uIChtYXhNZXRlcnMpIHtcbiAgICAgICAgICAgICAgICBMLkNvbnRyb2wuU2NhbGUucHJvdG90eXBlLl91cGRhdGVTY2FsZXMuY2FsbCh0aGlzLCBtYXhNZXRlcnMpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9uYXV0aWNhbFNjYWxlICYmIG1heE1ldGVycykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhObSA9IG1heE1ldGVycyAvIDE4NTI7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5tID0gdGhpcy5fZ2V0Um91bmROdW0obWF4Tm0pO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl91cGRhdGVTY2FsZSh0aGlzLl9uYXV0aWNhbFNjYWxlLCBgJHtubX0gbm1gLCBubSAvIG1heE5tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgc2NhbGVDb250cm9sID0gbnVsbDtcbiAgICAgICAgZnVuY3Rpb24gc3luY1NjYWxlKCkge1xuICAgICAgICAgICAgaWYgKHNjYWxlQ29udHJvbCkge1xuICAgICAgICAgICAgICAgIHNjYWxlQ29udHJvbC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICBzY2FsZUNvbnRyb2wgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFtb2RlbC5nZXQoXCJzaG93X3NjYWxlXCIpKSByZXR1cm47XG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJzY2FsZV9jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCB1bml0cyA9IGNmZy51bml0cyB8fCBcIm1ldHJpY1wiO1xuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwb3NpdGlvbjogKGNmZy5wb3NpdGlvbiB8fCBcImJvdHRvbS1sZWZ0XCIpLnJlcGxhY2UoXCItXCIsIFwiXCIpLFxuICAgICAgICAgICAgICAgIG1heFdpZHRoOiBjZmcubWF4X3dpZHRoIHx8IDEyMCxcbiAgICAgICAgICAgICAgICBtZXRyaWM6IHVuaXRzID09PSBcIm1ldHJpY1wiIHx8IHVuaXRzID09PSBcImJvdGhcIixcbiAgICAgICAgICAgICAgICBpbXBlcmlhbDogdW5pdHMgPT09IFwiaW1wZXJpYWxcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgc2NhbGVDb250cm9sID0gdW5pdHMgPT09IFwibmF1dGljYWxcIlxuICAgICAgICAgICAgICAgID8gbmV3IE5hdXRpY2FsU2NhbGUob3B0aW9ucylcbiAgICAgICAgICAgICAgICA6IEwuY29udHJvbC5zY2FsZShvcHRpb25zKTtcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbC5hZGRUbyhtYXApO1xuICAgICAgICB9XG4gICAgICAgIHN5bmNTY2FsZSgpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzaG93X3NjYWxlXCIsIHN5bmNTY2FsZSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNjYWxlX2NvbmZpZ1wiLCBzeW5jU2NhbGUpO1xuXG4gICAgICAgIC8vIEVtcHR5LW1hcCBjbGlja3M6IHJlcG9ydCB3aGVyZS4gUmVnaXN0ZXJlZCB0aHJvdWdoIHRoZSBzYW1lIGFyYml0cmF0aW9uIHRoZVxuICAgICAgICAvLyBmZWF0dXJlIGhhbmRsZXJzIHVzZSwgYXQgdGhlIGxvd2VzdCBwcmlvcml0eSwgc28gYSBjbGljayB0aGF0IGhpdCBhIGZlYXR1cmVcbiAgICAgICAgLy8gc3RheXMgdGhhdCBmZWF0dXJlJ3MgY2xpY2sgLS0gdGhpcyB3aW5zIG9ubHkgd2hlbiBub3RoaW5nIGNsYWltZWQgdGhlIGV2ZW50LlxuICAgICAgICAvLyBlLmxhdGxuZyBpcyBhbHJlYWR5IHVucHJvamVjdGVkIHRocm91Z2ggd2hpY2hldmVyIENSUyB0aGUgbWFwIHJ1bnMgKDM4NTcgYW5kXG4gICAgICAgIC8vIDQzMjYgYWxpa2UpLCBzbyB0aGVyZSBpcyBubyBwaXhlbCBtYXRoIHRvIGdldCB3cm9uZyBoZXJlOyB3cmFwKCkga2VlcHMgYVxuICAgICAgICAvLyB3b3JsZC1wYW5uZWQgbWFwIGZyb20gcmVwb3J0aW5nIGxvbmdpdHVkZSAtMzY0LlxuICAgICAgICBtYXAub24oXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgICAgLy8gU3RhbXBlZCBzeW5jaHJvbm91c2x5LCBiZWZvcmUgYW55IGdsaWZ5IGhhbmRsZXIgcmVnaXN0ZXJzIGl0cyBtYXRjaFxuICAgICAgICAgICAgLy8gKHRoaXMgaGFuZGxlciB3YXMgYm91bmQgZmlyc3QsIHNvIExlYWZsZXQgcnVucyBpdCBmaXJzdCk6IHRoZSB3aG9sZVxuICAgICAgICAgICAgLy8gY2xpY2sgcGlwZWxpbmUgLS0gZmVhdHVyZSBwb3B1cHMgYW5kIHRoaXMgZmFsbGJhY2sgYWxpa2UgLS0gc3RhbmRzXG4gICAgICAgICAgICAvLyBkb3duIHdoaWxlIGEgR2VvbWFuIG1vZGUgaXMgYXJtZWQuIERlZmVycmVkIGNoZWNrcyBtaXNzIG1vZGVzIHRoYXRcbiAgICAgICAgICAgIC8vIGNsb3NlIHRoZW1zZWx2ZXMgb24gdGhlaXIgZmluaXNoaW5nIGNsaWNrIChhIGNvbXBsZXRlZCByZWN0YW5nbGUpLFxuICAgICAgICAgICAgLy8gd2hpY2ggaXMgd2h5IHRoZSBzdGF0ZSBpcyBjYXB0dXJlZCBhdCBjbGljayB0aW1lLlxuICAgICAgICAgICAgY29uc3QgcG0gPSBtYXAucG07XG4gICAgICAgICAgICBtYXAuX3BtTW9kZUFjdGl2ZSA9IEJvb2xlYW4ocG1cbiAgICAgICAgICAgICAgICAmJiAoKHBtLmdsb2JhbFJlbW92YWxNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxSZW1vdmFsTW9kZUVuYWJsZWQoKSlcbiAgICAgICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbEVkaXRNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxFZGl0TW9kZUVuYWJsZWQoKSlcbiAgICAgICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbERyYWdNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxEcmFnTW9kZUVuYWJsZWQoKSlcbiAgICAgICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbERyYXdNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxEcmF3TW9kZUVuYWJsZWQoKSkpKTtcbiAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDk5LCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGwgPSBlLmxhdGxuZy53cmFwKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gTWF0aC5yb3VuZChsbC5sYXQgKiAxZTUpIC8gMWU1O1xuICAgICAgICAgICAgICAgIGNvbnN0IGxuZyA9IE1hdGgucm91bmQobGwubG5nICogMWU1KSAvIDFlNTtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIFwiXCIpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAtMSk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF0bG5nXCIsIFtsYXQsIGxuZ10pO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja19zZXFcIiwgKG1vZGVsLmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cbiAgICAgICAgICAgICAgICBpZiAobW9kZWwuZ2V0KFwic2hvd19jbGlja19jb29yZGluYXRlc1wiKSkge1xuICAgICAgICAgICAgICAgICAgICBMLnBvcHVwKHsgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWNvb3Jkcy1wb3B1cFwiLCBjbG9zZUJ1dHRvbjogZmFsc2UgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5zZXRMYXRMbmcoZS5sYXRsbmcpXG4gICAgICAgICAgICAgICAgICAgICAgICAuc2V0Q29udGVudChgJHtsbC5sYXQudG9GaXhlZCg1KX0sICR7bGwubG5nLnRvRml4ZWQoNSl9YClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5vcGVuT24obWFwKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQmluZCB6b29tIGFuZCBjZW50ZXIgY2hhbmdlcyBiYWNrIHRvIFB5dGhvbiBzYWZlbHlcbiAgICAgICAgbWFwLm9uKFwibW92ZWVuZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50Wm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxDZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxab29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1vZGVsWm9vbSAhPT0gY3VycmVudFpvb207XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9ICFtb2RlbENlbnRlciB8fCBcbiAgICAgICAgICAgICAgICAgICAgIUFycmF5LmlzQXJyYXkobW9kZWxDZW50ZXIpIHx8XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsQ2VudGVyLmxlbmd0aCA8IDIgfHxcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMF0gLSBjZW50ZXIubGF0KSA+IDAuMDAwMSB8fCBcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMV0gLSBjZW50ZXIubG5nKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjZW50ZXJcIiwgW2NlbnRlci5sYXQsIGNlbnRlci5sbmddKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInpvb21cIiwgY3VycmVudFpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBzYWZlU2F2ZUNoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gbW92ZWVuZCBoYW5kbGVyOlwiLCBlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVNYXBWaWV3KCkge1xuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xuICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICBpZiAoY2VudGVyICYmIEFycmF5LmlzQXJyYXkoY2VudGVyKSAmJiBjZW50ZXIubGVuZ3RoID49IDIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBDZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgbWFwWm9vbSA9IG1hcC5nZXRab29tKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9IE1hdGguYWJzKG1hcENlbnRlci5sYXQgLSBjZW50ZXJbMF0pID4gMC4wMDAxIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtYXBDZW50ZXIubG5nIC0gY2VudGVyWzFdKSA+IDAuMDAwMTtcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1hcFpvb20gIT09IHpvb207XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFZpZXcoY2VudGVyLCB0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiA/IHpvb20gOiBtYXBab29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiAmJiBtYXAuZ2V0Wm9vbSgpICE9PSB6b29tKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKHpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdhdGNoIGZvciBtYXAgdmlldyB1cGRhdGVzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNlbnRlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ0NlbnRlckZyb21NYXApIHtcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnpvb21cIiwgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVXBkYXRpbmdab29tRnJvbU1hcCkge1xuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIEZpdHRpbmcgdGhlIHZpZXcgaXMgYSBjb21tYW5kLCBub3Qgc3RhdGU6IGFza2luZyB0byBmaXQgdGhlIHNhbWUgYm91bmRzIHR3aWNlXG4gICAgICAgIC8vIG11c3QgbW92ZSB0aGUgbWFwIGJvdGggdGltZXMsIHNpbmNlIHRoZSB1c2VyIG1heSBoYXZlIHBhbm5lZCBhd2F5IGluIGJldHdlZW4uXG4gICAgICAgIC8vIFRoZSByZXF1ZXN0IGNhcnJpZXMgYSBzZXF1ZW5jZSBudW1iZXIgc28gYW4gaWRlbnRpY2FsIGZpdCBzdGlsbCBmaXJlcyBhIGNoYW5nZS5cbiAgICAgICAgZnVuY3Rpb24gYXBwbHlGaXRSZXF1ZXN0KCkge1xuICAgICAgICAgICAgY29uc3QgcmVxID0gbW9kZWwuZ2V0KFwiZml0X2JvdW5kc19yZXF1ZXN0XCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgYm91bmRzID0gcmVxLmJvdW5kcztcbiAgICAgICAgICAgIGlmICghYm91bmRzIHx8IGJvdW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgICAgICAgICAgaWYgKHJlcS5wYWRkaW5nICE9IG51bGwpIG9wdGlvbnMucGFkZGluZyA9IFtyZXEucGFkZGluZywgcmVxLnBhZGRpbmddO1xuICAgICAgICAgICAgaWYgKHJlcS5tYXhfem9vbSAhPSBudWxsKSBvcHRpb25zLm1heFpvb20gPSByZXEubWF4X3pvb207XG4gICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcywgb3B0aW9ucyk7XG5cbiAgICAgICAgICAgIC8vIEFwcGxpZWQgYWZ0ZXIgdGhlIGZpdCwgc2luY2UgaXQgaXMgcmVsYXRpdmUgdG8gd2hhdGV2ZXIgem9vbSB0aGUgZml0IGNob3NlLlxuICAgICAgICAgICAgaWYgKHJlcS56b29tX29mZnNldCkge1xuICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKG1hcC5nZXRab29tKCkgKyByZXEuem9vbV9vZmZzZXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmZpdF9ib3VuZHNfcmVxdWVzdFwiLCBhcHBseUZpdFJlcXVlc3QpO1xuICAgICAgICAvLyBBIHJlcXVlc3Qgc2V0IGJlZm9yZSB0aGlzIHZpZXcgYXR0YWNoZWQgLS0gYSBwcmUtZGlzcGxheSBmaXRfYm91bmRzKCkgY2FsbCxcbiAgICAgICAgLy8gb3IgdGhlIHVuaW9uIGEgZnJlc2ggbWFwIG1haW50YWlucyBhcyBhdXRvLWZpdCB3aGlsZSBsYXllcnMgYXJlIGFkZGVkIC0tIGlzXG4gICAgICAgIC8vIGFscmVhZHkgc3RhdGUgYnkgbm93LCBzbyB0aGUgY2hhbmdlIGV2ZW50IHdpbGwgbmV2ZXIgZmlyZSBmb3IgaXQuIEl0IHVzZWRcbiAgICAgICAgLy8gdG8gYmUgc2lsZW50bHkgZHJvcHBlZDsgYXBwbHkgaXQgb25jZSB0aGUgbWFwIGlzIHJlYWR5IGluc3RlYWQuXG4gICAgICAgIG1hcC53aGVuUmVhZHkoKCkgPT4gYXBwbHlGaXRSZXF1ZXN0KCkpO1xuICAgICAgICAvLyBBIG1hcCBjb25zdHJ1Y3RlZCBpbnNpZGUgYSBoaWRkZW4gY29udGFpbmVyIC0tIGEgU2hpbnkgbmF2X3BhbmVsIHRoYXQgaXNcbiAgICAgICAgLy8gbm90IHRoZSBzZWxlY3RlZCB0YWIgLS0gaW5pdGlhbGlzZXMgYXQgMHgwLCBhbmQgTGVhZmxldCBjYWNoZXMgdGhhdCBzaXplOlxuICAgICAgICAvLyBpdHMgb3duIHRyYWNrUmVzaXplIHdhdGNoZXMgdGhlIFdJTkRPVywgbm90IHRoZSBjb250YWluZXIsIHNvIG5vdGhpbmcgZXZlclxuICAgICAgICAvLyBjb3JyZWN0cyBpdC4gVGhlIGZpdCBhYm92ZSB0aGVuIGNvbXB1dGVzIGl0cyB6b29tIGZyb20gYSB6ZXJvLXNpemUgbGllIGFuZFxuICAgICAgICAvLyB0aGUgdmlldyBsYW5kcyB3cm9uZyBwZXJtYW5lbnRseS4gV2F0Y2ggdGhlIGNvbnRhaW5lciBpdHNlbGY6IGV2ZXJ5IHJlc2l6ZVxuICAgICAgICAvLyByZS1tZWFzdXJlcywgYW5kIHRoZSBmaXJzdCB0cmFuc2l0aW9uIGZyb20gemVybyB0byByZWFsIHNpemUgcmUtYXBwbGllc1xuICAgICAgICAvLyB0aGUgcGVuZGluZyBmaXQgd2l0aCBhIHNpemUgdGhhdCBjYW4gYWN0dWFsbHkgaG9sZCBpdC5cbiAgICAgICAgaWYgKHR5cGVvZiBSZXNpemVPYnNlcnZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgbGV0IGhhZFNpemUgPSBjb250YWluZXIuY2xpZW50V2lkdGggPiAwICYmIGNvbnRhaW5lci5jbGllbnRIZWlnaHQgPiAwO1xuICAgICAgICAgICAgY29uc3QgY29udGFpbmVyUmVzaXplID0gbmV3IFJlc2l6ZU9ic2VydmVyKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBoYXNTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcbiAgICAgICAgICAgICAgICBpZiAoaGFzU2l6ZSkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuaW52YWxpZGF0ZVNpemUoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFoYWRTaXplKSBhcHBseUZpdFJlcXVlc3QoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaGFkU2l6ZSA9IGhhc1NpemU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lclJlc2l6ZS5vYnNlcnZlKGNvbnRhaW5lcik7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgc3luY1RpbWVvdXQgPSBudWxsO1xuICAgICAgICBsZXQgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgIGxldCBuZWVkc1N5bmMgPSBmYWxzZTtcblxuICAgICAgICBhc3luYyBmdW5jdGlvbiBwZXJmb3JtU3luYygpIHtcbiAgICAgICAgICAgIGlmIChpc1N5bmNpbmcpIHtcbiAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlzU3luY2luZyA9IHRydWU7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHN5bmNNYXBTdGF0ZSgpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIHN5bmNNYXBTdGF0ZTpcIiwgZXJyKTtcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYgKG5lZWRzU3luYykge1xuICAgICAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBxdWV1ZVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoIW1vZGVsLmdldChcImF1dG9fc3luY1wiKSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzeW5jVGltZW91dCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzeW5jVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSwgNTApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTGlzdGVuIGZvciBtYW51YWwgc3luYyB0cmlnZ2VyIGNoYW5nZXMgZnJvbSBQeXRob25cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c3luY190cmlnZ2VyXCIsICgpID0+IHtcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEluY3JlbWVudGFsIHVwZGF0ZXMgZnJvbSBQeXRob24uIEFwcGxpZWQgZXZlbiB3aGVuIGF1dG9fc3luYyBpcyBvZmYgc28gdGhlIG1pcnJvclxuICAgICAgICAvLyBzdGF5cyBjdXJyZW50OyBxdWV1ZVN5bmMgZGVjaWRlcyB3aGV0aGVyIHRvIGFjdHVhbGx5IHJlLXJlbmRlci5cbiAgICAgICAgbW9kZWwub24oXCJtc2c6Y3VzdG9tXCIsIChtc2csIGJ1ZmZlcnMpID0+IHtcbiAgICAgICAgICAgIGlmICghbXNnIHx8IG1zZy5raW5kICE9PSBcInN3aWZ0bWFwX3BhdGNoXCIpIHJldHVybjtcbiAgICAgICAgICAgIGFwcGx5UGF0Y2hPcHMobXNnLm9wcyB8fCBbXSwgYnVmZmVycyk7XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRnVsbC1zbmFwc2hvdCBwYXRoczogdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSwgYW5kIHRoZSBzaWRlYmFyIHdyaXRpbmcgYGxheWVyc2BcbiAgICAgICAgLy8gYmFjayBhZnRlciBhIHRvZ2dsZS4gRWl0aGVyIHdheSB0aGUgdHJhaXQgYmVjb21lcyBhdXRob3JpdGF0aXZlIGFnYWluLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsYXllcnNcIiwgKCkgPT4ge1xuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Y29vcmRpbmF0ZV9idWZmZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpncm91cF9jb25maWdzXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnRpbWVfY29uZmlnXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7ICAgLy8gcmUtYXBwbHkgc3BlZWQvbG9vcCBmcm9tIHRoZSBuZXcgY29uZmlnXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIFB5dGhvbiBzdGVlcmluZyB0aGUgc2xpZGVyOiBzbmFwIHRvIHRoZSBuZWFyZXN0IHRpY2sgYXQgb3IgYWZ0ZXIgdGhlIHJlcXVlc3RlZFxuICAgICAgICAvLyB0aW1lLiBHdWFyZGVkIHNvIHRoZSB3aWRnZXQncyBvd24gd3JpdGViYWNrIGRvZXMgbm90IGxvb3AgdGhyb3VnaCBoZXJlLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2N1cnJlbnRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgd2FudGVkID0gbW9kZWwuZ2V0KFwidGltZV9jdXJyZW50XCIpO1xuICAgICAgICAgICAgaWYgKCF0aW1lU3RhdGUgfHwgIXRpbWVVSS50aWNrcy5sZW5ndGgpIHJldHVybjtcbiAgICAgICAgICAgIGlmIChNYXRoLmFicyh3YW50ZWQgLSB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSkgPCAxKSByZXR1cm47XG4gICAgICAgICAgICBsZXQgaWR4ID0gdGltZVVJLnRpY2tzLmZpbmRJbmRleCh0ID0+IHQgPj0gd2FudGVkKTtcbiAgICAgICAgICAgIGlmIChpZHggPT09IC0xKSBpZHggPSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMTtcbiAgICAgICAgICAgIHNlZWtUbyhpZHgsIHsgd3JpdGU6IGZhbHNlIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19sb2dvXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbGVnZW5kXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmxlZ2VuZF9jb25maWdcIiwgcXVldWVTeW5jKTtcbiAgICAgICAgLy8gTGl2ZSByZXNpemVzIChhIFNoaW55IGxheW91dCwgYSBub3RlYm9vayBjZWxsKTogTGVhZmxldCBjYWNoZXMgaXRzIGJveCwgc29cbiAgICAgICAgLy8gaXQgbXVzdCBiZSB0b2xkIHRvIHJlLW1lYXN1cmUgb3IgdGlsZXMgcmVuZGVyIGZvciB0aGUgb2xkIHNpemUuXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmhlaWdodFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBhcHBseUhlaWdodCgpO1xuICAgICAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFubm91bmNlIHRoaXMgdmlldyBzbyBQeXRob24gcmVwbGllcyB3aXRoIGEgZnVsbCBzbmFwc2hvdC4gTGF5ZXJzIGFkZGVkIGJlZm9yZVxuICAgICAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXG4gICAgICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBtb2RlbC5zZW5kKHsga2luZDogXCJzd2lmdG1hcF9yZWFkeVwiIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGlzIGFsbCB0aGVyZSBpcyAqLyB9XG5cbiAgICAgICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcbiAgICAgICAgaWYgKG1vZGVsLmdldChcImF1dG9fc3luY1wiKSB8fCBtb2RlbC5nZXQoXCJzeW5jX3RyaWdnZXJcIikgPiAwKSB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBTyxTQUFTLFFBQVEsSUFBSSxLQUFLO0FBQzdCLE1BQUksQ0FBQyxTQUFTLGVBQWUsRUFBRSxHQUFHO0FBQzlCLFVBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTTtBQUMxQyxTQUFLLEtBQUs7QUFDVixTQUFLLE1BQU07QUFDWCxTQUFLLE9BQU87QUFDWixhQUFTLEtBQUssWUFBWSxJQUFJO0FBQUEsRUFDbEM7QUFDSjtBQUVBLElBQU0sZ0JBQWdCLENBQUM7QUFFaEIsU0FBUyxPQUFPLElBQUksS0FBSztBQUM1QixNQUFJLGNBQWMsRUFBRSxHQUFH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QU8sTUFBTSxPQUFRO0FBQ3hDLFVBQUksS0FBSyxJQUFJLFNBQVMsT0FBTyxNQUFNLE9BQU8sS0FBSyxDQUFDLElBQUksRUFBRztBQUN2RCxVQUFJLE1BQU0sT0FBTyxNQUFNLFVBQVUsT0FBSyxLQUFLLE1BQU07QUFDakQsVUFBSSxRQUFRLEdBQUksT0FBTSxPQUFPLE1BQU0sU0FBUztBQUM1QyxhQUFPLEtBQUssRUFBRSxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQ2hDLENBQUM7QUFDRCxVQUFNLEdBQUcsb0JBQW9CLFNBQVM7QUFDdEMsVUFBTSxHQUFHLHNCQUFzQixTQUFTO0FBQ3hDLFVBQU0sR0FBRyx3QkFBd0IsU0FBUztBQUcxQyxVQUFNLEdBQUcsaUJBQWlCLE1BQU07QUFDNUIsa0JBQVk7QUFDWixVQUFJLGVBQWU7QUFBQSxJQUN2QixDQUFDO0FBS0QsUUFBSTtBQUNBLFlBQU0sS0FBSyxFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFBQSxJQUN6QyxTQUFTLEtBQUs7QUFBQSxJQUFtRTtBQUdqRixRQUFJLE1BQU0sSUFBSSxXQUFXLEtBQUssTUFBTSxJQUFJLGNBQWMsSUFBSSxHQUFHO0FBQ3pELGtCQUFZO0FBQUEsSUFDaEI7QUFBQSxFQUNKO0FBQ0o7IiwKICAibmFtZXMiOiBbImNvdW50IiwgImdsTGF5ZXIiLCAiaW5zdGFuY2UiLCAiTCIsICJjb250YWluZXIiLCAiem9vbSJdCn0K
