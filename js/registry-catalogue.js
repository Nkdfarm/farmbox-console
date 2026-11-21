// The commands of the registry (AI build mode P3, docs/ai-build-mode.md; registry.js registers each one).
// No import at the top: this file and registry.js load in node too (scripts/check-registry.mjs), so a command reaches
// the page's own code only when it runs (a dynamic import, kept by the browser after the first time).
//
// A command: name, family (an ai_family code, 0285), label, kind ('farmnet' | 'rpc'), pages (routes), args (a schema per
// argument: type, required, min/max, enum, label, unit; an object's fields, a list's items, open, text — registry.js
// says what each means), hint (one or two lines for the AI: what to read first, the conventions, what is refused),
// preview(args, ctx) → a short text, run(args, ctx) → the result,
// revert ('A' put back · 'B' a compensating action · 'C' final), anchor (its button on its page: a selector, or a
// function (args, root) → element; the default is [data-cmd="<name>"]), stageable (the AI may build it as a draft;
// false for run control and anything it may only propose), emergency (never locked: Stop, Pause, Resume).
// supabase/functions/_shared/command-catalogue.json is this list without the functions, for the assistant function:
// `node scripts/check-registry.mjs --write` writes it, and without --write checks that it agrees. The AI manual (phase B,
// docs/plan-ai-manual-2026-11-22.md): these specs and hints are the one source of what the AI is told a command takes —
// the assistant function renders them for the model (plan.ts) and checks a plan with the same rules as registry.js.

// ── FarmNet (the function `farmnet`, 0272/0283): a command is sent as { args, changes } ─────────────────────────────
// args are FarmNet's own (id = the fertigation centre, proId = a program's or a recipe's number on it); `changes` is
// the body of an edit, a copy or a new one, as the pages built it before the registry.
const fnSend = (action, fixed) => async (a, ctx) => {
  const { send } = await import('./farmnet/shell.js');
  // diy (diy_edit): the periods and influences, sent as changes.diy (the function reads them there)
  // switch_on (diy_edit of on/off): the card's own "Switch the program on" — the function refuses 100 while the program is
  // off without it, and refuses it from the AI
  const { changes, diy, switch_on, ...args } = a || {};
  const ch = diy !== undefined ? { ...(changes || {}), diy, ...(switch_on === true ? { switch_on: true } : {}) } : changes;
  return send(ctx.farm, action, { ...args, ...(fixed || {}) }, ch, ctx.op);   // op: its row of the operation log (0286)
};
// the button of one program or recipe first (data-cmd-key = its number); then, for a command whose button lives only in
// that program's or recipe's drawer (Copy…), the row that opens the drawer (rowCmd, same key; seen live on 21 Nov 2026);
// else any button of the command on screen
const keyed = (name, keyOf, rowCmd) => (a, root) => {
  const k = keyOf(a);
  const at = cmd => k != null && root.querySelector(`[data-cmd="${cmd}"][data-cmd-key="${String(k).replace(/["\\]/g, '')}"]`);
  return at(name) || (rowCmd && at(rowCmd)) || root.querySelector(`[data-cmd="${name}"]`);
};

const centre = { type: 'int', required: true, min: 0, label: 'Fertigation centre' };
const proId = { type: 'int', required: true, min: 0, label: 'Program number' };
const recId = { type: 'int', required: true, min: 0, label: 'Recipe number' };
const mixer = { type: 'int', required: true, min: 0, label: 'Mixer' };
const snapshot = { type: 'uuid', required: true, label: 'Kept state' };
const IRR = ['#/farmnet/irrigation'];
const WIN = ['#/farmnet/irrigation'];   // the sun-cycle panel, opened from FarmNet › Irrigation (21 Nov 2026; was the Windows tab)
// SR as the program shows it: 1 on/off (EN), 3 the interval (CST), 10–19 a start slot's start (TM[].ST); a slot's end
// (20–29, TM[].ET) is never made DIY (fnlink.ts diyAddCheck: FarmNet stops answering when it is, trial of 21 Nov 2026)
const setting = { type: 'int', required: true, min: 1, max: 1000, label: 'The program setting (SR: 1 on/off, 3 interval, 10–19 a start; never 20–29, an end)' };

// ── the shapes FarmNet takes (supabase/functions/farmnet/fnlink.ts programBody, formulaBody, diyBody, climateBody; and
// farmnet/index.ts for a new program or recipe and the copies, which read only changes.name — and ec / ph of a new
// recipe). Inside them a number is a JSON number, as FarmNet's own checks want it (typeof 'number', Number.isInteger),
// except where the function compares with Number() or diy_get answers it as text ("300.00"): those say text: true.
const secs = (label, min, max, required = false) => ({ type: 'int', ...(required ? { required: true } : {}), min, max, unit: 's', label });
const fnId = label => ({ type: 'int', required: true, min: 0, text: true, label });
const fnName = required => ({ type: 'string', ...(required ? { required: true } : {}), min: 1, max: 40, label: 'Its name as FarmNet shows it' });
const runTime = secs('its run time, 20 min = 1200', 0, 14400, true);            // fnlink.ts MAX_RUN: a valve runs at most 4 h
const PROGRAM_CHANGES = {
  type: 'object', required: true, label: 'What changes',
  fields: {
    name: fnName(false),
    on: { type: 'boolean', label: 'switched on (true) or off; on only when the person asked for it in words' },
    mode: { type: 'int', enum: [0, 1], label: '0 timer, 1 cycle' },
    cmd: { type: 'int', enum: [0, 1], label: 'programs sharing a pump: 0 wait, 1 run together' },
    rsif: { type: 'boolean', label: 'irrigate once at the start time' },
    mint: secs('the minimum gap between runs', 0, 60000),
    maxt: secs('the maximum gap between runs', 0, 60000),
    days: { type: 'object', label: 'its days', fields: {
      mode: { type: 'int', required: true, enum: [0, 1, 2, 3, 4], label: '0 every day, 1 every N days, 2 weekdays, 3 odd dates, 4 even dates' },
      every: { type: 'int', min: 1, max: 365, label: 'N, for mode 1' },
      weekdays: { type: 'int', min: 1, max: 127, label: 'for mode 2: bits, Monday 1, Tuesday 2 … Sunday 64' },
      from: { type: 'date', label: 'first day' },
      to: { type: 'date', label: 'last day; "" for no end' },
    } },
    cycle: secs('a cycling program\'s interval', 60, 86400),
    starts: { type: 'array', max: 20, label: 'the start slots that change', items: { type: 'object', fields: {
      i: { type: 'int', required: true, min: 0, max: 9, label: 'the slot' },
      st: secs('its start (a cycling program: its window from), after midnight', 0, 86399),
      et: secs('a cycling program\'s window until, after midnight', 0, 86400),
      ad: { type: 'int', min: 0, max: 200, unit: '%', label: 'run-time adjustment' },
      use: { type: 'boolean', label: 'in use' },
    } } },
    valves: { type: 'array', max: 50, label: 'run times that change', items: { type: 'object', fields: {
      sid: fnId('the water source, farmnet_programs sources[].sid'), id: fnId('the valve, sources[].valves[].id'), stm: runTime,
    } } },
    recipes: { type: 'array', max: 20, label: 'the recipe of a water source', items: { type: 'object', fields: {
      sid: fnId('the water source'), fid: { type: 'int', required: true, min: -1, label: 'the recipe number; -1 none' },
    } } },
    sources: { type: 'array', max: 20, label: 'the WHOLE list of water sources and valves: replaces it', items: { type: 'object', fields: {
      sid: fnId('the water source'), fid: { type: 'int', min: -1, label: 'its recipe; -1 none' },
      valves: { type: 'array', required: true, max: 50, label: 'every valve it keeps', items: { type: 'object', fields: { id: fnId('the valve'), stm: runTime } } },
    } } },
  },
};
const RECIPE_TARGETS = {
  ec: { type: 'number', min: 0, max: 10, unit: 'mS/cm', label: 'EC target' },
  ph: { type: 'number', min: 3, max: 9, label: 'pH target' },
};
const RECIPE_CHANGES = { type: 'object', required: true, label: 'What changes', fields: {
  name: fnName(false), ...RECIPE_TARGETS,
  ratios: { type: 'array', max: 20, label: 'channel ratios that change', items: { type: 'object', fields: {
    FC: { type: 'int', required: true, text: true, label: 'the channel, FC of formula_param' },
    FR: { type: 'number', required: true, min: 0, max: 100, unit: '%', label: 'its ratio' },
  } } },
} };
const NEW_NAME = label => ({ type: 'object', required: true, label, fields: { name: fnName(true) } });
// diy_edit's diy (fnlink.ts diyBody): the periods, and the influences as diy_get answers them
const DIY_PERIOD = { type: 'object', fields: {
  en: { type: 'boolean', required: true, label: 'in use: true' },
  tp: { type: 'int', required: true, enum: [0, 1, 2], label: '0 a clock time, 1 from sunrise, 2 from sunset' },
  st: secs('tp 0: after midnight; tp 1 or 2: the offset from the sun, negative before it', -21600, 86399, true),   // fnlink.ts periodStBounds
  itm: secs('the ramp into it: 0', 0, 86400, true),
  bv: { type: 'number', required: true, text: true, label: 'its value: the interval (CST) in s; on/off (EN) 0 or 100' },
  of: { type: 'boolean', required: true, label: 'false' },
  ifl: { type: 'boolean', required: true, label: 'its influence limit: false' },
  min: { type: 'number', required: true, text: true, label: '0' },
  max: { type: 'number', required: true, text: true, label: '0' },
  he: { type: 'boolean', label: 'FarmNet\'s own, as diy_get gave it' },
} };
const perPeriod = (label, items) => ({ type: 'array', required: true, max: 30, label, items });
// open: an influence is FarmNet's own entry, echoed from diy_get with every key it answers (pN, pD, pU, mes, cal …);
// the function checks the keys below and keeps or rebuilds the rest (diyBody)
const DIY_INFLUENCE = { type: 'object', open: true, fields: {
  pId: { type: 'string', required: true, min: 1, label: 'the signal, a FarmNet source id' },
  en: perPeriod('on, per period', { type: 'boolean' }),
  iT: perPeriod('0 linear, 1 lock-out, per period', { type: 'int', enum: [0, 1] }),
  iS: perPeriod('set value, per period', { type: 'number', text: true }),
  iMin: perPeriod('minimum, per period', { type: 'number', text: true }),
  iMax: perPeriod('maximum, per period', { type: 'number', text: true }),
} };
const DIY = { type: 'object', required: true, label: 'The DIY', fields: {
  time: { type: 'array', required: true, min: 1, max: 30, label: 'every period, in order', items: DIY_PERIOD },
  influe: { type: 'array', required: true, max: 15, label: 'the influe list diy_get returned, unchanged ([] removes them all)', items: DIY_INFLUENCE },
} };
const CLIMATE_CHANGES = { type: 'array', required: true, min: 1, max: 50, label: 'The setpoints that change', items: { type: 'object', fields: {
  funId: { type: 'int', required: true, min: 0, text: true, label: 'its function block, climate_params' },
  devId: { type: 'int', required: true, min: 0, text: true, label: 'its device' },
  param: { type: 'string', required: true, min: 1, label: 'the parameter\'s N, as climate_params answers it' },
  value: { type: 'number', required: true, label: 'its new value, within FarmNet\'s L … H' },
} } };
const SNAPSHOT_HINT = 'snapshot is the copy the farmnet function kept before a change (its id in the operation log); ';
const SUN_CYCLE = 'A sun cycle: exactly three interval (SR 3) periods in this order — tp 1 st = the shift from sunrise, tp 0 st 43200 (12:00), tp 2 st = the shift from sunset, each shift within ±7200 s in steps of 900 — bv the seconds between floods, below 60000 (60000 or more = no irrigation in that period).';
const irrigationProgram = { type: 'int', required: true, enum: [0], label: 'Irrigation program (0)' };
const RUN = ['#/farmnet/overview', '#/farmnet/irrigation'];
const MIX = ['#/farmnet/overview', '#/farmnet/mixing'];
const what = (a, word) => `${word}${a?.changes?.name ? ` "${a.changes.name}"` : ''}`;

