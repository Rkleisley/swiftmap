"""
Composes the Streamlit component's args for one demo map and prints them as JSON.

Tier 3's Streamlit suite runs this and hands the output to the shipped frontend
through a stub of Streamlit's parent-side protocol, so the real Python composition
(swiftmap.streamlit.compose_args: the export's state, base64 buffers, the
fingerprint) meets the real built component. If the two ever drift, it surfaces
there, not in someone's app.

Three sites with a data-driven colour and a timed track: a coordinate buffer, a
colour buffer and a time buffer all ride base64. Bravo sits at the map's centre,
so a click at the frame's middle hits it.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swiftmap import Map  # noqa: E402
from swiftmap.streamlit import compose_args  # noqa: E402

m = Map(center=[36.05, -5.25], zoom=12, height="600px", show_logo=False, show_legend=True)
m.add_circle_markers(
    {"lat": [36.02, 36.05, 36.08], "lon": [-5.28, -5.25, -5.22],
     "name": ["Alpha", "Bravo", "Charlie"], "value": [10.0, 55.0, 90.0]},
    name="Sites", color_col="value", radius=10)
m.add_line(
    [[36.00, -5.30], [36.05, -5.25], [36.10, -5.20]], name="Track", color="#0055ff", weight=6,
    properties={"vessel": "Swift One"})
m.configure_legend(title="Key")

sys.stdout.write(json.dumps(compose_args(m), default=str))
