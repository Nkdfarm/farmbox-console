// holidays, units, work times, folding hub tasks, filtering and ordering of what is on screen
import { el } from '../ui.js';
import { weeks, today, S } from './state.js';
import { mondaysOnScreen } from './index.js';

// a holiday's name on a day, from the weeks on screen (labour_week, 0094)
export function holidayOn(date) {
  for (const w of weeks.values()) for (const h of (w?.holidays || [])) if (h.day === date) return h.name;
  return null;
}

// sister units (0.7.139): one board for the group, each task marked with its unit
export function units() {
  for (const w of weeks.values()) if ((w?.sisters || []).length > 1) return w.sisters;
  return [];
}
export const unitOf = t => units().find(u => u.id === t.farm_id) || null;
export function unitMark(t, big) {
  const u = unitOf(t);
  if (!u) return null;
  const m = el('span', 'tk-unit' + (big ? ' big' : ''), u.badge);
  m.style.setProperty('--u', u.colour || 'var(--text-muted)');
  m.title = u.name;
  return m;
}

// the time worked on a task (the phone's timer, FarmBox 0161): labour_week's task_times of the weeks read
export function timeOf(t) {
  if (t.hub) {
    const xs = t.members.map(timeOf).filter(Boolean);
    return xs.length ? { minutes: xs.reduce((a, x) => a + Number(x.minutes || 0), 0), running: xs.some(x => x.running),
                         by: xs.flatMap(x => x.by || []), held: xs.map(x => x.held).find(Boolean) || null } : null;
  }
  for (const w of weeks.values()) { const x = (w?.task_times || []).find(y => y.task_id === t.id); if (x) return x; }
  return null;
}
export const fmtWork = m => { m = Math.round(Number(m) || 0); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
// the same words as the phone: Done in 42 min · ▶ 12 min · 12 min so far · Not finished · 12 min (an earlier day)
// 0.7.182 (owner: "the same information in the Naked Heart planner"): and who — the people timing it (labour_week's
// task_times.by, FarmBox 0186), who closed it (closed_by)
export const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
const nameList = xs => { xs = [...new Set(xs.map(firstName).filter(Boolean))]; return xs.length > 2 ? `${xs[0]} +${xs.length - 1}` : xs.join(' + '); };
const timedBy = (t, runningOnly) => nameList(((timeOf(t) || {}).by || []).filter(b => !runningOnly || b.running).map(b => b.name));
// 0.7.205 (FarmBox 0201): the person a task is held by — it is theirs, running or paused, until they finish it, hand it
// over, a manager releases it, or the day ends. Nobody else can open it on a phone meanwhile.
export const heldBy = t => { const h = (timeOf(t) || {}).held; return h && !['done', 'skipped'].includes(t.status) ? (firstName(h.name) || 'Somebody') : null; };
export function timeWord(t) {
  const x = timeOf(t), m = Number(x?.minutes || t.actual_minutes || 0);
  const say = (word, who, cls, total) => ({ text: [word, who || null, m >= 1 ? fmtWork(m) + (total ? ' total' : '') : null].filter(Boolean).join(' · '), cls });
  if (t.status === 'done') {
    // done by X, or by X + Y in the time of both: who closed it and everybody who worked a minute or more on it
    const people = [...String(t.closed_by || '').split(' + '), ...((x || {}).by || []).filter(b => Number(b.minutes) >= 1).map(b => b.name)];
    const who = nameList(people), n = new Set(people.map(firstName).filter(Boolean)).size;
    return (m >= 1 || who) ? say('Done', who, m > Number(t.minutes || 0) * 1.25 && Number(t.minutes) > 0 ? 'over' : 'ok', n > 1) : null;
  }
  if (t.status === 'skipped') return null;                       // the ✕ mark and its title say Cancelled and why
  const lock = t.hub ? null : heldBy(t);
  if (lock) return say(x?.running ? '🔒 In progress' : '🔒 Paused', lock, 'run');
  if (x?.running) return say('In progress', timedBy(t, true), 'run');
  if (t.date < today()) return say('Not done', timedBy(t), 'late');
  if (m < 1) return null;
  return say('To continue', timedBy(t), '');     // started and given back: free for anybody (a held one says 🔒 Paused above)
}
// a day's line from every task of that day the other filters leave — whatever the Status filter says: under the
// default "open" every done task was gone and the line read "0 of 2 done" (review 3 Oct 2026)
export function dayLine(date) {
  const st = S.filters.status;
  S.filters.status = 'all';
  try { return dayWorked(visible(tasksOnScreen()).filter(t => t.date === date)); } finally { S.filters.status = st; }
}
// a day's line: 5 of 8 done · 3 h 10 worked
function dayWorked(list) {
  list = flatTasks(list);
  const done = list.filter(t => t.status === 'done').length;
  const w = list.reduce((a, t) => a + Number(timeOf(t)?.minutes || (t.status === 'done' ? t.actual_minutes : 0) || 0), 0);
  return { done, worked: w, text: `${done} of ${list.length} done` + (w >= 1 ? ` · ${fmtWork(w)} worked` : '') };
}

// every task on screen, once
export function tasksOnScreen() {
  const seen = new Set(), out = [];
  for (const m of mondaysOnScreen()) {
    for (const t of (weeks.get(m)?.tasks || [])) {
      if (seen.has(t.id)) continue;
      seen.add(t.id); out.push(t);
    }
  }
  return out;
}

export function visible(tasks) {
  const q = S.filters.q.trim().toLowerCase();
  const isOpen = t => !['done', 'skipped'].includes(t.status);
  return tasks.filter(t =>
    (S.filters.status === 'all' || (S.filters.status === 'done' ? t.status === 'done' : S.filters.status === 'skipped' ? t.status === 'skipped'
      : S.filters.status === 'going' ? isOpen(t) && !!(timeOf(t)?.running || timeOf(t)?.held) : isOpen(t)))
    && (!S.filters.family || t.family === S.filters.family)
    && (!S.filters.category || (t.category || '') === S.filters.category)
    && (!S.filters.crop || (t.crops?.length ? t.crops : [t.crop || '']).includes(S.filters.crop))
    && (!S.filters.unit || t.farm_id === S.filters.unit)
    && (!S.filters.area || (t.area || '') === S.filters.area)
    && (!S.filters.priority || t.priority === S.filters.priority)
    && (!S.filters.worker || (S.filters.worker === 'nobody' ? !t.workers.length : t.workers.some(w => w.id === S.filters.worker)))
    && (!q || [t.title, t.area, t.crop, t.category, ...(t.workers || []).map(w => w.name)].join(' ').toLowerCase().includes(q)));
}
// ── the daily scouting as one card (0.7.180, owner: "an aggregator for the daily scouting, to see only one task to
// assign"). Since FarmBox 0172 the scouting is one task a zone; the board folds a unit's zone tasks of a day into one
// card, as the phone does (Naked Brain 0.11.67): its zones on the card, one assignment for all of them (Assign manually,
// Change who, drag), and its window lists the zones, each opening its own task. A filter that leaves one zone shows the
// zone's own task. The tasks themselves stay one a zone, so the phone, the report and the hours are unchanged.
const HUB_MODULES = new Set(['scouting']);
export const isOpenTask = t => !['done', 'skipped', 'cancelled'].includes(t.status);
// a folded card's actions cover every open zone of its day, not only the zones a filter leaves on screen
export const openIds = t => (t.hub ? (t.all || t.members) : [t]).filter(isOpenTask).map(m => m.id);
const flatTasks = list => list.flatMap(t => t.hub ? t.members : [t]);
// an extra scouting (0204) is a person's own addition to the day: never folded into the day's planned scouting
const hubKey = t => HUB_MODULES.has(t.module) && !t.extra ? [t.module, t.farm_id, t.date, t.sop_id].join('|') : null;
// "Zone 4-1" → "4.1", "Bay 2A" → "2A": the card says "Zones 1 · 2 · 3 · 4.1 · 4.2"
const zoneShort = a => (a || '').replace(/^(Zone|Bay)s?\s+/i, '').replace(/-/g, '.');
function zonesWord(ms) {
  const areas = ms.map(m => m.area || '').filter(Boolean);
  if (!areas.length) return '';
  const word = areas.every(a => /^Bay/i.test(a)) ? 'Bays' : areas.every(a => /^Zone/i.test(a)) ? 'Zones' : '';
  return (word ? word + ' ' : '') + areas.map(a => word ? zoneShort(a) : a).join(' · ');
}
const PRIO_RANK = { critical: 0, high: 1, normal: 2, low: 3 };
export function foldHubs(list) {
  const all = new Map();                                                // every zone task of the key, whatever the filters
  tasksOnScreen().forEach(t => { const k = hubKey(t); if (k) { if (!all.has(k)) all.set(k, []); all.get(k).push(t); } });
  const groups = new Map(), out = [];
  list.forEach(t => {
    const k = hubKey(t);
    if (!k) { out.push(t); return; }
    if (!groups.has(k)) { groups.set(k, []); out.push({ _hub: k }); }
    groups.get(k).push(t);
  });
  return out.map(x => {
    if (!x._hub) return x;
    const ms = groups.get(x._hub).sort((a, b) => (a.area || '').localeCompare(b.area || '', undefined, { numeric: true }));
    return ms.length === 1 ? ms[0] : hubOf(ms, all.get(x._hub) || ms);
  });
}
function hubOf(ms, all) {
  const open = ms.filter(isOpenTask), first = open[0] || ms[0];
  const workers = [];
  (open.length ? open : ms).forEach(m => (m.workers || []).forEach(w => { if (!workers.some(x => x.id === w.id)) workers.push(w); }));
  const status = open.length ? (open.every(m => (m.workers || []).length) ? 'assigned' : 'planned')
    : ms.some(m => m.status === 'done') ? 'done' : 'skipped';
  const doneAt = ms.map(m => m.done_at).filter(Boolean).sort().pop() || null;
  return {
    ...first, id: 'hub|' + ms.map(m => m.id).join('|'), hub: true, members: ms, all,
    area: zonesWord(ms), status, workers, nobody: open.filter(m => !(m.workers || []).length).length,
    minutes: ms.reduce((a, m) => a + Number(m.minutes || 0), 0),
    actual_minutes: ms.reduce((a, m) => a + Number(m.actual_minutes || 0), 0),
    priority: ms.map(m => m.priority || 'normal').sort((a, b) => (PRIO_RANK[a] ?? 2) - (PRIO_RANK[b] ?? 2))[0],
    crops: [...new Set(ms.flatMap(m => m.crops?.length ? m.crops : [m.crop]).filter(Boolean))],
    crop: null, positions: [], done_at: status === 'done' ? doneAt : null,
    skip_reason: status === 'skipped' ? first.skip_reason : null, skip_note: null,
    closed_by: [...new Set(ms.filter(m => m.status === 'done').map(m => m.closed_by).filter(Boolean))].join(' + ') || null,
    also_sent: ms.flatMap(m => m.also_sent || []),
    harvest_kg: null, withholding_until: null,
  };
}

// Morning · afternoon · anytime (0079): the slot orders the day; a clock time is a detail
export const SLOTS = ['am', 'pm', 'any'];
export const SLOT_WORD = { am: 'Morning', pm: 'Afternoon', any: 'Anytime' };
export const SLOT_SHORT = { am: 'AM', pm: 'PM', any: '—' };
export const slotOf = t => SLOTS.includes(t.slot) ? t.slot : (t.due_time ? (t.due_time < '12:00' ? 'am' : 'pm') : 'any');
// where it is drawn (0080): an anytime task fills the morning while the morning has room, else the afternoon
export const BANDS = ['am', 'pm'];
export const bandOf = t => BANDS.includes(t.plan_slot) ? t.plan_slot : (slotOf(t) === 'pm' ? 'pm' : 'am');
const PRIO_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
// within a half: the fixed work first (by its hour), then anytime in the order it was placed
export const byTime = (a, b) => (BANDS.indexOf(bandOf(a)) - BANDS.indexOf(bandOf(b)))
  || ((slotOf(a) === 'any') - (slotOf(b) === 'any'))
  || (a.due_time || '99').localeCompare(b.due_time || '99')
  || ((PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2))
  || a.title.localeCompare(b.title);
