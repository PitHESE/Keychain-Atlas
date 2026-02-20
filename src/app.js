// src/app.js
"use strict";

import { csvToObjects, applyFilters, countsForLevelFromBase } from "./utils.js";
import { Gallery } from "./gallery.js";
import { NodesOverlay } from "./nodesOverlay.js";
import { ProductView } from "./productView.js";

const EMBED = new URLSearchParams(location.search).has("embed");

const LEVELS = [
  { key:"Tipologia",            label:"Tipologia" },
  { key:"Materiale principale", label:"Materiale", aliases:["Materiale"] },
  { key:"Colore principale",    label:"Colore" },
  { key:"Condizioni",           label:"Condizioni", aliases:["Condizoni"] },
  { key:"Tipo di anello",       label:"Tipo di anello" },
  { key:"Chiavi",               label:"Chiavi" },
];

const CSV_URL = "./data.csv";

const filtersEl    = document.getElementById("filters");
const dropdownEl   = document.getElementById("dropdown");
const ddTitleEl    = document.getElementById("ddTitle");
const ddHintEl     = document.getElementById("ddHint");
const ddListEl     = document.getElementById("ddList");
const crumbEl      = document.getElementById("crumb");
const btnBack      = document.getElementById("btnBack");
const btnClear     = document.getElementById("btnClear");
const btnAbout     = document.getElementById("btnAbout");
const btnViewMode  = document.getElementById("btnViewMode");
const aboutOverlay = document.getElementById("aboutOverlay");
const aboutClose   = document.getElementById("aClose");
const brandHome    = document.getElementById("brandHome");

const landingEl          = document.getElementById("landing");
const landingPctEl       = document.getElementById("landingPct");
const landingBarFillEl   = document.getElementById("landingBarFill");

const cBG   = document.getElementById("cBG");
const cUI   = document.getElementById("cUI");
const ctxBG = cBG.getContext("2d", { alpha:false });
const ctxUI = cUI.getContext("2d", { alpha:true });

let DPR = 1, W = 0, H = 0;

let rows = [];
let filtered = [];
let selection = Array(LEVELS.length).fill(null);
let selectionOrder = [];
let activeLevel = 0;
let dropdownOpen = false;

let viewMode = "sandbox"; // "sandbox" | "peso"

const gallery = new Gallery(cBG);
gallery.setSpecLevels(LEVELS);

const nodesOverlay = new NodesOverlay(LEVELS);
const productView = new ProductView(LEVELS);

productView.onOpen  = ()=> { gallery.interactionsEnabled = false; };
productView.onClose = ()=> { gallery.interactionsEnabled = true; };

productView.onPickSpec = ({ li, value }) => {
  productView.close();

  selection = Array(LEVELS.length).fill(null);
  selectionOrder = [];

  selection[li] = value;
  selectionOrder.push(li);

  applyAll();
  closeDropdown();
  renderTopButtons();

  const next = Math.min(li + 1, LEVELS.length - 1);
  if (next !== li && filtered.length > 0) openDropdown(next);
};

gallery.onRequestPick = (row, originRect)=> productView.open(row, originRect);

let booted = false;
let toolActivated = !EMBED;
let pendingActivate = false;

// safe-area originale (da ripristinare quando “entri” nel tool)
const SAFE_DEFAULT = { top: gallery.safeTop, bottom: gallery.safeBottom, side: gallery.safeSide };

function activateFromIndex(){
  if (!booted) { pendingActivate = true; return; }

  toolActivated = true;
  document.body.classList.remove("embed");

  if (landingEl) landingEl.remove();
  document.body.classList.remove("landing-on");

  gallery.safeTop = SAFE_DEFAULT.top;
  gallery.safeBottom = SAFE_DEFAULT.bottom;
  gallery.safeSide = SAFE_DEFAULT.side;

  gallery.interactionsEnabled = true;

  if (aboutOverlay?.classList.contains("open")) closeAbout();
  if (productView?.isOpen) productView.close();

  closeDropdown();
  applyAll();
  renderTopButtons();

  gallery.resetView();
}

