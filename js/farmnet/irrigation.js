// FarmNet Irrigation (owner, 20 Nov 2026: "a more intuitive irrigation page with visual tanks and with possibility
// to edit recipes for farm managers and admin, clear recipes with visual as well"). For each fertigation centre:
//   Water      the water's way through the centre, left to right: the source tanks (drawn to their level), the
//              disinfection, the mixer (EC and pH against their targets), the day tank, the irrigation valve
//   Today      each program on a 24-hour clock: its planned starts (or its cycling window), what already ran, now;
//              a press on a program's row opens it in full (programs.js), where the Admin and Farm manager change
//              its on/off, start times or cycling windows, valve run times and recipe (the time pressed is offered
//              for a new start)
//   Recipes    one card each, EC and pH on a scale, its channels; a press opens it in full (recipes.js), where
//              the Admin and Farm manager change its EC, pH and channel ratios
//              In use (by an irrigation program, a mixing program, or in a mixer now) and Library; a recipe card
//              may be dragged onto a program's row to make it mix that recipe (irrigation-actions.js assignRecipe)
//              A ✕ on a program's row and on a recipe card (shown under the pointer; always on a touch screen)
//              deletes it — with the same blocks as Delete… in its drawer (owner, 20 Nov 2026)
//   Runs       the run records (today / 2 days / 7 days), folded
//   Deleted    the programs and recipes deleted here, kept by the function (0283), to make again, folded
//   Valves and bays   which zones and positions each valve waters, folded (0288, valves.js); EC and pH per crop, once for
//              the page, folded (0288)
// The commands (start a program, pause, resume, stop) stay in the card's head, as before.
import { el, drawer, field, pref, toast } from '../ui.js';
import { centreButtons } from './overview.js';
import { openRecipe, newRecipe, recipeCard, gauge, EC_SCALE, PH_SCALE } from './recipes.js';
import { openProgram, newProgram } from './programs.js';
import { openSunCycle, newSunCycle } from './suncycle.js';
import { isSunCycle } from './windows-plan.js';
import { quickDelete, assignRecipe, deletedList } from './irrigation-actions.js';
import { valvesSection, rangesSection } from './valves.js';
import { tagCmd } from '../registry.js';
import { DAY_SPANS, ask, bad, card, centres, colour, nowLocal, num, page, range, short, show, soft, spanPicker, table } from './shell.js';

// FarmNet's device types (status/detail "type")
const T = { RAW: 4, DAY: 5, DISINFECTED: 6, NOT_DISINFECTED: 7, ACID: 8 };
const val = (list, n) => (list || []).find(d => d.N === n);
const valT = (list, t) => (list || []).find(d => Number(d.T) === t);
// FarmNet's programs speak its own words; in English they are already English, in Chinese they are translated here
const WORDS = { '每天执行': 'Daily', '定时': 'Timer', '循环': 'Cycle', '辐射累积': 'Light sum', '自定义': 'Custom', '基质重量': 'Substrate weight',
  'AI灌溉': 'AI', '排队等待': 'Queued', '等待重试': 'Waiting to retry', '运行中': 'Running', '等待运行': 'Waiting', 'Execute Daily': 'Daily', None: '—' };
const say = s => { const t = String(s ?? '').trim(); return WORDS[t] ?? t.replace(/^间隔(\d+)天执行$/, 'Every $1 days').replace(/^Interval (\d+) Days?$/i, 'Every $1 days'); };

