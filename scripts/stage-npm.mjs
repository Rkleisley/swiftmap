// Stages the npm package in npmpkg/ so `npm publish` ships the JS package's own
// README rather than the Python one.
//
// npm always publishes the README.md sitting next to package.json, and this repo's
// root README.md is the Python package's -- the one that goes to PyPI. Swapping the
// two files around a publish would leave the repo wrong if the publish failed, so the
// package is assembled somewhere else instead: README.npm.md becomes the staged
// README.md, and nothing in the working tree moves.
//
//   npm run stage:npm      assemble npmpkg/ and report what it holds
//   npm run publish:npm    build, stage, and publish from it
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const OUT = "npmpkg";

if (!existsSync("dist/index.js")) {
    console.error("dist/ is missing or stale -- run `npm run build` first.");
    process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The manifest, minus everything that only means something in this repo. Scripts go
// too: a staged prepublish/prepack hook would re-enter this from inside the publish.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
delete pkg.devDependencies;
delete pkg.scripts;
pkg.files = ["dist", "src"];
writeFileSync(join(OUT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

cpSync("dist", join(OUT, "dist"), { recursive: true });
cpSync("src", join(OUT, "src"), { recursive: true });
cpSync("LICENSE", join(OUT, "LICENSE"));
cpSync("README.npm.md", join(OUT, "README.md"));   // the whole point of staging

const readme = readFileSync(join(OUT, "README.md"), "utf8");
if (!/^# swiftmap-core\s*$/m.test(readme)) {
    console.error("staged README.md is not the npm one -- refusing to leave it staged.");
    rmSync(OUT, { recursive: true, force: true });
    process.exit(1);
}

console.log(`staged ${pkg.name}@${pkg.version} in ${OUT}/`);
console.log("  publish with: npm publish ./" + OUT);
