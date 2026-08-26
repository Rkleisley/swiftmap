"""
Niemeyer geohashes as a geometry input: rectangles through the tabular front
doors -- but ONLY with the base stated. The one rule under test everywhere
here: the same string is a valid hash in every base whose alphabet contains
it, decoding somewhere different in each, so nothing is ever parsed from a
geohash without geohash_base. Explicitness is the format's spec (mirroring
geostructures' NiemeyerHasher), not a missing convenience.
"""
import numpy as np
import pytest

pd = pytest.importorskip("pandas")

from swiftmap import Map
from swiftmap import _niemeyer as nm
from swiftmap._warnings import EmptyLayerWarning

HASHES_32 = [nm.encode(36.0 + i * 0.2, -5.3 + i * 0.2, 6, 32) for i in range(3)]


def polygon_layers(m):
    return [l for l in m.layers if l.type == "polygon"]


def vector_coords(m, layer):
    raw = m.coordinate_buffers[layer.id]
    return np.frombuffer(raw, dtype=np.float64).reshape(-1, 2).tolist()


def test_column_with_stated_base_becomes_rectangles():
    df = pd.DataFrame({"geohash": HASHES_32, "count": [4, 9, 2]})
    m = Map()
    m.add_polygon(df, geohash_base=32)
    layers = polygon_layers(m)
    assert len(layers) == 3
    assert vector_coords(m, layers[0]) == nm.cell_ring(HASHES_32[0], 32)
    assert [l.properties["count"] for l in layers] == [4, 9, 2]
    assert [l.properties["geohash"] for l in layers] == HASHES_32   # the join key stays


def test_explicit_geohash_col_for_an_unguessable_name():
    df = pd.DataFrame({"aggregation_cell": HASHES_32, "v": [1, 2, 3]})
    m = Map()
    m.add_polygon(df, geohash_col="aggregation_cell", geohash_base=32)
    assert len(polygon_layers(m)) == 3


def test_the_base_decides_where_the_rectangle_lands():
    df = pd.DataFrame({"geohash": ["9c3f"]})
    m16, m32 = Map(), Map()
    m16.add_polygon(df, geohash_base=16)
    m32.add_polygon(df, geohash_base=32)
    ring16 = vector_coords(m16, polygon_layers(m16)[0])
    ring32 = vector_coords(m32, polygon_layers(m32)[0])
    assert ring16 != ring32


def test_no_base_means_no_parse_and_a_hint():
    df = pd.DataFrame({"geohash": HASHES_32})
    m = Map()
    with pytest.warns(Warning) as record:
        m.add_polygon(df)
    assert polygon_layers(m) == []
    assert any("geohash_base" in str(w.message) for w in record)


def test_geohash_col_without_base_warns_and_stays_data():
    df = pd.DataFrame({"g": HASHES_32, "lat": [36.0, 36.1, 36.2],
                       "lon": [-5.3, -5.2, -5.1]})
    m = Map()
    with pytest.warns(Warning, match="cannot state its own base"):
        m.add_polygon(df, geohash_col="g", name="Ring")
    layers = polygon_layers(m)
    assert len(layers) == 1                     # the lat/lon ring path took over
    assert len(vector_coords(m, layers[0])) == 4


def test_bad_base_warns_and_parses_nothing():
    df = pd.DataFrame({"geohash": HASHES_32})
    m = Map()
    with pytest.warns(Warning) as record:
        m.add_polygon(df, geohash_base=10)
    assert any("must be one of" in str(w.message) for w in record)
    assert any(isinstance(w.message, EmptyLayerWarning) for w in record)
    assert polygon_layers(m) == []


def test_bare_list_with_base():
    m = Map()
    m.add_polygon(HASHES_32, geohash_base=32)
    assert len(polygon_layers(m)) == 3


def test_bare_string_with_base():
    m = Map()
    m.add_polygon(HASHES_32[0], geohash_base=32, name="Cell")
    (layer,) = polygon_layers(m)
    assert vector_coords(m, layer) == nm.cell_ring(HASHES_32[0], 32)


def test_alphabet_violations_skip_with_a_count():
    df = pd.DataFrame({"geohash": [HASHES_32[0], "9a3f", HASHES_32[1]],
                       "v": [1, 2, 3]})                 # 'a' is not base-32
    m = Map()
    with pytest.warns(Warning, match="Skipped 1 of 3"):
        m.add_polygon(df, geohash_base=32)
    assert [l.properties["v"] for l in polygon_layers(m)] == [1, 3]


def test_polars_and_dict_front_doors():
    pl = pytest.importorskip("polars")
    m = Map()
    m.add_polygon(pl.DataFrame({"geohash": HASHES_32, "v": [1, 2, 3]}),
                  geohash_base=32, name="Polars")
    m.add_polygon({"geohash": HASHES_32[:2], "v": [5, 6]}, geohash_base=32,
                  name="Dict")
    assert len(m.find_layers(types="polygon")) == 5


def test_color_col_ramps_the_cells():
    df = pd.DataFrame({"geohash": HASHES_32, "count": [0, 50, 100]})
    m = Map()
    m.add_polygon(df, geohash_base=32, name="Density", color_col="count")
    fills = [getattr(l, "fillColor", None) for l in polygon_layers(m)]
    assert all(f and f.startswith("#") for f in fills)
    assert fills[0] != fills[2]
