// ═══════════════════════════════════════════════════════════════════════════
// Procedures › Edit (migration 0056, console 0.7.47)
//
// The details of a procedure and its checklist, in one drawer, saved with one
// call to save_procedure. The server decides whether the checklist changed:
// if it did, it becomes a new approved version and tasks not started yet move
// onto it; if not, only the details are written.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, field, input, selectBox, toast, drawer, busy, systemTypes, mediaList, scheduleText } from './ui.js';
import { familyOptions, subFamiliesOf } from './families.js';

// Repeats (0094): three choices. On a schedule = a routine with its days and every n weeks;
// with the crop plan = the batches' phases; when needed = a person starts it. The trigger follows.
const REPEATS = [['Routine', 'On a schedule'], ['Per batch', 'With the crop plan'], ['On demand', 'When needed']];
const repeatsOf = f => f === 'Routine' ? 'Routine' : (f === 'Per batch' || f === 'Per crop template') ? 'Per batch' : 'On demand';
const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const TARGETS = [['system', 'Each bay (per system)'], ['area', 'Each area'], ['farm', 'The whole FarmBox']];
// a crop-plan procedure may also make one task per crop (the harvests) or per batch
const CROP_TARGETS = [['crop', 'Each crop, per bay'], ['position', 'Each batch']];
const AREAS = [['zone', 'Zone'], ['sump', 'Sump'], ['room', 'Pump room'], ['nursery', 'Nursery'],
               ['packing', 'Packing'], ['office', 'Office'], ['outside', 'Outside']];
const TRIGGERS = [['routine', 'Routine'], ['crop_plan', 'Crop plan'], ['maintenance_rule', 'Maintenance rule'],
                  ['corrective', 'Corrective'], ['commissioning', 'Commissioning'], ['on_demand', 'On demand']];
const VALIDATION = [['tick', 'Tick'], ['checklist', 'Checklist'], ['checklist_evidence', 'Checklist with evidence']];
const STATUS = [['approved', 'Approved'], ['draft', 'Draft'], ['archived', 'Archived']];
const SECTIONS = [['preparation', 'Preparation'], ['safety', 'Safety'], ['execution', 'Execution'],
                  ['verification', 'Verification'], ['closing', 'Closing']];
const TYPES = [['action', 'Action'], ['check', 'Check'], ['measure', 'Measure'], ['record', 'Record'],
               ['photo', 'Photo'], ['video', 'Video']];
const EVIDENCE = [['none', 'None'], ['value', 'Value'], ['photo', 'Photo'],
                  ['photo_value', 'Photo + value'], ['video', 'Video']];

// On/off buttons over a set of values. A value already on the procedure that
// is not in the list (reservoir, climate, …) is shown too, so it is never lost.
function toggles(options, chosen) {
  const on = new Set(chosen || []);
  const known = new Set(options.map(o => o[0]));
  const row = el('div', 'row');
  row.style.flexWrap = 'wrap';
  [...options, ...[...on].filter(v => !known.has(v)).map(v => [v, v.replace(/_/g, ' ')])]
    .forEach(([v, text]) => {
      const b = el('button', 'toggle', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on.has(v)));
      b.onclick = () => {
        if (on.has(v)) on.delete(v); else on.add(v);
        b.setAttribute('aria-pressed', String(on.has(v)));
      };
      row.append(b);
    });
  row.value = () => [...on];
  return row;
}

function checkbox(label, checked, onChange) {
  const w = el('label', 'row');
  w.style.gap = '6px';
  w.style.flexWrap = 'nowrap';
  w.style.cursor = 'pointer';
  const c = input({ type: 'checkbox' });
  c.style.width = 'auto';
  c.style.flex = 'none';
  c.checked = !!checked;
  if (onChange) c.onchange = () => onChange(c.checked);
  w.append(c, el('span', null, label));
  w.value = () => c.checked;
  return w;
}

const textarea = (value, placeholder, rows = 2) => {
  const t = el('textarea');
  t.rows = rows;
  t.value = value || '';
  if (placeholder) t.placeholder = placeholder;
  t.style.width = '100%';
  return t;
};

