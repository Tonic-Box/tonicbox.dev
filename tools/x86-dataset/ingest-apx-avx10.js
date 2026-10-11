/**
 * Ingests APX + AVX10 instruction forms from the XED datafiles (structure-only:
 * encoding, operands, modes, groups, provenance; no prose, since felix has no
 * APX/AVX10 pages). Emits cache/apx-avx10-forms.json + cache/apx-avx10-groups.json
 * and a coverage report. Unmapped XED constructs are flagged and skipped, never guessed.
 */
const fs = require("fs");
const path = require("path");
const { loadJSON } = require("./util.js");

const iforms = loadJSON(path.join(__dirname, "cache", "xed-iforms.json"));
const base = loadJSON(path.join(__dirname, "cache", "x86.base.json"));
const report = { ingested: 0, skipped: 0, flags: [], isaSets: {} };
function flag(iclass, msg, extra) { report.flags.push({ iclass: iclass, msg: msg, extra: extra }); }

/* ---- token decoders ---- */
const PP = { NP: "none", "66": "66", F2: "F2", F3: "F3" };
const WIDTH_BITS = { b: 8, w: 16, d: 32, q: 64, z: 64 }; // GPR width codes; v/y resolved via W bit
function vlFrom(p) { if (/\bVL512\b/.test(p)) return 512; if (/\bVL256\b/.test(p)) return 256; if (/\bVL128\b/.test(p)) return 128; return null; }

function decodePattern(p) {
  const mapN = (p.match(/\bMAP(\d)\b/) || [])[1];
  const mapV = (p.match(/\bV(0F3A|0F38|0F)\b/) || [])[1];
  const ppTok = (p.match(/\bV(NP|66|F2|F3)\b/) || [])[1];
  const opcode = (p.match(/\b0x([0-9A-Fa-f]{2})\b/) || [])[1];
  if (!opcode) return null;
  const w = /\bW1\b/.test(p) ? "1" : /\bW0\b/.test(p) ? "0" : null;
  return {
    isEvex: /\bEVV\b/.test(p),
    isRex2: /\bREX2\b/.test(p),
    map: mapN ? "MAP" + mapN : (mapV || "legacy"),
    pp: ppTok ? PP[ppTok] : "none",
    w: w,
    opcode: opcode.toUpperCase(),
    vl: vlFrom(p),
    nd: /\bND=1\b/.test(p),
    nf: /\bNF=1\b/.test(p),
    scc: /\bSCC2?\b/.test(p) || /EVAPX_SCC/.test(p),
    isMem: /\bMOD!=3\b/.test(p) || /\bMOD\[mm\]/.test(p),
    isReg: /\bMOD=3\b/.test(p) || /\bMOD\[0b11\]/.test(p),
    mode64: /\bmode64\b/.test(p),
    force64: /FORCE64/.test(p)
  };
}

