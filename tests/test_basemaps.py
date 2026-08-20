"""add_basemap name resolution: presets, the xyzservices catalogue, raw URLs,
and the network registry file that owns all of it."""
import json

import pytest

from swiftmap import Map, basemap_registry
from swiftmap._warnings import SwiftMapWarning


def _basemaps(m):
    return [l for l in m.layers if l.get("type") == "basemap"]


def _find(m, name):
    return next(l for l in _basemaps(m) if l.get("name") == name)


def test_historical_spellings_forward_to_the_catalogue():
    # The old preset dict is gone; its spellings must still land, now on
    # catalogue-supplied definitions.
    m = Map()
    m.add_basemap("Positron")
    child = _find(m, "Positron")
    assert "light_all" in child["url"]
    assert child["max_native_zoom"] == 20
    m.add_basemap("Dark Matter")
    assert "dark_all" in _find(m, "Dark Matter")["url"]


def test_esri_wgs84_stays_hand_defined():
    # The catalogue is web-mercator only; the 4326 imagery default cannot
    # come from it.
    m = Map(crs="EPSG:4326")
    child = _find(m, "Esri WGS84")
    assert "wi.maptiles.arcgis.com" in child["url"]
    assert child["max_native_zoom"] == 15


def test_xyzservices_provider_by_name():
    m = Map()
    m.add_basemap("Esri.WorldImagery")
    child = _find(m, "Esri.WorldImagery")
    assert "arcgisonline.com" in child["url"]
    assert "{z}" in child["url"] and "{y}" in child["url"] and "{x}" in child["url"]
    assert child["attribution"]
    assert child["max_zoom"] >= child["max_native_zoom"]


def test_provider_lookup_is_name_tolerant():
    # Not a preset spelling, so it must resolve through the catalogue.
    m = Map()
    m.add_basemap("cartodb darkmatter")
    child = _find(m, "cartodb darkmatter")
    assert "dark_all" in child["url"]


def test_provider_subdomains_survive_to_the_config():
    m = Map()
    m.add_basemap("CartoDB.DarkMatter")
    child = _find(m, "CartoDB.DarkMatter")
    assert "{s}" in child["url"]
    assert child["subdomains"] == "abcd"


def test_token_provider_without_token_warns_and_adds_nothing():
    m = Map()
    before = len(_basemaps(m))
    with pytest.warns(SwiftMapWarning, match="requires an access token"):
        m.add_basemap("Jawg.Streets")
    assert len(_basemaps(m)) == before


def test_token_provider_with_token_builds_the_url():
    m = Map()
    m.add_basemap("Jawg.Streets", accessToken="TESTTOKEN")
    child = _find(m, "Jawg.Streets")
    assert "TESTTOKEN" in child["url"]
    # The token fills the URL; it must not linger as a config field.
    assert "accessToken" not in child


def test_unknown_name_warns_instead_of_silently_serving_osm():
    m = Map()
    before = len(_basemaps(m))
    with pytest.warns(SwiftMapWarning, match="no basemap named"):
        m.add_basemap("Definitely Not A Basemap")
    assert len(_basemaps(m)) == before


def test_raw_url_template_passes_through():
    m = Map()
    url = "https://tiles.example.test/{z}/{x}/{y}.png"
    m.add_basemap(url)
    child = _find(m, url)
    assert child["url"] == url


def test_wms_registry_name_builds_a_wms_config():
    m = Map()
    m.add_basemap("USGS Imagery")
    child = _find(m, "USGS Imagery")
    assert child["url"].endswith("WmsServer")
    assert "{z}" not in child["url"]
    assert child["wms"]["layers"] == "0"
    assert child["wms"]["format"] == "image/png"
    assert child["attribution"]


def test_wms_aliases_are_case_insensitive_and_display_canonically():
    m = Map()
    m.add_basemap("USGS IMAGERY WMS")
    child = _find(m, "USGS Imagery")
    assert child["wms"]["layers"] == "0"


