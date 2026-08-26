"""
swiftmap.hexbin: raw points in, a cell + count table out.

The boundary under test: counting is the only aggregation, the result is plain
data in the input's own flavour, and the whole thing composes with add_polygon
through the H3 parser rather than through any dedicated rendering path.
"""
import numpy as np
import pytest

h3 = pytest.importorskip("h3")
pd = pytest.importorskip("pandas")

import swiftmap.parsers.sources._utils as _utils
from swiftmap import Map, hexbin

A = (36.01, -5.36)
B = (46.5, 7.0)          # far away: a different cell at every resolution


def frame(points):
    lats, lons = zip(*points)
    return pd.DataFrame({"lat": lats, "lon": lons})


def test_counts_per_cell():
    out = hexbin(frame([A, A, A, B]), resolution=8)
    assert isinstance(out, pd.DataFrame)
    expected_a = h3.latlng_to_cell(*A, 8)
    expected_b = h3.latlng_to_cell(*B, 8)
    got = dict(zip(out["h3"], out["count"]))
    assert got == {expected_a: 3, expected_b: 1}


def test_resolution_changes_the_binning():
    near_a = (A[0] + 0.001, A[1] + 0.001)
    coarse = hexbin(frame([A, near_a]), resolution=4)
    fine = hexbin(frame([A, near_a]), resolution=12)
    assert len(coarse) == 1 and coarse["count"][0] == 2
    assert len(fine) == 2


def test_output_flavour_matches_input():
    pl = pytest.importorskip("polars")
    points = [A, B]
    assert isinstance(hexbin(frame(points), resolution=8), pd.DataFrame)
    lats, lons = zip(*points)
    out_pl = hexbin(pl.DataFrame({"lat": lats, "lon": lons}), resolution=8)
    assert isinstance(out_pl, pl.DataFrame)
    out_dict = hexbin({"lat": list(lats), "lon": list(lons)}, resolution=8)
    assert isinstance(out_dict, dict)
    assert sorted(out_dict) == ["count", "h3"]


def test_bare_coordinate_list_input():
    out = hexbin([list(A), list(B)], resolution=8)
    assert isinstance(out, dict)
    assert sorted(out["count"]) == [1, 1]


def test_lat_lon_column_overrides():
    df = pd.DataFrame({"phi": [A[0]], "lam": [A[1]]})
    out = hexbin(df, resolution=8, lat_col="phi", lon_col="lam")
    assert list(out["h3"]) == [h3.latlng_to_cell(*A, 8)]


def test_rows_with_missing_coordinates_drop_with_a_warning():
    df = pd.DataFrame({"lat": [A[0], np.nan], "lon": [A[1], -5.0]})
    with pytest.warns(Warning, match="Dropped 1 of 2"):
        out = hexbin(df, resolution=8)
    assert list(out["count"]) == [1]


def test_empty_input_gives_an_empty_table():
    out = hexbin(pd.DataFrame({"lat": [], "lon": []}), resolution=8)
    assert len(out) == 0


def test_composes_with_add_polygon_and_color_col():
    df = frame([A, A, A, B])
    m = Map()
    m.add_polygon(hexbin(df, resolution=8), name="Density", color_col="count")
    layers = [l for l in m.layers if l.type == "polygon"]
    assert len(layers) == 2
    assert sorted(l.properties["count"] for l in layers) == [1, 3]
    assert all(getattr(l, "fillColor", "").startswith("#") for l in layers)


def test_impossible_resolution_raises():
    with pytest.raises(ValueError, match="0 to 15"):
        hexbin(frame([A]), resolution=16)
    with pytest.raises(ValueError, match="0 to 15"):
        hexbin(frame([A]), resolution="8")


def test_missing_lib_raises_with_the_install_hint(monkeypatch):
    monkeypatch.setattr(_utils, "_h3_module", None)
    with pytest.raises(ImportError, match="pip install h3"):
        hexbin(frame([A]), resolution=8)


# --- geohash_bin: the sibling with the other cell family ------------------------

def test_geohash_bin_counts_and_composes():
    from swiftmap import geohash_bin
    import swiftmap._niemeyer as nm
    df = frame([A, A, B])
    out = geohash_bin(df, length=6, base=32)
    assert isinstance(out, pd.DataFrame)
    got = dict(zip(out["geohash"], out["count"]))
    assert got == {nm.encode(*A, 6, 32): 2, nm.encode(*B, 6, 32): 1}
    m = Map()
    m.add_polygon(out, geohash_base=32, name="Cells", color_col="count")
    assert len(m.find_layers(types="polygon")) == 2


def test_geohash_bin_requires_a_real_base_and_length():
    from swiftmap import geohash_bin
    with pytest.raises(ValueError, match="one of"):
        geohash_bin(frame([A]), length=6, base=10)
    with pytest.raises(ValueError, match="positive integer"):
        geohash_bin(frame([A]), length=0, base=32)
