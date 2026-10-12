/**
 * Assembles arm64/arm64.json from cache/arm64-forms.json: groups (iset class +
 * feature), synthesized summaries, per-instruction Arm-manual deep links, sources.
 */
const fs = require("fs");
const path = require("path");
const { serialize, loadJSON } = require("./util.js");
const { describe } = require("./describe.js");

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

var descSourced = 0;
const instructions = forms.map(function (f) {
  const cid = classId(f);
  addGroup(cid, "class", f.iset + " · " + className(f));
  const grp = [cid];
  (f.features || []).forEach(function (ft) { const fid = "feat-" + ft.toLowerCase(); addGroup(fid, "feature", ft); grp.push(fid); });
  const d = describe(f.mnemonic, className(f));
  if (d.sourced) descSourced++;
  return {
    id: f.id,
    iset: f.iset,
    mnemonic: f.mnemonic,
    description: d.text,
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
    version: "AARCHMRS A-profile, schema 2.8",
    license: "BSD-3-Clause",
    copyright: "Copyright (c) 2010-2026 Arm Limited or its affiliates. All rights reserved.",
    license_text: "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.",
    fetched: "2026-10-12"
  }],
  conventions: {
    structural_only: "encoding-and-operand data only; narrative semantics (ASL pseudocode), flag effects, and prose descriptions are not in the permissive source and are linked out to the Arm manual via doc_url.",
    bit_numbering: "encoding.fields use lo/hi inclusive bit indices; bit 0 is the least-significant bit of the instruction word.",
    doc_url: "per-instruction deep link to the Arm A-profile ISA manual (A64 -> DDI0602, A32/T32 -> DDI0597).",
    descriptions: "instruction.description is TonicBox's own concise text (factual mnemonic expansions), not sourced from Arm; it is not part of the BSD-3 dataset credited in sources[]."
  },
  isets: ["A64", "A32", "T32"],
  coverage: {
    note: "AArch64 A64 plus AArch32 A32/T32, from the Arm MRS open JSON (BSD-3-Clause).",
    semantics_from: "Structural only (encodings, operands, feature gates). Short descriptions are TonicBox's own factual mnemonic expansions. ASL pseudocode and flag effects are not in the permissive release; each instruction links to the Arm manual for full semantics.",
    attribution: "Encoding data (c) 2010-2026 Arm Limited or its affiliates, licensed BSD-3-Clause. Descriptions (c) TonicBox. Arm, AArch64 and the instruction specifications are the property of Arm Limited.",
    not_covered: ["ASL pseudocode", "flag (NZCV) effect tables", "Arm's own prose descriptions"]
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
var mnems = {}, mnemSourced = {};
instructions.forEach(function (i) { mnems[i.mnemonic] = 1; if (describe(i.mnemonic, "").sourced) mnemSourced[i.mnemonic] = 1; });
console.log("descriptions: " + descSourced + "/" + instructions.length + " forms authored (" +
  Object.keys(mnemSourced).length + "/" + Object.keys(mnems).length + " mnemonics), rest fall back to class name");
const raw = fs.statSync(OUT).size;
console.log("raw size: " + (raw / 1048576).toFixed(1) + " MB");
