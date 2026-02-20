// src/pages.js
"use strict";

import { csvToObjects } from "./utils.js";

const CSV_URL = "./data.csv";
const IMAGES_ROOT = "./images/";

const LINE_Y_MIN = 0;
const LINE_Y_MAX = 111;

const PARAMS = [
  { key: "Tipologia", label: "Tipologia" },
  { key: "Materiale principale", label: "Materiale", aliases: ["Materiale"] },
  { key: "Colore principale", label: "Colore", aliases: ["Colore"] },
  { key: "Condizioni", label: "Condizioni" },
  { key: "Tipo di anello", label: "Tipo di anello", aliases: ["Anello", "Tipo anello"] },
  { key: "Chiavi", label: "Chiavi" },
];

const $ = (id) => document.getElementById(id);

const btnParam = $("btnParam");
const ddParam = $("ddParam");
const ddHint = $("ddHint");
const ddList = $("ddList");

const gridPane = $("gridPane");
const gridRoot = $("gridRoot");

const schemaTitle = $("schemaTitle");
const schemaMeta = $("schemaMeta");
const schemaSvg = $("schemaSvg");
const schemaNote = $("schemaNote");
const insightsList = $("insightsList");

const lineHost = $("lineSvg");

let rows = [];
let activeParam = PARAMS[0];
let lockedGroupCols = 1;
let animateNext = false;

let lastDetail = null;
let lineMod = null;
let resizeRAF = 0;

function norm(v) {
  return String(v ?? "").trim();
}

function getField(row, key, aliases = []) {
  if (row[key] != null && norm(row[key]) !== "") return norm(row[key]);
  for (const a of aliases) if (row[a] != null && norm(row[a]) !== "") return norm(row[a]);

  const low = key.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === low && norm(row[k]) !== "") return norm(row[k]);

  for (const a of aliases) {
    const al = a.toLowerCase();
    for (const k of Object.keys(row)) if (k.toLowerCase() === al && norm(row[k]) !== "") return norm(row[k]);
  }

  return "";
}

function getGroupValue(row, param) {
  const v = getField(row, param.key, param.aliases || []);
  return v || "—";
}

function getImageUrl(row) {
  const tries = [
    "Immagine",
    "Image",
    "IMG",
    "img",
    "file",
    "File",
    "filename",
    "Filename",
    "Path",
    "path",
    "URL",
    "url",
    "Foto",
    "foto",
  ];

  let raw = "";
  for (const k of tries) {
    if (row[k] && norm(row[k])) {
      raw = norm(row[k]);
      break;
    }
  }
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("./")) return raw;
  if (raw.startsWith("/")) return raw;
  if (raw.includes("images/")) return raw;

  return IMAGES_ROOT + raw;
}

function groupRows(param) {
  const map = new Map();
  for (const r of rows) {
    const g = getGroupValue(r, param);
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(r);
  }

  const out = Array.from(map.entries()).map(([k, arr]) => ({ k, arr }));
  out.sort((a, b) => {
    if (b.arr.length !== a.arr.length) return b.arr.length - a.arr.length;
    return a.k.localeCompare(b.k, "it");
  });
  return out;
}

function computeMaxGroups() {
  let max = 1;
  for (const p of PARAMS) max = Math.max(max, groupRows(p).length);
  return max;
}

function chip(text) {
  const d = document.createElement("div");
  d.className = "chip";
  d.textContent = text;
  return d;
}

function supportText(groups, total) {
  const nGroups = groups.length;
  const top = groups[0];
  const topLabel = top ? top.k : "—";
  const topCount = top ? top.arr.length : 0;
  const pct = total ? Math.round((topCount / total) * 100) : 0;

  return (
    `In questo momento la collezione è letta attraverso “${activeParam.label}”. ` +
    `Emergono ${nGroups} gruppi: il più ricorrente è “${topLabel}”, con ${topCount} elementi (${pct}%). ` +
    `Le barre mostrano i gruppi principali ordinati per frequenza.`
  );
}

function applySupportText(text) {
  if (schemaNote) {
    schemaNote.textContent = text;
    schemaNote.classList.add("ilead");
  }
  if (insightsList) {
    insightsList.innerHTML = "";
    insightsList.classList.add("ilead");
    const p = document.createElement("p");
    p.textContent = text;
    p.style.margin = "0";
    insightsList.appendChild(p);
  }
}

