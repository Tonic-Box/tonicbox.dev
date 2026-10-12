/**
 * Parses the Arm Machine-Readable Spec open JSON (cache/aarchmrs/Instructions.json)
 * into normalized instruction forms for A64/A32/T32. Structural only: encodings
 * (bit-fields), assembly signature, operands, feature gates, condition, group.
 * No pseudocode/flags (not present in the permissive release). Emits
 * cache/arm64-forms.json. Run with --max-old-space-size (Instructions.json is ~118 MB).
 */
const fs = require("fs");
const path = require("path");
const { loadJSON } = require("./util.js");

const SRC = path.join(__dirname, "cache", "aarchmrs", "Instructions.json");
const OUT = path.join(__dirname, "cache", "arm64-forms.json");

const db = loadJSON(SRC);
const rules = db.assembly_rules || {};
const report = { total: 0, byIset: {}, noFields: 0, noSymbols: 0, flags: [] };

/* ---- collect leaves with their iset + group chain ---- */
const leaves = [];
(function walk(node, iset, chain) {
  const isSet = node._type === "Instruction.InstructionSet";
  const nextIset = isSet ? node.name : iset;
  const isLeaf = !node.children || !node.children.length;
  if (isLeaf && node._type === "Instruction.Instruction") {
    leaves.push({ iset: iset, group: chain[0] || null, subgroup: chain[chain.length - 1] || null, node: node });
  }
  if (node.children) {
    const nextChain = isSet || !node.name ? chain : chain.concat(node.name);
    node.children.forEach(function (c) { walk(c, nextIset, nextChain); });
  }
})({ children: db.instructions }, null, []);

/* ---- helpers ---- */
function cleanPlaceholder(ruleId) {
  return ruleId.replace(/__\d+$/, "").replace(/_(option|choice)$/i, "");
}
function renderRule(ruleId, depth) {
  const r = rules[ruleId];
  if (!r || depth > 4) return "<" + cleanPlaceholder(ruleId) + ">";
  if (/^AL(_|$)/i.test(ruleId) || /(^|_)cond(_|s)?(_|$)|cond_choice/i.test(ruleId)) return "{<c>}";
  if (/^q[wnd]?(_|$)|_qualifier|qw_option/i.test(ruleId)) return "{<q>}";
  if (/plus_or_minus/i.test(ruleId)) return "+/-";
  if (r._type === "Instruction.Rules.Token") return (r.default != null ? r.default : "").replace(/\s+/g, " ");
  // Choice = optional / variant syntax -> show the first choice's render, wrapped in {} if optional
  if (r._type === "Instruction.Rules.Choice" && Array.isArray(r.choices) && r.choices.length) {
    const first = r.choices[0];
    const inner = first && first.symbols ? renderSymbols(first.symbols, depth + 1) : "";
    const optional = r.choices.some(function (c) { return c && (!c.symbols || !c.symbols.length); });
    return optional ? "{" + inner + "}" : inner;
  }
  if (r._type === "Instruction.Rules.Rule") return "<" + cleanPlaceholder(ruleId) + ">";
  if (r.symbols) return renderSymbols(r.symbols, depth + 1);
  return "<" + cleanPlaceholder(ruleId) + ">";
}
function renderSymbols(symbols, depth) {
  if (!symbols) return "";
  return symbols.map(function (s) {
    if (s._type === "Instruction.Symbols.Literal") return s.value;
    if (s._type === "Instruction.Symbols.RuleReference") return renderRule(s.rule_id, depth || 0);
    return "";
  }).join("");
}

