// ═════════════════════════════════════════════════════════════════════
// The command registry (AI build mode P3, owner 20 Nov 2026, docs/ai-build-mode.md: "the AI clicks" = commands from a
// registry, which the screen replays on their own buttons; no DOM clicking).
//
// Every change a page makes through the registry runs through runCommand(name, args, { actor, group, source, revertOf,
// summary, ctx }): the arguments are checked against the command's schema, the command runs, and onOperation(record) hears what
// happened. The operation log itself is written by the server (P4, migration 0286): run receives ctx.op = { command,
// actor, group, page, source, summary, revert_of } and hands it on — a database command to public.run_command, a
// FarmNet one to the farmnet function (body.op) — so the hook stays light (the Timeline only hears that it is stale). The pages keep their own drawers and confirms: the registry is the
// door, not the dialog. A person's button and the AI's built step are the same command, so P5 can stage it, replay it
// on its button (anchor) and apply it after validation.
//
// This module and registry-catalogue.js import nothing at the top: node loads them (scripts/check-registry.mjs tests
// the validation and keeps supabase/functions/_shared/command-catalogue.json, the assistant function's copy, equal).
// Since console 0.18.00.
// ═════════════════════════════════════════════════════════════════════
import { DEFINITIONS } from './registry-catalogue.js';

const COMMANDS = new Map();
export const REVERT = { A: 'put back', B: 'a compensating action', C: 'final' };
export const ACTORS = ['human', 'ai'];          // who may run a command from the console
// every actor of the operation log (0286): an MCP connection writes through mcp.act, the phone and the platform their own way
export const ACTORS_LOGGED = { human: 'Person', ai: 'AI build', mcp: 'AI connection (MCP)', phone: 'Phone', system: 'Platform' };
const TYPES = new Set(['int', 'number', 'string', 'boolean', 'object', 'array', 'date', 'uuid', 'any']);
const SPEC_KEYS = new Set(['type', 'required', 'min', 'max', 'enum', 'label']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_]{1,60}$/;
const ROUTE = /^#\/[a-z0-9_/-]*$/;

const fail = m => { throw new Error(`registry: ${m}`); };

// ── registering ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function register(def) {
  const d = def || {};
  if (!NAME.test(d.name || '')) fail(`a command needs a name of lower-case letters and _ (got ${JSON.stringify(d.name)})`);
  if (COMMANDS.has(d.name)) fail(`${d.name} is registered twice`);
  if (!NAME.test(d.family || '')) fail(`${d.name}: no family`);
  if (!d.label || typeof d.label !== 'string') fail(`${d.name}: no label`);
  if (!REVERT[d.revert]) fail(`${d.name}: revert is A, B or C`);
  if (typeof d.run !== 'function') fail(`${d.name}: no run`);
  if (!Array.isArray(d.pages) || !d.pages.length || d.pages.some(p => !ROUTE.test(p))) fail(`${d.name}: pages are routes like #/farmnet/irrigation`);
  if (d.preview !== undefined && typeof d.preview !== 'function') fail(`${d.name}: preview is a function`);
  if (d.seconds !== undefined && !(Number.isFinite(d.seconds) && d.seconds > 0)) fail(`${d.name}: seconds is a number above 0`);
  if (d.anchor !== undefined && typeof d.anchor !== 'string' && typeof d.anchor !== 'function') fail(`${d.name}: anchor is a selector or a function`);
  // what the AI may only propose is never built: run control, and anything that cannot be put back
  if (d.stageable && d.revert !== 'A') fail(`${d.name}: only a command of class A may be staged`);
  const args = d.args || {};
  for (const [k, s] of Object.entries(args)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) fail(`${d.name}: argument name ${k}`);
    if (!s || !TYPES.has(s.type)) fail(`${d.name}.${k}: type is one of ${[...TYPES].join(', ')}`);
    const extra = Object.keys(s).filter(x => !SPEC_KEYS.has(x));
    if (extra.length) fail(`${d.name}.${k}: unknown ${extra.join(', ')}`);
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) fail(`${d.name}.${k}: enum is a list`);
  }
  const cmd = Object.freeze({
    name: d.name, family: d.family, label: d.label, kind: d.kind || 'other', sends: d.sends || null,
    pages: Object.freeze([...d.pages]), args: Object.freeze(Object.fromEntries(Object.entries(args).map(([k, s]) => [k, Object.freeze({ ...s })]))),
    revert: d.revert, stageable: !!d.stageable, emergency: !!d.emergency,
    // how long it takes to carry out, for a build's estimate (P5): FarmNet ~3 s (the controller answers), the database ~0.5 s
    seconds: Number.isFinite(d.seconds) && d.seconds > 0 ? d.seconds : (d.kind === 'farmnet' ? 3 : 0.5),
    preview: d.preview || (a => `${d.label}${summaryOf(a)}`), run: d.run,
    anchor: d.anchor || `[data-cmd="${d.name}"]`,
  });
  COMMANDS.set(cmd.name, cmd);
  return cmd;
}
const summaryOf = a => {
  const parts = Object.entries(a || {}).filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object').slice(0, 3).map(([k, v]) => `${k} ${v}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
};

