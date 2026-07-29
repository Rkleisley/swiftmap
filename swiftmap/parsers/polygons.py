from typing import Optional, Any, Tuple
from .base import GeometryParserRegistry

polygons_registry = GeometryParserRegistry("polygons")

def parse_polygons(data: Any, **kwargs) -> Tuple:
    """
    Public entrypoint for polygon data parsing strategies.
    (To be implemented in the next layer).
    """
    raise NotImplementedError("Polygon parsing strategy dispatching will be implemented soon.")