/** Decode one XED operand token into our operand model, or return {skip} / {implicit} / {unknown}. */
function decodeOperand(tok, enc) {
  // tok like REG0=GPRv_R():rw:v:u64  or  MEM0:r:b:i8  or  REG2=XED_REG_STACKPUSH:rw:SUPP:spw2
  const eq = tok.indexOf("=");
  const slotName = tok.slice(0, eq >= 0 ? eq : tok.indexOf(":"));
  const rest = eq >= 0 ? tok.slice(eq + 1) : tok.slice(tok.indexOf(":"));
  const ntMatch = /^([A-Za-z0-9_]+)\(\)/.exec(rest);
  const fields = rest.replace(/^[A-Za-z0-9_]+\(\)/, "").split(":").filter(Boolean);
  const access = fields.find(function (f) { return /^(r|w|rw|cw|crw)$/.test(f); }) || "r";
  const roleMap = { r: "read", w: "write", rw: "readwrite", cw: "cond_write", crw: "readwrite" };
  const role = roleMap[access] || "read";
  const widthCode = fields.find(function (f) { return /^(b|w|d|q|v|y|z|dq|qq|vv|mskw|zd|spw\d*|u\d+|i\d+)$/.test(f) && f !== access; });
  const isSupp = /\bSUPP\b/.test(rest);
  const nt = ntMatch ? ntMatch[1] : null;

  // suppressed implicit operands (OrAX/OeAX/OrDX/XED_REG_*...)
  if (isSupp) return { implicit: { name: implicitName(nt || rest.split(":")[0]), role: role } };
  if (slotName.startsWith("MEM")) {
    const broadcast = /BCASTSTR/.test(rest) || widthCode === "vv";
    return { op: { role: role, type: "mem", size_bits: memBits(widthCode, enc), encoding_slot: "modrm.rm", broadcast: broadcast || undefined }, rm: true };
  }
  if (slotName.startsWith("IMM")) return { op: { role: "read", type: "imm", size_bits: immBits(widthCode) } };
  if (nt && /^XED_REG_/.test(rest.split(":")[0]) || /^XED_REG_/.test(nt || "")) { }
  if (!nt) {
    // literal register e.g. XED_REG_STACKPUSH
    const lit = rest.split(":")[0];
    if (/^XED_REG_/.test(lit)) return { implicit: { name: lit.replace(/^XED_REG_/, ""), role: role } };
    return { unknown: tok };
  }
  if (/^XED_REG_/.test(nt)) return { implicit: { name: nt.replace(/^XED_REG_/, ""), role: role } };

  const reg = decodeReg(nt, enc, widthCode);
  if (reg.unknown) return { unknown: tok };
  if (reg.mask) {
    // writemask k1 -> not a standalone operand; signal to set mask_allowed on dest
    return { writemask: true };
  }
  return { op: { role: role, type: "reg", size_bits: reg.size, reg_class: reg.cls, encoding_slot: reg.slot }, isRmReg: reg.slot === "modrm.rm" };
}

function slotOf(nt) {
  if (/_SB(_|$)/.test(nt) || /_B3?(_|$)/.test(nt)) return "modrm.rm";
  if (/_R3?(_|$)/.test(nt)) return "modrm.reg";
  if (/_N3?(_|$)/.test(nt)) return "evex.vvvv";
  return null;
}
function implicitName(nt) {
  if (!nt) return "implicit";
  if (/^XED_REG_/.test(nt)) return nt.replace(/^XED_REG_/, "");
  const m = /^O([re])([A-Z]{2})$/.exec(nt); // OrAX/OeAX/OrDX -> width-neutral rAX/rDX
  if (m) return "r" + m[2];
  return nt;
}
function decodeReg(nt, enc, widthCode) {
  const slot = slotOf(nt);
  if (/^A_GPR_/.test(nt)) return { cls: "gpr", size: 64, slot: /_R$/.test(nt) ? "modrm.reg" : "modrm.rm" };
  if (/^MASK/.test(nt) || /^K_/.test(nt)) {
    if (nt === "MASK1" || /MASK1/.test(nt)) return { mask: true };
    return { cls: "mask", size: 64, slot: slot || "modrm.reg" };
  }
  if (/^X?MM|^XMM|^YMM|^ZMM/.test(nt)) {
    const cls = /^ZMM/.test(nt) ? "zmm" : /^YMM/.test(nt) ? "ymm" : "xmm";
    return { cls: cls, size: enc.vl || (cls === "zmm" ? 512 : cls === "ymm" ? 256 : 128), slot: slot };
  }
  if (/^GPR/.test(nt)) {
    let size = null;
    const m = /^GPR(8|16|32|64)/.exec(nt);
    if (m) size = +m[1];
    else if (/^GPRv/.test(nt)) size = enc.w === "1" ? 64 : enc.w === "0" ? 32 : null;
    else if (/^GPRy/.test(nt)) size = enc.w === "1" ? 64 : 32;
    else if (/^GPRz/.test(nt)) size = 64;
    if (!size && widthCode && WIDTH_BITS[widthCode]) size = WIDTH_BITS[widthCode];
    return { cls: "gpr", size: size, slot: slot };
  }
  if (/^TMM/.test(nt)) return { cls: "tmm", size: null, slot: slot };
  return { unknown: true };
}
function memBits(wc, enc) {
  if (!wc) return enc.vl || undefined;
  if (WIDTH_BITS[wc]) return WIDTH_BITS[wc];
  if (wc === "dq") return 128; if (wc === "qq") return 256; if (wc === "vv") return enc.vl || undefined;
  if (wc === "v") return enc.w === "1" ? 64 : 32; if (wc === "y") return enc.w === "1" ? 64 : 32;
  return undefined;
}
function immBits(wc) { return WIDTH_BITS[wc] || 8; }