function deactivateToEmbed(){
  toolActivated = false;

  // torna embed-mode (CSS nasconde topbar/dropdown/crumb)
  document.body.classList.add("embed");

  // chiudi overlay
  closeDropdown();
  if (aboutOverlay?.classList.contains("open")) closeAbout();
  if (productView?.isOpen) productView.close();

  // reset filtri e vista
  selection = Array(LEVELS.length).fill(null);
  selectionOrder = [];
  viewMode = "sandbox";
  if (btnViewMode) btnViewMode.textContent = viewMode;

  // full-bleed come sfondo index
  gallery.safeTop = 0;
  gallery.safeBottom = 0;
  gallery.safeSide = 0;

  gallery.interactionsEnabled = false;

  applyAll();
  gallery.resetView();
}

// esporta API per index.html (UNA SOLA VOLTA, coerente)
window.ATLAS_TOOL = window.ATLAS_TOOL || {};
window.ATLAS_TOOL.activate = activateFromIndex;
window.ATLAS_TOOL.deactivate = deactivateToEmbed;

function resize(){
  DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  W = window.innerWidth;
  H = window.innerHeight;

  cBG.width  = Math.floor(W * DPR);
  cBG.height = Math.floor(H * DPR);
  cBG.style.width  = W + "px";
  cBG.style.height = H + "px";
  ctxBG.setTransform(DPR,0,0,DPR,0,0);

  cUI.width  = Math.floor(W * DPR);
  cUI.height = Math.floor(H * DPR);
  cUI.style.width  = W + "px";
  cUI.style.height = H + "px";
  ctxUI.setTransform(DPR,0,0,DPR,0,0);

  gallery.setViewport(W, H);
  if (dropdownOpen) positionDropdown(activeLevel);
}
window.addEventListener("resize", resize);

function hasAnySelection(){ return selection.some(v => v != null); }

function countsForDropdown(li){
  const sel = selection.slice();
  sel[li] = null;
  const base = applyFilters(rows, sel, LEVELS);
  return countsForLevelFromBase(base, li, LEVELS);
}

function applyAll(){
  filtered = applyFilters(rows, selection, LEVELS);

  if (viewMode === "peso") {
    gallery.setMode("weight");
    gallery.setFilteredRows(filtered);
  } else {
    if (hasAnySelection()) {
      gallery.setMode("grid");
      gallery.setFilteredRows(filtered);
    } else {
      gallery.setMode("float");
    }
  }

  productView.setContext({
    filtered: hasAnySelection() ? filtered : rows,
    selection
  });

  if (typeof nodesOverlay.setState === "function") {
    nodesOverlay.setState({
      levels: LEVELS,
      selection,
      filteredCount: hasAnySelection() ? filtered.length : rows.length
    });
  }

  updateCrumb();
  renderTopButtons();
}

function openDropdown(li){
  activeLevel = li;
  dropdownOpen = true;
  dropdownEl.classList.add("open");
  positionDropdown(li);

  ddTitleEl.textContent = LEVELS[li].label;
  ddHintEl.textContent = selection[li] ? `Selezionato: ${selection[li]}` : "Seleziona un valore";

  const list = countsForDropdown(li);
  ddListEl.innerHTML = "";

  for (const it of list){
    const rowEl = document.createElement("div");
    rowEl.className = "ddItem" + (selection[li] === it.label ? " active" : "");
    rowEl.innerHTML = `<span>${escapeHtml(it.label)}</span><span class="count">${it.count}</span>`;
    rowEl.addEventListener("click", ()=> choose(li, it.label));
    ddListEl.appendChild(rowEl);
  }

  if (!list.length){
    const empty = document.createElement("div");
    empty.className = "ddItem";
    empty.style.opacity = "0.7";
    empty.textContent = "Nessun valore disponibile (filtri troppo stretti).";
    ddListEl.appendChild(empty);
  }

  requestAnimationFrame(() => {
    positionDropdown(li);

    const head = dropdownEl.querySelector(".ddHead");
    const headH = head ? head.getBoundingClientRect().height : 44;

    const rect = dropdownEl.getBoundingClientRect();
    const top = rect.top;

    const maxPanelH = Math.min(560, window.innerHeight - top - 16);
    const listH = ddListEl.scrollHeight;

    const wanted = headH + listH;
    const finalH = Math.max(140, Math.min(wanted, maxPanelH));

    dropdownEl.style.height = `${finalH}px`;
    ddListEl.style.maxHeight = `${Math.max(80, finalH - headH)}px`;
  });
}

