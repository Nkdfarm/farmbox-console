// FarmNet › Irrigation › a sun-cycle program (owner, 21 Nov 2026: "need more simple interface … we can do everything in the
// irrigation page … click to a program made with the new format, open a new side page … the 3 periods are predefined, we can
// change only the anchors of + or − 120 minutes. Inside each period 2 simple options, cycle off time or number of cycles …
// initial data is the cycle on time. The setting has to be done in less than 1 min from a user without experience"; then
// "same window for nft or vines, easy change in the setting … all programs will convert with the new format").
// One side panel, top to bottom: name and on/off · water (valves by name, the recipe) · the on time · the first irrigation
// at sunset or sunrise · the day bar (the three periods, every irrigation of today as a tick) with the sunrise and sunset
// shifts · per period the off time ⇄ the number of cycles, or no irrigation · one line saying what the day will be · copy
// from another program · More (gaps, pump sharing, days). Save writes FarmNet's own settings (windows-plan.js prepareSave):
// FarmNet runs the cycle itself, every day, moving the periods with the sun; Naked Heart has no loop.
// Not in this version (owner's word, 21 Nov 2026): Auto on a moisture sensor — FarmNet has no "start when moisture drops by
// x %" for a moisture sensor, only an influence on the off time whose arithmetic its document does not give: after a trial.
import { el, field, drawer, toast, busy, confirmDrawer, loading } from '../ui.js';
import { askNow, bad, num, soft, sourcesOf } from './shell.js';
import { runCommand, tagCmd } from '../registry.js';
import { treeOf } from './programs.js';
import * as W from './windows-plan.js';

