/**
 * Applies the audit fix passes to x86.json, driven by cached felix + xed data.
 * Pure, deterministic, idempotent. Preserves serialization style.
 * Passes: A groups/cpuid, B implicit operands, C strip vector mandatory_prefix,
 *         D modes re-derivation, E description/pseudocode backfill.
 */
const fs = require("fs");
const path = require("path");
const { serialize, loadJSON, felixSlug } = require("./util.js");

const DATA = path.join(__dirname, "..", "..", "x86", "x86.json");
const FELIX = path.join(__dirname, "cache", "felix-parsed.json");
const XED = path.join(__dirname, "cache", "xed-byiclass.json");

const BASE = path.join(__dirname, "cache", "x86.base.json");
if (!fs.existsSync(BASE)) fs.copyFileSync(DATA, BASE);
const db = loadJSON(BASE);
const felix = fs.existsSync(FELIX) ? loadJSON(FELIX) : {};
const xed = fs.existsSync(XED) ? loadJSON(XED) : {};
const report = { generated: new Date().toISOString(), passes: {}, flags: [] };
function flag(pass, id, msg) { report.flags.push({ pass: pass, id: id, msg: msg }); }

function felixFor(ins) {
  const p = (ins.provenance || []).find(function (x) { return x.source === "felix" && x.url; });
  if (!p) return null;
  return felix[felixSlug(p.url)] || null;
}
function norm(s) { return (s || "").toUpperCase().replace(/\s+/g, " ").trim(); }

/* ---------------- Pass A: groups + cpuid tokens (Issue 2) ---------------- */
const GROUP_REMAP = {
  "isa-both": null, "isa-flags": null, "isa-q": null,
  "isa-avx512d": "isa-avx512dq", "isa-vx512dq": "isa-avx512dq",
  "isa-avx512vla": "isa-avx512vl", "isa-eax[5]": "isa-sgx2", "isa-eax[6]": "isa-sgx2"
};
const CPUID_REMAP = {
  "Both": null, "flags": null, "Q": null,
  "AVX512D": "AVX512DQ", "VX512DQ": "AVX512DQ",
  "AVX512VLA": "AVX512VL", "EAX[5]": "SGX2", "EAX[6]": "SGX2"
};
const SGX_BIT_NOTE = {
  "isa-eax[5]": "ENCLV OVERSUB leaf, enumerated by CPUID.(EAX=12H,ECX=0):EAX[bit 5].",
  "isa-eax[6]": "ENCLS OVERSUB leaf, enumerated by CPUID.(EAX=12H,ECX=0):EAX[bit 6]."
};
function dedupe(a) { const s = new Set(); const o = []; a.forEach(function (x) { if (!s.has(x)) { s.add(x); o.push(x); } }); return o; }
function passGroups() {
  let touched = 0;
  db.instructions.forEach(function (ins) {
    let changed = false;
    if (ins.groups) {
      const before = ins.groups.slice();
      const mapped = [];
      before.forEach(function (g) {
        if (Object.prototype.hasOwnProperty.call(GROUP_REMAP, g)) {
          const r = GROUP_REMAP[g];
          if (r) mapped.push(r);
          if (SGX_BIT_NOTE[g]) ins.notes = ins.notes ? ins.notes + " " + SGX_BIT_NOTE[g] : SGX_BIT_NOTE[g];
          changed = true;
        } else mapped.push(g);
      });
      if (changed) ins.groups = dedupe(mapped);
    }
    if (ins.cpuid_features) {
      const mapped = [];
      ins.cpuid_features.forEach(function (t) {
        if (Object.prototype.hasOwnProperty.call(CPUID_REMAP, t)) {
          const r = CPUID_REMAP[t];
          if (r) mapped.push(r);
          changed = true;
        } else mapped.push(t);
      });
      if (mapped.length !== ins.cpuid_features.length || changed) ins.cpuid_features = dedupe(mapped);
    }
    if (changed) touched++;
  });
  const bogus = Object.keys(GROUP_REMAP);
  const before = db.groups.length;
  db.groups = db.groups.filter(function (g) { return bogus.indexOf(g.id) === -1; });
  report.passes.groups = { instructionsTouched: touched, groupsDeleted: before - db.groups.length };
}

