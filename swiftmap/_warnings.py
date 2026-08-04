import warnings


class SwiftMapWarning(UserWarning):
    """
    Base category for everything swiftmap warns about.

    Grouped under one class so an application can silence or escalate swiftmap's warnings
    without touching anything else:

        warnings.filterwarnings("error", category=SwiftMapWarning)
    """


class EmptyLayerWarning(SwiftMapWarning):
    """
    An `add_*` call found no geometry of the kind it was asked for, so added no layer.

    Raising here would be worse than it looks. Map building is a chain -- add_markers,
    then add_line, then add_polygon -- and an exception partway through discards every
    layer already added, leaving nothing to render. A warning reports the problem and
    still lets the rest of the map draw.

    `add_collection` asks all three parsers speculatively, so it suppresses this category:
    a collection of polygons is not expected to contain points.
    """


def warn(message: str, category: type = SwiftMapWarning, stacklevel: int = 4) -> None:
    """
    Emits a swiftmap warning.

    The default stacklevel of 4 lands on the caller's `add_*` line: this helper, the
    add_* body, the @batched wrapper, then user code.
    """
    warnings.warn(f"[SwiftMap] {message}", category, stacklevel=stacklevel)
