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
//   Spray volume (0.7.290, migration 0269): each application has its own volume, from each table's crop phase and the
//   label's range; it can be changed per application in the preview. Products › Spray volumes: the unit's own, by crop
//   and phase (openSprayVolumes).
// The system proposes: a treatment starts when the Admin, the Farm manager or the Agronomist says so.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { el, num, drawer, toast, busy, input, field, selectBox, pageHead, table, loading, confirmDrawer } from './ui.js';
import { openProduct, openChangeLog, openNewProduct, expiryPill } from './product.js';
import { KIND, GROUPS, kindOk } from './kinds.js';

const parse = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = s => parse(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const longDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const METHOD = { biological: 'Biological', chemical: 'Chemical', integrated: 'Integrated', cultural: 'Cultural', mechanical: 'Mechanical' };
const CATEGORY = { leafy: 'Leafy', mixed_leafy: 'Mixed leafy', herbs: 'Herbs', microgreens: 'Microgreens', fruiting_vines: 'Fruiting vines', fruiting_bush: 'Fruiting bush' };
// one colour and one letter per product, in the order the database gives (the same product keeps its colour)
const hueOf = i => Math.round((28 + i * 137.5) % 360);
const letterOf = i => String.fromCharCode(65 + (i % 26));
const qtyText = (q, unit) => q == null ? '—' : unit === 'kg' && Math.abs(q) < 1 && q !== 0 ? `${num(q * 1000, Math.abs(q) < 0.01 ? 2 : 0)} g` : unit === 'ml' && q >= 1000 ? `${num(q / 1000, 2)} L` : unit === 'g' && q >= 1000 ? `${num(q / 1000, 2)} kg`
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
  // a fold (0.7.200, owner: "collapsible with just the KPI on top … closed if no products applied"): the line says
  // applied / planned, green at 0/0; it opens by itself only when the zone has an application
  const box = el('details', 'tr-block pd-fold');
  const s0 = el('summary'); s0.append(el('span', 'pd-hlabel', 'Treatments'), el('span', 'hint', 'reading…'));
  box.append(s0);
  const read = () => (calm || rpc)('zone_treatments', { p_farm: farm.id, p_zone: z.zone_id, p_system: z.system_id || null, p_day: day.day });
  const again = async () => { try { paintBlock(box, farm, z, await read(), again, onChange); } catch (e) { /* the next opening reads it again */ } };
  box.load = async () => {
    const say = (cls, text) => { box.textContent = ''; const s = el('summary'); s.append(el('span', 'pd-hlabel', 'Treatments'), el('span', cls, text)); box.append(s); };
    if (!z.zone_id) { say('hint', 'no zone here'); return; }
    try { paintBlock(box, farm, z, await read(), again, onChange); }
    catch (e) { say('pill bad', e.message); }
  };
  return box;
}

