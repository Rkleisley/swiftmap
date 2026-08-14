"""
The style registry, and whether it still describes the renderer.

STYLE_REGISTRY claims which style options each layer type actually draws. A claim like
that rots the moment src/layers.js changes, and rots silently -- the warnings keep firing
confidently about capabilities that moved. So the last test here reads the renderer and
checks the table against it rather than trusting the table.

The reason any of this exists: `radius` was accepted by add_circle_markers, validated,
resolved through _style.py and shipped over the wire, then thrown away by a hardcoded
`size: 5`. It was silent for the whole life of the project. Options that cannot be drawn
should say so.
"""
import re
import pathlib
import warnings

import pytest

from swiftmap._warnings import SwiftMapWarning
from swiftmap.layers._style import (
    STYLE_REGISTRY, STYLE_KEYS, pop_style_options, warn_on_undrawn_options,
)

RENDERER = pathlib.Path(__file__).resolve().parent.parent / "src" / "layers.js"


# --- the table's own invariants -----------------------------------------------------
@pytest.mark.parametrize("name,spec", sorted(STYLE_REGISTRY.items()))
def test_a_key_is_never_drawn_where_it_is_meaningless(name, spec):
    assert spec.renders_on <= spec.applies_to, (
        f"{name!r} claims to render on {sorted(spec.renders_on - spec.applies_to)}, "
        f"where it has no meaning")


def test_style_keys_still_derives_from_the_registry():
    """STYLE_KEYS is the frontend-name mapping the rest of the module uses."""
    assert STYLE_KEYS == {n: s.frontend for n, s in STYLE_REGISTRY.items()}


# --- what a caller is told ----------------------------------------------------------
def test_an_option_for_the_wrong_shape_says_so():
    with pytest.warns(SwiftMapWarning, match="does not apply to circle_markers"):
        warn_on_undrawn_options(["fill_color"], "add_circle_markers", "circle_markers")


def test_an_option_that_fits_but_is_undrawn_says_something_different():
    """
    The caller has nothing to fix here, so it must not read like a mistake they made.
    opacity is meaningful for a point; the point shaders simply do not read it.
    """
    with pytest.warns(SwiftMapWarning, match="is not drawn for markers layers yet"):
        warn_on_undrawn_options(["opacity"], "add_markers", "markers")


def test_a_drawn_option_is_silent(recwarn):
    warn_on_undrawn_options(["color", "radius"], "add_circle_markers", "circle_markers")
    warn_on_undrawn_options(["weight"], "add_line", "polyline")
    # The polygon styling gap is closed: fill colour, border weight and border
    # opacity all render now, so none of them may warn.
    warn_on_undrawn_options(["fill_color", "weight", "opacity"], "add_polygon", "polygon")
    assert [w for w in recwarn if issubclass(w.category, SwiftMapWarning)] == []


def test_no_layer_type_means_no_capability_warnings(recwarn):
    """add_collection fans out to three builders; they warn, it should not guess."""
    warn_on_undrawn_options(["fill_color", "weight"], "add_collection", None)
    assert [w for w in recwarn if issubclass(w.category, SwiftMapWarning)] == []


def test_the_note_reaches_the_caller():
    with pytest.warns(SwiftMapWarning, match="alpha from the colour itself"):
        warn_on_undrawn_options(["opacity"], "add_markers", "markers")


# --- through the real entry point ---------------------------------------------------
def test_popping_styles_warns_for_the_layer_type():
    kwargs = {"weight": 3}
    with pytest.warns(SwiftMapWarning, match="'weight' does not apply to circle_markers"):
        explicit, _ = pop_style_options(kwargs, "add_circle_markers", "circle_markers")
    assert explicit == {"weight": 3}, "still passed through -- reported, not rejected"


def test_static_style_is_checked_too():
    with pytest.warns(SwiftMapWarning, match="'fill_color'"):
        pop_style_options({"static_style": {"fill_color": "#f00"}},
                          "add_circle_markers", "circle_markers")


def test_undrawn_options_are_not_stripped():
    """
    Reported, never dropped. A key removed here would also vanish from the payload, so the
    day the renderer learns to draw it, old code would silently keep not working.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SwiftMapWarning)   # asserted elsewhere; noise here
        explicit, static = pop_style_options(
            {"fill_color": "#f00", "static_style": {"weight": 2}},
            "add_circle_markers", "circle_markers")
    assert explicit["fill_color"] == "#f00"
    assert static["weight"] == 2


# --- the drift guard ----------------------------------------------------------------
@pytest.mark.skipif(not RENDERER.exists(), reason="renderer source not present")
@pytest.mark.parametrize("name,spec", sorted(STYLE_REGISTRY.items()))
def test_the_table_matches_what_the_renderer_reads(name, spec):
    """
    A key the renderer never mentions cannot be drawn by it, and one it does mention should
    not be claimed as undrawn. This is coarse -- it cannot tell which layer type consumes a
    key -- but it catches the failure that matters: the table saying a capability exists
    when nothing in the renderer reads it, which is exactly what `radius` looked like.
    """
    source = RENDERER.read_text(encoding="utf-8")
    mentioned = re.search(rf"\b{re.escape(spec.frontend)}\b", source) is not None

    if spec.renders_on:
        assert mentioned, (
            f"{name!r} is claimed to render on {sorted(spec.renders_on)}, but the renderer "
            f"never reads {spec.frontend!r}. Either it was removed, or the claim is wrong.")
    else:
        assert not mentioned, (
            f"{name!r} is recorded as drawn nowhere, but the renderer reads "
            f"{spec.frontend!r}. If it now draws it, set renders_on and drop the note.")
