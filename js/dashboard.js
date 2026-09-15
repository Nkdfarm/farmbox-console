// ═══════════════════════════════════════════════════════════════════════════
// Dashboard — the first screen of the morning (spec §7.1)
//
// Six tiles, the week day by day, and how full each bay is. Every number is a
// count of things somebody can go and look at, never a rate: "3 overdue" is
// three jobs with names on them, and a percentage would hide which three.
//
// The tiles are ordered by what makes somebody act. Overdue work and open
// issues come first because they are already wrong; occupancy and harvest
// come next because they are the farm's output; next week's plan comes last
// because it is the one thing that has not happened yet.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { weatherTile } from './weather.js';
import { el, toast, icon, num, pref, ymd, parseYmd, addDays, isoDow, mondayOf } from './ui.js';

const FAMILY_CLASS = { Agriculture: 'fam-ag', Maintenance: 'fam-mt', Office: 'fam-of' };
const DAY_NAME = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let farm = null, data = null, mount = null;

export async function renderDashboard(container, currentFarm) {
  farm = currentFarm; mount = container;
  cal.anchor = new Date();          // the view is remembered, the period is not
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the farm…'));
  try { data = await rpc('dashboard', { p_farm: farm.id }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

// Dates are parsed from their local parts. Never through Date(string) alone
// and never back out through toISOString: that converts to UTC, and in
// Johannesburg it lands the whole page on the day before.
const parse = parseYmd;
const dayLabel = s => { const d = parse(s); return `${DAY_NAME[d.getDay() === 0 ? 7 : d.getDay()]} ${d.getDate()}`; };

function paint() {
  mount.textContent = '';

  const head = el('div', 'page-head');
  const titles = el('div');
  titles.append(el('h1', null, data.farm.name));
  titles.append(el('p', null, weatherOfTheDay()));
  head.append(titles, el('div', 'spacer'));
  head.append(el('span', 'pill', data.farm.code));
  mount.append(head);

  mount.append(tiles());
  mount.append(calendarCard());
  mount.append(bays());
}

// One honest sentence about the state of the farm, in place of a greeting.
function weatherOfTheDay() {
  const t = data.tasks, i = data.issues;
  const bits = [];
  if (t.overdue) bits.push(`${t.overdue} job${t.overdue === 1 ? '' : 's'} overdue`);
  if (i.open) bits.push(`${i.open} issue${i.open === 1 ? '' : 's'} open`);
  const left = t.week.today - t.week.today_done;
  bits.push(left > 0 ? `${left} of ${t.week.today} due today still to do`
                     : t.week.today ? `all ${t.week.today} of today's jobs done`
                                    : 'nothing scheduled today');
  return bits.join(' · ');
}

// ── the tiles ──────────────────────────────────────────────────────────────
function tiles() {
  const wrap = el('div', 'tiles');
  const t = data.tasks, o = data.occupancy, h = data.harvests,
        i = data.issues, p = data.purchasing, l = data.labour;

  // the weather first, two tiles wide (weather.js) — the owner's choice
  wrap.append(weatherTile(data.farm));

  wrap.append(tile({
    label: 'Overdue',
    icon: 'clock',
    value: t.overdue,
    tone: t.overdue ? 'bad' : 'ok',
    sub: t.overdue ? 'open, with the day already past' : 'nothing is late',
    go: '#/week',
  }));

  wrap.append(tile({
    label: 'Open issues',
    icon: 'alert',
    value: i.open,
    tone: i.critical ? 'bad' : i.open ? 'warn' : 'ok',
    sub: i.critical ? `${i.critical} critical, oldest ${i.oldest_days} d`
       : i.open ? `oldest ${i.oldest_days} day${i.oldest_days === 1 ? '' : 's'} old`
       : 'none raised',
    list: i.list.map(x => `${x.title} · ${x.severity}, ${x.days_open} d`),
  }));

  wrap.append(tile({
    label: 'This week',
    icon: 'check',
    value: `${t.week.done}/${t.week.planned}`,
    sub: t.week.open ? `${t.week.open} still open` : 'the week is clear',
    tone: '',
    families: t.by_family,
    go: '#/week',
  }));

  wrap.append(tile({
    label: 'Occupied',
    icon: 'layers',
    value: `${o.pct}%`,
    sub: `${o.occupied} of ${o.positions} positions${o.proposed ? ` · ${o.proposed} proposed` : ''}`,
    tone: o.pct >= 80 ? 'ok' : o.pct >= 40 ? '' : 'warn',
    go: '#/crops',
  }));

  wrap.append(tile({
    label: 'Harvest, 7 days',
    icon: 'basket',
    value: `${h.d7.kg} kg`,
    sub: h.d14.kg > h.d7.kg ? `${h.d14.kg} kg within 14` : 'nothing more within 14 days',
    tone: '',
    list: h.d7.by_crop.map(c => `${c.crop} · ${c.kg} kg`),
    go: '#/crops',
  }));

  const planWords = {
    none: ['not drafted', 'bad'],
    draft: ['drafted, waiting for a yes', 'warn'],
    validated: ['validated', 'ok'],
    locked: ['locked', 'ok'],
  }[l.status] || [l.status, ''];
  wrap.append(tile({
    label: 'Next week',
    icon: 'calendar',
    value: l.tasks,
    sub: `${planWords[0]}${l.unassigned ? ` · ${l.unassigned} with no name on them` : ''}`,
    tone: planWords[1],
    go: '#/week',
  }));

  if (p.waiting) {
    wrap.append(tile({
      label: 'To order',
    icon: 'cart',
      value: p.waiting,
      tone: p.late ? 'bad' : 'warn',
      sub: p.late ? `${p.late} already past the order-by date`
                  : `next order by ${p.next_order_by ?? '—'}`,
    }));
  }

  return wrap;
}

function tile({ label, value, sub, tone, list, families, go, icon: glyph }) {
  const node = el(go ? 'a' : 'div', 'tile' + (tone ? ' ' + tone : ''));
  if (go) node.href = go;
  if (glyph) {
    const badge = el('div', 'tile-icon');
    badge.append(icon(glyph));
    node.append(badge);
  }
  const body = el('div', 'tile-body');
  body.append(el('div', 'tile-value', String(value)));
  body.append(el('div', 'tile-label', label));
  if (sub) body.append(el('div', 'tile-sub', sub));

  if (families?.length) {
    const row = el('div', 'tile-fams');
    families.forEach(f => {
      const c = el('span', 'fam-dot ' + (FAMILY_CLASS[f.family] || ''));
      c.title = `${f.family}: ${f.done} of ${f.planned} done`;
      c.append(el('i'), document.createTextNode(`${f.done}/${f.planned}`));
      row.append(c);
    });
    body.append(row);
  }

  if (list?.length) {
    const ul = el('ul', 'tile-list');
    list.slice(0, 3).forEach(x => ul.append(el('li', null, x)));
    if (list.length > 3) ul.append(el('li', 'more', `and ${list.length - 3} more`));
    body.append(ul);
  }
  node.append(body);
  return node;
}

// ── the crop calendar: a week, a month or a year ───────────────────────────
// Sowing, transplant and harvest are the dates a crop plan is built around.
// The card used to show this week and nothing else, and a plan is read further
// out than that. So it chooses its own window — a week, a month or a year —
// and which one, from the menu or with the arrows. A month is a grid of days
// and a year is twelve bars of harvest weight; clicking a day opens its week,
// clicking a month opens the month. The view is remembered, the period is not:
// the dashboard always opens on today.
const CAL_KEY = 'fbc_cal_view';
const VIEWS = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']];
const KIND_ORDER = { harvest: 0, transplant: 1, sow: 2 };
const cal = { view: 'week', anchor: new Date() };
{
  const v = pref.get(CAL_KEY);
  if (VIEWS.some(x => x[0] === v)) cal.view = v;
}
let calSeq = 0;

// ISO week: the week holding the year's first Thursday is week 1
const isoWeek = d => {
  const thu = addDays(d, 4 - isoDow(d));
  const jan1 = new Date(thu.getFullYear(), 0, 1);
  return 1 + Math.floor(Math.round((thu - jan1) / 86400000) / 7);
};

// The window a view shows around a date. `first`/`last` are the period itself;
// `from`/`to` are what is fetched, which for a month runs Monday to Sunday so
// the grid shows the edges of the months beside it.
function windowOf(view, anchor) {
  if (view === 'week') {
    const from = mondayOf(anchor), to = addDays(from, 6);
    return { from, to, first: from, last: to };
  }
  if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from: mondayOf(first), to: addDays(mondayOf(last), 6), first, last };
  }
  const first = new Date(anchor.getFullYear(), 0, 1);
  const last = new Date(anchor.getFullYear(), 11, 31);
  return { from: first, to: last, first, last };
}

// n periods before or after. A month or a year keeps the month it is on, so
// going from Year back to Month lands where the person was looking.
function stepAnchor(view, anchor, n) {
  if (view === 'week') return addDays(anchor, 7 * n);
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
  return new Date(anchor.getFullYear() + n, anchor.getMonth(), 1);
}

const periodKey = (view, d) => ymd(windowOf(view, d).first);

function periodLabel(view, d) {
  const w = windowOf(view, d);
  if (view === 'week') {
    const f = x => x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `Week ${isoWeek(w.first)} · ${f(w.first)} – ${f(w.last)} ${w.last.getFullYear()}`;
  }
  if (view === 'month') return w.first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return String(w.first.getFullYear());
}

// The rolling menu: half a year of weeks either side, a year of months, three
// years. The arrows go further than the menu reaches, and the menu follows.
function periodMenu(view, anchor) {
  const span = { week: 26, month: 12, year: 3 }[view];
  const now = periodKey(view, new Date());
  const s = el('select');
  s.setAttribute('aria-label', 'Which ' + view);
  for (let i = -span; i <= span; i++) {
    const d = stepAnchor(view, anchor, i);
    const key = periodKey(view, d);
    const o = el('option', null, periodLabel(view, d) + (key === now ? ' · now' : ''));
    o.value = key;
    s.append(o);
  }
  s.value = periodKey(view, anchor);
  return s;
}

function calendarCard() {
  const card = el('div', 'card cal');
  card.style.marginBottom = 'var(--space-4)';

  const head = el('div', 'cal-head');
  const titles = el('div');
  titles.append(el('div', 'sec-title', 'Crop calendar'));
  const summary = el('div', 'hint');
  titles.append(summary);
  const controls = el('div', 'cal-controls');
  head.append(titles, el('div', 'spacer'), controls);

  const body = el('div', 'cal-body');
  const legend = el('div', 'cal-legend');
  [['harvest', 'Harvest'], ['transplant', 'Transplant'], ['sow', 'Sowing']].forEach(([k, label]) => {
    const item = el('span', k);
    item.append(el('i'), document.createTextNode(label));
    legend.append(item);
  });
  legend.append(el('span', 'spacer'));
  legend.append(el('span', null, 'Validated and growing batches · closed days shaded'));

  card.append(head, body, legend);
  loadCalendar({ summary, controls, body });
  return card;
}

function goCalendar(parts, view, anchor) {
  cal.view = view;
  cal.anchor = anchor;
  pref.set(CAL_KEY, view);
  loadCalendar(parts);
}

function paintControls(parts) {
  const { controls } = parts;
  controls.textContent = '';

  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Calendar view');
  VIEWS.forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(cal.view === v));
    b.onclick = () => { if (cal.view !== v) goCalendar(parts, v, cal.anchor); };
    seg.append(b);
  });

  const arrow = (name, n, label) => {
    const b = el('button', 'btn btn-sm btn-icon');
    b.type = 'button';
    b.append(icon(name));
    b.setAttribute('aria-label', label);
    b.title = label;
    b.onclick = () => goCalendar(parts, cal.view, stepAnchor(cal.view, cal.anchor, n));
    return b;
  };

  const menu = periodMenu(cal.view, cal.anchor);
  menu.onchange = () => {
    const d = parse(menu.value);
    goCalendar(parts, cal.view,
      cal.view === 'year' ? new Date(d.getFullYear(), cal.anchor.getMonth(), 1) : d);
  };
  const pick = el('div', 'field');
  pick.append(menu);

  const back = el('button', 'btn btn-sm',
    { week: 'This week', month: 'This month', year: 'This year' }[cal.view]);
  back.type = 'button';
  back.hidden = periodKey(cal.view, cal.anchor) === periodKey(cal.view, new Date());
  back.onclick = () => goCalendar(parts, cal.view, new Date());

  controls.append(seg, arrow('chevronLeft', -1, 'Earlier'), pick,
                  arrow('chevronRight', 1, 'Later'), back);
}

