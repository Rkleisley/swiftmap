"""
add_heatmap: the exploratory density view, and the one sanctioned aggregation.

The contract under test: heat configs carry everything the renderer needs (the
resolved ramp, radius, pinned max), weights ride as a float32 buffer, and the
layer-reference path derives from an existing point layer's buffer without
re-uploading a byte.
"""
import numpy as np
import pandas as pd
import pytest

from swiftmap import Map
from swiftmap._colormaps import COLORMAPS
from swiftmap._warnings import EmptyLayerWarning

DF = pd.DataFrame({
    "lat": [36.01, 36.05, 36.09],
    "lon": [-5.31, -5.25, -5.19],
    "reading": [4.0, 9.5, 2.25],
})


def heat_layers(m):
    return [l for l in m.layers if l.type == "heatmap"]


def test_data_path_config_and_buffer():
    m = Map()
    m.add_heatmap(DF, name="Density", radius=30, colormap="turbo")
    (layer,) = heat_layers(m)
    assert layer.name == "Density"
    assert layer.radius == 30
    assert layer.ramp == COLORMAPS["turbo"]
    assert layer.legend["kind"] == "ramp"
    assert layer.legend["vmin"] == "low" and layer.legend["vmax"] == "high"
    coords = np.frombuffer(m.coordinate_buffers[layer.id], dtype=np.float64)
    assert coords.tolist()[:2] == [36.01, -5.31]


def test_weight_col_rides_as_float32():
    m = Map()
    m.add_heatmap(DF, weight_col="reading")
    (layer,) = heat_layers(m)
    weights = np.frombuffer(m.coordinate_buffers[f"{layer.id}::weights"],
                            dtype=np.float32)
    assert weights.tolist() == [4.0, 9.5, 2.25]
    assert layer.legend["field"] == "reading"


def test_layer_reference_shares_the_source_buffer():
    m = Map()
    m.add_circle_markers(DF, name="Sites")
    source = m.layers[-1]
    m.add_heatmap("Sites", weight_col="reading")
    (layer,) = heat_layers(m)
    assert layer.source == source.id
    assert layer.id not in m.coordinate_buffers          # no re-upload
    weights = np.frombuffer(m.coordinate_buffers[f"{layer.id}::weights"],
                            dtype=np.float32)
    assert weights.tolist() == [4.0, 9.5, 2.25]


def test_reference_to_a_non_point_layer_warns_and_adds_nothing():
    m = Map()
    m.add_polygon([[36.0, -5.3], [36.1, -5.3], [36.1, -5.2]], name="Zone")
    with pytest.warns(Warning, match="derives from point layers"):
        m.add_heatmap("Zone")
    assert heat_layers(m) == []


def test_missing_weight_column_warns_and_weighs_one():
    m = Map()
    with pytest.warns(Warning, match="has no 'volume' column"):
        m.add_heatmap(DF, weight_col="volume")
    (layer,) = heat_layers(m)
    assert f"{layer.id}::weights" not in m.coordinate_buffers


def test_categorical_colormap_is_refused_for_a_ramp():
    m = Map()
    with pytest.warns(Warning, match="categorical"):
        m.add_heatmap(DF, colormap={"high": "#ff0000", "low": "#00ff00"})
    (layer,) = heat_layers(m)
    assert layer.ramp == COLORMAPS["viridis"]


def test_nonsense_radius_warns_and_defaults():
    m = Map()
    with pytest.warns(Warning, match="positive number of pixels"):
        m.add_heatmap(DF, radius=-3)
    assert heat_layers(m)[0].radius == 25


def test_max_intensity_is_recorded():
    m = Map()
    m.add_heatmap(DF, max_intensity=12)
    assert heat_layers(m)[0].max_intensity == 12


def test_empty_and_unreadable_data_warn_and_add_nothing():
    m = Map()
    with pytest.warns(EmptyLayerWarning):
        m.add_heatmap(pd.DataFrame({"lat": [], "lon": []}))
    with pytest.warns(Warning, match="could not read"):
        m.add_heatmap(object())
    assert heat_layers(m) == []


def test_a_string_matching_no_layer_is_treated_as_data():
    # An H3 cell string is point-less geometry, so heat honestly finds nothing --
    # but the failure mode is the data path's, not a targeting error.
    m = Map()
    with pytest.warns(Warning):
        m.add_heatmap("8928308280fffff")
    assert heat_layers(m) == []


def test_heat_survives_a_source_update():
    m = Map()
    m.add_circle_markers(DF, name="Sites")
    m.add_heatmap("Sites")
    m.update_layer("Sites", data=pd.DataFrame(
        {"lat": [36.2, 36.3], "lon": [-5.1, -5.0], "reading": [1.0, 2.0]}))
    (layer,) = heat_layers(m)
    source = m.get_layer("Sites")
    assert layer.source == source.id
    assert len(m.coordinate_buffers[source.id]) == 2 * 16


def test_export_carries_the_heat_layer():
    m = Map()
    m.add_heatmap(DF, name="Density")
    html = m.to_html()
    assert '"heatmap"' in html and "Density" in html
