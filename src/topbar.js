// src/topbar.js
"use strict";

/**
 * Single source of truth for the Top Bar.
 *
 * Goals:
 * - Same DOM structure + classes on every page (index / guide / pages / sandbox).
 * - Extra controls are optional and context-based:
 *   - data-context="tool"  -> sandbox (filters + about/view/back/clear)
 *   - data-context="pages" -> pages (param dropdown controls)
 *   - data-context="home"  -> index / guide (no extra UI by default)
 * - If a page already has the required nodes in its HTML (e.g. #filters, #btnParam),
 *   we MOVE them into the topbar instead of duplicating them.
 */
export function mountTopbar(options = {}) {
  const {
    mountId = "topbar",
    brandLabel = "keychain atlas",
    brandHref = "./index.html",
    subtitle = "isia u · 2025–2026 · design dell’interfaccia 2",
    topbarFont = "clamp(15px, 1.55vw, 18px)",

    // Sizing tuned to match the sandbox topbar look everywhere.
    topbarHeight = "64px",
    topbarPadX = "18px",
    topbarGap = "18px",

    // Vertical offset from the top (keep it consistent across pages)
    topbarOffset = "0px",

    // Optional right-side nav actions for HOME pages only
    // rightActions: [{ label:"pages", href:"./pages.html" }, { label:"guide", href:"./guide.html" }]
    rightActions = [],

    // Force context if you want. Otherwise it reads from <body data-context="...">
    context = resolveContext(options.context),
  } = options;

  const mount = document.getElementById(mountId);
  if (!mount) return;

  // Ensure the ONLY two fonts used by the site are available on every page.
  // Some pages may forget to import type.css or may load it late; this prevents fallback serif fonts.
  if (!document.getElementById("_cxseagal_faces")) {
    const faces = document.createElement("style");
    faces.id = "_cxseagal_faces";
    faces.textContent = `
      @font-face{
        font-family:"CXSeagal";
        src:url("./fonts/CX-Seagal-Roman.otf") format("opentype");
        font-weight:400;
        font-style:normal;
        font-display:swap;
      }
      @font-face{
        font-family:"CXSeagal";
        src:url("./fonts/CX-Seagal-Semibold.otf") format("opentype");
        font-weight:600;
        font-style:normal;
        font-display:swap;
      }
    `;
    document.head.appendChild(faces);
  }

  // Inject minimal, consistent CSS for the topbar across every page.
  // This prevents "index" from looking different if a page misses a stylesheet.
  if (!document.getElementById("_topbar_css")) {
    const st = document.createElement("style");
    st.id = "_topbar_css";
    st.textContent = `
      :root{
        --topbar-font: ${String(topbarFont || "11px")};
        --topbar-offset: ${String(topbarOffset || "0px")};
        --topbar-h: ${String(topbarHeight || "64px")};
        --topbar-padx: ${String(topbarPadX || "18px")};
        --topbar-gap: ${String(topbarGap || "18px")};
      }

      .topbar{
        position:fixed;
        top:calc(env(safe-area-inset-top, 0px) + var(--topbar-offset, 0px)) !important;
        left:0;
        right:0;
        z-index:9999;
        box-sizing:border-box;

        height:var(--topbar-h, 64px);
        padding:0 var(--topbar-padx, 18px);
        display:flex;
        align-items:center;
        gap:var(--topbar-gap, 18px);

        color:rgba(255,255,255,.86);
        font-family: "CXSeagal", sans-serif;
        font-size: var(--topbar-font, 11px);
        line-height: 1.2;

        background:linear-gradient(to bottom, rgba(0,0,0,.55), rgba(0,0,0,0));
        -webkit-font-smoothing:antialiased;
      }

      /* Force typography to be identical for brand + filters + buttons */
      .topbar, .topbar *{
        font-family: "CXSeagal", sans-serif !important;
        font-size: inherit !important;
        line-height: inherit !important;
        letter-spacing: inherit !important;
      }

      /* Form controls sometimes reset font-size/font-family */
      .topbar button,
      .topbar input,
      .topbar select,
      .topbar textarea{
        font: inherit !important;
        font-family: "CXSeagal", sans-serif !important;
        font-size: inherit !important;
        line-height: inherit !important;
      }

      /* Filters UI may ship its own font-size rules: override inside topbar */
      .topbar .filters,
      .topbar .filters *{
        font: inherit !important;
        font-family: "CXSeagal", sans-serif !important;
        font-size: inherit !important;
        line-height: inherit !important;
        letter-spacing: inherit !important;
      }

      .topbar .miniBrand{
        display:flex;
        align-items:center;
        gap:14px;
        white-space:nowrap;
        letter-spacing:.25px;
        opacity:.96;
        user-select:none;
        min-width:0;
      }

      .topbar .miniBrand b{ font-weight: 600; }
      .topbar .sep{ opacity:.55; }

      .topbar .miniBrand .meta{
        opacity:.72;
        font-weight: 400;
        letter-spacing:.02em;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        max-width:44vw;
      }

      .topbar .brandLink:hover b{
        text-decoration:underline;
        text-underline-offset:3px;
      }

      .topbar .topbarCenter{ flex:1; display:flex; justify-content:center; min-width:0; }
      .topbar .righttools{ display:flex; align-items:center; gap:10px; white-space:nowrap; }

      .topbar .aboutLink{
        appearance:none;
        border:0;
        background:transparent;
        color:inherit;
        opacity:.78;
        font:inherit;
        font-family: "CXSeagal", sans-serif !important;
        letter-spacing:.02em;
        cursor:pointer;
        padding:6px 8px;
        border-radius:999px;
        text-decoration:none;
      }
      .topbar .aboutLink:hover{ opacity:1; background:rgba(255,255,255,.06); }

      .topbar .btn{
        appearance:none;
        border:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.06);
        color:inherit;
        font:inherit;
        font-family: "CXSeagal", sans-serif !important;
        letter-spacing:.02em;
        cursor:pointer;
        padding:7px 10px;
        border-radius:999px;
      }
      .topbar .btn:hover{ background:rgba(255,255,255,.10); }
    `;
    document.head.appendChild(st);
  }

  // Force consistent sizing across pages via CSS variables
  if (topbarFont) document.documentElement.style.setProperty("--topbar-font", String(topbarFont));
  if (topbarOffset != null) document.documentElement.style.setProperty("--topbar-offset", String(topbarOffset));
  if (topbarHeight) document.documentElement.style.setProperty("--topbar-h", String(topbarHeight));
  if (topbarPadX) document.documentElement.style.setProperty("--topbar-padx", String(topbarPadX));
  if (topbarGap) document.documentElement.style.setProperty("--topbar-gap", String(topbarGap));

  // All pages share the same base structure (left brand + center slot + right slot)
  mount.classList.add("topbar");
  mount.setAttribute("role", "navigation");

  mount.innerHTML = `
    <div class="miniBrand" aria-label="keychain atlas">
      <a class="brandLink" href="${escapeAttr(brandHref)}" style="color:inherit;text-decoration:none;"><b id="brandHome">${escapeHtml(brandLabel)}</b></a>
      <span class="sep">·</span>
      <span class="meta">${escapeHtml(subtitle)}</span>
    </div>

    <div class="topbarCenter" id="topbarCenter"></div>

    <div class="righttools" id="topbarRight"></div>
  `;

  const center = mount.querySelector("#topbarCenter");
  const right = mount.querySelector("#topbarRight");

  // Context-specific wiring
  if (context === "tool") {
    mountToolUI(center, right);
    return;
  }

  if (context === "pages") {
    mountPagesUI(center, right);
    return;
  }

  // HOME (index/guide/about/etc): keep same layout, but no extra UI by default
  if (center) center.innerHTML = "";
  if (right) {
    if (Array.isArray(rightActions) && rightActions.length) renderRightActions(right, rightActions);
    else right.innerHTML = "";
  }
}

