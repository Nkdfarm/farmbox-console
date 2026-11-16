// the week board's shared state, constants and small helpers
import { pref, ymd, el, mondayOf as mondayOfDate, parseYmd, addDays, farmToday } from '../ui.js';
import { openIds, isOpenTask } from './data.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const FAM_ICON = { Agriculture: 'sprout', Maintenance: 'wrench', Office: 'clipboard' };
export const PRIO = { critical: ['‼', 'Critical'], high: ['▲', 'High'], normal: ['', 'Normal'], low: ['▽', 'Low'] };
export const STATUS = [['open', 'Open tasks'], ['going', 'In progress or paused'], ['done', 'Done'], ['skipped', 'Cancelled'], ['all', 'All']];
// the status of a task at a glance (0.7.103): planned · done · not done
// 0.7.164: a skipped task is Cancelled (a choice, with its reason); Not done is an open task whose day has passed
const STATE = { done: ['done', '✓', 'Done'], skipped: ['skipped', '✕', 'Cancelled'] };
export const stateOf = t => STATE[t.status] || ['planned', '', 'Planned'];
// why a task is cancelled (FarmBox 0168): real choices; no_time and blocked are older reasons, still shown
export const REASON_WORD = { not_needed: 'Not needed', equipment: 'Equipment not available', weather: 'Weather or access', other: 'Other' };
const OLD_REASON = { no_time: 'No time', blocked: 'Weather or equipment' };
export const reasonText = r => REASON_WORD[r] || OLD_REASON[r] || r || '';
export function stateMark(t) {
  const [k, glyph, word] = stateOf(t);
  const s = el('span', 'tk-state ' + k, glyph);
  s.title = word + (t.skip_reason ? ' — ' + reasonText(t.skip_reason) + (t.skip_note ? ': ' + t.skip_note : '') : '')
          + (t.closed_by ? ' · ' + t.closed_by : '');
  return s;
}
export const VIEW_KEY = 'fbc_tasks_view';
export const SPAN_KEY = 'fbc_tasks_span';
export const FILTER_KEY = 'fbc_tasks_filters';
export const weeks = new Map();  // Monday → labour_week payload

export const EMPTY_FILTERS = { q: '', status: 'open', unit: '', family: '', category: '', crop: '', worker: '', area: '', priority: '' };
// the people column (0.7.81): manual mode = one person, the tasks clicked, Validate
// 0.7.111: `drop` = the tasks to take a name off — the chosen person's, or everybody's when no face is chosen
export const manual = { on: false, worker: null, tasks: new Set(), drop: new Set(), seen: new Map() };
export const onTask = (t, w) => t.hub ? openIds(t).length > 0 && (t.all || t.members).filter(isOpenTask).every(m => (m.workers || []).some(x => x.id === w))
                            : (t.workers || []).some(x => x.id === w);
export const resetManual = on => { manual.on = on; manual.worker = null; manual.tasks.clear(); manual.drop.clear(); manual.seen.clear(); };
try { S.filters = { ...EMPTY_FILTERS, ...(JSON.parse(pref.get(FILTER_KEY) || '{}')), q: '' }; } catch { /* keep defaults */ }

// This page works in ISO strings; the date arithmetic is ui.js's, in local parts.
export const mondayOf = s => ymd(mondayOfDate(parseYmd(s)));
export const shift = (s, days) => ymd(addDays(parseYmd(s), days));
export const firstOfMonth = s => s.slice(0, 8) + '01';
export const shiftMonth = (s, n) => { const d = parseYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
export const today = () => farmToday();                // the farm's day, not the browser's
export const hrs = m => (Math.round((Number(m) / 60) * 10) / 10).toFixed(1);
export const hhmm = t => (t || '').slice(0, 5);
export const longDate = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
export const shortDay = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
// the page's shared state: one object, so every part reads and writes the same values
export const S = {
  farm: null,
  mount: null,
  week: null,  // the Monday on screen (week view), ISO
  day: null,  // the day on screen (day view), ISO
  month: null,  // the first of the month on screen (month view), ISO
  view: pref.get(VIEW_KEY) === 'list' ? 'list' : 'calendar',
  span: ['day', 'week', 'month'].includes(pref.get(SPAN_KEY)) ? pref.get(SPAN_KEY) : 'week',
  data: null,  // the payload of the week in focus (its plan and roster)
  body: null,  // the part under the toolbars, repainted on its own
  filters: { ...EMPTY_FILTERS },
  spotlight: null,  // a face clicked: their tasks stand out, the rest of the plan stays in view
  dragging: null,  // the task being dragged, while it is
  dragPerson: null,  // the face being dragged (0.7.225): onto a task = add them, onto another face = the column's order
  loadGen: 0,  // bumped by load(): a minute's refresh read before a change must not undo it on screen
  peopleCol: null,
};

