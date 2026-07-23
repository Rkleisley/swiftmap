# swiftmap

`swiftmap` is a high-performance Python mapping library built on top of `anywidget` and Leaflet JS, optimized for interactive data visualization in **Shiny for Python**.

It replaces standard Leaflet vector drawing layers with custom **WebGL rendering pipelines**, allowing the map to render millions of data points, complex polylines, and shapes smoothly at 60 FPS.

---

## Key Features

### 1. High-Performance WebGL Pipelines
*   **Hardware Acceleration:** Overlays (markers, circle markers, polylines, polygons, circles, and GeoJSON shapes) are rendered via WebGL using a customized integration of `Leaflet.glify`.
*   **Custom Shaders:** Markers use custom GLSL shaders (e.g., a hardware-rendered, anti-aliased pin icon shader with drop-shadow overlays) to ensure beautiful rendering at scale.

### 2. Nested Sidebar Control & Hierarchical Visibility
*   **Arbitrary Folder Pathing:** Organizes map layers into infinite directory paths (e.g., `layer_group=["Sensor Feeds", category_col, "Active"]`) which are resolved automatically into nested tree-views in the sidebar.
*   **Group Radio Toggle Support:** Configure specific group paths to display radio buttons instead of checkboxes (e.g., for mutually exclusive basemaps or specific overlay groups).
*   **Propagated Visibility:** Toggling a folder checkbox automatically turns its nested child layers on and off, with parent visibility states cleanly inherited by WebGL draw passes.

### 3. Top-Down Event Coordination
*   **Overlapping Priority Picker:** If a marker, polyline, and polygon overlap, mouse clicks and hover events are resolved through a top-down priority transaction queue (Points > Lines > Polygons), ensuring only the topmost layer triggers event callbacks.
*   **Strict Distance Thresholds:** Uses precise pixel-distance picking thresholds (25px for markers, 12px for circle markers) to eliminate ghost picks or misfires on empty map space.

### 4. Interactive State Synchronization
*   **Bidirectional Sync:** Automatically tracks and updates map center, zoom level, layer visibilities, and selection events (`clicked_layer_id` and `selected_index`) reactively to Python/Shiny.
*   **Automatic Data Buffering:** Point/shape coordinates are converted to optimized binary buffers on the Python side for fast serialization to the client widget.

---

## Installation

```bash
pip install -e .
```

---

## Quick Example

```python
import polars as pl
from shiny import App, ui
from shinywidgets import output_widget, render_widget
from swiftmap import Map

app_ui = ui.page_fluid(
    ui.h2("Swiftmap WebGL Plot"),
    output_widget("map_widget")
)

def server(input, output, session):
    @render_widget
    def map_widget():
        # Instantiate map
        m = Map(center=[36.0, -5.35], zoom=10)
        
        # Load sample coordinates
        df = pl.DataFrame({
            "lat": [36.01, 36.02, 36.03],
            "lon": [-5.36, -5.35, -5.34],
            "name": ["Point A", "Point B", "Point C"],
            "value": [12.4, 8.2, 15.1],
            "status": ["Active", "Inactive", "Active"]
        })
        
        # Plot with automatic path grouping
        m.add_markers(
            data=df,
            lat_col="lat",
            lon_col="lon",
            name="name",
            layer_group=["Points", "status"],
            color="blue"
        )
        
        # Set mutually exclusive radio buttons for the status sub-folders
        m.group_configs = {
            "Points/Active": {"multi_select": False},
            "Points/Inactive": {"multi_select": False}
        }
        
        return m

app = App(app_ui, server)
```
