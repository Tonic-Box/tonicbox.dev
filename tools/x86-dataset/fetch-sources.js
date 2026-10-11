/**
 * Fetches every distinct felixcloutier page referenced by x86.json provenance
 * into cache/felix/. Rate-limited, resumable (skips already-cached files).
 */
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "..", "x86", "x86.json");
const CACHE = path.join(__dirname, "cache", "felix");
fs.mkdirSync(CACHE, { recursive: true });

function slug(u) {
  return u
    .replace(/^https?:\/\/www\.felixcloutier\.com\/x86\//, "")
    .replace(/:/g, "__")
    .replace(/[^a-z0-9_-]/gi, "_");
}

const db = JSON.parse(fs.readFileSync(DATA, "utf8"));
const urls = new Set();
db.instructions.forEach(function (i) {
  (i.provenance || []).forEach(function (p) {
    if (p.source === "felix" && p.url) urls.add(p.url);
  });
});
const list = [...urls].sort();

async function main() {
  let done = 0,
    fetched = 0,
    skipped = 0;
  const failed = [];
  for (const u of list) {
    const f = path.join(CACHE, slug(u) + ".html");
    if (fs.existsSync(f) && fs.statSync(f).size > 200) {
      skipped++;
      done++;
      continue;
    }
    try {
      const res = await fetch(u, { headers: { "User-Agent": "tonicbox-x86-dataset/1.0 (+https://x86.tonicbox.dev)" } });
      if (!res.ok) {
        failed.push(u + " HTTP " + res.status);
      } else {
        fs.writeFileSync(f, await res.text());
        fetched++;
      }
    } catch (e) {
      failed.push(u + " " + e.message);
    }
    done++;
    if (done % 50 === 0) console.log("  " + done + "/" + list.length + " (fetched " + fetched + ", skipped " + skipped + ")");
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  console.log("DONE: " + list.length + " urls | fetched " + fetched + " | skipped " + skipped + " | failed " + failed.length);
  if (failed.length) {
    fs.writeFileSync(path.join(__dirname, "cache", "felix-failed.txt"), failed.join("\n"));
    failed.slice(0, 15).forEach(function (x) { console.log("  FAIL " + x); });
  }
}
main();
