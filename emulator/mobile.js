(function () {
  var app = document.getElementById("app");
  var mq = window.matchMedia("(max-width: 820px)");

  var ICONS = {
    run: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5 L19 12 L7 19 Z"/></svg>',
    debug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="13" rx="5" ry="6"/><path d="M12 7v-3M8 4l2 3M16 4l-2 3"/><path d="M7 11H3M7 14H3M7 17l-2 2M17 11h4M17 14h4M17 17l2 2"/></svg>',
    step: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5 L15 12 L6 19 Z"/><rect x="16" y="5" width="2.5" height="14" rx="1"/></svg>',
    cont: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5 L12 12 L4 19 Z"/><path d="M12 5 L20 12 L12 19 Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    assemble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.6L4 17l3 3 5.9-5.9a3.5 3.5 0 0 0 4.6-4.6l-2.2 2.2-2-2 2.2-2.2z"/></svg>',
    config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  function iconEl(name) {
    var d = document.createElement("div");
    d.innerHTML = ICONS[name];
    return d.firstElementChild;
  }

  var TOOLBAR_ICONS = { config: "config", assemble: "assemble", run: "run", debug: "debug", step: "step", continue: "cont", pause: "pause", stop: "stop" };

  function decorateToolbar() {
    Object.keys(TOOLBAR_ICONS).forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn || btn.classList.contains("has-icon")) return;
      btn.insertBefore(iconEl(TOOLBAR_ICONS[id]), btn.firstChild);
      btn.classList.add("has-icon");
    });
  }

  var VIEWS = [["editor", "Editor"], ["console", "Console"], ["terminal", "Terminal"], ["debugger", "Debug"]];
  var switchBtns = {};

  function buildSwitcher() {
    var bar = document.createElement("div");
    bar.id = "mview-bar";
    VIEWS.forEach(function (v) {
      var b = document.createElement("button");
      b.textContent = v[1];
      b.addEventListener("click", function () { setView(v[0]); });
      switchBtns[v[0]] = b;
      bar.appendChild(b);
    });
    app.appendChild(bar);
  }

  function applyView(name) {
    app.dataset.mview = name;
    Object.keys(switchBtns).forEach(function (k) {
      switchBtns[k].classList.toggle("active", k === name);
    });
  }

  function setView(name) {
    applyView(name);
    if (name === "console" || name === "terminal") {
      var btab = document.querySelector('.btab[data-panel="' + name + '"]');
      if (btab) btab.click();
    }
    if (name === "editor") window.editor.refresh();
    if (name === "terminal") { window.term.fit(); focusTerm(); }
  }

  window.onPanelChange = function (name) {
    if (mq.matches && (name === "console" || name === "terminal")) applyView(name);
  };

  var hidden = null;
  var ctrlBtn = null;
  var ctrlArmed = false;

  function feedText(s) { for (var i = 0; i < s.length; i++) window.term.feedKey(s[i]); }
  function feedSeq(s) { window.term.feedKey(s); }

  function focusTerm() {
    if (mq.matches && hidden) { window.term.setActive(true); hidden.focus(); }
  }

  function ctrlByte(ch) {
    var c = ch.toLowerCase().charCodeAt(0);
    if (c >= 97 && c <= 122) return String.fromCharCode(c - 96);
    return null;
  }

  function armCtrl(on) {
    ctrlArmed = on;
    if (ctrlBtn) ctrlBtn.classList.toggle("active", on);
  }

  function onBeforeInput(e) {
    if (!mq.matches) return;
    hidden.value = "";
    if (e.inputType === "insertText" && e.data) {
      if (ctrlArmed && e.data.length === 1) {
        var b = ctrlByte(e.data);
        if (b) feedSeq(b);
        armCtrl(false);
      } else {
        feedText(e.data);
      }
      e.preventDefault();
    } else if (e.inputType === "insertLineBreak") {
      feedSeq("\n");
      e.preventDefault();
    } else if (e.inputType === "deleteContentBackward") {
      feedSeq("\x7f");
      e.preventDefault();
    }
  }

  var KEYSEQ = {
    Escape: "\x1b", Tab: "\t", Enter: "\n", Backspace: "\x7f",
    ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D",
    Home: "\x1b[H", End: "\x1b[F", Delete: "\x1b[3~",
  };

  function onHiddenKeydown(e) {
    if (!mq.matches) return;
    e.stopPropagation();
    if (e.ctrlKey && e.key.length === 1) {
      var b = ctrlByte(e.key);
      if (b) { feedSeq(b); e.preventDefault(); }
      return;
    }
    var seq = KEYSEQ[e.key];
    if (seq && e.key !== "Enter" && e.key !== "Backspace") { feedSeq(seq); e.preventDefault(); }
  }

  function keyButton(child, fn) {
    var b = document.createElement("button");
    if (typeof child === "string") b.textContent = child;
    else b.appendChild(child);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) { e.preventDefault(); fn(); focusTerm(); });
    return b;
  }

  function buildTermInput() {
    var term = document.getElementById("terminal");
    var host = document.getElementById("term-host");

    hidden = document.createElement("input");
    hidden.id = "term-hidden-input";
    hidden.type = "text";
    hidden.setAttribute("autocomplete", "off");
    hidden.setAttribute("autocapitalize", "off");
    hidden.setAttribute("autocorrect", "off");
    hidden.setAttribute("spellcheck", "false");
    hidden.setAttribute("aria-hidden", "true");
    hidden.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;";
    hidden.addEventListener("beforeinput", onBeforeInput);
    hidden.addEventListener("keydown", onHiddenKeydown);
    term.appendChild(hidden);
    host.addEventListener("click", focusTerm);

    var bar = document.createElement("div");
    bar.id = "term-keybar";
    bar.appendChild(keyButton("Esc", function () { feedSeq("\x1b"); }));
    bar.appendChild(keyButton("Tab", function () { feedSeq("\t"); }));
    ctrlBtn = keyButton("Ctrl", function () { armCtrl(!ctrlArmed); });
    bar.appendChild(ctrlBtn);
    bar.appendChild(keyButton("^C", function () { feedSeq("\x03"); }));
    bar.appendChild(keyButton(iconEl("left"), function () { feedSeq("\x1b[D"); }));
    bar.appendChild(keyButton(iconEl("up"), function () { feedSeq("\x1b[A"); }));
    bar.appendChild(keyButton(iconEl("down"), function () { feedSeq("\x1b[B"); }));
    bar.appendChild(keyButton(iconEl("right"), function () { feedSeq("\x1b[C"); }));
    term.appendChild(bar);
  }

  function wireMenu() {
    var menu = document.querySelector(".menu");
    var title = menu && menu.querySelector(".menu-title");
    if (!menu || !title) return;
    title.addEventListener("click", function (e) {
      if (!mq.matches) return;
      e.stopPropagation();
      menu.classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (!menu.contains(e.target)) menu.classList.remove("open");
    });
    menu.querySelectorAll(".menu-drop button").forEach(function (b) {
      b.addEventListener("click", function () { menu.classList.remove("open"); });
    });
  }

  function apply() {
    if (mq.matches) {
      if (!app.dataset.mview) applyView("editor");
      var bottom = document.getElementById("bottom");
      if (bottom) bottom.style.height = "";
      window.editor.refresh();
      window.term.fit();
    } else {
      app.removeAttribute("data-mview");
      window.editor.refresh();
      window.term.fit();
    }
  }

  decorateToolbar();
  buildSwitcher();
  buildTermInput();
  wireMenu();
  if (mq.addEventListener) mq.addEventListener("change", apply);
  else mq.addListener(apply);
  apply();
})();
