// FarmNet › Windows (#/farmnet/windows; owner, 21 Nov 2026: "we have to start simple with the available data … use the
// FarmNet logic without adding additional loop on Naked Heart. The irrigation logic has to be used in FarmNet, Naked
// Heart just puts the good setting … a unique windows setting page"). Brief: docs/plan-irrigation-windows-2026-11-21.md.
// One card per irrigation program of each fertigation centre, filled from FarmNet when the page opens: the program in
// full (program_param), its valves' run times (STM), its DIY parameters (diy_get: CST, EN, TM[0].ST, and TM[0].ET when
// it is DIY), MINT / MAXT, CMD, DT, RSIF; the measured volume per run (irrigation_records type 0, 7 days, median VLM).
// Shown before anything is sent: today's clock times of the anchor and the three periods (FarmNet's riseT / setT),
// irrigations a day, and what FarmNet holds now. Presets fill the card; the card opens with what FarmNet runs today.
// Nothing here repeats, polls or runs later: every value is computed when the page opens or a field changes.
// Not in v1: the crop planner's link, light influences, run time following drain %, weight and AI modes.
import { el, field, toast, busy, confirmDrawer } from '../ui.js';
import { ask, askNow, bad, card, page, range, soft, sourcesOf, num } from './shell.js';
import { runCommand, tagCmd } from '../registry.js';
import { baysOfSensor } from './overview.js';
import * as W from './windows-plan.js';

const MODE = { 0: 'Timer', 1: 'Cycle', 2: 'Light sum', 3: 'Custom', 4: 'Substrate weight', 5: 'AI' };
const DAYS = [[0, 'Every day'], [1, 'Every few days'], [2, 'Chosen weekdays'], [3, 'Odd dates'], [4, 'Even dates']];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const diyV = x => (x && typeof x === 'object' && 'V' in x ? x.V : x);
const last = s => s.path[s.path.length - 1] || '';

// the signals the influences may use, from FarmNet's own list of sources (the function checks the ids again)
export function signalsOf(farm, sources) {
  const drain = sources.filter(s => /drain|leach|substrate weight|\bweigh/i.test(`${s.label} ${s.path.join(' ')}`));
  const moisture = sources.filter(s => /soil humid|substrate moist|moisture/i.test(s.label)).map(s => {
    const bays = baysOfSensor(farm.code, last(s));
    return { ...s, text: `${bays.length ? 'Bay ' + bays.join(', ') + ' · ' : ''}${last(s)} ${s.label}` };
  });
  const weather = sources.filter(s => /^FN_(ASM|ETH)/i.test(last(s)) && /vpd|air temp/i.test(s.label))
    .map(s => ({ ...s, text: `${last(s)} ${s.label}${s.unit ? ' (' + s.unit + ')' : ''}` }));
  return {
    drain: drain.map(s => ({ ...s, text: `${last(s)} ${s.label}` })), moisture, weather,
    isDrain: id => drain.some(s => s.id === id) || moisture.some(s => s.id === id),
    isWeather: id => weather.some(s => s.id === id),
    ids: new Set(sources.map(s => s.id)),                      // every source FarmNet lists (the influences' check)
    nameOf: id => { const s = sources.find(x => x.id === id); return s ? `${last(s)} ${s.label}` : id; },
  };
}

// a parameter of the program by its SR (EN, CST, MINT, MAXT, a start's ST / ET)
export function paramBySr(par, sr) {
  const all = [par?.EN, par?.CST, par?.MINT, par?.MAXT, ...(Array.isArray(par?.TM) ? par.TM.flatMap(t => [t?.ST, t?.ET]) : [])];
  return all.find(p => p && typeof p === 'object' && Number(p.SR) === Number(sr)) || null;
}
const NOT_LINKED = { param: { id: -1 }, time: [] };

