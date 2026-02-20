// src/gallery.js
"use strict";

/**
 * Gallery
 * Canvas renderer + camera (pan/zoom inertia), float/grid/weight layouts, and optional specs panel in grid mode.
 */

function imageUrlFromRow(row) {
  const raw = row?.file ?? row?.File ?? row?.FILE ?? "";
  const file = String(raw).trim();
  if (!file) return null;
  return new URL(`./images/${file}`, window.location.href).toString();
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function kFromEase(ease, dt) { return 1 - Math.pow(1 - ease, dt / 16.666); }
function easeInOutCubic(t){
  t = clamp(t, 0, 1);
  return (t < 0.5) ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
}

function smoothstep(edge0, edge1, x){
  const t = clamp((x - edge0) / Math.max(1e-6, (edge1 - edge0)), 0, 1);
  return t * t * (3 - 2 * t);
}

// Critically-damped smoothing (stile "premium inertia")
// dt in ms, smoothTime in seconds
function smoothDamp(current, target, vel, smoothTime, dt){
  smoothTime = Math.max(0.0001, smoothTime);
  const dtS = dt / 1000;

  // Unity-like stable approximation
  const omega = 2 / smoothTime;
  const x = omega * dtS;
  const exp = 1 / (1 + x + 0.48*x*x + 0.235*x*x*x);

  let change = current - target;
  const temp = (vel + omega * change) * dtS;
  vel = (vel - omega * temp) * exp;

  const value = target + (change + temp) * exp;
  return { value, vel };
}

const DEFAULT_SPECS = [
  { key:"Tipologia", label:"Tipologia" },
  { key:"Materiale principale", label:"Materiale", aliases:["Materiale"] },
  { key:"Colore principale", label:"Colore" },
  { key:"Condizioni", label:"Condizioni", aliases:["Condizoni"] },
  { key:"Tipo di anello", label:"Tipo di anello" },
  { key:"Chiavi", label:"Chiavi" },
];

function sanitize(v){
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "nan") return "";
  return s;
}
function getVal(row, spec){
  let v = row?.[spec.key];
  v = sanitize(v);
  if (!v && spec.aliases){
    for (const a of spec.aliases){
      const vv = sanitize(row?.[a]);
      if (vv){ v = vv; break; }
    }
  }
  return v;
}

