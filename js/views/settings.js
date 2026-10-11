import { h, uid, money } from '../util.js';
import { update, replaceState, getState } from '../store.js';
import { openSheet, catIcon, toast, KIND_LABELS } from '../ui.js';
import { loadSample, removeSample } from '../sample.js';
import { defaultState } from '../defaults.js';

export function render(root, { state }) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'),
    h('div', { class: 'sub' }, 'Your data is stored only in this browser. Back it up now and then.'))));

  const grid = h('div', { class: 'grid' });
  root.append(grid);

  // ---------- backup ----------
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('invalid format');
      if (!confirm(`Restore backup with ${data.transactions.length} transactions? Current data will be replaced.`)) return;
      replaceState(data);
      toast('Backup restored');
    } catch (e) { alert('Could not restore: ' + e.message); }
  });
  const lastBackup = state.settings.lastBackupAt ? new Date(state.settings.lastBackupAt).toLocaleDateString('en-GB') : 'never';
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Backup'), h('span', { class: 'meta' }, 'last: ' + lastBackup)),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Download a file with everything (transactions, rules, plan). Also use it to move your data from computer to phone.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: exportJSON }, 'Download backup'),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Restore backup'),
      h('button', { class: 'btn ghost', onclick: exportCSV }, 'Export transactions CSV'), fileIn)));

  // ---------- preferences ----------
  const thr = h('input', { type: 'number', min: '0', step: '10', value: state.settings.oneOffThreshold, style: { width: '110px' } });
  thr.addEventListener('change', () => update(s => { s.settings.oneOffThreshold = Math.max(0, Number(thr.value) || 0); }));
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'How expenses are classified')),
    h('div', { class: 'small', style: { color: 'var(--ink-2)' } },
      h('p', { style: { marginTop: 0 } }, h('b', {}, 'Fixed recurring: '), 'the same merchant charges on a regular cadence (weekly, monthly, yearly…) with a similar amount, or the category is a fixed expense.'),
      h('p', {}, h('b', {}, 'One-off: '), 'infrequent or large expenses. Any non-fixed expense above this amount counts as one-off:'),
      h('label', { class: 'check' }, thr, ' €'),
      h('p', {}, h('b', {}, 'Investing: '), 'anything in saving and investing categories.'),
      h('p', { style: { marginBottom: 0 } }, 'You can always override the type of a single transaction from its detail sheet.'))));

  // ---------- saveback ----------
  const sbc = state.settings.saveback;
  const sbInput = (key, step, scale = 1) => {
    const i = h('input', { type: 'number', step, min: '0', value: Math.round(sbc[key] * scale * 100) / 100, style: { width: '100%' } });
    i.addEventListener('change', () => update(s => { s.settings.saveback[key] = (Number(i.value) || 0) / scale; }));
    return i;
  };
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Saveback terms')),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Trade Republic\'s terms in Spain as of September 2026. Change them if TR updates them.'),
    h('div', { class: 'map-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Rate (%)'), sbInput('rate', '0.1', 100)),
      h('label', { class: 'field' }, h('span', {}, 'Max spend/month (€)'), sbInput('spendCap', '50')),
      h('label', { class: 'field' }, h('span', {}, 'Max Saveback/month (€)'), sbInput('monthlyCap', '1')),
      h('label', { class: 'field' }, h('span', {}, 'Min savings plans/month (€)'), sbInput('minPlan', '10')))));

  // ---------- coach ----------
  const cc = { returnRate: 0.07, years: 10, reviewDays: 90, ...(state.settings.coach || {}) };
  const ccInput = (key, step, scale = 1) => {
    const i = h('input', { type: 'number', step, min: '0', value: Math.round(cc[key] * scale * 100) / 100, style: { width: '100%' } });
    i.addEventListener('change', () => update(s => { s.settings.coach = { ...cc, ...(s.settings.coach || {}), [key]: (Number(i.value) || 0) / scale }; }));
    return i;
  };
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Savings coach')),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Assumed annual return for the opportunity cost (the MSCI World has returned around 7% a year over the long run; not a guarantee), and how often a merchant comes back for review.'),
    h('div', { class: 'map-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Annual return (%)'), ccInput('returnRate', '0.5', 100)),
      h('label', { class: 'field' }, h('span', {}, 'Years'), ccInput('years', '1')),
      h('label', { class: 'field' }, h('span', {}, 'Review every (days)'), ccInput('reviewDays', '15')))));

  // ---------- accounts ----------
  const accCard = h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h2', {}, 'Accounts')));
  if (!state.accounts.length) accCard.append(h('p', { class: 'small muted' }, 'Created when you import the first statement from each bank.'));
  accCard.append(h('div', { class: 'rows' }, state.accounts.map(a => {
    const n = state.transactions.filter(t => t.accountId === a.id).length;
    return h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, a.name), h('div', { class: 'desc' }, n + ' transactions' + (a.bank ? ' · ' + a.bank : ''))),
      h('button', { class: 'btn sm ghost', onclick: () => { const name = prompt('Account name', a.name); if (name) update(s => { s.accounts.find(x => x.id === a.id).name = name.trim(); }); } }, 'Rename'),
      h('button', { class: 'btn sm ghost danger', onclick: () => {
        if (!confirm(`Delete “${a.name}” and its ${n} transactions?`)) return;
        update(s => {
          s.accounts = s.accounts.filter(x => x.id !== a.id);
          s.transactions = s.transactions.filter(t => t.accountId !== a.id);
          s.imports = s.imports.filter(i => i.accountId !== a.id);
          for (const [k, p] of Object.entries(s.importProfiles)) if (p.accountId === a.id) delete s.importProfiles[k];
        });
      } }, 'Delete'));
  })));
  grid.append(accCard);

  // ---------- import formats ----------
  const profiles = Object.entries(state.importProfiles);
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Saved import formats')),
    profiles.length ? h('div', { class: 'rows' }, profiles.map(([sig, p]) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, state.accounts.find(a => a.id === p.accountId)?.name || 'Deleted account'),
        h('div', { class: 'desc', title: sig }, sig.split('|').filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm ghost', onclick: () => update(s => { delete s.importProfiles[sig]; }) }, 'Forget'))))
      : h('p', { class: 'small muted' }, 'When you import a file, its columns are remembered so next time is one click.')));

  // ---------- categories ----------
  const catCard = h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Categories'), h('button', { class: 'btn sm', onclick: () => editCategory(null) }, '+ New category')));
  const counts = {};
  for (const t of state.transactions) if (t.categoryId) counts[t.categoryId] = (counts[t.categoryId] || 0) + 1;
  const natureL = { fixed: 'fixed', variable: 'variable', oneoff: 'one-off' };
  const catGrid = h('div', { class: 'grid' });
  for (const kind of ['expense', 'saving', 'income', 'transfer']) {
    const list = state.categories.filter(c => c.kind === kind);
    catGrid.append(h('div', { class: kind === 'expense' ? 'span-8' : 'span-4' },
      h('div', { class: 'chip-group-label', style: { marginTop: 0 } }, KIND_LABELS[kind]),
      h('div', { class: 'rows', style: kind === 'expense' ? { columns: '2 260px', columnGap: '24px', display: 'block' } : {} }, list.map(c => h('div', { class: 'row click', style: { breakInside: 'avoid' }, onclick: () => editCategory(c.id) },
        catIcon(c, 30),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, c.name),
          h('div', { class: 'desc' }, [kind === 'expense' ? natureL[c.nature] : null, kind === 'expense' ? (c.need ? 'need' : 'want') : null, (counts[c.id] || 0) + ' txns'].filter(Boolean).join(' · '))))))));
  }
  catCard.append(catGrid);
  grid.append(catCard);

  // ---------- rules ----------
  const rules = [...state.rules].sort((a, b) => a.match.localeCompare(b.match));
  const ruleList = h('div', { class: 'rows' });
  const ruleFilter = h('input', { type: 'search', placeholder: 'Search rules…', style: { width: '100%', marginBottom: '6px' } });
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
        h('div', { class: 'grow' }, h('div', { class: 'title' }, r.type === 'contains' ? `Contains “${r.match}”` : r.match), h('div', { class: 'desc' }, (r.hits || 0) + ' automatic uses' + (r.nature ? ' · ' + natureL[r.nature] : ''))),
        sel, h('button', { class: 'btn sm ghost icon', title: 'Delete rule', onclick: () => update(s => { s.rules = s.rules.filter(x => x.id !== r.id); }) }, '✕')));
    }
  };
  ruleFilter.addEventListener('input', drawRules);
  const kwInput = h('input', { type: 'text', placeholder: 'Word in the description, e.g. RENT' });
  const kwCat = h('select', {}, state.categories.map(c => h('option', { value: c.id }, c.icon + ' ' + c.name)));
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Learned rules'), h('span', { class: 'meta' }, rules.length + ' rules')),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Created when you confirm a merchant. Changing the category here updates that merchant\'s automatic transactions.'),
    rules.length > 8 ? ruleFilter : null, ruleList,
    h('div', { class: 'inline-form' }, kwInput, kwCat, h('button', { class: 'btn', onclick: () => {
      const m = kwInput.value.trim(); if (!m) return;
      update(s => { s.rules.push({ id: uid(), type: 'contains', match: m.toUpperCase(), categoryId: kwCat.value, hits: 0, createdAt: Date.now() }); });
    } }, 'Add keyword rule'))));
  drawRules();

  // ---------- data ----------
  const hasSample = state.accounts.some(a => a.sample);
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Data')),
    h('div', { class: 'btn-row' },
      hasSample ? h('button', { class: 'btn', onclick: () => { update(s => removeSample(s)); toast('Sample data removed'); } }, 'Remove sample data')
        : h('button', { class: 'btn', onclick: () => { update(s => loadSample(s)); location.hash = '#/resumen'; } }, 'Load sample data'),
      h('button', { class: 'btn danger', onclick: () => {
        if (!confirm('Delete ALL data on this device? This cannot be undone.')) return;
        if (!confirm('Are you sure? Download a backup first.')) return;
        replaceState(defaultState());
        location.hash = '#/importar';
      } }, 'Delete all data'))));
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
  download(`finanzas-backup-${d}.json`, JSON.stringify(getState(), null, 1), 'application/json');
}

