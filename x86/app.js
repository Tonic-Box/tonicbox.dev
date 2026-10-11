/* x86.tonicbox.dev - client-side instruction reference driven by x86.json. */
(function () {
  "use strict";

  /* ---------------- DOM helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  }

  /* ---------------- state ---------------- */
  var DATA = null;
  var GROUPMETA = {};           // id -> {kind, name, description}
  var MNEMS = [];               // sorted unique mnemonics
  var BY_MNEM = {};             // mnemonic -> [forms]
  var SROW = {};                // mnemonic -> {mlow, slow, ftext(lazy)}
  var FCOUNT = {};              // dim -> {value -> mnemonic count}
  var FILTERS = {};             // dim -> Set(values)
  var FACET_VALUES = {};        // dim -> ordered [values]
  var curQuery = "";
  var curFullText = false;
  var curMnem = null;
  var curForms = null;
  var selForm = 0;
  var sharedState = {};         // per-instruction: which blocks are shared
  var tocObserver = null;

  var FLAG_ORDER = ["cf", "pf", "af", "zf", "sf", "of", "df", "if", "tf", "ac", "nt", "rf"];
  var MODE_KEYS = ["long_64", "protected", "compat_32", "real"];
  var MODE_LABELS = { real: "Real", protected: "Protected", long_64: "64-bit (long)", compat_32: "Compat 32" };
  var FACET_DEFS = [
    { dim: "enc", title: "Encoding", collapsed: false },
    { dim: "isa", title: "Extension", collapsed: false },
    { dim: "cat", title: "Category", collapsed: true },
    { dim: "mode", title: "CPU mode", collapsed: true },
    { dim: "reg", title: "Register class", collapsed: true },
    { dim: "flag", title: "Flags written", collapsed: true }
  ];

  /* ---------------- boot ---------------- */
  var dataReady = false, revealed = false, skipReq = false;

  function bootLine(html) {
    var log = $("#boot-log");
    var div = el("div");
    div.innerHTML = html;
    log.appendChild(div);
  }

  function runBoot() {
    var skip = $("#boot-skip");
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    skip.textContent = reduced ? "" : "click anywhere to skip";
    $("#boot").addEventListener("click", function () { skipReq = true; tryReveal(true); });

    var pre = [
      '<span class="b">tonicbox@x86</span>:~$ load x86 instruction set',
      'connecting to dataset ...',
      'fetching <span class="accent">x86.json</span> ...'
    ];
    if (reduced) { pre.forEach(bootLine); return; }
    var i = 0;
    (function step() {
      if (skipReq || revealed) return;
      if (i < pre.length) { bootLine(pre[i++]); setTimeout(step, 230 + Math.random() * 160); }
    })();
  }

  function bootFinish() {
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var post = [
      'parsed <span class="accent">' + DATA.instructions.length.toLocaleString() + '</span> instruction forms',
      'indexed <span class="accent">' + MNEMS.length.toLocaleString() + '</span> mnemonics, ' +
        (FACET_VALUES.isa ? FACET_VALUES.isa.length : 0) + ' extensions',
      'dataset version <span class="accent">' + esc(DATA.version) + '</span>',
      '<span class="ok">ready.</span> <span class="boot-cursor"></span>'
    ];
    if (reduced || skipReq) { tryReveal(true); return; }
    var i = 0;
    (function step() {
      if (skipReq || revealed) { tryReveal(true); return; }
      if (i < post.length) { bootLine(post[i++]); setTimeout(step, 190 + Math.random() * 150); }
      else setTimeout(function () { tryReveal(false); }, 420);
    })();
  }

  function tryReveal(immediate) {
    if (revealed || !dataReady) return;
    revealed = true;
    var boot = $("#boot");
    boot.classList.add("gone");
    setTimeout(function () { boot.style.display = "none"; }, immediate ? 120 : 460);
    $("#app").hidden = false;
    initUI();
    onHash();
    $("#q").focus();
  }

  /* ---------------- indexing ---------------- */
  function encFamily(enc) {
    if (!enc) return "legacy";
    if (enc.evex) return "EVEX";
    if (enc.vex) return "VEX";
    if (enc.xop) return "XOP";
    return "legacy";
  }

  function buildIndex() {
    (DATA.groups || []).forEach(function (g) { GROUPMETA[g.id] = g; });

    var mset = {};
    DATA.instructions.forEach(function (f) {
      var m = f.mnemonic;
      if (!BY_MNEM[m]) { BY_MNEM[m] = []; mset[m] = 1; }
      BY_MNEM[m].push(f);

      // per-form facet values
      var enc = (f.encodings && f.encodings[0]) || null;
      var cats = (f.groups || []).filter(function (id) {
        var gm = GROUPMETA[id]; return gm && gm.kind === "category";
      }).map(function (id) { return GROUPMETA[id].name; });
      var modes = [];
      if (f.modes) MODE_KEYS.forEach(function (k) { if (f.modes[k]) modes.push(k); });
      var regs = {};
      (f.operands || []).forEach(function (o) { if (o.reg_class) regs[o.reg_class] = 1; });
      var flags = f.flags ? Object.keys(f.flags) : [];
      f._f = {
        enc: [encFamily(enc)],
        cat: cats,
        isa: f.cpuid_features || [],
        mode: modes,
        reg: Object.keys(regs),
        flag: flags
      };
    });

    MNEMS = Object.keys(mset).sort();
    MNEMS.forEach(function (m) {
      var forms = BY_MNEM[m];
      var summ = "";
      for (var i = 0; i < forms.length; i++) { if (forms[i].summary) { summ = forms[i].summary; break; } }
      SROW[m] = { mlow: m.toLowerCase(), slow: (summ || "").toLowerCase(), summary: summ, count: forms.length, ftext: null };
    });

    // facet counts (mnemonic-level union) + ordered value lists
    var dims = ["enc", "isa", "cat", "mode", "reg", "flag"];
    dims.forEach(function (d) { FCOUNT[d] = {}; FILTERS[d] = new Set(); });
    MNEMS.forEach(function (m) {
      var forms = BY_MNEM[m];
      var seen = { enc: {}, isa: {}, cat: {}, mode: {}, reg: {}, flag: {} };
      forms.forEach(function (f) {
        dims.forEach(function (d) {
          f._f[d].forEach(function (v) { seen[d][v] = 1; });
        });
      });
      dims.forEach(function (d) {
        Object.keys(seen[d]).forEach(function (v) { FCOUNT[d][v] = (FCOUNT[d][v] || 0) + 1; });
      });
    });

    FACET_VALUES.enc = ["legacy", "VEX", "EVEX", "XOP"].filter(function (v) { return FCOUNT.enc[v]; });
    FACET_VALUES.mode = MODE_KEYS.filter(function (v) { return FCOUNT.mode[v]; });
    FACET_VALUES.flag = FLAG_ORDER.filter(function (v) { return FCOUNT.flag[v]; });
    FACET_VALUES.isa = Object.keys(FCOUNT.isa).sort(function (a, b) { return FCOUNT.isa[b] - FCOUNT.isa[a] || (a < b ? -1 : 1); });
    FACET_VALUES.cat = Object.keys(FCOUNT.cat).sort(function (a, b) { return FCOUNT.cat[b] - FCOUNT.cat[a] || (a < b ? -1 : 1); });
    FACET_VALUES.reg = Object.keys(FCOUNT.reg).sort(function (a, b) { return FCOUNT.reg[b] - FCOUNT.reg[a] || (a < b ? -1 : 1); });
  }

  function getFtext(m) {
    var row = SROW[m];
    if (row.ftext != null) return row.ftext;
    var parts = [];
    BY_MNEM[m].forEach(function (f) {
      if (f.summary) parts.push(f.summary);
      if (f.description) parts.push(f.description);
      if (f.pseudocode) parts.push(f.pseudocode);
      if (f.intrinsic) parts.push(f.intrinsic);
      parts.push(signature(f.operands));
      (f.encodings || []).forEach(function (e) { if (e.encoding_string) parts.push(e.encoding_string); });
    });
    row.ftext = parts.join(" \u0001 ").toLowerCase();
    return row.ftext;
  }

  /* ---------------- operand signature ---------------- */
  function regToken(o) {
    switch (o.reg_class) {
      case "gpr": case "gpr_high": return "r" + (o.size_bits || "");
      case "xmm": return "xmm"; case "ymm": return "ymm"; case "zmm": return "zmm";
      case "mask": return "k"; case "mmx": return "mm"; case "st": return "ST(i)";
      case "seg": return "Sreg"; case "cr": return "CR"; case "dr": return "DR";
      case "bnd": return "bnd"; case "tmm": return "tmm";
      default: return "r" + (o.size_bits || "");
    }
  }
  function opToken(o) {
    switch (o.type) {
      case "imm": return "imm" + (o.size_bits || "");
      case "rel": return "rel" + (o.size_bits || "");
      case "moffs": return "moffs" + (o.size_bits || "");
      case "implicit": return o.implicit_reg || "implicit";
      case "mem": return "m" + (o.size_bits || "");
      case "reg": return regToken(o);
      case "reg_or_mem":
        if (o.reg_class === "gpr" || o.reg_class === "gpr_high") return "r/m" + (o.size_bits || "");
        return regToken(o) + "/m" + (o.size_bits || "");
      default: return o.type;
    }
  }
  function signature(ops) {
    if (!ops || !ops.length) return "";
    return ops.map(opToken).join(", ");
  }

  /* ---------------- search + filters ---------------- */
  function anyActive() {
    for (var k in FILTERS) if (FILTERS[k] && FILTERS[k].size) return true;
    return false;
  }
  function formPasses(f) {
    for (var dim in FILTERS) {
      var sel = FILTERS[dim];
      if (!sel || !sel.size) continue;
      var vals = f._f[dim], ok = false;
      for (var j = 0; j < vals.length; j++) { if (sel.has(vals[j])) { ok = true; break; } }
      if (!ok) return false;
    }
    return true;
  }
  function mnemPasses(m) {
    var forms = BY_MNEM[m];
    for (var i = 0; i < forms.length; i++) if (formPasses(forms[i])) return true;
    return false;
  }
  function applyFilters() {
    if (!anyActive()) return MNEMS;
    return MNEMS.filter(mnemPasses);
  }
  function scoreRow(m, q, ft) {
    var row = SROW[m], ml = row.mlow;
    if (ml === q) return 1000;
    if (ml.indexOf(q) === 0) return 600 - Math.min(80, ml.length);
    if (ml.indexOf(q) >= 0) return 300 - Math.min(80, ml.length);
    if (row.slow.indexOf(q) >= 0) return 120;
    if (ft && getFtext(m).indexOf(q) >= 0) return 50;
    return 0;
  }
  function computeList() {
    var base = applyFilters();
    var q = curQuery.trim().toLowerCase();
    if (!q) return { list: base.slice(), grouped: true };
    var scored = [];
    for (var i = 0; i < base.length; i++) {
      var sc = scoreRow(base[i], q, curFullText);
      if (sc > 0) scored.push([sc, base[i]]);
    }
    scored.sort(function (a, b) { return b[0] - a[0] || (a[1] < b[1] ? -1 : 1); });
    return { list: scored.map(function (x) { return x[1]; }), grouped: false };
  }

  /* ---------------- left rail: facets + list ---------------- */
  function renderFacets() {
    var host = $("#facets");
    host.innerHTML = "";
    FACET_DEFS.forEach(function (def) {
      var vals = FACET_VALUES[def.dim] || [];
      if (!vals.length) return;
      var group = el("div", "facet-group" + (def.collapsed ? " collapsed" : ""));
      group.dataset.dim = def.dim;
      var head = el("div", "facet-head");
      head.innerHTML = "<span>" + esc(def.title) + "</span><span class=\"caret\">&#9660;</span>";
      head.addEventListener("click", function () { group.classList.toggle("collapsed"); });
      group.appendChild(head);
      var body = el("div", "facet-body");
      vals.forEach(function (v) {
        var opt = el("label", "facet-opt");
        var label = def.dim === "mode" ? (MODE_LABELS[v] || v) : v;
        opt.innerHTML = "<input type=\"checkbox\"><span>" + esc(label) + "</span><span class=\"fc\">" + FCOUNT[def.dim][v] + "</span>";
        var cb = opt.querySelector("input");
        cb.checked = FILTERS[def.dim].has(v);
        cb.addEventListener("change", function () {
          if (cb.checked) FILTERS[def.dim].add(v); else FILTERS[def.dim].delete(v);
          refreshList(); renderActiveFilters();
        });
        body.appendChild(opt);
      });
      group.appendChild(body);
      host.appendChild(group);
    });
  }

  function renderActiveFilters() {
    var host = $("#activeFilters");
    host.innerHTML = "";
    FACET_DEFS.forEach(function (def) {
      FILTERS[def.dim].forEach(function (v) {
        var label = def.dim === "mode" ? (MODE_LABELS[v] || v) : v;
        var chip = el("span", "fchip");
        chip.innerHTML = esc(label) + " <span class=\"x\">&times;</span>";
        chip.title = "remove filter";
        chip.addEventListener("click", function () {
          FILTERS[def.dim].delete(v);
          refreshList(); renderActiveFilters(); renderFacets();
        });
        host.appendChild(chip);
      });
    });
  }

  function refreshList() {
    var res = computeList();
    var host = $("#ilist");
    host.innerHTML = "";
    $("#resultCount").textContent = res.list.length.toLocaleString() + (res.list.length === 1 ? " result" : " results");
    if (!res.list.length) { host.appendChild(el("div", "ilist-empty", "no instructions match")); return; }
    var frag = document.createDocumentFragment();
    var lastLetter = null;
    res.list.forEach(function (m) {
      if (res.grouped) {
        var letter = m[0];
        if (letter !== lastLetter) { lastLetter = letter; frag.appendChild(el("div", "ilist-group-h", letter)); }
      }
      var row = el("div", "irow");
      row.dataset.mnem = m;
      row.title = SROW[m].summary || "";
      var mspan = el("span", "m", m);
      row.appendChild(mspan);
      if (SROW[m].count > 1) row.appendChild(el("span", "cnt", SROW[m].count + " forms"));
      row.addEventListener("click", function () { navigate(m); closeDrawer(); });
      frag.appendChild(row);
    });
    host.appendChild(frag);
    markActiveRow();
  }

  function markActiveRow() {
    var rows = $("#ilist").querySelectorAll(".irow");
    for (var i = 0; i < rows.length; i++) {
      var on = rows[i].dataset.mnem === curMnem;
      rows[i].classList.toggle("active", on);
      if (on) rows[i].scrollIntoView({ block: "nearest" });
    }
  }

  /* ---------------- byte diagram ---------------- */
  function byteBoxes(enc) {
    var b = [];
    if (!enc.vex && !enc.evex && !enc.xop && enc.mandatory_prefix && enc.mandatory_prefix !== "none")
      b.push({ c: "prefix", v: enc.mandatory_prefix, l: "pfx", t: "Mandatory prefix " + enc.mandatory_prefix + "h selects this opcode." });
    if (enc.vex)
      b.push({ c: "vprefix", v: "VEX", l: "VEX." + enc.vex.length, t: "VEX prefix. L=" + enc.vex.length + ", pp=" + enc.vex.pp + ", map=" + enc.vex.mmmmm + ", W=" + enc.vex.w });
    else if (enc.evex)
      b.push({ c: "vprefix", v: "EVEX", l: "EVEX." + (enc.evex.length || enc.evex.map), t: "EVEX prefix (4 bytes). map=" + enc.evex.map + ", pp=" + enc.evex.pp + (enc.evex.length ? ", L=" + enc.evex.length : "") + ", W=" + enc.evex.w + (enc.evex.masking && enc.evex.masking !== "none" ? ", masking=" + enc.evex.masking : "") + (enc.evex.nd ? ", ND (new-data dest)" : "") + (enc.evex.nf ? ", NF (no flags)" : "") });
    else if (enc.xop)
      b.push({ c: "vprefix", v: "XOP", l: "XOP." + enc.xop.map, t: "XOP prefix (AMD). L=" + enc.xop.length + ", pp=" + enc.xop.pp + ", map=" + enc.xop.map + ", W=" + enc.xop.w });
    else if (enc.rex_w)
      b.push({ c: "rex", v: "REX.W", l: "rex", t: "REX.W promotes the operation to a 64-bit operand size." });
    if (!enc.vex && !enc.evex && !enc.xop && enc.prefix_map && enc.prefix_map !== "legacy")
      b.push({ c: "map", v: enc.prefix_map, l: "map", t: "Opcode-map escape " + enc.prefix_map + "." });
    b.push({ c: "opcode", v: enc.opcode, l: "opcode", t: "Primary opcode byte" + (enc.opcode_extension != null ? ", with /" + enc.opcode_extension + " held in ModR/M.reg" : "") + "." });
    if (enc.modrm)
      b.push({ c: "modrm", v: "ModR/M", l: enc.opcode_extension != null ? "/" + enc.opcode_extension : "mod·reg·r/m", t: "ModR/M byte encodes the operands" + (enc.opcode_extension != null ? "; its reg field is fixed to " + enc.opcode_extension + " as an opcode extension" : "") + "." });
    if (enc.sib && enc.sib !== "never")
      b.push({ c: "sib", v: "SIB", l: enc.sib, t: "SIB byte (" + enc.sib + ") for scale-index-base memory addressing." });
    if (enc.displacement_size_bits)
      b.push({ c: "disp", v: "disp" + enc.displacement_size_bits, l: "disp", t: "Displacement, " + enc.displacement_size_bits + "-bit." });
    if (enc.immediate_size_bits)
      b.push({ c: "imm", v: "imm" + enc.immediate_size_bits, l: "imm", t: "Immediate operand, " + enc.immediate_size_bits + "-bit." });
    if (enc.opcode_suffix)
      b.push({ c: "imm", v: enc.opcode_suffix, l: "suffix", t: "Trailing opcode-select byte after ModR/M (3DNow! encoding)." });
    return b;
  }
  function byteDiagramHTML(enc) {
    var boxes = byteBoxes(enc);
    var h = '<div class="bytes">';
    boxes.forEach(function (x) {
      h += '<div class="byte-box ' + x.c + '" data-tip="' + esc(x.t) + '"><div class="bb-val">' + esc(x.v) + '</div><div class="bb-lab">' + esc(x.l) + '</div></div>';
    });
    h += '</div><div class="bytes-note">byte stream, left to right (legacy prefixes such as 66/67/F0 and segment overrides may precede any form)</div>';
    return h;
  }

  /* ---------------- rendering helpers ---------------- */
  function flagGridHTML(flags) {
    if (!flags || !Object.keys(flags).length) return '<div class="flags-none">no status flags affected</div>';
    var h = '<div class="flags">';
    FLAG_ORDER.forEach(function (k) {
      if (!flags[k]) return;
      h += '<div class="flag ' + esc(flags[k]) + '"><div class="fn">' + k.toUpperCase() + '</div><div class="fe">' + esc(flags[k]) + '</div></div>';
    });
    h += '</div>';
    return h;
  }
  function hlPseudo(code) {
    var e = esc(code);
    e = e.replace(/\b(IF|THEN|ELSE|ELIF|FI|WHILE|DO|OD|FOR|TO|DOWNTO|RETURN|GOTO|CASE|BREAK|AND|OR|XOR|NOT)\b/g, '<span class="kw">$1</span>');
    e = e.replace(/:=/g, '<span class="op">:=</span>');
    e = e.replace(/\b(0[xX][0-9A-Fa-f]+|\d+)\b/g, '<span class="num">$1</span>');
    return e;
  }
  function uniformValue(forms, key, isObj) {
    var seen = null, any = false;
    for (var i = 0; i < forms.length; i++) {
      var v = forms[i][key];
      if (v == null) continue;
      var s = isObj ? JSON.stringify(v) : String(v);
      if (!any) { seen = v; any = true; }
      else if ((isObj ? JSON.stringify(seen) : String(seen)) !== s) return { any: true, uniform: false };
    }
    return { any: any, uniform: true, value: seen };
  }
  function firstWith(forms, key) {
    for (var i = 0; i < forms.length; i++) if (forms[i][key]) return forms[i][key];
    return null;
  }
  function excTableHTML(exc) {
    var h = '<table class="exc"><thead><tr><th>Vector</th><th>Condition</th></tr></thead><tbody>';
    exc.forEach(function (e) {
      h += '<tr><td class="vec">' + esc(e.vector) + '</td><td>' + esc(e.condition || "") + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  /* ---------------- center: instruction view ---------------- */
  function renderInstruction(mnem, formId) {
    curMnem = mnem;
    curForms = BY_MNEM[mnem];
    selForm = 0;
    if (formId) {
      for (var i = 0; i < curForms.length; i++) if (curForms[i].id === formId) { selForm = i; break; }
    }
    var forms = curForms;

    // shared blocks
    var descU = uniformValue(forms, "description", false);
    var psU = uniformValue(forms, "pseudocode", false);
    var flU = uniformValue(forms, "flags", true);
    var exU = uniformValue(forms, "exceptions", true);
    sharedState = {
      pseudo: psU.any && psU.uniform,
      flags: flU.any && flU.uniform,
      exc: exU.any && exU.uniform
    };

    // header chips
    var cats = {}, isa = {};
    forms.forEach(function (f) {
      f._f.cat.forEach(function (c) { cats[c] = 1; });
      (f.cpuid_features || []).forEach(function (x) { isa[x] = 1; });
    });
    var vex = firstWith(forms, "vendor_exclusive");
    var branch = firstWith(forms, "branch");
    var fam = (firstWith(forms, "groups") || []).filter(function (id) { return GROUPMETA[id] && GROUPMETA[id].kind === "family"; });

    var h = "";
    h += '<div class="eyebrow">x86 / x86-64 instruction</div>';
    h += '<h1 class="insn"><span class="accent">' + esc(mnem) + '</span></h1>';
    h += '<div class="insn-summary">' + esc(SROW[mnem].summary) + '</div>';

    h += '<div class="chips">';
    Object.keys(cats).forEach(function (c) { h += '<span class="chip cat">' + esc(c) + '</span>'; });
    Object.keys(isa).forEach(function (x) { h += '<span class="chip isa">' + esc(x) + '</span>'; });
    if (vex) h += '<span class="chip badge-' + esc(vex) + '">' + (vex === "intel" ? "Intel only" : "AMD only") + '</span>';
    if (branch && branch.kind && branch.kind !== "none") h += '<span class="chip branch">branch: ' + esc(branch.kind) + (branch.target ? " / " + esc(branch.target) : "") + '</span>';
    h += '</div>';

    h += '<div class="insn-actions">';
    h += '<a class="ov-btn ghost" href="#/" id="toOverview">&larr; overview</a>';
    h += '<a class="ov-btn" href="#" id="insnSurprise">surprise me &rarr;</a>';
    h += '</div>';

    // description (shared, representative)
    if (descU.any) {
      var d = firstWith(forms, "description");
      h += '<section class="blk" id="sec-desc"><h2><span class="n">01</span>Description</h2>';
      h += '<div class="prose" id="desc-body">' + descParas(d) + '</div>';
      h += '<span class="prose-toggle" id="desc-toggle"></span></section>';
    }
    // shared pseudocode
    if (sharedState.pseudo) {
      h += '<section class="blk" id="sec-pseudo"><h2><span class="n">02</span>Operation</h2>';
      h += '<pre class="code">' + hlPseudo(psU.value) + '</pre></section>';
    }
    // shared flags
    if (sharedState.flags) {
      h += '<section class="blk" id="sec-flags"><h2><span class="n">03</span>Flags affected</h2>' + flagGridHTML(flU.value) + '</section>';
    }

    // forms
    h += '<section class="blk" id="sec-forms"><h2><span class="n">04</span>Encodings <span class="n">(' + forms.length + ')</span></h2>';
    h += '<div class="form-strip" id="formStrip">';
    forms.forEach(function (f, idx) {
      var enc = (f.encodings && f.encodings[0]) || {};
      h += '<button class="form-tab' + (idx === selForm ? ' active' : '') + '" data-idx="' + idx + '">' +
        '<span class="ft-enc">' + esc(enc.encoding_string || enc.opcode || "?") + '</span>' +
        '<span class="ft-sig">' + esc(signature(f.operands) || "(no operands)") + '</span></button>';
    });
    h += '</div><div id="formPanel"></div></section>';

    // shared exceptions
    if (sharedState.exc) {
      h += '<section class="blk" id="sec-exc"><h2><span class="n">05</span>Exceptions</h2>' + excTableHTML(exU.value) + '</section>';
    }

    // see also
    if (fam.length) {
      var rel = {};
      fam.forEach(function (fid) {
        MNEMS.forEach(function (om) {
          if (om === mnem) return;
          var g = firstWith(BY_MNEM[om], "groups") || [];
          if (g.indexOf(fid) >= 0) rel[om] = 1;
        });
      });
      var relList = Object.keys(rel).slice(0, 24);
      if (relList.length) {
        h += '<section class="blk" id="sec-see"><h2><span class="n">06</span>See also</h2><div class="seealso">';
        relList.forEach(function (om) { h += '<a href="#/i/' + encodeURIComponent(om) + '">' + esc(om) + '</a>'; });
        h += '</div></section>';
      }
    }

    var view = $("#view");
    view.innerHTML = h;
    view.parentNode.scrollTop = 0;

    wireDescToggle();
    var surp = $("#insnSurprise");
    if (surp) surp.addEventListener("click", function (e) { e.preventDefault(); navigate(MNEMS[Math.floor(Math.random() * MNEMS.length)]); });
    var strip = $("#formStrip");
    strip.addEventListener("click", function (e) {
      var btn = e.target.closest(".form-tab");
      if (!btn) return;
      selForm = +btn.dataset.idx;
      strip.querySelectorAll(".form-tab").forEach(function (b) { b.classList.toggle("active", b === btn); });
      renderFormPanel();
      history.replaceState(null, "", "#/i/" + encodeURIComponent(mnem) + "/" + encodeURIComponent(curForms[selForm].id));
    });
    renderFormPanel();
    buildToc();
  }

  function descParas(text) {
    return text.split(/\n+/).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
  }
  function wireDescToggle() {
    var body = $("#desc-body"), tog = $("#desc-toggle");
    if (!body || !tog) return;
    if (body.scrollHeight <= body.clientHeight + 4 && body.textContent.length < 420) { tog.style.display = "none"; return; }
    var collapsed = true;
    body.classList.add("collapsed-prose");
    tog.textContent = "show more";
    tog.addEventListener("click", function () {
      collapsed = !collapsed;
      body.classList.toggle("collapsed-prose", collapsed);
      tog.textContent = collapsed ? "show more" : "show less";
    });
  }

  function renderFormPanel() {
    var f = curForms[selForm];
    var encs = f.encodings || [];
    var primary = encs[0] || {};
    var h = "";

    h += '<div class="insn-summary" style="margin-top:.2rem">' + esc(f.summary || "") + '</div>';

    encs.forEach(function (enc, i) {
      h += '<div class="encline">' + esc(enc.encoding_string || (enc.prefix_map + " " + enc.opcode)) + '</div>';
      if (i === 0) h += byteDiagramHTML(enc);
    });

    // decode grid for primary encoding
    h += '<div class="kv">';
    h += kv("Opcode map", primary.prefix_map || "legacy");
    if (!primary.vex && !primary.evex && !primary.xop && primary.mandatory_prefix && primary.mandatory_prefix !== "none") h += kv("Mandatory prefix", primary.mandatory_prefix + "h");
    h += kv("Opcode", '<span class="hl">' + esc(primary.opcode || "") + '</span>');
    if (primary.opcode_extension != null) h += kv("Opcode ext", "/" + primary.opcode_extension);
    h += kv("ModR/M", primary.modrm ? "yes" : "no");
    if (primary.sib) h += kv("SIB", primary.sib);
    if (primary.default_operand_size) h += kv("Default op size", primary.default_operand_size + "-bit");
    if (primary.operand_size_prefix) h += kv("66h prefix", primary.operand_size_prefix);
    if (primary.address_size_prefix) h += kv("67h prefix", primary.address_size_prefix);
    if (primary.rex_w) h += kv("REX.W", "required");
    if (primary.immediate_size_bits) h += kv("Immediate", primary.immediate_size_bits + "-bit");
    if (primary.displacement_size_bits) h += kv("Displacement", primary.displacement_size_bits + "-bit");
    if (primary.vex) h += kv("VEX", "L=" + primary.vex.length + " pp=" + primary.vex.pp + " map=" + primary.vex.mmmmm + " W=" + primary.vex.w);
    if (primary.evex) h += kv("EVEX", (primary.evex.length ? "L=" + primary.evex.length + " " : "") + "pp=" + primary.evex.pp + " map=" + primary.evex.map + " W=" + primary.evex.w + (primary.evex.masking && primary.evex.masking !== "none" ? " mask=" + primary.evex.masking : "") + (primary.evex.broadcast ? " bcast" : "") + (primary.evex.sae ? " sae" : "") + (primary.evex.rounding_control ? " rc" : "") + (primary.evex.nd ? " ND" : "") + (primary.evex.nf ? " NF" : ""));
    if (primary.xop) h += kv("XOP", "L=" + primary.xop.length + " pp=" + primary.xop.pp + " map=" + primary.xop.map + " W=" + primary.xop.w);
    h += '</div>';

    // operands
    if (f.operands && f.operands.length) {
      h += '<table class="optable"><thead><tr><th>Operand</th><th>Role</th><th>Type</th><th>Size</th><th>Encoded in</th></tr></thead><tbody>';
      f.operands.forEach(function (o) {
        h += '<tr><td class="sig">' + esc(opToken(o)) + '</td>' +
          '<td class="role-' + esc(o.role) + '">' + esc(o.role) + '</td>' +
          '<td>' + esc(o.type) + (o.reg_class ? " (" + esc(o.reg_class) + ")" : "") + '</td>' +
          '<td>' + (o.size_bits ? o.size_bits + "-bit" : "&mdash;") + '</td>' +
          '<td class="slot">' + esc(o.encoding_slot || "&mdash;") + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    if (f.implicit_operands && f.implicit_operands.length) {
      h += '<div class="kv"><div><div class="k">Implicit operands</div><div class="v">' +
        f.implicit_operands.map(function (o) { return esc(o.name) + " (" + esc(o.role) + ")"; }).join(", ") + '</div></div></div>';
    }

    // modes
    h += '<div class="modes">';
    MODE_KEYS.forEach(function (k) {
      var on = f.modes && f.modes[k];
      h += '<span class="mode-pill ' + (on ? "on" : "off") + '">' + esc(MODE_LABELS[k]) + '</span>';
    });
    h += '</div>';

    // per-form cpuid if not already in header union is fine to repeat compactly
    if (f.cpuid_features && f.cpuid_features.length) {
      h += '<div class="kv"><div><div class="k">CPUID feature flags</div><div class="v">' + esc(f.cpuid_features.join(", ")) + '</div></div></div>';
    }

    // per-form pseudocode / flags when not shared
    if (!sharedState.pseudo && f.pseudocode) {
      h += '<div class="k" style="margin:.4rem 0 .3rem">Operation</div><pre class="code">' + hlPseudo(f.pseudocode) + '</pre>';
    }
    if (!sharedState.flags && f.flags) {
      h += '<div class="k" style="margin:.7rem 0 .3rem">Flags affected</div>' + flagGridHTML(f.flags);
    }

    // vendor overrides
    if (f.vendor_overrides) {
      ["intel", "amd"].forEach(function (vn) {
        var ov = f.vendor_overrides[vn];
        if (!ov) return;
        h += '<div class="callout ' + vn + '" style="margin-top:.9rem"><div class="co-h">' + (vn === "intel" ? "Intel" : "AMD") + ' override</div><p>' + esc(ov.note) + '</p></div>';
      });
    }

    // per-form exceptions when not shared
    if (!sharedState.exc && f.exceptions && f.exceptions.length) {
      h += '<div class="k" style="margin:.9rem 0 .4rem">Exceptions</div>' + excTableHTML(f.exceptions);
    }

    // intrinsic + provenance
    if (f.intrinsic) {
      h += '<div class="kv" style="margin-top:.9rem"><div><div class="k">C intrinsic</div><div class="v"><a href="https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=' + encodeURIComponent(f.intrinsic) + '" target="_blank" rel="noopener"><span class="hl">' + esc(f.intrinsic) + '</span></a></div></div></div>';
    }
    if (f.provenance && f.provenance.length) {
      h += '<ul class="prov" style="margin-top:.9rem">';
      f.provenance.forEach(function (p) {
        var src = GROUPMETA_SRC(p.source);
        var label = (src ? src : p.source) + (p.section ? " — " + p.section : "") + (p.page ? " (" + p.page + ")" : "");
        if (p.url) h += '<li>source: <a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(label) + '</a></li>';
        else h += '<li>source: ' + esc(label) + '</li>';
      });
      h += '</ul>';
    }

    $("#formPanel").innerHTML = h;
  }
  function kv(k, v) { return '<div><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }
  function GROUPMETA_SRC(id) {
    var s = (DATA.sources || []).filter(function (x) { return x.id === id; })[0];
    return s ? (s.version || s.id) : id;
  }

  /* ---------------- right rail TOC + scroll spy ---------------- */
  function buildToc() {
    var toc = $("#toc");
    var secs = [];
    $("#view").querySelectorAll("section.blk").forEach(function (s) {
      var h2 = s.querySelector("h2");
      secs.push({ id: s.id, label: h2 ? h2.textContent.replace(/\s+/g, " ").trim() : s.id });
    });
    if (!secs.length) { toc.innerHTML = ""; return; }
    var h = '<div class="toc-h">on this page</div>';
    secs.forEach(function (s) { h += '<a class="toc-link" href="#" data-sec="' + s.id + '">' + esc(s.label) + '</a>'; });
    toc.innerHTML = h;
    toc.querySelectorAll(".toc-link").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var t = document.getElementById(a.dataset.sec);
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    if (tocObserver) tocObserver.disconnect();
    tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        toc.querySelectorAll(".toc-link").forEach(function (a) {
          a.classList.toggle("active", a.dataset.sec === en.target.id);
        });
      });
    }, { root: $("#center"), rootMargin: "0px 0px -70% 0px", threshold: 0 });
    $("#view").querySelectorAll("section.blk").forEach(function (s) { tocObserver.observe(s); });
  }

  /* ---------------- overview ---------------- */
  function renderOverview() {
    curMnem = null;
    if (tocObserver) tocObserver.disconnect();
    $("#toc").innerHTML = "";
    var nForms = DATA.instructions.length;
    var nCat = FACET_VALUES.cat.length;
    var nIsa = (DATA.groups || []).filter(function (g) { return g.kind === "isa_extension"; }).length;
    var enc = FCOUNT.enc;

    var h = "";
    h += '<div class="ov-hero"><div class="eyebrow">TonicBox &middot; reference</div>';
    h += '<h1><span class="accent">x86</span> instruction reference</h1>';
    h += '<p class="lede">Every documented x86 / x86-64 instruction form: encodings, operands, status-flag effects, CPU-mode validity, exceptions, and a byte-level layout of each form. Start typing on the left, press <b>/</b> to search or <b>Ctrl&nbsp;K</b> for the command palette, or browse by category below.</p></div>';

    h += '<div class="stat-grid">';
    h += stat("c0", nForms.toLocaleString(), "instruction forms");
    h += stat("c1", MNEMS.length.toLocaleString(), "mnemonics");
    h += stat("c2", nCat, "categories");
    h += stat("c3", nIsa, "ISA extensions");
    h += stat("c4", DATA.version, "dataset version");
    h += '</div>';

    h += '<div class="ov-actions">';
    h += '<a class="ov-btn" href="#" id="surprise">surprise me &rarr;</a>';
    h += '</div>';

    h += '<h2 class="ov-h2">Encoding families</h2><div class="tile-grid">';
    FACET_VALUES.enc.forEach(function (v) {
      h += '<a class="tile" href="#" data-dim="enc" data-val="' + esc(v) + '"><span class="tn">' + esc(v) + '</span><span class="tc">' + (enc[v] || 0) + '</span></a>';
    });
    h += '</div>';

    h += '<h2 class="ov-h2">Categories</h2><div class="tile-grid">';
    FACET_VALUES.cat.forEach(function (v) {
      h += '<a class="tile" href="#" data-dim="cat" data-val="' + esc(v) + '"><span class="tn">' + esc(v) + '</span><span class="tc">' + FCOUNT.cat[v] + '</span></a>';
    });
    h += '</div>';

    h += '<h2 class="ov-h2">Top extensions</h2><div class="tile-grid">';
    FACET_VALUES.isa.slice(0, 24).forEach(function (v) {
      h += '<a class="tile" href="#" data-dim="isa" data-val="' + esc(v) + '"><span class="tn">' + esc(v) + '</span><span class="tc">' + FCOUNT.isa[v] + '</span></a>';
    });
    h += '</div>';

    h += '<h2 class="ov-h2">Sources</h2><ul class="sources">';
    (DATA.sources || []).forEach(function (s) {
      var label = esc(s.version || s.id);
      h += '<li>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + label + '</a>' : label) + '</li>';
    });
    h += '</ul>';

    if (DATA.coverage) {
      h += '<h2 class="ov-h2">Coverage</h2><p class="prov">' + esc(DATA.coverage.note || "");
      if (DATA.coverage.semantics_from) h += ' ' + esc(DATA.coverage.semantics_from);
      if (DATA.coverage.encoding_only_isa && DATA.coverage.encoding_only_isa.length) h += ' Encoding-only (no prose yet): <b>' + DATA.coverage.encoding_only_isa.map(esc).join(", ") + '</b>.';
      h += '</p>';
    }

    h += '<p class="prov" style="margin-top:2rem">Data modeled to the TonicBox x86 ISA schema. Baseline fields follow Intel documentation; AMD divergences appear as per-instruction vendor overrides.</p>';

    var view = $("#view");
    view.innerHTML = h;
    view.parentNode.scrollTop = 0;

    $("#surprise").addEventListener("click", function (e) {
      e.preventDefault();
      navigate(MNEMS[Math.floor(Math.random() * MNEMS.length)]);
    });
    view.querySelectorAll(".tile").forEach(function (t) {
      t.addEventListener("click", function (e) {
        e.preventDefault();
        var dim = t.dataset.dim, val = t.dataset.val;
        FILTERS[dim].add(val);
        curQuery = ""; $("#q").value = "";
        refreshList(); renderActiveFilters(); renderFacets();
        openDrawer();
      });
    });
  }
  function stat(c, num, lab) { return '<div class="stat ' + c + '"><div class="num">' + esc(String(num)) + '</div><div class="lab">' + esc(lab) + '</div></div>'; }

  /* ---------------- routing ---------------- */
  function navigate(mnem) { location.hash = "#/i/" + encodeURIComponent(mnem); }
  function onHash() {
    var raw = (location.hash || "").replace(/^#\/?/, "");
    if (raw === "" || raw === "/") { renderOverview(); markActiveRow(); return; }
    var parts = raw.split("/");
    if (parts[0] === "i" && parts[1]) {
      var mnem = decodeURIComponent(parts[1]).toUpperCase();
      if (BY_MNEM[mnem]) { renderInstruction(mnem, parts[2] ? decodeURIComponent(parts[2]) : null); markActiveRow(); return; }
    }
    renderOverview(); markActiveRow();
  }

  /* ---------------- command palette ---------------- */
  var palSel = 0, palItems = [];
  function openPalette() {
    var p = $("#palette");
    p.classList.add("open");
    p.setAttribute("aria-hidden", "false");
    var inp = $("#pal-q");
    inp.value = "";
    palFilter("");
    inp.focus();
  }
  function closePalette() {
    var p = $("#palette");
    p.classList.remove("open");
    p.setAttribute("aria-hidden", "true");
  }
  function palFilter(q) {
    q = q.trim().toLowerCase();
    var out;
    if (!q) out = MNEMS.slice(0, 40);
    else {
      var scored = [];
      for (var i = 0; i < MNEMS.length; i++) {
        var sc = scoreRow(MNEMS[i], q, false);
        if (sc > 0) scored.push([sc, MNEMS[i]]);
      }
      scored.sort(function (a, b) { return b[0] - a[0] || (a[1] < b[1] ? -1 : 1); });
      out = scored.slice(0, 40).map(function (x) { return x[1]; });
    }
    palItems = out; palSel = 0;
    var list = $("#pal-list");
    list.innerHTML = "";
    out.forEach(function (m, idx) {
      var it = el("div", "pal-item" + (idx === 0 ? " sel" : ""));
      it.dataset.mnem = m;
      it.innerHTML = '<span class="m">' + esc(m) + '</span><span class="s">' + esc(SROW[m].summary || "") + '</span>';
      it.addEventListener("click", function () { closePalette(); navigate(m); });
      list.appendChild(it);
    });
  }
  function palMove(d) {
    if (!palItems.length) return;
    palSel = (palSel + d + palItems.length) % palItems.length;
    var items = $("#pal-list").children;
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("sel", i === palSel);
    if (items[palSel]) items[palSel].scrollIntoView({ block: "nearest" });
  }

  /* ---------------- drawer ---------------- */
  function openDrawer() { if (matchMedia("(max-width: 720px)").matches) document.body.classList.add("drawer-open"); }
  function closeDrawer() { document.body.classList.remove("drawer-open"); }

  /* ---------------- init UI ---------------- */
  function initUI() {
    renderFacets();
    renderActiveFilters();
    refreshList();

    var q = $("#q");
    q.addEventListener("input", debounce(function () { curQuery = q.value; refreshList(); }, 80));
    $("#ftToggle").addEventListener("change", function (e) { curFullText = e.target.checked; refreshList(); });

    $("#drawerToggle").addEventListener("click", function () { document.body.classList.toggle("drawer-open"); });
    $("#railScrim").addEventListener("click", closeDrawer);

    var pal = $("#pal-q");
    pal.addEventListener("input", function () { palFilter(pal.value); });
    $("#palette").addEventListener("click", function (e) { if (e.target.id === "palette") closePalette(); });

    document.addEventListener("keydown", function (e) {
      var inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if ($("#palette").classList.contains("open")) {
        if (e.key === "Escape") { e.preventDefault(); closePalette(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); palMove(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); palMove(-1); }
        else if (e.key === "Enter") { e.preventDefault(); var m = palItems[palSel]; if (m) { closePalette(); navigate(m); } }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); openPalette(); return; }
      if (e.key === "/" && !inField) { e.preventDefault(); openDrawer(); $("#q").focus(); return; }
      if (e.key === "Escape" && document.activeElement === $("#q")) { $("#q").blur(); }
    });

    window.addEventListener("hashchange", onHash);
  }

  /* ---------------- load ---------------- */
  function start() {
    runBoot();
    fetch("x86.json?v=2")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) {
        DATA = json;
        buildIndex();
        dataReady = true;
        bootFinish();
      })
      .catch(function (err) {
        dataReady = true; revealed = true;
        $("#boot-log").innerHTML += '<div style="color:#f7768e">failed to load dataset: ' + esc(err.message) + '</div>';
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
