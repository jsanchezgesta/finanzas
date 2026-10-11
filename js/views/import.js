// Import wizard. Known file formats (same columns as a previous import) go
// straight to a one-click confirmation; new formats show a column mapping
// with everything pre-detected.

import { h, clear, money, dateLabel, uid } from '../util.js';
import { getState, update, requestPersistence } from '../store.js';
import { readFileRows, analyzeFile, buildImport, commitImport, undoImport } from '../importer.js';
import { findRule, keywordSuggestion } from '../categorize.js';
import { toast } from '../ui.js';
import { loadSample } from '../sample.js';

export const live = false;

const BANKS = [
  ['caixa', 'CaixaBank'], ['bbva', 'BBVA'], ['santander', 'Santander'], ['sabadell', 'Sabadell'], ['openbank', 'Openbank'],
  ['trade republic', 'Trade Republic'], ['traderepublic', 'Trade Republic'], ['revolut', 'Revolut'], ['n26', 'N26'], ['ing', 'ING'],
  ['bankinter', 'Bankinter'], ['kutxa', 'Kutxabank'], ['unicaja', 'Unicaja'], ['abanca', 'Abanca'], ['myinvestor', 'MyInvestor'], ['wise', 'Wise'], ['imagin', 'imagin'],
];

function guessBank(fileName, rows) {
  const text = (fileName + ' ' + rows.slice(0, 6).flat().join(' ')).toLowerCase();
  return BANKS.find(([k]) => new RegExp('\\b' + k + '\\b').test(text))?.[1] || null;
}

let session = { queue: [], current: null, results: [], error: null };

export function render(root) {
  session = { queue: [], current: null, results: [], error: null };
  const view = h('div', {});
  root.append(view);
  draw(view);
}

function draw(view) {
  clear(view);
  const state = getState();
  view.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Importar'),
    h('div', { class: 'sub' }, 'Sube el extracto de movimientos de tu banco (CSV o Excel). Puedes subir varios a la vez.'))));

  if (session.error) {
    view.append(h('div', { class: 'banner', style: { borderColor: 'var(--neg)' } }, h('span', {}, session.error), h('button', { class: 'btn sm', onclick: () => { session.error = null; draw(view); } }, 'Cerrar')));
  }

  for (const r of session.results) view.append(resultCard(view, r));

  if (session.current) {
    view.append(mappingCard(view, session.current));
  } else {
    view.append(dropZone(view));
    if (!state.transactions.length) {
      view.append(h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '12px' } },
        '¿Solo quieres verla funcionar? ',
        h('a', { href: '#/resumen', onclick: () => { update(s => loadSample(s)); } }, 'Carga datos de ejemplo'),
        ' (podrás borrarlos en Ajustes).'));
    }
  }

  view.append(tipsCard(), historyCard(view));
}

function dropZone(view) {
  const input = h('input', { type: 'file', accept: '.csv,.txt,.tsv,.xls,.xlsx,.ods,text/csv', multiple: true, hidden: true });
  const zone = h('label', { class: 'drop' },
    h('div', { class: 'big' }, 'Arrastra aquí tus extractos'),
    h('div', { class: 'muted' }, 'o toca para elegir archivos · CSV, XLS, XLSX'),
    input);
  input.addEventListener('change', () => enqueue(view, [...input.files]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); enqueue(view, [...e.dataTransfer.files]); });
  return zone;
}

async function enqueue(view, files) {
  session.queue.push(...files);
  if (!session.current) await next(view);
}

async function next(view) {
  const file = session.queue.shift();
  if (!file) { session.current = null; draw(view); return; }
  try {
    const rows = await readFileRows(file);
    if (!rows.length) throw new Error('El archivo está vacío.');
    const state = getState();
    const { analysis, profile } = analyzeFile(state, rows);
    const accountExists = profile && state.accounts.some(a => a.id === profile.accountId);
    const bank = guessBank(file.name, rows);
    session.current = {
      file, rows, analysis, profile: accountExists ? profile : null,
      mapping: { ...analysis.mapping },
      accountId: accountExists ? profile.accountId : (state.accounts.length === 1 && !bank ? state.accounts[0].id : (state.accounts.find(a => a.bank && a.bank === bank)?.id || '_new')),
      newAccountName: bank || (state.accounts.length ? 'Cuenta ' + (state.accounts.length + 1) : 'Cuenta principal'),
      bank,
      showMapping: !accountExists,
    };
  } catch (e) {
    session.error = `No he podido leer «${file.name}»: ${e.message}`;
    session.current = null;
    return next(view);
  }
  draw(view);
}

