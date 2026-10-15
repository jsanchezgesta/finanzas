// App state, persisted locally in IndexedDB (falls back to localStorage).
// Nothing leaves the device unless you turn on encrypted Google Drive sync.

import { defaultState, DEFAULT_CATEGORIES, LEGACY_CATEGORY_NAMES } from './defaults.js';
import { TRIP_CATEGORIES } from './trips.js';
import { createSnapshots, hasContent } from './snapshots.js';

const DB_NAME = 'finanzas';
const STORE = 'kv';
const KEY = 'state';

let state = null;
const listeners = new Set();
let saveTimer = null;
let dbPromise = null;
const localListeners = new Set();

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

// Generic key/value helpers (also used by sync for the vault key, which is a
// non-extractable CryptoKey and can only live in IndexedDB).
export async function kvGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function kvDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const idbGet = () => kvGet(KEY);
const idbSet = v => kvSet(KEY, v);

export function migrate(s) {
  const base = defaultState();
  const out = { ...base, ...s, meta: { updatedAt: 0, ...(s.meta || {}) }, settings: { ...base.settings, ...(s.settings || {}), saveback: { ...base.settings.saveback, ...(s.settings?.saveback || {}) } } };
  // Add any default categories introduced in later versions.
  const ids = new Set(out.categories.map(c => c.id));
  for (const c of out.categories) if (LEGACY_CATEGORY_NAMES[c.name]) c.name = LEGACY_CATEGORY_NAMES[c.name];
  const deleted = new Set(out.settings.deletedCategoryIds || []);
  for (const c of DEFAULT_CATEGORIES) if (!ids.has(c.id) && !deleted.has(c.id)) out.categories.push({ ...c });
  // Trip budgets are keyed by trip categories (vuelos, alojamiento…) since v5.
  const tripIds = new Set(TRIP_CATEGORIES.map(c => c.id));
  for (const t of out.trips || []) {
    t.catBudgets = Object.fromEntries(Object.entries(t.catBudgets || {}).filter(([k]) => tripIds.has(k)));
  }
  return out;
}

function lsGet() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

// True when the saved data couldn't be read. The app then shows a warning and
// never saves or syncs, so an empty screen can't overwrite the real data.
export let storageProblem = null;

export async function load() {
  let raw = null;
  let idbError = null;
  // iOS Safari sometimes fails to open IndexedDB on the first try after the
  // app was in the background; retry with a fresh connection.
  for (let i = 0; i < 3; i++) {
    try { raw = await idbGet(); idbError = null; break; } catch (e) {
      idbError = e; dbPromise = null;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  // If a save ever fell back to localStorage, that copy may be the only one.
  if (!raw || !hasContent(raw)) {
    const ls = lsGet();
    if (ls && hasContent(ls) && (!raw || (ls.meta?.updatedAt || 0) >= (raw.meta?.updatedAt || 0))) raw = ls;
  }
  if (idbError && !raw && 'indexedDB' in globalThis) {
    storageProblem = idbError;
    state = defaultState();
    return state;
  }
  state = raw ? migrate(raw) : defaultState();
  snapshots.daily(state).catch(() => {});
  requestPersistence();
  return state;
}

// ---------- restore points ----------
export const snapshots = createSnapshots({ kvGet: k => kvGet(k), kvSet: (k, v) => kvSet(k, v), kvDel: k => kvDel(k) });

// Take a restore point of the current data (before a bulk delete or replace).
export async function snapshot(reason) {
  try { await flush(); return await snapshots.take(state, reason); } catch (e) { console.error('snapshot', e); return null; }
}

// ---------- save errors ----------
const errorListeners = new Set();
export function onSaveError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); }

export function getState() { return state; }

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (storageProblem) return;
  const copy = JSON.parse(JSON.stringify(state));
  try {
    await idbSet(copy);
    // A stale localStorage fallback must not win on the next load.
    try { if (localStorage.getItem(KEY)) localStorage.removeItem(KEY); } catch { /* ignore */ }
  } catch (idbErr) {
    try { localStorage.setItem(KEY, JSON.stringify(copy)); } catch (e) {
      console.error('Could not save', idbErr, e);
      for (const l of errorListeners) l(e);
    }
  }
}

export function update(fn) {
  const result = fn(state);
  state.meta = { ...(state.meta || {}), updatedAt: Date.now() };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
  for (const l of listeners) l(state);
  for (const l of localListeners) l(state);
  return result;
}

// Replace everything (restore a backup, or apply the copy from Drive).
// fromSync keeps the incoming timestamp so it isn't re-uploaded as a change.
// A restore point of the current data is taken first.
export async function replaceState(next, { fromSync = false, reason = 'Before replacing data' } = {}) {
  if (hasContent(state)) await snapshot(reason);
  state = migrate(next);
  if (!fromSync) {
    state.meta.updatedAt = Date.now();
    for (const l of localListeners) l(state);
  }
  const done = flush();
  for (const l of listeners) l(state);
  await done;
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// Only changes made on this device (used to trigger an upload).
export function onLocalChange(fn) { localListeners.add(fn); return () => localListeners.delete(fn); }
export function flushNow() { return flush(); }

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flush(); });
  window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
}
