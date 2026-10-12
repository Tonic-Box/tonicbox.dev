/** Clones the Arm MRS open JSON repo into cache/ if not already present. */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dest = path.join(__dirname, "cache", "aarchmrs");
if (fs.existsSync(path.join(dest, "Instructions.json"))) {
  console.log("cache/aarchmrs present; skipping clone.");
} else {
  fs.mkdirSync(path.join(__dirname, "cache"), { recursive: true });
  console.log("cloning Arm MRS open JSON (AARCHMRS)...");
  execFileSync("git", ["clone", "--depth", "1", "https://kernel.googlesource.com/pub/scm/linux/kernel/git/maz/AARCHMRS", dest], { stdio: "inherit" });
}
