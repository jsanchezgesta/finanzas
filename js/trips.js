// Trips: a date range with a budget. Expenses inside the dates are assigned
// automatically; bookings made earlier are offered as suggestions.
//
// Transaction fields used:
//   tripId       trip the expense belongs to (or null)
//   tripManual   true when the user added/removed it by hand; auto-assignment
//                then leaves it alone

import { natureOf } from './analysis.js';
import { cleanDescription } from './merchant.js';

// Trip-only categories, independent of the monthly ones.
export const TRIP_CATEGORIES = [
  { id: 'vuelos', name: 'Vuelos', icon: '✈️', color: '#2a9dc4' },
  { id: 'alojamiento', name: 'Alojamiento', icon: '🏨', color: '#7b6bb0' },
  { id: 'transporte', name: 'Transporte', icon: '🚕', color: '#4a7f9e' },
  { id: 'comida', name: 'Comida', icon: '🍽️', color: '#e07a5f' },
  { id: 'actividades', name: 'Actividades', icon: '🎟️', color: '#c06c84' },
  { id: 'otros', name: 'Otros y prepagos', icon: '🧳', color: '#a0a6ad' },
];
const TRIP_CAT_IDS = new Set(TRIP_CATEGORIES.map(c => c.id));

const FLIGHT = /RYANAIR|VUELING|IBERIA|EASYJET|WIZZ|AIR EUROPA|LEVEL|TAP AIR|LUFTHANSA|KLM|AIR FRANCE|BRITISH AIRWAYS|TRANSAVIA|BINTER|VOLOTEA|EUROWINGS|TURKISH|EMIRATES|QATAR|AIRLINE|AIRWAYS|AEROLINEA|SKYSCANNER|KIWI.COM|EDREAMS|LASTMINUTE/;
const STAY = /HOTEL|HOSTAL|HOSTEL|BOOKING|AIRBNB|EXPEDIA|APARTAMENT|APARTMENT|B&B|GUEST ?HOUSE|POSADA|RESORT|PARADOR|AGODA|HOTELS\.COM|VRBO|CAMPING/;
const MOVE = /RENFE|OUIGO|IRYO|TRAINLINE|TRENITALIA|SNCF|DB BAHN|ALSA|FLIXBUS|BLABLACAR|UBER|CABIFY|BOLT|TAXI|FREENOW|HERTZ|AVIS|SIXT|EUROPCAR|GOLDCAR|ENTERPRISE|METRO|TFL|BUS|FERRY|PEAJE|PARKING|GASOLIN|REPSOL|CEPSA|SHELL|EXPRESS/;

// Travel insurance, visas, eSIMs, vaccines: paid before the trip.
const PREPAID = /SEGURO (DE )?VIAJE|TRAVEL INSURANCE|IATI|HEYMONDO|CHAPKA|INTERMUNDIAL|MONDO|VISA (FEE|APPLICATION)|VISADO|EVISA|E-VISA|ESTA |ETIAS|ETA UK|HOLAFLY|AIRALO|UBIGI|NOMAD ESIM|ESIM|VACUNA|VACCIN|SANIDAD EXTERIOR/;

function mccNum(t) { const n = parseInt(t.tr?.mcc, 10); return isFinite(n) ? n : null; }

// Trip category for a transaction: the user's choice, or derived from the
// merchant code, the merchant name and its monthly category.
export function tripCategoryOf(t, ctx) {
  if (t.tripCat && TRIP_CAT_IDS.has(t.tripCat)) return t.tripCat;
  const text = cleanDescription(t.description + ' ' + (t.merchantName || ''));
  const mcc = mccNum(t);
  if (mcc != null) {
    if ((mcc >= 3000 && mcc <= 3350) || mcc === 4511 || mcc === 4582) return 'vuelos';
    if ((mcc >= 3501 && mcc <= 3999) || mcc === 7011 || mcc === 7012 || mcc === 7032 || mcc === 7033) return 'alojamiento';
    if ((mcc >= 4111 && mcc <= 4131) || mcc === 4411 || mcc === 4784 || (mcc >= 3351 && mcc <= 3500) || (mcc >= 7512 && mcc <= 7519) || mcc === 5541 || mcc === 5542 || mcc === 7523) return 'transporte';
    if ((mcc >= 5811 && mcc <= 5814) || mcc === 5411 || mcc === 5499 || mcc === 5462 || mcc === 5441 || mcc === 5422) return 'comida';
    if (mcc === 7991 || mcc === 7996 || mcc === 7998 || mcc === 7999 || mcc === 7922 || mcc === 7929 || mcc === 7832 || mcc === 7941 || mcc === 4722 || mcc === 5942) return 'actividades';
  }
  if (PREPAID.test(text)) return 'otros';
  if (FLIGHT.test(text)) return 'vuelos';
  if (STAY.test(text)) return 'alojamiento';
  const cat = t.categoryId;
  if (['restaurantes', 'delivery', 'supermercado'].includes(cat)) return 'comida';
  if (cat === 'transporte' || MOVE.test(text)) return 'transporte';
  if (['ocio', 'deporte', 'cuidado', 'formacion'].includes(cat)) return 'actividades';
  return 'otros';
}

