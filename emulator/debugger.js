(function () {
  var host, regsEl, flagsEl, stackEl;
  var names = ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12", "sp", "fp", "lr"];

  function hx(n) { return (n >>> 0).toString(16).padStart(8, "0"); }

  function section(t) {
    var h = document.createElement("h2");
    h.textContent = t;
    return h;
  }

  function regCell(name, val, extra) {
    var d = document.createElement("div");
    d.className = "reg" + (extra || "");
    d.innerHTML = '<span class="rn">' + name + '</span><span class="rv">' + hx(val) + "</span>";
    return d;
  }

  function build(el) {
    host = el;
    host.innerHTML = "";
    host.appendChild(section("Registers"));
    regsEl = document.createElement("div");
    regsEl.className = "dbg-regs";
    host.appendChild(regsEl);
    flagsEl = document.createElement("div");
    flagsEl.className = "dbg-flags";
    host.appendChild(flagsEl);
    host.appendChild(section("Stack"));
    stackEl = document.createElement("div");
    stackEl.className = "dbg-stack";
    host.appendChild(stackEl);
    clear();
  }

  function clear() {
    regsEl.innerHTML = '<p class="hint">Run or step to inspect CPU state.</p>';
    flagsEl.innerHTML = "";
    stackEl.innerHTML = "";
  }

  function render(s) {
    if (!s || s.pc === undefined) return;
    regsEl.innerHTML = "";
    for (var i = 0; i < 16; i++) regsEl.appendChild(regCell(names[i], s.regs[i], ""));
    regsEl.appendChild(regCell("pc", s.pc, " reg-pc"));

    flagsEl.innerHTML = "";
    ["z", "n", "c", "v"].forEach(function (f) {
      var el = document.createElement("span");
      el.className = "flag" + (s.flags[f] ? " on" : "");
      el.textContent = f.toUpperCase();
      flagsEl.appendChild(el);
    });

    stackEl.innerHTML = "";
    s.stack.forEach(function (wd) {
      var line = document.createElement("div");
      line.className = "sline";
      line.innerHTML = '<span class="daddr">' + hx(wd.a) + '</span><span class="dtext">' + hx(wd.v) + "</span>";
      stackEl.appendChild(line);
    });
  }

  window.dbg = { attach: build, render: render, clear: clear };
})();
