const collapsedPaths = {};  // path -> collapsed?

export function getLayerBounds(l, coordinateBuffers) {
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

// The write half of a visibility toggle: one custom message naming the flipped ids,
// instead of the whole layers trait. Python applies the fields and re-emits them as
// `set` patch ops, which is how other views of the same map (notebook outputs) stay
// in step now that the trait no longer carries toggles.
export function sendLayerWrite(model, changes) {
    if (!changes.length) return;
    try {
        model.send({
            kind: "swiftmap_write",
            ops: changes.map(c => ({ op: "set", id: c.id, fields: { visible: c.visible } })),
        });
    } catch (err) { /* no live backend; the rendered list already holds the change */ }
}

export function normalizeRadioLayers(layers, groupConfigs) {
    const tree = { name: "Root", path: "", children: {}, layers: [], isGroup: true };
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

    // Reports what it changed -- {changes: [{id, visible}], groupsChanged} -- so the
    // caller can write back exactly those flips rather than the whole layers list.
    const changes = [];
    let groupsChanged = false;
    function enforceRadioToggles(node) {
        const conf = groupConfigs[node.path] || { multi_select: true };
        const isRadioGroup = conf.multi_select === false;
        if (isRadioGroup) {
            let foundActive = false;
            Object.keys(node.children).forEach(key => {
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
            node.layers.forEach(lyr => {
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
        Object.keys(node.children).forEach(key => {
            enforceRadioToggles(node.children[key]);
        });
    }
    enforceRadioToggles(tree);
    return { changes, groupsChanged };
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
    function renderNode(node, parentEl, depth, parentNode, parentEffectiveVisible) {

        if (node.path === "") {
            // Render root's child groups and child layers directly without header
            Object.keys(node.children).forEach(key => {
                renderNode(node.children[key], parentEl, depth, node, true);
            });
            node.layers.forEach(lyr => {
                renderNode(lyr, parentEl, depth, node, true);
            });
            return;
        }

        const isGroup = node.isGroup === true;
        const path = isGroup ? node.path : null;
        const name = node.name;
        const id = isGroup ? null : node.id;

        // Determine selection type (checkbox vs radio) based on parent's multi_select config
        const parentPath = parentNode ? parentNode.path : "";
        const parentConf = groupConfigs[parentPath] || { multi_select: true };
        const isMultiSelect = parentConf.multi_select !== false;

        const nodeDiv = document.createElement("div");
        nodeDiv.style.marginBottom = "4px";

        let selfVisible = true;
        if (isGroup) {
            selfVisible = path === "Basemaps" ? true : (groupConfigs[path]?.visible !== false);
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
            toggleEl.textContent = isCollapsed ? "▸" : "▾";
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
        label.textContent = name;
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
                renderNode(node.children[key], childrenDiv, depth + 1, node, selfEffectiveVisible);
            });
            node.layers.forEach(lyr => {
                renderNode(lyr, childrenDiv, depth + 1, node, selfEffectiveVisible);
            });

            nodeDiv.appendChild(childrenDiv);
        }

        // Toggle Expand/Collapse when clicking header row (background, empty space, or arrow)
        if (isGroup) {
            headerDiv.addEventListener("click", () => {
                const isCollapsed = collapsedPaths[path] === true;
                collapsedPaths[path] = !isCollapsed;
                if (toggleEl) {
                    toggleEl.textContent = !isCollapsed ? "▸" : "▾";
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

                // Flipped on the list this sidebar rendered from, never model.get("layers").
                // Layers added after the widget is displayed arrive as patches that update the
                // frontend's local state without touching the trait, so the model's copy is
                // frozen at whatever the initial state message carried. Building the update from
                // it drops every later layer: the toggle matches no id, writes the stale list
                // back, and the change handler then resets local state to it -- so the box
                // re-checks itself and the layer never hides.
                //
                // The flips mutate the rendered list in place and reach Python as a targeted
                // write (sendLayerWrite), never by setting the layers trait: the full
                // write-back scaled with the map instead of the click. At 25 tracks x 200k
                // vertices it was a 36 MB frame -- past uvicorn's 16 MB default websocket
                // cap, so the server closed the connection and the Shiny session died on
                // the first checkbox. Setting the trait without saving is just as fatal:
                // it stays dirty and the next save_changes (any pan) flushes it.
                const changes = [];
                const flip = (lyr, visible) => {
                    if ((lyr.visible !== false) === visible) return;
                    lyr.visible = visible;
                    changes.push({ id: lyr.id, visible });
                };

                if (!isMultiSelect) {
                    // Radio button logic: set all siblings to visible=false, and this to visible=true
                    Object.keys(parentNode.children).forEach(key => {
                        const sibGroup = parentNode.children[key];
                        const active = sibGroup.path === path;
                        groupConfigs[sibGroup.path] = {
                            ...groupConfigs[sibGroup.path],
                            visible: active
                        };
                        collapsedPaths[sibGroup.path] = !active;
                    });
                    parentNode.layers.forEach(sibLyr => flip(sibLyr, sibLyr.id === id));
                } else {
                    // Checkbox logic
                    if (isGroup) {
                        groupConfigs[path] = {
                            ...groupConfigs[path],
                            visible: isChecked
                        };
                        collapsedPaths[path] = !isChecked;
                    } else {
                        const lyr = layers.find(l => l.id === id);
                        if (lyr) flip(lyr, isChecked);
                    }
                }

                sendLayerWrite(model, changes);
                // group_configs stays on the trait: it is a handful of folder flags, and the
                // spread gives Backbone a fresh reference so the in-place edits register.
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

    // Render tree from root node
    renderNode(tree, sidebar, 0, null, true);
}