function closeDropdown(){
  dropdownOpen = false;
  dropdownEl.classList.remove("open");
  dropdownEl.style.height = "";
  ddListEl.style.maxHeight = "";
}

function choose(li, value){
  selection[li] = value;
  selectionOrder = selectionOrder.filter(x => x !== li);
  selectionOrder.push(li);

  applyAll();
  closeDropdown();
  renderTopButtons();
}

function clearSingleFilter(li){
  selection[li] = null;
  selectionOrder = selectionOrder.filter(v => v !== li);
  applyAll();
  if (dropdownOpen && activeLevel === li) openDropdown(li);
  else renderTopButtons();
}

function stepBack(){
  if (!selectionOrder.length) return;
  const li = selectionOrder.pop();
  selection[li] = null;
  applyAll();
  openDropdown(li);
  renderTopButtons();
}

function clearAll(){
  selection = Array(LEVELS.length).fill(null);
  selectionOrder = [];
  applyAll();
  closeDropdown();
  renderTopButtons();
}

function buildTopButtons(){
  filtersEl.innerHTML = "";
  LEVELS.forEach((lvl, li)=>{
    const wrap = document.createElement("div");
    wrap.className = "fwrap";

    const b = document.createElement("button");
    b.className = "fbtn";
    b.type = "button";
    b.innerHTML = `
      <span class="flabel">${escapeHtml(lvl.label)}</span>
      <span class="fx" aria-hidden="true">×</span>
    `;

    b.addEventListener("click", (ev)=>{
      if (ev.target?.classList?.contains("fx")) {
        ev.preventDefault();
        ev.stopPropagation();
        clearSingleFilter(li);
        return;
      }
      if (dropdownOpen && activeLevel === li) closeDropdown();
      else openDropdown(li);
      renderTopButtons();
    });

    wrap.appendChild(b);
    filtersEl.appendChild(wrap);
  });
}

function renderTopButtons(){
  const wraps = filtersEl.querySelectorAll(".fwrap");
  wraps.forEach((wrap, i)=>{
    const b = wrap.querySelector(".fbtn");
    const isSelected = !!selection[i];
    b.classList.toggle("active", dropdownOpen && i === activeLevel);
    b.classList.toggle("selected", isSelected);
  });
}

function updateCrumb(){
  if (!crumbEl) return;

  const parts = [];
  for (const li of selectionOrder){
    const v = selection[li];
    if (!v) continue;
    parts.push(`${LEVELS[li].label}: ${v}`);
  }
  for (let i=0; i<LEVELS.length; i++){
    if (!selection[i]) continue;
    if (selectionOrder.includes(i)) continue;
    parts.push(`${LEVELS[i].label}: ${selection[i]}`);
  }

  const path = parts.length ? parts.join("  ·  ") : "Nessun filtro attivo (vista globale).";
  const currentList = hasAnySelection() ? filtered : rows;
  crumbEl.innerHTML = `<b>${path}</b>\nRighe: ${currentList.length}`;
}

window.addEventListener("mousedown", (ev)=>{
  if (!dropdownOpen) return;
  const t = ev.target;
  const insideDropdown = dropdownEl.contains(t);
  const insideFilters = filtersEl.contains(t);
  if (!insideDropdown && !insideFilters) {
    closeDropdown();
    renderTopButtons();
  }
});

btnBack?.addEventListener("click", stepBack);
btnClear?.addEventListener("click", clearAll);

btnViewMode?.addEventListener("click", ()=>{
  viewMode = (viewMode === "sandbox") ? "peso" : "sandbox";
  btnViewMode.textContent = viewMode;
  closeDropdown();
  renderTopButtons();
  applyAll();
});

btnAbout?.addEventListener("click", openAbout);
aboutClose?.addEventListener("click", closeAbout);

