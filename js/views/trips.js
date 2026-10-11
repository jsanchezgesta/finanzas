import { h, money, pct, dateLabel, daysBetween, round2 } from '../util.js';
import { update, getState } from '../store.js';
import { newTrip, assignTrips, setTrip, tripSummary, tripCandidates, TRIP_CATEGORIES, tripCategoryOf, setTripCategory, tripBudget, addTripItem, updateTripItem, removeTripItem } from '../trips.js';

const TRIP_CAT_MAP = new Map(TRIP_CATEGORIES.map(c => [c.id, c]));
import { buildContext } from '../analysis.js';
import { catIcon, openSheet, toast, emptyState } from '../ui.js';
import { editTransaction } from './transactions.js';

export function planTabs(active) {
  return h('div', { class: 'seg' },
    h('a', { href: '#/plan', class: 'btn-seg' + (active === 'plan' ? ' on' : '') }, 'Monthly'),
    h('a', { href: '#/viajes', class: 'btn-seg' + (active === 'viajes' ? ' on' : '') }, 'Trips'));
}

const STATUS = { upcoming: 'Upcoming', ongoing: 'Ongoing', done: 'Finished' };

export function render(root, { state, ctx, params, navigate }) {
  const trips = [...(state.trips || [])].sort((a, b) => b.start.localeCompare(a.start));
  const trip = params.id ? trips.find(t => t.id === params.id) : null;
  if (trip) return renderTrip(root, { state, ctx, trip, navigate });

  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Trips'), h('div', { class: 'sub' }, 'A budget per trip. Expenses within the dates are assigned automatically.')),
    h('div', { class: 'btn-row' }, planTabs('viajes'), h('button', { class: 'btn primary', onclick: () => editTrip(null) }, '+ New trip'))));

  if (!trips.length) {
    root.append(emptyState({
      title: 'No trips yet',
      text: 'Create a trip with its dates and budget. Expenses on those days are assigned automatically, and bookings made earlier (flights, hotels) show up as suggestions.',
      actions: [h('button', { class: 'btn primary lg', onclick: () => editTrip(null) }, 'Create a trip')],
    }));
    return;
  }

  const grid = h('div', { class: 'grid' });
  for (const tr of trips) {
    const s = tripSummary(state, tr, ctx);
    const ratio = s.budget ? s.spent / s.budget : 0;
    const color = ratio > 1 ? 'var(--neg)' : ratio > 0.85 ? 'var(--warn)' : 'var(--accent)';
    grid.append(h('a', { class: 'card span-6', href: '#/viajes?id=' + tr.id, style: { textDecoration: 'none', color: 'inherit' } },
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        h('span', { style: { fontSize: '28px' } }, tr.emoji || '✈️'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 700, fontSize: '17px' } }, tr.name),
          h('div', { class: 'small muted' }, `${dateLabel(tr.start, true)} – ${dateLabel(tr.end, true)} · ${s.days} days`)),
        h('span', { class: 'tag' + (s.status === 'ongoing' ? ' auto' : '') }, STATUS[s.status])),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '14px' } },
        h('b', { class: 'num' }, money(s.spent, { decimals: false })),
        h('span', { class: 'muted num' }, s.budget ? 'of ' + money(s.budget, { decimals: false }) : 'no budget')),
      h('div', { class: 'bar', style: { height: '8px' } }, h('div', { style: { width: Math.min(100, ratio * 100) + '%', background: color } })),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${s.count} transactions` + (s.budget ? ` · ${s.remaining >= 0 ? money(s.remaining, { decimals: false }) + ' left' : money(-s.remaining, { decimals: false }) + ' over'}` : ''))));
  }
  root.append(grid);
}

function renderTrip(root, { state, ctx, trip, navigate }) {
  const s = tripSummary(state, trip, ctx);
  root.append(h('div', { class: 'page-head' },
    h('div', {},
      h('a', { href: '#/viajes', class: 'small' }, '← Trips'),
      h('h1', { style: { marginTop: '4px' } }, (trip.emoji || '✈️') + ' ' + trip.name),
      h('div', { class: 'sub' }, `${dateLabel(trip.start, true)} – ${dateLabel(trip.end, true)} · ${s.days} days · ${STATUS[s.status]}${s.status === 'ongoing' ? ` (day ${s.elapsed})` : ''}`)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => editTrip(trip.id) }, 'Edit'))));

  const kpi = (label, value, sub, cls = '') => h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value ' + cls }, value), h('div', { class: 'kpi-sub' }, sub));
  root.append(h('div', { class: 'kpis', style: { marginBottom: '16px' } },
    kpi('Budget', s.budget ? money(s.budget, { decimals: false }) : '—', s.budget ? money(s.dailyBudget, { decimals: false }) + ' per day' + (s.budgetFromCategories ? ' · sum of categories' : '') : 'no budget'),
    kpi('Spent', money(s.spent, { decimals: false }), s.pending ? `+ ${money(s.pending, { decimals: false })} still to pay` : s.before ? `${money(s.before, { decimals: false })} before the trip` : `${s.count} transactions`),
    kpi(s.remaining >= 0 ? 'Left' : 'Over', s.budget ? money(Math.abs(s.remaining), { decimals: false }) : '—', s.budget ? (s.pending ? 'counting what\'s pending' : pct(s.spent / s.budget) + ' used') : ' ', s.remaining < 0 ? 'neg' : ''),
    kpi('Per day', s.elapsed ? money(s.perDay, { decimals: false }) : '—', s.elapsed ? (s.budget ? `target ${money(s.dailyBudget, { decimals: false })}` : 'during the trip') : 'not started yet',
      s.budget && s.elapsed && s.perDay > s.dailyBudget ? 'neg' : '')));

  if (s.status === 'ongoing' && s.budget) {
    const left = s.days - s.elapsed;
    const perDayLeft = left > 0 ? (s.budget - s.spent - s.pending) / left : 0;
    root.append(h('div', { class: 'banner' + (s.projected <= s.budget ? ' ok' : '') },
      h('span', {}, `At this pace you'll finish at ${money(s.projected, { decimals: false })}. `,
        left > 0 ? (perDayLeft >= 0 ? `To stay on budget you can spend ${money(perDayLeft, { decimals: false })} a day for the ${left} days left.` : "You're already over budget.") : '')));
  }

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  // Breakdown by trip category, each with an optional budget
  const rows = TRIP_CATEGORIES.map(c => ({ id: c.id, cat: c, spent: s.byCategory[c.id] || 0, pending: s.pendingByCategory[c.id] || 0, budget: Number(trip.catBudgets?.[c.id]) || 0 }));
  const catCard = h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'By category'), h('span', { class: 'meta' }, 'spent · budget')));
  const list = h('div', { class: 'rows' });
  for (const r of rows) {
    const ratio = r.budget ? (r.spent + r.pending) / r.budget : 0;
    const scale = r.budget || (r.spent + r.pending) || 1;
    const input = h('input', { type: 'number', min: '0', step: '10', value: r.budget || '', placeholder: '—', 'aria-label': 'Budget ' + r.cat.name, style: { width: '76px', textAlign: 'right', height: '34px' } });
    input.addEventListener('change', () => setTimeout(() => update(st => {
      const t = st.trips.find(x => x.id === trip.id);
      t.catBudgets = { ...(t.catBudgets || {}) };
      const v = Number(input.value) || 0;
      if (v > 0) t.catBudgets[r.id] = v; else delete t.catBudgets[r.id];
    }), 0));
    list.append(h('div', { class: 'row' },
      catIcon(r.cat, 30),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, r.cat.name),
        h('div', { class: 'bar', style: { display: 'flex' } },
          h('div', { style: { width: Math.min(100, r.spent / scale * 100) + '%', background: ratio > 1 ? 'var(--neg)' : r.cat.color, opacity: r.budget ? 1 : 0.35, borderRadius: 0 } }),
          r.pending ? h('div', { title: 'Still to pay', style: { width: Math.min(100, r.pending / scale * 100) + '%', background: `repeating-linear-gradient(45deg, ${r.cat.color}, ${r.cat.color} 3px, transparent 3px, transparent 6px)`, borderRadius: 0 } }) : null)),
      h('div', { style: { textAlign: 'right', minWidth: '78px' } },
        h('div', { class: 'amount ' + (ratio > 1 ? 'neg' : '') }, money(r.spent, { decimals: false })),
        r.pending ? h('div', { class: 'small muted' }, '+ ' + money(r.pending, { decimals: false }) + ' pending') : null,
        r.budget ? h('div', { class: 'small ' + (ratio > 1 ? 'neg' : 'muted') }, ratio > 1 ? money(r.spent + r.pending - r.budget, { decimals: false }) + ' over' : money(r.budget - r.spent - r.pending, { decimals: false }) + ' left') : null),
      input));
  }
  const catBudgetTotal = rows.reduce((a, r) => a + r.budget, 0);
  const rowsSpent = rows.reduce((a, r) => a + r.spent + r.pending, 0);
  catCard.append(list, catBudgetTotal
    ? h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--line)', fontWeight: 650 } },
        h('span', {}, 'Total'), h('span', { class: 'num' }, `${money(rowsSpent, { decimals: false })} of ${money(catBudgetTotal, { decimals: false })}`))
    : h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, s.budget ? `Total budget of ${money(s.budget, { decimals: false })} not split. If you budget the categories, the total becomes their sum.` : 'Set a budget for each category; the trip total will be their sum.'));
  grid.append(catCard);
  grid.append(itemsCard(trip, s, tripCandidates(state, trip, ctx)));

  // Suggestions
  const cands = tripCandidates(state, trip, ctx);
  const sugCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Suggestions'),
      cands.filter(c => c._reason !== 'home').length > 1 ? h('button', { class: 'btn sm', onclick: () => { const ids = cands.filter(c => c._reason !== 'home').map(c => c.id); update(st => setTrip(st, ids, trip.id)); toast(`${ids.length} transactions added`); } }, 'Add bookings & foreign currency') : null));
  if (!cands.length) sugCard.append(h('p', { class: 'small muted' }, 'Nothing pending. Flights, hotels and other travel bookings from the 4 months before, and foreign-currency payments near the dates, show up here.'));
  else {
    sugCard.append(h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Bookings made earlier, foreign-currency payments, and purchases at merchants you use at home during those dates. Are they part of this trip?'));
    sugCard.append(h('div', { class: 'rows' }, cands.slice(0, 12).map(t => h('div', { class: 'row' },
      catIcon(TRIP_CAT_MAP.get(tripCategoryOf(t, ctx)), 30),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, t.merchantName), h('div', { class: 'desc' }, dateLabel(t.date, true) + ' · ' + ({ home: 'regular merchant at home', booking: 'travel booking', foreign: 'paid in ' + (t.tr?.originalCurrency || 'another currency') }[t._reason] || ''))),
      h('div', { class: 'amount' }, money(t.amount)),
      h('button', { class: 'btn sm', onclick: () => update(st => setTrip(st, [t.id], trip.id)) }, 'Add'),
      h('button', { class: 'btn sm ghost', title: 'Not part of this trip', onclick: () => update(st => setTrip(st, [t.id], null)) }, '✕')))));
  }
  grid.append(sugCard);

  // Transactions
  const txCard = h('section', { class: 'card span-12' }, h('div', { class: 'card-head' }, h('h2', {}, 'Trip transactions'), h('span', { class: 'meta' }, 'tap one to change its category')));
  if (!s.txs.length) txCard.append(h('p', { class: 'small muted' }, 'Once you import statements for those dates, the expenses will show up here.'));
  let lastDay = null;
  const box = h('div', {});
  for (const t of s.txs) {
    if (t.date !== lastDay) {
      lastDay = t.date;
      const d = daysBetween(trip.start, t.date) + 1;
      box.append(h('div', { class: 'day-head' }, h('span', {}, dateLabel(t.date, true) + (d >= 1 && d <= s.days ? ` · day ${d}` : ' · before the trip'))));
    }
    const tc = TRIP_CAT_MAP.get(tripCategoryOf(t, ctx));
    box.append(h('div', { class: 'row' },
      catIcon(tc),
      h('div', { class: 'grow', style: { cursor: 'pointer' }, onclick: () => pickTripCategory(t, trip) },
        h('div', { class: 'title' }, t.merchantName),
        h('div', { class: 'desc' }, tc.name, t.status === 'pending' ? ' · ' : '', t.status === 'pending' ? h('span', { class: 'tag warn' }, 'To review') : '', t.tr?.originalCurrency && t.tr.originalCurrency !== 'EUR' ? ` · ${t.tr.originalAmount ? Math.abs(t.tr.originalAmount) + ' ' : ''}${t.tr.originalCurrency}` : '')),
      h('div', { class: 'amount ' + (t.amount > 0 ? 'pos' : '') }, money(t.amount, { sign: true })),
      h('button', { class: 'btn sm ghost icon', title: 'Remove from trip', onclick: () => { update(st => setTrip(st, [t.id], null)); toast('Removed from trip', { action: 'Undo', onAction: () => update(st => setTrip(st, [t.id], trip.id)) }); } }, '✕')));
  }
  txCard.append(box);
  grid.append(txCard);
}