function mappingCard(view, cur) {
  const state = getState();
  const { analysis } = cur;
  const header = analysis.header;
  const accountId = cur.accountId === '_new' ? '__preview__' : cur.accountId;
  const valid = cur.mapping.date >= 0 && (cur.mapping.amount >= 0 || cur.mapping.debit >= 0 || cur.mapping.credit >= 0) && cur.mapping.desc.length;
  const built = valid ? buildImport(state, analysis, cur.mapping, accountId) : { fresh: [], dupes: 0, skipped: analysis.data.length, parsedCount: 0 };
  let autoCount = 0, suggested = 0;
  const previewCats = new Map();
  for (const t of built.fresh) {
    const r = findRule(state.rules, t);
    if (r) { autoCount++; previewCats.set(t.id, { id: r.categoryId, auto: true }); continue; }
    const sug = keywordSuggestion(t, state.categories);
    if (sug) { suggested++; previewCats.set(t.id, { id: sug, auto: false }); }
  }
  const allPositive = built.fresh.length > 3 && built.fresh.every(t => t.amount > 0);

  const card = h('section', { class: 'card', style: { marginBottom: '16px' } });
  card.append(h('div', { class: 'card-head' },
    h('h2', {}, cur.file.name),
    h('span', { class: 'meta' }, session.queue.length ? `${session.queue.length} archivo(s) más en cola` : '')));

  if (cur.profile && !cur.showMapping) {
    const acc = state.accounts.find(a => a.id === cur.accountId);
    card.append(h('div', { class: 'banner ok', style: { marginBottom: '14px' } },
      h('span', {}, 'Formato reconocido: se importará en ', h('b', {}, acc?.name || 'la cuenta guardada'), ' con la misma configuración que la última vez.'),
      h('button', { class: 'btn sm', onclick: () => { cur.showMapping = true; draw(view); } }, 'Cambiar')));
  }

  // Account
  const accSel = h('select', {},
    state.accounts.map(a => h('option', { value: a.id }, a.name)),
    h('option', { value: '_new' }, '+ Nueva cuenta…'));
  accSel.value = cur.accountId;
  accSel.addEventListener('change', () => { cur.accountId = accSel.value; draw(view); });
  const newName = h('input', { type: 'text', value: cur.newAccountName, placeholder: 'Nombre de la cuenta' });
  newName.addEventListener('input', () => { cur.newAccountName = newName.value; });

  if (cur.showMapping || !cur.profile) {
    card.append(h('div', { class: 'map-grid', style: { marginBottom: '14px' } },
      h('label', { class: 'field' }, h('span', {}, 'Cuenta'), accSel),
      cur.accountId === '_new' ? h('label', { class: 'field' }, h('span', {}, 'Nombre de la nueva cuenta'), newName) : null));

    const colSel = (key, { allowNone = false } = {}) => {
      const s = h('select', {},
        allowNone ? h('option', { value: '-1' }, '— ninguna —') : null,
        header.map((name, i) => h('option', { value: String(i) }, `${name || 'Columna ' + (i + 1)} · ${sampleOf(analysis.data, i)}`)));
      s.value = String(cur.mapping[key]);
      s.addEventListener('change', () => { cur.mapping[key] = Number(s.value); draw(view); });
      return s;
    };
    const descBox = h('div', { class: 'chips' }, header.map((name, i) => {
      const on = cur.mapping.desc.includes(i);
      return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), style: { height: '32px', fontSize: '13px' }, onclick: () => {
        cur.mapping.desc = on ? cur.mapping.desc.filter(x => x !== i) : [...cur.mapping.desc, i].sort((a, b) => a - b);
        draw(view);
      } }, name || 'Columna ' + (i + 1));
    }));
    const amountMode = cur.mapping.amount >= 0 ? 'single' : 'split';
    const modeSeg = h('div', { class: 'seg' },
      h('button', { type: 'button', class: amountMode === 'single' ? 'on' : '', onclick: () => { if (amountMode !== 'single') { cur.mapping.amount = Math.max(0, cur.mapping.debit, cur.mapping.credit); cur.mapping.debit = cur.mapping.credit = -1; draw(view); } } }, 'Una columna de importe'),
      h('button', { type: 'button', class: amountMode === 'split' ? 'on' : '', onclick: () => { if (amountMode !== 'split') { cur.mapping.debit = cur.mapping.amount; cur.mapping.credit = -1; cur.mapping.amount = -1; draw(view); } } }, 'Cargo y abono separados'));
    const decSel = h('select', {}, h('option', { value: ',' }, '1.234,56 (coma decimal)'), h('option', { value: '.' }, '1,234.56 (punto decimal)'));
    decSel.value = cur.mapping.decimal;
    decSel.addEventListener('change', () => { cur.mapping.decimal = decSel.value; draw(view); });
    const dateSel = h('select', {}, h('option', { value: 'dmy' }, 'día/mes/año'), h('option', { value: 'mdy' }, 'mes/día/año'));
    dateSel.value = cur.mapping.dateOrder;
    dateSel.addEventListener('change', () => { cur.mapping.dateOrder = dateSel.value; draw(view); });

    card.append(
      h('div', { class: 'map-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Fecha'), colSel('date')),
        h('label', { class: 'field' }, h('span', {}, 'Formato de fecha'), dateSel),
        h('label', { class: 'field' }, h('span', {}, 'Formato de número'), decSel)),
      h('div', { class: 'field', style: { marginTop: '12px' } }, h('span', {}, 'Importe'), modeSeg),
      h('div', { class: 'map-grid', style: { marginTop: '8px' } },
        amountMode === 'single'
          ? h('label', { class: 'field' }, h('span', {}, 'Columna de importe'), colSel('amount'))
          : [h('label', { class: 'field' }, h('span', {}, 'Cargos (salidas)'), colSel('debit', { allowNone: true })),
            h('label', { class: 'field' }, h('span', {}, 'Abonos (entradas)'), colSel('credit', { allowNone: true }))],
        h('label', { class: 'check', style: { alignSelf: 'end', height: '38px' } },
          h('input', { type: 'checkbox', checked: cur.mapping.invert, onchange: e => { cur.mapping.invert = e.target.checked; draw(view); } }), 'Invertir signo')),
      h('div', { class: 'field', style: { marginTop: '12px' } }, h('span', {}, 'Concepto (puedes combinar varias columnas)'), descBox),
    );
    if (allPositive && !cur.mapping.invert) card.append(h('div', { class: 'banner', style: { marginTop: '12px' } }, 'Todos los importes salen en positivo. Si los gastos deberían ser negativos, marca «Invertir signo» o usa cargo/abono separados.'));
  }

  // Stats + preview
  card.append(h('div', { class: 'stat-line', style: { margin: '16px 0 10px' } },
    h('span', {}, h('b', {}, built.fresh.length), ' nuevos'),
    autoCount ? h('span', { class: 'pos' }, h('b', {}, autoCount), ' se categorizan solos') : null,
    suggested ? h('span', {}, h('b', {}, suggested), ' con sugerencia') : null,
    built.dupes ? h('span', { class: 'muted' }, h('b', {}, built.dupes), ' ya importados (se omiten)') : null,
    built.skipped ? h('span', { class: 'muted' }, h('b', {}, built.skipped), ' filas sin fecha o importe') : null));

  if (built.fresh.length) {
    const sample = [...built.fresh].reverse().slice(0, 8);
    const catName = id => { const c = state.categories.find(x => x.id === id); return c ? c.icon + ' ' + c.name : ''; };
    card.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Comercio'), h('th', {}, 'Concepto'), h('th', {}, 'Categoría'), h('th', { class: 'r' }, 'Importe'))),
      h('tbody', {}, sample.map(t => {
        const pc = previewCats.get(t.id);
        return h('tr', {},
          h('td', {}, dateLabel(t.date, true)), h('td', {}, t.merchantName),
          h('td', { class: 'muted', style: { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }, title: t.description }, t.description),
          h('td', {}, pc ? h('span', { class: 'tag ' + (pc.auto ? 'auto' : '') }, catName(pc.id) + (pc.auto ? '' : ' ?')) : h('span', { class: 'muted' }, 'por revisar')),
          h('td', { class: 'r ' + (t.amount > 0 ? 'pos' : '') }, money(t.amount)));
      })))));
  }

  const importBtn = h('button', { class: 'btn primary lg', disabled: !built.fresh.length }, built.fresh.length ? `Importar ${built.fresh.length} movimientos` : 'Nada nuevo que importar');
  importBtn.addEventListener('click', () => doImport(view, cur));
  card.append(h('div', { class: 'btn-row', style: { marginTop: '16px', justifyContent: 'flex-end' } },
    h('button', { class: 'btn lg ghost', onclick: () => next(view) }, session.queue.length ? 'Saltar archivo' : 'Cancelar'),
    importBtn));
  return card;
}

