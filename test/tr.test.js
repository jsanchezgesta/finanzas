import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTR } from '../js/tr.js';
import { mccCategory } from '../js/mcc.js';
import { parseCSV, analyzeRows } from '../js/parse.js';
import { defaultState } from '../js/defaults.js';
import { buildImport, commitImport } from '../js/importer.js';
import { buildContext, summarize } from '../js/analysis.js';
import { investmentSummary, savebackStatus } from '../js/invest.js';

const HEADER = 'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code';
const row = o => [o.dt || '2026-09-01T10:00:00Z', o.date, 'DEFAULT', o.category || 'CASH', o.type, o.ac || '', o.name || '', o.symbol || '', o.shares || '', o.price || '', o.amount, o.fee || '', o.tax || '', 'EUR', '', '', '', o.desc || '', o.id, o.cp || '', '', '', o.mcc || '']
  .map(v => '"' + v + '"').join(',');

const CSV = [HEADER,
  row({ date: '2026-09-01', type: 'INTEREST_PAYMENT', amount: '4.12', id: 'a1' }),
  row({ date: '2026-09-02', category: 'TRADING', type: 'SAVINGS_PLAN', ac: 'FUND', name: 'Vanguard FTSE All-World', symbol: 'IE00BK5BQT80', shares: '3.000000', price: '130.0000', amount: '-390.00', id: 'a2' }),
  row({ date: '2026-09-02', category: 'TRADING', type: 'SAVEBACK', ac: 'FUND', name: 'Vanguard FTSE All-World', symbol: 'IE00BK5BQT80', shares: '0.100000', price: '130.0000', amount: '0.00', id: 'a3' }),
  row({ date: '2026-09-05', type: 'CARD_TRANSACTION', name: 'MERCADONA BARCELONA', amount: '-45.20', mcc: '5411', id: 'a4' }),
  row({ date: '2026-09-06', type: 'CARD_TRANSACTION_INTERNATIONAL', name: 'UBUD PASAR', amount: '-53.06', fee: '-1.00', mcc: '5812', id: 'a5' }),
  row({ date: '2026-09-07', type: 'CARD_ORDERING_FEE', amount: '-5.00', id: 'a6' }),
  row({ date: '2026-09-10', type: 'TRANSFER_INSTANT_INBOUND', amount: '500.00', cp: 'JUAN EJEMPLO', id: 'a7' }),
  row({ date: '2026-09-15', category: 'TRADING', type: 'DIVIDEND', ac: 'STOCK', name: 'Apple Inc', amount: '2.40', tax: '-0.36', id: 'a8' }),
].join('\n');

test('classifies Trade Republic row types', () => {
  assert.equal(classifyTR({ type: 'CARD_TRANSACTION' }), 'card');
  assert.equal(classifyTR({ type: 'CARD_TRANSACTION_INTERNATIONAL' }), 'card');
  assert.equal(classifyTR({ type: 'CARD_ORDERING_FEE' }), 'fee');
  assert.equal(classifyTR({ type: 'INTEREST_PAYMENT' }), 'interest');
  assert.equal(classifyTR({ type: 'SAVEBACK', category: 'TRADING' }), 'saveback');
  assert.equal(classifyTR({ type: 'ROUND_UP' }), 'roundup');
  assert.equal(classifyTR({ type: 'SAVINGS_PLAN', category: 'TRADING' }), 'buy');
  assert.equal(classifyTR({ type: 'DEFAULT', category: 'TRADING', assetClass: 'STOCK', amount: 120 }), 'sell');
  assert.equal(classifyTR({ type: 'FREE_RECEIPT', category: 'DELIVERY' }), 'reward');
  assert.equal(classifyTR({ type: 'TRANSFER_INSTANT_INBOUND' }), 'transfer');
});

test('maps MCC codes to categories', () => {
  assert.equal(mccCategory('5411'), 'supermercado');
  assert.equal(mccCategory('5812'), 'restaurantes');
  assert.equal(mccCategory('4511'), 'viajes');
  assert.equal(mccCategory('5912'), 'salud');
  assert.equal(mccCategory(''), null);
});

function importTR(state, csv, accountId = 'tr') {
  const a = analyzeRows(parseCSV(csv));
  assert.equal(a.mapping.adapter, 'traderepublic');
  const built = buildImport(state, a, a.mapping, accountId);
  return commitImport(state, built, { fileName: 'tr.csv', accountId, signature: a.signature, mapping: a.mapping });
}

