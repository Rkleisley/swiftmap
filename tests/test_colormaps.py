"""
Data-driven styling: color_col / radius_col as universal style kwargs.

The mapping itself is dependency-free (anchor ramps, no matplotlib -- nothing can be
installed on the network this runs on), and the results ride binary buffers beside the
coordinates: u8 RGBA under "<id>::colors", f32 pixels under "<id>::radii". Vectors take
the cheaper road -- each line/polygon is its own config entry, so a data-driven colour
is a per-feature config override.
"""
import warnings

import numpy as np
import pandas as pd
import pytest

from swiftmap import Map
from swiftmap._colormaps import COLORMAPS, map_colors, map_radii
from swiftmap._warnings import SwiftMapWarning


def rgba(hexcode):
    v = hexcode.lstrip("#")
    return [int(v[i:i + 2], 16) for i in (0, 2, 4)] + [255]


# --- the mapping ----------------------------------------------------------------------
def test_numeric_values_span_the_ramp():
    out = map_colors([0.0, 10.0], "viridis")
    assert out.shape == (2, 4)
    assert out[0].tolist() == rgba(COLORMAPS["viridis"][0])
    assert out[1].tolist() == rgba(COLORMAPS["viridis"][-1])


def test_vmin_vmax_clamp_rather_than_rescale():
    out = map_colors([-5.0, 0.0, 100.0], "viridis", vmin=0.0, vmax=1.0)
    assert out[0].tolist() == out[1].tolist() == rgba(COLORMAPS["viridis"][0])
    assert out[2].tolist() == rgba(COLORMAPS["viridis"][-1])


def test_bins_make_discrete_classes():
    out = map_colors([1, 1.9, 5, 50], "viridis", bins=[2, 10])
    assert out[0].tolist() == out[1].tolist(), "same bin, same colour"
    assert out[1].tolist() != out[2].tolist() != out[3].tolist()


def test_missing_values_take_the_fallback():
    out = map_colors([1.0, float("nan"), 2.0], "viridis", fallback="#123456")
    assert out[1].tolist() == rgba("#123456")


def test_categories_get_distinct_stable_colours():
    out = map_colors(["a", "b", "a", "c"])
    assert out[0].tolist() == out[2].tolist(), "same category, same colour"
    assert out[0].tolist() != out[1].tolist() != out[3].tolist()


def test_a_sequential_map_spreads_over_categories_when_named():
    out = map_colors(["low", "high"], "viridis")
    assert {tuple(out[0]), tuple(out[1])} == {
        tuple(rgba(COLORMAPS["viridis"][0])), tuple(rgba(COLORMAPS["viridis"][-1]))}


def test_an_unknown_colormap_warns_and_falls_back():
    with pytest.warns(SwiftMapWarning, match="Unknown colormap"):
        out = map_colors([0.0, 1.0], "sunburst9000")
    assert out[1].tolist() == rgba(COLORMAPS["viridis"][-1])


def test_radii_scale_by_area():
    out = map_radii([0.0, 25.0, 100.0], radius_range=(2.0, 10.0))
    assert out.dtype == np.float32
    assert out[0] == pytest.approx(2.0)
    assert out[2] == pytest.approx(10.0)
    # sqrt scaling: a quarter of the value is half of the radius span.
    assert out[1] == pytest.approx(2.0 + 0.5 * 8.0)


# --- through the builders -------------------------------------------------------------
def frame():
    return pd.DataFrame({
        "lat": [36.00, 36.01, 36.02, 36.03],
        "lon": [-5.30, -5.29, -5.28, -5.27],
        "speed": [0.0, 5.0, 5.0, 10.0],
        "kind": ["cargo", "tanker", "cargo", "ferry"],
    })


def test_color_col_and_radius_col_ride_buffers():
    m = Map()
    m.add_circle_markers(frame(), name="Ships", color_col="speed", radius_col="speed")
    layer = m.layers[-1]
    colors = np.frombuffer(
        m.coordinate_buffers[f"{layer.id}::colors"], dtype=np.uint8).reshape(-1, 4)
    radii = np.frombuffer(
        m.coordinate_buffers[f"{layer.id}::radii"], dtype=np.float32)
    assert colors[0].tolist() == rgba(COLORMAPS["viridis"][0])
    assert colors[3].tolist() == rgba(COLORMAPS["viridis"][-1])
    assert radii[0] == pytest.approx(3.0) and radii[3] == pytest.approx(18.0)
    assert layer.feature_styles is None, "no per-feature style dicts in the JSON"


def test_grouped_points_slice_their_own_colors():
    m = Map()
    m.add_circle_markers(frame(), name="Ships", layer_group=["Fleet", "kind"],
                         color_col="speed")
    by_name = {}
    for l in m.layers:
        if l.get("type") == "circle_markers":
            by_name[l.layer_group] = np.frombuffer(
                m.coordinate_buffers[f"{l.id}::colors"], dtype=np.uint8).reshape(-1, 4)
    assert len(by_name["Fleet/cargo"]) == 2
    assert by_name["Fleet/ferry"][0].tolist() == rgba(COLORMAPS["viridis"][-1])


def test_categorical_color_col_on_lines_overrides_stroke():
    df = pd.DataFrame({
        "lat": [10.0, 11.0, 20.0, 21.0],
        "lon": [30.0, 31.0, 40.0, 41.0],
        "track_id": ["T1", "T1", "T2", "T2"],
    })
    m = Map()
    m.add_polyline(df, line_id_col="track_id", name="Tracks", color_col="track_id")
    lines = [l for l in m.layers if l.get("type") == "polyline"]
    assert len(lines) == 2
    assert lines[0].color != lines[1].color
    assert all(l.color.startswith("#") for l in lines)


def test_color_col_on_polygons_drives_the_fill_not_the_border():
    df = pd.DataFrame({
        "zone": ["A", "B"],
        "value": [1.0, 9.0],
        "wkt": ["POLYGON ((0 0, 1 0, 1 1, 0 0))", "POLYGON ((5 5, 6 5, 6 6, 5 5))"],
    })
    m = Map()
    m.add_polygon(df, name="zone", color_col="value", color="#000000")
    polys = [l for l in m.layers if l.get("type") == "polygon"]
    assert polys[0].fillColor != polys[1].fillColor
    assert polys[0].color == polys[1].color == "#000000"


# --- the honest warnings --------------------------------------------------------------
def test_radius_col_on_a_line_warns_and_changes_nothing():
    df = pd.DataFrame({"lat": [1.0, 2.0], "lon": [3.0, 4.0]})
    m = Map()
    with pytest.warns(SwiftMapWarning, match="'radius_col' does not apply to polyline"):
        m.add_polyline(df, name="L", radius_col="lat")


def test_a_ramp_option_without_color_col_warns():
    m = Map()
    with pytest.warns(SwiftMapWarning, match="do nothing without 'color_col'"):
        m.add_circle_markers(frame(), name="Ships", colormap="viridis")


def test_a_missing_column_warns_and_leaves_colours_alone():
    m = Map()
    with pytest.warns(SwiftMapWarning, match="not a column of the parsed data"):
        m.add_circle_markers(frame(), name="Ships", color_col="nope")
    layer = m.layers[-1]
    assert f"{layer.id}::colors" not in m.coordinate_buffers


def test_data_options_are_not_mistaken_for_typos(recwarn):
    m = Map()
    m.add_circle_markers(frame(), name="Ships", color_col="speed",
                         colormap="plasma", vmin=0, vmax=10,
                         radius_col="speed", radius_range=(2, 12))
    assert [w for w in recwarn if issubclass(w.category, SwiftMapWarning)] == []
