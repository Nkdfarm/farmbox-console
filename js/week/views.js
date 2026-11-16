// the week board, day, month and list views
import { el, parseYmd, ymd, pref } from '../ui.js';
import { paintPeople } from './people.js';
import { foldHubs, visible, tasksOnScreen, BANDS, holidayOn, dayLine, byTime, SLOT_WORD, bandOf,
         isOpenTask } from './data.js';
import { today, shift, shortDay, hrs, DAYS, mondayOf, SPAN_KEY, longDate, S } from './state.js';
import { dropTarget, chip, taskRow } from './chip.js';
import { load } from './index.js';

// ── the body: board, day, month or list ───────────────────────────────────
export function paintBody() {
  S.body.textContent = '';
  paintPeople();
  const tasks = foldHubs(visible(tasksOnScreen()));
  if (S.view === 'list') { S.body.append(listView(tasks)); return; }
  if (S.span === 'day') S.body.append(dayView(tasks));
  else if (S.span === 'month') S.body.append(monthView(tasks));
  else S.body.append(weekBoard(tasks));
}

// The week as bands: the morning above a line, the afternoon below it, anytime
// under a dotted one — the same line across every day (0079).
function weekBoard(tasks) {
  const grid = el('div', 'tk-cal tk-bands');
  const tod = today();
  for (let i = 0; i < 7; i++) {
    const date = shift(S.week, i);
    const n = tasks.filter(t => t.date === date).length;
    const hol = holidayOn(date);
    const head = el('div', 'tk-col-head tk-cell' + (date === tod ? ' today' : '') + (hol ? ' holiday' : ''));
    head.append(el('span', null, shortDay(date)), el('span', 'tk-count', n ? String(n) : ''));
    if (hol) head.append(el('span', 'tk-hol', hol));
    // what the day came to: done and worked, once anything is done or timed (0.7.163)
    const dw = dayLine(date);
    if (dw.done || dw.worked >= 1) { const x = el('span', 'tk-worked', dw.text); head.append(x); }
    grid.append(head);
  }
  BANDS.forEach(slot => {
    for (let i = 0; i < 7; i++) {
      const date = shift(S.week, i);
      const cell = el('div', 'tk-band ' + slot + (date === tod ? ' today' : '') + (holidayOn(date) ? ' holiday' : ''));
      const list = tasks.filter(t => t.date === date && bandOf(t) === slot).sort(byTime);
      if (i === 0 || list.length) cell.append(el('div', 'tk-band-label', SLOT_WORD[slot]));
      list.forEach(t => cell.append(chip(t)));
      dropTarget(cell, date, slot);
      grid.append(cell);
    }
  });
  return grid;
}

function dayView(tasks) {
  const box = el('div', 'tk-day');
  const hol = holidayOn(S.day);
  if (hol) box.append(el('div', 'note', `${hol} — a holiday: its work has moved to the next working day.`));
  const list = tasks.filter(t => t.date === S.day).sort(byTime);
  if (!list.length) { box.append(el('div', 'empty', 'Nothing on this day' + (S.filters.status !== 'all' ? ' with these filters' : '') + '.')); return box; }
  const mins = list.reduce((a, t) => a + Number(t.minutes || 0), 0);
  box.append(el('div', 'hint', `${list.length} task${list.length === 1 ? '' : 's'} · ${hrs(mins)} h planned · ${dayLine(S.day).text}`));
  BANDS.forEach(slot => {
    const part = list.filter(t => bandOf(t) === slot);
    const band = el('div', 'tk-band ' + slot);
    band.append(el('div', 'tk-band-label', SLOT_WORD[slot] + (part.length ? '' : ' — nothing')));
    part.forEach(t => band.append(chip(t, { big: true })));
    dropTarget(band, S.day, slot);
    box.append(band);
  });
  return box;
}

function monthView(tasks) {
  const grid = el('div', 'tk-month');
  DAYS.forEach(d => grid.append(el('div', 'tk-mh', d.slice(0, 3))));
  const first = parseYmd(S.month);
  const start = mondayOf(S.month);
  const end = shift(mondayOf(ymd(new Date(first.getFullYear(), first.getMonth() + 1, 0))), 6);
  const tod = today();
  for (let date = start; date <= end; date = shift(date, 1)) {
    const hol = holidayOn(date);
    const cell = el('div', 'tk-mc' + (date.slice(0, 7) !== S.month.slice(0, 7) ? ' out' : '') + (date === tod ? ' today' : '') + (hol ? ' holiday' : ''));
    const n = el('button', 'tk-mn', String(parseYmd(date).getDate()));
    n.title = 'Open the day';
    const go = () => { S.day = date; S.week = mondayOf(date); S.span = 'day'; pref.set(SPAN_KEY, S.span); load(); };
    n.onclick = go;
    cell.append(n);
    if (hol) cell.append(el('div', 'tk-hol', hol));
    const list = tasks.filter(t => t.date === date).sort(byTime);
    list.slice(0, 3).forEach(t => cell.append(chip(t)));
    dropTarget(cell, date, null);
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
  if (!days.length) { const c = el('div', 'card card-pad'); c.append(el('div', 'empty', 'No task matches these filters.')); box.append(c); return box; }
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
    const dw = dayLine(date);
    if (dw.done || dw.worked >= 1) head.append(el('span', 'pill ok', dw.text));
    const none = list.filter(t => !(t.workers || []).length && isOpenTask(t)).length;   // a cancelled task needs nobody
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