module.exports = { decodePattern: decodePattern, decodeOperand: decodeOperand };

/* ---- main ---- */
if (require.main === module) {
  const picked = iforms.filter(function (f) { return /APX/.test(f.extension + f.isaSet) || /AVX10/.test(f.extension + f.isaSet); });
  // group iforms into logical forms (merge reg-form + mem-form)
  const forms = {};
  for (const f of picked) {
    const enc = decodePattern(f.pattern);
    if (!enc || !enc.isEvex) { report.skipped++; flag(f.iclass, enc ? "non-EVEX APX form (REX2/other) not yet translated" : "no opcode in pattern", f.pattern.slice(0, 60)); continue; }
    const toks = (f.operands || "").split(/\s+/).filter(Boolean);
    const ops = [];
    const implicits = [];
    let maskAllowed = false, unknown = null, rmKind = null;
    for (const t of toks) {
      const d = decodeOperand(t, enc);
      if (d.unknown) { unknown = d.unknown; break; }
      if (d.writemask) { maskAllowed = true; continue; }
      if (d.implicit) { implicits.push(d.implicit); continue; }
      if (d.op) { ops.push(d.op); if (d.rm) rmKind = "mem"; else if (d.isRmReg) rmKind = "reg"; }
    }
    if (unknown) { report.skipped++; flag(f.iclass, "unmapped operand", unknown); continue; }
    report.isaSets[f.isaSet] = (report.isaSets[f.isaSet] || 0) + 1;
    // merge key ignores reg-vs-mem of the rm operand
    const sig = ops.map(function (o) { return o.encoding_slot + ":" + o.reg_class + ":" + o.size_bits; }).join(",");
    const key = [f.iclass, enc.map, enc.pp, enc.w, enc.opcode, enc.nd ? "ND" : "", enc.nf ? "NF" : "", enc.vl, sig.replace(/mem|reg/g, "RM")].join("|");
    if (!forms[key]) forms[key] = { iform: f, enc: enc, ops: ops, implicits: implicits, maskAllowed: maskAllowed, hasReg: false, hasMem: false };
    if (rmKind === "mem") forms[key].hasMem = true;
    if (rmKind === "reg") forms[key].hasReg = true;
    report.ingested++;
  }
  // build records
  const out = [];
  const isaGroups = {};
  const byMnemCount = {};
  Object.keys(forms).forEach(function (key) {
    const F = forms[key];
    const f = F.iform, enc = F.enc;
    // reg_or_mem merge
    const ops = F.ops.map(function (o) {
      if (o.encoding_slot === "modrm.rm" && F.hasReg && F.hasMem) return Object.assign({}, o, { type: "reg_or_mem" });
      if (o.encoding_slot === "modrm.rm" && o.type === "mem" && F.hasReg && !F.hasMem) return o;
      return o;
    });
    // mask_allowed on the write/dest operand
    if (F.maskAllowed) { const dest = ops.find(function (o) { return /write/.test(o.role); }); if (dest) dest.mask_allowed = true; }
    const hasVector = ops.some(function (o) { return o.reg_class === "xmm" || o.reg_class === "ymm" || o.reg_class === "zmm"; });
    const encoding = {
      prefix_map: enc.map,
      opcode: enc.opcode,
      modrm: true,
      evex: cleanEvex({ length: hasVector ? String(enc.vl || 128) : undefined, pp: enc.pp, map: enc.map, w: enc.w, nd: enc.nd || undefined, nf: enc.nf || undefined, masking: F.maskAllowed ? "zero_or_merge" : undefined }),
      encoding_string: encString(enc, hasVector)
    };
    const isa = f.isaSet;
    const isaId = "isa-" + isa.toLowerCase().replace(/_/g, "-");
    isaGroups[isaId] = { id: isaId, kind: "isa_extension", name: isa };
    const famId = "cat-" + (f.category || "misc").toLowerCase();
    const id = genId(f.iclass, ops, enc, byMnemCount);
    out.push({
      id: id,
      mnemonic: f.iclass,
      summary: f.iclass + (enc.nd ? " (APX, NDD)" : enc.nf ? " (APX, NF)" : /AVX10/.test(isa) ? " (AVX10)" : " (APX)") + " — encoding-only record.",
      operands: ops,
      implicit_operands: F.implicits.length ? F.implicits : undefined,
      encodings: [encoding],
      modes: deriveModes(enc, f),
      groups: [isaId],
      cpuid_features: [isa],
      vendor_exclusive: "intel",
      provenance: [{ source: "xed", url: "https://github.com/intelxed/xed", note: "Encoding ingested from XED datafile " + f.file + "; narrative semantics pending an SDM source." }],
      notes: "Encoding-only record ingested from Intel XED (" + f.file + "); description, pseudocode, flags and exceptions are pending an authoritative SDM source."
    });
  });
  // strip undefined/null fields (schema wants integers, not nulls)
  function prune(v) {
    if (Array.isArray(v)) return v.map(prune);
    if (v && typeof v === "object") { const o = {}; Object.keys(v).forEach(function (k) { if (v[k] !== null && v[k] !== undefined) o[k] = prune(v[k]); }); return o; }
    return v;
  }
  const clean = prune(JSON.parse(JSON.stringify(out)));
  fs.writeFileSync(path.join(__dirname, "cache", "apx-avx10-forms.json"), JSON.stringify(clean));
  fs.writeFileSync(path.join(__dirname, "cache", "apx-avx10-groups.json"), JSON.stringify(Object.values(isaGroups)));
  fs.writeFileSync(path.join(__dirname, "cache", "apx-avx10-report.json"), JSON.stringify(report, null, 1));
  console.log("forms produced: " + clean.length + " | iforms ingested: " + report.ingested + " | skipped: " + report.skipped);
  console.log("new isa groups: " + Object.keys(isaGroups).length);
  console.log("flags: " + report.flags.length);
  const fm = {}; report.flags.forEach(function (x) { fm[x.msg] = (fm[x.msg] || 0) + 1; });
  console.log("flag breakdown: " + JSON.stringify(fm));
  console.log("sample forms:");
  clean.slice(0, 2).forEach(function (r) { console.log("  " + JSON.stringify(r)); });
}

