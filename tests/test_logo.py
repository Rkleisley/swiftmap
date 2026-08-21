"""
The logo card: off by default, branding supplied by the app through configure_logo
(two slots, each a URL, data URI or local file), carried into exports, seedable
from the network registry.
"""
import warnings

import pytest

import swiftmap
from swiftmap import Map, basemap_registry
from swiftmap._warnings import SwiftMapWarning

PNG_BYTES = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
             b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xcf\xc0"
             b"P\x0f\x00\x04\x85\x01\x80\x84\xa9\x8c!\x00\x00\x00\x00IEND\xaeB`\x82")


def quiet_map(**kw):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)
        return Map(**kw)


def test_the_card_is_off_by_default():
    m = quiet_map()
    assert m.show_logo is False
    assert m.logo_config == {}
    assert quiet_map(show_logo=True).show_logo is True


def test_a_url_fills_one_slot_and_the_other_stays_empty():
    m = quiet_map()
    m.configure_logo(company="https://acme.example/logo.png")
    assert m.logo_config["company"] == {"url": "https://acme.example/logo.png", "alt": ""}
    assert "parent_company" not in m.logo_config, "an unset slot renders nothing"
    assert m.show_logo is False, "configuring does not switch the card on by itself"


def test_the_dict_form_carries_alt_and_show_switches_the_card_on():
    m = quiet_map()
    m.configure_logo(parent_company={"url": "data:image/png;base64,AAAA", "alt": "Parent"},
                     show=True)
    assert m.logo_config["parent_company"] == {"url": "data:image/png;base64,AAAA",
                                               "alt": "Parent"}
    assert "company" not in m.logo_config
    assert m.show_logo is True


def test_a_local_file_is_embedded_as_a_data_uri(tmp_path):
    png = tmp_path / "logo.png"
    png.write_bytes(PNG_BYTES)
    svg = tmp_path / "mark.svg"
    svg.write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    m = quiet_map()
    m.configure_logo(company=str(png), parent_company={"path": svg, "alt": "Mark"})
    assert m.logo_config["company"]["url"].startswith("data:image/png;base64,")
    assert m.logo_config["parent_company"]["url"].startswith("data:image/svg+xml;base64,")
    assert m.logo_config["parent_company"]["alt"] == "Mark"


def test_none_leaves_a_slot_and_false_clears_it():
    m = quiet_map()
    m.configure_logo(company="https://a/1.png", parent_company="https://a/2.png")
    m.configure_logo(position="top-left")            # slots untouched
    assert set(m.logo_config) >= {"company", "parent_company"}
    m.configure_logo(parent_company=False)
    assert "parent_company" not in m.logo_config
    assert m.logo_config["company"]["url"] == "https://a/1.png"


def test_a_missing_file_warns_and_skips_the_slot():
    m = quiet_map()
    with pytest.warns(SwiftMapWarning, match="neither a URL"):
        m.configure_logo(company="no/such/file.png")
    assert "company" not in m.logo_config


def test_position_and_height_validate():
    m = quiet_map()
    with pytest.warns(SwiftMapWarning, match="corner"):
        m.configure_logo(position="centre")
    m.configure_logo(position="bottom-left", height=48)
    assert m.logo_config["position"] == "bottom-left"
    assert m.logo_config["height"] == 48
    with pytest.warns(SwiftMapWarning, match="height"):
        m.configure_logo(height="tall")


def test_the_card_rides_the_export():
    m = quiet_map()
    m.configure_logo(company="data:image/png;base64,QUJD", show=True)
    html = m.to_html()
    assert '"logo_config"' in html
    assert "data:image/png;base64,QUJD" in html, "an embedded logo opens offline"


def test_the_registry_seeds_fixed_branding(monkeypatch):
    monkeypatch.setattr(basemap_registry, "DEFAULT_LOGO",
                        {"company": "https://corp.example/logo.svg", "position": "top-left",
                         "show": True})
    m = quiet_map()
    assert m.logo_config["company"]["url"] == "https://corp.example/logo.svg"
    assert m.logo_config["position"] == "top-left"
    assert m.show_logo is True
    m.configure_logo(company=False, show=False)      # an app can still remove it
    assert "company" not in m.logo_config and m.show_logo is False


def test_round_trip_state_carries_logo_config():
    m = quiet_map()
    m.configure_logo(company="https://a/1.png")
    assert m.get_state()["logo_config"]["company"]["url"] == "https://a/1.png"
