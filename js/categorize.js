// Categorization: learned rules (auto), keyword hints (suggestions),
// and internal-transfer pairing across accounts.

import { KEYWORD_HINTS } from './defaults.js';
import { cleanDescription } from './merchant.js';
import { daysBetween, uid } from './util.js';

export function findRule(rules, tx) {
  let r = rules.find(r => r.type === 'merchant' && r.match === tx.merchant);
  if (r) return r;
  const text = ' ' + cleanDescription(tx.description) + ' ';
  return rules.find(r => r.type === 'contains' && r.match && text.includes(r.match.toUpperCase())) || null;
}

const kwCache = new Map();
// Keywords match at a word start; short ones (≤5 chars) must be whole words,
// so "ETF" doesn't match "NETFLIX" and "METRO" doesn't match "METROPOLITAN".
function keywordMatches(text, word) {
  let re = kwCache.get(word);
  if (!re) {
    const w = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const end = word.trim().length <= 5 || word.endsWith(' ') ? '(?=[^A-Z0-9]|$)' : '';
    re = new RegExp('(?:^|[^A-Z0-9])' + w + end);
    kwCache.set(word, re);
  }
  return re.test(text);
}

export function keywordSuggestion(tx, categories) {
  const text = ' ' + cleanDescription(tx.description) + ' ';
  const valid = new Set(categories.map(c => c.id));
  for (const [catId, words] of KEYWORD_HINTS) {
    if (!valid.has(catId)) continue;
    if (words.some(w => keywordMatches(text, w))) {
      const cat = categories.find(c => c.id === catId);
      // Don't suggest income categories for outgoing money and vice versa.
      if (cat.kind === 'income' && tx.amount < 0) continue;
      if (tx.amount > 0 && cat.kind === 'expense' && !['compras', 'viajes', 'otros'].includes(catId) && !/DEVOLUCION|REEMBOLSO|REFUND|ABONO/.test(text)) continue;
      return catId;
    }
  }
  return null;
}

// Apply rules to fresh transactions (mutates them).
export function categorizeNew(txs, state) {
  for (const tx of txs) {
    const rule = findRule(state.rules, tx);
    if (rule && state.categories.some(c => c.id === rule.categoryId)) {
      tx.categoryId = rule.categoryId;
      if (rule.nature) tx.natureOverride = rule.nature;
      tx.status = 'auto';
      tx.suggestedCategoryId = null;
      rule.hits = (rule.hits || 0) + 1;
    } else {
      tx.categoryId = null;
      tx.status = 'pending';
      tx.suggestedCategoryId = keywordSuggestion(tx, state.categories);
    }
  }
  return txs;
}

// Pair money leaving one account with the same amount arriving in another
// account within a few days: those are transfers, not spending.
export function detectTransfers(allTxs, { maxDays = 4 } = {}) {
  const pending = allTxs.filter(t => t.status === 'pending');
  const byAmount = new Map();
  for (const t of allTxs) {
    const k = Math.abs(t.amount).toFixed(2);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(t);
  }
  const paired = new Set();
  for (const t of pending) {
    if (paired.has(t.id)) continue;
    const candidates = byAmount.get(Math.abs(t.amount).toFixed(2)) || [];
    const match = candidates.find(o =>
      o.id !== t.id && !paired.has(o.id) && o.accountId !== t.accountId &&
      Math.sign(o.amount) === -Math.sign(t.amount) &&
      Math.abs(daysBetween(o.date, t.date)) <= maxDays &&
      (o.status === 'pending' || o.categoryId === 'traspaso'));
    if (match) {
      t.suggestedCategoryId = 'traspaso';
      if (match.status === 'pending') match.suggestedCategoryId = 'traspaso';
      t.transferPairId = match.id;
      match.transferPairId = t.id;
      paired.add(t.id); paired.add(match.id);
    }
  }
  return paired.size / 2;
}

export function upsertRule(state, merchantKey, categoryId, nature = null) {
  let rule = state.rules.find(r => r.type === 'merchant' && r.match === merchantKey);
  if (rule) { rule.categoryId = categoryId; rule.nature = nature; rule.updatedAt = Date.now(); }
  else {
    rule = { id: uid(), type: 'merchant', match: merchantKey, categoryId, nature, hits: 0, createdAt: Date.now() };
    state.rules.push(rule);
  }
  return rule;
}

// Confirm a category for a set of transactions (usually all pending ones of a
// merchant). Optionally remember it as a rule and apply it to the rest.
// remember:    save a rule so future imports of this merchant are automatic
// applyToPast: also recategorize every other transaction of this merchant
export function confirmCategory(state, txIds, categoryId, { remember = true, nature, applyToPast = false } = {}) {
  const ids = new Set(txIds);
  const touched = state.transactions.filter(t => ids.has(t.id));
  for (const t of touched) {
    t.categoryId = categoryId;
    t.status = 'confirmed';
    t.suggestedCategoryId = null;
    if (nature !== undefined) t.natureOverride = nature;
  }
  if (!remember && !applyToPast) return touched.length;
  const merchants = [...new Set(touched.map(t => t.merchant))];
  for (const m of merchants) {
    if (remember) upsertRule(state, m, categoryId, nature ?? null);
    for (const t of state.transactions) {
      if (t.merchant !== m || ids.has(t.id)) continue;
      if (t.status === 'pending' && remember) {
        t.categoryId = categoryId; t.status = 'auto'; t.suggestedCategoryId = null;
        if (nature !== undefined) t.natureOverride = nature;
      } else if (applyToPast) {
        t.categoryId = categoryId; t.suggestedCategoryId = null;
        if (t.status === 'pending') t.status = 'auto';
        if (nature !== undefined) t.natureOverride = nature;
      }
    }
  }
  return touched.length;
}

// Group pending transactions for the review queue: one card per merchant.
export function reviewGroups(state) {
  const groups = new Map();
  for (const t of state.transactions) {
    if (t.status !== 'pending') continue;
    const key = t.transferPairId ? 'transfer:' + t.id : t.merchant;
    if (!groups.has(key)) groups.set(key, { key, merchant: t.merchant, name: t.merchantName, txs: [], suggestion: null });
    groups.get(key).txs.push(t);
  }
  for (const g of groups.values()) {
    g.txs.sort((a, b) => b.date.localeCompare(a.date));
    const sugg = {};
    for (const t of g.txs) if (t.suggestedCategoryId) sugg[t.suggestedCategoryId] = (sugg[t.suggestedCategoryId] || 0) + 1;
    g.suggestion = Object.entries(sugg).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    g.total = g.txs.reduce((a, t) => a + t.amount, 0);
  }
  // Biggest impact first: most transactions, then largest amounts.
  return [...groups.values()].sort((a, b) => b.txs.length - a.txs.length || Math.abs(b.total) - Math.abs(a.total));
}
