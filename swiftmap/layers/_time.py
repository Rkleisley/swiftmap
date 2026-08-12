"""
Extracting per-feature time from layer properties.

A time layer is an existing layer whose features carry timestamps, so this module's job is
reading those out of `properties` -- where they already are -- and normalising them to
epoch milliseconds for the frontend. Nothing is re-parsed from the original data source:
DataFrame columns land in properties as ISO strings via _json_safe, and the geostructures
parser emits datetime_start/datetime_end per feature.

Each feature normalises to a [start, end] interval. A single timestamp is the degenerate
interval start == end. A feature with no parseable time gets NaN, which the frontend reads
as timeless -- always shown, never animated -- so one bad row dims nothing else.
"""
import datetime
import math
import re

import numpy as np
from typing import Any, Dict, List, Optional, Tuple

# Property names probed when no field is given, most specific first. "times" is the
# [start, end] pair convention StructMap injected; datetime_start/_end is what swiftmap's
# own geostructures parser emits. The bare names are common DataFrame columns. Probing is
# safe here in a way style auto-detection was not: make_time_layer is itself the opt-in,
# so a match cannot surprise a caller who never asked for time.
PAIR_CANDIDATES = [("times", None), ("datetime_start", "datetime_end")]
SINGLE_CANDIDATES = ["timestamp", "datetime", "time", "date"]

# One period string grammar for both sides of the wire; the JS mirror is parsePeriod().
PERIOD_RE = re.compile(
    r"^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?"
    r"(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$"
)


def is_valid_period(value: Any) -> bool:
    """True for an ISO8601 duration like 'P1D', 'PT1H', 'P1M'."""
    return isinstance(value, str) and bool(PERIOD_RE.match(value))


def parse_timestamp(value: Any) -> float:
    """
    One timestamp of any shape swiftmap's transport can hold, as epoch ms. NaN if unreadable.

    ISO strings are the common case, since _json_safe converts every datetime to one at the
    add_* boundary. A trailing 'Z' is normalised for fromisoformat, which only accepts it
    from Python 3.11. Bare numbers are taken as epoch seconds or milliseconds, told apart
    by magnitude: nothing plottable happened before 1971 in ms (< 1e10 must be seconds).
    """
    if value is None:
        return math.nan
    if isinstance(value, (datetime.datetime, datetime.date)):
        if not isinstance(value, datetime.datetime):
            value = datetime.datetime(value.year, value.month, value.day)
        if value.tzinfo is None:
            value = value.replace(tzinfo=datetime.timezone.utc)
        return value.timestamp() * 1000.0
    if isinstance(value, bool):
        return math.nan
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or value <= 0:
            return math.nan
        return float(value) if value >= 1e10 else float(value) * 1000.0
    if isinstance(value, str):
        text = value.strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.datetime.fromisoformat(text)
        except ValueError:
            return math.nan
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed.timestamp() * 1000.0
    return math.nan


def _interval(value: Any) -> Tuple[float, float]:
    """One property value as (start_ms, end_ms). A [start, end] pair or a single stamp."""
    if isinstance(value, (list, tuple)) and len(value) == 2:
        start, end = parse_timestamp(value[0]), parse_timestamp(value[1])
        if math.isnan(start) or math.isnan(end):
            return math.nan, math.nan
        return (start, end) if start <= end else (end, start)
    stamp = parse_timestamp(value)
    return stamp, stamp


