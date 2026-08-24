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

`added_with` is stripped from the goldens: it is Python's update_layer
bookkeeping, and the JS model grows its equivalent in the query/mutation stage.
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
]


def strip_added_with(layer):
    layer = dict(layer)
    layer.pop("added_with", None)
    if isinstance(layer.get("layers"), list):
        layer["layers"] = [strip_added_with(sub) for sub in layer["layers"]]
    return layer


def golden_of(m):
    state = compose_state(m)
    state.pop("coordinate_buffers", None)
    state["layers"] = [strip_added_with(l) for l in state["layers"]]
    state = json.loads(json.dumps(state, default=str))
    buffers = {key: base64.b64encode(raw).decode("ascii")
               for key, raw in m.coordinate_buffers.items()}
    return {"state": state, "buffers": buffers}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for build in SCENARIOS:
        name = build.__name__.removeprefix("scenario_")
        golden = {"scenario": name, "doc": build.__doc__.strip(), **golden_of(build())}
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(golden, indent=1, sort_keys=True) + "\n",
                        encoding="utf-8")
        print(f"wrote {path.relative_to(OUT.parent.parent.parent)}")


if __name__ == "__main__":
    main()
