/**
 * The host interface: what a swiftmap core instance needs from whatever embeds it.
 *
 * Five methods, already proven by every static export, which runs the real bundle
 * against exactly this surface with no Python behind it:
 *
 *   get(key)              -> the current value of a state key
 *   set(key, value)       -> store it and fire the `change:<key>` listeners
 *   on(event, fn)         -> subscribe; `change:<key>`, and `msg:custom` for patches
 *   send(content, buffers)-> a message to the other side (may go nowhere)
 *   save_changes()        -> flush pending writes (may be a no-op)
 *
 * Optional: off(event, fn), honoured by destroy() when present.
 *
 * The core reads these keys through get(): layers, coordinate_buffers, group_configs,
 * center, zoom, crs, height, auto_sync, sync_trigger, show_logo, logo_config,
 * show_legend, legend_config, show_scale, scale_config, show_draw, draw_config,
 * drawings, draw_seq, show_click_coordinates, time_config, time_current,
 * fit_bounds_request, js_console_logs. It writes back through set(): center, zoom,
 * clicked_layer_id, selected_index, clicked_latlng, click_seq, drawings, draw_seq,
 * time_current, time_config, group_configs, js_console_logs. Sidebar toggles go out
 * through send() as {kind: "swiftmap_write", ops}; the widget announces itself with
 * {kind: "swiftmap_ready"}. Incremental updates arrive on the `msg:custom` event as
 * ({kind: "swiftmap_patch", ops}, buffers).
 *
 * anywidget's model satisfies this as-is; the stub below is the reference host for
 * exports, tests, and any embedding with no kernel behind it.
 */

export function createHostStub(initial = {}, hooks = {}) {
    const state = { ...initial };
    const listeners = {};
    const host = {
        comm: hooks.comm === undefined ? null : hooks.comm,
        state,
        sets: [],      // every set(), in order, for assertions
        sent: [],      // every send()
        saves: 0,
        get: key => state[key],
        set(key, value) {
            state[key] = value;
            host.sets.push([key, value]);
            (listeners[`change:${key}`] || []).forEach(fn => fn());
        },
        on(event, fn) {
            (listeners[event] = listeners[event] || []).push(fn);
        },
        off(event, fn) {
            listeners[event] = (listeners[event] || []).filter(f => f !== fn);
        },
        send(content, buffers) {
            host.sent.push({ content, buffers });
            if (hooks.onSend) hooks.onSend(content, buffers);
        },
        save_changes() {
            host.saves += 1;
            if (hooks.onSave) hooks.onSave();
        },
        // Fires listeners directly: how a test or an export pushes a real
        // swiftmap_patch through `msg:custom`, exactly as a kernel would.
        emit(event, ...args) {
            (listeners[event] || []).forEach(fn => fn(...args));
        },
    };
    return host;
}
