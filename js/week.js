// ═══════════════════════════════════════════════════════════════════════════
// Tasks — the week as a board (console 0.7.67; before that "Weekly plan")
//
// The owner wanted it to read like Tend's Tasks: a calendar of the week, one
// chip per task coloured by what kind of work it is, the people on it, a
// menu; filters across the top; a day and a month view; a list for those who
// prefer rows. The Friday plan (spec §9.3) is still here — the roster, the
// load, what the planner could not settle, Draft and Validate — behind one
// button, because it is a decision made once a week, not the thing you look
// at every day.
//
// The data is still app.labour_week(farm, monday): a month is its weeks read
// together. Colour is the sub-family's hue (ui.js subFamilyHue), the same as
// on Procedures and People, so Irrigation is the same blue everywhere.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, toast, drawer, confirmDrawer, avatar, busy, ymd, parseYmd, addDays,
         mondayOf as mondayOfDate, pref, input, selectBox, subFamilyHue, subFamilyTag, icon, sowingLine } from './ui.js';
import { roleLabel } from './people.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FAM_ICON = { Agriculture: 'sprout', Maintenance: 'wrench', Office: 'clipboard' };
const PRIO = { critical: ['‼', 'Critical'], high: ['▲', 'High'], normal: ['', 'Normal'], low: ['▽', 'Low'] };
const STATUS = [['open', 'Open tasks'], ['done', 'Done'], ['all', 'All']];
const VIEW_KEY = 'fbc_tasks_view', SPAN_KEY = 'fbc_tasks_span', FILTER_KEY = 'fbc_tasks_filters';

let farm = null, mount = null;
let week = null;        // the Monday on screen (week view), ISO
let day = null;         // the day on screen (day view), ISO
let month = null;       // the first of the month on screen (month view), ISO
let view = pref.get(VIEW_KEY) === 'list' ? 'list' : 'calendar';
let span = ['day', 'week', 'month'].includes(pref.get(SPAN_KEY)) ? pref.get(SPAN_KEY) : 'week';
const weeks = new Map();  // Monday → labour_week payload
let data = null;          // the payload of the week in focus (its plan and roster)
let body = null;          // the part under the toolbars, repainted on its own

const EMPTY_FILTERS = { q: '', status: 'open', family: '', category: '', crop: '', worker: '', area: '', priority: '' };
let filters = { ...EMPTY_FILTERS };
try { filters = { ...EMPTY_FILTERS, ...(JSON.parse(pref.get(FILTER_KEY) || '{}')), q: '' }; } catch { /* keep defaults */ }

// This page works in ISO strings; the date arithmetic is ui.js's, in local parts.
const iso = ymd;
const mondayOf = s => ymd(mondayOfDate(parseYmd(s)));
const shift = (s, days) => ymd(addDays(parseYmd(s), days));
const firstOfMonth = s => s.slice(0, 8) + '01';
const shiftMonth = (s, n) => { const d = parseYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
const today = () => iso(new Date());
const hrs = m => (Math.round((Number(m) / 60) * 10) / 10).toFixed(1);
const hhmm = t => (t || '').slice(0, 5);
const longDate = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const shortDay = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export async function renderWeek(container, currentFarm) {
  farm = currentFarm;
  mount = container;
  if (!week) { day = today(); week = mondayOf(day); month = firstOfMonth(day); }
  await load();
}

// this week: what the page opens on, and what warm() reads ahead (next week too)
export const defaultWeek = () => mondayOf(iso(new Date()));
export const nextWeek = () => shift(defaultWeek(), 7);

// the Mondays a month needs: from the Monday on or before the 1st to the one on or before the last day
function monthMondays(first) {
  const d = parseYmd(first);
  const last = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const out = [];
  for (let m = mondayOf(first); m <= last; m = shift(m, 7)) out.push(m);
  return out;
}
const focusWeek = () => span === 'day' ? mondayOf(day)
  : span === 'month' ? (today().slice(0, 7) === month.slice(0, 7) ? mondayOf(today()) : mondayOf(month))
  : week;
const mondaysOnScreen = () => span === 'month' ? monthMondays(month) : [focusWeek()];

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the tasks…'));
  try {
    const mondays = mondaysOnScreen();
    const got = await Promise.all(mondays.map(m => rpc('labour_week', { p_farm: farm.id, p_week: m })));
    mondays.forEach((m, i) => weeks.set(m, got[i]));
  } catch (e) {
    mount.textContent = '';
    mount.append(el('div', 'note bad', e.message));
    return;
  }
  data = weeks.get(focusWeek());
  paint();
}

