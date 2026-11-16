// the people column: faces, drag and drop of people and tasks, auto-assign
import { el, busy, toast, avatar, confirmDrawer, emptyState } from '../ui.js';
import { rpc } from '../api.js';
import { rangeOnScreen, mayPlanNow, mondaysOnScreen, alsoBy, load } from './index.js';
import { tasksOnScreen, isOpenTask } from './data.js';
import { manual, today, mondayOf, weeks, shift, resetManual, hrs, shortDay, S } from './state.js';
import { paintBody } from './views.js';
import { planDrawer } from './plan.js';

// ── the people column: faces, hours over the possible, and the two ways to assign ──
export function paintPeople() {
  if (!S.peopleCol) return;
  S.peopleCol.textContent = '';
  const [from, to] = rangeOnScreen();
  const onScreen = tasksOnScreen().filter(t => t.date >= from && t.date <= to && !['cancelled', 'skipped'].includes(t.status));
  // everyone rostered in any week on screen, with the hours possible in the range
  const people = new Map();
  for (const m of mondaysOnScreen()) {
    (weeks.get(m)?.roster || []).forEach(r => {
      const p = people.get(r.worker_id) || { id: r.worker_id, name: r.name, employment: r.employment, max: 0, days: 0 };
      const perDay = (r.days || []).length ? Number(r.minutes) / r.days.length : 0;
      for (let i = 0; i < 7; i++) {
        const dte = shift(m, i);
        if (dte < from || dte > to) continue;
        if ((r.days || []).includes(i + 1)) { p.max += perDay; p.days += 1; }
      }
      people.set(r.worker_id, p);
    });
  }
  // the order a manager dragged them into (FarmBox 0219), kept for the site; anybody never placed comes after, as before
  const placed = new Map((S.data?.board_order || []).map((id, i) => [id, i]));
  const place = p => placed.has(p.id) ? placed.get(p.id) : Infinity;
  const list = [...people.values()].sort((a, b) => (place(a) === place(b) ? 0 : place(a) - place(b))
    || (a.employment === 'casual') - (b.employment === 'casual') || a.name.localeCompare(b.name));
  list.forEach(p => { p.assigned = onScreen.filter(t => (t.workers || []).some(w => w.id === p.id)).reduce((a, t) => a + Number(t.minutes || 0), 0); });
  // the spotlight is on a face: when that face is no longer here (off the task pages, switched off, away that week) it goes
  if (S.spotlight && !list.some(p => p.id === S.spotlight)) S.spotlight = null;

  const may = mayPlanNow();
  const head = el('div', 'tk-people-head');
  const bm = el('button', 'btn btn-sm' + (manual.on ? ' btn-accent' : ''), 'Assign manually');
  bm.disabled = !may;
  bm.onclick = () => { resetManual(!manual.on); paintPeople(); paintBody(); };
  const ba = el('button', 'btn btn-sm btn-primary', 'Assign automatically');
  ba.disabled = !may;
  ba.onclick = () => autoAssign(ba, from, to);
  head.append(bm, ba);
  S.peopleCol.append(head);
  if (!may) S.peopleCol.append(el('div', 'hint', 'Only a manager assigns the work.'));
  if (manual.on) {
    const who = manual.worker ? (list.find(p => p.id === manual.worker)?.name || 'Chosen') : null;
    S.peopleCol.append(el('div', 'tk-guide', who
      ? `${who} · their tasks are outlined. Click a task to give it to ${who}, or one of theirs to take it off them. Then Validate.`
      : 'Click a task to take its names off, or a face to give tasks to that person. Then Validate.'));
    const acts = el('div', 'row');
    const count = [manual.tasks.size ? '+' + manual.tasks.size : null, manual.drop.size ? '−' + manual.drop.size : null].filter(Boolean).join(' ');
    const ok = el('button', 'btn btn-sm btn-primary', `Validate${count ? ' · ' + count : ''}`);
    ok.disabled = !(manual.worker && manual.tasks.size) && !manual.drop.size;
    ok.title = [manual.tasks.size ? `${manual.tasks.size} to give to ${who}` : null,
                manual.drop.size ? `${manual.drop.size} to take ${who ? who + ' off' : 'everybody off'}` : null].filter(Boolean).join(' · ');
    ok.onclick = async () => {
      busy(ok, true, 'Saving…');
      try {
        // one call (FarmBox 0212): the chosen person added, the names that were on the chip taken off — by name, so
        // two managers' changes combine instead of one replacing the other
        const seen = id => manual.seen.get(id) || [];
        const changes = [];
        if (manual.worker) for (const id of manual.tasks)
          changes.push({ task_id: id, add: [manual.worker], drop: seen(id).filter(w => w !== manual.worker) });
        for (const id of manual.drop) changes.push({ task_id: id, drop: manual.worker ? [manual.worker] : seen(id) });
        const r = await rpc('change_people', { p_changes: changes });
        const given = manual.worker ? manual.tasks.size : 0;
        const said = [given ? `${given} given to ${who}` : null,
                      manual.drop.size ? `${manual.drop.size} taken off ${who || 'everybody'}` : null].filter(Boolean);
        toast(said.join(' · ') + alsoBy(r.others), 'ok');
        resetManual(false);
        await load();
      } catch (e) { busy(ok, false, 'Validate'); toast(e.message, 'bad'); }
    };
    const no = el('button', 'btn btn-sm', 'Discard');
    no.onclick = () => { resetManual(false); paintPeople(); paintBody(); };
    acts.append(ok, no);
    S.peopleCol.append(acts);
  }
  const unit = S.span === 'day' ? (S.day === today() ? 'today' : 'that day') : S.span === 'month' ? 'in the month'
             : (S.week === mondayOf(today()) ? 'this week' : 'that week');
  S.peopleCol.append(el('div', 'tk-people-sub', `Hours ${unit}: assigned / possible`));
  if (!list.length) S.peopleCol.append(emptyState('Nobody is rostered in this period.'));
  list.forEach(p => {
    const card = el('button', 'tk-person' + (manual.on && manual.worker === p.id ? ' chosen' : '') + (manual.on ? ' pickable' : ''));
    // the card as it was before 0.7.245 — the face, the name, the hours under it, the bar — with the name alone: how
    // somebody is employed ("· on demand", "· part time") made the column wide and is in the hint now (0.7.248, owner:
    // "use the previous team design in the left column, just remove the job category to have a less wide column";
    // 0.7.245 had squeezed the card to one line, which he did not keep)
    card.append(avatar({ worker_id: p.id, name: p.name }, 'md'));
    const txt = el('div', 'tk-person-txt');
    txt.append(el('div', 'tk-person-name', p.name));
    const over = p.max > 0 && p.assigned > p.max;
    const h = el('div', 'tk-person-hours' + (over ? ' over' : '') + (!p.max ? ' off' : ''));
    h.textContent = p.max ? `${hrs(p.assigned)} / ${hrs(p.max)} h` : (p.assigned ? `${hrs(p.assigned)} h · not rostered` : 'not rostered');
    txt.append(h);
    const bar = el('div', 'tk-person-bar');
    const fill = el('div', 'tk-person-fill' + (over ? ' over' : ''));
    fill.style.width = (p.max ? Math.min(100, Math.round((p.assigned / p.max) * 100)) : 0) + '%';
    bar.append(fill); txt.append(bar);
    card.append(txt);
    const emp = p.employment === 'casual' ? ' (on demand)' : p.employment === 'part_time' ? ' (part time)' : '';
    card.title = manual.on ? `Choose ${p.name}${emp}`
      : p.max ? `${p.name}${emp}: ${hrs(p.assigned)} h assigned of ${hrs(p.max)} h possible ${unit}`
              : `${p.name}${emp}: not rostered ${unit}` + (p.assigned ? `, ${hrs(p.assigned)} h assigned` : '');
    if (!manual.on && S.spotlight === p.id) card.classList.add('chosen');
    card.onclick = () => {
      // outside manual mode a face puts its tasks in the spotlight — the whole plan stays in view
      if (!manual.on) { S.spotlight = S.spotlight === p.id ? null : p.id; paintBody(); return; }
      manual.worker = manual.worker === p.id ? null : p.id; manual.tasks.clear(); manual.drop.clear();
      paintPeople(); paintBody();
    };
    if (may && !manual.on) personDrag(card, p, list);
    S.peopleCol.append(card);
  });
  // a task dropped here loses its names
  if (may && !manual.on && list.length) {
    const none = el('div', 'tk-person tk-person-none');
    none.append(el('span', 'tk-nobody', '?'), el('div', 'tk-person-name', 'Nobody'));
    none.title = 'Drop a task here to take its names off';
    none.ondragover = e => { if (!S.dragging) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; none.classList.add('over'); };
    none.ondragleave = () => none.classList.remove('over');
    none.ondrop = e => { e.preventDefault(); none.classList.remove('over'); const t = S.dragging; S.dragging = null; if (t) taskToPerson(t, null); };
    S.peopleCol.append(none);
  }
  if (!manual.on) S.peopleCol.append(el('div', 'hint', S.spotlight
    ? 'Their tasks stand out; the rest of the plan stays in view. Click the face again to clear.'
    : may ? 'Drag a face onto a task, or a task onto a face, to give it to that person (one person a task; hold Ctrl while dropping a face to add a second). Drag a task onto Nobody to take its names off, or to another day. Drag a face up or down to order the column. Click a face to see their tasks.'
          : 'Click a face to see their tasks in the plan.'));
}

