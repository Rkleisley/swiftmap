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
import sys
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"

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
        except Exception as exc:
            print(f"FAIL {nb_path.name} cell {i}: {type(exc).__name__}: {exc}")
            failed = True
            break
    else:
        print(f"OK   {nb_path.name}")

sys.exit(1 if failed else 0)
