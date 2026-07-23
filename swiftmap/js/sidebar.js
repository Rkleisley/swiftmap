const collapsedPaths = {}; // Stores collapsed state: path -> boolean

function getLayerBounds(l, coordinateBuffers) {
    if (!l) return null;

    // Support folder tree nodes (groups in sidebar tree)
    if (l.isGroup) {
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;
        
        // Check children groups
        Object.keys(l.children).forEach(key => {
            const b = getLayerBounds(l.children[key], coordinateBuffers);
            if (b) {
                if (b[0][0] < minLat) minLat = b[0][0];
                if (b[1][0] > maxLat) maxLat = b[1][0];
                if (b[0][1] < minLon) minLon = b[0][1];
                if (b[1][1] > maxLon) maxLon = b[1][1];
            }
        });
        
        // Check child layers
        l.layers.forEach(lyr => {
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

export function renderSidebarControls(sidebar, layers, model, map, onLayerToggle) {
    sidebar.innerHTML = "<b style='font-size: 13px; border-bottom: 2px solid #eee; padding-bottom: 4px; display: block; margin-bottom: 8px;'>Layers Control</b>";
    
    const groupConfigs = model.get("group_configs") || {};

    // 1. Build a nested hierarchical tree from the flat layers list
    const tree = { name: "Root", path: "", children: {}, layers: [], isGroup: true };
    
    // Ensure root-level configs default to multi_select: true if not specified
    if (!groupConfigs[""]) {
        groupConfigs[""] = { multi_select: true, visible: true };
    }

    layers.forEach(l => {
        const pathStr = l.layer_group || "Layers";
        const parts = pathStr.split("/");
        let curr = tree;
        let runningPath = "";
        parts.forEach(part => {
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

    // 2. Recursive function to render a tree node
    function renderNode(node, parentEl, depth, parentNode) {
        if (node.path === "") {
            // Render root's child groups and child layers directly without header
            Object.keys(node.children).forEach(key => {
                renderNode(node.children[key], parentEl, depth, node);
            });
            node.layers.forEach(lyr => {
                renderNode(lyr, parentEl, depth, node);
            });
            return;
        }

        const isGroup = node.isGroup === true;
        const path = isGroup ? node.path : null;
        const name = isGroup ? node.name : node.name;
        const id = isGroup ? null : node.id;

        // Determine selection type (checkbox vs radio) based on parent's multi_select config
        const parentPath = parentNode ? parentNode.path : "";
        const parentConf = groupConfigs[parentPath] || { multi_select: true };
        const isMultiSelect = parentConf.multi_select !== false;

        const nodeDiv = document.createElement("div");
        nodeDiv.style.marginBottom = "4px";

        const headerDiv = document.createElement("div");
        headerDiv.style.display = "flex";
        headerDiv.style.alignItems = "center";
        headerDiv.style.cursor = "pointer";
        headerDiv.style.userSelect = "none";
        headerDiv.style.webkitUserSelect = "none";
        headerDiv.style.fontSize = "12px";

        // Toggle Expand/Collapse arrow
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
            toggleEl.innerText = isCollapsed ? "▸" : "▾";
            toggleEl.style.fontWeight = "bold";
            headerDiv.appendChild(toggleEl);
        } else {
            const spacer = document.createElement("span");
            spacer.style.marginRight = "4px";
            spacer.style.width = "14px";
            spacer.style.display = "inline-block";
            headerDiv.appendChild(spacer);
        }

        // Checkbox or Radio input element
        let input = null;
        if (!isGroup || path !== "Basemaps") {
            input = document.createElement("input");
            input.type = isMultiSelect ? "checkbox" : "radio";
            input.name = isMultiSelect ? (isGroup ? `group_${path}` : `layer_${id}`) : `parent_${parentPath}`;
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

        // Label Text
        const label = document.createElement("span");
        label.innerText = name;
        if (isGroup) {
            label.style.fontWeight = "bold";
        }
        headerDiv.appendChild(label);

        nodeDiv.appendChild(headerDiv);

        // Children Drawer (for groups)
        let childrenDiv = null;
        if (isGroup) {
            childrenDiv = document.createElement("div");
            const isCollapsed = collapsedPaths[path] === true;
            childrenDiv.style.display = isCollapsed ? "none" : "block";
            childrenDiv.style.borderLeft = "1px dashed #ccc";
            childrenDiv.style.marginLeft = "5px";
            childrenDiv.style.paddingLeft = "8px";

            // Render sub-groups and layers recursively
            Object.keys(node.children).forEach(key => {
                renderNode(node.children[key], childrenDiv, depth + 1, node);
            });
            node.layers.forEach(lyr => {
                renderNode(lyr, childrenDiv, depth + 1, node);
            });

            nodeDiv.appendChild(childrenDiv);
        }

        // Toggle Expand/Collapse when clicking header row (background, empty space, or arrow)
        if (isGroup) {
            headerDiv.addEventListener("click", () => {
                const isCollapsed = collapsedPaths[path] === true;
                collapsedPaths[path] = !isCollapsed;
                if (toggleEl) {
                    toggleEl.innerText = !isCollapsed ? "▸" : "▾";
                }
                if (childrenDiv) {
                    childrenDiv.style.display = !isCollapsed ? "none" : "block";
                }
            });
        }

        // Label click listener
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

        // Input change listener
        if (input) {
            input.addEventListener("change", () => {
                const isChecked = input.checked;
                
                // For radio buttons, only process the selection event (ignore de-selection events)
                if (!isMultiSelect && !isChecked) {
                    return;
                }

                const currentLayers = model.get("layers");
                let updatedLayers = [...currentLayers];

                if (!isMultiSelect) {
                    // Radio button logic: set all siblings to visible=false, and this to visible=true
                    Object.keys(parentNode.children).forEach(key => {
                        const sibGroup = parentNode.children[key];
                        const active = sibGroup.path === path;
                        groupConfigs[sibGroup.path] = { 
                            ...groupConfigs[sibGroup.path], 
                            visible: active 
                        };
                    });
                    parentNode.layers.forEach(sibLyr => {
                        const active = sibLyr.id === id;
                        updatedLayers = updatedLayers.map(origLayer => {
                            if (origLayer.id === sibLyr.id) {
                               return { ...origLayer, visible: active };
                            }
                            return origLayer;
                        });
                    });
                } else {
                    // Checkbox logic
                    if (isGroup) {
                        groupConfigs[path] = { 
                            ...groupConfigs[path], 
                            visible: isChecked 
                        };
                    } else {
                        updatedLayers = updatedLayers.map(origLayer => {
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

    // Render tree from root node
    renderNode(tree, sidebar, 0, null);
}
