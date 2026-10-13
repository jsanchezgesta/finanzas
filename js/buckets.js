// Spending split into three tables: recurring bills, day-to-day spending
// under a limit, and larger expenses at or above it.

import { natureOf } from './analysis.js';
import { monthKey, round2 } from './util.js';

export const DEFAULT_DAILY_LIMIT = 60;

// What each account is used for. Set per account in Settings.
export const ACCOUNT_ROLES = [
  ['personal', 'Day-to-day card'],
  ['shared-expenses', 'Shared expenses'],
  ['shared-activities', 'Shared activities'],
  ['subscriptions', 'Subscriptions'],
];
export const ROLE_LABELS = Object.fromEntries(ACCOUNT_ROLES);

export const BUCKET_LABELS = {
  recurring: 'Recurring',
  daily: 'Day-to-day',
  large: 'Larger expenses',
};

// Categories that are bills by definition, even before a pattern shows.
export const BILL_CATEGORIES = new Set(['vivienda', 'suministros', 'telefonia', 'seguros', 'suscripciones']);

// A fixed-nature expense only counts as recurring when it is a bill category,
// a payee that actually charges on a schedule, or marked fixed by hand. A
// one-off Decathlon purchase in Sport (a fixed category, for the gym) is not.
function isRecurring(tx, ctx) {
  if (tx.natureOverride === 'fixed') return true;
  if (tx.categoryId && BILL_CATEGORIES.has(tx.categoryId)) return true;
  return ctx.recurring.has(tx.merchant + '|-');
}

// recurring | daily | large, or null for anything that is not spending
// (income, transfers, investing, values-only rows).
export function bucketOf(tx, ctx, limit = DEFAULT_DAILY_LIMIT) {
  if (tx.valueOnly) return null;
  const nature = natureOf(tx, ctx);
  if (nature === 'income' || nature === 'transfer' || nature === 'investment') return null;
  if (nature === 'fixed' && isRecurring(tx, ctx)) return 'recurring';
  return Math.abs(tx.amount) < limit ? 'daily' : 'large';
}

// Group the transactions in `months` (and optionally only some accounts) into
// the three buckets. Spend is positive; refunds reduce it.
export function spendTables(ctx, months, { limit = DEFAULT_DAILY_LIMIT, accountIds = null } = {}) {
  const set = new Set(months);
  const accs = accountIds ? new Set(accountIds) : null;
  const out = {
    recurring: { total: 0, rows: [] },
    daily: { total: 0, rows: [] },
    large: { total: 0, rows: [] },
  };
  const byMerchant = new Map();
  for (const t of ctx.state.transactions) {
    if (!set.has(monthKey(t.date))) continue;
    if (accs && !accs.has(t.accountId)) continue;
    const b = bucketOf(t, ctx, limit);
    if (!b) continue;
    const spend = -t.amount;
    out[b].total += spend;
    if (b === 'recurring') {
      let g = byMerchant.get(t.merchant);
      if (!g) {
        const rec = ctx.recurring.get(t.merchant + '|-');
        g = { merchant: t.merchant, name: t.merchantName, categoryId: t.categoryId, accountId: t.accountId,
          cadence: rec?.cadenceLabel || null, count: 0, total: 0, last: t.date };
        byMerchant.set(t.merchant, g);
      }
      g.count++;
      g.total += spend;
      if (t.date > g.last) { g.last = t.date; g.categoryId = t.categoryId || g.categoryId; }
    } else {
      out[b].rows.push(t);
    }
  }
  out.recurring.rows = [...byMerchant.values()].map(g => ({ ...g, total: round2(g.total) })).sort((a, b) => b.total - a.total);
  for (const k of ['daily', 'large']) out[k].rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.amount - b.amount));
  for (const k of Object.keys(out)) out[k].total = round2(out[k].total);
  return out;
}
