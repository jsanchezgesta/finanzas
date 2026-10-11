// Parsing bank exports: CSV text → rows → column mapping → transactions.
// Pure functions (no DOM) so they can be unit-tested in Node.

import { stripAccents } from './util.js';

/* ---------------- text decoding ---------------- */

export function decodeBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    // Spanish banks often export Windows-1252 / Latin-1.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/* ---------------- CSV ---------------- */

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  const candidates = [';', ',', '\t', '|'];
  let best = ';', bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map(l => countOutsideQuotes(l, d));
    const nonZero = counts.filter(c => c > 0);
    if (!nonZero.length) continue;
    // Prefer delimiters that give a consistent column count on many lines.
    const freq = {};
    for (const c of nonZero) freq[c] = (freq[c] || 0) + 1;
    const [mode, modeCount] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const score = modeCount * 10 + Number(mode);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

export function parseCSV(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(c => c !== ''));
}

/* ---------------- numbers ---------------- */

// Decide whether ',' or '.' is the decimal separator for a column of values.
export function detectDecimal(values) {
  let comma = 0, dot = 0;
  for (const raw of values) {
    const v = String(raw ?? '').replace(/[^\d.,-]/g, '');
    if (!v) continue;
    const lastComma = v.lastIndexOf(','), lastDot = v.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) { lastComma > lastDot ? comma++ : dot++; continue; }
    if (/,\d{1,2}$/.test(v)) comma++;
    else if (/\.\d{1,2}$/.test(v)) dot++;
    else if (/\.\d{3}$/.test(v)) comma++; // "1.234" → thousands dot, so decimal comma
    else if (/,\d{3}$/.test(v)) dot++;
  }
  return dot > comma ? '.' : ',';
}

export function parseAmount(raw, decimal = ',') {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[−–—]/g, '-'); // unicode minus / dashes
  if (/-\s*$/.test(s) && !/^-/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); } // trailing minus
  if (/^[^\d]*-/.test(s)) neg = true;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return neg ? -n : n;
}

/* ---------------- dates ---------------- */

const MONTH_NAMES = {
  ene: 1, jan: 1, gen: 1, feb: 2, mar: 3, mär: 3, abr: 4, apr: 4, may: 5, mai: 5, mag: 5, jun: 6, giu: 6,
  jul: 7, lug: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, okt: 10, ott: 10, nov: 11, dic: 12, dec: 12, dez: 12,
};

function pad(n) { return String(n).padStart(2, '0'); }

