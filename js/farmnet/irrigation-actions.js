// FarmNet › Irrigation: the quick actions around programs and recipes (owner, 20 Nov 2026: "a copy button to duplicate a
// program or recipe, a small cross on the top right corner on the program or recipe when highlighted by the pointer to
// delete it directly, … the recipes could be assigned to programmes by drag and drop (with message alerts)", and the
// restore proposed with them, "Yes build everything"):
//   copyThing     Copy… — a name, then the function's program_copy / formula_copy (a program comes switched off)
//   quickDelete   the ✕ — the same blocks as the drawer's Delete… (a program switched on or running, a recipe in use),
//                 then a red confirm; the function checks FarmNet again before deleting
//   assignRecipe  a recipe dropped on a program's row — refused for a program on clear water, asks which water source
//                 when there are two, says what changes, then program_set { recipes }
//   historyOf     a program's or recipe's earlier states, kept by the function before each change (0283), each with
//                 Restore — in place, its on/off as it is now
//   deletedList   the programs and recipes deleted here, with Restore — made again, a program switched off
// The function decides: every block here is said first in the console, and checked again on FarmNet.
import { rpc } from '../api.js';
import { el, drawer, toast, busy, confirmDrawer, farmLocal } from '../ui.js';
import { bad, num, send } from './shell.js';
import { openProgram } from './programs.js';
import { openRecipe } from './recipes.js';

const when = at => farmLocal(at).replace('T', ' ').slice(0, 16);
const WHAT = {
  program_set: 'changed', formula_set: 'changed', program_remove: 'deleted', formula_remove: 'deleted',
  program_restore: 'put back', formula_restore: 'put back',
};
const nameOk = n => n.length > 0 && n.length <= 40 && !/[\u0000-\u001f<>]/.test(n);

// ── Copy… ───────────────────────────────────────────────────────────────────────────────────────────────────
export function copyThing(ctx, c, kind, obj, existingNames, recipes, after) {
  const what = kind === 'program' ? 'program' : 'recipe';
  const d = drawer(`Copy "${obj.NM}"`, `${c.name} · a new ${what} with the same settings${kind === 'program' ? ', switched off' : ''}`);
  const name = el('input', 'input'); name.maxLength = 40;
  let n0 = `${obj.NM} (copy)`.slice(0, 40), k = 2;
  while ((existingNames || []).some(x => String(x).trim().toLowerCase() === n0.toLowerCase())) n0 = `${obj.NM} (copy ${k++})`.slice(0, 40);
  name.value = n0;
  const f = el('div', 'field'); f.append(el('label', null, 'Name of the copy'), name);
  d.body.append(f, el('div', 'hint', kind === 'program'
    ? 'Its times, days, water sources, valves and recipe are copied. It stays off until you switch it on.'
    : 'Its EC and pH targets, channels and mixing settings are copied. No program uses it until you choose it.'));
  const go = el('button', 'btn btn-primary', 'Copy it');
  go.onclick = async () => {
    const n = name.value.trim();
    if (!nameOk(n)) { toast('A name of 1 to 40 characters, without < or >', 'bad'); name.focus(); return; }
    if ((existingNames || []).some(x => String(x).trim().toLowerCase() === n.toLowerCase())) { toast(`A ${what} "${n}" exists already`, 'bad'); return; }
    busy(go, true, 'Copying…');
    let res;
    try { res = await send(ctx.farm, kind === 'program' ? 'program_copy' : 'formula_copy', { id: c.id, proId: obj.ID }, { name: n }); }
    catch (e) {
      // FarmNet may have made it all the same: no second one from here
      d.body.append(el('div', 'note bad', `${e.message}. FarmNet may have made the ${what} all the same: look for it on the page before copying again.`));
      busy(go, false, 'Copy it'); go.disabled = true; (after || ctx.redraw)(); return;
    }
    d.close();
    toast(`"${n}" made on FarmNet${kind === 'program' ? ', switched off' : ''}`, 'ok');
    if (res?.warning) toast(res.warning, 'bad');
    const id = Number(res?.created ?? res?.data?.ID);
    const done = after || ctx.redraw;
    if (!Number.isInteger(id)) { done(); return; }
    if (kind === 'program') openProgram(ctx, c, { ID: id, NM: n }, recipes, undefined, done);
    else openRecipe(ctx, c, { ID: id, NM: n }, [], done);
  };
  d.footer.append(go);
  setTimeout(() => { name.focus(); name.select(); }, 50);
}