export const getCommand = name => COMMANDS.get(name) || null;
export function listCommands({ family, page } = {}) {
  return [...COMMANDS.values()].filter(c => (!family || c.family === family) && (!page || c.pages.some(p => page === p || page.startsWith(p + '/'))));
}
export const families = () => [...new Set([...COMMANDS.values()].map(c => c.family))].sort();

// ── the arguments ───────────────────────────────────────────────────────────────────────────────────────────────────
// { ok: true, args } (the arguments as given: the registry checks, it never rewrites what a page sends) or { ok: false,
// error }. An argument missing, null or '' is absent. min/max bound a number, and the length of a string or a list.
// int and number take a number or a string of one (FarmNet's ids come either way, as the function itself accepts).
export function validateArgs(name, args) {
  const c = COMMANDS.get(name);
  if (!c) return { ok: false, error: `"${name}" is not a command` };
  const a = args === undefined || args === null ? {} : args;
  if (typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: `${c.label}: the arguments are an object` };
  for (const k of Object.keys(a)) if (!c.args[k] && a[k] !== undefined) return { ok: false, error: `${c.label}: "${k}" is not one of its arguments` };
  for (const [k, s] of Object.entries(c.args)) {
    const v = a[k], what = s.label || k;
    if (v === undefined || v === null || v === '') {
      if (s.required) return { ok: false, error: `${c.label}: ${what} is missing` };
      continue;
    }
    const bad = checkValue(s, v);
    if (bad) return { ok: false, error: `${c.label}: ${what} ${bad}` };
  }
  return { ok: true, args: a };
}

function checkValue(s, v) {
  let n = null;
  switch (s.type) {
    case 'int': case 'number':
      n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) return 'must be a number';
      if (s.type === 'int' && !Number.isInteger(n)) return 'must be a whole number';
      break;
    case 'string': if (typeof v !== 'string') return 'must be text'; n = v.length; break;
    case 'boolean': if (typeof v !== 'boolean') return 'must be yes or no'; break;
    case 'object': if (typeof v !== 'object' || Array.isArray(v)) return 'must be an object'; break;
    case 'array': if (!Array.isArray(v)) return 'must be a list'; n = v.length; break;
    case 'date': {
      if (typeof v !== 'string' || !DATE.test(v)) return 'must be a day as YYYY-MM-DD';
      const d = new Date(v + 'T00:00:00Z');
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return 'is not a day of the calendar';
      break;
    }
    case 'uuid': if (typeof v !== 'string' || !UUID.test(v)) return 'is not an id'; break;
    default: break;
  }
  const len = s.type === 'string' || s.type === 'array';
  if (s.min !== undefined && n !== null && n < s.min) return len ? `needs at least ${s.min}${s.type === 'string' ? ' characters' : ''}` : `must be at least ${s.min}`;
  if (s.max !== undefined && n !== null && n > s.max) return len ? `takes at most ${s.max}${s.type === 'string' ? ' characters' : ''}` : `must be at most ${s.max}`;
  if (s.enum && !s.enum.some(e => e === v || (typeof e === 'number' && Number(v) === e))) return `must be one of ${s.enum.join(', ')}`;
  return null;
}

