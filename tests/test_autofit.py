"""
Auto-fit: with no explicit view, the map follows the data.

Every layer already computes its bounds at add time, so the union is four
comparisons per add, refreshed into fit_bounds_request. It disarms the moment
anyone sets a view -- explicit center/zoom at construction, a fit_bounds() call,
or the pan a browser echoes back -- and never re-arms: build to the union,
fit once on display, then leave the user alone.
"""
from swiftmap import Map

A = [[36.0, -5.3], [36.1, -5.2]]
B = [[35.0, -6.0], [35.5, -5.9]]


def test_a_fresh_map_fits_to_its_first_layer():
    m = Map()
    m.add_circle_markers(A, name="A")
    req = m.fit_bounds_request
    assert req["bounds"] == A
    assert req["max_zoom"] == 15, "a single-point layer must not fit to zoom 22"


def test_more_data_extends_the_union():
    m = Map()
    m.add_circle_markers(A, name="A")
    m.add_circle_markers(B, name="B")
    assert m.fit_bounds_request["bounds"] == [[35.0, -6.0], [36.1, -5.2]]


def test_an_explicit_center_disables_auto_fit():
    m = Map(center=[10.0, 10.0])
    m.add_circle_markers(A, name="A")
    assert m.fit_bounds_request == {}


def test_an_explicit_zoom_disables_auto_fit():
    m = Map(zoom=6)
    m.add_circle_markers(A, name="A")
    assert m.fit_bounds_request == {}


def test_a_pan_stops_the_following():
    m = Map()
    m.add_circle_markers(A, name="A")
    m.center = [20.0, 0.0]          # what a browser pan's write-back does
    m.add_circle_markers(B, name="B")
    assert m.fit_bounds_request["bounds"] == A, "the union stopped growing at the pan"


def test_an_explicit_fit_bounds_takes_over():
    m = Map()
    m.add_circle_markers(A, name="A")
    m.fit_bounds([[1.0, 1.0], [2.0, 2.0]])
    m.add_circle_markers(B, name="B")
    assert m.fit_bounds_request["bounds"] == [[1.0, 1.0], [2.0, 2.0]]


def test_a_map_with_no_data_requests_nothing():
    # The default basemaps carry no bounds, so a bare Map() still opens on the
    # documented fallback view rather than fitting to nothing.
    assert Map().fit_bounds_request == {}


def test_collections_feed_the_union_too():
    fc = {"type": "Feature", "geometry": {
        "type": "LineString", "coordinates": [[-5.3, 36.0], [-5.2, 36.1]]}}
    m = Map()
    m.add_polyline(fc, name="Route")
    assert m.fit_bounds_request["bounds"] == A
