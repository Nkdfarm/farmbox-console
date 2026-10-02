// ═══════════════════════════════════════════════════════════════════════════
// IPM programs (console 0.7.199, migration 0197, owner 2 Oct 2026: "in each zone daily report
// you can decide to apply an IPM treatment directly from the daily report, a flag will be active
// in each daily zone report in a new block on the right with a small calendar of applied day and
// future day with the name of the program and a different colour for a different product …
// applied per table").
//
//   treatBlock(farm, z, day, calm, onChange) — the block on the right of a zone's Plant health:
//     a flag when a program runs there, eight weeks as a small calendar (a filled mark = applied,
//     a ring = to come, one colour and one letter per product, the days no harvest is allowed
//     shaded), the programs with their tables, and Apply a treatment….
//   openApply(farm, z, opts) — the window: a program of the library (or one product), the tables,
//     the first day, the spray volume; the database answers with every application, the quantity
//     for those tables, what the store holds and what must be ordered, and its warnings. Nothing
//     is written until Start.
//   renderIpmPrograms / renderIpmProducts — the library's two tabs.
// The system proposes: a treatment starts when the Admin, the Farm manager or the Agronomist says so.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { el, num, drawer, toast, busy, input, field, selectBox, pageHead, table, loading, confirmDrawer } from './ui.js';

