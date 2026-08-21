"""
Multi-part lines at the layer: one buffer, a `parts` table in the config, and the
table surviving the same-name merge into a collection.
"""
import warnings

import numpy as np
import pandas as pd

import swiftmap
from swiftmap._warnings import SwiftMapWarning

WKT = "MULTILINESTRING ((-5.4 36.0, -5.3 36.0), (-5.2 36.1, -5.1 36.1))"


def quiet_map():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        return swiftmap.Map()


def test_a_multilinestring_is_one_layer_with_a_parts_table():
    m = quiet_map()
    m.add_line(pd.DataFrame({"geometry": [WKT]}), name="Legs")
    layers = m.find_layers("Legs")
    assert len(layers) == 1, "one feature, one sidebar entry"
    layer = layers[0]
    assert layer["parts"] == [2, 2]
    flat = np.frombuffer(m.coordinate_buffers[layer["id"]]).reshape(-1, 2).tolist()
    assert flat == [[36.0, -5.4], [36.0, -5.3], [36.1, -5.2], [36.1, -5.1]]
    assert layer["bounds"] == [[36.0, -5.4], [36.1, -5.1]], "bounds span every part"


def test_a_single_part_line_carries_no_parts_table():
    m = quiet_map()
    m.add_line(pd.DataFrame({"geometry": ["LINESTRING (-5.4 36.0, -5.3 36.0)"]}),
               name="Leg")
    assert "parts" not in m.find_layers("Leg")[0].to_dict()


def test_the_parts_table_survives_a_collection_merge():
    # Two same-name adds merge into a group; a part dropped there would hand the
    # renderer one flat run and the phantom segment with it.
    m = quiet_map()
    m.add_line(pd.DataFrame({"geometry": [WKT]}), name="Survey", layer_group="Field")
    m.add_circle_markers({"lat": [36.0], "lon": [-5.3]}, name="Survey", layer_group="Field")
    parts = [l for l in m.find_layers("Survey") if l.get("type") == "polyline"]
    assert len(parts) == 1
    assert parts[0].get("parts") == [2, 2]
