// ═══════════════════════════════════════════════════════════════════════════
// Pest & diseases › Scouting — the day's report, zone by zone (migration 0096)
//
// Every working day the phone's scouting task walks the zones: the sticky
// traps (counted, or skipped for the day) and photos of anything unusual on
// the plants, each with its crop and the part it shows. This page is that
// report for one day: one collapsible band per zone with its photos, its
// counts, its tags and what the person wrote. Any photo opens in the viewer
// (zoom, tags, the AI on request, compare with an earlier photo of the zone).
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, pageHead, num, cropAvatar, toast } from './ui.js';
import { openViewer, tagChips, photoTitle } from './viewer.js';

let farm = null, data = null, mount = null, day = null, catalog = null;

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => new Date(s + 'T12:00:00');
const shift = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const longDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';

export async function renderScouting(container, currentFarm) {
  farm = currentFarm; mount = container;
  day = day || ymd(new Date());
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the day…'));
  try {
    [data, catalog] = await Promise.all([rpc('scouting_day', { p_farm: farm.id, p_day: day }), catalog || rpc('pest_catalog')]);
  } catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  day = data.day;
  paint();
}

function paint() {
  mount.textContent = '';
  const days = data.days || [];
  const prevDay = [...days].reverse().find(d => d < day);
  const nextDay = days.find(d => d > day);
  const today = ymd(new Date());

  // the day, and the way to another one
  const nav = el('div', 'row'); nav.style.alignItems = 'center';
  const prev = el('button', 'btn btn-sm', '‹'); prev.title = prevDay ? 'Previous report: ' + longDay(prevDay) : 'The day before'; prev.onclick = () => { day = prevDay || shift(day, -1); load(); };
  const next = el('button', 'btn btn-sm', '›'); next.title = nextDay ? 'Next report: ' + longDay(nextDay) : 'The day after'; next.onclick = () => { day = nextDay || shift(day, 1); load(); };
  const pick = el('input', 'input'); pick.type = 'date'; pick.value = day; pick.max = today;
  pick.onchange = () => { if (pick.value) { day = pick.value; load(); } };
  const now = el('button', 'btn btn-sm btn-ghost', 'Today'); now.onclick = () => { day = today; load(); };
  nav.append(prev, pick, next, now);
  mount.append(pageHead('Pest & diseases',
    'The daily scouting, zone by zone: the sticky traps counted that day, the photos of anything unusual on the plants ' +
    'with their crop and part, the tags a person or the AI put on them. Open a photo to zoom, tag it, ask the AI, or ' +
    'compare it with an earlier one of the same zone.', nav));

  // the day in one line
  const zones = data.zones || [];
  const nPhotos = zones.reduce((a, z) => a + z.photos.length, 0);
  const nTraps = zones.reduce((a, z) => a + z.traps.length, 0);
  const nTagged = zones.reduce((a, z) => a + z.photos.filter(p => (p.tags || []).length || p.ai_status === 'done').length
                                        + z.traps.filter(p => (p.tags || []).length || p.ai_status === 'done').length, 0);
  const line = el('div', 'row'); line.style.margin = '0 0 var(--space-4)';
  const pill = (t, k) => line.append(el('span', 'pill ' + (k || ''), t));
  pill(longDay(day) + (day === today ? ' · today' : ''));
  const t = data.task;
  if (t) pill(t.status === 'done' ? `scouted${t.workers?.length ? ' by ' + t.workers.join(', ') : ''}${t.done_at ? ' · ' + hhmm(t.done_at) : ''}` : `scouting ${t.status}`, t.status === 'done' ? 'ok' : 'warn');
  else pill('no scouting task this day', 'warn');
  pill(`${nPhotos} plant photo${nPhotos === 1 ? '' : 's'}`);
  pill(`${nTraps} trap${nTraps === 1 ? '' : 's'} counted`);
  if (nTagged) pill(`${nTagged} tagged`);
  mount.append(line);
  if (!data.ai_ready) mount.append(el('div', 'hint', 'The AI is off: paste an Anthropic API key in Settings › Integrations to ask it about a photo.'));

  if (!zones.length) { mount.append(el('div', 'empty', 'No zone on this FarmBox yet.')); return; }
  zones.forEach(z => mount.append(zoneBand(z)));
}