const parse = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = s => parse(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const longDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const METHOD = { biological: 'Biological', chemical: 'Chemical', integrated: 'Integrated', cultural: 'Cultural', mechanical: 'Mechanical' };
const KIND = { beneficial: 'Beneficial', biopesticide: 'Biopesticide', chemical: 'Chemical', botanical: 'Botanical', adjuvant: 'Adjuvant', monitoring: 'Monitoring' };
const CONF = { label: 'the label', supplier_page: 'the supplier\'s page', secondary: 'another site', unverified: 'not verified' };
const CATEGORY = { leafy: 'Leafy', mixed_leafy: 'Mixed leafy', herbs: 'Herbs', microgreens: 'Microgreens', fruiting_vines: 'Fruiting vines', fruiting_bush: 'Fruiting bush' };
// one colour and one letter per product, in the order the database gives (the same product keeps its colour)
const hueOf = i => Math.round((28 + i * 137.5) % 360);
const letterOf = i => String.fromCharCode(65 + (i % 26));
const qtyText = (q, unit) => q == null ? '—' : unit === 'ml' && q >= 1000 ? `${num(q / 1000, 2)} L` : unit === 'g' && q >= 1000 ? `${num(q / 1000, 2)} kg`
  : `${num(q, q < 10 ? 2 : q < 100 ? 1 : 0)} ${unit || ''}`.trim();

function mark(i, name, status) {
  const m = el('span', 'tr-mark ' + (status || 'planned'), letterOf(i));
  m.style.setProperty('--h', hueOf(i));
  m.title = name;
  return m;
}

// ── the library, read once per farm and kept while the page lives ──
const libs = new Map();
async function library(farm, fresh = false) {
  if (!fresh && libs.has(farm.id)) return libs.get(farm.id);
  const lib = await rpc('ipm_library', { p_farm: farm.id });
  libs.set(farm.id, lib);
  return lib;
}

// ── the block in the zone's report ───────────────────────────────────────────
export function treatBlock(farm, z, day, calm, onChange) {
  const box = el('div', 'tr-block');
  box.append(el('div', 'pd-hlabel', 'Treatments'), el('div', 'hint', 'Reading…'));
  const read = () => (calm || rpc)('zone_treatments', { p_farm: farm.id, p_zone: z.zone_id, p_system: z.system_id || null, p_day: day.day });
  const again = async () => { try { paintBlock(box, farm, z, await read(), again, onChange); } catch (e) { /* the next opening reads it again */ } };
  box.load = async () => {
    if (!z.zone_id) { box.textContent = ''; box.append(el('div', 'pd-hlabel', 'Treatments'), el('div', 'hint', 'No zone here.')); return; }
    try { paintBlock(box, farm, z, await read(), again, onChange); }
    catch (e) { box.textContent = ''; box.append(el('div', 'pd-hlabel', 'Treatments'), el('div', 'note bad', e.message)); }
  };
  return box;
}

function paintBlock(box, farm, z, t, again, onChange) {
  box.textContent = '';
  const running = (t.programs || []).filter(p => p.state === 'running');
  const head = el('div', 'tr-head');
  head.append(el('span', 'pd-hlabel', 'Treatments'));
  // the flag: a program runs here
  const flag = el('span', 'tr-flag' + (running.length ? ' on' : ''), running.length ? `⚑ ${running.length === 1 ? running[0].name : running.length + ' programs running'}` : 'none running');
  if (running.length) flag.title = running.map(p => `${p.name} — ${p.tables}`).join('\n');
  head.append(flag, el('span', 'spacer'));
  if (t.may_treat) {
    const b = el('button', 'btn btn-sm btn-primary', 'Apply…');
    b.title = 'Start an IPM program on the tables of this zone';
    b.onclick = () => openApply(farm, z, { cases: t.open_cases || [], onDone: () => { again(); onChange?.(); } });
    head.append(b);
  }
  box.append(head);

  const products = t.products || [];
  const idx = name => Math.max(0, products.indexOf(name));
  box.append(calendar(t, idx));

  if (products.length) {
    const lg = el('div', 'tr-legend');
    products.forEach((name, i) => { const s = el('span', 'tr-lg'); s.append(mark(i, name, 'done'), el('span', null, name)); lg.append(s); });
    lg.append(el('span', 'hint', 'filled = applied · ring = to come'));
    box.append(lg);
  }
  if (t.reentry?.until) box.append(el('div', 'note bad tr-note', `Re-entry closed until ${new Date(t.reentry.until).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} (${t.reentry.product}).`));
  if (t.harvest_after && String(t.harvest_after) > String(t.today)) box.append(el('div', 'note warn tr-note', `No harvest on the treated tables before ${longDay(t.harvest_after)}.`));

  (t.programs || []).forEach(p => {
    const row = el('div', 'tr-prog' + (p.state !== 'running' ? ' off' : ''));
    const top = el('div', 'tr-prog-top');
    top.append(el('b', null, p.name), el('span', 'pill ' + (p.state === 'running' ? 'ok' : ''), p.state === 'running' ? `${p.done}/${p.total}` : p.state));
    row.append(top);
    row.append(el('div', 'hint', [p.target_label, 'tables: ' + p.tables, p.next ? 'next ' + shortDay(p.next) : null,
      p.case ? 'case: ' + p.case : 'no case (preventive)'].filter(Boolean).join(' · ')));
    if (t.may_treat && p.state === 'running') {
      const stop = el('button', 'btn btn-sm', 'Stop');
      stop.title = 'The applications not done yet are removed, with their tasks and what they had asked the store for';
      stop.onclick = async () => {
        if (!await confirmDrawer('Stop this program?', `${p.name} on ${p.tables}: the applications not done yet are removed, with their tasks. What was applied stays on the calendar.`, 'Stop the program', true)) return;
        busy(stop, true, '…');
        try { await rpc('stop_program', { p_program: p.id }); toast('Stopped', 'ok'); again(); onChange?.(); }
        catch (e) { busy(stop, false, 'Stop'); toast(e.message, 'bad'); }
      };
      top.append(el('span', 'spacer'), stop);
    }
    box.append(row);
  });
  if (!(t.programs || []).length) box.append(el('div', 'hint', t.may_treat ? 'No treatment on this zone. Apply… starts one on the tables you choose.' : 'No treatment on this zone.'));
  if (t.task_mode && t.task_mode !== 'all') box.append(el('div', 'hint', 'This unit makes no treatment tasks (Farm setup › The week): the calendar is kept, the work is not put on the board.'));
}

// eight weeks, Monday first: the applications as letters in their product's colour, the days under withholding shaded
function calendar(t, idx) {
  const cal = el('div', 'tr-cal');
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(d => cal.append(el('span', 'tr-dow', d)));
  const byDay = new Map();
  (t.applications || []).forEach(a => { const k = String(a.day).slice(0, 10); (byDay.get(k) || byDay.set(k, []).get(k)).push(a); });
  // a day is held when an application before it (done or to come) is still inside its withholding days
  const holds = (t.applications || []).filter(a => a.phi_days > 0 && a.status !== 'skipped')
    .map(a => [parse(a.day).getTime(), parse(a.day).getTime() + a.phi_days * 864e5]);
  const from = parse(t.from), today = String(t.today), sel = String(t.day);
  for (let i = 0; i < 56; i++) {
    const d = new Date(from.getTime() + i * 864e5), k = ymd(d), ms = parse(k).getTime();
    const cell = el('div', 'tr-day' + (k === today ? ' today' : '') + (k === sel && sel !== today ? ' sel' : '') + (k < today ? ' past' : '')
      + (holds.some(([a, b]) => ms >= a && ms < b) ? ' hold' : ''));
    cell.append(el('span', 'tr-num', d.getDate() === 1 || i === 0 ? d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : String(d.getDate())));
    const list = byDay.get(k) || [];
    const marks = el('span', 'tr-marks');
    list.forEach(a => marks.append(mark(idx(a.product), a.product, a.status)));
    cell.append(marks);
    const lines = list.map(a => `${a.product} — ${a.program}${a.status === 'done' ? ' · applied' + (a.who ? ' by ' + a.who : '') : a.status === 'skipped' ? ' · not done' : ' · to come'}`
      + (a.qty != null ? ` · ${qtyText(Number(a.qty), a.qty_unit)}` : '') + (a.phi_days > 0 ? ` · no harvest for ${a.phi_days} d` : ''));
    cell.title = [longDay(k), ...lines, cell.classList.contains('hold') && !list.length ? 'inside a withholding period: no harvest' : null].filter(Boolean).join('\n');
    cal.append(cell);
  }
  return cal;
}

// ── apply a treatment ────────────────────────────────────────────────────────
export async function openApply(farm, z, opts = {}) {
  const d = drawer(`Apply a treatment · ${z.name || z.zone || 'zone'}`, 'A program of the library, or one product, on the tables you choose. Nothing is written until Start.');
  d.box.classList.add('tr-drawer');
  d.body.append(loading('Reading the library…'));
  let lib;
  try { lib = await library(farm); } catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
  d.body.textContent = '';
  if (!lib.templates.length && !lib.products.length) { d.body.append(el('div', 'note warn', 'The IPM library is empty: the catalogue has not been loaded into this database yet.')); return; }

  const state = { mode: 'program', target: opts.target || opts.cases?.[0]?.code || '', method: '', template: null, product: null,
    applications: 1, interval: 7, positions: null, start: '', water: '', issue: opts.cases?.[0]?.id || '', pv: null };
  const targets = [...new Map(lib.templates.map(t => [t.target, t.target_label])).entries()];
  const targetSel = selectBox([['', 'Every pest and disease'], ...targets], state.target);
  const methodSel = selectBox([['', 'Any method'], ['biological', 'Biological'], ['chemical', 'Chemical'], ['integrated', 'Integrated']], '');
  const modeSeg = el('div', 'seg');
  [['program', 'A program'], ['product', 'One product']].forEach(([k, label]) => {
    const b = el('button', 'seg-btn', label); b.type = 'button'; b.setAttribute('aria-pressed', String(state.mode === k));
    b.onclick = () => { state.mode = k; [...modeSeg.children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); paintChoice(); refresh(); };
    modeSeg.append(b);
  });
  const choice = el('div', 'tr-choice');
  const tablesBox = el('div', 'tr-tables');
  const startIn = input({ type: 'date' });
  const waterIn = input({ type: 'number', min: 50, step: 50, placeholder: '1000' });
  const caseSel = selectBox([['', 'No case — preventive'], ...(opts.cases || []).map(c => [c.id, c.title])], state.issue);
  const out = el('div', 'tr-preview');
  const go = el('button', 'btn btn-primary', 'Start the program');
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  go.disabled = true;

  const top = el('div', 'tr-form');
  top.append(field('What', modeSeg), field('Against', targetSel), field('Method', methodSel));
  const when = el('div', 'tr-form');
  when.append(field('First day', startIn, 'Empty = today; a closed day moves to the next working day'),
              field('Spray volume, L/ha', waterIn, 'For a rate per 100 L; empty = the label\'s, else 1 000'),
              field('For the case', caseSel));
  d.body.append(top, choice, el('div', 'pd-hlabel', 'Tables'), tablesBox, when, out);
  d.footer.append(cancel, go);

  function paintChoice() {
    choice.textContent = '';
    if (state.mode === 'program') {
      const list = lib.templates.filter(t => (!state.target || t.target === state.target) && (!state.method || t.method === state.method));
      if (!list.length) { choice.append(el('div', 'hint', 'No program of the library matches. Try "One product", or another method.')); state.template = null; return; }
      if (!list.some(t => t.id === state.template)) state.template = null;
      list.forEach(t => {
        const c = el('button', 'tr-tpl' + (t.id === state.template ? ' on' : '')); c.type = 'button';
        const h = el('div', 'tr-tpl-head');
        h.append(el('b', null, t.name), el('span', 'pill', METHOD[t.method] || t.method), el('span', 'pill', t.approach));
        if (t.unverified) { const u = el('span', 'pill warn', 'to verify'); u.title = `${t.unverified} of its products were not yet checked against the label by a person`; h.append(u); }
        c.append(h, el('div', 'hint', t.steps.map(s => `${s.product} ×${s.applications}${s.applications > 1 ? ' every ' + s.interval_days + ' d' : ''}`).join(' → ')
          + ` · ${t.days || 0} days` + (t.withholding ? ` · withholding up to ${t.withholding} d` : '')));
        if (t.summary) c.append(el('div', 'tr-tpl-sum', t.summary));
        c.onclick = () => { state.template = t.id; paintChoice(); refresh(); };
        choice.append(c);
      });
    } else {
      const list = lib.products.filter(p => (!state.target || (p.targets || []).includes(state.target))
        && (!state.method || p.method === state.method || state.method === 'integrated'));
      const sel = selectBox([['', 'Choose a product…'], ...list.map(p => [p.id, `${p.name} — ${p.supplier}${p.verified_at ? '' : ' (to verify)'}`])], state.product || '');
      const apps = input({ type: 'number', min: 1, max: 52, value: state.applications });
      const intv = input({ type: 'number', min: 1, max: 90, value: state.interval });
      sel.onchange = () => { state.product = sel.value || null; const p = lib.products.find(x => x.id === state.product);
        if (p) { state.applications = p.applications || 1; state.interval = p.interval_days || 7; apps.value = state.applications; intv.value = state.interval; } info(); refresh(); };
      apps.onchange = () => { state.applications = Math.max(1, Number(apps.value) || 1); refresh(); };
      intv.onchange = () => { state.interval = Math.max(1, Number(intv.value) || 7); refresh(); };
      const row = el('div', 'tr-form');
      row.append(field('Product', sel), field('Applications', apps), field('Every (days)', intv));
      const facts = el('div', 'hint');
      const info = () => { const p = lib.products.find(x => x.id === state.product);
        facts.textContent = p ? [p.active_ingredient, p.moa_group, p.rate_text ? 'rate: ' + p.rate_text : null, p.phi_days != null ? `withholding ${p.phi_days} d` : null,
          p.rei_hours != null ? `re-entry ${p.rei_hours} h` : null, p.max_applications ? `at most ${p.max_applications} applications` : null].filter(Boolean).join(' · ') : ''; };
      info();
      choice.append(row, facts);
    }
  }

  function paintTables(scope) {
    tablesBox.textContent = '';
    const tables = scope.tables || [];
    if (!tables.length) { tablesBox.append(el('div', 'note warn', 'This zone has no growing position: set its tables on Farm setup.')); return; }
    const all = el('button', 'btn btn-sm', 'All'); all.type = 'button';
    all.onclick = () => { state.positions = null; refresh(); };
    const bySys = new Map();
    tables.forEach(t => (bySys.get(t.system) || bySys.set(t.system, []).get(t.system)).push(t));
    bySys.forEach((rows, sys) => {
      const g = el('div', 'tr-sys');
      const sb = el('button', 'tr-sysname', sys); sb.type = 'button'; sb.title = 'Only the tables of ' + sys;
      sb.onclick = () => { state.positions = rows.map(r => r.id); refresh(); };
      g.append(sb);
      rows.forEach(t => {
        const b = el('button', 'tr-table' + (t.on ? ' on' : ''), t.code); b.type = 'button';
        b.setAttribute('aria-pressed', String(!!t.on));
        b.title = [t.crop || 'nothing standing', t.area_m2 != null ? `${num(t.area_m2, 1)} m²` : null, `${num(t.plants)} places`].filter(Boolean).join(' · ');
        b.onclick = () => {
          const on = new Set(tables.filter(x => x.on).map(x => x.id));
          on.has(t.id) ? on.delete(t.id) : on.add(t.id);
          state.positions = [...on];
          refresh();
        };
        g.append(b);
      });
      tablesBox.append(g);
    });
    const foot = el('div', 'tr-tables-foot');
    foot.append(all, el('span', 'hint', `${scope.count} of ${scope.of} tables · ${num(scope.area_m2, 1)} m² · ${num(scope.plants)} places`
      + ((scope.crops || []).length ? ' · ' + scope.crops.join(', ') : '')));
    tablesBox.append(foot);
  }

  const args = () => ({ farm_id: farm.id, zone_id: z.zone_id, system_id: z.system_id || null,
    position_ids: state.positions || [], start_date: state.start || null, water_l_per_ha: state.water || null, issue_id: state.issue || null,
    ...(state.mode === 'program' ? { template_id: state.template }
      : { steps: [{ seq: 1, product_id: state.product, applications: state.applications, interval_days: state.interval }], target: state.target || null }) });
  const ready = () => state.mode === 'program' ? !!state.template : !!state.product;

  let seq = 0;
  async function refresh() {
    const mine = ++seq;
    go.disabled = true;
    if (!ready()) {
      out.textContent = ''; out.append(el('div', 'hint', state.mode === 'program' ? 'Choose a program to see its days, quantities and what the store holds.' : 'Choose a product.'));
      // the tables can be chosen before the program: any product gives the scope
      if (!tablesBox.childElementCount && lib.products[0]) {
        try { const pv = await rpc('ipm_preview', { p: { ...args(), template_id: null, steps: [{ product_id: lib.products[0].id }] } }); if (mine === seq) paintTables(pv.scope); } catch (e) { /* shown with the program */ }
      }
      return;
    }
    out.classList.add('stale');
    try {
      const pv = await rpc('ipm_preview', { p: args() });
      if (mine !== seq) return;
      state.pv = pv;
      paintTables(pv.scope);
      paintPreview(pv);
      go.disabled = !pv.may_treat || !pv.scope.count || !pv.applications.length;
    } catch (e) { if (mine === seq) { out.textContent = ''; out.append(el('div', 'note bad', e.message)); } }
    finally { if (mine === seq) out.classList.remove('stale'); }
  }

  function paintPreview(pv) {
    out.textContent = '';
    (pv.warnings || []).forEach(w => out.append(el('div', 'note ' + (w.level === 'bad' ? 'bad' : 'warn') + ' tr-note', w.text)));
    const names = [...new Set(pv.applications.map(a => a.product))];
    out.append(el('div', 'pd-hlabel', `Applications · ${pv.applications.length}`));
    out.append(table([
      { key: 'date', label: 'Day', fmt: v => longDay(v) },
      { key: 'product', label: 'Product', fmt: (v, r) => { const s = el('span', 'tr-lg'); s.append(mark(names.indexOf(v), v, 'done'), el('span', null, v)); return s; } },
      { key: 'rate_text', label: 'Label rate' },
      { key: 'qty', label: 'For these tables', align: 'right', fmt: (v, r) => v == null ? 'measure from the label' : qtyText(Number(v), r.qty_unit) },
      { key: 'water_l', label: 'Water', align: 'right', fmt: v => v == null ? '—' : `${num(v, 1)} L` },
      { key: 'harvest_after', label: 'No harvest before', fmt: v => v ? shortDay(v) : '—' },
      { key: 'rei_hours', label: 'Re-entry', align: 'right', fmt: v => v == null ? '—' : `${num(v)} h` },
    ], pv.applications));
    out.append(el('div', 'pd-hlabel', 'Materials and the store'));
    out.append(table([
      { key: 'product', label: 'Product' },
      { key: 'need', label: 'Needs', align: 'right', fmt: (v, r) => v == null ? '—' : qtyText(Number(v), r.unit) },
      { key: 'on_hand', label: 'In the store', align: 'right', fmt: (v, r) => r.perishable ? 'living — not stocked' : qtyText(Number(v), r.unit) },
      { key: 'order_qty', label: 'To order', align: 'right', fmt: (v, r) => !Number(v) ? (r.need == null ? '—' : 'nothing') : qtyText(Number(v), r.unit) + (r.perishable ? ` over ${r.applications} deliveries` : '') },
      { key: 'order_by', label: 'Order by', fmt: (v, r) => { if (!Number(r.order_qty)) return '—'; const s = el('span', r.late ? 'pill bad' : null, shortDay(v) + (r.late ? ' · late' : '')); return s; } },
      { key: 'supplier', label: 'Supplier', fmt: (v, r) => v ? `${v} · ${r.lead_days} d` : '—' },
    ], pv.materials));
    out.append(el('div', 'hint', 'Start writes one task per application (a line per table, with its checklist) and the purchase requests on Office › Buy. '
      + (pv.harvest_after ? `Harvest is held on these tables until ${longDay(pv.harvest_after)}.` : 'No withholding period on these products.')));
  }

  targetSel.onchange = () => { state.target = targetSel.value; paintChoice(); refresh(); };
  methodSel.onchange = () => { state.method = methodSel.value; paintChoice(); refresh(); };
  startIn.onchange = () => { state.start = startIn.value; refresh(); };
  waterIn.onchange = () => { state.water = waterIn.value; refresh(); };
  caseSel.onchange = () => { state.issue = caseSel.value; };
  go.onclick = async () => {
    busy(go, true, 'Starting…');
    try {
      const r = await rpc('start_ipm_program', { p: args() });
      const short = (r.materials || []).filter(m => Number(m.order_qty) > 0).length;
      toast(`Started: ${r.tasks} task${r.tasks === 1 ? '' : 's'}` + (short ? ` · ${short} product${short === 1 ? '' : 's'} to order (Office › Buy)` : ' · the store has what it needs'), 'ok');
      libs.delete(farm.id);
      d.close(); opts.onDone?.(r);
    } catch (e) { busy(go, false, 'Start the program'); toast(e.message, 'bad'); }
  };
  paintChoice();
  refresh();
}

// ── the library: programs ────────────────────────────────────────────────────
let pMount = null, pFarm = null, pLib = null;
const pf = { target: '', method: '', category: '', q: '' };
export async function renderIpmPrograms(container, farm) {
  pMount = container; pFarm = farm;
  const here = container;
  await openFast([['ipm_library', { p_farm: farm.id }]], {
    show: ([lib]) => { pLib = lib; libs.set(farm.id, lib); paintPrograms(); },
    waiting: () => { here.textContent = ''; here.append(loading('Reading the library…')); },
    failed: e => { here.textContent = ''; here.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && pMount === here,
  });
}

function filterBar(parts, repaint) {
  const bar = el('div', 'tr-filters');
  parts.forEach(([label, node]) => { const f = el('label', 'tr-filter'); f.append(el('span', 'hint', label), node); bar.append(f); node.onchange = repaint; node.oninput = node.tagName === 'INPUT' ? repaint : null; });
  return bar;
}

function paintPrograms() {
  const lib = pLib; pMount.textContent = '';
  pMount.append(pageHead(null, `The IPM program library: ${lib.templates.length} programs over ${lib.products.length} products of the suppliers' catalogues. `
    + 'A program is a sequence of products against one pest or disease; it is started from a zone\'s daily report (Scouting › a zone › Treatments › Apply…), on the tables you choose. '
    + 'Every rate and withholding period comes from the product\'s label or its supplier — "to verify" means nobody has yet checked it against the label.'));
  const targets = [...new Map(lib.templates.map(t => [t.target, t.target_label])).entries()];
  const tSel = selectBox([['', 'Every pest and disease'], ...targets], pf.target);
  const mSel = selectBox([['', 'Any method'], ['biological', 'Biological'], ['chemical', 'Chemical'], ['integrated', 'Integrated']], pf.method);
  const cSel = selectBox([['', 'Any crop'], ...Object.entries(CATEGORY)], pf.category);
  const q = input({ type: 'search', placeholder: 'product or name', value: pf.q });
  const list = el('div');
  const draw = () => {
    pf.target = tSel.value; pf.method = mSel.value; pf.category = cSel.value; pf.q = q.value.trim().toLowerCase();
    const rows = lib.templates.filter(t => (!pf.target || t.target === pf.target) && (!pf.method || t.method === pf.method)
      && (!pf.category || !(t.crop_categories || []).length || t.crop_categories.includes(pf.category))
      && (!pf.q || (t.name + ' ' + t.steps.map(s => s.product + ' ' + s.supplier).join(' ')).toLowerCase().includes(pf.q)));
    list.textContent = '';
    list.append(el('div', 'hint tr-count', `${rows.length} program${rows.length === 1 ? '' : 's'}`));
    list.append(table([
      { key: 'name', label: 'Program', fmt: (v, r) => { const b = el('b', null, v); const w = el('span'); w.append(b); if (r.unverified) { const u = el('span', 'pill warn', 'to verify'); u.style.marginLeft = '6px'; w.append(u); } return w; } },
      { key: 'target_label', label: 'Against' },
      { key: 'method', label: 'Method', fmt: v => METHOD[v] || v },
      { key: 'approach', label: 'Approach' },
      { key: 'steps', label: 'Products', fmt: v => v.map(s => s.product).join(' → ') },
      { key: 'crop_categories', label: 'Crops', fmt: (v, r) => r.crops_text || ((v || []).length ? v.map(c => CATEGORY[c] || c).join(', ') : 'any') },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'withholding', label: 'Withholding', align: 'right', fmt: v => v ? v + ' d' : '0' },
      { key: 'source', label: 'From', fmt: v => v === 'supplier' ? 'the supplier' : 'the labels' },
    ], rows, { onRow: openProgram, empty: 'No program matches.' }));
  };
  pMount.append(filterBar([['Against', tSel], ['Method', mSel], ['Crop', cSel], ['Search', q]], draw), list);
  draw();
}

function openProgram(t) {
  const d = drawer(t.name, `${t.target_label} · ${METHOD[t.method] || t.method} · ${t.approach}`);
  d.box.classList.add('tr-drawer');
  if (t.summary) d.body.append(el('p', null, t.summary));
  if (t.when_to_use) d.body.append(el('div', 'note', 'When: ' + t.when_to_use));
  d.body.append(el('div', 'pd-hlabel', 'Steps'));
  d.body.append(table([
    { key: 'seq', label: '#', align: 'right' },
    { key: 'product', label: 'Product', fmt: (v, r) => `${v} — ${r.supplier}` },
    { key: 'rate_text', label: 'Label rate' },
    { key: 'day_offset', label: 'From day', align: 'right', fmt: v => v + 1 },
    { key: 'applications', label: 'Times', align: 'right' },
    { key: 'interval_days', label: 'Every', align: 'right', fmt: (v, r) => r.applications > 1 ? v + ' d' : '—' },
    { key: 'phi_days', label: 'Withholding', align: 'right', fmt: v => v == null ? 'not known' : v + ' d' },
    { key: 'rei_hours', label: 'Re-entry', align: 'right', fmt: v => v == null ? '—' : v + ' h' },
  ], t.steps));
  t.steps.filter(s => s.note).forEach(s => d.body.append(el('div', 'hint', `${s.product}: ${s.note}`)));
  d.body.append(el('div', 'hint', (t.source === 'supplier' ? 'A sequence the supplier itself recommends. ' : 'Put together from the products\' labels and the suppliers\' guidance: a starting point for the agronomist, not a prescription. ')
    + 'Start it from a zone\'s daily report: Scouting › the zone › Treatments › Apply….'));
  if (t.source_url) { const a = el('a', 'btn btn-sm', 'Source'); a.href = t.source_url; a.target = '_blank'; a.rel = 'noopener'; d.footer.append(a); }
  const x = el('button', 'btn', 'Close'); x.onclick = d.close; d.footer.append(x);
}

// ── the library: products ────────────────────────────────────────────────────
let cMount = null, cFarm = null, cLib = null;
const cf = { supplier: '', kind: '', target: '', q: '', check: '' };
export async function renderIpmProducts(container, farm) {
  cMount = container; cFarm = farm;
  const here = container;
  await openFast([['ipm_library', { p_farm: farm.id }], ['pest_catalog', {}]], {
    show: ([lib, cat]) => { cLib = lib; cLib.catalog = cat || []; libs.set(farm.id, lib); paintProducts(); },
    waiting: () => { here.textContent = ''; here.append(loading('Reading the catalogue…')); },
    failed: e => { here.textContent = ''; here.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && cMount === here,
  });
}

function paintProducts() {
  const lib = cLib; cMount.textContent = '';
  const checked = lib.products.filter(p => p.verified_at).length;
  cMount.append(pageHead(null, `${lib.products.length} crop-protection products of ${new Set(lib.products.map(p => p.supplier)).size} suppliers, as their labels and product pages say — `
    + `${checked} checked against the label by a person so far. A product is also a stock item: Office › Stock holds what is in the store, and a program asks for what is missing.`));
  const label = code => lib.catalog.find(k => k.code === code)?.label || code;
  const sSel = selectBox([['', 'Every supplier'], ...[...new Set(lib.products.map(p => p.supplier))].sort().map(s => [s, s])], cf.supplier);
  const kSel = selectBox([['', 'Any kind'], ...Object.entries(KIND)], cf.kind);
  const tSel = selectBox([['', 'Any target'], ...[...new Set(lib.products.flatMap(p => p.targets || []))].map(c => [c, label(c)]).sort((a, b) => a[1].localeCompare(b[1]))], cf.target);
  const vSel = selectBox([['', 'Checked or not'], ['no', 'To verify'], ['yes', 'Checked']], cf.check);
  const q = input({ type: 'search', placeholder: 'name or active', value: cf.q });
  const list = el('div');
  const draw = () => {
    cf.supplier = sSel.value; cf.kind = kSel.value; cf.target = tSel.value; cf.check = vSel.value; cf.q = q.value.trim().toLowerCase();
    const rows = lib.products.filter(p => (!cf.supplier || p.supplier === cf.supplier) && (!cf.kind || p.kind === cf.kind)
      && (!cf.target || (p.targets || []).includes(cf.target)) && (!cf.check || (cf.check === 'yes') === !!p.verified_at)
      && (!cf.q || (p.name + ' ' + (p.active_ingredient || '')).toLowerCase().includes(cf.q)));
    list.textContent = '';
    list.append(el('div', 'hint tr-count', `${rows.length} product${rows.length === 1 ? '' : 's'}`));
    list.append(table([
      { key: 'name', label: 'Product', fmt: v => el('b', null, v) },
      { key: 'supplier', label: 'Supplier' },
      { key: 'kind', label: 'Kind', fmt: v => KIND[v] || v },
      { key: 'active_ingredient', label: 'Active' },
      { key: 'moa_group', label: 'Group' },
      { key: 'targets', label: 'Against', fmt: v => (v || []).map(label).join(', ') },
      { key: 'rate_text', label: 'Label rate' },
      { key: 'phi_days', label: 'Withholding', align: 'right', fmt: v => v == null ? '?' : v + ' d' },
      { key: 'on_hand', label: 'In the store', align: 'right', fmt: (v, r) => r.perishable ? 'living' : Number(v) ? qtyText(Number(v), r.unit) : '—' },
      { key: 'verified_at', label: 'Label', fmt: (v, r) => el('span', 'pill ' + (v ? 'ok' : 'warn'), v ? 'checked' : 'to verify') },
    ], rows, { onRow: p => openProduct(p, label), empty: 'No product matches.' }));
  };
  cMount.append(filterBar([['Supplier', sSel], ['Kind', kSel], ['Against', tSel], ['Label', vSel], ['Search', q]], draw), list);
  draw();
}

function openProduct(p, label) {
  const d = drawer(p.name, `${p.supplier} · ${KIND[p.kind] || p.kind}`);
  d.box.classList.add('tr-drawer');
  const facts = el('dl', 'tr-facts');
  const fact = (k, v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return; facts.append(el('dt', null, k), el('dd', null, Array.isArray(v) ? v.join(', ') : String(v))); };
  fact('Active', p.active_ingredient); fact('Formulation', p.formulation); fact('Mode-of-action group', p.moa_group);
  fact('Registration (Act 36 of 1947)', p.reg_no);
  fact('Against', (p.targets || []).map(label)); fact('As the source names them', p.targets_text);
  fact('Crops on the label', p.crops);
  fact('Rate', p.rate_text);
  fact('Worked out as', p.rate_value != null && p.rate_per ? `${p.rate_value} ${p.rate_unit || ''} per ${p.rate_per}` : 'not a figure the console can multiply — measure from the label');
  fact('Spray volume', p.water_l_per_ha != null ? p.water_l_per_ha + ' L/ha' : null);
  fact('Withholding period', p.phi_days != null ? p.phi_days + ' days (the longest of its crops)' : 'not found — read the label');
  fact('Re-entry', p.rei_hours != null ? p.rei_hours + ' h' : null);
  fact('At most', p.max_applications != null ? p.max_applications + ' applications' : null);
  fact('Usual interval', p.interval_days != null ? p.interval_days + ' days' : null);
  fact('Packs', p.pack_sizes); fact('Storage', p.storage); fact('Keeps', p.shelf_life_days != null ? p.shelf_life_days + ' days' : null);
  fact('Works when', p.conditions); fact('Compatibility', p.compatibility); fact('Protection', p.ppe); fact('Notes', p.notes);
  fact('In the store', p.perishable ? 'a living product: ordered for each application, never stocked' : p.on_hand != null ? qtyText(Number(p.on_hand), p.unit) : null);
  fact('Used by', p.programs ? `${p.programs} program${p.programs === 1 ? '' : 's'} of the library` : null);
  d.body.append(facts);
  if ((p.per_crop || []).length) {
    d.body.append(el('div', 'pd-hlabel', 'Crop by crop, as the label says'));
    d.body.append(table([{ key: 'crop', label: 'Crop' }, { key: 'targets_text', label: 'Against' }, { key: 'rate_text', label: 'Rate' },
      { key: 'phi_days', label: 'Withholding', align: 'right', fmt: v => v == null ? '?' : v + ' d' }], p.per_crop));
  }
  d.body.append(el('div', 'note ' + (p.verified_at ? 'ok' : 'warn'), p.verified_at
    ? `Checked against the label by ${p.verified_name || 'the franchisor'} on ${shortDay(p.verified_at)}.`
    : `Read from ${CONF[p.confidence] || p.confidence}; nobody has checked it against the label yet. The label on the pack is the law — this page is a copy.`));
  const links = el('div', 'tr-links');
  [p.label_url, ...(p.source_urls || [])].filter((u, i, a) => u && a.indexOf(u) === i).forEach((u, i) => {
    const a = el('a', null, i === 0 && p.label_url ? 'Label' : (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'source'; } })());
    a.href = u; a.target = '_blank'; a.rel = 'noopener'; links.append(a);
  });
  if (links.childElementCount) d.body.append(el('div', 'pd-hlabel', 'Read from'), links);
  if (cLib?.may_edit) {
    // the franchisor corrects the figures the console computes with, and says the label was checked
    const f = el('div', 'tr-form');
    const rt = input({ value: p.rate_text || '' }), rv = input({ type: 'number', step: 'any', value: p.rate_value ?? '' });
    const ru = input({ value: p.rate_unit || '', placeholder: 'ml · g · individuals' });
    const rp = selectBox([['', '—'], ['m2', 'per m²'], ['ha', 'per ha'], ['100L', 'per 100 L'], ['L', 'per L'], ['plant', 'per plant']], p.rate_per || '');
    const phi = input({ type: 'number', min: 0, value: p.phi_days ?? '' }), rei = input({ type: 'number', min: 0, step: 'any', value: p.rei_hours ?? '' });
    const mx = input({ type: 'number', min: 1, value: p.max_applications ?? '' }), wat = input({ type: 'number', min: 0, value: p.water_l_per_ha ?? '' });
    f.append(field('Rate as written', rt), field('Rate, a figure', rv), field('Unit', ru), field('Per', rp),
      field('Withholding, days', phi), field('Re-entry, hours', rei), field('Most applications', mx), field('Spray volume, L/ha', wat));
    d.body.append(el('div', 'pd-hlabel', 'Correct against the label'), f);
    const save = async verified => {
      try {
        const r = await rpc('save_ipm_product', { p: { id: p.id, rate_text: rt.value, rate_value: rv.value, rate_unit: ru.value, rate_per: rp.value,
          phi_days: phi.value, rei_hours: rei.value, max_applications: mx.value, water_l_per_ha: wat.value, ...(verified == null ? {} : { verified }) } });
        Object.assign(p, r); toast(verified ? 'Saved and marked as checked' : 'Saved', 'ok'); d.close(); libs.delete(cFarm.id); paintProducts();
      } catch (e) { toast(e.message, 'bad'); }
    };
    const sv = el('button', 'btn', 'Save'); sv.onclick = () => save(null);
    const ok = el('button', 'btn btn-primary', p.verified_at ? 'Save — still checked' : 'Save — I checked the label'); ok.onclick = () => save(true);
    if (p.verified_at) { const un = el('button', 'btn', 'Not checked after all'); un.onclick = () => save(false); d.footer.append(un); }
    d.footer.append(sv, ok);
  } else { const x = el('button', 'btn', 'Close'); x.onclick = d.close; d.footer.append(x); }
}
