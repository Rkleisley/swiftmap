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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3NoYWRlcnMuanMiLCAiLi4vLi4vc3JjL3RpbWVjb250cm9sLmpzIiwgIi4uLy4uL3NyYy9ncHV0aW1lLmpzIiwgIi4uLy4uL3NyYy9sYXllcnMuanMiLCAiLi4vLi4vc3JjL2xhYmVscy5qcyIsICIuLi8uLi9zcmMvbWFwLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgZnVuY3Rpb24gbG9hZENTUyhpZCwgdXJsKSB7XG4gICAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgY29uc3QgbGluayA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJsaW5rXCIpO1xuICAgICAgICBsaW5rLmlkID0gaWQ7XG4gICAgICAgIGxpbmsucmVsID0gXCJzdHlsZXNoZWV0XCI7XG4gICAgICAgIGxpbmsuaHJlZiA9IHVybDtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChsaW5rKTtcbiAgICB9XG59XG5cbmNvbnN0IGFjdGl2ZUxvYWRlcnMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKUyhpZCwgdXJsKSB7XG4gICAgaWYgKGFjdGl2ZUxvYWRlcnNbaWRdKSB7XG4gICAgICAgIHJldHVybiBhY3RpdmVMb2FkZXJzW2lkXTtcbiAgICB9XG4gICAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgaWYgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSkge1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzY3JpcHRcIik7XG4gICAgICAgIHNjcmlwdC5pZCA9IGlkO1xuICAgICAgICBzY3JpcHQuc3JjID0gdXJsO1xuICAgICAgICBzY3JpcHQub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xuICAgICAgICBzY3JpcHQub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIHNjcmlwdDogJHt1cmx9YCkpO1xuICAgICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHNjcmlwdCk7XG4gICAgfSk7XG4gICAgYWN0aXZlTG9hZGVyc1tpZF0gPSBwcm9taXNlO1xuICAgIHJldHVybiBwcm9taXNlO1xufVxuXG5mdW5jdGlvbiBoZXhUb1JnYihoZXgpIHtcbiAgICBpZiAoIWhleCkgcmV0dXJuIG51bGw7XG4gICAgaGV4ID0gaGV4LnJlcGxhY2UoL14jLywgJycpO1xuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XG4gICAgICAgIGhleCA9IGhleC5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhciArIGNoYXIpLmpvaW4oJycpO1xuICAgIH1cbiAgICBpZiAoaGV4Lmxlbmd0aCAhPT0gNikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbnVtID0gcGFyc2VJbnQoaGV4LCAxNik7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcjogKChudW0gPj4gMTYpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgZzogKChudW0gPj4gOCkgJiAyNTUpIC8gMjU1LFxuICAgICAgICBiOiAobnVtICYgMjU1KSAvIDI1NVxuICAgIH07XG59XG5cbmxldCBjb2xvclByb2JlID0gbnVsbDtcblxuLy8gQnJvd3NlcnMgc2hpcCBhIGNvbXBsZXRlIENTUyBjb2xvciBwYXJzZXIgLS0gZXZlcnkgbmFtZWQgY29sb3IsIHJnYigpLCBoc2woKSwgaHdiKCkuXG4vLyBCb3Jyb3cgaXQgaW5zdGVhZCBvZiBtYWludGFpbmluZyBhIGxvb2t1cCB0YWJsZS4gUmV0dXJucyBudWxsIG91dHNpZGUgYSBET00gKE5vZGUgdGVzdHMpLFxuLy8gd2hlcmUgdGhlIGhleCBmYWxsYmFjayBpbiBwYXJzZUNvbG9yIHN0aWxsIGFwcGxpZXMuXG5mdW5jdGlvbiBjc3NDb2xvclRvUmdiKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFjb2xvclByb2JlKSBjb2xvclByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKS5nZXRDb250ZXh0KFwiMmRcIik7XG5cbiAgICAvLyBBc3NpZ25pbmcgYW4gaW52YWxpZCBjb2xvciBsZWF2ZXMgZmlsbFN0eWxlIHVudG91Y2hlZCwgc28gcHJvYmUgYWdhaW5zdCB0d28gZGlmZmVyZW50XG4gICAgLy8gc2VudGluZWxzOiBvbmx5IGEgdmFsdWUgdGhlIGJyb3dzZXIgYWN0dWFsbHkgcGFyc2VkIHByb2R1Y2VzIHRoZSBzYW1lIHJlc3VsdCB0d2ljZS5cbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiIzAwMDAwMFwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgY29uc3QgZmlyc3QgPSBjb2xvclByb2JlLmZpbGxTdHlsZTtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IFwiI2ZmZmZmZlwiO1xuICAgIGNvbG9yUHJvYmUuZmlsbFN0eWxlID0gdmFsdWU7XG4gICAgaWYgKGZpcnN0ICE9PSBjb2xvclByb2JlLmZpbGxTdHlsZSkgcmV0dXJuIG51bGw7XG5cbiAgICBpZiAoZmlyc3Quc3RhcnRzV2l0aChcIiNcIikpIHJldHVybiBoZXhUb1JnYihmaXJzdCk7XG4gICAgY29uc3QgbWF0Y2ggPSBmaXJzdC5tYXRjaCgvcmdiYT9cXCgoW14pXSspXFwpLyk7XG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcGFydHMgPSBtYXRjaFsxXS5zcGxpdChcIixcIikubWFwKHAgPT4gcGFyc2VGbG9hdChwLnRyaW0oKSkpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzIHx8IHBhcnRzLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsgcjogcGFydHNbMF0gLyAyNTUsIGc6IHBhcnRzWzFdIC8gMjU1LCBiOiBwYXJ0c1syXSAvIDI1NSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb2xvcihjb2xvclN0ciwgZmFsbGJhY2tIZXggPSBcIiMzMzg4ZmZcIikge1xuICAgIGlmICghY29sb3JTdHIpIGNvbG9yU3RyID0gZmFsbGJhY2tIZXg7XG4gICAgcmV0dXJuIGNzc0NvbG9yVG9SZ2IoY29sb3JTdHIpXG4gICAgICAgIHx8IGhleFRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBjc3NDb2xvclRvUmdiKGZhbGxiYWNrSGV4KVxuICAgICAgICB8fCBoZXhUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG59XG5cbmNvbnN0IFVSTF9BVFRSX0JFRk9SRSA9IC8oPzpocmVmfHNyYylcXHMqPVxccypbJ1wiXT8kL2k7XG5jb25zdCBTQUZFX1VSTCA9IC9eKD86aHR0cHM/OlxcL1xcL3xtYWlsdG86fHRlbDp8ZGF0YTppbWFnZVxcL3xbLi8jP118W1xcdy4tXSsoPzpbLz8jXXwkKSkvaTtcblxuLy8gUHJvcGVydHkgdmFsdWVzIGNvbWUgZnJvbSB1c2VyIGRhdGEgYW5kIGVuZCB1cCBpbiBpbm5lckhUTUwsIHNvIHRoZXkgYXJlIGVzY2FwZWQuXG4vLyBNYXJrdXAgdGhlIGFwcCBhdXRob3Igd3JvdGUgKHRlbXBsYXRlcywgc3R5bGUgc3RyaW5ncykgaXMgbGVmdCBpbnRhY3QuXG5leHBvcnQgZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpXG4gICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcbn1cblxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXG4vLyBpbiBhIFVSTCBhdHRyaWJ1dGUgZ2V0IGEgc2NoZW1lIGNoZWNrLiBDb250cm9sIGNoYXJhY3RlcnMgYXJlIHN0cmlwcGVkIGZpcnN0IGJlY2F1c2Vcbi8vIFwiamF2YVxcdHNjcmlwdDpcIiBzdXJ2aXZlcyBhIG5haXZlIGNvbXBhcmlzb24uXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZSkge1xuICAgIGNvbnN0IGNvbGxhcHNlZCA9IFN0cmluZyh2YWx1ZSkuc3BsaXQoXCJcIikuZmlsdGVyKGMgPT4gYy5jaGFyQ29kZUF0KDApID4gMzIpLmpvaW4oXCJcIik7XG4gICAgcmV0dXJuIFNBRkVfVVJMLnRlc3QoY29sbGFwc2VkKSA/IFN0cmluZyh2YWx1ZSkgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICBjb25zdCB0YXJnZXRGaWVsZHMgPSAoQXJyYXkuaXNBcnJheShmaWVsZHMpICYmIGZpZWxkcy5sZW5ndGgpID8gZmllbGRzIDogT2JqZWN0LmtleXMocHJvcHMpO1xuICAgIGNvbnN0IGxhYmVscyA9IChBcnJheS5pc0FycmF5KG5hbWVzKSAmJiBuYW1lcy5sZW5ndGggPT09IHRhcmdldEZpZWxkcy5sZW5ndGgpID8gbmFtZXMgOiB0YXJnZXRGaWVsZHM7XG4gICAgY29uc3QgbGluZXMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldEZpZWxkcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBmID0gdGFyZ2V0RmllbGRzW2ldO1xuICAgICAgICBpZiAocHJvcHNbZl0gPT09IHVuZGVmaW5lZCB8fCBwcm9wc1tmXSA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGxpbmVzLnB1c2goYDxiPiR7ZXNjYXBlSHRtbChsYWJlbHNbaV0pfTwvYj46ICR7ZXNjYXBlSHRtbChwcm9wc1tmXSl9YCk7XG4gICAgfVxuICAgIHJldHVybiBsaW5lcy5qb2luKFwiPGJyPlwiKTtcbn1cblxuLy8gXCJ7Y29sdW1ufVwiIGluc2VydHMgb25lIGVzY2FwZWQgdmFsdWU7IFwieyp9XCIgaW5zZXJ0cyB0aGUgZGVmYXVsdCBmaWVsZCBsaXN0LlxuZnVuY3Rpb24gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XG4gICAgcmV0dXJuIHRlbXBsYXRlLnJlcGxhY2UoL1xceyhcXCp8XFx3KylcXH0vZywgKG1hdGNoLCBrZXksIG9mZnNldCkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcIipcIikge1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2YWwgPSBwcm9wc1trZXldO1xuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgICAgICAgY29uc3QgcHJlY2VkaW5nID0gdGVtcGxhdGUuc2xpY2UoTWF0aC5tYXgoMCwgb2Zmc2V0IC0gMTYpLCBvZmZzZXQpO1xuICAgICAgICByZXR1cm4gZXNjYXBlSHRtbChVUkxfQVRUUl9CRUZPUkUudGVzdChwcmVjZWRpbmcpID8gc2FmZVVybCh2YWwpIDogdmFsKTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBraW5kKSB7XG4gICAgY29uc3QgdGVtcGxhdGUgPSBsYXllcltraW5kICsgXCJfdGVtcGxhdGVcIl07XG4gICAgY29uc3QgZmllbGRzID0gbGF5ZXJba2luZCArIFwiX2ZpZWxkc1wiXTtcbiAgICBjb25zdCBuYW1lcyA9IGxheWVyW2tpbmQgKyBcIl9uYW1lc1wiXTtcbiAgICBpZiAodHlwZW9mIHRlbXBsYXRlID09PSBcInN0cmluZ1wiICYmIHRlbXBsYXRlKSB7XG4gICAgICAgIHJldHVybiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgIH1cbiAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xufVxuXG5mdW5jdGlvbiB3cmFwU3R5bGVkKGh0bWwsIHN0eWxlKSB7XG4gICAgaWYgKCFzdHlsZSkgcmV0dXJuIGh0bWw7XG4gICAgcmV0dXJuIGA8ZGl2IHN0eWxlPVwiJHtlc2NhcGVIdG1sKHN0eWxlKX1cIj4ke2h0bWx9PC9kaXY+YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQb3B1cChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInBvcHVwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF9wb3B1cCB8fCBsYXllci5wb3B1cF9maWVsZHMgfHwgbGF5ZXIucG9wdXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICAgICAgaWYgKGxheWVyLnBvcHVwX21heF93aWR0aCkgb3B0aW9ucy5tYXhXaWR0aCA9IGxheWVyLnBvcHVwX21heF93aWR0aDtcbiAgICAgICAgTC5wb3B1cChvcHRpb25zKVxuICAgICAgICAgICAgLnNldExhdExuZyhsYXRsbmcpXG4gICAgICAgICAgICAuc2V0Q29udGVudCh3cmFwU3R5bGVkKGh0bWwsIGxheWVyLnBvcHVwX3N0eWxlKSlcbiAgICAgICAgICAgIC5vcGVuT24obWFwKTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kVG9vbHRpcChtYXAsIGxhdGxuZywgcHJvcHMsIGxheWVyLCBsYXllckluc3RhbmNlKSB7XG4gICAgY29uc3QgaHRtbCA9IHJlbmRlckNvbnRlbnQocHJvcHMsIGxheWVyLCBcInRvb2x0aXBcIik7XG4gICAgaWYgKGh0bWwgJiYgKGxheWVyLmF1dG9iaW5kX3Rvb2x0aXAgfHwgbGF5ZXIudG9vbHRpcF9maWVsZHMgfHwgbGF5ZXIudG9vbHRpcF90ZW1wbGF0ZSkpIHtcbiAgICAgICAgaWYgKCFsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwID0gTC50b29sdGlwKHsgZGlyZWN0aW9uOiAndG9wJywgb2Zmc2V0OiBbMCwgLTVdIH0pO1xuICAgICAgICB9XG4gICAgICAgIGxheWVySW5zdGFuY2UuX3NoYXJlZFRvb2x0aXBcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci50b29sdGlwX3N0eWxlKSlcbiAgICAgICAgICAgIC5hZGRUbyhtYXApO1xuICAgIH1cbn1cbiIsICJjb25zdCBjb2xsYXBzZWRQYXRocyA9IHt9OyAgLy8gcGF0aCAtPiBjb2xsYXBzZWQ/XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGF5ZXJCb3VuZHMobCwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGlmICghbCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgLy8gU3VwcG9ydCBmb2xkZXIgdHJlZSBub2RlcyAoZ3JvdXBzIGluIHNpZGViYXIgdHJlZSlcclxuICAgIGlmIChsLmlzR3JvdXApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBjaGlsZHJlbiBncm91cHNcclxuICAgICAgICBPYmplY3Qua2V5cyhsLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhsLmNoaWxkcmVuW2tleV0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGQgbGF5ZXJzXHJcbiAgICAgICAgbC5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobHlyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChsLmJvdW5kcyAmJiBsLmJvdW5kcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgcmV0dXJuIGwuYm91bmRzO1xyXG4gICAgfVxyXG4gICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzdWIgb2YgbC5sYXllcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobC5sb2NhdGlvbnMgJiYgbC5sb2NhdGlvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IGwubG9jYXRpb25zLmZsYXQoSW5maW5pdHkpO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpXTtcclxuICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKyAxXTtcclxuICAgICAgICAgICAgaWYgKGxhdCA8IG1pbkxhdCkgbWluTGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgaWYgKGxvbiA+IG1heExvbikgbWF4TG9uID0gbG9uO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGlmIChjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdO1xyXG4gICAgICAgIGlmIChidWYpIHtcclxuICAgICAgICAgICAgY29uc3QgY29vcmRzID0gbmV3IEZsb2F0NjRBcnJheShidWYuYnVmZmVyLCBidWYuYnl0ZU9mZnNldCwgYnVmLmJ5dGVMZW5ndGggLyA4KTtcclxuICAgICAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGggLyAyOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGNvb3Jkc1tpICogMl07XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcclxuICAgICAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBUaGUgd3JpdGUgaGFsZiBvZiBhIHZpc2liaWxpdHkgdG9nZ2xlOiBvbmUgY3VzdG9tIG1lc3NhZ2UgbmFtaW5nIHRoZSBmbGlwcGVkIGlkcyxcclxuLy8gaW5zdGVhZCBvZiB0aGUgd2hvbGUgbGF5ZXJzIHRyYWl0LiBQeXRob24gYXBwbGllcyB0aGUgZmllbGRzIGFuZCByZS1lbWl0cyB0aGVtIGFzXHJcbi8vIGBzZXRgIHBhdGNoIG9wcywgd2hpY2ggaXMgaG93IG90aGVyIHZpZXdzIG9mIHRoZSBzYW1lIG1hcCAobm90ZWJvb2sgb3V0cHV0cykgc3RheVxyXG4vLyBpbiBzdGVwIG5vdyB0aGF0IHRoZSB0cmFpdCBubyBsb25nZXIgY2FycmllcyB0b2dnbGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gc2VuZExheWVyV3JpdGUobW9kZWwsIGNoYW5nZXMpIHtcclxuICAgIGlmICghY2hhbmdlcy5sZW5ndGgpIHJldHVybjtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgbW9kZWwuc2VuZCh7XHJcbiAgICAgICAgICAgIGtpbmQ6IFwic3dpZnRtYXBfd3JpdGVcIixcclxuICAgICAgICAgICAgb3BzOiBjaGFuZ2VzLm1hcChjID0+ICh7IG9wOiBcInNldFwiLCBpZDogYy5pZCwgZmllbGRzOiB7IHZpc2libGU6IGMudmlzaWJsZSB9IH0pKSxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSByZW5kZXJlZCBsaXN0IGFscmVhZHkgaG9sZHMgdGhlIGNoYW5nZSAqLyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZXBvcnRzIHdoYXQgaXQgY2hhbmdlZCAtLSB7Y2hhbmdlczogW3tpZCwgdmlzaWJsZX1dLCBncm91cHNDaGFuZ2VkfSAtLSBzbyB0aGVcclxuICAgIC8vIGNhbGxlciBjYW4gd3JpdGUgYmFjayBleGFjdGx5IHRob3NlIGZsaXBzIHJhdGhlciB0aGFuIHRoZSB3aG9sZSBsYXllcnMgbGlzdC5cclxuICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgIGxldCBncm91cHNDaGFuZ2VkID0gZmFsc2U7XHJcbiAgICBmdW5jdGlvbiBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUpIHtcclxuICAgICAgICBjb25zdCBjb25mID0gZ3JvdXBDb25maWdzW25vZGUucGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc1JhZGlvR3JvdXAgPSBjb25mLm11bHRpX3NlbGVjdCA9PT0gZmFsc2U7XHJcbiAgICAgICAgaWYgKGlzUmFkaW9Hcm91cCkge1xyXG4gICAgICAgICAgICBsZXQgZm91bmRBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRHcm91cCA9IG5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBzQ2hhbmdlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGx5ci52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlcy5wdXNoKHsgaWQ6IGx5ci5pZCwgdmlzaWJsZTogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlLmNoaWxkcmVuW2tleV0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgZW5mb3JjZVJhZGlvVG9nZ2xlcyh0cmVlKTtcclxuICAgIHJldHVybiB7IGNoYW5nZXMsIGdyb3Vwc0NoYW5nZWQgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsIG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xyXG4gICAgXHJcbiAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG5cclxuICAgIC8vIDEuIEJ1aWxkIGEgbmVzdGVkIGhpZXJhcmNoaWNhbCB0cmVlIGZyb20gdGhlIGZsYXQgbGF5ZXJzIGxpc3RcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIHJvb3QtbGV2ZWwgY29uZmlncyBkZWZhdWx0IHRvIG11bHRpX3NlbGVjdDogdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xyXG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcclxuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhdGhTdHIuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcclxuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xyXG4gICAgICAgIHBhcnRzLmZvckVhY2gocGFydCA9PiB7XHJcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcclxuICAgICAgICAgICAgICAgIGN1cnIuY2hpbGRyZW5bcGFydF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcclxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjoge30sXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXHJcbiAgICBmdW5jdGlvbiByZW5kZXJOb2RlKG5vZGUsIHBhcmVudEVsLCBkZXB0aCwgcGFyZW50Tm9kZSwgcGFyZW50RWZmZWN0aXZlVmlzaWJsZSkge1xyXG5cclxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIC8vIFJlbmRlciByb290J3MgY2hpbGQgZ3JvdXBzIGFuZCBjaGlsZCBsYXllcnMgZGlyZWN0bHkgd2l0aG91dCBoZWFkZXJcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGlzR3JvdXAgPSBub2RlLmlzR3JvdXAgPT09IHRydWU7XHJcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU7XHJcbiAgICAgICAgY29uc3QgaWQgPSBpc0dyb3VwID8gbnVsbCA6IG5vZGUuaWQ7XHJcblxyXG4gICAgICAgIC8vIERldGVybWluZSBzZWxlY3Rpb24gdHlwZSAoY2hlY2tib3ggdnMgcmFkaW8pIGJhc2VkIG9uIHBhcmVudCdzIG11bHRpX3NlbGVjdCBjb25maWdcclxuICAgICAgICBjb25zdCBwYXJlbnRQYXRoID0gcGFyZW50Tm9kZSA/IHBhcmVudE5vZGUucGF0aCA6IFwiXCI7XHJcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgIGNvbnN0IGlzTXVsdGlTZWxlY3QgPSBwYXJlbnRDb25mLm11bHRpX3NlbGVjdCAhPT0gZmFsc2U7XHJcblxyXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIG5vZGVEaXYuc3R5bGUubWFyZ2luQm90dG9tID0gXCI0cHhcIjtcclxuXHJcbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBzZWxmVmlzaWJsZSA9IHBhdGggPT09IFwiQmFzZW1hcHNcIiA/IHRydWUgOiAoZ3JvdXBDb25maWdzW3BhdGhdPy52aXNpYmxlICE9PSBmYWxzZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XHJcblxyXG4gICAgICAgIGNvbnN0IGhlYWRlckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLndlYmtpdFVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcclxuICAgICAgICBsZXQgdG9nZ2xlRWwgPSBudWxsO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUubGluZUhlaWdodCA9IFwiMVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcclxuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZCh0b2dnbGVFbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3Qgc3BhY2VyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChzcGFjZXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2hlY2tib3ggb3IgUmFkaW8gaW5wdXQgZWxlbWVudFxyXG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCFpc0dyb3VwIHx8IHBhdGggIT09IFwiQmFzZW1hcHNcIikge1xyXG4gICAgICAgICAgICBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcclxuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XHJcbiAgICAgICAgICAgIGlucHV0Lm5hbWUgPSBpc011bHRpU2VsZWN0ID8gKGlzR3JvdXAgPyBgZ3JvdXBfJHtwYXRofWAgOiBgbGF5ZXJfJHtpZH1gKSA6IGBwYXJlbnRfJHtwYXJlbnRQYXRofWA7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcclxuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcclxuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBub2RlLnZpc2libGUgIT09IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoaW5wdXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgVGV4dFxyXG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBuYW1lO1xyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGxhYmVsLnN0eWxlLmZvbnRXZWlnaHQgPSBcImJvbGRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcclxuXHJcbiAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChoZWFkZXJEaXYpO1xyXG5cclxuICAgICAgICAvLyBDaGlsZHJlbiBEcmF3ZXIgKGZvciBncm91cHMpXHJcbiAgICAgICAgbGV0IGNoaWxkcmVuRGl2ID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5ib3JkZXJMZWZ0ID0gXCIxcHggZGFzaGVkICNjY2NcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUubWFyZ2luTGVmdCA9IFwiNXB4XCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlbmRlciBzdWItZ3JvdXBzIGFuZCBsYXllcnMgcmVjdXJzaXZlbHlcclxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIGNoaWxkcmVuRGl2LCBkZXB0aCArIDEsIG5vZGUsIHNlbGZFZmZlY3RpdmVWaXNpYmxlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobHlyLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgbm9kZURpdi5hcHBlbmRDaGlsZChjaGlsZHJlbkRpdik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIHdoZW4gY2xpY2tpbmcgaGVhZGVyIHJvdyAoYmFja2dyb3VuZCwgZW1wdHkgc3BhY2UsIG9yIGFycm93KVxyXG4gICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ29sbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9nZ2xlRWwudGV4dENvbnRlbnQgPSAhaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChjaGlsZHJlbkRpdikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSAhaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYWJlbCBjbGljayBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImNoYW5nZVwiKSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW5wdXQgY2hhbmdlIGxpc3RlbmVyXHJcbiAgICAgICAgaWYgKGlucHV0KSB7XHJcbiAgICAgICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNDaGVja2VkID0gaW5wdXQuY2hlY2tlZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRm9yIHJhZGlvIGJ1dHRvbnMsIG9ubHkgcHJvY2VzcyB0aGUgc2VsZWN0aW9uIGV2ZW50IChpZ25vcmUgZGUtc2VsZWN0aW9uIGV2ZW50cylcclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCAmJiAhaXNDaGVja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIEZsaXBwZWQgb24gdGhlIGxpc3QgdGhpcyBzaWRlYmFyIHJlbmRlcmVkIGZyb20sIG5ldmVyIG1vZGVsLmdldChcImxheWVyc1wiKS5cclxuICAgICAgICAgICAgICAgIC8vIExheWVycyBhZGRlZCBhZnRlciB0aGUgd2lkZ2V0IGlzIGRpc3BsYXllZCBhcnJpdmUgYXMgcGF0Y2hlcyB0aGF0IHVwZGF0ZSB0aGVcclxuICAgICAgICAgICAgICAgIC8vIGZyb250ZW5kJ3MgbG9jYWwgc3RhdGUgd2l0aG91dCB0b3VjaGluZyB0aGUgdHJhaXQsIHNvIHRoZSBtb2RlbCdzIGNvcHkgaXNcclxuICAgICAgICAgICAgICAgIC8vIGZyb3plbiBhdCB3aGF0ZXZlciB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGNhcnJpZWQuIEJ1aWxkaW5nIHRoZSB1cGRhdGUgZnJvbVxyXG4gICAgICAgICAgICAgICAgLy8gaXQgZHJvcHMgZXZlcnkgbGF0ZXIgbGF5ZXI6IHRoZSB0b2dnbGUgbWF0Y2hlcyBubyBpZCwgd3JpdGVzIHRoZSBzdGFsZSBsaXN0XHJcbiAgICAgICAgICAgICAgICAvLyBiYWNrLCBhbmQgdGhlIGNoYW5nZSBoYW5kbGVyIHRoZW4gcmVzZXRzIGxvY2FsIHN0YXRlIHRvIGl0IC0tIHNvIHRoZSBib3hcclxuICAgICAgICAgICAgICAgIC8vIHJlLWNoZWNrcyBpdHNlbGYgYW5kIHRoZSBsYXllciBuZXZlciBoaWRlcy5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUaGUgZmxpcHMgbXV0YXRlIHRoZSByZW5kZXJlZCBsaXN0IGluIHBsYWNlIGFuZCByZWFjaCBQeXRob24gYXMgYSB0YXJnZXRlZFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUgKHNlbmRMYXllcldyaXRlKSwgbmV2ZXIgYnkgc2V0dGluZyB0aGUgbGF5ZXJzIHRyYWl0OiB0aGUgZnVsbFxyXG4gICAgICAgICAgICAgICAgLy8gd3JpdGUtYmFjayBzY2FsZWQgd2l0aCB0aGUgbWFwIGluc3RlYWQgb2YgdGhlIGNsaWNrLiBBdCAyNSB0cmFja3MgeCAyMDBrXHJcbiAgICAgICAgICAgICAgICAvLyB2ZXJ0aWNlcyBpdCB3YXMgYSAzNiBNQiBmcmFtZSAtLSBwYXN0IHV2aWNvcm4ncyAxNiBNQiBkZWZhdWx0IHdlYnNvY2tldFxyXG4gICAgICAgICAgICAgICAgLy8gY2FwLCBzbyB0aGUgc2VydmVyIGNsb3NlZCB0aGUgY29ubmVjdGlvbiBhbmQgdGhlIFNoaW55IHNlc3Npb24gZGllZCBvblxyXG4gICAgICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGNoZWNrYm94LiBTZXR0aW5nIHRoZSB0cmFpdCB3aXRob3V0IHNhdmluZyBpcyBqdXN0IGFzIGZhdGFsOlxyXG4gICAgICAgICAgICAgICAgLy8gaXQgc3RheXMgZGlydHkgYW5kIHRoZSBuZXh0IHNhdmVfY2hhbmdlcyAoYW55IHBhbikgZmx1c2hlcyBpdC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZsaXAgPSAobHlyLCB2aXNpYmxlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKChseXIudmlzaWJsZSAhPT0gZmFsc2UpID09PSB2aXNpYmxlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgbHlyLnZpc2libGUgPSB2aXNpYmxlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGUgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICghaXNNdWx0aVNlbGVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGlvIGJ1dHRvbiBsb2dpYzogc2V0IGFsbCBzaWJsaW5ncyB0byB2aXNpYmxlPWZhbHNlLCBhbmQgdGhpcyB0byB2aXNpYmxlPXRydWVcclxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYkdyb3VwID0gcGFyZW50Tm9kZS5jaGlsZHJlbltrZXldO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBzaWJHcm91cC5wYXRoID09PSBwYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5ncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlOiBhY3RpdmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbc2liR3JvdXAucGF0aF0gPSAhYWN0aXZlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IGZsaXAoc2liTHlyLCBzaWJMeXIuaWQgPT09IGlkKSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3BhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBseXIgPSBsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGx5cikgZmxpcChseXIsIGlzQ2hlY2tlZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCBjaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIC8vIGdyb3VwX2NvbmZpZ3Mgc3RheXMgb24gdGhlIHRyYWl0OiBpdCBpcyBhIGhhbmRmdWwgb2YgZm9sZGVyIGZsYWdzLCBhbmQgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyBzcHJlYWQgZ2l2ZXMgQmFja2JvbmUgYSBmcmVzaCByZWZlcmVuY2Ugc28gdGhlIGluLXBsYWNlIGVkaXRzIHJlZ2lzdGVyLlxyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZ3JvdXBfY29uZmlnc1wiLCB7IC4uLmdyb3VwQ29uZmlncyB9KTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0NoZWNrZWQgJiYgbWFwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYm91bmRzID0gZ2V0TGF5ZXJCb3VuZHMobm9kZSwgbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYm91bmRzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKG9uTGF5ZXJUb2dnbGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBvbkxheWVyVG9nZ2xlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQobm9kZURpdik7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVuZGVyIHRyZWUgZnJvbSByb290IG5vZGVcclxuICAgIHJlbmRlck5vZGUodHJlZSwgc2lkZWJhciwgMCwgbnVsbCwgdHJ1ZSk7XHJcbn1cclxuIiwgIi8vIFRoZSBsZWdlbmQ6IGRlcml2ZWQgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSBldmVyeXRoaW5nIGVsc2UgcmVuZGVycyBmcm9tLCB3aXRoXG4vLyBkZWNsYXJhdGl2ZSBvdmVycmlkZXMgb24gdG9wLiBEZWxpYmVyYXRlbHkgbW9kZWwtZnJlZSAtLSBwdXJlIGRhdGEgaW4sIERPTSBvdXQgLS1cbi8vIHNvIGEgcGxhaW4tSlMgY29uc3VtZXIgb2YgZGlzdC9pbmRleC5qcyBnZXRzIHRoZSB3aG9sZSBmZWF0dXJlLCBhbmQgdGhlIGFueXdpZGdldFxuLy8gZ2x1ZSBpbiBtYXAuanMgaXMgYSBmZXcgbGluZXMuIChzaWRlYmFyLmpzIHN0aWxsIHRha2VzIGBtb2RlbGAgYW5kIGlzIGZpbGVkIGZvclxuLy8gZXh0cmFjdGlvbjsgdGhpcyBtb2R1bGUgbXVzdCBuZXZlciBuZWVkIHRoYXQgdW5waWNraW5nLilcbi8vXG4vLyBUaGUgcGlwZWxpbmU6IGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykgd2Fsa3MgdGhlIGxheWVycyBpbnRvXG4vLyBlbnRyaWVzIChza2lwcGVkIGVudGlyZWx5IHdoZW4gY29uZmlnLmF1dG8gPT09IGZhbHNlKSwgYXBwbGllcyB0aGUgcGVyc2lzdGVudFxuLy8gcmVtb3ZlLW1hdGNoZXJzLCBhcHBlbmRzIHRoZSBtYW51YWwgYWRkcywgYW5kIHJldHVybnMgYSBzcGVjIHRoYXQgcmVuZGVyTGVnZW5kXG4vLyB0dXJucyBpbnRvIERPTS4gTm90aGluZyBoZXJlIGtub3dzIGFib3V0IGNvbG9ybWFwczogcmFtcC9jYXRlZ29yeS9iaW4gZW50cmllc1xuLy8gYXJyaXZlIHdpdGggdGhlaXIgY29sb3VycyBhbHJlYWR5IHJlc29sdmVkIChQeXRob24gcmVzb2x2ZXMgYXQgdGhlIGFkZF8qIGJvdW5kYXJ5LFxuLy8gbWFudWFsIGVudHJpZXMgYXQgbGVnZW5kX2FkZCksIHNvIHRoZXJlIGlzIG5vIGFuY2hvciB0YWJsZSB0byBkcmlmdC5cblxuaW1wb3J0IHsgaXNMYXllckVmZmVjdGl2ZVZpc2libGUgfSBmcm9tIFwiLi9tYXAuanNcIjtcblxuY29uc3QgR0xZUEhTID0ge1xuICAgIGNpcmNsZV9tYXJrZXJzOiBcImNpcmNsZVwiLFxuICAgIG1hcmtlcnM6IFwicGluXCIsXG4gICAgcG9seWxpbmU6IFwibGluZVwiLFxuICAgIHBvbHlnb246IFwicG9seWdvblwiLFxuICAgIGNpcmNsZTogXCJjaXJjbGVcIixcbn07XG5cbmZ1bmN0aW9uIHN3YXRjaEVudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiBcInN3YXRjaFwiLFxuICAgICAgICBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsXG4gICAgICAgIHNoYXBlOiBHTFlQSFNbbGF5ZXIudHlwZV0gfHwgXCJzcXVhcmVcIixcbiAgICAgICAgY29sb3I6IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBmaWxsQ29sb3I6IGxheWVyLmZpbGxDb2xvciB8fCBsYXllci5maWxsX2NvbG9yIHx8IGxheWVyLmNvbG9yIHx8IFwiIzMzODhmZlwiLFxuICAgICAgICBoaWRkZW4sXG4gICAgfTtcbn1cblxuLy8gQSBkYXRhLWRyaXZlbiBibG9jayByZWNvcmRlZCBhdCBhZGQgdGltZSAoe2tpbmQsIGFuY2hvcnN8aXRlbXN8ZWRnZXMrY29sb3JzLCAuLi59KVxuLy8gYmVjb21lcyB0aGUgbGF5ZXIncyBlbnRyeSBhcy1pczsgdGhlIGxheWVyIG9ubHkgY29udHJpYnV0ZXMgbGFiZWwgYW5kIHZpc2liaWxpdHkuXG5mdW5jdGlvbiBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIHtcbiAgICByZXR1cm4geyAuLi5sYXllci5sZWdlbmQsIGxhYmVsOiBsYXllci5uYW1lIHx8IFwiTGF5ZXJcIiwgaGlkZGVuIH07XG59XG5cbmZ1bmN0aW9uIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSByZXR1cm4gW107XG4gICAgY29uc3QgaGlkZGVuID0gIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgLy8gQSBjb2xsZWN0aW9uOiBvbmUgZW50cnkgcGVyIGdlb21ldHJ5IHBhcnQsIHNhbWUgbGFiZWwgYnkgZGVzaWduIC0tIHRoZVxuICAgICAgICAvLyBnbHlwaHMgYXJlIHdoYXQgdGVsbCB0aGVtIGFwYXJ0LCBtYXRjaGluZyBob3cgdGhlIHBhcnRzIHJlbmRlci5cbiAgICAgICAgcmV0dXJuIChsYXllci5sYXllcnMgfHwgW10pXG4gICAgICAgICAgICAuZmlsdGVyKHN1YiA9PiBHTFlQSFNbc3ViLnR5cGVdKVxuICAgICAgICAgICAgLm1hcChzdWIgPT4gc3ViLmxlZ2VuZFxuICAgICAgICAgICAgICAgID8gYmxvY2tFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hFbnRyeSh7IC4uLnN1YiwgbmFtZTogbGF5ZXIubmFtZSB9LCBoaWRkZW4pKTtcbiAgICB9XG4gICAgaWYgKCFHTFlQSFNbbGF5ZXIudHlwZV0pIHJldHVybiBbXTtcbiAgICBjb25zdCBlbnRyaWVzID0gW2xheWVyLmxlZ2VuZCA/IGJsb2NrRW50cnkobGF5ZXIsIGhpZGRlbikgOiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKV07XG4gICAgLy8gcmFkaXVzX2NvbCByZWNvcmRzIGEgc2l6ZSBrZXkgYmVzaWRlIHRoZSBjb2xvdXIgc3Rvcnk6IGJvdGggZW5jb2RpbmdzIG9uIHRoZVxuICAgIC8vIG1hcCBkZXNlcnZlIGJvdGggZXhwbGFuYXRpb25zIGluIHRoZSBsZWdlbmQuXG4gICAgaWYgKGxheWVyLmxlZ2VuZF9zaXplKSB7XG4gICAgICAgIGVudHJpZXMucHVzaCh7IC4uLmxheWVyLmxlZ2VuZF9zaXplLFxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogbGF5ZXIubGVnZW5kX3NpemUuZmllbGQgfHwgbGF5ZXIubmFtZSB8fCBcIlNpemVcIiwgaGlkZGVuIH0pO1xuICAgIH1cbiAgICByZXR1cm4gZW50cmllcztcbn1cblxuLy8gSWRlbnRpY2FsIGRhdGEtZHJpdmVuIHBheWxvYWRzIGNvbGxhcHNlIGludG8gb25lIHJvdy4gR3JvdXBpbmcgcG9pbnRzIGJ5IGEgY29sdW1uXG4vLyBnaXZlcyBldmVyeSBzdWItbGF5ZXIgdGhlIHNhbWUgcmFtcDsgYSByYW1wIHBlciBzdWItbGF5ZXIgaXMgbm9pc2UsIGFuZCB0aGUgZmllbGRcbi8vIG5hbWUgaXMgdGhlIGhvbmVzdCBsYWJlbCBmb3IgdGhlIHNoYXJlZCBtYXBwaW5nLiBUaGUgc3Vydml2b3Iga2VlcHMgdGhlIGZpcnN0XG4vLyBvY2N1cnJlbmNlJ3MgcG9zaXRpb24gYW5kIGhpZGVzIG9ubHkgd2hlbiBldmVyeSBjb250cmlidXRvciBpcyBoaWRkZW4uXG5mdW5jdGlvbiBwYXlsb2FkS2V5KGVudHJ5KSB7XG4gICAgLy8gSWRlbnRpdHkgZmllbGRzIHN0YXkgb3V0IG9mIHRoZSBrZXk6IHRoZSB3aG9sZSBwb2ludCBpcyB0aGF0IGVudHJpZXMgZnJvbVxuICAgIC8vIERJRkZFUkVOVCBsYXllcnMgY29sbGFwc2Ugd2hlbiB0aGVpciBtYXBwaW5nIHBheWxvYWQgaXMgdGhlIHNhbWUuXG4gICAgY29uc3QgeyBsYWJlbCwgaGlkZGVuLCBsYXllcklkLCBsYXllciwgZ3JvdXAsIC4uLnBheWxvYWQgfSA9IGVudHJ5O1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbn1cblxuZnVuY3Rpb24gZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKSB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBNYXAoKTsgICAvLyBwYXlsb2FkIGtleSAtPiBzdXJ2aXZpbmcgZW50cnlcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBncm91cC5lbnRyaWVzID0gZ3JvdXAuZW50cmllcy5maWx0ZXIoZW50cnkgPT4ge1xuICAgICAgICAgICAgaWYgKGVudHJ5LmtpbmQgPT09IFwic3dhdGNoXCIpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGF5bG9hZEtleShlbnRyeSk7XG4gICAgICAgICAgICBjb25zdCBzdXJ2aXZvciA9IHNlZW4uZ2V0KGtleSk7XG4gICAgICAgICAgICBpZiAoIXN1cnZpdm9yKSB7XG4gICAgICAgICAgICAgICAgc2Vlbi5zZXQoa2V5LCBlbnRyeSk7XG4gICAgICAgICAgICAgICAgaWYgKGVudHJ5LmZpZWxkKSBlbnRyeS5sYWJlbCA9IGVudHJ5LmZpZWxkO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3Vydml2b3IuaGlkZGVuID0gc3Vydml2b3IuaGlkZGVuICYmIGVudHJ5LmhpZGRlbjtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBncm91cHM7XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXJIaXRzKG1hdGNoZXIsIGVudHJ5LCBncm91cE5hbWUpIHtcbiAgICBpZiAoIW1hdGNoZXIpIHJldHVybiBmYWxzZTtcbiAgICBsZXQgY29uc3RyYWluZWQgPSBmYWxzZTtcbiAgICBpZiAobWF0Y2hlci5sYWJlbCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0cmFpbmVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKGVudHJ5LmxhYmVsICE9PSBtYXRjaGVyLmxhYmVsKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmdyb3VwICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZ3JvdXBOYW1lICE9PSBtYXRjaGVyLmdyb3VwKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChtYXRjaGVyLmlkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZW50cnkubGF5ZXJJZCAhPT0gbWF0Y2hlci5pZCkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gY29uc3RyYWluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHtcbiAgICBjb25zdCBjZmcgPSBjb25maWcgfHwge307XG4gICAgY29uc3QgZ3JvdXBzID0gW107XG4gICAgY29uc3QgYnlOYW1lID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGdyb3VwRm9yID0gbmFtZSA9PiB7XG4gICAgICAgIGlmICghYnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IG5hbWUsIGVudHJpZXM6IFtdIH07XG4gICAgICAgICAgICBieU5hbWUuc2V0KG5hbWUsIGdyb3VwKTtcbiAgICAgICAgICAgIGdyb3Vwcy5wdXNoKGdyb3VwKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYnlOYW1lLmdldChuYW1lKTtcbiAgICB9O1xuXG4gICAgaWYgKGNmZy5hdXRvICE9PSBmYWxzZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycyB8fCBbXSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncyB8fCB7fSkpIHtcbiAgICAgICAgICAgICAgICBlbnRyeS5sYXllcklkID0gbGF5ZXIuaWQ7XG4gICAgICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgICBncm91cEZvcihsYXllci5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiKS5lbnRyaWVzLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGRlZHVwZURhdGFFbnRyaWVzKGdyb3Vwcyk7XG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzdXBwcmVzc2lvbjogbWF0Y2hlcnMgb3V0bGl2ZSBldmVyeSByZS1kZXJpdmF0aW9uLCB3aGljaCBpcyB0aGVcbiAgICAvLyBkaWZmZXJlbmNlIGZyb20gYSByZWdpc3RyeSByZW1vdmUgdGhhdCB0aGUgbmV4dCBhZGQgd291bGQganVzdCByZXBvcHVsYXRlLlxuICAgIGNvbnN0IHJlbW92ZXMgPSBjZmcucmVtb3ZlIHx8IFtdO1xuICAgIGlmIChyZW1vdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICBlbnRyeSA9PiAhcmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGdyb3VwLm5hbWUpKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYW51YWwgZW50cmllczogdGhlIHVzZXIncyBvd24gY2xhaW1zLiBzY29wZSBuZXZlciBkcm9wcyB0aGVtOyBhIGBsYXllcmBcbiAgICAvLyBiaW5kaW5nIG1ha2VzIG9uZSBmb2xsb3cgYSBsaXZlIGxheWVyJ3MgdmlzaWJpbGl0eSAoYW5kIHZhbmlzaCB3aXRoIGl0IHVuZGVyXG4gICAgLy8gc2NvcGUgXCJ2aXNpYmxlXCIpLCBmb3Igd2hlbiBhIG1hbnVhbCByb3cgaXMgcmVhbGx5IGEgcmVsYWJlbGxpbmcuXG4gICAgZm9yIChjb25zdCBhZGRlZCBvZiBjZmcuYWRkIHx8IFtdKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0geyBoaWRkZW46IGZhbHNlLCAuLi5hZGRlZCB9O1xuICAgICAgICBpZiAoZW50cnkubGF5ZXIgIT0gbnVsbCkge1xuICAgICAgICAgICAgY29uc3QgYm91bmQgPSAobGF5ZXJzIHx8IFtdKS5maW5kKFxuICAgICAgICAgICAgICAgIGwgPT4gbC5pZCA9PT0gZW50cnkubGF5ZXIgfHwgbC5uYW1lID09PSBlbnRyeS5sYXllcik7XG4gICAgICAgICAgICBlbnRyeS5oaWRkZW4gPSAhYm91bmQgfHwgIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGJvdW5kLCBncm91cENvbmZpZ3MgfHwge30pO1xuICAgICAgICAgICAgaWYgKGNmZy5zY29wZSA9PT0gXCJ2aXNpYmxlXCIgJiYgZW50cnkuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVtb3Zlcy5zb21lKG0gPT4gbWF0Y2hlckhpdHMobSwgZW50cnksIGVudHJ5Lmdyb3VwIHx8IFwiXCIpKSkgY29udGludWU7XG4gICAgICAgIGdyb3VwRm9yKGVudHJ5Lmdyb3VwIHx8IFwiXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XG4gICAgfVxuXG4gICAgY29uc3QgcG9wdWxhdGVkID0gZ3JvdXBzLmZpbHRlcihnID0+IGcuZW50cmllcy5sZW5ndGggPiAwKTtcbiAgICByZXR1cm4geyB0aXRsZTogY2ZnLnRpdGxlIHx8IFwiTGVnZW5kXCIsIGdyb3VwczogcG9wdWxhdGVkIH07XG59XG5cbi8vIC0tLSByZW5kZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBET00gYnVpbHQgd2l0aCBjcmVhdGVFbGVtZW50L3RleHRDb250ZW50IHRocm91Z2hvdXQ6IGxhYmVscyBhbmQgY2F0ZWdvcnkgdmFsdWVzIGNvbWVcbi8vIGZyb20gdXNlciBkYXRhIGFuZCBtdXN0IG5ldmVyIGJlIHBhcnNlZCBhcyBIVE1MLlxuXG5mdW5jdGlvbiBkaXYoc3R5bGVzLCB0ZXh0KSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlcyk7XG4gICAgaWYgKHRleHQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gZ2x5cGgoZW50cnkpIHtcbiAgICBpZiAoZW50cnkuc2hhcGUgPT09IFwibGluZVwiKSB7XG4gICAgICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIyMHB4XCIsIGhlaWdodDogXCI0cHhcIiwgYmFja2dyb3VuZDogZW50cnkuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIgfSk7XG4gICAgfVxuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJwaW5cIikge1xuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBlbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XG4gICAgICAgIGVsLnN0eWxlLmZsZXggPSBcIm5vbmVcIjtcbiAgICAgICAgY29uc3Qgc3ZnID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJzdmdcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBcIjEyXCIpO1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMTRcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIsIFwiMCAwIDI0IDI4XCIpO1xuICAgICAgICBjb25zdCBwYXRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgXCJwYXRoXCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImRcIixcbiAgICAgICAgICAgIFwiTTEyIDBDNS40IDAgMCA1LjQgMCAxMmMwIDkgMTIgMTYgMTIgMTZzMTItNyAxMi0xNkMyNCA1LjQgMTguNiAwIDEyIDB6XCIpO1xuICAgICAgICBwYXRoLnNldEF0dHJpYnV0ZShcImZpbGxcIiwgZW50cnkuY29sb3IpO1xuICAgICAgICBzdmcuYXBwZW5kQ2hpbGQocGF0aCk7XG4gICAgICAgIGVsLmFwcGVuZENoaWxkKHN2Zyk7XG4gICAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgLy8gY2lyY2xlIC8gcG9seWdvbiAvIHNxdWFyZTogZmlsbCBpbnNpZGUgYSBib3JkZXIsIHdoaWNoIGlzIGhvdyBhcmVhcyBkcmF3LlxuICAgIGNvbnN0IHJhZGl1cyA9IGVudHJ5LnNoYXBlID09PSBcImNpcmNsZVwiID8gXCI1MCVcIlxuICAgICAgICA6IGVudHJ5LnNoYXBlID09PSBcInBvbHlnb25cIiA/IFwiMnB4XCIgOiBcIjBcIjtcbiAgICByZXR1cm4gZGl2KHsgd2lkdGg6IFwiMTJweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5maWxsQ29sb3IsXG4gICAgICAgICAgICAgICAgIGJvcmRlcjogYDJweCBzb2xpZCAke2VudHJ5LmNvbG9yfWAsIGJvcmRlclJhZGl1czogcmFkaXVzLFxuICAgICAgICAgICAgICAgICBtYXJnaW5SaWdodDogXCI2cHhcIiwgZmxleDogXCJub25lXCIsIGJveFNpemluZzogXCJib3JkZXItYm94XCIgfSk7XG59XG5cbmZ1bmN0aW9uIHJhbXBSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBzdG9wcyA9IChlbnRyeS5hbmNob3JzIHx8IFtdKS5tYXAoKGNvbG9yLCBpLCBhbGwpID0+XG4gICAgICAgIGAke2NvbG9yfSAke2FsbC5sZW5ndGggPiAxID8gKGkgLyAoYWxsLmxlbmd0aCAtIDEpKSAqIDEwMCA6IDB9JWApO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe1xuICAgICAgICB3aWR0aDogXCIxMjBweFwiLCBoZWlnaHQ6IFwiMTJweFwiLCBib3JkZXJSYWRpdXM6IFwiMnB4XCIsXG4gICAgICAgIGJhY2tncm91bmRJbWFnZTogYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWAsXG4gICAgfSkpO1xuICAgIGNvbnN0IGVuZHMgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwganVzdGlmeUNvbnRlbnQ6IFwic3BhY2UtYmV0d2VlblwiLCB3aWR0aDogXCIxMjBweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICBmb250U2l6ZTogXCIxMXB4XCIsIGNvbG9yOiBcIiM1NTVcIiB9KTtcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtaW4pKSk7XG4gICAgZW5kcy5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhlbnRyeS52bWF4KSkpO1xuICAgIHJvdy5hcHBlbmRDaGlsZChlbmRzKTtcbiAgICByZXR1cm4gcm93O1xufVxuXG5jb25zdCBNQVhfQ0FURUdPUllfUk9XUyA9IDEyO1xuXG5mdW5jdGlvbiBjYXRlZ29yaWVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgbWFyZ2luVG9wOiBcIjVweFwiIH0pO1xuICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoe30sIGVudHJ5LmxhYmVsKSk7XG4gICAgY29uc3QgaXRlbXMgPSBlbnRyeS5pdGVtcyB8fCBbXTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMuc2xpY2UoMCwgTUFYX0NBVEVHT1JZX1JPV1MpKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvcjogaXRlbS5jb2xvciwgZmlsbENvbG9yOiBpdGVtLmNvbG9yIH0pKTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChkaXYoe30sIFN0cmluZyhpdGVtLnZhbHVlKSkpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XG4gICAgfVxuICAgIGlmIChpdGVtcy5sZW5ndGggPiBNQVhfQ0FURUdPUllfUk9XUykge1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luTGVmdDogXCI4cHhcIiwgbWFyZ2luVG9wOiBcIjNweFwiLCBjb2xvcjogXCIjNTU1XCIgfSxcbiAgICAgICAgICAgIGArICR7aXRlbXMubGVuZ3RoIC0gTUFYX0NBVEVHT1JZX1JPV1N9IG1vcmVgKSk7XG4gICAgfVxuICAgIHJldHVybiByb3c7XG59XG5cbmZ1bmN0aW9uIGJpbnNSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBlZGdlcyA9IGVudHJ5LmVkZ2VzIHx8IFtdO1xuICAgIGNvbnN0IGNvbG9ycyA9IGVudHJ5LmNvbG9ycyB8fCBbXTtcbiAgICBjb25zdCBsYWJlbEZvciA9IGkgPT4gaSA9PT0gMCA/IGA8ICR7ZWRnZXNbMF19YFxuICAgICAgICA6IGkgPT09IGVkZ2VzLmxlbmd0aCA/IGBcdTIyNjUgJHtlZGdlc1tlZGdlcy5sZW5ndGggLSAxXX1gXG4gICAgICAgIDogYCR7ZWRnZXNbaSAtIDFdfSBcdTIwMTMgJHtlZGdlc1tpXX1gO1xuICAgIGNvbG9ycy5mb3JFYWNoKChjb2xvciwgaSkgPT4ge1xuICAgICAgICBjb25zdCBsaW5lID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCIzcHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmdpbkxlZnQ6IFwiOHB4XCIgfSk7XG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZ2x5cGgoeyBzaGFwZTogXCJzcXVhcmVcIiwgY29sb3IsIGZpbGxDb2xvcjogY29sb3IgfSkpO1xuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgbGFiZWxGb3IoaSkpKTtcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGxpbmUpO1xuICAgIH0pO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIEEgc2l6ZSBrZXkgaXMgYSBzdGF0ZW1lbnQsIG5vdCBhIGRyYXdpbmc6IFwiXHUyNUNGIHNpemUgXHUyMjFEIGZpZWxkIChtaW4gXHUyMDEzIG1heClcIi4gVGhlIGdseXBoXG4vLyBpcyBmaXhlZCBhbmQgbm90aGluZyBpbiB0aGUgcm93IGRlcml2ZXMgZnJvbSByYWRpdXNfcmFuZ2Ugb3IgdGhlIGRhdGEncyBzcHJlYWQgLS1cbi8vIGxlZ2VuZCBDU1MgcGl4ZWxzIGFyZSBub3QgbWFwIHBpeGVscyBhdCBhbnkgem9vbSwgc28gZHJhd24gc2FtcGxlIGNpcmNsZXMgd291bGRcbi8vIGFzc2VydCBhIHByZWNpc2lvbiB0aGF0IGRvZXMgbm90IGV4aXN0LiBUaGUgcm93IG5hbWVzIHRoZSBlbmNvZGluZyBhbmQgaXRzIGRvbWFpbi5cbmZ1bmN0aW9uIHNpemVzUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHsgbWFyZ2luUmlnaHQ6IFwiNnB4XCIsIGZsZXg6IFwibm9uZVwiLCBjb2xvcjogXCIjNjY2XCIgfSwgXCJcdTI1Q0ZcIikpO1xuICAgIGNvbnN0IHJhbmdlID0gZW50cnkudm1pbiAhPSBudWxsICYmIGVudHJ5LnZtYXggIT0gbnVsbFxuICAgICAgICA/IGAgKCR7ZW50cnkudm1pbn0gXHUyMDEzICR7ZW50cnkudm1heH0pYCA6IFwiXCI7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgYHNpemUgXHUyMjFEICR7ZW50cnkuZmllbGQgfHwgZW50cnkubGFiZWx9JHtyYW5nZX1gKSk7XG4gICAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gc3dhdGNoUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZ2x5cGgoZW50cnkpKTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIHJldHVybiByb3c7XG59XG5cbi8vIENvbGxhcHNlIHN0YXRlLCBwZXIgY29udGFpbmVyIHJhdGhlciB0aGFuIG1vZHVsZSBzY29wZTogdGhlIHNpZGViYXIga2V5cyBpdHNcbi8vIGNvbGxhcHNlZFBhdGhzIGF0IG1vZHVsZSBsZXZlbCBhbmQgdHdvIG1hcHMgb24gb25lIHBhZ2Ugc2hhcmUgaXQgLS0gYSBmaWxlZCBidWdcbi8vIHRoaXMgZGVsaWJlcmF0ZWx5IGRvZXMgbm90IGluaGVyaXQuIEtleWVkIGJ5IGdyb3VwIG5hbWUsIHN1cnZpdmluZyB0aGUgZnVsbFxuLy8gcmUtcmVuZGVyIGV2ZXJ5IHN5bmMgcGVyZm9ybXMuXG5jb25zdCBjb2xsYXBzZWRCeUNvbnRhaW5lciA9IG5ldyBXZWFrTWFwKCk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBjb250YWluZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICBjb25zdCBkaW1IaWRkZW4gPSBvcHRpb25zLmRpbUhpZGRlbiAhPT0gZmFsc2U7XG4gICAgbGV0IGNvbGxhcHNlZCA9IGNvbGxhcHNlZEJ5Q29udGFpbmVyLmdldChjb250YWluZXIpO1xuICAgIGlmICghY29sbGFwc2VkKSB7XG4gICAgICAgIGNvbGxhcHNlZCA9IG5ldyBTZXQoKTtcbiAgICAgICAgY29sbGFwc2VkQnlDb250YWluZXIuc2V0KGNvbnRhaW5lciwgY29sbGFwc2VkKTtcbiAgICB9XG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7XG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxuICAgICAgICBwYWRkaW5nQm90dG9tOiBcIjRweFwiLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIsXG4gICAgfSwgc3BlYy50aXRsZSkpO1xuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBzcGVjLmdyb3Vwcykge1xuICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGdyb3VwLm5hbWUgJiYgY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKTtcbiAgICAgICAgaWYgKGdyb3VwLm5hbWUpIHtcbiAgICAgICAgICAgIC8vIFRoZSBzaWRlYmFyJ3MgYWZmb3JkYW5jZSBleGFjdGx5OiBhbiBhcnJvdyB0aGF0IGZvbGRzIHRoZSBzZWN0aW9uLlxuICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gZGl2KHsgZm9udFdlaWdodDogXCJib2xkXCIsIG1hcmdpblRvcDogXCI2cHhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsIHVzZXJTZWxlY3Q6IFwibm9uZVwiIH0pO1xuICAgICAgICAgICAgaGVhZGVyLnRleHRDb250ZW50ID0gYCR7aXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIn0gJHtncm91cC5uYW1lfWA7XG4gICAgICAgICAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY29sbGFwc2VkLmhhcyhncm91cC5uYW1lKSkgY29sbGFwc2VkLmRlbGV0ZShncm91cC5uYW1lKTtcbiAgICAgICAgICAgICAgICBlbHNlIGNvbGxhcHNlZC5hZGQoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGNvbnRhaW5lciwgc3BlYywgb3B0aW9ucyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChoZWFkZXIpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChpc0NvbGxhcHNlZCkgY29udGludWU7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZ3JvdXAuZW50cmllcykge1xuICAgICAgICAgICAgY29uc3Qgcm93ID0gZW50cnkua2luZCA9PT0gXCJyYW1wXCIgPyByYW1wUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJiaW5zXCIgPyBiaW5zUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJzaXplc1wiID8gc2l6ZXNSb3coZW50cnkpXG4gICAgICAgICAgICAgICAgOiBzd2F0Y2hSb3coZW50cnkpO1xuICAgICAgICAgICAgLy8gRGltbWVkLCBub3QgZHJvcHBlZDogdW5kZXIgc2NvcGUgXCJhbGxcIiB0aGUgbGVnZW5kIGlzIHRoZSBtYXAncyB3aG9sZVxuICAgICAgICAgICAgLy8gdm9jYWJ1bGFyeSwgYW5kIHRoZSBkaW0gaXMgd2hhdCBzdGlsbCB0ZWxscyB0aGUgY3VycmVudCBzY3JlZW4gc3RhdGUuXG4gICAgICAgICAgICBpZiAoZW50cnkuaGlkZGVuICYmIGRpbUhpZGRlbikgcm93LnN0eWxlLm9wYWNpdHkgPSBcIjAuNVwiO1xuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHJvdyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbn1cbiIsICJleHBvcnQgY29uc3QgcGluU2hhZGVyID0gYFxyXG5wcmVjaXNpb24gbWVkaXVtcCBmbG9hdDtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxudm9pZCBtYWluKCkge1xyXG4gICAgLy8gdXYgcmFuZ2VzIGZyb20gLTAuNSB0byAwLjUuIFRoZSBjZW50ZXIgKDAuMCwgMC4wKSBpcyB0aGUgZXhhY3QgY29vcmRpbmF0ZS5cclxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xyXG5cclxuICAgIC8vIFBpbiBoZWFkIGNpcmNsZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4xNlxyXG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XHJcbiAgICBcclxuICAgIC8vIFBpbiBib2R5IHRyaWFuZ2xlIHBvaW50aW5nIGV4YWN0bHkgdG8gKDAuMCwgMC4wKVxyXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XHJcbiAgICBmbG9hdCBkX3BpbiA9IG1pbihkX2NpcmNsZSwgZF90cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxyXG4gICAgZmxvYXQgZF9ob2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjA2O1xyXG5cclxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxyXG4gICAgdmVjMiBzaGFkb3dVdiA9IHV2IC0gdmVjMigwLjAsIDAuMDQpO1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfY2lyY2xlID0gbGVuZ3RoKHNoYWRvd1V2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9zaGFkb3cgPSBtaW4oZF9zaGFkb3dfY2lyY2xlLCBkX3NoYWRvd190cmlhbmdsZSk7XHJcblxyXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXHJcbiAgICBmbG9hdCBtYXNrX3BpbiA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9waW4pO1xyXG4gICAgZmxvYXQgbWFza19ob2xlID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX2hvbGUpO1xyXG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xyXG4gICAgZmxvYXQgbWFza19zaGFkb3cgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAzLCAwLjA0LCBkX3NoYWRvdyk7XHJcblxyXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xyXG4gICAgdmVjNCBzaGFkb3dDb2xvciA9IHZlYzQoMC4wLCAwLjAsIDAuMCwgMC4yNSkgKiBtYXNrX3NoYWRvdztcclxuICAgIHZlYzQgYm9keUNvbG9yID0gbWl4KHZlYzQoMC4wLCAwLjAsIDAuMCwgMC44NSksIHZlYzQoX2NvbG9yLnJnYiwgX2NvbG9yLmEpLCBtYXNrX2JvcmRlcik7XHJcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xyXG5cclxuICAgIGdsX0ZyYWdDb2xvciA9IG1peChzaGFkb3dDb2xvciwgd2l0aEhvbGUsIG1hc2tfcGluKTtcclxufWA7XHJcbiIsICIvLyBUaGUgc2hhcmVkIHRpbWUgc2xpZGVyOiBvbmUgY29udHJvbCBzZXJ2aW5nIGV2ZXJ5IHRpbWUgbGF5ZXIgb24gdGhlIG1hcC5cbi8vXG4vLyBUaWNrcyBhcmUgZ2VuZXJhdGVkIGZyb20gYW4gSVNPODYwMSBwZXJpb2QgcmF0aGVyIHRoYW4gdGFrZW4gZnJvbSB0aGUgb2JzZXJ2ZWRcbi8vIHRpbWVzdGFtcHMsIGRlbGliZXJhdGVseTogYSBwZXJpb2QgaW4gd2hpY2ggbm90aGluZyBoYXBwZW5lZCBzdGlsbCBnZXRzIGl0cyB0aWNrLCBzbyBhblxuLy8gZW1wdHkgbWFwIGF0IDAzOjAwIHJlYWRzIGFzIGFic2VuY2UgcmF0aGVyIHRoYW4gdGhlIHNsaWRlciBza2lwcGluZyB0aGUgcXVpZXQgaG91cnMuXG4vL1xuLy8gVGhpcyBpcyBzd2lmdG1hcCdzIG93biBjb250cm9sIHJhdGhlciB0aGFuIExlYWZsZXQuVGltZURpbWVuc2lvbidzLiBUaGF0IGxpYnJhcnkgc3BsaXRzXG4vLyBpbnRvIGEgdGltZSBtb2RlbCwgYSBjb250cm9sLCBhbmQgcGVyLWxheWVyIGFkYXB0ZXJzIHRoYXQgcmUtcmVuZGVyIEdlb0pTT04gcGVyIHRpY2sgLS1cbi8vIHRoZSBhZGFwdGVycyBhcmUgdW51c2FibGUgYWdhaW5zdCBXZWJHTCBsYXllcnMsIHRoZSBtb2RlbCBpcyBhIGZldyBkb3plbiBsaW5lcywgYW5kIHRoZVxuLy8gY29udHJvbCBhbG9uZSB3YXMgbm90IHdvcnRoIGEgdmVuZG9yZWQgZGVwZW5kZW5jeSBvbiBhIG5ldHdvcmsgd2hlcmUgZXZlcnkgZmlsZSBpc1xuLy8gY2FycmllZCBhY3Jvc3MgYnkgaGFuZC5cblxuLy8gLS0tIElTTzg2MDEgcGVyaW9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pcnJvcnMgaXNfdmFsaWRfcGVyaW9kKCkgaW4gc3dpZnRtYXAvbGF5ZXJzL190aW1lLnB5OyB0aGUgZ3JhbW1hciBtdXN0IG5vdCBkcmlmdC5cbmNvbnN0IFBFUklPRF9SRSA9XG4gICAgL15QKD8hJCkoPzooXFxkKylZKT8oPzooXFxkKylNKT8oPzooXFxkKylXKT8oPzooXFxkKylEKT8oPzpUKD8hJCkoPzooXFxkKylIKT8oPzooXFxkKylNKT8oPzooXFxkKyg/OlxcLlxcZCspPylTKT8pPyQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQZXJpb2QodGV4dCkge1xuICAgIGNvbnN0IG0gPSBQRVJJT0RfUkUuZXhlYyh0ZXh0IHx8IFwiXCIpO1xuICAgIGlmICghbSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgeWVhcnM6ICsobVsxXSB8fCAwKSwgbW9udGhzOiArKG1bMl0gfHwgMCksIHdlZWtzOiArKG1bM10gfHwgMCksIGRheXM6ICsobVs0XSB8fCAwKSxcbiAgICAgICAgaG91cnM6ICsobVs1XSB8fCAwKSwgbWludXRlczogKyhtWzZdIHx8IDApLCBzZWNvbmRzOiArKG1bN10gfHwgMCksXG4gICAgfTtcbn1cblxuLy8gWWVhcnMgYW5kIG1vbnRocyBtb3ZlIHRocm91Z2ggdGhlIFVUQyBjYWxlbmRhciAtLSBQMU0gZnJvbSBKYW4gMzEgbGFuZHMgd2hlcmUgRGF0ZVxuLy8gYXJpdGhtZXRpYyBwdXRzIGl0LCBub3QgYSBmaXhlZCAzMCBkYXlzIC0tIHdoaWxlIHRoZSByZXN0IGlzIHBsYWluIG1pbGxpc2Vjb25kcy5cbmV4cG9ydCBmdW5jdGlvbiBhZGRQZXJpb2QobXMsIHAsIHNpZ24gPSAxKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKG1zKTtcbiAgICBpZiAocC55ZWFycykgZC5zZXRVVENGdWxsWWVhcihkLmdldFVUQ0Z1bGxZZWFyKCkgKyBzaWduICogcC55ZWFycyk7XG4gICAgaWYgKHAubW9udGhzKSBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIHNpZ24gKiBwLm1vbnRocyk7XG4gICAgcmV0dXJuIGQuZ2V0VGltZSgpICsgc2lnbiAqICgoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMFxuICAgICAgICArIHAuaG91cnMgKiAzNjAwICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMCk7XG59XG5cbi8vIFRoZSBzbGlkZXIncyBwb3NpdGlvbnM6IGZyb20gdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uIHRvIHRoZSBmaXJzdCB0aWNrIGF0IG9yIHBhc3QgdGhlXG4vLyBmaW5hbCBvbmUsIG9uZSBwZXIgcGVyaW9kLiBDYXBwZWQgYmVjYXVzZSBhIG1pc3R5cGVkIFBUMVMgb3ZlciBhIHllYXIgb2YgZGF0YVxuLy8gd291bGQgb3RoZXJ3aXNlIGhhbmcgdGhlIHRhYiBidWlsZGluZyBhbiBhcnJheSBvZiBtaWxsaW9ucy5cbmV4cG9ydCBjb25zdCBNQVhfVElDS1MgPSA1MDAwO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUaWNrcyhzdGFydE1zLCBlbmRNcywgcCkge1xuICAgIC8vIFRoZSBmaXJzdCB0aWNrIHNpdHMgQVQgdGhlIGVhcmxpZXN0IG9ic2VydmF0aW9uLCBub3Qgb25lIHBlcmlvZCBhZnRlciBpdDogd2luZG93c1xuICAgIC8vIGFyZSBoYWxmLW9wZW4gKHN0YXJ0LCBlbmRdLCBzbyBhIGZpcnN0IHRpY2sgYXQgc3RhcnQrUCB3b3VsZCBleGNsdWRlIHRoZSBlYXJsaWVzdFxuICAgIC8vIHBvaW50IGZyb20gaXRzIG93biB3aW5kb3cgYW5kIGl0IHdvdWxkIG5ldmVyIGRpc3BsYXkgYXQgYW55IHRpY2suXG4gICAgY29uc3QgdGlja3MgPSBbc3RhcnRNc107XG4gICAgbGV0IHQgPSBzdGFydE1zO1xuICAgIGlmICh0ID49IGVuZE1zKSByZXR1cm4gdGlja3M7XG4gICAgd2hpbGUgKHRpY2tzLmxlbmd0aCA8IE1BWF9USUNLUykge1xuICAgICAgICB0ID0gYWRkUGVyaW9kKHQsIHApO1xuICAgICAgICB0aWNrcy5wdXNoKHQpO1xuICAgICAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oYFtTd2lmdE1hcF0gdGltZSBzbGlkZXIgY2FwcGVkIGF0ICR7TUFYX1RJQ0tTfSB0aWNrczsgYCArXG4gICAgICAgIGB0aGUgcGVyaW9kIGlzIHRvbyBmaW5lIGZvciB0aGUgZGF0YSdzIGV4dGVudC4gVXNlIGEgY29hcnNlciBwZXJpb2QuYCk7XG4gICAgcmV0dXJuIHRpY2tzO1xufVxuXG4vLyAtLS0gd2luZG93cyBhbmQgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBpbnRlcnZhbCBzaG93biBhdCBvbmUgdGljay4gZHVyYXRpb24gXCJwZXJpb2RcIiBpcyB0aGUgdGljaydzIG93biBwZXJpb2QsIHNvIGFic2VuY2Vcbi8vIGlzIHZpc2libGU7IG51bGwgYWNjdW11bGF0ZXMgZXZlcnl0aGluZyBzbyBmYXI7IGFuIElTTyBzdHJpbmcgdHJhaWxzIGEgZml4ZWQgd2luZG93LlxuZXhwb3J0IGZ1bmN0aW9uIHdpbmRvd0Zvcih0aWNrLCBkdXJhdGlvblNwZWMsIHBlcmlvZCkge1xuICAgIGlmIChkdXJhdGlvblNwZWMgPT09IG51bGwgfHwgZHVyYXRpb25TcGVjID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgfVxuICAgIGNvbnN0IHAgPSBkdXJhdGlvblNwZWMgPT09IFwicGVyaW9kXCIgPyBwZXJpb2QgOiBwYXJzZVBlcmlvZChkdXJhdGlvblNwZWMpO1xuICAgIGlmICghcCkgcmV0dXJuIHsgc3RhcnQ6IC1JbmZpbml0eSwgZW5kOiB0aWNrIH07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGFkZFBlcmlvZCh0aWNrLCBwLCAtMSksIGVuZDogdGljayB9O1xufVxuXG4vLyBIYWxmLW9wZW4gKHN0YXJ0LCBlbmRdOiBhIGZlYXR1cmUgc3RhbXBlZCBleGFjdGx5IG9uIGEgdGljayBib3VuZGFyeSBiZWxvbmdzIHRvIHRoZVxuLy8gcGVyaW9kIHRoYXQgZW5kcyB0aGVyZSwgYW5kIG5ldmVyIHRvIHR3byBuZWlnaGJvdXJpbmcgdGlja3MgYXQgb25jZS4gTmFOIHRpbWVzIG1hcmtcbi8vIGZlYXR1cmVzIHRoYXQgY2FycmllZCBubyByZWFkYWJsZSB0aW1lOyB0aGV5IHN0YXkgdmlzaWJsZSByYXRoZXIgdGhhbiB2YW5pc2hpbmcuXG5leHBvcnQgZnVuY3Rpb24gZmVhdHVyZUluV2luZG93KHN0YXJ0TXMsIGVuZE1zLCB3aW4pIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0TXMpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZW5kTXMgPiB3aW4uc3RhcnQgJiYgc3RhcnRNcyA8PSB3aW4uZW5kO1xufVxuXG4vLyBUaW1lcyB0cmF2ZWwgYXMgYSBGbG9hdDY0QXJyYXkgb2YgaW50ZXJsZWF2ZWQgW3N0YXJ0LCBlbmRdIHBhaXJzIGluIHRoZSBidWZmZXIgbWFwLFxuLy8gdW5kZXIgXCI8bGF5ZXIgaWQ+Ojp0aW1lc1wiIC0tIHRoZSBzYW1lIHRyYW5zcG9ydCBjb29yZGluYXRlcyB1c2UuXG5leHBvcnQgZnVuY3Rpb24gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIHtcbiAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojp0aW1lc2BdO1xuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShyYXcuYnVmZmVyIHx8IHJhdywgcmF3LmJ5dGVPZmZzZXQgfHwgMCxcbiAgICAgICAgKHJhdy5ieXRlTGVuZ3RoIHx8IHJhdy5sZW5ndGgpIC8gOCk7XG59XG5cbi8vIFdoYXQgcmVuZGVyaW5nIHRocmVhZHMgdGhyb3VnaDogdGhlIGN1cnJlbnQgdGljayBwbHVzIHRoZSBzaGFyZWQgcGVyaW9kLCBvciBudWxsIHdoZW5cbi8vIG5vIHNsaWRlciBpcyBhY3RpdmUuIEVhY2ggbGF5ZXIgZGVyaXZlcyBpdHMgb3duIHdpbmRvdyBmcm9tIHRoZXNlLCBzaW5jZSBkdXJhdGlvbiBpc1xuLy8gcGVyIGxheWVyIHdoaWxlIHRoZSB0aWNrIGlzIHNoYXJlZC5cbi8vXG4vLyBXaGV0aGVyIGEgd2hvbGUgbGF5ZXIgc2hvd3MgYXQgdGhlIGN1cnJlbnQgdGljay4gTGluZXMsIHBvbHlnb25zIGFuZCBjaXJjbGVzIGFyZSBvbmVcbi8vIGdlb21ldHJ5IHBlciBsYXllciwgc28gdGhleSBhcmUgaW4gb3Igb3V0IGFzIGEgdW5pdDsgYSBsYXllciB3aXRoIG5vIHRpbWUgbWV0YWRhdGEgaXNcbi8vIG5vdCB0aGUgc2xpZGVyJ3MgdG8gaGlkZS5cbi8vIFRoZSBkdXJhdGlvbiBhIGxheWVyIHNob3dzIHJpZ2h0IG5vdy4gQSB3aW5kb3cgZHJhZ2dlZCBvdXQgb24gdGhlIGJhciBpcyBhIHVzZXJcbi8vIGdlc3R1cmUgYW5kIG91dHJhbmtzIGV2ZXJ5IGxheWVyJ3MgY29uZmlndXJlZCBkdXJhdGlvbiB3aGlsZSBpdCBpcyBhY3RpdmUgLS0gd2hlbiB0aGVcbi8vIHVzZXIgZ3JhYnMgdGhlIGJhciwgdGhlIGJhciB0ZWxscyB0aGUgdHJ1dGggZm9yIGV2ZXJ5dGhpbmcuIFNuYXBwaW5nIHRoZSBoYW5kbGUgYmFja1xuLy8gb250byB0aGUgdGh1bWIgY2xlYXJzIHRoZSBvdmVycmlkZSBhbmQgbGF5ZXJzIHJldHVybiB0byB0aGVpciBvd24gc2V0dGluZ3MuXG5leHBvcnQgZnVuY3Rpb24gZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSkge1xuICAgIHJldHVybiB0aW1lU3RhdGUud2luZG93IHx8IChsYXllci50aW1lICYmIGxheWVyLnRpbWUuZHVyYXRpb24pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGF5ZXJJbldpbmRvdyhsYXllciwgYnVmZmVycywgdGltZVN0YXRlKSB7XG4gICAgaWYgKCFsYXllci50aW1lIHx8ICF0aW1lU3RhdGUpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgIGlmICghdGltZXMgfHwgdGltZXMubGVuZ3RoIDwgMikgcmV0dXJuIHRydWU7XG4gICAgY29uc3Qgd2luID0gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZCk7XG4gICAgLy8gQSBwZXItdmVydGV4LXRpbWVkIGxpbmUgaG9sZHMgbWFueSBwYWlyczsgb24gdGhpcyB3aG9sZS1sYXllciBwYXRoIGl0IHNob3dzXG4gICAgLy8gd2hpbGUgQU5ZIG9mIHRoZW0gaXMgaW4gdGhlIHdpbmRvdyAtLSB0aGUgR1BVIHBhdGggaXMgd2hhdCB0cmltcyBwZXIgc2VnbWVudC5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuLy8gVGhlIGV4dGVudCBvZiBldmVyeSB0aW1lIGxheWVyJ3Mgb2JzZXJ2YXRpb25zLCBOYU4tYmxpbmQuIEZlZWRzIHRpY2sgZ2VuZXJhdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0VGltZUV4dGVudChsYXllcnMsIGJ1ZmZlcnMpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHksIG1heCA9IC1JbmZpbml0eTtcbiAgICBjb25zdCB2aXNpdCA9IChsaXN0KSA9PiBsaXN0LmZvckVhY2gobGF5ZXIgPT4ge1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSByZXR1cm4gdmlzaXQobGF5ZXIubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgaWYgKCFsYXllci50aW1lKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xuICAgICAgICBpZiAoIXRpbWVzKSByZXR1cm47XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pKSBjb250aW51ZTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpXSA8IG1pbikgbWluID0gdGltZXNbaV07XG4gICAgICAgICAgICBpZiAodGltZXNbaSArIDFdID4gbWF4KSBtYXggPSB0aW1lc1tpICsgMV07XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIHJldHVybiBtaW4gPT09IEluZmluaXR5ID8gbnVsbCA6IHsgbWluLCBtYXggfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1RpbWVMYXllcnMobGF5ZXJzKSB7XG4gICAgcmV0dXJuIGxheWVycy5zb21lKGwgPT4gbC50eXBlID09PSBcImdyb3VwXCJcbiAgICAgICAgPyBoYXNUaW1lTGF5ZXJzKGwubGF5ZXJzIHx8IFtdKVxuICAgICAgICA6IEJvb2xlYW4obC50aW1lKSk7XG59XG5cbi8vIE9uZSBwbGF5YmFjayBzdGVwOiB0aGUgbmV4dCBpbmRleCBhbmQgd2hldGhlciBwbGF5YmFjayBzdXJ2aXZlcyBpdC4gUHVyZSBzbyB0aGUgbG9vcFxuLy8gc2VtYW50aWNzIGFyZSB0ZXN0YWJsZSB3aXRob3V0IGEgdGltZXIgLS0gbG9vcGluZyB3cmFwcyBhbmQga2VlcHMgcGxheWluZywgdGhlIGVuZFxuLy8gd2l0aG91dCBsb29wIHN0b3BzIHdoZXJlIGl0IGlzLlxuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2UoaW5kZXgsIGxlbmd0aCwgbG9vcCkge1xuICAgIGlmIChpbmRleCA8IGxlbmd0aCAtIDEpIHJldHVybiB7IGluZGV4OiBpbmRleCArIDEsIHBsYXlpbmc6IHRydWUgfTtcbiAgICBpZiAobG9vcCkgcmV0dXJuIHsgaW5kZXg6IDAsIHBsYXlpbmc6IHRydWUgfTtcbiAgICByZXR1cm4geyBpbmRleCwgcGxheWluZzogZmFsc2UgfTtcbn1cblxuLy8gV2hlcmUgdGhlIGNvbnRyb2wgc2l0cywgYXMgaW5saW5lIHN0eWxlcyBzbyB0aGUgY2hvaWNlIHRyYXZlbHMgd2l0aCB0aGUgc3RhdGUgcmF0aGVyXG4vLyB0aGFuIG5lZWRpbmcgYSBzdHlsZXNoZWV0IHJ1bGUgcGVyIGNvcm5lci4gRXZlcnkgcHJvcGVydHkgaXMgd3JpdHRlbiBvbiBldmVyeSByZW5kZXIgLS1cbi8vIGluY2x1ZGluZyB0aGUgb25lcyBhIHBvc2l0aW9uIGRvZXMgbm90IHVzZSAtLSBzbyBtb3ZpbmcgdGhlIGNvbnRyb2wgY2xlYXJzIHRoZSBvbGRcbi8vIGFuY2hvciBpbnN0ZWFkIG9mIGFjY3VtdWxhdGluZyBib3RoLlxuZXhwb3J0IGNvbnN0IFBPU0lUSU9OUyA9IHtcbiAgICBcInRvcC1sZWZ0XCI6ICAgICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiMTBweFwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG4gICAgXCJ0b3AtY2VudGVyXCI6ICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjUwJVwiLCByaWdodDogXCJcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVgoLTUwJSlcIiB9LFxuICAgIFwidG9wLXJpZ2h0XCI6ICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImxlZnQtY2VudGVyXCI6ICAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJyaWdodC1jZW50ZXJcIjogIHsgdG9wOiBcIjUwJVwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcInRyYW5zbGF0ZVkoLTUwJSlcIiB9LFxuICAgIFwiYm90dG9tLWxlZnRcIjogICB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcImJvdHRvbS1jZW50ZXJcIjogeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tcmlnaHRcIjogIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxufTtcblxuZnVuY3Rpb24gYXBwbHlQb3NpdGlvbihlbCwgcG9zaXRpb24pIHtcbiAgICBjb25zdCBzdHlsZXMgPSBQT1NJVElPTlNbcG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcInRvcC1jZW50ZXJcIl07XG4gICAgZm9yIChjb25zdCBbcHJvcCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN0eWxlcykpIHtcbiAgICAgICAgZWwuc3R5bGVbcHJvcF0gPSB2YWx1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFVUQyhtcykge1xuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZShcIlRcIiwgXCIgXCIpICsgXCJaXCI7XG59XG5cbi8vIC0tLSB0aGUgd2luZG93IGFuZCB0aGUgcnVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gRml4ZWQgbWlsbGlzZWNvbmRzIGZvciBhIHBlcmlvZCwgb3IgbnVsbCB3aGVuIGl0IG1vdmVzIHRocm91Z2ggdGhlIGNhbGVuZGFyIChtb250aHMsXG4vLyB5ZWFycykgYW5kIGhhcyBubyBmaXhlZCB3aWR0aC4gVGhlIHJ1bGVyIGFuZCB0aGUgZHJhZyBncmlkIG5lZWQgZml4ZWQgd2lkdGhzOyBjYWxlbmRhclxuLy8gcGVyaW9kcyBmYWxsIGJhY2sgdG8gdGhlIHRpY2sgcG9zaXRpb25zIHRoZW1zZWx2ZXMuXG5leHBvcnQgZnVuY3Rpb24gcGVyaW9kVG9NcyhwKSB7XG4gICAgaWYgKCFwIHx8IHAueWVhcnMgfHwgcC5tb250aHMpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAoKHAud2Vla3MgKiA3ICsgcC5kYXlzKSAqIDI0ICogMzYwMCArIHAuaG91cnMgKiAzNjAwXG4gICAgICAgICsgcC5taW51dGVzICogNjAgKyBwLnNlY29uZHMpICogMTAwMDtcbn1cblxuLy8gTWlsbGlzZWNvbmRzIGFzIGFuIElTTzg2MDEgZHVyYXRpb24sIGhvdXJzL21pbnV0ZXMvc2Vjb25kcyBvbmx5IC0tIFBUMjZIIGlzIHZhbGlkIGFuZFxuLy8gYXZvaWRzIGNhbGVuZGFyIHVuaXRzIGVudGlyZWx5LCBzbyB3aGF0IHRoZSBkcmFnIHdyaXRlcyBhbHdheXMgcGFyc2VzIGJhY2sgZXhhY3RseS5cbmV4cG9ydCBmdW5jdGlvbiBtc1RvUGVyaW9kSVNPKG1zKSB7XG4gICAgbGV0IHJlc3QgPSBNYXRoLnJvdW5kKG1zIC8gMTAwMCk7XG4gICAgY29uc3QgaCA9IE1hdGguZmxvb3IocmVzdCAvIDM2MDApOyByZXN0IC09IGggKiAzNjAwO1xuICAgIGNvbnN0IG0gPSBNYXRoLmZsb29yKHJlc3QgLyA2MCk7IHJlc3QgLT0gbSAqIDYwO1xuICAgIGxldCBvdXQgPSBcIlBUXCI7XG4gICAgaWYgKGgpIG91dCArPSBgJHtofUhgO1xuICAgIGlmIChtKSBvdXQgKz0gYCR7bX1NYDtcbiAgICBpZiAocmVzdCB8fCBvdXQgPT09IFwiUFRcIikgb3V0ICs9IGAke3Jlc3R9U2A7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gVGhlIHJ1bGVyJ3MgaW5jcmVtZW50OiB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gZXZlcnkgYm91bmRhcnkgdGhlIHVzZXIgY2FuIGNhcmVcbi8vIGFib3V0IC0tIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZCBkdXJhdGlvbi4gQW4gaW50ZXJ2YWwgb2YgMWggd2l0aCBhXG4vLyAyLjVoIGR1cmF0aW9uIG5lZWRzIDMwLW1pbnV0ZSBtYXJrcyBmb3IgdGhlIGR1cmF0aW9uIHRvIHNpdCBvbiBvbmU7IDFoIGFuZCAyaCBuZWVkIG9ubHlcbi8vIHRoZSBob3Vycy4gXCJMb3dlc3QgZHVyYXRpb25cIiBpcyB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIG9uZSBkaXZpZGVzIHRoZSBvdGhlci5cbmV4cG9ydCBmdW5jdGlvbiBnY2RHcmlkTXMocGVyaW9kTXMsIGR1cmF0aW9uc01zKSB7XG4gICAgY29uc3QgZ2NkID0gKGEsIGIpID0+IChiID8gZ2NkKGIsIGEgJSBiKSA6IGEpO1xuICAgIGxldCBncmlkID0gcGVyaW9kTXM7XG4gICAgZm9yIChjb25zdCBkIG9mIGR1cmF0aW9uc01zKSB7XG4gICAgICAgIGlmIChkID4gMCkgZ3JpZCA9IGdjZChncmlkLCBNYXRoLnJvdW5kKGQpKTtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgubWF4KGdyaWQsIDEwMDApO1xufVxuXG4vLyBFdmVyeSBmaW5pdGUgZHVyYXRpb24gYXR0YWNoZWQgdG8gYSB0aW1lIGxheWVyLCBpbiBtcywgZm9yIHRoZSBncmlkLiBcInBlcmlvZFwiIGFuZCBudWxsXG4vLyBjb250cmlidXRlIG5vdGhpbmcgbmV3OyBjYWxlbmRhciBkdXJhdGlvbnMgY2Fubm90IGpvaW4gYSBmaXhlZC1tcyBncmlkIGFuZCBhcmUgc2tpcHBlZC5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJzLCB3aW5kb3dJc28pIHtcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBjb25zdCB2aXNpdCA9IGxpc3QgPT4gbGlzdC5mb3JFYWNoKGwgPT4ge1xuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsLmxheWVycyB8fCBbXSk7XG4gICAgICAgIGNvbnN0IHNwZWMgPSBsLnRpbWUgJiYgbC50aW1lLmR1cmF0aW9uO1xuICAgICAgICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIgJiYgc3BlYyAhPT0gXCJwZXJpb2RcIikge1xuICAgICAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcbiAgICAgICAgICAgIGlmIChtcykgb3V0LnB1c2gobXMpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgdmlzaXQobGF5ZXJzKTtcbiAgICBpZiAod2luZG93SXNvKSB7XG4gICAgICAgIGNvbnN0IG1zID0gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh3aW5kb3dJc28pKTtcbiAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG59XG5cbi8vIFRpY2sgbWFya3MgZm9yIHRoZSB0cmFjazogbWFqb3JzIGF0IGV2ZXJ5IGludGVydmFsIGJvdW5kYXJ5IChzcGFyc2VseSBsYWJlbGxlZCBzbyBsb25nXG4vLyB0aW1lbGluZXMgc3RheSByZWFkYWJsZSksIHVubGFiZWxsZWQgbWlub3JzIGF0IHRoZSBncmlkIGluIGJldHdlZW4uIE1pbm9yIERJU1BMQVkgaXNcbi8vIHRoaW5uZWQgd2hlbiBkZW5zZTsgdGhlIHNuYXAgZ3JpZCBzdGF5cyBleGFjdCwgc28gYSBtYXJrIGlzIGEgZ3VpZGUsIG5vdCBhIGNvbnN0cmFpbnQuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSdWxlcih0aWNrcywgZ3JpZE1zLCBmb3JtYXRMYWJlbCwgeyBtYXhMYWJlbHMgPSA2LCBtYXhNaW5vcnMgPSAyNDAgfSA9IHt9KSB7XG4gICAgaWYgKHRpY2tzLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcbiAgICBjb25zdCB0MCA9IHRpY2tzWzBdLCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0MDtcbiAgICBjb25zdCBtYXJrcyA9IFtdO1xuICAgIGNvbnN0IGxhYmVsRXZlcnkgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodGlja3MubGVuZ3RoIC8gbWF4TGFiZWxzKSk7XG4gICAgdGlja3MuZm9yRWFjaCgodCwgaSkgPT4gbWFya3MucHVzaCh7XG4gICAgICAgIGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiB0cnVlLFxuICAgICAgICBsYWJlbDogaSAlIGxhYmVsRXZlcnkgPT09IDAgPyBmb3JtYXRMYWJlbCh0KSA6IG51bGwsXG4gICAgfSkpO1xuICAgIGlmIChncmlkTXMgJiYgZ3JpZE1zIDwgc3Bhbikge1xuICAgICAgICBjb25zdCB0b3RhbCA9IE1hdGguZmxvb3Ioc3BhbiAvIGdyaWRNcyk7XG4gICAgICAgIGNvbnN0IHRoaW4gPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodG90YWwgLyBtYXhNaW5vcnMpKTtcbiAgICAgICAgZm9yIChsZXQgayA9IDE7IGsgKiBncmlkTXMgPCBzcGFuOyBrICs9IHRoaW4pIHtcbiAgICAgICAgICAgIGNvbnN0IHQgPSB0MCArIGsgKiBncmlkTXM7XG4gICAgICAgICAgICBpZiAodGlja3MuaW5jbHVkZXModCkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgbWFya3MucHVzaCh7IGZyYWN0aW9uOiAodCAtIHQwKSAvIHNwYW4sIG1ham9yOiBmYWxzZSwgbGFiZWw6IG51bGwgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG1hcmtzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGlja0xhYmVsKG1zLCBwZXJpb2RNcykge1xuICAgIGNvbnN0IGlzbyA9IG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpO1xuICAgIGlmIChwZXJpb2RNcyAhPSBudWxsICYmIHBlcmlvZE1zIDwgNjAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxOSk7XG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCAyNCAqIDM2MDAgKiAxMDAwKSByZXR1cm4gaXNvLnNsaWNlKDExLCAxNik7XG4gICAgcmV0dXJuIGlzby5zbGljZSg1LCAxMCk7XG59XG5cbi8vIEdseXBocyBhcyBpbmxpbmUgU1ZHIHJhdGhlciB0aGFuIHRleHQ6IFwiXHUyMUJCXCIgcmVhZHMgYXMgcmVmcmVzaCAtLSBhIGxvb3AgdG9nZ2xlIGRyYXduIHdpdGhcbi8vIGl0IGxvb2tzIGxpa2UgYSByZXNldCBidXR0b24sIHdoaWNoIGlzIGV4YWN0bHkgaG93IGl0IGdvdCBtaXNyZWFkLiBjdXJyZW50Q29sb3IgbGV0c1xuLy8gdGhlIHByZXNzZWQgc3RhdGUgcmVzdHlsZSB0aGVtIGZyb20gQ1NTLlxuY29uc3QgSUNPTlMgPSB7XG4gICAgYmFjazogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTMgMmgydjEySDN6TTEzIDIgNiA4bDcgNnpcIi8+PC9zdmc+JyxcbiAgICBwbGF5OiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNNCAybDkgNi05IDZ6XCIvPjwvc3ZnPicsXG4gICAgcGF1c2U6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJoM3YxMkg0ek05IDJoM3YxMkg5elwiLz48L3N2Zz4nLFxuICAgIGZ3ZDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTExIDJoMnYxMmgtMnpNMyAybDcgNi03IDZ6XCIvPjwvc3ZnPicsXG4gICAgbG9vcDogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTggMmE2IDYgMCAwIDEgNS42NSA0SDE2bC0yLjggMy41TDEwLjQgNmgyLjFBNC41IDQuNSAwIDEgMCAxMi41IDEwbDEuMy43NUE2IDYgMCAxIDEgOCAyelwiLz48L3N2Zz4nLFxufTtcblxuLy8gLS0tIHRoZSBjb250cm9sIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQbGFpbiBET00gaW5zaWRlIHRoZSB3aWRnZXQgY29udGFpbmVyLCBsaWtlIHRoZSBzaWRlYmFyOiBubyBMZWFmbGV0IGNvbnRyb2wgbWFjaGluZXJ5LFxuLy8gd2hpY2gga2VlcHMgaXQgdGVzdGFibGUgaW4ganNkb20gYW5kIHN0eWxlYWJsZSBmcm9tIG1hcC5jc3MuIFRoZSBsYXlvdXQgZm9sbG93c1xuLy8gTGVhZmxldC5UaW1lRGltZW5zaW9uJ3MgY29udHJvbCAtLSBzdGVwL3BsYXkvc3RlcC9sb29wIGFzIGEgam9pbmVkIGJ1dHRvbiBiYXIsIHRoZW4gdGhlXG4vLyBkYXRlLCBzbGlkZXIgYW5kIHNwZWVkIC0tIHNpbmNlIHRoYXQgaXMgdGhlIHNsaWRlciB1c2VycyBvZiB0aGUgZm9saXVtIGFwcHMga25vdy5cbi8vXG4vLyBUaGUgc2xpZGVyIGlzIGEgY29tcG9zaXRlLiBBIG5hdGl2ZSA8aW5wdXQgdHlwZT1yYW5nZT4gc3RheXMgb24gdG9wIGFzIHRoZSB0aHVtYjogaXRcbi8vIGtlZXBzIGtleWJvYXJkIGFycm93cywgc2NyZWVuIHJlYWRlcnMgYW5kIGV2ZXJ5IGV4aXN0aW5nIHRlc3Qgd29ya2luZywgYW5kIHBsYXliYWNrXG4vLyBkcml2ZXMgaXQgYXMgYmVmb3JlLiBVbmRlcm5lYXRoIHNpdCB0aGUgcGFydHMgYSBuYXRpdmUgaW5wdXQgY2Fubm90IGRyYXc6IHRoZSB3aW5kb3dcbi8vIHNwYW4gc2hvd2luZyBleGFjdGx5IHdoYXQgaW50ZXJ2YWwgaXMgb24gdGhlIG1hcCwgYSBydWxlciB3aXRoIGxhYmVsbGVkIGludGVydmFsIG1hcmtzXG4vLyBhbmQgdW5sYWJlbGxlZCBnY2QgbWlub3JzLCBhbmQgdGhlIHRyYWlsIGhhbmRsZSAtLSBkcmFnIGl0IGJhY2sgdG8gd2lkZW4gdGhlIHdpbmRvdyBmb3Jcbi8vIGV2ZXJ5IGxheWVyIGF0IG9uY2UsIGRyb3AgaXQgb250byB0aGUgdGh1bWIgdG8gaGFuZCBjb250cm9sIGJhY2sgdG8gcGVyLWxheWVyIGR1cmF0aW9ucy5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJUaW1lQ29udHJvbChjb250YWluZXIsIHN0YXRlLCBoYW5kbGVycykge1xuICAgIGxldCBlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtY29udHJvbFwiKTtcbiAgICBpZiAoIXN0YXRlLnRpY2tzIHx8IHN0YXRlLnRpY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoZWwpIGVsLnJlbW92ZSgpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKCFlbCkge1xuICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGVsLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1jb250cm9sXCI7XG4gICAgICAgIGVsLmlubmVySFRNTCA9IGBcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3dpZnRtYXAtdGltZS1idXR0b25zXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFja1wiIHRpdGxlPVwiU3RlcCBiYWNrXCIgYXJpYS1sYWJlbD1cIlN0ZXAgYmFja1wiPiR7SUNPTlMuYmFja308L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1wbGF5XCIgYXJpYS1sYWJlbD1cIlBsYXlcIj4ke0lDT05TLnBsYXl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtZndkXCIgdGl0bGU9XCJTdGVwIGZvcndhcmRcIiBhcmlhLWxhYmVsPVwiU3RlcCBmb3J3YXJkXCI+JHtJQ09OUy5md2R9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbG9vcFwiIGFyaWEtbGFiZWw9XCJMb29wXCI+JHtJQ09OUy5sb29wfTwvYnV0dG9uPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWxhYmVsXCI+PC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWNrXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJhc2VcIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwYW5cIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXJ1bGVyXCI+PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxpbnB1dCBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIgdHlwZT1cInJhbmdlXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCI+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXRyYWlsXCIgcm9sZT1cInNsaWRlclwiIHRhYmluZGV4PVwiMFwiXG4gICAgICAgICAgICAgICAgICAgICAgYXJpYS1sYWJlbD1cIlRyYWlsaW5nIHdpbmRvd1wiIHRpdGxlPVwiRHJhZyBiYWNrIHRvIHdpZGVuIHRoZSB0aW1lIHdpbmRvdzsgZHJvcCBvbiB0aGUgdGh1bWIgdG8gY2xlYXJcIj48L3NwYW4+XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8c2VsZWN0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zcGVlZFwiIHRpdGxlPVwiUGxheWJhY2sgc3BlZWRcIj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMC41XCI+MC41eDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIxXCI+MXg8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiMlwiPjJ4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjRcIj40eDwvb3B0aW9uPlxuICAgICAgICAgICAgPC9zZWxlY3Q+YDtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGVsKTtcblxuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtYmFja1wiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwQmFjayk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1md2RcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uU3RlcEZvcndhcmQpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25QbGF5VG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIikuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGhhbmRsZXJzLm9uTG9vcFRvZ2dsZSk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsXG4gICAgICAgICAgICBlID0+IGhhbmRsZXJzLm9uU3BlZWQocGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkpKTtcbiAgICAgICAgY29uc3Qgc2xpZGVyID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNsaWRlclwiKTtcbiAgICAgICAgLy8gYGlucHV0YCBmaXJlcyBwZXIgZHJhZyBzdGVwIGZvciBsaXZlIHNjcnViYmluZzsgdGhlIG1vZGVsIHdyaXRlYmFjayBpcyB0aGVcbiAgICAgICAgLy8gaGFuZGxlcidzIHByb2JsZW0sIHRocm90dGxlZCB0aGVyZSBzbyBkcmFnZ2luZyBkb2VzIG5vdCBmbG9vZCB0aGUga2VybmVsLlxuICAgICAgICBzbGlkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGUgPT4gaGFuZGxlcnMub25TZWVrKHBhcnNlSW50KGUudGFyZ2V0LnZhbHVlLCAxMCkpKTtcblxuICAgICAgICBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKTtcbiAgICB9XG5cbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLm1heCA9IFN0cmluZyhzdGF0ZS50aWNrcy5sZW5ndGggLSAxKTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLmluZGV4KTtcbiAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbGFiZWxcIikudGV4dENvbnRlbnQgPSBmb3JtYXRVVEMoc3RhdGUudGlja3Nbc3RhdGUuaW5kZXhdKTtcblxuICAgIGNvbnN0IHBsYXkgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcGxheVwiKTtcbiAgICBwbGF5LmlubmVySFRNTCA9IHN0YXRlLnBsYXlpbmcgPyBJQ09OUy5wYXVzZSA6IElDT05TLnBsYXk7XG4gICAgcGxheS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIik7XG4gICAgcGxheS50aXRsZSA9IHN0YXRlLnBsYXlpbmcgPyBcIlBhdXNlXCIgOiBcIlBsYXlcIjtcblxuICAgIC8vIEEgbW9kZSwgbm90IGFuIGFjdGlvbjogcHJlc3NlZCBzdHlsaW5nIGFuZCBhcmlhLXByZXNzZWQgc2F5IFwidGhpcyBzdGF5cyBvblwiLFxuICAgIC8vIHdoZXJlIGEgYmFyZSBpY29uIGludml0ZWQgYSBjbGljayBleHBlY3Rpbmcgc29tZXRoaW5nIHRvIGhhcHBlbiByaWdodCBub3cuXG4gICAgY29uc3QgbG9vcCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sb29wXCIpO1xuICAgIGxvb3AuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCBCb29sZWFuKHN0YXRlLmxvb3ApKTtcbiAgICBsb29wLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcoQm9vbGVhbihzdGF0ZS5sb29wKSkpO1xuICAgIGxvb3AudGl0bGUgPSBzdGF0ZS5sb29wID8gXCJMb29wOiBvblwiIDogXCJMb29wOiBvZmZcIjtcblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGVlZFwiKS52YWx1ZSA9IFN0cmluZyhzdGF0ZS5zcGVlZCB8fCAxKTtcbiAgICByZW5kZXJUcmFjayhlbCwgc3RhdGUpO1xuICAgIGFwcGx5UG9zaXRpb24oZWwsIHN0YXRlLnBvc2l0aW9uKTtcbiAgICByZXR1cm4gZWw7XG59XG5cbi8vIEdlb21ldHJ5IHNoYXJlZCBieSByZW5kZXJpbmcgYW5kIGRyYWdnaW5nOiB3aGVyZSBhIHRpbWUgc2l0cyBvbiB0aGUgdHJhY2ssIDAuLjEuXG5mdW5jdGlvbiB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0KSB7XG4gICAgY29uc3Qgc3BhbiA9IHRpY2tzW3RpY2tzLmxlbmd0aCAtIDFdIC0gdGlja3NbMF07XG4gICAgaWYgKHNwYW4gPD0gMCkgcmV0dXJuIDE7XG4gICAgcmV0dXJuIE1hdGgubWluKDEsIE1hdGgubWF4KDAsICh0IC0gdGlja3NbMF0pIC8gc3BhbikpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJUcmFjayhlbCwgc3RhdGUpIHtcbiAgICBjb25zdCB7IHRpY2tzLCBpbmRleCB9ID0gc3RhdGU7XG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XG4gICAgdHJhY2suX3N0YXRlID0gc3RhdGU7ICAgICAgLy8gdGhlIGRyYWcgaGFuZGxlciByZWFkcyB0aGUgZnJlc2hlc3Qgc3RhdGUgZnJvbSBoZXJlXG5cbiAgICBjb25zdCB0aHVtYlQgPSB0aWNrc1tpbmRleF07XG4gICAgY29uc3QgcGVyaW9kTXMgPSBzdGF0ZS5wZXJpb2RNcztcbiAgICBjb25zdCB3aW5kb3dNcyA9IHN0YXRlLndpbmRvdyA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3RhdGUud2luZG93KSkgOiBudWxsO1xuICAgIGNvbnN0IHNob3duTXMgPSB3aW5kb3dNcyAhPSBudWxsID8gd2luZG93TXMgOiBwZXJpb2RNcztcblxuICAgIC8vIFRoZSBzcGFuOiB3aGF0IGludGVydmFsIHRoZSBtYXAgaXMgc2hvd2luZyByaWdodCBub3cuIFRoZSBzcGFuIGRlcGljdHMgdGhlIHNoYXJlZFxuICAgIC8vIHdpbmRvdyAtLSBvbmUgcGVyaW9kIGJ5IGRlZmF1bHQgLS0gYW5kIHBlci1sYXllciBkdXJhdGlvbnMgcmVtYWluIGFuIEFQSSBjb25jZXJuXG4gICAgLy8gdW50aWwgYSBkcmFnIG92ZXJyaWRlcyB0aGVtIGZvciBldmVyeXRoaW5nIGF0IG9uY2UuXG4gICAgY29uc3Qgc3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zcGFuXCIpO1xuICAgIGNvbnN0IHJpZ2h0ID0gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUKTtcbiAgICBjb25zdCBsZWZ0ID0gc2hvd25NcyAhPSBudWxsID8gdHJhY2tGcmFjdGlvbih0aWNrcywgdGh1bWJUIC0gc2hvd25NcykgOiAwO1xuICAgIHNwYW4uc3R5bGUubGVmdCA9IGAkeyhsZWZ0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHNwYW4uc3R5bGUud2lkdGggPSBgJHsoTWF0aC5tYXgoMCwgcmlnaHQgLSBsZWZ0KSAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICBzcGFuLmNsYXNzTGlzdC50b2dnbGUoXCJvdmVycmlkZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcblxuICAgIC8vIFRoZSB0cmFpbCBoYW5kbGUgcGFya3MgT04gdGhlIHRodW1iIHdoZW4gbm8gb3ZlcnJpZGUgaXMgYWN0aXZlIC0tIFwibm90IGdyYWJiZWRcIiAtLVxuICAgIC8vIGFuZCBzaXRzIGF0IHRoZSB3aW5kb3cncyBzdGFydCB3aGlsZSBvbmUgaXMuIERyb3BwaW5nIGl0IGJhY2sgb24gdGhlIHRodW1iIGNsZWFycy5cbiAgICBjb25zdCB0cmFpbCA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFpbFwiKTtcbiAgICBjb25zdCBhdCA9IHdpbmRvd01zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSB3aW5kb3dNcykgOiByaWdodDtcbiAgICB0cmFpbC5zdHlsZS5sZWZ0ID0gYCR7KGF0ICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHRyYWlsLmNsYXNzTGlzdC50b2dnbGUoXCJhY3RpdmVcIiwgd2luZG93TXMgIT0gbnVsbCk7XG4gICAgdHJhaWwuc2V0QXR0cmlidXRlKFwiYXJpYS12YWx1ZXRleHRcIiwgc3RhdGUud2luZG93IHx8IFwibm8gdHJhaWxpbmcgd2luZG93XCIpO1xuICAgIC8vIE5vIGZpeGVkLW1zIGdyaWQgKGNhbGVuZGFyIHBlcmlvZHMpIG1lYW5zIG5vdGhpbmcgc2Vuc2libGUgdG8gc25hcCB0by5cbiAgICB0cmFpbC5zdHlsZS5kaXNwbGF5ID0gc3RhdGUuZ3JpZE1zID8gXCJcIiA6IFwibm9uZVwiO1xuXG4gICAgY29uc3QgcnVsZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtcnVsZXJcIik7XG4gICAgY29uc3Qga2V5ID0gYCR7dGlja3NbMF19fCR7dGlja3MubGVuZ3RofXwke3N0YXRlLmdyaWRNc318JHtwZXJpb2RNc31gO1xuICAgIGlmIChydWxlci5fa2V5ICE9PSBrZXkpIHtcbiAgICAgICAgcnVsZXIuX2tleSA9IGtleTtcbiAgICAgICAgcnVsZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICAgICAgZm9yIChjb25zdCBtYXJrIG9mIGJ1aWxkUnVsZXIodGlja3MsIHN0YXRlLmdyaWRNcywgdCA9PiBmb3JtYXRUaWNrTGFiZWwodCwgcGVyaW9kTXMpKSkge1xuICAgICAgICAgICAgY29uc3QgbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgbS5jbGFzc05hbWUgPSBtYXJrLm1ham9yID8gXCJzd2lmdG1hcC10aW1lLW1hcmsgbWFqb3JcIiA6IFwic3dpZnRtYXAtdGltZS1tYXJrXCI7XG4gICAgICAgICAgICBtLnN0eWxlLmxlZnQgPSBgJHsobWFyay5mcmFjdGlvbiAqIDEwMCkudG9GaXhlZCgyKX0lYDtcbiAgICAgICAgICAgIGlmIChtYXJrLmxhYmVsKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICAgICAgbGFiLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtdGltZS1tYXJrLWxhYmVsXCI7XG4gICAgICAgICAgICAgICAgbGFiLnRleHRDb250ZW50ID0gbWFyay5sYWJlbDtcbiAgICAgICAgICAgICAgICBtLmFwcGVuZENoaWxkKGxhYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBydWxlci5hcHBlbmRDaGlsZChtKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gRHJhZ2dpbmcgdGhlIHRyYWlsIGhhbmRsZS4gU25hcHMgdG8gdGhlIGdjZCBncmlkIHNvIGV2ZXJ5IHN0b3AgaXMgYSBib3VuZGFyeSB0aGUgZGF0YVxuLy8gb3IgdGhlIGludGVydmFsIGFjdHVhbGx5IG5hbWVzOyB0aGUgZGlzdGFuY2UgdG8gdGhlIHRodW1iLCBpbiB3aG9sZSBncmlkIHN0ZXBzLCBJUyB0aGVcbi8vIHdpbmRvdy4gWmVybyBzdGVwcyAtLSBkcm9wcGVkIG9uIHRoZSB0aHVtYiAtLSBjbGVhcnMgdGhlIG92ZXJyaWRlLlxuZnVuY3Rpb24gYXR0YWNoVHJhaWxEcmFnKGVsLCBoYW5kbGVycykge1xuICAgIGNvbnN0IHRyYWNrID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWNrXCIpO1xuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xuXG4gICAgZnVuY3Rpb24gaXNvRnJvbUV2ZW50KGV2KSB7XG4gICAgICAgIGNvbnN0IHN0YXRlID0gdHJhY2suX3N0YXRlO1xuICAgICAgICBjb25zdCByZWN0ID0gdHJhY2suZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcyB8fCByZWN0LndpZHRoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdW5jbGFtcGVkIG9uIHRoZSBsZWZ0OiB0aGUgd2luZG93IGlzIFwiaG93IGZhciBiYWNrIGZyb20gdGhlXG4gICAgICAgIC8vIGxlYWQgcG9pbnRcIiwgYW5kIHRoYXQgbWF5IHJlYWNoIHBhc3QgdGhlIGJhcidzIHN0YXJ0IC0tIGVzcGVjaWFsbHkgd2hlbiB0aGVcbiAgICAgICAgLy8gbGVhZCBzaXRzIGVhcmx5IG9uIHRoZSBiYXIgYW5kIG1vc3Qgb2YgaXRzIHRyYWlsIGlzIG9mZi1zY3JlZW4uIENsYW1waW5nIGhlcmVcbiAgICAgICAgLy8gY2FwcGVkIHRoZSB3aW5kb3cgYXQgdGhlIHZpc2libGUgcGFzdCwgd2hpY2ggcGlubmVkIHRoZSBoYW5kbGUgdG8gdGhlIGJhcidzXG4gICAgICAgIC8vIHN0YXJ0IGFuZCBtYWRlIGFueXRoaW5nIHdpZGVyIGltcG9zc2libGUgdG8gc2V0LiBPbmx5IHRoZSBEUkFXSU5HIGNsYW1wcy5cbiAgICAgICAgY29uc3QgZnJhYyA9IE1hdGgubWluKDEsIChldi5jbGllbnRYIC0gcmVjdC5sZWZ0KSAvIHJlY3Qud2lkdGgpO1xuICAgICAgICBjb25zdCB0MCA9IHN0YXRlLnRpY2tzWzBdO1xuICAgICAgICBjb25zdCBzcGFuTXMgPSBzdGF0ZS50aWNrc1tzdGF0ZS50aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xuICAgICAgICBjb25zdCB0aHVtYlQgPSBzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF07XG4gICAgICAgIGNvbnN0IGRpc3QgPSB0aHVtYlQgLSAodDAgKyBmcmFjICogc3Bhbk1zKTtcbiAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGRpc3QgLyBzdGF0ZS5ncmlkTXMpKTtcbiAgICAgICAgcmV0dXJuIHN0ZXBzID09PSAwID8gbnVsbCA6IG1zVG9QZXJpb2RJU08oc3RlcHMgKiBzdGF0ZS5ncmlkTXMpO1xuICAgIH1cblxuICAgIC8vIE1vdmUgYW5kIHJlbGVhc2UgbGlzdGVuIG9uIHRoZSBkb2N1bWVudCBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBkcmFnOiB0aGUgaGFuZGxlXG4gICAgLy8gaXMgMTJweCB3aWRlLCB0aGUgY3Vyc29yIGxlYXZlcyBpdCBvbiB0aGUgZmlyc3QgZmFzdCBtb3ZlbWVudCwgYW5kIGV2ZW50cyB0aGF0XG4gICAgLy8gdGFyZ2V0IHdoYXRldmVyIGlzIHVuZGVybmVhdGggd291bGQgc3R1dHRlciB0aGUgZHJhZyBhbmQgY291bGQgc3dhbGxvdyB0aGUgcmVsZWFzZVxuICAgIC8vIGVudGlyZWx5IC0tIGFuIHVuY29tbWl0dGVkIGRyYWcgdGhlbiBzbmFwcyBiYWNrIG9uIHRoZSBuZXh0IHN5bmMuXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIC8vIENhcHR1cmUgcmV0YXJnZXRzIGV2ZXJ5IHBvaW50ZXIgZXZlbnQgdG8gdGhlIGhhbmRsZSB1bnRpbCByZWxlYXNlLCBubyBtYXR0ZXJcbiAgICAgICAgLy8gd2hlcmUgdGhlIGN1cnNvciBpcy4gV2l0aG91dCBpdCwgbGV0dGluZyBnbyB3aXRoIHRoZSBwb2ludGVyIG92ZXIgdGhlIG1hcCBoYW5kc1xuICAgICAgICAvLyBwb2ludGVydXAgdG8gTGVhZmxldCdzIGNvbnRhaW5lciBoYW5kbGVycywgYW5kIGEgcmVsZWFzZSB0aGV5IHN3YWxsb3cgbmV2ZXJcbiAgICAgICAgLy8gcmVhY2hlcyB0aGUgZG9jdW1lbnQgbGlzdGVuZXIgLS0gdGhlIGRyYWcgc3RheXMgdW5jb21taXR0ZWQgYW5kIHRoZSBuZXh0IHN5bmNcbiAgICAgICAgLy8gc25hcHMgdGhlIGhhbmRsZSBob21lLiBUaGUgZG9jdW1lbnQgbGlzdGVuZXJzIGJlbG93IHJlbWFpbiBhcyB0aGUgZmFsbGJhY2sgZm9yXG4gICAgICAgIC8vIGVudmlyb25tZW50cyB3aXRob3V0IGNhcHR1cmU7IHdpdGggaXQsIHJldGFyZ2V0ZWQgZXZlbnRzIHN0aWxsIGJ1YmJsZSB0byB0aGVtLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKSB0cmFpbC5zZXRQb2ludGVyQ2FwdHVyZShldi5wb2ludGVySWQpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogc3ludGhldGljIGV2ZW50cyBoYXZlIG5vIGFjdGl2ZSBwb2ludGVyOyBmYWxsIGJhY2sgdG8gYnViYmxpbmcgKi8gfVxuXG4gICAgICAgIGNvbnN0IG1vdmUgPSBlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dEcmFnKGlzbyk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGZpbmlzaCA9IGUgPT4ge1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBmaW5pc2gpO1xuICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcbiAgICAgICAgICAgIGNvbnN0IGlzbyA9IGlzb0Zyb21FdmVudChlKTtcbiAgICAgICAgICAgIGlmIChpc28gIT09IHVuZGVmaW5lZCkgaGFuZGxlcnMub25XaW5kb3dDb21taXQoaXNvKTtcbiAgICAgICAgfTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyY2FuY2VsXCIsIGZpbmlzaCk7XG4gICAgfSk7XG5cbiAgICAvLyBLZXlib2FyZDogb25lIGdyaWQgc3RlcCBwZXIgYXJyb3csIERlbGV0ZS9Ib21lIHRvIGNsZWFyLiBTYW1lIGNvbnRyYWN0IGFzIHRoZSBkcmFnLlxuICAgIHRyYWlsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGV2ID0+IHtcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XG4gICAgICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLmdyaWRNcykgcmV0dXJuO1xuICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IDA7XG4gICAgICAgIGxldCBuZXh0O1xuICAgICAgICBpZiAoZXYua2V5ID09PSBcIkFycm93TGVmdFwiKSBuZXh0ID0gY3VycmVudCArIHN0YXRlLmdyaWRNcztcbiAgICAgICAgZWxzZSBpZiAoZXYua2V5ID09PSBcIkFycm93UmlnaHRcIikgbmV4dCA9IE1hdGgubWF4KDAsIGN1cnJlbnQgLSBzdGF0ZS5ncmlkTXMpO1xuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiRGVsZXRlXCIgfHwgZXYua2V5ID09PSBcIkhvbWVcIikgbmV4dCA9IDA7XG4gICAgICAgIGVsc2UgcmV0dXJuO1xuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChuZXh0ID4gMCA/IG1zVG9QZXJpb2RJU08obmV4dCkgOiBudWxsKTtcbiAgICB9KTtcbn1cbiIsICIvLyBUaW1lIGZpbHRlcmluZyBvbiB0aGUgR1BVLCBmb3IgcG9pbnQgbGF5ZXJzLlxyXG4vL1xyXG4vLyBUaGUgY29vcmRpbmF0ZXMgYWxyZWFkeSBsaXZlIGluIEdQVSBidWZmZXJzOyByZWJ1aWxkaW5nIHRoZSBtZXJnZWQgbGF5ZXIgcGVyIHRpY2sgdGhyZXdcclxuLy8gdGhhdCBhd2F5IGFuZCByZS1mZWQgZ2xpZnkgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTIC0tIG1lYXN1cmVkIGF0IH4yLjZzIHBlciB3aW5kb3dcclxuLy8gY2hhbmdlIGF0IHRoYXQgc2NhbGUsIHdpdGggYWxsb2NhdGlvbiBjaHVybiB0aGF0IGNvdWxkIGNyYXNoIHRoZSB0YWIgd2hlbiBjaGFuZ2VzXHJcbi8vIHN0YWNrZWQuIEluc3RlYWQsIGVhY2ggcG9pbnQncyB0aW1lIGludGVydmFsIGFuZCBpdHMgbGF5ZXIncyBkdXJhdGlvbiByaWRlIGFsb25nIGFzXHJcbi8vIHZlcnRleCBhdHRyaWJ1dGVzIHVwbG9hZGVkIG9uY2UsIGFuZCB0aGUgY3VycmVudCB0aWNrIGlzIGEgdW5pZm9ybTogYSB0aWNrIG9yIHdpbmRvd1xyXG4vLyBjaGFuZ2UgY29zdHMgdHdvIGZsb2F0cyBhbmQgYSByZWRyYXcuXHJcbi8vXHJcbi8vIGdsaWZ5IG1ha2VzIHRoaXMgcG9zc2libGUgd2l0aG91dCBmb3JraW5nIGl0OiB2ZXJ0ZXhTaGFkZXJTb3VyY2UgaXMgYW4gb3ZlcnJpZGFibGVcclxuLy8gc2V0dGluZyAodGhlIHBpbiBmcmFnbWVudCBzaGFkZXIgYWxyZWFkeSB1c2VzIHRoZSBzYW1lIGRvb3IpLCBpbnN0YW5jZXMgZXhwb3NlIHRoZWlyXHJcbi8vIGdsL3Byb2dyYW0vY2FudmFzLCBhdHRyaWJ1dGVzIGFyZSBib3VuZCBvbmNlIGF0IHNldHVwLCBhbmQgdGhlIHBlci1mcmFtZSBkcmF3IHRvdWNoZXNcclxuLy8gb25seSB0aGUgbWF0cml4IHVuaWZvcm0gLS0gc28gZXh0cmEgYXR0cmlidXRlcyBib3VuZCBhZnRlciBzZXR1cCBwZXJzaXN0LCBhbmQgdW5pZm9ybVxyXG4vLyB1cGRhdGVzIHRha2UgZWZmZWN0IG9uIHRoZSBuZXh0IHJlZHJhdy5cclxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIHBlcmlvZFRvTXMsIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFRpbWVzIHRyYXZlbCBhcyBmbG9hdDMyIG9uIHRoZSBHUFUsIHdob3NlIGludGVnZXJzIGFyZSBleGFjdCBvbmx5IHRvIDJeMjQuIEVwb2NoIG1zIGlzXHJcbi8vIGhvcGVsZXNzIGF0IHRoYXQgcHJlY2lzaW9uLCBzbyB0aW1lcyBhcmUgcmViYXNlZCB0byB0aGUgYnVja2V0J3MgZWFybGllc3Qgc3RhcnQgYW5kXHJcbi8vIGV4cHJlc3NlZCBpbiBzZWNvbmRzOiBleGFjdCB0byB+MTk0IGRheXMgb2Ygc3BhbiwgYW5kIGEgMnMgcm91bmRpbmcgYmV5b25kIHRoYXQgaXNcclxuLy8gaW52aXNpYmxlIGF0IGFueSB6b29tIGEgdGltZSBzbGlkZXIgbWFrZXMgc2Vuc2UgYXQuXHJcbmNvbnN0IEFMV0FZUyA9IDYuM2U4OyAgIC8vIH4yMCB5ZWFycywgaW4gc2Vjb25kczogdGhlIFwiZHVyYXRpb25cIiBvZiBjdW11bGF0aXZlIGxheWVycyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHRoZSBzcGFuIGhhbGYtd2lkdGggb2YgcG9pbnRzIHdpdGggbm8gcmVhZGFibGUgdGltZS5cclxuXHJcbi8vIFBlci1idWNrZXQgbGF5ZXItdmlzaWJpbGl0eSBzbG90cyBpbiB0aGUgdmVydGV4IHNoYWRlci4gRWFjaCBmbG9hdCBhcnJheSBlbGVtZW50XHJcbi8vIG9jY3VwaWVzIGEgZnVsbCB1bmlmb3JtIHZlY3RvciBpbiBFUyBHTFNMIHBhY2tpbmcsIGFuZCB0aGUgc3BlYyBndWFyYW50ZWVzIG9ubHkgMTI4XHJcbi8vIHZlcnRleCB1bmlmb3JtIHZlY3RvcnMgLS0gNjQgc2xvdHMgbGVhdmVzIGNvbWZvcnRhYmxlIHJvb20gZm9yIHRoZSBtYXRyaXggYW5kIHRoZSB0aW1lXHJcbi8vIHVuaWZvcm1zLiBBIGJ1Y2tldCB3aXRoIG1vcmUgbGF5ZXJzIHRoYW4gc2xvdHMgZmFsbHMgYmFjayB0byByZWJ1aWxkLXBlci10b2dnbGUuXHJcbi8vIChQYWNraW5nIGZvdXIgbGF5ZXJzIHBlciB2ZWM0IHdvdWxkIHF1YWRydXBsZSB0aGlzIGlmIGFueW9uZSBldmVyIG5lZWRzIGl0LilcclxuZXhwb3J0IGNvbnN0IExBWUVSX1NMT1RTID0gNjQ7XHJcblxyXG4vLyBDaGVhcCBraWxsIHN3aXRjaGVzOiBpZiB3aXJpbmcgdGhlIEdMIHN0YXRlIGV2ZXIgZmFpbHMgKGEgZnV0dXJlIGdsaWZ5IHZlcnNpb24gbW92aW5nXHJcbi8vIGl0cyBpbnRlcm5hbHMpLCB0aGUgYWZmZWN0ZWQgZmFtaWx5IGZhbGxzIGJhY2sgdG8gdGhlIENQVSByZWJ1aWxkIHBhdGguIFBvaW50cyBhbmRcclxuLy8gdmVjdG9ycyBhcmUgc2VwYXJhdGUgZmxhZ3MgLS0gYSB2ZWN0b3IgaW50cm9zcGVjdGlvbiBmYWlsdXJlIG11c3Qgbm90IGNvc3QgcG9pbnRzXHJcbi8vIHRoZWlyIEdQVSBwYXRoLlxyXG5sZXQgZ3B1T2sgPSB0cnVlO1xyXG5leHBvcnQgZnVuY3Rpb24gZ3B1VGltZUF2YWlsYWJsZSgpIHsgcmV0dXJuIGdwdU9rOyB9XHJcbmV4cG9ydCBmdW5jdGlvbiBkaXNhYmxlR3B1VGltZShyZWFzb24pIHtcclxuICAgIGlmIChncHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZpbHRlcmluZyBkaXNhYmxlZDogJHtyZWFzb259LiBgICtcclxuICAgICAgICBgRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2suYCk7XHJcbiAgICBncHVPayA9IGZhbHNlO1xyXG59XHJcbmxldCB2ZWN0b3JHcHVPayA9IHRydWU7XHJcbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3JHcHVBdmFpbGFibGUoKSB7IHJldHVybiB2ZWN0b3JHcHVPazsgfVxyXG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZVZlY3RvckdwdShyZWFzb24pIHtcclxuICAgIGlmICh2ZWN0b3JHcHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZvciBsaW5lcy9wb2x5Z29ucyBkaXNhYmxlZDogYCArXHJcbiAgICAgICAgYCR7cmVhc29ufS4gRmFsbGluZyBiYWNrIHRvIHJlYnVpbGQtcGVyLXRpY2sgZm9yIHRob3NlIGJ1Y2tldHMuYCk7XHJcbiAgICB2ZWN0b3JHcHVPayA9IGZhbHNlO1xyXG59XHJcblxyXG4vLyBUaGUgZGVmYXVsdCBwb2ludHMgdmVydGV4IHNoYWRlciAocmVhZCBvdXQgb2YgbGVhZmxldC5nbGlmeSAzLjMuMCkgd2l0aCB0aGUgd2luZG93XHJcbi8vIHRlc3QgYWRkZWQuIEEgaGlkZGVuIHBvaW50IGdldHMgc2l6ZSAwIGFuZCBhIHBvc2l0aW9uIG91dHNpZGUgY2xpcCBzcGFjZSwgc28gbmVpdGhlclxyXG4vLyB0aGUgdmlzaWJsZSBwYXNzIG5vciB0aGUgc2hhcmVkLXByb2dyYW0gcGlja2luZyBwYXNzIGV2ZXIgcmFzdGVyaXNlcyBpdC5cclxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVWZXJ0ZXhTaGFkZXIoKSB7XHJcbiAgICByZXR1cm4gYHVuaWZvcm0gbWF0NCBtYXRyaXg7XHJcbmF0dHJpYnV0ZSB2ZWM0IHZlcnRleDtcclxuYXR0cmlidXRlIHZlYzQgY29sb3I7XHJcbmF0dHJpYnV0ZSBmbG9hdCBwb2ludFNpemU7XHJcbmF0dHJpYnV0ZSB2ZWMyIGFUaW1lU3BhbjtcclxuYXR0cmlidXRlIGZsb2F0IGFEdXJhdGlvbjtcclxuYXR0cmlidXRlIGZsb2F0IGFMYXllcjtcclxudW5pZm9ybSBmbG9hdCB1VGljaztcclxudW5pZm9ybSBmbG9hdCB1T3ZlcnJpZGU7XHJcbnVuaWZvcm0gZmxvYXQgdUxheWVyVmlzWyR7TEFZRVJfU0xPVFN9XTtcclxudmFyeWluZyB2ZWM0IF9jb2xvcjtcclxuXHJcbnZvaWQgbWFpbigpIHtcclxuICAvLyBBIG5lZ2F0aXZlIGR1cmF0aW9uIGlzIHRoZSBmYWRlIGZsYWc6IHxhRHVyYXRpb258IGlzIHRoZSB3aW5kb3csIHRoZSBzaWduIHNheXMgdGhpc1xyXG4gIC8vIHBvaW50IGRpbXMgd2l0aCBhZ2UuIEEgc2hhcmVkIG92ZXJyaWRlIGtlZXBzIHRoZSBwb2ludCdzIG93biBmYWRlIHByZWZlcmVuY2UuXHJcbiAgYm9vbCBmYWRlcyA9IGFEdXJhdGlvbiA8IDAuMDtcclxuICBmbG9hdCBkdXIgPSB1T3ZlcnJpZGUgPj0gMC4wID8gdU92ZXJyaWRlIDogYWJzKGFEdXJhdGlvbik7XHJcbiAgLy8gSGFsZi1vcGVuICh0aWNrIC0gZHVyLCB0aWNrXSwgbWF0Y2hpbmcgZmVhdHVyZUluV2luZG93IG9uIHRoZSBDUFUgc2lkZSAtLSBBTkRlZCB3aXRoXHJcbiAgLy8gdGhlIHBvaW50J3MgbGF5ZXIgYmVpbmcgdmlzaWJsZS4gTGF5ZXIgdG9nZ2xlcyBhcmUgb25lIHVuaWZvcm0gZWxlbWVudCwgbm90IGFcclxuICAvLyByZWJ1aWxkOiB1bmNoZWNraW5nIG9uZSBvZiAyNSB0cmFja3MgdXNlZCB0byByZS1mZWVkIGFsbCA1TSBwb2ludHMgdGhyb3VnaCBKUy5cclxuICBib29sIHZpc2libGUgPSBhVGltZVNwYW4ueSA+ICh1VGljayAtIGR1cikgJiYgYVRpbWVTcGFuLnggPD0gdVRpY2tcclxuICAgICAgJiYgdUxheWVyVmlzW2ludChhTGF5ZXIpXSA+IDAuNTtcclxuICBnbF9Qb2ludFNpemUgPSB2aXNpYmxlID8gcG9pbnRTaXplIDogMC4wO1xyXG4gIGdsX1Bvc2l0aW9uID0gdmlzaWJsZSA/IG1hdHJpeCAqIHZlcnRleCA6IHZlYzQoMi4wLCAyLjAsIDIuMCwgMS4wKTtcclxuICAvLyBBZ2UgcnVucyBmcm9tIHRoZSBmZWF0dXJlJ3MgZW5kOyBuZXdlc3QgaXMgb3BhcXVlLCB0aGUgdHJhaWxpbmcgZWRnZSByZWFjaGVzIHplcm8uXHJcbiAgZmxvYXQgYWxwaGEgPSBmYWRlcyA/IGNsYW1wKDEuMCAtICh1VGljayAtIGFUaW1lU3Bhbi55KSAvIGR1ciwgMC4wLCAxLjApIDogMS4wO1xyXG4gIF9jb2xvciA9IHZlYzQoY29sb3IucmdiLCBjb2xvci5hICogYWxwaGEpO1xyXG59XHJcbmA7XHJcbn1cclxuXHJcbi8vIFBlci1sYXllciBkdXJhdGlvbiBpbiBzZWNvbmRzOiBudWxsIGFjY3VtdWxhdGVzLCBcInBlcmlvZFwiIGlzIHRoZSBzaGFyZWQgaW50ZXJ2YWwsXHJcbi8vIGFuIElTTyBzdHJpbmcgaXMgaXRzZWxmOyBhbnl0aGluZyB1bnBhcnNlYWJsZSBmYWxscyBiYWNrIHRvIHRoZSBpbnRlcnZhbC5cclxuZnVuY3Rpb24gZHVyYXRpb25TZWNvbmRzKHNwZWMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoc3BlYyA9PT0gbnVsbCB8fCBzcGVjID09PSB1bmRlZmluZWQpIHJldHVybiBBTFdBWVM7XHJcbiAgICBpZiAoc3BlYyA9PT0gXCJwZXJpb2RcIikgcmV0dXJuIChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XHJcbiAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xyXG4gICAgcmV0dXJuIG1zID8gbXMgLyAxMDAwIDogKHBlcmlvZE1zIHx8IDI0ICogMzYwMCAqIDEwMDApIC8gMTAwMDtcclxufVxyXG5cclxuLy8gQnVpbGRzIHRoZSBwZXItcG9pbnQgYXR0cmlidXRlIGFycmF5cyBmb3Igb25lIG1lcmdlZCBidWNrZXQsIGluIHRoZSBleGFjdCBvcmRlciB0aGVcclxuLy8gYnVja2V0IGZlZWRzIHBvaW50cyB0byBnbGlmeTogbGF5ZXIgYnkgbGF5ZXIsIGluZGV4IDAuLm4tMSwgd2l0aCBzaW5nbGUtYGxvY2F0aW9uYFxyXG4vLyBsYXllcnMgY29udHJpYnV0aW5nIG9uZSBwb2ludC4gUG9pbnRzIGluIGxheWVycyB3aXRob3V0IHRpbWUgbWV0YWRhdGEgLS0gYW5kIHBvaW50c1xyXG4vLyB3aG9zZSB0aW1lIHdhcyB1bnJlYWRhYmxlIChOYU4pIC0tIGdldCBhIHNwYW4gdGhhdCBpcyB2aXNpYmxlIGF0IGV2ZXJ5IHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGxldCBoYXNUaW1lID0gZmFsc2U7XHJcbiAgICBjb25zdCBwZXJMYXllciA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgIGNvbnN0IGNvdW50ID0gYnVmID8gYnVmLmJ5dGVMZW5ndGggLyAxNiA6IChsYXllci5sb2NhdGlvbiA/IDEgOiAwKTtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBpZiAobGF5ZXIudGltZSkgaGFzVGltZSA9IHRydWU7XHJcbiAgICAgICAgcGVyTGF5ZXIucHVzaCh7IGxheWVyLCBjb3VudCwgdGltZXMgfSk7XHJcbiAgICAgICAgdG90YWwgKz0gY291bnQ7XHJcbiAgICB9XHJcbiAgICBpZiAoIWhhc1RpbWUpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcblxyXG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcclxuICAgIGZvciAoY29uc3QgeyB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBjb25zdCBsYXllcklkcyA9IFtdO1xyXG4gICAgbGV0IG91dCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHsgbGF5ZXIsIGNvdW50LCB0aW1lcyB9IG9mIHBlckxheWVyKSB7XHJcbiAgICAgICAgY29uc3QgaWR4ID0gbGF5ZXJJZHMubGVuZ3RoO1xyXG4gICAgICAgIGxheWVySWRzLnB1c2gobGF5ZXIuaWQpO1xyXG4gICAgICAgIGNvbnN0IGR1ciA9IGxheWVyLnRpbWUgPyBkdXJhdGlvblNlY29uZHMobGF5ZXIudGltZS5kdXJhdGlvbiwgcGVyaW9kTXMpIDogQUxXQVlTO1xyXG4gICAgICAgIC8vIFRoZSBmYWRlIGZsYWcgcmlkZXMgdGhlIGR1cmF0aW9uJ3Mgc2lnbiwgc28gaXQgY29zdHMgbm8gZXh0cmEgYXR0cmlidXRlLlxyXG4gICAgICAgIC8vIFRpbWVsZXNzIChOYU4pIHBvaW50cyBrZWVwIGEgcG9zaXRpdmUgZHVyYXRpb246IHdpdGggbm8gYWdlLCBub3RoaW5nIHRvIGZhZGUuXHJcbiAgICAgICAgY29uc3Qgc2lnbmVkRHVyID0gbGF5ZXIudGltZSAmJiBsYXllci50aW1lLmZhZGUgPyAtZHVyIDogZHVyO1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IHRpbWVzID8gdGltZXNbaSAqIDJdIDogTmFOO1xyXG4gICAgICAgICAgICBjb25zdCBlbmQgPSB0aW1lcyA/IHRpbWVzW2kgKiAyICsgMV0gOiBOYU47XHJcbiAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpKSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IC1BTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyICsgMV0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBBTFdBWVM7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IChzdGFydCAtIGJhc2UpIC8gMTAwMDtcclxuICAgICAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IChlbmQgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBzaWduZWREdXI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGlkeDtcclxuICAgICAgICAgICAgb3V0Kys7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgc3BhbnMsIGR1cnMsIGxheWVySWR4LCBsYXllcklkcywgY291bnQ6IHRvdGFsIH07XHJcbn1cclxuXHJcbi8vIFBlci1mZWF0dXJlIHRpbWUgbWV0YWRhdGEgZm9yIGEgdmVjdG9yIGJ1Y2tldCAobGluZXMvcG9seWdvbnMpLiBTYW1lIGVuY29kaW5ncyBhc1xyXG4vLyB0aGUgcG9pbnQgcGF0aCAtLSByZWJhc2VkIGZsb2F0MzIgc2Vjb25kcywgc2lnbi1wYWNrZWQgZmFkZSwgYWx3YXlzLXZpc2libGUgc3BhbnNcclxuLy8gZm9yIHRpbWVsZXNzIG9yIG5vbi10aW1lIGxheWVycy5cclxuLy9cclxuLy8gQSBwb2x5bGluZSB3aG9zZSA6OnRpbWVzIGJ1ZmZlciBob2xkcyBvbmUgW3N0YXJ0LCBlbmRdIHBhaXIgUEVSIFZFUlRFWCBhbmltYXRlc1xyXG4vLyBwZXIgc2VnbWVudCB3aXRoaW4gb25lIGxheWVyOiBzZWdtZW50IGsgc3BhbnMgdmVydGV4IGsncyBzdGFydCB0byB2ZXJ0ZXggaysxJ3NcclxuLy8gZW5kLCBhbmQgYmVjYXVzZSBnbGlmeSBidWlsZHMgMiBkZWRpY2F0ZWQgR0wgdmVydGljZXMgcGVyIHNlZ21lbnQgLS0gc2VnbWVudHNcclxuLy8gbmV2ZXIgc2hhcmUgdmVydGljZXMgLS0gYm90aCBlbmRwb2ludHMgY2FycnkgdGhlIHNhbWUgc3BhbiBhbmQgc2VnbWVudHMgYXBwZWFyXHJcbi8vIGF0b21pY2FsbHkuIFRoYXQgaXMgd2hhdCBsZXRzIGEgd2hvbGUgc2VnbWVudGVkIHRyYWNrIHJpZGUgT05FIGxheWVyIHNsb3QgdGhlIHdheVxyXG4vLyBhIDIwMGstcG9pbnQgbGF5ZXIgZG9lcywgaW5zdGVhZCBvZiBvbmUgc2xvdCBwZXIgY2h1bmsgYWdhaW5zdCB0aGUgNjQgY2VpbGluZy5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHBlcmlvZE1zKSB7XHJcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XHJcbiAgICAgICAgaWYgKCF0aW1lcykgY29udGludWU7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcclxuXHJcbiAgICBjb25zdCBwZXJGZWF0dXJlID0gbGF5ZXJzTGlzdC5tYXAoKGxheWVyLCBpZHgpID0+IHtcclxuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcclxuICAgICAgICBjb25zdCBzaWduZWREdXIgPSBsYXllci50aW1lICYmIGxheWVyLnRpbWUuZmFkZSA/IC1kdXIgOiBkdXI7XHJcbiAgICAgICAgaWYgKCF0aW1lcyB8fCAodGltZXMubGVuZ3RoID09PSAyICYmIE51bWJlci5pc05hTih0aW1lc1swXSkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiAtQUxXQVlTLCBlbmQ6IEFMV0FZUywgZHVyOiBBTFdBWVMsIGlkeCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBuVmVydHMgPSB2ZXJ0ZXhDb3VudE9mKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIiAmJiB0aW1lcy5sZW5ndGggPiAyXHJcbiAgICAgICAgICAgICAgICAmJiB0aW1lcy5sZW5ndGggPT09IG5WZXJ0cyAqIDIpIHtcclxuICAgICAgICAgICAgLy8gU2VnbWVudHMgbmV2ZXIgY3Jvc3MgYSBwYXJ0IGJvdW5kYXJ5OiBhIG11bHRpLXBhcnQgbGluZSBkcmF3c1xyXG4gICAgICAgICAgICAvLyBuVmVydHMgLSBwYXJ0cyBzZWdtZW50cywgYW5kIGEgc3BhbiBidWlsdCBmcm9tIG9uZSBwYXJ0J3MgbGFzdFxyXG4gICAgICAgICAgICAvLyB2ZXJ0ZXggdG8gdGhlIG5leHQgcGFydCdzIGZpcnN0IHdvdWxkIGJlIHRoZSBwaGFudG9tIHNlZ21lbnRcclxuICAgICAgICAgICAgLy8gcmVhcHBlYXJpbmcgaW4gdGhlIHRpbWUgcGF0aCAtLSBvbmUgZXh0cmEgc3BhbiwgYW5kIGV2ZXJ5IGF0dHJpYnV0ZVxyXG4gICAgICAgICAgICAvLyBhZnRlciBpdCBzaGVhcnMgKHRoZSBsZW5ndGggY2hlY2sgdGhlbiBkcm9wcyB0aGUgd2hvbGUgZmVhdHVyZSB0b1xyXG4gICAgICAgICAgICAvLyBpdHMgb3ZlcmFsbCBzcGFuKS4gV2FsayB0aGUgcGFydHMgdGhlIHdheSB0aGUgcmVuZGVyZXIgZHJhd3MgdGhlbS5cclxuICAgICAgICAgICAgY29uc3QgbGVuZ3RocyA9IEFycmF5LmlzQXJyYXkobGF5ZXIucGFydHMpICYmIGxheWVyLnBhcnRzLmxlbmd0aCA+IDFcclxuICAgICAgICAgICAgICAgID8gbGF5ZXIucGFydHMgOiBbblZlcnRzXTtcclxuICAgICAgICAgICAgY29uc3Qgc2VncyA9IGxlbmd0aHMucmVkdWNlKChhLCBuKSA9PiBhICsgTWF0aC5tYXgoMCwgbiAtIDEpLCAwKTtcclxuICAgICAgICAgICAgY29uc3Qgc2VnID0gbmV3IEZsb2F0NjRBcnJheShzZWdzICogMik7XHJcbiAgICAgICAgICAgIGxldCBrID0gMCwgb2Zmc2V0ID0gMDtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBuIG9mIGxlbmd0aHMpIHtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGogPSAwOyBqICsgMSA8IG47IGorKykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHMgPSB0aW1lc1sob2Zmc2V0ICsgaikgKiAyXTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBlID0gdGltZXNbKG9mZnNldCArIGogKyAxKSAqIDIgKyAxXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHMpIHx8IE51bWJlci5pc05hTihlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gLUFMV0FZUzsgICAgICAvLyBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDIgKyAxXSA9IEFMV0FZUztcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWdbayAqIDJdID0gKHMgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlZ1trICogMiArIDFdID0gKGUgLSBiYXNlKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGsrKztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG9mZnNldCArPSBuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIE92ZXJhbGwgc3BhbiByaWRlcyBhbG9uZyBhcyB0aGUgZmFsbGJhY2sgaWYgY291bnRzIGV2ZXIgbWlzYWxpZ24uXHJcbiAgICAgICAgICAgIHJldHVybiB7IHNlZywgc3RhcnQ6IHNlZ1swXSwgZW5kOiBzZWdbc2VnLmxlbmd0aCAtIDFdLFxyXG4gICAgICAgICAgICAgICAgICAgICBkdXI6IHNpZ25lZER1ciwgaWR4IH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAodGltZXNbMF0gLSBiYXNlKSAvIDEwMDAsIGVuZDogKHRpbWVzWzFdIC0gYmFzZSkgLyAxMDAwLFxyXG4gICAgICAgICAgICAgICAgIGR1cjogc2lnbmVkRHVyLCBpZHggfTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgcGVyRmVhdHVyZSwgbGF5ZXJJZHM6IGxheWVyc0xpc3QubWFwKGwgPT4gbC5pZCkgfTtcclxufVxyXG5cclxuLy8gQSB2ZWN0b3IgbGF5ZXIncyB2ZXJ0ZXggY291bnQgZnJvbSB3aGljaGV2ZXIgdHJhbnNwb3J0IGNhcnJpZXMgaXRzIGNvb3JkaW5hdGVzOlxyXG4vLyB0aGUgYmluYXJ5IGJ1ZmZlciAoMiBmbG9hdDY0IHBlciB2ZXJ0ZXgpIG9yIGlubGluZSBgbG9jYXRpb25zYC5cclxuZnVuY3Rpb24gdmVydGV4Q291bnRPZihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmIChyYXcpIHJldHVybiAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCB8fCAwKSAvIDE2O1xyXG4gICAgcmV0dXJuIChsYXllci5sb2NhdGlvbnMgfHwgW10pLmxlbmd0aDtcclxufVxyXG5cclxuLy8gRXhwYW5kcyBwZXItZmVhdHVyZSB2YWx1ZXMgdG8gcGVyLUdMLXZlcnRleCBhcnJheXMgZ2l2ZW4gZWFjaCBmZWF0dXJlJ3MgdmVydGV4IGNvdW50LlxyXG4vLyBQdXJlLCBzbyB0aGUgYWxpZ25tZW50IGxvZ2ljIGlzIHRpZXItMSB0ZXN0YWJsZSBhd2F5IGZyb20gYW55IEdMIGNvbnRleHQuXHJcbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQZXJGZWF0dXJlKHBlckZlYXR1cmUsIGNvdW50cykge1xyXG4gICAgbGV0IHRvdGFsID0gMDtcclxuICAgIGZvciAoY29uc3QgYyBvZiBjb3VudHMpIHRvdGFsICs9IGM7XHJcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcclxuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcclxuICAgIGNvbnN0IGxheWVySWR4ID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XHJcbiAgICBsZXQgb3V0ID0gMDtcclxuICAgIHBlckZlYXR1cmUuZm9yRWFjaCgoZiwgaSkgPT4ge1xyXG4gICAgICAgIC8vIFBlci1zZWdtZW50IHNwYW5zOiBHTCB2ZXJ0ZXggdiBiZWxvbmdzIHRvIHNlZ21lbnQgdiA+PiAxIChnbGlmeSBkcmF3c1xyXG4gICAgICAgIC8vIDIgZGVkaWNhdGVkIHZlcnRpY2VzIHBlciBzZWdtZW50KSwgc28gYm90aCBlbmRwb2ludHMgdGFrZSB0aGUgc2VnbWVudCdzXHJcbiAgICAgICAgLy8gc3BhbiBhbmQgYSBzZWdtZW50IGFwcGVhcnMgb3IgZGlzYXBwZWFycyBhdG9taWNhbGx5LiBzZWcgaG9sZHMgc2VncyoyXHJcbiAgICAgICAgLy8gZmxvYXRzIGFuZCB0aGUgZmVhdHVyZSBkcmF3cyBzZWdzKjIgR0wgdmVydGljZXMsIHNvIHRoZSBsZW5ndGhzIGFncmVlaW5nXHJcbiAgICAgICAgLy8gaXMgdGhlIGFsaWdubWVudCBjaGVjazsgYSBtaXNtYXRjaCBmYWxscyBiYWNrIHRvIHRoZSB3aG9sZS1mZWF0dXJlIHNwYW5cclxuICAgICAgICAvLyByYXRoZXIgdGhhbiBzaGVhcmluZyBldmVyeSBhdHRyaWJ1dGUgYWZ0ZXIgaXQuXHJcbiAgICAgICAgY29uc3QgcGVyU2VnbWVudCA9IGYuc2VnICYmIGYuc2VnLmxlbmd0aCA9PT0gY291bnRzW2ldID8gZi5zZWcgOiBudWxsO1xyXG4gICAgICAgIGZvciAobGV0IHYgPSAwOyB2IDwgY291bnRzW2ldOyB2KyspIHtcclxuICAgICAgICAgICAgY29uc3QgayA9IHBlclNlZ21lbnQgPyAodiA+PiAxKSAqIDIgOiAtMTtcclxuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBwZXJTZWdtZW50ID8gcGVyU2VnbWVudFtrXSA6IGYuc3RhcnQ7XHJcbiAgICAgICAgICAgIHNwYW5zW291dCAqIDIgKyAxXSA9IHBlclNlZ21lbnQgPyBwZXJTZWdtZW50W2sgKyAxXSA6IGYuZW5kO1xyXG4gICAgICAgICAgICBkdXJzW291dF0gPSBmLmR1cjtcclxuICAgICAgICAgICAgbGF5ZXJJZHhbb3V0XSA9IGYuaWR4O1xyXG4gICAgICAgICAgICBvdXQrKztcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB7IHNwYW5zLCBkdXJzLCBsYXllcklkeCB9O1xyXG59XHJcblxyXG4vLyBnbGlmeSdzIHZlcnRleCBsYXlvdXQ6IDYgZmxvYXRzIHBlciBHTCB2ZXJ0ZXggKHgsIHksIHIsIGcsIGIsIGEpLCBjb25maXJtZWQgZm9yIDMuMy4wXHJcbi8vIGJvdGggYnkgcmVhZGluZyB0aGUgc291cmNlIGFuZCBieSB0aGUgVmFsaGFsbGEtVlJFIHJlcG9ydCdzIGRlYnVnIGR1bXAgLS0gdHdvXHJcbi8vIG9uZS1zZWdtZW50IGxpbmVzIHByb2R1Y2VkIGFsbFZlcnRpY2VzVHlwZWQgb2YgMjQgZmxvYXRzOiAyIGZlYXR1cmVzIHggMiB2ZXJ0aWNlcyB4IDYuXHJcbmNvbnN0IEZMT0FUU19QRVJfVkVSVEVYID0gNjtcclxuXHJcbi8vIFdpcmVzIHRpbWUgKyBsYXllci12aXNpYmlsaXR5IGludG8gYSBsaXZlIGdsaWZ5IExJTkVTIG9yIFNIQVBFUyBpbnN0YW5jZS4gVGhlIGNhbGxlclxyXG4vLyBzdXBwbGllcyBwZXItZmVhdHVyZSBHTC12ZXJ0ZXggY291bnRzIGNvbXB1dGVkIGZyb20gdGhlIGdlb21ldHJ5IGl0IGJ1aWx0IGl0c2VsZjpcclxuLy8gbGluZXMgZHJhdyAyKihwb2ludHMtMSkgdmVydGljZXMgcGVyIGZlYXR1cmUsIGFuZCBhbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHNpbXBsZSByaW5nXHJcbi8vIGhhcyBleGFjdGx5IG4tMiB0cmlhbmdsZXMgLS0gYSBwcm9wZXJ0eSBvZiBnZW9tZXRyeSwgbm90IG9mIGdsaWZ5J3MgZWFyY3V0LiBUaGUgY291bnRzXHJcbi8vIGFyZSB2YWxpZGF0ZWQgYWdhaW5zdCB0aGUgaW5zdGFuY2UncyBhY3R1YWwgYnVmZmVyIGxlbmd0aCwgYW5kIGFueSBtaXNtYXRjaCBkaXNhYmxlc1xyXG4vLyB0aGUgdmVjdG9yIEdQVSBwYXRoIHJhdGhlciB0aGFuIG1pcy1hbGlnbmluZyBhdHRyaWJ1dGVzLlxyXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UoaW5zdGFuY2UsIG1ldGEsIGNvdW50cykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY291bnRzKSB8fCBjb3VudHMubGVuZ3RoICE9PSBtZXRhLnBlckZlYXR1cmUubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgZXhwZWN0ZWQgJHttZXRhLnBlckZlYXR1cmUubGVuZ3RofSB2ZXJ0ZXggY291bnRzLCBgICtcclxuICAgICAgICAgICAgICAgIGBnb3QgJHtjb3VudHMgJiYgY291bnRzLmxlbmd0aH1gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgZXhwZWN0ZWQgPSBjb3VudHMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgKiBGTE9BVFNfUEVSX1ZFUlRFWDtcclxuICAgICAgICAvLyBMaW5lcyBrZWVwIGEgdHlwZWQgZmxhdCBidWZmZXI7IHNoYXBlcyBrZWVwIGEgcGxhaW4gZmxhdCBhcnJheS4gRWl0aGVyIGlzIHRoZVxyXG4gICAgICAgIC8vIGdyb3VuZCB0cnV0aCBmb3IgaG93IG1hbnkgR0wgdmVydGljZXMgZ2xpZnkgYWN0dWFsbHkgYnVpbHQuXHJcbiAgICAgICAgY29uc3QgYWN0dWFsID0gaW5zdGFuY2UuYWxsVmVydGljZXNUeXBlZCA/IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQubGVuZ3RoXHJcbiAgICAgICAgICAgIDogKEFycmF5LmlzQXJyYXkoaW5zdGFuY2UudmVydGljZXMpID8gaW5zdGFuY2UudmVydGljZXMubGVuZ3RoIDogLTEpO1xyXG4gICAgICAgIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4IGNvdW50IG1pc21hdGNoOiBnZW9tZXRyeSBzYXlzICR7ZXhwZWN0ZWR9IGZsb2F0cywgYCArXHJcbiAgICAgICAgICAgICAgICBgdGhlIGluc3RhbmNlIGhvbGRzICR7YWN0dWFsfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBhdHRycyA9IGV4cGFuZFBlckZlYXR1cmUobWV0YS5wZXJGZWF0dXJlLCBjb3VudHMpO1xyXG4gICAgICAgIGF0dHJzLmJhc2UgPSBtZXRhLmJhc2U7XHJcbiAgICAgICAgYXR0cnMubGF5ZXJJZHMgPSBtZXRhLmxheWVySWRzO1xyXG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGRpc2FibGVWZWN0b3JHcHUoZXJyLm1lc3NhZ2UpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBXaXJlcyB0aGUgYXR0cmlidXRlIGJ1ZmZlcnMgYW5kIHVuaWZvcm1zIGludG8gYSBsaXZlIGdsaWZ5IHBvaW50cyBpbnN0YW5jZS4gUmV0dXJucyBhXHJcbi8vIGhhbmRsZSB3aG9zZSBzZXRXaW5kb3cgY29zdHMgdHdvIHVuaWZvcm1zIGFuZCBhIHJlZHJhdywgb3IgbnVsbCBpZiBhbnl0aGluZyBhYm91dCB0aGVcclxuLy8gaW5zdGFuY2UgaXMgbm90IHdoZXJlIGdsaWZ5IDMuMy4wIGtlZXBzIGl0IC0tIGluIHdoaWNoIGNhc2UgR1BVIHRpbWUgaXMgZGlzYWJsZWQgYW5kXHJcbi8vIHRoZSBjYWxsZXIncyByZWJ1aWxkIHBhdGggdGFrZXMgb3Zlci5cclxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb0luc3RhbmNlKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycyk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICBkaXNhYmxlR3B1VGltZShlcnIubWVzc2FnZSk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFRoZSBjb21tb24gR0wgd2lyaW5nOiBidWZmZXJzIGZvciBzcGFuL2R1cmF0aW9uL2xheWVyIGF0dHJpYnV0ZXMsIHVuaWZvcm1zIGZvciB0aGVcclxuLy8gdGljaywgdGhlIHNoYXJlZCBvdmVycmlkZSBhbmQgdGhlIHBlci1sYXllciB2aXNpYmlsaXR5IHNsb3RzLiBUaHJvd3Mgb24gYW55dGhpbmdcclxuLy8gdW5leHBlY3RlZDsgdGhlIGNhbGxlcnMgZGVjaWRlIHdoaWNoIGZhbGxiYWNrIGZsYWcgdGhhdCBmbGlwcy5cclxuZnVuY3Rpb24gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycykge1xyXG4gICAge1xyXG4gICAgICAgIGNvbnN0IGdsID0gaW5zdGFuY2UuZ2w7XHJcbiAgICAgICAgY29uc3QgcHJvZ3JhbSA9IGluc3RhbmNlLnByb2dyYW07XHJcbiAgICAgICAgY29uc3QgbGF5ZXIgPSBpbnN0YW5jZS5sYXllcjtcclxuICAgICAgICBpZiAoIWdsIHx8ICFwcm9ncmFtIHx8ICFsYXllcikgdGhyb3cgbmV3IEVycm9yKFwiaW5zdGFuY2UgbGFja3MgZ2wvcHJvZ3JhbS9sYXllclwiKTtcclxuXHJcbiAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3BhbkxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYVRpbWVTcGFuXCIpO1xyXG4gICAgICAgIGNvbnN0IGR1ckxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYUR1cmF0aW9uXCIpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyTG9jID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgXCJhTGF5ZXJcIik7XHJcbiAgICAgICAgY29uc3QgdGlja0xvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVUaWNrXCIpO1xyXG4gICAgICAgIGNvbnN0IG92ZXJyaWRlTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidU92ZXJyaWRlXCIpO1xyXG4gICAgICAgIC8vIFNvbWUgZHJpdmVycyBuYW1lIHRoZSBhcnJheSBoZWFkIFwidUxheWVyVmlzWzBdXCI7IGFjY2VwdCBlaXRoZXIuXHJcbiAgICAgICAgY29uc3QgdmlzTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzXCIpXHJcbiAgICAgICAgICAgIHx8IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVMYXllclZpc1swXVwiKTtcclxuICAgICAgICBpZiAoc3BhbkxvYyA8IDAgfHwgZHVyTG9jIDwgMCB8fCBsYXllckxvYyA8IDAgfHwgIXRpY2tMb2MgfHwgIW92ZXJyaWRlTG9jIHx8ICF2aXNMb2MpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidGltZSBhdHRyaWJ1dGVzL3VuaWZvcm1zIG1pc3NpbmcgZnJvbSB0aGUgbGlua2VkIHByb2dyYW1cIik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBzcGFuQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHNwYW5CdWYpO1xyXG4gICAgICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLCBhdHRycy5zcGFucywgZ2wuU1RBVElDX0RSQVcpO1xyXG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoc3BhbkxvYywgMiwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShzcGFuTG9jKTtcclxuXHJcbiAgICAgICAgY29uc3QgZHVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XHJcbiAgICAgICAgZ2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIGR1ckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmR1cnMsIGdsLlNUQVRJQ19EUkFXKTtcclxuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGR1ckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShkdXJMb2MpO1xyXG5cclxuICAgICAgICBjb25zdCBsYXllckJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xyXG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBsYXllckJ1Zik7XHJcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLmxheWVySWR4LCBnbC5TVEFUSUNfRFJBVyk7XHJcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihsYXllckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcclxuICAgICAgICBnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShsYXllckxvYyk7XHJcblxyXG4gICAgICAgIC8vIFVudGlsIHRoZSBzbGlkZXIgc2F5cyBvdGhlcndpc2UsIGV2ZXJ5dGhpbmcgaXMgdmlzaWJsZSAtLSBpbiB0aW1lIEFORCBsYXllci5cclxuICAgICAgICBnbC51bmlmb3JtMWYodGlja0xvYywgQUxXQVlTKTtcclxuICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIC0xKTtcclxuICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKSk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIGxheWVySWRzOiBhdHRycy5sYXllcklkcyxcclxuICAgICAgICAgICAgLy8gdGlja01zIGluIGVwb2NoIG1zOyBvdmVycmlkZU1zIGEgc2hhcmVkLXdpbmRvdyB3aWR0aCBvciBudWxsLlxyXG4gICAgICAgICAgICBzZXRXaW5kb3codGlja01zLCBvdmVycmlkZU1zKSB7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIHRpY2tNcyA9PT0gbnVsbCA/IEFMV0FZUyA6ICh0aWNrTXMgLSBhdHRycy5iYXNlKSAvIDEwMDApO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmKG92ZXJyaWRlTG9jLCBvdmVycmlkZU1zID09PSBudWxsID8gLTEgOiBvdmVycmlkZU1zIC8gMTAwMCk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gT25lIGZsb2F0IHBlciBsYXllciBzbG90LCBpbiBhdHRycy5sYXllcklkcyBvcmRlci4gQSBzaWRlYmFyIHRvZ2dsZSBsYW5kc1xyXG4gICAgICAgICAgICAvLyBoZXJlIGluc3RlYWQgb2YgcmVidWlsZGluZyB0aGUgYnVja2V0LlxyXG4gICAgICAgICAgICBzZXRMYXllclZpc2liaWxpdHkodmlzQXJyYXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IG5ldyBGbG9hdDMyQXJyYXkoTEFZRVJfU0xPVFMpLmZpbGwoMSk7XHJcbiAgICAgICAgICAgICAgICB2aXMuc2V0KHZpc0FycmF5LnNsaWNlKDAsIExBWUVSX1NMT1RTKSk7XHJcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG4gICAgICAgICAgICAgICAgZ2wudW5pZm9ybTFmdih2aXNMb2MsIHZpcyk7XHJcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkSlMsIGJpbmRQb3B1cCwgYmluZFRvb2x0aXAsIHBhcnNlQ29sb3IgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XHJcbmltcG9ydCB7IHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LCB0aW1lc0ZvciwgbGF5ZXJJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sXHJcbiAgICAgICAgIHBlcmlvZFRvTXMgfSBmcm9tIFwiLi90aW1lY29udHJvbC5qc1wiO1xyXG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcclxuICAgICAgICAgZ3B1VGltZUF2YWlsYWJsZSwgYnVpbGRWZWN0b3JUaW1lTWV0YSwgYXR0YWNoVGltZVRvVmVjdG9ySW5zdGFuY2UgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XHJcbiAgICBpZiAoZ2xJbnN0YW5jZSAmJiBnbEluc3RhbmNlLmxheWVyKSB7XHJcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XHJcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XHJcbiAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcclxuICAgIH1cclxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xyXG4gICAgaWYgKCFtYXAuX2NsaWNrVGltZW91dCkge1xyXG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcclxuICAgICAgICAgICAgLy8gV2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZCAodGhlIHdpZGdldCdzIGNsaWNrIGhhbmRsZXIgc3RhbXBzIHRoaXNcclxuICAgICAgICAgICAgLy8gcGVyIGNsaWNrLCBiZWZvcmUgYW55IGZlYXR1cmUgaGFuZGxlciBydW5zKSwgRVZFUlkgbWF0Y2ggc3RhbmRzIGRvd246XHJcbiAgICAgICAgICAgIC8vIGEgY2xpY2sgaW4gcmVtb3ZhbCBtb2RlIGlzIGEgZGVsZXRpb24gYXR0ZW1wdCwgYW5kIGFuc3dlcmluZyBpdCB3aXRoXHJcbiAgICAgICAgICAgIC8vIGEgZmVhdHVyZSBwb3B1cCBvciBhIGNvb3JkcyByZWFkb3V0IHJlYWRzIGFzIFwicmVtb3ZlIGlzIGJyb2tlblwiLlxyXG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCAmJiAhbWFwLl9wbU1vZGVBY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XHJcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgcHJpb3JpdHksIGFjdGlvbikge1xyXG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xyXG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XHJcbiAgICB9XHJcbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcclxuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcclxuICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XHJcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlc1swXS5hY3Rpb24oKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgICAgICBtYXAuX2hvdmVyVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgfSwgMCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xyXG4vLyB2YXJpZWQgc3R5bGluZywgb3RoZXJ3aXNlIHRoZSBsYXllcidzIHNpbmdsZSBzdHlsZS4gUHl0aG9uIG9ubHkgZW1pdHMgZmVhdHVyZV9zdHlsZXNcclxuLy8gd2hlbiBmZWF0dXJlcyBhY3R1YWxseSBkaWZmZXIsIHNvIGEgdW5pZm9ybSBsYXllciBjb3N0cyBub3RoaW5nIGV4dHJhIGhlcmUuXHJcbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxyXG4vLyB0aGFuIGVkaXRpbmcgdGhlIGxheWVyJ3Mgc3R5bGUsIHNvIGNsZWFyaW5nIGl0IHJlc3RvcmVzIHdoYXQgd2FzIHVuZGVybmVhdGggd2l0aFxyXG4vLyBub3RoaW5nIHRvIHJlbWVtYmVyIGFuZCBub3RoaW5nIHRvIHB1dCBiYWNrLlxyXG4vL1xyXG4vLyAgIHRoZSBsYXllcidzIG93biBzdHlsZSAgIHdoYXQgaXQgd2FzIGRyYXduIHdpdGhcclxuLy8gICBmZWF0dXJlX3N0eWxlc1tpXSAgICAgICBwZXIgZmVhdHVyZSwgZnJvbSB0aGUgZGF0YVxyXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxyXG4vLyAgIHN0eWxlX292ZXJyaWRlc1tpXSAgICAgIHRoaXMgZmVhdHVyZSBpcyBzZWxlY3RlZCAtLSBtb3N0IHNwZWNpZmljLCBzbyBpdCB3aW5zXHJcbmV4cG9ydCBmdW5jdGlvbiBzdHlsZUZvcihsYXllciwgaW5kZXgpIHtcclxuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xyXG4gICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlO1xyXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgJiYgbGF5ZXIuc3R5bGVfb3ZlcnJpZGVzW2luZGV4XTtcclxuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcclxuICAgIHJldHVybiB7IC4uLmxheWVyLCAuLi4oZnJvbURhdGEgfHwge30pLCAuLi4oaGlnaGxpZ2h0IHx8IHt9KSwgLi4uKHNlbGVjdGVkIHx8IHt9KSB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW5kZXhlZFByb3BlcnRpZXMocHJvcGVydGllcywgaW5kZXgpIHtcclxuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xyXG4gICAgY29uc3QgcHJvcHMgPSB7fTtcclxuICAgIE9iamVjdC5rZXlzKHByb3BlcnRpZXMpLmZvckVhY2goayA9PiB7XHJcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcclxuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwcm9wcztcclxufVxyXG5cclxuXHJcblxyXG4vLyBBbiBpbWFnZXJ5IG92ZXJsYXkncyBpZGVudGl0eTogZXZlcnl0aGluZyB0aGUgcmVuZGVyZWQgZWxlbWVudCBkZXJpdmVzIGZyb20gaXRzXHJcbi8vIGNvbmZpZy4gVGhlIHN5bmMgbG9vcCByZWNyZWF0ZXMgdGhlIG92ZXJsYXkgd2hlbiB0aGlzIGNoYW5nZXMgKG9yIHdoZW4gdGhlXHJcbi8vIGJpbmFyeSBidWZmZXIgb2JqZWN0IHVuZGVyIHRoZSBsYXllciBpZCBpcyByZXBsYWNlZCksIHNpbmNlIGEgRE9NIGltYWdlIGlzIGFcclxuLy8gc2luZ2xlIGNoZWFwIG5vZGUgLS0gbm8gaW5jcmVtZW50YWwgdXBkYXRlIG1hY2hpbmVyeSBuZWVkZWQuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbWFnZU1ldGFLZXkobGF5ZXIpIHtcclxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShbbGF5ZXIudXJsIHx8IG51bGwsIGxheWVyLmJvdW5kcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXIub3BhY2l0eSA/PyAxLCBsYXllci5pbWFnZV9mb3JtYXQgfHwgbnVsbF0pO1xyXG59XHJcblxyXG4vLyBHZW9yZWZlcmVuY2VkIHBpeGVscyBwaW5uZWQgdG8gYSBsYXQvbG9uIGJveC4gVGhlIGNvbmZpZyBpcyBwdXJlIGRhdGEgLS1cclxuLy8ge3R5cGU6IFwiaW1hZ2VcIiwgYm91bmRzLCBvcGFjaXR5LCB1cmwgfCBieXRlcyB1bmRlciB0aGUgbGF5ZXIgaWR9IC0tIHNvIGFcclxuLy8gcGxhaW4tSlMgY29uc3VtZXIgcGFzc2VzIGEgVVJMIGFuZCB0aGUgd2lkZ2V0IHBhdGggc2hpcHMgYnl0ZXMgb3ZlciB0aGVcclxuLy8gYmluYXJ5IGJ1ZmZlciB0cmFuc3BvcnQuIFB5dGhvbiBoYXMgYWxyZWFkeSB3YXJwZWQgdGhlIHJhc3RlciBpbnRvIHRoZSBNQVAnc1xyXG4vLyBvd24gQ1JTIGdyaWQgKHJhc3RlcmlvIHNpZGUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIExlYWZsZXQncyBsaW5lYXIgY29ybmVyXHJcbi8vIHN0cmV0Y2ggZXhhY3RseSBjb3JyZWN0OyB0aGlzIHN0YXlzIGEgZHVtYiByZW5kZXJlci5cclxuZnVuY3Rpb24gcmVuZGVySW1hZ2VMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlcikge1xyXG4gICAgaWYgKCFsYXllci5ib3VuZHMpIHJldHVybiBudWxsO1xyXG4gICAgbGV0IHVybCA9IGxheWVyLnVybDtcclxuICAgIGxldCBvYmplY3RVcmwgPSBudWxsO1xyXG4gICAgaWYgKCF1cmwgJiYgY29vcmRCdWZmZXIpIHtcclxuICAgICAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2Nvb3JkQnVmZmVyXSxcclxuICAgICAgICAgICAgeyB0eXBlOiBsYXllci5pbWFnZV9mb3JtYXQgfHwgXCJpbWFnZS9wbmdcIiB9KTtcclxuICAgICAgICBvYmplY3RVcmwgPSB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgfVxyXG4gICAgaWYgKCF1cmwpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IEwuaW1hZ2VPdmVybGF5KHVybCwgbGF5ZXIuYm91bmRzLCB7XHJcbiAgICAgICAgb3BhY2l0eTogbGF5ZXIub3BhY2l0eSA/PyAxLFxyXG4gICAgICAgIC8vIENvbnRleHQsIG5vdCBhIGNsaWNrIHRhcmdldDogY2xpY2tzIGZhbGwgdGhyb3VnaCB0byBmZWF0dXJlcyBhbmQgdGhlXHJcbiAgICAgICAgLy8gZW1wdHktbWFwIGNvb3JkaW5hdGUgZmFsbGJhY2suIFRoZSBkZWZhdWx0IG92ZXJsYXlQYW5lICh6IDQwMClcclxuICAgICAgICAvLyBhbHJlYWR5IHNpdHMgYWJvdmUgdGlsZXMgKDIwMCkgYW5kIGJlbG93IHRoZSBHTCBwYW5lcyAoNDEwKykuXHJcbiAgICAgICAgaW50ZXJhY3RpdmU6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAob2JqZWN0VXJsKSB7XHJcbiAgICAgICAgb3ZlcmxheS5vbihcInJlbW92ZVwiLCAoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKG9iamVjdFVybCkpO1xyXG4gICAgfVxyXG4gICAgb3ZlcmxheS5hZGRUbyhtYXApO1xyXG4gICAgb3ZlcmxheS5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgb3ZlcmxheS5pbWFnZU1ldGEgPSBpbWFnZU1ldGFLZXkobGF5ZXIpO1xyXG4gICAgb3ZlcmxheS5pbWFnZVNvdXJjZSA9IGNvb3JkQnVmZmVyIHx8IG51bGw7XHJcbiAgICByZXR1cm4gb3ZlcmxheTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyLCBtb2RlbCkge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiaW1hZ2VcIikge1xyXG4gICAgICAgIHJldHVybiByZW5kZXJJbWFnZUxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyKTtcclxuICAgIH1cclxuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICBjb25zdCBncm91cCA9IEwubGF5ZXJHcm91cCgpO1xyXG4gICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9O1xyXG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xyXG4gICAgICAgICAgICBpZiAoc3ViLnR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJtYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWxpbmVcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgc3ViLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgcmVuZGVyTGF5ZXIobWFwLCBzdWIsIGNvb3JkaW5hdGVCdWZmZXJzW3N1Yi5pZF0sIG1vZGVsKTtcclxuICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XHJcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcclxuICAgICAgICBncm91cC5sYXllclR5cGUgPSBsYXllci50eXBlO1xyXG4gICAgICAgIHJldHVybiBncm91cDtcclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBBIHZlY3RvciBsYXllcidzIGNvb3JkaW5hdGVzOiB0aGUgYmluYXJ5IGJ1ZmZlciB1bmRlciBpdHMgaWQgd2hlbiBQeXRob24gYnVpbHQgaXRcclxuLy8gKHRoZSBsYXllcnMgSlNPTiB0aGVuIGNhcnJpZXMgbm8gY29vcmRpbmF0ZXMgYXQgYWxsKSwgb3IgaW5saW5lIGBsb2NhdGlvbnNgIGZvclxyXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xyXG4vLyBvbiB0aGUgR1BVIHBhdGggcmFyZWx5IGRvLlxyXG5leHBvcnQgZnVuY3Rpb24gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLmxvY2F0aW9ucykgcmV0dXJuIGxheWVyLmxvY2F0aW9ucztcclxuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcclxuICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IGZsYXQgPSBuZXcgRmxvYXQ2NEFycmF5KHJhdy5idWZmZXIgfHwgcmF3LCByYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xyXG4gICAgY29uc3Qgb3V0ID0gbmV3IEFycmF5KGZsYXQubGVuZ3RoIC8gMik7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG91dC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG91dFtpXSA9IFtmbGF0W2kgKiAyXSwgZmxhdFtpICogMiArIDFdXTtcclxuICAgIH1cclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIEEgbGluZSBsYXllcidzIGNvb3JkaW5hdGVzIGFzIHBhcnRzOiB0aGUgZmxhdCBydW4gc2xpY2VkIGJ5IHRoZSBjb25maWcncyBgcGFydHNgXHJcbi8vIGxlbmd0aCB0YWJsZSwgb3Igb25lIHBhcnQgd2l0aG91dCBpdC4gQSBtdWx0aS1wYXJ0IGxpbmUgLS0gTVVMVElMSU5FU1RSSU5HLFxyXG4vLyBNdWx0aUxpbmVTdHJpbmcgLS0gaXMgT05FIGxheWVyIGRyYXduIGFzIGRpc2pvaW50IHJ1bnM7IG5vdGhpbmcgbWF5IGV2ZXIgZHJhdyBhXHJcbi8vIHNlZ21lbnQgZnJvbSBvbmUgcGFydCdzIGxhc3QgdmVydGV4IHRvIHRoZSBuZXh0IHBhcnQncyBmaXJzdC5cclxuZXhwb3J0IGZ1bmN0aW9uIGxpbmVQYXJ0cyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxlbmd0aHMgPSBBcnJheS5pc0FycmF5KGxheWVyLnBhcnRzKSAmJiBsYXllci5wYXJ0cy5sZW5ndGggPiAxID8gbGF5ZXIucGFydHMgOiBudWxsO1xyXG4gICAgaWYgKCFsZW5ndGhzKSByZXR1cm4gbG9jcy5sZW5ndGggPyBbbG9jc10gOiBbXTtcclxuICAgIGNvbnN0IHBhcnRzID0gW107XHJcbiAgICBsZXQgb2Zmc2V0ID0gMDtcclxuICAgIGZvciAoY29uc3QgbiBvZiBsZW5ndGhzKSB7XHJcbiAgICAgICAgY29uc3QgcGFydCA9IGxvY3Muc2xpY2Uob2Zmc2V0LCBvZmZzZXQgKyBuKTtcclxuICAgICAgICBvZmZzZXQgKz0gbjtcclxuICAgICAgICBpZiAocGFydC5sZW5ndGggPj0gMikgcGFydHMucHVzaChwYXJ0KTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuZnVuY3Rpb24gY2xvc2VSaW5nKHJpbmcpIHtcclxuICAgIGlmIChyaW5nLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBmaXJzdCA9IHJpbmdbMF07XHJcbiAgICAgICAgY29uc3QgbGFzdCA9IHJpbmdbcmluZy5sZW5ndGggLSAxXTtcclxuICAgICAgICBpZiAoZmlyc3RbMF0gIT09IGxhc3RbMF0gfHwgZmlyc3RbMV0gIT09IGxhc3RbMV0pIHtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmluZztcclxufVxyXG5cclxuLy8gZ2xpZnkncyBsaW5lIGhpdCB0b2xlcmFuY2UgaXMgYHNlbnNpdGl2aXR5ICsgd2VpZ2h0L3NjYWxlYCwgYW5kIHNlbnNpdGl2aXR5IGlzIGFcclxuLy8gQ09OU1RBTlQgaW4gbGF0bG5nIGRlZ3JlZXMgLS0gMC4xIGZvciBjbGlja3MgKH4xMSBrbSkgYW5kIDAuMDMgZm9yIGhvdmVycyxcclxuLy8gem9vbS1ibGluZCwgc28gYSBjbGljayB3aXRoaW4gc2lnaHQgb2YgYSBsaW5lIG1hdGNoZWQgaXQgYW5kIHN0YXJ2ZWQgdGhlXHJcbi8vIGVtcHR5LW1hcCBmYWxsYmFjay4gVGhlIHdlaWdodC9zY2FsZSB0ZXJtIGFscmVhZHkgY292ZXJzIHRoZSBkcmF3biB3aWR0aDtcclxuLy8gcmVwbGFjZSB0aGUgY29uc3RhbnQgd2l0aCBhIGZldyBwaXhlbHMnIHdvcnRoIGF0IHRoZSBjdXJyZW50IHpvb20uIFRoZSBpbnN0YW5jZVxyXG4vLyBnZXR0ZXJzIHJlYWQgYHNldHRpbmdzYCBsaXZlIHBlciBldmVudCwgc28gdXBkYXRpbmcgb24gem9vbSBpcyBlbm91Z2ggLS0gbm9cclxuLy8gZ2xpZnkgcGF0Y2hpbmcuIFJldHVybnMgdGhlIHVuc3Vic2NyaWJlIGZvciBvblJlbW92ZS5cclxuY29uc3QgTElORV9ISVRfU0xBQ0tfUFggPSA4O1xyXG5mdW5jdGlvbiB0cmFja0xpbmVTZW5zaXRpdml0eShtYXAsIGluc3RhbmNlKSB7XHJcbiAgICBjb25zdCBhcHBseSA9ICgpID0+IHtcclxuICAgICAgICBjb25zdCBzbGFjayA9IExJTkVfSElUX1NMQUNLX1BYIC8gTWF0aC5wb3coMiwgbWFwLmdldFpvb20oKSk7XHJcbiAgICAgICAgaW5zdGFuY2Uuc2V0dGluZ3Muc2Vuc2l0aXZpdHkgPSBzbGFjaztcclxuICAgICAgICBpbnN0YW5jZS5zZXR0aW5ncy5zZW5zaXRpdml0eUhvdmVyID0gc2xhY2s7XHJcbiAgICB9O1xyXG4gICAgYXBwbHkoKTtcclxuICAgIG1hcC5vbihcInpvb21lbmRcIiwgYXBwbHkpO1xyXG4gICAgcmV0dXJuICgpID0+IG1hcC5vZmYoXCJ6b29tZW5kXCIsIGFwcGx5KTtcclxufVxyXG5cclxuLy8gQW4gYXJlYSBsYXllcidzIGdlb21ldHJ5IGFzIHBhcnRzIC0+IGNsb3NlZCBbbG9uLCBsYXRdIHJpbmdzOiBhIHBvbHlnb24ncyBmbGF0XHJcbi8vIGNvb3JkaW5hdGUgcnVuIHNsaWNlZCBieSBpdHMgYHJpbmdzYCB0YWJsZSAob25lIGhvbGUtZnJlZSByaW5nIHdpdGhvdXQgaXQpLCBvciBhXHJcbi8vIGNpcmNsZSdzIGdlbmVyYXRlZCByaW5nLiBGZWVkcyBib3RoIHRoZSBmaWxsIChlYXJjdXQsIGluIHRoZSBwb2x5Z29uIGJ1Y2tldCkgYW5kXHJcbi8vIHRoZSBvdXRsaW5lIChMaW5lU3RyaW5ncyBpbiB0aGUgbGluZXMgYnVja2V0KS5cclxuZnVuY3Rpb24gYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xyXG4gICAgaWYgKGxheWVyLnR5cGUgPT09IFwiY2lyY2xlXCIpIHtcclxuICAgICAgICBjb25zdCBsYXQgPSBsYXllci5sb2NhdGlvblswXTtcclxuICAgICAgICBjb25zdCBsb24gPSBsYXllci5sb2NhdGlvblsxXTtcclxuICAgICAgICBjb25zdCByYWRpdXNNZXRlcnMgPSBsYXllci5yYWRpdXMgfHwgMTA7XHJcbiAgICAgICAgY29uc3QgZWFydGhSYWRpdXMgPSA2Mzc4MTM3O1xyXG4gICAgICAgIGNvbnN0IHJpbmcgPSBbXTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSAzMjsgaSsrKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlID0gKGkgKiAzNjApIC8gMzI7XHJcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XHJcbiAgICAgICAgICAgIGNvbnN0IGRMYXQgPSAocmFkaXVzTWV0ZXJzICogTWF0aC5jb3MoYW5nbGVSYWQpKSAvIGVhcnRoUmFkaXVzO1xyXG4gICAgICAgICAgICBjb25zdCBkTG9uID0gKHJhZGl1c01ldGVycyAqIE1hdGguc2luKGFuZ2xlUmFkKSkgLyAoZWFydGhSYWRpdXMgKiBNYXRoLmNvcygobGF0ICogTWF0aC5QSSkgLyAxODApKTtcclxuICAgICAgICAgICAgcmluZy5wdXNoKFtsb24gKyAoZExvbiAqIDE4MCkgLyBNYXRoLlBJLCBsYXQgKyAoZExhdCAqIDE4MCkgLyBNYXRoLlBJXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBbW3JpbmddXTtcclxuICAgIH1cclxuICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSB8fCBbXTtcclxuICAgIGNvbnN0IGxvbmxhdCA9IGxvY3MubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgIGNvbnN0IHJpbmdUYWJsZSA9IGxheWVyLnJpbmdzIHx8IChsb25sYXQubGVuZ3RoID4gMCA/IFtbbG9ubGF0Lmxlbmd0aF1dIDogW10pO1xyXG4gICAgY29uc3QgcGFydHMgPSBbXTtcclxuICAgIGxldCBhdCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHBhcnRMZW5zIG9mIHJpbmdUYWJsZSkge1xyXG4gICAgICAgIGNvbnN0IHJpbmdzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsZW4gb2YgcGFydExlbnMpIHtcclxuICAgICAgICAgICAgY29uc3QgcmluZyA9IGNsb3NlUmluZyhsb25sYXQuc2xpY2UoYXQsIGF0ICsgbGVuKSk7XHJcbiAgICAgICAgICAgIGF0ICs9IGxlbjtcclxuICAgICAgICAgICAgaWYgKHJpbmcubGVuZ3RoID49IDQpIHJpbmdzLnB1c2gocmluZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChyaW5ncy5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKHJpbmdzKTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXJ0cztcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCBsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsLCB2ZWN0b3JHcHUgPSBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzRmVhdHVyZVZpc2libGUgPSBudWxsKSB7XHJcbiAgICAvLyBIaXQtdGVzdCBndWFyZDogR1BVLXBhdGggYnVja2V0cyBob2xkIGhpZGRlbiBsYXllcnMgKGFuZCBvdXQtb2Ytd2luZG93XHJcbiAgICAvLyBmZWF0dXJlcyksIG1hc2tlZCBvbmx5IGJ5IHNoYWRlciB1bmlmb3JtcyBnbGlmeSdzIGhpdC10ZXN0cyBjYW5ub3Qgc2VlLiBUaGVcclxuICAgIC8vIHdpZGdldCBwYXNzZXMgYSBsaXZlIGxvb2t1cDsgdGhlIGZhbGxiYWNrIGNvdmVycyBwbGFpbi1KUyBjb25zdW1lcnMgd2l0aCB0aGVcclxuICAgIC8vIGNvbmZpZydzIG93biBmbGFnLlxyXG4gICAgY29uc3QgdmlzaWJsZU5vdyA9IGlzRmVhdHVyZVZpc2libGUgfHwgKChsKSA9PiBsLnZpc2libGUgIT09IGZhbHNlKTtcclxuICAgIC8vIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lIGdlb21ldHJ5IHBlciBsYXllci4gT24gdGhlIEdQVSBwYXRoIChtYXAuanNcclxuICAgIC8vIHBhc3NlcyB2ZWN0b3JHcHUgd2hlbiB0aGUgYnVja2V0IHF1YWxpZmllcykgZXZlcnkgZmVhdHVyZSBzdGF5cyBpbiB0aGUgYnVmZmVycyBhbmRcclxuICAgIC8vIHRoZSBzaGFkZXIgZGVjaWRlcyB2aXNpYmlsaXR5IHBlciB0aWNrIGFuZCBwZXIgbGF5ZXIgdG9nZ2xlIC0tIGEgbGluZS1zaGFwZWQgdHJhY2tcclxuICAgIC8vIGhhcyBhcyBtYW55IHZlcnRpY2VzIGFzIGEgcG9pbnQgdHJhY2sgaGFzIHBvaW50cywgc28gaXRzIHJlYnVpbGRzIGNvc3QgdGhlIHNhbWVcclxuICAgIC8vIGFuZCBjcmFzaGVkIHRoZSBzYW1lIHdheS4gT2ZmIHRoZSBHUFUgcGF0aCwgdGhlIHdob2xlLWZlYXR1cmUgQ1BVIGZpbHRlciByZW1haW5zLlxyXG4gICAgY29uc3QgdmVjdG9yTWV0YSA9IHZlY3RvckdwdSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCJcclxuICAgICAgICA/IGJ1aWxkVmVjdG9yVGltZU1ldGEobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCB2ZWN0b3JUaW1lID0gQm9vbGVhbih2ZWN0b3JNZXRhLmhhc1RpbWUpO1xyXG4gICAgaWYgKHRpbWVTdGF0ZSAmJiAhdmVjdG9yVGltZSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCIpIHtcclxuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcclxuICAgICAgICBpZiAobGF5ZXJzTGlzdC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XHJcbiAgICAgICAgY29uc3QgdmVydGV4Q291bnRzID0gW107XHJcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xyXG4gICAgICAgICAgICBjb25zdCByZ2IgPSBwYXJzZUNvbG9yKHN0eWxlLmNvbG9yLCBcIiMzMzg4ZmZcIik7XHJcblxyXG4gICAgICAgICAgICAvLyBBcmVhIG91dGxpbmVzOiBhIHBvbHlnb24gb3IgY2lyY2xlIGluIHRoaXMgYnVja2V0IGNvbnRyaWJ1dGVzIGVhY2ggb2YgaXRzXHJcbiAgICAgICAgICAgIC8vIHJpbmdzIGFzIG9uZSBMaW5lU3RyaW5nLCBkcmF3biB3aXRoIHRoZSBhcmVhJ3Mgc3Ryb2tlIG9wdGlvbnMgLS0gY29sb3IsXHJcbiAgICAgICAgICAgIC8vIHdlaWdodCwgb3BhY2l0eSwgTGVhZmxldCdzIG93biBzZW1hbnRpY3MuIE91dGxpbmUgd2VpZ2h0IGFuZCBvcGFjaXR5IG5ldmVyXHJcbiAgICAgICAgICAgIC8vIHJlbmRlcmVkIGJlZm9yZSB0aGlzOyB0aGUgZmlsbCBtYWNoaW5lcnkgY2Fubm90IGRyYXcgdGhlbSAoZ2xpZnkncyBib3JkZXJcclxuICAgICAgICAgICAgLy8gaXMgMXB4IGFuZCBmaWxsLWNvbG91cmVkKSwgdGhlIGxpbmVzIG1hY2hpbmVyeSBhbHJlYWR5IGRvZXMuXHJcbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIiB8fCBsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICAgICAgICAgICAgaWYgKChzdHlsZS53ZWlnaHQgPz8gMykgPiAwICYmIChzdHlsZS5vcGFjaXR5ID8/IDEuMCkgPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmcgb2YgcmluZ3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAocmluZy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogeyB0eXBlOiBcIkxpbmVTdHJpbmdcIiwgY29vcmRpbmF0ZXM6IHJpbmcgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT3V0bGluZSBwaXhlbHMgb25seSAtLSB0aGUgYXJlYSdzIHNoYXBlcyBpbnN0YW5jZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvd25zIGludGVyYWN0aW9uIHdpdGggZXhhY3QgY29udGFpbm1lbnQuIExlZnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2xpY2thYmxlLCB0aGVzZSByaW5ncyBhbnN3ZXJlZCB0aHJvdWdoIGdsaWZ5J3NcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGluZSB0b2xlcmFuY2UgKDAuMSBERUdSRUVTIGZvciBjbGlja3MgdnMgMC4wM1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmb3IgaG92ZXJzKTogcG9wdXBzIHdlbGwgb3V0c2lkZSB0aGUgc2hhcGUgYW5kXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc2lkZSBob2xlcywgaG92ZXIgZGlzYWdyZWVpbmcgd2l0aCBjbGljay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNCb3JkZXI6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLm9wYWNpdHkgfHwgMS4wIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdlaWdodDogc3R5bGUud2VpZ2h0IHx8IDNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKGNvdW50KTsgICAvLyAwIGtlZXBzIHRoZSBzbG90IGFsaWduZWQgd2hlbiBzdHJva2VsZXNzXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gT25lIExpbmVTdHJpbmcgZmVhdHVyZSBQRVIgUEFSVCwgZXZlcnkgcGFydCBjYXJyeWluZyB0aGUgbGF5ZXIgLS0gbmV2ZXJcclxuICAgICAgICAgICAgLy8gYSBNdWx0aUxpbmVTdHJpbmc6IGdsaWZ5J3MgTXVsdGlMaW5lU3RyaW5nIHBhdGggaGl0LXRlc3RzIHRoZSBjb25uZWN0b3JcclxuICAgICAgICAgICAgLy8gYmV0d2VlbiBwYXJ0cywgd2hpY2ggaXMgdGhlIHBoYW50b20gc2VnbWVudCBieSBhbm90aGVyIHJvdXRlLiBUaGUgR0xcclxuICAgICAgICAgICAgLy8gdmVydGV4IHN0cmVhbSBzdGF5cyBjb25zZWN1dGl2ZSwgc28gdGhlIHBlci1sYXllciBjb3VudCBzdGlsbCBhbGlnbnNcclxuICAgICAgICAgICAgLy8gdGhlIHRpbWUgYXR0cmlidXRlczsgYSBzdHJva2VsZXNzIG9yIGRlZ2VuZXJhdGUgbGF5ZXIga2VlcHMgaXRzIHNsb3QuXHJcbiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGFydCBvZiBsaW5lUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZ2VvanNvbkNvb3JkcyA9IHBhcnQubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcclxuICAgICAgICAgICAgICAgIGNvdW50ICs9IE1hdGgubWF4KDAsIDIgKiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxKSk7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVcIixcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIkxpbmVTdHJpbmdcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29vcmRpbmF0ZXM6IGdlb2pzb25Db29yZHNcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHN0eWxlLndlaWdodCB8fCAzXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goY291bnQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcclxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcclxuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lT3B0aW9ucyA9IHZlY3RvclRpbWVcclxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5nbExpbmVzID0gTC5nbGlmeS5saW5lcyh7XHJcbiAgICAgICAgICAgICAgICAgICAgLi4ubGluZU9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5bGluZXNQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGRhdGEgYWJvdmUgaXMgR2VvSlNPTiwgd2hvc2UgY29vcmRpbmF0ZXMgYXJlIFtsb24sIGxhdF07IGdsaWZ5XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZGVmYXVsdHMgdG8gbGF0aXR1ZGUtZmlyc3QgYW5kIGl0cyBMSU5FIHZlcnRleCBidWlsZGVyIHJlYWRzXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gY29vcmRpbmF0ZXMgdGhyb3VnaCB0aGVzZSBrZXlzIC0tIHVuc2V0LCBpdCB0b29rIGxvbmdpdHVkZSBhc1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGxhdGl0dWRlIGFuZCBwcm9qZWN0ZWQgZXZlcnkgbGluZSBvZmYtdmlld3BvcnQuIFNpbGVudGx5OiBubyBHTFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGVycm9yLCBhIGhlYWx0aHkgY2FudmFzLCB6ZXJvIGZyYWdtZW50cy4gU2V0IHBlciBpbnN0YW5jZSByYXRoZXJcclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGFuIG9uIHRoZSBMLmdsaWZ5IGdsb2JhbCwgd2hpY2ggYW5vdGhlciBsaWJyYXJ5IGNvdWxkIGFsc29cclxuICAgICAgICAgICAgICAgICAgICAvLyBtdXRhdGUuIFRoZSBwb2x5Z29uIHBhdGggaXMgZGVsaWJlcmF0ZWx5IE5PVCBnaXZlbiB0aGVzZSBrZXlzOlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIGl0IHRyaWFuZ3VsYXRlcyB2aWEgZWFyY3V0IG9uIHRoZSBHZW9KU09OIGRpcmVjdGx5LCBuYXRpdmVcclxuICAgICAgICAgICAgICAgICAgICAvLyBbbG9uLCBsYXRdLCBhbmQga2V5cyB0aGVyZSB3b3VsZCB0cmFuc3Bvc2UgaXQgdGhlIHNhbWUgd2F5LlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZvdW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgYnVnIHJlcG9ydCwgZHJpdmluZyB0aGUgcGxhaW4tSlNcclxuICAgICAgICAgICAgICAgICAgICAvLyBidW5kbGUgd2hlcmUgbm8gcG9pbnRzIG1hc2tlZCB0aGUgYmxhbmsgbGluZXMuXHJcbiAgICAgICAgICAgICAgICAgICAgbGF0aXR1ZGVLZXk6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgbG9uZ2l0dWRlS2V5OiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgY2xpY2s6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZmVhdHVyZSB8fCAhZmVhdHVyZS5wcm9wZXJ0aWVzIHx8IGZlYXR1cmUucHJvcGVydGllcy5pc0JvcmRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCAhdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFyZTogc2hpbnl3aWRnZXRzJyBtb2RlbCBoYXMgbm8gYGNvbW1gXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvcGVydHksIHNvIGdhdGluZyBvbiBpdCBzaWxlbnRseSBraWxsZWQgdGhpc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgd2FzIHRoZSBvbmUgcGF0aCB0aGF0IHdvcmtlZCB0aGVyZS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXJlIHRoZSBjbGljayBsYW5kZWQsIGZlYXR1cmUgb3Igbm90OiBvbmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJhaXQgYWx3YXlzIGFuc3dlcnMgXCJ3aGVyZVwiLCBjbGlja2VkX2xheWVyX2lkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuc3dlcnMgXCJvbiB3aGF0XCIgKFwiXCIgZm9yIG9wZW4gbWFwKS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtNYXRoLnJvdW5kKGUubGF0bG5nLndyYXAoKS5sYXQgKiAxZTUpIC8gMWU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxuZyAqIDFlNSkgLyAxZTVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQnVtcGVkIG9uIEVWRVJZIGNsaWNrOiBjbGlja2luZyB0aGUgc2FtZSBmZWF0dXJlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHR3aWNlIGNoYW5nZXMgbmVpdGhlciBpZCBub3IgaW5kZXgsIHNvIHdpdGhvdXRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBubyB0cmFpdCBmaXJlcyBhbmQgaGFuZGxlcnMgbWlzcyB0aGUgY2xpY2suXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrX3NlcVwiLCAobW9kZWwuZ2V0KFwiY2xpY2tfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmICFmZWF0dXJlLnByb3BlcnRpZXMuaXNCb3JkZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiB2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsTGluZXMpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2Vuc2l0aXZpdHlPZmYgPSB0cmFja0xpbmVTZW5zaXRpdml0eShtLCB0aGlzLmdsTGluZXMpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHZlY3RvclRpbWUpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZSh0aGlzLmdsTGluZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NlbnNpdGl2aXR5T2ZmKSB0aGlzLl9zZW5zaXRpdml0eU9mZigpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xMaW5lcykgdGhpcy5nbExpbmVzLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xyXG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWdvblwiKSB7XHJcbiAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcclxuICAgICAgICBjb25zdCB2ZXJ0ZXhDb3VudHMgPSBbXTtcclxuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICAgICAgY29uc3QgcGFydHMgPSBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMCk7ICAgLy8gbm8gZmVhdHVyZSwgYnV0IHRoZSBzbG90IG11c3Qgc3RheSBhbGlnbmVkXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBBbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHBvbHlnb24gd2l0aCBEIGRpc3RpbmN0IHZlcnRpY2VzIGFuZCBoIGhvbGVzIGhhc1xyXG4gICAgICAgICAgICAvLyBleGFjdGx5IEQgKyAyaCAtIDIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzXHJcbiAgICAgICAgICAgIC8vIGVhcmN1dDsgaCA9IDAgZ2l2ZXMgdGhlIGZhbWlsaWFyIEQgLSAyLiBSaW5ncyBhcmUgY2xvc2VkIGJ5IG5vdywgc28gZWFjaFxyXG4gICAgICAgICAgICAvLyBjb250cmlidXRlcyBsZW5ndGggLSAxIGRpc3RpbmN0IHZlcnRpY2VzLiBQYXJ0cyB0cmlhbmd1bGF0ZSBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICAgIC8vIGFuZCBzdW0uXHJcbiAgICAgICAgICAgIGxldCB0cmlhbmdsZXMgPSAwO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJpbmdzIG9mIHBhcnRzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0aW5jdCA9IHJpbmdzLnJlZHVjZSgoc3VtLCByKSA9PiBzdW0gKyByLmxlbmd0aCAtIDEsIDApO1xyXG4gICAgICAgICAgICAgICAgdHJpYW5nbGVzICs9IE1hdGgubWF4KDAsIGRpc3RpbmN0ICsgMiAqIChyaW5ncy5sZW5ndGggLSAxKSAtIDIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKDMgKiB0cmlhbmdsZXMpO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgc3R5bGUgPSBzdHlsZUZvcihsYXllciwgMCk7XHJcbiAgICAgICAgICAgIC8vIExlYWZsZXQncyBvd24gc2VtYW50aWNzOiB0aGUgZmlsbCBpcyBmaWxsQ29sb3IsIGRlZmF1bHRpbmcgdG8gdGhlIHN0cm9rZVxyXG4gICAgICAgICAgICAvLyBjb2xvciB3aGVuIHVuc2V0LiBJdCB1c2VkIHRvIGFsd2F5cyBmaWxsIHdpdGggYGNvbG9yYCwgd2hpY2ggbWFkZVxyXG4gICAgICAgICAgICAvLyBcInJlZCBvdXRsaW5lLCBwYWxlIGJsdWUgZmlsbFwiIC0tIHRoZSBtb3N0IGJhc2ljIHBvbHlnb24gc3R5bGluZyBhc2sgLS1cclxuICAgICAgICAgICAgLy8gaW1wb3NzaWJsZTsgdGhlIG91dGxpbmUgaXRzZWxmIGlzIGRyYXduIGJ5IHRoZSBsaW5lcyBidWNrZXQuXHJcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuZmlsbENvbG9yIHx8IHN0eWxlLmZpbGxfY29sb3IgfHwgc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcclxuICAgICAgICAgICAgLy8gT25lIEZlYXR1cmUgUEVSIFBBUlQsIG5ldmVyIGEgTXVsdGlQb2x5Z29uOiBnbGlmeSdzIHNoYXBlcyBvbmx5XHJcbiAgICAgICAgICAgIC8vIGV4cGxvZGVzIE11bHRpUG9seWdvbiB3aGVuIGhhbmRlZCBhIGJhcmUgRmVhdHVyZSBvciBnZW9tZXRyeSAtLSBpbiBhXHJcbiAgICAgICAgICAgIC8vIEZlYXR1cmVDb2xsZWN0aW9uIHRoZSBjb29yZGluYXRlcyByZWFjaCBlYXJjdXQuZmxhdHRlbiB1bmV4cGxvZGVkLFxyXG4gICAgICAgICAgICAvLyBlYXJjdXQgcmV0dXJucyBubyBpbmRpY2VzLCBhbmQgdGhlIGZlYXR1cmUgc2lsZW50bHkgZHJhd3MgWkVSTyBmaWxsXHJcbiAgICAgICAgICAgIC8vIHRyaWFuZ2xlcyAodmVyaWZpZWQgYWdhaW5zdCBnbGlmeSAzLjMuMDsgaXRzIFwidW5oYW5kbGVkIHBvbHlnb25cIlxyXG4gICAgICAgICAgICAvLyB0aHJvdyBzaXRzIGluc2lkZSB0aGUgZW1wdHkgbG9vcCBhbmQgbmV2ZXIgZmlyZXMpLiBQYXJ0cyBzdGF5XHJcbiAgICAgICAgICAgIC8vIGNvbnNlY3V0aXZlLCBzbyBwZXItbGF5ZXIgdmVydGV4Q291bnRzIHN0aWxsIGFsaWduIGZvciBHUFUgdGltZS5cclxuICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBwYXJ0cykge1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHsgdHlwZTogXCJQb2x5Z29uXCIsIGNvb3JkaW5hdGVzOiByaW5ncyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5maWxsT3BhY2l0eSB8fCAwLjIgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAgICAgY29uc3QgZ2VvanNvbiA9IHtcclxuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxyXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG5cclxuICAgICAgICAgICAgICAgIGNvbnN0IHNoYXBlT3B0aW9ucyA9IHZlY3RvclRpbWVcclxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5nbFNoYXBlcyA9IEwuZ2xpZnkuc2hhcGVzKHtcclxuICAgICAgICAgICAgICAgICAgICAuLi5zaGFwZU9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXHJcbiAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJwb2x5Z29uc1BhbmVcIixcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFmZWF0dXJlIHx8ICFmZWF0dXJlLnByb3BlcnRpZXMgfHwgIWZlYXR1cmUucHJvcGVydGllcy5sYXllclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8ICF2aXNpYmxlTm93KGZlYXR1cmUucHJvcGVydGllcy5sYXllcikpIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMywgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdHRlbiBiYXJlOiBzaGlueXdpZGdldHMnIG1vZGVsIGhhcyBubyBgY29tbWBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBUaGUgc2lkZWJhciBhbHdheXMgd3JvdGUgYmFyZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFuZCB3YXMgdGhlIG9uZSBwYXRoIHRoYXQgd29ya2VkIHRoZXJlLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV2hlcmUgdGhlIGNsaWNrIGxhbmRlZCwgZmVhdHVyZSBvciBub3Q6IG9uZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0cmFpdCBhbHdheXMgYW5zd2VycyBcIndoZXJlXCIsIGNsaWNrZWRfbGF5ZXJfaWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5zd2VycyBcIm9uIHdoYXRcIiAoXCJcIiBmb3Igb3BlbiBtYXApLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW01hdGgucm91bmQoZS5sYXRsbmcud3JhcCgpLmxhdCAqIDFlNSkgLyAxZTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5yb3VuZChlLmxhdGxuZy53cmFwKCkubG5nICogMWU1KSAvIDFlNV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBCdW1wZWQgb24gRVZFUlkgY2xpY2s6IGNsaWNraW5nIHRoZSBzYW1lIGZlYXR1cmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHdpY2UgY2hhbmdlcyBuZWl0aGVyIGlkIG5vciBpbmRleCwgc28gd2l0aG91dFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIG5vIHRyYWl0IGZpcmVzIGFuZCBoYW5kbGVycyBtaXNzIHRoZSBjbGljay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgdmlzaWJsZU5vdyhmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFNoYXBlcyk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZ2xTaGFwZXMpIHRoaXMuZ2xTaGFwZXMucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XHJcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XHJcbiAgICBjb25zdCBpbmRleE1hcHBpbmcgPSBbXTtcclxuXHJcbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xyXG4gICAgLy8gZ2xpZnkncyBmYWxsYmFjayB3aGVuIGEgbGF5ZXIgZGVjbGFyZXMgbm8gcmFkaXVzLiBQaW5zIG5lZWQgZmFyIG1vcmUgcm9vbSB0aGFuIGFcclxuICAgIC8vIGNpcmNsZSBiZWNhdXNlIHRoZSBnbHlwaCBpcyBkcmF3biBpbnNpZGUgdGhlIHBvaW50J3Mgb3duIHF1YWQgYnkgdGhlIHNoYWRlci5cclxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XHJcblxyXG4gICAgLy8gR1BVIHRpbWUgcGF0aDogd2hlbiB0aGlzIGJ1Y2tldCBob2xkcyB0aW1lIGxheWVycywgZXZlcnkgcG9pbnQgaXMgZmVkIHRvIGdsaWZ5IGFuZFxyXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXHJcbiAgICAvLyB2ZXJ0ZXggc2hhZGVyLCBzbyBhIHRpY2sgY29zdHMgdHdvIHVuaWZvcm1zIGluc3RlYWQgb2YgcmVidWlsZGluZyA1TSBwb2ludHMgaW4gSlMuXHJcbiAgICAvLyBUaGUgQ1BVIGZpbHRlciBiZWxvdyBzdGF5cyBhcyB0aGUgZmFsbGJhY2sgd2hlbiB0aGUgR0wgd2lyaW5nIGlzIHVuYXZhaWxhYmxlLlxyXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcclxuICAgICAgICA/IGJ1aWxkVGltZUF0dHJpYnV0ZXMobGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsXHJcbiAgICAgICAgICAgIHRpbWVTdGF0ZSAmJiB0aW1lU3RhdGUucGVyaW9kID8gcGVyaW9kVG9Ncyh0aW1lU3RhdGUucGVyaW9kKSA6IG51bGwpXHJcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XHJcbiAgICBjb25zdCBncHVUaW1lID0gQm9vbGVhbihncHVBdHRycy5oYXNUaW1lKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcclxuICAgICAgICBjb25zdCBjb2xvclJHQiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIGZhbGxiYWNrQ29sb3IpO1xyXG4gICAgICAgIGNvbnN0IGxheWVyU2l6ZSA9IGxheWVyLnJhZGl1cyAhPSBudWxsID8gTnVtYmVyKGxheWVyLnJhZGl1cykgOiBkZWZhdWx0U2l6ZTtcclxuXHJcbiAgICAgICAgY29uc3QgY29vcmRCdWZmZXIgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XHJcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xyXG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcclxuICAgICAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbbGF5ZXIubG9jYXRpb25bMF0sIGxheWVyLmxvY2F0aW9uWzFdXSk7XHJcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCLFxyXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxyXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVPZmZzZXQsXHJcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBjb3VudCA9IGNvb3Jkcy5sZW5ndGggLyAyO1xyXG5cclxuICAgICAgICBjb25zdCBwZXJGZWF0dXJlID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlcyA6IG51bGw7XHJcbiAgICAgICAgLy8gU2VsZWN0aW9uIHN0eWxpbmcsIGFwcGxpZWQgb3ZlciB0aGUgbGF5ZXIncyBvd24gYW5kIGl0cyBkYXRhLWRyaXZlbiBzdHlsZXMuXHJcbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cclxuICAgICAgICBjb25zdCBoaWdobGlnaHQgPSBsYXllci5oaWdobGlnaHRfc3R5bGUgfHwgbnVsbDtcclxuICAgICAgICBjb25zdCBvdmVycmlkZXMgPSBsYXllci5zdHlsZV9vdmVycmlkZXMgfHwgbnVsbDtcclxuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxyXG4gICAgICAgIC8vIHU4IFJHQkEgdW5kZXIgXCI8aWQ+Ojpjb2xvcnNcIiwgZjMyIHBpeGVscyB1bmRlciBcIjxpZD46OnJhZGlpXCIgLS0gY29tcHV0ZWRcclxuICAgICAgICAvLyBpbiBQeXRob24gZnJvbSBjb2xvcl9jb2wvcmFkaXVzX2NvbC4gQnVmZmVycywgbmV2ZXIgcGVyLWZlYXR1cmUgc3R5bGVcclxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxyXG4gICAgICAgIC8vIHBheWxvYWQgdGhhdCB1c2VkIHRvIGtpbGwgc2Vzc2lvbnMuIEV4cGxpY2l0IHN0eWxlcyBzdGlsbCBvdXRyYW5rIHRoZW0uXHJcbiAgICAgICAgY29uc3QgY29sb3JzUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9Ojpjb2xvcnNgXTtcclxuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcclxuICAgICAgICAgICAgPyBuZXcgVWludDhBcnJheShjb2xvcnNSYXcuYnVmZmVyIHx8IGNvbG9yc1JhdywgY29sb3JzUmF3LmJ5dGVPZmZzZXQgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcnNSYXcuYnl0ZUxlbmd0aClcclxuICAgICAgICAgICAgOiBudWxsO1xyXG4gICAgICAgIGNvbnN0IHJhZGlpUmF3ID0gY29vcmRpbmF0ZUJ1ZmZlcnNbYCR7bGF5ZXIuaWR9OjpyYWRpaWBdO1xyXG4gICAgICAgIGNvbnN0IGJ1ZlJhZGlpID0gcmFkaWlSYXdcclxuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmFkaWlSYXcuYnl0ZUxlbmd0aCAvIDQpXHJcbiAgICAgICAgICAgIDogbnVsbDtcclxuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxyXG4gICAgICAgIC8vIHNpbXBseSBub3QgcHVzaGVkOyBpbmRleE1hcHBpbmcgY2FycmllcyBvcmlnaW5hbEluZGV4LCBzbyBwb3B1cHMgYW5kIHByb3BlcnRpZXNcclxuICAgICAgICAvLyBvbiB0aGUgc3Vydml2b3JzIGtlZXAgcG9pbnRpbmcgYXQgdGhlIHJpZ2h0IHJvd3MuXHJcbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgPyB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKVxyXG4gICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGZyb21EYXRhID0gcGVyRmVhdHVyZSA/IHBlckZlYXR1cmVbaV0gOiBudWxsO1xyXG4gICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG92ZXJyaWRlcyA/IG92ZXJyaWRlc1tpXSA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxyXG4gICAgICAgICAgICAgICAgfHwgKGhpZ2hsaWdodCAmJiBoaWdobGlnaHQuY29sb3IpXHJcbiAgICAgICAgICAgICAgICB8fCAoZnJvbURhdGEgJiYgZnJvbURhdGEuY29sb3IpO1xyXG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LnJhZGl1cyAhPSBudWxsID8gaGlnaGxpZ2h0LnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBmcm9tRGF0YSAmJiBmcm9tRGF0YS5yYWRpdXMgIT0gbnVsbCA/IGZyb21EYXRhLnJhZGl1c1xyXG4gICAgICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtjb29yZHNbaSAqIDJdLCBjb29yZHNbaSAqIDIgKyAxXV0pO1xyXG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiBpLFxyXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZkNvbG9ycyA/IHsgcjogYnVmQ29sb3JzW2kgKiA0XSAvIDI1NSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZzogYnVmQ29sb3JzW2kgKiA0ICsgMV0gLyAyNTUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhOiBidWZDb2xvcnNbaSAqIDQgKyAzXSAvIDI1NSB9XHJcbiAgICAgICAgICAgICAgICAgICAgOiBjb2xvclJHQixcclxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcclxuICAgICAgICAgICAgICAgICAgICA6IGJ1ZlJhZGlpID8gYnVmUmFkaWlbaV1cclxuICAgICAgICAgICAgICAgICAgICA6IGxheWVyU2l6ZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XHJcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdldEludGVyYWN0aXZlRWwgPSAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsKSBlbC5zdHlsZS5jdXJzb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIG1hcDogbSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXHJcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcclxuICAgICAgICAgICAgICAgIC8vIFJlc29sdmVkIHBlciBwb2ludCwgbGlrZSBjb2xvdXI6IHNldmVyYWwgbGF5ZXJzIHNoYXJlIG9uZSBnbGlmeSBpbnN0YW5jZSxcclxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cclxuICAgICAgICAgICAgICAgIHNpemU6IChpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgcG9pbnQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW5mbyA/IGluZm8uY29sb3JSR0IgOiB7IHI6IDAuMiwgZzogMC41LCBiOiAxLjAgfTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc2Vuc2l0aXZpdHk6IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjAgOiA4LFxyXG4gICAgICAgICAgICAgICAgY2xpY2s6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCBwb3B1cHMgb24gZmFyIGF3YXkgY2xpY2tzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpeGVsRGlzdCA9IGNsaWNrUG9pbnQuZGlzdGFuY2VUbyhtYXJrZXJQb2ludCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlZCBCRUZPUkUgY29tcGV0aW5nIGZvciB0aGUgY2xpY2s6IGEgaGlkZGVuIG9yXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gb3V0LW9mLXdpbmRvdyBwb2ludCBtdXN0IG5vdCBlbnRlciB0aGUgYXJiaXRyYXRpb24gYXQgYWxsLCBzb1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdoYXRldmVyIHNpdHMgYmVuZWF0aCBpdCAtLSBhIHZpc2libGUgZmVhdHVyZSwgb3IgdGhlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZW1wdHktbWFwIGZhbGxiYWNrIC0tIHdpbnMgaW5zdGVhZC5cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZUluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXByZUluZm8gfHwgIXZpc2libGVOb3cocHJlSW5mby5sYXllciwgcHJlSW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHByZUluZm87XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcmlnaW5hbEluZGV4ID0gaW5mby5vcmlnaW5hbEluZGV4O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBUaGUgY2xpY2tlZCBwb2ludCdzIG93biBjb29yZGluYXRlcyAtLSBtb3JlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJ1dGhmdWwgdGhhbiB0aGUgbW91c2UgcG9zaXRpb24gZm9yIGEgcG9pbnQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXRsbmdcIiwgW3BvaW50WzBdLCBwb2ludFsxXV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEJ1bXBlZCBvbiBFVkVSWSBjbGljazsgc2VlIHRoZSB2ZWN0b3IgY2xpY2sgaGFuZGxlcnMuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tfc2VxXCIsIChtb2RlbC5nZXQoXCJjbGlja19zZXFcIikgfHwgMCkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwb2ludCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBob3ZlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoZS5sYXRsbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhEaXN0ID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyAyNSA6IDEyO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gcG9pbnRzTGlzdC5pbmRleE9mKHBvaW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWluZm8gfHwgIXZpc2libGVOb3coaW5mby5sYXllciwgaW5mby5vcmlnaW5hbEluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllciwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLmZyYWdtZW50U2hhZGVyU291cmNlID0gKCkgPT4gcGluU2hhZGVyO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoZ3B1VGltZSkge1xyXG4gICAgICAgICAgICAgICAgZ2xpZnlPcHRpb25zLnZlcnRleFNoYWRlclNvdXJjZSA9ICgpID0+IHRpbWVWZXJ0ZXhTaGFkZXIoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLmdsUG9pbnRzID0gTC5nbGlmeS5wb2ludHMoZ2xpZnlPcHRpb25zKTtcclxuICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFBvaW50cyk7XHJcbiAgICAgICAgICAgIGlmIChncHVUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBOdWxsIG9uIGZhaWx1cmUsIHdoaWNoIGFsc28gZmxpcHMgdGhlIGdsb2JhbCBmbGFnOiB0aGUgbmV4dCBzeW5jJ3NcclxuICAgICAgICAgICAgICAgIC8vIHJlYnVpbGQga2V5IGNoYW5nZXMgd2l0aCBpdCBhbmQgdGhlIENQVSBwYXRoIHRha2VzIG92ZXIuXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9JbnN0YW5jZSh0aGlzLmdsUG9pbnRzLCBncHVBdHRycyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICBtLm9mZihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5nbFBvaW50cykgdGhpcy5nbFBvaW50cy5yZW1vdmUoKTtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhbnZhcyA9IG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xyXG4gICAgICAgICAgICBpZiAoY2FudmFzKSBjYW52YXMuc3R5bGUuY3Vyc29yID0gJyc7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xyXG4gICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcclxuICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XHJcbiAgICByZXR1cm4gaW5zdGFuY2U7XHJcbn1cclxuIiwgIi8vIFBlcm1hbmVudCBmZWF0dXJlIGxhYmVsczogdGV4dCBwaW5uZWQgdG8gdGhlIG1hcCwgZnJvbSBhIGxheWVyJ3MgYGxhYmVsYCAob25lXHJcbi8vIHZlY3RvciBmZWF0dXJlKSBvciBgbGFiZWxzYCAob25lIHBlciBwb2ludCwgYWxpZ25lZCB3aXRoIHRoZSBjb29yZGluYXRlIGJ1ZmZlcikuXHJcbi8vIERPTSBlbGVtZW50cyBieSBkZXNpZ24gLS0gTGVhZmxldCBwZXJtYW5lbnQgdG9vbHRpcHMgLS0gd2hpY2ggaXMgd2h5IHRoZXkgYXJlIGZvclxyXG4vLyBzaXRlLXNjYWxlIGxheWVyczsgUHl0aG9uIHdhcm5zIHBhc3QgYSB0aG91c2FuZC4gTW9kZWwtZnJlZSBsaWtlIHRoZSBsZWdlbmQ6IHB1cmVcclxuLy8gZGF0YSBpbiwgTGVhZmxldCBsYXllcnMgb3V0LCByZS1kZXJpdmVkIGVhY2ggc3luYyBzbyBsYWJlbHMgZm9sbG93IHZpc2liaWxpdHlcclxuLy8gd2l0aG91dCB0b3VjaGluZyB0aGUgR0wgYnVja2V0cyBvciB0aGVpciBtZXRhIGtleXMuXHJcblxyXG5pbXBvcnQgeyBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZSB9IGZyb20gXCIuL21hcC5qc1wiO1xyXG5pbXBvcnQgeyB2ZWN0b3JDb29yZHMsIGxpbmVQYXJ0cyB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xyXG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgZWZmZWN0aXZlRHVyYXRpb24sIHRpbWVzRm9yIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcclxuXHJcbi8vIFdoZXRoZXIgYSB3aG9sZSBsYWJlbGxlZCBmZWF0dXJlIGlzIGluc2lkZSB0aGUgY3VycmVudCB0aW1lIHdpbmRvdy4gTmFOIHRpbWVzXHJcbi8vIGtlZXAgdGhlIGxhYmVsLCBtYXRjaGluZyB0aGUgbWFwOiBhbiB1bnJlYWRhYmxlIHRpbWUgbmV2ZXIgaGlkZXMgZGF0YSwgc28gaXRcclxuLy8gbXVzdCBuZXZlciBoaWRlIHRoZSBkYXRhJ3MgbGFiZWwgZWl0aGVyLiBBIG11bHRpLXNwYW4gbGluZSBjb3VudHMgYXMgdmlzaWJsZVxyXG4vLyB3aGlsZSBBTlkgb2YgaXRzIHNlZ21lbnRzIGlzIC0tIHRoZSBsYWJlbCBmb2xsb3dzIHRoZSBsYXllciwgbm90IG9uZSBsZWcuXHJcbmZ1bmN0aW9uIHRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpIHtcclxuICAgIGlmICghdGltZVN0YXRlIHx8ICFsYXllci50aW1lKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHRpbWVzID0gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpO1xyXG4gICAgaWYgKCF0aW1lcyB8fCB0aW1lcy5sZW5ndGggPCAyKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlLnBlcmlvZCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XHJcbiAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIHJldHVybiB0cnVlO1xyXG4gICAgICAgIGlmIChmZWF0dXJlSW5XaW5kb3codGltZXNbaV0sIHRpbWVzW2kgKyAxXSwgd2luKSkgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIE9uZSBhbmNob3IgcGVyIGxhYmVsbGVkIGZlYXR1cmUuIFBvaW50cyBsYWJlbCBhdCB0aGUgcG9pbnQ7IGEgbGluZSBsYWJlbHMgYXQgaXRzXHJcbi8vIG1pZGRsZSB2ZXJ0ZXggKG9uIHRoZSBsaW5lLCBub3QgZmxvYXRpbmcgaW4gaXRzIGJvdW5kaW5nIGJveCk7IGEgcG9seWdvbiBvclxyXG4vLyBjaXJjbGUgbGFiZWxzIGF0IGl0cyBib3VuZHMgY2VudHJlLiBXaXRoIGEgdGltZVN0YXRlLCBsYWJlbHMgZm9sbG93IHRoZSB3aW5kb3c6XHJcbi8vIHBvaW50cyBkcm9wIHBlciBwb2ludCwgdmVjdG9ycyBhcyBhIHdob2xlLlxyXG4vLyBEZWdyZWUtc3BhY2UgbGVuZ3RoIG9mIGEgW2xhdCwgbG5nXSBydW4gLS0gb25seSBldmVyIGNvbXBhcmVkIGFnYWluc3QgYW5vdGhlclxyXG4vLyBwYXJ0IG9mIHRoZSBzYW1lIGxpbmUsIHNvIG5vIHByb2plY3Rpb24gaXMgbmVlZGVkIHRvIHBpY2sgdGhlIGxvbmdlciBvbmUuXHJcbmZ1bmN0aW9uIHBsYW5hckxlbmd0aChwYXJ0KSB7XHJcbiAgICBsZXQgdG90YWwgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBwYXJ0Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgZExhdCA9IHBhcnRbaV1bMF0gLSBwYXJ0W2kgLSAxXVswXTtcclxuICAgICAgICBjb25zdCBkTG5nID0gcGFydFtpXVsxXSAtIHBhcnRbaSAtIDFdWzFdO1xyXG4gICAgICAgIHRvdGFsICs9IE1hdGguc3FydChkTGF0ICogZExhdCArIGRMbmcgKiBkTG5nKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0b3RhbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RMYWJlbHMobGF5ZXJzLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IG91dCA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMgfHwgW10pIHtcclxuICAgICAgICBpZiAoIWlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MgfHwge30pKSBjb250aW51ZTtcclxuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XHJcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLmNvbGxlY3RMYWJlbHMobGF5ZXIubGF5ZXJzIHx8IFtdLCBidWZmZXJzLCBncm91cENvbmZpZ3MsIHRpbWVTdGF0ZSkpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobGF5ZXIubGFiZWxzKSkge1xyXG4gICAgICAgICAgICBjb25zdCByYXcgPSBidWZmZXJzICYmIGJ1ZmZlcnNbbGF5ZXIuaWRdO1xyXG4gICAgICAgICAgICBpZiAoIXJhdykgY29udGludWU7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXHJcbiAgICAgICAgICAgICAgICAocmF3LmJ5dGVMZW5ndGggfHwgcmF3Lmxlbmd0aCkgLyA4KTtcclxuICAgICAgICAgICAgY29uc3Qgd2luID0gdGltZVN0YXRlICYmIGxheWVyLnRpbWVcclxuICAgICAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZS5wZXJpb2QpXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVzID0gd2luID8gdGltZXNGb3IobGF5ZXIsIGJ1ZmZlcnMpIDogbnVsbDtcclxuICAgICAgICAgICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihsYXllci5sYWJlbHMubGVuZ3RoLCBjb29yZHMubGVuZ3RoIC8gMik7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllci5sYWJlbHNbaV0pIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVzICYmICFOdW1iZXIuaXNOYU4odGltZXNbaSAqIDJdKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGNvb3Jkc1tpICogMl0sIGxuZzogY29vcmRzW2kgKiAyICsgMV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbHNbaV0pLCBjZW50ZXI6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChsYXllci5sYWJlbCkge1xyXG4gICAgICAgICAgICBpZiAoIXRpbWVWaXNpYmxlKGxheWVyLCBidWZmZXJzLCB0aW1lU3RhdGUpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwicG9seWxpbmVcIikge1xyXG4gICAgICAgICAgICAgICAgLy8gQW5jaG9yIE9OIGEgcGFydCAtLSB0aGUgbWlkZGxlIHZlcnRleCBvZiB0aGUgbG9uZ2VzdCBwYXJ0LiBUaGVcclxuICAgICAgICAgICAgICAgIC8vIG1pZGRsZSBvZiBhIG11bHRpLXBhcnQgbGluZSdzIHdob2xlIHZlcnRleCBydW4gY2FuIHNpdCBpbiB0aGUgZ2FwXHJcbiAgICAgICAgICAgICAgICAvLyBiZXR3ZWVuIHBhcnRzLCB3aGVyZSB0aGVyZSBpcyBub3RoaW5nIHRvIGxhYmVsLlxyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFydHMgPSBsaW5lUGFydHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pO1xyXG4gICAgICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb25nZXN0ID0gcGFydHMucmVkdWNlKChiZXN0LCBwYXJ0KSA9PlxyXG4gICAgICAgICAgICAgICAgICAgIHBsYW5hckxlbmd0aChwYXJ0KSA+IHBsYW5hckxlbmd0aChiZXN0KSA/IHBhcnQgOiBiZXN0LCBwYXJ0c1swXSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtaWQgPSBsb25nZXN0W01hdGguZmxvb3IoKGxvbmdlc3QubGVuZ3RoIC0gMSkgLyAyKV07XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogbWlkWzBdLCBsbmc6IG1pZFsxXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGxheWVyLmxhYmVsKSwgY2VudGVyOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5ib3VuZHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IFtbYUxhdCwgYUxvbl0sIFtiTGF0LCBiTG9uXV0gPSBsYXllci5ib3VuZHM7XHJcbiAgICAgICAgICAgICAgICBvdXQucHVzaCh7IGxhdDogKGFMYXQgKyBiTGF0KSAvIDIsIGxuZzogKGFMb24gKyBiTG9uKSAvIDIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IFN0cmluZyhsYXllci5sYWJlbCksIGNlbnRlcjogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChsYXllci5sb2NhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgb3V0LnB1c2goeyBsYXQ6IGxheWVyLmxvY2F0aW9uWzBdLCBsbmc6IGxheWVyLmxvY2F0aW9uWzFdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBObyBib3VuZHMgb24gdGhlIGNvbmZpZyAtLSB0aGUgY29sbGVjdGlvbiBtZXJnZSBkcm9wcGVkIHRoZW0gZm9yXHJcbiAgICAgICAgICAgICAgICAvLyBpdHMgd2hvbGUgaGlzdG9yeSwgYW5kIGhhbmQtYnVpbHQgY29uZmlncyBtYXkgbmV2ZXIgY2FycnkgdGhlbS5cclxuICAgICAgICAgICAgICAgIC8vIFRoZSBjb29yZGluYXRlcyBhcmUgc3RpbGwgaW4gdGhlIGJ1ZmZlciB1bmRlciB0aGUgbGF5ZXIncyBvd24gaWQsXHJcbiAgICAgICAgICAgICAgICAvLyBleGFjdGx5IGFzIHRoZSBwb2x5bGluZSBicmFuY2ggcmVhZHMgdGhlbTsgYSBtaXNzaW5nIGJveCBtdXN0XHJcbiAgICAgICAgICAgICAgICAvLyBkZWdyYWRlIHRvIGNvbXB1dGluZyBvbmUsIG5ldmVyIHRvIHNpbGVudGx5IGRyb3BwaW5nIHRoZSBsYWJlbC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY3MgPSB2ZWN0b3JDb29yZHMobGF5ZXIsIGJ1ZmZlcnMgfHwge30pIHx8IFtdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvY3MubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICAgICAgbGV0IG1pbkxuZyA9IEluZmluaXR5LCBtYXhMbmcgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtsYXQsIGxuZ10gb2YgbG9jcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxuZyA8IG1pbkxuZykgbWluTG5nID0gbG5nO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsbmcgPiBtYXhMbmcpIG1heExuZyA9IGxuZztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG91dC5wdXNoKHsgbGF0OiAobWluTGF0ICsgbWF4TGF0KSAvIDIsIGxuZzogKG1pbkxuZyArIG1heExuZykgLyAyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBTdHJpbmcobGF5ZXIubGFiZWwpLCBjZW50ZXI6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gb3V0O1xyXG59XHJcblxyXG4vLyBSZWJ1aWxkcyBgZ3JvdXBgIChhbiBMLmxheWVyR3JvdXApIHRvIGhvbGQgZXhhY3RseSB0aGUgY3VycmVudCBsYWJlbHMsIHNraXBwaW5nXHJcbi8vIHRoZSB3b3JrIHdoZW4gbm90aGluZyBjaGFuZ2VkIC0tIHN5bmNzIHJ1biBvbiBldmVyeSB0b2dnbGUgYW5kIHRpY2suXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMYWJlbHMoTCwgZ3JvdXAsIGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCBsYWJlbHMgPSBjb2xsZWN0TGFiZWxzKGxheWVycywgYnVmZmVycywgZ3JvdXBDb25maWdzLCB0aW1lU3RhdGUpO1xyXG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkobGFiZWxzKTtcclxuICAgIGlmIChncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9PT0ga2V5KSByZXR1cm47XHJcbiAgICBncm91cC5fc3dpZnRtYXBMYWJlbEtleSA9IGtleTtcclxuICAgIGdyb3VwLmNsZWFyTGF5ZXJzKCk7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbGFiZWxzKSB7XHJcbiAgICAgICAgLy8gQ29udGVudCBhcyBhbiBlbGVtZW50IHdpdGggdGV4dENvbnRlbnQ6IHRvb2x0aXAgc3RyaW5nIGNvbnRlbnQgaXMgSFRNTCxcclxuICAgICAgICAvLyBhbmQgbGFiZWxzIGNvbWUgZnJvbSB1c2VyIGRhdGEsIHdoaWNoIG11c3QgbmV2ZXIgcGFyc2UgYXMgbWFya3VwLlxyXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcclxuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gaXRlbS50ZXh0O1xyXG4gICAgICAgIGNvbnN0IHRvb2x0aXAgPSBMLnRvb2x0aXAoe1xyXG4gICAgICAgICAgICBwZXJtYW5lbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGRpcmVjdGlvbjogaXRlbS5jZW50ZXIgPyBcImNlbnRlclwiIDogXCJ0b3BcIixcclxuICAgICAgICAgICAgY2xhc3NOYW1lOiBcInN3aWZ0bWFwLWZlYXR1cmUtbGFiZWxcIixcclxuICAgICAgICAgICAgb2Zmc2V0OiBpdGVtLmNlbnRlciA/IFswLCAwXSA6IFswLCAtNl0sXHJcbiAgICAgICAgfSkuc2V0TGF0TG5nKFtpdGVtLmxhdCwgaXRlbS5sbmddKS5zZXRDb250ZW50KHNwYW4pO1xyXG4gICAgICAgIGdyb3VwLmFkZExheWVyKHRvb2x0aXApO1xyXG4gICAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBsb2FkQ1NTLCBsb2FkSlMgfSBmcm9tIFwiLi91dGlscy5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJTaWRlYmFyQ29udHJvbHMsIG5vcm1hbGl6ZVJhZGlvTGF5ZXJzLCBzZW5kTGF5ZXJXcml0ZSB9IGZyb20gXCIuL3NpZGViYXIuanNcIjtcclxuaW1wb3J0IHsgZGVyaXZlTGVnZW5kU3BlYywgcmVuZGVyTGVnZW5kIH0gZnJvbSBcIi4vbGVnZW5kLmpzXCI7XHJcbmltcG9ydCB7IHJlbmRlckxhYmVscyB9IGZyb20gXCIuL2xhYmVscy5qc1wiO1xyXG5pbXBvcnQgeyByZW5kZXJMYXllciwgcmVuZGVyTWVyZ2VkR2xMYXllciwgcmVnaXN0ZXJDbGlja01hdGNoLCBpbWFnZU1ldGFLZXkgfSBmcm9tIFwiLi9sYXllcnMuanNcIjtcclxuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIGdlbmVyYXRlVGlja3MsIGNvbGxlY3RUaW1lRXh0ZW50LCBoYXNUaW1lTGF5ZXJzLFxyXG4gICAgICAgICBsYXllckluV2luZG93LCByZW5kZXJUaW1lQ29udHJvbCwgYWR2YW5jZSwgcGVyaW9kVG9NcywgZ2NkR3JpZE1zLFxyXG4gICAgICAgICBjb2xsZWN0RHVyYXRpb25zTXMsIFBPU0lUSU9OUywgdGltZXNGb3IsIHdpbmRvd0ZvciwgZmVhdHVyZUluV2luZG93LFxyXG4gICAgICAgICBlZmZlY3RpdmVEdXJhdGlvbiB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XHJcbmltcG9ydCB7IGdwdVRpbWVBdmFpbGFibGUsIHZlY3RvckdwdUF2YWlsYWJsZSwgTEFZRVJfU0xPVFMgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XHJcblxyXG4vLyBUcnVlIGlmIGEgbGF5ZXIgaXMgdmlzaWJsZSBhbmQgbm8gZm9sZGVyIGFib3ZlIGl0IGlzIHN3aXRjaGVkIG9mZi5cclxuLy9cclxuLy8gVmlzaWJpbGl0eSBpcyBpbmhlcml0ZWQgZG93biB0aGUgZm9sZGVyIHBhdGg6IGEgbGF5ZXIgaW5zaWRlIFwiRmVlZHMvQWN0aXZlXCIgaXMgaGlkZGVuXHJcbi8vIHdoZW4gZWl0aGVyIFwiRmVlZHNcIiBvciBcIkZlZWRzL0FjdGl2ZVwiIGlzIG9mZiwgcmVnYXJkbGVzcyBvZiBpdHMgb3duIGZsYWcuIEdldHRpbmcgdGhpc1xyXG4vLyB3cm9uZyBzaG93cyB1cCBhcyBcInRoYXQgbGF5ZXIganVzdCB3aWxsIG5vdCBhcHBlYXJcIiwgd2l0aCBub3RoaW5nIGxvZ2dlZC5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpIHtcclxuICAgIGlmIChsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcclxuICAgIGZvciAoY29uc3QgcGFydCBvZiAobGF5ZXIubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIikuc3BsaXQoXCIvXCIpKSB7XHJcbiAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XHJcbiAgICAgICAgY29uc3QgY29uZmlnID0gZ3JvdXBDb25maWdzW3J1bm5pbmdQYXRoXTtcclxuICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbi8vIFNvcnRzIHRoZSB2aXNpYmxlIGxheWVycyBpbnRvIG9uZSBidWNrZXQgcGVyIFdlYkdMIGRyYXcgcGFzcy5cclxuLy9cclxuLy8gU3ViLWxheWVycyBvZiBhIG1lcmdlZCBncm91cCBpbmhlcml0IHRoZWlyIHBhcmVudCdzIHZpc2liaWxpdHkgcmF0aGVyIHRoYW4gY2FycnlpbmdcclxuLy8gdGhlaXIgb3duLCBzbyBhIGdyb3VwIHRvZ2dsZWQgb2ZmIGNvbnRyaWJ1dGVzIG5vdGhpbmcgZXZlbiB3aGVuIGl0cyBjaGlsZHJlbiBzYXlcclxuLy8gdmlzaWJsZS4gQ2lyY2xlcyBqb2luIHRoZSBwb2x5Z29uIGJ1Y2tldDogdGhleSBhcmUgZHJhd24gYXMgZ2VuZXJhdGVkIHJpbmdzLlxyXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKSB7XHJcbiAgICBjb25zdCBidWNrZXRzID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XHJcblxyXG4gICAgZnVuY3Rpb24gY29sbGVjdChsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWJMYXllcikge1xyXG4gICAgICAgIGlmICghcGFyZW50VmlzaWJsZSkgcmV0dXJuO1xyXG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGxheWVyLmxheWVycy5mb3JFYWNoKHN1YiA9PiBjb2xsZWN0KHN1YiwgcGFyZW50VmlzaWJsZSwgdHJ1ZSkpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghaXNTdWJMYXllciAmJiBsYXllci52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuO1xyXG5cclxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xyXG4gICAgICAgIGlmIChidWNrZXRzW2J1Y2tldF0pIGJ1Y2tldHNbYnVja2V0XS5wdXNoKGxheWVyKTtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xyXG4gICAgICAgIGNvbGxlY3QobGF5ZXIsIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpLCBmYWxzZSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYnVja2V0cztcclxufVxyXG5cclxuLy8gQXBwbGllcyBpbmNyZW1lbnRhbCBwYXRjaCBvcHMgdG8ge2xheWVycywgYnVmZmVyc30sIHJldHVybmluZyB0aGUgbmV3IHN0YXRlLlxyXG4vL1xyXG4vLyBPcHMgYXJlIGFkZHJlc3NlZCBieSBsYXllciBpZCBhbmQgYXBwbGllZCBpZGVtcG90ZW50bHk6IFwiYWRkXCIgdXBzZXJ0cyByYXRoZXIgdGhhblxyXG4vLyBhcHBlbmRpbmcgYmxpbmRseSwgc28gYSBwYXRjaCB0aGF0IHJhY2VzIHRoZSBpbml0aWFsIHRyYWl0IHNuYXBzaG90IGNhbm5vdCBkdXBsaWNhdGVcclxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxyXG4vLyBBcHBsaWVzIGB1cGRhdGVgIHRvIG9uZSBsYXllciB3aGVyZXZlciBpdCBzaXRzLCBkZXNjZW5kaW5nIGludG8gZ3JvdXBzLiBhZGRfY29sbGVjdGlvblxyXG4vLyBuZXN0cyBpdHMgcG9pbnQsIGxpbmUgYW5kIHBvbHlnb24gbGF5ZXJzIGluc2lkZSBhIGdyb3VwIGxheWVyLCBzbyBhbiBvcCBhZGRyZXNzZWQgYXQgYVxyXG4vLyBuZXN0ZWQgaWQgd291bGQgb3RoZXJ3aXNlIG1hdGNoIG5vdGhpbmcgYW5kIHNpbGVudGx5IGRvIG5vdGhpbmcuIFJldHVybnMgdGhlIG9yaWdpbmFsXHJcbi8vIGFycmF5IHVudG91Y2hlZCB3aGVuIHRoZSBpZCBpcyBub3QgZm91bmQsIHNvIGFuIHVubWF0Y2hlZCBvcCBjb3N0cyBubyByZS1yZW5kZXIuXHJcbmZ1bmN0aW9uIHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIGlkLCB1cGRhdGUpIHtcclxuICAgIGxldCBoaXQgPSBmYWxzZTtcclxuICAgIGNvbnN0IG5leHQgPSBsYXllcnMubWFwKGwgPT4ge1xyXG4gICAgICAgIGlmIChsLmlkID09PSBpZCkge1xyXG4gICAgICAgICAgICBoaXQgPSB0cnVlO1xyXG4gICAgICAgICAgICByZXR1cm4gdXBkYXRlKGwpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgQXJyYXkuaXNBcnJheShsLmxheWVycykpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3VicyA9IHVwZGF0ZUxheWVyQnlJZChsLmxheWVycywgaWQsIHVwZGF0ZSk7XHJcbiAgICAgICAgICAgIGlmIChzdWJzICE9PSBsLmxheWVycykge1xyXG4gICAgICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IC4uLmwsIGxheWVyczogc3VicyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBsO1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gaGl0ID8gbmV4dCA6IGxheWVycztcclxufVxyXG5cclxuLy8gRXZlcnkgcG9pbnQgbGF5ZXIsIHZpc2libGUgb3Igbm90LCB3aXRoIGl0cyBlZmZlY3RpdmUgdmlzaWJpbGl0eSByZWNvcmRlZCAtLSB0aGVcclxuLy8gR1BVLXZpc2liaWxpdHkgcGF0aCBrZWVwcyBoaWRkZW4gbGF5ZXJzIGluIHRoZSBidWNrZXQgKHN0YWJsZSBpZHMsIG5vIHJlYnVpbGQgb24gYVxyXG4vLyB0b2dnbGUpIGFuZCBoaWRlcyB0aGVtIHdpdGggYSB1bmlmb3JtIGluc3RlYWQuIE1pcnJvcnMgY29sbGVjdFdlYmdsTGF5ZXJzJyBydWxlczpcclxuLy8gc3ViLWxheWVycyBpbmhlcml0IHRoZWlyIHBhcmVudCdzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5LCB0b3AtbGV2ZWwgbGF5ZXJzIGFuc3dlciBmb3JcclxuLy8gdGhlaXIgb3duIGZsYWcgYW5kIHRoZWlyIGZvbGRlciBjaGFpbi5cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RQb2ludExheWVyc0FsbChsYXllcnMsIGdyb3VwQ29uZmlncykge1xyXG4gICAgY29uc3Qgb3V0ID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XHJcbiAgICBmdW5jdGlvbiB3YWxrKGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1Yikge1xyXG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIgJiYgbGF5ZXIubGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNlbGZWaXMgPSBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgICAgICBsYXllci5sYXllcnMuZm9yRWFjaChzdWIgPT4gd2FsayhzdWIsIHNlbGZWaXMsIHRydWUpKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBidWNrZXQgPSBsYXllci50eXBlID09PSBcImNpcmNsZVwiID8gXCJwb2x5Z29uXCIgOiBsYXllci50eXBlO1xyXG4gICAgICAgIGlmICghb3V0W2J1Y2tldF0pIHJldHVybjtcclxuICAgICAgICBjb25zdCB2aXMgPSBpc1N1YiA/IHBhcmVudFZpc2libGVcclxuICAgICAgICAgICAgOiBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xyXG4gICAgICAgIG91dFtidWNrZXRdLnB1c2goeyBsYXllciwgdmlzIH0pO1xyXG4gICAgfVxyXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHdhbGsobGF5ZXIsIHRydWUsIGZhbHNlKTtcclxuICAgIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIEJ1ZmZlciBpZGVudGl0eSBmb3IgdGhlIEdMIG1ldGEga2V5LiBBIG5ldyBEYXRhVmlldyB1bmRlciBhIGxheWVyIGlkIC0tIGFcclxuLy8gYnVmZmVyIG9wIGZyb20gdXBkYXRlX2xheWVyKGRhdGE9Li4uKSwgb3IgdGhlIHRyYWl0IHJlc2VlZGVkIC0tIG11c3QgcmVidWlsZFxyXG4vLyB0aGUgYnVja2V0IGV2ZW4gd2hlbiB0aGUgYnl0ZSBsZW5ndGggaXMgdW5jaGFuZ2VkIChwb2ludHMgbW92ZWQsIGNvbG91cnNcclxuLy8gcmVjb21wdXRlZCkuIFRoZSBzZXJpYWwgaXMgcGVyIG9iamVjdCwgc28gYW4gdW50b3VjaGVkIGJ1ZmZlciBrZWVwcyBpdHMgbnVtYmVyXHJcbi8vIGFuZCBjb3N0cyBubyByZWJ1aWxkLiBXb3JrcyBmb3IgYW55IGNvbnN1bWVyIHRoYXQgc3dhcHMgYSBidWZmZXIsIFB5dGhvbiBvciBub3QuXHJcbmNvbnN0IGJ1ZmZlclNlcmlhbHMgPSBuZXcgV2Vha01hcCgpO1xyXG5sZXQgbmV4dEJ1ZmZlclNlcmlhbCA9IDE7XHJcbmZ1bmN0aW9uIGJ1ZmZlclNlcmlhbChidWYpIHtcclxuICAgIGlmICghYnVmIHx8IHR5cGVvZiBidWYgIT09IFwib2JqZWN0XCIpIHJldHVybiAwO1xyXG4gICAgbGV0IHNlcmlhbCA9IGJ1ZmZlclNlcmlhbHMuZ2V0KGJ1Zik7XHJcbiAgICBpZiAoIXNlcmlhbCkge1xyXG4gICAgICAgIHNlcmlhbCA9IG5leHRCdWZmZXJTZXJpYWwrKztcclxuICAgICAgICBidWZmZXJTZXJpYWxzLnNldChidWYsIHNlcmlhbCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc2VyaWFsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb25jYXRWaWV3cyhoZWFkLCB0YWlsKSB7XHJcbiAgICBjb25zdCBvdXQgPSBuZXcgVWludDhBcnJheShoZWFkLmJ5dGVMZW5ndGggKyB0YWlsLmJ5dGVMZW5ndGgpO1xyXG4gICAgb3V0LnNldChuZXcgVWludDhBcnJheShoZWFkLmJ1ZmZlciwgaGVhZC5ieXRlT2Zmc2V0LCBoZWFkLmJ5dGVMZW5ndGgpLCAwKTtcclxuICAgIG91dC5zZXQobmV3IFVpbnQ4QXJyYXkodGFpbC5idWZmZXIsIHRhaWwuYnl0ZU9mZnNldCwgdGFpbC5ieXRlTGVuZ3RoKSwgaGVhZC5ieXRlTGVuZ3RoKTtcclxuICAgIHJldHVybiBuZXcgRGF0YVZpZXcob3V0LmJ1ZmZlcik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFwcGVuZFJvd3MobGF5ZXIsIG9wKSB7XHJcbiAgICBjb25zdCBiYXNlID0gb3AuYmFzZSB8fCAwO1xyXG4gICAgY29uc3QgY291bnQgPSBvcC5jb3VudCB8fCAwO1xyXG4gICAgY29uc3QgaW5jb21pbmcgPSBvcC5wcm9wZXJ0aWVzIHx8IHt9O1xyXG4gICAgY29uc3QgcHJvcHMgPSB7IC4uLihsYXllci5wcm9wZXJ0aWVzIHx8IHt9KSB9O1xyXG4gICAgZm9yIChjb25zdCBrZXkgb2YgbmV3IFNldChbLi4uT2JqZWN0LmtleXMocHJvcHMpLCAuLi5PYmplY3Qua2V5cyhpbmNvbWluZyldKSkge1xyXG4gICAgICAgIGNvbnN0IGhlYWQgPSBBcnJheS5pc0FycmF5KHByb3BzW2tleV0pID8gcHJvcHNba2V5XVxyXG4gICAgICAgICAgICA6IG5ldyBBcnJheShiYXNlKS5maWxsKHByb3BzW2tleV0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcm9wc1trZXldKTtcclxuICAgICAgICBjb25zdCB0YWlsID0gQXJyYXkuaXNBcnJheShpbmNvbWluZ1trZXldKSA/IGluY29taW5nW2tleV0gOiBuZXcgQXJyYXkoY291bnQpLmZpbGwobnVsbCk7XHJcbiAgICAgICAgcHJvcHNba2V5XSA9IGhlYWQuY29uY2F0KHRhaWwpO1xyXG4gICAgfVxyXG4gICAgY29uc3QgbmV4dCA9IHsgLi4ubGF5ZXIsIHByb3BlcnRpZXM6IHByb3BzIH07XHJcbiAgICBmb3IgKGNvbnN0IFtmaWVsZCwgdGFpbF0gb2YgT2JqZWN0LmVudHJpZXMob3AubGlzdHMgfHwge30pKSB7XHJcbiAgICAgICAgbmV4dFtmaWVsZF0gPSAoQXJyYXkuaXNBcnJheShsYXllcltmaWVsZF0pID8gbGF5ZXJbZmllbGRdIDogW10pLmNvbmNhdCh0YWlsKTtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTd2lmdG1hcFBhdGNoKHN0YXRlLCBvcHMsIGJ1ZmZlcnMpIHtcclxuICAgIGxldCBsYXllcnMgPSBzdGF0ZS5sYXllcnMgfHwgW107XHJcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG9wIG9mIG9wcykge1xyXG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XHJcbiAgICAgICAgICAgIGxheWVycyA9IG9wLmxheWVycyB8fCBbXTtcclxuICAgICAgICAgICAgYnVmZmVyTWFwID0ge307XHJcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcnMgJiYgYnVmZmVyc1tpXSkgYnVmZmVyTWFwW2lkXSA9IGJ1ZmZlcnNbaV07XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGluY29taW5nID0gb3AubGF5ZXI7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkID0gaW5jb21pbmcgPyBpbmNvbWluZy5pZCA6IG9wLmlkO1xyXG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xyXG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xyXG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gWy4uLmxheWVycywgaW5jb21pbmddO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLm1hcCgobCwgaSkgPT4gKGkgPT09IGlkeCA/IGluY29taW5nIDogbCkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzZXRcIikge1xyXG4gICAgICAgICAgICAvLyBGaWVsZC1sZXZlbCB1cGRhdGUuIFwicmVwbGFjZVwiIGNhcnJpZXMgdGhlIHdob2xlIGxheWVyLCBzbyBmbGlwcGluZyBgdmlzaWJsZWBcclxuICAgICAgICAgICAgLy8gb24gYSA1MGstcG9pbnQgbGF5ZXIgcmVzZW50IGV2ZXJ5IHByb3BlcnR5IGl0IGhvbGRzIC0tIGhhbGYgYSBtZWdhYnl0ZSB0b1xyXG4gICAgICAgICAgICAvLyBjaGFuZ2Ugb25lIGJvb2xlYW4sIG9uIGV2ZXJ5IGNsaWNrIG9mIGEgY2hlY2tib3guXHJcbiAgICAgICAgICAgIGxheWVycyA9IHVwZGF0ZUxheWVyQnlJZChsYXllcnMsIG9wLmlkLCBsID0+ICh7IC4uLmwsIC4uLihvcC5maWVsZHMgfHwge30pIH0pKTtcclxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcInN0eWxlXCIpIHtcclxuICAgICAgICAgICAgLy8gUGVyLWZlYXR1cmUgc3R5bGUgb3ZlcnJpZGVzLCByZXBsYWNlZCB3aG9sZXNhbGUgcmF0aGVyIHRoYW4gbWVyZ2VkOiBhXHJcbiAgICAgICAgICAgIC8vIHNlbGVjdGlvbiBkZXNjcmliZXMgaXRzIGNvbXBsZXRlIHN0YXRlLCBzbyBzZW5kaW5nIHt9IGNsZWFycyBpdCBhbmQgbm9cclxuICAgICAgICAgICAgLy8gY2FsbGVyIGhhcyB0byB0cmFjayB3aGF0IHRoZSBwcmV2aW91cyBoaWdobGlnaHQgdG91Y2hlZC5cclxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHtcclxuICAgICAgICAgICAgICAgIC4uLmwsIHN0eWxlX292ZXJyaWRlczogb3Aub3ZlcnJpZGVzIHx8IHt9LFxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xyXG4gICAgICAgICAgICBsYXllcnMgPSBsYXllcnMuZmlsdGVyKGwgPT4gbC5pZCAhPT0gb3AuaWQpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyXCIpIHtcclxuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XHJcbiAgICAgICAgICAgIGlmIChidWYpIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwLCBbb3AuaWRdOiBidWYgfTtcclxuICAgICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSBcImJ1ZmZlcl9hcHBlbmRcIikge1xyXG4gICAgICAgICAgICAvLyBBIHRhaWwgZm9yIGFuIGV4aXN0aW5nIGJ1ZmZlciAtLSB0aGUgZmVlZCBwcmltaXRpdmUncyB3aXJlIHNoYXBlLFxyXG4gICAgICAgICAgICAvLyBwcm9wb3J0aW9uYWwgdG8gdGhlIGJhdGNoLiBDb25jYXRlbmF0aW9uIHlpZWxkcyBhIE5FVyBEYXRhVmlldywgYW5kXHJcbiAgICAgICAgICAgIC8vIHRoZSBHTCBtZXRhIGtleSBrZXlzIG9uIGJ1ZmZlciBpZGVudGl0eSwgc28gdGhlIGJ1Y2tldCByZWJ1aWxkcy5cclxuICAgICAgICAgICAgY29uc3QgdGFpbCA9IGJ1ZmZlcnMgJiYgYnVmZmVyc1tvcC5idWZmZXJfaW5kZXhdO1xyXG4gICAgICAgICAgICBpZiAodGFpbCkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaGVhZCA9IGJ1ZmZlck1hcFtvcC5pZF07XHJcbiAgICAgICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogaGVhZCA/IGNvbmNhdFZpZXdzKGhlYWQsIHRhaWwpIDogdGFpbCB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJhcHBlbmRcIikge1xyXG4gICAgICAgICAgICAvLyBOZXcgcm93cyBmb3IgdGhlIHByb3BlcnR5IGxpc3RzIChhbmQgb3RoZXIgcGVyLWZlYXR1cmUgbGlzdHMpLCBhZnRlclxyXG4gICAgICAgICAgICAvLyB0aGUgZXhpc3Rpbmcgb25lcy4gQ29sdW1ucyBtaXNzaW5nIG9uIGVpdGhlciBzaWRlIGZpbGwgbnVsbCwgZXhhY3RseVxyXG4gICAgICAgICAgICAvLyBhcyB0aGUgUHl0aG9uIHNpZGUgZG9lcywgc28gYSBsYXRlciBwb3B1cCByZWFkcyB0aGUgc2FtZSB0YWJsZS5cclxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gYXBwZW5kUm93cyhsLCBvcCkpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX3JlbW92ZVwiKSB7XHJcbiAgICAgICAgICAgIGJ1ZmZlck1hcCA9IHsgLi4uYnVmZmVyTWFwIH07XHJcbiAgICAgICAgICAgIGRlbGV0ZSBidWZmZXJNYXBbb3AuaWRdO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4geyBsYXllcnMsIGJ1ZmZlcnM6IGJ1ZmZlck1hcCB9O1xyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCB7XHJcbiAgICBhc3luYyByZW5kZXIoeyBtb2RlbCwgZWwgfSkge1xyXG4gICAgICAgIGNvbnN0IG9yaWdpbmFsRXJyb3IgPSBjb25zb2xlLmVycm9yO1xyXG4gICAgICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcclxuXHJcbiAgICAgICAgLy8ganNfY29uc29sZV9sb2dzIGlzIGEgc3luY2VkIGxpc3QsIHNvIGVhY2ggYXBwZW5kIHJlc2VuZHMgdGhlIHdob2xlIGFycmF5LiBLZWVwaW5nXHJcbiAgICAgICAgLy8gb25seSB0aGUgbW9zdCByZWNlbnQgZW50cmllcyBib3VuZHMgYm90aCB0aGUgcGF5bG9hZCBhbmQgdGhlIG1lbW9yeSBhIGxvbmctbGl2ZWRcclxuICAgICAgICAvLyBzZXNzaW9uIGFjY3VtdWxhdGVzOyB0aGUgbmV3ZXN0IGFyZSB0aGUgb25lcyB3b3J0aCBoYXZpbmcgYW55d2F5LlxyXG4gICAgICAgIGNvbnN0IE1BWF9DT05TT0xFX0xPR1MgPSAyMDA7XHJcbiAgICAgICAgY29uc3QgYXBwZW5kTG9nID0gZW50cnkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBsb2dzID0gbW9kZWwuZ2V0KFwianNfY29uc29sZV9sb2dzXCIpIHx8IFtdO1xyXG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gWy4uLmxvZ3MsIGVudHJ5XTtcclxuICAgICAgICAgICAgcmV0dXJuIG5leHQubGVuZ3RoID4gTUFYX0NPTlNPTEVfTE9HUyA/IG5leHQuc2xpY2UoLU1BWF9DT05TT0xFX0xPR1MpIDogbmV4dDtcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICAvLyBIZWxwZXIgdG8gc2FmZWx5IHdyaXRlIGJhY2sgdG8gUHl0aG9uIG9ubHkgaWYgdGhlIHdpZGdldCB2aWV3IGlzIGFjdGl2ZSBhbmQgYXR0YWNoZWRcclxuICAgICAgICBmdW5jdGlvbiBzYWZlU2V0QW5kU2F2ZShrZXksIHZhbHVlKSB7XHJcbiAgICAgICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoa2V5LCB2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyB3cml0ZSBlcnJvcjpcIiwgZSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcclxuICAgICAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgc2F2ZSBlcnJvcjpcIiwgZSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IgPSBmdW5jdGlvbiguLi5hcmdzKSB7XHJcbiAgICAgICAgICAgIG9yaWdpbmFsRXJyb3IuYXBwbHkoY29uc29sZSwgYXJncyk7XHJcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXHJcbiAgICAgICAgICAgICAgICBhcHBlbmRMb2coXCJDT05TT0xFLkVSUk9SOiBcIiArIGFyZ3MubWFwKGEgPT4gU3RyaW5nKGEpKS5qb2luKFwiIFwiKSkpO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgbGV0IGxvZ2dlZFJlcHJvamVjdGVkID0gZmFsc2U7XHJcbiAgICAgICAgY29uc29sZS53YXJuID0gZnVuY3Rpb24oLi4uYXJncykge1xyXG4gICAgICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XHJcbiAgICAgICAgICAgIGlmIChtc2cuaW5jbHVkZXMoXCJsYXllciBkZXNpZ25lZCBmb3IgU3BoZXJpY2FsTWVyY2F0b3JcIikgfHwgbXNnLmluY2x1ZGVzKFwiYWx0ZXJuYXRlIGRldGVjdGVkXCIpKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWxvZ2dlZFJlcHJvamVjdGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNycyA9IG1vZGVsLmdldChcImNyc1wiKSB8fCBcIkVQU0c6Mzg1N1wiO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsZWFuTXNnID0gYFtTd2lmdE1hcF0gTGF5ZXIgd2FzIHJlcHJvamVjdGVkIHRvIFwiJHtjcnN9XCJgO1xyXG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLCBhcHBlbmRMb2coY2xlYW5Nc2cpKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gc3VwcHJlc3MgZHVwbGljYXRlIGNvbnNvbGUgd2FybmluZ3NcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBvcmlnaW5hbFdhcm4uYXBwbHkoY29uc29sZSwgYXJncyk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgd2luZG93Lm9uZXJyb3IgPSBmdW5jdGlvbihtZXNzYWdlLCBzb3VyY2UsIGxpbmVubywgY29sbm8sIGVycm9yKSB7XHJcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXHJcbiAgICAgICAgICAgICAgICBhcHBlbmRMb2coYFdJTkRPVy5PTkVSUk9SOiAke21lc3NhZ2V9IGF0ICR7c291cmNlfToke2xpbmVub306JHtjb2xub31gKSk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gTG9hZCBDU1MgYW5kIExlYWZsZXQgbGlicmFyaWVzIChpbmNsdWRpbmcgV2ViR0wgZ2xpZnkpXHJcbiAgICAgICAgbG9hZENTUyhcImxlYWZsZXQtY3NzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuY3NzXCIpO1xyXG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtanNcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0QDEuOS40L2Rpc3QvbGVhZmxldC5qc1wiKTtcclxuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdsaWZ5XCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldC5nbGlmeUAzLjMuMC9kaXN0L2dsaWZ5LWJyb3dzZXIuanNcIik7XHJcbiAgICAgICAgLy8gR2VvbWFuIG11c3QgbG9hZCBCRUZPUkUgdGhlIG1hcCBpcyBjb25zdHJ1Y3RlZDogaXQgYXR0YWNoZXMgbWFwLnBtIHRocm91Z2hcclxuICAgICAgICAvLyBhIExlYWZsZXQgaW5pdCBob29rLCB3aGljaCBvbmx5IHJ1bnMgZm9yIG1hcHMgY3JlYXRlZCBhZnRlciB0aGUgcGx1Z2luXHJcbiAgICAgICAgLy8gZXhpc3RzIC0tIGxhenktbG9hZGluZyBpdCBsYXRlciBsZWF2ZXMgbWFwLnBtIHVuZGVmaW5lZCBmb3JldmVyLlxyXG4gICAgICAgIGxvYWRDU1MoXCJsZWFmbGV0LWdlb21hbi1jc3NcIixcclxuICAgICAgICAgICAgXCJodHRwczovL3VucGtnLmNvbS9AZ2VvbWFuLWlvL2xlYWZsZXQtZ2VvbWFuLWZyZWVAMi4xOC4zL2Rpc3QvbGVhZmxldC1nZW9tYW4uY3NzXCIpO1xyXG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2VvbWFuXCIsXHJcbiAgICAgICAgICAgIFwiaHR0cHM6Ly91bnBrZy5jb20vQGdlb21hbi1pby9sZWFmbGV0LWdlb21hbi1mcmVlQDIuMTguMy9kaXN0L2xlYWZsZXQtZ2VvbWFuLm1pbi5qc1wiKTtcclxuXHJcbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUucG9zaXRpb24gPSBcInJlbGF0aXZlXCI7XHJcbiAgICAgICAgZWwuYXBwZW5kQ2hpbGQoY29udGFpbmVyKTtcclxuXHJcbiAgICAgICAgLy8gTWFwKGhlaWdodD0uLi4pIHNpemluZy4gQW4gZXhwbGljaXQgaGVpZ2h0IGFsc28gZHJvcHMgdGhlIHN0eWxlc2hlZXQnc1xyXG4gICAgICAgIC8vIDQwMHB4IGZsb29yIC0tIGFuIGV4cGxpY2l0IDIwMHB4IG11c3Qgbm90IGxvc2UgdG8gYSBkZWZhdWx0IG1pbmltdW0uXHJcbiAgICAgICAgLy8gSGVpZ2h0IHdhcyBhY2NlcHRlZCBhbmQgZG9jdW1lbnRlZCBsb25nIGJlZm9yZSBpdCByZWFjaGVkIHRoZSBET007IHRoaXNcclxuICAgICAgICAvLyBpcyB3aGVyZSBpdCBmaW5hbGx5IGRvZXMuXHJcbiAgICAgICAgZnVuY3Rpb24gYXBwbHlIZWlnaHQoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGggPSBtb2RlbC5nZXQoXCJoZWlnaHRcIik7XHJcbiAgICAgICAgICAgIGNvbnRhaW5lci5zdHlsZS5oZWlnaHQgPSBoIHx8IFwiMTAwJVwiO1xyXG4gICAgICAgICAgICBjb250YWluZXIuc3R5bGUubWluSGVpZ2h0ID0gaCA/IFwiMFwiIDogXCJcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgYXBwbHlIZWlnaHQoKTtcclxuXHJcbiAgICAgICAgbGV0IGxhYmVsc0dyb3VwID0gbnVsbDsgICAvLyBjcmVhdGVkIGFmdGVyIHRoZSBtYXA7IGZpbGxlZCBieSBlYWNoIHN5bmNcclxuXHJcbiAgICAgICAgY29uc3QgY3JzTmFtZSA9IG1vZGVsLmdldChcImNyc1wiKTtcclxuICAgICAgICBsZXQgbWFwQ3JzID0gTC5DUlMuRVBTRzM4NTc7XHJcbiAgICAgICAgaWYgKGNyc05hbWUgPT09IFwiRVBTRzo0MzI2XCIpIHtcclxuICAgICAgICAgICAgbWFwQ3JzID0gTC5DUlMuRVBTRzQzMjY7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtYXAgPSBMLm1hcChjb250YWluZXIsIHtcclxuICAgICAgICAgICAgY3JzOiBtYXBDcnMsXHJcbiAgICAgICAgICAgIGNlbnRlcjogbW9kZWwuZ2V0KFwiY2VudGVyXCIpLFxyXG4gICAgICAgICAgICB6b29tOiBtb2RlbC5nZXQoXCJ6b29tXCIpLFxyXG4gICAgICAgICAgICBzY3JvbGxXaGVlbFpvb206IHRydWUsXHJcbiAgICAgICAgICAgIHByZWZlckNhbnZhczogdHJ1ZVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgY3VzdG9tIHBhbmVzIGZvciBzdHJpY3QgWi1pbmRleCBvcmRlcmluZ1xyXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWdvbnNQYW5lXCIpO1xyXG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9seWdvbnNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDEwXCI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5bGluZXNQYW5lXCIpO1xyXG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9seWxpbmVzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQyMFwiO1xyXG4gICAgICAgIFxyXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9pbnRzUGFuZVwiKTtcclxuICAgICAgICBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MzBcIjtcclxuXHJcbiAgICAgICAgLy8gRHJhd24gdmVjdG9ycyBsaXZlIEFCT1ZFIHRoZSBHTCBwYW5lcy4gR2VvbWFuIGRlZmF1bHRzIHRoZW0gaW50byBMZWFmbGV0J3NcclxuICAgICAgICAvLyBvdmVybGF5UGFuZSAoNDAwKSwgd2hpY2ggc2l0cyB1bmRlciB0aGUgR0wgY2FudmFzZXMgKDQxMC80MjAvNDMwKSB3aG9zZVxyXG4gICAgICAgIC8vIHBvaW50ZXItZXZlbnRzIGFyZSBmb3JjZWQgb24gLS0gc28gd2l0aCBhbnkgR0wgbGF5ZXIgcHJlc2VudCwgY2xpY2tzIG1lYW50XHJcbiAgICAgICAgLy8gZm9yIGEgZHJhd24gc2hhcGUgbmV2ZXIgYXJyaXZlZDogZHJhd2luZyB3b3JrZWQgKEdlb21hbiBsaXN0ZW5zIG9uIHRoZVxyXG4gICAgICAgIC8vIGNvbnRhaW5lcikgd2hpbGUgcmVtb3ZhbCwgZWRpdCBhbmQgZHJhZyBzaWxlbnRseSBkaWQgbm90aGluZy5cclxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInN3aWZ0bWFwRHJhd1BhbmVcIik7XHJcbiAgICAgICAgbWFwLmdldFBhbmUoXCJzd2lmdG1hcERyYXdQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDQwXCI7XHJcblxyXG4gICAgICAgIGxhYmVsc0dyb3VwID0gTC5sYXllckdyb3VwKCkuYWRkVG8obWFwKTtcclxuXHJcbiAgICAgICAgLy8gTG9jYWwgbWlycm9ycyBvZiB0aGUgbGF5ZXIgbGlzdCBhbmQgY29vcmRpbmF0ZSBidWZmZXJzLlxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gUHl0aG9uIHVwZGF0ZXMgdGhlc2UgaW5jcmVtZW50YWxseSB2aWEgXCJzd2lmdG1hcF9wYXRjaFwiIG1lc3NhZ2VzIGluc3RlYWQgb2ZcclxuICAgICAgICAvLyByZWFzc2lnbmluZyB0aGUgdHJhaXRzLCBiZWNhdXNlIGEgdHJhaXQgcmVhc3NpZ25tZW50IHJlLXNlcmlhbGl6ZXMgYW5kIHJlLXNlbmRzXHJcbiAgICAgICAgLy8gdGhlIGVudGlyZSBtYXAgb24gZXZlcnkgbXV0YXRpb24uIFRoZSB0cmFpdHMgc3RpbGwgY2FycnkgdGhlIGluaXRpYWwgc25hcHNob3RcclxuICAgICAgICAvLyB3aGVuIGEgdmlldyBhdHRhY2hlcywgYW5kIHRoZSBzaWRlYmFyIHN0aWxsIHdyaXRlcyBgbGF5ZXJzYCBiYWNrIG9uIHRvZ2dsZSwgc29cclxuICAgICAgICAvLyBib3RoIGFyZSBzZWVkZWQgaGVyZSBhbmQga2VwdCBpbiBzdGVwIGJ5IHRoZSBjaGFuZ2UgaGFuZGxlcnMgZnVydGhlciBkb3duLlxyXG4gICAgICAgIGxldCBsYXllclN0YXRlID0gbW9kZWwuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xyXG4gICAgICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gYXBwbHlQYXRjaE9wcyhvcHMsIGJ1ZmZlcnMpIHtcclxuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcclxuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG5leHQubGF5ZXJzO1xyXG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IG5leHQuYnVmZmVycztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIExpdmUgZmVhdHVyZSB2aXNpYmlsaXR5LCBmb3IgaGl0LXRlc3RpbmcuIEdQVS1wYXRoIGJ1Y2tldHMga2VlcCBFVkVSWVxyXG4gICAgICAgIC8vIGxheWVyIC0tIGhpZGRlbiBvbmVzIGFyZSBtYXNrZWQgYnkgYSBzaGFkZXIgdW5pZm9ybSAtLSBhbmQgZ2xpZnknc1xyXG4gICAgICAgIC8vIGhpdC10ZXN0cyBydW4gYWdhaW5zdCB0aGUgYnVja2V0J3MgZGF0YSwgd2hpY2ggY2Fubm90IHNlZSB1bmlmb3JtczogYVxyXG4gICAgICAgIC8vIHJhZGlvLWhpZGRlbiBsYXllcidzIGZlYXR1cmVzIHN0aWxsIHdvbiBjbGlja3MgYW5kIGFuc3dlcmVkIHdpdGggcG9wdXBzLlxyXG4gICAgICAgIC8vIExvb2tlZCB1cCBmcmVzaCBwZXIgZXZlbnQsIGJlY2F1c2UgdGhlIGNvbmZpZyBjYXB0dXJlZCBhdCBidWlsZCB0aW1lIGdvZXNcclxuICAgICAgICAvLyBzdGFsZSB0aGUgbW9tZW50IGEgcGF0Y2ggb3AgcmVwbGFjZXMgaXQ7IHRoZSB0aW1lIGNoZWNrIHJlYWRzIHRoZSBsaXZlXHJcbiAgICAgICAgLy8gdGljayB0aGUgc2FtZSB3YXksIHNpbmNlIHRpY2tzIGNoYW5nZSB3aXRob3V0IHJlYnVpbGRpbmcgdGhlIGJ1Y2tldC5cclxuICAgICAgICBmdW5jdGlvbiBmaW5kTGF5ZXJOb3cobGlzdCwgaWQpIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBsIG9mIGxpc3QpIHtcclxuICAgICAgICAgICAgICAgIGlmIChsLmlkID09PSBpZCkgcmV0dXJuIGw7XHJcbiAgICAgICAgICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzdWIgPSBmaW5kTGF5ZXJOb3cobC5sYXllcnMgfHwgW10sIGlkKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3ViKSByZXR1cm4gc3ViO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmdW5jdGlvbiBmZWF0dXJlVmlzaWJsZU5vdyhsYXllciwgaW5kZXgpIHtcclxuICAgICAgICAgICAgY29uc3QgY3VycmVudCA9IGZpbmRMYXllck5vdyhsYXllclN0YXRlLCBsYXllci5pZCkgfHwgbGF5ZXI7XHJcbiAgICAgICAgICAgIGlmICghaXNMYXllckVmZmVjdGl2ZVZpc2libGUoY3VycmVudCwgbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fSkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoIWN1cnJlbnQudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihjdXJyZW50LCBidWZmZXJTdGF0ZSk7XHJcbiAgICAgICAgICAgIGlmICghdGltZXMpIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICBjb25zdCB3aW4gPSB3aW5kb3dGb3IodGltZVN0YXRlLnRpY2ssXHJcbiAgICAgICAgICAgICAgICBlZmZlY3RpdmVEdXJhdGlvbihjdXJyZW50LCB0aW1lU3RhdGUpLCB0aW1lU3RhdGUucGVyaW9kKTtcclxuICAgICAgICAgICAgaWYgKGluZGV4ICE9IG51bGwgJiYgdGltZXMubGVuZ3RoID4gMikge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSB0aW1lc1tpbmRleCAqIDJdO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIE51bWJlci5pc05hTihzdGFydClcclxuICAgICAgICAgICAgICAgICAgICB8fCBmZWF0dXJlSW5XaW5kb3coc3RhcnQsIHRpbWVzW2luZGV4ICogMiArIDFdLCB3aW4pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGltZXMubGVuZ3RoOyBpICs9IDIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4odGltZXNbaV0pXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHx8IGZlYXR1cmVJbldpbmRvdyh0aW1lc1tpXSwgdGltZXNbaSArIDFdLCB3aW4pKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBhY3RpdmVUaWxlTGF5ZXJzID0ge307XHJcbiAgICAgICAgY29uc3QgYWN0aXZlT3ZlcmxheUxheWVycyA9IHt9O1xyXG4gICAgICAgIGNvbnN0IGdsU3RhdGVzID0ge1xyXG4gICAgICAgICAgICBjaXJjbGVfbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXHJcbiAgICAgICAgICAgIG1hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxyXG4gICAgICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXHJcbiAgICAgICAgICAgIHBvbHlnb246IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlci4gYHRpbWVTdGF0ZWAgaXMgd2hhdCByZW5kZXJpbmcgcmVhZHMgLS0gdGhlIGN1cnJlbnQgdGlja1xyXG4gICAgICAgIC8vIGFuZCB0aGUgcGVyaW9kLCBvciBudWxsIHdoZW4gbm90aGluZyBpcyBhbmltYXRlZCAtLSBhbmQgYHRpbWVVSWAgaXMgdGhlIHNsaWRlcidzXHJcbiAgICAgICAgLy8gb3duIGJvb2trZWVwaW5nLiBQbGF5YmFjayBuZXZlciByb3VuZC10cmlwcyB0aHJvdWdoIFB5dGhvbjogdGlja3MgcmUtcmVuZGVyXHJcbiAgICAgICAgLy8gbG9jYWxseSwgYW5kIHRpbWVfY3VycmVudCBpcyB3cml0dGVuIGJhY2sgYXQgbW9zdCBvbmNlIGEgc2Vjb25kIHdoaWxlIHBsYXlpbmcuXHJcbiAgICAgICAgbGV0IHRpbWVTdGF0ZSA9IG51bGw7XHJcbiAgICAgICAgY29uc3QgdGltZVVJID0geyB0aWNrczogW10sIGtleTogXCJcIiwgaW5kZXg6IDAsIHBsYXlpbmc6IGZhbHNlLCBsb29wOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiAxLCB0aW1lcjogbnVsbCwgbGFzdFdyaXRlOiAwLCBzdGFydGVkOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdzogbnVsbCwgcGVyaW9kTXM6IG51bGwsIGdyaWRNczogbnVsbCB9O1xyXG5cclxuICAgICAgICBmdW5jdGlvbiBzdG9wUGxheWJhY2soKSB7XHJcbiAgICAgICAgICAgIGlmICh0aW1lVUkudGltZXIpIGNsZWFySW50ZXJ2YWwodGltZVVJLnRpbWVyKTtcclxuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gbnVsbDtcclxuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSBmYWxzZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHdyaXRlVGltZUN1cnJlbnQoZm9yY2UpIHtcclxuICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICAgICAgaWYgKCFmb3JjZSAmJiBub3cgLSB0aW1lVUkubGFzdFdyaXRlIDwgMTAwMCkgcmV0dXJuO1xyXG4gICAgICAgICAgICB0aW1lVUkubGFzdFdyaXRlID0gbm93O1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwidGltZV9jdXJyZW50XCIsIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kICovIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHNlZWtUbyhpbmRleCwgeyB3cml0ZSA9IHRydWUgfSA9IHt9KSB7XHJcbiAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkpO1xyXG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2Q6IHRpbWVTdGF0ZS5wZXJpb2QsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93OiB0aW1lVUkud2luZG93IH07XHJcbiAgICAgICAgICAgIGlmICh3cml0ZSkgd3JpdGVUaW1lQ3VycmVudCghdGltZVVJLnBsYXlpbmcpO1xyXG4gICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHN0YXJ0UGxheWJhY2soKSB7XHJcbiAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICB0aW1lVUkucGxheWluZyA9IHRydWU7XHJcbiAgICAgICAgICAgIHRpbWVVSS50aW1lciA9IHNldEludGVydmFsKCgpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhZHZhbmNlKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCwgdGltZVVJLmxvb3ApO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFuZXh0LnBsYXlpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICBzdG9wUGxheWJhY2soKTtcclxuICAgICAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgc2Vla1RvKG5leHQuaW5kZXgpO1xyXG4gICAgICAgICAgICB9LCAxMDAwIC8gdGltZVVJLnNwZWVkKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHRpbWVIYW5kbGVycyA9IHtcclxuICAgICAgICAgICAgb25TZWVrOiAoaW5kZXgpID0+IHNlZWtUbyhpbmRleCksXHJcbiAgICAgICAgICAgIG9uU3RlcEJhY2s6ICgpID0+IHNlZWtUbyh0aW1lVUkuaW5kZXggLSAxKSxcclxuICAgICAgICAgICAgb25TdGVwRm9yd2FyZDogKCkgPT4gc2Vla1RvKHRpbWVVSS5pbmRleCArIDEpLFxyXG4gICAgICAgICAgICBvblBsYXlUb2dnbGU6ICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHN0YXJ0T3ZlciwgYXMgdGhlIGZvbGl1bSBwbGF5ZXIgd2FzIGNvbmZpZ3VyZWQ6IHByZXNzaW5nIHBsYXkgYXRcclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGUgZW5kIHJlc3RhcnRzIGZyb20gdGhlIGJlZ2lubmluZyBpbW1lZGlhdGVseSwgcmF0aGVyIHRoYW4gb25lXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gc2lsZW50IGludGVydmFsIGxhdGVyIGRlY2lkaW5nIHRoZXJlIGlzIG5vd2hlcmUgdG8gZ28gYW5kIHN0b3BwaW5nLlxyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aW1lVUkuaW5kZXggPj0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpIHNlZWtUbygwKTtcclxuICAgICAgICAgICAgICAgICAgICBzdGFydFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBvbkxvb3BUb2dnbGU6ICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5sb29wID0gIXRpbWVVSS5sb29wO1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb25TcGVlZDogKHNwZWVkKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBzcGVlZDtcclxuICAgICAgICAgICAgICAgIGlmICh0aW1lVUkucGxheWluZykgc3RhcnRQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvLyBMaXZlIGR1cmluZyB0aGUgZHJhZzogbG9jYWwgc3RhdGUgYW5kIGEgcmUtcmVuZGVyIG9mIHRoZSBjb250cm9sIG9uIGV2ZXJ5XHJcbiAgICAgICAgICAgIC8vIG1vdmUsIGJ1dCBtYXAgcmVidWlsZHMgYXQgbW9zdCBldmVyeSAzMDBtcy4gQXQgNU0gcG9pbnRzIGEgcmVidWlsZCBjb3N0c1xyXG4gICAgICAgICAgICAvLyBzZWNvbmRzLCBhbmQgYSBkcmFnIGZpcmVzIGRvemVucyBvZiBtb3ZlcyAtLSB1bnRocm90dGxlZCwgdGhlIHJlYnVpbGRzXHJcbiAgICAgICAgICAgIC8vIHN0YWNrIGZhc3RlciB0aGFuIHRoZXkgZmluaXNoIGFuZCB0aGUgYWxsb2NhdGlvbiBjaHVybiBjcmFzaGVzIHRoZSB0YWIuXHJcbiAgICAgICAgICAgIG9uV2luZG93RHJhZzogKGlzbykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLmRyYWdBY3RpdmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGlzbztcclxuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHRpbWVTdGF0ZSA9IHsgLi4udGltZVN0YXRlLCB3aW5kb3c6IGlzbyB9O1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgICAgICAgICBpZiAobm93IC0gKHRpbWVVSS5sYXN0RHJhZ1N5bmMgfHwgMCkgPj0gMzAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLmxhc3REcmFnU3luYyA9IG5vdztcclxuICAgICAgICAgICAgICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gT24gcmVsZWFzZSAob3IgYSBrZXlib2FyZCBzdGVwKTogdGhlIG92ZXJyaWRlIGxhbmRzIGluIHRpbWVfY29uZmlnIHNvXHJcbiAgICAgICAgICAgIC8vIFB5dGhvbiBhbmQgU2hpbnkgc2VlIHRoZSBzYW1lIHdpbmRvdyB0aGUgYmFyIHNob3dzLiBudWxsIGNsZWFycyB0aGUga2V5LFxyXG4gICAgICAgICAgICAvLyBoYW5kaW5nIGNvbnRyb2wgYmFjayB0byBwZXItbGF5ZXIgZHVyYXRpb25zLlxyXG4gICAgICAgICAgICBvbldpbmRvd0NvbW1pdDogKGlzbykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGltZUhhbmRsZXJzLm9uV2luZG93RHJhZyhpc28pO1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLmRyYWdBY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpOyAgICAgICAvLyB0aGUgcmVsZWFzZSBhbHdheXMgbGFuZHMsIHRocm90dGxlIG9yIG5vdFxyXG4gICAgICAgICAgICAgICAgY29uc3QgY2ZnID0geyAuLi4obW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge30pIH07XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNvKSBjZmcud2luZG93ID0gaXNvO1xyXG4gICAgICAgICAgICAgICAgZWxzZSBkZWxldGUgY2ZnLndpbmRvdztcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwidGltZV9jb25maWdcIiwgY2ZnKTtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBsb2NhbCBtb2RlbCBzdGlsbCBob2xkcyBpdCAqLyB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlcywgcmV0dW5lcyBvciByZW1vdmVzIHRoZSBzbGlkZXIgdG8gbWF0Y2ggdGhlIGxheWVycyBwcmVzZW50LiBUaWNrcyBhcmVcclxuICAgICAgICAvLyByZWdlbmVyYXRlZCBvbmx5IHdoZW4gdGhlIGRhdGEncyB0aW1lIGV4dGVudCBvciB0aGUgcGVyaW9kIGNoYW5nZXMsIHNvIGFcclxuICAgICAgICAvLyBwbGF5YmFjayB0aWNrIC0tIHdoaWNoIHJlLWVudGVycyBoZXJlIHZpYSBxdWV1ZVN5bmMgLS0gZG9lcyBub3QgcmVidWlsZCB0aGVtLlxyXG4gICAgICAgIGZ1bmN0aW9uIHVwZGF0ZVRpbWVEaW1lbnNpb24oKSB7XHJcbiAgICAgICAgICAgIGlmICghaGFzVGltZUxheWVycyhsYXllclN0YXRlKSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB7IHRpY2tzOiBbXSB9LCB0aW1lSGFuZGxlcnMpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRpbWVTdGF0ZSA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLmtleSA9IFwiXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zdCBjZmcgPSBtb2RlbC5nZXQoXCJ0aW1lX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICAgICAgY29uc3QgcGVyaW9kID0gcGFyc2VQZXJpb2QoY2ZnLnBlcmlvZCB8fCBcIlAxRFwiKSB8fCBwYXJzZVBlcmlvZChcIlAxRFwiKTtcclxuICAgICAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xyXG4gICAgICAgICAgICBpZiAoIWV4dGVudCkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7ZXh0ZW50Lm1pbn18JHtleHRlbnQubWF4fXwke2NmZy5wZXJpb2QgfHwgXCJQMURcIn1gO1xyXG4gICAgICAgICAgICBpZiAoa2V5ICE9PSB0aW1lVUkua2V5KSB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0ga2V5O1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLnRpY2tzID0gZ2VuZXJhdGVUaWNrcyhleHRlbnQubWluLCBleHRlbnQubWF4LCBwZXJpb2QpO1xyXG4gICAgICAgICAgICAgICAgdGltZVVJLmluZGV4ID0gTWF0aC5taW4odGltZVVJLmluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFRoZSBzaGFyZWQgd2luZG93IG92ZXJyaWRlLCBjb25maWctZHJpdmVuOyBhIGJhZCBzdHJpbmcgY2xlYXJzIHJhdGhlciB0aGFuXHJcbiAgICAgICAgICAgIC8vIGd1ZXNzaW5nLiBUaGUgZHJhZyBncmlkIGlzIHRoZSBnY2Qgb2YgdGhlIGludGVydmFsIGFuZCBldmVyeSBhdHRhY2hlZFxyXG4gICAgICAgICAgICAvLyBkdXJhdGlvbiAtLSB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gYWxsIG9mIHRoZW0gLS0gc28gYSAyLjVoIHRyYWlsXHJcbiAgICAgICAgICAgIC8vIGlzIGRyYWdnYWJsZSBvbiBhIDFoIGJhci4gQ2FsZW5kYXIgcGVyaW9kcyBoYXZlIG5vIGZpeGVkIHdpZHRoOyB0aGUgcnVsZXJcclxuICAgICAgICAgICAgLy8gdGhlbiBzaG93cyBpbnRlcnZhbCBtYXJrcyBvbmx5IGFuZCB0aGUgdHJhaWwgaGFuZGxlIGhpZGVzLlxyXG4gICAgICAgICAgICAvLyBOZXZlciB3aGlsZSBhIGRyYWcgaXMgbGl2ZTogdGhlIGRyYWdnZWQgd2luZG93IGV4aXN0cyBvbmx5IGxvY2FsbHkgdW50aWxcclxuICAgICAgICAgICAgLy8gcmVsZWFzZSBjb21taXRzIGl0LCBhbmQgcmVhZGluZyBjb25maWcgaGVyZSBtaWQtZHJhZyByZXNldCB0aGUgaGFuZGxlIHRvXHJcbiAgICAgICAgICAgIC8vIFwibm8gd2luZG93XCIgb24gZXZlcnkgZGVib3VuY2VkIHN5bmMgLS0gdGhlIGhhbmRsZSBmb2xsb3dlZCB0aGUgbW91c2UsIHRoZW5cclxuICAgICAgICAgICAgLy8gc25hcHBlZCBob21lLCB0aGVuIGZvbGxvd2VkIGFnYWluLCBvbmNlIHBlciBzeW5jLlxyXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5kcmFnQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkud2luZG93ID0gY2ZnLndpbmRvdyAmJiBwYXJzZVBlcmlvZChjZmcud2luZG93KSA/IGNmZy53aW5kb3cgOiBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRpbWVVSS5wZXJpb2RNcyA9IHBlcmlvZFRvTXMocGVyaW9kKTtcclxuICAgICAgICAgICAgdGltZVVJLmdyaWRNcyA9IHRpbWVVSS5wZXJpb2RNc1xyXG4gICAgICAgICAgICAgICAgPyBnY2RHcmlkTXModGltZVVJLnBlcmlvZE1zLCBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJTdGF0ZSwgdGltZVVJLndpbmRvdykpXHJcbiAgICAgICAgICAgICAgICA6IG51bGw7XHJcblxyXG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QsIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xyXG4gICAgICAgICAgICB0aW1lVUkucG9zaXRpb24gPSBjZmcucG9zaXRpb24gfHwgXCJ0b3AtY2VudGVyXCI7XHJcblxyXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5zdGFydGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBjZmcuc3BlZWQgfHwgMTtcclxuICAgICAgICAgICAgICAgIHRpbWVVSS5sb29wID0gQm9vbGVhbihjZmcubG9vcCk7XHJcbiAgICAgICAgICAgICAgICAvLyBPbmx5IHRoZSBmaXJzdCBjb25maWd1cmF0aW9uIG1heSBhdXRvLXN0YXJ0LiBFdmVyeSBjb25maWcgY2hhbmdlIHJlc2V0c1xyXG4gICAgICAgICAgICAgICAgLy8gYHN0YXJ0ZWRgIHRvIHJlLXJlYWQgc3BlZWQgYW5kIGxvb3AgLS0gaW5jbHVkaW5nIHRoZSBjaGFuZ2UgYSB3aW5kb3dcclxuICAgICAgICAgICAgICAgIC8vIGRyYWcgY29tbWl0cyAtLSBhbmQgcmUtcnVubmluZyBhdXRvX3BsYXkgdGhlcmUgd291bGQgc3RhcnQgcGxheWJhY2sgYXNcclxuICAgICAgICAgICAgICAgIC8vIGEgc2lkZSBlZmZlY3Qgb2YgcmVsZWFzaW5nIHRoZSBoYW5kbGUuXHJcbiAgICAgICAgICAgICAgICBpZiAoY2ZnLmF1dG9fcGxheSAmJiAhdGltZVVJLmV2ZXJTdGFydGVkKSBzdGFydFBsYXliYWNrKCk7XHJcbiAgICAgICAgICAgICAgICB0aW1lVUkuZXZlclN0YXJ0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTaWRlYmFyIExheWVycyBDb250cm9sIFVJXHJcbiAgICAgICAgY29uc3Qgc2lkZWJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgc2lkZWJhci5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLXNpZGViYXJcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUudG9wID0gXCIxMHB4XCI7XHJcbiAgICAgICAgc2lkZWJhci5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICAgICAgc2lkZWJhci5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUucGFkZGluZyA9IFwiMTBweFwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUubWF4SGVpZ2h0ID0gXCI4MCVcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLm92ZXJmbG93WSA9IFwiYXV0b1wiO1xyXG4gICAgICAgIHNpZGViYXIuc3R5bGUuZm9udEZhbWlseSA9IFwiLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU2Vnb2UgVUknLCBSb2JvdG8sIHNhbnMtc2VyaWZcIjtcclxuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XHJcbiAgICAgICAgc2lkZWJhci5zdHlsZS5jb2xvciA9IFwiIzMzM1wiO1xyXG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChzaWRlYmFyKTtcclxuXHJcbiAgICAgICAgLy8gTGVnZW5kOiBkZXJpdmVkIGZyZXNoIG9uIGV2ZXJ5IHN5bmMgZnJvbSB0aGUgc2FtZSBsYXllciBzdGF0ZSB0aGUgc2lkZWJhclxyXG4gICAgICAgIC8vIHJlbmRlcnMgZnJvbSwgc28gdG9nZ2xlcyBkaW0gb3IgZHJvcCByb3dzIHdpdGggbm8gZXh0cmEgd2lyaW5nLiBIaWRkZW5cclxuICAgICAgICAvLyB1bnRpbCBzaG93X2xlZ2VuZCBhc2tzIGZvciBpdC5cclxuICAgICAgICBjb25zdCBsZWdlbmREaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIGxlZ2VuZERpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxlZ2VuZFwiO1xyXG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLm1heFdpZHRoID0gXCIyNjBweFwiO1xyXG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5tYXhIZWlnaHQgPSBcIjQ1JVwiO1xyXG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUuZm9udEZhbWlseSA9IHNpZGViYXIuc3R5bGUuZm9udEZhbWlseTtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcclxuICAgICAgICBsZWdlbmREaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChsZWdlbmREaXYpO1xyXG5cclxuICAgICAgICAvLyBMb2dvXHJcbiAgICAgICAgLy8gVGhlIGxvZ28gY2FyZDogdHdvIGFwcC1zdXBwbGllZCBzbG90cyBmcm9tIGxvZ29fY29uZmlnLCBubyBicmFuZGluZyBvZlxyXG4gICAgICAgIC8vIGl0cyBvd24uIFdpdGggdGhlIGNhcmQgb24gYW5kIG5laXRoZXIgc2xvdCBzZXQsIGEgZ2VuZXJpYyBtYXJrIHN0YW5kcyBpblxyXG4gICAgICAgIC8vIC0tIGlubGluZSBTVkcsIHNvIGl0IG5lZWRzIG5vIG5ldHdvcmsgYW5kIHN1cnZpdmVzIGEgc3RhdGljIGV4cG9ydC5cclxuICAgICAgICAvLyBCdWlsdCB3aXRoIGVsZW1lbnRzLCBub3QgaW5uZXJIVE1MLCBzbyBhbiBhbHQgdGV4dCBjYW5ub3QgaW5qZWN0IG1hcmt1cC5cclxuICAgICAgICBjb25zdCBMT0dPX1BPU0lUSU9OUyA9IG5ldyBTZXQoW1widG9wLWxlZnRcIiwgXCJ0b3AtcmlnaHRcIiwgXCJib3R0b20tbGVmdFwiLCBcImJvdHRvbS1yaWdodFwiXSk7XHJcbiAgICAgICAgY29uc3QgREVGQVVMVF9MT0dPID0gXCJkYXRhOmltYWdlL3N2Zyt4bWw7dXRmOCxcIiArIGVuY29kZVVSSUNvbXBvbmVudChcclxuICAgICAgICAgICAgJzxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHZpZXdCb3g9XCIwIDAgMTQwIDQwXCI+J1xyXG4gICAgICAgICAgICArICc8cmVjdCB3aWR0aD1cIjE0MFwiIGhlaWdodD1cIjQwXCIgcng9XCI4XCIgZmlsbD1cIiMxZjZmZWJcIi8+J1xyXG4gICAgICAgICAgICArICc8dGV4dCB4PVwiNzBcIiB5PVwiMjZcIiBmb250LWZhbWlseT1cIlNlZ29lIFVJLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmXCIgJ1xyXG4gICAgICAgICAgICArICdmb250LXNpemU9XCIxOFwiIGZvbnQtd2VpZ2h0PVwiNjAwXCIgZmlsbD1cIiNmZmZcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiPnN3aWZ0bWFwPC90ZXh0PidcclxuICAgICAgICAgICAgKyAnPC9zdmc+Jyk7XHJcbiAgICAgICAgY29uc3QgbG9nb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgbG9nb0Rpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxvZ29cIjtcclxuICAgICAgICBsb2dvRGl2LnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xyXG4gICAgICAgIGxvZ29EaXYuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XHJcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xyXG4gICAgICAgIGxvZ29EaXYuc3R5bGUucGFkZGluZyA9IFwiNXB4XCI7XHJcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjRweFwiO1xyXG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XHJcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxvZ29EaXYpO1xyXG5cclxuICAgICAgICBmdW5jdGlvbiBzeW5jTG9nbygpIHtcclxuICAgICAgICAgICAgY29uc3Qgc2hvdyA9IEJvb2xlYW4obW9kZWwuZ2V0KFwic2hvd19sb2dvXCIpKTtcclxuICAgICAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gc2hvdyA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xyXG4gICAgICAgICAgICBsb2dvRGl2LnJlcGxhY2VDaGlsZHJlbigpO1xyXG4gICAgICAgICAgICBpZiAoIXNob3cpIHJldHVybjtcclxuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwibG9nb19jb25maWdcIikgfHwge307XHJcbiAgICAgICAgICAgIGNvbnN0IGhlaWdodCA9IE51bWJlcihjZmcuaGVpZ2h0KSA+IDAgPyBOdW1iZXIoY2ZnLmhlaWdodCkgOiAzNTtcclxuICAgICAgICAgICAgY29uc3QgcG9zaXRpb24gPSBMT0dPX1BPU0lUSU9OUy5oYXMoY2ZnLnBvc2l0aW9uKSA/IGNmZy5wb3NpdGlvbiA6IFwiYm90dG9tLXJpZ2h0XCI7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3Qgc2lkZSBvZiBbXCJ0b3BcIiwgXCJib3R0b21cIiwgXCJsZWZ0XCIsIFwicmlnaHRcIl0pIGxvZ29EaXYuc3R5bGVbc2lkZV0gPSBcIlwiO1xyXG4gICAgICAgICAgICBsb2dvRGl2LnN0eWxlW3Bvc2l0aW9uLnN0YXJ0c1dpdGgoXCJ0b3BcIikgPyBcInRvcFwiIDogXCJib3R0b21cIl0gPSBcIjEwcHhcIjtcclxuICAgICAgICAgICAgbG9nb0Rpdi5zdHlsZVtwb3NpdGlvbi5lbmRzV2l0aChcImxlZnRcIikgPyBcImxlZnRcIiA6IFwicmlnaHRcIl0gPSBcIjEwcHhcIjtcclxuICAgICAgICAgICAgY29uc3Qgc2xvdHMgPSBbY2ZnLmNvbXBhbnksIGNmZy5wYXJlbnRfY29tcGFueV0uZmlsdGVyKHMgPT4gcyAmJiBzLnVybCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGltYWdlcyA9IHNsb3RzLmxlbmd0aCA/IHNsb3RzIDogW3sgdXJsOiBERUZBVUxUX0xPR08sIGFsdDogXCJzd2lmdG1hcFwiIH1dO1xyXG4gICAgICAgICAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgICAgICByb3cuc3R5bGUuZGlzcGxheSA9IFwiZmxleFwiO1xyXG4gICAgICAgICAgICByb3cuc3R5bGUuYWxpZ25JdGVtcyA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgICAgIHJvdy5zdHlsZS5nYXAgPSBcIjVweFwiO1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGltYWdlIG9mIGltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImltZ1wiKTtcclxuICAgICAgICAgICAgICAgIGltZy5zcmMgPSBpbWFnZS51cmw7XHJcbiAgICAgICAgICAgICAgICBpbWcuYWx0ID0gaW1hZ2UuYWx0IHx8IFwiXCI7XHJcbiAgICAgICAgICAgICAgICBpbWcuc3R5bGUuaGVpZ2h0ID0gYCR7aGVpZ2h0fXB4YDtcclxuICAgICAgICAgICAgICAgIHJvdy5hcHBlbmRDaGlsZChpbWcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGxvZ29EaXYuYXBwZW5kQ2hpbGQocm93KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgc3luY0xvZ28oKTtcclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsb2dvX2NvbmZpZ1wiLCBzeW5jTG9nbyk7XHJcblxyXG5cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gZ2V0VGlsZUxheWVyKGxheWVyKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGlvbjogbGF5ZXIuYXR0cmlidXRpb24gfHwgJycsXHJcbiAgICAgICAgICAgICAgICBtYXhab29tOiBsYXllci5tYXhfem9vbSB8fCAyMixcclxuICAgICAgICAgICAgICAgIG1heE5hdGl2ZVpvb206IGxheWVyLm1heF9uYXRpdmVfem9vbSB8fCAxOVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAvLyB4eXpzZXJ2aWNlcyBwcm92aWRlcnMgZGVjbGFyZSB0aGVpciBvd24ge3N9IGhvc3RzOyBMZWFmbGV0J3NcclxuICAgICAgICAgICAgLy8gZGVmYXVsdCBcImFiY1wiIGlzIHdyb25nIGZvciBhbnl0aGluZyBlbHNlLlxyXG4gICAgICAgICAgICBpZiAobGF5ZXIuc3ViZG9tYWlucykgb3B0aW9ucy5zdWJkb21haW5zID0gbGF5ZXIuc3ViZG9tYWlucztcclxuICAgICAgICAgICAgaWYgKGxheWVyLndtcykge1xyXG4gICAgICAgICAgICAgICAgLy8gV01TIHJlcXVlc3QgQ1JTIGZvbGxvd3MgdGhlIG1hcCdzLCBzbyA0MzI2IG1hcHMgYXNrIGluIDQzMjYuXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIud21zKGxheWVyLnVybCwge1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBsYXllci53bXMubGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgICAgIGZvcm1hdDogbGF5ZXIud21zLmZvcm1hdCB8fCAnaW1hZ2UvcG5nJyxcclxuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBsYXllci53bXMudmVyc2lvbiB8fCAnMS4xLjEnLFxyXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zcGFyZW50OiAhIWxheWVyLndtcy50cmFuc3BhcmVudCxcclxuICAgICAgICAgICAgICAgICAgICAuLi4obGF5ZXIud21zLnN0eWxlcyA/IHsgc3R5bGVzOiBsYXllci53bXMuc3R5bGVzIH0gOiB7fSlcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBMLnRpbGVMYXllcihsYXllci51cmwsIG9wdGlvbnMpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY01hcFN0YXRlKCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLnRpbWUoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcclxuICAgICAgICAgICAgdXBkYXRlVGltZURpbWVuc2lvbigpO1xyXG4gICAgICAgICAgICBjb25zdCBsYXllcnMgPSBsYXllclN0YXRlO1xyXG4gICAgICAgICAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xyXG4gICAgICAgICAgICBjb25zdCBjb29yZGluYXRlQnVmZmVycyA9IGJ1ZmZlclN0YXRlO1xyXG5cclxuICAgICAgICAgICAgLy8gRW5mb3JjZSBtdXR1YWxseSBleGNsdXNpdmUgcmFkaW8gZ3JvdXAgdmlzaWJpbGl0eSBiZWZvcmUgY29sbGVjdGluZyBvciByZW5kZXJpbmcgV2ViR0wgbGF5ZXJzLlxyXG4gICAgICAgICAgICAvLyBXcml0dGVuIGJhY2sgYXMgdGFyZ2V0ZWQgZmxpcHMsIG5ldmVyIHRoZSBsYXllcnMgdHJhaXQgLS0gdGhlIGZ1bGwgd3JpdGUgd2FzXHJcbiAgICAgICAgICAgIC8vIHRoZSBmcmFtZSB0aGF0IGtpbGxlZCBsYXJnZSBzZXNzaW9ucyAoc2VlIHRoZSBzaWRlYmFyJ3MgY2hhbmdlIGhhbmRsZXIpLlxyXG4gICAgICAgICAgICBjb25zdCByYWRpbyA9IG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcclxuICAgICAgICAgICAgaWYgKChyYWRpby5jaGFuZ2VzLmxlbmd0aCA+IDAgfHwgcmFkaW8uZ3JvdXBzQ2hhbmdlZCkgJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcclxuICAgICAgICAgICAgICAgIHNlbmRMYXllcldyaXRlKG1vZGVsLCByYWRpby5jaGFuZ2VzKTtcclxuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImdyb3VwX2NvbmZpZ3NcIiwgeyAuLi5ncm91cENvbmZpZ3MgfSk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgc3luY0xvZ28oKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEdyb3VwIHZpc2libGUgbGF5ZXJzIChpbmNsdWRpbmcgc3ViLWxheWVycyBpbnNpZGUgZ3JvdXBzKSB0byBhbHdheXMgdXNlIFdlYkdMXHJcbiAgICAgICAgICAgIGNvbnN0IHtcclxuICAgICAgICAgICAgICAgIGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcclxuICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxyXG4gICAgICAgICAgICAgICAgcG9seWxpbmU6IHdlYmdsUG9seWxpbmVMYXllcnMsXHJcbiAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMsXHJcbiAgICAgICAgICAgIH0gPSBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xyXG5cclxuICAgICAgICAgICAgLy8gU2V0IG9mIGxheWVyIElEcyBwcm9jZXNzZWQgdmlhIG1lcmdlZCBXZWJHTCBsYXllcnNcclxuICAgICAgICAgICAgY29uc3Qgd2ViZ2xMYXllcklkcyA9IG5ldyBTZXQoW1xyXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMubWFwKGwgPT4gbC5pZCksXHJcbiAgICAgICAgICAgICAgICAuLi53ZWJnbE1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcclxuICAgICAgICAgICAgICAgIC4uLndlYmdsUG9seWxpbmVMYXllcnMubWFwKGwgPT4gbC5pZCksXHJcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlnb25MYXllcnMubWFwKGwgPT4gbC5pZClcclxuICAgICAgICAgICAgXSk7XHJcblxyXG4gICAgICAgICAgICAvLyBSZW1vdmUgcmV0aXJlZCBvdmVybGF5IGxheWVycywgaW5jbHVkaW5nIHRob3NlIHRoYXQgdHJhbnNpdGlvbmVkIHRvIFdlYkdMXHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGFjdGl2ZU92ZXJsYXlMYXllcnMpLmZvckVhY2goaWQgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKSB8fCB3ZWJnbExheWVySWRzLmhhcyhpZCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gUHJvY2VzcyBub24tV2ViR0wgbGF5ZXJzXHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBlZmZlY3RpdmVWaXNpYmxlID0gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XHJcbiAgICAgICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJiYXNlbWFwXCIpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZWZmZWN0aXZlVmlzaWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRpbGUgPSBnZXRUaWxlTGF5ZXIobGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGlsZS5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSA9IHRpbGU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVUaWxlTGF5ZXJzW2xheWVyLm5hbWVdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIFNraXAgbGF5ZXJzIG1hbmFnZWQgYnkgdGhlIG1lcmdlZCBXZWJHTCBsYXllcnNcclxuICAgICAgICAgICAgICAgIGlmICh3ZWJnbExheWVySWRzLmhhcyhsYXllci5pZCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWVmZmVjdGl2ZVZpc2libGUgfHwgIWxheWVySW5XaW5kb3cobGF5ZXIsIGJ1ZmZlclN0YXRlLCB0aW1lU3RhdGUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSW1hZ2Ugb3ZlcmxheXMgcmVjcmVhdGUgd2hlbiB0aGVpciBjb25maWcgb3IgdGhlaXIgYnVmZmVyXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gY2hhbmdlcyAtLSBhIHJlcGxhY2Ugb3Agc3dhcHMgdGhlIGNvbmZpZyBvYmplY3QgYW5kIGFcclxuICAgICAgICAgICAgICAgICAgICAvLyBidWZmZXIgb3Agc3dhcHMgdGhlIERhdGFWaWV3LCBhbmQgYSBzdGFsZSBpbWFnZSB3b3VsZFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSBzaXQgdW50aWwgYSB2aXNpYmlsaXR5IGJvdW5jZS5cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFsZUltYWdlID0gbGF5ZXIudHlwZSA9PT0gXCJpbWFnZVwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICYmIChleGlzdGluZy5pbWFnZU1ldGEgIT09IGltYWdlTWV0YUtleShsYXllcilcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8IGV4aXN0aW5nLmltYWdlU291cmNlICE9PSAoY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdIHx8IG51bGwpKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmcubGF5ZXJUeXBlICE9PSBsYXllci50eXBlIHx8IHN0YWxlSW1hZ2UpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcucmVtb3ZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0sIG1vZGVsKTtcclxuICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdID0gaW5zdGFuY2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIEhlbHBlciB0byBzeW5jIFdlYkdMIGxheWVyIHN0YXRlcyBhbmQgcmVidWlsZCBvbmx5IGlmIGNoYW5nZWRcclxuICAgICAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY0dsTGF5ZXIodHlwZSwgdmlzaWJsZUxheWVycywgdmVjdG9yR3B1ID0gZmFsc2UpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlkc1N0cmluZyA9IHZpc2libGVMYXllcnMubWFwKGwgPT4gbC5pZCkuc29ydCgpLmpvaW4oXCIsXCIpO1xyXG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyB0aGUgYnVpbHQgYnVmZmVycyBkZXBlbmQgb24gYmVsb25ncyBpbiB0aGlzIGtleTogYSBjaGFuZ2UgdGhhdFxyXG4gICAgICAgICAgICAgICAgLy8gaXMgbm90IGluIGl0IHJlbmRlcnMgc3RhbGUuIGhpZ2hsaWdodF9zdHlsZSBhbmQgc3R5bGVfb3ZlcnJpZGVzIHdlcmVcclxuICAgICAgICAgICAgICAgIC8vIG1pc3NpbmcgYXQgZmlyc3QsIHNvIGEgaGlnaGxpZ2h0IGxhbmRlZCBpbiBzdGF0ZSBhbmQgbmV2ZXIgcmVwYWludGVkLlxyXG4gICAgICAgICAgICAgICAgLy8gUG9pbnQgYnVja2V0cyBvbiB0aGUgR1BVIHBhdGggZXhjbHVkZSB0aGUgdGljayBhbmQgd2luZG93IGZyb20gdGhlIGtleTpcclxuICAgICAgICAgICAgICAgIC8vIHRob3NlIGNoYW5nZSBwZXIgdGljayBhbmQgYXJlIGFwcGxpZWQgYXMgdW5pZm9ybXMsIG5vdCBieSByZWJ1aWxkaW5nLlxyXG4gICAgICAgICAgICAgICAgLy8gVGhlIHBlcmlvZCBzdGF5cyBpbiwgc2luY2UgaXQgaXMgYmFrZWQgaW50byB0aGUgZHVyYXRpb24gYXR0cmlidXRlcy5cclxuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgZWxzZSAtLSBhbmQgZXZlcnkgbm9uLXBvaW50IGJ1Y2tldCAtLSByZWJ1aWxkcyBhcyBiZWZvcmUuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBncHVQb2ludHMgPSAoKHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIilcclxuICAgICAgICAgICAgICAgICAgICAmJiBncHVUaW1lQXZhaWxhYmxlKCkpIHx8IHZlY3RvckdwdTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFTdHJpbmcgPSBKU09OLnN0cmluZ2lmeSh2aXNpYmxlTGF5ZXJzLm1hcChsID0+ICh7XHJcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGwuaWQsXHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IGwuY29sb3IsXHJcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiBsLnJhZGl1cyxcclxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IGwud2VpZ2h0LFxyXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IGwub3BhY2l0eSxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsT3BhY2l0eTogbC5maWxsT3BhY2l0eSxcclxuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHQ6IGwuaGlnaGxpZ2h0X3N0eWxlLFxyXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlczogbC5zdHlsZV9vdmVycmlkZXMsXHJcbiAgICAgICAgICAgICAgICAgICAgZmVhdHVyZVN0eWxlczogbC5mZWF0dXJlX3N0eWxlcyxcclxuICAgICAgICAgICAgICAgICAgICB0aW1lOiBsLnRpbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgZ3B1OiBncHVQb2ludHMsXHJcbiAgICAgICAgICAgICAgICAgICAgdGljazogbC50aW1lICYmIHRpbWVTdGF0ZSAmJiAhZ3B1UG9pbnRzID8gdGltZVN0YXRlLnRpY2sgOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpbjogbC50aW1lICYmIHRpbWVTdGF0ZSAmJiAhZ3B1UG9pbnRzID8gdGltZVN0YXRlLndpbmRvdyA6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgcGVyOiBsLnRpbWUgJiYgZ3B1UG9pbnRzICYmIHRpbWVTdGF0ZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICBidWZMZW46IGNvb3JkaW5hdGVCdWZmZXJzW2wuaWRdPy5ieXRlTGVuZ3RoIHx8IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWRlbnRpdHkgb2YgZXZlcnkgYnVmZmVyIHRoZSBidWNrZXQgcmVhZHMgZm9yIHRoaXMgbGF5ZXI6XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gc2FtZS1sZW5ndGggcmVwbGFjZW1lbnRzIG11c3QgcmVidWlsZCB0b28uXHJcbiAgICAgICAgICAgICAgICAgICAgYnVmU2VyaWFsOiBbbC5pZCwgYCR7bC5pZH06OmNvbG9yc2AsIGAke2wuaWR9OjpyYWRpaWAsIGAke2wuaWR9Ojp0aW1lc2BdXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC5tYXAoayA9PiBidWZmZXJTZXJpYWwoY29vcmRpbmF0ZUJ1ZmZlcnNba10pKSxcclxuICAgICAgICAgICAgICAgICAgICBsb2NMZW46IGwubG9jYXRpb25zPy5sZW5ndGggfHwgMFxyXG4gICAgICAgICAgICAgICAgfSkpKTtcclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGVDaGFuZ2VkID0gc3RhdGUuaWRzICE9PSBpZHNTdHJpbmcgfHwgc3RhdGUubWV0YSAhPT0gbWV0YVN0cmluZztcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoc3RhdGVDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodmlzaWJsZUxheWVycy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyID0gYXdhaXQgcmVuZGVyTWVyZ2VkR2xMYXllcihtYXAsIHR5cGUsIHZpc2libGVMYXllcnMsIGNvb3JkaW5hdGVCdWZmZXJzLCBtb2RlbCwgdGltZVN0YXRlLCB2ZWN0b3JHcHUsIGZlYXR1cmVWaXNpYmxlTm93KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmxheWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5hZGRUbyhtYXApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5pZHMgPSBpZHNTdHJpbmc7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubWV0YSA9IG1ldGFTdHJpbmc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFBvaW50IGJ1Y2tldHMgaG9sZGluZyB0aW1lIGxheWVycyBrZWVwIEVWRVJZIHBvaW50IGxheWVyIC0tIGhpZGRlbiBvbmVzXHJcbiAgICAgICAgICAgIC8vIGluY2x1ZGVkIC0tIHNvIGEgc2lkZWJhciB0b2dnbGUgY2hhbmdlcyBhIHZpc2liaWxpdHkgdW5pZm9ybSBpbnN0ZWFkIG9mXHJcbiAgICAgICAgICAgIC8vIHRoZSBidWNrZXQncyBpZHMuIFVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlYnVpbGQgYWxsIDVNXHJcbiAgICAgICAgICAgIC8vIHBvaW50czsgY2xpY2tpbmcgZG93biB0aGUgc2lkZWJhciBzdGFja2VkIHRob3NlIHJlYnVpbGRzIGludG8gYSBjcmFzaC5cclxuICAgICAgICAgICAgY29uc3QgYWxsQnlUeXBlID0gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKTtcclxuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lcyByaWRlIHRoZSBsaW5lcyBidWNrZXQ6IGV2ZXJ5IHBvbHlnb24gYW5kIGNpcmNsZSBqb2lucyBpdCBhc1xyXG4gICAgICAgICAgICAvLyBhbiBleHRyYSBlbnRyeSB3aG9zZSByaW5ncyByZW5kZXIgYXMgd2VpZ2h0ZWQgTGluZVN0cmluZ3MgKHRoZSBwb2x5Z29uXHJcbiAgICAgICAgICAgIC8vIGJ1Y2tldCBkcmF3cyBvbmx5IHRoZSBmaWxsKS4gSm9pbmluZyB1bmNvbmRpdGlvbmFsbHkgLS0gc3Ryb2tlbGVzcyBhcmVhc1xyXG4gICAgICAgICAgICAvLyBjb250cmlidXRlIGFuIGVtcHR5IHNsb3QgLS0ga2VlcHMgdGhlIGJ1Y2tldCdzIG1lbWJlcnNoaXAgaW5kZXBlbmRlbnQgb2ZcclxuICAgICAgICAgICAgLy8gc3R5bGUgY2hhbmdlcywgc28gcmVzdHlsaW5nIGEgYm9yZGVyIHN0YXlzIGEgcmVidWlsZCwgbmV2ZXIgYSByZS1idWNrZXQuXHJcbiAgICAgICAgICAgIGFsbEJ5VHlwZS5wb2x5bGluZSA9IFsuLi5hbGxCeVR5cGUucG9seWxpbmUsIC4uLmFsbEJ5VHlwZS5wb2x5Z29uXTtcclxuICAgICAgICAgICAgY29uc3QgYnVja2V0ID0geyBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Vyczogd2ViZ2xNYXJrZXJMYXllcnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9seWxpbmU6IFsuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLCAuLi53ZWJnbFBvbHlnb25MYXllcnNdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyB9O1xyXG4gICAgICAgICAgICBjb25zdCB2ZWN0b3JHcHVCdWNrZXQgPSB7IHBvbHlsaW5lOiBmYWxzZSwgcG9seWdvbjogZmFsc2UgfTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZW50cmllcyA9IGFsbEJ5VHlwZVt0eXBlXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzUG9pbnRzID0gdHlwZSA9PT0gXCJjaXJjbGVfbWFya2Vyc1wiIHx8IHR5cGUgPT09IFwibWFya2Vyc1wiO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYXZhaWxhYmxlID0gaXNQb2ludHMgPyBncHVUaW1lQXZhaWxhYmxlKCkgOiB2ZWN0b3JHcHVBdmFpbGFibGUoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGdwdVZpcyA9IGF2YWlsYWJsZSAmJiBlbnRyaWVzLmxlbmd0aCA+IDBcclxuICAgICAgICAgICAgICAgICAgICAmJiBlbnRyaWVzLmxlbmd0aCA8PSBMQVlFUl9TTE9UU1xyXG4gICAgICAgICAgICAgICAgICAgICYmIGVudHJpZXMuc29tZShlID0+IGUubGF5ZXIudGltZSk7XHJcbiAgICAgICAgICAgICAgICBnbFN0YXRlc1t0eXBlXS52aXNWZWN0b3IgPSBncHVWaXMgPyBlbnRyaWVzLm1hcChlID0+IChlLnZpcyA/IDEgOiAwKSkgOiBudWxsO1xyXG4gICAgICAgICAgICAgICAgaWYgKGdwdVZpcykgYnVja2V0W3R5cGVdID0gZW50cmllcy5tYXAoZSA9PiBlLmxheWVyKTtcclxuICAgICAgICAgICAgICAgIGlmICghaXNQb2ludHMpIHZlY3RvckdwdUJ1Y2tldFt0eXBlXSA9IGdwdVZpcztcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJjaXJjbGVfbWFya2Vyc1wiLCBidWNrZXQuY2lyY2xlX21hcmtlcnMpO1xyXG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcIm1hcmtlcnNcIiwgYnVja2V0Lm1hcmtlcnMpO1xyXG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlsaW5lXCIsIGJ1Y2tldC5wb2x5bGluZSwgdmVjdG9yR3B1QnVja2V0LnBvbHlsaW5lKTtcclxuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5Z29uXCIsIGJ1Y2tldC5wb2x5Z29uLCB2ZWN0b3JHcHVCdWNrZXQucG9seWdvbik7XHJcblxyXG4gICAgICAgICAgICAvLyBQdXNoIHRoZSBjdXJyZW50IHdpbmRvdyBpbnRvIHRoZSBHUFUtZmlsdGVyZWQgcG9pbnQgYnVja2V0czogdHdvIHVuaWZvcm1zXHJcbiAgICAgICAgICAgIC8vIGFuZCBhIHJlZHJhdywgd2hpY2ggaXMgdGhlIGVudGlyZSBwZXItdGljayBjb3N0IG9mIHRoZSB0aW1lIHNsaWRlciB0aGVyZS5cclxuICAgICAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGUgPSBnbFN0YXRlc1t0eXBlXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGhhbmRsZSA9IHN0YXRlLmxheWVyICYmIHN0YXRlLmxheWVyLl9zd2lmdG1hcFRpbWU7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWhhbmRsZSkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAvLyBMYXllciB2aXNpYmlsaXR5IGZpcnN0LCBhbmQgb25seSB3aGVuIGl0IGNoYW5nZWQ6IGEgdG9nZ2xlIGNvc3RzIG9uZVxyXG4gICAgICAgICAgICAgICAgLy8gdW5pZm9ybSBhcnJheSB3cml0ZSBhbmQgYSByZWRyYXcsIG5ldmVyIGEgcmVidWlsZC5cclxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IHN0YXRlLnZpc1ZlY3RvcjtcclxuICAgICAgICAgICAgICAgIGlmICh2aXMpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSB2aXMuam9pbihcIlwiKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUudmlzS2V5ICE9PSBrZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUudmlzS2V5ID0ga2V5O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0TGF5ZXJWaXNpYmlsaXR5KHZpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKHRpbWVTdGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG92ZXJyaWRlTXMgPSB0aW1lU3RhdGUud2luZG93XHJcbiAgICAgICAgICAgICAgICAgICAgICAgID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZCh0aW1lU3RhdGUud2luZG93KSkgOiBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRXaW5kb3codGltZVN0YXRlLnRpY2ssIG92ZXJyaWRlTXMpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBoYW5kbGUuc2V0V2luZG93KG51bGwsIG51bGwpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZW5kZXJTaWRlYmFyQ29udHJvbHMoc2lkZWJhciwgbGF5ZXJzLCBtb2RlbCwgbWFwLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFBlcm1hbmVudCBsYWJlbHMgZm9sbG93IHRoZSBzYW1lIGRlcml2ZS1wZXItc3luYyBwYXR0ZXJuIGFzIHRoZSBsZWdlbmQsXHJcbiAgICAgICAgICAgIC8vIHNvIHRoZXkgdHJhY2sgdmlzaWJpbGl0eSB3aXRoIG5vIGJ1Y2tldCBvciBtZXRhLWtleSBpbnZvbHZlbWVudCAtLSBhbmRcclxuICAgICAgICAgICAgLy8gc2luY2UgZXZlcnkgcGxheWJhY2sgdGljayByZS1lbnRlcnMgdGhpcyBzeW5jLCBwYXNzaW5nIHRpbWVTdGF0ZSBtYWtlc1xyXG4gICAgICAgICAgICAvLyB0aGVtIGZvbGxvdyB0aGUgd2luZG93IHRvbzogY2hpcHMgYXBwZWFyIGFuZCB2YW5pc2ggd2l0aCB0aGVpciBmZWF0dXJlcy5cclxuICAgICAgICAgICAgaWYgKGxhYmVsc0dyb3VwKSB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJMYWJlbHMoTCwgbGFiZWxzR3JvdXAsIGxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIGdyb3VwQ29uZmlncyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBsZWdlbmRDZmcgPSBtb2RlbC5nZXQoXCJsZWdlbmRfY29uZmlnXCIpIHx8IHt9O1xyXG4gICAgICAgICAgICBpZiAobW9kZWwuZ2V0KFwic2hvd19sZWdlbmRcIikpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNwZWMgPSBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBsZWdlbmRDZmcpO1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTGVnZW5kKGxlZ2VuZERpdiwgc3BlYyxcclxuICAgICAgICAgICAgICAgICAgICB7IGRpbUhpZGRlbjogbGVnZW5kQ2ZnLmRpbV9oaWRkZW4gIT09IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcG9zID0gUE9TSVRJT05TW2xlZ2VuZENmZy5wb3NpdGlvbl0gfHwgUE9TSVRJT05TW1wiYm90dG9tLWxlZnRcIl07XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocG9zKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZVtwcm9wXSA9IHZhbHVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBzcGVjLmdyb3Vwcy5sZW5ndGggPiAwID8gXCJibG9ja1wiIDogXCJub25lXCI7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBsZWdlbmREaXYuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnNvbGUudGltZUVuZChcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbGV0IGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XHJcbiAgICAgICAgbGV0IGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xyXG5cclxuICAgICAgICAvLyBEcmF3IC8gQU9JIHRvb2xzOiBMZWFmbGV0LUdlb21hbiAodGhlIG1haW50YWluZWQgc3VjY2Vzc29yIHRvIExlYWZsZXQuZHJhdyxcclxuICAgICAgICAvLyB3aGljaCBicmVha3Mgb24gTGVhZmxldCAxLjkpLCBsb2FkZWQgZnJvbSB1bnBrZyBsaWtlIExlYWZsZXQgYW5kIGdsaWZ5IC0tXHJcbiAgICAgICAgLy8gbGF6aWx5LCBvbmx5IHdoZW4gYSBtYXAgdHVybnMgZHJhd2luZyBvbiwgc28gZXZlcnkgb3RoZXIgbWFwIHBheXMgbm90aGluZy5cclxuICAgICAgICAvLyBEcmF3biBzaGFwZXMgbGl2ZSBpbiB0aGVpciBvd24gZmVhdHVyZSBncm91cCBhbmQgc3luYyB0byBQeXRob24gYXMgR2VvSlNPTlxyXG4gICAgICAgIC8vIGZlYXR1cmVzIHVuZGVyIHRoZSBgZHJhd2luZ3NgIHRyYWl0LCB3aXRoIGBkcmF3X3NlcWAgYnVtcGluZyBwZXIgY2hhbmdlIHNvXHJcbiAgICAgICAgLy8gb25lIG9ic2VydmVyIGNhdGNoZXMgY3JlYXRlLCBlZGl0IGFuZCBkZWxldGUgYWxpa2UuIFRoZSB0cmFpdCBzeW5jcyBib3RoXHJcbiAgICAgICAgLy8gd2F5czogUHl0aG9uIGNhbiBzZWVkIEFPSXMgb3IgY2xlYXIgdGhlbSwgYW5kIGV4cG9ydHMgY2FycnkgdGhlIGRyYXdpbmdzLlxyXG4gICAgICAgIGxldCBkcmF3UmVhZHkgPSBmYWxzZTtcclxuICAgICAgICBsZXQgZHJhd2luZ3NHcm91cCA9IG51bGw7XHJcbiAgICAgICAgbGV0IGRyYXdJZENvdW50ZXIgPSAwO1xyXG4gICAgICAgIGxldCBzdXBwcmVzc0RyYXdpbmdzRWNobyA9IGZhbHNlO1xyXG5cclxuICAgICAgICBmdW5jdGlvbiBkcmF3aW5nVG9GZWF0dXJlKGwpIHtcclxuICAgICAgICAgICAgY29uc3QgZ2ogPSBsLnRvR2VvSlNPTigpO1xyXG4gICAgICAgICAgICBnai5wcm9wZXJ0aWVzID0geyAuLi4oZ2oucHJvcGVydGllcyB8fCB7fSksIGRyYXdfaWQ6IGwuX3N3aWZ0bWFwRHJhd0lkIH07XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbC5nZXRSYWRpdXMgPT09IFwiZnVuY3Rpb25cIiAmJiBsIGluc3RhbmNlb2YgTC5DaXJjbGUpIHtcclxuICAgICAgICAgICAgICAgIGdqLnByb3BlcnRpZXMua2luZCA9IFwiY2lyY2xlXCI7XHJcbiAgICAgICAgICAgICAgICBnai5wcm9wZXJ0aWVzLnJhZGl1cyA9IGwuZ2V0UmFkaXVzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIGdqO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gd3JpdGVEcmF3aW5ncygpIHtcclxuICAgICAgICAgICAgY29uc3QgZmVhdHVyZXMgPSBbXTtcclxuICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5lYWNoTGF5ZXIobCA9PiBmZWF0dXJlcy5wdXNoKGRyYXdpbmdUb0ZlYXR1cmUobCkpKTtcclxuICAgICAgICAgICAgc3VwcHJlc3NEcmF3aW5nc0VjaG8gPSB0cnVlO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZHJhd2luZ3NcIiwgZmVhdHVyZXMpO1xyXG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiZHJhd19zZXFcIiwgKG1vZGVsLmdldChcImRyYXdfc2VxXCIpIHx8IDApICsgMSk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZDsgdGhlIGRyYXdpbmdzIHN0aWxsIGxpdmUgb24gdGhlIG1hcCAqLyB9XHJcbiAgICAgICAgICAgIHN1cHByZXNzRHJhd2luZ3NFY2hvID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZG9wdERyYXdpbmcobGF5ZXIpIHtcclxuICAgICAgICAgICAgaWYgKCFsYXllci5fc3dpZnRtYXBEcmF3SWQpIHtcclxuICAgICAgICAgICAgICAgIGxheWVyLl9zd2lmdG1hcERyYXdJZCA9IGBkcmF3XyR7KytkcmF3SWRDb3VudGVyfWA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZHJhd2luZ3NHcm91cC5hZGRMYXllcihsYXllcik7XHJcbiAgICAgICAgICAgIGxheWVyLm9uKFwicG06dXBkYXRlIHBtOmRyYWdlbmQgcG06cm90YXRlZW5kXCIsIHdyaXRlRHJhd2luZ3MpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gcmVoeWRyYXRlRHJhd2luZ3MoKSB7XHJcbiAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAuY2xlYXJMYXllcnMoKTtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBmZWF0dXJlIG9mIG1vZGVsLmdldChcImRyYXdpbmdzXCIpIHx8IFtdKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGZlYXR1cmUucHJvcGVydGllcyB8fCB7fTtcclxuICAgICAgICAgICAgICAgIGxldCBsYXllcjtcclxuICAgICAgICAgICAgICAgIGlmIChwcm9wcy5raW5kID09PSBcImNpcmNsZVwiICYmIGZlYXR1cmUuZ2VvbWV0cnkudHlwZSA9PT0gXCJQb2ludFwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgW2xuZywgbGF0XSA9IGZlYXR1cmUuZ2VvbWV0cnkuY29vcmRpbmF0ZXM7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXIgPSBMLmNpcmNsZShbbGF0LCBsbmddLCB7IHJhZGl1czogcHJvcHMucmFkaXVzIHx8IDEwMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGxheWVyID0gTC5nZW9KU09OKGZlYXR1cmUsIHsgcGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIgfSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLmdldExheWVycygpWzBdO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKCFsYXllcikgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICBsYXllci5fc3dpZnRtYXBEcmF3SWQgPSBwcm9wcy5kcmF3X2lkIHx8IGBkcmF3XyR7KytkcmF3SWRDb3VudGVyfWA7XHJcbiAgICAgICAgICAgICAgICBhZG9wdERyYXdpbmcobGF5ZXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBzeW5jRHJhdygpIHtcclxuICAgICAgICAgICAgY29uc3Qgc2hvdyA9IG1vZGVsLmdldChcInNob3dfZHJhd1wiKTtcclxuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwiZHJhd19jb25maWdcIikgfHwge307XHJcbiAgICAgICAgICAgIGlmIChzaG93ICYmICFkcmF3UmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIGRyYXdSZWFkeSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAvLyBFdmVyeXRoaW5nIEdlb21hbiBjcmVhdGVzIGdvZXMgdG8gdGhlIHBhbmUgYWJvdmUgdGhlIEdMIHN0YWNrLlxyXG4gICAgICAgICAgICAgICAgbWFwLnBtLnNldEdsb2JhbE9wdGlvbnMoe1xyXG4gICAgICAgICAgICAgICAgICAgIHBhbmVzOiB7IGxheWVyUGFuZTogXCJzd2lmdG1hcERyYXdQYW5lXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVydGV4UGFuZTogXCJtYXJrZXJQYW5lXCIsIG1hcmtlclBhbmU6IFwibWFya2VyUGFuZVwiIH0sXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAgPSBMLmZlYXR1cmVHcm91cCgpLmFkZFRvKG1hcCk7XHJcbiAgICAgICAgICAgICAgICByZWh5ZHJhdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICAgICAgbWFwLm9uKFwicG06Y3JlYXRlXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgYWRvcHREcmF3aW5nKGUubGF5ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIHdyaXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgbWFwLm9uKFwicG06cmVtb3ZlXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gR2VvbWFuIHJlbW92ZXMgdGhlIGxheWVyIGZyb20gdGhlIE1BUDsgdGhlIGZlYXR1cmUgZ3JvdXAgc3RpbGxcclxuICAgICAgICAgICAgICAgICAgICAvLyBob2xkcyBpdCwgYW5kIHdyaXRlRHJhd2luZ3MgcmVhZHMgdGhlIGdyb3VwIC0tIGV2aWN0IGl0IGZpcnN0XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gb3IgdGhlIGRlbGV0aW9uIG5ldmVyIHJlYWNoZXMgdGhlIHRyYWl0LlxyXG4gICAgICAgICAgICAgICAgICAgIGRyYXdpbmdzR3JvdXAucmVtb3ZlTGF5ZXIoZS5sYXllcik7XHJcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVEcmF3aW5ncygpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpkcmF3aW5nc1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzdXBwcmVzc0RyYXdpbmdzRWNobykgcmVoeWRyYXRlRHJhd2luZ3MoKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICghZHJhd1JlYWR5KSByZXR1cm47XHJcbiAgICAgICAgICAgIGlmIChzaG93KSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0b29scyA9IGNmZy50b29sc1xyXG4gICAgICAgICAgICAgICAgICAgIHx8IFtcIm1hcmtlclwiLCBcInBvbHlsaW5lXCIsIFwicmVjdGFuZ2xlXCIsIFwicG9seWdvblwiLCBcImNpcmNsZVwiXTtcclxuICAgICAgICAgICAgICAgIG1hcC5wbS5hZGRDb250cm9scyh7XHJcbiAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IChjZmcucG9zaXRpb24gfHwgXCJ0b3AtbGVmdFwiKS5yZXBsYWNlKFwiLVwiLCBcIlwiKSxcclxuICAgICAgICAgICAgICAgICAgICBkcmF3TWFya2VyOiB0b29scy5pbmNsdWRlcyhcIm1hcmtlclwiKSxcclxuICAgICAgICAgICAgICAgICAgICBkcmF3UG9seWxpbmU6IHRvb2xzLmluY2x1ZGVzKFwicG9seWxpbmVcIiksXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhd1JlY3RhbmdsZTogdG9vbHMuaW5jbHVkZXMoXCJyZWN0YW5nbGVcIiksXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhd1BvbHlnb246IHRvb2xzLmluY2x1ZGVzKFwicG9seWdvblwiKSxcclxuICAgICAgICAgICAgICAgICAgICBkcmF3Q2lyY2xlOiB0b29scy5pbmNsdWRlcyhcImNpcmNsZVwiKSxcclxuICAgICAgICAgICAgICAgICAgICBkcmF3Q2lyY2xlTWFya2VyOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBkcmF3VGV4dDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgcm90YXRlTW9kZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgY3V0UG9seWdvbjogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgZWRpdE1vZGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhZ01vZGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVtb3ZhbE1vZGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIG1hcC5wbS5yZW1vdmVDb250cm9scygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHN5bmNEcmF3KCk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19kcmF3XCIsIHN5bmNEcmF3KTtcclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpkcmF3X2NvbmZpZ1wiLCBzeW5jRHJhdyk7XHJcblxyXG4gICAgICAgIC8vIFRoZSBzY2FsZSBiYXI6IExlYWZsZXQncyBvd24gY29udHJvbCwgd2hpY2ggbWVhc3VyZXMgdGhyb3VnaCB0aGUgbWFwJ3MgQ1JTXHJcbiAgICAgICAgLy8gKGhhdmVyc2luZSB1bmRlciAzODU3IGFuZCA0MzI2IGFsaWtlIC0tIG5vIHBpeGVsIG1hdGggb2Ygb3VycyksIGV4dGVuZGVkXHJcbiAgICAgICAgLy8gd2l0aCB0aGUgdW5pdCBMZWFmbGV0IGxhY2tzIGFuZCB0aGlzIGRvbWFpbiBydW5zIG9uOiBuYXV0aWNhbCBtaWxlcy5cclxuICAgICAgICBjb25zdCBOYXV0aWNhbFNjYWxlID0gTC5Db250cm9sLlNjYWxlLmV4dGVuZCh7XHJcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbiAobSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY29udGFpbmVyID0gTC5Db250cm9sLlNjYWxlLnByb3RvdHlwZS5vbkFkZC5jYWxsKHRoaXMsIG0pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbmF1dGljYWxTY2FsZSA9IEwuRG9tVXRpbC5jcmVhdGUoXHJcbiAgICAgICAgICAgICAgICAgICAgXCJkaXZcIiwgXCJsZWFmbGV0LWNvbnRyb2wtc2NhbGUtbGluZVwiLCBjb250YWluZXIpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdXBkYXRlKCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udGFpbmVyO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBfdXBkYXRlU2NhbGVzOiBmdW5jdGlvbiAobWF4TWV0ZXJzKSB7XHJcbiAgICAgICAgICAgICAgICBMLkNvbnRyb2wuU2NhbGUucHJvdG90eXBlLl91cGRhdGVTY2FsZXMuY2FsbCh0aGlzLCBtYXhNZXRlcnMpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX25hdXRpY2FsU2NhbGUgJiYgbWF4TWV0ZXJzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4Tm0gPSBtYXhNZXRlcnMgLyAxODUyO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5tID0gdGhpcy5fZ2V0Um91bmROdW0obWF4Tm0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3VwZGF0ZVNjYWxlKHRoaXMuX25hdXRpY2FsU2NhbGUsIGAke25tfSBubWAsIG5tIC8gbWF4Tm0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBsZXQgc2NhbGVDb250cm9sID0gbnVsbDtcclxuICAgICAgICBmdW5jdGlvbiBzeW5jU2NhbGUoKSB7XHJcbiAgICAgICAgICAgIGlmIChzY2FsZUNvbnRyb2wpIHtcclxuICAgICAgICAgICAgICAgIHNjYWxlQ29udHJvbC5yZW1vdmUoKTtcclxuICAgICAgICAgICAgICAgIHNjYWxlQ29udHJvbCA9IG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKCFtb2RlbC5nZXQoXCJzaG93X3NjYWxlXCIpKSByZXR1cm47XHJcbiAgICAgICAgICAgIGNvbnN0IGNmZyA9IG1vZGVsLmdldChcInNjYWxlX2NvbmZpZ1wiKSB8fCB7fTtcclxuICAgICAgICAgICAgY29uc3QgdW5pdHMgPSBjZmcudW5pdHMgfHwgXCJtZXRyaWNcIjtcclxuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAoY2ZnLnBvc2l0aW9uIHx8IFwiYm90dG9tLWxlZnRcIikucmVwbGFjZShcIi1cIiwgXCJcIiksXHJcbiAgICAgICAgICAgICAgICBtYXhXaWR0aDogY2ZnLm1heF93aWR0aCB8fCAxMjAsXHJcbiAgICAgICAgICAgICAgICBtZXRyaWM6IHVuaXRzID09PSBcIm1ldHJpY1wiIHx8IHVuaXRzID09PSBcImJvdGhcIixcclxuICAgICAgICAgICAgICAgIGltcGVyaWFsOiB1bml0cyA9PT0gXCJpbXBlcmlhbFwiIHx8IHVuaXRzID09PSBcImJvdGhcIixcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgc2NhbGVDb250cm9sID0gdW5pdHMgPT09IFwibmF1dGljYWxcIlxyXG4gICAgICAgICAgICAgICAgPyBuZXcgTmF1dGljYWxTY2FsZShvcHRpb25zKVxyXG4gICAgICAgICAgICAgICAgOiBMLmNvbnRyb2wuc2NhbGUob3B0aW9ucyk7XHJcbiAgICAgICAgICAgIHNjYWxlQ29udHJvbC5hZGRUbyhtYXApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBzeW5jU2NhbGUoKTtcclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzaG93X3NjYWxlXCIsIHN5bmNTY2FsZSk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2NhbGVfY29uZmlnXCIsIHN5bmNTY2FsZSk7XHJcblxyXG4gICAgICAgIC8vIEVtcHR5LW1hcCBjbGlja3M6IHJlcG9ydCB3aGVyZS4gUmVnaXN0ZXJlZCB0aHJvdWdoIHRoZSBzYW1lIGFyYml0cmF0aW9uIHRoZVxyXG4gICAgICAgIC8vIGZlYXR1cmUgaGFuZGxlcnMgdXNlLCBhdCB0aGUgbG93ZXN0IHByaW9yaXR5LCBzbyBhIGNsaWNrIHRoYXQgaGl0IGEgZmVhdHVyZVxyXG4gICAgICAgIC8vIHN0YXlzIHRoYXQgZmVhdHVyZSdzIGNsaWNrIC0tIHRoaXMgd2lucyBvbmx5IHdoZW4gbm90aGluZyBjbGFpbWVkIHRoZSBldmVudC5cclxuICAgICAgICAvLyBlLmxhdGxuZyBpcyBhbHJlYWR5IHVucHJvamVjdGVkIHRocm91Z2ggd2hpY2hldmVyIENSUyB0aGUgbWFwIHJ1bnMgKDM4NTcgYW5kXHJcbiAgICAgICAgLy8gNDMyNiBhbGlrZSksIHNvIHRoZXJlIGlzIG5vIHBpeGVsIG1hdGggdG8gZ2V0IHdyb25nIGhlcmU7IHdyYXAoKSBrZWVwcyBhXHJcbiAgICAgICAgLy8gd29ybGQtcGFubmVkIG1hcCBmcm9tIHJlcG9ydGluZyBsb25naXR1ZGUgLTM2NC5cclxuICAgICAgICBtYXAub24oXCJjbGlja1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICAvLyBTdGFtcGVkIHN5bmNocm9ub3VzbHksIGJlZm9yZSBhbnkgZ2xpZnkgaGFuZGxlciByZWdpc3RlcnMgaXRzIG1hdGNoXHJcbiAgICAgICAgICAgIC8vICh0aGlzIGhhbmRsZXIgd2FzIGJvdW5kIGZpcnN0LCBzbyBMZWFmbGV0IHJ1bnMgaXQgZmlyc3QpOiB0aGUgd2hvbGVcclxuICAgICAgICAgICAgLy8gY2xpY2sgcGlwZWxpbmUgLS0gZmVhdHVyZSBwb3B1cHMgYW5kIHRoaXMgZmFsbGJhY2sgYWxpa2UgLS0gc3RhbmRzXHJcbiAgICAgICAgICAgIC8vIGRvd24gd2hpbGUgYSBHZW9tYW4gbW9kZSBpcyBhcm1lZC4gRGVmZXJyZWQgY2hlY2tzIG1pc3MgbW9kZXMgdGhhdFxyXG4gICAgICAgICAgICAvLyBjbG9zZSB0aGVtc2VsdmVzIG9uIHRoZWlyIGZpbmlzaGluZyBjbGljayAoYSBjb21wbGV0ZWQgcmVjdGFuZ2xlKSxcclxuICAgICAgICAgICAgLy8gd2hpY2ggaXMgd2h5IHRoZSBzdGF0ZSBpcyBjYXB0dXJlZCBhdCBjbGljayB0aW1lLlxyXG4gICAgICAgICAgICBjb25zdCBwbSA9IG1hcC5wbTtcclxuICAgICAgICAgICAgbWFwLl9wbU1vZGVBY3RpdmUgPSBCb29sZWFuKHBtXHJcbiAgICAgICAgICAgICAgICAmJiAoKHBtLmdsb2JhbFJlbW92YWxNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxSZW1vdmFsTW9kZUVuYWJsZWQoKSlcclxuICAgICAgICAgICAgICAgICAgICB8fCAocG0uZ2xvYmFsRWRpdE1vZGVFbmFibGVkICYmIHBtLmdsb2JhbEVkaXRNb2RlRW5hYmxlZCgpKVxyXG4gICAgICAgICAgICAgICAgICAgIHx8IChwbS5nbG9iYWxEcmFnTW9kZUVuYWJsZWQgJiYgcG0uZ2xvYmFsRHJhZ01vZGVFbmFibGVkKCkpXHJcbiAgICAgICAgICAgICAgICAgICAgfHwgKHBtLmdsb2JhbERyYXdNb2RlRW5hYmxlZCAmJiBwbS5nbG9iYWxEcmF3TW9kZUVuYWJsZWQoKSkpKTtcclxuICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgOTksICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxsID0gZS5sYXRsbmcud3JhcCgpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gTWF0aC5yb3VuZChsbC5sYXQgKiAxZTUpIC8gMWU1O1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbG5nID0gTWF0aC5yb3VuZChsbC5sbmcgKiAxZTUpIC8gMWU1O1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIFwiXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIC0xKTtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xhdGxuZ1wiLCBbbGF0LCBsbmddKTtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja19zZXFcIiwgKG1vZGVsLmdldChcImNsaWNrX3NlcVwiKSB8fCAwKSArIDEpO1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XHJcbiAgICAgICAgICAgICAgICBpZiAobW9kZWwuZ2V0KFwic2hvd19jbGlja19jb29yZGluYXRlc1wiKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIEwucG9wdXAoeyBjbGFzc05hbWU6IFwic3dpZnRtYXAtY29vcmRzLXBvcHVwXCIsIGNsb3NlQnV0dG9uOiBmYWxzZSB9KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAuc2V0TGF0TG5nKGUubGF0bG5nKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAuc2V0Q29udGVudChgJHtsbC5sYXQudG9GaXhlZCg1KX0sICR7bGwubG5nLnRvRml4ZWQoNSl9YClcclxuICAgICAgICAgICAgICAgICAgICAgICAgLm9wZW5PbihtYXApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQmluZCB6b29tIGFuZCBjZW50ZXIgY2hhbmdlcyBiYWNrIHRvIFB5dGhvbiBzYWZlbHlcclxuICAgICAgICBtYXAub24oXCJtb3ZlZW5kXCIsICgpID0+IHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRab29tID0gbWFwLmdldFpvb20oKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kZWxDZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtb2RlbFpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zdCB6b29tQ2hhbmdlZCA9IG1vZGVsWm9vbSAhPT0gY3VycmVudFpvb207XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gIW1vZGVsQ2VudGVyIHx8IFxyXG4gICAgICAgICAgICAgICAgICAgICFBcnJheS5pc0FycmF5KG1vZGVsQ2VudGVyKSB8fFxyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsQ2VudGVyLmxlbmd0aCA8IDIgfHxcclxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclswXSAtIGNlbnRlci5sYXQpID4gMC4wMDAxIHx8IFxyXG4gICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1vZGVsQ2VudGVyWzFdIC0gY2VudGVyLmxuZykgPiAwLjAwMDE7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjZW50ZXJcIiwgW2NlbnRlci5sYXQsIGNlbnRlci5sbmddKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmICh6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiem9vbVwiLCBjdXJyZW50Wm9vbSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHNhZmVTYXZlQ2hhbmdlcygpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBtb3ZlZW5kIGhhbmRsZXI6XCIsIGVycik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlTWFwVmlldygpIHtcclxuICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbW9kZWwuZ2V0KFwiY2VudGVyXCIpO1xyXG4gICAgICAgICAgICBjb25zdCB6b29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcclxuICAgICAgICAgICAgaWYgKGNlbnRlciAmJiBBcnJheS5pc0FycmF5KGNlbnRlcikgJiYgY2VudGVyLmxlbmd0aCA+PSAyKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBDZW50ZXIgPSBtYXAuZ2V0Q2VudGVyKCk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBab29tID0gbWFwLmdldFpvb20oKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNlbnRlckNoYW5nZWQgPSBNYXRoLmFicyhtYXBDZW50ZXIubGF0IC0gY2VudGVyWzBdKSA+IDAuMDAwMSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtYXBDZW50ZXIubG5nIC0gY2VudGVyWzFdKSA+IDAuMDAwMTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbWFwWm9vbSAhPT0gem9vbTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGNlbnRlckNoYW5nZWQgfHwgem9vbUNoYW5nZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0VmlldyhjZW50ZXIsIHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiID8gem9vbSA6IG1hcFpvb20pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XHJcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHpvb20gPT09IFwibnVtYmVyXCIgJiYgbWFwLmdldFpvb20oKSAhPT0gem9vbSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcC5zZXRab29tKHpvb20pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBXYXRjaCBmb3IgbWFwIHZpZXcgdXBkYXRlcyBmcm9tIFB5dGhvblxyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNlbnRlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCkge1xyXG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ0NlbnRlckZyb21NYXAgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB1cGRhdGVNYXBWaWV3KCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6em9vbVwiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nWm9vbUZyb21NYXApIHtcclxuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdab29tRnJvbU1hcCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHVwZGF0ZU1hcFZpZXcoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyBGaXR0aW5nIHRoZSB2aWV3IGlzIGEgY29tbWFuZCwgbm90IHN0YXRlOiBhc2tpbmcgdG8gZml0IHRoZSBzYW1lIGJvdW5kcyB0d2ljZVxyXG4gICAgICAgIC8vIG11c3QgbW92ZSB0aGUgbWFwIGJvdGggdGltZXMsIHNpbmNlIHRoZSB1c2VyIG1heSBoYXZlIHBhbm5lZCBhd2F5IGluIGJldHdlZW4uXHJcbiAgICAgICAgLy8gVGhlIHJlcXVlc3QgY2FycmllcyBhIHNlcXVlbmNlIG51bWJlciBzbyBhbiBpZGVudGljYWwgZml0IHN0aWxsIGZpcmVzIGEgY2hhbmdlLlxyXG4gICAgICAgIGZ1bmN0aW9uIGFwcGx5Rml0UmVxdWVzdCgpIHtcclxuICAgICAgICAgICAgY29uc3QgcmVxID0gbW9kZWwuZ2V0KFwiZml0X2JvdW5kc19yZXF1ZXN0XCIpIHx8IHt9O1xyXG4gICAgICAgICAgICBjb25zdCBib3VuZHMgPSByZXEuYm91bmRzO1xyXG4gICAgICAgICAgICBpZiAoIWJvdW5kcyB8fCBib3VuZHMubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgICAgICAgICBjb25zdCBvcHRpb25zID0ge307XHJcbiAgICAgICAgICAgIGlmIChyZXEucGFkZGluZyAhPSBudWxsKSBvcHRpb25zLnBhZGRpbmcgPSBbcmVxLnBhZGRpbmcsIHJlcS5wYWRkaW5nXTtcclxuICAgICAgICAgICAgaWYgKHJlcS5tYXhfem9vbSAhPSBudWxsKSBvcHRpb25zLm1heFpvb20gPSByZXEubWF4X3pvb207XHJcbiAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzLCBvcHRpb25zKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEFwcGxpZWQgYWZ0ZXIgdGhlIGZpdCwgc2luY2UgaXQgaXMgcmVsYXRpdmUgdG8gd2hhdGV2ZXIgem9vbSB0aGUgZml0IGNob3NlLlxyXG4gICAgICAgICAgICBpZiAocmVxLnpvb21fb2Zmc2V0KSB7XHJcbiAgICAgICAgICAgICAgICBtYXAuc2V0Wm9vbShtYXAuZ2V0Wm9vbSgpICsgcmVxLnpvb21fb2Zmc2V0KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpmaXRfYm91bmRzX3JlcXVlc3RcIiwgYXBwbHlGaXRSZXF1ZXN0KTtcclxuICAgICAgICAvLyBBIHJlcXVlc3Qgc2V0IGJlZm9yZSB0aGlzIHZpZXcgYXR0YWNoZWQgLS0gYSBwcmUtZGlzcGxheSBmaXRfYm91bmRzKCkgY2FsbCxcclxuICAgICAgICAvLyBvciB0aGUgdW5pb24gYSBmcmVzaCBtYXAgbWFpbnRhaW5zIGFzIGF1dG8tZml0IHdoaWxlIGxheWVycyBhcmUgYWRkZWQgLS0gaXNcclxuICAgICAgICAvLyBhbHJlYWR5IHN0YXRlIGJ5IG5vdywgc28gdGhlIGNoYW5nZSBldmVudCB3aWxsIG5ldmVyIGZpcmUgZm9yIGl0LiBJdCB1c2VkXHJcbiAgICAgICAgLy8gdG8gYmUgc2lsZW50bHkgZHJvcHBlZDsgYXBwbHkgaXQgb25jZSB0aGUgbWFwIGlzIHJlYWR5IGluc3RlYWQuXHJcbiAgICAgICAgbWFwLndoZW5SZWFkeSgoKSA9PiBhcHBseUZpdFJlcXVlc3QoKSk7XHJcbiAgICAgICAgLy8gQSBtYXAgY29uc3RydWN0ZWQgaW5zaWRlIGEgaGlkZGVuIGNvbnRhaW5lciAtLSBhIFNoaW55IG5hdl9wYW5lbCB0aGF0IGlzXHJcbiAgICAgICAgLy8gbm90IHRoZSBzZWxlY3RlZCB0YWIgLS0gaW5pdGlhbGlzZXMgYXQgMHgwLCBhbmQgTGVhZmxldCBjYWNoZXMgdGhhdCBzaXplOlxyXG4gICAgICAgIC8vIGl0cyBvd24gdHJhY2tSZXNpemUgd2F0Y2hlcyB0aGUgV0lORE9XLCBub3QgdGhlIGNvbnRhaW5lciwgc28gbm90aGluZyBldmVyXHJcbiAgICAgICAgLy8gY29ycmVjdHMgaXQuIFRoZSBmaXQgYWJvdmUgdGhlbiBjb21wdXRlcyBpdHMgem9vbSBmcm9tIGEgemVyby1zaXplIGxpZSBhbmRcclxuICAgICAgICAvLyB0aGUgdmlldyBsYW5kcyB3cm9uZyBwZXJtYW5lbnRseS4gV2F0Y2ggdGhlIGNvbnRhaW5lciBpdHNlbGY6IGV2ZXJ5IHJlc2l6ZVxyXG4gICAgICAgIC8vIHJlLW1lYXN1cmVzLCBhbmQgdGhlIGZpcnN0IHRyYW5zaXRpb24gZnJvbSB6ZXJvIHRvIHJlYWwgc2l6ZSByZS1hcHBsaWVzXHJcbiAgICAgICAgLy8gdGhlIHBlbmRpbmcgZml0IHdpdGggYSBzaXplIHRoYXQgY2FuIGFjdHVhbGx5IGhvbGQgaXQuXHJcbiAgICAgICAgaWYgKHR5cGVvZiBSZXNpemVPYnNlcnZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgICAgICAgICBsZXQgaGFkU2l6ZSA9IGNvbnRhaW5lci5jbGllbnRXaWR0aCA+IDAgJiYgY29udGFpbmVyLmNsaWVudEhlaWdodCA+IDA7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5lclJlc2l6ZSA9IG5ldyBSZXNpemVPYnNlcnZlcigoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBoYXNTaXplID0gY29udGFpbmVyLmNsaWVudFdpZHRoID4gMCAmJiBjb250YWluZXIuY2xpZW50SGVpZ2h0ID4gMDtcclxuICAgICAgICAgICAgICAgIGlmIChoYXNTaXplKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFwLmludmFsaWRhdGVTaXplKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFoYWRTaXplKSBhcHBseUZpdFJlcXVlc3QoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGhhZFNpemUgPSBoYXNTaXplO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgY29udGFpbmVyUmVzaXplLm9ic2VydmUoY29udGFpbmVyKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGxldCBzeW5jVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgbGV0IGlzU3luY2luZyA9IGZhbHNlO1xyXG4gICAgICAgIGxldCBuZWVkc1N5bmMgPSBmYWxzZTtcclxuXHJcbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVN5bmMoKSB7XHJcbiAgICAgICAgICAgIGlmIChpc1N5bmNpbmcpIHtcclxuICAgICAgICAgICAgICAgIG5lZWRzU3luYyA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaXNTeW5jaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHN5bmNNYXBTdGF0ZSgpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBzeW5jTWFwU3RhdGU6XCIsIGVycik7XHJcbiAgICAgICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgICAgICBpc1N5bmNpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGlmIChuZWVkc1N5bmMpIHtcclxuICAgICAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBxdWV1ZVN5bmMoKSB7XHJcbiAgICAgICAgICAgIGlmICghbW9kZWwuZ2V0KFwiYXV0b19zeW5jXCIpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHN5bmNUaW1lb3V0KSB7XHJcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoc3luY1RpbWVvdXQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBzeW5jVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xyXG4gICAgICAgICAgICB9LCA1MCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMaXN0ZW4gZm9yIG1hbnVhbCBzeW5jIHRyaWdnZXIgY2hhbmdlcyBmcm9tIFB5dGhvblxyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnN5bmNfdHJpZ2dlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEluY3JlbWVudGFsIHVwZGF0ZXMgZnJvbSBQeXRob24uIEFwcGxpZWQgZXZlbiB3aGVuIGF1dG9fc3luYyBpcyBvZmYgc28gdGhlIG1pcnJvclxyXG4gICAgICAgIC8vIHN0YXlzIGN1cnJlbnQ7IHF1ZXVlU3luYyBkZWNpZGVzIHdoZXRoZXIgdG8gYWN0dWFsbHkgcmUtcmVuZGVyLlxyXG4gICAgICAgIG1vZGVsLm9uKFwibXNnOmN1c3RvbVwiLCAobXNnLCBidWZmZXJzKSA9PiB7XHJcbiAgICAgICAgICAgIGlmICghbXNnIHx8IG1zZy5raW5kICE9PSBcInN3aWZ0bWFwX3BhdGNoXCIpIHJldHVybjtcclxuICAgICAgICAgICAgYXBwbHlQYXRjaE9wcyhtc2cub3BzIHx8IFtdLCBidWZmZXJzKTtcclxuICAgICAgICAgICAgcXVldWVTeW5jKCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEZ1bGwtc25hcHNob3QgcGF0aHM6IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UsIGFuZCB0aGUgc2lkZWJhciB3cml0aW5nIGBsYXllcnNgXHJcbiAgICAgICAgLy8gYmFjayBhZnRlciBhIHRvZ2dsZS4gRWl0aGVyIHdheSB0aGUgdHJhaXQgYmVjb21lcyBhdXRob3JpdGF0aXZlIGFnYWluLlxyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmxheWVyc1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XHJcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNvb3JkaW5hdGVfYnVmZmVyc1wiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xyXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpncm91cF9jb25maWdzXCIsIHF1ZXVlU3luYyk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jb25maWdcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlOyAgIC8vIHJlLWFwcGx5IHNwZWVkL2xvb3AgZnJvbSB0aGUgbmV3IGNvbmZpZ1xyXG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcclxuICAgICAgICAvLyB0aW1lLiBHdWFyZGVkIHNvIHRoZSB3aWRnZXQncyBvd24gd3JpdGViYWNrIGRvZXMgbm90IGxvb3AgdGhyb3VnaCBoZXJlLlxyXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnRpbWVfY3VycmVudFwiLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHdhbnRlZCA9IG1vZGVsLmdldChcInRpbWVfY3VycmVudFwiKTtcclxuICAgICAgICAgICAgaWYgKCF0aW1lU3RhdGUgfHwgIXRpbWVVSS50aWNrcy5sZW5ndGgpIHJldHVybjtcclxuICAgICAgICAgICAgaWYgKE1hdGguYWJzKHdhbnRlZCAtIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKSA8IDEpIHJldHVybjtcclxuICAgICAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XHJcbiAgICAgICAgICAgIGlmIChpZHggPT09IC0xKSBpZHggPSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMTtcclxuICAgICAgICAgICAgc2Vla1RvKGlkeCwgeyB3cml0ZTogZmFsc2UgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19sb2dvXCIsIHF1ZXVlU3luYyk7XHJcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c2hvd19sZWdlbmRcIiwgcXVldWVTeW5jKTtcclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsZWdlbmRfY29uZmlnXCIsIHF1ZXVlU3luYyk7XHJcbiAgICAgICAgLy8gTGl2ZSByZXNpemVzIChhIFNoaW55IGxheW91dCwgYSBub3RlYm9vayBjZWxsKTogTGVhZmxldCBjYWNoZXMgaXRzIGJveCwgc29cclxuICAgICAgICAvLyBpdCBtdXN0IGJlIHRvbGQgdG8gcmUtbWVhc3VyZSBvciB0aWxlcyByZW5kZXIgZm9yIHRoZSBvbGQgc2l6ZS5cclxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpoZWlnaHRcIiwgKCkgPT4ge1xyXG4gICAgICAgICAgICBhcHBseUhlaWdodCgpO1xyXG4gICAgICAgICAgICBtYXAuaW52YWxpZGF0ZVNpemUoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQW5ub3VuY2UgdGhpcyB2aWV3IHNvIFB5dGhvbiByZXBsaWVzIHdpdGggYSBmdWxsIHNuYXBzaG90LiBMYXllcnMgYWRkZWQgYmVmb3JlXHJcbiAgICAgICAgLy8gdGhlIHZpZXcgYXR0YWNoZWQgd291bGQgb3RoZXJ3aXNlIGJlIG1pc3Npbmc6IHRoZWlyIHBhdGNoZXMgd2VyZSBlbWl0dGVkIGludG8gYVxyXG4gICAgICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgbW9kZWwuc2VuZCh7IGtpbmQ6IFwic3dpZnRtYXBfcmVhZHlcIiB9KTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgaW5pdGlhbCBzdGF0ZSBtZXNzYWdlIGlzIGFsbCB0aGVyZSBpcyAqLyB9XHJcblxyXG4gICAgICAgIC8vIFJlc3BlY3QgaW5pdGlhbCBhdXRvX3N5bmMgc3RhdGUgb3IgbWFudWFsIHN5bmMgcmVxdWVzdHMgc2VudCBkdXJpbmcgbWFwIGJ1aWxkaW5nXHJcbiAgICAgICAgaWYgKG1vZGVsLmdldChcImF1dG9fc3luY1wiKSB8fCBtb2RlbC5nZXQoXCJzeW5jX3RyaWdnZXJcIikgPiAwKSB7XHJcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59O1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQU8sU0FBUyxRQUFRLElBQUksS0FBSztBQUM3QixNQUFJLENBQUMsU0FBUyxlQUFlLEVBQUUsR0FBRztBQUM5QixVQUFNLE9BQU8sU0FBUyxjQUFjLE1BQU07QUFDMUMsU0FBSyxLQUFLO0FBQ1YsU0FBSyxNQUFNO0FBQ1gsU0FBSyxPQUFPO0FBQ1osYUFBUyxLQUFLLFlBQVksSUFBSTtBQUFBLEVBQ2xDO0FBQ0o7QUFFQSxJQUFNLGdCQUFnQixDQUFDO0FBRWhCLFNBQVMsT0FBTyxJQUFJLEtBQUs7QUFDNUIsTUFBSSxjQUFjLEVBQUUsR0FBRztBQUNuQixXQUFPLGNBQWMsRUFBRTtBQUFBLEVBQzNCO0FBQ0EsUUFBTSxVQUFVLElBQUksUUFBUSxDQUFDLFNBQVMsV0FBVztBQUM3QyxRQUFJLFNBQVMsZUFBZSxFQUFFLEdBQUc7QUFDN0IsY0FBUTtBQUNSO0FBQUEsSUFDSjtBQUNBLFVBQU0sU0FBUyxTQUFTLGNBQWMsUUFBUTtBQUM5QyxXQUFPLEtBQUs7QUFDWixXQUFPLE1BQU07QUFDYixXQUFPLFNBQVMsTUFBTSxRQUFRO0FBQzlCLFdBQU8sVUFBVSxNQUFNLE9BQU8sSUFBSSxNQUFNLDBCQUEwQixHQUFHLEVBQUUsQ0FBQztBQUN4RSxhQUFTLEtBQUssWUFBWSxNQUFNO0FBQUEsRUFDcEMsQ0FBQztBQUNELGdCQUFjLEVBQUUsSUFBSTtBQUNwQixTQUFPO0FBQ1g7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
