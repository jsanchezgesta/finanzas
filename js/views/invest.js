import { h, money, pct, monthLabel, monthShort, monthRange, dateLabel, currentMonth, addMonths } from '../util.js';
import { latestMonth } from '../analysis.js';
import { investmentSummary, savebackStatus, hasTradeRepublic } from '../invest.js';
import { stackedBars } from '../charts.js';
import { emptyState } from '../ui.js';
import { savingsTabs } from './coach.js';

export function render(root, { state, params, navigate }) {
  const period = params.p === 'todo' ? 'todo' : '12m';
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Ahorro'), h('div', { class: 'sub' }, 'Aportaciones, Saveback, intereses y posiciones.')),
    h('div', { class: 'btn-row' }, savingsTabs('inversion'), h('div', { class: 'seg' },
      h('button', { class: period === '12m' ? 'on' : '', onclick: () => navigate('inversion', { p: '12m' }) }, '12 meses'),
      h('button', { class: period === 'todo' ? 'on' : '', onclick: () => navigate('inversion', { p: 'todo' }) }, 'Todo')))));

  const latest = latestMonth(state);
  if (!latest) {
    root.append(emptyState({ title: 'Sin movimientos todavía', text: 'Importa el extracto de Trade Republic (Perfil → Transacciones → Exportar) para ver tus aportaciones, el Saveback y los intereses.', actions: [h('a', { class: 'btn primary', href: '#/importar' }, 'Importar extracto')] }));
    return;
  }
  const end = latest > currentMonth() ? latest : currentMonth();
  const months = monthRange(end, 12);
  const inv = investmentSummary(state, period === 'todo' ? null : months);
  const t = inv.total;

  const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), h('div', { class: 'kpi-sub' }, sub));
  const n = period === 'todo' ? Math.max(1, Object.keys(inv.perMonth).length) : 12;
  root.append(h('div', { class: 'kpis', style: { marginBottom: '16px' } },
    kpi('Aportado', money(t.own + t.roundup - t.withdrawn, { decimals: false }), 'media ' + money((t.own + t.roundup - t.withdrawn) / n, { decimals: false }) + '/mes'),
    kpi('Saveback', money(t.saveback), 'gratis, en participaciones'),
    kpi('Intereses', money(t.interest), 'media ' + money(t.interest / n) + '/mes'),
    kpi('Dividendos', money(t.dividends), t.withdrawn ? 'ventas: ' + money(t.withdrawn, { decimals: false }) : ' ')));

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  if (hasTradeRepublic(state)) grid.append(savebackCard(state, end));

  // Monthly contributions
  const chartMonths = period === 'todo' ? Object.keys(inv.perMonth).sort() : months;
  const pm = m => inv.perMonth[m] || { own: 0, saveback: 0, roundup: 0, interest: 0, dividends: 0 };
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Aportaciones por mes'), h('span', { class: 'meta' }, 'línea: intereses + dividendos')),
    chartMonths.length ? h('div', { class: 'chart', html: stackedBars({
      labels: chartMonths.map(monthShort), keys: chartMonths,
      series: [
        { id: 'own', label: 'Aportación propia', color: 'var(--c-invest)', values: chartMonths.map(m => pm(m).own) },
        { id: 'roundup', label: 'Redondeo', color: '#8fb4e3', values: chartMonths.map(m => pm(m).roundup) },
        { id: 'saveback', label: 'Saveback', color: 'var(--c-income)', values: chartMonths.map(m => pm(m).saveback) },
      ],
      line: { label: 'Intereses + dividendos', color: 'var(--c-variable)', values: chartMonths.map(m => pm(m).interest + pm(m).dividends) },
    }) }) : h('p', { class: 'muted small' }, 'Sin aportaciones en este periodo.'),
    h('div', { class: 'legend' },
      [['var(--c-invest)', 'Aportación propia'], ['#8fb4e3', 'Redondeo'], ['var(--c-income)', 'Saveback'], ['var(--c-variable)', 'Intereses + dividendos']].map(([c, l]) =>
        h('span', { class: 'item' }, h('span', { class: 'dot', style: { background: c } }), l)))));

  // Positions
  const posCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Posiciones'), h('span', { class: 'meta' }, 'valor aproximado con el último precio de tus extractos')));
  if (!inv.assets.length) posCard.append(h('p', { class: 'muted small' }, 'Aparecen al importar el extracto de Trade Republic: cada compra, plan de inversión y Saveback suma participaciones a su activo.'));
  else {
    const totInv = inv.assets.reduce((a, x) => a + x.invested, 0);
    const totVal = inv.assets.reduce((a, x) => a + (x.value ?? x.invested), 0);
    posCard.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Activo'), h('th', { class: 'r' }, 'Participaciones'), h('th', { class: 'r' }, 'Invertido'), h('th', { class: 'r' }, 'De Saveback'), h('th', { class: 'r' }, 'Último precio'), h('th', { class: 'r' }, 'Valor aprox.'), h('th', { class: 'r' }, 'Diferencia'))),
      h('tbody', {}, inv.assets.map(a => {
        const diff = a.value != null ? a.value - a.invested : null;
        return h('tr', {},
          h('td', {}, h('div', { style: { fontWeight: 600 } }, a.name), a.symbol && a.symbol !== a.name ? h('div', { class: 'small muted' }, a.symbol) : null),
          h('td', { class: 'r' }, a.shares ? a.shares.toLocaleString('es-ES', { maximumFractionDigits: 4 }) : '—'),
          h('td', { class: 'r' }, money(a.invested)),
          h('td', { class: 'r' }, a.fromSaveback ? money(a.fromSaveback) : '—'),
          h('td', { class: 'r' }, a.lastPrice != null ? money(a.lastPrice) : '—', a.lastDate ? h('div', { class: 'small muted' }, dateLabel(a.lastDate, true)) : null),
          h('td', { class: 'r' }, a.value != null ? money(a.value) : '—'),
          h('td', { class: 'r ' + (diff > 0 ? 'pos' : diff < 0 ? 'neg' : '') }, diff != null ? money(diff, { sign: true }) + (a.invested > 0 ? ' · ' + pct(diff / a.invested, 1) : '') : '—'));
      }),
      inv.assets.length > 1 ? h('tr', { style: { fontWeight: 700 } }, h('td', {}, 'Total'), h('td', {}), h('td', { class: 'r' }, money(totInv)), h('td', {}), h('td', {}), h('td', { class: 'r' }, money(totVal)),
        h('td', { class: 'r ' + (totVal >= totInv ? 'pos' : 'neg') }, money(totVal - totInv, { sign: true }))) : null))));
    posCard.append(h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, 'No es una valoración en tiempo real: usa el precio de la última operación de cada activo en los extractos importados.'));
  }
  grid.append(posCard);
}