// every task on screen, once
function tasksOnScreen() {
  const seen = new Set(), out = [];
  for (const m of mondaysOnScreen()) {
    for (const t of (weeks.get(m)?.tasks || [])) {
      if (seen.has(t.id)) continue;
      seen.add(t.id); out.push(t);
    }
  }
  return out;
}

function visible(tasks) {
  const q = filters.q.trim().toLowerCase();
  const isOpen = t => !['done', 'skipped'].includes(t.status);
  return tasks.filter(t =>
    (filters.status === 'all' || (filters.status === 'done' ? t.status === 'done' : isOpen(t)))
    && (!filters.family || t.family === filters.family)
    && (!filters.category || (t.category || '') === filters.category)
    && (!filters.crop || (t.crops?.length ? t.crops : [t.crop || '']).includes(filters.crop))
    && (!filters.area || (t.area || '') === filters.area)
    && (!filters.priority || t.priority === filters.priority)
    && (!filters.worker || (filters.worker === 'nobody' ? !t.workers.length : t.workers.some(w => w.id === filters.worker)))
    && (!q || [t.title, t.area, t.crop, t.category, ...(t.workers || []).map(w => w.name)].join(' ').toLowerCase().includes(q)));
}
// Morning · afternoon · anytime (0079): the slot orders the day; a clock time is a detail
const SLOTS = ['am', 'pm', 'any'];
const SLOT_WORD = { am: 'Morning', pm: 'Afternoon', any: 'Anytime' };
const SLOT_SHORT = { am: 'AM', pm: 'PM', any: '—' };
const slotOf = t => SLOTS.includes(t.slot) ? t.slot : (t.due_time ? (t.due_time < '12:00' ? 'am' : 'pm') : 'any');
// where it is drawn (0080): an anytime task fills the morning while the morning has room, else the afternoon
const BANDS = ['am', 'pm'];
const bandOf = t => BANDS.includes(t.plan_slot) ? t.plan_slot : (slotOf(t) === 'pm' ? 'pm' : 'am');
const PRIO_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
// within a half: the fixed work first (by its hour), then anytime in the order it was placed
const byTime = (a, b) => (BANDS.indexOf(bandOf(a)) - BANDS.indexOf(bandOf(b)))
  || ((slotOf(a) === 'any') - (slotOf(b) === 'any'))
  || (a.due_time || '99').localeCompare(b.due_time || '99')
  || ((PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2))
  || a.title.localeCompare(b.title);

// ── the page ───────────────────────────────────────────────────────────────
function paint() {
  mount.textContent = '';

  const head = el('div', 'page-head');
  const titles = el('div');
  titles.append(el('h1', null, 'Tasks'));
  titles.append(el('p', null, 'Every task of the FarmBox, day by day: what, where, who. Click a task to open it, change who does it or mark it done.'));
  head.append(titles, el('div', 'spacer'), planButton());
  mount.append(head);

  mount.append(filterBar());
  mount.append(navBar());
  body = el('div');
  mount.append(body);
  paintBody();
}

// the plan's state and its window, top right
function planButton() {
  const wrap = el('div', 'row');
  const plan = data?.plan;
  if (plan) {
    const cap = Number(plan.capacity_minutes || 0), dem = Number(plan.demand_minutes || 0);
    const pct = cap ? Math.round((dem / cap) * 100) : 0;
    wrap.append(el('span', 'pill ' + (plan.status === 'draft' ? 'warn' : 'ok'),
      (plan.status === 'validated' ? 'Validated' : plan.status === 'locked' ? 'Locked' : 'Draft') + ' · ' + pct + '% loaded'));
  } else wrap.append(el('span', 'pill warn', 'Week not drafted'));
  const b = el('button', 'btn', 'Plan the week…');
  b.onclick = planDrawer;
  wrap.append(b);
  return wrap;
}