export function editProcedure(p, subFamilies, onSaved, all = [], farm = null) {
  const d = drawer('Edit ' + p.title,
    `Version ${p.version ?? '—'} · a changed checklist is saved as a new version`);
  d.box.style.width = 'min(760px, 100vw)';

  // ── details ──
  const title = input({ value: p.title || '' });
  // family first, then its sub-families (Settings › Task families)
  const family = selectBox(familyOptions(p.family), p.family || 'Agriculture');
  const category = el('select');
  const fillSubs = keep => {
    category.textContent = '';
    [['', '—'], ...subFamiliesOf(family.value, keep).map(n => [n, n])].forEach(([v, t]) => {
      const o = el('option', null, t); o.value = v; category.append(o);
    });
    category.value = subFamiliesOf(family.value, keep).includes(keep) ? keep : '';
  };
  fillSubs(p.category || '');
  family.onchange = () => fillSubs(category.value);
  const dl = el('span');
  const freq = selectBox(REPEATS, repeatsOf(p.frequency));
  // morning, afternoon or anytime: how the day is planned (0079); a rule's hour stays a detail
  const slot = selectBox([['any', 'Anytime'], ['am', 'Morning'], ['pm', 'Afternoon']], p.slot || 'any');
  const sched = schedulePicker(p, farm, freq);
  const trigger = selectBox(TRIGGERS, p.trigger_kind || 'routine');
  const target = selectBox(p.trigger_kind === 'crop_plan' ? [...TARGETS, ...CROP_TARGETS] : TARGETS, p.target || 'farm');
  const areas = toggles(AREAS, p.area_kinds);
  // a system type, or a growing medium: {tray} is the tray benches, whatever their type (0077)
  const systems = toggles([...systemTypes(p.systems || []), ...mediaList(p.systems || []).map(([c, l]) => [c, 'Medium · ' + l])], p.systems);
  const areasF = field('Areas', areas, 'For a crop-plan job on the whole FarmBox: where it happens (nursery, packing).');
  const systemsF = field('Systems', systems);
  const fillTargets = () => {
    const list = trigger.value === 'crop_plan' ? [...TARGETS, ...CROP_TARGETS] : TARGETS;
    const keep = target.value;
    target.textContent = '';
    list.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; target.append(o); });
    target.value = list.some(([v]) => v === keep) ? keep : 'system';
  };
  // a variant: the same act on particular systems; the phase links the parent (0074)
  const parents = all.filter(x => x.trigger === 'crop_plan' && x.id !== p.id && !x.variant_of && x.status === 'approved')
    .sort((a, b) => a.title.localeCompare(b.title)).map(x => [x.id, x.title]);
  const variantOf = selectBox([['', '— (a procedure of its own)'], ...parents], p.variant_of || '');
  const variantF = field('Variant of', variantOf, 'The generic procedure a crop phase links; this one is used instead on the systems ticked below.');
  const showTarget = () => {
    const cropPlan = trigger.value === 'crop_plan';
    areasF.style.display = target.value === 'area' || (target.value === 'farm' && cropPlan) ? '' : 'none';
    variantF.style.display = cropPlan ? '' : 'none';
    oneTaskF.style.display = !cropPlan && ['system', 'area'].includes(target.value) ? '' : 'none';
    systemsF.style.display = (target.value === 'system' && !cropPlan) || (cropPlan && variantOf.value) ? '' : 'none';
  };
  target.onchange = showTarget;
  variantOf.onchange = showTarget;
  trigger.onchange = () => { fillTargets(); showTarget(); };
  const validation = selectBox(VALIDATION, p.validation || 'checklist');
  const minutes = input({ type: 'number', min: 1, step: '1', value: p.minutes ?? 5 });
  const people = input({ type: 'number', min: 1, step: '1', value: p.min_workers ?? 1 });
  const status = selectBox(STATUS, p.status || 'approved');
  const appReady = checkbox('App ready (shown on the phone)', p.app_ready);
  // a routine over systems or areas: one task a day with the targets listed (0076)
  const oneTask = checkbox('One task a day, the systems listed on it', p.one_task);
  const oneTaskF = field('Grouping', oneTask, 'For a checklist of ticks. A checklist that measures per system keeps one task per system.');
  const purpose = textarea(p.purpose, 'Why this procedure exists');
  const ppe = input({ value: Array.isArray(p.ppe) ? p.ppe.join(', ') : (p.ppe || '') });
  const tools = input({ value: Array.isArray(p.tools) ? p.tools.join(', ') : (p.tools || '') });

  const grid = (cls, ...fields) => { const g = el('div', cls); g.append(...fields); return g; };
  d.body.append(
    dl,
    grid('grid3', field('Title', title), field('Family', family),
         field('Sub-family', category, 'From Settings › Task families — the same list People uses.')),
    grid('grid2', field('Repeats', freq), field('One task for', target)),
    sched.node,
    areasF, variantF, systemsF, oneTaskF,
    grid('grid3', field('Validation', validation), field('Status', status), field('Phone', appReady)),
    grid('grid3', field('Minutes', minutes), field('People', people),
         field('Time of day', slot, 'Morning, afternoon or anytime — the boards order by it; open tasks follow a change.')),
    field('Purpose', purpose),
    grid('grid2', field('PPE', ppe), field('Tools', tools)),
  );
  showTarget();
  // the trigger follows Repeats, so the two cannot disagree (0094); corrective,
  // commissioning and maintenance-rule procedures keep theirs
  const syncTrigger = () => {
    const t = trigger.value;
    const want = freq.value === 'Per batch' ? 'crop_plan'
      : freq.value === 'Routine' ? (['crop_plan', 'on_demand'].includes(t) ? 'routine' : t)
      : (['routine', 'crop_plan'].includes(t) ? 'on_demand' : t);
    if (want !== t) { trigger.value = want; fillTargets(); showTarget(); }
  };
  freq.addEventListener('change', syncTrigger);
  syncTrigger();

  // ── checklist ──
  const steps = (p.steps || []).map(s => ({ ...s, from_seq: s.seq }));
  const box = el('div');
  const paint = () => {
    box.textContent = '';
    steps.forEach((s, i) => {
      const card = el('div', 'card card-pad');
      card.style.marginBottom = 'var(--space-3)';

      const head = el('div', 'row');
      head.style.flexWrap = 'nowrap';
      head.append(el('b', null, String(i + 1)));
      const t = input({ value: s.title || '', placeholder: 'What to do' });
      t.style.flex = '1';
      t.oninput = () => { s.title = t.value; };
      const up = el('button', 'btn btn-sm', '↑');
      up.title = 'Move up';
      up.disabled = i === 0;
      up.onclick = () => { steps.splice(i - 1, 0, steps.splice(i, 1)[0]); paint(); };
      const dn = el('button', 'btn btn-sm', '↓');
      dn.title = 'Move down';
      dn.disabled = i === steps.length - 1;
      dn.onclick = () => { steps.splice(i + 1, 0, steps.splice(i, 1)[0]); paint(); };
      const rm = el('button', 'btn btn-sm', 'Remove');
      rm.onclick = () => { steps.splice(i, 1); paint(); };
      head.append(t, up, dn, rm);
      card.append(head);

      const ins = textarea(s.instruction, 'Instruction (shown in training mode)');
      ins.style.marginTop = 'var(--space-2)';
      ins.oninput = () => { s.instruction = ins.value; };
      card.append(ins);

      const type = selectBox(TYPES, s.type || 'action');
      const section = selectBox(SECTIONS, s.section || 'execution');
      const ev = selectBox(EVIDENCE, s.evidence || 'none');
      type.onchange = () => { s.type = type.value; paint(); };
      section.onchange = () => { s.section = section.value; };
      ev.onchange = () => { s.evidence = ev.value; };
      const g1 = grid('grid3', field('Type', type), field('Section', section), field('Evidence', ev));
      g1.style.marginTop = 'var(--space-2)';
      card.append(g1);

      if (s.type === 'measure') {
        const mn = input({ type: 'number', step: 'any', value: s.min ?? '' });
        const mx = input({ type: 'number', step: 'any', value: s.max ?? '' });
        const un = input({ value: s.unit || '', placeholder: 'e.g. mS/cm' });
        mn.oninput = () => { s.min = mn.value; };
        mx.oninput = () => { s.max = mx.value; };
        un.oninput = () => { s.unit = un.value; };
        const gm = grid('grid3', field('Min', mn), field('Max', mx), field('Unit', un));
        gm.style.marginTop = 'var(--space-2)';
        card.append(gm);
      }

      const exp = input({ value: s.expected || '', placeholder: 'What good looks like' });
      exp.oninput = () => { s.expected = exp.value; };
      const mins = input({ type: 'number', min: 0, step: 'any', value: s.minutes ?? '' });
      mins.oninput = () => { s.minutes = mins.value; };
      const crit = checkbox('Critical — a failure stops the run', s.critical, v => { s.critical = v; });
      const g2 = grid('grid3', field('Expected', exp), field('Minutes', mins), field('Critical', crit));
      g2.style.marginTop = 'var(--space-2)';
      card.append(g2);

      const ap = input({ value: s.action_plan || '', placeholder: 'If it fails, do this' });
      ap.oninput = () => { s.action_plan = ap.value; };
      card.append(field('Action plan', ap));
      box.append(card);
    });
    if (!steps.length) box.append(el('div', 'hint', 'No steps yet.'));
  };

  const sh = el('div', 'row');
  sh.append(el('div', 'sec-title', 'Checklist'), el('div', 'spacer'));
  const add = el('button', 'btn btn-sm', '+ Add step');
  add.onclick = () => {
    steps.push({ title: '', type: 'check', section: 'execution', evidence: 'none' });
    paint();
    box.lastElementChild?.querySelector('input')?.focus();
  };
  sh.append(add);
  const note = input({ placeholder: 'What changed — kept with the new version' });
  d.body.append(sh, box, field('Change note', note));
  paint();

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save');
  save.onclick = async () => {
    if (!title.value.trim()) { toast('A procedure needs a title', 'bad'); return; }
    const blank = steps.findIndex(s => !String(s.title || '').trim());
    if (blank >= 0) { toast(`Step ${blank + 1} needs a title`, 'bad'); return; }
    if (freq.value === 'Routine' && !sched.days().length) { toast('Pick at least one day', 'bad'); return; }
    const measure = s => s.type === 'measure';
    const payload = {
      title: title.value.trim(), family: family.value, category: category.value.trim(),
      frequency: freq.value, slot: slot.value,
      ...(freq.value === 'Routine'
        ? { repeat_days: sched.days(), repeat_weeks: sched.weeks(), on_holidays: sched.holidays() } : {}),
      target_kind: target.value, area_kinds: areas.value(), systems: systems.value(),
      variant_of: trigger.value === 'crop_plan' ? variantOf.value : '',
      trigger_kind: trigger.value, validation: validation.value,
      estimated_minutes: Number(minutes.value) || 5, min_workers: Number(people.value) || 1,
      purpose: purpose.value, safety_ppe: ppe.value, tools: tools.value,
      status: status.value, app_ready: appReady.value(), one_task: oneTask.value(),
      change_note: note.value.trim(),
      steps: steps.map(s => ({
        from_seq: s.from_seq ?? null,
        title: String(s.title).trim(), instruction: s.instruction || '',
        type: s.type || 'action', section: s.section || 'execution', evidence: s.evidence || 'none',
        min: measure(s) ? (s.min ?? '') : '', max: measure(s) ? (s.max ?? '') : '',
        unit: measure(s) ? (s.unit || '') : '',
        expected: s.expected || '', minutes: s.minutes ?? '', critical: !!s.critical,
        action_plan: s.action_plan || '',
      })),
    };
    busy(save, true, 'Saving…');
    try {
      const r = await rpc('save_procedure', { p_sop: p.id, p: payload });
      toast(r.new_version
        ? `Saved · checklist version ${r.version}` +
          (r.tasks_moved ? ` · ${r.tasks_moved} open task${r.tasks_moved === 1 ? '' : 's'} updated` : '')
        : 'Saved', 'ok');
      d.close();
      await onSaved?.();
    } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}

