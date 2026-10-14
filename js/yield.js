// ═══════════════════════════════════════════════════════════════════════════
// Dashboard › Yield (migration 0133, console 0.7.145; one crop at a time and the
// year's course, migration 0235)
//
// Planned against harvested, week by week, per crop and per zone; waste; kg per
// m² of the batches that finished; the finished batches from best to worst
// against what they were expected to give. "Planned so far" is the plan up to
// today, the fair thing to compare the scale with.
//
// A row of crops under the head picks one crop, or all of them (owner 14 Oct
// 2026: "a crop selector/filter (easy to use) and a projected kg/sm per year").
// "A year" is what a batch gave per m² over the days it has held its place —
// from its transplant to its last cut — scaled to 365 days, so the weeks before
// the first cut count too. The batches still being picked have a table of their
// own: before, a crop in production was in no table until its last cut.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast } from './api.js';
import { loading, el, pageHead, cropAvatar, pref, farmDate } from './ui.js';

const PERIODS = [['28', '4 weeks'], ['91', '3 months'], ['182', '6 months'], ['365', 'A year']];
const CROP_KEY = 'fbc_yield_crop';
const UNIT_KEY = 'fbc_yield_unit';                  // the chart in kg or in kg/m² a year
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const kg = n => `${Math.round(Number(n || 0)).toLocaleString()} kg`;
const nice = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
const pctOf = (a, b) => Number(b) > 0 ? Math.round(100 * Number(a) / Number(b)) : null;
const perM2 = v => v == null ? '—' : Number(v).toFixed(1);
const fmt1 = v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
// a round top for the scale: 1, 2 or 5 times a power of ten, at least the highest bar
const niceMax = v => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map(f => f * p).find(x => x >= v); };
const YEAR_HINT = 'What it gave per m² from its transplant to its last cut, scaled to a year: the weeks before the first cut count too.';

export function yieldRange() {
  const days = Number(pref.get('fbc_yield_period')) || 91;
  const t = farmDate();
  return { p_from: ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - days + 1)), p_to: ymd(t) };
}

