(function () {
  var vt = window.TBXVT.createTerminal(80, 24);
  var host = null, canvas = null, ctx = null;
  var raw = false, active = false, lineBuf = "", inputBuf = "";
  var cw = 8, ch = 17, fontpx = 14, dpr = 1;
  var BG = "#0b0e14", FG = "#c0caf5";

  function hexOf(r, g, b) { return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }

  var PAL = (function () {
    var p = new Array(256), i;
    var base = [null, "#565f89", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5", "#7681b3", "#ff7a93", "#b9f38a", "#ffce8a", "#9db4ff", "#d3bbff", "#a5e9ff"];
    for (i = 0; i < 16; i++) p[i] = base[i];
    var game = ["#5c94fc", "#c84c0c", "#e39b00", "#e52521", "#4058e0", "#fbd7b5", "#7c3f00", "#ffffff", "#000000", "#00a800", "#80d010", "#fac000", "#b8621b", "#3cbc3c", "#9c9c9c", "#e02020"];
    for (i = 16; i < 32; i++) p[i] = game[i - 16];
    function cv(v) { return v ? 55 + v * 40 : 0; }
    for (i = 32; i < 232; i++) {
      var n = i - 16, r = Math.floor(n / 36) % 6, g = Math.floor(n / 6) % 6, b = n % 6;
      p[i] = hexOf(cv(r), cv(g), cv(b));
    }
    for (i = 232; i < 256; i++) { var v = 8 + (i - 232) * 10; p[i] = hexOf(v, v, v); }
    return p;
  })();

  function fgIndex(row, c) { return (row.a[c] & 1) ? row.b[c] : row.f[c]; }
  function bgIndex(row, c) { return (row.a[c] & 1) ? row.f[c] : row.b[c]; }
  function fgColor(i) { return i > 0 ? (PAL[i] || FG) : FG; }

  function setFont() {
    ctx.font = fontpx + 'px "Cascadia Code","JetBrains Mono",Consolas,monospace';
    ctx.textBaseline = "top";
  }

  function measure() {
    setFont();
    cw = ctx.measureText("M").width || 8;
    ch = Math.round(fontpx * 1.25);
  }

  function render() {
    if (!ctx) return;
    var vp = vt.viewport(), cur = vt.cursor(), rows = vt.rows(), cols = vt.cols();
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cols * cw + 2, rows * ch + 2);
    setFont();
    for (var r = 0; r < rows; r++) {
      var row = vp[r], y = r * ch, c;
      for (c = 0; c < cols; c++) {
        var b = bgIndex(row, c);
        if (b > 0) { ctx.fillStyle = PAL[b] || BG; ctx.fillRect(c * cw, y, cw + 1, ch); }
      }
      c = 0;
      while (c < cols) {
        var col = fgColor(fgIndex(row, c)), start = c, run = "";
        while (c < cols && fgColor(fgIndex(row, c)) === col) { run += row.c[c]; c++; }
        ctx.fillStyle = col;
        ctx.fillText(run, start * cw, y);
      }
    }
    if (cur.visible && cur.r < rows) {
      ctx.fillStyle = FG;
      ctx.fillRect(cur.c * cw, cur.r * ch, cw, ch);
      ctx.fillStyle = BG;
      ctx.fillText(vp[cur.r].c[cur.c] || " ", cur.c * cw, cur.r * ch);
    }
  }

  function fit() {
    if (!canvas || !host || host.clientWidth === 0) return Promise.resolve();
    dpr = window.devicePixelRatio || 1;
    measure();
    var cols = Math.max(20, Math.min(200, Math.floor((host.clientWidth - 16) / cw)));
    var rows = Math.max(5, Math.min(60, Math.floor((host.clientHeight - 12) / ch)));
    canvas.width = Math.ceil(cols * cw * dpr);
    canvas.height = Math.ceil(rows * ch * dpr);
    canvas.style.width = Math.ceil(cols * cw) + "px";
    canvas.style.height = Math.ceil(rows * ch) + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vt.resize(cols, rows);
    render();
    if (window.setTermSize) return window.setTermSize(cols, rows);
    return Promise.resolve();
  }

  function keyBytes(e) {
    var k = e.key;
    if (k.length === 1) {
      if (e.ctrlKey) {
        var cc = k.toLowerCase().charCodeAt(0);
        if (cc >= 97 && cc <= 122) return String.fromCharCode(cc - 96);
      }
      return k;
    }
    switch (k) {
      case "Enter": return "\n";
      case "Backspace": return "\x7f";
      case "Tab": return "\t";
      case "Escape": return "\x1b";
      case "ArrowUp": return "\x1b[A";
      case "ArrowDown": return "\x1b[B";
      case "ArrowRight": return "\x1b[C";
      case "ArrowLeft": return "\x1b[D";
      case "Home": return "\x1b[H";
      case "End": return "\x1b[F";
      case "Delete": return "\x1b[3~";
      default: return "";
    }
  }

  function handleBytes(b) {
    if (b === "") return;
    if (raw) { inputBuf += b; return; }
    if (b === "\n") { vt.write("\r\n"); inputBuf += lineBuf + "\n"; lineBuf = ""; render(); return; }
    if (b === "\x7f") { if (lineBuf.length) { lineBuf = lineBuf.slice(0, -1); vt.write("\b \b"); render(); } return; }
    if (b.length === 1 && b >= " ") { lineBuf += b; vt.write(b); render(); return; }
    inputBuf += b;
  }

  function onKey(e) {
    if (!active) return;
    var b = keyBytes(e);
    if (b === "") return;
    e.preventDefault();
    handleBytes(b);
  }

  document.addEventListener("keydown", onKey);

  window.term = {
    attach: function (el) {
      host = el;
      el.innerHTML = "";
      canvas = document.createElement("canvas");
      canvas.className = "vt-canvas";
      el.appendChild(canvas);
      ctx = canvas.getContext("2d");
      measure();
      render();
    },
    fit: fit,
    reset: function () { vt.reset(); lineBuf = ""; inputBuf = ""; raw = false; render(); },
    write: function (s) { vt.write(s); render(); },
    setRaw: function (v) { raw = !!v; },
    setActive: function (v) { active = !!v; },
    feedKey: handleBytes,
    isRaw: function () { return raw; },
    takeInput: function () { var s = inputBuf; inputBuf = ""; return s; },
  };
})();
