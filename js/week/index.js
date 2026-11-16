// renderWeek, the minute's refresh, load, and the week and month arithmetic
import { liveWatch } from '../live.js';
import { pref, farmToday, parseYmd, ymd, loading, el } from '../ui.js';
import { rpc, openFast } from '../api.js';
import { resetManual, weeks, EMPTY_FILTERS, FILTER_KEY, today, mondayOf, firstOfMonth, manual,
         shift, S } from './state.js';
import { paintBody } from './views.js';
import { paint } from './paint.js';

export async function renderWeek(container, currentFarm) {
  // another farm: its people are not this farm's, so no spotlight or half-made manual choice carries over (0.7.112)
  // 0.7.162: nor its weeks (units, holidays) or its filters by person, zone, crop or unit — they would hide every task
  if (S.farm && S.farm.id !== currentFarm.id) {
    S.spotlight = null; resetManual(false); weeks.clear(); S.data = null;
    S.filters = { ...EMPTY_FILTERS, status: S.filters.status, family: S.filters.family, priority: S.filters.priority };
    try { pref.set(FILTER_KEY, JSON.stringify(S.filters)); } catch { /* the choice stays for this visit */ }
  }
  S.farm = currentFarm;
  S.mount = container;
  // the first time, and again when the day on screen was "today" on an earlier day (a console left open overnight)
  { const t = today(); if (!S.week || (setOn && setOn !== t && S.day === setOn)) { S.day = t; S.week = mondayOf(t); S.month = firstOfMonth(t); } setOn = t; }
  await load();
  // who is doing what stays current (0.7.182): the weeks on screen are read again every minute while the board is in
  // view and nobody is in the middle of something (a window open, Assign manually, a drag); openFast redraws only on a change
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!S.mount || !S.mount.isConnected) { clearInterval(refreshTimer); return; }
    if (document.hidden || manual.on || S.dragging || S.dragPerson || document.querySelector('.drawer')) return;
    refresh();
  }, 60000);
  // live (0.7.208): a phone or another console changed something — read again at once, under the same conditions
  liveWatch(S.farm.id, () => {
    if (!S.mount || !S.mount.isConnected || document.hidden || manual.on || S.dragging || S.dragPerson || document.querySelector('.drawer')) return;
    refresh();
  });
}
let refreshTimer = null;
// FarmBox 0212: a change answers who else touched the same task in the last two minutes — said, never refused
export const alsoBy = names => { const n = (names || []).filter(Boolean); return n.length ? ` · ${[...new Set(n)].join(' and ')} changed ${n.length > 1 ? 'these' : 'this'} a moment ago too` : ''; };
// read the weeks on screen again, quietly: the board is redrawn only when something moved, and stays where it was scrolled
async function refresh() {
  const mondays = mondaysOnScreen(), here = S.mount, gen = S.loadGen;
  try {
    const got = await Promise.all(mondays.map(m => rpc('labour_week', { p_farm: S.farm.id, p_week: m })));
    if (gen !== S.loadGen) return;
    if (!here.isConnected || S.mount !== here || mondaysOnScreen().join() !== mondays.join()) return;
    if (manual.on || S.dragging || S.dragPerson || document.querySelector('.drawer')) return;
    if (!got.some((g, i) => JSON.stringify(g) !== JSON.stringify(weeks.get(mondays[i])))) return;
    mondays.forEach((m, i) => weeks.set(m, got[i]));
    S.data = weeks.get(focusWeek());
    const cal = S.body?.querySelector('.tk-cal'), left = cal ? cal.scrollLeft : 0, top = window.scrollY;
    // the whole page (plan status, filter menus) unless somebody is typing or choosing in it: then the board only
    const busyField = S.mount.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (busyField) paintBody(); else paint();
    const cal2 = S.body?.querySelector('.tk-cal'); if (cal2) cal2.scrollLeft = left;
    window.scrollTo(0, top);
  } catch { /* offline or a hiccup: the next minute tries again */ }
}

// this week: what the page opens on, and what warm() reads ahead (next week too)
export const defaultWeek = () => mondayOf(farmToday());
export const nextWeek = () => shift(defaultWeek(), 7);

// the Mondays a month needs: from the Monday on or before the 1st to the one on or before the last day
function monthMondays(first) {
  const d = parseYmd(first);
  const last = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const out = [];
  for (let m = mondayOf(first); m <= last; m = shift(m, 7)) out.push(m);
  return out;
}
export const focusWeek = () => S.span === 'day' ? mondayOf(S.day)
  : S.span === 'month' ? (today().slice(0, 7) === S.month.slice(0, 7) ? mondayOf(today()) : mondayOf(S.month))
  : S.week;
export const mondaysOnScreen = () => S.span === 'month' ? monthMondays(S.month) : [focusWeek()];
// the days on screen: one, seven, or the month
export const rangeOnScreen = () => S.span === 'day' ? [S.day, S.day]
  : S.span === 'month' ? [S.month, ymd(new Date(parseYmd(S.month).getFullYear(), parseYmd(S.month).getMonth() + 1, 0))]
  : [S.week, shift(S.week, 6)];
export const mayPlanNow = () => !!(S.data?.may_plan);

// last time's copy at once, the server's answer behind it (openFast, 0.7.108)
export async function load() {
  S.loadGen++;
  const here = S.mount, mondays = mondaysOnScreen(), onScreen = mondays.join();
  await openFast(mondays.map(m => ['labour_week', { p_farm: S.farm.id, p_week: m }]), {
    show: got => {
      mondays.forEach((m, i) => weeks.set(m, got[i]));
      S.data = weeks.get(focusWeek());
      paint();
    },
    waiting: () => { S.mount.textContent = ''; S.mount.append(loading('Reading the tasks…')); },
    failed: e => { S.mount.textContent = ''; S.mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && S.mount === here && mondaysOnScreen().join() === onScreen,
  });
}
let setOn = null;            // the farm's day when the board was last opened on today
