/**
 * Parses cached felixcloutier HTML pages into structured records.
 * Dependency-free: felix markup is clean and regular.
 *
 * Exports parseAll() -> { <slug>: record }, and runs standalone to write
 * cache/felix-parsed.json. A record:
 *   { slug, title, opcodeRows:[{opcode,instruction,opEn,bit64,compat,description}],
 *     description, operation, flagsAffected, exceptions:{mode:text} }
 */
const fs = require("fs");
const path = require("path");

const CACHE = path.join(__dirname, "cache", "felix");

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", mdash: "—", ndash: "–", rarr: "→", le: "≤", ge: "≥" };
function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, function (m, e) {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(n) ? m : String.fromCodePoint(n);
    }
    return ENT[e] != null ? ENT[e] : m;
  });
}
function stripTags(h) {
  return decode(h.replace(/<sup>/gi, "^").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function cellText(h) {
  return decode(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseTable(tableHtml) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(tableHtml))) {
    const cells = [];
    const cRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cRe.exec(m[1]))) cells.push({ tag: c[1].toLowerCase(), text: cellText(c[2]) });
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function validity(v) {
  if (!v) return null;
  const t = v.toUpperCase().replace(/\s+/g, "");
  if (/^N\.?E\.?$/.test(t) || t === "NE") return "ne";
  if (/^N\.?P\.?$/.test(t) || t === "NP") return "np";
  if (/^N\.?S\.?$/.test(t) || t === "NS") return "ns";
  if (/^N\.?I\.?$/.test(t)) return "ni";
  if (t[0] === "V") return "valid";
  if (t[0] === "I") return "invalid";
  return t.toLowerCase();
}

function parseOpcodeTable(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(function (c) { return c.text.toLowerCase(); });
  const idx = function (re) { return header.findIndex(function (h) { return re.test(h); }); };
  const iOp = idx(/^opcode/);
  const iInstr = idx(/instruction/);
  const iOpEn = idx(/op\/en|op en/);
  const iDesc = idx(/description/);
  let i64 = idx(/64-bit mode/);
  let iCompat = idx(/compat|leg mode/);
  const iCombined = idx(/64\/32.*mode|mode support/);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells.length) continue;
    const get = function (i) { return i >= 0 && i < cells.length ? cells[i].text : ""; };
    let bit64 = null, compat = null;
    if (i64 >= 0) { bit64 = validity(get(i64)); compat = iCompat >= 0 ? validity(get(iCompat)) : null; }
    else if (iCombined >= 0) {
      const parts = get(iCombined).split("/");
      bit64 = validity(parts[0]);
      compat = validity(parts[1]);
    }
    const opcode = iOp >= 0 ? get(iOp) : "";
    const instruction = iInstr >= 0 ? get(iInstr) : "";
    if (!opcode && !instruction) continue;
    out.push({ opcode: opcode, instruction: instruction, opEn: iOpEn >= 0 ? get(iOpEn) : "", bit64: bit64, compat: compat, description: iDesc >= 0 ? get(iDesc) : "" });
  }
  return out;
}

/**
 * Split doc body into sections keyed by heading id. felix uses h2 on older
 * pages and h3 on newer AVX-512 pages; a section runs until the next heading
 * of equal-or-higher level (so h4 sub-blocks stay inside their section).
 */
function sections(html) {
  const heads = [];
  const re = /<h([2-4])\b([^>]*)>[\s\S]*?<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const idm = /id="([^"]+)"/.exec(m[2]);
    heads.push({ level: +m[1], id: idm ? idm[1] : null, start: m.index, end: re.lastIndex });
  }
  const out = {};
  heads.forEach(function (h, i) {
    if (!h.id) return;
    let endPos = html.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { endPos = heads[j].start; break; }
    }
    out[h.id] = html.slice(h.end, endPos);
  });
  return out;
}

function firstTable(html) {
  const m = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  return m ? m[1] : "";
}

function parseFile(file) {
  const html = fs.readFileSync(file, "utf8");
  const slug = path.basename(file, ".html");
  const titleM = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const sec = sections(html);
  let operation = "";
  if (sec.operation) {
    const pres = sec.operation.match(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi);
    operation = pres ? pres.map(function (p) { return stripTags(p); }).join("\n\n") : stripTags(sec.operation);
  }
  const exMap = {};
  Object.keys(sec).forEach(function (id) {
    const mm = /^(.*)-mode-exceptions$/.exec(id) || /^(real-address|protected|virtual-8086|compatibility|64-bit)[- ]?mode[- ]?exceptions$/.exec(id);
    if (/exceptions$/.test(id)) exMap[id.replace(/-exceptions$/, "")] = stripTags(sec[id]);
  });
  return {
    slug: slug,
    title: titleM ? cellText(titleM[1]) : slug,
    opcodeRows: parseOpcodeTable(parseTable(firstTable(html))),
    description: sec.description ? stripTags(sec.description) : "",
    operation: operation,
    flagsAffected: sec["flags-affected"] ? stripTags(sec["flags-affected"]) : "",
    exceptions: exMap
  };
}

function parseAll() {
  const out = {};
  if (!fs.existsSync(CACHE)) return out;
  fs.readdirSync(CACHE).filter(function (f) { return f.endsWith(".html"); }).forEach(function (f) {
    try { const r = parseFile(path.join(CACHE, f)); out[r.slug] = r; }
    catch (e) { console.error("parse error " + f + ": " + e.message); }
  });
  return out;
}

module.exports = { parseAll: parseAll, parseFile: parseFile };

if (require.main === module) {
  const all = parseAll();
  const outf = path.join(__dirname, "cache", "felix-parsed.json");
  fs.writeFileSync(outf, JSON.stringify(all));
  const keys = Object.keys(all);
  console.log("parsed " + keys.length + " pages -> " + outf);
  const withDesc = keys.filter(function (k) { return all[k].description; }).length;
  const withOp = keys.filter(function (k) { return all[k].operation; }).length;
  const withRows = keys.filter(function (k) { return all[k].opcodeRows.length; }).length;
  console.log("  with description: " + withDesc + " | with operation: " + withOp + " | with opcode rows: " + withRows);
}
