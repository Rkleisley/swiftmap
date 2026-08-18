"""
Time layers: reading feature time out of properties, and the make_time_layer surface.

Timestamps are never re-parsed from the source data -- they are read from the layer's own
properties, where add_* already put them. That is what keeps make_time_layer a metadata
stamp plus one buffer, rather than a second parsing pipeline.
"""
import math
import warnings

import numpy as np
import pytest

import swiftmap
from swiftmap._warnings import SwiftMapWarning
from swiftmap.layers._time import (
    parse_timestamp, detect_time_fields, normalize_layer_times, is_valid_period,
)

T0 = 1767225600000.0  # 2026-01-01T00:00:00Z
HOUR = 3600 * 1000.0


class Comm:
    comm_id = "c"
    kernel = True

    def __init__(self):
        self.msgs = []

    def send(self, data=None, buffers=None, **kw):
        self.msgs.append((data, buffers or []))

    def on_msg(self, *a, **k):
        pass

    def close(self, *a, **k):
        pass


def quiet_map():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        return swiftmap.Map()


# --- one timestamp, any shape the transport can hold ---------------------------------
@pytest.mark.parametrize("value,expected", [
    pytest.param("2026-01-01T00:00:00Z", T0, id="iso-z"),
    pytest.param("2026-01-01T00:00:00+00:00", T0, id="iso-offset"),
    pytest.param("2026-01-01", T0, id="date-only"),
    pytest.param(T0, T0, id="epoch-ms"),
    pytest.param(T0 / 1000.0, T0, id="epoch-seconds"),
])
def test_timestamps_normalise_to_epoch_ms(value, expected):
    assert parse_timestamp(value) == expected


def test_datetimes_survive_having_already_been_isoformatted():
    """_json_safe turned every datetime into an ISO string at the add_* boundary."""
    import datetime
    dt = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    assert parse_timestamp(dt.isoformat()) == T0
    assert parse_timestamp(dt) == T0


@pytest.mark.parametrize("value", ["not a date", "", None, True, -5, float("inf")],
                         ids=["text", "empty", "none", "bool", "negative", "inf"])
def test_unreadable_values_are_nan_not_errors(value):
    assert math.isnan(parse_timestamp(value))


# --- finding the field ----------------------------------------------------------------
def test_the_structmap_times_pair_is_recognised_first():
    props = {"times": [["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"]], "timestamp": ["x"]}
    assert detect_time_fields(props) == ("times", None)


def test_geostructures_interval_fields_pair_up():
    props = {"datetime_start": ["2026-01-01"], "datetime_end": ["2026-01-02"]}
    assert detect_time_fields(props) == ("datetime_start", "datetime_end")


def test_common_single_names_are_probed_in_order():
    assert detect_time_fields({"timestamp": [1], "date": [1]}) == ("timestamp", None)
    assert detect_time_fields({"date": [1]}) == ("date", None)
    assert detect_time_fields({"speed": [1]}) == (None, None)


