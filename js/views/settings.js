import { h, uid, money } from '../util.js';
import { update, replaceState, getState } from '../store.js';
import { openSheet, catIcon, toast, KIND_LABELS } from '../ui.js';
import { loadSample, removeSample } from '../sample.js';
import { defaultState } from '../defaults.js';

export function render(root, { state }) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Ajustes'),
    h('div', { class: 'sub' }, 'Tus datos se guardan solo en este navegador. Haz copias de seguridad de vez en cuando.'))));

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  // ---------- backup ----------
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('formato no válido');
      if (!confirm(`Restaurar copia con ${data.transactions.length} movimientos? Se sustituirán los datos actuales.`)) return;
      replaceState(data);
      toast('Copia restaurada');
    } catch (e) { alert('No se pudo restaurar: ' + e.message); }
  });
  const lastBackup = state.settings.lastBackupAt ? new Date(state.settings.lastBackupAt).toLocaleDateString('es-ES') : 'nunca';
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Copia de seguridad'), h('span', { class: 'meta' }, 'última: ' + lastBackup)),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Descarga un archivo con todo (movimientos, reglas, plan). Sirve también para pasar los datos del ordenador al móvil.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: exportJSON }, 'Descargar copia'),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Restaurar copia'),
      h('button', { class: 'btn ghost', onclick: exportCSV }, 'Exportar movimientos CSV'), fileIn)));

  // ---------- preferences ----------
  const thr = h('input', { type: 'number', min: '0', step: '10', value: state.settings.oneOffThreshold, style: { width: '110px' } });
  thr.addEventListener('change', () => update(s => { s.settings.oneOffThreshold = Math.max(0, Number(thr.value) || 0); }));
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Cómo clasifico los gastos')),
    h('div', { class: 'small', style: { color: 'var(--ink-2)' } },
      h('p', { style: { marginTop: 0 } }, h('b', {}, 'Fijo recurrente: '), 'el mismo comercio cobra con una cadencia regular (semanal, mensual, anual…) e importe parecido, o la categoría es de gasto fijo.'),
      h('p', {}, h('b', {}, 'Puntual: '), 'gastos poco frecuentes o grandes. Cualquier gasto que no sea fijo y supere este importe cuenta como puntual:'),
      h('label', { class: 'check' }, thr, ' €'),
      h('p', {}, h('b', {}, 'Inversión: '), 'todo lo que pongas en categorías de ahorro e inversión.'),
      h('p', { style: { marginBottom: 0 } }, 'Siempre puedes forzar el tipo de un movimiento concreto desde su ficha.'))));

  // ---------- saveback ----------
  const sbc = state.settings.saveback;
  const sbInput = (key, step, scale = 1) => {
    const i = h('input', { type: 'number', step, min: '0', value: Math.round(sbc[key] * scale * 100) / 100, style: { width: '100%' } });
    i.addEventListener('change', () => update(s => { s.settings.saveback[key] = (Number(i.value) || 0) / scale; }));
    return i;
  };
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Condiciones del Saveback')),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Valores de Trade Republic en España a septiembre de 2026. Cámbialos si TR los actualiza.'),
    h('div', { class: 'map-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Porcentaje (%)'), sbInput('rate', '0.1', 100)),
      h('label', { class: 'field' }, h('span', {}, 'Gasto máximo/mes (€)'), sbInput('spendCap', '50')),
      h('label', { class: 'field' }, h('span', {}, 'Saveback máximo/mes (€)'), sbInput('monthlyCap', '1')),
      h('label', { class: 'field' }, h('span', {}, 'Planes mínimos/mes (€)'), sbInput('minPlan', '10')))));

  // ---------- accounts ----------
  const accCard = h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h2', {}, 'Cuentas')));
  if (!state.accounts.length) accCard.append(h('p', { class: 'small muted' }, 'Se crean al importar el primer extracto de cada banco.'));
  accCard.append(h('div', { class: 'rows' }, state.accounts.map(a => {
    const n = state.transactions.filter(t => t.accountId === a.id).length;
    return h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, a.name), h('div', { class: 'desc' }, n + ' movimientos' + (a.bank ? ' · ' + a.bank : ''))),
      h('button', { class: 'btn sm ghost', onclick: () => { const name = prompt('Nombre de la cuenta', a.name); if (name) update(s => { s.accounts.find(x => x.id === a.id).name = name.trim(); }); } }, 'Renombrar'),
      h('button', { class: 'btn sm ghost danger', onclick: () => {
        if (!confirm(`¿Eliminar «${a.name}» y sus ${n} movimientos?`)) return;
        update(s => {
          s.accounts = s.accounts.filter(x => x.id !== a.id);
          s.transactions = s.transactions.filter(t => t.accountId !== a.id);
          s.imports = s.imports.filter(i => i.accountId !== a.id);
          for (const [k, p] of Object.entries(s.importProfiles)) if (p.accountId === a.id) delete s.importProfiles[k];
        });
      } }, 'Eliminar'));
  })));
  grid.append(accCard);

  // ---------- import formats ----------
  const profiles = Object.entries(state.importProfiles);
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Formatos de importación guardados')),
    profiles.length ? h('div', { class: 'rows' }, profiles.map(([sig, p]) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, state.accounts.find(a => a.id === p.accountId)?.name || 'Cuenta eliminada'),
        h('div', { class: 'desc', title: sig }, sig.split('|').filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm ghost', onclick: () => update(s => { delete s.importProfiles[sig]; }) }, 'Olvidar'))))
      : h('p', { class: 'small muted' }, 'Cuando importas un archivo, recuerdo sus columnas para que la próxima vez sea un clic.')));

  // ---------- categories ----------
  const catCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Categorías'), h('button', { class: 'btn sm', onclick: () => editCategory(null) }, '+ Nueva categoría')));
  const counts = {};
  for (const t of state.transactions) if (t.categoryId) counts[t.categoryId] = (counts[t.categoryId] || 0) + 1;
  const natureL = { fixed: 'fijo', variable: 'variable', oneoff: 'puntual' };
  const catGrid = h('div', { class: 'grid' });
  for (const kind of ['expense', 'saving', 'income', 'transfer']) {
    const list = state.categories.filter(c => c.kind === kind);
    catGrid.append(h('div', { class: kind === 'expense' ? 'span-8' : 'span-4' },
      h('div', { class: 'chip-group-label', style: { marginTop: 0 } }, KIND_LABELS[kind]),
      h('div', { class: 'rows', style: kind === 'expense' ? { columns: '2 260px', columnGap: '24px', display: 'block' } : {} }, list.map(c => h('div', { class: 'row click', style: { breakInside: 'avoid' }, onclick: () => editCategory(c.id) },
        catIcon(c, 30),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, c.name),
          h('div', { class: 'desc' }, [kind === 'expense' ? natureL[c.nature] : null, kind === 'expense' ? (c.need ? 'necesidad' : 'deseo') : null, (counts[c.id] || 0) + ' mov.'].filter(Boolean).join(' · '))))))));
  }
  catCard.append(catGrid);
  grid.append(catCard);

  // ---------- rules ----------
  const rules = [...state.rules].sort((a, b) => a.match.localeCompare(b.match));
  const ruleList = h('div', { class: 'rows' });
  const ruleFilter = h('input', { type: 'search', placeholder: 'Buscar regla…', style: { width: '100%', marginBottom: '6px' } });
  const drawRules = () => {
    ruleList.replaceChildren();
    const q = ruleFilter.value.toLowerCase();
    for (const r of rules.filter(r => !q || r.match.includes(q)).slice(0, 200)) {
      const cat = state.categories.find(c => c.id === r.categoryId);
      const sel = h('select', { style: { maxWidth: '200px' } }, state.categories.map(c => h('option', { value: c.id }, c.icon + ' ' + c.name)));
      sel.value = r.categoryId;
      sel.addEventListener('change', () => update(s => {
        const rr = s.rules.find(x => x.id === r.id); rr.categoryId = sel.value;
        for (const t of s.transactions) if (t.merchant === r.match && t.status === 'auto') t.categoryId = sel.value;
      }));
      ruleList.append(h('div', { class: 'row' }, catIcon(cat, 28),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, r.type === 'contains' ? `Contiene «${r.match}»` : r.match), h('div', { class: 'desc' }, (r.hits || 0) + ' usos automáticos' + (r.nature ? ' · ' + natureL[r.nature] : ''))),
        sel, h('button', { class: 'btn sm ghost icon', title: 'Eliminar regla', onclick: () => update(s => { s.rules = s.rules.filter(x => x.id !== r.id); }) }, '✕')));
    }
  };
  ruleFilter.addEventListener('input', drawRules);
  const kwInput = h('input', { type: 'text', placeholder: 'Palabra en el concepto, p. ej. ALQUILER' });
  const kwCat = h('select', {}, state.categories.map(c => h('option', { value: c.id }, c.icon + ' ' + c.name)));
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Reglas aprendidas'), h('span', { class: 'meta' }, rules.length + ' reglas')),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Se crean al confirmar un comercio. Cambiar la categoría aquí actualiza los movimientos automáticos de ese comercio.'),
    rules.length > 8 ? ruleFilter : null, ruleList,
    h('div', { class: 'inline-form' }, kwInput, kwCat, h('button', { class: 'btn', onclick: () => {
      const m = kwInput.value.trim(); if (!m) return;
      update(s => { s.rules.push({ id: uid(), type: 'contains', match: m.toUpperCase(), categoryId: kwCat.value, hits: 0, createdAt: Date.now() }); });
    } }, 'Añadir regla por palabra'))));
  drawRules();

  // ---------- data ----------
  const hasSample = state.accounts.some(a => a.sample);
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Datos')),
    h('div', { class: 'btn-row' },
      hasSample ? h('button', { class: 'btn', onclick: () => { update(s => removeSample(s)); toast('Datos de ejemplo eliminados'); } }, 'Quitar datos de ejemplo')
        : h('button', { class: 'btn', onclick: () => { update(s => loadSample(s)); location.hash = '#/resumen'; } }, 'Cargar datos de ejemplo'),
      h('button', { class: 'btn danger', onclick: () => {
        if (!confirm('¿Borrar TODOS los datos de este dispositivo? No se puede deshacer.')) return;
        if (!confirm('Seguro? Te recomiendo descargar antes una copia.')) return;
        replaceState(defaultState());
        location.hash = '#/importar';
      } }, 'Borrar todos los datos'))));
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportJSON() {
  update(s => { s.settings.lastBackupAt = Date.now(); });
  const d = new Date().toISOString().slice(0, 10);
  download(`finanzas-copia-${d}.json`, JSON.stringify(getState(), null, 1), 'application/json');
}

