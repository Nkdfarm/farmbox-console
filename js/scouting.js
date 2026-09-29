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
// Since 0141 (console 0.7.153) the phone's scouting has sections: a plant photo
// is Plant health or Growth, carries its position (3B8) or its GPS and, for
// growth, the sizes measured on the printed scale card; the day ends OK or Not
// OK with a note. A photo placed by GPS only has no zone: listed apart.
// Since 0170 (console 0.7.166, owner: "the zones to select, to generate 5 reports") the unit's zones sit at
// the top: a chosen zone turns the page into that zone's report — its pressure, cases, crops, and each date
// with that zone's traps and photos only (scouting_dates.zone_counts). Remembered per unit.
// Since 0171 (console 0.7.167, owner: "split zone 4 in 4.1 and 4.2 report") the chips are report units: a zone,
// or each table of a zone reported by table (FarmLab Zone 4.1 and 4.2) — pest_overview.pressure_units,
// scouting_dates.unit_counts, scouting_day.units. A card or photo of the zone that names no table is in both.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, pageHead, drawer, num, cropAvatar, toast } from './ui.js';
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
const MEASURE_WORD = { diameter: 'Ø', length: 'L', width: 'W', height: 'H' };
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';

let farm = null, mount = null, over = null, cases = null, dates = [], catalog = null;
let cropFilter = null, zoneFilter = null, showClosed = false, moreDone = false;
const zoneKey = () => 'fbc_pd_zone_' + farm.id;
// the report units (0171): a zone, or one table of a zone reported table by table; an older database gives zones
const zones = () => (over?.pressure_units || over?.pressure_zones || []).map(z => ({ ...z, unit_id: z.unit_id || z.zone_id }));
const cur = () => zones().find(z => z.unit_id === zoneFilter) || null;
const zoneName = id => zones().find(z => z.unit_id === id)?.zone || 'this zone';
// a row of (zone, table) in a unit: its table's rows, and the zone's rows that name none of its tables
const inUnit = (u, zoneId, sysId) => !!u && zoneId === u.zone_id && (!u.system_id || !sysId || sysId === u.system_id
  || !zones().some(x => x.zone_id === u.zone_id && x.system_id === sysId));
// in the chosen zone: a crop standing there, a case opened there
const cropInZone = c => { const u = cur(); if (!u) return true;
  return u.system_id ? (c.system_ids || []).includes(u.system_id) : (c.zones || []).some(z => z.id === u.zone_id); };
const caseInZone = k => !zoneFilter || inUnit(cur(), k.zone_id, k.system_id);
const dayData = new Map();          // day → scouting_day, read when the day is opened

export async function renderScouting(container, currentFarm) {
  if (farm?.id !== currentFarm.id) {
    dayData.clear(); cropFilter = null;
    try { zoneFilter = localStorage.getItem('fbc_pd_zone_' + currentFarm.id) || null; } catch (e) { zoneFilter = null; }
  }
  farm = currentFarm; mount = container;
  await load();
}