/* ---------------- Pass B: implicit operands (Issue 3) ---------------- */
function io(list) { return list.map(function (x) { return { name: x[0], role: x[1] }; }); }
const IMPLICIT_FIX = {
  aaa: io([["AX", "readwrite"]]),
  aas: io([["AX", "readwrite"]]),
  cbw: io([["AL", "read"], ["AX", "write"]]),
  cwde: io([["AX", "read"], ["EAX", "write"]]),
  cdqe: io([["EAX", "read"], ["RAX", "write"]]),
  cwd: io([["AX", "read"], ["DX", "write"]]),
  cdq: io([["EAX", "read"], ["EDX", "write"]]),
  cqo: io([["RAX", "read"], ["RDX", "write"]]),
  cmpxchg_rm8_r8: io([["AL", "read"]]),
  cmpxchg_r_r8: io([["AL", "read"]]),
  cmpxchg16b_m128: io([["RAX", "readwrite"], ["RDX", "readwrite"], ["RBX", "read"], ["RCX", "read"]]),
  cpuid: io([["EAX", "readwrite"], ["ECX", "readwrite"], ["EBX", "write"], ["EDX", "write"]]),
  div_rm8: io([["AX", "read"], ["AL", "write"], ["AH", "write"]]),
  idiv_rm8: io([["AX", "read"], ["AL", "write"], ["AH", "write"]]),
  mul_rm8: io([["AL", "read"], ["AX", "write"]]),
  imul_rm8: io([["AL", "read"], ["AX", "write"]]),
  lods_m8: io([["AL", "write"], ["rSI", "readwrite"]]),
  lodsb: io([["AL", "write"], ["rSI", "readwrite"]]),
  lodsw: io([["AX", "write"], ["rSI", "readwrite"]]),
  lodsd: io([["EAX", "write"], ["rSI", "readwrite"]]),
  lodsq: io([["RAX", "write"], ["rSI", "readwrite"]]),
  scas_m8: io([["AL", "read"], ["rDI", "readwrite"]]),
  scasb: io([["AL", "read"], ["rDI", "readwrite"]]),
  scasw: io([["AX", "read"], ["rDI", "readwrite"]]),
  scasd: io([["EAX", "read"], ["rDI", "readwrite"]]),
  scasq: io([["RAX", "read"], ["rDI", "readwrite"]]),
  stos_m8: io([["AL", "read"], ["rDI", "readwrite"]]),
  stosb: io([["AL", "read"], ["rDI", "readwrite"]]),
  stosw: io([["AX", "read"], ["rDI", "readwrite"]]),
  stosd: io([["EAX", "read"], ["rDI", "readwrite"]]),
  stosq: io([["RAX", "read"], ["rDI", "readwrite"]]),
  loop_rel8: io([["rCX", "readwrite"]]),
  loope_rel8: io([["rCX", "readwrite"]]),
  loopne_rel8: io([["rCX", "readwrite"]]),
  loop_rip: io([["rCX", "readwrite"]]),
  rep_m_m8: io([["rCX", "readwrite"], ["rSI", "readwrite"], ["rDI", "readwrite"]]),
  rep_r_rm8: io([["rCX", "readwrite"], ["rSI", "readwrite"], ["rDI", "readwrite"]]),
  rep_r: io([["rCX", "readwrite"], ["rSI", "readwrite"], ["rDI", "readwrite"]]),
  repe_r_m8: io([["rCX", "readwrite"], ["rSI", "readwrite"], ["rDI", "readwrite"]]),
  repe_r: io([["rCX", "readwrite"], ["rSI", "readwrite"], ["rDI", "readwrite"]]),
  repne_r_m8: io([["rCX", "readwrite"], ["rSI", "readwrite"], ["rDI", "readwrite"]]),
  repne_r: io([["rCX", "readwrite"], ["rSI", "readwrite"], ["rDI", "readwrite"]]),
  monitor: io([["rAX", "read"], ["ECX", "read"], ["EDX", "read"]]),
  pconfig: io([["EAX", "readwrite"], ["EDX", "read"], ["rBX", "read"]]),
  xlatb: io([["AL", "readwrite"], ["rBX", "read"]]),
  sysexit: io([["rCX", "read"], ["rDX", "read"], ["rSP", "write"]]),
  sysret: io([["rCX", "read"], ["R11", "read"]]),
  getsec_exitac: io([["rBX", "read"], ["EDX", "read"], ["R8", "read"]]),
  popa: io([["AX", "write"], ["CX", "write"], ["DX", "write"], ["BX", "write"], ["BP", "write"], ["SI", "write"], ["DI", "write"], ["SP", "readwrite"]]),
  popad: io([["EAX", "write"], ["ECX", "write"], ["EDX", "write"], ["EBX", "write"], ["EBP", "write"], ["ESI", "write"], ["EDI", "write"], ["ESP", "readwrite"]]),
  pusha: io([["AX", "read"], ["CX", "read"], ["DX", "read"], ["BX", "read"], ["BP", "read"], ["SI", "read"], ["DI", "read"], ["SP", "readwrite"]]),
  pushad: io([["EAX", "read"], ["ECX", "read"], ["EDX", "read"], ["EBX", "read"], ["EBP", "read"], ["ESI", "read"], ["EDI", "read"], ["ESP", "readwrite"]])
};
function passImplicit() {
  const byId = {};
  db.instructions.forEach(function (i) { byId[i.id] = i; });
  let applied = 0;
  Object.keys(IMPLICIT_FIX).forEach(function (id) {
    const ins = byId[id];
    if (!ins) { flag("implicit", id, "fix target not found"); return; }
    ins.implicit_operands = IMPLICIT_FIX[id];
    applied++;
  });
  report.passes.implicit = { formsFixed: applied, mappedInTable: Object.keys(IMPLICIT_FIX).length };
}