def test_wms_registry_extends_at_runtime():
    # The other network pastes its own registry in after import; the flatten
    # must see it.
    from swiftmap.layers.basemap import WMS_PROVIDERS
    WMS_PROVIDERS["test"] = {
        "Office Elevation": {
            "url": "https://internal.test/wmsserver",
            "layers": "elev:dtm",
            "name": "Office Elevation",
            "attribution": "internal",
            "aliases": ["dtm"],
        },
    }
    try:
        m = Map()
        m.add_basemap("dtm")
        child = _find(m, "Office Elevation")
        assert child["wms"]["layers"] == "elev:dtm"
    finally:
        del WMS_PROVIDERS["test"]


def test_url_with_wms_layers_is_a_wms_endpoint():
    m = Map()
    m.add_basemap("https://host.test/service/WmsServer", wms_layers="3,7",
                  wms_transparent=True, attribution="svc")
    child = _find(m, "https://host.test/service/WmsServer")
    assert child["wms"] == {"layers": "3,7", "format": "image/png",
                            "version": "1.1.1", "transparent": True}
    assert child["attribution"] == "svc"


def test_xyz_configs_carry_no_wms_block():
    m = Map()
    m.add_basemap("Esri.WorldImagery")
    assert "wms" not in _find(m, "Esri.WorldImagery")


def test_list_basemaps_includes_the_wms_registry():
    m = Map()
    assert "USGS Imagery" in m.list_basemaps("usgs")


def test_constructor_defaults_come_from_the_registry(monkeypatch):
    # The other network's registry file defaults a bare Map() to its own
    # services -- a WMS entry here proves any name form works as a default.
    monkeypatch.setitem(basemap_registry.DEFAULT_BASEMAPS, "EPSG:3857",
                        [("USGS Imagery", True)])
    m = Map()
    child = _find(m, "USGS Imagery")
    assert child["visible"] is True
    assert child["wms"]["layers"] == "0"


_OFFICE_CATALOGUE = {
    "Office": {"Ortho": {"url": "https://tiles.internal/{z}/{x}/{y}.png",
                         "attribution": "internal", "max_zoom": 18}}}


def test_xyz_catalogue_swaps_through_the_registry(monkeypatch):
    monkeypatch.setattr(basemap_registry, "SERVICES",
                        basemap_registry.build_services(_OFFICE_CATALOGUE))
    monkeypatch.setitem(basemap_registry.DEFAULT_BASEMAPS, "EPSG:3857", [])
    m = Map()
    m.add_basemap("Office.Ortho")
    child = _find(m, "Office.Ortho")
    assert child["url"] == "https://tiles.internal/{z}/{x}/{y}.png"
    assert child["max_native_zoom"] == 18
    # The public catalogue is out of play entirely.
    with pytest.warns(SwiftMapWarning, match="no basemap named"):
        m.add_basemap("CartoDB.DarkMatter")
    names = m.list_basemaps()
    assert "Office.Ortho" in names
    assert "CartoDB.DarkMatter" not in names


def test_xyz_catalogue_loads_from_a_json_file(tmp_path, monkeypatch):
    path = tmp_path / "providers.json"
    path.write_text(json.dumps(_OFFICE_CATALOGUE), encoding="utf-8")
    monkeypatch.setattr(basemap_registry, "SERVICES",
                        basemap_registry.build_services(str(path)))
    monkeypatch.setitem(basemap_registry.DEFAULT_BASEMAPS, "EPSG:3857", [])
    m = Map()
    m.add_basemap("office ortho")   # tolerant lookup works on a custom catalogue
    assert _find(m, "office ortho")["url"].startswith("https://tiles.internal")


def test_list_basemaps_spans_presets_and_catalogue():
    m = Map()
    names = m.list_basemaps()
    assert "Dark Matter" in names            # preset
    assert "CartoDB.DarkMatter" in names     # catalogue
    assert len(names) > 500


def test_list_basemaps_search_filters_case_insensitively():
    m = Map()
    hits = m.list_basemaps("dark")
    assert "CartoDB.DarkMatter" in hits
    assert "Dark Matter" in hits
    assert all("dark" in n.lower() for n in hits)
