// Realistic sample data (a CaixaBank-style account and a Trade Republic-style
// account) run through the real import pipeline, so the demo shows exactly
// what an import does.

import { parseCSV, analyzeRows } from './parse.js';
import { buildImport, commitImport } from './importer.js';
import { reviewGroups, confirmCategory } from './categorize.js';
import { uid, addDays } from './util.js';
import { newTrip, assignTrips } from './trips.js';
import { buildContext } from './analysis.js';

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const fmtES = n => (n < 0 ? '-' : '') + Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dmy = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);

export function sampleCSVs(today = new Date().toISOString().slice(0, 10)) {
  const r = rng(42);
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const between = (a, b) => Math.round((a + r() * (b - a)) * 100) / 100;
  const start = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 12, 1)).toISOString().slice(0, 10);
  const caixa = [], tr = [];
  const cardTx = 'COMPRA TARJ. 5402XXXXXXXX7731';
  let trCard = 0, trCardPrev = 0;

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const day = +d.slice(8, 10);
    if (day === 1) { trCardPrev = trCard; trCard = 0; }
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    const month = +d.slice(5, 7);
    const C = (mov, mas, amt) => caixa.push([d, mov, mas, amt]);
    // Trade Republic rows use TR's export schema.
    const T = o => tr.push({ date: d, ...o });
    const card = (name, amt, mcc) => T({ category: 'CASH', type: 'CARD_TRANSACTION', name, amount: amt, mcc });
    // In the last 4 months most day-to-day card spending moved to Trade Republic.
    const onTR = d >= addDays(today, -120);

    if (day === 1) C('TRANSFERENCIA A FAVOR DE', 'ALQUILER PISO GRACIA - M. FERRER', -1050);
    if (day === 3) C('RECIBO DIGI SPAIN TELECOM', 'FIBRA Y MOVIL', -25);
    if (day === 4) C('RECIBO NETFLIX.COM', '', -13.99);
    if (day === 6) C('RECIBO SPOTIFY', 'P2A8F3C1D2', -11.99);
    if (day === 8) C('DIR GRACIA SL', 'CUOTA GIMNASIO', -54.9);
    if (day === 9) C('RECIBO OPENAI *CHATGPT SUBSCR', '', -22.99);
    if (day === 12) C('RECIBO ENDESA ENERGIA', 'FACTURA LUZ', -between(38, 92));
    if (day === 15 && month % 3 === 1) C('RECIBO AIGUES DE BARCELONA', 'FACTURA AGUA', -between(41, 58));
    if (day === 20 && month === 3) C('RECIBO SEGURCAIXA ADESLAS', 'SEGURO HOGAR ANUAL', -212.4);
    if (day === 2) C(cardTx, 'TMB T-USUAL BARCELONA', -21.35);
    if (day === 27) C('TRANSFERENCIA A FAVOR DE', 'NOMINA EMPRESA EJEMPLO SL', 2680);
    if (day === 28) C('TRANSFERENCIA INMEDIATA', 'A TRADE REPUBLIC BANK - INVERSION', -500);

    if (dow === 6 || (dow === 3 && r() < 0.6)) {
      const a = -between(28, 96);
      if (onTR) { trCard += -a; card('MERCADONA BARCELONA', a, '5411'); } else C(cardTx, pick(['MERCADONA BARCELONA', 'MERCADONA SA', 'MERCADONA C/ VERDI']), a);
    }
    if (dow === 1 && r() < 0.7) C(cardTx, 'BONPREU ESCLAT GRACIA', -between(12, 45));
    if (r() < 0.16) {
      const a = -between(6, 58), n = pick(['BAR LA PEPITA', 'CAFE CAMELIA', 'GRANJA M. VIADER', 'RESTAURANTE CAN CISA', 'TAPAS 24 BARCELONA', 'SUSHI ITTEKI']);
      if (onTR) { trCard += -a; card(n, a, '5812'); } else C(cardTx, n, a);
    }
    if (r() < 0.06) C(cardTx, pick(['GLOVO*PEDIDO', 'JUST EAT ES']), -between(14, 32));
    if (r() < 0.05) C(cardTx, pick(['AMZN MKTP ES*2K4J23HV1', 'AMZN MKTP ES*7Q1P09ZA2', 'AMAZON.ES COMPRA']), -between(9, 75));
    if (r() < 0.04) C('BIZUM ENVIADO A', pick(['LAURA GIL', 'PAU MARTI', 'MARTA RIUS']), -between(8, 40));
    if (r() < 0.02) C('BIZUM RECIBIDO DE', pick(['LAURA GIL', 'PAU MARTI']), between(10, 35));
    if (r() < 0.03) C(cardTx, pick(['FARMACIA SALVA', 'FARMACIA DIAGONAL']), -between(4, 28));
    if (r() < 0.025) C(cardTx, pick(['REPSOL ES 4521', 'CABIFY *TRIP', 'RENFE VIAJEROS']), -between(9, 48));
    if (r() < 0.02) C(cardTx, pick(['CINESA DIAGONAL', 'FNAC TRIANGLE', 'CASA DEL LIBRO']), -between(9, 35));

    // TR account: invested money in, savings plan out, a bit of card use.
    if (day === 29) T({ category: 'CASH', type: 'TRANSFER_INSTANT_INBOUND', amount: 500, counterparty: 'JAVIER EJEMPLO', reference: 'INVERSION' });
    if (day === 2) {
      const price = between(118, 141);
      T({ category: 'TRADING', type: 'SAVINGS_PLAN', assetClass: 'FUND', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', symbol: 'IE00BK5BQT80', price, shares: 400 / price, amount: -400 });
      if (trCardPrev > 0) {
        const sb = Math.min(15, Math.round(Math.min(trCardPrev, 1500) * 0.01 * 100) / 100);
        T({ category: 'TRADING', type: 'SAVEBACK', assetClass: 'FUND', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', symbol: 'IE00BK5BQT80', price, shares: sb / price, amount: 0 });
      }
      trCardPrev = 0;
    }
    if (day === 1) T({ category: 'CASH', type: 'INTEREST_PAYMENT', amount: between(3.1, 6.2) });
    if (r() < 0.05) { const a = -between(19, 79); trCard += -a; card(pick(['ZARA BARCELONA', 'UNIQLO PASSEIG', 'DECATHLON DIAGONAL']), a, '5651'); }
  }

  // One-off purchases scattered over the year.
  const oneOffs = [
    [40, 'C', cardTx, 'IKEA BADALONA', -428.9], [75, 'C', cardTx, 'VUELING AIRLINES', -186.4], [130, 'C', cardTx, 'BOOKING.COM HOTEL', -362],
    [190, 'C', cardTx, 'MEDIA MARKT DIAGONAL', -899], [240, 'C', cardTx, 'CLINICA DENTAL SANT GERVASI', -120], [300, 'C', 'RECIBO AEAT', 'IRPF FRACCIONADO', -312.55],
    [320, 'T', 'CARD_TRANSACTION', 'RYANAIR DAC', -94.98],
  ];
  for (const [off, acc, a, b, amt] of oneOffs) {
    const d = addDays(start, off);
    if (d > today) continue;
    if (acc === 'C') caixa.push([d, a, b, amt]);
    else tr.push({ date: d, category: 'CASH', type: a, name: b, amount: amt, mcc: '4511' });
  }

  // A 4-day trip to London paid with the TR card in GBP (flight and hotel were
  // booked earlier from CaixaBank: the VUELING and BOOKING one-offs above).
  const londonStart = addDays(start, 140);
  if (addDays(londonStart, 3) <= today) {
    const spends = [[0, 'PRET A MANGER', 9.4, '5814'], [0, 'TFL TRAVEL CH', 14.2, '4111'], [1, 'DISHOOM COVENT GARDEN', 52.3, '5812'], [1, 'BRITISH MUSEUM SHOP', 18, '5942'],
      [2, 'BOROUGH MARKET', 21.5, '5499'], [2, 'TFL TRAVEL CH', 11.6, '4111'], [2, 'THE HARP PUB', 23.8, '5813'], [3, 'HEATHROW EXPRESS', 25, '4111']];
    for (const [off, name, gbp, mcc] of spends) {
      const eur = Math.round(gbp * 1.17 * 100) / 100;
      tr.push({ date: addDays(londonStart, off), category: 'CASH', type: 'CARD_TRANSACTION_INTERNATIONAL', name, amount: -eur, mcc, origAmt: -gbp, origCur: 'GBP' });
    }
  }

  caixa.sort((a, b) => b[0].localeCompare(a[0]));
  tr.sort((a, b) => a.date.localeCompare(b.date));
  let saldo = 4210.33;
  const caixaCSV = 'Movimientos de la cuenta ES91 2100 **** **** **** 4821;;;;;\n;;;;;\nFecha;Fecha valor;Movimiento;Más datos;Importe;Saldo\n' +
    caixa.map(([d, m, x, a]) => { const line = [dmy(d), dmy(d), m, x, fmtES(a), fmtES(saldo)].join(';'); saldo -= a; return line; }).join('\n') + '\n';
  const TR_HEADER = ['datetime', 'date', 'account_type', 'category', 'type', 'asset_class', 'name', 'symbol', 'shares', 'price', 'amount', 'fee', 'tax', 'currency', 'original_amount', 'original_currency', 'fx_rate', 'description', 'transaction_id', 'counterparty_name', 'counterparty_iban', 'payment_reference', 'mcc_code'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const trCSV = TR_HEADER.join(',') + '\n' + tr.map((o, i) => [
    o.date + 'T10:' + String(i % 60).padStart(2, '0') + ':00.000000Z', o.date, 'DEFAULT', o.category, o.type, o.assetClass || '', o.name || '', o.symbol || '',
    o.shares ? o.shares.toFixed(6) : '', o.price ? o.price.toFixed(4) : '', (o.amount ?? 0).toFixed(2), '', '', 'EUR', o.origAmt ? o.origAmt.toFixed(2) : '', o.origCur || '', '', o.description || '',
    'tx-' + o.date.replace(/-/g, '') + '-' + String(i).padStart(4, '0'), o.counterparty || '', '', o.reference || '', o.mcc || '',
  ].map(q).join(',')).join('\n') + '\n';
  return { caixaCSV, trCSV, londonStart };
}

export function loadSample(state) {
  removeSample(state);
  const { caixaCSV, trCSV, londonStart } = sampleCSVs();
  const files = [['ejemplo-caixabank.csv', 'CaixaBank (ejemplo)', 'CaixaBank', caixaCSV], ['ejemplo-trade-republic.csv', 'Trade Republic (ejemplo)', 'Trade Republic', trCSV]];
  for (const [fileName, name, bank, csv] of files) {
    const accountId = uid();
    state.accounts.push({ id: accountId, name, bank, sample: true });
    const analysis = analyzeRows(parseCSV(csv));
    const built = buildImport(state, analysis, analysis.mapping, accountId);
    commitImport(state, built, { fileName, accountId, signature: analysis.signature, mapping: analysis.mapping, saveProfile: false });
  }
  // Pretend the user already reviewed most merchants; leave a few to try the review flow.
  const groups = reviewGroups(state);
  const manual = { 'alquiler piso gracia': 'vivienda', 'tmb t usual': 'transporte' };
  const candidates = [...groups.filter(g => !g.suggestion && !manual[g.merchant]), ...groups.filter(g => g.suggestion && g.txs.length <= 6 && g.total < 0)];
  const leave = new Set(candidates.slice(0, 5).map(g => g.key));
  for (const g of groups) {
    if (leave.has(g.key)) continue;
    const cat = g.suggestion || manual[g.merchant] || (g.total > 0 ? 'ingresos-otros' : 'otros');
    confirmCategory(state, g.txs.map(t => t.id), cat, { remember: true });
  }
  sampleTrip(state, londonStart);
  // A few merchants already rated in the saving coach.
  const at = Date.now() - 10 * 86400000;
  state.values = state.values || {};
  for (const [m, v] of [['glovo', 'like'], ['just eat', 'like'], ['amzn mktp', 'like'], ['netflix', 'want'], ['spotify', 'want'], ['bar pepita', 'want'], ['cafe camelia', 'like']]) state.values[m] = { v, at };
}

function sampleTrip(state, londonStart) {
  state.trips = state.trips || [];
  state.trips.push({ ...newTrip({ name: 'Londres', emoji: '🇬🇧', start: londonStart, end: addDays(londonStart, 3), budget: 900, catBudgets: { vuelos: 250, alojamiento: 380, comida: 150, transporte: 80, actividades: 40 } }), sample: true });
  assignTrips(state, buildContext(state));
}

export function removeSample(state) {
  const ids = new Set(state.accounts.filter(a => a.sample).map(a => a.id));
  if (!ids.size) return;
  state.transactions = state.transactions.filter(t => !ids.has(t.accountId));
  state.imports = state.imports.filter(i => !ids.has(i.accountId));
  state.accounts = state.accounts.filter(a => !ids.has(a.id));
  state.trips = (state.trips || []).filter(t => !t.sample);
  // Remove rules that only existed because of the sample.
  const merchants = new Set(state.transactions.map(t => t.merchant));
  state.rules = state.rules.filter(r => r.type !== 'merchant' || merchants.has(r.match));
  for (const m of Object.keys(state.values || {})) if (!merchants.has(m)) delete state.values[m];
}