export async function renderFnIrrigation(mount, farm, _app, quiet) {
  const go = () => renderFnIrrigation(mount, farm, null, true);
  await page(mount, farm, null, async (ctx, body) => {
    const { at, seg } = spanPicker('fbc_fn_irr_span', DAY_SPANS, go);
    const cl = await centres(farm);
    if (!cl.length) { body.append(el('div', 'note', 'FarmNet lists no fertigation centre.')); return; }
    const per = await Promise.all(cl.map(async c => {
      const [programs, manual, formulas, records] = await Promise.all([
        soft(ask(farm, 'irrigation_programs', { id: c.id })),
        soft(ask(farm, 'irrigation_manual', { id: c.id })),
        soft(ask(farm, 'formulas', { id: c.id })),
        soft(ask(farm, 'irrigation_records', { id: c.id, type: 0, ...range(at) })),
      ]);
      const params = await Promise.all((programs.v || []).map(p => soft(ask(farm, 'program_param', { id: c.id, proId: p.ID }))));
      // each mixer's own programs: a recipe a mixing program uses is "in use" too
      const mixProgs = await Promise.all((c.status.v?.fertList || []).map(f => soft(ask(farm, 'fert_programs', { id: c.id, devId: f.id }))));
      return { programs, manual, formulas, records, params, mixProgs };
    }));
    if (!ctx.live()) return;

    cl.forEach((c, i) => {
      const { programs, manual, formulas, records, params, mixProgs } = per[i];
      const s = c.status.v || {};
      const recipes = formulas.v || [];
      // a recipe's colour is its place in FarmNet's list; a program's recipe is the one its water source mixes
      const colourOf = name => { const k = recipes.findIndex(r => r.NM === name); return k < 0 ? 'var(--text-faint)' : colour(k); };
      const recipeOfProgram = id => {
        // the program in full first (its water source's recipe number), else the name FarmNet shows for it
        const par = params[(programs.v || []).findIndex(p => Number(p.ID) === Number(id))]?.v;
        const byId = (Array.isArray(par?.SRC) ? par.SRC : []).map(x => recipes.find(r => Number(r.ID) === Number(x?.FID))?.NM).find(Boolean);
        if (byId) return byId;
        const src = (manual.v || []).find(p => Number(p.ID) === Number(id))?.SRC || [];
        const f = src.map(x => x.FNM).find(n => n && n !== 'None');
        return f || null;
      };
      const valvesOf = id => ((manual.v || []).find(p => Number(p.ID) === Number(id))?.SRC || [])
        .flatMap(x => (x.VALVE || []).map(v => `${v.NM} ${mins(v.STM ?? v.ATM)}`));
      const mixing = new Set((s.fertList || []).flatMap(f => (f.runList || []).map(x => x.FA)).filter(Boolean));
      c.names = { programs: (programs.v || []).map(p => p.NM), recipes: recipes.map(r => r.NM) };   // for Copy…: no two alike
      // who uses a recipe: an irrigation program's water source (its number, from the program in full; else the name
      // FarmNet shows for it), a mixing program (by name: that list carries names)
      const parOf = id => params[(programs.v || []).findIndex(p => Number(p.ID) === Number(id))]?.v || null;
      const usersOf = r => (programs.v || []).filter(p => {
        const par = parOf(p.ID);
        return par && Array.isArray(par.SRC) ? par.SRC.some(x => Number(x?.FID) === Number(r.ID)) : recipeOfProgram(p.ID) === r.NM;
      }).map(p => p.NM);
      const mixUsersOf = r => mixProgs.flatMap(m => (Array.isArray(m.v) ? m.v : []).filter(x => String(x?.FNM ?? '').trim() === String(r.NM).trim()).map(x => `${x.NM} (mixing)`));
      const mixUnknown = mixProgs.some(m => m.e);
      const running = new Set((s.valve?.runList || []).map(x => String(x?.PN ?? '').trim()));

      // ── the card of the centre ──
      const k = card(`${c.name} — irrigation`, ...(ctx.may ? centreButtons(ctx, c) : []));
      if (c.status.e) k.append(bad(c.status.e));
      else k.append(waterPath(farm, s, colourOf, go));

      const th = el('div', 'fc-head fc-subhead');
      th.append(el('h4', 'fc-sub', 'Today'), el('div', 'spacer'),
        el('span', 'hint', ctx.may ? 'Press a program to see it in full and change it.' : 'Press a program to see it in full.'));
      if (ctx.may && !programs.e) {
        const nb = tagCmd(el('button', 'btn btn-sm', '＋ New program'), 'program_add'); nb.type = 'button';
        nb.onclick = () => newProgram(ctx, c, recipes, programs.v || [], ctx.redraw);
        // the new format (owner, 21 Nov 2026): a program run by the sun, set in one simple panel
        const ns = tagCmd(el('button', 'btn btn-sm btn-primary', '☀ New sun-cycle program'), 'program_add'); ns.type = 'button';
        ns.onclick = () => newSunCycle(ctx, c, { recipes, records: records.v?.record || [], programs: programs.v || [], after: ctx.redraw });
        th.append(ns, nb);
      }
      k.append(th);
      if (programs.e) k.append(bad(programs.e));
      else {
        const box = clock(programs.v || [], params, (records.v?.record || []), colourOf, recipeOfProgram, valvesOf,
          (p, at) => (isSunCycle(parOf(p.ID))
            ? openSunCycle(ctx, c, p, { recipes, records: records.v?.record || [], programs: programs.v || [], after: ctx.redraw })
            : openProgram(ctx, c, p, recipes, at, undefined, { records: records.v?.record || [], programs: programs.v || [] })));
        // a sun-cycle program says so on its row
        box.querySelectorAll('.ir-row[data-pid]').forEach(row => {
          if (!isSunCycle(parOf(row.dataset.pid))) return;
          const b = el('span', 'sc-badge', '☀ Sun cycle'); b.title = 'Set in the sun-cycle panel: FarmNet runs it with the sun';
          row.querySelector('.ir-label')?.append(b);
        });
        if (ctx.may) box.querySelectorAll('.ir-row.is-open[data-pid]').forEach(row => {
          const p = (programs.v || []).find(x => String(x.ID) === row.dataset.pid);
          if (!p) return;
          const par = parOf(p.ID);
          // the ✕: the same blocks as Delete… (switched on, running), said before anything is sent
          tagCmd(row, 'program_set', p.ID);   // the row opens the program (Save… there), and takes a dropped recipe
          const x = tagCmd(el('button', 'ir-x', '✕'), 'program_remove', p.ID); x.type = 'button'; x.title = `Delete "${p.NM}"`; x.setAttribute('aria-label', `Delete ${p.NM}`);
          x.onclick = e => { e.stopPropagation(); quickDelete(ctx, c, 'program', p, { on: par ? Number(par.EN?.V) !== 0 : true, running: running.has(String(p.NM).trim()) }); };
          x.onkeydown = e => e.stopPropagation();
          row.querySelector('.ir-label')?.append(x);
          // a recipe dropped on the row
          row.ondragover = e => { if (e.dataTransfer?.types?.includes('text/x-fn-recipe')) { e.preventDefault(); row.classList.add('is-drop'); } };
          row.ondragleave = () => row.classList.remove('is-drop');
          row.ondrop = e => {
            row.classList.remove('is-drop');
            const rid = e.dataTransfer?.getData('text/x-fn-recipe');
            const r = recipes.find(y => String(y.ID) === rid);
            if (!r) return;
            e.preventDefault();
            assignRecipe(ctx, c, p, par, r, recipes);
          };
        });
        k.append(box);
      }

      const rh = el('div', 'fc-head fc-subhead');
      rh.append(el('h4', 'fc-sub', `Recipes · ${recipes.length}`), el('div', 'spacer'),
        el('span', 'hint', ctx.may ? 'Press a recipe to see it in full and change it.' : 'Press a recipe to see it in full.'));
      if (ctx.may && !formulas.e) {
        const nb = tagCmd(el('button', 'btn btn-sm', '＋ New recipe'), 'formula_add'); nb.type = 'button';
        nb.onclick = () => newRecipe(ctx, c, recipes, ctx.redraw);
        rh.append(nb);
      }
      k.append(rh);
      if (formulas.e) k.append(bad(formulas.e));
      else {
        // two groups: in use (an irrigation program, a mixing program, a mixer now) and the library
        const inUse = [], library = [];
        recipes.forEach(r => {
          const used = usersOf(r), mix = mixUsersOf(r), now = mixing.has(r.NM);
          const users = [...used, ...mix, ...(now ? ['a mixer now'] : [])];
          const wrap = el('div', 'ir-card-wrap');
          const cardEl = recipeCard(r, colourOf(r.NM), [...used, ...mix], now, () => openRecipe(ctx, c, r, users));
          wrap.append(cardEl);
          if (ctx.may) {
            tagCmd(cardEl, 'formula_set', r.ID);
            cardEl.draggable = true;
            cardEl.title = `Drag onto a program on the clock to make it mix "${r.NM}"`;
            cardEl.ondragstart = e => { e.dataTransfer.setData('text/x-fn-recipe', String(r.ID)); e.dataTransfer.effectAllowed = 'link'; wrap.classList.add('is-dragging'); };
            cardEl.ondragend = () => wrap.classList.remove('is-dragging');
            const x = tagCmd(el('button', 'ir-x', '✕'), 'formula_remove', r.ID); x.type = 'button'; x.title = `Delete "${r.NM}"`; x.setAttribute('aria-label', `Delete ${r.NM}`);
            x.onclick = e => {
              e.stopPropagation();
              if (mixUnknown && !users.length) { toast('FarmNet did not list the mixing programs just now: open the recipe and use Delete… (FarmNet is checked again)', 'bad'); return; }
              quickDelete(ctx, c, 'recipe', r, { users });
            };
            wrap.append(x);
          }
          (users.length ? inUse : library).push(wrap);
        });
        const group = (title, items, empty) => {
          k.append(el('div', 'cx-kind-label ir-group', `${title} · ${items.length}`));
          const grid = el('div', 'ir-recipes');
          grid.append(...items);
          if (!items.length) grid.append(el('div', 'hint', empty));
          k.append(grid);
        };
        if (!recipes.length) k.append(el('div', 'hint', 'FarmNet holds no recipe.'));
        else {
          group('In use', inUse, 'No program uses a recipe.');
          group('Library', library, 'Every recipe is in use.');
          if (ctx.may) k.append(el('div', 'hint ir-drag-hint', 'Drag a recipe onto a program on the clock to make it mix that recipe.'));
        }
      }

      const recs = records.v?.record || [];
      const vol = recs.reduce((a, r) => a + (num(r.VLM) || 0), 0);
      const runs = el('details', 'ir-runs');
      const sum = el('summary', 'fc-head fc-subhead');
      sum.append(el('h4', 'fc-sub', `Runs · ${recs.length} · ${vol.toFixed(2)} m³`), el('div', 'spacer'), seg);
      seg.onclick = e => e.stopPropagation();   // choosing the span does not fold the list
      runs.append(sum);
      runs.open = pref.get('fbc_fn_irr_runs') === '1';
      runs.ontoggle = () => pref.set('fbc_fn_irr_runs', runs.open ? '1' : '0');
      if (records.e) runs.append(bad(records.e));
      else runs.append(table(['Program', 'Mode', 'Start', 'End', 'Volume m³', 'How it ended'],
        recs.slice().sort((a, b) => String(b.ST).localeCompare(String(a.ST))).slice(0, 200).map(r => [r.NM, say(r.MD), r.ST, r.ET, r.VLM, say(r.SC)]), [4]));
      k.append(runs);
      k.append(deletedList(ctx, c, new Set((programs.v || []).map(p => Number(p.ID))), new Set(recipes.map(r => Number(r.ID)))));
      k.append(valvesSection(ctx, c));   // AI build mode P6 (0288)
      body.append(k);
    });
    body.append(rangesSection(ctx));    // once for the page (0288)
  }, { commands: true, quiet });
}