function paintBlock(box, farm, z, t, again, onChange) {
  box.textContent = '';
  const running = (t.programs || []).filter(p => p.state === 'running');
  // the KPI: applications applied / planned over the programs running here; 0/0 is green — nothing to treat
  const done = running.reduce((a, p) => a + Number(p.done || 0), 0), total = running.reduce((a, p) => a + Number(p.total || 0), 0);
  const head = el('summary', 'tr-head');
  const kpi = el('span', 'tr-kpi ' + (done >= total ? 'ok' : 'run'), `${done}/${total}`);
  kpi.title = total ? `${done} of ${total} applications applied, over ${running.length} program${running.length === 1 ? '' : 's'} running here` : 'No treatment running on this zone';
  head.append(el('span', 'pd-hlabel', 'Treatments'), kpi);
  if (!box.dataset.seen) { if (!box.keepClosed) box.open = (t.applications || []).length > 0; box.dataset.seen = '1'; }
  // the flag: a program runs here
  const flag = el('span', 'tr-flag' + (running.length ? ' on' : ''), running.length ? `⚑ ${running.length === 1 ? running[0].name : running.length + ' programs running'}` : '');
  if (running.length) flag.title = running.map(p => `${p.name} — ${p.tables}`).join('\n');
  head.append(flag, el('span', 'spacer'));
  if (t.may_treat) {
    const b = el('button', 'btn btn-sm btn-primary', 'Apply…');
    b.title = 'Start an IPM program on the tables of this zone';
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); openApply(farm, z, { cases: t.open_cases || [], onDone: () => { box.open = true; again(); onChange?.(); } }); };
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
    applications: 1, interval: 7, positions: null, start: '', water: '', waterBy: {}, issue: opts.cases?.[0]?.id || '', pv: null };
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
              field('Spray volume, L/ha', waterIn, 'For every application; empty = each one by its tables\' crop phase, inside the label\'s range'),
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
        if (t.unverified) { const u = el('span', 'pill warn', 'not validated'); u.title = `${t.unverified} of its products were not yet validated against the label by a person`; h.append(u); }
        c.append(h, el('div', 'hint', t.steps.map(s => `${s.product} ×${s.applications}${s.applications > 1 ? ' every ' + s.interval_days + ' d' : ''}`).join(' → ')
          + ` · ${t.days || 0} days` + (t.withholding ? ` · withholding up to ${t.withholding} d` : '')));
        if (t.summary) c.append(el('div', 'tr-tpl-sum', t.summary));
        c.onclick = () => { state.template = t.id; state.waterBy = {}; paintChoice(); refresh(); };
        choice.append(c);
      });
    } else {
      const list = lib.products.filter(p => (!state.target || (p.targets || []).includes(state.target))
        && (!state.method || p.method === state.method || state.method === 'integrated'));
      const sel = selectBox([['', 'Choose a product…'], ...list.map(p => [p.id, `${p.name} — ${p.supplier}${p.verified_at ? '' : ' (not validated)'}${p.own ? ' · ours' : ''}`])], state.product || '');
      const apps = input({ type: 'number', min: 1, max: 52, value: state.applications });
      const intv = input({ type: 'number', min: 1, max: 90, value: state.interval });
      sel.onchange = () => { state.product = sel.value || null; state.waterBy = {}; const p = lib.products.find(x => x.id === state.product);
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
          // from the choice already made, not from the last preview: a click before the program is chosen,
          // or two quick clicks, used to bring back a table just taken off (review 3 Oct 2026)
          const on = new Set(state.positions ?? tables.filter(x => x.on).map(x => x.id));
          on.has(t.id) ? on.delete(t.id) : on.add(t.id);
          state.positions = [...on];
          b.classList.toggle('on', on.has(t.id)); b.setAttribute('aria-pressed', String(on.has(t.id)));
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
    position_ids: state.positions || [], start_date: state.start || null, water_l_per_ha: state.water || null, water_by: state.waterBy, issue_id: state.issue || null,
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
        try { const pv = await rpc('ipm_preview', { p: { ...args(), template_id: null, steps: [{ product_id: lib.products[0].id }] } }, { quiet: true }); if (mine === seq) paintTables(pv.scope); } catch (e) { /* shown with the program */ }
      }
      return;
    }
    out.classList.add('stale');
    try {
      const pv = await rpc('ipm_preview', { p: args() }, { quiet: true });
      if (mine !== seq) return;
      state.pv = pv;
      paintTables(pv.scope);
      paintPreview(pv);
      go.disabled = !pv.may_treat || !pv.scope.count || !pv.applications.length;
    } catch (e) { if (mine === seq) { out.textContent = ''; out.append(el('div', 'note bad', e.message)); } }
    finally { if (mine === seq) out.classList.remove('stale'); }
  }

  // one application's volume: its figure, changed in place; why it is that figure under it
  function volumeBox(r) {
    const key = `${r.step_seq}/${r.rep}`;
    const w = r.water || {};
    const box = input({ type: 'text', value: String(Math.round(Number(r.water_l_per_ha))) });
    box.inputMode = 'decimal'; box.size = 5; box.className = 'tr-vol' + (w.outside ? ' bad' : '');
    const range = w.min != null || w.max != null ? `label ${w.min ?? '…'}–${w.max ?? '…'} L/ha` : 'no range on the label';
    box.title = `${range}. Empty: back to ${state.water ? 'the treatment\'s' : 'the crop phase\'s'}.`;
    box.onchange = () => {
      const val = box.value.trim().replace(',', '.');
      if (!val) delete state.waterBy[key]; else state.waterBy[key] = val;
      refresh();
    };
    const why = { farm: 'your volume', default: 'share of the label\'s most', product: 'the product\'s', treatment: 'typed', application: 'typed', mixed: 'mixed' }[w.source] || '';
    const s = el('span');
    s.append(box, el('div', 'hint', [w.text && w.text !== 'as typed' ? w.text : null, why, w.clamped ? 'kept in the label\'s range' : null].filter(Boolean).join(' · ')));
    return s;
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
      { key: 'qty', label: 'For these tables', align: 'right', fmt: (v, r) => {
        if (v == null) return 'measure from the label';
        const s = el('span');
        s.append(qtyText(Number(v), r.qty_unit));
        if (r.qty_capped) { const c = el('span', 'pill warn', r.qty_capped === 'max' ? 'label\'s most/ha' : 'label\'s least/ha'); c.title = 'Held to the label\'s limit per hectare'; s.append(' ', c); }
        if (r.per_l != null) s.append(el('div', 'hint', `${num(Number(r.per_l), 3)} ${r.qty_unit || ''} per L`));
        return s;
      } },
      { key: 'water_l_per_ha', label: 'L/ha', align: 'right', fmt: (v, r) => v == null ? '—' : volumeBox(r) },
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
  pMount.append(pageHead(null, `${lib.templates.length} programs over ${lib.products.length} products. `
    + 'A program is a sequence of products against one pest or disease; start one from a zone\'s report (Apply…).'));
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
      { key: 'name', label: 'Program', fmt: (v, r) => { const b = el('b', null, v); const w = el('span'); w.append(b); if (r.unverified) { const u = el('span', 'pill warn', 'not validated'); u.title = 'Not yet validated against the label by a person'; u.style.marginLeft = '6px'; w.append(u); } return w; } },
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
const cf = { stock: '', supplier: '', kind: '', target: '', group: '', q: '', check: '', origin: '' };
const soonDays = r => r.expires_on ? (new Date(r.expires_on + 'T12:00:00') - new Date()) / 864e5 : Infinity;
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
  const own = lib.products.filter(p => p.own).length;
  if (!own) cf.origin = '';   // its select is shown only when there is one of our own
  const label = code => lib.catalog.find(k => k.code === code)?.label || code;
  // the product's drawer (js/product.js); what it changed shows in the list when it closes
  const again = () => { libs.delete(cFarm.id); if (cMount?.isConnected) renderIpmProducts(cMount, cFarm); };
  const openOne = p => openProduct(cFarm, p, label, { farmName: cFarm.name, catalog: lib.catalog, onChanged: again, autoRead: !!p._autoRead });
  // the catalogue's log (0.7.284): every reading of the AI, every validation and change
  const logBtn = el('button', 'btn btn-sm', 'Change log');
  logBtn.onclick = () => openChangeLog(cFarm, id => { const p = lib.products.find(x => x.id === id); if (p) openOne(p); });
  // a product of our own, by hand or from its label photos (0.7.285)
  const volBtn = el('button', 'btn btn-sm', 'Spray volumes');
  volBtn.title = 'What your sprayer puts on, by crop and phase';
  volBtn.onclick = () => openSprayVolumes(cFarm);
  const head = [volBtn, logBtn];
  if (lib.may_label) {
    const add = el('button', 'btn btn-sm btn-primary', 'New product');
    add.onclick = () => openNewProduct(cFarm, lib.products, p => openOne(p), p => openOne(p));
    head.unshift(add);
  }
  cMount.append(pageHead(null, `${lib.products.length} crop-protection products of ${new Set(lib.products.map(p => p.supplier)).size} suppliers`
    + `${own ? `, ${own} of them our own` : ''}; ${checked} validated against the label by a person. Each is also a stock item on Office › Stock. `
    + 'Open one to add its label photos, have the AI read them and add stock.', ...head));

  // the store first (owner 29 Oct 2026: "add a filter on top (on stock)"), then validated or not
  const stSel = selectBox([['', 'In the store or not'], ['in', 'In the store'], ['out', 'Not in the store'], ['soon', 'Expires within 90 days'],
    ['living', 'Living (never stocked)']], cf.stock);
  const sSel = selectBox([['', 'Every supplier'], ...[...new Set(lib.products.map(p => p.supplier))].sort().map(s => [s, s])], cf.supplier);
  const kSel = selectBox([['', 'Any kind'], ...Object.entries(GROUPS).map(([k, g]) => [k, g.label]), ...Object.entries(KIND)], cf.kind);
  kSel.title = 'Low-residue: mineral, physical, botanical, microbial, elicitor and semiochemical';
  const tSel = selectBox([['', 'Any target'], ...[...new Set(lib.products.flatMap(p => p.targets || []))].map(c => [c, label(c)]).sort((a, b) => a[1].localeCompare(b[1]))], cf.target);
  // a mixture is in each of its groups; 4A and 4D are both group 4 (0270: app.moa_keys)
  const gSel = selectBox([['', 'Any group'], ...[...new Set(lib.products.flatMap(p => p.groups || []))]
    .sort((a, b) => a.split(' ').pop().localeCompare(b.split(' ').pop()) || a.localeCompare(b, 'en', { numeric: true })).map(g => [g, g])], cf.group);
  gSel.title = 'A mixture is under each of its groups. 4A and 4D are one group (4), a miticide is with the insecticides, a bactericide with the fungicides.';
  const vSel = selectBox([['', 'Validated or not'], ['yes', 'Validated'], ['no', 'Not validated'], ['ai', 'AI reading to review'], ['photos', 'With label photos'], ['nophotos', 'No label photo yet']], cf.check);
  const oSel = selectBox([['', 'Catalogue and ours'], ['catalogue', 'The catalogue'], ['own', 'Our own']], cf.origin);
  const q = input({ type: 'search', placeholder: 'name or active', value: cf.q });
  const list = el('div');
  const has = p => !p.perishable && Number(p.on_hand) > 0;
  const keep = {
    stock: p => !cf.stock || (cf.stock === 'in' ? has(p) : cf.stock === 'out' ? !p.perishable && !has(p) : cf.stock === 'soon' ? has(p) && soonDays(p) < 90 : p.perishable),
    check: p => !cf.check || (cf.check === 'yes' ? !!p.verified_at : cf.check === 'no' ? !p.verified_at : cf.check === 'ai' ? !!p.open_check
      : cf.check === 'photos' ? Number(p.photos) > 0 : !Number(p.photos)),
    origin: p => !cf.origin || (cf.origin === 'own') === !!p.own,
  };
  const draw = () => {
    cf.stock = stSel.value; cf.supplier = sSel.value; cf.kind = kSel.value; cf.target = tSel.value; cf.group = gSel.value; cf.check = vSel.value; cf.origin = oSel.value;
    cf.q = q.value.trim().toLowerCase();
    const rows = lib.products.filter(p => keep.stock(p) && keep.check(p) && keep.origin(p)
      && (!cf.supplier || p.supplier === cf.supplier) && kindOk(cf.kind, p.kind)
      && (!cf.target || (p.targets || []).includes(cf.target))
      && (!cf.group || (p.groups || []).includes(cf.group))
      && (!cf.q || (p.name + ' ' + (p.active_ingredient || '') + ' ' + p.supplier).toLowerCase().includes(cf.q)));
    list.textContent = '';
    const count = el('div', 'hint tr-count', `${rows.length} of ${lib.products.length} product${lib.products.length === 1 ? '' : 's'}`);
    if (Object.values(cf).some(Boolean)) {
      const clear = el('button', 'btn btn-sm btn-ghost', 'Clear the filters');
      clear.onclick = () => { Object.keys(cf).forEach(k => { cf[k] = ''; }); paintProducts(); };
      count.append(' ', clear);
    }
    list.append(count);
    list.append(table([
      { key: 'name', label: 'Product', fmt: (v, r) => { const w = el('span'); w.append(el('b', null, v)); if (r.own) w.append(' ', el('span', 'pill info', 'ours')); return w; } },
      { key: 'supplier', label: 'Supplier' },
      { key: 'kind', label: 'Kind', fmt: v => KIND[v] || v },
      { key: 'active_ingredient', label: 'Active' },
      { key: 'moa_group', label: 'Resistance group' },
      { key: 'targets', label: 'Against', fmt: v => (v || []).map(label).join(', ') },
      { key: 'rate_text', label: 'Label rate' },
      { key: 'phi_days', label: 'Withholding', align: 'right', fmt: v => v == null ? '?' : v + ' d' },
      { key: 'on_hand', label: 'In the store', align: 'right', fmt: (v, r) => {
          if (r.perishable) return 'living';
          if (!Number(v)) return '—';
          const w = el('span', 'tr-store', qtyText(Number(v), r.unit));
          // an expiry within 90 days, beside the quantity (0.7.284)
          if (soonDays(r) < 90) w.append(' ', expiryPill(r.expires_on));
          return w; } },
      { key: 'verified_at', label: 'Label', fmt: (v, r) => {
          const w = el('span', 'tr-label');
          w.append(el('span', 'pill ' + (v ? 'ok' : 'warn'), v ? 'validated' : 'not validated'));
          if (r.open_check) { const a = el('span', 'pill info', 'AI reading to review'); a.title = 'The AI read the label; a person has not validated it yet.'; w.append(' ', a); }
          if (Number(r.photos)) { const c = el('span', 'hint', ` · ${r.photos} photo${r.photos === 1 ? '' : 's'}`); w.append(c); }
          return w; } },
    ], rows, { onRow: openOne, empty: 'No product matches these filters.' }));
  };
  const parts = [['In the store', stSel], ['Validated', vSel], ['Supplier', sSel], ['Kind', kSel], ['Against', tSel]];
  if (lib.products.some(p => (p.groups || []).length)) parts.push(['Resistance group', gSel]);
  if (own) parts.push(['Origin', oSel]);
  parts.push(['Search', q]);
  cMount.append(filterBar(parts, draw), list);
  draw();
}

