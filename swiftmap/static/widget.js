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
  return [layer.legend ? blockEntry(layer, hidden) : swatchEntry(layer, hidden)];
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
function swatchRow(entry) {
  const row = div({ display: "flex", alignItems: "center", marginTop: "5px" });
  row.appendChild(glyph(entry));
  row.appendChild(div({}, entry.label));
  return row;
}
function renderLegend(container, spec, options = {}) {
  container.innerHTML = "";
  const dimHidden = options.dimHidden !== false;
  container.appendChild(div({
    fontSize: "13px",
    fontWeight: "bold",
    borderBottom: "2px solid #eee",
    paddingBottom: "4px",
    marginBottom: "4px"
  }, spec.title));
  for (const group of spec.groups) {
    if (group.name) {
      container.appendChild(div({ fontWeight: "bold", marginTop: "6px" }, group.name));
    }
    for (const entry of group.entries) {
      const row = entry.kind === "ramp" ? rampRow(entry) : entry.kind === "categories" ? categoriesRow(entry) : entry.kind === "bins" ? binsRow(entry) : swatchRow(entry);
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
    if (times && !Number.isNaN(times[0]) && times[0] < base) base = times[0];
  }
  if (base === Infinity) base = 0;
  const perFeature = layersList.map((layer, idx) => {
    const times = layer.time ? timesFor(layer, coordinateBuffers) : null;
    const dur = layer.time ? durationSeconds(layer.time.duration, periodMs) : ALWAYS;
    const signedDur = layer.time && layer.time.fade ? -dur : dur;
    if (!times || Number.isNaN(times[0])) {
      return { start: -ALWAYS, end: ALWAYS, dur: ALWAYS, idx };
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
function expandPerFeature(perFeature, counts) {
  let total = 0;
  for (const c of counts) total += c;
  const spans = new Float32Array(total * 2);
  const durs = new Float32Array(total);
  const layerIdx = new Float32Array(total);
  let out = 0;
  perFeature.forEach((f, i) => {
    for (let v = 0; v < counts[i]; v++) {
      spans[out * 2] = f.start;
      spans[out * 2 + 1] = f.end;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9sZWdlbmQuanMiLCAiLi4vLi4vc3JjL3NoYWRlcnMuanMiLCAiLi4vLi4vc3JjL3RpbWVjb250cm9sLmpzIiwgIi4uLy4uL3NyYy9ncHV0aW1lLmpzIiwgIi4uLy4uL3NyYy9sYXllcnMuanMiLCAiLi4vLi4vc3JjL21hcC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGZ1bmN0aW9uIGxvYWRDU1MoaWQsIHVybCkge1xuICAgIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgIGNvbnN0IGxpbmsgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwibGlua1wiKTtcbiAgICAgICAgbGluay5pZCA9IGlkO1xuICAgICAgICBsaW5rLnJlbCA9IFwic3R5bGVzaGVldFwiO1xuICAgICAgICBsaW5rLmhyZWYgPSB1cmw7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQobGluayk7XG4gICAgfVxufVxuXG5jb25zdCBhY3RpdmVMb2FkZXJzID0ge307XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSlMoaWQsIHVybCkge1xuICAgIGlmIChhY3RpdmVMb2FkZXJzW2lkXSkge1xuICAgICAgICByZXR1cm4gYWN0aXZlTG9hZGVyc1tpZF07XG4gICAgfVxuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzY3JpcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic2NyaXB0XCIpO1xuICAgICAgICBzY3JpcHQuaWQgPSBpZDtcbiAgICAgICAgc2NyaXB0LnNyYyA9IHVybDtcbiAgICAgICAgc2NyaXB0Lm9ubG9hZCA9ICgpID0+IHJlc29sdmUoKTtcbiAgICAgICAgc2NyaXB0Lm9uZXJyb3IgPSAoKSA9PiByZWplY3QobmV3IEVycm9yKGBGYWlsZWQgdG8gbG9hZCBzY3JpcHQ6ICR7dXJsfWApKTtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzY3JpcHQpO1xuICAgIH0pO1xuICAgIGFjdGl2ZUxvYWRlcnNbaWRdID0gcHJvbWlzZTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gaGV4VG9SZ2IoaGV4KSB7XG4gICAgaWYgKCFoZXgpIHJldHVybiBudWxsO1xuICAgIGhleCA9IGhleC5yZXBsYWNlKC9eIy8sICcnKTtcbiAgICBpZiAoaGV4Lmxlbmd0aCA9PT0gMykge1xuICAgICAgICBoZXggPSBoZXguc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIgKyBjaGFyKS5qb2luKCcnKTtcbiAgICB9XG4gICAgaWYgKGhleC5sZW5ndGggIT09IDYpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG51bSA9IHBhcnNlSW50KGhleCwgMTYpO1xuICAgIHJldHVybiB7XG4gICAgICAgIHI6ICgobnVtID4+IDE2KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGc6ICgobnVtID4+IDgpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgYjogKG51bSAmIDI1NSkgLyAyNTVcbiAgICB9O1xufVxuXG5sZXQgY29sb3JQcm9iZSA9IG51bGw7XG5cbi8vIEJyb3dzZXJzIHNoaXAgYSBjb21wbGV0ZSBDU1MgY29sb3IgcGFyc2VyIC0tIGV2ZXJ5IG5hbWVkIGNvbG9yLCByZ2IoKSwgaHNsKCksIGh3YigpLlxuLy8gQm9ycm93IGl0IGluc3RlYWQgb2YgbWFpbnRhaW5pbmcgYSBsb29rdXAgdGFibGUuIFJldHVybnMgbnVsbCBvdXRzaWRlIGEgRE9NIChOb2RlIHRlc3RzKSxcbi8vIHdoZXJlIHRoZSBoZXggZmFsbGJhY2sgaW4gcGFyc2VDb2xvciBzdGlsbCBhcHBsaWVzLlxuZnVuY3Rpb24gY3NzQ29sb3JUb1JnYih2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgZG9jdW1lbnQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsO1xuICAgIGlmICghY29sb3JQcm9iZSkgY29sb3JQcm9iZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjYW52YXNcIikuZ2V0Q29udGV4dChcIjJkXCIpO1xuXG4gICAgLy8gQXNzaWduaW5nIGFuIGludmFsaWQgY29sb3IgbGVhdmVzIGZpbGxTdHlsZSB1bnRvdWNoZWQsIHNvIHByb2JlIGFnYWluc3QgdHdvIGRpZmZlcmVudFxuICAgIC8vIHNlbnRpbmVsczogb25seSBhIHZhbHVlIHRoZSBicm93c2VyIGFjdHVhbGx5IHBhcnNlZCBwcm9kdWNlcyB0aGUgc2FtZSByZXN1bHQgdHdpY2UuXG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiMwMDAwMDBcIjtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xuICAgIGNvbnN0IGZpcnN0ID0gY29sb3JQcm9iZS5maWxsU3R5bGU7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiNmZmZmZmZcIjtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xuICAgIGlmIChmaXJzdCAhPT0gY29sb3JQcm9iZS5maWxsU3R5bGUpIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGZpcnN0LnN0YXJ0c1dpdGgoXCIjXCIpKSByZXR1cm4gaGV4VG9SZ2IoZmlyc3QpO1xuICAgIGNvbnN0IG1hdGNoID0gZmlyc3QubWF0Y2goL3JnYmE/XFwoKFteKV0rKVxcKS8pO1xuICAgIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHBhcnRzID0gbWF0Y2hbMV0uc3BsaXQoXCIsXCIpLm1hcChwID0+IHBhcnNlRmxvYXQocC50cmltKCkpKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMyB8fCBwYXJ0cy5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHI6IHBhcnRzWzBdIC8gMjU1LCBnOiBwYXJ0c1sxXSAvIDI1NSwgYjogcGFydHNbMl0gLyAyNTUgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29sb3IoY29sb3JTdHIsIGZhbGxiYWNrSGV4ID0gXCIjMzM4OGZmXCIpIHtcbiAgICBpZiAoIWNvbG9yU3RyKSBjb2xvclN0ciA9IGZhbGxiYWNrSGV4O1xuICAgIHJldHVybiBjc3NDb2xvclRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBoZXhUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgY3NzQ29sb3JUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgaGV4VG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IHsgcjogMC4yLCBnOiAwLjUsIGI6IDEuMCB9O1xufVxuXG5jb25zdCBVUkxfQVRUUl9CRUZPUkUgPSAvKD86aHJlZnxzcmMpXFxzKj1cXHMqWydcIl0/JC9pO1xuY29uc3QgU0FGRV9VUkwgPSAvXig/Omh0dHBzPzpcXC9cXC98bWFpbHRvOnx0ZWw6fGRhdGE6aW1hZ2VcXC98Wy4vIz9dfFtcXHcuLV0rKD86Wy8/I118JCkpL2k7XG5cbi8vIFByb3BlcnR5IHZhbHVlcyBjb21lIGZyb20gdXNlciBkYXRhIGFuZCBlbmQgdXAgaW4gaW5uZXJIVE1MLCBzbyB0aGV5IGFyZSBlc2NhcGVkLlxuLy8gTWFya3VwIHRoZSBhcHAgYXV0aG9yIHdyb3RlICh0ZW1wbGF0ZXMsIHN0eWxlIHN0cmluZ3MpIGlzIGxlZnQgaW50YWN0LlxuZXhwb3J0IGZ1bmN0aW9uIGVzY2FwZUh0bWwodmFsdWUpIHtcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlKVxuICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXG4gICAgICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxuICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcbiAgICAgICAgLnJlcGxhY2UoL1wiL2csIFwiJnF1b3Q7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8nL2csIFwiJiMzOTtcIik7XG59XG5cbi8vIEVzY2FwaW5nIHN0b3BzIGF0dHJpYnV0ZSBicmVha291dCBidXQgbm90IFwiamF2YXNjcmlwdDpcIiBpbiBhbiBocmVmLCBzbyB2YWx1ZXMgbGFuZGluZ1xuLy8gaW4gYSBVUkwgYXR0cmlidXRlIGdldCBhIHNjaGVtZSBjaGVjay4gQ29udHJvbCBjaGFyYWN0ZXJzIGFyZSBzdHJpcHBlZCBmaXJzdCBiZWNhdXNlXG4vLyBcImphdmFcXHRzY3JpcHQ6XCIgc3Vydml2ZXMgYSBuYWl2ZSBjb21wYXJpc29uLlxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVVcmwodmFsdWUpIHtcbiAgICBjb25zdCBjb2xsYXBzZWQgPSBTdHJpbmcodmFsdWUpLnNwbGl0KFwiXCIpLmZpbHRlcihjID0+IGMuY2hhckNvZGVBdCgwKSA+IDMyKS5qb2luKFwiXCIpO1xuICAgIHJldHVybiBTQUZFX1VSTC50ZXN0KGNvbGxhcHNlZCkgPyBTdHJpbmcodmFsdWUpIDogXCJcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKSB7XG4gICAgY29uc3QgdGFyZ2V0RmllbGRzID0gKEFycmF5LmlzQXJyYXkoZmllbGRzKSAmJiBmaWVsZHMubGVuZ3RoKSA/IGZpZWxkcyA6IE9iamVjdC5rZXlzKHByb3BzKTtcbiAgICBjb25zdCBsYWJlbHMgPSAoQXJyYXkuaXNBcnJheShuYW1lcykgJiYgbmFtZXMubGVuZ3RoID09PSB0YXJnZXRGaWVsZHMubGVuZ3RoKSA/IG5hbWVzIDogdGFyZ2V0RmllbGRzO1xuICAgIGNvbnN0IGxpbmVzID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0YXJnZXRGaWVsZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgZiA9IHRhcmdldEZpZWxkc1tpXTtcbiAgICAgICAgaWYgKHByb3BzW2ZdID09PSB1bmRlZmluZWQgfHwgcHJvcHNbZl0gPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgICBsaW5lcy5wdXNoKGA8Yj4ke2VzY2FwZUh0bWwobGFiZWxzW2ldKX08L2I+OiAke2VzY2FwZUh0bWwocHJvcHNbZl0pfWApO1xuICAgIH1cbiAgICByZXR1cm4gbGluZXMuam9pbihcIjxicj5cIik7XG59XG5cbi8vIFwie2NvbHVtbn1cIiBpbnNlcnRzIG9uZSBlc2NhcGVkIHZhbHVlOyBcInsqfVwiIGluc2VydHMgdGhlIGRlZmF1bHQgZmllbGQgbGlzdC5cbmZ1bmN0aW9uIHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIHJldHVybiB0ZW1wbGF0ZS5yZXBsYWNlKC9cXHsoXFwqfFxcdyspXFx9L2csIChtYXRjaCwga2V5LCBvZmZzZXQpID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCIqXCIpIHtcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdmFsID0gcHJvcHNba2V5XTtcbiAgICAgICAgaWYgKHZhbCA9PT0gdW5kZWZpbmVkIHx8IHZhbCA9PT0gbnVsbCkgcmV0dXJuIFwiXCI7XG4gICAgICAgIGNvbnN0IHByZWNlZGluZyA9IHRlbXBsYXRlLnNsaWNlKE1hdGgubWF4KDAsIG9mZnNldCAtIDE2KSwgb2Zmc2V0KTtcbiAgICAgICAgcmV0dXJuIGVzY2FwZUh0bWwoVVJMX0FUVFJfQkVGT1JFLnRlc3QocHJlY2VkaW5nKSA/IHNhZmVVcmwodmFsKSA6IHZhbCk7XG4gICAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwga2luZCkge1xuICAgIGNvbnN0IHRlbXBsYXRlID0gbGF5ZXJba2luZCArIFwiX3RlbXBsYXRlXCJdO1xuICAgIGNvbnN0IGZpZWxkcyA9IGxheWVyW2tpbmQgKyBcIl9maWVsZHNcIl07XG4gICAgY29uc3QgbmFtZXMgPSBsYXllcltraW5kICsgXCJfbmFtZXNcIl07XG4gICAgaWYgKHR5cGVvZiB0ZW1wbGF0ZSA9PT0gXCJzdHJpbmdcIiAmJiB0ZW1wbGF0ZSkge1xuICAgICAgICByZXR1cm4gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICB9XG4gICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbn1cblxuZnVuY3Rpb24gd3JhcFN0eWxlZChodG1sLCBzdHlsZSkge1xuICAgIGlmICghc3R5bGUpIHJldHVybiBodG1sO1xuICAgIHJldHVybiBgPGRpdiBzdHlsZT1cIiR7ZXNjYXBlSHRtbChzdHlsZSl9XCI+JHtodG1sfTwvZGl2PmA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kUG9wdXAobWFwLCBsYXRsbmcsIHByb3BzLCBsYXllcikge1xuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJwb3B1cFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfcG9wdXAgfHwgbGF5ZXIucG9wdXBfZmllbGRzIHx8IGxheWVyLnBvcHVwX3RlbXBsYXRlKSkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge307XG4gICAgICAgIGlmIChsYXllci5wb3B1cF9tYXhfd2lkdGgpIG9wdGlvbnMubWF4V2lkdGggPSBsYXllci5wb3B1cF9tYXhfd2lkdGg7XG4gICAgICAgIEwucG9wdXAob3B0aW9ucylcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci5wb3B1cF9zdHlsZSkpXG4gICAgICAgICAgICAub3Blbk9uKG1hcCk7XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFRvb2x0aXAobWFwLCBsYXRsbmcsIHByb3BzLCBsYXllciwgbGF5ZXJJbnN0YW5jZSkge1xuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJ0b29sdGlwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF90b29sdGlwIHx8IGxheWVyLnRvb2x0aXBfZmllbGRzIHx8IGxheWVyLnRvb2x0aXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGlmICghbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcCA9IEwudG9vbHRpcCh7IGRpcmVjdGlvbjogJ3RvcCcsIG9mZnNldDogWzAsIC01XSB9KTtcbiAgICAgICAgfVxuICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIudG9vbHRpcF9zdHlsZSkpXG4gICAgICAgICAgICAuYWRkVG8obWFwKTtcbiAgICB9XG59XG4iLCAiY29uc3QgY29sbGFwc2VkUGF0aHMgPSB7fTsgIC8vIHBhdGggLT4gY29sbGFwc2VkP1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldExheWVyQm91bmRzKGwsIGNvb3JkaW5hdGVCdWZmZXJzKSB7XHJcbiAgICBpZiAoIWwpIHJldHVybiBudWxsO1xyXG5cclxuICAgIC8vIFN1cHBvcnQgZm9sZGVyIHRyZWUgbm9kZXMgKGdyb3VwcyBpbiBzaWRlYmFyIHRyZWUpXHJcbiAgICBpZiAobC5pc0dyb3VwKSB7XHJcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XHJcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGRyZW4gZ3JvdXBzXHJcbiAgICAgICAgT2JqZWN0LmtleXMobC5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBiID0gZ2V0TGF5ZXJCb3VuZHMobC5jaGlsZHJlbltrZXldLCBjb29yZGluYXRlQnVmZmVycyk7XHJcbiAgICAgICAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzBdID4gbWF4TGF0KSBtYXhMYXQgPSBiWzFdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGNoaWxkIGxheWVyc1xyXG4gICAgICAgIGwubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKGx5ciwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xyXG4gICAgICAgICAgICBpZiAoYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzFdIDwgbWluTG9uKSBtaW5Mb24gPSBiWzBdWzFdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW1ttaW5MYXQsIG1pbkxvbl0sIFttYXhMYXQsIG1heExvbl1dO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobC5ib3VuZHMgJiYgbC5ib3VuZHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHJldHVybiBsLmJvdW5kcztcclxuICAgIH1cclxuICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsLmxheWVycykge1xyXG4gICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xyXG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGwubGF5ZXJzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhzdWIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcclxuICAgICAgICAgICAgaWYgKGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiWzBdWzBdIDwgbWluTGF0KSBtaW5MYXQgPSBiWzBdWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XHJcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcclxuICAgICAgICAgICAgICAgIGlmIChiWzFdWzFdID4gbWF4TG9uKSBtYXhMb24gPSBiWzFdWzFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChtaW5MYXQgIT09IEluZmluaXR5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKGwubG9jYXRpb25zICYmIGwubG9jYXRpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcclxuICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICBjb25zdCBjb29yZHMgPSBsLmxvY2F0aW9ucy5mbGF0KEluZmluaXR5KTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGg7IGkgKz0gMikge1xyXG4gICAgICAgICAgICBjb25zdCBsYXQgPSBjb29yZHNbaV07XHJcbiAgICAgICAgICAgIGNvbnN0IGxvbiA9IGNvb3Jkc1tpICsgMV07XHJcbiAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcclxuICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xyXG4gICAgICAgICAgICBpZiAobG9uIDwgbWluTG9uKSBtaW5Mb24gPSBsb247XHJcbiAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcclxuICAgICAgICBjb25zdCBidWYgPSBjb29yZGluYXRlQnVmZmVyc1tsLmlkXTtcclxuICAgICAgICBpZiAoYnVmKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoYnVmLmJ1ZmZlciwgYnVmLmJ5dGVPZmZzZXQsIGJ1Zi5ieXRlTGVuZ3RoIC8gOCk7XHJcbiAgICAgICAgICAgIGxldCBtaW5MYXQgPSBJbmZpbml0eSwgbWF4TGF0ID0gLUluZmluaXR5O1xyXG4gICAgICAgICAgICBsZXQgbWluTG9uID0gSW5maW5pdHksIG1heExvbiA9IC1JbmZpbml0eTtcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoIC8gMjsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsYXQgPSBjb29yZHNbaSAqIDJdO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKiAyICsgMV07XHJcbiAgICAgICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICBpZiAobGF0ID4gbWF4TGF0KSBtYXhMYXQgPSBsYXQ7XHJcbiAgICAgICAgICAgICAgICBpZiAobG9uIDwgbWluTG9uKSBtaW5Mb24gPSBsb247XHJcbiAgICAgICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gVGhlIHdyaXRlIGhhbGYgb2YgYSB2aXNpYmlsaXR5IHRvZ2dsZTogb25lIGN1c3RvbSBtZXNzYWdlIG5hbWluZyB0aGUgZmxpcHBlZCBpZHMsXHJcbi8vIGluc3RlYWQgb2YgdGhlIHdob2xlIGxheWVycyB0cmFpdC4gUHl0aG9uIGFwcGxpZXMgdGhlIGZpZWxkcyBhbmQgcmUtZW1pdHMgdGhlbSBhc1xyXG4vLyBgc2V0YCBwYXRjaCBvcHMsIHdoaWNoIGlzIGhvdyBvdGhlciB2aWV3cyBvZiB0aGUgc2FtZSBtYXAgKG5vdGVib29rIG91dHB1dHMpIHN0YXlcclxuLy8gaW4gc3RlcCBub3cgdGhhdCB0aGUgdHJhaXQgbm8gbG9uZ2VyIGNhcnJpZXMgdG9nZ2xlcy5cclxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRMYXllcldyaXRlKG1vZGVsLCBjaGFuZ2VzKSB7XHJcbiAgICBpZiAoIWNoYW5nZXMubGVuZ3RoKSByZXR1cm47XHJcbiAgICB0cnkge1xyXG4gICAgICAgIG1vZGVsLnNlbmQoe1xyXG4gICAgICAgICAgICBraW5kOiBcInN3aWZ0bWFwX3dyaXRlXCIsXHJcbiAgICAgICAgICAgIG9wczogY2hhbmdlcy5tYXAoYyA9PiAoeyBvcDogXCJzZXRcIiwgaWQ6IGMuaWQsIGZpZWxkczogeyB2aXNpYmxlOiBjLnZpc2libGUgfSB9KSksXHJcbiAgICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgcmVuZGVyZWQgbGlzdCBhbHJlYWR5IGhvbGRzIHRoZSBjaGFuZ2UgKi8gfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUmFkaW9MYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcclxuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcclxuICAgIGlmICghZ3JvdXBDb25maWdzW1wiXCJdKSB7XHJcbiAgICAgICAgZ3JvdXBDb25maWdzW1wiXCJdID0geyBtdWx0aV9zZWxlY3Q6IHRydWUsIHZpc2libGU6IHRydWUgfTtcclxuICAgIH1cclxuICAgIGxheWVycy5mb3JFYWNoKGwgPT4ge1xyXG4gICAgICAgIGNvbnN0IHBhdGhTdHIgPSBsLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCI7XHJcbiAgICAgICAgY29uc3QgcGFydHMgPSBwYXRoU3RyLnNwbGl0KFwiL1wiKTtcclxuICAgICAgICBsZXQgY3VyciA9IHRyZWU7XHJcbiAgICAgICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcclxuICAgICAgICBwYXJ0cy5mb3JFYWNoKHBhcnQgPT4ge1xyXG4gICAgICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcclxuICAgICAgICAgICAgaWYgKCFjdXJyLmNoaWxkcmVuW3BhcnRdKSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyLmNoaWxkcmVuW3BhcnRdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHBhcnQsXHJcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogcnVubmluZ1BhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IHt9LFxyXG4gICAgICAgICAgICAgICAgICAgIGxheWVyczogW10sXHJcbiAgICAgICAgICAgICAgICAgICAgaXNHcm91cDogdHJ1ZVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjdXJyID0gY3Vyci5jaGlsZHJlbltwYXJ0XTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjdXJyLmxheWVycy5wdXNoKGwpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUmVwb3J0cyB3aGF0IGl0IGNoYW5nZWQgLS0ge2NoYW5nZXM6IFt7aWQsIHZpc2libGV9XSwgZ3JvdXBzQ2hhbmdlZH0gLS0gc28gdGhlXHJcbiAgICAvLyBjYWxsZXIgY2FuIHdyaXRlIGJhY2sgZXhhY3RseSB0aG9zZSBmbGlwcyByYXRoZXIgdGhhbiB0aGUgd2hvbGUgbGF5ZXJzIGxpc3QuXHJcbiAgICBjb25zdCBjaGFuZ2VzID0gW107XHJcbiAgICBsZXQgZ3JvdXBzQ2hhbmdlZCA9IGZhbHNlO1xyXG4gICAgZnVuY3Rpb24gZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZiA9IGdyb3VwQ29uZmlnc1tub2RlLnBhdGhdIHx8IHsgbXVsdGlfc2VsZWN0OiB0cnVlIH07XHJcbiAgICAgICAgY29uc3QgaXNSYWRpb0dyb3VwID0gY29uZi5tdWx0aV9zZWxlY3QgPT09IGZhbHNlO1xyXG4gICAgICAgIGlmIChpc1JhZGlvR3JvdXApIHtcclxuICAgICAgICAgICAgbGV0IGZvdW5kQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkR3JvdXAgPSBub2RlLmNoaWxkcmVuW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0gPSB7IHZpc2libGU6IHRydWUsIG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gZ3JvdXBDb25maWdzW2NoaWxkR3JvdXAucGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3Vwc0NoYW5nZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpc1Zpc2libGUgPSBseXIudmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZXMucHVzaCh7IGlkOiBseXIuaWQsIHZpc2libGU6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXMobm9kZS5jaGlsZHJlbltrZXldKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIGVuZm9yY2VSYWRpb1RvZ2dsZXModHJlZSk7XHJcbiAgICByZXR1cm4geyBjaGFuZ2VzLCBncm91cHNDaGFuZ2VkIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJTaWRlYmFyQ29udHJvbHMoc2lkZWJhciwgbGF5ZXJzLCBtb2RlbCwgbWFwLCBvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICBzaWRlYmFyLmlubmVySFRNTCA9IFwiPGIgc3R5bGU9J2ZvbnQtc2l6ZTogMTNweDsgYm9yZGVyLWJvdHRvbTogMnB4IHNvbGlkICNlZWU7IHBhZGRpbmctYm90dG9tOiA0cHg7IGRpc3BsYXk6IGJsb2NrOyBtYXJnaW4tYm90dG9tOiA4cHg7Jz5MYXllcnMgQ29udHJvbDwvYj5cIjtcclxuICAgIFxyXG4gICAgY29uc3QgZ3JvdXBDb25maWdzID0gbW9kZWwuZ2V0KFwiZ3JvdXBfY29uZmlnc1wiKSB8fCB7fTtcclxuXHJcbiAgICAvLyAxLiBCdWlsZCBhIG5lc3RlZCBoaWVyYXJjaGljYWwgdHJlZSBmcm9tIHRoZSBmbGF0IGxheWVycyBsaXN0XHJcbiAgICBjb25zdCB0cmVlID0geyBuYW1lOiBcIlJvb3RcIiwgcGF0aDogXCJcIiwgY2hpbGRyZW46IHt9LCBsYXllcnM6IFtdLCBpc0dyb3VwOiB0cnVlIH07XHJcbiAgICBcclxuICAgIC8vIEVuc3VyZSByb290LWxldmVsIGNvbmZpZ3MgZGVmYXVsdCB0byBtdWx0aV9zZWxlY3Q6IHRydWUgaWYgbm90IHNwZWNpZmllZFxyXG4gICAgaWYgKCFncm91cENvbmZpZ3NbXCJcIl0pIHtcclxuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG5cclxuICAgIGxheWVycy5mb3JFYWNoKGwgPT4ge1xyXG4gICAgICAgIGNvbnN0IHBhdGhTdHIgPSBsLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCI7XHJcbiAgICAgICAgY29uc3QgcGFydHMgPSBwYXRoU3RyLnNwbGl0KFwiL1wiKTtcclxuICAgICAgICBsZXQgY3VyciA9IHRyZWU7XHJcbiAgICAgICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcclxuICAgICAgICBwYXJ0cy5mb3JFYWNoKHBhcnQgPT4ge1xyXG4gICAgICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcclxuICAgICAgICAgICAgaWYgKCFjdXJyLmNoaWxkcmVuW3BhcnRdKSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyLmNoaWxkcmVuW3BhcnRdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHBhcnQsXHJcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogcnVubmluZ1BhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IHt9LFxyXG4gICAgICAgICAgICAgICAgICAgIGxheWVyczogW10sXHJcbiAgICAgICAgICAgICAgICAgICAgaXNHcm91cDogdHJ1ZVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjdXJyID0gY3Vyci5jaGlsZHJlbltwYXJ0XTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjdXJyLmxheWVycy5wdXNoKGwpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gMi4gUmVjdXJzaXZlIGZ1bmN0aW9uIHRvIHJlbmRlciBhIHRyZWUgbm9kZVxyXG4gICAgZnVuY3Rpb24gcmVuZGVyTm9kZShub2RlLCBwYXJlbnRFbCwgZGVwdGgsIHBhcmVudE5vZGUsIHBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcclxuXHJcbiAgICAgICAgaWYgKG5vZGUucGF0aCA9PT0gXCJcIikge1xyXG4gICAgICAgICAgICAvLyBSZW5kZXIgcm9vdCdzIGNoaWxkIGdyb3VwcyBhbmQgY2hpbGQgbGF5ZXJzIGRpcmVjdGx5IHdpdGhvdXQgaGVhZGVyXHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobm9kZS5jaGlsZHJlbltrZXldLCBwYXJlbnRFbCwgZGVwdGgsIG5vZGUsIHRydWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbm9kZS5sYXllcnMuZm9yRWFjaChseXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShseXIsIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBpc0dyb3VwID0gbm9kZS5pc0dyb3VwID09PSB0cnVlO1xyXG4gICAgICAgIGNvbnN0IHBhdGggPSBpc0dyb3VwID8gbm9kZS5wYXRoIDogbnVsbDtcclxuICAgICAgICBjb25zdCBuYW1lID0gbm9kZS5uYW1lO1xyXG4gICAgICAgIGNvbnN0IGlkID0gaXNHcm91cCA/IG51bGwgOiBub2RlLmlkO1xyXG5cclxuICAgICAgICAvLyBEZXRlcm1pbmUgc2VsZWN0aW9uIHR5cGUgKGNoZWNrYm94IHZzIHJhZGlvKSBiYXNlZCBvbiBwYXJlbnQncyBtdWx0aV9zZWxlY3QgY29uZmlnXHJcbiAgICAgICAgY29uc3QgcGFyZW50UGF0aCA9IHBhcmVudE5vZGUgPyBwYXJlbnROb2RlLnBhdGggOiBcIlwiO1xyXG4gICAgICAgIGNvbnN0IHBhcmVudENvbmYgPSBncm91cENvbmZpZ3NbcGFyZW50UGF0aF0gfHwgeyBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICBjb25zdCBpc011bHRpU2VsZWN0ID0gcGFyZW50Q29uZi5tdWx0aV9zZWxlY3QgIT09IGZhbHNlO1xyXG5cclxuICAgICAgICBjb25zdCBub2RlRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBub2RlRGl2LnN0eWxlLm1hcmdpbkJvdHRvbSA9IFwiNHB4XCI7XHJcblxyXG4gICAgICAgIGxldCBzZWxmVmlzaWJsZSA9IHRydWU7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgc2VsZlZpc2libGUgPSBwYXRoID09PSBcIkJhc2VtYXBzXCIgPyB0cnVlIDogKGdyb3VwQ29uZmlnc1twYXRoXT8udmlzaWJsZSAhPT0gZmFsc2UpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHNlbGZWaXNpYmxlID0gbm9kZS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3Qgc2VsZkVmZmVjdGl2ZVZpc2libGUgPSBwYXJlbnRFZmZlY3RpdmVWaXNpYmxlICYmIHNlbGZWaXNpYmxlO1xyXG5cclxuICAgICAgICBjb25zdCBoZWFkZXJEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5kaXNwbGF5ID0gXCJmbGV4XCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmFsaWduSXRlbXMgPSBcImNlbnRlclwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5jdXJzb3IgPSBcInBvaW50ZXJcIjtcclxuICAgICAgICBoZWFkZXJEaXYuc3R5bGUudXNlclNlbGVjdCA9IFwibm9uZVwiO1xyXG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS53ZWJraXRVc2VyU2VsZWN0ID0gXCJub25lXCI7XHJcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmZvbnRTaXplID0gXCIxMnB4XCI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFwYXJlbnRFZmZlY3RpdmVWaXNpYmxlKSB7XHJcbiAgICAgICAgICAgIGhlYWRlckRpdi5zdHlsZS5vcGFjaXR5ID0gXCIwLjVcIjtcclxuICAgICAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmNvbG9yID0gXCIjODg4XCI7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBUb2dnbGUgRXhwYW5kL0NvbGxhcHNlIGFycm93XHJcbiAgICAgICAgbGV0IHRvZ2dsZUVsID0gbnVsbDtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICB0b2dnbGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLndpZHRoID0gXCIxNHB4XCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmZvbnRTaXplID0gXCIxNnB4XCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmxpbmVIZWlnaHQgPSBcIjFcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWJsb2NrXCI7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLnRleHRBbGlnbiA9IFwiY2VudGVyXCI7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgIHRvZ2dsZUVsLnRleHRDb250ZW50ID0gaXNDb2xsYXBzZWQgPyBcIlx1MjVCOFwiIDogXCJcdTI1QkVcIjtcclxuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFdlaWdodCA9IFwiYm9sZFwiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQodG9nZ2xlRWwpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNwYWNlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjRweFwiO1xyXG4gICAgICAgICAgICBzcGFjZXIuc3R5bGUud2lkdGggPSBcIjE0cHhcIjtcclxuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLmRpc3BsYXkgPSBcImlubGluZS1ibG9ja1wiO1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYXBwZW5kQ2hpbGQoc3BhY2VyKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENoZWNrYm94IG9yIFJhZGlvIGlucHV0IGVsZW1lbnRcclxuICAgICAgICBsZXQgaW5wdXQgPSBudWxsO1xyXG4gICAgICAgIGlmICghaXNHcm91cCB8fCBwYXRoICE9PSBcIkJhc2VtYXBzXCIpIHtcclxuICAgICAgICAgICAgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW5wdXRcIik7XHJcbiAgICAgICAgICAgIGlucHV0LnR5cGUgPSBpc011bHRpU2VsZWN0ID8gXCJjaGVja2JveFwiIDogXCJyYWRpb1wiO1xyXG4gICAgICAgICAgICBpbnB1dC5uYW1lID0gaXNNdWx0aVNlbGVjdCA/IChpc0dyb3VwID8gYGdyb3VwXyR7cGF0aH1gIDogYGxheWVyXyR7aWR9YCkgOiBgcGFyZW50XyR7cGFyZW50UGF0aH1gO1xyXG4gICAgICAgICAgICBpbnB1dC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNnB4XCI7XHJcbiAgICAgICAgICAgIGlucHV0LnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xyXG4gICAgICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBDb25maWdzW3BhdGhdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0geyB2aXNpYmxlOiB0cnVlLCBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSBncm91cENvbmZpZ3NbcGF0aF0udmlzaWJsZSAhPT0gZmFsc2U7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gbm9kZS52aXNpYmxlICE9PSBmYWxzZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGlucHV0KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIExhYmVsIFRleHRcclxuICAgICAgICBjb25zdCBsYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgIGxhYmVsLnRleHRDb250ZW50ID0gbmFtZTtcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBsYWJlbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChsYWJlbCk7XHJcblxyXG4gICAgICAgIG5vZGVEaXYuYXBwZW5kQ2hpbGQoaGVhZGVyRGl2KTtcclxuXHJcbiAgICAgICAgLy8gQ2hpbGRyZW4gRHJhd2VyIChmb3IgZ3JvdXBzKVxyXG4gICAgICAgIGxldCBjaGlsZHJlbkRpdiA9IG51bGw7XHJcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgICAgICAgICBjb25zdCBpc0NvbGxhcHNlZCA9IGNvbGxhcHNlZFBhdGhzW3BhdGhdID09PSB0cnVlO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5kaXNwbGF5ID0gaXNDb2xsYXBzZWQgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuYm9yZGVyTGVmdCA9IFwiMXB4IGRhc2hlZCAjY2NjXCI7XHJcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLm1hcmdpbkxlZnQgPSBcIjVweFwiO1xyXG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5wYWRkaW5nTGVmdCA9IFwiOHB4XCI7XHJcblxyXG4gICAgICAgICAgICAvLyBSZW5kZXIgc3ViLWdyb3VwcyBhbmQgbGF5ZXJzIHJlY3Vyc2l2ZWx5XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5vZGUuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobm9kZS5jaGlsZHJlbltrZXldLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgY2hpbGRyZW5EaXYsIGRlcHRoICsgMSwgbm9kZSwgc2VsZkVmZmVjdGl2ZVZpc2libGUpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIG5vZGVEaXYuYXBwZW5kQ2hpbGQoY2hpbGRyZW5EaXYpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVG9nZ2xlIEV4cGFuZC9Db2xsYXBzZSB3aGVuIGNsaWNraW5nIGhlYWRlciByb3cgKGJhY2tncm91bmQsIGVtcHR5IHNwYWNlLCBvciBhcnJvdylcclxuICAgICAgICBpZiAoaXNHcm91cCkge1xyXG4gICAgICAgICAgICBoZWFkZXJEaXYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XHJcbiAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1twYXRoXSA9ICFpc0NvbGxhcHNlZDtcclxuICAgICAgICAgICAgICAgIGlmICh0b2dnbGVFbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRvZ2dsZUVsLnRleHRDb250ZW50ID0gIWlzQ29sbGFwc2VkID8gXCJcdTI1QjhcIiA6IFwiXHUyNUJFXCI7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoY2hpbGRyZW5EaXYpIHtcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5kaXNwbGF5ID0gIWlzQ29sbGFwc2VkID8gXCJub25lXCIgOiBcImJsb2NrXCI7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFiZWwgY2xpY2sgbGlzdGVuZXJcclxuICAgICAgICBpZiAoaW5wdXQpIHtcclxuICAgICAgICAgICAgbGFiZWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gIWlucHV0LmNoZWNrZWQ7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaW5wdXQuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoXCJjaGFuZ2VcIikpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIElucHV0IGNoYW5nZSBsaXN0ZW5lclxyXG4gICAgICAgIGlmIChpbnB1dCkge1xyXG4gICAgICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzQ2hlY2tlZCA9IGlucHV0LmNoZWNrZWQ7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEZvciByYWRpbyBidXR0b25zLCBvbmx5IHByb2Nlc3MgdGhlIHNlbGVjdGlvbiBldmVudCAoaWdub3JlIGRlLXNlbGVjdGlvbiBldmVudHMpXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QgJiYgIWlzQ2hlY2tlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBGbGlwcGVkIG9uIHRoZSBsaXN0IHRoaXMgc2lkZWJhciByZW5kZXJlZCBmcm9tLCBuZXZlciBtb2RlbC5nZXQoXCJsYXllcnNcIikuXHJcbiAgICAgICAgICAgICAgICAvLyBMYXllcnMgYWRkZWQgYWZ0ZXIgdGhlIHdpZGdldCBpcyBkaXNwbGF5ZWQgYXJyaXZlIGFzIHBhdGNoZXMgdGhhdCB1cGRhdGUgdGhlXHJcbiAgICAgICAgICAgICAgICAvLyBmcm9udGVuZCdzIGxvY2FsIHN0YXRlIHdpdGhvdXQgdG91Y2hpbmcgdGhlIHRyYWl0LCBzbyB0aGUgbW9kZWwncyBjb3B5IGlzXHJcbiAgICAgICAgICAgICAgICAvLyBmcm96ZW4gYXQgd2hhdGV2ZXIgdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSBjYXJyaWVkLiBCdWlsZGluZyB0aGUgdXBkYXRlIGZyb21cclxuICAgICAgICAgICAgICAgIC8vIGl0IGRyb3BzIGV2ZXJ5IGxhdGVyIGxheWVyOiB0aGUgdG9nZ2xlIG1hdGNoZXMgbm8gaWQsIHdyaXRlcyB0aGUgc3RhbGUgbGlzdFxyXG4gICAgICAgICAgICAgICAgLy8gYmFjaywgYW5kIHRoZSBjaGFuZ2UgaGFuZGxlciB0aGVuIHJlc2V0cyBsb2NhbCBzdGF0ZSB0byBpdCAtLSBzbyB0aGUgYm94XHJcbiAgICAgICAgICAgICAgICAvLyByZS1jaGVja3MgaXRzZWxmIGFuZCB0aGUgbGF5ZXIgbmV2ZXIgaGlkZXMuXHJcbiAgICAgICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAgICAgLy8gVGhlIGZsaXBzIG11dGF0ZSB0aGUgcmVuZGVyZWQgbGlzdCBpbiBwbGFjZSBhbmQgcmVhY2ggUHl0aG9uIGFzIGEgdGFyZ2V0ZWRcclxuICAgICAgICAgICAgICAgIC8vIHdyaXRlIChzZW5kTGF5ZXJXcml0ZSksIG5ldmVyIGJ5IHNldHRpbmcgdGhlIGxheWVycyB0cmFpdDogdGhlIGZ1bGxcclxuICAgICAgICAgICAgICAgIC8vIHdyaXRlLWJhY2sgc2NhbGVkIHdpdGggdGhlIG1hcCBpbnN0ZWFkIG9mIHRoZSBjbGljay4gQXQgMjUgdHJhY2tzIHggMjAwa1xyXG4gICAgICAgICAgICAgICAgLy8gdmVydGljZXMgaXQgd2FzIGEgMzYgTUIgZnJhbWUgLS0gcGFzdCB1dmljb3JuJ3MgMTYgTUIgZGVmYXVsdCB3ZWJzb2NrZXRcclxuICAgICAgICAgICAgICAgIC8vIGNhcCwgc28gdGhlIHNlcnZlciBjbG9zZWQgdGhlIGNvbm5lY3Rpb24gYW5kIHRoZSBTaGlueSBzZXNzaW9uIGRpZWQgb25cclxuICAgICAgICAgICAgICAgIC8vIHRoZSBmaXJzdCBjaGVja2JveC4gU2V0dGluZyB0aGUgdHJhaXQgd2l0aG91dCBzYXZpbmcgaXMganVzdCBhcyBmYXRhbDpcclxuICAgICAgICAgICAgICAgIC8vIGl0IHN0YXlzIGRpcnR5IGFuZCB0aGUgbmV4dCBzYXZlX2NoYW5nZXMgKGFueSBwYW4pIGZsdXNoZXMgaXQuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBjaGFuZ2VzID0gW107XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmbGlwID0gKGx5ciwgdmlzaWJsZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICgobHlyLnZpc2libGUgIT09IGZhbHNlKSA9PT0gdmlzaWJsZSkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgIGx5ci52aXNpYmxlID0gdmlzaWJsZTtcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VzLnB1c2goeyBpZDogbHlyLmlkLCB2aXNpYmxlIH0pO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSYWRpbyBidXR0b24gbG9naWM6IHNldCBhbGwgc2libGluZ3MgdG8gdmlzaWJsZT1mYWxzZSwgYW5kIHRoaXMgdG8gdmlzaWJsZT10cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMocGFyZW50Tm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJHcm91cCA9IHBhcmVudE5vZGUuY2hpbGRyZW5ba2V5XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gc2liR3JvdXAucGF0aCA9PT0gcGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uZ3JvdXBDb25maWdzW3NpYkdyb3VwLnBhdGhdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogYWN0aXZlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3NpYkdyb3VwLnBhdGhdID0gIWFjdGl2ZTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBwYXJlbnROb2RlLmxheWVycy5mb3JFYWNoKHNpYkx5ciA9PiBmbGlwKHNpYkx5ciwgc2liTHlyLmlkID09PSBpZCkpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVja2JveCBsb2dpY1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0dyb3VwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQ29uZmlnc1twYXRoXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1twYXRoXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU6IGlzQ2hlY2tlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1twYXRoXSA9ICFpc0NoZWNrZWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbHlyID0gbGF5ZXJzLmZpbmQobCA9PiBsLmlkID09PSBpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChseXIpIGZsaXAobHlyLCBpc0NoZWNrZWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBzZW5kTGF5ZXJXcml0ZShtb2RlbCwgY2hhbmdlcyk7XHJcbiAgICAgICAgICAgICAgICAvLyBncm91cF9jb25maWdzIHN0YXlzIG9uIHRoZSB0cmFpdDogaXQgaXMgYSBoYW5kZnVsIG9mIGZvbGRlciBmbGFncywgYW5kIHRoZVxyXG4gICAgICAgICAgICAgICAgLy8gc3ByZWFkIGdpdmVzIEJhY2tib25lIGEgZnJlc2ggcmVmZXJlbmNlIHNvIHRoZSBpbi1wbGFjZSBlZGl0cyByZWdpc3Rlci5cclxuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImdyb3VwX2NvbmZpZ3NcIiwgeyAuLi5ncm91cENvbmZpZ3MgfSk7XHJcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldExheWVyQm91bmRzKG5vZGUsIG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJvdW5kcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvbkxheWVyVG9nZ2xlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb25MYXllclRvZ2dsZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcmVudEVsLmFwcGVuZENoaWxkKG5vZGVEaXYpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbmRlciB0cmVlIGZyb20gcm9vdCBub2RlXHJcbiAgICByZW5kZXJOb2RlKHRyZWUsIHNpZGViYXIsIDAsIG51bGwsIHRydWUpO1xyXG59XHJcbiIsICIvLyBUaGUgbGVnZW5kOiBkZXJpdmVkIGZyb20gdGhlIHNhbWUgbGF5ZXIgc3RhdGUgZXZlcnl0aGluZyBlbHNlIHJlbmRlcnMgZnJvbSwgd2l0aFxuLy8gZGVjbGFyYXRpdmUgb3ZlcnJpZGVzIG9uIHRvcC4gRGVsaWJlcmF0ZWx5IG1vZGVsLWZyZWUgLS0gcHVyZSBkYXRhIGluLCBET00gb3V0IC0tXG4vLyBzbyBhIHBsYWluLUpTIGNvbnN1bWVyIG9mIGRpc3QvaW5kZXguanMgZ2V0cyB0aGUgd2hvbGUgZmVhdHVyZSwgYW5kIHRoZSBhbnl3aWRnZXRcbi8vIGdsdWUgaW4gbWFwLmpzIGlzIGEgZmV3IGxpbmVzLiAoc2lkZWJhci5qcyBzdGlsbCB0YWtlcyBgbW9kZWxgIGFuZCBpcyBmaWxlZCBmb3Jcbi8vIGV4dHJhY3Rpb247IHRoaXMgbW9kdWxlIG11c3QgbmV2ZXIgbmVlZCB0aGF0IHVucGlja2luZy4pXG4vL1xuLy8gVGhlIHBpcGVsaW5lOiBkZXJpdmVMZWdlbmRTcGVjKGxheWVycywgZ3JvdXBDb25maWdzLCBjb25maWcpIHdhbGtzIHRoZSBsYXllcnMgaW50b1xuLy8gZW50cmllcyAoc2tpcHBlZCBlbnRpcmVseSB3aGVuIGNvbmZpZy5hdXRvID09PSBmYWxzZSksIGFwcGxpZXMgdGhlIHBlcnNpc3RlbnRcbi8vIHJlbW92ZS1tYXRjaGVycywgYXBwZW5kcyB0aGUgbWFudWFsIGFkZHMsIGFuZCByZXR1cm5zIGEgc3BlYyB0aGF0IHJlbmRlckxlZ2VuZFxuLy8gdHVybnMgaW50byBET00uIE5vdGhpbmcgaGVyZSBrbm93cyBhYm91dCBjb2xvcm1hcHM6IHJhbXAvY2F0ZWdvcnkvYmluIGVudHJpZXNcbi8vIGFycml2ZSB3aXRoIHRoZWlyIGNvbG91cnMgYWxyZWFkeSByZXNvbHZlZCAoUHl0aG9uIHJlc29sdmVzIGF0IHRoZSBhZGRfKiBib3VuZGFyeSxcbi8vIG1hbnVhbCBlbnRyaWVzIGF0IGxlZ2VuZF9hZGQpLCBzbyB0aGVyZSBpcyBubyBhbmNob3IgdGFibGUgdG8gZHJpZnQuXG5cbmltcG9ydCB7IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlIH0gZnJvbSBcIi4vbWFwLmpzXCI7XG5cbmNvbnN0IEdMWVBIUyA9IHtcbiAgICBjaXJjbGVfbWFya2VyczogXCJjaXJjbGVcIixcbiAgICBtYXJrZXJzOiBcInBpblwiLFxuICAgIHBvbHlsaW5lOiBcImxpbmVcIixcbiAgICBwb2x5Z29uOiBcInBvbHlnb25cIixcbiAgICBjaXJjbGU6IFwiY2lyY2xlXCIsXG59O1xuXG5mdW5jdGlvbiBzd2F0Y2hFbnRyeShsYXllciwgaGlkZGVuKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogXCJzd2F0Y2hcIixcbiAgICAgICAgbGFiZWw6IGxheWVyLm5hbWUgfHwgXCJMYXllclwiLFxuICAgICAgICBzaGFwZTogR0xZUEhTW2xheWVyLnR5cGVdIHx8IFwic3F1YXJlXCIsXG4gICAgICAgIGNvbG9yOiBsYXllci5jb2xvciB8fCBcIiMzMzg4ZmZcIixcbiAgICAgICAgZmlsbENvbG9yOiBsYXllci5maWxsQ29sb3IgfHwgbGF5ZXIuZmlsbF9jb2xvciB8fCBsYXllci5jb2xvciB8fCBcIiMzMzg4ZmZcIixcbiAgICAgICAgaGlkZGVuLFxuICAgIH07XG59XG5cbi8vIEEgZGF0YS1kcml2ZW4gYmxvY2sgcmVjb3JkZWQgYXQgYWRkIHRpbWUgKHtraW5kLCBhbmNob3JzfGl0ZW1zfGVkZ2VzK2NvbG9ycywgLi4ufSlcbi8vIGJlY29tZXMgdGhlIGxheWVyJ3MgZW50cnkgYXMtaXM7IHRoZSBsYXllciBvbmx5IGNvbnRyaWJ1dGVzIGxhYmVsIGFuZCB2aXNpYmlsaXR5LlxuZnVuY3Rpb24gYmxvY2tFbnRyeShsYXllciwgaGlkZGVuKSB7XG4gICAgcmV0dXJuIHsgLi4ubGF5ZXIubGVnZW5kLCBsYWJlbDogbGF5ZXIubmFtZSB8fCBcIkxheWVyXCIsIGhpZGRlbiB9O1xufVxuXG5mdW5jdGlvbiBlbnRyaWVzRm9yTGF5ZXIobGF5ZXIsIGdyb3VwQ29uZmlncykge1xuICAgIGlmIChsYXllci50eXBlID09PSBcImJhc2VtYXBcIikgcmV0dXJuIFtdO1xuICAgIGNvbnN0IGhpZGRlbiA9ICFpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XG4gICAgICAgIC8vIEEgY29sbGVjdGlvbjogb25lIGVudHJ5IHBlciBnZW9tZXRyeSBwYXJ0LCBzYW1lIGxhYmVsIGJ5IGRlc2lnbiAtLSB0aGVcbiAgICAgICAgLy8gZ2x5cGhzIGFyZSB3aGF0IHRlbGwgdGhlbSBhcGFydCwgbWF0Y2hpbmcgaG93IHRoZSBwYXJ0cyByZW5kZXIuXG4gICAgICAgIHJldHVybiAobGF5ZXIubGF5ZXJzIHx8IFtdKVxuICAgICAgICAgICAgLmZpbHRlcihzdWIgPT4gR0xZUEhTW3N1Yi50eXBlXSlcbiAgICAgICAgICAgIC5tYXAoc3ViID0+IHN1Yi5sZWdlbmRcbiAgICAgICAgICAgICAgICA/IGJsb2NrRW50cnkoeyAuLi5zdWIsIG5hbWU6IGxheWVyLm5hbWUgfSwgaGlkZGVuKVxuICAgICAgICAgICAgICAgIDogc3dhdGNoRW50cnkoeyAuLi5zdWIsIG5hbWU6IGxheWVyLm5hbWUgfSwgaGlkZGVuKSk7XG4gICAgfVxuICAgIGlmICghR0xZUEhTW2xheWVyLnR5cGVdKSByZXR1cm4gW107XG4gICAgcmV0dXJuIFtsYXllci5sZWdlbmQgPyBibG9ja0VudHJ5KGxheWVyLCBoaWRkZW4pIDogc3dhdGNoRW50cnkobGF5ZXIsIGhpZGRlbildO1xufVxuXG4vLyBJZGVudGljYWwgZGF0YS1kcml2ZW4gcGF5bG9hZHMgY29sbGFwc2UgaW50byBvbmUgcm93LiBHcm91cGluZyBwb2ludHMgYnkgYSBjb2x1bW5cbi8vIGdpdmVzIGV2ZXJ5IHN1Yi1sYXllciB0aGUgc2FtZSByYW1wOyBhIHJhbXAgcGVyIHN1Yi1sYXllciBpcyBub2lzZSwgYW5kIHRoZSBmaWVsZFxuLy8gbmFtZSBpcyB0aGUgaG9uZXN0IGxhYmVsIGZvciB0aGUgc2hhcmVkIG1hcHBpbmcuIFRoZSBzdXJ2aXZvciBrZWVwcyB0aGUgZmlyc3Rcbi8vIG9jY3VycmVuY2UncyBwb3NpdGlvbiBhbmQgaGlkZXMgb25seSB3aGVuIGV2ZXJ5IGNvbnRyaWJ1dG9yIGlzIGhpZGRlbi5cbmZ1bmN0aW9uIHBheWxvYWRLZXkoZW50cnkpIHtcbiAgICAvLyBJZGVudGl0eSBmaWVsZHMgc3RheSBvdXQgb2YgdGhlIGtleTogdGhlIHdob2xlIHBvaW50IGlzIHRoYXQgZW50cmllcyBmcm9tXG4gICAgLy8gRElGRkVSRU5UIGxheWVycyBjb2xsYXBzZSB3aGVuIHRoZWlyIG1hcHBpbmcgcGF5bG9hZCBpcyB0aGUgc2FtZS5cbiAgICBjb25zdCB7IGxhYmVsLCBoaWRkZW4sIGxheWVySWQsIGxheWVyLCBncm91cCwgLi4ucGF5bG9hZCB9ID0gZW50cnk7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpO1xufVxuXG5mdW5jdGlvbiBkZWR1cGVEYXRhRW50cmllcyhncm91cHMpIHtcbiAgICBjb25zdCBzZWVuID0gbmV3IE1hcCgpOyAgIC8vIHBheWxvYWQga2V5IC0+IHN1cnZpdmluZyBlbnRyeVxuICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgIGdyb3VwLmVudHJpZXMgPSBncm91cC5lbnRyaWVzLmZpbHRlcihlbnRyeSA9PiB7XG4gICAgICAgICAgICBpZiAoZW50cnkua2luZCA9PT0gXCJzd2F0Y2hcIikgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjb25zdCBrZXkgPSBwYXlsb2FkS2V5KGVudHJ5KTtcbiAgICAgICAgICAgIGNvbnN0IHN1cnZpdm9yID0gc2Vlbi5nZXQoa2V5KTtcbiAgICAgICAgICAgIGlmICghc3Vydml2b3IpIHtcbiAgICAgICAgICAgICAgICBzZWVuLnNldChrZXksIGVudHJ5KTtcbiAgICAgICAgICAgICAgICBpZiAoZW50cnkuZmllbGQpIGVudHJ5LmxhYmVsID0gZW50cnkuZmllbGQ7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdXJ2aXZvci5oaWRkZW4gPSBzdXJ2aXZvci5oaWRkZW4gJiYgZW50cnkuaGlkZGVuO1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIGdyb3Vwcztcbn1cblxuZnVuY3Rpb24gbWF0Y2hlckhpdHMobWF0Y2hlciwgZW50cnksIGdyb3VwTmFtZSkge1xuICAgIGlmICghbWF0Y2hlcikgcmV0dXJuIGZhbHNlO1xuICAgIGxldCBjb25zdHJhaW5lZCA9IGZhbHNlO1xuICAgIGlmIChtYXRjaGVyLmxhYmVsICE9IG51bGwpIHtcbiAgICAgICAgY29uc3RyYWluZWQgPSB0cnVlO1xuICAgICAgICBpZiAoZW50cnkubGFiZWwgIT09IG1hdGNoZXIubGFiZWwpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKG1hdGNoZXIuZ3JvdXAgIT0gbnVsbCkge1xuICAgICAgICBjb25zdHJhaW5lZCA9IHRydWU7XG4gICAgICAgIGlmIChncm91cE5hbWUgIT09IG1hdGNoZXIuZ3JvdXApIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKG1hdGNoZXIuaWQgIT0gbnVsbCkge1xuICAgICAgICBjb25zdHJhaW5lZCA9IHRydWU7XG4gICAgICAgIGlmIChlbnRyeS5sYXllcklkICE9PSBtYXRjaGVyLmlkKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiBjb25zdHJhaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZUxlZ2VuZFNwZWMobGF5ZXJzLCBncm91cENvbmZpZ3MsIGNvbmZpZykge1xuICAgIGNvbnN0IGNmZyA9IGNvbmZpZyB8fCB7fTtcbiAgICBjb25zdCBncm91cHMgPSBbXTtcbiAgICBjb25zdCBieU5hbWUgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgZ3JvdXBGb3IgPSBuYW1lID0+IHtcbiAgICAgICAgaWYgKCFieU5hbWUuaGFzKG5hbWUpKSB7XG4gICAgICAgICAgICBjb25zdCBncm91cCA9IHsgbmFtZSwgZW50cmllczogW10gfTtcbiAgICAgICAgICAgIGJ5TmFtZS5zZXQobmFtZSwgZ3JvdXApO1xuICAgICAgICAgICAgZ3JvdXBzLnB1c2goZ3JvdXApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBieU5hbWUuZ2V0KG5hbWUpO1xuICAgIH07XG5cbiAgICBpZiAoY2ZnLmF1dG8gIT09IGZhbHNlKSB7XG4gICAgICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzIHx8IFtdKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXNGb3JMYXllcihsYXllciwgZ3JvdXBDb25maWdzIHx8IHt9KSkge1xuICAgICAgICAgICAgICAgIGVudHJ5LmxheWVySWQgPSBsYXllci5pZDtcbiAgICAgICAgICAgICAgICBpZiAoY2ZnLnNjb3BlID09PSBcInZpc2libGVcIiAmJiBlbnRyeS5oaWRkZW4pIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGdyb3VwRm9yKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLmVudHJpZXMucHVzaChlbnRyeSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZGVkdXBlRGF0YUVudHJpZXMoZ3JvdXBzKTtcbiAgICB9XG5cbiAgICAvLyBQZXJzaXN0ZW50IHN1cHByZXNzaW9uOiBtYXRjaGVycyBvdXRsaXZlIGV2ZXJ5IHJlLWRlcml2YXRpb24sIHdoaWNoIGlzIHRoZVxuICAgIC8vIGRpZmZlcmVuY2UgZnJvbSBhIHJlZ2lzdHJ5IHJlbW92ZSB0aGF0IHRoZSBuZXh0IGFkZCB3b3VsZCBqdXN0IHJlcG9wdWxhdGUuXG4gICAgY29uc3QgcmVtb3ZlcyA9IGNmZy5yZW1vdmUgfHwgW107XG4gICAgaWYgKHJlbW92ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgZ3JvdXAuZW50cmllcyA9IGdyb3VwLmVudHJpZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIGVudHJ5ID0+ICFyZW1vdmVzLnNvbWUobSA9PiBtYXRjaGVySGl0cyhtLCBlbnRyeSwgZ3JvdXAubmFtZSkpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIE1hbnVhbCBlbnRyaWVzOiB0aGUgdXNlcidzIG93biBjbGFpbXMuIHNjb3BlIG5ldmVyIGRyb3BzIHRoZW07IGEgYGxheWVyYFxuICAgIC8vIGJpbmRpbmcgbWFrZXMgb25lIGZvbGxvdyBhIGxpdmUgbGF5ZXIncyB2aXNpYmlsaXR5IChhbmQgdmFuaXNoIHdpdGggaXQgdW5kZXJcbiAgICAvLyBzY29wZSBcInZpc2libGVcIiksIGZvciB3aGVuIGEgbWFudWFsIHJvdyBpcyByZWFsbHkgYSByZWxhYmVsbGluZy5cbiAgICBmb3IgKGNvbnN0IGFkZGVkIG9mIGNmZy5hZGQgfHwgW10pIHtcbiAgICAgICAgY29uc3QgZW50cnkgPSB7IGhpZGRlbjogZmFsc2UsIC4uLmFkZGVkIH07XG4gICAgICAgIGlmIChlbnRyeS5sYXllciAhPSBudWxsKSB7XG4gICAgICAgICAgICBjb25zdCBib3VuZCA9IChsYXllcnMgfHwgW10pLmZpbmQoXG4gICAgICAgICAgICAgICAgbCA9PiBsLmlkID09PSBlbnRyeS5sYXllciB8fCBsLm5hbWUgPT09IGVudHJ5LmxheWVyKTtcbiAgICAgICAgICAgIGVudHJ5LmhpZGRlbiA9ICFib3VuZCB8fCAhaXNMYXllckVmZmVjdGl2ZVZpc2libGUoYm91bmQsIGdyb3VwQ29uZmlncyB8fCB7fSk7XG4gICAgICAgICAgICBpZiAoY2ZnLnNjb3BlID09PSBcInZpc2libGVcIiAmJiBlbnRyeS5oaWRkZW4pIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZW1vdmVzLnNvbWUobSA9PiBtYXRjaGVySGl0cyhtLCBlbnRyeSwgZW50cnkuZ3JvdXAgfHwgXCJcIikpKSBjb250aW51ZTtcbiAgICAgICAgZ3JvdXBGb3IoZW50cnkuZ3JvdXAgfHwgXCJcIikuZW50cmllcy5wdXNoKGVudHJ5KTtcbiAgICB9XG5cbiAgICBjb25zdCBwb3B1bGF0ZWQgPSBncm91cHMuZmlsdGVyKGcgPT4gZy5lbnRyaWVzLmxlbmd0aCA+IDApO1xuICAgIHJldHVybiB7IHRpdGxlOiBjZmcudGl0bGUgfHwgXCJMZWdlbmRcIiwgZ3JvdXBzOiBwb3B1bGF0ZWQgfTtcbn1cblxuLy8gLS0tIHJlbmRlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERPTSBidWlsdCB3aXRoIGNyZWF0ZUVsZW1lbnQvdGV4dENvbnRlbnQgdGhyb3VnaG91dDogbGFiZWxzIGFuZCBjYXRlZ29yeSB2YWx1ZXMgY29tZVxuLy8gZnJvbSB1c2VyIGRhdGEgYW5kIG11c3QgbmV2ZXIgYmUgcGFyc2VkIGFzIEhUTUwuXG5cbmZ1bmN0aW9uIGRpdihzdHlsZXMsIHRleHQpIHtcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGVzKTtcbiAgICBpZiAodGV4dCAhPSBudWxsKSBlbC50ZXh0Q29udGVudCA9IHRleHQ7XG4gICAgcmV0dXJuIGVsO1xufVxuXG5mdW5jdGlvbiBnbHlwaChlbnRyeSkge1xuICAgIGlmIChlbnRyeS5zaGFwZSA9PT0gXCJsaW5lXCIpIHtcbiAgICAgICAgcmV0dXJuIGRpdih7IHdpZHRoOiBcIjIwcHhcIiwgaGVpZ2h0OiBcIjRweFwiLCBiYWNrZ3JvdW5kOiBlbnRyeS5jb2xvcixcbiAgICAgICAgICAgICAgICAgICAgIG1hcmdpblJpZ2h0OiBcIjZweFwiLCBmbGV4OiBcIm5vbmVcIiB9KTtcbiAgICB9XG4gICAgaWYgKGVudHJ5LnNoYXBlID09PSBcInBpblwiKSB7XG4gICAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgIGVsLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI2cHhcIjtcbiAgICAgICAgZWwuc3R5bGUuZmxleCA9IFwibm9uZVwiO1xuICAgICAgICBjb25zdCBzdmcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcInN2Z1wiKTtcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZShcIndpZHRoXCIsIFwiMTJcIik7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoXCJoZWlnaHRcIiwgXCIxNFwiKTtcbiAgICAgICAgc3ZnLnNldEF0dHJpYnV0ZShcInZpZXdCb3hcIiwgXCIwIDAgMjQgMjhcIik7XG4gICAgICAgIGNvbnN0IHBhdGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcInBhdGhcIik7XG4gICAgICAgIHBhdGguc2V0QXR0cmlidXRlKFwiZFwiLFxuICAgICAgICAgICAgXCJNMTIgMEM1LjQgMCAwIDUuNCAwIDEyYzAgOSAxMiAxNiAxMiAxNnMxMi03IDEyLTE2QzI0IDUuNCAxOC42IDAgMTIgMHpcIik7XG4gICAgICAgIHBhdGguc2V0QXR0cmlidXRlKFwiZmlsbFwiLCBlbnRyeS5jb2xvcik7XG4gICAgICAgIHN2Zy5hcHBlbmRDaGlsZChwYXRoKTtcbiAgICAgICAgZWwuYXBwZW5kQ2hpbGQoc3ZnKTtcbiAgICAgICAgcmV0dXJuIGVsO1xuICAgIH1cbiAgICAvLyBjaXJjbGUgLyBwb2x5Z29uIC8gc3F1YXJlOiBmaWxsIGluc2lkZSBhIGJvcmRlciwgd2hpY2ggaXMgaG93IGFyZWFzIGRyYXcuXG4gICAgY29uc3QgcmFkaXVzID0gZW50cnkuc2hhcGUgPT09IFwiY2lyY2xlXCIgPyBcIjUwJVwiXG4gICAgICAgIDogZW50cnkuc2hhcGUgPT09IFwicG9seWdvblwiID8gXCIycHhcIiA6IFwiMFwiO1xuICAgIHJldHVybiBkaXYoeyB3aWR0aDogXCIxMnB4XCIsIGhlaWdodDogXCIxMnB4XCIsIGJhY2tncm91bmQ6IGVudHJ5LmZpbGxDb2xvcixcbiAgICAgICAgICAgICAgICAgYm9yZGVyOiBgMnB4IHNvbGlkICR7ZW50cnkuY29sb3J9YCwgYm9yZGVyUmFkaXVzOiByYWRpdXMsXG4gICAgICAgICAgICAgICAgIG1hcmdpblJpZ2h0OiBcIjZweFwiLCBmbGV4OiBcIm5vbmVcIiwgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIiB9KTtcbn1cblxuZnVuY3Rpb24gcmFtcFJvdyhlbnRyeSkge1xuICAgIGNvbnN0IHJvdyA9IGRpdih7IG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIGNvbnN0IHN0b3BzID0gKGVudHJ5LmFuY2hvcnMgfHwgW10pLm1hcCgoY29sb3IsIGksIGFsbCkgPT5cbiAgICAgICAgYCR7Y29sb3J9ICR7YWxsLmxlbmd0aCA+IDEgPyAoaSAvIChhbGwubGVuZ3RoIC0gMSkpICogMTAwIDogMH0lYCk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7XG4gICAgICAgIHdpZHRoOiBcIjEyMHB4XCIsIGhlaWdodDogXCIxMnB4XCIsIGJvcmRlclJhZGl1czogXCIycHhcIixcbiAgICAgICAgYmFja2dyb3VuZEltYWdlOiBgbGluZWFyLWdyYWRpZW50KHRvIHJpZ2h0LCAke3N0b3BzLmpvaW4oXCIsIFwiKX0pYCxcbiAgICB9KSk7XG4gICAgY29uc3QgZW5kcyA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBqdXN0aWZ5Q29udGVudDogXCJzcGFjZS1iZXR3ZWVuXCIsIHdpZHRoOiBcIjEyMHB4XCIsXG4gICAgICAgICAgICAgICAgICAgICAgIGZvbnRTaXplOiBcIjExcHhcIiwgY29sb3I6IFwiIzU1NVwiIH0pO1xuICAgIGVuZHMuYXBwZW5kQ2hpbGQoZGl2KHt9LCBTdHJpbmcoZW50cnkudm1pbikpKTtcbiAgICBlbmRzLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGVudHJ5LnZtYXgpKSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGVuZHMpO1xuICAgIHJldHVybiByb3c7XG59XG5cbmNvbnN0IE1BWF9DQVRFR09SWV9ST1dTID0gMTI7XG5cbmZ1bmN0aW9uIGNhdGVnb3JpZXNSb3coZW50cnkpIHtcbiAgICBjb25zdCByb3cgPSBkaXYoeyBtYXJnaW5Ub3A6IFwiNXB4XCIgfSk7XG4gICAgcm93LmFwcGVuZENoaWxkKGRpdih7fSwgZW50cnkubGFiZWwpKTtcbiAgICBjb25zdCBpdGVtcyA9IGVudHJ5Lml0ZW1zIHx8IFtdO1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcy5zbGljZSgwLCBNQVhfQ0FURUdPUllfUk9XUykpIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGRpdih7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBtYXJnaW5Ub3A6IFwiM3B4XCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJnaW5MZWZ0OiBcIjhweFwiIH0pO1xuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGdseXBoKHsgc2hhcGU6IFwic3F1YXJlXCIsIGNvbG9yOiBpdGVtLmNvbG9yLCBmaWxsQ29sb3I6IGl0ZW0uY29sb3IgfSkpO1xuICAgICAgICBsaW5lLmFwcGVuZENoaWxkKGRpdih7fSwgU3RyaW5nKGl0ZW0udmFsdWUpKSk7XG4gICAgICAgIHJvdy5hcHBlbmRDaGlsZChsaW5lKTtcbiAgICB9XG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA+IE1BWF9DQVRFR09SWV9ST1dTKSB7XG4gICAgICAgIHJvdy5hcHBlbmRDaGlsZChkaXYoeyBtYXJnaW5MZWZ0OiBcIjhweFwiLCBtYXJnaW5Ub3A6IFwiM3B4XCIsIGNvbG9yOiBcIiM1NTVcIiB9LFxuICAgICAgICAgICAgYCsgJHtpdGVtcy5sZW5ndGggLSBNQVhfQ0FURUdPUllfUk9XU30gbW9yZWApKTtcbiAgICB9XG4gICAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gYmluc1JvdyhlbnRyeSkge1xuICAgIGNvbnN0IHJvdyA9IGRpdih7IG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIGNvbnN0IGVkZ2VzID0gZW50cnkuZWRnZXMgfHwgW107XG4gICAgY29uc3QgY29sb3JzID0gZW50cnkuY29sb3JzIHx8IFtdO1xuICAgIGNvbnN0IGxhYmVsRm9yID0gaSA9PiBpID09PSAwID8gYDwgJHtlZGdlc1swXX1gXG4gICAgICAgIDogaSA9PT0gZWRnZXMubGVuZ3RoID8gYFx1MjI2NSAke2VkZ2VzW2VkZ2VzLmxlbmd0aCAtIDFdfWBcbiAgICAgICAgOiBgJHtlZGdlc1tpIC0gMV19IFx1MjAxMyAke2VkZ2VzW2ldfWA7XG4gICAgY29sb3JzLmZvckVhY2goKGNvbG9yLCBpKSA9PiB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBkaXYoeyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgbWFyZ2luVG9wOiBcIjNweFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFyZ2luTGVmdDogXCI4cHhcIiB9KTtcbiAgICAgICAgbGluZS5hcHBlbmRDaGlsZChnbHlwaCh7IHNoYXBlOiBcInNxdWFyZVwiLCBjb2xvciwgZmlsbENvbG9yOiBjb2xvciB9KSk7XG4gICAgICAgIGxpbmUuYXBwZW5kQ2hpbGQoZGl2KHt9LCBsYWJlbEZvcihpKSkpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQobGluZSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gc3dhdGNoUm93KGVudHJ5KSB7XG4gICAgY29uc3Qgcm93ID0gZGl2KHsgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIG1hcmdpblRvcDogXCI1cHhcIiB9KTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZ2x5cGgoZW50cnkpKTtcbiAgICByb3cuYXBwZW5kQ2hpbGQoZGl2KHt9LCBlbnRyeS5sYWJlbCkpO1xuICAgIHJldHVybiByb3c7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJMZWdlbmQoY29udGFpbmVyLCBzcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBjb250YWluZXIuaW5uZXJIVE1MID0gXCJcIjtcbiAgICBjb25zdCBkaW1IaWRkZW4gPSBvcHRpb25zLmRpbUhpZGRlbiAhPT0gZmFsc2U7XG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7XG4gICAgICAgIGZvbnRTaXplOiBcIjEzcHhcIiwgZm9udFdlaWdodDogXCJib2xkXCIsIGJvcmRlckJvdHRvbTogXCIycHggc29saWQgI2VlZVwiLFxuICAgICAgICBwYWRkaW5nQm90dG9tOiBcIjRweFwiLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIsXG4gICAgfSwgc3BlYy50aXRsZSkpO1xuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBzcGVjLmdyb3Vwcykge1xuICAgICAgICBpZiAoZ3JvdXAubmFtZSkge1xuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGRpdih7IGZvbnRXZWlnaHQ6IFwiYm9sZFwiLCBtYXJnaW5Ub3A6IFwiNnB4XCIgfSwgZ3JvdXAubmFtZSkpO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZ3JvdXAuZW50cmllcykge1xuICAgICAgICAgICAgY29uc3Qgcm93ID0gZW50cnkua2luZCA9PT0gXCJyYW1wXCIgPyByYW1wUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJjYXRlZ29yaWVzXCIgPyBjYXRlZ29yaWVzUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogZW50cnkua2luZCA9PT0gXCJiaW5zXCIgPyBiaW5zUm93KGVudHJ5KVxuICAgICAgICAgICAgICAgIDogc3dhdGNoUm93KGVudHJ5KTtcbiAgICAgICAgICAgIC8vIERpbW1lZCwgbm90IGRyb3BwZWQ6IHVuZGVyIHNjb3BlIFwiYWxsXCIgdGhlIGxlZ2VuZCBpcyB0aGUgbWFwJ3Mgd2hvbGVcbiAgICAgICAgICAgIC8vIHZvY2FidWxhcnksIGFuZCB0aGUgZGltIGlzIHdoYXQgc3RpbGwgdGVsbHMgdGhlIGN1cnJlbnQgc2NyZWVuIHN0YXRlLlxuICAgICAgICAgICAgaWYgKGVudHJ5LmhpZGRlbiAmJiBkaW1IaWRkZW4pIHJvdy5zdHlsZS5vcGFjaXR5ID0gXCIwLjVcIjtcbiAgICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChyb3cpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjb250YWluZXI7XG59XG4iLCAiZXhwb3J0IGNvbnN0IHBpblNoYWRlciA9IGBcclxucHJlY2lzaW9uIG1lZGl1bXAgZmxvYXQ7XHJcbnZhcnlpbmcgdmVjNCBfY29sb3I7XHJcbnZvaWQgbWFpbigpIHtcclxuICAgIC8vIHV2IHJhbmdlcyBmcm9tIC0wLjUgdG8gMC41LiBUaGUgY2VudGVyICgwLjAsIDAuMCkgaXMgdGhlIGV4YWN0IGNvb3JkaW5hdGUuXHJcbiAgICB2ZWMyIHV2ID0gZ2xfUG9pbnRDb29yZC54eSAtIHZlYzIoMC41KTtcclxuXHJcbiAgICAvLyBQaW4gaGVhZCBjaXJjbGUgY2VudGVyZWQgYXQgKDAuMCwgLTAuMzApIHdpdGggcmFkaXVzIDAuMTZcclxuICAgIGZsb2F0IGRfY2lyY2xlID0gbGVuZ3RoKHV2IC0gdmVjMigwLjAsIC0wLjMwKSkgLSAwLjE2O1xyXG4gICAgXHJcbiAgICAvLyBQaW4gYm9keSB0cmlhbmdsZSBwb2ludGluZyBleGFjdGx5IHRvICgwLjAsIDAuMClcclxuICAgIGZsb2F0IGRfdHJpYW5nbGUgPSBtYXgoYWJzKHV2LngpICogMS44NzUgKyB1di55LCAtdXYueSAtIDAuMzApO1xyXG4gICAgZmxvYXQgZF9waW4gPSBtaW4oZF9jaXJjbGUsIGRfdHJpYW5nbGUpO1xyXG5cclxuICAgIC8vIElubmVyIGhvbGUgY2VudGVyZWQgYXQgKDAuMCwgLTAuMzApIHdpdGggcmFkaXVzIDAuMDZcclxuICAgIGZsb2F0IGRfaG9sZSA9IGxlbmd0aCh1diAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4wNjtcclxuXHJcbiAgICAvLyBEcm9wIHNoYWRvdyBzaGlmdGVkIHNsaWdodGx5IGRvd24gYW5kIGJsdXJyZWRcclxuICAgIHZlYzIgc2hhZG93VXYgPSB1diAtIHZlYzIoMC4wLCAwLjA0KTtcclxuICAgIGZsb2F0IGRfc2hhZG93X2NpcmNsZSA9IGxlbmd0aChzaGFkb3dVdiAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4xNjtcclxuICAgIGZsb2F0IGRfc2hhZG93X3RyaWFuZ2xlID0gbWF4KGFicyhzaGFkb3dVdi54KSAqIDEuODc1ICsgc2hhZG93VXYueSwgLXNoYWRvd1V2LnkgLSAwLjMwKTtcclxuICAgIGZsb2F0IGRfc2hhZG93ID0gbWluKGRfc2hhZG93X2NpcmNsZSwgZF9zaGFkb3dfdHJpYW5nbGUpO1xyXG5cclxuICAgIC8vIEFudGktYWxpYXNlZCBtYXNrc1xyXG4gICAgZmxvYXQgbWFza19waW4gPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluKTtcclxuICAgIGZsb2F0IG1hc2tfaG9sZSA9IDEuMCAtIHNtb290aHN0ZXAoLTAuMDEyLCAwLjAxMiwgZF9ob2xlKTtcclxuICAgIGZsb2F0IG1hc2tfYm9yZGVyID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMTIsIDAuMDEyLCBkX3BpbiArIDAuMDI1KTtcclxuICAgIGZsb2F0IG1hc2tfc2hhZG93ID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMywgMC4wNCwgZF9zaGFkb3cpO1xyXG5cclxuICAgIC8vIENvbXBvc2l0ZSBsYXllcnNcclxuICAgIHZlYzQgc2hhZG93Q29sb3IgPSB2ZWM0KDAuMCwgMC4wLCAwLjAsIDAuMjUpICogbWFza19zaGFkb3c7XHJcbiAgICB2ZWM0IGJvZHlDb2xvciA9IG1peCh2ZWM0KDAuMCwgMC4wLCAwLjAsIDAuODUpLCB2ZWM0KF9jb2xvci5yZ2IsIF9jb2xvci5hKSwgbWFza19ib3JkZXIpO1xyXG4gICAgdmVjNCB3aXRoSG9sZSA9IG1peChib2R5Q29sb3IsIHZlYzQoMS4wLCAxLjAsIDEuMCwgMS4wKSwgbWFza19ob2xlKTtcclxuXHJcbiAgICBnbF9GcmFnQ29sb3IgPSBtaXgoc2hhZG93Q29sb3IsIHdpdGhIb2xlLCBtYXNrX3Bpbik7XHJcbn1gO1xyXG4iLCAiLy8gVGhlIHNoYXJlZCB0aW1lIHNsaWRlcjogb25lIGNvbnRyb2wgc2VydmluZyBldmVyeSB0aW1lIGxheWVyIG9uIHRoZSBtYXAuXG4vL1xuLy8gVGlja3MgYXJlIGdlbmVyYXRlZCBmcm9tIGFuIElTTzg2MDEgcGVyaW9kIHJhdGhlciB0aGFuIHRha2VuIGZyb20gdGhlIG9ic2VydmVkXG4vLyB0aW1lc3RhbXBzLCBkZWxpYmVyYXRlbHk6IGEgcGVyaW9kIGluIHdoaWNoIG5vdGhpbmcgaGFwcGVuZWQgc3RpbGwgZ2V0cyBpdHMgdGljaywgc28gYW5cbi8vIGVtcHR5IG1hcCBhdCAwMzowMCByZWFkcyBhcyBhYnNlbmNlIHJhdGhlciB0aGFuIHRoZSBzbGlkZXIgc2tpcHBpbmcgdGhlIHF1aWV0IGhvdXJzLlxuLy9cbi8vIFRoaXMgaXMgc3dpZnRtYXAncyBvd24gY29udHJvbCByYXRoZXIgdGhhbiBMZWFmbGV0LlRpbWVEaW1lbnNpb24ncy4gVGhhdCBsaWJyYXJ5IHNwbGl0c1xuLy8gaW50byBhIHRpbWUgbW9kZWwsIGEgY29udHJvbCwgYW5kIHBlci1sYXllciBhZGFwdGVycyB0aGF0IHJlLXJlbmRlciBHZW9KU09OIHBlciB0aWNrIC0tXG4vLyB0aGUgYWRhcHRlcnMgYXJlIHVudXNhYmxlIGFnYWluc3QgV2ViR0wgbGF5ZXJzLCB0aGUgbW9kZWwgaXMgYSBmZXcgZG96ZW4gbGluZXMsIGFuZCB0aGVcbi8vIGNvbnRyb2wgYWxvbmUgd2FzIG5vdCB3b3J0aCBhIHZlbmRvcmVkIGRlcGVuZGVuY3kgb24gYSBuZXR3b3JrIHdoZXJlIGV2ZXJ5IGZpbGUgaXNcbi8vIGNhcnJpZWQgYWNyb3NzIGJ5IGhhbmQuXG5cbi8vIC0tLSBJU084NjAxIHBlcmlvZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNaXJyb3JzIGlzX3ZhbGlkX3BlcmlvZCgpIGluIHN3aWZ0bWFwL2xheWVycy9fdGltZS5weTsgdGhlIGdyYW1tYXIgbXVzdCBub3QgZHJpZnQuXG5jb25zdCBQRVJJT0RfUkUgPVxuICAgIC9eUCg/ISQpKD86KFxcZCspWSk/KD86KFxcZCspTSk/KD86KFxcZCspVyk/KD86KFxcZCspRCk/KD86VCg/ISQpKD86KFxcZCspSCk/KD86KFxcZCspTSk/KD86KFxcZCsoPzpcXC5cXGQrKT8pUyk/KT8kLztcblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUGVyaW9kKHRleHQpIHtcbiAgICBjb25zdCBtID0gUEVSSU9EX1JFLmV4ZWModGV4dCB8fCBcIlwiKTtcbiAgICBpZiAoIW0pIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICAgIHllYXJzOiArKG1bMV0gfHwgMCksIG1vbnRoczogKyhtWzJdIHx8IDApLCB3ZWVrczogKyhtWzNdIHx8IDApLCBkYXlzOiArKG1bNF0gfHwgMCksXG4gICAgICAgIGhvdXJzOiArKG1bNV0gfHwgMCksIG1pbnV0ZXM6ICsobVs2XSB8fCAwKSwgc2Vjb25kczogKyhtWzddIHx8IDApLFxuICAgIH07XG59XG5cbi8vIFllYXJzIGFuZCBtb250aHMgbW92ZSB0aHJvdWdoIHRoZSBVVEMgY2FsZW5kYXIgLS0gUDFNIGZyb20gSmFuIDMxIGxhbmRzIHdoZXJlIERhdGVcbi8vIGFyaXRobWV0aWMgcHV0cyBpdCwgbm90IGEgZml4ZWQgMzAgZGF5cyAtLSB3aGlsZSB0aGUgcmVzdCBpcyBwbGFpbiBtaWxsaXNlY29uZHMuXG5leHBvcnQgZnVuY3Rpb24gYWRkUGVyaW9kKG1zLCBwLCBzaWduID0gMSkge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShtcyk7XG4gICAgaWYgKHAueWVhcnMpIGQuc2V0VVRDRnVsbFllYXIoZC5nZXRVVENGdWxsWWVhcigpICsgc2lnbiAqIHAueWVhcnMpO1xuICAgIGlmIChwLm1vbnRocykgZC5zZXRVVENNb250aChkLmdldFVUQ01vbnRoKCkgKyBzaWduICogcC5tb250aHMpO1xuICAgIHJldHVybiBkLmdldFRpbWUoKSArIHNpZ24gKiAoKChwLndlZWtzICogNyArIHAuZGF5cykgKiAyNCAqIDM2MDBcbiAgICAgICAgKyBwLmhvdXJzICogMzYwMCArIHAubWludXRlcyAqIDYwICsgcC5zZWNvbmRzKSAqIDEwMDApO1xufVxuXG4vLyBUaGUgc2xpZGVyJ3MgcG9zaXRpb25zOiBmcm9tIHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbiB0byB0aGUgZmlyc3QgdGljayBhdCBvciBwYXN0IHRoZVxuLy8gZmluYWwgb25lLCBvbmUgcGVyIHBlcmlvZC4gQ2FwcGVkIGJlY2F1c2UgYSBtaXN0eXBlZCBQVDFTIG92ZXIgYSB5ZWFyIG9mIGRhdGFcbi8vIHdvdWxkIG90aGVyd2lzZSBoYW5nIHRoZSB0YWIgYnVpbGRpbmcgYW4gYXJyYXkgb2YgbWlsbGlvbnMuXG5leHBvcnQgY29uc3QgTUFYX1RJQ0tTID0gNTAwMDtcblxuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlVGlja3Moc3RhcnRNcywgZW5kTXMsIHApIHtcbiAgICAvLyBUaGUgZmlyc3QgdGljayBzaXRzIEFUIHRoZSBlYXJsaWVzdCBvYnNlcnZhdGlvbiwgbm90IG9uZSBwZXJpb2QgYWZ0ZXIgaXQ6IHdpbmRvd3NcbiAgICAvLyBhcmUgaGFsZi1vcGVuIChzdGFydCwgZW5kXSwgc28gYSBmaXJzdCB0aWNrIGF0IHN0YXJ0K1Agd291bGQgZXhjbHVkZSB0aGUgZWFybGllc3RcbiAgICAvLyBwb2ludCBmcm9tIGl0cyBvd24gd2luZG93IGFuZCBpdCB3b3VsZCBuZXZlciBkaXNwbGF5IGF0IGFueSB0aWNrLlxuICAgIGNvbnN0IHRpY2tzID0gW3N0YXJ0TXNdO1xuICAgIGxldCB0ID0gc3RhcnRNcztcbiAgICBpZiAodCA+PSBlbmRNcykgcmV0dXJuIHRpY2tzO1xuICAgIHdoaWxlICh0aWNrcy5sZW5ndGggPCBNQVhfVElDS1MpIHtcbiAgICAgICAgdCA9IGFkZFBlcmlvZCh0LCBwKTtcbiAgICAgICAgdGlja3MucHVzaCh0KTtcbiAgICAgICAgaWYgKHQgPj0gZW5kTXMpIHJldHVybiB0aWNrcztcbiAgICB9XG4gICAgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIHRpbWUgc2xpZGVyIGNhcHBlZCBhdCAke01BWF9USUNLU30gdGlja3M7IGAgK1xuICAgICAgICBgdGhlIHBlcmlvZCBpcyB0b28gZmluZSBmb3IgdGhlIGRhdGEncyBleHRlbnQuIFVzZSBhIGNvYXJzZXIgcGVyaW9kLmApO1xuICAgIHJldHVybiB0aWNrcztcbn1cblxuLy8gLS0tIHdpbmRvd3MgYW5kIGZpbHRlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBUaGUgaW50ZXJ2YWwgc2hvd24gYXQgb25lIHRpY2suIGR1cmF0aW9uIFwicGVyaW9kXCIgaXMgdGhlIHRpY2sncyBvd24gcGVyaW9kLCBzbyBhYnNlbmNlXG4vLyBpcyB2aXNpYmxlOyBudWxsIGFjY3VtdWxhdGVzIGV2ZXJ5dGhpbmcgc28gZmFyOyBhbiBJU08gc3RyaW5nIHRyYWlscyBhIGZpeGVkIHdpbmRvdy5cbmV4cG9ydCBmdW5jdGlvbiB3aW5kb3dGb3IodGljaywgZHVyYXRpb25TcGVjLCBwZXJpb2QpIHtcbiAgICBpZiAoZHVyYXRpb25TcGVjID09PSBudWxsIHx8IGR1cmF0aW9uU3BlYyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIH1cbiAgICBjb25zdCBwID0gZHVyYXRpb25TcGVjID09PSBcInBlcmlvZFwiID8gcGVyaW9kIDogcGFyc2VQZXJpb2QoZHVyYXRpb25TcGVjKTtcbiAgICBpZiAoIXApIHJldHVybiB7IHN0YXJ0OiAtSW5maW5pdHksIGVuZDogdGljayB9O1xuICAgIHJldHVybiB7IHN0YXJ0OiBhZGRQZXJpb2QodGljaywgcCwgLTEpLCBlbmQ6IHRpY2sgfTtcbn1cblxuLy8gSGFsZi1vcGVuIChzdGFydCwgZW5kXTogYSBmZWF0dXJlIHN0YW1wZWQgZXhhY3RseSBvbiBhIHRpY2sgYm91bmRhcnkgYmVsb25ncyB0byB0aGVcbi8vIHBlcmlvZCB0aGF0IGVuZHMgdGhlcmUsIGFuZCBuZXZlciB0byB0d28gbmVpZ2hib3VyaW5nIHRpY2tzIGF0IG9uY2UuIE5hTiB0aW1lcyBtYXJrXG4vLyBmZWF0dXJlcyB0aGF0IGNhcnJpZWQgbm8gcmVhZGFibGUgdGltZTsgdGhleSBzdGF5IHZpc2libGUgcmF0aGVyIHRoYW4gdmFuaXNoaW5nLlxuZXhwb3J0IGZ1bmN0aW9uIGZlYXR1cmVJbldpbmRvdyhzdGFydE1zLCBlbmRNcywgd2luKSB7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydE1zKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGVuZE1zID4gd2luLnN0YXJ0ICYmIHN0YXJ0TXMgPD0gd2luLmVuZDtcbn1cblxuLy8gVGltZXMgdHJhdmVsIGFzIGEgRmxvYXQ2NEFycmF5IG9mIGludGVybGVhdmVkIFtzdGFydCwgZW5kXSBwYWlycyBpbiB0aGUgYnVmZmVyIG1hcCxcbi8vIHVuZGVyIFwiPGxheWVyIGlkPjo6dGltZXNcIiAtLSB0aGUgc2FtZSB0cmFuc3BvcnQgY29vcmRpbmF0ZXMgdXNlLlxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKSB7XG4gICAgY29uc3QgcmF3ID0gYnVmZmVycyAmJiBidWZmZXJzW2Ake2xheWVyLmlkfTo6dGltZXNgXTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xufVxuXG4vLyBXaGF0IHJlbmRlcmluZyB0aHJlYWRzIHRocm91Z2g6IHRoZSBjdXJyZW50IHRpY2sgcGx1cyB0aGUgc2hhcmVkIHBlcmlvZCwgb3IgbnVsbCB3aGVuXG4vLyBubyBzbGlkZXIgaXMgYWN0aXZlLiBFYWNoIGxheWVyIGRlcml2ZXMgaXRzIG93biB3aW5kb3cgZnJvbSB0aGVzZSwgc2luY2UgZHVyYXRpb24gaXNcbi8vIHBlciBsYXllciB3aGlsZSB0aGUgdGljayBpcyBzaGFyZWQuXG4vL1xuLy8gV2hldGhlciBhIHdob2xlIGxheWVyIHNob3dzIGF0IHRoZSBjdXJyZW50IHRpY2suIExpbmVzLCBwb2x5Z29ucyBhbmQgY2lyY2xlcyBhcmUgb25lXG4vLyBnZW9tZXRyeSBwZXIgbGF5ZXIsIHNvIHRoZXkgYXJlIGluIG9yIG91dCBhcyBhIHVuaXQ7IGEgbGF5ZXIgd2l0aCBubyB0aW1lIG1ldGFkYXRhIGlzXG4vLyBub3QgdGhlIHNsaWRlcidzIHRvIGhpZGUuXG4vLyBUaGUgZHVyYXRpb24gYSBsYXllciBzaG93cyByaWdodCBub3cuIEEgd2luZG93IGRyYWdnZWQgb3V0IG9uIHRoZSBiYXIgaXMgYSB1c2VyXG4vLyBnZXN0dXJlIGFuZCBvdXRyYW5rcyBldmVyeSBsYXllcidzIGNvbmZpZ3VyZWQgZHVyYXRpb24gd2hpbGUgaXQgaXMgYWN0aXZlIC0tIHdoZW4gdGhlXG4vLyB1c2VyIGdyYWJzIHRoZSBiYXIsIHRoZSBiYXIgdGVsbHMgdGhlIHRydXRoIGZvciBldmVyeXRoaW5nLiBTbmFwcGluZyB0aGUgaGFuZGxlIGJhY2tcbi8vIG9udG8gdGhlIHRodW1iIGNsZWFycyB0aGUgb3ZlcnJpZGUgYW5kIGxheWVycyByZXR1cm4gdG8gdGhlaXIgb3duIHNldHRpbmdzLlxuZXhwb3J0IGZ1bmN0aW9uIGVmZmVjdGl2ZUR1cmF0aW9uKGxheWVyLCB0aW1lU3RhdGUpIHtcbiAgICByZXR1cm4gdGltZVN0YXRlLndpbmRvdyB8fCAobGF5ZXIudGltZSAmJiBsYXllci50aW1lLmR1cmF0aW9uKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxheWVySW5XaW5kb3cobGF5ZXIsIGJ1ZmZlcnMsIHRpbWVTdGF0ZSkge1xuICAgIGlmICghbGF5ZXIudGltZSB8fCAhdGltZVN0YXRlKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB0aW1lcyA9IHRpbWVzRm9yKGxheWVyLCBidWZmZXJzKTtcbiAgICBpZiAoIXRpbWVzIHx8IHRpbWVzLmxlbmd0aCA8IDIpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHdpbiA9IHdpbmRvd0Zvcih0aW1lU3RhdGUudGljaywgZWZmZWN0aXZlRHVyYXRpb24obGF5ZXIsIHRpbWVTdGF0ZSksIHRpbWVTdGF0ZS5wZXJpb2QpO1xuICAgIHJldHVybiBmZWF0dXJlSW5XaW5kb3codGltZXNbMF0sIHRpbWVzWzFdLCB3aW4pO1xufVxuXG4vLyBUaGUgZXh0ZW50IG9mIGV2ZXJ5IHRpbWUgbGF5ZXIncyBvYnNlcnZhdGlvbnMsIE5hTi1ibGluZC4gRmVlZHMgdGljayBnZW5lcmF0aW9uLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RUaW1lRXh0ZW50KGxheWVycywgYnVmZmVycykge1xuICAgIGxldCBtaW4gPSBJbmZpbml0eSwgbWF4ID0gLUluZmluaXR5O1xuICAgIGNvbnN0IHZpc2l0ID0gKGxpc3QpID0+IGxpc3QuZm9yRWFjaChsYXllciA9PiB7XG4gICAgICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHJldHVybiB2aXNpdChsYXllci5sYXllcnMgfHwgW10pO1xuICAgICAgICBpZiAoIWxheWVyLnRpbWUpIHJldHVybjtcbiAgICAgICAgY29uc3QgdGltZXMgPSB0aW1lc0ZvcihsYXllciwgYnVmZmVycyk7XG4gICAgICAgIGlmICghdGltZXMpIHJldHVybjtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aW1lcy5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTih0aW1lc1tpXSkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgaWYgKHRpbWVzW2ldIDwgbWluKSBtaW4gPSB0aW1lc1tpXTtcbiAgICAgICAgICAgIGlmICh0aW1lc1tpICsgMV0gPiBtYXgpIG1heCA9IHRpbWVzW2kgKyAxXTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHZpc2l0KGxheWVycyk7XG4gICAgcmV0dXJuIG1pbiA9PT0gSW5maW5pdHkgPyBudWxsIDogeyBtaW4sIG1heCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzVGltZUxheWVycyhsYXllcnMpIHtcbiAgICByZXR1cm4gbGF5ZXJzLnNvbWUobCA9PiBsLnR5cGUgPT09IFwiZ3JvdXBcIlxuICAgICAgICA/IGhhc1RpbWVMYXllcnMobC5sYXllcnMgfHwgW10pXG4gICAgICAgIDogQm9vbGVhbihsLnRpbWUpKTtcbn1cblxuLy8gT25lIHBsYXliYWNrIHN0ZXA6IHRoZSBuZXh0IGluZGV4IGFuZCB3aGV0aGVyIHBsYXliYWNrIHN1cnZpdmVzIGl0LiBQdXJlIHNvIHRoZSBsb29wXG4vLyBzZW1hbnRpY3MgYXJlIHRlc3RhYmxlIHdpdGhvdXQgYSB0aW1lciAtLSBsb29waW5nIHdyYXBzIGFuZCBrZWVwcyBwbGF5aW5nLCB0aGUgZW5kXG4vLyB3aXRob3V0IGxvb3Agc3RvcHMgd2hlcmUgaXQgaXMuXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZShpbmRleCwgbGVuZ3RoLCBsb29wKSB7XG4gICAgaWYgKGluZGV4IDwgbGVuZ3RoIC0gMSkgcmV0dXJuIHsgaW5kZXg6IGluZGV4ICsgMSwgcGxheWluZzogdHJ1ZSB9O1xuICAgIGlmIChsb29wKSByZXR1cm4geyBpbmRleDogMCwgcGxheWluZzogdHJ1ZSB9O1xuICAgIHJldHVybiB7IGluZGV4LCBwbGF5aW5nOiBmYWxzZSB9O1xufVxuXG4vLyBXaGVyZSB0aGUgY29udHJvbCBzaXRzLCBhcyBpbmxpbmUgc3R5bGVzIHNvIHRoZSBjaG9pY2UgdHJhdmVscyB3aXRoIHRoZSBzdGF0ZSByYXRoZXJcbi8vIHRoYW4gbmVlZGluZyBhIHN0eWxlc2hlZXQgcnVsZSBwZXIgY29ybmVyLiBFdmVyeSBwcm9wZXJ0eSBpcyB3cml0dGVuIG9uIGV2ZXJ5IHJlbmRlciAtLVxuLy8gaW5jbHVkaW5nIHRoZSBvbmVzIGEgcG9zaXRpb24gZG9lcyBub3QgdXNlIC0tIHNvIG1vdmluZyB0aGUgY29udHJvbCBjbGVhcnMgdGhlIG9sZFxuLy8gYW5jaG9yIGluc3RlYWQgb2YgYWNjdW11bGF0aW5nIGJvdGguXG5leHBvcnQgY29uc3QgUE9TSVRJT05TID0ge1xuICAgIFwidG9wLWxlZnRcIjogICAgICB7IHRvcDogXCIxMHB4XCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCIxMHB4XCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwiXCIgfSxcbiAgICBcInRvcC1jZW50ZXJcIjogICAgeyB0b3A6IFwiMTBweFwiLCBib3R0b206IFwiXCIsIGxlZnQ6IFwiNTAlXCIsIHJpZ2h0OiBcIlwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWCgtNTAlKVwiIH0sXG4gICAgXCJ0b3AtcmlnaHRcIjogICAgIHsgdG9wOiBcIjEwcHhcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIlwiLCByaWdodDogXCIxMHB4XCIsIHRyYW5zZm9ybTogXCJcIiB9LFxuICAgIFwibGVmdC1jZW50ZXJcIjogICB7IHRvcDogXCI1MCVcIiwgYm90dG9tOiBcIlwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVZKC01MCUpXCIgfSxcbiAgICBcInJpZ2h0LWNlbnRlclwiOiAgeyB0b3A6IFwiNTAlXCIsIGJvdHRvbTogXCJcIiwgbGVmdDogXCJcIiwgcmlnaHQ6IFwiMTBweFwiLCB0cmFuc2Zvcm06IFwidHJhbnNsYXRlWSgtNTAlKVwiIH0sXG4gICAgXCJib3R0b20tbGVmdFwiOiAgIHsgdG9wOiBcIlwiLCBib3R0b206IFwiMTBweFwiLCBsZWZ0OiBcIjEwcHhcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJcIiB9LFxuICAgIFwiYm90dG9tLWNlbnRlclwiOiB7IHRvcDogXCJcIiwgYm90dG9tOiBcIjEwcHhcIiwgbGVmdDogXCI1MCVcIiwgcmlnaHQ6IFwiXCIsIHRyYW5zZm9ybTogXCJ0cmFuc2xhdGVYKC01MCUpXCIgfSxcbiAgICBcImJvdHRvbS1yaWdodFwiOiAgeyB0b3A6IFwiXCIsIGJvdHRvbTogXCIxMHB4XCIsIGxlZnQ6IFwiXCIsIHJpZ2h0OiBcIjEwcHhcIiwgdHJhbnNmb3JtOiBcIlwiIH0sXG59O1xuXG5mdW5jdGlvbiBhcHBseVBvc2l0aW9uKGVsLCBwb3NpdGlvbikge1xuICAgIGNvbnN0IHN0eWxlcyA9IFBPU0lUSU9OU1twb3NpdGlvbl0gfHwgUE9TSVRJT05TW1widG9wLWNlbnRlclwiXTtcbiAgICBmb3IgKGNvbnN0IFtwcm9wLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3R5bGVzKSkge1xuICAgICAgICBlbC5zdHlsZVtwcm9wXSA9IHZhbHVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0VVRDKG1zKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDE5KS5yZXBsYWNlKFwiVFwiLCBcIiBcIikgKyBcIlpcIjtcbn1cblxuLy8gLS0tIHRoZSB3aW5kb3cgYW5kIHRoZSBydWxlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBGaXhlZCBtaWxsaXNlY29uZHMgZm9yIGEgcGVyaW9kLCBvciBudWxsIHdoZW4gaXQgbW92ZXMgdGhyb3VnaCB0aGUgY2FsZW5kYXIgKG1vbnRocyxcbi8vIHllYXJzKSBhbmQgaGFzIG5vIGZpeGVkIHdpZHRoLiBUaGUgcnVsZXIgYW5kIHRoZSBkcmFnIGdyaWQgbmVlZCBmaXhlZCB3aWR0aHM7IGNhbGVuZGFyXG4vLyBwZXJpb2RzIGZhbGwgYmFjayB0byB0aGUgdGljayBwb3NpdGlvbnMgdGhlbXNlbHZlcy5cbmV4cG9ydCBmdW5jdGlvbiBwZXJpb2RUb01zKHApIHtcbiAgICBpZiAoIXAgfHwgcC55ZWFycyB8fCBwLm1vbnRocykgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuICgocC53ZWVrcyAqIDcgKyBwLmRheXMpICogMjQgKiAzNjAwICsgcC5ob3VycyAqIDM2MDBcbiAgICAgICAgKyBwLm1pbnV0ZXMgKiA2MCArIHAuc2Vjb25kcykgKiAxMDAwO1xufVxuXG4vLyBNaWxsaXNlY29uZHMgYXMgYW4gSVNPODYwMSBkdXJhdGlvbiwgaG91cnMvbWludXRlcy9zZWNvbmRzIG9ubHkgLS0gUFQyNkggaXMgdmFsaWQgYW5kXG4vLyBhdm9pZHMgY2FsZW5kYXIgdW5pdHMgZW50aXJlbHksIHNvIHdoYXQgdGhlIGRyYWcgd3JpdGVzIGFsd2F5cyBwYXJzZXMgYmFjayBleGFjdGx5LlxuZXhwb3J0IGZ1bmN0aW9uIG1zVG9QZXJpb2RJU08obXMpIHtcbiAgICBsZXQgcmVzdCA9IE1hdGgucm91bmQobXMgLyAxMDAwKTtcbiAgICBjb25zdCBoID0gTWF0aC5mbG9vcihyZXN0IC8gMzYwMCk7IHJlc3QgLT0gaCAqIDM2MDA7XG4gICAgY29uc3QgbSA9IE1hdGguZmxvb3IocmVzdCAvIDYwKTsgcmVzdCAtPSBtICogNjA7XG4gICAgbGV0IG91dCA9IFwiUFRcIjtcbiAgICBpZiAoaCkgb3V0ICs9IGAke2h9SGA7XG4gICAgaWYgKG0pIG91dCArPSBgJHttfU1gO1xuICAgIGlmIChyZXN0IHx8IG91dCA9PT0gXCJQVFwiKSBvdXQgKz0gYCR7cmVzdH1TYDtcbiAgICByZXR1cm4gb3V0O1xufVxuXG4vLyBUaGUgcnVsZXIncyBpbmNyZW1lbnQ6IHRoZSBsYXJnZXN0IHN0ZXAgdGhhdCBsYW5kcyBvbiBldmVyeSBib3VuZGFyeSB0aGUgdXNlciBjYW4gY2FyZVxuLy8gYWJvdXQgLS0gdGhlIGdjZCBvZiB0aGUgaW50ZXJ2YWwgYW5kIGV2ZXJ5IGF0dGFjaGVkIGR1cmF0aW9uLiBBbiBpbnRlcnZhbCBvZiAxaCB3aXRoIGFcbi8vIDIuNWggZHVyYXRpb24gbmVlZHMgMzAtbWludXRlIG1hcmtzIGZvciB0aGUgZHVyYXRpb24gdG8gc2l0IG9uIG9uZTsgMWggYW5kIDJoIG5lZWQgb25seVxuLy8gdGhlIGhvdXJzLiBcIkxvd2VzdCBkdXJhdGlvblwiIGlzIHRoZSBzcGVjaWFsIGNhc2Ugd2hlcmUgb25lIGRpdmlkZXMgdGhlIG90aGVyLlxuZXhwb3J0IGZ1bmN0aW9uIGdjZEdyaWRNcyhwZXJpb2RNcywgZHVyYXRpb25zTXMpIHtcbiAgICBjb25zdCBnY2QgPSAoYSwgYikgPT4gKGIgPyBnY2QoYiwgYSAlIGIpIDogYSk7XG4gICAgbGV0IGdyaWQgPSBwZXJpb2RNcztcbiAgICBmb3IgKGNvbnN0IGQgb2YgZHVyYXRpb25zTXMpIHtcbiAgICAgICAgaWYgKGQgPiAwKSBncmlkID0gZ2NkKGdyaWQsIE1hdGgucm91bmQoZCkpO1xuICAgIH1cbiAgICByZXR1cm4gTWF0aC5tYXgoZ3JpZCwgMTAwMCk7XG59XG5cbi8vIEV2ZXJ5IGZpbml0ZSBkdXJhdGlvbiBhdHRhY2hlZCB0byBhIHRpbWUgbGF5ZXIsIGluIG1zLCBmb3IgdGhlIGdyaWQuIFwicGVyaW9kXCIgYW5kIG51bGxcbi8vIGNvbnRyaWJ1dGUgbm90aGluZyBuZXc7IGNhbGVuZGFyIGR1cmF0aW9ucyBjYW5ub3Qgam9pbiBhIGZpeGVkLW1zIGdyaWQgYW5kIGFyZSBza2lwcGVkLlxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3REdXJhdGlvbnNNcyhsYXllcnMsIHdpbmRvd0lzbykge1xuICAgIGNvbnN0IG91dCA9IFtdO1xuICAgIGNvbnN0IHZpc2l0ID0gbGlzdCA9PiBsaXN0LmZvckVhY2gobCA9PiB7XG4gICAgICAgIGlmIChsLnR5cGUgPT09IFwiZ3JvdXBcIikgcmV0dXJuIHZpc2l0KGwubGF5ZXJzIHx8IFtdKTtcbiAgICAgICAgY29uc3Qgc3BlYyA9IGwudGltZSAmJiBsLnRpbWUuZHVyYXRpb247XG4gICAgICAgIGlmICh0eXBlb2Ygc3BlYyA9PT0gXCJzdHJpbmdcIiAmJiBzcGVjICE9PSBcInBlcmlvZFwiKSB7XG4gICAgICAgICAgICBjb25zdCBtcyA9IHBlcmlvZFRvTXMocGFyc2VQZXJpb2Qoc3BlYykpO1xuICAgICAgICAgICAgaWYgKG1zKSBvdXQucHVzaChtcyk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICB2aXNpdChsYXllcnMpO1xuICAgIGlmICh3aW5kb3dJc28pIHtcbiAgICAgICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHdpbmRvd0lzbykpO1xuICAgICAgICBpZiAobXMpIG91dC5wdXNoKG1zKTtcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbn1cblxuLy8gVGljayBtYXJrcyBmb3IgdGhlIHRyYWNrOiBtYWpvcnMgYXQgZXZlcnkgaW50ZXJ2YWwgYm91bmRhcnkgKHNwYXJzZWx5IGxhYmVsbGVkIHNvIGxvbmdcbi8vIHRpbWVsaW5lcyBzdGF5IHJlYWRhYmxlKSwgdW5sYWJlbGxlZCBtaW5vcnMgYXQgdGhlIGdyaWQgaW4gYmV0d2Vlbi4gTWlub3IgRElTUExBWSBpc1xuLy8gdGhpbm5lZCB3aGVuIGRlbnNlOyB0aGUgc25hcCBncmlkIHN0YXlzIGV4YWN0LCBzbyBhIG1hcmsgaXMgYSBndWlkZSwgbm90IGEgY29uc3RyYWludC5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJ1bGVyKHRpY2tzLCBncmlkTXMsIGZvcm1hdExhYmVsLCB7IG1heExhYmVscyA9IDYsIG1heE1pbm9ycyA9IDI0MCB9ID0ge30pIHtcbiAgICBpZiAodGlja3MubGVuZ3RoIDwgMikgcmV0dXJuIFtdO1xuICAgIGNvbnN0IHQwID0gdGlja3NbMF0sIHNwYW4gPSB0aWNrc1t0aWNrcy5sZW5ndGggLSAxXSAtIHQwO1xuICAgIGNvbnN0IG1hcmtzID0gW107XG4gICAgY29uc3QgbGFiZWxFdmVyeSA9IE1hdGgubWF4KDEsIE1hdGguY2VpbCh0aWNrcy5sZW5ndGggLyBtYXhMYWJlbHMpKTtcbiAgICB0aWNrcy5mb3JFYWNoKCh0LCBpKSA9PiBtYXJrcy5wdXNoKHtcbiAgICAgICAgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IHRydWUsXG4gICAgICAgIGxhYmVsOiBpICUgbGFiZWxFdmVyeSA9PT0gMCA/IGZvcm1hdExhYmVsKHQpIDogbnVsbCxcbiAgICB9KSk7XG4gICAgaWYgKGdyaWRNcyAmJiBncmlkTXMgPCBzcGFuKSB7XG4gICAgICAgIGNvbnN0IHRvdGFsID0gTWF0aC5mbG9vcihzcGFuIC8gZ3JpZE1zKTtcbiAgICAgICAgY29uc3QgdGhpbiA9IE1hdGgubWF4KDEsIE1hdGguY2VpbCh0b3RhbCAvIG1heE1pbm9ycykpO1xuICAgICAgICBmb3IgKGxldCBrID0gMTsgayAqIGdyaWRNcyA8IHNwYW47IGsgKz0gdGhpbikge1xuICAgICAgICAgICAgY29uc3QgdCA9IHQwICsgayAqIGdyaWRNcztcbiAgICAgICAgICAgIGlmICh0aWNrcy5pbmNsdWRlcyh0KSkgY29udGludWU7XG4gICAgICAgICAgICBtYXJrcy5wdXNoKHsgZnJhY3Rpb246ICh0IC0gdDApIC8gc3BhbiwgbWFqb3I6IGZhbHNlLCBsYWJlbDogbnVsbCB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbWFya3M7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRUaWNrTGFiZWwobXMsIHBlcmlvZE1zKSB7XG4gICAgY29uc3QgaXNvID0gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKCk7XG4gICAgaWYgKHBlcmlvZE1zICE9IG51bGwgJiYgcGVyaW9kTXMgPCA2MCAqIDEwMDApIHJldHVybiBpc28uc2xpY2UoMTEsIDE5KTtcbiAgICBpZiAocGVyaW9kTXMgIT0gbnVsbCAmJiBwZXJpb2RNcyA8IDI0ICogMzYwMCAqIDEwMDApIHJldHVybiBpc28uc2xpY2UoMTEsIDE2KTtcbiAgICByZXR1cm4gaXNvLnNsaWNlKDUsIDEwKTtcbn1cblxuLy8gR2x5cGhzIGFzIGlubGluZSBTVkcgcmF0aGVyIHRoYW4gdGV4dDogXCJcdTIxQkJcIiByZWFkcyBhcyByZWZyZXNoIC0tIGEgbG9vcCB0b2dnbGUgZHJhd24gd2l0aFxuLy8gaXQgbG9va3MgbGlrZSBhIHJlc2V0IGJ1dHRvbiwgd2hpY2ggaXMgZXhhY3RseSBob3cgaXQgZ290IG1pc3JlYWQuIGN1cnJlbnRDb2xvciBsZXRzXG4vLyB0aGUgcHJlc3NlZCBzdGF0ZSByZXN0eWxlIHRoZW0gZnJvbSBDU1MuXG5jb25zdCBJQ09OUyA9IHtcbiAgICBiYWNrOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNMyAyaDJ2MTJIM3pNMTMgMiA2IDhsNyA2elwiLz48L3N2Zz4nLFxuICAgIHBsYXk6ICc8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiMTFcIiBmaWxsPVwiY3VycmVudENvbG9yXCI+PHBhdGggZD1cIk00IDJsOSA2LTkgNnpcIi8+PC9zdmc+JyxcbiAgICBwYXVzZTogJzxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCIxMVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIj48cGF0aCBkPVwiTTQgMmgzdjEySDR6TTkgMmgzdjEySDl6XCIvPjwvc3ZnPicsXG4gICAgZndkOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNMTEgMmgydjEyaC0yek0zIDJsNyA2LTcgNnpcIi8+PC9zdmc+JyxcbiAgICBsb29wOiAnPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjExXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiPjxwYXRoIGQ9XCJNOCAyYTYgNiAwIDAgMSA1LjY1IDRIMTZsLTIuOCAzLjVMMTAuNCA2aDIuMUE0LjUgNC41IDAgMSAwIDEyLjUgMTBsMS4zLjc1QTYgNiAwIDEgMSA4IDJ6XCIvPjwvc3ZnPicsXG59O1xuXG4vLyAtLS0gdGhlIGNvbnRyb2wgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBsYWluIERPTSBpbnNpZGUgdGhlIHdpZGdldCBjb250YWluZXIsIGxpa2UgdGhlIHNpZGViYXI6IG5vIExlYWZsZXQgY29udHJvbCBtYWNoaW5lcnksXG4vLyB3aGljaCBrZWVwcyBpdCB0ZXN0YWJsZSBpbiBqc2RvbSBhbmQgc3R5bGVhYmxlIGZyb20gbWFwLmNzcy4gVGhlIGxheW91dCBmb2xsb3dzXG4vLyBMZWFmbGV0LlRpbWVEaW1lbnNpb24ncyBjb250cm9sIC0tIHN0ZXAvcGxheS9zdGVwL2xvb3AgYXMgYSBqb2luZWQgYnV0dG9uIGJhciwgdGhlbiB0aGVcbi8vIGRhdGUsIHNsaWRlciBhbmQgc3BlZWQgLS0gc2luY2UgdGhhdCBpcyB0aGUgc2xpZGVyIHVzZXJzIG9mIHRoZSBmb2xpdW0gYXBwcyBrbm93LlxuLy9cbi8vIFRoZSBzbGlkZXIgaXMgYSBjb21wb3NpdGUuIEEgbmF0aXZlIDxpbnB1dCB0eXBlPXJhbmdlPiBzdGF5cyBvbiB0b3AgYXMgdGhlIHRodW1iOiBpdFxuLy8ga2VlcHMga2V5Ym9hcmQgYXJyb3dzLCBzY3JlZW4gcmVhZGVycyBhbmQgZXZlcnkgZXhpc3RpbmcgdGVzdCB3b3JraW5nLCBhbmQgcGxheWJhY2tcbi8vIGRyaXZlcyBpdCBhcyBiZWZvcmUuIFVuZGVybmVhdGggc2l0IHRoZSBwYXJ0cyBhIG5hdGl2ZSBpbnB1dCBjYW5ub3QgZHJhdzogdGhlIHdpbmRvd1xuLy8gc3BhbiBzaG93aW5nIGV4YWN0bHkgd2hhdCBpbnRlcnZhbCBpcyBvbiB0aGUgbWFwLCBhIHJ1bGVyIHdpdGggbGFiZWxsZWQgaW50ZXJ2YWwgbWFya3Ncbi8vIGFuZCB1bmxhYmVsbGVkIGdjZCBtaW5vcnMsIGFuZCB0aGUgdHJhaWwgaGFuZGxlIC0tIGRyYWcgaXQgYmFjayB0byB3aWRlbiB0aGUgd2luZG93IGZvclxuLy8gZXZlcnkgbGF5ZXIgYXQgb25jZSwgZHJvcCBpdCBvbnRvIHRoZSB0aHVtYiB0byBoYW5kIGNvbnRyb2wgYmFjayB0byBwZXItbGF5ZXIgZHVyYXRpb25zLlxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclRpbWVDb250cm9sKGNvbnRhaW5lciwgc3RhdGUsIGhhbmRsZXJzKSB7XG4gICAgbGV0IGVsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1jb250cm9sXCIpO1xuICAgIGlmICghc3RhdGUudGlja3MgfHwgc3RhdGUudGlja3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmIChlbCkgZWwucmVtb3ZlKCk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoIWVsKSB7XG4gICAgICAgIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgZWwuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLWNvbnRyb2xcIjtcbiAgICAgICAgZWwuaW5uZXJIVE1MID0gYFxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJzd2lmdG1hcC10aW1lLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1iYWNrXCIgdGl0bGU9XCJTdGVwIGJhY2tcIiBhcmlhLWxhYmVsPVwiU3RlcCBiYWNrXCI+JHtJQ09OUy5iYWNrfTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJzd2lmdG1hcC10aW1lLXBsYXlcIiBhcmlhLWxhYmVsPVwiUGxheVwiPiR7SUNPTlMucGxheX08L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1md2RcIiB0aXRsZT1cIlN0ZXAgZm9yd2FyZFwiIGFyaWEtbGFiZWw9XCJTdGVwIGZvcndhcmRcIj4ke0lDT05TLmZ3ZH08L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwic3dpZnRtYXAtdGltZS1sb29wXCIgYXJpYS1sYWJlbD1cIkxvb3BcIj4ke0lDT05TLmxvb3B9PC9idXR0b24+XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtbGFiZWxcIj48L3NwYW4+XG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtdHJhY2tcIj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtYmFzZVwiPjwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtc3BhblwiPjwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtcnVsZXJcIj48L3NwYW4+XG4gICAgICAgICAgICAgICAgPGlucHV0IGNsYXNzPVwic3dpZnRtYXAtdGltZS1zbGlkZXJcIiB0eXBlPVwicmFuZ2VcIiBtaW49XCIwXCIgc3RlcD1cIjFcIj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cInN3aWZ0bWFwLXRpbWUtdHJhaWxcIiByb2xlPVwic2xpZGVyXCIgdGFiaW5kZXg9XCIwXCJcbiAgICAgICAgICAgICAgICAgICAgICBhcmlhLWxhYmVsPVwiVHJhaWxpbmcgd2luZG93XCIgdGl0bGU9XCJEcmFnIGJhY2sgdG8gd2lkZW4gdGhlIHRpbWUgd2luZG93OyBkcm9wIG9uIHRoZSB0aHVtYiB0byBjbGVhclwiPjwvc3Bhbj5cbiAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgIDxzZWxlY3QgY2xhc3M9XCJzd2lmdG1hcC10aW1lLXNwZWVkXCIgdGl0bGU9XCJQbGF5YmFjayBzcGVlZFwiPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIwLjVcIj4wLjV4PC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIjFcIj4xeDwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCIyXCI+Mng8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiNFwiPjR4PC9vcHRpb24+XG4gICAgICAgICAgICA8L3NlbGVjdD5gO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoZWwpO1xuXG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1iYWNrXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblN0ZXBCYWNrKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWZ3ZFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25TdGVwRm9yd2FyZCk7XG4gICAgICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBoYW5kbGVycy5vblBsYXlUb2dnbGUpO1xuICAgICAgICBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtbG9vcFwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgaGFuZGxlcnMub25Mb29wVG9nZ2xlKTtcbiAgICAgICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIixcbiAgICAgICAgICAgIGUgPT4gaGFuZGxlcnMub25TcGVlZChwYXJzZUZsb2F0KGUudGFyZ2V0LnZhbHVlKSkpO1xuICAgICAgICBjb25zdCBzbGlkZXIgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtc2xpZGVyXCIpO1xuICAgICAgICAvLyBgaW5wdXRgIGZpcmVzIHBlciBkcmFnIHN0ZXAgZm9yIGxpdmUgc2NydWJiaW5nOyB0aGUgbW9kZWwgd3JpdGViYWNrIGlzIHRoZVxuICAgICAgICAvLyBoYW5kbGVyJ3MgcHJvYmxlbSwgdGhyb3R0bGVkIHRoZXJlIHNvIGRyYWdnaW5nIGRvZXMgbm90IGZsb29kIHRoZSBrZXJuZWwuXG4gICAgICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgZSA9PiBoYW5kbGVycy5vblNlZWsocGFyc2VJbnQoZS50YXJnZXQudmFsdWUsIDEwKSkpO1xuXG4gICAgICAgIGF0dGFjaFRyYWlsRHJhZyhlbCwgaGFuZGxlcnMpO1xuICAgIH1cblxuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikubWF4ID0gU3RyaW5nKHN0YXRlLnRpY2tzLmxlbmd0aCAtIDEpO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1zbGlkZXJcIikudmFsdWUgPSBTdHJpbmcoc3RhdGUuaW5kZXgpO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1sYWJlbFwiKS50ZXh0Q29udGVudCA9IGZvcm1hdFVUQyhzdGF0ZS50aWNrc1tzdGF0ZS5pbmRleF0pO1xuXG4gICAgY29uc3QgcGxheSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1wbGF5XCIpO1xuICAgIHBsYXkuaW5uZXJIVE1MID0gc3RhdGUucGxheWluZyA/IElDT05TLnBhdXNlIDogSUNPTlMucGxheTtcbiAgICBwbGF5LnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiKTtcbiAgICBwbGF5LnRpdGxlID0gc3RhdGUucGxheWluZyA/IFwiUGF1c2VcIiA6IFwiUGxheVwiO1xuXG4gICAgLy8gQSBtb2RlLCBub3QgYW4gYWN0aW9uOiBwcmVzc2VkIHN0eWxpbmcgYW5kIGFyaWEtcHJlc3NlZCBzYXkgXCJ0aGlzIHN0YXlzIG9uXCIsXG4gICAgLy8gd2hlcmUgYSBiYXJlIGljb24gaW52aXRlZCBhIGNsaWNrIGV4cGVjdGluZyBzb21ldGhpbmcgdG8gaGFwcGVuIHJpZ2h0IG5vdy5cbiAgICBjb25zdCBsb29wID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLWxvb3BcIik7XG4gICAgbG9vcC5jbGFzc0xpc3QudG9nZ2xlKFwiYWN0aXZlXCIsIEJvb2xlYW4oc3RhdGUubG9vcCkpO1xuICAgIGxvb3Auc2V0QXR0cmlidXRlKFwiYXJpYS1wcmVzc2VkXCIsIFN0cmluZyhCb29sZWFuKHN0YXRlLmxvb3ApKSk7XG4gICAgbG9vcC50aXRsZSA9IHN0YXRlLmxvb3AgPyBcIkxvb3A6IG9uXCIgOiBcIkxvb3A6IG9mZlwiO1xuXG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwZWVkXCIpLnZhbHVlID0gU3RyaW5nKHN0YXRlLnNwZWVkIHx8IDEpO1xuICAgIHJlbmRlclRyYWNrKGVsLCBzdGF0ZSk7XG4gICAgYXBwbHlQb3NpdGlvbihlbCwgc3RhdGUucG9zaXRpb24pO1xuICAgIHJldHVybiBlbDtcbn1cblxuLy8gR2VvbWV0cnkgc2hhcmVkIGJ5IHJlbmRlcmluZyBhbmQgZHJhZ2dpbmc6IHdoZXJlIGEgdGltZSBzaXRzIG9uIHRoZSB0cmFjaywgMC4uMS5cbmZ1bmN0aW9uIHRyYWNrRnJhY3Rpb24odGlja3MsIHQpIHtcbiAgICBjb25zdCBzcGFuID0gdGlja3NbdGlja3MubGVuZ3RoIC0gMV0gLSB0aWNrc1swXTtcbiAgICBpZiAoc3BhbiA8PSAwKSByZXR1cm4gMTtcbiAgICByZXR1cm4gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgKHQgLSB0aWNrc1swXSkgLyBzcGFuKSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclRyYWNrKGVsLCBzdGF0ZSkge1xuICAgIGNvbnN0IHsgdGlja3MsIGluZGV4IH0gPSBzdGF0ZTtcbiAgICBjb25zdCB0cmFjayA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS10cmFja1wiKTtcbiAgICB0cmFjay5fc3RhdGUgPSBzdGF0ZTsgICAgICAvLyB0aGUgZHJhZyBoYW5kbGVyIHJlYWRzIHRoZSBmcmVzaGVzdCBzdGF0ZSBmcm9tIGhlcmVcblxuICAgIGNvbnN0IHRodW1iVCA9IHRpY2tzW2luZGV4XTtcbiAgICBjb25zdCBwZXJpb2RNcyA9IHN0YXRlLnBlcmlvZE1zO1xuICAgIGNvbnN0IHdpbmRvd01zID0gc3RhdGUud2luZG93ID8gcGVyaW9kVG9NcyhwYXJzZVBlcmlvZChzdGF0ZS53aW5kb3cpKSA6IG51bGw7XG4gICAgY29uc3Qgc2hvd25NcyA9IHdpbmRvd01zICE9IG51bGwgPyB3aW5kb3dNcyA6IHBlcmlvZE1zO1xuXG4gICAgLy8gVGhlIHNwYW46IHdoYXQgaW50ZXJ2YWwgdGhlIG1hcCBpcyBzaG93aW5nIHJpZ2h0IG5vdy4gVGhlIHNwYW4gZGVwaWN0cyB0aGUgc2hhcmVkXG4gICAgLy8gd2luZG93IC0tIG9uZSBwZXJpb2QgYnkgZGVmYXVsdCAtLSBhbmQgcGVyLWxheWVyIGR1cmF0aW9ucyByZW1haW4gYW4gQVBJIGNvbmNlcm5cbiAgICAvLyB1bnRpbCBhIGRyYWcgb3ZlcnJpZGVzIHRoZW0gZm9yIGV2ZXJ5dGhpbmcgYXQgb25jZS5cbiAgICBjb25zdCBzcGFuID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXNwYW5cIik7XG4gICAgY29uc3QgcmlnaHQgPSB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQpO1xuICAgIGNvbnN0IGxlZnQgPSBzaG93bk1zICE9IG51bGwgPyB0cmFja0ZyYWN0aW9uKHRpY2tzLCB0aHVtYlQgLSBzaG93bk1zKSA6IDA7XG4gICAgc3Bhbi5zdHlsZS5sZWZ0ID0gYCR7KGxlZnQgKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgc3Bhbi5zdHlsZS53aWR0aCA9IGAkeyhNYXRoLm1heCgwLCByaWdodCAtIGxlZnQpICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgIHNwYW4uY2xhc3NMaXN0LnRvZ2dsZShcIm92ZXJyaWRlXCIsIHdpbmRvd01zICE9IG51bGwpO1xuXG4gICAgLy8gVGhlIHRyYWlsIGhhbmRsZSBwYXJrcyBPTiB0aGUgdGh1bWIgd2hlbiBubyBvdmVycmlkZSBpcyBhY3RpdmUgLS0gXCJub3QgZ3JhYmJlZFwiIC0tXG4gICAgLy8gYW5kIHNpdHMgYXQgdGhlIHdpbmRvdydzIHN0YXJ0IHdoaWxlIG9uZSBpcy4gRHJvcHBpbmcgaXQgYmFjayBvbiB0aGUgdGh1bWIgY2xlYXJzLlxuICAgIGNvbnN0IHRyYWlsID0gZWwucXVlcnlTZWxlY3RvcihcIi5zd2lmdG1hcC10aW1lLXRyYWlsXCIpO1xuICAgIGNvbnN0IGF0ID0gd2luZG93TXMgIT0gbnVsbCA/IHRyYWNrRnJhY3Rpb24odGlja3MsIHRodW1iVCAtIHdpbmRvd01zKSA6IHJpZ2h0O1xuICAgIHRyYWlsLnN0eWxlLmxlZnQgPSBgJHsoYXQgKiAxMDApLnRvRml4ZWQoMil9JWA7XG4gICAgdHJhaWwuY2xhc3NMaXN0LnRvZ2dsZShcImFjdGl2ZVwiLCB3aW5kb3dNcyAhPSBudWxsKTtcbiAgICB0cmFpbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLXZhbHVldGV4dFwiLCBzdGF0ZS53aW5kb3cgfHwgXCJubyB0cmFpbGluZyB3aW5kb3dcIik7XG4gICAgLy8gTm8gZml4ZWQtbXMgZ3JpZCAoY2FsZW5kYXIgcGVyaW9kcykgbWVhbnMgbm90aGluZyBzZW5zaWJsZSB0byBzbmFwIHRvLlxuICAgIHRyYWlsLnN0eWxlLmRpc3BsYXkgPSBzdGF0ZS5ncmlkTXMgPyBcIlwiIDogXCJub25lXCI7XG5cbiAgICBjb25zdCBydWxlciA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIuc3dpZnRtYXAtdGltZS1ydWxlclwiKTtcbiAgICBjb25zdCBrZXkgPSBgJHt0aWNrc1swXX18JHt0aWNrcy5sZW5ndGh9fCR7c3RhdGUuZ3JpZE1zfXwke3BlcmlvZE1zfWA7XG4gICAgaWYgKHJ1bGVyLl9rZXkgIT09IGtleSkge1xuICAgICAgICBydWxlci5fa2V5ID0ga2V5O1xuICAgICAgICBydWxlci5pbm5lckhUTUwgPSBcIlwiO1xuICAgICAgICBmb3IgKGNvbnN0IG1hcmsgb2YgYnVpbGRSdWxlcih0aWNrcywgc3RhdGUuZ3JpZE1zLCB0ID0+IGZvcm1hdFRpY2tMYWJlbCh0LCBwZXJpb2RNcykpKSB7XG4gICAgICAgICAgICBjb25zdCBtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICBtLmNsYXNzTmFtZSA9IG1hcmsubWFqb3IgPyBcInN3aWZ0bWFwLXRpbWUtbWFyayBtYWpvclwiIDogXCJzd2lmdG1hcC10aW1lLW1hcmtcIjtcbiAgICAgICAgICAgIG0uc3R5bGUubGVmdCA9IGAkeyhtYXJrLmZyYWN0aW9uICogMTAwKS50b0ZpeGVkKDIpfSVgO1xuICAgICAgICAgICAgaWYgKG1hcmsubGFiZWwpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsYWIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgICAgICAgICBsYWIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC10aW1lLW1hcmstbGFiZWxcIjtcbiAgICAgICAgICAgICAgICBsYWIudGV4dENvbnRlbnQgPSBtYXJrLmxhYmVsO1xuICAgICAgICAgICAgICAgIG0uYXBwZW5kQ2hpbGQobGFiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJ1bGVyLmFwcGVuZENoaWxkKG0pO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyBEcmFnZ2luZyB0aGUgdHJhaWwgaGFuZGxlLiBTbmFwcyB0byB0aGUgZ2NkIGdyaWQgc28gZXZlcnkgc3RvcCBpcyBhIGJvdW5kYXJ5IHRoZSBkYXRhXG4vLyBvciB0aGUgaW50ZXJ2YWwgYWN0dWFsbHkgbmFtZXM7IHRoZSBkaXN0YW5jZSB0byB0aGUgdGh1bWIsIGluIHdob2xlIGdyaWQgc3RlcHMsIElTIHRoZVxuLy8gd2luZG93LiBaZXJvIHN0ZXBzIC0tIGRyb3BwZWQgb24gdGhlIHRodW1iIC0tIGNsZWFycyB0aGUgb3ZlcnJpZGUuXG5mdW5jdGlvbiBhdHRhY2hUcmFpbERyYWcoZWwsIGhhbmRsZXJzKSB7XG4gICAgY29uc3QgdHJhY2sgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhY2tcIik7XG4gICAgY29uc3QgdHJhaWwgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLnN3aWZ0bWFwLXRpbWUtdHJhaWxcIik7XG5cbiAgICBmdW5jdGlvbiBpc29Gcm9tRXZlbnQoZXYpIHtcbiAgICAgICAgY29uc3Qgc3RhdGUgPSB0cmFjay5fc3RhdGU7XG4gICAgICAgIGNvbnN0IHJlY3QgPSB0cmFjay5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUuZ3JpZE1zIHx8IHJlY3Qud2lkdGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIC8vIERlbGliZXJhdGVseSB1bmNsYW1wZWQgb24gdGhlIGxlZnQ6IHRoZSB3aW5kb3cgaXMgXCJob3cgZmFyIGJhY2sgZnJvbSB0aGVcbiAgICAgICAgLy8gbGVhZCBwb2ludFwiLCBhbmQgdGhhdCBtYXkgcmVhY2ggcGFzdCB0aGUgYmFyJ3Mgc3RhcnQgLS0gZXNwZWNpYWxseSB3aGVuIHRoZVxuICAgICAgICAvLyBsZWFkIHNpdHMgZWFybHkgb24gdGhlIGJhciBhbmQgbW9zdCBvZiBpdHMgdHJhaWwgaXMgb2ZmLXNjcmVlbi4gQ2xhbXBpbmcgaGVyZVxuICAgICAgICAvLyBjYXBwZWQgdGhlIHdpbmRvdyBhdCB0aGUgdmlzaWJsZSBwYXN0LCB3aGljaCBwaW5uZWQgdGhlIGhhbmRsZSB0byB0aGUgYmFyJ3NcbiAgICAgICAgLy8gc3RhcnQgYW5kIG1hZGUgYW55dGhpbmcgd2lkZXIgaW1wb3NzaWJsZSB0byBzZXQuIE9ubHkgdGhlIERSQVdJTkcgY2xhbXBzLlxuICAgICAgICBjb25zdCBmcmFjID0gTWF0aC5taW4oMSwgKGV2LmNsaWVudFggLSByZWN0LmxlZnQpIC8gcmVjdC53aWR0aCk7XG4gICAgICAgIGNvbnN0IHQwID0gc3RhdGUudGlja3NbMF07XG4gICAgICAgIGNvbnN0IHNwYW5NcyA9IHN0YXRlLnRpY2tzW3N0YXRlLnRpY2tzLmxlbmd0aCAtIDFdIC0gdDA7XG4gICAgICAgIGNvbnN0IHRodW1iVCA9IHN0YXRlLnRpY2tzW3N0YXRlLmluZGV4XTtcbiAgICAgICAgY29uc3QgZGlzdCA9IHRodW1iVCAtICh0MCArIGZyYWMgKiBzcGFuTXMpO1xuICAgICAgICBjb25zdCBzdGVwcyA9IE1hdGgubWF4KDAsIE1hdGgucm91bmQoZGlzdCAvIHN0YXRlLmdyaWRNcykpO1xuICAgICAgICByZXR1cm4gc3RlcHMgPT09IDAgPyBudWxsIDogbXNUb1BlcmlvZElTTyhzdGVwcyAqIHN0YXRlLmdyaWRNcyk7XG4gICAgfVxuXG4gICAgLy8gTW92ZSBhbmQgcmVsZWFzZSBsaXN0ZW4gb24gdGhlIGRvY3VtZW50IGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIGRyYWc6IHRoZSBoYW5kbGVcbiAgICAvLyBpcyAxMnB4IHdpZGUsIHRoZSBjdXJzb3IgbGVhdmVzIGl0IG9uIHRoZSBmaXJzdCBmYXN0IG1vdmVtZW50LCBhbmQgZXZlbnRzIHRoYXRcbiAgICAvLyB0YXJnZXQgd2hhdGV2ZXIgaXMgdW5kZXJuZWF0aCB3b3VsZCBzdHV0dGVyIHRoZSBkcmFnIGFuZCBjb3VsZCBzd2FsbG93IHRoZSByZWxlYXNlXG4gICAgLy8gZW50aXJlbHkgLS0gYW4gdW5jb21taXR0ZWQgZHJhZyB0aGVuIHNuYXBzIGJhY2sgb24gdGhlIG5leHQgc3luYy5cbiAgICB0cmFpbC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgZXYgPT4ge1xuICAgICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldi5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgLy8gQ2FwdHVyZSByZXRhcmdldHMgZXZlcnkgcG9pbnRlciBldmVudCB0byB0aGUgaGFuZGxlIHVudGlsIHJlbGVhc2UsIG5vIG1hdHRlclxuICAgICAgICAvLyB3aGVyZSB0aGUgY3Vyc29yIGlzLiBXaXRob3V0IGl0LCBsZXR0aW5nIGdvIHdpdGggdGhlIHBvaW50ZXIgb3ZlciB0aGUgbWFwIGhhbmRzXG4gICAgICAgIC8vIHBvaW50ZXJ1cCB0byBMZWFmbGV0J3MgY29udGFpbmVyIGhhbmRsZXJzLCBhbmQgYSByZWxlYXNlIHRoZXkgc3dhbGxvdyBuZXZlclxuICAgICAgICAvLyByZWFjaGVzIHRoZSBkb2N1bWVudCBsaXN0ZW5lciAtLSB0aGUgZHJhZyBzdGF5cyB1bmNvbW1pdHRlZCBhbmQgdGhlIG5leHQgc3luY1xuICAgICAgICAvLyBzbmFwcyB0aGUgaGFuZGxlIGhvbWUuIFRoZSBkb2N1bWVudCBsaXN0ZW5lcnMgYmVsb3cgcmVtYWluIGFzIHRoZSBmYWxsYmFjayBmb3JcbiAgICAgICAgLy8gZW52aXJvbm1lbnRzIHdpdGhvdXQgY2FwdHVyZTsgd2l0aCBpdCwgcmV0YXJnZXRlZCBldmVudHMgc3RpbGwgYnViYmxlIHRvIHRoZW0uXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAodHJhaWwuc2V0UG9pbnRlckNhcHR1cmUpIHRyYWlsLnNldFBvaW50ZXJDYXB0dXJlKGV2LnBvaW50ZXJJZCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBzeW50aGV0aWMgZXZlbnRzIGhhdmUgbm8gYWN0aXZlIHBvaW50ZXI7IGZhbGwgYmFjayB0byBidWJibGluZyAqLyB9XG5cbiAgICAgICAgY29uc3QgbW92ZSA9IGUgPT4ge1xuICAgICAgICAgICAgY29uc3QgaXNvID0gaXNvRnJvbUV2ZW50KGUpO1xuICAgICAgICAgICAgaWYgKGlzbyAhPT0gdW5kZWZpbmVkKSBoYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgZmluaXNoID0gZSA9PiB7XG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIGZpbmlzaCk7XG4gICAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBmaW5pc2gpO1xuICAgICAgICAgICAgY29uc3QgaXNvID0gaXNvRnJvbUV2ZW50KGUpO1xuICAgICAgICAgICAgaWYgKGlzbyAhPT0gdW5kZWZpbmVkKSBoYW5kbGVycy5vbldpbmRvd0NvbW1pdChpc28pO1xuICAgICAgICB9O1xuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgZmluaXNoKTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgZmluaXNoKTtcbiAgICB9KTtcblxuICAgIC8vIEtleWJvYXJkOiBvbmUgZ3JpZCBzdGVwIHBlciBhcnJvdywgRGVsZXRlL0hvbWUgdG8gY2xlYXIuIFNhbWUgY29udHJhY3QgYXMgdGhlIGRyYWcuXG4gICAgdHJhaWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgZXYgPT4ge1xuICAgICAgICBjb25zdCBzdGF0ZSA9IHRyYWNrLl9zdGF0ZTtcbiAgICAgICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUuZ3JpZE1zKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGN1cnJlbnQgPSBzdGF0ZS53aW5kb3cgPyBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHN0YXRlLndpbmRvdykpIDogMDtcbiAgICAgICAgbGV0IG5leHQ7XG4gICAgICAgIGlmIChldi5rZXkgPT09IFwiQXJyb3dMZWZ0XCIpIG5leHQgPSBjdXJyZW50ICsgc3RhdGUuZ3JpZE1zO1xuICAgICAgICBlbHNlIGlmIChldi5rZXkgPT09IFwiQXJyb3dSaWdodFwiKSBuZXh0ID0gTWF0aC5tYXgoMCwgY3VycmVudCAtIHN0YXRlLmdyaWRNcyk7XG4gICAgICAgIGVsc2UgaWYgKGV2LmtleSA9PT0gXCJEZWxldGVcIiB8fCBldi5rZXkgPT09IFwiSG9tZVwiKSBuZXh0ID0gMDtcbiAgICAgICAgZWxzZSByZXR1cm47XG4gICAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGhhbmRsZXJzLm9uV2luZG93Q29tbWl0KG5leHQgPiAwID8gbXNUb1BlcmlvZElTTyhuZXh0KSA6IG51bGwpO1xuICAgIH0pO1xufVxuIiwgIi8vIFRpbWUgZmlsdGVyaW5nIG9uIHRoZSBHUFUsIGZvciBwb2ludCBsYXllcnMuXG4vL1xuLy8gVGhlIGNvb3JkaW5hdGVzIGFscmVhZHkgbGl2ZSBpbiBHUFUgYnVmZmVyczsgcmVidWlsZGluZyB0aGUgbWVyZ2VkIGxheWVyIHBlciB0aWNrIHRocmV3XG4vLyB0aGF0IGF3YXkgYW5kIHJlLWZlZCBnbGlmeSBhbGwgNU0gcG9pbnRzIHRocm91Z2ggSlMgLS0gbWVhc3VyZWQgYXQgfjIuNnMgcGVyIHdpbmRvd1xuLy8gY2hhbmdlIGF0IHRoYXQgc2NhbGUsIHdpdGggYWxsb2NhdGlvbiBjaHVybiB0aGF0IGNvdWxkIGNyYXNoIHRoZSB0YWIgd2hlbiBjaGFuZ2VzXG4vLyBzdGFja2VkLiBJbnN0ZWFkLCBlYWNoIHBvaW50J3MgdGltZSBpbnRlcnZhbCBhbmQgaXRzIGxheWVyJ3MgZHVyYXRpb24gcmlkZSBhbG9uZyBhc1xuLy8gdmVydGV4IGF0dHJpYnV0ZXMgdXBsb2FkZWQgb25jZSwgYW5kIHRoZSBjdXJyZW50IHRpY2sgaXMgYSB1bmlmb3JtOiBhIHRpY2sgb3Igd2luZG93XG4vLyBjaGFuZ2UgY29zdHMgdHdvIGZsb2F0cyBhbmQgYSByZWRyYXcuXG4vL1xuLy8gZ2xpZnkgbWFrZXMgdGhpcyBwb3NzaWJsZSB3aXRob3V0IGZvcmtpbmcgaXQ6IHZlcnRleFNoYWRlclNvdXJjZSBpcyBhbiBvdmVycmlkYWJsZVxuLy8gc2V0dGluZyAodGhlIHBpbiBmcmFnbWVudCBzaGFkZXIgYWxyZWFkeSB1c2VzIHRoZSBzYW1lIGRvb3IpLCBpbnN0YW5jZXMgZXhwb3NlIHRoZWlyXG4vLyBnbC9wcm9ncmFtL2NhbnZhcywgYXR0cmlidXRlcyBhcmUgYm91bmQgb25jZSBhdCBzZXR1cCwgYW5kIHRoZSBwZXItZnJhbWUgZHJhdyB0b3VjaGVzXG4vLyBvbmx5IHRoZSBtYXRyaXggdW5pZm9ybSAtLSBzbyBleHRyYSBhdHRyaWJ1dGVzIGJvdW5kIGFmdGVyIHNldHVwIHBlcnNpc3QsIGFuZCB1bmlmb3JtXG4vLyB1cGRhdGVzIHRha2UgZWZmZWN0IG9uIHRoZSBuZXh0IHJlZHJhdy5cbmltcG9ydCB7IHBhcnNlUGVyaW9kLCBwZXJpb2RUb01zLCB0aW1lc0ZvciB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XG5cbi8vIFRpbWVzIHRyYXZlbCBhcyBmbG9hdDMyIG9uIHRoZSBHUFUsIHdob3NlIGludGVnZXJzIGFyZSBleGFjdCBvbmx5IHRvIDJeMjQuIEVwb2NoIG1zIGlzXG4vLyBob3BlbGVzcyBhdCB0aGF0IHByZWNpc2lvbiwgc28gdGltZXMgYXJlIHJlYmFzZWQgdG8gdGhlIGJ1Y2tldCdzIGVhcmxpZXN0IHN0YXJ0IGFuZFxuLy8gZXhwcmVzc2VkIGluIHNlY29uZHM6IGV4YWN0IHRvIH4xOTQgZGF5cyBvZiBzcGFuLCBhbmQgYSAycyByb3VuZGluZyBiZXlvbmQgdGhhdCBpc1xuLy8gaW52aXNpYmxlIGF0IGFueSB6b29tIGEgdGltZSBzbGlkZXIgbWFrZXMgc2Vuc2UgYXQuXG5jb25zdCBBTFdBWVMgPSA2LjNlODsgICAvLyB+MjAgeWVhcnMsIGluIHNlY29uZHM6IHRoZSBcImR1cmF0aW9uXCIgb2YgY3VtdWxhdGl2ZSBsYXllcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgdGhlIHNwYW4gaGFsZi13aWR0aCBvZiBwb2ludHMgd2l0aCBubyByZWFkYWJsZSB0aW1lLlxuXG4vLyBQZXItYnVja2V0IGxheWVyLXZpc2liaWxpdHkgc2xvdHMgaW4gdGhlIHZlcnRleCBzaGFkZXIuIEVhY2ggZmxvYXQgYXJyYXkgZWxlbWVudFxuLy8gb2NjdXBpZXMgYSBmdWxsIHVuaWZvcm0gdmVjdG9yIGluIEVTIEdMU0wgcGFja2luZywgYW5kIHRoZSBzcGVjIGd1YXJhbnRlZXMgb25seSAxMjhcbi8vIHZlcnRleCB1bmlmb3JtIHZlY3RvcnMgLS0gNjQgc2xvdHMgbGVhdmVzIGNvbWZvcnRhYmxlIHJvb20gZm9yIHRoZSBtYXRyaXggYW5kIHRoZSB0aW1lXG4vLyB1bmlmb3Jtcy4gQSBidWNrZXQgd2l0aCBtb3JlIGxheWVycyB0aGFuIHNsb3RzIGZhbGxzIGJhY2sgdG8gcmVidWlsZC1wZXItdG9nZ2xlLlxuLy8gKFBhY2tpbmcgZm91ciBsYXllcnMgcGVyIHZlYzQgd291bGQgcXVhZHJ1cGxlIHRoaXMgaWYgYW55b25lIGV2ZXIgbmVlZHMgaXQuKVxuZXhwb3J0IGNvbnN0IExBWUVSX1NMT1RTID0gNjQ7XG5cbi8vIENoZWFwIGtpbGwgc3dpdGNoZXM6IGlmIHdpcmluZyB0aGUgR0wgc3RhdGUgZXZlciBmYWlscyAoYSBmdXR1cmUgZ2xpZnkgdmVyc2lvbiBtb3Zpbmdcbi8vIGl0cyBpbnRlcm5hbHMpLCB0aGUgYWZmZWN0ZWQgZmFtaWx5IGZhbGxzIGJhY2sgdG8gdGhlIENQVSByZWJ1aWxkIHBhdGguIFBvaW50cyBhbmRcbi8vIHZlY3RvcnMgYXJlIHNlcGFyYXRlIGZsYWdzIC0tIGEgdmVjdG9yIGludHJvc3BlY3Rpb24gZmFpbHVyZSBtdXN0IG5vdCBjb3N0IHBvaW50c1xuLy8gdGhlaXIgR1BVIHBhdGguXG5sZXQgZ3B1T2sgPSB0cnVlO1xuZXhwb3J0IGZ1bmN0aW9uIGdwdVRpbWVBdmFpbGFibGUoKSB7IHJldHVybiBncHVPazsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpc2FibGVHcHVUaW1lKHJlYXNvbikge1xuICAgIGlmIChncHVPaykgY29uc29sZS53YXJuKGBbU3dpZnRNYXBdIEdQVSB0aW1lIGZpbHRlcmluZyBkaXNhYmxlZDogJHtyZWFzb259LiBgICtcbiAgICAgICAgYEZhbGxpbmcgYmFjayB0byByZWJ1aWxkLXBlci10aWNrLmApO1xuICAgIGdwdU9rID0gZmFsc2U7XG59XG5sZXQgdmVjdG9yR3B1T2sgPSB0cnVlO1xuZXhwb3J0IGZ1bmN0aW9uIHZlY3RvckdwdUF2YWlsYWJsZSgpIHsgcmV0dXJuIHZlY3RvckdwdU9rOyB9XG5leHBvcnQgZnVuY3Rpb24gZGlzYWJsZVZlY3RvckdwdShyZWFzb24pIHtcbiAgICBpZiAodmVjdG9yR3B1T2spIGNvbnNvbGUud2FybihgW1N3aWZ0TWFwXSBHUFUgdGltZSBmb3IgbGluZXMvcG9seWdvbnMgZGlzYWJsZWQ6IGAgK1xuICAgICAgICBgJHtyZWFzb259LiBGYWxsaW5nIGJhY2sgdG8gcmVidWlsZC1wZXItdGljayBmb3IgdGhvc2UgYnVja2V0cy5gKTtcbiAgICB2ZWN0b3JHcHVPayA9IGZhbHNlO1xufVxuXG4vLyBUaGUgZGVmYXVsdCBwb2ludHMgdmVydGV4IHNoYWRlciAocmVhZCBvdXQgb2YgbGVhZmxldC5nbGlmeSAzLjMuMCkgd2l0aCB0aGUgd2luZG93XG4vLyB0ZXN0IGFkZGVkLiBBIGhpZGRlbiBwb2ludCBnZXRzIHNpemUgMCBhbmQgYSBwb3NpdGlvbiBvdXRzaWRlIGNsaXAgc3BhY2UsIHNvIG5laXRoZXJcbi8vIHRoZSB2aXNpYmxlIHBhc3Mgbm9yIHRoZSBzaGFyZWQtcHJvZ3JhbSBwaWNraW5nIHBhc3MgZXZlciByYXN0ZXJpc2VzIGl0LlxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVWZXJ0ZXhTaGFkZXIoKSB7XG4gICAgcmV0dXJuIGB1bmlmb3JtIG1hdDQgbWF0cml4O1xuYXR0cmlidXRlIHZlYzQgdmVydGV4O1xuYXR0cmlidXRlIHZlYzQgY29sb3I7XG5hdHRyaWJ1dGUgZmxvYXQgcG9pbnRTaXplO1xuYXR0cmlidXRlIHZlYzIgYVRpbWVTcGFuO1xuYXR0cmlidXRlIGZsb2F0IGFEdXJhdGlvbjtcbmF0dHJpYnV0ZSBmbG9hdCBhTGF5ZXI7XG51bmlmb3JtIGZsb2F0IHVUaWNrO1xudW5pZm9ybSBmbG9hdCB1T3ZlcnJpZGU7XG51bmlmb3JtIGZsb2F0IHVMYXllclZpc1ske0xBWUVSX1NMT1RTfV07XG52YXJ5aW5nIHZlYzQgX2NvbG9yO1xuXG52b2lkIG1haW4oKSB7XG4gIC8vIEEgbmVnYXRpdmUgZHVyYXRpb24gaXMgdGhlIGZhZGUgZmxhZzogfGFEdXJhdGlvbnwgaXMgdGhlIHdpbmRvdywgdGhlIHNpZ24gc2F5cyB0aGlzXG4gIC8vIHBvaW50IGRpbXMgd2l0aCBhZ2UuIEEgc2hhcmVkIG92ZXJyaWRlIGtlZXBzIHRoZSBwb2ludCdzIG93biBmYWRlIHByZWZlcmVuY2UuXG4gIGJvb2wgZmFkZXMgPSBhRHVyYXRpb24gPCAwLjA7XG4gIGZsb2F0IGR1ciA9IHVPdmVycmlkZSA+PSAwLjAgPyB1T3ZlcnJpZGUgOiBhYnMoYUR1cmF0aW9uKTtcbiAgLy8gSGFsZi1vcGVuICh0aWNrIC0gZHVyLCB0aWNrXSwgbWF0Y2hpbmcgZmVhdHVyZUluV2luZG93IG9uIHRoZSBDUFUgc2lkZSAtLSBBTkRlZCB3aXRoXG4gIC8vIHRoZSBwb2ludCdzIGxheWVyIGJlaW5nIHZpc2libGUuIExheWVyIHRvZ2dsZXMgYXJlIG9uZSB1bmlmb3JtIGVsZW1lbnQsIG5vdCBhXG4gIC8vIHJlYnVpbGQ6IHVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlLWZlZWQgYWxsIDVNIHBvaW50cyB0aHJvdWdoIEpTLlxuICBib29sIHZpc2libGUgPSBhVGltZVNwYW4ueSA+ICh1VGljayAtIGR1cikgJiYgYVRpbWVTcGFuLnggPD0gdVRpY2tcbiAgICAgICYmIHVMYXllclZpc1tpbnQoYUxheWVyKV0gPiAwLjU7XG4gIGdsX1BvaW50U2l6ZSA9IHZpc2libGUgPyBwb2ludFNpemUgOiAwLjA7XG4gIGdsX1Bvc2l0aW9uID0gdmlzaWJsZSA/IG1hdHJpeCAqIHZlcnRleCA6IHZlYzQoMi4wLCAyLjAsIDIuMCwgMS4wKTtcbiAgLy8gQWdlIHJ1bnMgZnJvbSB0aGUgZmVhdHVyZSdzIGVuZDsgbmV3ZXN0IGlzIG9wYXF1ZSwgdGhlIHRyYWlsaW5nIGVkZ2UgcmVhY2hlcyB6ZXJvLlxuICBmbG9hdCBhbHBoYSA9IGZhZGVzID8gY2xhbXAoMS4wIC0gKHVUaWNrIC0gYVRpbWVTcGFuLnkpIC8gZHVyLCAwLjAsIDEuMCkgOiAxLjA7XG4gIF9jb2xvciA9IHZlYzQoY29sb3IucmdiLCBjb2xvci5hICogYWxwaGEpO1xufVxuYDtcbn1cblxuLy8gUGVyLWxheWVyIGR1cmF0aW9uIGluIHNlY29uZHM6IG51bGwgYWNjdW11bGF0ZXMsIFwicGVyaW9kXCIgaXMgdGhlIHNoYXJlZCBpbnRlcnZhbCxcbi8vIGFuIElTTyBzdHJpbmcgaXMgaXRzZWxmOyBhbnl0aGluZyB1bnBhcnNlYWJsZSBmYWxscyBiYWNrIHRvIHRoZSBpbnRlcnZhbC5cbmZ1bmN0aW9uIGR1cmF0aW9uU2Vjb25kcyhzcGVjLCBwZXJpb2RNcykge1xuICAgIGlmIChzcGVjID09PSBudWxsIHx8IHNwZWMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIEFMV0FZUztcbiAgICBpZiAoc3BlYyA9PT0gXCJwZXJpb2RcIikgcmV0dXJuIChwZXJpb2RNcyB8fCAyNCAqIDM2MDAgKiAxMDAwKSAvIDEwMDA7XG4gICAgY29uc3QgbXMgPSBwZXJpb2RUb01zKHBhcnNlUGVyaW9kKHNwZWMpKTtcbiAgICByZXR1cm4gbXMgPyBtcyAvIDEwMDAgOiAocGVyaW9kTXMgfHwgMjQgKiAzNjAwICogMTAwMCkgLyAxMDAwO1xufVxuXG4vLyBCdWlsZHMgdGhlIHBlci1wb2ludCBhdHRyaWJ1dGUgYXJyYXlzIGZvciBvbmUgbWVyZ2VkIGJ1Y2tldCwgaW4gdGhlIGV4YWN0IG9yZGVyIHRoZVxuLy8gYnVja2V0IGZlZWRzIHBvaW50cyB0byBnbGlmeTogbGF5ZXIgYnkgbGF5ZXIsIGluZGV4IDAuLm4tMSwgd2l0aCBzaW5nbGUtYGxvY2F0aW9uYFxuLy8gbGF5ZXJzIGNvbnRyaWJ1dGluZyBvbmUgcG9pbnQuIFBvaW50cyBpbiBsYXllcnMgd2l0aG91dCB0aW1lIG1ldGFkYXRhIC0tIGFuZCBwb2ludHNcbi8vIHdob3NlIHRpbWUgd2FzIHVucmVhZGFibGUgKE5hTikgLS0gZ2V0IGEgc3BhbiB0aGF0IGlzIHZpc2libGUgYXQgZXZlcnkgdGljay5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLCBwZXJpb2RNcykge1xuICAgIGxldCB0b3RhbCA9IDA7XG4gICAgbGV0IGhhc1RpbWUgPSBmYWxzZTtcbiAgICBjb25zdCBwZXJMYXllciA9IFtdO1xuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzTGlzdCkge1xuICAgICAgICBjb25zdCBidWYgPSBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF07XG4gICAgICAgIGNvbnN0IGNvdW50ID0gYnVmID8gYnVmLmJ5dGVMZW5ndGggLyAxNiA6IChsYXllci5sb2NhdGlvbiA/IDEgOiAwKTtcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG4gICAgICAgIGlmIChsYXllci50aW1lKSBoYXNUaW1lID0gdHJ1ZTtcbiAgICAgICAgcGVyTGF5ZXIucHVzaCh7IGxheWVyLCBjb3VudCwgdGltZXMgfSk7XG4gICAgICAgIHRvdGFsICs9IGNvdW50O1xuICAgIH1cbiAgICBpZiAoIWhhc1RpbWUpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XG5cbiAgICBsZXQgYmFzZSA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgeyB0aW1lcyB9IG9mIHBlckxheWVyKSB7XG4gICAgICAgIGlmICghdGltZXMpIGNvbnRpbnVlO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih0aW1lc1tpXSkgJiYgdGltZXNbaV0gPCBiYXNlKSBiYXNlID0gdGltZXNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcblxuICAgIGNvbnN0IHNwYW5zID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCAqIDIpO1xuICAgIGNvbnN0IGR1cnMgPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcbiAgICBjb25zdCBsYXllcklkeCA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwpO1xuICAgIGNvbnN0IGxheWVySWRzID0gW107XG4gICAgbGV0IG91dCA9IDA7XG4gICAgZm9yIChjb25zdCB7IGxheWVyLCBjb3VudCwgdGltZXMgfSBvZiBwZXJMYXllcikge1xuICAgICAgICBjb25zdCBpZHggPSBsYXllcklkcy5sZW5ndGg7XG4gICAgICAgIGxheWVySWRzLnB1c2gobGF5ZXIuaWQpO1xuICAgICAgICBjb25zdCBkdXIgPSBsYXllci50aW1lID8gZHVyYXRpb25TZWNvbmRzKGxheWVyLnRpbWUuZHVyYXRpb24sIHBlcmlvZE1zKSA6IEFMV0FZUztcbiAgICAgICAgLy8gVGhlIGZhZGUgZmxhZyByaWRlcyB0aGUgZHVyYXRpb24ncyBzaWduLCBzbyBpdCBjb3N0cyBubyBleHRyYSBhdHRyaWJ1dGUuXG4gICAgICAgIC8vIFRpbWVsZXNzIChOYU4pIHBvaW50cyBrZWVwIGEgcG9zaXRpdmUgZHVyYXRpb246IHdpdGggbm8gYWdlLCBub3RoaW5nIHRvIGZhZGUuXG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IHRpbWVzID8gdGltZXNbaSAqIDJdIDogTmFOO1xuICAgICAgICAgICAgY29uc3QgZW5kID0gdGltZXMgPyB0aW1lc1tpICogMiArIDFdIDogTmFOO1xuICAgICAgICAgICAgaWYgKE51bWJlci5pc05hTihzdGFydCkpIHtcbiAgICAgICAgICAgICAgICBzcGFuc1tvdXQgKiAyXSA9IC1BTFdBWVM7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gQUxXQVlTO1xuICAgICAgICAgICAgICAgIGR1cnNbb3V0XSA9IEFMV0FZUztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSAoc3RhcnQgLSBiYXNlKSAvIDEwMDA7XG4gICAgICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gKGVuZCAtIGJhc2UpIC8gMTAwMDtcbiAgICAgICAgICAgICAgICBkdXJzW291dF0gPSBzaWduZWREdXI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsYXllcklkeFtvdXRdID0gaWR4O1xuICAgICAgICAgICAgb3V0Kys7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgaGFzVGltZTogdHJ1ZSwgYmFzZSwgc3BhbnMsIGR1cnMsIGxheWVySWR4LCBsYXllcklkcywgY291bnQ6IHRvdGFsIH07XG59XG5cbi8vIFBlci1mZWF0dXJlIHRpbWUgbWV0YWRhdGEgZm9yIGEgdmVjdG9yIGJ1Y2tldCAobGluZXMvcG9seWdvbnMpOiBvbmUgZW50cnkgcGVyIGxheWVyLFxuLy8gc2luY2UgdGhvc2UgbGF5ZXJzIGhvbGQgZXhhY3RseSBvbmUgZ2VvbWV0cnkuIFNhbWUgZW5jb2RpbmdzIGFzIHRoZSBwb2ludCBwYXRoIC0tXG4vLyByZWJhc2VkIGZsb2F0MzIgc2Vjb25kcywgc2lnbi1wYWNrZWQgZmFkZSwgYWx3YXlzLXZpc2libGUgc3BhbnMgZm9yIHRpbWVsZXNzIG9yXG4vLyBub24tdGltZSBsYXllcnMuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZWN0b3JUaW1lTWV0YShsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgcGVyaW9kTXMpIHtcbiAgICBpZiAoIWxheWVyc0xpc3Quc29tZShsID0+IGwudGltZSkpIHJldHVybiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgbGV0IGJhc2UgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgdGltZXMgPSBsYXllci50aW1lID8gdGltZXNGb3IobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSA6IG51bGw7XG4gICAgICAgIGlmICh0aW1lcyAmJiAhTnVtYmVyLmlzTmFOKHRpbWVzWzBdKSAmJiB0aW1lc1swXSA8IGJhc2UpIGJhc2UgPSB0aW1lc1swXTtcbiAgICB9XG4gICAgaWYgKGJhc2UgPT09IEluZmluaXR5KSBiYXNlID0gMDtcblxuICAgIGNvbnN0IHBlckZlYXR1cmUgPSBsYXllcnNMaXN0Lm1hcCgobGF5ZXIsIGlkeCkgPT4ge1xuICAgICAgICBjb25zdCB0aW1lcyA9IGxheWVyLnRpbWUgPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcbiAgICAgICAgY29uc3QgZHVyID0gbGF5ZXIudGltZSA/IGR1cmF0aW9uU2Vjb25kcyhsYXllci50aW1lLmR1cmF0aW9uLCBwZXJpb2RNcykgOiBBTFdBWVM7XG4gICAgICAgIGNvbnN0IHNpZ25lZER1ciA9IGxheWVyLnRpbWUgJiYgbGF5ZXIudGltZS5mYWRlID8gLWR1ciA6IGR1cjtcbiAgICAgICAgaWYgKCF0aW1lcyB8fCBOdW1iZXIuaXNOYU4odGltZXNbMF0pKSB7XG4gICAgICAgICAgICByZXR1cm4geyBzdGFydDogLUFMV0FZUywgZW5kOiBBTFdBWVMsIGR1cjogQUxXQVlTLCBpZHggfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBzdGFydDogKHRpbWVzWzBdIC0gYmFzZSkgLyAxMDAwLCBlbmQ6ICh0aW1lc1sxXSAtIGJhc2UpIC8gMTAwMCxcbiAgICAgICAgICAgICAgICAgZHVyOiBzaWduZWREdXIsIGlkeCB9O1xuICAgIH0pO1xuICAgIHJldHVybiB7IGhhc1RpbWU6IHRydWUsIGJhc2UsIHBlckZlYXR1cmUsIGxheWVySWRzOiBsYXllcnNMaXN0Lm1hcChsID0+IGwuaWQpIH07XG59XG5cbi8vIEV4cGFuZHMgcGVyLWZlYXR1cmUgdmFsdWVzIHRvIHBlci1HTC12ZXJ0ZXggYXJyYXlzIGdpdmVuIGVhY2ggZmVhdHVyZSdzIHZlcnRleCBjb3VudC5cbi8vIFB1cmUsIHNvIHRoZSBhbGlnbm1lbnQgbG9naWMgaXMgdGllci0xIHRlc3RhYmxlIGF3YXkgZnJvbSBhbnkgR0wgY29udGV4dC5cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQZXJGZWF0dXJlKHBlckZlYXR1cmUsIGNvdW50cykge1xuICAgIGxldCB0b3RhbCA9IDA7XG4gICAgZm9yIChjb25zdCBjIG9mIGNvdW50cykgdG90YWwgKz0gYztcbiAgICBjb25zdCBzcGFucyA9IG5ldyBGbG9hdDMyQXJyYXkodG90YWwgKiAyKTtcbiAgICBjb25zdCBkdXJzID0gbmV3IEZsb2F0MzJBcnJheSh0b3RhbCk7XG4gICAgY29uc3QgbGF5ZXJJZHggPSBuZXcgRmxvYXQzMkFycmF5KHRvdGFsKTtcbiAgICBsZXQgb3V0ID0gMDtcbiAgICBwZXJGZWF0dXJlLmZvckVhY2goKGYsIGkpID0+IHtcbiAgICAgICAgZm9yIChsZXQgdiA9IDA7IHYgPCBjb3VudHNbaV07IHYrKykge1xuICAgICAgICAgICAgc3BhbnNbb3V0ICogMl0gPSBmLnN0YXJ0O1xuICAgICAgICAgICAgc3BhbnNbb3V0ICogMiArIDFdID0gZi5lbmQ7XG4gICAgICAgICAgICBkdXJzW291dF0gPSBmLmR1cjtcbiAgICAgICAgICAgIGxheWVySWR4W291dF0gPSBmLmlkeDtcbiAgICAgICAgICAgIG91dCsrO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIHsgc3BhbnMsIGR1cnMsIGxheWVySWR4IH07XG59XG5cbi8vIGdsaWZ5J3MgdmVydGV4IGxheW91dDogNiBmbG9hdHMgcGVyIEdMIHZlcnRleCAoeCwgeSwgciwgZywgYiwgYSksIGNvbmZpcm1lZCBmb3IgMy4zLjBcbi8vIGJvdGggYnkgcmVhZGluZyB0aGUgc291cmNlIGFuZCBieSB0aGUgVmFsaGFsbGEtVlJFIHJlcG9ydCdzIGRlYnVnIGR1bXAgLS0gdHdvXG4vLyBvbmUtc2VnbWVudCBsaW5lcyBwcm9kdWNlZCBhbGxWZXJ0aWNlc1R5cGVkIG9mIDI0IGZsb2F0czogMiBmZWF0dXJlcyB4IDIgdmVydGljZXMgeCA2LlxuY29uc3QgRkxPQVRTX1BFUl9WRVJURVggPSA2O1xuXG4vLyBXaXJlcyB0aW1lICsgbGF5ZXItdmlzaWJpbGl0eSBpbnRvIGEgbGl2ZSBnbGlmeSBMSU5FUyBvciBTSEFQRVMgaW5zdGFuY2UuIFRoZSBjYWxsZXJcbi8vIHN1cHBsaWVzIHBlci1mZWF0dXJlIEdMLXZlcnRleCBjb3VudHMgY29tcHV0ZWQgZnJvbSB0aGUgZ2VvbWV0cnkgaXQgYnVpbHQgaXRzZWxmOlxuLy8gbGluZXMgZHJhdyAyKihwb2ludHMtMSkgdmVydGljZXMgcGVyIGZlYXR1cmUsIGFuZCBhbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHNpbXBsZSByaW5nXG4vLyBoYXMgZXhhY3RseSBuLTIgdHJpYW5nbGVzIC0tIGEgcHJvcGVydHkgb2YgZ2VvbWV0cnksIG5vdCBvZiBnbGlmeSdzIGVhcmN1dC4gVGhlIGNvdW50c1xuLy8gYXJlIHZhbGlkYXRlZCBhZ2FpbnN0IHRoZSBpbnN0YW5jZSdzIGFjdHVhbCBidWZmZXIgbGVuZ3RoLCBhbmQgYW55IG1pc21hdGNoIGRpc2FibGVzXG4vLyB0aGUgdmVjdG9yIEdQVSBwYXRoIHJhdGhlciB0aGFuIG1pcy1hbGlnbmluZyBhdHRyaWJ1dGVzLlxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKGluc3RhbmNlLCBtZXRhLCBjb3VudHMpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY291bnRzKSB8fCBjb3VudHMubGVuZ3RoICE9PSBtZXRhLnBlckZlYXR1cmUubGVuZ3RoKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGV4cGVjdGVkICR7bWV0YS5wZXJGZWF0dXJlLmxlbmd0aH0gdmVydGV4IGNvdW50cywgYCArXG4gICAgICAgICAgICAgICAgYGdvdCAke2NvdW50cyAmJiBjb3VudHMubGVuZ3RofWApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGV4cGVjdGVkID0gY291bnRzLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApICogRkxPQVRTX1BFUl9WRVJURVg7XG4gICAgICAgIC8vIExpbmVzIGtlZXAgYSB0eXBlZCBmbGF0IGJ1ZmZlcjsgc2hhcGVzIGtlZXAgYSBwbGFpbiBmbGF0IGFycmF5LiBFaXRoZXIgaXMgdGhlXG4gICAgICAgIC8vIGdyb3VuZCB0cnV0aCBmb3IgaG93IG1hbnkgR0wgdmVydGljZXMgZ2xpZnkgYWN0dWFsbHkgYnVpbHQuXG4gICAgICAgIGNvbnN0IGFjdHVhbCA9IGluc3RhbmNlLmFsbFZlcnRpY2VzVHlwZWQgPyBpbnN0YW5jZS5hbGxWZXJ0aWNlc1R5cGVkLmxlbmd0aFxuICAgICAgICAgICAgOiAoQXJyYXkuaXNBcnJheShpbnN0YW5jZS52ZXJ0aWNlcykgPyBpbnN0YW5jZS52ZXJ0aWNlcy5sZW5ndGggOiAtMSk7XG4gICAgICAgIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHZlcnRleCBjb3VudCBtaXNtYXRjaDogZ2VvbWV0cnkgc2F5cyAke2V4cGVjdGVkfSBmbG9hdHMsIGAgK1xuICAgICAgICAgICAgICAgIGB0aGUgaW5zdGFuY2UgaG9sZHMgJHthY3R1YWx9YCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYXR0cnMgPSBleHBhbmRQZXJGZWF0dXJlKG1ldGEucGVyRmVhdHVyZSwgY291bnRzKTtcbiAgICAgICAgYXR0cnMuYmFzZSA9IG1ldGEuYmFzZTtcbiAgICAgICAgYXR0cnMubGF5ZXJJZHMgPSBtZXRhLmxheWVySWRzO1xuICAgICAgICByZXR1cm4gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycyk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGRpc2FibGVWZWN0b3JHcHUoZXJyLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbi8vIFdpcmVzIHRoZSBhdHRyaWJ1dGUgYnVmZmVycyBhbmQgdW5pZm9ybXMgaW50byBhIGxpdmUgZ2xpZnkgcG9pbnRzIGluc3RhbmNlLiBSZXR1cm5zIGFcbi8vIGhhbmRsZSB3aG9zZSBzZXRXaW5kb3cgY29zdHMgdHdvIHVuaWZvcm1zIGFuZCBhIHJlZHJhdywgb3IgbnVsbCBpZiBhbnl0aGluZyBhYm91dCB0aGVcbi8vIGluc3RhbmNlIGlzIG5vdCB3aGVyZSBnbGlmeSAzLjMuMCBrZWVwcyBpdCAtLSBpbiB3aGljaCBjYXNlIEdQVSB0aW1lIGlzIGRpc2FibGVkIGFuZFxuLy8gdGhlIGNhbGxlcidzIHJlYnVpbGQgcGF0aCB0YWtlcyBvdmVyLlxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaFRpbWVUb0luc3RhbmNlKGluc3RhbmNlLCBhdHRycykge1xuICAgIHRyeSB7XG4gICAgICAgIHJldHVybiB3aXJlVGltZUF0dHJpYnV0ZXMoaW5zdGFuY2UsIGF0dHJzKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgZGlzYWJsZUdwdVRpbWUoZXJyLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbi8vIFRoZSBjb21tb24gR0wgd2lyaW5nOiBidWZmZXJzIGZvciBzcGFuL2R1cmF0aW9uL2xheWVyIGF0dHJpYnV0ZXMsIHVuaWZvcm1zIGZvciB0aGVcbi8vIHRpY2ssIHRoZSBzaGFyZWQgb3ZlcnJpZGUgYW5kIHRoZSBwZXItbGF5ZXIgdmlzaWJpbGl0eSBzbG90cy4gVGhyb3dzIG9uIGFueXRoaW5nXG4vLyB1bmV4cGVjdGVkOyB0aGUgY2FsbGVycyBkZWNpZGUgd2hpY2ggZmFsbGJhY2sgZmxhZyB0aGF0IGZsaXBzLlxuZnVuY3Rpb24gd2lyZVRpbWVBdHRyaWJ1dGVzKGluc3RhbmNlLCBhdHRycykge1xuICAgIHtcbiAgICAgICAgY29uc3QgZ2wgPSBpbnN0YW5jZS5nbDtcbiAgICAgICAgY29uc3QgcHJvZ3JhbSA9IGluc3RhbmNlLnByb2dyYW07XG4gICAgICAgIGNvbnN0IGxheWVyID0gaW5zdGFuY2UubGF5ZXI7XG4gICAgICAgIGlmICghZ2wgfHwgIXByb2dyYW0gfHwgIWxheWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnN0YW5jZSBsYWNrcyBnbC9wcm9ncmFtL2xheWVyXCIpO1xuXG4gICAgICAgIGdsLnVzZVByb2dyYW0ocHJvZ3JhbSk7XG5cbiAgICAgICAgY29uc3Qgc3BhbkxvYyA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sIFwiYVRpbWVTcGFuXCIpO1xuICAgICAgICBjb25zdCBkdXJMb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFEdXJhdGlvblwiKTtcbiAgICAgICAgY29uc3QgbGF5ZXJMb2MgPSBnbC5nZXRBdHRyaWJMb2NhdGlvbihwcm9ncmFtLCBcImFMYXllclwiKTtcbiAgICAgICAgY29uc3QgdGlja0xvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVUaWNrXCIpO1xuICAgICAgICBjb25zdCBvdmVycmlkZUxvYyA9IGdsLmdldFVuaWZvcm1Mb2NhdGlvbihwcm9ncmFtLCBcInVPdmVycmlkZVwiKTtcbiAgICAgICAgLy8gU29tZSBkcml2ZXJzIG5hbWUgdGhlIGFycmF5IGhlYWQgXCJ1TGF5ZXJWaXNbMF1cIjsgYWNjZXB0IGVpdGhlci5cbiAgICAgICAgY29uc3QgdmlzTG9jID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHByb2dyYW0sIFwidUxheWVyVmlzXCIpXG4gICAgICAgICAgICB8fCBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgXCJ1TGF5ZXJWaXNbMF1cIik7XG4gICAgICAgIGlmIChzcGFuTG9jIDwgMCB8fCBkdXJMb2MgPCAwIHx8IGxheWVyTG9jIDwgMCB8fCAhdGlja0xvYyB8fCAhb3ZlcnJpZGVMb2MgfHwgIXZpc0xvYykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidGltZSBhdHRyaWJ1dGVzL3VuaWZvcm1zIG1pc3NpbmcgZnJvbSB0aGUgbGlua2VkIHByb2dyYW1cIik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzcGFuQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBzcGFuQnVmKTtcbiAgICAgICAgZ2wuYnVmZmVyRGF0YShnbC5BUlJBWV9CVUZGRVIsIGF0dHJzLnNwYW5zLCBnbC5TVEFUSUNfRFJBVyk7XG4gICAgICAgIGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoc3BhbkxvYywgMiwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkoc3BhbkxvYyk7XG5cbiAgICAgICAgY29uc3QgZHVyQnVmID0gZ2wuY3JlYXRlQnVmZmVyKCk7XG4gICAgICAgIGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBkdXJCdWYpO1xuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMuZHVycywgZ2wuU1RBVElDX0RSQVcpO1xuICAgICAgICBnbC52ZXJ0ZXhBdHRyaWJQb2ludGVyKGR1ckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkoZHVyTG9jKTtcblxuICAgICAgICBjb25zdCBsYXllckJ1ZiA9IGdsLmNyZWF0ZUJ1ZmZlcigpO1xuICAgICAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgbGF5ZXJCdWYpO1xuICAgICAgICBnbC5idWZmZXJEYXRhKGdsLkFSUkFZX0JVRkZFUiwgYXR0cnMubGF5ZXJJZHgsIGdsLlNUQVRJQ19EUkFXKTtcbiAgICAgICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihsYXllckxvYywgMSwgZ2wuRkxPQVQsIGZhbHNlLCAwLCAwKTtcbiAgICAgICAgZ2wuZW5hYmxlVmVydGV4QXR0cmliQXJyYXkobGF5ZXJMb2MpO1xuXG4gICAgICAgIC8vIFVudGlsIHRoZSBzbGlkZXIgc2F5cyBvdGhlcndpc2UsIGV2ZXJ5dGhpbmcgaXMgdmlzaWJsZSAtLSBpbiB0aW1lIEFORCBsYXllci5cbiAgICAgICAgZ2wudW5pZm9ybTFmKHRpY2tMb2MsIEFMV0FZUyk7XG4gICAgICAgIGdsLnVuaWZvcm0xZihvdmVycmlkZUxvYywgLTEpO1xuICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGxheWVySWRzOiBhdHRycy5sYXllcklkcyxcbiAgICAgICAgICAgIC8vIHRpY2tNcyBpbiBlcG9jaCBtczsgb3ZlcnJpZGVNcyBhIHNoYXJlZC13aW5kb3cgd2lkdGggb3IgbnVsbC5cbiAgICAgICAgICAgIHNldFdpbmRvdyh0aWNrTXMsIG92ZXJyaWRlTXMpIHtcbiAgICAgICAgICAgICAgICBnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xuICAgICAgICAgICAgICAgIGdsLnVuaWZvcm0xZih0aWNrTG9jLCB0aWNrTXMgPT09IG51bGwgPyBBTFdBWVMgOiAodGlja01zIC0gYXR0cnMuYmFzZSkgLyAxMDAwKTtcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWYob3ZlcnJpZGVMb2MsIG92ZXJyaWRlTXMgPT09IG51bGwgPyAtMSA6IG92ZXJyaWRlTXMgLyAxMDAwKTtcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBPbmUgZmxvYXQgcGVyIGxheWVyIHNsb3QsIGluIGF0dHJzLmxheWVySWRzIG9yZGVyLiBBIHNpZGViYXIgdG9nZ2xlIGxhbmRzXG4gICAgICAgICAgICAvLyBoZXJlIGluc3RlYWQgb2YgcmVidWlsZGluZyB0aGUgYnVja2V0LlxuICAgICAgICAgICAgc2V0TGF5ZXJWaXNpYmlsaXR5KHZpc0FycmF5KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdmlzID0gbmV3IEZsb2F0MzJBcnJheShMQVlFUl9TTE9UUykuZmlsbCgxKTtcbiAgICAgICAgICAgICAgICB2aXMuc2V0KHZpc0FycmF5LnNsaWNlKDAsIExBWUVSX1NMT1RTKSk7XG4gICAgICAgICAgICAgICAgZ2wudXNlUHJvZ3JhbShwcm9ncmFtKTtcbiAgICAgICAgICAgICAgICBnbC51bmlmb3JtMWZ2KHZpc0xvYywgdmlzKTtcbiAgICAgICAgICAgICAgICBsYXllci5yZWRyYXcoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgfVxufVxuIiwgImltcG9ydCB7IGxvYWRKUywgYmluZFBvcHVwLCBiaW5kVG9vbHRpcCwgcGFyc2VDb2xvciB9IGZyb20gXCIuL3V0aWxzLmpzXCI7XG5pbXBvcnQgeyBwaW5TaGFkZXIgfSBmcm9tIFwiLi9zaGFkZXJzLmpzXCI7XG5pbXBvcnQgeyB3aW5kb3dGb3IsIGZlYXR1cmVJbldpbmRvdywgdGltZXNGb3IsIGxheWVySW5XaW5kb3csIGVmZmVjdGl2ZUR1cmF0aW9uLFxuICAgICAgICAgcGVyaW9kVG9NcyB9IGZyb20gXCIuL3RpbWVjb250cm9sLmpzXCI7XG5pbXBvcnQgeyBidWlsZFRpbWVBdHRyaWJ1dGVzLCBhdHRhY2hUaW1lVG9JbnN0YW5jZSwgdGltZVZlcnRleFNoYWRlcixcbiAgICAgICAgIGdwdVRpbWVBdmFpbGFibGUsIGJ1aWxkVmVjdG9yVGltZU1ldGEsIGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlIH0gZnJvbSBcIi4vZ3B1dGltZS5qc1wiO1xuXG5mdW5jdGlvbiBzZXR1cEdsaWZ5UHJvamVjdGlvbihnbEluc3RhbmNlKSB7XG4gICAgaWYgKGdsSW5zdGFuY2UgJiYgZ2xJbnN0YW5jZS5sYXllcikge1xuICAgICAgICBnbEluc3RhbmNlLmxheWVyLl91bmNsYW1wZWRQcm9qZWN0ID0gZnVuY3Rpb24obGF0bG5nLCB6b29tKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLm9wdGlvbnMuY3JzLmxhdExuZ1RvUG9pbnQobGF0bG5nLCB6b29tKTtcbiAgICAgICAgfTtcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5yZWRyYXcoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5fY2xpY2tNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5fY2xpY2tNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9jbGlja1RpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2NsaWNrTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9jbGlja1RpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIHByaW9yaXR5LCBhY3Rpb24pIHtcbiAgICBpZiAoIW1hcC5faG92ZXJNYXRjaGVzKSB7XG4gICAgICAgIG1hcC5faG92ZXJNYXRjaGVzID0gW107XG4gICAgfVxuICAgIG1hcC5faG92ZXJNYXRjaGVzLnB1c2goeyBwcmlvcml0eSwgYWN0aW9uIH0pO1xuICAgIGlmICghbWFwLl9ob3ZlclRpbWVvdXQpIHtcbiAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEucHJpb3JpdHkgLSBiLnByaW9yaXR5KTtcbiAgICAgICAgICAgIGlmIChtYXAuX2hvdmVyTWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXNbMF0uYWN0aW9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xuICAgICAgICAgICAgbWFwLl9ob3ZlclRpbWVvdXQgPSBudWxsO1xuICAgICAgICB9LCAwKTtcbiAgICB9XG59XG5cbi8vIFN0eWxlIGZvciBvbmUgZmVhdHVyZTogaXRzIG93biBlbnRyeSBmcm9tIGBmZWF0dXJlX3N0eWxlc2Agd2hlbiB0aGUgbGF5ZXIgY2Fycmllc1xuLy8gdmFyaWVkIHN0eWxpbmcsIG90aGVyd2lzZSB0aGUgbGF5ZXIncyBzaW5nbGUgc3R5bGUuIFB5dGhvbiBvbmx5IGVtaXRzIGZlYXR1cmVfc3R5bGVzXG4vLyB3aGVuIGZlYXR1cmVzIGFjdHVhbGx5IGRpZmZlciwgc28gYSB1bmlmb3JtIGxheWVyIGNvc3RzIG5vdGhpbmcgZXh0cmEgaGVyZS5cbi8vIEZvdXIgc291cmNlcywgbGVhc3Qgc3BlY2lmaWMgZmlyc3QuIEVhY2ggdHJhbnNpZW50IG9uZSBsaXZlcyBpbiBpdHMgb3duIGZpZWxkIHJhdGhlclxuLy8gdGhhbiBlZGl0aW5nIHRoZSBsYXllcidzIHN0eWxlLCBzbyBjbGVhcmluZyBpdCByZXN0b3JlcyB3aGF0IHdhcyB1bmRlcm5lYXRoIHdpdGhcbi8vIG5vdGhpbmcgdG8gcmVtZW1iZXIgYW5kIG5vdGhpbmcgdG8gcHV0IGJhY2suXG4vL1xuLy8gICB0aGUgbGF5ZXIncyBvd24gc3R5bGUgICB3aGF0IGl0IHdhcyBkcmF3biB3aXRoXG4vLyAgIGZlYXR1cmVfc3R5bGVzW2ldICAgICAgIHBlciBmZWF0dXJlLCBmcm9tIHRoZSBkYXRhXG4vLyAgIGhpZ2hsaWdodF9zdHlsZSAgICAgICAgIHRoZSB3aG9sZSBsYXllciBpcyBzZWxlY3RlZFxuLy8gICBzdHlsZV9vdmVycmlkZXNbaV0gICAgICB0aGlzIGZlYXR1cmUgaXMgc2VsZWN0ZWQgLS0gbW9zdCBzcGVjaWZpYywgc28gaXQgd2luc1xuZXhwb3J0IGZ1bmN0aW9uIHN0eWxlRm9yKGxheWVyLCBpbmRleCkge1xuICAgIGNvbnN0IGZyb21EYXRhID0gQXJyYXkuaXNBcnJheShsYXllci5mZWF0dXJlX3N0eWxlcykgPyBsYXllci5mZWF0dXJlX3N0eWxlc1tpbmRleF0gOiBudWxsO1xuICAgIGNvbnN0IGhpZ2hsaWdodCA9IGxheWVyLmhpZ2hsaWdodF9zdHlsZTtcbiAgICBjb25zdCBzZWxlY3RlZCA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyAmJiBsYXllci5zdHlsZV9vdmVycmlkZXNbaW5kZXhdO1xuICAgIGlmICghZnJvbURhdGEgJiYgIWhpZ2hsaWdodCAmJiAhc2VsZWN0ZWQpIHJldHVybiBsYXllcjtcbiAgICByZXR1cm4geyAuLi5sYXllciwgLi4uKGZyb21EYXRhIHx8IHt9KSwgLi4uKGhpZ2hsaWdodCB8fCB7fSksIC4uLihzZWxlY3RlZCB8fCB7fSkgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEluZGV4ZWRQcm9wZXJ0aWVzKHByb3BlcnRpZXMsIGluZGV4KSB7XG4gICAgaWYgKCFwcm9wZXJ0aWVzKSByZXR1cm4ge307XG4gICAgY29uc3QgcHJvcHMgPSB7fTtcbiAgICBPYmplY3Qua2V5cyhwcm9wZXJ0aWVzKS5mb3JFYWNoKGsgPT4ge1xuICAgICAgICBjb25zdCB2YWwgPSBwcm9wZXJ0aWVzW2tdO1xuICAgICAgICBwcm9wc1trXSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbFtpbmRleF0gOiB2YWw7XG4gICAgfSk7XG4gICAgcmV0dXJuIHByb3BzO1xufVxuXG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkQnVmZmVyLCBtb2RlbCkge1xuICAgIGlmIChsYXllci50eXBlID09PSBcImdyb3VwXCIpIHtcbiAgICAgICAgY29uc3QgZ3JvdXAgPSBMLmxheWVyR3JvdXAoKTtcbiAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge307XG4gICAgICAgIGZvciAoY29uc3Qgc3ViIG9mIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgaWYgKHN1Yi50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgc3ViLnR5cGUgPT09IFwibWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcInBvbHlsaW5lXCIgfHwgc3ViLnR5cGUgPT09IFwicG9seWdvblwiIHx8IHN1Yi50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgc3ViLCBjb29yZGluYXRlQnVmZmVyc1tzdWIuaWRdLCBtb2RlbCk7XG4gICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICBncm91cC5hZGRMYXllcihpbnN0YW5jZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZ3JvdXAuYWRkVG8obWFwKTtcbiAgICAgICAgZ3JvdXAubGF5ZXJUeXBlID0gbGF5ZXIudHlwZTtcbiAgICAgICAgcmV0dXJuIGdyb3VwO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQSB2ZWN0b3IgbGF5ZXIncyBjb29yZGluYXRlczogdGhlIGJpbmFyeSBidWZmZXIgdW5kZXIgaXRzIGlkIHdoZW4gUHl0aG9uIGJ1aWx0IGl0XG4vLyAodGhlIGxheWVycyBKU09OIHRoZW4gY2FycmllcyBubyBjb29yZGluYXRlcyBhdCBhbGwpLCBvciBpbmxpbmUgYGxvY2F0aW9uc2AgZm9yXG4vLyBoYW5kLWJ1aWx0IGNvbmZpZ3MgYW5kIGZpeHR1cmVzLiBNYXRlcmlhbGlzZWQgb25seSBvbiByZWJ1aWxkLCB3aGljaCB2ZWN0b3IgYnVja2V0c1xuLy8gb24gdGhlIEdQVSBwYXRoIHJhcmVseSBkby5cbmZ1bmN0aW9uIHZlY3RvckNvb3JkcyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcbiAgICBpZiAobGF5ZXIubG9jYXRpb25zKSByZXR1cm4gbGF5ZXIubG9jYXRpb25zO1xuICAgIGNvbnN0IHJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZmxhdCA9IG5ldyBGbG9hdDY0QXJyYXkocmF3LmJ1ZmZlciB8fCByYXcsIHJhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgIChyYXcuYnl0ZUxlbmd0aCB8fCByYXcubGVuZ3RoKSAvIDgpO1xuICAgIGNvbnN0IG91dCA9IG5ldyBBcnJheShmbGF0Lmxlbmd0aCAvIDIpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb3V0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIG91dFtpXSA9IFtmbGF0W2kgKiAyXSwgZmxhdFtpICogMiArIDFdXTtcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbn1cblxuZnVuY3Rpb24gY2xvc2VSaW5nKHJpbmcpIHtcbiAgICBpZiAocmluZy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IGZpcnN0ID0gcmluZ1swXTtcbiAgICAgICAgY29uc3QgbGFzdCA9IHJpbmdbcmluZy5sZW5ndGggLSAxXTtcbiAgICAgICAgaWYgKGZpcnN0WzBdICE9PSBsYXN0WzBdIHx8IGZpcnN0WzFdICE9PSBsYXN0WzFdKSB7XG4gICAgICAgICAgICByaW5nLnB1c2goW2ZpcnN0WzBdLCBmaXJzdFsxXV0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiByaW5nO1xufVxuXG4vLyBBbiBhcmVhIGxheWVyJ3MgZ2VvbWV0cnkgYXMgcGFydHMgLT4gY2xvc2VkIFtsb24sIGxhdF0gcmluZ3M6IGEgcG9seWdvbidzIGZsYXRcbi8vIGNvb3JkaW5hdGUgcnVuIHNsaWNlZCBieSBpdHMgYHJpbmdzYCB0YWJsZSAob25lIGhvbGUtZnJlZSByaW5nIHdpdGhvdXQgaXQpLCBvciBhXG4vLyBjaXJjbGUncyBnZW5lcmF0ZWQgcmluZy4gRmVlZHMgYm90aCB0aGUgZmlsbCAoZWFyY3V0LCBpbiB0aGUgcG9seWdvbiBidWNrZXQpIGFuZFxuLy8gdGhlIG91dGxpbmUgKExpbmVTdHJpbmdzIGluIHRoZSBsaW5lcyBidWNrZXQpLlxuZnVuY3Rpb24gYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykge1xuICAgIGlmIChsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgIGNvbnN0IGxhdCA9IGxheWVyLmxvY2F0aW9uWzBdO1xuICAgICAgICBjb25zdCBsb24gPSBsYXllci5sb2NhdGlvblsxXTtcbiAgICAgICAgY29uc3QgcmFkaXVzTWV0ZXJzID0gbGF5ZXIucmFkaXVzIHx8IDEwO1xuICAgICAgICBjb25zdCBlYXJ0aFJhZGl1cyA9IDYzNzgxMzc7XG4gICAgICAgIGNvbnN0IHJpbmcgPSBbXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gMzI7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgYW5nbGUgPSAoaSAqIDM2MCkgLyAzMjtcbiAgICAgICAgICAgIGNvbnN0IGFuZ2xlUmFkID0gKGFuZ2xlICogTWF0aC5QSSkgLyAxODA7XG4gICAgICAgICAgICBjb25zdCBkTGF0ID0gKHJhZGl1c01ldGVycyAqIE1hdGguY29zKGFuZ2xlUmFkKSkgLyBlYXJ0aFJhZGl1cztcbiAgICAgICAgICAgIGNvbnN0IGRMb24gPSAocmFkaXVzTWV0ZXJzICogTWF0aC5zaW4oYW5nbGVSYWQpKSAvIChlYXJ0aFJhZGl1cyAqIE1hdGguY29zKChsYXQgKiBNYXRoLlBJKSAvIDE4MCkpO1xuICAgICAgICAgICAgcmluZy5wdXNoKFtsb24gKyAoZExvbiAqIDE4MCkgLyBNYXRoLlBJLCBsYXQgKyAoZExhdCAqIDE4MCkgLyBNYXRoLlBJXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFtbcmluZ11dO1xuICAgIH1cbiAgICBjb25zdCBsb2NzID0gdmVjdG9yQ29vcmRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycykgfHwgW107XG4gICAgY29uc3QgbG9ubGF0ID0gbG9jcy5tYXAoYyA9PiBbY1sxXSwgY1swXV0pO1xuICAgIGNvbnN0IHJpbmdUYWJsZSA9IGxheWVyLnJpbmdzIHx8IChsb25sYXQubGVuZ3RoID4gMCA/IFtbbG9ubGF0Lmxlbmd0aF1dIDogW10pO1xuICAgIGNvbnN0IHBhcnRzID0gW107XG4gICAgbGV0IGF0ID0gMDtcbiAgICBmb3IgKGNvbnN0IHBhcnRMZW5zIG9mIHJpbmdUYWJsZSkge1xuICAgICAgICBjb25zdCByaW5ncyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxlbiBvZiBwYXJ0TGVucykge1xuICAgICAgICAgICAgY29uc3QgcmluZyA9IGNsb3NlUmluZyhsb25sYXQuc2xpY2UoYXQsIGF0ICsgbGVuKSk7XG4gICAgICAgICAgICBhdCArPSBsZW47XG4gICAgICAgICAgICBpZiAocmluZy5sZW5ndGggPj0gNCkgcmluZ3MucHVzaChyaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmluZ3MubGVuZ3RoID4gMCkgcGFydHMucHVzaChyaW5ncyk7XG4gICAgfVxuICAgIHJldHVybiBwYXJ0cztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmRlck1lcmdlZEdsTGF5ZXIobWFwLCB0eXBlLCBsYXllcnNMaXN0LCBjb29yZGluYXRlQnVmZmVycywgbW9kZWwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZVN0YXRlID0gbnVsbCwgdmVjdG9yR3B1ID0gZmFsc2UpIHtcbiAgICAvLyBMaW5lcywgcG9seWdvbnMgYW5kIGNpcmNsZXMgYXJlIG9uZSBnZW9tZXRyeSBwZXIgbGF5ZXIuIE9uIHRoZSBHUFUgcGF0aCAobWFwLmpzXG4gICAgLy8gcGFzc2VzIHZlY3RvckdwdSB3aGVuIHRoZSBidWNrZXQgcXVhbGlmaWVzKSBldmVyeSBmZWF0dXJlIHN0YXlzIGluIHRoZSBidWZmZXJzIGFuZFxuICAgIC8vIHRoZSBzaGFkZXIgZGVjaWRlcyB2aXNpYmlsaXR5IHBlciB0aWNrIGFuZCBwZXIgbGF5ZXIgdG9nZ2xlIC0tIGEgbGluZS1zaGFwZWQgdHJhY2tcbiAgICAvLyBoYXMgYXMgbWFueSB2ZXJ0aWNlcyBhcyBhIHBvaW50IHRyYWNrIGhhcyBwb2ludHMsIHNvIGl0cyByZWJ1aWxkcyBjb3N0IHRoZSBzYW1lXG4gICAgLy8gYW5kIGNyYXNoZWQgdGhlIHNhbWUgd2F5LiBPZmYgdGhlIEdQVSBwYXRoLCB0aGUgd2hvbGUtZmVhdHVyZSBDUFUgZmlsdGVyIHJlbWFpbnMuXG4gICAgY29uc3QgdmVjdG9yTWV0YSA9IHZlY3RvckdwdSAmJiB0eXBlICE9PSBcImNpcmNsZV9tYXJrZXJzXCIgJiYgdHlwZSAhPT0gXCJtYXJrZXJzXCJcbiAgICAgICAgPyBidWlsZFZlY3RvclRpbWVNZXRhKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxuICAgICAgICAgICAgdGltZVN0YXRlICYmIHRpbWVTdGF0ZS5wZXJpb2QgPyBwZXJpb2RUb01zKHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbClcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgY29uc3QgdmVjdG9yVGltZSA9IEJvb2xlYW4odmVjdG9yTWV0YS5oYXNUaW1lKTtcbiAgICBpZiAodGltZVN0YXRlICYmICF2ZWN0b3JUaW1lICYmIHR5cGUgIT09IFwiY2lyY2xlX21hcmtlcnNcIiAmJiB0eXBlICE9PSBcIm1hcmtlcnNcIikge1xuICAgICAgICBsYXllcnNMaXN0ID0gbGF5ZXJzTGlzdC5maWx0ZXIobCA9PiBsYXllckluV2luZG93KGwsIGNvb3JkaW5hdGVCdWZmZXJzLCB0aW1lU3RhdGUpKTtcbiAgICAgICAgaWYgKGxheWVyc0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBjb25zdCB2ZXJ0ZXhDb3VudHMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgICAgICBjb25zdCBzdHlsZSA9IHN0eWxlRm9yKGxheWVyLCAwKTtcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcblxuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lczogYSBwb2x5Z29uIG9yIGNpcmNsZSBpbiB0aGlzIGJ1Y2tldCBjb250cmlidXRlcyBlYWNoIG9mIGl0c1xuICAgICAgICAgICAgLy8gcmluZ3MgYXMgb25lIExpbmVTdHJpbmcsIGRyYXduIHdpdGggdGhlIGFyZWEncyBzdHJva2Ugb3B0aW9ucyAtLSBjb2xvcixcbiAgICAgICAgICAgIC8vIHdlaWdodCwgb3BhY2l0eSwgTGVhZmxldCdzIG93biBzZW1hbnRpY3MuIE91dGxpbmUgd2VpZ2h0IGFuZCBvcGFjaXR5IG5ldmVyXG4gICAgICAgICAgICAvLyByZW5kZXJlZCBiZWZvcmUgdGhpczsgdGhlIGZpbGwgbWFjaGluZXJ5IGNhbm5vdCBkcmF3IHRoZW0gKGdsaWZ5J3MgYm9yZGVyXG4gICAgICAgICAgICAvLyBpcyAxcHggYW5kIGZpbGwtY29sb3VyZWQpLCB0aGUgbGluZXMgbWFjaGluZXJ5IGFscmVhZHkgZG9lcy5cbiAgICAgICAgICAgIGlmIChsYXllci50eXBlID09PSBcInBvbHlnb25cIiB8fCBsYXllci50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgbGV0IGNvdW50ID0gMDtcbiAgICAgICAgICAgICAgICBpZiAoKHN0eWxlLndlaWdodCA/PyAzKSA+IDAgJiYgKHN0eWxlLm9wYWNpdHkgPz8gMS4wKSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBhcmVhUGFydHMobGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCByaW5nIG9mIHJpbmdzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY291bnQgKz0gTWF0aC5tYXgoMCwgMiAqIChyaW5nLmxlbmd0aCAtIDEpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmZWF0dXJlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7IHR5cGU6IFwiTGluZVN0cmluZ1wiLCBjb29yZGluYXRlczogcmluZyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogeyByOiByZ2IuciwgZzogcmdiLmcsIGI6IHJnYi5iLCBhOiBzdHlsZS5vcGFjaXR5IHx8IDEuMCB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBzdHlsZS53ZWlnaHQgfHwgM1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goY291bnQpOyAgIC8vIDAga2VlcHMgdGhlIHNsb3QgYWxpZ25lZCB3aGVuIHN0cm9rZWxlc3NcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgbG9jcyA9IHZlY3RvckNvb3JkcyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIHx8IFtdO1xuICAgICAgICAgICAgY29uc3QgZ2VvanNvbkNvb3JkcyA9IGxvY3MubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICAgICAgICAgIHZlcnRleENvdW50cy5wdXNoKE1hdGgubWF4KDAsIDIgKiAoZ2VvanNvbkNvb3Jkcy5sZW5ndGggLSAxKSkpO1xuICAgICAgICAgICAgZmVhdHVyZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlXCIsXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJMaW5lU3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvb3JkaW5hdGVzOiBnZW9qc29uQ29vcmRzXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogc3R5bGUub3BhY2l0eSB8fCAxLjAgfSxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBzdHlsZS53ZWlnaHQgfHwgM1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZlYXR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgY29uc3QgZ2VvanNvbiA9IHtcbiAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZUNvbGxlY3Rpb25cIixcbiAgICAgICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlc1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XG4gICAgICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX21hcCA9IG07XG4gICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIgPSAoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgbS5vbihcIm1vdXNlbW92ZVwiLCB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGxpbmVPcHRpb25zID0gdmVjdG9yVGltZVxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xuICAgICAgICAgICAgICAgIHRoaXMuZ2xMaW5lcyA9IEwuZ2xpZnkubGluZXMoe1xuICAgICAgICAgICAgICAgICAgICAuLi5saW5lT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlsaW5lc1BhbmVcIixcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGRhdGEgYWJvdmUgaXMgR2VvSlNPTiwgd2hvc2UgY29vcmRpbmF0ZXMgYXJlIFtsb24sIGxhdF07IGdsaWZ5XG4gICAgICAgICAgICAgICAgICAgIC8vIGRlZmF1bHRzIHRvIGxhdGl0dWRlLWZpcnN0IGFuZCBpdHMgTElORSB2ZXJ0ZXggYnVpbGRlciByZWFkc1xuICAgICAgICAgICAgICAgICAgICAvLyBjb29yZGluYXRlcyB0aHJvdWdoIHRoZXNlIGtleXMgLS0gdW5zZXQsIGl0IHRvb2sgbG9uZ2l0dWRlIGFzXG4gICAgICAgICAgICAgICAgICAgIC8vIGxhdGl0dWRlIGFuZCBwcm9qZWN0ZWQgZXZlcnkgbGluZSBvZmYtdmlld3BvcnQuIFNpbGVudGx5OiBubyBHTFxuICAgICAgICAgICAgICAgICAgICAvLyBlcnJvciwgYSBoZWFsdGh5IGNhbnZhcywgemVybyBmcmFnbWVudHMuIFNldCBwZXIgaW5zdGFuY2UgcmF0aGVyXG4gICAgICAgICAgICAgICAgICAgIC8vIHRoYW4gb24gdGhlIEwuZ2xpZnkgZ2xvYmFsLCB3aGljaCBhbm90aGVyIGxpYnJhcnkgY291bGQgYWxzb1xuICAgICAgICAgICAgICAgICAgICAvLyBtdXRhdGUuIFRoZSBwb2x5Z29uIHBhdGggaXMgZGVsaWJlcmF0ZWx5IE5PVCBnaXZlbiB0aGVzZSBrZXlzOlxuICAgICAgICAgICAgICAgICAgICAvLyBpdCB0cmlhbmd1bGF0ZXMgdmlhIGVhcmN1dCBvbiB0aGUgR2VvSlNPTiBkaXJlY3RseSwgbmF0aXZlXG4gICAgICAgICAgICAgICAgICAgIC8vIFtsb24sIGxhdF0sIGFuZCBrZXlzIHRoZXJlIHdvdWxkIHRyYW5zcG9zZSBpdCB0aGUgc2FtZSB3YXkuXG4gICAgICAgICAgICAgICAgICAgIC8vIEZvdW5kIGJ5IHRoZSBWYWxoYWxsYS1WUkUgYnVnIHJlcG9ydCwgZHJpdmluZyB0aGUgcGxhaW4tSlNcbiAgICAgICAgICAgICAgICAgICAgLy8gYnVuZGxlIHdoZXJlIG5vIHBvaW50cyBtYXNrZWQgdGhlIGJsYW5rIGxpbmVzLlxuICAgICAgICAgICAgICAgICAgICBsYXRpdHVkZUtleTogMSxcbiAgICAgICAgICAgICAgICAgICAgbG9uZ2l0dWRlS2V5OiAwLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy53ZWlnaHQ7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXR0ZW4gYmFyZTogc2hpbnl3aWRnZXRzJyBtb2RlbCBoYXMgbm8gYGNvbW1gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHByb3BlcnR5LCBzbyBnYXRpbmcgb24gaXQgc2lsZW50bHkga2lsbGVkIHRoaXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd3JpdGViYWNrIHVuZGVyIFNoaW55LiBUaGUgc2lkZWJhciBhbHdheXMgd3JvdGUgYmFyZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgd2FzIHRoZSBvbmUgcGF0aCB0aGF0IHdvcmtlZCB0aGVyZS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwic2VsZWN0ZWRfaW5kZXhcIiwgMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbExpbmVzKTtcbiAgICAgICAgICAgICAgICBpZiAodmVjdG9yVGltZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9WZWN0b3JJbnN0YW5jZSh0aGlzLmdsTGluZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsTGluZXMpIHRoaXMuZ2xMaW5lcy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgICAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09IFwicG9seWdvblwiKSB7XG4gICAgICAgIGNvbnN0IGZlYXR1cmVzID0gW107XG4gICAgICAgIGNvbnN0IHZlcnRleENvdW50cyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gYXJlYVBhcnRzKGxheWVyLCBjb29yZGluYXRlQnVmZmVycyk7XG4gICAgICAgICAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMCk7ICAgLy8gbm8gZmVhdHVyZSwgYnV0IHRoZSBzbG90IG11c3Qgc3RheSBhbGlnbmVkXG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBBbnkgdHJpYW5ndWxhdGlvbiBvZiBhIHBvbHlnb24gd2l0aCBEIGRpc3RpbmN0IHZlcnRpY2VzIGFuZCBoIGhvbGVzIGhhc1xuICAgICAgICAgICAgLy8gZXhhY3RseSBEICsgMmggLSAyIHRyaWFuZ2xlcyAtLSBhIHByb3BlcnR5IG9mIGdlb21ldHJ5LCBub3Qgb2YgZ2xpZnknc1xuICAgICAgICAgICAgLy8gZWFyY3V0OyBoID0gMCBnaXZlcyB0aGUgZmFtaWxpYXIgRCAtIDIuIFJpbmdzIGFyZSBjbG9zZWQgYnkgbm93LCBzbyBlYWNoXG4gICAgICAgICAgICAvLyBjb250cmlidXRlcyBsZW5ndGggLSAxIGRpc3RpbmN0IHZlcnRpY2VzLiBQYXJ0cyB0cmlhbmd1bGF0ZSBzZXBhcmF0ZWx5XG4gICAgICAgICAgICAvLyAoZ2xpZnkgZXhwbG9kZXMgYSBNdWx0aVBvbHlnb24gaW50byBwZXItcGFydCBkcmF3cykgYW5kIHN1bS5cbiAgICAgICAgICAgIGxldCB0cmlhbmdsZXMgPSAwO1xuICAgICAgICAgICAgZm9yIChjb25zdCByaW5ncyBvZiBwYXJ0cykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGRpc3RpbmN0ID0gcmluZ3MucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIubGVuZ3RoIC0gMSwgMCk7XG4gICAgICAgICAgICAgICAgdHJpYW5nbGVzICs9IE1hdGgubWF4KDAsIGRpc3RpbmN0ICsgMiAqIChyaW5ncy5sZW5ndGggLSAxKSAtIDIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmVydGV4Q291bnRzLnB1c2goMyAqIHRyaWFuZ2xlcyk7XG5cbiAgICAgICAgICAgIGNvbnN0IHN0eWxlID0gc3R5bGVGb3IobGF5ZXIsIDApO1xuICAgICAgICAgICAgLy8gTGVhZmxldCdzIG93biBzZW1hbnRpY3M6IHRoZSBmaWxsIGlzIGZpbGxDb2xvciwgZGVmYXVsdGluZyB0byB0aGUgc3Ryb2tlXG4gICAgICAgICAgICAvLyBjb2xvciB3aGVuIHVuc2V0LiBJdCB1c2VkIHRvIGFsd2F5cyBmaWxsIHdpdGggYGNvbG9yYCwgd2hpY2ggbWFkZVxuICAgICAgICAgICAgLy8gXCJyZWQgb3V0bGluZSwgcGFsZSBibHVlIGZpbGxcIiAtLSB0aGUgbW9zdCBiYXNpYyBwb2x5Z29uIHN0eWxpbmcgYXNrIC0tXG4gICAgICAgICAgICAvLyBpbXBvc3NpYmxlOyB0aGUgb3V0bGluZSBpdHNlbGYgaXMgZHJhd24gYnkgdGhlIGxpbmVzIGJ1Y2tldC5cbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3Ioc3R5bGUuZmlsbENvbG9yIHx8IHN0eWxlLmZpbGxfY29sb3IgfHwgc3R5bGUuY29sb3IsIFwiIzMzODhmZlwiKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBwYXJ0cy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgICAgICAgICAgPyB7IHR5cGU6IFwiUG9seWdvblwiLCBjb29yZGluYXRlczogcGFydHNbMF0gfVxuICAgICAgICAgICAgICAgICAgICA6IHsgdHlwZTogXCJNdWx0aVBvbHlnb25cIiwgY29vcmRpbmF0ZXM6IHBhcnRzIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IHN0eWxlLmZpbGxPcGFjaXR5IHx8IDAuMiB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgICAgICBjb25zdCBnZW9qc29uID0ge1xuICAgICAgICAgICAgdHlwZTogXCJGZWF0dXJlQ29sbGVjdGlvblwiLFxuICAgICAgICAgICAgZmVhdHVyZXM6IGZlYXR1cmVzXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgZ2xMYXllciA9IEwuTGF5ZXIuZXh0ZW5kKHtcbiAgICAgICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hhcGVPcHRpb25zID0gdmVjdG9yVGltZVxuICAgICAgICAgICAgICAgICAgICA/IHsgdmVydGV4U2hhZGVyU291cmNlOiAoKSA9PiB0aW1lVmVydGV4U2hhZGVyKCkgfSA6IHt9O1xuICAgICAgICAgICAgICAgIHRoaXMuZ2xTaGFwZXMgPSBMLmdsaWZ5LnNoYXBlcyh7XG4gICAgICAgICAgICAgICAgICAgIC4uLnNoYXBlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlnb25zUGFuZVwiLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmVhdHVyZS5wcm9wZXJ0aWVzLmNvbG9yUkdCO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXcml0dGVuIGJhcmU6IHNoaW55d2lkZ2V0cycgbW9kZWwgaGFzIG5vIGBjb21tYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm9wZXJ0eSwgc28gZ2F0aW5nIG9uIGl0IHNpbGVudGx5IGtpbGxlZCB0aGlzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdyaXRlYmFjayB1bmRlciBTaGlueS4gVGhlIHNpZGViYXIgYWx3YXlzIHdyb3RlIGJhcmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYW5kIHdhcyB0aGUgb25lIHBhdGggdGhhdCB3b3JrZWQgdGhlcmUuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBob3ZlcjogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzICYmIGZlYXR1cmUucHJvcGVydGllcy5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDMsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgZS5sYXRsbmcsIGxheWVyLnByb3BlcnRpZXMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHNldHVwR2xpZnlQcm9qZWN0aW9uKHRoaXMuZ2xTaGFwZXMpO1xuICAgICAgICAgICAgICAgIGlmICh2ZWN0b3JUaW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3N3aWZ0bWFwVGltZSA9IGF0dGFjaFRpbWVUb1ZlY3Rvckluc3RhbmNlKHRoaXMuZ2xTaGFwZXMsIHZlY3Rvck1ldGEsIHZlcnRleENvdW50cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbS5vZmYoXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmdsU2hhcGVzKSB0aGlzLmdsU2hhcGVzLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9zaGFyZWRUb29sdGlwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBnbExheWVyKCk7XG4gICAgICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgICAgIGluc3RhbmNlLmxheWVyVHlwZSA9IHR5cGU7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG5cbiAgICBjb25zdCBwb2ludHNMaXN0ID0gW107XG4gICAgY29uc3QgaW5kZXhNYXBwaW5nID0gW107XG5cbiAgICBjb25zdCBmYWxsYmFja0NvbG9yID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiO1xuICAgIC8vIGdsaWZ5J3MgZmFsbGJhY2sgd2hlbiBhIGxheWVyIGRlY2xhcmVzIG5vIHJhZGl1cy4gUGlucyBuZWVkIGZhciBtb3JlIHJvb20gdGhhbiBhXG4gICAgLy8gY2lyY2xlIGJlY2F1c2UgdGhlIGdseXBoIGlzIGRyYXduIGluc2lkZSB0aGUgcG9pbnQncyBvd24gcXVhZCBieSB0aGUgc2hhZGVyLlxuICAgIGNvbnN0IGRlZmF1bHRTaXplID0gdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyA2NCA6IDU7XG5cbiAgICAvLyBHUFUgdGltZSBwYXRoOiB3aGVuIHRoaXMgYnVja2V0IGhvbGRzIHRpbWUgbGF5ZXJzLCBldmVyeSBwb2ludCBpcyBmZWQgdG8gZ2xpZnkgYW5kXG4gICAgLy8gcGVyLXBvaW50IHRpbWUgcmlkZXMgYWxvbmcgYXMgdmVydGV4IGF0dHJpYnV0ZXMgLS0gdGhlIHdpbmRvdyB0ZXN0IGhhcHBlbnMgaW4gdGhlXG4gICAgLy8gdmVydGV4IHNoYWRlciwgc28gYSB0aWNrIGNvc3RzIHR3byB1bmlmb3JtcyBpbnN0ZWFkIG9mIHJlYnVpbGRpbmcgNU0gcG9pbnRzIGluIEpTLlxuICAgIC8vIFRoZSBDUFUgZmlsdGVyIGJlbG93IHN0YXlzIGFzIHRoZSBmYWxsYmFjayB3aGVuIHRoZSBHTCB3aXJpbmcgaXMgdW5hdmFpbGFibGUuXG4gICAgY29uc3QgZ3B1QXR0cnMgPSBncHVUaW1lQXZhaWxhYmxlKClcbiAgICAgICAgPyBidWlsZFRpbWVBdHRyaWJ1dGVzKGxheWVyc0xpc3QsIGNvb3JkaW5hdGVCdWZmZXJzLFxuICAgICAgICAgICAgdGltZVN0YXRlICYmIHRpbWVTdGF0ZS5wZXJpb2QgPyBwZXJpb2RUb01zKHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbClcbiAgICAgICAgOiB7IGhhc1RpbWU6IGZhbHNlIH07XG4gICAgY29uc3QgZ3B1VGltZSA9IEJvb2xlYW4oZ3B1QXR0cnMuaGFzVGltZSk7XG5cbiAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgY29uc3QgY29sb3JSR0IgPSBwYXJzZUNvbG9yKGxheWVyLmNvbG9yLCBmYWxsYmFja0NvbG9yKTtcbiAgICAgICAgY29uc3QgbGF5ZXJTaXplID0gbGF5ZXIucmFkaXVzICE9IG51bGwgPyBOdW1iZXIobGF5ZXIucmFkaXVzKSA6IGRlZmF1bHRTaXplO1xuXG4gICAgICAgIGNvbnN0IGNvb3JkQnVmZmVyID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbGF5ZXIuaWRdO1xuICAgICAgICBpZiAoIWNvb3JkQnVmZmVyKSB7XG4gICAgICAgICAgICBpZiAobGF5ZXIubG9jYXRpb24gJiYgbGF5ZXJJbldpbmRvdyhsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMsIHRpbWVTdGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2xheWVyLmxvY2F0aW9uWzBdLCBsYXllci5sb2NhdGlvblsxXV0pO1xuICAgICAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEluZGV4OiAwLFxuICAgICAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3JSR0IsXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IGxheWVyU2l6ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb29yZHMgPSBuZXcgRmxvYXQ2NEFycmF5KFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnVmZmVyLFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZU9mZnNldCxcbiAgICAgICAgICAgIGNvb3JkQnVmZmVyLmJ5dGVMZW5ndGggLyA4XG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGNvdW50ID0gY29vcmRzLmxlbmd0aCAvIDI7XG5cbiAgICAgICAgY29uc3QgcGVyRmVhdHVyZSA9IEFycmF5LmlzQXJyYXkobGF5ZXIuZmVhdHVyZV9zdHlsZXMpID8gbGF5ZXIuZmVhdHVyZV9zdHlsZXMgOiBudWxsO1xuICAgICAgICAvLyBTZWxlY3Rpb24gc3R5bGluZywgYXBwbGllZCBvdmVyIHRoZSBsYXllcidzIG93biBhbmQgaXRzIGRhdGEtZHJpdmVuIHN0eWxlcy5cbiAgICAgICAgLy8gU2FtZSBwcmVjZWRlbmNlIGFzIHN0eWxlRm9yOiBkYXRhLCB0aGVuIHdob2xlLWxheWVyIGhpZ2hsaWdodCwgdGhlbiBwZXItZmVhdHVyZS5cbiAgICAgICAgY29uc3QgaGlnaGxpZ2h0ID0gbGF5ZXIuaGlnaGxpZ2h0X3N0eWxlIHx8IG51bGw7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlcyA9IGxheWVyLnN0eWxlX292ZXJyaWRlcyB8fCBudWxsO1xuICAgICAgICAvLyBEYXRhLWRyaXZlbiBzdHlsaW5nIGFycml2ZXMgYXMgYmluYXJ5IGJ1ZmZlcnMgYmVzaWRlIHRoZSBjb29yZGluYXRlcyAtLVxuICAgICAgICAvLyB1OCBSR0JBIHVuZGVyIFwiPGlkPjo6Y29sb3JzXCIsIGYzMiBwaXhlbHMgdW5kZXIgXCI8aWQ+OjpyYWRpaVwiIC0tIGNvbXB1dGVkXG4gICAgICAgIC8vIGluIFB5dGhvbiBmcm9tIGNvbG9yX2NvbC9yYWRpdXNfY29sLiBCdWZmZXJzLCBuZXZlciBwZXItZmVhdHVyZSBzdHlsZVxuICAgICAgICAvLyBkaWN0czogYXQgbWlsbGlvbnMgb2YgcG9pbnRzLCBzdHlsZSBkaWN0cyBpbiB0aGUgbGF5ZXJzIEpTT04gYXJlIHRoZVxuICAgICAgICAvLyBwYXlsb2FkIHRoYXQgdXNlZCB0byBraWxsIHNlc3Npb25zLiBFeHBsaWNpdCBzdHlsZXMgc3RpbGwgb3V0cmFuayB0aGVtLlxuICAgICAgICBjb25zdCBjb2xvcnNSYXcgPSBjb29yZGluYXRlQnVmZmVyc1tgJHtsYXllci5pZH06OmNvbG9yc2BdO1xuICAgICAgICBjb25zdCBidWZDb2xvcnMgPSBjb2xvcnNSYXdcbiAgICAgICAgICAgID8gbmV3IFVpbnQ4QXJyYXkoY29sb3JzUmF3LmJ1ZmZlciB8fCBjb2xvcnNSYXcsIGNvbG9yc1Jhdy5ieXRlT2Zmc2V0IHx8IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yc1Jhdy5ieXRlTGVuZ3RoKVxuICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICBjb25zdCByYWRpaVJhdyA9IGNvb3JkaW5hdGVCdWZmZXJzW2Ake2xheWVyLmlkfTo6cmFkaWlgXTtcbiAgICAgICAgY29uc3QgYnVmUmFkaWkgPSByYWRpaVJhd1xuICAgICAgICAgICAgPyBuZXcgRmxvYXQzMkFycmF5KHJhZGlpUmF3LmJ1ZmZlciB8fCByYWRpaVJhdywgcmFkaWlSYXcuYnl0ZU9mZnNldCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJhZGlpUmF3LmJ5dGVMZW5ndGggLyA0KVxuICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICAvLyBUaGUgY3VycmVudCB0aW1lIHdpbmRvdywgd2hlbiB0aGlzIGxheWVyIGlzIGFuaW1hdGVkLiBGZWF0dXJlcyBvdXRzaWRlIGl0IGFyZVxuICAgICAgICAvLyBzaW1wbHkgbm90IHB1c2hlZDsgaW5kZXhNYXBwaW5nIGNhcnJpZXMgb3JpZ2luYWxJbmRleCwgc28gcG9wdXBzIGFuZCBwcm9wZXJ0aWVzXG4gICAgICAgIC8vIG9uIHRoZSBzdXJ2aXZvcnMga2VlcCBwb2ludGluZyBhdCB0aGUgcmlnaHQgcm93cy5cbiAgICAgICAgY29uc3Qgd2luID0gIWdwdVRpbWUgJiYgdGltZVN0YXRlICYmIGxheWVyLnRpbWVcbiAgICAgICAgICAgID8gd2luZG93Rm9yKHRpbWVTdGF0ZS50aWNrLCBlZmZlY3RpdmVEdXJhdGlvbihsYXllciwgdGltZVN0YXRlKSwgdGltZVN0YXRlLnBlcmlvZClcbiAgICAgICAgICAgIDogbnVsbDtcbiAgICAgICAgY29uc3QgdGltZXMgPSB3aW4gPyB0aW1lc0ZvcihsYXllciwgY29vcmRpbmF0ZUJ1ZmZlcnMpIDogbnVsbDtcblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0aW1lcyAmJiAhZmVhdHVyZUluV2luZG93KHRpbWVzW2kgKiAyXSwgdGltZXNbaSAqIDIgKyAxXSwgd2luKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBmcm9tRGF0YSA9IHBlckZlYXR1cmUgPyBwZXJGZWF0dXJlW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gb3ZlcnJpZGVzID8gb3ZlcnJpZGVzW2ldIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gKHNlbGVjdGVkICYmIHNlbGVjdGVkLmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChoaWdobGlnaHQgJiYgaGlnaGxpZ2h0LmNvbG9yKVxuICAgICAgICAgICAgICAgIHx8IChmcm9tRGF0YSAmJiBmcm9tRGF0YS5jb2xvcik7XG4gICAgICAgICAgICBjb25zdCByYWRpdXMgPSBzZWxlY3RlZCAmJiBzZWxlY3RlZC5yYWRpdXMgIT0gbnVsbCA/IHNlbGVjdGVkLnJhZGl1c1xuICAgICAgICAgICAgICAgIDogaGlnaGxpZ2h0ICYmIGhpZ2hsaWdodC5yYWRpdXMgIT0gbnVsbCA/IGhpZ2hsaWdodC5yYWRpdXNcbiAgICAgICAgICAgICAgICA6IGZyb21EYXRhICYmIGZyb21EYXRhLnJhZGl1cyAhPSBudWxsID8gZnJvbURhdGEucmFkaXVzXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICBwb2ludHNMaXN0LnB1c2goW2Nvb3Jkc1tpICogMl0sIGNvb3Jkc1tpICogMiArIDFdXSk7XG4gICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XG4gICAgICAgICAgICAgICAgbGF5ZXI6IGxheWVyLFxuICAgICAgICAgICAgICAgIG9yaWdpbmFsSW5kZXg6IGksXG4gICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yID8gcGFyc2VDb2xvcihjb2xvciwgZmFsbGJhY2tDb2xvcilcbiAgICAgICAgICAgICAgICAgICAgOiBidWZDb2xvcnMgPyB7IHI6IGJ1ZkNvbG9yc1tpICogNF0gLyAyNTUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnOiBidWZDb2xvcnNbaSAqIDQgKyAxXSAvIDI1NSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGI6IGJ1ZkNvbG9yc1tpICogNCArIDJdIC8gMjU1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYTogYnVmQ29sb3JzW2kgKiA0ICsgM10gLyAyNTUgfVxuICAgICAgICAgICAgICAgICAgICA6IGNvbG9yUkdCLFxuICAgICAgICAgICAgICAgIHNpemU6IHJhZGl1cyAhPSBudWxsID8gTnVtYmVyKHJhZGl1cylcbiAgICAgICAgICAgICAgICAgICAgOiBidWZSYWRpaSA/IGJ1ZlJhZGlpW2ldXG4gICAgICAgICAgICAgICAgICAgIDogbGF5ZXJTaXplXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb2ludHNMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICBvbkFkZDogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgdGhpcy5fbWFwID0gbTtcbiAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3QgZ2V0SW50ZXJhY3RpdmVFbCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWFwLmdldFBhbmUoXCJwb2ludHNQYW5lXCIpLnF1ZXJ5U2VsZWN0b3IoXCJjYW52YXNcIikgfHwgbWFwLmdldENvbnRhaW5lcigpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlciA9IChlKSA9PiB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5faXNIb3ZlcmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZWwgPSBnZXRJbnRlcmFjdGl2ZUVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBtLm9uKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuXG4gICAgICAgICAgICBjb25zdCBnbGlmeU9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgIGRhdGE6IHBvaW50c0xpc3QsXG4gICAgICAgICAgICAgICAgcGFuZTogXCJwb2ludHNQYW5lXCIsXG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZWQgcGVyIHBvaW50LCBsaWtlIGNvbG91cjogc2V2ZXJhbCBsYXllcnMgc2hhcmUgb25lIGdsaWZ5IGluc3RhbmNlLFxuICAgICAgICAgICAgICAgIC8vIHNvIGEgc2luZ2xlIGNvbnN0YW50IGhlcmUgc2lsZW50bHkgZGlzY2FyZGVkIGV2ZXJ5IGxheWVyJ3Mgb3duIHJhZGl1cy5cbiAgICAgICAgICAgICAgICBzaXplOiAoaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpbmRleF07XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvICYmIGluZm8uc2l6ZSAhPSBudWxsID8gaW5mby5zaXplIDogZGVmYXVsdFNpemU7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gPyBpbmZvLmNvbG9yUkdCIDogeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlbnNpdGl2aXR5OiB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDIwIDogOCxcbiAgICAgICAgICAgICAgICBjbGljazogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHBvcHVwcyBvbiBmYXIgYXdheSBjbGlja3NcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gY2xpY2tQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7IC8qIG5vIGxpdmUgYmFja2VuZCAqLyB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaG92ZXI6IChlLCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBvaW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHRvb2x0aXBzIG9uIGZhciBhd2F5IGhvdmVyc1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaG92ZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtlclBvaW50ID0gbWFwLmxhdExuZ1RvQ29udGFpbmVyUG9pbnQoTC5sYXRMbmcocG9pbnRbMF0sIHBvaW50WzFdKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwaXhlbERpc3QgPSBob3ZlclBvaW50LmRpc3RhbmNlVG8obWFya2VyUG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaXhlbERpc3QgPiBtYXhEaXN0KSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVySG92ZXJNYXRjaChtYXAsIDEsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsID0gZ2V0SW50ZXJhY3RpdmVFbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHBvaW50c0xpc3QuaW5kZXhPZihwb2ludCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gaW5mby5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBnZXRJbmRleGVkUHJvcGVydGllcyhsYXllci5wcm9wZXJ0aWVzLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBwb2ludCwgcHJvcHMsIGxheWVyLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmICh0eXBlID09PSBcIm1hcmtlcnNcIikge1xuICAgICAgICAgICAgICAgIGdsaWZ5T3B0aW9ucy5mcmFnbWVudFNoYWRlclNvdXJjZSA9ICgpID0+IHBpblNoYWRlcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGdwdVRpbWUpIHtcbiAgICAgICAgICAgICAgICBnbGlmeU9wdGlvbnMudmVydGV4U2hhZGVyU291cmNlID0gKCkgPT4gdGltZVZlcnRleFNoYWRlcigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5nbFBvaW50cyA9IEwuZ2xpZnkucG9pbnRzKGdsaWZ5T3B0aW9ucyk7XG4gICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsUG9pbnRzKTtcbiAgICAgICAgICAgIGlmIChncHVUaW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gTnVsbCBvbiBmYWlsdXJlLCB3aGljaCBhbHNvIGZsaXBzIHRoZSBnbG9iYWwgZmxhZzogdGhlIG5leHQgc3luYydzXG4gICAgICAgICAgICAgICAgLy8gcmVidWlsZCBrZXkgY2hhbmdlcyB3aXRoIGl0IGFuZCB0aGUgQ1BVIHBhdGggdGFrZXMgb3Zlci5cbiAgICAgICAgICAgICAgICB0aGlzLl9zd2lmdG1hcFRpbWUgPSBhdHRhY2hUaW1lVG9JbnN0YW5jZSh0aGlzLmdsUG9pbnRzLCBncHVBdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XG4gICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcbiAgICAgICAgICAgIGlmIChjYW52YXMpIGNhbnZhcy5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICByZXR1cm4gaW5zdGFuY2U7XG59XG4iLCAiaW1wb3J0IHsgbG9hZENTUywgbG9hZEpTIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHJlbmRlclNpZGViYXJDb250cm9scywgbm9ybWFsaXplUmFkaW9MYXllcnMsIHNlbmRMYXllcldyaXRlIH0gZnJvbSBcIi4vc2lkZWJhci5qc1wiO1xuaW1wb3J0IHsgZGVyaXZlTGVnZW5kU3BlYywgcmVuZGVyTGVnZW5kIH0gZnJvbSBcIi4vbGVnZW5kLmpzXCI7XG5pbXBvcnQgeyByZW5kZXJMYXllciwgcmVuZGVyTWVyZ2VkR2xMYXllciB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xuaW1wb3J0IHsgcGFyc2VQZXJpb2QsIGdlbmVyYXRlVGlja3MsIGNvbGxlY3RUaW1lRXh0ZW50LCBoYXNUaW1lTGF5ZXJzLFxuICAgICAgICAgbGF5ZXJJbldpbmRvdywgcmVuZGVyVGltZUNvbnRyb2wsIGFkdmFuY2UsIHBlcmlvZFRvTXMsIGdjZEdyaWRNcyxcbiAgICAgICAgIGNvbGxlY3REdXJhdGlvbnNNcywgUE9TSVRJT05TIH0gZnJvbSBcIi4vdGltZWNvbnRyb2wuanNcIjtcbmltcG9ydCB7IGdwdVRpbWVBdmFpbGFibGUsIHZlY3RvckdwdUF2YWlsYWJsZSwgTEFZRVJfU0xPVFMgfSBmcm9tIFwiLi9ncHV0aW1lLmpzXCI7XG5cbi8vIFRydWUgaWYgYSBsYXllciBpcyB2aXNpYmxlIGFuZCBubyBmb2xkZXIgYWJvdmUgaXQgaXMgc3dpdGNoZWQgb2ZmLlxuLy9cbi8vIFZpc2liaWxpdHkgaXMgaW5oZXJpdGVkIGRvd24gdGhlIGZvbGRlciBwYXRoOiBhIGxheWVyIGluc2lkZSBcIkZlZWRzL0FjdGl2ZVwiIGlzIGhpZGRlblxuLy8gd2hlbiBlaXRoZXIgXCJGZWVkc1wiIG9yIFwiRmVlZHMvQWN0aXZlXCIgaXMgb2ZmLCByZWdhcmRsZXNzIG9mIGl0cyBvd24gZmxhZy4gR2V0dGluZyB0aGlzXG4vLyB3cm9uZyBzaG93cyB1cCBhcyBcInRoYXQgbGF5ZXIganVzdCB3aWxsIG5vdCBhcHBlYXJcIiwgd2l0aCBub3RoaW5nIGxvZ2dlZC5cbmV4cG9ydCBmdW5jdGlvbiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKSB7XG4gICAgaWYgKGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgKGxheWVyLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCIpLnNwbGl0KFwiL1wiKSkge1xuICAgICAgICBydW5uaW5nUGF0aCA9IHJ1bm5pbmdQYXRoID8gYCR7cnVubmluZ1BhdGh9LyR7cGFydH1gIDogcGFydDtcbiAgICAgICAgY29uc3QgY29uZmlnID0gZ3JvdXBDb25maWdzW3J1bm5pbmdQYXRoXTtcbiAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFNvcnRzIHRoZSB2aXNpYmxlIGxheWVycyBpbnRvIG9uZSBidWNrZXQgcGVyIFdlYkdMIGRyYXcgcGFzcy5cbi8vXG4vLyBTdWItbGF5ZXJzIG9mIGEgbWVyZ2VkIGdyb3VwIGluaGVyaXQgdGhlaXIgcGFyZW50J3MgdmlzaWJpbGl0eSByYXRoZXIgdGhhbiBjYXJyeWluZ1xuLy8gdGhlaXIgb3duLCBzbyBhIGdyb3VwIHRvZ2dsZWQgb2ZmIGNvbnRyaWJ1dGVzIG5vdGhpbmcgZXZlbiB3aGVuIGl0cyBjaGlsZHJlbiBzYXlcbi8vIHZpc2libGUuIENpcmNsZXMgam9pbiB0aGUgcG9seWdvbiBidWNrZXQ6IHRoZXkgYXJlIGRyYXduIGFzIGdlbmVyYXRlZCByaW5ncy5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0V2ViZ2xMYXllcnMobGF5ZXJzLCBncm91cENvbmZpZ3MpIHtcbiAgICBjb25zdCBidWNrZXRzID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG5cbiAgICBmdW5jdGlvbiBjb2xsZWN0KGxheWVyLCBwYXJlbnRWaXNpYmxlLCBpc1N1YkxheWVyKSB7XG4gICAgICAgIGlmICghcGFyZW50VmlzaWJsZSkgcmV0dXJuO1xuICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiICYmIGxheWVyLmxheWVycykge1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IGNvbGxlY3Qoc3ViLCBwYXJlbnRWaXNpYmxlLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFpc1N1YkxheWVyICYmIGxheWVyLnZpc2libGUgPT09IGZhbHNlKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKGJ1Y2tldHNbYnVja2V0XSkgYnVja2V0c1tidWNrZXRdLnB1c2gobGF5ZXIpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB7XG4gICAgICAgIGNvbGxlY3QobGF5ZXIsIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpLCBmYWxzZSk7XG4gICAgfVxuICAgIHJldHVybiBidWNrZXRzO1xufVxuXG4vLyBBcHBsaWVzIGluY3JlbWVudGFsIHBhdGNoIG9wcyB0byB7bGF5ZXJzLCBidWZmZXJzfSwgcmV0dXJuaW5nIHRoZSBuZXcgc3RhdGUuXG4vL1xuLy8gT3BzIGFyZSBhZGRyZXNzZWQgYnkgbGF5ZXIgaWQgYW5kIGFwcGxpZWQgaWRlbXBvdGVudGx5OiBcImFkZFwiIHVwc2VydHMgcmF0aGVyIHRoYW5cbi8vIGFwcGVuZGluZyBibGluZGx5LCBzbyBhIHBhdGNoIHRoYXQgcmFjZXMgdGhlIGluaXRpYWwgdHJhaXQgc25hcHNob3QgY2Fubm90IGR1cGxpY2F0ZVxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxuLy8gQXBwbGllcyBgdXBkYXRlYCB0byBvbmUgbGF5ZXIgd2hlcmV2ZXIgaXQgc2l0cywgZGVzY2VuZGluZyBpbnRvIGdyb3Vwcy4gYWRkX2NvbGxlY3Rpb25cbi8vIG5lc3RzIGl0cyBwb2ludCwgbGluZSBhbmQgcG9seWdvbiBsYXllcnMgaW5zaWRlIGEgZ3JvdXAgbGF5ZXIsIHNvIGFuIG9wIGFkZHJlc3NlZCBhdCBhXG4vLyBuZXN0ZWQgaWQgd291bGQgb3RoZXJ3aXNlIG1hdGNoIG5vdGhpbmcgYW5kIHNpbGVudGx5IGRvIG5vdGhpbmcuIFJldHVybnMgdGhlIG9yaWdpbmFsXG4vLyBhcnJheSB1bnRvdWNoZWQgd2hlbiB0aGUgaWQgaXMgbm90IGZvdW5kLCBzbyBhbiB1bm1hdGNoZWQgb3AgY29zdHMgbm8gcmUtcmVuZGVyLlxuZnVuY3Rpb24gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgaWQsIHVwZGF0ZSkge1xuICAgIGxldCBoaXQgPSBmYWxzZTtcbiAgICBjb25zdCBuZXh0ID0gbGF5ZXJzLm1hcChsID0+IHtcbiAgICAgICAgaWYgKGwuaWQgPT09IGlkKSB7XG4gICAgICAgICAgICBoaXQgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIHVwZGF0ZShsKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgQXJyYXkuaXNBcnJheShsLmxheWVycykpIHtcbiAgICAgICAgICAgIGNvbnN0IHN1YnMgPSB1cGRhdGVMYXllckJ5SWQobC5sYXllcnMsIGlkLCB1cGRhdGUpO1xuICAgICAgICAgICAgaWYgKHN1YnMgIT09IGwubGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgaGl0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5sLCBsYXllcnM6IHN1YnMgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbDtcbiAgICB9KTtcbiAgICByZXR1cm4gaGl0ID8gbmV4dCA6IGxheWVycztcbn1cblxuLy8gRXZlcnkgcG9pbnQgbGF5ZXIsIHZpc2libGUgb3Igbm90LCB3aXRoIGl0cyBlZmZlY3RpdmUgdmlzaWJpbGl0eSByZWNvcmRlZCAtLSB0aGVcbi8vIEdQVS12aXNpYmlsaXR5IHBhdGgga2VlcHMgaGlkZGVuIGxheWVycyBpbiB0aGUgYnVja2V0IChzdGFibGUgaWRzLCBubyByZWJ1aWxkIG9uIGFcbi8vIHRvZ2dsZSkgYW5kIGhpZGVzIHRoZW0gd2l0aCBhIHVuaWZvcm0gaW5zdGVhZC4gTWlycm9ycyBjb2xsZWN0V2ViZ2xMYXllcnMnIHJ1bGVzOlxuLy8gc3ViLWxheWVycyBpbmhlcml0IHRoZWlyIHBhcmVudCdzIGVmZmVjdGl2ZSB2aXNpYmlsaXR5LCB0b3AtbGV2ZWwgbGF5ZXJzIGFuc3dlciBmb3Jcbi8vIHRoZWlyIG93biBmbGFnIGFuZCB0aGVpciBmb2xkZXIgY2hhaW4uXG5leHBvcnQgZnVuY3Rpb24gY29sbGVjdFBvaW50TGF5ZXJzQWxsKGxheWVycywgZ3JvdXBDb25maWdzKSB7XG4gICAgY29uc3Qgb3V0ID0geyBjaXJjbGVfbWFya2VyczogW10sIG1hcmtlcnM6IFtdLCBwb2x5bGluZTogW10sIHBvbHlnb246IFtdIH07XG4gICAgZnVuY3Rpb24gd2FsayhsYXllciwgcGFyZW50VmlzaWJsZSwgaXNTdWIpIHtcbiAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiZ3JvdXBcIiAmJiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlbGZWaXMgPSBwYXJlbnRWaXNpYmxlICYmIGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGxheWVyLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgbGF5ZXIubGF5ZXJzLmZvckVhY2goc3ViID0+IHdhbGsoc3ViLCBzZWxmVmlzLCB0cnVlKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIiA/IFwicG9seWdvblwiIDogbGF5ZXIudHlwZTtcbiAgICAgICAgaWYgKCFvdXRbYnVja2V0XSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2aXMgPSBpc1N1YiA/IHBhcmVudFZpc2libGVcbiAgICAgICAgICAgIDogcGFyZW50VmlzaWJsZSAmJiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllciwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgb3V0W2J1Y2tldF0ucHVzaCh7IGxheWVyLCB2aXMgfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbGF5ZXIgb2YgbGF5ZXJzKSB3YWxrKGxheWVyLCB0cnVlLCBmYWxzZSk7XG4gICAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3dpZnRtYXBQYXRjaChzdGF0ZSwgb3BzLCBidWZmZXJzKSB7XG4gICAgbGV0IGxheWVycyA9IHN0YXRlLmxheWVycyB8fCBbXTtcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcblxuICAgIGZvciAoY29uc3Qgb3Agb2Ygb3BzKSB7XG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBvcC5sYXllcnMgfHwgW107XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7fTtcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJzICYmIGJ1ZmZlcnNbaV0pIGJ1ZmZlck1hcFtpZF0gPSBidWZmZXJzW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICAgICAgICBjb25zdCBpbmNvbWluZyA9IG9wLmxheWVyO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBpbmNvbWluZyA/IGluY29taW5nLmlkIDogb3AuaWQ7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBbLi4ubGF5ZXJzLCBpbmNvbWluZ107XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5tYXAoKGwsIGkpID0+IChpID09PSBpZHggPyBpbmNvbWluZyA6IGwpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJzZXRcIikge1xuICAgICAgICAgICAgLy8gRmllbGQtbGV2ZWwgdXBkYXRlLiBcInJlcGxhY2VcIiBjYXJyaWVzIHRoZSB3aG9sZSBsYXllciwgc28gZmxpcHBpbmcgYHZpc2libGVgXG4gICAgICAgICAgICAvLyBvbiBhIDUway1wb2ludCBsYXllciByZXNlbnQgZXZlcnkgcHJvcGVydHkgaXQgaG9sZHMgLS0gaGFsZiBhIG1lZ2FieXRlIHRvXG4gICAgICAgICAgICAvLyBjaGFuZ2Ugb25lIGJvb2xlYW4sIG9uIGV2ZXJ5IGNsaWNrIG9mIGEgY2hlY2tib3guXG4gICAgICAgICAgICBsYXllcnMgPSB1cGRhdGVMYXllckJ5SWQobGF5ZXJzLCBvcC5pZCwgbCA9PiAoeyAuLi5sLCAuLi4ob3AuZmllbGRzIHx8IHt9KSB9KSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwic3R5bGVcIikge1xuICAgICAgICAgICAgLy8gUGVyLWZlYXR1cmUgc3R5bGUgb3ZlcnJpZGVzLCByZXBsYWNlZCB3aG9sZXNhbGUgcmF0aGVyIHRoYW4gbWVyZ2VkOiBhXG4gICAgICAgICAgICAvLyBzZWxlY3Rpb24gZGVzY3JpYmVzIGl0cyBjb21wbGV0ZSBzdGF0ZSwgc28gc2VuZGluZyB7fSBjbGVhcnMgaXQgYW5kIG5vXG4gICAgICAgICAgICAvLyBjYWxsZXIgaGFzIHRvIHRyYWNrIHdoYXQgdGhlIHByZXZpb3VzIGhpZ2hsaWdodCB0b3VjaGVkLlxuICAgICAgICAgICAgbGF5ZXJzID0gdXBkYXRlTGF5ZXJCeUlkKGxheWVycywgb3AuaWQsIGwgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5sLCBzdHlsZV9vdmVycmlkZXM6IG9wLm92ZXJyaWRlcyB8fCB7fSxcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLmZpbHRlcihsID0+IGwuaWQgIT09IG9wLmlkKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJcIikge1xuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XG4gICAgICAgICAgICBpZiAoYnVmKSBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogYnVmIH07XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX3JlbW92ZVwiKSB7XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xuICAgICAgICAgICAgZGVsZXRlIGJ1ZmZlck1hcFtvcC5pZF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBsYXllcnMsIGJ1ZmZlcnM6IGJ1ZmZlck1hcCB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxFcnJvciA9IGNvbnNvbGUuZXJyb3I7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcblxuICAgICAgICAvLyBqc19jb25zb2xlX2xvZ3MgaXMgYSBzeW5jZWQgbGlzdCwgc28gZWFjaCBhcHBlbmQgcmVzZW5kcyB0aGUgd2hvbGUgYXJyYXkuIEtlZXBpbmdcbiAgICAgICAgLy8gb25seSB0aGUgbW9zdCByZWNlbnQgZW50cmllcyBib3VuZHMgYm90aCB0aGUgcGF5bG9hZCBhbmQgdGhlIG1lbW9yeSBhIGxvbmctbGl2ZWRcbiAgICAgICAgLy8gc2Vzc2lvbiBhY2N1bXVsYXRlczsgdGhlIG5ld2VzdCBhcmUgdGhlIG9uZXMgd29ydGggaGF2aW5nIGFueXdheS5cbiAgICAgICAgY29uc3QgTUFYX0NPTlNPTEVfTE9HUyA9IDIwMDtcbiAgICAgICAgY29uc3QgYXBwZW5kTG9nID0gZW50cnkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbG9ncyA9IG1vZGVsLmdldChcImpzX2NvbnNvbGVfbG9nc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBbLi4ubG9ncywgZW50cnldO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQubGVuZ3RoID4gTUFYX0NPTlNPTEVfTE9HUyA/IG5leHQuc2xpY2UoLU1BWF9DT05TT0xFX0xPR1MpIDogbmV4dDtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBIZWxwZXIgdG8gc2FmZWx5IHdyaXRlIGJhY2sgdG8gUHl0aG9uIG9ubHkgaWYgdGhlIHdpZGdldCB2aWV3IGlzIGFjdGl2ZSBhbmQgYXR0YWNoZWRcbiAgICAgICAgZnVuY3Rpb24gc2FmZVNldEFuZFNhdmUoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgd3JpdGUgZXJyb3I6XCIsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHNhZmVTYXZlQ2hhbmdlcygpIHtcbiAgICAgICAgICAgIGlmIChkb2N1bWVudC5ib2R5LmNvbnRhaW5zKGVsKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyBzYXZlIGVycm9yOlwiLCBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmVycm9yID0gZnVuY3Rpb24oLi4uYXJncykge1xuICAgICAgICAgICAgb3JpZ2luYWxFcnJvci5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsXG4gICAgICAgICAgICAgICAgYXBwZW5kTG9nKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpKTtcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xuICAgICAgICBjb25zb2xlLndhcm4gPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XG4gICAgICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xuICAgICAgICAgICAgICAgIGlmICghbG9nZ2VkUmVwcm9qZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBtb2RlbC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xlYW5Nc2cgPSBgW1N3aWZ0TWFwXSBMYXllciB3YXMgcmVwcm9qZWN0ZWQgdG8gXCIke2Nyc31cImA7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIGFwcGVuZExvZyhjbGVhbk1zZykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIHN1cHByZXNzIGR1cGxpY2F0ZSBjb25zb2xlIHdhcm5pbmdzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvcmlnaW5hbFdhcm4uYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgd2luZG93Lm9uZXJyb3IgPSBmdW5jdGlvbihtZXNzYWdlLCBzb3VyY2UsIGxpbmVubywgY29sbm8sIGVycm9yKSB7XG4gICAgICAgICAgICBzYWZlU2V0QW5kU2F2ZShcImpzX2NvbnNvbGVfbG9nc1wiLFxuICAgICAgICAgICAgICAgIGFwcGVuZExvZyhgV0lORE9XLk9ORVJST1I6ICR7bWVzc2FnZX0gYXQgJHtzb3VyY2V9OiR7bGluZW5vfToke2NvbG5vfWApKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBMb2FkIENTUyBhbmQgTGVhZmxldCBsaWJyYXJpZXMgKGluY2x1ZGluZyBXZWJHTCBnbGlmeSlcbiAgICAgICAgbG9hZENTUyhcImxlYWZsZXQtY3NzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuY3NzXCIpO1xuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWpzXCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldEAxLjkuNC9kaXN0L2xlYWZsZXQuanNcIik7XG4gICAgICAgIGF3YWl0IGxvYWRKUyhcImxlYWZsZXQtZ2xpZnlcIiwgXCJodHRwczovL3VucGtnLmNvbS9sZWFmbGV0LmdsaWZ5QDMuMy4wL2Rpc3QvZ2xpZnktYnJvd3Nlci5qc1wiKTtcblxuICAgICAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1jb250YWluZXJcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5oZWlnaHQgPSBcIjEwMCVcIjtcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xuICAgICAgICBlbC5hcHBlbmRDaGlsZChjb250YWluZXIpO1xuXG4gICAgICAgIGNvbnN0IGNyc05hbWUgPSBtb2RlbC5nZXQoXCJjcnNcIik7XG4gICAgICAgIGxldCBtYXBDcnMgPSBMLkNSUy5FUFNHMzg1NztcbiAgICAgICAgaWYgKGNyc05hbWUgPT09IFwiRVBTRzo0MzI2XCIpIHtcbiAgICAgICAgICAgIG1hcENycyA9IEwuQ1JTLkVQU0c0MzI2O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbWFwID0gTC5tYXAoY29udGFpbmVyLCB7XG4gICAgICAgICAgICBjcnM6IG1hcENycyxcbiAgICAgICAgICAgIGNlbnRlcjogbW9kZWwuZ2V0KFwiY2VudGVyXCIpLFxuICAgICAgICAgICAgem9vbTogbW9kZWwuZ2V0KFwiem9vbVwiKSxcbiAgICAgICAgICAgIHNjcm9sbFdoZWVsWm9vbTogdHJ1ZSxcbiAgICAgICAgICAgIHByZWZlckNhbnZhczogdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgY3VzdG9tIHBhbmVzIGZvciBzdHJpY3QgWi1pbmRleCBvcmRlcmluZ1xuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlnb25zUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5Z29uc1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MTBcIjtcbiAgICAgICAgXG4gICAgICAgIG1hcC5jcmVhdGVQYW5lKFwicG9seWxpbmVzUGFuZVwiKTtcbiAgICAgICAgbWFwLmdldFBhbmUoXCJwb2x5bGluZXNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDIwXCI7XG4gICAgICAgIFxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvaW50c1BhbmVcIik7XG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9pbnRzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQzMFwiO1xuXG4gICAgICAgIC8vIExvY2FsIG1pcnJvcnMgb2YgdGhlIGxheWVyIGxpc3QgYW5kIGNvb3JkaW5hdGUgYnVmZmVycy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gUHl0aG9uIHVwZGF0ZXMgdGhlc2UgaW5jcmVtZW50YWxseSB2aWEgXCJzd2lmdG1hcF9wYXRjaFwiIG1lc3NhZ2VzIGluc3RlYWQgb2ZcbiAgICAgICAgLy8gcmVhc3NpZ25pbmcgdGhlIHRyYWl0cywgYmVjYXVzZSBhIHRyYWl0IHJlYXNzaWdubWVudCByZS1zZXJpYWxpemVzIGFuZCByZS1zZW5kc1xuICAgICAgICAvLyB0aGUgZW50aXJlIG1hcCBvbiBldmVyeSBtdXRhdGlvbi4gVGhlIHRyYWl0cyBzdGlsbCBjYXJyeSB0aGUgaW5pdGlhbCBzbmFwc2hvdFxuICAgICAgICAvLyB3aGVuIGEgdmlldyBhdHRhY2hlcywgYW5kIHRoZSBzaWRlYmFyIHN0aWxsIHdyaXRlcyBgbGF5ZXJzYCBiYWNrIG9uIHRvZ2dsZSwgc29cbiAgICAgICAgLy8gYm90aCBhcmUgc2VlZGVkIGhlcmUgYW5kIGtlcHQgaW4gc3RlcCBieSB0aGUgY2hhbmdlIGhhbmRsZXJzIGZ1cnRoZXIgZG93bi5cbiAgICAgICAgbGV0IGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgIGxldCBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcblxuICAgICAgICBmdW5jdGlvbiBhcHBseVBhdGNoT3BzKG9wcywgYnVmZmVycykge1xuICAgICAgICAgICAgY29uc3QgbmV4dCA9IGFwcGx5U3dpZnRtYXBQYXRjaCh7IGxheWVyczogbGF5ZXJTdGF0ZSwgYnVmZmVyczogYnVmZmVyU3RhdGUgfSwgb3BzLCBidWZmZXJzKTtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBuZXh0LmxheWVycztcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0gbmV4dC5idWZmZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWN0aXZlVGlsZUxheWVycyA9IHt9O1xuICAgICAgICBjb25zdCBhY3RpdmVPdmVybGF5TGF5ZXJzID0ge307XG4gICAgICAgIGNvbnN0IGdsU3RhdGVzID0ge1xuICAgICAgICAgICAgY2lyY2xlX21hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgbWFya2VyczogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5bGluZTogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH0sXG4gICAgICAgICAgICBwb2x5Z29uOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFRoZSBzaGFyZWQgdGltZSBzbGlkZXIuIGB0aW1lU3RhdGVgIGlzIHdoYXQgcmVuZGVyaW5nIHJlYWRzIC0tIHRoZSBjdXJyZW50IHRpY2tcbiAgICAgICAgLy8gYW5kIHRoZSBwZXJpb2QsIG9yIG51bGwgd2hlbiBub3RoaW5nIGlzIGFuaW1hdGVkIC0tIGFuZCBgdGltZVVJYCBpcyB0aGUgc2xpZGVyJ3NcbiAgICAgICAgLy8gb3duIGJvb2trZWVwaW5nLiBQbGF5YmFjayBuZXZlciByb3VuZC10cmlwcyB0aHJvdWdoIFB5dGhvbjogdGlja3MgcmUtcmVuZGVyXG4gICAgICAgIC8vIGxvY2FsbHksIGFuZCB0aW1lX2N1cnJlbnQgaXMgd3JpdHRlbiBiYWNrIGF0IG1vc3Qgb25jZSBhIHNlY29uZCB3aGlsZSBwbGF5aW5nLlxuICAgICAgICBsZXQgdGltZVN0YXRlID0gbnVsbDtcbiAgICAgICAgY29uc3QgdGltZVVJID0geyB0aWNrczogW10sIGtleTogXCJcIiwgaW5kZXg6IDAsIHBsYXlpbmc6IGZhbHNlLCBsb29wOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBzcGVlZDogMSwgdGltZXI6IG51bGwsIGxhc3RXcml0ZTogMCwgc3RhcnRlZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93OiBudWxsLCBwZXJpb2RNczogbnVsbCwgZ3JpZE1zOiBudWxsIH07XG5cbiAgICAgICAgZnVuY3Rpb24gc3RvcFBsYXliYWNrKCkge1xuICAgICAgICAgICAgaWYgKHRpbWVVSS50aW1lcikgY2xlYXJJbnRlcnZhbCh0aW1lVUkudGltZXIpO1xuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gbnVsbDtcbiAgICAgICAgICAgIHRpbWVVSS5wbGF5aW5nID0gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiB3cml0ZVRpbWVDdXJyZW50KGZvcmNlKSB7XG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgaWYgKCFmb3JjZSAmJiBub3cgLSB0aW1lVUkubGFzdFdyaXRlIDwgMTAwMCkgcmV0dXJuO1xuICAgICAgICAgICAgdGltZVVJLmxhc3RXcml0ZSA9IG5vdztcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwidGltZV9jdXJyZW50XCIsIHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQgKi8gfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc2Vla1RvKGluZGV4LCB7IHdyaXRlID0gdHJ1ZSB9ID0ge30pIHtcbiAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkpO1xuICAgICAgICAgICAgdGltZVN0YXRlID0geyB0aWNrOiB0aW1lVUkudGlja3NbdGltZVVJLmluZGV4XSwgcGVyaW9kOiB0aW1lU3RhdGUucGVyaW9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3c6IHRpbWVVSS53aW5kb3cgfTtcbiAgICAgICAgICAgIGlmICh3cml0ZSkgd3JpdGVUaW1lQ3VycmVudCghdGltZVVJLnBsYXlpbmcpO1xuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc3RhcnRQbGF5YmFjaygpIHtcbiAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgdGltZVVJLnBsYXlpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdGltZVVJLnRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhZHZhbmNlKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCwgdGltZVVJLmxvb3ApO1xuICAgICAgICAgICAgICAgIGlmICghbmV4dC5wbGF5aW5nKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BQbGF5YmFjaygpO1xuICAgICAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgICAgICB3cml0ZVRpbWVDdXJyZW50KHRydWUpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHNlZWtUbyhuZXh0LmluZGV4KTtcbiAgICAgICAgICAgIH0sIDEwMDAgLyB0aW1lVUkuc3BlZWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGltZUhhbmRsZXJzID0ge1xuICAgICAgICAgICAgb25TZWVrOiAoaW5kZXgpID0+IHNlZWtUbyhpbmRleCksXG4gICAgICAgICAgICBvblN0ZXBCYWNrOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4IC0gMSksXG4gICAgICAgICAgICBvblN0ZXBGb3J3YXJkOiAoKSA9PiBzZWVrVG8odGltZVVJLmluZGV4ICsgMSksXG4gICAgICAgICAgICBvblBsYXlUb2dnbGU6ICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlVGltZUN1cnJlbnQodHJ1ZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gc3RhcnRPdmVyLCBhcyB0aGUgZm9saXVtIHBsYXllciB3YXMgY29uZmlndXJlZDogcHJlc3NpbmcgcGxheSBhdFxuICAgICAgICAgICAgICAgICAgICAvLyB0aGUgZW5kIHJlc3RhcnRzIGZyb20gdGhlIGJlZ2lubmluZyBpbW1lZGlhdGVseSwgcmF0aGVyIHRoYW4gb25lXG4gICAgICAgICAgICAgICAgICAgIC8vIHNpbGVudCBpbnRlcnZhbCBsYXRlciBkZWNpZGluZyB0aGVyZSBpcyBub3doZXJlIHRvIGdvIGFuZCBzdG9wcGluZy5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRpbWVVSS5pbmRleCA+PSB0aW1lVUkudGlja3MubGVuZ3RoIC0gMSkgc2Vla1RvKDApO1xuICAgICAgICAgICAgICAgICAgICBzdGFydFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB0aW1lVUksIHRpbWVIYW5kbGVycyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb25Mb29wVG9nZ2xlOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGltZVVJLmxvb3AgPSAhdGltZVVJLmxvb3A7XG4gICAgICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblNwZWVkOiAoc3BlZWQpID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuc3BlZWQgPSBzcGVlZDtcbiAgICAgICAgICAgICAgICBpZiAodGltZVVJLnBsYXlpbmcpIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBMaXZlIGR1cmluZyB0aGUgZHJhZzogbG9jYWwgc3RhdGUgYW5kIGEgcmUtcmVuZGVyIG9mIHRoZSBjb250cm9sIG9uIGV2ZXJ5XG4gICAgICAgICAgICAvLyBtb3ZlLCBidXQgbWFwIHJlYnVpbGRzIGF0IG1vc3QgZXZlcnkgMzAwbXMuIEF0IDVNIHBvaW50cyBhIHJlYnVpbGQgY29zdHNcbiAgICAgICAgICAgIC8vIHNlY29uZHMsIGFuZCBhIGRyYWcgZmlyZXMgZG96ZW5zIG9mIG1vdmVzIC0tIHVudGhyb3R0bGVkLCB0aGUgcmVidWlsZHNcbiAgICAgICAgICAgIC8vIHN0YWNrIGZhc3RlciB0aGFuIHRoZXkgZmluaXNoIGFuZCB0aGUgYWxsb2NhdGlvbiBjaHVybiBjcmFzaGVzIHRoZSB0YWIuXG4gICAgICAgICAgICBvbldpbmRvd0RyYWc6IChpc28pID0+IHtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGltZVVJLndpbmRvdyA9IGlzbztcbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB0aW1lU3RhdGUgPSB7IC4uLnRpbWVTdGF0ZSwgd2luZG93OiBpc28gfTtcbiAgICAgICAgICAgICAgICByZW5kZXJUaW1lQ29udHJvbChlbCwgdGltZVVJLCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vdyAtICh0aW1lVUkubGFzdERyYWdTeW5jIHx8IDApID49IDMwMCkge1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkubGFzdERyYWdTeW5jID0gbm93O1xuICAgICAgICAgICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gT24gcmVsZWFzZSAob3IgYSBrZXlib2FyZCBzdGVwKTogdGhlIG92ZXJyaWRlIGxhbmRzIGluIHRpbWVfY29uZmlnIHNvXG4gICAgICAgICAgICAvLyBQeXRob24gYW5kIFNoaW55IHNlZSB0aGUgc2FtZSB3aW5kb3cgdGhlIGJhciBzaG93cy4gbnVsbCBjbGVhcnMgdGhlIGtleSxcbiAgICAgICAgICAgIC8vIGhhbmRpbmcgY29udHJvbCBiYWNrIHRvIHBlci1sYXllciBkdXJhdGlvbnMuXG4gICAgICAgICAgICBvbldpbmRvd0NvbW1pdDogKGlzbykgPT4ge1xuICAgICAgICAgICAgICAgIHRpbWVIYW5kbGVycy5vbldpbmRvd0RyYWcoaXNvKTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZHJhZ0FjdGl2ZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHF1ZXVlU3luYygpOyAgICAgICAvLyB0aGUgcmVsZWFzZSBhbHdheXMgbGFuZHMsIHRocm90dGxlIG9yIG5vdFxuICAgICAgICAgICAgICAgIGNvbnN0IGNmZyA9IHsgLi4uKG1vZGVsLmdldChcInRpbWVfY29uZmlnXCIpIHx8IHt9KSB9O1xuICAgICAgICAgICAgICAgIGlmIChpc28pIGNmZy53aW5kb3cgPSBpc287XG4gICAgICAgICAgICAgICAgZWxzZSBkZWxldGUgY2ZnLndpbmRvdztcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJ0aW1lX2NvbmZpZ1wiLCBjZmcpO1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHsgLyogbm8gbGl2ZSBiYWNrZW5kOyB0aGUgbG9jYWwgbW9kZWwgc3RpbGwgaG9sZHMgaXQgKi8gfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDcmVhdGVzLCByZXR1bmVzIG9yIHJlbW92ZXMgdGhlIHNsaWRlciB0byBtYXRjaCB0aGUgbGF5ZXJzIHByZXNlbnQuIFRpY2tzIGFyZVxuICAgICAgICAvLyByZWdlbmVyYXRlZCBvbmx5IHdoZW4gdGhlIGRhdGEncyB0aW1lIGV4dGVudCBvciB0aGUgcGVyaW9kIGNoYW5nZXMsIHNvIGFcbiAgICAgICAgLy8gcGxheWJhY2sgdGljayAtLSB3aGljaCByZS1lbnRlcnMgaGVyZSB2aWEgcXVldWVTeW5jIC0tIGRvZXMgbm90IHJlYnVpbGQgdGhlbS5cbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlVGltZURpbWVuc2lvbigpIHtcbiAgICAgICAgICAgIGlmICghaGFzVGltZUxheWVycyhsYXllclN0YXRlKSkge1xuICAgICAgICAgICAgICAgIGlmICh0aW1lU3RhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFBsYXliYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlclRpbWVDb250cm9sKGVsLCB7IHRpY2tzOiBbXSB9LCB0aW1lSGFuZGxlcnMpO1xuICAgICAgICAgICAgICAgICAgICB0aW1lU3RhdGUgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aW1lVUkua2V5ID0gXCJcIjtcbiAgICAgICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgY2ZnID0gbW9kZWwuZ2V0KFwidGltZV9jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBwZXJpb2QgPSBwYXJzZVBlcmlvZChjZmcucGVyaW9kIHx8IFwiUDFEXCIpIHx8IHBhcnNlUGVyaW9kKFwiUDFEXCIpO1xuICAgICAgICAgICAgY29uc3QgZXh0ZW50ID0gY29sbGVjdFRpbWVFeHRlbnQobGF5ZXJTdGF0ZSwgYnVmZmVyU3RhdGUpO1xuICAgICAgICAgICAgaWYgKCFleHRlbnQpIHJldHVybjtcblxuICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7ZXh0ZW50Lm1pbn18JHtleHRlbnQubWF4fXwke2NmZy5wZXJpb2QgfHwgXCJQMURcIn1gO1xuICAgICAgICAgICAgaWYgKGtleSAhPT0gdGltZVVJLmtleSkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS5rZXkgPSBrZXk7XG4gICAgICAgICAgICAgICAgdGltZVVJLnRpY2tzID0gZ2VuZXJhdGVUaWNrcyhleHRlbnQubWluLCBleHRlbnQubWF4LCBwZXJpb2QpO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5pbmRleCA9IE1hdGgubWluKHRpbWVVSS5pbmRleCwgdGltZVVJLnRpY2tzLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBUaGUgc2hhcmVkIHdpbmRvdyBvdmVycmlkZSwgY29uZmlnLWRyaXZlbjsgYSBiYWQgc3RyaW5nIGNsZWFycyByYXRoZXIgdGhhblxuICAgICAgICAgICAgLy8gZ3Vlc3NpbmcuIFRoZSBkcmFnIGdyaWQgaXMgdGhlIGdjZCBvZiB0aGUgaW50ZXJ2YWwgYW5kIGV2ZXJ5IGF0dGFjaGVkXG4gICAgICAgICAgICAvLyBkdXJhdGlvbiAtLSB0aGUgbGFyZ2VzdCBzdGVwIHRoYXQgbGFuZHMgb24gYWxsIG9mIHRoZW0gLS0gc28gYSAyLjVoIHRyYWlsXG4gICAgICAgICAgICAvLyBpcyBkcmFnZ2FibGUgb24gYSAxaCBiYXIuIENhbGVuZGFyIHBlcmlvZHMgaGF2ZSBubyBmaXhlZCB3aWR0aDsgdGhlIHJ1bGVyXG4gICAgICAgICAgICAvLyB0aGVuIHNob3dzIGludGVydmFsIG1hcmtzIG9ubHkgYW5kIHRoZSB0cmFpbCBoYW5kbGUgaGlkZXMuXG4gICAgICAgICAgICAvLyBOZXZlciB3aGlsZSBhIGRyYWcgaXMgbGl2ZTogdGhlIGRyYWdnZWQgd2luZG93IGV4aXN0cyBvbmx5IGxvY2FsbHkgdW50aWxcbiAgICAgICAgICAgIC8vIHJlbGVhc2UgY29tbWl0cyBpdCwgYW5kIHJlYWRpbmcgY29uZmlnIGhlcmUgbWlkLWRyYWcgcmVzZXQgdGhlIGhhbmRsZSB0b1xuICAgICAgICAgICAgLy8gXCJubyB3aW5kb3dcIiBvbiBldmVyeSBkZWJvdW5jZWQgc3luYyAtLSB0aGUgaGFuZGxlIGZvbGxvd2VkIHRoZSBtb3VzZSwgdGhlblxuICAgICAgICAgICAgLy8gc25hcHBlZCBob21lLCB0aGVuIGZvbGxvd2VkIGFnYWluLCBvbmNlIHBlciBzeW5jLlxuICAgICAgICAgICAgaWYgKCF0aW1lVUkuZHJhZ0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHRpbWVVSS53aW5kb3cgPSBjZmcud2luZG93ICYmIHBhcnNlUGVyaW9kKGNmZy53aW5kb3cpID8gY2ZnLndpbmRvdyA6IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aW1lVUkucGVyaW9kTXMgPSBwZXJpb2RUb01zKHBlcmlvZCk7XG4gICAgICAgICAgICB0aW1lVUkuZ3JpZE1zID0gdGltZVVJLnBlcmlvZE1zXG4gICAgICAgICAgICAgICAgPyBnY2RHcmlkTXModGltZVVJLnBlcmlvZE1zLCBjb2xsZWN0RHVyYXRpb25zTXMobGF5ZXJTdGF0ZSwgdGltZVVJLndpbmRvdykpXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuXG4gICAgICAgICAgICB0aW1lU3RhdGUgPSB7IHRpY2s6IHRpbWVVSS50aWNrc1t0aW1lVUkuaW5kZXhdLCBwZXJpb2QsIHdpbmRvdzogdGltZVVJLndpbmRvdyB9O1xuICAgICAgICAgICAgdGltZVVJLnBvc2l0aW9uID0gY2ZnLnBvc2l0aW9uIHx8IFwidG9wLWNlbnRlclwiO1xuXG4gICAgICAgICAgICBpZiAoIXRpbWVVSS5zdGFydGVkKSB7XG4gICAgICAgICAgICAgICAgdGltZVVJLnN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5zcGVlZCA9IGNmZy5zcGVlZCB8fCAxO1xuICAgICAgICAgICAgICAgIHRpbWVVSS5sb29wID0gQm9vbGVhbihjZmcubG9vcCk7XG4gICAgICAgICAgICAgICAgLy8gT25seSB0aGUgZmlyc3QgY29uZmlndXJhdGlvbiBtYXkgYXV0by1zdGFydC4gRXZlcnkgY29uZmlnIGNoYW5nZSByZXNldHNcbiAgICAgICAgICAgICAgICAvLyBgc3RhcnRlZGAgdG8gcmUtcmVhZCBzcGVlZCBhbmQgbG9vcCAtLSBpbmNsdWRpbmcgdGhlIGNoYW5nZSBhIHdpbmRvd1xuICAgICAgICAgICAgICAgIC8vIGRyYWcgY29tbWl0cyAtLSBhbmQgcmUtcnVubmluZyBhdXRvX3BsYXkgdGhlcmUgd291bGQgc3RhcnQgcGxheWJhY2sgYXNcbiAgICAgICAgICAgICAgICAvLyBhIHNpZGUgZWZmZWN0IG9mIHJlbGVhc2luZyB0aGUgaGFuZGxlLlxuICAgICAgICAgICAgICAgIGlmIChjZmcuYXV0b19wbGF5ICYmICF0aW1lVUkuZXZlclN0YXJ0ZWQpIHN0YXJ0UGxheWJhY2soKTtcbiAgICAgICAgICAgICAgICB0aW1lVUkuZXZlclN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyVGltZUNvbnRyb2woZWwsIHRpbWVVSSwgdGltZUhhbmRsZXJzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNpZGViYXIgTGF5ZXJzIENvbnRyb2wgVUlcbiAgICAgICAgY29uc3Qgc2lkZWJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIHNpZGViYXIuY2xhc3NOYW1lID0gXCJzd2lmdG1hcC1zaWRlYmFyXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUudG9wID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUucmlnaHQgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5iYWNrZ3JvdW5kID0gXCJ3aGl0ZVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnBhZGRpbmcgPSBcIjEwcHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjVweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmJveFNoYWRvdyA9IFwiMCAxcHggNXB4IHJnYmEoMCwwLDAsMC40KVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLm1heEhlaWdodCA9IFwiODAlXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUub3ZlcmZsb3dZID0gXCJhdXRvXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuZm9udEZhbWlseSA9IFwiLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU2Vnb2UgVUknLCBSb2JvdG8sIHNhbnMtc2VyaWZcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmNvbG9yID0gXCIjMzMzXCI7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChzaWRlYmFyKTtcblxuICAgICAgICAvLyBMZWdlbmQ6IGRlcml2ZWQgZnJlc2ggb24gZXZlcnkgc3luYyBmcm9tIHRoZSBzYW1lIGxheWVyIHN0YXRlIHRoZSBzaWRlYmFyXG4gICAgICAgIC8vIHJlbmRlcnMgZnJvbSwgc28gdG9nZ2xlcyBkaW0gb3IgZHJvcCByb3dzIHdpdGggbm8gZXh0cmEgd2lyaW5nLiBIaWRkZW5cbiAgICAgICAgLy8gdW50aWwgc2hvd19sZWdlbmQgYXNrcyBmb3IgaXQuXG4gICAgICAgIGNvbnN0IGxlZ2VuZERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGxlZ2VuZERpdi5jbGFzc05hbWUgPSBcInN3aWZ0bWFwLWxlZ2VuZFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUucG9zaXRpb24gPSBcImFic29sdXRlXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS56SW5kZXggPSBcIjEwMDBcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5wYWRkaW5nID0gXCIxMHB4XCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5ib3JkZXJSYWRpdXMgPSBcIjVweFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuYm94U2hhZG93ID0gXCIwIDFweCA1cHggcmdiYSgwLDAsMCwwLjQpXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5tYXhXaWR0aCA9IFwiMjYwcHhcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLm1heEhlaWdodCA9IFwiNDUlXCI7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5vdmVyZmxvd1kgPSBcImF1dG9cIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmZvbnRGYW1pbHkgPSBzaWRlYmFyLnN0eWxlLmZvbnRGYW1pbHk7XG4gICAgICAgIGxlZ2VuZERpdi5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xuICAgICAgICBsZWdlbmREaXYuc3R5bGUuY29sb3IgPSBcIiMzMzNcIjtcbiAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxlZ2VuZERpdik7XG5cbiAgICAgICAgLy8gTG9nb1xuICAgICAgICBjb25zdCBsb2dvRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3R0b20gPSBcIjEwcHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucGFkZGluZyA9IFwiNXB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI0cHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgIGxvZ29EaXYuaW5uZXJIVE1MID0gYFxuICAgICAgICAgICAgPGRpdiBzdHlsZT1cImRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7XCI+XG4gICAgICAgICAgICAgICAgPGltZyBzcmM9XCJodHRwczovL3JlcG8vYXNzZXRzL2ltYWdlLnBuZ1wiIGFsdD1cIkNvbXBhbnlcIiBzdHlsZT1cImhlaWdodDogMzVweDsgbWFyZ2luLXJpZ2h0OiA1cHg7XCI+XG4gICAgICAgICAgICAgICAgPGltZyBzcmM9XCJodHRwczovL3JlcG8vYXNzZXRzL2ltYWdlMi5wbmdcIiBhbHQ9XCJQYXJlbnQgQ29tcGFueVwiIHN0eWxlPVwiaGVpZ2h0OiAzNXB4O1wiPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgIGA7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChsb2dvRGl2KTtcblxuXG5cbiAgICAgICAgZnVuY3Rpb24gZ2V0VGlsZUxheWVyKGxheWVyKSB7XG4gICAgICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxuICAgICAgICAgICAgICAgIG1heFpvb206IGxheWVyLm1heF96b29tIHx8IDIyLFxuICAgICAgICAgICAgICAgIG1heE5hdGl2ZVpvb206IGxheWVyLm1heF9uYXRpdmVfem9vbSB8fCAxOVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBhc3luYyBmdW5jdGlvbiBzeW5jTWFwU3RhdGUoKSB7XG4gICAgICAgICAgICBjb25zb2xlLnRpbWUoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcbiAgICAgICAgICAgIHVwZGF0ZVRpbWVEaW1lbnNpb24oKTtcbiAgICAgICAgICAgIGNvbnN0IGxheWVycyA9IGxheWVyU3RhdGU7XG4gICAgICAgICAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBidWZmZXJTdGF0ZTtcblxuICAgICAgICAgICAgLy8gRW5mb3JjZSBtdXR1YWxseSBleGNsdXNpdmUgcmFkaW8gZ3JvdXAgdmlzaWJpbGl0eSBiZWZvcmUgY29sbGVjdGluZyBvciByZW5kZXJpbmcgV2ViR0wgbGF5ZXJzLlxuICAgICAgICAgICAgLy8gV3JpdHRlbiBiYWNrIGFzIHRhcmdldGVkIGZsaXBzLCBuZXZlciB0aGUgbGF5ZXJzIHRyYWl0IC0tIHRoZSBmdWxsIHdyaXRlIHdhc1xuICAgICAgICAgICAgLy8gdGhlIGZyYW1lIHRoYXQga2lsbGVkIGxhcmdlIHNlc3Npb25zIChzZWUgdGhlIHNpZGViYXIncyBjaGFuZ2UgaGFuZGxlcikuXG4gICAgICAgICAgICBjb25zdCByYWRpbyA9IG5vcm1hbGl6ZVJhZGlvTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgIGlmICgocmFkaW8uY2hhbmdlcy5sZW5ndGggPiAwIHx8IHJhZGlvLmdyb3Vwc0NoYW5nZWQpICYmIGRvY3VtZW50LmJvZHkuY29udGFpbnMoZWwpKSB7XG4gICAgICAgICAgICAgICAgc2VuZExheWVyV3JpdGUobW9kZWwsIHJhZGlvLmNoYW5nZXMpO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImdyb3VwX2NvbmZpZ3NcIiwgeyAuLi5ncm91cENvbmZpZ3MgfSk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxvZ29EaXYuc3R5bGUuZGlzcGxheSA9IG1vZGVsLmdldChcInNob3dfbG9nb1wiKSA/IFwiYmxvY2tcIiA6IFwibm9uZVwiO1xuXG4gICAgICAgICAgICAvLyBHcm91cCB2aXNpYmxlIGxheWVycyAoaW5jbHVkaW5nIHN1Yi1sYXllcnMgaW5zaWRlIGdyb3VwcykgdG8gYWx3YXlzIHVzZSBXZWJHTFxuICAgICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgICAgIGNpcmNsZV9tYXJrZXJzOiB3ZWJnbENpcmNsZU1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICBtYXJrZXJzOiB3ZWJnbE1hcmtlckxheWVycyxcbiAgICAgICAgICAgICAgICBwb2x5bGluZTogd2ViZ2xQb2x5bGluZUxheWVycyxcbiAgICAgICAgICAgICAgICBwb2x5Z29uOiB3ZWJnbFBvbHlnb25MYXllcnMsXG4gICAgICAgICAgICB9ID0gY29sbGVjdFdlYmdsTGF5ZXJzKGxheWVycywgZ3JvdXBDb25maWdzKTtcblxuICAgICAgICAgICAgLy8gU2V0IG9mIGxheWVyIElEcyBwcm9jZXNzZWQgdmlhIG1lcmdlZCBXZWJHTCBsYXllcnNcbiAgICAgICAgICAgIGNvbnN0IHdlYmdsTGF5ZXJJZHMgPSBuZXcgU2V0KFtcbiAgICAgICAgICAgICAgICAuLi53ZWJnbENpcmNsZU1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbE1hcmtlckxheWVycy5tYXAobCA9PiBsLmlkKSxcbiAgICAgICAgICAgICAgICAuLi53ZWJnbFBvbHlsaW5lTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsUG9seWdvbkxheWVycy5tYXAobCA9PiBsLmlkKVxuICAgICAgICAgICAgXSk7XG5cbiAgICAgICAgICAgIC8vIFJlbW92ZSByZXRpcmVkIG92ZXJsYXkgbGF5ZXJzLCBpbmNsdWRpbmcgdGhvc2UgdGhhdCB0cmFuc2l0aW9uZWQgdG8gV2ViR0xcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGFjdGl2ZU92ZXJsYXlMYXllcnMpLmZvckVhY2goaWQgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghbGF5ZXJzLmZpbmQobCA9PiBsLmlkID09PSBpZCkgfHwgd2ViZ2xMYXllcklkcy5oYXMoaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbaWRdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3Mgbm9uLVdlYkdMIGxheWVyc1xuICAgICAgICAgICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBlZmZlY3RpdmVWaXNpYmxlID0gaXNMYXllckVmZmVjdGl2ZVZpc2libGUobGF5ZXIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlZmZlY3RpdmVWaXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0aWxlID0gZ2V0VGlsZUxheWVyKGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aWxlLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSA9IHRpbGU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBsYXllcnMgbWFuYWdlZCBieSB0aGUgbWVyZ2VkIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgICAgIGlmICh3ZWJnbExheWVySWRzLmhhcyhsYXllci5pZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFlZmZlY3RpdmVWaXNpYmxlIHx8ICFsYXllckluV2luZG93KGxheWVyLCBidWZmZXJTdGF0ZSwgdGltZVN0YXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmcubGF5ZXJUeXBlICE9PSBsYXllci50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZGluYXRlQnVmZmVyc1tsYXllci5pZF0sIG1vZGVsKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0gPSBpbnN0YW5jZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEhlbHBlciB0byBzeW5jIFdlYkdMIGxheWVyIHN0YXRlcyBhbmQgcmVidWlsZCBvbmx5IGlmIGNoYW5nZWRcbiAgICAgICAgICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNHbExheWVyKHR5cGUsIHZpc2libGVMYXllcnMsIHZlY3RvckdwdSA9IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRzU3RyaW5nID0gdmlzaWJsZUxheWVycy5tYXAobCA9PiBsLmlkKS5zb3J0KCkuam9pbihcIixcIik7XG4gICAgICAgICAgICAgICAgLy8gRXZlcnl0aGluZyB0aGUgYnVpbHQgYnVmZmVycyBkZXBlbmQgb24gYmVsb25ncyBpbiB0aGlzIGtleTogYSBjaGFuZ2UgdGhhdFxuICAgICAgICAgICAgICAgIC8vIGlzIG5vdCBpbiBpdCByZW5kZXJzIHN0YWxlLiBoaWdobGlnaHRfc3R5bGUgYW5kIHN0eWxlX292ZXJyaWRlcyB3ZXJlXG4gICAgICAgICAgICAgICAgLy8gbWlzc2luZyBhdCBmaXJzdCwgc28gYSBoaWdobGlnaHQgbGFuZGVkIGluIHN0YXRlIGFuZCBuZXZlciByZXBhaW50ZWQuXG4gICAgICAgICAgICAgICAgLy8gUG9pbnQgYnVja2V0cyBvbiB0aGUgR1BVIHBhdGggZXhjbHVkZSB0aGUgdGljayBhbmQgd2luZG93IGZyb20gdGhlIGtleTpcbiAgICAgICAgICAgICAgICAvLyB0aG9zZSBjaGFuZ2UgcGVyIHRpY2sgYW5kIGFyZSBhcHBsaWVkIGFzIHVuaWZvcm1zLCBub3QgYnkgcmVidWlsZGluZy5cbiAgICAgICAgICAgICAgICAvLyBUaGUgcGVyaW9kIHN0YXlzIGluLCBzaW5jZSBpdCBpcyBiYWtlZCBpbnRvIHRoZSBkdXJhdGlvbiBhdHRyaWJ1dGVzLlxuICAgICAgICAgICAgICAgIC8vIEV2ZXJ5dGhpbmcgZWxzZSAtLSBhbmQgZXZlcnkgbm9uLXBvaW50IGJ1Y2tldCAtLSByZWJ1aWxkcyBhcyBiZWZvcmUuXG4gICAgICAgICAgICAgICAgY29uc3QgZ3B1UG9pbnRzID0gKCh0eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIgfHwgdHlwZSA9PT0gXCJtYXJrZXJzXCIpXG4gICAgICAgICAgICAgICAgICAgICYmIGdwdVRpbWVBdmFpbGFibGUoKSkgfHwgdmVjdG9yR3B1O1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFTdHJpbmcgPSBKU09OLnN0cmluZ2lmeSh2aXNpYmxlTGF5ZXJzLm1hcChsID0+ICh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogbC5jb2xvcixcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiBsLnJhZGl1cyxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogbC5vcGFjaXR5LFxuICAgICAgICAgICAgICAgICAgICBmaWxsT3BhY2l0eTogbC5maWxsT3BhY2l0eSxcbiAgICAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0OiBsLmhpZ2hsaWdodF9zdHlsZSxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVzOiBsLnN0eWxlX292ZXJyaWRlcyxcbiAgICAgICAgICAgICAgICAgICAgZmVhdHVyZVN0eWxlczogbC5mZWF0dXJlX3N0eWxlcyxcbiAgICAgICAgICAgICAgICAgICAgdGltZTogbC50aW1lLFxuICAgICAgICAgICAgICAgICAgICBncHU6IGdwdVBvaW50cyxcbiAgICAgICAgICAgICAgICAgICAgdGljazogbC50aW1lICYmIHRpbWVTdGF0ZSAmJiAhZ3B1UG9pbnRzID8gdGltZVN0YXRlLnRpY2sgOiAwLFxuICAgICAgICAgICAgICAgICAgICB3aW46IGwudGltZSAmJiB0aW1lU3RhdGUgJiYgIWdwdVBvaW50cyA/IHRpbWVTdGF0ZS53aW5kb3cgOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBwZXI6IGwudGltZSAmJiBncHVQb2ludHMgJiYgdGltZVN0YXRlXG4gICAgICAgICAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRpbWVTdGF0ZS5wZXJpb2QpIDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBsb2NMZW46IGwubG9jYXRpb25zPy5sZW5ndGggfHwgMFxuICAgICAgICAgICAgICAgIH0pKSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlQ2hhbmdlZCA9IHN0YXRlLmlkcyAhPT0gaWRzU3RyaW5nIHx8IHN0YXRlLm1ldGEgIT09IG1ldGFTdHJpbmc7XG5cbiAgICAgICAgICAgICAgICBpZiAoc3RhdGVDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBhd2FpdCByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgdmlzaWJsZUxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsLCB0aW1lU3RhdGUsIHZlY3RvckdwdSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllci5hZGRUbyhtYXApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLmlkcyA9IGlkc1N0cmluZztcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUubWV0YSA9IG1ldGFTdHJpbmc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBQb2ludCBidWNrZXRzIGhvbGRpbmcgdGltZSBsYXllcnMga2VlcCBFVkVSWSBwb2ludCBsYXllciAtLSBoaWRkZW4gb25lc1xuICAgICAgICAgICAgLy8gaW5jbHVkZWQgLS0gc28gYSBzaWRlYmFyIHRvZ2dsZSBjaGFuZ2VzIGEgdmlzaWJpbGl0eSB1bmlmb3JtIGluc3RlYWQgb2ZcbiAgICAgICAgICAgIC8vIHRoZSBidWNrZXQncyBpZHMuIFVuY2hlY2tpbmcgb25lIG9mIDI1IHRyYWNrcyB1c2VkIHRvIHJlYnVpbGQgYWxsIDVNXG4gICAgICAgICAgICAvLyBwb2ludHM7IGNsaWNraW5nIGRvd24gdGhlIHNpZGViYXIgc3RhY2tlZCB0aG9zZSByZWJ1aWxkcyBpbnRvIGEgY3Jhc2guXG4gICAgICAgICAgICBjb25zdCBhbGxCeVR5cGUgPSBjb2xsZWN0UG9pbnRMYXllcnNBbGwobGF5ZXJzLCBncm91cENvbmZpZ3MpO1xuICAgICAgICAgICAgLy8gQXJlYSBvdXRsaW5lcyByaWRlIHRoZSBsaW5lcyBidWNrZXQ6IGV2ZXJ5IHBvbHlnb24gYW5kIGNpcmNsZSBqb2lucyBpdCBhc1xuICAgICAgICAgICAgLy8gYW4gZXh0cmEgZW50cnkgd2hvc2UgcmluZ3MgcmVuZGVyIGFzIHdlaWdodGVkIExpbmVTdHJpbmdzICh0aGUgcG9seWdvblxuICAgICAgICAgICAgLy8gYnVja2V0IGRyYXdzIG9ubHkgdGhlIGZpbGwpLiBKb2luaW5nIHVuY29uZGl0aW9uYWxseSAtLSBzdHJva2VsZXNzIGFyZWFzXG4gICAgICAgICAgICAvLyBjb250cmlidXRlIGFuIGVtcHR5IHNsb3QgLS0ga2VlcHMgdGhlIGJ1Y2tldCdzIG1lbWJlcnNoaXAgaW5kZXBlbmRlbnQgb2ZcbiAgICAgICAgICAgIC8vIHN0eWxlIGNoYW5nZXMsIHNvIHJlc3R5bGluZyBhIGJvcmRlciBzdGF5cyBhIHJlYnVpbGQsIG5ldmVyIGEgcmUtYnVja2V0LlxuICAgICAgICAgICAgYWxsQnlUeXBlLnBvbHlsaW5lID0gWy4uLmFsbEJ5VHlwZS5wb2x5bGluZSwgLi4uYWxsQnlUeXBlLnBvbHlnb25dO1xuICAgICAgICAgICAgY29uc3QgYnVja2V0ID0geyBjaXJjbGVfbWFya2Vyczogd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlcnM6IHdlYmdsTWFya2VyTGF5ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb2x5bGluZTogWy4uLndlYmdsUG9seWxpbmVMYXllcnMsIC4uLndlYmdsUG9seWdvbkxheWVyc10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvbHlnb246IHdlYmdsUG9seWdvbkxheWVycyB9O1xuICAgICAgICAgICAgY29uc3QgdmVjdG9yR3B1QnVja2V0ID0geyBwb2x5bGluZTogZmFsc2UsIHBvbHlnb246IGZhbHNlIH07XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHR5cGUgb2YgW1wiY2lyY2xlX21hcmtlcnNcIiwgXCJtYXJrZXJzXCIsIFwicG9seWxpbmVcIiwgXCJwb2x5Z29uXCJdKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZW50cmllcyA9IGFsbEJ5VHlwZVt0eXBlXTtcbiAgICAgICAgICAgICAgICBjb25zdCBpc1BvaW50cyA9IHR5cGUgPT09IFwiY2lyY2xlX21hcmtlcnNcIiB8fCB0eXBlID09PSBcIm1hcmtlcnNcIjtcbiAgICAgICAgICAgICAgICBjb25zdCBhdmFpbGFibGUgPSBpc1BvaW50cyA/IGdwdVRpbWVBdmFpbGFibGUoKSA6IHZlY3RvckdwdUF2YWlsYWJsZSgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGdwdVZpcyA9IGF2YWlsYWJsZSAmJiBlbnRyaWVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICAgICAgJiYgZW50cmllcy5sZW5ndGggPD0gTEFZRVJfU0xPVFNcbiAgICAgICAgICAgICAgICAgICAgJiYgZW50cmllcy5zb21lKGUgPT4gZS5sYXllci50aW1lKTtcbiAgICAgICAgICAgICAgICBnbFN0YXRlc1t0eXBlXS52aXNWZWN0b3IgPSBncHVWaXMgPyBlbnRyaWVzLm1hcChlID0+IChlLnZpcyA/IDEgOiAwKSkgOiBudWxsO1xuICAgICAgICAgICAgICAgIGlmIChncHVWaXMpIGJ1Y2tldFt0eXBlXSA9IGVudHJpZXMubWFwKGUgPT4gZS5sYXllcik7XG4gICAgICAgICAgICAgICAgaWYgKCFpc1BvaW50cykgdmVjdG9yR3B1QnVja2V0W3R5cGVdID0gZ3B1VmlzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcImNpcmNsZV9tYXJrZXJzXCIsIGJ1Y2tldC5jaXJjbGVfbWFya2Vycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcIm1hcmtlcnNcIiwgYnVja2V0Lm1hcmtlcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJwb2x5bGluZVwiLCBidWNrZXQucG9seWxpbmUsIHZlY3RvckdwdUJ1Y2tldC5wb2x5bGluZSk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlnb25cIiwgYnVja2V0LnBvbHlnb24sIHZlY3RvckdwdUJ1Y2tldC5wb2x5Z29uKTtcblxuICAgICAgICAgICAgLy8gUHVzaCB0aGUgY3VycmVudCB3aW5kb3cgaW50byB0aGUgR1BVLWZpbHRlcmVkIHBvaW50IGJ1Y2tldHM6IHR3byB1bmlmb3Jtc1xuICAgICAgICAgICAgLy8gYW5kIGEgcmVkcmF3LCB3aGljaCBpcyB0aGUgZW50aXJlIHBlci10aWNrIGNvc3Qgb2YgdGhlIHRpbWUgc2xpZGVyIHRoZXJlLlxuICAgICAgICAgICAgZm9yIChjb25zdCB0eXBlIG9mIFtcImNpcmNsZV9tYXJrZXJzXCIsIFwibWFya2Vyc1wiLCBcInBvbHlsaW5lXCIsIFwicG9seWdvblwiXSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlID0gZ2xTdGF0ZXNbdHlwZV07XG4gICAgICAgICAgICAgICAgY29uc3QgaGFuZGxlID0gc3RhdGUubGF5ZXIgJiYgc3RhdGUubGF5ZXIuX3N3aWZ0bWFwVGltZTtcbiAgICAgICAgICAgICAgICBpZiAoIWhhbmRsZSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgLy8gTGF5ZXIgdmlzaWJpbGl0eSBmaXJzdCwgYW5kIG9ubHkgd2hlbiBpdCBjaGFuZ2VkOiBhIHRvZ2dsZSBjb3N0cyBvbmVcbiAgICAgICAgICAgICAgICAvLyB1bmlmb3JtIGFycmF5IHdyaXRlIGFuZCBhIHJlZHJhdywgbmV2ZXIgYSByZWJ1aWxkLlxuICAgICAgICAgICAgICAgIGNvbnN0IHZpcyA9IHN0YXRlLnZpc1ZlY3RvcjtcbiAgICAgICAgICAgICAgICBpZiAodmlzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IHZpcy5qb2luKFwiXCIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3RhdGUudmlzS2V5ICE9PSBrZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLnZpc0tleSA9IGtleTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZS5zZXRMYXllclZpc2liaWxpdHkodmlzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGltZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG92ZXJyaWRlTXMgPSB0aW1lU3RhdGUud2luZG93XG4gICAgICAgICAgICAgICAgICAgICAgICA/IHBlcmlvZFRvTXMocGFyc2VQZXJpb2QodGltZVN0YXRlLndpbmRvdykpIDogbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyh0aW1lU3RhdGUudGljaywgb3ZlcnJpZGVNcyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlLnNldFdpbmRvdyhudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlbmRlclNpZGViYXJDb250cm9scyhzaWRlYmFyLCBsYXllcnMsIG1vZGVsLCBtYXAsICgpID0+IHtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGxlZ2VuZENmZyA9IG1vZGVsLmdldChcImxlZ2VuZF9jb25maWdcIikgfHwge307XG4gICAgICAgICAgICBpZiAobW9kZWwuZ2V0KFwic2hvd19sZWdlbmRcIikpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzcGVjID0gZGVyaXZlTGVnZW5kU3BlYyhsYXllcnMsIGdyb3VwQ29uZmlncywgbGVnZW5kQ2ZnKTtcbiAgICAgICAgICAgICAgICByZW5kZXJMZWdlbmQobGVnZW5kRGl2LCBzcGVjLFxuICAgICAgICAgICAgICAgICAgICB7IGRpbUhpZGRlbjogbGVnZW5kQ2ZnLmRpbV9oaWRkZW4gIT09IGZhbHNlIH0pO1xuICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IFBPU0lUSU9OU1tsZWdlbmRDZmcucG9zaXRpb25dIHx8IFBPU0lUSU9OU1tcImJvdHRvbS1sZWZ0XCJdO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgW3Byb3AsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwb3MpKSB7XG4gICAgICAgICAgICAgICAgICAgIGxlZ2VuZERpdi5zdHlsZVtwcm9wXSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsZWdlbmREaXYuc3R5bGUuZGlzcGxheSA9IHNwZWMuZ3JvdXBzLmxlbmd0aCA+IDAgPyBcImJsb2NrXCIgOiBcIm5vbmVcIjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGVnZW5kRGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnNvbGUudGltZUVuZChcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XG4gICAgICAgIGxldCBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcblxuICAgICAgICAvLyBCaW5kIHpvb20gYW5kIGNlbnRlciBjaGFuZ2VzIGJhY2sgdG8gUHl0aG9uIHNhZmVseVxuICAgICAgICBtYXAub24oXCJtb3ZlZW5kXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbWFwLmdldENlbnRlcigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRab29tID0gbWFwLmdldFpvb20oKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCBtb2RlbENlbnRlciA9IG1vZGVsLmdldChcImNlbnRlclwiKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2RlbFpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbW9kZWxab29tICE9PSBjdXJyZW50Wm9vbTtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gIW1vZGVsQ2VudGVyIHx8IFxuICAgICAgICAgICAgICAgICAgICAhQXJyYXkuaXNBcnJheShtb2RlbENlbnRlcikgfHxcbiAgICAgICAgICAgICAgICAgICAgbW9kZWxDZW50ZXIubGVuZ3RoIDwgMiB8fFxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclswXSAtIGNlbnRlci5sYXQpID4gMC4wMDAxIHx8IFxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclsxXSAtIGNlbnRlci5sbmcpID4gMC4wMDAxO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNlbnRlclwiLCBbY2VudGVyLmxhdCwgY2VudGVyLmxuZ10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiem9vbVwiLCBjdXJyZW50Wm9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkIHx8IHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIHNhZmVTYXZlQ2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBtb3ZlZW5kIGhhbmRsZXI6XCIsIGVycik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZ1bmN0aW9uIHVwZGF0ZU1hcFZpZXcoKSB7XG4gICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XG4gICAgICAgICAgICBjb25zdCB6b29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgIGlmIChjZW50ZXIgJiYgQXJyYXkuaXNBcnJheShjZW50ZXIpICYmIGNlbnRlci5sZW5ndGggPj0gMikge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hcENlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBab29tID0gbWFwLmdldFpvb20oKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gTWF0aC5hYnMobWFwQ2VudGVyLmxhdCAtIGNlbnRlclswXSkgPiAwLjAwMDEgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1hcENlbnRlci5sbmcgLSBjZW50ZXJbMV0pID4gMC4wMDAxO1xuICAgICAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbWFwWm9vbSAhPT0gem9vbTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0VmlldyhjZW50ZXIsIHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiID8gem9vbSA6IG1hcFpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiICYmIG1hcC5nZXRab29tKCkgIT09IHpvb20pIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFpvb20oem9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gV2F0Y2ggZm9yIG1hcCB2aWV3IHVwZGF0ZXMgZnJvbSBQeXRob25cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Y2VudGVyXCIsICgpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCkge1xuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXBkYXRlTWFwVmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6em9vbVwiLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ1pvb21Gcm9tTWFwKSB7XG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXBkYXRlTWFwVmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gRml0dGluZyB0aGUgdmlldyBpcyBhIGNvbW1hbmQsIG5vdCBzdGF0ZTogYXNraW5nIHRvIGZpdCB0aGUgc2FtZSBib3VuZHMgdHdpY2VcbiAgICAgICAgLy8gbXVzdCBtb3ZlIHRoZSBtYXAgYm90aCB0aW1lcywgc2luY2UgdGhlIHVzZXIgbWF5IGhhdmUgcGFubmVkIGF3YXkgaW4gYmV0d2Vlbi5cbiAgICAgICAgLy8gVGhlIHJlcXVlc3QgY2FycmllcyBhIHNlcXVlbmNlIG51bWJlciBzbyBhbiBpZGVudGljYWwgZml0IHN0aWxsIGZpcmVzIGEgY2hhbmdlLlxuICAgICAgICBmdW5jdGlvbiBhcHBseUZpdFJlcXVlc3QoKSB7XG4gICAgICAgICAgICBjb25zdCByZXEgPSBtb2RlbC5nZXQoXCJmaXRfYm91bmRzX3JlcXVlc3RcIikgfHwge307XG4gICAgICAgICAgICBjb25zdCBib3VuZHMgPSByZXEuYm91bmRzO1xuICAgICAgICAgICAgaWYgKCFib3VuZHMgfHwgYm91bmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgICAgICBjb25zdCBvcHRpb25zID0ge307XG4gICAgICAgICAgICBpZiAocmVxLnBhZGRpbmcgIT0gbnVsbCkgb3B0aW9ucy5wYWRkaW5nID0gW3JlcS5wYWRkaW5nLCByZXEucGFkZGluZ107XG4gICAgICAgICAgICBpZiAocmVxLm1heF96b29tICE9IG51bGwpIG9wdGlvbnMubWF4Wm9vbSA9IHJlcS5tYXhfem9vbTtcbiAgICAgICAgICAgIG1hcC5maXRCb3VuZHMoYm91bmRzLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgLy8gQXBwbGllZCBhZnRlciB0aGUgZml0LCBzaW5jZSBpdCBpcyByZWxhdGl2ZSB0byB3aGF0ZXZlciB6b29tIHRoZSBmaXQgY2hvc2UuXG4gICAgICAgICAgICBpZiAocmVxLnpvb21fb2Zmc2V0KSB7XG4gICAgICAgICAgICAgICAgbWFwLnNldFpvb20obWFwLmdldFpvb20oKSArIHJlcS56b29tX29mZnNldCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Zml0X2JvdW5kc19yZXF1ZXN0XCIsIGFwcGx5Rml0UmVxdWVzdCk7XG4gICAgICAgIC8vIEEgcmVxdWVzdCBzZXQgYmVmb3JlIHRoaXMgdmlldyBhdHRhY2hlZCAtLSBhIHByZS1kaXNwbGF5IGZpdF9ib3VuZHMoKSBjYWxsLFxuICAgICAgICAvLyBvciB0aGUgdW5pb24gYSBmcmVzaCBtYXAgbWFpbnRhaW5zIGFzIGF1dG8tZml0IHdoaWxlIGxheWVycyBhcmUgYWRkZWQgLS0gaXNcbiAgICAgICAgLy8gYWxyZWFkeSBzdGF0ZSBieSBub3csIHNvIHRoZSBjaGFuZ2UgZXZlbnQgd2lsbCBuZXZlciBmaXJlIGZvciBpdC4gSXQgdXNlZFxuICAgICAgICAvLyB0byBiZSBzaWxlbnRseSBkcm9wcGVkOyBhcHBseSBpdCBvbmNlIHRoZSBtYXAgaXMgcmVhZHkgaW5zdGVhZC5cbiAgICAgICAgbWFwLndoZW5SZWFkeSgoKSA9PiBhcHBseUZpdFJlcXVlc3QoKSk7XG5cbiAgICAgICAgbGV0IHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgbGV0IGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICBsZXQgbmVlZHNTeW5jID0gZmFsc2U7XG5cbiAgICAgICAgYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoaXNTeW5jaW5nKSB7XG4gICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpc1N5bmNpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCBzeW5jTWFwU3RhdGUoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBzeW5jTWFwU3RhdGU6XCIsIGVycik7XG4gICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIGlzU3luY2luZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGlmIChuZWVkc1N5bmMpIHtcbiAgICAgICAgICAgICAgICAgICAgbmVlZHNTeW5jID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gcXVldWVTeW5jKCkge1xuICAgICAgICAgICAgaWYgKCFtb2RlbC5nZXQoXCJhdXRvX3N5bmNcIikpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3luY1RpbWVvdXQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoc3luY1RpbWVvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3luY1RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICBzeW5jVGltZW91dCA9IG51bGw7XG4gICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgIH0sIDUwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgbWFudWFsIHN5bmMgdHJpZ2dlciBjaGFuZ2VzIGZyb20gUHl0aG9uXG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnN5bmNfdHJpZ2dlclwiLCAoKSA9PiB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJbmNyZW1lbnRhbCB1cGRhdGVzIGZyb20gUHl0aG9uLiBBcHBsaWVkIGV2ZW4gd2hlbiBhdXRvX3N5bmMgaXMgb2ZmIHNvIHRoZSBtaXJyb3JcbiAgICAgICAgLy8gc3RheXMgY3VycmVudDsgcXVldWVTeW5jIGRlY2lkZXMgd2hldGhlciB0byBhY3R1YWxseSByZS1yZW5kZXIuXG4gICAgICAgIG1vZGVsLm9uKFwibXNnOmN1c3RvbVwiLCAobXNnLCBidWZmZXJzKSA9PiB7XG4gICAgICAgICAgICBpZiAoIW1zZyB8fCBtc2cua2luZCAhPT0gXCJzd2lmdG1hcF9wYXRjaFwiKSByZXR1cm47XG4gICAgICAgICAgICBhcHBseVBhdGNoT3BzKG1zZy5vcHMgfHwgW10sIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEZ1bGwtc25hcHNob3QgcGF0aHM6IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UsIGFuZCB0aGUgc2lkZWJhciB3cml0aW5nIGBsYXllcnNgXG4gICAgICAgIC8vIGJhY2sgYWZ0ZXIgYSB0b2dnbGUuIEVpdGhlciB3YXkgdGhlIHRyYWl0IGJlY29tZXMgYXV0aG9yaXRhdGl2ZSBhZ2Fpbi5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6bGF5ZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGxheWVyU3RhdGUgPSBtb2RlbC5nZXQoXCJsYXllcnNcIikgfHwgW107XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOmNvb3JkaW5hdGVfYnVmZmVyc1wiLCAoKSA9PiB7XG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IHsgLi4uKG1vZGVsLmdldChcImNvb3JkaW5hdGVfYnVmZmVyc1wiKSB8fCB7fSkgfTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Z3JvdXBfY29uZmlnc1wiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTp0aW1lX2NvbmZpZ1wiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aW1lVUkuc3RhcnRlZCA9IGZhbHNlOyAgIC8vIHJlLWFwcGx5IHNwZWVkL2xvb3AgZnJvbSB0aGUgbmV3IGNvbmZpZ1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBQeXRob24gc3RlZXJpbmcgdGhlIHNsaWRlcjogc25hcCB0byB0aGUgbmVhcmVzdCB0aWNrIGF0IG9yIGFmdGVyIHRoZSByZXF1ZXN0ZWRcbiAgICAgICAgLy8gdGltZS4gR3VhcmRlZCBzbyB0aGUgd2lkZ2V0J3Mgb3duIHdyaXRlYmFjayBkb2VzIG5vdCBsb29wIHRocm91Z2ggaGVyZS5cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6dGltZV9jdXJyZW50XCIsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdhbnRlZCA9IG1vZGVsLmdldChcInRpbWVfY3VycmVudFwiKTtcbiAgICAgICAgICAgIGlmICghdGltZVN0YXRlIHx8ICF0aW1lVUkudGlja3MubGVuZ3RoKSByZXR1cm47XG4gICAgICAgICAgICBpZiAoTWF0aC5hYnMod2FudGVkIC0gdGltZVVJLnRpY2tzW3RpbWVVSS5pbmRleF0pIDwgMSkgcmV0dXJuO1xuICAgICAgICAgICAgbGV0IGlkeCA9IHRpbWVVSS50aWNrcy5maW5kSW5kZXgodCA9PiB0ID49IHdhbnRlZCk7XG4gICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gdGltZVVJLnRpY2tzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBzZWVrVG8oaWR4LCB7IHdyaXRlOiBmYWxzZSB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbG9nb1wiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpzaG93X2xlZ2VuZFwiLCBxdWV1ZVN5bmMpO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsZWdlbmRfY29uZmlnXCIsIHF1ZXVlU3luYyk7XG5cbiAgICAgICAgLy8gQW5ub3VuY2UgdGhpcyB2aWV3IHNvIFB5dGhvbiByZXBsaWVzIHdpdGggYSBmdWxsIHNuYXBzaG90LiBMYXllcnMgYWRkZWQgYmVmb3JlXG4gICAgICAgIC8vIHRoZSB2aWV3IGF0dGFjaGVkIHdvdWxkIG90aGVyd2lzZSBiZSBtaXNzaW5nOiB0aGVpciBwYXRjaGVzIHdlcmUgZW1pdHRlZCBpbnRvIGFcbiAgICAgICAgLy8gd2luZG93IHdoZXJlIG5vdGhpbmcgd2FzIGxpc3RlbmluZy5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIG1vZGVsLnNlbmQoeyBraW5kOiBcInN3aWZ0bWFwX3JlYWR5XCIgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikgeyAvKiBubyBsaXZlIGJhY2tlbmQ7IHRoZSBpbml0aWFsIHN0YXRlIG1lc3NhZ2UgaXMgYWxsIHRoZXJlIGlzICovIH1cblxuICAgICAgICAvLyBSZXNwZWN0IGluaXRpYWwgYXV0b19zeW5jIHN0YXRlIG9yIG1hbnVhbCBzeW5jIHJlcXVlc3RzIHNlbnQgZHVyaW5nIG1hcCBidWlsZGluZ1xuICAgICAgICBpZiAobW9kZWwuZ2V0KFwiYXV0b19zeW5jXCIpIHx8IG1vZGVsLmdldChcInN5bmNfdHJpZ2dlclwiKSA+IDApIHtcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFPLFNBQVMsUUFBUSxJQUFJLEtBQUs7QUFDN0IsTUFBSSxDQUFDLFNBQVMsZUFBZSxFQUFFLEdBQUc7QUFDOUIsVUFBTSxPQUFPLFNBQVMsY0FBYyxNQUFNO0FBQzFDLFNBQUssS0FBSztBQUNWLFNBQUssTUFBTTtBQUNYLFNBQUssT0FBTztBQUNaLGFBQVMsS0FBSyxZQUFZLElBQUk7QUFBQSxFQUNsQztBQUNKO0FBRUEsSUFBTSxnQkFBZ0IsQ0FBQztBQUVoQixTQUFTLE9BQU8sSUFBSSxLQUFLO0FBQzVCLE1BQUksY0FBYyxFQUFFLEdBQUc7QUFDbkIsV0FBTyxjQUFjLEVBQUU7QUFBQSxFQUMzQjtBQUNBLFFBQU0sVUFBVSxJQUFJLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFDN0MsUUFBSSxTQUFTLGVBQWUsRUFBRSxHQUFHO0FBQzdCLGNBQVE7QUFDUjtBQUFBLElBQ0o7QUFDQSxVQUFNLFNBQVMsU0FBUyxjQUFjLFFBQVE7QUFDOUMsV0FBTyxLQUFLO0FBQ1osV0FBTyxNQUFNO0FBQ2IsV0FBTyxTQUFTLE1BQU0sUUFBUTtBQUM5QixXQUFPLFVBQVUsTUFBTSxPQUFPLElBQUksTUFBTSwwQkFBMEIsR0FBRyxFQUFFLENBQUM7QUFDeEUsYUFBUyxLQUFLLFlBQVksTUFBTTtBQUFBLEVBQ3BDLENBQUM7QUFDRCxnQkFBYyxFQUFFLElBQUk7QUFDcEIsU0FBTztBQUNYO0FBRUEsU0FBUyxTQUFTLEtBQUs7QUFDbkIsTUFBSSxDQUFDLElBQUssUUFBTztBQUNqQixRQUFNLElBQUksUUFBUSxNQUFNLEVBQUU7QUFDMUIsTUFBSSxJQUFJLFdBQVcsR0FBRztBQUNsQixVQUFNLElBQUksTUFBTSxFQUFFLEVBQUUsSUFBSSxVQUFRLE9BQU8sSUFB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
