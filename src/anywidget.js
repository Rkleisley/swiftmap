// The anywidget adapter: one host over the swiftmap core.
//
// anywidget's model already IS a host -- get/set/on/send/save_changes, with
// `change:<key>` and `msg:custom` events -- so nothing is translated here. The
// cleanup returned tears the map down when anywidget discards the view.
import { createSwiftMap } from "./core.js";

export { createHostStub } from "./host.js";

export default {
    async render({ model, el }) {
        const handle = await createSwiftMap({ host: model, el });
        return () => handle.destroy();
    },
};
