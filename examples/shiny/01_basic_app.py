"""
The minimal swiftmap + Shiny app, and the one rule that matters.

THE RULE: the @render_widget function must depend on nothing reactive. It rebuilds
the widget whenever a dependency invalidates — throwing the map away and
re-uploading every coordinate buffer. Build the map once; make every update
through @map_effect against the live instance.

Run from this directory:

    shiny run 01_basic_app.py
"""
import numpy as np
import pandas as pd
from shiny import App, ui
from shinywidgets import output_widget, render_widget

from swiftmap import Map
from swiftmap.shiny import map_effect

rng = np.random.default_rng(7)
n = 200
df = pd.DataFrame({
    "lat": 36.02 + rng.normal(0, 0.06, n),
    "lon": -5.45 + rng.normal(0, 0.10, n),
    "site": [f"Sensor {i:03d}" for i in range(n)],
    "reading": np.round(rng.gamma(4, 4, n), 1),
    "status": rng.choice(["Active", "Idle", "Fault"], n, p=[0.6, 0.3, 0.1]),
})

app_ui = ui.page_fluid(
    ui.h3("swiftmap basic app"),
    ui.layout_sidebar(
        ui.sidebar(
            ui.input_select("status", "Status", ["All", "Active", "Idle", "Fault"]),
        ),
        output_widget("mapview"),
    ),
)


def server(input, output, session):

    @render_widget
    def mapview():
        # Built once: no input.* here, ever. The status folders exist up front, so
        # the effect below only ever toggles visibility — no layer churn.
        m = Map()
        m.add_circle_markers(df, name="Sensors",
                             layer_group=["Sensors", "status"],
                             color_col="reading")
        m.configure_group("Sensors", collapsed=False)
        return m

    @map_effect(mapview)
    def filter_status(m):
        # map_effect resolves the live widget (skipping quietly if it has not
        # rendered yet) and batches everything in the body into one message.
        # select() is declarative: each call states the complete selection for
        # its scope, so there is nothing to undo between calls.
        wanted = input.status()
        if wanted == "All":
            m.select(None, scope="Sensors")
        else:
            m.select(group=f"Sensors/{wanted}", scope="Sensors")


app = App(app_ui, server)
