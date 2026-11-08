// ═══════════════════════════════════════════════════════════════════════════
// FarmNet — the farm's FarmNet controller, live, on a page of its own
// (migration 0272, edge function `farmnet`; owner, 5 Nov 2026: "start building
// the page to manage the Farmnet information and control", then "a dedicated
// page dashboard in naked heart where control and read all main information of
// farmnet software"; who may send a command: "farm manager and admin").
//
// Everything is asked of FarmNet itself through the function, which signs each
// call (the controller's key never reaches the browser). Seven tabs:
//   Overview    alarms, irrigation, the mixer, the day tank, today's runs, the
//               chosen sensors live and over 24 h, the climate zones, the last
//               commands — read again every minute while it is on screen
//   Irrigation  each centre's valve, tanks and disinfection; its programs; runs
//   Mixing      each mixer live; its programs, its runs, the recipes
//   Climate     each zone's devices and their state; its setpoints
//   Sensors     every signal source FarmNet has: choose up to 8 for the
//               Overview, live values and history
//   Alarms      now, and the past ones
//   Commands    the log of every command, sent or refused (0272)
// The farm's Admin and Farm manager also get the commands: start an irrigation
// or a mixing program by hand, pause, resume, stop the current run, change a
// zone's setpoints. Each one is confirmed here, checked again in the function
// (no deleting, no device settings, no shutting the system down) and logged.
// Connections › FarmNet & sensors keeps what comes in through `ingest`.
// ═══════════════════════════════════════════════════════════════════════════
import { fn, rpc } from './api.js';
import { el, pageHead, drawer, field, selectBox, toast, busy, confirmDrawer, icon, loading, farmDate, farmLocal, pref, addDays } from './ui.js';
import { lineChart } from './connect.js';
import { site3d } from './farmnet3d.js';

const FN = 'farmnet';
const ask = (farm, action, args = {}) => fn(FN, { farm: farm.id, action, args }, { quiet: true }).then(r => r?.data);
const send = (farm, action, args, changes) => fn(FN, { farm: farm.id, action, args, changes });
const soft = p => Promise.resolve(p).then(v => ({ v }), e => ({ e: e?.message || String(e) }));   // one section failing does not blank the page

