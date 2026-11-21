// ═════════════════════════════════════════════════════════════════════
// What can be done with a line of the operation log (0286): put it back (class A), its compensating action (class B, as
// the server offers it), a whole AI build back — shared by Dashboard › Timeline (operations.js) and the history strip
// under the assistant (op-strip.js), moved out of operations.js for console 0.22.00 (21 Nov 2026), unchanged.
// Also the one operation hook of the registry, handed on to both: setOperationHook keeps one function.
// ═════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, toast, confirmDrawer, drawer, farmWhen } from './ui.js';
import { getCommand, runCommand, setOperationHook } from './registry.js';

export const FAMILY = {
  crops: 'Crops & batches', tasks: 'Tasks & procedures', team: 'Team', sales: 'Sales & customers', equipment: 'Equipment',
  water: 'Nutrients & irrigation', climate: 'Climate', harvest: 'Harvests', pests: 'Pests & disease',
  purchasing: 'Purchasing & stock', costs: 'Costs',
};
export const say = e => String(e?.message || e).replace(/^\d+ /, '');
export const missing = e => /PGRST202|Could not find the function|does not exist/i.test(say(e));   // 0286 not applied yet
export const here = () => (typeof location !== 'undefined' ? (location.hash || '').split('?')[0] : '') || '#/dashboard/timeline';

// the registry's hook, handed on to every listener (the Timeline page, the strip)
const listeners = new Set();
setOperationHook(r => { if (r.status !== 'refused') listeners.forEach(fn => { try { fn(r); } catch (e) { console.warn(e); } }); });
export const onOperation = fn => { listeners.add(fn); return () => listeners.delete(fn); };
// a revert or a compensation goes through rpc (not always the registry): whichever view made it, the other reads again
export const notifyOperations = () => listeners.forEach(fn => { try { fn({ status: 'done', source: 'timeline' }); } catch (e) { console.warn(e); } });
const after = ctx => { notifyOperations(); ctx?.after?.(); };

export const titleOf = o => o.command === 'revert' ? (o.summary || 'Put back') : (o.summary || getCommand(o.command)?.label || String(o.command || '').replace(/_/g, ' '));

export function notesOf(o) {
  const notes = [];
  if (o.source === 'assistant') notes.push('the assistant’s card');
  if (o.source === 'mcp') notes.push('through the person’s AI connection');
  if (o.source === 'ai-access') notes.push('undone on Team › AI access');
  if (o.source === 'farmnet') notes.push('sent to FarmNet');
  if (o.source === 'ai-build' || (o.source === 'farmnet' && o.actor === 'ai')) notes.push('built by the AI, validated by the person');   // a build's FarmNet steps keep source farmnet (P5)
  if (o.revert_of) notes.push('puts back an earlier change');
  if (o.changes) notes.push(`${o.changes} row${o.changes === 1 ? '' : 's'}`);
  return notes;
}

// the buttons (or the words) of one line. ctx: { farm, after() — read again once it is done }
export function actionsOf(o, ctx) {
  if (o.status !== 'done' || o.command === 'revert' || o.revert_class === null) return [];
  if (o.read_only) return [el('span', 'hint', 'Read only')];
  if (o.revert_class === 'A') {
    if (!o.may_revert) return [el('span', 'hint', o.changes === 0 && o.kept ? 'Changed nothing' : 'Cannot be put back from here')];
    const b = el('button', 'btn btn-sm', 'Revert');
    b.onclick = () => revert(o, b, ctx);
    return [b];
  }
  if (o.revert_class === 'B') {
    const c = o.compensate;   // decided by the server (operation_detail, its clock, the whole log)
    if (!c) return [el('span', 'hint', undoneBy(o))];
    const b = el('button', 'btn btn-sm', c.label);
    b.onclick = () => compensate(o, b, ctx);
    return [b];
  }
  return [el('span', 'hint', 'Final')];
}

