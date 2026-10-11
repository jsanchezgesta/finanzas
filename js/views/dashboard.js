import { h, money, moneyShort, pct, monthLabel, monthShort, addMonths, monthRange, dateLabel , monthKey, currentMonth } from '../util.js';
import { summarize, latestMonth, natureOf, NATURE_LABELS, NATURE_COLORS } from '../analysis.js';
import { donut, stackedBars } from '../charts.js';
import { catIcon, emptyState } from '../ui.js';
import { loadSample } from '../sample.js';
import { update } from '../store.js';
import { tripsInMonths, tripBudget } from '../trips.js';
import { reviewQueue } from '../coach.js';

export function render(root, { state, ctx, params, navigate }) {
  if (!state.transactions.length) {
    root.append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Overview'))),
      emptyState({
        title: 'Start by importing a statement',
        text: 'Download your transactions from your bank (CSV or Excel) and upload them. The app categorizes them and learns from your confirmations.',
        actions: [
          h('a', { class: 'btn primary lg', href: '#/importar' }, 'Import statement'),
          h('button', { class: 'btn lg', onclick: () => { update(s => loadSample(s)); } }, 'Try with sample data'),
        ],
      }),
    );
    return;
  }

  const latest = latestMonth(state);
  // Open on the last complete month: the current one is usually partial
  // (salary not in yet) and would give a misleading picture.
  const hasPrev = state.transactions.some(t => monthKey(t.date) === addMonths(latest, -1));
  const defaultMonth = latest === currentMonth() && hasPrev ? addMonths(latest, -1) : latest;
  const month = params.m && /^\d{4}-\d{2}$/.test(params.m) ? params.m : defaultMonth;
  const period = params.p === 'año' ? 'año' : 'mes';
  const months = period === 'año' ? monthRange(month, 12) : [month];
  const go = p => navigate('resumen', { m: month, p: period, ...p });

  const { total } = summarize(ctx, months);
  const trendMonths = monthRange(month, 12);
  const trend = summarize(ctx, trendMonths).perMonth;

  // ---------- header ----------
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Overview'), h('div', { class: 'sub' }, (period === 'año' ? `${monthLabel(months[0])} – ${monthLabel(month)}` : monthLabel(month, true)) + (month === currentMonth() ? ' · current month' : ''))),
    h('div', { class: 'btn-row' },
      h('div', { class: 'seg' },
        h('button', { class: period === 'mes' ? 'on' : '', onclick: () => go({ p: 'mes' }) }, 'Month'),
        h('button', { class: period === 'año' ? 'on' : '', onclick: () => go({ p: 'año' }) }, '12 months')),
      h('div', { class: 'period' },
        h('button', { class: 'btn icon', 'aria-label': 'Previous month', onclick: () => go({ m: addMonths(month, -1) }) }, '‹'),
        h('button', { class: 'btn icon', 'aria-label': 'Next month', disabled: month >= latest, onclick: () => go({ m: addMonths(month, 1) }) }, '›'))),
  ));

  const pendingAll = state.transactions.filter(t => t.status === 'pending').length;
  if (pendingAll) {
    root.append(h('div', { class: 'banner' },
      h('div', {}, h('b', {}, `${pendingAll} transactions to review. `), h('span', { class: 'muted' }, 'Until you confirm them, they count as uncategorized.')),
      h('a', { class: 'btn primary sm', href: '#/revisar' }, 'Review now')));
  }

  const due = reviewQueue(state, ctx).length;
  if (due && !pendingAll) {
    root.append(h('div', { class: 'banner ok' },
      h('div', {}, h('b', {}, `${due} ${due === 1 ? 'expense' : 'expenses'} to rate in the savings coach. `), h('span', { class: 'muted' }, 'Need, want or like?')),
      h('a', { class: 'btn sm', href: '#/ahorro' }, 'Review')));
  }

  // ---------- KPIs ----------
  const net = total.income - total.expense;
  const savingsRate = total.income > 0 ? net / total.income : NaN;
  const kpi = (label, value, sub, cls = '') => h('div', { class: 'kpi' },
    h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value ' + cls }, value), h('div', { class: 'kpi-sub' }, sub));
  root.append(h('div', { class: 'kpis', style: { marginBottom: '16px' } },
    kpi('Income', money(total.income, { decimals: false }), period === 'año' ? 'avg ' + money(total.income / months.length, { decimals: false }) + '/month' : ' '),
    kpi('Spending', money(total.expense, { decimals: false }), period === 'año' ? 'avg ' + money(total.expense / months.length, { decimals: false }) + '/month' : 'excluding investments'),
    kpi('Invested', money(total.saving, { decimals: false }), 'investing & saving'),
    kpi('Savings rate', pct(savingsRate), (net >= 0 ? 'Left over: ' : 'Short by ') + money(Math.abs(net), { decimals: false }), net >= 0 ? 'pos' : 'neg'),
  ));

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  // ---------- nature split ----------
  const natures = ['fixed', 'variable', 'oneoff', 'investment'];
  const natureTotal = natures.reduce((a, n) => a + Math.max(0, total.byNature[n] || 0), 0) || 1;
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Where your money goes'), h('span', { class: 'meta' }, 'fixed · variable · one-off · investing')),
    h('div', { class: 'split' }, natures.map(n => h('div', { style: { width: (Math.max(0, total.byNature[n]) / natureTotal * 100) + '%', background: NATURE_COLORS[n] }, title: NATURE_LABELS[n] }))),
    h('div', { class: 'legend' }, natures.map(n => h('a', {
      class: 'item', href: `#/movimientos?nat=${n}&${period === 'mes' ? 'm=' + month : ''}`, style: { color: 'inherit', textDecoration: 'none' },
    }, h('span', { class: 'dot', style: { background: NATURE_COLORS[n] } }), NATURE_LABELS[n], ' ', h('b', {}, money(total.byNature[n] || 0, { decimals: false })),
      h('span', { class: 'muted' }, ' · ' + Math.round(Math.max(0, total.byNature[n] || 0) / natureTotal * 100) + '%')))),
  ));

  // ---------- monthly trend ----------
  const trendCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Monthly trend'), h('span', { class: 'meta' }, 'bars: spending & investing · line: income')));
  const chart = h('div', { class: 'chart', html: stackedBars({
    labels: trendMonths.map(monthShort),
    keys: trendMonths,
    selected: period === 'mes' ? month : null,
    series: natures.map(n => ({ id: n, label: NATURE_LABELS[n], color: NATURE_COLORS[n], values: trendMonths.map(m => trend[m].byNature[n] || 0) })),
    line: { label: 'Income', color: 'var(--c-income)', values: trendMonths.map(m => trend[m].income) },
  }) });
  chart.addEventListener('click', e => { const m = e.target.closest('[data-month]')?.dataset.month; if (m) navigate('resumen', { m, p: 'mes' }); });
  trendCard.append(chart);
  grid.append(trendCard);

  // ---------- categories ----------
  const prevMonths = monthRange(addMonths(months[0], -1), 3).filter(m => m >= monthKey(state.transactions[state.transactions.length - 1].date));
  const prev = prevMonths.length && period === 'mes' ? summarize(ctx, prevMonths).total : null;
  const expenseCats = Object.entries(total.byCategory)
    .map(([id, v]) => ({ id, v, cat: ctx.cats.get(id) }))
    .filter(x => (x.cat ? x.cat.kind === 'expense' : x.id === '_uncat_out') && x.v > 0.5)
    .sort((a, b) => b.v - a.v);
  const catColor = x => x.cat?.color || '#a0a6ad';
  const catName = x => x.cat?.name || 'Uncategorized';
  const catCard = h('section', { class: 'card span-7' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Spending by category'), h('span', { class: 'meta' }, prev ? 'vs. previous 3-month average' : '')));
  if (!expenseCats.length) catCard.append(h('p', { class: 'muted' }, 'No spending in this period.'));
  else {
    const donutEl = h('div', { class: 'chart', html: donut(expenseCats.map(x => ({ id: x.id, label: catName(x), value: x.v, color: catColor(x) })), {
      centerTop: moneyShort(total.expense), centerBottom: 'spent',
    }) });
    donutEl.addEventListener('click', e => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) openCat(id); });
    const list = h('div', { class: 'rows' });
    for (const x of expenseCats.slice(0, 9)) {
      const share = x.v / (total.expense || 1);
      let delta = null;
      if (prev) {
        const avg = (prev.byCategory[x.id] || 0) / prevMonths.length;
        if (avg > 1) {
          const d = (x.v - avg) / avg;
          if (Math.abs(d) >= 0.1) delta = h('span', { class: 'small ' + (d > 0 ? 'neg' : 'pos'), title: 'Average: ' + money(avg) }, (d > 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(d) * 100) + '%');
        }
      }
      list.append(h('div', { class: 'row click', onclick: () => openCat(x.id) },
        catIcon(x.cat, 30),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, catName(x)),
          h('div', { class: 'bar' }, h('div', { style: { width: share * 100 + '%', background: catColor(x) } }))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(x.v, { decimals: false })), delta)));
    }
    if (expenseCats.length > 9) list.append(h('a', { class: 'small', href: '#/movimientos' + (period === 'mes' ? '?m=' + month : ''), style: { paddingTop: '8px' } }, `See all ${expenseCats.length} categories`));
    catCard.append(h('div', { class: 'donut-wrap' }, donutEl, list));
  }
  grid.append(catCard);
  function openCat(id) { navigate('movimientos', { cat: id === '_uncat_out' ? '_none' : id, m: period === 'mes' ? month : '' }); }

  // ---------- recurring ----------
  const isSaving = r => ctx.cats.get(r.categoryId)?.kind === 'saving' || ctx.cats.get(r.categoryId)?.kind === 'transfer';
  const rec = [...ctx.recurring.values()].filter(r => r.sign < 0 && r.active && !isSaving(r)).sort((a, b) => b.monthly - a.monthly);
  const recInvest = [...ctx.recurring.values()].filter(r => r.sign < 0 && r.active && ctx.cats.get(r.categoryId)?.kind === 'saving');
  const recIn = [...ctx.recurring.values()].filter(r => r.sign > 0 && r.active);
  const recTotal = rec.reduce((a, r) => a + r.monthly, 0);
  const recCard = h('section', { class: 'card span-5' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Recurring payments'), h('span', { class: 'meta' }, money(recTotal, { decimals: false }) + '/month · ' + money(recTotal * 12, { decimals: false }) + '/year')));
  if (!rec.length) recCard.append(h('p', { class: 'muted small' }, 'Not enough history yet. With 3 months of transactions I can detect subscriptions, bills and memberships.'));
  const recList = h('div', { class: 'rows' });
  for (const r of rec.slice(0, 10)) {
    const cat = r.categoryId ? ctx.cats.get(r.categoryId) : null;
    recList.append(h('div', { class: 'row click', onclick: () => navigate('movimientos', { q: r.merchant, exact: '1' }) },
      catIcon(cat, 30),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, r.name), h('div', { class: 'desc' }, `${r.cadenceLabel} · next ~${dateLabel(r.next)}`)),
      h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(r.typical)), r.cadence !== 'monthly' ? h('div', { class: 'small muted' }, money(r.monthly) + '/month') : null)));
  }
  if (rec.length > 10) recList.append(h('div', { class: 'small muted', style: { paddingTop: '8px' } }, `and ${rec.length - 10} more`));
  recCard.append(recList);
  if (recInvest.length) recCard.append(h('div', { class: 'small muted', style: { marginTop: '10px' } },
    'Regular investing: ' + recInvest.map(r => `${r.name} (${money(r.monthly, { decimals: false })}/month)`).join(', ')));
  if (recIn.length) recCard.append(h('div', { class: 'small muted', style: { marginTop: '10px' } },
    'Recurring income: ' + recIn.map(r => `${r.name} (${money(r.monthly, { decimals: false })}/month)`).join(', ')));
  grid.append(recCard);

  // ---------- one-offs ----------
  const inPeriod = state.transactions.filter(t => months.includes(monthKey(t.date)));
  const oneoffs = inPeriod.filter(t => natureOf(t, ctx) === 'oneoff').sort((a, b) => a.amount - b.amount);
  const ooCard = h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'One-off expenses'), h('span', { class: 'meta' }, money(total.byNature.oneoff || 0, { decimals: false }))));
  if (!oneoffs.length) ooCard.append(h('p', { class: 'muted small' }, 'No one-off expenses in this period.'));
  const ooList = h('div', { class: 'rows' });
  for (const t of oneoffs.slice(0, 8)) {
    const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
    ooList.append(h('div', { class: 'row' }, catIcon(cat, 30),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, t.merchantName), h('div', { class: 'desc' }, dateLabel(t.date, period === 'año') + ' · ' + (cat?.name || 'Uncategorized'))),
      h('div', { class: 'amount' }, money(-t.amount))));
  }
  ooCard.append(ooList);
  grid.append(ooCard);

  // ---------- trips ----------
  const tripSpend = tripsInMonths(state, months);
  if (tripSpend.size) {
    const tripTotal = [...tripSpend.values()].reduce((a, b) => a + b, 0);
    grid.append(h('section', { class: 'card span-12' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Trips in this period'), h('span', { class: 'meta' }, money(tripTotal, { decimals: false }) + ' · ' + pct(tripTotal / (total.expense || 1)) + ' of spending')),
      h('div', { class: 'rows' }, [...tripSpend.entries()].map(([id, v]) => {
        const tr = state.trips.find(t => t.id === id);
        if (!tr) return null;
        return h('a', { class: 'row click', href: '#/viajes?id=' + id, style: { color: 'inherit', textDecoration: 'none' } },
          h('span', { style: { fontSize: '22px' } }, tr.emoji || '✈️'),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, tr.name), h('div', { class: 'desc' }, `${dateLabel(tr.start)} – ${dateLabel(tr.end)}`)),
          h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(v, { decimals: false })), tripBudget(tr) ? h('div', { class: 'small muted' }, 'budget ' + money(tripBudget(tr), { decimals: false })) : null));
      }))));
  }

  // ---------- top merchants ----------
  const merchants = Object.entries(total.byMerchant).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const nameOf = key => state.transactions.find(t => t.merchant === key)?.merchantName || key;
  const maxM = merchants[0]?.[1] || 1;
  const mCard = h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h2', {}, 'Top merchants')));
  const mList = h('div', { class: 'rows' });
  for (const [key, v] of merchants) {
    const count = inPeriod.filter(t => t.merchant === key && t.amount < 0).length;
    mList.append(h('div', { class: 'row click', onclick: () => navigate('movimientos', { q: key, exact: '1', m: period === 'mes' ? month : '' }) },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, nameOf(key)),
        h('div', { class: 'bar' }, h('div', { style: { width: (v / maxM * 100) + '%', background: 'var(--ink-2)' } }))),
      h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(v, { decimals: false })), h('div', { class: 'small muted' }, count + (count === 1 ? ' payment' : ' payments')))));
  }
  mCard.append(mList);
  grid.append(mCard);

  // ---------- 50/30/20 ----------
  if (total.income > 0) {
    const rows = [
      ['Needs', total.needs, 0.5, 'var(--c-fixed)'],
      ['Wants', total.wants, 0.3, 'var(--c-variable)'],
      ['Saving & investing', Math.max(0, total.income - total.needs - total.wants), 0.2, 'var(--c-invest)'],
    ];
    grid.append(h('section', { class: 'card span-12' },
      h('div', { class: 'card-head' }, h('h2', {}, '50/30/20 check'), h('span', { class: 'meta' }, 'against income for the period · a guide only')),
      h('div', { class: 'grid' }, rows.map(([label, v, ref, color]) => {
        const share = v / total.income;
        return h('div', { class: 'span-4' },
          h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('b', {}, label), h('span', { class: 'num' }, pct(share))),
          h('div', { class: 'bar', style: { height: '8px' } }, h('div', { style: { width: Math.min(100, share * 100) + '%', background: color } })),
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, money(v, { decimals: false }) + ' · target ' + Math.round(ref * 100) + '%'));
      })),
      h('p', { class: 'small muted', style: { margin: '12px 0 0' } }, 'Whether a category counts as a need or a want is set per category (Settings).'),
    ));
  }
}
