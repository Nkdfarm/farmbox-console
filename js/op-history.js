// ═════════════════════════════════════════════════════════════════════
// The history strip's model (owner, 21 Nov 2026; the screen is op-strip.js). Pure: no DOM, no import — node runs it
// (scripts/check-timeline.mjs). The lines are public.operations' rows (0286), newest first as the server gives them.
//
//   visibleOps   which lines the strip shows: setup changes only unless "All", only this page's when "This page";
//                oldest first, as a CAD feature tree reads
//   buildItems   the strip itself: a date tick between days, an AI build (a group) as one bracket, the same command on
//                the same object repeated in a row collapsed into one icon ×n (open on a click)
//   afterMarker  the lines after the marker (Fusion's rollback bar): it rolls nothing back, it only marks
//   revertPlan   "Revert from here…": every line after the marker, newest first, each one put back or why it stays
//   revertUnits  how they are sent: a whole AI build of database steps as one revert_group, the rest one by one
//   conflictsOf  a conflict caused by a later line of the same plan clears itself (newest first), any other one blocks
// Since console 0.22.00.
// ═════════════════════════════════════════════════════════════════════
import { glyphOf } from './op-glyphs.js';

const defaultDayOf = iso => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return String(iso || '').slice(0, 10); }
};
const bySeq = (a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0);

// a route belongs to a page when it is the page or one of its tabs (as the registry's listCommands reads it)
export const onPage = (route, page) => !!route && !!page && (route === page || route.startsWith(page + '/') || page.startsWith(route + '/'));

// opts: { all, thisPage, route, pagesOf(command) → the registry's pages of that command, or [] }
export function visibleOps(ops, { all = false, thisPage = false, route = '', pagesOf = () => [] } = {}) {
  const list = Array.isArray(ops) ? ops : [];
  const byId = new Map(list.map(o => [o.id, o]));
  return list.filter(o => {
    if (!o || !o.command) return false;
    if (!all && !glyphOf(o.command, o.family, o.revert_of ? byId.get(o.revert_of) : null).setup) return false;
    if (thisPage) {
      const orig = o.revert_of ? byId.get(o.revert_of) : null;
      const pages = [o.page, ...(pagesOf(o.command) || []), ...(orig ? [orig.page, ...(pagesOf(orig.command) || [])] : [])];
      if (!pages.some(p => onPage(route, p))) return false;
    }
    return true;
  }).sort(bySeq);
}

// the object a line works on, for collapsing repeats: the program or recipe on its centre, the batch, the crop… null when
// the line names none (a new thing is always its own object)
const KEYS = ['proId', 'p_plan', 'p_sop', 'p_crop', 'p_valve', 'p_position', 'p_zone', 'p_line', 'ghId', 'p_asset'];
export function objectKey(o) {
  const g = glyphOf(o.command, o.family);
  if (g.verb === 'new' || o.command === 'revert') return null;
  const a = o.args || {};
  const k = KEYS.find(x => a[x] !== undefined && a[x] !== null && typeof a[x] !== 'object');
  const inner = a.p && typeof a.p === 'object' && a.p.id != null ? a.p.id : null;
  if (k === undefined && inner === null) return null;
  return `${o.command}|${a.id ?? ''}|${k ? a[k] : inner}`;
}

// items, oldest first: { type: 'day', day } · { type: 'op', op, at } · { type: 'repeat', key, ops, at, open } ·
// { type: 'group', id, ops, at, folded }. `at` is the index of the item's first line in the flat order (the marker counts
// lines, so `at + ops.length` is the position after it). opts: { dayOf, expanded (Set of repeat keys), folded (Set of
// group ids) }. A repeat never crosses a day, a group, another status, or another person.
export function buildItems(chrono, { dayOf = defaultDayOf, expanded = new Set(), folded = new Set() } = {}) {
  const out = [];
  const seen = new Set();
  const units = [];
  for (const o of chrono) {
    if (o.group_id) {
      if (seen.has(o.group_id)) continue;
      seen.add(o.group_id);
      units.push({ type: 'group', id: o.group_id, ops: chrono.filter(x => x.group_id === o.group_id) });
      continue;
    }
    const last = units[units.length - 1];
    const key = objectKey(o);
    if (key && last && last.type !== 'group' && last.key === key && last.ops[0].status === o.status &&
        last.ops[0].by_user === o.by_user && dayOf(last.ops[0].at) === dayOf(o.at)) {
      last.ops.push(o);
      continue;
    }
    units.push({ type: 'run', key, ops: [o] });
  }
  let n = 0, day = null;
  for (const u of units) {
    const d = dayOf(u.ops[0].at);
    if (d !== day) { out.push({ type: 'day', day: d }); day = d; }
    if (u.type === 'group') out.push({ type: 'group', id: u.id, ops: u.ops, at: n, folded: folded.has(u.id) });
    else if (u.ops.length > 1 && !expanded.has(u.key)) out.push({ type: 'repeat', key: u.key, ops: u.ops, at: n, open: false });
    else if (u.ops.length > 1) u.ops.forEach((o, i) => out.push({ type: 'op', op: o, at: n + i, repeat: u.key, first: i === 0, count: u.ops.length }));
    else out.push({ type: 'op', op: u.ops[0], at: n });
    n += u.ops.length;
    day = dayOf(u.ops[u.ops.length - 1].at);
  }
  return out;
}

