"""
A minimal PNG encoder: 8-bit RGBA, filter 0, one zlib stream.

In the hand-typed-colormaps tradition: imagery has to work on networks where
installing an encoder is harder than carrying thirty lines of stdlib, so no
Pillow. Browsers and the frontend decode the result natively.
"""
import struct
import zlib


def encode_png(rgba: bytes, width: int, height: int) -> bytes:
    """Row-major RGBA bytes (4 per pixel) -> a complete PNG file."""
    if len(rgba) != width * height * 4:
        raise ValueError(
            f"encode_png: {len(rgba)} bytes is not {width}x{height} RGBA")

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    stride = width * 4
    view = memoryview(rgba)
    raw = bytearray()
    for y in range(height):
        raw.append(0)                        # filter type 0 per scanline
        raw += view[y * stride:(y + 1) * stride]
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))