# --- normalising a layer ----------------------------------------------------------------
def test_a_column_of_stamps_becomes_degenerate_intervals():
    interleaved, field, timeless = normalize_layer_times(
        {"timestamp": ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"]})
    assert field == "timestamp"
    assert timeless == 0
    assert list(interleaved) == [T0, T0, T0 + HOUR, T0 + HOUR]


def test_interval_columns_keep_start_and_end():
    interleaved, field, _ = normalize_layer_times(
        {"datetime_start": ["2026-01-01T00:00:00Z"], "datetime_end": ["2026-01-01T01:00:00Z"]})
    assert field == "datetime_start/datetime_end"
    assert list(interleaved) == [T0, T0 + HOUR]


def test_a_scalar_layer_normalises_as_one_feature():
    """Single-geometry layers store scalar properties, not columns."""
    interleaved, _, _ = normalize_layer_times({"timestamp": "2026-01-01T00:00:00Z"})
    assert list(interleaved) == [T0, T0]


def test_a_scalar_times_pair_is_one_interval_not_two_features():
    interleaved, _, _ = normalize_layer_times(
        {"times": ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"]})
    assert list(interleaved) == [T0, T0 + HOUR]


def test_a_reversed_interval_is_righted_not_rejected():
    interleaved, _, _ = normalize_layer_times(
        {"times": [["2026-01-01T01:00:00Z", "2026-01-01T00:00:00Z"]]})
    assert list(interleaved) == [T0, T0 + HOUR]


def test_bad_rows_become_nan_and_are_counted():
    interleaved, _, timeless = normalize_layer_times(
        {"timestamp": ["2026-01-01T00:00:00Z", "not a date"]})
    assert timeless == 1
    assert interleaved[0] == T0
    assert math.isnan(interleaved[2])


def test_no_time_field_is_a_none_answer():
    assert normalize_layer_times({"speed": [1, 2]}) == (None, None, 0)
    assert normalize_layer_times(None) == (None, None, 0)


def test_period_grammar_matches_the_docs():
    for good in ("P1D", "PT1H", "P1M", "PT15M", "P2W", "P1DT12H"):
        assert is_valid_period(good), good
    for bad in ("", "P", "1D", "PT1D", None, 5):
        assert not is_valid_period(bad), bad


# --- the Map surface --------------------------------------------------------------------
@pytest.fixture
def m():
    mp = quiet_map()
    mp.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
         "timestamp": ["2026-01-01T00:00:00Z", "2026-01-01T06:00:00Z"]},
        name="Vessel")
    return mp


def test_make_time_layer_stamps_the_layer_and_ships_a_buffer(m):
    m.make_time_layer("Vessel")
    layer = m.find_layers("Vessel")[0]
    assert layer["time"] == {"field": "timestamp", "duration": "period"}
    times = np.frombuffer(m.coordinate_buffers[f"{layer['id']}::times"])
    assert list(times) == [T0, T0, T0 + 6 * HOUR, T0 + 6 * HOUR]


def test_the_buffer_rides_the_existing_transport(m):
    m.comm = Comm()
    m.comm.msgs.clear()
    m.make_time_layer("Vessel")
    ops = [o for d, _ in m.comm.msgs for o in (d.get("content") or {}).get("ops", [])]
    kinds = sorted(o["op"] for o in ops)
    assert kinds == ["buffer", "set"], "one times buffer, one metadata stamp"


def test_making_it_twice_emits_nothing_new(m):
    m.make_time_layer("Vessel")
    m.comm = Comm()
    m.comm.msgs.clear()
    m.make_time_layer("Vessel")
    ops = [o for d, _ in m.comm.msgs for o in (d.get("content") or {}).get("ops", [])]
    assert ops == [], "same times, same metadata -- a reactive re-run costs nothing"


def test_chaining_reads_as_designed(m):
    """m.add_circle_markers(df, name=...).make_time_layer(...) -- option 1 via option 3."""
    result = quiet_map().add_circle_markers(
        {"lat": [36.0], "lon": [-5.3], "timestamp": ["2026-01-01T00:00:00Z"]},
        name="V").make_time_layer("V")
    assert result.find_layers("V")[0].get("time")


def test_a_layer_without_time_warns_and_is_skipped():
    mp = quiet_map()
    mp.add_circle_markers({"lat": [36.0], "lon": [-5.3], "speed": [4]}, name="NoTime")
    with pytest.warns(SwiftMapWarning, match="no time property"):
        mp.make_time_layer("NoTime")
    assert mp.find_layers("NoTime")[0].get("time") is None


def test_partial_times_warn_with_a_count(m):
    mp = quiet_map()
    mp.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
         "timestamp": ["2026-01-01T00:00:00Z", "unparseable"]}, name="Holes")
    with pytest.warns(SwiftMapWarning, match="1 of 2 feature"):
        mp.make_time_layer("Holes")


def test_no_match_warns(m):
    with pytest.warns(SwiftMapWarning, match="make_time_layer matched no layers"):
        m.make_time_layer("Typo")


def test_a_bad_duration_falls_back_to_period(m):
    with pytest.warns(SwiftMapWarning, match="not an ISO8601 duration"):
        m.make_time_layer("Vessel", duration="6 hours")
    assert m.find_layers("Vessel")[0]["time"]["duration"] == "period"


def test_period_lands_in_the_shared_config(m):
    m.make_time_layer("Vessel", period="PT6H")
    assert m.time_config["period"] == "PT6H"


def test_configure_time_rejects_a_bad_period_and_keeps_the_old(m):
    m.configure_time(period="PT1H", auto_play=True)
    with pytest.warns(SwiftMapWarning, match="not an ISO8601 duration"):
        m.configure_time(period="hourly")
    assert m.time_config == {"period": "PT1H", "auto_play": True}


