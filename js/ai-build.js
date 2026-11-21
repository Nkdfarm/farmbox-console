// ═══════════════════════════════════════════════════════════════════════════
// Creation mode — the executor (AI build mode P5, owner 20 Nov 2026, docs/ai-build-mode.md). The pure part: no DOM, no
// network of its own (everything comes in `deps`), so node runs it with a fake clock (scripts/check-ai-build.mjs).
//
// A plan (the assistant's propose_plan, checked by the function: assistant/plan.ts) is run WITHOUT the model: for each
// step the screen goes to its page, its button (data-cmd) is found and highlighted for a moment, and the step is STAGED
// as a draft — nothing is applied, nothing is sent. A step whose button is not found still stages (the tray says so). A
// step that cannot be staged — its arguments invalid now — goes back to the model once (deps.fix), else the build stops
// with the reason; a family whose Build switch is off on the step's unit (Team › AI permissions) stops it at once.
// Review: the person edits a draft's arguments (checked by the registry), removes one, or discards all. Validate applies
// the drafts in order through runCommand — actor ai, ONE new group, source ai-build, the plan's summary, each on its own
// unit — and stops at the first failure, listing what was applied and what was not: one group on the Timeline (0286).
// 5 minutes without input (pointer or keyboard: deps call touch()) while building or reviewing ends creation mode by
// itself: the drafts are discarded, nothing is applied. The daily cost cap (0287) is read before building.
// The lock can never stay on: Stop leaves building at once (to review, or ended when nothing was staged) whatever the
// step is waiting for; an exception while staging moves to review with what was staged; a step of Validate that does
// not answer within STEP_MS stops it ('unknown': it may have been applied — the Timeline says), the rest not applied.
// Fixes of 21 Nov 2026: the cap's read is raced against BUDGET_MS after the band and the idle clock are up (a hung read
// never holds the console); a draft the person changes gets its line from the command's preview, marked as theirs for the
// operation log, and loses the AI's warnings (a water step is said not to be range-checked again); Validate stops before
// a step when deps.userId() is no longer the person who pressed it; `staged` counts every draft ever staged.
// Nothing here approves, validates, marks done, pays or gives access: the registry's commands cannot (only class A
// commands may be staged, and the server's door refuses the rest for actor ai).
// ═══════════════════════════════════════════════════════════════════════════
import { getCommand, validateArgs } from './registry.js';

export const IDLE_MS = 5 * 60 * 1000;
export const STEP_MS = 45 * 1000;
export const BUDGET_MS = 8 * 1000;   // the daily cap's read before building: a read that hangs ends the build, never holds it
export const PHASES = ['building', 'review', 'validating', 'done', 'ended'];
const LOCKED = new Set(['building', 'review', 'validating']);
export const IDLE_NOTICE = 'Creation mode ended by itself after 5 minutes without input: the drafts were discarded and nothing was applied.';

// a step that creates a program switched on, or switches one on: said on its draft and in the tray before Validate
export const switchesOn = (command, args) => ['program_set', 'program_add', 'program_copy'].includes(command) && args?.changes?.on === true;

// the commands whose EC and pH the assistant checks against the crops' ranges (assistant/water.ts RANGE_COMMANDS): a
// draft of one changed by the person was not checked again (the check needs FarmNet's programs and the crops on the
// valves, read by the function), and its card says so
export const RANGE_COMMANDS = new Set(['formula_set', 'formula_add', 'formula_copy', 'program_set']);
export const EDITED_RANGE_NOTE = 'Changed by you: not checked again against the crops’ EC and pH ranges — compare it with FarmNet › Irrigation › EC and pH per crop before you validate.';
export const EDITED_MARK = ' (changed by the person)';

