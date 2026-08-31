"""
Niemeyer geohashes: pure-arithmetic encode/decode, no dependency.

A Niemeyer hash interleaves longitude/latitude bisection bits into characters
of a base-16, -32 or -64 alphabet -- and the SAME string is a valid hash in
every base whose alphabet contains its characters, decoding to a different
rectangle in each. The base is therefore part of the format, not of the
string: everything here takes it explicitly, with no default, mirroring
geostructures' own NiemeyerHasher. The charsets and domains below are the
format's spec as geostructures >= 0.14 defines it; the parity suite pins
this module to geostructures character-for-character.

COMPATIBILITY NOTE: geostructures 0.14.0 fixed the base-16/64 latitude
domain from +/-180 to +/-90 (base 32 always used +/-90). A base-16/64 hash
minted by geostructures <= 0.13 therefore decodes to a DIFFERENT cell here
than the library that wrote it intended -- re-hash such data with a current
geostructures before plotting it.
"""
from typing import Dict, List, Tuple

# base -> (bits per character high-to-low, charset, lat domain half-width)
_CONFIG: Dict[int, Tuple[Tuple[int, ...], str, float]] = {
    16: ((8, 4, 2, 1), "0123456789abcdef", 90.0),
    32: ((16, 8, 4, 2, 1), "0123456789bcdefghjkmnpqrstuvwxyz", 90.0),
    64: ((32, 16, 8, 4, 2, 1),
         "0123456789=ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz",
         90.0),
}

BASES = tuple(sorted(_CONFIG))

_INDEX = {base: {ch: i for i, ch in enumerate(cfg[1])}
          for base, cfg in _CONFIG.items()}


def valid_geohash(value, base: int) -> bool:
    """True when `value` is a non-empty string over the base's alphabet."""
    if base not in _CONFIG or not isinstance(value, str) or not value:
        return False
    index = _INDEX[base]
    return all(ch in index for ch in value)


def decode(geohash: str, base: int) -> Tuple[float, float, float, float]:
    """(lon, lat, lon_error, lat_error): the cell's centre and half-widths."""
    bits, _charset, lat_span = _CONFIG[base]
    index = _INDEX[base]
    lat_lo, lat_hi = -lat_span, lat_span
    lon_lo, lon_hi = -180.0, 180.0
    lon_err, lat_err = 180.0, lat_span
    lon_component = True

    for ch in geohash:
        try:
            decoded = index[ch]
        except KeyError:
            raise ValueError(f"invalid character in base-{base} geohash: {ch!r}")
        for mask in bits:
            if lon_component:
                lon_err /= 2.0
                if decoded & mask:
                    lon_lo = (lon_lo + lon_hi) / 2.0
                else:
                    lon_hi = (lon_lo + lon_hi) / 2.0
            else:
                lat_err /= 2.0
                if decoded & mask:
                    lat_lo = (lat_lo + lat_hi) / 2.0
                else:
                    lat_hi = (lat_lo + lat_hi) / 2.0
            lon_component = not lon_component

    return ((lon_lo + lon_hi) / 2.0, (lat_lo + lat_hi) / 2.0, lon_err, lat_err)


def encode(lat: float, lon: float, length: int, base: int) -> str:
    """The length-character base-N hash of the cell containing (lat, lon)."""
    bits, charset, lat_span = _CONFIG[base]
    lat_lo, lat_hi = -lat_span, lat_span
    lon_lo, lon_hi = -180.0, 180.0
    lon_component = True
    out: List[str] = []
    value = 0
    bit = 0

    while len(out) < length:
        if lon_component:
            mid = (lon_lo + lon_hi) / 2.0
            if lon >= mid:
                value |= bits[bit]
                lon_lo = mid
            else:
                lon_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2.0
            if lat >= mid:
                value |= bits[bit]
                lat_lo = mid
            else:
                lat_hi = mid
        lon_component = not lon_component
        bit += 1
        if bit == len(bits):
            out.append(charset[value])
            value = 0
            bit = 0

    return "".join(out)


def cell_ring(geohash: str, base: int) -> List[List[float]]:
    """The cell's rectangle as a closed [lat, lon] ring, house vertex order."""
    lon, lat, lon_err, lat_err = decode(geohash, base)
    return [
        [lat - lat_err, lon - lon_err],
        [lat - lat_err, lon + lon_err],
        [lat + lat_err, lon + lon_err],
        [lat + lat_err, lon - lon_err],
        [lat - lat_err, lon - lon_err],
    ]
