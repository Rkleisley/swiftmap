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


SCENARIOS = [
    scenario_empty_map,
    scenario_points_defaults,
    scenario_points_styled,
    scenario_pin_markers,
    scenario_line,
    scenario_polygon,
    scenario_merge_promotion,
    scenario_radio_group,
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
