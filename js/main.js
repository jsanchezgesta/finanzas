import { load, subscribe, getState } from './store.js';
import { buildContext } from './analysis.js';
import { clear } from './util.js';
import * as home from './views/home.js';
import * as dashboard from './views/dashboard.js';
import * as gastos from './views/spending.js';
import * as transactions from './views/transactions.js';
import * as review from './views/review.js';
import * as plan from './views/plan.js';
import * as importer from './views/import.js';
import * as settings from './views/settings.js';
import * as inversion from './views/invest.js';
import * as viajes from './views/trips.js';
import * as ahorro from './views/coach.js';
import { reviewQueue } from './coach.js';
import { sync, startSync } from './syncApp.js';
import { needsAttention, conflictSheet, unlockSheet, signIn } from './views/sync.js';
import { toast } from './ui.js';

const routes = {
  inicio: home,
  resumen: dashboard,
  gastos,
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
  return { route: routes[path] ? path : 'inicio', params };
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
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === ({ viajes: 'plan', inversion: 'ahorro', gastos: 'resumen' }[route] || route)));
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

// Surface sync problems once per state change: a dot on Settings and a toast.
function watchSync() {
  let last = null;
  sync.subscribe(st => {
    const link = document.querySelector('.nav a[data-route="ajustes"]');
    let dot = link?.querySelector('.sync-alert');
    if (needsAttention(st) && link && !dot) link.append(dot = Object.assign(document.createElement('i'), { className: 'sync-alert', title: 'Sync needs attention' }));
    if (!needsAttention(st)) dot?.remove();
    if (st.state === last) return;
    last = st.state;
    if (st.state === 'conflict') conflictSheet();
    else if (st.state === 'locked') toast('Enter your sync password to sync', { action: 'Unlock', onAction: unlockSheet, timeout: 8000 });
    else if (st.state === 'auth') toast('Sign in to Google to sync', { action: 'Sign in', onAction: signIn, timeout: 8000 });
    else if (st.state === 'idle' && st.action === 'pull') toast('Updated from your other device');
  });
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
  watchSync();
  startSync().catch(e => console.error('sync', e));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
