// ═══════════════════════════════════════════════════════════════════════════
// Pest & diseases — one page (console 0.7.101, migration 0099)
//
// The owner asked for one compact page instead of five tabs:
//   the dashboard at the top (open diseases, pests, treatments, traps over the
//   threshold, photos to look at, the pressure, the waits before harvest);
//   the open cases as a strip — each opens the case window;
//   a crop filter — the "by crop" view without a second layout;
//   the scouting reports by date, newest first — a date opens its zones, a
//   zone its traps (6–7, each with its count, its curve by date and its
//   photo) and its plant photos; any photo opens the viewer (zoom, tags, the
//   AI on request, compare, add to a case).
// A dot says the worst thing inside and climbs photo → zone → date → the side
// menu: red a severe case or a trap over the threshold, orange a case open or a
// trap on watch, green a case improving under treatment or resolved in 14 days.
// The trap setup (add, move, thresholds) is behind "Traps…".
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, pageHead, drawer, num, cropAvatar } from './ui.js';
import { openViewer, tagChips, photoTitle } from './viewer.js';
import { openCase, newCase, useFarm } from './cases.js';
import { renderIpm } from './ipm.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RANK = { red: 3, orange: 2, green: 1 };
const worst = list => list.reduce((a, d) => (RANK[d] || 0) > (RANK[a] || 0) ? d : a, null);
const DOT_WORD = { red: 'Severe, or a trap over the threshold', orange: 'A case open, or a trap on watch', green: 'Improving under treatment, or resolved recently' };
const dotEl = d => { const s = el('span', 'dot' + (d ? ' ' + d : ' none')); if (d) s.title = DOT_WORD[d]; return s; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const longDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = s => parse(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';

let farm = null, mount = null, over = null, cases = null, dates = [], catalog = null;
let cropFilter = null, showClosed = false, moreDone = false;
const dayData = new Map();          // day → scouting_day, read when the day is opened

export async function renderScouting(container, currentFarm) {
  if (farm?.id !== currentFarm.id) { dayData.clear(); cropFilter = null; }
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the farm…'));
  try {
    [over, cases, dates, catalog] = await Promise.all([
      rpc('pest_overview', { p_farm: farm.id }),
      rpc('cases', { p_farm: farm.id, p_include_closed: showClosed }),
      rpc('scouting_dates', { p_farm: farm.id, p_before: null, p_limit: 21 }),
      catalog || rpc('pest_catalog')]);
  } catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  useFarm(farm, catalog);
  moreDone = dates.length < 21;
  dayData.clear();
  paint();
}
const reload = () => load();

function paint() {
  mount.textContent = '';
  const openBtn = el('button', 'btn btn-primary', 'Open a case');
  openBtn.onclick = () => newCase({ crop_id: cropFilter, crops: over.crops || [], onDone: reload });
  const trapsBtn = el('button', 'btn', 'Traps…');
  trapsBtn.title = 'Add or move traps, set the thresholds, see every trap with its trend';
  trapsBtn.onclick = openTraps;
  mount.append(pageHead('Pest & diseases',
    'The daily scouting by date, zone by zone, with the traps and the photos. A dot says the worst thing inside: ' +
    'red severe or over the threshold, orange open or on watch, green improving or resolved.', trapsBtn, openBtn));

  mount.append(dashboard());
  mount.append(caseStrip());
  mount.append(cropBar());

  const list = el('div', 'pd-days');
  const shown = dates.filter(d => !cropFilter || (d.photo_crops || {})[cropFilter] || d.traps);
  if (!shown.length) list.append(el('div', 'empty', 'No scouting report yet. The phone makes one every working day.'));
  shown.forEach((d, i) => list.append(dayRow(d, i === 0)));
  mount.append(list);
  if (!moreDone) {
    const more = el('button', 'btn btn-sm', 'Show older reports');
    more.onclick = async () => {
      more.disabled = true;
      try {
        const older = await rpc('scouting_dates', { p_farm: farm.id, p_before: dates[dates.length - 1].day, p_limit: 21 });
        moreDone = older.length < 21;
        dates = dates.concat(older);
        const start = list.children.length;
        older.filter(d => !cropFilter || (d.photo_crops || {})[cropFilter] || d.traps).forEach(d => list.append(dayRow(d, false)));
        if (moreDone) more.remove(); else more.disabled = false;
        if (list.children.length === start) more.textContent = 'Show older reports (none with this crop)';
      } catch (e) { more.disabled = false; more.textContent = e.message; }
    };
    mount.append(more);
  }
}

// ── the dashboard ──
function dashboard() {
  const box = el('div', 'pd-dash');
  const c = over.counts || {};
  const tiles = el('div', 'pd-tiles');
  const tile = (n, label, cls) => {
    const t = el('div', 'pd-tile' + (cls ? ' ' + cls : ''));
    t.append(el('b', null, String(n ?? 0)), el('span', null, label));
    tiles.append(t);
  };
  tile(c.diseases, 'diseases open', c.diseases ? 'bad' : '');
  tile(c.pests, 'pests open', c.pests ? 'warn' : '');
  tile(c.programs, 'treatments running');
  tile(c.traps_over, `trap${c.traps_over === 1 ? '' : 's'} over ${over.threshold?.over ?? ''}`.trim(), c.traps_over ? 'bad' : '');
  tile(c.to_review, 'photos to look at', c.to_review ? 'warn' : '');
  tile(`${c.scouted_days ?? 0}/${c.scouting_days ?? 0}`, 'days scouted this week');
  box.append(tiles);

  // the pressure, twelve weeks, as a small line
  const pw = over.pressure_weeks || [];
  const pr = el('div', 'pd-pressure');
  const now = pw.find(w => String(w.week).slice(0, 10) === String(over.week).slice(0, 10));
  pr.append(el('span', 'hint', 'Insect pressure'), el('b', null, now ? `${num(now.rate, 1)}` : '—'), el('span', 'hint', 'insects/trap/day this week'));
  pr.append(pressureLine(pw, over.week));
  box.append(pr);

  const today = String(over.today);
  (over.crops || []).filter(x => x.harvest_after && x.harvest_after > today).forEach(x => {
    const zones = (x.zones || []).map(z => z.name).join(', ');
    box.append(el('div', 'note warn pd-wait-note', `Do not harvest ${x.name}${zones ? ' in ' + zones : ''} before ${longDay(x.harvest_after)} — a treatment's withholding period.`));
  });
  return box;
}

function pressureLine(weeks, thisWeek) {
  const W = 220, H = 40, pad = 4;
  const last = parse(thisWeek);
  const all = [];
  for (let k = 11; k >= 0; k--) { const d = new Date(last); d.setDate(d.getDate() - 7 * k); all.push(ymd(d)); }
  const by = new Map(weeks.map(w => [String(w.week).slice(0, 10), Number(w.rate) || 0]));
  const max = Math.max(1, ...by.values());
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-spark'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Insect pressure, twelve weeks');
  const x = i => pad + i * (W - 2 * pad) / (all.length - 1);
  const y = v => H - pad - v * (H - 2 * pad) / max;
  let seg = [];
  const flush = () => { if (seg.length > 1) { const pl = document.createElementNS(SVG_NS, 'polyline'); pl.setAttribute('points', seg.join(' ')); svg.append(pl); } seg = []; };
  all.forEach((wk, i) => {
    if (!by.has(wk)) { flush(); return; }                      // a week without a reading is a gap
    seg.push(`${x(i).toFixed(1)},${y(by.get(wk)).toFixed(1)}`);
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', x(i)); c.setAttribute('cy', y(by.get(wk))); c.setAttribute('r', i === all.length - 1 ? 2.8 : 1.6);
    const t = document.createElementNS(SVG_NS, 'title'); t.textContent = `Week of ${shortDay(wk)}: ${num(by.get(wk), 2)}`; c.append(t);
    svg.append(c);
  });
  flush();
  return svg;
}

// ── the open cases, as chips ──
function caseStrip() {
  const box = el('div', 'pd-strip');
  const list = (cases.cases || []).filter(k => !cropFilter || k.crop_id === cropFilter);
  box.append(el('span', 'pd-strip-label', showClosed ? 'Cases' : 'Open cases'));
  if (!list.length) box.append(el('span', 'hint', cropFilter ? 'none on this crop' : 'none'));
  list.forEach(k => {
    const b = el('button', 'pd-case' + (k.status === 'closed' ? ' closed' : ''));
    b.append(dotEl(k.dot), el('b', null, k.label || k.title), el('span', 'hint', [k.crop, k.zone, k.status === 'in_progress' ? 'treating' : k.status === 'closed' ? String(k.outcome || 'closed').replace('_', ' ') : null].filter(Boolean).join(' · ')));
    b.onclick = () => openCase(k.id, reload);
    box.append(b);
  });
  const t = el('button', 'linkish', showClosed ? 'Hide closed' : 'Show closed');
  t.onclick = async () => { showClosed = !showClosed; cases = await rpc('cases', { p_farm: farm.id, p_include_closed: showClosed }); paint(); };
  box.append(t);
  return box;
}

// ── the crop filter ──
function cropBar() {
  const box = el('div', 'pd-crops');
  const all = el('button', 'pd-cropchip' + (!cropFilter ? ' on' : ''), 'All crops');
  all.onclick = () => { cropFilter = null; paint(); };
  box.append(all);
  (over.crops || []).forEach(c => {
    const b = el('button', 'pd-cropchip' + (cropFilter === c.id ? ' on' : ''));
    const d = worst((cases.cases || []).filter(k => k.crop_id === c.id).map(k => k.dot));
    b.append(cropAvatar({ name: c.name, category: c.category, photo_url: c.photo_url }, 'sm'), el('span', null, c.name));
    if (d) b.append(dotEl(d));
    b.title = [(c.zones || []).map(z => z.name).join(', '), c.pressure != null ? `${num(c.pressure, 1)} insects/trap/day` : null].filter(Boolean).join(' · ');
    b.onclick = () => { cropFilter = cropFilter === c.id ? null : c.id; paint(); };
    box.append(b);
  });
  return box;
}

// ── one report day ──
function dayRow(d, openFirst) {
  const det = el('details', 'pd-day');
  const sum = el('summary');
  sum.append(dotEl(d.dot), el('b', null, longDay(d.day) + (d.day === String(over.today) ? ' · today' : '')));
  const facts = el('span', 'pd-day-facts');
  const t = d.task;
  if (t) facts.append(el('span', 'pill ' + (t.status === 'done' ? 'ok' : parse(d.day) < parse(over.today) ? 'bad' : 'warn'),
    t.status === 'done' ? `scouted${t.workers?.length ? ' by ' + t.workers.join(', ') : ''}${t.done_at ? ' · ' + hhmm(t.done_at) : ''}`
      : t.zones ? `${t.zones_done}/${t.zones} zones` : t.status));
  const nPhotos = cropFilter ? ((d.photo_crops || {})[cropFilter] || 0) : d.photos;
  facts.append(el('span', 'pill', `${nPhotos} photo${nPhotos === 1 ? '' : 's'}`), el('span', 'pill', `${d.traps} trap${d.traps === 1 ? '' : 's'} counted`));
  sum.append(facts);
  det.append(sum);
  const body = el('div', 'pd-day-body');
  det.append(body);
  const fill = async () => {
    if (body.dataset.done) return;
    body.dataset.done = '1';
    body.append(el('div', 'hint', 'Reading the day…'));
    let day = dayData.get(d.day);
    try { if (!day) { day = await rpc('scouting_day', { p_farm: farm.id, p_day: d.day }); dayData.set(d.day, day); } }
    catch (e) { body.textContent = ''; body.append(el('div', 'note bad', e.message)); delete body.dataset.done; return; }
    body.textContent = '';
    const zones = (day.zones || []).filter(z => !cropFilter || (z.crops || []).some(c => c.id === cropFilter) || z.photos.some(p => p.crop_id === cropFilter));
    if (!zones.length) body.append(el('div', 'hint', 'No zone with this crop.'));
    zones.forEach(z => body.append(zoneBand(z, day)));
  };
  det.addEventListener('toggle', () => { if (det.open) fill(); });
  if (openFirst) { det.open = true; fill(); }
  return det;
}

// ── one zone of a day: its traps, then its plant photos ──
function zoneBand(z, day) {
  const photos = z.photos.filter(p => !cropFilter || p.crop_id === cropFilter).map(p => ({ ...p, zone: z.name }));
  const traps = z.traps.map(p => ({ ...p, zone: z.name }));
  const caseDots = (z.cases || []).map(k => (cases.cases || []).find(x => x.id === k.id)?.dot).filter(Boolean);
  const zd = worst([...photos.map(p => p.dot), ...traps.map(p => p.dot)]);
  const det = el('details', 'pd-zone-band');
  det.open = !!zd || photos.length > 0;
  const sum = el('summary');
  const left = el('span', 'pd-zone-title');
  left.append(dotEl(zd), el('b', null, z.name));
  const cr = el('span', 'sc-crops');
  (z.crops || []).forEach(c => cr.append(cropAvatar({ ...c }, 'sm')));
  left.append(cr);
  sum.append(left);
  const right = el('span', 'pd-day-facts');
  right.append(el('span', 'pill', traps.length ? `${traps.length} trap${traps.length > 1 ? 's' : ''}` : (z.item?.done_at ? 'traps skipped' : 'traps —')),
               el('span', 'pill', `${photos.length} photo${photos.length === 1 ? '' : 's'}`));
  (z.cases || []).forEach(k => {
    const full = (cases.cases || []).find(x => x.id === k.id);
    const b = el('button', 'pd-case small');
    b.append(dotEl(full?.dot || 'orange'), el('span', null, (full?.label || k.title.replace(/ in .*$/, ''))));
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); openCase(k.id, reload); };
    right.append(b);
  });
  if (z.item?.done_at) right.append(el('span', 'hint', hhmm(z.item.done_at)));
  else if (z.item) right.append(el('span', 'hint', 'not done'));
  sum.append(right);
  det.append(sum);

  const body = el('div', 'pd-zone-body');
  if (traps.length) {
    const row = el('div', 'pd-traps');
    traps.forEach(p => row.append(trapCard(p, z, day)));
    body.append(row);
  }
  if (photos.length) {
    const grid = el('div', 'sc-grid');
    photos.forEach(p => grid.append(photoFig(p, z, day)));
    body.append(grid);
  }
  if (!traps.length && !photos.length) body.append(el('div', 'hint', z.item?.done_at ? 'Nothing photographed, traps not counted.' : 'Not scouted that day.'));
  const answers = (z.answers || []).filter(a => a.note || a.value || a.result === 'nok');
  answers.forEach(a => body.append(el('div', 'sc-answer', `${a.result === 'nok' ? '✗ ' : ''}${a.title || 'step ' + a.seq}: ${[a.value, a.note].filter(Boolean).join(' · ')}`)));
  det.append(body);
  return det;
}

