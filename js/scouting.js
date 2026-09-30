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
// OK with a note. Since 0172 (console 0.7.168) the scouting is one task a zone: each zone band carries its
// own task (who, when, OK / not OK, the sections) from its zone line, and there is no GPS placing any more —
// a photo's zone is its task's (photos once placed by GPS alone are no longer listed).
// Since 0170 (console 0.7.166, owner: "the zones to select, to generate 5 reports") the unit's zones sit at
// the top: a chosen zone turns the page into that zone's report — its pressure, cases, crops, and each date
// with that zone's traps and photos only (scouting_dates.zone_counts). Remembered per unit.
// Since 0171 (console 0.7.167, owner: "split zone 4 in 4.1 and 4.2 report") the chips are report units: a zone,
// or each table of a zone reported by table (FarmLab Zone 4.1 and 4.2) — pest_overview.pressure_units,
// scouting_dates.unit_counts, scouting_day.units. A card or photo of the zone that names no table is in both.
// Since 0180 (console 0.7.174, owner 30 Sept 2026): today's and yesterday's reports open by themselves; each zone of a
// day starts with its Plant health section open — the 30 days' insects a day per trap and the cases' severity
// (zone_health), the zone's trap map as it stands, the plant-health photos — then two tiles, Traps and Growth, that
// open their photos. A zone's report starts with the AI's opinion (edge function zone-opinion, pressed only, kept in
// zone_opinion). There is no Traps page any more: the map of every zone is in the All zones report, a trap's
// window and history open from the report, Traps and limits… and Map size… sit in the page's head (trapKit).
// A scouting done before its day counts on the day it was done (app.work_day).
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn, openFast } from './api.js';
import { loading, el, pageHead, num, cropAvatar, toast, busy, trapCheckPill } from './ui.js';
import { openViewer, tagChips, photoTitle } from './viewer.js';
import { openCase, newCase, useFarm } from './cases.js';
import { trapKit } from './trapmap.js';

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
let tmap = null, kit = null, opinions = [];
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
    ['trap_map', a],
    ['zone_opinions', a],
  ], {
    show: ([o, c, d, cat, tm, op]) => {
      over = o; cases = c; dates = d; catalog = cat; tmap = tm; opinions = op || [];
      kit = tmap ? trapKit({ farm, data: tmap, reload }) : null;
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
  scaleBtn.title = 'The printed card for growth photos: a black-and-white marker with a 5 cm square the phone measures against';
  const setupBtn = el('button', 'btn', 'Traps and limits…');
  setupBtn.title = 'Every trap on the list, add or move one, the watch and over limits';
  setupBtn.onclick = () => kit?.openSetup();
  const sizeBtn = el('button', 'btn', 'Map size…');
  sizeBtn.title = 'How the trap map draws a zone';
  sizeBtn.onclick = () => kit?.openSize();
  mount.append(pageHead('Pest & diseases',
    'The daily scouting by date, zone by zone: plant health first, with the trap curves and the zone\'s trap map, then the traps and the growth photos. ' +
    'A dot says the worst thing inside: red severe or over the threshold, orange open or on watch, green improving or resolved.',
    scaleBtn, setupBtn, ...(tmap?.may_edit ? [sizeBtn] : []), openBtn));

  if (zoneFilter && !cur()) zoneFilter = null;   // a zone gone, or Zone 4 now reported as 4.1 and 4.2
  mount.append(zoneBar());
  if (zoneFilter) mount.append(opinionCard(), zoneReport());
  else mount.append(dashboard(), mapSection());
  mount.append(caseStrip());
  mount.append(cropBar());

  const list = el('div', 'pd-days');
  const shown = dates.filter(d => !cropFilter || (d.photo_crops || {})[cropFilter] || d.traps);
  if (zoneFilter) list.append(el('div', 'pd-zone-head', `${zoneName(zoneFilter)} — the scouting report by date`));
  if (!shown.length) list.append(el('div', 'empty', 'No scouting report yet. The phone makes one every working day.'));
  // today's and yesterday's reports open by themselves (0.7.174); with neither, the latest
  const today = String(over.today), yday = ymd(new Date(parse(today).getTime() - 864e5));
  const opens = d => d.day === today || d.day === yday, any = shown.some(opens);
  shown.forEach((d, i) => list.append(dayRow(d, opens(d) || (!any && i === 0))));
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
  // how many zones were scouted (0.7.170, owner): green all, orange some, red none — the photos and traps are inside
  if (t) {
    // a zone task is scouted when done; a day scouted as one task (before 0172) never ticked its zones — there a zone
    // counts as scouted when it has a trap read or a photo that day (owner: "today scouting is 1/5 not 5/5")
    const withData = Object.values(d.unit_counts || {}).filter(c => (c.photos || 0) + (c.traps || 0) > 0).length;
    const total = t.zones || 1, done = Math.min(total, t.per_zone ? (t.zones_done || 0) : Math.max(t.zones_done || 0, withData));
    const pill = el('span', 'pill ' + (done >= total ? 'ok' : done > 0 ? 'warn' : 'bad'), `${done}/${total} scouted`);
    pill.title = [t.workers?.length ? t.workers.join(', ') : null, t.done_at ? 'last at ' + hhmm(t.done_at) : null].filter(Boolean).join(' · ');
    facts.append(pill);
  }
  // each section's result on the line itself (0174, owner: "more compact: the OK is not needed") — the unit's, so not in a zone's report
  const so = !zoneFilter && d.summary?.section_outcomes;
  if (so) [['trap', 'Traps'], ['health', 'Plant health'], ['growth', 'Growth']].forEach(([k, label]) => {
    const v = so[k]; if (!v) return;
    const pill = el('span', 'pill ' + (v.outcome === 'ok' ? 'ok' : 'bad'), `${v.outcome === 'ok' ? '✓' : '✕'} ${label}`);
    if (v.note) pill.title = v.note;
    facts.append(pill);
  });
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
    // only a Not OK says anything here, in one line: its why (0174; the sections are on the date's line)
    const tk = day.task;
    const why = tk?.outcome === 'nok' ? (tk.outcome_note || '') : (!zoneFilter && d.summary?.outcome === 'nok' ? (d.summary.notes || '') : null);
    if (why != null) body.append(el('div', 'note bad sc-outcome', 'Not OK' + (why ? ' — ' + why : '') +
      (tk?.edited_at ? ` · changed ${shortDay(tk.edited_at)} ${hhmm(tk.edited_at)}` : '')));
    const zones = (day.units || day.zones || []).filter(z => (!zoneFilter || (z.unit_id || z.zone_id) === zoneFilter)
      && (!cropFilter || (z.crops || []).some(c => c.id === cropFilter) || z.photos.some(p => p.crop_id === cropFilter)));
    // a zone with nothing in it that day is one word, not a band
    const has = z => z.traps.length || z.photos.length || (z.cases || []).length || z.item?.task?.status === 'done';
    const full = zones.filter(has), empty = zones.filter(z => !has(z));
    if (zoneFilter && !full.length) body.append(el('div', 'hint', `Nothing photographed or counted in ${zoneName(zoneFilter)} that day.`));
    else if (!full.length) body.append(el('div', 'hint', cropFilter ? 'No zone with this crop.' : 'Nothing photographed that day.'));
    full.forEach(z => { const b = zoneBand(z, day); if (zoneFilter) b.open = true; body.append(b); });
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
  const zt = z.item?.task;                  // the zone's own task (0172)
  if (zt) {
    if (zt.outcome) right.append(el('span', 'pill ' + (zt.outcome === 'nok' ? 'bad' : 'ok'), zt.outcome === 'nok' ? 'Not OK' : 'OK'));
    right.append(el('span', 'hint', zt.status === 'done'
      ? [zt.workers?.length ? zt.workers.join(', ') : null, zt.done_at ? hhmm(zt.done_at) : null].filter(Boolean).join(' · ') || 'done'
      : zt.status === 'skipped' ? 'cancelled' : 'not done'));
  } else if (z.item?.done_at) right.append(el('span', 'hint', hhmm(z.item.done_at)));
  else if (z.item && day.task?.status !== 'done') right.append(el('span', 'hint', 'not done'));   // a day scouted as one task never ticked its zones
  sum.append(right);
  det.append(sum);

  const body = el('div', 'pd-zone-body');
  if (zt?.outcome_note) body.append(el('div', 'note ' + (zt.outcome === 'nok' ? 'bad' : 'ok') + ' sc-outcome', zt.outcome_note));
  if (zt?.section_outcomes && Object.keys(zt.section_outcomes).length) {
    const row = el('div', 'sc-verdicts');
    [['trap', 'Traps'], ['health', 'Plant health'], ['growth', 'Growth']].forEach(([k, label]) => {
      const v = zt.section_outcomes[k]; if (!v) return;
      const pill = el('span', 'pill ' + (v.outcome === 'ok' ? 'ok' : 'bad'), `${v.outcome === 'ok' ? '✓' : '✕'} ${label}`);
      if (v.note) pill.title = v.note;
      row.append(pill);
    });
    body.append(row);
  }
  const shared = [...traps, ...photos].filter(p => p.shared).length;
  if (shared) body.append(el('div', 'hint pd-shared', `${shared} of these name ${z.zone_name || 'the zone'} without its table, so they are in each of its reports.`));
  // plant health first, open: the curves, the zone's map, its photos; then Traps and Growth as tiles (0.7.174)
  const hs = healthSection(z, day, photos.filter(p => p.section !== 'growth'));
  const tp = tilesAndPanels(z, day, traps, photos.filter(p => p.section === 'growth'));
  hs.onData = h => tp.setDay(h);      // the Traps tile says the curve's figure for the day
  body.append(hs, tp);
  if (det.open) hs.load();
  det.addEventListener('toggle', () => { if (det.open) hs.load(); });
  if (!traps.length && !photos.length) body.append(el('div', 'hint', z.item?.done_at || zt?.status === 'done' ? 'Nothing photographed, traps not counted.' : 'Not scouted that day.'));
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
  const chk = trapCheckPill(p.check, p.total);
  if (chk) card.append(chk);
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
  const where = p.pos_code || null;
  const sizes = (p.measures || []).map(m => `${MEASURE_WORD[m.what] || m.what} ${num(m.mm, 0)} mm`).join(' · ');
  const line = el('div', 'sc-where');
  if (p.section) line.append(el('span', 'pill ' + (p.section === 'growth' ? 'ok' : ''), p.section === 'growth' ? 'Growth' : 'Plant health'));
  if (where) line.append(el('span', 'mono', where));
  if (sizes) line.append(el('b', null, sizes));
  if (line.children.length) cap.append(line);
  const st = p.ai_status === 'done' ? 'AI read' : p.ai_status === 'queued' ? 'AI asked' : p.ai_status === 'failed' ? 'AI failed' : null;
  cap.append(el('div', 'hint', [hhmm(p.taken_at), p.note, st].filter(Boolean).join(' · ')));
  if (p.ai?.summary) cap.append(el('div', 'sc-ai-line', '✦ ' + p.ai.summary));
  fig.append(cap);
  fig.onclick = () => openViewer(viewerCtx(p, z, day));
  return fig;
}

// ── the AI's opinion on the chosen zone, at the top of its report (0180) ──
const STATUS = { ok: ['ok', 'OK'], watch: ['warn', 'Watch'], act: ['bad', 'Act now'] };
const TREND_AI = { better: ['ok', '▼ getting better'], stable: ['', '– stable'], worse: ['bad', '▲ getting worse'], unclear: ['', '? trend unclear'] };
function opinionCard() {
  const u = cur();
  const card = el('div', 'card card-pad pd-ai');
  if (!u) return card;
  const op = (opinions || []).find(o => o.unit_id === u.unit_id);
  const head = el('div', 'pd-ai-head');
  const ask = el('button', 'btn btn-sm' + (op ? '' : ' btn-primary'), op ? '✦ Ask again' : '✦ Ask the AI');
  ask.title = `Sends what was recorded in ${u.zone} over the last 30 days — the counts, the notes, the cases and the AI notes, no photo — for an opinion on the situation and the trend`;
  ask.onclick = async () => {
    busy(ask, true, 'The AI is reading 30 days…');
    try {
      const r = await fn('zone-opinion', { farm_id: farm.id, zone_id: u.zone_id, system_id: u.system_id || null, force: true });
      if (!r?.ok) throw new Error(r?.error || 'no answer');
      opinions = await rpc('zone_opinions', { p_farm: farm.id });
      paint();
    } catch (e) { busy(ask, false, op ? '✦ Ask again' : '✦ Ask the AI'); toast('AI opinion: ' + String(e.message || e).replace(/^\d+ /, '').slice(0, 160), 'bad'); }
  };
  head.append(el('b', null, '✦ AI opinion'), el('span', 'hint', `${u.zone} · the last 30 days`), el('span', 'spacer'), ask);
  card.append(head);
  if (!op) {
    card.append(el('div', 'hint', 'Nothing asked yet for this zone. The AI reads the traps, the photos\' tags and AI notes, the cases and treatments and the scouting notes of 30 days, and says how things stand and where they are going. It proposes; you decide.'));
    return card;
  }
  const line = el('div', 'pd-ai-line');
  const [sc, sw] = STATUS[op.status] || ['', op.status];
  const [tc, tw] = TREND_AI[op.trend] || ['', op.trend];
  line.append(el('span', 'pill ' + sc, sw), el('span', 'pill ' + tc, tw), el('b', null, op.headline));
  card.append(line);
  if ((op.points || []).length) {
    const ul = el('ul', 'pd-ai-points');
    op.points.forEach(p => { const li = el('li'); li.append(el('span', null, p.text || String(p))); if (p.basis) li.append(el('div', 'hint', p.basis)); ul.append(li); });
    card.append(ul);
  }
  if ((op.next_checks || []).length) {
    card.append(el('div', 'pd-hlabel', 'Next'));
    const ol = el('ol', 'pd-ai-next');
    op.next_checks.forEach(t => ol.append(el('li', null, t)));
    card.append(ol);
  }
  if ((op.missing || []).length) {
    const d = el('details', 'pd-ai-missing');
    const sm = el('summary', null, `What was missing (${op.missing.length})`);
    const ul = el('ul');
    op.missing.forEach(t => ul.append(el('li', null, t)));
    d.append(sm, ul);
    card.append(d);
  }
  const st = op.stats || {};
  const read = [st.trap_readings ? `${st.trap_readings} trap readings` : null, st.plant_health ? `${st.plant_health} health photos` : null,
                st.growth ? `${st.growth} growth photos` : null, st.cases ? `${st.cases} cases` : null].filter(Boolean).join(', ');
  const asked = new Date(op.created_at);
  const foot = [`Asked ${asked.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hhmm(op.created_at)}`, op.by,
                op.confidence != null ? `confidence ${Math.round(op.confidence * 100)} %` : null, read ? 'read ' + read : null,
                op.previous ? `before: ${(STATUS[op.previous.status] || [, op.previous.status])[1]} on ${shortDay(op.previous.day)}` : null].filter(Boolean).join(' · ');
  card.append(el('div', 'hint pd-ai-foot', foot + ' · The AI proposes; you decide.'));
  if (String(op.day) < String(over.today)) card.append(el('div', 'hint', 'This opinion is from an earlier day — ask again for today.'));
  return card;
}

// ── the All zones report: every zone's trap map, then every trap ──
function mapSection() {
  const det = el('details', 'pd-mapsec');
  if (!tmap || !kit) return det;
  det.open = true;
  const sum = el('summary');
  sum.append(el('b', null, 'Trap map'), el('span', 'hint', 'every zone, this week — an area is its worst trap, in new insects a day'));
  det.append(sum);
  const body = el('div', 'pd-mapsec-body');
  body.append(kit.legend());
  const spots = tmap.spots || [];
  if (!spots.length) body.append(el('div', 'hint', 'No trap yet: each is added from the position written on its card at the first scouting.'));
  const maps = el('div', 'tm-maps');
  (tmap.units || []).forEach(u => maps.append(kit.unitMap(u, spots.filter(s => s.n === u.n))));
  body.append(maps);
  if (spots.length) {
    const every = el('details', 'pd-every');
    every.append(el('summary', null, `Every trap (${spots.filter(s => s.active).length}), worst first`));
    every.addEventListener('toggle', () => { if (every.open && every.children.length === 1) every.append(kit.trapList(spots)); });
    body.append(every);
  }
  det.append(body);
  return det;
}

// ── a zone's plant health: the curves, its trap map, its photos (0.7.174) ──
function healthSection(z, day, health) {
  const sec = el('details', 'pd-sec pd-health');
  sec.open = true;
  const sum = el('summary');
  sum.append(el('b', null, 'Plant health'), el('span', 'hint', health.length ? `${health.length} photo${health.length === 1 ? '' : 's'}` : 'no photo that day'));
  const inner = el('div', 'pd-sec-body');
  const charts = el('div', 'pd-hcharts');
  const curves = el('div', 'pd-hcurve');
  curves.append(el('div', 'hint', 'Reading the curves…'));
  charts.append(curves);
  const mu = (tmap?.units || []).find(u => u.n === z.zone_number);
  if (mu && kit) {
    const box = el('div', 'pd-hmap');
    const m = kit.unitMap(mu, (tmap.spots || []).filter(s => s.n === mu.n));
    m.classList.add('tm-mini');
    box.append(el('div', 'pd-hlabel', 'Traps now'), m);
    charts.append(box);
  }
  inner.append(charts);
  if (health.length) {
    const grid = el('div', 'sc-grid');
    health.forEach(p => grid.append(photoFig(p, z, day)));
    inner.append(grid);
  }
  sec.append(sum, inner);
  sec.load = async () => {
    if (sec.dataset.loaded) return;
    sec.dataset.loaded = '1';
    try {
      const h = await rpc('zone_health', { p_farm: farm.id, p_zone: z.zone_id, p_system: z.system_id || null, p_day: day.day });
      curves.textContent = '';
      curves.append(curveChart(h));
      sec.onData?.(h);
    } catch (e) { curves.textContent = ''; curves.append(el('div', 'note bad', e.message)); delete sec.dataset.loaded; }
  };
  return sec;
}

// 30 days of insects a day, a line a trap, the watch and over lines; the cases' severity underneath
const PALETTE = ['#e07a5f', '#5b9bd5', '#6fbf73', '#c38fdc', '#e2b34a', '#4fc1c1', '#d2708e', '#9aa66b'];
const SEV = ['#8a8f98', '#e2b34a', '#e0873a', '#d64545'];
function curveChart(h) {
  const box = el('div', 'pd-curvebox');
  const th = h.threshold || {};
  const traps = (h.traps || []).filter(t => (t.points || []).some(p => p.rate != null));
  box.append(el('div', 'pd-hlabel', 'Insects a day per trap · 30 days'));
  if (!traps.length && !(h.cases || []).length) { box.append(el('div', 'hint', 'No trap rate and no case in the last 30 days.')); return box; }
  const W = 360, H = 118, L = 24, R = 6, T = 6, B = 16;
  const d0 = parse(h.from).getTime(), d1 = parse(h.day).getTime(), span = Math.max(1, d1 - d0);
  const x = d => L + (parse(d).getTime() - d0) * (W - L - R) / span;
  const rates = traps.flatMap(t => t.points.map(p => Number(p.rate) || 0));
  const max = Math.max(1, (th.over || 0) * 1.2, ...rates);
  const y = v => H - B - v * (H - T - B) / max;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-curve'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Insects a day per trap, ${shortDay(h.from)} to ${shortDay(h.day)}`);
  const mk = (tag, at) => { const n = document.createElementNS(SVG_NS, tag); Object.entries(at).forEach(([k, v]) => n.setAttribute(k, v)); svg.append(n); return n; };
  mk('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'pd-axis' });
  [['watch', th.watch], ['over', th.over]].forEach(([w, v]) => {
    if (v == null || v > max) return;
    mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'pd-th ' + w });
    const t = mk('text', { x: 2, y: y(v) + 3, class: 'pd-th-t' }); t.textContent = `${w} ${num(v, 1)}`;
  });
  [h.from, ymd(new Date(d0 + span / 2)), h.day].forEach((d, i) => {
    const t = mk('text', { x: x(d), y: H - 3, class: 'pd-ax-t', 'text-anchor': ['start', 'middle', 'end'][i] }); t.textContent = shortDay(d);
  });
  const legend = el('div', 'pd-curve-legend');
  traps.forEach((t, i) => {
    const c = PALETTE[i % PALETTE.length];
    const pts = t.points.filter(p => p.rate != null);
    if (pts.length > 1) mk('polyline', { points: pts.map(p => `${x(p.day).toFixed(1)},${y(Number(p.rate)).toFixed(1)}`).join(' '), stroke: c, class: 'pd-line' });
    pts.forEach(p => {
      const dot = mk('circle', { cx: x(p.day), cy: y(Number(p.rate)), r: 2.4, fill: c });
      const tt = document.createElementNS(SVG_NS, 'title'); tt.textContent = `${t.code} · ${shortDay(p.day)}: ${num(p.rate, 1)} a day · ${p.total} on the card`; dot.append(tt);
    });
    const k = el('span', 'pd-key'); const sw = el('i'); sw.style.background = c; k.append(sw, el('span', null, t.code)); legend.append(k);
  });
  box.append(svg);
  if (traps.length) box.append(legend);
  (h.cases || []).forEach(k => {
    const row = el('div', 'pd-hcase');
    const lab = el('button', 'linkish', k.label + (k.status === 'closed' ? ' (closed)' : ''));
    lab.onclick = () => openCase(k.id, reload, farm);
    const strip = document.createElementNS(SVG_NS, 'svg');
    strip.setAttribute('viewBox', `0 0 ${W} 12`); strip.setAttribute('class', 'pd-sevstrip');
    (k.points || []).forEach(p => {
      if (!p.day || parse(p.day).getTime() < d0) return;
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', x(p.day)); c.setAttribute('cy', 6); c.setAttribute('r', 3 + Number(p.severity || 0));
      c.setAttribute('fill', SEV[Math.max(0, Math.min(3, Number(p.severity) || 0))]);
      const tt = document.createElementNS(SVG_NS, 'title'); tt.textContent = `${k.label} · ${shortDay(p.day)}: severity ${p.severity}`; c.append(tt);
      strip.append(c);
    });
    row.append(dotEl(k.dot), lab, strip);
    box.append(row);
  });
  return box;
}

