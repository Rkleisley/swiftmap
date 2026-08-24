"""
Golden fixtures for the authoring conformance suite.

Phase 3 makes the JS side an authoring surface of its own (createMapModel), with
Python's Map as the specification. There is no runtime bridge between the two --
the server has no JS engine, the browser no Python -- so the thing that keeps two
implementations of one rulebook from drifting is this file: canonical scenarios
built through the REAL Python Map, their exact resulting state and buffers
committed under test/goldens/authoring/.

Both suites pin to the same committed files:
- pytest (tests/test_authoring_goldens.py) rebuilds the scenarios and asserts the
  output still matches -- a Python-side change to the rules breaks it loudly and
  the fix is to regenerate (`python scripts/authoring_goldens.py`) and review the
  diff like any other code change.
- tier 1 (test/tier1-model.test.mjs) builds the same scenarios through the JS
  model and asserts byte-identical buffers and equal configs.

`added_with` is stripped from the goldens -- state and op payloads alike: it
is Python's update_layer bookkeeping; the JS model keeps its own equivalent
internally and never puts it on the wire.

Since stage 3 every golden also carries the OP STREAM: each `_emit` during the
scenario, in order, with its buffer as base64. That is the wire itself -- adds,
replaces, targeted sets, removals, and the append deltas with their
tail-versus-full buffer decisions -- so the JS model's emissions are pinned as
tightly as its state.
"""
import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swiftmap import Map  # noqa: E402
from swiftmap.export import compose_state  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "test" / "goldens" / "authoring"


def scenario_empty_map():
    """Map() alone: the seeded basemaps and their radio group."""
    return Map(show_logo=False)


def scenario_points_defaults():
    """Column-dict points with every styling default."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.01, 36.05, 36.09], "lon": [-5.31, -5.25, -5.19],
         "site": ["Alpha", "Bravo", "Charlie"], "value": [10, 55, 90]},
        name="Sites")
    return m


def scenario_points_styled():
    """Explicit style, a folder path, radius, and named tooltip fields."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.02, 36.06], "lon": [-5.28, -5.22], "site": ["A", "B"]},
        name="Beacons", layer_group="Feeds/Active", radius=14, color="#ff8800",
        tooltip_fields=["site"], tooltip_names=["Site"])
    return m


def scenario_pin_markers():
    """The other point family."""
    m = Map(show_logo=False)
    m.add_markers([[36.03, -5.27], [36.07, -5.21]], name="Pins")
    return m


def scenario_line():
    """A single polyline from nested pairs."""
    m = Map(show_logo=False)
    m.add_line([[36.00, -5.30], [36.05, -5.25], [36.10, -5.20]],
               name="Track", color="#0055ff", weight=6,
               properties={"vessel": "Swift One"})
    return m


def scenario_polygon():
    """A plain ring."""
    m = Map(show_logo=False)
    m.add_polygon([[36.00, -5.30], [36.00, -5.20], [36.10, -5.20]],
                  name="Zone", color="#ff0000", fill_color="#00ff00",
                  fill_opacity=0.5, weight=5)
    return m


def scenario_merge_promotion():
    """Same name + same group: the polygon and the marker become one collection."""
    m = Map(show_logo=False)
    m.add_polygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]], name="Dwell 1",
                  layer_group="Dwells")
    m.add_circle_markers([[36.05, -5.25]], name="Dwell 1", layer_group="Dwells")
    return m


def scenario_radio_group():
    """multi_select=False: the folder renders as radios, later layers start hidden."""
    m = Map(show_logo=False)
    m.add_circle_markers([[36.01, -5.29]], name="Plan A", layer_group="Plans",
                         group_multi_select=False)
    m.add_circle_markers([[36.02, -5.28]], name="Plan B", layer_group="Plans")
    return m


