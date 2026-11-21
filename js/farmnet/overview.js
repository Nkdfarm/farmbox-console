// FarmNet Overview: the plan view, bay window, live values, history, centre and mixer buttons
import { lineChart } from '../connect.js';
import { site3d } from '../farmnet3d.js';
import { el, drawer, icon, loading, farmLocal, pref } from '../ui.js';
import { pause, resume, startIrrigation, startMixing, stop } from './commands.js';
import { tagCmd } from '../registry.js';
import { logCard } from './sensors.js';
import { GROUPS, NO_SENSOR, ask, bad, btn, card, centres, colour, commandLog, isReplay, fnTime, link, nextOf, nowLocal, num, page, pinsOf, range, short, show, soft, sourcesOf, unit } from './shell.js';

// ═══ Overview ═══════════════════════════════════════════════════════════════
export async function renderFnOverview(mount, farm) {
  await page(mount, farm, 'FarmNet at a glance, live.', async (ctx, body) => {
    const today = range(0);
    const [cs, zones, alarms, log, src] = await Promise.all([
      soft(centres(farm)), soft(ask(farm, 'zones')), soft(ask(farm, 'alarms_now')),
      soft(commandLog(farm, 5)), soft(sourcesOf(farm)),
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
// and medium sensor asm2 and eth31 only air sensor". Corrected 21 Nov 2026 from FarmNet's own readings: FN_ASM_1 and FN_ASM_2
// ("Soil Humid. %") both rise 1–9 min after every Strawberry vegetative run (17–20 Nov) and not at the tomato runs, so both
// are in Bay 8 (plan-irrigation-windows-2026-11-21); the vines have FN_ETH_31 only (air). The vines' six vents are still
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
    sensors: { 1: ['FN_ETH_32'], 2: ['FN_ETH_32'], 3: ['FN_ETH_32'], 4: ['FN_ETH_32'], 5: ['FN_ETH_31'], 6: ['FN_ETH_31'], 7: ['FN_ETH_31'], 8: ['FN_ETH_33', 'FN_ASM_1', 'FN_ASM_2'] },
    // the sensors that also read the growing medium: of the rest of their values, light and CO2 are the air's, battery and signal the sensor's own, the others the medium's
    medium: ['FN_ASM_1', 'FN_ASM_2'],
    // what each sensor reads (owner, 5 and 8 Nov: "asm2 air and soil, eth31 air", "eth33 air", "eth2 air"). They hang at different heights, so two in one bay read a little apart
    kinds: { FN_ETH_31: 'air', FN_ETH_32: 'air', FN_ETH_33: 'air', FN_ASM_1: 'air and soil', FN_ASM_2: 'air and soil' },
    valves: { 1: ['EBB 1A', 'EBB 1B'], 2: ['NFT Bay234'], 3: ['NFT Bay234'], 4: ['NFT Bay234'], 5: ['Bay 5'], 6: ['Bay 6'], 7: ['Bay 7'], 8: ['Bay 8'] },
  },
};

// the bays a sensor of the plan is in (FarmNet › Windows offers Bay 8's substrate moisture to Auto): [] when not on it
export const baysOfSensor = (code, name) => Object.entries(PLANS[code]?.sensors || {}).filter(([, l]) => l.includes(name)).map(([n]) => Number(n));

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

export function liveVals(list, real) {
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
export async function history(farm, pins, minutes, charts) {
  const byUnit = [];
  pins.forEach(p => { let g = byUnit.find(x => x.unit === p.unit); if (!g) byUnit.push(g = { unit: p.unit, list: [] }); g.list.push(p); });
  const groups = byUnit.filter(g => g.unit).slice(0, charts);
  const span = minutes > 1440 ? `${Math.round(minutes / 1440)} days` : `${Math.round(minutes / 60)} h`;
  return Promise.all(groups.map(async (g, gi) => {
    const ids = g.list.map(p => p.id).join(',');
    const key = `${farm.id}|${ids}|${minutes}`;
    let m = histMemo.get(key);
    if (isReplay()) m = { at: 0, p: ask(farm, 'source_history', { srcId: ids, startTime: nowLocal(minutes), endTime: nowLocal(0) }) };   // the kept copy: never memoised
    else if (!m || Date.now() - m.at > 5 * 60000) {           // history moves slowly: asked again after 5 min
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
// each button carries its registry command (data-cmd: where the replay of an AI build finds it, P5)
export const centreButtons = (ctx, c) => [
  tagCmd(btn('Start a program…', () => startIrrigation(ctx, c)), 'irrigation_program_start'),
  tagCmd(btn('Pause…', () => pause(ctx, c, null)), 'irrigation_pause'),
  tagCmd(btn('Resume', () => resume(ctx, c, null)), 'irrigation_resume'),
  tagCmd(btn('Stop the run', () => stop(ctx, c, null), 'btn btn-sm btn-danger'), 'irrigation_stop')];
export const mixerButtons = (ctx, c, f) => [
  tagCmd(btn('Start mixing…', () => startMixing(ctx, c, f)), 'fert_program_start'), tagCmd(btn('Pause…', () => pause(ctx, c, f)), 'fert_pause'),
  tagCmd(btn('Resume', () => resume(ctx, c, f)), 'fert_resume'), tagCmd(btn('Stop', () => stop(ctx, c, f), 'btn btn-sm btn-danger'), 'fert_stop')];
