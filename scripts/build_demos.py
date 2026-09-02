"""
Builds the public demo site into docs/ -- GitHub Pages serves it from there.

    python scripts/build_demos.py            # -> docs/
    python scripts/build_demos.py --out /tmp/site --skip-hero-large

Why a generator and not a hand-written page: every map on the site is built by
running swiftmap, here, at build time, and every code block on the site is the
*exact string that was executed* to build the map beside it. A card cannot drift
from its snippet, because the snippet is the source. Re-run this after any
change that touches rendering and the site is current; it belongs on the release
checklist next to `npm run build`.

## What it emits

    docs/index.html            the page
    docs/assets/swiftmap.js    the widget bundle, verbatim from swiftmap/static/
    docs/assets/swiftmap.css   its stylesheet, likewise
    docs/assets/site.css       the page's own chrome (scripts/demo_assets/)
    docs/assets/gallery.js     the host driver          (scripts/demo_assets/)
    docs/data/<slug>/map.json  one map's composed state, buffers left out
    docs/data/<slug>/b<i>.bin  its coordinate/colour/time buffers, raw

## Why not just call m.save() twenty times

`Map.save()` inlines the whole bundle per file, which is right for handing
someone one map and wrong for a page holding twenty: twenty copies of the same
650 KB. So the site is the other shape the host interface allows -- the bundle
loads once and each map is a `createHostStub` over a small map.json. Same core,
same five host methods (src/host.js), same state keys (swiftmap/export.py); the
only difference is that buffers travel as raw .bin instead of base64, saving the
export encoding's 4/3.

Everything below the "the demos" banner is content. The machinery above it is
about forty lines of state-to-disk and a Python-tokenizer syntax highlighter.
"""
import argparse
import html
import io
import json
import keyword
import shutil
import sys
import tempfile
import tokenize
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = Path(__file__).resolve().parent / "demo_assets"
REPO = "https://github.com/Rkleisley/swiftmap"
SITE = "https://rkleisley.github.io/swiftmap/"

sys.path.insert(0, str(ROOT))


# ===========================================================================
# the data every card shares
# ===========================================================================
#
# Executed once; shown once, in the collapsible panel above the gallery. Cards
# below run against the namespace it leaves behind, so their snippets stay the
# four-to-eight lines that are actually about the feature.

PREAMBLE = '''\
import numpy as np
import pandas as pd
from swiftmap import Map

rng = np.random.default_rng(42)

# 600 harbour sensors around the Strait of Gibraltar.
n = 600
sensors = pd.DataFrame({
    "lat": 36.02 + rng.normal(0, 0.05, n),
    "lon": -5.45 + rng.normal(0, 0.09, n),
    "site": [f"S{i:03d}" for i in range(n)],
    "station": rng.choice(["Alpha", "Bravo", "Charlie", "Delta"], n),
    "region": rng.choice(["East", "West"], n),
    "status": rng.choice(["Active", "Idle", "Fault"], n, p=[.70, .22, .08]),
    "reading": np.round(rng.gamma(4, 4, n), 1),
    "volume": rng.integers(10, 500, n),
})

# Three vessels, one ping every half hour for a day.
steps = 48
pings = pd.concat([
    pd.DataFrame({
        "vessel": vessel,
        "lat": lat0 + np.cumsum(rng.normal(0.002, 0.003, steps)),
        "lon": lon0 + np.cumsum(rng.normal(0.009, 0.004, steps)),
        "timestamp": pd.date_range("2026-08-01", periods=steps,
                                   freq="30min", tz="UTC"),
    })
    for vessel, (lat0, lon0) in [("Vessel A", (36.00, -5.85)),
                                 ("Vessel B", (35.94, -5.78)),
                                 ("Vessel C", (36.08, -5.90))]
], ignore_index=True)

# Two dwell zones, each with a risk rating and a lifetime.
zones = pd.DataFrame({
    "zone": ["North"] * 4 + ["South"] * 4,
    "vertex": [0, 1, 2, 3] * 2,
    "lat": [36.10, 36.10, 36.16, 36.16, 35.90, 35.90, 35.96, 35.96],
    "lon": [-5.55, -5.40, -5.40, -5.55, -5.55, -5.40, -5.40, -5.55],
    "risk": ["high"] * 4 + ["medium"] * 4,
    "times": [["2026-08-01 02:00", "2026-08-01 14:00"]] * 4
           + [["2026-08-01 08:00", "2026-08-01 22:00"]] * 4,
})

# 8,100 detections in four clusters of very different density, for the
# density kernels.
detections = pd.concat([
    pd.DataFrame({"lat": clat + rng.normal(0, s, k),
                  "lon": clon + rng.normal(0, s * 1.6, k),
                  "weight": rng.gamma(2, 2, k)})
    for k, clat, clon, s in [(4500, 36.05, -5.45, 0.018),
                             (2000, 36.18, -5.28, 0.024),
                             ( 700, 35.92, -5.62, 0.030),
                             ( 900, 36.05, -5.45, 0.060)]
], ignore_index=True)
'''


# ===========================================================================
# the demos
# ===========================================================================
#
# slug     directory under docs/data, and the id the page mounts by
# title    card heading
# api      the one call the card is about, shown as a chip
# blurb    one or two sentences; what to look at, not what the code says
# nb       notebook under examples/ that treats it properly
# code     RUN to build the card's map, and SHOWN verbatim beneath it