export async function renderFnWindows(mount, farm, _app, quiet) {
  await page(mount, farm, null, async (ctx, body) => {
    const cs = await ask(farm, 'centres') || [];
    if (!cs.length) { body.append(el('div', 'note', 'FarmNet lists no fertigation centre.')); return; }
    const srcs = await soft(sourcesOf(farm));
    const signals = signalsOf(farm, srcs.v || []);
    const per = await Promise.all(cs.map(c => readCentre(farm, c)));
    if (!ctx.live()) return;
    if (srcs.e) body.append(bad(`FarmNet did not list its signal sources: no influence can be chosen (${srcs.e})`));
    cs.forEach((c, i) => body.append(centreCard(ctx, c, per[i], signals)));
  }, { commands: true, quiet });
}

// everything a centre's cards need, read when the page opens
export async function readCentre(farm, c) {
  const [programs, records] = await Promise.all([
    soft(ask(farm, 'irrigation_programs', { id: c.id })),
    soft(ask(farm, 'irrigation_records', { id: c.id, type: 0, ...range(6) })),   // 7 days with today
  ]);
  const list = programs.v || [];
  const params = await Promise.all(list.map(p => soft(ask(farm, 'program_param', { id: c.id, proId: p.ID }))));
  const diys = await Promise.all(list.map(async (p, i) => {
    const par = params[i].v;
    if (!par) return null;
    const sr = W.srsOf(par);
    const get = s => soft(ask(farm, 'diy_get', { id: c.id, type: 0, proId: p.ID, SR: s }).then(W.diyOf));
    // TM[0].ET only when FarmNet says it is DIY (the others are always asked: their state is part of the card)
    const etLinked = paramBySr(par, sr.et)?.DEN === true;
    const [st, cst, en, et] = await Promise.all([get(sr.st), get(sr.cst), get(sr.en), etLinked ? get(sr.et) : Promise.resolve({ v: NOT_LINKED })]);
    return { sr, st, cst, en, et };
  }));
  return { programs, records, params, diys };
}

function centreCard(ctx, c, r, signals) {
  const k = card(`${c.name} — irrigation windows`);
  if (r.programs.e) { k.append(bad(r.programs.e)); return k; }
  const list = r.programs.v || [];
  // today's sunrise and sunset, as FarmNet computes them for the centre (any DIY answer carries them)
  const sun = W.sunOf(...r.diys.flatMap(d => (d ? [d.st.v, d.cst.v, d.en.v, d.et.v] : [])));
  const recs = r.records.v?.record || [];
  k.append(el('p', 'hint', sun
    ? `Today on FarmNet: sunrise ${W.clock(sun.rise)}, sunset ${W.clock(sun.set)}. Every card opens with what FarmNet runs now; nothing is sent until Save.`
    : 'FarmNet gave no sunrise and sunset for this centre: the clock times below cannot be worked out.'));
  if (r.records.e) k.append(bad(`Run records not read: ${r.records.e}`));
  if (!list.length) k.append(el('div', 'hint', 'FarmNet lists no irrigation program.'));
  list.forEach((p, i) => k.append(programCard(ctx, c, p, r.params[i], r.diys[i], sun, recs, signals)));
  return k;
}

