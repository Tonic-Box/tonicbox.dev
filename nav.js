/*
 * TonicBox unified top nav. Injected on every page (and every subdomain) via a
 * single absolute <script src="https://tonicbox.dev/nav.js">. Self-contained:
 * it injects its own scoped styles (all selectors prefixed .tbnav) and builds a
 * fixed top bar with absolute-URL links, a CTF dropdown, and a mobile hamburger.
 */
(function () {
  "use strict";
  if (window.__tbnav) return;
  window.__tbnav = true;

  var APEX = "https://tonicbox.dev";

  var css =
    ".tbnav{position:fixed;top:0;left:0;right:0;z-index:900;height:48px;display:flex;align-items:center;" +
      "padding:0 1.1rem;background:#0d111a;border-bottom:1px solid #1c2333;box-sizing:border-box;" +
      "font-family:'Cascadia Code','JetBrains Mono','Fira Code',Consolas,'SF Mono',monospace;font-size:13.5px;}" +
    ".tbnav a{text-decoration:none;color:#7681b3;}" +
    ".tbnav-brand{color:#c0caf5;font-weight:600;letter-spacing:.02em;margin-right:auto;}" +
    ".tbnav-brand .g{color:#7aa2f7;margin-right:.2rem;}" +
    ".tbnav-brand:hover{color:#dbe3ff;}" +
    ".tbnav-items{display:flex;align-items:center;gap:1.5rem;}" +
    ".tbnav-items>a,.tbnav-ctf{color:#7681b3;transition:color .15s ease;white-space:nowrap;}" +
    ".tbnav-items>a:hover,.tbnav-ctf:hover{color:#7aa2f7;}" +
    ".tbnav-ctf{color:#9ece6a;display:inline-flex;align-items:center;gap:.4rem;}" +
    ".tbnav-ctf:hover{color:#b6e08a;}" +
    ".tbnav-caret{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;" +
      "border-top:5px solid currentColor;opacity:.8;display:inline-block;}" +
    ".tbnav a.active{color:#7aa2f7;}" +
    ".tbnav-ctf.active{color:#9ece6a;}" +
    ".tbnav a.active:not(.tbnav-brand){text-decoration:underline;text-underline-offset:5px;}" +
    ".tbnav-drop{position:relative;display:inline-flex;align-items:center;}" +
    ".tbnav-menu{position:absolute;top:100%;right:0;margin-top:9px;min-width:230px;background:#10141f;" +
      "border:1px solid #1c2333;border-radius:8px;padding:.4rem;display:none;flex-direction:column;" +
      "box-shadow:0 14px 34px rgba(0,0,0,.55);}" +
    ".tbnav-menu::before{content:'';position:absolute;left:0;right:0;top:-11px;height:11px;}" +
    ".tbnav-drop:hover .tbnav-menu,.tbnav-drop:focus-within .tbnav-menu{display:flex;}" +
    ".tbnav-menu a{padding:.5rem .7rem;border-radius:5px;color:#c0caf5;font-size:13px;}" +
    ".tbnav-menu a:hover{background:#161c2b;color:#7aa2f7;}" +
    ".tbnav-burger{display:none;flex-direction:column;justify-content:center;gap:4px;width:34px;height:30px;" +
      "padding:0 6px;margin-left:1rem;background:none;border:1px solid #1c2333;border-radius:6px;cursor:pointer;}" +
    ".tbnav-burger span{display:block;height:2px;background:#7681b3;border-radius:2px;transition:background .15s ease;}" +
    ".tbnav-burger:hover span{background:#7aa2f7;}" +
    "@media(max-width:640px){" +
      ".tbnav-burger{display:flex;}" +
      ".tbnav-items{position:fixed;top:48px;left:0;right:0;flex-direction:column;align-items:stretch;gap:0;" +
        "background:#0d111a;border-bottom:1px solid #1c2333;padding:.4rem 0 .6rem;display:none;}" +
      ".tbnav.tbnav-open .tbnav-items{display:flex;}" +
      ".tbnav-items>a,.tbnav-ctf{padding:.65rem 1.3rem;}" +
      ".tbnav-drop{position:static;flex-direction:column;align-items:stretch;}" +
      ".tbnav-caret{display:none;}" +
      ".tbnav-menu{position:static;display:flex;box-shadow:none;border:none;background:none;padding:0 0 .3rem;min-width:0;margin:0;}" +
      ".tbnav-menu::before{display:none;}" +
      ".tbnav-menu a{color:#7681b3;padding:.5rem 1.3rem .5rem 2.4rem;}" +
      ".tbnav-menu a:hover{background:none;color:#7aa2f7;}" +
    "}";

  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function link(href, text, cls) { var a = el("a", cls); a.href = href; a.textContent = text; return a; }

  function build() {
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var nav = el("nav", "tbnav", { "aria-label": "site" });

    var brand = link(APEX + "/", "", "tbnav-brand");
    var g = el("span", "g"); g.textContent = ">_";
    brand.appendChild(g);
    brand.appendChild(document.createTextNode(" tonicbox"));
    nav.appendChild(brand);

    var burger = el("button", "tbnav-burger", { "aria-label": "menu", "aria-expanded": "false", type: "button" });
    burger.appendChild(el("span")); burger.appendChild(el("span")); burger.appendChild(el("span"));
    nav.appendChild(burger);

    var items = el("div", "tbnav-items");
    items.appendChild(link("https://portfolio.tonicbox.dev", "Portfolio"));
    items.appendChild(link("https://blog.tonicbox.dev", "Blog"));
    nav.appendChild(items);

    document.body.insertBefore(nav, document.body.firstChild);
    document.body.style.paddingTop = nav.offsetHeight + "px";

    burger.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = nav.classList.toggle("tbnav-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    items.addEventListener("click", function (e) { if (e.target.closest("a")) nav.classList.remove("tbnav-open"); });
    document.addEventListener("click", function (e) { if (!nav.contains(e.target)) nav.classList.remove("tbnav-open"); });

    // active state for the current page
    var host = location.hostname;
    var path = location.pathname.replace(/index\.html$/, "");
    if (host === "tonicbox.dev" && (path === "/" || path === "")) brand.classList.add("active");
    var pa = items.querySelector('a[href*="portfolio."]'); if (pa && host.indexOf("portfolio.") === 0) pa.classList.add("active");
    var ba = items.querySelector('a[href*="blog."]'); if (ba && host.indexOf("blog.") === 0) ba.classList.add("active");
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
