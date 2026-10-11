// Import pipeline: file → rows → mapping → deduplicated, categorized transactions.

import { decodeBytes, parseCSV, analyzeRows, rowsToTransactions } from './parse.js';
import { normalizeMerchant, cleanDescription } from './merchant.js';
import { categorizeNew, detectTransfers } from './categorize.js';
import { uid } from './util.js';
import { buildContext } from './analysis.js';
import { assignTrips } from './trips.js';

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

export async function readFileRows(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (/\.(xlsx|xls|ods|xlsm)$/.test(name)) {
    let XLSX;
    try {
      XLSX = await import(/* @vite-ignore */ SHEETJS_URL);
    } catch {
      throw new Error('Reading Excel files needs a connection the first time. Try again, or export the statement as CSV.');
    }
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    // Pick the sheet with the most rows.
    let best = [];
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '', blankrows: false });
      if (rows.length > best.length) best = rows;
    }
    return best.map(r => r.map(c => (typeof c === 'string' ? c.trim() : c)));
  }
  return parseCSV(decodeBytes(buf));
}

export function analyzeFile(state, rows) {
  const analysis = analyzeRows(rows);
  const profile = state.importProfiles[analysis.signature] || null;
  if (profile) analysis.mapping = { ...analysis.mapping, ...profile.mapping };
  return { analysis, profile };
}

// Investment rows group by kind + asset ("Compra · Vanguard FTSE All-World").
function trMerchant(p) {
  const kind = { buy: 'inversion', sell: 'inversion', roundup: 'redondeo', saveback: 'saveback', reward: 'saveback', interest: 'intereses', dividend: 'dividendos', fee: 'comisiones', tax: 'impuestos' }[p.tr.kind] || p.tr.kind;
  const asset = (p.tr.asset || '').toLowerCase().replace(/[^a-z0-9áéíóúñü ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
  const key = ('tr ' + kind + (asset && !['intereses', 'comisiones', 'impuestos'].includes(kind) ? ' ' + asset : '')).trim();
  const label = { inversion: 'Investment', redondeo: 'Round-up', saveback: 'Saveback', intereses: 'Trade Republic interest', dividendos: 'Dividends', comisiones: 'Trade Republic fees', impuestos: 'Trade Republic tax' }[kind] || kind;
  return { key, name: label + (p.tr.asset && !['intereses', 'comisiones', 'impuestos'].includes(kind) ? ' · ' + p.tr.asset : '') };
}

function baseHash(accountId, t) {
  return [accountId, t.date, t.amount.toFixed(2), cleanDescription(t.description)].join('|');
}

// Build new transactions without touching state (for preview).
export function buildImport(state, analysis, mapping, accountId) {
  const { transactions: parsed, skipped } = rowsToTransactions(analysis.data, mapping);
  const existing = new Map();
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    const b = t.hash.replace(/#\d+$/, '');
    existing.set(b, (existing.get(b) || 0) + 1);
  }
  const seen = new Map();
  const fresh = [];
  let dupes = 0;
  const existingIds = new Set(state.transactions.filter(t => t.accountId === accountId).map(t => t.hash));
  for (const p of parsed) {
    let hash;
    if (p.externalId) {
      // Exports with a transaction id (Trade Republic) dedupe on that id.
      hash = accountId + '|id|' + p.externalId;
      if (existingIds.has(hash) || seen.has(hash)) { dupes++; continue; }
      seen.set(hash, 1);
    } else {
      const b = baseHash(accountId, p);
      const i = seen.get(b) || 0;
      seen.set(b, i + 1);
      if (i < (existing.get(b) || 0)) { dupes++; continue; }
      hash = b + '#' + i;
    }
    const m = p.tr && p.tr.kind !== 'card' && p.tr.kind !== 'transfer' && p.tr.kind !== 'other'
      ? trMerchant(p) : normalizeMerchant(p.description);
    fresh.push({
      id: uid(),
      hash,
      accountId,
      date: p.date,
      amount: p.amount,
      description: p.description,
      merchant: m.key,
      merchantName: m.name,
      categoryId: null,
      status: 'pending',
      suggestedCategoryId: null,
      natureOverride: null,
      note: '',
      importId: null,
      ...(p.tr ? { tr: p.tr, valueOnly: p.valueOnly || false, forcedCategoryId: p.forcedCategoryId || null, mccCategoryId: p.mccCategoryId || null } : {}),
    });
  }
  fresh.sort((a, b) => a.date.localeCompare(b.date));
  return { fresh, dupes, skipped, parsedCount: parsed.length };
}

export function commitImport(state, { fresh, dupes, skipped }, { fileName, accountId, signature, mapping, saveProfile = true }) {
  const importId = uid();
  for (const t of fresh) t.importId = importId;
  categorizeNew(fresh, state);
  state.transactions.push(...fresh);
  state.transactions.sort((a, b) => b.date.localeCompare(a.date));
  const transfers = detectTransfers(state.transactions);
  if (state.trips?.length) assignTrips(state, buildContext(state));
  if (saveProfile && signature) state.importProfiles[signature] = { mapping, accountId, updatedAt: Date.now() };
  const auto = fresh.filter(t => t.status === 'auto').length;
  const record = {
    id: importId, at: Date.now(), fileName, accountId,
    count: fresh.length, auto, pending: fresh.length - auto, dupes, skipped, transfers,
    from: fresh[0]?.date || null, to: fresh[fresh.length - 1]?.date || null,
  };
  state.imports.unshift(record);
  return record;
}

export function undoImport(state, importId) {
  state.transactions = state.transactions.filter(t => t.importId !== importId);
  state.imports = state.imports.filter(i => i.id !== importId);
}
