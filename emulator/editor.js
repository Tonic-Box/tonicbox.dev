(function () {
  var CM = window.CodeMirror;

  var MNEMONICS = "add|sub|and|or|xor|sll|srl|sra|slt|sltu|mul|divu|remu|cmp|tst|div|rem|" +
    "addi|andi|ori|xori|slli|srli|srai|slti|sltiu|lui|cmpi|lb|lbu|lh|lhu|lw|sb|sh|sw|" +
    "bra|beq|bne|blt|bge|bltu|bgeu|call|callr|ret|jmp|sys|hlt|brk|nop|mov|li|push|pop|j";

  CM.defineSimpleMode("tb32", {
    start: [
      { regex: /[;#].*/, token: "comment" },
      { regex: /\/\/.*/, token: "comment" },
      { regex: /"(?:[^"\\]|\\.)*"?/, token: "string" },
      { regex: /[A-Za-z_.$][\w.$]*:/, token: "def" },
      { regex: /\.[A-Za-z_][\w]*/, token: "meta" },
      { regex: /\b(?:r1[0-5]|r[0-9]|zero|sp|fp|lr)\b/, token: "variable-2" },
      { regex: /-?(?:0x[0-9a-fA-F]+|\d+)\b/, token: "number" },
      { regex: new RegExp("\\b(?:" + MNEMONICS + ")\\b", "i"), token: "keyword" },
      { regex: /[A-Za-z_.$][\w.$]*/, token: "variable" },
    ],
    meta: { lineComment: ";" },
  });

  var SAMPLE = [
    ".text",
    ".entry _start",
    "",
    "_start:",
    "    li r7, 1          ; write",
    "    li r1, 1          ; stdout",
    "    li r2, msg",
    "    li r3, 13",
    "    sys",
    "    li r7, 11         ; exit",
    "    li r1, 0",
    "    sys",
    "",
    ".rodata",
    'msg: .asciz "Hello, TB32!\\n"',
    "",
  ].join("\n");

  var cm;
  var tabs = [];
  var active = -1;
  var untitled = 0;
  var errorLine = null;

  function nextName() {
    untitled += 1;
    return "untitled-" + untitled + ".s";
  }

  function render() {
    var bar = document.getElementById("tabbar");
    bar.innerHTML = "";
    tabs.forEach(function (t, i) {
      var el = document.createElement("div");
      el.className = "tab" + (i === active ? " active" : "");
      if (t.doc.getValue() !== t.saved) {
        var dot = document.createElement("span");
        dot.className = "tab-dot";
        dot.textContent = "●";
        el.appendChild(dot);
      }
      var name = document.createElement("span");
      name.textContent = t.name;
      name.addEventListener("click", function () { select(i); });
      var close = document.createElement("span");
      close.className = "close";
      close.textContent = "×";
      close.title = "Close";
      close.addEventListener("click", function (e) { e.stopPropagation(); requestClose(i); });
      el.appendChild(name);
      el.appendChild(close);
      bar.appendChild(el);
    });
    var add = document.createElement("div");
    add.className = "tab-new";
    add.textContent = "+";
    add.title = "New file";
    add.addEventListener("click", function () { newTab(); });
    bar.appendChild(add);
  }

  function select(i) {
    if (i === active) return;
    clearError();
    clearHighlight();
    active = i;
    cm.swapDoc(tabs[i].doc);
    render();
    cm.focus();
  }

  var currentLine = null;

  function bpMarker() {
    var el = document.createElement("span");
    el.className = "bp-dot";
    el.textContent = "●";
    return el;
  }

  function toggleBp(n) {
    if (active < 0) return;
    var bps = tabs[active].bps;
    if (bps.has(n)) {
      bps.delete(n);
      cm.setGutterMarker(n, "bp-gutter", null);
    } else {
      bps.add(n);
      cm.setGutterMarker(n, "bp-gutter", bpMarker());
    }
  }

  function highlightLine(line) {
    clearHighlight();
    var l = line - 1;
    if (l < 0 || l >= cm.lineCount()) return;
    cm.addLineClass(l, "background", "cm-current-line");
    currentLine = l;
    cm.scrollIntoView({ line: l, ch: 0 }, 60);
  }

  function clearHighlight() {
    if (currentLine !== null) {
      cm.removeLineClass(currentLine, "background", "cm-current-line");
      currentLine = null;
    }
  }

  function newTab(name, content, path, saved) {
    tabs.push({ name: name || nextName(), doc: CM.Doc(content || "", "tb32"), path: path || null, bps: new Set(), saved: saved === undefined ? (content || "") : saved });
    active = -1;
    select(tabs.length - 1);
  }

  function requestClose(i) {
    var t = tabs[i];
    if (t.doc.getValue() !== t.saved && window.confirmDialog) {
      window.confirmDialog('Discard unsaved changes to "' + t.name + '"?', function () { closeTab(i); });
    } else {
      closeTab(i);
    }
  }

  function closeTab(i) {
    tabs.splice(i, 1);
    if (tabs.length === 0) {
      active = -1;
      newTab();
      return;
    }
    if (active >= tabs.length) active = tabs.length - 1;
    var target = active;
    active = -1;
    select(target);
  }

  function refreshDirty() {
    if (active < 0) return;
    var d = tabs[active].doc.getValue() !== tabs[active].saved;
    if (d !== tabs[active]._dirty) { tabs[active]._dirty = d; render(); }
  }

  function markSaved() {
    if (active < 0) return;
    tabs[active].saved = tabs[active].doc.getValue();
    tabs[active]._dirty = false;
    render();
  }

  function clearError() {
    if (cm && errorLine !== null) {
      cm.removeLineClass(errorLine, "background", "cm-error-line");
      errorLine = null;
    }
  }

  function markError(line) {
    clearError();
    var l = line - 1;
    if (l < 0 || l >= cm.lineCount()) return;
    cm.addLineClass(l, "background", "cm-error-line");
    errorLine = l;
    cm.scrollIntoView({ line: l, ch: 0 }, 80);
  }

  function init() {
    cm = CM(document.getElementById("editor"), {
      mode: "tb32",
      theme: "tb32",
      lineNumbers: true,
      gutters: ["CodeMirror-linenumbers", "bp-gutter"],
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      extraKeys: {
        "Ctrl-B": function () { if (window.runAssemble) window.runAssemble(); },
        "Ctrl-S": function () { if (window.fileMenu) window.fileMenu.save(); },
      },
    });
    cm.on("change", function () { clearError(); refreshDirty(); });
    cm.on("gutterClick", function (c, n) { toggleBp(n); });
    newTab("scratch.s", SAMPLE);
    setTimeout(function () { cm.refresh(); }, 0);
  }

  window.editor = {
    init: init,
    refresh: function () { if (cm) cm.refresh(); },
    newTab: newTab,
    openTab: function (name, content, path) { newTab(name, content, path, content); },
    markSaved: markSaved,
    markError: markError,
    clearError: clearError,
    activeContent: function () { return active >= 0 ? tabs[active].doc.getValue() : ""; },
    activeName: function () { return active >= 0 ? tabs[active].name : ""; },
    activePath: function () { return active >= 0 ? tabs[active].path : null; },
    activeBps: function () { return active >= 0 ? Array.from(tabs[active].bps).map(function (n) { return n + 1; }) : []; },
    highlightLine: highlightLine,
    clearHighlight: clearHighlight,
    setActivePath: function (path, name) {
      if (active < 0) return;
      tabs[active].path = path;
      if (name) tabs[active].name = name;
      tabs[active].saved = tabs[active].doc.getValue();
      tabs[active]._dirty = false;
      render();
    },
  };
})();