CARDS = [
    dict(
        slug="points", title="Points, in two lines", api="add_circle_markers",
        blurb="No column mapping, no projection argument, no view to set. "
              "<code>lat</code>/<code>lon</code> are found by name and the map fits "
              "itself to whatever you add.",
        nb="01_quickstart.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Sensors")
''',
    ),
    dict(
        slug="color", title="Colour from a column", api="color_col",
        blurb="One keyword puts the data through a colormap, and the legend "
              "derives itself from the same fact. The colours are computed in "
              "Python and travel as a binary buffer, not as per-feature JSON.",
        nb="03_styling.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Sensors", color_col="reading",
                     colormap="viridis")
m.configure_legend(show=True, title="Reading (ppm)")
''',
    ),
    dict(
        slug="size", title="Size from a column", api="radius_col",
        blurb="Radii are area-proportional -- the radius grows with the square "
              "root -- so a doubled value looks doubled instead of quadrupled.",
        nb="03_styling.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Sensors",
                     color_col="reading", radius_col="volume",
                     radius_range=(3, 18))
m.configure_legend(show=True, title="Volume")
''',
    ),
    dict(
        slug="categories", title="Categories keep their colours", api="colormap={...}",
        blurb="A non-numeric column takes categorical colours automatically; a "
              "<code>{value: colour}</code> mapping pins them, and the legend "
              "reads in the mapping's order.",
        nb="03_styling.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Status", color_col="status",
                     colormap={"Active": "#59a14f", "Idle": "#4e79a7",
                               "Fault": "#e15759"})
m.configure_legend(show=True, title="Sensor status")
''',
    ),
    dict(
        slug="bins", title="Bands instead of a ramp", api="color_bins",
        blurb="Bin edges turn a continuous ramp into discrete classes, and the "
              "legend switches from a gradient to labelled swatches to match.",
        nb="03_styling.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Banded", color_col="reading",
                     color_bins=[10, 20, 30], colormap="turbo")
m.configure_legend(show=True, title="Reading band")
''',
    ),
    dict(
        slug="sidebar", title="A sidebar built from your columns", api="layer_group",
        blurb="A list of column names becomes a folder tree: region, then status, "
              "then a layer per station. Toggling a folder costs about a hundred "
              "bytes on the wire, at any scale.",
        nb="04_sidebar_groups.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="station",
                     layer_group=["Sensors", "region", "status"],
                     color_col="status")
m.configure_group("Sensors", collapsed=False)
''',
    ),
    dict(
        slug="legend", title="A legend you can add to", api="legend_add",
        blurb="The derived legend is the starting point, not the ceiling: manual "
              "rows sit alongside it, grouped, in any of the four corners.",
        nb="11_legend.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Sensors", color_col="reading")
m.configure_legend(show=True, title="Harbour key", position="bottom-right")
m.legend_add("Restricted zone", shape="polygon", color="#e15759",
             fill_color="#e1575944", group="Areas")
m.legend_add("Confidence", categories=["confirmed", "probable", "ruled out"])
''',
    ),
    dict(
        slug="time", title="A time slider over the same points", api="make_time_layer",
        blurb="Press play: the pings sweep along their routes, which stay put "
              "because only the point layer is timed. Point time filtering runs "
              "on the GPU -- the per-point timestamps upload once as vertex "
              "attributes and each tick is a single uniform, so scrubbing "
              "re-sends nothing.",
        nb="06_time.ipynb",
        code='''\
m = Map()
m.add_line(pings, line_id_col="vessel", order_col="timestamp",
           name="vessel", layer_group="Routes", color="#b0b7be", weight=2)
m.add_circle_markers(pings, name="Pings", color_col="vessel", radius=7)
m.make_time_layer("Pings", duration="PT6H", fade=True)
m.configure_time(period="PT1H", speed=2, loop=True, position="bottom-center")
''',
    ),
    dict(
        slug="tracks", title="Long-format rows become lines", api="add_line",
        blurb="An id column and an order column are enough -- no grouping, no "
              "geometry construction. WKT, GeoJSON and GeoPandas work the same way.",
        nb="02_data_sources.ipynb",
        code='''\
m = Map()
m.add_line(pings, line_id_col="vessel", order_col="timestamp",
           name="vessel", color_col="vessel", weight=3)
m.configure_legend(show=True, title="Tracks")
''',
    ),
    dict(
        slug="polygons", title="Areas, labelled and popped up", api="add_polygon",
        blurb="Interior holes and MultiPolygons render correctly. "
              "<code>label=</code> takes a column name and chips every shape with "
              "its own value.",
        nb="02_data_sources.ipynb",
        code='''\
m = Map()
m.add_polygon(zones, shape_id_col="zone", order_col="vertex",
              name="zone", label="zone", color="crimson",
              fill_opacity=0.25, popup_fields=["risk"], popup_names=["Risk"])
m.add_circle_markers(sensors, name="Sensors", radius=4, color="#4e79a7")
''',
    ),
    dict(
        slug="collection", title="One mixed dataset, one call", api="add_collection",
        blurb="Points, lines and areas in the same frame: swiftmap makes one layer "
              "per geometry kind and merges them under a single sidebar entry.",
        nb="02_data_sources.ipynb",
        code='''\
survey = pd.DataFrame({
    "geometry": ["POINT (-5.36 36.13)",
                 "LINESTRING (-5.44 36.05, -5.36 36.09, -5.30 36.14)",
                 "POLYGON ((-5.42 36.00, -5.32 36.00, -5.32 36.06, "
                 "-5.42 36.06, -5.42 36.00))"],
    "label": ["Buoy", "Route", "Zone"],
})
m = Map()
m.add_collection(survey, name="label", layer_group="Survey")
''',
    ),
    dict(
        slug="density-screen", title="Density: the screen-space kernel", api="add_heatmap",
        blurb="The classic heat blob, recomputed per frame on the GPU. Zoom in and "
              "the field re-normalises to what is on screen.",
        nb="14_density.ipynb",
        code='''\
m = Map()
m.add_heatmap(detections, name="Density", radius=40)
m.configure_legend(show=True, title="Detections")
''',
    ),
    dict(
        slug="density-h3", title="Density: real H3 cells", api='cells="h3"',
        blurb="The same points binned into H3 hexagons and filled by their sums -- "
              "cells that carry their own ids, so a click tells you which cell and "
              "how many.",
        nb="14_density.ipynb",
        code='''\
