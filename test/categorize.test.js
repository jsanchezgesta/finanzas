import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMerchant } from '../js/merchant.js';
import { defaultState } from '../js/defaults.js';
import { buildImport, commitImport } from '../js/importer.js';
import { analyzeRows, parseCSV } from '../js/parse.js';
import { confirmCategory, reviewGroups, keywordSuggestion } from '../js/categorize.js';
import { buildContext, detectRecurring, natureOf, summarize, catMap } from '../js/analysis.js';

test('normalizes merchants from noisy descriptions', () => {
  assert.equal(normalizeMerchant('COMPRA TARJ. 5402XXXXXXXX1234 MERCADONA BARCELONA 12/10').key, 'mercadona');
  assert.equal(normalizeMerchant('MERCADONA SA').key, 'mercadona');
  assert.equal(normalizeMerchant('PAYPAL *NETFLIX').key, 'netflix');
  assert.equal(normalizeMerchant('RECIBO NETFLIX.COM').key, 'netflix');
  assert.equal(normalizeMerchant('AMZN MKTP ES*2K4J23HV1').key, 'amzn mktp');
  assert.equal(normalizeMerchant('BIZUM ENVIADO A JUAN PEREZ').key, 'bizum a juan perez');
  assert.equal(normalizeMerchant('Card transaction SPOTIFY P2F3A1B2C3').key, 'spotify');
  // Generic first column: the real counterparty is in the next one.
  assert.equal(normalizeMerchant('TRANSFERENCIA A FAVOR DE · NOMINA EMPRESA SL').key, 'nomina empresa');
  assert.equal(normalizeMerchant('TRANSFERENCIA A FAVOR DE · ALQUILER PISO GRACIA').key, 'alquiler piso gracia');
  assert.equal(normalizeMerchant('COMPRA TARJ. 5402XXXXXXXX7731 · MERCADONA SA').key, 'mercadona');
  assert.equal(normalizeMerchant('BIZUM ENVIADO A · LAURA GIL').key, 'bizum a laura gil');
});

test('keyword hints suggest categories', () => {
  const s = defaultState();
  assert.equal(keywordSuggestion({ description: 'COMPRA TARJ MERCADONA', amount: -10 }, s.categories), 'supermercado');
  assert.equal(keywordSuggestion({ description: 'Savings plan execution IE00BK5BQT80', amount: -250 }, s.categories), 'inversion');
  assert.equal(keywordSuggestion({ description: 'NOMINA OCTUBRE', amount: 2000 }, s.categories), 'nomina');
  assert.equal(keywordSuggestion({ description: 'NOMINA OCTUBRE', amount: -2000 }, s.categories), null);
});

function csvFor(rows) {
  return 'Fecha;Concepto;Importe\n' + rows.map(r => r.join(';')).join('\n');
}

function importCsv(state, csv, accountId = 'a1') {
  const a = analyzeRows(parseCSV(csv));
  const built = buildImport(state, a, a.mapping, accountId);
  return commitImport(state, built, { fileName: 'x.csv', accountId, signature: a.signature, mapping: a.mapping });
}

test('learned rules auto-categorize the next import; duplicates are skipped', () => {
  const s = defaultState();
  s.accounts.push({ id: 'a1', name: 'Caixa' });
  const r1 = importCsv(s, csvFor([
    ['01/09/2026', 'COMPRA TARJ MERCADONA BARCELONA', '-40,10'],
    ['08/09/2026', 'COMPRA TARJ MERCADONA BARCELONA', '-32,00'],
    ['08/09/2026', 'BAR PEPE', '-3,50'],
    ['08/09/2026', 'BAR PEPE', '-3,50'],
  ]));
  assert.equal(r1.count, 4);
  assert.equal(r1.pending, 4);
  const groups = reviewGroups(s);
  assert.equal(groups.length, 2);
  const merc = groups.find(g => g.merchant === 'mercadona');
  assert.equal(merc.suggestion, 'supermercado');
  confirmCategory(s, merc.txs.map(t => t.id), 'supermercado');
  assert.equal(reviewGroups(s).length, 1);

  // Overlapping second export: two old rows (incl. the identical coffee pair) + one new.
  const r2 = importCsv(s, csvFor([
    ['08/09/2026', 'BAR PEPE', '-3,50'],
    ['08/09/2026', 'BAR PEPE', '-3,50'],
    ['15/09/2026', 'COMPRA TARJ MERCADONA SA', '-50,00'],
  ]));
  assert.equal(r2.dupes, 2);
  assert.equal(r2.count, 1);
  assert.equal(r2.auto, 1);
  const newTx = s.transactions.find(t => t.date === '2026-09-15');
  assert.equal(newTx.categoryId, 'supermercado');
  assert.equal(newTx.status, 'auto');
});

test('internal transfers between accounts are paired', () => {
  const s = defaultState();
  importCsv(s, csvFor([['01/09/2026', 'TRANSFERENCIA A TRADE REPUBLIC', '-500,00']]), 'caixa');
  importCsv(s, 'Date,Description,Amount\n2026-09-02,Incoming transfer from JAVIER,500.00\n', 'tr');
  const groups = reviewGroups(s);
  assert.ok(groups.every(g => g.suggestion === 'traspaso'));
});

test('detects recurring payments and classifies spend nature', () => {
  const s = defaultState();
  const rows = [];
  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, '0');
    rows.push([`03/${mm}/2026`, 'RECIBO NETFLIX.COM', '-13,99']);
    rows.push([`01/${mm}/2026`, 'ALQUILER PISO', '-950,00']);
    rows.push([`28/${mm}/2026`, 'NOMINA EMPRESA', '2500,00']);
    rows.push([`10/${mm}/2026`, 'COMPRA TARJ MERCADONA', `-${40 + m * 7},00`]);
    rows.push([`20/${mm}/2026`, 'COMPRA TARJ MERCADONA', `-${30 + m * 3},00`]);
  }
  rows.push(['15/03/2026', 'MEDIAMARKT', '-799,00']);
  rows.push(['05/06/2026', 'Savings plan execution', '-300,00']);
  importCsv(s, csvFor(rows));
  for (const g of reviewGroups(s)) {
    const cat = g.merchant.includes('alquiler') ? 'vivienda' : g.merchant.includes('nomina') ? 'nomina' : g.suggestion || 'otros';
    confirmCategory(s, g.txs.map(t => t.id), cat);
  }
  const rec = detectRecurring(s.transactions, catMap(s));
  const names = [...rec.values()].map(r => r.merchant).sort();
  assert.ok(names.includes('netflix'));
  assert.ok(names.includes('alquiler piso'));
  assert.ok(names.includes('nomina empresa'));
  assert.ok(!names.includes('mercadona'));
  const netflix = [...rec.values()].find(r => r.merchant === 'netflix');
  assert.equal(netflix.cadence, 'monthly');
  assert.equal(netflix.monthly, 13.99);

  const ctx = buildContext(s);
  const find = d => s.transactions.find(t => t.description.includes(d));
  assert.equal(natureOf(find('NETFLIX'), ctx), 'fixed');
  assert.equal(natureOf(find('MERCADONA'), ctx), 'variable');
  assert.equal(natureOf(find('MEDIAMARKT'), ctx), 'oneoff');
  assert.equal(natureOf(find('Savings plan'), ctx), 'investment');

  const { total } = summarize(ctx, ['2026-03']);
  assert.equal(total.income, 2500);
  assert.equal(Math.round(total.byNature.oneoff), 799);
  assert.equal(Math.round(total.byNature.fixed * 100) / 100, 963.99);
});
