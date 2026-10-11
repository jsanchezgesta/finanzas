// Review queue: one card per new merchant. One tap confirms the category for
// every pending transaction of that merchant and teaches the app a rule.

import { h, clear, money, dateLabel } from '../util.js';
import { getState, update } from '../store.js';
import { reviewGroups, confirmCategory } from '../categorize.js';
import { categoryPicker, catIcon, toast } from '../ui.js';

export const live = false;

let keyHandler = null;
let skipped = new Set();
let history = [];

export function render(root) {
  skipped = new Set();
  history = [];
  const view = h('div', { class: 'review' });
  root.append(view);
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  draw(view);
}

function draw(view) {
  if (!view.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
  clear(view);
  const state = getState();
  const all = reviewGroups(state);
  const groups = all.filter(g => !skipped.has(g.key));
  const ordered = groups.length ? groups : all; // when only skipped remain, cycle back
  if (!groups.length && all.length) skipped = new Set();
  const totalTx = all.reduce((a, g) => a + g.txs.length, 0);
  const doneCount = history.length;

  view.append(h('div', { class: 'page-head', style: { marginBottom: '4px' } },
    h('div', {}, h('h1', {}, 'Revisar'),
      h('div', { class: 'sub' }, all.length ? `${all.length} comercios nuevos · ${totalTx} movimientos` : 'Nada pendiente')),
    history.length ? h('button', { class: 'btn sm', onclick: undo }, '↶ Deshacer') : null));

  if (!all.length) {
    view.append(h('div', { class: 'card empty' },
      h('h2', {}, doneCount ? 'Todo revisado' : 'No hay nada que revisar'),
      h('p', {}, doneCount ? `Has categorizado ${doneCount} comercios. La próxima vez se categorizarán solos.` : 'Cuando importes movimientos de comercios nuevos aparecerán aquí.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/resumen' }, 'Ver resumen'), h('a', { class: 'btn', href: '#/importar' }, 'Importar más'))));
    return;
  }

  view.append(h('div', { class: 'progress' }, h('div', { style: { width: (doneCount / (doneCount + all.length) * 100) + '%' } })));

  const g = ordered[0];
  const isIncome = g.total > 0;
  let remember = true;
  let oneoff = false;
  let split = false;

  const card = h('section', { class: 'card review-card' });
  card.append(
    h('div', { class: 'review-merchant' }, g.name),
    h('div', { class: 'review-sum' },
      h('span', {}, g.txs.length + (g.txs.length === 1 ? ' movimiento' : ' movimientos')),
      h('b', { class: isIncome ? 'pos' : '' }, money(g.total, { sign: true })),
      g.txs[0].transferPairId ? h('span', { class: 'tag auto' }, 'Parece un traspaso entre tus cuentas') : null),
  );

  const txList = h('div', { class: 'review-txs rows' });
  const accounts = new Map(state.accounts.map(a => [a.id, a.name]));
  for (const t of g.txs.slice(0, 4)) {
    txList.append(h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'desc', style: { color: 'var(--ink-2)' }, title: t.description }, t.description),
        h('div', { class: 'desc' }, dateLabel(t.date, true) + (accounts.size > 1 ? ' · ' + (accounts.get(t.accountId) || '') : ''))),
      h('div', { class: 'amount' }, money(t.amount))));
  }
  if (g.txs.length > 4) txList.append(h('div', { class: 'small muted', style: { padding: '6px 0' } }, `y ${g.txs.length - 4} más`));
  card.append(txList);

  const suggestion = g.suggestion ? state.categories.find(c => c.id === g.suggestion) : null;
  if (suggestion) {
    card.append(h('button', { class: 'suggest', onclick: () => pick(suggestion.id) },
      catIcon(suggestion, 36),
      h('div', {}, h('div', { class: 'small muted' }, 'Sugerencia'), h('div', { style: { fontWeight: 700, fontSize: '16px' } }, suggestion.name)),
      h('span', { class: 'k' }, 'Enter ↵')));
    card.append(h('div', { class: 'chip-group-label' }, 'O elige otra'));
  } else {
    card.append(h('div', { class: 'chip-group-label' }, '¿Qué es?'));
  }

  const picker = categoryPicker(state, { amount: g.total || -1, suggestion: null, exclude: suggestion?.id, onPick: pick, shortcuts: true, frequentCount: suggestion ? 8 : 9 });
  const pickerIds = picker.shortcutIds;
  card.append(picker);

  const splitBox = h('div', { hidden: true, style: { marginTop: '14px' } });
  const options = h('div', { class: 'review-options' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: e => { remember = e.target.checked; } }),
      'Recordar para «' + g.name + '»'),
    !isIncome ? h('label', { class: 'check', title: 'Cuenta como gasto puntual aunque sea pequeño' },
      h('input', { type: 'checkbox', onchange: e => { oneoff = e.target.checked; } }), 'Es un gasto puntual') : null,
    g.txs.length > 1 ? h('button', { class: 'btn ghost sm', onclick: () => { split = !split; splitBox.hidden = !split; } }, 'Son cosas distintas: uno a uno') : null,
    h('button', { class: 'btn ghost sm', style: { marginLeft: 'auto' }, onclick: skip }, 'Saltar →'),
  );
  card.append(options, splitBox);

  // Per-transaction categorization for mixed merchants (e.g. Amazon).
  if (g.txs.length > 1) {
    const cats = state.categories;
    for (const t of g.txs) {
      const sel = h('select', { style: { maxWidth: '200px' } },
        h('option', { value: '' }, 'Elegir…'),
        cats.map(c => h('option', { value: c.id }, c.icon + ' ' + c.name)));
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        history.push({ ids: [t.id], prev: snapshot([t]) });
        update(s => confirmCategory(s, [t.id], sel.value, { remember: false }));
        const left = getState().transactions.filter(x => x.status === 'pending' && x.merchant === g.merchant).length;
        if (!left) draw(view); else sel.closest('.row').style.opacity = .45;
      });
      splitBox.append(h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'desc', style: { color: 'var(--ink-2)' } }, t.description), h('div', { class: 'desc' }, dateLabel(t.date, true))),
        h('div', { class: 'amount' }, money(t.amount)), sel));
    }
  }

  view.append(card,
    h('div', { class: 'kbd-hint' }, 'Atajos: Enter acepta la sugerencia · 1–9 elige categoría · S salta · Z deshace'));

  function snapshot(txs) {
    return txs.map(t => ({ id: t.id, categoryId: t.categoryId, status: t.status, natureOverride: t.natureOverride, suggestedCategoryId: t.suggestedCategoryId }));
  }

  function pick(catId) {
    const s = getState();
    const merchantTxs = s.transactions.filter(t => t.merchant === g.merchant && (t.status === 'pending'));
    const ids = g.txs.map(t => t.id);
    const rulesBefore = JSON.stringify(s.rules);
    history.push({ ids, prev: snapshot(merchantTxs), rules: rulesBefore, key: g.key });
    update(st => confirmCategory(st, ids, catId, { remember, nature: oneoff ? 'oneoff' : undefined }));
    draw(view);
  }

  function skip() { skipped.add(g.key); draw(view); }

  function undo() {
    const last = history.pop();
    if (!last) return;
    update(s => {
      const byId = new Map(last.prev.map(p => [p.id, p]));
      for (const t of s.transactions) {
        const p = byId.get(t.id);
        if (p) Object.assign(t, p);
      }
      if (last.rules) s.rules = JSON.parse(last.rules);
    });
    if (last.key) skipped.delete(last.key);
    draw(view);
    toast('Deshecho');
  }

  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = e => {
    if (!view.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.sheet')) return;
    if (e.key === 'Enter' && suggestion) { e.preventDefault(); pick(suggestion.id); }
    else if (/^[1-9]$/.test(e.key) && pickerIds[+e.key - 1]) { e.preventDefault(); pick(pickerIds[+e.key - 1]); }
    else if (e.key === 's' || e.key === 'S') skip();
    else if (e.key === 'z' || e.key === 'Z') undo();
  };
  document.addEventListener('keydown', keyHandler);
}
