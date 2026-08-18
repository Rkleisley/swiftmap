"""
Static HTML export: the whole map in one file, no backend.

Structure is asserted here; that the file actually RENDERS is tier 3's job
("a static export renders without any backend"), which generates an export through
scripts/export_demo.py and drives it in a real browser.
"""
import base64

import pytest

from swiftmap import Map


def small_map():
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2], "value": [1.0, 9.0]},
        name="Sites", color_col="value")
    return m


def test_the_export_carries_state_buffers_and_bundle():
    m = small_map()
    html = m.to_html(title="Patrol Picture")
    layer = m.layers[-1]

    assert "<title>Patrol Picture</title>" in html
    assert '"Sites"' in html, "the layer configs ride as JSON"
    coords_b64 = base64.b64encode(m.coordinate_buffers[layer.id]).decode("ascii")
    assert coords_b64 in html, "coordinate buffers ride as base64"
    colors_b64 = base64.b64encode(
        m.coordinate_buffers[f"{layer.id}::colors"]).decode("ascii")
    assert colors_b64 in html, "data-driven colour buffers ride too"
    assert "renderMergedGlLayer" in html or "glify" in html, "the bundle is inlined"


def test_nothing_in_the_payload_can_close_the_script_tag():
    # The bundle and the JSON both contain "</..." sequences; unescaped, the browser
    # ends the <script> there and the export is garbage from that byte on.
    html = small_map().to_html()
    body = html.split("<script type=\"module\">", 1)[1]
    closes = body.count("</script>")
    assert closes == 1, f"exactly the one real close tag, found {closes}"


def test_save_writes_the_file_and_chains(tmp_path):
    out = tmp_path / "picture.html"
    m = small_map()
    assert m.save(out) is m
    text = out.read_text(encoding="utf-8")
    assert text.startswith("<!doctype html>")
    assert "<title>picture</title>" in text, "the filename is the default title"
