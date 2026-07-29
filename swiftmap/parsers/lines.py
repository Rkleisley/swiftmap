from typing import Optional, Any, Tuple
from .base import GeometryParserRegistry

lines_registry = GeometryParserRegistry("lines")

def parse_lines(data: Any, **kwargs) -> Tuple:
    """
    Public entrypoint for polyline data parsing strategies.
    (To be implemented in the next layer).
    """
    raise NotImplementedError("Line parsing strategy dispatching will be implemented soon.")
