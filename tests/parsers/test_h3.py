"""
H3 cell ids as a geometry input: a bare cell string, a list of them, or a table
column becomes hexagon polygons through every tabular front door.

Two rules matter here. Validation is structural (h3.is_valid_cell reads the id's
bit layout), so a hex-shaped string that is not a cell stays data and never
hijacks a column. And unlike a WKT column, the cell column survives into the
properties: a cell id is a join key and popup content, not just a spelling of
the geometry.
"""
import numpy as np
import pytest

h3 = pytest.importorskip("h3")
pd = pytest.importorskip("pandas")

import swiftmap.parsers.sources._utils as _utils
from swiftmap import Map
from swiftmap._warnings import EmptyLayerWarning
from swiftmap.parsers.sources._utils import h3_cell_str, is_h3_cell, h3_cell_ring

CELL = "8928308280fffff"                      # res 9, over San Francisco
DISK = sorted(h3.grid_disk(CELL, 1))          # the cell and its six neighbours
HEX_JUNK = "fffffffffffffff"                  # 15 hex chars, not a valid cell


def polygon_layers(m):
    return [l for l in m.layers if l.type == "polygon"]


def vector_coords(m, layer):
    raw = m.coordinate_buffers[layer.id]
    return np.frombuffer(raw, dtype=np.float64).reshape(-1, 2).tolist()


def expected_ring(cell):
    ring = [[float(lat), float(lon)] for lat, lon in h3.cell_to_boundary(cell)]
    return ring + [ring[0]]


# --- helpers ----------------------------------------------------------------

def test_cell_str_normalises_both_spellings():
    assert h3_cell_str(CELL) == CELL
    assert h3_cell_str(int(CELL, 16)) == CELL
    assert h3_cell_str("POLYGON ((0 0, 1 0, 1 1, 0 0))") is None
    assert h3_cell_str("8928308280ffff") is None       # 14 chars
    assert h3_cell_str(12.5) is None


def test_validation_is_structural_not_shape():
    assert is_h3_cell(CELL)
    assert is_h3_cell(int(CELL, 16))
    assert not is_h3_cell(HEX_JUNK)


def test_ring_is_closed_and_matches_the_boundary():
    ring = h3_cell_ring(CELL)
    assert ring == expected_ring(CELL)
    assert ring[0] == ring[-1]
    assert len(ring) == 7                              # six vertices plus closure


# --- bare front door --------------------------------------------------------

def test_bare_cell_string_becomes_a_hexagon():
    m = Map()
    m.add_polygon(CELL, name="Hex")
    layers = polygon_layers(m)
    assert len(layers) == 1
    assert vector_coords(m, layers[0]) == expected_ring(CELL)
    assert layers[0].properties["h3"] == CELL


def test_list_of_cells_fans_into_hexagons():
    m = Map()
    m.add_polygon(DISK)
    layers = polygon_layers(m)
    assert len(layers) == len(DISK)
    assert sorted(l.properties["h3"] for l in layers) == DISK


def test_hex_shaped_junk_string_is_not_geometry():
    m = Map()
    with pytest.warns(Warning, match="could not read"):
        m.add_polygon(HEX_JUNK)
    assert polygon_layers(m) == []


def test_mixed_resolutions_in_one_list():
    parent = h3.cell_to_parent(CELL, 5)
    m = Map()
    m.add_polygon([CELL, parent])
    layers = polygon_layers(m)
    assert len(layers) == 2
    assert all(len(vector_coords(m, l)) == 7 for l in layers)


# --- table columns ----------------------------------------------------------

def test_pandas_h3_column_keeps_the_ids_as_properties():
    df = pd.DataFrame({"h3": DISK[:3], "count": [4, 9, 2]})
    m = Map()
    m.add_polygon(df)
    layers = polygon_layers(m)
    assert len(layers) == 3
    assert [l.properties["count"] for l in layers] == [4, 9, 2]
    assert [l.properties["h3"] for l in layers] == DISK[:3]
    assert vector_coords(m, layers[0]) == expected_ring(DISK[0])


