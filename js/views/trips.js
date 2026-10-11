import { h, money, pct, dateLabel, daysBetween, round2 } from '../util.js';
import { update, getState } from '../store.js';
import { newTrip, assignTrips, setTrip, tripSummary, tripCandidates, TRIP_CATEGORIES, tripCategoryOf, setTripCategory, tripBudget, addTripItem, updateTripItem, removeTripItem } from '../trips.js';

const TRIP_CAT_MAP = new Map(TRIP_CATEGORIES.map(c => [c.id, c]));
import { buildContext } from '../analysis.js';
import { catIcon, openSheet, toast, emptyState } from '../ui.js';
import { editTransaction } from './transactions.js';

export function planTabs(active) {
  return h('div', { class: 'seg' },
    h('a', { href: '#/plan', class: 'btn-seg' + (active === 'plan' ? ' on' : '') }, 'Mensual'),
    h('a', { href: '#/viajes', class: 'btn-seg' + (active === 'viajes' ? ' on' : '') }, 'Viajes'));
}

const STATUS = { upcoming: 'Próximo', ongoing: 'En curso', done: 'Terminado' };

export function render(root, { state, ctx, params, navigate }) {
  const trips = [...(state.trips || [])].sort((a, b) => b.start.localeCompare(a.start));
  const trip = params.id ? trips.find(t => t.id === params.id) : null;
  if (trip) return renderTrip(root, { state, ctx, trip, navigate });

  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Viajes'), h('div', { class: 'sub' }, 'Un presupuesto por viaje. Los gastos dentro de las fechas se asignan solos.')),
    h('div', { class: 'btn-row' }, planTabs('viajes'), h('button', { class: 'btn primary', onclick: () => editTrip(null) }, '+ Nuevo viaje'))));

  if (!trips.length) {
    root.append(emptyState({
      title: 'Aún no tienes viajes',
      text: 'Crea un viaje con sus fechas y presupuesto. Los gastos de esos días se asignan automáticamente, y las reservas hechas antes (vuelos, hoteles) aparecen como sugerencias.',
      actions: [h('button', { class: 'btn primary lg', onclick: () => editTrip(null) }, 'Crear un viaje')],
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
          h('div', { class: 'small muted' }, `${dateLabel(tr.start, true)} – ${dateLabel(tr.end, true)} · ${s.days} días`)),
        h('span', { class: 'tag' + (s.status === 'ongoing' ? ' auto' : '') }, STATUS[s.status])),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '14px' } },
        h('b', { class: 'num' }, money(s.spent, { decimals: false })),
        h('span', { class: 'muted num' }, s.budget ? 'de ' + money(s.budget, { decimals: false }) : 'sin presupuesto')),
      h('div', { class: 'bar', style: { height: '8px' } }, h('div', { style: { width: Math.min(100, ratio * 100) + '%', background: color } })),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${s.count} movimientos` + (s.budget ? ` · ${s.remaining >= 0 ? 'quedan ' + money(s.remaining, { decimals: false }) : 'pasado ' + money(-s.remaining, { decimals: false })}` : ''))));
  }
  root.append(grid);
}

function renderTrip(root, { state, ctx, trip, navigate }) {
  const s = tripSummary(state, trip, ctx);
  root.append(h('div', { class: 'page-head' },
    h('div', {},
      h('a', { href: '#/viajes', class: 'small' }, '← Viajes'),
      h('h1', { style: { marginTop: '4px' } }, (trip.emoji || '✈️') + ' ' + trip.name),
      h('div', { class: 'sub' }, `${dateLabel(trip.start, true)} – ${dateLabel(trip.end, true)} · ${s.days} días · ${STATUS[s.status]}${s.status === 'ongoing' ? ` (día ${s.elapsed})` : ''}`)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => editTrip(trip.id) }, 'Editar'))));

  const kpi = (label, value, sub, cls = '') => h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value ' + cls }, value), h('div', { class: 'kpi-sub' }, sub));
  root.append(h('div', { class: 'kpis', style: { marginBottom: '16px' } },
    kpi('Presupuesto', s.budget ? money(s.budget, { decimals: false }) : '—', s.budget ? money(s.dailyBudget, { decimals: false }) + ' por día' + (s.budgetFromCategories ? ' · suma de partidas' : '') : 'sin presupuesto'),
    kpi('Gastado', money(s.spent, { decimals: false }), s.pending ? `+ ${money(s.pending, { decimals: false })} pendiente de pagar` : s.before ? `${money(s.before, { decimals: false })} antes del viaje` : `${s.count} movimientos`),
    kpi(s.remaining >= 0 ? 'Queda' : 'Pasado', s.budget ? money(Math.abs(s.remaining), { decimals: false }) : '—', s.budget ? (s.pending ? 'contando lo pendiente' : pct(s.spent / s.budget) + ' usado') : ' ', s.remaining < 0 ? 'neg' : ''),
    kpi('Por día', s.elapsed ? money(s.perDay, { decimals: false }) : '—', s.elapsed ? (s.budget ? `objetivo ${money(s.dailyBudget, { decimals: false })}` : 'durante el viaje') : 'aún no ha empezado',
      s.budget && s.elapsed && s.perDay > s.dailyBudget ? 'neg' : '')));

  if (s.status === 'ongoing' && s.budget) {
    const left = s.days - s.elapsed;
    const perDayLeft = left > 0 ? (s.budget - s.spent - s.pending) / left : 0;
    root.append(h('div', { class: 'banner' + (s.projected <= s.budget ? ' ok' : '') },
      h('span', {}, `A este ritmo terminarás en ${money(s.projected, { decimals: false })}. `,
        left > 0 ? (perDayLeft >= 0 ? `Para cumplir el presupuesto puedes gastar ${money(perDayLeft, { decimals: false })} al día los ${left} días que quedan.` : 'Ya has superado el presupuesto.') : '')));
  }

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  // Breakdown by trip category, each with an optional budget
  const rows = TRIP_CATEGORIES.map(c => ({ id: c.id, cat: c, spent: s.byCategory[c.id] || 0, pending: s.pendingByCategory[c.id] || 0, budget: Number(trip.catBudgets?.[c.id]) || 0 }));
  const catCard = h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Por partida'), h('span', { class: 'meta' }, 'gastado · presupuesto')));
  const list = h('div', { class: 'rows' });
  for (const r of rows) {
    const ratio = r.budget ? (r.spent + r.pending) / r.budget : 0;
    const scale = r.budget || (r.spent + r.pending) || 1;
    const input = h('input', { type: 'number', min: '0', step: '10', value: r.budget || '', placeholder: '—', 'aria-label': 'Presupuesto ' + r.cat.name, style: { width: '76px', textAlign: 'right', height: '34px' } });
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
          r.pending ? h('div', { title: 'Pendiente de pagar', style: { width: Math.min(100, r.pending / scale * 100) + '%', background: `repeating-linear-gradient(45deg, ${r.cat.color}, ${r.cat.color} 3px, transparent 3px, transparent 6px)`, borderRadius: 0 } }) : null)),
      h('div', { style: { textAlign: 'right', minWidth: '78px' } },
        h('div', { class: 'amount ' + (ratio > 1 ? 'neg' : '') }, money(r.spent, { decimals: false })),
        r.pending ? h('div', { class: 'small muted' }, '+ ' + money(r.pending, { decimals: false }) + ' pend.') : null,
        r.budget ? h('div', { class: 'small ' + (ratio > 1 ? 'neg' : 'muted') }, ratio > 1 ? 'pasado ' + money(r.spent + r.pending - r.budget, { decimals: false }) : 'quedan ' + money(r.budget - r.spent - r.pending, { decimals: false })) : null),
      input));
  }
  const catBudgetTotal = rows.reduce((a, r) => a + r.budget, 0);
  const rowsSpent = rows.reduce((a, r) => a + r.spent + r.pending, 0);
  catCard.append(list, catBudgetTotal
    ? h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--line)', fontWeight: 650 } },
        h('span', {}, 'Total'), h('span', { class: 'num' }, `${money(rowsSpent, { decimals: false })} de ${money(catBudgetTotal, { decimals: false })}`))
    : h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, s.budget ? `Presupuesto total de ${money(s.budget, { decimals: false })} sin repartir. Si pones presupuesto a las partidas, el total pasa a ser su suma.` : 'Pon un presupuesto a cada partida; el total del viaje será su suma.'));
  grid.append(catCard);
  grid.append(itemsCard(trip, s, tripCandidates(state, trip, ctx)));

  // Suggestions
  const cands = tripCandidates(state, trip, ctx);
  const sugCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Sugerencias'),
      cands.filter(c => c._reason !== 'home').length > 1 ? h('button', { class: 'btn sm', onclick: () => { const ids = cands.filter(c => c._reason !== 'home').map(c => c.id); update(st => setTrip(st, ids, trip.id)); toast(`${ids.length} movimientos añadidos`); } }, 'Añadir reservas y divisa') : null));
  if (!cands.length) sugCard.append(h('p', { class: 'small muted' }, 'Nada pendiente. Aquí aparecen vuelos, hoteles y otras reservas de viaje de los 4 meses anteriores, y pagos en otra divisa cerca de las fechas.'));
  else {
    sugCard.append(h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Reservas hechas antes, pagos en otra divisa y compras en comercios que usas en casa durante esas fechas. ¿Son de este viaje?'));
    sugCard.append(h('div', { class: 'rows' }, cands.slice(0, 12).map(t => h('div', { class: 'row' },
      catIcon(TRIP_CAT_MAP.get(tripCategoryOf(t, ctx)), 30),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, t.merchantName), h('div', { class: 'desc' }, dateLabel(t.date, true) + ' · ' + ({ home: 'comercio habitual en casa', booking: 'reserva de viaje', foreign: 'pago en ' + (t.tr?.originalCurrency || 'otra divisa') }[t._reason] || ''))),
      h('div', { class: 'amount' }, money(t.amount)),
      h('button', { class: 'btn sm', onclick: () => update(st => setTrip(st, [t.id], trip.id)) }, 'Añadir'),
      h('button', { class: 'btn sm ghost', title: 'No es de este viaje', onclick: () => update(st => setTrip(st, [t.id], null)) }, '✕')))));
  }
  grid.append(sugCard);

  // Transactions
  const txCard = h('section', { class: 'card span-12' }, h('div', { class: 'card-head' }, h('h2', {}, 'Movimientos del viaje'), h('span', { class: 'meta' }, 'toca uno para cambiar su partida')));
  if (!s.txs.length) txCard.append(h('p', { class: 'small muted' }, 'Cuando importes los extractos de esas fechas, los gastos aparecerán aquí.'));
  let lastDay = null;
  const box = h('div', {});
  for (const t of s.txs) {
    if (t.date !== lastDay) {
      lastDay = t.date;
      const d = daysBetween(trip.start, t.date) + 1;
      box.append(h('div', { class: 'day-head' }, h('span', {}, dateLabel(t.date, true) + (d >= 1 && d <= s.days ? ` · día ${d}` : ' · antes del viaje'))));
    }
    const tc = TRIP_CAT_MAP.get(tripCategoryOf(t, ctx));
    box.append(h('div', { class: 'row' },
      catIcon(tc),
      h('div', { class: 'grow', style: { cursor: 'pointer' }, onclick: () => pickTripCategory(t, trip) },
        h('div', { class: 'title' }, t.merchantName),
        h('div', { class: 'desc' }, tc.name, t.status === 'pending' ? ' · ' : '', t.status === 'pending' ? h('span', { class: 'tag warn' }, 'Por revisar') : '', t.tr?.originalCurrency && t.tr.originalCurrency !== 'EUR' ? ` · ${t.tr.originalAmount ? Math.abs(t.tr.originalAmount) + ' ' : ''}${t.tr.originalCurrency}` : '')),
      h('div', { class: 'amount ' + (t.amount > 0 ? 'pos' : '') }, money(t.amount, { sign: true })),
      h('button', { class: 'btn sm ghost icon', title: 'Quitar del viaje', onclick: () => { update(st => setTrip(st, [t.id], null)); toast('Quitado del viaje', { action: 'Deshacer', onAction: () => update(st => setTrip(st, [t.id], trip.id)) }); } }, '✕')));
  }
  txCard.append(box);
  grid.append(txCard);
}

export function editTrip(id) {
  const state = getState();
  const t = id ? state.trips.find(x => x.id === id) : { name: '', start: '', end: '', budget: '', emoji: '✈️' };
  const name = h('input', { type: 'text', value: t.name, placeholder: 'Albania, Lisboa…', style: { flex: 1 } });
  const emoji = h('input', { type: 'text', value: t.emoji || '✈️', maxlength: '4', style: { width: '60px', textAlign: 'center' }, 'aria-label': 'Icono' });
  const start = h('input', { type: 'date', value: t.start });
  const end = h('input', { type: 'date', value: t.end });
  const fromCats = id && Object.values(t.catBudgets || {}).some(v => Number(v) > 0);
  const budget = h('input', { type: 'number', min: '0', step: '50', value: fromCats ? tripBudget(t) : (t.budget || ''), placeholder: '0', disabled: fromCats, title: fromCats ? 'Suma de las partidas; cámbialo desde las partidas del viaje' : '' });
  const info = h('div', { class: 'small muted', style: { marginTop: '10px', minHeight: '18px' } });
  const syncInfo = () => {
    if (start.value && end.value && end.value >= start.value) {
      const days = daysBetween(start.value, end.value) + 1;
      info.textContent = `${days} días` + (Number(budget.value) ? ` · ${money(round2(Number(budget.value) / days), { decimals: false })} por día` : '');
    } else info.textContent = '';
  };
  [start, end, budget].forEach(i => i.addEventListener('input', syncInfo)); syncInfo();

  const sheet = openSheet({
    title: id ? 'Editar viaje' : 'Nuevo viaje',
    body: h('div', {},
      h('div', { style: { display: 'flex', gap: '8px' } }, emoji, name),
      h('div', { class: 'map-grid', style: { marginTop: '12px' } },
        h('label', { class: 'field' }, h('span', {}, 'Desde'), start),
        h('label', { class: 'field' }, h('span', {}, 'Hasta'), end),
        h('label', { class: 'field' }, h('span', {}, fromCats ? 'Presupuesto (suma de partidas)' : 'Presupuesto total (€)'), budget)),
      info,
      h('p', { class: 'small muted' }, 'Los gastos entre estas fechas se asignan al viaje (no los recibos fijos como el alquiler o las suscripciones). Vuelos y hoteles reservados antes aparecerán como sugerencias.')),
    foot: [
      id ? h('button', { class: 'btn ghost danger', style: { marginRight: 'auto' }, onclick: del }, 'Eliminar') : null,
      h('button', { class: 'btn', onclick: () => sheet.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: save }, id ? 'Guardar' : 'Crear viaje'),
    ],
  });

  function save() {
    if (!name.value.trim()) return name.focus();
    if (!start.value || !end.value || end.value < start.value) return alert('Revisa las fechas.');
    let newId = id, assigned = 0;
    update(s => {
      s.trips = s.trips || [];
      if (id) Object.assign(s.trips.find(x => x.id === id), { name: name.value.trim(), emoji: emoji.value.trim() || '✈️', start: start.value, end: end.value }, fromCats ? {} : { budget: Number(budget.value) || 0 });
      else { const tr = newTrip({ name: name.value.trim(), emoji: emoji.value.trim() || '✈️', start: start.value, end: end.value, budget: budget.value }); s.trips.push(tr); newId = tr.id; }
      assignTrips(s, buildContext(s));
      assigned = s.transactions.filter(x => x.tripId === newId).length;
    });
    sheet.close();
    if (!id) { location.hash = '#/viajes?id=' + newId; toast(assigned ? `${assigned} movimientos asignados al viaje` : 'Viaje creado'); }
  }
  function del() {
    if (!confirm(`¿Eliminar el viaje «${t.name}»? Los movimientos se quedan, solo pierden la etiqueta del viaje.`)) return;
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
      h('div', { class: 'chip-group-label', style: { marginTop: 0 } }, 'Partida del viaje'),
      h('div', { class: 'chips' }, TRIP_CATEGORIES.map(c => h('button', {
        class: 'chip' + (c.id === current ? ' on' : ''), type: 'button',
        onclick: () => { update(s => setTripCategory(s, [t.id], c.id)); sheet.close(); },
      }, h('span', { 'aria-hidden': 'true' }, c.icon), c.name))),
      h('p', { class: 'small muted' }, 'Solo cambia cómo cuenta en este viaje; la categoría del mes no se toca.')),
    foot: [
      h('button', { class: 'btn ghost', style: { marginRight: 'auto' }, onclick: () => { sheet.close(); editTransaction(t.id); } }, 'Editar movimiento'),
      h('button', { class: 'btn', onclick: () => sheet.close() }, 'Cerrar'),
    ],
  });
}

function itemsCard(trip, s, cands) {
  const card = h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Pagos previstos'),
      h('span', { class: 'meta' }, s.items.length ? `${money(s.pending, { decimals: false })} pendiente` : 'reservas, excursiones, seguros…')));
  const list = h('div', { class: 'rows' });
  const sorted = [...s.items].sort((a, b) => (a.paid - b.paid) || b.amount - a.amount);
  for (const it of sorted) {
    const tc = TRIP_CAT_MAP.get(it.tripCat) || TRIP_CAT_MAP.get('otros');
    // A movement not yet in the trip that matches this payment's amount.
    const match = !it.linkedTx ? cands.find(c => Math.abs(-c.amount - it.amount) <= Math.max(1, it.amount * 0.02)) : null;
    const box = h('input', { type: 'checkbox', checked: it.paid, 'aria-label': 'Pagado ' + it.name, style: { width: '22px', height: '22px', accentColor: 'var(--accent)', flex: 'none' } });
    box.addEventListener('change', () => update(st => updateTripItem(st, trip.id, it.id, { paid: box.checked })));
    list.append(h('div', { class: 'row', style: { opacity: it.paid ? 0.75 : 1 } },
      box,
      catIcon(tc, 28),
      h('div', { class: 'grow' },
        h('div', { class: 'title', style: { textDecoration: it.paid ? 'line-through' : 'none' } }, it.name),
        h('div', { class: 'desc' }, tc.name + ' · ' + (!it.paid ? 'pendiente' : it.linkedTx ? `pagado · ${it.linkedTx.merchantName}, ${dateLabel(it.linkedTx.date)}` : 'pagado fuera de tus cuentas'))),
      match ? h('button', { class: 'btn sm', title: `${match.merchantName} · ${dateLabel(match.date)} · ${money(match.amount)}`, onclick: () => update(st => { setTrip(st, [match.id], trip.id); updateTripItem(st, trip.id, it.id, { paid: true, txId: match.id }); }) }, 'Vincular') : null,
      h('div', { class: 'amount' }, money(it.amount, { decimals: false })),
      h('button', { class: 'btn sm ghost icon', title: 'Eliminar', onclick: () => update(st => removeTripItem(st, trip.id, it.id)) }, '✕')));
  }
  if (!s.items.length) list.append(h('p', { class: 'small muted', style: { margin: '0 0 8px' } }, 'Apunta lo que vas a pagar (el hotel que se paga al llegar, una excursión, el seguro) y márcalo cuando esté pagado. Cuenta en el presupuesto desde ya.'));

  const name = h('input', { type: 'text', placeholder: 'Concepto', 'aria-label': 'Concepto', style: { flex: '1 1 140px' } });
  const cat = h('select', { 'aria-label': 'Partida', style: { flex: '0 1 150px' } }, TRIP_CATEGORIES.map(c => h('option', { value: c.id }, c.icon + ' ' + c.name)));
  const amount = h('input', { type: 'number', min: '0', step: '1', placeholder: '€', 'aria-label': 'Importe', style: { width: '90px' } });
  const add = () => {
    const a = Number(amount.value);
    if (!name.value.trim() || !(a > 0)) { (name.value.trim() ? amount : name).focus(); return; }
    update(st => addTripItem(st, trip.id, { name: name.value.trim(), tripCat: cat.value, amount: a }));
  };
  amount.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  card.append(list, h('div', { class: 'inline-form' }, name, cat, amount, h('button', { class: 'btn', onclick: add }, 'Añadir')));
  return card;
}