// ── filters ────────────────────────────────────────────────────────────────
function filterBar() {
  const bar = el('div', 'tk-bar');
  const tasks = tasksOnScreen();
  const uniq = f => [...new Set(tasks.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const q = input({ type: 'search', placeholder: 'Search tasks, crops, zones, people…', value: filters.q });
  q.className = 'input tk-search';
  q.setAttribute('aria-label', 'Search tasks');
  q.oninput = () => { filters.q = q.value; paintBody(); };
  bar.append(q);

  const sel = (key, label, options) => {
    const s = selectBox([['', label], ...options], filters[key] || '');
    s.setAttribute('aria-label', label);
    const isOn = () => key === 'status' ? filters.status !== 'open' : !!filters[key];
    s.className = 'tk-filter' + (isOn() ? ' on' : '');
    s.onchange = () => { filters[key] = s.value || (key === 'status' ? 'open' : ''); s.classList.toggle('on', isOn()); remember(); paintBody(); };
    bar.append(s);
  };
  sel('status', 'Status', STATUS);
  sel('family', 'Type', uniq(t => t.family).map(x => [x, x]));
  sel('category', 'Sub-family', uniq(t => t.category).map(x => [x, x]));
  sel('crop', 'Crop', [...new Set(tasks.flatMap(t => t.crops?.length ? t.crops : [t.crop]).filter(Boolean))].sort().map(x => [x, x]));
  const people = new Map();
  tasks.forEach(t => (t.workers || []).forEach(w => people.set(w.id, w.name)));
  (data?.roster || []).forEach(r => people.set(r.worker_id, r.name));
  sel('worker', 'Assignee', [...people].sort((a, b) => a[1].localeCompare(b[1])).concat([['nobody', 'Nobody yet']]));
  sel('area', 'Zone', uniq(t => t.area).map(x => [x, x]));
  sel('priority', 'Priority', Object.entries(PRIO).map(([k, v]) => [k, v[1]]));

  const on = Object.keys(EMPTY_FILTERS).filter(k => k !== 'q' && k !== 'status' && filters[k]).length + (filters.status !== 'open' ? 1 : 0);
  const clear = el('button', 'btn btn-sm btn-ghost', on ? `Clear filters (${on})` : 'Clear filters');
  clear.disabled = !on && !filters.q;
  clear.onclick = () => { filters = { ...EMPTY_FILTERS }; remember(); paint(); };
  bar.append(clear);
  return bar;
}
const remember = () => pref.set(FILTER_KEY, JSON.stringify({ ...filters, q: '' }));

// ── list | calendar · today ‹ › · day | week | month ──────────────────────
function seg(options, value, onPick, label) {
  const s = el('div', 'seg');
  s.setAttribute('role', 'group'); s.setAttribute('aria-label', label);
  options.forEach(([v, text]) => {
    const b = el('button', 'seg-btn', text);
    b.setAttribute('aria-pressed', String(v === value));
    b.onclick = () => { s.querySelectorAll('.seg-btn').forEach(x => x.setAttribute('aria-pressed', String(x === b))); onPick(v); };
    s.append(b);
  });
  return s;
}

function navBar() {
  const bar = el('div', 'tk-nav');
  bar.append(seg([['list', 'List'], ['calendar', 'Calendar']], view, v => { view = v; pref.set(VIEW_KEY, v); paint(); }, 'View'));

  const tod = el('button', 'btn btn-sm', 'Today');
  tod.onclick = () => { day = today(); week = mondayOf(day); month = firstOfMonth(day); load(); };
  const back = el('button', 'btn btn-sm', '‹'); back.setAttribute('aria-label', 'Earlier');
  const fwd = el('button', 'btn btn-sm', '›'); fwd.setAttribute('aria-label', 'Later');
  const move = n => {
    if (span === 'day') { day = shift(day, n); week = mondayOf(day); }
    else if (span === 'month') { month = shiftMonth(month, n); week = mondayOf(month); }
    else { week = shift(week, 7 * n); day = week; }
    load();
  };
  back.onclick = () => move(-1); fwd.onclick = () => move(1);
  const label = el('div', 'tk-label');
  if (span === 'day') label.textContent = longDate(day);
  else if (span === 'month') label.textContent = parseYmd(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  else {
    const end = shift(week, 6);
    const f = s => parseYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    label.textContent = `${f(week)} – ${f(end)}` + (week === mondayOf(today()) ? ' · this week' : week === nextWeek() ? ' · next week' : '');
  }
  bar.append(tod, back, fwd, label, el('div', 'spacer'));
  bar.append(seg([['day', 'Day'], ['week', 'Week'], ['month', 'Month']], span, v => {
    span = v; pref.set(SPAN_KEY, v);
    if (v === 'day' && !(day >= week && day <= shift(week, 6))) day = week;
    if (v === 'month') month = firstOfMonth(span === 'day' ? day : week);
    load();
  }, 'Period'));
  return bar;
}

// ── the body: board, day, month or list ───────────────────────────────────
function paintBody() {
  body.textContent = '';
  const tasks = visible(tasksOnScreen());
  if (view === 'list') { body.append(listView(tasks)); return; }
  if (span === 'day') body.append(dayView(tasks));
  else if (span === 'month') body.append(monthView(tasks));
  else body.append(weekBoard(tasks));
}

// The week as bands: the morning above a line, the afternoon below it, anytime
// under a dotted one — the same line across every day (0079).
function weekBoard(tasks) {
  const grid = el('div', 'tk-cal tk-bands');
  const tod = today();
  for (let i = 0; i < 7; i++) {
    const date = shift(week, i);
    const n = tasks.filter(t => t.date === date).length;
    const head = el('div', 'tk-col-head tk-cell' + (date === tod ? ' today' : ''));
    head.append(el('span', null, shortDay(date)), el('span', 'tk-count', n ? String(n) : ''));
    grid.append(head);
  }
  BANDS.forEach(slot => {
    for (let i = 0; i < 7; i++) {
      const date = shift(week, i);
      const cell = el('div', 'tk-band ' + slot + (date === tod ? ' today' : ''));
      const list = tasks.filter(t => t.date === date && bandOf(t) === slot).sort(byTime);
      if (i === 0 || list.length) cell.append(el('div', 'tk-band-label', SLOT_WORD[slot]));
      list.forEach(t => cell.append(chip(t)));
      grid.append(cell);
    }
  });
  return grid;
}

function dayView(tasks) {
  const box = el('div', 'tk-day');
  const list = tasks.filter(t => t.date === day).sort(byTime);
  if (!list.length) { box.append(el('div', 'empty', 'Nothing on this day' + (filters.status !== 'all' ? ' with these filters' : '') + '.')); return box; }
  const mins = list.reduce((a, t) => a + Number(t.minutes || 0), 0);
  box.append(el('div', 'hint', `${list.length} task${list.length === 1 ? '' : 's'} · ${hrs(mins)} h`));
  BANDS.forEach(slot => {
    const part = list.filter(t => bandOf(t) === slot);
    const band = el('div', 'tk-band ' + slot);
    band.append(el('div', 'tk-band-label', SLOT_WORD[slot] + (part.length ? '' : ' — nothing')));
    part.forEach(t => band.append(chip(t, { big: true })));
    box.append(band);
  });
  return box;
}

function monthView(tasks) {
  const grid = el('div', 'tk-month');
  DAYS.forEach(d => grid.append(el('div', 'tk-mh', d.slice(0, 3))));
  const first = parseYmd(month);
  const start = mondayOf(month);
  const end = shift(mondayOf(ymd(new Date(first.getFullYear(), first.getMonth() + 1, 0))), 6);
  const tod = today();
  for (let date = start; date <= end; date = shift(date, 1)) {
    const cell = el('div', 'tk-mc' + (date.slice(0, 7) !== month.slice(0, 7) ? ' out' : '') + (date === tod ? ' today' : ''));
    const n = el('button', 'tk-mn', String(parseYmd(date).getDate()));
    n.title = 'Open the day';
    const go = () => { day = date; week = mondayOf(date); span = 'day'; pref.set(SPAN_KEY, span); load(); };
    n.onclick = go;
    cell.append(n);
    const list = tasks.filter(t => t.date === date).sort(byTime);
    list.slice(0, 3).forEach(t => cell.append(chip(t)));
    if (list.length > 3) {
      const more = el('button', 'tk-morelink', `+${list.length - 3} more`);
      more.onclick = go;
      cell.append(more);
    }
    grid.append(cell);
  }
  return grid;
}

function listView(tasks) {
  const box = el('div');
  const days = [...new Set(tasks.map(t => t.date))].sort();
  if (!days.length) { box.append(el('div', 'card card-pad')).append(el('div', 'empty', 'No task matches.')); return box; }
  days.forEach(date => {
    const list = tasks.filter(t => t.date === date).sort(byTime);
    const card = el('div', 'card');
    card.style.marginBottom = 'var(--space-3)';
    const head = el('div', 'row');
    head.style.padding = 'var(--space-3) var(--space-4)';
    head.style.borderBottom = '1px solid var(--border)';
    head.append(el('b', null, longDate(date)));
    const mins = list.reduce((a, t) => a + Number(t.minutes || 0), 0);
    head.append(el('span', 'pill', `${list.length} task${list.length === 1 ? '' : 's'} · ${hrs(mins)} h`));
    const none = list.filter(t => !t.workers.length && t.status !== 'done').length;
    if (none) head.append(el('span', 'pill bad', `${none} with nobody`));
    card.append(head);
    const wrap = el('div', 'table-wrap');
    const t = el('table', 'people');
    const tb = el('tbody');
    list.forEach(task => tb.append(taskRow(task)));
    t.append(tb); wrap.append(t); card.append(wrap);
    box.append(card);
  });
  return box;
}

// ── one task as a chip ─────────────────────────────────────────────────────
function chip(t, opts = {}) {
  const c = el('div', 'tk' + (t.status === 'done' ? ' done' : '') + (opts.big ? ' big' : ''));
  c.style.setProperty('--h', subFamilyHue(t.category || t.family));
  c.setAttribute('role', 'button'); c.tabIndex = 0;
  const ic = el('span', 'tk-ic'); ic.append(icon(FAM_ICON[t.family] || 'clipboard'));
  const text = el('span', 'tk-text');
  const title = el('span', 'tk-title', t.title);
  title.title = [t.title, t.area, t.crop].filter(Boolean).join(' · ');
  text.append(title);
  if (opts.big) {
    text.append(el('span', 'tk-sub', [hhmm(t.due_time) || SLOT_WORD[slotOf(t)], t.area, t.crop, t.category, hrs(t.minutes) + ' h',
      t.positions?.length ? t.positions.map(p => p.code).join(' ') : null].filter(Boolean).join(' · ')));
  }
  c.append(ic, text);
  const p = PRIO[t.priority];
  if (p && p[0]) { const s = el('span', 'tk-prio ' + t.priority, p[0]); s.title = p[1] + ' priority'; c.append(s); }
  const who = el('span', 'tk-who');
  if (t.status === 'done') who.append(el('span', 'tk-done', '✓'));
  else if (!t.workers.length) { const n = el('span', 'tk-nobody', '?'); n.title = 'Nobody yet'; who.append(n); }
  else {
    t.workers.slice(0, 2).forEach(w => { const a = avatar({ worker_id: w.id, name: w.name }, 'sm'); a.title = w.name; who.append(a); });
    if (t.workers.length > 2) who.append(el('span', 'avatar sm more', '+' + (t.workers.length - 2)));
  }
  c.append(who);
  const more = el('button', 'tk-more', '⋮');
  more.setAttribute('aria-label', 'Actions for ' + t.title);
  more.onclick = e => { e.stopPropagation(); openTask(t); };
  c.append(more);
  c.onclick = () => openTask(t);
  c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(t); } };
  return c;
}

const cell = child => { const c = el('td'); c.append(child); return c; };
const UNIT_WORDS = { tray: ['tray', 'trays'], plant: ['plant', 'plants'], m2: ['m²', 'm²'], system: ['system', 'systems'], batch: ['batch', 'batches'], position: ['position', 'positions'] };
const unitWord = (u, n) => (UNIT_WORDS[u] || [u, u])[Number(n) === 1 ? 0 : 1];

// The positions a task covers, by zone: "Zone 2 · 2A 138 plants (35 min) · 2B …".
// The crop is named on the position only when the task has more than one.
// A maintenance task lists its assets the same way (task_item, 0075), ✓ when ticked.
function positionsLine(task) {
  if (!task.positions?.length) return null;
  const unit = task.unit && !['position', 'asset', 'area', 'trap'].includes(task.unit) ? task.unit : null;
  const crops = new Set(task.positions.map(p => p.crop).filter(Boolean));
  const one = p => (p.done_at ? '✓ ' : '') + (p.code || p.label || '?') + (crops.size > 1 && p.crop ? ` ${p.crop}` : '')
    + (unit && p.quantity ? ` ${Math.round(p.quantity * 10) / 10}` : '') + (p.minutes ? ` (${Math.round(p.minutes)} min)` : '');
  const zones = new Map();
  task.positions.forEach(p => { const z = p.zone || ''; if (!zones.has(z)) zones.set(z, []); zones.get(z).push(p); });
  const pos = el('div', 'hint week-positions');
  pos.textContent = [...zones.entries()].map(([z, ps]) =>
    (zones.size > 1 && z ? z + ' — ' : '') + ps.map(one).join(' · ')).join('  ·  ')
    + (unit && task.quantity ? ` — ${Math.round(task.quantity * 10) / 10} ${unitWord(unit, task.quantity)}` : '');
  pos.title = task.positions.map(p => `${[p.zone, p.code].filter(Boolean).join(' ')}${p.crop ? ' · ' + p.crop : ''}: ${p.quantity ?? ''} ${p.unit ?? ''} · ${p.minutes ?? 0} min`).join(String.fromCharCode(10));
  return pos;
}

// a row of the list view
function taskRow(task) {
  const tr = el('tr');
  if (task.status === 'done') tr.className = 'off';
  tr.append(cell(el('span', 'mono', hhmm(task.due_time) || SLOT_SHORT[slotOf(task)])));
  const what = el('div');
  what.append(el('b', null, task.title));
  what.append(el('div', 'hint', [task.area, task.crop, hrs(task.minutes) + ' h', task.harvest_kg != null ? `${Number(task.harvest_kg)} kg harvested` : null].filter(Boolean).join(' · ')));
  const pos = positionsLine(task); if (pos) what.append(pos);
  tr.append(cell(what));
  tr.append(cell(subFamilyTag(task.category || task.family)));
  const who = el('div', 'assignees');
  if (task.status === 'done') who.append(el('span', 'pill ok', 'done'));
  else if (!task.workers.length) who.append(el('span', 'pill bad', 'nobody'));
  else {
    const stack = el('div', 'avatars');
    task.workers.slice(0, 3).forEach(w => { const a = avatar({ worker_id: w.id, name: w.name }, 'sm'); a.title = w.name; stack.append(a); });
    if (task.workers.length > 3) stack.append(el('div', 'avatar sm more', '+' + (task.workers.length - 3)));
    who.append(stack, el('small', null, task.workers.map(w => w.name).join(', ')));
  }
  tr.append(cell(who));
  const act = el('div', 'acts');
  const b = el('button', 'btn btn-sm btn-ghost', 'Open');
  b.onclick = () => openTask(task);
  act.append(b);
  tr.append(cell(act));
  return tr;
}

// ── one task: the facts and the actions ────────────────────────────────────
function openTask(t) {
  const wk = weeks.get(mondayOf(t.date)) || data;
  const d = drawer(t.title, [longDate(t.date), SLOT_WORD[slotOf(t)] + (hhmm(t.due_time) ? ' · ' + hhmm(t.due_time) : ''), t.area].filter(Boolean).join(' · '));
  const facts = el('div', 'facts');
  const fact = (k, v) => { const f = el('div', 'fact'); f.append(el('span', 'fact-k', k)); const val = el('span', 'fact-v'); if (v instanceof Node) val.append(v); else val.textContent = v ?? '—'; f.append(val); facts.append(f); };
  fact('Kind', subFamilyTag(t.category || t.family));
  fact('Family', t.family);
  if (t.crop) fact('Crop', t.crop);
  fact('When', SLOT_WORD[slotOf(t)] + (slotOf(t) === 'any' ? ' · drawn in the ' + SLOT_WORD[bandOf(t)].toLowerCase() : ''));
  fact('Takes', hrs(t.minutes) + ' h');
  fact('Priority', (PRIO[t.priority] || ['', t.priority])[1]);
  fact('Status', t.status === 'done' ? 'Done' + (t.done_at ? ' · ' + new Date(t.done_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') : t.status.replace('_', ' '));
  fact('Who', t.workers.length ? t.workers.map(w => w.name).join(', ') : 'nobody yet');
  if (t.harvest_kg != null) fact('Harvested', `${Number(t.harvest_kg)} kg`);
  d.body.append(facts);
  const pos = positionsLine(t);
  if (pos) {
    const zones = [...new Set(t.positions.map(p => p.zone).filter(Boolean))];
    const items = t.positions.every(p => p.kind && p.kind !== 'position');
    d.body.append(el('div', 'sec-title', (items ? 'Items' : 'Positions') + (zones.length > 1 ? ' · ' + zones.join(', ') : '')));
    pos.className = ''; d.body.append(pos);
    // the crop's sowing figures, once per crop, when the task is a sowing or nursery one (0074)
    const sow = new Map();
    t.positions.forEach(p => { if (p.sowing && !sow.has(p.crop || '')) sow.set(p.crop || '', p.sowing); });
    if (sow.size) {
      const box = el('div', 'hint');
      box.textContent = [...sow.entries()].map(([crop, x]) => (crop ? crop + ': ' : '') + sowingLine(x)).join('  ·  ');
      d.body.append(box);
    }
  }

  const mayPlan = wk?.may_plan && wk?.plan?.status !== 'locked';
  if (t.status !== 'done' && mayPlan) {
    // move this one task to the other half of the day (the procedure sets the default)
    const mv = el('div', 'acts');
    SLOTS.filter(x => x !== slotOf(t)).forEach(x => {
      const b = el('button', 'btn btn-sm btn-ghost', 'Move to ' + SLOT_WORD[x].toLowerCase());
      b.onclick = async () => {
        busy(b, true, 'Moving…');
        try { await rpc('set_task_slot', { p_task: t.id, p_slot: x }); d.close(); toast(`Moved to the ${SLOT_WORD[x].toLowerCase()}`, 'ok'); await load(); }
        catch (e) { busy(b, false, 'Move'); toast(e.message, 'bad'); }
      };
      mv.append(b);
    });
    d.body.append(mv);
  }
  if (t.status !== 'done') {
    if (mayPlan) {
      const ch = el('button', 'btn', 'Change who');
      ch.onclick = () => { d.close(); reassign(t, wk); };
      d.footer.append(ch);
    }
    const done = el('button', 'btn btn-primary', 'Mark done');
    done.onclick = async () => {
      if (!await confirmDrawer('Mark done?', `"${t.title}" on ${longDate(t.date)} — done without its checklist. The phone is where a checklist is run; this is for work done and not recorded.`, 'Mark done')) return;
      busy(done, true, 'Saving…');
      try {
        await rpc('complete_task', { p_task: t.id, p_minutes: null });
        d.close(); toast('Done ✓', 'ok'); await load();
      } catch (e) { busy(done, false, 'Mark done'); toast(e.message, 'bad'); }
    };
    d.footer.append(done);
  }
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

function reassign(task, wk) {
  const d = drawer(task.title, [task.area, longDate(task.date)].filter(Boolean).join(' · '));
  const list = el('div', 'resp');
  const current = new Set(task.workers.map(w => w.id));
  const pick = (id, label, hint) => {
    const b = el('button', 'btn' + (current.has(id) ? ' btn-accent' : ''), label);
    b.style.justifyContent = 'flex-start';
    if (id) { b.style.paddingLeft = '6px'; b.prepend(avatar({ worker_id: id, name: label }, 'sm')); }
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
  (wk?.roster || []).forEach(r => {
    const onToday = (r.days || []).includes(((parseYmd(task.date).getDay() + 6) % 7) + 1);
    const pct = Number(r.minutes) ? Math.round((Number(r.planned) / Number(r.minutes)) * 100) : 0;
    pick(r.worker_id, r.name, (onToday ? '' : 'not rostered that day · ') + `${hrs(r.planned)} h planned this week · ${pct}%`);
  });
  pick(null, 'Nobody for now', 'Takes the name off and leaves it for the next draft.');
  d.body.append(list);
  const close = el('button', 'btn', 'Cancel');
  close.onclick = d.close;
  d.footer.append(close);
}

// ── the Friday plan, in its window ─────────────────────────────────────────
function planDrawer() {
  const wk = focusWeek();
  data = weeks.get(wk);
  const plan = data?.plan, may = data?.may_plan;
  const end = shift(wk, 6);
  const f = s => parseYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const d = drawer(`The plan for ${f(wk)} – ${f(end)}`,
    'The planner proposes a name against every task from the roster, who is away, who is responsible for what and who holds which skill. Change what you disagree with on the board, then validate.');
  d.box.style.width = 'min(820px, 100vw)';
  d.body.append(summary(plan));
  if (!plan) {
    const e = el('div', 'empty');
    e.append(el('h3', null, 'No plan for this week yet'));
    e.append(el('p', null, may ? 'Draft one and the planner proposes the whole week in a second.' : 'A manager of this FarmBox drafts it.'));
    d.body.append(e);
  } else {
    const exceptions = plan.exceptions || [];
    if (exceptions.length) d.body.append(exceptionsCard(exceptions));
    d.body.append(el('div', 'sec-title', 'Who is on, and how full they are'));
    d.body.append(rosterCard());
  }
  if (may) {
    const redo = el('button', 'btn', plan ? 'Draft again' : 'Draft the week');
    redo.onclick = () => draft(redo, d);
    d.footer.append(redo);
    if (plan?.status === 'draft') {
      const ok = el('button', 'btn btn-primary', 'Validate the week');
      ok.onclick = async () => {
        const exc = (plan.exceptions || []).filter(e => e.kind === 'unassigned').length;
        if (exc && !await confirmDrawer('Validate with gaps?',
          `${exc} task${exc === 1 ? ' has' : 's have'} nobody against ${exc === 1 ? 'it' : 'them'}. ` +
          'You can validate anyway — the gaps stay visible — or close the window and fix them first.', 'Validate anyway')) return;
        busy(ok, true, 'Validating…');
        try {
          await rpc('validate_labour_plan', { p_plan: plan.id });
          toast('The week is validated', 'ok');
          d.close(); await load();
        } catch (e) { busy(ok, false, 'Validate the week'); toast(e.message, 'bad'); }
      };
      d.footer.append(ok);
    } else if (plan) d.footer.append(el('span', 'pill ok', 'Validated'));
  }
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

function summary(plan) {
  const row = el('div', 'row');
  row.style.margin = '0 0 var(--space-4)';
  const pill = (t, k) => row.append(el('span', 'pill ' + (k || ''), t));
  if (!plan) { pill('Not drafted', 'warn'); return row; }
  const cap = Number(plan.capacity_minutes || 0), dem = Number(plan.demand_minutes || 0);
  const pct = cap ? Math.round((dem / cap) * 100) : 0;
  pill(plan.status === 'validated' ? 'Validated' : plan.status === 'locked' ? 'Locked' : 'Draft', plan.status === 'draft' ? 'warn' : 'ok');
  pill(`${hrs(dem)} h of work`);
  pill(`${hrs(cap)} h of people`);
  pill(`${pct}% loaded`, pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok');
  if (plan.validated_at) pill('validated ' + new Date(plan.validated_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  return row;
}

// what the planner could not solve: one line per reason, not one per task
function exceptionsCard(list) {
  const groups = new Map();
  for (const e of list) {
    const key = `${e.kind}|${e.reason}|${e.date || ''}`;
    if (!groups.has(key)) groups.set(key, { ...e, n: 0, titles: [] });
    const g = groups.get(key); g.n++; if (e.title) g.titles.push(e.title);
  }
  const card = el('div', 'card card-pad');
  card.style.marginBottom = 'var(--space-4)';
  card.style.borderLeft = '4px solid var(--warning)';
  card.append(el('b', null, `${list.length} thing${list.length === 1 ? '' : 's'} the planner could not settle`));
  card.append(el('div', 'hint', 'These are not errors — they are the week telling you something. Nothing is hidden or dropped.'));
  const box = el('div', 'resp');
  box.style.marginTop = 'var(--space-3)';
  for (const g of groups.values()) {
    const line = el('div', 'note ' + (g.kind === 'unassigned' ? 'warn' : ''));
    line.append(el('b', null, g.date ? longDate(g.date) + ' — ' : ''));
    line.append(document.createTextNode(g.reason));
    if (g.n > 1) line.append(el('span', 'pill', ` ${g.n} tasks`));
    if (g.titles.length) line.append(el('div', 'hint', g.titles.slice(0, 6).join(' · ') + (g.titles.length > 6 ? ` and ${g.titles.length - 6} more` : '')));
    box.append(line);
  }
  card.append(box);
  return card;
}

function rosterCard() {
  const wrap = el('div', 'table-wrap');
  const t = el('table', 'people');
  const thead = el('thead'); const hr = el('tr');
  ['Slot', 'Person', 'Days', 'Capacity', 'Planned', 'Load'].forEach(x => hr.append(el('th', null, x)));
  thead.append(hr); t.append(thead);
  const tb = el('tbody');
  (data?.roster || []).forEach((r, i) => {
    const tr = el('tr');
    tr.append(cell(el('span', 'mono', 'Worker ' + (i + 1))));
    const who = el('div', 'who');
    who.append(avatar(r));
    const names = el('div'); names.append(el('b', null, r.name)); names.append(el('small', null, roleLabel(r.role)));
    who.append(names);
    tr.append(cell(who));
    tr.append(cell(el('span', 'mono', (r.days || []).map(d => DAYS[d - 1][0]).join(''))));
    tr.append(cell(el('span', 'mono', hrs(r.minutes) + ' h')));
    tr.append(cell(el('span', 'mono', hrs(r.planned) + ' h')));
    const pct = Number(r.minutes) ? Math.round((Number(r.planned) / Number(r.minutes)) * 100) : 0;
    tr.append(cell(el('span', 'pill ' + (pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok'), pct + '%')));
    tb.append(tr);
  });
  if (!(data?.roster || []).length) {
    const tr = el('tr'); const td = el('td'); td.colSpan = 6;
    td.append(el('div', 'empty', 'Nobody is rostered this week.'));
    tr.append(td); tb.append(tr);
  }
  t.append(tb); wrap.append(t);
  return wrap;
}

async function draft(button, d) {
  busy(button, true, 'Planning…');
  try {
    const r = await rpc('draft_labour_plan', { p_farm: farm.id, p_week: focusWeek() });
    toast(`${r.demand_hours} h placed across ${r.slots} people`, 'ok');
    d?.close(); await load();
  } catch (e) {
    busy(button, false, 'Draft the week');
    toast(e.message, 'bad');
  }
}
