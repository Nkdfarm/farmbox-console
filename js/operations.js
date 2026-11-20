// ═════════════════════════════════════════════════════════════════════
// Timeline — the operation log (AI build mode P4, migration 0286, console 0.19.00; owner, 20 Nov 2026, docs/ai-build-mode.md).
// Dashboard › Timeline (#/dashboard/timeline). The module is operations.js: timeline.js is the crop planner's.
//
// Every change made through the console's command registry, the assistant's Do it, a person's AI connection (MCP) and
// FarmNet, newest first, one unit at a time: who, the actor, the family, what it did. An AI build is one group, folded
// into a line that opens into its steps. Revert on class A puts it back (a database change through its capture act, a
// FarmNet program or recipe from the copy kept before it); a row changed since refuses it, saying what and by whom.
// Class B offers its compensating action where it makes sense (stop the run you started, resume what you paused),
// otherwise says how; class C is final and shows nothing. A revert is itself a line. Read-only for a member who may not
// write that family (the database decides: may_revert / read_only from public.operations).
// The server writes every row; the registry's hook only has the page read again when it is on screen.
// ═════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, toast, pageHead, emptyState, loading, selectBox, confirmDrawer, drawer, farmWhen } from './ui.js';
import { getCommand, runCommand, setOperationHook, ACTORS_LOGGED } from './registry.js';

const FAMILY = {
  crops: 'Crops & batches', tasks: 'Tasks & procedures', team: 'Team', sales: 'Sales & customers', equipment: 'Equipment',
  water: 'Nutrients & irrigation', climate: 'Climate', harvest: 'Harvests', pests: 'Pests & disease',
  purchasing: 'Purchasing & stock', costs: 'Costs',
};
const PAGE = 100;
const say = e => String(e?.message || e).replace(/^\d+ /, '');
const missing = e => /PGRST202|Could not find the function|does not exist/i.test(say(e));   // 0286 not applied yet
const here = () => (typeof location !== 'undefined' ? (location.hash || '').split('?')[0] : '') || '#/dashboard/timeline';

let farm = null, mount = null, data = null, rows = [], more = false, filters = { person: '', actor: '', family: '', day: '' };

// the registry's hook stays light: the server wrote the row; the Timeline, when it is on screen, reads again (once)
let again = null;
const soon = () => { clearTimeout(again); again = setTimeout(() => { if (mount?.isConnected) load(); }, 800); };
setOperationHook(r => { if (r.status !== 'refused') soon(); });
const open = new Set();   // groups unfolded

export async function renderOperations(container, currentFarm) {
  if (farm?.id !== currentFarm?.id) { filters = { person: '', actor: '', family: '', day: '' }; open.clear(); }
  farm = currentFarm; mount = container;
  await load();
}

async function load(older = false) {
  const at = mount;
  if (!older) { mount.textContent = ''; mount.append(loading('Reading the timeline…')); }
  try {
    const d = await rpc('operations', {
      p_farm: farm.id, p_day: filters.day || null, p_actor: filters.actor || null, p_family: filters.family || null,
      p_person: filters.person || null, p_before: older && rows.length ? rows[rows.length - 1].seq : null, p_limit: PAGE,
    }, { quiet: true });
    if (at !== mount || !at.isConnected) return;
    data = d;
    rows = older ? rows.concat(d.ops || []) : (d.ops || []);
    more = d.ops?.length === PAGE;
    paint();
  } catch (e) {
    if (at !== mount) return;
    mount.textContent = '';
    mount.append(missing(e) ? emptyState('The operation log is not set up on this platform yet.') : el('div', 'note bad', say(e)));
  }
}

