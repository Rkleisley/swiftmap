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


def test_auto_normalize_defaults_on_and_records_off():
    m = Map()
    m.add_heatmap(DF, name="A")
    m.add_heatmap(DF, name="B", auto_normalize=False)
    m.add_heatmap(DF, name="C", cells="h3", auto_normalize=False)
    flags = [l.auto_normalize for l in heat_layers(m)]
    assert flags == [True, False, False]


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
    # An H3 cell string matches no layer, so it is DATA -- and since the point
    # builders learned to read a cell as its center, the data path now heats
    # that one point instead of warning that a cell is point-less geometry.
    m = Map()
    m.add_heatmap("8928308280fffff")
    assert len(heat_layers(m)) == 1


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


def test_data_path_heat_keeps_its_columns():
    m = Map()
    m.add_heatmap(DF, name="Density")
    (layer,) = heat_layers(m)
    assert layer.properties["reading"] == [4.0, 9.5, 2.25]


def test_source_path_heat_carries_no_columns_of_its_own():
    m = Map()
    m.add_circle_markers(DF, name="Sites")
    m.add_heatmap("Sites")
    (layer,) = heat_layers(m)
    assert getattr(layer, "properties", None) is None


def test_make_time_layer_animates_data_path_heat():
    df = DF.assign(timestamp=pd.to_datetime(
        ["2026-01-01T00:00", "2026-01-01T01:00", "2026-01-01T02:00"]))
    m = Map()
    m.add_heatmap(df, name="Density")
    m.make_time_layer("Density", period="PT1H", duration="PT2H", fade=True)
    (layer,) = heat_layers(m)
    assert layer.time == {"field": "timestamp", "duration": "PT2H", "fade": True}
    times = np.frombuffer(m.coordinate_buffers[f"{layer.id}::times"],
                          dtype=np.float64)
    assert len(times) == 6                      # three [start, end] pairs


h3 = pytest.importorskip("h3")


def expected_bins(df, resolution, weights=None):
    sums = {}
    for i, (lat, lon) in enumerate(zip(df["lat"], df["lon"])):
        cell = h3.latlng_to_cell(lat, lon, resolution)
        sums[cell] = sums.get(cell, 0.0) + (weights[i] if weights else 1.0)
    return sums


def test_hex_mode_bins_and_ships_rings_plus_values():
    m = Map()
    m.add_heatmap(DF, cells="h3", resolution=7, name="HexHeat")
    (layer,) = heat_layers(m)
    assert layer.cells == "h3"
    assert layer.resolution == 7
    assert layer.opacity == 0.75
    sums = expected_bins(DF, 7)
    assert layer.properties["h3"] == list(sums.keys())
    assert sum(layer.cell_counts) * 2 == len(
        np.frombuffer(m.coordinate_buffers[layer.id], dtype=np.float64))
    values = np.frombuffer(m.coordinate_buffers[f"{layer.id}::values"],
                           dtype=np.float64)
    assert values.tolist() == list(sums.values())


def test_hex_mode_sums_weights_per_cell():
    df = pd.DataFrame({"lat": [36.01, 36.0101], "lon": [-5.31, -5.3101],
                       "reading": [4.0, 2.5]})
    m = Map()
    m.add_heatmap(df, cells="h3", resolution=5, weight_col="reading")
    (layer,) = heat_layers(m)
    values = np.frombuffer(m.coordinate_buffers[f"{layer.id}::values"],
                           dtype=np.float64)
    assert len(values) == 1 and values[0] == 6.5      # one coarse cell, summed


def test_hex_mode_bins_a_source_layer_snapshot():
    m = Map()
    m.add_circle_markers(DF, name="Sites")
    m.add_heatmap("Sites", cells="h3", resolution=7, weight_col="reading")
    (layer,) = heat_layers(m)
    assert getattr(layer, "source", None) is None      # a snapshot, not a reference
    sums = expected_bins(DF, 7, weights=[4.0, 9.5, 2.25])
    values = np.frombuffer(m.coordinate_buffers[f"{layer.id}::values"],
                           dtype=np.float64)
    assert values.tolist() == list(sums.values())


def test_hex_mode_pins_with_vmin_vmax():
    m = Map()
    m.add_heatmap(DF, cells="h3", vmin=0, vmax=100)
    (layer,) = heat_layers(m)
    assert layer.vmin == 0 and layer.vmax == 100


def test_kernel_knobs_warn_across_modes():
    m = Map()
    with pytest.warns(Warning, match="radius sizes the blob kernel"):
        m.add_heatmap(DF, cells="h3", radius=30)
    with pytest.warns(Warning, match="resolution applies to cells='h3'"):
        m.add_heatmap(DF, resolution=7)
    with pytest.warns(Warning, match="max_intensity pins the blob scale"):
        m.add_heatmap(DF, cells="h3", max_intensity=5)


def test_hex_mode_without_the_lib_warns_and_adds_nothing(monkeypatch):
    import swiftmap.parsers.sources._utils as _utils
    monkeypatch.setattr(_utils, "_h3_module", None)
    m = Map()
    with pytest.warns(Warning, match="pip install h3"):
        m.add_heatmap(DF, cells="h3")
    assert heat_layers(m) == []


def test_export_carries_the_heat_layer():
    m = Map()
    m.add_heatmap(DF, name="Density")
    html = m.to_html()
    assert '"heatmap"' in html and "Density" in html


# --- the geohash cell kernel -------------------------------------------------

def test_geohash_cells_bin_and_ship_rectangles():
    import swiftmap._niemeyer as nm
    m = Map()
    m.add_heatmap(DF, cells="geohash", length=5, base=32, name="GhHeat")
    (layer,) = heat_layers(m)
    assert layer.cells == "geohash"
    assert layer.length == 5 and layer.base == 32
    assert all(c == 4 for c in layer.cell_counts)      # rectangles, unclosed
    expected = {}
    for lat, lon in zip(DF["lat"], DF["lon"]):
        cell = nm.encode(lat, lon, 5, 32)
        expected[cell] = expected.get(cell, 0) + 1
    assert layer.properties["geohash"] == list(expected.keys())
    values = np.frombuffer(m.coordinate_buffers[f"{layer.id}::values"],
                           dtype=np.float64)
    assert values.tolist() == list(expected.values())


def test_geohash_cells_require_the_base():
    m = Map()
    with pytest.warns(Warning, match="cannot state its own base"):
        m.add_heatmap(DF, cells="geohash")
    assert heat_layers(m) == []


def test_cell_kernel_knobs_warn_across_families():
    m = Map()
    with pytest.warns(Warning, match="resolution is an H3 knob"):
        m.add_heatmap(DF, cells="geohash", base=32, resolution=7)
    with pytest.warns(Warning, match="is a geohash knob"):
        m.add_heatmap(DF, name="B", cells="h3", length=6)
