// App state, persisted locally in IndexedDB (falls back to localStorage).
// Nothing leaves the device.

import { defaultState, DEFAULT_CATEGORIES } from './defaults.js';
import { TRIP_CATEGORIES } from './trips.js';

const DB_NAME = 'finanzas';
const STORE = 'kv';
const KEY = 'state';

let state = null;
const listeners = new Set();
let saveTimer = null;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function migrate(s) {
  const base = defaultState();
  const out = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}), saveback: { ...base.settings.saveback, ...(s.settings?.saveback || {}) } } };
  // Add any default categories introduced in later versions.
  const ids = new Set(out.categories.map(c => c.id));
  const deleted = new Set(out.settings.deletedCategoryIds || []);
  for (const c of DEFAULT_CATEGORIES) if (!ids.has(c.id) && !deleted.has(c.id)) out.categories.push({ ...c });
  // Trip budgets are keyed by trip categories (vuelos, alojamiento…) since v5.
  const tripIds = new Set(TRIP_CATEGORIES.map(c => c.id));
  for (const t of out.trips || []) {
    t.catBudgets = Object.fromEntries(Object.entries(t.catBudgets || {}).filter(([k]) => tripIds.has(k)));
  }
  return out;
}

export async function load() {
  let raw = null;
  try { raw = await idbGet(); } catch {
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  }
  state = raw ? migrate(raw) : defaultState();
  return state;
}

export function getState() { return state; }

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const snapshot = JSON.parse(JSON.stringify(state));
  try { await idbSet(snapshot); } catch {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch (e) { console.error('No se pudo guardar', e); }
  }
}

export function update(fn) {
  const result = fn(state);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
  for (const l of listeners) l(state);
  return result;
}

export function replaceState(next) {
  state = migrate(next);
  flush();
  for (const l of listeners) l(state);
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flush(); });
  window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
}
