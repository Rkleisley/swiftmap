"""
Patch transport and the layers-list mutation invariants.

Reassigning `layers` or `coordinate_buffers` makes traitlets serialize and send
the ENTIRE map, so one added dwell costs O(everything already plotted). These
helpers instead update the trait storage in place (no notification, therefore no
full-snapshot send) and emit a small patch describing just what changed.

The traits stay tagged sync=True on purpose: ipywidgets sends full state when a
view first attaches, which is exactly the snapshot a fresh or late-joining client
needs, and the frontend still writes `layers` back for sidebar toggles.

THE INVARIANT ROOM: the merge index in _merge_lookup is keyed to the layers
LIST OBJECT's identity. Every mutation path here builds a new list and
refreshes the index in step. If a new mutator ever changes the layers list IN
PLACE, the index goes stale silently -- don't.
"""
from typing import Any, Dict, List, Optional


def _layer_to_dict(item):
    return item.to_dict() if hasattr(item, "to_dict") else item


def _handle_client_msg(self, widget: Any, content: Any, buffers: Any) -> None:
    if not isinstance(content, dict):
        return
    kind = content.get("kind")
    if kind == "swiftmap_ready":
        self.resync()
    elif kind == "swiftmap_write":
        # The sidebar's toggle write-back, field-level by construction. The frontend
        # used to write the whole layers trait to flip one boolean, so the frame
        # scaled with the map instead of the click -- 36 MB at 25 tracks x 200k
        # vertices, past uvicorn's 16 MB default websocket cap, which closes the
        # connection and takes the Shiny session with it. _set_layer_fields re-emits
        # each applied write as a tiny `set` patch, which is what keeps other views
        # of this map (notebook outputs) in step now that the trait carries nothing.
        # Top-level layers AND merged-group members: the sidebar's cascade
        # writes member flags too (a merged entry's checkbox is the whole
        # entry), and an id the index misses is an op silently dropped.
        by_id = {}
        for l in self.layers:
            by_id[l.get("id")] = l
            for sub in (l.get("layers") or []):
                by_id[sub.get("id")] = sub
        with self.batch():
            for op in content.get("ops") or []:
                if not isinstance(op, dict) or op.get("op") != "set":
                    continue
                target = by_id.get(op.get("id"))
                fields = op.get("fields")
                if target is not None and isinstance(fields, dict):
                    self._set_layer_fields([target], fields)


def _set_trait_quietly(self, name: str, value: Any) -> None:
    """Updates trait storage without firing a notification (and so without a full send)."""
    self._trait_values[name] = value
    self._state_seq += 1


def _emit(self, op: Dict[str, Any], buffer: Optional[bytes] = None) -> None:
    """Queues a patch op, flushing immediately unless a batch() is open."""
    # Hosts without a comm (the Streamlit component) never see these ops; the
    # Map's change counter is how they learn that something changed.
    self._state_seq += 1
    if buffer is not None:
        op = {**op, "buffer_index": len(self._pending_buffers)}
        self._pending_buffers.append(buffer)
    self._pending_ops.append(op)
    if self._batch_depth == 0:
        self._flush_ops()


def _flush_ops(self) -> None:
    ops, buffers = self._pending_ops, self._pending_buffers
    self._pending_ops, self._pending_buffers = [], []
    if not ops:
        return
    # No comm yet (widget built outside a live session): the trait values are already
    # correct, so the initial state message will carry them.
    if getattr(self, "comm", None) is None:
        return
    self.send({"kind": "swiftmap_patch", "ops": ops}, buffers=buffers)


def _merge_lookup(self, layer_group: Any, name: Any) -> Optional[Any]:
    """
    The existing layer a new (layer_group, name) would merge into, if any.

    add_child used to scan every layer per add, which made bulk adds quadratic:
    35 million attribute reads to ingest 6k polygons. The index is keyed to the
    layers LIST OBJECT -- every mutation path builds a new list, so an identity
    mismatch means some other path changed the layers and the index rebuilds once;
    the append/replace paths below refresh it in step, keeping a batch of adds
    O(1) per add.
    """
    layers = self.layers
    cache = getattr(self, "_merge_cache", None)
    if cache is None or cache[0] is not layers:
        index = {}
        for l in layers:
            index[(l.get("layer_group"), l.get("name"))] = l
        cache = (layers, index)
        self._merge_cache = cache
    return cache[1].get((layer_group, name))