const FARMNET = [
  // programs and recipes: FarmNet keeps no history, the function does (0283) — every change can be put back (A)
  { name: 'program_set', family: 'water', label: 'Change an irrigation program', pages: [...new Set([...IRR, ...WIN])], revert: 'A', stageable: true,
    args: { id: centre, proId, changes: PROGRAM_CHANGES },
    hint: 'Read farmnet_programs (and program_param) first; send only the keys that change, every time in seconds. A valve\'s run time is stm, NEVER run_s (that is only how farmnet_programs reports it); sid and id come from farmnet_programs. sources REPLACES the whole list of water sources and valves (one left out is removed): for run times or a recipe alone use valves or recipes. on true only when the person asked for it in words.',
    preview: a => `Change program ${a.proId}: ${Object.keys(a.changes || {}).join(', ') || 'nothing'}`,
    anchor: keyed('program_set', a => a.proId) },
  { name: 'program_add', family: 'water', label: 'Add an irrigation program', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, changes: NEW_NAME('The new program') },
    hint: 'A new program with FarmNet\'s defaults, created switched off: changes takes only its name (never on); its settings are program_set steps on its number once it exists.',
    preview: a => what(a, 'New program') + ', switched off' },
  { name: 'program_copy', family: 'water', label: 'Copy an irrigation program', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId, changes: NEW_NAME('The copy') },
    hint: 'Copies program proId with all its settings into a new program, created switched off: changes takes only the copy\'s name (never on), which no program of the centre may have yet.',
    preview: a => what(a, `Copy of program ${a.proId}`) + ', switched off', anchor: keyed('program_copy', a => a.proId, 'program_set') },
  { name: 'program_remove', family: 'water', label: 'Delete an irrigation program', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId },
    hint: 'Only a program FarmNet shows switched off and neither running nor waiting; a copy is kept, to make it again.',
    preview: a => `Delete program ${a.proId} (kept, to make again)`, anchor: keyed('program_remove', a => a.proId) },
  { name: 'program_restore', family: 'water', label: 'Put an irrigation program back as it was', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, snapshot },
    hint: SNAPSHOT_HINT + 'the program is put back in place (keeping its on/off now), or made again, switched off, when it was deleted.',
    preview: () => 'Put a program back as it was', anchor: keyed('program_restore', a => a.snapshot) },
  // a program setting's DIY periods (FarmNet › Windows): the function keeps the DIY before each change (0289), so each is
  // put back (A) — diy_add by FarmNet's DIY remove, diy_edit by the periods kept. diy_edit needs the setting DIY first:
  // a build stages diy_add before it. Their buttons live in the program's sun-cycle panel: with it closed, the replay
  // highlights the program's row (program_set, keyed by its number)
  { name: 'diy_add', family: 'water', label: 'Make a program setting follow DIY periods', pages: WIN, revert: 'A', stageable: true,
    args: { id: centre, type: irrigationProgram, proId, SR: setting },
    hint: 'Only on on/off (SR 1, EN), the interval (SR 3, CST) or a start\'s start (SR 10–19, ST), never an end (ET, SR 20–29), and only when farmnet_read diy_get shows it is not DIY yet; it makes one period holding its value. diy_edit comes after it for the same setting.',
    preview: a => `Program ${a.proId}: setting ${a.SR} follows DIY periods (one, holding its value)`, anchor: keyed('diy_add', a => a.proId, 'program_set') },
  { name: 'diy_edit', family: 'water', label: 'Change the DIY periods of a program setting', pages: WIN, revert: 'A', stageable: true,
    args: { id: centre, type: irrigationProgram, proId, SR: setting, diy: DIY,
            switch_on: { type: 'boolean', label: 'Switch the program on (on/off only; a person only, never the AI)' } },
    hint: 'Read diy_get on the same setting first and send every period back, changing only what changes; influe is the influe list diy_get returned, unchanged ([] removes FarmNet\'s influences). ' + SUN_CYCLE + ' On/off (SR 1) periods are 0 or 100 — 0 on a program that is off (every copy and new program is): the AI never switches a program on and never sends switch_on.',
    preview: a => `Program ${a.proId}: setting ${a.SR}, ${a.diy?.time?.length ?? 0} period${a.diy?.time?.length === 1 ? '' : 's'}, ${a.diy?.influe?.length ?? 0} influence${a.diy?.influe?.length === 1 ? '' : 's'}`,
    anchor: keyed('diy_edit', a => a.proId, 'program_set') },
  // its arguments carry no program number (the copy knows it), so its own button, keyed by the copy, else any of them
  { name: 'diy_restore', family: 'water', label: 'Put the DIY periods of a program setting back as they were', pages: WIN, revert: 'A', stageable: true,
    args: { id: centre, snapshot },
    hint: SNAPSHOT_HINT + 'the setting gets back the periods kept, or its plain value when it was not DIY then.',
    preview: () => 'Put the DIY periods of a program setting back as they were', anchor: keyed('diy_restore', a => a.snapshot) },
  { name: 'formula_set', family: 'water', label: 'Change a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId: recId, changes: RECIPE_CHANGES },
    hint: 'Read farmnet_programs (formula_param for its channels) first; send only what changes. EC and pH stay inside the ranges of the crops on the valves the recipe waters (valve_crops, crop_ranges); a channel\'s ratio by its FC.',
    preview: a => `Change recipe ${a.proId}: ${Object.keys(a.changes || {}).join(', ') || 'nothing'}`,
    anchor: keyed('formula_set', a => a.proId) },
  { name: 'formula_add', family: 'water', label: 'Add a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, changes: { type: 'object', required: true, label: 'The new recipe', fields: { name: fnName(true), ...RECIPE_TARGETS } } },
    hint: 'A new recipe with FarmNet\'s defaults: its name, and its EC and pH targets inside the ranges of the crops it is for; name those valves on the step (valves).',
    preview: a => what(a, 'New recipe') },
  { name: 'formula_copy', family: 'water', label: 'Copy a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId: recId, changes: NEW_NAME('The copy') },
    hint: 'Copies recipe proId with all its settings into a new recipe: changes takes only the copy\'s name, which no recipe of the centre may have yet; change its targets with formula_set once it exists.',
    preview: a => what(a, `Copy of recipe ${a.proId}`), anchor: keyed('formula_copy', a => a.proId, 'formula_set') },
  { name: 'formula_remove', family: 'water', label: 'Delete a recipe', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, proId: recId },
    hint: 'Only a recipe no irrigation or mixing program uses and no mixer is mixing now; a copy is kept, to make it again.',
    preview: a => `Delete recipe ${a.proId} (kept, to make again)`, anchor: keyed('formula_remove', a => a.proId) },
  { name: 'formula_restore', family: 'water', label: 'Put a recipe back as it was', pages: IRR, revert: 'A', stageable: true,
    args: { id: centre, snapshot },
    hint: SNAPSHOT_HINT + 'the recipe is put back in place, or made again when it was deleted.',
    preview: () => 'Put a recipe back as it was', anchor: keyed('formula_restore', a => a.snapshot) },

  // run control: what was started is stopped, not undone (B); the AI may propose it, never build it. Stop, Pause and
  // Resume are emergency controls: never locked during a build.
  { name: 'irrigation_program_start', family: 'water', label: 'Start an irrigation program', pages: RUN, revert: 'B', stageable: false,
    args: { id: centre, proId }, hint: 'Run control: the AI may propose it as a card a person presses (read farmnet_programs and irrigation_status first), never build it.',
    preview: a => `Start program ${a.proId} now` },
  { name: 'irrigation_pause', family: 'water', label: 'Pause irrigation', pages: RUN, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, pTime: { type: 'int', required: true, min: 1, max: 86400, unit: 's', label: 'For how long (seconds)' } },
    hint: 'Run control, an emergency control (the AI may propose it as a card a person presses, never build it): pTime in seconds; irrigation_resume ends it.',
    preview: a => `Pause irrigation for ${Math.round(a.pTime / 60)} min` },
  { name: 'irrigation_resume', family: 'water', label: 'Resume irrigation', pages: RUN, revert: 'B', stageable: false, emergency: true,
    sends: 'irrigation_pause', fixed: { pTime: 0 }, args: { id: centre }, hint: 'Run control, an emergency control (the AI may propose it as a card a person presses, never build it): ends a pause.',
    preview: () => 'Resume irrigation' },
  { name: 'irrigation_stop', family: 'water', label: 'Stop the current irrigation run', pages: RUN, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, type: { type: 'int', required: true, enum: [0, 3, 4], label: 'What stops (0: the current run)' },
            valveId: { type: 'int', min: 0, label: 'Valve' }, proId: { type: 'string', max: 80, label: 'Program run' } },
    hint: 'Run control, an emergency control (the AI may propose it as a card a person presses, never build it): type 0 stops the current run.',
    preview: () => 'Stop the current irrigation run' },
  { name: 'fert_program_start', family: 'water', label: 'Start a mixing program', pages: MIX, revert: 'B', stageable: false,
    args: { id: centre, proId, runTime: { type: 'int', required: true, min: 0, max: 86400, unit: 's', label: 'Run time (seconds)' } },
    hint: 'Run control: the AI may propose it as a card a person presses (read fert_programs and fert_manual first), never build it.',
    preview: a => `Start mixing program ${a.proId} for ${Math.round(a.runTime / 60)} min` },
  { name: 'fert_pause', family: 'water', label: 'Pause mixing', pages: MIX, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, devId: mixer, pTime: { type: 'int', required: true, min: 1, max: 86400, unit: 's', label: 'For how long (seconds)' } },
    hint: 'Run control, an emergency control (the AI may propose it as a card a person presses, never build it): pTime in seconds; fert_resume ends it.',
    preview: a => `Pause mixing for ${Math.round(a.pTime / 60)} min` },
  { name: 'fert_resume', family: 'water', label: 'Resume mixing', pages: MIX, revert: 'B', stageable: false, emergency: true,
    sends: 'fert_pause', fixed: { pTime: 0 }, args: { id: centre, devId: mixer }, hint: 'Run control, an emergency control (the AI may propose it as a card a person presses, never build it): ends a pause.',
    preview: () => 'Resume mixing' },
  { name: 'fert_stop', family: 'water', label: 'Stop the current mixing run', pages: MIX, revert: 'B', stageable: false, emergency: true,
    args: { id: centre, devId: mixer, type: { type: 'int', required: true, enum: [0, 3], label: 'What stops (0: the current run)' },
            proId: { type: 'string', max: 80, label: 'Program run' } },
    hint: 'Run control, an emergency control (the AI may propose it as a card a person presses, never build it): type 0 stops the current run.',
    preview: () => 'Stop the current mixing run' },

  // climate setpoints: FarmNet's own parameters, no copy kept before a change (0283 keeps programs and recipes only) —
  // undone by setting the old values again, which the log keeps (B)
  { name: 'climate_set', family: 'climate', label: 'Change climate setpoints', pages: ['#/farmnet/climate'], revert: 'B', stageable: false,
    args: { ghId: { type: 'int', required: true, min: 0, label: 'Climate zone' }, typeId: { type: 'int', required: true, min: 0, label: 'Device type' },
            changes: CLIMATE_CHANGES },
    hint: 'Read farmnet_read climate_params (ghId, typeId) first; each change names its funId, devId and parameter N as FarmNet answers them, its value within L … H. The AI may propose it as a card a person presses, never build it.',
    preview: a => `Change ${a.changes?.length || 0} climate setpoint${a.changes?.length === 1 ? '' : 's'}` },
].map(d => ({ kind: 'farmnet', ...d, sends: d.sends || d.name, run: fnSend(d.sends || d.name, d.fixed) }));

