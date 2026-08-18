"""
Static HTML export: one self-contained file, no Python, no kernel, no server.

The tier-3 test fixtures proved this shape long before it was a feature: the real
widget bundle driven by a stubbed model renders everything -- WebGL layers, the
sidebar, time playback -- entirely client-side. An export is that pattern with the
map's actual state baked in: the layer configs as JSON, every coordinate/time/style
buffer base64-encoded, the bundle and its CSS inlined, and a model stub whose
write-backs go nowhere. Leaflet and glify still load from unpkg at view time, the
same way the live widget loads them.

`to_html()` returns the document as a string -- which is also the Streamlit story:
`st.components.v1.html(m.to_html(), height=600)` -- and `save()` writes it to disk.
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
for (const [key, b64] of Object.entries(BUFFERS)) {{
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    state.coordinate_buffers[key] = new DataView(bytes.buffer);
}}
// The anywidget model surface the bundle needs, going nowhere: reads come from the
// baked state, writes update it locally, sends vanish. Exactly the stub the test
// fixtures render with.
const listeners = {{}};
const model = {{
    get: k => state[k],
    set(k, v) {{ state[k] = v; (listeners["change:" + k] || []).forEach(f => f()); }},
    on(e, f) {{ (listeners[e] = listeners[e] || []).push(f); }},
    send() {{}},
    save_changes() {{}},
}};
window.__model = model;   // console access for whoever opens the file
const widgetSrc = {widget_src_json};
const url = URL.createObjectURL(new Blob([widgetSrc], {{ type: "text/javascript" }}));
const widget = (await import(url)).default;
await widget.render({{ model, el: document.getElementById("swiftmap") }});
window.__ready = true;
</script>
</body>
</html>
"""


def to_html(self, title: str = "SwiftMap") -> str:
    """
    Renders the map as one self-contained HTML document, returned as a string.

    Everything the map holds ships inside the file: layer configs, coordinate and
    time buffers (base64, so expect roughly 4/3 of their binary size), data-driven
    colours and sizes, the widget bundle and its CSS. The result opens from disk or
    a static file host with no backend at all; time playback and the sidebar work
    fully client-side. Leaflet and glify load from unpkg when the file is opened,
    so viewing needs internet (or your own vendored bundle).

    For Streamlit: `st.components.v1.html(m.to_html(), height=600)`.
    """
    state = {
        "layers": [l.to_dict() if hasattr(l, "to_dict") else l for l in self.layers],
        "group_configs": self.group_configs,
        "coordinate_buffers": {},
        "center": self.center,
        "zoom": self.zoom,
        "crs": self.crs,
        "auto_sync": True,
        "sync_trigger": 0,
        "show_logo": self.show_logo,
        "show_legend": self.show_legend,
        "height": self.height,
        "legend_config": self.legend_config,
        # The auto-fit union (or a pre-display fit_bounds call) rides along, so an
        # export opens on its data exactly like the live widget.
        "fit_bounds_request": self.fit_bounds_request,
        "time_config": self.time_config,
        "time_current": self.time_current,
    }
    buffers = {key: base64.b64encode(raw).decode("ascii")
               for key, raw in self.coordinate_buffers.items()}
    return _TEMPLATE.format(
        title=title,
        css=_widget_css_path().read_text(encoding="utf-8"),
        state_json=_script_safe(json.dumps(state, default=str)),
        buffers_json=_script_safe(json.dumps(buffers)),
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
