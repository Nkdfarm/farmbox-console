// Scouting page: shared state S, constants, small helpers, robot helpers, zone filters, the read queue
import { rpc } from '../api.js';
import { robotStrip } from '../robot.js';
import { el, parseNoon as parse, readNote } from '../ui.js';
import { reload } from './index.js';

// the page's shared state (was the module-level `let`s of scouting.js): one object so every part can assign to it
export const S = {
  farm: null, mount: null, over: null, cases: null, dates: [], catalog: null,
  aiReadyKnown: undefined,                            // from the last day read (scouting_day_light.ai_ready), for the trap map's viewer
  cropFilter: null, zoneFilter: null, showClosed: false, moreDone: false,
  datesFarm: null,                                    // the unit `dates` belongs to
  tmap: null, kit: null, opinions: [], robot: null,
  gh: null, ghFarm: null,                             // the whole greenhouse (0224–0225, greenhouse.js): a kit per unit, its panel on top of the page
  extras: [], people: [], coverage: [],               // the unit's extra scoutings (0206): who, the day, the time, what each sent
  robotTimer: null,
  olderSeq: 0,
};
let robotAsking = false;
export const SVG_NS = 'http://www.w3.org/2000/svg';
const RANK = { red: 3, orange: 2, green: 1 };
export const worst = list => list.reduce((a, d) => (RANK[d] || 0) > (RANK[a] || 0) ? d : a, null);
const DOT_WORD = { red: 'Severe, or a trap over the limit', orange: 'A case open, or a trap on watch', green: 'Improving under treatment, or resolved recently' };
export const dotEl = d => { const s = el('span', 'dot' + (d ? ' ' + d : ' none')); if (d) s.title = DOT_WORD[d]; return s; };
export const longDay = s => parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
export const MEASURE_WORD = { diameter: 'Ø', length: 'L', width: 'W', height: 'H' };

// what the robot sent (0188): that day's rows, and those naming a zone band
export const robotDay = day => (S.robot?.rows || []).filter(r => String(r.day) === String(day));
export const robotIn = (z, rows) => rows.filter(r => r.zone && (r.zone === z.name || r.zone === z.zone_name));
export const robotNames = () => (S.robot?.robots || []).filter(x => x.active !== false).map(x => x.name).join(', ');
export const robotOpts = () => ({ mayWrite: !!S.robot?.may_write, onChange: reload, names: robotNames() });
// the robot's pictures of the day the whole-greenhouse report shows, at its foot (0.7.260): none dismissed, newest first;
// no box on a day without a picture unless a robot is registered and the day is today (it is waiting for the round)
export function robotFoot(day) {
  const k = String(day), isToday = k === String(S.over?.today || '');
  const rows = (S.robot?.rows || []).filter(r => String(r.day) === k && r.status !== 'dismissed');
  if (!rows.length && !(isToday && robotNames())) return null;
  return robotStrip(rows, { ...robotOpts(), live: isToday,
    onRemoved: r => { const x = (S.robot?.rows || []).find(y => y.id === r.id); if (x) x.status = 'dismissed'; } });
}
// live (0.7.260, for the G1 demo of 15 Oct 2026): the robot sends through ingest, which tells no console, so while this
// page shows the whole greenhouse on today, today's rows are read again every ten seconds (about 30 kB a picture) and
// the panel is drawn again when something came, went or changed
const robotSig = rows => rows.map(r => r.id + ':' + r.status).join(',');
export async function robotTick() {
  if (!S.mount?.isConnected) { clearInterval(S.robotTimer); S.robotTimer = null; return; }   // the page was left: no timer wakes for nothing
  if (document.hidden || S.zoneFilter || !S.gh || !S.farm || !robotNames() || robotAsking) return;
  const t = String(S.over?.today || '');
  if (!t || String(S.gh.day()) !== t) return;
  robotAsking = true;
  const mine = S.farm.id;
  try {
    const fresh = await rpc('robot_scouting', { p_farm: mine, p_days: 1 });
    if (S.farm?.id !== mine || !S.robot || !fresh) return;
    const was = (S.robot.rows || []).filter(r => String(r.day) === t), now = (fresh.rows || []).filter(r => String(r.day) === t);
    if (robotSig(was) === robotSig(now)) return;
    S.robot = { ...S.robot, robots: fresh.robots || S.robot.robots, may_write: fresh.may_write,
              rows: now.concat((S.robot.rows || []).filter(r => String(r.day) !== t)) };
    if (S.mount?.isConnected && !S.zoneFilter) S.gh.panel();
  } catch { /* a missed read: the next tick asks again */ }
  finally { robotAsking = false; }
}
export const zoneKey = () => 'fbc_pd_zone_' + S.farm.id;
// the report units (0171): a zone, or one table of a zone reported table by table; an older database gives zones
export const zones = () => (S.over?.pressure_units || S.over?.pressure_zones || []).map(z => ({ ...z, unit_id: z.unit_id || z.zone_id }));
export const cur = () => zones().find(z => z.unit_id === S.zoneFilter) || null;
export const zoneName = id => zones().find(z => z.unit_id === id)?.zone || 'this zone';
// a row of (zone, table) in a unit: its table's rows, and the zone's rows that name none of its tables
export const inUnit = (u, zoneId, sysId) => !!u && zoneId === u.zone_id && (!u.system_id || !sysId || sysId === u.system_id
  || !zones().some(x => x.zone_id === u.zone_id && x.system_id === sysId));
// in the chosen zone: a crop standing there, a case opened there
export const cropInZone = c => { const u = cur(); if (!u) return true;
  return u.system_id ? (c.system_ids || []).includes(u.system_id) : (c.zones || []).some(z => z.id === u.zone_id); };
export const caseInZone = k => !S.zoneFilter || inUnit(cur(), k.zone_id, k.system_id);
export const dayData = new Map();          // day → scouting_day, read when the day is opened
// The reads a report makes when it opens (0.7.188, owner 2 Oct 2026: "canceling statement due to statement timeout" on
// today's and yesterday's reports, right after an update): two days of five zones asked for 30 curves at once while the
// console was saving every page for offline, and the database cancels a statement after 8 s. Now three at a time, and a
// read the database cancelled or that never arrived is asked again, twice, a little later.
let running = 0; const waiting = [];
const pump = () => { while (running < 3 && waiting.length) { running++; const [fn, res, rej] = waiting.shift(); fn().then(res, rej).finally(() => { running--; pump(); }); } };
const queued = fn => new Promise((res, rej) => { waiting.push([fn, res, rej]); pump(); });
const BUSY = /statement timeout|canceling statement|timed out|Failed to fetch|NetworkError|57014|50[234]/i;
export async function calm(name, args) {
  for (let i = 0; ; i++) {
    try { return await queued(() => rpc(name, args)); }
    catch (e) { if (i >= 2 || !BUSY.test(String(e.message || e))) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
}
// a read that failed: one small note at the top of the page, not a break in what is shown (have = a copy is on screen)
// a later read that succeeded takes the note away
export const readOk = () => S.mount?.querySelector(':scope > .read-note')?.remove();
export function readFailed(have) {
  const m = S.mount;
  if (!m?.isConnected) return;
  m.querySelector(':scope > .read-note')?.remove();
  m.prepend(readNote(have));
}
