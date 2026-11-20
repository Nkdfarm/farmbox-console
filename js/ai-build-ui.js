// ═══════════════════════════════════════════════════════════════════════════
// Creation mode — the screen (AI build mode P5, owner 20 Nov 2026, docs/ai-build-mode.md). The executor is ai-build.js;
// this module gives it the page and draws what it does:
//   - the violet frame (body.ai-building) and a line at the top of the head: "AI building · step n/N · Stop", then
//     "AI changes to review", "Applying n/N…";
//   - the replay: each step's page is opened (location.hash), its button (data-cmd, found by the registry's findAnchor)
//     scrolled to and highlighted for a moment — never clicked;
//   - the "AI changes" tray (a fixed panel): every draft a greyed, striped card grouped by page; open one to change its
//     arguments (a form from the command's schema), ✕ to remove it, Discard all, Validate;
//   - the lock, FOR THIS PERSON ONLY (it is this console's own state, nothing is sent): while a build runs or waits for
//     review everything but the tray, the build line and the emergency controls is inert (pointer-events, aria-disabled,
//     focus and keys kept out) and dimmed. The emergency controls are the registry's emergency commands (Stop the run,
//     Pause, Resume) and anything inside a drawer marked data-emergency: ui.js marks a drawer so when it is opened with
//     { emergency: true } (FarmNet's Pause, Resume and Stop drawers and their confirms, farmnet/commands.js) or while the
//     console is locked (only an emergency control can open one then); such a drawer sits above the tray. The console
//     has no alarm acknowledgement yet; one would carry data-emergency. A drawer opened before the build is locked too;
//   - the band always has a way out: Stop while building (to review, or ended when nothing was staged), Discard all in
//     review; only a Validate in flight has none, and each of its steps is given up after 45 s (ai-build.js);
//   - 5 minutes without input (pointer or keyboard) ends it by itself (ai-build.js), with a notice.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn } from './api.js';
import { el, toast } from './ui.js';
import { createBuild } from './ai-build.js';
import { getCommand, listCommands, findAnchor, runCommand } from './registry.js';
import { pageTitle } from './assistant-shape.js';

const HIGHLIGHT_MS = 900;
const FIND_MS = 2500;
let current = null;      // { build, ctx, open (the draft whose form is open) }
let bandEl = null, trayEl = null, styleEl = null;
const wait = ms => new Promise(r => setTimeout(r, ms));
export const building = () => !!current && !!current.build.state().locked;

// ── the replay ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function navigate(page) {
  if ((location.hash || '').split('?')[0] === page) { await wait(120); return; }
  location.hash = page;
  await wait(350);           // app.js draws the page on hashchange
}
async function locate(name, args) {
  const t0 = Date.now();
  for (;;) {
    const a = findAnchor(name, args, document.getElementById('shell') || document);
    if (a && a.getClientRects().length) return a;
    if (Date.now() - t0 > FIND_MS) return null;
    await wait(120);
  }
}
async function highlight(node) {
  try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { node.scrollIntoView?.(); }
  node.classList.add('ai-replay');
  await wait(HIGHLIGHT_MS);
  node.classList.remove('ai-replay');
}

// ── the lock ────────────────────────────────────────────────────────────────────────────────────────────────────────
const EMERGENCY_CMDS = () => listCommands().filter(c => c.emergency).map(c => `[data-cmd="${c.name}"]`);
const EMERGENCY = () => [...EMERGENCY_CMDS(), '[data-emergency]'];
const allowed = node => !!node?.closest?.('#aiBuildBand, #aiTray, ' + EMERGENCY().join(', '));
function onKey(e) {
  if (!current) return;
  current.build.touch();
  if (!current.build.state().locked || allowed(e.target)) return;
  if (['Enter', ' ', 'Spacebar', 'Delete', 'Backspace'].includes(e.key) || e.key.length === 1) { e.preventDefault(); e.stopPropagation(); }
}
function onFocus(e) {
  if (current?.build.state().locked && !allowed(e.target) && e.target !== document.body) { try { e.target.blur(); } catch { /* none */ } }
}
const onPointer = () => current?.build.touch();
function lock(on) {
  document.body.classList.toggle('ai-locked', on);
  document.querySelectorAll('.rail, #page, #head > :not(#aiBuildBand)').forEach(n => { if (on) n.setAttribute('aria-disabled', 'true'); else n.removeAttribute('aria-disabled'); });
  if (on && !styleEl) {
    styleEl = el('style');
    // #shell: above the specificity of the lock's own rules (#page > *), so an emergency control stays live inside the page
    styleEl.textContent = `body.ai-locked :is(${EMERGENCY().join(', ')}), body.ai-locked #shell :is(${EMERGENCY().join(', ')}) { pointer-events: auto; }
body.ai-locked :is(${EMERGENCY_CMDS().join(', ')}) { outline: 2px solid var(--error); outline-offset: 2px; }`;
    document.head.append(styleEl);
  }
  if (!on && styleEl) { styleEl.remove(); styleEl = null; }
}
function listen(on) {
  const f = on ? 'addEventListener' : 'removeEventListener';
  document[f]('keydown', onKey, true);
  document[f]('focusin', onFocus, true);
  document[f]('pointerdown', onPointer, true);
  document[f]('pointermove', onPointer, { capture: true, passive: true });
  document[f]('wheel', onPointer, { capture: true, passive: true });
}

