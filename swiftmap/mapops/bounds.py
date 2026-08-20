"""
Viewport bounds: reading a selection's box, fitting the view, and the auto-fit
that follows the data until the first explicit view statement disarms it.
"""
from typing import Any, List, Optional


def bounds_of(self, target: Any = None, **criteria) -> Optional[List[List[float]]]:
    """
    Returns the bounding box enclosing every matching layer, or None if none match.

    Each layer records its own bounds when it is built, so fitting the view to a
    selection needs nothing from the caller -- no coordinates to pass back in, and no
    second copy of the data to keep in step with the map.

    Parameters
    ----------
    target : str or layer or list, optional
        Matches an id or a name, as in `hide`.
    **criteria
        Further narrowing -- `types`, `exclude_types`, `group`; see `hide`.

    Returns
    -------
    list or None
        `[[min_lat, min_lon], [max_lat, max_lon]]`, or None if nothing matched or no
        match carried bounds.

    Examples
    --------
    >>> m.fit_bounds(m.bounds_of(["Dwell 3", "Dwell 7"]), zoom_offset=-1)
    """
    boxes = [l.get("bounds") for l in self.find_layers(target, **criteria)
             if l.get("bounds")]
    if not boxes:
        return None
    return [
        [min(b[0][0] for b in boxes), min(b[0][1] for b in boxes)],
        [max(b[1][0] for b in boxes), max(b[1][1] for b in boxes)],
    ]


def fit_bounds(self, bounds: Optional[List[List[float]]], zoom_offset: int = 0,
               max_zoom: Optional[int] = None, padding: Optional[int] = None) -> "Map":
    """
    Moves the map viewport to enclose `bounds`.

    Parameters
    ----------
    bounds : list or None
        `[[min_lat, min_lon], [max_lat, max_lon]]`. `None` is accepted and does
        nothing, so `m.fit_bounds(m.bounds_of(sel))` is safe when the selection is
        empty -- the caller does not have to guard it.
    zoom_offset : int, default 0
        Zoom levels to apply after fitting. -1 pulls back one level, so a selection
        is shown with its surroundings rather than filling the frame.
    max_zoom : int, optional
        Ceiling on the zoom the fit may choose. Without it, fitting a single point
        zooms to maximum.
    padding : int, optional
        Pixels of margin to leave on every side.

    Returns
    -------
    Map
        Self reference for method chaining.

    Notes
    -----
    Unlike visibility and styling, this is a command rather than declared state.
    Fitting the same bounds twice moves the map twice, since the user may have panned
    away in between, so repeat calls are deliberately not suppressed.

    Examples
    --------
    >>> m.fit_bounds([[36.0, -5.4], [36.2, -5.2]])
    >>> m.fit_bounds(m.bounds_of("Dwell 3"), zoom_offset=-1, max_zoom=16)
    """
    if not bounds:
        return self
    # An explicit fit is a view choice, so the data stops steering the viewport.
    self._auto_fit_armed = False
    return self._request_fit(bounds, zoom_offset=zoom_offset,
                             max_zoom=max_zoom, padding=padding)


def _request_fit(self, bounds: List[List[float]], zoom_offset: int = 0,
                 max_zoom: Optional[int] = None,
                 padding: Optional[int] = None) -> "Map":
    self._fit_sequence = getattr(self, "_fit_sequence", 0) + 1
    self.fit_bounds_request = {
        "bounds": bounds,
        "zoom_offset": zoom_offset,
        "max_zoom": max_zoom,
        "padding": padding,
        "seq": self._fit_sequence,
    }
    return self


def _disarm_auto_fit(self, change: Any = None) -> None:
    self._auto_fit_armed = False


def _auto_fit_extend(self, config: Any) -> None:
    """
    Grows the auto-fit union with one more layer's bounds and refreshes the fit.

    Every data layer arrives with its bounds already computed, so this is four
    comparisons per add. Basemaps and anything else without bounds contribute
    nothing. Single points still get a sane frame from the max_zoom ceiling.
    """
    if not getattr(self, "_auto_fit_armed", False):
        return
    bounds = config.get("bounds")
    if not bounds:
        return
    (a_lat, a_lon), (b_lat, b_lon) = bounds
    if self._auto_fit_bounds is None:
        self._auto_fit_bounds = [[a_lat, a_lon], [b_lat, b_lon]]
    else:
        u = self._auto_fit_bounds
        u[0][0] = min(u[0][0], a_lat)
        u[0][1] = min(u[0][1], a_lon)
        u[1][0] = max(u[1][0], b_lat)
        u[1][1] = max(u[1][1], b_lon)
    self._request_fit([[self._auto_fit_bounds[0][0], self._auto_fit_bounds[0][1]],
                       [self._auto_fit_bounds[1][0], self._auto_fit_bounds[1][1]]],
                      max_zoom=15, padding=30)