// one zone: a collapsible band with its photos and its answers
function zoneBand(z) {
  const det = el('details', 'sc-zone');
  const photos = [...z.traps.map(p => ({ ...p, zone: z.name })), ...z.photos.map(p => ({ ...p, zone: z.name }))];
  det.open = photos.length > 0;
  const sum = el('summary');
  const left = el('div', 'sc-zone-title');
  left.append(el('b', null, z.name));
  const crops = el('span', 'sc-crops');
  (z.crops || []).forEach(c => crops.append(cropAvatar({ ...c }, 'sm')));
  left.append(crops);
  sum.append(left);
  const right = el('div', 'sc-zone-facts');
  const trapWord = z.traps.length ? `${z.traps.length} trap${z.traps.length > 1 ? 's' : ''} counted` : (z.item?.done_at ? 'traps skipped' : 'traps —');
  right.append(el('span', 'pill', trapWord));
  right.append(el('span', 'pill', `${z.photos.length} photo${z.photos.length === 1 ? '' : 's'}`));
  const over = z.traps.filter(p => p.total != null && data.threshold && p.total >= data.threshold.over).length;
  if (over) right.append(el('span', 'pill bad', `${over} over the threshold`));
  // the tags seen in this zone today
  const seen = new Map();
  photos.forEach(p => {
    (p.tags || []).forEach(x => seen.set(x.code, x.label || x.code));
    (p.ai?.findings || []).forEach(x => seen.set('ai:' + x.code, 'AI: ' + (x.name || x.code)));
  });
  [...seen.values()].slice(0, 4).forEach(l => right.append(el('span', 'vw-tag', l)));
  if (z.item?.done_at) right.append(el('span', 'hint', hhmm(z.item.done_at)));
  else if (z.item) right.append(el('span', 'hint', 'not done'));
  sum.append(right);
  det.append(sum);

  const body = el('div', 'sc-body');
  if (!photos.length) body.append(el('div', 'hint', z.item?.done_at ? 'Nothing photographed in this zone that day.' : 'Not scouted that day.'));
  else {
    const grid = el('div', 'sc-grid');
    photos.forEach(p => grid.append(figure(p, z)));
    body.append(grid);
  }
  const answers = (z.answers || []).filter(a => a.note || a.value || a.result === 'nok' || a.result === 'skipped');
  if (answers.length) {
    const list = el('div', 'sc-answers');
    answers.forEach(a => {
      const row = el('div', 'sc-answer');
      row.append(el('span', 'pill ' + (a.result === 'nok' ? 'bad' : a.result === 'skipped' ? 'warn' : 'ok'), a.result === 'nok' ? 'not OK' : a.result),
                 el('span', null, a.title || `step ${a.seq}`),
                 el('span', 'hint', [a.value, a.note].filter(Boolean).join(' · ')));
      list.append(row);
    });
    body.append(list);
  }
  det.append(body);
  return det;
}

function figure(p, z) {
  const fig = el('figure', 'sc-fig');
  const im = el('img'); im.src = p.photo_data || ''; im.alt = photoTitle(p); im.loading = 'lazy';
  fig.append(im);
  const cap = el('figcaption');
  const title = el('div'); title.append(el('b', null, photoTitle(p)));
  if (p.kind === 'trap' && data.threshold && p.total != null && p.total >= data.threshold.over) title.append(el('span', 'pill bad', 'over'));
  cap.append(title);
  cap.append(tagChips(p));
  const st = p.ai_status === 'done' ? 'AI read' : p.ai_status === 'queued' ? 'AI asked' : p.ai_status === 'failed' ? 'AI failed' : null;
  cap.append(el('div', 'hint', [hhmm(p.taken_at), p.note, st].filter(Boolean).join(' · ')));
  fig.append(cap);
  fig.onclick = () => openViewer({
    farm, photo: p, catalog, aiReady: data.ai_ready, mayWrite: data.may_write !== false,
    zonePhotos: () => rpc('zone_photos', { p_farm: farm.id, p_zone: z.zone_id, p_from: shift(day, -120), p_to: day }),
    onChange: () => load(),
  });
  return fig;
}