function tidySig(s) {
  return s.replace(/\{\s*\}/g, "").replace(/\s+/g, " ")
    .replace(/\s+([,\])])/g, "$1").replace(/([\[(])\s+/g, "$1").replace(/\s+/g, " ").trim();
}
function mnemonicOf(symbols) {
  const lit = (symbols || []).find(function (s) { return s._type === "Instruction.Symbols.Literal" && /[A-Za-z]/.test(s.value || ""); });
  return lit ? lit.value.trim().toUpperCase() : null;
}

function operandKind(ph) {
  const t = ph.replace(/[<>{}]/g, "");
  if (/^[XW]/.test(t) || /SP$/.test(t)) return "reg";
  if (/^[QDSHB]\d*$|^[QDSHB][a-z]/.test(t) || /^V/.test(t)) return "simd";
  if (/^Z/.test(t)) return "sve";
  if (/^P/.test(t)) return "pred";
  if (/imm|uimm|simm|#/.test(t)) return "imm";
  if (/label|target/i.test(t)) return "label";
  if (/^cond|<c>/.test(t)) return "cond";
  return "reg";
}
function operandsFrom(encodedIn) {
  if (!encodedIn) return [];
  return Object.keys(encodedIn).map(function (ph) {
    const binds = encodedIn[ph];
    const fields = Array.isArray(binds) ? binds.map(function (b) { return b && b.value; }).filter(Boolean) : [];
    return { text: ph, kind: operandKind(ph), fields: fields };
  });
}

function fieldsFrom(encoding) {
  if (!encoding || !encoding.values) return [];
  return encoding.values.map(function (v) {
    const r = v.range || {};
    const lo = typeof r.start === "number" ? r.start : null;
    const w = typeof r.width === "number" ? r.width : null;
    const hi = lo != null && w != null ? lo + w - 1 : null;
    const val = v.value && v.value.value;
    const named = v._type === "Instruction.Encodeset.Field";
    return { name: named ? v.name : null, hi: hi, lo: lo, value: val || null, fixed: !named };
  }).filter(function (f) { return f.lo != null && f.hi != null; });
}

function featuresFrom(condition) {
  const feats = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n._type === "AST.Function" && n.name === "IsFeatureImplemented" && Array.isArray(n.arguments)) {
      n.arguments.forEach(function (a) { if (a && a.value) feats.push(a.value); });
    }
    Object.keys(n).forEach(function (k) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); });
  })(condition);
  return [...new Set(feats)];
}

/* ---- build forms ---- */
const forms = [];
const seen = {};
leaves.forEach(function (L) {
  const n = L.node;
  const symbols = n.assembly && n.assembly.symbols;
  if (!symbols) { report.noSymbols++; return; }
  const mnem = mnemonicOf(symbols);
  if (!mnem) { report.noSymbols++; return; }
  const fields = fieldsFrom(n.encoding);
  if (!fields.length) { report.noFields++; report.flags.push({ id: n.name, msg: "no encoding fields" }); return; }
  const width = Math.max.apply(null, fields.map(function (f) { return f.hi; })) >= 32 ? 64 : (Math.max.apply(null, fields.map(function (f) { return f.hi; })) >= 16 ? 32 : 16);
  let id = n.name || mnem.toLowerCase();
  id = id.replace(/_+$/, "");
  if (seen[id]) id = id + "__" + (seen[id] = (seen[id] || 1) + 1); else seen[id] = 1;
  forms.push({
    id: id,
    iset: L.iset,
    mnemonic: mnem,
    group: L.group,
    subgroup: L.subgroup,
    title: n.title || null,
    signature: tidySig(renderSymbols(symbols, 0)),
    operands: operandsFrom(n._meta && n._meta.encoded_in),
    width: width === 16 ? 16 : 32,
    fields: fields,
    features: featuresFrom(n.condition),
    page: (n.name || "").replace(/_+$/, ""),
    doc_title: n.title || null
  });
  report.byIset[L.iset] = (report.byIset[L.iset] || 0) + 1;
  report.total++;
});

fs.writeFileSync(OUT, JSON.stringify(forms));
fs.writeFileSync(path.join(__dirname, "cache", "parse-report.json"), JSON.stringify(report, null, 1));
console.log("forms: " + forms.length + " | by iset: " + JSON.stringify(report.byIset));
console.log("skipped - no symbols: " + report.noSymbols + " | no fields: " + report.noFields);
console.log("sample:");
["A64", "A32", "T32"].forEach(function (is) {
  const f = forms.find(function (x) { return x.iset === is; });
  if (f) console.log("  [" + is + "] " + f.id + "  '" + f.signature + "'  fields=" + f.fields.length + " feats=" + JSON.stringify(f.features));
});
