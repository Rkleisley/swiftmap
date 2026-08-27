// Authoring-side time normalisation: the JS side of swiftmap/layers/_time.py.
//
// A time layer is an existing layer whose features carry timestamps; this
// module reads them out of `properties` and normalises each feature to a
// [start, end] interval in epoch MILLISECONDS, NaN marking a feature with no
// readable time (always shown, never animated). Byte-parity with Python is
// held by the authoring goldens, which is why the corner rules are replicated
// exactly:
//   - a bare number <= 0 or non-finite is NaN; >= 1e10 is already ms, below
//     that it is epoch seconds and is scaled (nothing plottable happened
//     before 1971 in ms);
//   - an ISO string with no offset is UTC (Python's fromisoformat + a UTC
//     replace) -- NEVER the browser's local time;
//   - booleans are NaN (bool subclasses int in Python; the trap is mirrored);
//   - a [start, end] pair swaps into order, and one NaN poisons the pair.
// (src/timecontrol.js owns the FRONTEND side: ticks, windows, playback.)

// One period grammar for both sides of the wire (Python: PERIOD_RE).
export const PERIOD_RE =
    /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export const isValidPeriod = (value) =>
    typeof value === "string" && PERIOD_RE.test(value);

// Property names probed when no field is given, most specific first.
const PAIR_CANDIDATES = [["times", null], ["datetime_start", "datetime_end"]];
const SINGLE_CANDIDATES = ["timestamp", "datetime", "time", "date"];

const ISO_RE = new RegExp(
    "^(\\d{4})-(\\d{2})-(\\d{2})" +
    "(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,6}))?)?)?" +
    "(?:(Z|z)|([+-])(\\d{2}):?(\\d{2}))?$");

export function parseTimestamp(value) {
    if (value == null) return NaN;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "boolean") return NaN;
    if (typeof value === "number") {
        if (!isFinite(value) || value <= 0) return NaN;
        return value >= 1e10 ? value : value * 1000;
    }
    if (typeof value !== "string") return NaN;
    const m = ISO_RE.exec(value.trim());
    if (!m) return NaN;
    const [, y, mo, d, h, mi, s, frac, zulu, sign, oh, om] = m;
    let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d),
                      Number(h || 0), Number(mi || 0), Number(s || 0));
    if (frac) ms += Math.trunc(Number(`0.${frac}`) * 1e6) / 1000;
    if (!zulu && sign) {
        const offset = (Number(oh) * 60 + Number(om)) * 60000;
        ms += sign === "-" ? offset : -offset;
    }
    return ms;
}

function interval(value) {
    if (Array.isArray(value) && value.length === 2) {
        const start = parseTimestamp(value[0]);
        const end = parseTimestamp(value[1]);
        if (Number.isNaN(start) || Number.isNaN(end)) return [NaN, NaN];
        return start <= end ? [start, end] : [end, start];
    }
    const stamp = parseTimestamp(value);
    return [stamp, stamp];
}

export function detectTimeFields(props) {
    for (const [start, end] of PAIR_CANDIDATES) {
        if (start in props) return [start, end && end in props ? end : null];
    }
    for (const name of SINGLE_CANDIDATES) {
        if (name in props) return [name, null];
    }
    return [null, null];
}

// A field's values, one per feature. Point layers store a list per key;
// single-geometry layers store scalars -- and a two-number "times" value on a
// scalar layer is ONE feature's interval, not two features. Typed arrays count
// as lists: they are the natural shape for a large epoch column, and testing
// only Array.isArray silently read a Float64Array as one feature (round-2 gap C).
const isListValue = (value) => Array.isArray(value)
    || (ArrayBuffer.isView(value) && !(value instanceof DataView));

function valuesOf(props, field) {
    const value = props[field];
    if (isListValue(value)
            && !(value.length === 2 && !isListValue(value[0]) && field === "times")) {
        return Array.isArray(value) ? value : Array.from(value);
    }
    return [value];
}

// Reads a layer's per-feature times from its properties. Returns
// { interleaved, field, timeless }: interleaved is a Float64Array
// [s0, e0, s1, e1, ...] in epoch ms with NaN for timeless features, or null
// when no time field exists at all.
export function normalizeLayerTimes(props, timeField = null, timeEndField = null) {
    props = props || {};
    let startField, endField;
    if (timeField) {
        startField = timeField;
        endField = timeEndField;
    } else {
        [startField, endField] = detectTimeFields(props);
        if (timeEndField) endField = timeEndField;
    }
    if (!startField || !(startField in props)) {
        return { interleaved: null, field: null, timeless: 0 };
    }
    if (endField && !(endField in props)) endField = null;

    const starts = valuesOf(props, startField);
    let ends = endField ? valuesOf(props, endField) : null;
    if (ends != null && ends.length !== starts.length) ends = null;

    const interleaved = new Float64Array(starts.length * 2);
    let timeless = 0;
    for (let i = 0; i < starts.length; i++) {
        let start, end;
        if (ends != null) {
            start = parseTimestamp(starts[i]);
            end = parseTimestamp(ends[i]);
            if (Number.isNaN(start) || Number.isNaN(end)) {
                start = end = NaN;
            } else if (start > end) {
                [start, end] = [end, start];
            }
        } else {
            [start, end] = interval(starts[i]);
        }
        if (Number.isNaN(start)) timeless += 1;
        interleaved[i * 2] = start;
        interleaved[i * 2 + 1] = end;
    }
    const field = endField ? `${startField}/${endField}` : startField;
    return { interleaved, field, timeless };
}

// A stripped time column, reconstructed for one feature's popup from the
// binary buffer that replaced it: the same instants under the original name,
// in ISO form. Single stripped field with a real interval shows the range.
export function strippedTimeProps(layer, timesView, index) {
    const stripped = (layer.time && layer.time.stripped) || [];
    if (!stripped.length || !timesView
            || timesView.byteLength < (index + 1) * 16) {
        return null;
    }
    const start = timesView.getFloat64(index * 16, true);
    const end = timesView.getFloat64(index * 16 + 8, true);
    if (Number.isNaN(start)) return null;
    const iso = (ms) => new Date(ms).toISOString();
    if (stripped.length > 1) {
        return { [stripped[0]]: iso(start), [stripped[1]]: iso(end) };
    }
    return { [stripped[0]]: end !== start ? `${iso(start)} – ${iso(end)}` : iso(start) };
}