// ── the assistant's changes (ACTIONS in supabase/functions/assistant/index.ts, ALLOWED in assistant.js, ai_card_action):
// a database function run as the person through the server door public.run_command (0286): the door opens a capture act
// (0271), so every row it touches is kept before and after and Revert on the Timeline puts them back (class A), and it
// writes the operation row. The door answers { ok, op_id, act_id, changes, result } or { ok: false, error, code }; run
// gives the function's own result back, as the direct call did.
const farmIdOf = ctx => { const f = typeof ctx?.farm === 'function' ? ctx.farm() : ctx?.farm; return f?.id || null; };
const rpcRun = name => async (a, ctx) => {
  const { rpc } = await import('./api.js');
  const op = ctx?.op || {};
  const r = await rpc('run_command', { p_command: name, p_args: a || {}, p_group: op.group || null, p_actor: op.actor || 'human',
    p_source: op.source || 'console', p_page: op.page || null, p_summary: op.summary || null, p_farm: farmIdOf(ctx) });
  if (!r || r.ok !== true) { const e = new Error(r?.error || 'The change was refused'); e.code = r?.code || null; throw e; }
  return r.result;
};
const uuid = (label, required = true) => ({ type: 'uuid', required, label });
const date = (label, required = true) => ({ type: 'date', required, label });
const PLANNER = ['#/grow/planner'];
const PROCS = ['#/grow/procedures', '#/ipm/programs', '#/office/management', '#/maintenance/preventive'];

