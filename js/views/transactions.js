import { h, clear, money, dateLabel, monthKey, monthLabel, debounce } from '../util.js';
import { natureOf, NATURE_LABELS, monthsWithData } from '../analysis.js';
import { catIcon, openSheet, categoryPicker, toast } from '../ui.js';
import { update, getState } from '../store.js';
import { confirmCategory } from '../categorize.js';
import { cleanDescription } from '../merchant.js';
import { setParams, getContext } from '../main.js';
import { setTrip } from '../trips.js';
import { VALUE_LABELS, rateTransaction } from '../coach.js';

const PAGE = 150;

export function render(root, { state, ctx, params }) {
  const f = {
    q: params.q || '', exact: params.exact === '1', m: params.m || '', cat: params.cat || '',
    nat: params.nat || '', acc: params.acc || '', st: params.st || '', trip: params.trip || '',
  };
  let limit = PAGE;

  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Transactions'), h('div', { class: 'sub', id: 'tx-sub' }))));

  const months = monthsWithData(state).reverse();
  const sel = (key, options) => {
    const s = h('select', { 'aria-label': key }, options.map(([v, l]) => h('option', { value: v }, l)));
    s.value = f[key];
    s.addEventListener('change', () => { f[key] = s.value; if (key !== 'q') f.exact = key === 'q' ? false : f.exact; refresh(); });
    return s;
  };
  const search = h('input', { type: 'search', placeholder: 'Search merchant or description…', value: f.q });
  search.addEventListener('input', debounce(() => { f.q = search.value; f.exact = false; refresh(); }, 150));

  const filters = h('div', { class: 'filters' },
    search,
    sel('m', [['', 'All months'], ...months.map(m => [m, monthLabel(m, true)])]),
    sel('cat', [['', 'All categories'], ['_none', 'Uncategorized'], ...state.categories.map(c => [c.id, c.icon + ' ' + c.name])]),
    sel('nat', [['', 'Any type'], ...['fixed', 'variable', 'oneoff', 'investment', 'income', 'transfer'].map(n => [n, NATURE_LABELS[n]])]),
    state.accounts.length > 1 ? sel('acc', [['', 'All accounts'], ...state.accounts.map(a => [a.id, a.name])]) : null,
    sel('st', [['', 'Any status'], ['pending', 'To review'], ['auto', 'Automatic'], ['confirmed', 'Confirmed']]),
    state.trips?.length ? sel('trip', [['', 'With or without trip'], ['_any', 'Trips only'], ['_none', 'No trip'], ...state.trips.map(t => [t.id, (t.emoji || '✈️') + ' ' + t.name])]) : null,
  );
  const list = h('div', { class: 'card', style: { paddingTop: '4px' } });
  root.append(filters, list);

  function matches(t) {
    if (f.m && monthKey(t.date) !== f.m) return false;
    if (f.cat === '_none' ? t.categoryId : f.cat && t.categoryId !== f.cat) return false;
    if (f.acc && t.accountId !== f.acc) return false;
    if (f.st && t.status !== f.st) return false;
    if (f.trip === '_any' ? !t.tripId : f.trip === '_none' ? t.tripId : f.trip && t.tripId !== f.trip) return false;
    if (f.nat && natureOf(t, ctx) !== f.nat) return false;
    if (f.q) {
      if (f.exact) return t.merchant === f.q;
      const q = cleanDescription(f.q);
      if (!cleanDescription(t.description + ' ' + t.merchantName + ' ' + (t.note || '')).includes(q)) return false;
    }
    return true;
  }

  const tripMap = new Map((state.trips || []).map(t => [t.id, (t.emoji || '✈️') + ' ' + t.name]));
  const tripName = id => tripMap.get(id) || '';

  function refresh() {
    setParams({ q: f.q, exact: f.exact ? '1' : '', m: f.m, cat: f.cat, nat: f.nat, acc: f.acc, st: f.st, trip: f.trip });
    if (f.exact && search.value !== (getState().transactions.find(t => t.merchant === f.q)?.merchantName || f.q)) {
      search.value = getState().transactions.find(t => t.merchant === f.q)?.merchantName || f.q;
    }
    clear(list);
    const rows = state.transactions.filter(matches);
    const inSum = rows.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    const outSum = rows.filter(t => t.amount < 0).reduce((a, t) => a + t.amount, 0);
    document.getElementById('tx-sub').textContent = `${rows.length} transactions · in ${money(inSum, { decimals: false })} · out ${money(outSum, { decimals: false })}`;
    if (!rows.length) { list.append(h('p', { class: 'muted', style: { padding: '20px 0 8px', textAlign: 'center' } }, 'No transactions match these filters.')); return; }
    let lastDay = null, dayBox = null;
    const accounts = new Map(state.accounts.map(a => [a.id, a.name]));
    for (const t of rows.slice(0, limit)) {
      if (t.date !== lastDay) {
        lastDay = t.date;
        const dayTotal = rows.filter(x => x.date === t.date).reduce((a, x) => a + x.amount, 0);
        list.append(h('div', { class: 'day-head' }, h('span', {}, dateLabel(t.date, true)), h('span', { class: 'num' }, money(dayTotal))));
        dayBox = h('div', { class: 'rows' });
        list.append(dayBox);
      }
      const cat = t.categoryId ? ctx.cats.get(t.categoryId) : null;
      const nature = natureOf(t, ctx);
      dayBox.append(h('div', { class: 'row click', onclick: () => editTransaction(t.id) },
        catIcon(cat),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, t.merchantName),
          h('div', { class: 'desc' },
            t.status === 'pending' ? h('span', { class: 'tag warn' }, 'To review') : (cat?.name || ''),
            ['fixed', 'oneoff'].includes(nature) ? ' · ' + NATURE_LABELS[nature] : '',
            accounts.size > 1 ? ' · ' + (accounts.get(t.accountId) || '') : '',
            t.tripId ? ' · ' + (tripName(t.tripId)) : '',
            t.note ? ' · ' + t.note : '')),
        h('div', { class: 'amount ' + (t.amount > 0 ? 'pos' : '') }, money(t.amount, { sign: true }))));
    }
    if (rows.length > limit) {
      list.append(h('div', { style: { textAlign: 'center', paddingTop: '12px' } },
        h('button', { class: 'btn', onclick: () => { limit += PAGE * 2; refresh(); } }, `Show more (${rows.length - limit} left)`)));
    }
  }
  refresh();
}

