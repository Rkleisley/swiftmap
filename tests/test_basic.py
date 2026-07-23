import pytest
from swiftmap import Map
import pandas as pd
import numpy as np

def test_map_initialization():
    m = Map(center=[34.05, -118.24], zoom=10)
    assert m.center == [34.05, -118.24]
    assert m.zoom == 10
    assert m.show_logo is True
    assert m.show_legend is False

def test_chaining():
    m = Map()
    returned_m = m.add_basemap("OpenStreetMap")
    assert returned_m is m

def test_add_markers_df():
    df = pd.DataFrame({"lat": [10.0, 20.0], "lon": [30.0, 40.0], "name": ["A", "B"]})
    m = Map()
    m.add_markers(df, name="My Markers")
    assert len(m.layers) > 2
    layer = m.layers[-1]
    assert layer.name == "My Markers"
    assert layer.type == "markers"
    assert layer.visible is True
    assert layer.id in m.coordinate_buffers
    buffer_bytes = m.coordinate_buffers[layer.id]
    coords = np.frombuffer(buffer_bytes, dtype=np.float64)
    assert len(coords) == 4
    assert coords[0] == 10.0
    assert coords[1] == 30.0

def test_add_circle_markers():
    df = pd.DataFrame({"lat": [10.0, 20.0], "lon": [30.0, 40.0]})
    m = Map()
    m.add_circle_markers(df, radius=7, color="red", name="My Circles")
    layer = m.layers[-1]
    assert layer.name == "My Circles"
    assert layer.type == "circle_markers"
    assert layer.radius == 7
    assert layer.color == "red"

def test_add_geojson():
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [30.0, 10.0]},
                "properties": {"prop0": "value0"}
            }
        ]
    }
    m = Map()
    m.add_geojson(data, name="test_geojson")
    layer = m.layers[-1]
    assert layer.name == "test_geojson"
    assert layer.type == "geojson"
    assert layer.geojson == data

def test_add_polyline_and_polygon():
    m = Map()
    m.add_polyline([[10, 20], [30, 40]], name="My Polyline")
    layer1 = m.layers[-1]
    assert layer1.name == "My Polyline"
    assert layer1.type == "polyline"
    assert layer1.locations == [[10, 20], [30, 40]]

    m.add_polygon([[10, 20], [30, 40], [50, 60]], name="My Polygon")
    layer2 = m.layers[-1]
    assert layer2.name == "My Polygon"
    assert layer2.type == "polygon"
    assert layer2.locations == [[10, 20], [30, 40], [50, 60]]

def test_legend_and_geostructures():
    from geostructures import GeoPoint, Coordinate
    m = Map(show_legend=True)
    point = GeoPoint(Coordinate(-118.24, 34.05), properties={'name': 'LA', 'pop': '4M'})
    m.add_geostructures([point], name="LA Point", layer_group="City Points")
    assert any(l.name == "LA Point" for l in m.layers)
    assert m.legend_html != ""

def test_remove_layer():
    m = Map()
    m.add_polyline([[10, 20], [30, 40]], name="Temp Layer")
    assert any(l.name == "Temp Layer" for l in m.layers)
    m.remove_layer("Temp Layer")
    assert not any(l.name == "Temp Layer" for l in m.layers)


def test_group_configs_and_multi_select():
    m = Map()
    m.add_polyline([[10, 20], [30, 40]], name="Poly 1", layer_group="Tracks", group_multi_select=True)
    m.add_polyline([[10, 20], [30, 40]], name="Poly 2", layer_group="Tracks", group_multi_select=False)
    
    # Check that layer configurations do not contain the group-level configs
    layers = m.layers
    poly1 = next(l for l in layers if l.name == "Poly 1")
    poly2 = next(l for l in layers if l.name == "Poly 2")
    assert "group_multi_select" not in poly1
    assert "group_multi_select" not in poly2
    
    # Check that the explicit False setting on Poly 2 correctly overrode the group selection
    assert m.group_configs["Tracks"]["multi_select"] is False
    m.configure_group("Tracks", multi_select=False)
    assert m.group_configs["Tracks"]["multi_select"] is False
    
    m.configure_group("Tracks", group_multi_select=True)
    assert m.group_configs["Tracks"]["multi_select"] is True

def test_add_circle():
    m = Map()
    m.add_circle(location=[36.0, -5.35], radius=500, name="Gibraltar Circle")
    assert any(l.name == "Gibraltar Circle" for l in m.layers)
    circle_layer = m.layers[-1]
    assert circle_layer.type == "circle"
    assert circle_layer.location == [36.0, -5.35]
    assert circle_layer.radius == 500

def test_markers_bounds():
    m = Map()
    # Test markers
    m.add_markers(
        data=[[10.0, 20.0], [30.0, 40.0]],
        name="Test Markers"
    )
    layer = m.layers[-1]
    assert layer.bounds == [[10.0, 20.0], [30.0, 40.0]]

    # Test circle markers
    m.add_circle_markers(
        data=[[5.0, 15.0], [25.0, 35.0]],
        name="Test Circle Markers"
    )
    layer2 = m.layers[-1]
    assert layer2.bounds == [[5.0, 15.0], [25.0, 35.0]]

    # Test empty markers
    m.add_markers(
        data=[],
        name="Empty Markers"
    )
    layer3 = m.layers[-1]
    assert layer3.bounds is None

def test_map_crs():
    m = Map()
    assert m.crs == "EPSG:3857"
    
    m2 = Map(crs="EPSG:4326")
    assert m2.crs == "EPSG:4326"