const mins = s => { const n = num(s); return n === null ? '' : n >= 60 ? `${Math.round(n / 6) / 10} min` : `${n} s`; };

// ═══ The water's way ════════════════════════════════════════════════════════
// FarmNet gives a tank's level (cm) and volume (m³) but not its height, so a tank is drawn against a full mark
// kept on this computer (300 cm until someone sets it): press the tank to set it.
const FULL_DEFAULT = 300;
const fullKey = (farm, t) => `fbc_fn_full_${farm.id}_${t.id}`;
const fullOf = (farm, t) => { const n = num(pref.get(fullKey(farm, t))); return n && n > 0 ? n : FULL_DEFAULT; };

function waterPath(farm, s, colourOf, redraw) {
  const tanks = s.tankList || [];
  const flow = el('div', 'ir-flow');
  const stage = (title, ...items) => {
    const items2 = items.flat().filter(Boolean);
    if (!items2.length) return;
    const st = el('div', 'ir-stage');
    st.append(el('div', 'cx-kind-label', title));
    const row = el('div', 'ir-stage-items'); row.append(...items2);
    st.append(row);
    flow.append(st);
  };
  stage('Water in', tanks.filter(t => t.type === T.RAW).map(t => tankView(farm, t, redraw)));
  stage('Cleaning', (s.disiList || []).map(d => machine(d.name, !!d.run, [
    ['pH', show(val(d.dataList, 'pH')?.V)], ['EC', show(val(d.dataList, 'EC')?.V, 'mS')],
    ['Water', show(val(d.dataList, 'Water Temp')?.V, '℃')], ['UV lamp', uvOf(d.dataList)]])),
    tanks.filter(t => t.type === T.NOT_DISINFECTED || t.type === T.DISINFECTED).map(t => tankView(farm, t, redraw)));
  stage('Mixing', (s.fertList || []).map(f => mixerView(f, colourOf)));
  stage('Day tank', tanks.filter(t => t.type === T.DAY || t.type === T.ACID).map(t => tankView(farm, t, redraw)));
  stage('Other tanks', tanks.filter(t => ![T.RAW, T.DAY, T.ACID, T.DISINFECTED, T.NOT_DISINFECTED].includes(t.type)).map(t => tankView(farm, t, redraw)));
  if (s.valve) stage('To the plants', valveView(s.valve, colourOf));
  return flow;
}

