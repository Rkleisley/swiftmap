"""
Per-feature styling: a `style` property drives appearance, `static_style` overrides it.

The same resolution applies to every add_* method, so one data frame carrying a style
column colours points, lines and polygons alike without per-call styling code.
"""
import warnings

import pytest

from geometry import A, B, C, LINE, RING, gj_feature, gj_collection, lonlat

from ipywidgets.widgets.widget import Widget
Widget.on_widget_constructed(None)
from swiftmap import Map  # noqa: E402
from swiftmap._warnings import SwiftMapWarning  # noqa: E402

pd = pytest.importorskip("pandas")


@pytest.fixture(autouse=True)
def _quiet():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        yield


def points_df(styles=None):
    data = {"lat": [A[0], B[0], C[0]], "lon": [A[1], B[1], C[1]],
            "kind": ["city", "town", "city"]}
    if styles is not None:
        data["style"] = styles
    return pd.DataFrame(data)


def last(m):
    return m.layers[-1]


# --- precedence -------------------------------------------------------------------
def test_bare_colour_strings_become_per_feature_styles():
    m = Map()
    m.add_markers(points_df(["red", "blue", "red"]), name="X")
    assert last(m).get("feature_styles") == [
        {"color": "red"}, {"color": "blue"}, {"color": "red"}]


def test_dict_styles_carry_every_option():
    m = Map()
    m.add_markers(points_df([{"color": "red", "weight": 5}, {"color": "blue"},
                             {"color": "red", "weight": 5}]), name="X")
    styles = last(m).get("feature_styles")
    assert styles[0] == {"color": "red", "weight": 5}
    assert styles[1] == {"color": "blue"}


def test_static_style_overrides_the_data():
    m = Map()
    m.add_markers(points_df(["red", "blue", "red"]), name="X",
                  static_style={"color": "green"})
    layer = last(m)
    assert layer.get("color") == "green"
    assert layer.get("feature_styles") is None, "a static style makes the layer uniform"


def test_explicit_option_outranks_the_style_column():
    m = Map()
    m.add_markers(points_df(["red", "blue", "red"]), name="X", color="purple")
    layer = last(m)
    assert layer.get("color") == "purple"
    assert layer.get("feature_styles") is None


def test_uniform_style_column_collapses_to_the_layer():
    """One value everywhere is a uniform layer, so it costs nothing on the wire."""
    m = Map()
    m.add_markers(points_df(["red", "red", "red"]), name="X")
    layer = last(m)
    assert layer.get("color") == "red"
    assert layer.get("feature_styles") is None


def test_no_style_column_keeps_the_previous_behaviour():
    m = Map()
    m.add_markers(points_df(), name="X", color="purple")
    assert last(m).get("color") == "purple"
    assert last(m).get("feature_styles") is None


# --- across layer types -----------------------------------------------------------
def styled_collection():
    return gj_collection(
        gj_feature("Point", [A[1], A[0]], {"style": "red"}),
        gj_feature("Point", [B[1], B[0]], {"style": "blue"}),
    )


def test_points_style_from_geojson_properties():
    m = Map()
    m.add_markers(styled_collection(), name="X")
    assert last(m).get("feature_styles") == [{"color": "red"}, {"color": "blue"}]


def test_lines_take_their_own_style_per_feature():
    fc = gj_collection(
        gj_feature("LineString", lonlat(LINE), {"style": "red"}),
        gj_feature("LineString", lonlat([B, C]), {"style": {"color": "blue", "weight": 8}}),
    )
    m = Map()
    start = len(m.layers)
    m.add_polyline(fc, name="Route")
    added = m.layers[start:]
    colors = sorted(l.get("color") for l in added)
    assert colors == ["blue", "red"], "each line keeps its own colour"
    blue = next(l for l in added if l.get("color") == "blue")
    assert blue.get("weight") == 8


def test_polygons_take_their_own_style_per_feature():
    fc = gj_collection(
        gj_feature("Polygon", [lonlat(RING)], {"style": {"color": "red", "fill_opacity": 0.5}}),
        gj_feature("Polygon", [lonlat([B, C, A, B])], {"style": "blue"}),
    )
    m = Map()
    start = len(m.layers)
    m.add_polygon(fc, name="Zone")
    added = m.layers[start:]
    assert sorted(l.get("color") for l in added) == ["blue", "red"]
    red = next(l for l in added if l.get("color") == "red")
    assert red.get("fillOpacity") == 0.5


def test_collection_applies_styles_to_every_geometry_kind():
    fc = gj_collection(
        gj_feature("Point", [A[1], A[0]], {"style": "red"}),
        gj_feature("LineString", lonlat(LINE), {"style": "green"}),
        gj_feature("Polygon", [lonlat(RING)], {"style": "blue"}),
    )
    m = Map()
    start = len(m.layers)
    m.add_collection(fc, name="Survey")
    colours = []
    for layer in m.layers[start:]:
        if layer.get("type") == "group":
            colours.extend(s.get("color") for s in (layer.get("layers") or []))
        else:
            colours.append(layer.get("color"))
    assert sorted(colours) == ["blue", "green", "red"]


# --- key spellings ----------------------------------------------------------------
@pytest.mark.parametrize("key,expected_key", [
    ("fill_color", "fillColor"),
    ("fillColor", "fillColor"),
    ("fill_opacity", "fillOpacity"),
    ("fillOpacity", "fillOpacity"),
])
def test_camel_and_snake_spellings_both_work(key, expected_key):
    m = Map()
    m.add_polygon([list(A), list(C), list(B)], name="Z", **{key: 0.7 if "opacity" in key else "red"})
    assert last(m).get(expected_key) == (0.7 if "opacity" in key else "red")


def test_style_dict_accepts_either_spelling():
    fc = gj_collection(gj_feature("Polygon", [lonlat(RING)],
                                  {"style": {"fillColor": "red", "fill_opacity": 0.9}}))
    m = Map()
    m.add_polygon(fc, name="Z")
    layer = last(m)
    assert layer.get("fillColor") == "red"
    assert layer.get("fillOpacity") == 0.9


# --- misspelling guard ------------------------------------------------------------
@pytest.mark.parametrize("typo,suggestion", [
    ("colour", "color"),
    ("wieght", "weight"),
    ("fill_colour", "fill_color"),
])
def test_near_miss_options_are_reported(typo, suggestion):
    """
    Unknown keys pass through to the layer on purpose, so a misspelled style is accepted
    and then ignored by the renderer -- wrong output with no signal unless we say so.
    """
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Map().add_markers(points_df(), name="X", **{typo: "red"})
    messages = [str(w.message) for w in caught if issubclass(w.category, SwiftMapWarning)]
    assert any(typo in msg and suggestion in msg for msg in messages), messages


def test_unrelated_metadata_passes_without_a_warning():
    """Arbitrary keys are forwarded deliberately; only near misses are worth reporting."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        m = Map()
        m.add_markers(points_df(), name="X", title="Site A", draggable=False)
    assert not [w for w in caught if issubclass(w.category, SwiftMapWarning)]
    assert last(m).get("title") == "Site A"
