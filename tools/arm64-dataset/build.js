/**
 * Assembles arm64/arm64.json from cache/arm64-forms.json: groups (iset class +
 * feature), synthesized summaries, per-instruction Arm-manual deep links, sources.
 */
const fs = require("fs");
const path = require("path");
const { serialize, loadJSON } = require("./util.js");

const forms = loadJSON(path.join(__dirname, "cache", "arm64-forms.json"));
const OUT = path.join(__dirname, "..", "..", "arm64", "arm64.json");

const CLASS_NAMES = {
  "A64:sve": "SVE / SVE2", "A64:sme": "SME", "A64:simd_dp": "SIMD & FP",
  "A64:dpimm": "Data-processing (immediate)", "A64:dpreg": "Data-processing (register)",
  "A64:ldst": "Loads & stores", "A64:control": "Branches, exceptions & system", "A64:reserved": "Reserved",
  "A32:dp": "Data-processing", "A32:ldstimm": "Load/store (immediate)", "A32:ldstreg": "Load/store (register)",
  "A32:media": "Media", "A32:brblk": "Branch & block data transfer", "A32:cops_as": "Coprocessor / Advanced SIMD", "A32:uncond_as": "Unconditional",
  "T32:n": "32-bit (narrow decode)", "T32:b16": "16-bit", "T32:w": "32-bit"
};
function classId(f) { return "cls-" + f.iset.toLowerCase() + "-" + (f.group || "misc"); }
function className(f) { return CLASS_NAMES[f.iset + ":" + f.group] || (f.group || "misc"); }
function docUrl(f) {
  const man = f.iset === "A64" ? "ddi0602" : "ddi0597";
  return "https://developer.arm.com/documentation/" + man + "/latest/Base-Instructions/" + f.page;
}

const groups = {};
function addGroup(id, kind, name) { if (!groups[id]) groups[id] = { id: id, kind: kind, name: name }; }

const instructions = forms.map(function (f) {
  const cid = classId(f);
  addGroup(cid, "class", f.iset + " · " + className(f));
  const grp = [cid];
  (f.features || []).forEach(function (ft) { const fid = "feat-" + ft.toLowerCase(); addGroup(fid, "feature", ft); grp.push(fid); });
  return {
    id: f.id,
    iset: f.iset,
    mnemonic: f.mnemonic,
    summary: f.signature,
    signature: f.signature,
    groups: grp,
    operands: f.operands,
    encoding: { width: f.width, fields: f.fields },
    features: f.features,
    doc_url: docUrl(f),
    provenance: [{ source: "arm-mrs", page: f.page }]
  };
});

const db = {
  version: "2026.1",
  sources: [{
    id: "arm-mrs", kind: "arm-mrs",
    name: "Arm Architecture Machine-Readable Specification (open JSON release)",
    url: "https://developer.arm.com/downloads/-/exploration-tools",
    version: "ISA A-profile 2025-12", license: "Arm MRS open release (permissive; see package notice)",
    fetched: "2026-10-12"
  }],
  conventions: {
    structural_only: "encoding-and-operand data only; narrative semantics (ASL pseudocode), flag effects, and prose descriptions are not in the permissive source and are linked out to the Arm manual via doc_url.",
    bit_numbering: "encoding.fields use lo/hi inclusive bit indices; bit 0 is the least-significant bit of the instruction word.",
    doc_url: "per-instruction deep link to the Arm A-profile ISA manual (A64 -> DDI0602, A32/T32 -> DDI0597)."
  },
  isets: ["A64", "A32", "T32"],
  coverage: {
    note: "AArch64 A64 plus AArch32 A32/T32, from the Arm MRS open JSON.",
    semantics_from: "Structural only (encodings, operands, feature gates). Pseudocode/flags/prose are not in the permissive release; each instruction links to the Arm manual for full semantics.",
    not_covered: ["ASL pseudocode", "flag (NZCV) effect tables", "prose descriptions"]
  },
  groups: Object.values(groups).sort(function (a, b) { return a.id < b.id ? -1 : 1; }),
  instructions: instructions
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, serialize(db));
console.log("wrote " + OUT);
console.log("instructions: " + instructions.length + " | groups: " + db.groups.length +
  " (classes " + db.groups.filter(function (g) { return g.kind === "class"; }).length +
  ", features " + db.groups.filter(function (g) { return g.kind === "feature"; }).length + ")");
console.log("mnemonics: " + new Set(instructions.map(function (i) { return i.mnemonic; })).size);
const raw = fs.statSync(OUT).size;
console.log("raw size: " + (raw / 1048576).toFixed(1) + " MB");
