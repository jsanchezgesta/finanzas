// End-to-end encryption for the Drive copy. Your password never leaves the
// device; Google only ever stores ciphertext.
//   key  = PBKDF2-SHA256(password, salt, 310 000 iterations) → AES-GCM 256
//   file = { v, kdf, salt, iv, data } with a fresh random IV per save.

const ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomSalt() { return crypto.getRandomValues(new Uint8Array(16)); }

export async function deriveKey(password, salt, { iterations = ITERATIONS, extractable = false } = {}) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

// The salt travels with the file so another device can derive the same key.
export async function encryptJSON(key, salt, obj, meta = {}) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    v: 1, app: 'finanzas',
    kdf: { name: 'PBKDF2-SHA256', iterations: ITERATIONS },
    salt: toB64(salt), iv: toB64(iv), data: toB64(cipher),
    ...meta,
  };
}

export class WrongPasswordError extends Error {
  constructor() { super('Wrong password'); this.name = 'WrongPasswordError'; }
}

export async function decryptJSON(key, envelope) {
  if (!envelope || envelope.app !== 'finanzas' || !envelope.data) throw new Error('Not a Finanzas sync file');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.data));
    return JSON.parse(dec.decode(plain));
  } catch (e) {
    if (e instanceof SyntaxError) throw e;
    throw new WrongPasswordError();
  }
}

export function envelopeSalt(envelope) { return fromB64(envelope.salt); }
export function envelopeIterations(envelope) { return envelope?.kdf?.iterations || ITERATIONS; }