const uvOf = list => { const u = (list || []).find(d => Number(d.T) === 33028 || Number(d.T) === 33029 || /UV/i.test(d.N)); return !u ? '—' : Number(u.V) === -100 ? 'off' : 'on'; };

function tankView(farm, t, redraw) {
  const lv = valT(t.dataList, 52) || val(t.dataList, 'Level'), vol = valT(t.dataList, 33030) || val(t.dataList, 'Water Vol.');
  const tap = (t.dataList || []).find(d => Number(d.T) === -1);
  const level = num(lv?.V), full = fullOf(farm, t);
  const frac = level === null ? null : Math.max(0, Math.min(1, level / full));
  const b = el('button', 'ir-tank' + (level === null ? ' is-unknown' : '') + (frac !== null && frac < 0.2 ? ' is-low' : ''));
  b.type = 'button';
  b.title = level === null ? `${t.name}: FarmNet sends no level` : `${t.name}: ${level} cm of a full mark at ${full} cm (set on this computer — press to change)`;
  b.append(tankSvg(frac, Number(tap?.V) === 100));
  const txt = el('div', 'ir-tank-txt');
  txt.append(el('b', null, t.name));
  if (vol) txt.append(el('span', 'ir-tank-vol', show(vol.V, (vol.U || 'm3').replace('m3', 'm³'))));
  txt.append(el('span', 'hint', level === null ? 'no level reading' : `${level} cm${frac !== null ? ' · ' + Math.round(frac * 100) + ' %' : ''}`));
  if (tap) txt.append(el('span', 'pill ' + (Number(tap.V) === 100 ? 'ok' : ''), `${tap.N === 'Inlet' ? 'Inlet' : 'Refill'} ${Number(tap.V) === 100 ? 'open' : 'closed'}`));
  // whatever else FarmNet says of the tank (EC, temperature…), in small
  (t.dataList || []).filter(d => d !== lv && d !== vol && d !== tap).forEach(d => txt.append(el('span', 'hint', `${d.N} ${show(d.V, d.U)}`)));
  b.append(txt);
  b.onclick = () => {
    if (level === null) return;
    const d = drawer('Full mark', `${t.name} · on this computer only`);
    const i = el('input', 'input'); i.type = 'number'; i.min = '1'; i.max = '2000'; i.step = '1'; i.value = String(full);
    d.body.append(el('p', 'hint', 'FarmNet sends the level but not the height of the tank. The level at which this tank is full draws it to scale here; nothing is sent to FarmNet.'),
      field('Full at (cm)', i));
    const ok = el('button', 'btn btn-primary', 'Keep');
    ok.onclick = () => {
      const n = Math.round(Number(i.value));
      if (!(n >= 1 && n <= 2000)) { toast('1 to 2000 cm', 'bad'); return; }
      pref.set(fullKey(farm, t), n === FULL_DEFAULT ? null : String(n));
      d.close(); redraw();
    };
    d.footer.append(ok);
  };
  return b;
}

