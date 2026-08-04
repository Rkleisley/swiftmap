/**
 * Shared fixtures for the JS suite.
 *
 * The anywidget `model` is a small interface -- get/set/on/send/save_changes/comm -- so a
 * stub of it drives the whole widget with no Python, no kernel and no Shiny. That stub is
 * what makes tiers 2 and 3 possible at all.
 */

export function makeModel(initial = {}) {
    const state = {
        layers: [],
        group_configs: {},
        coordinate_buffers: {},
        center: [36.0, -5.35],
        zoom: 10,
        crs: "EPSG:3857",
        auto_sync: true,
        sync_trigger: 0,
        show_logo: false,
        ...initial,
    };
    const listeners = {};
    const model = {
        comm: { comm_id: "test" },
        sets: [],          // every model.set, in order, for assertions
        sent: [],          // every model.send
        saves: 0,
        get: key => state[key],
        set(key, value) {
            state[key] = value;
            model.sets.push([key, value]);
            (listeners[`change:${key}`] || []).forEach(fn => fn());
        },
        on(event, fn) {
            (listeners[event] = listeners[event] || []).push(fn);
        },
        send(content, buffers) {
            model.sent.push({ content, buffers });
        },
        save_changes() {
            model.saves += 1;
        },
        emit(event, ...args) {
            (listeners[event] || []).forEach(fn => fn(...args));
        },
        state,
    };
    return model;
}

/** A Leaflet stub: enough surface for code that only needs a map handle. */
export function makeMap() {
    const calls = { fitBounds: [], on: [] };
    return {
        calls,
        fitBounds: b => calls.fitBounds.push(b),
        on: (e, fn) => calls.on.push([e, fn]),
        off: () => {},
        getContainer: () => ({ style: {} }),
        getPane: () => ({ querySelector: () => null, style: {} }),
        latLngToContainerPoint: () => ({ distanceTo: () => 0 }),
    };
}

export const layer = (over = {}) => ({
    id: "layer_0", type: "markers", name: "Layer", layer_group: "Layers",
    visible: true, properties: {}, ...over,
});

export const A = [36.00, -5.30];
export const B = [36.10, -5.20];
export const C = [36.05, -5.10];
