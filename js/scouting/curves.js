// Scouting page: the insect strip and the zone / growth curves
import { openCase } from '../cases.js';
import { el, num, drawer, ymd, parseNoon as parse, shortDay } from '../ui.js';
import { reload } from './index.js';
import { S, SVG_NS, dotEl } from './state.js';

// the insects a day in one line on top of the trap map (0.7.190, owner 2 Oct 2026: "integrate the insect per day graph
// and trend in the top of heatmap in more compact version, you can always click to have more clear vision"): the
// figure, the trend against a week before, a small curve with the watch and over lines; a click opens the full curve
// with the cases under it (zoneCurve) in a window
export function insectStrip(h, z) {
  const th = h.threshold || {};
  const byDay = new Map();
  (h.traps || []).forEach(t => (t.points || []).forEach(p => {
    if (p.rate == null) return;
    const d = String(p.day).slice(0, 10), a = byDay.get(d) || { sum: 0, n: 0 };
    a.sum += Number(p.rate); a.n++; byDay.set(d, a);
  }));
  const pts = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, a]) => ({ d, v: a.sum / a.n, n: a.n }));
  const last = pts[pts.length - 1];
  const weekAgo = last ? [...pts].reverse().find(p => parse(p.d).getTime() <= parse(last.d).getTime() - 6 * 864e5) : null;
  const before = pts[pts.length - 2] || null, ref = weekAgo || before;
  const tone = v => v >= (th.over ?? Infinity) ? 'bad' : v >= (th.watch ?? Infinity) ? 'warn' : 'ok';
  const strip = el('div', 'pd-ins');
  const left = el('div', 'pd-ins-fig');
  left.append(el('span', 'pd-hlabel', 'Insects a day'));
  if (!last) left.append(el('span', 'hint', 'no figure yet: a trap gets one from its second photo'));
  else {
    const big = el('span', 'pd-ins-big ' + tone(last.v));
    big.append(el('b', null, num(last.v, last.v >= 10 ? 0 : 1)));
    left.append(big);
    if (ref) {
      const up = last.v > ref.v * 1.15, down = last.v < ref.v * 0.85;
      const pill = el('span', 'pill ' + (up ? 'bad' : down ? 'ok' : ''), `${up ? '▲' : down ? '▼' : '–'} ${num(ref.v, ref.v >= 10 ? 0 : 1)} on ${shortDay(ref.d)}`);
      pill.title = `${num(ref.v, 1)} a trap a day on ${shortDay(ref.d)}, ${num(last.v, 1)} on ${shortDay(last.d)}`;
      left.append(pill);
    }
    left.append(el('span', 'hint', `a trap a day · ${shortDay(last.d)}, ${last.n} trap${last.n === 1 ? '' : 's'}`));
  }
  strip.append(left);
  if (pts.length > 1) {
    const W = 120, H = 34, P = 4;
    const t0 = parse(pts[0].d).getTime(), t1 = parse(last.d).getTime(), span = Math.max(1, t1 - t0);
    const max = Math.max(1, (th.over || 0) * 1.2, ...pts.map(p => p.v));
    const x = d => P + (parse(d).getTime() - t0) * (W - 2 * P) / span, y = v => H - P - v * (H - 2 * P) / max;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-curve pd-ins-svg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Insects a trap a day, ${shortDay(pts[0].d)} to ${shortDay(last.d)}`);
    const mk = (tag, at) => { const n = document.createElementNS(SVG_NS, tag); Object.entries(at).forEach(([k, v]) => n.setAttribute(k, v)); svg.append(n); return n; };
    [['watch', th.watch], ['over', th.over]].forEach(([w, v]) => { if (v != null && v <= max) mk('line', { x1: P, x2: W - P, y1: y(v), y2: y(v), class: 'pd-th ' + w }); });
    mk('polygon', { points: `${x(pts[0].d).toFixed(1)},${H - P} ` + pts.map(p => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ') + ` ${x(last.d).toFixed(1)},${H - P}`, class: 'pd-area' });
    mk('polyline', { points: pts.map(p => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: 'pd-line' });
    mk('circle', { cx: x(last.d), cy: y(last.v), r: 3, class: 'pd-pt ' + tone(last.v) });
    const tt = document.createElementNS(SVG_NS, 'title');
    tt.textContent = pts.map(p => `${shortDay(p.d)}: ${num(p.v, 1)}`).join('\n');
    svg.append(tt);
    strip.append(svg);
  }
  strip.tabIndex = 0; strip.setAttribute('role', 'button');
  strip.title = 'Open the curve: the 30 days, the watch and over lines, the cases';
  const open = () => { const d = drawer(`Insects a day · ${z.name}`, 'The average over the traps read each day, the last 30 days'); d.box.classList.add('sump-drawer'); d.body.append(zoneCurve(h, z)); };
  strip.onclick = open;
  strip.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  return strip;
}

// the zone's insects a day: each day, the average over the traps read that day (each trap = both sides' new insects
// over their time, zone_health); a big figure, the change against a week before, the watch and over lines, the cases
const SEV = ['#8a8f98', '#e2b34a', '#e0873a', '#d64545'];
function zoneCurve(h, z) {
  const box = el('div', 'pd-curvebox');
  const th = h.threshold || {};
  const byDay = new Map();
  (h.traps || []).forEach(t => (t.points || []).forEach(p => {
    if (p.rate == null) return;
    const d = String(p.day).slice(0, 10), a = byDay.get(d) || { sum: 0, n: 0 };
    a.sum += Number(p.rate); a.n++; byDay.set(d, a);
  }));
  const pts = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, a]) => ({ d, v: a.sum / a.n, n: a.n }));
  const last = pts[pts.length - 1];
  const weekAgo = last ? [...pts].reverse().find(p => parse(p.d).getTime() <= parse(last.d).getTime() - 6 * 864e5) : null;
  const tone = v => v >= (th.over ?? Infinity) ? 'bad' : v >= (th.watch ?? Infinity) ? 'warn' : 'ok';
  const head = el('div', 'pd-zc-head');
  head.append(el('span', 'pd-hlabel', `Insects a day · ${z.name}`));
  if (last) {
    const big = el('div', 'pd-zc-big ' + tone(last.v));
    big.append(el('b', null, num(last.v, last.v >= 10 ? 0 : 1)), el('span', 'hint', `a trap a day · ${shortDay(last.d)}, ${last.n} trap${last.n === 1 ? '' : 's'}`));
    if (weekAgo) {
      const up = last.v > weekAgo.v * 1.15, down = last.v < weekAgo.v * 0.85;
      big.append(el('span', 'pill ' + (up ? 'bad' : down ? 'ok' : ''), `${up ? '▲' : down ? '▼' : '–'} ${num(weekAgo.v, weekAgo.v >= 10 ? 0 : 1)} on ${shortDay(weekAgo.d)}`));
    }
    head.append(big);
  }
  box.append(head);
  if (!pts.length) box.append(el('div', 'hint', 'No trap figure in the last 30 days: a trap gets one from its second photo.'));
  else {
    // the time axis starts at the first figure (a week at least), so a young record is not a flat line in an empty month
    const d1 = parse(h.day).getTime();
    const d0 = Math.max(parse(h.from).getTime(), Math.min(parse(pts[0].d).getTime() - 864e5, d1 - 6 * 864e5));
    const W = 300, H = 120, L = 6, R = 6, T = 8, B = 16, span = Math.max(1, d1 - d0);
    const x = d => L + (parse(d).getTime() - d0) * (W - L - R) / span;
    const max = Math.max(1, (th.over || 0) * 1.25, ...pts.map(p => p.v));
    const y = v => H - B - v * (H - T - B) / max;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-curve'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${z.name}: insects a trap a day, ${shortDay(ymd(new Date(d0)))} to ${shortDay(h.day)}`);
    const mk = (tag, at, parent = svg) => { const n = document.createElementNS(SVG_NS, tag); Object.entries(at).forEach(([k, v]) => n.setAttribute(k, v)); parent.append(n); return n; };
    [['watch', th.watch], ['over', th.over]].forEach(([w, v]) => {
      if (v == null || v > max) return;
      mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'pd-th ' + w });
      const t = mk('text', { x: W - R, y: y(v) - 2, class: 'pd-th-t', 'text-anchor': 'end' }); t.textContent = `${w} ${num(v, 1)}`;
    });
    mk('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'pd-axis' });
    [[ymd(new Date(d0)), 'start'], [h.day, 'end']].forEach(([d, a]) => { const t = mk('text', { x: x(d), y: H - 3, class: 'pd-ax-t', 'text-anchor': a }); t.textContent = shortDay(d); });
    if (pts.length > 1) {
      mk('polygon', { points: `${x(pts[0].d).toFixed(1)},${H - B} ` + pts.map(p => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ') + ` ${x(last.d).toFixed(1)},${H - B}`, class: 'pd-area' });
      mk('polyline', { points: pts.map(p => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: 'pd-line' });
    }
    pts.forEach(p => {
      const c = mk('circle', { cx: x(p.d), cy: y(p.v), r: p === last ? 3.6 : 2.6, class: 'pd-pt ' + tone(p.v) });
      const tt = document.createElementNS(SVG_NS, 'title'); tt.textContent = `${shortDay(p.d)}: ${num(p.v, 1)} insects a trap a day (${p.n} trap${p.n === 1 ? '' : 's'})`; c.append(tt);
    });
    box.append(svg);
    // the cases: a strip each, their severity on the same days
    (h.cases || []).forEach(k => {
      const row = el('div', 'pd-hcase');
      const lab = el('button', 'linkish', k.label + (k.status === 'closed' ? ' (closed)' : ''));
      lab.onclick = () => openCase(k.id, reload, S.farm);
      const strip = document.createElementNS(SVG_NS, 'svg');
      strip.setAttribute('viewBox', `0 0 ${W} 12`); strip.setAttribute('class', 'pd-sevstrip');
      (k.points || []).forEach(p => {
        if (!p.day || parse(p.day).getTime() < d0) return;
        const c = mk('circle', { cx: x(p.day), cy: 6, r: 2.5 + Number(p.severity || 0), fill: SEV[Math.max(0, Math.min(3, Number(p.severity) || 0))] }, strip);
        const tt = document.createElementNS(SVG_NS, 'title'); tt.textContent = `${k.label} · ${shortDay(p.day)}: severity ${p.severity}`; c.append(tt);
      });
      row.append(dotEl(k.dot), lab, strip);
      box.append(row);
    });
  }
  return box;
}

// the sizes measured on the growth photos of 30 days: a line per crop and dimension, a day's photos averaged
export const G_WORD = { length: 'Length', diameter: 'Diameter', width: 'Width', height: 'Height' };
export function growthCurve(g) {
  const pts = g?.points || [];
  if (!pts.length) return null;
  const crops = new Set(pts.map(p => p.crop || ''));
  const series = new Map();
  pts.forEach(p => { const k = (p.crop || '') + '|' + p.what; if (!series.has(k)) series.set(k, { crop: p.crop, what: p.what, pts: [] }); series.get(k).pts.push(p); });
  const box = el('div', 'pd-curvebox pd-gbox');
  box.append(el('div', 'pd-hlabel', 'Sizes · 30 days'));
  const W = 300, H = 96, L = 24, R = 6, T = 8, B = 16;
  const d0 = parse(g.from).getTime(), d1 = parse(g.day).getTime();
  const first = Math.min(...pts.map(p => parse(p.day).getTime()));
  const t0 = Math.max(d0, Math.min(first - 864e5, d1 - 6 * 864e5)), span = Math.max(1, d1 - t0);
  const max = Math.max(...pts.map(p => Number(p.mm))) * 1.1 || 1;
  const x = d => L + (parse(d).getTime() - t0) * (W - L - R) / span, y = v => H - B - v * (H - T - B) / max;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-curve pd-gsvg'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Sizes measured on the growth photos, ${shortDay(ymd(new Date(t0)))} to ${shortDay(g.day)}`);
  const mk = (tag, at) => { const n = document.createElementNS(SVG_NS, tag); Object.entries(at).forEach(([k, v]) => n.setAttribute(k, v)); svg.append(n); return n; };
  mk('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'pd-axis' });
  [0, max / 1.1].forEach(v => { const t = mk('text', { x: L - 3, y: y(v) + 3, class: 'pd-ax-t', 'text-anchor': 'end' }); t.textContent = num(v, 0); });
  [[ymd(new Date(t0)), 'start'], [g.day, 'end']].forEach(([d, a]) => { const t = mk('text', { x: x(d), y: H - 3, class: 'pd-ax-t', 'text-anchor': a }); t.textContent = shortDay(d); });
  const legend = el('div', 'pd-glegend');
  [...series.values()].forEach((sr, i) => {
    const cls = 'pd-g' + (i % 4);
    if (sr.pts.length > 1) mk('polyline', { points: sr.pts.map(p => `${x(p.day).toFixed(1)},${y(Number(p.mm)).toFixed(1)}`).join(' '), class: 'pd-gline ' + cls });
    sr.pts.forEach(p => {
      const c = mk('circle', { cx: x(p.day), cy: y(Number(p.mm)), r: 2.6, class: 'pd-gpt ' + cls });
      const tt = document.createElementNS(SVG_NS, 'title');
      tt.textContent = `${shortDay(p.day)}: ${G_WORD[p.what] || p.what} ${num(p.mm, 0)} mm${p.n > 1 ? ` (average of ${p.n})` : ''}${p.crop ? ' · ' + p.crop : ''}`;
      c.append(tt);
    });
    const last = sr.pts[sr.pts.length - 1], before = sr.pts[sr.pts.length - 2];
    const item = el('span', 'pd-gitem');
    const sw = el('span', 'pd-gsw ' + cls);
    item.append(sw, el('span', null, `${crops.size > 1 && sr.crop ? sr.crop + ' · ' : ''}${G_WORD[sr.what] || sr.what}`), el('b', null, `${num(last.mm, 0)} mm`));
    if (before) { const dd = Number(last.mm) - Number(before.mm); item.append(el('span', 'hint', `${dd >= 0 ? '+' : '−'}${num(Math.abs(dd), 0)} since ${shortDay(before.day)}`)); }
    legend.append(item);
  });
  box.append(svg, legend);
  return box;
}
