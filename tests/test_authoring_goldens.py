"""
The Python side of the authoring conformance suite.

The goldens under test/goldens/authoring/ are the shared rulebook: Python
generated them (scripts/authoring_goldens.py) and the JS model must reproduce
them byte-for-byte (test/tier1-model.test.mjs). This guard keeps Python itself
from drifting off the committed files: a deliberate rule change regenerates them
(`python scripts/authoring_goldens.py`) and the diff is reviewed like any other
code change -- with the knowledge that the JS side must follow.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
GOLDENS = ROOT / "test" / "goldens" / "authoring"

spec = importlib.util.spec_from_file_location(
    "authoring_goldens", ROOT / "scripts" / "authoring_goldens.py")
gen = importlib.util.module_from_spec(spec)
sys.modules["authoring_goldens"] = gen
spec.loader.exec_module(gen)


@pytest.mark.parametrize("build", gen.SCENARIOS, ids=lambda b: b.__name__)
def test_python_still_produces_the_committed_golden(build):
    name = build.__name__.removeprefix("scenario_")
    committed = json.loads((GOLDENS / f"{name}.json").read_text(encoding="utf-8"))
    fresh = gen.golden_of(build)
    assert fresh["state"] == committed["state"], (
        f"{name}: the authoring rules moved. If deliberate, regenerate with "
        f"`python scripts/authoring_goldens.py`, review the diff, and expect the "
        f"JS model suite to demand the same change.")
    assert fresh["buffers"] == committed["buffers"], f"{name}: buffer bytes moved"
    assert fresh["ops"] == committed["ops"], (
        f"{name}: the op stream moved -- the wire itself changed")


def test_every_scenario_has_a_committed_golden():
    names = {b.__name__.removeprefix("scenario_") for b in gen.SCENARIOS}
    files = {p.stem for p in GOLDENS.glob("*.json")}
    assert names == files