// The trip budget is the sum of its category budgets when any are set;
// otherwise the total typed when creating the trip.
export function tripBudget(trip) {
  const sum = Object.values(trip.catBudgets || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  return sum > 0 ? round2(sum) : Number(trip.budget) || 0;
}

export function setTripCategory(state, txIds, tripCat) {
  const ids = new Set(txIds);
  for (const t of state.transactions) if (ids.has(t.id)) t.tripCat = tripCat || null;
}
import { daysBetween, addDays, round2, uid } from './util.js';

export function newTrip({ name, start, end, budget = 0, catBudgets = {}, emoji = '✈️' }) {
  return { id: uid(), name, start, end, budget: Number(budget) || 0, catBudgets, emoji, createdAt: Date.now() };
}

function isForeign(t) {
  const c = t.tr?.originalCurrency;
  return (c && c !== 'EUR') || /INTERNATIONAL/i.test(t.tr?.type || '');
}

// Can this transaction be trip spending at all?
// Merchants used at home in 3+ different months outside any trip (Mercadona,
// Amazon, Bizum to a flatmate). Inside trip dates they're suggested, not
// assigned, unless paid in a foreign currency.
export function homeMerchants(state) {
  const trips = state.trips || [];
  const months = new Map();
  for (const t of state.transactions) {
    if (t.amount >= 0 || trips.some(tr => t.date >= tr.start && t.date <= tr.end)) continue;
    if (!months.has(t.merchant)) months.set(t.merchant, new Set());
    months.get(t.merchant).add(t.date.slice(0, 7));
  }
  return new Set([...months].filter(([, m]) => m.size >= 3).map(([k]) => k));
}

function eligible(t, ctx, home) {
  if (home?.has(t.merchant) && !isForeign(t)) return false;
  const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
  if (cat && cat.kind !== 'expense') return false; // income, investment, transfers
  if (!cat && t.amount >= 0) return false;
  if (natureOf(t, ctx) === 'fixed') return false; // rent, subscriptions, bills keep running at home
  return true; // includes refunds in expense categories
}

// Apply automatic assignment for every trip. Returns how many changed.
export function assignTrips(state, ctx) {
  let changed = 0;
  const trips = [...(state.trips || [])].sort((a, b) => a.start.localeCompare(b.start));
  const ids = new Set(trips.map(t => t.id));
  const home = homeMerchants(state);
  for (const t of state.transactions) {
    if (t.tripManual) {
      if (t.tripId && !ids.has(t.tripId)) { t.tripId = null; t.tripManual = false; changed++; }
      continue;
    }
    const trip = trips.find(tr => t.date >= tr.start && t.date <= tr.end);
    const want = trip && eligible(t, ctx, home) ? trip.id : null;
    if ((t.tripId || null) !== want) { t.tripId = want; changed++; }
  }
  return changed;
}

export function setTrip(state, txIds, tripId) {
  const ids = new Set(txIds);
  for (const t of state.transactions) if (ids.has(t.id)) { t.tripId = tripId || null; t.tripManual = true; }
}

export function tripTransactions(state, tripId) {
  return state.transactions.filter(t => t.tripId === tripId).sort((a, b) => b.date.localeCompare(a.date));
}

// Planned payments ("pagos previstos") on a trip:
//   { id, name, tripCat, amount, paid, txId }
// A paid item linked to an imported movement isn't counted twice. A paid item
// without a link is matched to a trip movement of about the same amount; if
// none matches it counts as paid outside your accounts (cash, someone else's card).
function matchItems(trip, txs) {
  const used = new Set();
  const links = new Map();
  for (const it of trip.items || []) {
    if (it.txId && txs.some(t => t.id === it.txId)) { used.add(it.txId); links.set(it.id, it.txId); }
  }
  for (const it of trip.items || []) {
    if (!it.paid || links.has(it.id)) continue;
    const m = txs.find(t => !used.has(t.id) && Math.abs(-t.amount - it.amount) <= Math.max(1, it.amount * 0.02));
    if (m) { used.add(m.id); links.set(it.id, m.id); }
  }
  return links;
}

export function tripSummary(state, trip, ctx, today = new Date().toISOString().slice(0, 10)) {
  const txs = tripTransactions(state, trip.id);
  const byCategory = {};
  const pendingByCategory = {};
  let spent = 0, before = 0, pending = 0, paidOutside = 0;
  for (const t of txs) {
    const v = -t.amount;
    spent += v;
    if (t.date < trip.start) before += v;
    const k = tripCategoryOf(t, ctx);
    byCategory[k] = (byCategory[k] || 0) + v;
  }
  const links = matchItems(trip, txs);
  const items = (trip.items || []).map(it => {
    const linkedTx = links.has(it.id) ? txs.find(t => t.id === links.get(it.id)) : null;
    const k = it.tripCat || 'otros';
    if (!it.paid) { pending += it.amount; pendingByCategory[k] = (pendingByCategory[k] || 0) + it.amount; }
    else if (!linkedTx) { paidOutside += it.amount; spent += it.amount; before += it.amount; byCategory[k] = (byCategory[k] || 0) + it.amount; }
    return { ...it, linkedTx };
  });
  const days = daysBetween(trip.start, trip.end) + 1;
  const status = today < trip.start ? 'upcoming' : today > trip.end ? 'done' : 'ongoing';
  const elapsed = status === 'upcoming' ? 0 : status === 'done' ? days : daysBetween(trip.start, today) + 1;
  const onTrip = spent - before; // spend during the trip itself, without advance bookings
  const perDay = elapsed ? onTrip / elapsed : 0;
  const projected = status === 'ongoing' ? before + pending + perDay * days : spent + pending;
  const r2 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)]));
  return {
    trip, txs, items, count: txs.length, status, days, elapsed,
    spent: round2(spent), before: round2(before), pending: round2(pending), paidOutside: round2(paidOutside),
    committed: round2(spent + pending),
    budget: tripBudget(trip),
    budgetFromCategories: Object.values(trip.catBudgets || {}).some(v => Number(v) > 0),
    remaining: round2(tripBudget(trip) - spent - pending),
    dailyBudget: tripBudget(trip) ? round2(tripBudget(trip) / days) : 0,
    perDay: round2(perDay),
    projected: round2(projected),
    byCategory: r2(byCategory),
    pendingByCategory: r2(pendingByCategory),
  };
}