// a tank, drawn: the vessel, the water to its level with a wave, and a drop falling in when the inlet is open
function tankSvg(frac, filling) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 84'); svg.setAttribute('class', 'ir-tank-svg'); svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([a, v]) => n.setAttribute(a, v)); svg.append(n); return n; };
  const top = 8, bottom = 80, h = bottom - top;
  mk('rect', { x: 4, y: top, width: 56, height: h, rx: 8, class: 'ir-vessel' });
  if (frac !== null) {
    const y = bottom - h * frac;
    const clipId = 'irc' + Math.random().toString(36).slice(2, 8);
    const defs = mk('defs', {}); const cp = document.createElementNS(NS, 'clipPath'); cp.setAttribute('id', clipId);
    const cr = document.createElementNS(NS, 'rect'); [['x', 4], ['y', top], ['width', 56], ['height', h], ['rx', 8]].forEach(([a, v]) => cr.setAttribute(a, v));
    cp.append(cr); defs.append(cp);
    const g = mk('g', { 'clip-path': `url(#${clipId})` });
    const w = document.createElementNS(NS, 'path');
    w.setAttribute('d', `M0 ${y} q8 -3 16 0 t16 0 t16 0 t16 0 V${bottom + 2} H0 Z`);
    w.setAttribute('class', 'ir-water');
    g.append(w);
    [0.25, 0.5, 0.75].forEach(m => mk('line', { x1: 52, x2: 60, y1: bottom - h * m, y2: bottom - h * m, class: 'ir-tick' }));
  }
  if (filling) mk('path', { d: 'M32 0 q-4 6 0 8 q4 -2 0 -8 Z', class: 'ir-drop' });
  return svg;
}