function positionParamButton() {
  if (!btnParam) return;
  const rootStyle = getComputedStyle(document.documentElement);
  const pad = parseFloat(rootStyle.getPropertyValue("--pad")) || 18;
  const splitX = Math.round(window.innerWidth * 0.5);

  btnParam.style.position = "fixed";
  btnParam.style.left = `${splitX + pad}px`;
  btnParam.style.right = "auto";
  btnParam.style.zIndex = "50";
  btnParam.style.pointerEvents = "auto";
}

function setupMosaicLayout() {
  if (!gridPane || !gridRoot) return;

  gridPane.style.overflowX = "hidden";
  gridPane.style.overflowY = "auto";

  gridRoot.style.display = "grid";
  gridRoot.style.gridAutoFlow = "column";
  gridRoot.style.gridTemplateColumns = `repeat(${lockedGroupCols}, minmax(0, 1fr))`;
  gridRoot.style.alignItems = "start";
  gridRoot.style.gap = "12px";
  gridRoot.style.padding = "14px";
  gridRoot.style.width = "100%";
  gridRoot.style.boxSizing = "border-box";
}

function renderMosaic(groups) {
  if (!gridRoot) return;
  setupMosaicLayout();

  gridRoot.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const g of groups) {
    const col = document.createElement("div");
    col.className = "imgGroupCol";
    col.style.display = "flex";
    col.style.flexDirection = "column";
    col.style.gap = "10px";
    col.style.minWidth = "0";

    for (const r of g.arr) {
      const tile = document.createElement("div");
      tile.className = "thumb";
      tile.style.width = "100%";
      tile.style.aspectRatio = "1 / 1";
      tile.style.borderRadius = "14px";
      tile.style.overflow = "hidden";
      tile.style.border = "0";
      tile.style.background = "rgba(255,255,255,.04)";
      tile.style.flex = "0 0 auto";

      const url = getImageUrl(r);
      if (url) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = "";
        img.src = url;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.display = "block";
        img.onerror = () => {
          img.remove();
          tile.style.background = "rgba(255,255,255,.06)";
        };
        tile.appendChild(img);
      }

      col.appendChild(tile);
    }

    frag.appendChild(col);
  }

  gridRoot.appendChild(frag);
}

function autoSvgBox(svg, minW = 560, minH = 260) {
  const b = svg.getBoundingClientRect();
  const W = Math.max(minW, Math.floor(b.width || minW));
  const H = Math.max(minH, Math.floor(b.height || minH));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return { W, H };
}

function ellipsizeByPx(str, px, fontSize = 16) {
  const s = String(str ?? "");
  const pxPerChar = Math.max(6.0, fontSize * 0.56);
  const maxChars = Math.max(4, Math.floor(px / pxPerChar));
  return s.length <= maxChars ? s : s.slice(0, Math.max(1, maxChars - 1)) + "…";
}

function rect(x, y, w, h, fill, stroke) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  el.setAttribute("x", x);
  el.setAttribute("y", y);
  el.setAttribute("width", w);
  el.setAttribute("height", h);
  el.setAttribute("rx", 6);
  el.setAttribute("ry", 6);
  el.setAttribute("fill", fill);
  el.setAttribute("stroke", stroke);
  el.setAttribute("stroke-width", "1");
  return el;
}

function line(x1, y1, x2, y2, stroke) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
  el.setAttribute("x1", x1);
  el.setAttribute("y1", y1);
  el.setAttribute("x2", x2);
  el.setAttribute("y2", y2);
  el.setAttribute("stroke", stroke);
  el.setAttribute("stroke-width", "1");
  return el;
}

function textEl(x, y, txt, size, color, isCaps = false, anchor = "start") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const fw = isCaps ? 600 : 400;
  const ls = isCaps ? "0.04em" : "0";

  el.setAttribute("x", x);
  el.setAttribute("y", y);
  el.setAttribute("fill", color);
  el.setAttribute("font-family", "CXSeagal");
  el.setAttribute("font-size", String(size));
  el.setAttribute("font-weight", String(fw));
  el.setAttribute("letter-spacing", ls);
  el.setAttribute("text-anchor", anchor);
  el.setAttribute("style", `font-variant-numeric: tabular-nums; font-synthesis: none;`);
  el.textContent = isCaps ? String(txt).toUpperCase() : String(txt);
  return el;
}