// ── Spray volumes (0.7.290, migration 0269): what the unit's sprayer puts on, L/ha, by crop and phase ──
const PHASE = { germination: 'Germination', nursery: 'Nursery', transplant: 'Transplant', vegetative: 'Vegetative', flowering: 'Flowering',
  harvest_window: 'Harvest window', cleanup: 'Clean-up' };
export function openSprayVolumes(farm) {
  const d = drawer('Spray volumes', 'What your sprayer puts on, by crop and phase — the plan keeps it inside each label\'s range');
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close);
  d.body.append(loading('Reading the volumes…'));
  const paint = sv => {
    d.body.textContent = '';
    d.body.append(el('div', 'hint', 'Until a volume is set here, a product whose label gives a range gets a share of its most: '
      + Object.entries(PHASE).map(([k, l]) => `${l.toLowerCase()} ${Math.round(Number(sv.shares[k]) * 100)} %`).join(', ')
      + ' (a table with no crop 100 %), never below its least. A product with no range keeps its own figure, else 1 000 L/ha. '
      + 'The most precise line wins: a phase before any phase, a crop before its category.'));
    if (!sv.rows.length) d.body.append(el('div', 'note', 'No volume set yet.'));
    else d.body.append(table([
      { key: 'crop', label: 'Crop', fmt: (v, r) => v || (r.crop_category ? `${CATEGORY[r.crop_category] || r.crop_category} (every crop)` : 'Any crop') },
      { key: 'phase_type', label: 'Phase', fmt: v => v ? PHASE[v] || v : 'Any phase' },
      { key: 'l_per_ha', label: 'L/ha', align: 'right', fmt: v => num(Number(v)) },
      { key: 'note', label: 'Note', fmt: v => v || '—' },
      { key: 'set_at', label: 'Set', fmt: (v, r) => [r.set_name, v ? shortDay(v) : null].filter(Boolean).join(', ') },
      ...(sv.may_change ? [{ key: 'id', label: '', fmt: (v, r) => {
        const b = el('span');
        const ed = el('button', 'btn btn-sm btn-ghost', 'Change'); ed.onclick = () => form(sv, r);
        const rm = el('button', 'btn btn-sm btn-ghost', 'Remove');
        rm.onclick = async () => {
          if (!await confirmDrawer('Remove this volume?', 'Applications planned from now on take the next line, or the label\'s share. Planned ones keep theirs.', 'Remove', true)) return;
          busy(rm, true, 'Removing…');
          try { paint(await rpc('remove_spray_volume', { p_farm: farm.id, p_id: r.id })); toast('Removed', 'ok'); }
          catch (e) { busy(rm, false); toast(e.message, 'bad'); }
        };
        b.append(ed, rm);
        return b;
      } }] : []),
    ], sv.rows));
    if (sv.may_change) {
      const add = el('button', 'btn btn-primary', 'Add a volume');
      add.onclick = () => form(sv, null);
      d.body.append(add);
    } else d.body.append(el('div', 'hint', 'Set by the unit\'s Admin, Farm manager or Agronomist.'));
  };
  const form = (sv, r) => {
    const f = drawer(r ? 'Change a volume' : 'Add a volume', 'Litres per hectare, as your sprayer puts it on');
    const cats = [...new Set(sv.crops.map(c => c.category).filter(Boolean))].sort();
    const crop = selectBox([['', 'Any crop'], ...cats.map(c => ['cat:' + c, `${CATEGORY[c] || c} (every crop)`]), ...sv.crops.map(c => [c.id, c.name])],
      r ? (r.crop_id || (r.crop_category ? 'cat:' + r.crop_category : '')) : '');
    const phase = selectBox([['', 'Any phase'], ...Object.entries(PHASE)], r?.phase_type || '');
    const lha = input({ type: 'text', value: r ? String(Number(r.l_per_ha)) : '', placeholder: 'e.g. 600' }); lha.inputMode = 'decimal';
    const note = input({ value: r?.note || '', placeholder: 'e.g. boom at 1 m, 3 bar' });
    f.body.append(field('Crop', crop), field('Phase', phase), field('L/ha', lha), field('Note', note));
    const save = el('button', 'btn btn-primary', 'Save');
    save.onclick = async () => {
      const c = crop.value;
      busy(save, true, 'Saving…');
      try {
        paint(await rpc('save_spray_volume', { p_farm: farm.id, p: { id: r?.id, crop_id: c && !c.startsWith('cat:') ? c : null,
          crop_category: c.startsWith('cat:') ? c.slice(4) : null, phase_type: phase.value || null, l_per_ha: lha.value.trim(), note: note.value } }));
        toast('Saved', 'ok'); f.close();
      } catch (e) { busy(save, false); toast(e.message, 'bad'); }
    };
    const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = f.close;
    f.footer.append(save, el('span', 'spacer'), cancel);
  };
  rpc('spray_volumes', { p_farm: farm.id }).then(paint).catch(e => { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); });
}
