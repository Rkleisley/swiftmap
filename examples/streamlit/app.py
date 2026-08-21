"""
The minimal swiftmap + Streamlit app, and the one rule that matters.

THE RULE: Streamlit reruns this whole script on every interaction. Build the map
once -- here in st.session_state, because the filter below mutates it per session
(a read-only map every session shares belongs under @st.cache_resource) -- and let
st_swiftmap's fingerprint decide whether the frontend has anything to do. A click
reruns the script and rebuilds nothing; only a change to the map re-sends it.

Run from this directory:

    streamlit run app.py
"""
import numpy as np
import pandas as pd
import streamlit as st

from swiftmap import Map
from swiftmap.streamlit import st_swiftmap

rng = np.random.default_rng(7)
n = 200
df = pd.DataFrame({
    "lat": 36.02 + rng.normal(0, 0.06, n),
    "lon": -5.45 + rng.normal(0, 0.10, n),
    "site": [f"Sensor {i:03d}" for i in range(n)],
    "reading": np.round(rng.gamma(4, 4, n), 1),
    "status": rng.choice(["Active", "Idle", "Fault"], n, p=[0.6, 0.3, 0.1]),
})


def build():
    # Built once per session. The status folders exist up front, so the filter
    # below only ever toggles visibility -- no layer churn.
    m = Map(height="560px")
    m.add_circle_markers(df, name="Sensors",
                         layer_group=["Sensors", "status"],
                         color_col="reading")
    m.configure_group("Sensors", collapsed=False)
    return m


# The session_state entry and the component's key= must differ: Streamlit binds
# a widget's value to session_state[key], and a Map is not a widget value.
if "sensor_map" not in st.session_state:
    st.session_state["sensor_map"] = build()
    st.session_state["status"] = "All"
m = st.session_state["sensor_map"]

st.subheader("swiftmap basic app")
wanted = st.sidebar.selectbox("Status", ["All", "Active", "Idle", "Fault"])

# Only a CHANGE touches the map: a rerun that re-applied the same selection would
# move the fingerprint and re-send the state for nothing. select() is declarative
# -- each call states the complete selection for its scope.
if wanted != st.session_state["status"]:
    st.session_state["status"] = wanted
    if wanted == "All":
        m.select(None, scope="Sensors")
    else:
        m.select(group=f"Sensors/{wanted}", scope="Sensors")

events = st_swiftmap(m, key="map")

if events["clicked_layer_id"]:
    st.write(f"Clicked **{events['clicked_layer_id']}** feature #{events['selected_index']} "
             f"at {events['clicked_latlng']}")
st.caption(f"center {events['center']} · zoom {events['zoom']} · "
           f"{len(events['drawings'])} drawing(s)")
