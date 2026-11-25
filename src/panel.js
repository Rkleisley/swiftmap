// The collapse every overlay panel shares: the Layers Control and the legend.
//
// Collapsed, a panel is its title alone -- the content goes and the box shrinks.
// A panel is positioned by its ANCHORED edges (top/right for the Layers Control,
// any of the legend's eight positions: bottom/left, a centred translate, ...), so
// it shrinks INTO its anchor: a bottom-left legend folds to "Legend" in the
// bottom-left corner, a top-centre one to the top centre, never somewhere new.
//
// State per panel element, like the folder collapse state beside it: two maps on
// one page never share it, and it survives the full re-render every sync does.
const collapsedPanels = new WeakMap();

export function isPanelCollapsed(panel) {
    return collapsedPanels.get(panel) === true;
}

export function setPanelCollapsed(panel, collapsed) {
    collapsedPanels.set(panel, Boolean(collapsed));
}

// The title row: the title, and a button that folds the panel to it. The whole
// row toggles; the button is what a keyboard reaches (Enter / Space). `rerender`
// redraws the panel with the new state -- the renderers own their content.
export function panelHeader(panel, title, rerender, { gap = "8px" } = {}) {
    const collapsed = isPanelCollapsed(panel);
    const header = document.createElement("div");
    header.className = "swiftmap-panel-header";
    Object.assign(header.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "10px", fontSize: "13px", fontWeight: "bold", cursor: "pointer",
        userSelect: "none",
        ...(collapsed ? {} : { borderBottom: "2px solid #eee", paddingBottom: "4px",
                               marginBottom: gap }),
    });
    const label = document.createElement("b");
    label.textContent = title;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swiftmap-panel-toggle";
    button.textContent = collapsed ? "+" : "−";
    const verb = collapsed ? "Expand" : "Collapse";
    button.title = `${verb} ${title}`;
    button.setAttribute("aria-label", `${verb} ${title}`);
    button.setAttribute("aria-expanded", String(!collapsed));
    Object.assign(button.style, {
        border: "none", background: "transparent", color: "#555", cursor: "pointer",
        font: "bold 15px/1 sans-serif", padding: "0 2px", margin: "0",
    });
    header.append(label, button);
    header.addEventListener("click", () => {
        setPanelCollapsed(panel, !collapsed);
        rerender();
    });
    return header;
}
