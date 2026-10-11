// Zero-based monthly plan: give every euro of expected income a job,
// starting with savings and investment ("págate primero").

import { h, money, pct, monthLabel, addMonths, monthRange, currentMonth, round2 } from '../util.js';
import { summarize, categoryAverages, latestMonth, monthsWithData } from '../analysis.js';
import { catIcon, emptyState, toast } from '../ui.js';
import { update } from '../store.js';
import { planTabs } from './trips.js';

export function render(root, { state, ctx, params, navigate }) {
  const latest = latestMonth(state);
  const month = params.m && /^\d{4}-\d{2}$/.test(params.m) ? params.m : (latest && latest > currentMonth() ? latest : currentMonth());

  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Plan'), h('div', { class: 'sub' }, 'Zero-based budget: give every euro a job before you spend it.')),
    h('div', { class: 'btn-row' }, planTabs('plan'), h('div', { class: 'period' },
      h('button', { class: 'btn icon', 'aria-label': 'Previous month', onclick: () => navigate('plan', { m: addMonths(month, -1) }) }, '‹'),
      h('div', { class: 'label' }, monthLabel(month, true)),
      h('button', { class: 'btn icon', 'aria-label': 'Next month', onclick: () => navigate('plan', { m: addMonths(month, 1) }) }, '›')))));

  if (!state.transactions.length) {
    root.append(emptyState({ title: 'First, import some transactions', text: 'With your history I can propose a plan based on what you spend on average.', actions: [h('a', { class: 'btn primary', href: '#/importar' }, 'Import statement')] }));
    return;
  }

  // Averages from the last 3 complete months before this one that have data.
  const dataMonths = new Set(monthsWithData(state));
  const avgMonths = monthRange(addMonths(month, -1), 3).filter(m => dataMonths.has(m));
  const avg = categoryAverages(ctx, avgMonths.length ? avgMonths : [latest]);
  const actual = summarize(ctx, [month]).total;
  const plan = state.budgets[month] || null;

  if (!plan) {
    const prevPlan = state.budgets[addMonths(month, -1)];
    root.append(h('div', { class: 'card empty' },
      h('h2', {}, `No plan for ${monthLabel(month, true)}`),
      h('p', {}, avgMonths.length ? `I can fill it with your ${avgMonths.length}-month average: income ${money(avg.income, { decimals: false })}, spending ${money(avg.expense, { decimals: false })}. Then you adjust it.` : 'Start from your average or from scratch.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary lg', onclick: () => createPlan('avg') }, 'Fill with my average'),
        prevPlan ? h('button', { class: 'btn lg', onclick: () => createPlan('prev') }, 'Copy previous month') : null,
        h('button', { class: 'btn lg', onclick: () => createPlan('empty') }, 'Start empty'))));
    return;
  }

  function createPlan(mode) {
    update(s => {
      const cats = {};
      let income = 0;
      if (mode === 'avg') {
        income = Math.round(avg.income);
        for (const c of s.categories) {
          if (c.kind !== 'expense' && c.kind !== 'saving') continue;
          const v = avg.byCategory[c.id] || 0;
          if (v > 1) cats[c.id] = Math.ceil(v / 5) * 5;
        }
        // Whatever is left goes to savings so the plan starts at zero.
        const assigned = Object.values(cats).reduce((a, b) => a + b, 0);
        if (income > assigned) cats.ahorro = (cats.ahorro || 0) + Math.floor((income - assigned) / 5) * 5;
      } else if (mode === 'prev') {
        const p = s.budgets[addMonths(month, -1)];
        income = p.income; Object.assign(cats, p.cats);
      }
      s.budgets[month] = { income, cats };
    });
  }

  const assigned = Object.values(plan.cats).reduce((a, b) => a + (Number(b) || 0), 0);
  const unassigned = round2(plan.income - assigned);
  const savingCats = state.categories.filter(c => c.kind === 'saving');
  const plannedSaving = savingCats.reduce((a, c) => a + (Number(plan.cats[c.id]) || 0), 0);
  const plannedRate = plan.income > 0 ? plannedSaving / plan.income : NaN;

  const incomeInput = h('input', { type: 'number', 'aria-label': 'Expected income', inputmode: 'decimal', step: '10', value: plan.income, style: { width: '100%', textAlign: 'right', fontSize: '18px', fontWeight: 700, height: '42px' } });
  incomeInput.addEventListener('change', () => setTimeout(() => update(s => { s.budgets[month].income = Number(incomeInput.value) || 0; }), 0));

  const unassignedCls = Math.abs(unassigned) < 0.5 ? 'zero' : unassigned > 0 ? 'left' : 'over';
  root.append(h('div', { class: 'plan-summary' },
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Expected income'), incomeInput,
      h('div', { class: 'kpi-sub' }, `avg ${money(avg.income, { decimals: false })} · actual ${money(actual.income, { decimals: false })}`)),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Assigned'), h('div', { class: 'kpi-value' }, money(assigned, { decimals: false })), h('div', { class: 'kpi-sub' }, 'planned spending + saving')),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'To assign'), h('div', { class: 'kpi-value unassigned ' + unassignedCls }, money(unassigned, { decimals: false })),
      h('div', { class: 'kpi-sub' }, unassignedCls === 'zero' ? 'Every euro has a job' : unassigned > 0 ? 'Assign it, ideally to savings' : 'Over-assigned: trim something')),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Planned saving'), h('div', { class: 'kpi-value' }, pct(plannedRate)),
      h('div', { class: 'kpi-sub' }, money(plannedSaving * 12, { decimals: false }) + ' a year if you stick to it')),
  ));

  if (unassigned > 0.5) {
    root.append(h('div', { class: 'banner' },
      h('span', {}, `${money(unassigned, { decimals: false })} still without a job.`),
      h('button', { class: 'btn sm primary', onclick: () => update(s => { const c = s.budgets[month].cats; c.ahorro = round2((Number(c.ahorro) || 0) + unassigned); }) }, 'Send to Savings')));
  }

  const sections = [
    ['Saving & investing · first', c => c.kind === 'saving'],
    ['Fixed expenses', c => c.kind === 'expense' && c.nature === 'fixed'],
    ['Variable expenses', c => c.kind === 'expense' && c.nature === 'variable'],
    ['One-off expenses', c => c.kind === 'expense' && c.nature === 'oneoff'],
  ];
  const grid = h('div', { class: 'grid' });
  root.append(grid);
  const save = (id, v) => update(s => { const c = s.budgets[month].cats; if (v > 0) c[id] = v; else delete c[id]; });

  for (const [title, filter] of sections) {
    const cats = state.categories.filter(filter);
    const planned = cats.reduce((a, c) => a + (Number(plan.cats[c.id]) || 0), 0);
    const spent = cats.reduce((a, c) => a + (actual.byCategory[c.id] || 0), 0);
    const card = h('section', { class: 'card span-6' },
      h('div', { class: 'card-head' }, h('h2', {}, title), h('span', { class: 'meta num' }, `${money(spent, { decimals: false })} of ${money(planned, { decimals: false })}`)));
    // Show categories that have a plan, spend or history; hide the rest behind a toggle.
    const relevant = cats.filter(c => plan.cats[c.id] || actual.byCategory[c.id] || avg.byCategory[c.id]);
    const others = cats.filter(c => !relevant.includes(c));
    const rowsBox = h('div', { class: 'rows' });
    const rowFor = c => {
      const p = Number(plan.cats[c.id]) || 0;
      const a = actual.byCategory[c.id] || 0;
      const ratio = p > 0 ? a / p : a > 0 ? 1.5 : 0;
      const color = ratio > 1.001 ? 'var(--neg)' : ratio > 0.85 ? 'var(--warn)' : c.color;
      const input = h('input', { type: 'number', inputmode: 'decimal', step: '5', min: '0', value: p || '', placeholder: avg.byCategory[c.id] ? String(Math.round(avg.byCategory[c.id])) : '0', 'aria-label': 'Plan ' + c.name });
      // Deferred so focus has already moved to the next field when the view re-renders.
      input.addEventListener('change', () => setTimeout(() => save(c.id, Number(input.value) || 0), 0));
      return h('div', { class: 'plan-row' },
        h('div', {},
          h('div', { class: 'plan-name' }, catIcon(c, 28), h('span', { class: 't' }, c.name)),
          h('div', { class: 'bar' }, h('div', { style: { width: Math.min(100, ratio * 100) + '%', background: color } }))),
        input,
        h('div', { class: 'actual' },
          h('div', { class: 'num', style: { color: ratio > 1.001 ? 'var(--neg)' : 'inherit', fontWeight: 600 } }, money(a, { decimals: false })),
          h('div', { class: 'muted small' }, p ? (p - a >= 0 ? money(p - a, { decimals: false }) + ' left' : money(a - p, { decimals: false }) + ' over') : 'no plan')));
    };
    relevant.forEach(c => rowsBox.append(rowFor(c)));
    card.append(h('div', { class: 'plan-row', style: { paddingTop: 0, borderBottom: '1px solid var(--line)' } },
      h('span', { class: 'small muted' }, 'Category'), h('span', { class: 'small muted', style: { textAlign: 'right' } }, 'Plan'), h('span', { class: 'small muted actual' }, 'Actual')), rowsBox);
    if (others.length) {
      const more = h('button', { class: 'btn ghost sm', style: { marginTop: '6px' } }, `+ ${others.length} more categories`);
      more.addEventListener('click', () => { others.forEach(c => rowsBox.append(rowFor(c))); more.remove(); });
      card.append(more);
    }
    grid.append(card);
  }

  root.append(h('div', { class: 'btn-row', style: { marginTop: '16px' } },
    h('button', { class: 'btn', onclick: () => { if (confirm('Redo the plan from your average? Current figures will be replaced.')) createPlan('avg'); } }, 'Redo from my average'),
    state.budgets[addMonths(month, -1)] ? h('button', { class: 'btn', onclick: () => createPlan('prev') }, 'Copy previous month') : null,
    h('button', { class: 'btn danger ghost', onclick: () => { if (confirm("Delete this month's plan?")) { update(s => { delete s.budgets[month]; }); toast('Plan deleted'); } } }, 'Delete plan')));
}
