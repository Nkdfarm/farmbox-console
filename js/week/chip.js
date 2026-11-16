// the task chip, its drop targets and the task row
import { el, subFamilyHue, icon, toast, avatar, subFamilyTag } from '../ui.js';
import { rpc } from '../api.js';
import { FAM_ICON, PRIO, manual, stateOf, hhmm, hrs, longDate, onTask, stateMark, reasonText,
         shortDay, S } from './state.js';
import { unitOf, unitMark, timeWord, SLOT_WORD, slotOf, openIds, isOpenTask, firstName, timeOf,
         fmtWork, bandOf, SLOT_SHORT } from './data.js';
import { markManual, repeatsWord } from './actions.js';
import { mayPlanNow, alsoBy, load } from './index.js';
import { takesPerson, paintPeople, clearMarks } from './people.js';
import { openTask } from './task.js';

// ── one task as a chip ─────────────────────────────────────────────────────
export function chip(t, opts = {}) {
  const mine = S.spotlight && (t.workers || []).some(w => w.id === S.spotlight);
  const c = el('div', 'tk' + (t.status === 'done' ? ' done' : t.status === 'skipped' ? ' done skipped' : '') + (opts.big ? ' big' : '') + (S.spotlight ? (mine ? ' mine' : ' other') : ''));
  c.style.setProperty('--h', subFamilyHue(t.category || t.family));
  c.setAttribute('role', 'button'); c.tabIndex = 0;
  const ic = el('span', 'tk-ic'); ic.append(icon(FAM_ICON[t.family] || 'clipboard'));
  const text = el('span', 'tk-text');
  const title = el('span', 'tk-title', t.title);
  title.title = [t.title, t.area, t.crop, unitOf(t)?.name].filter(Boolean).join(' · ');
  text.append(title);
  if (t.hub) {
    const doneN = t.all.filter(m => m.status === 'done').length;
    const z = el('span', 'tk-hub', t.area + (doneN ? ` · ${doneN}/${t.all.length} done` : ''));
    z.title = t.all.map(m => `${m.area}: ${stateOf(m)[2].toLowerCase()}${(m.workers || []).length ? ' · ' + m.workers.map(w => w.name).join(', ') : ''}`).join(String.fromCharCode(10));
    text.append(z);
  }
  if (opts.big) {
    text.append(el('span', 'tk-sub', [hhmm(t.due_time) || SLOT_WORD[slotOf(t)], t.area, t.crop, t.category, hrs(t.minutes) + ' h',
      t.positions?.length ? t.positions.map(p => p.code).join(' ') : null].filter(Boolean).join(' · ')));
  }
  // who, on the left (0.7.181, owner: "the small avatar on the left over the small empty circle"): the face in place of the
  // status ring — ✓ / ✕ on the face once done or cancelled, the dashed ? when nobody is on it yet
  c.append(leadOf(t));
  // the unit is the colour of the chip's left edge (the legend above the board names it); its letters only in the day view
  if (unitOf(t)) { c.style.setProperty('--u', unitOf(t).colour || 'transparent'); c.classList.add('has-unit'); }
  const um = opts.big ? unitMark(t, true) : null;
  if (um) c.append(um);
  c.append(ic, text);
  // a harvest under a treatment's withholding period (0098)
  if (t.withholding_until && t.status !== 'done') {
    const w = el('span', 'tk-hold', '⛔'); w.title = `Do not harvest before ${longDate(t.withholding_until)} — a treatment's withholding period`;
    c.append(w);
  }
  const p = PRIO[t.priority];
  if (p && p[0]) { const s = el('span', 'tk-prio ' + t.priority, p[0]); s.title = p[1] + ' priority'; c.append(s); }
  if (t.hand?.every_days) { const s = el('span', 'tk-prio', '↻'); s.title = repeatsWord(t.hand); c.append(s); }
  // Not done · Paused · Done in … go under the title, so the title keeps the chip's width (0.7.181)
  const tw = timeWord(t);
  if (tw) { const s = el('span', 'tk-time ' + tw.cls, tw.text); if (tw.cls === 'over') s.title = `planned ${hrs(t.minutes)} h`; text.append(s); }
  if ((t.also_sent || []).length) { const s = el('span', 'tk-time late', '2 reports'); s.title = secondReports(t); text.append(s); }
  const more = el('button', 'tk-more', '⋮');
  more.setAttribute('aria-label', 'Actions for ' + t.title);
  more.onclick = e => { e.stopPropagation(); openTask(t); };
  c.append(more);
  const open = () => {
    if (manual.on) {
      if (t.status === 'done' || t.status === 'skipped') return;
      // a folded scouting card flips every open zone task of it together
      const ids = openIds(t);
      // who was on each task when it was clicked: only those names are taken off on Validate (FarmBox 0212) —
      // somebody another manager adds meanwhile stays
      (t.hub ? (t.all || t.members) : [t]).filter(isOpenTask).forEach(m => manual.seen.set(m.id, (m.workers || []).map(x => x.id)));
      const flip = set => { const all = ids.every(id => set.has(id)); ids.forEach(id => all ? set.delete(id) : set.add(id)); };
      if (manual.worker) flip(onTask(t, manual.worker) ? manual.drop : manual.tasks);   // theirs: off; anyone else's: to them
      else if ((t.workers || []).length) flip(manual.drop);                               // no face chosen: names off
      else { toast('Nobody on this task yet — click a face first to give it to someone'); return; }
      markManual(c, t);
      paintPeople();
      return;
    }
    openTask(t);
  };
  if (manual.on) markManual(c, t);
  c.onclick = open;
  c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  // drag it to another day or across the line (a manager, an open task)
  if (mayPlanNow() && t.status !== 'done' && t.status !== 'skipped' && !manual.on) {
    c.draggable = true;
    c.ondragstart = e => { S.dragging = t; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', t.id); } catch { /* fine */ } };
    c.ondragend = () => { S.dragging = null; c.classList.remove('dragging'); clearMarks(); };
  }
  if (!manual.on) takesPerson(c, t);
  return c;
}

// a task two people sent (FarmBox 0186): the first report is the task's, the others are kept and named here
export const secondReports = t => 'Also sent by ' + (t.also_sent || []).map(a => `${firstName(a.by) || 'somebody'}${a.at ? ' at ' + new Date(a.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`).join(', ')
  + ' — the first report is the one of the task; the other is kept as a second report.';
// who worked on it, one by one: "Naison 12 min (now) · Dial 5 min"
export const workedBy = t => ((timeOf(t) || {}).by || []).map(b => `${firstName(b.name) || 'somebody'} ${fmtWork(b.minutes)}${b.running ? ' (now)' : ''}`).join(' · ');

// a task's people in the order of the people column (0.7.228): the first face on a chip is the one highest in it
function inOrder(ws) {
  const placed = new Map((S.data?.board_order || []).map((id, i) => [id, i]));
  const at = w => placed.has(w.id) ? placed.get(w.id) : 1e9;
  return [...(ws || [])].sort((a, b) => at(a) - at(b) || String(a.name).localeCompare(String(b.name)));
}

// the chip's left end: the first person's face (+n for more), the status on it; nobody = the dashed ?
function leadOf(t) {
  const lead = el('span', 'tk-lead');
  const ws = inOrder(t.workers), [k] = stateOf(t);
  if (ws.length) {
    lead.append(avatar({ worker_id: ws[0].id, name: ws[0].name }, 'sm'));
    if (ws.length > 1) lead.append(el('span', 'tk-lead-more', '+' + (ws.length - 1)));
    if (k !== 'planned') { const b = stateMark(t); b.classList.add('tk-lead-badge'); lead.append(b); }
    if (t.hub && t.nobody && k === 'planned') lead.append(el('span', 'tk-lead-q', '?'));
  } else if (k !== 'planned') lead.append(stateMark(t));
  else lead.append(el('span', 'tk-nobody', '?'));
  const [, , word] = stateOf(t);
  lead.title = (ws.length ? ws.map(w => w.name).join(', ') : 'Nobody yet') + ' · ' + word
    + (t.hub && t.nobody ? ` · ${t.nobody} zone${t.nobody === 1 ? '' : 's'} with nobody yet` : '')
    + (t.skip_reason ? ' — ' + reasonText(t.skip_reason) + (t.skip_note ? ': ' + t.skip_note : '') : '');
  return lead;
}

// where a dragged chip may land: a day and, on the boards with bands, a half of it
export function dropTarget(cell, date, slot) {
  if (!mayPlanNow()) return;
  cell.ondragover = e => { if (!S.dragging) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('over'); };
  cell.ondragleave = () => cell.classList.remove('over');
  cell.ondrop = async e => {
    e.preventDefault(); cell.classList.remove('over');
    const t = S.dragging; S.dragging = null;
    if (!t) return;
    await moveTaskTo(t, date, slot);
  };
}

// the one write behind a task moved to a day (and a half of it): the drop of a chip and the "Move to…" chooser of the
// task drawer both call it
export async function moveTaskTo(t, date, slot) {
  const sameDay = t.date === date;
  const sameSlot = slot === null || bandOf(t) === slot;
  if (sameDay && sameSlot) return true;
  // a folded card moves every open zone of the day, not only those a filter leaves; a refusal half way
  // (0201: that day has the zone already) reloads, so the board shows what really moved
  const ids = (t.hub ? (t.all || t.members) : [t]).filter(isOpenTask).map(m => m.id);
  try {
    const others = [];
    for (const id of ids) { const r = await rpc('move_task', { p_task: id, p_date: date, p_slot: slot }); if (r?.just_before?.by) others.push(r.just_before.by); }
    toast(`${t.title} → ${shortDay(date)}${slot ? ' · ' + SLOT_WORD[slot].toLowerCase() : ''}` + alsoBy(others), 'ok');
    return true;
  } catch (err) { toast(err.message, 'bad'); return false; }
  finally { await load(); }
}

export const cell = child => { const c = el('td'); c.append(child); return c; };
const UNIT_WORDS = { tray: ['tray', 'trays'], plant: ['plant', 'plants'], m2: ['m²', 'm²'], system: ['system', 'systems'], batch: ['batch', 'batches'], position: ['position', 'positions'] };
const unitWord = (u, n) => (UNIT_WORDS[u] || [u, u])[Number(n) === 1 ? 0 : 1];

// The positions a task covers, by zone: "Zone 2 · 2A 138 plants (35 min) · 2B …".
// The crop is named on the position only when the task has more than one.
// A maintenance task lists its assets the same way (task_item, 0075), ✓ when ticked.
export function positionsLine(task) {
  if (!task.positions?.length) return null;
  const unit = task.unit && !['position', 'asset', 'area', 'trap'].includes(task.unit) ? task.unit : null;
  const crops = new Set(task.positions.map(p => p.crop).filter(Boolean));
  const one = p => (p.done_at ? '✓ ' : '') + (p.code || p.label || '?') + (crops.size > 1 && p.crop ? ` ${p.crop}` : '')
    + (unit && p.quantity ? ` ${Math.round(p.quantity * 10) / 10}` : '') + (p.minutes ? ` (${Math.round(p.minutes)} min)` : '');
  const zones = new Map();
  task.positions.forEach(p => { const z = p.zone || ''; if (!zones.has(z)) zones.set(z, []); zones.get(z).push(p); });
  const pos = el('div', 'hint week-positions');
  pos.textContent = [...zones.entries()].map(([z, ps]) =>
    (zones.size > 1 && z ? z + ' — ' : '') + ps.map(one).join(' · ')).join('  ·  ')
    + (unit && task.quantity ? ` — ${Math.round(task.quantity * 10) / 10} ${unitWord(unit, task.quantity)}` : '');
  pos.title = task.positions.map(p => `${[p.zone, p.code].filter(Boolean).join(' ')}${p.crop ? ' · ' + p.crop : ''}: ${p.quantity ?? ''} ${p.unit ?? ''} · ${p.minutes ?? 0} min`).join(String.fromCharCode(10));
  return pos;
}

// a row of the list view
export function taskRow(task) {
  const tr = el('tr');
  if (task.status === 'done' || task.status === 'skipped') tr.className = 'off';
  const st = el('span', 'tk-list-time'); st.append(stateMark(task), el('span', 'mono', hhmm(task.due_time) || SLOT_SHORT[slotOf(task)]));
  tr.append(cell(st));
  const what = el('div');
  what.append(el('b', null, task.title));
  what.append(el('div', 'hint', [task.area, task.crop, hrs(task.minutes) + ' h', task.harvest_kg != null ? `${Number(task.harvest_kg)} kg harvested` : null].filter(Boolean).join(' · ')));
  const pos = positionsLine(task); if (pos) what.append(pos);
  tr.append(cell(what));
  tr.append(cell(subFamilyTag(task.category || task.family)));
  const who = el('div', 'assignees');
  if (task.status === 'done') who.append(el('span', 'pill ok', 'done'));
  else if (task.status === 'skipped') who.append(el('span', 'pill bad', 'cancelled · ' + reasonText(task.skip_reason).toLowerCase()));
  else if (!task.workers.length) who.append(el('span', 'pill bad', 'nobody'));
  else {
    const stack = el('div', 'avatars');
    const ws = inOrder(task.workers);
    ws.slice(0, 3).forEach(w => { const a = avatar({ worker_id: w.id, name: w.name }, 'sm'); a.title = w.name; stack.append(a); });
    if (task.workers.length > 3) stack.append(el('div', 'avatar sm more', '+' + (task.workers.length - 3)));
    who.append(stack, el('small', null, ws.map(w => w.name).join(', ')));
  }
  tr.append(cell(who));
  const act = el('div', 'acts');
  const b = el('button', 'btn btn-sm btn-ghost', 'Open');
  b.onclick = () => openTask(task);
  act.append(b);
  tr.append(cell(act));
  if (!manual.on) takesPerson(tr, task);
  return tr;
}