async function loadCalendar(parts) {
  const seq = ++calSeq;
  const { body, summary } = parts;
  paintControls(parts);
  const w = windowOf(cal.view, cal.anchor);
  summary.textContent = periodLabel(cal.view, cal.anchor);
  body.textContent = '';
  body.append(el('div', 'empty cal-loading', 'Reading the calendar…'));

  let res;
  try {
    res = await rpc('crop_calendar', { p_farm: farm.id, p_from: ymd(w.from), p_to: ymd(w.to) });
  } catch (e) {
    if (seq !== calSeq) return;
    body.textContent = '';
    // A console published ahead of its database migration: this week still
    // comes from the dashboard's own copy, and the note says what is missing.
    if (/could not find the function/i.test(e.message) && data.calendar?.length) {
      body.append(el('div', 'note warn cal-note',
        'Other weeks, months and years need the crop_calendar database update. Showing this week.'));
      body.append(weekView(dashboardWeek(), parse(data.calendar[0].date)));
    } else {
      body.append(el('div', 'note bad cal-note', e.message));
    }
    return;
  }
  if (seq !== calSeq) return;   // a newer choice is already on its way

  body.textContent = '';
  summary.textContent = periodLabel(cal.view, cal.anchor) + ' · ' + totals(res, w);
  body.append(cal.view === 'week' ? weekView(res, w.from)
            : cal.view === 'month' ? monthView(res, w, parts)
            : yearView(res, w.first.getFullYear(), parts));
}

