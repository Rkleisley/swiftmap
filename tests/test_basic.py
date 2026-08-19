import pytest
from swiftmap import Map
from swiftmap._warnings import EmptyLayerWarning
import pandas as pd
import numpy as np

def vector_coords(m, layer):
    """A vector layer's coordinates live in its binary buffer, never in the config."""
    assert getattr(layer, "locations", None) is None
    raw = m.coordinate_buffers[layer.id]
    return np.frombuffer(raw, dtype=np.float64).reshape(-1, 2).tolist()

def test_map_initialization():
    m = Map(center=[34.05, -118.24], zoom=10)
    assert m.center == [34.05, -118.24]
    assert m.zoom == 10
    assert m.show_logo is True
    assert m.show_legend is False

def test_height_reaches_both_the_trait_and_the_widget_layout():
    # Map(height=...) was accepted and documented while wired to nothing -- the
    # radius disease. It now sizes the synced trait (the frontend applies it and
    # drops the 400px floor) and the outer ipywidgets element.
    m = Map(height="600px")
    assert m.height == "600px"
    assert m.layout.height == "600px"
    plain = Map()
    assert plain.height == "" and plain.layout.height is None


def test_every_constructor_flag_round_trips_through_get_state():
    # show_legend was assigned in __init__ and read by export like every other flag,
    # but never DECLARED as a synced trait -- so the frontend saw undefined and the
    # legend could never switch on, while every Python-side read worked. The only
    # difference from show_logo was the declaration line, so this pins the round
    # trip for each constructor flag.
    m = Map(center=[10.0, 20.0], zoom=7, show_legend=True, show_logo=False,
            show_click_coordinates=True, height="500px", crs="EPSG:4326",
            auto_sync=False)
    state = m.get_state()
    for name, value in [("center", [10.0, 20.0]), ("zoom", 7),
                        ("show_legend", True), ("show_logo", False),
                        ("show_click_coordinates", True),
                        ("height", "500px"), ("crs", "EPSG:4326"),
                        ("auto_sync", False)]:
        assert name in state, f"{name} is not a synced trait -- the frontend never sees it"
        assert state[name] == value, f"{name} did not round-trip"


def test_click_seq_starts_at_zero():
    # The frontend bumps it on every click; observing this one trait catches
    # repeat clicks that change neither clicked_layer_id nor selected_index.
    assert Map().click_seq == 0


def test_click_location_traits_default_empty_and_off():
    m = Map()
    assert m.clicked_latlng == []
    assert m.show_click_coordinates is False


def test_chaining():
    m = Map()
    returned_m = m.add_basemap("OpenStreetMap")
    assert returned_m is m

def test_add_markers_df():
    df = pd.DataFrame({"lat": [10.0, 20.0], "lon": [30.0, 40.0], "name": ["A", "B"]})
    m = Map()
    m.add_markers(df, name="My Markers")
    assert len(m.layers) > 2
    layer = m.layers[-1]
    assert layer.name == "My Markers"
    assert layer.type == "markers"
    assert layer.visible is True
    assert layer.id in m.coordinate_buffers
    buffer_bytes = m.coordinate_buffers[layer.id]
    coords = np.frombuffer(buffer_bytes, dtype=np.float64)
    assert len(coords) == 4
    assert coords[0] == 10.0
    assert coords[1] == 30.0

def test_add_circle_markers():
    df = pd.DataFrame({"lat": [10.0, 20.0], "lon": [30.0, 40.0]})
    m = Map()
    m.add_circle_markers(df, radius=7, color="red", name="My Circles")
    layer = m.layers[-1]
    assert layer.name == "My Circles"
    assert layer.type == "circle_markers"
    assert layer.radius == 7
    assert layer.color == "red"

def test_add_geojson():
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [30.0, 10.0]},
                "properties": {"prop0": "value0"}
            }
        ]
    }
    m = Map()
    m.add_geojson(data, name="test_geojson")
    layer = m.layers[-1]
    assert layer.name == "test_geojson"
    # Collection-style adds render points as circle markers: cheaper than the pin shader
    # when a feature collection carries many of them.
    assert layer.type == "circle_markers"
    assert layer.id in m.coordinate_buffers