// ── the page ────────────────────────────────────────────────────────────────
function paint() {
  mount.textContent = '';
  const refresh = el('button', 'btn btn-sm', 'Refresh');
  refresh.onclick = () => load();
  mount.append(pageHead(null, 'Every change made here, by the assistant, by an AI connection or sent to FarmNet, newest first. ' +
    'Revert puts a change back and is itself a line; a change made since is never overwritten.', refresh));
  mount.append(filterBar());
  if (!rows.length) {
    mount.append(emptyState(Object.values(filters).some(Boolean) ? 'Nothing matches these filters.' : 'Nothing has been done through the log yet.'));
    return;
  }
  const list = el('div', 'op-list');
  const seen = new Set();
  for (const o of rows) {
    if (!o.group_id) { list.append(opRow(o)); continue; }
    if (seen.has(o.group_id)) continue;
    seen.add(o.group_id);
    list.append(groupBlock(o.group_id, rows.filter(x => x.group_id === o.group_id)));
  }
  mount.append(list);
  if (more) {
    const older = el('button', 'btn btn-sm op-older', 'Show older');
    older.onclick = () => { older.disabled = true; load(true); };
    mount.append(older);
  }
}

function filterBar() {
  const bar = el('div', 'op-filters');
  const pick = (key, label, options) => {
    const s = selectBox([['', label], ...options], filters[key]);
    s.setAttribute('aria-label', label);
    s.onchange = () => { filters[key] = s.value; load(); };
    return s;
  };
  const people = (data?.people || []).map(p => [p.id, p.name]);
  const fams = [...new Set([...Object.keys(FAMILY), ...rows.map(r => r.family).filter(Boolean)])].map(f => [f, FAMILY[f] || f]);
  const day = el('input');
  day.type = 'date'; day.value = filters.day; day.setAttribute('aria-label', 'Day');
  day.onchange = () => { filters.day = day.value; load(); };
  bar.append(pick('person', 'Everybody', people), pick('actor', 'Every actor', Object.entries(ACTORS_LOGGED)),
    pick('family', 'Every family', fams), day);
  if (Object.values(filters).some(Boolean)) {
    const clear = el('button', 'btn btn-sm btn-ghost', 'Clear');
    clear.onclick = () => { filters = { person: '', actor: '', family: '', day: '' }; load(); };
    bar.append(clear);
  }
  return bar;
}

// ── one line ────────────────────────────────────────────────────────────────
const titleOf = o => o.command === 'revert' ? (o.summary || 'Put back') : (o.summary || getCommand(o.command)?.label || o.command.replace(/_/g, ' '));

function opRow(o) {
  const row = el('div', 'op-row' + (o.status === 'reverted' ? ' is-reverted' : '') + (o.status === 'failed' ? ' is-failed' : ''));
  const meta = el('div', 'op-meta');
  meta.append(el('span', 'op-when', farmWhen(o.at)), el('span', 'op-who', o.by),
    el('span', 'pill' + (o.actor === 'human' ? '' : ' info'), ACTORS_LOGGED[o.actor] || o.actor));
  if (o.family) meta.append(el('span', 'hint', FAMILY[o.family] || o.family));
  const main = el('div', 'op-main');
  main.append(el('div', 'op-title', titleOf(o)));
  const notes = [];
  if (o.source === 'assistant') notes.push('the assistant’s card');
  if (o.source === 'mcp') notes.push('through the person’s AI connection');
  if (o.source === 'ai-access') notes.push('undone on Team › AI access');
  if (o.source === 'farmnet') notes.push('sent to FarmNet');
  if (o.source === 'ai-build' || (o.source === 'farmnet' && o.actor === 'ai')) notes.push('built by the AI, validated by the person');   // a build's FarmNet steps keep source farmnet (P5)
  if (o.revert_of) notes.push('puts back an earlier change');
  if (o.changes) notes.push(`${o.changes} row${o.changes === 1 ? '' : 's'}`);
  if (notes.length) main.append(el('div', 'hint', notes.join(' · ')));
  if (o.status === 'failed') main.append(el('div', 'op-error', 'Failed: ' + (o.error || 'refused') + ' — nothing was changed.'));
  if (o.status === 'reverted') main.append(el('div', 'hint', `Put back ${farmWhen(o.reverted_at)}`));
  if (o.status === 'waiting') main.append(el('div', 'hint', 'Waits for a manager: nothing was applied, nothing to put back.'));
  const acts = el('div', 'op-acts');
  actionsOf(o).forEach(n => acts.append(n));
  row.append(meta, main, acts);
  return row;
}

