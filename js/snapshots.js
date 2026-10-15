// Automatic restore points kept on this device, in IndexedDB.
//
// A snapshot is taken before anything replaces the whole state (a sync
// download, restoring a backup, deleting all data) and before bulk deletes
// (undoing an import, deleting an account), plus one a day. Each snapshot is
// stored under its own key so taking one doesn't rewrite the others.
// Retention: the 8 most recent, plus the latest of each of the last 14 days.

const INDEX = 'snapshots-index';
const PREFIX = 'snapshot:';
const KEEP_RECENT = 8;
const KEEP_DAYS = 14;

// Counts used to compare two copies of the data.
export function summarizeState(s) {
  const txs = s?.transactions || [];
  let last = '';
  for (const t of txs) if (t.date > last) last = t.date;
  return {
    transactions: txs.length,
    trips: (s?.trips || []).length,
    accounts: (s?.accounts || []).length,
    imports: (s?.imports || []).length,
    rules: (s?.rules || []).length,
    lastDate: last || null,
    updatedAt: s?.meta?.updatedAt || 0,
  };
}

export const hasContent = s => {
  const c = summarizeState(s);
  return c.transactions + c.trips + c.accounts > 0;
};

// Which snapshots to keep, newest first.
export function retain(index, now) {
  const sorted = [...index].sort((a, b) => b.at - a.at);
  const keep = new Set(sorted.slice(0, KEEP_RECENT).map(s => s.id));
  const seenDays = new Set();
  const cutoff = now - KEEP_DAYS * 86400000;
  for (const s of sorted) {
    if (s.at < cutoff) continue;
    const day = new Date(s.at).toISOString().slice(0, 10);
    if (!seenDays.has(day)) { seenDays.add(day); keep.add(s.id); }
  }
  return sorted.filter(s => keep.has(s.id));
}

// deps: { kvGet, kvSet, kvDel, now }
export function createSnapshots({ kvGet, kvSet, kvDel, now = () => Date.now() }) {
  async function list() {
    try { return ((await kvGet(INDEX)) || []).sort((a, b) => b.at - a.at); } catch { return []; }
  }

  async function take(state, reason) {
    if (!hasContent(state)) return null;
    const index = await list();
    const summary = summarizeState(state);
    // Same data as the newest snapshot: nothing new to keep.
    const latest = index[0];
    if (latest && latest.summary.updatedAt === summary.updatedAt && latest.summary.transactions === summary.transactions) return latest;
    const at = now();
    const id = at.toString(36) + Math.random().toString(36).slice(2, 6);
    await kvSet(PREFIX + id, JSON.parse(JSON.stringify(state)));
    const next = retain([{ id, at, reason, summary }, ...index], at);
    await kvSet(INDEX, next);
    const kept = new Set(next.map(s => s.id));
    for (const s of index) if (!kept.has(s.id)) { try { await kvDel(PREFIX + s.id); } catch { /* ignore */ } }
    return { id, at, reason, summary };
  }

  async function get(id) { return kvGet(PREFIX + id); }

  // One snapshot a day, taken when the app opens.
  async function daily(state) {
    const index = await list();
    const today = new Date(now()).toISOString().slice(0, 10);
    if (index.some(s => new Date(s.at).toISOString().slice(0, 10) === today)) return null;
    return take(state, 'Daily');
  }

  return { list, take, get, daily };
}