// The dashboard's own calendar in the shape crop_calendar answers with.
function dashboardWeek() {
  return {
    today: data.today,
    operating_days: data.farm.operating_days,
    days: data.calendar.map(d => ({ date: d.date, tasks: d.tasks, done: d.done })),
    events: data.calendar.flatMap(d => [
      ...d.harvests.map(x => ({ date: d.date, kind: 'harvest', crop: x.crop, position: x.position, kg: x.kg })),
      ...d.transplants.map(x => ({ date: d.date, kind: 'transplant', crop: x.crop, position: x.position })),
    ]),
  };
}

// Counted over the period itself, not the grid: a month's summary does not
// include the last days of the month before.
function totals(res, w) {
  const a = ymd(w.first), b = ymd(w.last);
  let kg = 0, h = 0, t = 0, s = 0;
  (res.days || []).forEach(r => {
    const k = String(r.date).slice(0, 10);
    if (k < a || k > b) return;
    kg += Number(r.harvest_kg) || 0;
    h += r.harvests || 0;
    t += r.transplants || 0;
    s += r.sowings || 0;
  });
  if (!h && !t && !s) return 'nothing sown, transplanted or harvested';
  const bits = [];
  if (h) bits.push(`${num(kg)} kg from ${h} harvest${h === 1 ? '' : 's'}`);
  if (t) bits.push(`${t} transplant${t === 1 ? '' : 's'}`);
  if (s) bits.push(`${s} sowing${s === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

const byDate = rows => {
  const m = new Map();
  (rows || []).forEach(r => {
    const k = String(r.date).slice(0, 10);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  return m;
};
const dayIndex = rows => new Map((rows || []).map(r => [String(r.date).slice(0, 10), r]));
const openOn = (res, d) => !res.operating_days || res.operating_days.includes(isoDow(d));
const todayKey = res => String(res.today || ymd(new Date())).slice(0, 10);
const eventDetail = x => x.kind === 'harvest' ? `${x.position} · ${x.kg ?? '—'} kg`
                       : x.kind === 'transplant' ? `${x.position} · in`
                       : `${x.position} · sown`;

// ── week: seven columns, the batches by name ──
function weekView(res, from) {
  const strip = el('div', 'week-strip');
  const events = byDate(res.events), days = dayIndex(res.days), today = todayKey(res);
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i), key = ymd(d), open = openOn(res, d);
    const col = el('div', 'day' + (open ? '' : ' closed') + (key === today ? ' today' : ''));
    const h = el('div', 'day-head');
    h.append(el('span', 'day-name', dayLabel(key)));
    const info = days.get(key);
    if (info?.tasks) {
      const n = el('span', 'day-count', `${info.done}/${info.tasks}`);
      n.title = `${info.tasks} task${info.tasks === 1 ? '' : 's'}, ${info.done} done`;
      h.append(n);
    }
    col.append(h);

    // A transplant day can hold a dozen batches. Three fit in a seventh of the
    // width; the rest are a count that opens the plan, because a column tall
    // enough for twelve pushes everything below the fold on every other day.
    const list = (events.get(key) || []).slice()
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.crop.localeCompare(b.crop));
    list.slice(0, 3).forEach(x => {
      const c = el('div', 'ev ' + x.kind);
      c.append(el('b', null, x.crop));
      c.append(el('span', null, eventDetail(x)));
      col.append(c);
    });
    if (list.length > 3) {
      const more = el('a', 'ev more', `+${list.length - 3} more`);
      more.href = '#/crops';
      more.title = list.slice(3).map(x => `${x.crop} · ${eventDetail(x)}`).join('\n');
      col.append(more);
    }
    if (!list.length && !open) col.append(el('div', 'ev none', 'closed'));
    strip.append(col);
  }
  return strip;
}

// ── month: a grid of days, counts per day, names in the tooltip ──
function monthView(res, w, parts) {
  const grid = el('div', 'month-grid');
  DAY_NAME.slice(1).forEach(n => grid.append(el('div', 'mg-dow', n)));
  const days = dayIndex(res.days), events = byDate(res.events), today = todayKey(res);
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
    const key = ymd(d), info = days.get(key) || {};
    const cell = el('button', 'mg-day'
      + (d.getMonth() === w.first.getMonth() ? '' : ' out')
      + (openOn(res, d) ? '' : ' closed')
      + (key === today ? ' today' : ''));
    cell.type = 'button';
    cell.append(el('span', 'mg-num', String(d.getDate())));
    if (info.harvests) cell.append(el('span', 'mc harvest', `${info.harvests} · ${num(info.harvest_kg)} kg`));
    if (info.transplants) cell.append(el('span', 'mc transplant', `${info.transplants} in`));
    if (info.sowings) cell.append(el('span', 'mc sow', `${info.sowings} sown`));
    const names = (events.get(key) || []).map(x => `${x.crop} · ${eventDetail(x)}`);
    cell.title = [
      d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      ...names.slice(0, 10),
      names.length > 10 ? `and ${names.length - 10} more` : '',
      'Click to open the week',
    ].filter(Boolean).join('\n');
    const day = d;
    cell.onclick = () => goCalendar(parts, 'week', day);
    grid.append(cell);
  }
  return grid;
}

// ── year: twelve months, harvest weight as the bar ──
function yearView(res, year, parts) {
  const months = Array.from({ length: 12 }, () => ({ kg: 0, harvests: 0, transplants: 0, sowings: 0 }));
  (res.days || []).forEach(r => {
    const d = parse(String(r.date).slice(0, 10));
    if (d.getFullYear() !== year) return;
    const m = months[d.getMonth()];
    m.kg += Number(r.harvest_kg) || 0;
    m.harvests += r.harvests || 0;
    m.transplants += r.transplants || 0;
    m.sowings += r.sowings || 0;
  });
  const max = Math.max(1, ...months.map(m => m.kg));
  const now = new Date();
  const chart = el('div', 'year-chart');
  months.forEach((m, i) => {
    const first = new Date(year, i, 1);
    const col = el('button', 'yc-month' + (year === now.getFullYear() && i === now.getMonth() ? ' now' : ''));
    col.type = 'button';
    col.append(el('div', 'yc-kg', m.kg ? `${num(m.kg)} kg` : '—'));
    const track = el('div', 'yc-track');
    const bar = el('div', 'yc-bar');
    bar.style.height = m.kg ? `${Math.max(3, Math.round((100 * m.kg) / max))}%` : '0';
    track.append(bar);
    col.append(track);
    col.append(el('div', 'yc-name', first.toLocaleDateString(undefined, { month: 'short' })));
    const sub = el('div', 'yc-sub');
    if (m.transplants) sub.append(el('span', 't', `${m.transplants} in`));
    if (m.sowings) sub.append(el('span', 's', `${m.sowings} sown`));
    col.append(sub);
    col.title = `${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: `
      + `${num(m.kg)} kg from ${m.harvests} harvests · ${m.transplants} transplants · `
      + `${m.sowings} sowings\nClick to open the month`;
    col.onclick = () => goCalendar(parts, 'month', first);
    chart.append(col);
  });
  return chart;
}

// ── how full each bay is ───────────────────────────────────────────────────
function bays() {
  const card = el('div', 'card');
  card.style.marginTop = 'var(--space-4)';
  const head = el('div', 'card-pad row');
  head.append(el('div', 'sec-title', 'Bays'));
  head.append(el('div', 'spacer'));
  const a = el('a', 'btn btn-sm', 'Open the plan');
  a.href = '#/crops';
  head.append(a);
  card.append(head);

  const list = el('div', 'bar-list');
  data.occupancy.by_system.forEach(s => {
    const row = el('div', 'bar-row');
    row.append(el('div', 'bar-name', s.name));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = s.pct + '%';
    track.append(fill);
    if (s.proposed) {
      const prop = el('div', 'bar-proposed');
      prop.style.width = Math.round(100 * s.proposed / Math.max(s.positions, 1)) + '%';
      prop.title = `${s.proposed} proposed, not planted`;
      track.append(prop);
    }
    row.append(track);
    row.append(el('div', 'bar-num', `${s.occupied}/${s.positions}`));
    list.append(row);
  });
  if (!data.occupancy.by_system.length) {
    list.append(el('div', 'empty', 'No growing systems yet — set them up on Farm setup.'));
  }
  card.append(list);
  return card;
}

// Settings chooses the view the calendar opens on.
export function setCalendarView(v) {
  if (!VIEWS.some(x => x[0] === v)) return;
  cal.view = v;
  pref.set(CAL_KEY, v);
}
export const calendarView = () => cal.view;

// The window the calendar opens on today, as the arguments it fetches with —
// app.js reads it ahead so the dashboard opens offline too.
export function calendarRange() {
  const w = windowOf(cal.view, new Date());
  return { p_from: ymd(w.from), p_to: ymd(w.to) };
}
