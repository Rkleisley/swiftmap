"""
The MVT bridge: swiftmap's dependency-free decoder, pinned to the reference
implementation (mapbox-vector-tile encodes the fixtures), and read_mvt
turning a tile directory into a table the parsers already read.
"""
import gzip
import math

import pytest

mvt_ref = pytest.importorskip("mapbox_vector_tile")
pd = pytest.importorskip("pandas")

from swiftmap import Map, read_mvt
from swiftmap._mvt import decode_mvt, _tile_to_lonlat
from swiftmap.mvt import _tile_range

OPTS = {"y_coord_down": True, "extents": 4096}


def encode(features, name="test"):
    return mvt_ref.encode([{"name": name, "features": features}],
                          default_options=OPTS)


def test_every_property_type_survives():
    tile = encode([{"geometry": "POINT(100 200)",
                    "properties": {"s": "pin", "i": 7, "neg": -3,
                                   "f": 1.5, "b": True}}])
    (row,) = decode_mvt(tile, 1, 0, 0)
    assert row["s"] == "pin" and row["i"] == 7 and row["neg"] == -3
    assert row["f"] == 1.5 and row["b"] is True
    assert row["mvt_layer"] == "test"


def test_coordinates_land_where_the_tile_says():
    tile = encode([{"geometry": "POINT(100 200)", "properties": {}}])
    (row,) = decode_mvt(tile, 1, 0, 0)
    lon, lat = _tile_to_lonlat(1, 0, 0, 4096)(100, 200)
    assert row["geometry"] == f"POINT ({lon:.7f} {lat:.7f})"


def test_geometry_families_and_holes():
    tile = encode([
        {"geometry": "LINESTRING(0 0, 100 100, 200 0)", "properties": {"k": "l"}},
        {"geometry": "MULTILINESTRING((0 0, 100 0),(0 200, 100 200))",
         "properties": {"k": "ml"}},
        {"geometry": "POLYGON((0 0, 0 1000, 1000 1000, 1000 0, 0 0),"
                     "(200 200, 800 200, 800 800, 200 800, 200 200))",
         "properties": {"k": "hole"}},
        {"geometry": "MULTIPOLYGON(((0 0, 0 100, 100 100, 100 0, 0 0)),"
                     "((2000 2000, 2000 2100, 2100 2100, 2100 2000, 2000 2000)))",
         "properties": {"k": "mp"}},
    ])
    kinds = {r["k"]: r["geometry"].split(" ", 1)[0] for r in decode_mvt(tile, 1, 0, 0)}
    assert kinds == {"l": "LINESTRING", "ml": "MULTILINESTRING",
                     "hole": "POLYGON", "mp": "MULTIPOLYGON"}
    hole = next(r for r in decode_mvt(tile, 1, 0, 0) if r["k"] == "hole")
    assert hole["geometry"].count("(") == 3     # POLYGON ( (outer), (hole) )


def test_layer_filter_and_gzip():
    tile = mvt_ref.encode([
        {"name": "roads", "features": [{"geometry": "POINT(1 1)", "properties": {}}]},
        {"name": "water", "features": [{"geometry": "POINT(2 2)", "properties": {}}]},
    ], default_options=OPTS)
    rows = decode_mvt(gzip.compress(tile), 0, 0, 0, layers=["water"])
    assert [r["mvt_layer"] for r in rows] == ["water"]


def test_tile_range_matches_the_slippy_convention():
    xs, ys = _tile_range([[35.9, -5.6], [36.2, -5.0]], 10)
    # Slippy math: lon -5.6 at z10 -> x 496; lat 36.2 -> y 396 (north edge).
    assert xs.start == int((-5.6 + 180) / 360 * 1024)
    rad = math.radians(36.2)
    assert ys.start == int((1 - math.log(math.tan(rad) + 1 / math.cos(rad))
                            / math.pi) / 2 * 1024)


def test_read_mvt_from_a_local_tile_directory(tmp_path):
    xs, ys = _tile_range([[35.9, -5.6], [36.2, -5.0]], 10)
    x0, y0 = xs.start, ys.start
    tile_dir = tmp_path / "10" / str(x0)
    tile_dir.mkdir(parents=True)
    (tile_dir / f"{y0}.pbf").write_bytes(encode(
        [{"geometry": "POLYGON((0 0, 0 400, 400 400, 400 0, 0 0))",
          "properties": {"kind": "zone", "pop": 12}}], name="admin"))
    # Every other tile in range is missing -- sparse tilesets are normal, and
    # a missing tile is an empty tile, not an error.
    df = read_mvt(str(tmp_path) + "/{z}/{x}/{y}.pbf",
                  [[35.9, -5.6], [36.2, -5.0]], 10)
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 1
    assert df["mvt_layer"][0] == "admin" and df["pop"][0] == 12

    m = Map()
    m.add_polygon(df, name="Admin", color_col="pop")
    assert len(m.find_layers(types="polygon")) == 1


def test_read_mvt_guards():
    with pytest.raises(ValueError, match="XYZ template"):
        read_mvt("tiles/all.pbf", [[0, 0], [1, 1]], 10)
    with pytest.raises(ValueError, match="0 to 24"):
        read_mvt("t/{z}/{x}/{y}.pbf", [[0, 0], [1, 1]], "ten")
    with pytest.raises(ValueError, match="cover .* tiles"):
        read_mvt("t/{z}/{x}/{y}.pbf", [[-60, -170], [60, 170]], 12)


def test_empty_result_is_an_empty_table(tmp_path):
    df = read_mvt(str(tmp_path) + "/{z}/{x}/{y}.pbf",
                  [[36.0, -5.3], [36.05, -5.25]], 12)
    assert list(df.columns) == ["geometry", "mvt_layer"]
    assert len(df) == 0