m = Map()
m.add_heatmap(detections, cells="h3", resolution=6,
              weight_col="weight", name="Hex density")
m.configure_legend(show=True, title="Weight per cell")
''',
    ),
    dict(
        slug="density-geohash", title="Density: geohash cells", api='cells="geohash"',
        blurb="The other cell family, same kernel. Rectangles instead of hexagons, "
              "and <code>base=</code> picks between geohash-32 and Niemeyer-16.",
        nb="14_density.ipynb",
        code='''\
m = Map()
m.add_heatmap(detections, cells="geohash", length=5, base=32,
              name="Geohash density")
m.configure_legend(show=True, title="Detections per cell")
''',
    ),
    dict(
        slug="draw", title="Draw an area of interest", api="configure_draw",
        blurb="Leaflet-Geoman's toolbar, wired to a synced trait. In a notebook or "
              "a Shiny app <code>m.drawings</code> updates in Python as you draw; "
              "here there is no Python behind the page, so the shapes stay put.",
        nb="12_draw_aoi.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Sensors", color_col="reading")
m.configure_draw(show=True, tools=["rectangle", "polygon", "circle"])
m.drawings = [{"type": "Feature", "properties": {"name": "Patrol box"},
               "geometry": {"type": "Polygon", "coordinates": [[
                   [-5.55, 35.98], [-5.35, 35.98], [-5.35, 36.08],
                   [-5.55, 36.08], [-5.55, 35.98]]]}}]
''',
    ),
    dict(
        slug="labels", title="Permanent labels", api="label=",
        blurb="A column name labels each feature from its own value. Labels are DOM "
              "elements, so they are for sites and zones -- the point builders warn "
              "past a thousand.",
        nb="07_popups_tooltips.ipynb",
        code='''\
m = Map()
m.add_markers(sensors.head(12), name="Sites", label="site")
''',
    ),
    dict(
        slug="popups", title="Popups and tooltips", api="popup_fields",
        blurb="Click a point for the popup, hover for the tooltip. Fields choose the "
              "columns, names relabel them, and every value is HTML-escaped.",
        nb="07_popups_tooltips.ipynb",
        code='''\
m = Map()
m.add_circle_markers(sensors, name="Sensors", color_col="reading", radius=7,
                     popup_fields=["site", "reading", "volume", "status"],
                     popup_names=["Site", "Reading (ppm)", "Volume", "Status"],
                     tooltip_fields=["site"])
''',
    ),
    dict(
        slug="basemaps", title="~880 basemaps, callable by name", api="add_basemap",
        blurb="Any xyzservices catalogue name, a WMS endpoint, or a raw "
              "<code>{z}/{x}/{y}</code> template. Open the sidebar and switch "
              "between them.",
        nb="04_sidebar_groups.ipynb",
        code='''\
m = Map()
m.add_basemap("Esri.WorldImagery")
m.add_basemap("CartoDB.DarkMatter")
m.add_circle_markers(sensors, name="Sensors", color="#ffcc00", radius=5)
''',
    ),
    dict(
        slug="highlight", title="Point at one thing", api="select / highlight",
        blurb="Both are declarative and total: each call states the whole selection, "
              "so switching needs no undoing and <code>select(None)</code> puts "
              "everything back. The highlight sits above the layer's own styling, "
              "not instead of it.",
        nb="05_layer_control.ipynb",
        code='''\
m = Map()
m.add_polygon(zones, shape_id_col="zone", order_col="vertex",
              name="zone", layer_group="Dwells", fill_opacity=0.2)
m.add_line(pings, line_id_col="vessel", order_col="timestamp",
           name="vessel", layer_group="Vessels", weight=3)
m.select("North", scope="Dwells")       # hides South, leaves Vessels alone
m.highlight("Vessel A", color="#ffcc00", lines={"weight": 6})
''',
    ),
    dict(
        slug="imagery", title="Georeferenced rasters", api="add_imagery",
        blurb="Anything GDAL reads, warped into the map's CRS at build time; a "
              "single band goes through the house colormaps. The source here is "
              "UTM 30N, reprojected on the way in.",
        nb="13_imagery.ipynb",
        needs="rasterio",
        code='''\
m = Map()
m.add_imagery("demo_dem.tif", name="Synthetic DEM",
              colormap="turbo", vmin=0, vmax=1500, opacity=0.85)
m.add_circle_markers(sensors.head(80), name="Sites",
                     color_col="reading", radius=5)
''',
    ),
]


# The hero: one field of synthetic vessel traffic, sampled at three sizes.
# Tiers are subsamples of the SAME points, so clicking up the ladder thickens
# the picture rather than replacing it.
HERO_TIERS = [
    dict(slug="hero-10k", points=10_000, note="about where an SVG map gives up"),
    dict(slug="hero-100k", points=100_000, note="already past every vector library", initial=True),
    dict(slug="hero-1m", points=1_000_000, note="still one drag"),
]

# Run, like every card's snippet, against a namespace holding `traffic` -- so
# the hero above is built by the code printed under it, same as the gallery.
HERO_CODE = '''\
# traffic: 1,000,000 AIS pings -- lane, ferry, coastal, fishing, anchorage.
m = Map()
m.select("World Gray Canvas", scope="Basemaps")   # a bare Map() ships two
m.add_circle_markers(traffic, name="Vessel traffic", layer_group="AIS",
                     radius=2, color_col="speed_kn",
                     colormap="turbo", vmin=0, vmax=21)
m.configure_legend(show=True, title="Speed over ground (kn)")
'''


