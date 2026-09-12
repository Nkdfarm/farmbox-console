// ═══════════════════════════════════════════════════════════════════════════
// Maintenance — the hardware, and what has to be done to it (spec §7.7, §10.6)
//
// An interval rule is a promise about a date: last done plus every_days, moved
// to the next open day. "Schedule" turns those promises into tasks the labour
// planner can see, which is the only way maintenance competes for somebody's
// week instead of being remembered on a good day.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, card, drawer, field, input, selectBox,
         toast, busy, shortDate } from './ui.js';

const TYPES = [['pump', 'Pump'], ['filter', 'Filter'], ['dosing_unit', 'Dosing unit'],
               ['fan', 'Fan'], ['light', 'Light'], ['tank', 'Tank'],
               ['controller', 'Controller'], ['vehicle', 'Vehicle'], ['other', 'Other']];

let farm = null, data = null, mount = null;

export async function renderMaintenance(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the asset register…'));
  try { data = await rpc('maintenance', { p_farm: farm.id }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const may = data.may_edit;

  const rules = data.assets.flatMap(a => (a.rules || []).map(r => ({ ...r, asset: a.name })));
  const due = rules.filter(r => r.active && r.next_due &&
                                r.next_due <= isoIn(14)).length;
  const overdue = rules.filter(r => r.overdue).length;

  const sched = el('button', 'btn btn-primary', 'Schedule what is due');
  sched.title = 'Creates the tasks for the next 30 days. Running it twice changes nothing.';
  sched.onclick = () => schedule(sched);

  const add = el('button', 'btn', 'Add equipment');
  add.onclick = () => editAsset(null);

  mount.append(pageHead('Maintenance',
    `${data.assets.length} pieces of equipment, ${rules.length} routines. ` +
    (overdue ? `${overdue} overdue, ` : '') + `${due} due within a fortnight.`,
    may ? add : null, may ? sched : null));

  if (data.corrective.length) {
    const c = card('Corrective work, open');
    c.append(table([
      { key: 'title', label: 'Job' },
      { key: 'asset', label: 'On' },
      { key: 'planned_date', label: 'Planned', fmt: shortDate },
      { key: 'priority', label: 'Priority', fmt: v =>
          el('span', 'pill' + (v === 'critical' || v === 'high' ? ' bad' : ''), v) },
      { key: 'status', label: 'Status' },
    ], data.corrective));
    mount.append(c);
  }

  const list = card('Equipment');
  const rows = el('div', 'asset-list');
  data.assets.forEach(a => rows.append(assetRow(a, may)));
  if (!data.assets.length) {
    rows.append(el('div', 'empty',
      'No equipment yet. Add the pumps, filters, dosing units and controllers, ' +
      'then give each one its routine.'));
  }
  list.append(rows);
  mount.append(list);

  if (data.system_rules.length) {
    const c = card('Routines on a bay rather than a machine');
    c.append(table([
      { key: 'name', label: 'Routine' },
      { key: 'system', label: 'Bay' },
      { key: 'every_days', label: 'Every', align: 'right', fmt: v => v ? v + ' d' : '—' },
      { key: 'last_done', label: 'Last done', fmt: shortDate },
      { key: 'next_due', label: 'Next', fmt: shortDate },
    ], data.system_rules));
    mount.append(c);
  }
}

function assetRow(a, may) {
  const box = el('div', 'asset');
  const head = el('div', 'asset-head');
  head.append(el('b', null, a.name));
  head.append(el('span', 'pill', a.type.replace('_', ' ')));
  if (a.meter_unit) {
    head.append(el('span', 'hint', `${a.meter_value ?? 0} ${a.meter_unit}`));
  }
  if (a.open_issues) {
    head.append(el('span', 'pill bad', `${a.open_issues} issue${a.open_issues === 1 ? '' : 's'}`));
  }
  head.append(el('div', 'spacer'));
  if (may) {
    const edit = el('button', 'btn btn-ghost btn-sm', 'Edit');
    edit.onclick = () => editAsset(a);
    const rule = el('button', 'btn btn-ghost btn-sm', 'Add routine');
    rule.onclick = () => editRule(a, null);
    head.append(edit, rule);
  }
  box.append(head);

  if (!a.rules.length) {
    box.append(el('div', 'hint', 'No routine on this one.'));
    return box;
  }

  a.rules.forEach(r => {
    const row = el('div', 'rule' + (r.overdue ? ' overdue' : '') + (r.active ? '' : ' off'));
    row.append(el('span', 'rule-name', r.name));
    row.append(el('span', 'hint', r.every_days ? `every ${r.every_days} d` : 'on the meter'));
    row.append(el('span', 'hint', 'last ' + shortDate(r.last_done)));
    const next = el('span', r.overdue ? 'pill bad' : 'pill', 'due ' + shortDate(r.next_due));
    row.append(next);
    row.append(el('div', 'spacer'));
    if (may) {
      const done = el('button', 'btn btn-ghost btn-sm', 'Done today');
      done.onclick = () => logDone(done, r);
      row.append(done);
    }
    box.append(row);
  });
  return box;
}

async function schedule(button) {
  busy(button, true, 'Scheduling…');
  try {
    const r = await rpc('generate_maintenance_tasks', { p_farm: farm.id, p_horizon_days: 30 });
    toast(r.created
      ? `${r.created} maintenance task${r.created === 1 ? '' : 's'} added to the plan`
      : 'Nothing new — everything due is already scheduled', r.created ? 'ok' : '');
    await load();
  } catch (e) { busy(button, false); toast(e.message, 'bad'); }
}

async function logDone(button, rule) {
  busy(button, true, 'Saving…');
  try {
    await rpc('log_maintenance', { p_rule: rule.id });
    toast(`${rule.name} signed off — the clock starts again today`, 'ok');
    await load();
  } catch (e) { busy(button, false); toast(e.message, 'bad'); }
}

function editAsset(a) {
  const d = drawer(a ? a.name : 'Add equipment',
                   a ? 'What this machine is' : 'A pump, a filter, a controller…');
  const name = input({ value: a?.name || '', required: true });
  const type = selectBox(TYPES, a?.type || 'pump');
  const code = input({ value: a?.code || '', placeholder: 'left blank, one is made up' });
  const meter = input({ value: a?.meter_unit || '', placeholder: 'hours, m³ — or nothing' });
  const value = input({ type: 'number', step: '0.1', value: a?.meter_value ?? '' });

  d.body.append(field('Name', name));
  d.body.append(field('What it is', type));
  d.body.append(field('Code', code, 'Used in task titles and on the label.'));
  d.body.append(field('Meter reads in', meter, 'Leave empty when nothing counts up.'));
  d.body.append(field('Meter now', value));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save');
  save.onclick = async () => {
    if (!name.value.trim()) { toast('It needs a name', 'bad'); return; }
    busy(save, true, 'Saving…');
    try {
      await rpc('save_asset', { p: {
        id: a?.id ?? null, farm_id: farm.id, name: name.value.trim(),
        type: type.value, code: code.value.trim(),
        meter_unit: meter.value.trim(),
        meter_value: value.value === '' ? null : Number(value.value) } });
      d.close();
      toast('Saved', 'ok');
      await load();
    } catch (e) { busy(save, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}

function editRule(asset, r) {
  const d = drawer('Routine on ' + asset.name, 'What has to be done, and how often');
  const name = input({ value: r?.name || '', required: true });
  const every = input({ type: 'number', min: '1', value: r?.every_days ?? 30 });
  const last = input({ type: 'date', value: r?.last_done || '' });

  d.body.append(field('What it is called', name));
  d.body.append(field('Every, in days', every));
  d.body.append(field('Last done', last, 'The next one is counted from here.'));
  d.body.append(el('p', 'hint',
    'A routine becomes a real task when somebody presses "Schedule what is due"; ' +
    'the Friday planner then puts a name against it like any other job.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save');
  save.onclick = async () => {
    if (!name.value.trim()) { toast('It needs a name', 'bad'); return; }
    busy(save, true, 'Saving…');
    try {
      await rpc('save_maintenance_rule', { p: {
        id: r?.id ?? null, farm_id: farm.id, asset_id: asset.id,
        name: name.value.trim(), every_days: Number(every.value),
        last_done: last.value || null } });
      d.close();
      toast('Saved', 'ok');
      await load();
    } catch (e) { busy(save, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}

function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
