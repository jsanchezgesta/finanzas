// Analysis: recurring-payment detection, spend nature (fixed / variable /
// one-off / investment) and monthly aggregates for the dashboard and plan.

import { daysBetween, median, monthKey, addDays, round2 } from './util.js';

const CADENCES = [
  { id: 'weekly', label: 'Weekly', min: 5, max: 9, days: 7, perMonth: 52 / 12, minCount: 4 },
  { id: 'biweekly', label: 'Fortnightly', min: 12, max: 17, days: 14, perMonth: 26 / 12, minCount: 3 },
  { id: 'monthly', label: 'Monthly', min: 25, max: 36, days: 30.4, perMonth: 1, minCount: 3 },
  { id: 'bimonthly', label: 'Bimonthly', min: 55, max: 68, days: 61, perMonth: 1 / 2, minCount: 3 },
  { id: 'quarterly', label: 'Quarterly', min: 82, max: 100, days: 91, perMonth: 1 / 3, minCount: 2 },
  { id: 'yearly', label: 'Yearly', min: 340, max: 390, days: 365, perMonth: 1 / 12, minCount: 2 },
];

export const NATURE_LABELS = {
  fixed: 'Fixed recurring',
  variable: 'Everyday variable',
  oneoff: 'One-off',
  investment: 'Investing & saving',
  income: 'Income',
  transfer: 'Transfer',
};

export const NATURE_COLORS = {
  fixed: 'var(--c-fixed)',
  variable: 'var(--c-variable)',
  oneoff: 'var(--c-oneoff)',
  investment: 'var(--c-invest)',
};

export function catMap(state) {
  return new Map(state.categories.map(c => [c.id, c]));
}

export function kindOf(tx, cats) {
  const c = tx.categoryId ? cats.get(tx.categoryId) : null;
  if (c) return c.kind;
  return tx.amount > 0 ? 'income' : 'expense';
}

// Detect merchants that charge (or pay) on a regular cadence.
export function detectRecurring(transactions, cats) {
  const latest = transactions.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
  const groups = new Map();
  for (const t of transactions) {
    if (t.valueOnly) continue;
    const kind = kindOf(t, cats);
    if (kind === 'transfer') continue;
    const k = t.merchant + (t.amount < 0 ? '|-' : '|+');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = new Map();
  for (const [k, txs] of groups) {
    if (txs.length < 2) continue;
    // One entry per day (split payments on the same day are merged).
    const byDay = new Map();
    for (const t of txs) byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount);
    const days = [...byDay.keys()].sort();
    if (days.length < 2) continue;
    const intervals = [];
    for (let i = 1; i < days.length; i++) intervals.push(daysBetween(days[i - 1], days[i]));
    const med = median(intervals);
    const cadence = CADENCES.find(c => med >= c.min && med <= c.max);
    if (!cadence || days.length < cadence.minCount) continue;
    const inRange = intervals.filter(d => d >= cadence.min * 0.8 && d <= cadence.max * 1.2).length;
    if (inRange / intervals.length < 0.7) continue;
    const amounts = days.map(d => Math.abs(byDay.get(d)));
    const medAmt = median(amounts);
    const mad = median(amounts.map(a => Math.abs(a - medAmt)));
    const stable = medAmt > 0 && mad / medAmt <= 0.25;
    const sample = txs[txs.length - 1];
    const cat = sample.categoryId ? cats.get(sample.categoryId) : null;
    // Variable bills (electricity, water) are still fixed commitments.
    if (!stable && !(cat && cat.nature === 'fixed')) continue;
    const last = days[days.length - 1];
    const active = daysBetween(last, latest) <= cadence.days * 1.6 + 7;
    const recent = amounts.slice(-3);
    const typical = round2(recent.reduce((a, b) => a + b, 0) / recent.length);
    out.set(k, {
      key: k,
      merchant: sample.merchant,
      name: sample.merchantName,
      sign: k.endsWith('|-') ? -1 : 1,
      categoryId: sample.categoryId,
      cadence: cadence.id,
      cadenceLabel: cadence.label,
      count: days.length,
      typical,
      monthly: round2(typical * cadence.perMonth),
      yearly: round2(typical * cadence.perMonth * 12),
      first: days[0],
      last,
      next: addDays(last, Math.round(cadence.days)),
      active,
      stable,
    });
  }
  return out;
}

