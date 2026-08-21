/**
 * Tier 1: library injection.
 *
 * The core renders with whatever Leaflet its host provides -- it never reaches for
 * a global. A host that forgets is told exactly how to provide one, before any DOM
 * or console hook is touched; providing validates the namespace and publishes it
 * as the live binding every module reads.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSwiftMap } from "../src/core.js";
import { createHostStub } from "../src/host.js";
import { provideLeaflet, requireLeaflet } from "../src/libs.js";

test("createSwiftMap refuses to run without Leaflet and names the ways to provide it", async () => {
    await assert.rejects(createSwiftMap({ host: createHostStub(), el: {} }),
        /no Leaflet provided.*createSwiftMap.*provideLeaflet.*loadLibraries/s);
    assert.throws(() => requireLeaflet(), /no Leaflet provided/);
});

test("provideLeaflet validates the namespace and publishes it as the live binding", async () => {
    assert.throws(() => provideLeaflet({}), /expects the Leaflet namespace/);
    const warnings = [];
    const original = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
        const fake = { map() {} };
        assert.equal(provideLeaflet(fake), fake);
        assert.ok(warnings.some(w => w.includes("glify")), "a Leaflet without glify is named");
        assert.ok(warnings.some(w => w.includes("Geoman")), "and one without Geoman");
        const libs = await import("../src/libs.js");
        assert.equal(libs.L, fake, "every module's `L` now reads the provided namespace");
        assert.equal(requireLeaflet(), fake);
    } finally {
        console.warn = original;
    }
});
