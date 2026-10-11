import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../js/defaults.js';
import { buildContext } from '../js/analysis.js';
import { futureValue, futureValueMonthly, coachMonth, reviewQueue, rateMerchant, rateTransaction, valueOf } from '../js/coach.js';

let n = 0;
const tx = (date, amount, categoryId, merchant) => ({ id: 't' + (++n), hash: 'h' + n, accountId: 'a', date, amount, description: merchant, merchant, merchantName: merchant, categoryId, status: 'confirmed' });

test('future value maths', () => {
  assert.equal(futureValue(100, 0.07, 10), 196.72);
  // 100 €/month for 10 years at 7%/year ≈ 17,409 € (monthly compounding, start of month)
  const v = futureValueMonthly(100, 0.07, 10);
  assert.ok(v > 17000 && v < 17600, String(v));
  assert.equal(futureValueMonthly(100, 0, 10), 12000);
});

function setup() {
  const s = defaultState();
  s.transactions = [
    tx('2026-09-02', -60, 'supermercado', 'mercadona'),
    tx('2026-09-05', -14, 'delivery', 'glovo'),
    tx('2026-09-12', -22, 'delivery', 'glovo'),
    tx('2026-09-10', -13.99, 'suscripciones', 'netflix'),
    tx('2026-09-15', -80, 'compras', 'amazon'),
    tx('2026-08-10', -13.99, 'suscripciones', 'netflix'),
    tx('2026-07-10', -13.99, 'suscripciones', 'netflix'),
    tx('2026-09-20', 2500, 'nomina', 'empresa'),
  ];
  return s;
}

test('values: essentials default to need; merchant ratings and per-transaction overrides', () => {
  const s = setup();
  const ctx = buildContext(s);
  assert.equal(valueOf(s, s.transactions[0], ctx), 'need');
  assert.equal(valueOf(s, s.transactions[1], ctx), null);
  rateMerchant(s, 'glovo', 'like');
  rateMerchant(s, 'netflix', 'want');
  const amazon = s.transactions.find(t => t.merchant === 'amazon');
  rateTransaction(s, amazon.id, 'like');
  const c = coachMonth(s, ctx, '2026-09');
  assert.equal(c.likeTotal, 116);
  assert.equal(c.wantTotal, 13.99);
  assert.equal(c.needTotal, 60);
  assert.equal(c.likeFV, futureValue(116, 0.07, 10));
});

test('review queue: unrated discretionary and recurring merchants, re-asked after the interval', () => {
  const s = setup();
  const today = '2026-09-30';
  let q = reviewQueue(s, buildContext(s), today).map(g => g.merchant);
  assert.ok(q.includes('glovo') && q.includes('netflix') && q.includes('amazon'));
  assert.ok(!q.includes('mercadona')); // essential, not recurring
  const now = Date.parse('2026-09-30T12:00:00Z');
  rateMerchant(s, 'glovo', 'like', now);
  q = reviewQueue(s, buildContext(s), today).map(g => g.merchant);
  assert.ok(!q.includes('glovo'));
  // 100 days later it is due again (if still spending there).
  s.transactions.push(tx('2027-01-05', -18, 'delivery', 'glovo'));
  q = reviewQueue(s, buildContext(s), '2027-01-08').map(g => g.merchant);
  assert.ok(q.includes('glovo'));
});
