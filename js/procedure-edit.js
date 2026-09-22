// ═══════════════════════════════════════════════════════════════════════════
// Procedures › Edit (migration 0056, console 0.7.47)
//
// The details of a procedure and its checklist, in one drawer, saved with one
// call to save_procedure. The server decides whether the checklist changed:
// if it did, it becomes a new approved version and tasks not started yet move
// onto it; if not, only the details are written.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, field, input, selectBox, toast, drawer, busy, systemTypes } from './ui.js';
import { familyOptions, subFamiliesOf } from './families.js';

const FREQ = [['', '—'], ['Daily', 'Daily'], ['Weekly', 'Weekly'], ['Monthly', 'Monthly'],
              ['Per batch', 'Per batch'], ['Per crop template', 'Per crop template'], ['On demand', 'On demand']];
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

export function editProcedure(p, subFamilies, onSaved, all = []) {
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
  const rule = input({ value: p.frequency_rule || '', placeholder: 'e.g. Mondays at 08:00' });
  const trigger = selectBox(TRIGGERS, p.trigger_kind || 'routine');
  const target = selectBox(p.trigger_kind === 'crop_plan' ? [...TARGETS, ...CROP_TARGETS] : TARGETS, p.target || 'farm');
  const areas = toggles(AREAS, p.area_kinds);
  const systems = toggles(systemTypes(p.systems || []), p.systems);
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
  const purpose = textarea(p.purpose, 'Why this procedure exists');
  const ppe = input({ value: Array.isArray(p.ppe) ? p.ppe.join(', ') : (p.ppe || '') });
  const tools = input({ value: Array.isArray(p.tools) ? p.tools.join(', ') : (p.tools || '') });

  const grid = (cls, ...fields) => { const g = el('div', cls); g.append(...fields); return g; };
  d.body.append(
    dl,
    grid('grid3', field('Title', title), field('Family', family),
         field('Sub-family', category, 'From Settings › Task families — the same list People uses.')),
    grid('grid3', field('When', freq), field('Rule', rule), field('Repeats over', target)),
    areasF, variantF, systemsF,
    grid('grid3', field('Trigger', trigger), field('Validation', validation), field('Status', status)),
    grid('grid3', field('Minutes', minutes), field('People', people), field('Phone', appReady)),
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
    const measure = s => s.type === 'measure';
    const payload = {
      title: title.value.trim(), family: family.value, category: category.value.trim(),
      frequency: freq.value, frequency_rule: rule.value.trim(),
      target_kind: target.value, area_kinds: areas.value(), systems: systems.value(),
      variant_of: trigger.value === 'crop_plan' ? variantOf.value : '',
      trigger_kind: trigger.value, validation: validation.value,
      estimated_minutes: Number(minutes.value) || 5, min_workers: Number(people.value) || 1,
      purpose: purpose.value, safety_ppe: ppe.value, tools: tools.value,
      status: status.value, app_ready: appReady.value(),
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
