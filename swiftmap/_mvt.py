"""
Mapbox Vector Tile decoding: pure arithmetic, no dependency.

An MVT tile is a protobuf message (spec 2.1) of named layers, each holding
features whose geometry is a command stream of zigzag deltas in tile-local
integer coordinates. Everything needed to read one is a varint parser and
the command walk, so swiftmap carries its own ~200 lines instead of a
protobuf runtime -- the Niemeyer precedent: an independent implementation,
pinned against the reference library (mapbox-vector-tile, in the test
extras) by the parity suite, which is the contract.

Output geometry is WKT in lon/lat, because WKT is the front door the
parsers already read: a decoded tile is ordinary tabular data the moment it
leaves here.
"""
import gzip
import math
import struct
from typing import Any, Dict, List, Optional, Tuple

_GEOM_POINT, _GEOM_LINE, _GEOM_POLYGON = 1, 2, 3


def _varints(data: bytes, pos: int, end: int):
    """Yields varints from data[pos:end]."""
    while pos < end:
        shift = 0
        value = 0
        while True:
            byte = data[pos]
            pos += 1
            value |= (byte & 0x7F) << shift
            if not byte & 0x80:
                break
            shift += 7
        yield value
    if pos != end:
        raise ValueError("malformed varint run")


def _read_varint(data: bytes, pos: int) -> Tuple[int, int]:
    shift = 0
    value = 0
    while True:
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, pos
        shift += 7


