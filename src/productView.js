"use strict";

function sanitize(v){
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "nan") return "";
  return s;
}
function getVal(row, lvl){
  let v = sanitize(row?.[lvl.key]);
  if (!v && lvl.aliases){
    for (const a of lvl.aliases){
      const vv = sanitize(row?.[a]);
      if (vv){ v = vv; break; }
    }
  }
  return v;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}
function imageUrlFromRow(row){
  const raw = row?.file ?? row?.File ?? row?.FILE ?? "";
  const file = String(raw).trim();
  if (!file) return null;
  return new URL(`./images/${file}`, window.location.href).toString();
}

function personKeyFromRow(row){
  // Try a few common columns; first non-empty wins.
  const tries = [
    "ID","Id","id",
    "Persona","persona",
    "Nome","nome",
    "Owner","owner",
    "Person","person"
  ];
  for (const k of tries){
    const v = sanitize(row?.[k]);
    if (v) return v;
  }
  return "";
}

export class ProductView {
  constructor(levels){
    this.levels = levels || [];
    this.rows = [];
    this.filtered = [];
    this.selection = [];

    this.root = document.getElementById("productOverlay");
    this.btnClose = document.getElementById("pClose");
    this.imgEl = document.getElementById("pImg");
    this.metaEl = document.getElementById("pMeta");
    this.titleEl = document.getElementById("pTitle");
    this.statsEl = document.getElementById("pStats");

    this.panelEl = this.root.querySelector(".pPanel");
    this.mediaFrameEl = this.root.querySelector(".pMediaFrame");

    // --- Related keychains strip (under specs, horizontal scroll) ---
    this.infoEl = this.root.querySelector(".pInfo");
    this.statsWrapEl = this.root.querySelector(".pStatsWrap");
    this.stripEl = null;

    // Inject a tiny CSS patch once (keeps everything in this file)
    if (!document.getElementById("pv-strip-style")){
      const st = document.createElement("style");
      st.id = "pv-strip-style";
      st.textContent = `
        .pStrip{ flex:0 0 auto; display:flex; gap:10px; overflow-x:auto; overflow-y:hidden; padding:10px 2px 2px 2px; scroll-snap-type:x proximity; }
        .pStrip::-webkit-scrollbar{ height:0px; }
        .pThumb{ flex:0 0 auto; width:64px; height:64px; border-radius:14px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.04); overflow:hidden; cursor:pointer; scroll-snap-align:start; }
        .pThumb:hover{ background:rgba(255,255,255,.07); border-color:rgba(255,255,255,.14); }
        .pThumb.active{ border-color:rgba(255,255,255,.32); box-shadow:0 0 0 1px rgba(255,255,255,.10) inset; }
        .pThumb img{ width:100%; height:100%; object-fit:cover; object-position:center; display:block; }
      `;
      document.head.appendChild(st);
    }

    // Mount strip under the specs (inside the right column)
    if (this.infoEl && this.statsWrapEl){
      const strip = document.createElement("div");
      strip.className = "pStrip";
      strip.setAttribute("aria-label", "Altri keychain della stessa persona");

      // place it right after the specs box
      this.statsWrapEl.insertAdjacentElement("afterend", strip);
      this.stripEl = strip;
    }

    // --- UI polish: rounded media + clean close button ---
    if (this.mediaFrameEl){
      // Ensure the image is clipped/rounded inside the frame
      this.mediaFrameEl.style.overflow = "hidden";
      // Keep in sync with your CSS radius (16px in sandbox.html)
      this.mediaFrameEl.style.borderRadius = this.mediaFrameEl.style.borderRadius || "16px";

      // ✅ Remove the extra visible box/frame around the enlarged image
      // (we keep only the image, no additional bordered container)
      this.mediaFrameEl.style.border = "0";
      this.mediaFrameEl.style.background = "transparent";
      this.mediaFrameEl.style.boxShadow = "none";
      this.mediaFrameEl.style.padding = "0px";
    }
    if (this.imgEl){
      // round the actual image too (so it looks rounded even with padding)
      this.imgEl.style.borderRadius = "14px";
      // stronger clipping across browsers
      this.imgEl.style.clipPath = "inset(0 round 14px)";
      this.imgEl.style.webkitClipPath = "inset(0 round 14px)";
    }
    if (this.btnClose){
      // ✅ fix “second shape” on the X:
      // In your CSS, `.pClose::before` draws an extra inset border. We can't target pseudo-elements
      // with inline styles, so we remove the `pClose` class and restyle the button cleanly here.
      // (keeps the same look, without the extra outline layer)
      this.btnClose.classList.remove("pClose");

      // hard reset browser button UI
      this.btnClose.style.webkitAppearance = "none";
      this.btnClose.style.appearance = "none";
      this.btnClose.style.outline = "none";
      this.btnClose.style.boxShadow = "none";
      this.btnClose.style.webkitTapHighlightColor = "transparent";
      this.btnClose.style.border = "1px solid rgba(255,255,255,.12)";
      this.btnClose.style.background = "rgba(30,30,30,.28)";
      this.btnClose.style.backdropFilter = "blur(10px)";

      // layout / geometry (same as your CSS `.pClose`, but without `::before`)
      this.btnClose.style.position = "absolute";
      this.btnClose.style.top = "28px";
      this.btnClose.style.right = "28px";
      this.btnClose.style.width = "40px";
      this.btnClose.style.height = "40px";
      this.btnClose.style.borderRadius = "14px";
      this.btnClose.style.boxSizing = "border-box";
      this.btnClose.style.padding = "0";
      this.btnClose.style.display = "grid";
      this.btnClose.style.placeItems = "center";
      this.btnClose.style.cursor = "pointer";
      this.btnClose.style.lineHeight = "0";

      const svg = this.btnClose.querySelector("svg");
      if (svg){
        svg.style.width = "16px";
        svg.style.height = "16px";
        svg.style.display = "block";
      }

      // hover feedback (replica `.pClose:hover`)
      const bgIdle = "rgba(30,30,30,.28)";
      const bgHover = "rgba(255,255,255,.08)";
      this.btnClose.addEventListener("pointerenter", ()=> { this.btnClose.style.background = bgHover; });
      this.btnClose.addEventListener("pointerleave", ()=> { this.btnClose.style.background = bgIdle; });

      // avoid the button staying focused after click (some browsers show a ring)
      this.btnClose.addEventListener("pointerdown", (e)=> e.preventDefault());
    }

    this._heroEl = null;

    this.isOpen = false;
    this.onOpen = null;
    this.onClose = null;
    this.onPickSpec = null; // ({ li, value }) => void

    // close handlers
    this.root.addEventListener("click", (e)=>{
      const t = e.target;
      if (t?.dataset?.close === "1") this.close();
    });
    this.btnClose.addEventListener("click", ()=> this.close());
    window.addEventListener("keydown", (e)=>{
      if (e.key === "Escape" && this.isOpen) this.close();
    });

    // click su una spec -> callback verso app.js
    this.statsEl.addEventListener("click", (e)=>{
      const rowEl = e.target.closest(".pRow");
      if (!rowEl) return;

      const li = Number(rowEl.dataset.li);
      const value = rowEl.dataset.value;
      if (!Number.isFinite(li) || !value) return;

      if (typeof this.onPickSpec === "function") {
        this.onPickSpec({ li, value });
      }
    });
  }