// ── the ✕ ───────────────────────────────────────────────────────────────────────────────────────────────────
// info: a program { on, running } as the page read it; a recipe { users: [names] }
export async function quickDelete(ctx, c, kind, obj, info) {
  if (kind === 'program') {
    if (info.on) { toast(`"${obj.NM}" is switched on: open it, untick "Program on", save, then delete it`, 'bad'); return; }
    if (info.running) { toast(`"${obj.NM}" is running or waiting to run now: stop it before deleting it`, 'bad'); return; }
  } else if (info.users?.length) {
    const mixOnly = info.users.every(u => / \(mixing\)$|^a mixer now$/.test(u));
    toast(`"${obj.NM}" is used by ${info.users.join(', ')}: ${mixOnly ? 'change that on FarmNet\'s mixer first' : `choose another recipe for ${info.users.length === 1 ? 'it' : 'them'} first`}`, 'bad'); return;
  }
  const ok = await confirmDrawer(`Delete "${obj.NM}" on FarmNet?`,
    kind === 'program'
      ? 'The program, its start times and its valves are deleted on FarmNet. A copy is kept here: it can be made again from "Deleted" below the runs.'
      : 'The recipe is deleted on FarmNet. FarmNet is checked first: if any irrigation or mixing program uses it, nothing is deleted. A copy is kept here: it can be made again from "Deleted".',
    'Delete it', true);
  if (!ok) return;
  try {
    await send(ctx.farm, kind === 'program' ? 'program_remove' : 'formula_remove', { id: c.id, proId: obj.ID });
    toast(`"${obj.NM}" deleted on FarmNet`, 'ok');
  } catch (e) { toast(e.message, 'bad'); return; }
  ctx.redraw();
}

// ── a recipe dropped on a program ───────────────────────────────────────────────────────────────────────────
export async function assignRecipe(ctx, c, p, par, r, recipes) {
  if (!par || !Array.isArray(par.SRC)) { toast(`FarmNet did not give "${p.NM}" in full: open it to choose its recipe`, 'bad'); return; }
  const srcs = par.SRC.filter(s => s && s.FF !== false);
  if (!srcs.length) {
    const water = par.SRC.map(s => s.SNM).filter(Boolean).join(', ') || 'no water source yet';
    toast(par.SRC.length ? `"${p.NM}" runs clear water (${water}): it mixes no recipe` : `"${p.NM}" has no water source yet: open it and add one`, 'bad');
    return;
  }
  let src = srcs[0];
  if (srcs.length > 1) {
    src = await new Promise(resolve => {
      const d = drawer(`Which water of "${p.NM}"?`, 'It has more than one water source that mixes a recipe', { onClose: () => resolve(null) });
      srcs.forEach(s => {
        const b = el('button', 'btn', `${s.SNM || 'Water source ' + s.SID} — now ${nameOf(recipes, s.FID)}`); b.type = 'button';
        b.onclick = () => { resolve(s); d.close(); };
        d.body.append(b);
      });
    });
    if (!src) return;
  }
  if (Number(src.FID) === Number(r.ID)) { toast(`"${p.NM}" mixes "${r.NM}" already`); return; }
  const on = num(par.EN?.V ?? par.EN) !== 0;
  const ok = await confirmDrawer(`"${p.NM}" mixes "${r.NM}"?`,
    `"${p.NM}" will mix "${r.NM}" instead of ${nameOf(recipes, src.FID)}${srcs.length > 1 ? ` for ${src.SNM}` : ''}, from its next start.`
      + (on ? ' It is switched on: its next run already uses the new recipe.' : ' It is switched off: nothing runs until it is switched on.'),
    'Change it');
  if (!ok) return;
  try {
    await send(ctx.farm, 'program_set', { id: c.id, proId: p.ID }, { recipes: [{ sid: Number(src.SID), fid: Number(r.ID) }] });
    toast(`"${p.NM}" now mixes "${r.NM}"`, 'ok');
  } catch (e) { toast(e.message, 'bad'); return; }
  ctx.redraw();
}
const nameOf = (recipes, id) => (Number(id) === -1 || id === undefined ? 'no recipe' : `"${(recipes || []).find(x => Number(x.ID) === Number(id))?.NM || 'recipe #' + id}"`);

// ── earlier states, with Restore ────────────────────────────────────────────────────────────────────────────
const listOf = (ctx, c, kind, object, limit) =>
  rpc('farmnet_snapshots', { p_farm: ctx.farm.id, p_centre: c.id, p_kind: kind, p_object: object ?? null, p_limit: limit }, { quiet: true });

