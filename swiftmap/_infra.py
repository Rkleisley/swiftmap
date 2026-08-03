import pathlib

class LayerConfig:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
        
    def to_dict(self):
        return self.__dict__
        
    def get(self, key, default=None):
        return self.__dict__.get(key, default)
        
    def __getitem__(self, key):
        return self.__dict__[key]
        
    def __setitem__(self, key, value):
        self.__dict__[key] = value
        
    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(f"'LayerConfig' object has no attribute '{name}'")
        try:
            return self.__dict__[name]
        except KeyError:
            if name == "visible":
                return True
            return None

    def __setattr__(self, name, value):
        self.__dict__[name] = value

    def __contains__(self, key):
        return key in self.__dict__

_STATIC_DIR = pathlib.Path(__file__).parent / "static"


def _widget_css_path():
    return _STATIC_DIR / "widget.css"


def _load_esm():
    """
    Returns the built anywidget bundle.

    The JS is a real ES module graph under src/ and is bundled by esbuild (`npm run build`),
    which writes the artifact here. The same source also builds to dist/ for npm consumers,
    so the browser bundle and the Python widget are never separate implementations.
    """
    bundle = _STATIC_DIR / "widget.js"
    if not bundle.exists():
        raise FileNotFoundError(
            f"swiftmap's JavaScript bundle is missing at {bundle}.\n"
            "It is a build artifact -- run `npm install && npm run build` in the repo root."
        )
    return bundle.read_text(encoding="utf-8")