# The hero's field, as five kinds of traffic. Random points in a bounding box
# would spray half the data over Spain and read as noise -- and a hero that
# proves scale has to be worth looking at while it proves it. Speed does the
# work of making the structure legible: through `colormap="turbo"` an anchorage
# comes out dark blue, a fishing ground cyan-green, coastal traffic yellow, a
# trunk lane orange and a fast ferry deep red, so the picture separates into
# recognisable things instead of one smear at one colour.
#
# (lon, lat) waypoints, share of the total, lateral spread in degrees,
# and the speed each kind runs at.
HERO_LANES = [
    # Trunk routes: Gibraltar in, up the Spanish coast and along the Algerian.
    ([(-5.62, 35.94), (-4.60, 36.18), (-2.10, 36.62), (0.40, 37.85),
      (2.40, 39.25), (3.95, 41.05), (4.30, 42.35)],        0.15, 0.022, (15.5, 1.8)),
    ([(-5.62, 35.94), (-3.60, 35.98), (-1.10, 36.30), (1.40, 36.80),
      (3.00, 36.82)],                                       0.11, 0.020, (14.8, 1.7)),
    ([(-0.35, 39.40), (1.20, 38.95), (2.60, 39.52), (4.40, 39.90)], 0.06, 0.018, (14.0, 1.6)),
    ([(2.20, 41.35), (3.60, 41.95), (5.10, 42.90)],         0.05, 0.020, (15.0, 1.7)),
    # Ferries: short, fast, dead straight.
    ([(-4.42, 36.70), (-2.94, 35.29)],                      0.035, 0.010, (20.0, 1.1)),
    ([(-5.44, 36.13), (-5.32, 35.89)],                      0.030, 0.008, (19.4, 1.2)),
    ([(-0.48, 38.34), (-0.62, 35.73)],                      0.030, 0.011, (19.8, 1.2)),
    ([(2.16, 41.36), (2.64, 39.56)],                        0.030, 0.010, (20.4, 1.1)),
    # Coastal traffic: slower and looser, but still a route, not a smear.
    ([(-5.30, 36.05), (-4.40, 36.72), (-2.90, 36.74), (-0.85, 37.58),
      (-0.20, 38.55), (0.20, 39.35), (1.05, 40.60), (2.20, 41.30)], 0.075, 0.038, (9.6, 1.9)),
    ([(-5.20, 35.85), (-3.00, 35.30), (-0.60, 35.70), (1.60, 36.55),
      (3.10, 36.80), (4.60, 37.05)],                        0.055, 0.036, (9.0, 1.9)),
    # Two more crossings, so the basin fills instead of one diagonal band.
    ([(2.65, 39.50), (4.80, 39.60), (6.20, 39.20)],         0.035, 0.020, (14.2, 1.7)),
    ([(0.30, 39.30), (0.90, 40.60), (3.20, 43.10)],         0.035, 0.022, (13.6, 1.7)),
    # The diffuse offshore field: everything that is not on a route.
    ([(-4.80, 36.30), (-1.50, 37.30), (1.60, 38.90), (4.30, 40.90)], 0.05, 0.290, (12.0, 3.0)),
]
# Fishing grounds: dense, slow, and NOT round -- each is a few overlapping
# lobes, because a perfect gaussian disc is the one thing in this picture that
# announces itself as generated.
HERO_GROUNDS = [(-3.65, 36.30, 0.15), (-1.35, 36.90, 0.13), (0.75, 38.35, 0.12),
                (2.95, 38.55, 0.14), (-4.85, 35.55, 0.11), (1.90, 40.35, 0.11),
                (4.90, 38.30, 0.12), (-2.20, 35.60, 0.10)]
# Ports and anchorages: tight, and almost stopped.
HERO_PORTS = [(-5.44, 36.13), (-4.42, 36.71), (-0.32, 39.45), (2.18, 41.37),
              (2.63, 39.55), (3.05, 36.77), (-0.63, 35.71), (-0.98, 37.60),
              (-2.94, 35.29), (-5.32, 35.89), (1.30, 38.99), (4.25, 39.90)]