/** =========================
 *  TOOL (sandbox) UI
 *  Needs ids used by src/app.js
 * ========================= */
function mountToolUI(center, right) {
  // CENTER: filters
  const filters = takeOrCreate("filters", () => {
    const el = document.createElement("div");
    el.id = "filters";
    el.className = "filters toolOnly";
    return el;
  });
  // Ensure correct class
  filters.classList.add("filters", "toolOnly");
  center.appendChild(filters);

  // RIGHT: about · viewMode · Back Clear
  const btnAbout = takeOrCreate("btnAbout", () => makeLinkButton("btnAbout", "about"));
  const btnViewMode = takeOrCreate("btnViewMode", () => makeLinkButton("btnViewMode", "sandbox"));
  // Removed navigation click handlers to preserve sandbox button behavior as per instructions

  btnAbout.classList.add("toolOnly");
  btnViewMode.classList.add("toolOnly");
  const btnBack = takeOrCreate("btnBack", () => makePillButton("btnBack", "Back", true));
  const btnClear = takeOrCreate("btnClear", () => makePillButton("btnClear", "Clear", true));

  btnBack.classList.add("toolOnly");
  btnClear.classList.add("toolOnly");

  // Layout separators exactly like sandbox
  right.innerHTML = "";
  right.appendChild(btnAbout);
  right.appendChild(dotSep());
  right.appendChild(btnViewMode);
  right.appendChild(dotSep());
  right.appendChild(btnBack);
  right.appendChild(btnClear);
}

