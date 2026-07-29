(function () {
  "use strict";

  var ENDPOINT = "https://tonicbox-counter.gsec-tonicbox.workers.dev/hit";

  var meta = document.querySelector(".post-head .meta");
  if (!meta) return;

  var parts = location.pathname.split("/").filter(Boolean);
  var slug = parts.pop() || "index";
  if (slug === "index.html") slug = parts.pop() || "index";
  if (!slug) return;

  var span = document.createElement("span");
  span.title = "unique readers";
  span.style.cssText = "opacity:0;transition:opacity .45s ease;";
  meta.appendChild(span);

  fetch(ENDPOINT + "?slug=" + encodeURIComponent(slug))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || typeof d.count !== "number") return;
      span.textContent = " · " + d.count.toLocaleString() + " reader" + (d.count === 1 ? "" : "s");
      requestAnimationFrame(function () { span.style.opacity = "1"; });
    })
    .catch(function () {});
})();