function viewerCtx(p, z, day) {
  return {
    farm, photo: p, catalog: catalog || [], aiReady: day.ai_ready, mayWrite: day.may_write !== false,
    zonePhotos: () => rpc('zone_photos', { p_farm: farm.id, p_zone: z.zone_id }),
    zoneId: z.zone_id, crops: z.crops || [],
    openCases: async () => (cases.cases || []).filter(c => c.zone_id === z.zone_id && c.status !== 'closed'),
    onChange: reload,
  };
}

function trapCard(p, z, day) {
  const card = el('button', 'pd-trap' + (p.dot ? ' ' + p.dot : ''));
  const im = el('img'); im.src = p.photo_data || ''; im.alt = `trap ${p.code}`; im.loading = 'lazy';
  const head = el('div', 'pd-trap-head');
  head.append(dotEl(p.dot), el('span', 'ipm-code ' + (p.colour || ''), p.code), el('b', null, num(p.total, 0)));
  card.append(im, head, trapCurve(p.curve || [], day.threshold));
  if ((p.tags || []).length || p.ai_status === 'done') card.append(tagChips(p));
  if (p.replaced) card.append(el('span', 'hint', 'card replaced'));
  card.onclick = () => openViewer(viewerCtx(p, z, day));
  return card;
}

// the trap's last 30 days by date, the threshold as a rule, a reset where the card was replaced
function trapCurve(pts, th) {
  const W = 120, H = 30, pad = 3;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-tcurve');
  if (pts.length < 2) { svg.setAttribute('aria-label', 'one reading'); return svg; }
  const ts = pts.map(p => new Date(p.at).getTime());
  const t0 = Math.min(...ts), t1 = Math.max(...ts), span = (t1 - t0) || 1;
  const max = Math.max(th?.over || 0, ...pts.map(p => p.total || 0), 1);
  const x = t => pad + (t - t0) * (W - 2 * pad) / span, y = v => H - pad - v * (H - 2 * pad) / max;
  if (th?.over) { const r = document.createElementNS(SVG_NS, 'line'); r.setAttribute('x1', pad); r.setAttribute('x2', W - pad); r.setAttribute('y1', y(th.over)); r.setAttribute('y2', y(th.over)); r.setAttribute('class', 'ipm-rule'); svg.append(r); }
  let seg = [];
  const flush = () => { if (seg.length > 1) { const pl = document.createElementNS(SVG_NS, 'polyline'); pl.setAttribute('points', seg.join(' ')); svg.append(pl); } seg = []; };
  pts.forEach((p, i) => {
    seg.push(`${x(ts[i]).toFixed(1)},${y(p.total || 0).toFixed(1)}`);
    if (p.replaced) flush();                                       // the next card starts from nothing
  });
  flush();
  const t = document.createElementNS(SVG_NS, 'title');
  t.textContent = pts.map(p => `${shortDay(p.at)}: ${p.total}${p.replaced ? ' (replaced)' : ''}`).join('\n');
  svg.append(t);
  svg.setAttribute('aria-label', `${pts.length} readings over ${Math.round(span / 864e5)} days`);
  return svg;
}

