// ═══════════════════════════════════════════════════════════════════════════
// The sump in the scouting report (console 0.7.187, migration 0190, owner 2 Oct 2026:
// "in the top right of plant health add a new small block (over the traps) with sump
// data (EC, pH, temp) with a graph over time … and clicking for more detailed analysis").
//
//   sumpBlock(farm, z, day) — the block above Insects a day: the sump that feeds the
//     zone and what else it feeds, then EC, pH and temperature as three small lines on
//     one time axis (they do not share a scale: EC is about 2, pH about 6, the water
//     about 20), each with its watch band and its last figure coloured. A click opens
//   openSump(farm, opts) — the window: 30 · 90 · 365 days, the other sumps, the three
//     curves large, what each did (last, lowest to highest, average, how many outside
//     the band) and every reading with who and when. A manager can type a reading in.
// The readings are the daily sump check's (filed by the database) and, before it, the
// paper tracker's. Nothing here sets a limit: they are the unit's own, in Connections.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, num, drawer, toast, busy, input, field } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const METRICS = [
  { key: 'ec', label: 'EC', unit: 'mS/cm', dp: 2 },
  { key: 'ph', label: 'pH', unit: '', dp: 2 },
  { key: 'water_temp', label: 'Water', unit: '°C', dp: 1 },
];
const parse = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const shortDay = s => parse(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const hhmm = ts => new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
const mk = (tag, at, parent) => { const n = document.createElementNS(SVG_NS, tag); Object.entries(at).forEach(([k, v]) => n.setAttribute(k, v)); parent?.append(n); return n; };

// outside the alarm limits = bad, outside the watch band = warn
export function toneOf(v, lim = {}) {
  if (v == null) return '';
  const n = Number(v), f = x => x == null ? null : Number(x);
  if ((f(lim.low_alarm) != null && n <= f(lim.low_alarm)) || (f(lim.high_alarm) != null && n >= f(lim.high_alarm))) return 'bad';
  if ((f(lim.low_watch) != null && n < f(lim.low_watch)) || (f(lim.high_watch) != null && n > f(lim.high_watch))) return 'warn';
  return 'ok';
}
const feedsText = s => (s?.feeds || []).length ? 'feeds ' + s.feeds.join(', ') : 'feeds no zone';

// one metric over the window: the watch band, the line, a dot per reading
function curve(h, m, big = false) {
  const lim = h.limits?.[m.key] || {};
  const pts = (h.readings || []).filter(r => r[m.key] != null).map(r => ({ t: new Date(r.at).getTime(), v: Number(r[m.key]), r }));
  const W = big ? 300 : 220, H = big ? 96 : 54, L = big ? 26 : 2, R = 4, T = 6, B = big ? 14 : 5;   // the small ones taller since 0.7.189
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sp-curve' + (big ? ' big' : ''), role: 'img' });
  svg.setAttribute('aria-label', `${m.label}: ${pts.length} reading${pts.length === 1 ? '' : 's'}, ${shortDay(h.from)} to ${shortDay(h.day)}`);
  if (!pts.length) return svg;
  const t0 = parse(h.from).getTime() - 432e5, t1 = parse(h.day).getTime() + 432e5;
  const lo = lim.low_watch != null ? Number(lim.low_watch) : null, hi = lim.high_watch != null ? Number(lim.high_watch) : null;
  const vs = pts.map(p => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  // the band is on the picture when the readings come near it; a flat run still gets some height
  if (lo != null && min < lo + (hi ?? lo) * 0.25) min = Math.min(min, lo);
  if (hi != null && max > hi - (hi ?? 1) * 0.25) max = Math.max(max, hi);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.02, 0.05); min -= pad; max += pad;
  const x = t => L + (t - t0) * (W - L - R) / Math.max(1, t1 - t0), y = v => H - B - (v - min) * (H - T - B) / (max - min);
  const cl = v => Math.max(T, Math.min(H - B, y(v)));
  if (lo != null || hi != null) {
    const top = hi != null ? cl(hi) : T, bot = lo != null ? cl(lo) : H - B;
    if (bot > top) mk('rect', { x: L, y: top, width: W - L - R, height: bot - top, class: 'sp-band' }, svg);
  }
  if (big) {
    mk('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'pd-axis' }, svg);
    [[min + pad, 'end'], [max - pad, 'end']].forEach(([v]) => { const t = mk('text', { x: L - 3, y: y(v) + 3, class: 'pd-ax-t', 'text-anchor': 'end' }, svg); t.textContent = num(v, m.dp > 1 ? 1 : 0); });
    [[t0 + 432e5, 'start'], [t1 - 432e5, 'end']].forEach(([t, a]) => { const tx = mk('text', { x: x(t), y: H - 3, class: 'pd-ax-t', 'text-anchor': a }, svg); tx.textContent = new Date(t).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); });
  }
  if (pts.length > 1) mk('polyline', { points: pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: 'sp-line' }, svg);
  pts.forEach((p, i) => {
    const last = i === pts.length - 1, tone = toneOf(p.v, lim);
    if (!big && !last && tone === 'ok') return;                       // small: the line, the readings outside the band, the last one
    const c = mk('circle', { cx: x(p.t), cy: y(p.v), r: last ? 3 : big ? 1.8 : 2, class: 'sp-pt ' + tone }, svg);
    const tt = mk('title', {}, c); tt.textContent = `${shortDay(p.r.day)} ${hhmm(p.r.at)}: ${m.label} ${num(p.v, m.dp)}${m.unit ? ' ' + m.unit : ''}`;
  });
  return svg;
}

const lastOf = (h, key) => [...(h.readings || [])].reverse().find(r => r[key] != null) || null;

function paintBlock(box, farm, h) {
  box.textContent = '';
  const s = h.sump;
  const head = el('div', 'sp-head');
  head.append(el('span', 'pd-hlabel', s ? s.name : 'Sump'), el('span', 'hint', s ? feedsText(s) : ''));
  // the water temperature is a figure in the head, not a curve (0.7.191, owner 2 Oct 2026: "remove the temperature graph
  // but just a today value on the top with an arrow indicating the trend"): the last reading, coloured against its band,
  // and an arrow against the reading before; the curve is in the window the block opens
  const temps = (h.readings || []).filter(r => r.water_temp != null);
  if (s && temps.length) {
    const t = temps[temps.length - 1], b = temps[temps.length - 2] || null;
    const diff = b ? Number(t.water_temp) - Number(b.water_temp) : 0;
    const arrow = !b ? '' : diff > 0.3 ? '▲' : diff < -0.3 ? '▼' : '–';
    const chip = el('span', 'sp-temp ' + toneOf(t.water_temp, h.limits?.water_temp));
    chip.append(el('span', 'hint', String(t.day) === String(h.day) ? 'Water today' : `Water ${shortDay(t.day)}`), el('b', null, `${num(t.water_temp, 1)} °C`));
    if (arrow) chip.append(el('span', 'sp-arrow', arrow));
    chip.title = `Water ${num(t.water_temp, 1)} °C on ${shortDay(t.day)} ${hhmm(t.at)}` + (b ? ` — ${num(b.water_temp, 1)} °C on ${shortDay(b.day)} (${diff >= 0 ? '+' : '−'}${num(Math.abs(diff), 1)})` : ' — the first reading') + '. Click for the curve.';
    head.append(el('span', 'spacer'), chip);
  }
  box.append(head);
  if (!s) { box.append(el('div', 'hint', 'No sump is set for this zone.')); return; }
  if (!(h.readings || []).length) {
    box.append(el('div', 'hint', 'No EC, pH or temperature in these 30 days. The daily sump check files them here.'));
  } else {
    METRICS.filter(m => m.key !== 'water_temp').forEach(m => {
      const last = lastOf(h, m.key);
      const row = el('div', 'sp-row');
      const fig = el('div', 'sp-fig ' + (last ? toneOf(last[m.key], h.limits?.[m.key]) : ''));
      fig.append(el('span', 'sp-name', m.label), el('b', null, last ? num(last[m.key], m.dp) : '—'));
      if (m.unit) fig.append(el('span', 'hint', m.unit));
      if (last) fig.title = `${m.label} ${num(last[m.key], m.dp)} ${m.unit} · ${shortDay(last.day)} ${hhmm(last.at)}`;
      row.append(fig, curve(h, m));
      box.append(row);
    });
    const newest = h.readings[h.readings.length - 1];
    const foot = el('div', 'sp-foot hint');
    foot.append(el('span', null, shortDay(h.from)), el('span', null, `last read ${shortDay(newest.day)} ${hhmm(newest.at)}`), el('span', null, shortDay(h.day)));
    box.append(foot);
  }
  box.classList.add('sp-click');
  box.title = 'Open the sump: every reading, 30 to 365 days';
  box.tabIndex = 0; box.setAttribute('role', 'button');
  const open = () => openSump(farm, { sump: s.id, day: h.day });
  box.onclick = open;
  box.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
}

// the block; .load() reads it once, when its zone band opens; a zone and day already read are not asked again when the
// page repaints (0.7.188). `call` is the page's own way of asking (three at a time, asked again when cancelled).
const blockReads = new Map();
export function sumpBlock(farm, z, day, call = rpc) {
  const box = el('div', 'pd-sump');
  box.append(el('div', 'hint', 'Reading the sump…'));
  box.load = async () => {
    if (box.dataset.loaded) return;
    box.dataset.loaded = '1';
    try {
      const key = [farm.id, z.zone_id, z.system_id || '', day.day].join('|');
      if (!blockReads.has(key)) {
        if (blockReads.size > 60) blockReads.clear();
        const p = call('sump_history', { p_farm: farm.id, p_zone: z.zone_id, p_system: z.system_id || null, p_day: day.day, p_days: 30, p_sump: null });
        blockReads.set(key, p); p.catch(() => blockReads.delete(key));
      }
      paintBlock(box, farm, await blockReads.get(key));
    } catch (e) {
      // a database from before 0190 has no sump history: the block says so and stays out of the way
      box.textContent = ''; box.append(el('div', 'pd-hlabel', 'Sump'), el('div', 'hint', /sump_history/.test(e.message) ? 'Not available on this database yet.' : e.message));
      delete box.dataset.loaded;
    }
  };
  return box;
}

// the window
export function openSump(farm, { sump, day = null } = {}) {
  let days = 30, cur = sump, h = null;
  const d = drawer('Sump', 'EC, pH and water temperature over time');
  d.box.classList.add('sump-drawer');
  const body = d.body;
  const read = async () => {
    body.textContent = ''; body.append(el('div', 'hint', 'Reading…'));
    try { h = await rpc('sump_history', { p_farm: farm.id, p_zone: null, p_system: null, p_day: day, p_days: days, p_sump: cur }); paint(); }
    catch (e) { body.textContent = ''; body.append(el('div', 'note bad', e.message)); }
  };
  const paint = () => {
    body.textContent = '';
    d.box.querySelector('header h2').textContent = h.sump?.name || 'Sump';
    const sub = d.box.querySelector('header .hint'); if (sub) sub.textContent = `${feedsText(h.sump)} · ${shortDay(h.from)} to ${shortDay(h.day)}`;
    const bar = el('div', 'sp-bar');
    (h.sumps || []).forEach(s => { const b = el('button', 'pd-cropchip' + (s.id === cur ? ' on' : ''), s.name); b.onclick = () => { cur = s.id; read(); }; bar.append(b); });
    bar.append(el('span', 'spacer'));
    [30, 90, 365].forEach(n => { const b = el('button', 'pd-cropchip' + (n === days ? ' on' : ''), `${n} days`); b.onclick = () => { days = n; read(); }; bar.append(b); });
    body.append(bar);
    const rows = h.readings || [];
    if (!rows.length) body.append(el('div', 'empty', 'No reading in this period.'));
    METRICS.forEach(m => {
      const vals = rows.filter(r => r[m.key] != null).map(r => Number(r[m.key]));
      if (!vals.length) { if (rows.length) body.append(el('div', 'hint sp-none', `${m.label}: not measured in this period.`)); return; }
      const lim = h.limits?.[m.key] || {}, last = lastOf(h, m.key);
      const out = vals.filter(v => toneOf(v, lim) !== 'ok').length;
      const card = el('div', 'sp-card');
      const head = el('div', 'sp-fig big ' + toneOf(last[m.key], lim));
      head.append(el('span', 'sp-name', m.label), el('b', null, num(last[m.key], m.dp)), el('span', 'hint', m.unit));
      head.append(el('span', 'spacer'));
      head.append(el('span', 'hint', `${num(Math.min(...vals), m.dp)} to ${num(Math.max(...vals), m.dp)} · average ${num(vals.reduce((a, b) => a + b, 0) / vals.length, m.dp)} · ${vals.length} reading${vals.length === 1 ? '' : 's'}`));
      if (out) head.append(el('span', 'pill warn', `${out} outside the band`));
      card.append(head, curve(h, m, true));
      if (lim.low_watch != null || lim.high_watch != null)
        card.append(el('div', 'hint', `Band ${lim.low_watch ?? '…'} to ${lim.high_watch ?? '…'}${m.unit ? ' ' + m.unit : ''}; alarm under ${lim.low_alarm ?? '…'} or over ${lim.high_alarm ?? '…'}${lim.own ? '' : ' (the standard limits)'}.`));
      body.append(card);
    });
    if (rows.length) {
      const tbl = el('table', 'sp-table');
      const hr = el('tr'); ['When', 'EC', 'pH', '°C', 'From', ''].forEach(t => hr.append(el('th', null, t)));
      tbl.append(hr);
      [...rows].reverse().forEach(r => {
        const tr = el('tr');
        tr.append(el('td', null, `${shortDay(r.day)} ${hhmm(r.at)}`));
        METRICS.forEach(m => tr.append(el('td', 'num ' + toneOf(r[m.key], h.limits?.[m.key]), r[m.key] == null ? '—' : num(r[m.key], m.dp))));
        tr.append(el('td', 'hint', r.source === 'checklist' ? (r.by || 'Sump check') : r.source === 'import' ? `Paper tracker${r.slot ? ' · ' + r.slot.toLowerCase() : ''}` : r.source === 'sensor' ? 'Sensor' : (r.note || 'Typed in')));
        const last = el('td');
        if (h.may_write && r.source !== 'checklist') {
          const x = el('button', 'btn btn-ghost btn-sm', '✕'); x.title = 'Take this reading out';
          x.onclick = async () => { try { await rpc('save_sump_reading', { p: { sump_id: h.sump.id, id: r.id, remove: true } }); read(); } catch (e) { toast(e.message, 'bad'); } };
          last.append(x);
        }
        tr.append(last);
        tbl.append(tr);
      });
      body.append(el('div', 'pd-hlabel', 'Every reading'), tbl);
    }
    d.footer.textContent = '';
    if (h.may_write && h.sump) {
      const at = input({ type: 'datetime-local' }), ec = input({ type: 'number', step: '0.01', min: '0', max: '10', placeholder: 'EC' }),
            ph = input({ type: 'number', step: '0.01', min: '0', max: '14', placeholder: 'pH' }), tc = input({ type: 'number', step: '0.1', min: '0', max: '50', placeholder: '°C' });
      const form = el('div', 'sp-form');
      form.append(field('When (empty = now)', at), field('EC', ec), field('pH', ph), field('°C', tc));
      const add = el('button', 'btn btn-primary', 'Add a reading');
      add.onclick = async () => {
        if (!ec.value && !ph.value && !tc.value) { toast('Type at least one of EC, pH, temperature', 'bad'); return; }
        busy(add, true, 'Saving…');
        try {
          await rpc('save_sump_reading', { p: { sump_id: h.sump.id, at: at.value ? new Date(at.value).toISOString() : null, ec: ec.value, ph: ph.value, water_temp: tc.value } });
          toast('Reading saved'); read();
        } catch (e) { busy(add, false, 'Add a reading'); toast(e.message, 'bad'); }
      };
      d.footer.append(form, add);
    }
  };
  read();
}
