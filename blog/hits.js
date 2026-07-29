(function () {
  "use strict";

  var BASE = "https://tonicbox-counter.gsec-tonicbox.workers.dev";

  function label(n) {
    return " · " + n.toLocaleString() + " reader" + (n === 1 ? "" : "s");
  }

  function reveal(host, n) {
    var span = document.createElement("span");
    span.title = "unique readers";
    span.style.cssText = "opacity:0;transition:opacity .45s ease;";
    span.textContent = label(n);
    host.appendChild(span);
    requestAnimationFrame(function () { span.style.opacity = "1"; });
  }

  function count(path, slug) {
    return fetch(BASE + path + "?slug=" + encodeURIComponent(slug))
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && typeof d.count === "number" ? d.count : null; })
      .catch(function () { return null; });
  }

  // A single post: register this read, then show the count on the meta line.
  var meta = document.querySelector(".post-head .meta");
  if (meta) {
    var parts = location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    var slug = parts.pop() || "index";
    if (slug === "index.html") slug = parts.pop() || "index";
    if (slug) count("/hit", slug).then(function (n) { if (n !== null) reveal(meta, n); });
    return;
  }

  // The blog index: show each post's count after its date, read-only (no increment).
  var entries = document.querySelectorAll(".post-list .post-entry");
  Array.prototype.forEach.call(entries, function (a) {
    var date = a.querySelector(".date");
    var href = (a.getAttribute("href") || "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    var slug = href.split("/").pop();
    if (!date || !slug) return;
    count("/count", slug).then(function (n) { if (n !== null) reveal(date, n); });
  });
})();