const DAY = 86400, STEP = 15, SHIFT = 120;
const PN = ['Morning', 'Afternoon', 'Night'];
const DAYS = [[0, 'Every day'], [1, 'Every few days'], [2, 'Chosen weekdays'], [3, 'Odd dates'], [4, 'Even dates']];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT = { on: 120, offs: [30, 20, 40] };   // a new program: 2 min on; 30 / 20 / 40 min off
const mmss = s => { const n = Math.max(0, Math.round(num(s) ?? 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const sel = (pairs, value) => { const s = el('select', 'input'); pairs.forEach(([v, t]) => { const o = el('option', null, t); o.value = String(v); s.append(o); }); s.value = String(value); return s; };

// read everything the panel needs, fresh from FarmNet
async function readProgram(ctx, c, id) {
  const par = await askNow(ctx.farm, 'program_param', { id: c.id, proId: id });
  if (!par || typeof par !== 'object' || Number(par.ID) !== Number(id)) throw new Error('FarmNet did not show the program');
  const sr = W.srsOf(par);
  const get = s => soft(askNow(ctx.farm, 'diy_get', { id: c.id, type: 0, proId: id, SR: s }).then(W.diyOf));
  const [st, cst, en] = await Promise.all([get(sr.st), get(sr.cst), get(sr.en)]);
  return { par, st: st.v, cst: cst.v, en: en.v, errs: [st, cst, en].map(x => x.e).filter(Boolean) };
}

// a program in the new format (or one being converted / just made): the sun-cycle panel
export async function openSunCycle(ctx, c, p, { recipes = [], records = [], programs = [], fresh = false, after } = {}) {
  let dirty = () => false;
  const d = drawer(p.NM || `Program ${p.ID}`, `${c.name} · sun cycle · FarmNet runs it by itself`, {
    guard: () => (dirty() ? confirmDrawer('Leave without saving?', 'The values you changed are not sent to FarmNet.', 'Leave') : true),
    onClose: () => { if (after) after(); },
  });
  d.box.classList.add('sc-drawer');
  d.body.append(loading('Reading the program from FarmNet…'));
  let r, tree = null, srcs = { v: [] };
  try {
    [r, tree, srcs] = await Promise.all([
      readProgram(ctx, c, p.ID),
      ctx.may ? askNow(ctx.farm, 'valve_groups', { id: c.id, group: 1 }).then(treeOf).catch(() => null) : null,
      soft(sourcesOf(ctx.farm)),
    ]);
  } catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  const sun = W.sunOf(r.st, r.cst, r.en);
  if (!sun) { d.body.append(bad('FarmNet gave no sunrise and sunset for this centre: the day cannot be worked out.')); return; }
  const mode = Number(r.par.SMD);
  if (mode !== 0 && mode !== 1) { d.body.append(el('div', 'note', `This program starts on FarmNet's ${mode === 4 ? 'substrate weight' : mode === 5 ? 'AI' : 'light or custom'} mode: it is set on FarmNet's own screen.`)); return; }

  // the plan: what FarmNet runs now (or, for a program not yet in the new format, a sensible start)
  let plan = W.planFromFarmnet(p, r.par, { st: r.st, cst: r.cst, en: r.en, isDrain: () => false, isWeather: () => false });
  const notes = [];
  if (fresh) {
    plan.on = DEFAULT.on; plan.p1 = 0; plan.p3 = 0; plan.anchor = 0; plan.anchorAt = 'sunset';
    plan.periods.forEach((x, i) => { x.off = DEFAULT.offs[i]; });
  } else if (!W.isSunCycle(r.par)) {
    // converting: FarmNet's own interval in every period (or the gap of its timer starts); a default only where none
    if (!plan.on) plan.on = DEFAULT.on;
    const filled = plan.periods.map((x, i) => { if (x.off === null) { x.off = DEFAULT.offs[i]; return true; } return false; });
    notes.push(filled.some(Boolean) ? `Converting: FarmNet held no interval for ${filled.map((f, i) => f ? PN[i].toLowerCase() : null).filter(Boolean).join(', ')}, so those start at 30 / 20 / 40 min. Nothing changes on FarmNet until Save.`
      : 'Converting: every period starts with FarmNet\'s own interval. Nothing changes on FarmNet until Save.');
  }
  const clamp = x => Math.max(-SHIFT, Math.min(SHIFT, Math.round((num(x) ?? 0) / STEP) * STEP));
  if (clamp(plan.p1) !== plan.p1 || clamp(plan.p3) !== plan.p3) notes.push(`The sunrise / sunset shifts were ${plan.p1} / ${plan.p3} min: set to ${clamp(plan.p1)} / ${clamp(plan.p3)} (± ${SHIFT} min, ${STEP}-minute steps). Save to keep it.`);
  plan.p1 = clamp(plan.p1); plan.p3 = clamp(plan.p3); plan.anchor = plan.p3;
  plan.kept = W.keptInfluences(r.cst, () => false, plan.drop);
  let was = JSON.stringify(strip(plan));
  dirty = () => JSON.stringify(strip(plan)) !== was;
  const may = ctx.may;
  const sourceIds = new Set((srcs.v || []).map(s => s.id));

  const body = el('div', 'sc');
  const redraw = () => body.replaceChildren(...panel());
  const out = el('div', 'win-result');
  d.body.append(body, out);
  if (r.errs.length) d.body.prepend(bad(`FarmNet did not give every setting: ${r.errs.join(' · ')}`));
  if (srcs.e && (plan.kept || []).length) d.body.prepend(bad(`FarmNet did not list its signal sources (${srcs.e}): the influences this program has cannot be checked, so Save is refused until they are`));
  notes.forEach(n => d.body.prepend(el('div', 'note', n)));

  function panel() {
    const parts = [];
    // ── name and on/off ──
    const head = el('div', 'sc-sec sc-head');
    const nm = el('input', 'input sc-name'); nm.maxLength = 40; nm.value = plan.name; nm.disabled = !may; nm.setAttribute('aria-label', 'Program name');
    nm.oninput = () => { plan.name = nm.value; };
    head.append(field('Name', nm));
    const onNow = W.isOnNow(plan);
    const pill = el('span', 'pill ' + (onNow ? 'ok' : ''), onNow ? 'On' : 'Off');
    head.append(pill);
    if (!W.isAllOnNow(plan) && may) {
      const sw = el('input'); sw.type = 'checkbox'; sw.checked = !!plan.switchOn; sw.setAttribute('aria-label', 'Switch the program on');
      sw.onchange = () => { plan.switchOn = sw.checked; redraw(); };
      const l = el('label', 'win-off'); l.append(sw, document.createTextNode(' Switch it on with Save'));
      head.append(l);
    }
    parts.push(head);

    // ── water: valves by name, the recipe ──
    parts.push(waterOf());

    // ── the on time ──
    const onSec = el('div', 'sc-sec');
    onSec.append(el('div', 'sc-label', 'On time — each irrigation'));
    const onRow = el('div', 'sc-step');
    const onVal = el('b', 'sc-big', mmss(plan.on));
    const bump = dlt => { plan.on = Math.max(10, Math.min(W.RUN_MAX, (num(plan.on) ?? 0) + dlt)); redraw(); };
    onRow.append(stepBtn('−', () => bump(-30), 'Shorter by 30 s'), onVal, stepBtn('+', () => bump(30), 'Longer by 30 s'), el('span', 'hint', 'min:s'));
    if (plan.onDiffers) onRow.append(el('span', 'hint', ' · the valves had different run times: Save gives them all this one'));
    onSec.append(onRow);
    parts.push(onSec);

    // ── the day: first irrigation, the bar, the shifts ──
    const day = el('div', 'sc-sec');
    const top = el('div', 'sc-row');
    top.append(el('span', 'sc-label', 'First irrigation at'));
    const seg = el('div', 'seg');
    [['sunset', 'Sunset'], ['p1', 'Sunrise']].forEach(([v, t]) => {
      const b = el('button', 'seg-btn', t); b.type = 'button'; b.setAttribute('aria-pressed', String(plan.anchorAt === v)); b.disabled = !may;
      b.onclick = () => { plan.anchorAt = v; plan.anchor = plan.p3; redraw(); };
      seg.append(b);
    });
    top.append(seg);
    day.append(top, dayBar());
    const shifts = el('div', 'sc-row sc-shifts');
    shifts.append(shiftOf('Sunrise', 'p1'), el('span', 'hint', 'Noon 12:00'), shiftOf('Sunset', 'p3'));
    day.append(shifts);
    parts.push(day);

    // ── the three periods ──
    const grid = el('div', 'sc-periods');
    const dd = W.dayOf(plan, sun), sim = W.simulate(plan, sun);
    plan.periods.forEach((x, k) => grid.append(periodCard(x, k, dd, sim)));
    parts.push(grid);

    // ── what the day will be ──
    parts.push(summary(sim));
    const probs = W.problemsOf(plan, sun);
    if (probs.length) parts.push(el('div', 'note bad', `Not ready: ${probs.join(' · ')}`));
    W.warningsOf(plan, sun).forEach(w => parts.push(el('div', 'note warn', w)));
    keptNotes().forEach(n => parts.push(n));

    // ── copy from another program, more ──
    parts.push(copyRow(), moreOf());
    return parts;
  }

  function stepBtn(t, on, label) { const b = el('button', 'btn btn-sm sc-stepbtn', t); b.type = 'button'; b.disabled = !may; b.setAttribute('aria-label', label); b.onclick = on; return b; }
  function shiftOf(label, key) {
    const w = el('div', 'sc-shift');
    const v = num(plan[key]) ?? 0;
    const set = n => { plan[key] = Math.max(-SHIFT, Math.min(SHIFT, n)); if (key === 'p3') plan.anchor = plan[key]; redraw(); };
    w.append(el('span', 'hint', label), stepBtn('−', () => set(v - STEP), `${label} ${STEP} min earlier`),
      el('b', null, `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)} min`), stepBtn('+', () => set(v + STEP), `${label} ${STEP} min later`));
    return w;
  }

  function periodCard(x, k, dd, sim) {
    const box = el('div', `sc-period sc-p${k}`);
    const pd = dd?.periods[k];
    box.append(el('div', 'sc-ptitle', PN[k]), el('div', 'hint', pd ? `${W.clock(pd.start)} – ${W.clock(pd.end)}` : '—'));
    const none = el('input'); none.type = 'checkbox'; none.checked = x.off === null; none.disabled = !may; none.setAttribute('aria-label', `${PN[k]}: no irrigation`);
    none.onchange = () => { x.off = none.checked ? null : DEFAULT.offs[k]; redraw(); };
    const nl = el('label', 'win-off'); nl.append(none, document.createTextNode(' No irrigation'));
    if (x.off === null) { box.append(el('div', 'sc-none', 'No irrigation'), nl); return box; }
    // the off time ⇄ the number of cycles: type either, the other follows
    const off = el('input', 'input sc-num'); off.type = 'number'; off.min = '1'; off.max = String(W.OFF_MAX_MIN); off.value = String(x.off); off.disabled = !may;
    off.setAttribute('aria-label', `${PN[k]} off time, minutes`);
    off.onchange = () => { const n = Math.round(Number(off.value)); if (Number.isFinite(n) && n >= 1) { x.off = Math.min(W.OFF_MAX_MIN, n); } redraw(); };
    const cyc = el('input', 'input sc-num'); cyc.type = 'number'; cyc.min = '1'; cyc.max = '200'; cyc.value = String(sim?.perPeriod[k] ?? ''); cyc.disabled = !may;
    cyc.setAttribute('aria-label', `${PN[k]} number of cycles`);
    cyc.onchange = () => { const n = Math.round(Number(cyc.value)); const o = W.offForCycles(plan, sun, k, n); if (o !== null) x.off = o; redraw(); };
    const r1 = el('div', 'sc-pair'); r1.append(el('span', 'hint', 'Off'), off, el('span', 'hint', 'min'));
    const r2 = el('div', 'sc-pair'); r2.append(el('span', 'hint', 'or'), cyc, el('span', 'hint', 'cycles today'));
    box.append(r1, r2, nl);
    return box;
  }

  // the 24 hours: the three periods, every irrigation of today as a tick, sunrise and sunset
  function dayBar() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1440 170'); svg.setAttribute('class', 'sc-bar'); svg.setAttribute('role', 'img');
    const dd = W.dayOf(plan, sun), sim = W.simulate(plan, sun);
    svg.setAttribute('aria-label', `Today: ${sim?.starts.length ?? 0} irrigations`);
    const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([a, v]) => n.setAttribute(a, String(v))); svg.append(n); return n; };
    const m = s => (((s % DAY) + DAY) % DAY) / 60;
    dd?.periods.forEach((p, k) => {
      const a = m(p.start), b = m(p.end);
      const segs = a < b ? [[a, b]] : [[a, 1440], [0, b]];
      segs.forEach(([x0, x1]) => add('rect', { x: x0, y: 44, width: Math.max(0, x1 - x0), height: 76, class: `sc-band sc-p${k}${plan.periods[k].off === null ? ' is-off' : ''}` }));
    });
    (sim?.starts || []).forEach(s => add('rect', { x: m(s.at), y: 36, width: Math.max(4, (sim.on || 60) / 60), height: 92, class: 'sc-tick' }));
    [[sun.rise, '☀ ' + W.clock(sun.rise)], [sun.set, '☾ ' + W.clock(sun.set)]].forEach(([t, label]) => {
      add('line', { x1: m(t), x2: m(t), y1: 30, y2: 130, class: 'sc-sun' });
      const tx = add('text', { x: Math.min(1290, Math.max(4, m(t) - 70)), y: 26, class: 'sc-txt' }); tx.textContent = label;
    });
    [0, 6, 12, 18, 24].forEach(h => { const tx = add('text', { x: Math.min(1350, h * 60 + 4), y: 162, class: 'sc-txt' }); tx.textContent = `${String(h).padStart(2, '0')}:00`; });
    if (dd && sim?.starts.length) add('circle', { cx: m(sim.starts[0].at), cy: 82, r: 16, class: 'sc-first' });
    return svg;
  }

  function summary(sim) {
    const valves = (plan.sources || []).flatMap(s => s.valves.map(v => v.name));
    const n = sim?.starts.length ?? 0;
    const vol = W.medianVolume(records, p.NM);
    // the measured litres per run (median, 7 days) at the run time FarmNet holds now, scaled to this on time
    const oldOn = Math.max(0, ...W.valvesOf(r.par).map(v => v.stm));
    const litres = vol.litres && oldOn ? ` · about ${Math.round(vol.litres * (num(plan.on) ?? 0) / oldOn * n)} L a day` : '';
    const dd = W.dayOf(plan, sun), f = sim?.starts[0];
    const why = !f ? '' : dd && f.at === dd.anchor ? (plan.anchorAt === 'p1' ? 'sunrise' : 'sunset') : `${PN[f.k].toLowerCase()} start: the ${plan.anchorAt === 'p1' ? 'morning' : 'night'} has no irrigation`;
    const first = f ? ` · first at ${W.clock(f.at)} (${why})` : '';
    const on = plan.switchOn ? ' · switched ON by Save' : W.isOnNow(plan) ? '' : ' · the program is off: nothing runs until it is switched on';
    return el('div', 'sc-summary', `${valves.length ? valves.join(', ') : 'No valve yet'} · ${n} irrigation${n === 1 ? '' : 's'} today · ${mmss(plan.on)} each${litres}${first}${on}`);
  }

  // the water: every valve of every source FarmNet lists, as a chip (on = in the program); the recipe per source
  function waterOf() {
    const sec = el('div', 'sc-sec');
    sec.append(el('div', 'sc-label', 'Water — valves and recipe'));
    const own = (plan.sources || []).map(s => ({ sid: s.sid, name: s.name, ff: s.ff, valves: s.valves.map(v => ({ id: v.id, name: v.name })) }));
    // FarmNet's list, plus anything the program uses that the list does not show (marked: FarmNet may refuse a change to it)
    const srcList = tree ? [...tree.map(t => { const o = own.find(x => x.sid === t.sid); const extra = o ? o.valves.filter(v => !t.valves.some(y => y.id === v.id)).map(v => ({ ...v, unlisted: true })) : [];
      return { ...t, valves: [...t.valves, ...extra] }; }), ...own.filter(o => !tree.some(t => t.sid === o.sid)).map(o => ({ ...o, valves: o.valves.map(v => ({ ...v, unlisted: true })) }))] : own;
    if (!srcList.length) { sec.append(el('div', 'hint', 'FarmNet lists no water source for this centre.')); return sec; }
    srcList.forEach(t => {
      const mine = (plan.sources || []).find(s => s.sid === t.sid);
      const row = el('div', 'sc-water');
      row.append(el('span', 'hint', t.name));
      const chips = el('div', 'chips');
      t.valves.forEach(v => {
        const isOn = !!mine?.valves.some(x => x.id === v.id);
        const b = el('button', 'chip' + (isOn ? ' on' : ''), v.unlisted ? `${v.name} (not in FarmNet's list)` : v.name); b.type = 'button'; b.disabled = !may || !tree; b.setAttribute('aria-pressed', String(isOn));
        b.onclick = () => {
          plan.sources = plan.sources || [];
          let s = plan.sources.find(x => x.sid === t.sid);
          if (!s) { s = { sid: t.sid, name: t.name, ff: t.ff !== false, fid: -1, valves: [] }; plan.sources.push(s); }
          s.valves = isOn ? s.valves.filter(x => x.id !== v.id) : [...s.valves, { id: v.id, name: v.name, stm: plan.on }];
          plan.sources = plan.sources.filter(x => x.valves.length);
          plan.valves = plan.sources.flatMap(x => x.valves.map(y => ({ sid: x.sid, id: y.id, name: y.name, stm: plan.on })));
          redraw();
        };
        chips.append(b);
      });
      row.append(chips);
      if (mine && mine.ff) {
        const rs = sel([[-1, 'No recipe'], ...recipes.map(x => [x.ID, x.NM || `Recipe ${x.ID}`])], mine.fid);
        rs.disabled = !may || !tree; rs.setAttribute('aria-label', `${t.name} recipe`);
        rs.onchange = () => { mine.fid = Number(rs.value); redraw(); };
        row.append(field('Recipe', rs));
      }
      sec.append(row);
    });
    if (!tree && may) sec.append(el('div', 'hint', 'FarmNet did not list its valves: the valves and recipe are shown as they are and cannot be changed here.'));
    return sec;
  }

  function keptNotes() {
    return (plan.kept || []).filter(k => k.why || k.dropped).map(k => {
      const n = el('div', k.dropped ? 'hint' : 'note warn', `An influence on ${k.name}: ${k.dropped ? 'dropped on Save' : `${k.why} — drop it to save`}`);
      if (may) { const b = el('button', 'btn btn-sm', k.dropped ? 'Keep it' : 'Drop it'); b.type = 'button';
        b.onclick = () => { plan.drop = k.dropped ? plan.drop.filter(x => x !== k.pId) : [...plan.drop, k.pId]; k.dropped = !k.dropped; redraw(); }; n.append(document.createTextNode(' '), b); }
      return n;
    });
  }

  // copy the cycle (on time, first irrigation, shifts, periods) of another program; its valves stay this program's own
  function copyRow() {
    const others = programs.filter(x => Number(x.ID) !== Number(p.ID));
    const row = el('div', 'sc-row sc-copy');
    if (!may || !others.length) return row;
    const s = sel([['', 'Copy the cycle of…'], ...others.map(x => [x.ID, x.NM])], '');
    s.setAttribute('aria-label', 'Copy the cycle of another program');
    s.onchange = async () => {
      const o = others.find(x => String(x.ID) === s.value); if (!o) return;
      s.disabled = true;
      try {
        const q = await readProgram(ctx, c, o.ID);
        const from = W.planFromFarmnet(o, q.par, { st: q.st, cst: q.cst, en: q.en, isDrain: () => false, isWeather: () => false });
        plan.on = from.on ?? plan.on; plan.p1 = clamp(from.p1); plan.p3 = clamp(from.p3); plan.anchor = plan.p3; plan.anchorAt = from.anchorAt;
        plan.periods.forEach((x, i) => { x.off = from.periods[i].off; });
        toast(`The cycle of "${o.NM}" copied here: Save to send it`, 'ok');
      } catch (e) { toast(`Not copied: ${e.message}`, 'bad'); }
      redraw();
    };
    row.append(s);
    return row;
  }

  function moreOf() {
    const more = el('details', 'sc-more');
    more.append(el('summary', 'hint', 'Advanced: gaps, pump sharing, days'));
    const row = el('div', 'sc-row');
    const n = (v, set, label) => { const i = el('input', 'input sc-num'); i.type = 'number'; i.min = '0'; i.max = '1000'; i.value = String(v ?? 0); i.disabled = !may; i.setAttribute('aria-label', label);
      i.onchange = () => { const x = Math.round(Number(i.value)); set(Number.isFinite(x) ? x : 0); redraw(); }; return i; };
    row.append(field('Min gap, min', n(plan.mint, v => { plan.mint = v; }, 'Minimum gap, minutes')),
      field('Max gap, min', n(plan.maxt, v => { plan.maxt = v; }, 'Maximum gap, minutes')));
    const pump = sel([[0, 'Wait'], [1, 'Run together']], plan.cmd); pump.disabled = !may; pump.setAttribute('aria-label', 'Sharing a pump');
    pump.onchange = () => { plan.cmd = Number(pump.value); redraw(); };
    row.append(field('Sharing a pump', pump));
    const days = el('div', 'win-days');
    const dm = sel(DAYS, plan.days.mode); dm.disabled = !may; dm.setAttribute('aria-label', 'Irrigation days');
    dm.onchange = () => { plan.days.mode = Number(dm.value); redraw(); };
    days.append(dm);
    if (plan.days.mode === 1) days.append(n(plan.days.every, v => { plan.days.every = Math.max(1, v); }, 'Every how many days'), el('span', 'hint', ' days'));
    if (plan.days.mode === 2) WEEK.forEach((w, i) => {
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!((plan.days.weekdays >> i) & 1); cb.disabled = !may;
      cb.onchange = () => { plan.days.weekdays = cb.checked ? plan.days.weekdays | (1 << i) : plan.days.weekdays & ~(1 << i); };
      const l = el('label', 'win-off'); l.append(cb, document.createTextNode(' ' + w)); days.append(l);
    });
    row.append(field('Days', days));
    more.append(row);
    return more;
  }

  redraw();
  if (may) {
    const go = tagCmd(el('button', 'btn btn-primary', 'Save → FarmNet'), 'diy_edit', p.ID); go.type = 'button';
    go.onclick = async () => {
      const done = await saveSun(ctx, c, p, plan, sun, out, go, sourceIds);
      if (done) { was = JSON.stringify(strip(plan)); d.body.scrollTop = d.body.scrollHeight; }   // later edits are guarded again
    };
    d.footer.append(go);
  }
}

