# Swiftmap Custom AnyWidget Map Controller (Reloaded JS version v39)
import anywidget
import traitlets
import numpy as np
from typing import Optional, List, Dict, Any, Union
import pathlib
from ._infra import LayerConfig, _load_esm

# Import layer methods
from .layers.basemap import add_basemap
from .layers.circle_markers import add_circle_markers
from .layers.markers import add_markers
from .layers.polyline import add_polyline
from .layers.polygon import add_polygon
from .layers.geojson import add_geojson
from .layers.circle import add_circle

def _layers_from_json(value, widget):
    if not value:
        return []
    return [LayerConfig(**item) if isinstance(item, dict) else item for item in value]

class Map(anywidget.AnyWidget):
    _esm = _load_esm()
    _css = pathlib.Path(__file__).parent / "js" / "map.css"

    # Assign helper methods
    add_basemap = add_basemap
    add_circle_markers = add_circle_markers
    add_markers = add_markers
    add_polyline = add_polyline
    add_polygon = add_polygon
    add_geojson = add_geojson
    add_circle = add_circle

    # Synchronized traits
    center = traitlets.List([36.0, -5.35]).tag(sync=True)
    zoom = traitlets.Int(10).tag(sync=True)
    crs = traitlets.Unicode("EPSG:3857").tag(sync=True)
    layers = traitlets.List([]).tag(
        sync=True, 
        to_json=lambda lst, _: [item.to_dict() if hasattr(item, 'to_dict') else item for item in lst],
        from_json=_layers_from_json
    )
    coordinate_buffers = traitlets.Dict({}).tag(sync=True)
    show_logo = traitlets.Bool(False).tag(sync=True)
    group_configs = traitlets.Dict(default_value={}).tag(sync=True)
    
    # Selection and click interaction tracking
    selected_index = traitlets.Int(-1).tag(sync=True)
    clicked_layer_id = traitlets.Unicode("").tag(sync=True)
    fit_bounds_coords = traitlets.List([]).tag(sync=True)
    js_console_logs = traitlets.List([]).tag(sync=True)
    auto_sync = traitlets.Bool(True).tag(sync=True)
    sync_trigger = traitlets.Int(0).tag(sync=True)
 
    def __init__(
        self,
        center: List[float] = [36.0, -5.35],
        zoom: int = 10,
        show_legend: bool = False,
        show_logo: bool = True,
        height: Optional[str] = None,
        crs: str = "EPSG:3857",
        auto_sync: bool = True,
        **kwargs
    ):
        super().__init__(**kwargs)
        self.center = center
        self.zoom = zoom
        self.crs = crs
        self.show_legend = show_legend
        self.show_logo = show_logo
        self.auto_sync = auto_sync
        
        # Internal layer list counter
        self._layer_counter = 0
        
        # Initialize default basemaps based on projection
        if self.crs == "EPSG:4326":
            self.add_basemap("Esri WGS84", layer_group="Basemaps", group_multi_select=False, visible=True)
        else:
            self.add_basemap("Open Street Map", layer_group="Basemaps", group_multi_select=False, visible=True)
            self.add_basemap("Dark Matter", layer_group="Basemaps", group_multi_select=False, visible=False)

    def add_child(self, child: Any, name: Optional[str] = None, layer_group: Optional[str] = None, group_multi_select: Optional[bool] = None) -> "Map":
        """Adds a layer or configuration metadata config directly to the map's layers list."""
        from .layers._add_child import add_child as add_child_fn
        return add_child_fn(self, child, name=name, layer_group=layer_group, group_multi_select=group_multi_select)

    def add_layer(self, layer: Any) -> "Map":
        """Compatibility wrapper for standard Leaflet add_layer syntax."""
        self.add_child(layer)
        return self

    def configure_group(self, group_name: str, **kwargs) -> "Map":
        """Configures properties (such as multi_select, visible) for a layer group."""
        new_configs = dict(self.group_configs)
        group_conf = dict(new_configs.get(group_name, {}))
        
        for k, v in kwargs.items():
            if k in ("multi_select", "group_multi_select"):
                group_conf["multi_select"] = v
            else:
                group_conf[k] = v
                
        new_configs[group_name] = group_conf
        self.group_configs = new_configs
        return self

    def remove_layer(self, name_or_id: Any) -> "Map":
        """Removes a layer from the map by name or ID."""
        if isinstance(name_or_id, dict):
            target_id = name_or_id.get("id")
            target_name = name_or_id.get("name")
        else:
            target_id = getattr(name_or_id, "id", name_or_id)
            target_name = getattr(name_or_id, "name", name_or_id)
        
        self.layers = [
            l for l in self.layers
            if l.get("id") != target_id and l.get("name") != target_name
        ]
        # Clean up any associated binary buffer
        if target_id in self.coordinate_buffers:
            del self.coordinate_buffers[target_id]
        return self

    def fit_bounds(self, bounds: List[List[float]]) -> "Map":
        """Sets the center/zoom viewport in the client to fit the given bounds."""
        self.fit_bounds_coords = bounds
        return self

    def get_layer(self, identifier: Union[str, Any], name: Optional[str] = None) -> Optional[LayerConfig]:
        """Finds and returns a layer matching by ID, name, or group + name."""
        target_id = getattr(identifier, "id", identifier)
        target_name = getattr(identifier, "name", identifier)
        
        for l in self.layers:
            if name is not None:
                # Group and Name lookup
                if l.get("layer_group") == identifier and l.get("name") == name:
                    return l
            else:
                # Name or ID lookup
                if l.get("id") == target_id or l.get("name") == target_name:
                    return l
        return None

    def update_layer(self, identifier: Union[str, Any], name: Optional[str] = None, **kwargs) -> "Map":
        """
        Updates attributes of a layer (e.g. visible, color) and forces a traitlets sync.
        Automatically handles replacing the LayerConfig with a new instance.
        """
        target_id = getattr(identifier, "id", identifier)
        target_name = getattr(identifier, "name", identifier)
        
        updated_layers = []
        found = False
        
        for l in self.layers:
            # Check if this is the target layer
            match = False
            if name is not None:
                if l.get("layer_group") == identifier and l.get("name") == name:
                    match = True
            else:
                if l.get("id") == target_id or l.get("name") == target_name:
                    match = True
                    
            if match:
                # Create a brand-new LayerConfig instance with updated values
                new_dict = {**l.to_dict(), **kwargs}
                new_layer = LayerConfig(**new_dict)
                updated_layers.append(new_layer)
                found = True
            else:
                updated_layers.append(l)
                
        if found:
            self.layers = updated_layers
        return self

    def set_layer_visibility(self, identifier: Union[str, Any], visible: bool, name: Optional[str] = None) -> "Map":
        """Sets the visibility of a layer and synchronizes the change to the client."""
        return self.update_layer(identifier, name=name, visible=visible)

    def sync(self) -> "Map":
        """Manually synchronizes the map state and forces a render on the frontend."""
        self.sync_trigger += 1
        return self
