/**
 * Fetches the pipeline's source data into cache/ (gitignored):
 *   1. Arm MRS open JSON (AARCHMRS) - encoding/operand data (BSD-3-Clause).
 *   2. Arm ISA XML releases - used only by build-page-map.js to derive the Arm
 *      documentation URL title slugs (page map). build.js itself reads the
 *      committed page-slug-map.json and does not need the XML.
 *
 * ISA XML snapshots (pinned; doc_url links point at these exact versions):
 *   A64      - ISA_A64 XML A-profile 2025-12   (Arm exploration tools)
 *   A32/T32  - ISA_AArch32 XML A-profile 2022-12 (Internet Archive mirror)
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");

const cache = path.join(__dirname, "cache");
fs.mkdirSync(cache, { recursive: true });

/* 1. MRS open JSON */
const mrs = path.join(cache, "aarchmrs");
if (fs.existsSync(path.join(mrs, "Instructions.json"))) {
  console.log("cache/aarchmrs present; skipping clone.");
} else {
  console.log("cloning Arm MRS open JSON (AARCHMRS)...");
  execFileSync("git", ["clone", "--depth", "1", "https://kernel.googlesource.com/pub/scm/linux/kernel/git/maz/AARCHMRS", mrs], { stdio: "inherit" });
}

function download(url, dest) {
  return new Promise(function (resolve, reject) {
    const f = fs.createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close(); return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { f.close(); return reject(new Error("HTTP " + res.statusCode + " for " + url)); }
      res.pipe(f);
      f.on("finish", function () { f.close(resolve); });
    }).on("error", reject);
  });
}

/* 2b. AArch32 ISA XML (Internet Archive, reliably fetchable) */
async function fetchAArch32() {
  const dir = path.join(cache, "armxml32");
  if (fs.existsSync(path.join(dir, "ISA_AArch32_xml_A_profile-2022-12"))) {
    console.log("cache/armxml32 present; skipping.");
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const tgz = path.join(dir, "isa_aarch32.tar.gz");
  console.log("downloading AArch32 ISA XML (A-profile 2022-12) from Internet Archive...");
  await download("https://archive.org/download/arm-xml-a-profile-2022-12/ISA_AArch32_xml_A_profile-2022-12.tar.gz", tgz);
  execFileSync("tar", ["xzf", tgz, "-C", dir], { stdio: "inherit" });
}

(async function () {
  await fetchAArch32();
  const a64 = path.join(cache, "armxml", "ISA_A64_xml_A_profile-2025-12");
  if (!fs.existsSync(a64)) {
    console.log("");
    console.log("NOTE: A64 ISA XML (A-profile 2025-12) is required by build-page-map.js but");
    console.log("the Arm CDN blocks scripted download. Fetch it manually and extract to:");
    console.log("  " + a64);
    console.log("from https://developer.arm.com/downloads/-/exploration-tools (ISA_A64 XML, 2025-12).");
  } else {
    console.log("cache/armxml (A64 2025-12) present.");
  }
})().catch(function (e) { console.error(e); process.exit(1); });