def _zigzag(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def _fields(data: bytes, pos: int, end: int):
    """Yields (field_number, wire_type, value_or_span) over a message body."""
    while pos < end:
        key, pos = _read_varint(data, pos)
        field, wire = key >> 3, key & 0x7
        if wire == 0:                       # varint
            value, pos = _read_varint(data, pos)
            yield field, wire, value
        elif wire == 1:                     # 64-bit
            yield field, wire, data[pos:pos + 8]
            pos += 8
        elif wire == 2:                     # length-delimited
            length, pos = _read_varint(data, pos)
            yield field, wire, (pos, pos + length)
            pos += length
        elif wire == 5:                     # 32-bit
            yield field, wire, data[pos:pos + 4]
            pos += 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")


def _decode_value(data: bytes, span: Tuple[int, int]) -> Any:
    """One Value message: the oneof of MVT property types."""
    for field, wire, item in _fields(data, span[0], span[1]):
        if field == 1:
            return data[item[0]:item[1]].decode("utf-8")
        if field == 2:
            return struct.unpack("<f", item)[0]
        if field == 3:
            return struct.unpack("<d", item)[0]
        if field == 4:
            # int64: negatives arrive as two's-complement 64-bit varints.
            return item - (1 << 64) if item >= (1 << 63) else item
        if field == 5:
            return item
        if field == 6:
            return _zigzag(item)
        if field == 7:
            return bool(item)
    return None


# vector-tile-js's signedArea, verbatim in spirit: exterior rings come out
# positive under this formula on raw (y-down) tile coordinates.
def _ring_area(ring: List[Tuple[float, float]]) -> float:
    total = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        total += (x2 - x1) * (y1 + y2)
    return total


def _walk_geometry(geom: List[int]) -> List[List[Tuple[int, int]]]:
    """The command stream as raw parts (MoveTo starts one), cursor persisting."""
    parts: List[List[Tuple[int, int]]] = []
    x = y = 0
    i = 0
    while i < len(geom):
        command = geom[i] & 0x7
        count = geom[i] >> 3
        i += 1
        if command == 1:                    # MoveTo
            for _ in range(count):
                x += _zigzag(geom[i])
                y += _zigzag(geom[i + 1])
                i += 2
                parts.append([(x, y)])
        elif command == 2:                  # LineTo
            for _ in range(count):
                x += _zigzag(geom[i])
                y += _zigzag(geom[i + 1])
                i += 2
                parts[-1].append((x, y))
        elif command == 7:                  # ClosePath
            pass                            # rings close implicitly in WKT below
        else:
            raise ValueError(f"unknown MVT geometry command {command}")
    return parts


def _tile_to_lonlat(z: int, x: int, y: int, extent: int):
    """A converter from tile-local coords to (lon, lat) for tile (z, x, y)."""
    n = 2 ** z

    def convert(px: float, py: float) -> Tuple[float, float]:
        lon = (x + px / extent) / n * 360.0 - 180.0
        m = math.pi - 2.0 * math.pi * (y + py / extent) / n
        lat = math.degrees(math.atan(math.sinh(m)))
        return lon, lat
    return convert


def _wkt_coords(part, convert) -> str:
    return ", ".join(f"{lon:.7f} {lat:.7f}"
                     for lon, lat in (convert(px, py) for px, py in part))


def _geometry_wkt(gtype: int, parts, convert) -> Optional[str]:
    if not parts:
        return None
    if gtype == _GEOM_POINT:
        points = [p for part in parts for p in part]
        if len(points) == 1:
            return f"POINT ({_wkt_coords(points, convert)})"
        return "MULTIPOINT (" + ", ".join(
            f"({_wkt_coords([p], convert)})" for p in points) + ")"
    if gtype == _GEOM_LINE:
        lines = [p for p in parts if len(p) >= 2]
        if not lines:
            return None
        if len(lines) == 1:
            return f"LINESTRING ({_wkt_coords(lines[0], convert)})"
        return "MULTILINESTRING (" + ", ".join(
            f"({_wkt_coords(line, convert)})" for line in lines) + ")"
    if gtype == _GEOM_POLYGON:
        # Ring classification keys off the FIRST ring's sign, vector-tile-js's
        # rule: rings winding like the first each start a polygon, opposite
        # winds are holes of the one before. Robust to either absolute
        # convention, which encoders disagree on in practice.
        polygons: List[List[List[Tuple[int, int]]]] = []
        first_sign = None
        for ring in parts:
            if len(ring) < 3:
                continue
            area = _ring_area(ring)
            if area == 0:
                continue
            sign = area > 0
            if first_sign is None:
                first_sign = sign
            if sign == first_sign or not polygons:
                polygons.append([ring])
            else:
                polygons[-1].append(ring)
        if not polygons:
            return None

        def rings_wkt(rings):
            return "(" + ", ".join(
                "(" + _wkt_coords(ring + ring[:1], convert) + ")"
                for ring in rings) + ")"
        if len(polygons) == 1:
            return "POLYGON " + rings_wkt(polygons[0])
        return "MULTIPOLYGON (" + ", ".join(
            rings_wkt(rings) for rings in polygons) + ")"
    return None


def decode_mvt(data: bytes, z: int, x: int, y: int,
               layers: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """
    One tile's features as rows: {"geometry": WKT, "mvt_layer": name, **props}.

    `z, x, y` place the tile, so the WKT comes out in lon/lat. Gzipped tile
    bytes are recognised and inflated. `layers` filters by layer name.
    """
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    wanted = set(layers) if layers is not None else None
    rows: List[Dict[str, Any]] = []

    for field, wire, span in _fields(data, 0, len(data)):
        if field != 3 or wire != 2:
            continue
        lstart, lend = span
        name = ""
        extent = 4096
        keys: List[str] = []
        values: List[Any] = []
        features: List[Tuple[int, int]] = []
        for lfield, lwire, litem in _fields(data, lstart, lend):
            if lfield == 1:
                name = data[litem[0]:litem[1]].decode("utf-8")
            elif lfield == 2:
                features.append(litem)
            elif lfield == 3:
                keys.append(data[litem[0]:litem[1]].decode("utf-8"))
            elif lfield == 4:
                values.append(_decode_value(data, litem))
            elif lfield == 5:
                extent = litem
        if wanted is not None and name not in wanted:
            continue
        convert = _tile_to_lonlat(z, x, y, extent)

        for fstart, fend in features:
            gtype = 0
            tags: List[int] = []
            geom: List[int] = []
            for ffield, fwire, fitem in _fields(data, fstart, fend):
                if ffield == 2:
                    tags = list(_varints(data, fitem[0], fitem[1]))
                elif ffield == 3:
                    gtype = fitem
                elif ffield == 4:
                    geom = list(_varints(data, fitem[0], fitem[1]))
            wkt = _geometry_wkt(gtype, _walk_geometry(geom), convert)
            if wkt is None:
                continue
            row: Dict[str, Any] = {"geometry": wkt, "mvt_layer": name}
            for k in range(0, len(tags) - 1, 2):
                if tags[k] < len(keys) and tags[k + 1] < len(values):
                    row[keys[tags[k]]] = values[tags[k + 1]]
            rows.append(row)
    return rows
