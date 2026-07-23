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

def _load_esm():
    js_dir = pathlib.Path(__file__).parent / "js"
    map_code = (js_dir / "map.js").read_text(encoding="utf-8")
    utils_code = (js_dir / "utils.js").read_text(encoding="utf-8")
    sidebar_code = (js_dir / "sidebar.js").read_text(encoding="utf-8")
    shaders_code = (js_dir / "shaders.js").read_text(encoding="utf-8")
    layers_code = (js_dir / "layers.js").read_text(encoding="utf-8")
    
    utils_clean = utils_code.replace("export function ", "function ")
    sidebar_clean = sidebar_code.replace("export function ", "function ")
    
    shaders_clean = shaders_code.replace("export const ", "const ")
    for line in shaders_clean.splitlines():
        if "import " in line:
            shaders_clean = shaders_clean.replace(line, "")
            
    layers_clean = layers_code
    for line in layers_clean.splitlines():
        if "import {" in line and ("utils.js" in line or "shaders.js" in line):
            layers_clean = layers_clean.replace(line, "")
    layers_clean = layers_clean.replace("export async function ", "async function ")
    
    map_lines = []
    for line in map_code.splitlines():
        if "import " in line and ("utils.js" in line or "sidebar.js" in line or "layers.js" in line):
            continue
        map_lines.append(line)
    map_clean = "\n".join(map_lines)
    
    return f"""
// --- UTILS ---
{utils_clean}

// --- SHADERS ---
{shaders_clean}

// --- SIDEBAR ---
{sidebar_clean}

// --- LAYERS ---
{layers_clean}

// --- MAIN ENTRY ---
{map_clean}
"""