// ── running ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// onOperation(record): P4's operation log. record = { name, family, label, revert, actor, group, page, args, summary,
// status ('done' | 'failed' | 'refused'), error, result, at (ISO), ms }. A hook that throws never costs the command.
let onOperation = () => {};
export function setOperationHook(fn) { onOperation = typeof fn === 'function' ? fn : () => {}; }

export async function runCommand(name, args, { actor = 'human', group = null, source = 'console', revertOf = null, summary: given = null, ctx = {} } = {}) {
  const c = COMMANDS.get(name);
  const t0 = Date.now();
  const page = typeof location !== 'undefined' ? (location.hash || '').split('?')[0] || null : null;
  const base = { name, family: c?.family ?? null, label: c?.label ?? null, revert: c?.revert ?? null, actor, group, page, args: args ?? {}, at: new Date(t0).toISOString() };
  const tell = rec => { try { onOperation(Object.freeze(rec)); } catch (e) { console.warn('registry: the operation hook failed', e); } };
  const refuse = msg => { tell({ ...base, summary: null, status: 'refused', error: msg, result: null, ms: 0 }); throw new Error(msg); };
  if (!c) refuse(`"${name}" is not a command`);
  if (!ACTORS.includes(actor)) refuse(`${c.label}: actor is ${ACTORS.join(' or ')}`);
  // the AI builds only what can be staged and put back; run control and class B/C it may only propose to a person
  if (actor === 'ai' && !c.stageable) refuse(`${c.label}: the AI may propose this, never carry it out`);
  const v = validateArgs(name, args);
  if (!v.ok) refuse(v.error);
  let summary = typeof given === 'string' && given.trim() ? given.trim().slice(0, 300) : null;   // a card's own words
  if (!summary) { try { summary = c.preview(v.args, ctx); } catch { summary = c.label; } }
  // what the server writes into the operation log beside the command (0286)
  const op = Object.freeze({ command: name, actor, group, page, source, summary, revert_of: revertOf });
  try {
    const result = await c.run(v.args, { ...ctx, op });
    tell({ ...base, summary, status: 'done', error: null, result: result ?? null, ms: Date.now() - t0 });
    return result;
  } catch (e) {
    tell({ ...base, summary, status: 'failed', error: e?.message || String(e), result: null, ms: Date.now() - t0 });
    throw e;
  }
}

// ── the buttons ─────────────────────────────────────────────────────────────────────────────────────────────────────
// A page marks a command's button with data-cmd (and data-cmd-key: the program's or recipe's number) so the replay can
// find it. findAnchor(name, args, root) → the element, or null when the command's button is not on screen.
export function tagCmd(node, name, key) {
  if (!node) return node;
  node.dataset.cmd = name;
  if (key !== undefined && key !== null) node.dataset.cmdKey = String(key);
  return node;
}
export function findAnchor(name, args, root = typeof document !== 'undefined' ? document : null) {
  const c = COMMANDS.get(name);
  if (!c || !root) return null;
  try { return typeof c.anchor === 'function' ? c.anchor(args || {}, root) || null : root.querySelector(c.anchor); }
  catch { return null; }
}

// ── the catalogue: what the assistant function reads (command-catalogue.json), without the functions ───────────────
export function catalogue() {
  return [...COMMANDS.values()].map(c => ({
    name: c.name, family: c.family, label: c.label, kind: c.kind, ...(c.sends && c.sends !== c.name ? { sends: c.sends } : {}),
    pages: [...c.pages], args: Object.fromEntries(Object.entries(c.args).map(([k, s]) => [k, { ...s }])),
    revert: c.revert, stageable: c.stageable, emergency: c.emergency, seconds: c.seconds,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

DEFINITIONS.forEach(register);
