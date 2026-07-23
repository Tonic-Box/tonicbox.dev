/*
 * TonicBox interactive terminal.
 * On desktop it loads the TonicBoxOS wasm image and becomes a real shell over
 * it; `neofetch` is intercepted host-side to render the rich landing card.
 * Mobile / no-JS keep the static markup untouched.
 */
(function () {
  "use strict";

  var screenEl = document.querySelector(".screen");
  var titleEl = document.querySelector(".titlebar .title");
  var greenDot = document.querySelector(".titlebar .dot.green");
  var terminalEl = document.querySelector(".terminal");
  if (!screenEl) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var PROMPT = "tonicbox@dev:~$";
  var HOME = "/home/tonicbox";
  var ASCII = "  ╱|、\n(˚ˎ 。7\n|、˜〵\nじしˍ,)ノ";
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var wasm = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ------------------------------------------------------------- DOM */
  var outputEl, inputLine, promptEl, input;

  function buildDom() {
    screenEl.className = "screen interactive";
    screenEl.innerHTML = "";
    outputEl = document.createElement("div");
    outputEl.className = "term-output";
    screenEl.appendChild(outputEl);

    inputLine = document.createElement("div");
    inputLine.className = "term-input-line";
    inputLine.style.display = "none";
    promptEl = document.createElement("span");
    promptEl.className = "prompt";
    promptEl.textContent = PROMPT;
    input = document.createElement("input");
    input.className = "cmd-input";
    input.type = "text";
    input.setAttribute("aria-label", "terminal input");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    inputLine.appendChild(promptEl);
    inputLine.appendChild(input);
    screenEl.appendChild(inputLine);
  }

  function scrollBottom() { screenEl.scrollTop = screenEl.scrollHeight; }

  function append(html, cls) {
    var el = document.createElement("div");
    el.className = "cmd-line" + (cls ? " " + cls : "");
    el.innerHTML = html;
    outputEl.appendChild(el);
    scrollBottom();
    return el;
  }

  function echoCommand(cmd) {
    var p = document.createElement("p");
    p.className = "line";
    p.innerHTML = '<span class="prompt">' + esc(PROMPT) + "</span> " + esc(cmd);
    outputEl.appendChild(p);
    scrollBottom();
  }

  function appendText(text) {
    if (!text) return;
    text = text.replace(/\n+$/, "");
    if (!text) return;
    append(esc(text));
  }

  /* -------------------------------------------------- rich cards (host) */
  function renderNeofetch() {
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

  /* ------------------------------------------------------- wasm bridge */
  function feedWasm(cmd) {
    if (!wasm) return "(TonicBoxOS still loading, one sec...)";
    wasm.out_reset();
    var b = enc.encode(cmd + "\n");
    new Uint8Array(wasm.memory.buffer, wasm.image_ptr(), b.length).set(b);
    wasm.stdin_push(b.length);
    wasm.run(30000000);
    return dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
  }

  function updatePrompt() {
    if (!wasm) return;
    var n = wasm.cwd_len_get();
    var cwd = dec.decode(new Uint8Array(wasm.memory.buffer, wasm.cwd_ptr(), n));
    var disp = cwd;
    if (cwd === HOME) disp = "~";
    else if (cwd.indexOf(HOME + "/") === 0) disp = "~" + cwd.slice(HOME.length);
    var root = wasm.fg_euid && wasm.fg_euid() === 0;
    PROMPT = (root ? "root@dev:" : "tonicbox@dev:") + disp + (root ? "#" : "$");
    if (promptEl) {
      promptEl.textContent = PROMPT;
      promptEl.className = root ? "prompt root" : "prompt";
    }
  }

  /* ---------------------------- VT100 screen (raw-tty apps, e.g. vi) */
  var COLS = 80, ROWS = 24;
  var screenMode = false;
  var grid = null, attr = null, curR = 0, curC = 0, curAttr = 0, vtEl = null;

  function initGrid() {
    grid = []; attr = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [], arow = [];
      for (var c = 0; c < COLS; c++) { row.push(" "); arow.push(0); }
      grid.push(row); attr.push(arow);
    }
    curR = 0; curC = 0; curAttr = 0;
  }
  function clearGrid() { for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) { grid[r][c] = " "; attr[r][c] = 0; } }

  function applyVT(s) {
    var i = 0;
    while (i < s.length) {
      var ch = s.charCodeAt(i);
      if (ch === 27 && s.charCodeAt(i + 1) === 91) {
        i += 2;
        var params = "";
        while (i < s.length) { var cc = s.charCodeAt(i); if ((cc >= 48 && cc <= 57) || cc === 59) { params += s[i]; i++; } else break; }
        var cmd = s[i]; i++;
        var p = params.split(";");
        if (cmd === "H") { curR = Math.max(0, Math.min(ROWS - 1, (parseInt(p[0]) || 1) - 1)); curC = Math.max(0, Math.min(COLS - 1, (parseInt(p[1]) || 1) - 1)); }
        else if (cmd === "J") { if (params === "2" || params === "") clearGrid(); }
        else if (cmd === "K") { for (var c2 = curC; c2 < COLS; c2++) { grid[curR][c2] = " "; attr[curR][c2] = 0; } }
        else if (cmd === "m") { for (var pi = 0; pi < p.length; pi++) { var n = parseInt(p[pi]) || 0; if (n === 7) curAttr = 1; else if (n === 0 || n === 27) curAttr = 0; } }
      } else if (ch === 13) { curC = 0; i++; }
      else if (ch === 10) { curR = Math.min(ROWS - 1, curR + 1); i++; }
      else if (ch === 8) { curC = Math.max(0, curC - 1); i++; }
      else { if (ch >= 32 && curC < COLS) { grid[curR][curC] = s[i]; attr[curR][curC] = curAttr; curC++; } i++; }
    }
  }
  function renderScreen() {
    var html = "";
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var e = esc(grid[r][c]);
        if (r === curR && c === curC) html += '<span class="vt-cursor">' + e + "</span>";
        else if (attr[r][c]) html += '<span class="vt-rev">' + e + "</span>";
        else html += e;
      }
      if (r < ROWS - 1) html += "\n";
    }
    vtEl.innerHTML = html;
  }
  function enterScreenMode() {
    screenMode = true;
    inputLine.style.display = "none";
    outputEl.style.display = "none";
    if (!vtEl) { vtEl = document.createElement("pre"); vtEl.className = "vt-screen"; screenEl.appendChild(vtEl); }
    vtEl.style.display = "block";
    initGrid();
  }
  function exitScreenMode() {
    screenMode = false;
    if (vtEl) vtEl.style.display = "none";
    outputEl.style.display = "";
    updatePrompt();
    showPrompt();
  }
  function feedRaw(bytes) {
    if (!wasm) return;
    wasm.out_reset();
    var b = new Uint8Array(bytes);
    new Uint8Array(wasm.memory.buffer, wasm.image_ptr(), b.length).set(b);
    wasm.stdin_push(b.length);
    wasm.run(30000000);
    applyVT(dec.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len())));
    renderScreen();
    if (wasm.fg_raw && wasm.fg_raw() === 0) exitScreenMode();
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
    if (k.length === 1) return [e.ctrlKey ? (k.charCodeAt(0) & 0x1f) : k.charCodeAt(0)];
    return null;
  }

  var history = [];
  var histIdx = 0;

  function runLine(val) {
    echoCommand(val);
    if (val === "") return;
    history.push(val);
    histIdx = history.length;
    if (val === "clear") { outputEl.innerHTML = ""; return; }
    if (val === "neofetch") { renderNeofetch(); return; }
    var out = feedWasm(val);
    if (wasm && wasm.fg_raw && wasm.fg_raw() === 1) {
      enterScreenMode();
      applyVT(out);
      renderScreen();
    } else {
      appendText(out);
      updatePrompt();
    }
  }

  function showPrompt() {
    inputLine.style.display = "flex";
    input.focus();
    scrollBottom();
  }

  function wireInput() {
    document.addEventListener("keydown", function (e) {
      if (!screenMode) return;
      var bytes = keyBytes(e);
      if (bytes) { e.preventDefault(); feedRaw(bytes); }
    });
    input.addEventListener("keydown", function (e) {
      if (screenMode) return;
      if (e.key === "Enter") {
        var v = input.value;
        input.value = "";
        runLine(v.trim());
        scrollBottom();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (history.length) { histIdx = Math.max(0, histIdx - 1); input.value = history[histIdx] || ""; }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdx < history.length) { histIdx++; input.value = history[histIdx] || ""; }
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        outputEl.innerHTML = "";
      }
    });
    screenEl.addEventListener("click", function (e) {
      if (booting) return;
      if (e.target.closest("a")) return;
      if (window.getSelection && String(window.getSelection())) return;
      input.focus();
    });
  }

  /* ----------------------------------------------- maximize (green dot) */
  function wireMaximize() {
    if (!greenDot || !terminalEl) return;
    greenDot.style.cursor = "pointer";
    greenDot.setAttribute("title", "maximize / restore");
    greenDot.addEventListener("click", function () {
      terminalEl.classList.toggle("maximized");
      scrollBottom();
      if (input) input.focus();
    });
  }

  /* -------------------------------------------------------- boot anim */
  var booting = true;
  var skipped = false;
  var sleepers = [];

  function sleep(ms) {
    return new Promise(function (resolve) {
      var id = setTimeout(function () {
        sleepers = sleepers.filter(function (s) { return s.id !== id; });
        resolve();
      }, ms);
      sleepers.push({ id: id, resolve: resolve });
    });
  }
  function flushSleeps() {
    sleepers.forEach(function (s) { clearTimeout(s.id); s.resolve(); });
    sleepers = [];
  }
  function finishBoot() {
    outputEl.innerHTML = "";
    echoCommand("neofetch"); renderNeofetch();
    booting = false;
    document.removeEventListener("click", skipBoot, true);
    showPrompt();
  }
  function skipBoot() {
    if (!booting || skipped) return;
    skipped = true;
    flushSleeps();
    finishBoot();
  }
  function animateCommand(cmd) {
    var line = document.createElement("p");
    line.className = "line";
    line.innerHTML = '<span class="prompt">' + esc(PROMPT) + '</span> <span class="typed"></span><span class="type-cursor"></span>';
    outputEl.appendChild(line);
    var typed = line.querySelector(".typed");
    var cursor = line.querySelector(".type-cursor");
    var i = 0;
    function step() {
      if (skipped) return Promise.resolve();
      if (i >= cmd.length) {
        return sleep(250).then(function () { if (cursor && cursor.parentNode) cursor.remove(); });
      }
      typed.textContent += cmd.charAt(i);
      i++;
      scrollBottom();
      return sleep(28 + Math.random() * 34).then(step);
    }
    return step();
  }
  function boot() {
    document.addEventListener("click", skipBoot, true);
    animateCommand("neofetch")
      .then(function () { if (skipped) return; renderNeofetch(); return sleep(160); })
      .then(function () {
        if (skipped) return;
        booting = false;
        document.removeEventListener("click", skipBoot, true);
        showPrompt();
      });
  }

  /* -------------------------------------------------------------- init */
  buildDom();
  wireInput();
  wireMaximize();

  // load the TonicBoxOS image (desktop only); boot UI proceeds meanwhile
  fetch("tbvm.wasm")
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (buf) { return WebAssembly.instantiate(buf, {}); })
    .then(function (res) {
      wasm = res.instance.exports;
      var seed = 1;
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint32Array(1);
        window.crypto.getRandomValues(a);
        seed = a[0] || 1;
      } else {
        seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
      }
      wasm.boot(seed); // per-session ASLR base + canary
      wasm.run(30000000); // shell loads and blocks on stdin
      updatePrompt();
    })
    .catch(function () { wasm = null; });

  if (reduceMotion) {
    booting = false;
    echoCommand("neofetch"); renderNeofetch();
    showPrompt();
  } else {
    boot();
  }
})();