function validYMD(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// order: 'dmy' | 'mdy' | 'ymd'
export function parseDate(raw, order = 'dmy') {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw)) {
    return validYMD(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (typeof raw === 'number' || /^\d{5}(\.\d+)?$/.test(String(raw).trim())) {
    const n = Number(raw);
    if (n > 20000 && n < 80000) { // Excel serial date
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    return order === 'mdy' ? validYMD(y, a, b) : validYMD(y, b, a);
  }
  m = stripAccents(s).toLowerCase().match(/^(\d{1,2})[\s.-]*(?:de\s+)?([a-z]{3})[a-z]*\.?[\s.-]*(?:de\s+)?(\d{2,4})/);
  if (m && MONTH_NAMES[m[2]]) {
    let y = +m[3]; if (y < 100) y += 2000;
    return validYMD(y, MONTH_NAMES[m[2]], +m[1]);
  }
  m = stripAccents(s).toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTH_NAMES[m[1]]) return validYMD(+m[3], MONTH_NAMES[m[1]], +m[2]);
  return null;
}

export function detectDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const raw of values) {
    const m = String(raw ?? '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

/* ---------------- header & column detection ---------------- */

export function normHeader(s) {
  return stripAccents(String(s ?? '')).toLowerCase().replace(/[()€$*:]/g, ' ').replace(/\s+/g, ' ').trim();
}

const HEADER_PATTERNS = {
  date: [/^fecha( de)? (operacion|movimiento|transaccion|contable)$/, /^f\.? ?(operacion|oper|contable)\.?$/, /^fecha$/, /^date$/, /^(booking|transaction|posting) date$/, /^datum$/, /^buchungstag$/, /^data$/, /^fecha valor$/, /^f\.? ?valor$/, /^value date$/, /fecha/, /date/],
  desc: [/^concepto$/, /^concepto (comun|propio)$/, /^descripcion$/, /^description$/, /^movimiento$/, /^detalle/, /^mas datos$/, /^informacion adicional$/, /^details?$/, /^merchant/, /^payee$/, /^beneficiario/, /^counterparty/, /^name$/, /^nombre$/, /^referencia$/, /^reference$/, /^remitente/, /^observaciones$/, /^verwendungszweck$/, /^type$/, /^tipo$/, /concepto/, /descrip/],
  amount: [/^importe( eur| euros)?$/, /^importe$/, /^cantidad$/, /^amount( eur)?$/, /^value$/, /^betrag/, /^monto$/, /^importe movimiento$/, /importe/, /amount/],
  debit: [/^cargo/, /^debe$/, /^gasto/, /^debit/, /^withdrawal/, /^salida/, /^money out$/, /^paid out$/],
  credit: [/^abono/, /^haber$/, /^ingreso/, /^credit/, /^deposit/, /^entrada/, /^money in$/, /^paid in$/],
  balance: [/^saldo/, /^balance/, /^kontostand/],
};

function headerScore(h, kind) {
  const pats = HEADER_PATTERNS[kind];
  for (let i = 0; i < pats.length; i++) if (pats[i].test(h)) return pats.length - i;
  return 0;
}

export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 40);
  let best = -1, bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map(normHeader);
    let score = 0;
    const kinds = new Set();
    for (const c of cells) {
      if (!c || c.length > 40) continue;
      for (const k of Object.keys(HEADER_PATTERNS)) {
        if (headerScore(c, k) > 0) { kinds.add(k); }
      }
    }
    score = kinds.size;
    if (kinds.has('date') && (kinds.has('amount') || kinds.has('debit') || kinds.has('credit'))) score += 3;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 4 ? best : -1;
}

function isDateLike(v) { return parseDate(v) != null; }
function isAmountLike(v) {
  if (typeof v === 'number') return true;
  const s = String(v ?? '').trim();
  return /^[(+\-−]?\s*[\d.,\s]*\d[\d.,]*\s*(€|eur)?\s*[-)]?$/i.test(s) && /\d/.test(s);
}

