"""
Executes every code cell of every example notebook, in order, and fails loudly.

The gallery's second job: each notebook is a smoke test of the API surface it
demonstrates, so a signature change breaks an example here before it breaks in
someone's shared notebook. Run from the repo root:

    python scripts/run_examples.py

Maps are built but never displayed (no browser, no kernel); this proves the
Python side end to end. Rendering is the manual verification session's job.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"

# The optional extras, exactly as the test suite treats them: a parser or
# imagery test module skips itself when its library is absent, and a notebook
# demonstrating that same surface skips for the same reason. Anything NOT in
# this set failing to import is a real failure -- a broken example, not a
# lean environment.
OPTIONAL_MODULES = {"rasterio", "h3", "polars", "pyarrow", "geopandas",
                    "shapely", "geostructures", "streamlit"}

# Some notebooks write files when run (the export steps). Executing in a scratch
# directory keeps those artifacts out of the repo no matter where this is launched.
os.chdir(tempfile.mkdtemp(prefix="swiftmap-examples-"))

failed = False
for nb_path in sorted(EXAMPLES.glob("*.ipynb")):
    nb = json.loads(nb_path.read_text(encoding="utf-8"))
    ns = {}
    for i, cell in enumerate(nb["cells"]):
        if cell["cell_type"] != "code":
            continue
        src = cell["source"] if isinstance(cell["source"], str) else "".join(cell["source"])
        try:
            exec(compile(src, f"{nb_path.name}:cell-{i}", "exec"), ns)
        except ImportError as exc:
            # Three spellings of the same situation: a bare ModuleNotFoundError,
            # a library's own "pyarrow is required for ..." ImportError, and
            # swiftmap's "needs the h3 package" hint. Each names the module.
            root = (getattr(exc, "name", None) or "").split(".")[0]
            named = root if root in OPTIONAL_MODULES else next(
                (m for m in OPTIONAL_MODULES if m in str(exc)), None)
            if named:
                print(f"SKIP {nb_path.name} (optional dependency "
                      f"'{named}' is not installed)")
            else:
                print(f"FAIL {nb_path.name} cell {i}: {type(exc).__name__}: {exc}")
                failed = True
            break
        except Exception as exc:
            print(f"FAIL {nb_path.name} cell {i}: {type(exc).__name__}: {exc}")
            failed = True
            break
    else:
        print(f"OK   {nb_path.name}")

sys.exit(1 if failed else 0)
