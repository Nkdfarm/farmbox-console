// ═══════════════════════════════════════════════════════════════════════════
// The robot in the daily scouting (console 0.7.184, migration 0188; owner, 1 Oct
// 2026: "put inside the daily scouting as collapsible tab is more coherent and
// clean" — 0.7.183 had it as a tab of its own).
//
// Matthew Paxton is the Unitree G1. It sends through the ingest endpoint with its
// own device key (Connections › Devices & API, kind Robot): a count of what it
// saw, the sizes it measured against the printed scale card, a small photo, a
// note. scouting.js reads robot_scouting(farm, days) with the page and asks
// robotSection() for a line that opens, like Growth and Traps: in the zone the
// robot named, or under the day's zones when it named none. The robot proposes,
// a person validates: a manager confirms or dismisses each row.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, num, cropAvatar, toast, busy, drawer } from './ui.js';

const OBJECT = { plant: ['plant', 'plants'], head: ['head', 'heads'], fruit: ['fruit', 'fruit'], flower: ['flower', 'flowers'],
                 truss: ['truss', 'trusses'], gap: ['gap', 'gaps'], pest: ['pest', 'pests'], other: ['object', 'objects'] };
const MEASURE_WORD = { diameter: 'Ø', length: 'L', width: 'W', height: 'H' };
const STATUS = { new: ['warn', 'To validate'], confirmed: ['ok', 'Confirmed'], dismissed: ['', 'Dismissed'] };
const parse = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const longDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';
const what = r => { const w = OBJECT[r.object] || OBJECT.other; return `${num(r.count, 0)} ${r.count === 1 ? w[0] : w[1]}${r.crop ? ' · ' + r.crop : ''}`; };
const where = r => [r.zone, r.system && r.system !== r.zone ? r.system : null, r.position || r.pos_code].filter(Boolean).join(' · ');
// the sizes, one line an item: "1  L 363 · Ø 41 mm"
function sizeLines(measures) {
  const by = new Map();
  (measures || []).forEach(m => { const k = m.item ?? 1; if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  return [...by.entries()].map(([k, ms]) => ({ item: k, text: ms.map(m => `${MEASURE_WORD[m.what] || m.what} ${num(m.mm, 0)}`).join(' · ') + ' mm' }));
}

// each section carries its own options down to its cards: two units of a site draw their own sections, and one
// shared ctx sent a Confirm to the other unit's reload with the other unit's rights (review 3 Oct 2026)
const NO_OPTS = { mayWrite: false, onChange: () => {} };

// a line that opens on the robot's observations: its name, how many, how many wait for a person
export function robotSection(rows, opts) {
  const ctx = { ...NO_OPTS, ...opts };
  const det = el('details', 'pd-sec pd-robot');
  const names = [...new Set(rows.map(r => r.robot).filter(Boolean))].join(', ') || opts?.names || 'Robot';
  const w = rows.filter(r => r.status === 'new').length;
  const sum = el('summary');
  sum.append(el('b', null, names), el('span', 'hint', rows.length ? `robot · ${rows.length} observation${rows.length === 1 ? '' : 's'}` : 'robot · nothing sent that day'));
  if (w) sum.append(el('span', 'pill warn', `${w} to validate`));
  const grid = el('div', rows.length ? 'sc-grid pd-sec-body' : 'pd-sec-body');
  rows.forEach(r => grid.append(card(r, ctx)));
  // a registered robot has its line on today's report before it has sent anything (0.7.185)
  if (!rows.length) grid.append(el('div', 'hint', 'Nothing received yet. What the robot counts and measures on its round shows here, for a manager to confirm.'));
  det.append(sum, grid);
  return det;
}

function card(r, ctx) {
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
  fig.onclick = () => open(r, ctx);
  return fig;
}

function open(r, ctx) {
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
  if (!ctx.mayWrite) { dr.body.append(el('p', 'hint', 'A manager of this FarmBox confirms or dismisses what the robot sent.')); return; }
  const acts = el('div', 'rb-acts');
  const act = (label, status, cls2) => {
    const b = el('button', 'btn' + (cls2 ? ' ' + cls2 : ''), label);
    b.onclick = async () => {
      busy(b, true, 'Saving…');
      try { await rpc('decide_robot_count', { p_id: r.id, p_status: status }); dr.close(); await ctx.onChange(); }
      catch (e) { busy(b, false, label); toast(e.message, 'bad'); }
    };
    acts.append(b);
  };
  if (r.status !== 'confirmed') act('Confirm', 'confirmed', 'btn-primary');
  if (r.status !== 'dismissed') act('Dismiss', 'dismissed');
  if (r.status !== 'new') act('Back to validate', 'new');
  dr.body.append(acts);
}
