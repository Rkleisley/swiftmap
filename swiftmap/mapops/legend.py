"""
The legend overlay's Python half: display options and manual overrides written
into the legend_config trait. Derivation and rendering live in src/legend.js.
"""
from typing import Any, Dict, List, Optional

from .._warnings import warn

_LEGEND_POSITIONS = frozenset({
    "top-left", "top-center", "top-right", "left-center", "right-center",
    "bottom-left", "bottom-center", "bottom-right"})


def configure_legend(self, *, title: Optional[str] = None,
                     position: Optional[str] = None,
                     auto: Optional[bool] = None,
                     scope: Optional[str] = None,
                     dim_hidden: Optional[bool] = None,
                     show: Optional[bool] = None) -> "Map":
    """
    Configures the legend overlay. Only the options given change.

    Parameters
    ----------
    title : str, optional
        Heading text. Default "Legend".
    position : str, optional
        One of the eight anchors ('bottom-left' default): 'top-left', 'top-center',
        'top-right', 'left-center', 'right-center', 'bottom-left', 'bottom-center',
        'bottom-right'.
    auto : bool, optional
        False turns derivation off entirely: the legend is exactly what
        `legend_add` added. Default True.
    scope : {'all', 'visible'}, optional
        'all' (default) lists every layer that could be shown, dimming hidden
        ones -- a legend is the map's vocabulary. 'visible' tracks the screen:
        unchecking a layer drops its row.
    dim_hidden : bool, optional
        Under scope 'all', whether hidden layers render dimmed. Default True;
        False gives the print-style static legend.
    show : bool, optional
        Convenience for setting `show_legend`.

    Examples
    --------
    >>> m.configure_legend(show=True, position="bottom-right", title="Key")
    >>> m.configure_legend(auto=False)     # manual entries only
    """
    cfg = dict(self.legend_config)
    if title is not None:
        cfg["title"] = title
    if position is not None:
        if position not in self._LEGEND_POSITIONS:
            warn(f"configure_legend: unknown position {position!r}; expected one "
                 f"of {', '.join(sorted(self._LEGEND_POSITIONS))}. Ignored.")
        else:
            cfg["position"] = position
    if auto is not None:
        cfg["auto"] = bool(auto)
    if scope is not None:
        if scope not in ("all", "visible"):
            warn(f"configure_legend: scope must be 'all' or 'visible', got "
                 f"{scope!r}. Ignored.")
        else:
            cfg["scope"] = scope
    if dim_hidden is not None:
        cfg["dim_hidden"] = bool(dim_hidden)
    self.legend_config = cfg
    if show is not None:
        self.show_legend = bool(show)
    return self


