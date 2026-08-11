"""
Shiny helpers.

`shiny` and `shinywidgets` are optional; nothing here is imported unless you ask for it.

The pattern this encodes matters more than the convenience. `@render_widget` rebuilds the
widget whenever a reactive dependency invalidates, which throws the map away and re-uploads
every coordinate buffer -- the opposite of what the patch transport exists for. So the
render function should depend on nothing that changes, and every update should run against
the live instance from an effect:

    @render_widget
    def mapview():
        return Map().add_circle_markers(sites, name="Sites")   # built once

    @map_effect(mapview)
    def _(m):
        m.select(chosen, scope="Dwells", zoom=True, zoom_offset=-1)
"""
import functools
import inspect
from typing import Any, Callable, Optional


def resolve_map(source: Any) -> Optional[Any]:
    """
    Finds the live Map behind whatever was passed, or None if it does not exist yet.

    Accepts a `@render_widget` renderer, a Map, or a callable returning either, because
    which of those you have depends on how the app is wired and none of them is wrong.

    None is a normal answer, not a failure: an effect can run before the widget has
    rendered, and the `if m_widget is None: return` line at the top of every handler is
    exactly the boilerplate this exists to absorb.
    """
    seen = 0
    while source is not None and seen < 5:
        if hasattr(source, "add_circle_markers"):     # a Map, without importing it
            return source
        if hasattr(source, "widget"):                 # a shinywidgets renderer
            source = source.widget
        elif callable(source):
            source = source()
        else:
            return None
        seen += 1
    return None


def map_effect(source: Any, *, batch: bool = True) -> Callable:
    """
    Runs a reactive effect against the live map, with the usual ceremony removed.

    Replaces `@reactive.Effect`. The decorated function takes the map as its only
    argument and can assume it exists.

    Three things are handled: the widget is resolved and the effect skips quietly if it
    has not rendered yet; a `batch()` is opened so several updates leave as one message;
    and the batch closes on the way out, so no explicit `sync()` is needed.

    Parameters
    ----------
    source
        A `@render_widget` renderer, a Map, or a callable returning either.
    batch : bool, default True
        Coalesce every update in the body into one message. Turn it off only if you need
        the client to see an intermediate state, which is rare and slower.

    Returns
    -------
    callable
        A decorator producing a registered `reactive.effect`.

    Notes
    -----
    Composes with `@reactive.event`, which goes underneath so it applies to the function
    rather than to the effect:

        @map_effect(mapview)
        @reactive.event(input.search)
        def _(m): ...

    `async def` is supported. The batch is held across any `await` inside the body, so the
    map updates once the handler finishes rather than partway through -- awaiting a slow
    call mid-body delays the map with it. Pass `batch=False` if that ordering matters more
    than the single message.

    Examples
    --------
    >>> @map_effect(mapview)
    ... def zoom_to_selected(m):
    ...     rows = (table.cell_selection() or {}).get("rows", [])
    ...     m.select([dwell_ids[i] for i in rows], scope="Dwells",
    ...              zoom=True, zoom_offset=-1)
    """
    from shiny import reactive

    def decorator(fn: Callable) -> Any:
        if inspect.iscoroutinefunction(fn):
            @reactive.effect
            @functools.wraps(fn)
            async def wrapper():
                m = resolve_map(source)
                if m is None:
                    return
                if not batch:
                    return await fn(m)
                with m.batch():
                    return await fn(m)
        else:
            @reactive.effect
            @functools.wraps(fn)
            def wrapper():
                m = resolve_map(source)
                if m is None:
                    return
                if not batch:
                    return fn(m)
                with m.batch():
                    return fn(m)
        return wrapper

    return decorator
