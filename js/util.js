// Small helpers shared across the app: DOM building, formatting, ids.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

export function append(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : String(k));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const moneyFmt = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyFmt0 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function money(n, { decimals = true, sign = false } = {}) {
  const v = Number(n) || 0;
  const s = (decimals ? moneyFmt : moneyFmt0).format(Math.abs(v) < 0.005 ? 0 : v);
  return sign && v > 0 ? '+' + s : s;
}

export function moneyShort(n) {
  const v = Math.abs(Number(n) || 0);
  const s = (n < 0 ? '−' : '');
  if (v >= 10000) return s + '€' + (v / 1000).toLocaleString('en-IE', { maximumFractionDigits: 0 }) + 'k';
  if (v >= 1000) return s + '€' + (v / 1000).toLocaleString('en-IE', { maximumFractionDigits: 1 }) + 'k';
  return s + '€' + v.toLocaleString('en-IE', { maximumFractionDigits: 0 });
}

export function pct(n, digits = 0) {
  if (!isFinite(n) || Math.abs(n) > 9.99) return '—';
  return (n * 100).toLocaleString('en-IE', { maximumFractionDigits: digits, minimumFractionDigits: digits }) + '%';
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthKey(date) { return String(date).slice(0, 7); }

export function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return (long ? MONTHS_LONG : MONTHS_SHORT)[m - 1] + ' ' + y;
}

export function monthShort(key) {
  const [y, m] = key.split('-').map(Number);
  return MONTHS_SHORT[m - 1] + (m === 1 ? " '" + String(y).slice(2) : '');
}

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthRange(endKey, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endKey, -i));
  return out;
}

export function currentMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function dateLabel(iso, withYear = false) {
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + MONTHS_SHORT[m - 1] + (withYear ? ' ' + y : '');
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function addDays(iso, n) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function round2(n) { return Math.round(n * 100) / 100; }

export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
