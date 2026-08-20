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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3NoYWRlcnMuanMiLCAiLi4vLi4vc3JjL3RpbWVjb250cm9sLmpzIiwgIi4uLy4uL3NyYy9ncHV0aW1lLmpzIiwgIi4uLy4uL3NyYy9sYXllcnMuanMiLCAiLi4vLi4vc3JjL2xhYmVscy5qcyIsICIuLi8uLi9zcmMvbWFwLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgZnVuY3Rpb24gbG9hZENTUyhpZCwgdXJsKSB7XG4gICAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgY29uc3QgbGluayA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJsaW5rXCIpO1xuICAgICAgICBsaW5rLmlkID0gaWQ7XG4gICAgICAgIGxpbmsucmVsID0gXCJzdHlsZXNoZWV0XCI7XG4gICAgICAgIGxpbmsuaHJlZiA9IHVybDtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChsaW5rKTtcbiAgICB9XG59XG5cbmNvbnN0IGFjdGl2ZUxvYWRlcnMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKUyhpZCwgdXJsKSB7XG4gICAgaWYgKGFjdGl2ZUxvYWRlcnNbaWRdKSB7XG4gICAgICAgIHJldHVybiBhY3RpdmVMb2FkZXJzW2lkXTtcbiAgICB9XG4gICAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgaWYgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzY3JpcHRcIik7XG4gICAgICAgIHNjcmlwdC5pZCA9IGlkO1xuICAgICAgICBzY3JpcHQuc3JjID0gdXJsO1xuICAgICAgICBzY3JpcHQub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xuICAgICAgICBzY3JpcHQub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIHNjcmlwdDogJHt1cmx9YCkpO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHNjcmlwdCk7XG4gICAgfSk7XG4gICAgYWN0aXZlTG9hZGVyc1tpZF0gPSBwcm9taXNlO1xuICAgIHJldHVybiBwcm9taXNlO1xufVxuXG5mdW5jdGlvbiBoZXhUb1JnYihoZXgpIHtcbiAgICBpZiAoIWhleCkgcmV0dXJuIG51bGw7XG4gICAgaGV4ID0gaGV4LnJlcGxhY2UoL14jLywgJycpO1xuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XG4gICAgICAgIGhleCA9IGhleC5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhciArIGNoYXIpLmpvaW4oJycpO1xuICAgIH1cbiAgICBpZiAoaGV4Lmxlbmd0aCAhPT0gNikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbnVtID0gcGFyc2VJbnQoaGV4LCAxNik7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcjogKChudW0gPj4gMTYpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgZzogKChudW0gPj4gOCkgJiAyNTUpIC8gMjU1LFxuICAgICAgICBiOiAobnVtICYgMjU1KSAvIDI1NVxuICAgIH07XG59XG5cbmxldCBjb2xvclByb2JlID0gbnVsbDtcblxuLy8gQnJvd3NlcnMgc2hpcCBhIGNvbXBsZXRlIENTUyBjb2xvciBwYXJzZXIgLS0gZXZlcnkgbmFtZWQgY29sb3IsIHJnYigpLCBoc2woKSwgaHdiKCkuXG4vLyBCb3Jyb3cgaXQgaW5zdGVhZCBvZiBtYWludGFpbmluZyBhIGxvb2t1cCB0YWJsZS4gUmV0dXJucyBudWxsIG91dHNpZGUgYSBET00gKE5vZGUgdGVzdHMpLFxuLy8gd2hlcmUgdGhlIGhleCBmYWxsYmFjayBpbiBwYXJzZUNvbG9yIHN0aWxsIGFwcGxpZXMuXG5mdW5jdGlvbiBjc3NDb2xvclRvUmdiKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFjb2xvclByb2JlKSBjb2xvclByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKS5nZXRDb250ZXh0KFwiMmRcIik7XG5cbiAgICAvLyBBc3NpZ25pbmcgYW4gaW52YWxpZCBjb2xvciBsZWF2ZXMgZmlsbFN0eWxlIHVudG91Y2hlZCwgc28gcHJvYmUgYWdhaW5zdCB0d28gZGlmZmVyZW50XG4gICAgLy8gc2VudGluZWxzOiBvbmx5IGEgdmFsdWUgdGhlIGJyb3dzZXIgYWN0dWFsbHkgcGFyc2VkIHByb2R1Y2VzIHRoZSBzYW1lIHJlc3VsdCB0d2ljZS5cbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiIzAwMDAwMFwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgY29uc3QgZmlyc3QgPSBjb2xvclByb2JlLmZpbGxTdHlsZTtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiI2ZmZmZmZlwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgaWYgKGZpcnN0ICE9PSBjb2xvclByb2JlLmZpbGxTdHlsZSkgcmV0dXJuIG51bGw7XG5cbiAgICBpZiAoZmlyc3Quc3RhcnRzV2l0aChcIiNcIikpIHJldHVybiBoZXhUb1JnYihmaXJzdCk7XG4gICAgY29uc3QgbWF0Y2ggPSBmaXJzdC5tYXRjaCgvcmdiYT9cXCgoW14pXSspXFwpLyk7XG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcGFydHMgPSBtYXRjaFsxXS5zcGxpdChcIixcIikubWFwKHAgPT4gcGFyc2VGbG9hdChwLnRyaW0oKSkpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzIHx8IHBhcnRzLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsgcjogcGFydHNbMF0gLyAyNTUsIGc6IHBhcnRzWzFdIC8gMjU1LCBiOiBwYXJ0c1syXSAvIDI1NSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb2xvcihjb2xvclN0ciwgZmFsbGJhY2tIZXggPSBcIiMzMzg4ZmZcIikge1xuICAgIGlmICghY29sb3JTdHIpIGNvbG9yU3RyID0gZmFsbGJhY2tIZXg7XG4gICAgcmV0dXJuIGNzc0NvbG9yVG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGhleFRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBjc3NDb2xvclRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCBoZXhUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG59XG5cbmNvbnN0IFVSTF9BVFRSX0JFRk9SRSA9IC8oPzpocmVmfHNyYylcXHMqPVxccypbJ1wiXT8kL2k7XG5jb25zdCBTQUZFX1VSTCA9IC9eKD86aHR0cHM/OlxcL1xcL3xtYWlsdG86fHRlbDp8ZGF0YTppbWFnZVxcL3xbLi8jP118W1xcdy4tXSsoPzpbLz8jXXwkKSkvaTtcblxuLy8gUHJvcGVydHkgdmFsdWVzIGNvbWUgZnJvbSB1c2VyIGRhdGEgYW5kIGVuZCB1cCBpbiBpbm5lckhUTUwsIHNvIHRoZXkgYXJlIGVzY2FwZWQuXG4vLyBNYXJrdXAgdGhlIGFwcCBhdXRob3Igd3JvdGUgKHRlbXBsYXRlcywgc3R5bGUgc3RyaW5ncykgaXMgbGVmdCBpbnRhY3QuXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpXG4gICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcbn1cblxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXG4vLyBpbiBhIFVSTCBhdHRyaWJ1dGUgZ2V0IGEgc2NoZW1lIGNoZWNrLiBDb250cm9sIGNoYXJhY3RlcnMgYXJlIHN0cmlwcGVkIGZpcnN0IGJlY2F1c2Vcbi8vIFwiamF2YVxcdHNjcmlwdDpcIiBzdXJ2aXZlcyBhIG5haXZlIGNvbXBhcmlzb24uXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZSkge1xuICAgIGNvbnN0IGNvbGxhcHNlZCA9IFN0cmluZyh2YWx1ZSkuc3BsaXQoXCJcIikuZmlsdGVyKGMgPT4gYy5jaGFyQ29kZUF0KDApID4gMzIpLmpvaW4oXCJcIik7XG4gICAgcmV0dXJuIFNBRkVfVVJMLnRlc3QoY29sbGFwc2VkKSA/IFN0cmluZyh2YWx1ZSkgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICBjb25zdCB0YXJnZXRGaWVsZHMgPSAoQXJyYXkuaXNBcnJheShmaWVsZHMpICYmIGZpZWxkcy5sZW5ndGgpID8gZmllbGRzIDogT2JqZWN0LmtleXMocHJvcHMpO1xuICAgIGNvbnN0IGxhYmVscyA9IChBcnJheS5pc0FycmF5KG5hbWVzKSAmJiBuYW1lcy5sZW5ndGggPT09IHRhcmdldEZpZWxkcy5sZW5ndGgpID8gbmFtZXMgOiB0YXJnZXRGaWVsZHM7XG4gICAgY29uc3QgbGluZXMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldEZpZWxkcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBmID0gdGFyZ2V0RmllbGRzW2ldO1xuICAgICAgICBpZiAocHJvcHNbZl0gPT09IHVuZGVmaW5lZCB8fCBwcm9wc1tmXSA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGxpbmVzLnB1c2goYDxiPiR7ZXNjYXBlSHRtbChsYWJlbHNbaV0pfTwvYj46ICR7ZXNjYXBlSHRtbChwcm9wc1tmXSl9YCk7XG4gICAgfVxuICAgIHJldHVybiBsaW5lcy5qb2luKFwiPGJyPlwiKTtcbn1cblxuLy8gXCJ7Y29sdW1ufVwiIGluc2VydHMgb25lIGVzY2FwZWQgdmFsdWU7IFwieyp9XCIgaW5zZXJ0cyB0aGUgZGVmYXVsdCBmaWVsZCBsaXN0LlxuZnVuY3Rpb24gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlLnJlcGxhY2UoL1xceyhcXCp8XFx3KylcXH0vZywgKG1hdGNoLCBrZXksIG9mZnNldCkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcIipcIikge1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2YWwgPSBwcm9wc1trZXldO1xuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgICAgICAgY29uc3QgcHJlY2VkaW5nID0gdGVtcGxhdGUuc2xpY2UoTWF0aC5tYXgoMCwgb2Zmc2V0IC0gMTYpLCBvZmZzZXQpO1xuICAgICAgICByZXR1cm4gZXNjYXBlSHRtbChVUkxfQVRUUl9CRUZPUkUudGVzdChwcmVjZWRpbmcpID8gc2FmZVVybCh2YWwpIDogdmFsKTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBraW5kKSB7XG4gICAgY29uc3QgdGVtcGxhdGUgPSBsYXllcltraW5kICsgXCJfdGVtcGxhdGVcIl07XG4gICAgY29uc3QgZmllbGRzID0gbGF5ZXJba2luZCArIFwiX2ZpZWxkc1wiXTtcbiAgICBjb25zdCBuYW1lcyA9IGxheWVyW2tpbmQgKyBcIl9uYW1lc1wiXTtcbiAgICBpZiAodHlwZW9mIHRlbXBsYXRlID09PSBcInN0cmluZ1wiICYmIHRlbXBsYXRlKSB7XG4gICAgICAgIHJldHVybiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgIH1cbiAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xufVxuXG5mdW5jdGlvbiB3cmFwU3R5bGVkKGh0bWwsIHN0eWxlKSB7XG4gICAgaWYgKCFzdHlsZSkgcmV0dXJuIGh0bWw7XG4gICAgcmV0dXJuIGA8ZGl2IHN0eWxlPVwiJHtlc2NhcGVIdG1sKHN0eWxlKX1cIj4ke2h0bWx9PC9kaXY+YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQb3B1cChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInBvcHVwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF9wb3B1cCB8fCBsYXllci5wb3B1cF9maWVsZHMgfHwgbGF5ZXIucG9wdXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgaWYgKGxheWVyLnBvcHVwX21heF93aWR0aCkgb3B0aW9ucy5tYXhXaWR0aCA9IGxheWVyLnBvcHVwX21heF93aWR0aDtcbiAgICAgICAgTC5wb3B1cChvcHRpb25zKVxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnBvcHVwX3N0eWxlKSlcbiAgICAgICAgICAgIC5vcGVuT24obWFwKTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kVG9vbHRpcChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyLCBsYXllckluc3RhbmNlKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInRvb2x0aXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3Rvb2x0aXAgfHwgbGF5ZXIudG9vbHRpcF9maWVsZHMgfHwgbGF5ZXIudG9vbHRpcF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgaWYgKCFsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwID0gTC50b29sdGlwKHsgZGlyZWN0aW9uOiAndG9wJywgb2Zmc2V0OiBbMCwgLTVdIH0pO1xuICAgICAgICB9XG4gICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXBcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci50b29sdGlwX3N0eWxlKSlcbiAgICAgICAgICAgIC5hZGRUbyhtYXApO1xuICAgIH1cbn1cbiIsICJjb25zdCBjb2xsYXBzZWRQYXRocyA9IHt9OyAgLy8gcGF0aCAtPiBjb2xsYXBzZWQ/XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJCb3VuZHMobCwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmICghbCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgLy8gU3VwcG9ydCBmb2xkZXIgdHJlZSBub2RlcyAoZ3JvdXBzIGluIHNpZGViYXIgdHJlZSlcclxuICAgIGlmIChsLmlzR3JvdXApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZHJlbiBncm91cHNcclxuICAgICAgICBPYmplY3Qua2V5cyhsLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhsLmNoaWxkcmVuW2tleV0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGQgbGF5ZXJzXHJcbiAgICAgICAgbC5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobHlyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChsLmJvdW5kcyAmJiBsLmJvdW5kcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgcmV0dXJuIGwuYm91bmRzO1xyXG4gICAgfVxyXG4gICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbC5sYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobC5sb2NhdGlvbnMgJiYgbC5sb2NhdGlvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IGwubG9jYXRpb25zLmZsYXQoSW5maW5pdHkpO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpXTtcclxuICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKyAxXTtcclxuICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdO1xyXG4gICAgICAgIGlmIChidWYpIHtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShidWYuYnVmZmVyLCBidWYuYnl0ZU9mZnNldCwgYnVmLmJ5dGVMZW5ndGggLyA4KTtcclxuICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGggLyAyOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpICogMl07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBUaGUgd3JpdGUgaGFsZiBvZiBhIHZpc2liaWxpdHkgdG9nZ2xlOiBvbmUgY3VzdG9tIG1lc3NhZ2UgbmFtaW5nIHRoZSBmbGlwcGVkIGlkcyxcclxuLy8gaW5zdGVhZCBvZiB0aGUgd2hvbGUgbGF5ZXJzIHRyYWl0LiBQeXRob24gYXBwbGllcyB0aGUgZmllbGRzIGFuZCByZS1lbWl0cyB0aGVtIGFzXHJcbi8vIGBzZXRgIHBhdGNoIG9wcywgd2hpY2ggaXMgaG93IG90aGVyIHZpZXdzIG9mIHRoZSBzYW1lIG1hcCAobm90ZWJvb2sgb3V0cHV0cykgc3RheVxyXG4vLyBpbiBzdGVwIG5vdyB0aGF0IHRoZSB0cmFpdCBubyBsb25nZXIgY2FycmllcyB0b2dnbGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gc2VuZExheWVyV3JpdGUobW9kZWwsIGNoYW5nZXMpIHtcclxuICAgIGlmICghY2hhbmdlcy5sZW5ndGgpIHJldHVybjtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgbW9kZWwuc2VuZCh7XHJcbiAgICAgICAgICAgIGtpbmQ6IFwic3dpZnRtYXBfd3JpdGVcIixcclxuICAgICAgICAgICAgb3BzOiBjaGFuZ2VzLm1hcChjID0+ICh7IG9wOiBcInNldFwiLCBpZDogYy5pZCwgZmllbGRzOiB7IHZpc2libGU6IGMudmlzaWJsZSB9IH0pKSxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSByZW5kZXJlZCBsaXN0IGFscmVhZHkgaG9sZHMgdGhlIGNoYW5nZSAqLyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZXBvcnRzIHdoYXQgaXQgY2hhbmdlZCAtLSB7Y2hhbmdlczogW3tpZCwgdmlzaWJsZX1dLCBncm91cHNDaGFuZ2VkfSAtLSBzbyB0aGVcclxuICAgIC8vIGNhbGxlciBjYW4gd3JpdGUgYmFjayBleGFjdGx5IHRob3NlIGZsaXBzIHJhdGhlciB0aGFuIHRoZSB3aG9sZSBsYXllcnMgbGlzdC5cclxuICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgIGxldCBncm91cHNDaGFuZ2VkID0gZmFsc2U7XHJcbiAgICBmdW5jdGlvbiBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUpIHtcclxuICAgICAgICBjb25zdCBjb25mID0gZ3JvdXBDb25maWdzW25vZGUucGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc1JhZGlvR3JvdXAgPSBjb25mLm11bHRpX3NlbGVjdCA9PT0gZmFsc2U7XHJcbiAgICAgICAgaWYgKGlzUmFkaW9Hcm91cCkge1xyXG4gICAgICAgICAgICBsZXQgZm91bmRBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRHcm91cCA9IG5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBzQ2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGx5ci52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZTogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlLmNoaWxkcmVuW2tleV0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyh0cmVlKTtcclxuICAgIHJldHVybiB7IGNoYW5nZXMsIGdyb3Vwc0NoYW5nZWQgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZsaXBwZWQgb24gdGhlIGxpc3QgdGhpcyBzaWRlYmFyIHJlbmRlcmVkIGZyb20sIG5ldmVyIG1vZGVsLmdldChcImxheWVyc1wiKS5cclxuICAgICAgICAgICAgICAgIC8vIExheWVycyBhZGRlZCBhZnRlciB0aGUgd2lkZ2V0IGlzIGRpc3BsYXllZCBhcnJpdmUgYXMgcGF0Y2hlcyB0aGF0IHVwZGF0ZSB0aGVcclxuICAgICAgICAgICAgICAgIC8vIGZyb250ZW5kJ3MgbG9jYWwgc3RhdGUgd2l0aG91dCB0b3VjaGluZyB0aGUgdHJhaXQsIHNvIHRoZSBtb2RlbCdzIGNvcHkgaXNcclxuICAgICAgICAgICAgICAgIC8vIGZyb3plbiBhdCB3aGF0ZXZlciB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGNhcnJpZWQuIEJ1aWxkaW5nIHRoZSB1cGRhdGUgZnJvbVxyXG4gICAgICAgICAgICAgICAgLy8gaXQgZHJvcHMgZXZlcnkgbGF0ZXIgbGF5ZXI6IHRoZSB0b2dnbGUgbWF0Y2hlcyBubyBpZCwgd3JpdGVzIHRoZSBzdGFsZSBsaXN0XHJcbiAgICAgICAgICAgICAgICAvLyBiYWNrLCBhbmQgdGhlIGNoYW5nZSBoYW5kbGVyIHRoZW4gcmVzZXRzIGxvY2FsIHN0YXRlIHRvIGl0IC0tIHNvIHRoZSBib3hcclxuICAgICAgICAgICAgICAgIC8vIHJlLWNoZWNrcyBpdHNlbGYgYW5kIHRoZSBsYXllciBuZXZlciBoaWRlcy5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgZmxpcHMgbXV0YXRlIHRoZSByZW5kZXJlZCBsaXN0IGluIHBsYWNlIGFuZCByZWFjaCBQeXRob24gYXMgYSB0YXJnZXRlZFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUgKHNlbmRMYXllcldyaXRlKSwgbmV2ZXIgYnkgc2V0dGluZyB0aGUgbGF5ZXJzIHRyYWl0OiB0aGUgZnVsbFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUtYmFjayBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlIGNsaWNrLiBBdCAyNSB0cmFja3MgeCAyMDBrXHJcbiAgICAgICAgICAgICAgICAvLyB2ZXJ0aWNlcyBpdCB3YXMgYSAzNiBNQiBmcmFtZSAtLSBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0IHdlYnNvY2tldFxyXG4gICAgICAgICAgICAgICAgLy8gY2FwLCBzbyB0aGUgc2VydmVyIGNsb3NlZCB0aGUgY29ubmVjdGlvbiBhbmQgdGhlIFNoaW55IHNlc3Npb24gZGllZCBvblxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGNoZWNrYm94LiBTZXR0aW5nIHRoZSB0cmFpdCB3aXRob3V0IHNhdmluZyBpcyBqdXN0IGFzIGZhdGFsOlxyXG4gICAgICAgICAgICAgICAgLy8gaXQgc3RheXMgZGlydHkgYW5kIHRoZSBuZXh0IHNhdmVfY2hhbmdlcyAoYW55IHBhbikgZmx1c2hlcyBpdC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZsaXAgPSAobHlyLCB2aXNpYmxlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKChseXIudmlzaWJsZSAhPT0gZmFsc2UpID09PSB2aXNpYmxlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSB2aXNpYmxlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGUgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGlvIGJ1dHRvbiBsb2dpYzogc2V0IGFsbCBzaWJsaW5ncyB0byB2aXNpYmxlPWZhbHNlLCBhbmQgdGhpcyB0byB2aXNpYmxlPXRydWVcclxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYkdyb3VwID0gcGFyZW50Tm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBzaWJHcm91cC5wYXRoID09PSBwYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbc2liR3JvdXAucGF0aF0gPSAhYWN0aXZlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IGZsaXAoc2liTHlyLCBzaWJMeXIuaWQgPT09IGlkKSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3BhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBseXIgPSBsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGx5cikgZmxpcChseXIsIGlzQ2hlY2tlZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCBjaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIC8vIGdyb3VwX2NvbmZpZ3Mgc3RheXMgb24gdGhlIHRyYWl0OiBpdCBpcyBhIGhhbmRmdWwgb2YgZm9sZGVyIGZsYWdzLCBhbmQgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyBzcHJlYWQgZ2l2ZXMgQmFja2JvbmUgYSBmcmVzaCByZWZlcmVuY2Ugc28gdGhlIGluLXBsYWNlIGVkaXRzIHJlZ2lzdGVyLlxyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0NoZWNrZWQgJiYgbWFwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYm91bmRzID0gZ2V0TGF5ZXJCb3VuZHMobm9kZSwgbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYm91bmRzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBvbkxheWVyVG9nZ2xlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQobm9kZURpdik7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVuZGVyIHRyZWUgZnJvbSByb290IG5vZGVcclxuICAgIHJlbmRlck5vZGUodHJlZSwgc2lkZWJhciwgMCwgbnVsbCwgdHJ1ZSk7XHJcbn1cclxuIiwgIi8vIFRoZSBsZWdlbmQ6IGRlcml2ZWQgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSBldmVyeXRoaW5nIGVsc2UgcmVuZGVycyBmcm9tLCB3aXRoXG4vLyBkZWNsYXJhdGl2ZSBvdmVycmlkZXMgb24gdG9wLiBEZWxpYmVyYXRlbHkgbW9kZWwtZnJlZSAtLSBwdXJlIGRhdGEgaW4sIERPTSBvdXQgLS1cbi8vIHNvIGEgcGxhaW4tSlMgY29uc3VtZXIgb2YgZGlzdC9pbmRleC5qcyBnZXRzIHRoZSB3aG9sZSBmZWF0dXJlLCBhbmQgdGhlIGFueXdpZGdldFxuLy8gZ2x1ZSBpbiBtYXAuanMgaXMgYSBmZXcgbGluZXMuIChzaWRlYmFyLmpzIHN0aWxsIHRha2VzIGBtb2RlbGAgYW5kIGlzIGZpbGVkIGZvclxuLy8gZXh0cmFjdGlvbjsgdGhpcyBtb2R1bGUgbXVzdCBuZXZlciBuZWVkIHRoYXQgdW5waWNraW5nLilcbi8vXG4vLyBUaGUgcGlwZWxpbmU6IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykgd2Fsa3MgdGhlIGxheWVycyBpbnRvXG4vLyBlbnRyaWVzIChza2lwcGVkIGVudGlyZWx5IHdoZW4gY29uZmlnLmF1dG8gPT09IGZhbHNlKSwgYXBwbGllcyB0aGUgcGVyc2lzdGVudFxuLy8gcmVtb3ZlLW1hdGNoZXJzLCBhcHBlbmRzIHRoZSBtYW51YWwgYWRkcywgYW5kIHJldHVybnMgYSBzcGVjIHRoYXQgcmVuZGVyTGVnZW5kXG4vLyB0dXJucyBpbnRvIERPTS4gTm90aGluZyBoZXJlIGtub3dzIGFib3V0IGNvbG9ybWFwczogcmFtcC9jYXRlZ29yeS9iaW4gZW50cmllc1xuLy8gYXJyaXZlIHdpdGggdGhlaXIgY29sb3VycyBhbHJlYWR5IHJlc29sdmVkIChQeXRob24gcmVzb2x2ZXMgYXQgdGhlIGFkZF8qIGJvdW5kYXJ5LFxuLy8gbWFudWFsIGVudHJpZXMgYXQgbGVnZW5kX2FkZCksIHNvIHRoZXJlIGlzIG5vIGFuY2hvciB0YWJsZSB0byBkcmlmdC5cblxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9tYXAuanNcIjtcblxuY29uc3QgR0xZUEhTID0ge1xuICAgIGNpcmNsZV9tYXJrZXJzOiBcImNpcmNsZVwiLFxuICAgIG1hcmtlcnM6IFwicGluXCIsXG4gICAgcG9seWxpbmU6IFwibGluZVwiLFxuICAgIHBvbHlnb246IFwicG9seWdvblwiLFxuICAgIGNpcmNsZTogXCJjaXJjbGVcIixcbn07XG5cbmZ1bmN0aW9uIHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiBcInN3YXRjaFwiLFxuICAgICAgICBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsXG4gICAgICAgIHNoYXBlOiBHTFlQSFNbbGF5ZXIudHlwZV0gfHwgXCJzcXVhcmVcIixcbiAgICAgICAgY29sb3I6IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBmaWxsQ29sb3I6IGxheWVyLmZpbGxDb2xvciB8fCBsYXllci5maWxsX2NvbG9yIHx8IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBoaWRkZW4sXG4gICAgfTtcbn1cblxuLy8gQSBkYXRhLWRyaXZlbiBibG9jayByZWNvcmRlZCBhdCBhZGQgdGltZSAoe2tpbmQsIGFuY2hvcnN8aXRlbXN8ZWRnZXMrY29sb3JzLCAuLi59KVxuLy8gYmVjb21lcyB0aGUgbGF5ZXIncyBlbnRyeSBhcy1pczsgdGhlIGxheWVyIG9ubHkgY29udHJpYnV0ZXMgbGFiZWwgYW5kIHZpc2liaWxpdHkuXG5mdW5jdGlvbiBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4geyAuLi5sYXllci5sZWdlbmQsIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIiwgaGlkZGVuIH07XG59XG5cbmZ1bmN0aW9uIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSByZXR1cm4gW107XG4gICAgY29uc3QgaGlkZGVuID0gIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgLy8gQSBjb2xsZWN0aW9uOiBvbmUgZW50cnkgcGVyIGdlb21ldHJ5IHBhcnQsIHNhbWUgbGFiZWwgYnkgZGVzaWduIC0tIHRoZVxuICAgICAgICAvLyBnbHlwaHMgYXJlIHdoYXQgdGVsbCB0aGVtIGFwYXJ0LCBtYXRjaGluZyBob3cgdGhlIHBhcnRzIHJlbmRlci5cbiAgICAgICAgcmV0dXJuIChsYXllci5sYXllcnMgfHwgW10pXG4gICAgICAgICAgICAuZmlsdGVyKHN1YiA9PiBHTFlQSFNbc3ViLnR5cGVdKVxuICAgICAgICAgICAgLm1hcChzdWIgPT4gc3ViLmxlZ2VuZFxuICAgICAgICAgICAgICAgID8gYmxvY2tFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pKTtcbiAgICB9XG4gICAgaWYgKCFHTFlQSFNbbGF5ZXIudHlwZV0pIHJldHVybiBbXTtcbiAgICBjb25zdCBlbnRyaWVzID0gW2xheWVyLmxlZ2VuZCA/IGJsb2NrRW50cnkobGF5ZXIsIGhpZGRlbikgOiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKV07XG4gICAgLy8gcmFkaXVzX2NvbCByZWNvcmRzIGEgc2l6ZSBrZXkgYmVzaWRlIHRoZSBjb2xvdXIgc3Rvcnk6IGJvdGggZW5jb2RpbmdzIG9uIHRoZVxuICAgIC8vIG1hcCBkZXNlcnZlIGJvdGggZXhwbGFuYXRpb25zIGluIHRoZSBsZWdlbmQuXG4gICAgaWYgKGxheWVyLmxlZ2VuZF9zaXplKSB7XG4gICAgICAgIGVudHJpZXMucHVzaCh7IC4uLmxheWVyLmxlZ2VuZF9zaXplLFxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogbGF5ZXIubGVnZW5kX3NpemUuZmllbGQgfHwgbGF5ZXIubmFtZSB8fCBcIlNpemVcIiwgaGlkZGVuIH0pO1xuICAgIH1cbiAgICByZXR1cm4gZW50cmllcztcbn1cblxuLy8gSWRlbnRpY2FsIGRhdGEtZHJpdmVuIHBheWxvYWRzIGNvbGxhcHNlIGludG8gb25lIHJvdy4gR3JvdXBpbmcgcG9pbnRzIGJ5IGEgY29sdW1uXG4vLyBnaXZlcyBldmVyeSBzdWItbGF5ZXIgdGhlIHNhbWUgcmFtcDsgYSByYW1wIHBlciBzdWItbGF5ZXIgaXMgbm9pc2UsIGFuZCB0aGUgZmllbGRcbi8vIG5hbWUgaXMgdGhlIGhvbmVzdCBsYWJlbCBmb3IgdGhlIHNoYXJlZCBtYXBwaW5nLiBUaGUgc3Vydml2b3Iga2VlcHMgdGhlIGZpcnN0XG4vLyBvY2N1cnJlbmNlJ3MgcG9zaXRpb24gYW5kIGhpZGVzIG9ubHkgd2hlbiBldmVyeSBjb250cmlidXRvciBpcyBoaWRkZW4uXG5mdW5jdGlvbiBwYXlsb2FkS2V5KGVudHJ5KSB7XG4gICAgLy8gSWRlbnRpdHkgZmllbGRzIHN0YXkgb3V0IG9mIHRoZSBrZXk6IHRoZSB3aG9sZSBwb2ludCBpcyB0aGF0IGVudHJpZXMgZnJvbVxuICAgIC8vIERJRkZFUkVOVCBsYXllcnMgY29sbGFwc2Ugd2hlbiB0aGVpciBtYXBwaW5nIHBheWxvYWQgaXMgdGhlIHNhbWUuXG4gICAgY29uc3QgeyBsYWJlbCwgaGlkZGVuLCBsYXllcklkLCBsYXllciwgZ3JvdXAsIC4uLnBheWxvYWQgfSA9IGVudHJ5O1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbn1cblxuZnVuY3Rpb24gZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKSB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBNYXAoKTsgICAvLyBwYXlsb2FkIGtleSAtPiBzdXJ2aXZpbmcgZW50cnlcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoZW50cnkgPT4ge1xuICAgICAgICAgICAgaWYgKGVudHJ5LmtpbmQgPT09IFwic3dhdGNoXCIpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGF5bG9hZEtleShlbnRyeSk7XG4gICAgICAgICAgICBjb25zdCBzdXJ2aXZvciA9IHNlZW4uZ2V0KGtleSk7XG4gICAgICAgICAgICBpZiAoIXN1cnZpdm9yKSB7XG4gICAgICAgICAgICAgICAgc2Vlbi5zZXQoa2V5LCBlbnRyeSk7XG4gICAgICAgICAgICAgICAgaWYgKGVudHJ5LmZpZWxkKSBlbnRyeS5sYWJlbCA9IGVudHJ5LmZpZWxkO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3Vydml2b3IuaGlkZGVuID0gc3Vydml2b3IuaGlkZGVuICYmIGVudHJ5LmhpZGRlbjtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBncm91cHM7XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXJIaXRzKG1hdGNoZXIsIGVudHJ5LCBncm91cE5hbWUpIHtcbiAgICBpZiAoIW1hdGNoZXIpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgY29uc3RyYWluZWQgPSBmYWxzZTtcbiAgICBpZiAobWF0Y2hlci5sYWJlbCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKGVudHJ5LmxhYmVsICE9PSBtYXRjaGVyLmxhYmVsKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmdyb3VwICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZ3JvdXBOYW1lICE9PSBtYXRjaGVyLmdyb3VwKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmlkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZW50cnkubGF5ZXJJZCAhPT0gbWF0Y2hlci5pZCkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gY29uc3RyYWluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHtcbiAgICBjb25zdCBjZmcgPSBjb25maWcgfHwge307XG4gICAgY29uc3QgZ3JvdXBzID0gW107XG4gICAgY29uc3QgYnlOYW1lID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGdyb3VwRm9yID0gbmFtZSA9PiB7XG4gICAgICAgIGlmICghYnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IG5hbWUsIGVudHJpZXM6IFtdIH07XG4gICAgICAgICAgICBieU5hbWUuc2V0KG5hbWUsIGdyb3VwKTtcbiAgICAgICAgICAgIGdyb3Vwcy5wdXNoKGdyb3VwKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYnlOYW1lLmdldChuYW1lKTtcbiAgICB9O1xuXG4gICAgaWYgKGNmZy5hdXRvICE9PSBmYWxzZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIHtcbiAgICAgICAgICAgICAgICBlbnRyeS5sYXllcklkID0gbGF5ZXIuaWQ7XG4gICAgICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBncm91cEZvcihsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcyk7XG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzdXBwcmVzc2lvbjogbWF0Y2hlcnMgb3V0bGl2ZSBldmVyeSByZS1kZXJpdmF0aW9uLCB3aGljaCBpcyB0aGVcbiAgICAvLyBkaWZmZXJlbmNlIGZyb20gYSByZWdpc3RyeSByZW1vdmUgdGhhdCB0aGUgbmV4dCBhZGQgd291bGQganVzdCByZXBvcHVsYXRlLlxuICAgIGNvbnN0IHJlbW92ZXMgPSBjZmcucmVtb3ZlIHx8IFtdO1xuICAgIGlmIChyZW1vdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICBlbnRyeSA9PiAhcmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGdyb3VwLm5hbWUpKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYW51YWwgZW50cmllczogdGhlIHVzZXIncyBvd24gY2xhaW1zLiBzY29wZSBuZXZlciBkcm9wcyB0aGVtOyBhIGBsYXllcmBcbiAgICAvLyBiaW5kaW5nIG1ha2VzIG9uZSBmb2xsb3cgYSBsaXZlIGxheWVyJ3MgdmlzaWJpbGl0eSAoYW5kIHZhbmlzaCB3aXRoIGl0IHVuZGVyXG4gICAgLy8gc2NvcGUgXCJ2aXNpYmxlXCIpLCBmb3Igd2hlbiBhIG1hbnVhbCByb3cgaXMgcmVhbGx5IGEgcmVsYWJlbGxpbmcuXG4gICAgZm9yIChjb25zdCBhZGRlZCBvZiBjZmcuYWRkIHx8IFtdKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0geyBoaWRkZW46IGZhbHNlLCAuLi5hZGRlZCB9O1xuICAgICAgICBpZiAoZW50cnkubGF5ZXIgIT0gbnVsbCkge1xuICAgICAgICAgICAgY29uc3QgYm91bmQgPSAobGF5ZXJzIHx8IFtdKS5maW5kKFxuICAgICAgICAgICAgICAgIGwgPT4gbC5pZCA9PT0gZW50cnkubGF5ZXIgfHwgbC5uYW1lID09PSBlbnRyeS5sYXllcik7XG4gICAgICAgICAgICBlbnRyeS5oaWRkZW4gPSAhYm91bmQgfHwgIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGJvdW5kLCBncm91cENvbmZpZ3MgfHwge30pO1xuICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGVudHJ5Lmdyb3VwIHx8IFwiXCIpKSkgY29udGludWU7XG4gICAgICAgIGdyb3VwRm9yKGVudHJ5Lmdyb3VwIHx8IFwiXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XG4gICAgfVxuXG4gICAgY29uc3QgcG9wdWxhdGVkID0gZ3JvdXBzLmZpbHRlcihnID0+IGcuZW50cmllcy5sZW5ndGggPiAwKTtcbiAgICByZXR1cm4geyB0aXRsZTogY2ZnLnRpdGxlIHx8IFwiTGVnZW5kXCIsIGdyb3VwczogcG9wdWxhdGVkIH07XG59XG5cbi8vIC0tLSByZW5kZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBET00gYnVpbHQgd2l0aCBjcmVhdGVFbGVtZW50L3RleHRDb250ZW50IHRocm91Z2hvdXQ6IGxhYmVscyBhbmQgY2F0ZWdvcnkgdmFsdWVzIGNvbWVcbi8vIGZyb20gdXNlciBkYXRhIGFuZCBtdXN0IG5ldmVyIGJlIHBhcnNlZCBhcyBIVE1MLlxuXG5mdW5jdGlvbiBkaXYoc3R5bGVzLCB0ZXh0KSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlcyk7XG4gICAgaWYgKHRleHQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gZ2x5cGgoZW50cnkpIHtcbiAgICBpZiAoZW50cnkuc2hhcGUgPT09IFwibGluZVwiKSB7XG4gICAgICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIyMHB4XCIsIGhlaWdodDogXCI0cHhcIiwgYmFja2dyb3VuZDogZW50cnkuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIgfSk7XG4gICAgfVxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJwaW5cIikge1xuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBlbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XG4gICAgICAgIGVsLnN0eWxlLmZsZXggPSBcIm5vbmVcIjtcbiAgICAgICAgY29uc3Qgc3ZnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJzdmdcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBcIjEyXCIpO1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMTRcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIsIFwiMCAwIDI0IDI4XCIpO1xuICAgICAgICBjb25zdCBwYXRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJwYXRoXCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImRcIixcbiAgICAgICAgICAgIFwiTTEyIDBDNS40IDAgMCA1LjQgMCAxMmMwIDkgMTIgMTYgMTIgMTZzMTItNyAxMi0xNkMyNCA1LjQgMTguNiAwIDEyIDB6XCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImZpbGxcIiwgZW50cnkuY29sb3IpO1xuICAgICAgICBzdmcuYXBwZW5kQ2hpbGQocGF0aCk7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKHN2Zyk7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgLy8gY2lyY2xlIC8gcG9seWdvbiAvIHNxdWFyZTogZmlsbCBpbnNpZGUgYSBib3JkZXIsIHdoaWNoIGlzIGhvdyBhcmVhcyBkcmF3LlxuICAgIGNvbnN0IHJhZGl1cyA9IGVudHJ5LnNoYXBlID09PSBcImNpcmNsZVwiID8gXCI1MCVcIlxuICAgICAgICA6IGVudHJ5LnNoYXBlID09PSBcInBvbHlnb25cIiA/IFwiMnB4XCIgOiBcIjBcIjtcbiAgICByZXR1cm4gZGl2KHsgd2lkdGg6IFwiMTJweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5maWxsQ29sb3IsXG4gICAgICAgICAgICAgICAgIGJvcmRlcjogYDJweCBzb2xpZCAke2VudHJ5LmNvbG9yfWAsIGJvcmRlclJhZGl1czogcmFkaXVzLFxuICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGJveFNpemluZzogXCJib3JkZXItYm94XCIgfSk7XG59XG5cbmZ1bmN0aW9uIHJhbXBSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBzdG9wcyA9IChlbnRyeS5hbmNob3JzIHx8IFtdKS5tYXAoKGNvbG9yLCBpLCBhbGwpID0+XG4gICAgICAgIGAke2NvbG9yfSAke2FsbC5sZW5ndGggPiAxID8gKGkgLyAoYWxsLmxlbmd0aCAtIDEpKSAqIDEwMCA6IDB9JWApO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe1xuICAgICAgICB3aWR0aDogXCIxMjBweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBib3JkZXJSYWRpdXM6IFwiMnB4XCIsXG4gICAgICAgIGJhY2tncm91bmRJbWFnZTogYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWAsXG4gICAgfSkpO1xuICAgIGNvbnN0IGVuZHMgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwganVzdGlmeUNvbnRlbnQ6IFwic3BhY2UtYmV0d2VlblwiLCB3aWR0aDogXCIxMjBweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICBmb250U2l6ZTogXCIxMXB4XCIsIGNvbG9yOiBcIiM1NTVcIiB9KTtcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtaW4pKSk7XG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhlbnRyeS52bWF4KSkpO1xuICAgIHJvdy5hcHBlbmRDaGlsZChlbmRzKTtcbiAgICByZXR1cm4gcm93O1xufVxuXG5jb25zdCBNQVhfQ0FURUdPUllfUk9XUyA9IDEyO1xuXG5mdW5jdGlvbiBjYXRlZ29yaWVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XG4gICAgY29uc3QgaXRlbXMgPSBlbnRyeS5pdGVtcyB8fCBbXTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMuc2xpY2UoMCwgTUFYX0NBVEVHT1JZX1JPV1MpKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvcjogaXRlbS5jb2xvciwgZmlsbENvbG9yOiBpdGVtLmNvbG9yIH0pKTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhpdGVtLnZhbHVlKSkpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XG4gICAgfVxuICAgIGlmIChpdGVtcy5sZW5ndGggPiBNQVhfQ0FURUdPUllfUk9XUykge1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luTGVmdDogXCI4cHhcIiwgbWFyZ2luVG9wOiBcIjNweFwiLCBjb2xvcjogXCIjNTU1XCIgfSxcbiAgICAgICAgICAgIGArICR7aXRlbXMubGVuZ3RoIC0gTUFYX0NBVEVHT1JZX1JPV1N9IG1vcmVgKSk7XG4gICAgfVxuICAgIHJldHVybiByb3c7XG59XG5cbmZ1bmN0aW9uIGJpbnNSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBlZGdlcyA9IGVudHJ5LmVkZ2VzIHx8IFtdO1xuICAgIGNvbnN0IGNvbG9ycyA9IGVudHJ5LmNvbG9ycyB8fCBbXTtcbiAgICBjb25zdCBsYWJlbEZvciA9IGkgPT4gaSA9PT0gMCA/IGA8ICR7ZWRnZXNbMF19YFxuICAgICAgICA6IGkgPT09IGVkZ2VzLmxlbmd0aCA/IGBcdTIyNjUgJHtlZGdlc1tlZGdlcy5sZW5ndGggLSAxXX1gXG4gICAgICAgIDogYCR7ZWRnZXNbaSAtIDFdfSBcdTIwMTMgJHtlZGdlc1tpXX1gO1xuICAgIGNvbG9ycy5mb3JFYWNoKChjb2xvciwgaSkgPT4ge1xuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmdpbkxlZnQ6IFwiOHB4XCIgfSk7XG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZ2x5cGgoeyBzaGFwZTogXCJzcXVhcmVcIiwgY29sb3IsIGZpbGxDb2xvcjogY29sb3IgfSkpO1xuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgbGFiZWxGb3IoaSkpKTtcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGxpbmUpO1xuICAgIH0pO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIEEgc2l6ZSBrZXkgaXMgYSBzdGF0ZW1lbnQsIG5vdCBhIGRyYXdpbmc6IFwiXHUyNUNGIHNpemUgXHUyMjFEIGZpZWxkIChtaW4gXHUyMDEzIG1heClcIi4gVGhlIGdseXBoXG4vLyBpcyBmaXhlZCBhbmQgbm90aGluZyBpbiB0aGUgcm93IGRlcml2ZXMgZnJvbSByYWRpdXNfcmFuZ2Ugb3IgdGhlIGRhdGEncyBzcHJlYWQgLS1cbi8vIGxlZ2VuZCBDU1MgcGl4ZWxzIGFyZSBub3QgbWFwIHBpeGVscyBhdCBhbnkgem9vbSwgc28gZHJhd24gc2FtcGxlIGNpcmNsZXMgd291bGRcbi8vIGFzc2VydCBhIHByZWNpc2lvbiB0aGF0IGRvZXMgbm90IGV4aXN0LiBUaGUgcm93IG5hbWVzIHRoZSBlbmNvZGluZyBhbmQgaXRzIGRvbWFpbi5cbmZ1bmN0aW9uIHNpemVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBjb2xvcjogXCIjNjY2XCIgfSwgXCJcdTI1Q0ZcIikpO1xuICAgIGNvbnN0IHJhbmdlID0gZW50cnkudm1pbiAhPSBudWxsICYmIGVudHJ5LnZtYXggIT0gbnVsbFxuICAgICAgICA/IGAgKCR7ZW50cnkudm1pbn0gXHUyMDEzICR7ZW50cnkudm1heH0pYCA6IFwiXCI7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgYHNpemUgXHUyMjFEICR7ZW50cnkuZmllbGQgfHwgZW50cnkubGFiZWx9JHtyYW5nZX1gKSk7XG4gICAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gc3dhdGNoUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZ2x5cGgoZW50cnkpKTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIENvbGxhcHNlIHN0YXRlLCBwZXIgY29udGFpbmVyIHJhdGhlciB0aGFuIG1vZHVsZSBzY29wZTogdGhlIHNpZGViYXIga2V5cyBpdHNcbi8vIGNvbGxhcHNlZFBhdGhzIGF0IG1vZHVsZSBsZXZlbCBhbmQgdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmUgaXQgLS0gYSBmaWxlZCBidWdcbi8vIHRoaXMgZGVsaWJlcmF0ZWx5IGRvZXMgbm90IGluaGVyaXQuIEtleWVkIGJ5IGdyb3VwIG5hbWUsIHN1cnZpdmluZyB0aGUgZnVsbFxuLy8gcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBjb250YWluZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICBjb25zdCBkaW1IaWRkZW4gPSBvcHRpb25zLmRpbUhpZGRlbiAhPT0gZmFsc2U7XG4gICAgbGV0IGNvbGxhcHNlZCA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xuICAgIGlmICghY29sbGFwc2VkKSB7XG4gICAgICAgIGNvbGxhcHNlZCA9IG5ldyBTZXQoKTtcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgY29sbGFwc2VkKTtcbiAgICB9XG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7XG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxuICAgICAgICBwYWRkaW5nQm90dG9tOiBcIjRweFwiLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIsXG4gICAgfSwgc3BlYy50aXRsZSkpO1xuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBzcGVjLmdyb3Vwcykge1xuICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGdyb3VwLm5hbWUgJiYgY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKTtcbiAgICAgICAgaWYgKGdyb3VwLm5hbWUpIHtcbiAgICAgICAgICAgIC8vIFRoZSBzaWRlYmFyJ3MgYWZmb3JkYW5jZSBleGFjdGx5OiBhbiBhcnJvdyB0aGF0IGZvbGRzIHRoZSBzZWN0aW9uLlxuICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gZGl2KHsgZm9udFdlaWdodDogXCJib2xkXCIsIG1hcmdpblRvcDogXCI2cHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsIHVzZXJTZWxlY3Q6IFwibm9uZVwiIH0pO1xuICAgICAgICAgICAgaGVhZGVyLnRleHRDb250ZW50ID0gYCR7aXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIn0gJHtncm91cC5uYW1lfWA7XG4gICAgICAgICAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKSkgY29sbGFwc2VkLmRlbGV0ZShncm91cC5uYW1lKTtcbiAgICAgICAgICAgICAgICBlbHNlIGNvbGxhcHNlZC5hZGQoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGNvbnRhaW5lciwgc3BlYywgb3B0aW9ucyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChoZWFkZXIpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChpc0NvbGxhcHNlZCkgY29udGludWU7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZ3JvdXAuZW50cmllcykge1xuICAgICAgICAgICAgY29uc3Qgcm93ID0gZW50cnkua2luZCA9PT0gXCJyYW1wXCIgPyByYW1wUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJiaW5zXCIgPyBiaW5zUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJzaXplc1wiID8gc2l6ZXNSb3coZW50cnkpXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hSb3coZW50cnkpO1xuICAgICAgICAgICAgLy8gRGltbWVkLCBub3QgZHJvcHBlZDogdW5kZXIgc2NvcGUgXCJhbGxcIiB0aGUgbGVnZW5kIGlzIHRoZSBtYXAncyB3aG9sZVxuICAgICAgICAgICAgLy8gdm9jYWJ1bGFyeSwgYW5kIHRoZSBkaW0gaXMgd2hhdCBzdGlsbCB0ZWxscyB0aGUgY3VycmVudCBzY3JlZW4gc3RhdGUuXG4gICAgICAgICAgICBpZiAoZW50cnkuaGlkZGVuICYmIGRpbUhpZGRlbikgcm93LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHJvdyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbn1cbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIC8vIFRoZSBmaXJzdCB0aWNrIHNpdHMgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBub3Qgb25lIHBlcmlvZCBhZnRlciBpdDogd2luZG93c1xuICAgIC8vIGFyZSBoYWxmLW9wZW4gKHN0YXJ0LCBlbmRdLCBzbyBhIGZpcnN0IHRpY2sgYXQgc3RhcnQrUCB3b3VsZCBleGNsdWRlIHRoZSBlYXJsaWVzdFxuICAgIC8vIHBvaW50IGZyb20gaXRzIG93biB3aW5kb3cgYW5kIGl0IHdvdWxkIG5ldmVyIGRpc3BsYXkgYXQgYW55IHRpY2suXG4gICAgY29uc3QgdGlja3MgPSBbc3RhcnRNc107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xuICAgICAgICB0aWNrcy5wdXNoKHQpO1xuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XG4gICAgcmV0dXJuIHRpY2tzO1xufVxuXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2Vcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgfVxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xufVxuXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xufVxuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG59XG5cbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cbi8vXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgLy8gQSBwZXItdmVydGV4LXRpbWVkIGxpbmUgaG9sZHMgbWFueSBwYWlyczsgb24gdGhpcyB3aG9sZS1sYXllciBwYXRoIGl0IHNob3dzXG4gICAgLy8gd2hpbGUgQU5ZIG9mIHRoZW0gaXMgaW4gdGhlIHdpbmRvdyAtLSB0aGUgR1BVIHBhdGggaXMgd2hhdCB0cmltcyBwZXIgc2VnbWVudC5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XG59XG5cbi8vIE9uZSBwbGF5YmFjayBzdGVwOiB0aGUgbmV4dCBpbmRleCBhbmQgd2hldGhlciBwbGF5YmFjayBzdXJ2aXZlcyBpdC4gUHVyZSBzbyB0aGUgbG9vcFxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxuLy8gd2l0aG91dCBsb29wIHN0b3BzIHdoZXJlIGl0IGlzLlxuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2UoaW5kZXgsIGxlbmd0aCwgbG9vcCkge1xuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcbiAgICBpZiAobG9vcCkgcmV0dXJuIHsgaW5kZXg6IDAsIHBsYXlpbmc6IHRydWUgfTtcbiAgICByZXR1cm4geyBpbmRleCwgcGxheWluZzogZmFsc2UgfTtcbn1cblxuLy8gV2hlcmUgdGhlIGNvbnRyb2wgc2l0cywgYXMgaW5saW5lIHN0eWxlcyBzbyB0aGUgY2hvaWNlIHRyYXZlbHMgd2l0aCB0aGUgc3RhdGUgcmF0aGVyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cbi8vIGluY2x1ZGluZyB0aGUgb25lcyBhIHBvc2l0aW9uIGRvZXMgbm90IHVzZSAtLSBzbyBtb3ZpbmcgdGhlIGNvbnRyb2wgY2xlYXJzIHRoZSBvbGRcbi8vIGFuY2hvciBpbnN0ZWFkIG9mIGFjY3VtdWxhdGluZyBib3RoLlxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcbiAgICBcInRvcC1sZWZ0XCI6ICAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJ0b3AtY2VudGVyXCI6ICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImxlZnQtY2VudGVyXCI6ICAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJyaWdodC1jZW50ZXJcIjogIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImJvdHRvbS1jZW50ZXJcIjogeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tcmlnaHRcIjogIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxufTtcblxuZnVuY3Rpb24gYXBwbHlQb3NpdGlvbihlbCwgcG9zaXRpb24pIHtcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XG4gICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN0eWxlcykpIHtcbiAgICAgICAgZWwuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XG59XG5cbi8vIC0tLSB0aGUgd2luZG93IGFuZCB0aGUgcnVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gRml4ZWQgbWlsbGlzZWNvbmRzIGZvciBhIHBlcmlvZCwgb3IgbnVsbCB3aGVuIGl0IG1vdmVzIHRocm91Z2ggdGhlIGNhbGVuZGFyIChtb250aHMsXG4vLyB5ZWFycykgYW5kIGhhcyBubyBmaXhlZCB3aWR0aC4gVGhlIHJ1bGVyIGFuZCB0aGUgZHJhZyBncmlkIG5lZWQgZml4ZWQgd2lkdGhzOyBjYWxlbmRhclxuLy8gcGVyaW9kcyBmYWxsIGJhY2sgdG8gdGhlIHRpY2sgcG9zaXRpb25zIHRoZW1zZWx2ZXMuXG5leHBvcnQgZnVuY3Rpb24gcGVyaW9kVG9NcyhwKSB7XG4gICAgaWYgKCFwIHx8IHAueWVhcnMgfHwgcC5tb250aHMpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMCArIHAuaG91cnMgKiAzNjAwXG4gICAgICAgICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMDtcbn1cblxuLy8gTWlsbGlzZWNvbmRzIGFzIGFuIElTTzg2MDEgZHVyYXRpb24sIGhvdXJzL21pbnV0ZXMvc2Vjb25kcyBvbmx5IC0tIFBUMjZIIGlzIHZhbGlkIGFuZFxuLy8gYXZvaWRzIGNhbGVuZGFyIHVuaXRzIGVudGlyZWx5LCBzbyB3aGF0IHRoZSBkcmFnIHdyaXRlcyBhbHdheXMgcGFyc2VzIGJhY2sgZXhhY3RseS5cbmV4cG9ydCBmdW5jdGlvbiBtc1RvUGVyaW9kSVNPKG1zKSB7XG4gICAgbGV0IHJlc3QgPSBNYXRoLnJvdW5kKG1zIC8gMTAwMCk7XG4gICAgY29uc3QgaCA9IE1hdGguZmxvb3IocmVzdCAvIDM2MDApOyByZXN0IC09IGggKiAzNjAwO1xuICAgIGNvbnN0IG0gPSBNYXRoLmZsb29yKHJlc3QgLyA2MCk7IHJlc3QgLT0gbSAqIDYwO1xuICAgIGxldCBvdXQgPSBcIlBUXCI7XG4gICAgaWYgKGgpIG91dCArPSBgJHtofUhgO1xuICAgIGlmIChtKSBvdXQgKz0gYCR7bX1NYDtcbiAgICBpZiAocmVzdCB8fCBvdXQgPT09IFwiUFRcIikgb3V0ICs9IGAke3Jlc3R9U2A7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gVGhlIHJ1bGVyJ3MgaW5jcmVtZW50OiB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gZXZlcnkgYm91bmRhcnkgdGhlIHVzZXIgY2FuIGNhcmVcbi8vIGFib3V0IC0tIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZCBkdXJhdGlvbi4gQW4gaW50ZXJ2YWwgb2YgMWggd2l0aCBhXG4vLyAyLjVoIGR1cmF0aW9uIG5lZWRzIDMwLW1pbnV0ZSBtYXJrcyBmb3IgdGhlIGR1cmF0aW9uIHRvIHNpdCBvbiBvbmU7IDFoIGFuZCAyaCBuZWVkIG9ubHlcbi8vIHRoZSBob3Vycy4gXCJMb3dlc3QgZHVyYXRpb25cIiBpcyB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIG9uZSBkaXZpZGVzIHRoZSBvdGhlci5cbmV4cG9ydCBmdW5jdGlvbiBnY2RHcmlkTXMocGVyaW9kTXMsIGR1cmF0aW9uc01zKSB7XG4gICAgY29uc3QgZ2NkID0gKGEsIGIpID0+IChiID8gZ2NkKGIsIGEgJSBiKSA6IGEpO1xuICAgIGxldCBncmlkID0gcGVyaW9kTXM7XG4gICAgZm9yIChjb25zdCBkIG9mIGR1cmF0aW9uc01zKSB7XG4gICAgICAgIGlmIChkID4gMCkgZ3JpZCA9IGdjZChncmlkLCBNYXRoLnJvdW5kKGQpKTtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgubWF4KGdyaWQsIDEwMDApO1xufVxuXG4vLyBFdmVyeSBmaW5pdGUgZHVyYXRpb24gYXR0YWNoZWQgdG8gYSB0aW1lIGxheWVyLCBpbiBtcywgZm9yIHRoZSBncmlkLiBcInBlcmlvZFwiIGFuZCBudWxsXG4vLyBjb250cmlidXRlIG5vdGhpbmcgbmV3OyBjYWxlbmRhciBkdXJhdGlvbnMgY2Fubm90IGpvaW4gYSBmaXhlZC1tcyBncmlkIGFuZCBhcmUgc2tpcHBlZC5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJzLCB3aW5kb3dJc28pIHtcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBjb25zdCB2aXNpdCA9IGxpc3QgPT4gbGlzdC5mb3JFYWNoKGwgPT4ge1xuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsLmxheWVycyB8fCBbXSk7XG4gICAgICAgIGNvbnN0IHNwZWMgPSBsLnRpbWUgJiYgbC50aW1lLmR1cmF0aW9uO1xuICAgICAgICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgJiYgc3BlYyAhPT0gXCJwZXJpb2RcIikge1xuICAgICAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcbiAgICAgICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdmlzaXQobGF5ZXJzKTtcbiAgICBpZiAod2luZG93SXNvKSB7XG4gICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh3aW5kb3dJc28pKTtcbiAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFRpY2sgbWFya3MgZm9yIHRoZSB0cmFjazogbWFqb3JzIGF0IGV2ZXJ5IGludGVydmFsIGJvdW5kYXJ5IChzcGFyc2VseSBsYWJlbGxlZCBzbyBsb25nXG4vLyB0aW1lbGluZXMgc3RheSByZWFkYWJsZSksIHVubGFiZWxsZWQgbWlub3JzIGF0IHRoZSBncmlkIGluIGJldHdlZW4uIE1pbm9yIERJU1BMQVkgaXNcbi8vIHRoaW5uZWQgd2hlbiBkZW5zZTsgdGhlIHNuYXAgZ3JpZCBzdGF5cyBleGFjdCwgc28gYSBtYXJrIGlzIGEgZ3VpZGUsIG5vdCBhIGNvbnN0cmFpbnQuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSdWxlcih0aWNrcywgZ3JpZE1zLCBmb3JtYXRMYWJlbCwgeyBtYXhMYWJlbHMgPSA2LCBtYXhNaW5vcnMgPSAyNDAgfSA9IHt9KSB7XG4gICAgaWYgKHRpY2tzLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcbiAgICBjb25zdCB0MCA9IHRpY2tzWzBdLCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcbiAgICBjb25zdCBtYXJrcyA9IFtdO1xuICAgIGNvbnN0IGxhYmVsRXZlcnkgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodGlja3MubGVuZ3RoIC8gbWF4TGFiZWxzKSk7XG4gICAgdGlja3MuZm9yRWFjaCgodCwgaSkgPT4gbWFya3MucHVzaCh7XG4gICAgICAgIGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiB0cnVlLFxuICAgICAgICBsYWJlbDogaSAlIGxhYmVsRXZlcnkgPT09IDAgPyBmb3JtYXRMYWJlbCh0KSA6IG51bGwsXG4gICAgfSkpO1xuICAgIGlmIChncmlkTXMgJiYgZ3JpZE1zIDwgc3Bhbikge1xuICAgICAgICBjb25zdCB0b3RhbCA9IE1hdGguZmxvb3Ioc3BhbiAvIGdyaWRNcyk7XG4gICAgICAgIGNvbnN0IHRoaW4gPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodG90YWwgLyBtYXhNaW5vcnMpKTtcbiAgICAgICAgZm9yIChsZXQgayA9IDE7IGsgKiBncmlkTXMgPCBzcGFuOyBrICs9IHRoaW4pIHtcbiAgICAgICAgICAgIGNvbnN0IHQgPSB0MCArIGsgKiBncmlkTXM7XG4gICAgICAgICAgICBpZiAodGlja3MuaW5jbHVkZXModCkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgbWFya3MucHVzaCh7IGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiBmYWxzZSwgbGFiZWw6IG51bGwgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG1hcmtzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGlja0xhYmVsKG1zLCBwZXJpb2RNcykge1xuICAgIGNvbnN0IGlzbyA9IG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpO1xuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgNjAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxOSk7XG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCAyNCAqIDM2MDAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxNik7XG4gICAgcmV0dXJuIGlzby5zbGljZSg1LCAxMCk7XG59XG5cbi8vIEdseXBocyBhcyBpbmxpbmUgU1ZHIHJhdGhlciB0aGFuIHRleHQ6IFwiXHUyMUJCXCIgcmVhZHMgYXMgcmVmcmVzaCAtLSBhIGxvb3AgdG9nZ2xlIGRyYXduIHdpdGhcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xuLy8gdGhlIHByZXNzZWQgc3RhdGUgcmVzdHlsZSB0aGVtIGZyb20gQ1NTLlxuY29uc3QgSUNPTlMgPSB7XG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcbiAgICBwbGF5OiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAybDkgNi05IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGF1c2U6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJoM3YxMkg0ek05IDJoM3YxMkg5elwiLz48L3N2Zz4nLFxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXG4gICAgbG9vcDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTggMmE2IDYgMCAwIDEgNS42NSA0SDE2bC0yLjggMy41TDEwLjQgNmgyLjFBNC41IDQuNSAwIDEgMCAxMi41IDEwbDEuMy43NUE2IDYgMCAxIDEgOCAyelwiLz48L3N2Zz4nLFxufTtcblxuLy8gLS0tIHRoZSBjb250cm9sIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQbGFpbiBET00gaW5zaWRlIHRoZSB3aWRnZXQgY29udGFpbmVyLCBsaWtlIHRoZSBzaWRlYmFyOiBubyBMZWFmbGV0IGNvbnRyb2wgbWFjaGluZXJ5LFxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xuLy8gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MgY29udHJvbCAtLSBzdGVwL3BsYXkvc3RlcC9sb29wIGFzIGEgam9pbmVkIGJ1dHRvbiBiYXIsIHRoZW4gdGhlXG4vLyBkYXRlLCBzbGlkZXIgYW5kIHNwZWVkIC0tIHNpbmNlIHRoYXQgaXMgdGhlIHNsaWRlciB1c2VycyBvZiB0aGUgZm9saXVtIGFwcHMga25vdy5cbi8vXG4vLyBUaGUgc2xpZGVyIGlzIGEgY29tcG9zaXRlLiBBIG5hdGl2ZSA8aW5wdXQgdHlwZT1yYW5nZT4gc3RheXMgb24gdG9wIGFzIHRoZSB0aHVtYjogaXRcbi8vIGtlZXBzIGtleWJvYXJkIGFycm93cywgc2NyZWVuIHJlYWRlcnMgYW5kIGV2ZXJ5IGV4aXN0aW5nIHRlc3Qgd29ya2luZywgYW5kIHBsYXliYWNrXG4vLyBkcml2ZXMgaXQgYXMgYmVmb3JlLiBVbmRlcm5lYXRoIHNpdCB0aGUgcGFydHMgYSBuYXRpdmUgaW5wdXQgY2Fubm90IGRyYXc6IHRoZSB3aW5kb3dcbi8vIHNwYW4gc2hvd2luZyBleGFjdGx5IHdoYXQgaW50ZXJ2YWwgaXMgb24gdGhlIG1hcCwgYSBydWxlciB3aXRoIGxhYmVsbGVkIGludGVydmFsIG1hcmtzXG4vLyBhbmQgdW5sYWJlbGxlZCBnY2QgbWlub3JzLCBhbmQgdGhlIHRyYWlsIGhhbmRsZSAtLSBkcmFnIGl0IGJhY2sgdG8gd2lkZW4gdGhlIHdpbmRvdyBmb3Jcbi8vIGV2ZXJ5IGxheWVyIGF0IG9uY2UsIGRyb3AgaXQgb250byB0aGUgdGh1bWIgdG8gaGFuZCBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJUaW1lQ29udHJvbChjb250YWluZXIsIHN0YXRlLCBoYW5kbGVycykge1xuICAgIGxldCBlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtY29udHJvbFwiKTtcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoZWwpIGVsLnJlbW92ZSgpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKCFlbCkge1xuICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XG4gICAgICAgIGVsLmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1idXR0b25zXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1wbGF5XCIgYXJpYS1sYWJlbD1cIlBsYXlcIj4ke0lDT05TLnBsYXl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtZndkXCIgdGl0bGU9XCJTdGVwIGZvcndhcmRcIiBhcmlhLWxhYmVsPVwiU3RlcCBmb3J3YXJkXCI+JHtJQ09OUy5md2R9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxhYmVsXCI+PC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWNrXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhc2VcIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwYW5cIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXJ1bGVyXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxpbnB1dCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIgdHlwZT1cInJhbmdlXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWlsXCIgcm9sZT1cInNsaWRlclwiIHRhYmluZGV4PVwiMFwiXG4gICAgICAgICAgICAgICAgICAgICAgYXJpYS1sYWJlbD1cIlRyYWlsaW5nIHdpbmRvd1wiIHRpdGxlPVwiRHJhZyBiYWNrIHRvIHdpZGVuIHRoZSB0aW1lIHdpbmRvdzsgZHJvcCBvbiB0aGUgdGh1bWIgdG8gY2xlYXJcIj48L3NwYW4+XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8c2VsZWN0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGVlZFwiIHRpdGxlPVwiUGxheWJhY2sgc3BlZWRcIj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMC41XCI+MC41eDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIxXCI+MXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMlwiPjJ4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjRcIj40eDwvb3B0aW9uPlxuICAgICAgICAgICAgPC9zZWxlY3Q+YDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGVsKTtcblxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtYmFja1wiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwQmFjayk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1md2RcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEZvcndhcmQpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25QbGF5VG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uTG9vcFRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsXG4gICAgICAgICAgICBlID0+IGhhbmRsZXJzLm9uU3BlZWQocGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkpKTtcbiAgICAgICAgY29uc3Qgc2xpZGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKTtcbiAgICAgICAgLy8gYGlucHV0YCBmaXJlcyBwZXIgZHJhZyBzdGVwIGZvciBsaXZlIHNjcnViYmluZzsgdGhlIG1vZGVsIHdyaXRlYmFjayBpcyB0aGVcbiAgICAgICAgLy8gaGFuZGxlcidzIHByb2JsZW0sIHRocm90dGxlZCB0aGVyZSBzbyBkcmFnZ2luZyBkb2VzIG5vdCBmbG9vZCB0aGUga2VybmVsLlxuICAgICAgICBzbGlkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGUgPT4gaGFuZGxlcnMub25TZWVrKHBhcnNlSW50KGUudGFyZ2V0LnZhbHVlLCAxMCkpKTtcblxuICAgICAgICBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKTtcbiAgICB9XG5cbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLm1heCA9IFN0cmluZyhzdGF0ZS50aWNrcy5sZW5ndGggLSAxKTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLmluZGV4KTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbGFiZWxcIikudGV4dENvbnRlbnQgPSBmb3JtYXRVVEMoc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdKTtcblxuICAgIGNvbnN0IHBsYXkgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKTtcbiAgICBwbGF5LmlubmVySFRNTCA9IHN0YXRlLnBsYXlpbmcgPyBJQ09OUy5wYXVzZSA6IElDT05TLnBsYXk7XG4gICAgcGxheS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIik7XG4gICAgcGxheS50aXRsZSA9IHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIjtcblxuICAgIC8vIEEgbW9kZSwgbm90IGFuIGFjdGlvbjogcHJlc3NlZCBzdHlsaW5nIGFuZCBhcmlhLXByZXNzZWQgc2F5IFwidGhpcyBzdGF5cyBvblwiLFxuICAgIC8vIHdoZXJlIGEgYmFyZSBpY29uIGludml0ZWQgYSBjbGljayBleHBlY3Rpbmcgc29tZXRoaW5nIHRvIGhhcHBlbiByaWdodCBub3cuXG4gICAgY29uc3QgbG9vcCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpO1xuICAgIGxvb3AuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCBCb29sZWFuKHN0YXRlLmxvb3ApKTtcbiAgICBsb29wLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcoQm9vbGVhbihzdGF0ZS5sb29wKSkpO1xuICAgIGxvb3AudGl0bGUgPSBzdGF0ZS5sb29wID8gXCJMb29wOiBvblwiIDogXCJMb29wOiBvZmZcIjtcblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5zcGVlZCB8fCAxKTtcbiAgICByZW5kZXJUcmFjayhlbCwgc3RhdGUpO1xuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcbiAgICByZXR1cm4gZWw7XG59XG5cbi8vIEdlb21ldHJ5IHNoYXJlZCBieSByZW5kZXJpbmcgYW5kIGRyYWdnaW5nOiB3aGVyZSBhIHRpbWUgc2l0cyBvbiB0aGUgdHJhY2ssIDAuLjEuXG5mdW5jdGlvbiB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0KSB7XG4gICAgY29uc3Qgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdGlja3NbMF07XG4gICAgaWYgKHNwYW4gPD0gMCkgcmV0dXJuIDE7XG4gICAgcmV0dXJuIE1hdGgubWluKDEsIE1hdGgubWF4KDAsICh0IC0gdGlja3NbMF0pIC8gc3BhbikpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJUcmFjayhlbCwgc3RhdGUpIHtcbiAgICBjb25zdCB7IHRpY2tzLCBpbmRleCB9ID0gc3RhdGU7XG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XG4gICAgdHJhY2suX3N0YXRlID0gc3RhdGU7ICAgICAgLy8gdGhlIGRyYWcgaGFuZGxlciByZWFkcyB0aGUgZnJlc2hlc3Qgc3RhdGUgZnJvbSBoZXJlXG5cbiAgICBjb25zdCB0aHVtYlQgPSB0aWNrc1tpbmRleF07XG4gICAgY29uc3QgcGVyaW9kTXMgPSBzdGF0ZS5wZXJpb2RNcztcbiAgICBjb25zdCB3aW5kb3dNcyA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiBudWxsO1xuICAgIGNvbnN0IHNob3duTXMgPSB3aW5kb3dNcyAhPSBudWxsID8gd2luZG93TXMgOiBwZXJpb2RNcztcblxuICAgIC8vIFRoZSBzcGFuOiB3aGF0IGludGVydmFsIHRoZSBtYXAgaXMgc2hvd2luZyByaWdodCBub3cuIFRoZSBzcGFuIGRlcGljdHMgdGhlIHNoYXJlZFxuICAgIC8vIHdpbmRvdyAtLSBvbmUgcGVyaW9kIGJ5IGRlZmF1bHQgLS0gYW5kIHBlci1sYXllciBkdXJhdGlvbnMgcmVtYWluIGFuIEFQSSBjb25jZXJuXG4gICAgLy8gdW50aWwgYSBkcmFnIG92ZXJyaWRlcyB0aGVtIGZvciBldmVyeXRoaW5nIGF0IG9uY2UuXG4gICAgY29uc3Qgc3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGFuXCIpO1xuICAgIGNvbnN0IHJpZ2h0ID0gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUKTtcbiAgICBjb25zdCBsZWZ0ID0gc2hvd25NcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gc2hvd25NcykgOiAwO1xuICAgIHNwYW4uc3R5bGUubGVmdCA9IGAkeyhsZWZ0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHNwYW4uc3R5bGUud2lkdGggPSBgJHsoTWF0aC5tYXgoMCwgcmlnaHQgLSBsZWZ0KSAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICBzcGFuLmNsYXNzTGlzdC50b2dnbGUoXCJvdmVycmlkZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcblxuICAgIC8vIFRoZSB0cmFpbCBoYW5kbGUgcGFya3MgT04gdGhlIHRodW1iIHdoZW4gbm8gb3ZlcnJpZGUgaXMgYWN0aXZlIC0tIFwibm90IGdyYWJiZWRcIiAtLVxuICAgIC8vIGFuZCBzaXRzIGF0IHRoZSB3aW5kb3cncyBzdGFydCB3aGlsZSBvbmUgaXMuIERyb3BwaW5nIGl0IGJhY2sgb24gdGhlIHRodW1iIGNsZWFycy5cbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcbiAgICBjb25zdCBhdCA9IHdpbmRvd01zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSB3aW5kb3dNcykgOiByaWdodDtcbiAgICB0cmFpbC5zdHlsZS5sZWZ0ID0gYCR7KGF0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHRyYWlsLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgd2luZG93TXMgIT0gbnVsbCk7XG4gICAgdHJhaWwuc2V0QXR0cmlidXRlKFwiYXJpYS12YWx1ZXRleHRcIiwgc3RhdGUud2luZG93IHx8IFwibm8gdHJhaWxpbmcgd2luZG93XCIpO1xuICAgIC8vIE5vIGZpeGVkLW1zIGdyaWQgKGNhbGVuZGFyIHBlcmlvZHMpIG1lYW5zIG5vdGhpbmcgc2Vuc2libGUgdG8gc25hcCB0by5cbiAgICB0cmFpbC5zdHlsZS5kaXNwbGF5ID0gc3RhdGUuZ3JpZE1zID8gXCJcIiA6IFwibm9uZVwiO1xuXG4gICAgY29uc3QgcnVsZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcnVsZXJcIik7XG4gICAgY29uc3Qga2V5ID0gYCR7dGlja3NbMF19fCR7dGlja3MubGVuZ3RofXwke3N0YXRlLmdyaWRNc318JHtwZXJpb2RNc31gO1xuICAgIGlmIChydWxlci5fa2V5ICE9PSBrZXkpIHtcbiAgICAgICAgcnVsZXIuX2tleSA9IGtleTtcbiAgICAgICAgcnVsZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICAgICAgZm9yIChjb25zdCBtYXJrIG9mIGJ1aWxkUnVsZXIodGlja3MsIHN0YXRlLmdyaWRNcywgdCA9PiBmb3JtYXRUaWNrTGFiZWwodCwgcGVyaW9kTXMpKSkge1xuICAgICAgICAgICAgY29uc3QgbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgbS5jbGFzc05hbWUgPSBtYXJrLm1ham9yID8gXCJzd2lmdG1hcC10aW1lLW1hcmsgbWFqb3JcIiA6IFwic3dpZnRtYXAtdGltZS1tYXJrXCI7XG4gICAgICAgICAgICBtLnN0eWxlLmxlZnQgPSBgJHsobWFyay5mcmFjdGlvbiAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICAgICAgICAgIGlmIChtYXJrLmxhYmVsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICAgICAgbGFiLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1tYXJrLWxhYmVsXCI7XG4gICAgICAgICAgICAgICAgbGFiLnRleHRDb250ZW50ID0gbWFyay5sYWJlbDtcbiAgICAgICAgICAgICAgICBtLmFwcGVuZENoaWxkKGxhYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBydWxlci5hcHBlbmRDaGlsZChtKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gRHJhZ2dpbmcgdGhlIHRyYWlsIGhhbmRsZS4gU25hcHMgdG8gdGhlIGdjZCBncmlkIHNvIGV2ZXJ5IHN0b3AgaXMgYSBib3VuZGFyeSB0aGUgZGF0YVxuLy8gb3IgdGhlIGludGVydmFsIGFjdHVhbGx5IG5hbWVzOyB0aGUgZGlzdGFuY2UgdG8gdGhlIHRodW1iLCBpbiB3aG9sZSBncmlkIHN0ZXBzLCBJUyB0aGVcbi8vIHdpbmRvdy4gWmVybyBzdGVwcyAtLSBkcm9wcGVkIG9uIHRoZSB0aHVtYiAtLSBjbGVhcnMgdGhlIG92ZXJyaWRlLlxuZnVuY3Rpb24gYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycykge1xuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xuXG4gICAgZnVuY3Rpb24gaXNvRnJvbUV2ZW50KGV2KSB7XG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xuICAgICAgICBjb25zdCByZWN0ID0gdHJhY2suZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcyB8fCByZWN0LndpZHRoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdW5jbGFtcGVkIG9uIHRoZSBsZWZ0OiB0aGUgd2luZG93IGlzIFwiaG93IGZhciBiYWNrIGZyb20gdGhlXG4gICAgICAgIC8vIGxlYWQgcG9pbnRcIiwgYW5kIHRoYXQgbWF5IHJlYWNoIHBhc3QgdGhlIGJhcidzIHN0YXJ0IC0tIGVzcGVjaWFsbHkgd2hlbiB0aGVcbiAgICAgICAgLy8gbGVhZCBzaXRzIGVhcmx5IG9uIHRoZSBiYXIgYW5kIG1vc3Qgb2YgaXRzIHRyYWlsIGlzIG9mZi1zY3JlZW4uIENsYW1waW5nIGhlcmVcbiAgICAgICAgLy8gY2FwcGVkIHRoZSB3aW5kb3cgYXQgdGhlIHZpc2libGUgcGFzdCwgd2hpY2ggcGlubmVkIHRoZSBoYW5kbGUgdG8gdGhlIGJhcidzXG4gICAgICAgIC8vIHN0YXJ0IGFuZCBtYWRlIGFueXRoaW5nIHdpZGVyIGltcG9zc2libGUgdG8gc2V0LiBPbmx5IHRoZSBEUkFXSU5HIGNsYW1wcy5cbiAgICAgICAgY29uc3QgZnJhYyA9IE1hdGgubWluKDEsIChldi5jbGllbnRYIC0gcmVjdC5sZWZ0KSAvIHJlY3Qud2lkdGgpO1xuICAgICAgICBjb25zdCB0MCA9IHN0YXRlLnRpY2tzWzBdO1xuICAgICAgICBjb25zdCBzcGFuTXMgPSBzdGF0ZS50aWNrc1tzdGF0ZS50aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xuICAgICAgICBjb25zdCB0aHVtYlQgPSBzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF07XG4gICAgICAgIGNvbnN0IGRpc3QgPSB0aHVtYlQgLSAodDAgKyBmcmFjICogc3Bhbk1zKTtcbiAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGRpc3QgLyBzdGF0ZS5ncmlkTXMpKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBzID09PSAwID8gbnVsbCA6IG1zVG9QZXJpb2RJU08oc3RlcHMgKiBzdGF0ZS5ncmlkTXMpO1xuICAgIH1cblxuICAgIC8vIE1vdmUgYW5kIHJlbGVhc2UgbGlzdGVuIG9uIHRoZSBkb2N1bWVudCBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBkcmFnOiB0aGUgaGFuZGxlXG4gICAgLy8gaXMgMTJweCB3aWRlLCB0aGUgY3Vyc29yIGxlYXZlcyBpdCBvbiB0aGUgZmlyc3QgZmFzdCBtb3ZlbWVudCwgYW5kIGV2ZW50cyB0aGF0XG4gICAgLy8gdGFyZ2V0IHdoYXRldmVyIGlzIHVuZGVybmVhdGggd291bGQgc3R1dHRlciB0aGUgZHJhZyBhbmQgY291bGQgc3dhbGxvdyB0aGUgcmVsZWFzZVxuICAgIC8vIGVudGlyZWx5IC0tIGFuIHVuY29tbWl0dGVkIGRyYWcgdGhlbiBzbmFwcyBiYWNrIG9uIHRoZSBuZXh0IHN5bmMuXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIC8vIENhcHR1cmUgcmV0YXJnZXRzIGV2ZXJ5IHBvaW50ZXIgZXZlbnQgdG8gdGhlIGhhbmRsZSB1bnRpbCByZWxlYXNlLCBubyBtYXR0ZXJcbiAgICAgICAgLy8gd2hlcmUgdGhlIGN1cnNvciBpcy4gV2l0aG91dCBpdCwgbGV0dGluZyBnbyB3aXRoIHRoZSBwb2ludGVyIG92ZXIgdGhlIG1hcCBoYW5kc1xuICAgICAgICAvLyBwb2ludGVydXAgdG8gTGVhZmxldCdzIGNvbnRhaW5lciBoYW5kbGVycywgYW5kIGEgcmVsZWFzZSB0aGV5IHN3YWxsb3cgbmV2ZXJcbiAgICAgICAgLy8gcmVhY2hlcyB0aGUgZG9jdW1lbnQgbGlzdGVuZXIgLS0gdGhlIGRyYWcgc3RheXMgdW5jb21taXR0ZWQgYW5kIHRoZSBuZXh0IHN5bmNcbiAgICAgICAgLy8gc25hcHMgdGhlIGhhbmRsZSBob21lLiBUaGUgZG9jdW1lbnQgbGlzdGVuZXJzIGJlbG93IHJlbWFpbiBhcyB0aGUgZmFsbGJhY2sgZm9yXG4gICAgICAgIC8vIGVudmlyb25tZW50cyB3aXRob3V0IGNhcHR1cmU7IHdpdGggaXQsIHJldGFyZ2V0ZWQgZXZlbnRzIHN0aWxsIGJ1YmJsZSB0byB0aGVtLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKSB0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZShldi5wb2ludGVySWQpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogc3ludGhldGljIGV2ZW50cyBoYXZlIG5vIGFjdGl2ZSBwb2ludGVyOyBmYWxsIGJhY2sgdG8gYnViYmxpbmcgKi8gfVxuXG4gICAgICAgIGNvbnN0IG1vdmUgPSBlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGZpbmlzaCA9IGUgPT4ge1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dDb21taXQoaXNvKTtcbiAgICAgICAgfTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XG4gICAgfSk7XG5cbiAgICAvLyBLZXlib2FyZDogb25lIGdyaWQgc3RlcCBwZXIgYXJyb3csIERlbGV0ZS9Ib21lIHRvIGNsZWFyLiBTYW1lIGNvbnRyYWN0IGFzIHRoZSBkcmFnLlxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcykgcmV0dXJuO1xuICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IDA7XG4gICAgICAgIGxldCBuZXh0O1xuICAgICAgICBpZiAoZXYua2V5ID09PSBcIkFycm93TGVmdFwiKSBuZXh0ID0gY3VycmVudCArIHN0YXRlLmdyaWRNcztcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkFycm93UmlnaHRcIikgbmV4dCA9IE1hdGgubWF4KDAsIGN1cnJlbnQgLSBzdGF0ZS5ncmlkTXMpO1xuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiRGVsZXRlXCIgfHwgZXYua2V5ID09PSBcIkhvbWVcIikgbmV4dCA9IDA7XG4gICAgICAgIGVsc2UgcmV0dXJuO1xuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChuZXh0ID4gMCA/IG1zVG9QZXJpb2RJU08obmV4dCkgOiBudWxsKTtcbiAgICB9KTtcbn1cbiIsICIvLyBUaW1lIGZpbHRlcmluZyBvbiB0aGUgR1BVLCBmb3IgcG9pbnQgbGF5ZXJzLlxuLy9cbi8vIFRoZSBjb29yZGluYXRlcyBhbHJlYWR5IGxpdmUgaW4gR1BVIGJ1ZmZlcnM7IHJlYnVpbGRpbmcgdGhlIG1lcmdlZCBsYXllciBwZXIgdGljayB0aHJld1xuLy8gdGhhdCBhd2F5IGFuZCByZS1mZWQgZ2xpZnkgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTIC0tIG1lYXN1cmVkIGF0IH4yLjZzIHBlciB3aW5kb3dcbi8vIGNoYW5nZSBhdCB0aGF0IHNjYWxlLCB3aXRoIGFsbG9jYXRpb24gY2h1cm4gdGhhdCBjb3VsZCBjcmFzaCB0aGUgdGFiIHdoZW4gY2hhbmdlc1xuLy8gc3RhY2tlZC4gSW5zdGVhZCwgZWFjaCBwb2ludCdzIHRpbWUgaW50ZXJ2YWwgYW5kIGl0cyBsYXllcidzIGR1cmF0aW9uIHJpZGUgYWxvbmcgYXNcbi8vIHZlcnRleCBhdHRyaWJ1dGVzIHVwbG9hZGVkIG9uY2UsIGFuZCB0aGUgY3VycmVudCB0aWNrIGlzIGEgdW5pZm9ybTogYSB0aWNrIG9yIHdpbmRvd1xuLy8gY2hhbmdlIGNvc3RzIHR3byBmbG9hdHMgYW5kIGEgcmVkcmF3LlxuLy9cbi8vIGdsaWZ5IG1ha2VzIHRoaXMgcG9zc2libGUgd2l0aG91dCBmb3JraW5nIGl0OiB2ZXJ0ZXhTaGFkZXJTb3VyY2UgaXMgYW4gb3ZlcnJpZGFibGVcbi8vIHNldHRpbmcgKHRoZSBwaW4gZnJhZ21lbnQgc2hhZGVyIGFscmVhZHkgdXNlcyB0aGUgc2FtZSBkb29yKSwgaW5zdGFuY2VzIGV4cG9zZSB0aGVpclxuLy8gZ2wvcHJvZ3JhbS9jYW52YXMsIGF0dHJpYnV0ZXMgYXJlIGJvdW5kIG9uY2UgYXQgc2V0dXAsIGFuZCB0aGUgcGVyLWZyYW1lIGRyYXcgdG91Y2hlc1xuLy8gb25seSB0aGUgbWF0cml4IHVuaWZvcm0gLS0gc28gZXh0cmEgYXR0cmlidXRlcyBib3VuZCBhZnRlciBzZXR1cCBwZXJzaXN0LCBhbmQgdW5pZm9ybVxuLy8gdXBkYXRlcyB0YWtlIGVmZmVjdCBvbiB0aGUgbmV4dCByZWRyYXcuXG5pbXBvcnQgeyBwYXJzZVBlcmlvZCwgcGVyaW9kVG9NcywgdGltZXNGb3IgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgZmxvYXQzMiBvbiB0aGUgR1BVLCB3aG9zZSBpbnRlZ2VycyBhcmUgZXhhY3Qgb25seSB0byAyXjI0LiBFcG9jaCBtcyBpc1xuLy8gaG9wZWxlc3MgYXQgdGhhdCBwcmVjaXNpb24sIHNvIHRpbWVzIGFyZSByZWJhc2VkIHRvIHRoZSBidWNrZXQncyBlYXJsaWVzdCBzdGFydCBhbmRcbi8vIGV4cHJlc3NlZCBpbiBzZWNvbmRzOiBleGFjdCB0byB+MTk0IGRheXMgb2Ygc3BhbiwgYW5kIGEgMnMgcm91bmRpbmcgYmV5b25kIHRoYXQgaXNcbi8vIGludmlzaWJsZSBhdCBhbnkgem9vbSBhIHRpbWUgc2xpZGVyIG1ha2VzIHNlbnNlIGF0LlxuY29uc3QgQUxXQVlTID0gNi4zZTg7ICAgLy8gfjIwIHllYXJzLCBpbiBzZWNvbmRzOiB0aGUgXCJkdXJhdGlvblwiIG9mIGN1bXVsYXRpdmUgbGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHRoZSBzcGFuIGhhbGYtd2lkdGggb2YgcG9pbnRzIHdpdGggbm8gcmVhZGFibGUgdGltZS5cblxuLy8gUGVyLWJ1Y2tldCBsYXllci12aXNpYmlsaXR5IHNsb3RzIGluIHRoZSB2ZXJ0ZXggc2hhZGVyLiBFYWNoIGZsb2F0IGFycmF5IGVsZW1lbnRcbi8vIG9jY3VwaWVzIGEgZnVsbCB1bmlmb3JtIHZlY3RvciBpbiBFUyBHTFNMIHBhY2tpbmcsIGFuZCB0aGUgc3BlYyBndWFyYW50ZWVzIG9ubHkgMTI4XG4vLyB2ZXJ0ZXggdW5pZm9ybSB2ZWN0b3JzIC0tIDY0IHNsb3RzIGxlYXZlcyBjb21mb3J0YWJsZSByb29tIGZvciB0aGUgbWF0cml4IGFuZCB0aGUgdGltZVxuLy8gdW5pZm9ybXMuIEEgYnVja2V0IHdpdGggbW9yZSBsYXllcnMgdGhhbiBzbG90cyBmYWxscyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRvZ2dsZS5cbi8vIChQYWNraW5nIGZvdXIgbGF5ZXJzIHBlciB2ZWM0IHdvdWxkIHF1YWRydXBsZSB0aGlzIGlmIGFueW9uZSBldmVyIG5lZWRzIGl0LilcbmV4cG9ydCBjb25zdCBMQVlFUl9TTE9UUyA9IDY0O1xuXG4vLyBDaGVhcCBraWxsIHN3aXRjaGVzOiBpZiB3aXJpbmcgdGhlIEdMIHN0YXRlIGV2ZXIgZmFpbHMgKGEgZnV0dXJlIGdsaWZ5IHZlcnNpb24gbW92aW5nXG4vLyBpdHMgaW50ZXJuYWxzKSwgdGhlIGFmZmVjdGVkIGZhbWlseSBmYWxscyBiYWNrIHRvIHRoZSBDUFUgcmVidWlsZCBwYXRoLiBQb2ludHMgYW5kXG4vLyB2ZWN0b3JzIGFyZSBzZXBhcmF0ZSBmbGFncyAtLSBhIHZlY3RvciBpbnRyb3NwZWN0aW9uIGZhaWx1cmUgbXVzdCBub3QgY29zdCBwb2ludHNcbi8vIHRoZWlyIEdQVSBwYXRoLlxubGV0IGdwdU9rID0gdHJ1ZTtcbmV4cG9ydCBmdW5jdGlvbiBncHVUaW1lQXZhaWxhYmxlKCkgeyByZXR1cm4gZ3B1T2s7IH1cbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlR3B1VGltZShyZWFzb24pIHtcbiAgICBpZiAoZ3B1T2spIGNvbnNvbGUud2FybihgW1N3aWZ0TWFwXSBHUFUgdGltZSBmaWx0ZXJpbmcgZGlzYWJsZWQ6ICR7cmVhc29ufS4gYCArXG4gICAgICAgIGBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljay5gKTtcbiAgICBncHVPayA9IGZhbHNlO1xufVxubGV0IHZlY3RvckdwdU9rID0gdHJ1ZTtcbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JHcHVBdmFpbGFibGUoKSB7IHJldHVybiB2ZWN0b3JHcHVPazsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpc2FibGVWZWN0b3JHcHUocmVhc29uKSB7XG4gICAgaWYgKHZlY3RvckdwdU9rKSBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gR1BVIHRpbWUgZm9yIGxpbmVzL3BvbHlnb25zIGRpc2FibGVkOiBgICtcbiAgICAgICAgYCR7cmVhc29ufS4gRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2sgZm9yIHRob3NlIGJ1Y2tldHMuYCk7XG4gICAgdmVjdG9yR3B1T2sgPSBmYWxzZTtcbn1cblxuLy8gVGhlIGRlZmF1bHQgcG9pbnRzIHZlcnRleCBzaGFkZXIgKHJlYWQgb3V0IG9mIGxlYWZsZXQuZ2xpZnkgMy4zLjApIHdpdGggdGhlIHdpbmRvd1xuLy8gdGVzdCBhZGRlZC4gQSBoaWRkZW4gcG9pbnQgZ2V0cyBzaXplIDAgYW5kIGEgcG9zaXRpb24gb3V0c2lkZSBjbGlwIHNwYWNlLCBzbyBuZWl0aGVyXG4vLyB0aGUgdmlzaWJsZSBwYXNzIG5vciB0aGUgc2hhcmVkLXByb2dyYW0gcGlja2luZyBwYXNzIGV2ZXIgcmFzdGVyaXNlcyBpdC5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lVmVydGV4U2hhZGVyKCkge1xuICAgIHJldHVybiBgdW5pZm9ybSBtYXQ0IG1hdHJpeDtcbmF0dHJpYnV0ZSB2ZWM0IHZlcnRleDtcbmF0dHJpYnV0ZSB2ZWM0IGNvbG9yO1xuYXR0cmlidXRlIGZsb2F0IHBvaW50U2l6ZTtcbmF0dHJpYnV0ZSB2ZWMyIGFUaW1lU3BhbjtcbmF0dHJpYnV0ZSBmbG9hdCBhRHVyYXRpb247XG5hdHRyaWJ1dGUgZmxvYXQgYUxheWVyO1xudW5pZm9ybSBmbG9hdCB1VGljaztcbnVuaWZvcm0gZmxvYXQgdU92ZXJyaWRlO1xudW5pZm9ybSBmbG9hdCB1TGF5ZXJWaXNbJHtMQVlFUl9TTE9UU31dO1xudmFyeWluZyB2ZWM0IF9jb2xvcjtcblxudm9pZCBtYWluKCkge1xuICAvLyBBIG5lZ2F0aXZlIGR1cmF0aW9uIGlzIHRoZSBmYWRlIGZsYWc6IHxhRHVyYXRpb258IGlzIHRoZSB3aW5kb3csIHRoZSBzaWduIHNheXMgdGhpc1xuICAvLyBwb2ludCBkaW1zIHdpdGggYWdlLiBBIHNoYXJlZCBvdmVycmlkZSBrZWVwcyB0aGUgcG9pbnQncyBvd24gZmFkZSBwcmVmZXJlbmNlLlxuICBib29sIGZhZGVzID0gYUR1cmF0aW9uIDwgMC4wO1xuICBmbG9hdCBkdXIgPSB1T3ZlcnJpZGUgPj0gMC4wID8gdU92ZXJyaWRlIDogYWJzKGFEdXJhdGlvbik7XG4gIC8vIEhhbGYtb3BlbiAodGljayAtIGR1ciwgdGlja10sIG1hdGNoaW5nIGZlYXR1cmVJbldpbmRvdyBvbiB0aGUgQ1BVIHNpZGUgLS0gQU5EZWQgd2l0aFxuICAvLyB0aGUgcG9pbnQncyBsYXllciBiZWluZyB2aXNpYmxlLiBMYXllciB0b2dnbGVzIGFyZSBvbmUgdW5pZm9ybSBlbGVtZW50LCBub3QgYVxuICAvLyByZWJ1aWxkOiB1bmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZS1mZWVkIGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUy5cbiAgYm9vbCB2aXNpYmxlID0gYVRpbWVTcGFuLnkgPiAodVRpY2sgLSBkdXIpICYmIGFUaW1lU3Bhbi54IDw9IHVUaWNrXG4gICAgICAmJiB1TGF5ZXJWaXNbaW50KGFMYXllcildID4gMC41O1xuICBnbF9Qb2ludFNpemUgPSB2aXNpYmxlID8gcG9pbnRTaXplIDogMC4wO1xuICBnbF9Qb3NpdGlvbiA9IHZpc2libGUgPyBtYXRyaXggKiB2ZXJ0ZXggOiB2ZWM0KDIuMCwgMi4wLCAyLjAsIDEuMCk7XG4gIC8vIEFnZSBydW5zIGZyb20gdGhlIGZlYXR1cmUncyBlbmQ7IG5ld2VzdCBpcyBvcGFxdWUsIHRoZSB0cmFpbGluZyBlZGdlIHJlYWNoZXMgemVyby5cbiAgZmxvYXQgYWxwaGEgPSBmYWRlcyA/IGNsYW1wKDEuMCAtICh1VGljayAtIGFUaW1lU3Bhbi55KSAvIGR1ciwgMC4wLCAxLjApIDogMS4wO1xuICBfY29sb3IgPSB2ZWM0KGNvbG9yLnJnYiwgY29sb3IuYSAqIGFscGhhKTtcbn1cbmA7XG59XG5cbi8vIFBlci1sYXllciBkdXJhdGlvbiBpbiBzZWNvbmRzOiBudWxsIGFjY3VtdWxhdGVzLCBcInBlcmlvZFwiIGlzIHRoZSBzaGFyZWQgaW50ZXJ2YWwsXG4vLyBhbiBJU08gc3RyaW5nIGlzIGl0c2VsZjsgYW55dGhpbmcgdW5wYXJzZWFibGUgZmFsbHMgYmFjayB0byB0aGUgaW50ZXJ2YWwuXG5mdW5jdGlvbiBkdXJhdGlvblNlY29uZHMoc3BlYywgcGVyaW9kTXMpIHtcbiAgICBpZiAoc3BlYyA9PT0gbnVsbCB8fCBzcGVjID09PSB1bmRlZmluZWQpIHJldHVybiBBTFdBWVM7XG4gICAgaWYgKHNwZWMgPT09IFwicGVyaW9kXCIpIHJldHVybiAocGVyaW9kTXMgfHwgMjQgKiAzNjAwICogMTAwMCkgLyAxMDAwO1xuICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzcGVjKSk7XG4gICAgcmV0dXJuIG1zID8gbXMgLyAxMDAwIDogKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcbn1cblxuLy8gQnVpbGRzIHRoZSBwZXItcG9pbnQgYXR0cmlidXRlIGFycmF5cyBmb3Igb25lIG1lcmdlZCBidWNrZXQsIGluIHRoZSBleGFjdCBvcmRlciB0aGVcbi8vIGJ1Y2tldCBmZWVkcyBwb2ludHMgdG8gZ2xpZnk6IGxheWVyIGJ5IGxheWVyLCBpbmRleCAwLi5uLTEsIHdpdGggc2luZ2xlLWBsb2NhdGlvbmBcbi8vIGxheWVycyBjb250cmlidXRpbmcgb25lIHBvaW50LiBQb2ludHMgaW4gbGF5ZXJzIHdpdGhvdXQgdGltZSBtZXRhZGF0YSAtLSBhbmQgcG9pbnRzXG4vLyB3aG9zZSB0aW1lIHdhcyB1bnJlYWRhYmxlIChOYU4pIC0tIGdldCBhIHNwYW4gdGhhdCBpcyB2aXNpYmxlIGF0IGV2ZXJ5IHRpY2suXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRUaW1lQXR0cmlidXRlcyhsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcbiAgICBsZXQgdG90YWwgPSAwO1xuICAgIGxldCBoYXNUaW1lID0gZmFsc2U7XG4gICAgY29uc3QgcGVyTGF5ZXIgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICBjb25zdCBjb3VudCA9IGJ1ZiA/IGJ1Zi5ieXRlTGVuZ3RoIC8gMTYgOiAobGF5ZXIubG9jYXRpb24gPyAxIDogMCk7XG4gICAgICAgIGNvbnN0IHRpbWVzID0gbGF5ZXIudGltZSA/IHRpbWVzRm9yKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgOiBudWxsO1xuICAgICAgICBpZiAobGF5ZXIudGltZSkgaGFzVGltZSA9IHRydWU7XG4gICAgICAgIHBlckxheWVyLnB1c2goeyBsYXllciwgY291bnQsIHRpbWVzIH0pO1xuICAgICAgICB0b3RhbCArPSBjb3VudDtcbiAgICB9XG4gICAgaWYgKCFoYXNUaW1lKSByZXR1cm4geyBoYXNUaW1lOiBmYWxzZSB9O1xuXG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IHsgdGltZXMgfSBvZiBwZXJMYXllcikge1xuICAgICAgICBpZiAoIXRpbWVzKSBjb250aW51ZTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4odGltZXNbaV0pICYmIHRpbWVzW2ldIDwgYmFzZSkgYmFzZSA9IHRpbWVzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChiYXNlID09PSBJbmZpbml0eSkgYmFzZSA9IDA7XG5cbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcbiAgICBjb25zdCBkdXJzID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcbiAgICBjb25zdCBsYXllcklkcyA9IFtdO1xuICAgIGxldCBvdXQgPSAwO1xuICAgIGZvciAoY29uc3QgeyBsYXllciwgY291bnQsIHRpbWVzIH0gb2YgcGVyTGF5ZXIpIHtcbiAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJJZHMubGVuZ3RoO1xuICAgICAgICBsYXllcklkcy5wdXNoKGxheWVyLmlkKTtcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XG4gICAgICAgIC8vIFRoZSBmYWRlIGZsYWcgcmlkZXMgdGhlIGR1cmF0aW9uJ3Mgc2lnbiwgc28gaXQgY29zdHMgbm8gZXh0cmEgYXR0cmlidXRlLlxuICAgICAgICAvLyBUaW1lbGVzcyAoTmFOKSBwb2ludHMga2VlcCBhIHBvc2l0aXZlIGR1cmF0aW9uOiB3aXRoIG5vIGFnZSwgbm90aGluZyB0byBmYWRlLlxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyXSA6IE5hTjtcbiAgICAgICAgICAgIGNvbnN0IGVuZCA9IHRpbWVzID8gdGltZXNbaSAqIDIgKyAxXSA6IE5hTjtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpKSB7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSAtQUxXQVlTO1xuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IEFMV0FZUztcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBBTFdBWVM7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDJdID0gKHN0YXJ0IC0gYmFzZSkgLyAxMDAwO1xuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IChlbmQgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgZHVyc1tvdXRdID0gc2lnbmVkRHVyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGlkeDtcbiAgICAgICAgICAgIG91dCsrO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IGhhc1RpbWU6IHRydWUsIGJhc2UsIHNwYW5zLCBkdXJzLCBsYXllcklkeCwgbGF5ZXJJZHMsIGNvdW50OiB0b3RhbCB9O1xufVxuXG4vLyBQZXItZmVhdHVyZSB0aW1lIG1ldGFkYXRhIGZvciBhIHZlY3RvciBidWNrZXQgKGxpbmVzL3BvbHlnb25zKS4gU2FtZSBlbmNvZGluZ3MgYXNcbi8vIHRoZSBwb2ludCBwYXRoIC0tIHJlYmFzZWQgZmxvYXQzMiBzZWNvbmRzLCBzaWduLXBhY2tlZCBmYWRlLCBhbHdheXMtdmlzaWJsZSBzcGFuc1xuLy8gZm9yIHRpbWVsZXNzIG9yIG5vbi10aW1lIGxheWVycy5cbi8vXG4vLyBBIHBvbHlsaW5lIHdob3NlIDo6dGltZXMgYnVmZmVyIGhvbGRzIG9uZSBbc3RhcnQsIGVuZF0gcGFpciBQRVIgVkVSVEVYIGFuaW1hdGVzXG4vLyBwZXIgc2VnbWVudCB3aXRoaW4gb25lIGxheWVyOiBzZWdtZW50IGsgc3BhbnMgdmVydGV4IGsncyBzdGFydCB0byB2ZXJ0ZXggaysxJ3Ncbi8vIGVuZCwgYW5kIGJlY2F1c2UgZ2xpZnkgYnVpbGRzIDIgZGVkaWNhdGVkIEdMIHZlcnRpY2VzIHBlciBzZWdtZW50IC0tIHNlZ21lbnRzXG4vLyBuZXZlciBzaGFyZSB2ZXJ0aWNlcyAtLSBib3RoIGVuZHBvaW50cyBjYXJyeSB0aGUgc2FtZSBzcGFuIGFuZCBzZWdtZW50cyBhcHBlYXJcbi8vIGF0b21pY2FsbHkuIFRoYXQgaXMgd2hhdCBsZXRzIGEgd2hvbGUgc2VnbWVudGVkIHRyYWNrIHJpZGUgT05FIGxheWVyIHNsb3QgdGhlIHdheVxuLy8gYSAyMDBrLXBvaW50IGxheWVyIGRvZXMsIGluc3RlYWQgb2Ygb25lIHNsb3QgcGVyIGNodW5rIGFnYWluc3QgdGhlIDY0IGNlaWxpbmcuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZWN0b3JUaW1lTWV0YShsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG4gICAgICAgIGlmICghdGltZXMpIGNvbnRpbnVlO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcblxuICAgIGNvbnN0IHBlckZlYXR1cmUgPSBsYXllcnNMaXN0Lm1hcCgobGF5ZXIsIGlkeCkgPT4ge1xuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcbiAgICAgICAgaWYgKCF0aW1lcyB8fCAodGltZXMubGVuZ3RoID09PSAyICYmIE51bWJlci5pc05hTih0aW1lc1swXSkpKSB7XG4gICAgICAgICAgICByZXR1cm4geyBzdGFydDogLUFMV0FZUywgZW5kOiBBTFdBWVMsIGR1cjogQUxXQVlTLCBpZHggfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBuVmVydHMgPSB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlsaW5lXCIgJiYgdGltZXMubGVuZ3RoID4gMlxuICAgICAgICAgICAgICAgICYmIHRpbWVzLmxlbmd0aCA9PT0gblZlcnRzICogMikge1xuICAgICAgICAgICAgY29uc3Qgc2VncyA9IG5WZXJ0cyAtIDE7XG4gICAgICAgICAgICBjb25zdCBzZWcgPSBuZXcgRmxvYXQ2NEFycmF5KHNlZ3MgKiAyKTtcbiAgICAgICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgc2VnczsgaysrKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcyA9IHRpbWVzW2sgKiAyXTtcbiAgICAgICAgICAgICAgICBjb25zdCBlID0gdGltZXNbKGsgKyAxKSAqIDIgKyAxXTtcbiAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHMpIHx8IE51bWJlci5pc05hTihlKSkge1xuICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gLUFMV0FZUzsgICAgICAvLyBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YVxuICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDIgKyAxXSA9IEFMV0FZUztcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gKHMgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gKGUgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gT3ZlcmFsbCBzcGFuIHJpZGVzIGFsb25nIGFzIHRoZSBmYWxsYmFjayBpZiBjb3VudHMgZXZlciBtaXNhbGlnbi5cbiAgICAgICAgICAgIHJldHVybiB7IHNlZywgc3RhcnQ6IHNlZ1swXSwgZW5kOiBzZWdbc2VnLmxlbmd0aCAtIDFdLFxuICAgICAgICAgICAgICAgICAgICAgZHVyOiBzaWduZWREdXIsIGlkeCB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAodGltZXNbMF0gLSBiYXNlKSAvIDEwMDAsIGVuZDogKHRpbWVzWzFdIC0gYmFzZSkgLyAxMDAwLFxuICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XG4gICAgfSk7XG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgcGVyRmVhdHVyZSwgbGF5ZXJJZHM6IGxheWVyc0xpc3QubWFwKGwgPT4gbC5pZCkgfTtcbn1cblxuLy8gQSB2ZWN0b3IgbGF5ZXIncyB2ZXJ0ZXggY291bnQgZnJvbSB3aGljaGV2ZXIgdHJhbnNwb3J0IGNhcnJpZXMgaXRzIGNvb3JkaW5hdGVzOlxuLy8gdGhlIGJpbmFyeSBidWZmZXIgKDIgZmxvYXQ2NCBwZXIgdmVydGV4KSBvciBpbmxpbmUgYGxvY2F0aW9uc2AuXG5mdW5jdGlvbiB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcbiAgICBpZiAocmF3KSByZXR1cm4gKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGggfHwgMCkgLyAxNjtcbiAgICByZXR1cm4gKGxheWVyLmxvY2F0aW9ucyB8fCBbXSkubGVuZ3RoO1xufVxuXG4vLyBFeHBhbmRzIHBlci1mZWF0dXJlIHZhbHVlcyB0byBwZXItR0wtdmVydGV4IGFycmF5cyBnaXZlbiBlYWNoIGZlYXR1cmUncyB2ZXJ0ZXggY291bnQuXG4vLyBQdXJlLCBzbyB0aGUgYWxpZ25tZW50IGxvZ2ljIGlzIHRpZXItMSB0ZXN0YWJsZSBhd2F5IGZyb20gYW55IEdMIGNvbnRleHQuXG5leHBvcnQgZnVuY3Rpb24gZXhwYW5kUGVyRmVhdHVyZShwZXJGZWF0dXJlLCBjb3VudHMpIHtcbiAgICBsZXQgdG90YWwgPSAwO1xuICAgIGZvciAoY29uc3QgYyBvZiBjb3VudHMpIHRvdGFsICs9IGM7XG4gICAgY29uc3Qgc3BhbnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsICogMik7XG4gICAgY29uc3QgZHVycyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XG4gICAgbGV0IG91dCA9IDA7XG4gICAgcGVyRmVhdHVyZS5mb3JFYWNoKChmLCBpKSA9PiB7XG4gICAgICAgIC8vIFBlci1zZWdtZW50IHNwYW5zOiBHTCB2ZXJ0ZXggdiBiZWxvbmdzIHRvIHNlZ21lbnQgdiA+PiAxIChnbGlmeSBkcmF3c1xuICAgICAgICAvLyAyIGRlZGljYXRlZCB2ZXJ0aWNlcyBwZXIgc2VnbWVudCksIHNvIGJvdGggZW5kcG9pbnRzIHRha2UgdGhlIHNlZ21lbnQnc1xuICAgICAgICAvLyBzcGFuIGFuZCBhIHNlZ21lbnQgYXBwZWFycyBvciBkaXNhcHBlYXJzIGF0b21pY2FsbHkuIHNlZyBob2xkcyBzZWdzKjJcbiAgICAgICAgLy8gZmxvYXRzIGFuZCB0aGUgZmVhdHVyZSBkcmF3cyBzZWdzKjIgR0wgdmVydGljZXMsIHNvIHRoZSBsZW5ndGhzIGFncmVlaW5nXG4gICAgICAgIC8vIGlzIHRoZSBhbGlnbm1lbnQgY2hlY2s7IGEgbWlzbWF0Y2ggZmFsbHMgYmFjayB0byB0aGUgd2hvbGUtZmVhdHVyZSBzcGFuXG4gICAgICAgIC8vIHJhdGhlciB0aGFuIHNoZWFyaW5nIGV2ZXJ5IGF0dHJpYnV0ZSBhZnRlciBpdC5cbiAgICAgICAgY29uc3QgcGVyU2VnbWVudCA9IGYuc2VnICYmIGYuc2VnLmxlbmd0aCA9PT0gY291bnRzW2ldID8gZi5zZWcgOiBudWxsO1xuICAgICAgICBmb3IgKGxldCB2ID0gMDsgdiA8IGNvdW50c1tpXTsgdisrKSB7XG4gICAgICAgICAgICBjb25zdCBrID0gcGVyU2VnbWVudCA/ICh2ID4+IDEpICogMiA6IC0xO1xuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrXSA6IGYuc3RhcnQ7XG4gICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrICsgMV0gOiBmLmVuZDtcbiAgICAgICAgICAgIGR1cnNbb3V0XSA9IGYuZHVyO1xuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGYuaWR4O1xuICAgICAgICAgICAgb3V0Kys7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4geyBzcGFucywgZHVycywgbGF5ZXJJZHggfTtcbn1cblxuLy8gZ2xpZnkncyB2ZXJ0ZXggbGF5b3V0OiA2IGZsb2F0cyBwZXIgR0wgdmVydGV4ICh4LCB5LCByLCBnLCBiLCBhKSwgY29uZmlybWVkIGZvciAzLjMuMFxuLy8gYm90aCBieSByZWFkaW5nIHRoZSBzb3VyY2UgYW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgcmVwb3J0J3MgZGVidWcgZHVtcCAtLSB0d29cbi8vIG9uZS1zZWdtZW50IGxpbmVzIHByb2R1Y2VkIGFsbFZlcnRpY2VzVHlwZWQgb2YgMjQgZmxvYXRzOiAyIGZlYXR1cmVzIHggMiB2ZXJ0aWNlcyB4IDYuXG5jb25zdCBGTE9BVFNfUEVSX1ZFUlRFWCA9IDY7XG5cbi8vIFdpcmVzIHRpbWUgKyBsYXllci12aXNpYmlsaXR5IGludG8gYSBsaXZlIGdsaWZ5IExJTkVTIG9yIFNIQVBFUyBpbnN0YW5jZS4gVGhlIGNhbGxlclxuLy8gc3VwcGxpZXMgcGVyLWZlYXR1cmUgR0wtdmVydGV4IGNvdW50cyBjb21wdXRlZCBmcm9tIHRoZSBnZW9tZXRyeSBpdCBidWlsdCBpdHNlbGY6XG4vLyBsaW5lcyBkcmF3IDIqKHBvaW50cy0xKSB2ZXJ0aWNlcyBwZXIgZmVhdHVyZSwgYW5kIGFueSB0cmlhbmd1bGF0aW9uIG9mIGEgc2ltcGxlIHJpbmdcbi8vIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3MgZWFyY3V0LiBUaGUgY291bnRzXG4vLyBhcmUgdmFsaWRhdGVkIGFnYWluc3QgdGhlIGluc3RhbmNlJ3MgYWN0dWFsIGJ1ZmZlciBsZW5ndGgsIGFuZCBhbnkgbWlzbWF0Y2ggZGlzYWJsZXNcbi8vIHRoZSB2ZWN0b3IgR1BVIHBhdGggcmF0aGVyIHRoYW4gbWlzLWFsaWduaW5nIGF0dHJpYnV0ZXMuXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UoaW5zdGFuY2UsIG1ldGEsIGNvdW50cykge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb3VudHMpIHx8IGNvdW50cy5sZW5ndGggIT09IG1ldGEucGVyRmVhdHVyZS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgZXhwZWN0ZWQgJHttZXRhLnBlckZlYXR1cmUubGVuZ3RofSB2ZXJ0ZXggY291bnRzLCBgICtcbiAgICAgICAgICAgICAgICBgZ290ICR7Y291bnRzICYmIGNvdW50cy5sZW5ndGh9YCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXhwZWN0ZWQgPSBjb3VudHMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgKiBGTE9BVFNfUEVSX1ZFUlRFWDtcbiAgICAgICAgLy8gTGluZXMga2VlcCBhIHR5cGVkIGZsYXQgYnVmZmVyOyBzaGFwZXMga2VlcCBhIHBsYWluIGZsYXQgYXJyYXkuIEVpdGhlciBpcyB0aGVcbiAgICAgICAgLy8gZ3JvdW5kIHRydXRoIGZvciBob3cgbWFueSBHTCB2ZXJ0aWNlcyBnbGlmeSBhY3R1YWxseSBidWlsdC5cbiAgICAgICAgY29uc3QgYWN0dWFsID0gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZCA/IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQubGVuZ3RoXG4gICAgICAgICAgICA6IChBcnJheS5pc0FycmF5KGluc3RhbmNlLnZlcnRpY2VzKSA/IGluc3RhbmNlLnZlcnRpY2VzLmxlbmd0aCA6IC0xKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZXhwZWN0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4IGNvdW50IG1pc21hdGNoOiBnZW9tZXRyeSBzYXlzICR7ZXhwZWN0ZWR9IGZsb2F0cywgYCArXG4gICAgICAgICAgICAgICAgYHRoZSBpbnN0YW5jZSBob2xkcyAke2FjdHVhbH1gKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhdHRycyA9IGV4cGFuZFBlckZlYXR1cmUobWV0YS5wZXJGZWF0dXJlLCBjb3VudHMpO1xuICAgICAgICBhdHRycy5iYXNlID0gbWV0YS5iYXNlO1xuICAgICAgICBhdHRycy5sYXllcklkcyA9IG1ldGEubGF5ZXJJZHM7XG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgZGlzYWJsZVZlY3RvckdwdShlcnIubWVzc2FnZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuLy8gV2lyZXMgdGhlIGF0dHJpYnV0ZSBidWZmZXJzIGFuZCB1bmlmb3JtcyBpbnRvIGEgbGl2ZSBnbGlmeSBwb2ludHMgaW5zdGFuY2UuIFJldHVybnMgYVxuLy8gaGFuZGxlIHdob3NlIHNldFdpbmRvdyBjb3N0cyB0d28gdW5pZm9ybXMgYW5kIGEgcmVkcmF3LCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IHRoZVxuLy8gaW5zdGFuY2UgaXMgbm90IHdoZXJlIGdsaWZ5IDMuMy4wIGtlZXBzIGl0IC0tIGluIHdoaWNoIGNhc2UgR1BVIHRpbWUgaXMgZGlzYWJsZWQgYW5kXG4vLyB0aGUgY2FsbGVyJ3MgcmVidWlsZCBwYXRoIHRha2VzIG92ZXIuXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvSW5zdGFuY2UoaW5zdGFuY2UsIGF0dHJzKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIHdpcmVUaW1lQXR0cmlidXRlcyhpbnN0YW5jZSwgYXR0cnMpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBkaXNhYmxlR3B1VGltZShlcnIubWVzc2FnZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuLy8gVGhlIGNvbW1vbiBHTCB3aXJpbmc6IGJ1ZmZlcnMgZm9yIHNwYW4vZHVyYXRpb24vbGF5ZXIgYXR0cmlidXRlcywgdW5pZm9ybXMgZm9yIHRoZVxuLy8gdGljaywgdGhlIHNoYXJlZCBvdmVycmlkZSBhbmQgdGhlIHBlci1sYXllciB2aXNpYmlsaXR5IHNsb3RzLiBUaHJvd3Mgb24gYW55dGhpbmdcbi8vIHVuZXhwZWN0ZWQ7IHRoZSBjYWxsZXJzIGRlY2lkZSB3aGljaCBmYWxsYmFjayBmbGFnIHRoYXQgZmxpcHMuXG5mdW5jdGlvbiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKSB7XG4gICAge1xuICAgICAgICBjb25zdCBnbCA9IGluc3RhbmNlLmdsO1xuICAgICAgICBjb25zdCBwcm9ncmFtID0gaW5zdGFuY2UucHJvZ3JhbTtcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBpbnN0YW5jZS5sYXllcjtcbiAgICAgICAgaWYgKCFnbCB8fCAhcHJvZ3JhbSB8fCAhbGF5ZXIpIHRocm93IG5ldyBFcnJvcihcImluc3RhbmNlIGxhY2tzIGdsL3Byb2dyYW0vbGF5ZXJcIik7XG5cbiAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcblxuICAgICAgICBjb25zdCBzcGFuTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhVGltZVNwYW5cIik7XG4gICAgICAgIGNvbnN0IGR1ckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUR1cmF0aW9uXCIpO1xuICAgICAgICBjb25zdCBsYXllckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUxheWVyXCIpO1xuICAgICAgICBjb25zdCB0aWNrTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidVRpY2tcIik7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidU92ZXJyaWRlXCIpO1xuICAgICAgICAvLyBTb21lIGRyaXZlcnMgbmFtZSB0aGUgYXJyYXkgaGVhZCBcInVMYXllclZpc1swXVwiOyBhY2NlcHQgZWl0aGVyLlxuICAgICAgICBjb25zdCB2aXNMb2MgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNcIilcbiAgICAgICAgICAgIHx8IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1swXVwiKTtcbiAgICAgICAgaWYgKHNwYW5Mb2MgPCAwIHx8IGR1ckxvYyA8IDAgfHwgbGF5ZXJMb2MgPCAwIHx8ICF0aWNrTG9jIHx8ICFvdmVycmlkZUxvYyB8fCAhdmlzTG9jKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0aW1lIGF0dHJpYnV0ZXMvdW5pZm9ybXMgbWlzc2luZyBmcm9tIHRoZSBsaW5rZWQgcHJvZ3JhbVwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwYW5CdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHNwYW5CdWYpO1xuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuc3BhbnMsIGdsLlNUQVRJQ19EUkFXKTtcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihzcGFuTG9jLCAyLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShzcGFuTG9jKTtcblxuICAgICAgICBjb25zdCBkdXJCdWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGR1ckJ1Zik7XG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5kdXJzLCBnbC5TVEFUSUNfRFJBVyk7XG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoZHVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShkdXJMb2MpO1xuXG4gICAgICAgIGNvbnN0IGxheWVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBsYXllckJ1Zik7XG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5sYXllcklkeCwgZ2wuU1RBVElDX0RSQVcpO1xuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGxheWVyTG9jLCAxLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShsYXllckxvYyk7XG5cbiAgICAgICAgLy8gVW50aWwgdGhlIHNsaWRlciBzYXlzIG90aGVyd2lzZSwgZXZlcnl0aGluZyBpcyB2aXNpYmxlIC0tIGluIHRpbWUgQU5EIGxheWVyLlxuICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgQUxXQVlTKTtcbiAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCAtMSk7XG4gICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbGF5ZXJJZHM6IGF0dHJzLmxheWVySWRzLFxuICAgICAgICAgICAgLy8gdGlja01zIGluIGVwb2NoIG1zOyBvdmVycmlkZU1zIGEgc2hhcmVkLXdpbmRvdyB3aWR0aCBvciBudWxsLlxuICAgICAgICAgICAgc2V0V2luZG93KHRpY2tNcywgb3ZlcnJpZGVNcykge1xuICAgICAgICAgICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIHRpY2tNcyA9PT0gbnVsbCA/IEFMV0FZUyA6ICh0aWNrTXMgLSBhdHRycy5iYXNlKSAvIDEwMDApO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgb3ZlcnJpZGVNcyA9PT0gbnVsbCA/IC0xIDogb3ZlcnJpZGVNcyAvIDEwMDApO1xuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIE9uZSBmbG9hdCBwZXIgbGF5ZXIgc2xvdCwgaW4gYXR0cnMubGF5ZXJJZHMgb3JkZXIuIEEgc2lkZWJhciB0b2dnbGUgbGFuZHNcbiAgICAgICAgICAgIC8vIGhlcmUgaW5zdGVhZCBvZiByZWJ1aWxkaW5nIHRoZSBidWNrZXQuXG4gICAgICAgICAgICBzZXRMYXllclZpc2liaWxpdHkodmlzQXJyYXkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB2aXMgPSBuZXcgRmxvYXQzMkFycmF5KExBWUVSX1NMT1RTKS5maWxsKDEpO1xuICAgICAgICAgICAgICAgIHZpcy5zZXQodmlzQXJyYXkuc2xpY2UoMCwgTEFZRVJfU0xPVFMpKTtcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZnYodmlzTG9jLCB2aXMpO1xuICAgICAgICAgICAgICAgIGxheWVyLnJlZHJhdygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICB9XG59XG4iLCAiaW1wb3J0IHsgbG9hZEpTLCBiaW5kUG9wdXAsIGJpbmRUb29sdGlwLCBwYXJzZUNvbG9yIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHBpblNoYWRlciB9IGZyb20gXCIuL3NoYWRlcnMuanNcIjtcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXG4gICAgICAgICBwZXJpb2RUb01zIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcbmltcG9ydCB7IGJ1aWxkVGltZUF0dHJpYnV0ZXMsIGF0dGFjaFRpbWVUb0luc3RhbmNlLCB0aW1lVmVydGV4U2hhZGVyLFxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XG5cbmZ1bmN0aW9uIHNldHVwR2xpZnlQcm9qZWN0aW9uKGdsSW5zdGFuY2UpIHtcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIuX3VuY2xhbXBlZFByb2plY3QgPSBmdW5jdGlvbihsYXRsbmcsIHpvb20pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAub3B0aW9ucy5jcnMubGF0TG5nVG9Qb2ludChsYXRsbmcsIHpvb20pO1xuICAgICAgICB9O1xuICAgICAgICBnbEluc3RhbmNlLmxheWVyLnJlZHJhdygpO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9jbGlja1RpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIC8vIFdoaWxlIGEgR2VvbWFuIG1vZGUgaXMgYXJtZWQgKHRoZSB3aWRnZXQncyBjbGljayBoYW5kbGVyIHN0YW1wcyB0aGlzXG4gICAgICAgICAgICAvLyBwZXIgY2xpY2ssIGJlZm9yZSBhbnkgZmVhdHVyZSBoYW5kbGVyIHJ1bnMpLCBFVkVSWSBtYXRjaCBzdGFuZHMgZG93bjpcbiAgICAgICAgICAgIC8vIGEgY2xpY2sgaW4gcmVtb3ZhbCBtb2RlIGlzIGEgZGVsZXRpb24gYXR0ZW1wdCwgYW5kIGFuc3dlcmluZyBpdCB3aXRoXG4gICAgICAgICAgICAvLyBhIGZlYXR1cmUgcG9wdXAgb3IgYSBjb29yZHMgcmVhZG91dCByZWFkcyBhcyBcInJlbW92ZSBpcyBicm9rZW5cIi5cbiAgICAgICAgICAgIGlmIChtYXAuX2NsaWNrTWF0Y2hlcy5sZW5ndGggPiAwICYmICFtYXAuX3BtTW9kZUFjdGl2ZSkge1xuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgMCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xuICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xuICAgIH1cbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcbiAgICBpZiAoIW1hcC5faG92ZXJUaW1lb3V0KSB7XG4gICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XG4gICAgICAgICAgICBpZiAobWFwLl9ob3Zlck1hdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzWzBdLmFjdGlvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMgPSBbXTtcbiAgICAgICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgMCk7XG4gICAgfVxufVxuXG4vLyBTdHlsZSBmb3Igb25lIGZlYXR1cmU6IGl0cyBvd24gZW50cnkgZnJvbSBgZmVhdHVyZV9zdHlsZXNgIHdoZW4gdGhlIGxheWVyIGNhcnJpZXNcbi8vIHZhcmllZCBzdHlsaW5nLCBvdGhlcndpc2UgdGhlIGxheWVyJ3Mgc2luZ2xlIHN0eWxlLiBQeXRob24gb25seSBlbWl0cyBmZWF0dXJlX3N0eWxlc1xuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXG4vLyBGb3VyIHNvdXJjZXMsIGxlYXN0IHNwZWNpZmljIGZpcnN0LiBFYWNoIHRyYW5zaWVudCBvbmUgbGl2ZXMgaW4gaXRzIG93biBmaWVsZCByYXRoZXJcbi8vIHRoYW4gZWRpdGluZyB0aGUgbGF5ZXIncyBzdHlsZSwgc28gY2xlYXJpbmcgaXQgcmVzdG9yZXMgd2hhdCB3YXMgdW5kZXJuZWF0aCB3aXRoXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxuLy9cbi8vICAgdGhlIGxheWVyJ3Mgb3duIHN0eWxlICAgd2hhdCBpdCB3YXMgZHJhd24gd2l0aFxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxuLy8gICBoaWdobGlnaHRfc3R5bGUgICAgICAgICB0aGUgd2hvbGUgbGF5ZXIgaXMgc2VsZWN0ZWRcbi8vICAgc3R5bGVfb3ZlcnJpZGVzW2ldICAgICAgdGhpcyBmZWF0dXJlIGlzIHNlbGVjdGVkIC0tIG1vc3Qgc3BlY2lmaWMsIHNvIGl0IHdpbnNcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcbiAgICBjb25zdCBmcm9tRGF0YSA9IEFycmF5LmlzQXJyYXkobGF5ZXIuZmVhdHVyZV9zdHlsZXMpID8gbGF5ZXIuZmVhdHVyZV9zdHlsZXNbaW5kZXhdIDogbnVsbDtcbiAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGU7XG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcbiAgICBpZiAoIWZyb21EYXRhICYmICFoaWdobGlnaHQgJiYgIXNlbGVjdGVkKSByZXR1cm4gbGF5ZXI7XG4gICAgcmV0dXJuIHsgLi4ubGF5ZXIsIC4uLihmcm9tRGF0YSB8fCB7fSksIC4uLihoaWdobGlnaHQgfHwge30pLCAuLi4oc2VsZWN0ZWQgfHwge30pIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRJbmRleGVkUHJvcGVydGllcyhwcm9wZXJ0aWVzLCBpbmRleCkge1xuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xuICAgIGNvbnN0IHByb3BzID0ge307XG4gICAgT2JqZWN0LmtleXMocHJvcGVydGllcykuZm9yRWFjaChrID0+IHtcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcbiAgICAgICAgcHJvcHNba10gPSBBcnJheS5pc0FycmF5KHZhbCkgPyB2YWxbaW5kZXhdIDogdmFsO1xuICAgIH0pO1xuICAgIHJldHVybiBwcm9wcztcbn1cblxuXG5cbi8vIEFuIGltYWdlcnkgb3ZlcmxheSdzIGlkZW50aXR5OiBldmVyeXRoaW5nIHRoZSByZW5kZXJlZCBlbGVtZW50IGRlcml2ZXMgZnJvbSBpdHNcbi8vIGNvbmZpZy4gVGhlIHN5bmMgbG9vcCByZWNyZWF0ZXMgdGhlIG92ZXJsYXkgd2hlbiB0aGlzIGNoYW5nZXMgKG9yIHdoZW4gdGhlXG4vLyBiaW5hcnkgYnVmZmVyIG9iamVjdCB1bmRlciB0aGUgbGF5ZXIgaWQgaXMgcmVwbGFjZWQpLCBzaW5jZSBhIERPTSBpbWFnZSBpcyBhXG4vLyBzaW5nbGUgY2hlYXAgbm9kZSAtLSBubyBpbmNyZW1lbnRhbCB1cGRhdGUgbWFjaGluZXJ5IG5lZWRlZC5cbmV4cG9ydCBmdW5jdGlvbiBpbWFnZU1ldGFLZXkobGF5ZXIpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoW2xheWVyLnVybCB8fCBudWxsLCBsYXllci5ib3VuZHMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBsYXllci5vcGFjaXR5ID8/IDEsIGxheWVyLmltYWdlX2Zvcm1hdCB8fCBudWxsXSk7XG59XG5cbi8vIEdlb3JlZmVyZW5jZWQgcGl4ZWxzIHBpbm5lZCB0byBhIGxhdC9sb24gYm94LiBUaGUgY29uZmlnIGlzIHB1cmUgZGF0YSAtLVxuLy8ge3R5cGU6IFwiaW1hZ2VcIiwgYm91bmRzLCBvcGFjaXR5LCB1cmwgfCBieXRlcyB1bmRlciB0aGUgbGF5ZXIgaWR9IC0tIHNvIGFcbi8vIHBsYWluLUpTIGNvbnN1bWVyIHBhc3NlcyBhIFVSTCBhbmQgdGhlIHdpZGdldCBwYXRoIHNoaXBzIGJ5dGVzIG92ZXIgdGhlXG4vLyBiaW5hcnkgYnVmZmVyIHRyYW5zcG9ydC4gUHl0aG9uIGhhcyBhbHJlYWR5IHdhcnBlZCB0aGUgcmFzdGVyIGludG8gdGhlIE1BUCdzXG4vLyBvd24gQ1JTIGdyaWQgKHJhc3RlcmlvIHNpZGUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIExlYWZsZXQncyBsaW5lYXIgY29ybmVyXG4vLyBzdHJldGNoIGV4YWN0bHkgY29ycmVjdDsgdGhpcyBzdGF5cyBhIGR1bWIgcmVuZGVyZXIuXG5mdW5jdGlvbiByZW5kZXJJbWFnZUxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyKSB7XG4gICAgaWYgKCFsYXllci5ib3VuZHMpIHJldHVybiBudWxsO1xuICAgIGxldCB1cmwgPSBsYXllci51cmw7XG4gICAgbGV0IG9iamVjdFVybCA9IG51bGw7XG4gICAgaWYgKCF1cmwgJiYgY29vcmRCdWZmZXIpIHtcbiAgICAgICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtjb29yZEJ1ZmZlcl0sXG4gICAgICAgICAgICB7IHR5cGU6IGxheWVyLmltYWdlX2Zvcm1hdCB8fCBcImltYWdlL3BuZ1wiIH0pO1xuICAgICAgICBvYmplY3RVcmwgPSB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIH1cbiAgICBpZiAoIXVybCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgb3ZlcmxheSA9IEwuaW1hZ2VPdmVybGF5KHVybCwgbGF5ZXIuYm91bmRzLCB7XG4gICAgICAgIG9wYWNpdHk6IGxheWVyLm9wYWNpdHkgPz8gMSxcbiAgICAgICAgLy8gQ29udGV4dCwgbm90IGEgY2xpY2sgdGFyZ2V0OiBjbGlja3MgZmFsbCB0aHJvdWdoIHRvIGZlYXR1cmVzIGFuZCB0aGVcbiAgICAgICAgLy8gZW1wdHktbWFwIGNvb3JkaW5hdGUgZmFsbGJhY2suIFRoZSBkZWZhdWx0IG92ZXJsYXlQYW5lICh6IDQwMClcbiAgICAgICAgLy8gYWxyZWFkeSBzaXRzIGFib3ZlIHRpbGVzICgyMDApIGFuZCBiZWxvdyB0aGUgR0wgcGFuZXMgKDQxMCspLlxuICAgICAgICBpbnRlcmFjdGl2ZTogZmFsc2UsXG4gICAgfSk7XG4gICAgaWYgKG9iamVjdFVybCkge1xuICAgICAgICBvdmVybGF5Lm9uKFwicmVtb3ZlXCIsICgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwob2JqZWN0VXJsKSk7XG4gICAgfVxuICAgIG92ZXJsYXkuYWRkVG8obWFwKTtcbiAgICBvdmVybGF5LmxheWVyVHlwZSA9IGxheWVyLnR5cGU7XG4gICAgb3ZlcmxheS5pbWFnZU1ldGEgPSBpbWFnZU1ldGFLZXkobGF5ZXIpO1xuICAgIG92ZXJsYXkuaW1hZ2VTb3VyY2UgPSBjb29yZEJ1ZmZlciB8fCBudWxsO1xuICAgIHJldHVybiBvdmVybGF5O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRCdWZmZXIsIG1vZGVsKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIikge1xuICAgICAgICByZXR1cm4gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcik7XG4gICAgfVxuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcbiAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge307XG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcbiAgICAgICAgcmV0dXJuIGdyb3VwO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQSB2ZWN0b3IgbGF5ZXIncyBjb29yZGluYXRlczogdGhlIGJpbmFyeSBidWZmZXIgdW5kZXIgaXRzIGlkIHdoZW4gUHl0aG9uIGJ1aWx0IGl0XG4vLyAodGhlIGxheWVycyBKU09OIHRoZW4gY2FycmllcyBubyBjb29yZGluYXRlcyBhdCBhbGwpLCBvciBpbmxpbmUgYGxvY2F0aW9uc2AgZm9yXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xuLy8gb24gdGhlIEdQVSBwYXRoIHJhcmVseSBkby5cbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XG4gICAgaWYgKGxheWVyLmxvY2F0aW9ucykgcmV0dXJuIGxheWVyLmxvY2F0aW9ucztcbiAgICBjb25zdCByYXcgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XG4gICAgaWYgKCFyYXcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZsYXQgPSBuZXcgRmxvYXQ2NEFycmF5KHJhdy5idWZmZXIgfHwgcmF3LCByYXcuYnl0ZU9mZnNldCB8fCAwLFxuICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcbiAgICBjb25zdCBvdXQgPSBuZXcgQXJyYXkoZmxhdC5sZW5ndGggLyAyKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG91dC5sZW5ndGg7IGkrKykge1xuICAgICAgICBvdXRbaV0gPSBbZmxhdFtpICogMl0sIGZsYXRbaSAqIDIgKyAxXV07XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIGNsb3NlUmluZyhyaW5nKSB7XG4gICAgaWYgKHJpbmcubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBmaXJzdCA9IHJpbmdbMF07XG4gICAgICAgIGNvbnN0IGxhc3QgPSByaW5nW3JpbmcubGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChmaXJzdFswXSAhPT0gbGFzdFswXSB8fCBmaXJzdFsxXSAhPT0gbGFzdFsxXSkge1xuICAgICAgICAgICAgcmluZy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmluZztcbn1cblxuLy8gZ2xpZnkncyBsaW5lIGhpdCB0b2xlcmFuY2UgaXMgYHNlbnNpdGl2aXR5ICsgd2VpZ2h0L3NjYWxlYCwgYW5kIHNlbnNpdGl2aXR5IGlzIGFcbi8vIENPTlNUQU5UIGluIGxhdGxuZyBkZWdyZWVzIC0tIDAuMSBmb3IgY2xpY2tzICh+MTEga20pIGFuZCAwLjAzIGZvciBob3ZlcnMsXG4vLyB6b29tLWJsaW5kLCBzbyBhIGNsaWNrIHdpdGhpbiBzaWdodCBvZiBhIGxpbmUgbWF0Y2hlZCBpdCBhbmQgc3RhcnZlZCB0aGVcbi8vIGVtcHR5LW1hcCBmYWxsYmFjay4gVGhlIHdlaWdodC9zY2FsZSB0ZXJtIGFscmVhZHkgY292ZXJzIHRoZSBkcmF3biB3aWR0aDtcbi8vIHJlcGxhY2UgdGhlIGNvbnN0YW50IHdpdGggYSBmZXcgcGl4ZWxzJyB3b3J0aCBhdCB0aGUgY3VycmVudCB6b29tLiBUaGUgaW5zdGFuY2Vcbi8vIGdldHRlcnMgcmVhZCBgc2V0dGluZ3NgIGxpdmUgcGVyIGV2ZW50LCBzbyB1cGRhdGluZyBvbiB6b29tIGlzIGVub3VnaCAtLSBub1xuLy8gZ2xpZnkgcGF0Y2hpbmcuIFJldHVybnMgdGhlIHVuc3Vic2NyaWJlIGZvciBvblJlbW92ZS5cbmNvbnN0IExJTkVfSElUX1NMQUNLX1BYID0gODtcbmZ1bmN0aW9uIHRyYWNrTGluZVNlbnNpdGl2aXR5KG1hcCwgaW5zdGFuY2UpIHtcbiAgICBjb25zdCBhcHBseSA9ICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2xhY2sgPSBMSU5FX0hJVF9TTEFDS19QWCAvIE1hdGgucG93KDIsIG1hcC5nZXRab29tKCkpO1xuICAgICAgICBpbnN0YW5jZS5zZXR0aW5ncy5zZW5zaXRpdml0eSA9IHNsYWNrO1xuICAgICAgICBpbnN0YW5jZS5zZXR0aW5ncy5zZW5zaXRpdml0eUhvdmVyID0gc2xhY2s7XG4gICAgfTtcbiAgICBhcHBseSgpO1xuICAgIG1hcC5vbihcInpvb21lbmRcIiwgYXBwbHkpO1xuICAgIHJldHVybiAoKSA9PiBtYXAub2ZmKFwiem9vbWVuZFwiLCBhcHBseSk7XG59XG5cbi8vIEFuIGFyZWEgbGF5ZXIncyBnZW9tZXRyeSBhcyBwYXJ0cyAtPiBjbG9zZWQgW2xvbiwgbGF0XSByaW5nczogYSBwb2x5Z29uJ3MgZmxhdFxuLy8gY29vcmRpbmF0ZSBydW4gc2xpY2VkIGJ5IGl0cyBgcmluZ3NgIHRhYmxlIChvbmUgaG9sZS1mcmVlIHJpbmcgd2l0aG91dCBpdCksIG9yIGFcbi8vIGNpcmNsZSdzIGdlbmVyYXRlZCByaW5nLiBGZWVkcyBib3RoIHRoZSBmaWxsIChlYXJjdXQsIGluIHRoZSBwb2x5Z29uIGJ1Y2tldCkgYW5kXG4vLyB0aGUgb3V0bGluZSAoTGluZVN0cmluZ3MgaW4gdGhlIGxpbmVzIGJ1Y2tldCkuXG5mdW5jdGlvbiBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcbiAgICAgICAgY29uc3QgbGF0ID0gbGF5ZXIubG9jYXRpb25bMF07XG4gICAgICAgIGNvbnN0IGxvbiA9IGxheWVyLmxvY2F0aW9uWzFdO1xuICAgICAgICBjb25zdCByYWRpdXNNZXRlcnMgPSBsYXllci5yYWRpdXMgfHwgMTA7XG4gICAgICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3ODEzNztcbiAgICAgICAgY29uc3QgcmluZyA9IFtdO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBhbmdsZSA9IChpICogMzYwKSAvIDMyO1xuICAgICAgICAgICAgY29uc3QgYW5nbGVSYWQgPSAoYW5nbGUgKiBNYXRoLlBJKSAvIDE4MDtcbiAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xuICAgICAgICAgICAgY29uc3QgZExvbiA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLnNpbihhbmdsZVJhZCkpIC8gKGVhcnRoUmFkaXVzICogTWF0aC5jb3MoKGxhdCAqIE1hdGguUEkpIC8gMTgwKSk7XG4gICAgICAgICAgICByaW5nLnB1c2goW2xvbiArIChkTG9uICogMTgwKSAvIE1hdGguUEksIGxhdCArIChkTGF0ICogMTgwKSAvIE1hdGguUEldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW1tyaW5nXV07XG4gICAgfVxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcbiAgICBjb25zdCBsb25sYXQgPSBsb2NzLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XG4gICAgY29uc3QgcmluZ1RhYmxlID0gbGF5ZXIucmluZ3MgfHwgKGxvbmxhdC5sZW5ndGggPiAwID8gW1tsb25sYXQubGVuZ3RoXV0gOiBbXSk7XG4gICAgY29uc3QgcGFydHMgPSBbXTtcbiAgICBsZXQgYXQgPSAwO1xuICAgIGZvciAoY29uc3QgcGFydExlbnMgb2YgcmluZ1RhYmxlKSB7XG4gICAgICAgIGNvbnN0IHJpbmdzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGVuIG9mIHBhcnRMZW5zKSB7XG4gICAgICAgICAgICBjb25zdCByaW5nID0gY2xvc2VSaW5nKGxvbmxhdC5zbGljZShhdCwgYXQgKyBsZW4pKTtcbiAgICAgICAgICAgIGF0ICs9IGxlbjtcbiAgICAgICAgICAgIGlmIChyaW5nLmxlbmd0aCA+PSA0KSByaW5ncy5wdXNoKHJpbmcpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyaW5ncy5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKHJpbmdzKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhcnRzO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBtb2RlbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0ZlYXR1cmVWaXNpYmxlID0gbnVsbCkge1xuICAgIC8vIEhpdC10ZXN0IGd1YXJkOiBHUFUtcGF0aCBidWNrZXRzIGhvbGQgaGlkZGVuIGxheWVycyAoYW5kIG91dC1vZi13aW5kb3dcbiAgICAvLyBmZWF0dXJlcyksIG1hc2tlZCBvbmx5IGJ5IHNoYWRlciB1bmlmb3JtcyBnbGlmeSdzIGhpdC10ZXN0cyBjYW5ub3Qgc2VlLiBUaGVcbiAgICAvLyB3aWRnZXQgcGFzc2VzIGEgbGl2ZSBsb29rdXA7IHRoZSBmYWxsYmFjayBjb3ZlcnMgcGxhaW4tSlMgY29uc3VtZXJzIHdpdGggdGhlXG4gICAgLy8gY29uZmlnJ3Mgb3duIGZsYWcuXG4gICAgY29uc3QgdmlzaWJsZU5vdyA9IGlzRmVhdHVyZVZpc2libGUgfHwgKChsKSA9PiBsLnZpc2libGUgIT09IGZhbHNlKTtcbiAgICAvLyBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZSBnZW9tZXRyeSBwZXIgbGF5ZXIuIE9uIHRoZSBHUFUgcGF0aCAobWFwLmpzXG4gICAgLy8gcGFzc2VzIHZlY3RvckdwdSB3aGVuIHRoZSBidWNrZXQgcXVhbGlmaWVzKSBldmVyeSBmZWF0dXJlIHN0YXlzIGluIHRoZSBidWZmZXJzIGFuZFxuICAgIC8vIHRoZSBzaGFkZXIgZGVjaWRlcyB2aXNpYmlsaXR5IHBlciB0aWNrIGFuZCBwZXIgbGF5ZXIgdG9nZ2xlIC0tIGEgbGluZS1zaGFwZWQgdHJhY2tcbiAgICAvLyBoYXMgYXMgbWFueSB2ZXJ0aWNlcyBhcyBhIHBvaW50IHRyYWNrIGhhcyBwb2ludHMsIHNvIGl0cyByZWJ1aWxkcyBjb3N0IHRoZSBzYW1lXG4gICAgLy8gYW5kIGNyYXNoZWQgdGhlIHNhbWUgd2F5LiBPZmYgdGhlIEdQVSBwYXRoLCB0aGUgd2hvbGUtZmVhdHVyZSBDUFUgZmlsdGVyIHJlbWFpbnMuXG4gICAgY29uc3QgdmVjdG9yTWV0YSA9IHZlY3RvckdwdSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCJcbiAgICAgICAgPyBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxuICAgICAgICAgICAgdGltZVN0YXRlICYmIHRpbWVTdGF0ZS5wZXJpb2QgPyBwZXJpb2RUb01zKHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbClcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgY29uc3QgdmVjdG9yVGltZSA9IEJvb2xlYW4odmVjdG9yTWV0YS5oYXNUaW1lKTtcbiAgICBpZiAodGltZVN0YXRlICYmICF2ZWN0b3JUaW1lICYmIHR5cGUgIT09IFwiY2lyY2xlX21hcmtlcnNcIiAmJiB0eXBlICE9PSBcIm1hcmtlcnNcIikge1xuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcbiAgICAgICAgaWYgKGxheWVyc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBjb25zdCB2ZXJ0ZXhDb3VudHMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcblxuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lczogYSBwb2x5Z29uIG9yIGNpcmNsZSBpbiB0aGlzIGJ1Y2tldCBjb250cmlidXRlcyBlYWNoIG9mIGl0c1xuICAgICAgICAgICAgLy8gcmluZ3MgYXMgb25lIExpbmVTdHJpbmcsIGRyYXduIHdpdGggdGhlIGFyZWEncyBzdHJva2Ugb3B0aW9ucyAtLSBjb2xvcixcbiAgICAgICAgICAgIC8vIHdlaWdodCwgb3BhY2l0eSwgTGVhZmxldCdzIG93biBzZW1hbnRpY3MuIE91dGxpbmUgd2VpZ2h0IGFuZCBvcGFjaXR5IG5ldmVyXG4gICAgICAgICAgICAvLyByZW5kZXJlZCBiZWZvcmUgdGhpczsgdGhlIGZpbGwgbWFjaGluZXJ5IGNhbm5vdCBkcmF3IHRoZW0gKGdsaWZ5J3MgYm9yZGVyXG4gICAgICAgICAgICAvLyBpcyAxcHggYW5kIGZpbGwtY29sb3VyZWQpLCB0aGUgbGluZXMgbWFjaGluZXJ5IGFscmVhZHkgZG9lcy5cbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIiB8fCBsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgbGV0IGNvdW50ID0gMDtcbiAgICAgICAgICAgICAgICBpZiAoKHN0eWxlLndlaWdodCA/PyAzKSA+IDAgJiYgKHN0eWxlLm9wYWNpdHkgPz8gMS4wKSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5nIG9mIHJpbmdzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY291bnQgKz0gTWF0aC5tYXgoMCwgMiAqIChyaW5nLmxlbmd0aCAtIDEpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7IHR5cGU6IFwiTGluZVN0cmluZ1wiLCBjb29yZGluYXRlczogcmluZyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBPdXRsaW5lIHBpeGVscyBvbmx5IC0tIHRoZSBhcmVhJ3Mgc2hhcGVzIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvd25zIGludGVyYWN0aW9uIHdpdGggZXhhY3QgY29udGFpbm1lbnQuIExlZnRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNsaWNrYWJsZSwgdGhlc2UgcmluZ3MgYW5zd2VyZWQgdGhyb3VnaCBnbGlmeSdzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBsaW5lIHRvbGVyYW5jZSAoMC4xIERFR1JFRVMgZm9yIGNsaWNrcyB2cyAwLjAzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmb3IgaG92ZXJzKTogcG9wdXBzIHdlbGwgb3V0c2lkZSB0aGUgc2hhcGUgYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnNpZGUgaG9sZXMsIGhvdmVyIGRpc2FncmVlaW5nIHdpdGggY2xpY2suXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0JvcmRlcjogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaChjb3VudCk7ICAgLy8gMCBrZWVwcyB0aGUgc2xvdCBhbGlnbmVkIHdoZW4gc3Ryb2tlbGVzc1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XG4gICAgICAgICAgICBjb25zdCBnZW9qc29uQ29vcmRzID0gbG9jcy5tYXAoYyA9PiBbY1sxXSwgY1swXV0pO1xuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goTWF0aC5tYXgoMCwgMiAqIChnZW9qc29uQ29vcmRzLmxlbmd0aCAtIDEpKSk7XG4gICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcbiAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkxpbmVTdHJpbmdcIixcbiAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IGdlb2pzb25Db29yZHNcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgbGluZU9wdGlvbnMgPSB2ZWN0b3JUaW1lXG4gICAgICAgICAgICAgICAgICAgID8geyB2ZXJ0ZXhTaGFkZXJTb3VyY2U6ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKSB9IDoge307XG4gICAgICAgICAgICAgICAgdGhpcy5nbExpbmVzID0gTC5nbGlmeS5saW5lcyh7XG4gICAgICAgICAgICAgICAgICAgIC4uLmxpbmVPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWxpbmVzUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICAvLyBUaGUgZGF0YSBhYm92ZSBpcyBHZW9KU09OLCB3aG9zZSBjb29yZGluYXRlcyBhcmUgW2xvbiwgbGF0XTsgZ2xpZnlcbiAgICAgICAgICAgICAgICAgICAgLy8gZGVmYXVsdHMgdG8gbGF0aXR1ZGUtZmlyc3QgYW5kIGl0cyBMSU5FIHZlcnRleCBidWlsZGVyIHJlYWRzXG4gICAgICAgICAgICAgICAgICAgIC8vIGNvb3JkaW5hdGVzIHRocm91Z2ggdGhlc2Uga2V5cyAtLSB1bnNldCwgaXQgdG9vayBsb25naXR1ZGUgYXNcbiAgICAgICAgICAgICAgICAgICAgLy8gbGF0aXR1ZGUgYW5kIHByb2plY3RlZCBldmVyeSBsaW5lIG9mZi12aWV3cG9ydC4gU2lsZW50bHk6IG5vIEdMXG4gICAgICAgICAgICAgICAgICAgIC8vIGVycm9yLCBhIGhlYWx0aHkgY2FudmFzLCB6ZXJvIGZyYWdtZW50cy4gU2V0IHBlciBpbnN0YW5jZSByYXRoZXJcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhhbiBvbiB0aGUgTC5nbGlmeSBnbG9iYWwsIHdoaWNoIGFub3RoZXIgbGlicmFyeSBjb3VsZCBhbHNvXG4gICAgICAgICAgICAgICAgICAgIC8vIG11dGF0ZS4gVGhlIHBvbHlnb24gcGF0aCBpcyBkZWxpYmVyYXRlbHkgTk9UIGdpdmVuIHRoZXNlIGtleXM6XG4gICAgICAgICAgICAgICAgICAgIC8vIGl0IHRyaWFuZ3VsYXRlcyB2aWEgZWFyY3V0IG9uIHRoZSBHZW9KU09OIGRpcmVjdGx5LCBuYXRpdmVcbiAgICAgICAgICAgICAgICAgICAgLy8gW2xvbiwgbGF0XSwgYW5kIGtleXMgdGhlcmUgd291bGQgdHJhbnNwb3NlIGl0IHRoZSBzYW1lIHdheS5cbiAgICAgICAgICAgICAgICAgICAgLy8gRm91bmQgYnkgdGhlIFZhbGhhbGxhLVZSRSBidWcgcmVwb3J0LCBkcml2aW5nIHRoZSBwbGFpbi1KU1xuICAgICAgICAgICAgICAgICAgICAvLyBidW5kbGUgd2hlcmUgbm8gcG9pbnRzIG1hc2tlZCB0aGUgYmxhbmsgbGluZXMuXG4gICAgICAgICAgICAgICAgICAgIGxhdGl0dWRlS2V5OiAxLFxuICAgICAgICAgICAgICAgICAgICBsb25naXR1ZGVLZXk6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLndlaWdodDtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZlYXR1cmUgfHwgIWZlYXR1cmUucHJvcGVydGllcyB8fCBmZWF0dXJlLnByb3BlcnRpZXMuaXNCb3JkZXJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIWZlYXR1cmUucHJvcGVydGllcy5sYXllclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFBvcHVwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdHRlbiBiYXJlOiBzaGlueXdpZGdldHMnIG1vZGVsIGhhcyBubyBgY29tbWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvcGVydHksIHNvIGdhdGluZyBvbiBpdCBzaWxlbnRseSBraWxsZWQgdGhpc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB3cml0ZWJhY2sgdW5kZXIgU2hpbnkuIFRoZSBzaWRlYmFyIGFsd2F5cyB3cm90ZSBiYXJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB3YXMgdGhlIG9uZSBwYXRoIHRoYXQgd29ya2VkIHRoZXJlLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBsYXllci5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXJlIHRoZSBjbGljayBsYW5kZWQsIGZlYXR1cmUgb3Igbm90OiBvbmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRyYWl0IGFsd2F5cyBhbnN3ZXJzIFwid2hlcmVcIiwgY2xpY2tlZF9sYXllcl9pZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5zd2VycyBcIm9uIHdoYXRcIiAoXCJcIiBmb3Igb3BlbiBtYXApLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBbTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubGF0ICogMWU1KSAvIDFlNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQnVtcGVkIG9uIEVWRVJZIGNsaWNrOiBjbGlja2luZyB0aGUgc2FtZSBmZWF0dXJlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d2ljZSBjaGFuZ2VzIG5laXRoZXIgaWQgbm9yIGluZGV4LCBzbyB3aXRob3V0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIG5vIHRyYWl0IGZpcmVzIGFuZCBoYW5kbGVycyBtaXNzIHRoZSBjbGljay5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrX3NlcVwiLCAobW9kZWwuZ2V0KFwiY2xpY2tfc2VxXCIpIHx8IDApICsgMSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgIWZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbExpbmVzKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9zZW5zaXRpdml0eU9mZiA9IHRyYWNrTGluZVNlbnNpdGl2aXR5KG0sIHRoaXMuZ2xMaW5lcyk7XG4gICAgICAgICAgICAgICAgaWYgKHZlY3RvclRpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3dpZnRtYXBUaW1lID0gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UodGhpcy5nbExpbmVzLCB2ZWN0b3JNZXRhLCB2ZXJ0ZXhDb3VudHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2Vuc2l0aXZpdHlPZmYpIHRoaXMuX3NlbnNpdGl2aXR5T2ZmKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xMaW5lcykgdGhpcy5nbExpbmVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcbiAgICAgICAgICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICB2ZXJ0ZXhDb3VudHMucHVzaCgwKTsgICAvLyBubyBmZWF0dXJlLCBidXQgdGhlIHNsb3QgbXVzdCBzdGF5IGFsaWduZWRcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIEFueSB0cmlhbmd1bGF0aW9uIG9mIGEgcG9seWdvbiB3aXRoIEQgZGlzdGluY3QgdmVydGljZXMgYW5kIGggaG9sZXMgaGFzXG4gICAgICAgICAgICAvLyBleGFjdGx5IEQgKyAyaCAtIDIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzXG4gICAgICAgICAgICAvLyBlYXJjdXQ7IGggPSAwIGdpdmVzIHRoZSBmYW1pbGlhciBEIC0gMi4gUmluZ3MgYXJlIGNsb3NlZCBieSBub3csIHNvIGVhY2hcbiAgICAgICAgICAgIC8vIGNvbnRyaWJ1dGVzIGxlbmd0aCAtIDEgZGlzdGluY3QgdmVydGljZXMuIFBhcnRzIHRyaWFuZ3VsYXRlIHNlcGFyYXRlbHlcbiAgICAgICAgICAgIC8vIGFuZCBzdW0uXG4gICAgICAgICAgICBsZXQgdHJpYW5nbGVzID0gMDtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmluZ3Mgb2YgcGFydHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0aW5jdCA9IHJpbmdzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLmxlbmd0aCAtIDEsIDApO1xuICAgICAgICAgICAgICAgIHRyaWFuZ2xlcyArPSBNYXRoLm1heCgwLCBkaXN0aW5jdCArIDIgKiAocmluZ3MubGVuZ3RoIC0gMSkgLSAyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKDMgKiB0cmlhbmdsZXMpO1xuXG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcbiAgICAgICAgICAgIC8vIExlYWZsZXQncyBvd24gc2VtYW50aWNzOiB0aGUgZmlsbCBpcyBmaWxsQ29sb3IsIGRlZmF1bHRpbmcgdG8gdGhlIHN0cm9rZVxuICAgICAgICAgICAgLy8gY29sb3Igd2hlbiB1bnNldC4gSXQgdXNlZCB0byBhbHdheXMgZmlsbCB3aXRoIGBjb2xvcmAsIHdoaWNoIG1hZGVcbiAgICAgICAgICAgIC8vIFwicmVkIG91dGxpbmUsIHBhbGUgYmx1ZSBmaWxsXCIgLS0gdGhlIG1vc3QgYmFzaWMgcG9seWdvbiBzdHlsaW5nIGFzayAtLVxuICAgICAgICAgICAgLy8gaW1wb3NzaWJsZTsgdGhlIG91dGxpbmUgaXRzZWxmIGlzIGRyYXduIGJ5IHRoZSBsaW5lcyBidWNrZXQuXG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmZpbGxDb2xvciB8fCBzdHlsZS5maWxsX2NvbG9yIHx8IHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XG4gICAgICAgICAgICAvLyBPbmUgRmVhdHVyZSBQRVIgUEFSVCwgbmV2ZXIgYSBNdWx0aVBvbHlnb246IGdsaWZ5J3Mgc2hhcGVzIG9ubHlcbiAgICAgICAgICAgIC8vIGV4cGxvZGVzIE11bHRpUG9seWdvbiB3aGVuIGhhbmRlZCBhIGJhcmUgRmVhdHVyZSBvciBnZW9tZXRyeSAtLSBpbiBhXG4gICAgICAgICAgICAvLyBGZWF0dXJlQ29sbGVjdGlvbiB0aGUgY29vcmRpbmF0ZXMgcmVhY2ggZWFyY3V0LmZsYXR0ZW4gdW5leHBsb2RlZCxcbiAgICAgICAgICAgIC8vIGVhcmN1dCByZXR1cm5zIG5vIGluZGljZXMsIGFuZCB0aGUgZmVhdHVyZSBzaWxlbnRseSBkcmF3cyBaRVJPIGZpbGxcbiAgICAgICAgICAgIC8vIHRyaWFuZ2xlcyAodmVyaWZpZWQgYWdhaW5zdCBnbGlmeSAzLjMuMDsgaXRzIFwidW5oYW5kbGVkIHBvbHlnb25cIlxuICAgICAgICAgICAgLy8gdGhyb3cgc2l0cyBpbnNpZGUgdGhlIGVtcHR5IGxvb3AgYW5kIG5ldmVyIGZpcmVzKS4gUGFydHMgc3RheVxuICAgICAgICAgICAgLy8gY29uc2VjdXRpdmUsIHNvIHBlci1sYXllciB2ZXJ0ZXhDb3VudHMgc3RpbGwgYWxpZ24gZm9yIEdQVSB0aW1lLlxuICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBwYXJ0cykge1xuICAgICAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHsgdHlwZTogXCJQb2x5Z29uXCIsIGNvb3JkaW5hdGVzOiByaW5ncyB9LFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5maWxsT3BhY2l0eSB8fCAwLjIgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hhcGVPcHRpb25zID0gdmVjdG9yVGltZVxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xuICAgICAgICAgICAgICAgIHRoaXMuZ2xTaGFwZXMgPSBMLmdsaWZ5LnNoYXBlcyh7XG4gICAgICAgICAgICAgICAgICAgIC4uLnNoYXBlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZmVhdHVyZSB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgIXZpc2libGVOb3coZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSkgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMywgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFyZTogc2hpbnl3aWRnZXRzJyBtb2RlbCBoYXMgbm8gYGNvbW1gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHByb3BlcnR5LCBzbyBnYXRpbmcgb24gaXQgc2lsZW50bHkga2lsbGVkIHRoaXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBUaGUgc2lkZWJhciBhbHdheXMgd3JvdGUgYmFyZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgd2FzIHRoZSBvbmUgcGF0aCB0aGF0IHdvcmtlZCB0aGVyZS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVyZSB0aGUgY2xpY2sgbGFuZGVkLCBmZWF0dXJlIG9yIG5vdDogb25lXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0cmFpdCBhbHdheXMgYW5zd2VycyBcIndoZXJlXCIsIGNsaWNrZWRfbGF5ZXJfaWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF0bG5nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW01hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxhdCAqIDFlNSkgLyAxZTUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxuZyAqIDFlNSkgLyAxZTVdKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEJ1bXBlZCBvbiBFVkVSWSBjbGljazogY2xpY2tpbmcgdGhlIHNhbWUgZmVhdHVyZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHdpY2UgY2hhbmdlcyBuZWl0aGVyIGlkIG5vciBpbmRleCwgc28gd2l0aG91dFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBubyB0cmFpdCBmaXJlcyBhbmQgaGFuZGxlcnMgbWlzcyB0aGUgY2xpY2suXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja19zZXFcIiwgKG1vZGVsLmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiB2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsU2hhcGVzKTtcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZSh0aGlzLmdsU2hhcGVzLCB2ZWN0b3JNZXRhLCB2ZXJ0ZXhDb3VudHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbFNoYXBlcykgdGhpcy5nbFNoYXBlcy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgICAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgY29uc3QgcG9pbnRzTGlzdCA9IFtdO1xuICAgIGNvbnN0IGluZGV4TWFwcGluZyA9IFtdO1xuXG4gICAgY29uc3QgZmFsbGJhY2tDb2xvciA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gXCIjZTYxYTI2XCIgOiBcIiMzMzg4ZmZcIjtcbiAgICAvLyBnbGlmeSdzIGZhbGxiYWNrIHdoZW4gYSBsYXllciBkZWNsYXJlcyBubyByYWRpdXMuIFBpbnMgbmVlZCBmYXIgbW9yZSByb29tIHRoYW4gYVxuICAgIC8vIGNpcmNsZSBiZWNhdXNlIHRoZSBnbHlwaCBpcyBkcmF3biBpbnNpZGUgdGhlIHBvaW50J3Mgb3duIHF1YWQgYnkgdGhlIHNoYWRlci5cbiAgICBjb25zdCBkZWZhdWx0U2l6ZSA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gNjQgOiA1O1xuXG4gICAgLy8gR1BVIHRpbWUgcGF0aDogd2hlbiB0aGlzIGJ1Y2tldCBob2xkcyB0aW1lIGxheWVycywgZXZlcnkgcG9pbnQgaXMgZmVkIHRvIGdsaWZ5IGFuZFxuICAgIC8vIHBlci1wb2ludCB0aW1lIHJpZGVzIGFsb25nIGFzIHZlcnRleCBhdHRyaWJ1dGVzIC0tIHRoZSB3aW5kb3cgdGVzdCBoYXBwZW5zIGluIHRoZVxuICAgIC8vIHZlcnRleCBzaGFkZXIsIHNvIGEgdGljayBjb3N0cyB0d28gdW5pZm9ybXMgaW5zdGVhZCBvZiByZWJ1aWxkaW5nIDVNIHBvaW50cyBpbiBKUy5cbiAgICAvLyBUaGUgQ1BVIGZpbHRlciBiZWxvdyBzdGF5cyBhcyB0aGUgZmFsbGJhY2sgd2hlbiB0aGUgR0wgd2lyaW5nIGlzIHVuYXZhaWxhYmxlLlxuICAgIGNvbnN0IGdwdUF0dHJzID0gZ3B1VGltZUF2YWlsYWJsZSgpXG4gICAgICAgID8gYnVpbGRUaW1lQXR0cmlidXRlcyhsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycyxcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXG4gICAgICAgIDogeyBoYXNUaW1lOiBmYWxzZSB9O1xuICAgIGNvbnN0IGdwdVRpbWUgPSBCb29sZWFuKGdwdUF0dHJzLmhhc1RpbWUpO1xuXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgIGNvbnN0IGNvbG9yUkdCID0gcGFyc2VDb2xvcihsYXllci5jb2xvciwgZmFsbGJhY2tDb2xvcik7XG4gICAgICAgIGNvbnN0IGxheWVyU2l6ZSA9IGxheWVyLnJhZGl1cyAhPSBudWxsID8gTnVtYmVyKGxheWVyLnJhZGl1cykgOiBkZWZhdWx0U2l6ZTtcblxuICAgICAgICBjb25zdCBjb29yZEJ1ZmZlciA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xuICAgICAgICAgICAgaWYgKGxheWVyLmxvY2F0aW9uICYmIGxheWVySW5XaW5kb3cobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKSB7XG4gICAgICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtsYXllci5sb2NhdGlvblswXSwgbGF5ZXIubG9jYXRpb25bMV1dKTtcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxJbmRleDogMCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCLFxuICAgICAgICAgICAgICAgICAgICBzaXplOiBsYXllclNpemVcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ1ZmZlcixcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVPZmZzZXQsXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5ieXRlTGVuZ3RoIC8gOFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBjb3VudCA9IGNvb3Jkcy5sZW5ndGggLyAyO1xuXG4gICAgICAgIGNvbnN0IHBlckZlYXR1cmUgPSBBcnJheS5pc0FycmF5KGxheWVyLmZlYXR1cmVfc3R5bGVzKSA/IGxheWVyLmZlYXR1cmVfc3R5bGVzIDogbnVsbDtcbiAgICAgICAgLy8gU2VsZWN0aW9uIHN0eWxpbmcsIGFwcGxpZWQgb3ZlciB0aGUgbGF5ZXIncyBvd24gYW5kIGl0cyBkYXRhLWRyaXZlbiBzdHlsZXMuXG4gICAgICAgIC8vIFNhbWUgcHJlY2VkZW5jZSBhcyBzdHlsZUZvcjogZGF0YSwgdGhlbiB3aG9sZS1sYXllciBoaWdobGlnaHQsIHRoZW4gcGVyLWZlYXR1cmUuXG4gICAgICAgIGNvbnN0IGhpZ2hsaWdodCA9IGxheWVyLmhpZ2hsaWdodF9zdHlsZSB8fCBudWxsO1xuICAgICAgICBjb25zdCBvdmVycmlkZXMgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgfHwgbnVsbDtcbiAgICAgICAgLy8gRGF0YS1kcml2ZW4gc3R5bGluZyBhcnJpdmVzIGFzIGJpbmFyeSBidWZmZXJzIGJlc2lkZSB0aGUgY29vcmRpbmF0ZXMgLS1cbiAgICAgICAgLy8gdTggUkdCQSB1bmRlciBcIjxpZD46OmNvbG9yc1wiLCBmMzIgcGl4ZWxzIHVuZGVyIFwiPGlkPjo6cmFkaWlcIiAtLSBjb21wdXRlZFxuICAgICAgICAvLyBpbiBQeXRob24gZnJvbSBjb2xvcl9jb2wvcmFkaXVzX2NvbC4gQnVmZmVycywgbmV2ZXIgcGVyLWZlYXR1cmUgc3R5bGVcbiAgICAgICAgLy8gZGljdHM6IGF0IG1pbGxpb25zIG9mIHBvaW50cywgc3R5bGUgZGljdHMgaW4gdGhlIGxheWVycyBKU09OIGFyZSB0aGVcbiAgICAgICAgLy8gcGF5bG9hZCB0aGF0IHVzZWQgdG8ga2lsbCBzZXNzaW9ucy4gRXhwbGljaXQgc3R5bGVzIHN0aWxsIG91dHJhbmsgdGhlbS5cbiAgICAgICAgY29uc3QgY29sb3JzUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojpjb2xvcnNgXTtcbiAgICAgICAgY29uc3QgYnVmQ29sb3JzID0gY29sb3JzUmF3XG4gICAgICAgICAgICA/IG5ldyBVaW50OEFycmF5KGNvbG9yc1Jhdy5idWZmZXIgfHwgY29sb3JzUmF3LCBjb2xvcnNSYXcuYnl0ZU9mZnNldCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcnNSYXcuYnl0ZUxlbmd0aClcbiAgICAgICAgICAgIDogbnVsbDtcbiAgICAgICAgY29uc3QgcmFkaWlSYXcgPSBjb29yZGluYXRlQnVmZmVyc1tgJHtsYXllci5pZH06OnJhZGlpYF07XG4gICAgICAgIGNvbnN0IGJ1ZlJhZGlpID0gcmFkaWlSYXdcbiAgICAgICAgICAgID8gbmV3IEZsb2F0MzJBcnJheShyYWRpaVJhdy5idWZmZXIgfHwgcmFkaWlSYXcsIHJhZGlpUmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByYWRpaVJhdy5ieXRlTGVuZ3RoIC8gNClcbiAgICAgICAgICAgIDogbnVsbDtcbiAgICAgICAgLy8gVGhlIGN1cnJlbnQgdGltZSB3aW5kb3csIHdoZW4gdGhpcyBsYXllciBpcyBhbmltYXRlZC4gRmVhdHVyZXMgb3V0c2lkZSBpdCBhcmVcbiAgICAgICAgLy8gc2ltcGx5IG5vdCBwdXNoZWQ7IGluZGV4TWFwcGluZyBjYXJyaWVzIG9yaWdpbmFsSW5kZXgsIHNvIHBvcHVwcyBhbmQgcHJvcGVydGllc1xuICAgICAgICAvLyBvbiB0aGUgc3Vydml2b3JzIGtlZXAgcG9pbnRpbmcgYXQgdGhlIHJpZ2h0IHJvd3MuXG4gICAgICAgIGNvbnN0IHdpbiA9ICFncHVUaW1lICYmIHRpbWVTdGF0ZSAmJiBsYXllci50aW1lXG4gICAgICAgICAgICA/IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpXG4gICAgICAgICAgICA6IG51bGw7XG4gICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAodGltZXMgJiYgIWZlYXR1cmVJbldpbmRvdyh0aW1lc1tpICogMl0sIHRpbWVzW2kgKiAyICsgMV0sIHdpbikpIGNvbnRpbnVlO1xuICAgICAgICAgICAgY29uc3QgZnJvbURhdGEgPSBwZXJGZWF0dXJlID8gcGVyRmVhdHVyZVtpXSA6IG51bGw7XG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XG4gICAgICAgICAgICBjb25zdCBjb2xvciA9IChzZWxlY3RlZCAmJiBzZWxlY3RlZC5jb2xvcilcbiAgICAgICAgICAgICAgICB8fCAoaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5jb2xvcilcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xuICAgICAgICAgICAgY29uc3QgcmFkaXVzID0gc2VsZWN0ZWQgJiYgc2VsZWN0ZWQucmFkaXVzICE9IG51bGwgPyBzZWxlY3RlZC5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IGhpZ2hsaWdodCAmJiBoaWdobGlnaHQucmFkaXVzICE9IG51bGwgPyBoaWdobGlnaHQucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xuICAgICAgICAgICAgICAgIDogbnVsbDtcblxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xuICAgICAgICAgICAgaW5kZXhNYXBwaW5nLnB1c2goe1xuICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxuICAgICAgICAgICAgICAgIGNvbG9yUkdCOiBjb2xvciA/IHBhcnNlQ29sb3IoY29sb3IsIGZhbGxiYWNrQ29sb3IpXG4gICAgICAgICAgICAgICAgICAgIDogYnVmQ29sb3JzID8geyByOiBidWZDb2xvcnNbaSAqIDRdIC8gMjU1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZzogYnVmQ29sb3JzW2kgKiA0ICsgMV0gLyAyNTUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiOiBidWZDb2xvcnNbaSAqIDQgKyAyXSAvIDI1NSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGE6IGJ1ZkNvbG9yc1tpICogNCArIDNdIC8gMjU1IH1cbiAgICAgICAgICAgICAgICAgICAgOiBjb2xvclJHQixcbiAgICAgICAgICAgICAgICBzaXplOiByYWRpdXMgIT0gbnVsbCA/IE51bWJlcihyYWRpdXMpXG4gICAgICAgICAgICAgICAgICAgIDogYnVmUmFkaWkgPyBidWZSYWRpaVtpXVxuICAgICAgICAgICAgICAgICAgICA6IGxheWVyU2l6ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9pbnRzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XG4gICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpIHx8IG1hcC5nZXRDb250YWluZXIoKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gZ2V0SW50ZXJhY3RpdmVFbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcblxuICAgICAgICAgICAgY29uc3QgZ2xpZnlPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIG1hcDogbSxcbiAgICAgICAgICAgICAgICBkYXRhOiBwb2ludHNMaXN0LFxuICAgICAgICAgICAgICAgIHBhbmU6IFwicG9pbnRzUGFuZVwiLFxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcbiAgICAgICAgICAgICAgICAvLyBzbyBhIHNpbmdsZSBjb25zdGFudCBoZXJlIHNpbGVudGx5IGRpc2NhcmRlZCBldmVyeSBsYXllcidzIG93biByYWRpdXMuXG4gICAgICAgICAgICAgICAgc2l6ZTogKGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyAmJiBpbmZvLnNpemUgIT0gbnVsbCA/IGluZm8uc2l6ZSA6IGRlZmF1bHRTaXplO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvID8gaW5mby5jb2xvclJHQiA6IHsgcjogMC4yLCBnOiAwLjUsIGI6IDEuMCB9O1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcGlja2luZzogdHJ1ZSxcbiAgICAgICAgICAgICAgICBzZW5zaXRpdml0eTogdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyMCA6IDgsXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXBvaW50KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsaWNrUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChlLmxhdGxuZyk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoTC5sYXRMbmcocG9pbnRbMF0sIHBvaW50WzFdKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1heERpc3QgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDI1IDogMTI7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwaXhlbERpc3QgPiBtYXhEaXN0KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gUmVzb2x2ZWQgQkVGT1JFIGNvbXBldGluZyBmb3IgdGhlIGNsaWNrOiBhIGhpZGRlbiBvclxuICAgICAgICAgICAgICAgICAgICAvLyBvdXQtb2Ytd2luZG93IHBvaW50IG11c3Qgbm90IGVudGVyIHRoZSBhcmJpdHJhdGlvbiBhdCBhbGwsIHNvXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoYXRldmVyIHNpdHMgYmVuZWF0aCBpdCAtLSBhIHZpc2libGUgZmVhdHVyZSwgb3IgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vIGVtcHR5LW1hcCBmYWxsYmFjayAtLSB3aW5zIGluc3RlYWQuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZUluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFwcmVJbmZvIHx8ICF2aXNpYmxlTm93KHByZUluZm8ubGF5ZXIsIHByZUluZm8ub3JpZ2luYWxJbmRleCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gcHJlSW5mbztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBpbmZvLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBwb2ludCwgcHJvcHMsIGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgb3JpZ2luYWxJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoZSBjbGlja2VkIHBvaW50J3Mgb3duIGNvb3JkaW5hdGVzIC0tIG1vcmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJ1dGhmdWwgdGhhbiB0aGUgbW91c2UgcG9zaXRpb24gZm9yIGEgcG9pbnQuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF0bG5nXCIsIFtwb2ludFswXSwgcG9pbnRbMV1dKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQnVtcGVkIG9uIEVWRVJZIGNsaWNrOyBzZWUgdGhlIHZlY3RvciBjbGljayBoYW5kbGVycy5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBvaW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaG92ZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoTC5sYXRMbmcocG9pbnRbMF0sIHBvaW50WzFdKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaXhlbERpc3QgPiBtYXhEaXN0KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2lkeF07XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWluZm8gfHwgIXZpc2libGVOb3coaW5mby5sYXllciwgaW5mby5vcmlnaW5hbEluZGV4KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gZ2V0SW50ZXJhY3RpdmVFbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gaW5mby5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBwb2ludCwgcHJvcHMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy5mcmFnbWVudFNoYWRlclNvdXJjZSA9ICgpID0+IHBpblNoYWRlcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcbiAgICAgICAgICAgICAgICBnbGlmeU9wdGlvbnMudmVydGV4U2hhZGVyU291cmNlID0gKCkgPT4gdGltZVZlcnRleFNoYWRlcigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5nbFBvaW50cyA9IEwuZ2xpZnkucG9pbnRzKGdsaWZ5T3B0aW9ucyk7XG4gICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsUG9pbnRzKTtcbiAgICAgICAgICAgIGlmIChncHVUaW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gTnVsbCBvbiBmYWlsdXJlLCB3aGljaCBhbHNvIGZsaXBzIHRoZSBnbG9iYWwgZmxhZzogdGhlIG5leHQgc3luYydzXG4gICAgICAgICAgICAgICAgLy8gcmVidWlsZCBrZXkgY2hhbmdlcyB3aXRoIGl0IGFuZCB0aGUgQ1BVIHBhdGggdGFrZXMgb3Zlci5cbiAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9JbnN0YW5jZSh0aGlzLmdsUG9pbnRzLCBncHVBdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XG4gICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcbiAgICAgICAgICAgIGlmIChjYW52YXMpIGNhbnZhcy5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICByZXR1cm4gaW5zdGFuY2U7XG59XG4iLCAiLy8gUGVybWFuZW50IGZlYXR1cmUgbGFiZWxzOiB0ZXh0IHBpbm5lZCB0byB0aGUgbWFwLCBmcm9tIGEgbGF5ZXIncyBgbGFiZWxgIChvbmVcbi8vIHZlY3RvciBmZWF0dXJlKSBvciBgbGFiZWxzYCAob25lIHBlciBwb2ludCwgYWxpZ25lZCB3aXRoIHRoZSBjb29yZGluYXRlIGJ1ZmZlcikuXG4vLyBET00gZWxlbWVudHMgYnkgZGVzaWduIC0tIExlYWZsZXQgcGVybWFuZW50IHRvb2x0aXBzIC0tIHdoaWNoIGlzIHdoeSB0aGV5IGFyZSBmb3Jcbi8vIHNpdGUtc2NhbGUgbGF5ZXJzOyBQeXRob24gd2FybnMgcGFzdCBhIHRob3VzYW5kLiBNb2RlbC1mcmVlIGxpa2UgdGhlIGxlZ2VuZDogcHVyZVxuLy8gZGF0YSBpbiwgTGVhZmxldCBsYXllcnMgb3V0LCByZS1kZXJpdmVkIGVhY2ggc3luYyBzbyBsYWJlbHMgZm9sbG93IHZpc2liaWxpdHlcbi8vIHdpdGhvdXQgdG91Y2hpbmcgdGhlIEdMIGJ1Y2tldHMgb3IgdGhlaXIgbWV0YSBrZXlzLlxuXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSB9IGZyb20gXCIuL21hcC5qc1wiO1xuaW1wb3J0IHsgdmVjdG9yQ29vcmRzIH0gZnJvbSBcIi4vbGF5ZXJzLmpzXCI7XG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcblxuLy8gV2hldGhlciBhIHdob2xlIGxhYmVsbGVkIGZlYXR1cmUgaXMgaW5zaWRlIHRoZSBjdXJyZW50IHRpbWUgd2luZG93LiBOYU4gdGltZXNcbi8vIGtlZXAgdGhlIGxhYmVsLCBtYXRjaGluZyB0aGUgbWFwOiBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YSwgc28gaXRcbi8vIG11c3QgbmV2ZXIgaGlkZSB0aGUgZGF0YSdzIGxhYmVsIGVpdGhlci4gQSBtdWx0aS1zcGFuIGxpbmUgY291bnRzIGFzIHZpc2libGVcbi8vIHdoaWxlIEFOWSBvZiBpdHMgc2VnbWVudHMgaXMgLS0gdGhlIGxhYmVsIGZvbGxvd3MgdGhlIGxheWVyLCBub3Qgb25lIGxlZy5cbmZ1bmN0aW9uIHRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcbiAgICBpZiAoIXRpbWVTdGF0ZSB8fCAhbGF5ZXIudGltZSkgcmV0dXJuIHRydWU7XG4gICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihsYXllciwgYnVmZmVycyk7XG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB3aW4gPSB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUucGVyaW9kKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgaWYgKGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyBPbmUgYW5jaG9yIHBlciBsYWJlbGxlZCBmZWF0dXJlLiBQb2ludHMgbGFiZWwgYXQgdGhlIHBvaW50OyBhIGxpbmUgbGFiZWxzIGF0IGl0c1xuLy8gbWlkZGxlIHZlcnRleCAob24gdGhlIGxpbmUsIG5vdCBmbG9hdGluZyBpbiBpdHMgYm91bmRpbmcgYm94KTsgYSBwb2x5Z29uIG9yXG4vLyBjaXJjbGUgbGFiZWxzIGF0IGl0cyBib3VuZHMgY2VudHJlLiBXaXRoIGEgdGltZVN0YXRlLCBsYWJlbHMgZm9sbG93IHRoZSB3aW5kb3c6XG4vLyBwb2ludHMgZHJvcCBwZXIgcG9pbnQsIHZlY3RvcnMgYXMgYSB3aG9sZS5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUgPSBudWxsKSB7XG4gICAgY29uc3Qgb3V0ID0gW107XG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcbiAgICAgICAgaWYgKCFpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzIHx8IHt9KSkgY29udGludWU7XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLmNvbGxlY3RMYWJlbHMobGF5ZXIubGF5ZXJzIHx8IFtdLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSkpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobGF5ZXIubGFiZWxzKSkge1xuICAgICAgICAgICAgY29uc3QgcmF3ID0gYnVmZmVycyAmJiBidWZmZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgIGlmICghcmF3KSBjb250aW51ZTtcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgICAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG4gICAgICAgICAgICBjb25zdCB3aW4gPSB0aW1lU3RhdGUgJiYgbGF5ZXIudGltZVxuICAgICAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUucGVyaW9kKVxuICAgICAgICAgICAgICAgIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IGNvdW50ID0gTWF0aC5taW4obGF5ZXIubGFiZWxzLmxlbmd0aCwgY29vcmRzLmxlbmd0aCAvIDIpO1xuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFsYXllci5sYWJlbHNbaV0pIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhTnVtYmVyLmlzTmFOKHRpbWVzW2kgKiAyXSlcbiAgICAgICAgICAgICAgICAgICAgICAgICYmICFmZWF0dXJlSW5XaW5kb3codGltZXNbaSAqIDJdLCB0aW1lc1tpICogMiArIDFdLCB3aW4pKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogY29vcmRzW2kgKiAyXSwgbG5nOiBjb29yZHNbaSAqIDIgKyAxXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbHNbaV0pLCBjZW50ZXI6IGZhbHNlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGxheWVyLmxhYmVsKSB7XG4gICAgICAgICAgICBpZiAoIXRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlsaW5lXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBidWZmZXJzIHx8IHt9KSB8fCBbXTtcbiAgICAgICAgICAgICAgICBpZiAobG9jcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZCA9IGxvY3NbTWF0aC5mbG9vcigobG9jcy5sZW5ndGggLSAxKSAvIDIpXTtcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbWlkWzBdLCBsbmc6IG1pZFsxXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogZmFsc2UgfSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGxheWVyLmJvdW5kcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtbYUxhdCwgYUxvbl0sIFtiTGF0LCBiTG9uXV0gPSBsYXllci5ib3VuZHM7XG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IChhTGF0ICsgYkxhdCkgLyAyLCBsbmc6IChhTG9uICsgYkxvbikgLyAyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiB0cnVlIH0pO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5sb2NhdGlvbikge1xuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiBsYXllci5sb2NhdGlvblswXSwgbG5nOiBsYXllci5sb2NhdGlvblsxXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gTm8gYm91bmRzIG9uIHRoZSBjb25maWcgLS0gdGhlIGNvbGxlY3Rpb24gbWVyZ2UgZHJvcHBlZCB0aGVtIGZvclxuICAgICAgICAgICAgICAgIC8vIGl0cyB3aG9sZSBoaXN0b3J5LCBhbmQgaGFuZC1idWlsdCBjb25maWdzIG1heSBuZXZlciBjYXJyeSB0aGVtLlxuICAgICAgICAgICAgICAgIC8vIFRoZSBjb29yZGluYXRlcyBhcmUgc3RpbGwgaW4gdGhlIGJ1ZmZlciB1bmRlciB0aGUgbGF5ZXIncyBvd24gaWQsXG4gICAgICAgICAgICAgICAgLy8gZXhhY3RseSBhcyB0aGUgcG9seWxpbmUgYnJhbmNoIHJlYWRzIHRoZW07IGEgbWlzc2luZyBib3ggbXVzdFxuICAgICAgICAgICAgICAgIC8vIGRlZ3JhZGUgdG8gY29tcHV0aW5nIG9uZSwgbmV2ZXIgdG8gc2lsZW50bHkgZHJvcHBpbmcgdGhlIGxhYmVsLlxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xuICAgICAgICAgICAgICAgIGlmIChsb2NzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgbGV0IG1pbkxuZyA9IEluZmluaXR5LCBtYXhMbmcgPSAtSW5maW5pdHk7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBbbGF0LCBsbmddIG9mIGxvY3MpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xuICAgICAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsbmcgPCBtaW5MbmcpIG1pbkxuZyA9IGxuZztcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA+IG1heExuZykgbWF4TG5nID0gbG5nO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKG1pbkxhdCArIG1heExhdCkgLyAyLCBsbmc6IChtaW5MbmcgKyBtYXhMbmcpIC8gMixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gb3V0O1xufVxuXG4vLyBSZWJ1aWxkcyBgZ3JvdXBgIChhbiBMLmxheWVyR3JvdXApIHRvIGhvbGQgZXhhY3RseSB0aGUgY3VycmVudCBsYWJlbHMsIHNraXBwaW5nXG4vLyB0aGUgd29yayB3aGVuIG5vdGhpbmcgY2hhbmdlZCAtLSBzeW5jcyBydW4gb24gZXZlcnkgdG9nZ2xlIGFuZCB0aWNrLlxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckxhYmVscyhMLCBncm91cCwgbGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcbiAgICBjb25zdCBsYWJlbHMgPSBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUpO1xuICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KGxhYmVscyk7XG4gICAgaWYgKGdyb3VwLl9zd2lmdG1hcExhYmVsS2V5ID09PSBrZXkpIHJldHVybjtcbiAgICBncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9IGtleTtcbiAgICBncm91cC5jbGVhckxheWVycygpO1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBsYWJlbHMpIHtcbiAgICAgICAgLy8gQ29udGVudCBhcyBhbiBlbGVtZW50IHdpdGggdGV4dENvbnRlbnQ6IHRvb2x0aXAgc3RyaW5nIGNvbnRlbnQgaXMgSFRNTCxcbiAgICAgICAgLy8gYW5kIGxhYmVscyBjb21lIGZyb20gdXNlciBkYXRhLCB3aGljaCBtdXN0IG5ldmVyIHBhcnNlIGFzIG1hcmt1cC5cbiAgICAgICAgY29uc3Qgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gaXRlbS50ZXh0O1xuICAgICAgICBjb25zdCB0b29sdGlwID0gTC50b29sdGlwKHtcbiAgICAgICAgICAgIHBlcm1hbmVudDogdHJ1ZSxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogaXRlbS5jZW50ZXIgPyBcImNlbnRlclwiIDogXCJ0b3BcIixcbiAgICAgICAgICAgIGNsYXNzTmFtZTogXCJzd2lmdG1hcC1mZWF0dXJlLWxhYmVsXCIsXG4gICAgICAgICAgICBvZmZzZXQ6IGl0ZW0uY2VudGVyID8gWzAsIDBdIDogWzAsIC02XSxcbiAgICAgICAgfSkuc2V0TGF0TG5nKFtpdGVtLmxhdCwgaXRlbS5sbmddKS5zZXRDb250ZW50KHNwYW4pO1xuICAgICAgICBncm91cC5hZGRMYXllcih0b29sdGlwKTtcbiAgICB9XG59XG4iLCAiaW1wb3J0IHsgbG9hZENTUywgbG9hZEpTIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHJlbmRlclNpZGViYXJDb250cm9scywgbm9ybWFsaXplUmFkaW9MYXllcnMsIHNlbmRMYXllcldyaXRlIH0gZnJvbSBcIi4vc2lkZWJhci5qc1wiO1xuaW1wb3J0IHsgZGVyaXZlTGVnZW5kU3BlYywgcmVuZGVyTGVnZW5kIH0gZnJvbSBcIi4vbGVnZW5kLmpzXCI7XG5pbXBvcnQgeyByZW5kZXJMYWJlbHMgfSBmcm9tIFwiLi9sYWJlbHMuanNcIjtcbmltcG9ydCB7IHJlbmRlckxheWVyLCByZW5kZXJNZXJnZWRHbExheWVyLCByZWdpc3RlckNsaWNrTWF0Y2gsIGltYWdlTWV0YUtleSB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIGdlbmVyYXRlVGlja3MsIGNvbGxlY3RUaW1lRXh0ZW50LCBoYXNUaW1lTGF5ZXJzLFxuICAgICAgICAgbGF5ZXJJbldpbmRvdywgcmVuZGVyVGltZUNvbnRyb2wsIGFkdmFuY2UsIHBlcmlvZFRvTXMsIGdjZEdyaWRNcyxcbiAgICAgICAgIGNvbGxlY3REdXJhdGlvbnNNcywgUE9TSVRJT05TLCB0aW1lc0Zvciwgd2luZG93Rm9yLCBmZWF0dXJlSW5XaW5kb3csXG4gICAgICAgICBlZmZlY3RpdmVEdXJhdGlvbiB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XG5pbXBvcnQgeyBncHVUaW1lQXZhaWxhYmxlLCB2ZWN0b3JHcHVBdmFpbGFibGUsIExBWUVSX1NMT1RTIH0gZnJvbSBcIi4vZ3B1dGltZS5qc1wiO1xuXG4vLyBUcnVlIGlmIGEgbGF5ZXIgaXMgdmlzaWJsZSBhbmQgbm8gZm9sZGVyIGFib3ZlIGl0IGlzIHN3aXRjaGVkIG9mZi5cbi8vXG4vLyBWaXNpYmlsaXR5IGlzIGluaGVyaXRlZCBkb3duIHRoZSBmb2xkZXIgcGF0aDogYSBsYXllciBpbnNpZGUgXCJGZWVkcy9BY3RpdmVcIiBpcyBoaWRkZW5cbi8vIHdoZW4gZWl0aGVyIFwiRmVlZHNcIiBvciBcIkZlZWRzL0FjdGl2ZVwiIGlzIG9mZiwgcmVnYXJkbGVzcyBvZiBpdHMgb3duIGZsYWcuIEdldHRpbmcgdGhpc1xuLy8gd3Jvbmcgc2hvd3MgdXAgYXMgXCJ0aGF0IGxheWVyIGp1c3Qgd2lsbCBub3QgYXBwZWFyXCIsIHdpdGggbm90aGluZyBsb2dnZWQuXG5leHBvcnQgZnVuY3Rpb24gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncykge1xuICAgIGlmIChsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICAgIGxldCBydW5uaW5nUGF0aCA9IFwiXCI7XG4gICAgZm9yIChjb25zdCBwYXJ0IG9mIChsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5zcGxpdChcIi9cIikpIHtcbiAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGdyb3VwQ29uZmlnc1tydW5uaW5nUGF0aF07XG4gICAgICAgIGlmIChjb25maWcgJiYgY29uZmlnLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufVxuXG4vLyBTb3J0cyB0aGUgdmlzaWJsZSBsYXllcnMgaW50byBvbmUgYnVja2V0IHBlciBXZWJHTCBkcmF3IHBhc3MuXG4vL1xuLy8gU3ViLWxheWVycyBvZiBhIG1lcmdlZCBncm91cCBpbmhlcml0IHRoZWlyIHBhcmVudCdzIHZpc2liaWxpdHkgcmF0aGVyIHRoYW4gY2Fycnlpbmdcbi8vIHRoZWlyIG93biwgc28gYSBncm91cCB0b2dnbGVkIG9mZiBjb250cmlidXRlcyBub3RoaW5nIGV2ZW4gd2hlbiBpdHMgY2hpbGRyZW4gc2F5XG4vLyB2aXNpYmxlLiBDaXJjbGVzIGpvaW4gdGhlIHBvbHlnb24gYnVja2V0OiB0aGV5IGFyZSBkcmF3biBhcyBnZW5lcmF0ZWQgcmluZ3MuXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3QgYnVja2V0cyA9IHsgY2lyY2xlX21hcmtlcnM6IFtdLCBtYXJrZXJzOiBbXSwgcG9seWxpbmU6IFtdLCBwb2x5Z29uOiBbXSB9O1xuXG4gICAgZnVuY3Rpb24gY29sbGVjdChsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWJMYXllcikge1xuICAgICAgICBpZiAoIXBhcmVudFZpc2libGUpIHJldHVybjtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGxheWVyLmxheWVycy5mb3JFYWNoKHN1YiA9PiBjb2xsZWN0KHN1YiwgcGFyZW50VmlzaWJsZSwgdHJ1ZSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghaXNTdWJMYXllciAmJiBsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGJ1Y2tldCA9IGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIgPyBcInBvbHlnb25cIiA6IGxheWVyLnR5cGU7XG4gICAgICAgIGlmIChidWNrZXRzW2J1Y2tldF0pIGJ1Y2tldHNbYnVja2V0XS5wdXNoKGxheWVyKTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xuICAgICAgICBjb2xsZWN0KGxheWVyLCBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSwgZmFsc2UpO1xuICAgIH1cbiAgICByZXR1cm4gYnVja2V0cztcbn1cblxuLy8gQXBwbGllcyBpbmNyZW1lbnRhbCBwYXRjaCBvcHMgdG8ge2xheWVycywgYnVmZmVyc30sIHJldHVybmluZyB0aGUgbmV3IHN0YXRlLlxuLy9cbi8vIE9wcyBhcmUgYWRkcmVzc2VkIGJ5IGxheWVyIGlkIGFuZCBhcHBsaWVkIGlkZW1wb3RlbnRseTogXCJhZGRcIiB1cHNlcnRzIHJhdGhlciB0aGFuXG4vLyBhcHBlbmRpbmcgYmxpbmRseSwgc28gYSBwYXRjaCB0aGF0IHJhY2VzIHRoZSBpbml0aWFsIHRyYWl0IHNuYXBzaG90IGNhbm5vdCBkdXBsaWNhdGVcbi8vIGEgbGF5ZXIsIGFuZCBhIFwicmVtb3ZlXCIgZm9yIHNvbWV0aGluZyBhbHJlYWR5IGdvbmUgaXMgYSBuby1vcC5cbi8vIEFwcGxpZXMgYHVwZGF0ZWAgdG8gb25lIGxheWVyIHdoZXJldmVyIGl0IHNpdHMsIGRlc2NlbmRpbmcgaW50byBncm91cHMuIGFkZF9jb2xsZWN0aW9uXG4vLyBuZXN0cyBpdHMgcG9pbnQsIGxpbmUgYW5kIHBvbHlnb24gbGF5ZXJzIGluc2lkZSBhIGdyb3VwIGxheWVyLCBzbyBhbiBvcCBhZGRyZXNzZWQgYXQgYVxuLy8gbmVzdGVkIGlkIHdvdWxkIG90aGVyd2lzZSBtYXRjaCBub3RoaW5nIGFuZCBzaWxlbnRseSBkbyBub3RoaW5nLiBSZXR1cm5zIHRoZSBvcmlnaW5hbFxuLy8gYXJyYXkgdW50b3VjaGVkIHdoZW4gdGhlIGlkIGlzIG5vdCBmb3VuZCwgc28gYW4gdW5tYXRjaGVkIG9wIGNvc3RzIG5vIHJlLXJlbmRlci5cbmZ1bmN0aW9uIHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIGlkLCB1cGRhdGUpIHtcbiAgICBsZXQgaGl0ID0gZmFsc2U7XG4gICAgY29uc3QgbmV4dCA9IGxheWVycy5tYXAobCA9PiB7XG4gICAgICAgIGlmIChsLmlkID09PSBpZCkge1xuICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgIHJldHVybiB1cGRhdGUobCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIEFycmF5LmlzQXJyYXkobC5sYXllcnMpKSB7XG4gICAgICAgICAgICBjb25zdCBzdWJzID0gdXBkYXRlTGF5ZXJCeUlkKGwubGF5ZXJzLCBpZCwgdXBkYXRlKTtcbiAgICAgICAgICAgIGlmIChzdWJzICE9PSBsLmxheWVycykge1xuICAgICAgICAgICAgICAgIGhpdCA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4ubCwgbGF5ZXJzOiBzdWJzIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGw7XG4gICAgfSk7XG4gICAgcmV0dXJuIGhpdCA/IG5leHQgOiBsYXllcnM7XG59XG5cbi8vIEV2ZXJ5IHBvaW50IGxheWVyLCB2aXNpYmxlIG9yIG5vdCwgd2l0aCBpdHMgZWZmZWN0aXZlIHZpc2liaWxpdHkgcmVjb3JkZWQgLS0gdGhlXG4vLyBHUFUtdmlzaWJpbGl0eSBwYXRoIGtlZXBzIGhpZGRlbiBsYXllcnMgaW4gdGhlIGJ1Y2tldCAoc3RhYmxlIGlkcywgbm8gcmVidWlsZCBvbiBhXG4vLyB0b2dnbGUpIGFuZCBoaWRlcyB0aGVtIHdpdGggYSB1bmlmb3JtIGluc3RlYWQuIE1pcnJvcnMgY29sbGVjdFdlYmdsTGF5ZXJzJyBydWxlczpcbi8vIHN1Yi1sYXllcnMgaW5oZXJpdCB0aGVpciBwYXJlbnQncyBlZmZlY3RpdmUgdmlzaWJpbGl0eSwgdG9wLWxldmVsIGxheWVycyBhbnN3ZXIgZm9yXG4vLyB0aGVpciBvd24gZmxhZyBhbmQgdGhlaXIgZm9sZGVyIGNoYWluLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncykge1xuICAgIGNvbnN0IG91dCA9IHsgY2lyY2xlX21hcmtlcnM6IFtdLCBtYXJrZXJzOiBbXSwgcG9seWxpbmU6IFtdLCBwb2x5Z29uOiBbXSB9O1xuICAgIGZ1bmN0aW9uIHdhbGsobGF5ZXIsIHBhcmVudFZpc2libGUsIGlzU3ViKSB7XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XG4gICAgICAgICAgICBjb25zdCBzZWxmVmlzID0gcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIGxheWVyLmxheWVycy5mb3JFYWNoKHN1YiA9PiB3YWxrKHN1Yiwgc2VsZlZpcywgdHJ1ZSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGJ1Y2tldCA9IGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIgPyBcInBvbHlnb25cIiA6IGxheWVyLnR5cGU7XG4gICAgICAgIGlmICghb3V0W2J1Y2tldF0pIHJldHVybjtcbiAgICAgICAgY29uc3QgdmlzID0gaXNTdWIgPyBwYXJlbnRWaXNpYmxlXG4gICAgICAgICAgICA6IHBhcmVudFZpc2libGUgJiYgaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgIG91dFtidWNrZXRdLnB1c2goeyBsYXllciwgdmlzIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykgd2FsayhsYXllciwgdHJ1ZSwgZmFsc2UpO1xuICAgIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVN3aWZ0bWFwUGF0Y2goc3RhdGUsIG9wcywgYnVmZmVycykge1xuICAgIGxldCBsYXllcnMgPSBzdGF0ZS5sYXllcnMgfHwgW107XG4gICAgbGV0IGJ1ZmZlck1hcCA9IHN0YXRlLmJ1ZmZlcnMgfHwge307XG5cbiAgICBmb3IgKGNvbnN0IG9wIG9mIG9wcykge1xuICAgICAgICBpZiAob3Aub3AgPT09IFwic25hcHNob3RcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gb3AubGF5ZXJzIHx8IFtdO1xuICAgICAgICAgICAgYnVmZmVyTWFwID0ge307XG4gICAgICAgICAgICAob3AuYnVmZmVyX2lkcyB8fCBbXSkuZm9yRWFjaCgoaWQsIGkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoYnVmZmVycyAmJiBidWZmZXJzW2ldKSBidWZmZXJNYXBbaWRdID0gYnVmZmVyc1tpXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImFkZFwiIHx8IG9wLm9wID09PSBcInJlcGxhY2VcIikge1xuICAgICAgICAgICAgY29uc3QgaW5jb21pbmcgPSBvcC5sYXllcjtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gaW5jb21pbmcgPyBpbmNvbWluZy5pZCA6IG9wLmlkO1xuICAgICAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJzLmZpbmRJbmRleChsID0+IGwuaWQgPT09IGlkKTtcbiAgICAgICAgICAgIGlmIChpZHggPT09IC0xKSB7XG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gWy4uLmxheWVycywgaW5jb21pbmddO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBsYXllcnMubWFwKChsLCBpKSA9PiAoaSA9PT0gaWR4ID8gaW5jb21pbmcgOiBsKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic2V0XCIpIHtcbiAgICAgICAgICAgIC8vIEZpZWxkLWxldmVsIHVwZGF0ZS4gXCJyZXBsYWNlXCIgY2FycmllcyB0aGUgd2hvbGUgbGF5ZXIsIHNvIGZsaXBwaW5nIGB2aXNpYmxlYFxuICAgICAgICAgICAgLy8gb24gYSA1MGstcG9pbnQgbGF5ZXIgcmVzZW50IGV2ZXJ5IHByb3BlcnR5IGl0IGhvbGRzIC0tIGhhbGYgYSBtZWdhYnl0ZSB0b1xuICAgICAgICAgICAgLy8gY2hhbmdlIG9uZSBib29sZWFuLCBvbiBldmVyeSBjbGljayBvZiBhIGNoZWNrYm94LlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHsgLi4ubCwgLi4uKG9wLmZpZWxkcyB8fCB7fSkgfSkpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInN0eWxlXCIpIHtcbiAgICAgICAgICAgIC8vIFBlci1mZWF0dXJlIHN0eWxlIG92ZXJyaWRlcywgcmVwbGFjZWQgd2hvbGVzYWxlIHJhdGhlciB0aGFuIG1lcmdlZDogYVxuICAgICAgICAgICAgLy8gc2VsZWN0aW9uIGRlc2NyaWJlcyBpdHMgY29tcGxldGUgc3RhdGUsIHNvIHNlbmRpbmcge30gY2xlYXJzIGl0IGFuZCBub1xuICAgICAgICAgICAgLy8gY2FsbGVyIGhhcyB0byB0cmFjayB3aGF0IHRoZSBwcmV2aW91cyBoaWdobGlnaHQgdG91Y2hlZC5cbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7XG4gICAgICAgICAgICAgICAgLi4ubCwgc3R5bGVfb3ZlcnJpZGVzOiBvcC5vdmVycmlkZXMgfHwge30sXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwicmVtb3ZlXCIpIHtcbiAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5maWx0ZXIobCA9PiBsLmlkICE9PSBvcC5pZCk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGJ1ZiA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tvcC5idWZmZXJfaW5kZXhdO1xuICAgICAgICAgICAgaWYgKGJ1ZikgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAsIFtvcC5pZF06IGJ1ZiB9O1xuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlcl9yZW1vdmVcIikge1xuICAgICAgICAgICAgYnVmZmVyTWFwID0geyAuLi5idWZmZXJNYXAgfTtcbiAgICAgICAgICAgIGRlbGV0ZSBidWZmZXJNYXBbb3AuaWRdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgbGF5ZXJzLCBidWZmZXJzOiBidWZmZXJNYXAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQge1xuICAgIGFzeW5jIHJlbmRlcih7IG1vZGVsLCBlbCB9KSB7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsRXJyb3IgPSBjb25zb2xlLmVycm9yO1xuICAgICAgICBjb25zdCBvcmlnaW5hbFdhcm4gPSBjb25zb2xlLndhcm47XG5cbiAgICAgICAgLy8ganNfY29uc29sZV9sb2dzIGlzIGEgc3luY2VkIGxpc3QsIHNvIGVhY2ggYXBwZW5kIHJlc2VuZHMgdGhlIHdob2xlIGFycmF5LiBLZWVwaW5nXG4gICAgICAgIC8vIG9ubHkgdGhlIG1vc3QgcmVjZW50IGVudHJpZXMgYm91bmRzIGJvdGggdGhlIHBheWxvYWQgYW5kIHRoZSBtZW1vcnkgYSBsb25nLWxpdmVkXG4gICAgICAgIC8vIHNlc3Npb24gYWNjdW11bGF0ZXM7IHRoZSBuZXdlc3QgYXJlIHRoZSBvbmVzIHdvcnRoIGhhdmluZyBhbnl3YXkuXG4gICAgICAgIGNvbnN0IE1BWF9DT05TT0xFX0xPR1MgPSAyMDA7XG4gICAgICAgIGNvbnN0IGFwcGVuZExvZyA9IGVudHJ5ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxvZ3MgPSBtb2RlbC5nZXQoXCJqc19jb25zb2xlX2xvZ3NcIikgfHwgW107XG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gWy4uLmxvZ3MsIGVudHJ5XTtcbiAgICAgICAgICAgIHJldHVybiBuZXh0Lmxlbmd0aCA+IE1BWF9DT05TT0xFX0xPR1MgPyBuZXh0LnNsaWNlKC1NQVhfQ09OU09MRV9MT0dTKSA6IG5leHQ7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gSGVscGVyIHRvIHNhZmVseSB3cml0ZSBiYWNrIHRvIFB5dGhvbiBvbmx5IGlmIHRoZSB3aWRnZXQgdmlldyBpcyBhY3RpdmUgYW5kIGF0dGFjaGVkXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTZXRBbmRTYXZlKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBcIltTd2lmdE1hcF0gU3VwcHJlc3NlZCBzeW5jIHdyaXRlIGVycm9yOlwiLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzYWZlU2F2ZUNoYW5nZXMoKSB7XG4gICAgICAgICAgICBpZiAoZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgc2F2ZSBlcnJvcjpcIiwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5lcnJvciA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcbiAgICAgICAgICAgIG9yaWdpbmFsRXJyb3IuYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxuICAgICAgICAgICAgICAgIGFwcGVuZExvZyhcIkNPTlNPTEUuRVJST1I6IFwiICsgYXJncy5tYXAoYSA9PiBTdHJpbmcoYSkpLmpvaW4oXCIgXCIpKSk7XG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICBsZXQgbG9nZ2VkUmVwcm9qZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgY29uc29sZS53YXJuID0gZnVuY3Rpb24oLi4uYXJncykge1xuICAgICAgICAgICAgY29uc3QgbXNnID0gYXJncy5tYXAoYSA9PiBTdHJpbmcoYSkpLmpvaW4oXCIgXCIpO1xuICAgICAgICAgICAgaWYgKG1zZy5pbmNsdWRlcyhcImxheWVyIGRlc2lnbmVkIGZvciBTcGhlcmljYWxNZXJjYXRvclwiKSB8fCBtc2cuaW5jbHVkZXMoXCJhbHRlcm5hdGUgZGV0ZWN0ZWRcIikpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWxvZ2dlZFJlcHJvamVjdGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlZFJlcHJvamVjdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY3JzID0gbW9kZWwuZ2V0KFwiY3JzXCIpIHx8IFwiRVBTRzozODU3XCI7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsZWFuTXNnID0gYFtTd2lmdE1hcF0gTGF5ZXIgd2FzIHJlcHJvamVjdGVkIHRvIFwiJHtjcnN9XCJgO1xuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbFdhcm4uY2FsbChjb25zb2xlLCBjbGVhbk1zZyk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLCBhcHBlbmRMb2coY2xlYW5Nc2cpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAvLyBzdXBwcmVzcyBkdXBsaWNhdGUgY29uc29sZSB3YXJuaW5nc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgICAgICB9O1xuXG4gICAgICAgIHdpbmRvdy5vbmVycm9yID0gZnVuY3Rpb24obWVzc2FnZSwgc291cmNlLCBsaW5lbm8sIGNvbG5vLCBlcnJvcikge1xuICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIixcbiAgICAgICAgICAgICAgICBhcHBlbmRMb2coYFdJTkRPVy5PTkVSUk9SOiAke21lc3NhZ2V9IGF0ICR7c291cmNlfToke2xpbmVub306JHtjb2xub31gKSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gTG9hZCBDU1MgYW5kIExlYWZsZXQgbGlicmFyaWVzIChpbmNsdWRpbmcgV2ViR0wgZ2xpZnkpXG4gICAgICAgIGxvYWRDU1MoXCJsZWFmbGV0LWNzc1wiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXRAMS45LjQvZGlzdC9sZWFmbGV0LmNzc1wiKTtcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1qc1wiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXRAMS45LjQvZGlzdC9sZWFmbGV0LmpzXCIpO1xuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdsaWZ5XCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldC5nbGlmeUAzLjMuMC9kaXN0L2dsaWZ5LWJyb3dzZXIuanNcIik7XG4gICAgICAgIC8vIEdlb21hbiBtdXN0IGxvYWQgQkVGT1JFIHRoZSBtYXAgaXMgY29uc3RydWN0ZWQ6IGl0IGF0dGFjaGVzIG1hcC5wbSB0aHJvdWdoXG4gICAgICAgIC8vIGEgTGVhZmxldCBpbml0IGhvb2ssIHdoaWNoIG9ubHkgcnVucyBmb3IgbWFwcyBjcmVhdGVkIGFmdGVyIHRoZSBwbHVnaW5cbiAgICAgICAgLy8gZXhpc3RzIC0tIGxhenktbG9hZGluZyBpdCBsYXRlciBsZWF2ZXMgbWFwLnBtIHVuZGVmaW5lZCBmb3JldmVyLlxuICAgICAgICBsb2FkQ1NTKFwibGVhZmxldC1nZW9tYW4tY3NzXCIsXG4gICAgICAgICAgICBcImh0dHBzOi8vdW5wa2cuY29tL0BnZW9tYW4taW8vbGVhZmxldC1nZW9tYW4tZnJlZUAyLjE4LjMvZGlzdC9sZWFmbGV0LWdlb21hbi5jc3NcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2VvbWFuXCIsXG4gICAgICAgICAgICBcImh0dHBzOi8vdW5wa2cuY29tL0BnZW9tYW4taW8vbGVhZmxldC1nZW9tYW4tZnJlZUAyLjE4LjMvZGlzdC9sZWFmbGV0LWdlb21hbi5taW4uanNcIik7XG5cbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgY29udGFpbmVyLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtY29udGFpbmVyXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUucG9zaXRpb24gPSBcInJlbGF0aXZlXCI7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKGNvbnRhaW5lcik7XG5cbiAgICAgICAgLy8gTWFwKGhlaWdodD0uLi4pIHNpemluZy4gQW4gZXhwbGljaXQgaGVpZ2h0IGFsc28gZHJvcHMgdGhlIHN0eWxlc2hlZXQnc1xuICAgICAgICAvLyA0MDBweCBmbG9vciAtLSBhbiBleHBsaWNpdCAyMDBweCBtdXN0IG5vdCBsb3NlIHRvIGEgZGVmYXVsdCBtaW5pbXVtLlxuICAgICAgICAvLyBIZWlnaHQgd2FzIGFjY2VwdGVkIGFuZCBkb2N1bWVudGVkIGxvbmcgYmVmb3JlIGl0IHJlYWNoZWQgdGhlIERPTTsgdGhpc1xuICAgICAgICAvLyBpcyB3aGVyZSBpdCBmaW5hbGx5IGRvZXMuXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5SGVpZ2h0KCkge1xuICAgICAgICAgICAgY29uc3QgaCA9IG1vZGVsLmdldChcImhlaWdodFwiKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5zdHlsZS5oZWlnaHQgPSBoIHx8IFwiMTAwJVwiO1xuICAgICAgICAgICAgY29udGFpbmVyLnN0eWxlLm1pbkhlaWdodCA9IGggPyBcIjBcIiA6IFwiXCI7XG4gICAgICAgIH1cbiAgICAgICAgYXBwbHlIZWlnaHQoKTtcblxuICAgICAgICBsZXQgbGFiZWxzR3JvdXAgPSBudWxsOyAgIC8vIGNyZWF0ZWQgYWZ0ZXIgdGhlIG1hcDsgZmlsbGVkIGJ5IGVhY2ggc3luY1xuXG4gICAgICAgIGNvbnN0IGNyc05hbWUgPSBtb2RlbC5nZXQoXCJjcnNcIik7XG4gICAgICAgIGxldCBtYXBDcnMgPSBMLkNSUy5FUFNHMzg1NztcbiAgICAgICAgaWYgKGNyc05hbWUgPT09IFwiRVBTRzo0MzI2XCIpIHtcbiAgICAgICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbWFwID0gTC5tYXAoY29udGFpbmVyLCB7XG4gICAgICAgICAgICBjcnM6IG1hcENycyxcbiAgICAgICAgICAgIGNlbnRlcjogbW9kZWwuZ2V0KFwiY2VudGVyXCIpLFxuICAgICAgICAgICAgem9vbTogbW9kZWwuZ2V0KFwiem9vbVwiKSxcbiAgICAgICAgICAgIHNjcm9sbFdoZWVsWm9vbTogdHJ1ZSxcbiAgICAgICAgICAgIHByZWZlckNhbnZhczogdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgY3VzdG9tIHBhbmVzIGZvciBzdHJpY3QgWi1pbmRleCBvcmRlcmluZ1xuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5Z29uc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MTBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5bGluZXNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDIwXCI7XG4gICAgICAgIFxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQzMFwiO1xuXG4gICAgICAgIC8vIERyYXduIHZlY3RvcnMgbGl2ZSBBQk9WRSB0aGUgR0wgcGFuZXMuIEdlb21hbiBkZWZhdWx0cyB0aGVtIGludG8gTGVhZmxldCdzXG4gICAgICAgIC8vIG92ZXJsYXlQYW5lICg0MDApLCB3aGljaCBzaXRzIHVuZGVyIHRoZSBHTCBjYW52YXNlcyAoNDEwLzQyMC80MzApIHdob3NlXG4gICAgICAgIC8vIHBvaW50ZXItZXZlbnRzIGFyZSBmb3JjZWQgb24gLS0gc28gd2l0aCBhbnkgR0wgbGF5ZXIgcHJlc2VudCwgY2xpY2tzIG1lYW50XG4gICAgICAgIC8vIGZvciBhIGRyYXduIHNoYXBlIG5ldmVyIGFycml2ZWQ6IGRyYXdpbmcgd29ya2VkIChHZW9tYW4gbGlzdGVucyBvbiB0aGVcbiAgICAgICAgLy8gY29udGFpbmVyKSB3aGlsZSByZW1vdmFsLCBlZGl0IGFuZCBkcmFnIHNpbGVudGx5IGRpZCBub3RoaW5nLlxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIik7XG4gICAgICAgIG1hcC5nZXRQYW5lKFwic3dpZnRtYXBEcmF3UGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQ0MFwiO1xuXG4gICAgICAgIGxhYmVsc0dyb3VwID0gTC5sYXllckdyb3VwKCkuYWRkVG8obWFwKTtcblxuICAgICAgICAvLyBMb2NhbCBtaXJyb3JzIG9mIHRoZSBsYXllciBsaXN0IGFuZCBjb29yZGluYXRlIGJ1ZmZlcnMuXG4gICAgICAgIC8vXG4gICAgICAgIC8vIFB5dGhvbiB1cGRhdGVzIHRoZXNlIGluY3JlbWVudGFsbHkgdmlhIFwic3dpZnRtYXBfcGF0Y2hcIiBtZXNzYWdlcyBpbnN0ZWFkIG9mXG4gICAgICAgIC8vIHJlYXNzaWduaW5nIHRoZSB0cmFpdHMsIGJlY2F1c2UgYSB0cmFpdCByZWFzc2lnbm1lbnQgcmUtc2VyaWFsaXplcyBhbmQgcmUtc2VuZHNcbiAgICAgICAgLy8gdGhlIGVudGlyZSBtYXAgb24gZXZlcnkgbXV0YXRpb24uIFRoZSB0cmFpdHMgc3RpbGwgY2FycnkgdGhlIGluaXRpYWwgc25hcHNob3RcbiAgICAgICAgLy8gd2hlbiBhIHZpZXcgYXR0YWNoZXMsIGFuZCB0aGUgc2lkZWJhciBzdGlsbCB3cml0ZXMgYGxheWVyc2AgYmFjayBvbiB0b2dnbGUsIHNvXG4gICAgICAgIC8vIGJvdGggYXJlIHNlZWRlZCBoZXJlIGFuZCBrZXB0IGluIHN0ZXAgYnkgdGhlIGNoYW5nZSBoYW5kbGVycyBmdXJ0aGVyIGRvd24uXG4gICAgICAgIGxldCBsYXllclN0YXRlID0gbW9kZWwuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xuICAgICAgICBsZXQgYnVmZmVyU3RhdGUgPSB7IC4uLihtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pIH07XG5cbiAgICAgICAgZnVuY3Rpb24gYXBwbHlQYXRjaE9wcyhvcHMsIGJ1ZmZlcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhcHBseVN3aWZ0bWFwUGF0Y2goeyBsYXllcnM6IGxheWVyU3RhdGUsIGJ1ZmZlcnM6IGJ1ZmZlclN0YXRlIH0sIG9wcywgYnVmZmVycyk7XG4gICAgICAgICAgICBsYXllclN0YXRlID0gbmV4dC5sYXllcnM7XG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IG5leHQuYnVmZmVycztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExpdmUgZmVhdHVyZSB2aXNpYmlsaXR5LCBmb3IgaGl0LXRlc3RpbmcuIEdQVS1wYXRoIGJ1Y2tldHMga2VlcCBFVkVSWVxuICAgICAgICAvLyBsYXllciAtLSBoaWRkZW4gb25lcyBhcmUgbWFza2VkIGJ5IGEgc2hhZGVyIHVuaWZvcm0gLS0gYW5kIGdsaWZ5J3NcbiAgICAgICAgLy8gaGl0LXRlc3RzIHJ1biBhZ2FpbnN0IHRoZSBidWNrZXQncyBkYXRhLCB3aGljaCBjYW5ub3Qgc2VlIHVuaWZvcm1zOiBhXG4gICAgICAgIC8vIHJhZGlvLWhpZGRlbiBsYXllcidzIGZlYXR1cmVzIHN0aWxsIHdvbiBjbGlja3MgYW5kIGFuc3dlcmVkIHdpdGggcG9wdXBzLlxuICAgICAgICAvLyBMb29rZWQgdXAgZnJlc2ggcGVyIGV2ZW50LCBiZWNhdXNlIHRoZSBjb25maWcgY2FwdHVyZWQgYXQgYnVpbGQgdGltZSBnb2VzXG4gICAgICAgIC8vIHN0YWxlIHRoZSBtb21lbnQgYSBwYXRjaCBvcCByZXBsYWNlcyBpdDsgdGhlIHRpbWUgY2hlY2sgcmVhZHMgdGhlIGxpdmVcbiAgICAgICAgLy8gdGljayB0aGUgc2FtZSB3YXksIHNpbmNlIHRpY2tzIGNoYW5nZSB3aXRob3V0IHJlYnVpbGRpbmcgdGhlIGJ1Y2tldC5cbiAgICAgICAgZnVuY3Rpb24gZmluZExheWVyTm93KGxpc3QsIGlkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGwgb2YgbGlzdCkge1xuICAgICAgICAgICAgICAgIGlmIChsLmlkID09PSBpZCkgcmV0dXJuIGw7XG4gICAgICAgICAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHN1YiA9IGZpbmRMYXllck5vdyhsLmxheWVycyB8fCBbXSwgaWQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3ViKSByZXR1cm4gc3ViO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIGZ1bmN0aW9uIGZlYXR1cmVWaXNpYmxlTm93KGxheWVyLCBpbmRleCkge1xuICAgICAgICAgICAgY29uc3QgY3VycmVudCA9IGZpbmRMYXllck5vdyhsYXllclN0YXRlLCBsYXllci5pZCkgfHwgbGF5ZXI7XG4gICAgICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGN1cnJlbnQsIG1vZGVsLmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge30pKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFjdXJyZW50LnRpbWUgfHwgIXRpbWVTdGF0ZSkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGN1cnJlbnQsIGJ1ZmZlclN0YXRlKTtcbiAgICAgICAgICAgIGlmICghdGltZXMpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLFxuICAgICAgICAgICAgICAgIGVmZmVjdGl2ZUR1cmF0aW9uKGN1cnJlbnQsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xuICAgICAgICAgICAgaWYgKGluZGV4ICE9IG51bGwgJiYgdGltZXMubGVuZ3RoID4gMikge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gdGltZXNbaW5kZXggKiAyXTtcbiAgICAgICAgICAgICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHN0YXJ0KVxuICAgICAgICAgICAgICAgICAgICB8fCBmZWF0dXJlSW5XaW5kb3coc3RhcnQsIHRpbWVzW2luZGV4ICogMiArIDFdLCB3aW4pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pXG4gICAgICAgICAgICAgICAgICAgICAgICB8fCBmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY3RpdmVUaWxlTGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGFjdGl2ZU92ZXJsYXlMYXllcnMgPSB7fTtcbiAgICAgICAgY29uc3QgZ2xTdGF0ZXMgPSB7XG4gICAgICAgICAgICBjaXJjbGVfbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBtYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlsaW5lOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIHBvbHlnb246IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xuICAgICAgICAvLyBhbmQgdGhlIHBlcmlvZCwgb3IgbnVsbCB3aGVuIG5vdGhpbmcgaXMgYW5pbWF0ZWQgLS0gYW5kIGB0aW1lVUlgIGlzIHRoZSBzbGlkZXInc1xuICAgICAgICAvLyBvd24gYm9va2tlZXBpbmcuIFBsYXliYWNrIG5ldmVyIHJvdW5kLXRyaXBzIHRocm91Z2ggUHl0aG9uOiB0aWNrcyByZS1yZW5kZXJcbiAgICAgICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXG4gICAgICAgIGxldCB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICBjb25zdCB0aW1lVUkgPSB7IHRpY2tzOiBbXSwga2V5OiBcIlwiLCBpbmRleDogMCwgcGxheWluZzogZmFsc2UsIGxvb3A6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3c6IG51bGwsIHBlcmlvZE1zOiBudWxsLCBncmlkTXM6IG51bGwgfTtcblxuICAgICAgICBmdW5jdGlvbiBzdG9wUGxheWJhY2soKSB7XG4gICAgICAgICAgICBpZiAodGltZVVJLnRpbWVyKSBjbGVhckludGVydmFsKHRpbWVVSS50aW1lcik7XG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBudWxsO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHdyaXRlVGltZUN1cnJlbnQoZm9yY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICBpZiAoIWZvcmNlICYmIG5vdyAtIHRpbWVVSS5sYXN0V3JpdGUgPCAxMDAwKSByZXR1cm47XG4gICAgICAgICAgICB0aW1lVUkubGFzdFdyaXRlID0gbm93O1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ0aW1lX2N1cnJlbnRcIiwgdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzZWVrVG8oaW5kZXgsIHsgd3JpdGUgPSB0cnVlIH0gPSB7fSkge1xuICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSk7XG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2Q6IHRpbWVTdGF0ZS5wZXJpb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xuICAgICAgICAgICAgaWYgKHdyaXRlKSB3cml0ZVRpbWVDdXJyZW50KCF0aW1lVUkucGxheWluZyk7XG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBzdGFydFBsYXliYWNrKCkge1xuICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICB0aW1lVUkucGxheWluZyA9IHRydWU7XG4gICAgICAgICAgICB0aW1lVUkudGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFkdmFuY2UodGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoLCB0aW1lVUkubG9vcCk7XG4gICAgICAgICAgICAgICAgaWYgKCFuZXh0LnBsYXlpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2Vla1RvKG5leHQuaW5kZXgpO1xuICAgICAgICAgICAgfSwgMTAwMCAvIHRpbWVVSS5zcGVlZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0aW1lSGFuZGxlcnMgPSB7XG4gICAgICAgICAgICBvblNlZWs6IChpbmRleCkgPT4gc2Vla1RvKGluZGV4KSxcbiAgICAgICAgICAgIG9uU3RlcEJhY2s6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggLSAxKSxcbiAgICAgICAgICAgIG9uU3RlcEZvcndhcmQ6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggKyAxKSxcbiAgICAgICAgICAgIG9uUGxheVRvZ2dsZTogKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVUaW1lQ3VycmVudCh0cnVlKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBzdGFydE92ZXIsIGFzIHRoZSBmb2xpdW0gcGxheWVyIHdhcyBjb25maWd1cmVkOiBwcmVzc2luZyBwbGF5IGF0XG4gICAgICAgICAgICAgICAgICAgIC8vIHRoZSBlbmQgcmVzdGFydHMgZnJvbSB0aGUgYmVnaW5uaW5nIGltbWVkaWF0ZWx5LCByYXRoZXIgdGhhbiBvbmVcbiAgICAgICAgICAgICAgICAgICAgLy8gc2lsZW50IGludGVydmFsIGxhdGVyIGRlY2lkaW5nIHRoZXJlIGlzIG5vd2hlcmUgdG8gZ28gYW5kIHN0b3BwaW5nLlxuICAgICAgICAgICAgICAgICAgICBpZiAodGltZVVJLmluZGV4ID49IHRpbWVVSS50aWNrcy5sZW5ndGggLSAxKSBzZWVrVG8oMCk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkubG9vcCA9ICF0aW1lVUkubG9vcDtcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uU3BlZWQ6IChzcGVlZCkgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IHNwZWVkO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIExpdmUgZHVyaW5nIHRoZSBkcmFnOiBsb2NhbCBzdGF0ZSBhbmQgYSByZS1yZW5kZXIgb2YgdGhlIGNvbnRyb2wgb24gZXZlcnlcbiAgICAgICAgICAgIC8vIG1vdmUsIGJ1dCBtYXAgcmVidWlsZHMgYXQgbW9zdCBldmVyeSAzMDBtcy4gQXQgNU0gcG9pbnRzIGEgcmVidWlsZCBjb3N0c1xuICAgICAgICAgICAgLy8gc2Vjb25kcywgYW5kIGEgZHJhZyBmaXJlcyBkb3plbnMgb2YgbW92ZXMgLS0gdW50aHJvdHRsZWQsIHRoZSByZWJ1aWxkc1xuICAgICAgICAgICAgLy8gc3RhY2sgZmFzdGVyIHRoYW4gdGhleSBmaW5pc2ggYW5kIHRoZSBhbGxvY2F0aW9uIGNodXJuIGNyYXNoZXMgdGhlIHRhYi5cbiAgICAgICAgICAgIG9uV2luZG93RHJhZzogKGlzbykgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB0aW1lVUkud2luZG93ID0gaXNvO1xuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHRpbWVTdGF0ZSA9IHsgLi4udGltZVN0YXRlLCB3aW5kb3c6IGlzbyB9O1xuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICAgICAgICBpZiAobm93IC0gKHRpbWVVSS5sYXN0RHJhZ1N5bmMgfHwgMCkgPj0gMzAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5sYXN0RHJhZ1N5bmMgPSBub3c7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBPbiByZWxlYXNlIChvciBhIGtleWJvYXJkIHN0ZXApOiB0aGUgb3ZlcnJpZGUgbGFuZHMgaW4gdGltZV9jb25maWcgc29cbiAgICAgICAgICAgIC8vIFB5dGhvbiBhbmQgU2hpbnkgc2VlIHRoZSBzYW1lIHdpbmRvdyB0aGUgYmFyIHNob3dzLiBudWxsIGNsZWFycyB0aGUga2V5LFxuICAgICAgICAgICAgLy8gaGFuZGluZyBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbiAgICAgICAgICAgIG9uV2luZG93Q29tbWl0OiAoaXNvKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZUhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5kcmFnQWN0aXZlID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcXVldWVTeW5jKCk7ICAgICAgIC8vIHRoZSByZWxlYXNlIGFsd2F5cyBsYW5kcywgdGhyb3R0bGUgb3Igbm90XG4gICAgICAgICAgICAgICAgY29uc3QgY2ZnID0geyAuLi4obW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge30pIH07XG4gICAgICAgICAgICAgICAgaWYgKGlzbykgY2ZnLndpbmRvdyA9IGlzbztcbiAgICAgICAgICAgICAgICBlbHNlIGRlbGV0ZSBjZmcud2luZG93O1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInRpbWVfY29uZmlnXCIsIGNmZyk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBsb2NhbCBtb2RlbCBzdGlsbCBob2xkcyBpdCAqLyB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIENyZWF0ZXMsIHJldHVuZXMgb3IgcmVtb3ZlcyB0aGUgc2xpZGVyIHRvIG1hdGNoIHRoZSBsYXllcnMgcHJlc2VudC4gVGlja3MgYXJlXG4gICAgICAgIC8vIHJlZ2VuZXJhdGVkIG9ubHkgd2hlbiB0aGUgZGF0YSdzIHRpbWUgZXh0ZW50IG9yIHRoZSBwZXJpb2QgY2hhbmdlcywgc28gYVxuICAgICAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVUaW1lRGltZW5zaW9uKCkge1xuICAgICAgICAgICAgaWYgKCFoYXNUaW1lTGF5ZXJzKGxheWVyU3RhdGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHsgdGlja3M6IFtdIH0sIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBcIlwiO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IHBlcmlvZCA9IHBhcnNlUGVyaW9kKGNmZy5wZXJpb2QgfHwgXCJQMURcIikgfHwgcGFyc2VQZXJpb2QoXCJQMURcIik7XG4gICAgICAgICAgICBjb25zdCBleHRlbnQgPSBjb2xsZWN0VGltZUV4dGVudChsYXllclN0YXRlLCBidWZmZXJTdGF0ZSk7XG4gICAgICAgICAgICBpZiAoIWV4dGVudCkgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtleHRlbnQubWlufXwke2V4dGVudC5tYXh9fCR7Y2ZnLnBlcmlvZCB8fCBcIlAxRFwifWA7XG4gICAgICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IGtleTtcbiAgICAgICAgICAgICAgICB0aW1lVUkudGlja3MgPSBnZW5lcmF0ZVRpY2tzKGV4dGVudC5taW4sIGV4dGVudC5tYXgsIHBlcmlvZCk7XG4gICAgICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5taW4odGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFRoZSBzaGFyZWQgd2luZG93IG92ZXJyaWRlLCBjb25maWctZHJpdmVuOyBhIGJhZCBzdHJpbmcgY2xlYXJzIHJhdGhlciB0aGFuXG4gICAgICAgICAgICAvLyBndWVzc2luZy4gVGhlIGRyYWcgZ3JpZCBpcyB0aGUgZ2NkIG9mIHRoZSBpbnRlcnZhbCBhbmQgZXZlcnkgYXR0YWNoZWRcbiAgICAgICAgICAgIC8vIGR1cmF0aW9uIC0tIHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBhbGwgb2YgdGhlbSAtLSBzbyBhIDIuNWggdHJhaWxcbiAgICAgICAgICAgIC8vIGlzIGRyYWdnYWJsZSBvbiBhIDFoIGJhci4gQ2FsZW5kYXIgcGVyaW9kcyBoYXZlIG5vIGZpeGVkIHdpZHRoOyB0aGUgcnVsZXJcbiAgICAgICAgICAgIC8vIHRoZW4gc2hvd3MgaW50ZXJ2YWwgbWFya3Mgb25seSBhbmQgdGhlIHRyYWlsIGhhbmRsZSBoaWRlcy5cbiAgICAgICAgICAgIC8vIE5ldmVyIHdoaWxlIGEgZHJhZyBpcyBsaXZlOiB0aGUgZHJhZ2dlZCB3aW5kb3cgZXhpc3RzIG9ubHkgbG9jYWxseSB1bnRpbFxuICAgICAgICAgICAgLy8gcmVsZWFzZSBjb21taXRzIGl0LCBhbmQgcmVhZGluZyBjb25maWcgaGVyZSBtaWQtZHJhZyByZXNldCB0aGUgaGFuZGxlIHRvXG4gICAgICAgICAgICAvLyBcIm5vIHdpbmRvd1wiIG9uIGV2ZXJ5IGRlYm91bmNlZCBzeW5jIC0tIHRoZSBoYW5kbGUgZm9sbG93ZWQgdGhlIG1vdXNlLCB0aGVuXG4gICAgICAgICAgICAvLyBzbmFwcGVkIGhvbWUsIHRoZW4gZm9sbG93ZWQgYWdhaW4sIG9uY2UgcGVyIHN5bmMuXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5kcmFnQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGNmZy53aW5kb3cgJiYgcGFyc2VQZXJpb2QoY2ZnLndpbmRvdykgPyBjZmcud2luZG93IDogbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRpbWVVSS5wZXJpb2RNcyA9IHBlcmlvZFRvTXMocGVyaW9kKTtcbiAgICAgICAgICAgIHRpbWVVSS5ncmlkTXMgPSB0aW1lVUkucGVyaW9kTXNcbiAgICAgICAgICAgICAgICA/IGdjZEdyaWRNcyh0aW1lVUkucGVyaW9kTXMsIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllclN0YXRlLCB0aW1lVUkud2luZG93KSlcbiAgICAgICAgICAgICAgICA6IG51bGw7XG5cbiAgICAgICAgICAgIHRpbWVTdGF0ZSA9IHsgdGljazogdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0sIHBlcmlvZCwgd2luZG93OiB0aW1lVUkud2luZG93IH07XG4gICAgICAgICAgICB0aW1lVUkucG9zaXRpb24gPSBjZmcucG9zaXRpb24gfHwgXCJ0b3AtY2VudGVyXCI7XG5cbiAgICAgICAgICAgIGlmICghdGltZVVJLnN0YXJ0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGltZVVJLnNwZWVkID0gY2ZnLnNwZWVkIHx8IDE7XG4gICAgICAgICAgICAgICAgdGltZVVJLmxvb3AgPSBCb29sZWFuKGNmZy5sb29wKTtcbiAgICAgICAgICAgICAgICAvLyBPbmx5IHRoZSBmaXJzdCBjb25maWd1cmF0aW9uIG1heSBhdXRvLXN0YXJ0LiBFdmVyeSBjb25maWcgY2hhbmdlIHJlc2V0c1xuICAgICAgICAgICAgICAgIC8vIGBzdGFydGVkYCB0byByZS1yZWFkIHNwZWVkIGFuZCBsb29wIC0tIGluY2x1ZGluZyB0aGUgY2hhbmdlIGEgd2luZG93XG4gICAgICAgICAgICAgICAgLy8gZHJhZyBjb21taXRzIC0tIGFuZCByZS1ydW5uaW5nIGF1dG9fcGxheSB0aGVyZSB3b3VsZCBzdGFydCBwbGF5YmFjayBhc1xuICAgICAgICAgICAgICAgIC8vIGEgc2lkZSBlZmZlY3Qgb2YgcmVsZWFzaW5nIHRoZSBoYW5kbGUuXG4gICAgICAgICAgICAgICAgaWYgKGNmZy5hdXRvX3BsYXkgJiYgIXRpbWVVSS5ldmVyU3RhcnRlZCkgc3RhcnRQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5ldmVyU3RhcnRlZCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2lkZWJhciBMYXllcnMgQ29udHJvbCBVSVxuICAgICAgICBjb25zdCBzaWRlYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgc2lkZWJhci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXNpZGViYXJcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS50b3AgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUubWF4SGVpZ2h0ID0gXCI4MCVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250RmFtaWx5ID0gXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTZWdvZSBVSScsIFJvYm90bywgc2Fucy1zZXJpZlwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHNpZGViYXIpO1xuXG4gICAgICAgIC8vIExlZ2VuZDogZGVyaXZlZCBmcmVzaCBvbiBldmVyeSBzeW5jIGZyb20gdGhlIHNhbWUgbGF5ZXIgc3RhdGUgdGhlIHNpZGViYXJcbiAgICAgICAgLy8gcmVuZGVycyBmcm9tLCBzbyB0b2dnbGVzIGRpbSBvciBkcm9wIHJvd3Mgd2l0aCBubyBleHRyYSB3aXJpbmcuIEhpZGRlblxuICAgICAgICAvLyB1bnRpbCBzaG93X2xlZ2VuZCBhc2tzIGZvciBpdC5cbiAgICAgICAgY29uc3QgbGVnZW5kRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgbGVnZW5kRGl2LmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtbGVnZW5kXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmJvcmRlclJhZGl1cyA9IFwiNXB4XCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLm1heFdpZHRoID0gXCIyNjBweFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUubWF4SGVpZ2h0ID0gXCI0NSVcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLm92ZXJmbG93WSA9IFwiYXV0b1wiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuZm9udEZhbWlseSA9IHNpZGViYXIuc3R5bGUuZm9udEZhbWlseTtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5jb2xvciA9IFwiIzMzM1wiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQobGVnZW5kRGl2KTtcblxuICAgICAgICAvLyBMb2dvXG4gICAgICAgIGNvbnN0IGxvZ29EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJvdHRvbSA9IFwiMTBweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnJpZ2h0ID0gXCIxMHB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5wYWRkaW5nID0gXCI1cHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjRweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgbG9nb0Rpdi5pbm5lckhUTUwgPSBgXG4gICAgICAgICAgICA8ZGl2IHN0eWxlPVwiZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjtcIj5cbiAgICAgICAgICAgICAgICA8aW1nIHNyYz1cImh0dHBzOi8vcmVwby9hc3NldHMvaW1hZ2UucG5nXCIgYWx0PVwiQ29tcGFueVwiIHN0eWxlPVwiaGVpZ2h0OiAzNXB4OyBtYXJnaW4tcmlnaHQ6IDVweDtcIj5cbiAgICAgICAgICAgICAgICA8aW1nIHNyYz1cImh0dHBzOi8vcmVwby9hc3NldHMvaW1hZ2UyLnBuZ1wiIGFsdD1cIlBhcmVudCBDb21wYW55XCIgc3R5bGU9XCJoZWlnaHQ6IDM1cHg7XCI+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgYDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxvZ29EaXYpO1xuXG5cblxuICAgICAgICBmdW5jdGlvbiBnZXRUaWxlTGF5ZXIobGF5ZXIpIHtcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxuICAgICAgICAgICAgICAgIG1heFpvb206IGxheWVyLm1heF96b29tIHx8IDIyLFxuICAgICAgICAgICAgICAgIG1heE5hdGl2ZVpvb206IGxheWVyLm1heF9uYXRpdmVfem9vbSB8fCAxOVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8vIHh5enNlcnZpY2VzIHByb3ZpZGVycyBkZWNsYXJlIHRoZWlyIG93biB7c30gaG9zdHM7IExlYWZsZXQnc1xuICAgICAgICAgICAgLy8gZGVmYXVsdCBcImFiY1wiIGlzIHdyb25nIGZvciBhbnl0aGluZyBlbHNlLlxuICAgICAgICAgICAgaWYgKGxheWVyLnN1YmRvbWFpbnMpIG9wdGlvbnMuc3ViZG9tYWlucyA9IGxheWVyLnN1YmRvbWFpbnM7XG4gICAgICAgICAgICBpZiAobGF5ZXIud21zKSB7XG4gICAgICAgICAgICAgICAgLy8gV01TIHJlcXVlc3QgQ1JTIGZvbGxvd3MgdGhlIG1hcCdzLCBzbyA0MzI2IG1hcHMgYXNrIGluIDQzMjYuXG4gICAgICAgICAgICAgICAgcmV0dXJuIEwudGlsZUxheWVyLndtcyhsYXllci51cmwsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBsYXllci53bXMubGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICBmb3JtYXQ6IGxheWVyLndtcy5mb3JtYXQgfHwgJ2ltYWdlL3BuZycsXG4gICAgICAgICAgICAgICAgICAgIHZlcnNpb246IGxheWVyLndtcy52ZXJzaW9uIHx8ICcxLjEuMScsXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zcGFyZW50OiAhIWxheWVyLndtcy50cmFuc3BhcmVudCxcbiAgICAgICAgICAgICAgICAgICAgLi4uKGxheWVyLndtcy5zdHlsZXMgPyB7IHN0eWxlczogbGF5ZXIud21zLnN0eWxlcyB9IDoge30pXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCBvcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNNYXBTdGF0ZSgpIHtcbiAgICAgICAgICAgIGNvbnNvbGUudGltZShcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xuICAgICAgICAgICAgdXBkYXRlVGltZURpbWVuc2lvbigpO1xuICAgICAgICAgICAgY29uc3QgbGF5ZXJzID0gbGF5ZXJTdGF0ZTtcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IG1vZGVsLmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IGJ1ZmZlclN0YXRlO1xuXG4gICAgICAgICAgICAvLyBFbmZvcmNlIG11dHVhbGx5IGV4Y2x1c2l2ZSByYWRpbyBncm91cCB2aXNpYmlsaXR5IGJlZm9yZSBjb2xsZWN0aW5nIG9yIHJlbmRlcmluZyBXZWJHTCBsYXllcnMuXG4gICAgICAgICAgICAvLyBXcml0dGVuIGJhY2sgYXMgdGFyZ2V0ZWQgZmxpcHMsIG5ldmVyIHRoZSBsYXllcnMgdHJhaXQgLS0gdGhlIGZ1bGwgd3JpdGUgd2FzXG4gICAgICAgICAgICAvLyB0aGUgZnJhbWUgdGhhdCBraWxsZWQgbGFyZ2Ugc2Vzc2lvbnMgKHNlZSB0aGUgc2lkZWJhcidzIGNoYW5nZSBoYW5kbGVyKS5cbiAgICAgICAgICAgIGNvbnN0IHJhZGlvID0gbm9ybWFsaXplUmFkaW9MYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgaWYgKChyYWRpby5jaGFuZ2VzLmxlbmd0aCA+IDAgfHwgcmFkaW8uZ3JvdXBzQ2hhbmdlZCkgJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICBzZW5kTGF5ZXJXcml0ZShtb2RlbCwgcmFkaW8uY2hhbmdlcyk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gbW9kZWwuZ2V0KFwic2hvd19sb2dvXCIpID8gXCJibG9ja1wiIDogXCJub25lXCI7XG5cbiAgICAgICAgICAgIC8vIEdyb3VwIHZpc2libGUgbGF5ZXJzIChpbmNsdWRpbmcgc3ViLWxheWVycyBpbnNpZGUgZ3JvdXBzKSB0byBhbHdheXMgdXNlIFdlYkdMXG4gICAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHdlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgIHBvbHlsaW5lOiB3ZWJnbFBvbHlsaW5lTGF5ZXJzLFxuICAgICAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyxcbiAgICAgICAgICAgIH0gPSBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xuXG4gICAgICAgICAgICAvLyBTZXQgb2YgbGF5ZXIgSURzIHByb2Nlc3NlZCB2aWEgbWVyZ2VkIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgY29uc3Qgd2ViZ2xMYXllcklkcyA9IG5ldyBTZXQoW1xuICAgICAgICAgICAgICAgIC4uLndlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsUG9seWxpbmVMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzLm1hcChsID0+IGwuaWQpXG4gICAgICAgICAgICBdKTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHJldGlyZWQgb3ZlcmxheSBsYXllcnMsIGluY2x1ZGluZyB0aG9zZSB0aGF0IHRyYW5zaXRpb25lZCB0byBXZWJHTFxuICAgICAgICAgICAgT2JqZWN0LmtleXMoYWN0aXZlT3ZlcmxheUxheWVycykuZm9yRWFjaChpZCA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKSB8fCB3ZWJnbExheWVySWRzLmhhcyhpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gUHJvY2VzcyBub24tV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGVmZmVjdGl2ZVZpc2libGUgPSBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJiYXNlbWFwXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVmZmVjdGl2ZVZpc2libGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRpbGUgPSBnZXRUaWxlTGF5ZXIobGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbGUuYWRkVG8obWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdID0gdGlsZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXS5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvLyBTa2lwIGxheWVycyBtYW5hZ2VkIGJ5IHRoZSBtZXJnZWQgV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICAgICAgaWYgKHdlYmdsTGF5ZXJJZHMuaGFzKGxheWVyLmlkKSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWVmZmVjdGl2ZVZpc2libGUgfHwgIWxheWVySW5XaW5kb3cobGF5ZXIsIGJ1ZmZlclN0YXRlLCB0aW1lU3RhdGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIC8vIEltYWdlIG92ZXJsYXlzIHJlY3JlYXRlIHdoZW4gdGhlaXIgY29uZmlnIG9yIHRoZWlyIGJ1ZmZlclxuICAgICAgICAgICAgICAgICAgICAvLyBjaGFuZ2VzIC0tIGEgcmVwbGFjZSBvcCBzd2FwcyB0aGUgY29uZmlnIG9iamVjdCBhbmQgYVxuICAgICAgICAgICAgICAgICAgICAvLyBidWZmZXIgb3Agc3dhcHMgdGhlIERhdGFWaWV3LCBhbmQgYSBzdGFsZSBpbWFnZSB3b3VsZFxuICAgICAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2Ugc2l0IHVudGlsIGEgdmlzaWJpbGl0eSBib3VuY2UuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YWxlSW1hZ2UgPSBsYXllci50eXBlID09PSBcImltYWdlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICYmIChleGlzdGluZy5pbWFnZU1ldGEgIT09IGltYWdlTWV0YUtleShsYXllcilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCBleGlzdGluZy5pbWFnZVNvdXJjZSAhPT0gKGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXSB8fCBudWxsKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZy5sYXllclR5cGUgIT09IGxheWVyLnR5cGUgfHwgc3RhbGVJbWFnZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdID0gaW5zdGFuY2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBIZWxwZXIgdG8gc3luYyBXZWJHTCBsYXllciBzdGF0ZXMgYW5kIHJlYnVpbGQgb25seSBpZiBjaGFuZ2VkXG4gICAgICAgICAgICBhc3luYyBmdW5jdGlvbiBzeW5jR2xMYXllcih0eXBlLCB2aXNpYmxlTGF5ZXJzLCB2ZWN0b3JHcHUgPSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkc1N0cmluZyA9IHZpc2libGVMYXllcnMubWFwKGwgPT4gbC5pZCkuc29ydCgpLmpvaW4oXCIsXCIpO1xuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgdGhlIGJ1aWx0IGJ1ZmZlcnMgZGVwZW5kIG9uIGJlbG9uZ3MgaW4gdGhpcyBrZXk6IGEgY2hhbmdlIHRoYXRcbiAgICAgICAgICAgICAgICAvLyBpcyBub3QgaW4gaXQgcmVuZGVycyBzdGFsZS4gaGlnaGxpZ2h0X3N0eWxlIGFuZCBzdHlsZV9vdmVycmlkZXMgd2VyZVxuICAgICAgICAgICAgICAgIC8vIG1pc3NpbmcgYXQgZmlyc3QsIHNvIGEgaGlnaGxpZ2h0IGxhbmRlZCBpbiBzdGF0ZSBhbmQgbmV2ZXIgcmVwYWludGVkLlxuICAgICAgICAgICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgb24gdGhlIEdQVSBwYXRoIGV4Y2x1ZGUgdGhlIHRpY2sgYW5kIHdpbmRvdyBmcm9tIHRoZSBrZXk6XG4gICAgICAgICAgICAgICAgLy8gdGhvc2UgY2hhbmdlIHBlciB0aWNrIGFuZCBhcmUgYXBwbGllZCBhcyB1bmlmb3Jtcywgbm90IGJ5IHJlYnVpbGRpbmcuXG4gICAgICAgICAgICAgICAgLy8gVGhlIHBlcmlvZCBzdGF5cyBpbiwgc2luY2UgaXQgaXMgYmFrZWQgaW50byB0aGUgZHVyYXRpb24gYXR0cmlidXRlcy5cbiAgICAgICAgICAgICAgICAvLyBFdmVyeXRoaW5nIGVsc2UgLS0gYW5kIGV2ZXJ5IG5vbi1wb2ludCBidWNrZXQgLS0gcmVidWlsZHMgYXMgYmVmb3JlLlxuICAgICAgICAgICAgICAgIGNvbnN0IGdwdVBvaW50cyA9ICgodHlwZSA9PT0gXCJjaXJjbGVfbWFya2Vyc1wiIHx8IHR5cGUgPT09IFwibWFya2Vyc1wiKVxuICAgICAgICAgICAgICAgICAgICAmJiBncHVUaW1lQXZhaWxhYmxlKCkpIHx8IHZlY3RvckdwdTtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXRhU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkodmlzaWJsZUxheWVycy5tYXAobCA9PiAoe1xuICAgICAgICAgICAgICAgICAgICBpZDogbC5pZCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IGwuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogbC5yYWRpdXMsXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogbC53ZWlnaHQsXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IGwub3BhY2l0eSxcbiAgICAgICAgICAgICAgICAgICAgZmlsbE9wYWNpdHk6IGwuZmlsbE9wYWNpdHksXG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodDogbC5oaWdobGlnaHRfc3R5bGUsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlczogbC5zdHlsZV9vdmVycmlkZXMsXG4gICAgICAgICAgICAgICAgICAgIGZlYXR1cmVTdHlsZXM6IGwuZmVhdHVyZV9zdHlsZXMsXG4gICAgICAgICAgICAgICAgICAgIHRpbWU6IGwudGltZSxcbiAgICAgICAgICAgICAgICAgICAgZ3B1OiBncHVQb2ludHMsXG4gICAgICAgICAgICAgICAgICAgIHRpY2s6IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS50aWNrIDogMCxcbiAgICAgICAgICAgICAgICAgICAgd2luOiBsLnRpbWUgJiYgdGltZVN0YXRlICYmICFncHVQb2ludHMgPyB0aW1lU3RhdGUud2luZG93IDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgcGVyOiBsLnRpbWUgJiYgZ3B1UG9pbnRzICYmIHRpbWVTdGF0ZVxuICAgICAgICAgICAgICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGJ1ZkxlbjogY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF0/LmJ5dGVMZW5ndGggfHwgMCxcbiAgICAgICAgICAgICAgICAgICAgbG9jTGVuOiBsLmxvY2F0aW9ucz8ubGVuZ3RoIHx8IDBcbiAgICAgICAgICAgICAgICB9KSkpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGUgPSBnbFN0YXRlc1t0eXBlXTtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZUNoYW5nZWQgPSBzdGF0ZS5pZHMgIT09IGlkc1N0cmluZyB8fCBzdGF0ZS5tZXRhICE9PSBtZXRhU3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh2aXNpYmxlTGF5ZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gYXdhaXQgcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIHZpc2libGVMYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBtb2RlbCwgdGltZVN0YXRlLCB2ZWN0b3JHcHUsIGZlYXR1cmVWaXNpYmxlTm93KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc3RhdGUuaWRzID0gaWRzU3RyaW5nO1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5tZXRhID0gbWV0YVN0cmluZztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgaG9sZGluZyB0aW1lIGxheWVycyBrZWVwIEVWRVJZIHBvaW50IGxheWVyIC0tIGhpZGRlbiBvbmVzXG4gICAgICAgICAgICAvLyBpbmNsdWRlZCAtLSBzbyBhIHNpZGViYXIgdG9nZ2xlIGNoYW5nZXMgYSB2aXNpYmlsaXR5IHVuaWZvcm0gaW5zdGVhZCBvZlxuICAgICAgICAgICAgLy8gdGhlIGJ1Y2tldCdzIGlkcy4gVW5jaGVja2luZyBvbmUgb2YgMjUgdHJhY2tzIHVzZWQgdG8gcmVidWlsZCBhbGwgNU1cbiAgICAgICAgICAgIC8vIHBvaW50czsgY2xpY2tpbmcgZG93biB0aGUgc2lkZWJhciBzdGFja2VkIHRob3NlIHJlYnVpbGRzIGludG8gYSBjcmFzaC5cbiAgICAgICAgICAgIGNvbnN0IGFsbEJ5VHlwZSA9IGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICAvLyBBcmVhIG91dGxpbmVzIHJpZGUgdGhlIGxpbmVzIGJ1Y2tldDogZXZlcnkgcG9seWdvbiBhbmQgY2lyY2xlIGpvaW5zIGl0IGFzXG4gICAgICAgICAgICAvLyBhbiBleHRyYSBlbnRyeSB3aG9zZSByaW5ncyByZW5kZXIgYXMgd2VpZ2h0ZWQgTGluZVN0cmluZ3MgKHRoZSBwb2x5Z29uXG4gICAgICAgICAgICAvLyBidWNrZXQgZHJhd3Mgb25seSB0aGUgZmlsbCkuIEpvaW5pbmcgdW5jb25kaXRpb25hbGx5IC0tIHN0cm9rZWxlc3MgYXJlYXNcbiAgICAgICAgICAgIC8vIGNvbnRyaWJ1dGUgYW4gZW1wdHkgc2xvdCAtLSBrZWVwcyB0aGUgYnVja2V0J3MgbWVtYmVyc2hpcCBpbmRlcGVuZGVudCBvZlxuICAgICAgICAgICAgLy8gc3R5bGUgY2hhbmdlcywgc28gcmVzdHlsaW5nIGEgYm9yZGVyIHN0YXlzIGEgcmVidWlsZCwgbmV2ZXIgYSByZS1idWNrZXQuXG4gICAgICAgICAgICBhbGxCeVR5cGUucG9seWxpbmUgPSBbLi4uYWxsQnlUeXBlLnBvbHlsaW5lLCAuLi5hbGxCeVR5cGUucG9seWdvbl07XG4gICAgICAgICAgICBjb25zdCBidWNrZXQgPSB7IGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlsaW5lOiBbLi4ud2ViZ2xQb2x5bGluZUxheWVycywgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9seWdvbjogd2ViZ2xQb2x5Z29uTGF5ZXJzIH07XG4gICAgICAgICAgICBjb25zdCB2ZWN0b3JHcHVCdWNrZXQgPSB7IHBvbHlsaW5lOiBmYWxzZSwgcG9seWdvbjogZmFsc2UgfTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgdHlwZSBvZiBbXCJjaXJjbGVfbWFya2Vyc1wiLCBcIm1hcmtlcnNcIiwgXCJwb2x5bGluZVwiLCBcInBvbHlnb25cIl0pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBlbnRyaWVzID0gYWxsQnlUeXBlW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGlzUG9pbnRzID0gdHlwZSA9PT0gXCJjaXJjbGVfbWFya2Vyc1wiIHx8IHR5cGUgPT09IFwibWFya2Vyc1wiO1xuICAgICAgICAgICAgICAgIGNvbnN0IGF2YWlsYWJsZSA9IGlzUG9pbnRzID8gZ3B1VGltZUF2YWlsYWJsZSgpIDogdmVjdG9yR3B1QXZhaWxhYmxlKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZ3B1VmlzID0gYXZhaWxhYmxlICYmIGVudHJpZXMubGVuZ3RoID4gMFxuICAgICAgICAgICAgICAgICAgICAmJiBlbnRyaWVzLmxlbmd0aCA8PSBMQVlFUl9TTE9UU1xuICAgICAgICAgICAgICAgICAgICAmJiBlbnRyaWVzLnNvbWUoZSA9PiBlLmxheWVyLnRpbWUpO1xuICAgICAgICAgICAgICAgIGdsU3RhdGVzW3R5cGVdLnZpc1ZlY3RvciA9IGdwdVZpcyA/IGVudHJpZXMubWFwKGUgPT4gKGUudmlzID8gMSA6IDApKSA6IG51bGw7XG4gICAgICAgICAgICAgICAgaWYgKGdwdVZpcykgYnVja2V0W3R5cGVdID0gZW50cmllcy5tYXAoZSA9PiBlLmxheWVyKTtcbiAgICAgICAgICAgICAgICBpZiAoIWlzUG9pbnRzKSB2ZWN0b3JHcHVCdWNrZXRbdHlwZV0gPSBncHVWaXM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwiY2lyY2xlX21hcmtlcnNcIiwgYnVja2V0LmNpcmNsZV9tYXJrZXJzKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwibWFya2Vyc1wiLCBidWNrZXQubWFya2Vycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlsaW5lXCIsIGJ1Y2tldC5wb2x5bGluZSwgdmVjdG9yR3B1QnVja2V0LnBvbHlsaW5lKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWdvblwiLCBidWNrZXQucG9seWdvbiwgdmVjdG9yR3B1QnVja2V0LnBvbHlnb24pO1xuXG4gICAgICAgICAgICAvLyBQdXNoIHRoZSBjdXJyZW50IHdpbmRvdyBpbnRvIHRoZSBHUFUtZmlsdGVyZWQgcG9pbnQgYnVja2V0czogdHdvIHVuaWZvcm1zXG4gICAgICAgICAgICAvLyBhbmQgYSByZWRyYXcsIHdoaWNoIGlzIHRoZSBlbnRpcmUgcGVyLXRpY2sgY29zdCBvZiB0aGUgdGltZSBzbGlkZXIgdGhlcmUuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2YgW1wiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCJdKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGUgPSBnbFN0YXRlc1t0eXBlXTtcbiAgICAgICAgICAgICAgICBjb25zdCBoYW5kbGUgPSBzdGF0ZS5sYXllciAmJiBzdGF0ZS5sYXllci5fc3dpZnRtYXBUaW1lO1xuICAgICAgICAgICAgICAgIGlmICghaGFuZGxlKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAvLyBMYXllciB2aXNpYmlsaXR5IGZpcnN0LCBhbmQgb25seSB3aGVuIGl0IGNoYW5nZWQ6IGEgdG9nZ2xlIGNvc3RzIG9uZVxuICAgICAgICAgICAgICAgIC8vIHVuaWZvcm0gYXJyYXkgd3JpdGUgYW5kIGEgcmVkcmF3LCBuZXZlciBhIHJlYnVpbGQuXG4gICAgICAgICAgICAgICAgY29uc3QgdmlzID0gc3RhdGUudmlzVmVjdG9yO1xuICAgICAgICAgICAgICAgIGlmICh2aXMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gdmlzLmpvaW4oXCJcIik7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS52aXNLZXkgIT09IGtleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUudmlzS2V5ID0ga2V5O1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldExheWVyVmlzaWJpbGl0eSh2aXMpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3ZlcnJpZGVNcyA9IHRpbWVTdGF0ZS53aW5kb3dcbiAgICAgICAgICAgICAgICAgICAgICAgID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh0aW1lU3RhdGUud2luZG93KSkgOiBudWxsO1xuICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0V2luZG93KHRpbWVTdGF0ZS50aWNrLCBvdmVycmlkZU1zKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0V2luZG93KG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgbW9kZWwsIG1hcCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gUGVybWFuZW50IGxhYmVscyBmb2xsb3cgdGhlIHNhbWUgZGVyaXZlLXBlci1zeW5jIHBhdHRlcm4gYXMgdGhlIGxlZ2VuZCxcbiAgICAgICAgICAgIC8vIHNvIHRoZXkgdHJhY2sgdmlzaWJpbGl0eSB3aXRoIG5vIGJ1Y2tldCBvciBtZXRhLWtleSBpbnZvbHZlbWVudCAtLSBhbmRcbiAgICAgICAgICAgIC8vIHNpbmNlIGV2ZXJ5IHBsYXliYWNrIHRpY2sgcmUtZW50ZXJzIHRoaXMgc3luYywgcGFzc2luZyB0aW1lU3RhdGUgbWFrZXNcbiAgICAgICAgICAgIC8vIHRoZW0gZm9sbG93IHRoZSB3aW5kb3cgdG9vOiBjaGlwcyBhcHBlYXIgYW5kIHZhbmlzaCB3aXRoIHRoZWlyIGZlYXR1cmVzLlxuICAgICAgICAgICAgaWYgKGxhYmVsc0dyb3VwKSB7XG4gICAgICAgICAgICAgICAgcmVuZGVyTGFiZWxzKEwsIGxhYmVsc0dyb3VwLCBsYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBncm91cENvbmZpZ3MsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGxlZ2VuZENmZyA9IG1vZGVsLmdldChcImxlZ2VuZF9jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBpZiAobW9kZWwuZ2V0KFwic2hvd19sZWdlbmRcIikpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzcGVjID0gZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgbGVnZW5kQ2ZnKTtcbiAgICAgICAgICAgICAgICByZW5kZXJMZWdlbmQobGVnZW5kRGl2LCBzcGVjLFxuICAgICAgICAgICAgICAgICAgICB7IGRpbUhpZGRlbjogbGVnZW5kQ2ZnLmRpbV9oaWRkZW4gIT09IGZhbHNlIH0pO1xuICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IFBPU0lUSU9OU1tsZWdlbmRDZmcucG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcImJvdHRvbS1sZWZ0XCJdO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgW3Byb3AsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwb3MpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZVtwcm9wXSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsZWdlbmREaXYuc3R5bGUuZGlzcGxheSA9IHNwZWMuZ3JvdXBzLmxlbmd0aCA+IDAgPyBcImJsb2NrXCIgOiBcIm5vbmVcIjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnNvbGUudGltZUVuZChcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XG4gICAgICAgIGxldCBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcblxuICAgICAgICAvLyBEcmF3IC8gQU9JIHRvb2xzOiBMZWFmbGV0LUdlb21hbiAodGhlIG1haW50YWluZWQgc3VjY2Vzc29yIHRvIExlYWZsZXQuZHJhdyxcbiAgICAgICAgLy8gd2hpY2ggYnJlYWtzIG9uIExlYWZsZXQgMS45KSwgbG9hZGVkIGZyb20gdW5wa2cgbGlrZSBMZWFmbGV0IGFuZCBnbGlmeSAtLVxuICAgICAgICAvLyBsYXppbHksIG9ubHkgd2hlbiBhIG1hcCB0dXJucyBkcmF3aW5nIG9uLCBzbyBldmVyeSBvdGhlciBtYXAgcGF5cyBub3RoaW5nLlxuICAgICAgICAvLyBEcmF3biBzaGFwZXMgbGl2ZSBpbiB0aGVpciBvd24gZmVhdHVyZSBncm91cCBhbmQgc3luYyB0byBQeXRob24gYXMgR2VvSlNPTlxuICAgICAgICAvLyBmZWF0dXJlcyB1bmRlciB0aGUgYGRyYXdpbmdzYCB0cmFpdCwgd2l0aCBgZHJhd19zZXFgIGJ1bXBpbmcgcGVyIGNoYW5nZSBzb1xuICAgICAgICAvLyBvbmUgb2JzZXJ2ZXIgY2F0Y2hlcyBjcmVhdGUsIGVkaXQgYW5kIGRlbGV0ZSBhbGlrZS4gVGhlIHRyYWl0IHN5bmNzIGJvdGhcbiAgICAgICAgLy8gd2F5czogUHl0aG9uIGNhbiBzZWVkIEFPSXMgb3IgY2xlYXIgdGhlbSwgYW5kIGV4cG9ydHMgY2FycnkgdGhlIGRyYXdpbmdzLlxuICAgICAgICBsZXQgZHJhd1JlYWR5ID0gZmFsc2U7XG4gICAgICAgIGxldCBkcmF3aW5nc0dyb3VwID0gbnVsbDtcbiAgICAgICAgbGV0IGRyYXdJZENvdW50ZXIgPSAwO1xuICAgICAgICBsZXQgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSBmYWxzZTtcblxuICAgICAgICBmdW5jdGlvbiBkcmF3aW5nVG9GZWF0dXJlKGwpIHtcbiAgICAgICAgICAgIGNvbnN0IGdqID0gbC50b0dlb0pTT04oKTtcbiAgICAgICAgICAgIGdqLnByb3BlcnRpZXMgPSB7IC4uLihnai5wcm9wZXJ0aWVzIHx8IHt9KSwgZHJhd19pZDogbC5fc3dpZnRtYXBEcmF3SWQgfTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbC5nZXRSYWRpdXMgPT09IFwiZnVuY3Rpb25cIiAmJiBsIGluc3RhbmNlb2YgTC5DaXJjbGUpIHtcbiAgICAgICAgICAgICAgICBnai5wcm9wZXJ0aWVzLmtpbmQgPSBcImNpcmNsZVwiO1xuICAgICAgICAgICAgICAgIGdqLnByb3BlcnRpZXMucmFkaXVzID0gbC5nZXRSYWRpdXMoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBnajtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHdyaXRlRHJhd2luZ3MoKSB7XG4gICAgICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5lYWNoTGF5ZXIobCA9PiBmZWF0dXJlcy5wdXNoKGRyYXdpbmdUb0ZlYXR1cmUobCkpKTtcbiAgICAgICAgICAgIHN1cHByZXNzRHJhd2luZ3NFY2hvID0gdHJ1ZTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZHJhd2luZ3NcIiwgZmVhdHVyZXMpO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImRyYXdfc2VxXCIsIChtb2RlbC5nZXQoXCJkcmF3X3NlcVwiKSB8fCAwKSArIDEpO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGRyYXdpbmdzIHN0aWxsIGxpdmUgb24gdGhlIG1hcCAqLyB9XG4gICAgICAgICAgICBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gYWRvcHREcmF3aW5nKGxheWVyKSB7XG4gICAgICAgICAgICBpZiAoIWxheWVyLl9zd2lmdG1hcERyYXdJZCkge1xuICAgICAgICAgICAgICAgIGxheWVyLl9zd2lmdG1hcERyYXdJZCA9IGBkcmF3XyR7KytkcmF3SWRDb3VudGVyfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkcmF3aW5nc0dyb3VwLmFkZExheWVyKGxheWVyKTtcbiAgICAgICAgICAgIGxheWVyLm9uKFwicG06dXBkYXRlIHBtOmRyYWdlbmQgcG06cm90YXRlZW5kXCIsIHdyaXRlRHJhd2luZ3MpO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gcmVoeWRyYXRlRHJhd2luZ3MoKSB7XG4gICAgICAgICAgICBkcmF3aW5nc0dyb3VwLmNsZWFyTGF5ZXJzKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZlYXR1cmUgb2YgbW9kZWwuZ2V0KFwiZHJhd2luZ3NcIikgfHwgW10pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGZlYXR1cmUucHJvcGVydGllcyB8fCB7fTtcbiAgICAgICAgICAgICAgICBsZXQgbGF5ZXI7XG4gICAgICAgICAgICAgICAgaWYgKHByb3BzLmtpbmQgPT09IFwiY2lyY2xlXCIgJiYgZmVhdHVyZS5nZW9tZXRyeS50eXBlID09PSBcIlBvaW50XCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgW2xuZywgbGF0XSA9IGZlYXR1cmUuZ2VvbWV0cnkuY29vcmRpbmF0ZXM7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyID0gTC5jaXJjbGUoW2xhdCwgbG5nXSwgeyByYWRpdXM6IHByb3BzLnJhZGl1cyB8fCAxMDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInN3aWZ0bWFwRHJhd1BhbmVcIiB9KTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBsYXllciA9IEwuZ2VvSlNPTihmZWF0dXJlLCB7IHBhbmU6IFwic3dpZnRtYXBEcmF3UGFuZVwiIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAuZ2V0TGF5ZXJzKClbMF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghbGF5ZXIpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGxheWVyLl9zd2lmdG1hcERyYXdJZCA9IHByb3BzLmRyYXdfaWQgfHwgYGRyYXdfJHsrK2RyYXdJZENvdW50ZXJ9YDtcbiAgICAgICAgICAgICAgICBhZG9wdERyYXdpbmcobGF5ZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc3luY0RyYXcoKSB7XG4gICAgICAgICAgICBjb25zdCBzaG93ID0gbW9kZWwuZ2V0KFwic2hvd19kcmF3XCIpO1xuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwiZHJhd19jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBpZiAoc2hvdyAmJiAhZHJhd1JlYWR5KSB7XG4gICAgICAgICAgICAgICAgZHJhd1JlYWR5ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAvLyBFdmVyeXRoaW5nIEdlb21hbiBjcmVhdGVzIGdvZXMgdG8gdGhlIHBhbmUgYWJvdmUgdGhlIEdMIHN0YWNrLlxuICAgICAgICAgICAgICAgIG1hcC5wbS5zZXRHbG9iYWxPcHRpb25zKHtcbiAgICAgICAgICAgICAgICAgICAgcGFuZXM6IHsgbGF5ZXJQYW5lOiBcInN3aWZ0bWFwRHJhd1BhbmVcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVydGV4UGFuZTogXCJtYXJrZXJQYW5lXCIsIG1hcmtlclBhbmU6IFwibWFya2VyUGFuZVwiIH0sXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgZHJhd2luZ3NHcm91cCA9IEwuZmVhdHVyZUdyb3VwKCkuYWRkVG8obWFwKTtcbiAgICAgICAgICAgICAgICByZWh5ZHJhdGVEcmF3aW5ncygpO1xuICAgICAgICAgICAgICAgIG1hcC5vbihcInBtOmNyZWF0ZVwiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhZG9wdERyYXdpbmcoZS5sYXllcik7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBtYXAub24oXCJwbTpyZW1vdmVcIiwgKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gR2VvbWFuIHJlbW92ZXMgdGhlIGxheWVyIGZyb20gdGhlIE1BUDsgdGhlIGZlYXR1cmUgZ3JvdXAgc3RpbGxcbiAgICAgICAgICAgICAgICAgICAgLy8gaG9sZHMgaXQsIGFuZCB3cml0ZURyYXdpbmdzIHJlYWRzIHRoZSBncm91cCAtLSBldmljdCBpdCBmaXJzdFxuICAgICAgICAgICAgICAgICAgICAvLyBvciB0aGUgZGVsZXRpb24gbmV2ZXIgcmVhY2hlcyB0aGUgdHJhaXQuXG4gICAgICAgICAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAucmVtb3ZlTGF5ZXIoZS5sYXllcik7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpkcmF3aW5nc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc3VwcHJlc3NEcmF3aW5nc0VjaG8pIHJlaHlkcmF0ZURyYXdpbmdzKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWRyYXdSZWFkeSkgcmV0dXJuO1xuICAgICAgICAgICAgaWYgKHNob3cpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b29scyA9IGNmZy50b29sc1xuICAgICAgICAgICAgICAgICAgICB8fCBbXCJtYXJrZXJcIiwgXCJwb2x5bGluZVwiLCBcInJlY3RhbmdsZVwiLCBcInBvbHlnb25cIiwgXCJjaXJjbGVcIl07XG4gICAgICAgICAgICAgICAgbWFwLnBtLmFkZENvbnRyb2xzKHtcbiAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IChjZmcucG9zaXRpb24gfHwgXCJ0b3AtbGVmdFwiKS5yZXBsYWNlKFwiLVwiLCBcIlwiKSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd01hcmtlcjogdG9vbHMuaW5jbHVkZXMoXCJtYXJrZXJcIiksXG4gICAgICAgICAgICAgICAgICAgIGRyYXdQb2x5bGluZTogdG9vbHMuaW5jbHVkZXMoXCJwb2x5bGluZVwiKSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd1JlY3RhbmdsZTogdG9vbHMuaW5jbHVkZXMoXCJyZWN0YW5nbGVcIiksXG4gICAgICAgICAgICAgICAgICAgIGRyYXdQb2x5Z29uOiB0b29scy5pbmNsdWRlcyhcInBvbHlnb25cIiksXG4gICAgICAgICAgICAgICAgICAgIGRyYXdDaXJjbGU6IHRvb2xzLmluY2x1ZGVzKFwiY2lyY2xlXCIpLFxuICAgICAgICAgICAgICAgICAgICBkcmF3Q2lyY2xlTWFya2VyOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgZHJhd1RleHQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICByb3RhdGVNb2RlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgY3V0UG9seWdvbjogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIGVkaXRNb2RlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBkcmFnTW9kZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgcmVtb3ZhbE1vZGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1hcC5wbS5yZW1vdmVDb250cm9scygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHN5bmNEcmF3KCk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfZHJhd1wiLCBzeW5jRHJhdyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmRyYXdfY29uZmlnXCIsIHN5bmNEcmF3KTtcblxuICAgICAgICAvLyBUaGUgc2NhbGUgYmFyOiBMZWFmbGV0J3Mgb3duIGNvbnRyb2wsIHdoaWNoIG1lYXN1cmVzIHRocm91Z2ggdGhlIG1hcCdzIENSU1xuICAgICAgICAvLyAoaGF2ZXJzaW5lIHVuZGVyIDM4NTcgYW5kIDQzMjYgYWxpa2UgLS0gbm8gcGl4ZWwgbWF0aCBvZiBvdXJzKSwgZXh0ZW5kZWRcbiAgICAgICAgLy8gd2l0aCB0aGUgdW5pdCBMZWFmbGV0IGxhY2tzIGFuZCB0aGlzIGRvbWFpbiBydW5zIG9uOiBuYXV0aWNhbCBtaWxlcy5cbiAgICAgICAgY29uc3QgTmF1dGljYWxTY2FsZSA9IEwuQ29udHJvbC5TY2FsZS5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uIChtKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5vbkFkZC5jYWxsKHRoaXMsIG0pO1xuICAgICAgICAgICAgICAgIHRoaXMuX25hdXRpY2FsU2NhbGUgPSBMLkRvbVV0aWwuY3JlYXRlKFxuICAgICAgICAgICAgICAgICAgICBcImRpdlwiLCBcImxlYWZsZXQtY29udHJvbC1zY2FsZS1saW5lXCIsIGNvbnRhaW5lcik7XG4gICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRhaW5lcjtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBfdXBkYXRlU2NhbGVzOiBmdW5jdGlvbiAobWF4TWV0ZXJzKSB7XG4gICAgICAgICAgICAgICAgTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5fdXBkYXRlU2NhbGVzLmNhbGwodGhpcywgbWF4TWV0ZXJzKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbmF1dGljYWxTY2FsZSAmJiBtYXhNZXRlcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4Tm0gPSBtYXhNZXRlcnMgLyAxODUyO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBubSA9IHRoaXMuX2dldFJvdW5kTnVtKG1heE5tKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlU2NhbGUodGhpcy5fbmF1dGljYWxTY2FsZSwgYCR7bm19IG5tYCwgbm0gLyBtYXhObSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGV0IHNjYWxlQ29udHJvbCA9IG51bGw7XG4gICAgICAgIGZ1bmN0aW9uIHN5bmNTY2FsZSgpIHtcbiAgICAgICAgICAgIGlmIChzY2FsZUNvbnRyb2wpIHtcbiAgICAgICAgICAgICAgICBzY2FsZUNvbnRyb2wucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgc2NhbGVDb250cm9sID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghbW9kZWwuZ2V0KFwic2hvd19zY2FsZVwiKSkgcmV0dXJuO1xuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwic2NhbGVfY29uZmlnXCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgdW5pdHMgPSBjZmcudW5pdHMgfHwgXCJtZXRyaWNcIjtcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcG9zaXRpb246IChjZmcucG9zaXRpb24gfHwgXCJib3R0b20tbGVmdFwiKS5yZXBsYWNlKFwiLVwiLCBcIlwiKSxcbiAgICAgICAgICAgICAgICBtYXhXaWR0aDogY2ZnLm1heF93aWR0aCB8fCAxMjAsXG4gICAgICAgICAgICAgICAgbWV0cmljOiB1bml0cyA9PT0gXCJtZXRyaWNcIiB8fCB1bml0cyA9PT0gXCJib3RoXCIsXG4gICAgICAgICAgICAgICAgaW1wZXJpYWw6IHVuaXRzID09PSBcImltcGVyaWFsXCIgfHwgdW5pdHMgPT09IFwiYm90aFwiLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbCA9IHVuaXRzID09PSBcIm5hdXRpY2FsXCJcbiAgICAgICAgICAgICAgICA/IG5ldyBOYXV0aWNhbFNjYWxlKG9wdGlvbnMpXG4gICAgICAgICAgICAgICAgOiBMLmNvbnRyb2wuc2NhbGUob3B0aW9ucyk7XG4gICAgICAgICAgICBzY2FsZUNvbnRyb2wuYWRkVG8obWFwKTtcbiAgICAgICAgfVxuICAgICAgICBzeW5jU2NhbGUoKTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19zY2FsZVwiLCBzeW5jU2NhbGUpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzY2FsZV9jb25maWdcIiwgc3luY1NjYWxlKTtcblxuICAgICAgICAvLyBFbXB0eS1tYXAgY2xpY2tzOiByZXBvcnQgd2hlcmUuIFJlZ2lzdGVyZWQgdGhyb3VnaCB0aGUgc2FtZSBhcmJpdHJhdGlvbiB0aGVcbiAgICAgICAgLy8gZmVhdHVyZSBoYW5kbGVycyB1c2UsIGF0IHRoZSBsb3dlc3QgcHJpb3JpdHksIHNvIGEgY2xpY2sgdGhhdCBoaXQgYSBmZWF0dXJlXG4gICAgICAgIC8vIHN0YXlzIHRoYXQgZmVhdHVyZSdzIGNsaWNrIC0tIHRoaXMgd2lucyBvbmx5IHdoZW4gbm90aGluZyBjbGFpbWVkIHRoZSBldmVudC5cbiAgICAgICAgLy8gZS5sYXRsbmcgaXMgYWxyZWFkeSB1bnByb2plY3RlZCB0aHJvdWdoIHdoaWNoZXZlciBDUlMgdGhlIG1hcCBydW5zICgzODU3IGFuZFxuICAgICAgICAvLyA0MzI2IGFsaWtlKSwgc28gdGhlcmUgaXMgbm8gcGl4ZWwgbWF0aCB0byBnZXQgd3JvbmcgaGVyZTsgd3JhcCgpIGtlZXBzIGFcbiAgICAgICAgLy8gd29ybGQtcGFubmVkIG1hcCBmcm9tIHJlcG9ydGluZyBsb25naXR1ZGUgLTM2NC5cbiAgICAgICAgbWFwLm9uKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgIC8vIFN0YW1wZWQgc3luY2hyb25vdXNseSwgYmVmb3JlIGFueSBnbGlmeSBoYW5kbGVyIHJlZ2lzdGVycyBpdHMgbWF0Y2hcbiAgICAgICAgICAgIC8vICh0aGlzIGhhbmRsZXIgd2FzIGJvdW5kIGZpcnN0LCBzbyBMZWFmbGV0IHJ1bnMgaXQgZmlyc3QpOiB0aGUgd2hvbGVcbiAgICAgICAgICAgIC8vIGNsaWNrIHBpcGVsaW5lIC0tIGZlYXR1cmUgcG9wdXBzIGFuZCB0aGlzIGZhbGxiYWNrIGFsaWtlIC0tIHN0YW5kc1xuICAgICAgICAgICAgLy8gZG93biB3aGlsZSBhIEdlb21hbiBtb2RlIGlzIGFybWVkLiBEZWZlcnJlZCBjaGVja3MgbWlzcyBtb2RlcyB0aGF0XG4gICAgICAgICAgICAvLyBjbG9zZSB0aGVtc2VsdmVzIG9uIHRoZWlyIGZpbmlzaGluZyBjbGljayAoYSBjb21wbGV0ZWQgcmVjdGFuZ2xlKSxcbiAgICAgICAgICAgIC8vIHdoaWNoIGlzIHdoeSB0aGUgc3RhdGUgaXMgY2FwdHVyZWQgYXQgY2xpY2sgdGltZS5cbiAgICAgICAgICAgIGNvbnN0IHBtID0gbWFwLnBtO1xuICAgICAgICAgICAgbWFwLl9wbU1vZGVBY3RpdmUgPSBCb29sZWFuKHBtXG4gICAgICAgICAgICAgICAgJiYgKChwbS5nbG9iYWxSZW1vdmFsTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsUmVtb3ZhbE1vZGVFbmFibGVkKCkpXG4gICAgICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxFZGl0TW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRWRpdE1vZGVFbmFibGVkKCkpXG4gICAgICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmFnTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhZ01vZGVFbmFibGVkKCkpXG4gICAgICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmF3TW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhd01vZGVFbmFibGVkKCkpKSk7XG4gICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCA5OSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxsID0gZS5sYXRsbmcud3JhcCgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IE1hdGgucm91bmQobGwubGF0ICogMWU1KSAvIDFlNTtcbiAgICAgICAgICAgICAgICBjb25zdCBsbmcgPSBNYXRoLnJvdW5kKGxsLmxuZyAqIDFlNSkgLyAxZTU7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBcIlwiKTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgLTEpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLCBbbGF0LCBsbmddKTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgaWYgKG1vZGVsLmdldChcInNob3dfY2xpY2tfY29vcmRpbmF0ZXNcIikpIHtcbiAgICAgICAgICAgICAgICAgICAgTC5wb3B1cCh7IGNsYXNzTmFtZTogXCJzd2lmdG1hcC1jb29yZHMtcG9wdXBcIiwgY2xvc2VCdXR0b246IGZhbHNlIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAuc2V0TGF0TG5nKGUubGF0bG5nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLnNldENvbnRlbnQoYCR7bGwubGF0LnRvRml4ZWQoNSl9LCAke2xsLmxuZy50b0ZpeGVkKDUpfWApXG4gICAgICAgICAgICAgICAgICAgICAgICAub3Blbk9uKG1hcCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEJpbmQgem9vbSBhbmQgY2VudGVyIGNoYW5nZXMgYmFjayB0byBQeXRob24gc2FmZWx5XG4gICAgICAgIG1hcC5vbihcIm1vdmVlbmRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGVsQ2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGVsWm9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtb2RlbFpvb20gIT09IGN1cnJlbnRab29tO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSAhbW9kZWxDZW50ZXIgfHwgXG4gICAgICAgICAgICAgICAgICAgICFBcnJheS5pc0FycmF5KG1vZGVsQ2VudGVyKSB8fFxuICAgICAgICAgICAgICAgICAgICBtb2RlbENlbnRlci5sZW5ndGggPCAyIHx8XG4gICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzBdIC0gY2VudGVyLmxhdCkgPiAwLjAwMDEgfHwgXG4gICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzFdIC0gY2VudGVyLmxuZykgPiAwLjAwMDE7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2VudGVyXCIsIFtjZW50ZXIubGF0LCBjZW50ZXIubG5nXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ6b29tXCIsIGN1cnJlbnRab29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgc2FmZVNhdmVDaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIG1vdmVlbmQgaGFuZGxlcjpcIiwgZXJyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlTWFwVmlldygpIHtcbiAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1vZGVsLmdldChcImNlbnRlclwiKTtcbiAgICAgICAgICAgIGNvbnN0IHpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgaWYgKGNlbnRlciAmJiBBcnJheS5pc0FycmF5KGNlbnRlcikgJiYgY2VudGVyLmxlbmd0aCA+PSAyKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWFwQ2VudGVyID0gbWFwLmdldENlbnRlcigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hcFpvb20gPSBtYXAuZ2V0Wm9vbSgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSBNYXRoLmFicyhtYXBDZW50ZXIubGF0IC0gY2VudGVyWzBdKSA+IDAuMDAwMSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5hYnMobWFwQ2VudGVyLmxuZyAtIGNlbnRlclsxXSkgPiAwLjAwMDE7XG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbUNoYW5nZWQgPSBtYXBab29tICE9PSB6b29tO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkIHx8IHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRWaWV3KGNlbnRlciwgdHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgPyB6b29tIDogbWFwWm9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgJiYgbWFwLmdldFpvb20oKSAhPT0gem9vbSkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbSh6b29tKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBXYXRjaCBmb3IgbWFwIHZpZXcgdXBkYXRlcyBmcm9tIFB5dGhvblxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpjZW50ZXJcIiwgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwKSB7XG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp6b29tXCIsICgpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nWm9vbUZyb21NYXApIHtcbiAgICAgICAgICAgICAgICBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBGaXR0aW5nIHRoZSB2aWV3IGlzIGEgY29tbWFuZCwgbm90IHN0YXRlOiBhc2tpbmcgdG8gZml0IHRoZSBzYW1lIGJvdW5kcyB0d2ljZVxuICAgICAgICAvLyBtdXN0IG1vdmUgdGhlIG1hcCBib3RoIHRpbWVzLCBzaW5jZSB0aGUgdXNlciBtYXkgaGF2ZSBwYW5uZWQgYXdheSBpbiBiZXR3ZWVuLlxuICAgICAgICAvLyBUaGUgcmVxdWVzdCBjYXJyaWVzIGEgc2VxdWVuY2UgbnVtYmVyIHNvIGFuIGlkZW50aWNhbCBmaXQgc3RpbGwgZmlyZXMgYSBjaGFuZ2UuXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5Rml0UmVxdWVzdCgpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlcSA9IG1vZGVsLmdldChcImZpdF9ib3VuZHNfcmVxdWVzdFwiKSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IHJlcS5ib3VuZHM7XG4gICAgICAgICAgICBpZiAoIWJvdW5kcyB8fCBib3VuZHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgICAgIGlmIChyZXEucGFkZGluZyAhPSBudWxsKSBvcHRpb25zLnBhZGRpbmcgPSBbcmVxLnBhZGRpbmcsIHJlcS5wYWRkaW5nXTtcbiAgICAgICAgICAgIGlmIChyZXEubWF4X3pvb20gIT0gbnVsbCkgb3B0aW9ucy5tYXhab29tID0gcmVxLm1heF96b29tO1xuICAgICAgICAgICAgbWFwLmZpdEJvdW5kcyhib3VuZHMsIG9wdGlvbnMpO1xuXG4gICAgICAgICAgICAvLyBBcHBsaWVkIGFmdGVyIHRoZSBmaXQsIHNpbmNlIGl0IGlzIHJlbGF0aXZlIHRvIHdoYXRldmVyIHpvb20gdGhlIGZpdCBjaG9zZS5cbiAgICAgICAgICAgIGlmIChyZXEuem9vbV9vZmZzZXQpIHtcbiAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbShtYXAuZ2V0Wm9vbSgpICsgcmVxLnpvb21fb2Zmc2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpmaXRfYm91bmRzX3JlcXVlc3RcIiwgYXBwbHlGaXRSZXF1ZXN0KTtcbiAgICAgICAgLy8gQSByZXF1ZXN0IHNldCBiZWZvcmUgdGhpcyB2aWV3IGF0dGFjaGVkIC0tIGEgcHJlLWRpc3BsYXkgZml0X2JvdW5kcygpIGNhbGwsXG4gICAgICAgIC8vIG9yIHRoZSB1bmlvbiBhIGZyZXNoIG1hcCBtYWludGFpbnMgYXMgYXV0by1maXQgd2hpbGUgbGF5ZXJzIGFyZSBhZGRlZCAtLSBpc1xuICAgICAgICAvLyBhbHJlYWR5IHN0YXRlIGJ5IG5vdywgc28gdGhlIGNoYW5nZSBldmVudCB3aWxsIG5ldmVyIGZpcmUgZm9yIGl0LiBJdCB1c2VkXG4gICAgICAgIC8vIHRvIGJlIHNpbGVudGx5IGRyb3BwZWQ7IGFwcGx5IGl0IG9uY2UgdGhlIG1hcCBpcyByZWFkeSBpbnN0ZWFkLlxuICAgICAgICBtYXAud2hlblJlYWR5KCgpID0+IGFwcGx5Rml0UmVxdWVzdCgpKTtcbiAgICAgICAgLy8gQSBtYXAgY29uc3RydWN0ZWQgaW5zaWRlIGEgaGlkZGVuIGNvbnRhaW5lciAtLSBhIFNoaW55IG5hdl9wYW5lbCB0aGF0IGlzXG4gICAgICAgIC8vIG5vdCB0aGUgc2VsZWN0ZWQgdGFiIC0tIGluaXRpYWxpc2VzIGF0IDB4MCwgYW5kIExlYWZsZXQgY2FjaGVzIHRoYXQgc2l6ZTpcbiAgICAgICAgLy8gaXRzIG93biB0cmFja1Jlc2l6ZSB3YXRjaGVzIHRoZSBXSU5ET1csIG5vdCB0aGUgY29udGFpbmVyLCBzbyBub3RoaW5nIGV2ZXJcbiAgICAgICAgLy8gY29ycmVjdHMgaXQuIFRoZSBmaXQgYWJvdmUgdGhlbiBjb21wdXRlcyBpdHMgem9vbSBmcm9tIGEgemVyby1zaXplIGxpZSBhbmRcbiAgICAgICAgLy8gdGhlIHZpZXcgbGFuZHMgd3JvbmcgcGVybWFuZW50bHkuIFdhdGNoIHRoZSBjb250YWluZXIgaXRzZWxmOiBldmVyeSByZXNpemVcbiAgICAgICAgLy8gcmUtbWVhc3VyZXMsIGFuZCB0aGUgZmlyc3QgdHJhbnNpdGlvbiBmcm9tIHplcm8gdG8gcmVhbCBzaXplIHJlLWFwcGxpZXNcbiAgICAgICAgLy8gdGhlIHBlbmRpbmcgZml0IHdpdGggYSBzaXplIHRoYXQgY2FuIGFjdHVhbGx5IGhvbGQgaXQuXG4gICAgICAgIGlmICh0eXBlb2YgUmVzaXplT2JzZXJ2ZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgIGxldCBoYWRTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5lclJlc2l6ZSA9IG5ldyBSZXNpemVPYnNlcnZlcigoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgaGFzU2l6ZSA9IGNvbnRhaW5lci5jbGllbnRXaWR0aCA+IDAgJiYgY29udGFpbmVyLmNsaWVudEhlaWdodCA+IDA7XG4gICAgICAgICAgICAgICAgaWYgKGhhc1NpemUpIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghaGFkU2l6ZSkgYXBwbHlGaXRSZXF1ZXN0KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGhhZFNpemUgPSBoYXNTaXplO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb250YWluZXJSZXNpemUub2JzZXJ2ZShjb250YWluZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgbGV0IGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICBsZXQgbmVlZHNTeW5jID0gZmFsc2U7XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoaXNTeW5jaW5nKSB7XG4gICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpc1N5bmNpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCBzeW5jTWFwU3RhdGUoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBzeW5jTWFwU3RhdGU6XCIsIGVycik7XG4gICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGlmIChuZWVkc1N5bmMpIHtcbiAgICAgICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gcXVldWVTeW5jKCkge1xuICAgICAgICAgICAgaWYgKCFtb2RlbC5nZXQoXCJhdXRvX3N5bmNcIikpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoc3luY1RpbWVvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICBzeW5jVGltZW91dCA9IG51bGw7XG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgIH0sIDUwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgbWFudWFsIHN5bmMgdHJpZ2dlciBjaGFuZ2VzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnN5bmNfdHJpZ2dlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJbmNyZW1lbnRhbCB1cGRhdGVzIGZyb20gUHl0aG9uLiBBcHBsaWVkIGV2ZW4gd2hlbiBhdXRvX3N5bmMgaXMgb2ZmIHNvIHRoZSBtaXJyb3JcbiAgICAgICAgLy8gc3RheXMgY3VycmVudDsgcXVldWVTeW5jIGRlY2lkZXMgd2hldGhlciB0byBhY3R1YWxseSByZS1yZW5kZXIuXG4gICAgICAgIG1vZGVsLm9uKFwibXNnOmN1c3RvbVwiLCAobXNnLCBidWZmZXJzKSA9PiB7XG4gICAgICAgICAgICBpZiAoIW1zZyB8fCBtc2cua2luZCAhPT0gXCJzd2lmdG1hcF9wYXRjaFwiKSByZXR1cm47XG4gICAgICAgICAgICBhcHBseVBhdGNoT3BzKG1zZy5vcHMgfHwgW10sIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEZ1bGwtc25hcHNob3QgcGF0aHM6IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UsIGFuZCB0aGUgc2lkZWJhciB3cml0aW5nIGBsYXllcnNgXG4gICAgICAgIC8vIGJhY2sgYWZ0ZXIgYSB0b2dnbGUuIEVpdGhlciB3YXkgdGhlIHRyYWl0IGJlY29tZXMgYXV0aG9yaXRhdGl2ZSBhZ2Fpbi5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6bGF5ZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNvb3JkaW5hdGVfYnVmZmVyc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Z3JvdXBfY29uZmlnc1wiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2NvbmZpZ1wiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlOyAgIC8vIHJlLWFwcGx5IHNwZWVkL2xvb3AgZnJvbSB0aGUgbmV3IGNvbmZpZ1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcbiAgICAgICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jdXJyZW50XCIsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdhbnRlZCA9IG1vZGVsLmdldChcInRpbWVfY3VycmVudFwiKTtcbiAgICAgICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XG4gICAgICAgICAgICBpZiAoTWF0aC5hYnMod2FudGVkIC0gdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pIDwgMSkgcmV0dXJuO1xuICAgICAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBzZWVrVG8oaWR4LCB7IHdyaXRlOiBmYWxzZSB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbG9nb1wiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzaG93X2xlZ2VuZFwiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsZWdlbmRfY29uZmlnXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIC8vIExpdmUgcmVzaXplcyAoYSBTaGlueSBsYXlvdXQsIGEgbm90ZWJvb2sgY2VsbCk6IExlYWZsZXQgY2FjaGVzIGl0cyBib3gsIHNvXG4gICAgICAgIC8vIGl0IG11c3QgYmUgdG9sZCB0byByZS1tZWFzdXJlIG9yIHRpbGVzIHJlbmRlciBmb3IgdGhlIG9sZCBzaXplLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpoZWlnaHRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgYXBwbHlIZWlnaHQoKTtcbiAgICAgICAgICAgIG1hcC5pbnZhbGlkYXRlU2l6ZSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBbm5vdW5jZSB0aGlzIHZpZXcgc28gUHl0aG9uIHJlcGxpZXMgd2l0aCBhIGZ1bGwgc25hcHNob3QuIExheWVycyBhZGRlZCBiZWZvcmVcbiAgICAgICAgLy8gdGhlIHZpZXcgYXR0YWNoZWQgd291bGQgb3RoZXJ3aXNlIGJlIG1pc3Npbmc6IHRoZWlyIHBhdGNoZXMgd2VyZSBlbWl0dGVkIGludG8gYVxuICAgICAgICAvLyB3aW5kb3cgd2hlcmUgbm90aGluZyB3YXMgbGlzdGVuaW5nLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbW9kZWwuc2VuZCh7IGtpbmQ6IFwic3dpZnRtYXBfcmVhZHlcIiB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSBpcyBhbGwgdGhlcmUgaXMgKi8gfVxuXG4gICAgICAgIC8vIFJlc3BlY3QgaW5pdGlhbCBhdXRvX3N5bmMgc3RhdGUgb3IgbWFudWFsIHN5bmMgcmVxdWVzdHMgc2VudCBkdXJpbmcgbWFwIGJ1aWxkaW5nXG4gICAgICAgIGlmIChtb2RlbC5nZXQoXCJhdXRvX3N5bmNcIikgfHwgbW9kZWwuZ2V0KFwic3luY190cmlnZ2VyXCIpID4gMCkge1xuICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgfVxuICAgIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQU8sU0FBUyxRQUFRLElBQUksS0FBSztBQUM3QixNQUFJLENBQUMsU0FBUyxlQUFlLEVBQUUsR0FBRztBQUM5QixVQUFNLE9BQU8sU0FBUyxjQUFjLE1BQU07QUFDMUMsU0FBSyxLQUFLO0FBQ1YsU0FBSyxNQUFNO0FBQ1gsU0FBSyxPQUFPO0FBQ1osYUFBUyxLQUFLLFlBQVksSUFBSTtBQUFBLEVBQ2xDO0FBQ0o7QUFFQSxJQUFNLGdCQUFnQixDQUFDO0FBRWhCLFNBQVMsT0FBTyxJQUFJLEtBQUs7QUFDNUIsTUFBSSxjQUFjLEVBQUUsR0FBRztBQUNuQixXQUFPLGNBQWMsRUFBRTtBQUFBLEVBQzNCO0FBQ0EsUUFBTSxVQUFVLElBQUksUUFBUSxDQUFDLFNBQVMsV0FBVztBQUM3QyxRQUFJLFNBQVMsZUFBZSxFQUFFLEdBQUc7QUFDN0IsY0FBUTtBQUNSO0FBQUEsSUFDSjtBQUNBLFVBQU0sU0FBUyxTQUFTLGNBQWMsUUFBUTtBQUM5QyxXQUFPLEtBQUs7QUFDWixXQUFPLE1BQU07QUFDYixXQUFPLFNBQVMsTUFBTSxRQUFRO0FBQzlCLFdBQU8sVUFBVSxNQUFNLE9BQU8sSUFBSSxNQUFNLDBCQUEwQixHQUFHLEVBQUUsQ0FBQztBQUN4RSxhQUFTLEtBQUssWUFBWSxNQUFNO0FBQUEsRUFDcEMsQ0FBQztBQUNELGdCQUFjLEVBQUUsSUFBSTtBQUNwQixTQUFPO0FBQ1g7QUFFQSxTQUFTLFNBQVMsS0FBSztBQUNuQixNQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2pC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
