"""
The Streamlit component: the fourth stack over the one artifact.

`st_swiftmap(m)` renders a Map inside a Streamlit app and returns what the viewer
does with it -- clicks, draws, the viewport, the time slider, layer toggles -- as a
plain dict, on every script rerun. It is the React component (src/react.jsx)
wrapped in Streamlit's component protocol, over the same core the notebook widget,
the static export and the React component drive. The state it sends is composed
exactly as the export composes it (`swiftmap.export.compose_state`), buffers base64
(`encode_buffers`), decoded on the other side by the same decoder the export uses.

Unlike `st.components.v1.html(m.to_html())` -- still the right answer for a static
embed with no interaction -- this is bidirectional. And it is the first stack that
needs NO network at all: Leaflet, glify and Geoman ship bundled inside the wheel
(swiftmap/streamlit/frontend/) instead of loading from unpkg at view time, which is
what a closed network wants.

THE CACHING PATTERN. Streamlit reruns the whole script on every interaction, so
build the map once -- `@st.cache_resource` for a map every session shares
read-only, `st.session_state` for one each session mutates -- and let the component
decide whether anything changed:

    @st.cache_resource
    def build():
        m = Map(height="600px")
        m.add_circle_markers(df, name="Sensors", color_col="reading")
        return m

    events = st_swiftmap(build(), key="map")
    if events["clicked_layer_id"]:
        st.write(events["clicked_layer_id"], events["selected_index"])
    aoi = events["drawings"]

Every call carries a fingerprint (a change counter the Map keeps: trait assignments
bump it through an observer, in-place layer and buffer patches through the
transport's `_emit`), and the frontend no-ops on a rerun whose fingerprint it has
already rendered. A click therefore reruns the script and costs a comparison, not a
rebuild. The composed args are cached on the Map against the same fingerprint, so
an unchanged map is not re-encoded either. Mutating the map by a path the counter
cannot see? `m.sync()` moves it.

HONEST LIMITS (v1):
- Interaction round-trips through the server: a click, a pan, a slider move each
  rerun the script. That is Streamlit's model, not a swiftmap choice.
- When the fingerprint moves, v1 sends the FULL state and Streamlit serialises it
  whole: for very large maps that ceiling is real until v2 sends incremental
  patches through the React host's applyPatch. (Unchanged buffers keep their GPU
  copies across a re-send; unchanged configs rebuild nothing.)
- The component runs in an iframe, so it cannot share the page's CSS, and its
  height is the map's -- `height=`, a pixel value, default 500px -- not the page's.
- Events flow one way: the returned dict is the channel. The Map is not written
  back to, because that would move the fingerprint and re-send the map.
"""
import json
import secrets
import warnings
from pathlib import Path
from typing import Any, Dict, Optional

from .._warnings import SwiftMapWarning
from ..export import compose_state, encode_buffers

_FRONTEND = Path(__file__).parent / "frontend"

# Every key the core writes back, with the value an app sees before anyone has
# interacted. The frontend (src/streamlit.jsx) starts from the same table.
EVENT_KEYS = ("clicked_layer_id", "selected_index", "clicked_latlng", "click_seq",
              "drawings", "draw_seq", "center", "zoom", "time_current", "layer_visibility")


def _defaults() -> Dict[str, Any]:
    return {"clicked_layer_id": "", "selected_index": -1, "clicked_latlng": None,
            "click_seq": 0, "drawings": [], "draw_seq": 0, "center": None, "zoom": None,
            "time_current": None, "layer_visibility": {}}


_component = None


def _component_func():
    """The declared component, once: release mode, over the frontend in this package."""
    global _component
    if _component is None:
        import streamlit.components.v1 as components
        _component = components.declare_component("swiftmap", path=str(_FRONTEND))
    return _component


def state_fingerprint(m, height: Optional[str] = None) -> str:
    """
    A cheap name for the map's current state: a per-instance token plus the change
    counter every mutation bumps. Equal fingerprints mean the frontend has nothing
    to do. The height rides in it because it is part of what the frontend shows.
    """
    token = getattr(m, "_st_token", None)
    if token is None:
        token = m._st_token = secrets.token_hex(4)
    return f"{token}:{getattr(m, '_state_seq', 0)}:{height or ''}"


def compose_args(m, height: Optional[str] = None) -> Dict[str, Any]:
    """
    The component's args: the export's state composition, the buffers base64, and
    the fingerprint -- JSON-safe, as Streamlit will serialise them. Cached on the
    map and recomposed only when the fingerprint moves.
    """
    fp = state_fingerprint(m, height)
    cached = getattr(m, "_st_args_cache", None)
    if cached is not None and cached[0] == fp:
        return cached[1]
    state = compose_state(m)
    if height:
        state["height"] = height
    # The same `default=str` the export applies, so numpy scalars and dates in
    # layer properties serialise identically in both stacks.
    state = json.loads(json.dumps(state, default=str))
    args = {"state": state, "buffers": encode_buffers(m), "fingerprint": fp}
    m._st_args_cache = (fp, args)
    return args


def st_swiftmap(m, key: Optional[str] = None, height: Optional[str] = None) -> Dict[str, Any]:
    """
    Renders the map as a Streamlit component and returns the viewer's events.

    Parameters
    ----------
    m : Map
        Built once (see the module docstring for the caching pattern).
    key : str, optional
        Streamlit's widget key; give one when the page holds several maps.
    height : str, optional
        Pixel height for the map and its frame ("600px"); defaults to the map's
        own `height`, or 500px when it has none.

    Returns
    -------
    dict
        Always the same keys, with null/empty defaults before any interaction:
        clicked_layer_id, selected_index, clicked_latlng, click_seq, drawings,
        draw_seq, center, zoom, time_current, layer_visibility ({layer id: bool}
        for every layer the viewer toggled).

    Streamlit is optional: without it this warns and returns the default events
    rather than raising, so an app that imports swiftmap still loads.
    """
    try:
        import streamlit  # noqa: F401
    except ImportError:
        warnings.warn(
            "st_swiftmap renders through Streamlit, which is not installed: "
            "pip install swiftmap[streamlit]. It stays an optional dependency so the "
            "core carries no Streamlit. Returning the default events.",
            SwiftMapWarning, stacklevel=2)
        return _defaults()
    if not (_FRONTEND / "index.html").exists():
        warnings.warn(
            f"The Streamlit component's frontend is not built ({_FRONTEND}): run "
            "`npm run build` in a source checkout, or install the wheel. Returning the "
            "default events.",
            SwiftMapWarning, stacklevel=2)
        return _defaults()
    args = compose_args(m, height)
    value = _component_func()(state=args["state"], buffers=args["buffers"],
                              fingerprint=args["fingerprint"], key=key, default=_defaults())
    events = _defaults()
    if isinstance(value, dict):
        events.update({k: v for k, v in value.items() if k in events})
    return events


__all__ = ["st_swiftmap", "compose_args", "state_fingerprint", "EVENT_KEYS"]
