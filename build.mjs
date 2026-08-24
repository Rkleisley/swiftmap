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
    // anywidget entry: what the Python widget loads. Leaflet, glify, Geoman and
    // every stylesheet ride INSIDE (images as data URIs), so the widget and the
    // static export need no network -- the closed-network requirement, and what
    // makes the browser test tiers hermetic. This unminified build with an
    // external sourcemap is the debuggable twin the fixtures drive.
    { ...shared, entryPoints: ["src/anywidget.js"], outfile: "dist/anywidget.js",
      loader: { ".png": "dataurl", ".svg": "dataurl" } },
    // Same bundle where the Python package ships it from. anywidget inlines the
    // file as a string, and with the libraries aboard an inline sourcemap would
    // triple a megabyte-scale payload -- so this one is minified with no map;
    // debug against dist/anywidget.js. Its .css lands beside it as widget.css
    // (map.css + leaflet.css + geoman.css combined), which _widget_css_path
    // serves and the export inlines.
    { ...shared, entryPoints: ["src/anywidget.js"], outfile: "swiftmap/static/widget.js",
      minify: true, sourcemap: false,
      loader: { ".png": "dataurl", ".svg": "dataurl" } },
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
    // The Streamlit component: the React host under Streamlit's protocol, bundled
    // WHOLE -- React, Leaflet, glify, Geoman and every stylesheet -- into the
    // directory the wheel ships (package-data in pyproject.toml). Unlike the widget
    // and the export, nothing loads from a CDN at view time, so this is the one
    // stack that works with no network. Minified, no sourcemap: it is a shipped
    // artifact, committed like swiftmap/static/widget.js.
    { ...shared, entryPoints: ["src/streamlit.jsx"], outfile: "swiftmap/streamlit/frontend/app.js",
      jsx: "automatic", minify: true, sourcemap: false,
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".png": "dataurl", ".svg": "dataurl" } },
];

mkdirSync("swiftmap/static", { recursive: true });
mkdirSync("swiftmap/streamlit/frontend", { recursive: true });
mkdirSync("dist", { recursive: true });

if (watch) {
    for (const cfg of builds) {
        const ctx = await esbuild.context(cfg);
        await ctx.watch();
    }
    console.log("watching...");
} else {
    await Promise.all(builds.map(cfg => esbuild.build(cfg)));
    copyFileSync("src/map.css", "dist/swiftmap.css");
    copyFileSync("src/streamlit.html", "swiftmap/streamlit/frontend/index.html");
    console.log("build complete");
}
