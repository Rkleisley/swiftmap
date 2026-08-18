"""Builds a small demo map and writes a static HTML export.

Tier 3 runs this to prove an export renders with no backend; it also makes a handy
eyeball file: python scripts/export_demo.py out.html
"""
import sys

import swiftmap

# No center or zoom: the data is nowhere near the fallback view, so the export only
# opens on it if auto-fit carried the bounds union into the file -- which is what
# tier 3 asserts.
m = swiftmap.Map(show_logo=False)

# color_col/radius_col need a column, so use a frame-shaped input.
m.add_circle_markers(
    {"lat": [40.00, 40.04, 40.06, 40.10],
     "lon": [-3.75, -3.69, -3.67, -3.65],
     "value": [1.0, 4.0, 7.0, 10.0]},
    name="Sites", color_col="value", radius_col="value")
m.add_polygon(
    [[40.00, -3.75], [40.00, -3.65], [40.10, -3.65]],
    name="Zone", color="#ff0000", fill_color="#00ff00", weight=5)

m.configure_legend(show=True, title="Demo Key")
m.legend_add("Patrol boundary", shape="line", color="#ff0000", group="Zone Group")

m.save(sys.argv[1] if len(sys.argv) > 1 else "swiftmap-demo.html")
