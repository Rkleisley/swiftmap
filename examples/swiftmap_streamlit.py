import streamlit as st
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

st.set_page_config(layout="wide")
st.title("swiftmap - Streamlit Validation")
st.success("This app uses the 'swiftmap' library. No manual loops or complex embedding code required!")

# Sample Data
np.random.seed(42)
df = pd.DataFrame({
    "lat": np.random.uniform(30, 45, 50),
    "lon": np.random.uniform(-120, -75, 50),
    "name": [f"Point {i}" for i in range(50)]
})

tabs = st.tabs(["Simple Map", "Circle Markers"])

with tabs[0]:
    st.header("Simple Map")
    m = Map().add_basemap("CartoDB.Positron")
    m.to_streamlit()

with tabs[1]:
    st.header("Circle Markers")
    st.write("Using `m.add_circle_markers(df)` - One line, no loops!")
    
    m = Map().add_basemap("CartoDB.Positron")
    m.add_circle_markers(df, color="red", fill_color="orange", radius=7)
    m.add_layer_control()
    
    m.to_streamlit()
