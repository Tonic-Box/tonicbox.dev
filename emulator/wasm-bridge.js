(function () {
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var ex = null;

  var imports = {
    env: {
      host_unix_seconds: function () { return BigInt(Math.floor(Date.now() / 1000)); },
      host_now_ms: function () { return BigInt(Date.now()); },
      host_random: function (ptr, len) {
        var buf = new Uint8Array(ex.memory.buffer, ptr, len);
        var off = 0;
        while (off < len) {
          var n = Math.min(65536, len - off);
          crypto.getRandomValues(buf.subarray(off, off + n));
          off += n;
        }
      },
    },
  };

  var ready = (async function () {
    var bytes = await (await fetch("tb32emu.wasm")).arrayBuffer();
    var res = await WebAssembly.instantiate(bytes, imports);
    ex = res.instance.exports;
    ex.emuInit();
  })();

  async function call(name, argsArray) {
    await ready;
    var nameBytes = enc.encode(name);
    var argBytes = enc.encode(JSON.stringify(argsArray));
    var nptr = ex.wasmAlloc(nameBytes.length);
    var aptr = ex.wasmAlloc(argBytes.length);
    var buf = new Uint8Array(ex.memory.buffer);
    buf.set(nameBytes, nptr);
    buf.set(argBytes, aptr);
    var rptr = ex.emuCall(nptr, nameBytes.length, aptr, argBytes.length);
    var view = new DataView(ex.memory.buffer);
    var len = view.getUint32(rptr, true);
    var text = dec.decode(new Uint8Array(ex.memory.buffer, rptr + 4, len));
    ex.wasmFree(nptr, nameBytes.length);
    ex.wasmFree(aptr, argBytes.length);
    return JSON.parse(text);
  }

  window.assemble = function (src) { return call("assemble", [src]); };
  window.run = function (o) { return call("run", [o]); };
  window.emuTick = function (b64, max) { return call("emuTick", [b64 || "", max]); };
  window.emuStop = function () { return call("emuStop", []); };
  window.dbgStep = function () { return call("dbgStep", []); };
  window.dbgBreak = function (addr, on) { return call("dbgBreak", [addr, on]); };
  window.dbgSnapshot = function () { return call("dbgSnapshot", []); };
  window.dbgLines = function () { return call("dbgLines", []); };
  window.setTermSize = function (cols, rows) { return call("setTermSize", [cols, rows]); };

  function b64enc(str) {
    var b = enc.encode(str), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function b64dec(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return dec.decode(arr);
  }

  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 0);
  }

  window.fileOpen = function () {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".s,.asm,.txt,text/plain";
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        if (!f) { resolve({ ok: false }); return; }
        var reader = new FileReader();
        reader.onload = function () { resolve({ ok: true, name: b64enc(f.name), content: b64enc(reader.result), path: "" }); };
        reader.onerror = function () { resolve({ ok: false }); };
        reader.readAsText(f);
      });
      document.body.appendChild(inp);
      inp.click();
      setTimeout(function () { if (inp.parentNode) inp.parentNode.removeChild(inp); }, 1000);
    });
  };

  window.fileSaveAs = function (nameB64, contentB64) {
    download(b64dec(nameB64), b64dec(contentB64));
    return Promise.resolve({ ok: true, path: "", name: nameB64 });
  };

  window.fileSave = function (pathB64, contentB64) {
    download(b64dec(pathB64) || "program.s", b64dec(contentB64));
    return Promise.resolve({ ok: true });
  };
})();
