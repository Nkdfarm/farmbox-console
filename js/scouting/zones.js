// Scouting page: the zone bar, the zone report and the dashboard
import { el, num, cropAvatar, shortDay } from '../ui.js';
import { openFound, pressureLine } from './found.js';
import { paint } from './paint.js';
import { S, cropInZone, cur, dotEl, inUnit, longDay, worst, zoneKey, zones } from './state.js';

// ── the zones, at the top: one report each (0170) ──
export function zoneBar() {
  const box = el('div', 'pd-zones');
  box.append(el('span', 'pd-strip-label', 'Report for'));
  const pick = id => {
    S.zoneFilter = S.zoneFilter === id ? null : id;
    try { S.zoneFilter ? localStorage.setItem(zoneKey(), S.zoneFilter) : localStorage.removeItem(zoneKey()); } catch (e) { /* this device only */ }
    S.cropFilter = null;
    paint();
  };
  const all = el('button', 'pd-zonechip' + (!S.zoneFilter ? ' on' : ''), 'All zones');
  all.setAttribute('aria-pressed', String(!S.zoneFilter));
  all.onclick = () => pick(null);
  box.append(all);
  zones().forEach(z => {
    const b = el('button', 'pd-zonechip' + (S.zoneFilter === z.unit_id ? ' on' : ''));
    b.setAttribute('aria-pressed', String(S.zoneFilter === z.unit_id));
    const d = worst((S.cases.cases || []).filter(k => inUnit(z, k.zone_id, k.system_id) && k.status !== 'closed').map(k => k.dot));
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
export function zoneReport() {
  const z = cur() || {};
  const box = el('div', 'pd-dash');
  const tiles = el('div', 'pd-tiles');
  const tile = (n, label, cls) => { const t = el('div', 'pd-tile' + (cls ? ' ' + cls : '')); t.append(el('b', null, String(n ?? 0)), el('span', null, label)); tiles.append(t); };
  const open = (S.cases.cases || []).filter(k => inUnit(z, k.zone_id, k.system_id) && k.status !== 'closed');
  const trend = z.now != null && z.before != null ? (z.now > z.before ? ' ▲' : z.now < z.before ? ' ▼' : '') : '';
  tile(z.now != null ? num(z.now, 1) + trend : '—', 'insects/trap/day this week', z.now != null && S.over.threshold?.over != null && z.now >= S.over.threshold.over ? 'bad'
    : z.now != null && S.over.threshold?.watch != null && z.now >= S.over.threshold.watch ? 'warn' : '');
  tile(z.before != null ? num(z.before, 1) : '—', 'last week');
  tile(open.length, open.length === 1 ? 'case open' : 'cases open', open.length ? 'warn' : '');
  tile(open.filter(k => k.status === 'in_progress').length, 'treatments running');
  tile(z.last_read ? shortDay(z.last_read) : '—', 'traps last read');
  box.append(tiles);
  const crops = (S.over.crops || []).filter(cropInZone);
  if (crops.length) {
    const row = el('div', 'pd-zone-crops');
    row.append(el('span', 'hint', 'Standing here'));
    crops.forEach(c => { const x = el('span', 'pd-zone-crop'); x.append(cropAvatar({ name: c.name, category: c.category, photo_url: c.photo_url }, 'sm'), el('span', null, c.name)); row.append(x); });
    box.append(row);
  }
  const today = String(S.over.today);
  crops.filter(x => x.harvest_after && x.harvest_after > today).forEach(x =>
    box.append(el('div', 'note warn pd-wait-note', `Do not harvest ${x.name} here before ${longDay(x.harvest_after)} — a treatment's withholding period.`)));
  return box;
}

// ── the dashboard ──
export function dashboard() {
  const box = el('div', 'pd-dash');
  const c = S.over.counts || {};
  const tiles = el('div', 'pd-tiles');
  const tile = (n, label, cls) => {
    const t = el('div', 'pd-tile' + (cls ? ' ' + cls : ''));
    t.append(el('b', null, String(n ?? 0)), el('span', null, label));
    tiles.append(t);
    return t;
  };
  tile(c.diseases, 'diseases open', c.diseases ? 'bad' : '');
  tile(c.pests, 'pests open', c.pests ? 'warn' : '');
  tile(c.programs, 'treatments running');
  tile(c.traps_over, `trap${c.traps_over === 1 ? '' : 's'} over ${S.over.threshold?.over ?? ''}`.trim(), c.traps_over ? 'bad' : '');
  // 0194: what the AI named on a photo nobody has tagged, put in a case or marked seen — the list is behind the tile
  if (c.ai_found != null) {
    const t = tile(c.ai_found, c.ai_found === 1 ? 'photo: the AI found something' : 'photos: the AI found something', c.ai_found ? 'warn' : '');
    if (c.ai_found) {
      t.classList.add('pd-tile-btn'); t.setAttribute('role', 'button'); t.tabIndex = 0;
      t.title = 'Open the list';
      t.onclick = openFound;
      t.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFound(); } };
    }
  }
  tile(c.to_review, 'health photos not read yet', c.to_review ? 'warn' : '');
  tile(`${c.scouted_days ?? 0}/${c.scouting_days ?? 0}`, 'days scouted this week');
  box.append(tiles);

  // the pressure, twelve weeks, as a small line
  const pw = S.over.pressure_weeks || [];
  const pr = el('div', 'pd-pressure');
  const now = pw.find(w => String(w.week).slice(0, 10) === String(S.over.week).slice(0, 10));
  pr.append(el('span', 'hint', 'Insect pressure'), el('b', null, now ? `${num(now.rate, 1)}` : '—'), el('span', 'hint', 'insects/trap/day this week'));
  pr.append(pressureLine(pw, S.over.week));
  box.append(pr);

  const today = String(S.over.today);
  (S.over.crops || []).filter(x => x.harvest_after && x.harvest_after > today).forEach(x => {
    const zones = (x.zones || []).map(z => z.name).join(', ');
    box.append(el('div', 'note warn pd-wait-note', `Do not harvest ${x.name}${zones ? ' in ' + zones : ''} before ${longDay(x.harvest_after)} — a treatment's withholding period.`));
  });
  return box;
}