// ── the build line ──────────────────────────────────────────────────────────────────────────────────────────────────
function paintBand(s) {
  if (!bandEl) {
    bandEl = el('div', 'ai-build-band'); bandEl.id = 'aiBuildBand'; bandEl.setAttribute('role', 'status'); bandEl.setAttribute('aria-live', 'polite');
    (document.getElementById('head') || document.body).prepend(bandEl);
  }
  bandEl.textContent = '';
  const text = s.phase === 'building' ? `AI building · step ${s.at}/${s.total}` + (s.stopped ? ' · stopping…' : '')
    : s.phase === 'review' ? `AI changes to review · ${s.drafts.length} draft${s.drafts.length === 1 ? '' : 's'} · nothing is applied until you validate`
    : s.phase === 'validating' ? `Applying ${s.at}/${s.total}…` : '';
  bandEl.append(el('b', null, text));
  // a way out in every phase but a Validate in flight
  if (s.phase === 'building') {
    const stop = el('button', 'btn btn-sm', 'Stop'); stop.type = 'button';
    stop.title = 'Stop staging: review what was staged, or discard it';
    stop.onclick = () => current?.build.stop();
    bandEl.append(stop);
  } else if (s.phase === 'review') {
    const out = el('button', 'btn btn-sm', 'Discard all'); out.type = 'button';
    out.title = 'Discard every draft: nothing is applied';
    out.onclick = () => current?.build.discard();
    bandEl.append(out);
  }
}

