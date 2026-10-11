// Dependency-free SVG charts.

import { esc, moneyShort, money } from './util.js';

// segments: [{id, label, value, color}]
export function donut(segments, { size = 200, thickness = 26, centerTop = '', centerBottom = '' } = {}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 2 : 0;
  let offset = 0;
  const arcs = total > 0 ? segments.filter(s => s.value > 0).map(s => {
    const len = (s.value / total) * c;
    const dash = Math.max(0, len - gap);
    const el = `<circle class="donut-seg" data-id="${esc(s.id)}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(s.label)}: ${esc(money(s.value))} (${Math.round(s.value / total * 100)} %)</title></circle>`;
    offset += len;
    return el;
  }).join('') : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${thickness}"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Gráfico de reparto">${arcs}
    <text x="50%" y="${size / 2 - 2}" text-anchor="middle" class="donut-center-top">${esc(centerTop)}</text>
    <text x="50%" y="${size / 2 + 18}" text-anchor="middle">${esc(centerBottom)}</text></svg>`;
}

// labels: ['ene', ...]; keys: month keys (for click); series: [{id,label,color,values}]
// line: {label, color, values} drawn on top (e.g. income)
export function stackedBars({ labels, keys, series, line, selected, height = 240 }) {
  const n = labels.length;
  const W = Math.max(320, n * 54);
  const padL = 46, padR = 8, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = height - padT - padB;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
  const maxVal = Math.max(1, ...totals, ...(line ? line.values : [0]));
  const step = niceStep(maxVal / 4);
  const top = Math.ceil(maxVal / step) * step;
  const y = v => padT + plotH - (v / top) * plotH;
  const bw = plotW / n;
  const barW = Math.min(34, bw * 0.62);
  let out = '';
  for (let v = 0; v <= top + 0.001; v += step) {
    out += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    out += `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${esc(moneyShort(v))}</text>`;
  }
  labels.forEach((lab, i) => {
    const x = padL + i * bw;
    if (keys && keys[i] === selected) out += `<rect class="sel" x="${x + 2}" y="${padT}" width="${bw - 4}" height="${plotH}" rx="6"/>`;
    let acc = 0;
    const bx = x + (bw - barW) / 2;
    series.forEach(s => {
      const v = Math.max(0, s.values[i] || 0);
      if (!v) return;
      const y0 = y(acc), y1 = y(acc + v);
      out += `<rect x="${bx}" y="${y1}" width="${barW}" height="${Math.max(0.5, y0 - y1)}" fill="${s.color}" rx="2"><title>${esc(s.label)} · ${esc(lab)}: ${esc(money(v))}</title></rect>`;
      acc += v;
    });
    out += `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });
  if (line) {
    const pts = line.values.map((v, i) => [padL + i * bw + bw / 2, y(Math.max(0, v))]);
    out += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${line.color}" stroke-width="2" stroke-linejoin="round"/>`;
    out += pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--surface)" stroke="${line.color}" stroke-width="2"><title>${esc(line.label)} · ${esc(labels[i])}: ${esc(money(line.values[i]))}</title></circle>`).join('');
  }
  if (keys) labels.forEach((_, i) => {
    out += `<rect class="bar-hit" data-month="${esc(keys[i])}" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${plotH + padB}"><title>${esc(labels[i])}</title></rect>`;
  });
  return `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Evolución mensual">${out}</svg>`;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export function sparkline(values, { width = 80, height = 22, color = 'var(--muted)' } = {}) {
  if (!values.length) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}