// ── one program ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function programCard(ctx, c, prog, parR, diyR, sun, recs, signals) {
  const box = el('div', 'fc-unit win-card');
  box.dataset.pid = String(prog.ID);
  const head = el('div', 'fc-unit-head');
  head.append(el('b', null, prog.NM));
  box.append(head);
  if (parR?.e || !parR?.v) { box.append(bad(`FarmNet did not give the program in full: ${parR?.e || 'no answer'}`)); return box; }
  const par = parR.v;
  const on = Number(diyV(par.EN)) !== 0;
  head.append(el('span', 'pill ' + (on ? 'ok' : ''), on ? 'On' : 'Off'), el('span', 'hint', MODE[Number(par.SMD)] ?? `mode ${par.SMD}`));
  const diy = { st: diyR?.st?.v, cst: diyR?.cst?.v, en: diyR?.en?.v, et: diyR?.et?.v, isDrain: signals.isDrain, isWeather: signals.isWeather };
  const diyErr = ['st', 'cst', 'en'].map(x => diyR?.[x]?.e ? `${x.toUpperCase()}: ${diyR[x].e}` : null).filter(Boolean);

  // what FarmNet holds now
  const now = el('div', 'win-now');
  now.append(el('div', 'cx-kind-label', 'FarmNet now'));
  const kv = el('div', 'ir-kv');
  const row = (k, v) => kv.append(el('span', 'hint', k), el('span', null, v));
  const t0 = Array.isArray(par.TM) ? par.TM[0] : null;
  const inUse = (Array.isArray(par.TM) ? par.TM : []).filter(x => x?.USE === true).length;
  row('Starts by', `${MODE[Number(par.SMD)] ?? par.SMD} · ${inUse} start slot${inUse === 1 ? '' : 's'} in use`);
  row('Window (start 1)', t0 ? `${W.clock(diyV(t0.ST))} – ${W.clock(diyV(t0.ET))}${t0.USE ? '' : ' (not in use)'}` : '—');
  row('  its start', W.periodsText(diy.st, 'clock'));
  if (W.linked(diy.et)) row('  its end', W.periodsText(diy.et, 'clock'));
  row('Interval (CST)', `${num(diyV(par.CST)) ?? '—'} s · ${W.periodsText(diy.cst)}`);
  row('On / off (EN)', `${on ? 'on' : 'off'} · ${W.periodsText(diy.en, 'onoff')}`);
  const valves = W.valvesOf(par);
  row('Valves, run', valves.length ? valves.map(v => `${v.name} ${v.stm} s`).join(', ') : 'none');
  row('Gap min / max', `${num(diyV(par.MINT)) ?? '—'} s / ${num(diyV(par.MAXT)) ?? '—'} s`);
  row('Sharing a pump', Number(par.CMD) === 0 ? 'waits (CMD 0)' : 'runs together (CMD 1)');
  row('Days', daysText(par.DT));
  row('Irrigate at the start', par.RSIF === true ? 'yes (RSIF)' : 'no');
  const vol = W.medianVolume(recs, prog.NM);
  row('Measured per run', vol.runs === 0 ? 'no run in 7 days' : vol.litres ? `${vol.litres} L (median of ${vol.runs} runs, 7 days)` : `no flow reading (${vol.runs} runs, 7 days, volume 0)`);
  now.append(kv);
  if (diyErr.length) now.append(bad(`FarmNet did not give every DIY: ${diyErr.join(' · ')}`));
  box.append(now);

  // the plan: what FarmNet runs today, then the person's changes
  let plan = W.planFromFarmnet(prog, par, diy);
  plan.kept = W.keptInfluences(diy.cst, id => signals.isDrain(id) || signals.isWeather(id), plan.drop);
  const may = ctx.may && !ctx.stale;
  const mode = Number(par.SMD);
  if (mode !== 0 && mode !== 1) {
    box.append(el('div', 'note', `This program starts on ${MODE[mode] ?? 'mode ' + mode}: its windows are set on FarmNet's own screen.`));
    return box;
  }
  const form = el('div', 'win-form');
  const preview = el('div', 'win-preview');
  const redraw = () => { form.replaceChildren(...formOf(plan, may, signals, p => { plan = p; redraw(); }, () => drawPreview())); drawPreview(); };
  const drawPreview = () => preview.replaceChildren(...previewOf(plan, sun, diy));
  redraw();
  box.append(form, preview);
  box._plan = () => plan;   // the harness reads the plan from here
  tagCmd(now, 'diy_add', prog.ID);
  if (may) {
    const result = el('div', 'win-result');
    const bar = el('div', 'fc-btns');
    const go = tagCmd(el('button', 'btn btn-primary', 'Save → FarmNet'), 'diy_edit', prog.ID); go.type = 'button';
    go.onclick = () => saveWindows(ctx, c, prog, () => plan, sun, result, go, signals);
    bar.append(go);
    box.append(bar, result);
  }
  return box;
}