function sampleOf(data, i) {
  const v = data.find(r => r[i] !== '' && r[i] != null)?.[i];
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return s.length > 28 ? s.slice(0, 27) + '…' : s;
}

function doImport(view, cur) {
  let record;
  update(s => {
    let accountId = cur.accountId;
    if (accountId === '_new') {
      accountId = uid();
      s.accounts.push({ id: accountId, name: (cur.newAccountName || 'Cuenta').trim(), bank: cur.bank || null });
    }
    const built = buildImport(s, cur.analysis, cur.mapping, accountId);
    record = commitImport(s, built, { fileName: cur.file.name, accountId, signature: cur.analysis.signature, mapping: cur.mapping });
  });
  requestPersistence();
  session.results.unshift(record);
  next(view);
}

function resultCard(view, r) {
  const state = getState();
  const acc = state.accounts.find(a => a.id === r.accountId);
  const pendingNow = state.transactions.filter(t => t.importId === r.id && t.status === 'pending').length;
  return h('section', { class: 'banner ok', style: { flexDirection: 'column', alignItems: 'stretch' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
      h('div', {},
        h('b', {}, `${r.count} movimientos importados en ${acc?.name || 'la cuenta'}`),
        h('div', { class: 'small muted' }, [
          r.from ? `${dateLabel(r.from, true)} – ${dateLabel(r.to, true)}` : null,
          r.auto ? `${r.auto} categorizados automáticamente` : null,
          r.transfers ? `${r.transfers} traspasos detectados` : null,
          r.dupes ? `${r.dupes} duplicados omitidos` : null,
        ].filter(Boolean).join(' · '))),
      h('div', { class: 'btn-row' },
        pendingNow ? h('a', { class: 'btn primary', href: '#/revisar' }, `Revisar ${pendingNow} nuevos`) : h('a', { class: 'btn primary', href: '#/resumen' }, 'Ver resumen'),
        h('button', { class: 'btn ghost sm', onclick: () => undo(view, r.id) }, 'Deshacer'))));
}

function undo(view, id) {
  update(s => undoImport(s, id));
  session.results = session.results.filter(r => r.id !== id);
  toast('Importación deshecha');
  draw(view);
}

function tipsCard() {
  return h('details', { class: 'card', style: { marginTop: '16px' } },
    h('summary', { style: { cursor: 'pointer', fontWeight: 650 } }, 'Cómo descargar el extracto de tu banco'),
    h('ul', { class: 'small', style: { color: 'var(--ink-2)', marginBottom: 0, paddingLeft: '18px' } },
      h('li', {}, h('b', {}, 'CaixaBank: '), 'CaixaBankNow (web) → Cuentas → Movimientos → elige fechas → icono de descarga (Excel).'),
      h('li', {}, h('b', {}, 'Trade Republic: '), 'Web o app → Perfil → Actividad / Transacciones → Exportar (CSV).'),
      h('li', {}, h('b', {}, 'Openbank, BBVA, Santander, ING, Revolut: '), 'busca «Descargar movimientos» o «Exportar» en la lista de movimientos de la web.'),
      h('li', {}, 'Si exportas periodos que se solapan no pasa nada: los duplicados se detectan y se omiten.'),
      h('li', {}, 'Con un mes al mes basta. Con 3 meses de historial empiezan a detectarse los pagos recurrentes.')));
}

function historyCard(view) {
  const state = getState();
  if (!state.imports.length) return null;
  const accounts = new Map(state.accounts.map(a => [a.id, a.name]));
  return h('section', { class: 'card', style: { marginTop: '16px' } },
    h('div', { class: 'card-head' }, h('h2', {}, 'Importaciones anteriores')),
    h('div', { class: 'rows' }, state.imports.slice(0, 12).map(r => h('div', { class: 'row' },
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, r.fileName),
        h('div', { class: 'desc' }, `${new Date(r.at).toLocaleDateString('es-ES')} · ${accounts.get(r.accountId) || ''} · ${r.count} movimientos` + (r.from ? ` · ${dateLabel(r.from, true)} – ${dateLabel(r.to, true)}` : ''))),
      h('button', { class: 'btn sm ghost', onclick: () => { if (confirm(`¿Eliminar los ${r.count} movimientos de esta importación?`)) undo(view, r.id); } }, 'Eliminar')))));
}
