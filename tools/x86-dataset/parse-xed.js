/**
 * Parses the intelxed/xed datafiles into instruction forms.
 * Each XED block is  { FIELD : value ... PATTERN:... OPERANDS:... }.
 * A block may carry several PATTERN/OPERANDS pairs sharing the header.
 *
 * Exports parseAll() -> { iforms:[...], byIclass:{ICLASS:{...}} }.
 * iform: { iclass, extension, isaSet, category, cpl, attributes, pattern, operands, comment, mode, file }
 */
const fs = require("fs");
const path = require("path");

const XED = path.join(__dirname, "cache", "xed", "datafiles");

function listTxt(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".txt")) out.push(p);
    }
  })(dir);
  return out;
}

function modeOf(pattern) {
  const toks = " " + pattern + " ";
  if (/\bmode64\b/.test(toks) || /\bMODE=2\b/.test(toks)) return "long_only";
  if (/\bnot64\b/.test(toks)) return "no_long";
  if (/\bmode32\b/.test(toks) || /\bMODE=1\b/.test(toks)) return "mode32";
  if (/\bmode16\b/.test(toks) || /\bMODE=0\b/.test(toks)) return "mode16";
  return "any";
}

function parseFile(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const forms = [];
  let depth = 0, buf = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    const t = line.trim();
    if (t === "{") { depth = 1; buf = []; continue; }
    if (t === "}") {
      if (depth === 1) forms.push(...blockToForms(buf, file));
      depth = 0; buf = [];
      continue;
    }
    if (depth === 1 && t) buf.push(t);
  }
  return forms;
}

function blockToForms(buf, file) {
  const hdr = {};
  const pairs = [];
  let pendingPattern = null;
  for (const line of buf) {
    const m = /^([A-Z_]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      if (pendingPattern != null) pendingPattern += " " + line.trim();
      continue;
    }
    const key = m[1], val = m[2].trim();
    if (key === "PATTERN") { pendingPattern = val; }
    else if (key === "OPERANDS") { pairs.push({ pattern: pendingPattern || "", operands: val }); pendingPattern = null; }
    else hdr[key] = hdr[key] ? hdr[key] + " " + val : val;
  }
  if (pendingPattern != null) pairs.push({ pattern: pendingPattern, operands: "" });
  if (!hdr.ICLASS) return [];
  if (!pairs.length) pairs.push({ pattern: "", operands: "" });
  return pairs.map(function (p) {
    return {
      iclass: hdr.ICLASS,
      extension: hdr.EXTENSION || "",
      isaSet: hdr.ISA_SET || hdr.EXTENSION || "",
      category: hdr.CATEGORY || "",
      cpl: hdr.CPL || "",
      attributes: hdr.ATTRIBUTES ? hdr.ATTRIBUTES.split(/\s+/) : [],
      comment: hdr.COMMENT || "",
      pattern: p.pattern,
      operands: p.operands,
      mode: modeOf(p.pattern),
      file: path.relative(XED, file).replace(/\\/g, "/")
    };
  });
}

function parseAll() {
  const iforms = [];
  for (const f of listTxt(XED)) {
    try { iforms.push(...parseFile(f)); } catch (e) { console.error("xed parse " + f + ": " + e.message); }
  }
  const byIclass = {};
  for (const f of iforms) {
    const b = byIclass[f.iclass] || (byIclass[f.iclass] = { extensions: new Set(), isaSets: new Set(), categories: new Set(), cpls: new Set(), modes: {}, forms: [] });
    if (f.extension) b.extensions.add(f.extension);
    if (f.isaSet) b.isaSets.add(f.isaSet);
    if (f.category) b.categories.add(f.category);
    if (f.cpl) b.cpls.add(f.cpl);
    b.modes[f.mode] = (b.modes[f.mode] || 0) + 1;
    b.forms.push(f);
  }
  return { iforms: iforms, byIclass: byIclass };
}

function setToArr(o) {
  const out = {};
  Object.keys(o).forEach(function (k) {
    out[k] = {
      extensions: [...o[k].extensions], isaSets: [...o[k].isaSets], categories: [...o[k].categories],
      cpls: [...o[k].cpls], modes: o[k].modes, formCount: o[k].forms.length
    };
  });
  return out;
}

module.exports = { parseAll: parseAll };

if (require.main === module) {
  const { iforms, byIclass } = parseAll();
  fs.writeFileSync(path.join(__dirname, "cache", "xed-byiclass.json"), JSON.stringify(setToArr(byIclass)));
  fs.writeFileSync(path.join(__dirname, "cache", "xed-iforms.json"), JSON.stringify(iforms));
  console.log("xed: " + iforms.length + " iforms | " + Object.keys(byIclass).length + " iclasses");
  const extCount = {};
  iforms.forEach(function (f) { if (f.extension) extCount[f.extension] = (extCount[f.extension] || 0) + 1; });
  console.log("distinct EXTENSION values: " + Object.keys(extCount).length);
  console.log("APX iforms: " + iforms.filter(function (f) { return /APX/.test(f.extension) || /APX/.test(f.isaSet); }).length);
  console.log("AVX10 iforms: " + iforms.filter(function (f) { return /AVX10/.test(f.extension) || /AVX10/.test(f.isaSet); }).length);
}
