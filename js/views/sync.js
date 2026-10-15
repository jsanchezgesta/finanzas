// Settings card and dialogs for encrypted Google Drive sync.
import { h, clear } from '../util.js';
import { openSheet, toast } from '../ui.js';
import { sync, driveConfigured, wire, preloadGoogle } from '../syncApp.js';
import { DRIVE_FOLDER } from '../config.js';

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const when = ts => ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown time';

export function statusText(st = sync.status, meta = sync.meta) {
  switch (st.state) {
    case 'off': return 'Off — data only on this device';
    case 'locked': return st.message || 'Locked — enter your sync password';
    case 'auth': return 'Signed out of Google — tap Sign in to sync';
    case 'syncing': return 'Syncing…';
    case 'conflict': return 'Both copies changed — choose which to keep';
    case 'error': return 'Couldn\'t sync: ' + (st.message || 'unknown error');
    default: return 'Synced ' + ago(meta.lastSyncAt);
  }
}

export function needsAttention(st = sync.status) {
  return ['locked', 'auth', 'conflict', 'error'].includes(st.state);
}

export function syncCard() {
  const body = h('div');
  const card = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Sync across devices'), h('span', { class: 'meta' }, 'Google Drive · encrypted')),
    body);
  const paint = () => {
    if (!card.isConnected && body.childNodes.length) { unsub(); return; }
    clear(body);
    body.append(...content());
  };
  const unsub = sync.subscribe(paint);
  paint();
  preloadGoogle();
  return card;
}

function content() {
  const st = sync.status;
  const meta = sync.meta;
  const intro = h('p', { class: 'small muted', style: { marginTop: 0 } },
    `Keeps an encrypted copy in a "${DRIVE_FOLDER}" folder in your Google Drive so you can use the app on your phone and computer. `,
    'It\'s locked with a password only you know: Google sees an unreadable file, and the app can only see the files it created.');

  if (!driveConfigured()) {
    return [intro, h('div', { class: 'notice' }, 'Not set up yet: this copy of the app needs a Google Client ID in js/config.js.')];
  }

  if (st.state === 'off') {
    return [intro, h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: e => connectFlow(e.currentTarget) }, 'Connect Google Drive'))];
  }

  const line = h('div', { class: 'sync-status ' + st.state },
    h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', {}, statusText(st, meta)));
  const actions = h('div', { class: 'btn-row' });
  if (st.state === 'locked') actions.append(h('button', { class: 'btn primary', onclick: () => unlockSheet() }, 'Enter sync password'));
  else if (st.state === 'auth') actions.append(h('button', { class: 'btn primary', onclick: () => signIn() }, 'Sign in to Google'));
  else if (st.state === 'conflict') actions.append(h('button', { class: 'btn primary', onclick: () => conflictSheet() }, 'Choose copy'));
  else actions.append(h('button', { class: 'btn primary', disabled: st.state === 'syncing', onclick: () => syncNow() }, 'Sync now'));
  if (st.state !== 'locked') actions.append(h('button', { class: 'btn', onclick: () => passwordSheet({ mode: 'change' }) }, 'Change password'));
  actions.append(h('button', { class: 'btn ghost danger', onclick: disconnect }, 'Turn off sync'));
  return [line,
    h('p', { class: 'small muted' }, meta.remember === false
      ? 'This device asks for the password each time the app opens.'
      : 'This device remembers the password. Changes sync a few seconds after you make them and when you open the app.'),
    actions];
}

async function syncNow() {
  const r = await sync.sync();
  if (r === 'auth') return signIn();
  if (r === 'conflict') return conflictSheet();
  if (r === 'push' || r === 'none') toast('Up to date');
  if (r === 'pull') toast('Updated from Google Drive');
}

export async function signIn() {
  try {
    const r = await sync.signInAndSync();
    if (r === 'conflict') conflictSheet();
  } catch (e) { toast(e.message); }
}

async function connectFlow(btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Connecting…';
  try {
    const probe = await sync.probe();
    passwordSheet({ mode: probe.exists ? 'join' : 'create', probe });
  } catch (e) {
    toast(e.message);
  } finally { btn.disabled = false; btn.textContent = label; }
}

