// CaixaBank "Movimientos" export (.xls / .csv). One file can hold several
// accounts; every row names its account in "Número de cuenta", so the file is
// split per account before import. Transfers between your own accounts are
// marked by the bank ("TRASPASO PROPIO") or by Trade Republic's BIC.

import { normHeader, parseAmount, parseDate, findHeaderRow } from './parse.js';

export const TR_BIC = 'TRBKESM2XXX';
const OWN_TRANSFER = /TRASPASO PROPIO/i;
// Bank boilerplate that is not part of the merchant name.
const BOILERPLATE = /\b(COMPRA CON TARJETA|NOTPROVIDE|ORIGEN:|DESTINO:)/gi;

export function isCaixa(header) {
  const hs = header.map(normHeader);
  return hs.includes('numero de cuenta') && hs.some(h => h.startsWith('concepto comun'));
}

export function caixaColumns(header) {
  const hs = header.map(normHeader);
  const find = re => hs.findIndex(h => re.test(h));
  return {
    account: find(/^numero de cuenta$/),
    date: find(/^f\.? operacion$/),
    credit: find(/^ingreso/),
    debit: find(/^gasto/),
    // Counterparty and concept text: Referencia 2 and the complementary concept columns.
    text: hs.map((h, i) => (/^referencia 2$|^concepto complementario/.test(h) ? i : -1)).filter(i => i >= 0),
  };
}

export function accountLabel(account) {
  const digits = String(account ?? '').replace(/\s/g, '');
  return 'CaixaBank ····' + digits.slice(-4);
}

// A segment is bank noise when it is a number, a single-token bank code
// ("04000022SIO"), an IBAN or a BIC. Merchant names that mix words and
// numbers ("SUPER PALCK 2", "Glovo 05OCT BTAZX") are not codes.
function isCode(s) {
  if (/^\d[\d\s]*$/.test(s)) return true;
  const t = s.replace(/\s/g, '');
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(t) && (t.match(/\d/g) || []).length >= 10) return true; // IBAN
  if (/\s/.test(s.trim())) return false;
  if (/\d/.test(t) && /^[A-Z0-9]{8,}$/i.test(t)) return true;
  // BIC: 8 or 11 characters. An 8-letter word ("DIONISOS") is not one; real
  // 8-character BICs carry a digit, 11-character ones usually end in XXX.
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(t) && (/\d/.test(t) || /XXX$/.test(t));
}

const nameKey = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
const looksLikeName = s => /^[A-Za-zÀ-ÿ.' -]+$/.test(s) && s.trim().split(/\s+/).length >= 2;

export function caixaRowsToTransactions(data, cols) {
  const out = [];
  let skipped = 0;
  // The account holder's name is on the bank's own transfers between your
  // accounts. Any later movement with the same name is one of your transfers too.
  const holders = new Set();
  for (const r of data) {
    const raw = cols.text.map(i => String(r[i] ?? '')).join('  ');
    if (!OWN_TRANSFER.test(raw)) continue;
    for (const seg of raw.split(/\s{2,}/).map(x => x.trim())) if (looksLikeName(seg)) holders.add(nameKey(seg));
  }
  for (const r of data) {
    const account = String(r[cols.account] ?? '');
    if (!/\d{4}/.test(account)) { skipped++; continue; } // repeated header rows, blanks
    const date = parseDate(r[cols.date], 'dmy');
    const c = parseAmount(r[cols.credit], '.');
    const d = parseAmount(r[cols.debit], '.');
    if (!date || (!isFinite(c) && !isFinite(d))) { skipped++; continue; }
    const amount = Math.round(((isFinite(c) ? Math.abs(c) : 0) - (isFinite(d) ? Math.abs(d) : 0)) * 100) / 100;
    if (amount === 0) { skipped++; continue; }

    const raw = cols.text.map(i => String(r[i] ?? '')).join('  ');
    const bankOwn = OWN_TRANSFER.test(raw) || raw.includes(TR_BIC);
    const segments = raw.split(/\s{2,}/).map(s => s.trim()).filter(s => s && !isCode(s))
      .map(s => s.replace(BOILERPLATE, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const description = [...new Set(segments)].join(' · ') || '(sin concepto)';
    const holderPayment = !bankOwn && segments.some(seg => looksLikeName(seg) && holders.has(nameKey(seg)));

    out.push({
      date, amount, description,
      // Bank-labelled transfers are settled automatically; payments to the
      // holder's own name are only suggested, so they can be confirmed.
      ownTransfer: bankOwn || holderPayment,
      forcedCategoryId: bankOwn ? 'traspaso' : null,
    });
  }
  return { transactions: out, skipped };
}

// Split a multi-account file into one row set per account (header kept).
// Returns null when the file is not a CaixaBank export.
export function splitByAccount(rows) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return null;
  const header = rows[headerIdx].map(c => String(c ?? ''));
  if (!isCaixa(header)) return null;
  const ai = caixaColumns(header).account;
  const groups = new Map();
  for (const r of rows.slice(headerIdx + 1)) {
    const acc = String(r[ai] ?? '').trim();
    if (!/\d{4}/.test(acc)) continue;
    if (!groups.has(acc)) groups.set(acc, []);
    groups.get(acc).push(r);
  }
  const head = rows.slice(0, headerIdx + 1);
  return [...groups].map(([account, data]) => ({ account, label: accountLabel(account), rows: [...head, ...data] }));
}
