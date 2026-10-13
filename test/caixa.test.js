import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows, parseCSV } from '../js/parse.js';
import { splitByAccount, accountLabel, caixaColumns, caixaRowsToTransactions } from '../js/caixa.js';
import { defaultState } from '../js/defaults.js';
import { buildImport, commitImport } from '../js/importer.js';
import { buildContext, summarize } from '../js/analysis.js';

// Fictional CaixaBank export with the real column layout: a title block, a
// header row, two accounts in one file, and a header repeated inside the data.
const ACC_A = '2100 1111 11 1111111111';
const ACC_B = '2100 2222 22 2222222222';
const HEADER = ['', 'Número de cuenta', 'Oficina', 'Divisa', 'F. Operación', 'F. Valor', 'Ingreso (+)', 'Gasto (-)', 'Saldo (+)', 'Saldo (-)', 'Concepto común', 'Concepto propio', 'Referencia 1', 'Referencia 2', ...Array.from({ length: 10 }, (_, i) => 'Concepto complementario ' + (i + 1))];

function line(o) {
  const comp = Array.from({ length: 10 }, (_, i) => o.comp?.[i] ?? '');
  return ['', o.acc, '0681', 'EUR', o.date, o.date, o.in ?? '', o.out ?? '', '', '', o.common ?? '04', o.own ?? '067', '000000000000', o.ref2 ?? '', ...comp]
    .map(v => (String(v).includes(',') ? `"${v}"` : v)).join(',');
}

const A = (o) => line({ acc: ACC_A, ...o });
const B = (o) => line({ acc: ACC_B, ...o });
const CSV = [
  ',,,,,,,,,,,,,,,,,,,,,,,,',
  ',MOVIMIENTOS DESDE : 01/01/2026 HASTA: 30/09/2026,,,,,,,,,,,,,,,,,,,,,,,',
  ',,,,,,,,,,,,,,,,,,,,,,,,',
  HEADER.join(','),
  A({ date: '01/09/2026', in: '2500', common: '02', comp: ['ORIGEN: EMPRESA EJEMPLO SL', 'Nomina septiembre'] }),
  A({ date: '05/09/2026', out: '45.20', common: '12', own: '040', ref2: '5222000000000001', comp: ['SUPERMERCADO EJEMPLO', '', '', '', '', '', '', '', '', 'COMPRA CON TARJETA'] }),
  A({ date: '10/09/2026', out: '7.99', comp: ['Ice cream', '', '', 'TRASPASO PROPIO'] }),
  A({ date: '10/09/2026', in: '7.99', comp: ['Ice cream', '', '', 'TRASPASO PROPIO'] }),
  A({ date: '12/09/2026', out: '120', comp: ['JAVIER EJEMPLO PEREZ', 'Peluqueria', '', 'TRASPASO PROPIO'] }),
  A({ date: '16/09/2026', out: '60', comp: ['JAVIER EJEMPLO PEREZ', 'Bizum'] }),
  A({ date: '14/09/2026', in: '550', ref2: 'TRBKESM2XXX', comp: ['Javier Ejemplo', 'Suscripciones monthly funds'] }),
  'Oficina,Concepto común,Concepto propio',
  B({ date: '12/09/2026', in: '120', comp: ['Peluqueria', '', '', 'TRASPASO PROPIO'] }),
  B({ date: '20/09/2026', out: '30', common: '12', own: '040', comp: ['RESTAURANTE EJEMPLO', '', '', '', '', '', '', '', '', 'COMPRA CON TARJETA'] }),
].join('\n');

const TR_HEADER = 'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code';
const tr = (o) => ['2026-09-13T10:00:00Z', o.date, 'DEFAULT', 'CASH', o.type, '', o.name || '', '', '', '', o.amount, '', '', 'EUR', '', '', '', o.desc || '', o.id, '', '', '', ''].map(v => '"' + v + '"').join(',');
const TR_CSV = [TR_HEADER, tr({ date: '2026-09-13', type: 'TRANSFER_INSTANT_OUTBOUND', amount: '-550.00', name: 'Javier Ejemplo', desc: 'Outgoing transfer for Javier Ejemplo', id: 't1' })].join('\n');

function importInto(state, rows, label) {
  const a = analyzeRows(rows);
  const built = buildImport(state, a, a.mapping, state.accounts.find(x => x.name === label)?.id ?? (() => {
    const id = 'acc-' + label; state.accounts.push({ id, name: label, bank: 'CaixaBank' }); return id;
  })());
  return commitImport(state, built, { fileName: 'caixa.xls', accountId: built.fresh[0]?.accountId, signature: a.signature, mapping: a.mapping });
}

test('splits a multi-account CaixaBank file into one set of rows per account', () => {
  const parts = splitByAccount(parseCSV(CSV));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(p => p.label), [accountLabel(ACC_A), accountLabel(ACC_B)]);
  assert.equal(accountLabel(ACC_A), 'CaixaBank ····1111');
  // Repeated header rows are not treated as data.
  const a = analyzeRows(parts[0].rows);
  assert.equal(a.mapping.adapter, 'caixabank');
  assert.equal(a.label, 'CaixaBank ····1111');
});

