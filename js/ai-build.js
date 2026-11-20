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
// Nothing here approves, validates, marks done, pays or gives access: the registry's commands cannot (only class A
// commands may be staged, and the server's door refuses the rest for actor ai).
// ═══════════════════════════════════════════════════════════════════════════
import { getCommand, validateArgs } from './registry.js';

export const IDLE_MS = 5 * 60 * 1000;
export const STEP_MS = 45 * 1000;
export const PHASES = ['building', 'review', 'validating', 'done', 'ended'];
const LOCKED = new Set(['building', 'review', 'validating']);
export const IDLE_NOTICE = 'Creation mode ended by itself after 5 minutes without input: the drafts were discarded and nothing was applied.';

// a step that creates a program switched on, or switches one on: said on its draft and in the tray before Validate
export const switchesOn = (command, args) => ['program_set', 'program_add', 'program_copy'].includes(command) && args?.changes?.on === true;

// deps: { run(name, args, opts) (the registry's runCommand), farm, farmFor(unit) → the FarmBox to run a step on,
//         navigate(page), locate(name, args) → element | null, highlight(element),
//         fix(step, error) → { ok, step } | { ok: false, error }, mayBuild(family, unit) → true | reason,
//         budget() → { over, text } | null, newId(), now(), setTimer(fn, ms) → handle, clearTimer(handle), onChange(state),
//         stepMs (Validate's wait for one step; STEP_MS) }
export function createBuild(plan, deps) {
  const steps = (plan?.steps || []).map((s, i) => ({ ...s, n: i + 1 }));
  const st = { phase: 'building', at: 0, total: steps.length, drafts: [], notice: '', stopped: false, result: null, group: null };
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
    let s = step, v = validateArgs(s.command, s.args);
    if (!v.ok) {
      // back to the model once
      let f = null;
      try { f = deps.fix ? await deps.fix(s, v.error) : null; } catch (e) { f = { ok: false, error: e?.message || String(e) }; }
      if (!building()) return { gone: true };
      if (!f?.ok || !f.step) return { stop: `Step ${s.n} could not be staged: ${v.error}${f?.error ? ' — the AI could not fix it: ' + f.error : ''}` };
      const fixed = { ...s, ...f.step, n: s.n, unit: s.unit, fixed: true };
      const c2 = getCommand(fixed.command);
      const may2 = c2 && deps.mayBuild ? deps.mayBuild(c2.family, fixed.unit || null) : true;
      v = c2 && c2.stageable && !c2.emergency && may2 === true ? validateArgs(fixed.command, fixed.args) : { ok: false, error: 'the fixed step may not be built' };
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
    return { ok: true };
  }

  // ── building: every step staged in order, without the model ──
  async function start() {
    if (!steps.length) { end('The plan has no step: nothing to build.'); return view(); }
    let b = null;
    try { b = deps.budget ? await deps.budget() : null; } catch (e) { b = { over: true, text: e?.message || 'The daily cost cap could not be read: nothing is built.' }; }
    if (!building()) return view();
    if (b && b.over) { end(b.text || 'The daily cost cap of this FarmBox is reached: nothing is built.'); return view(); }
    arm(); tell();
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
    const v = validateArgs(d.command, args);
    if (!v.ok) return v;
    d.args = args; d.switches_on = switchesOn(d.command, args); d.edited = true;
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
  const within = (p, ms) => new Promise((ok, bad) => {
    let h = deps.setTimer(() => { h = null; bad(Object.assign(new Error(`no answer within ${Math.round(ms / 1000)} s — it may still have been applied: check the Timeline`), { timeout: true })); }, ms);
    Promise.resolve(p).then(x => { if (h != null) { deps.clearTimer(h); ok(x); } }, e => { if (h != null) { deps.clearTimer(h); bad(e); } });
  });

  // ── validate: in order, actor ai, one group, each step on its unit, stop at the first failure ──
  async function validate() {
    if (st.phase !== 'review' || !st.drafts.length) return view();
    disarm();
    st.phase = 'validating'; st.group = deps.newId(); st.at = 0; st.total = st.drafts.length; st.notice = ''; tell();
    let failed = null;
    for (const d of st.drafts) {
      st.at++;
      if (failed) { d.status = 'not-applied'; continue; }
      d.status = 'applying'; tell();
      try {
        const farm = deps.farmFor ? deps.farmFor(d.unit) : deps.farm;
        await within(deps.run(d.command, d.args, { actor: 'ai', group: st.group, source: 'ai-build', summary: d.summary, ctx: { farm } }), deps.stepMs || STEP_MS);
        d.status = 'applied';
      } catch (e) {
        d.status = e?.timeout ? 'unknown' : 'failed'; d.error = e?.message || String(e); failed = d;
      }
      tell();
    }
    const applied = st.drafts.filter(d => d.status === 'applied');
    st.result = { group: st.group, applied: applied.length, failed: failed ? { n: failed.n, summary: failed.summary, error: failed.error, status: failed.status } : null,
                  notApplied: st.drafts.filter(d => d.status === 'not-applied').length };
    st.phase = 'done';
    st.notice = failed
      ? `${applied.length} of ${st.drafts.length} applied; stopped at "${failed.summary}": ${failed.error}`
      : `${applied.length} change${applied.length === 1 ? '' : 's'} applied as one group on the Timeline, where it can be put back.`;
    tell();
    return view();
  }

  return { start, stop, edit, remove, discard, validate, touch, state: view };
}
