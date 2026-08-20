"""
Marginalia: the draw/AOI toolbar and the scale bar. Click-coordinates has no
method -- it is just the show_click_coordinates trait -- so it lives here only
in spirit until it grows configuration.
"""
from typing import List, Optional

from .._warnings import warn

_DRAW_TOOLS = frozenset({"marker", "polyline", "rectangle", "polygon", "circle"})
_DRAW_POSITIONS = frozenset({"top-left", "top-right",
                             "bottom-left", "bottom-right"})
_SCALE_UNITS = frozenset({"metric", "imperial", "both", "nautical"})
_SCALE_POSITIONS = frozenset({"top-left", "top-right",
                              "bottom-left", "bottom-right"})


def configure_draw(self, *, show: Optional[bool] = None,
                   tools: Optional[List[str]] = None,
                   position: Optional[str] = None) -> "Map":
    """
    Configures the draw/AOI toolbar. Only the options given change.

    The toolbar draws markers, lines, rectangles, polygons and circles, with
    vertex editing, dragging and deletion. Everything drawn lands in
    `m.drawings` as GeoJSON features, and `draw_seq` bumps on every create,
    edit and delete -- observe that one trait and read `m.drawings` in the
    handler. Setting `m.drawings` from Python seeds shapes onto the map, and
    `clear_drawings()` empties it.

    Parameters
    ----------
    show : bool, optional
        Convenience for setting `show_draw`.
    tools : list of str, optional
        Which draw tools to offer, from 'marker', 'polyline', 'rectangle',
        'polygon', 'circle'. Default: all of them. Edit, drag and delete are
        always available while the toolbar is shown.
    position : str, optional
        A corner: 'top-left' (default), 'top-right', 'bottom-left',
        'bottom-right'.

    Examples
    --------
    >>> m.configure_draw(show=True, tools=["rectangle", "polygon"])
    >>> aoi = m.drawings[0]["geometry"]     # after the analyst draws one
    """
    cfg = dict(self.draw_config)
    if tools is not None:
        bad = [t for t in tools if t not in self._DRAW_TOOLS]
        if bad:
            warn(f"configure_draw: unknown tools {bad!r}; expected a subset of "
                 f"{', '.join(sorted(self._DRAW_TOOLS))}. Ignored.")
        else:
            cfg["tools"] = list(tools)
    if position is not None:
        if position not in self._DRAW_POSITIONS:
            warn(f"configure_draw: position must be a corner "
                 f"({', '.join(sorted(self._DRAW_POSITIONS))}); got {position!r}. "
                 f"Ignored.")
        else:
            cfg["position"] = position
    self.draw_config = cfg
    if show is not None:
        self.show_draw = bool(show)
    return self


def clear_drawings(self) -> "Map":
    """Removes everything drawn with the AOI tools, here and on the map."""
    self.drawings = []
    return self


def configure_scale(self, *, show: Optional[bool] = None,
                    units: Optional[str] = None,
                    position: Optional[str] = None,
                    max_width: Optional[int] = None) -> "Map":
    """
    Configures the scale bar. Only the options given change.

    Parameters
    ----------
    show : bool, optional
        Convenience for setting `show_scale`.
    units : {'metric', 'imperial', 'both', 'nautical'}, optional
        What the bar reads in. 'both' shows metric over imperial; 'nautical'
        shows nautical miles, which Leaflet's own control cannot. The bar
        measures through the map's CRS, so every unit is correct under
        EPSG:4326 too. Default 'metric'.
    position : str, optional
        A corner: 'top-left', 'top-right', 'bottom-left' (default),
        'bottom-right'. Corners only -- Leaflet controls do not anchor to edge
        centres. The legend also defaults bottom-left; move one of them when
        both are on.
    max_width : int, optional
        The bar's maximum width in pixels. Default 120.

    Examples
    --------
    >>> m.configure_scale(show=True, units="nautical")
    >>> m.configure_scale(position="bottom-right", max_width=160)
    """
    cfg = dict(self.scale_config)
    if units is not None:
        if units not in self._SCALE_UNITS:
            warn(f"configure_scale: units must be one of "
                 f"{', '.join(sorted(self._SCALE_UNITS))}; got {units!r}. Ignored.")
        else:
            cfg["units"] = units
    if position is not None:
        if position not in self._SCALE_POSITIONS:
            warn(f"configure_scale: position must be a corner "
                 f"({', '.join(sorted(self._SCALE_POSITIONS))}); got {position!r}. "
                 f"Ignored.")
        else:
            cfg["position"] = position
    if max_width is not None:
        cfg["max_width"] = int(max_width)
    self.scale_config = cfg
    if show is not None:
        self.show_scale = bool(show)
    return self
