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
    h('a', { href: '#/inversion', class: 'btn-seg' + (active === 'inversion' ? ' on' : '') }, 'Investing'));
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
    h('div', {}, h('h1', {}, 'Savings'), h('div', { class: 'sub' }, 'What you could have avoided, and what it would be worth invested.')),
    h('div', { class: 'btn-row' }, savingsTabs('ahorro'),
      month ? h('div', { class: 'period' },
        h('button', { class: 'btn icon', 'aria-label': 'Previous month', onclick: () => go(addMonths(month, -1)) }, '‹'),
        h('div', { class: 'label' }, monthLabel(month, true)),
        h('button', { class: 'btn icon', 'aria-label': 'Next month', disabled: month >= latest, onclick: () => go(addMonths(month, 1)) }, '›')) : null)));

  if (!latest) {
    view.append(emptyState({ title: 'No transactions yet', text: 'Import your statements and rate your expenses to see how much you could have saved.', actions: [h('a', { class: 'btn primary', href: '#/importar' }, 'Import statement')] }));
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
    h('div', { class: 'kpi-label' }, 'Opportunity cost · ' + monthLabel(month, true)),
    h('div', { style: { display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px' } },
      h('div', {}, h('div', { style: { fontSize: '34px', fontWeight: 750, letterSpacing: '-0.02em' }, class: 'num' }, money(c.likeTotal, { decimals: false })),
        h('div', { class: 'small muted' }, `on likes (${c.like.length} ${c.like.length === 1 ? 'expense' : 'expenses'})`)),
      h('div', { style: { fontSize: '22px', color: 'var(--muted)', paddingBottom: '18px' } }, '→'),
      h('div', {}, h('div', { style: { fontSize: '34px', fontWeight: 750, letterSpacing: '-0.02em', color: 'var(--c-invest)' }, class: 'num' }, money(c.likeFV, { decimals: false })),
        h('div', { class: 'small muted' }, `in ${cfg.years} years in an MSCI World fund`))),
    avgLike > 0 ? h('div', { class: 'banner', style: { marginTop: '14px', marginBottom: 0 } },
      h('span', {}, `Your average on likes is ${money(avgLike, { decimals: false })}/month. Invested every month for ${cfg.years} years, that would be `, h('b', {}, money(habitFV, { decimals: false })), '.')) : null,
    h('p', { class: 'small muted', style: { margin: '12px 0 0' } },
      `Assumes a ${pct(cfg.returnRate, 1)} annual return, close to the MSCI World's long-run historical average in euros. Not a guarantee. You can change it in Settings.`),
    c.unrated > 0 ? h('p', { class: 'small', style: { margin: '8px 0 0' } }, `${money(c.unrated, { decimals: false })} this month is not rated yet: `, h('a', { href: '#review-card', onclick: e => { e.preventDefault(); document.getElementById('review-card')?.scrollIntoView({ behavior: 'smooth' }); } }, 'rate it'), '.') : null));

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
    h('div', { class: 'card-head' }, h('h2', {}, 'Avoidable this month'), h('span', { class: 'meta' }, 'likes · value in ' + cfg.years + ' years')));
  if (!byMerchant.size) likeCard.append(h('p', { class: 'small muted' }, rated ? 'No likes this month.' : 'Rate your merchants (Need, Want or Like) and you\'ll see each month\'s avoidable spending here.'));
  likeCard.append(h('div', { class: 'rows' }, [...byMerchant.values()].sort((a, b) => b.total - a.total).map(g => h('div', { class: 'row' },
    catIcon(ctx.cats.get(g.categoryId), 30),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, g.name), h('div', { class: 'desc' }, g.single ? 'this expense only · ' + dateLabel(g.txs[0].date) : `${g.txs.length} ${g.txs.length === 1 ? 'time' : 'times'}`)),
    h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amount' }, money(g.total, { decimals: false })), h('div', { class: 'small', style: { color: 'var(--c-invest)' } }, '→ ' + money(futureValue(g.total, cfg.returnRate, cfg.years), { decimals: false }))),
    h('button', { class: 'btn sm ghost', title: 'Change rating', onclick: () => {
      update(s => { if (g.single) rateTransaction(s, g.txs[0].id, 'want'); else rateMerchant(s, g.merchant, 'want'); });
      toast(`“${g.name}” moved to Want`, { action: 'Undo', onAction: () => { update(s => { if (g.single) rateTransaction(s, g.txs[0].id, 'like'); else rateMerchant(s, g.merchant, 'like'); }); draw(view, params); } });
      draw(view, params);
    } }, 'Wasn\'t avoidable')))));
  grid.append(likeCard);

  // ---------- trend ----------
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Likes and wants by month'), h('span', { class: 'meta' }, `wants this month: ${money(c.wantTotal, { decimals: false })}`)),
    h('div', { class: 'chart', html: stackedBars({
      labels: trend.map(t => monthShort(t.month)), keys: trend.map(t => t.month), selected: month, height: 220,
      series: [
        { id: 'like', label: 'Likes', color: VALUE_COLORS.like, values: trend.map(t => t.like) },
        { id: 'want', label: 'Wants', color: VALUE_COLORS.want, values: trend.map(t => t.want) },
      ],
    }) }),
    h('div', { class: 'legend' },
      h('span', { class: 'item' }, h('span', { class: 'dot', style: { background: VALUE_COLORS.like } }), 'Likes (avoidable)'),
      h('span', { class: 'item' }, h('span', { class: 'dot', style: { background: VALUE_COLORS.want } }), 'Wants (trimmable)')),
    h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, `If you trimmed 20% of your wants (${money(c.wantTotal * 0.2, { decimals: false })} this month) every month, in ${cfg.years} years that would be ${money(futureValueMonthly(c.wantTotal * 0.2, cfg.returnRate, cfg.years), { decimals: false })}.`)));
}

