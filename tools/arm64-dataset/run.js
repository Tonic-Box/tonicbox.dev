/** Orchestrates the arm64 pipeline: fetch -> parse -> build -> validate. */
const { execFileSync } = require("child_process");
const path = require("path");

function run(script, extraNodeArgs) {
  console.log("\n=== " + script + " ===");
  execFileSync(process.execPath, (extraNodeArgs || []).concat([path.join(__dirname, script)]), { stdio: "inherit" });
}
try {
  run("fetch-sources.js");
  run("parse-mrs.js", ["--max-old-space-size=4096"]);
  run("build.js");
  run("validate.js");
  console.log("\npipeline complete.");
} catch (e) {
  console.error("pipeline failed: " + (e.message || e));
  process.exit(1);
}
