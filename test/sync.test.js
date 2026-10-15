import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, encryptJSON, decryptJSON, randomSalt, WrongPasswordError } from '../js/crypto.js';
import { createSync, decide, wouldShrink } from '../js/sync.js';
import { migrate } from '../js/store.js';
import { defaultState } from '../js/defaults.js';

const FAST = { iterations: 1000 };

test('encrypts and decrypts; wrong password fails', async () => {
  const salt = randomSalt();
  const key = await deriveKey('correct horse', salt, FAST);
  const env = await encryptJSON(key, salt, { a: 1, txt: 'café' }, { updatedAt: 5 });
  assert.equal(env.updatedAt, 5);
  assert.ok(!JSON.stringify(env).includes('café'));
  assert.deepEqual(await decryptJSON(key, env), { a: 1, txt: 'café' });
  const bad = await deriveKey('wrong', salt, FAST);
  await assert.rejects(decryptJSON(bad, env), WrongPasswordError);
});

test('sync decisions', () => {
  assert.equal(decide({ local: 5, lastSynced: null, remote: null, lastRemote: null }), 'push');
  assert.equal(decide({ local: 5, lastSynced: null, remote: 9, lastRemote: null, localHasData: false }), 'pull');
  assert.equal(decide({ local: 5, lastSynced: null, remote: 9, lastRemote: null, localHasData: true }), 'conflict');
  assert.equal(decide({ local: 9, lastSynced: 9, remote: 9, lastRemote: 9 }), 'none');
  assert.equal(decide({ local: 12, lastSynced: 9, remote: 9, lastRemote: 9 }), 'push');
  assert.equal(decide({ local: 9, lastSynced: 9, remote: 15, lastRemote: 9 }), 'pull');
  assert.equal(decide({ local: 12, lastSynced: 9, remote: 15, lastRemote: 9 }), 'conflict');
});

// ---- fake Drive + two devices ----
function fakeDrive() {
  const files = new Map();
  let n = 0;
  const folder = { id: null };
  return {
    files,
    hasToken: () => true,
    getToken: async () => 'tok',
    signOut() {},
    ensureFolder: async () => (folder.id ||= 'folder1'),
    findFile: async () => { const f = [...files.values()][0]; return f ? { id: f.id, appProperties: f.appProperties } : null; },
    getMeta: async id => { const f = files.get(id); if (!f) throw new Error('404'); return { id, appProperties: f.appProperties }; },
    download: async id => JSON.parse(files.get(id).content),
    upload: async ({ fileId, content, appProperties }) => {
      const id = fileId || 'file' + (++n);
      files.set(id, { id, content: JSON.stringify(content), appProperties });
      return { id };
    },
  };
}

let clock = 1000;
function device(drive, initial = defaultState()) {
  let state = migrate(initial);
  const kv = new Map();
  const ls = new Map();
  const store = {
    getState: () => state,
    replaceState: async (next, { fromSync } = {}) => { state = migrate(next); if (!fromSync) state.meta.updatedAt = ++clock; },
    kvGet: async k => kv.get(k), kvSet: async (k, v) => { kv.set(k, v); }, kvDel: async k => { kv.delete(k); },
  };
  const storage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v) };
  const sync = createSync({ drive, store, storage, now: () => ++clock });
  return {
    sync, store, kv,
    get state() { return state; },
    edit(fn) { fn(state); state.meta.updatedAt = ++clock; },
    reopen() { return createSync({ drive, store, storage, now: () => ++clock }); },
  };
}

// Use fewer PBKDF2 rounds in tests by patching subtle.deriveKey's iteration count.
const realDerive = crypto.subtle.deriveKey.bind(crypto.subtle);
crypto.subtle.deriveKey = (algo, ...rest) => realDerive({ ...algo, iterations: 1000 }, ...rest);

test('two devices sync through Drive, with conflicts and password changes', async () => {
  const drive = fakeDrive();
  const laptop = device(drive);
  laptop.edit(s => s.trips.push({ id: 't1', name: 'Lisbon' }));

  // Laptop creates the file.
  let p = await laptop.sync.probe();
  assert.equal(p.exists, false);
  assert.equal(await laptop.sync.connect('pw-1', { ...p, remember: true }), 'pushed');
  assert.equal(drive.files.size, 1);
  const stored = [...drive.files.values()][0].content;
  assert.ok(!stored.includes('Lisbon'), 'Drive only sees ciphertext');

  // Phone (empty) joins: wrong password first, then right one → pulls.
  const phone = device(drive);
  p = await phone.sync.probe();
  assert.equal(p.exists, true);
  await assert.rejects(phone.sync.connect('nope', p), WrongPasswordError);
  assert.equal(await phone.sync.connect('pw-1', p), 'pulled');
  assert.equal(phone.state.trips[0].name, 'Lisbon');

  // Nothing changed → none.
  assert.equal(await phone.sync.sync(), 'none');
  assert.equal(await laptop.sync.sync(), 'none');

  // Phone edits → push; laptop pulls.
  phone.edit(s => s.trips.push({ id: 't2', name: 'Maputo' }));
  assert.equal(await phone.sync.sync(), 'push');
  assert.equal(await laptop.sync.sync(), 'pull');
  assert.equal(laptop.state.trips.length, 2);

  // Both edit → conflict; keep the laptop copy.
  phone.edit(s => { s.trips[0].name = 'Lisboa (phone)'; });
  laptop.edit(s => { s.trips[0].name = 'Lisbon (laptop)'; });
  assert.equal(await phone.sync.sync(), 'push');
  assert.equal(await laptop.sync.sync(), 'conflict');
  assert.equal(await laptop.sync.resolve('local'), 'push');
  assert.equal(await phone.sync.sync(), 'pull');
  assert.equal(phone.state.trips[0].name, 'Lisbon (laptop)');

  // Remembered key survives a reload; an unremembered one asks again.
  const again = laptop.reopen();
  await again.init();
  assert.equal(again.status.state, 'idle');

  // Password change on the laptop locks the phone until it enters the new one.
  laptop.edit(s => s.trips.push({ id: 't3', name: 'Tokyo' }));
  assert.equal(await laptop.sync.changePassword('pw-2'), 'push');
  assert.equal(await phone.sync.sync(), 'locked');
  await assert.rejects(phone.sync.unlock('pw-1'), WrongPasswordError);
  assert.equal(await phone.sync.unlock('pw-2'), 'pull');
  assert.equal(phone.state.trips.length, 3);

  await phone.sync.disconnect();
  assert.equal(phone.sync.status.state, 'off');
  assert.equal(phone.kv.size, 0);
});