function passwordSheet({ mode, probe }) {
  const pw = h('input', { type: 'password', autocomplete: mode === 'join' ? 'current-password' : 'new-password', 'aria-label': 'Sync password', minlength: '8' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Repeat password' });
  const remember = h('input', { type: 'checkbox', checked: true });
  const ack = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'small', style: { color: 'var(--neg)', minHeight: '1.2em' } });
  const creating = mode !== 'join';
  const go = h('button', { class: 'btn primary' }, mode === 'join' ? 'Unlock and sync' : mode === 'change' ? 'Change password' : 'Turn on sync');

  const body = h('div', { class: 'stack' },
    h('p', { class: 'small', style: { marginTop: 0 } },
      mode === 'join' ? 'There\'s already a synced copy in your Drive. Enter the sync password you chose on your other device.'
        : mode === 'change' ? 'Pick a new password. Other devices will ask for it the next time they sync.'
          : 'Choose a password to encrypt your data. You\'ll type it once on each device.'),
    h('label', { class: 'field' }, h('span', {}, 'Sync password'), pw),
    creating ? h('label', { class: 'field' }, h('span', {}, 'Repeat password'), pw2) : null,
    mode !== 'change' ? h('label', { class: 'check' }, remember, h('span', {}, 'Remember on this device')) : null,
    creating ? h('label', { class: 'check' }, ack, h('span', {}, 'I understand nobody can recover this password. If I forget it, the Drive copy is lost (data on my devices stays).')) : null,
    err);
  const sheet = openSheet({ title: mode === 'join' ? 'Unlock sync' : mode === 'change' ? 'Change sync password' : 'Set a sync password', body, foot: go });

  async function submit() {
    err.textContent = '';
    if (creating) {
      if (pw.value.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      if (pw.value !== pw2.value) { err.textContent = 'The passwords don\'t match.'; return; }
      if (!ack.checked) { err.textContent = 'Tick the box to confirm.'; return; }
    } else if (!pw.value) return;
    go.disabled = true; go.textContent = 'Working…';
    try {
      if (mode === 'change') {
        await sync.changePassword(pw.value);
        toast('Password changed');
      } else {
        const r = await sync.connect(pw.value, { ...probe, remember: remember.checked });
        wire();
        if (r === 'pulled') toast('Loaded your data from Google Drive');
        if (r === 'pushed') toast('Sync is on');
        sheet.close();
        if (r === 'conflict') conflictSheet();
        return;
      }
      sheet.close();
    } catch (e) {
      err.textContent = e.name === 'WrongPasswordError' ? 'Wrong password.' : e.message;
      go.disabled = false; go.textContent = 'Try again';
    }
  }
  go.addEventListener('click', submit);
  body.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

export function unlockSheet() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Sync password' });
  const remember = h('input', { type: 'checkbox', checked: sync.meta.remember !== false });
  const err = h('div', { class: 'small', style: { color: 'var(--neg)', minHeight: '1.2em' } });
  const go = h('button', { class: 'btn primary' }, 'Unlock');
  const sheet = openSheet({
    title: 'Unlock sync', foot: go,
    body: h('div', { class: 'stack' },
      sync.status.message ? h('p', { class: 'small', style: { marginTop: 0 } }, sync.status.message) : null,
      h('label', { class: 'field' }, h('span', {}, 'Sync password'), pw),
      h('label', { class: 'check' }, remember, h('span', {}, 'Remember on this device')), err),
  });
  async function submit() {
    if (!pw.value) return;
    go.disabled = true; err.textContent = '';
    try {
      const r = await sync.unlock(pw.value, { remember: remember.checked });
      sheet.close();
      if (r === 'conflict') conflictSheet();
      else if (r === 'auth') toast('Unlocked. Sign in to Google to sync.', { action: 'Sign in', onAction: signIn });
    } catch (e) {
      err.textContent = e.name === 'WrongPasswordError' ? 'Wrong password.' : e.message;
      go.disabled = false;
    }
  }
  go.addEventListener('click', submit);
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

let conflictOpen = false;
// What a copy holds, in one line: "1,576 transactions · 2 accounts · 1 trip".
export function describeCopy(c) {
  if (!c) return 'contents unknown';
  const n = (v, one, many) => `${v.toLocaleString('en-GB')} ${v === 1 ? one : many}`;
  return [n(c.transactions, 'transaction', 'transactions'), n(c.accounts, 'account', 'accounts'), n(c.trips, 'trip', 'trips')].join(' · ')
    + (c.lastDate ? ` · up to ${new Date(c.lastDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '');
}

export function conflictSheet() {
  if (conflictOpen) return;
  conflictOpen = true;
  const p = sync.pending || {};
  const local = p.local, remote = p.drive;
  // The copy with more transactions is the safe default; picking the other
  // one needs a second confirmation that says what will be lost.
  const safer = local && remote ? (remote.transactions > local.transactions ? 'remote' : 'local') : null;
  const choose = async choice => {
    const keep = choice === 'remote' ? remote : local;
    const lose = choice === 'remote' ? local : remote;
    if (keep && lose && lose.transactions > keep.transactions) {
      const msg = choice === 'remote'
        ? `This replaces the ${lose.transactions.toLocaleString('en-GB')} transactions on this device with the Drive copy, which has ${keep.transactions.toLocaleString('en-GB')}. A restore point is kept on this device. Continue?`
        : `This replaces the Drive copy (${lose.transactions.toLocaleString('en-GB')} transactions) with this device's copy (${keep.transactions.toLocaleString('en-GB')}). Your other devices will ask before using it. Continue?`;
      if (!confirm(msg)) return;
    }
    sheet.close();
    const r = await sync.resolve(choice);
    if (r === 'pull') toast('Using the copy from Google Drive');
    if (r === 'push') toast('Kept this device\'s copy');
    if (r === 'conflict') conflictSheet();
  };
  const option = (choice, title, copy) => h('button', { class: 'btn lg copy-choice' + (choice === safer ? ' primary' : ''), onclick: () => choose(choice) },
    h('span', { class: 'copy-title' }, title + (choice === safer ? ' (has more data)' : '')),
    h('span', { class: 'copy-detail' }, describeCopy(copy)));
  const intro = p.shrink
    ? 'The copy in Google Drive has much less data than this device, so it was not applied. This usually means another device uploaded an incomplete copy.'
    : 'This device and Google Drive both changed since they last synced. The copy you don\'t pick is replaced.';
  const sheet = openSheet({
    title: 'Which copy should we keep?',
    onClose: () => { conflictOpen = false; },
    body: h('div', { class: 'stack' },
      h('p', { class: 'small', style: { marginTop: 0 } }, intro),
      option('local', 'Keep this device\'s copy', local),
      option('remote', `Use the Drive copy (${p.device ? 'from ' + p.device + ', ' : ''}${when(p.remote)})`, remote),
      h('p', { class: 'small muted' }, 'Either way, a restore point of this device\'s data is kept in Settings → Restore points.')),
  });
}

async function disconnect() {
  if (!confirm('Turn off sync on this device? Your data stays here and the Drive copy is kept, so you can reconnect later.')) return;
  await sync.disconnect();
  toast('Sync turned off');
}
