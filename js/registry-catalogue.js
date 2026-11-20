// The commands of the registry (AI build mode P3, docs/ai-build-mode.md; registry.js registers each one).
// No import at the top: this file and registry.js load in node too (scripts/check-registry.mjs), so a command reaches
// the page's own code only when it runs (a dynamic import, kept by the browser after the first time).
//
// A command: name, family (an ai_family code, 0285), label, kind ('farmnet' | 'rpc'), pages (routes), args (a schema per
// argument: type, required, min/max, enum, label), preview(args, ctx) → a short text, run(args, ctx) → the result,
// revert ('A' put back · 'B' a compensating action · 'C' final), anchor (its button on its page: a selector, or a
// function (args, root) → element; the default is [data-cmd="<name>"]), stageable (the AI may build it as a draft;
// false for run control and anything it may only propose), emergency (never locked: Stop, Pause, Resume).
// supabase/functions/_shared/command-catalogue.json is this list without the functions, for the assistant function:
// `node scripts/check-registry.mjs --write` writes it, and without --write checks that it agrees.

// ── FarmNet (the function `farmnet`, 0272/0283): a command is sent as { args, changes } ─────────────────────────────
// args are FarmNet's own (id = the fertigation centre, proId = a program's or a recipe's number on it); `changes` is
// the body of an edit, a copy or a new one, as the pages built it before the registry.
const fnSend = (action, fixed) => async (a, ctx) => {
  const { send } = await import('./farmnet/shell.js');
  const { changes, ...args } = a || {};
  return send(ctx.farm, action, { ...args, ...(fixed || {}) }, changes);
};
// the button of one program or recipe first (data-cmd-key = its number), else any button of the command on screen
const keyed = (name, keyOf) => (a, root) => {
  const k = keyOf(a);
  return (k != null && root.querySelector(`[data-cmd="${name}"][data-cmd-key="${String(k).replace(/["\\]/g, '')}"]`)) || root.querySelector(`[data-cmd="${name}"]`);
};

const centre = { type: 'int', required: true, min: 0, label: 'Fertigation centre' };
const proId = { type: 'int', required: true, min: 0, label: 'Program number' };
const recId = { type: 'int', required: true, min: 0, label: 'Recipe number' };
const mixer = { type: 'int', required: true, min: 0, label: 'Mixer' };
const snapshot = { type: 'uuid', required: true, label: 'Kept state' };
const IRR = ['#/farmnet/irrigation'];
const RUN = ['#/farmnet/overview', '#/farmnet/irrigation'];
const MIX = ['#/farmnet/overview', '#/farmnet/mixing'];
const what = (a, word) => `${word}${a?.changes?.name ? ` "${a.changes.name}"` : ''}`;

