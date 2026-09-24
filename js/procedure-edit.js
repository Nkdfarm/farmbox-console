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

// Daily / Weekly / Monthly are one choice since 0093: Routine, then its days and every n weeks
const FREQ = [['', '—'], ['Routine', 'Routine'],
              ['Per batch', 'Per batch'], ['Per crop template', 'Per crop template'], ['On demand', 'On demand']];
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
  const freq = selectBox(FREQ, p.frequency || '');
  // morning, afternoon or anytime: how the day is planned (0079); a rule's hour stays a detail
  const slot = selectBox([['any', 'Anytime'], ['am', 'Morning'], ['pm', 'Afternoon']], p.slot || 'any');
  const rule = input({ value: p.frequency_rule || '', placeholder: 'Anything the schedule cannot say' });
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
    grid('grid3', field('When', freq), field('Note', rule, 'Not read by the planner. An hour written here becomes the task\u2019s time.'),
         field('Repeats over', target)),
    sched.node,
    areasF, variantF, systemsF, oneTaskF,
    grid('grid3', field('Trigger', trigger), field('Validation', validation), field('Status', status)),
    grid('grid3', field('Minutes', minutes), field('People', people), field('Phone', appReady)),
    grid('grid3', field('Time of day', slot, 'Morning, afternoon or anytime — the boards order by it; open tasks follow a change.')),
    field('Purpose', purpose),
    grid('grid2', field('PPE', ppe), field('Tools', tools)),
  );
  showTarget();

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
      frequency: freq.value, frequency_rule: rule.value.trim(), slot: slot.value,
      ...(freq.value === 'Routine'
        ? { repeat_days: sched.days(), repeat_weeks: sched.weeks(), on_closed_days: sched.closed() } : {}),
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

// ── the schedule of a routine (0093) ──────────────────────────────────────
// The weekdays it falls on, every n weeks. A day the farm is closed is done on
// the next working day, unless the work may be done on a closed day (remote or
// on-call). The line under it says when the next ones fall at this farm.
function schedulePicker(p, farm, freq) {
  const node = el('div', 'field');
  const open = new Set(farm?.operating_days?.length ? farm.operating_days : [1, 2, 3, 4, 5, 6, 7]);
  const days = new Set(p.frequency === 'Routine' ? (p.repeat_days || []) : [1]);
  const monday = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const anchor = p.repeat_anchor ? monday(p.repeat_anchor + 'T12:00:00') : monday(new Date());

  const closedBox = el('input'); closedBox.type = 'checkbox'; closedBox.checked = !!p.on_closed_days;
  closedBox.style.width = 'auto';
  const closedL = el('label', 'row'); closedL.style.gap = '6px'; closedL.style.cursor = 'pointer';
  closedL.append(closedBox, el('span', null, 'May fall on a closed day (remote or on-call work)'));

  const row = el('div', 'row'); row.style.flexWrap = 'wrap'; row.style.alignItems = 'center';
  const buttons = WEEKDAYS.map(([n, label]) => {
    const b = el('button', 'toggle', label); b.type = 'button';
    b.onclick = () => { days.has(n) ? days.delete(n) : days.add(n); paint(); };
    return [n, b];
  });
  const all = el('button', 'btn btn-sm btn-ghost', 'Every working day'); all.type = 'button';
  all.onclick = () => { WEEKDAYS.forEach(([n]) => days.add(n)); paint(); };
  const weeks = input({ type: 'number', min: 1, max: 52, step: 1, value: p.frequency === 'Routine' ? (p.repeat_weeks || 1) : 1 });
  weeks.style.width = '70px';
  const unit = el('span');
  const every = el('span', 'row'); every.style.gap = '6px'; every.style.alignItems = 'center';
  every.append(el('span', null, 'Every'), weeks, unit);
  const spacer = el('span'); spacer.style.width = '12px';
  row.append(...buttons.map(x => x[1]), all, spacer, every);
  const next = el('div', 'hint');
  node.append(el('label', null, 'Days'), row, closedL, next);

  const n = () => Math.max(1, Math.min(52, parseInt(weeks.value, 10) || 1));
  const iso = d => ((d.getDay() + 6) % 7) + 1;
  const paint = () => {
    buttons.forEach(([d, b]) => {
      b.setAttribute('aria-pressed', String(days.has(d)));
      const closed = !open.has(d) && !closedBox.checked;
      b.style.opacity = closed ? '.55' : '';
      b.title = closed ? `${farm?.name || 'This FarmBox'} is closed that day: the work is done on the next working day` : '';
    });
    unit.textContent = n() === 1 ? 'week' : 'weeks';
    // the next few dates at this farm
    const out = [];
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for (let i = 0; i < 400 && out.length < 3; i++, d.setDate(d.getDate() + 1)) {
      if (!days.has(iso(d))) continue;
      const wk = Math.round((monday(d) - anchor) / (7 * 864e5));
      if (((wk % n()) + n()) % n() !== 0) continue;
      const due = new Date(d);
      if (!closedBox.checked) { let k = 0; while (!open.has(iso(due)) && k++ < 7) due.setDate(due.getDate() + 1); }
      const t = due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      if (!out.includes(t)) out.push(t);
    }
    next.textContent = days.size
      ? `${scheduleText({ frequency: 'Routine', repeat_days: [...days], repeat_weeks: n(), on_closed_days: closedBox.checked })}. `
        + `Next at ${farm?.name || 'this FarmBox'}: ${out.join(' · ') || '—'}`
      : 'Pick at least one day.';
    node.style.display = freq.value === 'Routine' ? '' : 'none';
  };
  weeks.oninput = paint;
  closedBox.onchange = paint;
  freq.addEventListener('change', paint);
  paint();
  return {
    node,
    days: () => [...days].sort((a, b) => a - b),
    weeks: n,
    closed: () => closedBox.checked,
  };
}
