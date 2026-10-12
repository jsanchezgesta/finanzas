// Minimal Google Drive client: Google Identity Services for the access token,
// Drive REST v3 for files. Scope is drive.file, so the app can only see the
// files and folder it created itself — nothing else in your Drive.

import { GOOGLE_CLIENT_ID, DRIVE_FOLDER, DRIVE_FILE } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'finanzas.gtoken';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let gisPromise = null;
let tokenClient = null;

export function configured() { return !!GOOGLE_CLIENT_ID; }

// Load the Google script early: on iPhone the sign-in popup only opens if it
// is requested straight from a tap, with nothing slow in between.
export function preload() {
  if (gisPromise || typeof document === 'undefined') return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in. Are you offline?')); };
    document.head.append(s);
  });
  return gisPromise;
}

function readToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.expiresAt > Date.now() + 60000 ? t : null;
  } catch { return null; }
}

export function hasToken() { return !!readToken(); }

// interactive=true must be called from a click/tap handler.
export async function getToken({ interactive = false } = {}) {
  const cached = readToken();
  if (cached) return cached.accessToken;
  if (!interactive) throw new AuthNeeded();
  if (!configured()) throw new Error('Google sync is not configured yet.');
  if (!globalThis.google?.accounts?.oauth2) await preload();
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: res => {
        if (res.error) return reject(new Error(res.error_description || res.error));
        const t = { accessToken: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
        try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* ignore */ }
        resolve(t.accessToken);
      },
      error_callback: err => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in was cancelled.' : (err?.message || 'Sign-in failed.'))),
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function signOut() {
  const t = readToken();
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (t && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.accessToken, () => {});
}

export class AuthNeeded extends Error {
  constructor() { super('Sign in to Google to sync'); this.name = 'AuthNeeded'; }
}

async function api(path, { method = 'GET', headers = {}, body, base = API, raw = false } = {}) {
  const token = await getToken();
  const res = await fetch(base + path, { method, body, headers: { Authorization: 'Bearer ' + token, ...headers } });
  if (res.status === 401) { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } throw new AuthNeeded(); }
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch { /* ignore */ }
    throw new Error('Google Drive: ' + msg);
  }
  return raw ? res : res.json();
}

const q = s => encodeURIComponent(s);
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOne(query) {
  const r = await api(`/files?q=${q(query + ' and trashed=false')}&fields=${q('files(id,name,modifiedTime,appProperties)')}&orderBy=modifiedTime desc&pageSize=10&spaces=drive`);
  return r.files?.[0] || null;
}

export async function ensureFolder() {
  const found = await findOne(`name='${esc(DRIVE_FOLDER)}' and mimeType='${FOLDER_MIME}'`);
  if (found) return found.id;
  const created = await api('/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: FOLDER_MIME }),
  });
  return created.id;
}

export function findFile(folderId) {
  return findOne(`name='${esc(DRIVE_FILE)}' and '${esc(folderId)}' in parents`);
}

export function getMeta(fileId) {
  return api(`/files/${fileId}?fields=${q('id,modifiedTime,appProperties,trashed')}`);
}

export async function download(fileId) {
  const res = await api(`/files/${fileId}?alt=media`, { raw: true });
  return res.json();
}

// Create (fileId null) or overwrite the sync file. appProperties carry the
// plaintext timestamp so other devices can check for changes cheaply.
export async function upload({ fileId, folderId, content, appProperties }) {
  const boundary = 'finanzas' + Math.random().toString(36).slice(2);
  const meta = fileId ? { appProperties } : { name: DRIVE_FILE, parents: [folderId], mimeType: 'application/json', appProperties };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(content)}\r\n--${boundary}--`;
  return api(`/files${fileId ? '/' + fileId : ''}?uploadType=multipart&fields=${q('id,modifiedTime,appProperties')}`, {
    base: UPLOAD, method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
}
