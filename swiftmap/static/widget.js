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
      const show = Boolean(model.get("show_logo"));
      logoDiv.style.display = show ? "block" : "none";
      logoDiv.replaceChildren();
      if (!show) return;
      const cfg = model.get("logo_config") || {};
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
    model.on("change:logo_config", syncLogo);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3NoYWRlcnMuanMiLCAiLi4vLi4vc3JjL3RpbWVjb250cm9sLmpzIiwgIi4uLy4uL3NyYy9ncHV0aW1lLmpzIiwgIi4uLy4uL3NyYy9sYXllcnMuanMiLCAiLi4vLi4vc3JjL2xhYmVscy5qcyIsICIuLi8uLi9zcmMvbWFwLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgZnVuY3Rpb24gbG9hZENTUyhpZCwgdXJsKSB7XG4gICAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgY29uc3QgbGluayA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJsaW5rXCIpO1xuICAgICAgICBsaW5rLmlkID0gaWQ7XG4gICAgICAgIGxpbmsucmVsID0gXCJzdHlsZXNoZWV0XCI7XG4gICAgICAgIGxpbmsuaHJlZiA9IHVybDtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChsaW5rKTtcbiAgICB9XG59XG5cbmNvbnN0IGFjdGl2ZUxvYWRlcnMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKUyhpZCwgdXJsKSB7XG4gICAgaWYgKGFjdGl2ZUxvYWRlcnNbaWRdKSB7XG4gICAgICAgIHJldHVybiBhY3RpdmVMb2FkZXJzW2lkXTtcbiAgICB9XG4gICAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgaWYgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzY3JpcHRcIik7XG4gICAgICAgIHNjcmlwdC5pZCA9IGlkO1xuICAgICAgICBzY3JpcHQuc3JjID0gdXJsO1xuICAgICAgICBzY3JpcHQub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xuICAgICAgICBzY3JpcHQub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIHNjcmlwdDogJHt1cmx9YCkpO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHNjcmlwdCk7XG4gICAgfSk7XG4gICAgYWN0aXZlTG9hZGVyc1tpZF0gPSBwcm9taXNlO1xuICAgIHJldHVybiBwcm9taXNlO1xufVxuXG5mdW5jdGlvbiBoZXhUb1JnYihoZXgpIHtcbiAgICBpZiAoIWhleCkgcmV0dXJuIG51bGw7XG4gICAgaGV4ID0gaGV4LnJlcGxhY2UoL14jLywgJycpO1xuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XG4gICAgICAgIGhleCA9IGhleC5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhciArIGNoYXIpLmpvaW4oJycpO1xuICAgIH1cbiAgICBpZiAoaGV4Lmxlbmd0aCAhPT0gNikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbnVtID0gcGFyc2VJbnQoaGV4LCAxNik7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcjogKChudW0gPj4gMTYpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgZzogKChudW0gPj4gOCkgJiAyNTUpIC8gMjU1LFxuICAgICAgICBiOiAobnVtICYgMjU1KSAvIDI1NVxuICAgIH07XG59XG5cbmxldCBjb2xvclByb2JlID0gbnVsbDtcblxuLy8gQnJvd3NlcnMgc2hpcCBhIGNvbXBsZXRlIENTUyBjb2xvciBwYXJzZXIgLS0gZXZlcnkgbmFtZWQgY29sb3IsIHJnYigpLCBoc2woKSwgaHdiKCkuXG4vLyBCb3Jyb3cgaXQgaW5zdGVhZCBvZiBtYWludGFpbmluZyBhIGxvb2t1cCB0YWJsZS4gUmV0dXJucyBudWxsIG91dHNpZGUgYSBET00gKE5vZGUgdGVzdHMpLFxuLy8gd2hlcmUgdGhlIGhleCBmYWxsYmFjayBpbiBwYXJzZUNvbG9yIHN0aWxsIGFwcGxpZXMuXG5mdW5jdGlvbiBjc3NDb2xvclRvUmdiKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFjb2xvclByb2JlKSBjb2xvclByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKS5nZXRDb250ZXh0KFwiMmRcIik7XG5cbiAgICAvLyBBc3NpZ25pbmcgYW4gaW52YWxpZCBjb2xvciBsZWF2ZXMgZmlsbFN0eWxlIHVudG91Y2hlZCwgc28gcHJvYmUgYWdhaW5zdCB0d28gZGlmZmVyZW50XG4gICAgLy8gc2VudGluZWxzOiBvbmx5IGEgdmFsdWUgdGhlIGJyb3dzZXIgYWN0dWFsbHkgcGFyc2VkIHByb2R1Y2VzIHRoZSBzYW1lIHJlc3VsdCB0d2ljZS5cbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiIzAwMDAwMFwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgY29uc3QgZmlyc3QgPSBjb2xvclByb2JlLmZpbGxTdHlsZTtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiI2ZmZmZmZlwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgaWYgKGZpcnN0ICE9PSBjb2xvclByb2JlLmZpbGxTdHlsZSkgcmV0dXJuIG51bGw7XG5cbiAgICBpZiAoZmlyc3Quc3RhcnRzV2l0aChcIiNcIikpIHJldHVybiBoZXhUb1JnYihmaXJzdCk7XG4gICAgY29uc3QgbWF0Y2ggPSBmaXJzdC5tYXRjaCgvcmdiYT9cXCgoW14pXSspXFwpLyk7XG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcGFydHMgPSBtYXRjaFsxXS5zcGxpdChcIixcIikubWFwKHAgPT4gcGFyc2VGbG9hdChwLnRyaW0oKSkpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzIHx8IHBhcnRzLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsgcjogcGFydHNbMF0gLyAyNTUsIGc6IHBhcnRzWzFdIC8gMjU1LCBiOiBwYXJ0c1syXSAvIDI1NSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb2xvcihjb2xvclN0ciwgZmFsbGJhY2tIZXggPSBcIiMzMzg4ZmZcIikge1xuICAgIGlmICghY29sb3JTdHIpIGNvbG9yU3RyID0gZmFsbGJhY2tIZXg7XG4gICAgcmV0dXJuIGNzc0NvbG9yVG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGhleFRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBjc3NDb2xvclRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCBoZXhUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG59XG5cbmNvbnN0IFVSTF9BVFRSX0JFRk9SRSA9IC8oPzpocmVmfHNyYylcXHMqPVxccypbJ1wiXT8kL2k7XG5jb25zdCBTQUZFX1VSTCA9IC9eKD86aHR0cHM/OlxcL1xcL3xtYWlsdG86fHRlbDp8ZGF0YTppbWFnZVxcL3xbLi8jP118W1xcdy4tXSsoPzpbLz8jXXwkKSkvaTtcblxuLy8gUHJvcGVydHkgdmFsdWVzIGNvbWUgZnJvbSB1c2VyIGRhdGEgYW5kIGVuZCB1cCBpbiBpbm5lckhUTUwsIHNvIHRoZXkgYXJlIGVzY2FwZWQuXG4vLyBNYXJrdXAgdGhlIGFwcCBhdXRob3Igd3JvdGUgKHRlbXBsYXRlcywgc3R5bGUgc3RyaW5ncykgaXMgbGVmdCBpbnRhY3QuXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpXG4gICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcbn1cblxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXG4vLyBpbiBhIFVSTCBhdHRyaWJ1dGUgZ2V0IGEgc2NoZW1lIGNoZWNrLiBDb250cm9sIGNoYXJhY3RlcnMgYXJlIHN0cmlwcGVkIGZpcnN0IGJlY2F1c2Vcbi8vIFwiamF2YVxcdHNjcmlwdDpcIiBzdXJ2aXZlcyBhIG5haXZlIGNvbXBhcmlzb24uXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZSkge1xuICAgIGNvbnN0IGNvbGxhcHNlZCA9IFN0cmluZyh2YWx1ZSkuc3BsaXQoXCJcIikuZmlsdGVyKGMgPT4gYy5jaGFyQ29kZUF0KDApID4gMzIpLmpvaW4oXCJcIik7XG4gICAgcmV0dXJuIFNBRkVfVVJMLnRlc3QoY29sbGFwc2VkKSA/IFN0cmluZyh2YWx1ZSkgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICBjb25zdCB0YXJnZXRGaWVsZHMgPSAoQXJyYXkuaXNBcnJheShmaWVsZHMpICYmIGZpZWxkcy5sZW5ndGgpID8gZmllbGRzIDogT2JqZWN0LmtleXMocHJvcHMpO1xuICAgIGNvbnN0IGxhYmVscyA9IChBcnJheS5pc0FycmF5KG5hbWVzKSAmJiBuYW1lcy5sZW5ndGggPT09IHRhcmdldEZpZWxkcy5sZW5ndGgpID8gbmFtZXMgOiB0YXJnZXRGaWVsZHM7XG4gICAgY29uc3QgbGluZXMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldEZpZWxkcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBmID0gdGFyZ2V0RmllbGRzW2ldO1xuICAgICAgICBpZiAocHJvcHNbZl0gPT09IHVuZGVmaW5lZCB8fCBwcm9wc1tmXSA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGxpbmVzLnB1c2goYDxiPiR7ZXNjYXBlSHRtbChsYWJlbHNbaV0pfTwvYj46ICR7ZXNjYXBlSHRtbChwcm9wc1tmXSl9YCk7XG4gICAgfVxuICAgIHJldHVybiBsaW5lcy5qb2luKFwiPGJyPlwiKTtcbn1cblxuLy8gXCJ7Y29sdW1ufVwiIGluc2VydHMgb25lIGVzY2FwZWQgdmFsdWU7IFwieyp9XCIgaW5zZXJ0cyB0aGUgZGVmYXVsdCBmaWVsZCBsaXN0LlxuZnVuY3Rpb24gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlLnJlcGxhY2UoL1xceyhcXCp8XFx3KylcXH0vZywgKG1hdGNoLCBrZXksIG9mZnNldCkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcIipcIikge1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2YWwgPSBwcm9wc1trZXldO1xuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgICAgICAgY29uc3QgcHJlY2VkaW5nID0gdGVtcGxhdGUuc2xpY2UoTWF0aC5tYXgoMCwgb2Zmc2V0IC0gMTYpLCBvZmZzZXQpO1xuICAgICAgICByZXR1cm4gZXNjYXBlSHRtbChVUkxfQVRUUl9CRUZPUkUudGVzdChwcmVjZWRpbmcpID8gc2FmZVVybCh2YWwpIDogdmFsKTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBraW5kKSB7XG4gICAgY29uc3QgdGVtcGxhdGUgPSBsYXllcltraW5kICsgXCJfdGVtcGxhdGVcIl07XG4gICAgY29uc3QgZmllbGRzID0gbGF5ZXJba2luZCArIFwiX2ZpZWxkc1wiXTtcbiAgICBjb25zdCBuYW1lcyA9IGxheWVyW2tpbmQgKyBcIl9uYW1lc1wiXTtcbiAgICBpZiAodHlwZW9mIHRlbXBsYXRlID09PSBcInN0cmluZ1wiICYmIHRlbXBsYXRlKSB7XG4gICAgICAgIHJldHVybiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgIH1cbiAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xufVxuXG5mdW5jdGlvbiB3cmFwU3R5bGVkKGh0bWwsIHN0eWxlKSB7XG4gICAgaWYgKCFzdHlsZSkgcmV0dXJuIGh0bWw7XG4gICAgcmV0dXJuIGA8ZGl2IHN0eWxlPVwiJHtlc2NhcGVIdG1sKHN0eWxlKX1cIj4ke2h0bWx9PC9kaXY+YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQb3B1cChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInBvcHVwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF9wb3B1cCB8fCBsYXllci5wb3B1cF9maWVsZHMgfHwgbGF5ZXIucG9wdXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgaWYgKGxheWVyLnBvcHVwX21heF93aWR0aCkgb3B0aW9ucy5tYXhXaWR0aCA9IGxheWVyLnBvcHVwX21heF93aWR0aDtcbiAgICAgICAgTC5wb3B1cChvcHRpb25zKVxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnBvcHVwX3N0eWxlKSlcbiAgICAgICAgICAgIC5vcGVuT24obWFwKTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kVG9vbHRpcChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyLCBsYXllckluc3RhbmNlKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInRvb2x0aXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3Rvb2x0aXAgfHwgbGF5ZXIudG9vbHRpcF9maWVsZHMgfHwgbGF5ZXIudG9vbHRpcF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgaWYgKCFsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwID0gTC50b29sdGlwKHsgZGlyZWN0aW9uOiAndG9wJywgb2Zmc2V0OiBbMCwgLTVdIH0pO1xuICAgICAgICB9XG4gICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXBcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci50b29sdGlwX3N0eWxlKSlcbiAgICAgICAgICAgIC5hZGRUbyhtYXApO1xuICAgIH1cbn1cbiIsICJjb25zdCBjb2xsYXBzZWRQYXRocyA9IHt9OyAgLy8gcGF0aCAtPiBjb2xsYXBzZWQ/XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJCb3VuZHMobCwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmICghbCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgLy8gU3VwcG9ydCBmb2xkZXIgdHJlZSBub2RlcyAoZ3JvdXBzIGluIHNpZGViYXIgdHJlZSlcclxuICAgIGlmIChsLmlzR3JvdXApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZHJlbiBncm91cHNcclxuICAgICAgICBPYmplY3Qua2V5cyhsLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhsLmNoaWxkcmVuW2tleV0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGQgbGF5ZXJzXHJcbiAgICAgICAgbC5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobHlyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChsLmJvdW5kcyAmJiBsLmJvdW5kcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgcmV0dXJuIGwuYm91bmRzO1xyXG4gICAgfVxyXG4gICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbC5sYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobC5sb2NhdGlvbnMgJiYgbC5sb2NhdGlvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IGwubG9jYXRpb25zLmZsYXQoSW5maW5pdHkpO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpXTtcclxuICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKyAxXTtcclxuICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdO1xyXG4gICAgICAgIGlmIChidWYpIHtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShidWYuYnVmZmVyLCBidWYuYnl0ZU9mZnNldCwgYnVmLmJ5dGVMZW5ndGggLyA4KTtcclxuICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGggLyAyOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpICogMl07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBUaGUgd3JpdGUgaGFsZiBvZiBhIHZpc2liaWxpdHkgdG9nZ2xlOiBvbmUgY3VzdG9tIG1lc3NhZ2UgbmFtaW5nIHRoZSBmbGlwcGVkIGlkcyxcclxuLy8gaW5zdGVhZCBvZiB0aGUgd2hvbGUgbGF5ZXJzIHRyYWl0LiBQeXRob24gYXBwbGllcyB0aGUgZmllbGRzIGFuZCByZS1lbWl0cyB0aGVtIGFzXHJcbi8vIGBzZXRgIHBhdGNoIG9wcywgd2hpY2ggaXMgaG93IG90aGVyIHZpZXdzIG9mIHRoZSBzYW1lIG1hcCAobm90ZWJvb2sgb3V0cHV0cykgc3RheVxyXG4vLyBpbiBzdGVwIG5vdyB0aGF0IHRoZSB0cmFpdCBubyBsb25nZXIgY2FycmllcyB0b2dnbGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gc2VuZExheWVyV3JpdGUobW9kZWwsIGNoYW5nZXMpIHtcclxuICAgIGlmICghY2hhbmdlcy5sZW5ndGgpIHJldHVybjtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgbW9kZWwuc2VuZCh7XHJcbiAgICAgICAgICAgIGtpbmQ6IFwic3dpZnRtYXBfd3JpdGVcIixcclxuICAgICAgICAgICAgb3BzOiBjaGFuZ2VzLm1hcChjID0+ICh7IG9wOiBcInNldFwiLCBpZDogYy5pZCwgZmllbGRzOiB7IHZpc2libGU6IGMudmlzaWJsZSB9IH0pKSxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSByZW5kZXJlZCBsaXN0IGFscmVhZHkgaG9sZHMgdGhlIGNoYW5nZSAqLyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZXBvcnRzIHdoYXQgaXQgY2hhbmdlZCAtLSB7Y2hhbmdlczogW3tpZCwgdmlzaWJsZX1dLCBncm91cHNDaGFuZ2VkfSAtLSBzbyB0aGVcclxuICAgIC8vIGNhbGxlciBjYW4gd3JpdGUgYmFjayBleGFjdGx5IHRob3NlIGZsaXBzIHJhdGhlciB0aGFuIHRoZSB3aG9sZSBsYXllcnMgbGlzdC5cclxuICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgIGxldCBncm91cHNDaGFuZ2VkID0gZmFsc2U7XHJcbiAgICBmdW5jdGlvbiBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUpIHtcclxuICAgICAgICBjb25zdCBjb25mID0gZ3JvdXBDb25maWdzW25vZGUucGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc1JhZGlvR3JvdXAgPSBjb25mLm11bHRpX3NlbGVjdCA9PT0gZmFsc2U7XHJcbiAgICAgICAgaWYgKGlzUmFkaW9Hcm91cCkge1xyXG4gICAgICAgICAgICBsZXQgZm91bmRBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRHcm91cCA9IG5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBzQ2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGx5ci52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZTogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlLmNoaWxkcmVuW2tleV0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyh0cmVlKTtcclxuICAgIHJldHVybiB7IGNoYW5nZXMsIGdyb3Vwc0NoYW5nZWQgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZsaXBwZWQgb24gdGhlIGxpc3QgdGhpcyBzaWRlYmFyIHJlbmRlcmVkIGZyb20sIG5ldmVyIG1vZGVsLmdldChcImxheWVyc1wiKS5cclxuICAgICAgICAgICAgICAgIC8vIExheWVycyBhZGRlZCBhZnRlciB0aGUgd2lkZ2V0IGlzIGRpc3BsYXllZCBhcnJpdmUgYXMgcGF0Y2hlcyB0aGF0IHVwZGF0ZSB0aGVcclxuICAgICAgICAgICAgICAgIC8vIGZyb250ZW5kJ3MgbG9jYWwgc3RhdGUgd2l0aG91dCB0b3VjaGluZyB0aGUgdHJhaXQsIHNvIHRoZSBtb2RlbCdzIGNvcHkgaXNcclxuICAgICAgICAgICAgICAgIC8vIGZyb3plbiBhdCB3aGF0ZXZlciB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGNhcnJpZWQuIEJ1aWxkaW5nIHRoZSB1cGRhdGUgZnJvbVxyXG4gICAgICAgICAgICAgICAgLy8gaXQgZHJvcHMgZXZlcnkgbGF0ZXIgbGF5ZXI6IHRoZSB0b2dnbGUgbWF0Y2hlcyBubyBpZCwgd3JpdGVzIHRoZSBzdGFsZSBsaXN0XHJcbiAgICAgICAgICAgICAgICAvLyBiYWNrLCBhbmQgdGhlIGNoYW5nZSBoYW5kbGVyIHRoZW4gcmVzZXRzIGxvY2FsIHN0YXRlIHRvIGl0IC0tIHNvIHRoZSBib3hcclxuICAgICAgICAgICAgICAgIC8vIHJlLWNoZWNrcyBpdHNlbGYgYW5kIHRoZSBsYXllciBuZXZlciBoaWRlcy5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgZmxpcHMgbXV0YXRlIHRoZSByZW5kZXJlZCBsaXN0IGluIHBsYWNlIGFuZCByZWFjaCBQeXRob24gYXMgYSB0YXJnZXRlZFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUgKHNlbmRMYXllcldyaXRlKSwgbmV2ZXIgYnkgc2V0dGluZyB0aGUgbGF5ZXJzIHRyYWl0OiB0aGUgZnVsbFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUtYmFjayBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlIGNsaWNrLiBBdCAyNSB0cmFja3MgeCAyMDBrXHJcbiAgICAgICAgICAgICAgICAvLyB2ZXJ0aWNlcyBpdCB3YXMgYSAzNiBNQiBmcmFtZSAtLSBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0IHdlYnNvY2tldFxyXG4gICAgICAgICAgICAgICAgLy8gY2FwLCBzbyB0aGUgc2VydmVyIGNsb3NlZCB0aGUgY29ubmVjdGlvbiBhbmQgdGhlIFNoaW55IHNlc3Npb24gZGllZCBvblxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGNoZWNrYm94LiBTZXR0aW5nIHRoZSB0cmFpdCB3aXRob3V0IHNhdmluZyBpcyBqdXN0IGFzIGZhdGFsOlxyXG4gICAgICAgICAgICAgICAgLy8gaXQgc3RheXMgZGlydHkgYW5kIHRoZSBuZXh0IHNhdmVfY2hhbmdlcyAoYW55IHBhbikgZmx1c2hlcyBpdC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZsaXAgPSAobHlyLCB2aXNpYmxlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKChseXIudmlzaWJsZSAhPT0gZmFsc2UpID09PSB2aXNpYmxlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSB2aXNpYmxlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGUgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGlvIGJ1dHRvbiBsb2dpYzogc2V0IGFsbCBzaWJsaW5ncyB0byB2aXNpYmxlPWZhbHNlLCBhbmQgdGhpcyB0byB2aXNpYmxlPXRydWVcclxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYkdyb3VwID0gcGFyZW50Tm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBzaWJHcm91cC5wYXRoID09PSBwYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbc2liR3JvdXAucGF0aF0gPSAhYWN0aXZlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IGZsaXAoc2liTHlyLCBzaWJMeXIuaWQgPT09IGlkKSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3BhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBseXIgPSBsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGx5cikgZmxpcChseXIsIGlzQ2hlY2tlZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCBjaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIC8vIGdyb3VwX2NvbmZpZ3Mgc3RheXMgb24gdGhlIHRyYWl0OiBpdCBpcyBhIGhhbmRmdWwgb2YgZm9sZGVyIGZsYWdzLCBhbmQgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyBzcHJlYWQgZ2l2ZXMgQmFja2JvbmUgYSBmcmVzaCByZWZlcmVuY2Ugc28gdGhlIGluLXBsYWNlIGVkaXRzIHJlZ2lzdGVyLlxyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0NoZWNrZWQgJiYgbWFwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYm91bmRzID0gZ2V0TGF5ZXJCb3VuZHMobm9kZSwgbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYm91bmRzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBvbkxheWVyVG9nZ2xlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQobm9kZURpdik7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVuZGVyIHRyZWUgZnJvbSByb290IG5vZGVcclxuICAgIHJlbmRlck5vZGUodHJlZSwgc2lkZWJhciwgMCwgbnVsbCwgdHJ1ZSk7XHJcbn1cclxuIiwgIi8vIFRoZSBsZWdlbmQ6IGRlcml2ZWQgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSBldmVyeXRoaW5nIGVsc2UgcmVuZGVycyBmcm9tLCB3aXRoXG4vLyBkZWNsYXJhdGl2ZSBvdmVycmlkZXMgb24gdG9wLiBEZWxpYmVyYXRlbHkgbW9kZWwtZnJlZSAtLSBwdXJlIGRhdGEgaW4sIERPTSBvdXQgLS1cbi8vIHNvIGEgcGxhaW4tSlMgY29uc3VtZXIgb2YgZGlzdC9pbmRleC5qcyBnZXRzIHRoZSB3aG9sZSBmZWF0dXJlLCBhbmQgdGhlIGFueXdpZGdldFxuLy8gZ2x1ZSBpbiBtYXAuanMgaXMgYSBmZXcgbGluZXMuIChzaWRlYmFyLmpzIHN0aWxsIHRha2VzIGBtb2RlbGAgYW5kIGlzIGZpbGVkIGZvclxuLy8gZXh0cmFjdGlvbjsgdGhpcyBtb2R1bGUgbXVzdCBuZXZlciBuZWVkIHRoYXQgdW5waWNraW5nLilcbi8vXG4vLyBUaGUgcGlwZWxpbmU6IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykgd2Fsa3MgdGhlIGxheWVycyBpbnRvXG4vLyBlbnRyaWVzIChza2lwcGVkIGVudGlyZWx5IHdoZW4gY29uZmlnLmF1dG8gPT09IGZhbHNlKSwgYXBwbGllcyB0aGUgcGVyc2lzdGVudFxuLy8gcmVtb3ZlLW1hdGNoZXJzLCBhcHBlbmRzIHRoZSBtYW51YWwgYWRkcywgYW5kIHJldHVybnMgYSBzcGVjIHRoYXQgcmVuZGVyTGVnZW5kXG4vLyB0dXJucyBpbnRvIERPTS4gTm90aGluZyBoZXJlIGtub3dzIGFib3V0IGNvbG9ybWFwczogcmFtcC9jYXRlZ29yeS9iaW4gZW50cmllc1xuLy8gYXJyaXZlIHdpdGggdGhlaXIgY29sb3VycyBhbHJlYWR5IHJlc29sdmVkIChQeXRob24gcmVzb2x2ZXMgYXQgdGhlIGFkZF8qIGJvdW5kYXJ5LFxuLy8gbWFudWFsIGVudHJpZXMgYXQgbGVnZW5kX2FkZCksIHNvIHRoZXJlIGlzIG5vIGFuY2hvciB0YWJsZSB0byBkcmlmdC5cblxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9tYXAuanNcIjtcblxuY29uc3QgR0xZUEhTID0ge1xuICAgIGNpcmNsZV9tYXJrZXJzOiBcImNpcmNsZVwiLFxuICAgIG1hcmtlcnM6IFwicGluXCIsXG4gICAgcG9seWxpbmU6IFwibGluZVwiLFxuICAgIHBvbHlnb246IFwicG9seWdvblwiLFxuICAgIGNpcmNsZTogXCJjaXJjbGVcIixcbn07XG5cbmZ1bmN0aW9uIHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiBcInN3YXRjaFwiLFxuICAgICAgICBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsXG4gICAgICAgIHNoYXBlOiBHTFlQSFNbbGF5ZXIudHlwZV0gfHwgXCJzcXVhcmVcIixcbiAgICAgICAgY29sb3I6IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBmaWxsQ29sb3I6IGxheWVyLmZpbGxDb2xvciB8fCBsYXllci5maWxsX2NvbG9yIHx8IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBoaWRkZW4sXG4gICAgfTtcbn1cblxuLy8gQSBkYXRhLWRyaXZlbiBibG9jayByZWNvcmRlZCBhdCBhZGQgdGltZSAoe2tpbmQsIGFuY2hvcnN8aXRlbXN8ZWRnZXMrY29sb3JzLCAuLi59KVxuLy8gYmVjb21lcyB0aGUgbGF5ZXIncyBlbnRyeSBhcy1pczsgdGhlIGxheWVyIG9ubHkgY29udHJpYnV0ZXMgbGFiZWwgYW5kIHZpc2liaWxpdHkuXG5mdW5jdGlvbiBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4geyAuLi5sYXllci5sZWdlbmQsIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIiwgaGlkZGVuIH07XG59XG5cbmZ1bmN0aW9uIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSByZXR1cm4gW107XG4gICAgY29uc3QgaGlkZGVuID0gIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgLy8gQSBjb2xsZWN0aW9uOiBvbmUgZW50cnkgcGVyIGdlb21ldHJ5IHBhcnQsIHNhbWUgbGFiZWwgYnkgZGVzaWduIC0tIHRoZVxuICAgICAgICAvLyBnbHlwaHMgYXJlIHdoYXQgdGVsbCB0aGVtIGFwYXJ0LCBtYXRjaGluZyBob3cgdGhlIHBhcnRzIHJlbmRlci5cbiAgICAgICAgcmV0dXJuIChsYXllci5sYXllcnMgfHwgW10pXG4gICAgICAgICAgICAuZmlsdGVyKHN1YiA9PiBHTFlQSFNbc3ViLnR5cGVdKVxuICAgICAgICAgICAgLm1hcChzdWIgPT4gc3ViLmxlZ2VuZFxuICAgICAgICAgICAgICAgID8gYmxvY2tFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pKTtcbiAgICB9XG4gICAgaWYgKCFHTFlQSFNbbGF5ZXIudHlwZV0pIHJldHVybiBbXTtcbiAgICBjb25zdCBlbnRyaWVzID0gW2xheWVyLmxlZ2VuZCA/IGJsb2NrRW50cnkobGF5ZXIsIGhpZGRlbikgOiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKV07XG4gICAgLy8gcmFkaXVzX2NvbCByZWNvcmRzIGEgc2l6ZSBrZXkgYmVzaWRlIHRoZSBjb2xvdXIgc3Rvcnk6IGJvdGggZW5jb2RpbmdzIG9uIHRoZVxuICAgIC8vIG1hcCBkZXNlcnZlIGJvdGggZXhwbGFuYXRpb25zIGluIHRoZSBsZWdlbmQuXG4gICAgaWYgKGxheWVyLmxlZ2VuZF9zaXplKSB7XG4gICAgICAgIGVudHJpZXMucHVzaCh7IC4uLmxheWVyLmxlZ2VuZF9zaXplLFxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogbGF5ZXIubGVnZW5kX3NpemUuZmllbGQgfHwgbGF5ZXIubmFtZSB8fCBcIlNpemVcIiwgaGlkZGVuIH0pO1xuICAgIH1cbiAgICByZXR1cm4gZW50cmllcztcbn1cblxuLy8gSWRlbnRpY2FsIGRhdGEtZHJpdmVuIHBheWxvYWRzIGNvbGxhcHNlIGludG8gb25lIHJvdy4gR3JvdXBpbmcgcG9pbnRzIGJ5IGEgY29sdW1uXG4vLyBnaXZlcyBldmVyeSBzdWItbGF5ZXIgdGhlIHNhbWUgcmFtcDsgYSByYW1wIHBlciBzdWItbGF5ZXIgaXMgbm9pc2UsIGFuZCB0aGUgZmllbGRcbi8vIG5hbWUgaXMgdGhlIGhvbmVzdCBsYWJlbCBmb3IgdGhlIHNoYXJlZCBtYXBwaW5nLiBUaGUgc3Vydml2b3Iga2VlcHMgdGhlIGZpcnN0XG4vLyBvY2N1cnJlbmNlJ3MgcG9zaXRpb24gYW5kIGhpZGVzIG9ubHkgd2hlbiBldmVyeSBjb250cmlidXRvciBpcyBoaWRkZW4uXG5mdW5jdGlvbiBwYXlsb2FkS2V5KGVudHJ5KSB7XG4gICAgLy8gSWRlbnRpdHkgZmllbGRzIHN0YXkgb3V0IG9mIHRoZSBrZXk6IHRoZSB3aG9sZSBwb2ludCBpcyB0aGF0IGVudHJpZXMgZnJvbVxuICAgIC8vIERJRkZFUkVOVCBsYXllcnMgY29sbGFwc2Ugd2hlbiB0aGVpciBtYXBwaW5nIHBheWxvYWQgaXMgdGhlIHNhbWUuXG4gICAgY29uc3QgeyBsYWJlbCwgaGlkZGVuLCBsYXllcklkLCBsYXllciwgZ3JvdXAsIC4uLnBheWxvYWQgfSA9IGVudHJ5O1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbn1cblxuZnVuY3Rpb24gZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKSB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBNYXAoKTsgICAvLyBwYXlsb2FkIGtleSAtPiBzdXJ2aXZpbmcgZW50cnlcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoZW50cnkgPT4ge1xuICAgICAgICAgICAgaWYgKGVudHJ5LmtpbmQgPT09IFwic3dhdGNoXCIpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGF5bG9hZEtleShlbnRyeSk7XG4gICAgICAgICAgICBjb25zdCBzdXJ2aXZvciA9IHNlZW4uZ2V0KGtleSk7XG4gICAgICAgICAgICBpZiAoIXN1cnZpdm9yKSB7XG4gICAgICAgICAgICAgICAgc2Vlbi5zZXQoa2V5LCBlbnRyeSk7XG4gICAgICAgICAgICAgICAgaWYgKGVudHJ5LmZpZWxkKSBlbnRyeS5sYWJlbCA9IGVudHJ5LmZpZWxkO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3Vydml2b3IuaGlkZGVuID0gc3Vydml2b3IuaGlkZGVuICYmIGVudHJ5LmhpZGRlbjtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBncm91cHM7XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXJIaXRzKG1hdGNoZXIsIGVudHJ5LCBncm91cE5hbWUpIHtcbiAgICBpZiAoIW1hdGNoZXIpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgY29uc3RyYWluZWQgPSBmYWxzZTtcbiAgICBpZiAobWF0Y2hlci5sYWJlbCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKGVudHJ5LmxhYmVsICE9PSBtYXRjaGVyLmxhYmVsKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmdyb3VwICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZ3JvdXBOYW1lICE9PSBtYXRjaGVyLmdyb3VwKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmlkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZW50cnkubGF5ZXJJZCAhPT0gbWF0Y2hlci5pZCkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gY29uc3RyYWluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHtcbiAgICBjb25zdCBjZmcgPSBjb25maWcgfHwge307XG4gICAgY29uc3QgZ3JvdXBzID0gW107XG4gICAgY29uc3QgYnlOYW1lID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGdyb3VwRm9yID0gbmFtZSA9PiB7XG4gICAgICAgIGlmICghYnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IG5hbWUsIGVudHJpZXM6IFtdIH07XG4gICAgICAgICAgICBieU5hbWUuc2V0KG5hbWUsIGdyb3VwKTtcbiAgICAgICAgICAgIGdyb3Vwcy5wdXNoKGdyb3VwKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYnlOYW1lLmdldChuYW1lKTtcbiAgICB9O1xuXG4gICAgaWYgKGNmZy5hdXRvICE9PSBmYWxzZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIHtcbiAgICAgICAgICAgICAgICBlbnRyeS5sYXllcklkID0gbGF5ZXIuaWQ7XG4gICAgICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBncm91cEZvcihsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcyk7XG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzdXBwcmVzc2lvbjogbWF0Y2hlcnMgb3V0bGl2ZSBldmVyeSByZS1kZXJpdmF0aW9uLCB3aGljaCBpcyB0aGVcbiAgICAvLyBkaWZmZXJlbmNlIGZyb20gYSByZWdpc3RyeSByZW1vdmUgdGhhdCB0aGUgbmV4dCBhZGQgd291bGQganVzdCByZXBvcHVsYXRlLlxuICAgIGNvbnN0IHJlbW92ZXMgPSBjZmcucmVtb3ZlIHx8IFtdO1xuICAgIGlmIChyZW1vdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICBlbnRyeSA9PiAhcmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGdyb3VwLm5hbWUpKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYW51YWwgZW50cmllczogdGhlIHVzZXIncyBvd24gY2xhaW1zLiBzY29wZSBuZXZlciBkcm9wcyB0aGVtOyBhIGBsYXllcmBcbiAgICAvLyBiaW5kaW5nIG1ha2VzIG9uZSBmb2xsb3cgYSBsaXZlIGxheWVyJ3MgdmlzaWJpbGl0eSAoYW5kIHZhbmlzaCB3aXRoIGl0IHVuZGVyXG4gICAgLy8gc2NvcGUgXCJ2aXNpYmxlXCIpLCBmb3Igd2hlbiBhIG1hbnVhbCByb3cgaXMgcmVhbGx5IGEgcmVsYWJlbGxpbmcuXG4gICAgZm9yIChjb25zdCBhZGRlZCBvZiBjZmcuYWRkIHx8IFtdKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0geyBoaWRkZW46IGZhbHNlLCAuLi5hZGRlZCB9O1xuICAgICAgICBpZiAoZW50cnkubGF5ZXIgIT0gbnVsbCkge1xuICAgICAgICAgICAgY29uc3QgYm91bmQgPSAobGF5ZXJzIHx8IFtdKS5maW5kKFxuICAgICAgICAgICAgICAgIGwgPT4gbC5pZCA9PT0gZW50cnkubGF5ZXIgfHwgbC5uYW1lID09PSBlbnRyeS5sYXllcik7XG4gICAgICAgICAgICBlbnRyeS5oaWRkZW4gPSAhYm91bmQgfHwgIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGJvdW5kLCBncm91cENvbmZpZ3MgfHwge30pO1xuICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGVudHJ5Lmdyb3VwIHx8IFwiXCIpKSkgY29udGludWU7XG4gICAgICAgIGdyb3VwRm9yKGVudHJ5Lmdyb3VwIHx8IFwiXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XG4gICAgfVxuXG4gICAgY29uc3QgcG9wdWxhdGVkID0gZ3JvdXBzLmZpbHRlcihnID0+IGcuZW50cmllcy5sZW5ndGggPiAwKTtcbiAgICByZXR1cm4geyB0aXRsZTogY2ZnLnRpdGxlIHx8IFwiTGVnZW5kXCIsIGdyb3VwczogcG9wdWxhdGVkIH07XG59XG5cbi8vIC0tLSByZW5kZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBET00gYnVpbHQgd2l0aCBjcmVhdGVFbGVtZW50L3RleHRDb250ZW50IHRocm91Z2hvdXQ6IGxhYmVscyBhbmQgY2F0ZWdvcnkgdmFsdWVzIGNvbWVcbi8vIGZyb20gdXNlciBkYXRhIGFuZCBtdXN0IG5ldmVyIGJlIHBhcnNlZCBhcyBIVE1MLlxuXG5mdW5jdGlvbiBkaXYoc3R5bGVzLCB0ZXh0KSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlcyk7XG4gICAgaWYgKHRleHQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gZ2x5cGgoZW50cnkpIHtcbiAgICBpZiAoZW50cnkuc2hhcGUgPT09IFwibGluZVwiKSB7XG4gICAgICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIyMHB4XCIsIGhlaWdodDogXCI0cHhcIiwgYmFja2dyb3VuZDogZW50cnkuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIgfSk7XG4gICAgfVxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJwaW5cIikge1xuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBlbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XG4gICAgICAgIGVsLnN0eWxlLmZsZXggPSBcIm5vbmVcIjtcbiAgICAgICAgY29uc3Qgc3ZnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJzdmdcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBcIjEyXCIpO1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMTRcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIsIFwiMCAwIDI0IDI4XCIpO1xuICAgICAgICBjb25zdCBwYXRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJwYXRoXCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImRcIixcbiAgICAgICAgICAgIFwiTTEyIDBDNS40IDAgMCA1LjQgMCAxMmMwIDkgMTIgMTYgMTIgMTZzMTItNyAxMi0xNkMyNCA1LjQgMTguNiAwIDEyIDB6XCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImZpbGxcIiwgZW50cnkuY29sb3IpO1xuICAgICAgICBzdmcuYXBwZW5kQ2hpbGQocGF0aCk7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKHN2Zyk7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgLy8gY2lyY2xlIC8gcG9seWdvbiAvIHNxdWFyZTogZmlsbCBpbnNpZGUgYSBib3JkZXIsIHdoaWNoIGlzIGhvdyBhcmVhcyBkcmF3LlxuICAgIGNvbnN0IHJhZGl1cyA9IGVudHJ5LnNoYXBlID09PSBcImNpcmNsZVwiID8gXCI1MCVcIlxuICAgICAgICA6IGVudHJ5LnNoYXBlID09PSBcInBvbHlnb25cIiA/IFwiMnB4XCIgOiBcIjBcIjtcbiAgICByZXR1cm4gZGl2KHsgd2lkdGg6IFwiMTJweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5maWxsQ29sb3IsXG4gICAgICAgICAgICAgICAgIGJvcmRlcjogYDJweCBzb2xpZCAke2VudHJ5LmNvbG9yfWAsIGJvcmRlclJhZGl1czogcmFkaXVzLFxuICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGJveFNpemluZzogXCJib3JkZXItYm94XCIgfSk7XG59XG5cbmZ1bmN0aW9uIHJhbXBSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBzdG9wcyA9IChlbnRyeS5hbmNob3JzIHx8IFtdKS5tYXAoKGNvbG9yLCBpLCBhbGwpID0+XG4gICAgICAgIGAke2NvbG9yfSAke2FsbC5sZW5ndGggPiAxID8gKGkgLyAoYWxsLmxlbmd0aCAtIDEpKSAqIDEwMCA6IDB9JWApO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe1xuICAgICAgICB3aWR0aDogXCIxMjBweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBib3JkZXJSYWRpdXM6IFwiMnB4XCIsXG4gICAgICAgIGJhY2tncm91bmRJbWFnZTogYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWAsXG4gICAgfSkpO1xuICAgIGNvbnN0IGVuZHMgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwganVzdGlmeUNvbnRlbnQ6IFwic3BhY2UtYmV0d2VlblwiLCB3aWR0aDogXCIxMjBweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICBmb250U2l6ZTogXCIxMXB4XCIsIGNvbG9yOiBcIiM1NTVcIiB9KTtcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtaW4pKSk7XG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhlbnRyeS52bWF4KSkpO1xuICAgIHJvdy5hcHBlbmRDaGlsZChlbmRzKTtcbiAgICByZXR1cm4gcm93O1xufVxuXG5jb25zdCBNQVhfQ0FURUdPUllfUk9XUyA9IDEyO1xuXG5mdW5jdGlvbiBjYXRlZ29yaWVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XG4gICAgY29uc3QgaXRlbXMgPSBlbnRyeS5pdGVtcyB8fCBbXTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMuc2xpY2UoMCwgTUFYX0NBVEVHT1JZX1JPV1MpKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvcjogaXRlbS5jb2xvciwgZmlsbENvbG9yOiBpdGVtLmNvbG9yIH0pKTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhpdGVtLnZhbHVlKSkpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XG4gICAgfVxuICAgIGlmIChpdGVtcy5sZW5ndGggPiBNQVhfQ0FURUdPUllfUk9XUykge1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luTGVmdDogXCI4cHhcIiwgbWFyZ2luVG9wOiBcIjNweFwiLCBjb2xvcjogXCIjNTU1XCIgfSxcbiAgICAgICAgICAgIGArICR7aXRlbXMubGVuZ3RoIC0gTUFYX0NBVEVHT1JZX1JPV1N9IG1vcmVgKSk7XG4gICAgfVxuICAgIHJldHVybiByb3c7XG59XG5cbmZ1bmN0aW9uIGJpbnNSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBlZGdlcyA9IGVudHJ5LmVkZ2VzIHx8IFtdO1xuICAgIGNvbnN0IGNvbG9ycyA9IGVudHJ5LmNvbG9ycyB8fCBbXTtcbiAgICBjb25zdCBsYWJlbEZvciA9IGkgPT4gaSA9PT0gMCA/IGA8ICR7ZWRnZXNbMF19YFxuICAgICAgICA6IGkgPT09IGVkZ2VzLmxlbmd0aCA/IGBcdTIyNjUgJHtlZGdlc1tlZGdlcy5sZW5ndGggLSAxXX1gXG4gICAgICAgIDogYCR7ZWRnZXNbaSAtIDFdfSBcdTIwMTMgJHtlZGdlc1tpXX1gO1xuICAgIGNvbG9ycy5mb3JFYWNoKChjb2xvciwgaSkgPT4ge1xuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmdpbkxlZnQ6IFwiOHB4XCIgfSk7XG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZ2x5cGgoeyBzaGFwZTogXCJzcXVhcmVcIiwgY29sb3IsIGZpbGxDb2xvcjogY29sb3IgfSkpO1xuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgbGFiZWxGb3IoaSkpKTtcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGxpbmUpO1xuICAgIH0pO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIEEgc2l6ZSBrZXkgaXMgYSBzdGF0ZW1lbnQsIG5vdCBhIGRyYXdpbmc6IFwiXHUyNUNGIHNpemUgXHUyMjFEIGZpZWxkIChtaW4gXHUyMDEzIG1heClcIi4gVGhlIGdseXBoXG4vLyBpcyBmaXhlZCBhbmQgbm90aGluZyBpbiB0aGUgcm93IGRlcml2ZXMgZnJvbSByYWRpdXNfcmFuZ2Ugb3IgdGhlIGRhdGEncyBzcHJlYWQgLS1cbi8vIGxlZ2VuZCBDU1MgcGl4ZWxzIGFyZSBub3QgbWFwIHBpeGVscyBhdCBhbnkgem9vbSwgc28gZHJhd24gc2FtcGxlIGNpcmNsZXMgd291bGRcbi8vIGFzc2VydCBhIHByZWNpc2lvbiB0aGF0IGRvZXMgbm90IGV4aXN0LiBUaGUgcm93IG5hbWVzIHRoZSBlbmNvZGluZyBhbmQgaXRzIGRvbWFpbi5cbmZ1bmN0aW9uIHNpemVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBjb2xvcjogXCIjNjY2XCIgfSwgXCJcdTI1Q0ZcIikpO1xuICAgIGNvbnN0IHJhbmdlID0gZW50cnkudm1pbiAhPSBudWxsICYmIGVudHJ5LnZtYXggIT0gbnVsbFxuICAgICAgICA/IGAgKCR7ZW50cnkudm1pbn0gXHUyMDEzICR7ZW50cnkudm1heH0pYCA6IFwiXCI7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgYHNpemUgXHUyMjFEICR7ZW50cnkuZmllbGQgfHwgZW50cnkubGFiZWx9JHtyYW5nZX1gKSk7XG4gICAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gc3dhdGNoUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZ2x5cGgoZW50cnkpKTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIENvbGxhcHNlIHN0YXRlLCBwZXIgY29udGFpbmVyIHJhdGhlciB0aGFuIG1vZHVsZSBzY29wZTogdGhlIHNpZGViYXIga2V5cyBpdHNcbi8vIGNvbGxhcHNlZFBhdGhzIGF0IG1vZHVsZSBsZXZlbCBhbmQgdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmUgaXQgLS0gYSBmaWxlZCBidWdcbi8vIHRoaXMgZGVsaWJlcmF0ZWx5IGRvZXMgbm90IGluaGVyaXQuIEtleWVkIGJ5IGdyb3VwIG5hbWUsIHN1cnZpdmluZyB0aGUgZnVsbFxuLy8gcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBjb250YWluZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICBjb25zdCBkaW1IaWRkZW4gPSBvcHRpb25zLmRpbUhpZGRlbiAhPT0gZmFsc2U7XG4gICAgbGV0IGNvbGxhcHNlZCA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xuICAgIGlmICghY29sbGFwc2VkKSB7XG4gICAgICAgIGNvbGxhcHNlZCA9IG5ldyBTZXQoKTtcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgY29sbGFwc2VkKTtcbiAgICB9XG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7XG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxuICAgICAgICBwYWRkaW5nQm90dG9tOiBcIjRweFwiLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIsXG4gICAgfSwgc3BlYy50aXRsZSkpO1xuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBzcGVjLmdyb3Vwcykge1xuICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGdyb3VwLm5hbWUgJiYgY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKTtcbiAgICAgICAgaWYgKGdyb3VwLm5hbWUpIHtcbiAgICAgICAgICAgIC8vIFRoZSBzaWRlYmFyJ3MgYWZmb3JkYW5jZSBleGFjdGx5OiBhbiBhcnJvdyB0aGF0IGZvbGRzIHRoZSBzZWN0aW9uLlxuICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gZGl2KHsgZm9udFdlaWdodDogXCJib2xkXCIsIG1hcmdpblRvcDogXCI2cHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsIHVzZXJTZWxlY3Q6IFwibm9uZVwiIH0pO1xuICAgICAgICAgICAgaGVhZGVyLnRleHRDb250ZW50ID0gYCR7aXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIn0gJHtncm91cC5uYW1lfWA7XG4gICAgICAgICAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKSkgY29sbGFwc2VkLmRlbGV0ZShncm91cC5uYW1lKTtcbiAgICAgICAgICAgICAgICBlbHNlIGNvbGxhcHNlZC5hZGQoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGNvbnRhaW5lciwgc3BlYywgb3B0aW9ucyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChoZWFkZXIpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChpc0NvbGxhcHNlZCkgY29udGludWU7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZ3JvdXAuZW50cmllcykge1xuICAgICAgICAgICAgY29uc3Qgcm93ID0gZW50cnkua2luZCA9PT0gXCJyYW1wXCIgPyByYW1wUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJiaW5zXCIgPyBiaW5zUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJzaXplc1wiID8gc2l6ZXNSb3coZW50cnkpXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hSb3coZW50cnkpO1xuICAgICAgICAgICAgLy8gRGltbWVkLCBub3QgZHJvcHBlZDogdW5kZXIgc2NvcGUgXCJhbGxcIiB0aGUgbGVnZW5kIGlzIHRoZSBtYXAncyB3aG9sZVxuICAgICAgICAgICAgLy8gdm9jYWJ1bGFyeSwgYW5kIHRoZSBkaW0gaXMgd2hhdCBzdGlsbCB0ZWxscyB0aGUgY3VycmVudCBzY3JlZW4gc3RhdGUuXG4gICAgICAgICAgICBpZiAoZW50cnkuaGlkZGVuICYmIGRpbUhpZGRlbikgcm93LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHJvdyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbn1cbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIC8vIFRoZSBmaXJzdCB0aWNrIHNpdHMgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBub3Qgb25lIHBlcmlvZCBhZnRlciBpdDogd2luZG93c1xuICAgIC8vIGFyZSBoYWxmLW9wZW4gKHN0YXJ0LCBlbmRdLCBzbyBhIGZpcnN0IHRpY2sgYXQgc3RhcnQrUCB3b3VsZCBleGNsdWRlIHRoZSBlYXJsaWVzdFxuICAgIC8vIHBvaW50IGZyb20gaXRzIG93biB3aW5kb3cgYW5kIGl0IHdvdWxkIG5ldmVyIGRpc3BsYXkgYXQgYW55IHRpY2suXG4gICAgY29uc3QgdGlja3MgPSBbc3RhcnRNc107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xuICAgICAgICB0aWNrcy5wdXNoKHQpO1xuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XG4gICAgcmV0dXJuIHRpY2tzO1xufVxuXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2Vcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgfVxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xufVxuXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xufVxuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG59XG5cbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cbi8vXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgLy8gQSBwZXItdmVydGV4LXRpbWVkIGxpbmUgaG9sZHMgbWFueSBwYWlyczsgb24gdGhpcyB3aG9sZS1sYXllciBwYXRoIGl0IHNob3dzXG4gICAgLy8gd2hpbGUgQU5ZIG9mIHRoZW0gaXMgaW4gdGhlIHdpbmRvdyAtLSB0aGUgR1BVIHBhdGggaXMgd2hhdCB0cmltcyBwZXIgc2VnbWVudC5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XG59XG5cbi8vIE9uZSBwbGF5YmFjayBzdGVwOiB0aGUgbmV4dCBpbmRleCBhbmQgd2hldGhlciBwbGF5YmFjayBzdXJ2aXZlcyBpdC4gUHVyZSBzbyB0aGUgbG9vcFxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxuLy8gd2l0aG91dCBsb29wIHN0b3BzIHdoZXJlIGl0IGlzLlxuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2UoaW5kZXgsIGxlbmd0aCwgbG9vcCkge1xuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcbiAgICBpZiAobG9vcCkgcmV0dXJuIHsgaW5kZXg6IDAsIHBsYXlpbmc6IHRydWUgfTtcbiAgICByZXR1cm4geyBpbmRleCwgcGxheWluZzogZmFsc2UgfTtcbn1cblxuLy8gV2hlcmUgdGhlIGNvbnRyb2wgc2l0cywgYXMgaW5saW5lIHN0eWxlcyBzbyB0aGUgY2hvaWNlIHRyYXZlbHMgd2l0aCB0aGUgc3RhdGUgcmF0aGVyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cbi8vIGluY2x1ZGluZyB0aGUgb25lcyBhIHBvc2l0aW9uIGRvZXMgbm90IHVzZSAtLSBzbyBtb3ZpbmcgdGhlIGNvbnRyb2wgY2xlYXJzIHRoZSBvbGRcbi8vIGFuY2hvciBpbnN0ZWFkIG9mIGFjY3VtdWxhdGluZyBib3RoLlxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcbiAgICBcInRvcC1sZWZ0XCI6ICAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJ0b3AtY2VudGVyXCI6ICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImxlZnQtY2VudGVyXCI6ICAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJyaWdodC1jZW50ZXJcIjogIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImJvdHRvbS1jZW50ZXJcIjogeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tcmlnaHRcIjogIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxufTtcblxuZnVuY3Rpb24gYXBwbHlQb3NpdGlvbihlbCwgcG9zaXRpb24pIHtcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XG4gICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN0eWxlcykpIHtcbiAgICAgICAgZWwuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XG59XG5cbi8vIC0tLSB0aGUgd2luZG93IGFuZCB0aGUgcnVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gRml4ZWQgbWlsbGlzZWNvbmRzIGZvciBhIHBlcmlvZCwgb3IgbnVsbCB3aGVuIGl0IG1vdmVzIHRocm91Z2ggdGhlIGNhbGVuZGFyIChtb250aHMsXG4vLyB5ZWFycykgYW5kIGhhcyBubyBmaXhlZCB3aWR0aC4gVGhlIHJ1bGVyIGFuZCB0aGUgZHJhZyBncmlkIG5lZWQgZml4ZWQgd2lkdGhzOyBjYWxlbmRhclxuLy8gcGVyaW9kcyBmYWxsIGJhY2sgdG8gdGhlIHRpY2sgcG9zaXRpb25zIHRoZW1zZWx2ZXMuXG5leHBvcnQgZnVuY3Rpb24gcGVyaW9kVG9NcyhwKSB7XG4gICAgaWYgKCFwIHx8IHAueWVhcnMgfHwgcC5tb250aHMpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMCArIHAuaG91cnMgKiAzNjAwXG4gICAgICAgICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMDtcbn1cblxuLy8gTWlsbGlzZWNvbmRzIGFzIGFuIElTTzg2MDEgZHVyYXRpb24sIGhvdXJzL21pbnV0ZXMvc2Vjb25kcyBvbmx5IC0tIFBUMjZIIGlzIHZhbGlkIGFuZFxuLy8gYXZvaWRzIGNhbGVuZGFyIHVuaXRzIGVudGlyZWx5LCBzbyB3aGF0IHRoZSBkcmFnIHdyaXRlcyBhbHdheXMgcGFyc2VzIGJhY2sgZXhhY3RseS5cbmV4cG9ydCBmdW5jdGlvbiBtc1RvUGVyaW9kSVNPKG1zKSB7XG4gICAgbGV0IHJlc3QgPSBNYXRoLnJvdW5kKG1zIC8gMTAwMCk7XG4gICAgY29uc3QgaCA9IE1hdGguZmxvb3IocmVzdCAvIDM2MDApOyByZXN0IC09IGggKiAzNjAwO1xuICAgIGNvbnN0IG0gPSBNYXRoLmZsb29yKHJlc3QgLyA2MCk7IHJlc3QgLT0gbSAqIDYwO1xuICAgIGxldCBvdXQgPSBcIlBUXCI7XG4gICAgaWYgKGgpIG91dCArPSBgJHtofUhgO1xuICAgIGlmIChtKSBvdXQgKz0gYCR7bX1NYDtcbiAgICBpZiAocmVzdCB8fCBvdXQgPT09IFwiUFRcIikgb3V0ICs9IGAke3Jlc3R9U2A7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gVGhlIHJ1bGVyJ3MgaW5jcmVtZW50OiB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gZXZlcnkgYm91bmRhcnkgdGhlIHVzZXIgY2FuIGNhcmVcbi8vIGFib3V0IC0tIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZCBkdXJhdGlvbi4gQW4gaW50ZXJ2YWwgb2YgMWggd2l0aCBhXG4vLyAyLjVoIGR1cmF0aW9uIG5lZWRzIDMwLW1pbnV0ZSBtYXJrcyBmb3IgdGhlIGR1cmF0aW9uIHRvIHNpdCBvbiBvbmU7IDFoIGFuZCAyaCBuZWVkIG9ubHlcbi8vIHRoZSBob3Vycy4gXCJMb3dlc3QgZHVyYXRpb25cIiBpcyB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIG9uZSBkaXZpZGVzIHRoZSBvdGhlci5cbmV4cG9ydCBmdW5jdGlvbiBnY2RHcmlkTXMocGVyaW9kTXMsIGR1cmF0aW9uc01zKSB7XG4gICAgY29uc3QgZ2NkID0gKGEsIGIpID0+IChiID8gZ2NkKGIsIGEgJSBiKSA6IGEpO1xuICAgIGxldCBncmlkID0gcGVyaW9kTXM7XG4gICAgZm9yIChjb25zdCBkIG9mIGR1cmF0aW9uc01zKSB7XG4gICAgICAgIGlmIChkID4gMCkgZ3JpZCA9IGdjZChncmlkLCBNYXRoLnJvdW5kKGQpKTtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgubWF4KGdyaWQsIDEwMDApO1xufVxuXG4vLyBFdmVyeSBmaW5pdGUgZHVyYXRpb24gYXR0YWNoZWQgdG8gYSB0aW1lIGxheWVyLCBpbiBtcywgZm9yIHRoZSBncmlkLiBcInBlcmlvZFwiIGFuZCBudWxsXG4vLyBjb250cmlidXRlIG5vdGhpbmcgbmV3OyBjYWxlbmRhciBkdXJhdGlvbnMgY2Fubm90IGpvaW4gYSBmaXhlZC1tcyBncmlkIGFuZCBhcmUgc2tpcHBlZC5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJzLCB3aW5kb3dJc28pIHtcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBjb25zdCB2aXNpdCA9IGxpc3QgPT4gbGlzdC5mb3JFYWNoKGwgPT4ge1xuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsLmxheWVycyB8fCBbXSk7XG4gICAgICAgIGNvbnN0IHNwZWMgPSBsLnRpbWUgJiYgbC50aW1lLmR1cmF0aW9uO1xuICAgICAgICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgJiYgc3BlYyAhPT0gXCJwZXJpb2RcIikge1xuICAgICAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcbiAgICAgICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdmlzaXQobGF5ZXJzKTtcbiAgICBpZiAod2luZG93SXNvKSB7XG4gICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh3aW5kb3dJc28pKTtcbiAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFRpY2sgbWFya3MgZm9yIHRoZSB0cmFjazogbWFqb3JzIGF0IGV2ZXJ5IGludGVydmFsIGJvdW5kYXJ5IChzcGFyc2VseSBsYWJlbGxlZCBzbyBsb25nXG4vLyB0aW1lbGluZXMgc3RheSByZWFkYWJsZSksIHVubGFiZWxsZWQgbWlub3JzIGF0IHRoZSBncmlkIGluIGJldHdlZW4uIE1pbm9yIERJU1BMQVkgaXNcbi8vIHRoaW5uZWQgd2hlbiBkZW5zZTsgdGhlIHNuYXAgZ3JpZCBzdGF5cyBleGFjdCwgc28gYSBtYXJrIGlzIGEgZ3VpZGUsIG5vdCBhIGNvbnN0cmFpbnQuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSdWxlcih0aWNrcywgZ3JpZE1zLCBmb3JtYXRMYWJlbCwgeyBtYXhMYWJlbHMgPSA2LCBtYXhNaW5vcnMgPSAyNDAgfSA9IHt9KSB7XG4gICAgaWYgKHRpY2tzLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcbiAgICBjb25zdCB0MCA9IHRpY2tzWzBdLCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcbiAgICBjb25zdCBtYXJrcyA9IFtdO1xuICAgIGNvbnN0IGxhYmVsRXZlcnkgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodGlja3MubGVuZ3RoIC8gbWF4TGFiZWxzKSk7XG4gICAgdGlja3MuZm9yRWFjaCgodCwgaSkgPT4gbWFya3MucHVzaCh7XG4gICAgICAgIGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiB0cnVlLFxuICAgICAgICBsYWJlbDogaSAlIGxhYmVsRXZlcnkgPT09IDAgPyBmb3JtYXRMYWJlbCh0KSA6IG51bGwsXG4gICAgfSkpO1xuICAgIGlmIChncmlkTXMgJiYgZ3JpZE1zIDwgc3Bhbikge1xuICAgICAgICBjb25zdCB0b3RhbCA9IE1hdGguZmxvb3Ioc3BhbiAvIGdyaWRNcyk7XG4gICAgICAgIGNvbnN0IHRoaW4gPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodG90YWwgLyBtYXhNaW5vcnMpKTtcbiAgICAgICAgZm9yIChsZXQgayA9IDE7IGsgKiBncmlkTXMgPCBzcGFuOyBrICs9IHRoaW4pIHtcbiAgICAgICAgICAgIGNvbnN0IHQgPSB0MCArIGsgKiBncmlkTXM7XG4gICAgICAgICAgICBpZiAodGlja3MuaW5jbHVkZXModCkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgbWFya3MucHVzaCh7IGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiBmYWxzZSwgbGFiZWw6IG51bGwgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG1hcmtzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGlja0xhYmVsKG1zLCBwZXJpb2RNcykge1xuICAgIGNvbnN0IGlzbyA9IG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpO1xuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgNjAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxOSk7XG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCAyNCAqIDM2MDAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxNik7XG4gICAgcmV0dXJuIGlzby5zbGljZSg1LCAxMCk7XG59XG5cbi8vIEdseXBocyBhcyBpbmxpbmUgU1ZHIHJhdGhlciB0aGFuIHRleHQ6IFwiXHUyMUJCXCIgcmVhZHMgYXMgcmVmcmVzaCAtLSBhIGxvb3AgdG9nZ2xlIGRyYXduIHdpdGhcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xuLy8gdGhlIHByZXNzZWQgc3RhdGUgcmVzdHlsZSB0aGVtIGZyb20gQ1NTLlxuY29uc3QgSUNPTlMgPSB7XG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcbiAgICBwbGF5OiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAybDkgNi05IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGF1c2U6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJoM3YxMkg0ek05IDJoM3YxMkg5elwiLz48L3N2Zz4nLFxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXG4gICAgbG9vcDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTggMmE2IDYgMCAwIDEgNS42NSA0SDE2bC0yLjggMy41TDEwLjQgNmgyLjFBNC41IDQuNSAwIDEgMCAxMi41IDEwbDEuMy43NUE2IDYgMCAxIDEgOCAyelwiLz48L3N2Zz4nLFxufTtcblxuLy8gLS0tIHRoZSBjb250cm9sIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQbGFpbiBET00gaW5zaWRlIHRoZSB3aWRnZXQgY29udGFpbmVyLCBsaWtlIHRoZSBzaWRlYmFyOiBubyBMZWFmbGV0IGNvbnRyb2wgbWFjaGluZXJ5LFxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xuLy8gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MgY29udHJvbCAtLSBzdGVwL3BsYXkvc3RlcC9sb29wIGFzIGEgam9pbmVkIGJ1dHRvbiBiYXIsIHRoZW4gdGhlXG4vLyBkYXRlLCBzbGlkZXIgYW5kIHNwZWVkIC0tIHNpbmNlIHRoYXQgaXMgdGhlIHNsaWRlciB1c2VycyBvZiB0aGUgZm9saXVtIGFwcHMga25vdy5cbi8vXG4vLyBUaGUgc2xpZGVyIGlzIGEgY29tcG9zaXRlLiBBIG5hdGl2ZSA8aW5wdXQgdHlwZT1yYW5nZT4gc3RheXMgb24gdG9wIGFzIHRoZSB0aHVtYjogaXRcbi8vIGtlZXBzIGtleWJvYXJkIGFycm93cywgc2NyZWVuIHJlYWRlcnMgYW5kIGV2ZXJ5IGV4aXN0aW5nIHRlc3Qgd29ya2luZywgYW5kIHBsYXliYWNrXG4vLyBkcml2ZXMgaXQgYXMgYmVmb3JlLiBVbmRlcm5lYXRoIHNpdCB0aGUgcGFydHMgYSBuYXRpdmUgaW5wdXQgY2Fubm90IGRyYXc6IHRoZSB3aW5kb3dcbi8vIHNwYW4gc2hvd2luZyBleGFjdGx5IHdoYXQgaW50ZXJ2YWwgaXMgb24gdGhlIG1hcCwgYSBydWxlciB3aXRoIGxhYmVsbGVkIGludGVydmFsIG1hcmtzXG4vLyBhbmQgdW5sYWJlbGxlZCBnY2QgbWlub3JzLCBhbmQgdGhlIHRyYWlsIGhhbmRsZSAtLSBkcmFnIGl0IGJhY2sgdG8gd2lkZW4gdGhlIHdpbmRvdyBmb3Jcbi8vIGV2ZXJ5IGxheWVyIGF0IG9uY2UsIGRyb3AgaXQgb250byB0aGUgdGh1bWIgdG8gaGFuZCBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJUaW1lQ29udHJvbChjb250YWluZXIsIHN0YXRlLCBoYW5kbGVycykge1xuICAgIGxldCBlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtY29udHJvbFwiKTtcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoZWwpIGVsLnJlbW92ZSgpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKCFlbCkge1xuICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XG4gICAgICAgIGVsLmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1idXR0b25zXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1wbGF5XCIgYXJpYS1sYWJlbD1cIlBsYXlcIj4ke0lDT05TLnBsYXl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtZndkXCIgdGl0bGU9XCJTdGVwIGZvcndhcmRcIiBhcmlhLWxhYmVsPVwiU3RlcCBmb3J3YXJkXCI+JHtJQ09OUy5md2R9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxhYmVsXCI+PC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWNrXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhc2VcIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwYW5cIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXJ1bGVyXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxpbnB1dCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIgdHlwZT1cInJhbmdlXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWlsXCIgcm9sZT1cInNsaWRlclwiIHRhYmluZGV4PVwiMFwiXG4gICAgICAgICAgICAgICAgICAgICAgYXJpYS1sYWJlbD1cIlRyYWlsaW5nIHdpbmRvd1wiIHRpdGxlPVwiRHJhZyBiYWNrIHRvIHdpZGVuIHRoZSB0aW1lIHdpbmRvdzsgZHJvcCBvbiB0aGUgdGh1bWIgdG8gY2xlYXJcIj48L3NwYW4+XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8c2VsZWN0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGVlZFwiIHRpdGxlPVwiUGxheWJhY2sgc3BlZWRcIj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMC41XCI+MC41eDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIxXCI+MXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMlwiPjJ4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjRcIj40eDwvb3B0aW9uPlxuICAgICAgICAgICAgPC9zZWxlY3Q+YDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGVsKTtcblxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtYmFja1wiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwQmFjayk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1md2RcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEZvcndhcmQpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25QbGF5VG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uTG9vcFRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsXG4gICAgICAgICAgICBlID0+IGhhbmRsZXJzLm9uU3BlZWQocGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkpKTtcbiAgICAgICAgY29uc3Qgc2xpZGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKTtcbiAgICAgICAgLy8gYGlucHV0YCBmaXJlcyBwZXIgZHJhZyBzdGVwIGZvciBsaXZlIHNjcnViYmluZzsgdGhlIG1vZGVsIHdyaXRlYmFjayBpcyB0aGVcbiAgICAgICAgLy8gaGFuZGxlcidzIHByb2JsZW0sIHRocm90dGxlZCB0aGVyZSBzbyBkcmFnZ2luZyBkb2VzIG5vdCBmbG9vZCB0aGUga2VybmVsLlxuICAgICAgICBzbGlkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGUgPT4gaGFuZGxlcnMub25TZWVrKHBhcnNlSW50KGUudGFyZ2V0LnZhbHVlLCAxMCkpKTtcblxuICAgICAgICBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKTtcbiAgICB9XG5cbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLm1heCA9IFN0cmluZyhzdGF0ZS50aWNrcy5sZW5ndGggLSAxKTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLmluZGV4KTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbGFiZWxcIikudGV4dENvbnRlbnQgPSBmb3JtYXRVVEMoc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdKTtcblxuICAgIGNvbnN0IHBsYXkgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKTtcbiAgICBwbGF5LmlubmVySFRNTCA9IHN0YXRlLnBsYXlpbmcgPyBJQ09OUy5wYXVzZSA6IElDT05TLnBsYXk7XG4gICAgcGxheS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIik7XG4gICAgcGxheS50aXRsZSA9IHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIjtcblxuICAgIC8vIEEgbW9kZSwgbm90IGFuIGFjdGlvbjogcHJlc3NlZCBzdHlsaW5nIGFuZCBhcmlhLXByZXNzZWQgc2F5IFwidGhpcyBzdGF5cyBvblwiLFxuICAgIC8vIHdoZXJlIGEgYmFyZSBpY29uIGludml0ZWQgYSBjbGljayBleHBlY3Rpbmcgc29tZXRoaW5nIHRvIGhhcHBlbiByaWdodCBub3cuXG4gICAgY29uc3QgbG9vcCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpO1xuICAgIGxvb3AuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCBCb29sZWFuKHN0YXRlLmxvb3ApKTtcbiAgICBsb29wLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcoQm9vbGVhbihzdGF0ZS5sb29wKSkpO1xuICAgIGxvb3AudGl0bGUgPSBzdGF0ZS5sb29wID8gXCJMb29wOiBvblwiIDogXCJMb29wOiBvZmZcIjtcblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5zcGVlZCB8fCAxKTtcbiAgICByZW5kZXJUcmFjayhlbCwgc3RhdGUpO1xuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcbiAgICByZXR1cm4gZWw7XG59XG5cbi8vIEdlb21ldHJ5IHNoYXJlZCBieSByZW5kZXJpbmcgYW5kIGRyYWdnaW5nOiB3aGVyZSBhIHRpbWUgc2l0cyBvbiB0aGUgdHJhY2ssIDAuLjEuXG5mdW5jdGlvbiB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0KSB7XG4gICAgY29uc3Qgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdGlja3NbMF07XG4gICAgaWYgKHNwYW4gPD0gMCkgcmV0dXJuIDE7XG4gICAgcmV0dXJuIE1hdGgubWluKDEsIE1hdGgubWF4KDAsICh0IC0gdGlja3NbMF0pIC8gc3BhbikpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJUcmFjayhlbCwgc3RhdGUpIHtcbiAgICBjb25zdCB7IHRpY2tzLCBpbmRleCB9ID0gc3RhdGU7XG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XG4gICAgdHJhY2suX3N0YXRlID0gc3RhdGU7ICAgICAgLy8gdGhlIGRyYWcgaGFuZGxlciByZWFkcyB0aGUgZnJlc2hlc3Qgc3RhdGUgZnJvbSBoZXJlXG5cbiAgICBjb25zdCB0aHVtYlQgPSB0aWNrc1tpbmRleF07XG4gICAgY29uc3QgcGVyaW9kTXMgPSBzdGF0ZS5wZXJpb2RNcztcbiAgICBjb25zdCB3aW5kb3dNcyA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiBudWxsO1xuICAgIGNvbnN0IHNob3duTXMgPSB3aW5kb3dNcyAhPSBudWxsID8gd2luZG93TXMgOiBwZXJpb2RNcztcblxuICAgIC8vIFRoZSBzcGFuOiB3aGF0IGludGVydmFsIHRoZSBtYXAgaXMgc2hvd2luZyByaWdodCBub3cuIFRoZSBzcGFuIGRlcGljdHMgdGhlIHNoYXJlZFxuICAgIC8vIHdpbmRvdyAtLSBvbmUgcGVyaW9kIGJ5IGRlZmF1bHQgLS0gYW5kIHBlci1sYXllciBkdXJhdGlvbnMgcmVtYWluIGFuIEFQSSBjb25jZXJuXG4gICAgLy8gdW50aWwgYSBkcmFnIG92ZXJyaWRlcyB0aGVtIGZvciBldmVyeXRoaW5nIGF0IG9uY2UuXG4gICAgY29uc3Qgc3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGFuXCIpO1xuICAgIGNvbnN0IHJpZ2h0ID0gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUKTtcbiAgICBjb25zdCBsZWZ0ID0gc2hvd25NcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gc2hvd25NcykgOiAwO1xuICAgIHNwYW4uc3R5bGUubGVmdCA9IGAkeyhsZWZ0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHNwYW4uc3R5bGUud2lkdGggPSBgJHsoTWF0aC5tYXgoMCwgcmlnaHQgLSBsZWZ0KSAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICBzcGFuLmNsYXNzTGlzdC50b2dnbGUoXCJvdmVycmlkZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcblxuICAgIC8vIFRoZSB0cmFpbCBoYW5kbGUgcGFya3MgT04gdGhlIHRodW1iIHdoZW4gbm8gb3ZlcnJpZGUgaXMgYWN0aXZlIC0tIFwibm90IGdyYWJiZWRcIiAtLVxuICAgIC8vIGFuZCBzaXRzIGF0IHRoZSB3aW5kb3cncyBzdGFydCB3aGlsZSBvbmUgaXMuIERyb3BwaW5nIGl0IGJhY2sgb24gdGhlIHRodW1iIGNsZWFycy5cbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcbiAgICBjb25zdCBhdCA9IHdpbmRvd01zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSB3aW5kb3dNcykgOiByaWdodDtcbiAgICB0cmFpbC5zdHlsZS5sZWZ0ID0gYCR7KGF0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHRyYWlsLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgd2luZG93TXMgIT0gbnVsbCk7XG4gICAgdHJhaWwuc2V0QXR0cmlidXRlKFwiYXJpYS12YWx1ZXRleHRcIiwgc3RhdGUud2luZG93IHx8IFwibm8gdHJhaWxpbmcgd2luZG93XCIpO1xuICAgIC8vIE5vIGZpeGVkLW1zIGdyaWQgKGNhbGVuZGFyIHBlcmlvZHMpIG1lYW5zIG5vdGhpbmcgc2Vuc2libGUgdG8gc25hcCB0by5cbiAgICB0cmFpbC5zdHlsZS5kaXNwbGF5ID0gc3RhdGUuZ3JpZE1zID8gXCJcIiA6IFwibm9uZVwiO1xuXG4gICAgY29uc3QgcnVsZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcnVsZXJcIik7XG4gICAgY29uc3Qga2V5ID0gYCR7dGlja3NbMF19fCR7dGlja3MubGVuZ3RofXwke3N0YXRlLmdyaWRNc318JHtwZXJpb2RNc31gO1xuICAgIGlmIChydWxlci5fa2V5ICE9PSBrZXkpIHtcbiAgICAgICAgcnVsZXIuX2tleSA9IGtleTtcbiAgICAgICAgcnVsZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICAgICAgZm9yIChjb25zdCBtYXJrIG9mIGJ1aWxkUnVsZXIodGlja3MsIHN0YXRlLmdyaWRNcywgdCA9PiBmb3JtYXRUaWNrTGFiZWwodCwgcGVyaW9kTXMpKSkge1xuICAgICAgICAgICAgY29uc3QgbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgbS5jbGFzc05hbWUgPSBtYXJrLm1ham9yID8gXCJzd2lmdG1hcC10aW1lLW1hcmsgbWFqb3JcIiA6IFwic3dpZnRtYXAtdGltZS1tYXJrXCI7XG4gICAgICAgICAgICBtLnN0eWxlLmxlZnQgPSBgJHsobWFyay5mcmFjdGlvbiAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICAgICAgICAgIGlmIChtYXJrLmxhYmVsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICAgICAgbGFiLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1tYXJrLWxhYmVsXCI7XG4gICAgICAgICAgICAgICAgbGFiLnRleHRDb250ZW50ID0gbWFyay5sYWJlbDtcbiAgICAgICAgICAgICAgICBtLmFwcGVuZENoaWxkKGxhYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBydWxlci5hcHBlbmRDaGlsZChtKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gRHJhZ2dpbmcgdGhlIHRyYWlsIGhhbmRsZS4gU25hcHMgdG8gdGhlIGdjZCBncmlkIHNvIGV2ZXJ5IHN0b3AgaXMgYSBib3VuZGFyeSB0aGUgZGF0YVxuLy8gb3IgdGhlIGludGVydmFsIGFjdHVhbGx5IG5hbWVzOyB0aGUgZGlzdGFuY2UgdG8gdGhlIHRodW1iLCBpbiB3aG9sZSBncmlkIHN0ZXBzLCBJUyB0aGVcbi8vIHdpbmRvdy4gWmVybyBzdGVwcyAtLSBkcm9wcGVkIG9uIHRoZSB0aHVtYiAtLSBjbGVhcnMgdGhlIG92ZXJyaWRlLlxuZnVuY3Rpb24gYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycykge1xuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xuXG4gICAgZnVuY3Rpb24gaXNvRnJvbUV2ZW50KGV2KSB7XG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xuICAgICAgICBjb25zdCByZWN0ID0gdHJhY2suZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcyB8fCByZWN0LndpZHRoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdW5jbGFtcGVkIG9uIHRoZSBsZWZ0OiB0aGUgd2luZG93IGlzIFwiaG93IGZhciBiYWNrIGZyb20gdGhlXG4gICAgICAgIC8vIGxlYWQgcG9pbnRcIiwgYW5kIHRoYXQgbWF5IHJlYWNoIHBhc3QgdGhlIGJhcidzIHN0YXJ0IC0tIGVzcGVjaWFsbHkgd2hlbiB0aGVcbiAgICAgICAgLy8gbGVhZCBzaXRzIGVhcmx5IG9uIHRoZSBiYXIgYW5kIG1vc3Qgb2YgaXRzIHRyYWlsIGlzIG9mZi1zY3JlZW4uIENsYW1waW5nIGhlcmVcbiAgICAgICAgLy8gY2FwcGVkIHRoZSB3aW5kb3cgYXQgdGhlIHZpc2libGUgcGFzdCwgd2hpY2ggcGlubmVkIHRoZSBoYW5kbGUgdG8gdGhlIGJhcidzXG4gICAgICAgIC8vIHN0YXJ0IGFuZCBtYWRlIGFueXRoaW5nIHdpZGVyIGltcG9zc2libGUgdG8gc2V0LiBPbmx5IHRoZSBEUkFXSU5HIGNsYW1wcy5cbiAgICAgICAgY29uc3QgZnJhYyA9IE1hdGgubWluKDEsIChldi5jbGllbnRYIC0gcmVjdC5sZWZ0KSAvIHJlY3Qud2lkdGgpO1xuICAgICAgICBjb25zdCB0MCA9IHN0YXRlLnRpY2tzWzBdO1xuICAgICAgICBjb25zdCBzcGFuTXMgPSBzdGF0ZS50aWNrc1tzdGF0ZS50aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xuICAgICAgICBjb25zdCB0aHVtYlQgPSBzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF07XG4gICAgICAgIGNvbnN0IGRpc3QgPSB0aHVtYlQgLSAodDAgKyBmcmFjICogc3Bhbk1zKTtcbiAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGRpc3QgLyBzdGF0ZS5ncmlkTXMpKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBzID09PSAwID8gbnVsbCA6IG1zVG9QZXJpb2RJU08oc3RlcHMgKiBzdGF0ZS5ncmlkTXMpO1xuICAgIH1cblxuICAgIC8vIE1vdmUgYW5kIHJlbGVhc2UgbGlzdGVuIG9uIHRoZSBkb2N1bWVudCBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBkcmFnOiB0aGUgaGFuZGxlXG4gICAgLy8gaXMgMTJweCB3aWRlLCB0aGUgY3Vyc29yIGxlYXZlcyBpdCBvbiB0aGUgZmlyc3QgZmFzdCBtb3ZlbWVudCwgYW5kIGV2ZW50cyB0aGF0XG4gICAgLy8gdGFyZ2V0IHdoYXRldmVyIGlzIHVuZGVybmVhdGggd291bGQgc3R1dHRlciB0aGUgZHJhZyBhbmQgY291bGQgc3dhbGxvdyB0aGUgcmVsZWFzZVxuICAgIC8vIGVudGlyZWx5IC0tIGFuIHVuY29tbWl0dGVkIGRyYWcgdGhlbiBzbmFwcyBiYWNrIG9uIHRoZSBuZXh0IHN5bmMuXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIC8vIENhcHR1cmUgcmV0YXJnZXRzIGV2ZXJ5IHBvaW50ZXIgZXZlbnQgdG8gdGhlIGhhbmRsZSB1bnRpbCByZWxlYXNlLCBubyBtYXR0ZXJcbiAgICAgICAgLy8gd2hlcmUgdGhlIGN1cnNvciBpcy4gV2l0aG91dCBpdCwgbGV0dGluZyBnbyB3aXRoIHRoZSBwb2ludGVyIG92ZXIgdGhlIG1hcCBoYW5kc1xuICAgICAgICAvLyBwb2ludGVydXAgdG8gTGVhZmxldCdzIGNvbnRhaW5lciBoYW5kbGVycywgYW5kIGEgcmVsZWFzZSB0aGV5IHN3YWxsb3cgbmV2ZXJcbiAgICAgICAgLy8gcmVhY2hlcyB0aGUgZG9jdW1lbnQgbGlzdGVuZXIgLS0gdGhlIGRyYWcgc3RheXMgdW5jb21taXR0ZWQgYW5kIHRoZSBuZXh0IHN5bmNcbiAgICAgICAgLy8gc25hcHMgdGhlIGhhbmRsZSBob21lLiBUaGUgZG9jdW1lbnQgbGlzdGVuZXJzIGJlbG93IHJlbWFpbiBhcyB0aGUgZmFsbGJhY2sgZm9yXG4gICAgICAgIC8vIGVudmlyb25tZW50cyB3aXRob3V0IGNhcHR1cmU7IHdpdGggaXQsIHJldGFyZ2V0ZWQgZXZlbnRzIHN0aWxsIGJ1YmJsZSB0byB0aGVtLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKSB0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZShldi5wb2ludGVySWQpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogc3ludGhldGljIGV2ZW50cyBoYXZlIG5vIGFjdGl2ZSBwb2ludGVyOyBmYWxsIGJhY2sgdG8gYnViYmxpbmcgKi8gfVxuXG4gICAgICAgIGNvbnN0IG1vdmUgPSBlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGZpbmlzaCA9IGUgPT4ge1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dDb21taXQoaXNvKTtcbiAgICAgICAgfTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XG4gICAgfSk7XG5cbiAgICAvLyBLZXlib2FyZDogb25lIGdyaWQgc3RlcCBwZXIgYXJyb3csIERlbGV0ZS9Ib21lIHRvIGNsZWFyLiBTYW1lIGNvbnRyYWN0IGFzIHRoZSBkcmFnLlxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcykgcmV0dXJuO1xuICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IDA7XG4gICAgICAgIGxldCBuZXh0O1xuICAgICAgICBpZiAoZXYua2V5ID09PSBcIkFycm93TGVmdFwiKSBuZXh0ID0gY3VycmVudCArIHN0YXRlLmdyaWRNcztcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkFycm93UmlnaHRcIikgbmV4dCA9IE1hdGgubWF4KDAsIGN1cnJlbnQgLSBzdGF0ZS5ncmlkTXMpO1xuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiRGVsZXRlXCIgfHwgZXYua2V5ID09PSBcIkhvbWVcIikgbmV4dCA9IDA7XG4gICAgICAgIGVsc2UgcmV0dXJuO1xuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChuZXh0ID4gMCA/IG1zVG9QZXJpb2RJU08obmV4dCkgOiBudWxsKTtcbiAgICB9KTtcbn1cbiIsICIvLyBUaW1lIGZpbHRlcmluZyBvbiB0aGUgR1BVLCBmb3IgcG9pbnQgbGF5ZXJzLlxyXG4vL1xyXG4vLyBUaGUgY29vcmRpbmF0ZXMgYWxyZWFkeSBsaXZlIGluIEdQVSBidWZmZXJzOyByZWJ1aWxkaW5nIHRoZSBtZXJnZWQgbGF5ZXIgcGVyIHRpY2sgdGhyZXdcclxuLy8gdGhhdCBhd2F5IGFuZCByZS1mZWQgZ2xpZnkgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTIC0tIG1lYXN1cmVkIGF0IH4yLjZzIHBlciB3aW5kb3dcclxuLy8gY2hhbmdlIGF0IHRoYXQgc2NhbGUsIHdpdGggYWxsb2NhdGlvbiBjaHVybiB0aGF0IGNvdWxkIGNyYXNoIHRoZSB0YWIgd2hlbiBjaGFuZ2VzXHJcbi8vIHN0YWNrZWQuIEluc3RlYWQsIGVhY2ggcG9pbnQncyB0aW1lIGludGVydmFsIGFuZCBpdHMgbGF5ZXIncyBkdXJhdGlvbiByaWRlIGFsb25nIGFzXHJcbi8vIHZlcnRleCBhdHRyaWJ1dGVzIHVwbG9hZGVkIG9uY2UsIGFuZCB0aGUgY3VycmVudCB0aWNrIGlzIGEgdW5pZm9ybTogYSB0aWNrIG9yIHdpbmRvd1xyXG4vLyBjaGFuZ2UgY29zdHMgdHdvIGZsb2F0cyBhbmQgYSByZWRyYXcuXHJcbi8vXHJcbi8vIGdsaWZ5IG1ha2VzIHRoaXMgcG9zc2libGUgd2l0aG91dCBmb3JraW5nIGl0OiB2ZXJ0ZXhTaGFkZXJTb3VyY2UgaXMgYW4gb3ZlcnJpZGFibGVcclxuLy8gc2V0dGluZyAodGhlIHBpbiBmcmFnbWVudCBzaGFkZXIgYWxyZWFkeSB1c2VzIHRoZSBzYW1lIGRvb3IpLCBpbnN0YW5jZXMgZXhwb3NlIHRoZWlyXHJcbi8vIGdsL3Byb2dyYW0vY2FudmFzLCBhdHRyaWJ1dGVzIGFyZSBib3VuZCBvbmNlIGF0IHNldHVwLCBhbmQgdGhlIHBlci1mcmFtZSBkcmF3IHRvdWNoZXNcclxuLy8gb25seSB0aGUgbWF0cml4IHVuaWZvcm0gLS0gc28gZXh0cmEgYXR0cmlidXRlcyBib3VuZCBhZnRlciBzZXR1cCBwZXJzaXN0LCBhbmQgdW5pZm9ybVxyXG4vLyB1cGRhdGVzIHRha2UgZWZmZWN0IG9uIHRoZSBuZXh0IHJlZHJhdy5cclxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIHBlcmlvZFRvTXMsIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFRpbWVzIHRyYXZlbCBhcyBmbG9hdDMyIG9uIHRoZSBHUFUsIHdob3NlIGludGVnZXJzIGFyZSBleGFjdCBvbmx5IHRvIDJeMjQuIEVwb2NoIG1zIGlzXHJcbi8vIGhvcGVsZXNzIGF0IHRoYXQgcHJlY2lzaW9uLCBzbyB0aW1lcyBhcmUgcmViYXNlZCB0byB0aGUgYnVja2V0J3MgZWFybGllc3Qgc3RhcnQgYW5kXHJcbi8vIGV4cHJlc3NlZCBpbiBzZWNvbmRzOiBleGFjdCB0byB+MTk0IGRheXMgb2Ygc3BhbiwgYW5kIGEgMnMgcm91bmRpbmcgYmV5b25kIHRoYXQgaXNcclxuLy8gaW52aXNpYmxlIGF0IGFueSB6b29tIGEgdGltZSBzbGlkZXIgbWFrZXMgc2Vuc2UgYXQuXHJcbmNvbnN0IEFMV0FZUyA9IDYuM2U4OyAgIC8vIH4yMCB5ZWFycywgaW4gc2Vjb25kczogdGhlIFwiZHVyYXRpb25cIiBvZiBjdW11bGF0aXZlIGxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHRoZSBzcGFuIGhhbGYtd2lkdGggb2YgcG9pbnRzIHdpdGggbm8gcmVhZGFibGUgdGltZS5cclxuXHJcbi8vIFBlci1idWNrZXQgbGF5ZXItdmlzaWJpbGl0eSBzbG90cyBpbiB0aGUgdmVydGV4IHNoYWRlci4gRWFjaCBmbG9hdCBhcnJheSBlbGVtZW50XHJcbi8vIG9jY3VwaWVzIGEgZnVsbCB1bmlmb3JtIHZlY3RvciBpbiBFUyBHTFNMIHBhY2tpbmcsIGFuZCB0aGUgc3BlYyBndWFyYW50ZWVzIG9ubHkgMTI4XHJcbi8vIHZlcnRleCB1bmlmb3JtIHZlY3RvcnMgLS0gNjQgc2xvdHMgbGVhdmVzIGNvbWZvcnRhYmxlIHJvb20gZm9yIHRoZSBtYXRyaXggYW5kIHRoZSB0aW1lXHJcbi8vIHVuaWZvcm1zLiBBIGJ1Y2tldCB3aXRoIG1vcmUgbGF5ZXJzIHRoYW4gc2xvdHMgZmFsbHMgYmFjayB0byByZWJ1aWxkLXBlci10b2dnbGUuXHJcbi8vIChQYWNraW5nIGZvdXIgbGF5ZXJzIHBlciB2ZWM0IHdvdWxkIHF1YWRydXBsZSB0aGlzIGlmIGFueW9uZSBldmVyIG5lZWRzIGl0LilcclxuZXhwb3J0IGNvbnN0IExBWUVSX1NMT1RTID0gNjQ7XHJcblxyXG4vLyBDaGVhcCBraWxsIHN3aXRjaGVzOiBpZiB3aXJpbmcgdGhlIEdMIHN0YXRlIGV2ZXIgZmFpbHMgKGEgZnV0dXJlIGdsaWZ5IHZlcnNpb24gbW92aW5nXHJcbi8vIGl0cyBpbnRlcm5hbHMpLCB0aGUgYWZmZWN0ZWQgZmFtaWx5IGZhbGxzIGJhY2sgdG8gdGhlIENQVSByZWJ1aWxkIHBhdGguIFBvaW50cyBhbmRcclxuLy8gdmVjdG9ycyBhcmUgc2VwYXJhdGUgZmxhZ3MgLS0gYSB2ZWN0b3IgaW50cm9zcGVjdGlvbiBmYWlsdXJlIG11c3Qgbm90IGNvc3QgcG9pbnRzXHJcbi8vIHRoZWlyIEdQVSBwYXRoLlxyXG5sZXQgZ3B1T2sgPSB0cnVlO1xyXG5leHBvcnQgZnVuY3Rpb24gZ3B1VGltZUF2YWlsYWJsZSgpIHsgcmV0dXJuIGdwdU9rOyB9XHJcbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlR3B1VGltZShyZWFzb24pIHtcclxuICAgIGlmIChncHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZpbHRlcmluZyBkaXNhYmxlZDogJHtyZWFzb259LiBgICtcclxuICAgICAgICBgRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2suYCk7XHJcbiAgICBncHVPayA9IGZhbHNlO1xyXG59XHJcbmxldCB2ZWN0b3JHcHVPayA9IHRydWU7XHJcbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JHcHVBdmFpbGFibGUoKSB7IHJldHVybiB2ZWN0b3JHcHVPazsgfVxyXG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZVZlY3RvckdwdShyZWFzb24pIHtcclxuICAgIGlmICh2ZWN0b3JHcHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZvciBsaW5lcy9wb2x5Z29ucyBkaXNhYmxlZDogYCArXHJcbiAgICAgICAgYCR7cmVhc29ufS4gRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2sgZm9yIHRob3NlIGJ1Y2tldHMuYCk7XHJcbiAgICB2ZWN0b3JHcHVPayA9IGZhbHNlO1xyXG59XHJcblxyXG4vLyBUaGUgZGVmYXVsdCBwb2ludHMgdmVydGV4IHNoYWRlciAocmVhZCBvdXQgb2YgbGVhZmxldC5nbGlmeSAzLjMuMCkgd2l0aCB0aGUgd2luZG93XHJcbi8vIHRlc3QgYWRkZWQuIEEgaGlkZGVuIHBvaW50IGdldHMgc2l6ZSAwIGFuZCBhIHBvc2l0aW9uIG91dHNpZGUgY2xpcCBzcGFjZSwgc28gbmVpdGhlclxyXG4vLyB0aGUgdmlzaWJsZSBwYXNzIG5vciB0aGUgc2hhcmVkLXByb2dyYW0gcGlja2luZyBwYXNzIGV2ZXIgcmFzdGVyaXNlcyBpdC5cclxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVWZXJ0ZXhTaGFkZXIoKSB7XHJcbiAgICByZXR1cm4gYHVuaWZvcm0gbWF0NCBtYXRyaXg7XHJcbmF0dHJpYnV0ZSB2ZWM0IHZlcnRleDtcclxuYXR0cmlidXRlIHZlYzQgY29sb3I7XHJcbmF0dHJpYnV0ZSBmbG9hdCBwb2ludFNpemU7XHJcbmF0dHJpYnV0ZSB2ZWMyIGFUaW1lU3BhbjtcclxuYXR0cmlidXRlIGZsb2F0IGFEdXJhdGlvbjtcclxuYXR0cmlidXRlIGZsb2F0IGFMYXllcjtcclxudW5pZm9ybSBmbG9hdCB1VGljaztcclxudW5pZm9ybSBmbG9hdCB1T3ZlcnJpZGU7XHJcbnVuaWZvcm0gZmxvYXQgdUxheWVyVmlzWyR7TEFZRVJfU0xPVFN9XTtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxuXHJcbnZvaWQgbWFpbigpIHtcclxuICAvLyBBIG5lZ2F0aXZlIGR1cmF0aW9uIGlzIHRoZSBmYWRlIGZsYWc6IHxhRHVyYXRpb258IGlzIHRoZSB3aW5kb3csIHRoZSBzaWduIHNheXMgdGhpc1xyXG4gIC8vIHBvaW50IGRpbXMgd2l0aCBhZ2UuIEEgc2hhcmVkIG92ZXJyaWRlIGtlZXBzIHRoZSBwb2ludCdzIG93biBmYWRlIHByZWZlcmVuY2UuXHJcbiAgYm9vbCBmYWRlcyA9IGFEdXJhdGlvbiA8IDAuMDtcclxuICBmbG9hdCBkdXIgPSB1T3ZlcnJpZGUgPj0gMC4wID8gdU92ZXJyaWRlIDogYWJzKGFEdXJhdGlvbik7XHJcbiAgLy8gSGFsZi1vcGVuICh0aWNrIC0gZHVyLCB0aWNrXSwgbWF0Y2hpbmcgZmVhdHVyZUluV2luZG93IG9uIHRoZSBDUFUgc2lkZSAtLSBBTkRlZCB3aXRoXHJcbiAgLy8gdGhlIHBvaW50J3MgbGF5ZXIgYmVpbmcgdmlzaWJsZS4gTGF5ZXIgdG9nZ2xlcyBhcmUgb25lIHVuaWZvcm0gZWxlbWVudCwgbm90IGFcclxuICAvLyByZWJ1aWxkOiB1bmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZS1mZWVkIGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUy5cclxuICBib29sIHZpc2libGUgPSBhVGltZVNwYW4ueSA+ICh1VGljayAtIGR1cikgJiYgYVRpbWVTcGFuLnggPD0gdVRpY2tcclxuICAgICAgJiYgdUxheWVyVmlzW2ludChhTGF5ZXIpXSA+IDAuNTtcclxuICBnbF9Qb2ludFNpemUgPSB2aXNpYmxlID8gcG9pbnRTaXplIDogMC4wO1xyXG4gIGdsX1Bvc2l0aW9uID0gdmlzaWJsZSA/IG1hdHJpeCAqIHZlcnRleCA6IHZlYzQoMi4wLCAyLjAsIDIuMCwgMS4wKTtcclxuICAvLyBBZ2UgcnVucyBmcm9tIHRoZSBmZWF0dXJlJ3MgZW5kOyBuZXdlc3QgaXMgb3BhcXVlLCB0aGUgdHJhaWxpbmcgZWRnZSByZWFjaGVzIHplcm8uXHJcbiAgZmxvYXQgYWxwaGEgPSBmYWRlcyA/IGNsYW1wKDEuMCAtICh1VGljayAtIGFUaW1lU3Bhbi55KSAvIGR1ciwgMC4wLCAxLjApIDogMS4wO1xyXG4gIF9jb2xvciA9IHZlYzQoY29sb3IucmdiLCBjb2xvci5hICogYWxwaGEpO1xyXG59XHJcbmA7XHJcbn1cclxuXHJcbi8vIFBlci1sYXllciBkdXJhdGlvbiBpbiBzZWNvbmRzOiBudWxsIGFjY3VtdWxhdGVzLCBcInBlcmlvZFwiIGlzIHRoZSBzaGFyZWQgaW50ZXJ2YWwsXHJcbi8vIGFuIElTTyBzdHJpbmcgaXMgaXRzZWxmOyBhbnl0aGluZyB1bnBhcnNlYWJsZSBmYWxscyBiYWNrIHRvIHRoZSBpbnRlcnZhbC5cclxuZnVuY3Rpb24gZHVyYXRpb25TZWNvbmRzKHNwZWMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoc3BlYyA9PT0gbnVsbCB8fCBzcGVjID09PSB1bmRlZmluZWQpIHJldHVybiBBTFdBWVM7XHJcbiAgICBpZiAoc3BlYyA9PT0gXCJwZXJpb2RcIikgcmV0dXJuIChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XHJcbiAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xyXG4gICAgcmV0dXJuIG1zID8gbXMgLyAxMDAwIDogKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcclxufVxyXG5cclxuLy8gQnVpbGRzIHRoZSBwZXItcG9pbnQgYXR0cmlidXRlIGFycmF5cyBmb3Igb25lIG1lcmdlZCBidWNrZXQsIGluIHRoZSBleGFjdCBvcmRlciB0aGVcclxuLy8gYnVja2V0IGZlZWRzIHBvaW50cyB0byBnbGlmeTogbGF5ZXIgYnkgbGF5ZXIsIGluZGV4IDAuLm4tMSwgd2l0aCBzaW5nbGUtYGxvY2F0aW9uYFxyXG4vLyBsYXllcnMgY29udHJpYnV0aW5nIG9uZSBwb2ludC4gUG9pbnRzIGluIGxheWVycyB3aXRob3V0IHRpbWUgbWV0YWRhdGEgLS0gYW5kIHBvaW50c1xyXG4vLyB3aG9zZSB0aW1lIHdhcyB1bnJlYWRhYmxlIChOYU4pIC0tIGdldCBhIHNwYW4gdGhhdCBpcyB2aXNpYmxlIGF0IGV2ZXJ5IHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGxldCBoYXNUaW1lID0gZmFsc2U7XHJcbiAgICBjb25zdCBwZXJMYXllciA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgIGNvbnN0IGNvdW50ID0gYnVmID8gYnVmLmJ5dGVMZW5ndGggLyAxNiA6IChsYXllci5sb2NhdGlvbiA/IDEgOiAwKTtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBpZiAobGF5ZXIudGltZSkgaGFzVGltZSA9IHRydWU7XHJcbiAgICAgICAgcGVyTGF5ZXIucHVzaCh7IGxheWVyLCBjb3VudCwgdGltZXMgfSk7XHJcbiAgICAgICAgdG90YWwgKz0gY291bnQ7XHJcbiAgICB9XHJcbiAgICBpZiAoIWhhc1RpbWUpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcblxyXG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcclxuICAgIGZvciAoY29uc3QgeyB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBjb25zdCBsYXllcklkcyA9IFtdO1xyXG4gICAgbGV0IG91dCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJJZHMubGVuZ3RoO1xyXG4gICAgICAgIGxheWVySWRzLnB1c2gobGF5ZXIuaWQpO1xyXG4gICAgICAgIGNvbnN0IGR1ciA9IGxheWVyLnRpbWUgPyBkdXJhdGlvblNlY29uZHMobGF5ZXIudGltZS5kdXJhdGlvbiwgcGVyaW9kTXMpIDogQUxXQVlTO1xyXG4gICAgICAgIC8vIFRoZSBmYWRlIGZsYWcgcmlkZXMgdGhlIGR1cmF0aW9uJ3Mgc2lnbiwgc28gaXQgY29zdHMgbm8gZXh0cmEgYXR0cmlidXRlLlxyXG4gICAgICAgIC8vIFRpbWVsZXNzIChOYU4pIHBvaW50cyBrZWVwIGEgcG9zaXRpdmUgZHVyYXRpb246IHdpdGggbm8gYWdlLCBub3RoaW5nIHRvIGZhZGUuXHJcbiAgICAgICAgY29uc3Qgc2lnbmVkRHVyID0gbGF5ZXIudGltZSAmJiBsYXllci50aW1lLmZhZGUgPyAtZHVyIDogZHVyO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IHRpbWVzID8gdGltZXNbaSAqIDJdIDogTmFOO1xyXG4gICAgICAgICAgICBjb25zdCBlbmQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyICsgMV0gOiBOYU47XHJcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpKSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IC1BTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IChzdGFydCAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IChlbmQgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBzaWduZWREdXI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGlkeDtcclxuICAgICAgICAgICAgb3V0Kys7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgc3BhbnMsIGR1cnMsIGxheWVySWR4LCBsYXllcklkcywgY291bnQ6IHRvdGFsIH07XHJcbn1cclxuXHJcbi8vIFBlci1mZWF0dXJlIHRpbWUgbWV0YWRhdGEgZm9yIGEgdmVjdG9yIGJ1Y2tldCAobGluZXMvcG9seWdvbnMpLiBTYW1lIGVuY29kaW5ncyBhc1xyXG4vLyB0aGUgcG9pbnQgcGF0aCAtLSByZWJhc2VkIGZsb2F0MzIgc2Vjb25kcywgc2lnbi1wYWNrZWQgZmFkZSwgYWx3YXlzLXZpc2libGUgc3BhbnNcclxuLy8gZm9yIHRpbWVsZXNzIG9yIG5vbi10aW1lIGxheWVycy5cclxuLy9cclxuLy8gQSBwb2x5bGluZSB3aG9zZSA6OnRpbWVzIGJ1ZmZlciBob2xkcyBvbmUgW3N0YXJ0LCBlbmRdIHBhaXIgUEVSIFZFUlRFWCBhbmltYXRlc1xyXG4vLyBwZXIgc2VnbWVudCB3aXRoaW4gb25lIGxheWVyOiBzZWdtZW50IGsgc3BhbnMgdmVydGV4IGsncyBzdGFydCB0byB2ZXJ0ZXggaysxJ3NcclxuLy8gZW5kLCBhbmQgYmVjYXVzZSBnbGlmeSBidWlsZHMgMiBkZWRpY2F0ZWQgR0wgdmVydGljZXMgcGVyIHNlZ21lbnQgLS0gc2VnbWVudHNcclxuLy8gbmV2ZXIgc2hhcmUgdmVydGljZXMgLS0gYm90aCBlbmRwb2ludHMgY2FycnkgdGhlIHNhbWUgc3BhbiBhbmQgc2VnbWVudHMgYXBwZWFyXHJcbi8vIGF0b21pY2FsbHkuIFRoYXQgaXMgd2hhdCBsZXRzIGEgd2hvbGUgc2VnbWVudGVkIHRyYWNrIHJpZGUgT05FIGxheWVyIHNsb3QgdGhlIHdheVxyXG4vLyBhIDIwMGstcG9pbnQgbGF5ZXIgZG9lcywgaW5zdGVhZCBvZiBvbmUgc2xvdCBwZXIgY2h1bmsgYWdhaW5zdCB0aGUgNjQgY2VpbGluZy5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBwZXJGZWF0dXJlID0gbGF5ZXJzTGlzdC5tYXAoKGxheWVyLCBpZHgpID0+IHtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcclxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XHJcbiAgICAgICAgaWYgKCF0aW1lcyB8fCAodGltZXMubGVuZ3RoID09PSAyICYmIE51bWJlci5pc05hTih0aW1lc1swXSkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiAtQUxXQVlTLCBlbmQ6IEFMV0FZUywgZHVyOiBBTFdBWVMsIGlkeCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBuVmVydHMgPSB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIiAmJiB0aW1lcy5sZW5ndGggPiAyXHJcbiAgICAgICAgICAgICAgICAmJiB0aW1lcy5sZW5ndGggPT09IG5WZXJ0cyAqIDIpIHtcclxuICAgICAgICAgICAgLy8gU2VnbWVudHMgbmV2ZXIgY3Jvc3MgYSBwYXJ0IGJvdW5kYXJ5OiBhIG11bHRpLXBhcnQgbGluZSBkcmF3c1xyXG4gICAgICAgICAgICAvLyBuVmVydHMgLSBwYXJ0cyBzZWdtZW50cywgYW5kIGEgc3BhbiBidWlsdCBmcm9tIG9uZSBwYXJ0J3MgbGFzdFxyXG4gICAgICAgICAgICAvLyB2ZXJ0ZXggdG8gdGhlIG5leHQgcGFydCdzIGZpcnN0IHdvdWxkIGJlIHRoZSBwaGFudG9tIHNlZ21lbnRcclxuICAgICAgICAgICAgLy8gcmVhcHBlYXJpbmcgaW4gdGhlIHRpbWUgcGF0aCAtLSBvbmUgZXh0cmEgc3BhbiwgYW5kIGV2ZXJ5IGF0dHJpYnV0ZVxyXG4gICAgICAgICAgICAvLyBhZnRlciBpdCBzaGVhcnMgKHRoZSBsZW5ndGggY2hlY2sgdGhlbiBkcm9wcyB0aGUgd2hvbGUgZmVhdHVyZSB0b1xyXG4gICAgICAgICAgICAvLyBpdHMgb3ZlcmFsbCBzcGFuKS4gV2FsayB0aGUgcGFydHMgdGhlIHdheSB0aGUgcmVuZGVyZXIgZHJhd3MgdGhlbS5cclxuICAgICAgICAgICAgY29uc3QgbGVuZ3RocyA9IEFycmF5LmlzQXJyYXkobGF5ZXIucGFydHMpICYmIGxheWVyLnBhcnRzLmxlbmd0aCA+IDFcclxuICAgICAgICAgICAgICAgID8gbGF5ZXIucGFydHMgOiBbblZlcnRzXTtcclxuICAgICAgICAgICAgY29uc3Qgc2VncyA9IGxlbmd0aHMucmVkdWNlKChhLCBuKSA9PiBhICsgTWF0aC5tYXgoMCwgbiAtIDEpLCAwKTtcclxuICAgICAgICAgICAgY29uc3Qgc2VnID0gbmV3IEZsb2F0NjRBcnJheShzZWdzICogMik7XHJcbiAgICAgICAgICAgIGxldCBrID0gMCwgb2Zmc2V0ID0gMDtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBuIG9mIGxlbmd0aHMpIHtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGogPSAwOyBqICsgMSA8IG47IGorKykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHMgPSB0aW1lc1sob2Zmc2V0ICsgaikgKiAyXTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBlID0gdGltZXNbKG9mZnNldCArIGogKyAxKSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHMpIHx8IE51bWJlci5pc05hTihlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gLUFMV0FZUzsgICAgICAvLyBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDIgKyAxXSA9IEFMV0FZUztcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gKHMgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gKGUgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGsrKztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG9mZnNldCArPSBuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIE92ZXJhbGwgc3BhbiByaWRlcyBhbG9uZyBhcyB0aGUgZmFsbGJhY2sgaWYgY291bnRzIGV2ZXIgbWlzYWxpZ24uXHJcbiAgICAgICAgICAgIHJldHVybiB7IHNlZywgc3RhcnQ6IHNlZ1swXSwgZW5kOiBzZWdbc2VnLmxlbmd0aCAtIDFdLFxyXG4gICAgICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAodGltZXNbMF0gLSBiYXNlKSAvIDEwMDAsIGVuZDogKHRpbWVzWzFdIC0gYmFzZSkgLyAxMDAwLFxyXG4gICAgICAgICAgICAgICAgIGR1cjogc2lnbmVkRHVyLCBpZHggfTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgcGVyRmVhdHVyZSwgbGF5ZXJJZHM6IGxheWVyc0xpc3QubWFwKGwgPT4gbC5pZCkgfTtcclxufVxyXG5cclxuLy8gQSB2ZWN0b3IgbGF5ZXIncyB2ZXJ0ZXggY291bnQgZnJvbSB3aGljaGV2ZXIgdHJhbnNwb3J0IGNhcnJpZXMgaXRzIGNvb3JkaW5hdGVzOlxyXG4vLyB0aGUgYmluYXJ5IGJ1ZmZlciAoMiBmbG9hdDY0IHBlciB2ZXJ0ZXgpIG9yIGlubGluZSBgbG9jYXRpb25zYC5cclxuZnVuY3Rpb24gdmVydGV4Q291bnRPZihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmIChyYXcpIHJldHVybiAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCB8fCAwKSAvIDE2O1xyXG4gICAgcmV0dXJuIChsYXllci5sb2NhdGlvbnMgfHwgW10pLmxlbmd0aDtcclxufVxyXG5cclxuLy8gRXhwYW5kcyBwZXItZmVhdHVyZSB2YWx1ZXMgdG8gcGVyLUdMLXZlcnRleCBhcnJheXMgZ2l2ZW4gZWFjaCBmZWF0dXJlJ3MgdmVydGV4IGNvdW50LlxyXG4vLyBQdXJlLCBzbyB0aGUgYWxpZ25tZW50IGxvZ2ljIGlzIHRpZXItMSB0ZXN0YWJsZSBhd2F5IGZyb20gYW55IEdMIGNvbnRleHQuXHJcbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQZXJGZWF0dXJlKHBlckZlYXR1cmUsIGNvdW50cykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGZvciAoY29uc3QgYyBvZiBjb3VudHMpIHRvdGFsICs9IGM7XHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBsZXQgb3V0ID0gMDtcclxuICAgIHBlckZlYXR1cmUuZm9yRWFjaCgoZiwgaSkgPT4ge1xyXG4gICAgICAgIC8vIFBlci1zZWdtZW50IHNwYW5zOiBHTCB2ZXJ0ZXggdiBiZWxvbmdzIHRvIHNlZ21lbnQgdiA+PiAxIChnbGlmeSBkcmF3c1xyXG4gICAgICAgIC8vIDIgZGVkaWNhdGVkIHZlcnRpY2VzIHBlciBzZWdtZW50KSwgc28gYm90aCBlbmRwb2ludHMgdGFrZSB0aGUgc2VnbWVudCdzXHJcbiAgICAgICAgLy8gc3BhbiBhbmQgYSBzZWdtZW50IGFwcGVhcnMgb3IgZGlzYXBwZWFycyBhdG9taWNhbGx5LiBzZWcgaG9sZHMgc2VncyoyXHJcbiAgICAgICAgLy8gZmxvYXRzIGFuZCB0aGUgZmVhdHVyZSBkcmF3cyBzZWdzKjIgR0wgdmVydGljZXMsIHNvIHRoZSBsZW5ndGhzIGFncmVlaW5nXHJcbiAgICAgICAgLy8gaXMgdGhlIGFsaWdubWVudCBjaGVjazsgYSBtaXNtYXRjaCBmYWxscyBiYWNrIHRvIHRoZSB3aG9sZS1mZWF0dXJlIHNwYW5cclxuICAgICAgICAvLyByYXRoZXIgdGhhbiBzaGVhcmluZyBldmVyeSBhdHRyaWJ1dGUgYWZ0ZXIgaXQuXHJcbiAgICAgICAgY29uc3QgcGVyU2VnbWVudCA9IGYuc2VnICYmIGYuc2VnLmxlbmd0aCA9PT0gY291bnRzW2ldID8gZi5zZWcgOiBudWxsO1xyXG4gICAgICAgIGZvciAobGV0IHYgPSAwOyB2IDwgY291bnRzW2ldOyB2KyspIHtcclxuICAgICAgICAgICAgY29uc3QgayA9IHBlclNlZ21lbnQgPyAodiA+PiAxKSAqIDIgOiAtMTtcclxuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrXSA6IGYuc3RhcnQ7XHJcbiAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IHBlclNlZ21lbnQgPyBwZXJTZWdtZW50W2sgKyAxXSA6IGYuZW5kO1xyXG4gICAgICAgICAgICBkdXJzW291dF0gPSBmLmR1cjtcclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGYuaWR4O1xyXG4gICAgICAgICAgICBvdXQrKztcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB7IHNwYW5zLCBkdXJzLCBsYXllcklkeCB9O1xyXG59XHJcblxyXG4vLyBnbGlmeSdzIHZlcnRleCBsYXlvdXQ6IDYgZmxvYXRzIHBlciBHTCB2ZXJ0ZXggKHgsIHksIHIsIGcsIGIsIGEpLCBjb25maXJtZWQgZm9yIDMuMy4wXHJcbi8vIGJvdGggYnkgcmVhZGluZyB0aGUgc291cmNlIGFuZCBieSB0aGUgVmFsaGFsbGEtVlJFIHJlcG9ydCdzIGRlYnVnIGR1bXAgLS0gdHdvXHJcbi8vIG9uZS1zZWdtZW50IGxpbmVzIHByb2R1Y2VkIGFsbFZlcnRpY2VzVHlwZWQgb2YgMjQgZmxvYXRzOiAyIGZlYXR1cmVzIHggMiB2ZXJ0aWNlcyB4IDYuXHJcbmNvbnN0IEZMT0FUU19QRVJfVkVSVEVYID0gNjtcclxuXHJcbi8vIFdpcmVzIHRpbWUgKyBsYXllci12aXNpYmlsaXR5IGludG8gYSBsaXZlIGdsaWZ5IExJTkVTIG9yIFNIQVBFUyBpbnN0YW5jZS4gVGhlIGNhbGxlclxyXG4vLyBzdXBwbGllcyBwZXItZmVhdHVyZSBHTC12ZXJ0ZXggY291bnRzIGNvbXB1dGVkIGZyb20gdGhlIGdlb21ldHJ5IGl0IGJ1aWx0IGl0c2VsZjpcclxuLy8gbGluZXMgZHJhdyAyKihwb2ludHMtMSkgdmVydGljZXMgcGVyIGZlYXR1cmUsIGFuZCBhbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHNpbXBsZSByaW5nXHJcbi8vIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3MgZWFyY3V0LiBUaGUgY291bnRzXHJcbi8vIGFyZSB2YWxpZGF0ZWQgYWdhaW5zdCB0aGUgaW5zdGFuY2UncyBhY3R1YWwgYnVmZmVyIGxlbmd0aCwgYW5kIGFueSBtaXNtYXRjaCBkaXNhYmxlc1xyXG4vLyB0aGUgdmVjdG9yIEdQVSBwYXRoIHJhdGhlciB0aGFuIG1pcy1hbGlnbmluZyBhdHRyaWJ1dGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UoaW5zdGFuY2UsIG1ldGEsIGNvdW50cykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY291bnRzKSB8fCBjb3VudHMubGVuZ3RoICE9PSBtZXRhLnBlckZlYXR1cmUubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgZXhwZWN0ZWQgJHttZXRhLnBlckZlYXR1cmUubGVuZ3RofSB2ZXJ0ZXggY291bnRzLCBgICtcclxuICAgICAgICAgICAgICAgIGBnb3QgJHtjb3VudHMgJiYgY291bnRzLmxlbmd0aH1gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgZXhwZWN0ZWQgPSBjb3VudHMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgKiBGTE9BVFNfUEVSX1ZFUlRFWDtcclxuICAgICAgICAvLyBMaW5lcyBrZWVwIGEgdHlwZWQgZmxhdCBidWZmZXI7IHNoYXBlcyBrZWVwIGEgcGxhaW4gZmxhdCBhcnJheS4gRWl0aGVyIGlzIHRoZVxyXG4gICAgICAgIC8vIGdyb3VuZCB0cnV0aCBmb3IgaG93IG1hbnkgR0wgdmVydGljZXMgZ2xpZnkgYWN0dWFsbHkgYnVpbHQuXHJcbiAgICAgICAgY29uc3QgYWN0dWFsID0gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZCA/IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQubGVuZ3RoXHJcbiAgICAgICAgICAgIDogKEFycmF5LmlzQXJyYXkoaW5zdGFuY2UudmVydGljZXMpID8gaW5zdGFuY2UudmVydGljZXMubGVuZ3RoIDogLTEpO1xyXG4gICAgICAgIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4IGNvdW50IG1pc21hdGNoOiBnZW9tZXRyeSBzYXlzICR7ZXhwZWN0ZWR9IGZsb2F0cywgYCArXHJcbiAgICAgICAgICAgICAgICBgdGhlIGluc3RhbmNlIGhvbGRzICR7YWN0dWFsfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBhdHRycyA9IGV4cGFuZFBlckZlYXR1cmUobWV0YS5wZXJGZWF0dXJlLCBjb3VudHMpO1xyXG4gICAgICAgIGF0dHJzLmJhc2UgPSBtZXRhLmJhc2U7XHJcbiAgICAgICAgYXR0cnMubGF5ZXJJZHMgPSBtZXRhLmxheWVySWRzO1xyXG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGRpc2FibGVWZWN0b3JHcHUoZXJyLm1lc3NhZ2UpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBXaXJlcyB0aGUgYXR0cmlidXRlIGJ1ZmZlcnMgYW5kIHVuaWZvcm1zIGludG8gYSBsaXZlIGdsaWZ5IHBvaW50cyBpbnN0YW5jZS4gUmV0dXJucyBhXHJcbi8vIGhhbmRsZSB3aG9zZSBzZXRXaW5kb3cgY29zdHMgdHdvIHVuaWZvcm1zIGFuZCBhIHJlZHJhdywgb3IgbnVsbCBpZiBhbnl0aGluZyBhYm91dCB0aGVcclxuLy8gaW5zdGFuY2UgaXMgbm90IHdoZXJlIGdsaWZ5IDMuMy4wIGtlZXBzIGl0IC0tIGluIHdoaWNoIGNhc2UgR1BVIHRpbWUgaXMgZGlzYWJsZWQgYW5kXHJcbi8vIHRoZSBjYWxsZXIncyByZWJ1aWxkIHBhdGggdGFrZXMgb3Zlci5cclxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb0luc3RhbmNlKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycyk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICBkaXNhYmxlR3B1VGltZShlcnIubWVzc2FnZSk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFRoZSBjb21tb24gR0wgd2lyaW5nOiBidWZmZXJzIGZvciBzcGFuL2R1cmF0aW9uL2xheWVyIGF0dHJpYnV0ZXMsIHVuaWZvcm1zIGZvciB0aGVcclxuLy8gdGljaywgdGhlIHNoYXJlZCBvdmVycmlkZSBhbmQgdGhlIHBlci1sYXllciB2aXNpYmlsaXR5IHNsb3RzLiBUaHJvd3Mgb24gYW55dGhpbmdcclxuLy8gdW5leHBlY3RlZDsgdGhlIGNhbGxlcnMgZGVjaWRlIHdoaWNoIGZhbGxiYWNrIGZsYWcgdGhhdCBmbGlwcy5cclxuZnVuY3Rpb24gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAge1xyXG4gICAgICAgIGNvbnN0IGdsID0gaW5zdGFuY2UuZ2w7XHJcbiAgICAgICAgY29uc3QgcHJvZ3JhbSA9IGluc3RhbmNlLnByb2dyYW07XHJcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBpbnN0YW5jZS5sYXllcjtcclxuICAgICAgICBpZiAoIWdsIHx8ICFwcm9ncmFtIHx8ICFsYXllcikgdGhyb3cgbmV3IEVycm9yKFwiaW5zdGFuY2UgbGFja3MgZ2wvcHJvZ3JhbS9sYXllclwiKTtcclxuXHJcbiAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3BhbkxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYVRpbWVTcGFuXCIpO1xyXG4gICAgICAgIGNvbnN0IGR1ckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUR1cmF0aW9uXCIpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhTGF5ZXJcIik7XHJcbiAgICAgICAgY29uc3QgdGlja0xvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVUaWNrXCIpO1xyXG4gICAgICAgIGNvbnN0IG92ZXJyaWRlTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidU92ZXJyaWRlXCIpO1xyXG4gICAgICAgIC8vIFNvbWUgZHJpdmVycyBuYW1lIHRoZSBhcnJheSBoZWFkIFwidUxheWVyVmlzWzBdXCI7IGFjY2VwdCBlaXRoZXIuXHJcbiAgICAgICAgY29uc3QgdmlzTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzXCIpXHJcbiAgICAgICAgICAgIHx8IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1swXVwiKTtcclxuICAgICAgICBpZiAoc3BhbkxvYyA8IDAgfHwgZHVyTG9jIDwgMCB8fCBsYXllckxvYyA8IDAgfHwgIXRpY2tMb2MgfHwgIW92ZXJyaWRlTG9jIHx8ICF2aXNMb2MpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidGltZSBhdHRyaWJ1dGVzL3VuaWZvcm1zIG1pc3NpbmcgZnJvbSB0aGUgbGlua2VkIHByb2dyYW1cIik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBzcGFuQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHNwYW5CdWYpO1xyXG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5zcGFucywgZ2wuU1RBVElDX0RSQVcpO1xyXG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoc3BhbkxvYywgMiwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShzcGFuTG9jKTtcclxuXHJcbiAgICAgICAgY29uc3QgZHVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGR1ckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmR1cnMsIGdsLlNUQVRJQ19EUkFXKTtcclxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGR1ckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShkdXJMb2MpO1xyXG5cclxuICAgICAgICBjb25zdCBsYXllckJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xyXG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBsYXllckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmxheWVySWR4LCBnbC5TVEFUSUNfRFJBVyk7XHJcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihsYXllckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShsYXllckxvYyk7XHJcblxyXG4gICAgICAgIC8vIFVudGlsIHRoZSBzbGlkZXIgc2F5cyBvdGhlcndpc2UsIGV2ZXJ5dGhpbmcgaXMgdmlzaWJsZSAtLSBpbiB0aW1lIEFORCBsYXllci5cclxuICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgQUxXQVlTKTtcclxuICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIC0xKTtcclxuICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKSk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIGxheWVySWRzOiBhdHRycy5sYXllcklkcyxcclxuICAgICAgICAgICAgLy8gdGlja01zIGluIGVwb2NoIG1zOyBvdmVycmlkZU1zIGEgc2hhcmVkLXdpbmRvdyB3aWR0aCBvciBudWxsLlxyXG4gICAgICAgICAgICBzZXRXaW5kb3codGlja01zLCBvdmVycmlkZU1zKSB7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIHRpY2tNcyA9PT0gbnVsbCA/IEFMV0FZUyA6ICh0aWNrTXMgLSBhdHRycy5iYXNlKSAvIDEwMDApO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCBvdmVycmlkZU1zID09PSBudWxsID8gLTEgOiBvdmVycmlkZU1zIC8gMTAwMCk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gT25lIGZsb2F0IHBlciBsYXllciBzbG90LCBpbiBhdHRycy5sYXllcklkcyBvcmRlci4gQSBzaWRlYmFyIHRvZ2dsZSBsYW5kc1xyXG4gICAgICAgICAgICAvLyBoZXJlIGluc3RlYWQgb2YgcmVidWlsZGluZyB0aGUgYnVja2V0LlxyXG4gICAgICAgICAgICBzZXRMYXllclZpc2liaWxpdHkodmlzQXJyYXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IG5ldyBGbG9hdDMyQXJyYXkoTEFZRVJfU0xPVFMpLmZpbGwoMSk7XHJcbiAgICAgICAgICAgICAgICB2aXMuc2V0KHZpc0FycmF5LnNsaWNlKDAsIExBWUVSX1NMT1RTKSk7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmdih2aXNMb2MsIHZpcyk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkSlMsIGJpbmRQb3B1cCwgYmluZFRvb2x0aXAsIHBhcnNlQ29sb3IgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XHJcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXHJcbiAgICAgICAgIHBlcmlvZFRvTXMgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcclxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XHJcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XHJcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XHJcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XHJcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcclxuICAgIH1cclxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xyXG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xyXG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcclxuICAgICAgICAgICAgLy8gV2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZCAodGhlIHdpZGdldCdzIGNsaWNrIGhhbmRsZXIgc3RhbXBzIHRoaXNcclxuICAgICAgICAgICAgLy8gcGVyIGNsaWNrLCBiZWZvcmUgYW55IGZlYXR1cmUgaGFuZGxlciBydW5zKSwgRVZFUlkgbWF0Y2ggc3RhbmRzIGRvd246XHJcbiAgICAgICAgICAgIC8vIGEgY2xpY2sgaW4gcmVtb3ZhbCBtb2RlIGlzIGEgZGVsZXRpb24gYXR0ZW1wdCwgYW5kIGFuc3dlcmluZyBpdCB3aXRoXHJcbiAgICAgICAgICAgIC8vIGEgZmVhdHVyZSBwb3B1cCBvciBhIGNvb3JkcyByZWFkb3V0IHJlYWRzIGFzIFwicmVtb3ZlIGlzIGJyb2tlblwiLlxyXG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCAmJiAhbWFwLl9wbU1vZGVBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xyXG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xyXG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XHJcbiAgICB9XHJcbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcclxuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcclxuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XHJcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgfSwgMCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xyXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcclxuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXHJcbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxyXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxyXG4vL1xyXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcclxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxyXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxyXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXHJcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcclxuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xyXG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xyXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcclxuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcclxuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcclxuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xyXG4gICAgY29uc3QgcHJvcHMgPSB7fTtcclxuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcclxuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwcm9wcztcclxufVxyXG5cclxuXHJcblxyXG4vLyBBbiBpbWFnZXJ5IG92ZXJsYXkncyBpZGVudGl0eTogZXZlcnl0aGluZyB0aGUgcmVuZGVyZWQgZWxlbWVudCBkZXJpdmVzIGZyb20gaXRzXHJcbi8vIGNvbmZpZy4gVGhlIHN5bmMgbG9vcCByZWNyZWF0ZXMgdGhlIG92ZXJsYXkgd2hlbiB0aGlzIGNoYW5nZXMgKG9yIHdoZW4gdGhlXHJcbi8vIGJpbmFyeSBidWZmZXIgb2JqZWN0IHVuZGVyIHRoZSBsYXllciBpZCBpcyByZXBsYWNlZCksIHNpbmNlIGEgRE9NIGltYWdlIGlzIGFcclxuLy8gc2luZ2xlIGNoZWFwIG5vZGUgLS0gbm8gaW5jcmVtZW50YWwgdXBkYXRlIG1hY2hpbmVyeSBuZWVkZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbWFnZU1ldGFLZXkobGF5ZXIpIHtcclxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShbbGF5ZXIudXJsIHx8IG51bGwsIGxheWVyLmJvdW5kcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIub3BhY2l0eSA/PyAxLCBsYXllci5pbWFnZV9mb3JtYXQgfHwgbnVsbF0pO1xyXG59XHJcblxyXG4vLyBHZW9yZWZlcmVuY2VkIHBpeGVscyBwaW5uZWQgdG8gYSBsYXQvbG9uIGJveC4gVGhlIGNvbmZpZyBpcyBwdXJlIGRhdGEgLS1cclxuLy8ge3R5cGU6IFwiaW1hZ2VcIiwgYm91bmRzLCBvcGFjaXR5LCB1cmwgfCBieXRlcyB1bmRlciB0aGUgbGF5ZXIgaWR9IC0tIHNvIGFcclxuLy8gcGxhaW4tSlMgY29uc3VtZXIgcGFzc2VzIGEgVVJMIGFuZCB0aGUgd2lkZ2V0IHBhdGggc2hpcHMgYnl0ZXMgb3ZlciB0aGVcclxuLy8gYmluYXJ5IGJ1ZmZlciB0cmFuc3BvcnQuIFB5dGhvbiBoYXMgYWxyZWFkeSB3YXJwZWQgdGhlIHJhc3RlciBpbnRvIHRoZSBNQVAnc1xyXG4vLyBvd24gQ1JTIGdyaWQgKHJhc3RlcmlvIHNpZGUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIExlYWZsZXQncyBsaW5lYXIgY29ybmVyXHJcbi8vIHN0cmV0Y2ggZXhhY3RseSBjb3JyZWN0OyB0aGlzIHN0YXlzIGEgZHVtYiByZW5kZXJlci5cclxuZnVuY3Rpb24gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcikge1xyXG4gICAgaWYgKCFsYXllci5ib3VuZHMpIHJldHVybiBudWxsO1xyXG4gICAgbGV0IHVybCA9IGxheWVyLnVybDtcclxuICAgIGxldCBvYmplY3RVcmwgPSBudWxsO1xyXG4gICAgaWYgKCF1cmwgJiYgY29vcmRCdWZmZXIpIHtcclxuICAgICAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2Nvb3JkQnVmZmVyXSxcclxuICAgICAgICAgICAgeyB0eXBlOiBsYXllci5pbWFnZV9mb3JtYXQgfHwgXCJpbWFnZS9wbmdcIiB9KTtcclxuICAgICAgICBvYmplY3RVcmwgPSB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgfVxyXG4gICAgaWYgKCF1cmwpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IEwuaW1hZ2VPdmVybGF5KHVybCwgbGF5ZXIuYm91bmRzLCB7XHJcbiAgICAgICAgb3BhY2l0eTogbGF5ZXIub3BhY2l0eSA/PyAxLFxyXG4gICAgICAgIC8vIENvbnRleHQsIG5vdCBhIGNsaWNrIHRhcmdldDogY2xpY2tzIGZhbGwgdGhyb3VnaCB0byBmZWF0dXJlcyBhbmQgdGhlXHJcbiAgICAgICAgLy8gZW1wdHktbWFwIGNvb3JkaW5hdGUgZmFsbGJhY2suIFRoZSBkZWZhdWx0IG92ZXJsYXlQYW5lICh6IDQwMClcclxuICAgICAgICAvLyBhbHJlYWR5IHNpdHMgYWJvdmUgdGlsZXMgKDIwMCkgYW5kIGJlbG93IHRoZSBHTCBwYW5lcyAoNDEwKykuXHJcbiAgICAgICAgaW50ZXJhY3RpdmU6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAob2JqZWN0VXJsKSB7XHJcbiAgICAgICAgb3ZlcmxheS5vbihcInJlbW92ZVwiLCAoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKG9iamVjdFVybCkpO1xyXG4gICAgfVxyXG4gICAgb3ZlcmxheS5hZGRUbyhtYXApO1xyXG4gICAgb3ZlcmxheS5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgb3ZlcmxheS5pbWFnZU1ldGEgPSBpbWFnZU1ldGFLZXkobGF5ZXIpO1xyXG4gICAgb3ZlcmxheS5pbWFnZVNvdXJjZSA9IGNvb3JkQnVmZmVyIHx8IG51bGw7XHJcbiAgICByZXR1cm4gb3ZlcmxheTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyLCBtb2RlbCkge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIikge1xyXG4gICAgICAgIHJldHVybiByZW5kZXJJbWFnZUxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyKTtcclxuICAgIH1cclxuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICBjb25zdCBncm91cCA9IEwubGF5ZXJHcm91cCgpO1xyXG4gICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9O1xyXG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xyXG4gICAgICAgICAgICBpZiAoc3ViLnR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJtYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWxpbmVcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgc3ViLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBzdWIsIGNvb3JkaW5hdGVCdWZmZXJzW3N1Yi5pZF0sIG1vZGVsKTtcclxuICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XHJcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcclxuICAgICAgICBncm91cC5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgICAgIHJldHVybiBncm91cDtcclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBBIHZlY3RvciBsYXllcidzIGNvb3JkaW5hdGVzOiB0aGUgYmluYXJ5IGJ1ZmZlciB1bmRlciBpdHMgaWQgd2hlbiBQeXRob24gYnVpbHQgaXRcclxuLy8gKHRoZSBsYXllcnMgSlNPTiB0aGVuIGNhcnJpZXMgbm8gY29vcmRpbmF0ZXMgYXQgYWxsKSwgb3IgaW5saW5lIGBsb2NhdGlvbnNgIGZvclxyXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xyXG4vLyBvbiB0aGUgR1BVIHBhdGggcmFyZWx5IGRvLlxyXG5leHBvcnQgZnVuY3Rpb24gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLmxvY2F0aW9ucykgcmV0dXJuIGxheWVyLmxvY2F0aW9ucztcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IGZsYXQgPSBuZXcgRmxvYXQ2NEFycmF5KHJhdy5idWZmZXIgfHwgcmF3LCByYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xyXG4gICAgY29uc3Qgb3V0ID0gbmV3IEFycmF5KGZsYXQubGVuZ3RoIC8gMik7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG91dC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG91dFtpXSA9IFtmbGF0W2kgKiAyXSwgZmxhdFtpICogMiArIDFdXTtcclxuICAgIH1cclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIEEgbGluZSBsYXllcidzIGNvb3JkaW5hdGVzIGFzIHBhcnRzOiB0aGUgZmxhdCBydW4gc2xpY2VkIGJ5IHRoZSBjb25maWcncyBgcGFydHNgXHJcbi8vIGxlbmd0aCB0YWJsZSwgb3Igb25lIHBhcnQgd2l0aG91dCBpdC4gQSBtdWx0aS1wYXJ0IGxpbmUgLS0gTVVMVElMSU5FU1RSSU5HLFxyXG4vLyBNdWx0aUxpbmVTdHJpbmcgLS0gaXMgT05FIGxheWVyIGRyYXduIGFzIGRpc2pvaW50IHJ1bnM7IG5vdGhpbmcgbWF5IGV2ZXIgZHJhdyBhXHJcbi8vIHNlZ21lbnQgZnJvbSBvbmUgcGFydCdzIGxhc3QgdmVydGV4IHRvIHRoZSBuZXh0IHBhcnQncyBmaXJzdC5cclxuZXhwb3J0IGZ1bmN0aW9uIGxpbmVQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxlbmd0aHMgPSBBcnJheS5pc0FycmF5KGxheWVyLnBhcnRzKSAmJiBsYXllci5wYXJ0cy5sZW5ndGggPiAxID8gbGF5ZXIucGFydHMgOiBudWxsO1xyXG4gICAgaWYgKCFsZW5ndGhzKSByZXR1cm4gbG9jcy5sZW5ndGggPyBbbG9jc10gOiBbXTtcclxuICAgIGNvbnN0IHBhcnRzID0gW107XHJcbiAgICBsZXQgb2Zmc2V0ID0gMDtcclxuICAgIGZvciAoY29uc3QgbiBvZiBsZW5ndGhzKSB7XHJcbiAgICAgICAgY29uc3QgcGFydCA9IGxvY3Muc2xpY2Uob2Zmc2V0LCBvZmZzZXQgKyBuKTtcclxuICAgICAgICBvZmZzZXQgKz0gbjtcclxuICAgICAgICBpZiAocGFydC5sZW5ndGggPj0gMikgcGFydHMucHVzaChwYXJ0KTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuZnVuY3Rpb24gY2xvc2VSaW5nKHJpbmcpIHtcclxuICAgIGlmIChyaW5nLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBmaXJzdCA9IHJpbmdbMF07XHJcbiAgICAgICAgY29uc3QgbGFzdCA9IHJpbmdbcmluZy5sZW5ndGggLSAxXTtcclxuICAgICAgICBpZiAoZmlyc3RbMF0gIT09IGxhc3RbMF0gfHwgZmlyc3RbMV0gIT09IGxhc3RbMV0pIHtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmluZztcclxufVxyXG5cclxuLy8gZ2xpZnkncyBsaW5lIGhpdCB0b2xlcmFuY2UgaXMgYHNlbnNpdGl2aXR5ICsgd2VpZ2h0L3NjYWxlYCwgYW5kIHNlbnNpdGl2aXR5IGlzIGFcclxuLy8gQ09OU1RBTlQgaW4gbGF0bG5nIGRlZ3JlZXMgLS0gMC4xIGZvciBjbGlja3MgKH4xMSBrbSkgYW5kIDAuMDMgZm9yIGhvdmVycyxcclxuLy8gem9vbS1ibGluZCwgc28gYSBjbGljayB3aXRoaW4gc2lnaHQgb2YgYSBsaW5lIG1hdGNoZWQgaXQgYW5kIHN0YXJ2ZWQgdGhlXHJcbi8vIGVtcHR5LW1hcCBmYWxsYmFjay4gVGhlIHdlaWdodC9zY2FsZSB0ZXJtIGFscmVhZHkgY292ZXJzIHRoZSBkcmF3biB3aWR0aDtcclxuLy8gcmVwbGFjZSB0aGUgY29uc3RhbnQgd2l0aCBhIGZldyBwaXhlbHMnIHdvcnRoIGF0IHRoZSBjdXJyZW50IHpvb20uIFRoZSBpbnN0YW5jZVxyXG4vLyBnZXR0ZXJzIHJlYWQgYHNldHRpbmdzYCBsaXZlIHBlciBldmVudCwgc28gdXBkYXRpbmcgb24gem9vbSBpcyBlbm91Z2ggLS0gbm9cclxuLy8gZ2xpZnkgcGF0Y2hpbmcuIFJldHVybnMgdGhlIHVuc3Vic2NyaWJlIGZvciBvblJlbW92ZS5cclxuY29uc3QgTElORV9ISVRfU0xBQ0tfUFggPSA4O1xyXG5mdW5jdGlvbiB0cmFja0xpbmVTZW5zaXRpdml0eShtYXAsIGluc3RhbmNlKSB7XHJcbiAgICBjb25zdCBhcHBseSA9ICgpID0+IHtcclxuICAgICAgICBjb25zdCBzbGFjayA9IExJTkVfSElUX1NMQUNLX1BYIC8gTWF0aC5wb3coMiwgbWFwLmdldFpvb20oKSk7XHJcbiAgICAgICAgaW5zdGFuY2Uuc2V0dGluZ3Muc2Vuc2l0aXZpdHkgPSBzbGFjaztcclxuICAgICAgICBpbnN0YW5jZS5zZXR0aW5ncy5zZW5zaXRpdml0eUhvdmVyID0gc2xhY2s7XHJcbiAgICB9O1xyXG4gICAgYXBwbHkoKTtcclxuICAgIG1hcC5vbihcInpvb21lbmRcIiwgYXBwbHkpO1xyXG4gICAgcmV0dXJuICgpID0+IG1hcC5vZmYoXCJ6b29tZW5kXCIsIGFwcGx5KTtcclxufVxyXG5cclxuLy8gQW4gYXJlYSBsYXllcidzIGdlb21ldHJ5IGFzIHBhcnRzIC0+IGNsb3NlZCBbbG9uLCBsYXRdIHJpbmdzOiBhIHBvbHlnb24ncyBmbGF0XHJcbi8vIGNvb3JkaW5hdGUgcnVuIHNsaWNlZCBieSBpdHMgYHJpbmdzYCB0YWJsZSAob25lIGhvbGUtZnJlZSByaW5nIHdpdGhvdXQgaXQpLCBvciBhXHJcbi8vIGNpcmNsZSdzIGdlbmVyYXRlZCByaW5nLiBGZWVkcyBib3RoIHRoZSBmaWxsIChlYXJjdXQsIGluIHRoZSBwb2x5Z29uIGJ1Y2tldCkgYW5kXHJcbi8vIHRoZSBvdXRsaW5lIChMaW5lU3RyaW5ncyBpbiB0aGUgbGluZXMgYnVja2V0KS5cclxuZnVuY3Rpb24gYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICBjb25zdCBsYXQgPSBsYXllci5sb2NhdGlvblswXTtcclxuICAgICAgICBjb25zdCBsb24gPSBsYXllci5sb2NhdGlvblsxXTtcclxuICAgICAgICBjb25zdCByYWRpdXNNZXRlcnMgPSBsYXllci5yYWRpdXMgfHwgMTA7XHJcbiAgICAgICAgY29uc3QgZWFydGhSYWRpdXMgPSA2Mzc4MTM3O1xyXG4gICAgICAgIGNvbnN0IHJpbmcgPSBbXTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XHJcbiAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xyXG4gICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtsb24gKyAoZExvbiAqIDE4MCkgLyBNYXRoLlBJLCBsYXQgKyAoZExhdCAqIDE4MCkgLyBNYXRoLlBJXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBbW3JpbmddXTtcclxuICAgIH1cclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxvbmxhdCA9IGxvY3MubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgIGNvbnN0IHJpbmdUYWJsZSA9IGxheWVyLnJpbmdzIHx8IChsb25sYXQubGVuZ3RoID4gMCA/IFtbbG9ubGF0Lmxlbmd0aF1dIDogW10pO1xyXG4gICAgY29uc3QgcGFydHMgPSBbXTtcclxuICAgIGxldCBhdCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHBhcnRMZW5zIG9mIHJpbmdUYWJsZSkge1xyXG4gICAgICAgIGNvbnN0IHJpbmdzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsZW4gb2YgcGFydExlbnMpIHtcclxuICAgICAgICAgICAgY29uc3QgcmluZyA9IGNsb3NlUmluZyhsb25sYXQuc2xpY2UoYXQsIGF0ICsgbGVuKSk7XHJcbiAgICAgICAgICAgIGF0ICs9IGxlbjtcclxuICAgICAgICAgICAgaWYgKHJpbmcubGVuZ3RoID49IDQpIHJpbmdzLnB1c2gocmluZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChyaW5ncy5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKHJpbmdzKTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCBsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRmVhdHVyZVZpc2libGUgPSBudWxsKSB7XHJcbiAgICAvLyBIaXQtdGVzdCBndWFyZDogR1BVLXBhdGggYnVja2V0cyBob2xkIGhpZGRlbiBsYXllcnMgKGFuZCBvdXQtb2Ytd2luZG93XHJcbiAgICAvLyBmZWF0dXJlcyksIG1hc2tlZCBvbmx5IGJ5IHNoYWRlciB1bmlmb3JtcyBnbGlmeSdzIGhpdC10ZXN0cyBjYW5ub3Qgc2VlLiBUaGVcclxuICAgIC8vIHdpZGdldCBwYXNzZXMgYSBsaXZlIGxvb2t1cDsgdGhlIGZhbGxiYWNrIGNvdmVycyBwbGFpbi1KUyBjb25zdW1lcnMgd2l0aCB0aGVcclxuICAgIC8vIGNvbmZpZydzIG93biBmbGFnLlxyXG4gICAgY29uc3QgdmlzaWJsZU5vdyA9IGlzRmVhdHVyZVZpc2libGUgfHwgKChsKSA9PiBsLnZpc2libGUgIT09IGZhbHNlKTtcclxuICAgIC8vIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lIGdlb21ldHJ5IHBlciBsYXllci4gT24gdGhlIEdQVSBwYXRoIChtYXAuanNcclxuICAgIC8vIHBhc3NlcyB2ZWN0b3JHcHUgd2hlbiB0aGUgYnVja2V0IHF1YWxpZmllcykgZXZlcnkgZmVhdHVyZSBzdGF5cyBpbiB0aGUgYnVmZmVycyBhbmRcclxuICAgIC8vIHRoZSBzaGFkZXIgZGVjaWRlcyB2aXNpYmlsaXR5IHBlciB0aWNrIGFuZCBwZXIgbGF5ZXIgdG9nZ2xlIC0tIGEgbGluZS1zaGFwZWQgdHJhY2tcclxuICAgIC8vIGhhcyBhcyBtYW55IHZlcnRpY2VzIGFzIGEgcG9pbnQgdHJhY2sgaGFzIHBvaW50cywgc28gaXRzIHJlYnVpbGRzIGNvc3QgdGhlIHNhbWVcclxuICAgIC8vIGFuZCBjcmFzaGVkIHRoZSBzYW1lIHdheS4gT2ZmIHRoZSBHUFUgcGF0aCwgdGhlIHdob2xlLWZlYXR1cmUgQ1BVIGZpbHRlciByZW1haW5zLlxyXG4gICAgY29uc3QgdmVjdG9yTWV0YSA9IHZlY3RvckdwdSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCJcclxuICAgICAgICA/IGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCB2ZWN0b3JUaW1lID0gQm9vbGVhbih2ZWN0b3JNZXRhLmhhc1RpbWUpO1xyXG4gICAgaWYgKHRpbWVTdGF0ZSAmJiAhdmVjdG9yVGltZSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCIpIHtcclxuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcclxuICAgICAgICBpZiAobGF5ZXJzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xyXG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XHJcblxyXG4gICAgICAgICAgICAvLyBBcmVhIG91dGxpbmVzOiBhIHBvbHlnb24gb3IgY2lyY2xlIGluIHRoaXMgYnVja2V0IGNvbnRyaWJ1dGVzIGVhY2ggb2YgaXRzXHJcbiAgICAgICAgICAgIC8vIHJpbmdzIGFzIG9uZSBMaW5lU3RyaW5nLCBkcmF3biB3aXRoIHRoZSBhcmVhJ3Mgc3Ryb2tlIG9wdGlvbnMgLS0gY29sb3IsXHJcbiAgICAgICAgICAgIC8vIHdlaWdodCwgb3BhY2l0eSwgTGVhZmxldCdzIG93biBzZW1hbnRpY3MuIE91dGxpbmUgd2VpZ2h0IGFuZCBvcGFjaXR5IG5ldmVyXHJcbiAgICAgICAgICAgIC8vIHJlbmRlcmVkIGJlZm9yZSB0aGlzOyB0aGUgZmlsbCBtYWNoaW5lcnkgY2Fubm90IGRyYXcgdGhlbSAoZ2xpZnkncyBib3JkZXJcclxuICAgICAgICAgICAgLy8gaXMgMXB4IGFuZCBmaWxsLWNvbG91cmVkKSwgdGhlIGxpbmVzIG1hY2hpbmVyeSBhbHJlYWR5IGRvZXMuXHJcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIiB8fCBsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICAgICAgICAgICAgaWYgKChzdHlsZS53ZWlnaHQgPz8gMykgPiAwICYmIChzdHlsZS5vcGFjaXR5ID8/IDEuMCkgPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmcgb2YgcmluZ3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAocmluZy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIkxpbmVTdHJpbmdcIiwgY29vcmRpbmF0ZXM6IHJpbmcgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT3V0bGluZSBwaXhlbHMgb25seSAtLSB0aGUgYXJlYSdzIHNoYXBlcyBpbnN0YW5jZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvd25zIGludGVyYWN0aW9uIHdpdGggZXhhY3QgY29udGFpbm1lbnQuIExlZnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2xpY2thYmxlLCB0aGVzZSByaW5ncyBhbnN3ZXJlZCB0aHJvdWdoIGdsaWZ5J3NcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGluZSB0b2xlcmFuY2UgKDAuMSBERUdSRUVTIGZvciBjbGlja3MgdnMgMC4wM1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmb3IgaG92ZXJzKTogcG9wdXBzIHdlbGwgb3V0c2lkZSB0aGUgc2hhcGUgYW5kXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc2lkZSBob2xlcywgaG92ZXIgZGlzYWdyZWVpbmcgd2l0aCBjbGljay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCb3JkZXI6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTsgICAvLyAwIGtlZXBzIHRoZSBzbG90IGFsaWduZWQgd2hlbiBzdHJva2VsZXNzXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gT25lIExpbmVTdHJpbmcgZmVhdHVyZSBQRVIgUEFSVCwgZXZlcnkgcGFydCBjYXJyeWluZyB0aGUgbGF5ZXIgLS0gbmV2ZXJcclxuICAgICAgICAgICAgLy8gYSBNdWx0aUxpbmVTdHJpbmc6IGdsaWZ5J3MgTXVsdGlMaW5lU3RyaW5nIHBhdGggaGl0LXRlc3RzIHRoZSBjb25uZWN0b3JcclxuICAgICAgICAgICAgLy8gYmV0d2VlbiBwYXJ0cywgd2hpY2ggaXMgdGhlIHBoYW50b20gc2VnbWVudCBieSBhbm90aGVyIHJvdXRlLiBUaGUgR0xcclxuICAgICAgICAgICAgLy8gdmVydGV4IHN0cmVhbSBzdGF5cyBjb25zZWN1dGl2ZSwgc28gdGhlIHBlci1sYXllciBjb3VudCBzdGlsbCBhbGlnbnNcclxuICAgICAgICAgICAgLy8gdGhlIHRpbWUgYXR0cmlidXRlczsgYSBzdHJva2VsZXNzIG9yIGRlZ2VuZXJhdGUgbGF5ZXIga2VlcHMgaXRzIHNsb3QuXHJcbiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGFydCBvZiBsaW5lUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZ2VvanNvbkNvb3JkcyA9IHBhcnQubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkxpbmVTdHJpbmdcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IGdlb2pzb25Db29yZHNcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goY291bnQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcclxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcclxuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lT3B0aW9ucyA9IHZlY3RvclRpbWVcclxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5nbExpbmVzID0gTC5nbGlmeS5saW5lcyh7XHJcbiAgICAgICAgICAgICAgICAgICAgLi4ubGluZU9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5bGluZXNQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGRhdGEgYWJvdmUgaXMgR2VvSlNPTiwgd2hvc2UgY29vcmRpbmF0ZXMgYXJlIFtsb24sIGxhdF07IGdsaWZ5XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZGVmYXVsdHMgdG8gbGF0aXR1ZGUtZmlyc3QgYW5kIGl0cyBMSU5FIHZlcnRleCBidWlsZGVyIHJlYWRzXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gY29vcmRpbmF0ZXMgdGhyb3VnaCB0aGVzZSBrZXlzIC0tIHVuc2V0LCBpdCB0b29rIGxvbmdpdHVkZSBhc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGxhdGl0dWRlIGFuZCBwcm9qZWN0ZWQgZXZlcnkgbGluZSBvZmYtdmlld3BvcnQuIFNpbGVudGx5OiBubyBHTFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGVycm9yLCBhIGhlYWx0aHkgY2FudmFzLCB6ZXJvIGZyYWdtZW50cy4gU2V0IHBlciBpbnN0YW5jZSByYXRoZXJcclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGFuIG9uIHRoZSBMLmdsaWZ5IGdsb2JhbCwgd2hpY2ggYW5vdGhlciBsaWJyYXJ5IGNvdWxkIGFsc29cclxuICAgICAgICAgICAgICAgICAgICAvLyBtdXRhdGUuIFRoZSBwb2x5Z29uIHBhdGggaXMgZGVsaWJlcmF0ZWx5IE5PVCBnaXZlbiB0aGVzZSBrZXlzOlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGl0IHRyaWFuZ3VsYXRlcyB2aWEgZWFyY3V0IG9uIHRoZSBHZW9KU09OIGRpcmVjdGx5LCBuYXRpdmVcclxuICAgICAgICAgICAgICAgICAgICAvLyBbbG9uLCBsYXRdLCBhbmQga2V5cyB0aGVyZSB3b3VsZCB0cmFuc3Bvc2UgaXQgdGhlIHNhbWUgd2F5LlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZvdW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgYnVnIHJlcG9ydCwgZHJpdmluZyB0aGUgcGxhaW4tSlNcclxuICAgICAgICAgICAgICAgICAgICAvLyBidW5kbGUgd2hlcmUgbm8gcG9pbnRzIG1hc2tlZCB0aGUgYmxhbmsgbGluZXMuXHJcbiAgICAgICAgICAgICAgICAgICAgbGF0aXR1ZGVLZXk6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgbG9uZ2l0dWRlS2V5OiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZmVhdHVyZSB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzIHx8IGZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFyZTogc2hpbnl3aWRnZXRzJyBtb2RlbCBoYXMgbm8gYGNvbW1gXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvcGVydHksIHNvIGdhdGluZyBvbiBpdCBzaWxlbnRseSBraWxsZWQgdGhpc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgd2FzIHRoZSBvbmUgcGF0aCB0aGF0IHdvcmtlZCB0aGVyZS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXJlIHRoZSBjbGljayBsYW5kZWQsIGZlYXR1cmUgb3Igbm90OiBvbmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJhaXQgYWx3YXlzIGFuc3dlcnMgXCJ3aGVyZVwiLCBjbGlja2VkX2xheWVyX2lkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sYXQgKiAxZTUpIC8gMWU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxuZyAqIDFlNSkgLyAxZTVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQnVtcGVkIG9uIEVWRVJZIGNsaWNrOiBjbGlja2luZyB0aGUgc2FtZSBmZWF0dXJlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHR3aWNlIGNoYW5nZXMgbmVpdGhlciBpZCBub3IgaW5kZXgsIHNvIHdpdGhvdXRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBubyB0cmFpdCBmaXJlcyBhbmQgaGFuZGxlcnMgbWlzcyB0aGUgY2xpY2suXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrX3NlcVwiLCAobW9kZWwuZ2V0KFwiY2xpY2tfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmICFmZWF0dXJlLnByb3BlcnRpZXMuaXNCb3JkZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiB2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsTGluZXMpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2Vuc2l0aXZpdHlPZmYgPSB0cmFja0xpbmVTZW5zaXRpdml0eShtLCB0aGlzLmdsTGluZXMpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHZlY3RvclRpbWUpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZSh0aGlzLmdsTGluZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NlbnNpdGl2aXR5T2ZmKSB0aGlzLl9zZW5zaXRpdml0eU9mZigpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xMaW5lcykgdGhpcy5nbExpbmVzLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xyXG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWdvblwiKSB7XHJcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcclxuICAgICAgICBjb25zdCB2ZXJ0ZXhDb3VudHMgPSBbXTtcclxuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMCk7ICAgLy8gbm8gZmVhdHVyZSwgYnV0IHRoZSBzbG90IG11c3Qgc3RheSBhbGlnbmVkXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBBbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHBvbHlnb24gd2l0aCBEIGRpc3RpbmN0IHZlcnRpY2VzIGFuZCBoIGhvbGVzIGhhc1xyXG4gICAgICAgICAgICAvLyBleGFjdGx5IEQgKyAyaCAtIDIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzXHJcbiAgICAgICAgICAgIC8vIGVhcmN1dDsgaCA9IDAgZ2l2ZXMgdGhlIGZhbWlsaWFyIEQgLSAyLiBSaW5ncyBhcmUgY2xvc2VkIGJ5IG5vdywgc28gZWFjaFxyXG4gICAgICAgICAgICAvLyBjb250cmlidXRlcyBsZW5ndGggLSAxIGRpc3RpbmN0IHZlcnRpY2VzLiBQYXJ0cyB0cmlhbmd1bGF0ZSBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICAgIC8vIGFuZCBzdW0uXHJcbiAgICAgICAgICAgIGxldCB0cmlhbmdsZXMgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmdzIG9mIHBhcnRzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0aW5jdCA9IHJpbmdzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLmxlbmd0aCAtIDEsIDApO1xyXG4gICAgICAgICAgICAgICAgdHJpYW5nbGVzICs9IE1hdGgubWF4KDAsIGRpc3RpbmN0ICsgMiAqIChyaW5ncy5sZW5ndGggLSAxKSAtIDIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKDMgKiB0cmlhbmdsZXMpO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XHJcbiAgICAgICAgICAgIC8vIExlYWZsZXQncyBvd24gc2VtYW50aWNzOiB0aGUgZmlsbCBpcyBmaWxsQ29sb3IsIGRlZmF1bHRpbmcgdG8gdGhlIHN0cm9rZVxyXG4gICAgICAgICAgICAvLyBjb2xvciB3aGVuIHVuc2V0LiBJdCB1c2VkIHRvIGFsd2F5cyBmaWxsIHdpdGggYGNvbG9yYCwgd2hpY2ggbWFkZVxyXG4gICAgICAgICAgICAvLyBcInJlZCBvdXRsaW5lLCBwYWxlIGJsdWUgZmlsbFwiIC0tIHRoZSBtb3N0IGJhc2ljIHBvbHlnb24gc3R5bGluZyBhc2sgLS1cclxuICAgICAgICAgICAgLy8gaW1wb3NzaWJsZTsgdGhlIG91dGxpbmUgaXRzZWxmIGlzIGRyYXduIGJ5IHRoZSBsaW5lcyBidWNrZXQuXHJcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuZmlsbENvbG9yIHx8IHN0eWxlLmZpbGxfY29sb3IgfHwgc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcclxuICAgICAgICAgICAgLy8gT25lIEZlYXR1cmUgUEVSIFBBUlQsIG5ldmVyIGEgTXVsdGlQb2x5Z29uOiBnbGlmeSdzIHNoYXBlcyBvbmx5XHJcbiAgICAgICAgICAgIC8vIGV4cGxvZGVzIE11bHRpUG9seWdvbiB3aGVuIGhhbmRlZCBhIGJhcmUgRmVhdHVyZSBvciBnZW9tZXRyeSAtLSBpbiBhXHJcbiAgICAgICAgICAgIC8vIEZlYXR1cmVDb2xsZWN0aW9uIHRoZSBjb29yZGluYXRlcyByZWFjaCBlYXJjdXQuZmxhdHRlbiB1bmV4cGxvZGVkLFxyXG4gICAgICAgICAgICAvLyBlYXJjdXQgcmV0dXJucyBubyBpbmRpY2VzLCBhbmQgdGhlIGZlYXR1cmUgc2lsZW50bHkgZHJhd3MgWkVSTyBmaWxsXHJcbiAgICAgICAgICAgIC8vIHRyaWFuZ2xlcyAodmVyaWZpZWQgYWdhaW5zdCBnbGlmeSAzLjMuMDsgaXRzIFwidW5oYW5kbGVkIHBvbHlnb25cIlxyXG4gICAgICAgICAgICAvLyB0aHJvdyBzaXRzIGluc2lkZSB0aGUgZW1wdHkgbG9vcCBhbmQgbmV2ZXIgZmlyZXMpLiBQYXJ0cyBzdGF5XHJcbiAgICAgICAgICAgIC8vIGNvbnNlY3V0aXZlLCBzbyBwZXItbGF5ZXIgdmVydGV4Q291bnRzIHN0aWxsIGFsaWduIGZvciBHUFUgdGltZS5cclxuICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBwYXJ0cykge1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHsgdHlwZTogXCJQb2x5Z29uXCIsIGNvb3JkaW5hdGVzOiByaW5ncyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5maWxsT3BhY2l0eSB8fCAwLjIgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAgICAgY29uc3QgZ2VvanNvbiA9IHtcclxuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxyXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG5cclxuICAgICAgICAgICAgICAgIGNvbnN0IHNoYXBlT3B0aW9ucyA9IHZlY3RvclRpbWVcclxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5nbFNoYXBlcyA9IEwuZ2xpZnkuc2hhcGVzKHtcclxuICAgICAgICAgICAgICAgICAgICAuLi5zaGFwZU9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5Z29uc1BhbmVcIixcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFmZWF0dXJlIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMgfHwgIWZlYXR1cmUucHJvcGVydGllcy5sYXllclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8ICF2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMywgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdHRlbiBiYXJlOiBzaGlueXdpZGdldHMnIG1vZGVsIGhhcyBubyBgY29tbWBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBUaGUgc2lkZWJhciBhbHdheXMgd3JvdGUgYmFyZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB3YXMgdGhlIG9uZSBwYXRoIHRoYXQgd29ya2VkIHRoZXJlLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV2hlcmUgdGhlIGNsaWNrIGxhbmRlZCwgZmVhdHVyZSBvciBub3Q6IG9uZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0cmFpdCBhbHdheXMgYW5zd2VycyBcIndoZXJlXCIsIGNsaWNrZWRfbGF5ZXJfaWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5zd2VycyBcIm9uIHdoYXRcIiAoXCJcIiBmb3Igb3BlbiBtYXApLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW01hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxhdCAqIDFlNSkgLyAxZTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBCdW1wZWQgb24gRVZFUlkgY2xpY2s6IGNsaWNraW5nIHRoZSBzYW1lIGZlYXR1cmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHdpY2UgY2hhbmdlcyBuZWl0aGVyIGlkIG5vciBpbmRleCwgc28gd2l0aG91dFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIG5vIHRyYWl0IGZpcmVzIGFuZCBoYW5kbGVycyBtaXNzIHRoZSBjbGljay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XHJcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcclxuXHJcbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xyXG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcclxuICAgIC8vIGNpcmNsZSBiZWNhdXNlIHRoZSBnbHlwaCBpcyBkcmF3biBpbnNpZGUgdGhlIHBvaW50J3Mgb3duIHF1YWQgYnkgdGhlIHNoYWRlci5cclxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XHJcblxyXG4gICAgLy8gR1BVIHRpbWUgcGF0aDogd2hlbiB0aGlzIGJ1Y2tldCBob2xkcyB0aW1lIGxheWVycywgZXZlcnkgcG9pbnQgaXMgZmVkIHRvIGdsaWZ5IGFuZFxyXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXHJcbiAgICAvLyB2ZXJ0ZXggc2hhZGVyLCBzbyBhIHRpY2sgY29zdHMgdHdvIHVuaWZvcm1zIGluc3RlYWQgb2YgcmVidWlsZGluZyA1TSBwb2ludHMgaW4gSlMuXHJcbiAgICAvLyBUaGUgQ1BVIGZpbHRlciBiZWxvdyBzdGF5cyBhcyB0aGUgZmFsbGJhY2sgd2hlbiB0aGUgR0wgd2lyaW5nIGlzIHVuYXZhaWxhYmxlLlxyXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcclxuICAgICAgICA/IGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCBncHVUaW1lID0gQm9vbGVhbihncHVBdHRycy5oYXNUaW1lKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyU2l6ZSA9IGxheWVyLnJhZGl1cyAhPSBudWxsID8gTnVtYmVyKGxheWVyLnJhZGl1cykgOiBkZWZhdWx0U2l6ZTtcclxuXHJcbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XHJcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCLFxyXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxyXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVPZmZzZXQsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGNvb3Jkcy5sZW5ndGggLyAyO1xyXG5cclxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XHJcbiAgICAgICAgLy8gU2VsZWN0aW9uIHN0eWxpbmcsIGFwcGxpZWQgb3ZlciB0aGUgbGF5ZXIncyBvd24gYW5kIGl0cyBkYXRhLWRyaXZlbiBzdHlsZXMuXHJcbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cclxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcclxuICAgICAgICBjb25zdCBvdmVycmlkZXMgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgfHwgbnVsbDtcclxuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxyXG4gICAgICAgIC8vIHU4IFJHQkEgdW5kZXIgXCI8aWQ+Ojpjb2xvcnNcIiwgZjMyIHBpeGVscyB1bmRlciBcIjxpZD46OnJhZGlpXCIgLS0gY29tcHV0ZWRcclxuICAgICAgICAvLyBpbiBQeXRob24gZnJvbSBjb2xvcl9jb2wvcmFkaXVzX2NvbC4gQnVmZmVycywgbmV2ZXIgcGVyLWZlYXR1cmUgc3R5bGVcclxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxyXG4gICAgICAgIC8vIHBheWxvYWQgdGhhdCB1c2VkIHRvIGtpbGwgc2Vzc2lvbnMuIEV4cGxpY2l0IHN0eWxlcyBzdGlsbCBvdXRyYW5rIHRoZW0uXHJcbiAgICAgICAgY29uc3QgY29sb3JzUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojpjb2xvcnNgXTtcclxuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcclxuICAgICAgICAgICAgPyBuZXcgVWludDhBcnJheShjb2xvcnNSYXcuYnVmZmVyIHx8IGNvbG9yc1JhdywgY29sb3JzUmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcnNSYXcuYnl0ZUxlbmd0aClcclxuICAgICAgICAgICAgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IHJhZGlpUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9OjpyYWRpaWBdO1xyXG4gICAgICAgIGNvbnN0IGJ1ZlJhZGlpID0gcmFkaWlSYXdcclxuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmFkaWlSYXcuYnl0ZUxlbmd0aCAvIDQpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxyXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcclxuICAgICAgICAvLyBvbiB0aGUgc3Vydml2b3JzIGtlZXAgcG9pbnRpbmcgYXQgdGhlIHJpZ2h0IHJvd3MuXHJcbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGZyb21EYXRhID0gcGVyRmVhdHVyZSA/IHBlckZlYXR1cmVbaV0gOiBudWxsO1xyXG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxyXG4gICAgICAgICAgICAgICAgfHwgKGhpZ2hsaWdodCAmJiBoaWdobGlnaHQuY29sb3IpXHJcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xyXG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LnJhZGl1cyAhPSBudWxsID8gaGlnaGxpZ2h0LnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xyXG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxyXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZkNvbG9ycyA/IHsgcjogYnVmQ29sb3JzW2kgKiA0XSAvIDI1NSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZzogYnVmQ29sb3JzW2kgKiA0ICsgMV0gLyAyNTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhOiBidWZDb2xvcnNbaSAqIDQgKyAzXSAvIDI1NSB9XHJcbiAgICAgICAgICAgICAgICAgICAgOiBjb2xvclJHQixcclxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZlJhZGlpID8gYnVmUmFkaWlbaV1cclxuICAgICAgICAgICAgICAgICAgICA6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXHJcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcclxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcclxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cclxuICAgICAgICAgICAgICAgIHNpemU6IChpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyA/IGluZm8uY29sb3JSR0IgOiB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc2Vuc2l0aXZpdHk6IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjAgOiA4LFxyXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlZCBCRUZPUkUgY29tcGV0aW5nIGZvciB0aGUgY2xpY2s6IGEgaGlkZGVuIG9yXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gb3V0LW9mLXdpbmRvdyBwb2ludCBtdXN0IG5vdCBlbnRlciB0aGUgYXJiaXRyYXRpb24gYXQgYWxsLCBzb1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoYXRldmVyIHNpdHMgYmVuZWF0aCBpdCAtLSBhIHZpc2libGUgZmVhdHVyZSwgb3IgdGhlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZW1wdHktbWFwIGZhbGxiYWNrIC0tIHdpbnMgaW5zdGVhZC5cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZUluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXByZUluZm8gfHwgIXZpc2libGVOb3cocHJlSW5mby5sYXllciwgcHJlSW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHByZUluZm87XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBUaGUgY2xpY2tlZCBwb2ludCdzIG93biBjb29yZGluYXRlcyAtLSBtb3JlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJ1dGhmdWwgdGhhbiB0aGUgbW91c2UgcG9zaXRpb24gZm9yIGEgcG9pbnQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIiwgW3BvaW50WzBdLCBwb2ludFsxXV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEJ1bXBlZCBvbiBFVkVSWSBjbGljazsgc2VlIHRoZSB2ZWN0b3IgY2xpY2sgaGFuZGxlcnMuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwb2ludCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBob3ZlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWluZm8gfHwgIXZpc2libGVOb3coaW5mby5sYXllciwgaW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLmZyYWdtZW50U2hhZGVyU291cmNlID0gKCkgPT4gcGluU2hhZGVyO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLnZlcnRleFNoYWRlclNvdXJjZSA9ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLmdsUG9pbnRzID0gTC5nbGlmeS5wb2ludHMoZ2xpZnlPcHRpb25zKTtcclxuICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFBvaW50cyk7XHJcbiAgICAgICAgICAgIGlmIChncHVUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBOdWxsIG9uIGZhaWx1cmUsIHdoaWNoIGFsc28gZmxpcHMgdGhlIGdsb2JhbCBmbGFnOiB0aGUgbmV4dCBzeW5jJ3NcclxuICAgICAgICAgICAgICAgIC8vIHJlYnVpbGQga2V5IGNoYW5nZXMgd2l0aCBpdCBhbmQgdGhlIENQVSBwYXRoIHRha2VzIG92ZXIuXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9JbnN0YW5jZSh0aGlzLmdsUG9pbnRzLCBncHVBdHRycyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5nbFBvaW50cykgdGhpcy5nbFBvaW50cy5yZW1vdmUoKTtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhbnZhcyA9IG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xyXG4gICAgICAgICAgICBpZiAoY2FudmFzKSBjYW52YXMuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xyXG4gICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XHJcbiAgICByZXR1cm4gaW5zdGFuY2U7XHJcbn1cclxuIiwgIi8vIFBlcm1hbmVudCBmZWF0dXJlIGxhYmVsczogdGV4dCBwaW5uZWQgdG8gdGhlIG1hcCwgZnJvbSBhIGxheWVyJ3MgYGxhYmVsYCAob25lXHJcbi8vIHZlY3RvciBmZWF0dXJlKSBvciBgbGFiZWxzYCAob25lIHBlciBwb2ludCwgYWxpZ25lZCB3aXRoIHRoZSBjb29yZGluYXRlIGJ1ZmZlcikuXHJcbi8vIERPTSBlbGVtZW50cyBieSBkZXNpZ24gLS0gTGVhZmxldCBwZXJtYW5lbnQgdG9vbHRpcHMgLS0gd2hpY2ggaXMgd2h5IHRoZXkgYXJlIGZvclxyXG4vLyBzaXRlLXNjYWxlIGxheWVyczsgUHl0aG9uIHdhcm5zIHBhc3QgYSB0aG91c2FuZC4gTW9kZWwtZnJlZSBsaWtlIHRoZSBsZWdlbmQ6IHB1cmVcclxuLy8gZGF0YSBpbiwgTGVhZmxldCBsYXllcnMgb3V0LCByZS1kZXJpdmVkIGVhY2ggc3luYyBzbyBsYWJlbHMgZm9sbG93IHZpc2liaWxpdHlcclxuLy8gd2l0aG91dCB0b3VjaGluZyB0aGUgR0wgYnVja2V0cyBvciB0aGVpciBtZXRhIGtleXMuXHJcblxyXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSB9IGZyb20gXCIuL21hcC5qc1wiO1xyXG5pbXBvcnQgeyB2ZWN0b3JDb29yZHMsIGxpbmVQYXJ0cyB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xyXG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFdoZXRoZXIgYSB3aG9sZSBsYWJlbGxlZCBmZWF0dXJlIGlzIGluc2lkZSB0aGUgY3VycmVudCB0aW1lIHdpbmRvdy4gTmFOIHRpbWVzXHJcbi8vIGtlZXAgdGhlIGxhYmVsLCBtYXRjaGluZyB0aGUgbWFwOiBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YSwgc28gaXRcclxuLy8gbXVzdCBuZXZlciBoaWRlIHRoZSBkYXRhJ3MgbGFiZWwgZWl0aGVyLiBBIG11bHRpLXNwYW4gbGluZSBjb3VudHMgYXMgdmlzaWJsZVxyXG4vLyB3aGlsZSBBTlkgb2YgaXRzIHNlZ21lbnRzIGlzIC0tIHRoZSBsYWJlbCBmb2xsb3dzIHRoZSBsYXllciwgbm90IG9uZSBsZWcuXHJcbmZ1bmN0aW9uIHRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghdGltZVN0YXRlIHx8ICFsYXllci50aW1lKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIHJldHVybiB0cnVlO1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIE9uZSBhbmNob3IgcGVyIGxhYmVsbGVkIGZlYXR1cmUuIFBvaW50cyBsYWJlbCBhdCB0aGUgcG9pbnQ7IGEgbGluZSBsYWJlbHMgYXQgaXRzXHJcbi8vIG1pZGRsZSB2ZXJ0ZXggKG9uIHRoZSBsaW5lLCBub3QgZmxvYXRpbmcgaW4gaXRzIGJvdW5kaW5nIGJveCk7IGEgcG9seWdvbiBvclxyXG4vLyBjaXJjbGUgbGFiZWxzIGF0IGl0cyBib3VuZHMgY2VudHJlLiBXaXRoIGEgdGltZVN0YXRlLCBsYWJlbHMgZm9sbG93IHRoZSB3aW5kb3c6XHJcbi8vIHBvaW50cyBkcm9wIHBlciBwb2ludCwgdmVjdG9ycyBhcyBhIHdob2xlLlxyXG4vLyBEZWdyZWUtc3BhY2UgbGVuZ3RoIG9mIGEgW2xhdCwgbG5nXSBydW4gLS0gb25seSBldmVyIGNvbXBhcmVkIGFnYWluc3QgYW5vdGhlclxyXG4vLyBwYXJ0IG9mIHRoZSBzYW1lIGxpbmUsIHNvIG5vIHByb2plY3Rpb24gaXMgbmVlZGVkIHRvIHBpY2sgdGhlIGxvbmdlciBvbmUuXHJcbmZ1bmN0aW9uIHBsYW5hckxlbmd0aChwYXJ0KSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBwYXJ0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZExhdCA9IHBhcnRbaV1bMF0gLSBwYXJ0W2kgLSAxXVswXTtcclxuICAgICAgICBjb25zdCBkTG5nID0gcGFydFtpXVsxXSAtIHBhcnRbaSAtIDFdWzFdO1xyXG4gICAgICAgIHRvdGFsICs9IE1hdGguc3FydChkTGF0ICogZExhdCArIGRMbmcgKiBkTG5nKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0b3RhbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IG91dCA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSBjb250aW51ZTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLmNvbGxlY3RMYWJlbHMobGF5ZXIubGF5ZXJzIHx8IFtdLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSkpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobGF5ZXIubGFiZWxzKSkge1xyXG4gICAgICAgICAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICBpZiAoIXJhdykgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgICAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihsYXllci5sYWJlbHMubGVuZ3RoLCBjb29yZHMubGVuZ3RoIC8gMik7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllci5sYWJlbHNbaV0pIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbaSAqIDJdKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGNvb3Jkc1tpICogMl0sIGxuZzogY29vcmRzW2kgKiAyICsgMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbHNbaV0pLCBjZW50ZXI6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChsYXllci5sYWJlbCkge1xyXG4gICAgICAgICAgICBpZiAoIXRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgICAgICAgICAgLy8gQW5jaG9yIE9OIGEgcGFydCAtLSB0aGUgbWlkZGxlIHZlcnRleCBvZiB0aGUgbG9uZ2VzdCBwYXJ0LiBUaGVcclxuICAgICAgICAgICAgICAgIC8vIG1pZGRsZSBvZiBhIG11bHRpLXBhcnQgbGluZSdzIHdob2xlIHZlcnRleCBydW4gY2FuIHNpdCBpbiB0aGUgZ2FwXHJcbiAgICAgICAgICAgICAgICAvLyBiZXR3ZWVuIHBhcnRzLCB3aGVyZSB0aGVyZSBpcyBub3RoaW5nIHRvIGxhYmVsLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFydHMgPSBsaW5lUGFydHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb25nZXN0ID0gcGFydHMucmVkdWNlKChiZXN0LCBwYXJ0KSA9PlxyXG4gICAgICAgICAgICAgICAgICAgIHBsYW5hckxlbmd0aChwYXJ0KSA+IHBsYW5hckxlbmd0aChiZXN0KSA/IHBhcnQgOiBiZXN0LCBwYXJ0c1swXSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtaWQgPSBsb25nZXN0W01hdGguZmxvb3IoKGxvbmdlc3QubGVuZ3RoIC0gMSkgLyAyKV07XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbWlkWzBdLCBsbmc6IG1pZFsxXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5ib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtbYUxhdCwgYUxvbl0sIFtiTGF0LCBiTG9uXV0gPSBsYXllci5ib3VuZHM7XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKGFMYXQgKyBiTGF0KSAvIDIsIGxuZzogKGFMb24gKyBiTG9uKSAvIDIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5sb2NhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGxheWVyLmxvY2F0aW9uWzBdLCBsbmc6IGxheWVyLmxvY2F0aW9uWzFdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBObyBib3VuZHMgb24gdGhlIGNvbmZpZyAtLSB0aGUgY29sbGVjdGlvbiBtZXJnZSBkcm9wcGVkIHRoZW0gZm9yXHJcbiAgICAgICAgICAgICAgICAvLyBpdHMgd2hvbGUgaGlzdG9yeSwgYW5kIGhhbmQtYnVpbHQgY29uZmlncyBtYXkgbmV2ZXIgY2FycnkgdGhlbS5cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBjb29yZGluYXRlcyBhcmUgc3RpbGwgaW4gdGhlIGJ1ZmZlciB1bmRlciB0aGUgbGF5ZXIncyBvd24gaWQsXHJcbiAgICAgICAgICAgICAgICAvLyBleGFjdGx5IGFzIHRoZSBwb2x5bGluZSBicmFuY2ggcmVhZHMgdGhlbTsgYSBtaXNzaW5nIGJveCBtdXN0XHJcbiAgICAgICAgICAgICAgICAvLyBkZWdyYWRlIHRvIGNvbXB1dGluZyBvbmUsIG5ldmVyIHRvIHNpbGVudGx5IGRyb3BwaW5nIHRoZSBsYWJlbC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvY3MubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICAgICAgbGV0IG1pbkxuZyA9IEluZmluaXR5LCBtYXhMbmcgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtsYXQsIGxuZ10gb2YgbG9jcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA8IG1pbkxuZykgbWluTG5nID0gbG5nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsbmcgPiBtYXhMbmcpIG1heExuZyA9IGxuZztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAobWluTGF0ICsgbWF4TGF0KSAvIDIsIGxuZzogKG1pbkxuZyArIG1heExuZykgLyAyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBSZWJ1aWxkcyBgZ3JvdXBgIChhbiBMLmxheWVyR3JvdXApIHRvIGhvbGQgZXhhY3RseSB0aGUgY3VycmVudCBsYWJlbHMsIHNraXBwaW5nXHJcbi8vIHRoZSB3b3JrIHdoZW4gbm90aGluZyBjaGFuZ2VkIC0tIHN5bmNzIHJ1biBvbiBldmVyeSB0b2dnbGUgYW5kIHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMYWJlbHMoTCwgZ3JvdXAsIGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBsYWJlbHMgPSBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUpO1xyXG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkobGFiZWxzKTtcclxuICAgIGlmIChncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9PT0ga2V5KSByZXR1cm47XHJcbiAgICBncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9IGtleTtcclxuICAgIGdyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbGFiZWxzKSB7XHJcbiAgICAgICAgLy8gQ29udGVudCBhcyBhbiBlbGVtZW50IHdpdGggdGV4dENvbnRlbnQ6IHRvb2x0aXAgc3RyaW5nIGNvbnRlbnQgaXMgSFRNTCxcclxuICAgICAgICAvLyBhbmQgbGFiZWxzIGNvbWUgZnJvbSB1c2VyIGRhdGEsIHdoaWNoIG11c3QgbmV2ZXIgcGFyc2UgYXMgbWFya3VwLlxyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gaXRlbS50ZXh0O1xyXG4gICAgICAgIGNvbnN0IHRvb2x0aXAgPSBMLnRvb2x0aXAoe1xyXG4gICAgICAgICAgICBwZXJtYW5lbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGRpcmVjdGlvbjogaXRlbS5jZW50ZXIgPyBcImNlbnRlclwiIDogXCJ0b3BcIixcclxuICAgICAgICAgICAgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWZlYXR1cmUtbGFiZWxcIixcclxuICAgICAgICAgICAgb2Zmc2V0OiBpdGVtLmNlbnRlciA/IFswLCAwXSA6IFswLCAtNl0sXHJcbiAgICAgICAgfSkuc2V0TGF0TG5nKFtpdGVtLmxhdCwgaXRlbS5sbmddKS5zZXRDb250ZW50KHNwYW4pO1xyXG4gICAgICAgIGdyb3VwLmFkZExheWVyKHRvb2x0aXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkQ1NTLCBsb2FkSlMgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJTaWRlYmFyQ29udHJvbHMsIG5vcm1hbGl6ZVJhZGlvTGF5ZXJzLCBzZW5kTGF5ZXJXcml0ZSB9IGZyb20gXCIuL3NpZGViYXIuanNcIjtcclxuaW1wb3J0IHsgZGVyaXZlTGVnZW5kU3BlYywgcmVuZGVyTGVnZW5kIH0gZnJvbSBcIi4vbGVnZW5kLmpzXCI7XHJcbmltcG9ydCB7IHJlbmRlckxhYmVscyB9IGZyb20gXCIuL2xhYmVscy5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJMYXllciwgcmVuZGVyTWVyZ2VkR2xMYXllciwgcmVnaXN0ZXJDbGlja01hdGNoLCBpbWFnZU1ldGFLZXkgfSBmcm9tIFwiLi9sYXllcnMuanNcIjtcclxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIGdlbmVyYXRlVGlja3MsIGNvbGxlY3RUaW1lRXh0ZW50LCBoYXNUaW1lTGF5ZXJzLFxyXG4gICAgICAgICBsYXllckluV2luZG93LCByZW5kZXJUaW1lQ29udHJvbCwgYWR2YW5jZSwgcGVyaW9kVG9NcywgZ2NkR3JpZE1zLFxyXG4gICAgICAgICBjb2xsZWN0RHVyYXRpb25zTXMsIFBPU0lUSU9OUywgdGltZXNGb3IsIHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LFxyXG4gICAgICAgICBlZmZlY3RpdmVEdXJhdGlvbiB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XHJcbmltcG9ydCB7IGdwdVRpbWVBdmFpbGFibGUsIHZlY3RvckdwdUF2YWlsYWJsZSwgTEFZRVJfU0xPVFMgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG4vLyBUcnVlIGlmIGEgbGF5ZXIgaXMgdmlzaWJsZSBhbmQgbm8gZm9sZGVyIGFib3ZlIGl0IGlzIHN3aXRjaGVkIG9mZi5cclxuLy9cclxuLy8gVmlzaWJpbGl0eSBpcyBpbmhlcml0ZWQgZG93biB0aGUgZm9sZGVyIHBhdGg6IGEgbGF5ZXIgaW5zaWRlIFwiRmVlZHMvQWN0aXZlXCIgaXMgaGlkZGVuXHJcbi8vIHdoZW4gZWl0aGVyIFwiRmVlZHNcIiBvciBcIkZlZWRzL0FjdGl2ZVwiIGlzIG9mZiwgcmVnYXJkbGVzcyBvZiBpdHMgb3duIGZsYWcuIEdldHRpbmcgdGhpc1xyXG4vLyB3cm9uZyBzaG93cyB1cCBhcyBcInRoYXQgbGF5ZXIganVzdCB3aWxsIG5vdCBhcHBlYXJcIiwgd2l0aCBub3RoaW5nIGxvZ2dlZC5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpIHtcclxuICAgIGlmIChsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcclxuICAgIGZvciAoY29uc3QgcGFydCBvZiAobGF5ZXIubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIikuc3BsaXQoXCIvXCIpKSB7XHJcbiAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XHJcbiAgICAgICAgY29uc3QgY29uZmlnID0gZ3JvdXBDb25maWdzW3J1bm5pbmdQYXRoXTtcclxuICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbi8vIFNvcnRzIHRoZSB2aXNpYmxlIGxheWVycyBpbnRvIG9uZSBidWNrZXQgcGVyIFdlYkdMIGRyYXcgcGFzcy5cclxuLy9cclxuLy8gU3ViLWxheWVycyBvZiBhIG1lcmdlZCBncm91cCBpbmhlcml0IHRoZWlyIHBhcmVudCdzIHZpc2liaWxpdHkgcmF0aGVyIHRoYW4gY2FycnlpbmdcclxuLy8gdGhlaXIgb3duLCBzbyBhIGdyb3VwIHRvZ2dsZWQgb2ZmIGNvbnRyaWJ1dGVzIG5vdGhpbmcgZXZlbiB3aGVuIGl0cyBjaGlsZHJlbiBzYXlcclxuLy8gdmlzaWJsZS4gQ2lyY2xlcyBqb2luIHRoZSBwb2x5Z29uIGJ1Y2tldDogdGhleSBhcmUgZHJhd24gYXMgZ2VuZXJhdGVkIHJpbmdzLlxyXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKSB7XHJcbiAgICBjb25zdCBidWNrZXRzID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XHJcblxyXG4gICAgZnVuY3Rpb24gY29sbGVjdChsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWJMYXllcikge1xyXG4gICAgICAgIGlmICghcGFyZW50VmlzaWJsZSkgcmV0dXJuO1xyXG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGxheWVyLmxheWVycy5mb3JFYWNoKHN1YiA9PiBjb2xsZWN0KHN1YiwgcGFyZW50VmlzaWJsZSwgdHJ1ZSkpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghaXNTdWJMYXllciAmJiBsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuO1xyXG5cclxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xyXG4gICAgICAgIGlmIChidWNrZXRzW2J1Y2tldF0pIGJ1Y2tldHNbYnVja2V0XS5wdXNoKGxheWVyKTtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xyXG4gICAgICAgIGNvbGxlY3QobGF5ZXIsIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpLCBmYWxzZSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYnVja2V0cztcclxufVxyXG5cclxuLy8gQXBwbGllcyBpbmNyZW1lbnRhbCBwYXRjaCBvcHMgdG8ge2xheWVycywgYnVmZmVyc30sIHJldHVybmluZyB0aGUgbmV3IHN0YXRlLlxyXG4vL1xyXG4vLyBPcHMgYXJlIGFkZHJlc3NlZCBieSBsYXllciBpZCBhbmQgYXBwbGllZCBpZGVtcG90ZW50bHk6IFwiYWRkXCIgdXBzZXJ0cyByYXRoZXIgdGhhblxyXG4vLyBhcHBlbmRpbmcgYmxpbmRseSwgc28gYSBwYXRjaCB0aGF0IHJhY2VzIHRoZSBpbml0aWFsIHRyYWl0IHNuYXBzaG90IGNhbm5vdCBkdXBsaWNhdGVcclxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxyXG4vLyBBcHBsaWVzIGB1cGRhdGVgIHRvIG9uZSBsYXllciB3aGVyZXZlciBpdCBzaXRzLCBkZXNjZW5kaW5nIGludG8gZ3JvdXBzLiBhZGRfY29sbGVjdGlvblxyXG4vLyBuZXN0cyBpdHMgcG9pbnQsIGxpbmUgYW5kIHBvbHlnb24gbGF5ZXJzIGluc2lkZSBhIGdyb3VwIGxheWVyLCBzbyBhbiBvcCBhZGRyZXNzZWQgYXQgYVxyXG4vLyBuZXN0ZWQgaWQgd291bGQgb3RoZXJ3aXNlIG1hdGNoIG5vdGhpbmcgYW5kIHNpbGVudGx5IGRvIG5vdGhpbmcuIFJldHVybnMgdGhlIG9yaWdpbmFsXHJcbi8vIGFycmF5IHVudG91Y2hlZCB3aGVuIHRoZSBpZCBpcyBub3QgZm91bmQsIHNvIGFuIHVubWF0Y2hlZCBvcCBjb3N0cyBubyByZS1yZW5kZXIuXHJcbmZ1bmN0aW9uIHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIGlkLCB1cGRhdGUpIHtcclxuICAgIGxldCBoaXQgPSBmYWxzZTtcclxuICAgIGNvbnN0IG5leHQgPSBsYXllcnMubWFwKGwgPT4ge1xyXG4gICAgICAgIGlmIChsLmlkID09PSBpZCkge1xyXG4gICAgICAgICAgICBoaXQgPSB0cnVlO1xyXG4gICAgICAgICAgICByZXR1cm4gdXBkYXRlKGwpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgQXJyYXkuaXNBcnJheShsLmxheWVycykpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3VicyA9IHVwZGF0ZUxheWVyQnlJZChsLmxheWVycywgaWQsIHVwZGF0ZSk7XHJcbiAgICAgICAgICAgIGlmIChzdWJzICE9PSBsLmxheWVycykge1xyXG4gICAgICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IC4uLmwsIGxheWVyczogc3VicyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBsO1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gaGl0ID8gbmV4dCA6IGxheWVycztcclxufVxyXG5cclxuLy8gRXZlcnkgcG9pbnQgbGF5ZXIsIHZpc2libGUgb3Igbm90LCB3aXRoIGl0cyBlZmZlY3RpdmUgdmlzaWJpbGl0eSByZWNvcmRlZCAtLSB0aGVcclxuLy8gR1BVLXZpc2liaWxpdHkgcGF0aCBrZWVwcyBoaWRkZW4gbGF5ZXJzIGluIHRoZSBidWNrZXQgKHN0YWJsZSBpZHMsIG5vIHJlYnVpbGQgb24gYVxyXG4vLyB0b2dnbGUpIGFuZCBoaWRlcyB0aGVtIHdpdGggYSB1bmlmb3JtIGluc3RlYWQuIE1pcnJvcnMgY29sbGVjdFdlYmdsTGF5ZXJzJyBydWxlczpcclxuLy8gc3ViLWxheWVycyBpbmhlcml0IHRoZWlyIHBhcmVudCdzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5LCB0b3AtbGV2ZWwgbGF5ZXJzIGFuc3dlciBmb3JcclxuLy8gdGhlaXIgb3duIGZsYWcgYW5kIHRoZWlyIGZvbGRlciBjaGFpbi5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3Qgb3V0ID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XHJcbiAgICBmdW5jdGlvbiB3YWxrKGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1Yikge1xyXG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNlbGZWaXMgPSBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gd2FsayhzdWIsIHNlbGZWaXMsIHRydWUpKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xyXG4gICAgICAgIGlmICghb3V0W2J1Y2tldF0pIHJldHVybjtcclxuICAgICAgICBjb25zdCB2aXMgPSBpc1N1YiA/IHBhcmVudFZpc2libGVcclxuICAgICAgICAgICAgOiBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgIG91dFtidWNrZXRdLnB1c2goeyBsYXllciwgdmlzIH0pO1xyXG4gICAgfVxyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHdhbGsobGF5ZXIsIHRydWUsIGZhbHNlKTtcclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIEJ1ZmZlciBpZGVudGl0eSBmb3IgdGhlIEdMIG1ldGEga2V5LiBBIG5ldyBEYXRhVmlldyB1bmRlciBhIGxheWVyIGlkIC0tIGFcclxuLy8gYnVmZmVyIG9wIGZyb20gdXBkYXRlX2xheWVyKGRhdGE9Li4uKSwgb3IgdGhlIHRyYWl0IHJlc2VlZGVkIC0tIG11c3QgcmVidWlsZFxyXG4vLyB0aGUgYnVja2V0IGV2ZW4gd2hlbiB0aGUgYnl0ZSBsZW5ndGggaXMgdW5jaGFuZ2VkIChwb2ludHMgbW92ZWQsIGNvbG91cnNcclxuLy8gcmVjb21wdXRlZCkuIFRoZSBzZXJpYWwgaXMgcGVyIG9iamVjdCwgc28gYW4gdW50b3VjaGVkIGJ1ZmZlciBrZWVwcyBpdHMgbnVtYmVyXHJcbi8vIGFuZCBjb3N0cyBubyByZWJ1aWxkLiBXb3JrcyBmb3IgYW55IGNvbnN1bWVyIHRoYXQgc3dhcHMgYSBidWZmZXIsIFB5dGhvbiBvciBub3QuXHJcbmNvbnN0IGJ1ZmZlclNlcmlhbHMgPSBuZXcgV2Vha01hcCgpO1xyXG5sZXQgbmV4dEJ1ZmZlclNlcmlhbCA9IDE7XHJcbmZ1bmN0aW9uIGJ1ZmZlclNlcmlhbChidWYpIHtcclxuICAgIGlmICghYnVmIHx8IHR5cGVvZiBidWYgIT09IFwib2JqZWN0XCIpIHJldHVybiAwO1xyXG4gICAgbGV0IHNlcmlhbCA9IGJ1ZmZlclNlcmlhbHMuZ2V0KGJ1Zik7XHJcbiAgICBpZiAoIXNlcmlhbCkge1xyXG4gICAgICAgIHNlcmlhbCA9IG5leHRCdWZmZXJTZXJpYWwrKztcclxuICAgICAgICBidWZmZXJTZXJpYWxzLnNldChidWYsIHNlcmlhbCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc2VyaWFsO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTd2lmdG1hcFBhdGNoKHN0YXRlLCBvcHMsIGJ1ZmZlcnMpIHtcclxuICAgIGxldCBsYXllcnMgPSBzdGF0ZS5sYXllcnMgfHwgW107XHJcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG9wIG9mIG9wcykge1xyXG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XHJcbiAgICAgICAgICAgIGxheWVycyA9IG9wLmxheWVycyB8fCBbXTtcclxuICAgICAgICAgICAgYnVmZmVyTWFwID0ge307XHJcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcnMgJiYgYnVmZmVyc1tpXSkgYnVmZmVyTWFwW2lkXSA9IGJ1ZmZlcnNbaV07XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGluY29taW5nID0gb3AubGF5ZXI7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkID0gaW5jb21pbmcgPyBpbmNvbWluZy5pZCA6IG9wLmlkO1xyXG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xyXG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xyXG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gWy4uLmxheWVycywgaW5jb21pbmddO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLm1hcCgobCwgaSkgPT4gKGkgPT09IGlkeCA/IGluY29taW5nIDogbCkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzZXRcIikge1xyXG4gICAgICAgICAgICAvLyBGaWVsZC1sZXZlbCB1cGRhdGUuIFwicmVwbGFjZVwiIGNhcnJpZXMgdGhlIHdob2xlIGxheWVyLCBzbyBmbGlwcGluZyBgdmlzaWJsZWBcclxuICAgICAgICAgICAgLy8gb24gYSA1MGstcG9pbnQgbGF5ZXIgcmVzZW50IGV2ZXJ5IHByb3BlcnR5IGl0IGhvbGRzIC0tIGhhbGYgYSBtZWdhYnl0ZSB0b1xyXG4gICAgICAgICAgICAvLyBjaGFuZ2Ugb25lIGJvb2xlYW4sIG9uIGV2ZXJ5IGNsaWNrIG9mIGEgY2hlY2tib3guXHJcbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7IC4uLmwsIC4uLihvcC5maWVsZHMgfHwge30pIH0pKTtcclxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInN0eWxlXCIpIHtcclxuICAgICAgICAgICAgLy8gUGVyLWZlYXR1cmUgc3R5bGUgb3ZlcnJpZGVzLCByZXBsYWNlZCB3aG9sZXNhbGUgcmF0aGVyIHRoYW4gbWVyZ2VkOiBhXHJcbiAgICAgICAgICAgIC8vIHNlbGVjdGlvbiBkZXNjcmliZXMgaXRzIGNvbXBsZXRlIHN0YXRlLCBzbyBzZW5kaW5nIHt9IGNsZWFycyBpdCBhbmQgbm9cclxuICAgICAgICAgICAgLy8gY2FsbGVyIGhhcyB0byB0cmFjayB3aGF0IHRoZSBwcmV2aW91cyBoaWdobGlnaHQgdG91Y2hlZC5cclxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHtcclxuICAgICAgICAgICAgICAgIC4uLmwsIHN0eWxlX292ZXJyaWRlczogb3Aub3ZlcnJpZGVzIHx8IHt9LFxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xyXG4gICAgICAgICAgICBsYXllcnMgPSBsYXllcnMuZmlsdGVyKGwgPT4gbC5pZCAhPT0gb3AuaWQpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyXCIpIHtcclxuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XHJcbiAgICAgICAgICAgIGlmIChidWYpIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwLCBbb3AuaWRdOiBidWYgfTtcclxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlcl9yZW1vdmVcIikge1xyXG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xyXG4gICAgICAgICAgICBkZWxldGUgYnVmZmVyTWFwW29wLmlkXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHsgbGF5ZXJzLCBidWZmZXJzOiBidWZmZXJNYXAgfTtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQge1xyXG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcclxuICAgICAgICBjb25zdCBvcmlnaW5hbEVycm9yID0gY29uc29sZS5lcnJvcjtcclxuICAgICAgICBjb25zdCBvcmlnaW5hbFdhcm4gPSBjb25zb2xlLndhcm47XHJcblxyXG4gICAgICAgIC8vIGpzX2NvbnNvbGVfbG9ncyBpcyBhIHN5bmNlZCBsaXN0LCBzbyBlYWNoIGFwcGVuZCByZXNlbmRzIHRoZSB3aG9sZSBhcnJheS4gS2VlcGluZ1xyXG4gICAgICAgIC8vIG9ubHkgdGhlIG1vc3QgcmVjZW50IGVudHJpZXMgYm91bmRzIGJvdGggdGhlIHBheWxvYWQgYW5kIHRoZSBtZW1vcnkgYSBsb25nLWxpdmVkXHJcbiAgICAgICAgLy8gc2Vzc2lvbiBhY2N1bXVsYXRlczsgdGhlIG5ld2VzdCBhcmUgdGhlIG9uZXMgd29ydGggaGF2aW5nIGFueXdheS5cclxuICAgICAgICBjb25zdCBNQVhfQ09OU09MRV9MT0dTID0gMjAwO1xyXG4gICAgICAgIGNvbnN0IGFwcGVuZExvZyA9IGVudHJ5ID0+IHtcclxuICAgICAgICAgICAgY29uc3QgbG9ncyA9IG1vZGVsLmdldChcImpzX2NvbnNvbGVfbG9nc1wiKSB8fCBbXTtcclxuICAgICAgICAgICAgY29uc3QgbmV4dCA9IFsuLi5sb2dzLCBlbnRyeV07XHJcbiAgICAgICAgICAgIHJldHVybiBuZXh0Lmxlbmd0aCA+IE1BWF9DT05TT0xFX0xPR1MgPyBuZXh0LnNsaWNlKC1NQVhfQ09OU09MRV9MT0dTKSA6IG5leHQ7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gSGVscGVyIHRvIHNhZmVseSB3cml0ZSBiYWNrIHRvIFB5dGhvbiBvbmx5IGlmIHRoZSB3aWRnZXQgdmlldyBpcyBhY3RpdmUgYW5kIGF0dGFjaGVkXHJcbiAgICAgICAgZnVuY3Rpb24gc2FmZVNldEFuZFNhdmUoa2V5LCB2YWx1ZSkge1xyXG4gICAgICAgICAgICBpZiAoZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KGtleSwgdmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBzYWZlU2F2ZUNoYW5nZXMoKSB7XHJcbiAgICAgICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHNhdmUgZXJyb3I6XCIsIGUpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmVycm9yID0gZnVuY3Rpb24oLi4uYXJncykge1xyXG4gICAgICAgICAgICBvcmlnaW5hbEVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xyXG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxyXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xyXG4gICAgICAgIGNvbnNvbGUud2FybiA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcclxuICAgICAgICAgICAgY29uc3QgbXNnID0gYXJncy5tYXAoYSA9PiBTdHJpbmcoYSkpLmpvaW4oXCIgXCIpO1xyXG4gICAgICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsb2dnZWRSZXByb2plY3RlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlZFJlcHJvamVjdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBtb2RlbC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGVhbk1zZyA9IGBbU3dpZnRNYXBdIExheWVyIHdhcyByZXByb2plY3RlZCB0byBcIiR7Y3JzfVwiYDtcclxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBjbGVhbk1zZyk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIiwgYXBwZW5kTG9nKGNsZWFuTXNnKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHdpbmRvdy5vbmVycm9yID0gZnVuY3Rpb24obWVzc2FnZSwgc291cmNlLCBsaW5lbm8sIGNvbG5vLCBlcnJvcikge1xyXG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxyXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKGBXSU5ET1cuT05FUlJPUjogJHttZXNzYWdlfSBhdCAke3NvdXJjZX06JHtsaW5lbm99OiR7Y29sbm99YCkpO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIExvYWQgQ1NTIGFuZCBMZWFmbGV0IGxpYnJhcmllcyAoaW5jbHVkaW5nIFdlYkdMIGdsaWZ5KVxyXG4gICAgICAgIGxvYWRDU1MoXCJsZWFmbGV0LWNzc1wiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXRAMS45LjQvZGlzdC9sZWFmbGV0LmNzc1wiKTtcclxuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWpzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIik7XHJcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1nbGlmeVwiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXQuZ2xpZnlAMy4zLjAvZGlzdC9nbGlmeS1icm93c2VyLmpzXCIpO1xyXG4gICAgICAgIC8vIEdlb21hbiBtdXN0IGxvYWQgQkVGT1JFIHRoZSBtYXAgaXMgY29uc3RydWN0ZWQ6IGl0IGF0dGFjaGVzIG1hcC5wbSB0aHJvdWdoXHJcbiAgICAgICAgLy8gYSBMZWFmbGV0IGluaXQgaG9vaywgd2hpY2ggb25seSBydW5zIGZvciBtYXBzIGNyZWF0ZWQgYWZ0ZXIgdGhlIHBsdWdpblxyXG4gICAgICAgIC8vIGV4aXN0cyAtLSBsYXp5LWxvYWRpbmcgaXQgbGF0ZXIgbGVhdmVzIG1hcC5wbSB1bmRlZmluZWQgZm9yZXZlci5cclxuICAgICAgICBsb2FkQ1NTKFwibGVhZmxldC1nZW9tYW4tY3NzXCIsXHJcbiAgICAgICAgICAgIFwiaHR0cHM6Ly91bnBrZy5jb20vQGdlb21hbi1pby9sZWFmbGV0LWdlb21hbi1mcmVlQDIuMTguMy9kaXN0L2xlYWZsZXQtZ2VvbWFuLmNzc1wiKTtcclxuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdlb21hblwiLFxyXG4gICAgICAgICAgICBcImh0dHBzOi8vdW5wa2cuY29tL0BnZW9tYW4taW8vbGVhZmxldC1nZW9tYW4tZnJlZUAyLjE4LjMvZGlzdC9sZWFmbGV0LWdlb21hbi5taW4uanNcIik7XHJcblxyXG4gICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgY29udGFpbmVyLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtY29udGFpbmVyXCI7XHJcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XHJcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xyXG4gICAgICAgIGVsLmFwcGVuZENoaWxkKGNvbnRhaW5lcik7XHJcblxyXG4gICAgICAgIC8vIE1hcChoZWlnaHQ9Li4uKSBzaXppbmcuIEFuIGV4cGxpY2l0IGhlaWdodCBhbHNvIGRyb3BzIHRoZSBzdHlsZXNoZWV0J3NcclxuICAgICAgICAvLyA0MDBweCBmbG9vciAtLSBhbiBleHBsaWNpdCAyMDBweCBtdXN0IG5vdCBsb3NlIHRvIGEgZGVmYXVsdCBtaW5pbXVtLlxyXG4gICAgICAgIC8vIEhlaWdodCB3YXMgYWNjZXB0ZWQgYW5kIGRvY3VtZW50ZWQgbG9uZyBiZWZvcmUgaXQgcmVhY2hlZCB0aGUgRE9NOyB0aGlzXHJcbiAgICAgICAgLy8gaXMgd2hlcmUgaXQgZmluYWxseSBkb2VzLlxyXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5SGVpZ2h0KCkge1xyXG4gICAgICAgICAgICBjb25zdCBoID0gbW9kZWwuZ2V0KFwiaGVpZ2h0XCIpO1xyXG4gICAgICAgICAgICBjb250YWluZXIuc3R5bGUuaGVpZ2h0ID0gaCB8fCBcIjEwMCVcIjtcclxuICAgICAgICAgICAgY29udGFpbmVyLnN0eWxlLm1pbkhlaWdodCA9IGggPyBcIjBcIiA6IFwiXCI7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGFwcGx5SGVpZ2h0KCk7XHJcblxyXG4gICAgICAgIGxldCBsYWJlbHNHcm91cCA9IG51bGw7ICAgLy8gY3JlYXRlZCBhZnRlciB0aGUgbWFwOyBmaWxsZWQgYnkgZWFjaCBzeW5jXHJcblxyXG4gICAgICAgIGNvbnN0IGNyc05hbWUgPSBtb2RlbC5nZXQoXCJjcnNcIik7XHJcbiAgICAgICAgbGV0IG1hcENycyA9IEwuQ1JTLkVQU0czODU3O1xyXG4gICAgICAgIGlmIChjcnNOYW1lID09PSBcIkVQU0c6NDMyNlwiKSB7XHJcbiAgICAgICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbWFwID0gTC5tYXAoY29udGFpbmVyLCB7XHJcbiAgICAgICAgICAgIGNyczogbWFwQ3JzLFxyXG4gICAgICAgICAgICBjZW50ZXI6IG1vZGVsLmdldChcImNlbnRlclwiKSxcclxuICAgICAgICAgICAgem9vbTogbW9kZWwuZ2V0KFwiem9vbVwiKSxcclxuICAgICAgICAgICAgc2Nyb2xsV2hlZWxab29tOiB0cnVlLFxyXG4gICAgICAgICAgICBwcmVmZXJDYW52YXM6IHRydWVcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIGN1c3RvbSBwYW5lcyBmb3Igc3RyaWN0IFotaW5kZXggb3JkZXJpbmdcclxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcclxuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlnb25zUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQxMFwiO1xyXG4gICAgICAgIFxyXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcclxuICAgICAgICBtYXAuZ2V0UGFuZShcInBvbHlsaW5lc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MjBcIjtcclxuICAgICAgICBcclxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XHJcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDMwXCI7XHJcblxyXG4gICAgICAgIC8vIERyYXduIHZlY3RvcnMgbGl2ZSBBQk9WRSB0aGUgR0wgcGFuZXMuIEdlb21hbiBkZWZhdWx0cyB0aGVtIGludG8gTGVhZmxldCdzXHJcbiAgICAgICAgLy8gb3ZlcmxheVBhbmUgKDQwMCksIHdoaWNoIHNpdHMgdW5kZXIgdGhlIEdMIGNhbnZhc2VzICg0MTAvNDIwLzQzMCkgd2hvc2VcclxuICAgICAgICAvLyBwb2ludGVyLWV2ZW50cyBhcmUgZm9yY2VkIG9uIC0tIHNvIHdpdGggYW55IEdMIGxheWVyIHByZXNlbnQsIGNsaWNrcyBtZWFudFxyXG4gICAgICAgIC8vIGZvciBhIGRyYXduIHNoYXBlIG5ldmVyIGFycml2ZWQ6IGRyYXdpbmcgd29ya2VkIChHZW9tYW4gbGlzdGVucyBvbiB0aGVcclxuICAgICAgICAvLyBjb250YWluZXIpIHdoaWxlIHJlbW92YWwsIGVkaXQgYW5kIGRyYWcgc2lsZW50bHkgZGlkIG5vdGhpbmcuXHJcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJzd2lmdG1hcERyYXdQYW5lXCIpO1xyXG4gICAgICAgIG1hcC5nZXRQYW5lKFwic3dpZnRtYXBEcmF3UGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQ0MFwiO1xyXG5cclxuICAgICAgICBsYWJlbHNHcm91cCA9IEwubGF5ZXJHcm91cCgpLmFkZFRvKG1hcCk7XHJcblxyXG4gICAgICAgIC8vIExvY2FsIG1pcnJvcnMgb2YgdGhlIGxheWVyIGxpc3QgYW5kIGNvb3JkaW5hdGUgYnVmZmVycy5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIFB5dGhvbiB1cGRhdGVzIHRoZXNlIGluY3JlbWVudGFsbHkgdmlhIFwic3dpZnRtYXBfcGF0Y2hcIiBtZXNzYWdlcyBpbnN0ZWFkIG9mXHJcbiAgICAgICAgLy8gcmVhc3NpZ25pbmcgdGhlIHRyYWl0cywgYmVjYXVzZSBhIHRyYWl0IHJlYXNzaWdubWVudCByZS1zZXJpYWxpemVzIGFuZCByZS1zZW5kc1xyXG4gICAgICAgIC8vIHRoZSBlbnRpcmUgbWFwIG9uIGV2ZXJ5IG11dGF0aW9uLiBUaGUgdHJhaXRzIHN0aWxsIGNhcnJ5IHRoZSBpbml0aWFsIHNuYXBzaG90XHJcbiAgICAgICAgLy8gd2hlbiBhIHZpZXcgYXR0YWNoZXMsIGFuZCB0aGUgc2lkZWJhciBzdGlsbCB3cml0ZXMgYGxheWVyc2AgYmFjayBvbiB0b2dnbGUsIHNvXHJcbiAgICAgICAgLy8gYm90aCBhcmUgc2VlZGVkIGhlcmUgYW5kIGtlcHQgaW4gc3RlcCBieSB0aGUgY2hhbmdlIGhhbmRsZXJzIGZ1cnRoZXIgZG93bi5cclxuICAgICAgICBsZXQgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcclxuICAgICAgICBsZXQgYnVmZmVyU3RhdGUgPSB7IC4uLihtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pIH07XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5UGF0Y2hPcHMob3BzLCBidWZmZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhcHBseVN3aWZ0bWFwUGF0Y2goeyBsYXllcnM6IGxheWVyU3RhdGUsIGJ1ZmZlcnM6IGJ1ZmZlclN0YXRlIH0sIG9wcywgYnVmZmVycyk7XHJcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBuZXh0LmxheWVycztcclxuICAgICAgICAgICAgYnVmZmVyU3RhdGUgPSBuZXh0LmJ1ZmZlcnM7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMaXZlIGZlYXR1cmUgdmlzaWJpbGl0eSwgZm9yIGhpdC10ZXN0aW5nLiBHUFUtcGF0aCBidWNrZXRzIGtlZXAgRVZFUllcclxuICAgICAgICAvLyBsYXllciAtLSBoaWRkZW4gb25lcyBhcmUgbWFza2VkIGJ5IGEgc2hhZGVyIHVuaWZvcm0gLS0gYW5kIGdsaWZ5J3NcclxuICAgICAgICAvLyBoaXQtdGVzdHMgcnVuIGFnYWluc3QgdGhlIGJ1Y2tldCdzIGRhdGEsIHdoaWNoIGNhbm5vdCBzZWUgdW5pZm9ybXM6IGFcclxuICAgICAgICAvLyByYWRpby1oaWRkZW4gbGF5ZXIncyBmZWF0dXJlcyBzdGlsbCB3b24gY2xpY2tzIGFuZCBhbnN3ZXJlZCB3aXRoIHBvcHVwcy5cclxuICAgICAgICAvLyBMb29rZWQgdXAgZnJlc2ggcGVyIGV2ZW50LCBiZWNhdXNlIHRoZSBjb25maWcgY2FwdHVyZWQgYXQgYnVpbGQgdGltZSBnb2VzXHJcbiAgICAgICAgLy8gc3RhbGUgdGhlIG1vbWVudCBhIHBhdGNoIG9wIHJlcGxhY2VzIGl0OyB0aGUgdGltZSBjaGVjayByZWFkcyB0aGUgbGl2ZVxyXG4gICAgICAgIC8vIHRpY2sgdGhlIHNhbWUgd2F5LCBzaW5jZSB0aWNrcyBjaGFuZ2Ugd2l0aG91dCByZWJ1aWxkaW5nIHRoZSBidWNrZXQuXHJcbiAgICAgICAgZnVuY3Rpb24gZmluZExheWVyTm93KGxpc3QsIGlkKSB7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbCBvZiBsaXN0KSB7XHJcbiAgICAgICAgICAgICAgICBpZiAobC5pZCA9PT0gaWQpIHJldHVybiBsO1xyXG4gICAgICAgICAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3ViID0gZmluZExheWVyTm93KGwubGF5ZXJzIHx8IFtdLCBpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN1YikgcmV0dXJuIHN1YjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgZnVuY3Rpb24gZmVhdHVyZVZpc2libGVOb3cobGF5ZXIsIGluZGV4KSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnQgPSBmaW5kTGF5ZXJOb3cobGF5ZXJTdGF0ZSwgbGF5ZXIuaWQpIHx8IGxheWVyO1xyXG4gICAgICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGN1cnJlbnQsIG1vZGVsLmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge30pKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKCFjdXJyZW50LnRpbWUgfHwgIXRpbWVTdGF0ZSkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IoY3VycmVudCwgYnVmZmVyU3RhdGUpO1xyXG4gICAgICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLFxyXG4gICAgICAgICAgICAgICAgZWZmZWN0aXZlRHVyYXRpb24oY3VycmVudCwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICAgICAgICAgIGlmIChpbmRleCAhPSBudWxsICYmIHRpbWVzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gdGltZXNbaW5kZXggKiAyXTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBOdW1iZXIuaXNOYU4oc3RhcnQpXHJcbiAgICAgICAgICAgICAgICAgICAgfHwgZmVhdHVyZUluV2luZG93KHN0YXJ0LCB0aW1lc1tpbmRleCAqIDIgKyAxXSwgd2luKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHRpbWVzW2ldKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB8fCBmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgYWN0aXZlVGlsZUxheWVycyA9IHt9O1xyXG4gICAgICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcclxuICAgICAgICBjb25zdCBnbFN0YXRlcyA9IHtcclxuICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxyXG4gICAgICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcclxuICAgICAgICAgICAgcG9seWxpbmU6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxyXG4gICAgICAgICAgICBwb2x5Z29uOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIFRoZSBzaGFyZWQgdGltZSBzbGlkZXIuIGB0aW1lU3RhdGVgIGlzIHdoYXQgcmVuZGVyaW5nIHJlYWRzIC0tIHRoZSBjdXJyZW50IHRpY2tcclxuICAgICAgICAvLyBhbmQgdGhlIHBlcmlvZCwgb3IgbnVsbCB3aGVuIG5vdGhpbmcgaXMgYW5pbWF0ZWQgLS0gYW5kIGB0aW1lVUlgIGlzIHRoZSBzbGlkZXInc1xyXG4gICAgICAgIC8vIG93biBib29ra2VlcGluZy4gUGxheWJhY2sgbmV2ZXIgcm91bmQtdHJpcHMgdGhyb3VnaCBQeXRob246IHRpY2tzIHJlLXJlbmRlclxyXG4gICAgICAgIC8vIGxvY2FsbHksIGFuZCB0aW1lX2N1cnJlbnQgaXMgd3JpdHRlbiBiYWNrIGF0IG1vc3Qgb25jZSBhIHNlY29uZCB3aGlsZSBwbGF5aW5nLlxyXG4gICAgICAgIGxldCB0aW1lU3RhdGUgPSBudWxsO1xyXG4gICAgICAgIGNvbnN0IHRpbWVVSSA9IHsgdGlja3M6IFtdLCBrZXk6IFwiXCIsIGluZGV4OiAwLCBwbGF5aW5nOiBmYWxzZSwgbG9vcDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBzcGVlZDogMSwgdGltZXI6IG51bGwsIGxhc3RXcml0ZTogMCwgc3RhcnRlZDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3c6IG51bGwsIHBlcmlvZE1zOiBudWxsLCBncmlkTXM6IG51bGwgfTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gc3RvcFBsYXliYWNrKCkge1xyXG4gICAgICAgICAgICBpZiAodGltZVVJLnRpbWVyKSBjbGVhckludGVydmFsKHRpbWVVSS50aW1lcik7XHJcbiAgICAgICAgICAgIHRpbWVVSS50aW1lciA9IG51bGw7XHJcbiAgICAgICAgICAgIHRpbWVVSS5wbGF5aW5nID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiB3cml0ZVRpbWVDdXJyZW50KGZvcmNlKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgICAgIGlmICghZm9yY2UgJiYgbm93IC0gdGltZVVJLmxhc3RXcml0ZSA8IDEwMDApIHJldHVybjtcclxuICAgICAgICAgICAgdGltZVVJLmxhc3RXcml0ZSA9IG5vdztcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInRpbWVfY3VycmVudFwiLCB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBzZWVrVG8oaW5kZXgsIHsgd3JpdGUgPSB0cnVlIH0gPSB7fSkge1xyXG4gICAgICAgICAgICB0aW1lVUkuaW5kZXggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihpbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpKTtcclxuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xyXG4gICAgICAgICAgICBpZiAod3JpdGUpIHdyaXRlVGltZUN1cnJlbnQoIXRpbWVVSS5wbGF5aW5nKTtcclxuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBzdGFydFBsYXliYWNrKCkge1xyXG4gICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcclxuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBuZXh0ID0gYWR2YW5jZSh0aW1lVUkuaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGgsIHRpbWVVSS5sb29wKTtcclxuICAgICAgICAgICAgICAgIGlmICghbmV4dC5wbGF5aW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHNlZWtUbyhuZXh0LmluZGV4KTtcclxuICAgICAgICAgICAgfSwgMTAwMCAvIHRpbWVVSS5zcGVlZCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB0aW1lSGFuZGxlcnMgPSB7XHJcbiAgICAgICAgICAgIG9uU2VlazogKGluZGV4KSA9PiBzZWVrVG8oaW5kZXgpLFxyXG4gICAgICAgICAgICBvblN0ZXBCYWNrOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4IC0gMSksXHJcbiAgICAgICAgICAgIG9uU3RlcEZvcndhcmQ6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggKyAxKSxcclxuICAgICAgICAgICAgb25QbGF5VG9nZ2xlOiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcclxuICAgICAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBzdGFydE92ZXIsIGFzIHRoZSBmb2xpdW0gcGxheWVyIHdhcyBjb25maWd1cmVkOiBwcmVzc2luZyBwbGF5IGF0XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCByZXN0YXJ0cyBmcm9tIHRoZSBiZWdpbm5pbmcgaW1tZWRpYXRlbHksIHJhdGhlciB0aGFuIG9uZVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIHNpbGVudCBpbnRlcnZhbCBsYXRlciBkZWNpZGluZyB0aGVyZSBpcyBub3doZXJlIHRvIGdvIGFuZCBzdG9wcGluZy5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodGltZVVJLmluZGV4ID49IHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSBzZWVrVG8oMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb25Mb29wVG9nZ2xlOiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9ICF0aW1lVUkubG9vcDtcclxuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uU3BlZWQ6IChzcGVlZCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gc3BlZWQ7XHJcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHN0YXJ0UGxheWJhY2soKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gTGl2ZSBkdXJpbmcgdGhlIGRyYWc6IGxvY2FsIHN0YXRlIGFuZCBhIHJlLXJlbmRlciBvZiB0aGUgY29udHJvbCBvbiBldmVyeVxyXG4gICAgICAgICAgICAvLyBtb3ZlLCBidXQgbWFwIHJlYnVpbGRzIGF0IG1vc3QgZXZlcnkgMzAwbXMuIEF0IDVNIHBvaW50cyBhIHJlYnVpbGQgY29zdHNcclxuICAgICAgICAgICAgLy8gc2Vjb25kcywgYW5kIGEgZHJhZyBmaXJlcyBkb3plbnMgb2YgbW92ZXMgLS0gdW50aHJvdHRsZWQsIHRoZSByZWJ1aWxkc1xyXG4gICAgICAgICAgICAvLyBzdGFjayBmYXN0ZXIgdGhhbiB0aGV5IGZpbmlzaCBhbmQgdGhlIGFsbG9jYXRpb24gY2h1cm4gY3Jhc2hlcyB0aGUgdGFiLlxyXG4gICAgICAgICAgICBvbldpbmRvd0RyYWc6IChpc28pID0+IHtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBpc287XHJcbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB0aW1lU3RhdGUgPSB7IC4uLnRpbWVTdGF0ZSwgd2luZG93OiBpc28gfTtcclxuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICAgICAgaWYgKG5vdyAtICh0aW1lVUkubGFzdERyYWdTeW5jIHx8IDApID49IDMwMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5sYXN0RHJhZ1N5bmMgPSBub3c7XHJcbiAgICAgICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8vIE9uIHJlbGVhc2UgKG9yIGEga2V5Ym9hcmQgc3RlcCk6IHRoZSBvdmVycmlkZSBsYW5kcyBpbiB0aW1lX2NvbmZpZyBzb1xyXG4gICAgICAgICAgICAvLyBQeXRob24gYW5kIFNoaW55IHNlZSB0aGUgc2FtZSB3aW5kb3cgdGhlIGJhciBzaG93cy4gbnVsbCBjbGVhcnMgdGhlIGtleSxcclxuICAgICAgICAgICAgLy8gaGFuZGluZyBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cclxuICAgICAgICAgICAgb25XaW5kb3dDb21taXQ6IChpc28pID0+IHtcclxuICAgICAgICAgICAgICAgIHRpbWVIYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBxdWV1ZVN5bmMoKTsgICAgICAgLy8gdGhlIHJlbGVhc2UgYWx3YXlzIGxhbmRzLCB0aHJvdHRsZSBvciBub3RcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNmZyA9IHsgLi4uKG1vZGVsLmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9KSB9O1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzbykgY2ZnLndpbmRvdyA9IGlzbztcclxuICAgICAgICAgICAgICAgIGVsc2UgZGVsZXRlIGNmZy53aW5kb3c7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInRpbWVfY29uZmlnXCIsIGNmZyk7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgbG9jYWwgbW9kZWwgc3RpbGwgaG9sZHMgaXQgKi8gfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZXMsIHJldHVuZXMgb3IgcmVtb3ZlcyB0aGUgc2xpZGVyIHRvIG1hdGNoIHRoZSBsYXllcnMgcHJlc2VudC4gVGlja3MgYXJlXHJcbiAgICAgICAgLy8gcmVnZW5lcmF0ZWQgb25seSB3aGVuIHRoZSBkYXRhJ3MgdGltZSBleHRlbnQgb3IgdGhlIHBlcmlvZCBjaGFuZ2VzLCBzbyBhXHJcbiAgICAgICAgLy8gcGxheWJhY2sgdGljayAtLSB3aGljaCByZS1lbnRlcnMgaGVyZSB2aWEgcXVldWVTeW5jIC0tIGRvZXMgbm90IHJlYnVpbGQgdGhlbS5cclxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVUaW1lRGltZW5zaW9uKCkge1xyXG4gICAgICAgICAgICBpZiAoIWhhc1RpbWVMYXllcnMobGF5ZXJTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcclxuICAgICAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgeyB0aWNrczogW10gfSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBcIlwiO1xyXG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5zdGFydGVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge307XHJcbiAgICAgICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGV4dGVudCA9IGNvbGxlY3RUaW1lRXh0ZW50KGxheWVyU3RhdGUsIGJ1ZmZlclN0YXRlKTtcclxuICAgICAgICAgICAgaWYgKCFleHRlbnQpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2V4dGVudC5taW59fCR7ZXh0ZW50Lm1heH18JHtjZmcucGVyaW9kIHx8IFwiUDFEXCJ9YDtcclxuICAgICAgICAgICAgaWYgKGtleSAhPT0gdGltZVVJLmtleSkge1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IGtleTtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS50aWNrcyA9IGdlbmVyYXRlVGlja3MoZXh0ZW50Lm1pbiwgZXh0ZW50Lm1heCwgcGVyaW9kKTtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWluKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBUaGUgc2hhcmVkIHdpbmRvdyBvdmVycmlkZSwgY29uZmlnLWRyaXZlbjsgYSBiYWQgc3RyaW5nIGNsZWFycyByYXRoZXIgdGhhblxyXG4gICAgICAgICAgICAvLyBndWVzc2luZy4gVGhlIGRyYWcgZ3JpZCBpcyB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWRcclxuICAgICAgICAgICAgLy8gZHVyYXRpb24gLS0gdGhlIGxhcmdlc3Qgc3RlcCB0aGF0IGxhbmRzIG9uIGFsbCBvZiB0aGVtIC0tIHNvIGEgMi41aCB0cmFpbFxyXG4gICAgICAgICAgICAvLyBpcyBkcmFnZ2FibGUgb24gYSAxaCBiYXIuIENhbGVuZGFyIHBlcmlvZHMgaGF2ZSBubyBmaXhlZCB3aWR0aDsgdGhlIHJ1bGVyXHJcbiAgICAgICAgICAgIC8vIHRoZW4gc2hvd3MgaW50ZXJ2YWwgbWFya3Mgb25seSBhbmQgdGhlIHRyYWlsIGhhbmRsZSBoaWRlcy5cclxuICAgICAgICAgICAgLy8gTmV2ZXIgd2hpbGUgYSBkcmFnIGlzIGxpdmU6IHRoZSBkcmFnZ2VkIHdpbmRvdyBleGlzdHMgb25seSBsb2NhbGx5IHVudGlsXHJcbiAgICAgICAgICAgIC8vIHJlbGVhc2UgY29tbWl0cyBpdCwgYW5kIHJlYWRpbmcgY29uZmlnIGhlcmUgbWlkLWRyYWcgcmVzZXQgdGhlIGhhbmRsZSB0b1xyXG4gICAgICAgICAgICAvLyBcIm5vIHdpbmRvd1wiIG9uIGV2ZXJ5IGRlYm91bmNlZCBzeW5jIC0tIHRoZSBoYW5kbGUgZm9sbG93ZWQgdGhlIG1vdXNlLCB0aGVuXHJcbiAgICAgICAgICAgIC8vIHNuYXBwZWQgaG9tZSwgdGhlbiBmb2xsb3dlZCBhZ2Fpbiwgb25jZSBwZXIgc3luYy5cclxuICAgICAgICAgICAgaWYgKCF0aW1lVUkuZHJhZ0FjdGl2ZSkge1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGNmZy53aW5kb3cgJiYgcGFyc2VQZXJpb2QoY2ZnLndpbmRvdykgPyBjZmcud2luZG93IDogbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aW1lVUkucGVyaW9kTXMgPSBwZXJpb2RUb01zKHBlcmlvZCk7XHJcbiAgICAgICAgICAgIHRpbWVVSS5ncmlkTXMgPSB0aW1lVUkucGVyaW9kTXNcclxuICAgICAgICAgICAgICAgID8gZ2NkR3JpZE1zKHRpbWVVSS5wZXJpb2RNcywgY29sbGVjdER1cmF0aW9uc01zKGxheWVyU3RhdGUsIHRpbWVVSS53aW5kb3cpKVxyXG4gICAgICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kLCB3aW5kb3c6IHRpbWVVSS53aW5kb3cgfTtcclxuICAgICAgICAgICAgdGltZVVJLnBvc2l0aW9uID0gY2ZnLnBvc2l0aW9uIHx8IFwidG9wLWNlbnRlclwiO1xyXG5cclxuICAgICAgICAgICAgaWYgKCF0aW1lVUkuc3RhcnRlZCkge1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gY2ZnLnNwZWVkIHx8IDE7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9IEJvb2xlYW4oY2ZnLmxvb3ApO1xyXG4gICAgICAgICAgICAgICAgLy8gT25seSB0aGUgZmlyc3QgY29uZmlndXJhdGlvbiBtYXkgYXV0by1zdGFydC4gRXZlcnkgY29uZmlnIGNoYW5nZSByZXNldHNcclxuICAgICAgICAgICAgICAgIC8vIGBzdGFydGVkYCB0byByZS1yZWFkIHNwZWVkIGFuZCBsb29wIC0tIGluY2x1ZGluZyB0aGUgY2hhbmdlIGEgd2luZG93XHJcbiAgICAgICAgICAgICAgICAvLyBkcmFnIGNvbW1pdHMgLS0gYW5kIHJlLXJ1bm5pbmcgYXV0b19wbGF5IHRoZXJlIHdvdWxkIHN0YXJ0IHBsYXliYWNrIGFzXHJcbiAgICAgICAgICAgICAgICAvLyBhIHNpZGUgZWZmZWN0IG9mIHJlbGVhc2luZyB0aGUgaGFuZGxlLlxyXG4gICAgICAgICAgICAgICAgaWYgKGNmZy5hdXRvX3BsYXkgJiYgIXRpbWVVSS5ldmVyU3RhcnRlZCkgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLmV2ZXJTdGFydGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gU2lkZWJhciBMYXllcnMgQ29udHJvbCBVSVxyXG4gICAgICAgIGNvbnN0IHNpZGViYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XHJcbiAgICAgICAgc2lkZWJhci5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLnRvcCA9IFwiMTBweFwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XHJcbiAgICAgICAgc2lkZWJhci5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XHJcbiAgICAgICAgc2lkZWJhci5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRGYW1pbHkgPSBcIi1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgJ1NlZ29lIFVJJywgUm9ib3RvLCBzYW5zLXNlcmlmXCI7XHJcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcclxuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoc2lkZWJhcik7XHJcblxyXG4gICAgICAgIC8vIExlZ2VuZDogZGVyaXZlZCBmcmVzaCBvbiBldmVyeSBzeW5jIGZyb20gdGhlIHNhbWUgbGF5ZXIgc3RhdGUgdGhlIHNpZGViYXJcclxuICAgICAgICAvLyByZW5kZXJzIGZyb20sIHNvIHRvZ2dsZXMgZGltIG9yIGRyb3Agcm93cyB3aXRoIG5vIGV4dHJhIHdpcmluZy4gSGlkZGVuXHJcbiAgICAgICAgLy8gdW50aWwgc2hvd19sZWdlbmQgYXNrcyBmb3IgaXQuXHJcbiAgICAgICAgY29uc3QgbGVnZW5kRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBsZWdlbmREaXYuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1sZWdlbmRcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xyXG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5wYWRkaW5nID0gXCIxMHB4XCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xyXG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5tYXhXaWR0aCA9IFwiMjYwcHhcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUubWF4SGVpZ2h0ID0gXCI0NSVcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUub3ZlcmZsb3dZID0gXCJhdXRvXCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRGYW1pbHkgPSBzaWRlYmFyLnN0eWxlLmZvbnRGYW1pbHk7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmNvbG9yID0gXCIjMzMzXCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcclxuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobGVnZW5kRGl2KTtcclxuXHJcbiAgICAgICAgLy8gTG9nb1xyXG4gICAgICAgIC8vIFRoZSBsb2dvIGNhcmQ6IHR3byBhcHAtc3VwcGxpZWQgc2xvdHMgZnJvbSBsb2dvX2NvbmZpZywgbm8gYnJhbmRpbmcgb2ZcclxuICAgICAgICAvLyBpdHMgb3duLiBXaXRoIHRoZSBjYXJkIG9uIGFuZCBuZWl0aGVyIHNsb3Qgc2V0LCBhIGdlbmVyaWMgbWFyayBzdGFuZHMgaW5cclxuICAgICAgICAvLyAtLSBpbmxpbmUgU1ZHLCBzbyBpdCBuZWVkcyBubyBuZXR3b3JrIGFuZCBzdXJ2aXZlcyBhIHN0YXRpYyBleHBvcnQuXHJcbiAgICAgICAgLy8gQnVpbHQgd2l0aCBlbGVtZW50cywgbm90IGlubmVySFRNTCwgc28gYW4gYWx0IHRleHQgY2Fubm90IGluamVjdCBtYXJrdXAuXHJcbiAgICAgICAgY29uc3QgTE9HT19QT1NJVElPTlMgPSBuZXcgU2V0KFtcInRvcC1sZWZ0XCIsIFwidG9wLXJpZ2h0XCIsIFwiYm90dG9tLWxlZnRcIiwgXCJib3R0b20tcmlnaHRcIl0pO1xyXG4gICAgICAgIGNvbnN0IERFRkFVTFRfTE9HTyA9IFwiZGF0YTppbWFnZS9zdmcreG1sO3V0ZjgsXCIgKyBlbmNvZGVVUklDb21wb25lbnQoXHJcbiAgICAgICAgICAgICc8c3ZnIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB2aWV3Qm94PVwiMCAwIDE0MCA0MFwiPidcclxuICAgICAgICAgICAgKyAnPHJlY3Qgd2lkdGg9XCIxNDBcIiBoZWlnaHQ9XCI0MFwiIHJ4PVwiOFwiIGZpbGw9XCIjMWY2ZmViXCIvPidcclxuICAgICAgICAgICAgKyAnPHRleHQgeD1cIjcwXCIgeT1cIjI2XCIgZm9udC1mYW1pbHk9XCJTZWdvZSBVSSwgSGVsdmV0aWNhLCBBcmlhbCwgc2Fucy1zZXJpZlwiICdcclxuICAgICAgICAgICAgKyAnZm9udC1zaXplPVwiMThcIiBmb250LXdlaWdodD1cIjYwMFwiIGZpbGw9XCIjZmZmXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIj5zd2lmdG1hcDwvdGV4dD4nXHJcbiAgICAgICAgICAgICsgJzwvc3ZnPicpO1xyXG4gICAgICAgIGNvbnN0IGxvZ29EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIGxvZ29EaXYuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1sb2dvXCI7XHJcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xyXG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjVweFwiO1xyXG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI0cHhcIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xyXG4gICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChsb2dvRGl2KTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gc3luY0xvZ28oKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNob3cgPSBCb29sZWFuKG1vZGVsLmdldChcInNob3dfbG9nb1wiKSk7XHJcbiAgICAgICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IHNob3cgPyBcImJsb2NrXCIgOiBcIm5vbmVcIjtcclxuICAgICAgICAgICAgbG9nb0Rpdi5yZXBsYWNlQ2hpbGRyZW4oKTtcclxuICAgICAgICAgICAgaWYgKCFzaG93KSByZXR1cm47XHJcbiAgICAgICAgICAgIGNvbnN0IGNmZyA9IG1vZGVsLmdldChcImxvZ29fY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgICAgICBjb25zdCBoZWlnaHQgPSBOdW1iZXIoY2ZnLmhlaWdodCkgPiAwID8gTnVtYmVyKGNmZy5oZWlnaHQpIDogMzU7XHJcbiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uID0gTE9HT19QT1NJVElPTlMuaGFzKGNmZy5wb3NpdGlvbikgPyBjZmcucG9zaXRpb24gOiBcImJvdHRvbS1yaWdodFwiO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHNpZGUgb2YgW1widG9wXCIsIFwiYm90dG9tXCIsIFwibGVmdFwiLCBcInJpZ2h0XCJdKSBsb2dvRGl2LnN0eWxlW3NpZGVdID0gXCJcIjtcclxuICAgICAgICAgICAgbG9nb0Rpdi5zdHlsZVtwb3NpdGlvbi5zdGFydHNXaXRoKFwidG9wXCIpID8gXCJ0b3BcIiA6IFwiYm90dG9tXCJdID0gXCIxMHB4XCI7XHJcbiAgICAgICAgICAgIGxvZ29EaXYuc3R5bGVbcG9zaXRpb24uZW5kc1dpdGgoXCJsZWZ0XCIpID8gXCJsZWZ0XCIgOiBcInJpZ2h0XCJdID0gXCIxMHB4XCI7XHJcbiAgICAgICAgICAgIGNvbnN0IHNsb3RzID0gW2NmZy5jb21wYW55LCBjZmcucGFyZW50X2NvbXBhbnldLmZpbHRlcihzID0+IHMgJiYgcy51cmwpO1xyXG4gICAgICAgICAgICBjb25zdCBpbWFnZXMgPSBzbG90cy5sZW5ndGggPyBzbG90cyA6IFt7IHVybDogREVGQVVMVF9MT0dPLCBhbHQ6IFwic3dpZnRtYXBcIiB9XTtcclxuICAgICAgICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICAgICAgcm93LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICAgICAgcm93LnN0eWxlLmFsaWduSXRlbXMgPSBcImNlbnRlclwiO1xyXG4gICAgICAgICAgICByb3cuc3R5bGUuZ2FwID0gXCI1cHhcIjtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBpbWFnZXMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGltZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbWdcIik7XHJcbiAgICAgICAgICAgICAgICBpbWcuc3JjID0gaW1hZ2UudXJsO1xyXG4gICAgICAgICAgICAgICAgaW1nLmFsdCA9IGltYWdlLmFsdCB8fCBcIlwiO1xyXG4gICAgICAgICAgICAgICAgaW1nLnN0eWxlLmhlaWdodCA9IGAke2hlaWdodH1weGA7XHJcbiAgICAgICAgICAgICAgICByb3cuYXBwZW5kQ2hpbGQoaW1nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsb2dvRGl2LmFwcGVuZENoaWxkKHJvdyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHN5bmNMb2dvKCk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6bG9nb19jb25maWdcIiwgc3luY0xvZ28pO1xyXG5cclxuXHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIGdldFRpbGVMYXllcihsYXllcikge1xyXG4gICAgICAgICAgICBjb25zdCBvcHRpb25zID0ge1xyXG4gICAgICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxyXG4gICAgICAgICAgICAgICAgbWF4Wm9vbTogbGF5ZXIubWF4X3pvb20gfHwgMjIsXHJcbiAgICAgICAgICAgICAgICBtYXhOYXRpdmVab29tOiBsYXllci5tYXhfbmF0aXZlX3pvb20gfHwgMTlcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgLy8geHl6c2VydmljZXMgcHJvdmlkZXJzIGRlY2xhcmUgdGhlaXIgb3duIHtzfSBob3N0czsgTGVhZmxldCdzXHJcbiAgICAgICAgICAgIC8vIGRlZmF1bHQgXCJhYmNcIiBpcyB3cm9uZyBmb3IgYW55dGhpbmcgZWxzZS5cclxuICAgICAgICAgICAgaWYgKGxheWVyLnN1YmRvbWFpbnMpIG9wdGlvbnMuc3ViZG9tYWlucyA9IGxheWVyLnN1YmRvbWFpbnM7XHJcbiAgICAgICAgICAgIGlmIChsYXllci53bXMpIHtcclxuICAgICAgICAgICAgICAgIC8vIFdNUyByZXF1ZXN0IENSUyBmb2xsb3dzIHRoZSBtYXAncywgc28gNDMyNiBtYXBzIGFzayBpbiA0MzI2LlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyLndtcyhsYXllci51cmwsIHtcclxuICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgIGxheWVyczogbGF5ZXIud21zLmxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICBmb3JtYXQ6IGxheWVyLndtcy5mb3JtYXQgfHwgJ2ltYWdlL3BuZycsXHJcbiAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogbGF5ZXIud21zLnZlcnNpb24gfHwgJzEuMS4xJyxcclxuICAgICAgICAgICAgICAgICAgICB0cmFuc3BhcmVudDogISFsYXllci53bXMudHJhbnNwYXJlbnQsXHJcbiAgICAgICAgICAgICAgICAgICAgLi4uKGxheWVyLndtcy5zdHlsZXMgPyB7IHN0eWxlczogbGF5ZXIud21zLnN0eWxlcyB9IDoge30pXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCBvcHRpb25zKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNNYXBTdGF0ZSgpIHtcclxuICAgICAgICAgICAgY29uc29sZS50aW1lKFwiW1BlcmZvcm1hbmNlXSBzeW5jTWFwU3RhdGUgVG90YWxcIik7XHJcbiAgICAgICAgICAgIHVwZGF0ZVRpbWVEaW1lbnNpb24oKTtcclxuICAgICAgICAgICAgY29uc3QgbGF5ZXJzID0gbGF5ZXJTdGF0ZTtcclxuICAgICAgICAgICAgY29uc3QgZ3JvdXBDb25maWdzID0gbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBidWZmZXJTdGF0ZTtcclxuXHJcbiAgICAgICAgICAgIC8vIEVuZm9yY2UgbXV0dWFsbHkgZXhjbHVzaXZlIHJhZGlvIGdyb3VwIHZpc2liaWxpdHkgYmVmb3JlIGNvbGxlY3Rpbmcgb3IgcmVuZGVyaW5nIFdlYkdMIGxheWVycy5cclxuICAgICAgICAgICAgLy8gV3JpdHRlbiBiYWNrIGFzIHRhcmdldGVkIGZsaXBzLCBuZXZlciB0aGUgbGF5ZXJzIHRyYWl0IC0tIHRoZSBmdWxsIHdyaXRlIHdhc1xyXG4gICAgICAgICAgICAvLyB0aGUgZnJhbWUgdGhhdCBraWxsZWQgbGFyZ2Ugc2Vzc2lvbnMgKHNlZSB0aGUgc2lkZWJhcidzIGNoYW5nZSBoYW5kbGVyKS5cclxuICAgICAgICAgICAgY29uc3QgcmFkaW8gPSBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgIGlmICgocmFkaW8uY2hhbmdlcy5sZW5ndGggPiAwIHx8IHJhZGlvLmdyb3Vwc0NoYW5nZWQpICYmIGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XHJcbiAgICAgICAgICAgICAgICBzZW5kTGF5ZXJXcml0ZShtb2RlbCwgcmFkaW8uY2hhbmdlcyk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIHsgLi4uZ3JvdXBDb25maWdzIH0pO1xyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHN5bmNMb2dvKCk7XHJcblxyXG4gICAgICAgICAgICAvLyBHcm91cCB2aXNpYmxlIGxheWVycyAoaW5jbHVkaW5nIHN1Yi1sYXllcnMgaW5zaWRlIGdyb3VwcykgdG8gYWx3YXlzIHVzZSBXZWJHTFxyXG4gICAgICAgICAgICBjb25zdCB7XHJcbiAgICAgICAgICAgICAgICBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcclxuICAgICAgICAgICAgICAgIHBvbHlsaW5lOiB3ZWJnbFBvbHlsaW5lTGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzLFxyXG4gICAgICAgICAgICB9ID0gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcclxuXHJcbiAgICAgICAgICAgIC8vIFNldCBvZiBsYXllciBJRHMgcHJvY2Vzc2VkIHZpYSBtZXJnZWQgV2ViR0wgbGF5ZXJzXHJcbiAgICAgICAgICAgIGNvbnN0IHdlYmdsTGF5ZXJJZHMgPSBuZXcgU2V0KFtcclxuICAgICAgICAgICAgICAgIC4uLndlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxyXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXHJcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxyXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzLm1hcChsID0+IGwuaWQpXHJcbiAgICAgICAgICAgIF0pO1xyXG5cclxuICAgICAgICAgICAgLy8gUmVtb3ZlIHJldGlyZWQgb3ZlcmxheSBsYXllcnMsIGluY2x1ZGluZyB0aG9zZSB0aGF0IHRyYW5zaXRpb25lZCB0byBXZWJHTFxyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhhY3RpdmVPdmVybGF5TGF5ZXJzKS5mb3JFYWNoKGlkID0+IHtcclxuICAgICAgICAgICAgICAgIGlmICghbGF5ZXJzLmZpbmQobCA9PiBsLmlkID09PSBpZCkgfHwgd2ViZ2xMYXllcklkcy5oYXMoaWQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF0ucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFByb2Nlc3Mgbm9uLVdlYkdMIGxheWVyc1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0aWxlID0gZ2V0VGlsZUxheWVyKGxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbGUuYWRkVG8obWFwKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0gPSB0aWxlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0ucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBTa2lwIGxheWVycyBtYW5hZ2VkIGJ5IHRoZSBtZXJnZWQgV2ViR0wgbGF5ZXJzXHJcbiAgICAgICAgICAgICAgICBpZiAod2ViZ2xMYXllcklkcy5oYXMobGF5ZXIuaWQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCFlZmZlY3RpdmVWaXNpYmxlIHx8ICFsYXllckluV2luZG93KGxheWVyLCBidWZmZXJTdGF0ZSwgdGltZVN0YXRlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIEltYWdlIG92ZXJsYXlzIHJlY3JlYXRlIHdoZW4gdGhlaXIgY29uZmlnIG9yIHRoZWlyIGJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGNoYW5nZXMgLS0gYSByZXBsYWNlIG9wIHN3YXBzIHRoZSBjb25maWcgb2JqZWN0IGFuZCBhXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYnVmZmVyIG9wIHN3YXBzIHRoZSBEYXRhVmlldywgYW5kIGEgc3RhbGUgaW1hZ2Ugd291bGRcclxuICAgICAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2Ugc2l0IHVudGlsIGEgdmlzaWJpbGl0eSBib3VuY2UuXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhbGVJbWFnZSA9IGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAoZXhpc3RpbmcuaW1hZ2VNZXRhICE9PSBpbWFnZU1ldGFLZXkobGF5ZXIpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCBleGlzdGluZy5pbWFnZVNvdXJjZSAhPT0gKGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXSB8fCBudWxsKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nLmxheWVyVHlwZSAhPT0gbGF5ZXIudHlwZSB8fCBzdGFsZUltYWdlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdLCBtb2RlbCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcclxuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSA9IGluc3RhbmNlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBIZWxwZXIgdG8gc3luYyBXZWJHTCBsYXllciBzdGF0ZXMgYW5kIHJlYnVpbGQgb25seSBpZiBjaGFuZ2VkXHJcbiAgICAgICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMsIHZlY3RvckdwdSA9IGZhbHNlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpZHNTdHJpbmcgPSB2aXNpYmxlTGF5ZXJzLm1hcChsID0+IGwuaWQpLnNvcnQoKS5qb2luKFwiLFwiKTtcclxuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgdGhlIGJ1aWx0IGJ1ZmZlcnMgZGVwZW5kIG9uIGJlbG9uZ3MgaW4gdGhpcyBrZXk6IGEgY2hhbmdlIHRoYXRcclxuICAgICAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXHJcbiAgICAgICAgICAgICAgICAvLyBtaXNzaW5nIGF0IGZpcnN0LCBzbyBhIGhpZ2hsaWdodCBsYW5kZWQgaW4gc3RhdGUgYW5kIG5ldmVyIHJlcGFpbnRlZC5cclxuICAgICAgICAgICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgb24gdGhlIEdQVSBwYXRoIGV4Y2x1ZGUgdGhlIHRpY2sgYW5kIHdpbmRvdyBmcm9tIHRoZSBrZXk6XHJcbiAgICAgICAgICAgICAgICAvLyB0aG9zZSBjaGFuZ2UgcGVyIHRpY2sgYW5kIGFyZSBhcHBsaWVkIGFzIHVuaWZvcm1zLCBub3QgYnkgcmVidWlsZGluZy5cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBwZXJpb2Qgc3RheXMgaW4sIHNpbmNlIGl0IGlzIGJha2VkIGludG8gdGhlIGR1cmF0aW9uIGF0dHJpYnV0ZXMuXHJcbiAgICAgICAgICAgICAgICAvLyBFdmVyeXRoaW5nIGVsc2UgLS0gYW5kIGV2ZXJ5IG5vbi1wb2ludCBidWNrZXQgLS0gcmVidWlsZHMgYXMgYmVmb3JlLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgZ3B1UG9pbnRzID0gKCh0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCIpXHJcbiAgICAgICAgICAgICAgICAgICAgJiYgZ3B1VGltZUF2YWlsYWJsZSgpKSB8fCB2ZWN0b3JHcHU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkodmlzaWJsZUxheWVycy5tYXAobCA9PiAoe1xyXG4gICAgICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBsLmNvbG9yLFxyXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogbC5yYWRpdXMsXHJcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcclxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiBsLm9wYWNpdHksXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbE9wYWNpdHk6IGwuZmlsbE9wYWNpdHksXHJcbiAgICAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0OiBsLmhpZ2hsaWdodF9zdHlsZSxcclxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZXM6IGwuc3R5bGVfb3ZlcnJpZGVzLFxyXG4gICAgICAgICAgICAgICAgICAgIGZlYXR1cmVTdHlsZXM6IGwuZmVhdHVyZV9zdHlsZXMsXHJcbiAgICAgICAgICAgICAgICAgICAgdGltZTogbC50aW1lLFxyXG4gICAgICAgICAgICAgICAgICAgIGdwdTogZ3B1UG9pbnRzLFxyXG4gICAgICAgICAgICAgICAgICAgIHRpY2s6IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS50aWNrIDogMCxcclxuICAgICAgICAgICAgICAgICAgICB3aW46IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIHBlcjogbC50aW1lICYmIGdwdVBvaW50cyAmJiB0aW1lU3RhdGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIElkZW50aXR5IG9mIGV2ZXJ5IGJ1ZmZlciB0aGUgYnVja2V0IHJlYWRzIGZvciB0aGlzIGxheWVyOlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIHNhbWUtbGVuZ3RoIHJlcGxhY2VtZW50cyBtdXN0IHJlYnVpbGQgdG9vLlxyXG4gICAgICAgICAgICAgICAgICAgIGJ1ZlNlcmlhbDogW2wuaWQsIGAke2wuaWR9Ojpjb2xvcnNgLCBgJHtsLmlkfTo6cmFkaWlgLCBgJHtsLmlkfTo6dGltZXNgXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAubWFwKGsgPT4gYnVmZmVyU2VyaWFsKGNvb3JkaW5hdGVCdWZmZXJzW2tdKSksXHJcbiAgICAgICAgICAgICAgICAgICAgbG9jTGVuOiBsLmxvY2F0aW9ucz8ubGVuZ3RoIHx8IDBcclxuICAgICAgICAgICAgICAgIH0pKSk7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGUgPSBnbFN0YXRlc1t0eXBlXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlQ2hhbmdlZCA9IHN0YXRlLmlkcyAhPT0gaWRzU3RyaW5nIHx8IHN0YXRlLm1ldGEgIT09IG1ldGFTdHJpbmc7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IGF3YWl0IHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCB2aXNpYmxlTGF5ZXJzLCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsIHRpbWVTdGF0ZSwgdmVjdG9yR3B1LCBmZWF0dXJlVmlzaWJsZU5vdyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIuYWRkVG8obWFwKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUuaWRzID0gaWRzU3RyaW5nO1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLm1ldGEgPSBtZXRhU3RyaW5nO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBQb2ludCBidWNrZXRzIGhvbGRpbmcgdGltZSBsYXllcnMga2VlcCBFVkVSWSBwb2ludCBsYXllciAtLSBoaWRkZW4gb25lc1xyXG4gICAgICAgICAgICAvLyBpbmNsdWRlZCAtLSBzbyBhIHNpZGViYXIgdG9nZ2xlIGNoYW5nZXMgYSB2aXNpYmlsaXR5IHVuaWZvcm0gaW5zdGVhZCBvZlxyXG4gICAgICAgICAgICAvLyB0aGUgYnVja2V0J3MgaWRzLiBVbmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZWJ1aWxkIGFsbCA1TVxyXG4gICAgICAgICAgICAvLyBwb2ludHM7IGNsaWNraW5nIGRvd24gdGhlIHNpZGViYXIgc3RhY2tlZCB0aG9zZSByZWJ1aWxkcyBpbnRvIGEgY3Jhc2guXHJcbiAgICAgICAgICAgIGNvbnN0IGFsbEJ5VHlwZSA9IGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgIC8vIEFyZWEgb3V0bGluZXMgcmlkZSB0aGUgbGluZXMgYnVja2V0OiBldmVyeSBwb2x5Z29uIGFuZCBjaXJjbGUgam9pbnMgaXQgYXNcclxuICAgICAgICAgICAgLy8gYW4gZXh0cmEgZW50cnkgd2hvc2UgcmluZ3MgcmVuZGVyIGFzIHdlaWdodGVkIExpbmVTdHJpbmdzICh0aGUgcG9seWdvblxyXG4gICAgICAgICAgICAvLyBidWNrZXQgZHJhd3Mgb25seSB0aGUgZmlsbCkuIEpvaW5pbmcgdW5jb25kaXRpb25hbGx5IC0tIHN0cm9rZWxlc3MgYXJlYXNcclxuICAgICAgICAgICAgLy8gY29udHJpYnV0ZSBhbiBlbXB0eSBzbG90IC0tIGtlZXBzIHRoZSBidWNrZXQncyBtZW1iZXJzaGlwIGluZGVwZW5kZW50IG9mXHJcbiAgICAgICAgICAgIC8vIHN0eWxlIGNoYW5nZXMsIHNvIHJlc3R5bGluZyBhIGJvcmRlciBzdGF5cyBhIHJlYnVpbGQsIG5ldmVyIGEgcmUtYnVja2V0LlxyXG4gICAgICAgICAgICBhbGxCeVR5cGUucG9seWxpbmUgPSBbLi4uYWxsQnlUeXBlLnBvbHlsaW5lLCAuLi5hbGxCeVR5cGUucG9seWdvbl07XHJcbiAgICAgICAgICAgIGNvbnN0IGJ1Y2tldCA9IHsgY2lyY2xlX21hcmtlcnM6IHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlsaW5lOiBbLi4ud2ViZ2xQb2x5bGluZUxheWVycywgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMgfTtcclxuICAgICAgICAgICAgY29uc3QgdmVjdG9yR3B1QnVja2V0ID0geyBwb2x5bGluZTogZmFsc2UsIHBvbHlnb246IGZhbHNlIH07XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgdHlwZSBvZiBbXCJjaXJjbGVfbWFya2Vyc1wiLCBcIm1hcmtlcnNcIiwgXCJwb2x5bGluZVwiLCBcInBvbHlnb25cIl0pIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGVudHJpZXMgPSBhbGxCeVR5cGVbdHlwZV07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1BvaW50cyA9IHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIjtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGF2YWlsYWJsZSA9IGlzUG9pbnRzID8gZ3B1VGltZUF2YWlsYWJsZSgpIDogdmVjdG9yR3B1QXZhaWxhYmxlKCk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBncHVWaXMgPSBhdmFpbGFibGUgJiYgZW50cmllcy5sZW5ndGggPiAwXHJcbiAgICAgICAgICAgICAgICAgICAgJiYgZW50cmllcy5sZW5ndGggPD0gTEFZRVJfU0xPVFNcclxuICAgICAgICAgICAgICAgICAgICAmJiBlbnRyaWVzLnNvbWUoZSA9PiBlLmxheWVyLnRpbWUpO1xyXG4gICAgICAgICAgICAgICAgZ2xTdGF0ZXNbdHlwZV0udmlzVmVjdG9yID0gZ3B1VmlzID8gZW50cmllcy5tYXAoZSA9PiAoZS52aXMgPyAxIDogMCkpIDogbnVsbDtcclxuICAgICAgICAgICAgICAgIGlmIChncHVWaXMpIGJ1Y2tldFt0eXBlXSA9IGVudHJpZXMubWFwKGUgPT4gZS5sYXllcik7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzUG9pbnRzKSB2ZWN0b3JHcHVCdWNrZXRbdHlwZV0gPSBncHVWaXM7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwiY2lyY2xlX21hcmtlcnNcIiwgYnVja2V0LmNpcmNsZV9tYXJrZXJzKTtcclxuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJtYXJrZXJzXCIsIGJ1Y2tldC5tYXJrZXJzKTtcclxuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCBidWNrZXQucG9seWxpbmUsIHZlY3RvckdwdUJ1Y2tldC5wb2x5bGluZSk7XHJcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWdvblwiLCBidWNrZXQucG9seWdvbiwgdmVjdG9yR3B1QnVja2V0LnBvbHlnb24pO1xyXG5cclxuICAgICAgICAgICAgLy8gUHVzaCB0aGUgY3VycmVudCB3aW5kb3cgaW50byB0aGUgR1BVLWZpbHRlcmVkIHBvaW50IGJ1Y2tldHM6IHR3byB1bmlmb3Jtc1xyXG4gICAgICAgICAgICAvLyBhbmQgYSByZWRyYXcsIHdoaWNoIGlzIHRoZSBlbnRpcmUgcGVyLXRpY2sgY29zdCBvZiB0aGUgdGltZSBzbGlkZXIgdGhlcmUuXHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgdHlwZSBvZiBbXCJjaXJjbGVfbWFya2Vyc1wiLCBcIm1hcmtlcnNcIiwgXCJwb2x5bGluZVwiLCBcInBvbHlnb25cIl0pIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBoYW5kbGUgPSBzdGF0ZS5sYXllciAmJiBzdGF0ZS5sYXllci5fc3dpZnRtYXBUaW1lO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFoYW5kbGUpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgLy8gTGF5ZXIgdmlzaWJpbGl0eSBmaXJzdCwgYW5kIG9ubHkgd2hlbiBpdCBjaGFuZ2VkOiBhIHRvZ2dsZSBjb3N0cyBvbmVcclxuICAgICAgICAgICAgICAgIC8vIHVuaWZvcm0gYXJyYXkgd3JpdGUgYW5kIGEgcmVkcmF3LCBuZXZlciBhIHJlYnVpbGQuXHJcbiAgICAgICAgICAgICAgICBjb25zdCB2aXMgPSBzdGF0ZS52aXNWZWN0b3I7XHJcbiAgICAgICAgICAgICAgICBpZiAodmlzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gdmlzLmpvaW4oXCJcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLnZpc0tleSAhPT0ga2V5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLnZpc0tleSA9IGtleTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldExheWVyVmlzaWJpbGl0eSh2aXMpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBvdmVycmlkZU1zID0gdGltZVN0YXRlLndpbmRvd1xyXG4gICAgICAgICAgICAgICAgICAgICAgICA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2QodGltZVN0YXRlLndpbmRvdykpIDogbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0V2luZG93KHRpbWVTdGF0ZS50aWNrLCBvdmVycmlkZU1zKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyhudWxsLCBudWxsKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgbW9kZWwsIG1hcCwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBQZXJtYW5lbnQgbGFiZWxzIGZvbGxvdyB0aGUgc2FtZSBkZXJpdmUtcGVyLXN5bmMgcGF0dGVybiBhcyB0aGUgbGVnZW5kLFxyXG4gICAgICAgICAgICAvLyBzbyB0aGV5IHRyYWNrIHZpc2liaWxpdHkgd2l0aCBubyBidWNrZXQgb3IgbWV0YS1rZXkgaW52b2x2ZW1lbnQgLS0gYW5kXHJcbiAgICAgICAgICAgIC8vIHNpbmNlIGV2ZXJ5IHBsYXliYWNrIHRpY2sgcmUtZW50ZXJzIHRoaXMgc3luYywgcGFzc2luZyB0aW1lU3RhdGUgbWFrZXNcclxuICAgICAgICAgICAgLy8gdGhlbSBmb2xsb3cgdGhlIHdpbmRvdyB0b286IGNoaXBzIGFwcGVhciBhbmQgdmFuaXNoIHdpdGggdGhlaXIgZmVhdHVyZXMuXHJcbiAgICAgICAgICAgIGlmIChsYWJlbHNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTGFiZWxzKEwsIGxhYmVsc0dyb3VwLCBsYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBncm91cENvbmZpZ3MsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgbGVnZW5kQ2ZnID0gbW9kZWwuZ2V0KFwibGVnZW5kX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICAgICAgaWYgKG1vZGVsLmdldChcInNob3dfbGVnZW5kXCIpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzcGVjID0gZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgbGVnZW5kQ2ZnKTtcclxuICAgICAgICAgICAgICAgIHJlbmRlckxlZ2VuZChsZWdlbmREaXYsIHNwZWMsXHJcbiAgICAgICAgICAgICAgICAgICAgeyBkaW1IaWRkZW46IGxlZ2VuZENmZy5kaW1faGlkZGVuICE9PSBmYWxzZSB9KTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IFBPU0lUSU9OU1tsZWdlbmRDZmcucG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcImJvdHRvbS1sZWZ0XCJdO1xyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBvcykpIHtcclxuICAgICAgICAgICAgICAgICAgICBsZWdlbmREaXYuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZS5kaXNwbGF5ID0gc3BlYy5ncm91cHMubGVuZ3RoID4gMCA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zb2xlLnRpbWVFbmQoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGxldCBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IGZhbHNlO1xyXG4gICAgICAgIGxldCBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcclxuXHJcbiAgICAgICAgLy8gRHJhdyAvIEFPSSB0b29sczogTGVhZmxldC1HZW9tYW4gKHRoZSBtYWludGFpbmVkIHN1Y2Nlc3NvciB0byBMZWFmbGV0LmRyYXcsXHJcbiAgICAgICAgLy8gd2hpY2ggYnJlYWtzIG9uIExlYWZsZXQgMS45KSwgbG9hZGVkIGZyb20gdW5wa2cgbGlrZSBMZWFmbGV0IGFuZCBnbGlmeSAtLVxyXG4gICAgICAgIC8vIGxhemlseSwgb25seSB3aGVuIGEgbWFwIHR1cm5zIGRyYXdpbmcgb24sIHNvIGV2ZXJ5IG90aGVyIG1hcCBwYXlzIG5vdGhpbmcuXHJcbiAgICAgICAgLy8gRHJhd24gc2hhcGVzIGxpdmUgaW4gdGhlaXIgb3duIGZlYXR1cmUgZ3JvdXAgYW5kIHN5bmMgdG8gUHl0aG9uIGFzIEdlb0pTT05cclxuICAgICAgICAvLyBmZWF0dXJlcyB1bmRlciB0aGUgYGRyYXdpbmdzYCB0cmFpdCwgd2l0aCBgZHJhd19zZXFgIGJ1bXBpbmcgcGVyIGNoYW5nZSBzb1xyXG4gICAgICAgIC8vIG9uZSBvYnNlcnZlciBjYXRjaGVzIGNyZWF0ZSwgZWRpdCBhbmQgZGVsZXRlIGFsaWtlLiBUaGUgdHJhaXQgc3luY3MgYm90aFxyXG4gICAgICAgIC8vIHdheXM6IFB5dGhvbiBjYW4gc2VlZCBBT0lzIG9yIGNsZWFyIHRoZW0sIGFuZCBleHBvcnRzIGNhcnJ5IHRoZSBkcmF3aW5ncy5cclxuICAgICAgICBsZXQgZHJhd1JlYWR5ID0gZmFsc2U7XHJcbiAgICAgICAgbGV0IGRyYXdpbmdzR3JvdXAgPSBudWxsO1xyXG4gICAgICAgIGxldCBkcmF3SWRDb3VudGVyID0gMDtcclxuICAgICAgICBsZXQgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSBmYWxzZTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gZHJhd2luZ1RvRmVhdHVyZShsKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGdqID0gbC50b0dlb0pTT04oKTtcclxuICAgICAgICAgICAgZ2oucHJvcGVydGllcyA9IHsgLi4uKGdqLnByb3BlcnRpZXMgfHwge30pLCBkcmF3X2lkOiBsLl9zd2lmdG1hcERyYXdJZCB9O1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIGwuZ2V0UmFkaXVzID09PSBcImZ1bmN0aW9uXCIgJiYgbCBpbnN0YW5jZW9mIEwuQ2lyY2xlKSB7XHJcbiAgICAgICAgICAgICAgICBnai5wcm9wZXJ0aWVzLmtpbmQgPSBcImNpcmNsZVwiO1xyXG4gICAgICAgICAgICAgICAgZ2oucHJvcGVydGllcy5yYWRpdXMgPSBsLmdldFJhZGl1cygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBnajtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHdyaXRlRHJhd2luZ3MoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAuZWFjaExheWVyKGwgPT4gZmVhdHVyZXMucHVzaChkcmF3aW5nVG9GZWF0dXJlKGwpKSk7XHJcbiAgICAgICAgICAgIHN1cHByZXNzRHJhd2luZ3NFY2hvID0gdHJ1ZTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImRyYXdpbmdzXCIsIGZlYXR1cmVzKTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImRyYXdfc2VxXCIsIChtb2RlbC5nZXQoXCJkcmF3X3NlcVwiKSB8fCAwKSArIDEpO1xyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBkcmF3aW5ncyBzdGlsbCBsaXZlIG9uIHRoZSBtYXAgKi8gfVxyXG4gICAgICAgICAgICBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gYWRvcHREcmF3aW5nKGxheWVyKSB7XHJcbiAgICAgICAgICAgIGlmICghbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkKSB7XHJcbiAgICAgICAgICAgICAgICBsYXllci5fc3dpZnRtYXBEcmF3SWQgPSBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAuYWRkTGF5ZXIobGF5ZXIpO1xyXG4gICAgICAgICAgICBsYXllci5vbihcInBtOnVwZGF0ZSBwbTpkcmFnZW5kIHBtOnJvdGF0ZWVuZFwiLCB3cml0ZURyYXdpbmdzKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHJlaHlkcmF0ZURyYXdpbmdzKCkge1xyXG4gICAgICAgICAgICBkcmF3aW5nc0dyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgZmVhdHVyZSBvZiBtb2RlbC5nZXQoXCJkcmF3aW5nc1wiKSB8fCBbXSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBmZWF0dXJlLnByb3BlcnRpZXMgfHwge307XHJcbiAgICAgICAgICAgICAgICBsZXQgbGF5ZXI7XHJcbiAgICAgICAgICAgICAgICBpZiAocHJvcHMua2luZCA9PT0gXCJjaXJjbGVcIiAmJiBmZWF0dXJlLmdlb21ldHJ5LnR5cGUgPT09IFwiUG9pbnRcIikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IFtsbmcsIGxhdF0gPSBmZWF0dXJlLmdlb21ldHJ5LmNvb3JkaW5hdGVzO1xyXG4gICAgICAgICAgICAgICAgICAgIGxheWVyID0gTC5jaXJjbGUoW2xhdCwgbG5nXSwgeyByYWRpdXM6IHByb3BzLnJhZGl1cyB8fCAxMDAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiIH0pO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBsYXllciA9IEwuZ2VvSlNPTihmZWF0dXJlLCB7IHBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiIH0pXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC5nZXRMYXllcnMoKVswXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmICghbGF5ZXIpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgbGF5ZXIuX3N3aWZ0bWFwRHJhd0lkID0gcHJvcHMuZHJhd19pZCB8fCBgZHJhd18keysrZHJhd0lkQ291bnRlcn1gO1xyXG4gICAgICAgICAgICAgICAgYWRvcHREcmF3aW5nKGxheWVyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gc3luY0RyYXcoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNob3cgPSBtb2RlbC5nZXQoXCJzaG93X2RyYXdcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGNmZyA9IG1vZGVsLmdldChcImRyYXdfY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgICAgICBpZiAoc2hvdyAmJiAhZHJhd1JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICBkcmF3UmVhZHkgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyBHZW9tYW4gY3JlYXRlcyBnb2VzIHRvIHRoZSBwYW5lIGFib3ZlIHRoZSBHTCBzdGFjay5cclxuICAgICAgICAgICAgICAgIG1hcC5wbS5zZXRHbG9iYWxPcHRpb25zKHtcclxuICAgICAgICAgICAgICAgICAgICBwYW5lczogeyBsYXllclBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZlcnRleFBhbmU6IFwibWFya2VyUGFuZVwiLCBtYXJrZXJQYW5lOiBcIm1hcmtlclBhbmVcIiB9LFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBkcmF3aW5nc0dyb3VwID0gTC5mZWF0dXJlR3JvdXAoKS5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICAgICAgcmVoeWRyYXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgICAgIG1hcC5vbihcInBtOmNyZWF0ZVwiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGFkb3B0RHJhd2luZyhlLmxheWVyKTtcclxuICAgICAgICAgICAgICAgICAgICB3cml0ZURyYXdpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIG1hcC5vbihcInBtOnJlbW92ZVwiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIEdlb21hbiByZW1vdmVzIHRoZSBsYXllciBmcm9tIHRoZSBNQVA7IHRoZSBmZWF0dXJlIGdyb3VwIHN0aWxsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gaG9sZHMgaXQsIGFuZCB3cml0ZURyYXdpbmdzIHJlYWRzIHRoZSBncm91cCAtLSBldmljdCBpdCBmaXJzdFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIG9yIHRoZSBkZWxldGlvbiBuZXZlciByZWFjaGVzIHRoZSB0cmFpdC5cclxuICAgICAgICAgICAgICAgICAgICBkcmF3aW5nc0dyb3VwLnJlbW92ZUxheWVyKGUubGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6ZHJhd2luZ3NcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghc3VwcHJlc3NEcmF3aW5nc0VjaG8pIHJlaHlkcmF0ZURyYXdpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoIWRyYXdSZWFkeSkgcmV0dXJuO1xyXG4gICAgICAgICAgICBpZiAoc2hvdykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdG9vbHMgPSBjZmcudG9vbHNcclxuICAgICAgICAgICAgICAgICAgICB8fCBbXCJtYXJrZXJcIiwgXCJwb2x5bGluZVwiLCBcInJlY3RhbmdsZVwiLCBcInBvbHlnb25cIiwgXCJjaXJjbGVcIl07XHJcbiAgICAgICAgICAgICAgICBtYXAucG0uYWRkQ29udHJvbHMoe1xyXG4gICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAoY2ZnLnBvc2l0aW9uIHx8IFwidG9wLWxlZnRcIikucmVwbGFjZShcIi1cIiwgXCJcIiksXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhd01hcmtlcjogdG9vbHMuaW5jbHVkZXMoXCJtYXJrZXJcIiksXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhd1BvbHlsaW5lOiB0b29scy5pbmNsdWRlcyhcInBvbHlsaW5lXCIpLFxyXG4gICAgICAgICAgICAgICAgICAgIGRyYXdSZWN0YW5nbGU6IHRvb2xzLmluY2x1ZGVzKFwicmVjdGFuZ2xlXCIpLFxyXG4gICAgICAgICAgICAgICAgICAgIGRyYXdQb2x5Z29uOiB0b29scy5pbmNsdWRlcyhcInBvbHlnb25cIiksXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhd0NpcmNsZTogdG9vbHMuaW5jbHVkZXMoXCJjaXJjbGVcIiksXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhd0NpcmNsZU1hcmtlcjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhd1RleHQ6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIHJvdGF0ZU1vZGU6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGN1dFBvbHlnb246IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVkaXRNb2RlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIGRyYWdNb2RlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlbW92YWxNb2RlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBtYXAucG0ucmVtb3ZlQ29udHJvbHMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBzeW5jRHJhdygpO1xyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfZHJhd1wiLCBzeW5jRHJhdyk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6ZHJhd19jb25maWdcIiwgc3luY0RyYXcpO1xyXG5cclxuICAgICAgICAvLyBUaGUgc2NhbGUgYmFyOiBMZWFmbGV0J3Mgb3duIGNvbnRyb2wsIHdoaWNoIG1lYXN1cmVzIHRocm91Z2ggdGhlIG1hcCdzIENSU1xyXG4gICAgICAgIC8vIChoYXZlcnNpbmUgdW5kZXIgMzg1NyBhbmQgNDMyNiBhbGlrZSAtLSBubyBwaXhlbCBtYXRoIG9mIG91cnMpLCBleHRlbmRlZFxyXG4gICAgICAgIC8vIHdpdGggdGhlIHVuaXQgTGVhZmxldCBsYWNrcyBhbmQgdGhpcyBkb21haW4gcnVucyBvbjogbmF1dGljYWwgbWlsZXMuXHJcbiAgICAgICAgY29uc3QgTmF1dGljYWxTY2FsZSA9IEwuQ29udHJvbC5TY2FsZS5leHRlbmQoe1xyXG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24gKG0pIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5lciA9IEwuQ29udHJvbC5TY2FsZS5wcm90b3R5cGUub25BZGQuY2FsbCh0aGlzLCBtKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX25hdXRpY2FsU2NhbGUgPSBMLkRvbVV0aWwuY3JlYXRlKFxyXG4gICAgICAgICAgICAgICAgICAgIFwiZGl2XCIsIFwibGVhZmxldC1jb250cm9sLXNjYWxlLWxpbmVcIiwgY29udGFpbmVyKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3VwZGF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRhaW5lcjtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgX3VwZGF0ZVNjYWxlczogZnVuY3Rpb24gKG1heE1ldGVycykge1xyXG4gICAgICAgICAgICAgICAgTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5fdXBkYXRlU2NhbGVzLmNhbGwodGhpcywgbWF4TWV0ZXJzKTtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9uYXV0aWNhbFNjYWxlICYmIG1heE1ldGVycykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1heE5tID0gbWF4TWV0ZXJzIC8gMTg1MjtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBubSA9IHRoaXMuX2dldFJvdW5kTnVtKG1heE5tKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl91cGRhdGVTY2FsZSh0aGlzLl9uYXV0aWNhbFNjYWxlLCBgJHtubX0gbm1gLCBubSAvIG1heE5tKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgbGV0IHNjYWxlQ29udHJvbCA9IG51bGw7XHJcbiAgICAgICAgZnVuY3Rpb24gc3luY1NjYWxlKCkge1xyXG4gICAgICAgICAgICBpZiAoc2NhbGVDb250cm9sKSB7XHJcbiAgICAgICAgICAgICAgICBzY2FsZUNvbnRyb2wucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBzY2FsZUNvbnRyb2wgPSBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICghbW9kZWwuZ2V0KFwic2hvd19zY2FsZVwiKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJzY2FsZV9jb25maWdcIikgfHwge307XHJcbiAgICAgICAgICAgIGNvbnN0IHVuaXRzID0gY2ZnLnVuaXRzIHx8IFwibWV0cmljXCI7XHJcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgICAgICBwb3NpdGlvbjogKGNmZy5wb3NpdGlvbiB8fCBcImJvdHRvbS1sZWZ0XCIpLnJlcGxhY2UoXCItXCIsIFwiXCIpLFxyXG4gICAgICAgICAgICAgICAgbWF4V2lkdGg6IGNmZy5tYXhfd2lkdGggfHwgMTIwLFxyXG4gICAgICAgICAgICAgICAgbWV0cmljOiB1bml0cyA9PT0gXCJtZXRyaWNcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXHJcbiAgICAgICAgICAgICAgICBpbXBlcmlhbDogdW5pdHMgPT09IFwiaW1wZXJpYWxcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbCA9IHVuaXRzID09PSBcIm5hdXRpY2FsXCJcclxuICAgICAgICAgICAgICAgID8gbmV3IE5hdXRpY2FsU2NhbGUob3B0aW9ucylcclxuICAgICAgICAgICAgICAgIDogTC5jb250cm9sLnNjYWxlKG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBzY2FsZUNvbnRyb2wuYWRkVG8obWFwKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgc3luY1NjYWxlKCk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19zY2FsZVwiLCBzeW5jU2NhbGUpO1xyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNjYWxlX2NvbmZpZ1wiLCBzeW5jU2NhbGUpO1xyXG5cclxuICAgICAgICAvLyBFbXB0eS1tYXAgY2xpY2tzOiByZXBvcnQgd2hlcmUuIFJlZ2lzdGVyZWQgdGhyb3VnaCB0aGUgc2FtZSBhcmJpdHJhdGlvbiB0aGVcclxuICAgICAgICAvLyBmZWF0dXJlIGhhbmRsZXJzIHVzZSwgYXQgdGhlIGxvd2VzdCBwcmlvcml0eSwgc28gYSBjbGljayB0aGF0IGhpdCBhIGZlYXR1cmVcclxuICAgICAgICAvLyBzdGF5cyB0aGF0IGZlYXR1cmUncyBjbGljayAtLSB0aGlzIHdpbnMgb25seSB3aGVuIG5vdGhpbmcgY2xhaW1lZCB0aGUgZXZlbnQuXHJcbiAgICAgICAgLy8gZS5sYXRsbmcgaXMgYWxyZWFkeSB1bnByb2plY3RlZCB0aHJvdWdoIHdoaWNoZXZlciBDUlMgdGhlIG1hcCBydW5zICgzODU3IGFuZFxyXG4gICAgICAgIC8vIDQzMjYgYWxpa2UpLCBzbyB0aGVyZSBpcyBubyBwaXhlbCBtYXRoIHRvIGdldCB3cm9uZyBoZXJlOyB3cmFwKCkga2VlcHMgYVxyXG4gICAgICAgIC8vIHdvcmxkLXBhbm5lZCBtYXAgZnJvbSByZXBvcnRpbmcgbG9uZ2l0dWRlIC0zNjQuXHJcbiAgICAgICAgbWFwLm9uKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgLy8gU3RhbXBlZCBzeW5jaHJvbm91c2x5LCBiZWZvcmUgYW55IGdsaWZ5IGhhbmRsZXIgcmVnaXN0ZXJzIGl0cyBtYXRjaFxyXG4gICAgICAgICAgICAvLyAodGhpcyBoYW5kbGVyIHdhcyBib3VuZCBmaXJzdCwgc28gTGVhZmxldCBydW5zIGl0IGZpcnN0KTogdGhlIHdob2xlXHJcbiAgICAgICAgICAgIC8vIGNsaWNrIHBpcGVsaW5lIC0tIGZlYXR1cmUgcG9wdXBzIGFuZCB0aGlzIGZhbGxiYWNrIGFsaWtlIC0tIHN0YW5kc1xyXG4gICAgICAgICAgICAvLyBkb3duIHdoaWxlIGEgR2VvbWFuIG1vZGUgaXMgYXJtZWQuIERlZmVycmVkIGNoZWNrcyBtaXNzIG1vZGVzIHRoYXRcclxuICAgICAgICAgICAgLy8gY2xvc2UgdGhlbXNlbHZlcyBvbiB0aGVpciBmaW5pc2hpbmcgY2xpY2sgKGEgY29tcGxldGVkIHJlY3RhbmdsZSksXHJcbiAgICAgICAgICAgIC8vIHdoaWNoIGlzIHdoeSB0aGUgc3RhdGUgaXMgY2FwdHVyZWQgYXQgY2xpY2sgdGltZS5cclxuICAgICAgICAgICAgY29uc3QgcG0gPSBtYXAucG07XHJcbiAgICAgICAgICAgIG1hcC5fcG1Nb2RlQWN0aXZlID0gQm9vbGVhbihwbVxyXG4gICAgICAgICAgICAgICAgJiYgKChwbS5nbG9iYWxSZW1vdmFsTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsUmVtb3ZhbE1vZGVFbmFibGVkKCkpXHJcbiAgICAgICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbEVkaXRNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxFZGl0TW9kZUVuYWJsZWQoKSlcclxuICAgICAgICAgICAgICAgICAgICB8fCAocG0uZ2xvYmFsRHJhZ01vZGVFbmFibGVkICYmIHBtLmdsb2JhbERyYWdNb2RlRW5hYmxlZCgpKVxyXG4gICAgICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmF3TW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhd01vZGVFbmFibGVkKCkpKSk7XHJcbiAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDk5LCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsbCA9IGUubGF0bG5nLndyYXAoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IE1hdGgucm91bmQobGwubGF0ICogMWU1KSAvIDFlNTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxuZyA9IE1hdGgucm91bmQobGwubG5nICogMWU1KSAvIDFlNTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBcIlwiKTtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAtMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIiwgW2xhdCwgbG5nXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgICAgICAgICAgaWYgKG1vZGVsLmdldChcInNob3dfY2xpY2tfY29vcmRpbmF0ZXNcIikpIHtcclxuICAgICAgICAgICAgICAgICAgICBMLnBvcHVwKHsgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWNvb3Jkcy1wb3B1cFwiLCBjbG9zZUJ1dHRvbjogZmFsc2UgfSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLnNldExhdExuZyhlLmxhdGxuZylcclxuICAgICAgICAgICAgICAgICAgICAgICAgLnNldENvbnRlbnQoYCR7bGwubGF0LnRvRml4ZWQoNSl9LCAke2xsLmxuZy50b0ZpeGVkKDUpfWApXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC5vcGVuT24obWFwKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEJpbmQgem9vbSBhbmQgY2VudGVyIGNoYW5nZXMgYmFjayB0byBQeXRob24gc2FmZWx5XHJcbiAgICAgICAgbWFwLm9uKFwibW92ZWVuZFwiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50Wm9vbSA9IG1hcC5nZXRab29tKCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGVsQ2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxab29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtb2RlbFpvb20gIT09IGN1cnJlbnRab29tO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyQ2hhbmdlZCA9ICFtb2RlbENlbnRlciB8fCBcclxuICAgICAgICAgICAgICAgICAgICAhQXJyYXkuaXNBcnJheShtb2RlbENlbnRlcikgfHxcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbENlbnRlci5sZW5ndGggPCAyIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobW9kZWxDZW50ZXJbMF0gLSBjZW50ZXIubGF0KSA+IDAuMDAwMSB8fCBcclxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclsxXSAtIGNlbnRlci5sbmcpID4gMC4wMDAxO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2VudGVyXCIsIFtjZW50ZXIubGF0LCBjZW50ZXIubG5nXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoem9vbUNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInpvb21cIiwgY3VycmVudFpvb20pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBzYWZlU2F2ZUNoYW5nZXMoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gbW92ZWVuZCBoYW5kbGVyOlwiLCBlcnIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHVwZGF0ZU1hcFZpZXcoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1vZGVsLmdldChcImNlbnRlclwiKTtcclxuICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XHJcbiAgICAgICAgICAgIGlmIChjZW50ZXIgJiYgQXJyYXkuaXNBcnJheShjZW50ZXIpICYmIGNlbnRlci5sZW5ndGggPj0gMikge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbWFwQ2VudGVyID0gbWFwLmdldENlbnRlcigpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbWFwWm9vbSA9IG1hcC5nZXRab29tKCk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gTWF0aC5hYnMobWFwQ2VudGVyLmxhdCAtIGNlbnRlclswXSkgPiAwLjAwMDEgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobWFwQ2VudGVyLmxuZyAtIGNlbnRlclsxXSkgPiAwLjAwMDE7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1hcFpvb20gIT09IHpvb207XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkIHx8IHpvb21DaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFZpZXcoY2VudGVyLCB0eXBlb2Ygem9vbSA9PT0gXCJudW1iZXJcIiA/IHpvb20gOiBtYXBab29tKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiICYmIG1hcC5nZXRab29tKCkgIT09IHpvb20pIHtcclxuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbSh6b29tKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gV2F0Y2ggZm9yIG1hcCB2aWV3IHVwZGF0ZXMgZnJvbSBQeXRob25cclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpjZW50ZXJcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ0NlbnRlckZyb21NYXApIHtcclxuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdXBkYXRlTWFwVmlldygpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnpvb21cIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ1pvb21Gcm9tTWFwKSB7XHJcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgLy8gRml0dGluZyB0aGUgdmlldyBpcyBhIGNvbW1hbmQsIG5vdCBzdGF0ZTogYXNraW5nIHRvIGZpdCB0aGUgc2FtZSBib3VuZHMgdHdpY2VcclxuICAgICAgICAvLyBtdXN0IG1vdmUgdGhlIG1hcCBib3RoIHRpbWVzLCBzaW5jZSB0aGUgdXNlciBtYXkgaGF2ZSBwYW5uZWQgYXdheSBpbiBiZXR3ZWVuLlxyXG4gICAgICAgIC8vIFRoZSByZXF1ZXN0IGNhcnJpZXMgYSBzZXF1ZW5jZSBudW1iZXIgc28gYW4gaWRlbnRpY2FsIGZpdCBzdGlsbCBmaXJlcyBhIGNoYW5nZS5cclxuICAgICAgICBmdW5jdGlvbiBhcHBseUZpdFJlcXVlc3QoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlcSA9IG1vZGVsLmdldChcImZpdF9ib3VuZHNfcmVxdWVzdFwiKSB8fCB7fTtcclxuICAgICAgICAgICAgY29uc3QgYm91bmRzID0gcmVxLmJvdW5kcztcclxuICAgICAgICAgICAgaWYgKCFib3VuZHMgfHwgYm91bmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xyXG4gICAgICAgICAgICBpZiAocmVxLnBhZGRpbmcgIT0gbnVsbCkgb3B0aW9ucy5wYWRkaW5nID0gW3JlcS5wYWRkaW5nLCByZXEucGFkZGluZ107XHJcbiAgICAgICAgICAgIGlmIChyZXEubWF4X3pvb20gIT0gbnVsbCkgb3B0aW9ucy5tYXhab29tID0gcmVxLm1heF96b29tO1xyXG4gICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcywgb3B0aW9ucyk7XHJcblxyXG4gICAgICAgICAgICAvLyBBcHBsaWVkIGFmdGVyIHRoZSBmaXQsIHNpbmNlIGl0IGlzIHJlbGF0aXZlIHRvIHdoYXRldmVyIHpvb20gdGhlIGZpdCBjaG9zZS5cclxuICAgICAgICAgICAgaWYgKHJlcS56b29tX29mZnNldCkge1xyXG4gICAgICAgICAgICAgICAgbWFwLnNldFpvb20obWFwLmdldFpvb20oKSArIHJlcS56b29tX29mZnNldCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Zml0X2JvdW5kc19yZXF1ZXN0XCIsIGFwcGx5Rml0UmVxdWVzdCk7XHJcbiAgICAgICAgLy8gQSByZXF1ZXN0IHNldCBiZWZvcmUgdGhpcyB2aWV3IGF0dGFjaGVkIC0tIGEgcHJlLWRpc3BsYXkgZml0X2JvdW5kcygpIGNhbGwsXHJcbiAgICAgICAgLy8gb3IgdGhlIHVuaW9uIGEgZnJlc2ggbWFwIG1haW50YWlucyBhcyBhdXRvLWZpdCB3aGlsZSBsYXllcnMgYXJlIGFkZGVkIC0tIGlzXHJcbiAgICAgICAgLy8gYWxyZWFkeSBzdGF0ZSBieSBub3csIHNvIHRoZSBjaGFuZ2UgZXZlbnQgd2lsbCBuZXZlciBmaXJlIGZvciBpdC4gSXQgdXNlZFxyXG4gICAgICAgIC8vIHRvIGJlIHNpbGVudGx5IGRyb3BwZWQ7IGFwcGx5IGl0IG9uY2UgdGhlIG1hcCBpcyByZWFkeSBpbnN0ZWFkLlxyXG4gICAgICAgIG1hcC53aGVuUmVhZHkoKCkgPT4gYXBwbHlGaXRSZXF1ZXN0KCkpO1xyXG4gICAgICAgIC8vIEEgbWFwIGNvbnN0cnVjdGVkIGluc2lkZSBhIGhpZGRlbiBjb250YWluZXIgLS0gYSBTaGlueSBuYXZfcGFuZWwgdGhhdCBpc1xyXG4gICAgICAgIC8vIG5vdCB0aGUgc2VsZWN0ZWQgdGFiIC0tIGluaXRpYWxpc2VzIGF0IDB4MCwgYW5kIExlYWZsZXQgY2FjaGVzIHRoYXQgc2l6ZTpcclxuICAgICAgICAvLyBpdHMgb3duIHRyYWNrUmVzaXplIHdhdGNoZXMgdGhlIFdJTkRPVywgbm90IHRoZSBjb250YWluZXIsIHNvIG5vdGhpbmcgZXZlclxyXG4gICAgICAgIC8vIGNvcnJlY3RzIGl0LiBUaGUgZml0IGFib3ZlIHRoZW4gY29tcHV0ZXMgaXRzIHpvb20gZnJvbSBhIHplcm8tc2l6ZSBsaWUgYW5kXHJcbiAgICAgICAgLy8gdGhlIHZpZXcgbGFuZHMgd3JvbmcgcGVybWFuZW50bHkuIFdhdGNoIHRoZSBjb250YWluZXIgaXRzZWxmOiBldmVyeSByZXNpemVcclxuICAgICAgICAvLyByZS1tZWFzdXJlcywgYW5kIHRoZSBmaXJzdCB0cmFuc2l0aW9uIGZyb20gemVybyB0byByZWFsIHNpemUgcmUtYXBwbGllc1xyXG4gICAgICAgIC8vIHRoZSBwZW5kaW5nIGZpdCB3aXRoIGEgc2l6ZSB0aGF0IGNhbiBhY3R1YWxseSBob2xkIGl0LlxyXG4gICAgICAgIGlmICh0eXBlb2YgUmVzaXplT2JzZXJ2ZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcclxuICAgICAgICAgICAgbGV0IGhhZFNpemUgPSBjb250YWluZXIuY2xpZW50V2lkdGggPiAwICYmIGNvbnRhaW5lci5jbGllbnRIZWlnaHQgPiAwO1xyXG4gICAgICAgICAgICBjb25zdCBjb250YWluZXJSZXNpemUgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaGFzU2l6ZSA9IGNvbnRhaW5lci5jbGllbnRXaWR0aCA+IDAgJiYgY29udGFpbmVyLmNsaWVudEhlaWdodCA+IDA7XHJcbiAgICAgICAgICAgICAgICBpZiAoaGFzU2l6ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcC5pbnZhbGlkYXRlU2l6ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghaGFkU2l6ZSkgYXBwbHlGaXRSZXF1ZXN0KCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBoYWRTaXplID0gaGFzU2l6ZTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGNvbnRhaW5lclJlc2l6ZS5vYnNlcnZlKGNvbnRhaW5lcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZXQgc3luY1RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgIGxldCBpc1N5bmNpbmcgPSBmYWxzZTtcclxuICAgICAgICBsZXQgbmVlZHNTeW5jID0gZmFsc2U7XHJcblxyXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1TeW5jKCkge1xyXG4gICAgICAgICAgICBpZiAoaXNTeW5jaW5nKSB7XHJcbiAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlzU3luY2luZyA9IHRydWU7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBzeW5jTWFwU3RhdGUoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gc3luY01hcFN0YXRlOlwiLCBlcnIpO1xyXG4gICAgICAgICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgICAgICAgICAgaXNTeW5jaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAobmVlZHNTeW5jKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gcXVldWVTeW5jKCkge1xyXG4gICAgICAgICAgICBpZiAoIW1vZGVsLmdldChcImF1dG9fc3luY1wiKSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChzeW5jVGltZW91dCkge1xyXG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lb3V0KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBzeW5jVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcclxuICAgICAgICAgICAgfSwgNTApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGlzdGVuIGZvciBtYW51YWwgc3luYyB0cmlnZ2VyIGNoYW5nZXMgZnJvbSBQeXRob25cclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzeW5jX3RyaWdnZXJcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBJbmNyZW1lbnRhbCB1cGRhdGVzIGZyb20gUHl0aG9uLiBBcHBsaWVkIGV2ZW4gd2hlbiBhdXRvX3N5bmMgaXMgb2ZmIHNvIHRoZSBtaXJyb3JcclxuICAgICAgICAvLyBzdGF5cyBjdXJyZW50OyBxdWV1ZVN5bmMgZGVjaWRlcyB3aGV0aGVyIHRvIGFjdHVhbGx5IHJlLXJlbmRlci5cclxuICAgICAgICBtb2RlbC5vbihcIm1zZzpjdXN0b21cIiwgKG1zZywgYnVmZmVycykgPT4ge1xyXG4gICAgICAgICAgICBpZiAoIW1zZyB8fCBtc2cua2luZCAhPT0gXCJzd2lmdG1hcF9wYXRjaFwiKSByZXR1cm47XHJcbiAgICAgICAgICAgIGFwcGx5UGF0Y2hPcHMobXNnLm9wcyB8fCBbXSwgYnVmZmVycyk7XHJcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBGdWxsLXNuYXBzaG90IHBhdGhzOiB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlLCBhbmQgdGhlIHNpZGViYXIgd3JpdGluZyBgbGF5ZXJzYFxyXG4gICAgICAgIC8vIGJhY2sgYWZ0ZXIgYSB0b2dnbGUuIEVpdGhlciB3YXkgdGhlIHRyYWl0IGJlY29tZXMgYXV0aG9yaXRhdGl2ZSBhZ2Fpbi5cclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsYXllcnNcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICBsYXllclN0YXRlID0gbW9kZWwuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xyXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpjb29yZGluYXRlX2J1ZmZlcnNcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcclxuICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Z3JvdXBfY29uZmlnc1wiLCBxdWV1ZVN5bmMpO1xyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnRpbWVfY29uZmlnXCIsICgpID0+IHtcclxuICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTsgICAvLyByZS1hcHBseSBzcGVlZC9sb29wIGZyb20gdGhlIG5ldyBjb25maWdcclxuICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgLy8gUHl0aG9uIHN0ZWVyaW5nIHRoZSBzbGlkZXI6IHNuYXAgdG8gdGhlIG5lYXJlc3QgdGljayBhdCBvciBhZnRlciB0aGUgcmVxdWVzdGVkXHJcbiAgICAgICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2N1cnJlbnRcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCB3YW50ZWQgPSBtb2RlbC5nZXQoXCJ0aW1lX2N1cnJlbnRcIik7XHJcbiAgICAgICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XHJcbiAgICAgICAgICAgIGlmIChNYXRoLmFicyh3YW50ZWQgLSB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSkgPCAxKSByZXR1cm47XHJcbiAgICAgICAgICAgIGxldCBpZHggPSB0aW1lVUkudGlja3MuZmluZEluZGV4KHQgPT4gdCA+PSB3YW50ZWQpO1xyXG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XHJcbiAgICAgICAgICAgIHNlZWtUbyhpZHgsIHsgd3JpdGU6IGZhbHNlIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbG9nb1wiLCBxdWV1ZVN5bmMpO1xyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbGVnZW5kXCIsIHF1ZXVlU3luYyk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6bGVnZW5kX2NvbmZpZ1wiLCBxdWV1ZVN5bmMpO1xyXG4gICAgICAgIC8vIExpdmUgcmVzaXplcyAoYSBTaGlueSBsYXlvdXQsIGEgbm90ZWJvb2sgY2VsbCk6IExlYWZsZXQgY2FjaGVzIGl0cyBib3gsIHNvXHJcbiAgICAgICAgLy8gaXQgbXVzdCBiZSB0b2xkIHRvIHJlLW1lYXN1cmUgb3IgdGlsZXMgcmVuZGVyIGZvciB0aGUgb2xkIHNpemUuXHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6aGVpZ2h0XCIsICgpID0+IHtcclxuICAgICAgICAgICAgYXBwbHlIZWlnaHQoKTtcclxuICAgICAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEFubm91bmNlIHRoaXMgdmlldyBzbyBQeXRob24gcmVwbGllcyB3aXRoIGEgZnVsbCBzbmFwc2hvdC4gTGF5ZXJzIGFkZGVkIGJlZm9yZVxyXG4gICAgICAgIC8vIHRoZSB2aWV3IGF0dGFjaGVkIHdvdWxkIG90aGVyd2lzZSBiZSBtaXNzaW5nOiB0aGVpciBwYXRjaGVzIHdlcmUgZW1pdHRlZCBpbnRvIGFcclxuICAgICAgICAvLyB3aW5kb3cgd2hlcmUgbm90aGluZyB3YXMgbGlzdGVuaW5nLlxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIG1vZGVsLnNlbmQoeyBraW5kOiBcInN3aWZ0bWFwX3JlYWR5XCIgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSBpcyBhbGwgdGhlcmUgaXMgKi8gfVxyXG5cclxuICAgICAgICAvLyBSZXNwZWN0IGluaXRpYWwgYXV0b19zeW5jIHN0YXRlIG9yIG1hbnVhbCBzeW5jIHJlcXVlc3RzIHNlbnQgZHVyaW5nIG1hcCBidWlsZGluZ1xyXG4gICAgICAgIGlmIChtb2RlbC5nZXQoXCJhdXRvX3N5bmNcIikgfHwgbW9kZWwuZ2V0KFwic3luY190cmlnZ2VyXCIpID4gMCkge1xyXG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFPLFNBQVMsUUFBUSxJQUFJLEtBQUs7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LE1BQ2hCLEdBQUcsRUFBRTtBQUFBLElBQ1Q7QUFHQSxVQUFNLEdBQUcsdUJBQXVCLE1BQU07QUFDbEMsa0JBQVk7QUFBQSxJQUNoQixDQUFDO0FBSUQsVUFBTSxHQUFHLGNBQWMsQ0FBQyxLQUFLLFlBQVk7QUFDckMsVUFBSSxDQUFDLE9BQU8sSUFBSSxTQUFTLGlCQUFrQjtBQUMzQyxvQkFBYyxJQUFJLE9BQU8sQ0FBQyxHQUFHLE9BQU87QUFDcEMsZ0JBQVU7QUFBQSxJQUNkLENBQUM7QUFJRCxVQUFNLEdBQUcsaUJBQWlCLE1BQU07QUFDNUIsbUJBQWEsTUFBTSxJQUFJLFFBQVEsS0FBSyxDQUFDO0FBQ3JDLGdCQUFVO0FBQUEsSUFDZCxDQUFDO0FBQ0QsVUFBTSxHQUFHLDZCQUE2QixNQUFNO0FBQ3hDLG9CQUFjLEVBQUUsR0FBSSxNQUFNLElBQUksb0JBQW9CLEtBQUssQ0FBQyxFQUFHO0FBQzNELGdCQUFVO0FBQUEsSUFDZCxDQUFDO0FBQ0QsVUFBTSxHQUFHLHdCQUF3QixTQUFTO0FBQzFDLFVBQU0sR0FBRyxzQkFBc0IsTUFBTTtBQUNqQyxhQUFPLFVBQVU7QUFDakIsZ0JBQVU7QUFBQSxJQUNkLENBQUM7QUFHRCxVQUFNLEdBQUcsdUJBQXVCLE1BQU07QUFDbEMsWUFBTSxTQUFTLE1BQU0sSUFBSSxjQUFjO0FBQ3ZDLFVBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxNQUFNLE9BQVE7QUFDeEMsVUFBSSxLQUFLLElBQUksU0FBUyxPQUFPLE1BQU0sT0FBTyxLQUFLLENBQUMsSUFBSSxFQUFHO0FBQ3ZELFVBQUksTUFBTSxPQUFPLE1BQU0sVUFBVSxPQUFLLEtBQUssTUFBTTtBQUNqRCxVQUFJLFFBQVEsR0FBSSxPQUFNLE9BQU8sTUFBTSxTQUFTO0FBQzVDLGFBQU8sS0FBSyxFQUFFLE9BQU8sTUFBTSxDQUFDO0FBQUEsSUFDaEMsQ0FBQztBQUNELFVBQU0sR0FBRyxvQkFBb0IsU0FBUztBQUN0QyxVQUFNLEdBQUcsc0JBQXNCLFNBQVM7QUFDeEMsVUFBTSxHQUFHLHdCQUF3QixTQUFTO0FBRzFDLFVBQU0sR0FBRyxpQkFBaUIsTUFBTTtBQUM1QixrQkFBWTtBQUNaLFVBQUksZUFBZTtBQUFBLElBQ3ZCLENBQUM7QUFLRCxRQUFJO0FBQ0EsWUFBTSxLQUFLLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUFBLElBQ3pDLFNBQVMsS0FBSztBQUFBLElBQW1FO0FBR2pGLFFBQUksTUFBTSxJQUFJLFdBQVcsS0FBSyxNQUFNLElBQUksY0FBYyxJQUFJLEdBQUc7QUFDekQsa0JBQVk7QUFBQSxJQUNoQjtBQUFBLEVBQ0o7QUFDSjsiLAogICJuYW1lcyI6IFsiY291bnQiLCAiZ2xMYXllciIsICJpbnN0YW5jZSIsICJMIiwgImNvbnRhaW5lciIsICJ6b29tIl0KfQo=
