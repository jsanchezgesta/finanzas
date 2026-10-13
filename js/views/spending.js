import { h, money, monthLabel, addMonths, monthRange, dateLabel, monthKey, currentMonth } from '../util.js';
import { latestMonth } from '../analysis.js';
import { spendTables, DEFAULT_DAILY_LIMIT, ROLE_LABELS } from '../buckets.js';
import { catIcon, emptyState } from '../ui.js';
import { update } from '../store.js';

const SHOW = 25;

export function render(root, { state, ctx, params, navigate }) {
  if (!state.transactions.length) {
    root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Spending tables'))),
      emptyState({ title: 'No transactions yet', text: 'Upload a bank export to see your recurring, day-to-day and larger expenses.', actions: [h('a', { class: 'btn primary', href: '#/importar' }, 'Upload new data')] }));
    return;
  }

  const latest = latestMonth(state);
  const hasPrev = state.transactions.some(t => monthKey(t.date) === addMonths(latest, -1));
  const defaultMonth = latest === currentMonth() && hasPrev ? addMonths(latest, -1) : latest;
  const month = params.m && /^\d{4}-\d{2}$/.test(params.m) ? params.m : defaultMonth;
  const period = params.p === '3m' ? '3m' : 'mes';
  const months = period === '3m' ? monthRange(month, 3) : [month];
  const acc = state.accounts.some(a => a.id === params.acc) ? params.acc : '';
  const limit = state.settings.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  const go = p => navigate('gastos', { m: month, p: period, acc, ...p });

  const t = spendTables(ctx, months, { limit, accountIds: acc ? [acc] : null });
  const cats = ctx.cats;
  const accName = id => state.accounts.find(a => a.id === id)?.name || '';
  const showAcc = state.accounts.length > 1 && !acc;

  // ---------- header ----------
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Spending tables'),
      h('div', { class: 'sub' }, (period === '3m' ? `${monthLabel(months[0])} – ${monthLabel(month, true)}` : monthLabel(month, true)) + (month === currentMonth() ? ' · current month' : ''))),
    h('div', { class: 'btn-row' },
      h('div', { class: 'seg' },
        h('button', { class: period === 'mes' ? 'on' : '', onclick: () => go({ p: 'mes' }) }, 'Month'),
        h('button', { class: period === '3m' ? 'on' : '', onclick: () => go({ p: '3m' }) }, '3 months')),
      h('div', { class: 'period' },
        h('button', { class: 'btn icon', 'aria-label': 'Previous month', onclick: () => go({ m: addMonths(month, -1) }) }, '‹'),
        h('button', { class: 'btn icon', 'aria-label': 'Next month', disabled: month >= latest, onclick: () => go({ m: addMonths(month, 1) }) }, '›')))));

  // ---------- controls ----------
  const limitIn = h('input', { type: 'number', min: '1', step: '5', value: limit, 'aria-label': 'Day-to-day limit', style: { width: '84px' } });
  limitIn.addEventListener('change', () => update(s => { s.settings.dailyLimit = Math.max(1, Number(limitIn.value) || DEFAULT_DAILY_LIMIT); }));
  const accSel = state.accounts.length > 1 ? h('select', { 'aria-label': 'Account', onchange: e => go({ acc: e.target.value }) },
    h('option', { value: '' }, 'All accounts'),
    state.accounts.map(a => h('option', { value: a.id, selected: a.id === acc }, a.name + (a.role ? ' · ' + ROLE_LABELS[a.role] : '')))) : null;
  root.append(h('div', { class: 'filters spend-controls' },
    accSel,
    h('label', { class: 'check' }, 'Day-to-day under ', limitIn, ' €')));

  // ---------- totals ----------
  const all = t.recurring.total + t.daily.total + t.large.total;
  const kpi = (label, value, sub, color) => h('div', { class: 'kpi' },
    h('div', { class: 'kpi-label' }, color ? h('span', { class: 'dot', style: { background: color, marginRight: '6px' } }) : null, label),
    h('div', { class: 'kpi-value' }, money(value, { decimals: false })), h('div', { class: 'kpi-sub' }, sub));
  const share = v => (all > 0 ? Math.round((v / all) * 100) + '% of spending' : ' ');
  root.append(h('div', { class: 'kpis', style: { marginBottom: '16px' } },
    kpi('Recurring', t.recurring.total, share(t.recurring.total), 'var(--c-fixed)'),
    kpi('Day-to-day', t.daily.total, share(t.daily.total), 'var(--c-variable)'),
    kpi(`${money(limit, { decimals: false })} and over`, t.large.total, share(t.large.total), 'var(--c-oneoff)'),
    kpi('Total', all, period === '3m' ? 'avg ' + money(all / 3, { decimals: false }) + '/month' : ' ')));

  // ---------- tables ----------
  const card = (title, meta, body) => h('section', { class: 'card spend-card' },
    h('div', { class: 'card-head' }, h('h2', {}, title), h('span', { class: 'meta' }, meta)), body);

  const catCell = id => { const c = id ? cats.get(id) : null; return h('span', { class: 'spend-cat' }, catIcon(c, 22), c?.name || 'Uncategorized'); };
  const empty = text => h('p', { class: 'small muted', style: { margin: 0 } }, text);

  // Recurring: one row per merchant.
  const rec = t.recurring.rows;
  root.append(card('Recurring expenses', `${money(t.recurring.total)} · ${rec.length} ${rec.length === 1 ? 'payee' : 'payees'}`,
    rec.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'spend-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Payee'), h('th', { class: 'hide-sm' }, 'Category'), h('th', { class: 'hide-sm' }, 'How often'), h('th', { class: 'r' }, 'Times'), h('th', { class: 'r' }, 'Total'))),
      h('tbody', {}, rec.map(r => h('tr', {},
        h('td', { class: 'name' }, h('div', {}, r.name), showAcc ? h('div', { class: 'small muted' }, accName(r.accountId)) : null),
        h('td', { class: 'hide-sm' }, catCell(r.categoryId)),
        h('td', { class: 'hide-sm muted' }, r.cadence || 'Fixed category'),
        h('td', { class: 'r' }, r.count),
        h('td', { class: 'r amount' }, money(r.total))))),
      h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), h('td', { class: 'hide-sm' }), h('td', { class: 'hide-sm' }), h('td', { class: 'r' }, rec.reduce((a, r) => a + r.count, 0)), h('td', { class: 'r amount' }, money(t.recurring.total))))))
      : empty('No recurring payments in this period.')));

  // Day-to-day and larger: one row per transaction.
  const txTable = (key, rows, total, emptyText) => {
    if (!rows.length) return empty(emptyText);
    const tbody = h('tbody');
    const more = h('button', { class: 'btn sm ghost', style: { marginTop: '8px' } });
    let n = SHOW;
    const fill = () => {
      tbody.replaceChildren(...rows.slice(0, n).map(tx => h('tr', {},
        h('td', { class: 'date' }, dateLabel(tx.date)),
        h('td', { class: 'name' }, h('div', {}, tx.merchantName), showAcc ? h('div', { class: 'small muted' }, accName(tx.accountId)) : null),
        h('td', { class: 'hide-sm' }, catCell(tx.categoryId)),
        h('td', { class: 'r amount' + (tx.amount > 0 ? ' pos' : '') }, money(-tx.amount)))));
      more.hidden = rows.length <= n;
      more.textContent = `Show all ${rows.length}`;
    };
    more.addEventListener('click', () => { n = rows.length; fill(); });
    fill();
    return h('div', {}, h('div', { class: 'table-wrap' }, h('table', { class: 'spend-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Merchant'), h('th', { class: 'hide-sm' }, 'Category'), h('th', { class: 'r' }, 'Amount'))),
      tbody,
      h('tfoot', {}, h('tr', {}, h('td', {}), h('td', {}, 'Total'), h('td', { class: 'hide-sm' }), h('td', { class: 'r amount' }, money(total)))))), more);
  };

  root.append(card('Day-to-day', `under ${money(limit, { decimals: false })} · ${money(t.daily.total)} · ${t.daily.rows.length} payments`,
    txTable('daily', t.daily.rows, t.daily.total, 'No day-to-day spending in this period.')));
  root.append(card(`${money(limit, { decimals: false })} and over`, `${money(t.large.total)} · ${t.large.rows.length} payments`,
    txTable('large', t.large.rows, t.large.total, `Nothing at ${money(limit, { decimals: false })} or over in this period.`)));

  root.append(h('p', { class: 'small muted' }, 'Recurring: bills and subscriptions, either from a fixed category (housing, utilities, phone, insurance, subscriptions) or a payee that charges on a regular schedule. Everything else is split by amount. Transfers between your accounts, income and investing are left out.'));
}