// ── the shapes of the database functions' p (the latest create or replace function app.<name> in supabase/migrations;
// the CHECK constraints of the tables for the lists of values). Inside p a number is a JSON number.
const id = label => ({ type: 'uuid', label });
const str = (label, o = {}) => ({ type: 'string', ...o, ...(label ? { label } : {}) });
const strings = label => ({ type: 'array', items: { type: 'string' }, label });
const farm = { type: 'uuid', required: true, label: 'the FarmBox' };
// app.save_order (20260925110000_orders_rotation)
const ORDER = { type: 'object', required: true, label: 'The order', fields: {
  id: id('omit for a new order'), farm_id: farm, customer: str('who it is for', { required: true, min: 1 }), notes: str(),
  lines: { type: 'array', required: true, label: 'its WHOLE list of lines', items: { type: 'object', fields: {
    id: id('a line that stays: its id; omit for a new one'), crop_id: id('the crop (a new line)'),
    qty_kg: { type: 'number', required: true, min: 0, unit: 'kg' }, delivery_date: date('delivery day'),
    repeat_weeks: { type: 'int', min: 1, label: 'repeat every n weeks' }, repeat_times: { type: 'int', min: 1, label: 'how many deliveries' },
    system_code: str('a zone code to grow it in'), notes: str(),
  } } },
} };
// app.raise_issue (20260913130000_prices_reports_network)
const ISSUE = { type: 'object', required: true, label: 'The issue', fields: {
  farm_id: farm, title: str(null, { required: true, min: 1 }), detail: str(),
  severity: str(null, { enum: ['low', 'medium', 'high', 'critical'] }),
  origin: str('"manual"', { enum: ['manual', 'step_result', 'voice_note', 'sensor', 'system'] }),
  asset_id: id('equipment'), system_id: id('a zone'), position_id: id('a position'),
} };
// app.save_asset (20260913110000_maintenance_purchasing; asset's CHECKs in 20260912090200_master_data)
const ASSET = { type: 'object', required: true, label: 'The equipment', fields: {
  id: id('omit to add'), farm_id: farm, zone_id: id('where it is'), code: str(), name: str(),
  type: str(null, { enum: ['pump', 'filter', 'dosing_unit', 'fan', 'light', 'tank', 'vehicle', 'controller', 'other'] }),
  meter_unit: str('hours, km …'), meter_value: { type: 'number', min: 0 }, status: str(null, { enum: ['active', 'maintenance', 'retired'] }),
} };
// app.save_maintenance_rule (20260913110000_maintenance_purchasing)
const RULE = { type: 'object', required: true, label: 'The routine', fields: {
  id: id('omit to add'), farm_id: farm, asset_id: id('the equipment'), system_id: id('a zone'), sop_id: id('its procedure'), name: str(),
  every_days: { type: 'int', min: 1, unit: 'days' }, every_meter: { type: 'number', min: 0, label: 'or every so much on its meter' },
  last_done: date('last done', false), priority: str(null, { enum: ['critical', 'high', 'normal', 'low'] }), active: { type: 'boolean' },
} };
// app.record_market_price (20261013110000_prices_own_farm_per_kg; market_price's CHECKs in 20260912090300_crops)
const PRICE = { type: 'object', required: true, label: 'The price', fields: {
  farm_id: farm, crop_id: { type: 'uuid', required: true, label: 'the crop' }, price: { type: 'number', required: true, min: 0, unit: 'ZAR', label: 'above zero' },
  unit: str(null, { enum: ['kg', 'piece', 'bunch', 'punnet'] }), channel: str(null, { enum: ['direct', 'market', 'retail'] }),
  source: str('where it was seen; default own sale'), observed_at: date('the day seen', false),
  month: { type: 'int', min: 1, max: 12 }, year: { type: 'int', min: 2000, max: 2100 },
} };
// app.save_procedure (20260924110000_routine_schedule): only the fields that change
const PROCEDURE = { type: 'object', required: true, label: 'What changes', fields: {
  title: str(null, { min: 1 }), family: str('a task family (Settings › Task families)'), category: str(),
  frequency: str(null, { enum: ['Routine', 'Daily', 'Weekly', 'Monthly', 'Per batch', 'Per crop template', 'On demand'] }),
  frequency_rule: str(), repeat_days: { type: 'array', items: { type: 'int', min: 1, max: 7 }, label: 'days of the week, 1 Monday … 7 Sunday' },
  repeat_weeks: { type: 'int', min: 1, max: 52 }, on_closed_days: { type: 'boolean' },
  target_kind: str('one task for each', { enum: ['system', 'area', 'farm', 'crop', 'position'] }), slot: str(null, { enum: ['am', 'pm', 'any'] }),
  one_task: { type: 'boolean' }, variant_of: id('the procedure it varies'), area_kinds: strings(), systems: strings(),
  trigger_kind: str(), validation: str(), estimated_minutes: { type: 'number', min: 0, unit: 'min' }, min_workers: { type: 'int', min: 1 },
  purpose: str(), safety_ppe: str(), tools: str(), app_ready: { type: 'boolean' }, change_note: str(),
  status: str('a person\'s, never the AI\'s', { enum: ['draft', 'approved', 'archived'] }),
  // open: a checklist step has many keys of its own (section, instruction, type, expected, min, max, unit, evidence,
  // critical, minutes, action_plan, from_seq) and the AI never sends steps (a new version, approved by a person: run_command)
  steps: { type: 'array', label: 'its checklist, a person\'s, never the AI\'s', items: { type: 'object', open: true, fields: { title: str(null, { required: true, min: 1 }) } } },
} };
// app.save_crop (20260921220000_crop_categories_archive): only the fields that change
const CROP = { type: 'object', required: true, label: 'What changes', fields: {
  name: str(null, { min: 1, max: 120 }), variety: str(), category: str(), notes: str(), rotation_group: str(),
  media: { type: 'array', min: 1, items: { type: 'string' }, label: 'its growing media' },
  sell_unit: str(null, { enum: ['kg', 'piece', 'bunch', 'punnet'] }), grams_per_unit: { type: 'number', min: 0, unit: 'g' },
  plugs_per_tray: { type: 'int', min: 1 }, seedling_lead_days: { type: 'int', min: 0, unit: 'days' },
  phases: { type: 'array', label: 'its WHOLE cycle, in order', items: { type: 'object', fields: {
    name: str(null, { required: true, min: 1 }),
    type: str(null, { enum: ['germination', 'nursery', 'transplant', 'vegetative', 'flowering', 'harvest_window', 'cleanup'] }),
    days: { type: 'number', min: 0, unit: 'days' }, cues: str(),
    procedures: { type: 'array', label: 'omit to keep those of the phase of the same name', items: { type: 'object', fields: {
      sop_id: { type: 'uuid', required: true, label: 'the procedure' }, day_offset: { type: 'int', unit: 'days' }, repeat_days: { type: 'int', min: 0, unit: 'days' },
    } } },
  } } },
  yields: { type: 'array', label: 'per growing system', items: { type: 'object', fields: {
    system_type: str('a system type code', { required: true, min: 1 }), yield_per_position: { type: 'number', min: 0, unit: 'kg' },
    yield_per_m2_cycle: { type: 'number', min: 0, unit: 'kg/m²' },
  } } },
  status: str('a person\'s, never the AI\'s', { enum: ['draft', 'approved', 'archived'] }),
} };

