// FarmNet › Irrigation: one irrigation program in full, opened from its row on the day's clock (owner, 20 Nov 2026:
// "access to the program irrigation plan edit as well, just clicking in the irrigation timeline"). Anyone who may
// read the farm sees it; the farm's Admin and Farm manager change, through the function's program_set:
//   on or off · its start times (a timer program) or its cycling windows and interval (a cycling one) · each start's
//   run-time adjustment · each valve's run time · the recipe its water source mixes.
// Not here (FarmNet's own screen): the start mode, the days, which valves, the radiation and AI settings.
// FarmNet holds times as seconds after midnight; they are shown and typed as hh:mm. The program is read fresh
// (askNow), never from the copy kept on this computer: a change is built on what FarmNet holds now.
import { el, drawer, toast, busy, confirmDrawer, loading } from '../ui.js';
import { askNow, bad, num, send } from './shell.js';

const DAY = 86400;
const diyV = x => (x && typeof x === 'object' && 'V' in x ? x.V : x);
const hhmm = s => { const n = num(s); if (n === null) return '—'; const m = Math.round(n / 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const secsOf = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null; };
const dur = s => { const n = num(s); if (n === null) return '—'; return n >= 3600 ? `${Math.floor(n / 3600)} h ${Math.round((n % 3600) / 60)} min` : n % 60 ? `${Math.floor(n / 60)} min ${n % 60} s` : `${n / 60} min`; };
const DAYS_MODE = { 0: 'Every day', 1: 'Every few days', 2: 'Chosen weekdays', 3: 'Odd dates', 4: 'Even dates' };
const START_MODE = { 0: 'Timer', 1: 'Cycle', 2: 'Light sum', 3: 'Custom', 4: 'Substrate weight', 5: 'AI' };
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const daysText = dt => {
  if (!dt || typeof dt !== 'object') return '—';
  const m = Number(dt.DMD);
  let t = m === 1 ? `Every ${num(dt.DID) ?? '?'} days` : m === 2 ? WEEK.filter((_, i) => (Number(dt.DWD) >> i) & 1).join(', ') || 'no weekday' : DAYS_MODE[m] ?? '—';
  if (dt.DSD) t += ` · from ${dt.DSD}`;
  if (dt.DED) t += ` to ${dt.DED}`;
  return t;
};

// at: the time pressed on the clock (minutes after midnight), offered for a new start
export async function openProgram(ctx, c, p, recipes, at) {
  let dirty = () => false;
  const d = drawer(p.NM || `Program ${p.ID}`, `${c.name} · as FarmNet holds it now`, {
    guard: () => (dirty() ? confirmDrawer('Leave without saving?', 'The values you changed are not sent to FarmNet.', 'Leave') : true),
  });
  d.body.append(loading('Reading the program…'));
  let full;
  try { full = await askNow(ctx.farm, 'program_param', { id: c.id, proId: p.ID }); }
  catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  if (!full || typeof full !== 'object' || !Array.isArray(full.TM)) { d.body.append(bad('FarmNet sent no program.')); return; }

  const mode = Number(full.SMD), cycling = mode === 1, timed = mode === 0 || cycling;
  const may = x => ctx.may && (!x || typeof x !== 'object' || x.EEN !== false);
  const edits = [];   // { label, from, read, show, kind, ... } — read() gives the value to send, or the one read

  // ── what kind of program ──
  const facts = el('div', 'ir-section');
  const fact = (k, v) => { const r = el('div', 'fc-param'); r.append(el('span', null, k), el('b', null, v ?? '—'), el('span')); facts.append(r); };
  fact('Starts by', START_MODE[mode] ?? `mode ${full.SMD}`);
  fact('Days', daysText(full.DT));
  if (cycling && (num(diyV(full.MINT)) || num(diyV(full.MAXT)))) fact('Interval at least · at most', `${dur(diyV(full.MINT))} · ${dur(diyV(full.MAXT))}`);
  d.body.append(facts);

  // ── on or off ──
  const onRow = el('label', 'ir-prog-on');
  const on0 = num(diyV(full.EN)) !== 0;
  const onBox = el('input'); onBox.type = 'checkbox'; onBox.checked = on0; onBox.disabled = !may(full.EN);
  onRow.append(onBox, el('b', null, 'Program on'), el('span', 'hint', on0 ? 'FarmNet runs it on its days' : 'FarmNet does not run it now'));
  d.body.prepend(onRow);
  edits.push({ kind: 'on', label: 'Program', from: on0, read: () => onBox.checked, show: v => (v ? 'on' : 'off') });

  // ── the day: the starts (or windows) drawn on a 24-hour bar, then one row each ──
  const day = el('div', 'ir-section');
  day.append(el('div', 'cx-kind-label', cycling ? 'Cycling windows' : 'Start times'));
  const bar = el('div', 'ir-track ir-prog-bar');
  day.append(bar);
  const list = el('div', 'ir-prog-slots');
  day.append(list);
  if (!timed) day.append(el('div', 'hint', 'This program starts on its own condition (light, weight, AI): its times are changed on FarmNet.'));
  const runSecs = (() => {   // a timer start's run, for the bar: FarmNet's end minus start
    const s = full.TM.find(x => x?.USE);
    const a = num(diyV(s?.ST)), b = num(diyV(s?.ET));
    return a !== null && b !== null ? ((b - a) % DAY + DAY) % DAY : 120;
  })();
  const slots = full.TM.map((x, i) => {
    const st0 = num(diyV(x?.ST)), et0 = num(diyV(x?.ET)), ad0 = num(diyV(x?.AD)) ?? 100, use0 = x?.USE === true;
    const row = el('div', 'fc-param ir-prog-slot');
    const use = el('input'); use.type = 'checkbox'; use.checked = use0; use.title = 'In use';
    const st = el('input', 'input'); st.type = 'time'; st.step = '60'; st.defaultValue = st0 === null ? '' : hhmm(st0);
    const et = el('input', 'input'); et.type = 'time'; et.step = '60'; et.defaultValue = et0 === null ? '' : hhmm(et0);
    const ad = el('input', 'input ir-prog-pct'); ad.type = 'number'; ad.min = '0'; ad.max = String(Math.min(num(x?.AD?.H) ?? 200, 200)); ad.step = '1'; ad.value = String(ad0);
    const editable = timed && ctx.may && may(x?.ST);
    [use, st, et, ad].forEach(inp => { inp.disabled = !editable; inp.oninput = paint; });
    const left = el('span', 'ir-prog-slot-l'); left.append(use, el('span', 'hint', `${i + 1}`));
    const times = el('span', 'ir-prog-times'); times.append(st);
    if (cycling) times.append(el('span', 'hint', 'to'), et);
    const right = el('span', 'ir-prog-slot-r'); right.append(ad, el('span', 'hint', '% run'));
    row.append(left, times, right);
    const s = {
      i, row, use0, st0, et0, ad0,
      use: () => use.checked,
      // an untouched (or emptied) hh:mm keeps FarmNet's own seconds
      st: () => (!st.value || st.value === st.defaultValue ? st0 : secsOf(st.value)),
      et: () => (!et.value || et.value === et.defaultValue ? et0 : secsOf(et.value)),
      ad: () => (ad.value.trim() === '' ? ad0 : Number(ad.value)),
      setUse: v => { use.checked = v; }, setSt: v => { st.value = hhmm(v); }, setEt: v => { et.value = hhmm(v); },
      setAd: v => { ad.value = String(v); },
    };
    row.hidden = !use0;   // the slots not in use wait behind "Add a start"
    list.append(row);
    return s;
  });
  if (timed && ctx.may) {
    const add = el('button', 'btn btn-sm', '');
    const when = at !== undefined && at !== null ? Math.round(at / 5) * 5 * 60 : null;
    add.textContent = when !== null ? `＋ Add a ${cycling ? 'window' : 'start'} at ${hhmm(when)}` : `＋ Add a ${cycling ? 'window' : 'start'}`;
    add.type = 'button';
    add.onclick = () => {
      const s = slots.find(x => x.row.hidden);
      if (!s) { toast('All ten of FarmNet\'s slots are in use'); return; }
      s.row.hidden = false; s.setUse(true); s.setAd(100);   // a new start runs in full, whatever the spare slot held
      const t = when ?? 12 * 3600;
      s.setSt(t);
      if (cycling) s.setEt((t + 3600) % DAY);
      add.textContent = `＋ Add a ${cycling ? 'window' : 'start'}`;
      paint();
      s.row.querySelector('input[type=time]')?.focus();
    };
    day.append(add);
    if (!slots.some(s => s.row.hidden)) add.disabled = true;
  }
  slots.forEach(s => {
    edits.push({ kind: 'use', i: s.i, label: `${cycling ? 'Window' : 'Start'} ${s.i + 1}`, from: s.use0, read: s.use, show: v => (v ? 'in use' : 'not in use') });
    edits.push({ kind: 'st', i: s.i, label: `${cycling ? 'Window' : 'Start'} ${s.i + 1} ${cycling ? 'from' : 'at'}`, from: s.st0, read: s.st, show: hhmm });
    if (cycling) edits.push({ kind: 'et', i: s.i, label: `Window ${s.i + 1} until`, from: s.et0, read: s.et, show: hhmm });
    edits.push({ kind: 'ad', i: s.i, label: `${cycling ? 'Window' : 'Start'} ${s.i + 1} run`, from: s.ad0, read: s.ad, show: v => `${v} %` });
  });
  d.body.append(day);

  // ── a cycling program's interval ──
  if (cycling) {
    const r = el('div', 'fc-param');
    const cst0 = num(diyV(full.CST));
    const inp = el('input', 'input'); inp.type = 'number'; inp.min = '1'; inp.step = '1'; inp.defaultValue = cst0 === null ? '' : String(Math.round(cst0 / 60));
    inp.disabled = !may(full.CST); inp.oninput = paint;
    r.append(el('span', null, 'Starts again every'), inp, el('span', 'hint', 'min'));
    day.append(r);
    // untouched (or emptied): FarmNet's own seconds, not the minutes shown times 60
    edits.push({ kind: 'cycle', label: 'Starts again every', from: cst0,
      read: () => (inp.value.trim() === '' || inp.value === inp.defaultValue ? cst0 : Math.round(Number(inp.value) * 60)), show: dur });
  }

  // ── where the water comes from: the recipe it mixes, each valve's run ──
  const water = el('div', 'ir-section');
  water.append(el('div', 'cx-kind-label', 'Water and valves'));
  (full.SRC || []).forEach(src => {
    const head = el('div', 'fc-param');
    head.append(el('b', null, src.SNM || `Water source ${src.SID}`));
    if (src.FF !== false) {
      const sel = el('select', 'input');
      const none = el('option', null, 'No recipe'); none.value = '-1'; sel.append(none);
      (recipes || []).forEach(r => { const o = el('option', null, r.NM || `Recipe ${r.ID}`); o.value = String(r.ID); sel.append(o); });
      if (![...sel.options].some(o => Number(o.value) === Number(src.FID))) { const o = el('option', null, `Recipe #${src.FID}`); o.value = String(src.FID); sel.append(o); }
      sel.value = String(src.FID ?? -1); sel.disabled = !ctx.may; sel.onchange = paint;
      head.append(sel, el('span', 'hint', 'recipe'));
      const name = id => (Number(id) === -1 ? 'no recipe' : (recipes || []).find(r => Number(r.ID) === Number(id))?.NM || `recipe #${id}`);
      edits.push({ kind: 'recipe', sid: src.SID, label: `${src.SNM || 'Water'} recipe`, from: Number(src.FID ?? -1), read: () => Number(sel.value), show: name });
    } else head.append(el('span', 'hint', 'no recipe (clear water)'), el('span'));
    water.append(head);
    (src.VAL || []).forEach(v => {
      const r = el('div', 'fc-param');
      const stm0 = num(diyV(v.STM));
      const inp = el('input', 'input'); inp.type = 'number'; inp.min = '0'; inp.max = '240'; inp.step = '0.5';
      inp.defaultValue = stm0 === null ? '' : String(Math.round(stm0 / 6) / 10);
      inp.disabled = !may(v.STM); inp.oninput = paint;
      r.append(el('span', null, v.NM || `Valve ${v.ID}`), inp, el('span', 'hint', 'min run'));
      water.append(r);
      edits.push({ kind: 'valve', sid: src.SID, id: v.ID, label: `${v.NM || 'Valve ' + v.ID} run`, from: stm0,
        read: () => (inp.value.trim() === '' || inp.value === inp.defaultValue ? stm0 : Math.round(Number(inp.value) * 60)),   // untouched: FarmNet's own seconds
        show: dur });
    });
  });
  d.body.append(water);

  // the bar: what the starts and windows will be, as typed
  function paint() {
    const pct = s => `${(Math.max(0, Math.min(DAY, s)) / DAY) * 100}%`;
    const parts = [];
    for (let h = 0; h <= 24; h += 6) { const t = el('span', 'ir-hour' + (h === 24 ? ' is-end' : ''), String(h).padStart(2, '0')); t.style.left = pct(h * 3600); parts.push(t); }
    slots.forEach(s => {
      if (!s.use() || s.row.hidden) return;
      const a = s.st(); if (a === null) return;
      const piece = (x, y, cls) => { const b = el('div', cls); b.style.left = pct(x); b.style.width = `max(4px, calc(${pct(y)} - ${pct(x)}))`; b.title = `${hhmm(a)}${cycling ? '–' + hhmm(s.et()) : ''}`; parts.push(b); };
      if (cycling) { const b = s.et() ?? a; if (b > a) piece(a, b, 'ir-window'); else { piece(a, DAY, 'ir-window'); piece(0, b, 'ir-window'); } }
      else piece(a, a + runSecs, 'ir-plan');
    });
    bar.replaceChildren(...parts);
  }
  paint();

  if (!ctx.may) { d.body.append(el('div', 'hint', 'Only the farm admin and farm manager change a program.')); return; }

  const same = (a, b) => (a === null || a === undefined ? b === null || b === undefined : a === b);
  const changes = () => edits.filter(x => !same(x.read(), x.from));
  dirty = () => changes().length > 0;
  const save = el('button', 'btn btn-primary', 'Save…');
  save.onclick = async () => {
    if (save.disabled) return;
    const ch = changes();
    const nan = ch.find(x => x.kind !== 'on' && x.kind !== 'use' && !Number.isFinite(x.read()));
    if (nan) { toast(`${nan.label}: not a number`, 'bad'); return; }
    if (!ch.length) { toast('Nothing changed'); return; }
    const badVal = ch.find(x => (x.kind === 'valve' && (x.read() < 0 || x.read() > 4 * 3600)) || (x.kind === 'cycle' && x.read() < 60) || (x.kind === 'ad' && (x.read() < 0 || x.read() > 200)));
    if (badVal) { toast(`${badVal.label}: ${badVal.kind === 'valve' ? 'between 0 and 240 min' : badVal.kind === 'cycle' ? 'at least 1 min' : 'between 0 and 200 %'}`, 'bad'); return; }
    const said = ch.map(x => `${x.label}: ${x.show(x.from)} → ${x.show(x.read())}`).join(' · ');
    save.disabled = true;
    if (!(await confirmDrawer(`Change "${p.NM}" on FarmNet?`, `${said}. FarmNet runs the program this way from its next start.`, 'Change it'))) { save.disabled = false; return; }
    const body = {};
    const startOf = i => { let s = (body.starts ||= []).find(x => x.i === i); if (!s) { s = { i }; body.starts.push(s); } return s; };
    ch.forEach(x => {
      if (x.kind === 'on') body.on = x.read();
      else if (x.kind === 'use') startOf(x.i).use = x.read();
      else if (x.kind === 'st') startOf(x.i).st = x.read();
      else if (x.kind === 'et') startOf(x.i).et = x.read();
      else if (x.kind === 'ad') startOf(x.i).ad = x.read();
      else if (x.kind === 'cycle') body.cycle = x.read();
      else if (x.kind === 'valve') (body.valves ||= []).push({ sid: x.sid, id: x.id, stm: x.read() });
      else if (x.kind === 'recipe') (body.recipes ||= []).push({ sid: x.sid, fid: x.read() });
    });
    busy(save, true, 'Sending…');
    try {
      const res = await send(ctx.farm, 'program_set', { id: c.id, proId: p.ID }, body);
      toast(`"${p.NM}" changed — FarmNet: ${res?.msg || 'OK'}`, 'ok');
    } catch (e) { toast(e.message, 'bad'); busy(save, false, 'Save…'); return; }
    dirty = () => false;
    d.close();
    setTimeout(ctx.redraw, 1200);
  };
  d.footer.append(save);
}
