// Builds the JS once, for two consumers:
//   dist/                 -> npm package (React apps, standalone JS)
//   swiftmap/static/      -> the Python wheel's anywidget bundle
//
// This replaces the previous _load_esm() approach, which concatenated the source files
// after stripping their import/export statements with string replacement. That worked,
// but it forced the JS to be written so it survived being flattened into one scope.
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const watch = process.argv.includes("--watch");

const shared = {
    bundle: true,
    format: "esm",
    target: "es2020",
    sourcemap: true,
    logLevel: "info",
};

const builds = [
    // Framework-agnostic core, for npm consumers.
    { ...shared, entryPoints: ["src/index.js"], outfile: "dist/index.js" },
    // anywidget entry: what the Python widget loads.
    { ...shared, entryPoints: ["src/anywidget.js"], outfile: "dist/anywidget.js" },
    // Same anywidget bundle, written where the Python package ships it from.
    // anywidget inlines this file as a string, so a sibling .map is never fetchable --
    // inline the sourcemap instead of emitting a dead reference.
    { ...shared, entryPoints: ["src/anywidget.js"], outfile: "swiftmap/static/widget.js", sourcemap: "inline" },
    // The React component. react and the three rendering libraries are PEERS: the
    // consumer's bundler owns them, so they stay external here and plain-JS
    // consumers of dist/index.js never pull React.
    { ...shared, entryPoints: ["src/react.jsx"], outfile: "dist/react.js", jsx: "automatic",
      external: ["react", "react-dom", "react/jsx-runtime", "leaflet", "leaflet.glify",
                 "@geoman-io/leaflet-geoman-free"] },
    // The example app: everything bundled (React, Leaflet, glify, Geoman, CSS) into
    // examples/react/dist, which is gitignored -- `npm run build` produces it, and the
    // tier-3 suite drives it like the static export. NODE_ENV development keeps
    // StrictMode's double mount, the first thing a React host must survive.
    { ...shared, entryPoints: ["examples/react/app.jsx"], outfile: "examples/react/dist/app.js",
      jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
      loader: { ".png": "dataurl", ".svg": "dataurl" } },
];

mkdirSync("swiftmap/static", { recursive: true });
mkdirSync("dist", { recursive: true });

if (watch) {
    for (const cfg of builds) {
        const ctx = await esbuild.context(cfg);
        await ctx.watch();
    }
    console.log("watching...");
} else {
    await Promise.all(builds.map(cfg => esbuild.build(cfg)));
    copyFileSync("src/map.css", "swiftmap/static/widget.css");
    copyFileSync("src/map.css", "dist/swiftmap.css");
    console.log("build complete");
}
