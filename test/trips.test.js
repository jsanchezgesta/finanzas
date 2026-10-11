import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../js/defaults.js';
import { buildContext } from '../js/analysis.js';
import { newTrip, assignTrips, setTrip, tripSummary, tripCandidates, tripCategoryOf, setTripCategory } from '../js/trips.js';

let n = 0;
const tx = (date, amount, categoryId, extra = {}) => ({ id: 't' + (++n), hash: 'h' + n, accountId: 'a', date, amount, description: extra.desc || 'X', merchant: extra.merchant || 'm' + n, merchantName: 'M', categoryId, status: 'confirmed', ...extra });

function setup() {
  const s = defaultState();
  s.transactions = [
    tx('2026-06-01', -950, 'vivienda'),                 // rent inside the dates: fixed category, stays out
    tx('2026-06-02', -45, 'restaurantes'),              // in
    tx('2026-06-03', -20, 'transporte'),                // in
    tx('2026-06-03', 2500, 'nomina'),                   // income: out
    tx('2026-06-04', -300, 'inversion'),                // investment: out
    tx('2026-06-04', 12, 'restaurantes'),               // refund in an expense category: in, reduces spend
    tx('2026-04-10', -180, 'viajes', { merchant: 'vueling' }),  // flight booked earlier: suggestion
    tx('2026-05-30', -30, 'restaurantes', { tr: { kind: 'card', originalCurrency: 'GBP' } }), // foreign, 2 days before: suggestion
    tx('2026-07-20', -50, 'restaurantes'),              // unrelated
  ];
  s.trips = [newTrip({ name: 'Londres', start: '2026-06-01', end: '2026-06-05', budget: 500, catBudgets: { restaurantes: 100 } })];
  return s;
}

test('auto-assigns expenses inside the trip dates, skipping fixed bills, income and investment', () => {
  const s = setup();
  assignTrips(s, buildContext(s));
  const inTrip = s.transactions.filter(t => t.tripId).map(t => t.amount).sort((a, b) => a - b);
  assert.deepEqual(inTrip, [-45, -20, 12]);
});

test('summary, candidates and manual add/remove', () => {
  const s = setup();
  const trip = s.trips[0];
  let ctx = buildContext(s);
  assignTrips(s, ctx);
  const sum = tripSummary(s, trip, ctx, '2026-06-03');
  assert.equal(sum.spent, 53);
  assert.equal(sum.days, 5);
  assert.equal(sum.status, 'ongoing');
  assert.equal(sum.elapsed, 3);
  assert.equal(sum.byCategory.comida, 33);
  assert.equal(sum.byCategory.transporte, 20);
  assert.equal(sum.dailyBudget, 100);

  const cands = tripCandidates(s, trip, ctx).map(t => t.amount).sort((a, b) => a - b);
  assert.deepEqual(cands, [-180, -30]);

  // Add the flight; it counts as spend before the trip and survives re-assignment.
  const flight = s.transactions.find(t => t.merchant === 'vueling');
  setTrip(s, [flight.id], trip.id);
  assignTrips(s, buildContext(s));
  const after = tripSummary(s, trip, buildContext(s), '2026-06-03');
  assert.equal(after.spent, 233);
  assert.equal(after.before, 180);
  assert.equal(after.perDay, round(53 / 3));

  // Removing an in-date expense by hand keeps it out.
  const taxi = s.transactions.find(t => t.amount === -20);
  setTrip(s, [taxi.id], null);
  assignTrips(s, buildContext(s));
  assert.equal(taxi.tripId, null);
});

function round(v) { return Math.round(v * 100) / 100; }

test('trip categories: derived from MCC, merchant name and monthly category; user override wins', () => {
  const s = defaultState();
  const ctx = buildContext(s);
  const c = (o) => tripCategoryOf({ description: o.desc || '', merchantName: o.desc || '', categoryId: o.cat || null, tr: o.mcc ? { mcc: o.mcc } : undefined, tripCat: o.tripCat }, ctx);
  assert.equal(c({ desc: 'VUELING AIRLINES', cat: 'viajes' }), 'vuelos');
  assert.equal(c({ desc: 'BOOKING.COM HOTEL', cat: 'viajes' }), 'alojamiento');
  assert.equal(c({ desc: 'AIRBNB PAYMENTS' }), 'alojamiento');
  assert.equal(c({ desc: 'RENFE VIAJEROS', cat: 'transporte' }), 'transporte');
  assert.equal(c({ desc: 'HERTZ RENT A CAR', cat: 'viajes' }), 'transporte');
  assert.equal(c({ desc: 'DISHOOM', mcc: '5812' }), 'comida');
  assert.equal(c({ desc: 'TFL TRAVEL CH', mcc: '4111' }), 'transporte');
  assert.equal(c({ desc: 'SOME HOTEL', mcc: '7011' }), 'alojamiento');
  assert.equal(c({ desc: 'MUSEO PRADO', cat: 'ocio' }), 'actividades');
  assert.equal(c({ desc: 'MERCADONA', cat: 'supermercado' }), 'comida');
  assert.equal(c({ desc: 'ZARA', cat: 'compras' }), 'otros');
  assert.equal(c({ desc: 'ZARA', cat: 'compras', tripCat: 'actividades' }), 'actividades');
  const t = { id: 'x', description: 'ZARA' }; s.transactions = [t];
  setTripCategory(s, ['x'], 'comida');
  assert.equal(t.tripCat, 'comida');
});