export function detectMapping(header, dataRows) {
  const cols = header.length;
  const hs = header.map(normHeader);
  const sample = dataRows.slice(0, 200);
  const colValues = i => sample.map(r => r[i]).filter(v => v !== '' && v != null);
  const ratio = (i, fn) => { const v = colValues(i); return v.length ? v.filter(fn).length / v.length : 0; };

  const pick = (kind, filter = () => true, exclude = []) => {
    let best = -1, bestScore = 0;
    for (let i = 0; i < cols; i++) {
      if (exclude.includes(i)) continue;
      const s = headerScore(hs[i], kind);
      if (s > bestScore && filter(i)) { best = i; bestScore = s; }
    }
    return best;
  };

  let date = pick('date', i => ratio(i, isDateLike) > 0.6);
  if (date < 0) {
    for (let i = 0; i < cols; i++) if (ratio(i, isDateLike) > 0.8) { date = i; break; }
  }
  const balance = pick('balance', i => i !== date);
  let amount = pick('amount', i => i !== date && i !== balance && ratio(i, isAmountLike) > 0.6);
  let debit = -1, credit = -1;
  if (amount < 0) {
    debit = pick('debit', i => i !== date && i !== balance);
    credit = pick('credit', i => i !== date && i !== balance && i !== debit);
  }
  if (amount < 0 && debit < 0 && credit < 0) {
    // Fall back to content: a numeric column that isn't the balance.
    for (let i = 0; i < cols; i++) {
      if (i === date || i === balance) continue;
      if (ratio(i, isAmountLike) > 0.8 && colValues(i).some(v => /[.,]\d{2}\s*(€)?$/.test(String(v)))) { amount = i; break; }
    }
  }
  const used = [date, amount, debit, credit, balance];
  const desc = [];
  // All columns whose header looks like a description, ordered by header strength.
  const descScored = hs.map((h, i) => [i, headerScore(h, 'desc')])
    .filter(([i, s]) => s > 0 && !used.includes(i) && ratio(i, isAmountLike) < 0.5 && ratio(i, isDateLike) < 0.5)
    .sort((a, b) => b[1] - a[1]);
  for (const [i] of descScored.slice(0, 3)) desc.push(i);
  if (!desc.length) {
    // Pick the text column with the longest average content.
    let best = -1, bestLen = 0;
    for (let i = 0; i < cols; i++) {
      if (used.includes(i)) continue;
      const vals = colValues(i);
      if (!vals.length || ratio(i, isAmountLike) > 0.5 || ratio(i, isDateLike) > 0.5) continue;
      const len = vals.reduce((a, v) => a + String(v).length, 0) / vals.length;
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (best >= 0) desc.push(best);
  }
  desc.sort((a, b) => a - b);

  const amountSamples = amount >= 0 ? colValues(amount) : [...(debit >= 0 ? colValues(debit) : []), ...(credit >= 0 ? colValues(credit) : [])];
  return {
    date,
    desc,
    amount,
    debit,
    credit,
    balance,
    invert: false,
    decimal: detectDecimal(amountSamples),
    dateOrder: date >= 0 ? detectDateOrder(colValues(date)) : 'dmy',
  };
}

export function headerSignature(header) {
  return header.map(normHeader).join('|');
}

/* ---------------- full pipeline ---------------- */

// rows: array of arrays (strings, numbers or Dates). Returns header info + mapping.
export function analyzeRows(rows) {
  const headerIdx = findHeaderRow(rows);
  let header, data;
  if (headerIdx >= 0) {
    header = rows[headerIdx].map(c => String(c ?? ''));
    data = rows.slice(headerIdx + 1);
  } else {
    const width = Math.max(...rows.slice(0, 50).map(r => r.length));
    header = Array.from({ length: width }, (_, i) => 'Columna ' + (i + 1));
    data = rows;
  }
  const width = header.length;
  data = data.filter(r => r.some(c => c !== '' && c != null)).map(r => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
  return { headerIdx, header, data, signature: headerSignature(header), mapping: detectMapping(header, data) };
}

export function rowsToTransactions(data, mapping) {
  const out = [];
  let skipped = 0;
  for (const r of data) {
    const date = parseDate(r[mapping.date], mapping.dateOrder);
    let amount;
    if (mapping.amount >= 0) {
      amount = parseAmount(r[mapping.amount], mapping.decimal);
    } else {
      const d = mapping.debit >= 0 ? parseAmount(r[mapping.debit], mapping.decimal) : NaN;
      const c = mapping.credit >= 0 ? parseAmount(r[mapping.credit], mapping.decimal) : NaN;
      amount = (isFinite(c) ? Math.abs(c) : 0) - (isFinite(d) ? Math.abs(d) : 0);
      if (!isFinite(d) && !isFinite(c)) amount = NaN;
    }
    const description = mapping.desc
      .map(i => String(r[i] ?? '').trim())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(' · ');
    if (!date || !isFinite(amount) || amount === 0 && !description) { skipped++; continue; }
    if (amount === 0) { skipped++; continue; }
    out.push({ date, amount: Math.round((mapping.invert ? -amount : amount) * 100) / 100, description: description || '(sin concepto)' });
  }
  return { transactions: out, skipped };
}