// ── the schedule of a routine (0093, 0094) ────────────────────────────────
// The weekdays it is done on, every n weeks. A ticked day is done that day; all
// seven = every working day. The Holidays day: also on every holiday (remote or
// on-call work) — anything else on a holiday moves to the next working day. The
// line under it says when the next ones fall at this farm, holidays included.
function schedulePicker(p, farm, freq) {
  const node = el('div', 'field');
  const open = new Set(farm?.operating_days?.length ? farm.operating_days : [1, 2, 3, 4, 5, 6, 7]);
  const days = new Set(p.frequency === 'Routine' ? (p.repeat_days || []) : [1]);
  let onHol = p.frequency === 'Routine' && !!p.on_holidays;
  let hols = new Map();                       // closed days ahead: ymd → name
  const ymdOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monday = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const anchor = p.repeat_anchor ? monday(p.repeat_anchor + 'T12:00:00') : monday(new Date());
  const iso = d => ((d.getDay() + 6) % 7) + 1;
  const farmName = farm?.name || 'this FarmBox';

  const row = el('div', 'row'); row.style.flexWrap = 'wrap'; row.style.alignItems = 'center';
  const buttons = WEEKDAYS.map(([n, label]) => {
    const b = el('button', 'toggle', label); b.type = 'button';
    b.onclick = () => { days.has(n) ? days.delete(n) : days.add(n); paint(); };
    return [n, b];
  });
  const holB = el('button', 'toggle', 'Holidays'); holB.type = 'button';
  holB.title = 'Also done on every public holiday and closure — remote or on-call work. Anything else on a holiday moves to the next working day.';
  holB.onclick = () => { onHol = !onHol; paint(); };
  const all = el('button', 'btn btn-sm btn-ghost', 'Every working day'); all.type = 'button';
  all.onclick = () => { WEEKDAYS.forEach(([n]) => days.add(n)); paint(); };
  const weeks = input({ type: 'number', min: 1, max: 52, step: 1, value: p.frequency === 'Routine' ? (p.repeat_weeks || 1) : 1 });
  weeks.style.width = '70px';
  const unit = el('span');
  const every = el('span', 'row'); every.style.gap = '6px'; every.style.alignItems = 'center';
  every.append(el('span', null, 'Every'), weeks, unit);
  const spacer = el('span'); spacer.style.width = '12px';
  row.append(...buttons.map(x => x[1]), holB, all, spacer, every);
  const next = el('div', 'hint');
  const warn = el('div', 'hint');
  node.append(el('label', null, 'Days'), row, next, warn);

  const n = () => Math.max(1, Math.min(52, parseInt(weeks.value, 10) || 1));
  const openDay = d => open.has(iso(d)) && !hols.has(ymdOf(d));
  // the same rule as app.routine_due
  const dueFor = d => {
    const isHol = hols.has(ymdOf(d));
    if (onHol && isHol) return new Date(d);
    const wk = Math.round((monday(d) - anchor) / (7 * 864e5));
    if (((wk % n()) + n()) % n() !== 0) return null;
    if (days.size === 7) return !isHol && open.has(iso(d)) ? new Date(d) : null;
    if (!days.has(iso(d))) return null;
    if (!isHol) return new Date(d);
    const x = new Date(d); let k = 0;
    while (!openDay(x) && k++ < 21) x.setDate(x.getDate() + 1);
    return x;
  };
  const paint = () => {
    buttons.forEach(([d, b]) => {
      b.setAttribute('aria-pressed', String(days.has(d)));
      b.style.opacity = !open.has(d) && !days.has(d) ? '.55' : '';
      b.title = open.has(d) ? '' : `${farmName} is closed that day`;
    });
    holB.setAttribute('aria-pressed', String(onHol));
    unit.textContent = n() === 1 ? 'week' : 'weeks';
    const out = [];
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for (let i = 0; i < 400 && out.length < 3; i++, d.setDate(d.getDate() + 1)) {
      const due = dueFor(d);
      if (!due) continue;
      const t = due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              + (hols.has(ymdOf(due)) ? ` (${hols.get(ymdOf(due))})` : '');
      if (!out.includes(t)) out.push(t);
    }
    next.textContent = days.size || onHol
      ? `${scheduleText({ frequency: 'Routine', repeat_days: [...days], repeat_weeks: n(), on_holidays: onHol })}. `
        + `Next at ${farmName}: ${out.join(' · ') || '—'}`
      : 'Pick at least one day.';
    const closedTicked = days.size < 7 ? WEEKDAYS.filter(([d]) => days.has(d) && !open.has(d)).map(x => x[1]) : [];
    warn.textContent = closedTicked.length
      ? `${closedTicked.join(', ')}: ${farmName} is closed — the task is still made on ${closedTicked.length === 1 ? 'that day' : 'those days'}.` : '';
    node.style.display = freq.value === 'Routine' ? '' : 'none';
  };
  weeks.oninput = paint;
  freq.addEventListener('change', paint);
  paint();
  // this farm's holidays, for the dates under the buttons
  if (farm?.id) {
    const from = new Date(), to = new Date(); to.setDate(to.getDate() + 420);
    rpc('farm_holidays', { p_farm: farm.id, p_from: ymdOf(from), p_to: ymdOf(to) })
      .then(r => { hols = new Map((r.holidays || []).filter(h => h.closed).map(h => [h.day, h.name])); paint(); })
      .catch(() => {});
  }
  return {
    node,
    days: () => [...days].sort((a, b) => a - b),
    weeks: n,
    holidays: () => onHol,
  };
}
