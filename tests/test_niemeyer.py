"""
The Niemeyer codec, pinned character-for-character to geostructures.

swiftmap's implementation is independent (pure arithmetic, no dependency),
but the FORMAT is geostructures' -- charsets, bit orders, and the base-16/64
+/-180 latitude domain included -- so the parity suite here is the contract:
any divergence from geostructures is a bug on this side by definition.
"""
import random

import pytest

from swiftmap import _niemeyer as nm

gs_geohash = pytest.importorskip("geostructures.geohash")
from geostructures import Coordinate  # noqa: E402


@pytest.mark.parametrize("base", [16, 32, 64])
def test_encode_and_decode_match_geostructures(base):
    rng = random.Random(base)
    for _ in range(200):
        lat = rng.uniform(-89.9, 89.9)
        lon = rng.uniform(-179.9, 179.9)
        length = rng.randint(1, 10)
        ours = nm.encode(lat, lon, length, base)
        theirs = gs_geohash._coord_to_niemeyer(Coordinate(lon, lat), length, base)
        assert ours == theirs
        assert nm.decode(ours, base) == gs_geohash._decode_niemeyer(ours, base)


def test_the_same_string_is_a_different_place_in_every_base():
    # The reason the base is part of the format: "9c3f" is over every alphabet.
    places = {base: nm.decode("9c3f", base)[:2] for base in (16, 32, 64)}
    assert len(set(places.values())) == 3


def test_valid_geohash_is_alphabet_strict():
    assert nm.valid_geohash("9c3f", 16)
    assert not nm.valid_geohash("9a3f", 32)      # 'a' is not in the base-32 alphabet
    assert nm.valid_geohash("A_=b", 64)
    assert not nm.valid_geohash("A_=b", 16)
    assert not nm.valid_geohash("", 32)
    assert not nm.valid_geohash(1234, 32)
    assert not nm.valid_geohash("9c3f", 10)      # not a base at all


def test_cell_ring_is_the_closed_decode_rectangle():
    lon, lat, lon_err, lat_err = nm.decode("9c3f", 32)
    ring = nm.cell_ring("9c3f", 32)
    assert ring[0] == ring[-1]
    assert len(ring) == 5
    assert ring[0] == [lat - lat_err, lon - lon_err]
    assert ring[2] == [lat + lat_err, lon + lon_err]


def test_roundtrip_contains_the_point():
    rng = random.Random(1)
    for base in (16, 32, 64):
        for _ in range(50):
            lat = rng.uniform(-89, 89)
            lon = rng.uniform(-179, 179)
            gh = nm.encode(lat, lon, 8, base)
            clon, clat, lon_err, lat_err = nm.decode(gh, base)
            assert abs(lat - clat) <= lat_err and abs(lon - clon) <= lon_err
