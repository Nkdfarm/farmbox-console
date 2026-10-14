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
import { openFast, rpc } from './api.js';
import { loading, el, pageHead, cropAvatar, pref, farmDate, drawer, confirmDrawer, field, input, selectBox, toast, busy } from './ui.js';

const PERIODS = [['28', '4 weeks'], ['91', '3 months'], ['182', '6 months'], ['365', 'A year']];
const CROP_KEY = 'fbc_yield_crop';
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

export async function renderYield(mount, farm, fresh = false) {
  const here = mount;
  const crop = pref.get(CROP_KEY) || null;
  await openFast([['yield_dashboard', { p_farm: farm.id, ...yieldRange(), ...(crop ? { p_crop: crop } : {}) }]], {
    fresh,
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
               tile(t.all_kg_m2_year == null ? perM2(t.projected_kg_m2_year) : perM2(t.all_kg_m2_year), 'kg per m² a year, all inclusive',
                    [t.planned_kg_m2_year != null ? `expected ${perM2(t.planned_kg_m2_year)}` : null,
                     t.projected_kg_m2_year != null ? `per batch ${perM2(t.projected_kg_m2_year)}` : null].filter(Boolean).join(' · ') || 'from the batches cut in the period',
                    '', 'All inclusive: every bay from its first transplant to today, the weeks it stood empty between two crops included. Per batch: ' + YEAR_HINT),
               tile(kg(t.planned_to_date), 'Planned so far', `${kg(t.planned)} over the whole period`),
               tile(p == null ? '—' : `${p}%`, 'Of plan so far', null, p != null && p < 80 ? 'bad' : ''),
               tile(Number(t.harvested) ? `${Math.round(100 * Number(t.waste || 0) / (Number(t.harvested) + Number(t.waste || 0)))}%` : '—', 'Waste', kg(t.waste)),
               tile(t.kg_m2 == null ? '—' : `${Number(t.kg_m2).toFixed(1)}`, 'kg per m²', `${t.batches_finished || 0} finished batches`));
  mount.append(tiles);

  // the chart: its step follows the period (a week up to three months, two weeks up to six, a month for a year). The bars
  // are the kilograms of each step; over them two lines on their own scale, kg per m² a year reckoned to each step's end:
  // all inclusive (every bay from its first transplant, the weeks it stood empty between two crops included) and what
  // the plan expected (owner 15 Oct 2026: "put a line over the boxes for the projected yield per year overall (all
  // inclusive)", "put the lines from the expected and realised"). A click on a bar opens the cuts that make it.
  const steps = d.buckets || (d.weeks || []).map(w => ({ from: w.w, to: w.w, planned: w.planned, harvested: w.harvested, waste: w.waste }));
  const step = d.step || 'week';
  const card = el('div', 'card card-pad');
  const head = el('div', 'yd-chart-head');
  const STEP_TITLE = { week: 'Week by week', '2weeks': 'Every two weeks', month: 'Month by month' };
  head.append(el('div', 'sec-title', (STEP_TITLE[step] || 'Week by week') + (chosen ? ` · ${chosen.crop}` : '')));
  card.append(head);

  // a month is named by its name, with its year on the first one and on January (a year's view shows the same month twice)
  const stepLabel = (s, i) => {
    if (step !== 'month') return nice(s.from);
    const dt = new Date(String(s.from).slice(0, 10) + 'T12:00:00');
    return dt.toLocaleDateString(undefined, i === 0 || dt.getMonth() === 0 ? { month: 'short', year: '2-digit' } : { month: 'short' });
  };
  const span = s => step === 'month'
    ? new Date(String(s.from).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : s.from === s.to ? nice(s.from) : `${nice(s.from)} – ${nice(s.to)}`;
  const kgOf = s => Math.max(Number(s.planned || 0), Number(s.harvested || 0) + Number(s.waste || 0));
  const num = v => v == null ? null : Number(v);
  const top = Math.max(...steps.map(kgOf), 0);
  const max = niceMax(top);
  const yTop = Math.max(...steps.flatMap(s => [num(s.all_kg_m2_year), num(s.planned_kg_m2_year)]).filter(v => v != null), 0);
  const ymax = niceMax(yTop);
  const lines = yTop > 0;

  if (!(top > 0) && !lines) {
    card.append(el('div', 'hint', 'Nothing harvested or planned in this period.'));
    mount.append(card);
  } else {
    const plot = el('div', 'yd-plot');
    const axis = el('div', 'yd-axis');
    [max, max / 2, 0].forEach(v => axis.append(el('span', null, fmt1(v))));
    const raxis = el('div', 'yd-axis yd-axis-r');
    if (lines) [ymax, ymax / 2, 0].forEach(v => raxis.append(el('span', null, fmt1(v))));
    const chart = el('div', 'yd-chart');
    const grid = el('div', 'yd-gridlines'); grid.append(el('i'), el('i'), el('i'));
    chart.append(grid);
    const cols = [];
    steps.forEach((s, i) => {
      const col = el('button', 'yd-col' + (String(s.from) > String(d.today) ? ' ahead' : ''));
      col.type = 'button';
      const bars = el('div', 'yd-bars');
      const pb = el('i', 'plan'); pb.style.height = (100 * s.planned / max) + '%';
      const hb = el('i', 'harv'); hb.style.height = (100 * s.harvested / max) + '%';
      const wb = el('i', 'waste'); wb.style.height = (100 * s.waste / max) + '%';
      const stack = el('span', 'yd-stack'); stack.append(wb, hb);
      bars.append(pb, stack);
      const all = num(s.all_kg_m2_year), exp = num(s.planned_kg_m2_year);
      col.title = [`${span(s)}: ${kg(s.harvested)} harvested` + (Number(s.planned) ? `, ${kg(s.planned)} planned` : '') + (Number(s.waste) ? `, ${kg(s.waste)} waste` : ''),
                   all != null ? `${fmt1(all)} kg/m² a year all inclusive` : null, exp != null ? `${fmt1(exp)} expected` : null,
                   'Click to see the harvests'].filter(Boolean).join(' · ');
      col.onclick = () => openStep(farm, d, s, span(s), chosen, () => renderYield(mount, farm, true));
      col.append(bars, el('span', 'yd-lbl', stepLabel(s, i)));
      chart.append(col);
      cols.push({ col, all, exp });
    });
    // the two lines: drawn once the columns have their places, again when the chart changes width
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'yd-lines'); svg.setAttribute('aria-hidden', 'true');
    chart.append(svg);
    const draw = () => {
      if (!chart.isConnected || !lines) return;
      const box = chart.getBoundingClientRect(), gr = grid.getBoundingClientRect();
      // the drawing is the chart's own size (its CSS fills it): sized to the scroll width it widened the chart it measured
      const w = chart.clientWidth, h = gr.height, y0 = gr.top - box.top;
      svg.setAttribute('viewBox', `0 0 ${w} ${chart.clientHeight}`);
      const pt = (c, v) => { const r = c.col.getBoundingClientRect(); return [r.left - box.left + r.width / 2, y0 + h - h * v / ymax]; };
      const path = key => {
        const ps = cols.filter(c => c[key] != null).map(c => pt(c, c[key]));
        return { d: ps.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), ps };
      };
      svg.textContent = '';
      [['exp', 'yd-line-exp'], ['all', 'yd-line-all']].forEach(([key, cls]) => {
        const { d: dd, ps } = path(key);
        if (!ps.length) return;
        const pl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pl.setAttribute('d', dd); pl.setAttribute('class', cls); svg.append(pl);
        ps.forEach(p => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', key === 'all' ? 3.5 : 2.5); c.setAttribute('class', cls); svg.append(c); });
      });
      // the last figure of the all-inclusive line, beside its last point
      const last = [...cols].reverse().find(c => c.all != null);
      if (last) { const [x, y] = pt(last, last.all); const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x); t.setAttribute('y', y - 9); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'yd-line-val'); t.textContent = fmt1(last.all); svg.append(t); }
    };
    if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(chart);
    requestAnimationFrame(draw);
    setTimeout(draw, 60);                      // a window in the background draws no frame: the lines come all the same
    plot.append(axis, chart, raxis);
    const legend = el('div', 'yd-legend');
    const key = (cls, text) => { const k = el('span', 'yd-key'); k.append(el('i', cls), document.createTextNode(text)); return k; };
    legend.append(key('harv', `kg harvested ${step === 'month' ? 'a month' : step === '2weeks' ? 'every two weeks' : 'a week'} (left scale)`), key('plan', 'planned'),
                  key('waste', 'waste'));
    if (lines) legend.append(key('line-all', 'kg/m² a year, all inclusive (right scale)'), key('line-exp', 'expected'));
    card.append(plot, legend, el('div', 'hint', 'kg/m² a year, all inclusive: everything harvested by the end of each step over each bay’s area and the whole time since its first transplant — the weeks before the first cut and those the bay stood empty between two crops included. The expected line reckons the plan the same way. Click a bar for its harvests.'));
    mount.append(card);
  }

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