function exportCSV() {
  const s = getState();
  const cats = new Map(s.categories.map(c => [c.id, c.name]));
  const accs = new Map(s.accounts.map(a => [a.id, a.name]));
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Fecha', 'Cuenta', 'Comercio', 'Concepto', 'Categoría', 'Importe', 'Estado', 'Nota'].join(';')];
  for (const t of s.transactions) lines.push([t.date, q(accs.get(t.accountId)), q(t.merchantName), q(t.description), q(cats.get(t.categoryId) || ''), String(t.amount).replace('.', ','), t.status, q(t.note)].join(';'));
  download(`finanzas-movimientos-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\n'), 'text/csv');
}

function editCategory(id) {
  const state = getState();
  const c = id ? { ...state.categories.find(x => x.id === id) } : { id: null, name: '', kind: 'expense', nature: 'variable', need: false, icon: '•', color: '#7b8794' };
  const name = h('input', { type: 'text', value: c.name, placeholder: 'Nombre', style: { flex: 1 } });
  const icon = h('input', { type: 'text', value: c.icon, maxlength: '4', style: { width: '64px', textAlign: 'center' }, 'aria-label': 'Icono' });
  const color = h('input', { type: 'color', value: c.color, class: 'color-input', 'aria-label': 'Color' });
  const kind = h('select', {}, Object.entries(KIND_LABELS).map(([k, l]) => h('option', { value: k }, l)));
  kind.value = c.kind;
  const nature = h('select', {}, h('option', { value: 'fixed' }, 'Fijo recurrente'), h('option', { value: 'variable' }, 'Variable habitual'), h('option', { value: 'oneoff' }, 'Puntual'));
  nature.value = c.nature || 'variable';
  const need = h('select', {}, h('option', { value: '1' }, 'Necesidad'), h('option', { value: '0' }, 'Deseo'));
  need.value = c.need ? '1' : '0';
  const expOnly = h('div', { class: 'map-grid', style: { marginTop: '12px' } },
    h('label', { class: 'field' }, h('span', {}, 'Tipo de gasto por defecto'), nature),
    h('label', { class: 'field' }, h('span', {}, 'Para el 50/30/20'), need));
  const syncKind = () => { expOnly.hidden = kind.value !== 'expense'; };
  kind.addEventListener('change', syncKind); syncKind();
  const count = id ? state.transactions.filter(t => t.categoryId === id).length : 0;

  const sheet = openSheet({
    title: id ? 'Editar categoría' : 'Nueva categoría',
    body: h('div', {},
      h('div', { style: { display: 'flex', gap: '8px' } }, icon, name, color),
      h('label', { class: 'field', style: { marginTop: '12px' } }, h('span', {}, 'Grupo'), kind),
      expOnly),
    foot: [
      id ? h('button', { class: 'btn ghost danger', style: { marginRight: 'auto' }, onclick: del }, 'Eliminar') : null,
      h('button', { class: 'btn', onclick: () => sheet.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: save }, 'Guardar'),
    ],
  });

  function save() {
    const n = name.value.trim(); if (!n) { name.focus(); return; }
    update(s => {
      const data = { name: n, icon: icon.value.trim() || '•', color: color.value, kind: kind.value, nature: kind.value === 'expense' ? nature.value : undefined, need: kind.value === 'expense' ? need.value === '1' : undefined };
      if (id) Object.assign(s.categories.find(x => x.id === id), data);
      else s.categories.push({ id: 'c-' + uid().slice(0, 8), ...data });
    });
    sheet.close();
  }
  function del() {
    const others = state.categories.filter(x => x.id !== id);
    let target = null;
    if (count) {
      const fallback = others.find(x => x.id === 'otros') || others[0];
      if (!confirm(`«${c.name}» tiene ${count} movimientos. Pasarán a «${fallback.name}». ¿Continuar?`)) return;
      target = fallback.id;
    } else if (!confirm(`¿Eliminar «${c.name}»?`)) return;
    update(s => {
      for (const t of s.transactions) if (t.categoryId === id) t.categoryId = target;
      for (const r of s.rules) if (r.categoryId === id) r.categoryId = target;
      s.rules = s.rules.filter(r => r.categoryId);
      s.categories = s.categories.filter(x => x.id !== id);
      s.settings.deletedCategoryIds = [...(s.settings.deletedCategoryIds || []), id];
      for (const b of Object.values(s.budgets)) delete b.cats[id];
    });
    sheet.close();
  }
}
