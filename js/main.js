import { load, subscribe, getState } from './store.js';
import { buildContext } from './analysis.js';
import { clear } from './util.js';
import * as dashboard from './views/dashboard.js';
import * as transactions from './views/transactions.js';
import * as review from './views/review.js';
import * as plan from './views/plan.js';
import * as importer from './views/import.js';
import * as settings from './views/settings.js';
import * as inversion from './views/invest.js';
import * as viajes from './views/trips.js';
import * as ahorro from './views/coach.js';
import { reviewQueue } from './coach.js';

const routes = {
  resumen: dashboard,
  movimientos: transactions,
  revisar: review,
  plan,
  inversion,
  viajes,
  ahorro,
  importar: importer,
  ajustes: settings,
};

const main = document.getElementById('main');
let current = null;
let ctxCache = null;

export function getContext() {
  if (!ctxCache) ctxCache = buildContext(getState());
  return ctxCache;
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { route: routes[path] ? path : (getState().transactions.length ? 'resumen' : 'importar'), params };
}

export function navigate(route, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  location.hash = '#/' + route + (q ? '?' + q : '');
}

// Update the hash without re-rendering (for filters kept in the URL).
export function setParams(params) {
  const { route } = parseHash();
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  history.replaceState(null, '', '#/' + route + (q ? '?' + q : ''));
}

function render({ keepScroll = false } = {}) {
  const { route, params } = parseHash();
  const view = routes[route];
  const scroll = window.scrollY;
  const same = current?.route === route;
  // Keep focus on the same field across re-renders (e.g. tabbing through the plan).
  const focusKey = document.activeElement?.getAttribute?.('aria-label');
  current = { route, view };
  clear(main);
  view.render(main, { state: getState(), ctx: getContext(), params, navigate });
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === ({ viajes: 'plan', inversion: 'ahorro' }[route] || route)));
  if (keepScroll && same) {
    window.scrollTo(0, scroll);
    if (focusKey) main.querySelector(`[aria-label="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  } else window.scrollTo(0, 0);
  updateBadge();
}

function updateBadge() {
  const n = getState().transactions.filter(t => t.status === 'pending').length;
  const b = document.getElementById('pending-badge');
  b.hidden = n === 0;
  b.textContent = n > 99 ? '99+' : String(n);
  const due = getState().transactions.length ? reviewQueue(getState(), getContext()).length : 0;
  const cb = document.getElementById('coach-badge');
  if (cb) { cb.hidden = due === 0; cb.textContent = due > 99 ? '99+' : String(due); }
}

async function start() {
  await load();
  subscribe(() => {
    ctxCache = null;
    updateBadge();
    // Views that hold local UI state (import wizard, review card) opt out of
    // full re-render and update themselves.
    if (current?.view.live === false) return;
    render({ keepScroll: true });
  });
  window.addEventListener('hashchange', () => render());
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