// ── step references (phase E): "copy it, then set it" in one build ──
// An argument value {"$step": n, "key": "created"} is the number EARLIER step n makes. The key is "created", nothing else:
// what runCommand returns for the commands that make a program or a recipe is the farmnet function's own answer
// (registry-catalogue.js fnSend → farmnet/shell.js send → fn(): the parsed body), which supabase/functions/farmnet/index.ts
// builds as   { data: { ID: <new number> }, created: <new number>, msg, ... }.
// REF_TABLE says which steps make a number (makes) and which argument of which command may take one (takes): a program
// feeds only the program number of a program command, a recipe only the recipe number of a recipe command; and step n is
// on the same unit, where both units are known. It is the same table, with the same rules and the same words, as
// supabase/functions/assistant/plan.ts checkRefs (scripts/check-ai-build.mjs fails when the two tables differ).
// While building nothing is applied, so the reference is only checked (and the draft keeps it, shown as "step n: created");
// it is replaced by the number when Validate reaches the step, and only if step n was applied by then: else the step
// fails, with why.
export const REF_TABLE = {
  "makes": { "program_add": "program", "program_copy": "program", "formula_add": "recipe", "formula_copy": "recipe" },
  "takes": {
    "program_set": { "proId": "program" }, "program_remove": { "proId": "program" }, "program_copy": { "proId": "program" },
    "diy_add": { "proId": "program" }, "diy_edit": { "proId": "program" }, "irrigation_program_start": { "proId": "program" },
    "formula_set": { "proId": "recipe" }, "formula_remove": { "proId": "recipe" }, "formula_copy": { "proId": "recipe" }
  }
};
export const REF_PRODUCERS = Object.keys(REF_TABLE.makes);
const takers = kind => Object.keys(REF_TABLE.takes).filter(x => Object.values(REF_TABLE.takes[x]).includes(kind)).join(', ');
const REF_WHERE = `the program number (proId) of ${takers('program')}, or the recipe number (proId) of ${takers('recipe')}`;
export const isRef = v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '$step');
const refText = v => `step ${v.$step}: ${v.key}`;
// unit: the unit of this step; home: the unit a step without one runs on (the FarmBox open), when known
// → { error } | { args: the arguments with each reference replaced by a stand-in of the right type, for the registry's
// check only, shown: the same with its text, for the preview, refs: how many }
export function checkRefs(command, args, n, steps, unit = null, home = null) {
  const c = getCommand(command);
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : null;
  if (!a || !c) return { args, shown: args, refs: 0 };
  const stand = {}, shown = {};
  let refs = 0;
  const unitOf = u => (typeof u === 'string' && u ? u : home || null);
  for (const [k, v] of Object.entries(a)) {
    if (!isRef(v)) {
      if (v && typeof v === 'object' && JSON.stringify(v).includes('"$step"')) return { error: `${c.label}: a step reference is only allowed as a whole argument, not inside "${k}"` };
      continue;
    }
    refs++;
    const what = `${c.label}: "${k}"`;
    const ref = Number(v.$step);
    if (Object.keys(v).some(x => x !== '$step' && x !== 'key')) return { error: `${what}: a step reference has only $step and key` };
    if (!Number.isInteger(ref) || ref < 1 || ref >= n) return { error: `${what}: it refers to step ${v.$step}, which is not an earlier step (this is step ${n})` };
    if (typeof v.key !== 'string' || !v.key.trim()) return { error: `${what}: the step reference has no key` };
    if (v.key !== 'created') return { error: `${what}: the step reference's key is "created" (the number step ${ref} makes), not "${v.key}"` };
    const takes = REF_TABLE.takes[c.name]?.[k];
    if (!takes) return { error: `${what}: a step reference stands only for ${REF_WHERE}` };
    const src = steps.find(x => x.n === ref);
    const made = src ? REF_TABLE.makes[src.command] : undefined;
    if (!src || !made) return { error: `${what}: step ${ref} is not a step that makes a program or a recipe (${REF_PRODUCERS.join(', ')})` };
    if (made !== takes) return { error: `${what}: step ${ref} makes a ${made}, and "${k}" of ${c.name} is a ${takes} number` };
    const u1 = unitOf(src.unit), u2 = unitOf(unit);
    if (u1 !== u2 && u1 !== null && u2 !== null) return { error: `${what}: step ${ref} is on another unit` };
    stand[k] = Math.max(c.args[k]?.min ?? 0, 0); shown[k] = refText(v);
  }
  return { args: { ...a, ...stand }, shown: { ...a, ...shown }, refs };
}
// Validate: the arguments with each reference replaced by the number step n made (results: Map step number → result)
export function resolveRefs(args, results) {
  if (!args || typeof args !== 'object') return args;
  const out = { ...args };
  for (const [k, v] of Object.entries(args)) {
    if (!isRef(v)) continue;
    if (!results.has(Number(v.$step))) throw new Error(`"${k}" is the ${v.key} of step ${v.$step}, which was not applied: nothing was made to use`);
    const r = results.get(Number(v.$step));
    const x = r !== null && typeof r === 'object' ? r.created : undefined;
    if (typeof x !== 'number' || !Number.isInteger(x)) throw new Error(`"${k}": step ${v.$step} gave no whole number as "created"`);
    out[k] = x;
  }
  return out;
}

