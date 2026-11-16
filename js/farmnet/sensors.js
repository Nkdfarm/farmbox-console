// FarmNet Sensors and Alarms pages, the Commands page, the command log card
import { rpc } from '../api.js';
import { el, toast, icon, pref, emptyState } from '../ui.js';
import { history, liveVals } from './overview.js';
import { GROUPS, MAX_PINS, ask, bad, card, fnTime, nice, page, pinsOf, range, secs, setPins, soft, sourcesOf, spanPicker, table } from './shell.js';

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
      if (!list.childNodes.length) list.append(emptyState('No source matches.'));
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

export function logCard(ctx, log, title, ...right) {
  const k = card(title, ...right);
  if (log.e) { k.append(bad(log.e)); return k; }
  const rows = log.v || [];
  if (!rows.length) { k.append(emptyState('No command sent to FarmNet from Naked Heart yet.')); return k; }
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
