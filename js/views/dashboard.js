import { h, money, moneyShort, pct, monthLabel, monthShort, addMonths, monthRange, dateLabel , monthKey, currentMonth } from '../util.js';
import { summarize, latestMonth, natureOf, NATURE_LABELS, NATURE_COLORS } from '../analysis.js';
import { donut, stackedBars } from '../charts.js';
import { catIcon, emptyState } from '../ui.js';
import { loadSample } from '../sample.js';
import { update } from '../store.js';

export function render(root, { state, ctx, params, navigate }) {
  if (!state.transactions.length) {
    root.append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Resumen'))),
      emptyState({
        title: 'Empieza importando un extracto',
        text: 'Descarga los movimientos de tu banco (CSV o Excel) y súbelos. La app los categoriza y aprende de tus confirmaciones.',
        actions: [
          h('a', { class: 'btn primary lg', href: '#/importar' }, 'Importar extracto'),
          h('button', { class: 'btn lg', onclick: () => { update(s => loadSample(s)); } }, 'Probar con datos de ejemplo'),
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
    h('div', {}, h('h1', {}, 'Resumen'), h('div', { class: 'sub' }, (period === 'año' ? `${monthLabel(months[0])} – ${monthLabel(month)}` : monthLabel(month, true)) + (month === currentMonth() ? ' · mes en curso' : ''))),
    h('div', { class: 'btn-row' },
      h('div', { class: 'seg' },
        h('button', { class: period === 'mes' ? 'on' : '', onclick: () => go({ p: 'mes' }) }, 'Mes'),
        h('button', { class: period === 'año' ? 'on' : '', onclick: () => go({ p: 'año' }) }, '12 meses')),
      h('div', { class: 'period' },
        h('button', { class: 'btn icon', 'aria-label': 'Mes anterior', onclick: () => go({ m: addMonths(month, -1) }) }, '‹'),
        h('button', { class: 'btn icon', 'aria-label': 'Mes siguiente', disabled: month >= latest, onclick: () => go({ m: addMonths(month, 1) }) }, '›'))),
  ));

  const pendingAll = state.transactions.filter(t => t.status === 'pending').length;
  if (pendingAll) {
    root.append(h('div', { class: 'banner' },
      h('div', {}, h('b', {}, `${pendingAll} movimientos por revisar. `), h('span', { class: 'muted' }, 'Hasta que los confirmes, cuentan como «sin categoría».')),
      h('a', { class: 'btn primary sm', href: '#/revisar' }, 'Revisar ahora')));
  }

  // ---------- KPIs ----------
  const net = total.income - total.expense;
  const savingsRate = total.income > 0 ? net / total.income : NaN;
  const kpi = (label, value, sub, cls = '') => h('div', { class: 'kpi' },
    h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value ' + cls }, value), h('div', { class: 'kpi-sub' }, sub));
  root.append(h('div', { class: 'kpis', style: { marginBottom: '16px' } },
    kpi('Ingresos', money(total.income, { decimals: false }), period === 'año' ? 'media ' + money(total.income / months.length, { decimals: false }) + '/mes' : ' '),
    kpi('Gastos', money(total.expense, { decimals: false }), period === 'año' ? 'media ' + money(total.expense / months.length, { decimals: false }) + '/mes' : 'sin contar inversión'),
    kpi('Invertido', money(total.saving, { decimals: false }), 'inversión y ahorro'),
    kpi('Tasa de ahorro', pct(savingsRate), (net >= 0 ? 'Te quedan ' : 'Faltan ') + money(Math.abs(net), { decimals: false }), net >= 0 ? 'pos' : 'neg'),
  ));

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  // ---------- nature split ----------
  const natures = ['fixed', 'variable', 'oneoff', 'investment'];
  const natureTotal = natures.reduce((a, n) => a + Math.max(0, total.byNature[n] || 0), 0) || 1;
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'A dónde va tu dinero'), h('span', { class: 'meta' }, 'fijo · variable · puntual · inversión')),
    h('div', { class: 'split' }, natures.map(n => h('div', { style: { width: (Math.max(0, total.byNature[n]) / natureTotal * 100) + '%', background: NATURE_COLORS[n] }, title: NATURE_LABELS[n] }))),
    h('div', { class: 'legend' }, natures.map(n => h('a', {
      class: 'item', href: `#/movimientos?nat=${n}&${period === 'mes' ? 'm=' + month : ''}`, style: { color: 'inherit', textDecoration: 'none' },
    }, h('span', { class: 'dot', style: { background: NATURE_COLORS[n] } }), NATURE_LABELS[n], ' ', h('b', {}, money(total.byNature[n] || 0, { decimals: false })),
      h('span', { class: 'muted' }, ' · ' + Math.round(Math.max(0, total.byNature[n] || 0) / natureTotal * 100) + ' %')))),
  ));

  // ---------- monthly trend ----------
  const trendCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Evolución mensual'), h('span', { class: 'meta' }, 'barras: gasto e inversión · línea: ingresos')));
  const chart = h('div', { class: 'chart', html: stackedBars({
    labels: trendMonths.map(monthShort),
    keys: trendMonths,
    selected: period === 'mes' ? month : null,
    series: natures.map(n => ({ id: n, label: NATURE_LABELS[n], color: NATURE_COLORS[n], values: trendMonths.map(m => trend[m].byNature[n] || 0) })),
    line: { label: 'Ingresos', color: 'var(--c-income)', values: trendMonths.map(m => trend[m].income) },
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
  const catName = x => x.cat?.name || 'Sin categoría';
  const catCard = h('section', { class: 'card span-7' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Gasto por categoría'), h('span', { class: 'meta' }, prev ? 'vs. media 3 meses anteriores' : '')));
  if (!expenseCats.length) catCard.append(h('p', { class: 'muted' }, 'Sin gastos en este periodo.'));
  else {
    const donutEl = h('div', { class: 'chart', html: donut(expenseCats.map(x => ({ id: x.id, label: catName(x), value: x.v, color: catColor(x) })), {
      centerTop: moneyShort(total.expense), centerBottom: 'gastado',
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
          if (Math.abs(d) >= 0.1) delta = h('span', { class: 'small ' + (d > 0 ? 'neg' : 'pos'), title: 'Media: ' + money(avg) }, (d > 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(d) * 100) + ' %');
        }
      }
      list.append(h('div', { class: 'row click', onclick: () => openCat(x.id) },
        catIcon(x.cat, 30),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, catName(x)),
          h('div', { class: 'bar' }, h('div', { style: { width: share * 100 + '%', background: catColor(x) } }))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(x.v, { decimals: false })), delta)));
    }
    if (expenseCats.length > 9) list.append(h('a', { class: 'small', href: '#/movimientos' + (period === 'mes' ? '?m=' + month : ''), style: { paddingTop: '8px' } }, `Ver las ${expenseCats.length} categorías`));
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
    h('div', { class: 'card-head' }, h('h2', {}, 'Pagos recurrentes'), h('span', { class: 'meta' }, money(recTotal, { decimals: false }) + '/mes · ' + money(recTotal * 12, { decimals: false }) + '/año')));
  if (!rec.length) recCard.append(h('p', { class: 'muted small' }, 'Aún no hay suficiente historial. Con 3 meses de movimientos detecto suscripciones, recibos y cuotas.'));
  const recList = h('div', { class: 'rows' });
  for (const r of rec.slice(0, 10)) {
    const cat = r.categoryId ? ctx.cats.get(r.categoryId) : null;
    recList.append(h('div', { class: 'row click', onclick: () => navigate('movimientos', { q: r.merchant, exact: '1' }) },
      catIcon(cat, 30),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, r.name), h('div', { class: 'desc' }, `${r.cadenceLabel} · próximo ~${dateLabel(r.next)}`)),
      h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(r.typical)), r.cadence !== 'monthly' ? h('div', { class: 'small muted' }, money(r.monthly) + '/mes') : null)));
  }
  if (rec.length > 10) recList.append(h('div', { class: 'small muted', style: { paddingTop: '8px' } }, `y ${rec.length - 10} más`));
  recCard.append(recList);
  if (recInvest.length) recCard.append(h('div', { class: 'small muted', style: { marginTop: '10px' } },
    'Inversión periódica: ' + recInvest.map(r => `${r.name} (${money(r.monthly, { decimals: false })}/mes)`).join(', ')));
  if (recIn.length) recCard.append(h('div', { class: 'small muted', style: { marginTop: '10px' } },
    'Ingresos recurrentes: ' + recIn.map(r => `${r.name} (${money(r.monthly, { decimals: false })}/mes)`).join(', ')));
  grid.append(recCard);

  // ---------- one-offs ----------
  const inPeriod = state.transactions.filter(t => months.includes(monthKey(t.date)));
  const oneoffs = inPeriod.filter(t => natureOf(t, ctx) === 'oneoff').sort((a, b) => a.amount - b.amount);
  const ooCard = h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Gastos puntuales'), h('span', { class: 'meta' }, money(total.byNature.oneoff || 0, { decimals: false }))));
  if (!oneoffs.length) ooCard.append(h('p', { class: 'muted small' }, 'Ningún gasto puntual en este periodo.'));
  const ooList = h('div', { class: 'rows' });
  for (const t of oneoffs.slice(0, 8)) {
    const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
    ooList.append(h('div', { class: 'row' }, catIcon(cat, 30),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, t.merchantName), h('div', { class: 'desc' }, dateLabel(t.date, period === 'año') + ' · ' + (cat?.name || 'Sin categoría'))),
      h('div', { class: 'amount' }, money(-t.amount))));
  }
  ooCard.append(ooList);
  grid.append(ooCard);

  // ---------- top merchants ----------
  const merchants = Object.entries(total.byMerchant).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const nameOf = key => state.transactions.find(t => t.merchant === key)?.merchantName || key;
  const maxM = merchants[0]?.[1] || 1;
  const mCard = h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h2', {}, 'Dónde más gastas')));
  const mList = h('div', { class: 'rows' });
  for (const [key, v] of merchants) {
    const count = inPeriod.filter(t => t.merchant === key && t.amount < 0).length;
    mList.append(h('div', { class: 'row click', onclick: () => navigate('movimientos', { q: key, exact: '1', m: period === 'mes' ? month : '' }) },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, nameOf(key)),
        h('div', { class: 'bar' }, h('div', { style: { width: (v / maxM * 100) + '%', background: 'var(--ink-2)' } }))),
      h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(v, { decimals: false })), h('div', { class: 'small muted' }, count + (count === 1 ? ' pago' : ' pagos')))));
  }
  mCard.append(mList);
  grid.append(mCard);

  // ---------- 50/30/20 ----------
  if (total.income > 0) {
    const rows = [
      ['Necesidades', total.needs, 0.5, 'var(--c-fixed)'],
      ['Deseos', total.wants, 0.3, 'var(--c-variable)'],
      ['Ahorro e inversión', Math.max(0, total.income - total.needs - total.wants), 0.2, 'var(--c-invest)'],
    ];
    grid.append(h('section', { class: 'card span-12' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Lectura 50/30/20'), h('span', { class: 'meta' }, 'sobre tus ingresos del periodo · solo orientativo')),
      h('div', { class: 'grid' }, rows.map(([label, v, ref, color]) => {
        const share = v / total.income;
        return h('div', { class: 'span-4' },
          h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('b', {}, label), h('span', { class: 'num' }, pct(share))),
          h('div', { class: 'bar', style: { height: '8px' } }, h('div', { style: { width: Math.min(100, share * 100) + '%', background: color } })),
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, money(v, { decimals: false }) + ' · referencia ' + Math.round(ref * 100) + ' %'));
      })),
      h('p', { class: 'small muted', style: { margin: '12px 0 0' } }, 'Qué cuenta como necesidad o deseo se configura en cada categoría (Ajustes).'),
    ));
  }
}