const daysText = dt => {
  if (!dt) return '—';
  const m = Number(dt.DMD);
  const t = m === 1 ? `every ${dt.DID} days` : m === 2 ? WEEK.filter((_, i) => (Number(dt.DWD) >> i) & 1).join(' ') : (DAYS.find(d => d[0] === m) || [, `mode ${m}`])[1].toLowerCase();
  return `${t}${dt.DSD ? ' from ' + dt.DSD : ''}${dt.DED ? ' to ' + dt.DED : ''}`;
};

// ── the form ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function formOf(plan, may, signals, replace, changed) {
  const out = [];
  const numIn = (value, set, { min, max, step = 1, w = 5, label }) => {
    const i = el('input', 'input win-num'); i.type = 'number'; i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = value === null || value === undefined ? '' : String(value); i.disabled = !may; i.style.width = `${w}em`;
    if (label) i.setAttribute('aria-label', label);
    i.oninput = () => { const n = i.value === '' ? null : Number(i.value); set(Number.isFinite(n) ? n : null); changed(); };
    return i;
  };
  const sel = (pairs, value, set, label) => {
    const s = el('select', 'input'); s.disabled = !may; if (label) s.setAttribute('aria-label', label);
    pairs.forEach(([v, t]) => { const o = el('option', null, t); o.value = String(v); s.append(o); });
    s.value = String(value ?? '');
    s.onchange = () => { set(s.value); changed(); };
    return s;
  };

  // system type and its preset
  const top = el('div', 'win-row');
  const kind = sel(Object.entries(W.PRESETS).map(([k, p]) => [k, p.label]), plan.kind, v => { plan.kind = v; }, 'System type');
  top.append(field('System type', kind));
  if (may) {
    const b = el('button', 'btn btn-sm', 'Apply preset'); b.type = 'button';
    b.title = 'Vines 45 / 25 / OFF min, P1 sunrise + 60, P3 sunset − 150 · NFT 30 min every period · Ebb & flow 60 min every period';
    b.onclick = () => replace(W.applyPreset(plan, kind.value));
    top.append(b);
  }
  // the first cycle: at sunset ± min (NFT, ebb & flow run all night) or at the P1 start (vines: the day starts at P1,
  // owner 21 Nov 2026)
  top.append(field('First cycle at', sel([['sunset', 'Sunset ± min'], ['p1', 'The P1 start (sunrise ± P1)']], plan.anchorAt,
    v => { plan.anchorAt = v; replace(plan); }, 'First cycle at')));
  if (plan.anchorAt !== 'p1') top.append(field('Sunset ± min', numIn(plan.anchor, v => { plan.anchor = v; }, { min: -359, max: 360, label: 'Anchor, minutes from sunset' })));
  out.push(top);
  // the program's on/off: kept as FarmNet holds it; only this box (off by default) lets Save switch it on
  const onRow = el('div', 'win-row');
  const allOn = W.isAllOnNow(plan), someOn = W.isOnNow(plan);
  onRow.append(el('span', null, `Program: ${allOn ? 'on' : someOn ? 'on in some periods' : 'off'} now — Save keeps it so`));
  if (!allOn) {
    const sw = el('input'); sw.type = 'checkbox'; sw.checked = !!plan.switchOn; sw.disabled = !may; sw.setAttribute('aria-label', 'Switch the program on');
    sw.onchange = () => { plan.switchOn = sw.checked; changed(); };
    const l = el('label', 'win-off'); l.append(sw, document.createTextNode(' Switch the program on'));
    onRow.append(l);
  }
  out.push(onRow);

  // the three periods
  const t = el('table', 'win-periods');
  const hr = el('tr');
  hr.append(el('th'));
  const h1 = el('th'); h1.append(el('span', null, 'P1 sunrise '), numIn(plan.p1, v => { plan.p1 = v; }, { min: -360, max: 360, w: 4.5, label: 'P1 start, minutes from sunrise' }), el('span', 'hint', ' min'));
  const h2 = el('th', null, 'P2 12:00');
  const h3 = el('th'); h3.append(el('span', null, 'P3 sunset '), numIn(plan.p3, v => { plan.p3 = v; }, { min: -360, max: 360, w: 4.5, label: 'P3 start, minutes from sunset' }), el('span', 'hint', ' min'));
  hr.append(h1, h2, h3);
  const thead = el('thead'); thead.append(hr); t.append(thead);
  const tb = el('tbody');
  const line = (label, cellOf) => { const r = el('tr'); r.append(el('th', 'hint', label)); plan.periods.forEach((p, i) => { const td = el('td'); td.append(...cellOf(p, i)); r.append(td); }); tb.append(r); };
  line('Off, min', (p, i) => {
    const off = el('input'); off.type = 'checkbox'; off.checked = p.off === null; off.disabled = !may; off.setAttribute('aria-label', `P${i + 1} OFF`);
    const n = numIn(p.off, v => { p.off = v; }, { min: 0, max: W.OFF_MAX_MIN, label: `P${i + 1} off, minutes` });
    n.disabled = !may || p.off === null;
    off.onchange = () => { p.off = off.checked ? null : (num(n.value) ?? 30); n.disabled = off.checked; if (!off.checked) n.value = String(p.off); changed(); };
    const l = el('label', 'win-off'); l.append(off, document.createTextNode(' OFF'));
    return [n, l];
  });
  line('Ramp, min', (p, i) => [numIn(p.ramp, v => { p.ramp = v ?? 0; }, { min: 0, max: 240, label: `P${i + 1} ramp, minutes` })]);
  const autoOpts = [...signals.drain, ...signals.moisture];
  line('Auto', (p, i) => influenceCell(p.auto, 'target', autoOpts, may, numIn, sel, `P${i + 1} Auto`,
    signals.drain.length ? null : 'FarmNet has no drain, drain-ratio or substrate-weight signal: Auto on drain is not possible here'
      + (signals.moisture.length ? '; substrate moisture can be used' : '')));
  line('Weather', (p, i) => influenceCell(p.weather, 'setpoint', signals.weather, may, numIn, sel, `P${i + 1} Weather`,
    signals.weather.length ? null : 'FarmNet lists no inside VPD or air temperature'));
  t.append(tb);
  const wrap = el('div', 'table-wrap'); wrap.append(t);
  out.push(wrap);
  // why Auto on drain is greyed (FB1 has no drain signal, 21 Nov 2026), said once under the periods
  if (!signals.drain.length) out.push(el('div', 'hint win-grey', 'Auto on drain: FarmNet has no drain, drain-ratio or substrate-weight signal'
    + (signals.moisture.length ? '. Auto can follow the substrate moisture instead (an influence of FarmNet on the interval).' : ', and no substrate moisture either.')));
  if (plan.estimated) out.push(el('div', 'hint', `Off per period estimated from its ${plan.estimated} timer starts a day, so the first Save gives about the same number of runs.`));
  // CST's influences on signals the card does not offer: kept as FarmNet holds them, or — when they no longer fit the three
  // periods — listed, and Save refused until the person drops them
  (plan.kept || []).forEach(k => {
    const line = el('div', k.why && !k.dropped ? 'note warn' : 'hint');
    line.append(document.createTextNode(`Influence on ${signals.nameOf(k.pId)}: ${k.dropped ? 'dropped on Save' : k.why ? `${k.why} — drop it to save` : 'kept as FarmNet holds it'}`));
    if (may && (k.why || k.dropped)) {
      const b = el('button', 'btn btn-sm', k.dropped ? 'Keep it' : 'Drop it'); b.type = 'button';
      b.onclick = () => { plan.drop = k.dropped ? plan.drop.filter(x => x !== k.pId) : [...plan.drop, k.pId]; k.dropped = !k.dropped; replace(plan); };
      line.append(document.createTextNode(' '), b);
    }
    out.push(line);
  });

  // run times, gaps, pumps, days
  const more = el('div', 'win-row');
  plan.valves.forEach(v => more.append(field(`${v.name} on, s`, numIn(v.stm, x => { v.stm = x; }, { min: 1, max: W.RUN_MAX, w: 6, label: `${v.name} run time, seconds` }))));
  more.append(field('Min gap, min', numIn(plan.mint, v => { plan.mint = v ?? 0; }, { min: 0, max: 1000, label: 'Minimum gap, minutes' })),
    field('Max gap, min', numIn(plan.maxt, v => { plan.maxt = v ?? 0; }, { min: 0, max: 1000, label: 'Maximum gap, minutes' })),
    field('Sharing a pump', sel([[0, 'Wait'], [1, 'Run together']], plan.cmd, v => { plan.cmd = Number(v); }, 'Sharing a pump')));
  const days = el('div', 'win-days');
  const dm = sel(DAYS, plan.days.mode, v => { plan.days.mode = Number(v); replace(plan); }, 'Irrigation days');
  days.append(dm);
  if (plan.days.mode === 1) days.append(numIn(plan.days.every, v => { plan.days.every = v ?? 1; }, { min: 1, max: 365, w: 4, label: 'Every how many days' }), el('span', 'hint', ' days'));
  if (plan.days.mode === 2) WEEK.forEach((d, i) => {
    const c = el('input'); c.type = 'checkbox'; c.checked = !!((plan.days.weekdays >> i) & 1); c.disabled = !may;
    c.onchange = () => { plan.days.weekdays = c.checked ? plan.days.weekdays | (1 << i) : plan.days.weekdays & ~(1 << i); changed(); };
    const l = el('label', 'win-off'); l.append(c, document.createTextNode(' ' + d)); days.append(l);
  });
  more.append(field('Days', days));
  out.push(more);
  return out;
}

