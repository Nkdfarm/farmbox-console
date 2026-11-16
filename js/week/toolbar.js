// the filter bar, the segmented control and the date navigation
import { el, input, selectBox, pref, parseYmd } from '../ui.js';
import { tasksOnScreen, units } from './data.js';
import { STATUS, PRIO, EMPTY_FILTERS, FILTER_KEY, longDate, VIEW_KEY, today, mondayOf, firstOfMonth,
         shift, shiftMonth, SPAN_KEY, S } from './state.js';
import { paintBody } from './views.js';
import { paint } from './paint.js';
import { load, nextWeek } from './index.js';

// ── filters ────────────────────────────────────────────────────────────────
export function filterBar() {
  const bar = el('div', 'tk-bar');
  const tasks = tasksOnScreen();
  const uniq = f => [...new Set(tasks.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const q = input({ type: 'search', placeholder: 'Search tasks, crops, zones, people…', value: S.filters.q });
  q.className = 'input tk-search';
  q.setAttribute('aria-label', 'Search tasks');
  q.oninput = () => { S.filters.q = q.value; paintBody(); };
  bar.append(q);

  const sel = (key, label, options) => {
    // a remembered filter with nothing on screen still shows in its menu (it used to read blank while hiding everything)
    const v = S.filters[key];
    if (v && key !== 'status' && !options.some(o => o[0] === v))
      options = [...options, [v, (key === 'worker' || key === 'unit' ? 'Chosen' : v) + ' (none here)']];
    const s = selectBox([['', label], ...options], S.filters[key] || '');
    s.setAttribute('aria-label', label);
    const isOn = () => key === 'status' ? S.filters.status !== 'open' : !!S.filters[key];
    s.className = 'tk-filter' + (isOn() ? ' on' : '');
    s.onchange = () => { S.filters[key] = s.value || (key === 'status' ? 'open' : ''); s.classList.toggle('on', isOn()); remember(); paintBody(); };
    bar.append(s);
  };
  sel('status', 'Status', STATUS);
  if (units().length > 1) sel('unit', 'Unit', units().map(u => [u.id, u.name]));
  sel('family', 'Family', uniq(t => t.family).map(x => [x, x]));
  sel('category', 'Sub-family', uniq(t => t.category).map(x => [x, x]));
  sel('crop', 'Crop', [...new Set(tasks.flatMap(t => t.crops?.length ? t.crops : [t.crop]).filter(Boolean))].sort().map(x => [x, x]));
  const people = new Map();
  tasks.forEach(t => (t.workers || []).forEach(w => people.set(w.id, w.name)));
  (S.data?.roster || []).forEach(r => people.set(r.worker_id, r.name));
  sel('worker', 'Assignee', [...people].sort((a, b) => a[1].localeCompare(b[1])).concat([['nobody', 'Nobody yet']]));
  sel('area', 'Zone', uniq(t => t.area).map(x => [x, x]));
  sel('priority', 'Priority', Object.entries(PRIO).map(([k, v]) => [k, v[1]]));

  const on = Object.keys(EMPTY_FILTERS).filter(k => k !== 'q' && k !== 'status' && S.filters[k]).length + (S.filters.status !== 'open' ? 1 : 0);
  const clear = el('button', 'btn btn-sm btn-ghost', on ? `Clear filters (${on})` : 'Clear filters');
  clear.disabled = !on && !S.filters.q;
  clear.onclick = () => { S.filters = { ...EMPTY_FILTERS }; remember(); paint(); };
  bar.append(clear);
  // the units on this board, with their marks (sister units, 0.7.139)
  if (units().length > 1) {
    const lg = el('span', 'unit-legend');
    units().forEach(u => { const x = el('span'); const m = el('span', 'tk-unit', u.badge); m.style.setProperty('--u', u.colour || 'var(--text-muted)'); x.append(m, u.name); lg.append(x); });
    bar.append(lg);
  }
  return bar;
}
const remember = () => pref.set(FILTER_KEY, JSON.stringify({ ...S.filters, q: '' }));

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

export function navBar() {
  const bar = el('div', 'tk-nav');
  bar.append(seg([['list', 'List'], ['calendar', 'Calendar']], S.view, v => { S.view = v; pref.set(VIEW_KEY, v); paint(); }, 'View'));

  const tod = el('button', 'btn btn-sm', 'Today');
  tod.onclick = () => { S.day = today(); S.week = mondayOf(S.day); S.month = firstOfMonth(S.day); load(); };
  const back = el('button', 'btn btn-sm', '‹'); back.setAttribute('aria-label', 'Earlier');
  const fwd = el('button', 'btn btn-sm', '›'); fwd.setAttribute('aria-label', 'Later');
  const move = n => {
    if (S.span === 'day') { S.day = shift(S.day, n); S.week = mondayOf(S.day); }
    else if (S.span === 'month') { S.month = shiftMonth(S.month, n); const t = today(); S.day = t.slice(0, 7) === S.month.slice(0, 7) ? t : S.month; S.week = mondayOf(S.day); }
    else { S.week = shift(S.week, 7 * n); S.day = S.week; }
    load();
  };
  back.onclick = () => move(-1); fwd.onclick = () => move(1);
  const label = el('div', 'tk-label');
  if (S.span === 'day') label.textContent = longDate(S.day);
  else if (S.span === 'month') label.textContent = parseYmd(S.month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  else {
    const end = shift(S.week, 6);
    const f = s => parseYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    label.textContent = `${f(S.week)} – ${f(end)}` + (S.week === mondayOf(today()) ? ' · this week' : S.week === nextWeek() ? ' · next week' : '');
  }
  bar.append(tod, back, fwd, label, el('div', 'spacer'));
  bar.append(seg([['day', 'Day'], ['week', 'Week'], ['month', 'Month']], S.span, v => {
    const was = S.span;
    S.span = v; pref.set(SPAN_KEY, v);
    if (v === 'day' && !(S.day >= S.week && S.day <= shift(S.week, 6))) S.day = S.week;
    // the month of the day on screen; from a week, the month of today when the week holds today, else of its Thursday
    if (v === 'month') {
      const t = today();
      S.month = firstOfMonth(was === 'day' ? S.day : (t >= S.week && t <= shift(S.week, 6)) ? t : shift(S.week, 3));
    }
    load();
  }, 'Period'));
  return bar;
}