function savebackCard(state, end) {
  const now = savebackStatus(state, end);
  const cfg = now.cfg;
  const history = monthRange(addMonths(end, -1), 6).reverse().map(m => savebackStatus(state, m)).filter(s => s.trCardSpend || s.otherCardSpend || s.received);
  const last = history[0];
  const share = s => (s.trCardSpend + s.otherCardSpend) > 0 ? s.trCardSpend / (s.trCardSpend + s.otherCardSpend) : 0;

  const card = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Saveback'), h('span', { class: 'meta' }, `${pct(cfg.rate)} hasta ${money(cfg.spendCap, { decimals: false })}/mes · máx. ${money(cfg.monthlyCap, { decimals: false })} · requiere planes ≥ ${money(cfg.minPlan, { decimals: false })}/mes`)));

  const grid = h('div', { class: 'grid' });
  grid.append(h('div', { class: 'span-6' },
    h('div', { class: 'small muted', style: { fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' } }, monthLabel(end, true) + (end === currentMonth() ? ' (en curso)' : '')),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '8px' } },
      h('span', {}, 'Gasto con tarjeta TR'), h('b', { class: 'num' }, `${money(now.trCardSpend, { decimals: false })} / ${money(cfg.spendCap, { decimals: false })}`)),
    h('div', { class: 'bar', style: { height: '10px' } }, h('div', { style: { width: Math.min(100, now.capUsed * 100) + '%', background: 'var(--c-income)' } })),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '12px' } },
      h('span', {}, 'Saveback que generas'), h('b', { class: 'num pos' }, money(now.expected))),
    h('div', { class: 'small muted' }, 'Se invierte el día 2 del mes siguiente.'),
    h('div', { style: { marginTop: '12px' } },
      now.planOk
        ? h('span', { class: 'tag auto' }, `✓ Planes de inversión este mes: ${money(now.planAmount, { decimals: false })}`)
        : h('span', { class: 'tag warn' }, `Planes este mes: ${money(now.planAmount, { decimals: false })}. Necesitas ${money(cfg.minPlan, { decimals: false })} o pierdes el Saveback`)),
  ));

  const right = h('div', { class: 'span-6' });
  if (now.missed > 0.01 || (last && last.missed > 0.01)) {
    const s = now.missed > 0.01 ? now : last;
    right.append(h('div', { class: 'banner', style: { marginBottom: '12px' } },
      h('div', {}, h('b', {}, `${money(s.otherCardSpend, { decimals: false })} pagados con tarjeta en otros bancos en ${monthLabel(s.month)}.`),
        h('div', { class: 'small' }, `Con la tarjeta de Trade Republic habrías sumado ${money(s.missed)} más de Saveback.`))));
  }
  if (last) right.append(h('div', { class: 'small' }, `${monthLabel(last.month, true)}: ${money(last.trCardSpend, { decimals: false })} con tarjeta TR → ${last.received ? 'recibido ' + money(last.received) : 'esperado ' + money(last.expected)}.`));
  grid.append(right);
  card.append(grid);

  if (history.length) {
    card.append(h('div', { class: 'table-wrap', style: { marginTop: '14px' } }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Mes'), h('th', { class: 'r' }, 'Tarjeta TR'), h('th', { class: 'r' }, 'Tarjeta otros bancos'), h('th', { class: 'r' }, '% en TR'), h('th', { class: 'r' }, 'Saveback'), h('th', { class: 'r' }, 'Dejado de ganar'))),
      h('tbody', {}, history.map(s => h('tr', {},
        h('td', {}, monthLabel(s.month)),
        h('td', { class: 'r' }, money(s.trCardSpend, { decimals: false })),
        h('td', { class: 'r' }, money(s.otherCardSpend, { decimals: false })),
        h('td', { class: 'r' }, pct(share(s))),
        h('td', { class: 'r pos' }, money(s.received || s.expected), !s.planOk ? h('div', { class: 'small neg' }, 'sin plan ≥ ' + money(cfg.minPlan, { decimals: false })) : null),
        h('td', { class: 'r ' + (s.missed > 0.01 ? 'neg' : 'muted') }, s.missed > 0.01 ? money(s.missed) : '—')))))));
    card.append(h('p', { class: 'small muted', style: { margin: '8px 0 0' } }, '«Tarjeta otros bancos» son los pagos con tarjeta de tus otras cuentas: es lo que podrías mover a la tarjeta de Trade Republic. Ajusta las condiciones del Saveback en Ajustes si cambian.'));
  }
  return card;
}
