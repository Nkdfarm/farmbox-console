// ═══════════════════════════════════════════════════════════════════════════
// Labour › Weekly plan — the Friday page (spec §9.3)
//
// The system has already proposed a name against every task. This page exists
// so a person can look at the week, disagree where they want to, and say yes.
// Nothing is validated until they press the button; nothing is hidden from
// them, least of all the work the planner could not place.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, toast, drawer, confirmDrawer, initials, busy } from './ui.js';
import { roleLabel } from './people.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FAM = { Agriculture: 'ag', Maintenance: 'mt', Office: 'of' };

let farm = null;
let week = null;      // Monday, ISO
let data = null;
let mount = null;

// Local calendar date, not UTC: toISOString() on a local midnight in a
// positive offset hands back the day before, which quietly shifted the whole
// page a week.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                 + `-${String(d.getDate()).padStart(2, '0')}`;
const mondayOf = (d) => {
  const x = new Date(d + 'T00:00:00');
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return iso(x);
};
const shift = (isoDate, days) => {
  const x = new Date(isoDate + 'T00:00:00');
  x.setDate(x.getDate() + days);
  return iso(x);
};
const hrs = m => (Math.round((Number(m) / 60) * 10) / 10).toFixed(1);
const hhmm = t => (t || '').slice(0, 5);

export async function renderWeek(container, currentFarm) {
  farm = currentFarm;
  mount = container;
  if (!week) {
    const today = iso(new Date());
    week = shift(mondayOf(today), 7);      // next week is what Friday is for
  }
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the week…'));
  try {
    data = await rpc('labour_week', { p_farm: farm.id, p_week: week });
  } catch (e) {
    mount.textContent = '';
    mount.append(el('div', 'note bad', e.message));
    return;
  }
  paint();
}

function paint() {
  mount.textContent = '';
  const plan = data.plan;
  const may = data.may_plan;

  // ── head ────────────────────────────────────────────────────────────────
  const head = el('div', 'page-head');
  const titles = el('div');
  titles.append(el('h1', null, 'Weekly plan'));
  titles.append(el('p', null,
    'The plan proposes a name against every task from the roster, who is away, ' +
    'who is responsible for what and who holds which skill. Change what you ' +
    'disagree with, then validate it.'));
  head.append(titles, el('div', 'spacer'), weekPicker());
  mount.append(head);

  mount.append(summary(plan));

  if (!plan) {
    const e = el('div', 'empty');
    e.append(el('h3', null, 'No plan for this week yet'));
    e.append(el('p', null, may
      ? 'Draft one and the planner will propose the whole week in a second.'
      : 'A manager of this FarmBox drafts it.'));
    if (may) {
      const b = el('button', 'btn btn-primary', 'Draft the week');
      b.onclick = () => draft(b);
      e.append(b);
    }
    const card = el('div', 'card card-pad');
    card.append(e);
    mount.append(card);
    return;
  }

  const exceptions = plan.exceptions || [];
  if (exceptions.length) mount.append(exceptionsCard(exceptions));

  mount.append(rosterCard());
  mount.append(daysCard());
  mount.append(actions(plan, may));
}

function weekPicker() {
  const row = el('div', 'row');
  const back = el('button', 'btn btn-sm', '←');
  back.setAttribute('aria-label', 'The week before');
  back.onclick = () => { week = shift(week, -7); load(); };
  const fwd = el('button', 'btn btn-sm', '→');
  fwd.setAttribute('aria-label', 'The week after');
  fwd.onclick = () => { week = shift(week, 7); load(); };

  const end = shift(week, 6);
  const fmt = d => new Date(d + 'T00:00:00')
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const label = el('div');
  label.style.textAlign = 'center';
  label.style.minWidth = '150px';
  label.append(el('b', null, `${fmt(week)} – ${fmt(end)}`));
  const today = shift(mondayOf(iso(new Date())), 0);
  label.append(el('div', 'hint',
    week === today ? 'This week' : week === shift(today, 7) ? 'Next week' : ''));

  row.append(back, label, fwd);
  return row;
}