// ── the harvests behind a bar ─────────────────────────────────────────────────
// Every cut of the step: its day, the batch (lot code) and where, the kg, waste, who recorded it, from the phone's
// harvest task or not. A manager corrects a weight, a day or the waste, takes a wrong cut out, or adds one that was
// missed (owner 15 Oct 2026: "record harvest mainly by phone and eventually modified by computer").
async function openStep(farm, d, s, title, chosen, reload) {
  // the page reads its figures again once the window closes (✕, Escape, outside), if a harvest was corrected
  const dr = drawer(`Harvests · ${title}`, chosen ? chosen.crop : 'All crops', { onClose: () => { if (changed) reload(); } });
  dr.body.append(loading('Reading the harvests…'));
  let changed = false;
  const done = () => { changed = true; paintCuts(); };
  const from = String(s.from).slice(0, 10), to = String(s.to).slice(0, 10);
  let data = null;
  async function paintCuts() {
    try { data = await rpc('step_harvests', { p_farm: farm.id, p_from: from, p_to: to, ...(chosen ? { p_crop: chosen.crop_id } : {}) }); }
    catch (e) { dr.body.textContent = ''; dr.body.append(el('div', 'note bad', e.message)); return; }
    dr.body.textContent = '';
    const cuts = data.cuts || [];
    const total = cuts.reduce((a, c) => a + Number(c.kg || 0), 0);
    dr.body.append(el('div', 'hint', cuts.length ? `${cuts.length} harvest${cuts.length === 1 ? '' : 's'} · ${kg(total)}` : 'No harvest recorded in this step.'));
    const list = el('div', 'yd-cuts');
    cuts.forEach(c => {
      const row = el('div', 'yd-cut');
      const what = el('div', 'yd-cut-what');
      what.append(cropAvatar({ name: c.crop, category: c.category, photo_url: c.photo_url }, 'xs'),
                  el('b', null, nice(c.date)), el('span', null, c.crop),
                  el('span', 'hint', [c.zone, c.position, c.lot ? `lot ${c.lot}` : null].filter(Boolean).join(' · ')));
      const fig = el('div', 'yd-cut-kg', `${Number(c.kg).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg` + (Number(c.waste) ? ` · waste ${fmt1(c.waste)} kg` : ''));
      const who = el('div', 'hint', (c.from_phone ? 'from the phone' : 'typed or imported') + (c.by ? ` · ${c.by}` : ''));
      row.append(what, fig, who);
      if (data.may_edit) {
        const fix = el('button', 'btn btn-sm', 'Correct…'); fix.type = 'button';
        fix.onclick = () => correctCut(c, done);
        row.append(fix);
      }
      list.append(row);
    });
    dr.body.append(list);
    if (data.may_edit) {
      const add = el('button', 'btn btn-sm', 'Add a harvest…'); add.type = 'button';
      add.onclick = () => addCut(farm, d, chosen, from, to, done);
      dr.body.append(add);
    }
  }
  await paintCuts();
}

