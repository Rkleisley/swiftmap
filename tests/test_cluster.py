"""
Marker clustering options: flags on the config for the client-side renderer,
and the one composition rule -- clustering and time animation are not
composable yet, and saying so beats a slider that silently ignores a layer.
"""
import pandas as pd
import pytest

from swiftmap import Map

DF = pd.DataFrame({"lat": [36.01, 36.011, 36.4], "lon": [-5.31, -5.311, -5.0],
                   "site": ["A", "B", "C"]})


def test_cluster_flags_ride_the_config():
    m = Map()
    m.add_circle_markers(DF, name="Sites", cluster=True, cluster_radius=50,
                         cluster_max_zoom=15)
    layer = m.get_layer("Sites")
    assert layer.cluster is True
    assert layer.cluster_radius == 50
    assert layer.cluster_max_zoom == 15


def test_defaults_and_absence():
    m = Map()
    m.add_circle_markers(DF, name="Plain")
    m.add_markers(DF, name="Pins", cluster=True)
    plain = m.get_layer("Plain")
    pins = m.get_layer("Pins")
    assert getattr(plain, "cluster", None) is None
    assert pins.cluster is True
    assert pins.cluster_radius == 60
    assert getattr(pins, "cluster_max_zoom", None) is None


def test_make_time_layer_refuses_clustered_layers():
    df = DF.assign(timestamp=["2026-01-01", "2026-01-02", "2026-01-03"])
    m = Map()
    m.add_circle_markers(df, name="Feed", cluster=True)
    with pytest.warns(Warning, match="not composable yet"):
        m.make_time_layer("Feed")
    layer = m.get_layer("Feed")
    assert layer.get("time") is None
    assert f"{layer.id}::times" not in m.coordinate_buffers


def test_merged_members_keep_their_clustering():
    m = Map()
    m.add_circle_markers(DF.iloc[:2], name="Mix", layer_group="G", cluster=True)
    m.add_circle_markers(DF.iloc[2:], name="Mix", layer_group="G", cluster=True)
    entry = m.layers[-1]
    assert entry.type == "group"
    assert all(sub.get("cluster") is True for sub in entry.layers)