def test_add_polyline_and_polygon():
    m = Map()
    m.add_polyline([[10, 20], [30, 40]], name="My Polyline")
    layer1 = m.layers[-1]
    assert layer1.name == "My Polyline"
    assert layer1.type == "polyline"
    assert vector_coords(m, layer1) == [[10, 20], [30, 40]]

    m.add_polygon([[10, 20], [30, 40], [50, 60]], name="My Polygon")
    layer2 = m.layers[-1]
    assert layer2.name == "My Polygon"
    assert layer2.type == "polygon"
    assert vector_coords(m, layer2) == [[10, 20], [30, 40], [50, 60], [10, 20]]

def test_parse_lines_geojson_and_df():
    geojson_line = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-118.24, 34.05], [-122.41, 37.77]]
            },
            "properties": {"route": "LA to SF"}
        }]
    }
    m = Map()
    m.add_polyline(geojson_line, name="California Route")
    layer = m.layers[-1]
    assert layer.type == "polyline"
    assert vector_coords(m, layer) == [[34.05, -118.24], [37.77, -122.41]]

    df_track = pd.DataFrame({
        "lat": [10.0, 11.0, 20.0, 21.0],
        "lon": [30.0, 31.0, 40.0, 41.0],
        "track_id": ["T1", "T1", "T2", "T2"]
    })
    m2 = Map()
    m2.add_polyline(df_track, name="Track")
    polyline_layers = [l for l in m2.layers if l.type == "polyline"]
    assert len(polyline_layers) == 2

def test_geopandas_points_and_lines():
    try:
        import geopandas as gpd
        from shapely.geometry import Point, LineString
    except ImportError:
        return

    gdf_points = gpd.GeoDataFrame(
        {"city": ["LA", "SF"]},
        geometry=[Point(-118.24, 34.05), Point(-122.41, 37.77)]
    )
    m = Map()
    m.add_markers(gdf_points, name="GPD Cities")
    layer = m.layers[-1]
    assert layer.name == "GPD Cities"
    assert layer.type == "markers"
    assert layer.id in m.coordinate_buffers

    gdf_lines = gpd.GeoDataFrame(
        {"route": ["Route 1"]},
        geometry=[LineString([(-118.24, 34.05), (-122.41, 37.77)])]
    )
    m2 = Map()
    m2.add_polyline(gdf_lines, name="GPD Route")
    layer2 = m2.layers[-1]
    assert layer2.type == "polyline"
    assert vector_coords(m2, layer2) == [[34.05, -118.24], [37.77, -122.41]]

def test_add_line_patterns():
    # 1. WKT string column test
    df_wkt = pd.DataFrame({
        "route_name": ["Pacific Highway"],
        "wkt": ["LINESTRING (-118.24 34.05, -122.41 37.77)"]
    })
    m = Map()
    m.add_line(df_wkt, name="WKT Line")
    layer = m.layers[-1]
    assert layer.type == "polyline"
    assert vector_coords(m, layer) == [[34.05, -118.24], [37.77, -122.41]]

    # 2. Wide vertex columns test (lat1, lon1, lat2, lon2)
    df_wide = pd.DataFrame({
        "lat1": [34.05], "lon1": [-118.24],
        "lat2": [37.77], "lon2": [-122.41]
    })
    m2 = Map()
    m2.add_line(df_wide, name="Wide Line")
    layer2 = m2.layers[-1]
    assert layer2.type == "polyline"
    assert vector_coords(m2, layer2) == [[34.05, -118.24], [37.77, -122.41]]

    # 3. Explicit coord_order test
    df_order = pd.DataFrame({
        "coords": ["-118.24, 34.05; -122.41, 37.77"]
    })
    m3 = Map()
    m3.add_line(df_order, coord_order="lon_lat", name="Explicit LonLat")
    layer3 = m3.layers[-1]
    assert vector_coords(m3, layer3) == [[34.05, -118.24], [37.77, -122.41]]

def test_wkt_in_an_arbitrarily_named_column_via_the_id_col():
    # The name-guess only knows columns like 'wkt' and 'geometry'. Pointing shape_id_col
    # or line_id_col at the column is how a caller names one the guess would miss: WKT
    # values are unambiguous -- no real id column holds "POLYGON ((..." -- so the id
    # param doubles as the geometry pointer, one shape per row, no grouping.
    df = pd.DataFrame({
        "zone": ["A"],
        "boundary": ["POLYGON ((-118.24 34.05, -118.20 34.05, -118.20 34.10, -118.24 34.05))"],
    })
    m = Map()
    m.add_polygon(df, shape_id_col="boundary", name="Zones")
    layer = m.layers[-1]
    assert layer.type == "polygon"
    assert len(vector_coords(m, layer)) >= 4
    assert layer.properties["zone"] == "A"

    df_line = pd.DataFrame({
        "route": ["R1"],
        "path_wkt": ["LINESTRING (-118.24 34.05, -122.41 37.77)"],
    })
    m2 = Map()
    m2.add_line(df_line, line_id_col="path_wkt", name="Routes")
    layer2 = m2.layers[-1]
    assert layer2.type == "polyline"
    assert vector_coords(m2, layer2) == [[34.05, -118.24], [37.77, -122.41]]