function machine(name, run, rows) {
  const m = el('div', 'ir-machine');
  const h = el('div', 'fc-unit-head'); h.append(el('b', null, name), el('span', 'pill ' + (run ? 'ok' : ''), run ? 'Running' : 'Idle'));
  m.append(h);
  const grid = el('div', 'ir-kv');
  rows.forEach(([k, v]) => grid.append(el('span', 'hint', k), el('b', null, v)));
  m.append(grid);
  return m;
}

function mixerView(f, colourOf) {
  const m = el('div', 'ir-machine ir-mixer');
  const h = el('div', 'fc-unit-head'); h.append(el('b', null, f.name), el('span', 'pill ' + (f.run ? 'ok' : ''), f.run ? 'Mixing' : 'Idle'));
  m.append(h);
  const now = (f.runList || [])[0];
  if (now?.FA) {
    const r = el('div', 'ir-now-recipe'); r.style.setProperty('--rc', colourOf(now.FA));
    r.append(el('span', 'ir-dot'), el('span', null, `${now.FA} → ${now.TK || now.N || ''}`), el('span', 'hint', `${say(now.ST)}${now.TM ? ' · ' + now.TM + ' left' : ''}`));
    m.append(r);
  }
  const line = (label, n, tn, scale, u) => {
    const v = num(val(f.dataList, n)?.V), t = num(val(f.dataList, tn)?.V);
    const row = el('div', 'ir-meas');
    const off = v !== null && t !== null ? Math.abs(v - t) : null;
    const warn = off !== null && off > (n === 'EC' ? 0.2 : 0.3);
    row.append(el('span', 'hint', label), el('b', warn ? 'ir-off' : null, `${v === null ? '—' : v.toFixed(2)}${u ? ' ' + u : ''}`),
      el('span', 'hint', t === null ? '' : `target ${t.toFixed(2)}`));
    const w = el('div'); w.append(row, gauge(scale, t, v));
    return w;
  };
  m.append(line('EC', 'EC', 'EC Target', EC_SCALE, 'mS'), line('pH', 'pH', 'pH Target', PH_SCALE, ''));
  const fl = val(f.dataList, 'Flow');
  if (fl) { const r = el('div', 'ir-meas'); r.append(el('span', 'hint', 'Flow'), el('b', null, show(fl.V, (fl.U || '').replace('m3', 'm³')))); m.append(r); }
  if (f.next && f.next !== '----') m.append(el('div', 'hint', `next mixing ${short(f.next)}`));
  return m;
}