function correctCut(c, done) {
  const dr = drawer('Correct a harvest', `${c.crop} · ${[c.zone, c.position, c.lot ? `lot ${c.lot}` : null].filter(Boolean).join(' · ')}`);
  const kgIn = input({ type: 'number', step: '0.1', min: '0.1', value: c.kg });
  const day = input({ type: 'date', value: String(c.date).slice(0, 10), max: ymd(farmDate()) });
  const waste = input({ type: 'number', step: '0.1', min: '0', value: c.waste ?? '' });
  dr.body.append(field('Total kg', kgIn), field('Day', day), field('Waste (kg)', waste, 'Left empty: none.'));
  const rm = el('button', 'btn btn-danger', 'Take it out'); rm.type = 'button';
  const save = el('button', 'btn btn-primary', 'Save'); save.type = 'button';
  rm.onclick = async () => {
    if (!await confirmDrawer('Take this harvest out?', `${fmt1(c.kg)} kg on ${nice(c.date)} leaves every total and figure. Use it for a harvest recorded twice or by mistake.`, 'Take it out', true)) return;
    busy(rm, true, 'Taking out…');
    try { await rpc('edit_harvest', { p: { id: c.id, remove: true } }); dr.close(); toast('Harvest taken out', 'ok'); done(); }
    catch (e) { busy(rm, false, 'Take it out'); toast(e.message, 'bad'); }
  };
  save.onclick = async () => {
    if (!(Number(kgIn.value) > 0)) { toast('It needs a weight above zero', 'bad'); return; }
    busy(save, true, 'Saving…');
    try {
      await rpc('edit_harvest', { p: { id: c.id, qty: Number(kgIn.value), date: day.value, waste_qty: waste.value === '' ? null : Number(waste.value) } });
      dr.close(); toast('Harvest corrected', 'ok'); done();
    } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
  };
  dr.footer.append(rm, el('div', 'spacer'), save);
}

