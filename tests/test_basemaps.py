"""add_basemap name resolution: presets, the xyzservices catalogue, raw URLs."""
import pytest

from swiftmap import Map
from swiftmap._warnings import SwiftMapWarning


def _basemaps(m):
    return [l for l in m.layers if l.get("type") == "basemap"]


def _find(m, name):
    return next(l for l in _basemaps(m) if l.get("name") == name)


def test_preset_names_resolve_as_before():
    m = Map()
    m.add_basemap("Positron")
    child = _find(m, "Positron")
    assert "light_all" in child["url"]
    assert child["max_native_zoom"] == 20


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