function actionsOf(o) {
  if (o.status !== 'done' || o.command === 'revert' || o.revert_class === null) return [];
  if (o.read_only) return [el('span', 'hint', 'Read only')];
  if (o.revert_class === 'A') {
    if (!o.may_revert) return [el('span', 'hint', o.changes === 0 && o.kept ? 'Changed nothing' : 'Cannot be put back from here')];
    const b = el('button', 'btn btn-sm', 'Revert');
    b.onclick = () => revert(o, b);
    return [b];
  }
  if (o.revert_class === 'B') {
    const c = o.compensate;   // decided by the server (operation_detail, its clock, the whole log)
    if (!c) return [el('span', 'hint', undoneBy(o))];
    const b = el('button', 'btn btn-sm', c.label);
    b.onclick = () => compensate(o, b);
    return [b];
  }
  return [el('span', 'hint', 'Final')];
}

// ── class A: put it back ────────────────────────────────────────────────────
const fnPrefix = o => o.command.split('_')[0];
function farmnetUndo(o) {
  const id = o.args?.id;
  if (id == null || !['program', 'formula'].includes(fnPrefix(o))) return null;
  if (o.snapshot_id) return { name: `${fnPrefix(o)}_restore`, args: { id, snapshot: o.snapshot_id }, text: 'FarmNet gets back the copy kept just before this change.' };
  if (o.args?.created != null) return { name: `${fnPrefix(o)}_remove`, args: { id, proId: o.args.created }, text: `FarmNet deletes the ${fnPrefix(o) === 'program' ? 'program' : 'recipe'} ${o.args.created} this made (a copy is kept, to make it again).` };
  return null;
}