function influenceCell(x, key, options, may, numIn, sel, label, why) {
  if (!options.length) {
    const s = el('span', 'hint win-grey', 'not available'); s.title = why || ''; return [s];
  }
  const s = sel([['', '—'], ...options.map(o => [o.id, o.text])], x.signal, v => { x.signal = v; }, `${label} signal`);
  s.classList.add('win-signal');
  const parts = [s, numIn(x[key], v => { x[key] = v; }, { min: -100000, max: 100000, step: 'any', w: 4.5, label: `${label} ${key}` }),
    el('span', 'hint', ' ±'), numIn(x.range, v => { x.range = v; }, { min: 1, max: 100, w: 4.5, label: `${label} range %` }), el('span', 'hint', ' %')];
  return parts;
}

// ── what the plan does today, before anything is sent ────────────────────────────────────────────────────────────────
function previewOf(plan, sun, diy) {
  const out = [el('div', 'cx-kind-label', 'With these settings, today')];
  const d = W.dayOf(plan, sun);
  if (d) {
    const kv = el('div', 'ir-kv');
    const row = (k, v) => kv.append(el('span', 'hint', k), el('b', null, v));
    row('First cycle', W.anchorWords(plan, sun));
    row('Stops', W.endWords(plan, sun));
    row('Program', plan.switchOn ? 'switched ON by this Save' : W.isOnNow(plan) ? 'on as now' : 'off as now (stays off)');
    d.periods.forEach((p, i) => row(`P${i + 1}`, `${W.clock(p.start)} – ${W.clock(p.end)} · ${plan.periods[i].off === null ? 'OFF' : `off ${plan.periods[i].off} min · ≈ ${p.runs} run${p.runs === 1 ? '' : 's'}`}`));
    row('Irrigations a day', `≈ ${d.runs}${d.on ? ` (each ${d.on} s on)` : ''}`);
    out.push(kv);
  }
  const probs = W.problemsOf(plan, sun);
  if (probs.length) out.push(el('div', 'note bad', `Not ready: ${probs.join(' · ')}`));
  W.warningsOf(plan, sun).forEach(w => out.push(el('div', 'note warn', w)));
  return out;
}