export class Gallery {
  _layoutWeight() {
    const visibles = this.items.filter((it) => it.targetAlpha > 0.5);
    if (!visibles.length) return;

    let pMin = Infinity;
    let pMax = -Infinity;
    const pMap = new Map();

    for (const it of visibles) {
      const p = this._getPeso(it.row);
      pMap.set(it, p);
      if (!Number.isFinite(p)) continue;
      if (p < pMin) pMin = p;
      if (p > pMax) pMax = p;
    }

    if (pMin === Infinity) {
      pMin = NaN;
      pMax = NaN;
    }

    const dir = this.weightSortDir || 1;
    visibles.sort((a, b) => {
      const pa = pMap.get(a);
      const pb = pMap.get(b);

      const aOk = Number.isFinite(pa);
      const bOk = Number.isFinite(pb);

      if (aOk && bOk) {
        const d = (pa - pb) * dir;
        if (Math.abs(d) > 1e-9) return d;
        return String(a.url).localeCompare(String(b.url));
      }
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return String(a.url).localeCompare(String(b.url));
    });

    for (const it of visibles) {
      const p = pMap.get(it);
      it.w = this._mapPesoToW(p, pMin, pMax);
      it._sized = false;
    }

    if (typeof this._refreshSizesFromImages === "function") {
      this._refreshSizesFromImages(visibles);
    }

    const gap = this.weightGap || 30;
    const worldW = (this.W / Math.max(0.001, this.tScale)) * 0.9;
    const left0 = -worldW / 2;

    let x = left0;
    let y = 0;
    let rowH = 0;

    for (const it of visibles) {
      const w = it.w;
      const h = it.h;

      if (x !== left0 && x + w > left0 + worldW) {
        x = left0;
        y += rowH + gap;
        rowH = 0;
      }

      it.tx = x + w / 2;
      it.ty = y + h / 2;

      x += w + gap;
      rowH = Math.max(rowH, h);
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const it of visibles) {
      minX = Math.min(minX, it.tx - it.w / 2);
      maxX = Math.max(maxX, it.tx + it.w / 2);
      minY = Math.min(minY, it.ty - it.h / 2);
      maxY = Math.max(maxY, it.ty + it.h / 2);
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;

    for (const it of visibles) {
      it.tx -= cx;
      it.ty -= cy;
    }
  }
  _restoreBaseSizes() {
    for (const it of this.items) {
      if (Number.isFinite(it.baseW)) it.w = it.baseW;
      it._sized = false;
    }
  }

  _getPeso(row) {
    const raw = row?.peso ?? row?.Peso ?? row?.PESO ?? row?.weight ?? row?.Weight ?? "";
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return NaN;

    const num = Number(s.replace(",", ".").replace(/[^0-9.+-]/g, ""));
    if (!Number.isFinite(num)) return NaN;

    return s.includes("kg") ? num * 1000 : num;
  }

  _mapPesoToW(p, pMin, pMax) {
    const mid = (this.weightWMin + this.weightWMax) * 0.5;
    if (!Number.isFinite(p)) return mid;
    if (!Number.isFinite(pMin) || !Number.isFinite(pMax) || pMax <= pMin) return mid;

    const t = clamp((p - pMin) / (pMax - pMin), 0, 1);
    const tt = t * t * (3 - 2 * t);
    return this.weightWMin + (this.weightWMax - this.weightWMin) * tt;
  }
  constructor(canvas) {
    this.canvas = canvas;

    this.W = 0;
    this.H = 0;

    // ===== WEIGHT VIEW =====
    this.weightKey = "peso";
    this.weightWMin = 120;
    this.weightWMax = 320;
    this.weightGap = 34;
    this.weightSortDir = 1; // 1=crescente, -1=decrescente

    this.interactionsEnabled = true;

    this.rows = [];
    this.items = [];
    this.imgCache = new Map();

    this.mode = "float";      // "float" | "grid"
    
    this.filteredSet = null;

    // ===== SPECS (nuovo) =====
    this.specLevels = DEFAULT_SPECS.slice(); // puoi override con setSpecLevels(levels)
    this.showSpecsInGrid = true;            // mostra pannello specs appena parte un filtro (grid)
    this.specPadX = 16;     // padding sinistro testo
    this.specPadY = 14;     // padding alto/basso pannello specs
    this.specLineGap = 8;   // spazio tra righe
    this.specBulletR = 2.2; // raggio bullet (base, scala con zoom)
    this.specPanelAlpha = 0.98;
    this.specPanelFill = "rgba(38,38,38,0.72)";
    this.specTextA = 0.92;

    // ===== UI REVEAL (quando compaiono topbar + specs) =====
    // Abbassiamo leggermente le soglie così i dettagli compaiono prima durante lo zoom.
    this.uiRevealIn  = 0.50;
    this.uiRevealOut = 0.76;

    
    // ========= CAMERA =========
    this.viewX = 0;
    this.viewY = 0;
    this.scale = 1.0;

    this.tViewX = 0;
    this.tViewY = 0;
    this.tScale = 1.0;
    // ===== CAMERA premium (vel state) =====
this._camVX = 0;
this._camVY = 0;
this._camVS = 0;

// tempi di risposta (seconds) — tuning "sub-like"
this.camSmoothPan  = 0.18;
this.camSmoothZoom = 0.24;
this.camSmoothDrag = 0.10; // quando trascini: più “attaccato” ma sempre morbido

    this.minScale = 0.35;
    this.maxScale = 2.2;

    this.camEase = 0.12;

    // ===== SAFE AREA (UI padding) =====
    this.safeTop = 110;
    this.safeBottom = 110;
    this.safeSide = 80;

    // ========= PARALLAX =========
    this.mouseX = 0;
    this.mouseY = 0;
    this.parX = 0;
    this.parY = 0;
    this.parEase = 0.10;
    this.parStrength = 58;

    this.motX = 0;
    this.motY = 0;
    this.motZ = 0;
    this.zoomPX = 0;
    this.zoomPY = 0;

    this.motEase = 0.18;
    this.motDamp = 0.82;

    this._pViewX = 0;
    this._pViewY = 0;
    this._pScale = 1.0;

    // ========= MOMENTUM WHEEL =========
    this.zoomVel = 0;
    this.zoomFriction = 0.90;
    this.zoomStrength = 0.00075;
    this.zoomStopEps = 0.00008;
    this._zoomAnchorX = null;
    this._zoomAnchorY = null;

    // ========= FLOAT =========
    this.floatAmp = 1.4;
    this.floatSpeed = 0.0007;

    // ========= CARD LOOK =========
    this.borderR = 14;
    this.topBarH = 30;


    this.baseWMin = 120;
    this.baseWMax = 220;

    // ===== GRID STANDARD SIZE =====
    // In float mode cards keep their random sizes; in grid mode they become uniform.
    this.gridCardW = 180; // standard width in grid (tune if needed)

    this.moveK = 0.014;
    this.fadeK = 0.030;
    // ===== AE-like tween (solo per transizioni layout/grid) =====
this.tweenDur = 820;     // ms
this._tweening = false;
this._tweenT0 = 0;

    // pan momentum (premium)
    this.dragging = false;
    this._moved = false;
    this.dragStart = { x: 0, y: 0, vx: 0, vy: 0 };
    // ===== CARD DRAG (nuovo) =====
this.draggingCard = null;      // item attivo
this._cardMoved = false;
this._cardStart = { x:0, y:0, offX:0, offY:0 };
this.cardDragThreshold = 4;    // px: soglia click vs drag

    this.panVelX = 0;         // px/ms
    this.panVelY = 0;         // px/ms
    this.panFriction = 0.86;  // 0.82..0.92
    this.panStopEps = 0.02;   // px/ms
    this._panLastX = 0;
    this._panLastY = 0;
    this._panLastT = performance.now();

    this.onRequestPick = null;
    // hover / cursor affordance
this.hovered = null;     // item attualmente sotto il mouse
this.hoverEase = 0.18;   // velocità transizione hover

    // ========= BG DOTS =========
    this._dotFine = null;
    this._dotCoarse = null;
    this._patCtxId = null;

    // ========= DYNAMIC RENDER =========
    this._frameCanvas = null;
    this._frameCtx = null;

    // ========= PERF / CACHES =========
    this._perfMode = false;

    // throttle size refresh (avoid doing it every frame)
    this._needsSizeRefresh = false;
    this._lastSizeRefresh = 0;

    // text measure cache (specs)
    this._measureCanvas = document.createElement("canvas");
    this._measureCtx = this._measureCanvas.getContext("2d");

    // ===== INPUT / UI THROTTLES (reduce lag on many items) =====
    this._lastInputT = performance.now();      // last user interaction timestamp

    // Quanto tempo attendere dopo un input prima di mostrare UI “pesante” (testi/specs).
    // Più basso = dettagli compaiono prima.
    this._uiIdleDelay = 90;                    // ms

    // smooth UI reveal (prevents flicker)
    this._uiAlpha = 1;          // 0..1, eased instead of hard on/off
    this._uiAlphaEase = 0.26;   // responsiveness (più reattivo)

    // Durante interazioni (zoom/pan) non vogliamo azzerare del tutto la UI:
    // manteniamo una base visibile per evitare “sparizioni” e far comparire prima i dettagli.
    this._uiActiveFloor = 0.60; // 0..1

    this._lastHoverPickT = 0;
    this._hoverPickInterval = 48;              // ms: throttle hover picking

    // time
    this._t = performance.now();
    

    // ========= FIT ROBUST =========
    this._fitFrames = 0;
    this._fitTarget = null;
    this._fitEase = 0.45;
    this._fitDone = false;

    this._bindInput();
  }

  // --------- API extras ---------
  setSpecLevels(levels){
    // accetta array tipo LEVELS del tuo app.js
    if (Array.isArray(levels) && levels.length){
      this.specLevels = levels.map(l => ({
        key: l.key,
        label: l.label ?? l.key,
        aliases: l.aliases || null
      }));
      // forza resize cards (info panel cambia height)
      for (const it of this.items) it._sized = false;
      this._requestFit(12);
      if (this.mode === "grid" || this.mode === "weight") this.layout();
    }
  }

  // ---------- API ----------
  setViewport(W, H) {
    this.W = W;
    this.H = H;
    if (this.items.length) this._requestFit(12);
  }

  getScale() { return this.scale; }      // scala effettiva a schermo
getTargetScale() { return this.tScale; } // (opzionale) target
  resetView() { this._requestFit(12); }

  setScale(newScale, anchorSX = null, anchorSY = null) {
    const old = this.tScale;
    const s = clamp(newScale, this.minScale, this.maxScale);
    if (Math.abs(s - old) < 1e-6) return;

    const cx = this.W * 0.5;
    const cy = this.H * 0.5;

    const ax = (anchorSX == null) ? cx : anchorSX;
    const ay = (anchorSY == null) ? cy : anchorSY;

    const wx = (ax - (cx + this.tViewX)) / old;
    const wy = (ay - (cy + this.tViewY)) / old;

    this.tScale = s;
    this.tViewX = ax - cx - wx * s;
    this.tViewY = ay - cy - wy * s;
  }

  setRows(rows) {
    this.rows = rows || [];
    this.items = [];
    // sizes will need refresh as images decode
    this._needsSizeRefresh = true;

    const seen = new Set();
    for (const r of this.rows) {
      const url = imageUrlFromRow(r);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      if (!this.imgCache.has(url)) {
        const img = new Image();
        const rec = { img, ok: false, err: false, loadedPromise: null, bmp: null };

        const self = this;
        rec.loadedPromise = new Promise((resolve) => {
          img.onload = async () => {
            rec.ok = true;
            try { if (img.decode) await img.decode(); } catch {}
            try { if (window.createImageBitmap) rec.bmp = await createImageBitmap(img); }
            catch { rec.bmp = null; }

            // mark sizing dirty (throttled in draw)
            self._needsSizeRefresh = true;
            resolve(true);
          };
          img.onerror = () => {
            rec.err = true;
            self._needsSizeRefresh = true;
            resolve(false);
          };
        });

        img.src = url;
        this.imgCache.set(url, rec);
      }

      // spread float (world space)
      const ax = (Math.random() - 0.5) * 3200;
      const ay = (Math.random() - 0.5) * 2300;

      const w = this.baseWMin + Math.random() * (this.baseWMax - this.baseWMin);

      // height provvisoria (poi la correggo con aspect reale)
      const aspectGuess = 4 / 3;
      const imgH = w / aspectGuess;

      // specs panel (provvisorio; poi calcolato stabile)
      const infoH = this._infoPanelHForRow(r, 1.0);

      // In float NON mostro specs, quindi l'altezza iniziale è solo topbar + immagine
const h = this.topBarH + imgH;

      this.items.push({
  row: r, url,
  ax, ay,
  offX: 0, offY: 0,
  x: ax, y: ay,
  tx: ax, ty: ay,
  alpha: 1,
  targetAlpha: 1,

  w, h,
  baseW: w,          // ✅ NEW: memorizza la dimensione “sandbox”

  imgH,
  infoH,
  _sized: false,
  hover: 0,
  ph1: Math.random() * Math.PI * 2,
  ph2: Math.random() * Math.PI * 2
});
    }

    this.mode = "float";
    this.filteredSet = null;

    this.viewX = this.tViewX = 0;
    this.viewY = this.tViewY = 0;
    this.scale = this.tScale = 1.0;
    // reset camera velocities (critically damped)
this._camVX = 0;
this._camVY = 0;
this._camVS = 0;

    this.parX = this.parY = 0;
    this.motX = this.motY = this.motZ = 0;
    this.zoomPX = this.zoomPY = 0;
    this.zoomVel = 0;
    this._zoomAnchorX = this._zoomAnchorY = null;

    this._pViewX = this.viewX;
    this._pViewY = this.viewY;
    this._pScale = this.scale;

    this.panVelX = 0;
    this.panVelY = 0;

    this._requestFit(12);
  }

  async preloadAll(onProgress) {
  const recs = [...this.imgCache.values()];

  // Se non ci sono immagini in cache (o promises mancanti), non restare a 0%
  const list = recs.map(r => r.loadedPromise).filter(Boolean);

  if (list.length === 0) {
    if (typeof onProgress === "function") onProgress(1);
    // sizes stable => rifit
    this._refreshSizesFromImages(this.items);
    this._requestFit(12);
    return;
  }

  let done = 0;
  const total = list.length;

  await Promise.all(
    list.map(p =>
      p.then(() => {
        done++;
        if (typeof onProgress === "function") onProgress(done / total);
      })
    )
  );

  // forza 100% a fine preload
  if (typeof onProgress === "function") onProgress(1);

  // sizes stable => rifit
  this._refreshSizesFromImages(this.items);
  this._requestFit(12);
  // after full preload, no need to keep refreshing each frame
  this._needsSizeRefresh = false;
}

  setFilteredRows(filteredRows) {
    const set = new Set();
    for (const r of (filteredRows || [])) {
      const url = imageUrlFromRow(r);
      if (url) set.add(url);
    }
    this.filteredSet = set;

    if (this.mode === "grid" || this.mode === "weight") {
  for (const it of this.items) it.targetAlpha = set.has(it.url) ? 1 : 0;
  this.layout();
  this._startTween();
  this._requestFit(10);
}
  }

  setMode(mode) {
  if (mode === this.mode) return;

  const prev = this.mode;
  this.mode = mode;

  // ✅ Se sto uscendo dalla vista "grid" o "weight", ripristino le dimensioni originali (float/sandbox)
  if ((prev === "weight" || prev === "grid") && mode !== prev) {
    for (const it of this.items) {
      if (it.baseW != null) it.w = it.baseW;
      it._sized = false; // forza ricalcolo h/imgH
    }
    // in float non lo richiami più sotto, quindi lo facciamo qui
    this._refreshSizesFromImages(this.items);
  }

  // ===== FLOAT =====
  if (mode === "float") {
    for (const it of this.items) {
      it.targetAlpha = 1;
      it.tx = it.ax + (it.offX || 0);
      it.ty = it.ay + (it.offY || 0);
    }

    this._startTween();
    this._requestFit(12);
    return;
  }

  // ===== GRID / WEIGHT: alpha in base ai filtrati =====
  if (!this.filteredSet) this.filteredSet = new Set(this.items.map(i => i.url));
  for (const it of this.items) {
    it.targetAlpha = this.filteredSet.has(it.url) ? 1 : 0;
  }

  // ⚠️ IMPORTANTISSIMO:
  // NON chiamare _refreshSizesFromImages(this.items) qui.
  // - in GRID ci pensa layout() (refresh sui visibles)
  // - in WEIGHT ci pensa _layoutWeight() (setta w dal peso e poi refresh)
  this.layout();
  this._startTween();

  this.tViewX = 0;
  this.tViewY = 0;
  this._requestFit(mode === "weight" ? 12 : 10);
}
  _startTween(){
  this._tweening = true;
  this._tweenT0 = performance.now();

  for (const it of this.items){
    const a1 = it.targetAlpha;
    it._tw = {
      x0: it.x, y0: it.y, a0: it.alpha,
      x1: it.tx, y1: it.ty, a1,
    };
  }

  // ✅ Sync camera fit with the same tween timing (avoid camera zooming faster than layout)
  // Stop any multi-frame fit that might fight this.
  this._fitFrames = 0;
  this._fitTarget = null;

  const goal = this._computeFitTarget();
  if (goal){
    const s0 = Math.max(1e-6, this.tScale);
    const c0x = -this.tViewX / s0;
    const c0y = -this.tViewY / s0;

    this._camTween = {
      c0x, c0y,
      s0: this.tScale,
      cx: goal.cx,
      cy: goal.cy,
      s1: goal.s
    };
    this._camTweenActive = true;

    // reset camera velocities so the critically-damped smoother doesn't lag behind
    this._camVX = 0;
    this._camVY = 0;
    this._camVS = 0;
  } else {
    this._camTween = null;
    this._camTweenActive = false;
  }
}
  layout() {
  if (this.mode !== "grid" && this.mode !== "weight") return;
if (this.mode === "weight") return this._layoutWeight();
  if (!this.filteredSet) return;

  const visibles = this.items.filter(it => it.targetAlpha > 0.5);
  const N = visibles.length;
  if (!N) return;

  // ✅ GRID: uniform card width after filters are applied
  if (this.mode === "grid") {
    for (const it of visibles) {
      it.w = this.gridCardW;
      it._sized = false;
    }
  }

  this._refreshSizesFromImages(visibles);

  let maxW = 0, maxH = 0;
  for (const it of visibles) {
    if (it.w > maxW) maxW = it.w;
    if (it.h > maxH) maxH = it.h;
  }

  // ✅ spacing “sub-like” MA senza schiacciare le colonne
  const gap = 44;                 // (prima avevi 56 -> troppo, tende a verticalizzare)
  const cellW = maxW + gap;
  const cellH = maxH + gap;

  // ✅ IMPORTANTISSIMO:
  // NON legare il numero di colonne alla scala della camera.
  // La griglia è in world-space, la camera fa già zoom.
  // --- COLONNE "ORIZZONTALI" (sub-like): dipende da N e dal rapporto W/H ---
const usableW = Math.max(320, this.W - 160);
const usableH = Math.max(320, this.H - 220);

// in world-space (dipende dallo zoom target)
const worldW = usableW / Math.max(0.001, this.tScale);
const worldH = usableH / Math.max(0.001, this.tScale);

// se lo schermo è largo, aumentiamo le colonne
const aspect = worldW / worldH;

// sqrt distribuisce “quadrato”, moltiplicato per aspect → più largo = più colonne
let colsWorld = Math.ceil(Math.sqrt(N * aspect)*1.12);

// clamp sensato
colsWorld = clamp(colsWorld, 3, Math.min(N, 18)); // 18 = limite “estetico”, puoi alzarlo

const rows = Math.ceil(N / colsWorld);

  const gridW = colsWorld * cellW - gap;
  const gridH = rows * cellH - gap;

  const startX = -gridW / 2;
  const startY = -gridH / 2;

  for (let i = 0; i < N; i++) {
    const it = visibles[i];
    const c = i % colsWorld;
    const r = Math.floor(i / colsWorld);
    it.tx = startX + c * cellW + cellW / 2 + (it.offX || 0);
it.ty = startY + r * cellH + cellH / 2 + (it.offY || 0);
  }
}

  // ---------- UPDATE ----------
  update(dt) {
    dt = Math.min(dt || 16.666, 22);
    this._t = performance.now();
    // Smooth UI gating (avoid flicker when tag/specs appear/disappear)
    const nowUI = performance.now();

    // Se sto interagendo (zoom/pan/drag) non spengo completamente la UI:
    // così i dettagli possono essere visibili prima e non “blinkano”.
    const interactingUI = this.dragging || this.draggingCard || Math.abs(this.zoomVel) > this.zoomStopEps;

    let targetUI = ((nowUI - this._lastInputT) > this._uiIdleDelay) ? 1 : (this._uiActiveFloor || 0.60);

    // In scene molto dense, durante interazione, riduciamo un filo (performance)
    const visCountUI = this._visibleCount();
    if (interactingUI && visCountUI > 160) targetUI = Math.min(targetUI, 0.42);

    const kUI = kFromEase(this._uiAlphaEase, dt);
    this._uiAlpha = lerp(this._uiAlpha ?? 0, targetUI, kUI);

    // keep a boolean too (some branches still use it)
    this._uiIdle = (this._uiAlpha > 0.92);
    // hovered item (solo se interazioni abilitate) — throttled for perf
    if (this.interactionsEnabled !== false) {
      const now = performance.now();
      // during heavy scenes or active interaction, avoid per-frame picking
      const visCount = this._visibleCount();
      const tooMany = (visCount > 140);
      const interacting = this.dragging || this.draggingCard || Math.abs(this.zoomVel) > this.zoomStopEps;

      if (!tooMany && !interacting && (now - this._lastHoverPickT) > this._hoverPickInterval) {
        this.hovered = this.pickAtScreen(this.mouseX, this.mouseY);
        this._lastHoverPickT = now;
      } else if (tooMany || interacting) {
        // keep previous hovered, but clear if it is no longer visible
        if (this.hovered && (this.hovered.alpha < 0.10)) this.hovered = null;
      }
    } else {
      this.hovered = null;
    }

    // pan momentum
    if (!this.dragging) {
      const v = Math.hypot(this.panVelX, this.panVelY);
      if (v > this.panStopEps) {
        const fr = Math.pow(this.panFriction, dt / 16.666);
        this.panVelX *= fr;
        this.panVelY *= fr;
        this.tViewX += this.panVelX * dt;
        this.tViewY += this.panVelY * dt;
      } else {
        this.panVelX = 0;
        this.panVelY = 0;
      }
    }

    // momentum wheel
    if (Math.abs(this.zoomVel) > this.zoomStopEps) {
      const fr = Math.pow(this.zoomFriction, dt / 16.666);
      this.zoomVel *= fr;

      const ax = (this._zoomAnchorX == null) ? this.W * 0.5 : this._zoomAnchorX;
      const ay = (this._zoomAnchorY == null) ? this.H * 0.5 : this._zoomAnchorY;

      const next = this.tScale * Math.exp(this.zoomVel * dt);
      this.setScale(next, ax, ay);
    } else {
      this.zoomVel = 0;
    }

    // ✅ Camera tween synced with layout tween (grid/weight transitions)
    if (this._camTweenActive && this._camTween){
      const t = (performance.now() - this._tweenT0) / this.tweenDur;
      const e = easeInOutCubic(t);

      const s = lerp(this._camTween.s0, this._camTween.s1, e);
      const cx = lerp(this._camTween.c0x, this._camTween.cx, e);
      const cy = lerp(this._camTween.c0y, this._camTween.cy, e);

      this.tScale = s;
      this.tViewX = -cx * s;
      this.tViewY = -cy * s;

      // ✅ Apply immediately to avoid the extra lag introduced by the smoothing step below
      this.viewX = this.tViewX;
      this.viewY = this.tViewY;
      this.scale = this.tScale;

      // reset velocities so we don't "ease" after the tween finishes
      this._camVX = 0;
      this._camVY = 0;
      this._camVS = 0;

      if (t >= 1){
        this._camTweenActive = false;
        this._camTween = null;
      }

    } else {
      // robust fit multi-frame (fallback)
      if (this._fitFrames > 0) {
        this._fitFrames--;
        const goal = this._computeFitTarget();
        if (goal) {
          if (!this._fitTarget) this._fitTarget = goal;
          this._fitTarget = {
            cx: lerp(this._fitTarget.cx, goal.cx, this._fitEase),
            cy: lerp(this._fitTarget.cy, goal.cy, this._fitEase),
            s:  lerp(this._fitTarget.s,  goal.s,  this._fitEase),
          };
          this.tScale = this._fitTarget.s;
          this.tViewX = -this._fitTarget.cx * this.tScale;
          this.tViewY = -this._fitTarget.cy * this.tScale;
        }
        if (this._fitFrames === 0) {
          this._fitDone = true;
          this._fitTarget = null;
        }
      }
    }

    // ===== camera smooth (premium: critically damped) =====
    // During synced tween we already apply camera values directly to stay perfectly aligned with cards.
    if (!this._camTweenActive) {
      const panT  = this.dragging ? this.camSmoothDrag : this.camSmoothPan;
      const zoomT = this.dragging ? this.camSmoothDrag : this.camSmoothZoom;

      let sx = smoothDamp(this.viewX, this.tViewX, this._camVX, panT, dt);
      this.viewX = sx.value; this._camVX = sx.vel;

      let sy = smoothDamp(this.viewY, this.tViewY, this._camVY, panT, dt);
      this.viewY = sy.value; this._camVY = sy.vel;

      // zoom: NO smoothDamp (lo vuoi “diretto”, non AE-tweenato)
      const kZ = kFromEase(this.camEase, dt);
      this.scale = lerp(this.scale, this.tScale, kZ);
      this._camVS = 0; // reset vel per evitare residue
    }

    // parallax mouse
    const mx = (this.mouseX / Math.max(1, this.W) - 0.5) * 2;
    const my = (this.mouseY / Math.max(1, this.H) - 0.5) * 2;
    const tx = mx * this.parStrength;
    const ty = my * this.parStrength;
    const kPar = kFromEase(this.parEase, dt);
    this.parX = lerp(this.parX, tx, kPar);
    this.parY = lerp(this.parY, ty, kPar);

    // motion parallax
    const dvx = this.viewX - this._pViewX;
    const dvy = this.viewY - this._pViewY;
    const dsc = this.scale - this._pScale;

    this._pViewX = this.viewX;
    this._pViewY = this.viewY;
    this._pScale = this.scale;

    const kMot = kFromEase(this.motEase, dt);
    const damp = Math.pow(this.motDamp, dt / 16.666);

    const tmx = -dvx * 9.5;
const tmy = -dvy * 9.5;
const tmz = -dsc * 2100.0;

    this.motX = lerp(this.motX, tmx, kMot) * damp;
    this.motY = lerp(this.motY, tmy, kMot) * damp;
    this.motZ = lerp(this.motZ, tmz, kMot) * damp;

    const ztx = mx * this.motZ * 0.10;
    const zty = my * this.motZ * 0.10;
    this.zoomPX = lerp(this.zoomPX, ztx, kMot) * damp;
    this.zoomPY = lerp(this.zoomPY, zty, kMot) * damp;

    // float targets
    if (this.mode === "float") {
  for (const it of this.items) {
    it.tx = it.ax + (it.offX || 0);
    it.ty = it.ay + (it.offY || 0);
    it.targetAlpha = 1;
  }
}

    // ===== POS / ALPHA update =====
// in grid: se tween attivo => AE ease-in-out
if (this._tweening){
  const t = (performance.now() - this._tweenT0) / this.tweenDur;
  const e = easeInOutCubic(t);

  for (const it of this.items){
    if (!it._tw) continue;
    it.x = lerp(it._tw.x0, it._tw.x1, e);
    it.y = lerp(it._tw.y0, it._tw.y1, e);
    it.alpha = lerp(it._tw.a0, it._tw.a1, e);
  }

  if (t >= 1){
    this._tweening = false;
    for (const it of this.items) it._tw = null;
  }
} else {
  // comportamento originale (float + micro movimento)
  const kMove = kFromEase(this.moveK, dt);
  const kFade = kFromEase(this.fadeK, dt);
  for (const it of this.items){
    it.x = lerp(it.x, it.tx, kMove);
    it.y = lerp(it.y, it.ty, kMove);
    it.alpha = lerp(it.alpha, it.targetAlpha, kFade);
  }
   }
   // hover smoothing per item
const hK = kFromEase(this.hoverEase, dt);
for (const it of this.items) {
  const target = (this.hovered === it) ? 1 : 0;
  it.hover = lerp(it.hover || 0, target, hK);
}
 }

  draw(ctx) {
    const visCount = this._visibleCount();
    // UI heavy parts (text/specs) use smoothed gating from update()
    this._uiIdle = (this._uiAlpha > 0.92);
    // perf flag (used inside card render)
    this._perfMode = (visCount > 120) || (visCount > 90 && this.scale < 0.85);

    // render scale (perf)
    let rs = 1.0;
    if (this.scale < 0.85) rs = 0.90;
    if (this.scale < 0.60) rs = 0.78;
    if (this.scale < 0.45) rs = 0.68;
    if (visCount > 90 && this.scale < 0.75) rs = Math.min(rs, 0.72);
    rs = clamp(rs, 0.62, 1.0);
    this._renderScale = rs;

    if (!this._frameCanvas) {
      this._frameCanvas = document.createElement("canvas");
      this._frameCtx = this._frameCanvas.getContext("2d");
    }

    const bw = Math.max(1, Math.floor(this.W * rs));
    const bh = Math.max(1, Math.floor(this.H * rs));
    if (this._frameCanvas.width !== bw || this._frameCanvas.height !== bh) {
      this._frameCanvas.width = bw;
      this._frameCanvas.height = bh;
      this._patCtxId = null;
    }

    const g = this._frameCtx;

    // Clear framebuffer to transparent (so background can be drawn on the final canvas)
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    g.restore();

    g.setTransform(rs, 0, 0, rs, 0, 0);
    g.imageSmoothingEnabled = true;

    // Draw only the scene (cards/images) into the framebuffer
    this._drawScene(g);

    // Draw BG DOTS in *screen space*.
    // NOTE: app.js sets ctx transform to DPR so drawing in (this.W,this.H) is in CSS pixels.
    // Do NOT reset transform to identity, or you'll only fill a corner on DPR>1 screens.
    ctx.save();
    this._ensurePatterns(ctx);
    this._drawParallaxBackground(ctx, this.W, this.H);
    ctx.restore();

    // Composite the scene on top
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._frameCanvas, 0, 0, this.W, this.H);
    ctx.restore();
  }