async function load(fresh = false) {
  const here = mount, a = { p_farm: farm.id };
  // last time's copy at once, the server's answer behind it (0.7.107)
  await openFast([
    ['pest_overview', a],
    ['cases', { ...a, p_include_closed: showClosed }],
    ['scouting_dates', { ...a, p_before: null, p_limit: 21 }],
    ['pest_catalog', {}],
  ], {
    show: ([o, c, d, cat]) => {
      over = o; cases = c; dates = d; catalog = cat;
      useFarm(farm, catalog);
      moreDone = dates.length < 21;
      dayData.clear();
      paint();
    },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the farm…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}
const reload = () => load(true);   // after a change: the server's answer, not the old copy

function paint() {
  mount.textContent = '';
  const openBtn = el('button', 'btn btn-primary', 'Open a case');
  openBtn.onclick = () => newCase({ farm, crop_id: cropFilter, crops: over.crops || [], onDone: reload });
  const scaleBtn = el('a', 'btn', 'Scale card');
  scaleBtn.href = 'scale-card.html'; scaleBtn.target = '_blank'; scaleBtn.rel = 'noopener';
  scaleBtn.title = 'The printed card for growth photos: a 5 cm magenta square the phone measures against';
  const trapsBtn = el('button', 'btn', 'Traps…');
  trapsBtn.title = 'Add or move traps, set the thresholds, see every trap with its trend';
  trapsBtn.onclick = openTraps;
  mount.append(pageHead('Pest & diseases',
    'The daily scouting by date, zone by zone, with the traps and the photos. A dot says the worst thing inside: ' +
    'red severe or over the threshold, orange open or on watch, green improving or resolved.', scaleBtn, trapsBtn, openBtn));

  if (zoneFilter && !cur()) zoneFilter = null;   // a zone gone, or Zone 4 now reported as 4.1 and 4.2
  mount.append(zoneBar());
  mount.append(zoneFilter ? zoneReport() : dashboard());
  mount.append(caseStrip());
  mount.append(cropBar());

  const list = el('div', 'pd-days');
  const shown = dates.filter(d => !cropFilter || (d.photo_crops || {})[cropFilter] || d.traps);
  if (zoneFilter) list.append(el('div', 'pd-zone-head', `${zoneName(zoneFilter)} — the scouting report by date`));
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

// ── the zones, at the top: one report each (0170) ──
function zoneBar() {
  const box = el('div', 'pd-zones');
  box.append(el('span', 'pd-strip-label', 'Report for'));
  const pick = id => {
    zoneFilter = zoneFilter === id ? null : id;
    try { zoneFilter ? localStorage.setItem(zoneKey(), zoneFilter) : localStorage.removeItem(zoneKey()); } catch (e) { /* this device only */ }
    cropFilter = null;
    paint();
  };
  const all = el('button', 'pd-zonechip' + (!zoneFilter ? ' on' : ''), 'All zones');
  all.setAttribute('aria-pressed', String(!zoneFilter));
  all.onclick = () => pick(null);
  box.append(all);
  zones().forEach(z => {
    const b = el('button', 'pd-zonechip' + (zoneFilter === z.unit_id ? ' on' : ''));
    b.setAttribute('aria-pressed', String(zoneFilter === z.unit_id));
    const d = worst((cases.cases || []).filter(k => inUnit(z, k.zone_id, k.system_id) && k.status !== 'closed').map(k => k.dot));
    b.append(dotEl(d), el('b', null, z.zone));
    if (z.now != null) b.append(el('span', 'hint', `${num(z.now, 1)}/day`));
    b.title = [z.now != null ? `${num(z.now, 1)} insects/trap/day this week` : 'no trap rate this week',
               z.cases ? `${z.cases} open case${z.cases === 1 ? '' : 's'}` : null,
               z.last_read ? 'last trap read ' + shortDay(z.last_read) : null].filter(Boolean).join(' · ');
    b.onclick = () => pick(z.unit_id);
    box.append(b);
  });
  return box;
}

// ── one zone's report head: its pressure, cases, crops and the latest reading ──
function zoneReport() {
  const z = cur() || {};
  const box = el('div', 'pd-dash');
  const tiles = el('div', 'pd-tiles');
  const tile = (n, label, cls) => { const t = el('div', 'pd-tile' + (cls ? ' ' + cls : '')); t.append(el('b', null, String(n ?? 0)), el('span', null, label)); tiles.append(t); };
  const open = (cases.cases || []).filter(k => inUnit(z, k.zone_id, k.system_id) && k.status !== 'closed');
  const trend = z.now != null && z.before != null ? (z.now > z.before ? ' ▲' : z.now < z.before ? ' ▼' : '') : '';
  tile(z.now != null ? num(z.now, 1) + trend : '—', 'insects/trap/day this week', z.now != null && over.threshold?.over != null && z.now >= over.threshold.over ? 'bad'
    : z.now != null && over.threshold?.watch != null && z.now >= over.threshold.watch ? 'warn' : '');
  tile(z.before != null ? num(z.before, 1) : '—', 'last week');
  tile(open.length, open.length === 1 ? 'case open' : 'cases open', open.length ? 'warn' : '');
  tile(open.filter(k => k.status === 'in_progress').length, 'treatments running');
  tile(z.last_read ? shortDay(z.last_read) : '—', 'traps last read');
  box.append(tiles);
  const crops = (over.crops || []).filter(cropInZone);
  if (crops.length) {
    const row = el('div', 'pd-zone-crops');
    row.append(el('span', 'hint', 'Standing here'));
    crops.forEach(c => { const x = el('span', 'pd-zone-crop'); x.append(cropAvatar({ name: c.name, category: c.category, photo_url: c.photo_url }, 'sm'), el('span', null, c.name)); row.append(x); });
    box.append(row);
  }
  const today = String(over.today);
  crops.filter(x => x.harvest_after && x.harvest_after > today).forEach(x =>
    box.append(el('div', 'note warn pd-wait-note', `Do not harvest ${x.name} here before ${longDay(x.harvest_after)} — a treatment's withholding period.`)));
  return box;
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
  const list = (cases.cases || []).filter(k => (!cropFilter || k.crop_id === cropFilter) && caseInZone(k));
  box.append(el('span', 'pd-strip-label', showClosed ? 'Cases' : 'Open cases'));
  if (!list.length) box.append(el('span', 'hint', cropFilter ? 'none on this crop' : zoneFilter ? 'none in ' + zoneName(zoneFilter) : 'none'));
  list.forEach(k => {
    const b = el('button', 'pd-case' + (k.status === 'closed' ? ' closed' : ''));
    b.append(dotEl(k.dot), el('b', null, k.label || k.title), el('span', 'hint', [k.crop, k.zone, k.status === 'in_progress' ? 'treating' : k.status === 'closed' ? String(k.outcome || 'closed').replace('_', ' ') : null].filter(Boolean).join(' · ')));
    b.onclick = () => openCase(k.id, reload, farm);
    box.append(b);
  });
  const t = el('button', 'linkish', showClosed ? 'Hide closed' : 'Show closed');
  t.onclick = async () => {
    showClosed = !showClosed;
    try { cases = await rpc('cases', { p_farm: farm.id, p_include_closed: showClosed }); paint(); }
    catch (e) { showClosed = !showClosed; toast(e.message, 'bad'); }
  };
  box.append(t);
  return box;
}

// ── the crop filter ──
function cropBar() {
  const box = el('div', 'pd-crops');
  const all = el('button', 'pd-cropchip' + (!cropFilter ? ' on' : ''), 'All crops');
  all.onclick = () => { cropFilter = null; paint(); };
  box.append(all);
  (over.crops || []).filter(cropInZone).forEach(c => {
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
  const zc = zoneFilter ? ((d.unit_counts || d.zone_counts || {})[zoneFilter] || { photos: 0, traps: 0 }) : null;
  const nPhotos = zc && !cropFilter ? zc.photos : cropFilter ? ((d.photo_crops || {})[cropFilter] || 0) : d.photos;
  const nTraps = zc ? zc.traps : d.traps;
  facts.append(el('span', 'pill', `${nPhotos} photo${nPhotos === 1 ? '' : 's'}`), el('span', 'pill', `${nTraps} trap${nTraps === 1 ? '' : 's'} counted`));
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
    // the finish the phone sent: OK, or not OK with why (0141)
    const tk = day.task;
    if (tk?.outcome) {
      body.append(el('div', 'note ' + (tk.outcome === 'nok' ? 'bad' : 'ok') + ' sc-outcome',
        (tk.outcome === 'nok' ? 'Not OK' : 'OK') + (tk.outcome_note ? ' — ' + tk.outcome_note : '') +
        (tk.edited_at ? ` · changed ${shortDay(tk.edited_at)} ${hhmm(tk.edited_at)}` : '')));
      // each section's own result, as the phone closes every tab (0169, Naked Brain 0.11.63)
      const so = tk.section_outcomes;
      if (so && Object.keys(so).length) {
        const row = el('div', 'sc-verdicts');
        [['trap', 'Traps'], ['health', 'Plant health'], ['growth', 'Growth']].forEach(([k, label]) => {
          const v = so[k]; if (!v) return;
          const pill = el('span', 'pill ' + (v.outcome === 'ok' ? 'ok' : 'bad'), `${v.outcome === 'ok' ? '✓' : '✕'} ${label}`);
          if (v.note) pill.title = v.note;
          row.append(pill);
        });
        body.append(row);
      }
    }
    const zones = (zoneFilter ? (day.units || day.zones || []) : (day.zones || [])).filter(z => (!zoneFilter || (z.unit_id || z.zone_id) === zoneFilter)
      && (!cropFilter || (z.crops || []).some(c => c.id === cropFilter) || z.photos.some(p => p.crop_id === cropFilter)));
    // a zone with nothing in it that day is one word, not a band
    const has = z => z.traps.length || z.photos.length || (z.cases || []).length;
    const full = zones.filter(has), empty = zones.filter(z => !has(z));
    if (zoneFilter && !full.length) body.append(el('div', 'hint', `Nothing photographed or counted in ${zoneName(zoneFilter)} that day.`));
    else if (!full.length && !(day.unplaced || []).length) body.append(el('div', 'hint', cropFilter ? 'No zone with this crop.' : 'Nothing photographed that day.'));
    full.forEach(z => { const b = zoneBand(z, day); if (zoneFilter) b.open = true; body.append(b); });
    const gps = zoneFilter ? [] : (day.unplaced || []).filter(p => !cropFilter || p.crop_id === cropFilter);
    if (gps.length) body.append(zoneBand({ zone_id: null, name: 'Placed by GPS', crops: [], traps: [], photos: gps, cases: [] }, day));
    if (empty.length && full.length) body.append(el('div', 'hint', 'Nothing photographed in ' + empty.map(z => z.name).join(', ') + '.'));
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
  const zd = worst([...photos.map(p => p.dot), ...traps.map(p => p.dot), ...caseDots]);   // an open case colours its zone too
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
  if (z.zone_id) right.append(el('span', 'pill', traps.length ? `${traps.length} trap${traps.length > 1 ? 's' : ''}` : (z.item?.done_at ? 'traps skipped' : 'traps —')));
  right.append(el('span', 'pill', `${photos.length} photo${photos.length === 1 ? '' : 's'}`));
  (z.cases || []).forEach(k => {
    const full = (cases.cases || []).find(x => x.id === k.id);
    const b = el('button', 'pd-case small');
    b.append(dotEl(full?.dot || 'orange'), el('span', null, (full?.label || k.title.replace(/ in .*$/, ''))));
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); openCase(k.id, reload, farm); };
    right.append(b);
  });
  if (z.item?.done_at) right.append(el('span', 'hint', hhmm(z.item.done_at)));
  else if (z.item) right.append(el('span', 'hint', 'not done'));
  sum.append(right);
  det.append(sum);

  const body = el('div', 'pd-zone-body');
  const shared = [...traps, ...photos].filter(p => p.shared).length;
  if (shared) body.append(el('div', 'hint pd-shared', `${shared} of these name ${z.zone_name || 'the zone'} without its table, so they are in each of its reports.`));
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
    zonePhotos: () => z.zone_id ? rpc('zone_photos', { p_farm: farm.id, p_zone: z.zone_id }) : Promise.resolve([]),
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
  if (p.day_rate != null) { const r = el('span', 'hint', `${num(p.day_rate, p.day_rate >= 10 ? 0 : 1)}/day`); r.title = 'New insects a day since the photo before'; head.append(r); }
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
  // the section, where it was, the sizes on the scale card (0141)
  const where = p.pos_code || (p.gps ? 'GPS' + (p.gps.acc != null ? ` ±${Math.round(p.gps.acc)} m` : '') : null);
  const sizes = (p.measures || []).map(m => `${MEASURE_WORD[m.what] || m.what} ${num(m.mm, 0)} mm`).join(' · ');
  const line = el('div', 'sc-where');
  if (p.section) line.append(el('span', 'pill ' + (p.section === 'growth' ? 'ok' : ''), p.section === 'growth' ? 'Growth' : 'Plant health'));
  if (where) {
    if (p.gps && !p.pos_code) { const a = el('a', null, where); a.href = `https://www.google.com/maps?q=${p.gps.lat},${p.gps.lng}`; a.target = '_blank'; a.rel = 'noopener'; a.onclick = e => e.stopPropagation(); line.append(a); }
    else line.append(el('span', 'mono', where));
  }
  if (sizes) line.append(el('b', null, sizes));
  if (line.children.length) cap.append(line);
  const st = p.ai_status === 'done' ? 'AI read' : p.ai_status === 'queued' ? 'AI asked' : p.ai_status === 'failed' ? 'AI failed' : null;
  cap.append(el('div', 'hint', [hhmm(p.taken_at), p.note, st].filter(Boolean).join(' · ')));
  if (p.ai?.summary) cap.append(el('div', 'sc-ai-line', '✦ ' + p.ai.summary));
  fig.append(cap);
  fig.onclick = () => openViewer(viewerCtx(p, z, day));
  return fig;
}

// the trap setup, in a wide window: add, move, thresholds, every trap with its trend
function openTraps() {
  const d = drawer('Traps', 'Where they hang, their thresholds, their trend', { onClose: () => reload() });
  d.box.style.width = 'min(1100px, 100vw)';
  renderIpm(d.body, farm);
  const close = el('button', 'btn', 'Close');
  close.onclick = () => d.close();
  d.footer.append(close);
}
