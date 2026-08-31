"""
The WFS bridge: paging until the layer is complete, refusing to return a
truncated one, and decoding the server's own GeoJSON into the WKT table the
parsers already read. The fixture is a real HTTP server (in-process thread),
so the actual urllib path is what gets certified -- including the OGC habit
of answering bad requests with HTTP 200 and an XML exception report.
"""
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

pd = pytest.importorskip("pandas")

from swiftmap import Map, read_wfs
from swiftmap.mvt import read_mvt
from swiftmap.wfs import _geometry_wkt


def polygon_feature(i, layer="topp:zones"):
    x = -5.3 + i * 0.01
    return {"type": "Feature", "id": f"{layer}.{i}",
            "geometry": {"type": "Polygon", "coordinates": [
                [[x, 36.0], [x + 0.005, 36.0], [x + 0.005, 36.005],
                 [x, 36.005], [x, 36.0]]]},
            "properties": {"zone": f"Z{i}", "pop": i * 10}}


class WfsHandler(BaseHTTPRequestHandler):
    """A GeoServer-shaped WFS: pages honestly, but caps every response at
    `server_cap` features regardless of the requested count -- the admin
    limit that silently truncates naive clients."""
    features = [polygon_feature(i) for i in range(25)]
    server_cap = 10
    send_matched = True
    requests = []

    def do_GET(self):
        query = dict(urllib.parse.parse_qsl(
            urllib.parse.urlsplit(self.path).query))
        type(self).requests.append(query)
        if query.get("request") == "GetCapabilities":
            body = ("<wfs:WFS_Capabilities xmlns:wfs='x'><FeatureTypeList>"
                    "<FeatureType><Name>topp:zones</Name></FeatureType>"
                    "<FeatureType><Name>topp:roads</Name></FeatureType>"
                    "</FeatureTypeList></wfs:WFS_Capabilities>").encode()
            self._reply(body, "text/xml")
            return
        if query.get("typeNames") == "bad:layer":
            body = ("<ows:ExceptionReport xmlns:ows='x'><ows:Exception>"
                    "<ows:ExceptionText>Unknown type bad:layer"
                    "</ows:ExceptionText></ows:Exception>"
                    "</ows:ExceptionReport>").encode()
            self._reply(body, "text/xml")
            return
        start = int(query.get("startIndex", 0))
        count = min(int(query.get("count", 10 ** 9)), type(self).server_cap)
        page = type(self).features[start:start + count]
        body = {"type": "FeatureCollection", "features": page,
                "numberReturned": len(page)}
        if type(self).send_matched:
            body["numberMatched"] = len(type(self).features)
        self._reply(json.dumps(body).encode(), "application/json")

    def _reply(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def wfs_url():
    WfsHandler.features = [polygon_feature(i) for i in range(25)]
    WfsHandler.server_cap = 10
    WfsHandler.send_matched = True
    WfsHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), WfsHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/geoserver/wfs"
    server.shutdown()


def test_pages_past_the_server_cap_to_the_complete_layer(wfs_url):
    df = read_wfs(wfs_url, "topp:zones")
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 25, "the 10-feature server cap must not truncate"
    assert df["geometry"][0].startswith("POLYGON (")
    assert df["wfs_layer"][0] == "topp:zones"
    assert df["wfs_id"][3] == "topp:zones.3"
    assert list(df["pop"][:3]) == [0, 10, 20]
    gets = [q for q in WfsHandler.requests if q.get("request") == "GetFeature"]
    assert len(gets) >= 3, "three capped pages, not one truncated fetch"

    m = Map()
    m.add_polygon(df, name="Zones", color_col="pop")
    assert len(m.find_layers(types="polygon")) == 25, \
        "every fetched feature paints through the ordinary front door"


def test_a_terse_server_without_numberMatched_still_completes(wfs_url):
    WfsHandler.send_matched = False
    df = read_wfs(wfs_url, "topp:zones")
    assert len(df) == 25, "only an EMPTY page proves done when the total is unstated"


def test_an_oversize_layer_raises_instead_of_truncating(wfs_url):
    with pytest.raises(ValueError, match="never returned silently"):
        read_wfs(wfs_url, "topp:zones", max_features=20)


def test_the_exception_report_surfaces_as_the_error(wfs_url):
    with pytest.raises(ValueError, match="Unknown type bad:layer"):
        read_wfs(wfs_url, "bad:layer")


def test_no_layer_raises_with_the_endpoints_own_names(wfs_url):
    with pytest.raises(ValueError, match="topp:roads.*topp:zones"):
        read_wfs(wfs_url)


def test_bounds_and_params_reach_the_query_axis_correctly(wfs_url):
    read_wfs(wfs_url, "topp:zones",
             bounds=[[36.1, -5.6], [35.9, -5.0]],       # deliberately unsorted
             params={"srsName": "EPSG:3857"})
    query = next(q for q in WfsHandler.requests if q.get("request") == "GetFeature")
    assert query["bbox"].startswith("35.9,-5.6,36.1,-5.0,")
    assert query["bbox"].endswith("urn:ogc:def:crs:EPSG::4326")
    assert query["srsName"] == "EPSG:3857", "params= overrides the defaults"
    assert query["version"] == "2.0.0"


def test_every_geojson_geometry_type_becomes_wkt():
    cases = {
        "Point": [1.0, 2.0],
        "MultiPoint": [[1.0, 2.0], [3.0, 4.0]],
        "LineString": [[1.0, 2.0], [3.0, 4.0]],
        "MultiLineString": [[[1.0, 2.0], [3.0, 4.0]], [[5.0, 6.0], [7.0, 8.0]]],
        "Polygon": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]],
        "MultiPolygon": [[[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]]],
    }
    for gtype, coords in cases.items():
        wkt = _geometry_wkt({"type": gtype, "coordinates": coords})
        assert wkt.startswith(gtype.upper().replace("STRING", "STRING") + " (") \
            or wkt.startswith(gtype.upper() + " ("), wkt
    assert _geometry_wkt(None) is None
    assert _geometry_wkt({"type": "GeometryCollection"}) is None


def test_read_mvt_tms_flip(tmp_path):
    # The {-y} placeholder: the same tile grid with y counted from the south.
    from swiftmap.mvt import _tile_range
    xs, ys = _tile_range([[35.9, -5.6], [36.2, -5.0]], 10)
    x0, y0 = xs.start, ys.start
    flipped = 2 ** 10 - 1 - y0
    tile_dir = tmp_path / "10" / str(x0)
    tile_dir.mkdir(parents=True)
    mvt_ref = pytest.importorskip("mapbox_vector_tile")
    (tile_dir / f"{flipped}.pbf").write_bytes(mvt_ref.encode(
        [{"name": "t", "features": [{"geometry": "POINT(10 10)",
                                     "properties": {}}]}],
        default_options={"y_coord_down": True, "extents": 4096}))
    df = read_mvt(str(tmp_path) + "/{z}/{x}/{-y}.pbf",
                  [[35.9, -5.6], [36.2, -5.0]], 10)
    assert len(df) == 1, "the flipped row addresses the same tile"
