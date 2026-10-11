// Saving coach: value each expense as need / want / like, put a 10-year
// opportunity cost on avoidable ("like") spending, and bring merchants back
// for review on a schedule.
//
// state.values[merchant] = { v: 'need'|'want'|'like', at: timestamp }
// tx.value overrides the merchant value for one transaction (one-off buys).

import { monthKey, monthRange, daysBetween, round2 } from './util.js';

export const VALUE_LABELS = { need: 'Need', want: 'Want', like: 'Like' };
export const VALUE_HELP = {
  need: "You couldn't do without it",
  want: "Genuinely adds value; you'd keep it",
  like: "Avoidable: you wouldn't miss it",
};

export function coachSettings(state) {
  return { returnRate: 0.07, years: 10, reviewDays: 90, ...(state.settings.coach || {}) };
}

// Future value of a single amount invested today.
export function futureValue(amount, rate, years) {
  return round2(amount * Math.pow(1 + rate, years));
}

// Future value of investing the same amount every month.
export function futureValueMonthly(monthly, rate, years) {
  const r = Math.pow(1 + rate, 1 / 12) - 1;
  const n = years * 12;
  return round2(r === 0 ? monthly * n : monthly * ((Math.pow(1 + r, n) - 1) / r) * (1 + r));
}

export function valueOf(state, t, ctx) {
  if (t.value) return t.value;
  const mv = state.values?.[t.merchant]?.v;
  if (mv) return mv;
  const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
  if (cat?.need) return 'need'; // essentials don't need a review to count as needs
  return null;
}

function isSpend(t, ctx) {
  if (t.amount >= 0) return false;
  const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
  return !cat || cat.kind === 'expense';
}

// Avoidable ("like") and trimmable ("want") spending for a set of months.
export function coachMonth(state, ctx, month) {
  const cfg = coachSettings(state);
  const like = [], want = [];
  let likeTotal = 0, wantTotal = 0, needTotal = 0, unrated = 0;
  for (const t of state.transactions) {
    if (monthKey(t.date) !== month || !isSpend(t, ctx)) continue;
    const v = valueOf(state, t, ctx);
    const amt = -t.amount;
    if (v === 'like') { likeTotal += amt; like.push(t); }
    else if (v === 'want') { wantTotal += amt; want.push(t); }
    else if (v === 'need') needTotal += amt;
    else unrated += amt;
  }
  return {
    month, cfg, like, want,
    likeTotal: round2(likeTotal), wantTotal: round2(wantTotal), needTotal: round2(needTotal), unrated: round2(unrated),
    likeFV: futureValue(likeTotal, cfg.returnRate, cfg.years),
  };
}

export function coachTrend(state, ctx, endMonth, count = 12) {
  return monthRange(endMonth, count).map(m => {
    const c = coachMonth(state, ctx, m);
    return { month: m, like: c.likeTotal, want: c.wantTotal };
  });
}

// Merchants due for a value review: spent on in the last 90 days, not rated,
// or last rated longer ago than the review interval. Essentials (need
// categories) are only asked about when they recur, since those are the
// contracts worth re-checking (phone, insurance, gym).
export function reviewQueue(state, ctx, today = new Date().toISOString().slice(0, 10)) {
  const cfg = coachSettings(state);
  const since = new Date(Date.parse(today) - 90 * 86400000).toISOString().slice(0, 10);
  const groups = new Map();
  for (const t of state.transactions) {
    if (t.date < since || t.date > today || !isSpend(t, ctx) || t.status === 'pending') continue;
    if (!groups.has(t.merchant)) groups.set(t.merchant, { merchant: t.merchant, name: t.merchantName, total: 0, count: 0, categoryId: t.categoryId, last: t.date });
    const g = groups.get(t.merchant);
    g.total += -t.amount; g.count++;
    if (t.date > g.last) { g.last = t.date; g.categoryId = t.categoryId; }
  }
  const out = [];
  for (const g of groups.values()) {
    const cat = g.categoryId ? ctx.cats.get(g.categoryId) : null;
    const rec = ctx.recurring.get(g.merchant + '|-');
    if (cat?.need && !rec) continue;
    if (['vivienda', 'impuestos'].includes(g.categoryId)) continue; // can't be "avoided"; not worth asking
    const prev = state.values?.[g.merchant];
    const ageDays = prev ? daysBetween(new Date(prev.at).toISOString().slice(0, 10), today) : Infinity;
    if (prev && ageDays < cfg.reviewDays) continue;
    const monthly = rec ? rec.monthly : g.total / 3;
    out.push({
      ...g,
      total: round2(g.total),
      monthly: round2(monthly),
      recurring: rec || null,
      previous: prev?.v || null,
      fv: futureValueMonthly(monthly, cfg.returnRate, cfg.years),
      essential: !!cat?.need,
    });
  }
  // Discretionary spending first; essential contracts after, as a rate check.
  return out.sort((a, b) => (a.essential - b.essential) || b.monthly - a.monthly);
}

export function rateMerchant(state, merchant, v, now = Date.now()) {
  state.values = state.values || {};
  state.values[merchant] = { v, at: now };
}

export function rateTransaction(state, txId, v) {
  const t = state.transactions.find(x => x.id === txId);
  if (t) t.value = v || null;
}

