// Investment tracking and Trade Republic Saveback, built from imported rows.

import { monthKey, addMonths, round2 } from './util.js';

export function isTRAccount(state, accountId) {
  const a = state.accounts.find(x => x.id === accountId);
  if (a?.bank === 'Trade Republic') return true;
  return state.transactions.some(t => t.accountId === accountId && t.tr);
}

function bucket() { return { own: 0, saveback: 0, roundup: 0, interest: 0, dividends: 0, withdrawn: 0 }; }

// months: array of month keys, or null for all time.
export function investmentSummary(state, months = null) {
  const set = months ? new Set(months) : null;
  const cats = new Map(state.categories.map(c => [c.id, c]));
  const perMonth = {};
  const total = bucket();
  const assets = new Map();
  const sorted = [...state.transactions].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    const mk = monthKey(t.date);
    const kind = t.tr?.kind;
    const cat = t.categoryId ? cats.get(t.categoryId) : null;
    let field = null, v = 0;
    if (kind === 'saveback' || kind === 'reward') { field = 'saveback'; v = t.valueOnly ? t.tr.value : Math.abs(t.amount); }
    else if (kind === 'roundup') { field = 'roundup'; v = -t.amount; }
    else if (kind === 'buy') { field = 'own'; v = -t.amount; }
    else if (kind === 'sell') { field = 'withdrawn'; v = t.amount; }
    else if (kind === 'dividend') { field = 'dividends'; v = t.amount; }
    else if (kind === 'interest' || (!kind && t.categoryId === 'intereses' && t.amount > 0)) { field = 'interest'; v = t.amount; }
    else if (!kind && cat?.kind === 'saving') { field = 'own'; v = -t.amount; } // e.g. transfers to Indexa/MyInvestor from another bank
    if (!field) continue;

    // Positions (all time, regardless of the selected period).
    if (t.tr && (t.tr.symbol || t.tr.asset) && ['buy', 'sell', 'saveback', 'reward', 'roundup'].includes(kind)) {
      const key = t.tr.symbol || t.tr.asset;
      if (!assets.has(key)) assets.set(key, { key, symbol: t.tr.symbol, name: t.tr.asset || t.tr.symbol, shares: 0, invested: 0, fromSaveback: 0, lastPrice: null, lastDate: null, count: 0 });
      const a = assets.get(key);
      const sign = kind === 'sell' ? -1 : 1;
      if (t.tr.shares) a.shares += sign * t.tr.shares;
      a.invested += kind === 'sell' ? -t.amount : (t.valueOnly ? t.tr.value : -t.amount);
      if (kind === 'saveback' || kind === 'reward') a.fromSaveback += t.valueOnly ? t.tr.value : Math.abs(t.amount);
      if (t.tr.price) { a.lastPrice = t.tr.price; a.lastDate = t.date; }
      a.count++;
    }

    if (set && !set.has(mk)) continue;
    if (!perMonth[mk]) perMonth[mk] = bucket();
    perMonth[mk][field] += v;
    total[field] += v;
  }
  for (const b of [total, ...Object.values(perMonth)]) for (const k in b) b[k] = round2(b[k]);
  const list = [...assets.values()].map(a => ({
    ...a,
    shares: Math.round(a.shares * 1e6) / 1e6,
    invested: round2(a.invested),
    fromSaveback: round2(a.fromSaveback),
    value: a.lastPrice != null ? round2(a.shares * a.lastPrice) : null,
  })).sort((a, b) => b.invested - a.invested);
  return { perMonth, total, assets: list };
}

const CARD_TEXT = /TARJ|CARD|COMPRA|TPV|APPLE PAY|GOOGLE PAY|PAGO MOVIL|CONTACTLESS/;

// Saveback for one month: what TR card spend earns, whether the savings-plan
// condition is met, and what card spend on other banks left on the table.
export function savebackStatus(state, month) {
  const cfg = state.settings.saveback || { rate: 0.01, spendCap: 1500, monthlyCap: 15, minPlan: 50 };
  const cats = new Map(state.categories.map(c => [c.id, c]));
  let trCardSpend = 0, otherCardSpend = 0, plan = 0, buys = 0, received = 0;
  const nextMonth = addMonths(month, 1);
  for (const t of state.transactions) {
    const mk = monthKey(t.date);
    if (mk === nextMonth && (t.tr?.kind === 'saveback')) received += t.valueOnly ? t.tr.value : Math.abs(t.amount);
    if (mk !== month) continue;
    if (t.tr?.kind === 'card') trCardSpend -= t.amount;
    else if (t.tr?.kind === 'buy') { buys -= t.amount; if (/SAVINGS_PLAN|SPARPLAN/i.test(t.tr.type)) plan -= t.amount; }
    else if (!t.tr && t.amount < 0 && CARD_TEXT.test(t.description.toUpperCase())) {
      const cat = t.categoryId ? cats.get(t.categoryId) : null;
      if (!cat || cat.kind === 'expense') otherCardSpend -= t.amount;
    }
  }
  const planAmount = plan || buys;
  const eligible = Math.max(0, Math.min(trCardSpend, cfg.spendCap));
  const expected = round2(Math.min(cfg.monthlyCap, eligible * cfg.rate));
  const room = Math.max(0, cfg.spendCap - eligible);
  const missed = round2(Math.min(cfg.monthlyCap - expected, Math.min(otherCardSpend, room) * cfg.rate));
  return {
    month, cfg,
    trCardSpend: round2(trCardSpend),
    otherCardSpend: round2(otherCardSpend),
    planAmount: round2(planAmount),
    planOk: planAmount >= cfg.minPlan,
    expected,
    received: round2(received),
    missed: Math.max(0, missed),
    capUsed: cfg.spendCap ? eligible / cfg.spendCap : 0,
  };
}

export function hasTradeRepublic(state) {
  return state.transactions.some(t => t.tr);
}