def detect_time_fields(props: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """Returns (start_field, end_field) from the known names, or (None, None)."""
    for start, end in PAIR_CANDIDATES:
        if start in props:
            return start, (end if end and end in props else None)
    for name in SINGLE_CANDIDATES:
        if name in props:
            return name, None
    return None, None


def _values_of(props: Dict[str, Any], field: str) -> List[Any]:
    """
    A field's values as a list, one per feature.

    Point layers store properties column-oriented (a list per key); single-geometry layers
    -- one line, one polygon -- store scalars. A list-valued "times" pair on a scalar layer
    is one feature's interval, not two features, which is why pairs are wrapped.
    """
    value = props.get(field)
    if isinstance(value, list) and not (len(value) == 2 and not isinstance(value[0], (list, tuple))
                                        and field == "times"):
        return value
    return [value]


def _numeric_epochs(values: List[Any]):
    """
    The whole column as epoch-ms, vectorised, or None if it is not purely numeric.

    A 200k-point track arrives as a plain int64 epoch column, and walking it one value at
    a time through parse_timestamp cost ~2s per 5M points -- the largest share of a big
    ingest. The gate is a full pass over the column's types at C speed (set over map),
    not a sample of the head: a stray string past the sample would crash np.asarray, but
    a stray bool would silently become 1970 -- sampling trades the crash we can catch for
    the corruption we cannot. bool is excluded exactly because it subclasses int.

    None joins the set because np.asarray maps it to NaN under float64, which is already
    the timeless marker; the seconds/ms heuristic is applied per element, mirroring
    parse_timestamp.
    """
    if not values or set(map(type, values)) - {int, float, type(None)}:
        return None
    arr = np.asarray(values, dtype=np.float64)
    invalid = ~np.isfinite(arr) | (arr <= 0)
    arr = np.where(arr >= 1e10, arr, arr * 1000.0)
    arr[invalid] = np.nan
    return arr


def normalize_layer_times(
    props: Optional[Dict[str, Any]],
    time_field: Optional[str] = None,
    time_end_field: Optional[str] = None,
) -> Tuple[Optional[List[float]], Optional[str], int]:
    """
    Reads a layer's per-feature times out of its properties.

    Returns (interleaved, field_description, timeless_count): `interleaved` is
    [s0, e0, s1, e1, ...] in epoch ms -- a list or float64 ndarray, so treat it as
    array-like -- with NaN marking a feature that carries no readable time, or None when
    no time field exists at all -- the caller warns, since a time layer
    with no time is a request that cannot be honoured.
    """
    props = props or {}
    start_field, end_field = (time_field, time_end_field) if time_field \
        else detect_time_fields(props)
    if not start_field or start_field not in props:
        return None, None, 0

    starts = _values_of(props, start_field)
    ends = _values_of(props, end_field) if end_field and end_field in props else None
    if ends is not None and len(ends) != len(starts):
        ends = None

    # Vectorised fast path for numeric epoch columns; anything else -- ISO strings,
    # datetimes, [start, end] pairs, mixed data -- takes the per-value loop below.
    start_arr = _numeric_epochs(starts)
    if start_arr is not None:
        end_arr = _numeric_epochs(ends) if ends is not None else start_arr
        if end_arr is not None:
            if ends is not None:
                lo = np.minimum(start_arr, end_arr)
                hi = np.maximum(start_arr, end_arr)
                bad = np.isnan(start_arr) | np.isnan(end_arr)
                lo[bad] = np.nan
                hi[bad] = np.nan
                start_arr, end_arr = lo, hi
            interleaved_arr = np.empty(len(start_arr) * 2, dtype=np.float64)
            interleaved_arr[0::2] = start_arr
            interleaved_arr[1::2] = end_arr
            timeless = int(np.isnan(start_arr).sum())
            described = start_field if not end_field else f"{start_field}/{end_field}"
            # Returned as the array itself: the caller's np.asarray is then a no-copy
            # view, where a tolist() here round-tripped 10M floats through Python objects.
            return interleaved_arr, described, timeless

    interleaved: List[float] = []
    timeless = 0
    for i, raw in enumerate(starts):
        if ends is not None:
            start, end = parse_timestamp(raw), parse_timestamp(ends[i])
            if math.isnan(start) or math.isnan(end):
                start = end = math.nan
            elif start > end:
                start, end = end, start
        else:
            start, end = _interval(raw)
        if math.isnan(start):
            timeless += 1
        interleaved.extend((start, end))

    described = start_field if not end_field else f"{start_field}/{end_field}"
    return interleaved, described, timeless