def test_an_ordinary_id_column_still_groups():
    df = pd.DataFrame({
        "lat": [10.0, 11.0, 12.0, 20.0, 21.0, 22.0],
        "lon": [30.0, 31.0, 32.0, 40.0, 41.0, 42.0],
        "zone": ["Z1"] * 3 + ["Z2"] * 3,
    })
    m = Map()
    m.add_polygon(df, shape_id_col="zone", name="Zones")
    assert len([l for l in m.layers if l.type == "polygon"]) == 2

def test_wkt_of_the_wrong_kind_via_the_id_col_adds_nothing():
    df = pd.DataFrame({"g": ["LINESTRING (-118.24 34.05, -122.41 37.77)"]})
    m = Map()
    with pytest.warns(EmptyLayerWarning):
        m.add_polygon(df, shape_id_col="g", name="Zones")

def test_polygon_holes_and_multipolygons_survive():
    # A WKT hole: one layer whose flat buffer holds both rings, with a `rings` table
    # ([[outer, hole]]) for the renderer to slice by. The hole used to be regex-merged
    # into the outer boundary -- one garbled ring.
    df = pd.DataFrame({"wkt": [
        "POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 4 2, 4 4, 2 4, 2 2))"]})
    m = Map()
    m.add_polygon(df, name="Donut")
    layer = m.layers[-1]
    assert layer.rings == [[5, 5]]
    assert len(vector_coords(m, layer)) == 10

    # A MULTIPOLYGON is ONE feature and stays one layer with two parts -- it used to
    # become a layer per part (via geojson/geopandas) or one garbled ring (via WKT).
    df2 = pd.DataFrame({"wkt": [
        "MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))"]})
    m2 = Map()
    m2.add_polygon(df2, name="Archipelago")
    polys = [l for l in m2.layers if l.type == "polygon"]
    assert len(polys) == 1
    assert polys[0].rings == [[4], [4]]
    assert len(vector_coords(m2, polys[0])) == 8

    # The common hole-free ring is untouched: no rings table at all.
    m3 = Map()
    m3.add_polygon([[10, 20], [30, 40], [50, 60]], name="Simple")
    assert m3.layers[-1].rings is None

def test_geojson_polygon_holes_survive():
    gj = {"type": "Feature", "properties": {"zone": "A"}, "geometry": {
        "type": "Polygon", "coordinates": [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
        ]}}
    m = Map()
    m.add_polygon(gj, name="Donut")
    layer = m.layers[-1]
    assert layer.rings == [[5, 5]]
    assert len(vector_coords(m, layer)) == 10
    assert layer.properties["zone"] == "A"

def test_polygon_and_shapes_patterns():
    # 1. WKT Polygon test
    df_wkt = pd.DataFrame({
        "zone": ["Zone A"],
        "wkt": ["POLYGON ((-118.24 34.05, -118.20 34.05, -118.20 34.10, -118.24 34.10, -118.24 34.05))"]
    })
    m = Map()
    m.add_polygon(df_wkt, name="WKT Zone")
    layer = m.layers[-1]
    assert layer.type == "polygon"
    assert len(vector_coords(m, layer)) >= 4

    # 2. Aliases test (add_polygons, add_shape, add_shapes)
    m.add_polygons([[36.0, -5.35], [36.05, -5.30], [36.02, -5.25]], name="Poly Test")
    assert m.layers[-1].name == "Poly Test"

    m.add_shape([[36.0, -5.35], [36.05, -5.30], [36.02, -5.25]], name="Shape Test")
    assert m.layers[-1].name == "Shape Test"

    m.add_shapes([[36.0, -5.35], [36.05, -5.30], [36.02, -5.25]], name="Shapes Test")
    assert m.layers[-1].name == "Shapes Test"

    # 3. GeoPandas Polygon test
    try:
        import geopandas as gpd
        from shapely.geometry import Polygon
        gdf_poly = gpd.GeoDataFrame(
            {"zone": ["Zone 1"]},
            geometry=[Polygon([(-118.24, 34.05), (-118.20, 34.05), (-118.20, 34.10), (-118.24, 34.05)])]
        )
        m2 = Map()
        m2.add_shapes(gdf_poly, name="GPD Polygon")
        assert m2.layers[-1].type == "polygon"
    except ImportError:
        pass