const RPC = [
  { name: 'plan_position', family: 'crops', label: 'Propose a batch', pages: PLANNER,
    args: { p_position: uuid('Position'), p_crop: uuid('Crop'), p_transplant: date('Transplant day', false) },
    hint: 'Read crop_plan first: a free position and an approved crop whose growing medium is the zone\'s.' },
  { name: 'plan_succession', family: 'crops', label: 'Propose a succession', pages: PLANNER,
    args: { p_farm: uuid('FarmBox'), p_crop: uuid('Crop'), p_first: date('First transplant'), p_every_days: { type: 'int', required: true, min: 1, unit: 'days', label: 'Every (days)' },
            p_times: { type: 'int', required: true, min: 1, label: 'How many times' }, p_positions_each: { type: 'int', min: 1, label: 'Positions each time' },
            p_system: { type: 'string', max: 40, label: 'Zone code' } },
    hint: 'p_system is a zone code (omit for any zone); read crop_plan first.' },
  { name: 'steady_apply', family: 'crops', label: 'Plan zones for a steady harvest', pages: PLANNER,
    args: { p_farm: uuid('FarmBox'), p_zones: { type: 'array', required: true, min: 1, label: 'Zones', items: { type: 'object', fields: {
              system_id: { type: 'uuid', required: true, label: 'the zone' }, crop_id: { type: 'uuid', required: true, label: 'its one crop' },
              n: { type: 'int', min: 1, label: 'positions, from the zone\'s splits' } } } },
            p_objective: { type: 'string', enum: ['per_crop', 'total', 'harvests'], label: 'Objective' },
            p_horizon: { type: 'int', min: 1, max: 1000, unit: 'days', label: 'Horizon (days)' }, p_group: uuid('Steady group', false) },
    hint: 'Read steady_preview first. One crop a zone, each position replanted on a fixed weekly rhythm; a zone is in one steady group at a time. p_group: omit for a new group, or the id from crop_timeline.steady_groups to change that group (its zones are replaced by p_zones).' },
  { name: 'move_batch', family: 'crops', label: 'Move a planned batch', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_position: uuid('Position', false), p_transplant: date('Transplant day', false) },
    hint: 'Read crop_plan first; give the position, the transplant day, or both.' },
  { name: 'resize_batch', family: 'crops', label: 'Change a batch\'s last harvest day', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_harvest_end: date('Last harvest day') } },
  { name: 'change_batch_crop', family: 'crops', label: 'Another crop on a planned batch', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_crop: uuid('Crop') } },
  { name: 'cancel_crop_plan', family: 'crops', label: 'Remove planned batches', pages: PLANNER,
    args: { p_ids: { type: 'array', required: true, min: 1, label: 'Batches', items: { type: 'uuid', label: 'a batch id from crop_plan' } } } },
  { name: 'set_batch_nursery', family: 'crops', label: 'Internal or external nursery for a batch', pages: PLANNER,
    args: { p_plan: uuid('Batch'), p_nursery: { type: 'string', required: true, label: 'Nursery' } } },
  { name: 'split_zone', family: 'crops', label: 'Cut a zone into positions', pages: PLANNER,
    args: { p_system: uuid('Zone'), p_n: { type: 'int', required: true, min: 1, label: 'Positions' } },
    hint: 'n equal positions, whole or half rows, from the zone\'s splits (farm_setup).' },
  { name: 'clear_zone', family: 'crops', label: 'Clear a zone', pages: PLANNER,
    args: { p_system: uuid('Zone'), p_growing: { type: 'boolean', label: 'The growing batches too' } } },
  { name: 'save_crop', family: 'crops', label: 'Change a crop', pages: ['#/grow/library'],
    args: { p_crop: uuid('Crop'), p: CROP },
    hint: 'Read crop_details first; p holds only the fields that change. phases and yields, when given, are the whole lists (a phase keeps the procedures of the phase of the same name unless it lists its own). Never status: approving or archiving is a person\'s.' },
  { name: 'fork_crop', family: 'crops', label: 'Draft a new crop from another', pages: ['#/grow/library'],
    args: { p_farm: uuid('FarmBox'), p_from: uuid('Crop to copy'), p_name: { type: 'string', required: true, min: 1, max: 120, label: 'Name' },
            p_note: { type: 'string', max: 2000, label: 'Note' } },
    hint: 'Only a manager or the agronomist; call crop_library first (a name that is, or is too close to, one in the library is refused) and crop_readiness on the crop to copy. It makes a DRAFT with that crop\'s structure; its numbers are the SOURCE crop\'s and marked so: say so, never present them as the new crop\'s.' },
  { name: 'apply_batch_adjustment', family: 'crops', label: 'Report what a growing batch looks like', pages: ['#/grow/planner', '#/grow/forecast'],
    args: { p_plan: uuid('Batch'), p_phase: { type: 'string', max: 80, label: 'Phase' }, p_days_to_harvest: { type: 'int', min: 0, max: 365, unit: 'days', label: 'Days to harvest' },
            p_expected_kg: { type: 'number', min: 0, unit: 'kg', label: 'Expected kg' }, p_note: { type: 'string', max: 2000, label: 'Note' }, p_card: uuid('Card', false) },
    hint: 'A batch that is validated or growing (read crop_plan first); any member of the farm may. Send only what changed; p_days_to_harvest counts from today to its first harvest. Above the limit the FarmBox has set, a manager decides.' },
  { name: 'save_procedure', family: 'tasks', label: 'Change a procedure', pages: PROCS,
    args: { p_sop: uuid('Procedure'), p: PROCEDURE },
    hint: 'Read procedure_details first; p holds only the fields that change. Never status or steps: approving, and a checklist changed as a new version, are a person\'s.' },
  { name: 'raise_issue', family: 'tasks', label: 'Raise an issue', pages: ['#/dashboard/issues'],
    args: { p: ISSUE }, hint: 'origin "manual" for an issue the AI raises.' },
  { name: 'save_farm_holiday', family: 'team', label: 'Add a closed day', pages: ['#/farm/zones'],
    args: { p_farm: uuid('FarmBox'), p_day: date('Day'), p_name: { type: 'string', required: true, max: 120, label: 'Name' },
            p_closed: { type: 'boolean', required: true, label: 'Closed' } } },
  // a FarmNet valve's zones and positions (0288, AI build mode P6): a fact of the layout, kept on the platform. The AI may
  // propose it (a card the person presses), never build it: a build could unlink a valve and loosen its own range check
  { name: 'save_valve_zones', family: 'water', label: 'Link a valve to the zones it waters', pages: IRR, stageable: false,
    args: { p_farm: uuid('FarmBox'), p_centre: { type: 'int', required: true, min: 0, label: 'Fertigation centre' },
            p_valve: { type: 'int', required: true, min: 0, label: 'Valve' },
            p_valve_name: { type: 'string', required: true, min: 1, max: 120, label: 'Valve name' },
            p_targets: { type: 'array', required: true, max: 200, label: 'Zones and positions', items: { type: 'object', fields: {
              system_id: { type: 'uuid', required: true, label: 'a zone (bay)' }, position_id: id('one of its positions; omit for the whole zone'),
            } } } },
    hint: 'Its whole set of zones and positions, replaced: [] unlinks the valve. p_centre, p_valve and p_valve_name as FarmNet names them (farmnet_programs); read valve_crops and farm_setup first.',
    preview: a => { const n = (a?.p_targets || []).length; return `Valve ${a?.p_valve_name || a?.p_valve} waters ${n} zone${n === 1 ? '' : 's'} or position${n === 1 ? '' : 's'}`; },
    anchor: keyed('save_valve_zones', a => a.p_valve) },
  { name: 'save_order', family: 'sales', label: 'Create or change a customer order', pages: ['#/office/orders'],
    args: { p: ORDER },
    hint: 'Read orders (and order_check) first. lines is the WHOLE list: a line left out is cancelled, with its planned batches; a line that stays keeps its id.' },
  { name: 'plan_order_line', family: 'sales', label: 'Plan an order line backwards from its delivery', pages: ['#/office/orders'],
    args: { p_line: uuid('Order line') } },
  { name: 'record_market_price', family: 'sales', label: 'Record a price seen', pages: ['#/office/market'],
    args: { p: PRICE },
    hint: 'A price is kept per kg: unit kg, or piece|bunch|punnet only when it is the unit the crop is sold by and the crop has grams per unit (prices: sell_unit, grams_per_unit); else ask for the price per kg.' },
  { name: 'save_asset', family: 'equipment', label: 'Add or change equipment', pages: ['#/maintenance/equipment'],
    args: { p: ASSET }, hint: 'Read maintenance first; id only to change one.' },
  { name: 'save_maintenance_rule', family: 'equipment', label: 'Add or change a maintenance routine', pages: ['#/maintenance/equipment'],
    args: { p: RULE }, hint: 'Read maintenance first; id only to change one; every_days or every_meter says when it is due.' },
].map(d => ({ kind: 'rpc', revert: 'A', stageable: true, ...d, run: rpcRun(d.name) }));

