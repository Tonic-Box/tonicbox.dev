/**
 * Builds page-slug-map.json: maps each MRS encoding page name to the Arm
 * documentation URL path (version + title slug) for that instruction.
 *
 * Arm's doc pages are NOT keyed by the MRS encoding name, nor by the XML
 * instructionsection id. The URL slug is derived from the page title:
 *
 *   slug = slugify( heading + ", " + brief [+ ", an alias of " + targetHeading] + "." )
 *   slugify = replace every character that is not [A-Za-z0-9] with "-"
 *
 * (verified byte-exact against live Arm URLs for ADD/MOV immediate and the
 *  MOV-to/from-SP alias). The slug depends on the brief wording, which Arm
 *  revises between ISA versions, so each URL is PINNED to the exact version of
 *  the XML it was generated from (Arm serves old versions permanently). This is
 *  correct by construction: the slug matches the version it points at.
 *
 * Sources (extracted into cache/):
 *   A64      - ISA_A64 XML, A-profile 2025-12   -> ddi0602/2025-12
 *   A32/T32  - ISA_AArch32 XML, A-profile 2022-12 -> ddi0597/2022-12
 *
 * Instructions newer than a snapshot have no page there; those map to "" and
 * build.js links them to that version's Base-Instructions index instead.
 */
const fs = require("fs");
const path = require("path");

const SNAP = {
  A64: { dir: "armxml/ISA_A64_xml_A_profile-2025-12", man: "ddi0602", ver: "2025-12" },
  A32: { dir: "armxml32/ISA_AArch32_xml_A_profile-2022-12", man: "ddi0597", ver: "2022-12" },
  T32: { dir: "armxml32/ISA_AArch32_xml_A_profile-2022-12", man: "ddi0597", ver: "2022-12" }
};
const FORMS = path.join(__dirname, "cache", "arm64-forms.json");
const OUT = path.join(__dirname, "page-slug-map.json");

function inner(txt, tag) {
  const m = txt.match(new RegExp("<" + tag + ">(.*?)</" + tag + ">", "s"));
  if (!m) return null;
  return m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function slugify(s) { return s.replace(/[^A-Za-z0-9]/g, "-"); }

/** Parse one XML dir: returns { enc2slug, idHeading } where enc2slug maps every
 *  <encoding name> to its page's title slug, and idHeading maps iformid->heading
 *  (for resolving alias targets). */
function parseDir(absdir) {
  const files = fs.readdirSync(absdir).filter(function (f) { return f.endsWith(".xml"); });
  const sections = [];
  const idHeading = {};
  for (const name of files) {
    const txt = fs.readFileSync(path.join(absdir, name), "utf8");
    if ((txt.match(/<instructionsection[ >]/g) || []).length !== 1) continue;
    const h = txt.match(/<instructionsection id="([^"]+)"[^>]*type="(instruction|alias)"/);
    if (!h) continue;
    const id = h[1], type = h[2];
    const heading = inner(txt, "heading");
    if (!heading) continue;
    idHeading[id] = heading;
    const brief = inner(txt, "brief") || "";
    let aliasTargetId = null;
    const at = txt.match(/<aliasto[^>]*iformid="([^"]+)"/);
    if (type === "alias" && at) aliasTargetId = at[1];
    const encs = [];
    const re = /<encoding name="([^"]+)"/g;
    let m;
    while ((m = re.exec(txt))) { encs.push(m[1]); }
    sections.push({ id: id, heading: heading, brief: brief, aliasTargetId: aliasTargetId, encs: encs });
  }
  const enc2slug = {};
  for (const s of sections) {
    let title = s.heading + ", " + s.brief;
    if (s.aliasTargetId && idHeading[s.aliasTargetId]) title += ", an alias of " + idHeading[s.aliasTargetId];
    title = title.replace(/[.\s]+$/, "") + ".";
    const slug = slugify(title);
    for (const e of s.encs) { enc2slug[e] = slug; enc2slug[e.replace(/_+$/, "")] = slug; }
  }
  return enc2slug;
}

const dirCache = {};
function encMap(iset) {
  const dir = SNAP[iset].dir;
  if (!dirCache[dir]) {
    const abs = path.join(__dirname, "cache", dir);
    if (!fs.existsSync(abs)) throw new Error("missing ISA XML dir: " + abs);
    dirCache[dir] = parseDir(abs);
  }
  return dirCache[dir];
}

const forms = JSON.parse(fs.readFileSync(FORMS, "utf8"));
const map = {};
const stats = { A64: { slug: 0, index: 0 }, A32: { slug: 0, index: 0 }, T32: { slug: 0, index: 0 } };
for (const f of forms) {
  const key = f.iset + ":" + f.page;
  if (map[key] !== undefined) continue;
  const em = encMap(f.iset);
  let slug = em[f.page];
  if (!slug) { const dq = f.page.replace(/_[DQ]$/, ""); slug = em[dq]; }
  map[key] = slug || "";
  stats[f.iset][slug ? "slug" : "index"]++;
}

fs.writeFileSync(OUT, JSON.stringify(map, null, 0));
console.log("wrote " + OUT + " (" + Object.keys(map).length + " entries)");
console.log(JSON.stringify(stats));
