from .map import Map
from ._colormaps import register_colormap

# Read from the installed package's own metadata, so this can never disagree with
# the wheel it shipped in; the fallback covers a source tree that was never
# pip-installed.
try:
    from importlib.metadata import version as _version
    __version__ = _version("swiftmap")
except Exception:
    __version__ = "0.0.0.dev0"

__all__ = [
    "Map",
    "register_colormap",
    "__version__",
]
