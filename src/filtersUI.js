// src/filtersUI.js
"use strict";

export class FiltersUI {
  constructor(store){
    this.store = store;
    this.container = null;
    this.dropdown = null;
    this.activeLevel = null;

    window.addEventListener("mousedown", (ev)=>{
      const dd = this.dropdown;
      if (!dd || !dd.classList.contains("open")) return;
      const t = ev.target;
      if (dd.contains(t) || (this.container && this.container.contains(t))) return;
      this.closeDropdown();
    });
  }

  mount(containerEl, dropdownEl){
    this.container = containerEl;
    this.dropdown = dropdownEl;
    this.renderButtons();

    const prev = this.store.onChange;
    this.store.onChange = ()=>{
      if (typeof prev === "function") prev();
      this.renderButtons();
      if (this.activeLevel != null) this.openDropdown(this.activeLevel);
    };
  }

  renderButtons(){
    const c = this.container;
    if (!c) return;
    c.innerHTML = "";

    this.store.LEVELS.forEach((lvl, li)=>{
      const sel = this.store.selection[li];
      const btn = document.createElement("button");

      btn.className = "filter-btn" + (this.activeLevel === li ? " active" : "");
      btn.textContent = sel ? `${lvl.label}: ${sel}` : lvl.label;

      const locked = li !== 0 && !this.store.canOpenLevel(li);
      if (locked){
        btn.style.opacity = "0.45";
        btn.style.pointerEvents = "none";
      }

      btn.addEventListener("click", ()=>{
        if (this.activeLevel === li) this.closeDropdown();
        else this.openDropdown(li, btn);
      });

      c.appendChild(btn);
    });
  }

  openDropdown(levelIndex, anchorBtn){
    this.activeLevel = levelIndex;
    this.renderButtons();

    const dd = this.dropdown;
    if (!dd) return;

    const list = this.store.countsForLevel(levelIndex);
    const sel = this.store.selection[levelIndex];

    dd.innerHTML = "";

    if (!list.length){
      const div = document.createElement("div");
      div.className = "dd-empty";
      div.textContent = "Nessun valore disponibile.";
      dd.appendChild(div);
    } else {
      for (const it of list){
        const b = document.createElement("button");
        b.className = "dd-item" + (sel === it.label ? " active" : "");
        b.innerHTML = `<span>${it.label}</span><span class="n">${it.count}</span>`;
        b.addEventListener("click", ()=>{
          this.store.setSelection(levelIndex, it.label);
          this.closeDropdown();
        });
        dd.appendChild(b);
      }
    }

    const btn = anchorBtn || (this.container && this.container.children[levelIndex]);
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const x = Math.min(r.left, window.innerWidth - 24 - 320);
    const y = r.bottom + 8;

    dd.style.left = `${x}px`;
    dd.style.top = `${y}px`;
    dd.classList.add("open");
  }

  closeDropdown(){
    this.activeLevel = null;
    this.renderButtons();
    if (this.dropdown) this.dropdown.classList.remove("open");
  }
}