function reviewCard(view, params, queue, cfg, ctx, rated) {
  const card = h('section', { class: 'card span-12', id: 'review-card' });
  card.append(h('div', { class: 'card-head' }, h('h2', {}, 'Expense review'),
    h('span', { class: 'meta' }, queue.length ? `${queue.length} to rate · repeats every ${cfg.reviewDays} days` : `up to date · ${rated} merchants rated`)));
  if (!queue.length) {
    card.append(h('p', { class: 'small muted', style: { margin: 0 } }, `Nothing pending. Each merchant comes back here ${cfg.reviewDays} days after you rate it, if you're still spending there, so you can check it's still worth it.`));
    return card;
  }
  const g = queue[0];
  const cat = g.categoryId ? ctx.cats.get(g.categoryId) : null;
  const rate = v => {
    update(s => rateMerchant(s, g.merchant, v));
    toast(`“${g.name}”: ${VALUE_LABELS[v]}`, { action: 'Undo', onAction: () => { update(s => { if (g.previous) rateMerchant(s, g.merchant, g.previous, Date.now() - 365 * 86400000); else delete s.values[g.merchant]; }); draw(view, params); } });
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
          g.recurring ? `${g.recurring.cadenceLabel.toLowerCase()} · ${money(g.recurring.typical)}` : `${g.count} ${g.count === 1 ? 'time' : 'times'} in 3 months · ${money(g.total, { decimals: false })}`,
          g.previous ? `last time: ${VALUE_LABELS[g.previous].toLowerCase()}` : null,
        ].filter(Boolean).join(' · ')))),
    h('div', { class: 'banner', style: { margin: '14px 0' } },
      g.essential
        ? h('span', {}, `Recurring essential of about ${money(g.monthly, { decimals: false })}/month. Still on the best rate? 10% less would be ${money(futureValueMonthly(g.monthly * 0.1, cfg.returnRate, cfg.years), { decimals: false })} in ${cfg.years} years.`)
        : h('span', {}, `About ${money(g.monthly, { decimals: false })}/month. Invested for ${cfg.years} years, that would be `, h('b', {}, money(g.fv, { decimals: false })), '.')),
    h('div', { class: 'chips' }, ['need', 'want', 'like'].map(v => h('button', {
      class: 'chip' + (g.previous === v ? ' on' : ''), style: { height: 'auto', padding: '10px 14px', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', borderRadius: '12px' },
      onclick: () => rate(v),
    }, h('b', {}, VALUE_LABELS[v]), h('span', { class: 'small muted', style: { fontWeight: 400 } }, VALUE_HELP[v])))),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', alignItems: 'center' } },
      h('span', { class: 'small muted' }, queue.length > 1 ? `Next: ${queue[1].name}` : 'Last one'),
      h('button', { class: 'btn ghost sm', onclick: () => {
        // Skip: postpone this merchant by a week.
        update(s => { if (g.previous) rateMerchant(s, g.merchant, g.previous, Date.now() - (cfg.reviewDays - 7) * 86400000); else { s.values = s.values || {}; s.values[g.merchant] = { v: null, at: Date.now() - (cfg.reviewDays - 7) * 86400000 }; } });
        draw(view, params);
      } }, 'Later →')));
  return card;
}