function cleanEvex(e) { Object.keys(e).forEach(function (k) { if (e[k] === undefined) delete e[k]; }); return e; }
function encString(enc, hasVector) {
  const len = hasVector ? (enc.vl || 128) + "." : "";
  return "EVEX." + len + (enc.pp === "none" ? "NP" : enc.pp) + "." + enc.map + (enc.w ? ".W" + enc.w : "") + " " + enc.opcode + " /r";
}
function deriveModes(enc, f) {
  const long = true; // APX/AVX10 are 64-bit enhancements
  const compat = !(enc.mode64 || f.mode === "long_only" || /APX/.test(f.isaSet));
  return { real: false, protected: compat, long_64: long, compat_32: compat };
}
function genId(iclass, ops, enc, counter) {
  const parts = [iclass.toLowerCase().replace(/[^a-z0-9]/g, "")];
  ops.forEach(function (o) {
    const t = o.type === "reg_or_mem" ? "rm" : o.type === "mem" ? "m" : o.type === "imm" ? "imm" : "r";
    parts.push(t + (o.size_bits || ""));
  });
  if (enc.nd) parts.push("nd");
  if (enc.nf) parts.push("nf");
  let id = parts.join("_");
  counter[id] = (counter[id] || 0) + 1;
  if (counter[id] > 1) id += "_" + counter[id];
  return id;
}
