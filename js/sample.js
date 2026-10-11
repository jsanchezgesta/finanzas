// Realistic sample data (a CaixaBank-style account and a Trade Republic-style
// account) run through the real import pipeline, so the demo shows exactly
// what an import does.

import { parseCSV, analyzeRows } from './parse.js';
import { buildImport, commitImport } from './importer.js';
import { reviewGroups, confirmCategory } from './categorize.js';
import { uid, addDays } from './util.js';

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
  const card = 'COMPRA TARJ. 5402XXXXXXXX7731';

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const day = +d.slice(8, 10);
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    const month = +d.slice(5, 7);
    const C = (mov, mas, amt) => caixa.push([d, mov, mas, amt]);
    const T = (type, desc, amt) => tr.push([d, type, desc, amt]);

    if (day === 1) C('TRANSFERENCIA A FAVOR DE', 'ALQUILER PISO GRACIA - M. FERRER', -1050);
    if (day === 3) C('RECIBO DIGI SPAIN TELECOM', 'FIBRA Y MOVIL', -25);
    if (day === 4) C('RECIBO NETFLIX.COM', '', -13.99);
    if (day === 6) C('RECIBO SPOTIFY', 'P2A8F3C1D2', -11.99);
    if (day === 8) C('DIR GRACIA SL', 'CUOTA GIMNASIO', -54.9);
    if (day === 9) C('RECIBO OPENAI *CHATGPT SUBSCR', '', -22.99);
    if (day === 12) C('RECIBO ENDESA ENERGIA', 'FACTURA LUZ', -between(38, 92));
    if (day === 15 && month % 3 === 1) C('RECIBO AIGUES DE BARCELONA', 'FACTURA AGUA', -between(41, 58));
    if (day === 20 && month === 3) C('RECIBO SEGURCAIXA ADESLAS', 'SEGURO HOGAR ANUAL', -212.4);
    if (day === 2) C(card, 'TMB T-USUAL BARCELONA', -21.35);
    if (day === 27) C('TRANSFERENCIA A FAVOR DE', 'NOMINA EMPRESA EJEMPLO SL', 2680);
    if (day === 28) C('TRANSFERENCIA INMEDIATA', 'A TRADE REPUBLIC BANK - INVERSION', -500);

    if (dow === 6 || (dow === 3 && r() < 0.6)) C(card, pick(['MERCADONA BARCELONA', 'MERCADONA SA', 'MERCADONA C/ VERDI']), -between(28, 96));
    if (dow === 1 && r() < 0.7) C(card, 'BONPREU ESCLAT GRACIA', -between(12, 45));
    if (r() < 0.16) C(card, pick(['BAR LA PEPITA', 'CAFE CAMELIA', 'GRANJA M. VIADER', 'RESTAURANTE CAN CISA', 'TAPAS 24 BARCELONA', 'SUSHI ITTEKI']), -between(6, 58));
    if (r() < 0.06) C(card, pick(['GLOVO*PEDIDO', 'JUST EAT ES']), -between(14, 32));
    if (r() < 0.05) C(card, pick(['AMZN MKTP ES*2K4J23HV1', 'AMZN MKTP ES*7Q1P09ZA2', 'AMAZON.ES COMPRA']), -between(9, 75));
    if (r() < 0.04) C('BIZUM ENVIADO A', pick(['LAURA GIL', 'PAU MARTI', 'MARTA RIUS']), -between(8, 40));
    if (r() < 0.02) C('BIZUM RECIBIDO DE', pick(['LAURA GIL', 'PAU MARTI']), between(10, 35));
    if (r() < 0.03) C(card, pick(['FARMACIA SALVA', 'FARMACIA DIAGONAL']), -between(4, 28));
    if (r() < 0.025) C(card, pick(['REPSOL ES 4521', 'CABIFY *TRIP', 'RENFE VIAJEROS']), -between(9, 48));
    if (r() < 0.02) C(card, pick(['CINESA DIAGONAL', 'FNAC TRIANGLE', 'CASA DEL LIBRO']), -between(9, 35));

    // TR account: invested money in, savings plan out, a bit of card use.
    if (day === 29) T('Transfer', 'Incoming transfer CaixaBank', 500);
    if (day === 2) T('Savings plan', 'Savings plan execution IE00BK5BQT80 Vanguard FTSE All-World', -400);
    if (day === 1) T('Interest', 'Interest payment', between(3.1, 6.2));
    if (r() < 0.05) T('Card transaction', pick(['ZARA BARCELONA', 'UNIQLO PASSEIG', 'DECATHLON DIAGONAL']), -between(19, 79));
  }

  // One-off purchases scattered over the year.
  const oneOffs = [
    [40, 'C', card, 'IKEA BADALONA', -428.9], [75, 'C', card, 'VUELING AIRLINES', -186.4], [130, 'C', card, 'BOOKING.COM HOTEL', -362],
    [190, 'C', card, 'MEDIA MARKT DIAGONAL', -899], [240, 'C', card, 'CLINICA DENTAL SANT GERVASI', -120], [300, 'C', 'RECIBO AEAT', 'IRPF FRACCIONADO', -312.55],
    [320, 'T', 'Card transaction', 'RYANAIR DAC', -94.98],
  ];
  for (const [off, acc, a, b, amt] of oneOffs) {
    const d = addDays(start, off);
    if (d > today) continue;
    (acc === 'C' ? caixa : tr).push(acc === 'C' ? [d, a, b, amt] : [d, a, b, amt]);
  }

  caixa.sort((a, b) => b[0].localeCompare(a[0]));
  tr.sort((a, b) => a[0].localeCompare(b[0]));
  let saldo = 4210.33;
  const caixaCSV = 'Movimientos de la cuenta ES91 2100 **** **** **** 4821;;;;;\n;;;;;\nFecha;Fecha valor;Movimiento;Más datos;Importe;Saldo\n' +
    caixa.map(([d, m, x, a]) => { const line = [dmy(d), dmy(d), m, x, fmtES(a), fmtES(saldo)].join(';'); saldo -= a; return line; }).join('\n') + '\n';
  let bal = 0;
  const trCSV = 'Date,Type,Description,Amount,Balance\n' +
    tr.map(([d, t, desc, a]) => { bal += a; return [d, t, '"' + desc + '"', a.toFixed(2), bal.toFixed(2)].join(','); }).join('\n') + '\n';
  return { caixaCSV, trCSV };
}