export function buildContext(state) {
  const cats = catMap(state);
  const recurring = detectRecurring(state.transactions, cats);
  return { state, cats, recurring, threshold: state.settings.oneOffThreshold ?? 150 };
}

export function natureOf(tx, ctx) {
  const cat = tx.categoryId ? ctx.cats.get(tx.categoryId) : null;
  const kind = cat ? cat.kind : (tx.amount > 0 ? 'income' : 'expense');
  if (kind === 'transfer') return 'transfer';
  if (kind === 'income') return 'income';
  if (kind === 'saving') return 'investment';
  if (tx.natureOverride) return tx.natureOverride;
  const rec = ctx.recurring.get(tx.merchant + '|-');
  if (rec) return 'fixed';
  if (Math.abs(tx.amount) >= ctx.threshold && (!cat || cat.nature !== 'fixed')) return 'oneoff';
  return cat?.nature || 'variable';
}

function emptyBucket() {
  return {
    income: 0, expense: 0, saving: 0, transfer: 0, pending: 0, count: 0,
    byNature: { fixed: 0, variable: 0, oneoff: 0, investment: 0 },
    byCategory: {}, byMerchant: {}, needs: 0, wants: 0,
  };
}

// Aggregate transactions per month for the given month keys.
export function summarize(ctx, months, { accountId = null } = {}) {
  const set = new Set(months);
  const perMonth = Object.fromEntries(months.map(m => [m, emptyBucket()]));
  const total = emptyBucket();
  for (const t of ctx.state.transactions) {
    const mk = monthKey(t.date);
    if (!set.has(mk)) continue;
    if (accountId && t.accountId !== accountId) continue;
    const nature = natureOf(t, ctx);
    for (const b of [perMonth[mk], total]) {
      b.count++;
      if (t.valueOnly) {
        // Settlements of something already paid (private markets, IPO
        // allocations) were counted when the cash left; only free shares count.
        if (!['saveback', 'reward'].includes(t.tr?.kind)) continue;
        // Shares received without cash (Saveback, bonus shares): a reward that
        // is invested at once, so it counts as income and as investment.
        const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
        const v = t.tr?.value || 0;
        if (cat?.kind === 'income') { b.income += v; b.byCategory[t.categoryId] = (b.byCategory[t.categoryId] || 0) + v; }
        b.saving += v; b.byNature.investment += v;
        continue;
      }
      if (t.status === 'pending') b.pending++;
      if (nature === 'transfer') { b.transfer += t.amount; continue; }
      const catId = t.categoryId || (t.amount > 0 ? '_uncat_in' : '_uncat_out');
      if (nature === 'income') {
        b.income += t.amount;
        b.byCategory[catId] = (b.byCategory[catId] || 0) + t.amount;
        continue;
      }
      const spend = -t.amount; // refunds reduce spend
      if (nature === 'investment') {
        b.saving += spend;
        b.byNature.investment += spend;
      } else {
        b.expense += spend;
        b.byNature[nature] = (b.byNature[nature] || 0) + spend;
        const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
        if (cat?.need) b.needs += spend; else b.wants += spend;
        b.byMerchant[t.merchant] = (b.byMerchant[t.merchant] || 0) + spend;
      }
      b.byCategory[catId] = (b.byCategory[catId] || 0) + spend;
    }
  }
  return { perMonth, total };
}

export function monthsWithData(state) {
  const s = new Set(state.transactions.map(t => monthKey(t.date)));
  return [...s].sort();
}

export function latestMonth(state) {
  const ms = monthsWithData(state);
  return ms[ms.length - 1] || null;
}

// Average monthly amount per category over the given months (full months only).
export function categoryAverages(ctx, months) {
  const { total } = summarize(ctx, months);
  const n = Math.max(1, months.length);
  const out = {};
  for (const [id, v] of Object.entries(total.byCategory)) out[id] = round2(v / n);
  return { byCategory: out, income: round2(total.income / n), expense: round2(total.expense / n), saving: round2(total.saving / n) };
}