// deps: { run(name, args, opts) (the registry's runCommand), farm, farmFor(unit) → the FarmBox to run a step on,
//         navigate(page), locate(name, args) → element | null, highlight(element),
//         fix(step, error) → { ok, step } | { ok: false, error }, mayBuild(family, unit) → true | reason,
//         budget() → { over, text } | null, newId(), now(), setTimer(fn, ms) → handle, clearTimer(handle), onChange(state),
//         stepMs (Validate's wait for one step; STEP_MS), budgetMs (the cap's read; BUDGET_MS),
//         userId() → the person signed in now (Validate stops before a step when it is not the one who pressed it) }
export function createBuild(plan, deps) {
  const steps = (plan?.steps || []).map((s, i) => ({ ...s, n: i + 1 }));
  const home = deps.farm?.id || null;   // the unit a step without one runs on (step references: the same unit)
  // staged: how many drafts were ever staged (end() empties drafts, not this) — the plan counts as built from the first
  const st = { phase: 'building', at: 0, total: steps.length, drafts: [], staged: 0, notice: '', stopped: false, result: null, group: null };
  let timer = null, seq = 0;
  const building = () => st.phase === 'building';
  const tell = () => { try { deps.onChange?.(view()); } catch (e) { console.warn('ai-build: onChange failed', e); } };
  const view = () => ({ ...st, drafts: st.drafts.map(d => ({ ...d })), locked: LOCKED.has(st.phase) });

  // ── the 5 minutes without input ──
  const disarm = () => { if (timer != null) { deps.clearTimer(timer); timer = null; } };
  const arm = () => {
    disarm();
    if (st.phase !== 'building' && st.phase !== 'review') return;
    timer = deps.setTimer(() => { timer = null; if (st.phase === 'building' || st.phase === 'review') end(IDLE_NOTICE, true); }, IDLE_MS);
  };
  function touch() { if (st.phase === 'building' || st.phase === 'review') arm(); }
  function end(notice, idle = false) {
    disarm();
    st.phase = 'ended'; st.drafts = []; st.notice = notice || 'The drafts were discarded: nothing was applied.'; st.idle = idle;
    tell();
  }
  // building is over: review what was staged, or end when nothing was
  function toReview() {
    if (!building()) return;
    if (!st.drafts.length) { end(st.notice || 'Nothing was staged.'); return; }
    st.phase = 'review'; arm(); tell();
  }

  // ── staging one step ── (every await may come back to a build that was stopped or ended meanwhile: then nothing more)
  async function stage(step) {
    const c = getCommand(step.command);
    if (!c) return { stop: `Step ${step.n}: "${step.command}" is not a command of this console.` };
    if (!c.stageable || c.emergency) return { stop: `Step ${step.n}: ${c.label} may only be proposed to a person, never built.` };
    const may = deps.mayBuild ? deps.mayBuild(c.family, step.unit || null) : true;
    if (may !== true) return { stop: `Step ${step.n}: ${typeof may === 'string' ? may : 'the AI may not build this on this FarmBox'}.` };
    let s = step;
    const rc = checkRefs(s.command, s.args, s.n, steps, s.unit, home);
    if (rc.error) return { stop: `Step ${s.n}: ${rc.error}` };
    let v = validateArgs(s.command, rc.args);
    if (!v.ok) {
      // back to the model once
      let f = null;
      try { f = deps.fix ? await deps.fix(s, v.error) : null; } catch (e) { f = { ok: false, error: e?.message || String(e) }; }
      if (!building()) return { gone: true };
      if (!f?.ok || !f.step) return { stop: `Step ${s.n} could not be staged: ${v.error}${f?.error ? ' — the AI could not fix it: ' + f.error : ''}` };
      const fixed = { ...s, ...f.step, n: s.n, unit: s.unit, fixed: true };
      const c2 = getCommand(fixed.command);
      const may2 = c2 && deps.mayBuild ? deps.mayBuild(c2.family, fixed.unit || null) : true;
      const rc2 = checkRefs(fixed.command, fixed.args, fixed.n, steps, fixed.unit, home);
      v = rc2.error ? { ok: false, error: rc2.error }
        : c2 && c2.stageable && !c2.emergency && may2 === true ? validateArgs(fixed.command, rc2.args) : { ok: false, error: 'the fixed step may not be built' };
      if (!v.ok) return { stop: `Step ${s.n} could not be staged, even after a fix: ${v.error}` };
      s = fixed;
    }
    const cmd = getCommand(s.command);
    const page = cmd.pages.includes(s.page) ? s.page : cmd.pages[0];
    try { await deps.navigate?.(page); } catch { /* the page could not be opened: staged all the same */ }
    if (!building()) return { gone: true };
    let el = null;
    try { el = deps.locate ? await deps.locate(s.command, s.args) : null; } catch { el = null; }
    if (!building()) return { gone: true };
    if (el) { try { await deps.highlight?.(el); } catch { /* only a show */ } }
    if (!building()) return { gone: true };
    st.drafts.push({
      id: 'd' + (++seq), n: s.n, command: s.command, family: cmd.family, label: cmd.label, page, unit: s.unit || null, args: s.args,
      summary: s.summary || cmd.label, mark: s.mark || '~', switches_on: switchesOn(s.command, s.args), anchor: !!el, fixed: !!s.fixed,
      reason: s.reason || '', warnings: Array.isArray(s.warnings) ? s.warnings : [], valves: Array.isArray(s.valves) ? s.valves : undefined,   // P6
      status: 'draft', error: null,
    });
    st.staged++;
    return { ok: true };
  }

  // ── building: every step staged in order, without the model ──
  async function start() {
    if (!steps.length) { end('The plan has no step: nothing to build.'); return view(); }
    // the band (with its Stop) and the 5 minutes first: a cap read that never answers must not hold the console
    arm(); tell();
    let b = null;
    try {
      b = deps.budget ? await within(Promise.resolve().then(() => deps.budget()), deps.budgetMs || BUDGET_MS,
        `The daily cost cap could not be read within ${Math.round((deps.budgetMs || BUDGET_MS) / 1000)} s: nothing is built. Try again.`) : null;
    } catch (e) { b = { over: true, text: e?.message || 'The daily cost cap could not be read: nothing is built.' }; }
    if (!building()) return view();
    if (b && b.over) { end(b.text || 'The daily cost cap of this FarmBox is reached: nothing is built.'); return view(); }
    try {
      for (let i = 0; i < steps.length && building(); i++) {
        st.at = i + 1; tell();
        const r = await stage(steps[i]);
        if (!building() || r.gone) break;
        if (r.stop) { st.stopped = true; st.notice = r.stop; break; }
        tell();
      }
    } catch (e) {
      if (building()) { st.stopped = true; st.notice = `Staging stopped at step ${st.at}: ${e?.message || e}`; }
    } finally {
      toReview();
    }
    return view();
  }
  // Stop: out of building at once, whatever the current step waits for
  function stop() {
    if (!building()) return;
    st.stopped = true; st.notice = `Stopped at step ${st.at} of ${st.total}: review what was staged, or discard it.`;
    toReview();
  }

  // ── review ──
  function edit(id, args) {
    if (st.phase !== 'review') return { ok: false, error: 'Only a draft under review can be changed.' };
    const d = st.drafts.find(x => x.id === id);
    if (!d) return { ok: false, error: 'No such draft.' };
    const rc = checkRefs(d.command, args, d.n, steps, d.unit, home);
    if (rc.error) return { ok: false, error: rc.error };
    const v = validateArgs(d.command, rc.args);
    if (!v.ok) return v;
    const changed = JSON.stringify(args) !== JSON.stringify(d.args);
    d.args = args; d.switches_on = switchesOn(d.command, args);
    if (changed) {
      // the AI's words were about its own arguments: the line is rebuilt from what the draft now does (and the operation
      // log says the person changed it), the AI's warnings go, and a water step is said not to be range-checked again
      const c = getCommand(d.command);
      let line;
      try { line = c.preview(rc.shown || args); } catch { line = ''; }
      d.summary = String(line || c.label).slice(0, 300 - EDITED_MARK.length) + EDITED_MARK;
      d.warnings = RANGE_COMMANDS.has(d.command) ? [EDITED_RANGE_NOTE] : [];
      d.edited = true;
    }
    arm(); tell();
    return { ok: true };
  }
  function remove(id) {
    if (st.phase !== 'review') return false;
    const i = st.drafts.findIndex(d => d.id === id);
    if (i < 0) return false;
    st.drafts.splice(i, 1);
    if (!st.drafts.length) { end('Every draft was removed: nothing was applied.'); return true; }
    arm(); tell();
    return true;
  }
  function discard() { if (st.phase === 'building' || st.phase === 'review') end('Discarded: nothing was applied.'); }

  // one step of Validate, waited for at most stepMs
  const within = (p, ms, text) => new Promise((ok, bad) => {
    let h = deps.setTimer(() => { h = null; bad(Object.assign(new Error(text || `no answer within ${Math.round(ms / 1000)} s — it may still have been applied: check the Timeline`), { timeout: true })); }, ms);
    Promise.resolve(p).then(x => { if (h != null) { deps.clearTimer(h); ok(x); } }, e => { if (h != null) { deps.clearTimer(h); bad(e); } });
  });

  // ── validate: in order, actor ai, one group, each step on its unit, stop at the first failure ──
  async function validate() {
    if (st.phase !== 'review' || !st.drafts.length) return view();
    disarm();
    st.phase = 'validating'; st.group = deps.newId(); st.at = 0; st.total = st.drafts.length; st.notice = ''; tell();
    // the person who pressed Validate: a sign-out or another sign-in meanwhile stops it before the next step
    const who = deps.userId ? deps.userId() : undefined;
    let failed = null, halted = null;
    const results = new Map();   // step number → what its command returned, for the step references of later steps
    for (const d of st.drafts) {
      st.at++;
      if (failed || halted) { d.status = 'not-applied'; continue; }
      if (deps.userId && (!who || deps.userId() !== who)) { halted = d; d.status = 'not-applied'; continue; }
      d.status = 'applying'; tell();
      try {
        const farm = deps.farmFor ? deps.farmFor(d.unit) : deps.farm;
        // a reference to an earlier step is replaced here, by that step's result (a step not applied gives a clear failure)
        const args = resolveRefs(d.args, results);
        const res = await within(deps.run(d.command, args, { actor: 'ai', group: st.group, source: 'ai-build', summary: d.summary, ctx: { farm } }), deps.stepMs || STEP_MS);
        results.set(d.n, res);
        d.status = 'applied';
      } catch (e) {
        d.status = e?.timeout ? 'unknown' : 'failed'; d.error = e?.message || String(e); failed = d;
      }
      tell();
    }
    const applied = st.drafts.filter(d => d.status === 'applied');
    st.result = { group: st.group, applied: applied.length, failed: failed ? { n: failed.n, summary: failed.summary, error: failed.error, status: failed.status } : null,
                  notApplied: st.drafts.filter(d => d.status === 'not-applied').length,
                  halted: halted ? { n: halted.n, summary: halted.summary, why: 'session' } : null };
    st.phase = 'done';
    st.notice = halted
      ? `${applied.length} of ${st.drafts.length} applied; stopped before "${halted.summary}": the person signed in to this console changed (signed out, or somebody else signed in) after Validate was pressed. The rest was not applied.`
      : failed
      ? `${applied.length} of ${st.drafts.length} applied; stopped at "${failed.summary}": ${failed.error}`
      : `${applied.length} change${applied.length === 1 ? '' : 's'} applied as one group on the Timeline, where it can be put back.`;
    tell();
    return view();
  }

  return { start, stop, edit, remove, discard, validate, touch, state: view };
}
