/*
 * TonicBox interactive terminal.
 * Progressive enhancement: on desktop (has a mouse) it takes over the static
 * .screen and becomes a small shell over a virtual Linux-shaped filesystem.
 * Mobile / no-JS / crawlers keep the static markup untouched.
 */
(function () {
  "use strict";

  var screenEl = document.querySelector(".screen");
  var titleEl = document.querySelector(".titlebar .title");
  if (!screenEl) return;

  // Only enhance where there's a real pointer (desktop). Everyone else keeps
  // the static fallback already in the HTML.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var USER = "tonicbox";
  var HOST = "dev";
  var HOME = "/home/tonicbox";
  var ASCII = "  ╱|、\n(˚ˎ 。7\n|、˜〵\nじしˍ,)ノ";

  /* ------------------------------------------------------------------ VFS */

  function d(children) { return { type: "dir", children: children || {} }; }
  function f(content) { return { type: "file", content: content }; }

  var aboutTxt = [
    "TonicBox",
    "--------",
    "Security researcher, software engineer, anime weeb.",
    "",
    "I build low-level tooling: compilers, program analysis, JVM",
    "internals, and the occasional reverse-engineering rabbit hole.",
    "",
    "focus: development, reversing, research & writeups"
  ].join("\n");

  var contactTxt = [
    "email    gsec.tonicbox@protonmail.com",
    "discord  tonicbox",
    "twitter  x.com/Tonic_Box",
    "github   github.com/Tonic-Box"
  ].join("\n");

  var osRelease = [
    'NAME="TonicBoxOS"',
    'PRETTY_NAME="TonicBoxOS (rolling)"',
    "ID=tonicbox",
    'VERSION="rolling"',
    'HOME_URL="https://tonicbox.dev"'
  ].join("\n");

  var readme = [
    "# ~",
    "",
    "You're in an interactive shell. Poke around:",
    "  ls              list files",
    "  cat about.txt   read a file",
    "  links           blog & portfolio",
    "  help            all commands"
  ].join("\n");

  var fs = d({
    bin: d({ ls: f(""), cd: f(""), cat: f(""), clear: f(""), echo: f(""), neofetch: f("") }),
    boot: d({}),
    dev: d({ null: f(""), zero: f(""), random: f(""), tty: f("") }),
    etc: d({
      hostname: f("dev\n"),
      "os-release": f(osRelease + "\n"),
      motd: f("Welcome to TonicBoxOS.\nType `help` to see available commands.\n"),
      passwd: f("root:x:0:0:root:/root:/bin/bash\ntonicbox:x:1000:1000:TonicBox:/home/tonicbox:/bin/bash\n")
    }),
    home: d({
      tonicbox: d({
        ".bashrc": f("# nothing to see here... try 'help'\n"),
        ".profile": f("export PATH=$HOME/bin:$PATH\n"),
        "about.txt": f(aboutTxt + "\n"),
        "contact.txt": f(contactTxt + "\n"),
        "README.md": f(readme + "\n"),
        projects: d({
          "NOTES.txt": f("Public repos live on GitHub. Run `links` for the portfolio.\n")
        })
      })
    }),
    lib: d({}),
    opt: d({}),
    proc: d({}),
    root: d({ ".secret": f("nice try :)\n"), "flag.txt": f("you found it. gg.\n") }),
    sbin: d({}),
    tmp: d({}),
    usr: d({ bin: d({}), lib: d({}), local: d({}), share: d({}) }),
    var: d({ log: d({}), tmp: d({}) })
  });

  var cwd = ["home", "tonicbox"];

  function resolveParts(pathStr) {
    pathStr = (pathStr || "").trim();
    var parts;
    if (pathStr === "" || pathStr === "~") return HOME.split("/").filter(Boolean);
    if (pathStr.indexOf("~/") === 0) { parts = HOME.split("/").filter(Boolean); pathStr = pathStr.slice(2); }
    else if (pathStr.charAt(0) === "/") { parts = []; pathStr = pathStr.slice(1); }
    else parts = cwd.slice();
    var segs = pathStr.split("/");
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === "" || s === ".") continue;
      if (s === "..") { if (parts.length) parts.pop(); continue; }
      parts.push(s);
    }
    return parts;
  }

  function getNode(parts) {
    var node = fs;
    for (var i = 0; i < parts.length; i++) {
      if (node.type !== "dir") return null;
      node = node.children[parts[i]];
      if (!node) return null;
    }
    return node;
  }

  function prettyPath(parts) {
    var full = "/" + parts.join("/");
    if (full === HOME) return "~";
    if (full.indexOf(HOME + "/") === 0) return "~" + full.slice(HOME.length);
    return parts.length ? full : "/";
  }

  function promptStr() { return USER + "@" + HOST + ":" + prettyPath(cwd) + "$"; }

  /* -------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

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
    var line = document.createElement("p");
    line.className = "line";
    line.innerHTML = '<span class="prompt">' + esc(promptStr()) + "</span> " + esc(cmd);
    outputEl.appendChild(line);
    scrollBottom();
  }

  function updatePrompt() {
    promptEl.textContent = promptStr();
    if (titleEl) titleEl.textContent = USER + "@" + HOST + ": " + prettyPath(cwd);
  }

  /* ------------------------------------------------------------- commands */

  function infoLine(k, v) {
    return '<p class="fetch-line"><span class="fetch-key">' + k + "</span>: " + v + "</p>";
  }

  function renderNeofetch() {
    var html =
      '<div class="fetch">' +
        '<pre class="ascii">' + ASCII + "</pre>" +
        '<div class="fetch-info">' +
          '<p class="output name">TonicBox</p>' +
          infoLine("about", "Security researcher, software engineer, anime weeb.") +
          infoLine("email", '<a class="link" href="mailto:gsec.tonicbox@protonmail.com">gsec.tonicbox@protonmail.com</a>') +
          infoLine("discord", '<a class="link" href="https://discordapp.com/users/246089066188111873" target="_blank" rel="noopener">tonicbox</a>') +
          infoLine("twitter", '<a class="link" href="https://x.com/Tonic_Box" target="_blank" rel="noopener">Tonic_Box</a>') +
          infoLine("github", '<a class="link" href="https://github.com/Tonic-Box" target="_blank" rel="noopener">Tonic-Box</a>') +
        "</div>" +
      "</div>";
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    outputEl.appendChild(wrap.firstChild);
    scrollBottom();
  }

  function renderLinks() {
    append('<a class="link" href="https://blog.tonicbox.dev"><span class="purple">blog</span> - compilers, tooling, and misadventures</a>');
    append('<a class="link" href="https://portfolio.tonicbox.dev"><span class="purple">portfolio</span> - personal projects showcase</a>');
  }

  var COMMANDS = {
    help: function () {
      var rows = [
        ["help", "show this message"],
        ["ls", "list directory contents"],
        ["cd", "change directory"],
        ["cat", "print a file"],
        ["clear", "clear the screen"],
        ["neofetch", "system info card"],
        ["links", "blog & portfolio"]
      ];
      var body = rows.map(function (r) {
        var pad = " ".repeat(Math.max(1, 12 - r[0].length));
        return '  <span class="term-cmd">' + r[0] + "</span>" + pad + esc(r[1]);
      }).join("\n");
      append("<pre>" + body + "</pre>");
    },

    ls: function (args) {
      var showAll = false, longFmt = false, pathArg = null;
      args.forEach(function (a) {
        if (a.charAt(0) === "-") {
          if (a.indexOf("a") > -1) showAll = true;
          if (a.indexOf("l") > -1) longFmt = true;
        } else pathArg = a;
      });
      var parts = resolveParts(pathArg == null ? "." : pathArg);
      var node = getNode(parts);
      if (!node) { append("ls: cannot access '" + esc(pathArg) + "': No such file or directory", "term-error"); return; }
      if (node.type === "file") { append(esc(pathArg)); return; }
      var names = Object.keys(node.children);
      if (!showAll) names = names.filter(function (n) { return n.charAt(0) !== "."; });
      names.sort();
      if (!names.length) { append(""); return; }
      if (longFmt) {
        var lines = names.map(function (n) {
          var c = node.children[n];
          var head = (c.type === "dir" ? "drwxr-xr-x" : "-rw-r--r--") + "  " + USER + "  " + USER + "  ";
          var nm = c.type === "dir" ? '<span class="term-dir">' + esc(n) + "</span>" : esc(n);
          return head + nm;
        });
        append("<pre>" + lines.join("\n") + "</pre>");
      } else {
        var cells = names.map(function (n) {
          var c = node.children[n];
          return c.type === "dir" ? '<span class="term-dir">' + esc(n) + "</span>" : esc(n);
        });
        append("<pre>" + cells.join("   ") + "</pre>");
      }
    },

    cd: function (args) {
      var target = "";
      for (var i = 0; i < args.length; i++) { if (args[i].charAt(0) !== "-") { target = args[i]; break; } }
      var parts = resolveParts(target);
      var node = getNode(parts);
      if (!node) { append("cd: " + esc(target) + ": No such file or directory", "term-error"); return; }
      if (node.type !== "dir") { append("cd: " + esc(target) + ": Not a directory", "term-error"); return; }
      cwd = parts;
      updatePrompt();
    },

    cat: function (args) {
      var files = args.filter(function (a) { return a.charAt(0) !== "-"; });
      if (!files.length) { append("cat: missing operand", "term-error"); return; }
      files.forEach(function (fname) {
        var node = getNode(resolveParts(fname));
        if (!node) { append("cat: " + esc(fname) + ": No such file or directory", "term-error"); return; }
        if (node.type === "dir") { append("cat: " + esc(fname) + ": Is a directory", "term-error"); return; }
        append("<pre>" + esc(node.content) + "</pre>");
      });
    },

    clear: function () { outputEl.innerHTML = ""; },
    neofetch: function () { renderNeofetch(); },
    links: function () { renderLinks(); }
  };

  var cmdHistory = [];
  var histIdx = 0;

  function runCommand(raw) {
    var cmd = raw.trim();
    if (!cmd) return;
    cmdHistory.push(cmd);
    histIdx = cmdHistory.length;
    var tokens = cmd.split(/\s+/);
    var name = tokens[0];
    var fn = COMMANDS[name];
    if (fn) fn(tokens.slice(1));
    else append("bash: " + esc(name) + ": command not found", "term-error");
  }

  /* ---------------------------------------------------------------- input */

  function showPrompt() {
    updatePrompt();
    inputLine.style.display = "flex";
    input.focus();
    scrollBottom();
  }

  function wireInput() {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var val = input.value;
        input.value = "";
        echoCommand(val);
        runCommand(val);
        updatePrompt();
        scrollBottom();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (cmdHistory.length) {
          histIdx = Math.max(0, histIdx - 1);
          input.value = cmdHistory[histIdx] || "";
          setCaretEnd();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdx < cmdHistory.length) {
          histIdx++;
          input.value = cmdHistory[histIdx] || "";
        }
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        outputEl.innerHTML = "";
      }
    });

    // Click anywhere in the terminal focuses the input, without stealing link
    // clicks or interrupting text selection.
    screenEl.addEventListener("click", function (e) {
      if (booting) return;
      if (e.target.closest("a")) return;
      if (window.getSelection && String(window.getSelection())) return;
      input.focus();
    });
  }

  function setCaretEnd() {
    var v = input.value;
    requestAnimationFrame(function () { input.setSelectionRange(v.length, v.length); });
  }

  /* -------------------------------------------------------- boot sequence */

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
    echoCommand("links"); renderLinks();
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
    line.innerHTML = '<span class="prompt">' + esc(promptStr()) + '</span> <span class="typed"></span><span class="type-cursor"></span>';
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
      .then(function () { if (skipped) return; return animateCommand("links"); })
      .then(function () { if (skipped) return; renderLinks(); return sleep(120); })
      .then(function () {
        if (skipped) return;
        booting = false;
        document.removeEventListener("click", skipBoot, true);
        showPrompt();
      });
  }

  /* ------------------------------------------------------------------ init */

  buildDom();
  wireInput();
  updatePrompt();

  if (reduceMotion) {
    booting = false;
    echoCommand("neofetch"); renderNeofetch();
    echoCommand("links"); renderLinks();
    showPrompt();
  } else {
    boot();
  }
})();
