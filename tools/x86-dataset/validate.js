/**
 * Validates the patched x86.json against the audit acceptance criteria and the
 * schema's structural rules, and writes a before/after report to
 * claudedocs/x86-audit-report.md. Exits non-zero on any hard failure.
 */
const fs = require("fs");
const path = require("path");
const { loadJSON } = require("./util.js");

const DATA = path.join(__dirname, "..", "..", "x86", "x86.json");
const BASE = path.join(__dirname, "cache", "x86.base.json");
const REPORT = path.join(__dirname, "..", "..", "claudedocs", "x86-audit-report.md");

const db = loadJSON(DATA);
const base = fs.existsSync(BASE) ? loadJSON(BASE) : null;
const errors = [], warnings = [];
function err(m) { errors.push(m); }
function warn(m) { warnings.push(m); }

/* ---- hard checks ---- */
const ids = db.instructions.map(function (i) { return i.id; });
const dupes = ids.filter(function (id, i) { return ids.indexOf(id) !== i; });
if (dupes.length) err("duplicate ids: " + dupes.slice(0, 10).join(", ") + (dupes.length > 10 ? " (+" + (dupes.length - 10) + ")" : ""));

const groupIds = new Set(db.groups.map(function (g) { return g.id; }));
const danglingRefs = new Set();
db.instructions.forEach(function (i) { (i.groups || []).forEach(function (g) { if (!groupIds.has(g)) danglingRefs.add(g); }); });
if (danglingRefs.size) err("dangling group refs: " + [...danglingRefs].slice(0, 20).join(", "));

const BOGUS = ["isa-both", "isa-flags", "isa-q", "isa-avx512d", "isa-vx512dq", "isa-avx512vla", "isa-eax[5]", "isa-eax[6]"];
const remainingBogus = db.groups.filter(function (g) { return BOGUS.indexOf(g.id) !== -1; });
if (remainingBogus.length) err("bogus isa groups still defined: " + remainingBogus.map(function (g) { return g.id; }).join(", "));
const BOGUS_CPUID = ["Both", "flags", "Q", "AVX512D", "VX512DQ", "AVX512VLA", "EAX[5]", "EAX[6]"];
let bogusCpuid = 0;
db.instructions.forEach(function (i) { (i.cpuid_features || []).forEach(function (t) { if (BOGUS_CPUID.indexOf(t) !== -1) bogusCpuid++; }); });
if (bogusCpuid) err("bogus cpuid_features tokens remain: " + bogusCpuid);

let modeIncomplete = 0;
db.instructions.forEach(function (i) {
  const m = i.modes;
  if (!m || ["real", "protected", "long_64", "compat_32"].some(function (k) { return typeof m[k] !== "boolean"; })) modeIncomplete++;
});
if (modeIncomplete) err("forms with incomplete modes: " + modeIncomplete);

let vecMandatory = 0;
db.instructions.forEach(function (i) { i.encodings.forEach(function (e) { if ((e.vex || e.evex || e.xop) && e.mandatory_prefix) vecMandatory++; }); });
if (vecMandatory) err("vector encodings still carrying mandatory_prefix: " + vecMandatory);

const PM = ["legacy", "0F", "0F38", "0F3A", "MAP4", "MAP5", "MAP6", "MAP7", "XOP8", "XOP9", "XOPA"];
const EM = ["0F", "0F38", "0F3A", "MAP4", "MAP5", "MAP6", "MAP7"];
let badPm = 0, badEm = 0, dosViolate = 0;
db.instructions.forEach(function (i) {
  i.encodings.forEach(function (e) {
    if (PM.indexOf(e.prefix_map) === -1) badPm++;
    if (e.evex && EM.indexOf(e.evex.map) === -1) badEm++;
    const vec = e.vex || e.evex || e.xop;
    if (vec && typeof e.default_operand_size !== "undefined") dosViolate++;
    if (!vec && typeof e.default_operand_size === "undefined") dosViolate++;
  });
});
if (badPm) err("encodings with invalid prefix_map: " + badPm);
if (badEm) err("evex encodings with invalid map: " + badEm);
if (dosViolate) warn("default_operand_size rule violations: " + dosViolate);

const NEST = { AL: ["AX", "EAX", "RAX"], AH: ["AX", "EAX", "RAX"], AX: ["EAX", "RAX"], EAX: ["RAX"], BL: ["BX", "EBX", "RBX"], BH: ["BX", "EBX", "RBX"], BX: ["EBX", "RBX"], EBX: ["RBX"], CL: ["CX", "ECX", "RCX"], CH: ["CX", "ECX", "RCX"], CX: ["ECX", "RCX"], ECX: ["RCX"], DL: ["DX", "EDX", "RDX"], DH: ["DX", "EDX", "RDX"], DX: ["EDX", "RDX"], EDX: ["RDX"] };
// A defect is a register listed alongside a WIDER alias with the SAME role (redundant
// aliasing). A register read while its wider alias is written (CBW: AL->AX) is a real,
// distinct data flow and is allowed.
let overlaps = [];
db.instructions.forEach(function (i) {
  const io = i.implicit_operands || [];
  const role = {}; io.forEach(function (o) { role[o.name] = o.role; });
  const set = new Set(io.map(function (o) { return o.name; }));
  io.forEach(function (o) { (NEST[o.name] || []).forEach(function (wider) { if (set.has(wider) && role[wider] === o.role) overlaps.push(i.id); }); });
});
overlaps = [...new Set(overlaps)];
if (overlaps.length) err("forms with redundant same-role implicit-operand overlaps: " + overlaps.length + " (" + overlaps.slice(0, 8).join(", ") + ")");