def test_polars_and_dict_lines_polygons():
    import polars as pl
    df_line = pl.DataFrame({
        "track_id": [1, 1, 2, 2],
        "step": [1, 2, 1, 2],
        "lat": [34.05, 34.06, 37.77, 37.78],
        "lon": [-118.24, -118.25, -122.41, -122.42]
    })
    m = Map()
    m.add_line(df_line, line_id_col="track_id", order_col="step", name="Polars Tracks")
    assert len(m.layers) == 4
    assert m.layers[-1].type == "polyline"

    df_poly = pl.DataFrame({
        "zone": ["Zone A"],
        "wkt": ["POLYGON ((-118.24 34.05, -118.20 34.05, -118.20 34.10, -118.24 34.10, -118.24 34.05))"]
    })
    m2 = Map()
    m2.add_shapes(df_poly, name="Polars WKT Zone")
    assert m2.layers[-1].type == "polygon"

    # Dict line test
    dict_line = {"lat": [34.05, 37.77], "lon": [-118.24, -122.41]}
    m3 = Map()
    m3.add_line(dict_line, name="Dict Line")
    assert m3.layers[-1].type == "polyline"

def test_legend_and_geostructures():
    from geostructures import Coordinate, GeoPoint, GeoLineString, GeoPolygon, GeoBox, GeoCircle, GeoRing, MultiGeoPolygon
    m = Map(show_legend=True)
    c1 = Coordinate(-118.24, 34.05)
    c2 = Coordinate(-122.41, 37.77)

    point = GeoPoint(c1, properties={'name': 'LA Point', 'pop': '4M'})
    line = GeoLineString([c1, c2], properties={'name': 'Flight Route'})
    poly = GeoPolygon([c1, Coordinate(-118.20, 34.05), Coordinate(-118.20, 34.10), Coordinate(-118.24, 34.10), c1], properties={'name': 'Zone Area'})
    circle = GeoCircle(c1, radius=1000, properties={'name': 'Circle Zone'})
    box = GeoBox(c1, c2, properties={'name': 'Box Area'})
    ring = GeoRing(c1, inner_radius=500, outer_radius=1000, properties={'name': 'Ring Zone'})
    multipoly = MultiGeoPolygon([poly], properties={'name': 'Multi Zone'})

    m.add_markers([point], name="LA Point", layer_group="City Points")
    assert any(l.name == "LA Point" for l in m.layers)

    m.add_line([line], name="Flight Route", layer_group="Routes")
    assert any(l.name == "Flight Route" for l in m.layers)

    m.add_polygon([poly, circle, box, ring, multipoly], name="Geostructure Shapes", layer_group="Zones")
    assert len(m.layers) >= 4
    assert m.legend_html != ""

def test_remove_layer():
    m = Map()
    m.add_polyline([[10, 20], [30, 40]], name="Temp Layer")
    assert any(l.name == "Temp Layer" for l in m.layers)
    m.remove_layer("Temp Layer")
    assert not any(l.name == "Temp Layer" for l in m.layers)


def test_group_configs_and_multi_select():
    m = Map()
    m.add_polyline([[10, 20], [30, 40]], name="Poly 1", layer_group="Tracks", group_multi_select=True)
    m.add_polyline([[10, 20], [30, 40]], name="Poly 2", layer_group="Tracks", group_multi_select=False)
    
    # Check that layer configurations do not contain the group-level configs
    layers = m.layers
    poly1 = next(l for l in layers if l.name == "Poly 1")
    poly2 = next(l for l in layers if l.name == "Poly 2")
    assert "group_multi_select" not in poly1
    assert "group_multi_select" not in poly2
    
    # Check that the explicit False setting on Poly 2 correctly overrode the group selection
    assert m.group_configs["Tracks"]["multi_select"] is False
    m.configure_group("Tracks", multi_select=False)
    assert m.group_configs["Tracks"]["multi_select"] is False
    
    m.configure_group("Tracks", group_multi_select=True)
    assert m.group_configs["Tracks"]["multi_select"] is True