// ── class A: put it back ────────────────────────────────────────────────────
const fnPrefix = o => o.command.split('_')[0];
export function farmnetUndo(o) {
  const id = o.args?.id;
  if (id == null || !['program', 'formula', 'diy'].includes(fnPrefix(o))) return null;
  // a program setting's DIY (FarmNet › Windows, 0289): the copy kept before it — its periods back, or FarmNet's DIY remove
  // when it was not DIY then (diy_add)
  if (fnPrefix(o) === 'diy') return o.snapshot_id ? { name: 'diy_restore', args: { id, snapshot: o.snapshot_id }, text: 'FarmNet gets back the DIY periods kept just before this change (or the setting its own value again, when it was not DIY then).' } : null;
  if (o.snapshot_id) return { name: `${fnPrefix(o)}_restore`, args: { id, snapshot: o.snapshot_id }, text: 'FarmNet gets back the copy kept just before this change.' };
  if (o.args?.created != null) return { name: `${fnPrefix(o)}_remove`, args: { id, proId: o.args.created }, text: `FarmNet deletes the ${fnPrefix(o) === 'program' ? 'program' : 'recipe'} ${o.args.created} this made (a copy is kept, to make it again).` };
  return null;
}

export const conflictText = c => [c.table ? `${c.table}: ${c.why}` : c.why, c.by ? `by ${c.by}` : null, c.at ? farmWhen(c.at) : null,
  c.what && c.what !== c.why?.replace(/^changed since: /, '') ? c.what : null].filter(Boolean).join(' — ');

function showConflicts(o, d) {
  const dr = drawer('It cannot be put back', titleOf(o));
  dr.body.append(el('p', null, 'Something it changed was changed again since. Putting it back would overwrite that, so nothing is done:'));
  const ul = el('ul', 'op-conflicts');
  d.conflicts.forEach(c => ul.append(el('li', null, conflictText(c))));
  dr.body.append(ul, el('p', 'hint', 'Put the later change back first, or change it by hand.'));
}

async function checked(o) {
  const d = await rpc('operation_detail', { p_op: o.id }, { quiet: true });
  if (d.conflicts?.length) { showConflicts(o, d); return null; }
  if (!d.may_revert) { toast('It cannot be put back any more', 'bad'); return null; }
  return d;
}

const rowsText = d => (d.rows || []).map(r => `${r.table}: ${r.n} ${r.op === 'INSERT' ? 'added' : r.op === 'DELETE' ? 'removed' : 'changed'}`).join(', ');

// the FarmBox a line was made on (operation_detail and operation_group give farm_id): a build of sister units has steps on
// another unit than the one open, and FarmNet's put-back must go to that unit's controller (send() reads only farm.id)
export const farmOfOp = (o, farm) => (o?.farm_id && o.farm_id !== farm?.id ? { id: o.farm_id } : farm);

export async function revertOne(o, farm) {
  if (o.source === 'farmnet') {
    const u = farmnetUndo(o);
    if (!u) throw new Error('Nothing was kept to put it back');
    return runCommand(u.name, u.args, { actor: 'human', source: 'timeline', revertOf: o.id, summary: 'Put back: ' + titleOf(o), ctx: { farm: farmOfOp(o, farm) } });
  }
  return rpc('revert_operation', { p_op: o.id, p_page: here() });
}

async function revert(o, b, ctx) {
  b.disabled = true;
  try {
    const d = await checked(o);
    if (!d) { b.disabled = false; return; }
    const what = o.source === 'farmnet' ? farmnetUndo(o)?.text : `It puts back ${rowsText(d) || 'the rows it touched'} as they were before.`;
    if (!(await confirmDrawer('Put this back?', `${titleOf(o)}. ${what || ''}`, 'Put it back'))) { b.disabled = false; return; }
    await revertOne(o, ctx.farm);
    toast('Put back: ' + titleOf(o), 'ok');
  } catch (e) { toast(say(e), 'bad'); }
  after(ctx);
}

