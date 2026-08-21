"""
Marginalia: the draw/AOI toolbar, the scale bar, and the logo card.
Click-coordinates has no method -- it is just the show_click_coordinates trait
-- so it lives here only in spirit until it grows configuration.
"""
import base64
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional

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


_LOGO_POSITIONS = frozenset({"top-left", "top-right",
                             "bottom-left", "bottom-right"})
_LOGO_MIMES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp"}


def _resolve_logo_image(value: Any, slot: str) -> Optional[Dict[str, str]]:
    """
    One logo slot's value -> {"url", "alt"}, or None when the slot is empty.

    A URL or data URI passes through. A path to a local file is read and embedded
    as a data URI, so the image survives a static export and a network with no
    route to wherever the file lived. A plain string gets an empty alt -- never a
    made-up name; the dict form {"url"|"path": ..., "alt": ...} sets one.
    """
    if value is None or value is False or value == "":
        return None
    alt = ""
    if isinstance(value, dict):
        alt = str(value.get("alt") or "")
        value = value.get("url") or value.get("path")
        if not value:
            warn(f"configure_logo: {slot} needs a 'url' or 'path'; the slot was skipped.")
            return None
    if not isinstance(value, (str, Path)):
        warn(f"configure_logo: {slot} must be a URL, a data URI, a file path, or a "
             f"dict with one; got {type(value).__name__}. The slot was skipped.")
        return None
    text = str(value)
    if text.startswith("data:") or "://" in text:
        return {"url": text, "alt": alt}
    path = Path(text)
    if path.is_file():
        mime = (_LOGO_MIMES.get(path.suffix.lower())
                or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        return {"url": f"data:{mime};base64,{data}", "alt": alt}
    warn(f"configure_logo: {slot}={text!r} is neither a URL, a data URI, nor an "
         f"existing file. The slot was skipped.")
    return None


def configure_logo(self, company: Any = None, parent_company: Any = None, *,
                   position: Optional[str] = None, height: Optional[int] = None,
                   show: Optional[bool] = None) -> "Map":
    """
    Configures the logo card -- your branding, two slots. Only the options given
    change.

    The card ships no branding of its own: with `show_logo=True` and neither slot
    set, a small generic swiftmap mark stands in (a proper default mark is coming).
    Set either slot, both, or neither; a slot you do not set does not render, so
    supplying `company` alone shows one image.

    Parameters
    ----------
    company, parent_company : str, dict, False, optional
        A URL, a data URI, or a path to a local image file -- a file is embedded
        as a data URI, so it survives a static export and works on a network that
        cannot reach the file's home. The dict form {"url"|"path": ..., "alt": ...}
        adds alt text; a plain string gets an empty alt. `None` leaves the slot as
        it is; `False` (or "") clears it.
    position : str, optional
        A corner: 'bottom-right' (default), 'bottom-left', 'top-left',
        'top-right'. The legend and scale bar default to bottom-left and the
        sidebar sits top-right, so move one of them when they would share a
        corner.
    height : int, optional
        Image height in pixels. Default 35.
    show : bool, optional
        Convenience for setting `show_logo`.

    Examples
    --------
    >>> m.configure_logo(company="assets/acme.png", show=True)
    >>> m.configure_logo(company={"url": "https://acme.example/logo.svg", "alt": "Acme"},
    ...                  parent_company="data:image/png;base64,...", position="top-left")
    >>> m.configure_logo(parent_company=False)        # drop the second slot
    """
    cfg = dict(self.logo_config)
    for slot, value in (("company", company), ("parent_company", parent_company)):
        if value is None:
            continue
        resolved = _resolve_logo_image(value, slot)
        if resolved is None:
            cfg.pop(slot, None)
        else:
            cfg[slot] = resolved
    if position is not None:
        if position not in _LOGO_POSITIONS:
            warn(f"configure_logo: position must be a corner "
                 f"({', '.join(sorted(_LOGO_POSITIONS))}); got {position!r}. Ignored.")
        else:
            cfg["position"] = position
    if height is not None:
        try:
            cfg["height"] = max(1, int(height))
        except (TypeError, ValueError):
            warn(f"configure_logo: height must be a number of pixels; got {height!r}. "
                 f"Ignored.")
    self.logo_config = cfg
    if show is not None:
        self.show_logo = bool(show)
    return self