export function editTrip(id) {
  const state = getState();
  const t = id ? state.trips.find(x => x.id === id) : { name: '', start: '', end: '', budget: '', emoji: '✈️' };
  const name = h('input', { type: 'text', value: t.name, placeholder: 'Albania, Lisbon…', style: { flex: 1 } });
  const emoji = h('input', { type: 'text', value: t.emoji || '✈️', maxlength: '4', style: { width: '60px', textAlign: 'center' }, 'aria-label': 'Icon' });
  const start = h('input', { type: 'date', value: t.start });
  const end = h('input', { type: 'date', value: t.end });
  const fromCats = id && Object.values(t.catBudgets || {}).some(v => Number(v) > 0);
  const budget = h('input', { type: 'number', min: '0', step: '50', value: fromCats ? tripBudget(t) : (t.budget || ''), placeholder: '0', disabled: fromCats, title: fromCats ? 'Sum of the categories; change it from the trip\'s categories' : '' });
  const info = h('div', { class: 'small muted', style: { marginTop: '10px', minHeight: '18px' } });
  const syncInfo = () => {
    if (start.value && end.value && end.value >= start.value) {
      const days = daysBetween(start.value, end.value) + 1;
      info.textContent = `${days} days` + (Number(budget.value) ? ` · ${money(round2(Number(budget.value) / days), { decimals: false })} per day` : '');
    } else info.textContent = '';
  };
  [start, end, budget].forEach(i => i.addEventListener('input', syncInfo)); syncInfo();

  const sheet = openSheet({
    title: id ? 'Edit trip' : 'New trip',
    body: h('div', {},
      h('div', { style: { display: 'flex', gap: '8px' } }, emoji, name),
      h('div', { class: 'map-grid', style: { marginTop: '12px' } },
        h('label', { class: 'field' }, h('span', {}, 'From'), start),
        h('label', { class: 'field' }, h('span', {}, 'To'), end),
        h('label', { class: 'field' }, h('span', {}, fromCats ? 'Budget (sum of categories)' : 'Total budget (€)'), budget)),
      info,
      h('p', { class: 'small muted' }, 'Expenses between these dates are assigned to the trip (not fixed bills like rent or subscriptions). Flights and hotels booked earlier will show up as suggestions.')),
    foot: [
      id ? h('button', { class: 'btn ghost danger', style: { marginRight: 'auto' }, onclick: del }, 'Delete') : null,
      h('button', { class: 'btn', onclick: () => sheet.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, id ? 'Save' : 'Create trip'),
    ],
  });

  function save() {
    if (!name.value.trim()) return name.focus();
    if (!start.value || !end.value || end.value < start.value) return alert('Check the dates.');
    let newId = id, assigned = 0;
    update(s => {
      s.trips = s.trips || [];
      if (id) Object.assign(s.trips.find(x => x.id === id), { name: name.value.trim(), emoji: emoji.value.trim() || '✈️', start: start.value, end: end.value }, fromCats ? {} : { budget: Number(budget.value) || 0 });
      else { const tr = newTrip({ name: name.value.trim(), emoji: emoji.value.trim() || '✈️', start: start.value, end: end.value, budget: budget.value }); s.trips.push(tr); newId = tr.id; }
      assignTrips(s, buildContext(s));
      assigned = s.transactions.filter(x => x.tripId === newId).length;
    });
    sheet.close();
    if (!id) { location.hash = '#/viajes?id=' + newId; toast(assigned ? `${assigned} transactions assigned to the trip` : 'Trip created'); }
  }
  function del() {
    if (!confirm(`Delete the trip “${t.name}”? The transactions stay; they just lose the trip tag.`)) return;
    update(s => {
      s.trips = s.trips.filter(x => x.id !== id);
      for (const x of s.transactions) if (x.tripId === id) { x.tripId = null; x.tripManual = false; }
    });
    sheet.close();
    location.hash = '#/viajes';
  }
}

function pickTripCategory(t, trip) {
  const ctx = buildContext(getState());
  const current = tripCategoryOf(t, ctx);
  const sheet = openSheet({
    title: t.merchantName,
    body: h('div', {},
      h('div', { class: 'small muted', style: { marginBottom: '12px' } }, `${dateLabel(t.date, true)} · ${money(t.amount)} · ${t.description}`),
      h('div', { class: 'chip-group-label', style: { marginTop: 0 } }, 'Trip category'),
      h('div', { class: 'chips' }, TRIP_CATEGORIES.map(c => h('button', {
        class: 'chip' + (c.id === current ? ' on' : ''), type: 'button',
        onclick: () => { update(s => setTripCategory(s, [t.id], c.id)); sheet.close(); },
      }, h('span', { 'aria-hidden': 'true' }, c.icon), c.name))),
      h('p', { class: 'small muted' }, 'Only changes how it counts in this trip; the monthly category isn\'t touched.')),
    foot: [
      h('button', { class: 'btn ghost', style: { marginRight: 'auto' }, onclick: () => { sheet.close(); editTransaction(t.id); } }, 'Edit transaction'),
      h('button', { class: 'btn', onclick: () => sheet.close() }, 'Close'),
    ],
  });
}

function itemsCard(trip, s, cands) {
  const card = h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Planned payments'),
      h('span', { class: 'meta' }, s.items.length ? `${money(s.pending, { decimals: false })} pending` : 'bookings, tours, insurance…')));
  const list = h('div', { class: 'rows' });
  const sorted = [...s.items].sort((a, b) => (a.paid - b.paid) || b.amount - a.amount);
  for (const it of sorted) {
    const tc = TRIP_CAT_MAP.get(it.tripCat) || TRIP_CAT_MAP.get('otros');
    // A movement not yet in the trip that matches this payment's amount.
    const match = !it.linkedTx ? cands.find(c => Math.abs(-c.amount - it.amount) <= Math.max(1, it.amount * 0.02)) : null;
    const box = h('input', { type: 'checkbox', checked: it.paid, 'aria-label': 'Paid ' + it.name, style: { width: '22px', height: '22px', accentColor: 'var(--accent)', flex: 'none' } });
    box.addEventListener('change', () => update(st => updateTripItem(st, trip.id, it.id, { paid: box.checked })));
    list.append(h('div', { class: 'row', style: { opacity: it.paid ? 0.75 : 1 } },
      box,
      catIcon(tc, 28),
      h('div', { class: 'grow' },
        h('div', { class: 'title', style: { textDecoration: it.paid ? 'line-through' : 'none' } }, it.name),
        h('div', { class: 'desc' }, tc.name + ' · ' + (!it.paid ? 'pending' : it.linkedTx ? `paid · ${it.linkedTx.merchantName}, ${dateLabel(it.linkedTx.date)}` : 'paid outside your accounts'))),
      match ? h('button', { class: 'btn sm', title: `${match.merchantName} · ${dateLabel(match.date)} · ${money(match.amount)}`, onclick: () => update(st => { setTrip(st, [match.id], trip.id); updateTripItem(st, trip.id, it.id, { paid: true, txId: match.id }); }) }, 'Link') : null,
      h('div', { class: 'amount' }, money(it.amount, { decimals: false })),
      h('button', { class: 'btn sm ghost icon', title: 'Delete', onclick: () => update(st => removeTripItem(st, trip.id, it.id)) }, '✕')));
  }
  if (!s.items.length) list.append(h('p', { class: 'small muted', style: { margin: '0 0 8px' } }, 'Note what you\'re going to pay (the hotel paid on arrival, a tour, insurance) and tick it once paid. It counts against the budget right away.'));

  const name = h('input', { type: 'text', placeholder: 'Description', 'aria-label': 'Description', style: { flex: '1 1 140px' } });
  const cat = h('select', { 'aria-label': 'Category', style: { flex: '0 1 150px' } }, TRIP_CATEGORIES.map(c => h('option', { value: c.id }, c.icon + ' ' + c.name)));
  const amount = h('input', { type: 'number', min: '0', step: '1', placeholder: '€', 'aria-label': 'Amount', style: { width: '90px' } });
  const add = () => {
    const a = Number(amount.value);
    if (!name.value.trim() || !(a > 0)) { (name.value.trim() ? amount : name).focus(); return; }
    update(st => addTripItem(st, trip.id, { name: name.value.trim(), tripCat: cat.value, amount: a }));
  };
  amount.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  card.append(list, h('div', { class: 'inline-form' }, name, cat, amount, h('button', { class: 'btn', onclick: add }, 'Add')));
  return card;
}