// ── Save → FarmNet (the brief's order) ───────────────────────────────────────────────────────────────────────────────
// First FarmNet is read fresh (the program and the four DIYs) and EVERY step's body is built and checked
// (windows-plan.js prepareSave, the function's rules): any problem refuses the Save before the first write (verifier,
// 21 Nov 2026). Then: 1 program_set (the window a plain 00:00–23:59) · 2 start 1 to one period holding 00:00 where it is
// DIY already · 3 the interval (CST) as DIY · 4 on/off (EN)
// as DIY, only when a period is OFF (or EN is DIY already), the program's on/off as it is now unless "Switch the program
// on" is ticked · 5 diy_get of each, shown. The function reads fresh again, keeps a copy and logs each step; the steps
// are one group on the Timeline. A refusal by FarmNet stops it and the list says what was done.
const STEPS = ['The program: cycle, the window 00:00–23:59 (start 1), valve runs, days, gaps, pumps, irrigate at the start',
  'Start 1, where it is DIY: one period holding 00:00', 'The window ends 23:59 (a plain time, with the program)',
  'The interval per period (CST, DIY)', 'On / off per period (EN, DIY)', 'Read back from FarmNet'];
const STEP_OF = { st: 1, et: 2, cst: 3, en: 4 };

export async function saveWindows(ctx, c, prog, getPlan, sun, out, go, signals) {
  const plan = structuredClone(getPlan());
  const early = W.problemsOf(plan, sun);
  if (early.length) { toast(`Not sent: ${early[0]}`, 'bad'); return; }
  busy(go, true, 'Reading FarmNet…');
  const getDiy = sr => askNow(ctx.farm, 'diy_get', { id: c.id, type: 0, proId: prog.ID, SR: sr }).then(W.diyOf);
  const managed = id => !!signals && (signals.isDrain(id) || signals.isWeather(id));
  let prep;
  try {
    const par = await askNow(ctx.farm, 'program_param', { id: c.id, proId: prog.ID });
    if (!par || Number(par.ID) !== Number(prog.ID)) throw new Error('FarmNet did not show the program');
    const sr = W.srsOf(par);
    const [st, cst, en] = await Promise.all([getDiy(sr.st), getDiy(sr.cst), getDiy(sr.en)]);
    prep = W.prepareSave(plan, sun, { par, st, cst, en }, signals?.ids || new Set(), managed);
  } catch (e) { busy(go, false, 'Save → FarmNet'); toast(`Not sent: ${e?.message || e}`, 'bad'); return; }
  if (prep.problems.length) {
    busy(go, false, 'Save → FarmNet');
    out.replaceChildren(el('div', 'note bad', `Nothing sent. ${prep.problems.join(' · ')}`));
    return;
  }
  busy(go, false, 'Save → FarmNet');
  const d = W.dayOf(plan, sun);
  const offs = plan.periods.map((p, i) => `P${i + 1} ${p.off === null ? 'OFF' : p.off + ' min'}`).join(', ');
  const onLine = plan.switchOn ? 'This switches the program ON.' : W.isOnNow(plan) ? 'The program stays on as it is now.' : 'The program is off and stays off.';
  const ok = await confirmDrawer(`Send the windows of "${prog.NM}" to FarmNet?`,
    `${onLine} First cycle: ${W.anchorWords(plan, sun)}. ${offs} · ≈ ${d.runs} irrigations today. `
    + `Stops: ${W.endWords(plan, sun)}. `
    + 'FarmNet gets, in order: the program (cycle, the window 00:00–23:59, valve runs, days, gaps, pumps, irrigate at the start), '
    + 'start 1 back to a plain 00:00 if it is DIY, the interval per period, and on/off per period (with the first cycle\'s switch-on). Each is kept before it changes and can be put back on the Timeline.', 'Send to FarmNet');
  if (!ok) return;
  busy(go, true, 'Sending…');
  const group = globalThis.crypto?.randomUUID?.() ?? null;
  const state = STEPS.map(label => ({ label, st: 'todo', note: '' }));
  const list = el('ol', 'win-steps');
  const back = el('div', 'win-back');
  const mark = { done: '✓', same: '–', skip: '–', bad: '✕', todo: '·' };
  const draw = () => list.replaceChildren(...state.map(s => el('li', s.st === 'bad' ? 'is-bad' : s.st === 'todo' ? null : 'is-done',
    `${mark[s.st]} ${s.label}${s.note ? ' — ' + s.note : s.st === 'todo' ? ' — not done' : ''}`)));
  out.replaceChildren(el('div', 'cx-kind-label', 'Save → FarmNet'), list, back);
  if (!prep.steps.some(s => s.role === 'en')) { state[4].st = 'skip'; state[4].note = 'not needed: kept as FarmNet holds it'; }
  if (!prep.steps.some(s => s.role === 'st')) { state[1].st = 'skip'; state[1].note = prep.stLinked ? 'already 00:00' : 'not DIY: set with the program'; }
  draw();
  const cmd = (name, args, what) => runCommand(name, { id: c.id, ...args }, { ctx, group, summary: `Windows · ${prog.NM}: ${what}` });
  let stopped = false;
  for (const s of prep.steps) {
    const i = s.kind === 'program' ? 0 : STEP_OF[s.role];
    try {
      if (s.kind === 'program') {
        try { await cmd('program_set', { proId: prog.ID, changes: s.changes }, 'the program'); state[i].st = 'done'; }
        catch (e) { if (!/nothing changes/i.test(e?.message || '')) throw e; state[i].st = 'same'; state[i].note = 'already so'; }
        // the window's end goes with the program (a plain 23:59: windows-plan.js WINDOW)
        state[STEP_OF.et].st = state[i].st;
        state[STEP_OF.et].note = s.changes.starts?.find(x => x.i === 0)?.et !== undefined ? 'with the program' : 'kept as FarmNet holds it';
      } else {
        if (s.add) await cmd('diy_add', { type: 0, proId: prog.ID, SR: s.sr }, `${s.what} made DIY`);
        await cmd('diy_edit', { type: 0, proId: prog.ID, SR: s.sr, diy: s.body, ...(s.role === 'en' && plan.switchOn ? { switch_on: true } : {}) }, `${s.what} periods`);
        const n = s.body.time.length, k = s.body.influe?.length || 0;
        state[i].st = 'done';
        state[i].note = `${s.add ? 'made DIY, ' : ''}${n} period${n === 1 ? '' : 's'}${k ? `, ${k} influence${k === 1 ? '' : 's'}` : ''}`;
      }
    } catch (e) { state[i].st = 'bad'; state[i].note = e?.message || String(e); stopped = true; }
    draw();
    if (stopped) break;
  }
  // what FarmNet holds now, read back: the tp 1 / 2 offsets are confirmed here (windows-plan.js stOf / offsetOf)
  if (!stopped) {
    const srs = prep.steps.filter(s => s.kind === 'diy').reduce((a, s) => ({ ...a, [s.role]: s.sr }), {});
    const got = await Promise.all([['start', srs.st, 'clock'], ['interval', srs.cst, 's'], ['on/off', srs.en, 'onoff']]
      .filter(x => x[1] !== undefined).map(async ([k, sr, u]) => [k, await soft(getDiy(sr)), u]));
    const kv = el('div', 'ir-kv');
    const sun2 = W.sunOf(...got.map(g => g[1].v));
    if (sun2) kv.append(el('span', 'hint', 'Sunrise, sunset'), el('span', null, `${W.clock(sun2.rise)}, ${W.clock(sun2.set)}`));
    got.forEach(([k, r, u]) => kv.append(el('span', 'hint', k), el('span', null, r.e ? `not read: ${r.e}` : W.periodsText(r.v, u))));
    back.replaceChildren(el('div', 'cx-kind-label', 'FarmNet reads back (diy_get)'), kv,
      el('div', 'hint', 'A sunrise or sunset period shows its offset as FarmNet stored it (st): it should be the minutes set here, in seconds.'));
    state[5].st = 'done'; draw();
  }
  if (stopped) toast(`Stopped: ${state.find(s => s.st === 'bad')?.note || 'refused'}`, 'bad');
  else toast(`"${prog.NM}" windows sent to FarmNet`, 'ok');
  busy(go, false, 'Save → FarmNet');
}
