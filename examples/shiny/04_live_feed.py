"""
A feed that never fights the viewer.

`update_layer(data=..., append=True)` grows a layer in place, so the layer keeps its
identity while its data changes: the same id, name, folder, visibility, time animation
and highlight. That is what makes a refresh survivable — untick "Vessels" in the sidebar
while the feed runs and it stays unticked, scrub the time slider and the playhead stays
where you put it. Rebuilding the layer (remove + add) resets all of that on every tick.

Two feeds, two shapes:
  Vessels  — append: new pings land after the existing ones, the slider's range grows,
             and only the new rows go over the wire.
  Sensors  — replace: a sliding window of recent readings, recoloured over the new range.

Run from this directory:

    shiny run 04_live_feed.py
"""
import datetime as dt

import numpy as np
import pandas as pd
from shiny import App, reactive, render, ui
from shinywidgets import output_widget, render_widget

from swiftmap import Map
from swiftmap.shiny import map_effect

rng = np.random.default_rng(4)
START = dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc)
VESSELS = {"Vessel A": (36.00, -5.82, "#4e79a7"), "Vessel B": (35.94, -5.76, "#f28e2b")}


def pings(step, count):
    """`count` new positions per vessel, `step` ticks into the run."""
    rows = []
    for name, (lat0, lon0, _) in VESSELS.items():
        walked = step * count
        rows.append(pd.DataFrame({
            "vessel": name,
            "lat": lat0 + 0.002 * np.arange(walked, walked + count) + rng.normal(0, .002, count),
            "lon": lon0 + 0.009 * np.arange(walked, walked + count) + rng.normal(0, .003, count),
            "timestamp": [START + dt.timedelta(minutes=15 * (walked + i)) for i in range(count)],
        }))
    return pd.concat(rows, ignore_index=True)


def readings(n=120):
    return pd.DataFrame({
        "lat": 36.03 + rng.normal(0, .05, n),
        "lon": -5.45 + rng.normal(0, .09, n),
        "site": [f"S{i:03d}" for i in range(n)],
        "reading": np.round(rng.gamma(4, 4, n), 1),
    })


app_ui = ui.page_fluid(
    ui.h3("Live feed"),
    ui.layout_sidebar(
        ui.sidebar(
            ui.input_switch("running", "Running", True),
            ui.input_slider("batch", "Pings per vessel per tick", 5, 50, 10),
            ui.output_text("counter"),
            ui.help_text("Untick a layer, or scrub the slider — both survive every tick."),
        ),
        output_widget("mapview"),
    ),
)


def server(input, output, session):
    tick = reactive.value(0)
    pinged = reactive.value(0)

    @render_widget
    def mapview():
        # Built once, as always: the feed mutates this instance, never rebuilds it.
        m = Map(height="600px")
        seed = pings(0, 10)
        for name, (_, _, colour) in VESSELS.items():
            # One named layer per vessel. `name="vessel"` would fan out from the column
            # instead, and sibling layers born that way cannot be grown in place.
            m.add_circle_markers(seed[seed.vessel == name], name=name,
                                 layer_group="Vessels", color=colour, radius=5)
        m.add_circle_markers(readings(), name="Sensors", color_col="reading")
        m.make_time_layer(group="Vessels", period="PT1H", duration="PT6H", fade=True)
        m.configure_legend(show=True, title="Feed")
        return m

    @reactive.effect
    def _timer():
        if not input.running():
            return
        reactive.invalidate_later(1.0)
        with reactive.isolate():
            tick.set(tick() + 1)

    @map_effect(mapview, event=tick)
    def push(m):
        step = tick()
        batch = int(input.batch())
        with reactive.isolate():
            pinged.set(pinged() + batch * len(VESSELS))
        # Append: only the new rows cross the wire, whatever the layer already holds.
        for name, group in pings(step, batch).groupby("vessel"):
            m.update_layer(name, data=group, append=True)
        # Replace: a fresh window, recoloured over its own range.
        m.update_layer("Sensors", data=readings())

    @render.text
    def counter():
        return f"tick {tick()} · {pinged()} pings appended"


app = App(app_ui, server)