// the plan without what the panel only shows (for "unsaved changes")
const strip = plan => ({ ...plan, kept: undefined, enNow: undefined });

// a new sun-cycle program: its name, then FarmNet makes it (switched off) and the panel opens on it
export function newSunCycle(ctx, c, opts = {}) {
  const d = drawer('New sun-cycle program', `${c.name} · FarmNet makes it switched off; you set it next`);
  const name = el('input', 'input'); name.maxLength = 40; name.placeholder = 'Lettuce bay 3';
  d.body.append(field('Name', name), el('div', 'hint', 'Next: its valves, the on time, and the three periods. It stays off until you switch it on.'));
  const go = tagCmd(el('button', 'btn btn-primary', 'Make it'), 'program_add');
  go.onclick = async () => {
    const n = name.value.trim();
    if (!n) { toast('Give it a name', 'bad'); name.focus(); return; }
    if ((opts.programs || []).some(x => String(x.NM).trim().toLowerCase() === n.toLowerCase())) { toast(`A program "${n}" exists already`, 'bad'); return; }
    busy(go, true, 'Making it…');
    let res;
    try { res = await runCommand('program_add', { id: c.id, changes: { name: n } }, { ctx }); }
    catch (e) {
      d.body.append(el('div', 'note bad', `${e.message}. FarmNet may have made the program all the same: look for it on the page before making another.`));
      busy(go, false, 'Make it'); go.disabled = true; opts.after?.(); return;
    }
    d.close();
    const id = Number(res?.created ?? res?.data?.ID);
    if (Number.isInteger(id)) openSunCycle(ctx, c, { ID: id, NM: n }, { ...opts, fresh: true });
    else opts.after?.();
  };
  d.footer.append(go);
  setTimeout(() => name.focus(), 50);
}