/* ---- coverage classification ---- */
function classify(set) {
  return {
    total: set.length,
    description: set.filter(function (i) { return i.description; }).length,
    pseudocode: set.filter(function (i) { return i.pseudocode; }).length,
    flags: set.filter(function (i) { return i.flags && Object.keys(i.flags).length; }).length,
    exceptions: set.filter(function (i) { return i.exceptions && i.exceptions.length; }).length,
    provenance: set.filter(function (i) { return i.provenance && i.provenance.length; }).length
  };
}
const cov = classify(db.instructions);

/* ---- before/after ---- */
let diff = null;
if (base) {
  const b = {}; base.instructions.forEach(function (i) { b[i.id] = i; });
  let modesChanged = 0;
  db.instructions.forEach(function (i) {
    const o = b[i.id]; if (!o) return;
    const m = i.modes, n = o.modes;
    if (m.real !== n.real || m.protected !== n.protected || m.long_64 !== n.long_64 || m.compat_32 !== n.compat_32) modesChanged++;
  });
  const baseNoSem = base.instructions.filter(function (i) { return !i.description && !i.pseudocode; }).length;
  // missing-sem among the ORIGINAL forms only (exclude the newly-added APX/AVX10 encoding-only forms)
  const origNoSemNow = db.instructions.filter(function (i) { return b[i.id] && !i.description && !i.pseudocode; }).length;
  diff = {
    formsBefore: base.instructions.length, formsAfter: db.instructions.length, formsAdded: db.instructions.length - base.instructions.length,
    groupsBefore: base.groups.length, groupsAfter: db.groups.length,
    modesChanged: modesChanged,
    origMissingSemBefore: baseNoSem, origMissingSemAfter: origNoSemNow
  };
}

/* ---- write report ---- */
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const lines = [];
lines.push("# x86.json audit remediation — report");
lines.push("");
lines.push("Generated " + new Date().toISOString() + " by `tools/x86-dataset/validate.js`. Dataset version " + db.version + ".");
lines.push("");
lines.push("## Acceptance checks");
lines.push("");
lines.push(errors.length ? "**FAILED** — " + errors.length + " hard error(s):" : "**PASS** — all hard checks clean.");
errors.forEach(function (e) { lines.push("- ❌ " + e); });
warnings.forEach(function (w) { lines.push("- ⚠️ " + w); });
lines.push("");
lines.push("Checks run: unique ids; group refs defined; no bogus isa groups/cpuid tokens; all four mode booleans present; no mandatory_prefix on vex/evex/xop; prefix_map/evex.map in enum; no nested implicit-operand overlaps.");
lines.push("");
if (diff) {
  lines.push("## Before / after");
  lines.push("");
  lines.push("| metric | before | after |");
  lines.push("| --- | --- | --- |");
  lines.push("| instruction forms | " + diff.formsBefore + " | " + diff.formsAfter + " (+" + diff.formsAdded + " APX/AVX10 encoding-only) |");
  lines.push("| groups | " + diff.groupsBefore + " | " + diff.groupsAfter + " |");
  lines.push("| original forms missing description+pseudocode | " + diff.origMissingSemBefore + " | " + diff.origMissingSemAfter + " (backfilled " + (diff.origMissingSemBefore - diff.origMissingSemAfter) + " from SDM/felix) |");
  lines.push("| mode tuples changed vs base | — | " + diff.modesChanged + " (all original forms re-derived; these differed) |");
  lines.push("");
}
lines.push("## Field coverage (all " + cov.total + " forms)");
lines.push("");
lines.push("| field | present | missing |");
lines.push("| --- | --- | --- |");
["description", "pseudocode", "flags", "exceptions", "provenance"].forEach(function (k) {
  lines.push("| " + k + " | " + cov[k] + " | " + (cov.total - cov[k]) + " |");
});
lines.push("");
lines.push("APX/AVX10 forms are encoding-only (no description/pseudocode) by design — felix has no APX/AVX10 pages and XED carries no prose. See `coverage` in the dataset.");
lines.push("");
lines.push("## Remaining unknowns");
lines.push("");
const patchRep = path.join(__dirname, "cache", "patch-report.json");
if (fs.existsSync(patchRep)) {
  const pr = loadJSON(patchRep);
  lines.push("- modes left unresolved by the pipeline: " + (pr.passes.modes ? pr.passes.modes.bySource.unresolved : "n/a"));
  const noFelix = pr.flags.filter(function (f) { return f.pass === "backfill"; }).length;
  lines.push("- forms with no felix page (semantics not backfillable): " + noFelix);
}
const apxRep = path.join(__dirname, "cache", "apx-avx10-report.json");
if (fs.existsSync(apxRep)) {
  const ar = loadJSON(apxRep);
  lines.push("- APX/AVX10 XED iforms skipped (REX2 / non-standard opcode form): " + ar.skipped);
}
lines.push("");
lines.push("## Sources");
lines.push("");
(db.sources || []).forEach(function (s) { lines.push("- **" + s.id + "** (" + s.kind + ") " + (s.version || "") + " — " + (s.url || "")); });
fs.writeFileSync(REPORT, lines.join("\n") + "\n");

console.log(errors.length ? "VALIDATION FAILED (" + errors.length + " errors)" : "VALIDATION PASSED");
errors.forEach(function (e) { console.log("  ERR " + e); });
warnings.forEach(function (w) { console.log("  WARN " + w); });
console.log("report -> " + path.relative(path.join(__dirname, "..", ".."), REPORT));
process.exit(errors.length ? 1 : 0);