/* ---------------- Pass C: strip vector mandatory_prefix (Issue 5) ---------------- */
function passStripPrefix() {
  let stripped = 0, vexc = 0, evexc = 0, xopc = 0;
  db.instructions.forEach(function (ins) {
    ins.encodings.forEach(function (e) {
      if ((e.vex || e.evex || e.xop) && typeof e.mandatory_prefix !== "undefined") {
        if (e.vex) vexc++; else if (e.evex) evexc++; else xopc++;
        delete e.mandatory_prefix;
        stripped++;
      }
    });
  });
  report.passes.stripPrefix = { encodingsStripped: stripped, vex: vexc, evex: evexc, xop: xopc };
}

/* ---------------- Pass D: modes re-derivation (Issue 1) ---------------- */
const FORBID_REAL = new Set(["VMXON", "VMXOFF", "VMLAUNCH", "VMRESUME", "VMCLEAR", "VMPTRLD", "VMPTRST", "VMREAD", "VMWRITE", "INVEPT", "INVVPID", "VMFUNC", "VMCALL", "GETSEC", "ENCLS", "ENCLU", "ENCLV", "VMRUN", "VMLOAD", "VMSAVE", "VMMCALL", "STGI", "CLGI", "SKINIT", "INVLPGA", "SEAMCALL", "SEAMRET", "SEAMOPS", "TDCALL", "PSMASH", "PVALIDATE", "RMPADJUST", "RMPUPDATE", "RMPQUERY", "RMPREAD"]);
function encString(e) { return e.encoding_string || ((e.prefix_map && e.prefix_map !== "legacy" ? e.prefix_map + " " : "") + e.opcode); }
function cleanOp(s) { return norm(s).replace(/\s*\+\s*/g, " ").replace(/\s+\d+$/, "").replace(/\s+/g, " ").trim(); }
const MPFX = /^(NP\s+|66\s+|F2\s+|F3\s+)/; // mandatory prefixes only; REX.W stays distinct (64-bit marker)
function matchRow(ins, fx) {
  if (!fx || !fx.opcodeRows.length) return null;
  // 1: the Instruction column names the exact mnemonic -> most specific disambiguator for size variants.
  const mnem = ins.mnemonic.toUpperCase();
  const re = new RegExp("\\b" + mnem.replace(/[^A-Z0-9]/g, "\\$&") + "\\b");
  const named = fx.opcodeRows.filter(function (r) { return re.test((r.instruction || r.opcode).toUpperCase()); });
  if (named.length) {
    const b = [...new Set(named.map(function (r) { return r.bit64; }).filter(Boolean))];
    const c = [...new Set(named.map(function (r) { return r.compat; }).filter(Boolean))];
    if (b.length === 1 && c.length === 1) return { bit64: b[0], compat: c[0] };
  }
  // 2: exact opcode match (mandatory prefixes normalized, REX kept distinct).
  const targets = ins.encodings.map(encString).map(cleanOp);
  for (const row of fx.opcodeRows) {
    const o = cleanOp(row.opcode), oNoPfx = o.replace(MPFX, "");
    for (const t of targets) {
      if (o === t || oNoPfx === t.replace(MPFX, "")) return row;
    }
  }
  return null;
}
function uniform(fx, key) {
  const vals = new Set(fx.opcodeRows.map(function (r) { return r[key]; }).filter(function (v) { return v != null; }));
  return vals.size === 1 ? [...vals][0] : null;
}
function xedModeHint(mnem) {
  const x = xed[mnem.toUpperCase()];
  if (!x) return null;
  const m = x.modes || {};
  const only = m.long_only && !m.no_long && !m.any && !m.mode32 && !m.mode16;
  const no64 = m.no_long && !m.long_only && !m.any;
  return { longOnly: !!only, no64: !!no64 };
}
/** Full XED verdict used when felix carries no mode columns. iclass-level. */
function xedModeVerdict(mnem) {
  const x = xed[mnem.toUpperCase()];
  if (!x) return null;
  const m = x.modes || {};
  const any = m.any || 0, longOnly = m.long_only || 0, no64 = m.no_long || 0, m32 = m.mode32 || 0, m16 = m.mode16 || 0;
  if (longOnly && !any && !no64 && !m32 && !m16) return { bit64: "valid", compat: "invalid" };
  if (no64 && !any && !longOnly) return { bit64: "invalid", compat: "valid" };
  if (any && !no64 && !longOnly) return { bit64: "valid", compat: "valid" };
  if (any) return { bit64: "valid", compat: "valid" };
  return null;
}
/** Per-form XED verdict: for mixed iclasses, split by the form's own encoding width. */
function xedVerdictForForm(ins) {
  const base = xedModeVerdict(ins.mnemonic);
  if (base) return base;
  const x = xed[ins.mnemonic.toUpperCase()];
  if (!x) return null;
  const m = x.modes || {};
  const is64flavor = ins.encodings.some(function (e) { return e.rex_w; }) ||
    (ins.operands || []).some(function (o) { return o.size_bits === 64; }) || /Q$/.test(ins.mnemonic);
  if ((m.long_only || 0) && is64flavor && !(m.no_long || 0)) return { bit64: "valid", compat: "invalid" };
  if ((m.any || 0)) return { bit64: "valid", compat: "valid" };
  if ((m.no_long || 0) && !(m.long_only || 0)) return { bit64: "invalid", compat: "valid" };
  return null;
}
const MODE_SIZED = new Set(["INVEPT", "INVVPID", "INVPCID", "VMREAD", "VMWRITE"]);
function passModes() {
  let changed = 0, bySource = { felixRow: 0, felixUniform: 0, xed: 0, residual64: 0, residualAll: 0, residualModeSized: 0, unresolved: 0 };
  const special = [];
  db.instructions.forEach(function (ins) {
    const fx = felixFor(ins);
    let bit64 = null, compat = null, src = null;
    if (fx) {
      const row = matchRow(ins, fx);
      if (row && row.bit64 && row.compat) { bit64 = row.bit64; compat = row.compat; src = "felixRow"; }
      else {
        const b = uniform(fx, "bit64"), c = uniform(fx, "compat");
        if (b && c) { bit64 = b; compat = c; src = "felixUniform"; }
      }
    }
    if (!(bit64 && compat)) {
      const v = xedVerdictForForm(ins);
      if (v) { bit64 = v.bit64; compat = v.compat; src = "xed"; }
    }
    if (!(bit64 && compat)) {
      // Residual resolver under the execute-legal rule.
      const is64 = ins.encodings.some(function (e) { return e.rex_w; }) || (ins.operands || []).some(function (o) { return o.size_bits === 64; });
      if (is64) { bit64 = "valid"; compat = "invalid"; src = "residual64"; }
      else if (MODE_SIZED.has(ins.mnemonic.toUpperCase())) { bit64 = "invalid"; compat = "valid"; src = "residualModeSized"; }
      else { bit64 = "valid"; compat = "valid"; src = "residualAll"; }
    }
    const longOk = bit64 === "valid";
    const compatOk = compat === "valid";
    const forbid = FORBID_REAL.has(ins.mnemonic.toUpperCase());
    const next = { real: compatOk && !forbid, protected: compatOk, long_64: longOk, compat_32: compatOk };
    // cross-check xed long-only vs felix
    const xh = xedModeHint(ins.mnemonic);
    if (src !== "xed" && xh && xh.longOnly && compatOk) flag("modes", ins.id, "xed says 64-bit-only but source compat=valid; kept source");
    const prev = ins.modes;
    if (prev.real !== next.real || prev.protected !== next.protected || prev.long_64 !== next.long_64 || prev.compat_32 !== next.compat_32) {
      if (forbid) special.push(ins.id);
      ins.modes = next;
      changed++;
      bySource[src]++;
    }
  });
  report.passes.modes = { formsChanged: changed, bySource: bySource, forbidRealApplied: special.length, forbidRealSample: special.slice(0, 20) };
}

