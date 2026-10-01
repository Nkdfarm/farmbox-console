// ═══════════════════════════════════════════════════════════════════════════
// Pest & diseases › Matthew Paxton — what the robot collected (console 0.7.183,
// migration 0188; owner, 1 Oct 2026: "add in the scouting page the Matthew
// Paxton tab where to put the information collected by the G1").
//
// Matthew Paxton is the Unitree G1. It sends through the ingest endpoint with its
// own device key (Connections › Devices & API, kind Robot): a count of what it
// saw, the sizes it measured against the printed scale card, a small photo, a
// note. The page is robot_scouting(farm, days): the robots and their state at the
// top, then what came in by date, newest first. The robot proposes, a person
// validates: a manager confirms or dismisses each row.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { loading, el, pageHead, num, cropAvatar, toast, busy, drawer } from './ui.js';

const OBJECT = { plant: ['plant', 'plants'], head: ['head', 'heads'], fruit: ['fruit', 'fruit'], flower: ['flower', 'flowers'],
                 truss: ['truss', 'trusses'], gap: ['gap', 'gaps'], pest: ['pest', 'pests'], other: ['object', 'objects'] };
const MEASURE_WORD = { diameter: 'Ø', length: 'L', width: 'W', height: 'H' };
const STATUS = { new: ['warn', 'To validate'], confirmed: ['ok', 'Confirmed'], dismissed: ['', 'Dismissed'] };
const parse = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const longDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';
const ago = ts => {
  if (!ts) return 'never';
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const what = r => { const w = OBJECT[r.object] || OBJECT.other; return `${num(r.count, 0)} ${r.count === 1 ? w[0] : w[1]}${r.crop ? ' · ' + r.crop : ''}`; };
const where = r => [r.zone, r.system && r.system !== r.zone ? r.system : null, r.position || r.pos_code].filter(Boolean).join(' · ');
// the sizes, one line an item: "1  L 363 · Ø 41 mm"
function sizeLines(measures) {
  const by = new Map();
  (measures || []).forEach(m => { const k = m.item ?? 1; if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  return [...by.entries()].map(([k, ms]) => ({ item: k, text: ms.map(m => `${MEASURE_WORD[m.what] || m.what} ${num(m.mm, 0)}`).join(' · ') + ' mm' }));
}

let farm = null, mount = null, data = null;

export async function renderRobot(container, currentFarm) {
  farm = currentFarm; mount = container;
  mount.textContent = '';
  mount.append(loading('Reading what the robot sent…'));
  await load();
}

async function load() {
  const here = mount;
  try { data = await rpc('robot_scouting', { p_farm: farm.id, p_days: 30 }); }
  catch (e) { if (here.isConnected) { here.textContent = ''; here.append(el('div', 'note bad', e.message)); } return; }
  if (here.isConnected && mount === here) paint();
}

function paint() {
  mount.textContent = '';
  const again = el('button', 'btn', 'Read again');
  again.onclick = async () => { busy(again, true, 'Reading…'); await load(); };
  mount.append(pageHead('Matthew Paxton',
    'What the robot collected on its rounds: what it counted, the sizes it measured against the scale card, its photos. The robot proposes; a person validates.',
    again));

  const robots = data.robots || [], rows = data.rows || [];
  if (!robots.length) {
    mount.append(el('div', 'empty', 'No robot on this FarmBox yet. In Connections › Devices & API, add a device of kind Robot and make its key: what it sends shows here.'));
    return;
  }
  const box = el('div', 'pd-dash');
  const tiles = el('div', 'pd-tiles');
  const tile = (n, label, cls) => { const t = el('div', 'pd-tile' + (cls ? ' ' + cls : '')); t.append(el('b', null, String(n)), el('span', null, label)); tiles.append(t); };
  const today = String(data.today), todays = rows.filter(r => String(r.day) === today);
  const waiting = rows.filter(r => r.status === 'new').length;
  const seen = robots.map(r => r.last_seen_at).filter(Boolean).sort().pop();
  tile(ago(seen), robots.length === 1 ? `${robots[0].name} last heard` : `${robots.length} robots, last heard`);
  tile(todays.length, todays.length === 1 ? 'observation today' : 'observations today');
  tile(waiting, 'to validate', waiting ? 'warn' : '');
  tile(rows.length, `in ${data.days} days`);
  box.append(tiles);
  robots.filter(r => !r.key_set || !r.active).forEach(r =>
    box.append(el('div', 'note warn pd-wait-note', r.active ? `${r.name} has no key yet — make one in Connections › Devices & API.` : `${r.name} is switched off.`)));
  mount.append(box);

  const list = el('div', 'pd-days');
  if (!rows.length) list.append(el('div', 'empty', `Nothing received in the last ${data.days} days.`));
  const days = [...new Set(rows.map(r => String(r.day)))];
  days.forEach((d, i) => {
    const mine = rows.filter(r => String(r.day) === d);
    const det = el('details', 'pd-day');
    det.open = i === 0 || d === today;
    const sum = el('summary');
    sum.append(el('b', null, longDay(d) + (d === today ? ' · today' : '')));
    const facts = el('span', 'pd-day-facts');
    facts.append(el('span', 'pill', `${mine.length} observation${mine.length === 1 ? '' : 's'}`));
    const w = mine.filter(r => r.status === 'new').length;
    if (w) facts.append(el('span', 'pill warn', `${w} to validate`));
    sum.append(facts);
    const grid = el('div', 'sc-grid rb-grid');
    mine.forEach(r => grid.append(card(r)));
    det.append(sum, grid);
    list.append(det);
  });
  mount.append(list);
}

function card(r) {
  const fig = el('figure', 'sc-fig rb-fig' + (r.status === 'dismissed' ? ' rb-off' : ''));
  if (r.photo_data) { const im = el('img'); im.src = r.photo_data; im.alt = what(r); im.loading = 'lazy'; fig.append(im); }
  else fig.append(el('div', 'rb-nophoto', 'no photo'));
  const cap = el('figcaption');
  const title = el('div', 'pd-fig-title');
  if (r.crop) title.append(cropAvatar({ name: r.crop, category: r.category, photo_url: r.photo_url }, 'sm'));
  title.append(el('b', null, what(r)));
  cap.append(title);
  const line = el('div', 'sc-where');
  const [cls, word] = STATUS[r.status] || ['', r.status];
  line.append(el('span', 'pill ' + cls, word));
  if (where(r)) line.append(el('span', 'mono', where(r)));
  cap.append(line);
  const sizes = sizeLines(r.measures);
  if (sizes.length) cap.append(el('b', null, sizes.length === 1 ? sizes[0].text : `${sizes.length} measured · ${sizes[0].text}…`));
  cap.append(el('div', 'hint', [hhmm(r.at), r.robot, r.confidence != null ? `${Math.round(r.confidence * 100)} % sure` : null, r.note].filter(Boolean).join(' · ')));
  fig.append(cap);
  fig.onclick = () => open(r);
  return fig;
}

function open(r) {
  const dr = drawer(what(r), [longDay(r.day), hhmm(r.at), r.robot].filter(Boolean).join(' · '));
  if (r.photo_data) { const im = el('img', 'rb-photo'); im.src = r.photo_data; im.alt = what(r); dr.body.append(im); }
  const facts = el('div', 'rb-facts');
  const row = (k, v) => { if (v == null || v === '') return; const d = el('div'); d.append(el('span', 'hint', k), el('b', null, String(v))); facts.append(d); };
  row('Counted', what(r));
  row('Where', where(r));
  row('Crop', r.crop);
  row('Confidence', r.confidence != null ? `${Math.round(r.confidence * 100)} %` : null);
  row('Model', r.model);
  row('Note', r.note);
  dr.body.append(facts);
  const sizes = sizeLines(r.measures);
  if (sizes.length) {
    dr.body.append(el('div', 'sec-title', 'Sizes, against the scale card'));
    const ul = el('ul', 'rb-sizes');
    sizes.forEach(s => { const li = el('li'); li.append(el('span', 'hint', `${s.item}`), el('b', null, s.text)); ul.append(li); });
    dr.body.append(ul);
  }
  const [cls, word] = STATUS[r.status] || ['', r.status];
  const st = el('div', 'rb-status');
  st.append(el('span', 'pill ' + cls, word));
  if (r.decided_at) st.append(el('span', 'hint', `${parse(r.decided_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hhmm(r.decided_at)}`));
  dr.body.append(st);
  if (!data.may_write) { dr.body.append(el('p', 'hint', 'A manager of this FarmBox confirms or dismisses what the robot sent.')); return; }
  const acts = el('div', 'rb-acts');
  const act = (label, status, cls2) => {
    const b = el('button', 'btn' + (cls2 ? ' ' + cls2 : ''), label);
    b.onclick = async () => {
      busy(b, true, 'Saving…');
      try { await rpc('decide_robot_count', { p_id: r.id, p_status: status }); dr.close?.(); await load(); }
      catch (e) { busy(b, false, label); toast(e.message, 'bad'); }
    };
    acts.append(b);
  };
  if (r.status !== 'confirmed') act('Confirm', 'confirmed', 'btn-primary');
  if (r.status !== 'dismissed') act('Dismiss', 'dismissed');
  if (r.status !== 'new') act('Back to validate', 'new');
  dr.body.append(acts);
}
