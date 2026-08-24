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


def scenario_time_points():
    """A timestamp column animates the layer: ::times packed (a null row stays
    timeless -- NaN bytes), the meta set, the period on the shared config."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2], "lon": [-5.3, -5.2, -5.1],
         "timestamp": ["2026-01-01T00:00:00", "2026-01-02T12:30:00Z", None]},
        name="Feed")
    m.make_time_layer("Feed", period="PT1H")
    return m


def scenario_time_epoch_pairs():
    """Detected start/end epoch-second columns: the s->ms rule, the pair field,
    a fixed duration, fade."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
         "datetime_start": [1767225600, 1767312000],
         "datetime_end": [1767229200, 1767315600]},
        name="Dwells")
    m.make_time_layer("Dwells", duration="PT2H", fade=True)
    return m


def scenario_time_clear():
    """clear_time_layer removes the animation and ONLY the ::times buffer."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2], "value": [1.0, 9.0],
         "timestamp": ["2026-01-01T00:00:00", "2026-01-02T00:00:00"]},
        name="Feed", color_col="value")
    m.make_time_layer("Feed", period="P1D")
    m.clear_time_layer("Feed")
    return m


def scenario_time_append():
    """Appending to a timed layer ships the ::times tail with the coordinates."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
         "timestamp": ["2026-01-01T00:00:00", "2026-01-02T00:00:00"]},
        name="Feed")
    m.make_time_layer("Feed", period="P1D")
    m.update_layer("Feed", data={"lat": [36.2], "lon": [-5.1],
                                 "timestamp": ["2026-01-03T00:00:00"]}, append=True)
    return m


def scenario_time_config():
    """configure_time merges validated options into the shared config."""
    m = Map(show_logo=False)
    m.configure_time(period="PT15M", speed=2, loop=True, window="PT2H30M",
                     position="bottom-center")
    return m


def scenario_basemap_names():
    """Aliases, canonical dots and bare names all resolve; a second visible
    basemap in the radio group starts hidden."""
    m = Map(show_logo=False)
    m.add_basemap("CartoDB positron", visible=True)
    m.add_basemap("Esri.WorldImagery")
    m.add_basemap("OpenTopoMap")
    return m


def scenario_basemap_wms():
    """A WMS registry entry by alias: the canonical name, the wms request block."""
    m = Map(show_logo=False)
    m.add_basemap("usgs imagery wms")
    return m


def scenario_basemap_url():
    """A raw tile template is its own definition."""
    m = Map(show_logo=False)
    m.add_basemap("https://tiles.example.test/{z}/{x}/{y}.png",
                  attribution="Example tiles", max_zoom=19)
    return m


def scenario_crs_4326_defaults():
    """EPSG:4326 seeds its own default basemap row."""
    return Map(show_logo=False, crs="EPSG:4326")


FC_MIXED = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-5.3, 36.0]},
     "properties": {"site": "A"}},
    {"type": "Feature", "geometry": {"type": "LineString",
                                     "coordinates": [[-5.3, 36.0], [-5.2, 36.1]]},
     "properties": {"site": "B"}},
    {"type": "Feature", "geometry": {"type": "Polygon",
                                     "coordinates": [[[-5.3, 36.0], [-5.2, 36.0],
                                                      [-5.2, 36.1], [-5.3, 36.0]]]},
     "properties": {"site": "C"}},
]}

WKT_HOLE = ("POLYGON ((-5.3 36.0, -5.1 36.0, -5.1 36.2, -5.3 36.2, -5.3 36.0), "
            "(-5.25 36.05, -5.15 36.05, -5.15 36.15, -5.25 36.05))")
WKT_ML = "MULTILINESTRING ((-5.3 36.0, -5.2 36.1), (-5.1 36.0, -5.0 36.1))"


def scenario_collection_geojson():
    """A mixed FeatureCollection: one layer per kind, merged into one entry."""
    m = Map(show_logo=False)
    m.add_collection(FC_MIXED, name="Survey", layer_group="Field")
    return m


def scenario_polygon_hole_wkt():
    """A WKT polygon with a hole: the rings table over one flat buffer.
    Python reads it from a WKT column; JS parses the same WKT string."""
    import pandas as pd
    m = Map(show_logo=False)
    m.add_polygon(pd.DataFrame({"geometry": [WKT_HOLE], "zone": ["N"]}), name="Zone")
    return m


def scenario_multiline_wkt():
    """A WKT multi-line: one feature with parts."""
    import pandas as pd
    m = Map(show_logo=False)
    m.add_line(pd.DataFrame({"geometry": [WKT_ML], "route": ["R1"]}), name="Route")
    return m


def scenario_line_fan_geojson():
    """Several line features FAN into numbered sibling layers."""
    m = Map(show_logo=False)
    m.add_line({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "LineString",
                                         "coordinates": [[-5.3, 36.0], [-5.2, 36.1]]},
         "properties": {"n": 1}},
        {"type": "Feature", "geometry": {"type": "LineString",
                                         "coordinates": [[-5.1, 36.0], [-5.0, 36.1]]},
         "properties": {"n": 2}}]}, name="Tracks")
    return m


def scenario_points_geojson():
    """A Point FeatureCollection: properties become columns."""
    m = Map(show_logo=False)
    m.add_circle_markers({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-5.3, 36.0]},
         "properties": {"site": "Alpha", "value": 10}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-5.2, 36.1]},
         "properties": {"site": "Bravo", "value": 55}}]}, name="Sites")
    return m