const conflictText = c => [c.table ? `${c.table}: ${c.why}` : c.why, c.by ? `by ${c.by}` : null, c.at ? farmWhen(c.at) : null,
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

async function revertOne(o) {
  if (o.source === 'farmnet') {
    const u = farmnetUndo(o);
    if (!u) throw new Error('Nothing was kept to put it back');
    return runCommand(u.name, u.args, { actor: 'human', source: 'timeline', revertOf: o.id, summary: 'Put back: ' + titleOf(o), ctx: { farm } });
  }
  return rpc('revert_operation', { p_op: o.id, p_page: here() });
}

async function revert(o, b) {
  b.disabled = true;
  try {
    const d = await checked(o);
    if (!d) { b.disabled = false; return; }
    const what = o.source === 'farmnet' ? farmnetUndo(o)?.text : `It puts back ${rowsText(d) || 'the rows it touched'} as they were before.`;
    if (!(await confirmDrawer('Put this back?', `${titleOf(o)}. ${what || ''}`, 'Put it back'))) { b.disabled = false; return; }
    await revertOne(o);
    toast('Put back: ' + titleOf(o), 'ok');
  } catch (e) { toast(say(e), 'bad'); }
  soon();
}

// ── a group (an AI build): newest step first, stopping at the first one that cannot be put back ──────────────────
function groupBlock(id, steps) {
  const box = el('div', 'op-group' + (open.has(id) ? ' is-open' : ''));
  const first = steps[steps.length - 1], last = steps[0];
  const head = el('div', 'op-group-head');
  const fold = el('button', 'btn btn-sm btn-ghost', open.has(id) ? '▾' : '▸');
  fold.setAttribute('aria-expanded', String(open.has(id)));
  fold.setAttribute('aria-label', open.has(id) ? 'Fold the steps' : 'Open the steps');
  fold.onclick = () => { if (open.has(id)) open.delete(id); else open.add(id); paint(); };
  const isUndo = steps.every(s => s.command === 'revert' || s.revert_of);
  // counted over the whole log by the server: the page may hold only part of a build
  const g = data?.groups?.[id] || { steps: steps.length, left: steps.filter(s => s.status === 'done' && !s.revert_of).length, reverted: steps.filter(s => s.status === 'reverted').length };
  const n = isUndo ? steps.length : g.steps;
  const text = el('div', 'op-main');
  text.append(el('div', 'op-title', `${isUndo ? 'Put back' : first.actor === 'ai' ? 'AI build' : 'Group'} · ${n} step${n === 1 ? '' : 's'}`),
    el('div', 'hint', `${first.by} · ${farmWhen(first.at)}${last !== first ? ' – ' + farmWhen(last.at) : ''}` +
      (g.reverted ? ` · ${g.reverted} put back` : '') + (steps.length < n ? ` · ${steps.length} on this page` : '')));
  const acts = el('div', 'op-acts');
  if (!isUndo && g.left > 0 && !steps.every(s => s.read_only)) {
    const b = el('button', 'btn btn-sm', 'Revert the build');
    b.onclick = () => revertGroup(id, b);
    acts.append(b);
  }
  head.append(fold, text, acts);
  box.append(head);
  if (open.has(id)) { const inner = el('div', 'op-steps'); steps.forEach(s => inner.append(opRow(s))); box.append(inner); }
  return box;
}

async function revertGroup(id, b) {
  b.disabled = true;
  let left;
  try {
    // every step of the build, from the server (not the loaded, filtered page), newest first
    const gr = await rpc('operation_group', { p_group: id }, { quiet: true });
    left = (gr.steps || []).filter(s => s.status === 'done' && !s.revert_of && s.command !== 'revert');
  } catch (e) { toast(say(e), 'bad'); b.disabled = false; return; }
  if (!left.length) { toast('Nothing of it is left to put back', ''); soon(); return; }
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
        if (s.revert_class !== 'A' || !s.may_revert) { stopped(n, titleOf(s), s.read_only ? 'read only for you' : 'it cannot be put back'); soon(); return; }
        const d = await rpc('operation_detail', { p_op: s.id }, { quiet: true });
        if (d.conflicts?.length) { stopped(n, titleOf(s), d.conflicts.map(conflictText).join('; ')); soon(); return; }
        try { await revertOne(s); n++; } catch (e) { stopped(n, titleOf(s), say(e)); soon(); return; }
      }
      toast(`Put back: ${n} step${n === 1 ? '' : 's'}`, 'ok');
    }
  } catch (e) { toast(say(e), 'bad'); }
  soon();
}
function stopped(n, what, why) {
  const dr = drawer('Stopped', `${n} step${n === 1 ? '' : 's'} put back`);
  dr.body.append(el('p', null, `It stopped at “${what}”: ${why}.`), el('p', 'hint', 'The steps before it stay put back; this one and the older ones are as they were.'));
}

// ── class B: the compensating action, where it makes sense (the server decides: app.op_compensation) ───────────
function undoneBy(o) {
  switch (o.command) {
    case 'fert_program_start': return 'Undone by stopping it on FarmNet › Mixing';
    case 'climate_set': return 'Undone by setting the old values again on FarmNet › Climate';
    case 'irrigation_program_start': case 'irrigation_pause': case 'fert_pause': return 'Over, or changed since';
    default: return 'Nothing to undo: start it again if needed';
  }
}
async function compensate(o, b) {
  b.disabled = true;
  let c;
  try { c = (await rpc('operation_detail', { p_op: o.id }, { quiet: true })).compensate; }   // still the newest, still today?
  catch (e) { toast(say(e), 'bad'); b.disabled = false; return; }
  if (!c) { toast('Not any more: something was started, paused or stopped since, or it is over', ''); soon(); return; }
  if (!(await confirmDrawer(c.label + '?', `${titleOf(o)}. ${c.text}`, c.label))) { b.disabled = false; return; }
  try {
    await runCommand(c.command, c.args, { actor: 'human', source: 'timeline', ctx: { farm } });
    toast(`${c.label}: sent to FarmNet`, 'ok');
  } catch (e) { toast(say(e), 'bad'); }
  soon();
}
