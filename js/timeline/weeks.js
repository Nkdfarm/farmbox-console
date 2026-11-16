// the weekly harvest and planting rows under the board
import { el } from '../ui.js';
import { DAY, dn, nice, ds, S } from './state.js';

// ── the weeks: kg forecast and harvested, plants to sow or receive (0.7.114, 0.7.118) ──
// Forecast = a batch's expected kg spread over its harvest days (proposals apart,
// lighter); harvested = the cuts recorded, by the day they were weighed. Both per
// zone and for the whole farm. Plants (0.7.127) = the position's places in the week the
// batch is transplanted: raised in our nursery, or ordered from an external one; the
// week's sowing and deliveries are kept for the hover.
export function weeksOf(from, days) {
  const sysOf = new Map();
  (S.data.systems || []).forEach(sy => (sy.positions || []).forEach(p => sysOf.set(p.id, sy.id)));
  const cap = new Map();
  (S.data.systems || []).forEach(sy => (sy.positions || []).forEach(p => cap.set(p.id, Number(p.capacity || 0))));
  const mon0 = from - (((new Date(from * DAY).getUTCDay() || 7) - 1));
  const end = from + days;
  const weeks = new Map();        // monday → { all: cell, bySys: Map(key → cell) }; a key is a zone id,
                                  // 'steady:<group>' (a steady group's zones together) or 'steady:<group>:<crop>' (one crop in them)
  const blank = () => ({ fc: 0, fcP: 0, real: 0, sow: 0, sowP: 0, ext: 0, tp: 0, tpP: 0, ord: 0, ordP: 0, tpCrops: new Map(), crops: new Map() });
  const cellOf = (d, keys) => {
    const m = d - (((new Date(d * DAY).getUTCDay() || 7) - 1));
    if (!weeks.has(m)) weeks.set(m, { all: blank(), bySys: new Map() });
    const w = weeks.get(m);
    return [w.all, ...keys.filter(Boolean).map(k => { if (!w.bySys.has(k)) w.bySys.set(k, blank()); return w.bySys.get(k); })];
  };
  for (let m = mon0; m < end; m += 7) cellOf(m, []);
  const groupOf = new Map((S.data.systems || []).filter(s => s.steady_group_id).map(s => [s.id, 'steady:' + s.steady_group_id]));
  const keysOf = (sys, crop) => { const g = groupOf.get(sys); return !g ? [sys] : crop ? [sys, g, g + ':' + crop] : [sys, g]; };
  const both = (d, keys, f) => cellOf(d, keys).forEach(c => c && f(c));
  (S.data.batches || []).forEach(b => {
    const sys = keysOf(sysOf.get(b.position_id), b.crop_id), prop = b.status === 'proposed';
    if (b.harvest_start && b.harvest_end) {
      const hs = dn(b.harvest_start), he = dn(b.harvest_end), n = Math.max(he - hs + 1, 1), k = Number(b.yield || 0) / n;
      for (let d = Math.max(hs, mon0); d <= Math.min(he, end - 1); d++)
        both(d, sys, c => { prop ? (c.fcP += k) : (c.fc += k); c.crops.set(b.crop, (c.crops.get(b.crop) || 0) + k); });
    }
    if (b.status === 'harvested') return;
    const plants = cap.get(b.position_id) || 0;
    // the week it goes into the position: from our nursery, or ordered from one
    if (b.transplant_date) {
      const d = dn(b.transplant_date), ext = b.nursery === 'external';
      if (d >= mon0 && d < end) both(d, sys, c => {
        const k = ext ? (prop ? 'ordP' : 'ord') : (prop ? 'tpP' : 'tp');
        c[k] += plants; c.tpCrops.set(b.crop, (c.tpCrops.get(b.crop) || 0) + plants);
      });
    }
    if (b.nursery === 'external' && b.transplant_date) {
      const d = dn(b.transplant_date) - 1;
      if (d >= mon0 && d < end) both(d, sys, c => { c.ext += plants; });
    } else if (b.sow_date && b.transplant_date && dn(b.sow_date) < dn(b.transplant_date)) {
      const d = dn(b.sow_date);
      if (d >= mon0 && d < end) both(d, sys, c => { prop ? (c.sowP += plants) : (c.sow += plants); });
    }
  });
  (S.data.harvests || []).forEach(h => {
    const d = dn(h.date);
    if (d >= mon0 && d < end) both(d, keysOf(h.system_id), c => { c.real += Number(h.kg || 0); });
  });
  return [...weeks.entries()].sort((a, b) => a[0] - b[0]);
}
const fmtN = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));