def scenario_ramp_default():
    """color_col over the default viridis ramp, extremes from the data.

    A 0..100 sweep, so the interpolation and its rounding are exercised across
    the whole ramp -- the half-to-even cases included."""
    m = Map(show_logo=False)
    n = 101
    m.add_circle_markers(
        {"lat": [36.0 + i * 0.001 for i in range(n)],
         "lon": [-5.3 + i * 0.001 for i in range(n)],
         "value": list(range(n))},
        name="Sweep", color_col="value")
    return m


def scenario_ramp_named_clamped():
    """A named map with fixed extremes; values outside them clamp."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2, 36.3], "lon": [-5.3, -5.2, -5.1, -5.0],
         "reading": [5.0, 20.0, 62.5, 95.0]},
        name="Readings", color_col="reading", colormap="turbo", vmin=20, vmax=80)
    return m


def scenario_ramp_list():
    """A list of colours is a ramp for numbers."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2], "lon": [-5.3, -5.2, -5.1],
         "value": [0.0, 2.5, 10.0]},
        name="TwoTone", color_col="value", colormap=["#000000", "#ffffff"])
    return m


def scenario_color_bins():
    """Bin edges make discrete classes, and the legend states them."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2, 36.3, 36.4], "lon": [-5.3, -5.2, -5.1, -5.0, -4.9],
         "value": [1.0, 3.0, 4.5, 6.0, 9.0]},
        name="Classed", color_col="value", colormap="plasma", color_bins=[3, 6])
    return m


def scenario_categorical_auto():
    """A non-numeric column takes the categorical palette, cycling."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2, 36.3], "lon": [-5.3, -5.2, -5.1, -5.0],
         "status": ["Idle", "Active", "Fault", "Active"]},
        name="Status", color_col="status")
    return m


def scenario_categorical_spread():
    """Naming a sequential map spreads it evenly across the categories."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2, 36.3], "lon": [-5.3, -5.2, -5.1, -5.0],
         "grade": ["a", "b", "c", "d"]},
        name="Grades", color_col="grade", colormap="viridis")
    return m


def scenario_categorical_dict():
    """A {value: colour} mapping: its order in the legend, a declared value the
    data has not delivered still listed, an unmapped value on the fallback."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2], "lon": [-5.3, -5.2, -5.1],
         "risk": ["high", "medium", "zzz"]},
        name="Risk", color_col="risk", color="#123456",
        colormap={"high": "#ff0000", "medium": "#ffaa00", "low": "#00ff00"})
    return m


def scenario_mut_hide_show():
    """hide by name, then by target, then show: targeted set ops, never the trait."""
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2]}, name="Sites")
    m.add_line([[36.0, -5.3], [36.1, -5.2]], name="Track")
    m.hide("Sites")
    m.hide("Track")
    m.show("Track")
    return m


def scenario_mut_select():
    """select is declarative within its scope; None restores the scope whole."""
    m = Map(show_logo=False)
    m.add_circle_markers([[36.0, -5.3]], name="A", layer_group="Fleet")
    m.add_circle_markers([[36.1, -5.3]], name="B", layer_group="Fleet")
    m.add_circle_markers([[36.2, -5.3]], name="C", layer_group="Fleet")
    m.select("B", scope="Fleet")
    m.select(None, scope="Fleet")
    return m


def scenario_mut_remove():
    """Removing a layer drops it and every buffer keyed under its id."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2], "value": [1.0, 9.0]},
        name="Sites", color_col="value")
    m.add_circle_markers([[36.3, -5.1]], name="Keep")
    m.remove_layer("Sites")
    return m


def scenario_mut_update_attrs():
    """update_layer without data: the attributes set, one replace per match."""
    m = Map(show_logo=False)
    m.add_circle_markers([[36.0, -5.3]], name="Sites")
    m.update_layer("Sites", color="#112233", radius=6)
    return m


def scenario_mut_update_replace():
    """update_layer(data=...): same identity, new data, every derived piece
    re-derived -- buffers in full, one replace."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2], "value": [1.0, 9.0]},
        name="Feed", color_col="value")
    m.update_layer("Feed", data={"lat": [36.2, 36.3, 36.4], "lon": [-5.1, -5.0, -4.9],
                                 "value": [2.0, 5.0, 8.0]})
    return m