def _layers_append(self, config: Any) -> None:
    new_layers = self.layers + [config]
    self._set_trait_quietly("layers", new_layers)
    cache = getattr(self, "_merge_cache", None)
    if cache is not None:
        cache[1][(config.get("layer_group"), config.get("name"))] = config
        self._merge_cache = (new_layers, cache[1])
    self._emit({"op": "add", "layer": _layer_to_dict(config)})


def _layers_replace(self, existing: Any, config: Any,
                    emit_ops: Optional[List[Dict[str, Any]]] = None) -> None:
    """
    Swaps one layer's config for a new instance (new list, merge index kept in
    step) and tells the client. By default that is one `replace` carrying the
    whole config; `emit_ops` substitutes smaller ops when the caller can describe
    the change in less -- an append sends only its new rows this way, since a
    message that scales with accumulated data instead of with the change is what
    closes the websocket (see the toggle write-back, 6de6d5a).
    """
    new_layers = [config if l is existing else l for l in self.layers]
    self._set_trait_quietly("layers", new_layers)
    cache = getattr(self, "_merge_cache", None)
    if cache is not None:
        old_key = (existing.get("layer_group"), existing.get("name"))
        if cache[1].get(old_key) is existing:
            del cache[1][old_key]
        cache[1][(config.get("layer_group"), config.get("name"))] = config
        self._merge_cache = (new_layers, cache[1])
    if emit_ops is None:
        emit_ops = [{"op": "replace", "id": config.get("id"), "layer": _layer_to_dict(config)}]
    for op in emit_ops:
        self._emit(op)


def _layers_set(self, new_layers: List[Any], removed_ids: List[Any]) -> None:
    self._set_trait_quietly("layers", new_layers)
    for layer_id in removed_ids:
        if layer_id is not None:
            self._emit({"op": "remove", "id": layer_id})


def _layers_update_many(self, new_layers: List[Any], changed: List[Any]) -> None:
    self._set_trait_quietly("layers", new_layers)
    for config in changed:
        self._emit({"op": "replace", "id": config.get("id"), "layer": _layer_to_dict(config)})


def _set_layer_buffer(self, layer_id: str, payload: bytes) -> None:
    """
    Stores one layer's coordinate buffer and sends only that buffer to the client.

    In place, not a copy: rebuilding the dict per layer made bulk adds quadratic
    in buffer count. The trait's value never changes identity here, which is fine
    -- it is set quietly everywhere and synced by the buffer op below.
    """
    self.coordinate_buffers[layer_id] = payload
    self._emit({"op": "buffer", "id": layer_id}, buffer=payload)


def _append_layer_buffer(self, layer_id: str, tail: bytes) -> None:
    """
    Grows one buffer by `tail` and sends ONLY the tail; the client concatenates
    onto what it holds. The feed primitive's wire cost: proportional to the
    batch, flat across the life of the layer.
    """
    self.coordinate_buffers[layer_id] = self.coordinate_buffers.get(layer_id, b"") + tail
    self._emit({"op": "buffer_append", "id": layer_id}, buffer=tail)


def _remove_layer_buffers(self, layer_ids: Any) -> None:
    buffers = dict(self.coordinate_buffers)
    # A layer may own auxiliary buffers under "<id>::<kind>" -- per-feature times ride
    # that way -- so removing a layer removes everything keyed under its id.
    removed = [key for key in buffers
               for lid in layer_ids
               if key == lid or (lid is not None and key.startswith(f"{lid}::"))]
    if not removed:
        return
    for key in removed:
        del buffers[key]
    self._set_trait_quietly("coordinate_buffers", buffers)
    for key in removed:
        self._emit({"op": "buffer_remove", "id": key})