// The 14 Oct 2026 incident: a phone with only a trip pushed its copy to Drive
// and the laptop, which had all the transactions, downloaded it and lost them.
test('a much smaller Drive copy is never applied without asking', async () => {
  const drive = fakeDrive();
  const many = defaultState();
  many.accounts.push({ id: 'acc', name: 'CaixaBank' });
  for (let i = 0; i < 300; i++) many.transactions.push({ id: 'x' + i, hash: 'h' + i, accountId: 'acc', date: '2026-09-01', amount: -1, merchant: 'm', merchantName: 'M', description: 'm' });
  const laptop = device(drive, many);
  laptop.edit(() => {});
  let p = await laptop.sync.probe();
  await laptop.sync.connect('pw-1', { ...p, remember: true });

  // The phone has only a trip, so joining is a conflict, and the sheet can
  // show what each copy holds.
  const phone = device(drive);
  phone.edit(s => s.trips.push({ id: 't1', name: 'Lisbon' }));
  p = await phone.sync.probe();
  assert.equal(await phone.sync.connect('pw-1', p), 'conflict');
  assert.equal(phone.sync.pending.local.transactions, 0);
  assert.equal(phone.sync.pending.drive.transactions, 300);

  // Even if the phone's copy is kept and uploaded...
  assert.equal(await phone.sync.resolve('local'), 'push');
  // ...the laptop doesn't apply it: it asks, and keeps its data meanwhile.
  assert.equal(await laptop.sync.sync(), 'conflict');
  assert.equal(laptop.state.transactions.length, 300);
  assert.equal(laptop.sync.pending.shrink, true);
  assert.equal(laptop.sync.pending.drive.transactions, 0);
  assert.equal(laptop.sync.pending.local.transactions, 300);
  // Keeping the laptop copy restores Drive; the phone then gets everything.
  assert.equal(await laptop.sync.resolve('local'), 'push');
  assert.equal(await phone.sync.sync(), 'pull');
  assert.equal(phone.state.transactions.length, 300);
});

test('choosing the smaller Drive copy explicitly does apply it', async () => {
  const drive = fakeDrive();
  const many = defaultState();
  for (let i = 0; i < 50; i++) many.transactions.push({ id: 'x' + i, hash: 'h' + i, accountId: 'a', date: '2026-09-01', amount: -1, merchant: 'm', merchantName: 'M', description: 'm' });
  const a = device(drive, many);
  a.edit(() => {});
  await a.sync.connect('pw', { ...(await a.sync.probe()), remember: true });
  const b = device(drive);
  assert.equal(await b.sync.connect('pw', await b.sync.probe()), 'pulled');
  // B deletes most transactions (e.g. undoes an import) and syncs.
  b.edit(s => { s.transactions = s.transactions.slice(0, 5); });
  assert.equal(await b.sync.sync(), 'push');
  assert.equal(await a.sync.sync(), 'conflict');
  assert.equal(a.state.transactions.length, 50);
  assert.equal(await a.sync.resolve('remote'), 'pull');
  assert.equal(a.state.transactions.length, 5);
});

test('wouldShrink thresholds', () => {
  const st = (n, acc = 1) => ({ transactions: Array.from({ length: n }, (_, i) => ({ date: '2026-01-01', i })), accounts: Array.from({ length: acc }, () => ({})) });
  assert.equal(wouldShrink(st(100), st(0)), true);
  assert.equal(wouldShrink(st(100), st(70)), true);
  assert.equal(wouldShrink(st(100), st(90)), false); // small deletions sync normally
  assert.equal(wouldShrink(st(10), st(0)), true);
  assert.equal(wouldShrink(st(10), st(5)), false);
  assert.equal(wouldShrink(st(0, 0), st(0, 0)), false);
  assert.equal(wouldShrink(st(5, 2), st(5, 0)), true);
});