/* ---------------- Pass E: description + pseudocode backfill (Issue 4) ---------------- */
function passBackfill() {
  let desc = 0, pseudo = 0, noFelix = 0, stillMissing = 0;
  db.instructions.forEach(function (ins) {
    const needD = !ins.description, needP = !ins.pseudocode;
    if (!needD && !needP) return;
    const fx = felixFor(ins);
    if (!fx) { if (needD && needP) { noFelix++; flag("backfill", ins.id, "no felix page; semantics still missing"); } return; }
    if (needD && fx.description) { ins.description = fx.description; desc++; }
    if (needP && fx.operation) { ins.pseudocode = fx.operation; pseudo++; }
    if ((!ins.description) && (!ins.pseudocode)) { stillMissing++; }
  });
  report.passes.backfill = { descriptionsAdded: desc, pseudocodeAdded: pseudo, formsWithoutFelixPage: noFelix, stillMissingBoth: stillMissing };
}

/* ---------------- Pass F: merge APX + AVX10 forms (Issue 6) ---------------- */
function prettyIsa(name) {
  return name.replace(/^APX_F$/, "APX").replace(/_/g, " ");
}
function passMergeAPX() {
  const formsPath = path.join(__dirname, "cache", "apx-avx10-forms.json");
  const groupsPath = path.join(__dirname, "cache", "apx-avx10-groups.json");
  if (!fs.existsSync(formsPath)) { report.passes.mergeAPX = { skipped: "cache/apx-avx10-forms.json absent; run ingest-apx-avx10.js first" }; return; }
  const forms = loadJSON(formsPath);
  const groups = loadJSON(groupsPath);
  const existingGroupIds = new Set(db.groups.map(function (g) { return g.id; }));
  let addedGroups = 0;
  groups.forEach(function (g) { if (!existingGroupIds.has(g.id)) { db.groups.push({ id: g.id, kind: "isa_extension", name: prettyIsa(g.name) }); existingGroupIds.add(g.id); addedGroups++; } });
  const usedIds = new Set(db.instructions.map(function (i) { return i.id; }));
  let appended = 0, renamed = 0;
  forms.forEach(function (f) {
    let id = f.id;
    if (usedIds.has(id)) { let n = 2; while (usedIds.has(id + "_apx" + (n > 2 ? n : ""))) n++; id = id + "_apx" + (n > 2 ? n : ""); renamed++; }
    f.id = id; usedIds.add(id);
    db.instructions.push(f);
    appended++;
  });
  report.passes.mergeAPX = { formsAppended: appended, idCollisionsResolved: renamed, groupsAdded: addedGroups, totalFormsNow: db.instructions.length };
}