function addCut(farm, d, chosen, from, to, done) {
  // the batches that can take it: those picking or cut in the period, of the crop on screen when one is
  const batches = [...(d.running || [])].filter(b => !chosen || b.crop === chosen.crop);
  const dr = drawer('Add a harvest', 'For a harvest that was not recorded on the phone');
  if (!batches.length) { dr.body.append(el('div', 'hint', 'No batch in production in this period to add a harvest to.')); return; }
  const pick = selectBox(batches.map(b => [b.plan_id, `${b.crop} · ${[b.zone, b.position].filter(Boolean).join(' · ')}`]), batches[0].plan_id);
  const today = ymd(farmDate());
  const day = input({ type: 'date', value: to < today ? to : today, max: today });
  const kgIn = input({ type: 'number', step: '0.1', min: '0.1' });
  dr.body.append(field('Batch', pick), field('Day', day), field('Total kg', kgIn));
  const save = el('button', 'btn btn-primary', 'Add'); save.type = 'button';
  save.onclick = async () => {
    if (!(Number(kgIn.value) > 0)) { toast('It needs a weight above zero', 'bad'); return; }
    busy(save, true, 'Adding…');
    try { await rpc('record_harvest', { p: { crop_plan_id: pick.value, qty: Number(kgIn.value), date: day.value } }); dr.close(); toast('Harvest added', 'ok'); done(); }
    catch (e) { busy(save, false, 'Add'); toast(e.message, 'bad'); }
  };
  dr.footer.append(el('div', 'spacer'), save);
}
