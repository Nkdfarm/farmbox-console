// ═══════════════════════════════════════════════════════════════════════════
// Pest & diseases › Overview (migration 0098)
//
// The whole picture on one page: what is open (diseases, pests, disorders),
// the treatments running and the crops waiting out a withholding period, the
// traps over the threshold and the photos nobody has looked at; the insect
// pressure; and every crop standing, grouped by type, with its picture, its
// open cases and its latest photo.
//
// Insect pressure is insects per trap per day: what is new on a card since
// the previous reading, over the days in between — a weekend or a holiday
// between two readings weighs as the days it lasted, not as one step.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, pageHead, drawer, num, cropAvatar, toast } from './ui.js';
import { openViewer, tagChips, photoTitle, partLabel } from './viewer.js';
import { openCase, newCase } from './cases.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CATS = { fruiting_vines: 'Fruiting vines', fruiting_bush: 'Fruiting bush', leafy: 'Leafy greens', mixed_leafy: 'Mixed leafy',
               herbs: 'Herbs', microgreens: 'Microgreens' };
const KIND_WORD = { pest: 'Pest', disease: 'Disease', disorder: 'Disorder', beneficial: 'Beneficial' };
const day = ts => ts ? new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—';
const longDay = s => new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

let farm = null, data = null, mount = null, catalog = null;