function exportCSV() {
  const s = getState();
  const cats = new Map(s.categories.map(c => [c.id, c.name]));
  const accs = new Map(s.accounts.map(a => [a.id, a.name]));
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Date', 'Account', 'Merchant', 'Description', 'Category', 'Amount', 'Status', 'Note'].join(';')];
  for (const t of s.transactions) lines.push([t.date, q(accs.get(t.accountId)), q(t.merchantName), q(t.description), q(cats.get(t.categoryId) || ''), String(t.amount).replace('.', ','), t.status, q(t.note)].join(';'));
  download(`finanzas-transactions-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\n'), 'text/csv');
}

function editCategory(id) {
  const state = getState();
  const c = id ? { ...state.categories.find(x => x.id === id) } : { id: null, name: '', kind: 'expense', nature: 'variable', need: false, icon: '•', color: '#7b8794' };
  const name = h('input', { type: 'text', value: c.name, placeholder: 'Name', style: { flex: 1 } });
  const icon = h('input', { type: 'text', value: c.icon, maxlength: '4', style: { width: '64px', textAlign: 'center' }, 'aria-label': 'Icon' });
  const color = h('input', { type: 'color', value: c.color, class: 'color-input', 'aria-label': 'Color' });
  const kind = h('select', {}, Object.entries(KIND_LABELS).map(([k, l]) => h('option', { value: k }, l)));
  kind.value = c.kind;
  const nature = h('select', {}, h('option', { value: 'fixed' }, 'Fixed recurring'), h('option', { value: 'variable' }, 'Everyday variable'), h('option', { value: 'oneoff' }, 'One-off'));
  nature.value = c.nature || 'variable';
  const need = h('select', {}, h('option', { value: '1' }, 'Need'), h('option', { value: '0' }, 'Want'));
  need.value = c.need ? '1' : '0';
  const expOnly = h('div', { class: 'map-grid', style: { marginTop: '12px' } },
    h('label', { class: 'field' }, h('span', {}, 'Default expense type'), nature),
    h('label', { class: 'field' }, h('span', {}, 'For 50/30/20'), need));
  const syncKind = () => { expOnly.hidden = kind.value !== 'expense'; };
  kind.addEventListener('change', syncKind); syncKind();
  const count = id ? state.transactions.filter(t => t.categoryId === id).length : 0;

  const sheet = openSheet({
    title: id ? 'Edit category' : 'New category',
    body: h('div', {},
      h('div', { style: { display: 'flex', gap: '8px' } }, icon, name, color),
      h('label', { class: 'field', style: { marginTop: '12px' } }, h('span', {}, 'Group'), kind),
      expOnly),
    foot: [
      id ? h('button', { class: 'btn ghost danger', style: { marginRight: 'auto' }, onclick: del }, 'Delete') : null,
      h('button', { class: 'btn', onclick: () => sheet.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
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
      if (!confirm(`“${c.name}” has ${count} transactions. They will move to “${fallback.name}”. Continue?`)) return;
      target = fallback.id;
    } else if (!confirm(`Delete “${c.name}”?`)) return;
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
