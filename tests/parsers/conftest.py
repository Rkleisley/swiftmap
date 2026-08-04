"""
Optional-dependency guards.

Every parser source except lists_dicts sits behind a third-party library. Contributors
without geopandas should get skips, not a red suite -- but nothing here is skipped in an
environment that has them installed, so a missing library never hides a real failure.
"""
import pytest


def require(module_name):
    """Imports an optional parser dependency or skips the module that needs it."""
    return pytest.importorskip(module_name)
