"""
Time layers and the shared slider: animating layers along the times their
features already carry, and configuring the one control that serves them all.
"""
from typing import Any, Optional

import numpy as np

from .._warnings import warn
from ..layers._time import normalize_layer_times, is_valid_period
from .effects import _describe_target

# Mirrors POSITIONS in src/timecontrol.js; the two sets must not drift.
TIME_POSITIONS = frozenset({
    "top-left", "top-center", "top-right", "left-center", "right-center",
    "bottom-left", "bottom-center", "bottom-right",
})


def make_time_layer(self, target: Any = None, *, time_field: Optional[str] = None,
                    time_end_field: Optional[str] = None, period: Optional[str] = None,
                    duration: Optional[str] = "period", fade: bool = False,
                    **criteria) -> "Map":
    """
    Animates the matching layers along the time their features already carry.

    Timestamps are read from the layer's own properties -- a DataFrame's timestamp
    column, or the datetime_start/datetime_end the geostructures parser records --
    so nothing is re-parsed and nothing extra is passed in. One slider serves every
    time layer on the map; making a second time layer joins it to the same slider
    rather than adding another control.

    The slider steps through generated periods rather than through the observed
    timestamps, so a period in which nothing happened still gets its tick: an empty
    map at 03:00 is a finding, not a gap in the slider.

    Parameters
    ----------
    target : str or layer or list, optional
        Which layers, as in `hide`. Chaining works since every method returns the map:
        `m.add_circle_markers(df, name="V").make_time_layer("V")`.
    time_field : str, optional
        Property holding each feature's time -- a single stamp or a [start, end] pair.
        When omitted, the known names are probed: "times", "datetime_start"(/"_end"),
        "timestamp", "datetime", "time", "date". A polyline whose property holds one
        time PER VERTEX -- which `add_line` keeps automatically when `order_col` is
        the timestamp column -- animates per segment within the one layer: the track
        reveals itself leg by leg (and fades leg by leg with `fade=True`) while
        costing a single layer and a single visibility slot.
    time_end_field : str, optional
        Property holding the interval end, for data with separate start/end columns.
    period : str, optional
        Slider step as an ISO8601 duration ('P1D', 'PT1H', 'PT15M'). Shared by the one
        slider, so setting it here reconfigures the map's time axis. Default 'P1D'.
    duration : str or None, default "period"
        How long a feature stays visible after its time. "period" shows each tick's
        own period -- absence reads as absence. None accumulates history instead, and
        an ISO8601 duration gives a fixed trailing window ('PT6H').
    fade : bool, default False
        Dim features with age: newest at full opacity, reaching zero at the
        window's trailing edge. Applies to any layer rendered on the GPU time
        path -- points, lines and polygons alike (the normal case); with a
        cumulative duration the fade spans decades and is imperceptible, and
        features without readable times never fade.
    **criteria
        Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

    Returns
    -------
    Map
        Self reference for method chaining.

    Warns
    -----
    SwiftMapWarning
        If nothing matched, a matched layer has no readable time property, some
        features carry no parseable time (those stay permanently visible), or the
        period/duration strings are not ISO8601 durations.

    Examples
    --------
    >>> m.add_circle_markers(df, name="Vessel")     # df has a timestamp column
    >>> m.make_time_layer("Vessel", period="PT1H")

    >>> m.make_time_layer(group="Tracks", period="PT15M", duration="PT1H")
    """
    matched = self.find_layers(target, **criteria)
    if not matched:
        warn(f"make_time_layer matched no layers ({_describe_target(target, criteria)}). "
             f"Nothing was animated.")
        return self

    if duration not in (None, "period") and not is_valid_period(duration):
        warn(f"make_time_layer: duration {duration!r} is not an ISO8601 duration "
             f"(like 'PT1H'). Falling back to 'period'.")
        duration = "period"

    with self.batch():
        for layer in matched:
            props = layer.get("properties") or {}
            # An explicit field that misses gets its own message: falling through
            # to the generic "pass time_field=" told the user to do the thing
            # they had just done, with no hint the name was the problem.
            if time_field and time_field not in props:
                have = ", ".join(sorted(map(str, props))) or "none"
                warn(f"make_time_layer: {time_field!r} is not a property of layer "
                     f"{layer.get('name')!r} (properties: {have}). Its features "
                     f"stay visible at every tick.")
                continue
            if time_end_field and time_end_field not in props:
                warn(f"make_time_layer: end field {time_end_field!r} is not a "
                     f"property of layer {layer.get('name')!r}; using start times "
                     f"only.")
            interleaved, field, timeless = normalize_layer_times(
                props, time_field, time_end_field)
            if interleaved is None:
                warn(f"make_time_layer: layer {layer.get('name')!r} has no time "
                     f"property. Pass time_field= naming one; its features stay "
                     f"visible at every tick until then.")
                continue
            if timeless:
                total = len(interleaved) // 2
                warn(f"make_time_layer: {timeless} of {total} feature(s) in "
                     f"{layer.get('name')!r} carry no parseable time and will stay "
                     f"visible at every tick.")

            payload = np.asarray(interleaved, dtype=np.float64).tobytes()
            key = f"{layer.get('id')}::times"
            if self.coordinate_buffers.get(key) != payload:
                self._set_layer_buffer(key, payload)
            time_meta = {"field": field, "duration": duration}
            if fade:
                time_meta["fade"] = True
            self._set_layer_fields([layer], {"time": time_meta})
        if period is not None:
            self.configure_time(period=period)
    return self