export function addTripItem(state, tripId, { name, tripCat = 'otros', amount, paid = false }) {
  const t = state.trips.find(x => x.id === tripId);
  t.items = t.items || [];
  const item = { id: uid(), name, tripCat, amount: round2(Number(amount) || 0), paid, txId: null };
  t.items.push(item);
  return item;
}

export function updateTripItem(state, tripId, itemId, patch) {
  const t = state.trips.find(x => x.id === tripId);
  const it = t?.items?.find(i => i.id === itemId);
  if (it) Object.assign(it, patch);
}

export function removeTripItem(state, tripId, itemId) {
  const t = state.trips.find(x => x.id === tripId);
  if (t) t.items = (t.items || []).filter(i => i.id !== itemId);
}

// Expenses that look like they belong to the trip but weren't auto-assigned:
// travel bookings in the 4 months before, and foreign-currency payments
// a few days either side.
export function tripCandidates(state, trip, ctx) {
  const from = addDays(trip.start, -120), to = addDays(trip.end, 7);
  const home = homeMerchants(state);
  return state.transactions.filter(t => {
    if (t.tripId || t.date < from || t.date > to) return false;
    if (t.tripManual) return false; // user removed it on purpose
    if (t.amount >= 0) return false;
    const travel = t.categoryId === 'viajes' || ['vuelos', 'alojamiento'].includes(tripCategoryOf(t, ctx));
    const foreign = isForeign(t) && t.date >= addDays(trip.start, -3);
    const inDatesHome = t.date >= trip.start && t.date <= trip.end && home.has(t.merchant) && eligible({ ...t, merchant: '' }, ctx, null);
    if (inDatesHome) { t._reason = 'home'; return true; }
    if (!travel && !foreign) return false;
    t._reason = travel ? 'booking' : 'foreign';
    // A booking can't belong to this trip if it falls inside another trip.
    return !(state.trips || []).some(o => o.id !== trip.id && t.date >= o.start && t.date <= o.end);
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export function tripsInMonths(state, months) {
  const set = new Set(months);
  const out = new Map();
  for (const t of state.transactions) {
    if (!t.tripId || !set.has(t.date.slice(0, 7))) continue;
    out.set(t.tripId, (out.get(t.tripId) || 0) - t.amount);
  }
  return out;
}
