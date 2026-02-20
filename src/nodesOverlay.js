// src/nodesOverlay.js
"use strict";

/**
 * NodesOverlay — v2
 * - NO bullet duplicati vicino alle card (quelli sono nella Gallery).
 * - Disegna SOLO: colonna bullet a destra + curve (più spesse) card -> colonna.
 */

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

export class NodesOverlay {
  constructor(levels = []) {
    this.levels = levels;

    this.W = 0;
    this.H = 0;

    this.selection = [];
    this.filteredCount = 0;

    // look (come reference: curve visibili)
    this.lineW = 2.2;                 // ✅ più spesso
    this.lineA = 0.55;
    this.lineColor = "rgba(255,255,255,1)";

    // colonna destra
    this.rightPad = 42;               // distanza dal bordo destro
    this.rightTop = 128;              // start y
    this.rightGap = 22;               // spazio tra bullet
    this.rightR = 3.6;                // raggio bullet colonna

    // curve
    this.curveT = 0.42;               // quanto “aperta” la bezier
  }

  setViewport(W, H){
    this.W = W; this.H = H;
  }

  setState(st){
    if (!st) return;
    if (Array.isArray(st.levels)) this.levels = st.levels;
    if (Array.isArray(st.selection)) this.selection = st.selection;
    if (typeof st.filteredCount === "number") this.filteredCount = st.filteredCount;
  }

  draw(ctx, gallery){
    if (!gallery) return;

    // niente overlay se non ci sono filtri attivi
    const lastSel = this._lastSelectedIndex();
    if (lastSel < 0) return;

    const cam = (typeof gallery.getCameraState === "function")
      ? gallery.getCameraState()
      : { scale: gallery.scale || 1 };

    // disegna colonna bullet a destra
    const xR = this.W - this.rightPad;
    const bulletPos = [];
    for (let i=0; i<=lastSel; i++){
      const y = this.rightTop + i*this.rightGap;
      bulletPos.push({ x:xR, y });
    }

    ctx.save();
    ctx.lineWidth = this.lineW;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1) curve: per ogni card visibile, per ogni livello selezionato, curva card->bullet colonna
    const items = (typeof gallery.getVisibleItems === "function")
      ? gallery.getVisibleItems()
      : (gallery.items || []);

    for (const it of items){
      if (!it || it.alpha < 0.10) continue;

      // solo in grid ha senso collegare ai bullet specs
      if (gallery.mode !== "grid" || !gallery.showSpecsInGrid) continue;

      // rettangolo + metriche della card sullo schermo
      const box = (typeof gallery.getItemScreenRect === "function")
        ? gallery.getItemScreenRect(it)
        : null;
      if (!box) continue;

      // anchors dei bullet “interni” (non li disegniamo, li usiamo solo come punti di partenza)
      // Replichiamo il calcolo della Gallery (stesso spacing e font base)
      const s = cam.scale || 1;
      const font = Math.max(11, 14*s);
      const lineH = font + (gallery.specLineGap || 8) * s;

      const padY = (gallery.specPadY || 14) * s;
      const bulletX = box.x - box.w/2 + (10*s); // come Gallery

      // y top del pannello specs
      const panelTop = (box.y - box.h/2) + (gallery.topBarH*s) + box.imgH;

      for (let li=0; li<=lastSel; li++){
        if (!this.selection[li]) continue;

        const y = panelTop + padY + lineH*0.55 + li*lineH;

        const end = bulletPos[li];
        if (!end) continue;

        // curva bezier (sub-like)
        const cx1 = bulletX + (end.x - bulletX) * this.curveT;
        const cy1 = y;
        const cx2 = bulletX + (end.x - bulletX) * (1 - this.curveT);
        const cy2 = end.y;

        ctx.globalAlpha = this.lineA;
        ctx.strokeStyle = this.lineColor;
        ctx.beginPath();
        ctx.moveTo(bulletX, y);
        ctx.bezierCurveTo(cx1, cy1, cx2, cy2, end.x, end.y);
        ctx.stroke();
      }
    }

    // 2) bullet colonna destra (SOLO questi: non quelli sulle righe)
    for (let i=0; i<=lastSel; i++){
      const p = bulletPos[i];
      const selected = !!this.selection[i];

      ctx.globalAlpha = selected ? 0.95 : 0.40;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.rightR, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.restore();
  }

  _lastSelectedIndex(){
    let last = -1;
    for (let i=0; i<this.selection.length; i++){
      if (this.selection[i]) last = i;
    }
    return last;
  }
}