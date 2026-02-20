// src/guide.js
"use strict";

const FONT_FAMILY = "CXSeagal, system-ui,-apple-system,Segoe UI,Roboto,Arial";
const FONT_WEIGHT = "600";

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

function mountFlow(id) {
  const root = document.getElementById(id);
  if (!root) return;

  // Flowchart SVG (stile “glass”, coerente con UI)
  const w = 980, h = 360;
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "auto" });

  const nodes = [
    { x: 60,  y: 70,  t: "Home (Index)" },
    { x: 340, y: 70,  t: "Keychain Atlas (Sandbox)" },
    { x: 640, y: 70,  t: "Filtri attivi" },
    { x: 640, y: 220, t: "Griglia + Fit camera" },
    { x: 340, y: 220, t: "Product View" },
  ];

  function node(n) {
    const g = el("g");
    g.appendChild(el("rect", {
      x: n.x, y: n.y, width: 260, height: 74, rx: 18, ry: 18,
      fill: "rgba(255,255,255,0.06)",
      stroke: "rgba(255,255,255,0.10)"
    }));
    g.appendChild(el("text", {
      x: n.x + 18, y: n.y + 44,
      fill: "rgba(255,255,255,0.86)",
      "font-family": FONT_FAMILY,
      "font-size": "16",
      "font-weight": FONT_WEIGHT
    }, [n.t]));
    return g;
  }

  function arrow(x1,y1,x2,y2) {
    const p = el("path", {
      d: `M ${x1} ${y1} C ${x1+80} ${y1}, ${x2-80} ${y2}, ${x2} ${y2}`,
      fill: "none",
      stroke: "rgba(255,255,255,0.22)",
      "stroke-width": "2.2"
    });
    return p;
  }

  // arrows
  svg.appendChild(arrow(320, 107, 340, 107)); // home -> atlas
  svg.appendChild(arrow(600, 107, 640, 107)); // atlas -> filtri
  svg.appendChild(arrow(770, 144, 770, 220)); // filtri -> griglia
  svg.appendChild(arrow(640, 257, 600, 257)); // griglia -> product view

  // nodes
  for (const n of nodes) svg.appendChild(node(n));

  root.innerHTML = "";
  root.appendChild(svg);
}

function mountMiniChart(id, kind) {
  const root = document.getElementById(id);
  if (!root) return;

  // mini chart “didattico”: non è data-driven, è una visualizzazione del flusso
  const w = 460, h = 160;
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "auto" });

  svg.appendChild(el("rect", {
    x: 0, y: 0, width: w, height: h, rx: 18, ry: 18,
    fill: "rgba(255,255,255,0.04)",
    stroke: "rgba(255,255,255,0.08)"
  }));

  if (kind === "filter") {
    // 3 step blocks
    const steps = ["Selezione", "Raggruppamento", "Allineamento"];
    steps.forEach((t,i)=>{
      const x = 22 + i*148;
      svg.appendChild(el("rect", {
        x, y: 38, width: 126, height: 56, rx: 14, ry: 14,
        fill: "rgba(255,255,255,0.06)",
        stroke: "rgba(255,255,255,0.10)"
      }));
      svg.appendChild(el("text", {
        x: x+14, y: 72,
        fill: "rgba(255,255,255,0.78)",
        "font-family": FONT_FAMILY,
        "font-size": "14",
        "font-weight": FONT_WEIGHT
      }, [t]));
    });
  }

  if (kind === "zoom") {
    // axis + 3 “levels”
    svg.appendChild(el("line", { x1: 28, y1: 120, x2: 430, y2: 120, stroke: "rgba(255,255,255,0.18)", "stroke-width": "2" }));
    const lv = [
      { x: 70,  y: 120, t: "Immagini" },
      { x: 210, y: 92,  t: "Tag" },
      { x: 350, y: 64,  t: "Specs" },
    ];
    lv.forEach(p=>{
      svg.appendChild(el("circle", { cx: p.x, cy: p.y, r: 6, fill: "rgba(255,255,255,0.42)" }));
      svg.appendChild(el("text", {
        x: p.x-18, y: p.y-14,
        fill: "rgba(255,255,255,0.76)",
        "font-family": FONT_FAMILY,
        "font-size": "13",
        "font-weight": FONT_WEIGHT
      }, [p.t]));
    });
    svg.appendChild(el("path", { d: "M 70 120 L 210 92 L 350 64", fill:"none", stroke:"rgba(255,255,255,0.24)", "stroke-width":"2.2" }));
  }

  root.innerHTML = "";
  root.appendChild(svg);
}

window.addEventListener("DOMContentLoaded", ()=>{
  mountFlow("flowMount");
  mountMiniChart("chartFilterMount", "filter");
  mountMiniChart("chartZoomMount", "zoom");
});