export async function renderPests(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the farm…'));
  try {
    [data, catalog] = await Promise.all([rpc('pest_overview', { p_farm: farm.id }), catalog || rpc('pest_catalog')]);
  } catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const open = el('button', 'btn btn-primary', 'Open a case');
  open.onclick = () => newCase({ onDone: () => load() });
  mount.append(pageHead('Pest & diseases',
    'What is open, what is being treated, how hard the insects are pressing, and each crop with its cases and its latest photo. ' +
    'The daily report is on Scouting; each problem is followed on Cases.', open));

  // ── the tiles ──
  const c = data.counts || {};
  const tiles = el('div', 'tiles ipm-tiles');
  const tile = (n, label, cls, go) => {
    const t = el('div', 'tile' + (cls ? ' ' + cls : ''));
    const body = el('div', 'tile-body');
    body.append(el('div', 'tile-value', String(n ?? 0)), el('div', 'tile-label', label));
    t.append(body);
    if (go) { t.style.cursor = 'pointer'; t.onclick = () => { location.hash = go; }; }
    tiles.append(t);
  };
  tile(c.diseases, 'diseases open', c.diseases ? 'is-bad' : '', '#/ipm/cases');
  tile(c.pests, 'pests open', c.pests ? 'is-warn' : '', '#/ipm/cases');
  tile(c.disorders, 'disorders open', '', '#/ipm/cases');
  tile(c.programs, 'treatments running', '', '#/ipm/cases');
  tile(c.withholding, 'waiting to harvest', c.withholding ? 'is-warn' : '', '#/ipm/cases');
  tile(c.traps_over, `trap${c.traps_over === 1 ? '' : 's'} over ${data.threshold?.over ?? ''}`.trim(), c.traps_over ? 'is-bad' : '', '#/ipm/traps');
  tile(c.to_review, 'photos to look at', c.to_review ? 'is-warn' : '', '#/ipm/scouting');
  tile(`${c.scouted_days ?? 0}/${c.scouting_days ?? 0}`, 'days scouted this week', (c.scouting_days && c.scouted_days < c.scouting_days) ? 'is-warn' : '', '#/ipm/scouting');
  mount.append(tiles);

  // ── the waits before harvest: the one thing nobody may miss ──
  const today = String(data.today);
  (data.crops || []).filter(x => x.harvest_after && x.harvest_after > today).forEach(x => {
    const zones = (x.zones || []).map(z => z.name).join(', ');
    mount.append(el('div', 'note warn', `Do not harvest ${x.name}${zones ? ' in ' + zones : ''} before ${longDay(x.harvest_after)} — a treatment's withholding period.`));
  });

  // ── the insect pressure ──
  const pc = el('div', 'card');
  const ph = el('div', 'row'); ph.style.padding = 'var(--space-3) var(--space-4)';
  ph.append(el('b', null, 'Insect pressure'), el('span', 'hint', ' · insects per trap per day, week by week — the days between two readings count, so a weekend does not look like a jump'));
  pc.append(ph);
  const pw = data.pressure_weeks || [];
  if (!pw.length) pc.append(el('div', 'empty', 'No trap reading in the last twelve weeks. The traps are counted from the daily scouting.'));
  else pc.append(pressureChart(pw, data.week));
  const zones = (data.pressure_zones || []).filter(z => z.now != null || z.before != null || z.cases);
  if (zones.length) {
    const tbl = el('div', 'pd-zones');
    zones.forEach(z => {
      const row = el('div', 'pd-zone');
      const d = z.now != null && z.before != null ? z.now - z.before : null;
      row.append(el('b', null, z.zone),
        el('span', 'pd-rate', z.now != null ? `${num(z.now, 1)} / day` : '—'),
        el('span', 'pd-change ' + (d == null ? '' : d > 0.05 ? 'up' : d < -0.05 ? 'down' : ''),
          d == null ? (z.before != null ? `last week ${num(z.before, 1)}` : 'not read last week') : `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${num(Math.abs(d), 1)} on last week`),
        el('span', 'hint', [z.last_read ? 'read ' + day(z.last_read) : null, z.cases ? `${z.cases} open case${z.cases > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')));
      tbl.append(row);
    });
    pc.append(tbl);
  }
  mount.append(pc);

  // ── the crops, by type ──
  const crops = data.crops || [];
  if (!crops.length) { mount.append(el('div', 'empty', 'No crop standing on this FarmBox.')); return; }
  const byCat = new Map();
  crops.forEach(x => { const k = x.category || 'other'; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(x); });
  byCat.forEach((list, cat) => {
    const openCases = list.reduce((a, x) => a + (x.cases || []).length, 0);
    const head = el('div', 'pd-cat');
    head.append(el('h3', null, CATS[cat] || cat.replace('_', ' ')),
      el('span', 'hint', `${list.length} crop${list.length > 1 ? 's' : ''}${openCases ? ` · ${openCases} open case${openCases > 1 ? 's' : ''}` : ''}`));
    mount.append(head);
    const grid = el('div', 'pd-grid');
    list.forEach(x => grid.append(cropCard(x)));
    mount.append(grid);
  });
}

function cropCard(x) {
  const card = el('div', 'pd-crop' + ((x.cases || []).some(k => k.severity === 'high' || k.severity === 'critical') ? ' bad' : (x.cases || []).length ? ' warn' : ''));
  const head = el('div', 'pd-crop-head');
  head.append(cropAvatar({ name: x.name, category: x.category, photo_url: x.photo_url }, 'lg'));
  const t = el('div');
  t.append(el('b', null, x.name));
  t.append(el('div', 'hint', (x.zones || []).map(z => z.name).join(', ') || 'not standing'));
  t.append(el('div', 'hint', [x.pressure != null ? `${num(x.pressure, 1)} insects/trap/day` : null,
                              x.photos_14d ? `${x.photos_14d} photo${x.photos_14d > 1 ? 's' : ''} in 14 days` : 'no photo in 14 days'].filter(Boolean).join(' · ')));
  head.append(t);
  card.append(head);

  const cs = el('div', 'vw-chips');
  if (!(x.cases || []).length) cs.append(el('span', 'vw-tag beneficial', 'no open case'));
  (x.cases || []).forEach(k => {
    const b = el('button', 'vw-tag ' + (k.kind || ''), `${k.label || k.title}${k.zone ? ' · ' + k.zone : ''} · ${k.status === 'in_progress' ? 'treating' : k.severity}`);
    b.onclick = e => { e.stopPropagation(); openCase(k.id, () => load()); };
    cs.append(b);
  });
  card.append(cs);
  if (x.harvest_after && x.harvest_after > String(data.today)) card.append(el('div', 'pd-wait', `Harvest from ${longDay(x.harvest_after)}`));

  if (x.last_photo?.photo_data) {
    const f = el('div', 'pd-last');
    const im = el('img'); im.src = x.last_photo.photo_data; im.alt = photoTitle(x.last_photo); im.loading = 'lazy';
    const cap = el('div');
    cap.append(el('div', 'hint', `latest · ${day(x.last_photo.taken_at)} · ${partLabel(x.last_photo.part)}`), tagChips(x.last_photo));
    f.append(im, cap);
    f.onclick = e => { e.stopPropagation(); viewPhoto(x.last_photo); };
    card.append(f);
  }
  card.onclick = () => openCrop(x);
  return card;
}

function viewPhoto(p) {
  openViewer({ farm, photo: p, catalog: catalog || [], mayWrite: true,
    zonePhotos: p.zone_id ? () => rpc('zone_photos', { p_farm: farm.id, p_zone: p.zone_id }) : null,
    zoneId: p.zone_id, cropId: p.crop_id,
    openCases: async () => ((await rpc('cases', { p_farm: farm.id, p_include_closed: false })).cases || []).filter(c => !p.zone_id || c.zone_id === p.zone_id),
    onChange: () => load() });
}

// one crop: its cases (open, and closed in six months) and its photos (60 days)
async function openCrop(x) {
  const d = drawer(x.name, (x.zones || []).map(z => z.name).join(', ') || CATS[x.category] || '');
  d.box.style.width = 'min(860px, 100vw)';
  d.body.append(el('div', 'hint', 'Reading…'));
  let r;
  try { r = await rpc('crop_pests', { p_farm: farm.id, p_crop: x.id }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
  d.body.textContent = '';
  const head = el('div', 'pd-crop-head');
  head.append(cropAvatar({ name: x.name, category: x.category, photo_url: x.photo_url }, 'lg'));
  head.append(el('div', 'hint', `${CATS[x.category] || x.category}` + (x.pressure != null ? ` · ${num(x.pressure, 1)} insects per trap per day in its zones this week` : '')));
  d.body.append(head);
  if (x.harvest_after && x.harvest_after > String(data.today)) d.body.append(el('div', 'note warn', `Do not harvest before ${longDay(x.harvest_after)} — a treatment's withholding period.`));

  d.body.append(el('div', 'sec-title', 'Cases'));
  if (!r.cases.length) d.body.append(el('div', 'hint', 'No case on this crop in the last six months.'));
  r.cases.forEach(k => {
    const row = el('button', 'pd-case-row');
    row.append(el('span', 'vw-tag ' + (k.kind || ''), KIND_WORD[k.kind] || ''), el('b', null, k.label || k.title),
      el('span', 'hint', [k.zone, `opened ${day(k.opened)}`, k.status === 'closed' ? `closed ${day(k.closed_at)} · ${String(k.outcome || '').replace('_', ' ')}` : (k.status === 'in_progress' ? 'treating' : k.severity)].filter(Boolean).join(' · ')));
    row.onclick = () => openCase(k.id, () => load());
    d.body.append(row);
  });
  const nc = el('button', 'btn btn-sm', 'Open a case on this crop…');
  nc.onclick = () => newCase({ crop_id: x.id, onDone: () => { d.close(); load(); } });
  d.body.append(nc);

  d.body.append(el('div', 'sec-title', `Photos · last 60 days · ${r.photos.length}`));
  if (!r.photos.length) d.body.append(el('div', 'hint', 'No photo of this crop in the last 60 days.'));
  else {
    const grid = el('div', 'sc-grid');
    r.photos.forEach(p => {
      const fig = el('figure', 'sc-fig');
      const im = el('img'); im.src = p.photo_data || ''; im.alt = photoTitle(p); im.loading = 'lazy';
      const cap = el('figcaption');
      cap.append(el('b', null, `${day(p.taken_at)} · ${partLabel(p.part)}`), el('div', 'hint', p.zone || ''), tagChips(p));
      fig.append(im, cap);
      fig.onclick = () => viewPhoto(p);
      grid.append(fig);
    });
    d.body.append(grid);
  }
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close);
}

// twelve weeks of pressure as bars, this week marked
function pressureChart(weeks, thisWeek) {
  const W = 880, H = 170, L = 36, R = 12, T = 14, B = 26;
  // every week of the twelve, even those without a reading, so the axis is time
  const last = new Date(String(thisWeek) + 'T12:00:00');
  const all = [];
  for (let k = 11; k >= 0; k--) { const d = new Date(last); d.setDate(d.getDate() - 7 * k); all.push(d.toISOString().slice(0, 10)); }
  const byWeek = new Map(weeks.map(w => [String(w.week).slice(0, 10), w]));
  const max = Math.max(1, ...weeks.map(w => Number(w.rate) || 0));
  const bw = (W - L - R) / all.length;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-chart'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Insects per trap per day, week by week');
  const mk = (tag, a, text) => { const n = document.createElementNS(SVG_NS, tag); Object.entries(a).forEach(([k, v]) => n.setAttribute(k, v)); if (text != null) n.textContent = text; svg.append(n); return n; };
  [0, max / 2, max].forEach(v => {
    const y = H - B - v * (H - B - T) / max;
    mk('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'cc-grid' });
    mk('text', { x: L - 6, y: y + 4, class: 'cc-label', 'text-anchor': 'end' }, num(v, 1));
  });
  all.forEach((wk, i) => {
    const w = byWeek.get(wk);
    const x = L + i * bw;
    if (w) {
      const h = (Number(w.rate) || 0) * (H - B - T) / max;
      const r = mk('rect', { x: x + bw * 0.18, y: H - B - h, width: bw * 0.64, height: Math.max(1, h), rx: 3, class: 'pd-bar' + (wk === String(thisWeek).slice(0, 10) ? ' now' : '') });
      const tt = document.createElementNS(SVG_NS, 'title'); tt.textContent = `Week of ${day(wk)}: ${num(w.rate, 2)} insects/trap/day · ${w.readings} readings on ${w.traps} traps`; r.append(tt);
      mk('text', { x: x + bw / 2, y: H - B - h - 4, class: 'cc-label', 'text-anchor': 'middle' }, num(w.rate, 1));
    } else {
      mk('text', { x: x + bw / 2, y: H - B - 4, class: 'cc-label', 'text-anchor': 'middle' }, '·');
    }
    if (i % 2 === 0 || i === all.length - 1) mk('text', { x: x + bw / 2, y: H - B + 16, class: 'cc-label', 'text-anchor': 'middle' }, day(wk));
  });
  const wrap = el('div', 'case-chart-wrap'); wrap.style.padding = '0 var(--space-4) var(--space-3)';
  wrap.append(svg);
  return wrap;
}
