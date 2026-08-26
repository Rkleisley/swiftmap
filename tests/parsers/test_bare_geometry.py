"""
Bare geometry inputs: WKT strings, shapely geometries, lists of them.

The JS model accepted these first (addPolygon takes "POLYGON ((...))"
directly); Python required a table column or a GeoSeries, and the asymmetry
was the gap. One coercion at the parser front door closes it.
"""
import pytest

from swiftmap import Map

shapely = pytest.importorskip("shapely")
import shapely.wkt  # noqa: E402

WKT_HOLE = ("POLYGON ((-5.3 36.0, -5.1 36.0, -5.1 36.2, -5.3 36.2, -5.3 36.0), "
            "(-5.25 36.05, -5.15 36.05, -5.15 36.15, -5.25 36.05))")
WKT_ML = "MULTILINESTRING ((-5.3 36.0, -5.2 36.1), (-5.1 36.0, -5.0 36.1))"


def test_a_bare_wkt_string_is_its_own_geometry():
    m = Map()
    m.add_polygon(WKT_HOLE, name="Zone")
    layer = m.find_layers("Zone")[0]
    assert layer.get("rings") == [[5, 4]], "the hole survives"
    m.add_line(WKT_ML, name="Route")
    assert m.find_layers("Route")[0].get("parts") == [2, 2]


def test_a_bare_shapely_geometry_reads_directly():
    m = Map()
    m.add_polygon(shapely.wkt.loads(WKT_HOLE), name="Zone")
    assert m.find_layers("Zone")[0].get("rings") == [[5, 4]]
    m.add_line(shapely.wkt.loads(WKT_ML), name="Route")
    assert m.find_layers("Route")[0].get("parts") == [2, 2]


def test_a_list_of_shapely_geometries_fans_like_features():
    m = Map()
    m.add_polygon([shapely.wkt.loads("POLYGON ((-5.3 36.0, -5.2 36.0, -5.2 36.1, -5.3 36.0))"),
                   shapely.wkt.loads("POLYGON ((-5.1 36.0, -5.0 36.0, -5.0 36.1, -5.1 36.0))")],
                  name="Cells")
    entry = next(l for l in m.layers if l.get("name") == "Cells")
    assert entry.get("type") == "group"
    assert len(m.find_layers(types="polygon")) == 2
