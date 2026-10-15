import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshots, retain, summarizeState } from '../js/snapshots.js';
import { parseBackupText, decryptBackup } from '../js/restore.js';
import { deriveKey, encryptJSON, randomSalt, WrongPasswordError } from '../js/crypto.js';
import { defaultState } from '../js/defaults.js';

const realDerive = crypto.subtle.deriveKey.bind(crypto.subtle);
crypto.subtle.deriveKey = (algo, ...rest) => realDerive({ ...algo, iterations: 1000 }, ...rest);

function withTx(n, stamp = 1) {
  const s = defaultState();
  s.meta = { updatedAt: stamp };
  for (let i = 0; i < n; i++) s.transactions.push({ id: 'x' + i, date: '2026-09-' + String(1 + (i % 28)).padStart(2, '0'), amount: -1 });
  return s;
}

function kvStore() {
  const m = new Map();
  return { m, kvGet: async k => m.get(k), kvSet: async (k, v) => { m.set(k, structuredClone(v)); }, kvDel: async k => { m.delete(k); } };
}

test('snapshots: taken, listed newest first, restorable, empty state skipped', async () => {
  const kv = kvStore();
  let t = Date.parse('2026-10-14T08:00:00Z');
  const snaps = createSnapshots({ ...kv, now: () => (t += 60000) });
  assert.equal(await snaps.take(defaultState(), 'empty'), null);
  const a = await snaps.take(withTx(10, 1), 'first');
  const b = await snaps.take(withTx(12, 2), 'second');
  // Same data again: no duplicate.
  assert.equal((await snaps.take(withTx(12, 2), 'dup')).id, b.id);
  const list = await snaps.list();
  assert.deepEqual(list.map(s => s.reason), ['second', 'first']);
  assert.equal(list[0].summary.transactions, 12);
  assert.equal((await snaps.get(a.id)).transactions.length, 10);
  // The stored copy is independent of later edits.
  assert.equal((await snaps.get(b.id)).transactions.length, 12);
});

test('snapshots: retention keeps the latest 8 and one per day for 14 days', () => {
  const day = 86400000;
  const now = Date.parse('2026-10-15T12:00:00Z');
  const index = [];
  // 30 days, 3 snapshots a day.
  for (let d = 0; d < 30; d++) for (let k = 0; k < 3; k++) index.push({ id: d + '-' + k, at: now - d * day - k * 3600000 });
  const kept = retain(index, now);
  const ids = new Set(kept.map(s => s.id));
  for (const s of index.slice(0, 8)) assert.ok(ids.has(s.id), 'recent ' + s.id);
  for (let d = 0; d < 14; d++) assert.ok(ids.has(d + '-0'), 'day ' + d);
  assert.ok(!ids.has('20-0'), 'older than 14 days dropped');
  assert.ok(kept.length <= 8 + 14);
});

test('snapshots: old ones are deleted from storage', async () => {
  const kv = kvStore();
  let t = Date.parse('2026-10-14T08:00:00Z');
  const snaps = createSnapshots({ ...kv, now: () => (t += 60000) });
  for (let i = 1; i <= 12; i++) await snaps.take(withTx(i, i), 'n' + i);
  const stored = [...kv.m.keys()].filter(k => k.startsWith('snapshot:'));
  assert.equal((await snaps.list()).length, stored.length);
  assert.ok(stored.length <= 9);
});

test('daily snapshot only once per day', async () => {
  const kv = kvStore();
  let t = Date.parse('2026-10-14T08:00:00Z');
  const snaps = createSnapshots({ ...kv, now: () => t });
  assert.ok(await snaps.daily(withTx(5, 1)));
  t += 3600000;
  assert.equal(await snaps.daily(withTx(6, 2)), null);
  t += 86400000;
  assert.ok(await snaps.daily(withTx(6, 2)));
});

test('restore: plain backup and encrypted sync file', async () => {
  const data = withTx(7);
  const plain = parseBackupText(JSON.stringify(data));
  assert.equal(plain.encrypted, false);
  assert.equal(plain.data.transactions.length, 7);

  const salt = randomSalt();
  const key = await deriveKey('pw-123456', salt);
  const env = await encryptJSON(key, salt, data, { updatedAt: 5, device: 'Mac' });
  const enc = parseBackupText(JSON.stringify(env));
  assert.equal(enc.encrypted, true);
  await assert.rejects(decryptBackup(enc.envelope, 'wrong'), WrongPasswordError);
  const out = await decryptBackup(enc.envelope, 'pw-123456');
  assert.equal(summarizeState(out).transactions, 7);

  assert.throws(() => parseBackupText('{"hello":1}'), /not a Finanzas backup/);
  assert.throws(() => parseBackupText('nope'), /not valid JSON/);
});

test('every app file is in the offline cache list', async () => {
  const fs = await import('node:fs');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const files = [...fs.readdirSync(new URL('../js', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'js/' + f),
    ...fs.readdirSync(new URL('../js/views', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'js/views/' + f)];
  for (const f of files) assert.ok(sw.includes(`'${f}'`), f + ' missing from sw.js SHELL');
});
