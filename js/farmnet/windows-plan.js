// FarmNet › Windows: the arithmetic of the page, without the screen (docs/plan-irrigation-windows-2026-11-21.md).
// No import: node loads it too. Everything here is computed when the page opens or a field changes — no loop, no timer,
// nothing scheduled (owner, 21 Nov 2026: "use the FarmNet logic without adding additional loop on Naked Heart").
//
// A card's plan (what the person sets; every value ends in a FarmNet program field):
//   kind     'vines' | 'nft' | 'ebb'                 (fills the preset)
//   anchor   min after (+) or before (−) sunset       TM[0].ST as DIY, one period tp 2 (TM[0].ET a plain time END_MARGIN before)
//   p1, p3   min after/before sunrise and sunset      CST as DIY, periods tp 1 / 0 (12:00 fixed) / 2
//   periods  [{ off: min | null (OFF), ramp: min, auto: { signal, target, range }, weather: { signal, setpoint, range } }] × 3
//   valves   [{ sid, id, name, stm }]                 each valve's run time (STM, s)
//   mint, maxt (min) · cmd 0 wait / 1 together · days { mode, every, weekdays } · rsif (always true when saved)

export const DAY = 86400, NOON = 43200;
export const OFF_MAX_MIN = 1000;                  // CST holds 0–60000 s; past 1000 min (or OFF) the period is switched off (EN)
export const RUN_MAX = 4 * 3600;                  // Naked Heart's cap on a valve's run (as program_set)

// ── THE ONE PLACE for how FarmNet stores a period's start (st) ───────────────────────────────────────────────────────
// Read on FB1 (program 29, SR 10, 21 Nov 2026): tp 0 st = seconds after the farm's midnight (28800 = 08:00); riseT and
// setT are seconds after midnight too. NOT YET SEEN: a period of tp 1 (sunrise) or tp 2 (sunset). Assumed here: its st is
// the offset in signed seconds from the sun event (+ after, − before). The API document says only "relative to sunrise /
// sunset" and gives no bounds, so Naked Heart keeps offsets within ± 6 h (the function checks the same bound,
// fnlink.ts DIY_OFFSET_MAX). After a Save the page shows what diy_get reads back, to confirm this on the trial copy;
// if FarmNet stores it otherwise, only stOf / offsetOf change.
export const OFFSET_MAX = 6 * 3600;
// The window's end (TM[0].ET) is never made DIY: on the trial copy (21 Nov 2026) FarmNet stopped answering for about a minute,
// twice, at the diy/add of SR 20. Where irrigation stops each day follows the sun through on/off per period instead (P3
// OFF from sunset ± min, EN DIY, which worked); the end itself is a plain time END_MARGIN before the first cycle, so the
// start moving with the sun (1–2 min a day) never shrinks the window to nothing. Each Save sets it again (owner, 21 Nov 2026)
export const END_MARGIN = 30 * 60;
export const stOf = (tp, seconds) => (tp === 0 ? ((Math.round(seconds) % DAY) + DAY) % DAY : Math.round(seconds));
export const offsetOf = (tp, st) => Number(st) || 0;            // tp 1/2: the signed offset in seconds; tp 0: the clock
// The period's transition time (itm) is taken as seconds, like st (0 on FB1: not yet seen otherwise)
export const ITM_UNIT = 1;
// Is CST the pause after a run, or start to start? Not known yet (the trial copy says): false = the pause after the run,
// so a period's "off" is CST's value as it is. If it proves start-to-start, set true: CST = off + on.
export const CST_START_TO_START = false;