// ── the tray ────────────────────────────────────────────────────────────────────────────────────────────────────────
const parseVal = (s, raw) => {
  if (s.type === 'boolean') return raw;
  if (raw === '' || raw == null) return undefined;
  if (s.type === 'int' || s.type === 'number') return Number(raw);
  if (s.type === 'object' || s.type === 'array' || s.type === 'any') return JSON.parse(raw);
  return raw;
};
function argsForm(d) {
  const c = getCommand(d.command);
  const form = el('form', 'ai-draft-form');
  const inputs = {};
  Object.entries(c.args).forEach(([k, s]) => {
    const lab = el('label', 'ai-draft-field');
    lab.append(el('span', null, (s.label || k) + (s.required ? ' *' : '')));
    const v = d.args?.[k];
    let inp;
    if (s.type === 'boolean') { inp = el('input'); inp.type = 'checkbox'; inp.checked = v === true; }
    else if (s.enum) { inp = el('select', 'input'); ['', ...s.enum].forEach(o => { const op = el('option', null, String(o)); op.value = String(o); inp.append(op); }); inp.value = v == null ? '' : String(v); }
    else if (s.type === 'object' || s.type === 'array' || s.type === 'any') { inp = el('textarea', 'input'); inp.rows = 3; inp.value = v === undefined ? '' : JSON.stringify(v, null, 1); }
    else { inp = el('input', 'input'); inp.type = s.type === 'int' || s.type === 'number' ? 'number' : s.type === 'date' ? 'date' : 'text'; inp.value = v == null ? '' : String(v); if (s.type === 'int') inp.step = '1'; }
    inp.name = k; inputs[k] = { inp, s };
    lab.append(inp); form.append(lab);
  });
  const msg = el('div', 'ai-draft-msg');
  const save = el('button', 'btn btn-sm btn-primary', 'Keep the change'); save.type = 'submit';
  const cancel = el('button', 'btn btn-sm btn-ghost', 'Cancel'); cancel.type = 'button';
  cancel.onclick = () => { current.open = null; paintTray(current.build.state()); };
  form.onsubmit = e => {
    e.preventDefault();
    const args = {};
    try {
      for (const [k, { inp, s }] of Object.entries(inputs)) {
        const raw = s.type === 'boolean' ? inp.checked : inp.value.trim();
        const x = s.enum && raw !== '' && s.enum.every(o => typeof o === 'number') ? Number(raw) : parseVal(s, raw);
        if (x !== undefined && !(s.type === 'boolean' && x === false && d.args?.[k] === undefined)) args[k] = x;
      }
    } catch { msg.textContent = 'A list or an object is written as JSON.'; return; }
    const r = current.build.edit(d.id, args);
    if (!r.ok) { msg.textContent = r.error; return; }
    current.open = null; paintTray(current.build.state());
  };
  const row = el('div', 'row'); row.append(save, cancel);
  form.append(msg, row);
  return form;
}
function draftCard(d, s) {
  const card = el('div', `ai-draft ${d.status}`);
  const head = el('div', 'ai-draft-head');
  head.append(el('b', `ai-step-sign ai-mark-${d.mark === '+' ? 'new' : d.mark === '-' ? 'removed' : 'changed'}`, d.mark === '-' ? '−' : d.mark), el('span', 'ai-draft-sum', d.summary));
  if (s.phase === 'review') {
    const x = el('button', 'btn btn-sm btn-ghost ai-draft-x', '✕'); x.type = 'button'; x.title = 'Remove this draft'; x.setAttribute('aria-label', 'Remove this draft');
    x.onclick = e => { e.stopPropagation(); current.build.remove(d.id); };
    head.append(x);
  }
  card.append(head, el('div', 'ai-draft-meta', d.label + (d.edited ? ' · changed by you' : '') + (d.fixed ? ' · fixed by the AI' : '')));
  if (!d.anchor) card.append(el('div', 'ai-draft-note', 'Its button was not found on the page: staged all the same.'));
  if (d.switches_on) card.append(el('div', 'ai-draft-warn', 'This switches the program ON when you validate.'));
  if (d.status === 'applied') card.append(el('div', 'ai-draft-ok', '✓ Applied'));
  if (d.status === 'failed') card.append(el('div', 'ai-draft-warn', '✕ ' + (d.error || 'Refused')));
  if (d.status === 'not-applied') card.append(el('div', 'ai-draft-note', 'Not applied'));
  if (s.phase === 'review') {
    card.tabIndex = 0; card.setAttribute('role', 'button'); card.title = 'Open to change its arguments';
    const open = () => { current.open = current.open === d.id ? null : d.id; paintTray(current.build.state()); };
    card.onclick = e => { if (!e.target.closest('form')) open(); };
    card.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); open(); } };
    if (current.open === d.id) card.append(argsForm(d));
  }
  return card;
}
function paintTray(s) {
  if (!trayEl) { trayEl = el('aside', 'ai-tray'); trayEl.id = 'aiTray'; trayEl.setAttribute('aria-label', 'AI changes'); document.body.append(trayEl); }
  trayEl.textContent = '';
  const head = el('div', 'ai-tray-head');
  head.append(el('b', null, 'AI changes'), el('span', 'ai-tray-count', `${s.drafts.length} draft${s.drafts.length === 1 ? '' : 's'}`));
  // fold it to its head: nothing on the page stays under the tray (an emergency control above all)
  const min = el('button', 'btn btn-sm btn-ghost ai-tray-min', current.min ? '▴ Open' : '▾ Fold'); min.type = 'button';
  min.title = current.min ? 'Open the AI changes' : 'Fold the AI changes to this line, to see and use the page under them';
  min.setAttribute('aria-expanded', String(!current.min));
  min.onclick = () => { current.min = !current.min; paintTray(current.build.state()); };
  head.append(min);
  trayEl.classList.toggle('min', !!current.min);
  trayEl.append(head);
  if (s.notice) trayEl.append(el('div', 'ai-tray-notice' + (s.result?.failed || s.stopped ? ' bad' : ''), s.notice));
  const switches = s.drafts.filter(d => d.switches_on && d.status === 'draft').length;
  if (switches && s.phase === 'review') trayEl.append(el('div', 'ai-draft-warn', `This build switches ${switches} program${switches === 1 ? '' : 's'} on: check ${switches === 1 ? 'it' : 'them'} before you validate.`));
  const body = el('div', 'ai-tray-body');
  const pages = [...new Set(s.drafts.map(d => d.page))];
  pages.forEach(p => {
    const g = el('section', 'ai-tray-page');
    const go = el('button', 'ai-tray-pagehead', `${pageTitle(p)} · ${s.drafts.filter(d => d.page === p).length}`); go.type = 'button';
    go.title = 'Open this page'; go.onclick = () => { if ((location.hash || '').split('?')[0] !== p) location.hash = p; };
    g.append(go);
    s.drafts.filter(d => d.page === p).forEach(d => g.append(draftCard(d, s)));
    body.append(g);
  });
  if (s.phase === 'building') body.append(el('div', 'ai-tray-note', `Staging step ${s.at} of ${s.total}…`));
  trayEl.append(body);
  const foot = el('div', 'row ai-tray-foot');
  if (s.phase === 'review') {
    const discard = el('button', 'btn btn-sm btn-ghost', 'Discard all'); discard.type = 'button';
    discard.onclick = () => current.build.discard();
    const ok = el('button', 'btn btn-sm btn-primary', 'Validate'); ok.type = 'button';
    ok.title = 'Apply these drafts in order, as one group on the Timeline (actor: AI build, validated by you)';
    ok.onclick = () => current.build.validate();
    foot.append(discard, el('div', 'spacer'), ok);
  } else if (s.phase === 'done') {
    const tl = el('button', 'btn btn-sm btn-ghost', 'Open the Timeline'); tl.type = 'button';
    tl.onclick = () => { close(); location.hash = '#/dashboard/timeline'; };
    const cl = el('button', 'btn btn-sm btn-primary', 'Close'); cl.type = 'button'; cl.onclick = close;
    foot.append(tl, el('div', 'spacer'), cl);
  }
  trayEl.append(foot);
}

