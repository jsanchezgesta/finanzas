// Turns a raw bank description into a stable merchant key, so that
// "COMPRA TARJ. 5402XXXXXXXX1234 MERCADONA BARCELONA 12/10" and
// "COMPRA TARJETA MERCADONA SA" both become "mercadona".

import { stripAccents } from './util.js';

const PREFIXES = [
  'COMPRA TARJETA CREDITO', 'COMPRA TARJETA DEBITO', 'COMPRA TARJ CREDITO', 'COMPRA TARJ DEBITO',
  'COMPRA CON TARJETA', 'COMPRA TARJETA', 'COMPRA TARJ', 'PAGO CON TARJETA', 'PAGO TARJETA', 'PAGO MOVIL EN', 'PAGO MOVIL',
  'PAGO EN', 'COMPRA EN', 'COMPRA INTERNET EN', 'COMPRA INTERNET', 'COMPRA', 'OPERACION TARJETA', 'TARJETA',
  'RECIBO DE', 'RECIBO', 'ADEUDO RECIBO', 'ADEUDO SEPA', 'ADEUDO DOMICILIADO', 'ADEUDO', 'DOMICILIACION', 'CARGO DOMICILIACION', 'CARGO',
  'TRANSFERENCIA INMEDIATA A FAVOR DE', 'TRANSFERENCIA INMEDIATA DE', 'TRANSFERENCIA A FAVOR DE', 'TRANSFERENCIA EMITIDA A', 'TRANSFERENCIA RECIBIDA DE',
  'TRANSF A FAVOR DE', 'TRANSF INMEDIATA', 'TRANSFERENCIA DE', 'TRANSFERENCIA A', 'TRANSFERENCIA', 'TRANSF',
  'CARD TRANSACTION', 'CARD PAYMENT', 'KARTENZAHLUNG', 'PAYMENT TO', 'PAYMENT FROM', 'DIRECT DEBIT', 'TRANSFER TO', 'TRANSFER FROM',
  'APPLE PAY', 'GOOGLE PAY', 'SAMSUNG PAY', 'CONTACTLESS', 'TPV', 'POS',
];

// Payment processors whose real merchant comes after the separator.
const PROCESSORS = ['PAYPAL', 'SUMUP', 'SQ', 'ZETTLE', 'IZ', 'STRIPE', 'GOOGLE', 'APPLE PAY', 'REDSYS', 'MOLLIE', 'ADYEN'];

const NOISE = new Set([
  'ES', 'ESP', 'SPAIN', 'ESPANA', 'EU', 'EUR', 'SL', 'SLU', 'SA', 'SAU', 'S', 'L', 'U', 'CB', 'SCP', 'INC', 'LTD', 'LIMITED', 'BV', 'GMBH', 'SARL', 'SRL',
  'BARCELONA', 'BCN', 'MADRID', 'VALENCIA', 'SEVILLA', 'MALAGA', 'BILBAO', 'ZARAGOZA', 'PALMA', 'GIRONA', 'TARRAGONA', 'LLEIDA', 'HOSPITALET', 'BADALONA', 'SABADELL', 'TERRASSA',
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'EN', 'THE', 'AND', 'OF',
  'COM', 'WWW', 'HTTPS', 'HTTP', 'NET', 'ORG',
  'FAVOR', 'INMEDIATA', 'EMITIDA', 'RECIBIDA', 'SEPA', 'A',
  'REF', 'REFERENCIA', 'CONCEPTO', 'NUM', 'NUMERO', 'OPER', 'OPERACION', 'FECHA', 'TARJ', 'CARD',
]);

const PERSON_PREFIXES = ['BIZUM ENVIADO A', 'BIZUM ENVIADO', 'BIZUM RECIBIDO DE', 'BIZUM RECIBIDO', 'BIZUM DE', 'BIZUM A', 'BIZUM'];

export function cleanDescription(desc) {
  return stripAccents(String(desc ?? ''))
    .toUpperCase()
    .replace(/[·|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Banks often put a generic label in the first column ("TRANSFERENCIA A FAVOR
// DE", "COMPRA TARJ. 5402XXXX…") and the real counterparty in the next one,
// so each joined column is tried in order until one yields a merchant.
export function normalizeMerchant(desc) {
  const parts = String(desc ?? '').split(' · ').map(cleanDescription).filter(Boolean);
  let personPrefix = '';
  let tokens = [];
  for (const part of parts) {
    const r = coreTokens(part);
    if (r.personPrefix) personPrefix = r.personPrefix;
    if (r.tokens.length) { tokens = r.tokens; break; }
  }
  if (!tokens.length && parts.length) tokens = parts[0].split(' ').filter(Boolean).slice(0, 2);
  let key = tokens.slice(0, 3).join(' ').toLowerCase();
  if (personPrefix) key = (personPrefix === 'BIZUM DE' ? 'bizum de ' : 'bizum a ') + key;
  key = key.trim() || 'desconocido';
  return { key, name: titleCase(key) };
}

function coreTokens(input) {
  let s = input;
  let personPrefix = '';
  for (const p of PERSON_PREFIXES) {
    if (s.startsWith(p + ' ') || s === p) { personPrefix = p.startsWith('BIZUM RECIBIDO') || p === 'BIZUM DE' ? 'BIZUM DE' : 'BIZUM A'; s = s.slice(p.length); break; }
  }

  s = s
    .replace(/\b\d{4,6}[X*]{4,}\d{2,4}\b/g, ' ') // masked card numbers
    .replace(/\b[X*]{4,}\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ') // dates
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ') // times
    .replace(/\bREF[:.]?\s*\S+/g, ' ')
    .replace(/\bN[º°]\s*\S+/g, ' ')
    .replace(/\bNO\.\s*\S+/g, ' ');

  s = s.replace(/[.,;:"'()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const p of PREFIXES) {
      if (s === p) { s = ''; break; }
      if (s.startsWith(p + ' ')) { s = s.slice(p.length).trim(); changed = true; break; }
    }
  }

  // "PAYPAL *NETFLIX" → NETFLIX ; "AMZN MKTP ES*2K4J23" → AMZN MKTP
  if (s.includes('*')) {
    const [before, ...rest] = s.split('*');
    const after = rest.join(' ').trim();
    const b = before.trim();
    if (PROCESSORS.some(p => b === p || b.startsWith(p + ' ')) && after) s = after;
    else if (b.length >= 3) s = b;
    else s = after || b;
  }

  s = s.replace(/[*_/\\#+&-]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = s.split(' ').filter(t => t && !NOISE.has(t) && !/^\d+$/.test(t) && !/^[A-Z]?\d[\dA-Z]{5,}$/.test(t));
  return { tokens, personPrefix };
}

export function titleCase(s) {
  return s.replace(/\b([a-zà-ÿ])([a-zà-ÿ]*)/g, (_, a, b) => a.toUpperCase() + b).replace(/\bDe\b/g, 'de').replace(/\bA\b/g, 'a');
}
