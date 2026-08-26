"""
Column-driven naming and folder paths, across every layer type.

`name="site"` takes each feature's `site` property as its layer name, and
`layer_group=["Sites", "zone"]` builds a folder path per feature. Markers implemented this
from the start; lines and polygons took the same strings as literals, so one
`add_collection` call produced half-resolved output.
"""
import warnings

import pytest

from geometry import A, B, C, LINE, RING, gj_feature, gj_collection, lonlat

from ipywidgets.widgets.widget import Widget
Widget.on_widget_constructed(None)
from swiftmap import Map  # noqa: E402


@pytest.fixture(autouse=True)
def _quiet():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        yield


@pytest.fixture
def mixed():
    """One feature of each kind, each carrying a distinct `site` and `zone`."""
    return gj_collection(
        gj_feature("Point", [A[1], A[0]], {"site": "Alpha", "zone": "North"}),
        gj_feature("LineString", lonlat(LINE), {"site": "Charlie", "zone": "North"}),
        gj_feature("Polygon", [lonlat(RING)], {"site": "Delta", "zone": "South"}),
    )


def entries(m, start):
    """Flattens added layers into (type, name, layer_group), expanding merged groups."""
    out = []
    for layer in m.layers[start:]:
        if layer.get("type") == "group":
            out.extend((s.get("type"), s.get("name"), layer.get("layer_group"))
                       for s in (layer.get("layers") or []))
        else:
            out.append((layer.get("type"), layer.get("name"), layer.get("layer_group")))
    return sorted(out)


# --- per layer type ---------------------------------------------------------------
@pytest.mark.parametrize("method,geom,expected_name", [
    ("add_markers", "Point", "Alpha"),
    ("add_circle_markers", "Point", "Alpha"),
    ("add_polyline", "LineString", "Charlie"),
    ("add_polygon", "Polygon", "Delta"),
])
def test_name_resolves_from_feature_properties(mixed, method, geom, expected_name):
    m = Map()
    start = len(m.layers)
    getattr(m, method)(mixed, name="site")
    names = [name for _t, name, _g in entries(m, start)]
    assert names == [expected_name], f"{method} should name the layer from the 'site' property"


@pytest.mark.parametrize("method,expected_group", [
    ("add_markers", "Sites/North"),
    ("add_polyline", "Sites/North"),
    ("add_polygon", "Sites/South"),
])
def test_layer_group_resolves_from_feature_properties(mixed, method, expected_group):
    m = Map()
    start = len(m.layers)
    getattr(m, method)(mixed, name="site", layer_group=["Sites", "zone"])
    groups = [group for _t, _n, group in entries(m, start)]
    assert groups == [expected_group], f"{method} should resolve 'zone' from properties"


# --- through add_collection -------------------------------------------------------
def test_collection_resolves_every_kind_consistently(mixed):
    """
    The regression this guards: markers resolved while lines and polygons stayed literal,
    so a single call produced 'Alpha' under 'Sites/North' beside 'site' under 'Sites/zone'.
    """
    m = Map()
    start = len(m.layers)
    m.add_collection(mixed, name="site", layer_group=["Sites", "zone"])
    assert entries(m, start) == [
        ("circle_markers", "Alpha", "Sites/North"),
        ("polygon", "Delta", "Sites/South"),
        ("polyline", "Charlie", "Sites/North"),
    ]


def test_collection_with_geostructures_properties():
    pytest.importorskip("geostructures")
    from geostructures import Coordinate, GeoPoint, GeoLineString, GeoPolygon
    from geostructures.collections import FeatureCollection

    def gs(pt):
        return Coordinate(pt[1], pt[0])

    fc = FeatureCollection([
        GeoPoint(gs(A), properties={"site": "Alpha", "zone": "North"}),
        GeoLineString([gs(A), gs(B)], properties={"site": "Charlie", "zone": "North"}),
        GeoPolygon([gs(A), gs(C), gs(B), gs(A)], properties={"site": "Delta", "zone": "South"}),
    ])
    m = Map()
    start = len(m.layers)
    m.add_collection(fc, name="site", layer_group=["Sites", "zone"])
    assert entries(m, start) == [
        ("circle_markers", "Alpha", "Sites/North"),
        ("polygon", "Delta", "Sites/South"),
        ("polyline", "Charlie", "Sites/North"),
    ]


# --- literals keep working --------------------------------------------------------
def test_literal_name_and_group_are_not_treated_as_columns(mixed):
    m = Map()
    start = len(m.layers)
    m.add_collection(mixed, name="Survey", layer_group="Field Data")
    for _type, name, group in entries(m, start):
        assert name == "Survey"
        assert group == "Field Data"


def test_literal_name_fans_merge_into_one_entry():
    """One literal name for a whole fan is ONE sidebar entry holding every
    feature -- the 20k-WKT report: numbered suffixes made 20k entries."""
    fc = gj_collection(
        gj_feature("LineString", lonlat(LINE)),
        gj_feature("LineString", lonlat([B, C])),
    )
    m = Map()
    start = len(m.layers)
    m.add_polyline(fc, name="Route")
    assert [(t, n) for t, n, _g in entries(m, start)] == [
        ("polyline", "Route"), ("polyline", "Route")]
    assert [l.get("type") for l in m.layers[start:]] == ["group"]


def test_mixed_literal_and_column_parts_in_one_path(mixed):
    """'Sites' is a literal folder, 'zone' resolves per feature."""
    m = Map()
    start = len(m.layers)
    m.add_polygon(mixed, name="site", layer_group=["Sites", "zone", "Zones"])
    assert entries(m, start) == [("polygon", "Delta", "Sites/South/Zones")]


def test_name_falling_back_to_a_name_property(mixed):
    """With no `name` given, a feature carrying a 'name' property uses it."""
    fc = gj_collection(gj_feature("Polygon", [lonlat(RING)], {"name": "Harbour"}))
    m = Map()
    start = len(m.layers)
    m.add_polygon(fc)
    assert [n for _t, n, _g in entries(m, start)] == ["Harbour"]
