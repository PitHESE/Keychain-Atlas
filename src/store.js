// src/store.js
"use strict";

function sanitize(v){
  if (v==null) return "N/D";
  v = String(v).trim();
  if (!v || v.toLowerCase()==="nan") return "N/D";
  return v;
}

function getVal(obj, lvl){
  let v = obj?.[lvl.key];
  if ((v==null || String(v).trim()==="") && lvl.aliases){
    for (const a of lvl.aliases){
      const vv = obj?.[a];
      if (vv!=null && String(vv).trim()!==""){ v = vv; break; }
    }
  }
  return sanitize(v);
}

export class Store {
  constructor(){
    // livelli (come vuoi tu ora: include Materiale)
    this.LEVELS = [
      { key:"Tipologia",         label:"Tipologia" },
      { key:"Materiale",         label:"Materiale" },
      { key:"Colore principale", label:"Colore", aliases:["Colore Principale"] },
      { key:"Condizioni",        label:"Condizioni", aliases:["Condizoni"] },
      { key:"Tipo di anello",    label:"Tipo di anello" },
      { key:"Chiavi",            label:"Chiavi" },
    ];

    this.rows = [];
    this.filteredRows = [];
    this.selection = Array(this.LEVELS.length).fill(null);

    this.openLevel = null; // dropdown aperto
    this.onChange = null;
  }

  setRows(rows){
    this.rows = rows || [];
    this.filteredRows = this.rows.slice();
    this._emit();
  }

  hasAnyFilter(){
    return this.selection.some(v=>v!=null);
  }

  clearAll(){
    this.selection = Array(this.LEVELS.length).fill(null);
    this.filteredRows = this.rows.slice();
    this._emit();
  }

  setSelection(levelIndex, value){
    this.selection[levelIndex] = value;

    // reset successivi
    for (let i=levelIndex+1; i<this.selection.length; i++){
      this.selection[i] = null;
    }

    // aggiorna filtered
    this.filteredRows = this.rows.filter(r=>{
      for (let li=0; li<this.LEVELS.length; li++){
        const sel = this.selection[li];
        if (!sel) continue;
        if (getVal(r, this.LEVELS[li]) !== sel) return false;
      }
      return true;
    });

    this._emit();
  }

  // counts per dropdown: filtra fino al livello precedente
  baseRowsForLevel(levelIndex){
    return this.rows.filter(r=>{
      for (let li=0; li<levelIndex; li++){
        const sel = this.selection[li];
        if (!sel) return true; // se manca una selezione precedente, non blocco (ma UI impedirà “salti”)
        if (getVal(r, this.LEVELS[li]) !== sel) return false;
      }
      return true;
    });
  }

  countsForLevel(levelIndex){
    const base = this.baseRowsForLevel(levelIndex);
    const map = new Map();
    for (const r of base){
      const v = getVal(r, this.LEVELS[levelIndex]);
      map.set(v, (map.get(v)||0)+1);
    }
    const arr = [...map.entries()].map(([label,count])=>({label,count}));
    arr.sort((a,b)=>b.count-a.count);
    return arr;
  }

  canOpenLevel(levelIndex){
    // non puoi aprire un livello se non hai scelto tutti i precedenti
    for (let i=0; i<levelIndex; i++){
      if (!this.selection[i]) return false;
    }
    return true;
  }

  describeCrumb(){
    const parts = [];
    for (let i=0; i<this.LEVELS.length; i++){
      if (!this.selection[i]) break;
      parts.push(`${this.LEVELS[i].label}: ${this.selection[i]}`);
    }
    const p = parts.length ? parts.join(" → ") : "Nessun filtro attivo (vista globale).";
    const n = this.filteredRows.length || this.rows.length;
    return `${p}\nRighe: ${n}`;
  }

  _emit(){
    if (typeof this.onChange === "function") this.onChange();
  }
}