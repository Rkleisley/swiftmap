"""
Draw an AOI, filter the data — the analyst loop, live.

The draw toolbar's output is a two-way trait: everything drawn, edited, or
deleted lands in m.drawings as GeoJSON, with draw_seq bumping once per change.
`reactive_read(w, "draw_seq")` is the whole wiring — the table, the count, and
the map spotlight all recompute from one dependency.

Containment here is each polygon's bounding box, which is exact for rectangles;
swap in shapely's shape(...).contains(...) for true polygon containment.

Run from this directory:

    shiny run 03_draw_filter.py
"""
import numpy as np
import pandas as pd
from shiny import App, render, ui
from shinywidgets import output_widget, render_widget, reactive_read

from swiftmap import Map
from swiftmap.shiny import map_effect

rng = np.random.default_rng(3)
n = 250
df = pd.DataFrame({
    "lat": 36.02 + rng.normal(0, 0.06, n),
    "lon": -5.45 + rng.normal(0, 0.10, n),
    "site": [f"Sensor {i:03d}" for i in range(n)],
    "reading": np.round(rng.gamma(4, 4, n), 1),
})

app_ui = ui.page_fluid(
    ui.h3("Draw a box, filter the sensors"),
    ui.layout_columns(
        ui.card(
            ui.output_text("count"),
            ui.output_data_frame("sensor_table"),
        ),
        ui.card(output_widget("mapview")),
        col_widths=(4, 8),
    ),
)


def server(input, output, session):

    @render_widget
    def mapview():
        m = Map()
        m.add_circle_markers(df, name="Sensors", color_col="reading")
        m.configure_draw(show=True, tools=["rectangle", "polygon"])
        return m

    def inside_aois() -> pd.DataFrame:
        # Reading draw_seq registers the one dependency; w.drawings is then
        # current whenever this recomputes. No drawings means no filter.
        w = mapview.widget
        if w is None:
            return df
        reactive_read(w, "draw_seq")
        polygons = [d for d in w.drawings if d["geometry"]["type"] == "Polygon"]
        if not polygons:
            return df
        keep = np.zeros(len(df), dtype=bool)
        for feature in polygons:
            ring = np.asarray(feature["geometry"]["coordinates"][0])
            keep |= (df.lat.values >= ring[:, 1].min()) \
                  & (df.lat.values <= ring[:, 1].max()) \
                  & (df.lon.values >= ring[:, 0].min()) \
                  & (df.lon.values <= ring[:, 0].max())
        return df[keep]

    @render.text
    def count():
        sel = inside_aois()
        if len(sel) == len(df):
            return "Draw a rectangle or polygon on the map."
        return f"{len(sel)} of {len(df)} sensors inside"

    @render.data_frame
    def sensor_table():
        return render.DataGrid(inside_aois()[["site", "reading"]])

    @map_effect(mapview)
    def spotlight(m):
        sel = inside_aois()
        if len(sel) == len(df):
            m.set_feature_styles("Sensors", {})
        else:
            m.set_feature_styles("Sensors",
                                 {int(i): {"color": "#ffcc00", "radius": 12}
                                  for i in sel.index})


app = App(app_ui, server)
