import streamlit as st
import folium
from streamlit_folium import st_folium
import pandas as pd
import numpy as np

st.set_page_config(layout="wide")
st.title("swiftmap - Streamlit Benchmarks")
st.info("Baseline: Standard Folium. Note the manual loop for markers and full-page refresh on update.")

tabs = st.tabs(["Simple Map", "Markers", "GeoJSON", "Heatmap"])

# Sample Data for Markers
np.random.seed(42)
df = pd.DataFrame({
    "lat": np.random.uniform(30, 45, 50),
    "lon": np.random.uniform(-120, -75, 50),
    "name": [f"Point {i}" for i in range(50)]
})

with tabs[0]:
    st.header("Simple Map (Standard Folium)")
    m = folium.Map(location=[39.8283, -98.5795], zoom_start=4)
    st_folium(m, width=1200, height=600, key="simple_map")

with tabs[1]:
    st.header("Markers (Standard Folium)")
    st.write("Code required: Manual loop over DataFrame + individual Marker objects.")
    
    m = folium.Map(location=[39.8283, -98.5795], zoom_start=4)
    
    # Standard Folium approach: Manual iteration
    for _, row in df.iterrows():
        folium.Marker(
            location=[row["lat"], row["lon"]],
            popup=row["name"],
            tooltip=row["name"]
        ).add_to(m)
    
    st_folium(m, width=1200, height=600, key="markers_map")

with tabs[2]:
    st.header("GeoJSON")
    st.write("Placeholder for standard Folium GeoJSON example.")

with tabs[3]:
    st.header("Heatmap")
    st.write("Placeholder for standard Folium Heatmap example.")
