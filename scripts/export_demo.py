"""Builds a small demo map and writes a static HTML export.

Tier 3 runs this to prove an export renders with no backend; it also makes a handy
eyeball file: python scripts/export_demo.py out.html
"""
import sys

import swiftmap

m = swiftmap.Map(center=[36.05, -5.25], zoom=12, show_logo=False)

# color_col/radius_col need a column, so use a frame-shaped input.
m.add_circle_markers(
    {"lat": [36.00, 36.04, 36.06, 36.10],
     "lon": [-5.30, -5.24, -5.22, -5.20],
     "value": [1.0, 4.0, 7.0, 10.0]},
    name="Sites", color_col="value", radius_col="value")
m.add_polygon(
    [[36.00, -5.30], [36.00, -5.20], [36.10, -5.20]],
    name="Zone", color="#ff0000", fill_color="#00ff00", weight=5)

m.save(sys.argv[1] if len(sys.argv) > 1 else "swiftmap-demo.html")
