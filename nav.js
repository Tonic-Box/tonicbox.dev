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
    ".tbnav-ctf{display:inline-flex;align-items:center;gap:.4rem;}" +
    ".tbnav-caret{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;" +
      "border-top:5px solid currentColor;opacity:.8;display:inline-block;}" +
    ".tbnav a.active{color:#7aa2f7;}" +
    ".tbnav a.active:not(.tbnav-brand){text-decoration:underline;text-underline-offset:5px;}" +
    ".tbnav-drop{position:relative;display:inline-flex;align-items:center;}" +
    ".tbnav-menu{position:absolute;top:100%;right:0;margin-top:9px;min-width:230px;background:#10141f;" +
      "border:1px solid #1c2333;border-radius:8px;padding:.4rem;display:none;flex-direction:column;" +
      "box-shadow:0 14px 34px rgba(0,0,0,.55);}" +
    ".tbnav-menu::before{content:'';position:absolute;left:0;right:0;top:-11px;height:11px;}" +
    ".tbnav-drop:hover .tbnav-menu,.tbnav-drop:focus-within .tbnav-menu{display:flex;}" +
    ".tbnav-menu a{padding:.5rem .7rem;border-radius:5px;color:#c0caf5;font-size:13px;}" +
    ".tbnav-menu a:hover{background:#161c2b;color:#7aa2f7;}" +
    ".tbnav-sub{position:relative;}" +
    ".tbnav-menu a.tbnav-subtrigger{display:flex;align-items:center;}" +
    ".tbnav-subcaret{width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;" +
      "border-right:5px solid currentColor;opacity:.6;margin-left:auto;}" +
    ".tbnav-submenu{position:absolute;right:100%;top:-.4rem;margin-right:.45rem;min-width:150px;background:#10141f;" +
      "border:1px solid #1c2333;border-radius:8px;padding:.4rem;display:none;flex-direction:column;" +
      "box-shadow:0 14px 34px rgba(0,0,0,.55);}" +
    ".tbnav-submenu::before{content:'';position:absolute;right:-.45rem;top:0;bottom:0;width:.45rem;}" +
    ".tbnav-sub:hover>.tbnav-submenu,.tbnav-sub:focus-within>.tbnav-submenu{display:flex;}" +
    ".tbnav-submenu a{padding:.5rem .7rem;border-radius:5px;color:#c0caf5;font-size:13px;white-space:nowrap;}" +
    ".tbnav-submenu a:hover{background:#161c2b;color:#7aa2f7;}" +
    ".tbnav-menu a.tbnav-docs,.tbnav-submenu a.tbnav-docs{color:#7dcfff;}" +
    ".tbnav-menu a.tbnav-docs:hover,.tbnav-submenu a.tbnav-docs:hover{color:#a5e9ff;}" +
    ".tbnav-menu a.tbnav-hall{color:#e0af68;}" +
    ".tbnav-menu a.tbnav-hall:hover{color:#f2c88a;}" +
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
      ".tbnav-sub{position:static;}" +
      ".tbnav-subcaret{display:none;}" +
      ".tbnav-submenu{position:static;display:flex;box-shadow:none;border:none;background:none;padding:0;min-width:0;margin:0;}" +
      ".tbnav-submenu::before{display:none;}" +
      ".tbnav-submenu a{color:#7681b3;padding:.5rem 1.3rem .5rem 3.4rem;}" +
      ".tbnav-submenu .tbnav-submenu a{padding-left:4.4rem;}" +
      ".tbnav-submenu a:hover{background:none;color:#7aa2f7;}" +
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

    var isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    var apex = isLocal ? "" : APEX;
    var portfolioUrl = isLocal ? "/portfolio/" : "https://portfolio.tonicbox.dev";
    var blogUrl = isLocal ? "/blog/" : "https://blog.tonicbox.dev";

    var nav = el("nav", "tbnav", { "aria-label": "site" });

    var brand = link(apex + "/", "", "tbnav-brand");
    var g = el("span", "g"); g.textContent = ">_";
    brand.appendChild(g);
    brand.appendChild(document.createTextNode(" tonicbox"));
    nav.appendChild(brand);

    var burger = el("button", "tbnav-burger", { "aria-label": "menu", "aria-expanded": "false", type: "button" });
    burger.appendChild(el("span")); burger.appendChild(el("span")); burger.appendChild(el("span"));
    nav.appendChild(burger);

    var items = el("div", "tbnav-items");
    var homeItem = link(apex + "/", "Home");
    var portfolioItem = link(portfolioUrl, "Portfolio");
    var blogItem = link(blogUrl, "Blog");
    items.appendChild(homeItem);
    items.appendChild(blogItem);
    items.appendChild(portfolioItem);

    var drop = el("div", "tbnav-drop");
    var ctf = link(apex + "/ctf.html", "CTF Challenge", "tbnav-ctf");
    ctf.appendChild(el("i", "tbnav-caret"));
    var menu = el("div", "tbnav-menu");
    menu.appendChild(link(apex + "/ctf.html", "Getting Started"));

    var docSub = el("div", "tbnav-sub");
    var docLink = el("a", "tbnav-subtrigger tbnav-docs", { tabindex: "0" });
    docLink.textContent = "Documentation";
    docLink.appendChild(el("i", "tbnav-subcaret"));
    var docMenu = el("div", "tbnav-submenu");
    docMenu.appendChild(link(apex + "/arch.html", "Architecture & limits", "tbnav-docs"));

    var tbcSub = el("div", "tbnav-sub");
    var tbcLink = link(apex + "/tbc.html", "TBC Lang Docs", "tbnav-subtrigger tbnav-docs");
    tbcLink.appendChild(el("i", "tbnav-subcaret"));
    var tbcSubmenu = el("div", "tbnav-submenu");
    tbcSubmenu.appendChild(link(apex + "/tbc-std-docs.html", "STD Docs", "tbnav-docs"));
    tbcSubmenu.appendChild(link(apex + "/syscalls.html", "Syscall Reference", "tbnav-docs"));
    tbcSub.appendChild(tbcLink);
    tbcSub.appendChild(tbcSubmenu);
    docMenu.appendChild(tbcSub);
    docMenu.appendChild(link(apex + "/as.html", "The assembler", "tbnav-docs"));
    docMenu.appendChild(link(apex + "/sh.html", "The shell", "tbnav-docs"));
    docMenu.appendChild(link(apex + "/vi.html", "The vi editor", "tbnav-docs"));
    docMenu.appendChild(link(apex + "/tbdbg.html", "The debugger", "tbnav-docs"));
    docSub.appendChild(docLink);
    docSub.appendChild(docMenu);
    menu.appendChild(docSub);

    var hallItem = link(apex + "/hall.html", "Hall of Fame", "tbnav-hall");
    menu.appendChild(hallItem);

    drop.appendChild(ctf);
    drop.appendChild(menu);
    items.appendChild(drop);
    nav.appendChild(items);

    document.body.insertBefore(nav, document.body.firstChild);
    document.body.style.paddingTop = nav.offsetHeight + "px";

    burger.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = nav.classList.toggle("tbnav-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    items.addEventListener("click", function (e) { var a = e.target.closest("a"); if (a && a.getAttribute("href")) nav.classList.remove("tbnav-open"); });
    document.addEventListener("click", function (e) { if (!nav.contains(e.target)) nav.classList.remove("tbnav-open"); });

    var host = location.hostname;
    var path = location.pathname.replace(/index\.html$/, "");
    var subPortfolio = host.indexOf("portfolio.") === 0;
    var subBlog = host.indexOf("blog.") === 0;
    var onPortfolio = subPortfolio || path.indexOf("/portfolio") === 0;
    var onBlog = subBlog || path.indexOf("/blog") === 0;
    var onCtf = /\/(ctf|tbc|sh|vi|tbdbg|as|arch|syscalls|tbc-std-docs|hall)\.html$/.test(location.pathname);
    var onHall = /\/hall\.html$/.test(location.pathname);
    var onHome = !subPortfolio && !subBlog && !onPortfolio && !onBlog && !onCtf && !onHall && (path === "/" || path === "");
    if (onHome) { brand.classList.add("active"); homeItem.classList.add("active"); }
    if (onPortfolio) portfolioItem.classList.add("active");
    if (onBlog) blogItem.classList.add("active");
    if (onCtf) ctf.classList.add("active");
    if (onHall) hallItem.classList.add("active");
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
