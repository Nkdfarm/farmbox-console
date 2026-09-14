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
import { el, toast, icon } from './ui.js';

const FAMILY_CLASS = { Agriculture: 'fam-ag', Maintenance: 'fam-mt', Office: 'fam-of' };
const DAY_NAME = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let farm = null, data = null, mount = null;

export async function renderDashboard(container, currentFarm) {
  farm = currentFarm; mount = container;
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
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
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
  mount.append(weekStrip());
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

// ── the week, day by day ───────────────────────────────────────────────────
// Harvest and transplant are the two dates a week is built around; everything
// else can move a day and nobody notices.
function weekStrip() {
  const card = el('div', 'card');
  const head = el('div', 'card-pad row');
  head.append(el('div', 'sec-title', 'This week'));
  head.append(el('div', 'spacer'));
  head.append(el('span', 'hint', 'Harvests and transplants. Closed days are shaded.'));
  card.append(head);

  const strip = el('div', 'week-strip');
  const today = data.today;
  data.calendar.forEach(d => {
    const col = el('div', 'day' + (d.open ? '' : ' closed') + (d.date === today ? ' today' : ''));
    const h = el('div', 'day-head');
    h.append(el('span', 'day-name', dayLabel(d.date)));
    if (d.tasks) {
      const n = el('span', 'day-count', `${d.done}/${d.tasks}`);
      n.title = `${d.tasks} task${d.tasks === 1 ? '' : 's'}, ${d.done} done`;
      h.append(n);
    }
    col.append(h);

    // A transplant day can hold a dozen batches. Three fit in a seventh of the
    // width; the rest are a count that opens the plan, because a column tall
    // enough for twelve pushes everything below the fold on every other day.
    const events = [
      ...d.harvests.map(x => ['harvest', x.crop, `${x.position} · ${x.kg ?? '—'} kg`]),
      ...d.transplants.map(x => ['transplant', x.crop, `${x.position} · in`]),
    ];
    events.slice(0, 3).forEach(([kind, crop, detail]) => {
      const c = el('div', 'ev ' + kind);
      c.append(el('b', null, crop));
      c.append(el('span', null, detail));
      col.append(c);
    });
    if (events.length > 3) {
      const more = el('a', 'ev more', `+${events.length - 3} more`);
      more.href = '#/crops';
      more.title = events.slice(3).map(e => `${e[1]} · ${e[2]}`).join('\n');
      col.append(more);
    }
    // An empty open day says nothing: seven repetitions of "nothing planted"
    // is noise, and the day's own emptiness already says it.
    if (!d.harvests.length && !d.transplants.length && !d.open) {
      col.append(el('div', 'ev none', 'closed'));
    }
    strip.append(col);
  });
  card.append(strip);
  return card;
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
