from shiny import App, ui, render
import pandas as pd
import numpy as np
import sys
import os
from pathlib import Path

# Add 'src' to path
src_path = str(Path(__file__).parent.parent / "src")
if src_path not in sys.path:
    sys.path.append(src_path)

from swiftmap import Map

# Sample Data
np.random.seed(42)
df = pd.DataFrame({
    "lat": np.random.uniform(30, 45, 50),
    "lon": np.random.uniform(-120, -75, 50),
    "name": [f"Point {i}" for i in range(50)]
})

app_ui = ui.page_fluid(
    ui.h2("swiftmap - Shiny Validation (Non-Widget)"),
    ui.navset_tab(
        ui.nav_panel("Simple Map",
            ui.output_ui("simple_map_ui")
        ),
        ui.nav_panel("Circle Markers",
            ui.p("One line: m.add_circle_markers(df)"),
            ui.output_ui("markers_map_ui")
        ),
    )
)

def server(input, output, session):
    @render.ui
    def simple_map_ui():
        # Using the new .to_shiny() helper which bypasses widgets
        return Map().add_basemap("CartoDB.Positron").to_shiny()

    @render.ui
    def markers_map_ui():
        m = Map().add_basemap("CartoDB.Positron")
        m.add_circle_markers(df, color="green", radius=5)
        return m.to_shiny()

app = App(app_ui, server)