def legend_add(self, label: str, *, group: Optional[str] = None,
               shape: Optional[str] = None, color: Optional[str] = None,
               fill_color: Optional[str] = None,
               colormap: Optional[str] = None,
               vmin: Optional[float] = None, vmax: Optional[float] = None,
               color_bins: Optional[List[float]] = None,
               categories: Any = None,
               layer: Optional[str] = None) -> "Map":
    """
    Adds a manual legend entry -- the freedom hatch when derivation misses.

    Manual entries are the user's own claims: scope never drops them and auto=False
    keeps them, so `configure_legend(auto=False)` plus `legend_add` calls builds a
    fully hand-authored legend. Everything is resolved here into frontend-ready
    data, so a manual entry renders identically to a derived one.

    Parameters
    ----------
    label : str
        The entry's text.
    group : str, optional
        Section heading to file it under; ungrouped entries lead the legend.
    shape : {'circle', 'pin', 'line', 'polygon', 'square'}, optional
        Swatch glyph. Default 'square' for a plain colour entry.
    color, fill_color : str, optional
        Swatch stroke and fill (fill defaults to the stroke).
    colormap : str, optional
        Makes this a ramp entry (with vmin/vmax, default 0..1), or with
        `color_bins` a discrete classed entry.
    vmin, vmax : float, optional
        Ramp endpoint labels.
    color_bins : list of float, optional
        Bin edges for a classed entry; colours sample the colormap.
    categories : dict or list, optional
        Makes this a category list: {value: colour} taken as given, or a list of
        values coloured from the palette exactly as `color_col` would.
    layer : str, optional
        A layer id or name to bind to: the entry dims (or drops, under scope
        'visible') with that layer, for when a manual row relabels a live one.

    Examples
    --------
    >>> m.legend_add("Restricted zone", shape="polygon", color="#f00",
    ...              fill_color="#ff000044", group="Zones")
    >>> m.legend_add("Threat score", colormap="turbo", vmin=0, vmax=100)
    >>> m.legend_add("Sightings", categories=["confirmed", "probable"])
    """
    from .._colormaps import (COLORMAPS, DEFAULT_COLORMAP, _category_table,
                              _label_num, rgb_hex, bins_block)
    entry: Dict[str, Any] = {"label": str(label)}
    if group is not None:
        entry["group"] = str(group)
    if layer is not None:
        entry["layer"] = layer

    if categories is not None:
        if isinstance(categories, dict):
            items = [{"value": str(k), "color": v} for k, v in categories.items()]
        else:
            values = [str(v) for v in categories]
            table = _category_table(len(values), colormap, quiet=False)
            items = [{"value": v, "color": rgb_hex(table[i])}
                     for i, v in enumerate(values)]
        entry.update({"kind": "categories", "items": items})
    elif colormap is not None and color_bins is not None:
        entry.update(bins_block(colormap, color_bins))
    elif colormap is not None:
        anchors = COLORMAPS.get(str(colormap).lower())
        if anchors is None:
            warn(f"legend_add: unknown colormap {colormap!r}; using "
                 f"{DEFAULT_COLORMAP!r}.")
            anchors = COLORMAPS[DEFAULT_COLORMAP]
        entry.update({"kind": "ramp", "anchors": list(anchors),
                      "vmin": _label_num(vmin if vmin is not None else 0),
                      "vmax": _label_num(vmax if vmax is not None else 1)})
    else:
        entry.update({"kind": "swatch", "shape": shape or "square",
                      "color": color or "#3388ff",
                      "fillColor": fill_color or color or "#3388ff"})

    cfg = dict(self.legend_config)
    cfg["add"] = list(cfg.get("add", [])) + [entry]
    self.legend_config = cfg
    return self


def legend_remove(self, target: Optional[str] = None, *,
                  group: Optional[str] = None,
                  id: Optional[str] = None) -> "Map":
    """
    Suppresses legend entries matching the criteria -- derived or manual.

    A persistent matcher, not a one-shot deletion: it keeps suppressing across
    every re-derivation, so a hidden row stays hidden however the layers change.
    Any combination of label, group and id must all match.

    Examples
    --------
    >>> m.legend_remove("Sites")            # by label
    >>> m.legend_remove(group="Debug")      # a whole section
    """
    if target is None and group is None and id is None:
        warn("legend_remove: nothing to match -- give a label, group=, or id=.")
        return self
    matcher: Dict[str, Any] = {}
    if target is not None:
        matcher["label"] = str(target)
    if group is not None:
        matcher["group"] = str(group)
    if id is not None:
        matcher["id"] = id
    cfg = dict(self.legend_config)
    cfg["remove"] = list(cfg.get("remove", [])) + [matcher]
    self.legend_config = cfg
    return self


def legend_clear(self) -> "Map":
    """Drops every manual entry and suppression; display options are kept."""
    cfg = {k: v for k, v in self.legend_config.items()
           if k not in ("add", "remove")}
    self.legend_config = cfg
    return self


def legend_html(self) -> str:
    """
    Returns a plain HTML listing of layer names with colour chips, or "" when
    `show_legend` is False.

    Legacy beside the real legend: the map now draws a full overlay itself --
    derived entries, ramps and size keys from color_col/radius_col, and the
    `legend_add`/`legend_remove` overrides -- switched on with `show_legend=True`
    and configured through `configure_legend`. This property predates all of that
    and renders none of it; it survives only for layouts that embed a simple
    list outside the map. Expect it to be retired.
    """
    if not self.show_legend:
        return ""
    items = []
    for l in self.layers:
        name = l.get("name", "Layer")
        color = l.get("color", "#3388ff")
        items.append(f"<div><span style='background:{color};width:10px;height:10px;display:inline-block;margin-right:5px;'></span>{name}</div>")
    return "".join(items)