function valveView(v, colourOf) {
  const m = el('div', 'ir-machine ir-valve');
  const h = el('div', 'fc-unit-head'); h.append(el('b', null, v.name || 'Irrigation'), el('span', 'pill ' + (v.run ? 'ok' : ''), v.run ? 'Watering' : 'Idle'));
  m.append(h);
  const list = (v.runList || []).slice(0, 6);
  if (!list.length) m.append(el('div', 'hint', 'Nothing running or waiting.'));
  list.forEach(x => {
    const r = el('div', 'ir-now-recipe'); r.style.setProperty('--rc', colourOf(x.FA));
    r.append(el('span', 'ir-dot'), el('span', null, `${x.PN} → ${x.VN || '—'}`), el('span', 'hint', `${say(x.ST)}${x.TM ? ' · ' + x.TM : ''}`));
    m.append(r);
  });
  if ((v.runList || []).length > 6) m.append(el('div', 'hint', `and ${v.runList.length - 6} more`));
  if (v.pause > 0) m.append(el('div', 'pill warn', `paused · ${Math.round(v.pause / 60)} min left`));
  if (v.next && v.next !== '----') m.append(el('div', 'hint', `next start ${short(v.next)}`));
  return m;
}

// ═══ Today on a clock ═══════════════════════════════════════════════════════
// minutes after midnight of "06:00", "06:00:00", "2026-11-20 06:00:00", or a number of seconds
export function tod(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v >= 0 && v <= 86400 ? v / 60 : null;
  const m = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
  if (m) { const x = Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / 60; return x <= 1440 ? x : null; }
  const n = num(v);
  return n !== null && n >= 0 && n <= 86400 ? n / 60 : null;
}
const diyV = x => (x && typeof x === 'object' && 'V' in x ? x.V : x);