const num = v => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? n : null; };
const NO_SENSOR = n => n === 65535 || n === -100;           // FarmNet's "no sensor" values
const show = (v, u) => {
  const n = num(v);
  if (n !== null && NO_SENSOR(n)) return '—';
  return `${v ?? '—'}${u ? ' ' + u : ''}`;
};
const secs = s => { const n = Number(s) || 0; return n >= 3600 ? `${Math.floor(n / 3600)} h ${Math.round((n % 3600) / 60)} min` : n >= 60 ? `${Math.round(n / 60)} min` : `${n} s`; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nice = s => s ? farmLocal(s).replace('T', ' ').slice(5) : '—';   // the farm's clock, "11-05 17:26" like FarmNet's own times
// FarmNet's own times are the farm's wall clock, "2026-11-05 08:00[:00]"
const fnTime = s => { const t = s ? new Date(String(s).replace(' ', 'T')).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const short = s => s ? String(s).slice(5, 16) : '—';        // "11-05 08:00"
const nowLocal = (minusMin = 0) => farmLocal(new Date(Date.now() - minusMin * 60000).toISOString()).replace('T', ' ');
const HUES = [205, 28, 145, 285, 350, 55, 180, 320];
const colour = i => `hsl(${HUES[i % HUES.length]} 60% 52%)`;

// ── what is kept between tabs (per farm): who may control, the sensor list ──
const memo = new Map();
async function kept(farm, key, ms, load) {
  const k = farm.id + '|' + key, m = memo.get(k);
  if (m && Date.now() - m.at < ms) return m.p;
  const p = load();
  memo.set(k, { at: Date.now(), p });
  p.catch(() => memo.delete(k));            // a failure is not kept
  return p;
}
const helloOf = farm => kept(farm, 'hello', 5 * 60000, () => fn(FN, { farm: farm.id, action: 'hello' }, { quiet: true }));

// every signal source FarmNet has, flat: { id, label, unit, dec, group, path }
const GROUPS = { general: 'General', climate: 'Climate', irrigate: 'Irrigation', energy: 'Energy' };
const sourcesOf = farm => kept(farm, 'sources', 10 * 60000, async () => {
  const d = await ask(farm, 'sources', { climate: 1, irrigate: 1, general: 1, energy: 1 }) || {};
  const out = [];
  const walk = (n, group, path) => {
    const label = String(n.label ?? '').replace(/\s+/g, ' ').trim();
    if (Array.isArray(n.children) && n.children.length) { n.children.forEach(c => walk(c, group, label ? [...path, label] : path)); return; }
    if (typeof n.id === 'string' && n.id.includes('/')) out.push({ id: n.id, label, unit: n.unit || '', dec: Number(n.decm ?? 2), group, path });
  };
  Object.entries(d).forEach(([g, list]) => (Array.isArray(list) ? list : []).forEach(n => walk(n, g, [])));
  return out;
});

// the sensors on the Overview, chosen on this computer (Sensors tab); until then the weather station and the greenhouse sensor
const PIN_KEY = farm => 'fbc_fn_pins_' + farm.id;
const DEFAULT_PINS = ['Outdoor Temp', 'Outdoor RH', 'Outdoor Light', 'Wind Speed', 'Air Temp', 'Relative RH', 'Light Intensity', 'Dissolved Oxygen'];
const MAX_PINS = 8;
function pinsOf(farm, sources) {
  let ids = null;
  try { ids = JSON.parse(pref.get(PIN_KEY(farm)) || 'null'); } catch { ids = null; }
  if (Array.isArray(ids)) return ids.map(i => sources.find(s => s.id === i)).filter(Boolean).slice(0, MAX_PINS);
  const picked = [];
  DEFAULT_PINS.forEach(l => { const s = sources.find(x => x.group === 'general' && x.label === l); if (s) picked.push(s); });
  return picked.slice(0, MAX_PINS);
}
const setPins = (farm, list) => pref.set(PIN_KEY(farm), JSON.stringify(list.map(s => s.id)));

// ── the frame every tab shares ──────────────────────────────────────────────
let token = 0;   // a newer page or refresh wins: an older one draws nothing
const MAY = 'Commands go straight to the greenhouse: each one asks you to confirm and is logged (Commands).';
const READ_ONLY = 'Read only: the farm admin and the farm manager may send commands.';

async function page(mount, farm, blurb, draw, opts = {}) {
  const my = ++token;
  if (!opts.quiet) { mount.textContent = ''; mount.append(loading('Asking FarmNet…')); }
  const again = q => page(mount, farm, blurb, draw, { ...opts, quiet: q });
  let h;
  try { h = await helloOf(farm); } catch (e) {
    if (my !== token) return;
    // a quiet re-read that fails keeps what is on screen and tries again at the next minute
    if (opts.quiet && mount.querySelector('.fn-page')) {
      toast(`FarmNet: ${e.message}`, 'bad');
      if (opts.every) setTimeout(() => { if (mount.isConnected && my === token) again(true); }, opts.every);
      return;
    }
    mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return;
  }
  if (my !== token) return;
  if (!h?.connected) {
    mount.textContent = '';
    mount.append(pageHead(null, 'FarmNet\'s own controller, live: irrigation, mixing, climate, sensors and alarms.'),
      el('div', 'note', `${farm.name} has no FarmNet controller set up on the platform. The controller's address, device number and key are kept as secrets of the function farmnet (FARMNET_${(farm.code || '').toUpperCase()}_URL, _DEVICE, _KEY); the owner sets them.`));
    return;
  }
  const ctx = {
    farm, may: !!h.may_control, actions: h.actions || {}, fresh: !opts.quiet,
    live: () => mount.isConnected && my === token,
    // after a command: in place, no "Asking…"; even if a minute's re-read started meanwhile (it may have read FarmNet before the command)
    redraw: () => { if (mount.isConnected) again(true); },
  };
  const body = el('div', 'fn-page');
  try { await draw(ctx, body); } catch (e) { body.replaceChildren(el('div', 'note bad', e.message)); }
  if (!ctx.live()) return;
  const refresh = el('button', 'btn btn-sm', 'Refresh'); refresh.type = 'button';
  refresh.onclick = () => again(false);
  const stamp = el('span', 'hint', `read ${farmLocal(new Date().toISOString()).slice(11)}${opts.every ? ' · again every minute' : ''}`);
  mount.replaceChildren(pageHead(null, opts.commands ? `${blurb} ${ctx.may ? MAY : READ_ONLY}` : blurb, stamp, refresh), body);
  // the Overview reads again by itself while it is on screen (not while the window is hidden, not while a drawer is open)
  if (opts.every) {
    const tick = () => {
      if (!ctx.live()) return;
      if (document.visibilityState !== 'visible' || document.querySelector('aside.drawer')) { setTimeout(tick, 15000); return; }
      again(true);
    };
    setTimeout(tick, opts.every);
  }
}

// ── small pieces ────────────────────────────────────────────────────────────
function card(title, ...right) {
  const c = el('div', 'card card-pad fc-card');
  const head = el('div', 'fc-head');
  head.append(el('h3', null, title));
  if (right.length) head.append(el('div', 'spacer'), ...right);
  c.append(head);
  return c;
}
const bad = e => el('div', 'note bad', e);
const link = (href, text) => { const a = el('a', 'btn btn-sm btn-ghost', text); a.href = href; return a; };

function vals(list) {
  const row = el('div', 'cx-vals');
  (list || []).forEach(d => {
    const v = el('div', 'cx-val');
    const s = show(d.V);
    v.append(el('span', 'cx-v', s), el('span', 'cx-u', s === '—' ? '' : (d.U || '')), el('span', 'cx-l', d.N || ''));
    row.append(v);
  });
  return row;
}

function unit(title, run, list, buttons, extra) {
  const u = el('div', 'fc-unit');
  const head = el('div', 'fc-unit-head');
  head.append(el('b', null, title));
  if (run !== undefined) head.append(el('span', 'pill ' + (run ? 'ok' : ''), run ? 'Running' : 'Idle'));
  u.append(head);
  if (extra) u.append(el('div', 'hint fc-next', extra));
  u.append(vals(list));
  if (buttons?.length) { const b = el('div', 'fc-btns'); b.append(...buttons); u.append(b); }
  return u;
}
const nextOf = x => x?.next && x.next !== '----' ? `next start ${short(x.next)}` : '';

// one press at a time: the button stays off until its drawer or command is done (a double click sent two commands)
function btn(label, onclick, cls = 'btn btn-sm') {
  const b = el('button', cls, label); b.type = 'button';
  b.onclick = async () => { if (b.disabled) return; b.disabled = true; try { await onclick(b); } finally { b.disabled = false; } };
  return b;
}

function table(heads, rows, numeric = []) {
  const w = el('div', 'table-wrap fc-table');
  const t = el('table'); const th = el('thead'); const tr = el('tr');
  heads.forEach((h, i) => tr.append(el('th', numeric.includes(i) ? 'num' : null, h))); th.append(tr);
  const tb = el('tbody');
  if (!rows.length) { const r = el('tr'); const td = el('td', 'hint', 'Nothing.'); td.colSpan = heads.length; r.append(td); tb.append(r); }
  rows.forEach(cells => {
    const r = el('tr');
    cells.forEach((x, i) => {
      if (x instanceof Node) { const td = el('td', numeric.includes(i) ? 'num' : null); td.append(x); r.append(td); }
      else r.append(el('td', numeric.includes(i) ? 'num' : null, x == null || x === '' ? '—' : String(x)));
    });
    tb.append(r);
  });
  t.append(th, tb); w.append(t);
  return w;
}

// a span of days chosen with a segmented control, kept on this computer
function spanPicker(key, spans, onPick) {
  const cur = Number(pref.get(key) ?? spans[0][0]);
  const at = spans.some(s => s[0] === cur) ? cur : spans[0][0];
  const seg = el('div', 'seg');
  spans.forEach(([n, label]) => {
    const b = el('button', 'seg-btn', label); b.type = 'button'; b.setAttribute('aria-pressed', String(n === at));
    b.onclick = () => { if (n === at) return; pref.set(key, String(n)); onPick(); };
    seg.append(b);
  });
  return { at, seg };
}
const DAY_SPANS = [[0, 'Today'], [1, '2 days'], [6, '7 days']];
const range = back => { const day = farmDate(); return { start: ymd(addDays(day, -back)), stop: ymd(day) }; };

// the centres and their full status (detail: the valve, the mixers, the disinfection, the tanks)
async function centres(farm) {
  const cs = await ask(farm, 'centres') || [];
  const det = await Promise.all(cs.map(c => soft(ask(farm, 'irrigation_detail', { id: c.id }))));
  return cs.map((c, i) => ({ ...c, status: det[i] }));
}

// ═══ Overview ═══════════════════════════════════════════════════════════════
export async function renderFnOverview(mount, farm) {
  await page(mount, farm, 'FarmNet at a glance, live.', async (ctx, body) => {
    const today = range(0);
    const [cs, zones, alarms, log, src] = await Promise.all([
      soft(centres(farm)), soft(ask(farm, 'zones')), soft(ask(farm, 'alarms_now')),
      soft(rpc('farmnet_commands', { p_farm: farm.id, p_limit: 5 }, { quiet: true })), soft(sourcesOf(farm)),
    ]);
    const zs = zones.v || [], cl = cs.v || [];
    const pins = pinsOf(farm, src.v || []);
    const plan = PLANS[farm.code] && src.v ? planOf(PLANS[farm.code], src.v) : null;
    const [runs, zstat, real, charts] = await Promise.all([
      Promise.all(cl.map(c => soft(ask(farm, 'irrigation_records', { id: c.id, type: 0, ...today })))),
      Promise.all(zs.map(z => soft(ask(farm, 'climate_status', { id: z.id })))),
      soft(realOf(farm, [...pins.map(p => p.id), ...(plan ? plan.ids : [])])),   // the sensors and the plan in one read
      history(farm, pins, 24 * 60, 2),
    ]);
    if (!ctx.live()) return;

    // the greenhouse seen from above (a farm with a plan: FarmBox1)
    if (plan) body.append(real.e ? bad('Bay plan: ' + real.e) : planView(ctx, plan, real.v || []));

    // the tiles
    const tiles = el('div', 'tiles cx-tiles fn-tiles');
    const tile = (value, label, sub, cls = '', href = null) => {
      const t = el(href ? 'a' : 'div', 'tile ' + cls); if (href) t.href = href;
      const b = el('div', 'tile-body');
      b.append(el('div', 'tile-value', value), el('div', 'tile-label', label), el('div', 'tile-sub', sub || ''));
      t.append(b); tiles.append(t);
    };
    const al = alarms.v || [];
    tile(alarms.e ? '?' : String(al.length), 'Alarms now', alarms.e ? alarms.e : al.length ? al.map(a => a.DES || a.TP).slice(0, 2).join(' · ') : 'nothing raised', al.length ? 'bad' : '', '#/farmnet/alarms');
    cl.forEach((c, i) => {
      const s = c.status.v || {};
      const v = s.valve || {};
      const recs = runs[i].v?.record || [];
      const vol = recs.reduce((a, r) => a + (num(r.VLM) || 0), 0);
      tile(v.run ? 'Running' : 'Idle', `${c.name} irrigation`, nextOf(v) || (c.status.e || ''), v.run ? 'ok' : '', '#/farmnet/irrigation');
      tile(runs[i].e ? '?' : String(recs.length), 'Runs today', runs[i].e || `${vol.toFixed(2)} m³ in all`, '', '#/farmnet/irrigation');
      (s.fertList || []).forEach(f => {
        const g = n => (f.dataList || []).find(d => d.N === n);
        const ec = g('EC'), ph = g('pH');
        tile(`${show(ec?.V)} · ${show(ph?.V)}`, `${f.name} EC · pH`, `${f.run ? 'mixing' : 'idle'}${f.next && f.next !== '----' ? ' · next ' + short(f.next) : ''}`, f.run ? 'ok' : '', '#/farmnet/mixing');
      });
      (s.tankList || []).filter(t => t.type === 5).forEach(t => {
        const g = n => (t.dataList || []).find(d => d.N === n);
        tile(show(g('Level')?.V, g('Level')?.U), t.name, g('Water Vol.') ? `${show(g('Water Vol.').V, g('Water Vol.').U)}` : '', '', '#/farmnet/irrigation');
      });
    });
    body.append(tiles);
    if (cs.e) body.append(bad('Fertigation: ' + cs.e));

    // the chosen sensors
    const sc = card('Sensors', link('#/farmnet/sensors', 'Choose…'));
    if (src.e) sc.append(bad(src.e));
    else if (!pins.length) sc.append(el('div', 'hint', 'No sensor chosen: choose up to 8 on the Sensors tab.'));
    else if (real.e) sc.append(bad(real.e));
    else sc.append(liveVals(pins, real.v || []));
    charts.forEach(ch => sc.append(ch));
    body.append(sc);

    // fertigation now, with the commands
    cl.forEach(c => body.append(centreLive(ctx, c)));

    // the climate zones in short
    const zc = card('Climate zones', link('#/farmnet/climate', 'Open…'));
    if (zones.e) zc.append(bad(zones.e));
    const zg = el('div', 'fn-zones');
    zs.forEach((z, i) => {
      const b = el('div', 'fc-unit');
      b.append(el('b', null, z.name));
      if (zstat[i].e) { b.append(bad(zstat[i].e)); zg.append(b); return; }
      const devs = (zstat[i].v?.typeList || []).flatMap(t => (t.devList || []).map(d => ({ ...d, type: t.typeName })));
      const on = devs.filter(d => Number(d.value) > 0);
      const row = el('div', 'fc-devs');
      on.forEach(d => row.append(el('span', 'pill ok', `${d.name} ${Number(d.value) === 1 ? 'on' : d.value + '%'}`)));
      b.append(el('div', 'hint', on.length ? `${on.length} of ${devs.length} devices working` : `${devs.length} devices, all off`), row);
      zg.append(b);
    });
    zc.append(zg);
    body.append(zc);

    // the last commands
    body.append(logCard(ctx, log, 'Last commands', link('#/farmnet/commands', 'All…')));
  }, { every: 60000, commands: true });
}

// live values of any number of sources: the function takes 2000 characters of ids a call, so several calls when needed
async function realOf(farm, ids) {
  const list = [...new Set(ids)];
  const chunks = [];
  let cur = [];
  list.forEach(i => { if (cur.length && cur.join(',').length + i.length + 1 > 1800) { chunks.push(cur); cur = []; } cur.push(i); });
  if (cur.length) chunks.push(cur);
  const got = await Promise.all(chunks.map(c => ask(farm, 'source_real', { srcId: c.join(',') })));
  return got.flatMap(x => x || []);
}

// ═══ The bay plan ═══════════════════════════════════════════════════════════
// Which of FarmNet's sources belong to which bay. FarmNet groups by its own climate zones; the bays are the
// farm's (FarmBox1: 8 bays of 9.6 × 52 m, supabase/data/farmbox1.sql). Owner, 5 Nov 2026: "FN_ETH_33 and
// FN_ASM_2 is bay 7, FN_ETH_31 are bay 5-6-7, FN_ETH_32 is bay 1-2-3-4, other i do not know now". Corrected the
// same day: "strawberry air temp is eth33 … s3 win1 and win2 are the windows, custom equipment is the strawberry
// position 0% bottom, 100% top. EBB and flow and NFT: eth2 [FN_ETH_32] air sensor, screen s2 win1,2,3,4; vines air
// and medium sensor asm2 and eth31 only air sensor". FN_ASM_2 (air and soil) serves the vines and the strawberries; FN_ASM_1 is not on the plan. The vines' six vents are still
// ASSUMED two a bay, in FarmNet's order: each one shows its own name, so a wrong guess shows and is corrected here.
const PLANS = {
  FB1: {
    bays: [[1, 'Ebb & flow'], [2, 'NFT'], [3, 'NFT'], [4, 'NFT'], [5, 'Vines'], [6, 'Vines'], [7, 'Vines'], [8, 'Strawberries']],
    zones: [
      { fn: 'NFT E&F', bays: [1, 2, 3, 4], vents: ['S2_Win1', 'S2_Win2', 'S2_Win3', 'S2_Win4'], shade: 'S2_Shade' },
      { fn: 'Vine crops', bays: [5, 6, 7], vents: ['S1_Win1', 'S1_Win2', 'S1_Win3', 'S1_Win4', 'S1_Win5', 'S1_Win6'], shade: 'S1_Shade' },
      // the zone's custom equipment is the height of the strawberries: 0 % at the bottom, 100 % at the top
      { fn: 'Strawberries', bays: [8], vents: ['S3_Win1', 'S3_Win2'], shade: 'S3_Shade', lift: 'Strawberry position' },
    ],
    // the first sensor of a bay is the one shown big; one that serves several bays is marked "zone sensor"
    sensors: { 1: ['FN_ETH_32'], 2: ['FN_ETH_32'], 3: ['FN_ETH_32'], 4: ['FN_ETH_32'], 5: ['FN_ETH_31', 'FN_ASM_2'], 6: ['FN_ETH_31', 'FN_ASM_2'], 7: ['FN_ETH_31', 'FN_ASM_2'], 8: ['FN_ETH_33', 'FN_ASM_2'] },
    // the sensors that also read the growing medium: of the rest of their values, light and CO2 are the air's, battery and signal the sensor's own, the others the medium's
    medium: ['FN_ASM_2'],
    // what each sensor reads (owner, 5 and 8 Nov: "asm2 air and soil, eth31 air", "eth33 air", "eth2 air"). They hang at different heights, so two in one bay read a little apart
    kinds: { FN_ETH_31: 'air', FN_ETH_32: 'air', FN_ETH_33: 'air', FN_ASM_2: 'air and soil' },
    valves: { 1: ['EBB 1A', 'EBB 1B'], 2: ['NFT Bay234'], 3: ['NFT Bay234'], 4: ['NFT Bay234'], 5: ['Bay 5'], 6: ['Bay 6'], 7: ['Bay 7'], 8: ['Bay 8'] },
  },
};

// the plan with each place's source: { bays: [{ n, kind, zone, vents, sensors, valves, shared }], zones, weather, ids }
function planOf(P, src) {
  const ids = [];
  const take = s => { if (s) ids.push(s.id); return s || null; };
  const last = s => s.path[s.path.length - 1];
  const clim = (zone, dev, label) => take(src.find(s => s.group === 'climate' && s.path[0] === zone && s.path[1] === dev && s.path[2] === 'Status' && s.label === label));
  const sensorOf = name => {
    const t = take(src.find(s => s.group === 'general' && last(s) === name && s.label === 'Air Temp'));
    const rh = take(src.find(s => s.group === 'general' && last(s) === name && s.label === 'Relative RH'));
    // an FN_ASM is one body that reads the air and the soil at once. Its other values are sorted by what they read:
    // light and CO2 are the air's, battery and signal the sensor's own, the rest the growing medium's
    const rest = (P.medium || []).includes(name) ? src.filter(s => s.group === 'general' && last(s) === name && s.label !== 'Air Temp' && s.label !== 'Relative RH') : [];
    const isDevice = s => /batter|signal|rssi/i.test(s.label);
    const device = rest.filter(isDevice).map(take);
    const air = rest.filter(s => !isDevice(s) && /light|lux|co2/i.test(s.label)).map(take);
    const medium = rest.filter(s => !air.includes(s) && !device.includes(s)).map(take);
    return { name, kind: (P.kinds || {})[name] || '', t, rh, air, device, medium };
  };
  const valveOf = name => ({ name, s: take(src.find(s => s.group === 'irrigate' && s.path[1] === 'Valve' && s.path[2] === name && s.label === 'Switch Status')) });
  const zones = P.zones.map(z => {
    // every switched device of the zone (fans, fogging, cooling), from FarmNet's own list
    const devs = [...new Set(src.filter(s => s.group === 'climate' && s.path[0] === z.fn && s.path[2] === 'Status' && s.label === 'Switch Status').map(s => s.path[1]))]
      .map(d => ({ name: d, s: clim(z.fn, d, 'Switch Status') }));
    // the zone's custom equipment (FB1's strawberries: their height), its position read like a vent's
    let liftS = null;
    if (z.lift) {
      const pos = src.filter(s => s.group === 'climate' && s.path[0] === z.fn && s.path[1] !== z.shade && !z.vents.includes(s.path[1]) && /position/i.test(s.label));
      liftS = take(pos.find(s => /custom/i.test(s.path[1]) && s.label === 'Actual Position') || pos.find(s => /custom/i.test(s.path[1])) || pos.find(s => s.label === 'Actual Position'));
    }
    return { ...z, shadeS: clim(z.fn, z.shade, 'Actual Position'), liftS, devs };
  });
  const uses = {};
  Object.values(P.sensors).forEach(l => l.forEach(n => { uses[n] = (uses[n] || 0) + 1; }));
  const sensors = new Map();
  const bays = P.bays.map(([n, kind]) => {
    const zone = zones.find(z => z.bays.includes(n)) || null;
    const at = zone ? zone.bays.indexOf(n) : -1, per = zone ? Math.round(zone.vents.length / zone.bays.length) : 0;
    const vents = zone ? zone.vents.slice(at * per, at * per + per).map(v => ({ name: v, s: clim(zone.fn, v, 'Actual Position') })) : [];
    const ss = (P.sensors[n] || []).map(name => { if (!sensors.has(name)) sensors.set(name, sensorOf(name)); return sensors.get(name); });
    return { n, kind, zone, vents, sensors: ss, shared: !!ss[0] && uses[ss[0].name] > 1, valves: (P.valves[n] || []).map(valveOf) };
  });
  const w = label => take(src.find(s => s.group === 'general' && last(s) === 'Weather Station' && s.label === label));
  const weather = [['Outside', w('Outdoor Temp'), 1], ['RH', w('Outdoor RH'), 0], ['Wind', w('Wind Speed'), 1], ['Light', w('Outdoor Light'), 1]];
  return { bays, zones, weather, ids };
}

const valueOf = (real, s) => { if (!s) return null; const n = num(real.find(x => x.id === s.id)?.value); return n === null || NO_SENSOR(n) ? null : n; };
const hueOf = t => Math.max(0, Math.min(210, 210 - (t - 12) * 10.5));   // 12 °C blue … 22 °C green … 32 °C red

function planView(ctx, plan, real) {
  const v = s => valueOf(real, s);
  const readAt = farmLocal(new Date().toISOString()).slice(11);
  const wrap = el('div', 'card card-pad fc-card bp');
  const head = el('div', 'fc-head');
  head.append(el('h3', null, `${ctx.farm.name} from above`));
  const wx = el('div', 'bp-weather');
  plan.weather.forEach(([label, s, dp]) => { if (!s) return; const x = v(s); wx.append(el('span', null, `${label} ${x === null ? '—' : x.toFixed(dp)} ${s.unit}`)); });
  // the plan or the site in 3D (0273), chosen on this computer
  const view = pref.get('fbc_fn_view') === 'plan' ? 'plan' : '3d';
  const seg = el('div', 'seg');
  [['3d', '3D'], ['plan', 'Plan']].forEach(([k, label]) => {
    const b = el('button', 'seg-btn', label); b.type = 'button'; b.setAttribute('aria-pressed', String(k === view));
    b.onclick = () => { if (k === view) return; pref.set('fbc_fn_view', k); wrap.replaceWith(planView(ctx, plan, real)); };
    seg.append(b);
  });
  head.append(el('div', 'spacer'), wx, seg);
  wrap.append(head);
  const openBay = n => { const b = plan.bays.find(x => x.n === n); if (b) bayDrawer(ctx, b, real, readAt); };
  if (view === '3d') {
    const v3 = site3d(ctx.farm, ctx.fresh);
    v3.update(plan, real, openBay);
    wrap.append(v3.el, el('div', 'hint bp-legend', 'Drag to turn, scroll or pinch to zoom, right-drag to move. Each bay is tinted by its temperature (blue 12° · green 22° · red 32°), its roof vents bluer the more they are open; click a bay or its label for its details. Roof & walls hides the film to see inside.'));
    return wrap;
  }

  const grid = el('div', 'bp-grid');
  grid.style.gridTemplateColumns = `repeat(${plan.bays.length}, minmax(0, 1fr))`;
  // the zones over their bays: the shade screen and the switched devices
  plan.zones.forEach(z => {
    const first = plan.bays.findIndex(b => b.zone === z);
    if (first < 0) return;
    const zb = el('div', 'bp-zone');
    zb.style.gridColumn = `${first + 1} / span ${z.bays.length}`;
    const shade = v(z.shadeS);
    const on = z.devs.filter(d => (v(d.s) || 0) > 0);
    zb.append(el('b', null, z.fn), el('span', 'bp-chip' + (shade ? ' on' : ''), `Shade ${shade === null ? '—' : Math.round(shade) + ' %'}`));
    if (z.lift) {
      const h = v(z.liftS), c = el('span', 'bp-chip', `Plants ${h === null ? '—' : Math.round(h) + ' %'}`);
      c.title = `${z.lift}${z.liftS ? ` (${z.liftS.path[1]})` : ''}: 0 % at the bottom, 100 % at the top`;
      zb.append(c);
    }
    if (on.length) on.forEach(d => zb.append(el('span', 'bp-chip on', `${d.name} on`)));
    else if (z.devs.length) zb.append(el('span', 'bp-chip', `fans & cooling off`));
    grid.append(zb);
  });
  plan.bays.forEach(b => {
    // the first sensor of the bay that reads, so a silent one does not blank a bay that has others
    const main = b.sensors.find(x => v(x.t) !== null) || b.sensors[0];
    const t = main ? v(main.t) : null, rh = main ? v(main.rh) : null;
    const bay = el('button', 'bp-bay'); bay.type = 'button';
    if (t !== null) { bay.style.setProperty('--h', String(Math.round(hueOf(t)))); bay.classList.add('has-t'); }
    bay.title = `Bay ${b.n}: its details and its last 24 h`;
    // the roof vents on top, each filled as far as it is open
    const vents = el('div', 'bp-vents');
    b.vents.forEach(x => {
      const o = v(x.s);
      const g = el('span', 'bp-vent' + (o ? ' open' : ''));
      g.title = `${x.name}: ${o === null ? 'no reading' : Math.round(o) + ' % open'}`;
      const bar = el('i'); bar.style.setProperty('--open', `${Math.max(0, Math.min(100, o || 0))}%`);
      g.append(bar, el('small', null, o === null ? '—' : `${Math.round(o)}%`));
      vents.append(g);
    });
    bay.append(vents, el('div', 'bp-name', `Bay ${b.n}`), el('div', 'bp-kind', b.kind),
      el('div', 'bp-t', t === null ? '—' : `${t.toFixed(1)}°`),
      el('div', 'bp-rh', rh === null ? (main ? '—' : 'no sensor') : `${Math.round(rh)} % RH`),
      el('div', 'bp-src', main ? (main === b.sensors[0] && b.shared ? `${main.name} · zone` : main.name) : ''));
    // watering when a valve reads open; dry only when every valve reads closed — no reading is not "dry"
    const running = b.valves.filter(x => (v(x.s) || 0) > 0);
    const known = b.valves.length && b.valves.every(x => v(x.s) !== null);
    const water = el('div', 'bp-water' + (running.length ? ' on' : ''));
    water.append(icon('droplet'), el('span', null, running.length ? 'Watering' : known ? 'Dry' : 'No reading'));
    water.title = b.valves.map(x => `${x.name}: ${v(x.s) === null ? 'no reading' : v(x.s) > 0 ? 'open' : 'closed'}`).join(' · ');
    bay.append(water);
    bay.onclick = () => bayDrawer(ctx, b, real, readAt);
    grid.append(bay);
  });
  wrap.append(grid);
  const legend = el('div', 'bp-legend');
  const scale = el('span', 'bp-scale'); scale.append(el('i'), el('small', null, '12°'), el('small', null, '22°'), el('small', null, '32°'));
  legend.append(scale, el('span', 'hint', 'On top of each bay its roof vents, filled as far as they are open · the drop turns blue while the bay is watered · click a bay for its details and its last 24 h. The vines\' vents are assumed two a bay, in order: hover one for its name.'));
  wrap.append(legend);
  return wrap;
}

async function bayDrawer(ctx, b, real, readAt) {
  const v = s => valueOf(real, s);
  const d = drawer(`Bay ${b.n} · ${b.kind}`, `${b.zone ? `FarmNet climate zone ${b.zone.fn} · ` : ''}as read at ${readAt}`);
  const sec = (title, kids) => { const x = el('div', 'fc-params'); x.append(el('div', 'cx-kind-label', title), ...kids); d.body.append(x); };
  const row = (a, b2) => { const r = el('div', 'fc-param'); r.append(el('span', null, a), el('b', null, b2)); return r; };
  const show = s => { const n = v(s); return n === null ? '—' : `${n.toFixed(Math.min(Math.max(s.dec, 0), 2))} ${s.unit}`.trim(); };
  // every sensor says what it reads: "FN_ASM_2 · air and soil sensor"; a combined one lists its air values here and its soil values below
  const air = [];
  b.sensors.forEach(x => {
    const who = x.kind ? `${x.name} · ${x.kind} sensor` : x.name;
    air.push(row(who, `${v(x.t) === null ? '—' : v(x.t).toFixed(1) + ' °C'} · ${v(x.rh) === null ? '—' : Math.round(v(x.rh)) + ' % RH'}`));
    x.air.forEach(s => air.push(row(`${x.name} · ${s.label}`, show(s))));
  });
  if (b.sensors.filter(x => v(x.t) !== null).length > 1) air.push(el('div', 'hint', 'The sensors of one bay hang at different heights, so their air readings differ a little.'));
  sec('Air', b.sensors.length ? air : [el('div', 'hint', 'No sensor is placed in this bay yet.')]);
  b.sensors.filter(x => x.medium.length).forEach(x => sec(`Soil and growing medium · ${x.name}`, x.medium.map(s => row(s.label, show(s)))));
  b.sensors.filter(x => x.device.length).forEach(x => sec(`The sensor itself · ${x.name}`, x.device.map(s => row(s.label, show(s)))));
  sec('Roof vents', b.vents.length ? b.vents.map(x => row(x.name, v(x.s) === null ? '—' : `${Math.round(v(x.s))} % open`)) : [el('div', 'hint', 'None.')]);
  if (b.zone) sec(`Zone ${b.zone.fn}`, [row(`${b.zone.shade} (shade screen)`, v(b.zone.shadeS) === null ? '—' : `at ${Math.round(v(b.zone.shadeS))} %`),
    ...(b.zone.lift ? [row(`${b.zone.lift}${b.zone.liftS ? ` (${b.zone.liftS.path[1]})` : ''}`,
      !b.zone.liftS ? 'not in FarmNet\'s list' : v(b.zone.liftS) === null ? '—' : `${Math.round(v(b.zone.liftS))} % (0 bottom · 100 top)`)] : []),
    ...b.zone.devs.map(x => row(x.name, v(x.s) === null ? '—' : v(x.s) > 0 ? 'on' : 'off'))]);
  sec('Irrigation', b.valves.length ? b.valves.map(x => row(x.name, v(x.s) === null ? '—' : v(x.s) > 0 ? 'watering' : 'closed')) : [el('div', 'hint', 'No valve.')]);
  const srcs = b.sensors.flatMap(x => [x.t, x.rh]).filter(Boolean);
  if (srcs.length) {
    const box = el('div'); box.append(loading('Reading the last 24 h…'));
    d.body.append(box);
    box.replaceChildren(...await history(ctx.farm, srcs, 24 * 60, 2));
  }
}

function liveVals(list, real) {
  const row = el('div', 'cx-vals');
  list.forEach(p => {
    const r = real.find(x => x.id === p.id);
    const n = num(r?.value);
    const s = n === null || NO_SENSOR(n) ? '—' : n.toFixed(Math.min(Math.max(p.dec, 0), 3));
    const v = el('div', 'cx-val');
    v.title = [GROUPS[p.group], ...p.path, p.label].filter(Boolean).join(' › ');
    v.append(el('span', 'cx-v', s), el('span', 'cx-u', s === '—' ? '' : (r?.unit || p.unit)), el('span', 'cx-l', `${p.label} · ${p.path[p.path.length - 1] || ''}`));
    row.append(v);
  });
  return row;
}

// history of the chosen sensors, one chart per unit (℃ together, % together…), at most `charts`
const histMemo = new Map();
async function history(farm, pins, minutes, charts) {
  const byUnit = [];
  pins.forEach(p => { let g = byUnit.find(x => x.unit === p.unit); if (!g) byUnit.push(g = { unit: p.unit, list: [] }); g.list.push(p); });
  const groups = byUnit.filter(g => g.unit).slice(0, charts);
  const span = minutes > 1440 ? `${Math.round(minutes / 1440)} days` : `${Math.round(minutes / 60)} h`;
  return Promise.all(groups.map(async (g, gi) => {
    const ids = g.list.map(p => p.id).join(',');
    const key = `${farm.id}|${ids}|${minutes}`;
    let m = histMemo.get(key);
    if (!m || Date.now() - m.at > 5 * 60000) {                // history moves slowly: asked again after 5 min
      m = { at: Date.now(), p: ask(farm, 'source_history', { srcId: ids, startTime: nowLocal(minutes), endTime: nowLocal(0) }) };
      histMemo.set(key, m);
      m.p.catch(() => histMemo.delete(key));
    }
    let d;
    try { d = await m.p; } catch (e) { return bad(`History (${g.unit}): ${e.message}`); }
    const order = (d?.idList || []).map(x => x.id);
    const rows = d?.dataList || [];
    const series = g.list.map((p, i) => {
      const col = order.indexOf(p.id);
      const pts = col < 0 ? [] : rows.map(r => [fnTime(r[0]), num(r[col + 1])]).filter(([t, v]) => t !== null && v !== null && !NO_SENSOR(v));
      return { name: `${p.label} · ${p.path[p.path.length - 1] || ''}`, colour: colour(i + gi * 3), pts };
    });
    return lineChart(series, {}, `${g.unit} · last ${span}`, Math.min(Math.max(g.list[0].dec, 0), 2));
  }));
}

// a centre's live state (Overview): the valve, the mixers, the disinfection, the tanks, with the commands
function centreLive(ctx, c) {
  const k = card(`${c.name} — fertigation centre`, ...(ctx.may ? centreButtons(ctx, c) : []));
  if (c.status.e) { k.append(bad(c.status.e)); return k; }
  const s = c.status.v || {};
  const grid = el('div', 'fc-units');
  if (s.valve) grid.append(unit(s.valve.name || 'Irrigation', !!s.valve.run, [], null, nextOf(s.valve)));
  (s.fertList || []).forEach(f => grid.append(unit(f.name, !!f.run, f.dataList, ctx.may ? mixerButtons(ctx, c, f) : null, nextOf(f))));
  (s.disiList || []).forEach(d => grid.append(unit(d.name, !!d.run, d.dataList)));
  (s.tankList || []).filter(t => (t.dataList || []).length).forEach(t => grid.append(unit(t.name, undefined, t.dataList)));
  k.append(grid);
  return k;
}
const centreButtons = (ctx, c) => [
  btn('Start a program…', () => startIrrigation(ctx, c)),
  btn('Pause…', () => pause(ctx, c, null)),
  btn('Resume', () => resume(ctx, c, null)),
  btn('Stop the run', () => stop(ctx, c, null), 'btn btn-sm btn-danger')];
const mixerButtons = (ctx, c, f) => [
  btn('Start mixing…', () => startMixing(ctx, c, f)), btn('Pause…', () => pause(ctx, c, f)),
  btn('Resume', () => resume(ctx, c, f)), btn('Stop', () => stop(ctx, c, f), 'btn btn-sm btn-danger')];

// ═══ Irrigation ═════════════════════════════════════════════════════════════
export async function renderFnIrrigation(mount, farm, _app, quiet) {
  const go = () => renderFnIrrigation(mount, farm, null, true);
  await page(mount, farm, 'Irrigation: each centre\'s valve, tanks and disinfection, its programs and its runs.', async (ctx, body) => {
    const { at, seg } = spanPicker('fbc_fn_irr_span', DAY_SPANS, go);
    const cl = await centres(farm);
    const per = await Promise.all(cl.map(c => Promise.all([
      soft(ask(farm, 'irrigation_programs', { id: c.id })),
      soft(ask(farm, 'irrigation_records', { id: c.id, type: 0, ...range(at) })),
    ])));
    if (!cl.length) body.append(el('div', 'note', 'FarmNet lists no fertigation centre.'));
    cl.forEach((c, i) => {
      const [programs, records] = per[i];
      const k = card(`${c.name} — irrigation`, ...(ctx.may ? centreButtons(ctx, c) : []));
      if (c.status.e) k.append(bad(c.status.e));
      const s = c.status.v || {};
      const grid = el('div', 'fc-units');
      if (s.valve) grid.append(unit(s.valve.name || 'Irrigation', !!s.valve.run, [], null, nextOf(s.valve)));
      (s.tankList || []).filter(t => (t.dataList || []).length).forEach(t => grid.append(unit(t.name, undefined, t.dataList)));
      (s.disiList || []).forEach(d => grid.append(unit(d.name, !!d.run, d.dataList)));
      k.append(grid);

      k.append(el('h4', 'fc-sub', 'Programs'));
      if (programs.e) k.append(bad(programs.e));
      else k.append(table(['Program', 'Mode', 'Days', 'Run time', 'Next start'],
        (programs.v || []).map(p => [p.NM, p.MD, p.DT, p.TM, p.NX])));

      const recs = records.v?.record || [];
      const vol = recs.reduce((a, r) => a + (num(r.VLM) || 0), 0);
      const sub = el('div', 'fc-head fc-subhead');
      sub.append(el('h4', 'fc-sub', `Runs · ${recs.length} · ${vol.toFixed(2)} m³`), el('div', 'spacer'), seg);
      k.append(sub);
      if (records.e) k.append(bad(records.e));
      else k.append(table(['Program', 'Mode', 'Start', 'End', 'Volume m³', 'How it ended'],
        recs.slice().sort((a, b) => String(b.ST).localeCompare(String(a.ST))).slice(0, 200).map(r => [r.NM, r.MD, r.ST, r.ET, r.VLM, r.SC]), [4]));
      body.append(k);
    });
  }, { commands: true, quiet });
}

// ═══ Mixing ═════════════════════════════════════════════════════════════════
export async function renderFnMixing(mount, farm, _app, quiet) {
  const go = () => renderFnMixing(mount, farm, null, true);
  await page(mount, farm, 'Mixing: each mixer live, its programs, its runs, and the recipes FarmNet holds.', async (ctx, body) => {
    const { at } = spanPicker('fbc_fn_mix_span', DAY_SPANS, go);
    const cl = await centres(farm);
    const mixers = cl.flatMap(c => (c.status.v?.fertList || []).map(f => ({ c, f })));
    const [per, recipes] = await Promise.all([
      Promise.all(mixers.map(({ c, f }) => Promise.all([
        soft(ask(farm, 'fert_programs', { id: c.id, devId: f.id })),
        soft(ask(farm, 'fert_records', { id: c.id, devId: f.id, ...range(at) })),
      ]))),
      Promise.all(cl.map(c => soft(ask(farm, 'formulas', { id: c.id })))),
    ]);
    cl.filter(c => c.status.e).forEach(c => body.append(bad(`${c.name}: ${c.status.e}`)));
    if (!mixers.length && !cl.some(c => c.status.e)) body.append(el('div', 'note', 'FarmNet lists no mixer.'));
    mixers.forEach(({ c, f }, i) => {
      const [programs, records] = per[i];
      const k = card(`${f.name} — ${c.name}`);
      k.append(unit('Now', !!f.run, f.dataList, ctx.may ? mixerButtons(ctx, c, f) : null, nextOf(f)));
      k.append(el('h4', 'fc-sub', 'Mixing programs'));
      if (programs.e) k.append(bad(programs.e));
      else k.append(table(['Program', 'Mode', 'Recipe', 'Into'], (programs.v || []).map(p => [p.NM, p.MD, p.FNM, p.ST])));
      const recs = records.v?.record || [];
      const vol = recs.reduce((a, r) => a + (num(r.VLM) || 0), 0);
      const sub = el('div', 'fc-head fc-subhead');
      sub.append(el('h4', 'fc-sub', `Runs · ${recs.length} · ${vol.toFixed(2)} m³`), el('div', 'spacer'), spanPicker('fbc_fn_mix_span', DAY_SPANS, go).seg);
      k.append(sub);
      if (records.e) k.append(bad(records.e));
      else k.append(table(['Program', 'Mode', 'Recipe', 'Start', 'End', 'Volume m³', 'How it ended'],
        recs.slice().sort((a, b) => String(b.ST).localeCompare(String(a.ST))).slice(0, 200).map(r => [r.NM, r.MD, r.FNM, r.ST, r.ET, r.VLM, r.SC]), [5]));
      body.append(k);
    });
    cl.forEach((c, i) => {
      const k = card(`Recipes — ${c.name}`);
      if (recipes[i].e) k.append(bad(recipes[i].e));
      else k.append(table(['Recipe', 'What it holds'], (recipes[i].v || []).map(r => [r.NM, String(r.INF || '').replace(/\s+/g, ' ').trim()])));
      k.append(el('div', 'hint', 'Recipes are changed on FarmNet itself.'));
      body.append(k);
    });
  }, { commands: true, quiet });
}

// ═══ Climate ════════════════════════════════════════════════════════════════
export async function renderFnClimate(mount, farm) {
  await page(mount, farm, 'Climate: each zone\'s devices and their state, and the setpoints FarmNet works to.', async (ctx, body) => {
    const zs = await ask(farm, 'zones') || [];
    const st = await Promise.all(zs.map(z => soft(ask(farm, 'climate_status', { id: z.id }))));
    if (!zs.length) body.append(el('div', 'note', 'FarmNet lists no climate zone.'));
    const grid = el('div', 'cx-zones');
    zs.forEach((z, i) => {
      const k = el('div', 'card card-pad cx-zone');
      const head = el('div', 'fc-head');
      head.append(el('h3', null, z.name), el('div', 'spacer'), btn(ctx.may ? 'Setpoints…' : 'Settings…', () => setpoints(ctx, z, st[i].v)));
      k.append(head);
      if (st[i].e) { k.append(bad(st[i].e)); grid.append(k); return; }
      (st[i].v?.typeList || []).forEach(t => {
        const g = el('div', 'cx-kind'); g.append(el('div', 'cx-kind-label', t.typeName));
        const row = el('div', 'fc-devs');
        (t.devList || []).forEach(dv => {
          const on = Number(dv.value) > 0;
          row.append(el('span', 'pill ' + (on ? 'ok' : ''), `${dv.name} ${on ? (Number(dv.value) === 1 ? 'on' : dv.value + '%') : 'off'}`));
        });
        g.append(row); k.append(g);
      });
      grid.append(k);
    });
    body.append(grid);
  }, { commands: true });
}

// ═══ Sensors ════════════════════════════════════════════════════════════════
const SENSOR_SPANS = [[360, '6 h'], [1440, '24 h'], [4320, '3 days']];
let sensorFind = '';   // the search survives the redraw a tick causes
const sensorOpen = new Set(['general']);   // so do the groups left open
export async function renderFnSensors(mount, farm, _app, quiet) {
  const go = () => renderFnSensors(mount, farm, null, true);
  await page(mount, farm, 'Every signal source FarmNet has. Tick up to 8: they are read live here and shown on the Overview (this computer remembers the choice).', async (ctx, body) => {
    const all = await sourcesOf(farm);
    const pins = pinsOf(farm, all);
    const cur = Number(pref.get('fbc_fn_sensor_span') ?? 1440);
    const span = SENSOR_SPANS.some(s => s[0] === cur) ? cur : 1440;
    const [real, charts] = await Promise.all([
      pins.length ? soft(ask(farm, 'source_real', { srcId: pins.map(p => p.id).join(',') })) : Promise.resolve({ v: [] }),
      history(farm, pins, span, 4),
    ]);

    const seg = el('div', 'seg');
    SENSOR_SPANS.forEach(([n, label]) => {
      const b = el('button', 'seg-btn', label); b.type = 'button'; b.setAttribute('aria-pressed', String(n === span));
      b.onclick = () => { if (n === span) return; pref.set('fbc_fn_sensor_span', String(n)); go(); };
      seg.append(b);
    });
    const k = card(`Chosen · ${pins.length} of ${MAX_PINS}`, seg);
    if (!pins.length) k.append(el('div', 'hint', 'Nothing chosen: tick sensors below.'));
    else if (real.e) k.append(bad(real.e));
    else k.append(liveVals(pins, real.v || []));
    charts.forEach(ch => k.append(ch));
    if (pins.some(p => !p.unit)) k.append(el('div', 'hint', 'Sources without a unit (states, switches) are read live but not drawn.'));
    body.append(k);

    // the list, by group and device
    const lc = card(`All sources · ${all.length}`);
    const q = el('input', 'input fn-search'); q.type = 'search'; q.placeholder = 'Find a sensor (name, device, unit)…';
    lc.querySelector('.fc-head').append(q);
    const list = el('div', 'fn-sources');
    const picked = new Set(pins.map(p => p.id));
    const paint = () => {
      list.textContent = '';
      const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hit = s => !words.length || words.every(w => `${GROUPS[s.group]} ${s.path.join(' ')} ${s.label} ${s.unit}`.toLowerCase().includes(w));
      Object.keys(GROUPS).forEach(g => {
        const mine = all.filter(s => s.group === g && hit(s));
        if (!mine.length) return;
        const devs = new Map();
        mine.forEach(s => { const d = s.path.join(' › ') || GROUPS[g]; if (!devs.has(d)) devs.set(d, []); devs.get(d).push(s); });
        const box = el('details', 'fn-group'); box.open = words.length > 0 || sensorOpen.has(g);
        box.ontoggle = () => { if (!words.length) box.open ? sensorOpen.add(g) : sensorOpen.delete(g); };
        box.append(el('summary', null, `${GROUPS[g]} · ${mine.length}`));
        devs.forEach((ss, d) => {
          const dv = el('div', 'fn-dev');
          dv.append(el('div', 'cx-kind-label', d));
          ss.forEach(s => {
            const l = el('label', 'fn-src');
            const c = el('input'); c.type = 'checkbox'; c.checked = picked.has(s.id);
            c.onchange = () => {
              if (c.checked && picked.size >= MAX_PINS) { c.checked = false; toast(`At most ${MAX_PINS}: untick one first`); return; }
              c.checked ? picked.add(s.id) : picked.delete(s.id);
              setPins(farm, [...picked].map(i => all.find(x => x.id === i)).filter(Boolean));
              go();
            };
            l.append(c, el('span', null, s.label), el('span', 'hint', s.unit));
            dv.append(l);
          });
          box.append(dv);
        });
        list.append(box);
      });
      if (!list.childNodes.length) list.append(el('div', 'hint', 'No source matches.'));
    };
    q.value = sensorFind;
    q.oninput = () => { sensorFind = q.value; paint(); };
    paint();
    lc.append(list);
    body.append(lc);
  }, { quiet });
}

// ═══ Alarms ═════════════════════════════════════════════════════════════════
const ALARM_SPANS = [[0, 'Today'], [6, '7 days'], [29, '30 days']];
export async function renderFnAlarms(mount, farm, _app, quiet) {
  const go = () => renderFnAlarms(mount, farm, null, true);
  await page(mount, farm, 'Alarms FarmNet raises now, and the ones it raised before. They are dealt with on FarmNet and at the farm.', async (ctx, body) => {
    const { at, seg } = spanPicker('fbc_fn_alarm_span', ALARM_SPANS, go);
    const [now, past] = await Promise.all([soft(ask(farm, 'alarms_now')), soft(ask(farm, 'alarms_past', range(at)))]);
    const k = card('Now');
    if (now.e) k.append(bad(now.e));
    else if (!(now.v || []).length) k.append(el('span', 'pill ok', 'No alarm on FarmNet'));
    else {
      const box = el('div', 'cx-alarms');
      now.v.forEach(x => {
        const p = el('span', 'cx-alarm');
        p.append(icon('alert'), el('b', null, x.TP || 'Alarm'), el('span', null, ' ' + (x.DES || '')), el('span', 'hint', ` since ${x.STM || '—'}`));
        box.append(p);
      });
      k.append(box);
    }
    body.append(k);
    const list = (past.v || []).slice().sort((a, b) => String(b.STM).localeCompare(String(a.STM)));
    const kinds = {};
    list.forEach(a => { const d = a.DES || a.TP || '—'; kinds[d] = (kinds[d] || 0) + 1; });
    const pc = card(`Before · ${list.length}`, seg);
    if (past.e) pc.append(bad(past.e));
    else {
      const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (top.length) { const row = el('div', 'fc-devs fn-kinds'); top.forEach(([d, n]) => row.append(el('span', 'pill warn', `${d} × ${n}`))); pc.append(row); }
      const dur = a => { const s = fnTime(a.STM), e = fnTime(a.ETM); return s !== null && e !== null && e >= s ? secs(Math.round((e - s) / 1000)) : '—'; };
      pc.append(table(['Kind', 'What', 'Started', 'Ended', 'Lasted'], list.slice(0, 300).map(a => [a.TP, a.DES, a.STM, a.ETM, dur(a)])));
      if (list.length > 300) pc.append(el('div', 'hint', `The newest 300 of ${list.length}.`));
    }
    body.append(pc);
  }, { quiet });
}

// ═══ Commands ═══════════════════════════════════════════════════════════════
export async function renderFnCommands(mount, farm) {
  await page(mount, farm, 'Every command sent to FarmNet from Naked Heart, done or not, with who sent it and FarmNet\'s answer.', async (ctx, body) => {
    const log = await soft(rpc('farmnet_commands', { p_farm: farm.id, p_limit: 200 }, { quiet: true }));
    body.append(logCard(ctx, log, 'Commands sent'));
  });
}

function logCard(ctx, log, title, ...right) {
  const k = card(title, ...right);
  if (log.e) { k.append(bad(log.e)); return k; }
  const rows = log.v || [];
  if (!rows.length) { k.append(el('div', 'hint', 'No command sent to FarmNet from Naked Heart yet.')); return k; }
  const label = a => ctx.actions[a]?.label || a;
  const args = x => {
    const a = x.args || {};
    if (Array.isArray(a.changes)) return a.changes.map(c => `${c.dev} ${c.param} ${c.from}→${c.to}`).join('; ');
    return Object.entries(a).filter(([k]) => k !== 'id').map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  };
  k.append(table(['When', 'Who', 'What', 'Details', 'Answer'], rows.map(x => {
    const ok = el('span');
    ok.append(el('span', 'pill ' + (x.ok ? 'ok' : 'warn'), x.ok ? 'Done' : 'Not done'), el('span', 'hint', ' ' + (x.answer || '')));
    return [nice(x.at), x.by, label(x.action), args(x) || '—', ok];
  })));
  return k;
}

// ═══ Commands to FarmNet ════════════════════════════════════════════════════
async function run(ctx, action, args, changes, okText) {
  try {
    const r = await send(ctx.farm, action, args, changes);
    toast(`${okText} — FarmNet: ${r?.msg || 'OK'}`, 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
  setTimeout(ctx.redraw, 1200);   // FarmNet takes a moment to show the new state
}

async function startIrrigation(ctx, c) {
  const d = drawer('Start an irrigation program', `${c.name} · by hand, now`);
  d.body.append(loading('Reading the programs…'));
  let list;
  try { list = await ask(ctx.farm, 'irrigation_manual', { id: c.id }) || []; } catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  if (!list.length) { d.body.append(el('div', 'note', 'FarmNet lists no program to start by hand.')); return; }
  const what = p => (p.SRC || []).map(s => `${s.NM}${s.FNM && s.FNM !== 'None' ? ' (' + s.FNM + ')' : ''}: ` +
    (s.VALVE || []).map(v => `${v.NM} ${secs(v.ATM ?? v.STM)}`).join(', ')).join(' · ');
  const sel = selectBox(list.map(p => [String(p.ID), p.NM]), String(list[0].ID));
  const info = el('div', 'hint');
  const paint = () => { info.textContent = what(list.find(p => String(p.ID) === sel.value) || {}); };
  sel.onchange = paint; paint();
  d.body.append(field('Program', sel), info);
  const go = el('button', 'btn btn-primary', 'Start…');
  go.onclick = async () => {
    if (go.disabled) return; go.disabled = true;
    const p = list.find(x => String(x.ID) === sel.value);
    if (!(await confirmDrawer('Start this program now?', `"${p.NM}" starts on ${c.name} at once — ${what(p)}.`, 'Start it'))) { go.disabled = false; return; }
    busy(go, true, 'Sending…');
    await run(ctx, 'irrigation_program_start', { id: c.id, proId: p.ID }, null, `Started "${p.NM}"`);
    d.close();
  };
  d.footer.append(go);
}

async function startMixing(ctx, c, f) {
  const d = drawer('Start a mixing program', `${c.name} · ${f.name} · by hand, now`);
  d.body.append(loading('Reading the programs…'));
  let list;
  try { list = await ask(ctx.farm, 'fert_manual', { id: c.id, devId: f.id }) || []; } catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  if (!list.length) { d.body.append(el('div', 'note', 'FarmNet lists no mixing program for this mixer.')); return; }
  const sel = selectBox(list.map(p => [String(p.ID), `${p.NM} — recipe ${p.FNM || 'none'} → ${p.TNM || '—'}`]), String(list[0].ID));
  const mins = el('input', 'input'); mins.type = 'number'; mins.min = '1'; mins.max = '1440'; mins.step = '1'; mins.value = '10';
  d.body.append(field('Program', sel), field('Run time (minutes)', mins, 'Sent to FarmNet in seconds.'));
  const go = el('button', 'btn btn-primary', 'Start…');
  go.onclick = async () => {
    if (go.disabled) return;
    const p = list.find(x => String(x.ID) === sel.value), m = Math.round(Number(mins.value));
    if (!(m >= 1 && m <= 1440)) { toast('Run time: 1 to 1440 minutes', 'bad'); return; }
    go.disabled = true;
    if (!(await confirmDrawer('Start mixing now?', `"${p.NM}" starts on ${f.name} for ${m} min.`, 'Start it'))) { go.disabled = false; return; }
    busy(go, true, 'Sending…');
    await run(ctx, 'fert_program_start', { id: c.id, proId: p.ID, runTime: m * 60 }, null, `Started "${p.NM}"`);
    d.close();
  };
  d.footer.append(go);
}

function pause(ctx, c, f) {
  const what = f ? `mixing on ${f.name}` : `irrigation on ${c.name}`;
  const d = drawer('Pause ' + (f ? 'mixing' : 'irrigation'), what);
  const mins = el('input', 'input'); mins.type = 'number'; mins.min = '1'; mins.max = '1440'; mins.step = '1'; mins.value = '30';
  d.body.append(field('For how long (minutes)', mins, 'It resumes by itself after this, or with Resume.'));
  const go = el('button', 'btn btn-primary', 'Pause…');
  go.onclick = async () => {
    if (go.disabled) return;
    const m = Math.round(Number(mins.value));
    if (!(m >= 1 && m <= 1440)) { toast('1 to 1440 minutes', 'bad'); return; }
    go.disabled = true;
    if (!(await confirmDrawer('Pause now?', `Pause ${what} for ${m} min.`, 'Pause'))) { go.disabled = false; return; }
    busy(go, true, 'Sending…');
    await (f ? run(ctx, 'fert_pause', { id: c.id, devId: f.id, pTime: m * 60 }, null, 'Paused')
             : run(ctx, 'irrigation_pause', { id: c.id, pTime: m * 60 }, null, 'Paused'));
    d.close();
  };
  d.footer.append(go);
}

async function resume(ctx, c, f) {
  const what = f ? `mixing on ${f.name}` : `irrigation on ${c.name}`;
  if (!(await confirmDrawer('Resume now?', `Resume ${what}.`, 'Resume'))) return;
  await (f ? run(ctx, 'fert_pause', { id: c.id, devId: f.id, pTime: 0 }, null, 'Resumed')
           : run(ctx, 'irrigation_pause', { id: c.id, pTime: 0 }, null, 'Resumed'));
}

async function stop(ctx, c, f) {
  const what = f ? `the mixing that runs on ${f.name}` : `the irrigation that runs on ${c.name}`;
  if (!(await confirmDrawer('Stop the current run?', `Stop ${what} now. The programs stay as they are and start again at their next time.`, 'Stop it', true))) return;
  await (f ? run(ctx, 'fert_stop', { id: c.id, devId: f.id, type: 0 }, null, 'Stopped')
           : run(ctx, 'irrigation_stop', { id: c.id, type: 0 }, null, 'Stopped'));
}

async function setpoints(ctx, z, st) {
  const types = (st?.typeList || []).map(t => [String(t.typeId), t.typeName]);
  const d = drawer(ctx.may ? 'Climate setpoints' : 'Climate settings', `${z.name} · as FarmNet holds them`);
  if (!types.length) { d.body.append(el('div', 'note', 'FarmNet lists no device in this zone.')); return; }
  const sel = selectBox(types, types[0][0]);
  const box = el('div');
  d.body.append(field('Device type', sel), box);
  // inputs belong to the device type that was read last: a quick second choice must not mix two trees
  let tree = [], inputs = [], typeId = null, seq = 0;
  const load = async () => {
    const mine = ++seq, t = Number(sel.value);
    box.textContent = ''; box.append(loading('Reading the parameters…'));
    inputs = []; typeId = null;
    let got;
    try { got = (await ask(ctx.farm, 'climate_params', { ghId: z.id, typeId: t }))?.funList || []; }
    catch (e) { if (mine === seq) { box.textContent = ''; box.append(bad(e.message)); } return; }
    if (mine !== seq) return;
    tree = got; typeId = t;
    box.textContent = '';
    tree.forEach(fun => (fun.devList || []).forEach(dev => {
      const ps = (dev.paramList || []).filter(p => p.SF !== 0);
      if (!ps.length) return;
      const sec = el('div', 'fc-params');
      sec.append(el('div', 'cx-kind-label', `${dev.name} · ${fun.name}`));
      ps.forEach(p => {
        const row = el('div', 'fc-param');
        row.append(el('span', null, p.N));
        const editable = ctx.may && p.EEN !== false;
        if (!editable) {
          const opt = (p.CLT || []).find(o => String(o.V) === String(num(p.V)));
          row.append(el('b', null, opt ? opt.N : show(p.V, p.U)));
        } else if ((p.CLT || []).length) {
          const s = selectBox(p.CLT.map(o => [String(o.V), o.N]), String(num(p.V)));
          inputs.push({ fun, dev, p, read: () => Number(s.value) });
          row.append(s);
        } else {
          const i = el('input', 'input'); i.type = 'number';
          i.value = String(num(p.V) ?? ''); if (num(p.L) !== null) i.min = String(num(p.L)); if (num(p.H) !== null) i.max = String(num(p.H));
          i.step = Number.isInteger(p.D) && p.D > 0 ? String(10 ** -p.D) : '1';
          const u = el('span', 'hint', `${p.U || ''} (${num(p.L) ?? '…'} – ${num(p.H) ?? '…'})`);
          inputs.push({ fun, dev, p, read: () => (i.value.trim() === '' ? num(p.V) : Number(i.value)) });   // emptied = unchanged, not 0
          row.append(i, u);
        }
        sec.append(row);
      });
      box.append(sec);
    }));
    if (!box.childNodes.length) box.append(el('div', 'hint', 'No parameter shown for this device type.'));
  };
  sel.onchange = load;
  await load();
  if (!ctx.may) return;
  const save = el('button', 'btn btn-primary', 'Save…');
  save.onclick = async () => {
    if (save.disabled) return;
    if (typeId === null) { toast('The parameters are still being read'); return; }
    const changes = inputs.filter(x => Number.isFinite(x.read()) && x.read() !== num(x.p.V))
      .map(x => ({ funId: x.fun.id, devId: x.dev.id, param: x.p.N, value: x.read(), from: num(x.p.V), unit: x.p.U || '', dev: x.dev.name }));
    if (!changes.length) { toast('Nothing changed'); return; }
    // the limits are FarmNet's own (L … H); the function checks them again before sending
    const out = inputs.find(x => changes.some(c => c.param === x.p.N && c.devId === x.dev.id && c.funId === x.fun.id)
      && ((num(x.p.L) !== null && x.read() < num(x.p.L)) || (num(x.p.H) !== null && x.read() > num(x.p.H))));
    if (out) { toast(`${out.p.N} must be between ${num(out.p.L)} and ${num(out.p.H)}`, 'bad'); return; }
    const list = changes.map(c => `${c.dev} ${c.param}: ${c.from} → ${c.value} ${c.unit}`.trim()).join(' · ');
    save.disabled = true;
    const sentType = typeId;
    if (!(await confirmDrawer(`Change ${changes.length} setpoint${changes.length === 1 ? '' : 's'} on FarmNet?`, `${z.name} — ${list}`, 'Change them'))) { save.disabled = false; return; }
    busy(save, true, 'Sending…');
    await run(ctx, 'climate_set', { ghId: z.id, typeId: sentType },
      changes.map(({ funId, devId, param, value }) => ({ funId, devId, param, value })), `${changes.length} setpoint${changes.length === 1 ? '' : 's'} changed`);
    d.close();
  };
  d.footer.append(save);
}
