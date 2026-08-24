"""
Static HTML export: one self-contained file, no Python, no kernel, no server --
and since the widget bundle carries Leaflet, glify and Geoman inside it, no
network either: the file opens from disk on a closed network as-is.

The tier-3 test fixtures proved this shape long before it was a feature: the real
widget bundle driven by a stubbed model renders everything -- WebGL layers, the
sidebar, time playback -- entirely client-side. An export is that pattern with the
map's actual state baked in: the layer configs as JSON, every coordinate/time/style
buffer base64-encoded, the bundle and its CSS inlined, and a model stub whose
write-backs go nowhere.

`to_html()` returns the document as a string -- the static Streamlit embed,
`st.components.v1.html(m.to_html(), height=600)` -- and `save()` writes it to disk.
The bidirectional Streamlit component (swiftmap.streamlit) composes its state with
`compose_state` and `encode_buffers` from here, so the two stacks cannot drift.
"""
import base64
import json
from pathlib import Path
from typing import Any, Optional

from ._infra import _load_esm, _widget_css_path

# "</" inside inlined JSON or JS would end the surrounding <script> tag early; the
# escaped form is identical once parsed. Applied to every inlined payload.
def _script_safe(text: str) -> str:
    return text.replace("</", "<\\/")


_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>html,body,#swiftmap{{margin:0;height:100%;width:100%}}</style>
<style>{css}</style>
</head>
<body>
<div id="swiftmap"></div>
<script type="module">
const state = {state_json};
const BUFFERS = {buffers_json};
const widgetSrc = {widget_src_json};
const url = URL.createObjectURL(new Blob([widgetSrc], {{ type: "text/javascript" }}));
const {{ default: widget, createHostStub, decodeBase64Buffers }} = await import(url);
// The bundle's own decoder (src/transport.js): the Streamlit component decodes
// the same encoding with the same function.
Object.assign(state.coordinate_buffers, decodeBase64Buffers(BUFFERS));
// The host: the bundle's own reference stub (src/host.js), going nowhere -- reads
// come from the baked state, writes update it locally, sends vanish. The same
// five methods every embedding drives the core with; an export is one with no
// kernel behind it.
const model = createHostStub(state);
window.__model = model;   // console access for whoever opens the file
await widget.render({{ model, el: document.getElementById("swiftmap") }});
window.__ready = true;
</script>
</body>
</html>
"""


# The state the frontend reads, as the live widget syncs it. One list, so the
# export, the Streamlit component and the Map's change counter agree on what "the
# map's state" is. Data-URI logos ride in logo_config (a branded export opens
# offline); the auto-fit union rides in fit_bounds_request (an export opens on its
# data exactly like the live widget).
STATE_KEYS = (
    "layers", "group_configs", "center", "zoom", "crs", "show_logo", "logo_config",
    "show_legend", "show_click_coordinates", "show_scale", "scale_config", "show_draw",
    "draw_config", "drawings", "height", "legend_config", "fit_bounds_request",
    "time_config", "time_current",
)


def compose_state(m) -> dict:
    """The map's synced state as the frontend's host reads it, buffers left empty."""
    state = {key: getattr(m, key) for key in STATE_KEYS}
    state["layers"] = [l.to_dict() if hasattr(l, "to_dict") else l for l in m.layers]
    state["coordinate_buffers"] = {}
    state.update({"auto_sync": True, "sync_trigger": 0, "draw_seq": 0})
    return state


def encode_buffers(m) -> dict:
    """Every coordinate/time/style buffer as base64 text (roughly 4/3 of its size)."""
    return {key: base64.b64encode(raw).decode("ascii")
            for key, raw in m.coordinate_buffers.items()}


def to_html(self, title: str = "SwiftMap") -> str:
    """
    Renders the map as one self-contained HTML document, returned as a string.

    Everything the map holds ships inside the file: layer configs, coordinate and
    time buffers (base64, so expect roughly 4/3 of their binary size), data-driven
    colours and sizes, and the widget bundle with its CSS -- Leaflet, glify and
    Geoman included, so the file opens from disk or a static host with no backend
    and NO NETWORK at all (basemap tiles remain the one runtime fetch, from
    whatever servers the map's basemap configs name). Time playback and the
    sidebar work fully client-side.

    For a static Streamlit embed: `st.components.v1.html(m.to_html(), height=600)`;
    for a bidirectional map in Streamlit, `swiftmap.streamlit.st_swiftmap`.
    """
    return _TEMPLATE.format(
        title=title,
        css=_widget_css_path().read_text(encoding="utf-8"),
        state_json=_script_safe(json.dumps(compose_state(self), default=str)),
        buffers_json=_script_safe(json.dumps(encode_buffers(self))),
        widget_src_json=_script_safe(json.dumps(_load_esm())),
    )


def save(self, path: Any, title: Optional[str] = None) -> "Map":
    """
    Writes the map to `path` as a self-contained static HTML file.

    The folium-shaped sharing story: hand the file to anyone and it opens in a
    browser with no server behind it. See `to_html` for what rides inside.

    >>> m.save("map.html")
    """
    path = Path(path)
    path.write_text(to_html(self, title=title or path.stem), encoding="utf-8")
    return self