  pickAtScreen(sx, sy) {
    const cx = this.W * 0.5;
    const cy = this.H * 0.5;
    const camX = this.viewX + this.parX * 0.78 + this.motX * 0.85 + this.zoomPX * 0.55;
    const camY = this.viewY + this.parY * 0.78 + this.motY * 0.85 + this.zoomPY * 0.55;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.alpha < 0.10) continue;

      let x = cx + camX + it.x * this.scale;
      let y = cy + camY + it.y * this.scale;

      if (this.mode === "float" && this.scale > 0.55) {
        const tt = this._t;
        x += Math.sin(tt * this.floatSpeed + it.ph1) * this.floatAmp;
        y += Math.cos(tt * this.floatSpeed + it.ph2) * this.floatAmp;
      }

      const w = it.w * this.scale;
      const h = it.h * this.scale;
      if (sx >= x - w/2 && sx <= x + w/2 && sy >= y - h/2 && sy <= y + h/2) return it;
    }
    return null;
  }
  // --------- HERO ORIGIN RECT (screen px) ----------
  _originRectFromItem(it){
  if (!it) return null;

  const cx = this.W * 0.5;
  const cy = this.H * 0.5;

  // stessa camera usata in draw/pickAtScreen
  const camX = this.viewX + this.parX * 0.78 + this.motX * 0.85 + this.zoomPX * 0.55;
  const camY = this.viewY + this.parY * 0.78 + this.motY * 0.85 + this.zoomPY * 0.55;

  // posizione canvas-space del centro card
  let sx = cx + camX + it.x * this.scale;
  let sy = cy + camY + it.y * this.scale;

  // float micro-movement coerente
  if (this.mode === "float" && this.scale > 0.55) {
    const tt = this._t;
    sx += Math.sin(tt * this.floatSpeed + it.ph1) * this.floatAmp;
    sy += Math.cos(tt * this.floatSpeed + it.ph2) * this.floatAmp;
  }

  const cardW = it.w * this.scale;
  const cardH = it.h * this.scale;

  // ✅ ORIGINE = SOLO area immagine della card (non include topbar e specs)
  const topH = this.topBarH * this.scale;
  const infoH = (this.mode === "grid" && this.showSpecsInGrid) ? (it.infoH * this.scale) : 0;
  const imgH  = Math.max(10, cardH - topH - infoH);

  // top-left della card in canvas-space
  const left = sx - cardW / 2;
  const top  = sy - cardH / 2;

  // rettangolo area immagine (canvas-space)
  const imgRectCanvas = {
    x: left,
    y: top + topH,
    w: cardW,
    h: imgH,
    r: this.borderR * this.scale
  };

  // ✅ converti in viewport-space (page px)
  const cr = this.canvas.getBoundingClientRect();
  return {
    x: cr.left + imgRectCanvas.x,
    y: cr.top  + imgRectCanvas.y,
    w: imgRectCanvas.w,
    h: imgRectCanvas.h,
    r: imgRectCanvas.r
  };
}

  // ---------- FIT ----------
  _requestFit(frames = 12) {
    this._fitFrames = Math.max(this._fitFrames, frames);
    this._fitDone = false;
    this._fitTarget = null;
    // evita overshoot/deriva quando parte un fit importante
this._camVX = 0;
this._camVY = 0;
this._camVS = 0;
  }

  _computeFitTarget() {
  const layoutMode = (this.mode === "grid" || this.mode === "weight");

  let arr = this.items;
  if (layoutMode) arr = this.items.filter(it => it.targetAlpha > 0.5);
  if (!arr.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const it of arr) {
    const px = layoutMode ? it.tx : it.x;
    const py = layoutMode ? it.ty : it.y;

      const hw = it.w * 0.5;
      const hh = it.h * 0.5;

      minX = Math.min(minX, px - hw);
      maxX = Math.max(maxX, px + hw);
      minY = Math.min(minY, py - hh);
      maxY = Math.max(maxY, py + hh);
    }

    const bw = Math.max(10, maxX - minX);
    const bh = Math.max(10, maxY - minY);

    const usableW = Math.max(200, this.W - this.safeSide * 2);
    const usableH = Math.max(200, this.H - this.safeTop - this.safeBottom);

    const sx = usableW / bw;
    const sy = usableH / bh;
    const s = clamp(Math.min(sx, sy), this.minScale, this.maxScale);

    const cxW = (minX + maxX) * 0.5;
    const cyW = (minY + maxY) * 0.5;

    const yBias = (this.safeTop - this.safeBottom) * 0.20 / Math.max(1, s);

    return { cx: cxW, cy: cyW + yBias, s };
  }

  // ---------- DRAW ----------
  _drawScene(g) {
    const cx = this.W * 0.5;
    const cy = this.H * 0.5;

    // Avoid refreshing sizes every frame: do it only when needed (and throttled).
    if (this._needsSizeRefresh) {
      const now = performance.now();
      if (now - this._lastSizeRefresh > 220) {
        this._refreshSizesFromImages(this.items);
        this._lastSizeRefresh = now;

        // keep refreshing only if there are still decoded images without computed sizes
        let pending = false;
        for (const it of this.items) {
          const rec = this.imgCache.get(it.url);
          if (rec && rec.ok && !it._sized) { pending = true; break; }
        }
        this._needsSizeRefresh = pending;
      }
    }

    const lod = this.scale;
    const camX = this.viewX + this.parX * 0.78 + this.motX * 0.85 + this.zoomPX * 0.55;
    const camY = this.viewY + this.parY * 0.78 + this.motY * 0.85 + this.zoomPY * 0.55;

    for (const it of this.items) {
      if (it.alpha < 0.02) continue;
      const rec = this.imgCache.get(it.url);
      if (!rec || rec.err) continue;

      let sx = cx + camX + it.x * this.scale;
      let sy = cy + camY + it.y * this.scale;

      if (this.mode === "float" && this.scale > 0.55) {
        const tt = this._t;
        sx += Math.sin(tt * this.floatSpeed + it.ph1) * this.floatAmp;
        sy += Math.cos(tt * this.floatSpeed + it.ph2) * this.floatAmp;
      }

      const w = it.w * this.scale;
      const h = it.h * this.scale;

      // culling
      const pad = 260;
      if (sx + w/2 < -pad || sx - w/2 > this.W + pad ||
          sy + h/2 < -pad || sy - h/2 > this.H + pad) continue;

      // LOD: se molto zoom-out, disegno veloce
      // extra perf: with many visibles, force FAST earlier (reduces lag spikes)
      const visCount = this._visibleCount();
      const forceFast = (visCount > 180 && lod < 1.05) || (visCount > 240 && lod < 1.20);
      if (lod < 0.62 || forceFast) {
        this._drawFast(g, rec, sx, sy, it.alpha, it, w, h);
        continue;
      }

      const label = (it.row?.ID || it.row?.Id || it.row?.id || it.row?.file || "")
        .toString()
        .replace(/\.[^/.]+$/, "");

      if (lod < 0.92) this._drawMid(g, rec, sx, sy, it.alpha, label, it, w, h);
      else this._drawFull(g, rec, sx, sy, it.alpha, label, it, w, h);
    }
  }

  _img(rec) { return rec.bmp || rec.img; }

  _drawFull(ctx, rec, x, y, a, label, it, w, h) {
  const s = this.scale;
  const topH = this.topBarH * s;
  const r = this.borderR * s;

  const showSpecs = (this.mode === "grid" && this.showSpecsInGrid);
  const infoH = showSpecs ? (it.infoH * s) : 0;
  const imgH = (h - topH - infoH);
  // Smooth UI fade (prevents bottom tag/specs flicker)
  const uiFade = clamp((this._uiAlpha ?? 1), 0, 1);
  // ✅ soglie più “precoce”: dettagli compaiono prima mentre si zoomma in GRID
  const uiK = (showSpecs && infoH > 0) ? smoothstep(this.uiRevealIn, this.uiRevealOut, this.scale) : 1;

  ctx.save();
  ctx.translate(x, y);

  // shadow (disable in perf mode)
  if (!this._perfMode) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 9;
  } else {
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  // card bg
  ctx.globalAlpha = a * 0.88;
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  this._rr(ctx, -w/2, -h/2, w, h, r);
  ctx.fill();

  // outline sottile + meno chiara (skip in perf mode)
  if (!this._perfMode) {
    ctx.globalAlpha = a * 0.10;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    this._rr(ctx, -w/2, -h/2, w, h, r);
    ctx.stroke();
  }
  // hover ring (more evident) — skip during perf/interaction to reduce lag
  if ((it.hover || 0) > 0.01 && !this._perfMode && (this._uiAlpha ?? 1) > 0.65) {
    ctx.save();

    // glow leggero (solo sul ring)
    ctx.shadowColor = "rgba(255,255,255,0.22)";
    ctx.shadowBlur = 10 * this.scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // ring più presente
    ctx.globalAlpha = a * (0.14 + 0.38 * it.hover);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(1.25, 1.8 * this.scale);

    this._rr(ctx, -w/2 + 0.8, -h/2 + 0.8, w - 1.6, h - 1.6, r);
    ctx.stroke();

    ctx.restore();
  }

  // topbar: SOLO angoli sopra (niente pill “strano”)
  ctx.globalAlpha = a * 0.92 * uiK * uiFade;
  ctx.fillStyle = "rgba(140,140,140,0.38)";
  this._rrTop(ctx, -w/2, -h/2, w, topH, r);
  ctx.fill();

  // label (skip while interacting in heavy scenes)
  if (this._uiIdle || !this._perfMode) {
    // Font grows when zoomed-in (was capped too low, making text tiny at high zoom)
    const fs = clamp(11.5 * s, 7.2, 18);
    if (fs >= 7.2) {
      ctx.globalAlpha = a * 0.90 * uiK * uiFade;
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `600 ${fs}px "CX-Seagal", system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label || "", -w/2 + 12*s, -h/2 + topH/2);
    }
  }

  // dot top-right
  ctx.globalAlpha = a * 0.80 * uiK * uiFade;
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.beginPath();
  ctx.arc(w/2 - 14*s, -h/2 + topH/2, 3.4*s, 0, Math.PI * 2);
  ctx.fill();

  // no shadow for image area
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // image clip:
  // - sopra dritto (sotto topbar)
  // - sotto: se NON c’è specs panel → bottom rounded; se c’è panel → bottom dritto
  ctx.save();
  if (showSpecs && infoH > 0) {
    ctx.beginPath();
    ctx.rect(-w/2, -h/2 + topH, w, imgH);
    ctx.clip();
  } else {
    this._rrBottom(ctx, -w/2, -h/2 + topH, w, imgH, r);
    ctx.clip();
  }

  if (rec.ok) {
    const img = this._img(rec);
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;

    const boxW = w;
    const boxH = imgH;

    const sc = Math.min(boxW / iw, boxH / ih);
    const dw = iw * sc;
    const dh = ih * sc;

    const yTop = -h/2 + topH;
    ctx.globalAlpha = a;
    ctx.drawImage(img, -dw/2, yTop + (boxH - dh)/2, dw, dh);
  }
  ctx.restore();

  // specs panel (solo in grid) — fade-in progressivo con lo zoom (più fluido)
  if (showSpecs && infoH > 0) {
    const panelY = -h/2 + topH + imgH;

    // da ~0.68 a ~0.92 scala: entra gradualmente
    // smooth fade + gate with uiFade
    const specK = smoothstep(this.uiRevealIn, this.uiRevealOut, this.scale) * uiFade;
    if (specK > 0.02) {
      ctx.globalAlpha = a * this.specPanelAlpha * specK;
      ctx.fillStyle = this.specPanelFill;
      this._rrBottom(ctx, -w/2, panelY, w, infoH, r);
      ctx.fill();

      // usa lo stesso fattore anche per testo/bullets
      this._drawSpecsBlock(ctx, it, -w/2, panelY, w, infoH, a * specK);
    }
  }

  ctx.restore();
}

  _drawMid(ctx, rec, x, y, a, label, it, w, h) {
  const s = this.scale;
  const topH = this.topBarH * s;
  const r = this.borderR * s;

  const showSpecs = (this.mode === "grid" && this.showSpecsInGrid);
  const infoH = showSpecs ? (it.infoH * s) : 0;
  const imgH = (h - topH - infoH);
  // ✅ Smooth fade-in (prevents flicker)
  const uiFade = clamp((this._uiAlpha ?? 1), 0, 1);
  const uiK = (showSpecs && infoH > 0) ? smoothstep(this.uiRevealIn, this.uiRevealOut, this.scale) : 1;

  ctx.save();
  ctx.translate(x, y);

  // card bg + outline (stesso stile del full, più “cheap”)
  ctx.globalAlpha = a * 0.82;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  this._rr(ctx, -w/2, -h/2, w, h, r);
  ctx.fill();

  if (!this._perfMode) {
    ctx.globalAlpha = a * 0.08;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    this._rr(ctx, -w/2, -h/2, w, h, r);
    ctx.stroke();
  }
  // hover ring (subtle) — skip during perf/interaction
  if ((it.hover || 0) > 0.01 && !this._perfMode && (this._uiAlpha ?? 1) > 0.65) {
    ctx.globalAlpha = a * (0.08 + 0.22 * it.hover);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1, 1.15 * this.scale);
    this._rr(ctx, -w/2 + 0.6, -h/2 + 0.6, w - 1.2, h - 1.2, r);
    ctx.stroke();
  }

  // topbar
  ctx.globalAlpha = a * 0.86 * uiK * uiFade;
  ctx.fillStyle = "rgba(140,140,140,0.30)";
  this._rrTop(ctx, -w/2, -h/2, w, topH, r);
  ctx.fill();

  // label (piccola) — skip while interacting in heavy scenes
  if (this._uiIdle || !this._perfMode) {
    // Font grows when zoomed-in (was capped too low, making text tiny at high zoom)
    const fs = clamp(11.5 * s, 7.2, 18);
    if (fs >= 7.2) {
      ctx.globalAlpha = a * 0.82 * uiK * uiFade;
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.font = `600 ${fs}px "CX-Seagal", system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label || "", -w/2 + 12*s, -h/2 + topH/2);
    }
  }

  // image clip come full
  ctx.save();
  if (showSpecs && infoH > 0) {
    ctx.beginPath();
    ctx.rect(-w/2, -h/2 + topH, w, imgH);
    ctx.clip();
  } else {
    this._rrBottom(ctx, -w/2, -h/2 + topH, w, imgH, r);
    ctx.clip();
  }

  if (rec.ok) {
    const img = this._img(rec);
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;

    const sc = Math.min(w / iw, imgH / ih);
    const dw = iw * sc;
    const dh = ih * sc;

    const yTop = -h/2 + topH;
    ctx.globalAlpha = a;
    ctx.drawImage(img, -dw/2, yTop + (imgH - dh)/2, dw, dh);
  }
  ctx.restore();

  // specs (solo grid) — fade-in progressivo + stesso layout del full (niente scatti)
  if (showSpecs && infoH > 0) {
    const panelY = -h/2 + topH + imgH;

    const specK = smoothstep(this.uiRevealIn, this.uiRevealOut, this.scale) * uiFade;
    if (specK > 0.02) {
      ctx.globalAlpha = a * this.specPanelAlpha * specK;
      ctx.fillStyle = this.specPanelFill;
      this._rrBottom(ctx, -w/2, panelY, w, infoH, r);
      ctx.fill();

      this._drawSpecsBlock(ctx, it, -w/2, panelY, w, infoH, a * specK);
    }
  }

  ctx.restore();
}

  _drawFast(ctx, rec, x, y, a, it, w, h) {
    if (!rec.ok) return;

    // In fast usiamo *la stessa geometria* dell’area immagine (sotto topbar e sopra specs)
    // così l’immagine non cambia scala/offset quando compare la topbar/specs.

    const s = this.scale;

    const showSpecs = (this.mode === "grid" && this.showSpecsInGrid);
    const infoH = (showSpecs && it && it.infoH) ? (it.infoH * s) : 0;

    // Fade-in: in GRID (con specs) facciamo comparire topbar + specs insieme.
    // In FLOAT resta come prima (più presto).
    const k = (showSpecs && infoH > 0)
      ? smoothstep(this.uiRevealIn, this.uiRevealOut, s)
      : smoothstep(0.54, 0.66, s);

    const img = this._img(rec);
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;
    if (!iw || !ih) return;

    const r = this.borderR * s;
    const topH = this.topBarH * s;

    const imgH = Math.max(8, h - topH - infoH);

    ctx.save();
    ctx.translate(x, y);

    // Frame leggerissimo (opzionale) per rendere il passaggio più dolce
    if (k > 0.01) {
      ctx.globalAlpha = a * (0.18 + 0.55 * k);
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      this._rr(ctx, -w/2, -h/2, w, h, r);
      ctx.fill();

      ctx.globalAlpha = a * (0.04 + 0.08 * k);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      this._rr(ctx, -w/2, -h/2, w, h, r);
      ctx.stroke();

      // Topbar “presenza” (senza testo)
      ctx.globalAlpha = a * (0.24 + 0.60 * k);
      ctx.fillStyle = "rgba(140,140,140,0.26)";
      this._rrTop(ctx, -w/2, -h/2, w, topH, r);
      ctx.fill();
    }

    // Clip area immagine: identica a mid/full
    ctx.save();
    const yTop = -h/2 + topH;
    if (showSpecs && infoH > 0) {
      ctx.beginPath();
      ctx.rect(-w/2, yTop, w, imgH);
      ctx.clip();
    } else {
      this._rrBottom(ctx, -w/2, yTop, w, imgH, r);
      ctx.clip();
    }

    // Disegno immagine (contain) dentro boxW=w, boxH=imgH
    const sc = Math.min(w / iw, imgH / ih);
    const dw = iw * sc;
    const dh = ih * sc;

    ctx.globalAlpha = a * 0.98;
    ctx.drawImage(img, -dw/2, yTop + (imgH - dh) / 2, dw, dh);

    ctx.restore();
    ctx.restore();
  }

  _drawSpecsBlock(ctx, it, xLeft, yTop, w, h, a, maxLines = null){
    if ((a || 0) < 0.06) return;
    const entries = this._specEntries(it.row);

    // max righe visibili nel pannello (niente "See more")
    const hardMax = 4;
    const lines = entries.slice(0, (maxLines == null) ? hardMax : Math.min(hardMax, maxLines));

    const s = this.scale;

    // Allow larger fonts when zoomed-in (previous caps made specs too small at high zoom)
    const fontKey = clamp(11.6 * s, 6.9, 18);
    const fontVal = clamp(12.2 * s, 7.2, 20);
    const lineH   = Math.max(fontVal + 7.5 * s, 12.0 * s);

    const padX = this.specPadX * s;
    const padY = this.specPadY * s;
    const padR = 14 * s;

    const bulletX = xLeft + (10 * s);
    let yy = yTop + padY + lineH * 0.52;

    // colonne (key -> value) — cache per ridurre lag
    this._ensureSpecKeyCache(it, lines);
    const keyColW = (it._specKeyW || 0) * s;

    const keyX = xLeft + padX;
    const valX = keyX + keyColW + (10 * s);

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let i = 0; i < lines.length; i++) {
      const { label, value } = lines[i];

      // bullet
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.arc(bulletX, yy, this.specBulletR * s, 0, Math.PI*2);
      ctx.fill();

      // key
      ctx.globalAlpha = a * this.specTextA;
      ctx.fillStyle = "rgba(255,255,255,0.76)";
      ctx.font = `500 ${fontKey}px "CX-Seagal", system-ui, -apple-system, "Segoe UI", Roboto, Arial`;

      const keyText = `${label}:`;
      ctx.fillText(keyText, keyX, yy);

      // value (bold) — ellissi solo se necessario
      const maxW = (xLeft + w) - valX - padR;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${fontVal}px "CX-Seagal", system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
      ctx.fillText(this._ellipsize(ctx, value, maxW), valX, yy);

      yy += lineH;
      if (yy > yTop + h - padY - lineH*0.3) break;
    }
  }

  _specEntries(row){
    const out = [];
    for (const sp of (this.specLevels || DEFAULT_SPECS)){
      const v = getVal(row, sp);
      if (!v) continue;
      out.push({ key: sp.key, label: sp.label || sp.key, value: v });
    }
    return out;
  }

  _ensureSpecKeyCache(it, lines){
    if (!it) return;
    const key = lines.map(l => l.label).join("|");
    if (it._specKeyHash === key && Number.isFinite(it._specKeyW)) return;

    const m = this._measureCtx;
    if (!m) return;

    // measure at scale=1 (we'll multiply by current scale in draw)
    m.font = `500 11px "CX-Seagal", system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
    let w = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = `${lines[i].label}:`;
      w = Math.max(w, m.measureText(t).width);
    }

    it._specKeyHash = key;
    it._specKeyW = w;
  }

  _infoPanelHForRow(row, scale=1.0){
    // altezza pannello specs a “scala 1”
    const entries = this._specEntries(row);
    const lines = Math.min(entries.length, 4); // max 4 righe visibili (sub-like)
    const font = 14 * scale;
    const lineH = font + this.specLineGap * scale;
    const padY = this.specPadY * scale;

    return padY*2 + lines*lineH;
  }

  _drawParallaxBackground(ctx, bw = this.W, bh = this.H) {
    // NOTE: this function is called with ctx in identity transform (pixel-space)
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, bw, bh);

    // ✅ DOT GRID: completely fixed to the screen (no pan/zoom, no mouse parallax)
    // Slightly more visible but still soft.

    // dots (coarse)
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = this._dotCoarse;
    ctx.fillRect(0, 0, bw, bh);
    ctx.restore();

    // dots (fine)
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = this._dotFine;
    ctx.fillRect(0, 0, bw, bh);
    ctx.restore();
  }

  _ensurePatterns(ctx) {
    // Patterns are now created for the *final* canvas context, so they are always
    // fixed in screen pixels (no pan/zoom) and unaffected by framebuffer render-scale.
    if (this._patCtxId === ctx && this._dotFine && this._dotCoarse) return;

    this._patCtxId = ctx;

    // Meno fitta + pallini leggermente più grandi (sempre screen-space)
    const fineSpacing = 30;
    const fineRadius  = 1.25;

    const coarseSpacing = 128;
    const coarseRadius  = 2.05;

    this._dotFine = this._makeDotPattern(ctx, fineSpacing, fineRadius, "rgba(255,255,255,0.32)");
    this._dotCoarse = this._makeDotPattern(ctx, coarseSpacing, coarseRadius, "rgba(255,255,255,0.22)");
  }

  _makeDotPattern(ctx, spacing, radius, color) {
    const p = document.createElement("canvas");
    p.width = spacing;
    p.height = spacing;
    const g = p.getContext("2d");
    g.clearRect(0, 0, spacing, spacing);
    g.fillStyle = color;
    g.beginPath();
    g.arc(spacing / 2, spacing / 2, radius, 0, Math.PI * 2);
    g.fill();
    return ctx.createPattern(p, "repeat");
  }

  _refreshSizesFromImages(list) {
    for (const it of list) {
      const rec = this.imgCache.get(it.url);
      if (!rec || !rec.ok) continue;

      const img = rec.bmp || rec.img;
      const iw = img.width || img.naturalWidth;
      const ih = img.height || img.naturalHeight;
      if (!iw || !ih) continue;

      // aggiorna sempre infoH (dipende dalle specs)
      it.infoH = this._infoPanelHForRow(it.row, 1.0);

      if (!it._sized) {
        const aspect = iw / ih;
        const w = it.w;
        it.imgH = (w / aspect);
       const addInfo = (this.mode === "grid" && this.showSpecsInGrid);
it.h = this.topBarH + it.imgH + (addInfo ? it.infoH : 0);
        it._sized = true;
      } else {
        // se già sized, mantengo w e aggiorno h coerente (se info cambia)
        const w = it.w;
        const aspect = iw / ih;
        it.imgH = (w / aspect);
       const addInfo = (this.mode === "grid" && this.showSpecsInGrid);
it.h = this.topBarH + it.imgH + (addInfo ? it.infoH : 0); 
      }
    }
  }

  _visibleCount() {
    let n = 0;
    for (const it of this.items) if (it.alpha > 0.02) n++;
    return n;
  }
  _ellipsize(ctx, text, maxW){
  text = String(text ?? "");
  if (ctx.measureText(text).width <= maxW) return text;

  const ell = "…";
  let lo = 0, hi = text.length;
  while (lo < hi){
    const mid = Math.floor((lo + hi) / 2);
    const s = text.slice(0, mid) + ell;
    if (ctx.measureText(s).width <= maxW) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + ell;
}

  _rr(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // rounded only bottom corners (top edge straight)
  _rrBottom(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w/2, h/2));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y);
    ctx.closePath();
  }
  // rounded only TOP corners (bottom edge straight) — per topbar sub-like
_rrTop(ctx, x, y, w, h, r){
  const rr = Math.max(0, Math.min(r, w/2, h/2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

  // ---------- INPUT ----------
  _bindInput() {
    window.addEventListener("mousemove", (ev) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouseX = ev.clientX - r.left;
      this.mouseY = ev.clientY - r.top;
      if (this.dragging || this.draggingCard) this._lastInputT = performance.now();
      // cursor affordance
      if (this.interactionsEnabled !== false) {
        const h = this.pickAtScreen(this.mouseX, this.mouseY);
        this.canvas.style.cursor = this.draggingCard ? "grabbing" : (h ? "pointer" : "grab");
      } else {
        this.canvas.style.cursor = "default";
      }
    });

    this.canvas.addEventListener("wheel", (ev) => {
      if (this.interactionsEnabled === false) return;
      this._lastInputT = performance.now();
      ev.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      this._zoomAnchorX = ev.clientX - r.left;
      this._zoomAnchorY = ev.clientY - r.top;

      // normalizza deltaY (trackpad/mouse/wheel)
      let dy = ev.deltaY;
      if (ev.deltaMode === 1) dy *= 16;       // line -> px
      else if (ev.deltaMode === 2) dy *= 800; // page -> px

      this.zoomVel += (-dy) * this.zoomStrength;

      // clamp più basso => zoom meno “aggressivo”
      this.zoomVel = clamp(this.zoomVel, -0.0032, 0.0032);
    }, { passive: false });

    this.canvas.addEventListener("pointerdown", (ev) => {
      if (this.interactionsEnabled === false) return;
      this._lastInputT = performance.now();

      const r = this.canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left;
      const sy = ev.clientY - r.top;

      const picked = this.pickAtScreen(sx, sy);

      // ✅ se prendo una card: DRAG CARD
      if (picked) {
        // se stava tweenando (filtri), stoppo per non “combattere”
        this._tweening = false;
        for (const it of this.items) it._tw = null;

        this.draggingCard = picked;
        this._cardMoved = false;
        this.canvas.setPointerCapture(ev.pointerId);

        this._cardStart.x = ev.clientX;
        this._cardStart.y = ev.clientY;
        this._cardStart.offX = picked.offX || 0;
        this._cardStart.offY = picked.offY || 0;

        // stop momentum camera mentre drago una card
        this.panVelX = 0;
        this.panVelY = 0;
        return;
      }

      // ✅ altrimenti: PAN CAMERA (come prima)
      this.dragging = true;
      this._moved = false;
      this.canvas.setPointerCapture(ev.pointerId);

      this.dragStart.x = ev.clientX;
      this.dragStart.y = ev.clientY;
      this.dragStart.vx = this.tViewX;
      this.dragStart.vy = this.tViewY;

      // reset momentum
      this.panVelX = 0;
      this.panVelY = 0;
      this._panLastX = ev.clientX;
      this._panLastY = ev.clientY;
      this._panLastT = performance.now();
    });

    window.addEventListener("pointermove", (ev) => {
      if (this.interactionsEnabled === false) return;

      // ✅ NON resettare l'UI idle ad ogni movimento del mouse.
      // Aggiorna il timer solo durante interazioni reali (drag card o pan camera).
      // Se lo facciamo sempre, i dettagli attorno alla card flickerano/scompaiono.

      // ✅ DRAG CARD
      if (this.draggingCard) {
        this._lastInputT = performance.now();
        const dx = ev.clientX - this._cardStart.x;
        const dy = ev.clientY - this._cardStart.y;

        if (Math.abs(dx) + Math.abs(dy) > this.cardDragThreshold) this._cardMoved = true;

        // delta in world space (coerente con ciò che vedi)
        const sc = Math.max(0.0001, this.scale);
        const ddx = dx / sc;
        const ddy = dy / sc;

        this.draggingCard.offX = this._cardStart.offX + ddx;
        this.draggingCard.offY = this._cardStart.offY + ddy;

        return;
      }

      // ✅ PAN CAMERA
      if (!this.dragging) return;
      this._lastInputT = performance.now();

      const dx = ev.clientX - this.dragStart.x;
      const dy = ev.clientY - this.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._moved = true;

      this.tViewX = this.dragStart.vx + dx;
      this.tViewY = this.dragStart.vy + dy;

      const now = performance.now();
      const dtm = Math.max(8, Math.min(32, now - this._panLastT));
      this.panVelX = (ev.clientX - this._panLastX) / dtm;
      this.panVelY = (ev.clientY - this._panLastY) / dtm;

      this._panLastX = ev.clientX;
      this._panLastY = ev.clientY;
      this._panLastT = now;
    });

    window.addEventListener("pointerup", (ev) => {
  if (this.interactionsEnabled === false) return;

  // ✅ fine drag card: se NON hai mosso → click (apri prodotto)
  if (this.draggingCard) {
    if (!this._cardMoved) {
      if (typeof this.onRequestPick === "function") {
  const originRect = this._originRectFromItem(this.draggingCard);
  this.onRequestPick(this.draggingCard.row, originRect);
}
    }
    this.draggingCard = null;
    this._cardMoved = false;
    return;
  }

  // ✅ fine pan camera
  if (!this._moved) {
    this.panVelX = 0;
    this.panVelY = 0;
  }

  this.dragging = false;
});
  }
}