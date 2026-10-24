// Runs every *.test.cjs suite in its own process and fails if any suite fails.
// The suites drive a headless Chromium through playwright and test the built
// main.js / lib.js in the repo root, so build first (npm run build).
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const suites = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort();
let failed = 0;
for (const suite of suites) {
	console.log(`\n=== ${suite}`);
	const r = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: "inherit" });
	if (r.status !== 0) {
		failed++;
		console.log(`!! ${suite} FAILED`);
	}
}
console.log(failed ? `\n${failed} suite(s) failed` : "\nall suites passed");
process.exit(failed ? 1 : 0);
