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
import { el, pageHead, emptyState, loading, selectBox, farmWhen } from './ui.js';
import { ACTORS_LOGGED } from './registry.js';
// what a line can do (Revert, the compensating action, Revert the build) is shared with the history strip (0.22.00)
import { FAMILY, say, missing, titleOf, notesOf, actionsOf, revertGroup, onOperation } from './op-actions.js';

const PAGE = 100;

let farm = null, mount = null, data = null, rows = [], more = false, filters = { person: '', actor: '', family: '', day: '' };

// the registry's hook stays light: the server wrote the row; the Timeline, when it is on screen, reads again (once)
let again = null;
const soon = () => { clearTimeout(again); again = setTimeout(() => { if (mount?.isConnected) load(); }, 800); };
onOperation(() => soon());
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

function opRow(o) {
  const row = el('div', 'op-row' + (o.status === 'reverted' ? ' is-reverted' : '') + (o.status === 'failed' ? ' is-failed' : ''));
  const meta = el('div', 'op-meta');
  meta.append(el('span', 'op-when', farmWhen(o.at)), el('span', 'op-who', o.by),
    el('span', 'pill' + (o.actor === 'human' ? '' : ' info'), ACTORS_LOGGED[o.actor] || o.actor));
  if (o.family) meta.append(el('span', 'hint', FAMILY[o.family] || o.family));
  const main = el('div', 'op-main');
  main.append(el('div', 'op-title', titleOf(o)));
  const notes = notesOf(o);
  if (notes.length) main.append(el('div', 'hint', notes.join(' · ')));
  if (o.status === 'failed') main.append(el('div', 'op-error', 'Failed: ' + (o.error || 'refused') + ' — nothing was changed.'));
  if (o.status === 'reverted') main.append(el('div', 'hint', `Put back ${farmWhen(o.reverted_at)}`));
  if (o.status === 'waiting') main.append(el('div', 'hint', 'Waits for a manager: nothing was applied, nothing to put back.'));
  const acts = el('div', 'op-acts');
  actionsOf(o, { farm, after: soon }).forEach(n => acts.append(n));
  row.append(meta, main, acts);
  return row;
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
    b.onclick = () => revertGroup(id, b, { farm, after: soon });
    acts.append(b);
  }
  head.append(fold, text, acts);
  box.append(head);
  if (open.has(id)) { const inner = el('div', 'op-steps'); steps.forEach(s => inner.append(opRow(s))); box.append(inner); }
  return box;
}
