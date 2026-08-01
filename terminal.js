(function () {
  "use strict";

  var screenEl = document.querySelector(".screen");
  var titleEl = document.querySelector(".titlebar .title");
  var greenDot = document.querySelector(".titlebar .dot.green");
  var terminalEl = document.querySelector(".terminal");
  if (!screenEl) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (!window.TBXVT) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var HOME = "/home/tonicbox";
  var ASCII = "  ╱|、\n(˚ˎ 。7\n|、˜〵\nじしˍ,)ノ";
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var wasm = null;
  var COLS = 80, ROWS = 24;
  var emu = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var outputEl, vtEl;

  function buildDom() {
    screenEl.className = "screen interactive";
    screenEl.innerHTML = "";
    outputEl = document.createElement("div");
    outputEl.className = "term-output";
    screenEl.appendChild(outputEl);
    vtEl = document.createElement("pre");
    vtEl.className = "vt-screen";
    screenEl.appendChild(vtEl);
  }

  function scrollBottom() { screenEl.scrollTop = screenEl.scrollHeight; }

  function renderProfileCard() {
    var html =
      '<div class="fetch"><pre class="ascii">' + ASCII + "</pre><div class=\"fetch-info\">" +
      '<p class="output name">TonicBox</p>' +
      '<p class="fetch-line"><span class="fetch-key">about</span>: Security researcher, software engineer, anime weeb.</p>' +
      '<p class="fetch-line"><span class="fetch-key">email</span>: <a class="link" href="mailto:gsec.tonicbox@protonmail.com">gsec.tonicbox@protonmail.com</a></p>' +
      '<p class="fetch-line"><span class="fetch-key">discord</span>: <a class="link" href="https://discordapp.com/users/246089066188111873" target="_blank" rel="noopener">tonicbox</a></p>' +
      '<p class="fetch-line"><span class="fetch-key">twitter</span>: <a class="link" href="https://x.com/Tonic_Box" target="_blank" rel="noopener">Tonic_Box</a></p>' +
      '<p class="fetch-line"><span class="fetch-key">github</span>: <a class="link" href="https://github.com/Tonic-Box" target="_blank" rel="noopener">Tonic-Box</a></p>' +
      "</div></div>";
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    outputEl.appendChild(wrap.firstChild);
    scrollBottom();
  }

  function renderLoginHeader() {
    renderProfileCard();
    var note = document.createElement("p");
    note.className = "output";
    note.style.cssText = "margin-top:.4rem;color:#7681b3;";
    note.innerHTML = 'Default password: <span style="color:#9ece6a">1234</span>';
    outputEl.appendChild(note);
    scrollBottom();
  }

  function cellClass(row, c) {
    var f = row.f[c], b = row.b[c], a = row.a[c], cls = "";
    if (a & 1) { var t = f; f = b; b = t; if (!f && !b) return (a & 2) ? "vt-rev vt-bold" : "vt-rev"; }
    if (f) cls = "vt-fg-" + f;
    if (b) cls = cls ? cls + " vt-bg-" + b : "vt-bg-" + b;
    if (a & 2) cls = cls ? cls + " vt-bold" : "vt-bold";
    return cls;
  }

  function rowHtml(row, curCol) {
    var n = row.c.length, last = -1;
    for (var c = 0; c < n; c++) if (row.c[c] !== " " || (row.a[c] & 1) || row.f[c] || row.b[c]) last = c;
    if (curCol != null && curCol > last) last = curCol;
    var html = "", i = 0;
    while (i <= last) {
      if (i === curCol) { html += '<span class="vt-cursor">' + esc(row.c[i]) + "</span>"; i++; continue; }
      var cls = cellClass(row, i), raw = "", j = i;
      while (j <= last && j !== curCol && cellClass(row, j) === cls) { raw += row.c[j]; j++; }
      var e = esc(raw);
      html += cls ? '<span class="' + cls + '">' + e + "</span>" : e;
      i = j;
    }
    return html;
  }

  function drainScrollback() {
    var rows = emu.takeFreshScrollback();
    for (var i = 0; i < rows.length; i++) {
      var d = document.createElement("div");
      d.className = "term-row";
      d.innerHTML = rowHtml(rows[i], null) || " ";
      outputEl.appendChild(d);
    }
    while (outputEl.childNodes.length > 4000) outputEl.removeChild(outputEl.firstChild);
  }
  var altActive = false;
  var lastVt = null;
  function render() {
    drainScrollback();
    var vp = emu.viewport(), cur = emu.cursor();
    if (emu.isAlt()) {
      outputEl.style.display = "none";
      var full = "";
      for (var r = 0; r < ROWS; r++) {
        full += rowHtml(vp[r], (cur.visible && r === cur.r) ? cur.c : null);
        if (r < ROWS - 1) full += "\n";
      }

      if (full !== lastVt) { vtEl.innerHTML = full; lastVt = full; }
      if (!altActive) { altActive = true; requestAnimationFrame(frame); }
      updateTitle();
      return;
    }
    if (altActive) keyClearAll();
    altActive = false;
    lastVt = null;
    outputEl.style.display = "";
    var end = cur.r, html = "";
    for (var rr = vp.length - 1; rr > end; rr--) {
      var rw = vp[rr], has = false;
      for (var cx = 0; cx < rw.c.length; cx++) { if (rw.c[cx] !== " " || rw.a[cx] || rw.f[cx] || rw.b[cx]) { has = true; break; } }
      if (has) { end = rr; break; }
    }
    for (var r2 = 0; r2 <= end; r2++) {
      html += rowHtml(vp[r2], (cur.visible && r2 === cur.r) ? cur.c : null);
      if (r2 < end) html += "\n";
    }
    vtEl.innerHTML = html;
    updateTitle();
    scrollBottom();
  }

  function updateTitle() {
    if (!wasm || !titleEl) return;
    var n = wasm.cwd_len_get();
    var cwd = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.cwd_ptr(), n));
    var homeDir = HOME;
    if (wasm.fg_home && wasm.fg_home_ptr) {
      var hl = wasm.fg_home();
      if (hl > 0) homeDir = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.fg_home_ptr(), hl));
    }
    var disp = cwd;
    if (cwd === homeDir) disp = "~";
    else if (cwd.indexOf(homeDir + "/") === 0) disp = "~" + cwd.slice(homeDir.length);
    var uname = wasm.fg_euid && wasm.fg_euid() === 0 ? "root" : "tonicbox";
    if (wasm.fg_user && wasm.fg_user_ptr) {
      var ul = wasm.fg_user();
      if (ul > 0) uname = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.fg_user_ptr(), ul));
    }
    titleEl.textContent = uname + "@dev: " + disp;
  }

  var clockBase = Date.now();
  function nowMs() { return (Date.now() - clockBase) >>> 0; }
  function setClocks() {
    if (wasm.set_clock) wasm.set_clock(Math.floor(Date.now() / 1000));
    if (wasm.set_clock_ms) wasm.set_clock_ms(nowMs());
  }

  function stage(bytes) {
    var b = (bytes instanceof Uint8Array) ? bytes : Uint8Array.from(bytes);
    new Uint8Array(wasm.memory.buffer, wasm.image_ptr(), b.length).set(b);
    return b.length;
  }

  function pumpRender() {
    setClocks();
    var rc = wasm.run(30000000), start = Date.now();
    while (rc === 0 && Date.now() - start < 8000) rc = wasm.run(30000000);
    var out = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
    if (out) emu.write(out);
    render();
    saveFS();
    if (wasm.reboot_pending && wasm.reboot_pending()) doReboot();
  }

  function send(bytes) {
    if (!wasm) return;
    wasm.out_reset();
    wasm.stdin_push(stage(bytes));
    pumpRender();
  }

  var held = {}, heldCount = 0, kbdLoopOn = false;
  function kbdLoop() {
    if (!wasm || heldCount <= 0 || altActive) { kbdLoopOn = false; return; }
    setClocks();
    wasm.out_reset();
    wasm.run(6000000);
    var o = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
    if (o) emu.write(o);
    render();
    requestAnimationFrame(kbdLoop);
  }
  function keyMake(id, bytes) {
    if (!wasm) return;
    if (!wasm.key_make) { send(bytes); return; }
    wasm.out_reset();
    var n = stage(bytes);
    wasm.key_make(id >>> 0, n);
    pumpRender();
    if (!held[id]) { held[id] = 1; heldCount++; if (!kbdLoopOn && !altActive) { kbdLoopOn = true; requestAnimationFrame(kbdLoop); } }
  }
  function keyBreak(id) {
    if (wasm && wasm.key_break) wasm.key_break(id >>> 0);
    if (held[id]) { delete held[id]; if (heldCount > 0) heldCount--; }
  }
  function keyClearAll() {
    if (wasm && wasm.key_clear) wasm.key_clear();
    held = {}; heldCount = 0;
  }
  function bytesOf(str) { var a = []; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); a.push(c > 255 ? 63 : c); } return a; }

  function randSeed() {
    if (window.crypto && window.crypto.getRandomValues) { var a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] || 1; }
    return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  }

  function doReboot() {
    if (!wasm) return;
    emu.reset();
    outputEl.innerHTML = "";
    altActive = false;
    wasm.boot_login(randSeed());
    if (wasm.seed_urandom && window.crypto && window.crypto.getRandomValues) { var ua = new Uint32Array(1); window.crypto.getRandomValues(ua); wasm.seed_urandom(ua[0] || 1); }
    restoreFS();
    if (wasm.set_winsize) wasm.set_winsize(ROWS, COLS);
    if (wasm.set_echo) wasm.set_echo(1);
    setClocks();
    wasm.run(30000000);
    var out = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
    if (out) emu.write(out);
    shadow = ""; histIdx = 0;
    render();
    startLogin();
  }

  function frame() {
    if (!altActive || !wasm) return;
    setClocks();
    wasm.out_reset();
    wasm.run(6000000);
    var o = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
    if (o) emu.write(o);
    render();
    if (altActive) requestAnimationFrame(frame);
  }

  function keyBytes(e) {
    var k = e.key;
    if (k === "ArrowUp") return [27, 91, 65];
    if (k === "ArrowDown") return [27, 91, 66];
    if (k === "ArrowRight") return [27, 91, 67];
    if (k === "ArrowLeft") return [27, 91, 68];
    if (k === "Enter") return [13];
    if (k === "Backspace") return [127];
    if (k === "Escape") return [27];
    if (k === "Tab") return [9];
    if (k === "F1") return [27, 79, 80];
    if (k === "F2") return [27, 79, 81];
    if (k === "F3") return [27, 79, 82];
    if (k === "F4") return [27, 79, 83];
    if (k === "F5") return [27, 91, 49, 53, 126];
    if (k === "F6") return [27, 91, 49, 55, 126];
    if (k === "F7") return [27, 91, 49, 56, 126];
    if (k === "F8") return [27, 91, 49, 57, 126];
    if (k === "F9") return [27, 91, 50, 48, 126];
    if (k === "F10") return [27, 91, 50, 49, 126];
    if (k === "F11") return [27, 91, 50, 51, 126];
    if (k === "F12") return [27, 91, 50, 52, 126];
    if (k === "Home") return [27, 91, 72];
    if (k === "End") return [27, 91, 70];
    if (k === "PageUp") return [27, 91, 53, 126];
    if (k === "PageDown") return [27, 91, 54, 126];
    if (k === "Insert") return [27, 91, 50, 126];
    if (k === "Delete") return [27, 91, 51, 126];
    if (k.length === 1) return [(e.ctrlKey && !e.altKey) ? (k.charCodeAt(0) & 0x1f) : k.charCodeAt(0)];
    return null;
  }

  function inputMode() {
    if (!wasm) return "shell";
    if (emu.isAlt() || (wasm.fg_raw && wasm.fg_raw() === 1)) return "raw";
    if (wasm.fg_shell && wasm.fg_shell() === 0) return "prog";
    return "shell";
  }

  var shadow = "";
  var history = [], histIdx = 0;

  function onKey(e) {
    if (booting || !wasm) return;
    if (e.metaKey) return;
    if (e.ctrlKey && (e.key === "v" || e.key === "V")) return;

    if (e.ctrlKey && e.shiftKey) return;
    var mode = inputMode();
    if (mode === "raw") {

      if (e.repeat) { e.preventDefault(); return; }
      var rb = keyBytes(e);
      if (rb) { e.preventDefault(); keyMake(e.keyCode, rb); }
      return;
    }
    var k = e.key;
    if (mode === "shell") {
      if (k === "ArrowUp") { e.preventDefault(); histPrev(); return; }
      if (k === "ArrowDown") { e.preventDefault(); histNext(); return; }
      if (k === "Tab") { e.preventDefault(); tabComplete(); return; }
    }
    if (k === "Enter") { e.preventDefault(); onEnter(mode); return; }
    if (k === "Backspace") { e.preventDefault(); if (mode === "shell") shadow = shadow.slice(0, -1); send([127]); return; }
    if (k === "Tab") { e.preventDefault(); return; }
    if (k === "Escape") {
      e.preventDefault();
      if (mode === "shell" && terminalEl && terminalEl.classList.contains("maximized")) { setMaximized(false); return; }
      send([27]);
      return;
    }
    if (e.ctrlKey && !e.altKey && k.length === 1) {
      e.preventDefault();
      var lc = k.toLowerCase();
      if (lc === "l") { clearScreen(); return; }
      if (lc === "c") { if (mode === "shell") { send([21]); shadow = ""; } else send([3]); return; }
      if (lc === "u") { shadow = ""; send([21]); return; }
      if (lc === "w") { shadow = shadow.replace(/\s*\S+\s*$/, ""); send([23]); return; }
      if (lc === "d") { send([4]); return; }
      send([k.charCodeAt(0) & 0x1f]);
      return;
    }
    if (k.length === 1 && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (mode === "shell") shadow += k;
      send([k.charCodeAt(0) & 0xff]);
    }
  }

  function onEnter(mode) {
    if (mode === "shell") {
      var line = shadow, trimmed = line.trim();
      if (trimmed && history[history.length - 1] !== line) history.push(line);
      histIdx = history.length;
      if (trimmed === "clear") { shadow = ""; send([21]); clearScreen(); return; }
      shadow = "";
      send([10]);
      return;
    }
    send([10]);
  }

  function clearScreen() {
    outputEl.innerHTML = "";
    emu.dropScrollback();
    emu.clearKeepCursorLine();
    render();
  }

  function replaceLine(text) {
    shadow = text;
    send([21].concat(bytesOf(text)));
  }
  function histPrev() {
    if (!history.length) return;
    histIdx = Math.max(0, histIdx - 1);
    replaceLine(history[histIdx] || "");
  }
  function histNext() {
    if (histIdx >= history.length) return;
    histIdx++;
    replaceLine(histIdx < history.length ? history[histIdx] : "");
  }

  var SAFE_TOKEN = /^[A-Za-z0-9_./~-]*$/;
  var BUILTINS = ["cd", "clear", "exit"];
  var binCache = null;

  function queryDir(dir) {
    if (!wasm || !wasm.dir_list) return [];
    wasm.out_reset();
    var b = enc.encode(dir === "" ? "." : dir);
    new Uint8Array(wasm.memory.buffer, wasm.image_ptr(), b.length).set(b);
    wasm.dir_list(b.length);
    var out = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
    var res = [];
    out.split("\n").forEach(function (ln) {
      if (!ln) return;
      var name = ln.slice(2);
      if (name === "" || name === "." || name === "..") return;
      res.push({ name: name, isDir: ln.charAt(0) === "d" });
    });
    res.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return res;
  }
  function commandNames() {
    if (binCache) return binCache;

    var names = BUILTINS
      .concat(queryDir("/usr/local/bin").map(function (e) { return e.name; }))
      .concat(queryDir("/usr/bin").map(function (e) { return e.name; }))
      .concat(queryDir("/bin").map(function (e) { return e.name; }))
      .concat(queryDir("/sbin").map(function (e) { return e.name; }));
    var seen = {}, out = [];
    names.forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } });
    binCache = out.sort();
    return binCache;
  }
  function commonPrefix(arr) {
    if (!arr.length) return "";
    var p = arr[0];
    for (var i = 1; i < arr.length; i++) {
      var s = arr[i], j = 0;
      while (j < p.length && j < s.length && p[j] === s[j]) j++;
      p = p.slice(0, j);
      if (!p) break;
    }
    return p;
  }

  function listCandidates(entries) {
    var text = entries.map(function (e) {
      return e.isDir ? "\x1b[34m" + e.name + "/\x1b[0m" : e.name;
    }).join("  ");
    var cur = emu.cursor(), row = emu.viewport()[cur.r], line = "";
    for (var i = 0; i < cur.c && i < row.c.length; i++) line += row.c[i];
    var prompt = line.length >= shadow.length ? line.slice(0, line.length - shadow.length) : line;
    var col = (wasm && wasm.fg_euid && wasm.fg_euid() === 0) ? "\x1b[31m" : "\x1b[32m";
    emu.write("\n" + text + "\n" + col + prompt + "\x1b[0m" + shadow);
    render();
  }
  function tabComplete() {
    var value = shadow;
    var sep = " \t|<>";
    var ts = value.length;
    while (ts > 0 && sep.indexOf(value[ts - 1]) < 0) ts--;
    var token = value.slice(ts);
    if (!SAFE_TOKEN.test(token)) return;

    var segStart = 0;
    for (var i = 0; i < ts; i++) if (value[i] === "|") segStart = i + 1;
    var cmdpos = value.slice(segStart, ts).trim() === "";

    var entries, base;
    if (cmdpos && token.indexOf("/") < 0) {
      entries = commandNames()
        .filter(function (n) { return n.indexOf(token) === 0; })
        .map(function (n) { return { name: n, isDir: false }; });
      base = token;
    } else {
      var slash = token.lastIndexOf("/");
      var dir = slash < 0 ? "." : (slash === 0 ? "/" : token.slice(0, slash));
      base = token.slice(slash + 1);
      if (dir === "~") dir = HOME;
      else if (dir.indexOf("~/") === 0) dir = HOME + dir.slice(1);
      entries = queryDir(dir).filter(function (e) { return e.name.indexOf(base) === 0; });
    }
    if (entries.length === 0) return;
    if (entries.length === 1) {
      var only = entries[0];
      injectSuffix(base, only.name + (only.isDir ? "/" : " "));
      return;
    }
    var lcp = commonPrefix(entries.map(function (e) { return e.name; }));
    if (lcp.length > base.length) injectSuffix(base, lcp);
    else listCandidates(entries);
  }

  function injectSuffix(base, full) {
    var suffix = full.slice(base.length);
    if (!suffix) return;
    shadow += suffix;
    send(bytesOf(suffix));
  }

  function feedText(text) {
    var norm = text.replace(/\r\n?/g, "\n");
    var CH = 2048;
    for (var off = 0; off < norm.length; off += CH) send(bytesOf(norm.slice(off, off + CH)));
  }
  function wireInput() {
    document.addEventListener("keydown", onKey);

    document.addEventListener("keyup", function (e) {
      if (!wasm) return;
      if (held[e.keyCode]) keyBreak(e.keyCode);
    });

    window.addEventListener("blur", keyClearAll);
    document.addEventListener("visibilitychange", function () { if (document.hidden) keyClearAll(); });
    document.addEventListener("paste", function (e) {
      if (booting || !wasm) return;
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      var text = cd.getData("text");
      if (!text) return;
      e.preventDefault();
      var m = inputMode();
      if (m === "raw") { feedText(text); return; }
      var flat = text.replace(/\s*\n\s*/g, " ").trim();
      if (!flat) return;
      if (m === "shell") shadow += flat;
      send(bytesOf(flat));
    });
    screenEl.addEventListener("click", function (e) {
      if (booting) return;
      if (e.target.closest("a")) return;
      if (window.getSelection && String(window.getSelection())) return;
      window.focus();
    });
  }

  function measureCell() {
    var probe = document.createElement("pre");
    probe.className = "vt-screen";
    probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;";
    var rows = [];
    for (var k = 0; k < 10; k++) rows.push("MMMMMMMMMM");
    probe.textContent = rows.join("\n");
    screenEl.appendChild(probe);
    var rect = probe.getBoundingClientRect();
    screenEl.removeChild(probe);
    return { w: (rect.width / 10) || 8, h: (rect.height / 10) || 16 };
  }

  function computeGridSize() {
    var maxCols = 400, maxRows = 150;
    if (!terminalEl || !terminalEl.classList.contains("maximized")) { maxCols = 80; maxRows = 24; }
    var cell = measureCell();
    var cs = getComputedStyle(screenEl);
    var w = screenEl.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    var h = screenEl.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
    COLS = Math.max(40, Math.min(maxCols, Math.floor(w / cell.w)));
    ROWS = Math.max(10, Math.min(maxRows, Math.floor(h / cell.h)));
  }

  function syncWinsize(live) {
    computeGridSize();
    if (emu) emu.resize(COLS, ROWS);
    if (wasm && wasm.set_winsize) wasm.set_winsize(ROWS, COLS);
    if (live) render();
  }
  var maxBtn = null;
  function applyMaxState() {
    var on = terminalEl && terminalEl.classList.contains("maximized");
    if (maxBtn) {
      maxBtn.textContent = on ? "⤡" : "⤢";
      maxBtn.setAttribute("title", on ? "Restore terminal (Esc)" : "Maximize terminal");
    }
    if (greenDot) greenDot.setAttribute("title", on ? "restore" : "maximize");
  }
  function setMaximized(on) {
    if (!terminalEl) return;
    terminalEl.classList.toggle("maximized", on);
    applyMaxState();
    scrollBottom();
    requestAnimationFrame(function () { syncWinsize(true); });
  }
  function toggleMaximized() {
    setMaximized(!(terminalEl && terminalEl.classList.contains("maximized")));
  }
  function wireMaximize() {
    if (!terminalEl) return;
    var tb = document.querySelector(".titlebar");
    if (tb) {
      maxBtn = document.createElement("span");
      maxBtn.style.cssText = "margin-left:auto;cursor:pointer;font-size:14px;line-height:1;user-select:none;color:#565f89;";
      maxBtn.addEventListener("mouseover", function () { maxBtn.style.color = "#7aa2f7"; });
      maxBtn.addEventListener("mouseout", function () { maxBtn.style.color = "#565f89"; });
      maxBtn.addEventListener("click", toggleMaximized);
      tb.appendChild(maxBtn);
    }
    if (greenDot) {
      greenDot.style.cursor = "pointer";
      greenDot.addEventListener("click", toggleMaximized);
    }
    applyMaxState();
    var rzT = null;
    window.addEventListener("resize", function () {
      if (rzT) clearTimeout(rzT);
      rzT = setTimeout(function () { syncWinsize(true); }, 80);
    });
  }

  var booting = true;
  var skipped = false;
  var sleepers = [];
  function sleep(ms) {
    return new Promise(function (resolve) {
      var id = setTimeout(function () { sleepers = sleepers.filter(function (s) { return s.id !== id; }); resolve(); }, ms);
      sleepers.push({ id: id, resolve: resolve });
    });
  }
  function flushSleeps() { sleepers.forEach(function (s) { clearTimeout(s.id); s.resolve(); }); sleepers = []; }

  function bgTick() {
    if (!wasm || booting || emu.isAlt()) return;
    setClocks();
    wasm.out_reset();
    wasm.run(1500000);
    var o = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
    if (o) { emu.write(o); render(); }
  }

  var bgTimer = null;
  function startBgTick() { if (!bgTimer) bgTimer = setInterval(bgTick, 60); }
  function typeUser(i) {
    if (skipped) return;
    var u = "tonicbox";
    if (i >= u.length) { finishBoot(); return; }
    send([u.charCodeAt(i)]);
    sleep(70 + Math.random() * 40).then(function () { typeUser(i + 1); });
  }
  function finishBoot() {
    if (!booting) return;
    booting = false; skipped = true;
    document.removeEventListener("click", skipBoot, true);
    shadow = ""; histIdx = 0;
    send([10]);
    startBgTick();
  }
  function skipBoot() {
    if (!booting || skipped) return;
    booting = false; skipped = true;
    flushSleeps();
    document.removeEventListener("click", skipBoot, true);
    shadow = ""; histIdx = 0;
    send([21].concat(bytesOf("tonicbox\n")));
    startBgTick();
  }
  function startLogin() {
    booting = true; skipped = false;
    document.addEventListener("click", skipBoot, true);
    if (reduceMotion) { skipBoot(); return; }
    typeUser(0);
  }

  var PKEY = "tbx_fs_v1";
  var persistOn = false;
  try { persistOn = !!window.localStorage && localStorage.getItem("tbx_persist") === "1"; } catch (e) {}
  function b64enc(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function b64dec(b) { var s = atob(b), u8 = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; }

  var saveTimer = null;
  function saveFS() {
    if (!persistOn || !wasm || !wasm.fs_snapshot || saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; doSaveFS(); }, 600);
  }
  function doSaveFS() {
    try {
      var n = wasm.fs_snapshot();
      var bytes = new Uint8Array(wasm.memory.buffer, wasm.image_ptr(), n).slice();
      localStorage.setItem(PKEY, b64enc(bytes));
    } catch (e) {}
  }
  function restoreFS() {
    if (!persistOn || !wasm || !wasm.fs_restore) return;
    try {
      var b = localStorage.getItem(PKEY);
      if (!b) return;
      var bytes = b64dec(b);
      new Uint8Array(wasm.memory.buffer, wasm.image_ptr(), bytes.length).set(bytes);
      wasm.fs_restore(bytes.length);
    } catch (e) {}
  }
  function wirePersist() {
    var tb = document.querySelector(".titlebar");
    if (!tb) return;

    var rb = document.createElement("span");
    rb.style.cssText = "margin-left:14px;cursor:pointer;font-size:12px;user-select:none;color:#565f89;";
    rb.textContent = "reboot";
    rb.setAttribute("title", "Restart the machine (reseeds ASLR; persisted files survive).");
    rb.addEventListener("mouseover", function () { rb.style.color = "#7aa2f7"; });
    rb.addEventListener("mouseout", function () { rb.style.color = "#565f89"; });
    rb.addEventListener("click", function () { doReboot(); });
    tb.appendChild(rb);

    if (!window.localStorage) return;
    var t = document.createElement("span");
    t.style.cssText = "margin-left:14px;cursor:pointer;font-size:12px;user-select:none;";
    function draw() {
      t.textContent = "persist " + (persistOn ? "on" : "off");
      t.style.color = persistOn ? "#9ece6a" : "#565f89";
      t.setAttribute("title", persistOn
        ? "Your files survive page reloads. Click to turn off and clear saved data."
        : "Click to save your files across page reloads.");
    }
    draw();
    t.addEventListener("click", function () {
      persistOn = !persistOn;
      try {
        if (persistOn) { localStorage.setItem("tbx_persist", "1"); saveFS(); }
        else { localStorage.setItem("tbx_persist", "0"); localStorage.removeItem(PKEY); }
      } catch (e) {}
      draw();
    });
    tb.appendChild(t);
  }

  emu = window.TBXVT.createTerminal(COLS, ROWS, {
    onOsc: function (payload) {
      if (payload.indexOf("tbxlogin") >= 0) {
        emu.flushToScrollback();
        drainScrollback();
        renderLoginHeader();
      }
    }
  });
  buildDom();
  wireInput();
  wireMaximize();
  wirePersist();
  syncWinsize(false);

  fetch("tbvm.wasm?v=3")
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (buf) { return WebAssembly.instantiate(buf, {}); })
    .then(function (res) {
      wasm = res.instance.exports;
      var seed = 1;
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint32Array(1); window.crypto.getRandomValues(a); seed = a[0] || 1;
      } else seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
      wasm.boot_login(seed);
      if (wasm.seed_urandom && window.crypto && window.crypto.getRandomValues) {
        var ua = new Uint32Array(1); window.crypto.getRandomValues(ua); wasm.seed_urandom(ua[0] || 1);
      }
      restoreFS();
      if (wasm.set_winsize) wasm.set_winsize(ROWS, COLS);
      if (wasm.set_echo) wasm.set_echo(1);
      setClocks();
      wasm.run(30000000);
      var out = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
      if (out) emu.write(out);
      render();
      startLogin();
    })
    .catch(function () { wasm = null; });
})();
