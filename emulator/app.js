(function () {
  var decoder = new TextDecoder();
  var emuState = "idle";
  var addrToLine = {}, lineToAddr = {};

  function hx(n) { return (n >>> 0).toString(16); }

  function logConsole(text, cls) {
    var c = document.getElementById("console");
    var line = document.createElement("div");
    line.className = cls || "log-info";
    line.textContent = text;
    c.appendChild(line);
    c.scrollTop = c.scrollHeight;
  }
  window.logConsole = logConsole;

  var curStatus = "";
  function setStatus(kind, text) {
    var key = kind + "|" + text;
    if (key === curStatus) return;
    curStatus = key;
    document.getElementById("term-dot").className = "dot dot-" + kind;
    document.getElementById("term-state").textContent = text;
  }

  function showPanel(name) {
    document.querySelectorAll(".btab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.panel === name);
    });
    document.querySelectorAll("#bottom-body .panel").forEach(function (p) {
      p.classList.toggle("active", p.id === name);
    });
    if (name === "terminal") window.term.fit();
  }

  function initBottomTabs() {
    document.querySelectorAll(".btab").forEach(function (b) {
      b.addEventListener("click", function () { showPanel(b.dataset.panel); });
    });
  }

  function setState(s) {
    emuState = s;
    var running = s === "running", paused = s === "paused";
    document.getElementById("run").disabled = running;
    document.getElementById("debug").disabled = running;
    document.getElementById("step").disabled = !paused;
    document.getElementById("continue").disabled = !paused;
    document.getElementById("pause").disabled = !running;
    document.getElementById("stop").disabled = !(running || paused);
    window.term.setActive(running);
  }

  async function runAssemble() {
    window.editor.clearError();
    var res = await window.assemble(window.editor.activeContent());
    if (res && res.ok) {
      logConsole("assembled " + window.editor.activeName() + " -> " + res.bytes + " bytes", "log-ok");
    } else if (res) {
      logConsole(window.editor.activeName() + ":" + res.line + ": " + res.message, "log-error");
      window.editor.markError(res.line);
      showPanel("console");
    } else {
      logConsole("assemble failed", "log-error");
    }
  }
  window.runAssemble = runAssemble;

  var cfg = { rawArgs: "", rawEnv: "", rawSeed: "", args: [], env: [], seed: null };

  function parseConfig() {
    cfg.args = cfg.rawArgs.trim() ? cfg.rawArgs.trim().split(/\s+/) : [];
    cfg.env = cfg.rawEnv.split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var i = l.indexOf("=");
      return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)];
    });
    var s = cfg.rawSeed.trim();
    cfg.seed = s === "" ? null : (Number.isFinite(Number(s)) ? Math.floor(Number(s)) : null);
  }

  function openConfig() {
    document.getElementById("cfg-args").value = cfg.rawArgs;
    document.getElementById("cfg-env").value = cfg.rawEnv;
    document.getElementById("cfg-seed").value = cfg.rawSeed;
    document.getElementById("config-modal").classList.remove("hidden");
  }

  function saveConfig() {
    cfg.rawArgs = document.getElementById("cfg-args").value;
    cfg.rawEnv = document.getElementById("cfg-env").value;
    cfg.rawSeed = document.getElementById("cfg-seed").value;
    parseConfig();
    document.getElementById("config-modal").classList.add("hidden");
    logConsole("run config saved" + (cfg.seed !== null ? " (seed " + cfg.seed + ")" : ""), "log-muted");
  }

  function closeConfig() {
    document.getElementById("config-modal").classList.add("hidden");
  }

  function buildRunReq() {
    return {
      src: window.editor.activeContent(),
      args: [window.editor.activeName()].concat(cfg.args),
      env: cfg.env,
      seed: cfg.seed,
    };
  }

  function logRunStart() {
    var extra = [];
    if (cfg.seed !== null) extra.push("seed=" + cfg.seed);
    if (cfg.args.length) extra.push("args: " + cfg.args.join(" "));
    logConsole("running " + window.editor.activeName() + (extra.length ? " (" + extra.join(", ") + ")" : ""), "log-muted");
  }

  function b64enc(str) {
    var b = new TextEncoder().encode(str), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function b64dec(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(arr);
  }

  function fileNew() { window.editor.newTab(); }

  async function fileOpen() {
    var res = await window.fileOpen();
    if (!res || !res.ok) return;
    var name = b64dec(res.name);
    window.editor.openTab(name, b64dec(res.content), b64dec(res.path));
    logConsole("opened " + name, "log-muted");
  }

  async function fileSave() {
    var path = window.editor.activePath();
    if (!path) return fileSaveAs();
    var res = await window.fileSave(b64enc(path), b64enc(window.editor.activeContent()));
    if (res && res.ok) { window.editor.markSaved(); logConsole("saved " + window.editor.activeName(), "log-ok"); }
    else logConsole("save failed", "log-error");
  }

  async function fileSaveAs() {
    var res = await window.fileSaveAs(b64enc(window.editor.activeName()), b64enc(window.editor.activeContent()));
    if (!res || !res.ok) return;
    var name = b64dec(res.name);
    window.editor.setActivePath(b64dec(res.path), name);
    logConsole("saved " + name, "log-ok");
  }

  window.fileMenu = { new: fileNew, open: fileOpen, save: fileSave, saveas: fileSaveAs };

  var confirmCb = null;
  function confirmDialog(msg, onConfirm) {
    document.getElementById("confirm-msg").textContent = msg;
    confirmCb = onConfirm;
    document.getElementById("confirm-modal").classList.remove("hidden");
  }
  window.confirmDialog = confirmDialog;

  function resolveConfirm(run) {
    var cb = confirmCb;
    confirmCb = null;
    document.getElementById("confirm-modal").classList.add("hidden");
    if (run && cb) cb();
  }

  function outToTerm(b64) {
    if (!b64) return;
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    window.term.write(decoder.decode(arr));
  }

  function showError(res) {
    logConsole(window.editor.activeName() + ":" + (res ? res.line : 0) + ": " + (res ? res.message : "failed to start"), "log-error");
    if (res && res.line) window.editor.markError(res.line);
    showPanel("console");
  }

  async function loadLineMap() {
    addrToLine = {};
    lineToAddr = {};
    var lm = await window.dbgLines();
    if (!lm) return;
    lm.forEach(function (e) {
      addrToLine[e.a] = e.l;
      if (lineToAddr[e.l] === undefined || e.a < lineToAddr[e.l]) lineToAddr[e.l] = e.a;
    });
  }

  async function registerBreakpoints() {
    var lines = window.editor.activeBps();
    for (var i = 0; i < lines.length; i++) {
      var addr = lineToAddr[lines[i]];
      if (addr !== undefined) await window.dbgBreak(addr, true);
    }
  }

  async function updateDebugView(doHighlight) {
    var s = await window.dbgSnapshot();
    window.dbg.render(s);
    if (doHighlight && s && s.pc !== undefined && addrToLine[s.pc] !== undefined) {
      window.editor.highlightLine(addrToLine[s.pc]);
    } else {
      window.editor.clearHighlight();
    }
  }

  function endRun(msg, logcls, kind, text) {
    setState("ended");
    logConsole(msg, logcls);
    setStatus(kind, text);
    updateDebugView(false);
  }

  function applyEnd(res) {
    switch (res.state) {
      case "halted": endRun("program halted", "log-muted", "idle", "halted"); return true;
      case "exited": endRun("program exited (code " + res.code + ")", res.code === 0 ? "log-ok" : "log-warn", res.code === 0 ? "ok" : "warn", "exited (" + res.code + ")"); return true;
      case "fault": endRun("fault " + res.code + " at pc=0x" + hx(res.pc), "log-error", "err", "fault"); return true;
      default: return false;
    }
  }

  var SPEEDS = {
    full: { steps: 1000000, delay: 0, live: false },
    fast: { steps: 1, delay: 60, live: true },
    medium: { steps: 1, delay: 120, live: true },
    slow: { steps: 1, delay: 300, live: true },
    crawl: { steps: 1, delay: 600, live: true },
  };

  function currentSpeed() {
    return SPEEDS[document.getElementById("speed").value] || SPEEDS.full;
  }

  async function tickOnce() {
    if (emuState !== "running") return;
    var sp = currentSpeed();
    var input = window.term.takeInput();
    var res = await window.emuTick(input ? btoa(input) : "", sp.steps);
    if (!res) { endRun("emulator error", "log-error", "err", "error"); return; }
    outToTerm(res.out);
    window.term.setRaw(res.raw);
    switch (res.state) {
      case "running":
        setStatus("running", "running");
        if (sp.live) await updateDebugView(true);
        setTimeout(tickOnce, sp.delay);
        break;
      case "sleep":
        setStatus("running", "running");
        if (sp.live) await updateDebugView(true);
        setTimeout(tickOnce, Math.max(sp.delay, res.ms || 0));
        break;
      case "waiting":
        setStatus("running", "waiting for input");
        setTimeout(tickOnce, 16);
        break;
      case "breakpoint":
        setState("paused");
        setStatus("warn", "paused (breakpoint 0x" + hx(res.pc) + ")");
        logConsole("breakpoint at 0x" + hx(res.pc), "log-warn");
        await updateDebugView(true);
        break;
      default: applyEnd(res);
    }
  }

  async function runProgram() {
    if (emuState === "running") return;
    window.editor.clearError();
    var res = await window.run(buildRunReq());
    if (!res || !res.ok) { showError(res); return; }
    await loadLineMap();
    await registerBreakpoints();
    showPanel("terminal");
    window.term.reset();
    await window.term.fit();
    window.editor.clearHighlight();
    setState("running");
    setStatus("running", "running");
    logRunStart();
    setTimeout(tickOnce, 0);
  }

  async function debugProgram() {
    if (emuState === "running") return;
    window.editor.clearError();
    var res = await window.run(buildRunReq());
    if (!res || !res.ok) { showError(res); return; }
    await loadLineMap();
    await registerBreakpoints();
    showPanel("terminal");
    window.term.reset();
    await window.term.fit();
    setState("paused");
    setStatus("warn", "paused (entry)");
    logConsole("debugging " + window.editor.activeName(), "log-muted");
    await updateDebugView(true);
  }

  function continueRun() {
    if (emuState !== "paused") return;
    window.editor.clearHighlight();
    setState("running");
    setStatus("running", "running");
    setTimeout(tickOnce, 0);
  }

  async function pauseRun() {
    if (emuState !== "running") return;
    setState("paused");
    setStatus("warn", "paused");
    await updateDebugView(true);
  }

  async function stepProgram() {
    if (emuState !== "paused") return;
    var res = await window.dbgStep();
    if (!res) { endRun("emulator error", "log-error", "err", "error"); return; }
    outToTerm(res.out);
    window.term.setRaw(res.raw);
    if (!applyEnd(res)) {
      setStatus("warn", res.state === "waiting" ? "paused (needs input)" : "paused");
      await updateDebugView(true);
    }
  }

  function stopProgram() {
    if (emuState === "idle") return;
    window.emuStop();
    setState("idle");
    setStatus("idle", "stopped");
    logConsole("stopped", "log-muted");
    window.editor.clearHighlight();
    window.dbg.clear();
  }

  function initDivider() {
    var div = document.getElementById("vdivider");
    var bottom = document.getElementById("bottom");
    var main = document.getElementById("main");
    var dragging = false, startY = 0, startH = 0;
    div.addEventListener("mousedown", function (e) {
      dragging = true;
      startY = e.clientY;
      startH = bottom.offsetHeight;
      document.body.style.cursor = "row-resize";
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var h = startH - (e.clientY - startY);
      var max = main.offsetHeight - 120;
      if (h < 80) h = 80;
      if (h > max) h = max;
      bottom.style.height = h + "px";
      window.editor.refresh();
    });
    document.addEventListener("mouseup", function () {
      if (dragging) { dragging = false; document.body.style.cursor = ""; window.term.fit(); }
    });
  }

  window.editor.init();
  window.term.attach(document.getElementById("term-host"));
  window.dbg.attach(document.getElementById("debug-pane"));
  initBottomTabs();
  initDivider();
  window.addEventListener("resize", function () { window.term.fit(); });
  document.getElementById("assemble").addEventListener("click", runAssemble);
  document.getElementById("run").addEventListener("click", runProgram);
  document.getElementById("debug").addEventListener("click", debugProgram);
  document.getElementById("step").addEventListener("click", stepProgram);
  document.getElementById("continue").addEventListener("click", continueRun);
  document.getElementById("pause").addEventListener("click", pauseRun);
  document.getElementById("stop").addEventListener("click", stopProgram);
  document.getElementById("config").addEventListener("click", openConfig);
  document.getElementById("cfg-save").addEventListener("click", saveConfig);
  document.getElementById("cfg-cancel").addEventListener("click", closeConfig);
  document.getElementById("confirm-cancel").addEventListener("click", function () { resolveConfirm(false); });
  document.getElementById("confirm-ok").addEventListener("click", function () { resolveConfirm(true); });
  document.getElementById("clear-console").addEventListener("click", function () {
    document.getElementById("console").innerHTML = "";
  });
  document.querySelectorAll(".menu-drop button").forEach(function (b) {
    b.addEventListener("click", function () {
      var fn = window.fileMenu[b.dataset.act];
      if (fn) fn();
      b.blur();
    });
  });
  setState("idle");
  logConsole("tb32emu ready.", "log-muted");
})();