def test_clear_removes_metadata_and_buffer(m):
    m.make_time_layer("Vessel")
    key = f"{m.find_layers('Vessel')[0]['id']}::times"
    m.clear_time_layer()
    assert m.find_layers("Vessel")[0].get("time") is None
    assert key not in m.coordinate_buffers


def test_removing_the_layer_removes_its_times_buffer(m):
    m.make_time_layer("Vessel")
    layer_id = m.find_layers("Vessel")[0]["id"]
    m.remove_layer("Vessel")
    assert f"{layer_id}::times" not in m.coordinate_buffers, \
        "auxiliary buffers go with their layer, or every animated layer leaks one"


def test_geostructures_intervals_are_found_without_being_named():
    pytest.importorskip("geostructures")
    import datetime as dt
    from geostructures import Coordinate, GeoPoint
    from geostructures.collections import Track
    mp = quiet_map()
    t = dt.datetime(2026, 1, 1)
    track = Track([GeoPoint(Coordinate(-5.3, 36.0), dt=t),
                   GeoPoint(Coordinate(-5.2, 36.1), dt=t + dt.timedelta(hours=1))])
    mp.add_circle_markers(track, name="Track").make_time_layer("Track")
    stamped = mp.find_layers("Track")[0]
    assert stamped["time"]["field"].startswith("datetime_start")


def test_position_lands_in_the_shared_config(m):
    m.configure_time(position="bottom-right")
    assert m.time_config["position"] == "bottom-right"


def test_an_unknown_position_warns_and_keeps_the_old(m):
    m.configure_time(position="left-center")
    with pytest.warns(SwiftMapWarning, match="is not one of"):
        m.configure_time(position="middle")
    assert m.time_config["position"] == "left-center"


def test_python_and_js_agree_on_the_position_names():
    """The two sets live on either side of the wire; drift means a silently ignored value."""
    import pathlib
    import re
    from swiftmap.map import TIME_POSITIONS
    source = (pathlib.Path(__file__).resolve().parent.parent / "src" / "timecontrol.js") \
        .read_text(encoding="utf-8")
    block = source[source.index("export const POSITIONS"):]
    js_names = set(re.findall(r'"([a-z]+-[a-z]+)"\s*:', block[:block.index("};")]))
    assert js_names == set(TIME_POSITIONS)


# --- the vectorised fast path is indistinguishable from the loop ------------------------
def loop_normalize(props, **kw):
    """The per-value path, forced by making the gate reject the column."""
    from swiftmap.layers import _time
    values = props[list(props)[0]]
    assert _time._numeric_epochs(values) is None or True
    # append one string to defeat the gate, normalise, then strip the extra feature
    poisoned = {list(props)[0]: list(values) + ["x"]}
    interleaved, field, timeless = normalize_layer_times(poisoned, **kw)
    return list(interleaved)[:-2], field, timeless - 1


@pytest.mark.parametrize("values", [
    pytest.param([1781222400, 1781222401, 1781222402], id="epoch-seconds"),
    pytest.param([1781222400000.0, 1781222400500.0], id="epoch-ms"),
    pytest.param([1781222400, None, 1781222402], id="with-none"),
    pytest.param([1781222400, -5, 1781222402], id="with-invalid"),
])
def test_vector_and_loop_paths_agree(values):
    import math
    fast, _, fast_timeless = normalize_layer_times({"timestamp": values})
    slow, _, slow_timeless = loop_normalize({"timestamp": values})
    assert fast_timeless == slow_timeless
    for a, b in zip(list(fast), slow):
        assert (math.isnan(a) and math.isnan(b)) or a == b


def test_bools_do_not_ride_the_vector_path():
    """
    bool subclasses int; vectorised it would become epoch 1000ms -- a point in 1970 --
    where the loop marks it timeless. The gate must reject the column, not corrupt it.
    """
    import math
    interleaved, _, timeless = normalize_layer_times({"timestamp": [1781222400, True]})
    assert timeless == 1
    assert math.isnan(list(interleaved)[2])


def test_vectorised_intervals_still_right_reversed_pairs():
    fast, _, _ = normalize_layer_times(
        {"datetime_start": [1781222401], "datetime_end": [1781222400]})
    assert list(fast) == [1781222400000.0, 1781222401000.0]


def test_window_lands_in_the_shared_config(m):
    m.configure_time(window="PT2H30M")
    assert m.time_config["window"] == "PT2H30M"


def test_clearing_the_window_removes_the_key_not_stores_none(m):
    """The frontend treats a present key as an override; None must mean absent."""
    m.configure_time(window="PT2H")
    m.configure_time(window=None)
    assert "window" not in m.time_config