function summary(plan) {
  const row = el('div', 'row');
  row.style.margin = '0 0 var(--space-4)';
  const pill = (t, k) => row.append(el('span', 'pill ' + (k || ''), t));

  if (!plan) { pill('Not drafted', 'warn'); return row; }

  const cap = Number(plan.capacity_minutes || 0);
  const dem = Number(plan.demand_minutes || 0);
  const pct = cap ? Math.round((dem / cap) * 100) : 0;

  pill(plan.status === 'validated' ? 'Validated' : plan.status === 'locked' ? 'Locked' : 'Draft',
       plan.status === 'draft' ? 'warn' : 'ok');
  pill(`${hrs(dem)} h of work`);
  pill(`${hrs(cap)} h of people`);
  pill(`${pct}% loaded`, pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok');
  if (plan.validated_at) {
    pill('validated ' + new Date(plan.validated_at)
      .toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  }
  return row;
}

// ── what the planner could not solve ───────────────────────────────────────
function exceptionsCard(list) {
  // one line per reason, not one per task: ten tasks on a day nobody works is
  // one problem with ten symptoms, and reading it ten times helps nobody.
  const groups = new Map();
  for (const e of list) {
    const key = `${e.kind}|${e.reason}|${e.date || ''}`;
    if (!groups.has(key)) groups.set(key, { ...e, n: 0, titles: [] });
    const g = groups.get(key);
    g.n++;
    if (e.title) g.titles.push(e.title);
  }

  const card = el('div', 'card card-pad');
  card.style.marginBottom = 'var(--space-4)';
  card.style.borderLeft = '4px solid var(--warning)';
  const h = el('div', 'row');
  h.append(el('b', null, `${list.length} thing${list.length === 1 ? '' : 's'} the planner could not settle`));
  card.append(h);
  card.append(el('div', 'hint',
    'These are not errors — they are the week telling you something. Nothing is hidden or dropped.'));

  const box = el('div', 'resp');
  box.style.marginTop = 'var(--space-3)';
  for (const g of groups.values()) {
    const line = el('div', 'note ' + (g.kind === 'unassigned' ? 'warn' : ''));
    const when = g.date
      ? new Date(g.date + 'T00:00:00').toLocaleDateString(undefined,
          { weekday: 'long', day: 'numeric', month: 'short' })
      : '';
    line.append(el('b', null, when ? when + ' — ' : ''));
    line.append(document.createTextNode(g.reason));
    if (g.n > 1) line.append(el('span', 'pill', ` ${g.n} tasks`));
    if (g.titles.length) {
      line.append(el('div', 'hint', g.titles.slice(0, 6).join(' · ') +
        (g.titles.length > 6 ? ` and ${g.titles.length - 6} more` : '')));
    }
    box.append(line);
  }
  card.append(box);
  return card;
}

// ── who is on, and how full they are ───────────────────────────────────────
function rosterCard() {
  const card = el('div', 'card');
  card.style.marginBottom = 'var(--space-4)';
  const wrap = el('div', 'table-wrap');
  const t = el('table', 'people');
  const thead = el('thead');
  const hr = el('tr');
  ['Slot', 'Person', 'Days', 'Capacity', 'Planned', 'Load'].forEach(x => hr.append(el('th', null, x)));
  thead.append(hr);
  t.append(thead);

  const tb = el('tbody');
  (data.roster || []).forEach((r, i) => {
    const tr = el('tr');
    tr.append(cell(el('span', 'mono', 'Worker ' + (i + 1))));

    const who = el('div', 'who');
    who.append(el('div', 'avatar r-' + r.role, initials(r.name)));
    const names = el('div');
    names.append(el('b', null, r.name));
    names.append(el('small', null, roleLabel(r.role)));
    who.append(names);
    tr.append(cell(who));

    tr.append(cell(el('span', 'mono',
      (r.days || []).map(d => DAYS[d - 1][0]).join(''))));
    tr.append(cell(el('span', 'mono', hrs(r.minutes) + ' h')));
    tr.append(cell(el('span', 'mono', hrs(r.planned) + ' h')));

    const pct = Number(r.minutes) ? Math.round((Number(r.planned) / Number(r.minutes)) * 100) : 0;
    tr.append(cell(el('span', 'pill ' + (pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok'), pct + '%')));
    tb.append(tr);
  });
  if (!(data.roster || []).length) {
    const tr = el('tr'); const td = el('td'); td.colSpan = 6;
    td.append(el('div', 'empty', 'Nobody is rostered this week.'));
    tr.append(td); tb.append(tr);
  }
  t.append(tb);
  wrap.append(t);
  card.append(wrap);
  return card;
}

const cell = child => { const c = el('td'); c.append(child); return c; };

// ── the week, day by day ───────────────────────────────────────────────────
function daysCard() {
  const box = el('div');
  const byDay = new Map();
  for (let i = 0; i < 7; i++) byDay.set(shift(week, i), []);
  (data.tasks || []).forEach(t => byDay.get(t.date)?.push(t));

  for (const [date, list] of byDay) {
    if (!list.length) continue;
    const card = el('div', 'card');
    card.style.marginBottom = 'var(--space-3)';

    const head = el('div', 'row');
    head.style.padding = 'var(--space-3) var(--space-4)';
    head.style.borderBottom = '1px solid var(--border)';
    const d = new Date(date + 'T00:00:00');
    head.append(el('b', null, d.toLocaleDateString(undefined,
      { weekday: 'long', day: 'numeric', month: 'short' })));
    const mins = list.reduce((a, t) => a + Number(t.minutes), 0);
    head.append(el('span', 'pill', `${list.length} tasks · ${hrs(mins)} h`));
    const none = list.filter(t => !t.workers.length).length;
    if (none) head.append(el('span', 'pill bad', `${none} with nobody`));
    card.append(head);

    const wrap = el('div', 'table-wrap');
    const t = el('table', 'people');
    const tb = el('tbody');
    list.forEach(task => tb.append(taskRow(task)));
    t.append(tb);
    wrap.append(t);
    card.append(wrap);
    box.append(card);
  }
  return box;
}

function taskRow(task) {
  const tr = el('tr');

  tr.append(cell(el('span', 'mono', hhmm(task.due_time) || '—')));

  const what = el('div');
  what.append(el('b', null, task.title));
  const sub = el('div', 'hint');
  sub.textContent = [task.area, hrs(task.minutes) + ' h'].filter(Boolean).join(' · ');
  what.append(sub);
  tr.append(cell(what));

  tr.append(cell(el('span', 'chip fam-' + task.family, task.family)));

  const who = el('div', 'chips');
  if (!task.workers.length) who.append(el('span', 'pill bad', 'nobody'));
  task.workers.forEach(w => who.append(el('span', 'chip', w.name)));
  tr.append(cell(who));

  const act = el('div', 'acts');
  if (data.may_plan && data.plan?.status !== 'locked') {
    const b = el('button', 'btn btn-sm btn-ghost', 'Change');
    b.onclick = () => reassign(task);
    act.append(b);
  }
  tr.append(cell(act));
  return tr;
}

function reassign(task) {
  const d = drawer(task.title,
    [task.area, new Date(task.date + 'T00:00:00')
      .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })]
      .filter(Boolean).join(' · '));

  const list = el('div', 'resp');
  const current = new Set(task.workers.map(w => w.id));

  const pick = (id, label, hint) => {
    const b = el('button', 'btn' + (current.has(id) ? ' btn-accent' : ''), label);
    b.style.justifyContent = 'flex-start';
    b.onclick = async () => {
      d.close();
      try {
        await rpc('assign_task', { p_task: task.id, p_worker: id });
        toast(id ? 'Given to ' + label : 'Left for the planner', 'ok');
        await load();
      } catch (e) { toast(e.message, 'bad'); }
    };
    const w = el('div', 'field');
    w.append(b);
    if (hint) w.append(el('div', 'hint', hint));
    list.append(w);
  };

  (data.roster || []).forEach(r => {
    const onToday = (r.days || []).includes(((new Date(task.date + 'T00:00:00').getDay() + 6) % 7) + 1);
    const pct = Number(r.minutes) ? Math.round((Number(r.planned) / Number(r.minutes)) * 100) : 0;
    pick(r.worker_id, r.name,
      (onToday ? '' : 'not rostered that day · ') + `${hrs(r.planned)} h planned this week · ${pct}%`);
  });
  pick(null, 'Nobody for now', 'Takes the name off and leaves it for the next draft.');

  d.body.append(list);
  const close = el('button', 'btn', 'Cancel');
  close.onclick = d.close;
  d.footer.append(close);
}

// ── draft and validate ─────────────────────────────────────────────────────
function actions(plan, may) {
  if (!may) return el('div');
  const card = el('div', 'card card-pad');
  const row = el('div', 'row');

  const redo = el('button', 'btn', plan ? 'Draft again' : 'Draft the week');
  redo.onclick = () => draft(redo);

  row.append(redo);
  row.append(el('div', 'spacer', ''));

  if (plan.status === 'draft') {
    const hint = el('div', 'hint');
    hint.style.flex = '1';
    hint.textContent = 'Validating fixes the week and records who agreed to it. ' +
      'You can still move a task afterwards; the snapshot keeps what was agreed.';
    const ok = el('button', 'btn btn-primary', 'Validate the week');
    ok.onclick = async () => {
      const exc = (plan.exceptions || []).filter(e => e.kind === 'unassigned').length;
      if (exc && !await confirmDrawer('Validate with gaps?',
        `${exc} task${exc === 1 ? ' has' : 's have'} nobody against ${exc === 1 ? 'it' : 'them'}. ` +
        `You can validate anyway — the gaps stay visible — or close the drawer and fix them first.`,
        'Validate anyway')) return;
      busy(ok, true, 'Validating…');
      try {
        await rpc('validate_labour_plan', { p_plan: plan.id });
        toast('The week is validated', 'ok');
        await load();
      } catch (e) { busy(ok, false, 'Validate the week'); toast(e.message, 'bad'); }
    };
    card.append(hint);
    row.append(ok);
  } else {
    row.append(el('span', 'pill ok', 'Validated — drafting again needs it reopened'));
  }

  card.append(row);
  return card;
}

async function draft(button) {
  busy(button, true, 'Planning…');
  try {
    const r = await rpc('draft_labour_plan', { p_farm: farm.id, p_week: week });
    toast(`${r.demand_hours} h placed across ${r.slots} people`, 'ok');
    await load();
  } catch (e) {
    busy(button, false, 'Draft the week');
    toast(e.message, 'bad');
  }
}
