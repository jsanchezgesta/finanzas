// Encrypted sync through Google Drive.
//
// One file, "App Finanzas/finanzas-data.enc.json", holds the whole app state
// encrypted with a key derived from your sync password. Each device keeps
// working offline from its own copy and syncs when it can:
//   - only this device changed → upload
//   - only Drive changed       → download and replace
//   - both changed             → ask which copy to keep
// The plaintext timestamp in the file's appProperties lets a device check for
// changes without downloading anything.

import { deriveKey, encryptJSON, decryptJSON, randomSalt, toB64, fromB64, WrongPasswordError } from './crypto.js';
import { summarizeState } from './snapshots.js';

const META_KEY = 'finanzas.sync';
const VAULT_KEY = 'vault';

export function decide({ local, lastSynced, remote, lastRemote, localHasData }) {
  if (remote == null) return 'push';
  if (lastRemote == null) return remote === local ? 'none' : localHasData ? 'conflict' : 'pull';
  const remoteChanged = remote !== lastRemote;
  const localChanged = local > (lastSynced || 0);
  if (remoteChanged && localChanged) return 'conflict';
  if (remoteChanged) return 'pull';
  if (localChanged) return 'push';
  return 'none';
}

export function deviceName(ua = globalThis.navigator?.userAgent || '') {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Browser';
}

const hasData = s => (s.transactions?.length || 0) + (s.trips?.length || 0) > 0;

// Would replacing `local` with `remote` lose a large part of the data? Then a
// download is never applied silently: the user sees both copies and chooses.
export function wouldShrink(local, remote) {
  const l = summarizeState(local), r = summarizeState(remote);
  const lost = l.transactions - r.transactions;
  if (l.transactions > 0 && r.transactions === 0) return true;
  if (lost >= 20 && r.transactions < l.transactions * 0.8) return true;
  if (l.accounts > 0 && r.accounts === 0) return true;
  return false;
}

export class PasswordChangedError extends Error {
  constructor() { super('The sync password was changed on another device. Enter the new one.'); this.name = 'PasswordChangedError'; }
}