async function restore(ctx, c, kind, s, inPlace, after) {
  const ok = await confirmDrawer(inPlace ? `Put "${s.name}" back as it was?` : `Make "${s.name}" again?`,
    inPlace
      ? `"${s.name}" becomes as it was on ${when(s.at)}, before it was ${WHAT[s.action] || 'changed'} by ${s.by}.${kind === 'program' ? ' Its on/off stays as it is now.' : ''} What it is now is kept too: this can be undone the same way.`
      : `FarmNet makes a new ${kind} with the settings "${s.name}" had on ${when(s.at)}${kind === 'program' ? ', switched off' : ''}. It gets a new number.`,
    inPlace ? 'Put it back' : 'Make it again');
  if (!ok) return false;
  try {
    const res = await send(ctx.farm, kind === 'program' ? 'program_restore' : 'formula_restore', { id: c.id, snapshot: s.id });
    toast(res?.restored !== undefined ? `"${s.name}" put back` : `"${s.name}" made again (number ${res?.created ?? '?'})${kind === 'program' ? ', switched off' : ''}`, 'ok');
    if (res?.warning) toast(res.warning, 'bad');
  } catch (e) { toast(e.message, 'bad'); return false; }
  (after || ctx.redraw)();
  return true;
}

// a folded "History" in a drawer: the earlier states of this program or recipe
export function historyOf(ctx, c, kind, obj, close) {
  const box = el('details', 'ir-section ir-history');
  box.append(el('summary', 'hint', 'History — earlier states kept here, to put back'));
  let loaded = false;
  box.ontoggle = async () => {
    if (!box.open || loaded) return;
    loaded = true;
    const list = el('div', 'ir-history-list'); box.append(list);
    list.append(el('div', 'hint', 'Reading…'));
    let rows;
    try { rows = await listOf(ctx, c, kind, obj.ID, 30); }
    catch (e) { list.replaceChildren(bad(`The history could not be read: ${e.message}`)); return; }
    list.textContent = '';
    if (!rows?.length) { list.append(el('div', 'hint', 'Nothing kept yet: a state is kept each time it is changed here.')); return; }
    rows.forEach(s => {
      const r = el('div', 'fc-param');
      r.append(el('span', null, `${when(s.at)} · before it was ${WHAT[s.action] || s.action} · ${s.by}`), el('span', 'hint', s.name || ''));
      // its number deleted at or after this state: it may carry another one now, so it is made again, never put in place
      // (the function decides the same way)
      const removedAfter = rows.some(x => /_remove$/.test(x.action) && String(x.at) >= String(s.at));
      if (ctx.may && s.made_again != null) r.append(el('span', 'hint', `made again as ${s.made_again}`));
      else if (ctx.may) {
        const b = el('button', 'btn btn-sm', removedAfter ? 'Make again…' : 'Restore…'); b.type = 'button';
        b.onclick = async () => { b.disabled = true; if (await restore(ctx, c, kind, s, !removedAfter, () => { close(); ctx.redraw(); })) return; b.disabled = false; };
        r.append(b);
      } else r.append(el('span'));
      list.append(r);
    });
  };
  return box;
}

// a folded "Deleted" on the page: what was deleted here and is not on FarmNet now
export function deletedList(ctx, c, presentPrograms, presentRecipes) {
  const box = el('details', 'ir-runs ir-deleted');
  const sum = el('summary', 'fc-head fc-subhead'); sum.append(el('h4', 'fc-sub', 'Deleted'), el('div', 'spacer'), el('span', 'hint', 'kept here, to make again'));
  box.append(sum);
  let loaded = false;
  box.ontoggle = async () => {
    if (!box.open || loaded) return;
    loaded = true;
    const list = el('div'); box.append(list);
    let rows;
    try { rows = await listOf(ctx, c, null, null, 200); }
    catch (e) { list.append(bad(`The list could not be read: ${e.message}`)); return; }
    const seen = new Set();
    const gone = (rows || []).filter(s => /_remove$/.test(s.action) && (s.made_again === null || s.made_again === undefined)).filter(s => {
      const key = `${s.kind}|${s.object_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return !(s.kind === 'program' ? presentPrograms : presentRecipes).has(Number(s.object_id));
    });
    if (!gone.length) { list.append(el('div', 'hint', 'Nothing deleted here.')); return; }
    gone.forEach(s => {
      const r = el('div', 'fc-param');
      r.append(el('span', null, `${s.kind === 'program' ? 'Program' : 'Recipe'} "${s.name}"`), el('span', 'hint', `deleted ${when(s.at)} by ${s.by}`));
      if (ctx.may) {
        const b = el('button', 'btn btn-sm', 'Make again…'); b.type = 'button';
        b.onclick = async () => { b.disabled = true; if (!(await restore(ctx, c, s.kind, s, false))) b.disabled = false; };
        r.append(b);
      } else r.append(el('span'));
      list.append(r);
    });
  };
  return box;
}