def test_a_bad_window_warns_and_keeps_the_old(m):
    m.configure_time(window="PT1H")
    with pytest.warns(SwiftMapWarning, match="not an ISO8601 duration"):
        m.configure_time(window="2 hours")
    assert m.time_config["window"] == "PT1H"


def test_fade_is_off_unless_asked(m):
    m.make_time_layer("Vessel")
    assert "fade" not in m.find_layers("Vessel")[0]["time"]


def test_fade_lands_in_the_time_metadata(m):
    m.make_time_layer("Vessel", fade=True)
    assert m.find_layers("Vessel")[0]["time"]["fade"] is True


# --- per-vertex times: a whole track on one layer, one slot -----------------------------
# The order column used to be dropped at parse (only iloc[0] of every column survived
# grouping), so a track ordered by its timestamps LOST them -- the reason consuming apps
# chunked tracks into per-segment layers and marched into the 64-slot ceiling. Lines now
# keep the order column per vertex; make_time_layer already handles list-valued
# properties, so one layer's ::times buffer carries a pair per vertex and the GPU path
# animates per segment.
def track_frame():
    import pandas as pd
    return pd.DataFrame({
        "lat": [36.0, 36.1, 36.2, 40.0, 40.1],
        "lon": [-5.3, -5.2, -5.1, -3.7, -3.6],
        "track_id": ["A", "A", "A", "B", "B"],
        "ts": [T0, T0 + HOUR, T0 + 2 * HOUR, T0, T0 + HOUR],
    })


def test_grouped_lines_keep_the_order_column_per_vertex():
    m = swiftmap.Map()
    m.add_polyline(track_frame(), line_id_col="track_id", order_col="ts", name="track_id")
    lines = [l for l in m.layers if l.get("type") == "polyline"]
    assert len(lines) == 2
    assert lines[0].properties["ts"] == [T0, T0 + HOUR, T0 + 2 * HOUR]
    assert lines[1].properties["ts"] == [T0, T0 + HOUR]


def test_datetime_order_columns_arrive_as_epoch_ms():
    import pandas as pd
    df = track_frame()
    df["ts"] = pd.to_datetime(df["ts"], unit="ms")
    m = swiftmap.Map()
    m.add_polyline(df, line_id_col="track_id", order_col="ts", name="track_id")
    lines = [l for l in m.layers if l.get("type") == "polyline"]
    assert lines[0].properties["ts"] == [int(T0), int(T0 + HOUR), int(T0 + 2 * HOUR)], \
        "epoch ms ints, so the vectorised numeric time path applies"


def test_make_time_layer_writes_one_pair_per_vertex():
    m = swiftmap.Map()
    m.add_polyline(track_frame(), line_id_col="track_id", order_col="ts", name="track_id")
    m.make_time_layer(types="polyline", time_field="ts")
    line = [l for l in m.layers if l.get("type") == "polyline"][0]
    times = np.frombuffer(m.coordinate_buffers[f"{line.id}::times"], dtype=np.float64)
    assert len(times) == 6, "three vertices, one [start, end] pair each"
    assert times[0] == T0 and times[5] == T0 + 2 * HOUR


def test_dict_rows_keep_the_order_column_too():
    rows = [
        {"lat": 36.0, "lon": -5.3, "track_id": "A", "seq": 3},
        {"lat": 36.1, "lon": -5.2, "track_id": "A", "seq": 1},
        {"lat": 36.2, "lon": -5.1, "track_id": "A", "seq": 2},
    ]
    m = swiftmap.Map()
    m.add_polyline(rows, line_id_col="track_id", order_col="seq", name="Track")
    line = [l for l in m.layers if l.get("type") == "polyline"][0]
    assert line.properties["seq"] == [1, 2, 3], "sorted by the order column, then kept"


def test_polygon_rings_do_not_grow_a_vertex_series():
    import pandas as pd
    df = pd.DataFrame({
        "lat": [10.0, 11.0, 12.0], "lon": [30.0, 31.0, 32.0],
        "zone": ["Z"] * 3, "vertex": [1, 2, 3],
    })
    m = swiftmap.Map()
    m.add_polygon(df, shape_id_col="zone", order_col="vertex", name="Zones")
    poly = [l for l in m.layers if l.get("type") == "polygon"][0]
    assert not isinstance(poly.properties.get("vertex"), list), \
        "vertex order around a ring is not a time series"
