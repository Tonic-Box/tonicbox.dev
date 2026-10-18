/**
 * Validates arm64/arm64.json and writes claudedocs/arm64-report.md.
 * Also checks every doc_url slug against the Arm page-slug map (deterministic).
 */
const fs = require("fs");
const path = require("path");
const { loadJSON } = require("./util.js");

const DATA = path.join(__dirname, "..", "..", "arm64", "arm64.json");
const REPORT = path.join(__dirname, "..", "..", "claudedocs", "arm64-report.md");
const db = loadJSON(DATA);
const PAGE_SLUG = loadJSON(path.join(__dirname, "page-slug-map.json"));
const errors = [], warnings = [];
const ins = db.instructions;

const ids = ins.map(function (i) { return i.id; });
const dup = ids.filter(function (id, i) { return ids.indexOf(id) !== i; });
if (dup.length) errors.push("duplicate ids: " + dup.slice(0, 8).join(", "));

const groupIds = new Set(db.groups.map(function (g) { return g.id; }));
const dangling = new Set();
let noFields = 0, badBits = 0, badIset = 0, noDoc = 0, overlaps = 0;
ins.forEach(function (i) {
  (i.groups || []).forEach(function (g) { if (!groupIds.has(g)) dangling.add(g); });
  if (["A64", "A32", "T32"].indexOf(i.iset) < 0) badIset++;
  if (!i.doc_url) noDoc++;
  const f = i.encoding && i.encoding.fields;
  if (!f || !f.length) { noFields++; return; }
  const w = i.encoding.width;
  const seen = new Array(w).fill(false);
  f.forEach(function (x) {
    if (x.lo < 0 || x.hi >= w || x.lo > x.hi) badBits++;
    for (let b = x.lo; b <= x.hi && b < w; b++) { if (seen[b]) overlaps++; seen[b] = true; }
  });
});
if (dangling.size) errors.push("dangling group refs: " + [...dangling].slice(0, 8).join(", "));
if (noFields) errors.push("instructions with no encoding fields: " + noFields);
if (badBits) errors.push("fields with out-of-range/inverted bits: " + badBits);
if (badIset) errors.push("instructions with invalid iset: " + badIset);
if (overlaps) warnings.push("overlapping encoding bits (forms): " + overlaps);
if (noDoc) warnings.push("instructions without doc_url: " + noDoc);

const byIset = {}; ins.forEach(function (i) { byIset[i.iset] = (byIset[i.iset] || 0) + 1; });

/* deterministic doc_url slug validation against the Arm ISA-XML page map */
let docSample = null;
function checkDocs() {
  const MARK = "Base-Instructions";
  let mismatch = 0, badShape = 0, notInMap = 0, indexFallback = 0;
  const badIds = [];
  ins.forEach(function (i) {
    const prov = (i.provenance || [])[0] || {};
    const key = i.iset + ":" + prov.page;
    const url = i.doc_url || "";
    const at = url.indexOf(MARK + "/");
    const slug = at >= 0 ? url.slice(at + MARK.length + 1) : "";
    if (slug === "") indexFallback++;
    const expect = PAGE_SLUG[key];
    if (expect === undefined) { notInMap++; if (badIds.length < 8) badIds.push(i.id + " (unmapped)"); }
    else if (slug !== expect) { mismatch++; if (badIds.length < 8) badIds.push(i.id + " (" + slug + "!=" + expect + ")"); }
    // title slugs are all dashes; a surviving underscore means an id/encoding name leaked in
    if (slug.indexOf("_") >= 0) { badShape++; if (badIds.length < 8) badIds.push(i.id + " (shape:" + slug + ")"); }
  });
  if (mismatch) errors.push("doc_url slug != page map: " + mismatch);
  if (notInMap) errors.push("doc_url page not in slug map: " + notInMap);
  if (badShape) errors.push("doc_url slug carries an underscore (encoding name leaked): " + badShape);
  docSample = { total: ins.length, mismatch: mismatch, notInMap: notInMap, badShape: badShape, indexFallback: indexFallback, bad: badIds };
}
function write() {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const L = [];
  L.push("# ARM instruction dataset — report");
  L.push("");
  L.push("Generated " + new Date().toISOString() + " by `tools/arm64-dataset/validate.js`. Version " + db.version + ".");
  L.push("");
  L.push(errors.length ? "**FAILED** — " + errors.length + " error(s):" : "**PASS** — all hard checks clean.");
  errors.forEach(function (e) { L.push("- ❌ " + e); });
  warnings.forEach(function (w) { L.push("- ⚠️ " + w); });
  L.push("");
  L.push("## Coverage");
  L.push("");
  L.push("| iset | instructions |");
  L.push("| --- | --- |");
  Object.keys(byIset).sort().forEach(function (k) { L.push("| " + k + " | " + byIset[k] + " |"); });
  L.push("| **total** | **" + ins.length + "** |");
  L.push("");
  L.push("Mnemonics: " + new Set(ins.map(function (i) { return i.mnemonic; })).size +
    " | classes: " + db.groups.filter(function (g) { return g.kind === "class"; }).length +
    " | feature gates: " + db.groups.filter(function (g) { return g.kind === "feature"; }).length);
  L.push("");
  L.push("Structural only (encodings, operands, feature gates). Pseudocode / flag effects / prose are not in the permissive Arm MRS release; each instruction deep-links to the Arm manual (`doc_url`) for full semantics.");
  if (docSample) {
    L.push("");
    L.push("## doc_url slug check");
    L.push("");
    L.push(docSample.total + " title slugs checked against the Arm ISA-XML page map (A64 DDI0602 2025-12, A32/T32 DDI0597 2022-12). mismatch: " + docSample.mismatch + ", unmapped: " + docSample.notInMap + ", underscore-leak: " + docSample.badShape + ", index-fallback (newer than snapshot): " + docSample.indexFallback + (docSample.bad.length ? " — " + docSample.bad.join(", ") : "."));
  }
  L.push("");
  L.push("## Sources");
  (db.sources || []).forEach(function (s) { L.push("- **" + s.id + "** " + (s.version || "") + " — " + (s.license || "") + " — " + (s.url || "")); });
  fs.writeFileSync(REPORT, L.join("\n") + "\n");
  console.log(errors.length ? "VALIDATION FAILED (" + errors.length + ")" : "VALIDATION PASSED");
  errors.forEach(function (e) { console.log("  ERR " + e); });
  warnings.forEach(function (w) { console.log("  WARN " + w); });
  if (docSample) console.log("doc_url slugs: " + docSample.total + " checked, mismatch=" + docSample.mismatch + " unmapped=" + docSample.notInMap + " underscore-leak=" + docSample.badShape + " index-fallback=" + docSample.indexFallback);
  console.log("report -> " + path.relative(path.join(__dirname, "..", ".."), REPORT));
  process.exit(errors.length ? 1 : 0);
}
checkDocs();
write();
