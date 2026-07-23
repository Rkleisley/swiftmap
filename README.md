# 🗺️ swiftmap

`swiftmap` is a Python mapping package designed to **enhance `ipyleaflet` with existing Leaflet addons and make them fully usable in Shiny**. 

Rather than reinventing the wheel, `swiftmap` follows an **open-source-first philosophy**: we actively search for and integrate existing Leaflet plugins and addons. If a feature does not exist in the open-source ecosystem, only then do we design and build it by hand.

---

## 🎯 Project Mission & Core Philosophy

1. **Leverage the Leaflet Ecosystem:** The JavaScript Leaflet community has built thousands of rich addons (e.g., grouped layer controls, advanced drawing tools, heatmaps, and routing engines). `swiftmap` bridges these directly into Python.
2. **First-Class Shiny Integration:** `ipyleaflet` is highly interactive, but utilizing its plugins within reactive frameworks like **Shiny for Python** can be complex. `swiftmap` wraps these addons with state synchronization and event handlers tailored for Shiny (e.g., using `shinywidgets`).
3. **Open Source First, Custom Second:** 
   * **Rule 1:** *Always* search for an existing open-source Leaflet addon first.
   * **Rule 2:** If and only if no suitable open-source addon is found, build the feature by hand (custom Leaflet JS + Python `ipywidgets`/`ipyleaflet` integration).

---

## 🚀 Key Features

*   🔌 **Leaflet Addon Wrappers:** Seamlessly wrap existing Leaflet JS plugins into Python classes.
*   ⚡ **Reactive Shiny Bindings:** Bidirectional traitlets allow Shiny apps to react to map interactions (clicks, bounds changes, addon events) without full map re-renders.
*   🛠️ **Custom Fallback Engine:** A clean developer interface for building custom Leaflet addons from scratch when open-source options are missing.
*   📦 **Grouped & Customized Controls:** Dynamic layer management, custom legends, and controls synced with Shiny inputs.

---

## 💻 Installation

```bash
pip install swiftmap
```

## 🛠️ Developer Workflow: Integrating an Addon

When adding a feature or control to `swiftmap`, always follow these steps:

1. **Search Open Source First:** Check Leaflet's plugin directory or npm for existing packages (e.g., `leaflet-groupedlayercontrol`, `Leaflet.draw`).
2. **Bridge to Python:** Create a wrapper that subclasses/integrates with `ipyleaflet` and syncs events via Traitlets.
3. **Optimize for Shiny:** Ensure the addon state is bound to Shiny inputs so developers can access map selections, draw events, and settings reactively.
4. **Fallback to Custom:** If no addon exists, write clean CSS/JS and bundle it using `ipywidgets`' package infrastructure.

---

## 📖 Quick Example (Shiny Integration)

```python
from shiny import App, ui
from shinywidgets import output_widget, render_widget
from swiftmap import Map

app_ui = ui.page_fluid(
    ui.h2("swiftmap + Shiny"),
    output_widget("map")
)

def server(input, output, session):
    @render_widget
    def map():
        # Create map and add enhanced controls/addons
        m = Map(center=[39.82, -98.57], zoom=4)
        m.add_layer_control()  # Enhanced grouped layers control
        return m

app = App(app_ui, server)
```
