"""
A table and a map, linked both ways — the pattern behind most swiftmap apps.

Table → map: selecting rows drives m.select(), hiding everything else in scope
and zooming to the selection. Map → table: clicking a dwell reports back through
the clicked_layer_id trait.

One layer per dwell, named from the data, so table rows and map layers correspond
by name — no index bookkeeping.

Run from this directory:

    shiny run 02_linked_table.py
"""
import numpy as np
import pandas as pd
from shiny import App, render, ui
from shinywidgets import output_widget, render_widget, reactive_read

from swiftmap import Map
from swiftmap.shiny import map_effect

rng = np.random.default_rng(12)
n_dwells = 8

# One rectangle per dwell, long format: four corner rows per dwell_id.
centers = pd.DataFrame({
    "dwell": [f"Dwell {i + 1:02d}" for i in range(n_dwells)],
    "clat": 36.02 + rng.normal(0, 0.05, n_dwells),
    "clon": -5.45 + rng.normal(0, 0.09, n_dwells),
    "hours": np.round(rng.gamma(3, 5, n_dwells), 1),
    "risk": rng.choice(["low", "medium", "high"], n_dwells),
})
h, w = 0.012, 0.018
corners = []
for _, r in centers.iterrows():
    for dy, dx in [(-h, -w), (-h, w), (h, w), (h, -w)]:
        corners.append({"dwell": r.dwell, "lat": r.clat + dy, "lon": r.clon + dx,
                        "hours": r.hours, "risk": r.risk})
dwells = pd.DataFrame(corners)

app_ui = ui.page_fluid(
    ui.h3("Dwells: table and map, linked"),
    ui.layout_columns(
        ui.card(
            ui.output_data_frame("dwell_table"),
            ui.output_text("clicked_info"),
        ),
        ui.card(output_widget("mapview")),
        col_widths=(4, 8),
    ),
)


def server(input, output, session):

    @render_widget
    def mapview():
        m = Map()
        # name matching a column: one polygon layer per dwell, named from its
        # own value — which is exactly what makes select-by-name line up with
        # table rows below.
        m.add_polygon(dwells, shape_id_col="dwell", name="dwell",
                      layer_group="Dwells", fill_opacity=0.35,
                      popup_fields=["hours", "risk"],
                      popup_names=["Dwell hours", "Risk"])
        return m

    @render.data_frame
    def dwell_table():
        return render.DataGrid(centers[["dwell", "hours", "risk"]],
                               selection_mode="rows")

    @map_effect(mapview)
    def select_from_table(m):
        sel = dwell_table.cell_selection() or {}
        rows = sel.get("rows", ())
        # Declarative and total: an empty selection restores everything in
        # scope, so clearing the table clears the map with the same call.
        m.select([centers["dwell"].iloc[i] for i in rows],
                 scope="Dwells", zoom=True, zoom_offset=-1)

    @render.text
    def clicked_info():
        # mapview.widget is reactive: this re-runs when the widget appears, and
        # click_seq bumps on EVERY feature click — including repeat clicks on
        # the same dwell, which clicked_layer_id alone would not re-report.
        w = mapview.widget
        if w is None:
            return "Click a dwell on the map."
        reactive_read(w, "click_seq")
        layer = w.get_layer(w.clicked_layer_id)
        return f"Clicked: {layer.get('name')}" if layer else "Click a dwell on the map."


app = App(app_ui, server)