// ── a group (an AI build): newest step first, stopping at the first one that cannot be put back ──────────────────
export async function revertGroup(id, b, ctx) {
  b.disabled = true;
  let left;
  try {
    // every step of the build, from the server (not the loaded, filtered page), newest first
    const gr = await rpc('operation_group', { p_group: id }, { quiet: true });
    left = (gr.steps || []).filter(s => s.status === 'done' && !s.revert_of && s.command !== 'revert');
  } catch (e) { toast(say(e), 'bad'); b.disabled = false; return; }
  if (!left.length) { toast('Nothing of it is left to put back', ''); after(ctx); return; }
  if (!(await confirmDrawer('Put the whole build back?', `${left.length} step${left.length === 1 ? '' : 's'}, newest first. It stops at the first step that cannot be put back (one changed since) and says which; the steps before it stay put back.`, 'Put it back'))) { b.disabled = false; return; }
  try {
    if (!left.some(s => s.source === 'farmnet')) {
      const r = await rpc('revert_group', { p_group: id, p_page: here() });
      if (r.stopped_at) stopped(r.reverted, r.stopped_at.summary, r.stopped_at.why);
      else toast(`Put back: ${r.reverted} step${r.reverted === 1 ? '' : 's'}`, 'ok');
    } else {
      // FarmNet steps go through the function: step by step, newest first, the same stop at the first refusal
      let n = 0;
      for (const s of left) {   // the server's steps, newest first
        if (s.revert_class !== 'A' || !s.may_revert) { stopped(n, titleOf(s), s.read_only ? 'read only for you' : 'it cannot be put back'); after(ctx); return; }
        const d = await rpc('operation_detail', { p_op: s.id }, { quiet: true });
        if (d.conflicts?.length) { stopped(n, titleOf(s), d.conflicts.map(conflictText).join('; ')); after(ctx); return; }
        // the step's own unit (a build of sister units), not the one open on the Timeline
        try { await revertOne(s, { id: s.farm_id || ctx.farm?.id }); n++; } catch (e) { stopped(n, titleOf(s), say(e)); after(ctx); return; }
      }
      toast(`Put back: ${n} step${n === 1 ? '' : 's'}`, 'ok');
    }
  } catch (e) { toast(say(e), 'bad'); }
  after(ctx);
}
export function stopped(n, what, why) {
  const dr = drawer('Stopped', `${n} step${n === 1 ? '' : 's'} put back`);
  dr.body.append(el('p', null, `It stopped at “${what}”: ${why}.`), el('p', 'hint', 'The steps before it stay put back; this one and the older ones are as they were.'));
}

// ── class B: the compensating action, where it makes sense (the server decides: app.op_compensation) ───────────
export function undoneBy(o) {
  switch (o.command) {
    case 'fert_program_start': return 'Undone by stopping it on FarmNet › Mixing';
    case 'climate_set': return 'Undone by setting the old values again on FarmNet › Climate';
    case 'irrigation_program_start': case 'irrigation_pause': case 'fert_pause': return 'Over, or changed since';
    default: return 'Nothing to undo: start it again if needed';
  }
}
async function compensate(o, b, ctx) {
  b.disabled = true;
  let c;
  try { c = (await rpc('operation_detail', { p_op: o.id }, { quiet: true })).compensate; }   // still the newest, still today?
  catch (e) { toast(say(e), 'bad'); b.disabled = false; return; }
  if (!c) { toast('Not any more: something was started, paused or stopped since, or it is over', ''); after(ctx); return; }
  if (!(await confirmDrawer(c.label + '?', `${titleOf(o)}. ${c.text}`, c.label))) { b.disabled = false; return; }
  try {
    await runCommand(c.command, c.args, { actor: 'human', source: 'timeline', ctx: { farm: farmOfOp(o, ctx.farm) } });
    toast(`${c.label}: sent to FarmNet`, 'ok');
  } catch (e) { toast(say(e), 'bad'); }
  after(ctx);
}
