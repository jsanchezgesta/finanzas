import { h, clear, money, pct, monthLabel, monthShort, addMonths, currentMonth, dateLabel, round2 } from '../util.js';
import { latestMonth, buildContext } from '../analysis.js';
import { getState, update } from '../store.js';
import { coachMonth, coachTrend, reviewQueue, rateMerchant, rateTransaction, futureValue, futureValueMonthly, VALUE_LABELS, VALUE_HELP, coachSettings } from '../coach.js';
import { stackedBars } from '../charts.js';
import { catIcon, emptyState, toast } from '../ui.js';

export const live = false; // the review card keeps its own position

export function savingsTabs(active) {
  return h('div', { class: 'seg' },
    h('a', { href: '#/ahorro', class: 'btn-seg' + (active === 'ahorro' ? ' on' : '') }, 'Coach'),
    h('a', { href: '#/inversion', class: 'btn-seg' + (active === 'inversion' ? ' on' : '') }, 'Inversión'));
}

const VALUE_COLORS = { need: 'var(--c-fixed)', want: 'var(--c-variable)', like: 'var(--c-oneoff)' };

export function render(root, { params }) {
  const view = h('div', {});
  root.append(view);
  draw(view, params);
}

function draw(view, params) {
  clear(view);
  const state = getState();
  const ctx = buildContext(state);
  const cfg = coachSettings(state);
  const latest = latestMonth(state);
  const hasPrev = latest && state.transactions.some(t => t.date.startsWith(addMonths(latest, -1)));
  const month = params.m || (latest === currentMonth() && hasPrev ? addMonths(latest, -1) : latest);
  const go = m => { location.hash = '#/ahorro?m=' + m; };

  view.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Ahorro'), h('div', { class: 'sub' }, 'Lo que podrías haber evitado y lo que valdría invertido.')),
    h('div', { class: 'btn-row' }, savingsTabs('ahorro'),
      month ? h('div', { class: 'period' },
        h('button', { class: 'btn icon', 'aria-label': 'Mes anterior', onclick: () => go(addMonths(month, -1)) }, '‹'),
        h('div', { class: 'label' }, monthLabel(month, true)),
        h('button', { class: 'btn icon', 'aria-label': 'Mes siguiente', disabled: month >= latest, onclick: () => go(addMonths(month, 1)) }, '›')) : null)));

  if (!latest) {
    view.append(emptyState({ title: 'Sin movimientos todavía', text: 'Importa tus extractos y valora tus gastos para ver cuánto podrías haber ahorrado.', actions: [h('a', { class: 'btn primary', href: '#/importar' }, 'Importar extracto')] }));
    return;
  }

  const c = coachMonth(state, ctx, month);
  const trend = coachTrend(state, ctx, month, 12);
  const last3 = trend.slice(-3);
  const avgLike = round2(last3.reduce((a, x) => a + x.like, 0) / last3.length);
  const habitFV = futureValueMonthly(avgLike, cfg.returnRate, cfg.years);
  const queue = reviewQueue(state, ctx);
  const rated = Object.values(state.values || {}).filter(x => x.v).length;

  // ---------- hero ----------
  view.append(h('section', { class: 'card', style: { marginBottom: '16px' } },
    h('div', { class: 'kpi-label' }, 'Coste de oportunidad · ' + monthLabel(month, true)),
    h('div', { style: { display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px' } },
      h('div', {}, h('div', { style: { fontSize: '34px', fontWeight: 750, letterSpacing: '-0.02em' }, class: 'num' }, money(c.likeTotal, { decimals: false })),
        h('div', { class: 'small muted' }, `en caprichos (${c.like.length} ${c.like.length === 1 ? 'gasto' : 'gastos'})`)),
      h('div', { style: { fontSize: '22px', color: 'var(--muted)', paddingBottom: '18px' } }, '→'),
      h('div', {}, h('div', { style: { fontSize: '34px', fontWeight: 750, letterSpacing: '-0.02em', color: 'var(--c-invest)' }, class: 'num' }, money(c.likeFV, { decimals: false })),
        h('div', { class: 'small muted' }, `en ${cfg.years} años en un fondo MSCI World`))),
    avgLike > 0 ? h('div', { class: 'banner', style: { marginTop: '14px', marginBottom: 0 } },
      h('span', {}, `Tu media de caprichos es ${money(avgLike, { decimals: false })}/mes. Invertida cada mes durante ${cfg.years} años serían `, h('b', {}, money(habitFV, { decimals: false })), '.')) : null,
    h('p', { class: 'small muted', style: { margin: '12px 0 0' } },
      `Supone una rentabilidad del ${pct(cfg.returnRate, 1)} anual, similar a la media histórica a largo plazo del MSCI World en euros. No es una garantía. Puedes cambiarla en Ajustes.`),
    c.unrated > 0 ? h('p', { class: 'small', style: { margin: '8px 0 0' } }, `${money(c.unrated, { decimals: false })} de este mes aún no tienen valoración: `, h('a', { href: '#review-card', onclick: e => { e.preventDefault(); document.getElementById('review-card')?.scrollIntoView({ behavior: 'smooth' }); } }, 'valóralos'), '.') : null));

  const grid = h('div', { class: 'grid' });
  view.append(grid);

  // ---------- review queue ----------
  grid.append(reviewCard(view, params, queue, cfg, ctx, rated));

  // ---------- avoidable this month ----------
  const byMerchant = new Map();
  for (const t of c.like) {
    const key = t.value ? 'tx:' + t.id : t.merchant;
    if (!byMerchant.has(key)) byMerchant.set(key, { key, name: t.merchantName, merchant: t.merchant, txs: [], total: 0, single: !!t.value, categoryId: t.categoryId });
    const g = byMerchant.get(key); g.txs.push(t); g.total += -t.amount;
  }
  const likeCard = h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Evitable este mes'), h('span', { class: 'meta' }, 'caprichos · valor en ' + cfg.years + ' años')));
  if (!byMerchant.size) likeCard.append(h('p', { class: 'small muted' }, rated ? 'Ningún capricho este mes.' : 'Valora tus comercios (Necesidad, Deseo o Capricho) y aquí verás lo evitable de cada mes.'));
  likeCard.append(h('div', { class: 'rows' }, [...byMerchant.values()].sort((a, b) => b.total - a.total).map(g => h('div', { class: 'row' },
    catIcon(ctx.cats.get(g.categoryId), 30),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, g.name), h('div', { class: 'desc' }, g.single ? 'solo este gasto · ' + dateLabel(g.txs[0].date) : `${g.txs.length} ${g.txs.length === 1 ? 'vez' : 'veces'}`)),
    h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(g.total, { decimals: false })), h('div', { class: 'small', style: { color: 'var(--c-invest)' } }, '→ ' + money(futureValue(g.total, cfg.returnRate, cfg.years), { decimals: false }))),
    h('button', { class: 'btn sm ghost', title: 'Cambiar valoración', onclick: () => {
      update(s => { if (g.single) rateTransaction(s, g.txs[0].id, 'want'); else rateMerchant(s, g.merchant, 'want'); });
      toast(`«${g.name}» pasa a Deseo`, { action: 'Deshacer', onAction: () => { update(s => { if (g.single) rateTransaction(s, g.txs[0].id, 'like'); else rateMerchant(s, g.merchant, 'like'); }); draw(view, params); } });
      draw(view, params);
    } }, 'No era evitable')))));
  grid.append(likeCard);

  // ---------- trend ----------
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Caprichos y deseos por mes'), h('span', { class: 'meta' }, `deseos este mes: ${money(c.wantTotal, { decimals: false })}`)),
    h('div', { class: 'chart', html: stackedBars({
      labels: trend.map(t => monthShort(t.month)), keys: trend.map(t => t.month), selected: month, height: 220,
      series: [
        { id: 'like', label: 'Caprichos', color: VALUE_COLORS.like, values: trend.map(t => t.like) },
        { id: 'want', label: 'Deseos', color: VALUE_COLORS.want, values: trend.map(t => t.want) },
      ],
    }) }),
    h('div', { class: 'legend' },
      h('span', { class: 'item' }, h('span', { class: 'dot', style: { background: VALUE_COLORS.like } }), 'Caprichos (evitable)'),
      h('span', { class: 'item' }, h('span', { class: 'dot', style: { background: VALUE_COLORS.want } }), 'Deseos (recortable)')),
    h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, `Si recortaras un 20 % de tus deseos (${money(c.wantTotal * 0.2, { decimals: false })} este mes) cada mes, en ${cfg.years} años serían ${money(futureValueMonthly(c.wantTotal * 0.2, cfg.returnRate, cfg.years), { decimals: false })}.`)));
}