function clock(programs, params, records, colourOf, recipeOfProgram, valvesOf, open) {
  const today = nowLocal().slice(0, 10), now = tod(nowLocal());
  const box = el('div', 'ir-clock');
  const pct = m => `${(Math.max(0, Math.min(1440, m)) / 1440) * 100}%`;
  // the axis
  const axis = el('div', 'ir-row ir-axis');
  axis.append(el('div', 'ir-label'));
  const ax = el('div', 'ir-track');
  for (let h = 0; h <= 24; h += 3) { const t = el('span', 'ir-hour' + (h === 24 ? ' is-end' : ''), String(h).padStart(2, '0')); t.style.left = pct(h * 60); ax.append(t); }
  axis.append(ax);
  box.append(axis);
  if (!programs.length) box.append(el('div', 'hint', 'FarmNet lists no irrigation program.'));

  programs.forEach((p, i) => {
    const par = params[i]?.v || null;
    const rec = recipeOfProgram(p.ID);
    const row = el('div', 'ir-row is-open');
    row.dataset.pid = String(p.ID);
    row.style.setProperty('--rc', colourOf(rec));
    // a press opens the program; on the clock, the time pressed is offered for a new start
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `${p.NM}: see it in full`);
    row.onclick = e => {
      const r = tr.getBoundingClientRect();
      const at = e.clientX >= r.left && e.clientX <= r.right && r.width ? ((e.clientX - r.left) / r.width) * 1440 : undefined;
      open(p, at);
    };
    row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p); } };
    const lab = el('div', 'ir-label');
    const valves = valvesOf(p.ID);
    lab.append(el('b', null, p.NM),
      el('span', 'hint', [say(p.DT), say(p.MD), tod(p.TM) ? `${Math.round(tod(p.TM))} min in all` : ''].filter(Boolean).join(' · ')),
      el('span', 'hint', [rec ? `recipe ${rec}` : 'no recipe', valves.slice(0, 3).join(', ') + (valves.length > 3 ? '…' : '')].filter(Boolean).join(' · ')),
      el('span', 'hint', p.NX && p.NX !== '----' ? `next start ${short(p.NX)}` : 'no next start'));
    const tr = el('div', 'ir-track');
    const enabled = par ? Number(diyV(par.EN)) !== 0 : true;
    if (!enabled) row.classList.add('is-off');

    // what was planned
    const starts = par && Array.isArray(par.TM) ? par.TM.filter(x => x && x.USE !== false) : [];
    const runLen = Math.max(2, tod(p.TM) ?? 2);   // minutes in all
    let drawn = 0;
    if (par && Number(par.SMD) === 1) {           // cycling: a window from start to end, every CST
      const every = tod(diyV(par.CST));
      starts.forEach(x => {
        const a = tod(diyV(x.ST)), b = tod(diyV(x.ET));
        if (a === null) return;
        const piece = (from, to) => {
          const w = el('div', 'ir-window');
          w.style.left = pct(from); w.style.width = `calc(${pct(to)} - ${pct(from)})`;
          w.title = `cycles ${fmt(a)}–${b !== null ? fmt(b) : '…'}${every ? ' · every ' + Math.round(every) + ' min' : ''}`;
          tr.append(w);
        };
        // a window that crosses midnight (FarmLab's EBB: 17:50 to 06:30) is drawn in two pieces
        if (b !== null && b < a) { piece(a, 1440); if (b > 0) piece(0, b); }
        else piece(a, b !== null && b > a ? b : a + runLen);
        drawn++;
      });
    } else {
      starts.forEach(x => {
        const a = tod(diyV(x.ST));
        if (a === null) return;
        const s = el('div', 'ir-plan');
        s.style.left = pct(a); s.style.width = `max(4px, calc(${pct(a + runLen)} - ${pct(a)}))`;
        s.title = `starts ${fmt(a)} · ${p.TM}`;
        tr.append(s); drawn++;
      });
    }
    // without the program's starts: its next start only, if it is today
    if (!drawn && String(p.NX || '').startsWith(today)) {
      const a = tod(p.NX);
      if (a !== null) { const s = el('div', 'ir-plan ir-plan-next'); s.style.left = pct(a); s.style.width = '4px'; s.title = `next start ${fmt(a)}`; tr.append(s); }
    }
    // what ran today
    // (matched by name: the run records carry the program's name, not its number); a run across midnight is cut at it
    records.filter(r => r.NM === p.NM && (String(r.ST || '').startsWith(today) || String(r.ET || '').startsWith(today))).forEach(r => {
      const a = String(r.ST || '').startsWith(today) ? tod(r.ST) : 0;
      const b = String(r.ET || '').startsWith(today) ? tod(r.ET) : String(r.ET || '') > today ? 1440 : null;
      if (a === null) return;
      const d = el('div', 'ir-done');
      d.style.left = pct(a); d.style.width = `max(3px, calc(${pct(b !== null && b > a ? b : a + 1)} - ${pct(a)}))`;
      d.title = `ran ${fmt(a)}${b !== null ? '–' + fmt(b) : ''}${r.VLM ? ' · ' + r.VLM + ' m³' : ''}`;
      tr.append(d);
    });
    if (now !== null) { const n = el('div', 'ir-now'); n.style.left = pct(now); tr.append(n); }
    if (params[i]?.e) tr.title = `FarmNet did not give this program's start times: ${params[i].e}`;
    row.append(lab, tr);
    box.append(row);
  });
  const key = el('div', 'ir-key hint');
  const sw = (cls, t) => { const s = el('span'); s.append(el('i', cls), document.createTextNode(t)); return s; };
  key.append(sw('ir-plan', 'planned start'), sw('ir-window', 'cycling window'), sw('ir-done', 'ran today'), sw('ir-now', 'now'));
  box.append(key);
  return box;
}
const fmt = m => { const x = Math.round(m); return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