const FARMNET = [
  // programs and recipes: FarmNet keeps no history, the function does (0283) — every change can be put back (A)
  { name: 'program_set', family: 'water', label: 'Change an irrigation program', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId, changes: { type: 'object', required: true, label: 'What changes' } },
    preview: a => `Change program ${a.proId}: ${Object.keys(a.changes || {}).join(', ') || 'nothing'}`,
    anchor: keyed('program_set', a => a.proId) },
  { name: 'program_add', family: 'water', label: 'Add an irrigation program', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, changes: { type: 'object', required: true, label: 'Its name' } },
    preview: a => what(a, 'New program') + ', switched off' },
  { name: 'program_copy', family: 'water', label: 'Copy an irrigation program', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId, changes: { type: 'object', required: true, label: 'The copy\'s name' } },
    preview: a => what(a, `Copy of program ${a.proId}`) + ', switched off', anchor: keyed('program_copy', a => a.proId) },
  { name: 'program_remove', family: 'water', label: 'Delete an irrigation program', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId }, preview: a => `Delete program ${a.proId} (kept, to make again)`, anchor: keyed('program_remove', a => a.proId) },
  { name: 'program_restore', family: 'water', label: 'Put an irrigation program back as it was', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, snapshot }, preview: () => 'Put a program back as it was', anchor: keyed('program_restore', a => a.snapshot) },
  { name: 'formula_set', family: 'water', label: 'Change a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId: recId, changes: { type: 'object', required: true, label: 'What changes' } },
    preview: a => `Change recipe ${a.proId}: ${Object.keys(a.changes || {}).join(', ') || 'nothing'}`,
    anchor: keyed('formula_set', a => a.proId) },
  { name: 'formula_add', family: 'water', label: 'Add a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, changes: { type: 'object', required: true, label: 'Its name, EC and pH' } },
    preview: a => what(a, 'New recipe') },
  { name: 'formula_copy', family: 'water', label: 'Copy a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId: recId, changes: { type: 'object', required: true, label: 'The copy\'s name' } },
    preview: a => what(a, `Copy of recipe ${a.proId}`), anchor: keyed('formula_copy', a => a.proId) },
  { name: 'formula_remove', family: 'water', label: 'Delete a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId: recId }, preview: a => `Delete recipe ${a.proId} (kept, to make again)`, anchor: keyed('formula_remove', a => a.proId) },
  { name: 'formula_restore', family: 'water', label: 'Put a recipe back as it was', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, snapshot }, preview: () => 'Put a recipe back as it was', anchor: keyed('formula_restore', a => a.snapshot) },

  // run control: what was started is stopped, not undone (B); the AI may propose it, never build it. Stop, Pause and
  // Resume are emergency controls: never locked during a build.
  { name: 'irrigation_program_start', family: 'water', label: 'Start an irrigation program', pages: RUN, revert: 'B', stageable: false,
    args: { id: centre, proId }, preview: a => `Start program ${a.proId} now` },
  { name: 'irrigation_pause', family: 'water', label: 'Pause irrigation', pages: RUN, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, pTime: { type: 'int', required: true, min: 1, max: 86400, label: 'For how long (seconds)' } },
    preview: a => `Pause irrigation for ${Math.round(a.pTime / 60)} min` },
  { name: 'irrigation_resume', family: 'water', label: 'Resume irrigation', pages: RUN, revert: 'B', stageable: false, emergency: true,
    sends: 'irrigation_pause', fixed: { pTime: 0 }, args: { id: centre }, preview: () => 'Resume irrigation' },
  { name: 'irrigation_stop', family: 'water', label: 'Stop the current irrigation run', pages: RUN, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, type: { type: 'int', required: true, enum: [0, 3, 4], label: 'What stops (0: the current run)' },
            valveId: { type: 'int', min: 0, label: 'Valve' }, proId: { type: 'string', max: 80, label: 'Program run' } },
    preview: () => 'Stop the current irrigation run' },
  { name: 'fert_program_start', family: 'water', label: 'Start a mixing program', pages: MIX, revert: 'B', stageable: false,
    args: { id: centre, proId, runTime: { type: 'int', required: true, min: 0, max: 86400, label: 'Run time (seconds)' } },
    preview: a => `Start mixing program ${a.proId} for ${Math.round(a.runTime / 60)} min` },
  { name: 'fert_pause', family: 'water', label: 'Pause mixing', pages: MIX, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, devId: mixer, pTime: { type: 'int', required: true, min: 1, max: 86400, label: 'For how long (seconds)' } },
    preview: a => `Pause mixing for ${Math.round(a.pTime / 60)} min` },
  { name: 'fert_resume', family: 'water', label: 'Resume mixing', pages: MIX, revert: 'B', stageable: false, emergency: true,
    sends: 'fert_pause', fixed: { pTime: 0 }, args: { id: centre, devId: mixer }, preview: () => 'Resume mixing' },
  { name: 'fert_stop', family: 'water', label: 'Stop the current mixing run', pages: MIX, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, devId: mixer, type: { type: 'int', required: true, enum: [0, 3], label: 'What stops (0: the current run)' },
            proId: { type: 'string', max: 80, label: 'Program run' } },
    preview: () => 'Stop the current mixing run' },

  // climate setpoints: FarmNet's own parameters, no copy kept before a change (0283 keeps programs and recipes only) —
  // undone by setting the old values again, which the log keeps (B)
  { name: 'climate_set', family: 'climate', label: 'Change climate setpoints', pages: ['#/farmnet/climate'], revert: 'B', stageable: false,
    args: { ghId: { type: 'int', required: true, min: 0, label: 'Climate zone' }, typeId: { type: 'int', required: true, min: 0, label: 'Device type' },
            changes: { type: 'array', required: true, min: 1, max: 50, label: 'The setpoints that change' } },
    preview: a => `Change ${a.changes?.length || 0} climate setpoint${a.changes?.length === 1 ? '' : 's'}` },
].map(d => ({ kind: 'farmnet', ...d, sends: d.sends || d.name, run: fnSend(d.sends || d.name, d.fixed) }));

// ── the assistant's changes (ACTIONS in supabase/functions/assistant/index.ts, ALLOWED in assistant.js, ai_card_action):
// a database function run as the person. Revert A: P4 runs them through the capture act (0271), which puts the rows back.
const rpcRun = name => async a => { const { rpc } = await import('./api.js'); return rpc(name, a); };
const uuid = (label, required = true) => ({ type: 'uuid', required, label });
const date = (label, required = true) => ({ type: 'date', required, label });
const PLANNER = ['#/grow/planner'];
const PROCS = ['#/grow/procedures', '#/ipm/programs', '#/office/management', '#/maintenance/preventive'];

