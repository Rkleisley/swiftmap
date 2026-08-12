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


def map_effect(source: Any, *, event: Any = None, batch: bool = True,
               ignore_none: bool = True, ignore_init: bool = False) -> Callable:
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
    event
        What `@reactive.event` would take: a reactive dependency, or a list of them, that
        alone triggers the effect. This is an argument rather than a stacked decorator
        because it cannot be one -- see Notes.
    batch : bool, default True
        Coalesce every update in the body into one message. Turn it off only if you need
        the client to see an intermediate state, which is rare and slower.
    ignore_none : bool, default True
        Forwarded to `reactive.event`: skip when the event value is None.
    ignore_init : bool, default False
        Forwarded to `reactive.event`: skip the value the event starts with.

    Returns
    -------
    callable
        A decorator producing a registered `reactive.effect`.

    Notes
    -----
    Do NOT stack `@reactive.event` under this decorator. Shiny checks at decoration time
    that the function it wraps takes no parameters, and the body here takes the map --
    so the stacked form raises TypeError before the app even starts. The event goes
    through the argument instead, and is applied where it belongs, between the zero-arg
    wrapper and the effect registration:

        @map_effect(mapview, event=input.search)
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

    >>> @map_effect(mapview, event=input.btn_search)
    ... async def handle_search(m):
    ...     m.remove_layers(m.find_layers(group="Track"))
    ...     plot_track_on_map(m, generate_points())
    """
    from shiny import reactive

    def decorator(fn: Callable) -> Any:
        # functools.wraps is deliberately NOT used: it sets __wrapped__, which
        # inspect.signature follows, so the zero-arg wrapper would report the body's
        # (m) parameter and fail shiny's no-parameters validation at decoration time.
        if inspect.iscoroutinefunction(fn):
            async def wrapper():
                m = resolve_map(source)
                if m is None:
                    return
                if not batch:
                    return await fn(m)
                with m.batch():
                    return await fn(m)
        else:
            def wrapper():
                m = resolve_map(source)
                if m is None:
                    return
                if not batch:
                    return fn(m)
                with m.batch():
                    return fn(m)

        wrapper.__name__ = getattr(fn, "__name__", "map_effect_handler")
        wrapper.__doc__ = fn.__doc__

        if event is not None:
            events = event if isinstance(event, (list, tuple)) else (event,)
            wrapper = reactive.event(*events, ignore_none=ignore_none,
                                     ignore_init=ignore_init)(wrapper)
        return reactive.effect(wrapper)

    return decorator