/* ---------------- Pass F2: reuse base-instruction semantics for APX re-encodings ---------------- */
function passReuseAPXSemantics() {
  const src = {};
  db.instructions.forEach(function (i) {
    const apx = (i.groups || []).some(function (g) { return /^isa-apx|^isa-avx10/.test(g); });
    if (apx || !i.pseudocode) return;
    if (!src[i.mnemonic]) src[i.mnemonic] = { pseudocode: i.pseudocode, description: i.description };
  });
  let reused = 0;
  db.instructions.forEach(function (i) {
    const isApx = (i.groups || []).some(function (g) { return /^isa-apx/.test(g); });
    if (!isApx || i.pseudocode) return;
    const s = src[i.mnemonic];
    if (!s) return;
    i.pseudocode = s.pseudocode;
    if (!i.description && s.description) i.description = s.description;
    i.notes = "Encoding ingested from Intel XED. Operation reused from the base " + i.mnemonic +
      " instruction (APX re-encoding): NDD forms write the result to the EVEX.vvvv register, NF forms suppress the EFLAGS update. Flags and exceptions still pending an SDM source.";
    reused++;
  });
  report.passes.reuseAPX = { formsGivenReusedSemantics: reused };
}

/* ---------------- Pass G: dataset metadata ---------------- */
function passMetadata() {
  db.version = "2026.2";
  db.conventions.modes_semantics = "execute_legal_architectural";
  db.conventions.vector_prefix_selector = "pp_is_the_selector";
  db.conventions.implicit_operand_naming = "width_neutral_r_prefix";
  const missing = db.instructions.filter(function (i) { return !i.description && !i.pseudocode; }).length;
  db.coverage = {
    note: "x86 / x86-64 only. AArch64/ARM is a separate ISA and is not covered.",
    semantics_from: "Description and pseudocode are from the Intel SDM via felixcloutier. APX re-encodings of existing mnemonics reuse their base instruction's operation. " + missing + " forms (new APX mnemonics, AVX10, and AMD XOP/FMA4/3DNow/TBM/SSE4a/SVM) carry encodings/operands/modes/groups but no description/pseudocode, pending Intel APX/AVX10 specs or the AMD APM.",
    encoding_only_isa: ["APX", "AVX10"],
    not_covered: ["AArch64/ARM (separate ISA, separate dataset)", "Narrative semantics for APX/AVX10 forms"]
  };
  (db.sources || []).forEach(function (s) {
    if (s.id === "felix") s.fetched = "2026-10-11T00:00:00Z";
    if (s.id === "xed") { s.fetched = "2026-10-11T00:00:00Z"; s.note = "APX and AVX10 forms ingested from the XED datafiles (apx-f/, avx10-1/, avx10-2/)."; }
  });
  // reorder so coverage sits before groups/instructions
  const ordered = { version: db.version, conventions: db.conventions, sources: db.sources, coverage: db.coverage, groups: db.groups, instructions: db.instructions };
  Object.keys(db).forEach(function (k) { if (!(k in ordered)) ordered[k] = db[k]; });
  return ordered;
}

/* ---------------- run ---------------- */
passGroups();
passImplicit();
passStripPrefix();
passModes();
passBackfill();
passMergeAPX();
passReuseAPXSemantics();
const outDb = passMetadata();

fs.writeFileSync(DATA, serialize(outDb));
fs.writeFileSync(path.join(__dirname, "cache", "patch-report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.passes, null, 1));
console.log("flags: " + report.flags.length + " (see cache/patch-report.json)");
