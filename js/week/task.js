// the task drawer and the hub drawer
import { drawer, el, subFamilyTag, sowingLine, busy, toast, confirmDrawer } from '../ui.js';
import { rpc } from '../api.js';
import { weeks, mondayOf, longDate, hhmm, hrs, PRIO, reasonText, stateMark, S } from './state.js';
import { SLOT_WORD, slotOf, unitOf, bandOf, timeOf, heldBy, unitMark, timeWord, SLOTS, openIds } from './data.js';
import { workedBy, secondReports, positionsLine } from './chip.js';
import { repeatsWord, deleteHand, notDone, reassign } from './actions.js';
import { load } from './index.js';

// ── one task: the facts and the actions ────────────────────────────────────
export function openTask(t) {
  if (t.hub) return openHub(t);
  const wk = weeks.get(mondayOf(t.date)) || S.data;
  const d = drawer(t.title, [longDate(t.date), SLOT_WORD[slotOf(t)] + (hhmm(t.due_time) ? ' · ' + hhmm(t.due_time) : ''), t.area].filter(Boolean).join(' · '));
  const facts = el('div', 'facts');
  const fact = (k, v) => { const f = el('div', 'fact'); f.append(el('span', 'fact-k', k)); const val = el('span', 'fact-v'); if (v instanceof Node) val.append(v); else val.textContent = v ?? '—'; f.append(val); facts.append(f); };
  if (t.withholding_until && t.status !== 'done') d.body.append(el('div', 'note bad', `Do not harvest before ${longDate(t.withholding_until)} — a treatment on this crop is in its withholding period. Move this task, or check the case in Scouting.`));
  if (unitOf(t)) { const um = unitMark(t, true); const w = el('span'); w.append(um, ' ' + unitOf(t).name); fact('Unit', w); }
  fact('Sub-family', subFamilyTag(t.category || t.family));
  fact('Family', t.family);
  if (t.crop) fact('Crop', t.crop);
  fact('When', SLOT_WORD[slotOf(t)] + (slotOf(t) === 'any' ? ' · drawn in the ' + SLOT_WORD[bandOf(t)].toLowerCase() : ''));
  fact('Takes', hrs(t.minutes) + ' h');
  { const tw = timeWord(t); if (tw) fact('Worked', tw.text + (timeOf(t)?.running ? ' · the timer is running on the phone' : '')); }
  if (((timeOf(t) || {}).by || []).length > 1 || timeOf(t)?.running) fact('By', workedBy(t));
  if ((t.also_sent || []).length) d.body.append(el('div', 'note warn', secondReports(t)));
  fact('Priority', (PRIO[t.priority] || ['', t.priority])[1]);
  fact('Status', t.status === 'done' ? 'Done' + (t.done_at ? ' · ' + new Date(t.done_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + (t.closed_by ? ' · ' + t.closed_by : '')
    : t.status === 'skipped' ? 'Cancelled · ' + reasonText(t.skip_reason) + (t.skip_note ? ' — ' + t.skip_note : '') + (t.closed_by ? ' · ' + t.closed_by : '')
    : 'Planned · ' + t.status.replace('_', ' '));
  fact('Who', t.workers.length ? t.workers.map(w => w.name).join(', ') : 'nobody yet');
  if (t.harvest_kg != null) fact('Harvested', `${Number(t.harvest_kg)} kg`);
  if (t.hand) fact('Added by hand', repeatsWord(t.hand));
  d.body.append(facts);
  const pos = positionsLine(t);
  if (pos) {
    const zones = [...new Set(t.positions.map(p => p.zone).filter(Boolean))];
    const items = t.positions.every(p => p.kind && p.kind !== 'position');
    d.body.append(el('div', 'sec-title', (items ? 'Items' : 'Positions') + (zones.length > 1 ? ' · ' + zones.join(', ') : '')));
    pos.className = ''; d.body.append(pos);
    // the crop's sowing figures, once per crop, when the task is a sowing or nursery one (0074)
    const sow = new Map();
    t.positions.forEach(p => { if (p.sowing && !sow.has(p.crop || '')) sow.set(p.crop || '', p.sowing); });
    if (sow.size) {
      const box = el('div', 'hint');
      box.textContent = [...sow.entries()].map(([crop, x]) => (crop ? crop + ': ' : '') + sowingLine(x)).join('  ·  ');
      d.body.append(box);
    }
  }

  const mayPlan = wk?.may_plan;
  if (t.status !== 'done' && t.status !== 'skipped' && mayPlan) {
    // move this one task to the other half of the day (the procedure sets the default)
    const mv = el('div', 'acts');
    SLOTS.filter(x => x !== slotOf(t)).forEach(x => {
      const b = el('button', 'btn btn-sm btn-ghost', 'Move to ' + SLOT_WORD[x].toLowerCase());
      b.onclick = async () => {
        busy(b, true, 'Moving…');
        try { await rpc('set_task_slot', { p_task: t.id, p_slot: x }); d.close(); toast(`Moved to the ${SLOT_WORD[x].toLowerCase()}`, 'ok'); await load(); }
        catch (e) { busy(b, false, 'Move'); toast(e.message, 'bad'); }
      };
      mv.append(b);
    });
    d.body.append(mv);
  }
  // held by somebody on a phone (0.7.205): a manager frees it — their timer stops, the next person may open it
  if (heldBy(t) && wk?.may_plan) {
    d.body.append(el('div', 'note', `${heldBy(t)} has this task open on the phone: nobody else can open it until it is finished, handed over or released.`));
    const rl = el('button', 'btn', 'Release');
    rl.title = `Take the task back from ${heldBy(t)}`;
    rl.onclick = async () => {
      busy(rl, true, 'Releasing…');
      try { await rpc('release_task', { p_task: t.id }); d.close(); toast('Released — anybody can open it now', 'ok'); await load(); }
      catch (e) { busy(rl, false, 'Release'); toast(e.message, 'bad'); }
    };
    d.footer.append(rl);
  }
  if (t.status === 'done' || t.status === 'skipped') {
    // back to planned: the task's people, or a manager
    const re = el('button', 'btn', 'Reopen');
    re.onclick = async () => {
      busy(re, true, 'Reopening…');
      try { await rpc('reopen_task', { p_task: t.id }); d.close(); toast('Reopened', 'ok'); await load(); }
      catch (e) { busy(re, false, 'Reopen'); toast(e.message, 'bad'); }
    };
    d.footer.append(re);
  }
  // a task added by hand goes the way it came (0262): this one, or this one and the later ones
  if (t.hand && wk?.may_add_tasks && (t.hand.every_days || (t.status !== 'done' && t.status !== 'skipped'))) {
    const del = el('button', 'btn btn-danger', 'Delete…');
    del.onclick = () => deleteHand(t, d);
    d.footer.append(del);
  }
  if (t.status !== 'done' && t.status !== 'skipped') {
    // cancelled, with a reason and a note — the Admin or the task's own people (0100, 0168)
    const nd = el('button', 'btn', 'Cancel this task…');
    nd.onclick = () => notDone(t, d);
    d.footer.append(nd);
  }
  if (t.status !== 'done' && t.status !== 'skipped') {
    if (mayPlan) {
      const ch = el('button', 'btn', 'Change who');
      ch.onclick = () => { d.close(); reassign(t, wk); };
      d.footer.append(ch);
    }
    const done = el('button', 'btn btn-primary', 'Mark done');
    done.onclick = async () => {
      if (!await confirmDrawer('Mark done?', `"${t.title}" on ${longDate(t.date)} — done without its checklist. The phone is where a checklist is run; this is for work done and not recorded.`, 'Mark done')) return;
      busy(done, true, 'Saving…');
      try {
        await rpc('complete_task', { p_task: t.id, p_minutes: null });
        d.close(); toast('Done ✓', 'ok'); await load();
      } catch (e) { busy(done, false, 'Mark done'); toast(e.message, 'bad'); }
    };
    d.footer.append(done);
  }
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

// the daily scouting's card: its zones, each with its own task, and one "Change who" for all of them
function openHub(t) {
  const wk = weeks.get(mondayOf(t.date)) || S.data;
  const d = drawer(t.title, [longDate(t.date), SLOT_WORD[slotOf(t)], t.area].filter(Boolean).join(' · '));
  const facts = el('div', 'facts');
  const fact = (k, v) => { const f = el('div', 'fact'); f.append(el('span', 'fact-k', k)); const val = el('span', 'fact-v'); if (v instanceof Node) val.append(v); else val.textContent = v ?? '—'; f.append(val); facts.append(f); };
  if (unitOf(t)) { const um = unitMark(t, true); const w = el('span'); w.append(um, ' ' + unitOf(t).name); fact('Unit', w); }
  fact('Sub-family', subFamilyTag(t.category || t.family));
  const doneN = t.all.filter(m => m.status === 'done').length;
  fact('Zones', `${t.all.length} · one task a zone · ${doneN} done`);
  fact('Takes', hrs(t.all.reduce((a, m) => a + Number(m.minutes || 0), 0)) + ' h');
  { const tw = timeWord({ ...t, members: t.all }); if (tw) fact('Worked', tw.text); }
  if (workedBy({ ...t, members: t.all })) fact('By', workedBy({ ...t, members: t.all }));
  if ((t.also_sent || []).length) d.body.append(el('div', 'note warn', secondReports(t)));
  fact('Who', t.workers.length ? t.workers.map(w => w.name).join(', ') + (t.nobody ? ` · ${t.nobody} zone${t.nobody === 1 ? '' : 's'} with nobody` : '') : 'nobody yet');
  d.body.append(facts);
  d.body.append(el('div', 'sec-title', 'The zones'));
  const list = el('div', 'tk-hub-list');
  t.all.forEach(m => {
    const r = el('button', 'tk-hub-row'); r.type = 'button';
    r.append(stateMark(m), el('b', null, m.area || '—'));
    r.append(el('span', 'hint', (m.workers || []).length ? m.workers.map(w => w.name).join(', ') : 'nobody yet'));
    const tw = timeWord(m); r.append(el('span', 'tk-time ' + (tw?.cls || ''), tw ? tw.text : hrs(m.minutes) + ' h'));
    r.onclick = () => { d.close(); openTask(m); };
    list.append(r);
  });
  d.body.append(list);
  d.body.append(el('div', 'hint', 'The scouting is one task a zone on the phone, the report and the hours; here the day is one card. Change who gives every open zone to one person; open a zone for its own task.'));
  const mayPlan = wk?.may_plan;
  if (openIds(t).length && mayPlan) {
    const ch = el('button', 'btn btn-primary', 'Change who');
    ch.onclick = () => { d.close(); reassign(t, wk); };
    d.footer.append(ch);
  }
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}