// the lines in the strip's flat order (groups and repeats as they are drawn)
export const flatOps = items => items.flatMap(i => i.type === 'op' ? [i.op] : i.type === 'day' ? [] : i.ops);
// the positions the marker may stand at: before the first line, and after every item (inside a collapsed repeat or a
// folded group it cannot stop)
export function markerStops(items) {
  const stops = [0];
  for (const i of items) {
    if (i.type === 'day') continue;
    if (i.type === 'group' && !i.folded) i.ops.forEach((_, k) => stops.push(i.at + k + 1));
    else stops.push(i.at + (i.type === 'op' ? 1 : i.ops.length));
  }
  return [...new Set(stops)].sort((a, b) => a - b);
}
export function nearestStop(items, pos) {
  const s = markerStops(items);
  return s.reduce((b, x) => Math.abs(x - pos) < Math.abs(b - pos) ? x : b, s[s.length - 1]);
}
export const afterMarker = (items, marker) => flatOps(items).slice(Math.max(0, marker ?? Infinity));

// why a line stays as it is
export function stayReason(o) {
  if (o.command === 'revert' || o.revert_of) return 'puts back an earlier change itself';
  if (o.status === 'reverted') return 'already put back';
  if (o.status === 'failed') return 'it failed: nothing was changed';
  if (o.status === 'waiting') return 'waits for a manager: nothing was applied';
  if (o.revert_class === 'C' || o.revert_class == null) return 'final';
  if (o.read_only) return 'read only for you';
  if (o.revert_class === 'B') return 'undone by its own action (stop, resume), not put back';
  if (!o.may_revert) return o.changes === 0 && o.kept ? 'changed nothing' : 'cannot be put back from here';
  return null;
}
// newest first: { op, will (true: it is put back), why (when it stays) }
export const revertPlan = ops => [...ops].sort((a, b) => bySeq(b, a)).map(op => { const why = stayReason(op); return { op, will: !why, why }; });

// the plan's lines that are put back, as they are sent, newest first: an AI build entirely inside the plan, of database
// steps only, as one { type: 'group' } (public.revert_group: the same newest first and the same stop); everything else
// one { type: 'op' } at a time (revert_operation, or FarmNet's restore through the registry).
// groupSize: the build's step count over the whole log (operations().groups[id].left) — a build partly before the
// marker is sent step by step.
export function revertUnits(plan, groupSize = () => null) {
  const will = plan.filter(p => p.will).map(p => p.op);
  const out = [];
  for (let i = 0; i < will.length; i++) {
    const o = will[i];
    if (o.group_id) {
      let j = i;
      while (j + 1 < will.length && will[j + 1].group_id === o.group_id) j++;
      const run = will.slice(i, j + 1);
      const all = plan.filter(p => p.op.group_id === o.group_id);
      const whole = all.every(p => p.will) && run.length === all.length && groupSize(o.group_id) === run.length;
      if (whole && run.every(s => s.source !== 'farmnet')) { out.push({ type: 'group', id: o.group_id, ops: run }); i = j; continue; }
    }
    out.push({ type: 'op', op: o });
  }
  return out;
}

// a conflict of one line (operation_detail) that a later line of the same plan made clears itself when that later line is
// put back first; any other blocks the revert there. → { clears: [...], blocks: [...] }
export function conflictsOf(conflicts, plan) {
  const later = plan.filter(p => p.will).map(p => p.op);
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) < 2000;
  const res = { clears: [], blocks: [] };
  for (const c of conflicts || []) {
    const mine = c.at && later.some(o => near(o.at, c.at) && (!c.by || o.by === c.by));
    (mine ? res.clears : res.blocks).push(c);
  }
  return res;
}

// "N changes today" on the folded strip
export const countToday = (ops, today, dayOf = defaultDayOf) => ops.filter(o => dayOf(o.at) === today).length;