aboutOverlay?.addEventListener("click", (e)=>{
  if (e.target?.dataset?.close === "1") closeAbout();
});

if (brandHome){
  brandHome.addEventListener("click", (e)=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    if (window.top && window.top !== window.self) {
      window.top.postMessage({ type: "ATLAS_RETURN_TO_INDEX" }, location.origin);
      return;
    }
    window.location.href = "./index.html";
  }, { capture:true });
}

window.addEventListener("keydown", (e)=>{
  if (e.key === "Escape" && aboutOverlay?.classList.contains("open")) closeAbout();
});

let _tPrev = performance.now();
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

function positionDropdown(li){
  const btns = filtersEl.querySelectorAll(".fbtn");
  const b = btns[li];
  if (!b) return;

  const br = b.getBoundingClientRect();
  const ddW = dropdownEl.offsetWidth || 520;
  const gapY = 10;
  const top = br.bottom + gapY;

  const st = getComputedStyle(b);
  const padL = parseFloat(st.paddingLeft) || 0;
  const pad = 14;

  let left = br.left + padL;
  left = clamp(left, pad, window.innerWidth - ddW - pad);

  dropdownEl.style.left = `${left}px`;
  dropdownEl.style.top  = `${top}px`;
  dropdownEl.style.transform = "none";
}

function loop(){
  const now = performance.now();
  const dt = Math.min(22, now - _tPrev);
  _tPrev = now;

  gallery.update(dt);
  gallery.draw(ctxBG);

  ctxUI.clearRect(0,0,W,H);
  if (toolActivated) nodesOverlay.draw(ctxUI, gallery);

  requestAnimationFrame(loop);
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function setLandingProgress(p){
  const v = Math.max(0, Math.min(1, p || 0));
  landingPctEl && (landingPctEl.textContent = `${Math.round(v * 100)}%`);
  landingBarFillEl && (landingBarFillEl.style.width = `${(v * 100).toFixed(1)}%`);
}

function setLandingReady(){
  landingEl && landingEl.classList.add("ready");
}

function enterSite(){
  if (landingEl) landingEl.remove();
  document.body.classList.remove("landing-on");
  gallery.interactionsEnabled = true;
}

function openAbout(){
  if (!aboutOverlay) return;
  closeDropdown();
  renderTopButtons();
  aboutOverlay.classList.add("open");
  aboutOverlay.setAttribute("aria-hidden", "false");
  gallery.interactionsEnabled = false;
}
function closeAbout(){
  if (!aboutOverlay) return;
  aboutOverlay.classList.remove("open");
  aboutOverlay.setAttribute("aria-hidden", "true");
  if (!productView.isOpen) gallery.interactionsEnabled = true;
}

async function main(){
  resize();

  requestAnimationFrame(loop);

  if (EMBED) {
    document.body.classList.add("embed");

    gallery.safeTop = 0;
    gallery.safeBottom = 0;
    gallery.safeSide = 0;

    gallery.interactionsEnabled = false;

    if (landingEl) landingEl.style.display = "none";
  } else {
    document.body.classList.add("landing-on");
    gallery.interactionsEnabled = false;
    setLandingProgress(0);
  }

  crumbEl && (crumbEl.textContent = EMBED ? "" : "Caricamento…");

  const res = await fetch(CSV_URL);
  if (!res.ok){
    crumbEl && (crumbEl.textContent = `Errore CSV: HTTP ${res.status}`);
    return;
  }

  const text = await res.text();
  rows = csvToObjects(text);
  filtered = rows.slice();

  productView.setDataRows(rows);
  gallery.setRows(rows);

  if (!EMBED && landingEl) {
    await gallery.preloadAll((p)=> setLandingProgress(p));
    setLandingProgress(1);
    setLandingReady();

    landingEl.addEventListener("click", ()=>{
      if (!landingEl.classList.contains("ready")) return;
      enterSite();
      applyAll();
      closeDropdown();
      renderTopButtons();
    }, { once:true });
  } else {
    gallery.preloadAll(()=>{});
  }

  buildTopButtons();
  applyAll();

  closeDropdown();
  renderTopButtons();

  booted = true;
  if (pendingActivate) activateFromIndex();
}

main();