// ── Save → FarmNet: FarmNet read fresh, every step built and checked first (windows-plan.js prepareSave), then sent in
// order as one group on the Timeline, each kept before it changes ──────────────────────────────────────────────────────
const STEPS = ['The program: name, cycle, the window 00:00–23:59, valves and recipe, on time, days, gaps, pumps',
  'Start 1, where it is DIY: one period holding 00:00', 'The window ends 23:59 (with the program)',
  'The off time per period (CST, DIY)', 'On / off per period, and the first irrigation (EN, DIY)', 'Read back from FarmNet'];
const STEP_OF = { st: 1, et: 2, cst: 3, en: 4 };

export async function saveSun(ctx, c, prog, planIn, sun, out, go, sourceIds) {
  const plan = structuredClone(strip(planIn));
  plan.enNow = planIn.enNow;
  const early = W.problemsOf(plan, sun);
  if (early.length) { toast(`Not sent: ${early[0]}`, 'bad'); return false; }
  busy(go, true, 'Reading FarmNet…');
  let prep, fresh;
  try {
    fresh = await readProgram(ctx, c, prog.ID);
    prep = W.prepareSave(plan, sun, { par: fresh.par, st: fresh.st, cst: fresh.cst, en: fresh.en }, sourceIds, () => false);
  } catch (e) { busy(go, false); toast(`Not sent: ${e?.message || e}`, 'bad'); return false; }
  busy(go, false);
  if (prep.problems.length) { out.replaceChildren(el('div', 'note bad', `Nothing sent. ${prep.problems.join(' · ')}`)); return false; }
  const sim = W.simulate(plan, sun);
  if (plan.switchOn && !(await confirmDrawer(`Switch "${plan.name}" on?`,
    `FarmNet starts watering with it: ${sim?.starts.length ?? 0} irrigations a day, ${mmss(plan.on)} each, first at ${sim?.starts[0] ? W.clock(sim.starts[0].at) : '—'}. `
    + 'The way FarmNet starts the first irrigation at the switch-on is still being checked on a trial program.', 'Switch it on'))) return false;
  busy(go, true, 'Sending…');
  const group = globalThis.crypto?.randomUUID?.() ?? null;
  const state = STEPS.map(label => ({ label, st: 'todo', note: '' }));
  const list = el('ol', 'win-steps');
  const mark = { done: '✓', same: '–', skip: '–', bad: '✕', todo: '·' };
  const draw = () => list.replaceChildren(...state.map(s => el('li', s.st === 'bad' ? 'is-bad' : s.st === 'todo' ? null : 'is-done',
    `${mark[s.st]} ${s.label}${s.note ? ' — ' + s.note : s.st === 'todo' ? ' — not done' : ''}`)));
  out.replaceChildren(el('div', 'cx-kind-label', 'Save → FarmNet'), list);
  if (!prep.steps.some(s => s.role === 'en')) { state[4].st = 'skip'; state[4].note = 'not needed: kept as FarmNet holds it'; }
  if (!prep.steps.some(s => s.role === 'st')) { state[1].st = 'skip'; state[1].note = prep.stLinked ? 'already 00:00' : 'not DIY: set with the program'; }
  draw();
  const cmd = (name, args, what) => runCommand(name, { id: c.id, ...args }, { ctx, group, summary: `Sun cycle · ${plan.name}: ${what}` });
  let stopped = false;
  for (const s of prep.steps) {
    const i = s.kind === 'program' ? 0 : STEP_OF[s.role];
    try {
      if (s.kind === 'program') {
        try { await cmd('program_set', { proId: prog.ID, changes: s.changes }, 'the program'); state[i].st = 'done'; }
        catch (e) { if (!/nothing changes/i.test(e?.message || '')) throw e; state[i].st = 'same'; state[i].note = 'already so'; }
        state[STEP_OF.et].st = state[i].st;
        state[STEP_OF.et].note = s.changes.starts?.find(x => x.i === 0)?.et !== undefined ? 'with the program' : 'already 23:59';
      } else {
        if (s.add) await cmd('diy_add', { type: 0, proId: prog.ID, SR: s.sr }, `${s.what} made DIY`);
        await cmd('diy_edit', { type: 0, proId: prog.ID, SR: s.sr, diy: s.body, ...(s.role === 'en' && plan.switchOn ? { switch_on: true } : {}) }, `${s.what} periods`);
        state[i].st = 'done';
        state[i].note = `${s.add ? 'made DIY, ' : ''}${s.body.time.length} period${s.body.time.length === 1 ? '' : 's'}`;
      }
    } catch (e) { state[i].st = 'bad'; state[i].note = e?.message || String(e); stopped = true; }
    draw();
    if (stopped) break;
  }
  if (!stopped) {
    const back = await soft(readProgram(ctx, c, prog.ID));
    state[5].st = back.e ? 'bad' : 'done';
    state[5].note = back.e ? `not read: ${back.e}` : `${W.isSunCycle(back.v.par) ? 'a sun-cycle program' : 'not yet in the new format'} · off times ${W.periodsText(back.v.cst)}`;
    draw();
  }
  busy(go, false);
  if (stopped) { toast(`Stopped: ${state.find(s => s.st === 'bad')?.note || 'refused'}`, 'bad'); return false; }
  toast(`"${plan.name}" sent to FarmNet`, 'ok');
  return true;
}
