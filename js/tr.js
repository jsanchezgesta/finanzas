// Trade Republic "Transaktionsexport" / transaction export (web app, 2026).
// Fixed schema: datetime, date, account_type, category, type, asset_class,
// name, symbol, shares, price, amount, fee, tax, currency, original_amount,
// original_currency, fx_rate, description, transaction_id, counterparty_name,
// counterparty_iban, payment_reference, mcc_code.
//
// The type values aren't fully documented, so classification matches on
// keywords (CARD, SAVEBACK, INTEREST, …) and falls back to sign + asset class.

import { normHeader, parseDate, parseAmount } from './parse.js';
import { mccCategory } from './mcc.js';

const REQUIRED = ['category', 'type', 'amount', 'transaction_id'];

export function isTradeRepublic(header) {
  const h = header.map(c => normHeader(c).replace(/\s+/g, '_'));
  return REQUIRED.every(k => h.includes(k)) && (h.includes('asset_class') || h.includes('account_type'));
}

export function trColumns(header) {
  const cols = {};
  header.forEach((c, i) => { cols[normHeader(c).replace(/\s+/g, '_')] = i; });
  return cols;
}

// Category each kind goes to without asking. null = normal review flow.
export const TR_KIND_CATEGORY = {
  card: null,
  fee: 'comisiones',
  saveback: 'saveback',
  roundup: 'inversion',
  interest: 'intereses',
  dividend: 'intereses',
  tax: 'impuestos',
  buy: 'inversion',
  sell: 'inversion',
  reward: 'saveback',
  transfer: null,
  other: null,
};

export const TR_KIND_LABEL = {
  card: 'Card payment', fee: 'Fee', saveback: 'Saveback', roundup: 'Round-up', interest: 'Interest',
  dividend: 'Dividend', tax: 'Tax', buy: 'Buy', sell: 'Sell', reward: 'Bonus / gift', transfer: 'Transfer', other: 'Other',
};

export function classifyTR({ category = '', type = '', assetClass = '', amount = 0, text = '' }) {
  const t = (type + ' ' + category).toUpperCase();
  const all = (t + ' ' + text).toUpperCase();
  if (/SAVEBACK/.test(all)) return 'saveback';
  if (/ROUND.?UP|REDONDEO/.test(all)) return 'roundup';
  if (/CARD_ORDERING|FEE|COMMISSION|GEB(U|Ü)HR/.test(t)) return 'fee';
  if (/CARD/.test(t)) return 'card';
  if (/INTEREST|ZINS|INTERES/.test(t)) return 'interest';
  if (/DIVIDEND|DISTRIBUTION|COUPON|AUSSCH/.test(t)) return 'dividend';
  if (/TAX|STEUER/.test(t) && !assetClass) return 'tax';
  if (/FREE_RECEIPT|BONUS|REWARD|GIFT|STOCKPERK|DELIVERY/.test(t)) return 'reward';
  if (/SAVINGS_PLAN|SPARPLAN|BUY|PURCHASE|KAUF/.test(t)) return 'buy';
  if (/SELL|VERKAUF/.test(t)) return 'sell';
  if (/TRADING|TRADE|ORDER/.test(t) || assetClass) return amount > 0 ? 'sell' : 'buy';
  if (/TRANSFER|DEPOSIT|PAYIN|PAYOUT|WITHDRAW|SEPA|INSTANT|UBERWEISUNG|ÜBERWEISUNG/.test(t)) return 'transfer';
  return 'other';
}

function signedCost(v) {
  if (!isFinite(v) || v === 0) return 0;
  return -Math.abs(v);
}

export function trRowsToTransactions(data, cols) {
  const get = (r, k) => (cols[k] != null ? r[cols[k]] : '');
  const num = (r, k) => { const v = parseAmount(get(r, k), '.'); return isFinite(v) ? v : 0; };
  const out = [];
  let skipped = 0;
  for (const r of data) {
    const date = parseDate(get(r, 'date') || get(r, 'datetime'), 'ymd');
    const amount = num(r, 'amount');
    const fee = num(r, 'fee');
    const tax = num(r, 'tax');
    const shares = Math.abs(num(r, 'shares'));
    const price = Math.abs(num(r, 'price'));
    const name = String(get(r, 'name') || '').trim();
    const counterparty = String(get(r, 'counterparty_name') || '').trim();
    const desc = String(get(r, 'description') || '').trim();
    const reference = String(get(r, 'payment_reference') || '').trim();
    const assetClass = String(get(r, 'asset_class') || '').trim();
    const kind = classifyTR({ category: get(r, 'category'), type: get(r, 'type'), assetClass, amount, text: desc + ' ' + name });
    // Cash impact: amount plus fee and tax (both charged to the cash account).
    const cash = Math.round((amount + signedCost(fee) + (kind === 'tax' ? 0 : signedCost(tax))) * 100) / 100;
    const value = Math.round((shares * price || Math.abs(amount)) * 100) / 100;
    if (!date) { skipped++; continue; }
    // Rows with no cash movement (Saveback shares, bonus shares) are kept as
    // value-only investment records.
    const valueOnly = cash === 0;
    if (valueOnly && !(value > 0 && ['saveback', 'reward', 'buy', 'roundup'].includes(kind))) { skipped++; continue; }

    let label;
    if (kind === 'card') label = name || counterparty || desc;
    else if (kind === 'transfer') label = [counterparty ? (amount > 0 ? 'Transfer from ' : 'Transfer to ') + counterparty : 'Transfer', reference].filter(Boolean).join(' · ');
    else if (['buy', 'sell', 'saveback', 'roundup', 'reward', 'dividend'].includes(kind)) label = [TR_KIND_LABEL[kind], name || desc].filter(Boolean).join(' · ');
    else label = [TR_KIND_LABEL[kind], name || desc || counterparty].filter(Boolean).join(' · ');

    out.push({
      date,
      amount: cash,
      description: label || TR_KIND_LABEL[kind],
      externalId: String(get(r, 'transaction_id') || '').trim() || null,
      valueOnly,
      forcedCategoryId: TR_KIND_CATEGORY[kind] || null,
      mccCategoryId: kind === 'card' ? mccCategory(get(r, 'mcc_code')) : null,
      tr: {
        kind,
        type: String(get(r, 'type') || ''),
        asset: ['buy', 'sell', 'saveback', 'roundup', 'reward', 'dividend'].includes(kind) ? (name || desc || null) : null,
        symbol: String(get(r, 'symbol') || '').trim() || null,
        assetClass: assetClass || null,
        shares: shares || null,
        price: price || null,
        value,
        fee: fee || 0,
        tax: tax || 0,
        mcc: String(get(r, 'mcc_code') || '').trim() || null,
        originalCurrency: String(get(r, 'original_currency') || '').trim().toUpperCase() || null,
        originalAmount: num(r, 'original_amount') || null,
      },
    });
  }
  return { transactions: out, skipped };
}
