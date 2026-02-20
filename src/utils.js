// src/utils.js
"use strict";

/** ========= CONFIG (centrale) ========= */
export const CFG = {
  CSV_URL: "./data.csv",
  IMG_BASE: "./images/",

  // Ordine filtri (cascata)
  LEVELS: [
    { key: "Tipologia",         label: "Tipologia" },
    { key: "Materiale principale", label: "Materiale", aliases: ["Materiale"] },
    { key: "Colore principale", label: "Colore" },
    { key: "Condizioni",        label: "Condizioni", aliases: ["Condizoni"] },
    { key: "Tipo di anello",    label: "Tipo di anello" },
    { key: "Chiavi",            label: "Chiavi" },
  ],
};

/** ========= Helpers ========= */
export function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

export function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

export function sanitize(v){
  if (v == null) return "N/D";
  v = String(v).trim();
  if (!v || v.toLowerCase() === "nan") return "N/D";
  return v;
}

/** getVal con aliases (per colonne con typo) */
export function getVal(row, lvl){
  let v = row?.[lvl.key];
  if ((v == null || String(v).trim() === "") && lvl.aliases){
    for (const a of lvl.aliases){
      const vv = row?.[a];
      if (vv != null && String(vv).trim() !== "") { v = vv; break; }
    }
  }
  return sanitize(v);
}

/** ========= CSV parsing (no dipendenze) ========= */
function parseCSV(text){
  const out=[];
  let i=0, field="", row=[], inQ=false;

  const pushF=()=>{ row.push(field); field=""; };
  const pushR=()=>{ if (row.length && row.some(c=>String(c).trim()!=="")) out.push(row); row=[]; };

  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c === '"'){
        if(text[i+1] === '"'){ field+='"'; i+=2; continue; }
        inQ=false; i++; continue;
      }
      field+=c; i++; continue;
    }
    if(c === '"'){ inQ=true; i++; continue; }
    if(c === ','){ pushF(); i++; continue; }
    if(c === '\r'){ i++; continue; }
    if(c === '\n'){ pushF(); pushR(); i++; continue; }
    field+=c; i++;
  }
  pushF(); pushR();
  return out;
}

export function csvToObjects(text){
  const grid = parseCSV(text);
  if(!grid.length) return [];
  const headers = grid[0].map(h=>String(h).trim());
  return grid.slice(1).map(r=>{
    const o={};
    for(let j=0;j<headers.length;j++) o[headers[j]] = r[j] ?? "";
    return o;
  });
}

/** ========= Filtering / counts ========= */
export function applyFilters(rows, selection, levels){
  const out = [];
  for (const r of rows){
    let ok = true;
    for (let li=0; li<levels.length; li++){
      const sel = selection[li];
      if (!sel) continue;
      if (getVal(r, levels[li]) !== sel){ ok = false; break; }
    }
    if (ok) out.push(r);
  }
  return out;
}

export function countsForLevelFromBase(baseRows, li, levels){
  const map = new Map();
  for (const r of baseRows){
    const v = getVal(r, levels[li]);
    map.set(v, (map.get(v)||0)+1);
  }
  const arr = [...map.entries()].map(([label,count])=>({label,count}));
  arr.sort((a,b)=>b.count-a.count);
  return arr;
}

/** ========= Images ========= */
export function imageUrlFromRow(row){
  const raw = row?.file ?? row?.File ?? row?.FILE ?? "";
  const file = String(raw).trim();
  if (!file) return null;
  return new URL(`${CFG.IMG_BASE}${file}`, window.location.href).toString();
}