function drawBars(svg, groups, animate = false) {
  const { W, H } = autoSvgBox(svg, 560, 260);

  const pad = 22;
  const FONT = 16;
  const headerH = 34;

  const MAX = Math.min(12, groups.length);
  const top = groups.slice(0, MAX);
  const max = Math.max(1, ...top.map((g) => g.arr.length));

  const baseRowH = Math.round(FONT * 1.34) + 2;
  const gap = 4;
  const listTop = pad + headerH + 12;

  const labelW = Math.max(160, Math.min(240, Math.floor(W * 0.3)));
  const valueW = 52;
  const trackX = pad + labelW + 14;
  const valueX = W - pad;
  const trackW = Math.max(80, valueX - trackX - valueW);

  svg.innerHTML = "";
  svg.appendChild(rect(pad - 8, pad - 8, W - (pad - 8) * 2, H - (pad - 8) * 2, "rgba(255,255,255,.02)", "rgba(255,255,255,.08)"));
  svg.appendChild(textEl(pad, pad + 18, "distribuzione: gruppi principali", FONT, "rgba(255,255,255,.70)", true));
  svg.appendChild(line(pad, listTop - 10, W - pad, listTop - 10, "rgba(255,255,255,.08)"));

  const anim = [];

  top.forEach((g, i) => {
    const y = listTop + i * (baseRowH + gap);

    const count = g.arr.length;
    const t = count / max;
    const fillW = Math.max(2, Math.floor(trackW * t));

    const lbl = ellipsizeByPx(g.k, labelW, FONT);
    svg.appendChild(textEl(pad, y + baseRowH - 8, lbl, FONT, "rgba(255,255,255,.78)", false, "start"));

    const trackY = y + 6;
    const trackH = Math.max(10, baseRowH - 12);
    svg.appendChild(rect(trackX, trackY, trackW, trackH, "rgba(255,255,255,.05)", "rgba(255,255,255,.10)"));

    const fillEl = rect(trackX, trackY, animate ? 0 : fillW, trackH, "rgba(255,255,255,.18)", "rgba(255,255,255,.12)");
    svg.appendChild(fillEl);

    const valEl = textEl(valueX, y + baseRowH - 8, animate ? "0" : String(count), FONT, "rgba(255,255,255,.90)", false, "end");
    svg.appendChild(valEl);

    anim.push({ fillEl, valEl, fillW, count, i });
  });

  if (!animate || !anim.length) return;

  const t0 = performance.now();
  const dur = 560;
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);

    for (const it of anim) {
      const lag = it.i * 0.04;
      const pp = Math.max(0, Math.min(1, (p - lag) / (1 - lag)));
      const e = easeOut(pp);
      it.fillEl.setAttribute("width", String(Math.round(it.fillW * e)));
      it.valEl.textContent = String(Math.round(it.count * e));
    }

    if (p < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

async function ensureLineModule() {
  if (lineMod) return lineMod;
  try {
    lineMod = await import("./charts/line.js");
  } catch (_) {
    lineMod = null;
  }
  return lineMod;
}

function lockChartBox(host) {
  if (!host) return;
  host.style.position = host.style.position || "relative";
  host.style.overflow = "hidden";

  const svg = host.querySelector("svg");
  if (!svg) return;

  const currentVB = svg.getAttribute("viewBox");
  if (!host.__lockedViewBox) {
    if (currentVB) host.__lockedViewBox = currentVB;
    else {
      const w = host.clientWidth || 560;
      const h = host.clientHeight || 260;
      host.__lockedViewBox = `0 0 ${Math.round(w)} ${Math.round(h)}`;
    }
  }

  svg.setAttribute("viewBox", host.__lockedViewBox);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.maxWidth = "none";
  svg.style.display = "block";
}

function toLinePoints(detail) {
  const groups = detail?.groups || [];
  return groups.map((g, i) => ({ x: i, y: Number(g.count) || 0, label: String(g.label ?? "") }));
}

function animateLine(host, mod, pts, opts) {
  const token = (host.__lineAnimToken = (host.__lineAnimToken || 0) + 1);
  const t0 = performance.now();
  const dur = 600;
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  const base = pts.map((p) => ({ ...p, y: 0 }));

  let last = 0;
  function draw(cur) {
    host.innerHTML = "";
    mod.drawLineChart(host, cur, opts);
    lockChartBox(host);
  }

  draw(base);

  function tick(now) {
    if (host.__lineAnimToken !== token) return;
    const p = Math.min(1, (now - t0) / dur);

    if (now - last >= 33 || p >= 1) {
      last = now;
      const e = easeOut(p);
      draw(pts.map((pt) => ({ ...pt, y: (Number(pt.y) || 0) * e })));
    }

    if (p < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

async function renderLine(detail) {
  if (!lineHost) return;
  const mod = await ensureLineModule();
  if (!mod || typeof mod.drawLineChart !== "function") return;

  const pts = toLinePoints(detail);
  const opts = {
    title: "",
    subtitle: "",
    xLabel: "",
    yLabel: "",
    yMin: LINE_Y_MIN,
    yMax: LINE_Y_MAX,
    fixedY: true,
  };

  if (detail?.animate) animateLine(lineHost, mod, pts, opts);
  else {
    lineHost.innerHTML = "";
    mod.drawLineChart(lineHost, pts, opts);
    lockChartBox(lineHost);
  }
}

function render() {
  positionParamButton();
  if (btnParam) btnParam.textContent = `Parametro: ${activeParam.label}`;

  const groups = groupRows(activeParam);
  const total = rows.length;

  if (schemaTitle) schemaTitle.textContent = activeParam.label;
  if (schemaMeta) {
    schemaMeta.innerHTML = "";
    schemaMeta.appendChild(chip(`${total} elementi`));
    schemaMeta.appendChild(chip(`${groups.length} gruppi`));
  }

  applySupportText(supportText(groups, total));
  renderMosaic(groups);

  if (schemaSvg) drawBars(schemaSvg, groups, animateNext);

  const detail = {
    param: { key: activeParam.key, label: activeParam.label },
    total,
    groups: groups.map((g) => ({ label: g.k, count: g.arr.length })),
    animate: !!animateNext,
  };

  lastDetail = detail;
  window.PAGES = window.PAGES || {};
  window.PAGES.getSchemaData = () => lastDetail;
  window.dispatchEvent(new CustomEvent("PAGES_SCHEMA_UPDATE", { detail }));

  animateNext = false;
  void renderLine(detail);
}

function openParamDropdown() {
  if (!ddParam || !btnParam) return;

  ddParam.classList.add("open");
  ddParam.setAttribute("aria-hidden", "false");
  btnParam.classList.add("active");

  if (ddHint) ddHint.textContent = `Attivo: ${activeParam.label}`;
  if (ddList) ddList.innerHTML = "";

  PARAMS.forEach((p) => {
    const it = document.createElement("div");
    it.className = "ddItem" + (p.key === activeParam.key ? " active" : "");
    it.innerHTML = `<span>${p.label}</span><span class="count"></span>`;
    it.addEventListener("click", () => {
      activeParam = p;
      animateNext = true;
      closeParamDropdown();
      render();
    });
    ddList?.appendChild(it);
  });

  const rootStyle = getComputedStyle(document.documentElement);
  const pad = parseFloat(rootStyle.getPropertyValue("--pad")) || 18;
  const br = btnParam.getBoundingClientRect();

  requestAnimationFrame(() => {
    const ddW = ddParam.offsetWidth || 260;
    const left = Math.max(pad, Math.min(Math.round(br.left), window.innerWidth - ddW - pad));
    const top = Math.round(br.bottom + 10);
    ddParam.style.left = `${left}px`;
    ddParam.style.top = `${top}px`;
  });
}

function closeParamDropdown() {
  if (!ddParam || !btnParam) return;
  ddParam.classList.remove("open");
  ddParam.setAttribute("aria-hidden", "true");
  btnParam.classList.remove("active");
}

function toggleParamDropdown() {
  if (!ddParam) return;
  ddParam.classList.contains("open") ? closeParamDropdown() : openParamDropdown();
}

btnParam?.addEventListener("click", toggleParamDropdown);

window.addEventListener("mousedown", (e) => {
  if (!ddParam?.classList.contains("open")) return;
  if (ddParam.contains(e.target)) return;
  if (btnParam?.contains(e.target)) return;
  closeParamDropdown();
});

window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => {
    positionParamButton();
    setupMosaicLayout();
    render();
  });
});

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    if (gridRoot) gridRoot.innerHTML = `<div style="opacity:.7">Errore CSV: HTTP ${res.status}</div>`;
    return;
  }

  const text = await res.text();
  rows = csvToObjects(text).filter((r) => r && typeof r === "object");

  lockedGroupCols = computeMaxGroups();
  setupMosaicLayout();

  render();
  try {
    await ensureLineModule();
  } catch (_) {}
}

main();