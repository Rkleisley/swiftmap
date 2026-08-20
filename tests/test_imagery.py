"""
add_imagery: rasterio warps into the map's CRS, pixels become a PNG buffer on
the binary transport, and the config is the same pure data a plain-JS consumer
would write by hand.
"""
import struct
import warnings
import zlib

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds

import swiftmap
from swiftmap._colormaps import _ramp, _sample, DEFAULT_COLORMAP
from swiftmap._warnings import SwiftMapWarning

BOUNDS = (-5.35, 35.90, -5.25, 36.00)   # west, south, east, north


def quiet_map(**kw):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        return swiftmap.Map(**kw)


def geotiff(array, bounds=BOUNDS, crs="EPSG:4326", nodata=None):
    """(bands, h, w) -> an in-memory GeoTIFF; keep the MemoryFile alive."""
    count, h, w = array.shape
    mem = MemoryFile()
    with mem.open(driver="GTiff", width=w, height=h, count=count,
                  dtype=array.dtype, crs=crs,
                  transform=from_bounds(*bounds, w, h), nodata=nodata) as ds:
        ds.write(array)
    return mem


def decode_png(data):
    """Our own filter-0 PNGs back to an (h, w, 4) uint8 array."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "PNG magic"
    w, h = struct.unpack(">II", data[16:24])
    idat, off = b"", 8
    while off < len(data):
        (length,) = struct.unpack(">I", data[off:off + 4])
        if data[off + 4:off + 8] == b"IDAT":
            idat += data[off + 8:off + 8 + length]
        off += 12 + length
    raw = zlib.decompress(idat)
    stride = w * 4
    px = np.empty((h, w, 4), np.uint8)
    for y in range(h):
        row = raw[y * (stride + 1):(y + 1) * (stride + 1)]
        assert row[0] == 0, "filter 0 scanlines"
        px[y] = np.frombuffer(row[1:], np.uint8).reshape(w, 4)
    return px


def _image_layer(m):
    return next(l for l in m.layers if l.get("type") == "image")


def _png_of(m, layer):
    return bytes(m.coordinate_buffers[layer["id"]])


def test_rgb_uint8_pixels_pass_through():
    arr = np.zeros((3, 4, 6), dtype=np.uint8)
    arr[0], arr[1], arr[2] = 10, 200, 30
    mem = geotiff(arr)
    # Same CRS as the source: an identity warp, so pixels survive exactly.
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    m.add_imagery(mem.name, name="Scene")
    layer = _image_layer(m)
    px = decode_png(_png_of(m, layer))
    assert px.shape == (4, 6, 4)
    assert (px[..., 0] == 10).all() and (px[..., 1] == 200).all() \
        and (px[..., 2] == 30).all()
    assert (px[..., 3] == 255).all()


def test_bounds_land_in_the_config_as_latlon():
    mem = geotiff(np.full((1, 4, 4), 7, dtype=np.uint8))
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    m.add_imagery(mem.name, name="B")
    (south, west), (north, east) = _image_layer(m)["bounds"]
    assert south == pytest.approx(BOUNDS[1], abs=1e-6)
    assert west == pytest.approx(BOUNDS[0], abs=1e-6)
    assert north == pytest.approx(BOUNDS[3], abs=1e-6)
    assert east == pytest.approx(BOUNDS[2], abs=1e-6)


def test_warp_to_mercator_keeps_latlon_bounds():
    # A 3857 map warps the grid but the config's corner box stays lat/lon.
    mem = geotiff(np.full((1, 8, 8), 3, dtype=np.uint8))
    m = quiet_map(center=[35.95, -5.3], zoom=10)   # EPSG:3857 default
    assert m.crs == "EPSG:3857"
    m.add_imagery(mem.name, name="W")
    (south, west), (north, east) = _image_layer(m)["bounds"]
    # The warped grid snaps bounds to its own pixel edges (~0.0125 deg at
    # 8 px over 0.1 deg), so the box matches to a pixel, not exactly.
    assert south == pytest.approx(BOUNDS[1], abs=0.03)
    assert north == pytest.approx(BOUNDS[3], abs=0.03)
    assert west == pytest.approx(BOUNDS[0], abs=0.03)
    assert east == pytest.approx(BOUNDS[2], abs=0.03)
    assert south < north and west < east


def test_single_band_ramps_and_nodata_goes_transparent():
    arr = np.array([[[0.0, 50.0], [100.0, -999.0]]])
    mem = geotiff(arr.astype(np.float64), nodata=-999.0)
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    m.add_imagery(mem.name, name="Elev", colormap="viridis")
    px = decode_png(_png_of(m, _image_layer(m)))
    ramp = _ramp("viridis")
    lo = np.clip(_sample(ramp, np.array([0.0])), 0, 255).astype(np.uint8)[0]
    hi = np.clip(_sample(ramp, np.array([1.0])), 0, 255).astype(np.uint8)[0]
    assert list(px[0, 0, :3]) == list(lo), "band minimum takes the ramp's start"
    assert list(px[1, 0, :3]) == list(hi), "band maximum takes the ramp's end"
    assert px[1, 1, 3] == 0, "nodata is transparent"
    assert px[0, 0, 3] == 255 and px[1, 0, 3] == 255


def test_vmin_vmax_override_the_bands_extremes():
    arr = np.array([[[50.0]]])
    mem = geotiff(arr.astype(np.float64))
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    m.add_imagery(mem.name, name="Mid", colormap="viridis", vmin=0, vmax=100)
    px = decode_png(_png_of(m, _image_layer(m)))
    ramp = _ramp("viridis")
    mid = np.clip(_sample(ramp, np.array([0.5])), 0, 255).astype(np.uint8)[0]
    assert list(px[0, 0, :3]) == list(mid)


def test_large_rasters_downsample_to_max_size():
    mem = geotiff(np.full((1, 50, 100), 5, dtype=np.uint8))
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    m.add_imagery(mem.name, name="Big", max_size=32)
    px = decode_png(_png_of(m, _image_layer(m)))
    assert px.shape[1] == 32 and px.shape[0] == 16


def test_colormap_on_rgb_warns_and_is_ignored():
    mem = geotiff(np.full((3, 2, 2), 9, dtype=np.uint8))
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    with pytest.warns(SwiftMapWarning, match="single-band"):
        m.add_imagery(mem.name, name="RGB", colormap="turbo")


def test_bad_resampling_warns_and_falls_back():
    mem = geotiff(np.full((1, 2, 2), 1, dtype=np.uint8))
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    with pytest.warns(SwiftMapWarning, match="resampling"):
        m.add_imagery(mem.name, name="R", resampling="fancy")
    assert _image_layer(m) is not None


def test_removing_the_layer_removes_its_png_buffer():
    mem = geotiff(np.full((1, 2, 2), 1, dtype=np.uint8))
    m = quiet_map(center=[35.95, -5.3], zoom=10, crs="EPSG:4326")
    m.add_imagery(mem.name, name="Gone")
    layer_id = _image_layer(m)["id"]
    assert layer_id in m.coordinate_buffers
    m.remove_layer("Gone")
    assert layer_id not in m.coordinate_buffers