export const num = v => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null; };
const diyV = x => (x && typeof x === 'object' && 'V' in x ? x.V : x);
export const clock = s => {
  const n = num(s); if (n === null) return '—';
  const m = Math.round((((n % DAY) + DAY) % DAY) / 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const signed = m => (m > 0 ? `+ ${m}` : m < 0 ? `− ${-m}` : '+ 0');

// FarmNet answers diy_get as { SR, diy: { param, time, influe, riseT, setT, cal }, id, proId, type } (trial, 21 Nov 2026):
// the DIY itself is its .diy; a DIY already unwrapped passes through
export const diyOf = x => (x && typeof x === 'object' && !('param' in x) && x.diy && typeof x.diy === 'object' ? x.diy : x);
// a DIY as diy_get answers it: linked when its param carries the id of a DIY (param.id ≥ 0); not linked: param.id −1, time []
export const linked = d => !!d && typeof d === 'object' && num(d?.param?.id) !== null && num(d.param.id) >= 0;
export function sunOf(...diys) {
  for (const d of diys) {
    const r = num(d?.riseT), s = num(d?.setT);
    if (r !== null && s !== null && r > 0 && s > r && s < DAY) return { rise: r, set: s };
  }
  return null;
}

// the SR numbers of the parameters a window uses, from the program in full (FarmNet's own numbering), else FB1's
export function srsOf(par) {
  const sr = (p, d) => num(p?.SR) ?? d;
  const t0 = Array.isArray(par?.TM) ? par.TM[0] : null;
  return { en: sr(par?.EN, 1), cst: sr(par?.CST, 3), st: sr(t0?.ST, 10), et: sr(t0?.ET, 20) };
}

// ── what FarmNet runs today, as a plan (so the first Save changes the timing pattern, not the water given) ───────────
export const kindOf = name => /nft/i.test(name || '') ? 'nft' : /ebb|flood|e&f/i.test(name || '') ? 'ebb' : 'vines';
export function valvesOf(par) {
  return (Array.isArray(par?.SRC) ? par.SRC : []).flatMap(s => (Array.isArray(s?.VAL) ? s.VAL : [])
    .map(v => ({ sid: Number(s.SID), id: Number(v.ID), name: String(v.NM ?? v.ID), stm: num(diyV(v.STM)) ?? 0 })));
}
const PERIOD_OF_TP = { 1: 0, 0: 1, 2: 2 };
const blankPeriod = () => ({ off: null, ramp: 0, auto: { signal: '', target: null, range: 20 }, weather: { signal: '', setpoint: null, range: 20 } });

export function planFromFarmnet(prog, par, diy = {}) {
  const valves = valvesOf(par);
  const on = Math.max(0, ...valves.map(v => v.stm));
  const plan = {
    kind: kindOf(prog?.NM ?? par?.NM), anchor: 0, p1: 0, p3: 0,
    periods: [blankPeriod(), blankPeriod(), blankPeriod()],
    valves, mint: Math.round((num(diyV(par?.MINT)) ?? 0) / 60), maxt: Math.round((num(diyV(par?.MAXT)) ?? 0) / 60),
    cmd: Number(par?.CMD) === 0 ? 0 : 1,
    days: { mode: Number(par?.DT?.DMD) || 0, every: Number(par?.DT?.DID) || 1, weekdays: Number(par?.DT?.DWD) || 127 },
    from: 'farmnet',
  };
  // the off of each period: CST's own periods when it is DIY, else its one value, else (a timer) the mean gap of its starts
  let staticOff = null;
  const cst = num(diyV(par?.CST));
  if (Number(par?.SMD) === 1 && cst !== null && cst > 0) staticOff = cst;
  else {
    const n = (Array.isArray(par?.TM) ? par.TM : []).filter(x => x?.USE === true).length;
    if (n > 0) { staticOff = Math.max(60, Math.round(DAY / n - on)); plan.estimated = n; }
  }
  const toMin = s => Math.round((CST_START_TO_START ? s - on : s) / 60);
  plan.periods.forEach(p => { p.off = staticOff === null ? null : toMin(staticOff); });
  if (linked(diy.cst) && Array.isArray(diy.cst.time)) {
    diy.cst.time.forEach((t, i) => {
      const k = PERIOD_OF_TP[Number(t?.tp)]; if (k === undefined) return;
      const bv = num(t.bv); if (bv !== null) plan.periods[k].off = toMin(bv);
      plan.periods[k].ramp = Math.round((num(t.itm) ?? 0) * ITM_UNIT / 60);
      if (Number(t.tp) === 1) plan.p1 = Math.round(offsetOf(1, t.st) / 60);
      if (Number(t.tp) === 2) plan.p3 = Math.round(offsetOf(2, t.st) / 60);
      (Array.isArray(diy.cst.influe) ? diy.cst.influe : []).forEach(f => {
        if (!Array.isArray(f?.en) || f.en[i] !== true) return;
        const slot = diy.isDrain?.(f.pId) ? 'auto' : diy.isWeather?.(f.pId) ? 'weather' : null;
        if (!slot) return;
        const base = bv || 1, half = Math.max(Math.abs(num(f.iMin?.[i]) ?? 0), Math.abs(num(f.iMax?.[i]) ?? 0));
        plan.periods[k][slot] = slot === 'auto'
          ? { signal: String(f.pId), target: num(f.iS?.[i]), range: Math.round((half / base) * 100) }
          : { signal: String(f.pId), setpoint: num(f.iS?.[i]), range: Math.round((half / base) * 100) };
      });
    });
  }
  // a period FarmNet switches off (EN as DIY, bv 0 in it)
  if (linked(diy.en) && Array.isArray(diy.en.time)) diy.en.time.forEach(t => {
    const k = PERIOD_OF_TP[Number(t?.tp)];
    if (k !== undefined && num(t.bv) === 0) plan.periods[k].off = null;
  });
  // the first cycle: sunset (NFT, ebb & flow) or the P1 start (vines, owner 21 Nov 2026) — as FarmNet's start DIY says
  // when it is sun-relative, else by the kind of system
  plan.anchorAt = plan.kind === 'vines' ? 'p1' : 'sunset';
  if (linked(diy.st) && Array.isArray(diy.st.time)) {
    const t2 = diy.st.time.find(x => Number(x?.tp) === 2), t1 = diy.st.time.find(x => Number(x?.tp) === 1);
    if (t2) { plan.anchorAt = 'sunset'; plan.anchor = Math.round(offsetOf(2, t2.st) / 60); }
    else if (t1) plan.anchorAt = 'p1';
  }
  plan.periods.forEach(p => { if (p.off !== null && p.off > OFF_MAX_MIN) p.off = null; });
  // the program's on/off as FarmNet holds it, per period: Save keeps it (verifier, 21 Nov 2026: Save never switches a
  // program on); only the card's own "Switch the program on" (off by default) may
  plan.enNow = enNowOf(par, diy.en);
  plan.enLinked = linked(diy.en);
  plan.switchOn = false;
  plan.drop = [];          // influences the person dropped (kept ones that no longer fit the periods)
  return plan;
}

// is each of P1 / P2 / P3 switched on now? EN not DIY: its one value. EN DIY: all on or all off when its periods agree;
// otherwise the period of the same type (1 / 0 / 2), and a period with no match counts as off (never on by a guess)
export function enNowOf(par, en) {
  if (!linked(en) || !Array.isArray(en.time) || !en.time.length) { const v = num(diyV(par?.EN)); return [0, 1, 2].map(() => v !== null && v !== 0); }
  const vals = en.time.map(t => num(t?.bv));
  if (vals.every(v => v !== null && v !== 0)) return [true, true, true];
  if (vals.every(v => v === 0 || v === null)) return [false, false, false];
  const out = [false, false, false];
  en.time.forEach(t => { const k = PERIOD_OF_TP[Number(t?.tp)]; if (k !== undefined) out[k] = num(t.bv) !== 0 && num(t.bv) !== null; });
  return out;
}
export const isOnNow = plan => (plan.enNow || []).some(Boolean);
export const isAllOnNow = plan => (plan.enNow || []).length === 3 && plan.enNow.every(Boolean);

// ── presets (owner's brief, 21 Nov 2026) ─────────────────────────────────────────────────────────────────────────────
// vines 45 / 25 / OFF, P1 sunrise + 60, P3 sunset − 150; NFT as now (1800 s) every period; ebb & flow 3600 s every period.
// The valves' run times and everything else stay as the card holds them.
export const PRESETS = {
  // owner, 21 Nov 2026: for vines the day starts at P1 — the first cycle (TM[0].ST) at the P1 start, not at sunset; NFT
  // and ebb & flow run all night and keep the sunset anchor
  vines: { label: 'Vines (drip)', offs: [45, 25, null], p1: 60, p3: -150, anchorAt: 'p1' },
  nft: { label: 'NFT', offs: [30, 30, 30], p1: 0, p3: 0, anchorAt: 'sunset' },
  ebb: { label: 'Ebb & flow', offs: [60, 60, 60], p1: 0, p3: 0, anchorAt: 'sunset' },
};
export function applyPreset(plan, kind) {
  const p = PRESETS[kind]; if (!p) return plan;
  const out = structuredClone(plan);
  out.kind = kind; out.p1 = p.p1; out.p3 = p.p3; out.anchorAt = p.anchorAt;
  if (p.anchorAt === 'sunset') out.anchor = 0;
  out.periods.forEach((x, i) => { x.off = p.offs[i]; });
  return out;
}

// ── the day the plan makes, from today's sunrise and sunset ──────────────────────────────────────────────────────────
// P1 sunrise ± p1 → 12:00, P2 12:00 → sunset ± p3, P3 → the next P1. Clock times in seconds after midnight.
export function dayOf(plan, sun) {
  if (!sun) return null;
  const starts = [sun.rise + plan.p1 * 60, NOON, sun.set + plan.p3 * 60];
  const on = Math.max(0, ...plan.valves.map(v => num(v.stm) ?? 0));
  const periods = starts.map((s, i) => {
    const next = i === 2 ? starts[0] + DAY : starts[i + 1];
    const len = next - s;
    const p = plan.periods[i];
    const cycle = p.off === null ? null : (CST_START_TO_START ? Math.max(p.off * 60, on) : p.off * 60 + on);
    const runs = cycle && len > 0 ? Math.floor(len / cycle) : 0;
    return { start: ((s % DAY) + DAY) % DAY, end: ((next % DAY) + DAY) % DAY, len, runs };
  });
  const order = periods.every((p, i) => i === 0 || p.len > 0) && periods[0].len > 0;
  const a = plan.anchorAt === 'p1' ? sun.rise + plan.p1 * 60 : sun.set + plan.anchor * 60;
  return { anchor: ((a % DAY) + DAY) % DAY, periods, runs: periods.reduce((a, p) => a + p.runs, 0), order, on };
}

// the median of the measured volume of a program's runs (irrigation_records type 0, VLM m³), in litres; 0 = no flow reading
export function medianVolume(records, name) {
  const v = (records || []).filter(r => String(r?.NM ?? '').trim() === String(name ?? '').trim()).map(r => num(r.VLM)).filter(x => x !== null).sort((a, b) => a - b);
  if (!v.length) return { runs: 0, litres: null };
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { runs: v.length, litres: Math.round(m * 1000) };
}

// what the person should know but may still send: the first cycle at the anchor falls in a period that is OFF
export function warningsOf(plan, sun) {
  const d = dayOf(plan, sun); if (!d) return [];
  const a = d.anchor, k = d.periods.findIndex(p => (p.start <= p.end ? a >= p.start && a < p.end : a >= p.start || a < p.end));
  return k >= 0 && plan.periods[k].off === null ? [`the first cycle (${clock(a)}) falls in P${k + 1}, which is OFF: no cycle at the anchor`] : [];
}

// ── the plan checked before anything is sent (the function checks again, against FarmNet's own limits) ──────────────
export function problemsOf(plan, sun) {
  const out = [];
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (plan.anchorAt !== 'p1' && !int(plan.anchor, -OFFSET_MAX / 60, OFFSET_MAX / 60)) out.push(`the anchor: sunset ± ${OFFSET_MAX / 60} min at most`);
  if (!int(plan.p1, -OFFSET_MAX / 60, OFFSET_MAX / 60)) out.push(`P1: sunrise ± ${OFFSET_MAX / 60} min at most`);
  if (!int(plan.p3, -OFFSET_MAX / 60, OFFSET_MAX / 60)) out.push(`P3: sunset ± ${OFFSET_MAX / 60} min at most`);
  plan.periods.forEach((p, i) => {
    if (p.off !== null && !int(p.off, 0, OFF_MAX_MIN)) out.push(`P${i + 1}: off 0–${OFF_MAX_MIN} min, or OFF`);
    if (!int(p.ramp, 0, 240)) out.push(`P${i + 1}: ramp 0–240 min`);
    for (const [slot, word, key] of [['auto', 'Auto', 'target'], ['weather', 'Weather', 'setpoint']]) {
      const x = p[slot];
      if (!x?.signal) continue;
      if (p.off === null) out.push(`P${i + 1}: ${word} on a period that is OFF`);
      if (num(x[key]) === null) out.push(`P${i + 1}: ${word} needs its ${key}`);
      if (!int(x.range, 1, 100)) out.push(`P${i + 1}: ${word} range 1–100 %`);
    }
  });
  if (plan.periods.every(p => p.off === null)) out.push('every period is OFF: switch the program off instead');
  plan.valves.forEach(v => { if (!int(v.stm, 1, RUN_MAX)) out.push(`${v.name}: run 1 s – ${RUN_MAX / 3600} h`); });
  if (!plan.valves.length) out.push('the program has no valve');
  if (!int(plan.mint, 0, 1000) || !int(plan.maxt, 0, 1000)) out.push('min and max gap: 0–1000 min');
  if (plan.maxt && plan.mint > plan.maxt) out.push('the min gap is above the max gap');
  if (sun) { const d = dayOf(plan, sun); if (!d.order) out.push('the periods overlap: P1 must start before 12:00 and P3 after it'); }
  else out.push('FarmNet gave no sunrise and sunset for this centre');
  return out;
}

// ── what Save sends, step by step (the brief's "Save → FarmNet") ─────────────────────────────────────────────────────
const f2 = n => Number(n).toFixed(2);
// a period as FarmNet writes it (values as text with two decimals, as it answers them)
const period = (tp, st, bv, itm = 0, lim = null) => ({ en: true, tp, st: stOf(tp, st), itm: Math.round(itm / ITM_UNIT), bv: f2(bv), of: false,
  ifl: !!lim, min: f2(lim ? lim[0] : 0), max: f2(lim ? lim[1] : 0) });

// 1. program_set: cycle mode, TM[0] in use and the others off, valve run times, days, gaps, pumps, irrigate at the start
export function programChanges(plan, par, sun) {
  const ch = { mode: 1, rsif: true, cmd: plan.cmd, mint: plan.mint * 60, maxt: plan.maxt * 60,
    valves: plan.valves.map(v => ({ sid: v.sid, id: v.id, stm: v.stm })),
    days: plan.days.mode === 1 ? { mode: 1, every: plan.days.every } : plan.days.mode === 2 ? { mode: 2, weekdays: plan.days.weekdays } : { mode: plan.days.mode } };
  const tm = Array.isArray(par?.TM) ? par.TM : [];
  ch.starts = tm.map((x, i) => ({ i, use: i === 0 })).filter((s, i) => (tm[i]?.USE === true) !== s.use);
  // the window's static start where it is not DIY yet (the DIY one is set in step 2): today's anchor; its end, never DIY
  // (END_MARGIN): a plain time 30 min before the anchor
  const t0 = tm[0];
  const d = dayOf(plan, sun);
  if (t0 && d) {
    const s0 = ch.starts.find(s => s.i === 0) || { i: 0 };
    if (!(t0.ST?.DEN === true)) s0.st = d.anchor;
    if (!(t0.ET?.DEN === true)) s0.et = (d.anchor - END_MARGIN + DAY) % DAY;
    if (s0.st !== undefined || s0.et !== undefined || s0.use !== undefined) ch.starts = [s0, ...ch.starts.filter(s => s.i !== 0)];
  }
  // a timer turned cycling needs its interval before CST becomes DIY (the function refuses a cycle with none)
  if (Number(par?.SMD) !== 1 || (num(diyV(par?.CST)) ?? 0) < 60) {
    const first = plan.periods.find(p => p.off !== null);
    ch.cycle = Math.max(60, Math.min(60000, cstSeconds(first?.off ?? 1, d?.on ?? 0)));
  }
  if (!ch.starts.length) delete ch.starts;
  // never on by Save: only the card's own "Switch the program on", and only here when EN stays a plain value (a DIY EN
  // or a period OFF: step 4 writes it)
  if (plan.switchOn && !plan.enLinked && !plan.periods.some(p => p.off === null)) ch.on = true;
  return ch;
}
const cstSeconds = (offMin, on) => Math.round(offMin * 60 + (CST_START_TO_START ? on : 0));

// 2. the anchor: TM[0].ST one period from sunset ± anchor (TM[0].ET is never DIY: END_MARGIN). bv is today's clock time of
// the anchor (what FarmNet would hold if it takes the value and not the period's start — not yet known), so the window
// is right today whichever it does; diy_get read back after Save shows which.
// The period itself is sun-relative (tp 2 sunset ± anchor; tp 1 sunrise ± P1 when the first cycle is the P1 start), so
// whichever FarmNet reads, st or bv, points at the sun event today.
export function anchorDiys(plan, sun) {
  const d = dayOf(plan, sun);
  const [tp, off] = anchorRel(plan);
  return {
    st: { time: [period(tp, off, d.anchor)] },
  };
}
// the anchor as FarmNet's period: [tp, offset seconds]
export const anchorRel = plan => (plan.anchorAt === 'p1' ? [1, plan.p1 * 60] : [2, plan.anchor * 60]);
// what the card says is written for the first cycle (verifier, 21 Nov 2026: plainly, a fixed time today)
export function anchorWords(plan, sun) {
  const d = dayOf(plan, sun); if (!d) return '—';
  const what = plan.anchorAt === 'p1' ? `today's sunrise ${signed(plan.p1)} min (the P1 start)` : `today's sunset ${signed(plan.anchor)} min`;
  return `start at ${clock(d.anchor)} — ${what}; whether FarmNet moves it with the sun each day is checked on the trial copy`;
}

// where irrigation stops each day, in words: the periods OFF (they follow the sun), and the window's own end
export function endWords(plan, sun) {
  const d = dayOf(plan, sun); if (!d) return '—';
  const from = ['sunrise', '12:00', 'sunset'], rel = [plan.p1, null, plan.p3];
  const off = plan.periods.map((p, i) => (p.off === null ? `P${i + 1} OFF from ${clock(d.periods[i].start)} (${rel[i] === null ? from[i] : `${from[i]} ${signed(rel[i])} min`})` : null)).filter(Boolean);
  const end = `the window itself ends at ${clock((d.anchor - END_MARGIN + DAY) % DAY)}, ${END_MARGIN / 60} min before the first cycle`;
  const sunny = plan.periods.some((p, i) => p.off === null && i !== 1);
  const head = off.length ? `${off.join(', ')}${sunny ? ': follows the sun' : ''}` : 'no period OFF: cycles all day and night';
  return `${head} · ${end}, a fixed time: Save again within two weeks (the start moves with the sun, 1–2 min a day)`;
}

// 3. CST's three periods, and one influence per signal used. managed(pId): a signal the card offers (its influences are
// the card's: one cleared on the card is dropped); the influences on any other signal stay as read
export function cstDiy(plan, sun, readInflue = [], managed = () => false) {
  const d = dayOf(plan, sun);
  const offs = plan.periods.map(p => (p.off === null ? 60000 : Math.min(60000, cstSeconds(p.off, d.on))));
  const time = [
    period(1, plan.p1 * 60, offs[0], plan.periods[0].ramp * 60),
    period(0, NOON, offs[1], plan.periods[1].ramp * 60),
    period(2, plan.p3 * 60, offs[2], plan.periods[2].ramp * 60),
  ];
  // the signals used, each one influence with its values per period index (30 places, FarmNet's form)
  const used = new Map();
  plan.periods.forEach((p, i) => {
    for (const [slot, key] of [['auto', 'target'], ['weather', 'setpoint']]) {
      const x = p[slot];
      if (!x?.signal || p.off === null) continue;
      if (!used.has(x.signal)) used.set(x.signal, []);
      const half = Math.round(offs[i] * x.range / 100);
      used.get(x.signal).push({ i, set: num(x[key]), lo: -half, hi: half });
      // the period's own limit (ifl, min, max: "influence amount" in the API document) is left off: whether min / max are
      // amounts or the value's bounds is not yet seen, and either reading of a wrong guess would pin the interval. The
      // influence's own iMin / iMax bound what it moves (to be read back on the trial copy: cal / mes of diy_get)
    }
  });
  const ours = new Set(used.keys());
  const dropped = new Set(plan.drop || []);
  const kept = (Array.isArray(readInflue) ? readInflue : []).filter(f => f && !ours.has(String(f.pId)) && !managed(String(f.pId)) && !dropped.has(String(f.pId)));
  const mine = [...used.entries()].map(([pId, list]) => {
    const z = (v = 0) => Array.from({ length: 30 }, () => v);
    const f = { pId, en: z(false), iT: z(0), iS: z(f2(0)), iMin: z(f2(0)), iMax: z(f2(0)) };
    list.forEach(x => { f.en[x.i] = true; f.iS[x.i] = f2(x.set); f.iMin[x.i] = f2(x.lo); f.iMax[x.i] = f2(x.hi); });
    return f;
  });
  return { time, influe: [...kept, ...mine] };
}

// the influences of CST that the card does not set (a signal it does not offer), as FarmNet holds them: each is sent back
// as it is ("kept") — unless it no longer fits the three periods Save writes: on in a period past P3 ("its periods no
// longer exist"), or laid out for another period order than sunrise / 12:00 / sunset. Those are never sent silently: the
// person drops them on the card (plan.drop) or Save is refused (verifier, 21 Nov 2026)
export function keptInfluences(readCst, managed = () => false, drop = []) {
  if (!linked(readCst)) return [];
  const tps = (Array.isArray(readCst.time) ? readCst.time : []).map(t => Number(t?.tp));
  const sameOrder = tps.length === 3 && tps[0] === 1 && tps[1] === 0 && tps[2] === 2;
  return (Array.isArray(readCst.influe) ? readCst.influe : []).filter(f => f && !managed(String(f.pId))).map(f => {
    const on = (Array.isArray(f.en) ? f.en : []).map((x, i) => (x === true ? i : -1)).filter(i => i >= 0);
    const why = on.some(i => i >= 3) ? 'its periods no longer exist'
      : on.length && !sameOrder ? 'laid out for another order of periods than sunrise, 12:00, sunset' : null;
    const pId = String(f.pId);
    return { pId, name: String(f.pN || pId), why, dropped: (drop || []).includes(pId) };
  });
}

// 4. EN (on / off) per period. The program's on/off as it is now is kept in every period that is not OFF: a program
// switched off stays off (bv 0 everywhere); 100 only where it is on now, or everywhere when the person ticked "Switch the
// program on". Written only when a period is OFF or EN is DIY already; nothing when it would only say "off" to a program
// whose own value is off.
export function enDiy(plan, enLinked) {
  const anyOff = plan.periods.some(p => p.off === null);
  if (!anyOff && !enLinked) return null;
  const now = plan.enNow || [false, false, false];
  const bv = plan.periods.map((p, i) => (p.off === null ? 0 : plan.switchOn || now[i] ? 100 : 0));
  if (!enLinked && bv.every(v => v === 0)) return null;
  return { time: [period(1, plan.p1 * 60, bv[0]), period(0, NOON, bv[1]), period(2, plan.p3 * 60, bv[2])], influe: [] };
}

// ── the whole Save, built and checked before the first write ─────────────────────────────────────────────────────────
// The same rules as the function's diyBody (fnlink.ts; it checks again): ≤ 30 periods, tp 0/1/2, st 0–86399 or within
// ± OFFSET_MAX of the sun, itm 0–86400, bv within FarmNet's PL…PH and the caps (CST 0–60000 s, EN 0 or 100, a start a
// clock time), ≤ 15 influences on signals FarmNet lists, en / iT 0|1 / numbers / iMin ≤ iMax, never on past the periods.
// EN never 100 in a period while the program is off now, unless the person ticked "Switch the program on".
const SANE = { en: [0, 100], cst: [0, 60000], st: [0, DAY - 1], et: [0, DAY] };
export function checkDiy(role, read, body, sourceIds, { switchOn = false, offNow = false } = {}) {
  const out = [];
  const time = body?.time, inf = body?.influe ?? [];
  if (!Array.isArray(time) || !time.length || time.length > 30) return ['the periods: 1 to 30'];
  if (!Array.isArray(inf) || inf.length > 15) return ['at most 15 influences'];
  const pl = num(read?.param?.PL), ph = num(read?.param?.PH);
  const lo = Math.max(pl ?? SANE[role][0], SANE[role][0]), hi = Math.min(ph ?? SANE[role][1], SANE[role][1]);
  time.forEach((t, i) => {
    const n = `period ${i + 1}`;
    if (![t?.en, t?.of, t?.ifl].every(b => typeof b === 'boolean')) out.push(`${n}: en, of, ifl`);
    if (![0, 1, 2].includes(t?.tp)) { out.push(`${n}: its type`); return; }
    const [a, z] = t.tp === 0 ? [0, DAY - 1] : [-OFFSET_MAX, OFFSET_MAX];
    if (!Number.isInteger(t.st) || t.st < a || t.st > z) out.push(`${n}: its start`);
    if (!Number.isInteger(t.itm) || t.itm < 0 || t.itm > DAY) out.push(`${n}: its transition`);
    const bv = num(t.bv);
    if (bv === null || bv < lo || bv > hi || (role === 'en' && bv !== 0 && bv !== 100)) out.push(`${n}: its value must be ${role === 'en' ? '0 or 100' : `${lo}–${hi}`}`);
    if (role === 'en' && bv === 100 && offNow && !switchOn) out.push(`${n}: the program is off — Save never switches it on`);
  });
  const seen = new Set();
  inf.forEach((f, k) => {
    const n = `influence ${k + 1}`;
    if (!f?.pId || !sourceIds.has(String(f.pId))) out.push(`${n}: its signal is not one of FarmNet's sources`);
    if (seen.has(String(f?.pId))) out.push(`${n}: its signal twice`); seen.add(String(f?.pId));
    const arrs = ['en', 'iT', 'iS', 'iMin', 'iMax'].map(x => f?.[x]);
    if (!arrs.every(Array.isArray) || arrs.some(x => x.length > 30)) { out.push(`${n}: its lists`); return; }
    f.en.forEach((on, i) => {
      if (typeof on !== 'boolean') out.push(`${n}: en`);
      if (on && i >= time.length) out.push(`${n}: on in period ${i + 1}, which does not exist`);
      if (on && (num(f.iMin[i]) ?? 0) > (num(f.iMax[i]) ?? 0)) out.push(`${n}: min above max in period ${i + 1}`);
    });
    if (f.iT.some(x => x !== 0 && x !== 1)) out.push(`${n}: its type`);
    if ([...f.iS, ...f.iMin, ...f.iMax].some(x => num(x) === null)) out.push(`${n}: its numbers`);
  });
  return out;
}

// every step's body, from FarmNet read fresh just before (fresh: { par, st, et, cst, en } as program_param and diy_get
// answer), checked all together: { steps, problems }. Nothing is sent when problems is not empty.
export function prepareSave(plan, sun, fresh, sourceIds, managed = () => false) {
  const problems = [...problemsOf(plan, sun)];
  if (problems.length) return { steps: [], problems };
  const par = fresh.par;
  const srs = srsOf(par);
  if ((Array.isArray(par?.TM) ? par.TM : [])[0]?.ET?.DEN === true)
    problems.push('the window end (start 1 end) follows DIY periods on FarmNet: Naked Heart never changes it (FarmNet stops answering at its DIY) — make it a plain time on FarmNet first');
  const steps = [{ kind: 'program', changes: programChanges({ ...plan, enLinked: linked(fresh.en) }, par, sun) }];
  const a = anchorDiys(plan, sun);
  const offNow = !enNowOf(par, fresh.en).some(Boolean);
  const diy = (role, sr, read, body, what) => {
    if (!body) return;
    checkDiy(role, read, body, sourceIds, { switchOn: plan.switchOn, offNow }).forEach(p => problems.push(`${what}: ${p}`));
    steps.push({ kind: 'diy', role, sr, add: !linked(read), body, what });
  };
  diy('st', srs.st, fresh.st, { time: a.st.time, influe: fresh.st?.influe || [] }, 'start 1');
  keptInfluences(fresh.cst, managed, plan.drop).filter(k => k.why && !k.dropped)
    .forEach(k => problems.push(`the interval: the influence on ${k.name} — ${k.why}: drop it on the card first`));
  diy('cst', srs.cst, fresh.cst, cstDiy(plan, sun, fresh.cst?.influe || [], managed), 'the interval');
  const e = enDiy({ ...plan, enNow: enNowOf(par, fresh.en) }, linked(fresh.en));
  diy('en', srs.en, fresh.en, e ? { ...e, influe: fresh.en?.influe || [] } : null, 'on/off');
  return { steps, problems };
}

// the periods of a DIY in words, for what FarmNet holds now and what it reads back after Save
const TP = { 0: 'at', 1: 'sunrise', 2: 'sunset' };
export function periodsText(d, unit = 's') {
  if (!linked(d)) return 'not DIY';
  const t = Array.isArray(d.time) ? d.time : [];
  if (!t.length) return 'DIY, no period';
  return t.map(x => {
    const tp = Number(x?.tp);
    const when = tp === 0 ? `at ${clock(x.st)}` : `${TP[tp] ?? 'tp ' + tp} ${signed(Math.round(offsetOf(tp, x.st) / 60))} min (st ${x.st})`;
    const v = unit === 'clock' ? clock(x.bv) : unit === 'onoff' ? (num(x.bv) === 0 ? 'off' : 'on') : `${Math.round(num(x.bv) ?? 0)} s`;
    return `${when} → ${v}${x?.en === false ? ' (period off)' : ''}`;
  }).join(' · ') + (d.cal !== undefined ? ` · now ${unit === 'clock' ? clock(d.cal) : d.cal}` : '');
}