def test_add_circle():
    m = Map()
    m.add_circle(location=[36.0, -5.35], radius=500, name="Gibraltar Circle")
    assert any(l.name == "Gibraltar Circle" for l in m.layers)
    circle_layer = m.layers[-1]
    assert circle_layer.type == "circle"
    assert circle_layer.location == [36.0, -5.35]
    assert circle_layer.radius == 500

def test_markers_bounds():
    m = Map()
    # Test markers
    m.add_markers(
        data=[[10.0, 20.0], [30.0, 40.0]],
        name="Test Markers"
    )
    layer = m.layers[-1]
    assert layer.bounds == [[10.0, 20.0], [30.0, 40.0]]

    # Test circle markers
    m.add_circle_markers(
        data=[[5.0, 15.0], [25.0, 35.0]],
        name="Test Circle Markers"
    )
    layer2 = m.layers[-1]
    assert layer2.bounds == [[5.0, 15.0], [25.0, 35.0]]

    # Test empty markers (should not append a layer when empty). It warns rather than
    # raising, so a bad call cannot discard the layers already on the map.
    initial_count = len(m.layers)
    with pytest.warns(EmptyLayerWarning):
        m.add_markers(
            data=[],
            name="Empty Markers"
        )
    assert len(m.layers) == initial_count

def test_map_crs():
    m = Map()
    assert m.crs == "EPSG:3857"
    
    m2 = Map(crs="EPSG:4326")
    assert m2.crs == "EPSG:4326"



# --- permanent labels ---------------------------------------------------------------
# `label` resolves string-or-column exactly like `name`: a column names each feature
# from its own value, a literal repeats. Points carry a per-feature `labels` list
# aligned with the coordinate buffer; one-feature vectors carry a single `label`.
def test_point_labels_come_from_a_column():
    m = Map()
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "site": ["Alpha", "Bravo"]},
                         name="Sites", label="site")
    assert m.layers[-1].labels == ["Alpha", "Bravo"]


def test_grouped_points_slice_their_labels():
    m = Map()
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "site": ["Alpha", "Bravo"], "kind": ["a", "b"]},
                         name="Sites", label="site", layer_group=["Fleet", "kind"])
    by_group = {l.layer_group: l for l in m.layers if l.get("type") == "circle_markers"}
    assert by_group["Fleet/a"].labels == ["Alpha"]
    assert by_group["Fleet/b"].labels == ["Bravo"]


def test_vector_labels_resolve_per_feature():
    df = pd.DataFrame({
        "zone": ["North", "South"],
        "wkt": ["POLYGON ((0 0, 1 0, 1 1, 0 0))", "POLYGON ((5 5, 6 5, 6 6, 5 5))"],
    })
    m = Map()
    m.add_polygon(df, name="zone", label="zone")
    polys = [l for l in m.layers if l.get("type") == "polygon"]
    assert [p.label for p in polys] == ["North", "South"]


def test_a_literal_label_is_taken_as_text():
    m = Map()
    m.add_polygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]],
                  name="Zone", label="Restricted")
    assert m.layers[-1].label == "Restricted"
    m.add_circle([36.0, -5.3], radius=500, name="Ring", label="Search Area")
    assert m.layers[-1].label == "Search Area"


def test_unlabelled_layers_carry_nothing():
    m = Map()
    m.add_circle_markers([[36.0, -5.3]], name="Plain")
    assert m.layers[-1].labels is None and m.layers[-1].label is None


def test_merged_collection_parts_keep_their_bounds():
    # The reported shape: a polygon and its centre marker share a name and merge
    # into a collection. `bounds` was never in _SUB_LAYER_ATTRS, so every merged
    # part came back bounds=None -- which silently broke label anchors on merged
    # polygons, bounds_of() over parts, and select(zoom=True) for collections.
    m = Map()
    m.add_polygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]], name="Dwell N",
                  layer_group="Dwells", label="Dwell N")
    m.add_circle_markers([[36.05, -5.25]], name="Dwell N", layer_group="Dwells")
    group = [l for l in m.layers if l.get("type") == "group"][0]
    parts = {s["type"]: s for s in group.get("layers")}
    assert parts["polygon"].get("bounds") == [[36.0, -5.3], [36.1, -5.2]]
    assert parts["polygon"].get("label") == "Dwell N"
    assert parts["circle_markers"].get("bounds") is not None
    assert m.bounds_of("Dwell N") == [[36.0, -5.3], [36.1, -5.2]]
