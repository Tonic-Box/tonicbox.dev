/**
 * Orchestrates the full x86.json audit pipeline, in order, from the cached
 * sources. Re-run after editing any stage; fetch is resumable and skips what is
 * already cached. Usage: node tools/x86-dataset/run.js [--fetch]
 */
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const steps = [];
if (process.argv.includes("--fetch")) steps.push("fetch-sources.js");
steps.push("parse-felix.js", "parse-xed.js", "ingest-apx-avx10.js", "patch-dataset.js", "validate.js");

const cacheXed = path.join(__dirname, "cache", "xed");
if (!process.argv.includes("--fetch") && !fs.existsSync(cacheXed)) {
  console.error("cache/xed missing - run once with --fetch (also scrapes felix).");
  process.exit(1);
}

for (const s of steps) {
  console.log("\n=== " + s + " ===");
  try { execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: "inherit" }); }
  catch (e) { console.error("step failed: " + s); process.exit(e.status || 1); }
}
console.log("\npipeline complete.");
