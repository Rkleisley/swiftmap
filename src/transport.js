// The base64 buffer transport: how a JSON-only channel carries binary.
//
// The static export bakes every coordinate/time/style buffer into its HTML as
// base64, and the Streamlit component receives them the same way -- component
// args are JSON through an iframe; there is no ArrayBuffer channel. Python
// encodes with swiftmap.export.encode_buffers; this is the one decoder both
// consumers use, so the encoding cannot drift between stacks.
export function decodeBase64Buffers(encoded) {
    const out = {};
    for (const [key, b64] of Object.entries(encoded || {})) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        out[key] = new DataView(bytes.buffer);
    }
    return out;
}

// Decodes a new set of encoded buffers, keeping the previously decoded view for
// every key whose base64 is byte-identical. Buffer identity is part of the GL
// meta key, so a layer whose data did not change keeps its GPU buffers across a
// full-state re-send -- the v1 transport's one cheap trick.
export function decodeBase64BuffersReusing(encoded, previousEncoded, previousDecoded) {
    const out = {};
    const fresh = {};
    for (const [key, b64] of Object.entries(encoded || {})) {
        if (previousEncoded && previousDecoded && previousEncoded[key] === b64 && previousDecoded[key]) {
            out[key] = previousDecoded[key];
        } else {
            fresh[key] = b64;
        }
    }
    return Object.assign(out, decodeBase64Buffers(fresh));
}
