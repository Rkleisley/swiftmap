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
  let modelNeedsUpdate = false;
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
            modelNeedsUpdate = true;
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
            modelNeedsUpdate = true;
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
  return modelNeedsUpdate;
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
      toggleEl.innerText = isCollapsed ? "\u25B8" : "\u25BE";
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
    label.innerText = name;
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
          toggleEl.innerText = !isCollapsed ? "\u25B8" : "\u25BE";
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
        const currentLayers = model.get("layers");
        let updatedLayers = [...currentLayers];
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
          parentNode.layers.forEach((sibLyr) => {
            const active = sibLyr.id === id;
            updatedLayers = updatedLayers.map((origLayer) => {
              if (origLayer.id === sibLyr.id) {
                return { ...origLayer, visible: active };
              }
              return origLayer;
            });
          });
        } else {
          if (isGroup) {
            groupConfigs[path] = {
              ...groupConfigs[path],
              visible: isChecked
            };
            collapsedPaths[path] = !isChecked;
          } else {
            updatedLayers = updatedLayers.map((origLayer) => {
              if (origLayer.id === id) {
                return { ...origLayer, visible: isChecked };
              }
              return origLayer;
            });
          }
        }
        model.set("layers", updatedLayers);
        model.set("group_configs", groupConfigs);
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
async function renderMergedGlLayer(map, type, layersList, coordinateBuffers, model) {
  if (type === "polyline") {
    const features = [];
    for (const layer of layersList) {
      const geojsonCoords = layer.locations.map((c) => [c[1], c[0]]);
      const rgb = parseColor(layer.color, "#3388ff");
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: geojsonCoords
        },
        properties: {
          layer,
          colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: layer.opacity || 1 },
          weight: layer.weight || 3
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
        this.glLines = L.glify.lines({
          map: m,
          data: geojson,
          pane: "polylinesPane",
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
                if (model.comm) {
                  model.set("clicked_layer_id", layer.id);
                  model.set("selected_index", 0);
                  model.save_changes();
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
    for (const layer of layersList) {
      let geojsonCoords = [];
      if (layer.type === "polygon") {
        geojsonCoords = layer.locations.map((c) => [c[1], c[0]]);
        if (geojsonCoords.length > 0) {
          const first = geojsonCoords[0];
          const last = geojsonCoords[geojsonCoords.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            geojsonCoords.push([first[0], first[1]]);
          }
        }
      } else if (layer.type === "circle") {
        const lat = layer.location[0];
        const lon = layer.location[1];
        const radiusMeters = layer.radius || 10;
        const earthRadius = 6378137;
        for (let i = 0; i <= 32; i++) {
          const angle = i * 360 / 32;
          const angleRad = angle * Math.PI / 180;
          const dLat = radiusMeters * Math.cos(angleRad) / earthRadius;
          const dLon = radiusMeters * Math.sin(angleRad) / (earthRadius * Math.cos(lat * Math.PI / 180));
          const newLat = lat + dLat * 180 / Math.PI;
          const newLon = lon + dLon * 180 / Math.PI;
          geojsonCoords.push([newLon, newLat]);
        }
      }
      if (geojsonCoords.length === 0) continue;
      const rgb = parseColor(layer.color, "#3388ff");
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [geojsonCoords]
        },
        properties: {
          layer,
          colorRGB: { r: rgb.r, g: rgb.g, b: rgb.b, a: layer.fillOpacity || 0.2 }
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
        this.glShapes = L.glify.shapes({
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
                if (model.comm) {
                  model.set("clicked_layer_id", layer.id);
                  model.set("selected_index", 0);
                  model.save_changes();
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
  for (const layer of layersList) {
    const colorRGB = parseColor(layer.color, type === "markers" ? "#e61a26" : "#3388ff");
    const coordBuffer = coordinateBuffers[layer.id];
    if (!coordBuffer) {
      if (layer.location) {
        pointsList.push([layer.location[0], layer.location[1]]);
        indexMapping.push({
          layer,
          originalIndex: 0,
          colorRGB
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
    for (let i = 0; i < count; i++) {
      pointsList.push([coords[i * 2], coords[i * 2 + 1]]);
      indexMapping.push({
        layer,
        originalIndex: i,
        colorRGB
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
        size: type === "markers" ? 64 : 5,
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
              if (model.comm) {
                model.set("clicked_layer_id", layer.id);
                model.set("selected_index", originalIndex);
                model.save_changes();
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
      this.glPoints = L.glify.points(glifyOptions);
      setupGlifyProjection(this.glPoints);
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
    function safeSetAndSave(key, value) {
      if (model.comm && document.body.contains(el)) {
        try {
          model.set(key, value);
          model.save_changes();
        } catch (e) {
          originalWarn.call(console, "[SwiftMap] Suppressed sync write error:", e);
        }
      }
    }
    function safeSaveChanges() {
      if (model.comm && document.body.contains(el)) {
        try {
          model.save_changes();
        } catch (e) {
          originalWarn.call(console, "[SwiftMap] Suppressed sync save error:", e);
        }
      }
    }
    console.error = function(...args) {
      originalError.apply(console, args);
      const logs = model.get("js_console_logs") || [];
      logs.push("CONSOLE.ERROR: " + args.map((a) => String(a)).join(" "));
      safeSetAndSave("js_console_logs", [...logs]);
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
          const logs = model.get("js_console_logs") || [];
          logs.push(cleanMsg);
          safeSetAndSave("js_console_logs", [...logs]);
        }
        return;
      }
      originalWarn.apply(console, args);
    };
    window.onerror = function(message, source, lineno, colno, error) {
      const logs = model.get("js_console_logs") || [];
      logs.push(`WINDOW.ONERROR: ${message} at ${source}:${lineno}:${colno}`);
      safeSetAndSave("js_console_logs", [...logs]);
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
      const layers = layerState;
      const groupConfigs = model.get("group_configs") || {};
      const coordinateBuffers = bufferState;
      const radioChanged = normalizeRadioLayers(layers, groupConfigs);
      if (radioChanged && model.comm && document.body.contains(el)) {
        model.set("layers", [...layers]);
        model.set("group_configs", groupConfigs);
        model.save_changes();
      }
      logoDiv.style.display = model.get("show_logo") ? "block" : "none";
      const webglCircleMarkerLayers = [];
      const webglMarkerLayers = [];
      const webglPolylineLayers = [];
      const webglPolygonLayers = [];
      function isLayerEffectiveVisible(l) {
        if (l.visible === false) return false;
        const pathStr = l.layer_group || "Layers";
        const parts = pathStr.split("/");
        let runningPath = "";
        for (const part of parts) {
          runningPath = runningPath ? `${runningPath}/${part}` : part;
          const config = groupConfigs[runningPath];
          if (config && config.visible === false) {
            return false;
          }
        }
        return true;
      }
      function collectWebglLayers(l, parentEffectiveVisible, isSubLayer) {
        if (!parentEffectiveVisible) return;
        if (l.type === "group" && l.layers) {
          l.layers.forEach((sub) => {
            collectWebglLayers(sub, parentEffectiveVisible, true);
          });
          return;
        }
        if (!isSubLayer && l.visible === false) return;
        if (l.type === "circle_markers") {
          webglCircleMarkerLayers.push(l);
        } else if (l.type === "markers") {
          webglMarkerLayers.push(l);
        } else if (l.type === "polyline") {
          webglPolylineLayers.push(l);
        } else if (l.type === "polygon" || l.type === "circle") {
          webglPolygonLayers.push(l);
        }
      }
      layers.forEach((l) => {
        const effectiveVisible = isLayerEffectiveVisible(l);
        collectWebglLayers(l, effectiveVisible);
      });
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
        const effectiveVisible = isLayerEffectiveVisible(layer);
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
        if (!effectiveVisible) {
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
      async function syncGlLayer(type, visibleLayers) {
        const idsString = visibleLayers.map((l) => l.id).sort().join(",");
        const metaString = JSON.stringify(visibleLayers.map((l) => ({
          id: l.id,
          color: l.color,
          radius: l.radius,
          weight: l.weight,
          opacity: l.opacity,
          fillOpacity: l.fillOpacity,
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
            state.layer = await renderMergedGlLayer(map, type, visibleLayers, coordinateBuffers, model);
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
      await syncGlLayer("circle_markers", webglCircleMarkerLayers);
      await syncGlLayer("markers", webglMarkerLayers);
      await syncGlLayer("polyline", webglPolylineLayers);
      await syncGlLayer("polygon", webglPolygonLayers);
      renderSidebarControls(sidebar, layers, model, map, () => {
        performSync();
      });
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
    model.on("change:fit_bounds_coords", () => {
      const bounds = model.get("fit_bounds_coords");
      if (bounds && bounds.length > 0) {
        map.fitBounds(bounds);
      }
    });
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
    model.on("change:show_logo", queueSync);
    if (model.comm) {
      model.send({ kind: "swiftmap_ready" });
    }
    if (model.get("auto_sync") || model.get("sync_trigger") > 0) {
      performSync();
    }
  }
};
export {
  applySwiftmapPatch,
  map_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL3V0aWxzLmpzIiwgIi4uLy4uL3NyYy9zaWRlYmFyLmpzIiwgIi4uLy4uL3NyYy9zaGFkZXJzLmpzIiwgIi4uLy4uL3NyYy9sYXllcnMuanMiLCAiLi4vLi4vc3JjL21hcC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGZ1bmN0aW9uIGxvYWRDU1MoaWQsIHVybCkge1xuICAgIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSB7XG4gICAgICAgIGNvbnN0IGxpbmsgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwibGlua1wiKTtcbiAgICAgICAgbGluay5pZCA9IGlkO1xuICAgICAgICBsaW5rLnJlbCA9IFwic3R5bGVzaGVldFwiO1xuICAgICAgICBsaW5rLmhyZWYgPSB1cmw7XG4gICAgICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQobGluayk7XG4gICAgfVxufVxuXG5jb25zdCBhY3RpdmVMb2FkZXJzID0ge307XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSlMoaWQsIHVybCkge1xuICAgIGlmIChhY3RpdmVMb2FkZXJzW2lkXSkge1xuICAgICAgICByZXR1cm4gYWN0aXZlTG9hZGVyc1tpZF07XG4gICAgfVxuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkpIHtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzY3JpcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic2NyaXB0XCIpO1xuICAgICAgICBzY3JpcHQuaWQgPSBpZDtcbiAgICAgICAgc2NyaXB0LnNyYyA9IHVybDtcbiAgICAgICAgc2NyaXB0Lm9ubG9hZCA9ICgpID0+IHJlc29sdmUoKTtcbiAgICAgICAgc2NyaXB0Lm9uZXJyb3IgPSAoKSA9PiByZWplY3QobmV3IEVycm9yKGBGYWlsZWQgdG8gbG9hZCBzY3JpcHQ6ICR7dXJsfWApKTtcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzY3JpcHQpO1xuICAgIH0pO1xuICAgIGFjdGl2ZUxvYWRlcnNbaWRdID0gcHJvbWlzZTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gaGV4VG9SZ2IoaGV4KSB7XG4gICAgaWYgKCFoZXgpIHJldHVybiBudWxsO1xuICAgIGhleCA9IGhleC5yZXBsYWNlKC9eIy8sICcnKTtcbiAgICBpZiAoaGV4Lmxlbmd0aCA9PT0gMykge1xuICAgICAgICBoZXggPSBoZXguc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIgKyBjaGFyKS5qb2luKCcnKTtcbiAgICB9XG4gICAgaWYgKGhleC5sZW5ndGggIT09IDYpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG51bSA9IHBhcnNlSW50KGhleCwgMTYpO1xuICAgIHJldHVybiB7XG4gICAgICAgIHI6ICgobnVtID4+IDE2KSAmIDI1NSkgLyAyNTUsXG4gICAgICAgIGc6ICgobnVtID4+IDgpICYgMjU1KSAvIDI1NSxcbiAgICAgICAgYjogKG51bSAmIDI1NSkgLyAyNTVcbiAgICB9O1xufVxuXG5sZXQgY29sb3JQcm9iZSA9IG51bGw7XG5cbi8vIEJyb3dzZXJzIHNoaXAgYSBjb21wbGV0ZSBDU1MgY29sb3IgcGFyc2VyIC0tIGV2ZXJ5IG5hbWVkIGNvbG9yLCByZ2IoKSwgaHNsKCksIGh3YigpLlxuLy8gQm9ycm93IGl0IGluc3RlYWQgb2YgbWFpbnRhaW5pbmcgYSBsb29rdXAgdGFibGUuIFJldHVybnMgbnVsbCBvdXRzaWRlIGEgRE9NIChOb2RlIHRlc3RzKSxcbi8vIHdoZXJlIHRoZSBoZXggZmFsbGJhY2sgaW4gcGFyc2VDb2xvciBzdGlsbCBhcHBsaWVzLlxuZnVuY3Rpb24gY3NzQ29sb3JUb1JnYih2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgZG9jdW1lbnQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsO1xuICAgIGlmICghY29sb3JQcm9iZSkgY29sb3JQcm9iZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjYW52YXNcIikuZ2V0Q29udGV4dChcIjJkXCIpO1xuXG4gICAgLy8gQXNzaWduaW5nIGFuIGludmFsaWQgY29sb3IgbGVhdmVzIGZpbGxTdHlsZSB1bnRvdWNoZWQsIHNvIHByb2JlIGFnYWluc3QgdHdvIGRpZmZlcmVudFxuICAgIC8vIHNlbnRpbmVsczogb25seSBhIHZhbHVlIHRoZSBicm93c2VyIGFjdHVhbGx5IHBhcnNlZCBwcm9kdWNlcyB0aGUgc2FtZSByZXN1bHQgdHdpY2UuXG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiMwMDAwMDBcIjtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xuICAgIGNvbnN0IGZpcnN0ID0gY29sb3JQcm9iZS5maWxsU3R5bGU7XG4gICAgY29sb3JQcm9iZS5maWxsU3R5bGUgPSBcIiNmZmZmZmZcIjtcbiAgICBjb2xvclByb2JlLmZpbGxTdHlsZSA9IHZhbHVlO1xuICAgIGlmIChmaXJzdCAhPT0gY29sb3JQcm9iZS5maWxsU3R5bGUpIHJldHVybiBudWxsO1xuXG4gICAgaWYgKGZpcnN0LnN0YXJ0c1dpdGgoXCIjXCIpKSByZXR1cm4gaGV4VG9SZ2IoZmlyc3QpO1xuICAgIGNvbnN0IG1hdGNoID0gZmlyc3QubWF0Y2goL3JnYmE/XFwoKFteKV0rKVxcKS8pO1xuICAgIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHBhcnRzID0gbWF0Y2hbMV0uc3BsaXQoXCIsXCIpLm1hcChwID0+IHBhcnNlRmxvYXQocC50cmltKCkpKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMyB8fCBwYXJ0cy5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHI6IHBhcnRzWzBdIC8gMjU1LCBnOiBwYXJ0c1sxXSAvIDI1NSwgYjogcGFydHNbMl0gLyAyNTUgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29sb3IoY29sb3JTdHIsIGZhbGxiYWNrSGV4ID0gXCIjMzM4OGZmXCIpIHtcbiAgICBpZiAoIWNvbG9yU3RyKSBjb2xvclN0ciA9IGZhbGxiYWNrSGV4O1xuICAgIHJldHVybiBjc3NDb2xvclRvUmdiKGNvbG9yU3RyKVxuICAgICAgICB8fCBoZXhUb1JnYihjb2xvclN0cilcbiAgICAgICAgfHwgY3NzQ29sb3JUb1JnYihmYWxsYmFja0hleClcbiAgICAgICAgfHwgaGV4VG9SZ2IoZmFsbGJhY2tIZXgpXG4gICAgICAgIHx8IHsgcjogMC4yLCBnOiAwLjUsIGI6IDEuMCB9O1xufVxuXG5jb25zdCBVUkxfQVRUUl9CRUZPUkUgPSAvKD86aHJlZnxzcmMpXFxzKj1cXHMqWydcIl0/JC9pO1xuY29uc3QgU0FGRV9VUkwgPSAvXig/Omh0dHBzPzpcXC9cXC98bWFpbHRvOnx0ZWw6fGRhdGE6aW1hZ2VcXC98Wy4vIz9dfFtcXHcuLV0rKD86Wy8/I118JCkpL2k7XG5cbi8vIFByb3BlcnR5IHZhbHVlcyBjb21lIGZyb20gdXNlciBkYXRhIGFuZCBlbmQgdXAgaW4gaW5uZXJIVE1MLCBzbyB0aGV5IGFyZSBlc2NhcGVkLlxuLy8gTWFya3VwIHRoZSBhcHAgYXV0aG9yIHdyb3RlICh0ZW1wbGF0ZXMsIHN0eWxlIHN0cmluZ3MpIGlzIGxlZnQgaW50YWN0LlxuZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZSkge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpXG4gICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcbiAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXG4gICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcbiAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzM5O1wiKTtcbn1cblxuLy8gRXNjYXBpbmcgc3RvcHMgYXR0cmlidXRlIGJyZWFrb3V0IGJ1dCBub3QgXCJqYXZhc2NyaXB0OlwiIGluIGFuIGhyZWYsIHNvIHZhbHVlcyBsYW5kaW5nXG4vLyBpbiBhIFVSTCBhdHRyaWJ1dGUgZ2V0IGEgc2NoZW1lIGNoZWNrLiBDb250cm9sIGNoYXJhY3RlcnMgYXJlIHN0cmlwcGVkIGZpcnN0IGJlY2F1c2Vcbi8vIFwiamF2YVxcdHNjcmlwdDpcIiBzdXJ2aXZlcyBhIG5haXZlIGNvbXBhcmlzb24uXG5mdW5jdGlvbiBzYWZlVXJsKHZhbHVlKSB7XG4gICAgY29uc3QgY29sbGFwc2VkID0gU3RyaW5nKHZhbHVlKS5zcGxpdChcIlwiKS5maWx0ZXIoYyA9PiBjLmNoYXJDb2RlQXQoMCkgPiAzMikuam9pbihcIlwiKTtcbiAgICByZXR1cm4gU0FGRV9VUkwudGVzdChjb2xsYXBzZWQpID8gU3RyaW5nKHZhbHVlKSA6IFwiXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRQcm9wZXJ0aWVzSFRNTChwcm9wcywgZmllbGRzLCBuYW1lcykge1xuICAgIGNvbnN0IHRhcmdldEZpZWxkcyA9IChBcnJheS5pc0FycmF5KGZpZWxkcykgJiYgZmllbGRzLmxlbmd0aCkgPyBmaWVsZHMgOiBPYmplY3Qua2V5cyhwcm9wcyk7XG4gICAgY29uc3QgbGFiZWxzID0gKEFycmF5LmlzQXJyYXkobmFtZXMpICYmIG5hbWVzLmxlbmd0aCA9PT0gdGFyZ2V0RmllbGRzLmxlbmd0aCkgPyBuYW1lcyA6IHRhcmdldEZpZWxkcztcbiAgICBjb25zdCBsaW5lcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGFyZ2V0RmllbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0YXJnZXRGaWVsZHNbaV07XG4gICAgICAgIGlmIChwcm9wc1tmXSA9PT0gdW5kZWZpbmVkIHx8IHByb3BzW2ZdID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgbGluZXMucHVzaChgPGI+JHtlc2NhcGVIdG1sKGxhYmVsc1tpXSl9PC9iPjogJHtlc2NhcGVIdG1sKHByb3BzW2ZdKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oXCI8YnI+XCIpO1xufVxuXG4vLyBcIntjb2x1bW59XCIgaW5zZXJ0cyBvbmUgZXNjYXBlZCB2YWx1ZTsgXCJ7Kn1cIiBpbnNlcnRzIHRoZSBkZWZhdWx0IGZpZWxkIGxpc3QuXG5mdW5jdGlvbiByZW5kZXJUZW1wbGF0ZSh0ZW1wbGF0ZSwgcHJvcHMsIGZpZWxkcywgbmFtZXMpIHtcbiAgICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcKnxcXHcrKVxcfS9nLCAobWF0Y2gsIGtleSwgb2Zmc2V0KSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiKlwiKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0UHJvcGVydGllc0hUTUwocHJvcHMsIGZpZWxkcywgbmFtZXMpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbCA9IHByb3BzW2tleV07XG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHJldHVybiBcIlwiO1xuICAgICAgICBjb25zdCBwcmVjZWRpbmcgPSB0ZW1wbGF0ZS5zbGljZShNYXRoLm1heCgwLCBvZmZzZXQgLSAxNiksIG9mZnNldCk7XG4gICAgICAgIHJldHVybiBlc2NhcGVIdG1sKFVSTF9BVFRSX0JFRk9SRS50ZXN0KHByZWNlZGluZykgPyBzYWZlVXJsKHZhbCkgOiB2YWwpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwga2luZCkge1xuICAgIGNvbnN0IHRlbXBsYXRlID0gbGF5ZXJba2luZCArIFwiX3RlbXBsYXRlXCJdO1xuICAgIGNvbnN0IGZpZWxkcyA9IGxheWVyW2tpbmQgKyBcIl9maWVsZHNcIl07XG4gICAgY29uc3QgbmFtZXMgPSBsYXllcltraW5kICsgXCJfbmFtZXNcIl07XG4gICAgaWYgKHR5cGVvZiB0ZW1wbGF0ZSA9PT0gXCJzdHJpbmdcIiAmJiB0ZW1wbGF0ZSkge1xuICAgICAgICByZXR1cm4gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbiAgICB9XG4gICAgcmV0dXJuIGZvcm1hdFByb3BlcnRpZXNIVE1MKHByb3BzLCBmaWVsZHMsIG5hbWVzKTtcbn1cblxuZnVuY3Rpb24gd3JhcFN0eWxlZChodG1sLCBzdHlsZSkge1xuICAgIGlmICghc3R5bGUpIHJldHVybiBodG1sO1xuICAgIHJldHVybiBgPGRpdiBzdHlsZT1cIiR7ZXNjYXBlSHRtbChzdHlsZSl9XCI+JHtodG1sfTwvZGl2PmA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kUG9wdXAobWFwLCBsYXRsbmcsIHByb3BzLCBsYXllcikge1xuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJwb3B1cFwiKTtcbiAgICBpZiAoaHRtbCAmJiAobGF5ZXIuYXV0b2JpbmRfcG9wdXAgfHwgbGF5ZXIucG9wdXBfZmllbGRzIHx8IGxheWVyLnBvcHVwX3RlbXBsYXRlKSkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0ge307XG4gICAgICAgIGlmIChsYXllci5wb3B1cF9tYXhfd2lkdGgpIG9wdGlvbnMubWF4V2lkdGggPSBsYXllci5wb3B1cF9tYXhfd2lkdGg7XG4gICAgICAgIEwucG9wdXAob3B0aW9ucylcbiAgICAgICAgICAgIC5zZXRMYXRMbmcobGF0bG5nKVxuICAgICAgICAgICAgLnNldENvbnRlbnQod3JhcFN0eWxlZChodG1sLCBsYXllci5wb3B1cF9zdHlsZSkpXG4gICAgICAgICAgICAub3Blbk9uKG1hcCk7XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFRvb2x0aXAobWFwLCBsYXRsbmcsIHByb3BzLCBsYXllciwgbGF5ZXJJbnN0YW5jZSkge1xuICAgIGNvbnN0IGh0bWwgPSByZW5kZXJDb250ZW50KHByb3BzLCBsYXllciwgXCJ0b29sdGlwXCIpO1xuICAgIGlmIChodG1sICYmIChsYXllci5hdXRvYmluZF90b29sdGlwIHx8IGxheWVyLnRvb2x0aXBfZmllbGRzIHx8IGxheWVyLnRvb2x0aXBfdGVtcGxhdGUpKSB7XG4gICAgICAgIGlmICghbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgbGF5ZXJJbnN0YW5jZS5fc2hhcmVkVG9vbHRpcCA9IEwudG9vbHRpcCh7IGRpcmVjdGlvbjogJ3RvcCcsIG9mZnNldDogWzAsIC01XSB9KTtcbiAgICAgICAgfVxuICAgICAgICBsYXllckluc3RhbmNlLl9zaGFyZWRUb29sdGlwXG4gICAgICAgICAgICAuc2V0TGF0TG5nKGxhdGxuZylcbiAgICAgICAgICAgIC5zZXRDb250ZW50KHdyYXBTdHlsZWQoaHRtbCwgbGF5ZXIudG9vbHRpcF9zdHlsZSkpXG4gICAgICAgICAgICAuYWRkVG8obWFwKTtcbiAgICB9XG59XG4iLCAiY29uc3QgY29sbGFwc2VkUGF0aHMgPSB7fTsgIC8vIHBhdGggLT4gY29sbGFwc2VkP1xuXG5mdW5jdGlvbiBnZXRMYXllckJvdW5kcyhsLCBjb29yZGluYXRlQnVmZmVycykge1xuICAgIGlmICghbCkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBTdXBwb3J0IGZvbGRlciB0cmVlIG5vZGVzIChncm91cHMgaW4gc2lkZWJhciB0cmVlKVxuICAgIGlmIChsLmlzR3JvdXApIHtcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGRyZW4gZ3JvdXBzXG4gICAgICAgIE9iamVjdC5rZXlzKGwuY2hpbGRyZW4pLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhsLmNoaWxkcmVuW2tleV0sIGNvb3JkaW5hdGVCdWZmZXJzKTtcbiAgICAgICAgICAgIGlmIChiKSB7XG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgY2hpbGQgbGF5ZXJzXG4gICAgICAgIGwubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGIgPSBnZXRMYXllckJvdW5kcyhseXIsIGNvb3JkaW5hdGVCdWZmZXJzKTtcbiAgICAgICAgICAgIGlmIChiKSB7XG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMF0gPCBtaW5MYXQpIG1pbkxhdCA9IGJbMF1bMF07XG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMF0gPiBtYXhMYXQpIG1heExhdCA9IGJbMV1bMF07XG4gICAgICAgICAgICAgICAgaWYgKGJbMF1bMV0gPCBtaW5Mb24pIG1pbkxvbiA9IGJbMF1bMV07XG4gICAgICAgICAgICAgICAgaWYgKGJbMV1bMV0gPiBtYXhMb24pIG1heExvbiA9IGJbMV1bMV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgaWYgKG1pbkxhdCAhPT0gSW5maW5pdHkpIHtcbiAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKGwuYm91bmRzICYmIGwuYm91bmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGwuYm91bmRzO1xuICAgIH1cbiAgICBpZiAobC50eXBlID09PSBcImdyb3VwXCIgJiYgbC5sYXllcnMpIHtcbiAgICAgICAgbGV0IG1pbkxhdCA9IEluZmluaXR5LCBtYXhMYXQgPSAtSW5maW5pdHk7XG4gICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsLmxheWVycykge1xuICAgICAgICAgICAgY29uc3QgYiA9IGdldExheWVyQm91bmRzKHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnMpO1xuICAgICAgICAgICAgaWYgKGIpIHtcbiAgICAgICAgICAgICAgICBpZiAoYlswXVswXSA8IG1pbkxhdCkgbWluTGF0ID0gYlswXVswXTtcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVswXSA+IG1heExhdCkgbWF4TGF0ID0gYlsxXVswXTtcbiAgICAgICAgICAgICAgICBpZiAoYlswXVsxXSA8IG1pbkxvbikgbWluTG9uID0gYlswXVsxXTtcbiAgICAgICAgICAgICAgICBpZiAoYlsxXVsxXSA+IG1heExvbikgbWF4TG9uID0gYlsxXVsxXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZiAobC5sb2NhdGlvbnMgJiYgbC5sb2NhdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcbiAgICAgICAgbGV0IG1pbkxvbiA9IEluZmluaXR5LCBtYXhMb24gPSAtSW5maW5pdHk7XG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IGwubG9jYXRpb25zLmZsYXQoSW5maW5pdHkpO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvb3Jkcy5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2ldO1xuICAgICAgICAgICAgY29uc3QgbG9uID0gY29vcmRzW2kgKyAxXTtcbiAgICAgICAgICAgIGlmIChsYXQgPCBtaW5MYXQpIG1pbkxhdCA9IGxhdDtcbiAgICAgICAgICAgIGlmIChsYXQgPiBtYXhMYXQpIG1heExhdCA9IGxhdDtcbiAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcbiAgICAgICAgICAgIGlmIChsb24gPiBtYXhMb24pIG1heExvbiA9IGxvbjtcbiAgICAgICAgfVxuICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xuICAgICAgICAgICAgcmV0dXJuIFtbbWluTGF0LCBtaW5Mb25dLCBbbWF4TGF0LCBtYXhMb25dXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZiAoY29vcmRpbmF0ZUJ1ZmZlcnMpIHtcbiAgICAgICAgY29uc3QgYnVmID0gY29vcmRpbmF0ZUJ1ZmZlcnNbbC5pZF07XG4gICAgICAgIGlmIChidWYpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoYnVmLmJ1ZmZlciwgYnVmLmJ5dGVPZmZzZXQsIGJ1Zi5ieXRlTGVuZ3RoIC8gOCk7XG4gICAgICAgICAgICBsZXQgbWluTGF0ID0gSW5maW5pdHksIG1heExhdCA9IC1JbmZpbml0eTtcbiAgICAgICAgICAgIGxldCBtaW5Mb24gPSBJbmZpbml0eSwgbWF4TG9uID0gLUluZmluaXR5O1xuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb29yZHMubGVuZ3RoIC8gMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGF0ID0gY29vcmRzW2kgKiAyXTtcbiAgICAgICAgICAgICAgICBjb25zdCBsb24gPSBjb29yZHNbaSAqIDIgKyAxXTtcbiAgICAgICAgICAgICAgICBpZiAobGF0IDwgbWluTGF0KSBtaW5MYXQgPSBsYXQ7XG4gICAgICAgICAgICAgICAgaWYgKGxhdCA+IG1heExhdCkgbWF4TGF0ID0gbGF0O1xuICAgICAgICAgICAgICAgIGlmIChsb24gPCBtaW5Mb24pIG1pbkxvbiA9IGxvbjtcbiAgICAgICAgICAgICAgICBpZiAobG9uID4gbWF4TG9uKSBtYXhMb24gPSBsb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobWluTGF0ICE9PSBJbmZpbml0eSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBbW21pbkxhdCwgbWluTG9uXSwgW21heExhdCwgbWF4TG9uXV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncykge1xuICAgIGNvbnN0IHRyZWUgPSB7IG5hbWU6IFwiUm9vdFwiLCBwYXRoOiBcIlwiLCBjaGlsZHJlbjoge30sIGxheWVyczogW10sIGlzR3JvdXA6IHRydWUgfTtcbiAgICBpZiAoIWdyb3VwQ29uZmlnc1tcIlwiXSkge1xuICAgICAgICBncm91cENvbmZpZ3NbXCJcIl0gPSB7IG11bHRpX3NlbGVjdDogdHJ1ZSwgdmlzaWJsZTogdHJ1ZSB9O1xuICAgIH1cbiAgICBsYXllcnMuZm9yRWFjaChsID0+IHtcbiAgICAgICAgY29uc3QgcGF0aFN0ciA9IGwubGF5ZXJfZ3JvdXAgfHwgXCJMYXllcnNcIjtcbiAgICAgICAgY29uc3QgcGFydHMgPSBwYXRoU3RyLnNwbGl0KFwiL1wiKTtcbiAgICAgICAgbGV0IGN1cnIgPSB0cmVlO1xuICAgICAgICBsZXQgcnVubmluZ1BhdGggPSBcIlwiO1xuICAgICAgICBwYXJ0cy5mb3JFYWNoKHBhcnQgPT4ge1xuICAgICAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICAgICAgICBpZiAoIWN1cnIuY2hpbGRyZW5bcGFydF0pIHtcbiAgICAgICAgICAgICAgICBjdXJyLmNoaWxkcmVuW3BhcnRdID0ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiBydW5uaW5nUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IHt9LFxuICAgICAgICAgICAgICAgICAgICBsYXllcnM6IFtdLFxuICAgICAgICAgICAgICAgICAgICBpc0dyb3VwOiB0cnVlXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN1cnIgPSBjdXJyLmNoaWxkcmVuW3BhcnRdO1xuICAgICAgICB9KTtcbiAgICAgICAgY3Vyci5sYXllcnMucHVzaChsKTtcbiAgICB9KTtcblxuICAgIGxldCBtb2RlbE5lZWRzVXBkYXRlID0gZmFsc2U7XG4gICAgZnVuY3Rpb24gZW5mb3JjZVJhZGlvVG9nZ2xlcyhub2RlKSB7XG4gICAgICAgIGNvbnN0IGNvbmYgPSBncm91cENvbmZpZ3Nbbm9kZS5wYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xuICAgICAgICBjb25zdCBpc1JhZGlvR3JvdXAgPSBjb25mLm11bHRpX3NlbGVjdCA9PT0gZmFsc2U7XG4gICAgICAgIGlmIChpc1JhZGlvR3JvdXApIHtcbiAgICAgICAgICAgIGxldCBmb3VuZEFjdGl2ZSA9IGZhbHNlO1xuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkR3JvdXAgPSBub2RlLmNoaWxkcmVuW2tleV07XG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSkge1xuICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXSA9IHsgdmlzaWJsZTogdHJ1ZSwgbXVsdGlfc2VsZWN0OiB0cnVlIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnN0IGlzVmlzaWJsZSA9IGdyb3VwQ29uZmlnc1tjaGlsZEdyb3VwLnBhdGhdLnZpc2libGUgIT09IGZhbHNlO1xuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbY2hpbGRHcm91cC5wYXRoXS52aXNpYmxlID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWRQYXRoc1tjaGlsZEdyb3VwLnBhdGhdID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsTmVlZHNVcGRhdGUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRBY3RpdmUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbY2hpbGRHcm91cC5wYXRoXSA9IHRydWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBub2RlLmxheWVycy5mb3JFYWNoKGx5ciA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgaXNWaXNpYmxlID0gbHlyLnZpc2libGUgIT09IGZhbHNlO1xuICAgICAgICAgICAgICAgIGlmIChpc1Zpc2libGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBseXIudmlzaWJsZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWxOZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZEFjdGl2ZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKG5vZGUuY2hpbGRyZW5ba2V5XSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBlbmZvcmNlUmFkaW9Ub2dnbGVzKHRyZWUpO1xuICAgIHJldHVybiBtb2RlbE5lZWRzVXBkYXRlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgbW9kZWwsIG1hcCwgb25MYXllclRvZ2dsZSkge1xuICAgIHNpZGViYXIuaW5uZXJIVE1MID0gXCI8YiBzdHlsZT0nZm9udC1zaXplOiAxM3B4OyBib3JkZXItYm90dG9tOiAycHggc29saWQgI2VlZTsgcGFkZGluZy1ib3R0b206IDRweDsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDhweDsnPkxheWVycyBDb250cm9sPC9iPlwiO1xuICAgIFxuICAgIGNvbnN0IGdyb3VwQ29uZmlncyA9IG1vZGVsLmdldChcImdyb3VwX2NvbmZpZ3NcIikgfHwge307XG5cbiAgICAvLyAxLiBCdWlsZCBhIG5lc3RlZCBoaWVyYXJjaGljYWwgdHJlZSBmcm9tIHRoZSBmbGF0IGxheWVycyBsaXN0XG4gICAgY29uc3QgdHJlZSA9IHsgbmFtZTogXCJSb290XCIsIHBhdGg6IFwiXCIsIGNoaWxkcmVuOiB7fSwgbGF5ZXJzOiBbXSwgaXNHcm91cDogdHJ1ZSB9O1xuICAgIFxuICAgIC8vIEVuc3VyZSByb290LWxldmVsIGNvbmZpZ3MgZGVmYXVsdCB0byBtdWx0aV9zZWxlY3Q6IHRydWUgaWYgbm90IHNwZWNpZmllZFxuICAgIGlmICghZ3JvdXBDb25maWdzW1wiXCJdKSB7XG4gICAgICAgIGdyb3VwQ29uZmlnc1tcIlwiXSA9IHsgbXVsdGlfc2VsZWN0OiB0cnVlLCB2aXNpYmxlOiB0cnVlIH07XG4gICAgfVxuXG4gICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XG4gICAgICAgIGNvbnN0IHBhdGhTdHIgPSBsLmxheWVyX2dyb3VwIHx8IFwiTGF5ZXJzXCI7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gcGF0aFN0ci5zcGxpdChcIi9cIik7XG4gICAgICAgIGxldCBjdXJyID0gdHJlZTtcbiAgICAgICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcbiAgICAgICAgcGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcbiAgICAgICAgICAgIHJ1bm5pbmdQYXRoID0gcnVubmluZ1BhdGggPyBgJHtydW5uaW5nUGF0aH0vJHtwYXJ0fWAgOiBwYXJ0O1xuICAgICAgICAgICAgaWYgKCFjdXJyLmNoaWxkcmVuW3BhcnRdKSB7XG4gICAgICAgICAgICAgICAgY3Vyci5jaGlsZHJlbltwYXJ0XSA9IHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogcGFydCxcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogcnVubmluZ1BhdGgsXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiB7fSxcbiAgICAgICAgICAgICAgICAgICAgbGF5ZXJzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgaXNHcm91cDogdHJ1ZVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjdXJyID0gY3Vyci5jaGlsZHJlbltwYXJ0XTtcbiAgICAgICAgfSk7XG4gICAgICAgIGN1cnIubGF5ZXJzLnB1c2gobCk7XG4gICAgfSk7XG5cbiAgICAvLyAyLiBSZWN1cnNpdmUgZnVuY3Rpb24gdG8gcmVuZGVyIGEgdHJlZSBub2RlXG4gICAgZnVuY3Rpb24gcmVuZGVyTm9kZShub2RlLCBwYXJlbnRFbCwgZGVwdGgsIHBhcmVudE5vZGUsIHBhcmVudEVmZmVjdGl2ZVZpc2libGUpIHtcblxuICAgICAgICBpZiAobm9kZS5wYXRoID09PSBcIlwiKSB7XG4gICAgICAgICAgICAvLyBSZW5kZXIgcm9vdCdzIGNoaWxkIGdyb3VwcyBhbmQgY2hpbGQgbGF5ZXJzIGRpcmVjdGx5IHdpdGhvdXQgaGVhZGVyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhub2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgICAgcmVuZGVyTm9kZShub2RlLmNoaWxkcmVuW2tleV0sIHBhcmVudEVsLCBkZXB0aCwgbm9kZSwgdHJ1ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgcGFyZW50RWwsIGRlcHRoLCBub2RlLCB0cnVlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaXNHcm91cCA9IG5vZGUuaXNHcm91cCA9PT0gdHJ1ZTtcbiAgICAgICAgY29uc3QgcGF0aCA9IGlzR3JvdXAgPyBub2RlLnBhdGggOiBudWxsO1xuICAgICAgICBjb25zdCBuYW1lID0gbm9kZS5uYW1lO1xuICAgICAgICBjb25zdCBpZCA9IGlzR3JvdXAgPyBudWxsIDogbm9kZS5pZDtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgc2VsZWN0aW9uIHR5cGUgKGNoZWNrYm94IHZzIHJhZGlvKSBiYXNlZCBvbiBwYXJlbnQncyBtdWx0aV9zZWxlY3QgY29uZmlnXG4gICAgICAgIGNvbnN0IHBhcmVudFBhdGggPSBwYXJlbnROb2RlID8gcGFyZW50Tm9kZS5wYXRoIDogXCJcIjtcbiAgICAgICAgY29uc3QgcGFyZW50Q29uZiA9IGdyb3VwQ29uZmlnc1twYXJlbnRQYXRoXSB8fCB7IG11bHRpX3NlbGVjdDogdHJ1ZSB9O1xuICAgICAgICBjb25zdCBpc011bHRpU2VsZWN0ID0gcGFyZW50Q29uZi5tdWx0aV9zZWxlY3QgIT09IGZhbHNlO1xuXG4gICAgICAgIGNvbnN0IG5vZGVEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBub2RlRGl2LnN0eWxlLm1hcmdpbkJvdHRvbSA9IFwiNHB4XCI7XG5cbiAgICAgICAgbGV0IHNlbGZWaXNpYmxlID0gdHJ1ZTtcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcbiAgICAgICAgICAgIHNlbGZWaXNpYmxlID0gcGF0aCA9PT0gXCJCYXNlbWFwc1wiID8gdHJ1ZSA6IChncm91cENvbmZpZ3NbcGF0aF0/LnZpc2libGUgIT09IGZhbHNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNlbGZWaXNpYmxlID0gbm9kZS52aXNpYmxlICE9PSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzZWxmRWZmZWN0aXZlVmlzaWJsZSA9IHBhcmVudEVmZmVjdGl2ZVZpc2libGUgJiYgc2VsZlZpc2libGU7XG5cbiAgICAgICAgY29uc3QgaGVhZGVyRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmRpc3BsYXkgPSBcImZsZXhcIjtcbiAgICAgICAgaGVhZGVyRGl2LnN0eWxlLmFsaWduSXRlbXMgPSBcImNlbnRlclwiO1xuICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS51c2VyU2VsZWN0ID0gXCJub25lXCI7XG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS53ZWJraXRVc2VyU2VsZWN0ID0gXCJub25lXCI7XG4gICAgICAgIGhlYWRlckRpdi5zdHlsZS5mb250U2l6ZSA9IFwiMTJweFwiO1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwYXJlbnRFZmZlY3RpdmVWaXNpYmxlKSB7XG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUub3BhY2l0eSA9IFwiMC41XCI7XG4gICAgICAgICAgICBoZWFkZXJEaXYuc3R5bGUuY29sb3IgPSBcIiM4ODhcIjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRvZ2dsZSBFeHBhbmQvQ29sbGFwc2UgYXJyb3dcbiAgICAgICAgbGV0IHRvZ2dsZUVsID0gbnVsbDtcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcbiAgICAgICAgICAgIHRvZ2dsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS5tYXJnaW5SaWdodCA9IFwiNHB4XCI7XG4gICAgICAgICAgICB0b2dnbGVFbC5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFNpemUgPSBcIjE2cHhcIjtcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmxpbmVIZWlnaHQgPSBcIjFcIjtcbiAgICAgICAgICAgIHRvZ2dsZUVsLnN0eWxlLmRpc3BsYXkgPSBcImlubGluZS1ibG9ja1wiO1xuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcbiAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XG4gICAgICAgICAgICB0b2dnbGVFbC5pbm5lclRleHQgPSBpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xuICAgICAgICAgICAgdG9nZ2xlRWwuc3R5bGUuZm9udFdlaWdodCA9IFwiYm9sZFwiO1xuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKHRvZ2dsZUVsKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHNwYWNlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLm1hcmdpblJpZ2h0ID0gXCI0cHhcIjtcbiAgICAgICAgICAgIHNwYWNlci5zdHlsZS53aWR0aCA9IFwiMTRweFwiO1xuICAgICAgICAgICAgc3BhY2VyLnN0eWxlLmRpc3BsYXkgPSBcImlubGluZS1ibG9ja1wiO1xuICAgICAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKHNwYWNlcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVja2JveCBvciBSYWRpbyBpbnB1dCBlbGVtZW50XG4gICAgICAgIGxldCBpbnB1dCA9IG51bGw7XG4gICAgICAgIGlmICghaXNHcm91cCB8fCBwYXRoICE9PSBcIkJhc2VtYXBzXCIpIHtcbiAgICAgICAgICAgIGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlucHV0XCIpO1xuICAgICAgICAgICAgaW5wdXQudHlwZSA9IGlzTXVsdGlTZWxlY3QgPyBcImNoZWNrYm94XCIgOiBcInJhZGlvXCI7XG4gICAgICAgICAgICBpbnB1dC5uYW1lID0gaXNNdWx0aVNlbGVjdCA/IChpc0dyb3VwID8gYGdyb3VwXyR7cGF0aH1gIDogYGxheWVyXyR7aWR9YCkgOiBgcGFyZW50XyR7cGFyZW50UGF0aH1gO1xuICAgICAgICAgICAgaW5wdXQuc3R5bGUubWFyZ2luUmlnaHQgPSBcIjZweFwiO1xuICAgICAgICAgICAgaW5wdXQuc3R5bGUuY3Vyc29yID0gXCJwb2ludGVyXCI7XG4gICAgICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChpc0dyb3VwKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFncm91cENvbmZpZ3NbcGF0aF0pIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBDb25maWdzW3BhdGhdID0geyB2aXNpYmxlOiB0cnVlLCBtdWx0aV9zZWxlY3Q6IHRydWUgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IGdyb3VwQ29uZmlnc1twYXRoXS52aXNpYmxlICE9PSBmYWxzZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaW5wdXQuY2hlY2tlZCA9IG5vZGUudmlzaWJsZSAhPT0gZmFsc2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGhlYWRlckRpdi5hcHBlbmRDaGlsZChpbnB1dCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMYWJlbCBUZXh0XG4gICAgICAgIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgIGxhYmVsLmlubmVyVGV4dCA9IG5hbWU7XG4gICAgICAgIGlmIChpc0dyb3VwKSB7XG4gICAgICAgICAgICBsYWJlbC5zdHlsZS5mb250V2VpZ2h0ID0gXCJib2xkXCI7XG4gICAgICAgIH1cbiAgICAgICAgaGVhZGVyRGl2LmFwcGVuZENoaWxkKGxhYmVsKTtcblxuICAgICAgICBub2RlRGl2LmFwcGVuZENoaWxkKGhlYWRlckRpdik7XG5cbiAgICAgICAgLy8gQ2hpbGRyZW4gRHJhd2VyIChmb3IgZ3JvdXBzKVxuICAgICAgICBsZXQgY2hpbGRyZW5EaXYgPSBudWxsO1xuICAgICAgICBpZiAoaXNHcm91cCkge1xuICAgICAgICAgICAgY2hpbGRyZW5EaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWRQYXRoc1twYXRoXSA9PT0gdHJ1ZTtcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLmRpc3BsYXkgPSBpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xuICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuYm9yZGVyTGVmdCA9IFwiMXB4IGRhc2hlZCAjY2NjXCI7XG4gICAgICAgICAgICBjaGlsZHJlbkRpdi5zdHlsZS5tYXJnaW5MZWZ0ID0gXCI1cHhcIjtcbiAgICAgICAgICAgIGNoaWxkcmVuRGl2LnN0eWxlLnBhZGRpbmdMZWZ0ID0gXCI4cHhcIjtcblxuICAgICAgICAgICAgLy8gUmVuZGVyIHN1Yi1ncm91cHMgYW5kIGxheWVycyByZWN1cnNpdmVseVxuICAgICAgICAgICAgT2JqZWN0LmtleXMobm9kZS5jaGlsZHJlbikuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgICAgIHJlbmRlck5vZGUobm9kZS5jaGlsZHJlbltrZXldLCBjaGlsZHJlbkRpdiwgZGVwdGggKyAxLCBub2RlLCBzZWxmRWZmZWN0aXZlVmlzaWJsZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIG5vZGUubGF5ZXJzLmZvckVhY2gobHlyID0+IHtcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGx5ciwgY2hpbGRyZW5EaXYsIGRlcHRoICsgMSwgbm9kZSwgc2VsZkVmZmVjdGl2ZVZpc2libGUpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIG5vZGVEaXYuYXBwZW5kQ2hpbGQoY2hpbGRyZW5EaXYpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVG9nZ2xlIEV4cGFuZC9Db2xsYXBzZSB3aGVuIGNsaWNraW5nIGhlYWRlciByb3cgKGJhY2tncm91bmQsIGVtcHR5IHNwYWNlLCBvciBhcnJvdylcbiAgICAgICAgaWYgKGlzR3JvdXApIHtcbiAgICAgICAgICAgIGhlYWRlckRpdi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlzQ29sbGFwc2VkID0gY29sbGFwc2VkUGF0aHNbcGF0aF0gPT09IHRydWU7XG4gICAgICAgICAgICAgICAgY29sbGFwc2VkUGF0aHNbcGF0aF0gPSAhaXNDb2xsYXBzZWQ7XG4gICAgICAgICAgICAgICAgaWYgKHRvZ2dsZUVsKSB7XG4gICAgICAgICAgICAgICAgICAgIHRvZ2dsZUVsLmlubmVyVGV4dCA9ICFpc0NvbGxhcHNlZCA/IFwiXHUyNUI4XCIgOiBcIlx1MjVCRVwiO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoY2hpbGRyZW5EaXYpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5EaXYuc3R5bGUuZGlzcGxheSA9ICFpc0NvbGxhcHNlZCA/IFwibm9uZVwiIDogXCJibG9ja1wiO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTGFiZWwgY2xpY2sgbGlzdGVuZXJcbiAgICAgICAgaWYgKGlucHV0KSB7XG4gICAgICAgICAgICBsYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgIGlmIChpc011bHRpU2VsZWN0KSB7XG4gICAgICAgICAgICAgICAgICAgIGlucHV0LmNoZWNrZWQgPSAhaW5wdXQuY2hlY2tlZDtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpbnB1dC5jaGVja2VkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaW5wdXQuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoXCJjaGFuZ2VcIikpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbnB1dCBjaGFuZ2UgbGlzdGVuZXJcbiAgICAgICAgaWYgKGlucHV0KSB7XG4gICAgICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpc0NoZWNrZWQgPSBpbnB1dC5jaGVja2VkO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEZvciByYWRpbyBidXR0b25zLCBvbmx5IHByb2Nlc3MgdGhlIHNlbGVjdGlvbiBldmVudCAoaWdub3JlIGRlLXNlbGVjdGlvbiBldmVudHMpXG4gICAgICAgICAgICAgICAgaWYgKCFpc011bHRpU2VsZWN0ICYmICFpc0NoZWNrZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRMYXllcnMgPSBtb2RlbC5nZXQoXCJsYXllcnNcIik7XG4gICAgICAgICAgICAgICAgbGV0IHVwZGF0ZWRMYXllcnMgPSBbLi4uY3VycmVudExheWVyc107XG5cbiAgICAgICAgICAgICAgICBpZiAoIWlzTXVsdGlTZWxlY3QpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gUmFkaW8gYnV0dG9uIGxvZ2ljOiBzZXQgYWxsIHNpYmxpbmdzIHRvIHZpc2libGU9ZmFsc2UsIGFuZCB0aGlzIHRvIHZpc2libGU9dHJ1ZVxuICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhwYXJlbnROb2RlLmNoaWxkcmVuKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJHcm91cCA9IHBhcmVudE5vZGUuY2hpbGRyZW5ba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkdyb3VwLnBhdGggPT09IHBhdGg7XG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3Nbc2liR3JvdXAucGF0aF0gPSB7IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1tzaWJHcm91cC5wYXRoXSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogYWN0aXZlIFxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3NpYkdyb3VwLnBhdGhdID0gIWFjdGl2ZTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE5vZGUubGF5ZXJzLmZvckVhY2goc2liTHlyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHNpYkx5ci5pZCA9PT0gaWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVkTGF5ZXJzID0gdXBkYXRlZExheWVycy5tYXAob3JpZ0xheWVyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAob3JpZ0xheWVyLmlkID09PSBzaWJMeXIuaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5vcmlnTGF5ZXIsIHZpc2libGU6IGFjdGl2ZSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gb3JpZ0xheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrYm94IGxvZ2ljXG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0dyb3VwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cENvbmZpZ3NbcGF0aF0gPSB7IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmdyb3VwQ29uZmlnc1twYXRoXSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogaXNDaGVja2VkIFxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxhcHNlZFBhdGhzW3BhdGhdID0gIWlzQ2hlY2tlZDtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRMYXllcnMgPSB1cGRhdGVkTGF5ZXJzLm1hcChvcmlnTGF5ZXIgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcmlnTGF5ZXIuaWQgPT09IGlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7IC4uLm9yaWdMYXllciwgdmlzaWJsZTogaXNDaGVja2VkIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBvcmlnTGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImxheWVyc1wiLCB1cGRhdGVkTGF5ZXJzKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJncm91cF9jb25maWdzXCIsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoaXNDaGVja2VkICYmIG1hcCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBib3VuZHMgPSBnZXRMYXllckJvdW5kcyhub2RlLCBtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYm91bmRzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZml0Qm91bmRzKGJvdW5kcyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAob25MYXllclRvZ2dsZSkge1xuICAgICAgICAgICAgICAgICAgICBvbkxheWVyVG9nZ2xlKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBwYXJlbnRFbC5hcHBlbmRDaGlsZChub2RlRGl2KTtcbiAgICB9XG5cbiAgICAvLyBSZW5kZXIgdHJlZSBmcm9tIHJvb3Qgbm9kZVxuICAgIHJlbmRlck5vZGUodHJlZSwgc2lkZWJhciwgMCwgbnVsbCwgdHJ1ZSk7XG59XG4iLCAiZXhwb3J0IGNvbnN0IHBpblNoYWRlciA9IGBcbnByZWNpc2lvbiBtZWRpdW1wIGZsb2F0O1xudmFyeWluZyB2ZWM0IF9jb2xvcjtcbnZvaWQgbWFpbigpIHtcbiAgICAvLyB1diByYW5nZXMgZnJvbSAtMC41IHRvIDAuNS4gVGhlIGNlbnRlciAoMC4wLCAwLjApIGlzIHRoZSBleGFjdCBjb29yZGluYXRlLlxuICAgIHZlYzIgdXYgPSBnbF9Qb2ludENvb3JkLnh5IC0gdmVjMigwLjUpO1xuXG4gICAgLy8gUGluIGhlYWQgY2lyY2xlIGNlbnRlcmVkIGF0ICgwLjAsIC0wLjMwKSB3aXRoIHJhZGl1cyAwLjE2XG4gICAgZmxvYXQgZF9jaXJjbGUgPSBsZW5ndGgodXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XG4gICAgXG4gICAgLy8gUGluIGJvZHkgdHJpYW5nbGUgcG9pbnRpbmcgZXhhY3RseSB0byAoMC4wLCAwLjApXG4gICAgZmxvYXQgZF90cmlhbmdsZSA9IG1heChhYnModXYueCkgKiAxLjg3NSArIHV2LnksIC11di55IC0gMC4zMCk7XG4gICAgZmxvYXQgZF9waW4gPSBtaW4oZF9jaXJjbGUsIGRfdHJpYW5nbGUpO1xuXG4gICAgLy8gSW5uZXIgaG9sZSBjZW50ZXJlZCBhdCAoMC4wLCAtMC4zMCkgd2l0aCByYWRpdXMgMC4wNlxuICAgIGZsb2F0IGRfaG9sZSA9IGxlbmd0aCh1diAtIHZlYzIoMC4wLCAtMC4zMCkpIC0gMC4wNjtcblxuICAgIC8vIERyb3Agc2hhZG93IHNoaWZ0ZWQgc2xpZ2h0bHkgZG93biBhbmQgYmx1cnJlZFxuICAgIHZlYzIgc2hhZG93VXYgPSB1diAtIHZlYzIoMC4wLCAwLjA0KTtcbiAgICBmbG9hdCBkX3NoYWRvd19jaXJjbGUgPSBsZW5ndGgoc2hhZG93VXYgLSB2ZWMyKDAuMCwgLTAuMzApKSAtIDAuMTY7XG4gICAgZmxvYXQgZF9zaGFkb3dfdHJpYW5nbGUgPSBtYXgoYWJzKHNoYWRvd1V2LngpICogMS44NzUgKyBzaGFkb3dVdi55LCAtc2hhZG93VXYueSAtIDAuMzApO1xuICAgIGZsb2F0IGRfc2hhZG93ID0gbWluKGRfc2hhZG93X2NpcmNsZSwgZF9zaGFkb3dfdHJpYW5nbGUpO1xuXG4gICAgLy8gQW50aS1hbGlhc2VkIG1hc2tzXG4gICAgZmxvYXQgbWFza19waW4gPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluKTtcbiAgICBmbG9hdCBtYXNrX2hvbGUgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfaG9sZSk7XG4gICAgZmxvYXQgbWFza19ib3JkZXIgPSAxLjAgLSBzbW9vdGhzdGVwKC0wLjAxMiwgMC4wMTIsIGRfcGluICsgMC4wMjUpO1xuICAgIGZsb2F0IG1hc2tfc2hhZG93ID0gMS4wIC0gc21vb3Roc3RlcCgtMC4wMywgMC4wNCwgZF9zaGFkb3cpO1xuXG4gICAgLy8gQ29tcG9zaXRlIGxheWVyc1xuICAgIHZlYzQgc2hhZG93Q29sb3IgPSB2ZWM0KDAuMCwgMC4wLCAwLjAsIDAuMjUpICogbWFza19zaGFkb3c7XG4gICAgdmVjNCBib2R5Q29sb3IgPSBtaXgodmVjNCgwLjAsIDAuMCwgMC4wLCAwLjg1KSwgdmVjNChfY29sb3IucmdiLCBfY29sb3IuYSksIG1hc2tfYm9yZGVyKTtcbiAgICB2ZWM0IHdpdGhIb2xlID0gbWl4KGJvZHlDb2xvciwgdmVjNCgxLjAsIDEuMCwgMS4wLCAxLjApLCBtYXNrX2hvbGUpO1xuXG4gICAgZ2xfRnJhZ0NvbG9yID0gbWl4KHNoYWRvd0NvbG9yLCB3aXRoSG9sZSwgbWFza19waW4pO1xufWA7XG4iLCAiaW1wb3J0IHsgbG9hZEpTLCBiaW5kUG9wdXAsIGJpbmRUb29sdGlwLCBwYXJzZUNvbG9yIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHBpblNoYWRlciB9IGZyb20gXCIuL3NoYWRlcnMuanNcIjtcblxuZnVuY3Rpb24gc2V0dXBHbGlmeVByb2plY3Rpb24oZ2xJbnN0YW5jZSkge1xuICAgIGlmIChnbEluc3RhbmNlICYmIGdsSW5zdGFuY2UubGF5ZXIpIHtcbiAgICAgICAgZ2xJbnN0YW5jZS5sYXllci5fdW5jbGFtcGVkUHJvamVjdCA9IGZ1bmN0aW9uKGxhdGxuZywgem9vbSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX21hcC5vcHRpb25zLmNycy5sYXRMbmdUb1BvaW50KGxhdGxuZywgem9vbSk7XG4gICAgICAgIH07XG4gICAgICAgIGdsSW5zdGFuY2UubGF5ZXIucmVkcmF3KCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XG4gICAgaWYgKCFtYXAuX2NsaWNrTWF0Y2hlcykge1xuICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcyA9IFtdO1xuICAgIH1cbiAgICBtYXAuX2NsaWNrTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcbiAgICBpZiAoIW1hcC5fY2xpY2tUaW1lb3V0KSB7XG4gICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBtYXAuX2NsaWNrTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XG4gICAgICAgICAgICBpZiAobWFwLl9jbGlja01hdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIG1hcC5fY2xpY2tNYXRjaGVzWzBdLmFjdGlvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwLl9jbGlja01hdGNoZXMgPSBbXTtcbiAgICAgICAgICAgIG1hcC5fY2xpY2tUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgMCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCBwcmlvcml0eSwgYWN0aW9uKSB7XG4gICAgaWYgKCFtYXAuX2hvdmVyTWF0Y2hlcykge1xuICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcyA9IFtdO1xuICAgIH1cbiAgICBtYXAuX2hvdmVyTWF0Y2hlcy5wdXNoKHsgcHJpb3JpdHksIGFjdGlvbiB9KTtcbiAgICBpZiAoIW1hcC5faG92ZXJUaW1lb3V0KSB7XG4gICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBtYXAuX2hvdmVyTWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSk7XG4gICAgICAgICAgICBpZiAobWFwLl9ob3Zlck1hdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIG1hcC5faG92ZXJNYXRjaGVzWzBdLmFjdGlvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwLl9ob3Zlck1hdGNoZXMgPSBbXTtcbiAgICAgICAgICAgIG1hcC5faG92ZXJUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgMCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRJbmRleGVkUHJvcGVydGllcyhwcm9wZXJ0aWVzLCBpbmRleCkge1xuICAgIGlmICghcHJvcGVydGllcykgcmV0dXJuIHt9O1xuICAgIGNvbnN0IHByb3BzID0ge307XG4gICAgT2JqZWN0LmtleXMocHJvcGVydGllcykuZm9yRWFjaChrID0+IHtcbiAgICAgICAgY29uc3QgdmFsID0gcHJvcGVydGllc1trXTtcbiAgICAgICAgcHJvcHNba10gPSBBcnJheS5pc0FycmF5KHZhbCkgPyB2YWxbaW5kZXhdIDogdmFsO1xuICAgIH0pO1xuICAgIHJldHVybiBwcm9wcztcbn1cblxuXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJMYXllcihtYXAsIGxheWVyLCBjb29yZEJ1ZmZlciwgbW9kZWwpIHtcbiAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJncm91cFwiKSB7XG4gICAgICAgIGNvbnN0IGdyb3VwID0gTC5sYXllckdyb3VwKCk7XG4gICAgICAgIGNvbnN0IGNvb3JkaW5hdGVCdWZmZXJzID0gbW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiBsYXllci5sYXllcnMpIHtcbiAgICAgICAgICAgIGlmIChzdWIudHlwZSA9PT0gXCJjaXJjbGVfbWFya2Vyc1wiIHx8IHN1Yi50eXBlID09PSBcIm1hcmtlcnNcIiB8fCBzdWIudHlwZSA9PT0gXCJwb2x5bGluZVwiIHx8IHN1Yi50eXBlID09PSBcInBvbHlnb25cIiB8fCBzdWIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCByZW5kZXJMYXllcihtYXAsIHN1YiwgY29vcmRpbmF0ZUJ1ZmZlcnNbc3ViLmlkXSwgbW9kZWwpO1xuICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgZ3JvdXAuYWRkTGF5ZXIoaW5zdGFuY2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGdyb3VwLmFkZFRvKG1hcCk7XG4gICAgICAgIGdyb3VwLmxheWVyVHlwZSA9IGxheWVyLnR5cGU7XG4gICAgICAgIHJldHVybiBncm91cDtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgbGF5ZXJzTGlzdCwgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsKSB7XG4gICAgaWYgKHR5cGUgPT09IFwicG9seWxpbmVcIikge1xuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgICAgIGNvbnN0IGdlb2pzb25Db29yZHMgPSBsYXllci5sb2NhdGlvbnMubWFwKGMgPT4gW2NbMV0sIGNbMF1dKTtcbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIFwiIzMzODhmZlwiKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiTGluZVN0cmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBjb29yZGluYXRlczogZ2VvanNvbkNvb3Jkc1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yUkdCOiB7IHI6IHJnYi5yLCBnOiByZ2IuZywgYjogcmdiLmIsIGE6IGxheWVyLm9wYWNpdHkgfHwgMS4wIH0sXG4gICAgICAgICAgICAgICAgICAgIHdlaWdodDogbGF5ZXIud2VpZ2h0IHx8IDNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmdsTGluZXMgPSBMLmdsaWZ5LmxpbmVzKHtcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBtLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBnZW9qc29uLFxuICAgICAgICAgICAgICAgICAgICBwYW5lOiBcInBvbHlsaW5lc1BhbmVcIixcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IChpbmRleCwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZlYXR1cmUucHJvcGVydGllcy5jb2xvclJHQjtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMud2VpZ2h0O1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBjbGljazogKGUsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZ2lzdGVyQ2xpY2tNYXRjaChtYXAsIDIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kUG9wdXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobW9kZWwuY29tbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiY2xpY2tlZF9sYXllcl9pZFwiLCBsYXllci5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCAwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZSAmJiBmZWF0dXJlLnByb3BlcnRpZXMgJiYgZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJIb3Zlck1hdGNoKG1hcCwgMiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGZlYXR1cmUucHJvcGVydGllcy5sYXllcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmluZFRvb2x0aXAobWFwLCBlLmxhdGxuZywgbGF5ZXIucHJvcGVydGllcywgbGF5ZXIsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbExpbmVzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbExpbmVzKSB0aGlzLmdsTGluZXMucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1hcC5nZXRDb250YWluZXIoKS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGdsTGF5ZXIoKTtcbiAgICAgICAgaW5zdGFuY2UuYWRkVG8obWFwKTtcbiAgICAgICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSBcInBvbHlnb25cIikge1xuICAgICAgICBjb25zdCBmZWF0dXJlcyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVyc0xpc3QpIHtcbiAgICAgICAgICAgIGxldCBnZW9qc29uQ29vcmRzID0gW107XG4gICAgICAgICAgICBpZiAobGF5ZXIudHlwZSA9PT0gXCJwb2x5Z29uXCIpIHtcbiAgICAgICAgICAgICAgICBnZW9qc29uQ29vcmRzID0gbGF5ZXIubG9jYXRpb25zLm1hcChjID0+IFtjWzFdLCBjWzBdXSk7XG4gICAgICAgICAgICAgICAgaWYgKGdlb2pzb25Db29yZHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaXJzdCA9IGdlb2pzb25Db29yZHNbMF07XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxhc3QgPSBnZW9qc29uQ29vcmRzW2dlb2pzb25Db29yZHMubGVuZ3RoIC0gMV07XG4gICAgICAgICAgICAgICAgICAgIGlmIChmaXJzdFswXSAhPT0gbGFzdFswXSB8fCBmaXJzdFsxXSAhPT0gbGFzdFsxXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ2VvanNvbkNvb3Jkcy5wdXNoKFtmaXJzdFswXSwgZmlyc3RbMV1dKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAobGF5ZXIudHlwZSA9PT0gXCJjaXJjbGVcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhdCA9IGxheWVyLmxvY2F0aW9uWzBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvbiA9IGxheWVyLmxvY2F0aW9uWzFdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJhZGl1c01ldGVycyA9IGxheWVyLnJhZGl1cyB8fCAxMDtcbiAgICAgICAgICAgICAgICBjb25zdCBlYXJ0aFJhZGl1cyA9IDYzNzgxMzc7XG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gMzI7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbmdsZSA9IChpICogMzYwKSAvIDMyO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbmdsZVJhZCA9IChhbmdsZSAqIE1hdGguUEkpIC8gMTgwO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkTGF0ID0gKHJhZGl1c01ldGVycyAqIE1hdGguY29zKGFuZ2xlUmFkKSkgLyBlYXJ0aFJhZGl1cztcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZExvbiA9IChyYWRpdXNNZXRlcnMgKiBNYXRoLnNpbihhbmdsZVJhZCkpIC8gKGVhcnRoUmFkaXVzICogTWF0aC5jb3MoKGxhdCAqIE1hdGguUEkpIC8gMTgwKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0xhdCA9IGxhdCArIChkTGF0ICogMTgwKSAvIE1hdGguUEk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0xvbiA9IGxvbiArIChkTG9uICogMTgwKSAvIE1hdGguUEk7XG4gICAgICAgICAgICAgICAgICAgIGdlb2pzb25Db29yZHMucHVzaChbbmV3TG9uLCBuZXdMYXRdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChnZW9qc29uQ29vcmRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cbiAgICAgICAgICAgIGNvbnN0IHJnYiA9IHBhcnNlQ29sb3IobGF5ZXIuY29sb3IsIFwiIzMzODhmZlwiKTtcbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6IFwiRmVhdHVyZVwiLFxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwiUG9seWdvblwiLFxuICAgICAgICAgICAgICAgICAgICBjb29yZGluYXRlczogW2dlb2pzb25Db29yZHNdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IHsgcjogcmdiLnIsIGc6IHJnYi5nLCBiOiByZ2IuYiwgYTogbGF5ZXIuZmlsbE9wYWNpdHkgfHwgMC4yIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmZWF0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGdlb2pzb24gPSB7XG4gICAgICAgICAgICB0eXBlOiBcIkZlYXR1cmVDb2xsZWN0aW9uXCIsXG4gICAgICAgICAgICBmZWF0dXJlczogZmVhdHVyZXNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBnbExheWVyID0gTC5MYXllci5leHRlbmQoe1xuICAgICAgICAgICAgb25BZGQ6IGZ1bmN0aW9uKG0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgICAgIHRoaXMuX2lzSG92ZXJpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX2lzSG92ZXJpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3NoYXJlZFRvb2x0aXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcC5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmdsU2hhcGVzID0gTC5nbGlmeS5zaGFwZXMoe1xuICAgICAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGdlb2pzb24sXG4gICAgICAgICAgICAgICAgICAgIHBhbmU6IFwicG9seWdvbnNQYW5lXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAoaW5kZXgsIGZlYXR1cmUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmZWF0dXJlLnByb3BlcnRpZXMuY29sb3JSR0I7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoZSwgZmVhdHVyZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVnaXN0ZXJDbGlja01hdGNoKG1hcCwgMywgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGF5ZXIgPSBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2RlbC5jb21tKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJjbGlja2VkX2xheWVyX2lkXCIsIGxheWVyLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcInNlbGVjdGVkX2luZGV4XCIsIDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaG92ZXI6IChlLCBmZWF0dXJlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9pc0hvdmVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmZWF0dXJlICYmIGZlYXR1cmUucHJvcGVydGllcyAmJiBmZWF0dXJlLnByb3BlcnRpZXMubGF5ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAzLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxheWVyID0gZmVhdHVyZS5wcm9wZXJ0aWVzLmxheWVyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiaW5kVG9vbHRpcChtYXAsIGUubGF0bG5nLCBsYXllci5wcm9wZXJ0aWVzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBzZXR1cEdsaWZ5UHJvamVjdGlvbih0aGlzLmdsU2hhcGVzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24obSkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5nbFNoYXBlcykgdGhpcy5nbFNoYXBlcy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zaGFyZWRUb29sdGlwID0gbnVsbDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgICAgICBpbnN0YW5jZS5hZGRUbyhtYXApO1xuICAgICAgICBpbnN0YW5jZS5sYXllclR5cGUgPSB0eXBlO1xuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgY29uc3QgcG9pbnRzTGlzdCA9IFtdO1xuICAgIGNvbnN0IGluZGV4TWFwcGluZyA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBsYXllciBvZiBsYXllcnNMaXN0KSB7XG4gICAgICAgIGNvbnN0IGNvbG9yUkdCID0gcGFyc2VDb2xvcihsYXllci5jb2xvciwgdHlwZSA9PT0gXCJtYXJrZXJzXCIgPyBcIiNlNjFhMjZcIiA6IFwiIzMzODhmZlwiKTtcblxuICAgICAgICBjb25zdCBjb29yZEJ1ZmZlciA9IGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXTtcbiAgICAgICAgaWYgKCFjb29yZEJ1ZmZlcikge1xuICAgICAgICAgICAgaWYgKGxheWVyLmxvY2F0aW9uKSB7XG4gICAgICAgICAgICAgICAgcG9pbnRzTGlzdC5wdXNoKFtsYXllci5sb2NhdGlvblswXSwgbGF5ZXIubG9jYXRpb25bMV1dKTtcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmcucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIGxheWVyOiBsYXllcixcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxJbmRleDogMCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3JSR0I6IGNvbG9yUkdCXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvb3JkcyA9IG5ldyBGbG9hdDY0QXJyYXkoXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5idWZmZXIsXG4gICAgICAgICAgICBjb29yZEJ1ZmZlci5ieXRlT2Zmc2V0LFxuICAgICAgICAgICAgY29vcmRCdWZmZXIuYnl0ZUxlbmd0aCAvIDhcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgY291bnQgPSBjb29yZHMubGVuZ3RoIC8gMjtcblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgIHBvaW50c0xpc3QucHVzaChbY29vcmRzW2kgKiAyXSwgY29vcmRzW2kgKiAyICsgMV1dKTtcbiAgICAgICAgICAgIGluZGV4TWFwcGluZy5wdXNoKHtcbiAgICAgICAgICAgICAgICBsYXllcjogbGF5ZXIsXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxJbmRleDogaSxcbiAgICAgICAgICAgICAgICBjb2xvclJHQjogY29sb3JSR0JcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBvaW50c0xpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IGdsTGF5ZXIgPSBMLkxheWVyLmV4dGVuZCh7XG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICB0aGlzLl9tYXAgPSBtO1xuICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjb25zdCBnZXRJbnRlcmFjdGl2ZUVsID0gKCkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKSB8fCBtYXAuZ2V0Q29udGFpbmVyKCk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLl9tYXBNb3VzZU1vdmVIYW5kbGVyID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9pc0hvdmVyaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbCkgZWwuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIG0ub24oXCJtb3VzZW1vdmVcIiwgdGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcik7XG5cbiAgICAgICAgICAgIGNvbnN0IGdsaWZ5T3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBtYXA6IG0sXG4gICAgICAgICAgICAgICAgZGF0YTogcG9pbnRzTGlzdCxcbiAgICAgICAgICAgICAgICBwYW5lOiBcInBvaW50c1BhbmVcIixcbiAgICAgICAgICAgICAgICBzaXplOiB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDY0IDogNSxcbiAgICAgICAgICAgICAgICBjb2xvcjogKGluZGV4LCBwb2ludCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gaW5kZXhNYXBwaW5nW2luZGV4XTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGluZm8gPyBpbmZvLmNvbG9yUkdCIDogeyByOiAwLjIsIGc6IDAuNSwgYjogMS4wIH07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwaWNraW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNlbnNpdGl2aXR5OiB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDIwIDogOCxcbiAgICAgICAgICAgICAgICBjbGljazogKGUsIHBvaW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghcG9pbnQpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICAvLyBFbmZvcmNlIGEgc3RyaWN0IHBpeGVsLWRpc3RhbmNlIHRocmVzaG9sZCB0byBwcmV2ZW50IHBvcHVwcyBvbiBmYXIgYXdheSBjbGlja3NcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xpY2tQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KGUubGF0bG5nKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2VyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChMLmxhdExuZyhwb2ludFswXSwgcG9pbnRbMV0pKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gY2xpY2tQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4RGlzdCA9IHR5cGUgPT09IFwibWFya2Vyc1wiID8gMjUgOiAxMjtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBpeGVsRGlzdCA+IG1heERpc3QpIHJldHVybjtcblxuICAgICAgICAgICAgICAgICAgICByZWdpc3RlckNsaWNrTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGluZGV4TWFwcGluZ1tpZHhdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZm8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxJbmRleCA9IGluZm8ub3JpZ2luYWxJbmRleDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IGdldEluZGV4ZWRQcm9wZXJ0aWVzKGxheWVyLnByb3BlcnRpZXMsIG9yaWdpbmFsSW5kZXgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRQb3B1cChtYXAsIHBvaW50LCBwcm9wcywgbGF5ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2RlbC5jb21tKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNsaWNrZWRfbGF5ZXJfaWRcIiwgbGF5ZXIuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJzZWxlY3RlZF9pbmRleFwiLCBvcmlnaW5hbEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2F2ZV9jaGFuZ2VzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGhvdmVyOiAoZSwgcG9pbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5faXNIb3ZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwb2ludCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5mb3JjZSBhIHN0cmljdCBwaXhlbC1kaXN0YW5jZSB0aHJlc2hvbGQgdG8gcHJldmVudCB0b29sdGlwcyBvbiBmYXIgYXdheSBob3ZlcnNcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGhvdmVyUG9pbnQgPSBtYXAubGF0TG5nVG9Db250YWluZXJQb2ludChlLmxhdGxuZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZXJQb2ludCA9IG1hcC5sYXRMbmdUb0NvbnRhaW5lclBvaW50KEwubGF0TG5nKHBvaW50WzBdLCBwb2ludFsxXSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGl4ZWxEaXN0ID0gaG92ZXJQb2ludC5kaXN0YW5jZVRvKG1hcmtlclBvaW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1heERpc3QgPSB0eXBlID09PSBcIm1hcmtlcnNcIiA/IDI1IDogMTI7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocGl4ZWxEaXN0ID4gbWF4RGlzdCkgcmV0dXJuO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICByZWdpc3RlckhvdmVyTWF0Y2gobWFwLCAxLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmdldENvbnRhaW5lcigpLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbCA9IGdldEludGVyYWN0aXZlRWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZWwpIGVsLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBwb2ludHNMaXN0LmluZGV4T2YocG9pbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBpbmRleE1hcHBpbmdbaWR4XTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5mbykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXllciA9IGluZm8ubGF5ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsSW5kZXggPSBpbmZvLm9yaWdpbmFsSW5kZXg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb3BzID0gZ2V0SW5kZXhlZFByb3BlcnRpZXMobGF5ZXIucHJvcGVydGllcywgb3JpZ2luYWxJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbmRUb29sdGlwKG1hcCwgcG9pbnQsIHByb3BzLCBsYXllciwgdGhpcyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAodHlwZSA9PT0gXCJtYXJrZXJzXCIpIHtcbiAgICAgICAgICAgICAgICBnbGlmeU9wdGlvbnMuZnJhZ21lbnRTaGFkZXJTb3VyY2UgPSAoKSA9PiBwaW5TaGFkZXI7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuZ2xQb2ludHMgPSBMLmdsaWZ5LnBvaW50cyhnbGlmeU9wdGlvbnMpO1xuICAgICAgICAgICAgc2V0dXBHbGlmeVByb2plY3Rpb24odGhpcy5nbFBvaW50cyk7XG4gICAgICAgIH0sXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbihtKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwTW91c2VNb3ZlSGFuZGxlcikge1xuICAgICAgICAgICAgICAgIG0ub2ZmKFwibW91c2Vtb3ZlXCIsIHRoaXMuX21hcE1vdXNlTW92ZUhhbmRsZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZ2xQb2ludHMpIHRoaXMuZ2xQb2ludHMucmVtb3ZlKCk7XG4gICAgICAgICAgICBpZiAodGhpcy5fc2hhcmVkVG9vbHRpcCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NoYXJlZFRvb2x0aXAucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2hhcmVkVG9vbHRpcCA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXAuZ2V0Q29udGFpbmVyKCkuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICBjb25zdCBjYW52YXMgPSBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikucXVlcnlTZWxlY3RvcihcImNhbnZhc1wiKTtcbiAgICAgICAgICAgIGlmIChjYW52YXMpIGNhbnZhcy5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgZ2xMYXllcigpO1xuICAgIGluc3RhbmNlLmFkZFRvKG1hcCk7XG4gICAgaW5zdGFuY2UubGF5ZXJUeXBlID0gdHlwZTtcbiAgICByZXR1cm4gaW5zdGFuY2U7XG59XG4iLCAiaW1wb3J0IHsgbG9hZENTUywgbG9hZEpTIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IHJlbmRlclNpZGViYXJDb250cm9scywgbm9ybWFsaXplUmFkaW9MYXllcnMgfSBmcm9tIFwiLi9zaWRlYmFyLmpzXCI7XG5pbXBvcnQgeyByZW5kZXJMYXllciwgcmVuZGVyTWVyZ2VkR2xMYXllciB9IGZyb20gXCIuL2xheWVycy5qc1wiO1xuXG4vLyBBcHBsaWVzIGluY3JlbWVudGFsIHBhdGNoIG9wcyB0byB7bGF5ZXJzLCBidWZmZXJzfSwgcmV0dXJuaW5nIHRoZSBuZXcgc3RhdGUuXG4vL1xuLy8gT3BzIGFyZSBhZGRyZXNzZWQgYnkgbGF5ZXIgaWQgYW5kIGFwcGxpZWQgaWRlbXBvdGVudGx5OiBcImFkZFwiIHVwc2VydHMgcmF0aGVyIHRoYW5cbi8vIGFwcGVuZGluZyBibGluZGx5LCBzbyBhIHBhdGNoIHRoYXQgcmFjZXMgdGhlIGluaXRpYWwgdHJhaXQgc25hcHNob3QgY2Fubm90IGR1cGxpY2F0ZVxuLy8gYSBsYXllciwgYW5kIGEgXCJyZW1vdmVcIiBmb3Igc29tZXRoaW5nIGFscmVhZHkgZ29uZSBpcyBhIG5vLW9wLlxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3dpZnRtYXBQYXRjaChzdGF0ZSwgb3BzLCBidWZmZXJzKSB7XG4gICAgbGV0IGxheWVycyA9IHN0YXRlLmxheWVycyB8fCBbXTtcbiAgICBsZXQgYnVmZmVyTWFwID0gc3RhdGUuYnVmZmVycyB8fCB7fTtcblxuICAgIGZvciAoY29uc3Qgb3Agb2Ygb3BzKSB7XG4gICAgICAgIGlmIChvcC5vcCA9PT0gXCJzbmFwc2hvdFwiKSB7XG4gICAgICAgICAgICBsYXllcnMgPSBvcC5sYXllcnMgfHwgW107XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7fTtcbiAgICAgICAgICAgIChvcC5idWZmZXJfaWRzIHx8IFtdKS5mb3JFYWNoKChpZCwgaSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJzICYmIGJ1ZmZlcnNbaV0pIGJ1ZmZlck1hcFtpZF0gPSBidWZmZXJzW2ldO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYWRkXCIgfHwgb3Aub3AgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICAgICAgICBjb25zdCBpbmNvbWluZyA9IG9wLmxheWVyO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBpbmNvbWluZyA/IGluY29taW5nLmlkIDogb3AuaWQ7XG4gICAgICAgICAgICBjb25zdCBpZHggPSBsYXllcnMuZmluZEluZGV4KGwgPT4gbC5pZCA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBsYXllcnMgPSBbLi4ubGF5ZXJzLCBpbmNvbWluZ107XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxheWVycyA9IGxheWVycy5tYXAoKGwsIGkpID0+IChpID09PSBpZHggPyBpbmNvbWluZyA6IGwpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJyZW1vdmVcIikge1xuICAgICAgICAgICAgbGF5ZXJzID0gbGF5ZXJzLmZpbHRlcihsID0+IGwuaWQgIT09IG9wLmlkKTtcbiAgICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gXCJidWZmZXJcIikge1xuICAgICAgICAgICAgY29uc3QgYnVmID0gYnVmZmVycyAmJiBidWZmZXJzW29wLmJ1ZmZlcl9pbmRleF07XG4gICAgICAgICAgICBpZiAoYnVmKSBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCwgW29wLmlkXTogYnVmIH07XG4gICAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09IFwiYnVmZmVyX3JlbW92ZVwiKSB7XG4gICAgICAgICAgICBidWZmZXJNYXAgPSB7IC4uLmJ1ZmZlck1hcCB9O1xuICAgICAgICAgICAgZGVsZXRlIGJ1ZmZlck1hcFtvcC5pZF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBsYXllcnMsIGJ1ZmZlcnM6IGJ1ZmZlck1hcCB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gICAgYXN5bmMgcmVuZGVyKHsgbW9kZWwsIGVsIH0pIHtcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxFcnJvciA9IGNvbnNvbGUuZXJyb3I7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsV2FybiA9IGNvbnNvbGUud2FybjtcblxuICAgICAgICAvLyBIZWxwZXIgdG8gc2FmZWx5IHdyaXRlIGJhY2sgdG8gUHl0aG9uIG9ubHkgaWYgdGhlIHdpZGdldCB2aWV3IGlzIGFjdGl2ZSBhbmQgYXR0YWNoZWRcbiAgICAgICAgZnVuY3Rpb24gc2FmZVNldEFuZFNhdmUoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKG1vZGVsLmNvbW0gJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNhdmVfY2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxXYXJuLmNhbGwoY29uc29sZSwgXCJbU3dpZnRNYXBdIFN1cHByZXNzZWQgc3luYyB3cml0ZSBlcnJvcjpcIiwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gc2FmZVNhdmVDaGFuZ2VzKCkge1xuICAgICAgICAgICAgaWYgKG1vZGVsLmNvbW0gJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIFwiW1N3aWZ0TWFwXSBTdXBwcmVzc2VkIHN5bmMgc2F2ZSBlcnJvcjpcIiwgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5lcnJvciA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcbiAgICAgICAgICAgIG9yaWdpbmFsRXJyb3IuYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgICAgICAgICBjb25zdCBsb2dzID0gbW9kZWwuZ2V0KFwianNfY29uc29sZV9sb2dzXCIpIHx8IFtdO1xuICAgICAgICAgICAgbG9ncy5wdXNoKFwiQ09OU09MRS5FUlJPUjogXCIgKyBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIikpO1xuICAgICAgICAgICAgc2FmZVNldEFuZFNhdmUoXCJqc19jb25zb2xlX2xvZ3NcIiwgWy4uLmxvZ3NdKTtcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIGxldCBsb2dnZWRSZXByb2plY3RlZCA9IGZhbHNlO1xuICAgICAgICBjb25zb2xlLndhcm4gPSBmdW5jdGlvbiguLi5hcmdzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBhcmdzLm1hcChhID0+IFN0cmluZyhhKSkuam9pbihcIiBcIik7XG4gICAgICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwibGF5ZXIgZGVzaWduZWQgZm9yIFNwaGVyaWNhbE1lcmNhdG9yXCIpIHx8IG1zZy5pbmNsdWRlcyhcImFsdGVybmF0ZSBkZXRlY3RlZFwiKSkge1xuICAgICAgICAgICAgICAgIGlmICghbG9nZ2VkUmVwcm9qZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nZ2VkUmVwcm9qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcnMgPSBtb2RlbC5nZXQoXCJjcnNcIikgfHwgXCJFUFNHOjM4NTdcIjtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xlYW5Nc2cgPSBgW1N3aWZ0TWFwXSBMYXllciB3YXMgcmVwcm9qZWN0ZWQgdG8gXCIke2Nyc31cImA7XG4gICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5jYWxsKGNvbnNvbGUsIGNsZWFuTXNnKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxvZ3MgPSBtb2RlbC5nZXQoXCJqc19jb25zb2xlX2xvZ3NcIikgfHwgW107XG4gICAgICAgICAgICAgICAgICAgIGxvZ3MucHVzaChjbGVhbk1zZyk7XG4gICAgICAgICAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIFsuLi5sb2dzXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gc3VwcHJlc3MgZHVwbGljYXRlIGNvbnNvbGUgd2FybmluZ3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9yaWdpbmFsV2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICAgICAgfTtcblxuICAgICAgICB3aW5kb3cub25lcnJvciA9IGZ1bmN0aW9uKG1lc3NhZ2UsIHNvdXJjZSwgbGluZW5vLCBjb2xubywgZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnN0IGxvZ3MgPSBtb2RlbC5nZXQoXCJqc19jb25zb2xlX2xvZ3NcIikgfHwgW107XG4gICAgICAgICAgICBsb2dzLnB1c2goYFdJTkRPVy5PTkVSUk9SOiAke21lc3NhZ2V9IGF0ICR7c291cmNlfToke2xpbmVub306JHtjb2xub31gKTtcbiAgICAgICAgICAgIHNhZmVTZXRBbmRTYXZlKFwianNfY29uc29sZV9sb2dzXCIsIFsuLi5sb2dzXSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gTG9hZCBDU1MgYW5kIExlYWZsZXQgbGlicmFyaWVzIChpbmNsdWRpbmcgV2ViR0wgZ2xpZnkpXG4gICAgICAgIGxvYWRDU1MoXCJsZWFmbGV0LWNzc1wiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXRAMS45LjQvZGlzdC9sZWFmbGV0LmNzc1wiKTtcbiAgICAgICAgYXdhaXQgbG9hZEpTKFwibGVhZmxldC1qc1wiLCBcImh0dHBzOi8vdW5wa2cuY29tL2xlYWZsZXRAMS45LjQvZGlzdC9sZWFmbGV0LmpzXCIpO1xuICAgICAgICBhd2FpdCBsb2FkSlMoXCJsZWFmbGV0LWdsaWZ5XCIsIFwiaHR0cHM6Ly91bnBrZy5jb20vbGVhZmxldC5nbGlmeUAzLjMuMC9kaXN0L2dsaWZ5LWJyb3dzZXIuanNcIik7XG5cbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgY29udGFpbmVyLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtY29udGFpbmVyXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICBjb250YWluZXIuc3R5bGUuaGVpZ2h0ID0gXCIxMDAlXCI7XG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5wb3NpdGlvbiA9IFwicmVsYXRpdmVcIjtcbiAgICAgICAgZWwuYXBwZW5kQ2hpbGQoY29udGFpbmVyKTtcblxuICAgICAgICBjb25zdCBjcnNOYW1lID0gbW9kZWwuZ2V0KFwiY3JzXCIpO1xuICAgICAgICBsZXQgbWFwQ3JzID0gTC5DUlMuRVBTRzM4NTc7XG4gICAgICAgIGlmIChjcnNOYW1lID09PSBcIkVQU0c6NDMyNlwiKSB7XG4gICAgICAgICAgICBtYXBDcnMgPSBMLkNSUy5FUFNHNDMyNjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1hcCA9IEwubWFwKGNvbnRhaW5lciwge1xuICAgICAgICAgICAgY3JzOiBtYXBDcnMsXG4gICAgICAgICAgICBjZW50ZXI6IG1vZGVsLmdldChcImNlbnRlclwiKSxcbiAgICAgICAgICAgIHpvb206IG1vZGVsLmdldChcInpvb21cIiksXG4gICAgICAgICAgICBzY3JvbGxXaGVlbFpvb206IHRydWUsXG4gICAgICAgICAgICBwcmVmZXJDYW52YXM6IHRydWVcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGN1c3RvbSBwYW5lcyBmb3Igc3RyaWN0IFotaW5kZXggb3JkZXJpbmdcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2x5Z29uc1BhbmVcIik7XG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9seWdvbnNQYW5lXCIpLnN0eWxlLnpJbmRleCA9IFwiNDEwXCI7XG4gICAgICAgIFxuICAgICAgICBtYXAuY3JlYXRlUGFuZShcInBvbHlsaW5lc1BhbmVcIik7XG4gICAgICAgIG1hcC5nZXRQYW5lKFwicG9seWxpbmVzUGFuZVwiKS5zdHlsZS56SW5kZXggPSBcIjQyMFwiO1xuICAgICAgICBcbiAgICAgICAgbWFwLmNyZWF0ZVBhbmUoXCJwb2ludHNQYW5lXCIpO1xuICAgICAgICBtYXAuZ2V0UGFuZShcInBvaW50c1BhbmVcIikuc3R5bGUuekluZGV4ID0gXCI0MzBcIjtcblxuICAgICAgICAvLyBMb2NhbCBtaXJyb3JzIG9mIHRoZSBsYXllciBsaXN0IGFuZCBjb29yZGluYXRlIGJ1ZmZlcnMuXG4gICAgICAgIC8vXG4gICAgICAgIC8vIFB5dGhvbiB1cGRhdGVzIHRoZXNlIGluY3JlbWVudGFsbHkgdmlhIFwic3dpZnRtYXBfcGF0Y2hcIiBtZXNzYWdlcyBpbnN0ZWFkIG9mXG4gICAgICAgIC8vIHJlYXNzaWduaW5nIHRoZSB0cmFpdHMsIGJlY2F1c2UgYSB0cmFpdCByZWFzc2lnbm1lbnQgcmUtc2VyaWFsaXplcyBhbmQgcmUtc2VuZHNcbiAgICAgICAgLy8gdGhlIGVudGlyZSBtYXAgb24gZXZlcnkgbXV0YXRpb24uIFRoZSB0cmFpdHMgc3RpbGwgY2FycnkgdGhlIGluaXRpYWwgc25hcHNob3RcbiAgICAgICAgLy8gd2hlbiBhIHZpZXcgYXR0YWNoZXMsIGFuZCB0aGUgc2lkZWJhciBzdGlsbCB3cml0ZXMgYGxheWVyc2AgYmFjayBvbiB0b2dnbGUsIHNvXG4gICAgICAgIC8vIGJvdGggYXJlIHNlZWRlZCBoZXJlIGFuZCBrZXB0IGluIHN0ZXAgYnkgdGhlIGNoYW5nZSBoYW5kbGVycyBmdXJ0aGVyIGRvd24uXG4gICAgICAgIGxldCBsYXllclN0YXRlID0gbW9kZWwuZ2V0KFwibGF5ZXJzXCIpIHx8IFtdO1xuICAgICAgICBsZXQgYnVmZmVyU3RhdGUgPSB7IC4uLihtb2RlbC5nZXQoXCJjb29yZGluYXRlX2J1ZmZlcnNcIikgfHwge30pIH07XG5cbiAgICAgICAgZnVuY3Rpb24gYXBwbHlQYXRjaE9wcyhvcHMsIGJ1ZmZlcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSBhcHBseVN3aWZ0bWFwUGF0Y2goeyBsYXllcnM6IGxheWVyU3RhdGUsIGJ1ZmZlcnM6IGJ1ZmZlclN0YXRlIH0sIG9wcywgYnVmZmVycyk7XG4gICAgICAgICAgICBsYXllclN0YXRlID0gbmV4dC5sYXllcnM7XG4gICAgICAgICAgICBidWZmZXJTdGF0ZSA9IG5leHQuYnVmZmVycztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFjdGl2ZVRpbGVMYXllcnMgPSB7fTtcbiAgICAgICAgY29uc3QgYWN0aXZlT3ZlcmxheUxheWVycyA9IHt9O1xuICAgICAgICBjb25zdCBnbFN0YXRlcyA9IHtcbiAgICAgICAgICAgIGNpcmNsZV9tYXJrZXJzOiB7IGxheWVyOiBudWxsLCBpZHM6IFwiXCIsIG1ldGE6IFwiXCIgfSxcbiAgICAgICAgICAgIG1hcmtlcnM6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgcG9seWxpbmU6IHsgbGF5ZXI6IG51bGwsIGlkczogXCJcIiwgbWV0YTogXCJcIiB9LFxuICAgICAgICAgICAgcG9seWdvbjogeyBsYXllcjogbnVsbCwgaWRzOiBcIlwiLCBtZXRhOiBcIlwiIH1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBTaWRlYmFyIExheWVycyBDb250cm9sIFVJXG4gICAgICAgIGNvbnN0IHNpZGViYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICBzaWRlYmFyLmNsYXNzTmFtZSA9IFwic3dpZnRtYXAtc2lkZWJhclwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnRvcCA9IFwiMTBweFwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLnJpZ2h0ID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuekluZGV4ID0gXCIxMDAwXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYmFja2dyb3VuZCA9IFwid2hpdGVcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5wYWRkaW5nID0gXCIxMHB4XCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI1cHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5tYXhIZWlnaHQgPSBcIjgwJVwiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLm92ZXJmbG93WSA9IFwiYXV0b1wiO1xuICAgICAgICBzaWRlYmFyLnN0eWxlLmZvbnRGYW1pbHkgPSBcIi1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgJ1NlZ29lIFVJJywgUm9ib3RvLCBzYW5zLXNlcmlmXCI7XG4gICAgICAgIHNpZGViYXIuc3R5bGUuZm9udFNpemUgPSBcIjEycHhcIjtcbiAgICAgICAgc2lkZWJhci5zdHlsZS5jb2xvciA9IFwiIzMzM1wiO1xuICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoc2lkZWJhcik7XG5cbiAgICAgICAgLy8gTG9nb1xuICAgICAgICBjb25zdCBsb2dvRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3R0b20gPSBcIjEwcHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5yaWdodCA9IFwiMTBweFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLnpJbmRleCA9IFwiMTAwMFwiO1xuICAgICAgICBsb2dvRGl2LnN0eWxlLmJhY2tncm91bmQgPSBcIndoaXRlXCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUucGFkZGluZyA9IFwiNXB4XCI7XG4gICAgICAgIGxvZ29EaXYuc3R5bGUuYm9yZGVyUmFkaXVzID0gXCI0cHhcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5ib3hTaGFkb3cgPSBcIjAgMXB4IDVweCByZ2JhKDAsMCwwLDAuNClcIjtcbiAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgIGxvZ29EaXYuaW5uZXJIVE1MID0gYFxuICAgICAgICAgICAgPGRpdiBzdHlsZT1cImRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7XCI+XG4gICAgICAgICAgICAgICAgPGltZyBzcmM9XCJodHRwczovL3JlcG8vYXNzZXRzL2ltYWdlLnBuZ1wiIGFsdD1cIkNvbXBhbnlcIiBzdHlsZT1cImhlaWdodDogMzVweDsgbWFyZ2luLXJpZ2h0OiA1cHg7XCI+XG4gICAgICAgICAgICAgICAgPGltZyBzcmM9XCJodHRwczovL3JlcG8vYXNzZXRzL2ltYWdlMi5wbmdcIiBhbHQ9XCJQYXJlbnQgQ29tcGFueVwiIHN0eWxlPVwiaGVpZ2h0OiAzNXB4O1wiPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgIGA7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChsb2dvRGl2KTtcblxuXG5cbiAgICAgICAgZnVuY3Rpb24gZ2V0VGlsZUxheWVyKGxheWVyKSB7XG4gICAgICAgICAgICByZXR1cm4gTC50aWxlTGF5ZXIobGF5ZXIudXJsLCB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRpb246IGxheWVyLmF0dHJpYnV0aW9uIHx8ICcnLFxuICAgICAgICAgICAgICAgIG1heFpvb206IGxheWVyLm1heF96b29tIHx8IDIyLFxuICAgICAgICAgICAgICAgIG1heE5hdGl2ZVpvb206IGxheWVyLm1heF9uYXRpdmVfem9vbSB8fCAxOVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBhc3luYyBmdW5jdGlvbiBzeW5jTWFwU3RhdGUoKSB7XG4gICAgICAgICAgICBjb25zb2xlLnRpbWUoXCJbUGVyZm9ybWFuY2VdIHN5bmNNYXBTdGF0ZSBUb3RhbFwiKTtcbiAgICAgICAgICAgIGNvbnN0IGxheWVycyA9IGxheWVyU3RhdGU7XG4gICAgICAgICAgICBjb25zdCBncm91cENvbmZpZ3MgPSBtb2RlbC5nZXQoXCJncm91cF9jb25maWdzXCIpIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgY29vcmRpbmF0ZUJ1ZmZlcnMgPSBidWZmZXJTdGF0ZTtcblxuICAgICAgICAgICAgLy8gRW5mb3JjZSBtdXR1YWxseSBleGNsdXNpdmUgcmFkaW8gZ3JvdXAgdmlzaWJpbGl0eSBiZWZvcmUgY29sbGVjdGluZyBvciByZW5kZXJpbmcgV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBjb25zdCByYWRpb0NoYW5nZWQgPSBub3JtYWxpemVSYWRpb0xheWVycyhsYXllcnMsIGdyb3VwQ29uZmlncyk7XG4gICAgICAgICAgICBpZiAocmFkaW9DaGFuZ2VkICYmIG1vZGVsLmNvbW0gJiYgZG9jdW1lbnQuYm9keS5jb250YWlucyhlbCkpIHtcbiAgICAgICAgICAgICAgICBtb2RlbC5zZXQoXCJsYXllcnNcIiwgWy4uLmxheWVyc10pO1xuICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImdyb3VwX2NvbmZpZ3NcIiwgZ3JvdXBDb25maWdzKTtcbiAgICAgICAgICAgICAgICBtb2RlbC5zYXZlX2NoYW5nZXMoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbG9nb0Rpdi5zdHlsZS5kaXNwbGF5ID0gbW9kZWwuZ2V0KFwic2hvd19sb2dvXCIpID8gXCJibG9ja1wiIDogXCJub25lXCI7XG5cbiAgICAgICAgICAgIC8vIEdyb3VwIHZpc2libGUgbGF5ZXJzIChpbmNsdWRpbmcgc3ViLWxheWVycyBpbnNpZGUgZ3JvdXBzKSB0byBhbHdheXMgdXNlIFdlYkdMXG4gICAgICAgICAgICBjb25zdCB3ZWJnbENpcmNsZU1hcmtlckxheWVycyA9IFtdO1xuICAgICAgICAgICAgY29uc3Qgd2ViZ2xNYXJrZXJMYXllcnMgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IHdlYmdsUG9seWxpbmVMYXllcnMgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IHdlYmdsUG9seWdvbkxheWVycyA9IFtdO1xuXG4gICAgICAgICAgICBmdW5jdGlvbiBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsKSB7XG4gICAgICAgICAgICAgICAgaWYgKGwudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICBjb25zdCBwYXRoU3RyID0gbC5sYXllcl9ncm91cCB8fCBcIkxheWVyc1wiO1xuICAgICAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gcGF0aFN0ci5zcGxpdChcIi9cIik7XG4gICAgICAgICAgICAgICAgbGV0IHJ1bm5pbmdQYXRoID0gXCJcIjtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgICAgICAgICAgICAgICAgcnVubmluZ1BhdGggPSBydW5uaW5nUGF0aCA/IGAke3J1bm5pbmdQYXRofS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGdyb3VwQ29uZmlnc1tydW5uaW5nUGF0aF07XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25maWcgJiYgY29uZmlnLnZpc2libGUgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZ1bmN0aW9uIGNvbGxlY3RXZWJnbExheWVycyhsLCBwYXJlbnRFZmZlY3RpdmVWaXNpYmxlLCBpc1N1YkxheWVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFwYXJlbnRFZmZlY3RpdmVWaXNpYmxlKSByZXR1cm47XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGwudHlwZSA9PT0gXCJncm91cFwiICYmIGwubGF5ZXJzKSB7XG4gICAgICAgICAgICAgICAgICAgIGwubGF5ZXJzLmZvckVhY2goc3ViID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxlY3RXZWJnbExheWVycyhzdWIsIHBhcmVudEVmZmVjdGl2ZVZpc2libGUsIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWlzU3ViTGF5ZXIgJiYgbC52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuO1xuXG5cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobC50eXBlID09PSBcImNpcmNsZV9tYXJrZXJzXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMucHVzaChsKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGwudHlwZSA9PT0gXCJtYXJrZXJzXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgd2ViZ2xNYXJrZXJMYXllcnMucHVzaChsKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGwudHlwZSA9PT0gXCJwb2x5bGluZVwiKSB7XG4gICAgICAgICAgICAgICAgICAgIHdlYmdsUG9seWxpbmVMYXllcnMucHVzaChsKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGwudHlwZSA9PT0gXCJwb2x5Z29uXCIgfHwgbC50eXBlID09PSBcImNpcmNsZVwiKSB7XG4gICAgICAgICAgICAgICAgICAgIHdlYmdsUG9seWdvbkxheWVycy5wdXNoKGwpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGF5ZXJzLmZvckVhY2gobCA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlVmlzaWJsZSA9IGlzTGF5ZXJFZmZlY3RpdmVWaXNpYmxlKGwpO1xuICAgICAgICAgICAgICAgIGNvbGxlY3RXZWJnbExheWVycyhsLCBlZmZlY3RpdmVWaXNpYmxlKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBTZXQgb2YgbGF5ZXIgSURzIHByb2Nlc3NlZCB2aWEgbWVyZ2VkIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgY29uc3Qgd2ViZ2xMYXllcklkcyA9IG5ldyBTZXQoW1xuICAgICAgICAgICAgICAgIC4uLndlYmdsQ2lyY2xlTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsTWFya2VyTGF5ZXJzLm1hcChsID0+IGwuaWQpLFxuICAgICAgICAgICAgICAgIC4uLndlYmdsUG9seWxpbmVMYXllcnMubWFwKGwgPT4gbC5pZCksXG4gICAgICAgICAgICAgICAgLi4ud2ViZ2xQb2x5Z29uTGF5ZXJzLm1hcChsID0+IGwuaWQpXG4gICAgICAgICAgICBdKTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHJldGlyZWQgb3ZlcmxheSBsYXllcnMsIGluY2x1ZGluZyB0aG9zZSB0aGF0IHRyYW5zaXRpb25lZCB0byBXZWJHTFxuICAgICAgICAgICAgT2JqZWN0LmtleXMoYWN0aXZlT3ZlcmxheUxheWVycykuZm9yRWFjaChpZCA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFsYXllcnMuZmluZChsID0+IGwuaWQgPT09IGlkKSB8fCB3ZWJnbExheWVySWRzLmhhcyhpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tpZF0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBhY3RpdmVPdmVybGF5TGF5ZXJzW2lkXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gUHJvY2VzcyBub24tV2ViR0wgbGF5ZXJzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxheWVyIG9mIGxheWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGVmZmVjdGl2ZVZpc2libGUgPSBpc0xheWVyRWZmZWN0aXZlVmlzaWJsZShsYXllcik7XG4gICAgICAgICAgICAgICAgaWYgKGxheWVyLnR5cGUgPT09IFwiYmFzZW1hcFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlZmZlY3RpdmVWaXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0aWxlID0gZ2V0VGlsZUxheWVyKGxheWVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aWxlLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSA9IHRpbGU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWN0aXZlVGlsZUxheWVyc1tsYXllci5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZVRpbGVMYXllcnNbbGF5ZXIubmFtZV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBsYXllcnMgbWFuYWdlZCBieSB0aGUgbWVyZ2VkIFdlYkdMIGxheWVyc1xuICAgICAgICAgICAgICAgIGlmICh3ZWJnbExheWVySWRzLmhhcyhsYXllci5pZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFlZmZlY3RpdmVWaXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF0ucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWN0aXZlT3ZlcmxheUxheWVyc1tsYXllci5pZF07XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZy5sYXllclR5cGUgIT09IGxheWVyLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nLnJlbW92ZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGFjdGl2ZU92ZXJsYXlMYXllcnNbbGF5ZXIuaWRdO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IHJlbmRlckxheWVyKG1hcCwgbGF5ZXIsIGNvb3JkaW5hdGVCdWZmZXJzW2xheWVyLmlkXSwgbW9kZWwpO1xuICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICBhY3RpdmVPdmVybGF5TGF5ZXJzW2xheWVyLmlkXSA9IGluc3RhbmNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSGVscGVyIHRvIHN5bmMgV2ViR0wgbGF5ZXIgc3RhdGVzIGFuZCByZWJ1aWxkIG9ubHkgaWYgY2hhbmdlZFxuICAgICAgICAgICAgYXN5bmMgZnVuY3Rpb24gc3luY0dsTGF5ZXIodHlwZSwgdmlzaWJsZUxheWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkc1N0cmluZyA9IHZpc2libGVMYXllcnMubWFwKGwgPT4gbC5pZCkuc29ydCgpLmpvaW4oXCIsXCIpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFTdHJpbmcgPSBKU09OLnN0cmluZ2lmeSh2aXNpYmxlTGF5ZXJzLm1hcChsID0+ICh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBsLmlkLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogbC5jb2xvcixcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiBsLnJhZGl1cyxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiBsLndlaWdodCxcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogbC5vcGFjaXR5LFxuICAgICAgICAgICAgICAgICAgICBmaWxsT3BhY2l0eTogbC5maWxsT3BhY2l0eSxcbiAgICAgICAgICAgICAgICAgICAgYnVmTGVuOiBjb29yZGluYXRlQnVmZmVyc1tsLmlkXT8uYnl0ZUxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBsb2NMZW46IGwubG9jYXRpb25zPy5sZW5ndGggfHwgMFxuICAgICAgICAgICAgICAgIH0pKSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGdsU3RhdGVzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlQ2hhbmdlZCA9IHN0YXRlLmlkcyAhPT0gaWRzU3RyaW5nIHx8IHN0YXRlLm1ldGEgIT09IG1ldGFTdHJpbmc7XG5cbiAgICAgICAgICAgICAgICBpZiAoc3RhdGVDaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHZpc2libGVMYXllcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUubGF5ZXIgPSBhd2FpdCByZW5kZXJNZXJnZWRHbExheWVyKG1hcCwgdHlwZSwgdmlzaWJsZUxheWVycywgY29vcmRpbmF0ZUJ1ZmZlcnMsIG1vZGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5sYXllcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmxheWVyLmFkZFRvKG1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5sYXllciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc3RhdGUuaWRzID0gaWRzU3RyaW5nO1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5tZXRhID0gbWV0YVN0cmluZztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwiY2lyY2xlX21hcmtlcnNcIiwgd2ViZ2xDaXJjbGVNYXJrZXJMYXllcnMpO1xuICAgICAgICAgICAgYXdhaXQgc3luY0dsTGF5ZXIoXCJtYXJrZXJzXCIsIHdlYmdsTWFya2VyTGF5ZXJzKTtcbiAgICAgICAgICAgIGF3YWl0IHN5bmNHbExheWVyKFwicG9seWxpbmVcIiwgd2ViZ2xQb2x5bGluZUxheWVycyk7XG4gICAgICAgICAgICBhd2FpdCBzeW5jR2xMYXllcihcInBvbHlnb25cIiwgd2ViZ2xQb2x5Z29uTGF5ZXJzKTtcblxuICAgICAgICAgICAgcmVuZGVyU2lkZWJhckNvbnRyb2xzKHNpZGViYXIsIGxheWVycywgbW9kZWwsIG1hcCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnNvbGUudGltZUVuZChcIltQZXJmb3JtYW5jZV0gc3luY01hcFN0YXRlIFRvdGFsXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XG4gICAgICAgIGxldCBpc1VwZGF0aW5nWm9vbUZyb21NYXAgPSBmYWxzZTtcblxuICAgICAgICAvLyBCaW5kIHpvb20gYW5kIGNlbnRlciBjaGFuZ2VzIGJhY2sgdG8gUHl0aG9uIHNhZmVseVxuICAgICAgICBtYXAub24oXCJtb3ZlZW5kXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VudGVyID0gbWFwLmdldENlbnRlcigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRab29tID0gbWFwLmdldFpvb20oKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCBtb2RlbENlbnRlciA9IG1vZGVsLmdldChcImNlbnRlclwiKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2RlbFpvb20gPSBtb2RlbC5nZXQoXCJ6b29tXCIpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbW9kZWxab29tICE9PSBjdXJyZW50Wm9vbTtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gIW1vZGVsQ2VudGVyIHx8IFxuICAgICAgICAgICAgICAgICAgICAhQXJyYXkuaXNBcnJheShtb2RlbENlbnRlcikgfHxcbiAgICAgICAgICAgICAgICAgICAgbW9kZWxDZW50ZXIubGVuZ3RoIDwgMiB8fFxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclswXSAtIGNlbnRlci5sYXQpID4gMC4wMDAxIHx8IFxuICAgICAgICAgICAgICAgICAgICBNYXRoLmFicyhtb2RlbENlbnRlclsxXSAtIGNlbnRlci5sbmcpID4gMC4wMDAxO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG1vZGVsLnNldChcImNlbnRlclwiLCBbY2VudGVyLmxhdCwgY2VudGVyLmxuZ10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoem9vbUNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbW9kZWwuc2V0KFwiem9vbVwiLCBjdXJyZW50Wm9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChjZW50ZXJDaGFuZ2VkIHx8IHpvb21DaGFuZ2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIHNhZmVTYXZlQ2hhbmdlcygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBpbiBtb3ZlZW5kIGhhbmRsZXI6XCIsIGVycik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZ1bmN0aW9uIHVwZGF0ZU1hcFZpZXcoKSB7XG4gICAgICAgICAgICBjb25zdCBjZW50ZXIgPSBtb2RlbC5nZXQoXCJjZW50ZXJcIik7XG4gICAgICAgICAgICBjb25zdCB6b29tID0gbW9kZWwuZ2V0KFwiem9vbVwiKTtcbiAgICAgICAgICAgIGlmIChjZW50ZXIgJiYgQXJyYXkuaXNBcnJheShjZW50ZXIpICYmIGNlbnRlci5sZW5ndGggPj0gMikge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1hcENlbnRlciA9IG1hcC5nZXRDZW50ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXBab29tID0gbWFwLmdldFpvb20oKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjZW50ZXJDaGFuZ2VkID0gTWF0aC5hYnMobWFwQ2VudGVyLmxhdCAtIGNlbnRlclswXSkgPiAwLjAwMDEgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGguYWJzKG1hcENlbnRlci5sbmcgLSBjZW50ZXJbMV0pID4gMC4wMDAxO1xuICAgICAgICAgICAgICAgIGNvbnN0IHpvb21DaGFuZ2VkID0gbWFwWm9vbSAhPT0gem9vbTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoY2VudGVyQ2hhbmdlZCB8fCB6b29tQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgICAgICBtYXAuc2V0VmlldyhjZW50ZXIsIHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiID8gem9vbSA6IG1hcFpvb20pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgem9vbSA9IG1vZGVsLmdldChcInpvb21cIik7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB6b29tID09PSBcIm51bWJlclwiICYmIG1hcC5nZXRab29tKCkgIT09IHpvb20pIHtcbiAgICAgICAgICAgICAgICAgICAgbWFwLnNldFpvb20oem9vbSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gV2F0Y2ggZm9yIG1hcCB2aWV3IHVwZGF0ZXMgZnJvbSBQeXRob25cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Y2VudGVyXCIsICgpID0+IHtcbiAgICAgICAgICAgIGlmIChpc1VwZGF0aW5nQ2VudGVyRnJvbU1hcCkge1xuICAgICAgICAgICAgICAgIGlzVXBkYXRpbmdDZW50ZXJGcm9tTWFwID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXBkYXRlTWFwVmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6em9vbVwiLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaXNVcGRhdGluZ1pvb21Gcm9tTWFwKSB7XG4gICAgICAgICAgICAgICAgaXNVcGRhdGluZ1pvb21Gcm9tTWFwID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXBkYXRlTWFwVmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Zml0X2JvdW5kc19jb29yZHNcIiwgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYm91bmRzID0gbW9kZWwuZ2V0KFwiZml0X2JvdW5kc19jb29yZHNcIik7XG4gICAgICAgICAgICBpZiAoYm91bmRzICYmIGJvdW5kcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbWFwLmZpdEJvdW5kcyhib3VuZHMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgc3luY1RpbWVvdXQgPSBudWxsO1xuICAgICAgICBsZXQgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgIGxldCBuZWVkc1N5bmMgPSBmYWxzZTtcblxuICAgICAgICBhc3luYyBmdW5jdGlvbiBwZXJmb3JtU3luYygpIHtcbiAgICAgICAgICAgIGlmIChpc1N5bmNpbmcpIHtcbiAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlzU3luY2luZyA9IHRydWU7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHN5bmNNYXBTdGF0ZSgpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIHN5bmNNYXBTdGF0ZTpcIiwgZXJyKTtcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgaXNTeW5jaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYgKG5lZWRzU3luYykge1xuICAgICAgICAgICAgICAgICAgICBuZWVkc1N5bmMgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgcGVyZm9ybVN5bmMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBxdWV1ZVN5bmMoKSB7XG4gICAgICAgICAgICBpZiAoIW1vZGVsLmdldChcImF1dG9fc3luY1wiKSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzeW5jVGltZW91dCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChzeW5jVGltZW91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzeW5jVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHN5bmNUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICAgICAgfSwgNTApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTGlzdGVuIGZvciBtYW51YWwgc3luYyB0cmlnZ2VyIGNoYW5nZXMgZnJvbSBQeXRob25cbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6c3luY190cmlnZ2VyXCIsICgpID0+IHtcbiAgICAgICAgICAgIHBlcmZvcm1TeW5jKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEluY3JlbWVudGFsIHVwZGF0ZXMgZnJvbSBQeXRob24uIEFwcGxpZWQgZXZlbiB3aGVuIGF1dG9fc3luYyBpcyBvZmYgc28gdGhlIG1pcnJvclxuICAgICAgICAvLyBzdGF5cyBjdXJyZW50OyBxdWV1ZVN5bmMgZGVjaWRlcyB3aGV0aGVyIHRvIGFjdHVhbGx5IHJlLXJlbmRlci5cbiAgICAgICAgbW9kZWwub24oXCJtc2c6Y3VzdG9tXCIsIChtc2csIGJ1ZmZlcnMpID0+IHtcbiAgICAgICAgICAgIGlmICghbXNnIHx8IG1zZy5raW5kICE9PSBcInN3aWZ0bWFwX3BhdGNoXCIpIHJldHVybjtcbiAgICAgICAgICAgIGFwcGx5UGF0Y2hPcHMobXNnLm9wcyB8fCBbXSwgYnVmZmVycyk7XG4gICAgICAgICAgICBxdWV1ZVN5bmMoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRnVsbC1zbmFwc2hvdCBwYXRoczogdGhlIGluaXRpYWwgc3RhdGUgbWVzc2FnZSwgYW5kIHRoZSBzaWRlYmFyIHdyaXRpbmcgYGxheWVyc2BcbiAgICAgICAgLy8gYmFjayBhZnRlciBhIHRvZ2dsZS4gRWl0aGVyIHdheSB0aGUgdHJhaXQgYmVjb21lcyBhdXRob3JpdGF0aXZlIGFnYWluLlxuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpsYXllcnNcIiwgKCkgPT4ge1xuICAgICAgICAgICAgbGF5ZXJTdGF0ZSA9IG1vZGVsLmdldChcImxheWVyc1wiKSB8fCBbXTtcbiAgICAgICAgICAgIHF1ZXVlU3luYygpO1xuICAgICAgICB9KTtcbiAgICAgICAgbW9kZWwub24oXCJjaGFuZ2U6Y29vcmRpbmF0ZV9idWZmZXJzXCIsICgpID0+IHtcbiAgICAgICAgICAgIGJ1ZmZlclN0YXRlID0geyAuLi4obW9kZWwuZ2V0KFwiY29vcmRpbmF0ZV9idWZmZXJzXCIpIHx8IHt9KSB9O1xuICAgICAgICAgICAgcXVldWVTeW5jKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBtb2RlbC5vbihcImNoYW5nZTpncm91cF9jb25maWdzXCIsIHF1ZXVlU3luYyk7XG4gICAgICAgIG1vZGVsLm9uKFwiY2hhbmdlOnNob3dfbG9nb1wiLCBxdWV1ZVN5bmMpO1xuXG4gICAgICAgIC8vIEFubm91bmNlIHRoaXMgdmlldyBzbyBQeXRob24gcmVwbGllcyB3aXRoIGEgZnVsbCBzbmFwc2hvdC4gTGF5ZXJzIGFkZGVkIGJlZm9yZVxuICAgICAgICAvLyB0aGUgdmlldyBhdHRhY2hlZCB3b3VsZCBvdGhlcndpc2UgYmUgbWlzc2luZzogdGhlaXIgcGF0Y2hlcyB3ZXJlIGVtaXR0ZWQgaW50byBhXG4gICAgICAgIC8vIHdpbmRvdyB3aGVyZSBub3RoaW5nIHdhcyBsaXN0ZW5pbmcuXG4gICAgICAgIGlmIChtb2RlbC5jb21tKSB7XG4gICAgICAgICAgICBtb2RlbC5zZW5kKHsga2luZDogXCJzd2lmdG1hcF9yZWFkeVwiIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVzcGVjdCBpbml0aWFsIGF1dG9fc3luYyBzdGF0ZSBvciBtYW51YWwgc3luYyByZXF1ZXN0cyBzZW50IGR1cmluZyBtYXAgYnVpbGRpbmdcbiAgICAgICAgaWYgKG1vZGVsLmdldChcImF1dG9fc3luY1wiKSB8fCBtb2RlbC5nZXQoXCJzeW5jX3RyaWdnZXJcIikgPiAwKSB7XG4gICAgICAgICAgICBwZXJmb3JtU3luYygpO1xuICAgICAgICB9XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBTyxTQUFTLFFBQVEsSUFBSSxLQUFLO0FBQzdCLE1BQUksQ0FBQyxTQUFTLGVBQWUsRUFBRSxHQUFHO0FBQzlCLFVBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTTtBQUMxQyxTQUFLLEtBQUs7QUFDVixTQUFLLE1BQU07QUFDWCxTQUFLLE9BQU87QUFDWixhQUFTLEtBQUssWUFBWSxJQUFJO0FBQUEsRUFDbEM7QUFDSjtBQUVBLElBQU0sZ0JBQWdCLENBQUM7QUFFaEIsU0FBUyxPQUFPLElBQUksS0FBSztBQUM1QixNQUFJLGNBQWMsRUFBRSxHQUFHO0FBQ25CLFdBQU8sY0FBYyxFQUFFO0FBQUEsRUFDM0I7QUFDQSxRQUFNLFVBQVUsSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQzdDLFFBQUksU0FBUyxlQUFlLEVBQUUsR0FBRztBQUM3QixjQUFRO0FBQ1I7QUFBQSxJQUNKO0FBQ0EsVUFBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLFdBQU8sS0FBSztBQUNaLFdBQU8sTUFBTTtBQUNiLFdBQU8sU0FBUyxNQUFNLFFBQVE7QUFDOUIsV0FBTyxVQUFVLE1BQU0sT0FBTyxJQUFJLE1BQU0sMEJBQTBCLEdBQUcsRUFBRSxDQUFDO0FBQ3hFLGFBQVMs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