function photoFig(p, z, day) {
  const fig = el('figure', 'sc-fig' + (p.dot ? ' ' + p.dot : ''));
  const im = el('img'); im.src = p.photo_data || ''; im.alt = photoTitle(p); im.loading = 'lazy';
  fig.append(im);
  const cap = el('figcaption');
  const title = el('div', 'pd-fig-title'); title.append(dotEl(p.dot), el('b', null, photoTitle(p)));
  cap.append(title, tagChips(p));
  const st = p.ai_status === 'done' ? 'AI read' : p.ai_status === 'queued' ? 'AI asked' : p.ai_status === 'failed' ? 'AI failed' : null;
  cap.append(el('div', 'hint', [hhmm(p.taken_at), p.note, st].filter(Boolean).join(' · ')));
  fig.append(cap);
  fig.onclick = () => openViewer(viewerCtx(p, z, day));
  return fig;
}

// the trap setup, in a wide window: add, move, thresholds, every trap with its trend
function openTraps() {
  const d = drawer('Traps', 'Where they hang, their thresholds, their trend');
  d.box.style.width = 'min(1100px, 100vw)';
  renderIpm(d.body, farm);
  const close = el('button', 'btn', 'Close');
  close.onclick = () => { d.close(); reload(); };
  d.footer.append(close);
}
