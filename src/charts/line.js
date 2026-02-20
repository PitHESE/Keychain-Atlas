// src/charts/line.js
"use strict";

const NS = "http://www.w3.org/2000/svg";

const SVG_FONT = "CXSeagal, system-ui, -apple-system, Segoe UI, Roboto, Arial";

const el = (name) => document.createElementNS(NS, name);

function attr(node, attrs){
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function viewBoxToElement(svg, minW = 560, minH = 260){
  const b = svg.getBoundingClientRect();
  const W = Math.max(minW, Math.floor(b.width || minW));
  const H = Math.max(minH, Math.floor(b.height || minH));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return { W, H };
}

function t(x, y, text, { size = 12, fill = "rgba(255,255,255,.70)", weight = "600", caps = false, anchor = "start", tracking = null } = {}){
  const node = el("text");
  attr(node, {
    x,
    y,
    fill,
    "font-size": size,
    "font-family": SVG_FONT,
    "font-weight": weight,
    "text-anchor": anchor,
    "letter-spacing": tracking ?? (caps ? ".14em" : "0"),
    style: "font-variant-numeric: tabular-nums;"
  });
  node.textContent = caps ? String(text).toUpperCase() : String(text);
  return node;
}

function ln(x1, y1, x2, y2, stroke, sw = 1){
  return attr(el("line"), { x1, y1, x2, y2, stroke, "stroke-width": sw });
}

function rct(x, y, w, h, fill, stroke, rx = 14){
  return attr(el("rect"), {
    x,
    y,
    width: w,
    height: h,
    rx,
    ry: rx,
    fill,
    stroke,
    "stroke-width": 1
  });
}

function pth(d, stroke, sw = 2.2){
  return attr(el("path"), {
    d,
    fill: "none",
    stroke,
    "stroke-width": sw,
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });
}

function circ(cx, cy, radius, fill, stroke){
  return attr(el("circle"), { cx, cy, r: radius, fill, stroke, "stroke-width": 1 });
}

function niceCeil(v){
  if (!isFinite(v) || v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

function fmtTick(v){
  const a = Math.abs(v);
  if (a >= 10) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

function sanitizePoints(points){
  if (!Array.isArray(points)) return [];
  return points.filter(p => p && isFinite(p.x) && isFinite(p.y));
}

function yDomainFrom(points, opts){
  const ys = points.map(p => p.y);
  const rawMin = Math.min(...ys);
  const rawMax = Math.max(...ys);

  let yMin = Math.min(0, rawMin);
  let yMax = niceCeil(rawMax);

  if (opts?.fixedY){
    const oMin = Number.isFinite(opts.yMin) ? Number(opts.yMin) : 0;
    const oMax = Number.isFinite(opts.yMax) ? Number(opts.yMax) : yMax;
    yMin = oMin;
    yMax = oMax;
  }

  if (!isFinite(yMin)) yMin = 0;
  if (!isFinite(yMax)) yMax = 1;
  if (yMax <= yMin) yMax = yMin + 1;

  return { yMin, yMax };
}

function buildPath(points, sx, sy){
  let d = "";
  for (let i = 0; i < points.length; i++){
    const p = points[i];
    const x = sx(p.x);
    const y = sy(p.y);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

/**
 * drawLineChart(svgEl, points, opts)
 * - points: [{x:number, y:number}]
 * - opts.fixedY + yMin/yMax (es. 0..111) blocca la scala per evitare “salti” al cambio parametro.
 */
export function drawLineChart(svg, points, opts = {}){
  if (!svg) return;

  const P = sanitizePoints(points).slice().sort((a, b) => a.x - b.x);
  svg.innerHTML = "";

  const { W, H } = viewBoxToElement(svg, 560, 260);
  const pad = 22;

  const title = opts.title ?? "encoding: line";
  const metaLine = opts.subtitle || opts.yLabel || "";
  const headerH = metaLine ? 52 : 34;

  // Soft panel (match other charts)
  svg.appendChild(rct(pad - 8, pad - 8, W - (pad - 8) * 2, H - (pad - 8) * 2, "rgba(255,255,255,.02)", "rgba(255,255,255,.08)", 14));
  svg.appendChild(t(pad, pad + 14, title, { size: 12, fill: "rgba(255,255,255,.70)", caps: true }));
  if (metaLine) svg.appendChild(t(pad, pad + 34, metaLine, { size: 12, fill: "rgba(255,255,255,.55)" }));

  const axisPadL = 40;
  const plotX = pad + axisPadL;
  const plotY = pad + headerH;
  const plotW = W - pad * 2 - axisPadL;
  const plotH = H - plotY - pad;

  if (!P.length){
    svg.appendChild(t(pad, plotY + 24, "no data", { size: 12, fill: "rgba(255,255,255,.55)" }));
    return;
  }

  const xs = P.map(p => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);

  const { yMin, yMax } = yDomainFrom(P, opts);

  const denomX = Math.max(1e-9, (xMax - xMin));
  const denomY = Math.max(1e-9, (yMax - yMin));

  const sx = (x) => plotX + (x - xMin) * (plotW / denomX);
  const sy = (y) => plotY + plotH - (y - yMin) * (plotH / denomY);

  // Grid + ticks
  const gridN = 4;
  for (let i = 0; i <= gridN; i++){
    const tt = i / gridN;
    const y = plotY + tt * plotH;
    svg.appendChild(ln(plotX, y, plotX + plotW, y, "rgba(255,255,255,.06)", 1));

    const v = yMax - tt * (yMax - yMin);
    svg.appendChild(t(plotX - 10, y + 4, fmtTick(v), { size: 11, fill: "rgba(255,255,255,.45)", anchor: "end" }));
  }

  svg.appendChild(ln(plotX, plotY + plotH, plotX + plotW, plotY + plotH, "rgba(255,255,255,.10)", 1));

  const d = buildPath(P, sx, sy);

  // Underfill
  const first = P[0];
  const last = P[P.length - 1];
  const dFill = `${d} L ${sx(last.x)} ${plotY + plotH} L ${sx(first.x)} ${plotY + plotH} Z`;
  svg.appendChild(attr(el("path"), { d: dFill, fill: "rgba(255,255,255,.06)", stroke: "none" }));

  // Stroke
  svg.appendChild(pth(d, "rgba(255,255,255,.35)", 2.2));

  // Dots (keep it light)
  const maxDots = 14;
  const step = Math.max(1, Math.floor(P.length / maxDots));
  for (let i = 0; i < P.length; i += step){
    const pt = P[i];
    svg.appendChild(circ(sx(pt.x), sy(pt.y), 3.2, "rgba(255,255,255,.75)", "rgba(0,0,0,.35)"));
  }

  if (opts.xLabel){
    svg.appendChild(t(plotX + plotW, plotY + plotH + 18, opts.xLabel, { size: 11, fill: "rgba(255,255,255,.45)", anchor: "end" }));
  }
}

// Auto-mount for quick testing (optional)
function autoMount(){
  const svg = document.querySelector('svg[data-chart="line"]');
  if (!svg) return;
  const points = window.LINE_CHART_POINTS;
  if (!Array.isArray(points)) return;
  drawLineChart(svg, points, {
    title: "encoding: line",
    subtitle: "(auto-mount)",
    xLabel: "x",
    yLabel: "y"
  });
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", autoMount);
} else {
  autoMount();
}