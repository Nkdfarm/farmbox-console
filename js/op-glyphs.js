// ═════════════════════════════════════════════════════════════════════
// The icons of the history strip (owner, 21 Nov 2026: "an icon for each function, same logic and similar graphic as
// Fusion 360, SolidWorks"). A SYSTEM, not one drawing per command: one base glyph per kind of object (an irrigation
// program, a recipe, a valve, a tank, a run, the climate, a crop plan, a procedure, an order, a crop, equipment, an issue,
// a price, a closed day, settings) and a small badge in the corner per verb (＋ new, ✎ changed, ✕ deleted, ↺ put back,
// ▶ started, ⏸ paused, ■ stopped). Every command of the registry is in COMMAND_GLYPH (scripts/check-timeline.mjs
// checks it); a command the log holds that is not in the registry (an AI connection's action) is guessed from its name
// and family, else the generic glyph.
//
// Inline SVG, drawn in currentColor (the theme's tokens colour it), no external file. No import: node loads this module.
// Since console 0.22.00.
// ═════════════════════════════════════════════════════════════════════

// 16×16, stroked in currentColor
export const KINDS = {
  program:   { label: 'Irrigation program', d: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.8V8l2.2 1.6"/>' },
  recipe:    { label: 'Recipe', d: '<path d="M6 2.5h4M6.6 2.5v4.2L3.4 12.2A1.2 1.2 0 0 0 4.5 14h7a1.2 1.2 0 0 0 1.1-1.8L9.4 6.7V2.5"/><path d="M4.8 10.5h6.4"/>' },
  valve:     { label: 'Valve', d: '<path d="M2.5 5.2v5.6L8 8zM13.5 5.2v5.6L8 8z"/><path d="M8 8V3.6M6 3.6h4"/>' },
  tank:      { label: 'Mixing tank', d: '<ellipse cx="8" cy="4" rx="4.5" ry="1.6"/><path d="M3.5 4v8c0 .9 2 1.6 4.5 1.6s4.5-.7 4.5-1.6V4"/><path d="M3.5 8c0 .9 2 1.6 4.5 1.6s4.5-.7 4.5-1.6"/>' },
  run:       { label: 'Irrigation run', d: '<path d="M8 2.2S4 6.6 4 9.6a4 4 0 0 0 8 0C12 6.6 8 2.2 8 2.2z"/>' },
  climate:   { label: 'Climate', d: '<path d="M9.5 9.3V3.6a1.5 1.5 0 0 0-3 0v5.7a3 3 0 1 0 3 0z"/><path d="M8 6.2v5"/>' },
  plan:      { label: 'Crop plan', d: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M4.8 6.5h4.4M6.8 9.5h4.4"/>' },
  procedure: { label: 'Procedure', d: '<path d="M6 4.5h7M6 8h7M6 11.5h7"/><path d="M2.6 4.5l.8.8 1.3-1.5M2.6 8l.8.8 1.3-1.5M2.6 11.5l.8.8 1.3-1.5"/>' },
  order:     { label: 'Order', d: '<path d="M2.5 5.4L8 3l5.5 2.4v5.2L8 13l-5.5-2.4z"/><path d="M2.5 5.4L8 7.8l5.5-2.4M8 7.8V13"/>' },
  crop:      { label: 'Crop', d: '<path d="M8 13.6V8.2"/><path d="M8 8.2c0-3 2-4.9 5.5-4.9 0 3.3-2 4.9-5.5 4.9zM8 9.8C8 7.6 6.5 6.2 3 6.2c0 2.4 1.6 3.6 5 3.6z"/>' },
  asset:     { label: 'Equipment', d: '<path d="M10.6 2.7a3 3 0 0 0-3.8 3.9L2.9 10.5a1.2 1.2 0 0 0 1.7 1.7l3.9-3.9a3 3 0 0 0 3.9-3.8l-1.8 1.8-1.6-.3-.3-1.6z"/>' },
  issue:     { label: 'Issue', d: '<path d="M4 14V2.6"/><path d="M4 3h7.6l-1.6 2.6L11.6 8H4"/>' },
  price:     { label: 'Price', d: '<path d="M2.5 8.2V3a.5.5 0 0 1 .5-.5h5.2l5.3 5.3-5.7 5.7z"/><circle cx="5.5" cy="5.5" r="1"/>' },
  holiday:   { label: 'Calendar & team', d: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.6h11M5.5 2v3M10.5 2v3"/>' },
  settings:  { label: 'Settings', d: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><circle cx="6" cy="4.5" r="1.4" class="g-fill"/><circle cx="10.5" cy="8" r="1.4" class="g-fill"/><circle cx="5" cy="11.5" r="1.4" class="g-fill"/>' },
  generic:   { label: 'Change', d: '<rect x="3" y="3" width="10" height="10" rx="2.2"/><circle cx="8" cy="8" r="1.3" class="g-solid"/>' },
};

// 10×10 badges (the corner), stroked in the badge's own colour
export const VERBS = {
  new:     { label: 'new', mark: '＋', d: '<path d="M5 2.5v5M2.5 5h5"/>' },
  changed: { label: 'changed', mark: '✎', d: '<path d="M2.4 7.6l.4-1.7 3.8-3.8 1.3 1.3-3.8 3.8z"/>' },
  deleted: { label: 'deleted', mark: '✕', d: '<path d="M3 3l4 4M7 3L3 7"/>' },
  revert:  { label: 'put back', mark: '↺', d: '<path d="M3 4.2A2.6 2.6 0 1 1 3.2 6.6"/><path d="M2.4 2.4v2h2"/>' },
  start:   { label: 'started', mark: '▶', d: '<path d="M3.4 2.6v4.8L7.4 5z" class="g-solid"/>' },
  pause:   { label: 'paused', mark: '⏸', d: '<path d="M3.6 2.8v4.4M6.4 2.8v4.4"/>' },
  stop:    { label: 'stopped', mark: '■', d: '<rect x="3" y="3" width="4" height="4" class="g-solid"/>' },
};

// command → [kind, verb, setup]. setup: it changes how the farm is set up (programs, recipes, valve links, plans,
// procedures, settings) — the strip shows only those unless "All" is on; a run, an order, an issue or a price seen is a
// routine record.
const S = true, R = false;
export const COMMAND_GLYPH = {
  program_set: ['program', 'changed', S], program_add: ['program', 'new', S], program_copy: ['program', 'new', S],
  program_remove: ['program', 'deleted', S], program_restore: ['program', 'revert', S],
  formula_set: ['recipe', 'changed', S], formula_add: ['recipe', 'new', S], formula_copy: ['recipe', 'new', S],
  formula_remove: ['recipe', 'deleted', S], formula_restore: ['recipe', 'revert', S],
  irrigation_program_start: ['run', 'start', R], irrigation_pause: ['run', 'pause', R],
  irrigation_resume: ['run', 'start', R], irrigation_stop: ['run', 'stop', R],
  fert_program_start: ['tank', 'start', R], fert_pause: ['tank', 'pause', R], fert_resume: ['tank', 'start', R], fert_stop: ['tank', 'stop', R],
  climate_set: ['climate', 'changed', S],
  save_valve_zones: ['valve', 'changed', S],
  plan_position: ['plan', 'new', S], plan_succession: ['plan', 'new', S], steady_apply: ['plan', 'new', S],
  move_batch: ['plan', 'changed', S], resize_batch: ['plan', 'changed', S], change_batch_crop: ['plan', 'changed', S],
  cancel_crop_plan: ['plan', 'deleted', S], set_batch_nursery: ['plan', 'changed', S], split_zone: ['plan', 'changed', S],
  clear_zone: ['plan', 'deleted', S], apply_batch_adjustment: ['plan', 'changed', R],
  save_crop: ['crop', 'changed', S], fork_crop: ['crop', 'new', S],
  save_procedure: ['procedure', 'changed', S],
  raise_issue: ['issue', 'new', R],
  save_farm_holiday: ['holiday', 'new', S],
  save_order: ['order', 'changed', R], plan_order_line: ['order', 'changed', R],
  record_market_price: ['price', 'new', R],
  save_asset: ['asset', 'changed', S], save_maintenance_rule: ['asset', 'changed', S],
};

const SETUP_KINDS = new Set(['program', 'recipe', 'valve', 'climate', 'plan', 'crop', 'procedure', 'holiday', 'asset', 'settings']);
const FAMILY_KIND = { water: 'program', climate: 'climate', crops: 'plan', tasks: 'procedure', team: 'holiday', sales: 'order',
  equipment: 'asset', harvest: 'crop', pests: 'issue', purchasing: 'order', costs: 'price' };
const NAME_KIND = [
  [/program/, 'program'], [/formula|recipe|nutrient/, 'recipe'], [/valve/, 'valve'], [/tank|fert|mix/, 'tank'],
  [/irrigat|_run\b|run_/, 'run'], [/climate|setpoint/, 'climate'], [/plan|batch|zone|position|succession/, 'plan'],
  [/procedure|sop|task|checklist/, 'procedure'], [/order|purchase|supplier|stock/, 'order'], [/crop|variet|library/, 'crop'],
  [/asset|maintenance|equipment/, 'asset'], [/issue|pest|scout/, 'issue'], [/price|market|cost/, 'price'],
  [/holiday|team|person|people|closed_day|calendar/, 'holiday'], [/setting|config|permission|farm_/, 'settings'],
];
const NAME_VERB = [
  [/(^|_)(restore|revert|undo)(_|$)/, 'revert'], [/(^|_)(add|create|new|raise|record|fork|copy|plan)(_|$)/, 'new'],
  [/(^|_)(remove|delete|cancel|clear|drop)(_|$)/, 'deleted'], [/(^|_)(start|resume)(_|$)/, 'start'],
  [/(^|_)pause(_|$)/, 'pause'], [/(^|_)stop(_|$)/, 'stop'],
];

// { kind, verb, setup, known } for one line of the log. A put back (command 'revert') keeps the kind of its family and
// the ↺ badge; `original` (the line it puts back, when it is loaded) gives it the right kind and setup.
export function glyphOf(command, family, original = null) {
  const c = String(command || '');
  if (c === 'revert') {
    const o = original ? glyphOf(original.command, original.family) : null;
    return { kind: o?.kind || FAMILY_KIND[family] || 'generic', verb: 'revert', setup: o ? o.setup : true, known: true };
  }
  const g = COMMAND_GLYPH[c];
  if (g) return { kind: g[0], verb: g[1], setup: g[2], known: true };
  const kind = (NAME_KIND.find(([re]) => re.test(c)) || [])[1] || FAMILY_KIND[family] || 'generic';
  const verb = (NAME_VERB.find(([re]) => re.test(c)) || [])[1] || 'changed';
  return { kind, verb, setup: SETUP_KINDS.has(kind) && !['start', 'pause', 'stop'].includes(verb), known: false };
}

// the icon as SVG text: the base glyph and its verb badge (constants only: nothing of the log goes into the markup)
export function glyphSvg(kind, verb) {
  const k = KINDS[kind] || KINDS.generic, v = VERBS[verb];
  return `<svg class="tls-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${k.d}</svg>` +
    (v ? `<svg class="tls-verb tls-verb-${verb}" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><circle cx="5" cy="5" r="4.6" class="tls-verb-bg"/>${v.d}</svg>` : '');
}
export const glyphLabel = (kind, verb) => `${(KINDS[kind] || KINDS.generic).label} ${VERBS[verb]?.label || ''}`.trim();