def clear_time_layer(self, target: Any = None, **criteria) -> "Map":
    """
    Stops animating the matching layers; with no target, every time layer on the map.

    The slider disappears once nothing is animated. Features return to being always
    visible; the layer itself is untouched.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    if target is None and not criteria:
        matched = [l for l in self.find_layers() if l.get("time")]
    else:
        matched = [l for l in self.find_layers(target, **criteria) if l.get("time")]
    if not matched:
        return self
    with self.batch():
        self._set_layer_fields(matched, {"time": None})
        # The ::times KEYS, not the layer ids: _remove_layer_buffers sweeps
        # everything under an id, and passing the id here deleted the layer's
        # coordinate (and colour) buffers with the animation -- the layer
        # vanished from the map. Caught building the JS model's mirror of this.
        self._remove_layer_buffers([f"{l.get('id')}::times" for l in matched
                                    if f"{l.get('id')}::times" in self.coordinate_buffers])
    return self


def configure_time(self, **options) -> "Map":
    """
    Configures the shared time slider.

    Options
    -------
    period : str
        Slider step, ISO8601 ('P1D', 'PT1H'). Default 'P1D'.
    auto_play : bool
        Start playing as soon as the slider appears. Default False.
    loop : bool
        Start over when playback reaches the end. Default False.
    speed : float
        Playback rate in ticks per second. Default 1.
    window : str or None
        Shared trailing window as an ISO8601 duration ('PT2H30M'). While set it
        overrides every layer's own `duration` -- it is the same override dragging
        the bar's trail handle creates, so Python and the bar never disagree.
        Pass None to clear it and hand control back to per-layer durations.
        Fixed-width durations (hours, days) draw exactly on the bar; calendar
        durations (months) filter correctly but cannot be depicted as a span.
    position : str
        Where the control sits on the map: 'top-left', 'top-center', 'top-right',
        'left-center', 'right-center', 'bottom-left', 'bottom-center' or
        'bottom-right'. Default 'top-center'. The sidebar lives at top-right, so
        that corner works but crowds it.

    Returns
    -------
    Map
        Self reference for method chaining.
    """
    if "position" in options and options["position"] not in TIME_POSITIONS:
        warn(f"configure_time: position {options['position']!r} is not one of "
             f"{sorted(TIME_POSITIONS)}. Keeping the previous position.")
        options.pop("position")
    if "window" in options:
        window = options.pop("window")
        if window is None:
            # Clearing is removing the key, not storing None: the frontend treats a
            # present window as an override, and per-layer durations return only
            # when it is gone.
            if "window" in self.time_config:
                self.time_config = {k: v for k, v in self.time_config.items()
                                    if k != "window"}
        elif not is_valid_period(window):
            warn(f"configure_time: window {window!r} is not an ISO8601 duration "
                 f"(like 'PT2H30M'). Keeping the previous window.")
        else:
            options["window"] = window
    if "period" in options and not is_valid_period(options["period"]):
        warn(f"configure_time: period {options['period']!r} is not an ISO8601 "
             f"duration (like 'P1D' or 'PT1H'). Keeping the previous period.")
        options.pop("period")
    if options:
        self.time_config = {**self.time_config, **options}
    return self