export function loadSample(state) {
  removeSample(state);
  const { caixaCSV, trCSV } = sampleCSVs();
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
  const manual = { 'alquiler piso gracia': 'vivienda', 'tmb t usual': 'transporte', 'interest payment': 'ingresos-otros', 'incoming transfer caixabank': 'traspaso' };
  const candidates = [...groups.filter(g => !g.suggestion && !manual[g.merchant]), ...groups.filter(g => g.suggestion && g.txs.length <= 6 && g.total < 0)];
  const leave = new Set(candidates.slice(0, 5).map(g => g.key));
  for (const g of groups) {
    if (leave.has(g.key)) continue;
    const cat = g.suggestion || manual[g.merchant] || (g.total > 0 ? 'ingresos-otros' : 'otros');
    confirmCategory(state, g.txs.map(t => t.id), cat, { remember: true });
  }
}

export function removeSample(state) {
  const ids = new Set(state.accounts.filter(a => a.sample).map(a => a.id));
  if (!ids.size) return;
  state.transactions = state.transactions.filter(t => !ids.has(t.accountId));
  state.imports = state.imports.filter(i => !ids.has(i.accountId));
  state.accounts = state.accounts.filter(a => !ids.has(a.id));
  // Remove rules that only existed because of the sample.
  const merchants = new Set(state.transactions.map(t => t.merchant));
  state.rules = state.rules.filter(r => r.type !== 'merchant' || merchants.has(r.match));
}