function paint(s) {
  if (!current) return;
  const on = s.locked;
  document.body.classList.toggle('ai-building', on);
  lock(on);
  if (on) paintBand(s); else { bandEl?.remove(); bandEl = null; }
  if (s.phase === 'ended') {
    close();
    toast(s.notice, s.idle ? 'bad' : '');
    return;
  }
  paintTray(s);
}
function close() {
  if (!current) return;
  const ctx = current.ctx;
  current = null;
  listen(false); lock(false);
  document.body.classList.remove('ai-building');
  bandEl?.remove(); bandEl = null; trayEl?.remove(); trayEl = null;
  try { ctx.refresh?.(); } catch { /* the page draws again on its own */ }
}

// ── starting a build: Build it in the question box ──────────────────────────────────────────────────────────────────
// ctx: { farm (the FarmBox object), units (ids on screen), refresh() }
export async function startBuild(plan, ctx) {
  if (current) { toast('A build is already running or waiting for your review', 'bad'); return null; }
  const farm = ctx.farm;
  if (!farm) { toast('Choose a FarmBox first', 'bad'); return null; }
  // the Build switches of each unit the plan touches, read once as the person (0285): a family turned off on a step's
  // unit stops the build at that step
  const units = [...new Set([farm.id, ...(plan.steps || []).map(s => s.unit).filter(u => typeof u === 'string' && u)])];
  const permsOf = new Map();
  await Promise.all(units.map(async u => {
    let p = null;
    try { p = await rpc('ai_permissions', { p_farm: u }, { quiet: true }); } catch { p = null; }
    permsOf.set(u, p ? new Map((p.families || []).map(f => [f.code, f])) : null);
  }));
  const mayBuild = (family, unit) => {
    const fams = permsOf.get(unit || farm.id);
    if (!fams) return 'the AI permissions of this FarmBox could not be read';
    const f = fams.get(family);
    return f && f.propose && f.build && !f.always_off ? true : `this FarmBox does not let the AI build changes of ${f?.label || family} (Team › AI permissions)`;
  };
  // each step runs on its own unit (a site of sister units): the FarmBox object when it is the one open, else its id
  const farmFor = unit => (!unit || unit === farm.id ? farm : { id: unit });
  const budget = async () => {
    const b = await rpc('ai_build_budget', { p_farm: farm.id }, { quiet: true });
    const over = !b || Number(b.spent_usd) >= Number(b.cap_usd);
    return { over, text: over ? `Today this FarmBox's AI has cost $${Number(b?.spent_usd || 0).toFixed(2)} of its daily cap of $${Number(b?.cap_usd || 0).toFixed(2)}: nothing is built. The farm admin or the farm manager can raise it in Settings › Assistant.` : '' };
  };
  const fix = async (step, error) => {
    const r = await fn('assistant', { farm_id: farm.id, units: ctx.units || undefined, messages: [{ role: 'user', content: 'Fix one step of a build.' }],
      fix: { step: { command: step.command, args: step.args, page: step.page, summary: step.summary, unit: step.unit }, error } }, { quiet: true });
    return r?.ok ? { ok: true, step: r.step } : { ok: false, error: r?.error || 'no answer' };
  };
  current = { ctx, open: null, build: null };
  current.build = createBuild(plan, {
    farm, farmFor, navigate, locate, highlight, fix, mayBuild, budget, run: runCommand,
    newId: () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16))),
    now: () => Date.now(), setTimer: (f, ms) => setTimeout(f, ms), clearTimer: h => clearTimeout(h),
    onChange: s => paint(s),
  });
  listen(true);
  const mine = current;
  return current.build.start().catch(e => {
    // never left locked: whatever went wrong, the build is ended and the screen given back
    toast('The build stopped: ' + (e?.message || e), 'bad');
    if (current === mine) { try { mine.build.discard(); } catch { /* none */ } close(); }
    return null;
  });
}
// sign-out or another FarmBox: a build in progress is discarded, nothing applied
export function abandonBuild() {
  if (!current) return;
  if (current.build?.state().phase === 'validating') return;   // an apply in flight finishes (each step at most 45 s)
  try { current.build?.discard(); } catch { /* the screen is given back below */ }
  close();
}
