// ═══════════════════════════════════════════════════════════════════════════
// Dashboard › Yield (migration 0133, console 0.7.145)
//
// Planned against harvested, week by week, per crop and per zone; waste; kg per
// m² of the batches that finished; the finished batches from best to worst
// against what they were expected to give. "Planned so far" is the plan up to
// today, the fair thing to compare the scale with.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast } from './api.js';
import { loading, el, pageHead, cropAvatar, pref } from './ui.js';

const PERIODS = [['28', '4 weeks'], ['91', '3 months'], ['182', '6 months'], ['365', 'A year']];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const kg = n => `${Math.round(Number(n || 0)).toLocaleString()} kg`;
const nice = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
const pctOf = (a, b) => Number(b) > 0 ? Math.round(100 * Number(a) / Number(b)) : null;

export function yieldRange() {
  const days = Number(pref.get('fbc_yield_period')) || 91;
  const t = new Date();
  return { p_from: ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - days + 1)), p_to: ymd(t) };
}

export async function renderYield(mount, farm) {
  const here = mount;
  await openFast([['yield_dashboard', { p_farm: farm.id, ...yieldRange() }]], {
    show: ([d]) => paint(mount, farm, d),
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the harvests…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected,
  });
}

function paint(mount, farm, d) {
  mount.textContent = '';
  const seg = el('div', 'seg');
  const cur = pref.get('fbc_yield_period') || '91';
  PERIODS.forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label); b.setAttribute('aria-pressed', String(v === cur));
    b.onclick = () => { pref.set('fbc_yield_period', v); renderYield(mount, farm); };
    seg.append(b);
  });
  mount.append(pageHead(null, 'What was harvested against what the plan expected, week by week, per crop and per zone — with the waste, the kilograms per m² ' +
    'of the batches that finished, and those batches from best to worst.', seg));
  const t = d.totals || {};
  const tiles = el('div', 'tiles yd-tiles');
  const tile = (v, l, s, tone) => { const x = el('div', 'tile' + (tone ? ' ' + tone : '')); const b = el('div', 'tile-body'); b.append(el('div', 'tile-value', v), el('div', 'tile-label', l)); if (s) b.append(el('div', 'tile-sub', s)); x.append(b); return x; };
  const p = pctOf(t.harvested, t.planned_to_date);
  tiles.append(tile(kg(t.harvested), 'Harvested', `${t.cuts || 0} cuts`),
               tile(kg(t.planned_to_date), 'Planned so far', `${kg(t.planned)} over the whole period`),
               tile(p == null ? '—' : `${p}%`, 'Of plan so far', null, p != null && p < 80 ? 'bad' : ''),
               tile(Number(t.harvested) ? `${Math.round(100 * Number(t.waste || 0) / (Number(t.harvested) + Number(t.waste || 0)))}%` : '—', 'Waste', kg(t.waste)),
               tile(t.kg_m2 == null ? '—' : `${Number(t.kg_m2).toFixed(1)}`, 'kg per m²', `${t.batches_finished || 0} finished batches`));
  mount.append(tiles);

  // week by week: two bars, planned (outline) and harvested (solid), waste on top of harvested
  const weeks = d.weeks || [];
  const card = el('div', 'card card-pad');
  card.append(el('div', 'sec-title', 'Week by week'));
  const max = Math.max(1, ...weeks.map(w => Math.max(Number(w.planned), Number(w.harvested) + Number(w.waste))));
  const chart = el('div', 'yd-chart');
  weeks.forEach(w => {
    const col = el('div', 'yd-col' + (w.w > d.today ? ' ahead' : ''));
    const bars = el('div', 'yd-bars');
    const pb = el('i', 'plan'); pb.style.height = (100 * w.planned / max) + '%';
    const hb = el('i', 'harv'); hb.style.height = (100 * w.harvested / max) + '%';
    const wb = el('i', 'waste'); wb.style.height = (100 * w.waste / max) + '%';
    const stack = el('span', 'yd-stack'); stack.append(wb, hb);
    bars.append(pb, stack);
    col.append(bars, el('span', 'yd-lbl', nice(w.w)));
    col.title = `Week of ${nice(w.w)} · planned ${kg(w.planned)} · harvested ${kg(w.harvested)}${Number(w.waste) ? ` · waste ${kg(w.waste)}` : ''}`;
    chart.append(col);
  });
  card.append(chart, el('div', 'hint', 'Outline: planned · green: harvested · red: waste.'));
  mount.append(card);

  const grid = el('div', 'yd-grid');
  const table = (title, rows, nameOf) => {
    const c = el('div', 'card card-pad');
    c.append(el('div', 'sec-title', title));
    if (!rows.length) { c.append(el('div', 'hint', 'Nothing in this period.')); return c; }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th></th><th class="num">Planned so far</th><th class="num">Harvested</th><th>Of plan</th><th class="num">kg/m²</th><th class="num">Waste</th></tr></thead>';
    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      const n = el('td', 'yd-name'); n.append(...nameOf(r));
      const p = pctOf(r.harvested, r.planned_to_date);
      const bar = el('td'); const b = el('div', 'yd-bar'); const f = el('i'); f.style.width = Math.min(100, p || 0) + '%';
      if (p != null && p < 80) b.classList.add('short');
      b.append(f); bar.append(b, el('span', 'hint', p == null ? '—' : `${p}%`));
      tr.append(n, el('td', 'num', kg(r.planned_to_date)), el('td', 'num', kg(r.harvested)), bar,
                el('td', 'num', r.kg_m2 == null ? '—' : Number(r.kg_m2).toFixed(1)), el('td', 'num', Number(r.waste) ? kg(r.waste) : '—'));
      tb.append(tr);
    });
    t.append(tb); c.append(t);
    return c;
  };
  grid.append(table('Per crop', d.crops || [], r => [cropAvatar({ name: r.crop, category: r.category, photo_url: r.photo_url }, 'xs'), el('span', null, r.crop)]),
              table('Per zone', d.zones || [], r => [el('span', null, r.zone)]));
  mount.append(grid);

  const fin = d.finished || [];
  if (fin.length) {
    const c = el('div', 'card card-pad');
    c.append(el('div', 'sec-title', `Finished batches · ${fin.length} · best and worst against plan`));
    const show = fin.length <= 20 ? fin : [...fin.slice(0, 10), null, ...fin.slice(-10)];
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th></th><th>Crop</th><th>Where</th><th class="num">Harvested</th><th class="num">Expected</th><th class="num">Of plan</th><th class="num">kg/m²</th><th>Last cut</th></tr></thead>';
    const tb = el('tbody');
    show.forEach(r => {
      if (!r) { const tr = el('tr'); const td = el('td', 'hint', '…'); td.colSpan = 8; tr.append(td); tb.append(tr); return; }
      const tr = el('tr');
      const av = el('td'); av.append(cropAvatar({ name: r.crop, category: r.category, photo_url: r.photo_url }, 'xs'));
      tr.append(av, el('td', null, r.crop), el('td', 'hint', [r.zone, r.system, r.position].filter(Boolean).join(' · ')),
                el('td', 'num', kg(r.kg)), el('td', 'num', kg(r.expected)),
                el('td', 'num ' + (r.pct != null && r.pct < 80 ? 'warn' : ''), r.pct == null ? '—' : `${r.pct}%`),
                el('td', 'num', r.kg_m2 == null ? '—' : Number(r.kg_m2).toFixed(1)), el('td', 'hint', nice(r.last_cut)));
      tb.append(tr);
    });
    t.append(tb); c.append(t);
    mount.append(c);
  }
}