def hero_frames(np, pd, sizes):
    """
    Synthetic western-Mediterranean vessel traffic: lanes, ferries, coastal
    routes, fishing grounds and anchorages, each with the speed it would run at.

    Returns {size: DataFrame}, each a prefix of the same shuffled field, so the
    tiers on the page are one picture at three densities rather than three
    different pictures.
    """
    rng = np.random.default_rng(2026)
    biggest = max(sizes)
    lon_parts, lat_parts, speed_parts = [], [], []

    def emit(lon, lat, speed):
        lon_parts.append(lon), lat_parts.append(lat), speed_parts.append(speed)

    for waypoints, share, spread, (mu, sigma) in HERO_LANES:
        k = int(biggest * share)
        pts = np.asarray(waypoints, dtype="float64")
        # Walk the polyline by arc length, so a long leg gets proportionally
        # more pings than a short one instead of one per segment.
        seg = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        t = rng.random(k) * cum[-1]
        i = np.clip(np.searchsorted(cum, t) - 1, 0, len(seg) - 1)
        f = ((t - cum[i]) / np.maximum(seg[i], 1e-12))[:, None]
        along = pts[i] + (pts[i + 1] - pts[i]) * f
        emit(along[:, 0] + rng.normal(0, spread, k),
             along[:, 1] + rng.normal(0, spread * 0.8, k),
             rng.normal(mu, sigma, k))

    per_ground = int(biggest * 0.16 / (len(HERO_GROUNDS) * 3))
    for glon, glat, s in HERO_GROUNDS:
        for lobe in range(3):                  # three offset lobes, not one disc
            dx, dy = rng.normal(0, s * 0.8, 2)
            wide, tall = s * rng.uniform(0.5, 1.1), s * rng.uniform(0.35, 0.8)
            emit(glon + dx + rng.normal(0, wide, per_ground),
                 glat + dy + rng.normal(0, tall, per_ground),
                 rng.normal(4.2, 1.3, per_ground))

    per_port = int(biggest * 0.12 / len(HERO_PORTS))
    for plon, plat in HERO_PORTS:
        emit(plon + rng.normal(0, 0.028, per_port),
             plat + rng.normal(0, 0.022, per_port),
             np.abs(rng.normal(0.4, 1.1, per_port)))

    lon = np.concatenate(lon_parts)
    lat = np.concatenate(lat_parts)
    speed = np.clip(np.concatenate(speed_parts), 0, 22)

    order = rng.permutation(len(lon))          # so any prefix is a fair sample
    lon, lat, speed = lon[order], lat[order], speed[order]
    if len(lon) < biggest:                     # rounding in the shares
        reps = -(-biggest // len(lon))
        lon, lat, speed = (np.tile(a, reps) for a in (lon, lat, speed))

    return {size: pd.DataFrame({"lat": lat[:size], "lon": lon[:size],
                                "speed_kn": np.round(speed[:size], 1)})
            for size in sizes}


# The stacks that get a link rather than an embed: these are applications, and
# an application is a different claim from a feature.
APPS = [
    dict(name="Shiny for Python", files="examples/shiny/",
         body="Four runnable apps, from a basic map to a live feed and a "
              "draw-an-AOI filter. Map state syncs both ways: pan the map and "
              "Python sees the viewport; filter in Python and the map follows.",
         href=f"{REPO}/tree/main/examples/shiny"),
    dict(name="React", files="examples/react/",
         body="The core wrapped as a component over the npm package. Leaflet, "
              "glify and Geoman stay peer dependencies, so your bundler owns "
              "them and nothing is loaded twice.",
         href=f"{REPO}/tree/main/examples/react"),
    dict(name="Streamlit", files="examples/streamlit/",
         body="A bidirectional component, its frontend bundled inside the wheel "
              "like the widget and the export -- clicks, draws and the viewport "
              "come back to Python on every rerun.",
         href=f"{REPO}/tree/main/examples/streamlit"),
    dict(name="Notebooks", files="examples/*.ipynb",
         body="Fourteen notebooks that are the long-form version of the gallery "
              "above, and the smoke test that runs on every change. Anywhere "
              "anywidget runs: JupyterLab, Notebook, VS Code.",
         href=f"{REPO}/tree/main/examples"),
]


# ===========================================================================
# machinery
# ===========================================================================

def highlight(code):
    """
    Python source as coloured HTML, tokenised by Python itself.

    A regex highlighter gets `radius_col="volume"` wrong sooner or later;
    `tokenize` cannot, because it is the same tokeniser that will run the code.
    Anything it cannot parse falls back to plain escaped text.
    """
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(code).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return html.escape(code)

    lines = code.splitlines(keepends=True)
    out, pos = [], (1, 0)

    def gap(to):
        """Everything between the last token and this one: whitespace, line
        continuations, the newlines tokenize reports as zero-width tokens."""
        row, col = pos
        while (row, col) < to and row <= len(lines):
            line = lines[row - 1]
            end = to[1] if row == to[0] else len(line)
            out.append(html.escape(line[col:end]))
            if row == to[0]:
                col = end
                break
            row, col = row + 1, 0
        return (row, col)

    for i, tok in enumerate(toks):
        pos = gap(tok.start)
        text = html.escape(tok.string)

        cls = None
        if tok.type == tokenize.COMMENT:
            cls = "t-com"
        elif tok.type == tokenize.STRING or tok.type == getattr(tokenize, "FSTRING_START", -1):
            cls = "t-str"
        elif tok.type == tokenize.NUMBER:
            cls = "t-num"
        elif tok.type == tokenize.NAME:
            nxt = next((t for t in toks[i + 1:] if t.type not in
                        (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)), None)
            if keyword.iskeyword(tok.string):
                cls = "t-kw"
            elif nxt and nxt.string == "(":
                cls = "t-fn"
            elif nxt and nxt.string == "=":
                cls = "t-kwa"        # a keyword argument, or a bare assignment

        out.append(f'<span class="{cls}">{text}</span>' if cls else text)
        pos = tok.end

    gap((len(lines) + 1, 0))
    return "".join(out).rstrip("\n")


def write_map(m, out_dir, strip_properties=False):
    """
    One map to disk as the page's host reads it: map.json plus its buffers.

    The state is composed by swiftmap.export.compose_state -- the same function
    the static export and the Streamlit component use -- so the site cannot
    disagree with them about what a map's state is. Only the transport differs:
    buffers go out as raw .bin, which the base64 in an export would inflate by
    a third.

    `strip_properties` drops the per-feature property dicts, which exist for
    popups and tooltips. At the hero's million points they are twenty megabytes
    of JSON for popups nobody is going to open; the colours were already
    computed in Python and ride in the buffers, so the map looks identical.
    """
    from swiftmap.export import compose_state

    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.bin"):
        stale.unlink()

    state = compose_state(m)
    state["height"] = None            # the card's CSS owns the height
    if strip_properties:
        for layer in state["layers"]:
            if layer.get("properties"):
                layer["properties"] = {}

    manifest = []
    for i, (key, raw) in enumerate(m.coordinate_buffers.items()):
        name = f"b{i}.bin"
        (out_dir / name).write_bytes(raw)
        manifest.append({"key": key, "file": name, "bytes": len(raw)})

    payload = json.dumps({"state": state, "buffers": manifest}, default=str)
    (out_dir / "map.json").write_text(payload, encoding="utf-8")
    return len(payload) + sum(b["bytes"] for b in manifest)


def run(code, ns):
    """Runs a card's snippet and hands back the map it built."""
    scope = dict(ns)
    exec(compile(code, "<demo>", "exec"), scope)
    if "m" not in scope:
        raise RuntimeError("a demo snippet must leave the map in `m`")
    return scope["m"]


def human(n):
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return f"{n:,.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


# ===========================================================================
# the page
# ===========================================================================

def card_html(card, size):
    api = f'<span class="api">{html.escape(card["api"])}</span>' if card.get("api") else ""
    return f'''
      <article class="card">
        <header>
          <h3>{html.escape(card["title"])} {api}</h3>
          <p>{card["blurb"]}</p>
        </header>
        <div class="map" data-demo="{card["slug"]}"></div>
        <div class="code">
          <button class="copy" type="button">copy</button>
          <pre><code>{highlight(card["code"])}</code></pre>
        </div>
        <footer>
          <a href="{REPO}/blob/main/examples/{card["nb"]}">examples/{card["nb"]}</a>
          <span>{human(size)} on the wire</span>
        </footer>
      </article>'''


def page_html(cards, tiers, hero_bytes, stamp, version):
    tier_buttons = "\n".join(
        f'''<button class="tier" type="button" data-tier="{t["slug"]}"
                    data-points="{t["points"]}"{' data-initial="1"' if t.get("initial") else ''}
                    aria-pressed="false">{t["points"]:,} pts<span class="wt">{html.escape(t["note"])}</span></button>'''
        for t in tiers)

    apps = "\n".join(f'''
        <div class="app">
          <h3><span class="dot"></span>{html.escape(a["name"])}</h3>
          <p>{a["body"]}</p>
          <div class="files">{html.escape(a["files"])}</div>
          <a class="go" href="{a["href"]}">open on GitHub &rarr;</a>
        </div>''' for a in APPS)

    gallery = "\n".join(card_html(c, s) for c, s in cards)

    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>swiftmap &mdash; Leaflet ergonomics, WebGL scale</title>
<meta name="description" content="A Python mapping library that keeps Leaflet's ergonomics and replaces its vector drawing with WebGL pipelines. Every map on this page is live.">
<link rel="canonical" href="{SITE}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="swiftmap">
<meta property="og:title" content="swiftmap &mdash; Leaflet ergonomics, WebGL scale">
<meta property="og:description" content="A Python mapping library that renders millions of points smoothly &mdash; in Jupyter, Shiny, Streamlit and React. Every map on this page is live.">
<meta property="og:url" content="{SITE}">
<meta property="og:image" content="{SITE}assets/og.png">
<meta property="og:image:width" content="2400">
<meta property="og:image:height" content="1260">
<meta property="og:image:alt" content="A swiftmap map drawing one million points, mid-drag.">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="swiftmap &mdash; Leaflet ergonomics, WebGL scale">
<meta name="twitter:description" content="A Python mapping library that renders millions of points smoothly &mdash; in Jupyter, Shiny, Streamlit and React. Every map on this page is live.">
<meta name="twitter:image" content="{SITE}assets/og.png">

<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<link rel="stylesheet" href="assets/swiftmap.css">
<link rel="stylesheet" href="assets/site.css">
</head>
<body>

<header class="topbar">
  <div class="wrap">
    <a class="brand" href="./">
      <img src="assets/favicon.svg" alt="" width="26" height="26">
      <span>swift<span>map</span></span>
    </a>
    <span class="pill">v{html.escape(version)}</span>
    <nav>
      <a href="#gallery">Gallery</a>
      <a href="#stacks">Stacks</a>
      <a href="#why">Why</a>
      <a href="{REPO}">GitHub</a>
    </nav>
  </div>
</header>

<main>

<div class="hero wrap">
  <h1>A million points, and it still <em>moves</em>.</h1>
  <p class="lede">
    swiftmap keeps Leaflet's ergonomics &mdash; <strong>a few <code>add_*</code> calls, no
    projection argument, no view to set</strong> &mdash; and replaces its vector drawing with
    WebGL pipelines. This is not a screenshot. Drag it.
  </p>

  <div class="stage" id="hero-stage">
    <div class="map"></div>
    <div class="veil"><span class="txt">starting up&hellip;</span><span class="bar"><i></i></span></div>
  </div>

  <div class="ladder">
    <span class="label">Load</span>
    {tier_buttons}
    <div class="readout">
      <div class="stat"><b id="hero-points">&mdash;</b><span>points drawn</span></div>
      <div class="stat"><b id="hero-ms">&mdash;</b><span>mount &rarr; first paint</span></div>
      <div class="stat"><b id="hero-fps">&mdash;</b><span>fps while dragging</span></div>
    </div>
  </div>

  <p class="hero-note">
    <span>Synthetic western-Mediterranean vessel traffic, coloured by speed. The tiers are the
    same field at three densities &mdash; {human(hero_bytes)} of float64 coordinates for the
    largest, fetched only when you ask for it. The frame counter reads while you drag, because
    an idle map runs at your display's refresh rate no matter what is on it.</span>
  </p>

  <div class="code" style="margin-top:22px;border:1px solid var(--line);border-radius:12px;">
    <button class="copy" type="button">copy</button>
    <pre><code>{highlight(HERO_CODE)}</code></pre>
  </div>
</div>

<section id="gallery">
  <div class="wrap">
    <div class="sec-head">
      <div class="kicker">The gallery</div>
      <h2>Every card below is a live map</h2>
      <p>
        Not a screenshot and not a video &mdash; a real map you can pan, toggle and scrub,
        built by running the code printed under it. The snippets are the strings this page's
        generator executed, so a card cannot drift from its example.
      </p>
    </div>

    <details class="data-panel">
      <summary><b>The data every card shares</b> &mdash; run once, before all of them</summary>
      <div class="code">
        <button class="copy" type="button">copy</button>
        <pre><code>{highlight(PREAMBLE)}</code></pre>
      </div>
    </details>

    <div class="gallery">
{gallery}
    </div>
  </div>
</section>

<section id="stacks">
  <div class="wrap">
    <div class="sec-head">
      <div class="kicker">The same core, four ways</div>
      <h2>Applications, not features</h2>
      <p>
        One rendering core serves notebooks, Shiny, React and Streamlit, with map state
        syncing both ways wherever there is a Python side to sync with. These are runnable
        apps rather than embeds, because &ldquo;what does a production app look like&rdquo; is a
        different question from &ldquo;what can it do&rdquo;.
      </p>
    </div>
    <div class="apps">
{apps}
    </div>
  </div>
</section>

<section id="why">
  <div class="wrap">
    <div class="sec-head">
      <div class="kicker">Why this exists</div>
      <h2>The gap the other libraries leave open</h2>
      <p>
        folium and ipyleaflet have the ergonomics but hit a ceiling in the tens of thousands
        of features and offer flat layer controls. deck.gl scales, but it is a different
        mental model with a thin Python layer. swiftmap keeps the Leaflet model and adds the
        scale.
      </p>
    </div>

    <div class="table-scroll">
      <table class="compare">
        <thead>
          <tr>
            <th></th><th>folium / ipyleaflet</th><th>deck.gl (pydeck)</th><th class="me-col">swiftmap</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Points before it stops being usable</td><td>tens of thousands</td><td>millions</td>
              <td class="me-col me">millions &mdash; drag the map above</td></tr>
          <tr><td>Mental model</td><td>Leaflet</td><td>its own layer/view stack</td>
              <td class="me-col me">Leaflet</td></tr>
          <tr><td>Layer control</td><td>flat list</td><td>build it yourself</td>
              <td class="me-col me">hierarchy from your columns</td></tr>
          <tr><td>Coordinates on the wire</td><td>JSON per feature</td><td>typed arrays</td>
              <td class="me-col me">binary float64 buffers</td></tr>
          <tr><td>Cost of a layer toggle</td><td>re-render</td><td>re-render</td>
              <td class="me-col me">a ~100-byte patch, at any scale</td></tr>
          <tr><td>Python &harr; map sync</td><td>one way</td><td>one way</td>
              <td class="me-col me">bidirectional (viewport, clicks, draws, time)</td></tr>
          <tr><td>Time playback</td><td>plugin, DOM-based</td><td>manual</td>
              <td class="me-col me">built in, filtered on the GPU</td></tr>
          <tr><td>Offline / air-gapped</td><td>CDN at view time</td><td>CDN at view time</td>
              <td class="me-col me">everything inside the wheel</td></tr>
          <tr><td>Static share</td><td>one HTML file</td><td>one HTML file</td>
              <td class="me-col me">one HTML file, sidebar and time included</td></tr>
          <tr><td>3D &mdash; extrusions, terrain</td><td>no</td><td>yes</td>
              <td class="me-col">not yet</td></tr>
        </tbody>
      </table>
    </div>


    <div class="sec-head" style="margin-top:56px">
      <h2>Where it misses, honestly</h2>
      <p>
        A comparison table that wins every row is a pitch, not an analysis. These are the
        places another library is the better answer today. They are known, they are on the
        list, and this section shrinks as they land &mdash; it has already lost density,
        raster imagery, WMS and offline since it was first written.
      </p>
    </div>

    <div class="gaps">
      <div class="gap">
        <h3>3D</h3>
        <p>No extrusions, no terrain, no camera pitch. deck.gl owns this, and a
        Leaflet-shaped library will always be a step behind it here.</p>
      </div>
      <div class="gap">
        <h3>Vector tiles</h3>
        <p>XYZ raster and WMS are covered; MVT is not, so a basemap or dataset served as
        vector tiles has to come in another way.</p>
      </div>
      <div class="gap">
        <h3>Marker clustering</h3>
        <p>Density answers &ldquo;where is it thick&rdquo;; it does not answer
        &ldquo;collapse these into countable groups&rdquo;. <code>hexbin</code> is the
        nearest thing today.</p>
      </div>
      <div class="gap">
        <h3>Earth-observation catalogues</h3>
        <p><code>add_imagery</code> warps a raster you already have. STAC, COG and Earth
        Engine integration is leafmap's territory, not this library's.</p>
      </div>
      <div class="gap">
        <h3>Line direction</h3>
        <p>Tracks animate and carry per-segment time, but there are no arrowheads or dash
        patterns yet, so a paused track does not show which way it was going.</p>
      </div>
      <div class="gap">
        <h3>First paint at the top end</h3>
        <p>Millions of points drag smoothly once they are there. Getting them there still
        costs more than it should on the very largest maps.</p>
      </div>
    </div>

    <div class="sec-head" style="margin-top:56px">
      <h2>Install it</h2>
    </div>
    <div class="code" style="border:1px solid var(--line);border-radius:12px;max-width:520px">
      <button class="copy" type="button">copy</button>
      <pre><code>pip install swiftmap</code></pre>
    </div>

    <!-- Two rows, deliberately unalike. Run together as one sentence, the
         optional half reads as part of the required list at a glance. -->
    <dl class="deps">
      <div class="dep-row">
        <dt>Pulls in</dt>
        <dd><code>anywidget</code> <code>numpy</code> <code>xyzservices</code>
            <span class="aside">and nothing else &mdash; no compiled bits, no Node</span></dd>
      </div>
      <div class="dep-row">
        <dt>Never installs</dt>
        <dd class="muted">pandas, polars, geopandas, geostructures &mdash; every one is
            supported as a data source, and swiftmap reads whichever you already
            have. None is a dependency.</dd>
      </div>
    </dl>
  </div>
</section>

</main>

<footer class="site">
  <div class="wrap">
    <span><a href="{REPO}">github.com/Rkleisley/swiftmap</a></span>
    <span><a href="{REPO}/blob/main/README.md">Documentation</a></span>
    <span><a href="https://pypi.org/project/swiftmap/">PyPI</a></span>
    <span class="built">generated {stamp} &middot; scripts/build_demos.py</span>
  </div>
</footer>

<script type="module" src="assets/gallery.js"></script>
</body>
</html>
'''


# ===========================================================================
# build
# ===========================================================================

def make_dem(path, np):
    """The imagery card's raster: two gaussian ridges, a nodata notch, UTM 30N."""
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.warp import transform_bounds

    W, H = 400, 300
    west, south, east, north = -5.75, 35.85, -5.15, 36.25
    ys, xs = np.mgrid[0:H, 0:W]
    field = (900 * np.exp(-(((xs - 120) / 60) ** 2 + ((ys - 90) / 40) ** 2))
             + 1400 * np.exp(-(((xs - 300) / 50) ** 2 + ((ys - 210) / 55) ** 2))
             + 2.0 * ys).astype("float32")
    field[:60, :80] = -9999.0
    bounds = transform_bounds("EPSG:4326", "EPSG:32630", west, south, east, north)
    with rasterio.open(path, "w", driver="GTiff", width=W, height=H, count=1,
                       dtype="float32", crs="EPSG:32630", nodata=-9999.0,
                       transform=from_bounds(*bounds, W, H)) as dst:
        dst.write(field, 1)


def version():
    try:
        import swiftmap
        return getattr(swiftmap, "__version__", None) or _version_from_toml()
    except Exception:
        return _version_from_toml()


def _version_from_toml():
    for line in (ROOT / "pyproject.toml").read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("version"):
            return line.split("=", 1)[1].strip().strip('"\'')
    return "0.0.0"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--out", default=str(ROOT / "docs"), help="output directory (default: docs/)")
    ap.add_argument("--skip-hero-large", action="store_true",
                    help="build only the smallest hero tier -- fast local iteration")
    ap.add_argument("--only", default=None,
                    help="comma-separated card slugs, for iterating on one card")
    args = ap.parse_args()

    out = Path(args.out)

    # A partial build still rewrites index.html -- with only the tiers and cards
    # it was asked for. The result looks finished, so committing it silently
    # publishes a page missing its hero ladder or half its gallery. That has
    # already happened once (5bcd0f0 shipped a one-rung hero from a
    # --skip-hero-large run), which is why this is a refusal and not a warning:
    # the flags are for iterating somewhere else, and docs/ is the published
    # artifact.
    if (args.skip_hero_large or args.only) and out.resolve() == (ROOT / "docs").resolve():
        sys.exit(
            "refusing to write a partial build into docs/.\n"
            "  --skip-hero-large and --only produce a page missing tiers or cards.\n"
            "  Iterate elsewhere, then run the full build for docs/:\n"
            "      python scripts/build_demos.py --skip-hero-large --out build/demos\n"
            "      python scripts/build_demos.py"
        )
    (out / "assets").mkdir(parents=True, exist_ok=True)
    (out / "data").mkdir(parents=True, exist_ok=True)

    bundle = ROOT / "swiftmap" / "static" / "widget.js"
    if not bundle.exists():
        sys.exit(f"missing {bundle} -- run `npm install && npm run build` first")

    import numpy as np
    import pandas as pd

    print("building the shared data...")
    ns = {}
    exec(compile(PREAMBLE, "<preamble>", "exec"), ns)

    # The imagery card reads a real file. It is a build input, not something
    # the site serves, so it lives outside the output tree.
    scratch = Path(tempfile.mkdtemp(prefix="swiftmap-demos-"))
    dem_ok = True
    try:
        make_dem(scratch / "demo_dem.tif", np)
    except Exception as exc:                                  # rasterio is optional
        dem_ok = False
        print(f"  ! skipping the imagery card: {exc}")

    # ---- the hero -----------------------------------------------------
    tiers = HERO_TIERS[:1] if args.skip_hero_large else HERO_TIERS
    sizes = [t["points"] for t in tiers]
    print(f"building the hero: {', '.join(f'{s:,}' for s in sizes)} points...")
    frames = hero_frames(np, pd, sizes)
    hero_bytes = 0
    for tier in tiers:
        m = run(HERO_CODE, {**ns, "traffic": frames[tier["points"]]})
        size = write_map(m, out / "data" / tier["slug"], strip_properties=True)
        hero_bytes = max(hero_bytes, size)
        print(f"  {tier['slug']:<12} {human(size):>10}")

    # ---- the cards ----------------------------------------------------
    wanted = set(args.only.split(",")) if args.only else None
    built = []
    for card in CARDS:
        if wanted and card["slug"] not in wanted:
            continue
        if card.get("needs") == "rasterio" and not dem_ok:
            continue
        code = card["code"]
        cwd = Path.cwd()
        try:
            # The imagery snippet names a file relative to the notebook's cwd;
            # run every card from the scratch directory so it finds it.
            import os
            os.chdir(scratch)
            m = run(code, ns)
        finally:
            os.chdir(cwd)
        size = write_map(m, out / "data" / card["slug"])
        built.append((card, size))
        print(f"  {card['slug']:<18} {human(size):>10}")

    # ---- assets and the page ------------------------------------------
    shutil.copyfile(bundle, out / "assets" / "swiftmap.js")
    shutil.copyfile(ROOT / "swiftmap" / "static" / "widget.css", out / "assets" / "swiftmap.css")
    shutil.copyfile(ASSETS / "site.css", out / "assets" / "site.css")
    shutil.copyfile(ASSETS / "gallery.js", out / "assets" / "gallery.js")
    (out / ".nojekyll").write_text("", encoding="utf-8")     # serve _-prefixed paths as-is

    stamp = date.today().isoformat()
    (out / "index.html").write_text(
        page_html(built, tiers, hero_bytes, stamp, version()), encoding="utf-8")

    shutil.rmtree(scratch, ignore_errors=True)

    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"\ndocs/ written: {len(built)} cards, {len(tiers)} hero tiers, {human(total)} total")
    print(f"  preview: python -m http.server -d {out} 8000")


if __name__ == "__main__":
    main()