// a kg line: forecast (left) and harvested (right) side by side in each week
export function kgRow(label, weeks, sysId, from, px, total) {
  const cells = weeks.map(([m, w]) => [m, sysId ? (w.bySys.get(sysId) || { fc: 0, fcP: 0, real: 0, crops: new Map() }) : w.all]);
  const max = Math.max(1, ...cells.map(([, c]) => Math.max(c.fc + c.fcP, c.real)));
  const r = el('div', 'tl-row tl-sum tl-kg' + (total ? ' total' : ''));
  const l = el('div', 'tl-label');
  const sumF = cells.reduce((a, [, c]) => a + c.fc + c.fcP, 0), sumR = cells.reduce((a, [, c]) => a + c.real, 0);
  l.append(el('b', null, label), el('span', 'hint', ` ${fmtN(sumF)} · ${fmtN(sumR)}`));
  l.title = `${label}: ${Math.round(sumF).toLocaleString()} kg forecast, ${Math.round(sumR).toLocaleString()} kg harvested in the window`;
  const t = el('div', 'tl-track');
  const H = total ? 26 : 20;
  cells.forEach(([m, c]) => {
    const x = (m - from) * px, width = 7 * px - 2, half = Math.max((width - 2) / 2, 1);
    const col = el('div', 'tl-wk'); col.style.left = x + 'px'; col.style.width = width + 'px';
    const bar = (v, cls, left, bottom = 0) => { if (!v) return 0; const p = el('span', 'tl-wk-part ' + cls); const h = H * v / max;
      p.style.height = h + 'px'; p.style.bottom = bottom + 'px'; p.style.left = left + 'px'; p.style.width = half + 'px'; col.append(p); return h; };
    const h1 = bar(c.fc, 'fc', 0); bar(c.fcP, 'fc-p', 0, h1);
    bar(c.real, 'real', half + 2);
    if (width >= 34 && (c.fc + c.fcP || c.real)) col.append(el('span', 'tl-wk-n', `${fmtN(c.fc + c.fcP)}${c.real ? ' | ' + fmtN(c.real) : ''}`));
    col.title = `Week of ${nice(ds(m))}` + (sysId ? '' : ' · all zones') +
      `\nforecast ${Math.round(c.fc + c.fcP).toLocaleString()} kg` + (c.fcP ? ` (${Math.round(c.fcP).toLocaleString()} only proposed)` : '') +
      `\nharvested ${Math.round(c.real).toLocaleString()} kg` +
      [...c.crops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `\n  ${k}: ${Math.round(v)} kg`).join('');
    t.append(col);
  });
  r.append(l, t);
  return r;
}

// plants to transplant a week, one line per zone and the farm's total pinned on top:
// from our nursery (green) or ordered from a nursery (blue); proposals lighter
export function plantsRow(label, weeks, sysId, from, px, total) {
  const none = { tp: 0, tpP: 0, ord: 0, ordP: 0, sow: 0, sowP: 0, ext: 0, tpCrops: new Map() };
  const cells = weeks.map(([m, w]) => [m, sysId ? (w.bySys.get(sysId) || none) : w.all]);
  const sum = c => c.tp + c.tpP + c.ord + c.ordP;
  const max = Math.max(1, ...cells.map(([, c]) => sum(c)));
  const r = el('div', 'tl-row tl-sum tl-plants' + (total ? ' total' : ''));
  const l = el('div', 'tl-label');
  const all = cells.reduce((a, [, c]) => a + sum(c), 0), ord = cells.reduce((a, [, c]) => a + c.ord + c.ordP, 0);
  l.append(el('b', null, label), el('span', 'hint', ` ${fmtN(all)}` + (ord ? ` · ${fmtN(ord)} ordered` : '')));
  l.title = `${label}: plants to transplant a week — from our nursery (green) or ordered from a nursery (blue); ` +
    `lighter = only proposed. In the window: ${all.toLocaleString()} plants, ${ord.toLocaleString()} of them ordered.`;
  const t = el('div', 'tl-track');
  const H = total ? 22 : 18;
  cells.forEach(([m, c]) => {
    const x = (m - from) * px, width = 7 * px - 2;
    const col = el('div', 'tl-wk'); col.style.left = x + 'px'; col.style.width = width + 'px';
    let bottom = 0;
    [[c.tp, 'sow'], [c.tpP, 'sow-p'], [c.ord, 'ext'], [c.ordP, 'ext-p']].forEach(([v, cls]) => {
      if (!v) return;
      const p = el('span', 'tl-wk-part ' + cls);
      const h = H * v / max;
      p.style.height = h + 'px'; p.style.bottom = bottom + 'px'; p.style.width = width + 'px';
      bottom += h; col.append(p);
    });
    const n = sum(c);
    if (n && width >= 26) col.append(el('span', 'tl-wk-n', fmtN(n)));
    col.title = `Week of ${nice(ds(m))}` + (sysId ? '' : ' · all zones') + `: ${n.toLocaleString()} plants to transplant` +
      (c.tp ? `\nfrom our nursery: ${c.tp.toLocaleString()}` : '') + (c.tpP ? `\nfrom our nursery, proposed: ${c.tpP.toLocaleString()}` : '') +
      (c.ord ? `\nordered from a nursery: ${c.ord.toLocaleString()}` : '') + (c.ordP ? `\nto order, proposed: ${c.ordP.toLocaleString()}` : '') +
      [...c.tpCrops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `\n  ${k}: ${v.toLocaleString()}`).join('') +
      (!sysId && (c.sow + c.sowP) ? `\nto sow in our nursery this week: ${(c.sow + c.sowP).toLocaleString()}` : '') +
      (!sysId && c.ext ? `\nseedlings arriving this week: ${c.ext.toLocaleString()}` : '');
    t.append(col);
  });
  r.append(l, t);
  return r;
}
