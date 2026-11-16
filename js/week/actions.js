// new task, delete, mark done by hand, not done, reassign
import { drawer, input, selectBox, el, field, busy, toast, avatar, parseYmd } from '../ui.js';
import { familyOptions, loadFamilies, subFamiliesOf } from '../families.js';
import { select, rpc } from '../api.js';
import { shortDay, today, PRIO, longDate, manual, onTask, REASON_WORD, hrs, S } from './state.js';
import { SLOTS, SLOT_WORD, openIds } from './data.js';
import { load, alsoBy } from './index.js';

// ── tasks by hand (FarmBox 0262) ─────────────────────────────────────────────
// once, or every n days from a start day until an end day or until deleted; a closed day moves to the next working day
export const repeatsWord = h => !h?.every_days ? 'Once'
  : (h.every_days === 1 ? 'Every working day' : `Every ${h.every_days} days`) + ` from ${shortDay(h.starts_on)}`
    + (h.ends_on ? ` to ${shortDay(h.ends_on)}` : ' until deleted');

export async function newTask(onDay) {
  const d = drawer('New task', 'Added by hand: once, or every few days. A day nobody works moves it to the next working day.');
  const name = input({ type: 'text', placeholder: 'e.g. Clean the cold room', maxLength: 200 });
  const fam = selectBox(familyOptions(), 'Agriculture');
  const sub = el('select');
  const fillSub = () => {
    sub.textContent = '';
    [['', '—'], ...subFamiliesOf(fam.value).map(s => [s, s])].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; sub.append(o); });
  };
  fam.onchange = fillSub;
  const where = selectBox([['', 'The whole FarmBox']]);
  const slot = selectBox(SLOTS.map(x => [x, SLOT_WORD[x]]), 'any');
  const mins = input({ type: 'number', min: 5, max: 720, step: 5, value: 30 });
  const prio = selectBox(['normal', 'high', 'critical', 'low'].map(x => [x, PRIO[x][1]]), 'normal');
  const who = selectBox([['', 'Nobody yet'], ...(S.data?.roster || []).map(r => [r.worker_id, r.name])], '');
  const start = input({ type: 'date', min: today(), value: onDay && onDay >= today() ? onDay : today() });
  // how often: once, or every n days — and then until when
  let repeat = false, until = false;
  const onceB = el('button', 'toggle', 'One time'), everyB = el('button', 'toggle', 'Every');
  onceB.type = everyB.type = 'button';
  const every = input({ type: 'number', min: 1, max: 365, value: 7 }); every.style.width = '80px';
  const everyRow = el('div', 'row'); everyRow.append(onceB, everyB, every, el('span', 'hint', 'days'));
  const openB = el('button', 'toggle', 'Until deleted'), endB = el('button', 'toggle', 'Until');
  openB.type = endB.type = 'button';
  const end = input({ type: 'date', min: today() });
  const endRow = el('div', 'row'); endRow.append(openB, endB, end);
  const endF = field('Ends', endRow);
  const paintRepeat = () => {
    onceB.setAttribute('aria-pressed', String(!repeat)); everyB.setAttribute('aria-pressed', String(repeat));
    every.disabled = !repeat; endF.style.display = repeat ? '' : 'none';
    openB.setAttribute('aria-pressed', String(!until)); endB.setAttribute('aria-pressed', String(until)); end.disabled = !until;
  };
  onceB.onclick = () => { repeat = false; paintRepeat(); };
  everyB.onclick = () => { repeat = true; paintRepeat(); every.focus(); };
  every.onfocus = () => { if (!repeat) { repeat = true; paintRepeat(); } };
  openB.onclick = () => { until = false; paintRepeat(); };
  endB.onclick = () => { until = true; paintRepeat(); end.focus(); };
  fillSub(); paintRepeat();

  const g1 = el('div', 'grid2'); g1.append(field('Family', fam), field('Sub-family', sub, 'The colour on the board.'));
  const g2 = el('div', 'grid2'); g2.append(field('Where', where), field('Who', who, 'People rostered this week; empty = the planner or you, later.'));
  const g3 = el('div', 'grid2'); g3.append(field('When in the day', slot), field('Takes (minutes)', mins));
  const g4 = el('div', 'grid2'); g4.append(field('Priority', prio), field('First day', start));
  d.body.append(field('Name', name), g1, g2, g3, g4, field('Repeats', everyRow), endF);
  // the places of this unit (zones, sumps, rooms), read once the window is open
  select('area', `select=id,name,sort&farm_id=eq.${S.farm.id}&active=is.true&order=sort.asc,name.asc`)
    .then(rows => (rows || []).forEach(a => { const o = el('option', null, a.name); o.value = a.id; where.append(o); }))
    .catch(() => { /* the whole FarmBox only */ });
  loadFamilies().then(() => { const keep = fam.value; fam.textContent = ''; familyOptions().forEach(([v, l]) => { const o = el('option', null, l); o.value = v; fam.append(o); }); fam.value = keep || 'Agriculture'; fillSub(); });

  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Add the task');
  ok.onclick = async () => {
    if (!name.value.trim()) { toast('Give the task a name', 'bad'); name.focus(); return; }
    if (!start.value || start.value < today()) { toast('The first day is today or later', 'bad'); start.focus(); return; }
    const n = Number(every.value);
    if (repeat && !(Number.isInteger(n) && n >= 1 && n <= 365)) { toast('Every 1 to 365 days', 'bad'); every.focus(); return; }
    if (repeat && until && (!end.value || end.value < start.value)) { toast('The end day is on or after the first day', 'bad'); end.focus(); return; }
    busy(ok, true, 'Adding…');
    try {
      const r = await rpc('add_hand_task', { p: {
        farm_id: S.farm.id, title: name.value.trim(), family: fam.value, category: sub.value || null,
        area_id: where.value || null, slot: slot.value, minutes: Number(mins.value) || 30, priority: prio.value,
        worker_id: who.value || null, starts_on: start.value,
        every_days: repeat ? n : null, ends_on: repeat && until ? end.value : null } });
      d.close();
      toast(r?.created ? `Added — ${r.created === 1 ? 'on ' + shortDay(r.first) : r.created + ' days on the board from ' + shortDay(r.first)}` : 'Added', 'ok');
      await load();
    } catch (e) { busy(ok, false, 'Add the task'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

// this one, or this one and every later one; work started or closed stays
export function deleteHand(t, parent) {
  const gone = async (fromHere, b, label) => {
    busy(b, true, 'Deleting…');
    try {
      const r = await rpc('delete_hand_task', { p_task: t.id, p_from_here: fromHere });
      d.close(); parent?.close();
      toast(`Deleted${r?.deleted > 1 ? ' — ' + r.deleted + ' days' : ''}${r?.kept ? ' · ' + r.kept + ' already started or done stay' : ''}`, 'ok');
      await load();
    } catch (e) { busy(b, false, label); toast(e.message, 'bad'); }
  };
  const d = drawer('Delete this task', `${t.title} · ${longDate(t.date)}`);
  const open = t.status !== 'done' && t.status !== 'skipped';
  if (!t.hand.every_days) {
    d.body.append(el('p', null, open ? 'It goes from the board and from the phones.' : 'It is closed already: it stays in the history and is not deleted.'));
  } else {
    d.body.append(el('p', null, repeatsWord(t.hand) + '.'));
    d.body.append(el('div', 'hint', 'Only this one: the others stay. This one and every later one: the series stops here. A task somebody has started or closed is never deleted — it stays in the history.'));
  }
  const keep = el('button', 'btn', 'Keep it'); keep.onclick = d.close;
  d.footer.append(keep);
  if (t.hand.every_days) {
    const all = el('button', 'btn btn-danger', 'This one and every later one');
    all.onclick = () => gone(true, all, 'This one and every later one');
    d.footer.append(all);
  }
  if (open) {
    const one = el('button', 'btn btn-danger', t.hand.every_days ? 'Only this one' : 'Delete');
    one.onclick = () => gone(false, one, one.textContent);
    d.footer.append(one);
  }
}

// how a chip looks in Assign manually: picked = theirs after Validate, dropping = a name coming off
export function markManual(c, t) {
  const ids = openIds(t), all = set => ids.length > 0 && ids.every(id => set.has(id));
  const dropping = all(manual.drop);
  const kept = manual.worker && ((onTask(t, manual.worker) && !dropping) || all(manual.tasks));
  c.classList.toggle('picked', !!kept);
  c.classList.toggle('dropping', dropping);
  c.title = dropping ? `Comes off ${manual.worker ? 'this person' : 'everybody'} on Validate — click again to keep`
          : kept ? (onTask(t, manual.worker) ? 'Theirs — click to take it off them' : 'Given to them on Validate — click again to undo')
          : (t.workers || []).length ? (manual.worker ? 'Click to give it to them instead' : 'Click to take the names off') : '';
}

export function notDone(t, parent) {
  const d = drawer('Cancel this task', t.title);
  let reason = null;
  const row = el('div', 'row');
  const btns = Object.entries(REASON_WORD).map(([v, l]) => {
    const b = el('button', 'toggle', l); b.type = 'button';
    b.setAttribute('aria-pressed', String(v === reason));
    b.onclick = () => { reason = v; btns.forEach(([vv, bb]) => bb.setAttribute('aria-pressed', String(vv === reason))); };
    row.append(b);
    return [v, b];
  });
  const note = el('input', 'input'); note.placeholder = 'Why? (required — the people on the task read it)';
  d.body.append(el('div', 'sec-title', 'Why'), row, note,
    el('div', 'hint', 'Cancelled is a decision: the task shows as cancelled with this reason and note. A task simply not finished on its day shows as Not done by itself. Only the Admin or the people on the task may cancel it.'));
  const cancel = el('button', 'btn', 'Keep it'); cancel.onclick = d.close;
  const ok = el('button', 'btn btn-danger', 'Cancel the task');
  ok.onclick = async () => {
    if (!reason) { toast('Choose why it is cancelled', 'bad'); return; }
    if (!note.value.trim()) { toast('Say why in the note', 'bad'); note.focus(); return; }
    busy(ok, true, 'Saving…');
    try {
      await rpc('skip_task', { p_task: t.id, p_reason: reason, p_note: note.value.trim() || null });
      d.close(); parent?.close(); toast('Cancelled', 'ok'); await load();
    } catch (e) { busy(ok, false, 'Cancel the task'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

export function reassign(task, wk) {
  const d = drawer(task.title, [task.area, longDate(task.date)].filter(Boolean).join(' · '));
  const list = el('div', 'resp');
  const current = new Set(task.hub ? (task.workers.filter(w => onTask(task, w.id)).map(w => w.id)) : task.workers.map(w => w.id));
  const pick = (id, label, hint) => {
    const b = el('button', 'btn' + (current.has(id) ? ' btn-accent' : ''), label);
    b.style.justifyContent = 'flex-start';
    if (id) { b.style.paddingLeft = '6px'; b.prepend(avatar({ worker_id: id, name: label }, 'sm')); }
    b.onclick = async () => {
      d.close();
      try {
        let r = null;
        if (task.hub) {
          const ids = openIds(task);
          if (id) await rpc('assign_tasks', { p_tasks: ids, p_worker: id });
          else await rpc('unassign_tasks', { p_tasks: ids, p_worker: null });
        } else r = await rpc('assign_task', { p_task: task.id, p_worker: id });
        toast((id ? 'Given to ' + label : 'Left for the planner') + alsoBy([r?.just_before?.by]), 'ok');
        await load();
      } catch (e) { toast(e.message, 'bad'); }
    };
    const w = el('div', 'field');
    w.append(b);
    if (hint) w.append(el('div', 'hint', hint));
    list.append(w);
  };
  (wk?.roster || []).forEach(r => {
    const onToday = (r.days || []).includes(((parseYmd(task.date).getDay() + 6) % 7) + 1);
    const pct = Number(r.minutes) ? Math.round((Number(r.planned) / Number(r.minutes)) * 100) : 0;
    pick(r.worker_id, r.name, (onToday ? '' : 'not rostered that day · ') + `${hrs(r.planned)} h planned this week · ${pct}%`);
  });
  pick(null, 'Nobody for now', 'Takes the name off and leaves it for the next draft.');
  d.body.append(list);
  const close = el('button', 'btn', 'Cancel');
  close.onclick = d.close;
  d.footer.append(close);
}
