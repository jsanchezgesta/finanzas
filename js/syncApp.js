// The app's single sync instance, wired to the real Drive client and store.
import * as drive from './drive.js';
import { getState, replaceState, kvGet, kvSet, kvDel, onLocalChange, flushNow } from './store.js';
import { createSync } from './sync.js';
import { debounce } from './util.js';

export const sync = createSync({ drive, store: { getState, replaceState, kvGet, kvSet, kvDel } });
export const driveConfigured = drive.configured;

export async function startSync() {
  await sync.init();
  if (!sync.meta.enabled) return;
  drive.preload()?.catch(() => {});
  wire();
  sync.sync();
}

// Sync a few seconds after each change, when the app comes back to the
// foreground, and when the connection returns.
let wired = false;
export function wire() {
  if (wired) return; wired = true;
  const later = debounce(() => { if (sync.meta.enabled && navigator.onLine !== false) sync.sync(); }, 3000);
  onLocalChange(later);
  document.addEventListener('visibilitychange', () => {
    if (!sync.meta.enabled) return;
    if (document.visibilityState === 'visible') sync.sync();
    else flushNow();
  });
  window.addEventListener('online', () => { if (sync.meta.enabled) sync.sync(); });
}
export const preloadGoogle = () => drive.preload()?.catch(() => {});
