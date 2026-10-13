import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../js/defaults.js';
import { buildContext } from '../js/analysis.js';
import { bucketOf, spendTables } from '../js/buckets.js';

let n = 0;
const tx = (date, amount, categoryId, merchant, accountId = 'a') => ({ id: 't' + (++n), hash: 'h' + n, accountId, date, amount, description: merchant, merchant, merchantName: merchant, categoryId, status: 'confirmed' });

function setup() {
  const s = defaultState();
  s.transactions = [
    tx('2026-09-01', -900, 'vivienda', 'landlord'),
    tx('2026-09-03', -48.2, 'suministros', 'endesa'),
    tx('2026-09-10', -13.99, 'suscripciones', 'netflix', 'subs'),
    tx('2026-08-10', -13.99, 'suscripciones', 'netflix', 'subs'),
    tx('2026-07-10', -13.99, 'suscripciones', 'netflix', 'subs'),
    tx('2026-09-05', -14, 'delivery', 'glovo'),
    tx('2026-09-06', -59.99, 'supermercado', 'mercadona'),
    tx('2026-09-07', -60, 'supermercado', 'mercadona'),
    tx('2026-09-15', -25, 'compras', 'zara'),
    tx('2026-09-16', -180, 'compras', 'ikea', 'shared'),
    tx('2026-09-17', 10, 'compras', 'zara'), // refund
    tx('2026-09-20', 2500, 'nomina', 'empresa'),
    tx('2026-09-21', -300, 'traspaso', 'own transfer'),
    tx('2026-09-22', -200, 'inversion', 'tr savings plan'),
    tx('2026-09-23', -45, 'deporte', 'decathlon'),
  ];
  return s;
}

test('buckets: fixed categories are recurring; the limit splits the rest', () => {
  const s = setup();
  const ctx = buildContext(s);
  const b = t => bucketOf(s.transactions.find(x => x.merchant === t.m && x.amount === t.a), ctx, 60);
  assert.equal(b({ m: 'landlord', a: -900 }), 'recurring');
  assert.equal(b({ m: 'endesa', a: -48.2 }), 'recurring');
  assert.equal(b({ m: 'netflix', a: -13.99 }), 'recurring');
  assert.equal(b({ m: 'glovo', a: -14 }), 'daily');
  assert.equal(b({ m: 'mercadona', a: -59.99 }), 'daily');
  assert.equal(b({ m: 'mercadona', a: -60 }), 'large'); // €60 and over is not day-to-day
  assert.equal(b({ m: 'zara', a: -25 }), 'daily'); // shopping under the limit is day-to-day
  assert.equal(b({ m: 'ikea', a: -180 }), 'large');
  assert.equal(b({ m: 'empresa', a: 2500 }), null);
  assert.equal(b({ m: 'own transfer', a: -300 }), null);
  assert.equal(b({ m: 'tr savings plan', a: -200 }), null);
  // Sport is a fixed category, but a single shop purchase is not a recurring bill.
  assert.equal(b({ m: 'decathlon', a: -45 }), 'daily');
});

test('spend tables: totals, recurring grouped by merchant, refunds reduce spend', () => {
  const s = setup();
  const ctx = buildContext(s);
  const t = spendTables(ctx, ['2026-09'], { limit: 60 });
  assert.equal(t.recurring.total, 962.19);
  assert.deepEqual(t.recurring.rows.map(r => r.merchant), ['landlord', 'endesa', 'netflix']);
  assert.equal(t.recurring.rows.find(r => r.merchant === 'netflix').cadence, 'Monthly');
  assert.equal(t.daily.total, 133.99);
  assert.equal(t.daily.rows.length, 5);
  assert.equal(t.large.total, 240);
  assert.deepEqual(t.large.rows.map(r => r.merchant), ['ikea', 'mercadona']);
  // Three months: Netflix counted three times in one row.
  const q = spendTables(ctx, ['2026-07', '2026-08', '2026-09'], { limit: 60 });
  assert.equal(q.recurring.rows.find(r => r.merchant === 'netflix').count, 3);
});

test('spend tables: account filter and a different limit', () => {
  const s = setup();
  const ctx = buildContext(s);
  const subs = spendTables(ctx, ['2026-09'], { accountIds: ['subs'] });
  assert.equal(subs.recurring.total, 13.99);
  assert.equal(subs.daily.total, 0);
  const t = spendTables(ctx, ['2026-09'], { limit: 20 });
  assert.equal(t.daily.rows.length, 2); // glovo 14 and the 10 refund
  assert.equal(t.large.rows.length, 5);
});