const RPC = [
  { name: 'plan_position', family: 'crops', label: 'Propose a batch', pages: PLANNER,
    args: { p_position: uuid('Position'), p_crop: uuid('Crop'), p_transplant: date('Transplant day', false) } },
  { name: 'plan_succession', family: 'crops', label: 'Propose a succession', pages: PLANNER,
    args: { p_farm: uuid('FarmBox'), p_crop: uuid('Crop'), p_first: date('First transplant'), p_every_days: { type: 'int', required: true, min: 1, label: 'Every (days)' },
            p_times: { type: 'int', required: true, min: 1, label: 'How many times' }, p_positions_each: { type: 'int', min: 1, label: 'Positions each time' },
            p_system: { type: 'string', max: 40, label: 'Zone code' } } },
  { name: 'steady_apply', family: 'crops', label: 'Plan zones for a steady harvest', pages: PLANNER,
    args: { p_farm: uuid('FarmBox'), p_zones: { type: 'array', required: true, min: 1, label: 'Zones' },
            p_objective: { type: 'string', enum: ['per_crop', 'total', 'harvests'], label: 'Objective' },
            p_horizon: { type: 'int', min: 1, max: 1000, label: 'Horizon (days)' }, p_group: uuid('Steady group', false) } },
  { name: 'move_batch', family: 'crops', label: 'Move a planned batch', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_position: uuid('Position', false), p_transplant: date('Transplant day', false) } },
  { name: 'resize_batch', family: 'crops', label: 'Change a batch\'s last harvest day', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_harvest_end: date('Last harvest day') } },
  { name: 'change_batch_crop', family: 'crops', label: 'Another crop on a planned batch', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_crop: uuid('Crop') } },
  { name: 'cancel_crop_plan', family: 'crops', label: 'Remove planned batches', pages: PLANNER,
    args: { p_ids: { type: 'array', required: true, min: 1, label: 'Batches' } } },
  { name: 'set_batch_nursery', family: 'crops', label: 'Internal or external nursery for a batch', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_nursery: { type: 'string', required: true, label: 'Nursery' } } },
  { name: 'split_zone', family: 'crops', label: 'Cut a zone into positions', pages: PLANNER,
    args: { p_system: uuid('Zone'), p_n: { type: 'int', required: true, min: 1, label: 'Positions' } } },
  { name: 'clear_zone', family: 'crops', label: 'Clear a zone', pages: PLANNER,
    args: { p_system: uuid('Zone'), p_growing: { type: 'boolean', label: 'The growing batches too' } } },
  { name: 'save_crop', family: 'crops', label: 'Change a crop', pages: ['#/grow/library'],
    args: { p_crop: uuid('Crop'), p: { type: 'object', required: true, label: 'What changes' } } },
  { name: 'fork_crop', family: 'crops', label: 'Draft a new crop from another', pages: ['#/grow/library'],
    args: { p_farm: uuid('FarmBox'), p_from: uuid('Crop to copy'), p_name: { type: 'string', required: true, min: 1, max: 120, label: 'Name' },
            p_note: { type: 'string', max: 2000, label: 'Note' } } },
  { name: 'apply_batch_adjustment', family: 'crops', label: 'Report what a growing batch looks like', pages: ['#/grow/planner', '#/grow/forecast'],
    args: { p_plan: uuid('Batch'), p_phase: { type: 'string', max: 80, label: 'Phase' }, p_days_to_harvest: { type: 'int', min: 0, max: 365, label: 'Days to harvest' },
            p_expected_kg: { type: 'number', min: 0, label: 'Expected kg' }, p_note: { type: 'string', max: 2000, label: 'Note' }, p_card: uuid('Card', false) } },
  { name: 'save_procedure', family: 'tasks', label: 'Change a procedure', pages: PROCS,
    args: { p_sop: uuid('Procedure'), p: { type: 'object', required: true, label: 'What changes' } } },
  { name: 'raise_issue', family: 'tasks', label: 'Raise an issue', pages: ['#/dashboard/issues'],
    args: { p: { type: 'object', required: true, label: 'The issue' } } },
  { name: 'save_farm_holiday', family: 'team', label: 'Add a closed day', pages: ['#/farm/zones'],
    args: { p_farm: uuid('FarmBox'), p_day: date('Day'), p_name: { type: 'string', required: true, max: 120, label: 'Name' },
            p_closed: { type: 'boolean', required: true, label: 'Closed' } } },
  { name: 'save_order', family: 'sales', label: 'Create or change a customer order', pages: ['#/office/orders'],
    args: { p: { type: 'object', required: true, label: 'The order' } } },
  { name: 'plan_order_line', family: 'sales', label: 'Plan an order line backwards from its delivery', pages: ['#/office/orders'],
    args: { p_line: uuid('Order line') } },
  { name: 'record_market_price', family: 'sales', label: 'Record a price seen', pages: ['#/office/market'],
    args: { p: { type: 'object', required: true, label: 'The price' } } },
  { name: 'save_asset', family: 'equipment', label: 'Add or change equipment', pages: ['#/maintenance/equipment'],
    args: { p: { type: 'object', required: true, label: 'The equipment' } } },
  { name: 'save_maintenance_rule', family: 'equipment', label: 'Add or change a maintenance routine', pages: ['#/maintenance/equipment'],
    args: { p: { type: 'object', required: true, label: 'The routine' } } },
].map(d => ({ kind: 'rpc', revert: 'A', stageable: true, ...d, run: rpcRun(d.name) }));

export const DEFINITIONS = [...FARMNET, ...RPC];
