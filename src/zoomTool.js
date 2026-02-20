// src/zoomTool.js
"use strict";

function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }

// mapping log per “feel” migliore + curva (gamma) per ridurre sensibilità
function scaleToPct(s, min, max, gamma=1.0){
  const a = Math.log(min);
  const b = Math.log(max);
  const t = clamp((Math.log(s) - a) / (b - a), 0, 1);
  // gamma > 1 = meno sensibile ai piccoli movimenti (più “morbido”)
  return Math.pow(t, 1 / Math.max(0.0001, gamma));
}
function pctToScale(p, min, max, gamma=1.0){
  const a = Math.log(min);
  const b = Math.log(max);
  const tt = clamp(p, 0, 1);
  const t = Math.pow(tt, Math.max(0.0001, gamma));
  return Math.exp(a + (b - a) * t);
}

export class ZoomTool {
  constructor(toolEl, trackEl, knobEl, { min=0.35, max=2.2, value=1, onChange=null, gamma=2.8, smooth=0.12, dragSmooth=0.30 } = {}){
    this.el = toolEl;
    this.track = trackEl;
    this.knob = knobEl;

    this.min = min;
    this.max = max;
    this.value = value;
    this.onChange = onChange;

    this.gamma = gamma;
    this.smooth = clamp(smooth, 0, 1);
    // smoothing più forte durante il drag del knob (riduce sensibilità percepita)
    this.dragSmooth = clamp(dragSmooth, 0, 1);
    this._prevSmooth = this.smooth;

    // smoothing state
    this._targetValue = this.value;
    this._animRaf = 0;

    this._dragMode = null; // "move" | "knob"
    this._start = { ox:0, oy:0 };
    this._raf = 0;
    this._pending = null; // { mode:"move", x,y } | { mode:"knob", clientX }

    this._applyKnob();
    this._bind();
  }

  setValue(v, { immediate=false } = {}){
    const next = clamp(v, this.min, this.max);
    this._targetValue = next;

    if (immediate || this.smooth === 0){
      this.value = next;
      this._applyKnob();
      if (typeof this.onChange === "function") this.onChange(this.value);
      return;
    }

    // RAF smoothing: avvicina gradualmente al target
    if (this._animRaf) return;
    const step = () => {
      const dv = this._targetValue - this.value;
      if (Math.abs(dv) < 0.0005){
        this.value = this._targetValue;
        this._applyKnob();
        if (typeof this.onChange === "function") this.onChange(this.value);
        this._animRaf = 0;
        return;
      }
      this.value += dv * this.smooth;
      this._applyKnob();
      if (typeof this.onChange === "function") this.onChange(this.value);
      this._animRaf = requestAnimationFrame(step);
    };
    this._animRaf = requestAnimationFrame(step);
  }

  _applyKnob(){
    const r = this.track.getBoundingClientRect();
    const kw = this.knob.getBoundingClientRect().width || 0;
    const usableW = Math.max(1, r.width - kw);
    const pct = scaleToPct(this.value, this.min, this.max, this.gamma);
    this.knob.style.left = `${pct * usableW}px`;
  }

  _bind(){
    // drag knob
    this.knob.addEventListener("pointerdown", (ev)=>{
      ev.stopPropagation();
      this._dragMode = "knob";
      this.knob.setPointerCapture(ev.pointerId);
      this._prevSmooth = this.smooth;
      this.smooth = Math.max(this.smooth, this.dragSmooth);
    });

    // click on track -> set
    this.track.addEventListener("pointerdown", (ev)=>{
      if (ev.target === this.knob) return;
      ev.stopPropagation();

      const r = this.track.getBoundingClientRect();
      const pct = clamp((ev.clientX - r.left) / r.width, 0, 1);
      const next = pctToScale(pct, this.min, this.max, this.gamma);
      this.setValue(next, { immediate:false });
    });

    // drag widget (move)
    this.el.addEventListener("pointerdown", (ev)=>{
      if (ev.target === this.knob) return;
      this._dragMode = "move";
      this.el.setPointerCapture(ev.pointerId);

      const rect = this.el.getBoundingClientRect();
      this._start.ox = ev.clientX - rect.left;
      this._start.oy = ev.clientY - rect.top;
    });

    window.addEventListener("pointermove", (ev)=>{
      if (!this._dragMode) return;

      // accumula ultimo evento e aggiorna a RAF per evitare jitter
      if (this._dragMode === "move"){
        this._pending = { mode: "move", x: ev.clientX, y: ev.clientY };
      } else if (this._dragMode === "knob"){
        this._pending = { mode: "knob", clientX: ev.clientX };
      }

      if (this._raf) return;
      this._raf = requestAnimationFrame(()=>{
        this._raf = 0;
        const p = this._pending;
        this._pending = null;
        if (!p) return;

        if (p.mode === "move"){
          const nx = p.x - this._start.ox;
          const ny = p.y - this._start.oy;
          this.el.style.left = `${nx}px`;
          this.el.style.top = `${ny}px`;
          this.el.style.right = "auto";
          this.el.style.bottom = "auto";
          return;
        }

        if (p.mode === "knob"){
          const r = this.track.getBoundingClientRect();
          const pct = clamp((p.clientX - r.left) / r.width, 0, 1);
          const next = pctToScale(pct, this.min, this.max, this.gamma);
          this.setValue(next, { immediate:false });
        }
      });
    });

    window.addEventListener("pointerup", ()=>{
      // ripristina smoothing originale dopo drag
      this.smooth = this._prevSmooth;
      this._dragMode = null;
      this._pending = null;
      if (this._raf){
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
    });

    window.addEventListener("resize", ()=> this._applyKnob());
  }
}