export async function renderYield(mount, farm) {
  const here = mount;
  const crop = pref.get(CROP_KEY) || null;
  await openFast([['yield_dashboard', { p_farm: farm.id, ...yieldRange(), ...(crop ? { p_crop: crop } : {}) }]], {
    show: ([d]) => {
      // a crop kept from another period or FarmBox that has nothing here: back to all of them, read again
      if (crop && !(d.crops || []).some(c => c.crop_id === crop)) { pref.set(CROP_KEY, ''); renderYield(mount, farm); return; }
      paint(mount, farm, d);
    },
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
  mount.append(pageHead(null, 'Harvested against the plan, up to today.', seg));

  // the crops of the period, one button each, the biggest first; "All crops" in front
  const crops = d.crops || [];
  const picked = d.crop || null;
  const chosen = crops.find(c => c.crop_id === picked) || null;
  if (crops.length) {
    const row = el('div', 'yd-crops');
    row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Which crop');
    const pick = id => { pref.set(CROP_KEY, id || ''); renderYield(mount, farm); };
    const all = el('button', 'yd-crop', 'All crops'); all.type = 'button';
    all.setAttribute('aria-pressed', String(!picked)); all.onclick = () => { if (picked) pick(null); };
    row.append(all);
    crops.forEach(c => {
      const b = el('button', 'yd-crop'); b.type = 'button';
      b.append(cropAvatar({ name: c.crop, category: c.category, photo_url: c.photo_url }, 'xs'), el('span', null, c.crop),
               el('span', 'yd-crop-kg', kg(c.harvested)));
      b.title = `${c.crop}: ${kg(c.harvested)} harvested in the period` + (c.projected_kg_m2_year != null ? ` · on course for ${perM2(c.projected_kg_m2_year)} kg/m² a year` : '');
      b.setAttribute('aria-pressed', String(c.crop_id === picked));
      b.onclick = () => { if (c.crop_id !== picked) pick(c.crop_id); };
      row.append(b);
    });
    mount.append(row);
  }

  const t = d.totals || {};
  const tiles = el('div', 'tiles yd-tiles');
  const tile = (v, l, s, tone, title) => { const x = el('div', 'tile' + (tone ? ' ' + tone : '')); const b = el('div', 'tile-body'); b.append(el('div', 'tile-value', v), el('div', 'tile-label', l)); if (s) b.append(el('div', 'tile-sub', s)); if (title) x.title = title; x.append(b); return x; };
  const p = pctOf(t.harvested, t.planned_to_date);
  tiles.append(tile(kg(t.harvested), chosen ? `${chosen.crop} harvested` : 'Harvested', `${t.cuts || 0} cut${Number(t.cuts) === 1 ? '' : 's'}`),
               tile(t.projected_kg_m2_year == null ? '—' : perM2(t.projected_kg_m2_year), 'kg per m² a year, on course',
                    t.batches_running ? `${t.batches_running} batch${t.batches_running === 1 ? '' : 'es'} still picking` : 'from the batches cut in the period',
                    '', YEAR_HINT),
               tile(kg(t.planned_to_date), 'Planned so far', `${kg(t.planned)} over the whole period`),
               tile(p == null ? '—' : `${p}%`, 'Of plan so far', null, p != null && p < 80 ? 'bad' : ''),
               tile(Number(t.harvested) ? `${Math.round(100 * Number(t.waste || 0) / (Number(t.harvested) + Number(t.waste || 0)))}%` : '—', 'Waste', kg(t.waste)),
               tile(t.kg_m2 == null ? '—' : `${Number(t.kg_m2).toFixed(1)}`, 'kg per m²', `${t.batches_finished || 0} finished batches`));
  mount.append(tiles);

  // the chart: its step follows the period (a week up to three months, two weeks up to six, a month for a year), and it
  // shows either the kilograms of each step or the course for a year reckoned up to each step's end (0.7.256, owner:
  // "3 months by week, 6 months by 2 weeks, 12 months by months … change the y unit from total kg or projected yield")
  const steps = d.buckets || (d.weeks || []).map(w => ({ from: w.w, to: w.w, planned: w.planned, harvested: w.harvested, waste: w.waste }));
  const step = d.step || 'week';
  const unit = pref.get(UNIT_KEY) === 'year' ? 'year' : 'kg';
  const card = el('div', 'card card-pad');
  const head = el('div', 'yd-chart-head');
  const STEP_TITLE = { week: 'Week by week', '2weeks': 'Every two weeks', month: 'Month by month' };
  head.append(el('div', 'sec-title', (STEP_TITLE[step] || 'Week by week') + (chosen ? ` · ${chosen.crop}` : '')), el('div', 'spacer'));
  const useg = el('div', 'seg');
  [['kg', 'kg harvested'], ['year', 'kg/m² a year']].forEach(([v, label]) => {
    const btn = el('button', 'seg-btn', label); btn.type = 'button'; btn.setAttribute('aria-pressed', String(v === unit));
    btn.onclick = () => { if (v !== unit) { pref.set(UNIT_KEY, v); paint(mount, farm, d); } };
    useg.append(btn);
  });
  head.append(useg);
  card.append(head);

  // a month is named by its name, with its year on the first one and on January (a year's view shows the same month twice)
  const stepLabel = (s, i) => {
    if (step !== 'month') return nice(s.from);
    const dt = new Date(String(s.from).slice(0, 10) + 'T12:00:00');
    return dt.toLocaleDateString(undefined, i === 0 || dt.getMonth() === 0 ? { month: 'short', year: '2-digit' } : { month: 'short' });
  };
  const span = s => step === 'month'
    ? new Date(String(s.from).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : s.from === s.to ? `week of ${nice(s.from)}` : `${nice(s.from)} – ${nice(s.to)}`;
  const val = s => unit === 'year' ? (s.projected_kg_m2_year == null ? null : Number(s.projected_kg_m2_year))
                                   : Math.max(Number(s.planned || 0), Number(s.harvested || 0) + Number(s.waste || 0));
  const top = Math.max(...steps.map(val).filter(v => v != null), 0);
  const max = niceMax(top);
  const plot = el('div', 'yd-plot');
  const axis = el('div', 'yd-axis');
  [max, max / 2, 0].forEach(v => axis.append(el('span', null, fmt1(v))));
  const chart = el('div', 'yd-chart');
  const lines = el('div', 'yd-gridlines'); lines.append(el('i'), el('i'), el('i'));
  chart.append(lines);
  steps.forEach((s, i) => {
    const col = el('div', 'yd-col' + (String(s.from) > String(d.today) ? ' ahead' : ''));
    const bars = el('div', 'yd-bars');
    if (unit === 'year') {
      const v = val(s);
      const yb = el('i', 'year'); yb.style.height = (v == null ? 0 : 100 * v / max) + '%';
      bars.append(yb);
      if (v != null && steps.length <= 16) yb.append(el('span', 'yd-val', fmt1(v)));   // the figure on top of its bar
      col.title = `${span(s)} · ${v == null ? 'nothing planted yet' : `on course for ${fmt1(v)} kg/m² a year`} · ${kg(s.harvested)} harvested in it`;
    } else {
      const pb = el('i', 'plan'); pb.style.height = (100 * s.planned / max) + '%';
      const hb = el('i', 'harv'); hb.style.height = (100 * s.harvested / max) + '%';
      const wb = el('i', 'waste'); wb.style.height = (100 * s.waste / max) + '%';
      const stack = el('span', 'yd-stack'); stack.append(wb, hb);
      bars.append(pb, stack);
      col.title = `${span(s)} · planned ${kg(s.planned)} · harvested ${kg(s.harvested)}${Number(s.waste) ? ` · waste ${kg(s.waste)}` : ''}`;
    }
    col.append(bars, el('span', 'yd-lbl', stepLabel(s, i)));
    chart.append(col);
  });
  plot.append(axis, chart);
  // nothing to draw (a unit with no harvest in the period): say so instead of an empty frame with a scale of 0 to 1
  if (!(top > 0)) { card.append(el('div', 'hint', unit === 'year' ? 'No batch with a harvest in this period: nothing to project yet.' : 'Nothing harvested or planned in this period.')); mount.append(card); }
  else card.append(plot, el('div', 'hint', unit === 'year'
    ? 'kg per m² a year, reckoned up to the end of each step: everything harvested since each batch took its place, over the time it has held it — the months before the first cut and the days since the last one count too, so the line starts low and climbs as the picking comes.'
    : `kg ${step === 'month' ? 'per month' : step === '2weeks' ? 'per two weeks' : 'per week'}. Outline: planned · green: harvested · red: waste.`));
  if (top > 0) mount.append(card);

  // the batches still being picked: what each gave so far and its course for the year
  const running = d.running || [];
  if (running.length) {
    const c = el('div', 'card card-pad');
    c.append(el('div', 'sec-title', `In production · ${running.length}`));
    const tb = el('table', 'table');
    tb.innerHTML = '<thead><tr><th></th><th>Crop</th><th>Where</th><th>In since</th><th>First cut</th><th class="num">Cuts</th><th class="num">So far</th><th class="num">Last 4 weeks</th><th class="num">kg/m² so far</th><th class="num">kg/m² a year</th></tr></thead>';
    const body = el('tbody');
    running.forEach(r => {
      const tr = el('tr');
      const av = el('td'); av.append(cropAvatar({ name: r.crop, category: r.category, photo_url: r.photo_url }, 'xs'));
      const year = el('td', 'num yd-year', perM2(r.projected_kg_m2_year)); year.title = YEAR_HINT;
      tr.append(av, el('td', null, r.crop), el('td', 'hint', [r.zone, r.system !== r.zone ? r.system : null, r.position].filter(Boolean).join(' · ') + (r.m2 ? ` · ${Number(r.m2).toLocaleString()} m²` : '')),
                el('td', 'hint', nice(r.started)), el('td', 'hint', nice(r.first_cut)), el('td', 'num', String(r.cuts || 0)),
                el('td', 'num', kg(r.kg)), el('td', 'num', kg(r.kg_28)), el('td', 'num', perM2(r.kg_m2)), year);
      body.append(tr);
    });
    tb.append(body);
    const wrap = el('div', 'yd-scroll'); wrap.append(tb);
    c.append(wrap, el('div', 'hint', 'kg/m² a year: ' + YEAR_HINT.charAt(0).toLowerCase() + YEAR_HINT.slice(1)));
    mount.append(c);
  }

  const grid = el('div', 'yd-grid');
  const table = (title, rows, nameOf) => {
    const c = el('div', 'card card-pad');
    c.append(el('div', 'sec-title', title));
    if (!rows.length) { c.append(el('div', 'hint', 'Nothing in this period.')); return c; }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th></th><th class="num">Planned so far</th><th class="num">Harvested</th><th>Of plan</th><th class="num">kg/m²</th><th class="num">kg/m² a year</th><th class="num">Waste</th></tr></thead>';
    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      const n = el('td', 'yd-name'); n.append(...nameOf(r));
      const p = pctOf(r.harvested, r.planned_to_date);
      const bar = el('td'); const b = el('div', 'yd-bar'); const f = el('i'); f.style.width = Math.min(100, p || 0) + '%';
      if (p != null && p < 80) b.classList.add('short');
      b.append(f); bar.append(b, el('span', 'hint', p == null ? '—' : `${p}%`));
      const year = el('td', 'num', perM2(r.projected_kg_m2_year)); year.title = YEAR_HINT;
      tr.append(n, el('td', 'num', kg(r.planned_to_date)), el('td', 'num', kg(r.harvested)), bar,
                el('td', 'num', r.kg_m2 == null ? '—' : Number(r.kg_m2).toFixed(1)), year, el('td', 'num', Number(r.waste) ? kg(r.waste) : '—'));
      tb.append(tr);
    });
    t.append(tb);
    const wrap = el('div', 'yd-scroll'); wrap.append(t);
    c.append(wrap);
    return c;
  };
  // with one crop picked, its line is the tiles above: the per-crop table is for comparing them all
  if (!chosen) grid.append(table('Per crop', crops, r => [cropAvatar({ name: r.crop, category: r.category, photo_url: r.photo_url }, 'xs'), el('span', null, r.crop)]));
  grid.append(table(chosen ? `Per zone · ${chosen.crop}` : 'Per zone', d.zones || [], r => [el('span', null, r.zone)]));
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
    t.append(tb);
    const wrap = el('div', 'yd-scroll'); wrap.append(t);
    c.append(wrap);
    mount.append(c);
  }
}
