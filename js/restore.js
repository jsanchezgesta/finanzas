// Reading a file to restore from: a plain backup (Settings → Download backup)
// or an encrypted sync file (finanzas-data.enc.json, including an older
// version downloaded from Google Drive's version history).

import { deriveKey, decryptJSON, fromB64 } from './crypto.js';

export function isEncrypted(obj) {
  return !!obj && obj.app === 'finanzas' && typeof obj.data === 'string' && typeof obj.iv === 'string' && typeof obj.salt === 'string';
}

export function validateState(data) {
  if (!data || typeof data !== 'object') throw new Error('The file is not a Finanzas backup.');
  if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('The file is not a Finanzas backup (no transactions or categories).');
  return data;
}

// Throws WrongPasswordError when the password doesn't open the file.
export async function decryptBackup(envelope, password) {
  const key = await deriveKey(password, fromB64(envelope.salt), { iterations: envelope.kdf?.iterations || undefined });
  return validateState(await decryptJSON(key, envelope));
}

export function parseBackupText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  if (isEncrypted(obj)) return { encrypted: true, envelope: obj };
  return { encrypted: false, data: validateState(obj) };
}
