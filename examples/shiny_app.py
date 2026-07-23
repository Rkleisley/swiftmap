from shiny import App, ui, render
from shinywidgets import output_widget, render_widget
import ipyleaflet
import pandas as pd
import numpy as np

# Sample Data
np.random.seed(42)
df = pd.DataFrame({
    "lat": np.random.uniform(30, 45, 50),
    "lon": np.random.uniform(-120, -75, 50),
    "name": [f"Point {i}" for i in range(50)]
})

app_ui = ui.page_fluid(
    ui.h2("swiftmap - Shiny Benchmarks"),
    ui.navset_tab(
        ui.nav_panel("Simple Map",
            ui.h3("Simple Map (Standard ipyleaflet)"),
            ui.p("Baseline: Just a map with a basemap."),
            output_widget("simple_map")
        ),
        ui.nav_panel("Markers",
            ui.h3("Markers (Standard ipyleaflet)"),
            ui.p("Code required: Manual Marker creation + LayerGroup management."),
            output_widget("markers_map")
        ),
        ui.nav_panel("GeoJSON",
            ui.h3("GeoJSON"),
            ui.p("Placeholder for GeoJSON example."),
            output_widget("geojson_map")
        ),
        ui.nav_panel("Heatmap",
            ui.h3("Heatmap"),
            ui.p("Placeholder for heatmap example."),
            output_widget("heatmap_map")
        ),
    )
)

def server(input, output, session):
    @render_widget
    def simple_map():
        m = ipyleaflet.Map(center=(39.8283, -98.5795), zoom=4)
        m.add_layer(ipyleaflet.basemaps.CartoDB.Positron)
        return m

    @render_widget
    def markers_map():
        m = ipyleaflet.Map(center=(39.8283, -98.5795), zoom=4)
        m.add_layer(ipyleaflet.basemaps.CartoDB.Positron)
        
        # Standard ipyleaflet approach: Create Marker objects manually
        markers = []
        for _, row in df.iterrows():
            marker = ipyleaflet.Marker(location=(row["lat"], row["lon"]))
            markers.append(marker)
        
        # Add them as a LayerGroup
        marker_layer = ipyleaflet.LayerGroup(layers=markers)
        m.add_layer(marker_layer)
        return m

app = App(app_ui, server)
