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
        m.make_time_layer("Feed", period="PT1H")
    layer = m.get_layer("Feed")
    assert layer.get("time") is None
    assert f"{layer.id}::times" not in m.coordinate_buffers
    # A fully declined call leaves NO residue: with the period recorded, the
    # shared config would be the only difference between a successful call and
    # a declined one.
    assert m.time_config == {}


def test_any_fully_declined_call_leaves_no_period_residue():
    # Not clustering-specific: a layer with no readable time declines the same
    # way and must strand no shared period either.
    m = Map()
    m.add_circle_markers(DF, name="NoTimes")
    with pytest.warns(Warning, match="has no time property"):
        m.make_time_layer("NoTimes", period="PT1H")
    assert m.time_config == {}


def test_a_partly_declined_call_still_animates_the_rest():
    df = DF.assign(timestamp=["2026-01-01", "2026-01-02", "2026-01-03"])
    m = Map()
    m.add_circle_markers(df, name="Feed", cluster=True)
    m.add_circle_markers(df, name="Track")
    with pytest.warns(Warning, match="not composable yet"):
        m.make_time_layer(types="circle_markers", period="PT1H")
    assert m.get_layer("Feed").get("time") is None
    assert m.get_layer("Track").get("time")
    assert m.time_config.get("period") == "PT1H"


def test_merged_members_keep_their_clustering():
    m = Map()
    m.add_circle_markers(DF.iloc[:2], name="Mix", layer_group="G", cluster=True)
    m.add_circle_markers(DF.iloc[2:], name="Mix", layer_group="G", cluster=True)
    entry = m.layers[-1]
    assert entry.type == "group"
    assert all(sub.get("cluster") is True for sub in entry.layers)