/** =========================
 *  PAGES UI
 *  Needs ids used by src/pages.js
 * ========================= */
function mountPagesUI(center, right) {
  // No filters in pages (keep center empty unless you want later)
  if (center) center.innerHTML = "";

  // RIGHT: Param dropdown button (and optional schema buttons if present)
  // We MOVE existing nodes if they already exist in pages.html.
  const btnParam = takeOrCreate("btnParam", () => makeLinkButton("btnParam", "Parametro"));
  btnParam.classList.add("pagesOnly");

  // Optional: if present, keep them; otherwise don't create to avoid clutter.
  const btnSchemaMode = takeOrNull("btnSchemaMode");
  const btnSchemaFlip = takeOrNull("btnSchemaFlip");

  right.innerHTML = "";
  right.appendChild(btnParam);

  if (btnSchemaMode) {
    btnSchemaMode.classList.add("pagesOnly");
    right.appendChild(dotSep());
    right.appendChild(btnSchemaMode);
  }
  if (btnSchemaFlip) {
    btnSchemaFlip.classList.add("pagesOnly");
    right.appendChild(dotSep());
    right.appendChild(btnSchemaFlip);
  }
}

/** =========================
 *  HOME right actions
 * ========================= */
function renderRightActions(right, actions) {
  right.innerHTML = "";
  actions.forEach((a, idx) => {
    if (idx > 0) right.appendChild(dotSep());

    const label = String(a?.label ?? "").trim();
    if (!label) return;

    if (a?.href) {
      const link = document.createElement("a");
      link.className = "aboutLink";
      link.href = a.href;
      link.textContent = label;
      link.style.color = "inherit";
      link.style.textDecoration = "none";
      link.setAttribute("role", "button");
      right.appendChild(link);
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "aboutLink";
    btn.textContent = label;
    if (typeof a?.onClick === "function") {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        a.onClick(e);
      });
    }
    right.appendChild(btn);
  });
}

/** =========================
 *  DOM utilities
 * ========================= */
function takeOrCreate(id, createFn) {
  const existing = document.getElementById(id);
  if (existing) return existing;
  return createFn();
}

function takeOrNull(id) {
  const existing = document.getElementById(id);
  return existing || null;
}

function dotSep() {
  const s = document.createElement("span");
  s.className = "sep";
  s.textContent = "·";
  return s;
}

function makeLinkButton(id, text) {
  const b = document.createElement("button");
  b.id = id;
  b.type = "button";
  b.className = "aboutLink";
  b.textContent = text;
  return b;
}

function makePillButton(id, text, isBtn = true) {
  const b = document.createElement(isBtn ? "button" : "a");
  b.id = id;
  b.className = "btn";
  if (isBtn) b.type = "button";
  b.textContent = text;
  return b;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("`", "&#096;");
}

function resolveContext(forced) {
  // 1) explicit option wins
  if (forced) return String(forced);

  // 2) strong filename-based routing first (prevents accidental tool layout on index)
  const p = (location && location.pathname ? location.pathname : "").toLowerCase();
  if (p.endsWith("/sandbox.html") || p.endsWith("sandbox.html")) return "tool";
  if (p.endsWith("/pages.html") || p.endsWith("pages.html")) return "pages";
  if (p.endsWith("/index.html") || p.endsWith("index.html") || p.endsWith("/guide.html") || p.endsWith("guide.html") || p.endsWith("/about.html") || p.endsWith("about.html")) {
    return "home";
  }

  // 3) body data-context (only if present and valid)
  const bodyCtx = document.body && document.body.dataset && document.body.dataset.context;
  if (bodyCtx) {
    const v = String(bodyCtx);
    if (v === "tool" || v === "pages" || v === "home") return v;
  }

  // default
  return "home";
}

// Auto-mount when included directly in an HTML page.
// IMPORTANT: include this script BEFORE page scripts that query the topbar nodes (app.js / pages.js).
(function autoMountTopbar(){
  try {
    const run = () => {
      // Support both ids used across pages
      const el = document.getElementById("topbar") || document.getElementById("topbarMount");
      if (!el) return;
      mountTopbar({ mountId: el.id });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  } catch (e) {
    // no-op: avoid breaking the page if something is off
  }
})();