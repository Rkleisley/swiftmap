"""
Shiny helpers.

The decorator itself needs a session context to register an effect, so what is tested here
is everything it does around that: finding the live widget, skipping before it exists, and
collapsing a body full of updates into one message.
"""
import warnings

import pytest

import swiftmap
from swiftmap.shiny import resolve_map

pytest.importorskip("shiny")


class Renderer:
    """The shape of a @render_widget renderer: a `widget` attribute, None until rendered."""

    def __init__(self, widget):
        self.widget = widget


class Comm:
    comm_id = "c"
    kernel = True

    def __init__(self):
        self.msgs = []

    def send(self, data=None, buffers=None, **kw):
        self.msgs.append(data)

    def on_msg(self, *a, **k):
        pass

    def close(self, *a, **k):
        pass


@pytest.fixture
def m():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        mp = swiftmap.Map()
        for i in range(3):
            mp.add_circle_markers([[36.0 + i, -5.3]], name=f"Dwell {i + 1}",
                                  layer_group="Dwells")
    return mp


def patches(comm):
    return [d for d in comm.msgs if (d.get("content") or {}).get("ops")]


# --- finding the live widget ---------------------------------------------------------
def test_a_renderer_resolves_to_its_widget(m):
    assert resolve_map(Renderer(m)) is m


def test_a_map_resolves_to_itself(m):
    assert resolve_map(m) is m


def test_a_callable_is_called(m):
    assert resolve_map(lambda: m) is m


def test_a_renderer_wrapped_in_a_callable_still_resolves(m):
    """How the app is wired varies; none of the shapes is wrong."""
    assert resolve_map(lambda: Renderer(m)) is m


@pytest.mark.parametrize("source", [None, 42, "not a map", Renderer(None)],
                         ids=["none", "int", "str", "unrendered"])
def test_nothing_to_resolve_is_none_not_an_error(source):
    """
    An effect can run before the widget renders. That is normal, and returning None is
    what lets the decorator absorb the `if m_widget is None: return` from every handler.
    """
    assert resolve_map(source) is None


def test_resolution_cannot_loop_forever():
    box = []
    box.append(lambda: box[0])
    assert resolve_map(box[0]) is None, "a self-referential source bails out"


# --- what the decorator does around the body ------------------------------------------
def run_effect(source, fn, batch=True):
    """The body of the wrapper map_effect builds, without the session it registers into."""
    mp = resolve_map(source)
    if mp is None:
        return None
    if not batch:
        return fn(mp)
    with mp.batch():
        return fn(mp)


def test_a_body_full_of_updates_is_one_message(m):
    """The reason this exists: a per-click effect must not cost a message per call."""
    m.comm = Comm()
    ids = [l["id"] for l in m.find_layers(group="Dwells")]
    m.comm.msgs.clear()

    run_effect(m, lambda mp: (mp.hide(ids[0]), mp.hide(ids[1])))

    assert len(patches(m.comm)) == 1
    assert [o["op"] for o in patches(m.comm)[0]["content"]["ops"]] == ["set", "set"]


def test_without_batching_each_update_sends(m):
    m.comm = Comm()
    ids = [l["id"] for l in m.find_layers(group="Dwells")]
    m.comm.msgs.clear()

    run_effect(m, lambda mp: (mp.hide(ids[0]), mp.hide(ids[1])), batch=False)

    assert len(patches(m.comm)) == 2


def test_the_body_never_runs_before_the_widget_exists():
    ran = []
    run_effect(Renderer(None), lambda mp: ran.append(True))
    assert ran == [], "no None to guard against inside the handler"


def test_an_unchanged_selection_sends_nothing(m):
    """Effects re-run on any dependency, so a repeat must cost nothing."""
    ids = [l["id"] for l in m.find_layers(group="Dwells")]
    run_effect(m, lambda mp: mp.select([ids[0]], scope="Dwells"))
    m.comm = Comm()
    m.comm.msgs.clear()

    run_effect(m, lambda mp: mp.select([ids[0]], scope="Dwells"))

    assert patches(m.comm) == []


def test_map_effect_requires_shiny_only_when_used():
    """swiftmap imports cleanly without shiny; the dependency is per-function."""
    import swiftmap.shiny as mod
    assert "shiny" not in getattr(mod, "__dict__", {}), "not imported at module scope"
