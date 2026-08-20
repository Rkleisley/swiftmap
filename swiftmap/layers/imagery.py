"""
Georeferenced raster ingest. rasterio warps the pixels into the MAP's own CRS
grid, which is what makes the frontend's linear corner stretch exactly correct
-- rotation, skew and odd source CRSs are all absorbed here, once. Python
projects; JS renders a dumb image overlay.
"""
from pathlib import Path
from typing import Optional, Union

import numpy as np

from ._batching import batched
from .._png import encode_png
from .._warnings import warn

_RESAMPLING = frozenset({"nearest", "bilinear", "cubic", "average"})


@batched
def add_imagery(
    self,
    source: Union[str, Path],
    name: Optional[str] = None,
    layer_group: str = "Imagery",
    visible: bool = True,
    opacity: float = 1.0,
    colormap: Optional[str] = None,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
    max_size: int = 2048,
    resampling: str = "bilinear",
    **kwargs
) -> "Map":
    """
    Adds a georeferenced raster -- a GeoTIFF, a COG, anything GDAL reads -- as
    an image overlay.

    The raster is reprojected into the map's own CRS, rendered to a PNG, and
    pinned to its bounds; nothing else is asked of the caller. RGB(A) rasters
    keep their colours; a single-band raster is coloured through a house
    colormap. Nodata pixels are transparent. Requires rasterio
    (`pip install rasterio`), an optional dependency.

    Parameters
    ----------
    source : str or Path
        The raster file. Any format and CRS GDAL understands.
    name : str, optional
        Sidebar name. Defaults to the file's stem.
    layer_group : str, default 'Imagery'
        Folder name in sidebar controls.
    visible : bool, default True
        Initial visibility state.
    opacity : float, default 1.0
        Overlay opacity, 0..1.
    colormap : str, optional
        For single-band rasters: the colormap name ('viridis' default). Ignored
        with a warning on RGB rasters.
    vmin, vmax : float, optional
        Single-band colour ramp endpoints. Default: the band's own extremes.
    max_size : int, default 2048
        Longest edge of the rendered image in pixels; larger rasters are
        downsampled on read. An overlay is context, not native-resolution
        analysis, and this keeps the payload proportionate.
    resampling : {'bilinear', 'nearest', 'cubic', 'average'}, default 'bilinear'
        Resampling for both the warp and the downsample.
    **kwargs
        Further layer attributes, passed through to the config.

    Returns
    -------
    Map
        Self reference for method chaining.

    Examples
    --------
    >>> m.add_imagery("scene.tif", opacity=0.8)
    >>> m.add_imagery("elevation.tif", colormap="turbo", vmin=0, vmax=1500)
    """
    try:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.vrt import WarpedVRT
        from rasterio.warp import transform_bounds
    except ImportError:
        raise ImportError(
            "add_imagery reads rasters through rasterio, which is not "
            "installed. pip install rasterio. It stays an optional dependency "
            "so the core carries no GDAL.") from None

    if resampling not in _RESAMPLING:
        warn(f"add_imagery: resampling must be one of "
             f"{', '.join(sorted(_RESAMPLING))}; got {resampling!r}. "
             f"Using 'bilinear'.")
        resampling = "bilinear"
    method = Resampling[resampling]

    # Warp into the map's CRS: the frontend stretches the image linearly
    # between its corner latlngs THROUGH that CRS, so a grid in any other
    # projection would render smeared. The projections discipline, raster form.
    with rasterio.open(source) as src:
        with WarpedVRT(src, crs=self.crs, resampling=method) as vrt:
            scale = min(1.0, float(max_size) / max(vrt.width, vrt.height))
            out_w = max(1, round(vrt.width * scale))
            out_h = max(1, round(vrt.height * scale))
            data = vrt.read(out_shape=(vrt.count, out_h, out_w),
                            resampling=method).astype(np.float64)
            mask = vrt.read_masks(1, out_shape=(out_h, out_w),
                                  resampling=Resampling.nearest)
            source_is_u8 = vrt.dtypes[0] == "uint8"
            west, south, east, north = transform_bounds(
                self.crs, "EPSG:4326", *vrt.bounds)

    count = data.shape[0]
    valid = mask > 0

    if count >= 3:
        if colormap is not None or vmin is not None or vmax is not None:
            warn(f"add_imagery: colormap/vmin/vmax apply to single-band "
                 f"rasters; this one has {count} bands. Ignored.")
        rgb = np.empty((out_h, out_w, 3), dtype=np.uint8)
        for c in range(3):
            band = data[c]
            if source_is_u8:
                rgb[..., c] = np.clip(band, 0, 255).astype(np.uint8)
            else:
                sel = band[valid]
                lo = float(sel.min()) if sel.size else 0.0
                hi = float(sel.max()) if sel.size else 1.0
                span = (hi - lo) or 1.0
                rgb[..., c] = np.clip((band - lo) / span * 255.0,
                                      0, 255).astype(np.uint8)
        if count >= 4:
            a = data[3]
            if not source_is_u8:
                top = float(a[valid].max()) if valid.any() else 1.0
                a = a / (top or 1.0) * 255.0
            alpha = np.clip(a, 0, 255).astype(np.uint8)
        else:
            alpha = np.full((out_h, out_w), 255, dtype=np.uint8)
        alpha[~valid] = 0
    else:
        if count == 2:
            warn("add_imagery: 2-band raster; colouring the first band and "
                 "ignoring the second.")
        band = np.where(valid, data[0], np.nan)
        finite = band[np.isfinite(band)]
        lo = float(vmin) if vmin is not None else \
            (float(finite.min()) if finite.size else 0.0)
        hi = float(vmax) if vmax is not None else \
            (float(finite.max()) if finite.size else 1.0)
        span = (hi - lo) or 1.0
        t = np.clip(np.nan_to_num((band - lo) / span), 0.0, 1.0)
        from .._colormaps import _ramp, _sample, DEFAULT_COLORMAP
        ramp = _ramp(colormap or DEFAULT_COLORMAP)
        rgb = np.clip(_sample(ramp, t.ravel()), 0, 255).astype(np.uint8) \
            .reshape(out_h, out_w, 3)
        alpha = np.where(np.isfinite(band), 255, 0).astype(np.uint8)

    png = encode_png(np.dstack([rgb, alpha]).tobytes(), out_w, out_h)

    if name is None:
        name = Path(str(source)).stem or "Imagery"

    layer_id = f"layer_{self._layer_counter}"
    self._layer_counter += 1
    self._set_layer_buffer(layer_id, png)
    self.add_child({
        "id": layer_id,
        "type": "image",
        "name": name,
        "layer_group": layer_group,
        "visible": visible,
        "opacity": float(opacity),
        "image_format": "image/png",
        "bounds": [[south, west], [north, east]],
        **kwargs
    })
    return self