// ── Traps and Growth: a tile each, its photos behind it (0.7.174) ──
function tilesAndPanels(z, day, traps, growth) {
  const wrap = el('div', 'pd-tp');
  const row = el('div', 'pd-dtiles');
  const panels = el('div', 'pd-dpanels');
  const tile = (title, big, small, warn, dot, panel) => {
    const b = el('button', 'pd-dtile' + (panel ? '' : ' empty'));
    b.type = 'button';
    const t = el('div', 'pd-dtile-t'); t.append(dotEl(dot), el('b', null, title));
    const sm = el('div', 'hint', small);
    b.append(t, el('div', 'pd-dtile-big', big), sm);
    b._small = sm;
    if (warn) b.append(el('span', 'pill warn', warn));
    b.setAttribute('aria-expanded', 'false');
    if (panel) {
      panel.hidden = true;
      b.onclick = () => { panel.hidden = !panel.hidden; b.setAttribute('aria-expanded', String(!panel.hidden)); b.classList.toggle('on', !panel.hidden); };
      panels.append(panel);
    } else b.disabled = true;
    row.append(b);
    return b;
  };
  // traps: how many, insects a day per trap that day, the ones to look at again
  const codes = [...new Set(traps.map(p => p.code))];
  // each side's latest photo with a rate that day, the two sides added: a card photographed twice counts once
  const lastBySide = new Map();
  traps.filter(p => p.day_rate != null).forEach(p => {
    const k = p.code + '|' + (p.side || '');
    if (!lastBySide.has(k) || String(p.taken_at) > String(lastBySide.get(k).taken_at)) lastBySide.set(k, p);
  });
  const perCode = new Map(); [...lastBySide.values()].forEach(p => perCode.set(p.code, (perCode.get(p.code) || 0) + Number(p.day_rate)));
  const perTrap = perCode.size ? [...perCode.values()].reduce((a, v) => a + v, 0) / perCode.size : null;
  const toCheck = traps.filter(p => ['fewer', 'auto_new', 'excluded'].includes(p.check?.state)).length;
  let tp = null;
  if (traps.length) {
    tp = el('div', 'pd-dpanel');
    tp.append(el('div', 'pd-hlabel', 'Traps'));
    const cards = el('div', 'pd-traps');
    traps.forEach(p => cards.append(trapCard(p, z, day)));
    tp.append(cards);
    if (kit) {
      const hist = el('div', 'pd-hist');
      hist.append(el('span', 'hint', 'History:'));
      codes.forEach(c => { const s = kit.spotOf(c); if (!s) return; const b = el('button', 'pd-cropchip', c); b.onclick = () => kit.openSpots(`${z.name} · trap ${c}`, [s]); hist.append(b); });
      if (hist.children.length > 1) tp.append(hist);
    }
  }
  const trapTile = tile('Traps', traps.length ? `${codes.length} trap${codes.length === 1 ? '' : 's'} · ${traps.length} photo${traps.length === 1 ? '' : 's'}` : 'none read',
       perTrap != null ? `${num(perTrap, perTrap >= 10 ? 0 : 1)} insects a trap a day` : traps.length ? 'the count starts' : (z.item?.done_at || z.item?.task?.status === 'done' ? 'not counted' : ''),
       toCheck ? `${toCheck} to look at again` : null, worst(traps.map(p => p.dot)), tp);
  // growth: the photos and the sizes measured
  let gp = null;
  const sized = growth.find(p => (p.measures || []).length);
  const sizes = sized ? sized.measures.map(m => `${MEASURE_WORD[m.what] || m.what} ${num(m.mm, 0)}`).join(' · ') + ' mm' : '';
  if (growth.length) {
    gp = el('div', 'pd-dpanel');
    gp.append(el('div', 'pd-hlabel', 'Growth'));
    const grid = el('div', 'sc-grid');
    growth.forEach(p => grid.append(photoFig(p, z, day)));
    gp.append(grid);
  }
  tile('Growth', growth.length ? `${growth.length} photo${growth.length === 1 ? '' : 's'}` : 'none', sizes || (growth.length ? 'no size measured' : ''),
       null, worst(growth.map(p => p.dot)), gp);
  // once the curves are read: the day's insects a trap a day, each side's new insects over its time (zone_health, 0181)
  wrap.setDay = h => {
    const pts = (h?.traps || []).map(t => (t.points || []).find(p => p.day === String(day.day).slice(0, 10) && p.rate != null)).filter(Boolean);
    if (!pts.length || !trapTile?._small) return;
    const v = pts.reduce((a, p) => a + Number(p.rate), 0) / pts.length;
    trapTile._small.textContent = `${num(v, v >= 10 ? 0 : 1)} insects a trap a day`;
    trapTile._small.title = `Each side's new insects of the day over the time since its photo before, the two sides added; the average of ${pts.length} trap${pts.length === 1 ? '' : 's'}`;
  };
  wrap.append(row, panels);
  return wrap;
}