def scenario_mut_update_append_tail():
    """Append under a FIXED colour range: existing values cannot move, so the
    colors buffer ships as a tail beside the coordinates."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2], "value": [10.0, 90.0]},
        name="Feed", color_col="value", vmin=0, vmax=100)
    m.update_layer("Feed", data={"lat": [36.2], "lon": [-5.1], "value": [50.0]},
                   append=True)
    return m


def scenario_mut_update_append_full():
    """Append that MOVES an auto range: every existing colour changes, so the
    colors buffer goes in full while the coordinates still append."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2], "value": [10.0, 90.0]},
        name="Feed", color_col="value")
    m.update_layer("Feed", data={"lat": [36.2], "lon": [-5.1], "value": [200.0]},
                   append=True)
    return m


def scenario_mut_update_line():
    """A single line's data replaced in place."""
    m = Map(show_logo=False)
    m.add_line([[36.0, -5.3], [36.1, -5.2]], name="Track", color="#0055ff",
               properties={"vessel": "Swift One"})
    m.update_layer("Track", data=[[36.0, -5.3], [36.05, -5.25], [36.2, -5.1]])
    return m


def scenario_radius_col():
    """radius_col sizes by the square root over a range; both buffers, both keys."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2, 36.3], "lon": [-5.3, -5.2, -5.1, -5.0],
         "tonnage": [900.0, 12000.0, 44100.0, 78900.0]},
        name="Fleet", color_col="tonnage", radius_col="tonnage",
        radius_range=(4, 20))
    return m


SCENARIOS = [
    scenario_empty_map,
    scenario_points_defaults,
    scenario_points_styled,
    scenario_pin_markers,
    scenario_line,
    scenario_polygon,
    scenario_merge_promotion,
    scenario_radio_group,
    scenario_ramp_default,
    scenario_ramp_named_clamped,
    scenario_ramp_list,
    scenario_color_bins,
    scenario_categorical_auto,
    scenario_categorical_spread,
    scenario_categorical_dict,
    scenario_radius_col,
    scenario_mut_hide_show,
    scenario_mut_select,
    scenario_mut_remove,
    scenario_mut_update_attrs,
    scenario_mut_update_replace,
    scenario_mut_update_append_tail,
    scenario_mut_update_append_full,
    scenario_mut_update_line,
]


def strip_added_with(layer):
    layer = dict(layer)
    layer.pop("added_with", None)
    if isinstance(layer.get("layers"), list):
        layer["layers"] = [strip_added_with(sub) for sub in layer["layers"]]
    return layer


def _strip_op(op):
    op = dict(op)
    if isinstance(op.get("layer"), dict):
        op["layer"] = strip_added_with(op["layer"])
    return op


def golden_of(build):
    """Builds a scenario with every _emit captured: the wire, op by op."""
    captured = []
    orig = Map._emit

    def spy(self, op, buffer=None):
        captured.append({
            "op": _strip_op(op),
            "buffer": (base64.b64encode(buffer).decode("ascii")
                       if buffer is not None else None),
        })
        orig(self, op, buffer)

    Map._emit = spy
    try:
        m = build()
    finally:
        Map._emit = orig
    state = compose_state(m)
    state.pop("coordinate_buffers", None)
    state["layers"] = [strip_added_with(l) for l in state["layers"]]
    state = json.loads(json.dumps(state, default=str))
    buffers = {key: base64.b64encode(raw).decode("ascii")
               for key, raw in m.coordinate_buffers.items()}
    ops = json.loads(json.dumps(captured, default=str))
    return {"state": state, "buffers": buffers, "ops": ops}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for build in SCENARIOS:
        name = build.__name__.removeprefix("scenario_")
        golden = {"scenario": name, "doc": build.__doc__.strip(), **golden_of(build)}
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(golden, indent=1, sort_keys=True) + "\n",
                        encoding="utf-8")
        print(f"wrote {path.relative_to(OUT.parent.parent.parent)}")


if __name__ == "__main__":
    main()
