// src/csv.js
"use strict";

function parseCSV(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    // skip completely empty rows
    if (row.length && row.some((c) => String(c).trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // escaped quote
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }

    if (ch === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }

    if (ch === "\r") {
      // handle CRLF and lone CR
      if (text[i + 1] === "\n") {
        i++;
        continue;
      }
      pushField();
      pushRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  pushField();
  pushRow();
  return rows;
}

export function csvToObjects(text) {
  const grid = parseCSV(String(text ?? ""));
  if (!grid.length) return [];

  const headers = grid[0].map((h) => String(h).trim());
  const out = [];

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c] ?? "";
    out.push(obj);
  }

  return out;
}