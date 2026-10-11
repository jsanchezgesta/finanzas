// Shared UI pieces: bottom sheet / dialog, toast, category icon and picker.

import { h, clear } from './util.js';

export function openSheet({ title, body, foot, onClose }) {
  const root = document.getElementById('sheet-root');
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const closeBtn = h('button', { class: 'btn icon ghost', 'aria-label': 'Close' }, '✕');
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), closeBtn),
    h('div', { class: 'sheet-body' }, body),
    foot ? h('div', { class: 'sheet-foot' }, foot) : null,
  );
  const prevFocus = document.activeElement;
  function close() {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove(); sheet.remove();
    onClose?.();
    prevFocus?.focus?.();
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  root.append(backdrop, sheet);
  setTimeout(() => (sheet.querySelector('input, select, textarea') || closeBtn).focus({ preventScroll: true }), 30);
  return { close, sheet };
}

export function toast(message, { action, onAction, timeout = 5000 } = {}) {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast' }, h('span', {}, message));
  let done = false;
  const remove = () => { if (!done) { done = true; el.remove(); } };
  if (action) el.append(h('button', { onclick: () => { remove(); onAction?.(); } }, action));
  root.append(el);
  setTimeout(remove, timeout);
  return remove;
}

export function catIcon(cat, size = 34) {
  const color = cat?.color || '#a0a6ad';
  return h('span', {
    class: 'cat-ico',
    style: { width: size + 'px', height: size + 'px', background: `color-mix(in srgb, ${color} 18%, transparent)`, color },
    'aria-hidden': 'true',
  }, cat?.icon || '?');
}

export const KIND_LABELS = { expense: 'Expenses', saving: 'Saving & investing', income: 'Income', transfer: 'Internal transfers' };

// Order categories for a given amount sign: the usual kinds first.
export function orderedKinds(amount) {
  return amount < 0 ? ['expense', 'saving', 'transfer', 'income'] : ['income', 'transfer', 'expense', 'saving'];
}

export function usageCounts(state) {
  const counts = {};
  for (const t of state.transactions) if (t.categoryId) counts[t.categoryId] = (counts[t.categoryId] || 0) + 1;
  return counts;
}

// Chip-based category picker. Shows a short "frequent" row first and the
// full grouped list behind a toggle, so the common case is one tap.
export function categoryPicker(state, { amount = -1, selected = null, suggestion = null, exclude = null, onPick, shortcuts = false, frequentCount = 8 }) {
  const counts = usageCounts(state);
  const kinds = orderedKinds(amount);
  const cats = state.categories.filter(c => !c.archived);
  const rank = c => kinds.indexOf(c.kind);
  const frequent = [...cats]
    .filter(c => c.id !== suggestion && c.id !== exclude && rank(c) <= 1)
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || rank(a) - rank(b))
    .slice(0, frequentCount);
  const top = [suggestion && cats.find(c => c.id === suggestion), ...frequent].filter(Boolean);

  const wrap = h('div', {});
  const chip = (c, i) => h('button', {
    class: 'chip' + (c.id === selected ? ' on' : ''), type: 'button', 'data-cat': c.id,
    onclick: () => onPick(c.id),
  }, h('span', { 'aria-hidden': 'true' }, c.icon), c.name, shortcuts && i != null && i < 9 ? h('span', { class: 'kbd' }, String(i + 1)) : null);

  wrap.append(h('div', { class: 'chips' }, top.map((c, i) => chip(c, i))));
  const all = h('div', { hidden: true });
  for (const k of kinds) {
    const list = cats.filter(c => c.kind === k);
    if (!list.length) continue;
    all.append(h('div', { class: 'chip-group-label' }, KIND_LABELS[k]), h('div', { class: 'chips' }, list.map(c => chip(c))));
  }
  const toggle = h('button', { class: 'btn ghost sm', type: 'button', style: { marginTop: '10px' } }, 'See all categories ▾');
  toggle.addEventListener('click', () => {
    all.hidden = !all.hidden;
    toggle.textContent = all.hidden ? 'See all categories ▾' : 'Hide ▴';
  });
  wrap.append(toggle, all);
  wrap.shortcutIds = top.map(c => c.id);
  return wrap;
}

export function emptyState({ title, text, actions = [] }) {
  return h('div', { class: 'card empty' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'btn-row' }, actions));
}

export function setContent(el, ...kids) { clear(el); kids.flat().forEach(k => k && el.append(k)); return el; }