  setDataRows(rows){ this.rows = rows || []; }

  setContext({ filtered, selection }){
    this.filtered = filtered || [];
    this.selection = selection || [];
  }

  _renderStripForRow(row){
    if (!this.stripEl) return;

    const key = personKeyFromRow(row);
    if (!key){
      this.stripEl.style.display = "none";
      this.stripEl.innerHTML = "";
      return;
    }

    const same = (this.rows || []).filter(r => personKeyFromRow(r) === key);
    if (same.length <= 1){
      this.stripEl.style.display = "none";
      this.stripEl.innerHTML = "";
      return;
    }

    this.stripEl.style.display = "flex";
    this.stripEl.innerHTML = "";

    const currentFile = sanitize(row?.file);

    same.forEach((r)=>{
      const url = imageUrlFromRow(r);
      const thumb = document.createElement("div");
      thumb.className = "pThumb" + (sanitize(r?.file) === currentFile ? " active" : "");

      if (url){
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "eager";
        img.src = url;
        thumb.appendChild(img);
      }

      thumb.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();

        // Use the thumb rect as the origin for the hero animation
        const rr = thumb.getBoundingClientRect();
        const originRect = {
          x: rr.left,
          y: rr.top,
          w: rr.width,
          h: rr.height,
          r: 14
        };

        this.open(r, originRect);
      });

      this.stripEl.appendChild(thumb);
    });

    // Keep active item in view
    const active = this.stripEl.querySelector(".pThumb.active");
    active?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  open(row, originRect){
    if (!row) return;

    const url = imageUrlFromRow(row);
    if (url) this.imgEl.src = url;
    else this.imgEl.removeAttribute("src");

    const title = row?.ID || row?.Id || row?.id || row?.file || "Product";
    this.titleEl.textContent = String(title).replace(/\.[^/.]+$/, "");

    // meta
    const file = sanitize(row?.file);
    const activeFilters = this.selection
      .map((v,i)=> v ? `${this.levels[i]?.label ?? this.levels[i]?.key}: ${v}` : null)
      .filter(Boolean)
      .join(" → ");

    this.metaEl.innerHTML =
      `${file ? `<div><span style="opacity:.65">file</span>: ${escapeHtml(file)}</div>` : ""}` +
      `<div><span style="opacity:.65">filtri</span>: ${escapeHtml(activeFilters || "nessuno")}</div>` +
      `<div><span style="opacity:.65">righe correnti</span>: ${this.filtered?.length || this.rows.length}</div>`;

    // related keychains strip
    this._renderStripForRow(row);

    // stats
    this.statsEl.innerHTML = "";
    for (let li = 0; li < this.levels.length; li++){
      const lvl = this.levels[li];
      const v = getVal(row, lvl);
      if (!v) continue;

      const el = document.createElement("div");
      el.className = "pRow";
      el.dataset.li = String(li);
      el.dataset.value = v;
      el.innerHTML = `
        <div class="pDot"></div>
        <div class="pKV">
          <div class="k">${escapeHtml(lvl.label ?? lvl.key)}</div>
          <div class="v">${escapeHtml(v)}</div>
        </div>
      `;
      this.statsEl.appendChild(el);
    }
    // se ho originRect, preparo subito lo stato “pre-hero” (evita flash statico)
if (originRect && this.panelEl && this.imgEl) {
  this.panelEl.style.transition = "";
  this.panelEl.style.opacity = "0";
  this.panelEl.style.transform = "translateY(10px) scale(.985)";
  this.imgEl.style.opacity = "0";
}
    // ✅ prepara subito lo stato (così niente blink/lag)
if (originRect) {
  this.panelEl.style.opacity = "0";
  this.panelEl.style.transform = "translateY(10px) scale(.985)";
  this.imgEl.style.opacity = "0";
}

// apri overlay
this.root.classList.add("open");
this.root.setAttribute("aria-hidden","false");
this.isOpen = true;
if (typeof this.onOpen === "function") this.onOpen();

// ✅ invece di 2 requestAnimationFrame: flush layout e parti subito
if (originRect) {
  this.mediaFrameEl.getBoundingClientRect(); // forza layout corretto
  this._animateOpen(originRect);
} else {
  // fallback: se non ho originRect, apro senza hero
  this.panelEl.style.opacity = "";
  this.panelEl.style.transform = "";
  this.imgEl.style.opacity = "";
}
  }

  _animateOpen(originRect){
 if (!this.panelEl || !this.mediaFrameEl) return;

// debug rapido: se non arriva originRect lo vedi in console
if (!originRect) {
  console.warn("[HERO] originRect mancante -> apro senza hero");
  // ripristino comunque la visibilità del panel
  this.panelEl.style.opacity = "1";
  this.panelEl.style.transform = "translateY(0px) scale(1)";
  this.imgEl.style.opacity = "1";
  return;
}

  // cleanup
  if (this._heroEl){
    this._heroEl.remove();
    this._heroEl = null;
  }

 // TARGET = area interna del frame (content box), così matcha esattamente l'immagine finale
const fr = this.mediaFrameEl.getBoundingClientRect();
const cs = getComputedStyle(this.mediaFrameEl);

const padL = parseFloat(cs.paddingLeft) || 0;
const padR = parseFloat(cs.paddingRight) || 0;
const padT = parseFloat(cs.paddingTop) || 0;
const padB = parseFloat(cs.paddingBottom) || 0;

const target = {
  left: fr.left + padL,
  top: fr.top + padT,
  width: fr.width - padL - padR,
  height: fr.height - padT - padB
};

if (!target.width || !target.height) return;
  if (!target.width || !target.height) {
  console.warn("[HERO] target rect 0x0 -> ritento al prossimo frame");
  requestAnimationFrame(() => this._animateOpen(originRect));
  return;
}
  if (!target.width || !target.height) return;

  // nascondo panel e img durante la hero
  this.panelEl.style.opacity = "0";
  this.panelEl.style.transform = "translateY(10px) scale(.985)";
  this.imgEl.style.opacity = "0";

// hero layer (posizionato sul target, poi trasformato dall'origin)
const hero = document.createElement("div");
hero.className = "pHero";
hero.style.left = `${target.left}px`;
hero.style.top = `${target.top}px`;
hero.style.width = `${target.width}px`;
hero.style.height = `${target.height}px`;
// clip hero so corners are truly rounded during the FLIP animation
hero.style.overflow = "hidden";

const himg = document.createElement("img");
himg.src = this.imgEl.src || "";
himg.alt = "";
// inherit rounding during animation
himg.style.borderRadius = "inherit";
himg.style.width = "100%";
himg.style.height = "100%";
himg.style.objectFit = "contain";
himg.style.objectPosition = "center";
hero.appendChild(himg);

// FLIP: origin -> target via transform
const dx = originRect.x - target.left;
const dy = originRect.y - target.top;
const sx = originRect.w / target.width;
const sy = originRect.h / target.height;

// 🔒 IMPORTANT: set “from state” BEFORE append (evita 1-frame flash)
hero.style.transformOrigin = "top left";
hero.style.transform = `translate(${dx}px,${dy}px) scale(${sx},${sy})`;
hero.style.borderRadius = `${originRect.r || 14}px`;
hero.style.opacity = "1";
hero.style.transition = "none";

document.body.appendChild(hero);
this._heroEl = hero;

// forza reflow (assicura che il browser “prenda” il from state)
hero.getBoundingClientRect();

// ora abilita transition e vai al target
const ease = "cubic-bezier(.2,.9,.2,1)";
const dur = 520;

hero.style.transition = `transform ${dur}ms ${ease}, border-radius ${dur}ms ${ease}`;
hero.style.transform = "translate(0px,0px) scale(1,1)";
hero.style.borderRadius = "16px";

  // panel fade in
  this.panelEl.style.transition = `opacity 360ms ${ease} 140ms, transform 360ms ${ease} 140ms`;
  this.panelEl.getBoundingClientRect();
  this.panelEl.style.opacity = "1";
  this.panelEl.style.transform = "translateY(0px) scale(1)";

  // riaccendo immagine quasi alla fine
  // ✅ mostra l’immagine un pelo prima (meno “lag”)
const showAt = Math.max(0, dur * 0.72);
window.setTimeout(() => { this.imgEl.style.opacity = "1"; }, showAt);

// ✅ cleanup sincronizzato: quando FINISCE la trasformazione della hero
hero.addEventListener("transitionend", (e) => {
  if (e.propertyName !== "transform") return;

  // 1) assicurati che l'immagine sia visibile
  this.imgEl.style.opacity = "1";

  // 2) rimuovi hero nello stesso frame (niente blink)
  requestAnimationFrame(() => {
    if (this._heroEl){
      this._heroEl.remove();
      this._heroEl = null;
    }

    // reset styles
    this.panelEl.style.opacity = "";
    this.panelEl.style.transform = "";
    this.panelEl.style.transition = "";
    this.imgEl.style.opacity = "";
    hero.style.transition = "";
  });
}, { once: true });
}

  close(){
    if (this._heroEl){
      this._heroEl.remove();
      this._heroEl = null;
    }

    this.root.classList.remove("open");
    this.root.setAttribute("aria-hidden","true");
    this.isOpen = false;

    if (typeof this.onClose === "function") this.onClose();
  }
}