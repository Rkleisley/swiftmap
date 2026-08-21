/**
 * Tier 1: the host interface's reference implementation.
 *
 * Five methods and two events are the whole contract between the core and whatever
 * embeds it. The stub is what exports and tests drive the real bundle with, so its
 * semantics -- set fires change listeners, emit delivers patches, off unsubscribes --
 * are the semantics the core is allowed to rely on.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createHostStub } from "../src/host.js";

test("set stores the value and fires exactly its change listeners", () => {
    const host = createHostStub({ zoom: 3 });
    const seen = [];
    host.on("change:zoom", () => seen.push("zoom"));
    host.on("change:center", () => seen.push("center"));
    host.set("zoom", 7);
    assert.equal(host.get("zoom"), 7);
    assert.deepEqual(seen, ["zoom"]);
    assert.deepEqual(host.sets, [["zoom", 7]], "every write is recorded for assertions");
});

test("emit delivers a patch message with its buffers, as a kernel would", () => {
    const host = createHostStub();
    const got = [];
    host.on("msg:custom", (msg, buffers) => got.push([msg.kind, buffers.length]));
    host.emit("msg:custom", { kind: "swiftmap_patch", ops: [] }, [new DataView(new ArrayBuffer(8))]);
    assert.deepEqual(got, [["swiftmap_patch", 1]]);
});

test("send and save_changes are recorded and forwarded to the hooks", () => {
    const calls = [];
    const host = createHostStub({}, { onSend: (c) => calls.push(c.kind), onSave: () => calls.push("save") });
    host.send({ kind: "swiftmap_ready" });
    host.save_changes();
    assert.deepEqual(host.sent.map(s => s.content.kind), ["swiftmap_ready"]);
    assert.equal(host.saves, 1);
    assert.deepEqual(calls, ["swiftmap_ready", "save"]);
});

test("off unsubscribes, which is what destroy() relies on", () => {
    const host = createHostStub({ zoom: 1 });
    let fired = 0;
    const fn = () => { fired += 1; };
    host.on("change:zoom", fn);
    host.set("zoom", 2);
    host.off("change:zoom", fn);
    host.set("zoom", 3);
    assert.equal(fired, 1);
});