test('imports a Trade Republic export: auto-categories, MCC suggestions, fees, dedupe by id', () => {
  const s = defaultState();
  s.accounts.push({ id: 'tr', name: 'Trade Republic' });
  const r = importTR(s, CSV);
  assert.equal(r.count, 8);
  const by = id => s.transactions.find(t => t.hash.endsWith('|id|' + id));
  assert.equal(by('a1').categoryId, 'intereses');
  assert.equal(by('a1').status, 'auto');
  assert.equal(by('a2').categoryId, 'inversion');
  assert.equal(by('a2').tr.shares, 3);
  assert.equal(by('a3').valueOnly, true);
  assert.equal(by('a3').categoryId, 'saveback');
  assert.equal(by('a3').tr.value, 13);
  assert.equal(by('a4').status, 'pending');
  assert.equal(by('a4').suggestedCategoryId, 'supermercado');
  assert.equal(by('a4').merchant, 'mercadona');
  assert.equal(by('a5').amount, -54.06); // card amount + FX fee
  assert.equal(by('a5').suggestedCategoryId, 'restaurantes');
  assert.equal(by('a6').categoryId, 'comisiones');
  assert.equal(by('a7').status, 'pending');
  assert.equal(by('a8').amount, 2.04); // dividend net of withholding
  assert.equal(by('a8').categoryId, 'intereses');

  // Re-importing the same export adds nothing.
  const again = importTR(s, CSV);
  assert.equal(again.count, 0);
  assert.equal(again.dupes, 8);
});

test('Saveback shares count as income and investment; investment and Saveback summaries', () => {
  const s = defaultState();
  s.accounts.push({ id: 'tr', name: 'Trade Republic', bank: 'Trade Republic' });
  importTR(s, CSV);
  // The incoming transfer is reviewed as a transfer between own accounts.
  s.transactions.find(t => t.hash.endsWith('|id|a7')).categoryId = 'traspaso';
  const ctx = buildContext(s);
  const { total } = summarize(ctx, ['2026-09']);
  assert.equal(Math.round(total.saving * 100) / 100, 403); // 390 plan + 13 saveback
  assert.equal(Math.round(total.income * 100) / 100, 19.16);

  const inv = investmentSummary(s, ['2026-09']);
  assert.equal(inv.total.own, 390);
  assert.equal(inv.total.saveback, 13);
  assert.equal(inv.total.interest, 4.12);
  assert.equal(inv.total.dividends, 2.04);
  const vwce = inv.assets.find(a => a.symbol === 'IE00BK5BQT80');
  assert.equal(vwce.shares, 3.1);
  assert.equal(vwce.invested, 403);

  const sb = savebackStatus(s, '2026-09');
  assert.equal(sb.trCardSpend, 99.26); // 45.20 + 54.06
  assert.equal(sb.planOk, true);
  assert.equal(sb.expected, 0.99);
});

test('own-account transfers are recognized from name variants without the other bank', async () => {
  const { detectOwnTransfers, reviewGroups } = await import('../js/categorize.js');
  const rows = [HEADER,
    row({ date: '2026-04-15', type: 'TRANSFER_INSTANT_INBOUND', amount: '10000.00', desc: 'Incoming transfer from JUAN ANTONIO PEREZ LOPEZ (ES0000000000000000000001)', id: 'b1' }),
    row({ date: '2026-05-12', type: 'TRANSFER_INSTANT_INBOUND', amount: '0.08', cp: 'J.A. Perez Lopez', desc: 'Incoming transfer from J.A. Perez Lopez (ES0000000000000000000002)', id: 'b2' }),
    row({ date: '2026-06-01', type: 'TRANSFER_INSTANT_OUTBOUND', name: 'Juan Antonio Pérez López', amount: '-540.00', desc: 'Outgoing transfer for Juan Antonio Pérez López (ES0000000000000000000003)', id: 'b3' }),
    row({ date: '2026-05-30', type: 'TRANSFER_INSTANT_OUTBOUND', name: 'Ana Example', amount: '-480.00', desc: 'Outgoing transfer for Ana Example (ES0000000000000000000004)', id: 'b4' }),
    row({ date: '2026-06-12', category: 'CASH', type: 'IPO_SUBSCRIPTION', ac: 'STOCK', name: 'SpaceX', amount: '174.14', desc: '(partial reimbursement) IPO access pre-payment', id: 'b5' }),
  ].join('\n');
  const s = defaultState();
  s.accounts.push({ id: 'tr', name: 'Trade Republic' });
  importTR(s, rows);
  const own = s.transactions.filter(t => t.ownTransfer).map(t => t.amount).sort((a, b) => a - b);
  assert.deepEqual(own, [-540, 0.08, 10000]);
  const g = reviewGroups(s).find(x => x.own);
  assert.equal(g.suggestion, 'traspaso');
  assert.equal(g.txs.length, 3);
  // IPO refund is a negative buy, not a sale.
  assert.equal(s.transactions.find(t => t.hash.endsWith('|id|b5')).tr.kind, 'buy');
  assert.ok(detectOwnTransfers);
});
