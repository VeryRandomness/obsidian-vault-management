// Bundles the test harness (a stand-in for Obsidian's plugin API, plus the real
// CodeMirror) into tests/.build/bundle.js, which the browser tests load.
import esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
mkdirSync(here("./.build"), { recursive: true });
await esbuild.build({
	entryPoints: [here("./harness/entry.js")],
	bundle: true,
	format: "iife",
	platform: "browser",
	outfile: here("./.build/bundle.js"),
	logLevel: "warning",
});
