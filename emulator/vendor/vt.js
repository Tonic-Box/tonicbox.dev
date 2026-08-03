(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TBXVT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function pal16(i) { return i === 15 ? 231 : i + 1; }
  // map a 24-bit colour to the nearest xterm-256 palette index (the renderer works
  // in palette indices, so imported truecolour output shows an approximate colour).
  function rgbTo256(r, g, b) {
    if (r === g && g === b) { if (r < 8) return 16; if (r > 248) return 231; return 232 + Math.round((r - 8) / 247 * 24); }
    var ri = Math.round(r / 255 * 5), gi = Math.round(g / 255 * 5), bi = Math.round(b / 255 * 5);
    return 16 + 36 * ri + 6 * gi + bi;
  }

  function createTerminal(cols, rows, opts) {
    var COLS = cols || 80, ROWS = rows || 24;
    var onOsc = (opts && opts.onOsc) || null;
    var MAXSCROLL = 4000;
    var scroll = [];
    var freshFrom = 0;
    var normal = mkScreen(), alt = mkScreen();
    var scr = normal, altOn = false;
    var cr = 0, cc = 0, cfg = 0, cbg = 0, cattr = 0, cvis = true;
    var scrollTop = 0, scrollBot = ROWS - 1;
    var savedR = 0, savedC = 0, savedFg = 0, savedBg = 0, savedAttr = 0;
    var altSaveR = 0, altSaveC = 0, altSaveFg = 0, altSaveBg = 0, altSaveAttr = 0;
    var pend = "";

    function blankRow() { var c = [], f = [], b = [], a = []; for (var x = 0; x < COLS; x++) { c.push(" "); f.push(0); b.push(0); a.push(0); } return { c: c, f: f, b: b, a: a }; }
    function mkScreen() { var g = []; for (var r = 0; r < ROWS; r++) g.push(blankRow()); return g; }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function clearRow(r) { var row = scr[r]; for (var x = 0; x < COLS; x++) { row.c[x] = " "; row.f[x] = 0; row.b[x] = 0; row.a[x] = 0; } }
    function clearScreen() { for (var r = 0; r < ROWS; r++) clearRow(r); }

    // scroll the region [top,bot] up by n lines (blank rows enter at the bottom);
    // when the region starts at row 0 on the normal screen, evicted lines join the
    // scrollback, matching a plain line feed.
    function scrollRegionUp(top, bot, n) {
      for (var k = 0; k < n; k++) {
        var gone = scr[top];
        for (var r = top; r < bot; r++) scr[r] = scr[r + 1];
        scr[bot] = blankRow();
        if (!altOn && top === 0) { scroll.push(gone); if (scroll.length > MAXSCROLL) { scroll.shift(); if (freshFrom > 0) freshFrom--; } }
      }
    }
    function scrollRegionDown(top, bot, n) {
      for (var k = 0; k < n; k++) {
        for (var r = bot; r > top; r--) scr[r] = scr[r - 1];
        scr[top] = blankRow();
      }
    }
    function insChars(n) { var row = scr[cr]; for (var c = COLS - 1; c >= cc + n; c--) { row.c[c] = row.c[c - n]; row.f[c] = row.f[c - n]; row.b[c] = row.b[c - n]; row.a[c] = row.a[c - n]; } for (var c2 = cc; c2 < cc + n && c2 < COLS; c2++) { row.c[c2] = " "; row.f[c2] = 0; row.b[c2] = 0; row.a[c2] = 0; } }
    function delChars(n) { var row = scr[cr]; for (var c = cc; c < COLS; c++) { if (c + n < COLS) { row.c[c] = row.c[c + n]; row.f[c] = row.f[c + n]; row.b[c] = row.b[c + n]; row.a[c] = row.a[c + n]; } else { row.c[c] = " "; row.f[c] = 0; row.b[c] = 0; row.a[c] = 0; } } }
    function eraseChars(n) { var row = scr[cr]; for (var c = cc; c < cc + n && c < COLS; c++) { row.c[c] = " "; row.f[c] = 0; row.b[c] = 0; row.a[c] = 0; } }
    function lineFeed() {
      if (cr === scrollBot) { scrollRegionUp(scrollTop, scrollBot, 1); return; }
      if (cr < ROWS - 1) cr++;
    }
    function putc(chr) {
      if (cc >= COLS) { cc = 0; lineFeed(); }
      var row = scr[cr];
      row.c[cc] = chr; row.f[cc] = cfg; row.b[cc] = cbg; row.a[cc] = cattr; cc++;
    }
    function eraseLine(n) {
      var s = 0, e = COLS;
      if (n === 0) { s = cc; e = COLS; } else if (n === 1) { s = 0; e = cc + 1; }
      var row = scr[cr];
      for (var c = s; c < e && c < COLS; c++) { row.c[c] = " "; row.f[c] = 0; row.b[c] = 0; row.a[c] = 0; }
    }
    function eraseDisplay(n) {
      if (n === 2 || n === 3) { clearScreen(); return; }
      if (n === 0) { eraseLine(0); for (var r = cr + 1; r < ROWS; r++) clearRow(r); }
      else if (n === 1) { for (var r2 = 0; r2 < cr; r2++) clearRow(r2); eraseLine(1); }
    }
    function sgr(p) {
      for (var i = 0; i < p.length; i++) {
        var n = parseInt(p[i], 10) || 0;
        if (n === 0) { cattr = 0; cfg = 0; cbg = 0; }
        else if (n === 1) cattr |= 2;
        else if (n === 7) cattr |= 1;
        else if (n === 22) cattr &= ~2;
        else if (n === 27) cattr &= ~1;
        else if (n === 38 || n === 48) {

          if (p[i + 1] === "5") { var idx = parseInt(p[i + 2], 10) || 0; var v = idx < 16 ? pal16(idx) : idx; if (n === 38) cfg = v; else cbg = v; i += 2; }
          else if (p[i + 1] === "2") { var v2 = rgbTo256(parseInt(p[i + 2], 10) || 0, parseInt(p[i + 3], 10) || 0, parseInt(p[i + 4], 10) || 0); if (n === 38) cfg = v2; else cbg = v2; i += 4; }
        }
        else if (n === 39) cfg = 0;
        else if (n === 49) cbg = 0;
        else if (n >= 30 && n <= 37) cfg = pal16(n - 30);
        else if (n >= 90 && n <= 97) cfg = pal16(n - 90 + 8);
        else if (n >= 40 && n <= 47) cbg = pal16(n - 40);
        else if (n >= 100 && n <= 107) cbg = pal16(n - 100 + 8);
      }
    }

    function setAlt(on) {
      if (on && !altOn) {
        altSaveR = cr; altSaveC = cc; altSaveFg = cfg; altSaveBg = cbg; altSaveAttr = cattr;
        altOn = true; scr = alt; clearScreen(); cr = 0; cc = 0; cfg = 0; cbg = 0; cattr = 0;
      } else if (!on && altOn) {
        altOn = false; scr = normal;
        cr = altSaveR; cc = altSaveC; cfg = altSaveFg; cbg = altSaveBg; cattr = altSaveAttr;
      }
    }
    function handleCSI(priv, params, cmd) {
      var p = params.split(";"), n0 = parseInt(p[0], 10) || 0;
      if (priv) {
        if (params === "25") cvis = (cmd === "h");
        else if (params === "1049" || params === "1047" || params === "47") setAlt(cmd === "h");
        return;
      }
      if (cmd === "H" || cmd === "f") { cr = clamp((parseInt(p[0], 10) || 1) - 1, 0, ROWS - 1); cc = clamp((parseInt(p[1], 10) || 1) - 1, 0, COLS - 1); }
      else if (cmd === "A") cr = clamp(cr - (n0 || 1), 0, ROWS - 1);
      else if (cmd === "B") cr = clamp(cr + (n0 || 1), 0, ROWS - 1);
      else if (cmd === "C") cc = clamp(cc + (n0 || 1), 0, COLS - 1);
      else if (cmd === "D") cc = clamp(cc - (n0 || 1), 0, COLS - 1);
      else if (cmd === "G") cc = clamp((n0 || 1) - 1, 0, COLS - 1);
      else if (cmd === "d") cr = clamp((n0 || 1) - 1, 0, ROWS - 1);
      else if (cmd === "J") eraseDisplay(n0);
      else if (cmd === "K") eraseLine(n0);
      else if (cmd === "m") sgr(p);
      else if (cmd === "L") { if (cr >= scrollTop && cr <= scrollBot) scrollRegionDown(cr, scrollBot, n0 || 1); }
      else if (cmd === "M") { if (cr >= scrollTop && cr <= scrollBot) scrollRegionUp(cr, scrollBot, n0 || 1); }
      else if (cmd === "@") insChars(n0 || 1);
      else if (cmd === "P") delChars(n0 || 1);
      else if (cmd === "X") eraseChars(n0 || 1);
      else if (cmd === "S") scrollRegionUp(scrollTop, scrollBot, n0 || 1);
      else if (cmd === "T") scrollRegionDown(scrollTop, scrollBot, n0 || 1);
      else if (cmd === "r") { var t = (parseInt(p[0], 10) || 1) - 1, bt = (parseInt(p[1], 10) || ROWS) - 1; if (t < 0) t = 0; if (bt > ROWS - 1) bt = ROWS - 1; if (t < bt) { scrollTop = t; scrollBot = bt; cr = 0; cc = 0; } }
    }

    function write(s) {
      s = pend + s; pend = "";
      var i = 0, len = s.length;
      while (i < len) {
        var ch = s.charCodeAt(i);
        if (ch === 27) {
          if (i + 1 >= len) { pend = s.slice(i); return; }
          var n1 = s[i + 1];
          if (n1 === "[") {
            var j = i + 2, priv = false;
            if (s[j] === "?") { priv = true; j++; }
            var params = "";
            while (j < len) { var cc2 = s.charCodeAt(j); if ((cc2 >= 48 && cc2 <= 57) || cc2 === 59) { params += s[j]; j++; } else break; }
            if (j >= len) { pend = s.slice(i); return; }
            handleCSI(priv, params, s[j]);
            i = j + 1; continue;
          }
          if (n1 === "7") { savedR = cr; savedC = cc; savedFg = cfg; savedBg = cbg; savedAttr = cattr; i += 2; continue; }
          if (n1 === "8") { cr = savedR; cc = savedC; cfg = savedFg; cbg = savedBg; cattr = savedAttr; i += 2; continue; }
          if (n1 === "]") {
            var k = i + 2; while (k < len && s.charCodeAt(k) !== 7 && s[k] !== "\x1b") k++;
            if (k >= len) { pend = s.slice(i); return; }
            if (onOsc) onOsc(s.slice(i + 2, k));
            i = (s.charCodeAt(k) === 7) ? k + 1 : k; continue;
          }
          if (n1 === "D") { if (cr === scrollBot) scrollRegionUp(scrollTop, scrollBot, 1); else if (cr < ROWS - 1) cr++; i += 2; continue; }
          if (n1 === "M") { if (cr === scrollTop) scrollRegionDown(scrollTop, scrollBot, 1); else if (cr > 0) cr--; i += 2; continue; }
          if (n1 === "E") { cc = 0; if (cr === scrollBot) scrollRegionUp(scrollTop, scrollBot, 1); else if (cr < ROWS - 1) cr++; i += 2; continue; }
          i += 2; continue;
        }
        if (ch === 13) { cc = 0; i++; }
        else if (ch === 10) { cc = 0; lineFeed(); i++; }
        else if (ch === 8) { if (cc > 0) cc--; i++; }
        else if (ch === 9) { cc = clamp((Math.floor(cc / 8) + 1) * 8, 0, COLS - 1); i++; }
        else if (ch >= 32) { putc(s[i]); i++; }
        else i++;
      }
    }

    function copyGrid(src, dst, from, sr, sc) {
      var rr = sr - from; if (rr > ROWS) rr = ROWS;
      var cn = sc < COLS ? sc : COLS;
      for (var r = 0; r < rr; r++) for (var c = 0; c < cn; c++) { dst[r].c[c] = src[from + r].c[c]; dst[r].f[c] = src[from + r].f[c]; dst[r].b[c] = src[from + r].b[c]; dst[r].a[c] = src[from + r].a[c]; }
    }
    function resize(nc, nr) {
      if (nc === COLS && nr === ROWS) return;
      var oldN = normal, oldA = alt, oR = ROWS, oC = COLS;
      var normCur = altOn ? altSaveR : cr;
      var shedN = (nr < oR && normCur >= nr) ? normCur - nr + 1 : 0;
      var shedA = (altOn && nr < oR && cr >= nr) ? cr - nr + 1 : 0;
      COLS = nc; ROWS = nr;
      scrollTop = 0; scrollBot = ROWS - 1;
      normal = mkScreen(); alt = mkScreen();
      for (var s = 0; s < shedN; s++) {
        scroll.push(oldN[s]);
        if (scroll.length > MAXSCROLL) { scroll.shift(); if (freshFrom > 0) freshFrom--; }
      }
      copyGrid(oldN, normal, shedN, oR, oC);
      copyGrid(oldA, alt, shedA, oR, oC);
      scr = altOn ? alt : normal;
      if (altOn) { cr = clamp(cr - shedA, 0, ROWS - 1); altSaveR = clamp(altSaveR - shedN, 0, ROWS - 1); }
      else cr = clamp(cr - shedN, 0, ROWS - 1);
      cc = clamp(cc, 0, COLS - 1);
      savedR = clamp(savedR, 0, ROWS - 1);
    }

    function takeFreshScrollback() { var out = scroll.slice(freshFrom); freshFrom = scroll.length; return out; }
    function rowBlank(row) { for (var x = 0; x < COLS; x++) if (row.c[x] !== " ") return false; return true; }

    function flushToScrollback() {
      if (altOn) return;
      var end = rowBlank(scr[cr]) ? cr - 1 : cr;
      var r = 0;
      while (r <= end) { scroll.push(scr[r]); if (scroll.length > MAXSCROLL) { scroll.shift(); if (freshFrom > 0) freshFrom--; } r++; }
      normal = mkScreen(); scr = normal; cr = 0; cc = 0;
    }
    function reset() { scroll = []; freshFrom = 0; normal = mkScreen(); alt = mkScreen(); scr = normal; altOn = false; cr = 0; cc = 0; cfg = 0; cbg = 0; cattr = 0; cvis = true; pend = ""; scrollTop = 0; scrollBot = ROWS - 1; }

    function dropScrollback() { scroll = []; freshFrom = 0; }

    function clearKeepCursorLine() {
      if (altOn) return;
      var line = scr[cr];
      normal = mkScreen();
      normal[0] = line;
      scr = normal;
      cr = 0;
    }

    return {
      write: write, resize: resize, reset: reset,
      takeFreshScrollback: takeFreshScrollback,
      flushToScrollback: flushToScrollback,
      dropScrollback: dropScrollback,
      clearKeepCursorLine: clearKeepCursorLine,
      viewport: function () { return scr; },
      cursor: function () { return { r: cr, c: cc, visible: cvis }; },
      isAlt: function () { return altOn; },
      cols: function () { return COLS; }, rows: function () { return ROWS; },
      scrollbackLen: function () { return scroll.length; },

      rowText: function (r) { var row = scr[r], t = ""; for (var x = 0; x < COLS; x++) t += row.c[x]; return t.replace(/\s+$/, ""); },
      scrollbackText: function (idx) { var row = scroll[idx], t = ""; for (var x = 0; x < COLS; x++) t += row.c[x]; return t.replace(/\s+$/, ""); }
    };
  }

  return { createTerminal: createTerminal };
});