export function editTransaction(id) {
  const state = getState();
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  const ctx = getContext();
  let categoryId = t.categoryId || t.suggestedCategoryId || null;
  let nature = t.natureOverride || '';
  const sameMerchant = state.transactions.filter(x => x.merchant === t.merchant && x.id !== t.id).length;
  let remember = true;
  let applyToPast = false;
  const account = state.accounts.find(a => a.id === t.accountId);

  const pickerBox = h('div', {});
  const drawPicker = () => {
    clear(pickerBox);
    pickerBox.append(categoryPicker(state, { amount: t.amount, selected: categoryId, suggestion: categoryId, onPick: id => { categoryId = id; drawPicker(); drawNature(); }, frequentCount: 7 }));
  };
  const natureBox = h('div', {});
  const drawNature = () => {
    clear(natureBox);
    const cat = categoryId ? ctx.cats.get(categoryId) : null;
    if (cat && cat.kind !== 'expense') return;
    const auto = natureOf({ ...t, categoryId, natureOverride: null }, ctx);
    const seg = h('div', { class: 'seg' }, [['', 'Auto (' + (NATURE_LABELS[auto] || '—').toLowerCase() + ')'], ['fixed', 'Fixed'], ['variable', 'Variable'], ['oneoff', 'One-off']].map(([v, l]) =>
      h('button', { type: 'button', class: nature === v ? 'on' : '', onclick: () => { nature = v; drawNature(); } }, l)));
    natureBox.append(h('div', { class: 'chip-group-label' }, 'Expense type'), seg);
  };
  drawPicker(); drawNature();

  const note = h('input', { type: 'text', placeholder: 'Note (optional)', value: t.note || '', style: { width: '100%' } });
  let value = t.value || '';
  const merchantValue = state.values?.[t.merchant]?.v;
  const valueBox = h('div', {});
  const drawValue = () => {
    valueBox.replaceChildren(h('div', { class: 'seg' }, [['', merchantValue ? 'Merchant: ' + VALUE_LABELS[merchantValue].toLowerCase() : 'Use merchant rating'], ['need', 'Need'], ['want', 'Want'], ['like', 'Like']].map(([v, l]) =>
      h('button', { type: 'button', class: value === v ? 'on' : '', onclick: () => { value = v; drawValue(); } }, l))));
  };
  drawValue();
  const trips = [...(state.trips || [])].sort((a, b) => b.start.localeCompare(a.start));
  const tripSel = trips.length ? h('select', { style: { width: '100%' } }, h('option', { value: '' }, 'None'), trips.map(tr => h('option', { value: tr.id }, (tr.emoji || '✈️') + ' ' + tr.name))) : null;
  if (tripSel) tripSel.value = t.tripId || '';
  const body = h('div', {},
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline' } },
      h('div', {}, h('div', { style: { fontSize: '20px', fontWeight: 700 } }, t.merchantName), h('div', { class: 'small muted' }, dateLabel(t.date, true) + (account ? ' · ' + account.name : ''))),
      h('div', { class: 'amount ' + (t.amount > 0 ? 'pos' : ''), style: { fontSize: '20px', fontWeight: 700 } }, money(t.amount, { sign: true }))),
    h('div', { class: 'small', style: { color: 'var(--ink-2)', margin: '8px 0 4px', wordBreak: 'break-word' } }, t.description),
    h('div', { class: 'chip-group-label' }, 'Category'), pickerBox, natureBox,
    t.amount < 0 ? [h('div', { class: 'chip-group-label' }, 'Rating (this expense only)'), valueBox] : null,
    tripSel ? [h('div', { class: 'chip-group-label' }, 'Trip'), tripSel] : null,
    h('div', { class: 'chip-group-label' }, 'Note'), note,
    h('div', { class: 'review-options', style: { flexDirection: 'column', alignItems: 'flex-start' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: e => { remember = e.target.checked; } }), `Remember for future transactions from “${t.merchantName}”`),
      sameMerchant ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { applyToPast = e.target.checked; } }), `Also apply to the other ${sameMerchant} transactions from this merchant`) : null),
  );

  const sheet = openSheet({
    title: 'Transaction', body,
    foot: [
      h('button', { class: 'btn danger ghost', style: { marginRight: 'auto' }, onclick: del }, 'Delete'),
      h('button', { class: 'btn', onclick: () => sheet.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
    ],
  });

  function save() {
    update(s => {
      const tx = s.transactions.find(x => x.id === id);
      tx.note = note.value.trim();
      if ((tx.value || '') !== value) rateTransaction(s, id, value || null);
      if (tripSel && (tripSel.value || null) !== (tx.tripId || null)) setTrip(s, [id], tripSel.value || null);
      if (categoryId) confirmCategory(s, [id], categoryId, { remember, applyToPast, nature: nature || null });
    });
    sheet.close();
    toast('Saved');
  }
  function del() {
    if (!confirm('Delete this transaction? It will come back if you import the same statement again.')) return;
    let removed;
    update(s => { removed = s.transactions.find(x => x.id === id); s.transactions = s.transactions.filter(x => x.id !== id); });
    sheet.close();
    toast('Transaction deleted', { action: 'Undo', onAction: () => update(s => { s.transactions.push(removed); s.transactions.sort((a, b) => b.date.localeCompare(a.date)); }) });
  }
}
