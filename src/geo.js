// Geometry ingestion: WKT and GeoJSON into the model's shapes.
//
// The format polygon data actually arrives in is WKT (the React port's gap
// report, item 6); GeoJSON is what web APIs hand over. Both normalise here to
// one internal currency -- features of GeoJSON-shaped geometry -- and every
// coordinate flips from the formats' lon-lat to the [lat, lon] pairs the
// buffers carry. Conformance with Python's parsers is held by the authoring
// goldens: a WKT polygon with a hole must produce the same rings table and the
// same flat buffer here as a WKT-column DataFrame does through
// swiftmap/parsers on the server side.

const WKT_TYPES = {
    point: "Point", multipoint: "MultiPoint",
    linestring: "LineString", multilinestring: "MultiLineString",
    polygon: "Polygon", multipolygon: "MultiPolygon",
    geometrycollection: "GeometryCollection",
};

// A paren tree: children are nested groups or positions (arrays of numbers).
function parseGroup(text, start) {
    const children = [];
    let i = start;                      // text[start] === "("
    i += 1;
    let token = "";
    let position = [];
    const flushNumber = () => {
        if (token.length) {
            position.push(Number(token));
            token = "";
        }
    };
    const flushPosition = () => {
        flushNumber();
        if (position.length) {
            children.push(position);
            position = [];
        }
    };
    while (i < text.length) {
        const ch = text[i];
        if (ch === "(") {
            const [child, next] = parseGroup(text, i);
            children.push(child);
            i = next;
        } else if (ch === ")") {
            flushPosition();
            return [children, i + 1];
        } else if (ch === ",") {
            flushPosition();
            i += 1;
        } else if (/\s/.test(ch)) {
            flushNumber();
            i += 1;
        } else {
            token += ch;
            i += 1;
        }
    }
    throw new Error("unbalanced parentheses");
}

const isPosition = (node) => Array.isArray(node) && typeof node[0] === "number";
// WKT and GeoJSON are lon-lat; buffers and configs are [lat, lon].
const xy = (pos) => [pos[0], pos[1]];

// A WKT string as a GeoJSON geometry object (coordinates stay lon-lat, as the
// GeoJSON spec has them; the model flips on ingestion like everything else).
export function parseWKT(text) {
    const s = String(text).trim();
    const head = /^([A-Za-z]+)\s*(Z|M|ZM)?\s*/.exec(s);
    if (!head) throw new Error(`not WKT: ${s.slice(0, 40)}`);
    const type = WKT_TYPES[head[1].toLowerCase()];
    if (!type) throw new Error(`unsupported WKT type '${head[1]}'`);
    const rest = s.slice(head[0].length).trim();
    if (/^EMPTY$/i.test(rest)) {
        return { type, coordinates: [] };
    }
    if (type === "GeometryCollection") {
        // POINT(...), LINESTRING(...) items inside one paren pair.
        const inner = rest.replace(/^\(/, "").replace(/\)$/, "");
        const parts = [];
        let depth = 0, part = "";
        for (const ch of inner) {
            if (ch === "(") depth += 1;
            if (ch === ")") depth -= 1;
            if (ch === "," && depth === 0) {
                parts.push(part);
                part = "";
            } else {
                part += ch;
            }
        }
        if (part.trim()) parts.push(part);
        return { type, geometries: parts.map(parseWKT) };
    }
    const [tree] = parseGroup(rest, 0);
    if (type === "Point") return { type, coordinates: xy(tree[0]) };
    if (type === "MultiPoint") {
        // Both (10 40, 40 30) and ((10 40), (40 30)) occur in the wild.
        const coords = tree.map(node => isPosition(node) ? xy(node) : xy(node[0]));
        return { type, coordinates: coords };
    }
    if (type === "LineString") return { type, coordinates: tree.map(xy) };
    if (type === "MultiLineString" || type === "Polygon") {
        return { type, coordinates: tree.map(part => part.map(xy)) };
    }
    // MultiPolygon: parts -> rings -> positions.
    return { type, coordinates: tree.map(part => part.map(ring => ring.map(xy))) };
}

// Anything feature-shaped -- a WKT string, a GeoJSON geometry, Feature or
// FeatureCollection, or a JSON string of one -- as [{geometry, properties}].
export function featuresOf(data) {
    if (typeof data === "string") {
        const s = data.trim();
        if (s.startsWith("{") || s.startsWith("[")) return featuresOf(JSON.parse(s));
        return [{ geometry: parseWKT(s), properties: {} }];
    }
    if (!data || typeof data !== "object") throw new Error("unsupported geometry input");
    if (data.type === "FeatureCollection") {
        return (data.features || []).map(f => ({
            geometry: f.geometry, properties: f.properties || {},
        }));
    }
    if (data.type === "Feature") {
        return [{ geometry: data.geometry, properties: data.properties || {} }];
    }
    if (data.type === "GeometryCollection") {
        return (data.geometries || []).map(g => ({ geometry: g, properties: {} }));
    }
    if (data.type in WKT_TYPES || Object.values(WKT_TYPES).includes(data.type)) {
        return [{ geometry: data, properties: {} }];
    }
    throw new Error(`unsupported geometry input of type '${data.type}'`);
}

const flip = (pos) => [Number(pos[1]), Number(pos[0])];

// One feature's point positions as [lat, lon] pairs.
export function pointPairsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === "Point") return [flip(geometry.coordinates)];
    if (geometry.type === "MultiPoint") return geometry.coordinates.map(flip);
    return [];
}

// One feature's line parts, each a run of [lat, lon] pairs.
export function linePartsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === "LineString") return [geometry.coordinates.map(flip)];
    if (geometry.type === "MultiLineString") {
        return geometry.coordinates.map(part => part.map(flip));
    }
    return [];
}

// One feature's polygon parts, each rings of [lat, lon] pairs (ring 0 outer,
// the rest holes), every ring closed.
export function polygonPartsOf(geometry) {
    if (!geometry) return [];
    const close = (ring) => {
        if (!ring.length) return ring;
        const [f, l] = [ring[0], ring[ring.length - 1]];
        if (f[0] !== l[0] || f[1] !== l[1]) return [...ring, [f[0], f[1]]];
        return ring;
    };
    if (geometry.type === "Polygon") {
        return [geometry.coordinates.map(ring => close(ring.map(flip)))];
    }
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.map(part => part.map(ring => close(ring.map(flip))));
    }
    return [];
}

export const POINT_GEOMETRY = new Set(["Point", "MultiPoint"]);
export const LINE_GEOMETRY = new Set(["LineString", "MultiLineString"]);
export const POLYGON_GEOMETRY = new Set(["Polygon", "MultiPolygon"]);
