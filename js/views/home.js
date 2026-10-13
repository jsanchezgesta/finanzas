import { h, dateLabel } from '../util.js';

// Landing screen: a greeting and four shortcuts into the app.
const icon = paths => h('span', { class: 'home-ico', 'aria-hidden': 'true', html:
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>` });

const OPTIONS = [
  { route: 'importar', title: 'Upload new data', text: 'Import a CaixaBank or Trade Republic export.',
    icon: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>' },
  { route: 'resumen', title: 'Go to metrics', text: 'Spending, income and trends.',
    icon: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>' },
  { route: 'inversion', title: 'Go to investments', text: 'Contributions, Saveback, interest and positions.',
    icon: '<path d="M4 19h16"/><path d="M5 15l4-4 3 3 7-7"/><path d="M15 7h4v4"/>' },
  { route: 'plan', title: 'Go to plan', text: 'Your monthly budget and trips.',
    icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>' },
  { route: 'gastos', title: 'Spending tables', text: 'Recurring, day-to-day and larger expenses. Test view.',
    icon: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9"/>' },
];

export function render(root, { state }) {
  const txs = state.transactions;
  const last = txs.reduce((max, t) => (t.date > max ? t.date : max), '');
  root.append(h('div', { class: 'home' },
    h('div', { class: 'home-head' },
      h('h1', {}, txs.length ? 'Welcome back' : 'Welcome'),
      h('div', { class: 'sub' }, txs.length ? `Data up to ${dateLabel(last, true)}.` : 'Start by uploading a bank export.')),
    h('div', { class: 'home-grid' }, OPTIONS.map(o =>
      h('a', { class: 'home-tile', href: '#/' + o.route },
        icon(o.icon),
        h('span', { class: 'home-text' }, h('strong', {}, o.title), h('span', { class: 'muted small' }, o.text)))))));
}