// ── drag and drop between the people and the board (0.7.225) ───────────────
// A face is dragged onto a task (it becomes theirs; with Ctrl they are added) or onto another face (the column's order, kept for the site);
// a task is dragged onto a face (it becomes theirs) or onto Nobody. Each drop is saved at once, by name
// (change_people, FarmBox 0212), so what another manager did meanwhile stays.
function personDrag(card, p, list) {
  card.draggable = true;
  card.ondragstart = e => {
    S.dragPerson = p; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'copyMove';
    try { e.dataTransfer.setData('text/plain', p.name); } catch { /* fine */ }
  };
  card.ondragend = () => { S.dragPerson = null; card.classList.remove('dragging'); clearMarks(); };
  const half = e => { const r = card.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  card.ondragover = e => {
    if (S.dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.classList.add('over'); return; }
    if (!S.dragPerson || S.dragPerson.id === p.id) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const after = half(e);
    card.classList.toggle('drop-after', after); card.classList.toggle('drop-before', !after);
  };
  card.ondragleave = () => card.classList.remove('over', 'drop-before', 'drop-after');
  card.ondrop = e => {
    e.preventDefault();
    const after = half(e);
    card.classList.remove('over', 'drop-before', 'drop-after');
    if (S.dragging) { const t = S.dragging; S.dragging = null; taskToPerson(t, p); return; }
    const who = S.dragPerson; S.dragPerson = null;
    if (!who || who.id === p.id) return;
    const ids = list.map(x => x.id).filter(id => id !== who.id);
    ids.splice(ids.indexOf(p.id) + (after ? 1 : 0), 0, who.id);
    if (ids.join() !== list.map(x => x.id).join()) saveOrder(ids);
  };
}
export const clearMarks = () => S.mount?.querySelectorAll('.drop-before, .drop-after, .over, .tk-take')
  .forEach(n => n.classList.remove('drop-before', 'drop-after', 'over', 'tk-take'));

// the column in its new order at once, then kept; the people not on screen this week stay after, in their own order
async function saveOrder(ids) {
  S.loadGen++;                                   // a refresh in flight is not to paint the order as it was
  const rest = (S.data?.board_order || []).filter(id => !ids.includes(id));
  for (const w of weeks.values()) if (w) w.board_order = [...ids, ...rest];
  paintPeople();
  try {
    const r = await rpc('set_board_order', { p_farm: S.farm.id, p_workers: ids });
    // …nor one that started while this was being saved: it read the order as it was. One that has painted already
    // (the minute's refresh, or a phone's change, in that fraction of a second) is painted over with the order kept.
    S.loadGen++;
    const kept = r?.board_order || [...ids, ...rest];
    for (const w of weeks.values()) { if (w) w.board_order = kept; }
    paintPeople();
  } catch (e) { toast(e.message, 'bad'); await load(); }
}

// a task, or every open zone of a folded card
const openOnes = t => (t.hub ? (t.all || t.members) : [t]).filter(isOpenTask);
const has = (m, id) => (m.workers || []).some(w => w.id === id);

// a face dropped on a task: the task is theirs — one person on a task by default (0.7.229, owner 5 Oct 2026); with Ctrl
// (or Shift) held at the drop the person is added and whoever is on it stays
async function personToTask(p, t, add) {
  if (!add) return taskToPerson(t, p);
  const open = openOnes(t), ones = open.filter(m => !has(m, p.id));
  if (!open.length) { toast('A task that is done or cancelled keeps its people'); return; }
  if (!ones.length) { toast(`${p.name} is already on ${t.title}`); return; }
  try {
    const r = await rpc('change_people', { p_changes: ones.map(m => ({ task_id: m.id, add: [p.id] })) });
    toast(`${p.name} added to ${t.title}` + alsoBy(r.others), 'ok');
  } catch (e) { toast(e.message, 'bad'); }
  finally { await load(); }
}

// a task dropped on a face: it is theirs, the names that were on it come off; on Nobody (p null) the names come off
export async function taskToPerson(t, p) {
  const changes = [];
  for (const m of openOnes(t)) {
    const was = (m.workers || []).map(w => w.id);
    if (!p) { if (was.length) changes.push({ task_id: m.id, drop: was }); continue; }
    const drop = was.filter(id => id !== p.id);
    if (drop.length || !has(m, p.id)) changes.push({ task_id: m.id, add: [p.id], drop });
  }
  if (!changes.length) { toast(p ? `${t.title} is already ${p.name}'s` : 'Nobody is on this task'); return; }
  try {
    const r = await rpc('change_people', { p_changes: changes });
    toast((p ? `${t.title} → ${p.name}` : `${t.title}: names taken off`) + alsoBy(r.others), 'ok');
  } catch (e) { toast(e.message, 'bad'); }
  finally { await load(); }
}

// a task on the board takes a face dropped on it; a task dragged over it goes on to the day underneath
export function takesPerson(node, t) {
  if (!mayPlanNow() || !openOnes(t).length) return;
  node.addEventListener('dragover', e => {
    if (!S.dragPerson) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = (e.ctrlKey || e.shiftKey || e.metaKey) ? 'copy' : 'move'; node.classList.add('tk-take');
  });
  node.addEventListener('dragleave', () => node.classList.remove('tk-take'));
  node.addEventListener('drop', e => {
    if (!S.dragPerson) return;
    e.preventDefault(); e.stopPropagation(); node.classList.remove('tk-take');
    const p = S.dragPerson; S.dragPerson = null;
    personToTask(p, t, e.ctrlKey || e.shiftKey || e.metaKey);
  });
}

async function autoAssign(btn, from, to) {
  // one click used to replace every name chosen by hand in the range on screen — a month in Month view — and to
  // reach back to the days already over. It asks first now, as the same button on Team does, and starts today.
  const t0 = today();
  if (to < t0) { toast('These days are over: nothing to assign'); return; }
  if (from < t0) from = t0;
  if (!await confirmDrawer('Assign automatically?',
    `The names on the open tasks of ${from === to ? shortDay(from) : shortDay(from) + ' – ' + shortDay(to)} are replaced by the planner's — also the ones chosen by hand. Tasks already started keep their people.`,
    'Assign')) return;
  busy(btn, true, 'Assigning…');
  try {
    const r = await rpc('auto_assign', { p_farm: S.farm.id, p_from: from, p_to: to });
    const un = r.unassigned || [], ci = r.call_ins || [];
    toast(`${r.assigned} of ${r.tasks} tasks assigned`
      + (un.length ? ` · ${un.length} unassigned: ${un[0].reason}` : '')
      + (ci.length ? ` · ${ci.length} call-in${ci.length > 1 ? 's' : ''} (${[...new Set(ci.map(x => x.worker))].join(', ')}) — a decision for you` : '')
      + (r.left_alone ? ` · ${r.left_alone} already started, left as ${r.left_alone > 1 ? 'they are' : 'it is'}` : ''), un.length ? 'bad' : 'ok');
    await load();
  } catch (e) { busy(btn, false, 'Assign automatically'); toast(e.message, 'bad'); }
}

// the plan's state and its window, top right
export function planButton() {
  const wrap = el('div', 'row');
  const plan = S.data?.plan;
  if (plan) {
    const cap = Number(plan.capacity_minutes || 0), dem = Number(plan.demand_minutes || 0);
    const pct = cap ? Math.round((dem / cap) * 100) : 0;
    wrap.append(el('span', 'pill ' + (plan.status === 'draft' ? 'warn' : 'ok'),
      (plan.status === 'validated' ? 'Validated' : plan.status === 'locked' ? 'Locked' : 'Draft') + ' · ' + pct + '% loaded'));
  } else wrap.append(el('span', 'pill warn', 'Week not drafted'));
  const b = el('button', 'btn', 'Plan the week…');
  b.onclick = planDrawer;
  wrap.append(b);
  return wrap;
}
