/* arm64.tonicbox.dev - client-side ARM instruction reference driven by arm64.json. */
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
  var GROUPMETA = {};
  var MNEMS = [];
  var BY_MNEM = {};
  var SROW = {};
  var FCOUNT = {};
  var FILTERS = {};
  var FACET_VALUES = {};
  var curQuery = "";
  var curFullText = false;
  var curMnem = null;
  var curForms = null;
  var selForm = 0;
  var tocObserver = null;

  var ISET_ORDER = ["A64", "A32", "T32"];
  var DIMS = ["iset", "cls", "feat"];
  var FACET_DEFS = [
    { dim: "iset", title: "Instruction set", collapsed: false },
    { dim: "cls", title: "Class", collapsed: false },
    { dim: "feat", title: "Feature (FEAT_*)", collapsed: true }
  ];
  var KIND_LABEL = { reg: "register", simd: "SIMD/FP", sve: "SVE vector", pred: "predicate", imm: "immediate", mem: "memory", label: "label", cond: "condition" };

  /* ---------------- boot ---------------- */
  var dataReady = false, revealed = false, skipReq = false;

  function bootLine(html) {
    var div = el("div");
    div.innerHTML = html;
    $("#boot-log").appendChild(div);
  }
  function runBoot() {
    var skip = $("#boot-skip");
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    skip.textContent = reduced ? "" : "click anywhere to skip";
    $("#boot").addEventListener("click", function () { skipReq = true; tryReveal(true); });
    var pre = [
      '<span class="b">tonicbox@arm64</span>:~$ load ARM instruction set',
      'connecting to dataset ...',
      'fetching <span class="accent">arm64.json</span> ...'
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
      'indexed <span class="accent">' + MNEMS.length.toLocaleString() + '</span> mnemonics across ' + (FACET_VALUES.iset ? FACET_VALUES.iset.length : 0) + ' instruction sets',
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
  function buildIndex() {
    (DATA.groups || []).forEach(function (g) { GROUPMETA[g.id] = g; });
    var mset = {};
    DATA.instructions.forEach(function (f) {
      var m = f.mnemonic;
      if (!BY_MNEM[m]) { BY_MNEM[m] = []; mset[m] = 1; }
      BY_MNEM[m].push(f);
      var cls = (f.groups || []).filter(function (id) { var g = GROUPMETA[id]; return g && g.kind === "class"; })
        .map(function (id) { return GROUPMETA[id].name; });
      f._f = { iset: [f.iset], cls: cls, feat: f.features || [] };
    });
    MNEMS = Object.keys(mset).sort();
    MNEMS.forEach(function (m) {
      var forms = BY_MNEM[m];
      var summ = forms[0].signature || forms[0].summary || "";
      var desc = forms[0].description || "";
      SROW[m] = { mlow: m.toLowerCase(), slow: (desc + " " + summ).toLowerCase(), summary: summ, desc: desc, count: forms.length, ftext: null };
    });
    DIMS.forEach(function (d) { FCOUNT[d] = {}; FILTERS[d] = new Set(); });
    MNEMS.forEach(function (m) {
      var seen = { iset: {}, cls: {}, feat: {} };
      BY_MNEM[m].forEach(function (f) { DIMS.forEach(function (d) { f._f[d].forEach(function (v) { seen[d][v] = 1; }); }); });
      DIMS.forEach(function (d) { Object.keys(seen[d]).forEach(function (v) { FCOUNT[d][v] = (FCOUNT[d][v] || 0) + 1; }); });
    });
    FACET_VALUES.iset = ISET_ORDER.filter(function (v) { return FCOUNT.iset[v]; });
    FACET_VALUES.cls = Object.keys(FCOUNT.cls).sort(function (a, b) { return FCOUNT.cls[b] - FCOUNT.cls[a] || (a < b ? -1 : 1); });
    FACET_VALUES.feat = Object.keys(FCOUNT.feat).sort(function (a, b) { return FCOUNT.feat[b] - FCOUNT.feat[a] || (a < b ? -1 : 1); });
  }
  function getFtext(m) {
    var row = SROW[m];
    if (row.ftext != null) return row.ftext;
    var parts = [];
    BY_MNEM[m].forEach(function (f) {
      if (f.description) parts.push(f.description);
      if (f.signature) parts.push(f.signature);
      (f.operands || []).forEach(function (o) { parts.push(o.text); });
      (f.features || []).forEach(function (x) { parts.push(x); });
      if (f.id) parts.push(f.id);
    });
    row.ftext = parts.join(" \u0001 ").toLowerCase();
    return row.ftext;
  }

  /* ---------------- search + filters ---------------- */
  function anyActive() { for (var k in FILTERS) if (FILTERS[k] && FILTERS[k].size) return true; return false; }
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
  function mnemPasses(m) { var forms = BY_MNEM[m]; for (var i = 0; i < forms.length; i++) if (formPasses(forms[i])) return true; return false; }
  function applyFilters() { return anyActive() ? MNEMS.filter(mnemPasses) : MNEMS; }
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
    for (var i = 0; i < base.length; i++) { var sc = scoreRow(base[i], q, curFullText); if (sc > 0) scored.push([sc, base[i]]); }
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
      var shown = def.dim === "feat" ? vals.slice(0, 40) : vals;
      shown.forEach(function (v) {
        var opt = el("label", "facet-opt");
        opt.innerHTML = "<input type=\"checkbox\"><span>" + esc(v) + "</span><span class=\"fc\">" + FCOUNT[def.dim][v] + "</span>";
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
        var chip = el("span", "fchip");
        chip.innerHTML = esc(v) + " <span class=\"x\">&times;</span>";
        chip.title = "remove filter";
        chip.addEventListener("click", function () { FILTERS[def.dim].delete(v); refreshList(); renderActiveFilters(); renderFacets(); });
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
      row.title = SROW[m].desc || SROW[m].summary || "";
      var top = el("div", "irow-top");
      top.appendChild(el("span", "m", m));
      if (SROW[m].count > 1) top.appendChild(el("span", "cnt", SROW[m].count + " forms"));
      row.appendChild(top);
      if (SROW[m].desc) row.appendChild(el("div", "irow-sub", SROW[m].desc));
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

  /* ---------------- bit-field diagram ---------------- */
  function fieldLabel(f) {
    if (f.name) return f.name;
    var v = (f.value || "").replace(/'/g, "");
    if (/^[01]+$/.test(v)) return v;
    return v || "·";
  }
  function fieldClass(f, operandNames) {
    if (f.name && operandNames[f.name]) return "bf-op";
    if (f.name) return "bf-field";
    var v = (f.value || "").replace(/'/g, "");
    if (/^[01]+$/.test(v)) return "bf-fixed";
    return "bf-var";
  }
  function bitDiagramHTML(enc, operands) {
    if (!enc || !enc.fields || !enc.fields.length) return "";
    var w = enc.width || 32;
    var opNames = {};
    (operands || []).forEach(function (o) { (o.fields || []).forEach(function (fn) { opNames[fn] = o.text; }); });
    var fields = enc.fields.slice().sort(function (a, b) { return b.hi - a.hi; });
    var h = '<div class="bits" style="--bitw:' + w + '">';
    fields.forEach(function (f) {
      var span = f.hi - f.lo + 1;
      var range = f.hi === f.lo ? ("" + f.hi) : (f.hi + ":" + f.lo);
      var tip = (f.name ? f.name : "bits") + " [" + range + "]" + (f.value ? " = " + f.value.replace(/'/g, "") : "") + (f.name && opNames[f.name] ? " → " + opNames[f.name] : "");
      h += '<div class="bf ' + fieldClass(f, opNames) + '" style="flex-grow:' + span + '" data-tip="' + esc(tip) + '">' +
        '<div class="bf-lab">' + esc(fieldLabel(f)) + '</div>' +
        '<div class="bf-rng">' + esc(range) + '</div></div>';
    });
    h += '</div><div class="bytes-note">' + w + '-bit instruction word, bit ' + (w - 1) + ' (MSB) on the left down to bit 0</div>';
    return h;
  }

  /* ---------------- center: instruction view ---------------- */
  function isetTag(iset) { return '<span class="chip iset-' + esc(iset) + '">' + esc(iset) + '</span>'; }
  function renderInstruction(mnem, formId) {
    curMnem = mnem;
    curForms = BY_MNEM[mnem];
    selForm = 0;
    if (formId) { for (var i = 0; i < curForms.length; i++) if (curForms[i].id === formId) { selForm = i; break; } }
    var forms = curForms;

    var isets = {}, cls = {}, feats = {};
    forms.forEach(function (f) {
      isets[f.iset] = 1;
      f._f.cls.forEach(function (c) { cls[c] = 1; });
      (f.features || []).forEach(function (x) { feats[x] = 1; });
    });

    var h = "";
    h += '<div class="eyebrow">ARM instruction</div>';
    h += '<h1 class="insn"><span class="accent">' + esc(mnem) + '</span></h1>';
    h += '<div class="insn-summary">' + esc(SROW[mnem].desc || SROW[mnem].summary) + '</div>';

    h += '<div class="chips">';
    Object.keys(isets).forEach(function (s) { h += isetTag(s); });
    Object.keys(cls).forEach(function (c) { h += '<span class="chip cat">' + esc(c) + '</span>'; });
    Object.keys(feats).forEach(function (x) { h += '<span class="chip isa">' + esc(x) + '</span>'; });
    h += '</div>';

    h += '<div class="insn-actions">';
    h += '<a class="ov-btn ghost" href="#/" id="toOverview">&larr; overview</a>';
    h += '<a class="ov-btn" href="#" id="insnSurprise">surprise me &rarr;</a>';
    h += '</div>';

    h += '<section class="blk" id="sec-forms"><h2><span class="n">01</span>Encodings <span class="n">(' + forms.length + ')</span></h2>';
    h += '<div class="form-strip" id="formStrip">';
    forms.forEach(function (f, idx) {
      h += '<button class="form-tab' + (idx === selForm ? ' active' : '') + '" data-idx="' + idx + '">' +
        '<span class="ft-enc">' + esc(f.iset) + '</span>' +
        '<span class="ft-sig">' + esc(f.signature || f.id) + '</span></button>';
    });
    h += '</div><div id="formPanel"></div></section>';

    // see also: other mnemonics in the same class
    var relClassId = (firstWith(forms, "groups") || []).filter(function (id) { return GROUPMETA[id] && GROUPMETA[id].kind === "class"; })[0];
    if (relClassId) {
      var rel = {};
      MNEMS.forEach(function (om) {
        if (om === mnem) return;
        if ((BY_MNEM[om][0].groups || []).indexOf(relClassId) >= 0) rel[om] = 1;
      });
      var relList = Object.keys(rel).slice(0, 24);
      if (relList.length) {
        h += '<section class="blk" id="sec-see"><h2><span class="n">02</span>See also <span class="n">(' + esc(GROUPMETA[relClassId].name) + ')</span></h2><div class="seealso">';
        relList.forEach(function (om) { h += '<a href="#/i/' + encodeURIComponent(om) + '">' + esc(om) + '</a>'; });
        h += '</div></section>';
      }
    }

    var view = $("#view");
    view.innerHTML = h;
    view.parentNode.scrollTop = 0;

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
  function firstWith(forms, key) { for (var i = 0; i < forms.length; i++) if (forms[i][key]) return forms[i][key]; return null; }

  function renderFormPanel() {
    var f = curForms[selForm];
    var enc = f.encoding || {};
    var h = "";

    h += '<div class="encline">' + esc(f.signature || f.id) + '</div>';
    h += bitDiagramHTML(enc, f.operands);

    h += '<div class="kv">';
    h += kv("Instruction set", f.iset);
    h += kv("Class", classNameOf(f));
    h += kv("Width", (enc.width || 32) + "-bit");
    h += kv("Encoding id", '<span class="hl">' + esc(f.id) + '</span>');
    if (f.features && f.features.length) h += kv("Features", esc(f.features.join(", ")));
    h += '</div>';

    if (f.operands && f.operands.length) {
      h += '<table class="optable"><thead><tr><th>Operand</th><th>Kind</th><th>Encoded in</th></tr></thead><tbody>';
      f.operands.forEach(function (o) {
        h += '<tr><td class="sig">' + esc(o.text) + '</td>' +
          '<td>' + esc(KIND_LABEL[o.kind] || o.kind || "") + '</td>' +
          '<td class="slot">' + esc((o.fields && o.fields.length ? o.fields.join(", ") : "—")) + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    if (f.doc_url) {
      h += '<div class="callout arm" style="margin-top:1rem"><div class="co-h">Full semantics</div>' +
        '<p>Pseudocode, flag effects and the full description are published by Arm. ' +
        '<a href="' + esc(f.doc_url) + '" target="_blank" rel="noopener">View <b>' + esc(f.mnemonic) + '</b> in the Arm manual &rarr;</a></p></div>';
    }
    if (f.provenance && f.provenance.length) {
      h += '<ul class="prov" style="margin-top:.9rem">';
      f.provenance.forEach(function (p) {
        h += '<li>source: ' + esc(GROUPMETA_SRC(p.source)) + (p.page ? " — page <code>" + esc(p.page) + "</code>" : "") + '</li>';
      });
      h += '</ul>';
    }
    $("#formPanel").innerHTML = h;
  }
  function kv(k, v) { return '<div><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }
  function classNameOf(f) {
    var id = (f.groups || []).filter(function (g) { return GROUPMETA[g] && GROUPMETA[g].kind === "class"; })[0];
    return id ? GROUPMETA[id].name : "—";
  }
  function GROUPMETA_SRC(id) {
    var s = (DATA.sources || []).filter(function (x) { return x.id === id; })[0];
    return s ? (s.name || s.version || s.id) : id;
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
      a.addEventListener("click", function (e) { e.preventDefault(); var t = document.getElementById(a.dataset.sec); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
    });
    if (tocObserver) tocObserver.disconnect();
    tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        toc.querySelectorAll(".toc-link").forEach(function (a) { a.classList.toggle("active", a.dataset.sec === en.target.id); });
      });
    }, { root: $("#center"), rootMargin: "0px 0px -70% 0px", threshold: 0 });
    $("#view").querySelectorAll("section.blk").forEach(function (s) { tocObserver.observe(s); });
  }

  /* ---------------- overview ---------------- */
  function renderOverview() {
    curMnem = null;
    if (tocObserver) tocObserver.disconnect();
    $("#toc").innerHTML = "";

    var h = "";
    h += '<div class="ov-hero"><div class="eyebrow">TonicBox &middot; reference</div>';
    h += '<h1><span class="accent">ARM</span> instruction reference</h1>';
    h += '<p class="lede">Every AArch64 (A64) and AArch32 (A32/T32) instruction form: the 32/16-bit bit-field encoding, assembly syntax, operands, and feature gating. Start typing on the left, press <b>/</b> to search or <b>Ctrl&nbsp;K</b> for the command palette, or browse below. Full pseudocode and flag effects deep-link to the Arm manual.</p></div>';

    h += '<div class="stat-grid">';
    h += stat("c0", DATA.instructions.length.toLocaleString(), "instruction forms");
    h += stat("c1", MNEMS.length.toLocaleString(), "mnemonics");
    h += stat("c2", FACET_VALUES.iset.length, "instruction sets");
    h += stat("c3", FACET_VALUES.cls.length, "classes");
    h += stat("c4", DATA.version, "dataset version");
    h += '</div>';

    h += '<div class="ov-actions"><a class="ov-btn" href="#" id="surprise">surprise me &rarr;</a></div>';

    h += '<h2 class="ov-h2">Instruction sets</h2><div class="tile-grid">';
    FACET_VALUES.iset.forEach(function (v) {
      h += '<a class="tile" href="#" data-dim="iset" data-val="' + esc(v) + '"><span class="tn">' + esc(v) + '</span><span class="tc">' + FCOUNT.iset[v] + '</span></a>';
    });
    h += '</div>';

    h += '<h2 class="ov-h2">Classes</h2><div class="tile-grid">';
    FACET_VALUES.cls.forEach(function (v) {
      h += '<a class="tile" href="#" data-dim="cls" data-val="' + esc(v) + '"><span class="tn">' + esc(v) + '</span><span class="tc">' + FCOUNT.cls[v] + '</span></a>';
    });
    h += '</div>';

    h += '<h2 class="ov-h2">Top features</h2><div class="tile-grid">';
    FACET_VALUES.feat.slice(0, 24).forEach(function (v) {
      h += '<a class="tile" href="#" data-dim="feat" data-val="' + esc(v) + '"><span class="tn">' + esc(v) + '</span><span class="tc">' + FCOUNT.feat[v] + '</span></a>';
    });
    h += '</div>';

    h += '<h2 class="ov-h2">Sources</h2><ul class="sources">';
    (DATA.sources || []).forEach(function (s) {
      var label = esc((s.name || s.id) + (s.version ? " — " + s.version : ""));
      h += '<li>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + label + '</a>' : label) + '</li>';
    });
    h += '</ul>';

    if (DATA.coverage) {
      h += '<h2 class="ov-h2">Coverage</h2><p class="prov">' + esc(DATA.coverage.note || "");
      if (DATA.coverage.semantics_from) h += ' ' + esc(DATA.coverage.semantics_from);
      h += '</p>';
    }
    var src0 = (DATA.sources || [])[0] || {};
    h += '<h2 class="ov-h2">Attribution &amp; license</h2><p class="prov">';
    h += (DATA.coverage && DATA.coverage.attribution ? esc(DATA.coverage.attribution) + " " : "");
    h += "Encoding data is from the " + esc(src0.name || "Arm MRS") + " (" + esc(src0.license || "") + "); " + esc(src0.copyright || "") + " Short descriptions are TonicBox’s own factual mnemonic expansions, not sourced from Arm; ASL pseudocode and prose are Arm’s and are linked, not reproduced.";
    h += '</p>';

    var view = $("#view");
    view.innerHTML = h;
    view.parentNode.scrollTop = 0;

    $("#surprise").addEventListener("click", function (e) { e.preventDefault(); navigate(MNEMS[Math.floor(Math.random() * MNEMS.length)]); });
    view.querySelectorAll(".tile").forEach(function (t) {
      t.addEventListener("click", function (e) {
        e.preventDefault();
        FILTERS[t.dataset.dim].add(t.dataset.val);
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
  function openPalette() { var p = $("#palette"); p.classList.add("open"); p.setAttribute("aria-hidden", "false"); var inp = $("#pal-q"); inp.value = ""; palFilter(""); inp.focus(); }
  function closePalette() { var p = $("#palette"); p.classList.remove("open"); p.setAttribute("aria-hidden", "true"); }
  function palFilter(q) {
    q = q.trim().toLowerCase();
    var out;
    if (!q) out = MNEMS.slice(0, 40);
    else {
      var scored = [];
      for (var i = 0; i < MNEMS.length; i++) { var sc = scoreRow(MNEMS[i], q, false); if (sc > 0) scored.push([sc, MNEMS[i]]); }
      scored.sort(function (a, b) { return b[0] - a[0] || (a[1] < b[1] ? -1 : 1); });
      out = scored.slice(0, 40).map(function (x) { return x[1]; });
    }
    palItems = out; palSel = 0;
    var list = $("#pal-list");
    list.innerHTML = "";
    out.forEach(function (m, idx) {
      var it = el("div", "pal-item" + (idx === 0 ? " sel" : ""));
      it.dataset.mnem = m;
      it.innerHTML = '<span class="m">' + esc(m) + '</span><span class="s">' + esc(SROW[m].desc || SROW[m].summary || "") + '</span>';
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
    fetch("arm64.json?v=2")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) { DATA = json; buildIndex(); dataReady = true; bootFinish(); })
      .catch(function (err) {
        dataReady = true; revealed = true;
        $("#boot-log").innerHTML += '<div style="color:#f7768e">failed to load dataset: ' + esc(err.message) + '</div>';
      });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
