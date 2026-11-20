// FarmNet › Irrigation: one irrigation program in full, opened from its row on the day's clock (owner, 20 Nov 2026:
// "access to the program irrigation plan edit as well, just clicking in the irrigation timeline", then "a real edit
// function with the possibility to switch from timer to cycle and the possibility to create a new program and
// recipe"). Anyone who may read the farm sees it; the farm's Admin and Farm manager change, through program_set:
//   its name · on or off · timer or cycle · its days · its start times (timer) or windows and interval (cycle), each
//   with its run-time adjustment · its water sources, their recipe, their valves and each valve's run time.
// and make a new one (newProgram: program_add — FarmNet makes it, named and switched off, and it opens here).
// Not here (FarmNet's own screen): light, weight and AI starts, the seasonal adjustment, deleting a program.
// FarmNet holds times as seconds after midnight; they are shown and typed as hh:mm. The program is read fresh
// (askNow), never from the copy kept on this computer: a change is built on what FarmNet holds now.
import { el, drawer, toast, busy, confirmDrawer, loading } from '../ui.js';
import { askNow, bad, num, send } from './shell.js';

const DAY = 86400, MAX_RUN_MIN = 240;
const diyV = x => (x && typeof x === 'object' && 'V' in x ? x.V : x);
const hhmm = s => { const n = num(s); if (n === null) return '—'; const m = Math.round(n / 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const secsOf = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null; };
const dur = s => { const n = num(s); if (n === null) return '—'; return n >= 3600 ? `${Math.floor(n / 3600)} h ${Math.round((n % 3600) / 60)} min` : n % 60 ? `${Math.floor(n / 60)} min ${n % 60} s` : `${n / 60} min`; };
const START_MODE = { 0: 'Timer', 1: 'Cycle', 2: 'Light sum', 3: 'Custom', 4: 'Substrate weight', 5: 'AI' };
const DAYS_MODE = [[0, 'Every day'], [1, 'Every few days'], [2, 'Chosen weekdays'], [3, 'Odd dates'], [4, 'Even dates']];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const daysText = d => {
  let t = d.mode === 1 ? `Every ${d.every} days` : d.mode === 2 ? WEEK.filter((_, i) => (d.weekdays >> i) & 1).join(', ') || 'no weekday' : (DAYS_MODE.find(x => x[0] === d.mode) || [, '—'])[1];
  if (d.from) t += ` · from ${d.from}`;
  if (d.to) t += ` to ${d.to}`;
  return t;
};
const opt = (value, text) => { const o = el('option', null, text); o.value = String(value); return o; };
const select = (pairs, value) => { const s = el('select', 'input'); pairs.forEach(([v, t]) => s.append(opt(v, t))); s.value = String(value); return s; };

// FarmNet's list of water sources and the valves and valve groups under each (valve/group/list)
function treeOf(data) {
  return (Array.isArray(data) ? data : []).filter(s => s && Number.isInteger(Number(s.id))).map(s => ({
    sid: Number(s.id), name: String(s.label ?? s.id), ff: s.FF === true,
    valves: (s.children || []).flatMap(g => g?.children || []).filter(v => v && Number.isInteger(Number(v.id))).map(v => ({ id: Number(v.id), name: String(v.label ?? v.id) })),
  }));
}

// a new program: its name, then FarmNet makes it (switched off) and it opens in full
export async function newProgram(ctx, c, recipes, existing, redraw) {
  const d = drawer('New irrigation program', `${c.name} · FarmNet makes it switched off; you set it next`);
  const name = el('input', 'input'); name.maxLength = 40; name.placeholder = 'e.g. Lettuce bay 3';
  const w = el('div', 'field'); w.append(el('label', null, 'Name'), name);
  d.body.append(w, el('div', 'hint', 'It is made with FarmNet\'s own defaults and stays off until you give it valves and times and switch it on.'));
  const go = el('button', 'btn btn-primary', 'Make it');
  go.onclick = async () => {
    const n = name.value.trim();
    if (!n) { toast('Give it a name', 'bad'); name.focus(); return; }
    if ((existing || []).some(p => String(p.NM).trim().toLowerCase() === n.toLowerCase())) { toast(`A program "${n}" exists already`, 'bad'); return; }
    busy(go, true, 'Making it…');
    let res;
    try { res = await send(ctx.farm, 'program_add', { id: c.id }, { name: n }); }
    catch (e) {
      // FarmNet may have made it all the same (the answer lost, or the naming refused): no second one from here
      d.body.append(el('div', 'note bad', `${e.message}. FarmNet may have made the program all the same: look for it on the page (or on FarmNet) and check it is switched off before making another.`));
      busy(go, false, 'Make it'); go.disabled = true; redraw(); return;
    }
    d.close();
    toast(`"${n}" made on FarmNet, switched off`, 'ok');
    const id = Number(res?.created ?? res?.data?.ID);
    if (Number.isInteger(id)) openProgram(ctx, c, { ID: id, NM: n }, recipes, undefined, redraw);
    else redraw();
  };
  d.footer.append(go);
  setTimeout(() => name.focus(), 50);
}

// at: the time pressed on the clock (minutes after midnight), offered for a new start; after: called when the drawer
// closes having changed something (a new program redraws the page even when nothing more was saved)
export async function openProgram(ctx, c, p, recipes, at, after) {
  let dirty = () => false;
  const d = drawer(p.NM || `Program ${p.ID}`, `${c.name} · as FarmNet holds it now`, {
    guard: () => (dirty() ? confirmDrawer('Leave without saving?', 'The values you changed are not sent to FarmNet.', 'Leave') : true),
    onClose: () => { if (after) after(); },
  });
  d.body.append(loading('Reading the program…'));
  let full, tree = null;
  try {
    const [f, t] = await Promise.all([
      askNow(ctx.farm, 'program_param', { id: c.id, proId: p.ID }),
      ctx.may ? askNow(ctx.farm, 'valve_groups', { id: c.id, group: 1 }).catch(() => null) : null,
    ]);
    full = f; tree = t ? treeOf(t) : null;
  } catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  if (!full || typeof full !== 'object' || !Array.isArray(full.TM)) { d.body.append(bad('FarmNet sent no program.')); return; }

  const may = x => ctx.may && (!x || typeof x !== 'object' || x.EEN !== false);
  const mode0 = Number(full.SMD), modeEditable = ctx.may && (mode0 === 0 || mode0 === 1);
  const dt = full.DT && typeof full.DT === 'object' ? full.DT : null;

  // ── what is on screen, kept apart from the fields so the day can be drawn again when the mode changes ──
  const st = {
    name: full.NM || '', on: num(diyV(full.EN)) !== 0, mode: mode0,
    days: dt ? { mode: Number(dt.DMD) || 0, every: num(dt.DID) || 1, weekdays: num(dt.DWD) || 0, from: dt.DSD || '', to: dt.DED || '' } : null,
    cycle: num(diyV(full.CST)),
    slots: full.TM.map((x, i) => ({ i, use: x?.USE === true, st: num(diyV(x?.ST)), et: num(diyV(x?.ET)), ad: num(diyV(x?.AD)) ?? 100, shown: x?.USE === true, lock: x?.ST?.EEN === false })),
    sources: (full.SRC || []).map(s => ({ sid: Number(s.SID), name: s.SNM || `Water source ${s.SID}`, ff: s.FF !== false, fid: Number(s.FID ?? -1),
      valves: (s.VAL || []).map(v => ({ id: Number(v.ID), name: v.NM || `Valve ${v.ID}`, stm: num(diyV(v.STM)), lock: v?.STM?.EEN === false })) })),
  };
  const was = structuredClone(st);
  const runSecs = () => Math.max(60, st.sources.flatMap(s => s.valves).reduce((a, v) => a + (v.stm || 0), 0)) || 120;

  // ── name, on/off ──
  const head = el('div', 'ir-section ir-prog-head');
  if (ctx.may) {
    const nm = el('input', 'input ir-prog-name'); nm.maxLength = 40; nm.value = st.name; nm.oninput = () => { st.name = nm.value; };
    const f = el('div', 'field'); f.append(el('label', null, 'Name'), nm); head.append(f);
  }
  const onRow = el('label', 'ir-prog-on');
  const onBox = el('input'); onBox.type = 'checkbox'; onBox.checked = st.on; onBox.disabled = !may(full.EN);
  onBox.onchange = () => { st.on = onBox.checked; };
  onRow.append(onBox, el('b', null, 'Program on'), el('span', 'hint', st.on ? 'FarmNet runs it on its days' : 'FarmNet does not run it now'));
  head.append(onRow);
  d.body.append(head);

  // ── how it starts, its days ──
  const how = el('div', 'ir-section');
  const row = (label, ...right) => { const r = el('div', 'fc-param'); r.append(el('span', null, label), ...right); how.append(r); return r; };
  if (modeEditable) {
    const m = select([[0, 'Timer: at set times'], [1, 'Cycle: repeats within windows']], st.mode);
    m.classList.add('ir-prog-mode');
    m.onchange = () => {
      st.mode = Number(m.value);
      // a timer start becomes a window of an hour; a window becomes a start at its beginning
      st.slots.forEach(s => { if (s.use && s.st !== null) s.et = st.mode === 1 ? (s.st + 3600) % DAY : (s.st + runSecs()) % DAY; });
      if (st.mode === 1 && !(st.cycle >= 60)) st.cycle = 3600;
      drawDay();
    };
    row('Starts by', m, el('span'));
  } else row('Starts by', el('b', null, START_MODE[mode0] ?? `mode ${full.SMD}`), el('span'));
  if (st.days) {
    const dd = st.days;
    if (ctx.may) {
      const box = el('div', 'ir-prog-days');
      const ms = select(DAYS_MODE, dd.mode);
      const every = el('input', 'input ir-prog-pct'); every.type = 'number'; every.min = '1'; every.max = '365'; every.value = String(dd.every);
      const wk = el('span', 'ir-prog-week');
      WEEK.forEach((w, i) => {
        const l = el('label'); const c2 = el('input'); c2.type = 'checkbox'; c2.checked = !!((dd.weekdays >> i) & 1);
        c2.onchange = () => { dd.weekdays = c2.checked ? dd.weekdays | (1 << i) : dd.weekdays & ~(1 << i); };
        l.append(c2, document.createTextNode(w)); wk.append(l);
      });
      const from = el('input', 'input'); from.type = 'date'; from.value = dd.from;
      const to = el('input', 'input'); to.type = 'date'; to.value = dd.to;
      const show = () => { every.parentElement.hidden = dd.mode !== 1; wk.hidden = dd.mode !== 2; };
      ms.onchange = () => { dd.mode = Number(ms.value); show(); };
      every.oninput = () => { dd.every = Number(every.value); };
      from.oninput = () => { dd.from = from.value; };
      to.oninput = () => { dd.to = to.value; };
      const ev = el('span', 'ir-prog-inline'); ev.append(document.createTextNode('every'), every, document.createTextNode('days'));
      const range = el('span', 'ir-prog-inline'); range.append(document.createTextNode('from'), from, document.createTextNode('until'), to);
      box.append(ms, ev, wk, range);
      const r = el('div', 'ir-prog-daysrow'); r.append(el('span', null, 'Days'), box);
      how.append(r);
      show();
    } else row('Days', el('b', null, daysText(dd)), el('span'));
  }
  d.body.append(how);

  // ── the day: starts or windows on a 24-hour bar, one row each, the interval ──
  const day = el('div', 'ir-section');
  d.body.append(day);
  function drawDay() {
    const cycling = st.mode === 1, timed = st.mode === 0 || st.mode === 1;
    day.replaceChildren(el('div', 'cx-kind-label', cycling ? 'Cycling windows' : timed ? 'Start times' : 'Starts'));
    const bar = el('div', 'ir-track ir-prog-bar');
    day.append(bar);
    const paint = () => {
      const pct = s => `${(Math.max(0, Math.min(DAY, s)) / DAY) * 100}%`;
      const parts = [];
      for (let h = 0; h <= 24; h += 6) { const t = el('span', 'ir-hour' + (h === 24 ? ' is-end' : ''), String(h).padStart(2, '0')); t.style.left = pct(h * 3600); parts.push(t); }
      st.slots.forEach(s => {
        if (!s.use || !s.shown || s.st === null) return;
        const piece = (x, y, cls) => { const b = el('div', cls); b.style.left = pct(x); b.style.width = `max(4px, calc(${pct(y)} - ${pct(x)}))`; b.title = `${hhmm(s.st)}${cycling ? '–' + hhmm(s.et) : ''}`; parts.push(b); };
        if (cycling) { const b = s.et ?? s.st; if (b > s.st) piece(s.st, b, 'ir-window'); else { piece(s.st, DAY, 'ir-window'); if (b > 0) piece(0, b, 'ir-window'); } }
        else piece(s.st, s.st + runSecs(), 'ir-plan');
      });
      bar.replaceChildren(...parts);
    };
    if (!timed) { day.append(el('div', 'hint', 'This program starts on its own condition (light, weight, AI): its times are changed on FarmNet.')); paint(); return; }
    const list = el('div', 'ir-prog-slots');
    st.slots.forEach(s => {
      if (!s.shown) return;
      const r = el('div', 'fc-param ir-prog-slot');
      const use = el('input'); use.type = 'checkbox'; use.checked = s.use; use.title = 'In use';
      const a = el('input', 'input'); a.type = 'time'; a.step = '60'; a.value = s.st === null ? '' : hhmm(s.st);
      const b = el('input', 'input'); b.type = 'time'; b.step = '60'; b.value = s.et === null ? '' : hhmm(s.et);
      const ad = el('input', 'input ir-prog-pct'); ad.type = 'number'; ad.min = '0'; ad.max = '200'; ad.step = '1'; ad.value = String(s.ad);
      const editable = ctx.may && !s.lock;
      [use, a, b, ad].forEach(x => { x.disabled = !editable; });
      // an hh:mm equal to what FarmNet's seconds show keeps those seconds
      const keep = (v, old) => (old !== null && hhmm(old) === v ? old : secsOf(v));
      use.onchange = () => { s.use = use.checked; paint(); };
      a.oninput = () => { if (a.value) { s.st = keep(a.value, was.slots[s.i].st); paint(); } };
      b.oninput = () => { if (b.value) { s.et = keep(b.value, was.slots[s.i].et); paint(); } };
      ad.oninput = () => { s.ad = ad.value.trim() === '' ? was.slots[s.i].ad : Number(ad.value); };
      const left = el('span', 'ir-prog-slot-l'); left.append(use, el('span', 'hint', `${s.i + 1}`));
      const times = el('span', 'ir-prog-times'); times.append(a);
      if (cycling) times.append(el('span', 'hint', 'to'), b);
      const right = el('span', 'ir-prog-slot-r'); right.append(ad, el('span', 'hint', '% run'));
      r.append(left, times, right);
      list.append(r);
    });
    day.append(list);
    if (ctx.may) {
      const when = at !== undefined && at !== null ? Math.round(at / 5) * 5 * 60 % DAY : null;
      const add = el('button', 'btn btn-sm', `＋ Add a ${cycling ? 'window' : 'start'}${when !== null ? ' at ' + hhmm(when) : ''}`);
      add.type = 'button';
      add.disabled = !st.slots.some(s => !s.shown && !s.lock);
      add.onclick = () => {
        const s = st.slots.find(x => !x.shown && !x.lock);
        if (!s) { toast('All ten of FarmNet\'s slots are in use'); return; }
        const t = when ?? 12 * 3600;
        Object.assign(s, { shown: true, use: true, st: t, et: cycling ? (t + 3600) % DAY : (t + runSecs()) % DAY, ad: 100 });
        at = null;
        drawDay();
      };
      day.append(add);
    }
    if (cycling) {
      const r = el('div', 'fc-param');
      const inp = el('input', 'input'); inp.type = 'number'; inp.min = '1'; inp.step = '1';
      inp.value = st.cycle === null ? '' : String(Math.round(st.cycle / 60));
      inp.disabled = !may(full.CST);
      inp.oninput = () => { st.cycle = inp.value.trim() === '' ? was.cycle : (Math.round(Number(inp.value)) === Math.round((was.cycle ?? -60) / 60) ? was.cycle : Math.round(Number(inp.value) * 60)); };
      r.append(el('span', null, 'Starts again every'), inp, el('span', 'hint', 'min'));
      day.append(r);
    }
    paint();
  }
  drawDay();

  // ── water sources, their recipe, their valves ──
  const water = el('div', 'ir-section');
  d.body.append(water);
  const recipeName = id => (Number(id) === -1 ? 'no recipe' : (recipes || []).find(r => Number(r.ID) === Number(id))?.NM || `recipe #${id}`);
  function drawWater() {
    water.replaceChildren(el('div', 'cx-kind-label', 'Water and valves'));
    if (!st.sources.length) water.append(el('div', 'hint', 'No water source yet: add one, then its valves.'));
    st.sources.forEach((src, si) => {
      const head2 = el('div', 'fc-param ir-prog-src');
      const nm = el('b', null, src.name);
      if (src.ff) {
        const sel = select([[-1, 'No recipe'], ...(recipes || []).map(r => [r.ID, r.NM || `Recipe ${r.ID}`])], src.fid);
        if (![...sel.options].some(o => Number(o.value) === src.fid)) { sel.append(opt(src.fid, `Recipe #${src.fid}`)); sel.value = String(src.fid); }
        sel.disabled = !ctx.may; sel.onchange = () => { src.fid = Number(sel.value); };
        head2.append(nm, sel);
      } else head2.append(nm, el('span', 'hint', 'clear water'));
      if (ctx.may && tree) {
        const x = el('button', 'btn btn-sm btn-ghost', '✕'); x.type = 'button'; x.title = `Stop using ${src.name}`;
        x.onclick = () => { st.sources.splice(si, 1); drawWater(); paintDay(); };
        head2.append(x);
      } else head2.append(el('span'));
      water.append(head2);
      src.valves.forEach((v, vi) => {
        const r = el('div', 'fc-param ir-prog-valve');
        const inp = el('input', 'input'); inp.type = 'number'; inp.min = '0'; inp.max = String(MAX_RUN_MIN); inp.step = '0.5';
        const shown = v.stm === null ? '' : String(Math.round(v.stm / 6) / 10);
        inp.value = shown; inp.disabled = !ctx.may || v.lock;
        const old = was.sources.find(s => s.sid === src.sid)?.valves.find(y => y.id === v.id)?.stm ?? null;
        // a minute value equal to what FarmNet's seconds show keeps those seconds
        inp.oninput = () => { v.stm = inp.value.trim() === '' ? old : old !== null && inp.value === String(Math.round(old / 6) / 10) ? old : Math.round(Number(inp.value) * 60); paintDay(); };
        const lab = el('span', 'ir-prog-inline'); lab.append(el('span', null, v.name));
        const right = el('span', 'ir-prog-inline'); right.append(el('span', 'hint', 'min run'));
        if (ctx.may && tree) {
          const x = el('button', 'btn btn-sm btn-ghost', '✕'); x.type = 'button'; x.title = `Stop using ${v.name}`;
          x.onclick = () => { src.valves.splice(vi, 1); drawWater(); paintDay(); };
          right.append(x);
        }
        r.append(lab, inp, right);
        water.append(r);
      });
      // a valve FarmNet lists under this source and the program does not use yet
      const t = tree?.find(x => x.sid === src.sid);
      const free = t ? t.valves.filter(v => !st.sources.some(s => s.valves.some(y => y.id === v.id))) : [];
      if (ctx.may && free.length) {
        const sel = select([['', `＋ Add a valve from ${src.name}…`], ...free.map(v => [v.id, v.name])], '');
        sel.className = 'input ir-prog-add';
        sel.onchange = () => { const v = free.find(y => y.id === Number(sel.value)); if (v) { src.valves.push({ id: v.id, name: v.name, stm: 120, lock: false }); drawWater(); paintDay(); } };
        water.append(sel);
      }
    });
    if (ctx.may && tree) {
      const freeSrc = tree.filter(s => !st.sources.some(x => x.sid === s.sid));
      if (freeSrc.length) {
        const sel = select([['', '＋ Add a water source…'], ...freeSrc.map(s => [s.sid, s.name])], '');
        sel.className = 'input ir-prog-add';
        sel.onchange = () => { const s = freeSrc.find(y => y.sid === Number(sel.value)); if (s) { st.sources.push({ sid: s.sid, name: s.name, ff: s.ff, fid: -1, valves: [] }); drawWater(); } };
        water.append(sel);
      }
    }
    if (ctx.may && !tree) water.append(el('div', 'hint', 'FarmNet did not list its valves just now: run times and recipes can be changed, valves not added.'));
  }
  const paintDay = () => { if (st.mode === 0) drawDay(); };   // a timer start's bar is as long as the valves' run
  drawWater();

  if (!ctx.may) { d.body.append(el('div', 'hint', 'Only the farm admin and farm manager change a program.')); return; }

  // ── what changed, in words, and as the function takes it ──
  const sameSlot = (a, b) => a.use === b.use && a.st === b.st && a.et === b.et && a.ad === b.ad;
  const structure = s => JSON.stringify(s.sources.map(x => [x.sid, x.valves.map(v => v.id)]));
  function diff() {
    const words = [], body = {};
    const nm = st.name.trim();
    if (nm !== (was.name || '').trim()) { body.name = nm; words.push(`Name: ${was.name} → ${nm}`); }
    if (st.on !== was.on) { body.on = st.on; words.push(`Program: ${was.on ? 'on' : 'off'} → ${st.on ? 'on' : 'off'}`); }
    if (st.mode !== was.mode) { body.mode = st.mode; words.push(`Starts by: ${START_MODE[was.mode]} → ${START_MODE[st.mode]}`); }
    if (st.days && JSON.stringify(st.days) !== JSON.stringify(was.days)) {
      const dd = st.days;
      body.days = { mode: dd.mode, ...(dd.mode === 1 ? { every: dd.every } : {}), ...(dd.mode === 2 ? { weekdays: dd.weekdays } : {}), ...(dd.from ? { from: dd.from } : {}), to: dd.to || '' };
      words.push(`Days: ${daysText(was.days)} → ${daysText(dd)}`);
    }
    const cyc = st.mode === 1, modeChanged = st.mode !== was.mode;
    st.slots.forEach((s, i) => {
      const o = was.slots[i];
      if (sameSlot(s, o) && !(modeChanged && s.use)) return;
      const x = { i };
      const n = `${cyc ? 'Window' : 'Start'} ${i + 1}`;
      if (s.use !== o.use) { x.use = s.use; words.push(`${n}: ${s.use ? 'in use' : 'not in use'}`); }
      if (s.use && (s.st !== o.st || modeChanged)) { x.st = s.st; if (s.st !== o.st) words.push(`${n} ${cyc ? 'from' : 'at'}: ${o.use ? hhmm(o.st) : '—'} → ${hhmm(s.st)}`); }
      if (cyc && s.use && (s.et !== o.et || modeChanged)) { x.et = s.et; words.push(`${n} until: ${o.use && was.mode === 1 ? hhmm(o.et) : '—'} → ${hhmm(s.et)}`); }
      if (s.ad !== o.ad) { x.ad = s.ad; words.push(`${n} run: ${o.ad} % → ${s.ad} %`); }
      if (Object.keys(x).length > 1) (body.starts ||= []).push(x);
    });
    if (cyc && st.cycle !== was.cycle) { body.cycle = st.cycle; words.push(`Starts again every: ${dur(was.cycle)} → ${dur(st.cycle)}`); }
    // water: the whole list when something was added or taken away (the function then checks it against FarmNet's
    // list of valves); else only the run times and recipes that changed
    const waterSame = JSON.stringify(st.sources) === JSON.stringify(was.sources);
    if (!waterSame) {
      if (tree && structure(st) !== structure(was) || tree && st.sources.some((s, i) => s.fid !== was.sources[i]?.fid)) {
        body.sources = st.sources.map(s => ({ sid: s.sid, ...(s.ff ? { fid: s.fid } : {}), valves: s.valves.map(v => ({ id: v.id, stm: v.stm })) }));
      } else {
        st.sources.forEach(s => {
          const o = was.sources.find(x => x.sid === s.sid);
          if (s.ff && o && s.fid !== o.fid) (body.recipes ||= []).push({ sid: s.sid, fid: s.fid });
          s.valves.forEach(v => { const ov = o?.valves.find(y => y.id === v.id); if (ov && v.stm !== ov.stm) (body.valves ||= []).push({ sid: s.sid, id: v.id, stm: v.stm }); });
        });
      }
      st.sources.forEach(s => {
        const o = was.sources.find(x => x.sid === s.sid);
        if (!o) words.push(`Water source ${s.name}: added${s.ff ? ', ' + recipeName(s.fid) : ''}`);
        else if (s.ff && s.fid !== o.fid) words.push(`${s.name} recipe: ${recipeName(o.fid)} → ${recipeName(s.fid)}`);
        s.valves.forEach(v => { const ov = o?.valves.find(y => y.id === v.id); if (!ov) words.push(`${v.name}: added, ${dur(v.stm)}`); else if (v.stm !== ov.stm) words.push(`${v.name} run: ${dur(ov.stm)} → ${dur(v.stm)}`); });
        (o?.valves || []).filter(ov => !s.valves.some(v => v.id === ov.id)).forEach(ov => words.push(`${ov.name}: taken away`));
      });
      was.sources.filter(o => !st.sources.some(s => s.sid === o.sid)).forEach(o => words.push(`Water source ${o.name}: taken away`));
    }
    return { words, body };
  }
  dirty = () => Object.keys(diff().body).length > 0;

  const save = el('button', 'btn btn-primary', 'Save…');
  save.onclick = async () => {
    if (save.disabled) return;
    const { words, body } = diff();
    if (!Object.keys(body).length) { toast('Nothing changed'); return; }
    // what the function would refuse, said here first
    if (body.name !== undefined && !body.name) { toast('The name is empty', 'bad'); return; }
    const used = st.slots.filter(s => s.use);
    if (used.some(s => s.st === null || (st.mode === 1 && s.et === null))) { toast('A start or window in use has no time', 'bad'); return; }
    if (st.mode === 1 && !(st.cycle >= 60)) { toast('Starts again every: at least 1 min', 'bad'); return; }
    if (st.mode === 1 && used.some(s => s.st === s.et)) { toast('A window must end at another time than it starts', 'bad'); return; }
    const runs = st.sources.flatMap(s => s.valves);
    if (runs.some(v => !Number.isFinite(v.stm) || v.stm < 0 || v.stm > MAX_RUN_MIN * 60)) { toast(`A valve run must be between 0 and ${MAX_RUN_MIN} min`, 'bad'); return; }
    if (st.slots.some(s => !Number.isFinite(s.ad) || s.ad < 0 || s.ad > 200)) { toast('A run adjustment must be between 0 and 200 %', 'bad'); return; }
    if (st.on && !runs.length) { toast('A program with no valve cannot be on: add a valve, or switch it off', 'bad'); return; }
    if (st.days?.mode === 2 && !st.days.weekdays) { toast('Choose at least one weekday', 'bad'); return; }
    if (st.days?.to && st.days.from && st.days.to < st.days.from) { toast('The last day is before the first', 'bad'); return; }
    save.disabled = true;
    const ok = await confirmDrawer(`Change "${was.name || p.NM}" on FarmNet?`,
      `${words.join(' · ')}. FarmNet runs the program this way from its next start.`, 'Change it');
    if (!ok) { save.disabled = false; return; }
    busy(save, true, 'Sending…');
    try {
      const res = await send(ctx.farm, 'program_set', { id: c.id, proId: p.ID }, body);
      toast(`"${st.name || p.NM}" changed — FarmNet: ${res?.msg || 'OK'}`, 'ok');
    } catch (e) { toast(e.message, 'bad'); busy(save, false, 'Save…'); return; }
    dirty = () => false;
    d.close();
    if (!after) setTimeout(ctx.redraw, 1200);
  };
  d.footer.append(save);
}