// deps: { drive, store: { getState, replaceState, kvGet, kvSet, kvDel }, storage, now }
export function createSync({ drive, store, storage = globalThis.localStorage, now = () => Date.now() }) {
  let meta = readMeta();
  let key = null;
  let status = { state: meta.enabled ? 'locked' : 'off' };
  let pending = null; // conflict details
  let running = null;
  let again = false;
  const listeners = new Set();

  function readMeta() {
    try { return JSON.parse(storage?.getItem(META_KEY) || 'null') || { enabled: false }; } catch { return { enabled: false }; }
  }
  function saveMeta() { try { storage?.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ } }
  function setStatus(s) { status = { ...s, at: now() }; for (const l of listeners) l(status); }

  async function init() {
    if (!meta.enabled) return setStatus({ state: 'off' });
    try {
      const v = await store.kvGet(VAULT_KEY);
      if (v?.key && v.salt === meta.salt) key = v.key;
    } catch { /* ignore */ }
    if (!key) return setStatus({ state: 'locked' });
    setStatus({ state: drive.hasToken() ? 'idle' : 'auth' });
  }

  async function rememberKey(remember) {
    meta.remember = !!remember;
    try {
      if (remember) await store.kvSet(VAULT_KEY, { key, salt: meta.salt });
      else await store.kvDel(VAULT_KEY);
    } catch { /* ignore: just won't be remembered */ }
  }

  // Step 1 of connecting (call from a tap): sign in, find or create the
  // folder, and tell the UI whether a sync file already exists.
  async function probe() {
    await drive.getToken({ interactive: true });
    const folderId = await drive.ensureFolder();
    const file = await drive.findFile(folderId);
    return { folderId, fileId: file?.id || null, exists: !!file };
  }

  // Step 2: with the password. Joins the existing file or creates it.
  async function connect(password, { folderId, fileId, remember = true }) {
    if (fileId) {
      const env = await drive.download(fileId);
      const k = await deriveKey(password, fromB64(env.salt));
      const data = await decryptJSON(k, env); // throws WrongPasswordError
      key = k;
      meta = { enabled: true, folderId, fileId, salt: env.salt, lastSynced: null, lastRemote: null };
      await rememberKey(remember);
      saveMeta();
      const local = store.getState();
      const remote = Number(env.updatedAt) || data.meta?.updatedAt || 0;
      if (!hasData(local) || (local.meta?.updatedAt && local.meta.updatedAt === remote && !wouldShrink(local, data))) {
        await applyRemote(data, remote);
        setStatus({ state: 'idle', message: 'Loaded your data from Google Drive' });
        return 'pulled';
      }
      pending = { remote, device: env.device, savedAt: env.savedAt, local: summarizeState(local), drive: summarizeState(data) };
      setStatus({ state: 'conflict', ...pending });
      return 'conflict';
    }
    const salt = randomSalt();
    key = await deriveKey(password, salt);
    meta = { enabled: true, folderId, fileId: null, salt: toB64(salt), lastSynced: null, lastRemote: null };
    await rememberKey(remember);
    saveMeta();
    await push();
    setStatus({ state: 'idle' });
    return 'pushed';
  }

  async function unlock(password, { remember = meta.remember ?? true } = {}) {
    if (!meta.enabled) throw new Error('Sync is off');
    const k = await deriveKey(password, fromB64(meta.salt));
    // Check the password against the Drive copy when we can reach it.
    if (meta.fileId && drive.hasToken()) {
      const env = await drive.download(meta.fileId);
      if (env.salt !== meta.salt) {
        const k2 = await deriveKey(password, fromB64(env.salt));
        await decryptJSON(k2, env);
        key = k2; meta.salt = env.salt; saveMeta();
      } else {
        await decryptJSON(k, env);
        key = k;
      }
    } else key = k;
    await rememberKey(remember);
    setStatus({ state: drive.hasToken() ? 'idle' : 'auth' });
    return sync();
  }

  async function applyRemote(data, remoteStamp) {
    data.meta = { ...(data.meta || {}), updatedAt: remoteStamp };
    await store.replaceState(data, { fromSync: true });
    meta.lastSynced = remoteStamp;
    meta.lastRemote = remoteStamp;
    meta.lastSyncAt = now();
    saveMeta();
  }

  async function downloadRemote() {
    const env = await drive.download(meta.fileId);
    if (env.salt !== meta.salt) {
      key = null;
      try { await store.kvDel(VAULT_KEY); } catch { /* ignore */ }
      throw new PasswordChangedError();
    }
    return { env, data: await decryptJSON(key, env) };
  }

  // Returns false (and applies nothing) when the Drive copy would wipe out
  // most of this device's data and the user hasn't chosen it explicitly.
  async function pull({ chosen = false } = {}) {
    const { env, data } = await downloadRemote();
    const local = store.getState();
    if (!chosen && wouldShrink(local, data)) {
      pending = { remote: Number(env.updatedAt) || null, device: env.device, savedAt: env.savedAt, local: summarizeState(local), drive: summarizeState(data), shrink: true };
      return false;
    }
    await applyRemote(data, Number(env.updatedAt) || data.meta?.updatedAt || now());
    return true;
  }

  // Counts for both copies, shown when the user has to choose.
  async function describeConflict(remote) {
    const local = summarizeState(store.getState());
    try {
      const { env, data } = await downloadRemote();
      return { remote: remote.stamp, device: remote.device || env.device, savedAt: env.savedAt, local, drive: summarizeState(data) };
    } catch (e) {
      if (e instanceof PasswordChangedError) throw e;
      return { remote: remote.stamp, device: remote.device, local };
    }
  }

  async function push() {
    const state = store.getState();
    const stamp = state.meta?.updatedAt || now();
    if (!state.meta?.updatedAt) state.meta = { ...(state.meta || {}), updatedAt: stamp };
    const savedAt = now();
    const device = deviceName();
    const content = await encryptJSON(key, fromB64(meta.salt), state, { updatedAt: stamp, savedAt, device });
    const res = await drive.upload({
      fileId: meta.fileId, folderId: meta.folderId, content,
      appProperties: { updatedAt: String(stamp), device },
    });
    meta.fileId = res.id;
    meta.lastSynced = stamp;
    meta.lastRemote = stamp;
    meta.lastSyncAt = savedAt;
    saveMeta();
  }

  async function remoteStamp() {
    if (meta.fileId) {
      try {
        const m = await drive.getMeta(meta.fileId);
        if (!m.trashed) return { stamp: Number(m.appProperties?.updatedAt) || null, device: m.appProperties?.device };
      } catch (e) { if (e.name === 'AuthNeeded') throw e; }
    }
    // File gone (deleted or never created): look for it again, else recreate.
    meta.folderId = await drive.ensureFolder();
    const f = await drive.findFile(meta.folderId);
    meta.fileId = f?.id || null;
    if (!f) { meta.lastRemote = null; saveMeta(); return { stamp: null }; }
    saveMeta();
    return { stamp: Number(f.appProperties?.updatedAt) || null, device: f.appProperties?.device };
  }

  async function run({ force } = {}) {
    if (!meta.enabled) return 'off';
    if (!key) { setStatus({ state: 'locked' }); return 'locked'; }
    if (!drive.hasToken()) { setStatus({ state: 'auth' }); return 'auth'; }
    setStatus({ state: 'syncing' });
    try {
      const remote = await remoteStamp();
      const state = store.getState();
      let action = force || decide({
        local: state.meta?.updatedAt || 0, lastSynced: meta.lastSynced,
        remote: remote.stamp, lastRemote: meta.lastRemote, localHasData: hasData(state),
      });
      if (action === 'pull' && !meta.fileId) action = 'push';
      if (action === 'conflict') {
        pending = await describeConflict(remote);
        setStatus({ state: 'conflict', ...pending });
        return 'conflict';
      }
      if (action === 'push') await push();
      if (action === 'pull' && !(await pull({ chosen: force === 'pull' }))) {
        setStatus({ state: 'conflict', ...pending });
        return 'conflict';
      }
      if (action === 'none') { meta.lastSyncAt = now(); saveMeta(); }
      pending = null;
      setStatus({ state: 'idle', action });
      return action;
    } catch (e) {
      if (e.name === 'AuthNeeded') { setStatus({ state: 'auth' }); return 'auth'; }
      if (e instanceof PasswordChangedError || e instanceof WrongPasswordError) { key = null; setStatus({ state: 'locked', message: e.message }); return 'locked'; }
      setStatus({ state: 'error', message: e.message });
      return 'error';
    }
  }

  // Serialized: a sync requested while one is running runs once more after it.
  function sync(opts = {}) {
    if (running) {
      if (opts.force) return running.then(() => sync(opts));
      again = true; return running;
    }
    running = run(opts).finally(() => {
      running = null;
      if (again) { again = false; return sync(); }
    });
    return running;
  }

  async function signInAndSync() {
    await drive.getToken({ interactive: true });
    return sync();
  }

  function resolve(choice) {
    pending = null;
    return sync({ force: choice === 'remote' ? 'pull' : 'push' });
  }

  async function changePassword(password) {
    const salt = randomSalt();
    key = await deriveKey(password, salt);
    meta.salt = toB64(salt);
    saveMeta();
    await rememberKey(meta.remember);
    return sync({ force: 'push' });
  }

  async function disconnect() {
    meta = { enabled: false };
    key = null; pending = null;
    saveMeta();
    try { await store.kvDel(VAULT_KEY); } catch { /* ignore */ }
    drive.signOut();
    setStatus({ state: 'off' });
  }

  return {
    init, probe, connect, unlock, sync, signInAndSync, resolve, changePassword, disconnect,
    get status() { return status; },
    get meta() { return { ...meta }; },
    get pending() { return pending; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