function reviewCard(view, params, queue, cfg, ctx, rated) {
  const card = h('section', { class: 'card span-12', id: 'review-card' });
  card.append(h('div', { class: 'card-head' }, h('h2', {}, 'Revisión de gastos'),
    h('span', { class: 'meta' }, queue.length ? `${queue.length} por valorar · se repite cada ${cfg.reviewDays} días` : `al día · ${rated} comercios valorados`)));
  if (!queue.length) {
    card.append(h('p', { class: 'small muted', style: { margin: 0 } }, `No hay nada pendiente. Cada comercio vuelve aquí ${cfg.reviewDays} días después de valorarlo, si sigues gastando en él, para que revises si aún te compensa.`));
    return card;
  }
  const g = queue[0];
  const cat = g.categoryId ? ctx.cats.get(g.categoryId) : null;
  const rate = v => {
    update(s => rateMerchant(s, g.merchant, v));
    toast(`«${g.name}»: ${VALUE_LABELS[v]}`, { action: 'Deshacer', onAction: () => { update(s => { if (g.previous) rateMerchant(s, g.merchant, g.previous, Date.now() - 365 * 86400000); else delete s.values[g.merchant]; }); draw(view, params); } });
    draw(view, params);
    setTimeout(() => document.getElementById('review-card')?.scrollIntoView({ block: 'nearest' }), 0);
  };
  card.append(
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } },
      catIcon(cat, 44),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontSize: '20px', fontWeight: 700 } }, g.name),
        h('div', { class: 'small muted' }, [
          cat?.name,
          g.recurring ? `${g.recurring.cadenceLabel.toLowerCase()} · ${money(g.recurring.typical)}` : `${g.count} ${g.count === 1 ? 'vez' : 'veces'} en 3 meses · ${money(g.total, { decimals: false })}`,
          g.previous ? `la última vez: ${VALUE_LABELS[g.previous].toLowerCase()}` : null,
        ].filter(Boolean).join(' · ')))),
    h('div', { class: 'banner', style: { margin: '14px 0' } },
      g.essential
        ? h('span', {}, `Gasto esencial recurrente de unos ${money(g.monthly, { decimals: false })}/mes. ¿Sigues con la mejor tarifa? Un 10 % menos serían ${money(futureValueMonthly(g.monthly * 0.1, cfg.returnRate, cfg.years), { decimals: false })} en ${cfg.years} años.`)
        : h('span', {}, `Unos ${money(g.monthly, { decimals: false })}/mes. Invertidos ${cfg.years} años serían `, h('b', {}, money(g.fv, { decimals: false })), '.')),
    h('div', { class: 'chips' }, ['need', 'want', 'like'].map(v => h('button', {
      class: 'chip' + (g.previous === v ? ' on' : ''), style: { height: 'auto', padding: '10px 14px', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', borderRadius: '12px' },
      onclick: () => rate(v),
    }, h('b', {}, VALUE_LABELS[v]), h('span', { class: 'small muted', style: { fontWeight: 400 } }, VALUE_HELP[v])))),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', alignItems: 'center' } },
      h('span', { class: 'small muted' }, queue.length > 1 ? `Siguiente: ${queue[1].name}` : 'Último de la lista'),
      h('button', { class: 'btn ghost sm', onclick: () => {
        // Skip: postpone this merchant by a week.
        update(s => { if (g.previous) rateMerchant(s, g.merchant, g.previous, Date.now() - (cfg.reviewDays - 7) * 86400000); else { s.values = s.values || {}; s.values[g.merchant] = { v: null, at: Date.now() - (cfg.reviewDays - 7) * 86400000 }; } });
        draw(view, params);
      } }, 'Más tarde →')));
  return card;
}