def test_polars_h3_column():
    pl = pytest.importorskip("polars")
    df = pl.DataFrame({"h3": DISK[:3], "count": [4, 9, 2]})
    m = Map()
    m.add_polygon(df)
    layers = polygon_layers(m)
    assert len(layers) == 3
    assert [l.properties["count"] for l in layers] == [4, 9, 2]


def test_plain_dict_h3_column():
    m = Map()
    m.add_polygon({"h3": DISK[:2], "value": [1.5, 2.5]})
    layers = polygon_layers(m)
    assert len(layers) == 2
    assert [l.properties["value"] for l in layers] == [1.5, 2.5]


def test_integer_ids_parse_and_stay_integers_in_properties():
    ids = [int(c, 16) for c in DISK[:2]]
    df = pd.DataFrame({"h3": ids, "v": [1, 2]})
    m = Map()
    m.add_polygon(df)
    layers = polygon_layers(m)
    assert len(layers) == 2
    assert [l.properties["h3"] for l in layers] == ids
    assert vector_coords(m, layers[0]) == expected_ring(DISK[0])


def test_shape_id_col_points_at_an_unguessable_column_name():
    df = pd.DataFrame({"aggregation_zone": DISK[:2], "v": [1, 2]})
    m = Map()
    m.add_polygon(df, shape_id_col="aggregation_zone")
    assert len(polygon_layers(m)) == 2


def test_wkt_column_wins_over_an_h3_column():
    df = pd.DataFrame({
        "geometry": ["POLYGON ((-118.24 34.05, -118.20 34.05, -118.20 34.10, -118.24 34.05))"],
        "h3": [CELL],
    })
    m = Map()
    m.add_polygon(df)
    layers = polygon_layers(m)
    assert len(layers) == 1
    assert len(vector_coords(m, layers[0])) == 4       # the WKT square, not the hexagon
    assert layers[0].properties["h3"] == CELL          # the cell id stays data


def test_invalid_cells_in_a_column_do_not_hijack_it():
    # 'cell' is a candidate name, but its values fail structural validation, so the
    # rows fall through to the lat/lon grouping tier untouched.
    df = pd.DataFrame({
        "cell": [HEX_JUNK] * 3,
        "lat": [10.0, 11.0, 12.0],
        "lon": [30.0, 31.0, 32.0],
    })
    m = Map()
    m.add_polygon(df, name="Ring")
    layers = polygon_layers(m)
    assert len(layers) == 1
    assert len(vector_coords(m, layers[0])) == 4       # three vertices plus closure


def test_a_bad_row_is_skipped_with_a_count():
    df = pd.DataFrame({"h3": [DISK[0], HEX_JUNK, DISK[1]], "v": [1, 2, 3]})
    m = Map()
    with pytest.warns(Warning, match="Skipped 1 of 3"):
        m.add_polygon(df)
    layers = polygon_layers(m)
    assert len(layers) == 2
    assert [l.properties["v"] for l in layers] == [1, 3]


def test_color_col_ramps_the_hexagons():
    df = pd.DataFrame({"h3": DISK[:3], "count": [0, 50, 100]})
    m = Map()
    m.add_polygon(df, name="Density", color_col="count")
    layers = polygon_layers(m)
    fills = [getattr(l, "fillColor", None) for l in layers]
    assert all(f and f.startswith("#") for f in fills)
    assert fills[0] != fills[2]                        # the extremes take different colours


# --- the h3 package missing -------------------------------------------------

def test_missing_lib_warns_with_the_install_hint(monkeypatch):
    monkeypatch.setattr(_utils, "_h3_module", None)
    m = Map()
    with pytest.warns(Warning) as record:
        m.add_polygon(CELL)
    assert any("pip install h3" in str(w.message) for w in record)
    assert polygon_layers(m) == []


def test_missing_lib_warns_for_a_column_too(monkeypatch):
    monkeypatch.setattr(_utils, "_h3_module", None)
    df = pd.DataFrame({"h3": DISK[:2], "v": [1, 2]})
    m = Map()
    with pytest.warns(Warning) as record:
        m.add_polygon(df)
    assert any("pip install h3" in str(w.message) for w in record)
    assert polygon_layers(m) == []