// ── the cards of phase F (0291, owner 22 Nov 2026: "cards for every function needed"): database functions the AI may
// only PROPOSE — a card the person presses (run_command as the person), never a build step (ai_build false, so
// stageable false). revert is the card's class in ai_card_action: A records a fact, B adjusts one row, C replaces or
// removes; a class D (a definition, spending or safety: a card to confirm) is C here — final, never offered as put back.
// Their shapes are the latest create or replace function of each in supabase/migrations (read 22 Nov 2026).
const BOARD = ['#/week/board'];
const SCOUT = ['#/ipm/scouting'];
const CASE = ['#/ipm/scouting', '#/dashboard/issues'];
const SLOT = { type: 'string', enum: ['am', 'pm', 'any'], label: 'morning, afternoon or any time' };
const PEST_CODES = 'a pest_catalog code: whitefly, thrips, aphid, fungus_gnat, shore_fly, leafminer, spider_mite, caterpillar, mealybug, slug_snail, other_pest, powdery_mildew, downy_mildew, botrytis, pythium, fusarium, bacterial_spot, leaf_spot, virus, damping_off, other_disease, tipburn, nutrient_def, nutrient_burn, sunscald, bolting, oedema, mechanical, other_disorder, predator, healthy';
const PHASES = ['germination', 'nursery', 'transplant', 'vegetative', 'flowering', 'harvest_window', 'cleanup'];
const CATEGORIES = ['fruiting_vines', 'fruiting_bush', 'leafy', 'mixed_leafy', 'herbs', 'microgreens'];
const uuids = (label, o = {}) => ({ type: 'array', items: { type: 'uuid' }, max: 200, label, ...o });
const num = (label, o = {}) => ({ type: 'number', ...o, ...(label ? { label } : {}) });
const int = (label, o = {}) => ({ type: 'int', ...o, ...(label ? { label } : {}) });
// app.add_hand_task (20261023233000_tasks_by_hand)
const HAND_TASK = { type: 'object', required: true, label: 'The task', fields: {
  farm_id: farm, title: str(null, { required: true, min: 1, max: 200 }),
  family: str('a task family as the board names it (Agriculture, Maintenance, Office …)', { required: true, min: 1 }),
  category: str('a sub-family of that family'), starts_on: date('its first day, today to a year ahead'),
  every_days: int('repeat every n days; omit for once', { min: 1, max: 365 }), ends_on: date('last day of the repeats', false),
  area_id: id('an area of the farm'), worker_id: id('who does it (team_setup)'), slot: SLOT,
  priority: str(null, { enum: ['critical', 'high', 'normal', 'low'] }), minutes: num('how long', { min: 1, max: 720, unit: 'min' }), notes: str(),
} };
// app.open_case (20260924160000_pest_cases, 20261022150000_photo_feed)
const CASE_NEW = { type: 'object', required: true, label: 'The case', fields: {
  farm_id: farm, code: str(PEST_CODES, { required: true, min: 1 }), zone_id: id('the zone (scouting_day)'), crop_id: id('the crop'),
  severity: int('0–3', { min: 0, max: 3 }), note: str(null, { max: 2000 }),
  from_kind: str('the first point: a plant photo or a trap reading', { enum: ['observation', 'trap'] }), from_id: id('its id (scouting_day)'),
} };
// app.save_sticky_trap (20260922140000_ipm_traps)
const TRAP = { type: 'object', required: true, label: 'The trap', fields: {
  id: id('omit to add'), farm_id: farm, code: str('its code, unique on the farm', { required: true, min: 1, max: 20 }),
  zone_id: id('its zone'), system_id: id('its growing system'), row_label: str(), metres: num('along the row', { min: 0, unit: 'm' }),
  colour: str(null, { enum: ['yellow', 'blue'] }), width_cm: num(null, { min: 1, unit: 'cm' }), height_cm: num(null, { min: 1, unit: 'cm' }),
  active: { type: 'boolean' }, installed_at: date('installed on', false), notes: str(),
} };
// app.save_spray_volume (20261029210000_spray_volume)
const SPRAY = { type: 'object', required: true, label: 'The volume', fields: {
  id: id('a line to change; omit to add'), l_per_ha: num('water per hectare', { required: true, min: 10, max: 10000, unit: 'L/ha', text: true }),
  crop_id: id('a crop grown here; or crop_category'), crop_category: str(null, { enum: CATEGORIES }),
  phase_type: str('omit for any phase', { enum: PHASES }), note: str(null, { max: 500 }),
} };
// app.start_ipm_program (20261002170000_ipm_library, 20261029210000_spray_volume)
const IPM_START = { type: 'object', required: true, label: 'The treatment', fields: {
  farm_id: farm, zone_id: id('the zone; from the case when issue_id is given'), issue_id: id('the pest case it treats'),
  template_id: id('a programme of the IPM library (then steps are not sent)'),
  steps: { type: 'array', max: 20, label: 'its applications, without a template', items: { type: 'object', fields: {
    product_id: { type: 'uuid', required: true, label: 'a product of the farm' }, seq: int(null, { min: 1 }), day_offset: int('days after the start', { min: 0 }),
    interval_days: int(null, { min: 1, max: 90, unit: 'days' }), applications: int(null, { min: 1, max: 52 }),
    rate_value: num(null, { min: 0 }), rate_unit: str(), rate_per: str(null, { enum: ['m2', 'ha', '100L', 'L', 'plant'] }), rate_text: str(), note: str(),
  } } },
  system_id: id('a growing system of the zone'), position_ids: uuids('the tables; omit for every table of the zone'),
  start_date: date('first day', false), water_l_per_ha: num('spray water', { min: 10, max: 10000, unit: 'L/ha' }),
  // open: its keys are "<step seq>/<repetition>" (1/1, 1/2 …), each the spray water of that application in L/ha (10–10000)
  water_by: { type: 'object', open: true, label: 'per application "seq/repetition": L/ha' },
  name: str(), note: str(), target: str(PEST_CODES),
} };
// app.save_program (20260924160000_pest_cases)
const CASE_PROGRAM = { type: 'object', required: true, label: 'The programme', fields: {
  id: id('a programme to change; omit to add'), issue_id: { type: 'uuid', required: true, label: 'the pest case, also on a change' }, name: str(null, { max: 120 }), product: str(null, { max: 120 }),
  method: str(null, { enum: ['biological', 'chemical', 'cultural', 'mechanical'] }), rate: str(),
  interval_days: int(null, { min: 1, max: 90, unit: 'days' }), applications: int(null, { min: 1, max: 52 }), withholding_days: int(null, { min: 0, max: 180, unit: 'days' }),
  start_date: date('first day', false), note: str(), sop_id: id('its procedure'),
} };
// app.save_item (20260929120000_stock_orders)
const ITEM = { type: 'object', required: true, label: 'The item', fields: {
  id: id('omit to add'), name: str('needed to add one', { max: 120 }), code: str(),
  category: str(null, { enum: ['seedling', 'seed', 'medium', 'nutrient', 'pot_cap', 'packaging', 'consumable', 'equipment', 'crop_protection'] }),
  unit: str(), pack_size: num('above zero', { min: 0 }), unit_cost: num(null, { min: 0, unit: 'ZAR' }),
  reorder_point: num(null, { min: 0 }), reorder_qty: num(null, { min: 0 }), safety_days: int(null, { min: 0, unit: 'days' }), notes: str(), active: { type: 'boolean' },
} };
// app.save_customer (20260929110000_customers): on a change every text key is written as sent
const CUSTOMER = { type: 'object', required: true, label: 'The customer', fields: {
  id: id('omit to add'), name: str(null, { required: true, min: 1, max: 120 }),
  kind: str(null, { enum: ['direct', 'super_user', 'restaurant', 'retailer', 'community', 'market_agent', 'other'] }),
  contact_person: str(), phone: str(), email: str(), address: str(), route: str(), notes: str(),
  channel: str(null, { enum: ['direct', 'retail'] }), price_factor: num(null, { min: 0, max: 5 }), payment_terms_days: int(null, { min: 0, max: 180, unit: 'days' }),
  credit_limit: num(null, { min: 0 }), subscription_kg: num(null, { min: 0, unit: 'kg' }), subscription_active: { type: 'boolean' },
  referred_by: id('another customer'), active: { type: 'boolean' },
} };
// app.save_cost (20260929150000_money); source is the platform's (manual, import, a purchase order): never sent
const COST = { type: 'object', required: true, label: 'The cost', fields: {
  id: id('omit to add'), amount: num(null, { required: true, min: 0, unit: 'ZAR' }), day: date('the day; default today', false),
  category: str(null, { enum: ['seedlings', 'materials', 'nutrients', 'labour', 'energy', 'water', 'rent', 'equipment', 'maintenance', 'transport',
                               'packaging', 'marketing', 'admin', 'insurance', 'finance', 'other'] }),
  kind: str(null, { enum: ['direct', 'indirect'] }), description: str(), supplier: str(), crop_plan_id: id('the batch'), zone_id: id('the zone'),
} };
// app.save_sump_reading (20261002100000_sump_readings_photo_removal)
const SUMP = { type: 'object', required: true, label: 'The reading', fields: {
  sump_id: { type: 'uuid', required: true, label: 'the sump (an area of kind sump)' }, at: str('when, with its offset: 2026-11-22T08:00+02:00; default now'),
  ec: num(null, { min: 0, max: 10, unit: 'mS/cm' }), ph: num(null, { min: 0, max: 14 }), water_temp: num(null, { min: 0, max: 50, unit: '°C' }), note: str(),
  remove: { type: 'boolean', label: 'true with id: remove a reading typed by hand' }, id: id('the reading to remove'),
} };
// save_crop_extras, skip_task, set_farm_market and make_purchase_orders are NOT cards (review of 22 Nov 2026): human
// only, with the reason in supabase/functions/_shared/ai-coverage.json
// app.save_crop_tracking (20261004180000_crop_growth_tracking)
const MEASURE = dims => ({ type: 'object', fields: {
  on: { type: 'boolean', required: true }, ...(dims ? { dims: { type: 'array', max: 2, items: { type: 'string', enum: ['longest', 'across'] } } } : {}),
  stat: str(null, { enum: ['longest', 'average'] }), how: str('how to measure it', { max: 400 }),
} });
const TRACKING = { type: 'object', required: true, label: 'What growth photos measure', fields: { height: MEASURE(false), fruit: MEASURE(true), leaf: MEASURE(true), head: MEASURE(true) } };
// app.save_growing_system (20260921150000_remove_positions and its patches): only the keys given change; never force
// (a position with batches is removed, its batches with it, only by a person)
const ZONE = { type: 'object', required: true, label: 'What changes', fields: {
  name: str(null, { min: 1, max: 120 }), system_type: str('a system type code (farm_setup)'), media: { type: 'array', min: 1, items: { type: 'string' }, label: 'its growing media codes' },
  crop_categories: { type: 'array', items: { type: 'string', enum: CATEGORIES } }, area_m2: num(null, { min: 0, unit: 'm²' }), base_units: int(null, { min: 1 }),
  status: str(null, { enum: ['active', 'maintenance', 'out_of_service'] }),
  positions: { type: 'array', max: 200, label: 'the positions that change', items: { type: 'object', fields: {
    id: id('a position of the zone; omit to add one'), code: str(), capacity: num('plants', { min: 1 }), remove: { type: 'boolean', label: 'remove it (refused when it has batches)' },
  } } },
} };
const ZONE_ID = uuid('Zone');
const GROUP = uuid('Steady group');
const TASK = uuid('Task');
const CARDS_F = [
  // tasks (#/week/board): tasks_week and team_setup first
  { name: 'add_hand_task', family: 'tasks', label: 'Add a task by hand', pages: BOARD, revert: 'C', args: { p: HAND_TASK },
    hint: 'Read tasks_week (and team_setup for who) first. Once, or repeated every_days until ends_on; family is one the board shows.' },
  { name: 'delete_hand_task', family: 'tasks', label: 'Delete a task added by hand', pages: BOARD, revert: 'C',
    args: { p_task: TASK, p_from_here: { type: 'boolean', label: 'this one and every later one of its series' } },
    hint: 'Only a task added by hand (tasks_week: hand) that is not started or closed; p_from_here true ends its series from this one.' },
  { name: 'assign_task', family: 'tasks', label: 'Put someone on a task', pages: BOARD, revert: 'B',
    args: { p_task: TASK, p_worker: uuid('Person', false) },
    hint: 'Read tasks_week and team_setup first: p_worker is a worker id (never a login). It replaces whoever is on the task; omitted, it takes everybody off.' },
  { name: 'assign_tasks', family: 'tasks', label: 'Give several tasks to one person', pages: BOARD, revert: 'C',
    args: { p_tasks: uuids('Tasks', { required: true, min: 1 }), p_worker: uuid('Person') },
    hint: 'Each task\'s people are replaced by p_worker (a worker id from team_setup).' },
  { name: 'unassign_tasks', family: 'tasks', label: 'Take someone off several tasks', pages: BOARD, revert: 'C',
    args: { p_tasks: uuids('Tasks', { required: true, min: 1 }), p_worker: uuid('Person', false) }, hint: 'p_worker omitted takes everybody off them.' },
  { name: 'move_task', family: 'tasks', label: 'Move a task to another day or slot', pages: BOARD, revert: 'B',
    args: { p_task: TASK, p_date: date('Day', false), p_slot: SLOT },
    hint: 'An open task only; give the day, the slot or both. A routine task cannot land on a day where the same procedure already is for that place.' },
  { name: 'set_task_slot', family: 'tasks', label: 'Morning or afternoon for a task', pages: BOARD, revert: 'B',
    args: { p_task: TASK, p_slot: { ...SLOT, required: true } } },
  { name: 'draft_labour_plan', family: 'tasks', label: 'Draft the week\'s labour plan', pages: BOARD, revert: 'C',
    args: { p_farm: uuid('FarmBox'), p_week: date('A day of that week', false) },
    hint: 'Puts people on the open tasks of that week (next week when omitted) as a DRAFT: refused once the week is validated. Validating it is the person\'s.' },
  { name: 'close_issue', family: 'tasks', label: 'Close an issue', pages: ['#/dashboard/issues'], revert: 'C',
    args: { p_id: uuid('Issue'), p_note: { type: 'string', max: 2000, label: 'Why it is closed' } },
    hint: 'Read issues first. There is no reopening. Never a pest case (kind pest_case): close_case closes it and stops its programmes.' },
  // scouting & IPM
  { name: 'open_case', family: 'scouting', label: 'Open a pest case', pages: SCOUT, revert: 'A', args: { p: CASE_NEW },
    hint: 'Read cases and scouting_day first: one case a pest a zone. from_kind and from_id make a photo or a trap reading its first point.' },
  { name: 'close_case', family: 'scouting', label: 'Close a pest case', pages: CASE, revert: 'C',
    args: { p_case: uuid('Case'), p_outcome: { type: 'string', required: true, enum: ['resolved', 'contained', 'crop_removed', 'false_alarm'], label: 'Outcome' },
            p_note: { type: 'string', required: true, min: 1, max: 2000, label: 'Note' } },
    hint: 'Read case_detail first: its running programmes stop and their applications not started go.' },
  { name: 'follow_traps', family: 'scouting', label: 'The traps a case follows', pages: CASE, revert: 'B',
    args: { p_case: uuid('Case'), p_traps: uuids('Traps: the WHOLE set ([] none)', { required: true }) },
    hint: 'Replaces the traps the case follows; trap ids from ipm (zones[].traps[]).' },
  { name: 'tag_photo', family: 'scouting', label: 'Tag the pests on a photo', pages: SCOUT, revert: 'A',
    args: { p_kind: { type: 'string', required: true, enum: ['observation', 'trap'], label: 'A plant photo or a trap reading' }, p_id: uuid('Its id'),
            p_tags: { type: 'array', required: true, max: 20, label: 'Its WHOLE list of tags', items: { type: 'object', fields: {
              code: str(PEST_CODES, { required: true, min: 1 }), severity: int('0–3', { min: 0, max: 3 }), note: str(null, { max: 500 }) } } } },
    hint: 'Read scouting_day first and send every tag the photo keeps: the list replaces its tags.' },
  { name: 'save_sticky_trap', family: 'scouting', label: 'Add or change a sticky trap', pages: SCOUT, revert: 'A', args: { p: TRAP },
    hint: 'Read ipm first; id only to change one (then only the keys given change).' },
  { name: 'save_ipm_threshold', family: 'scouting', label: 'The farm\'s trap thresholds', pages: SCOUT, revert: 'C',
    args: { p_farm: uuid('FarmBox'), p_watch: num('Watch from (insects a day on one trap)', { required: true, min: 0 }),
            p_over: num('Over from (insects a day on one trap)', { required: true, min: 0 }) },
    hint: 'Read ipm first (threshold); p_over at least p_watch.' },
  { name: 'save_spray_volume', family: 'scouting', label: 'Add or change a spray volume', pages: ['#/ipm/products'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p: SPRAY },
    hint: 'One line per crop (or crop category) and phase: to change a line send its id. Applications planned from then on take it.' },
  { name: 'remove_spray_volume', family: 'scouting', label: 'Remove a spray volume', pages: ['#/ipm/products'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p_id: uuid('The line') } },
  { name: 'start_ipm_program', family: 'scouting', label: 'Start a treatment programme', pages: ['#/ipm/scouting', '#/ipm/library'], revert: 'C',
    args: { p: IPM_START },
    hint: 'Read cases (and case_detail) first. A library programme (template_id) or the products as steps. It makes the applications, their tasks and the purchase requests: say so on the card. The IPM library and products are not among your reads: ask the person for them.' },
  { name: 'stop_program', family: 'scouting', label: 'Stop a treatment programme', pages: SCOUT, revert: 'C',
    args: { p_program: uuid('Programme') }, hint: 'Programme ids from cases or case_detail (programs[]); its applications not started and their tasks go.' },
  { name: 'save_program', family: 'scouting', label: 'Add or change a hand-typed programme of a case', pages: CASE, revert: 'C',
    args: { p: CASE_PROGRAM },
    hint: 'Read case_detail first. issue_id always; to add one a name or a product, to change one its id (only the keys given change). It plans its tasks.' },
  // purchasing & stock
  { name: 'compute_purchase_requests', family: 'purchasing', label: 'Work out what to buy', pages: ['#/office/buy'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p_horizon_days: int('Looking ahead', { min: 1, max: 365, unit: 'days' }) },
    hint: 'Draft purchase requests made or updated from the plan and the stock; read purchasing after.' },
  { name: 'save_item', family: 'purchasing', label: 'Add or change a stock item', pages: ['#/office/stock'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p: ITEM },
    hint: 'Read purchasing (stock) first; id only to change one. A standard item takes only its reorder point and quantity here.' },
  { name: 'adjust_stock', family: 'purchasing', label: 'Record a stock movement', pages: ['#/office/stock'], revert: 'A',
    args: { p_farm: uuid('FarmBox'), p_item: uuid('Item'), p_qty: num('How much: + in, − out', { required: true }),
            p_reason: { type: 'string', enum: ['receipt', 'consumption', 'adjustment', 'waste', 'opening'], label: 'Why' }, p_note: { type: 'string', max: 500, label: 'Note' } },
    hint: 'p_qty is the CHANGE, not a count: for a count, the counted minus on_hand (purchasing stock[]). Receiving an order is a person\'s (not receipt here).' },
  // sales
  { name: 'save_customer', family: 'sales', label: 'Add or change a customer', pages: ['#/office/customers'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p: CUSTOMER },
    hint: 'Read customers first. To change one send its WHOLE record with its id: a text key left out is cleared.' },
  { name: 'set_basket_clients', family: 'sales', label: 'How many direct clients the baskets are for', pages: ['#/office/sell'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p_clients: int('Clients', { required: true, min: 0, max: 100000 }) } },
  // costs
  { name: 'save_cost', family: 'costs', label: 'Record or change a cost', pages: ['#/office/money'], revert: 'A',
    args: { p_farm: uuid('FarmBox'), p: COST },
    hint: 'Read money first; id only to change one, and then send crop_plan_id and zone_id back (left out, they are cleared).' },
  { name: 'remove_cost', family: 'costs', label: 'Remove a cost', pages: ['#/office/money'], revert: 'C', args: { p_id: uuid('Cost') },
    hint: 'A cost entry id from money (entries[]).' },
  // water
  { name: 'save_sump_reading', family: 'water', label: 'Type a sump reading', pages: SCOUT, revert: 'A', args: { p: SUMP },
    hint: 'At least one of ec, ph and water_temp. A reading at the same time is replaced.' },
  // equipment
  { name: 'generate_maintenance_tasks', family: 'equipment', label: 'Make the maintenance tasks', pages: ['#/maintenance/equipment'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p_horizon_days: int('Looking ahead', { min: 1, max: 365, unit: 'days' }) },
    hint: 'The tasks the routines make over the coming days (maintenance first). Signing a service off is a person\'s.' },
  // crops
  { name: 'set_batch_dates', family: 'crops', label: 'Set a batch\'s dates', pages: PLANNER, revert: 'B',
    args: { p_plan: uuid('Batch'), p_transplant: date('Transplant day'), p_harvest: date('First harvest day', false) },
    hint: 'Read crop_plan first; without p_harvest the first harvest follows the crop\'s cycle.' },
  { name: 'restore_crop', family: 'crops', label: 'Restore an archived crop', pages: ['#/grow/library'], revert: 'C', args: { p_crop: uuid('Crop') },
    hint: 'It goes back to the status it had before it was archived.' },
  { name: 'save_crop_tracking', family: 'crops', label: 'What growth photos measure on a crop', pages: ['#/grow/library'], revert: 'C',
    args: { p_crop: uuid('Crop'), p: TRACKING }, hint: 'Send every subject the crop keeps: one left out is no longer measured.' },
  { name: 'save_growing_system', family: 'crops', label: 'Change a zone', pages: ['#/farm/zones'], revert: 'C',
    args: { p_system: ZONE_ID, p: ZONE },
    hint: 'Read farm_setup first; only the keys given change. A position with batches is never removed here (a person does it).' },
  { name: 'steady_rename', family: 'crops', label: 'Rename a steady group', pages: PLANNER, revert: 'B',
    args: { p_group: GROUP, p_name: { type: 'string', required: true, min: 1, max: 60, label: 'Name' } }, hint: 'Group ids from crop_plan (steady_groups).' },
  { name: 'steady_set_positions', family: 'crops', label: 'Positions of a zone in a steady group', pages: PLANNER, revert: 'C',
    args: { p_system: ZONE_ID, p_n: int('Positions', { required: true, min: 1 }) },
    hint: 'n from the zone\'s splits (steady_preview suggest); the group is planned again.' },
  { name: 'steady_leave', family: 'crops', label: 'A zone leaves its steady group', pages: PLANNER, revert: 'C', args: { p_system: ZONE_ID },
    hint: 'The group\'s other zones are planned again.' },
  { name: 'steady_undo', family: 'crops', label: 'Put a steady group back as before its last plan', pages: PLANNER, revert: 'C', args: { p_group: GROUP } },
  { name: 'steady_dissolve', family: 'crops', label: 'Dissolve a steady group', pages: PLANNER, revert: 'C', args: { p_group: GROUP },
    hint: 'Its zones leave it; their batches stay as proposals.' },
  { name: 'apply_camera_growth', family: 'crops', label: 'Apply a camera\'s growth estimate', pages: ['#/connect/growth'], revert: 'B', args: { p_id: uuid('Estimate') },
    hint: 'A new estimate tied to a batch: its phase and days to harvest are applied. The estimates are not among your reads: the person names one.' },
  { name: 'dismiss_camera_growth', family: 'crops', label: 'Set a camera\'s growth estimate aside', pages: ['#/connect/growth'], revert: 'A', args: { p_id: uuid('Estimate') } },
  // team
  { name: 'remove_farm_holiday', family: 'team', label: 'Take a closed day off the calendar', pages: ['#/farm/zones'], revert: 'C',
    args: { p_farm: uuid('FarmBox'), p_day: date('Day') }, hint: 'A public holiday becomes a working day; the tasks are dated again.' },
].map(d => ({ kind: 'rpc', ...d, stageable: false, run: rpcRun(d.name) }));

export const DEFINITIONS = [...FARMNET, ...RPC, ...CARDS_F];
