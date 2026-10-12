import { h, money, pct, monthLabel, monthShort, monthRange, dateLabel, currentMonth, addMonths } from '../util.js';
import { latestMonth } from '../analysis.js';
import { investmentSummary, savebackStatus, hasTradeRepublic } from '../invest.js';
import { stackedBars } from '../charts.js';
import { emptyState } from '../ui.js';
import { savingsTabs } from './coach.js';

export function render(root, { state, params, navigate }) {
  const period = params.p === 'todo' ? 'todo' : '12m';
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Savings'), h('div', { class: 'sub' }, 'Contributions, Saveback, interest and positions.')),
    h('div', { class: 'btn-row' }, savingsTabs('inversion'), h('div', { class: 'seg' },
      h('button', { class: period === '12m' ? 'on' : '', onclick: () => navigate('inversion', { p: '12m' }) }, '12 months'),
      h('button', { class: period === 'todo' ? 'on' : '', onclick: () => navigate('inversion', { p: 'todo' }) }, 'All time')))));

  const latest = latestMonth(state);
  if (!latest) {
    root.append(emptyState({ title: 'No transactions yet', text: 'Import your Trade Republic statement (Profile → Transactions → Export) to see your contributions, Saveback and interest.', actions: [h('a', { class: 'btn primary', href: '#/importar' }, 'Import statement')] }));
    return;
  }
  const end = latest > currentMonth() ? latest : currentMonth();
  const months = monthRange(end, 12);
  const inv = investmentSummary(state, period === 'todo' ? null : months);
  const t = inv.total;

  const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), h('div', { class: 'kpi-sub' }, sub));
  const n = period === 'todo' ? Math.max(1, Object.keys(inv.perMonth).length) : 12;
  root.append(h('div', { class: 'kpis', style: { marginBottom: '16px' } },
    kpi('Contributed', money(t.own + t.roundup - t.withdrawn, { decimals: false }), 'avg ' + money((t.own + t.roundup - t.withdrawn) / n, { decimals: false }) + '/month'),
    kpi(t.bonus ? 'Saveback & bonuses' : 'Saveback', money(t.saveback + t.bonus), t.bonus ? `${money(t.saveback)} Saveback · ${money(t.bonus)} free shares` : 'free, as shares'),
    kpi('Interest', money(t.interest), 'avg ' + money(t.interest / n) + '/month'),
    kpi('Dividends', money(t.dividends), t.withdrawn ? 'sales: ' + money(t.withdrawn, { decimals: false }) : ' ')));

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  if (hasTradeRepublic(state)) grid.append(savebackCard(state, end));

  // Monthly contributions
  const chartMonths = period === 'todo' ? Object.keys(inv.perMonth).sort() : months;
  const pm = m => inv.perMonth[m] || { own: 0, saveback: 0, bonus: 0, roundup: 0, interest: 0, dividends: 0 };
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Contributions by month'), h('span', { class: 'meta' }, 'line: interest + dividends')),
    chartMonths.length ? h('div', { class: 'chart', html: stackedBars({
      labels: chartMonths.map(monthShort), keys: chartMonths,
      series: [
        { id: 'own', label: 'Own contributions', color: 'var(--c-invest)', values: chartMonths.map(m => pm(m).own) },
        { id: 'roundup', label: 'Round-ups', color: '#8fb4e3', values: chartMonths.map(m => pm(m).roundup) },
        { id: 'saveback', label: 'Saveback', color: 'var(--c-income)', values: chartMonths.map(m => pm(m).saveback + pm(m).bonus) },
      ],
      line: { label: 'Interest + dividends', color: 'var(--c-variable)', values: chartMonths.map(m => pm(m).interest + pm(m).dividends) },
    }) }) : h('p', { class: 'muted small' }, 'No contributions in this period.'),
    h('div', { class: 'legend' },
      [['var(--c-invest)', 'Own contributions'], ['#8fb4e3', 'Round-ups'], ['var(--c-income)', 'Saveback'], ['var(--c-variable)', 'Interest + dividends']].map(([c, l]) =>
        h('span', { class: 'item' }, h('span', { class: 'dot', style: { background: c } }), l)))));

  // Positions
  const posCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Positions'), h('span', { class: 'meta' }, 'approximate value at the last price in your statements')));
  if (!inv.assets.length) posCard.append(h('p', { class: 'muted small' }, 'These appear when you import your Trade Republic statement: each buy, savings plan and Saveback adds shares to its asset.'));
  else {
    const totInv = inv.assets.reduce((a, x) => a + x.invested, 0);
    const totVal = inv.assets.reduce((a, x) => a + (x.value ?? x.invested), 0);
    posCard.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Asset'), h('th', { class: 'r' }, 'Shares'), h('th', { class: 'r' }, 'Invested'), h('th', { class: 'r' }, 'From Saveback'), h('th', { class: 'r' }, 'Last price'), h('th', { class: 'r' }, 'Approx. value'), h('th', { class: 'r' }, 'Difference'))),
      h('tbody', {}, inv.assets.map(a => {
        const diff = a.value != null ? a.value - a.invested : null;
        return h('tr', {},
          h('td', {}, h('div', { style: { fontWeight: 600 } }, a.name), a.symbol && a.symbol !== a.name ? h('div', { class: 'small muted' }, a.symbol) : null),
          h('td', { class: 'r' }, a.shares ? a.shares.toLocaleString('en-GB', { maximumFractionDigits: 4 }) : '—'),
          h('td', { class: 'r' }, money(a.invested)),
          h('td', { class: 'r' }, a.fromSaveback ? money(a.fromSaveback) : '—'),
          h('td', { class: 'r' }, a.lastPrice != null ? money(a.lastPrice) : '—', a.lastDate ? h('div', { class: 'small muted' }, dateLabel(a.lastDate, true)) : null),
          h('td', { class: 'r' }, a.value != null ? money(a.value) : '—'),
          h('td', { class: 'r ' + (diff > 0 ? 'pos' : diff < 0 ? 'neg' : '') }, diff != null ? money(diff, { sign: true }) + (a.invested > 0 ? ' · ' + pct(diff / a.invested, 1) : '') : '—'));
      }),
      inv.assets.length > 1 ? h('tr', { style: { fontWeight: 700 } }, h('td', {}, 'Total'), h('td', {}), h('td', { class: 'r' }, money(totInv)), h('td', {}), h('td', {}), h('td', { class: 'r' }, money(totVal)),
        h('td', { class: 'r ' + (totVal >= totInv ? 'pos' : 'neg') }, money(totVal - totInv, { sign: true }))) : null))));
    posCard.append(h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, 'Not a live valuation: it uses the price of the last trade for each asset in your imported statements.'));
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
    h('div', { class: 'card-head' }, h('h2', {}, 'Saveback'), h('span', { class: 'meta' }, `${pct(cfg.rate)} up to ${money(cfg.spendCap, { decimals: false })}/month · max ${money(cfg.monthlyCap, { decimals: false })} · needs savings plans ≥ ${money(cfg.minPlan, { decimals: false })}/month`)));

  const grid = h('div', { class: 'grid' });
  grid.append(h('div', { class: 'span-6' },
    h('div', { class: 'small muted', style: { fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' } }, monthLabel(end, true) + (end === currentMonth() ? ' (in progress)' : '')),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '8px' } },
      h('span', {}, 'TR card spending'), h('b', { class: 'num' }, `${money(now.trCardSpend, { decimals: false })} / ${money(cfg.spendCap, { decimals: false })}`)),
    h('div', { class: 'bar', style: { height: '10px' } }, h('div', { style: { width: Math.min(100, now.capUsed * 100) + '%', background: 'var(--c-income)' } })),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '12px' } },
      h('span', {}, 'Saveback you\'re earning'), h('b', { class: 'num pos' }, money(now.expected))),
    h('div', { class: 'small muted' }, 'Invested on the 2nd of next month.'),
    h('div', { style: { marginTop: '12px' } },
      now.planOk
        ? h('span', { class: 'tag auto' }, `✓ Savings plans this month: ${money(now.planAmount, { decimals: false })}`)
        : h('span', { class: 'tag warn' }, `Savings plans this month: ${money(now.planAmount, { decimals: false })}. You need ${money(cfg.minPlan, { decimals: false })} or you lose the Saveback`)),
  ));

  const right = h('div', { class: 'span-6' });
  if (now.missed > 0.01 || (last && last.missed > 0.01)) {
    const s = now.missed > 0.01 ? now : last;
    right.append(h('div', { class: 'banner', style: { marginBottom: '12px' } },
      h('div', {}, h('b', {}, `${money(s.otherCardSpend, { decimals: false })} paid by card at other banks in ${monthLabel(s.month)}.`),
        h('div', { class: 'small' }, `With the Trade Republic card you'd have earned ${money(s.missed)} more Saveback.`))));
  }
  if (last) right.append(h('div', { class: 'small' }, `${monthLabel(last.month, true)}: ${money(last.trCardSpend, { decimals: false })} on the TR card → ${last.received ? 'received ' + money(last.received) : 'expected ' + money(last.expected)}.`));
  grid.append(right);
  card.append(grid);

  if (history.length) {
    card.append(h('div', { class: 'table-wrap', style: { marginTop: '14px' } }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', { class: 'r' }, 'TR card'), h('th', { class: 'r' }, 'Other banks\' cards'), h('th', { class: 'r' }, '% on TR'), h('th', { class: 'r' }, 'Saveback'), h('th', { class: 'r' }, 'Missed'))),
      h('tbody', {}, history.map(s => h('tr', {},
        h('td', {}, monthLabel(s.month)),
        h('td', { class: 'r' }, money(s.trCardSpend, { decimals: false })),
        h('td', { class: 'r' }, money(s.otherCardSpend, { decimals: false })),
        h('td', { class: 'r' }, pct(share(s))),
        h('td', { class: 'r pos' }, money(s.received || s.expected), !s.planOk ? h('div', { class: 'small neg' }, 'no plan ≥ ' + money(cfg.minPlan, { decimals: false })) : null),
        h('td', { class: 'r ' + (s.missed > 0.01 ? 'neg' : 'muted') }, s.missed > 0.01 ? money(s.missed) : '—')))))));
    card.append(h('p', { class: 'small muted', style: { margin: '8px 0 0' } }, '“Other banks\' cards” are card payments from your other accounts: what you could move to the Trade Republic card. Adjust the Saveback terms in Settings if they change.'));
  }
  return card;
}