def scenario_labels():
    """label= as a column (a null row labels empty) and as a literal."""
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "site": ["Alpha", None]}, name="Sites", label="site")
    m.add_polygon([[36.0, -5.3], [36.0, -5.2], [36.1, -5.2]], name="Zone",
                  label="Restricted")
    return m


def scenario_style_column():
    """A `style` property column styles per feature; a uniform one collapses
    back onto the layer and ships nothing extra."""
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1, 36.2], "lon": [-5.3, -5.2, -5.1],
                          "style": ["red", {"color": "#00ff00", "radius": 14}, None]},
                         name="Mixed")
    m.add_circle_markers({"lat": [36.3, 36.4], "lon": [-5.0, -4.9],
                          "style": ["blue", "blue"]}, name="Uniform")
    return m


def scenario_static_style():
    """static_style overrides the data's style column outright."""
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "style": ["red", "green"]},
                         name="Fixed", static_style={"color": "#123456"})
    return m


def scenario_feature_style_ops():
    """set_feature_styles: apply then clear, each a `style` op."""
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2]}, name="Sites")
    m.set_feature_styles("Sites", {1: {"color": "#ffcc00", "radius": 14}})
    m.set_feature_styles("Sites", {})
    return m


def scenario_highlight():
    """highlight states the whole selection: per-family styles over the shared
    ones, and the previous highlight goes dark on the next call."""
    m = Map(show_logo=False)
    m.add_collection(FC_MIXED, name="Survey", layer_group="Field")
    m.add_circle_markers([[36.5, -5.5]], name="Other")
    m.highlight("Survey", color="#ffcc00", markers={"radius": 14},
                polygons={"fill_opacity": 0.5})
    m.highlight("Other", color="#00ffff")
    return m


def scenario_styled_replace():
    """A data replace re-resolves the style column and clears feature overrides
    (indices do not survive)."""
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "style": ["red", "yellow"]}, name="Feed")
    m.set_feature_styles("Feed", {0: {"radius": 20}})
    m.update_layer("Feed", data={"lat": [36.2, 36.3, 36.4], "lon": [-5.1, -5.0, -4.9],
                                 "style": ["green", None, "red"]})
    return m


def scenario_labels_append():
    """An append ships the new labels in the append op's lists."""
    m = Map(show_logo=False)
    m.add_circle_markers({"lat": [36.0, 36.1], "lon": [-5.3, -5.2],
                          "site": ["Alpha", "Bravo"]}, name="Feed", label="site")
    m.update_layer("Feed", data={"lat": [36.2], "lon": [-5.1], "site": ["Charlie"]},
                   append=True)
    return m


def scenario_circle():
    """A geodesic circle: metres radius, the cos(lat)-widened box, no buffer."""
    m = Map(show_logo=False)
    m.add_circle([36.05, -5.25], 500, name="Perimeter", color="#ff0000")
    return m


def scenario_point_fanout():
    """A column-backed folder part fans one call into a layer per value, with
    the data-driven colours ranged over the WHOLE dataset and sliced."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2, 36.3], "lon": [-5.3, -5.2, -5.1, -5.0],
         "status": ["Active", "Idle", "Active", "Fault"],
         "value": [1.0, 2.0, 3.0, 4.0]},
        name="Feed", layer_group=["Sensors", "status"], color_col="value")
    return m


def scenario_point_name_column():
    """A name matching a property key names each layer from its own value."""
    m = Map(show_logo=False)
    m.add_circle_markers(
        {"lat": [36.0, 36.1, 36.2], "lon": [-5.3, -5.2, -5.1],
         "site": ["A", "B", "A"]}, name="site")
    return m


def scenario_configures():
    """The marginalia surface: legend, scale, draw, group, logo -- only the
    options given change, validated as in the frontend."""
    m = Map(show_logo=False)
    m.configure_legend(show=True, title="Key", position="bottom-right", scope="visible")
    m.configure_scale(show=True, units="nautical", max_width=160)
    m.configure_draw(show=True, tools=["rectangle", "polygon"], position="top-right")
    m.configure_group("Feeds", collapsed=True)
    m.configure_logo("https://example.test/logo.png", position="bottom-right",
                     height=40, show=True)
    return m


def scenario_fit_bounds():
    """An explicit fit is a command, and it disarms the data's steering: the
    add after it must not move the request."""
    m = Map(show_logo=False)
    m.add_circle_markers([[36.0, -5.3]], name="A")
    m.fit_bounds([[35.9, -5.5], [36.2, -5.0]], zoom_offset=-1, max_zoom=16, padding=20)
    m.add_circle_markers([[36.1, -5.2]], name="B")
    return m


def scenario_bare_wkt():
    """Bare WKT strings straight into the adders -- the same input both sides."""
    m = Map(show_logo=False)
    m.add_polygon(WKT_HOLE, name="Zone")
    m.add_line(WKT_ML, name="Route")
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
    scenario_time_points,
    scenario_time_epoch_pairs,
    scenario_time_clear,
    scenario_time_append,
    scenario_time_config,
    scenario_basemap_names,
    scenario_basemap_wms,
    scenario_basemap_url,
    scenario_crs_4326_defaults,
    scenario_collection_geojson,
    scenario_polygon_hole_wkt,
    scenario_multiline_wkt,
    scenario_line_fan_geojson,
    scenario_points_geojson,
    scenario_labels,
    scenario_style_column,
    scenario_static_style,
    scenario_feature_style_ops,
    scenario_highlight,
    scenario_styled_replace,
    scenario_labels_append,
    scenario_circle,
    scenario_point_fanout,
    scenario_point_name_column,
    scenario_configures,
    scenario_fit_bounds,
    scenario_bare_wkt,
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