test('descriptions are the merchant or counterparty, without bank codes', () => {
  const a = analyzeRows(splitByAccount(parseCSV(CSV))[0].rows);
  const { transactions } = caixaRowsToTransactions(a.data, a.mapping.cols);
  const d = transactions.map(t => t.description);
  assert.ok(d.includes('SUPERMERCADO EJEMPLO'));       // card code and boilerplate removed
  assert.ok(!d.some(x => /5222|TRBKESM2XXX|COMPRA CON/.test(x)));
  assert.ok(d.some(x => x.startsWith('EMPRESA EJEMPLO SL'))); // ORIGEN: removed
  const own = transactions.filter(t => t.ownTransfer).length;
  assert.equal(own, 5);                                // two same-account legs, the 120 transfer, the Trade Republic inflow and a payment to the holder's name
  assert.equal(transactions.find(t => t.description.includes('Javier Ejemplo')).forcedCategoryId, 'traspaso');
});

test('a payment to the holder name is suggested as a transfer, not settled', () => {
  const s = defaultState();
  for (const part of splitByAccount(parseCSV(CSV))) importInto(s, part.rows, part.label);
  const bizum = s.transactions.find(t => t.amount === -60);
  assert.equal(bizum.ownTransfer, true);
  assert.equal(bizum.status, 'pending');
  assert.equal(bizum.suggestedCategoryId, 'traspaso');
});

test('own-account transfers are excluded from income and spending; real income and spending stay', () => {
  const s = defaultState();
  for (const part of splitByAccount(parseCSV(CSV))) importInto(s, part.rows, part.label);
  assert.equal(s.transactions.find(t => t.amount === 550).categoryId, 'traspaso');
  assert.equal(s.transactions.find(t => t.amount === 550).status, 'auto');
  assert.equal(s.transactions.filter(t => t.amount === 120 && t.description.includes('Peluqueria')).every(t => t.categoryId === 'traspaso'), true);
  assert.equal(s.transactions.filter(t => t.categoryId === 'traspaso').length, 5);

  const ctx = buildContext(s);
  const { total } = summarize(ctx, ['2026-09']);
  assert.equal(total.income, 2500);
  assert.equal(total.expense, 75.2); // supermarket 45.20 + restaurant 30
});

test('a Trade Republic outflow pairs with the CaixaBank inflow, in either import order', () => {
  for (const order of ['caixa-first', 'tr-first']) {
    const s = defaultState();
    s.accounts.push({ id: 'tr', name: 'Trade Republic', bank: 'Trade Republic' });
    const parts = splitByAccount(parseCSV(CSV));
    const importTR = () => {
      const a = analyzeRows(parseCSV(TR_CSV));
      const built = buildImport(s, a, a.mapping, 'tr');
      commitImport(s, built, { fileName: 'tr.csv', accountId: 'tr', signature: a.signature, mapping: a.mapping });
    };
    if (order === 'tr-first') importTR();
    for (const part of parts) importInto(s, part.rows, part.label);
    if (order === 'caixa-first') importTR();
    const trOut = s.transactions.find(t => t.accountId === 'tr' && t.amount === -550);
    assert.equal(trOut.categoryId, 'traspaso', order);
    assert.equal(trOut.status, 'auto', order);
    const { total } = summarize(buildContext(s), ['2026-09']);
    assert.equal(total.expense, 75.2, order);
    assert.equal(total.income, 2500, order);
  }
});

test('card merchants that mix words and numbers keep their name', () => {
  const rows = [
    HEADER,
    A({ date: '10/10/2026', out: '1.75', common: '12', own: '040', ref2: '4800000000000001', comp: ['SUPER PALCK 2', '', '', '', '', '', '', '', '', '04000022SIO                           COMPRA CON TARJETA'] }),
    A({ date: '05/10/2026', out: '15.49', common: '12', own: '040', ref2: '4800000000000001', comp: ['Glovo 05OCT BTAZX', '', '', '', '', '', '', '', '', '04000022SIO                           COMPRA CON TARJETA'] }),
    A({ date: '04/10/2026', out: '28', common: '12', own: '040', ref2: '4800000000000001', comp: ['DIONISOS', '', '', '', '', '', '', '', '', '04000022SIO                           COMPRA CON TARJETA'] }),
    A({ date: '03/10/2026', out: '26', common: '12', own: '040', ref2: '4800000000000001', comp: ['HARTQUATERS', '', '', '', '', '', '', '', '', '04000022SIO                           COMPRA CON TARJETA'] }),
  ].join('\n');
  const a = analyzeRows(splitByAccount(parseCSV(rows))[0].rows);
  const d = caixaRowsToTransactions(a.data, a.mapping.cols).transactions.map(t => t.description);
  assert.deepEqual(d, ['SUPER PALCK 2', 'Glovo 05OCT BTAZX', 'DIONISOS', 'HARTQUATERS']);
});
