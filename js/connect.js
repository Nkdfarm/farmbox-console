// ═══════════════════════════════════════════════════════════════════════════
// Connections — FarmNet, sensors and cameras (migration 0130, console 0.7.142)
//
// Five pages, all fed by the `ingest` endpoint (a device's key in X-Device-Key):
//   FarmNet & sensors  the latest of every metric per zone (ok · watch · alarm
//                      against the limits), the curves, the irrigation cycles,
//                      the open alarms. Read only: nothing is sent to FarmNet.
//   Heat map           minutes of people per area and hour from the fixed
//                      cameras, against the task minutes planned there — counts
//                      only, never who (POPIA).
//   Crop growth        each position's latest camera estimate (stage, canopy,
//                      days to harvest, kg) against the plan; Apply makes it a
//                      phase observation that moves the batch, Dismiss drops it.
//   Counting           plants, heads, fruit, flowers and gaps per position.
//   Devices & API      the register, the keys (shown once), the limits and how
//                      to send data.
// Until a device sends something every page says how to connect one.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast, rpc, URL_BASE } from './api.js';
import { loading, el, pageHead, drawer, field, selectBox, toast, busy, confirmDrawer, cropAvatar, pref, icon, farmDate } from './ui.js';

const nice = s => s ? new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const niceDay = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => { const t = farmDate(); return ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n)); };
const ago = s => {
  if (!s) return 'never';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const fmt = (v, dp = 1) => v == null ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const ZONE_HUES = [205, 145, 28, 285, 350, 55, 180, 320];
const KINDS = [['climate', 'Climate'], ['water', 'Water'], ['irrigation', 'Irrigation'], ['substrate', 'Slab'],
               ['light', 'Light'], ['dosing', 'Dosing'], ['outside', 'Outside']];

// the same open-fast load for every page
function loader(mount, reads, paint, words) {
  const here = mount;
  const my = String(Number(mount.dataset.load || 0) + 1);   // 24 h then 30 days clicked quickly: only the last one draws
  mount.dataset.load = my;
  return openFast(reads, {
    show: d => paint(d),
    waiting: () => { mount.textContent = ''; mount.append(loading(words)); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && here.dataset.load === my,
  });
}

// what every page says before any device has sent anything
function notConnected(what, lists) {
  const box = el('div', 'card card-pad cx-empty');
  box.append(el('h3', null, `No ${what} yet`));
  box.append(el('p', 'hint', 'This page fills itself as soon as a device sends data. Three steps:'));
  const ol = el('ol');
  ol.append(el('li', null, 'Register the device on Connections › Devices & API (controller, sensor, gateway or camera) and place it in a zone, bay or area.'),
            el('li', null, 'Press New key and give the key to whoever connects it (the FarmNet or camera integration). It is shown once.'),
            el('li', null, `The device posts to the ingest endpoint — ${lists}. Nothing is ever sent back to the device.`));
  box.append(ol);
  const a = el('a', 'btn btn-sm', 'Open Devices & API'); a.href = '#/connect/devices';
  box.append(a);
  return box;
}

// ── FarmNet & sensors ────────────────────────────────────────────────────────
const HOURS = [[24, '24 h'], [72, '3 days'], [168, '7 days'], [720, '30 days']];
let fnMetric = null;

export async function renderFarmnet(mount, farm) {
  const hours = Number(pref.get('fbc_fn_hours')) || 24;
  await loader(mount, [['farmnet_dashboard', { p_farm: farm.id, p_hours: hours }]], ([d]) => paintFarmnet(mount, farm, d, hours), 'Reading FarmNet and the sensors…');
}

function paintFarmnet(mount, farm, d, hours) {
  mount.textContent = '';
  const seg = el('div', 'seg');
  HOURS.forEach(([h, label]) => {
    const b = el('button', 'seg-btn', label); b.setAttribute('aria-pressed', String(h === hours));
    b.onclick = () => { pref.set('fbc_fn_hours', String(h)); renderFarmnet(mount, farm); };
    seg.append(b);
  });
  const status = el('span', 'hint', d.devices ? `${d.devices} device${d.devices === 1 ? '' : 's'} · last data ${ago(d.last_seen_at)}` : '');
  mount.append(pageHead(null, 'Climate, water, irrigation and slab readings from FarmNet and the sensors, zone by zone, judged against the limits. ' +
    'Read only: the platform never changes a setpoint on FarmNet.', status, seg));

  const latest = d.latest || [];
  if (!latest.length && !(d.irrigation || []).length) {
    mount.append(notConnected('readings', 'the "readings" and "irrigation" lists'));
    return;
  }
  const metrics = new Map((d.metrics || []).map(m => [m.code, m]));
  const zones = [...(d.zones || [])];
  if (latest.some(l => !l.zone_id)) zones.push({ id: null, name: 'Whole farm', code: '' });

  // alarms first
  if ((d.alarms || []).length) {
    const al = el('div', 'cx-alarms');
    d.alarms.forEach(a => {
      const x = el('a', 'cx-alarm'); x.href = '#/dashboard/issues';
      x.append(icon('alert'), el('b', null, a.title), el('span', 'hint', ` ${ago(a.created_at)}`));
      x.title = a.detail || '';
      al.append(x);
    });
    mount.append(al);
  }

  // one card per zone: every metric's latest value, coloured by its state
  const grid = el('div', 'cx-zones');
  zones.forEach(z => {
    const mine = latest.filter(l => (l.zone_id || null) === (z.id || null));
    if (!mine.length) return;
    const card = el('div', 'card card-pad cx-zone');
    card.append(el('h3', null, z.name));
    KINDS.forEach(([kind, label]) => {
      const ls = mine.filter(l => metrics.get(l.metric)?.kind === kind)
        .sort((a, b) => (metrics.get(a.metric)?.sort || 0) - (metrics.get(b.metric)?.sort || 0));
      if (!ls.length) return;
      const g = el('div', 'cx-kind'); g.append(el('div', 'cx-kind-label', label));
      const row = el('div', 'cx-vals');
      ls.forEach(l => {
        const m = metrics.get(l.metric) || {};
        const v = el('button', 'cx-val ' + (l.state || 'ok'));
        v.type = 'button';
        v.append(el('span', 'cx-v', `${fmt(l.value, m.decimals ?? 1)}`), el('span', 'cx-u', m.unit || ''), el('span', 'cx-l', m.label || l.metric));
        const lim = l.limits || {};
        v.title = `${m.label}: ${fmt(l.value, m.decimals ?? 1)} ${m.unit || ''} · ${ago(l.at)}` +
          `\nwatch ${lim.low_watch ?? '—'} – ${lim.high_watch ?? '—'} · alarm ${lim.low_alarm ?? '—'} – ${lim.high_alarm ?? '—'}`;
        v.onclick = () => { fnMetric = l.metric; paintChart(); chartBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
        row.append(v);
      });
      g.append(row); card.append(g);
    });
    const newest = mine.reduce((a, l) => (!a || l.at > a ? l.at : a), null);
    card.append(el('div', 'hint', `last reading ${ago(newest)}`));
    grid.append(card);
  });
  mount.append(grid);

  // the curves: one metric at a time, one line per zone, the watch band shaded
  const withData = [...new Set((d.series || []).map(s => s.metric))];
  if (!fnMetric || !withData.includes(fnMetric)) fnMetric = withData.includes('ec') ? 'ec' : withData[0];
  const chartBox = el('div', 'card card-pad cx-chart-card');
  const paintChart = () => {
    chartBox.textContent = '';
    const chips = el('div', 'cx-chips');
    withData.forEach(code => {
      const m = metrics.get(code) || { label: code };
      const b = el('button', 'chip' + (code === fnMetric ? ' on' : ''), m.label);
      b.onclick = () => { fnMetric = code; paintChart(); };
      chips.append(b);
    });
    chartBox.append(chips);
    const m = metrics.get(fnMetric) || {};
    const lines = (d.series || []).filter(s => s.metric === fnMetric);
    const lim = (latest.find(l => l.metric === fnMetric) || {}).limits || {};
    chartBox.append(lineChart(lines.map((s, i) => ({
      name: (zones.find(z => (z.id || null) === (s.zone_id || null)) || {}).name || 'Whole farm',
      colour: `hsl(${ZONE_HUES[i % ZONE_HUES.length]} 60% 52%)`,
      pts: (s.pts || []).map(([t, v]) => [new Date(t).getTime(), Number(v)]),
    })), lim, `${m.label || fnMetric}${m.unit ? ' · ' + m.unit : ''}`, m.decimals ?? 1));
  };
  if (withData.length) { paintChart(); mount.append(chartBox); }

  // the irrigation cycles of the window
  if ((d.irrigation || []).length) {
    const card = el('div', 'card card-pad');
    card.append(el('div', 'sec-title', `Irrigation cycles · ${d.irrigation.length}`));
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Started</th><th>Zone</th><th>Cycle</th><th class="num">Litres</th><th class="num">EC</th><th class="num">pH</th><th class="num">Drain %</th><th class="num">Drain EC</th></tr></thead>';
    const tb = el('tbody');
    d.irrigation.slice(0, 200).forEach(ie => {
      const tr = el('tr');
      [nice(ie.started_at), (zones.find(z => z.id === ie.zone_id) || {}).name || ie.system || '—', ie.cycle || '—',
       fmt(ie.volume_l, 0), fmt(ie.ec, 2), fmt(ie.ph, 2), fmt(ie.drain_pct, 0), fmt(ie.drain_ec, 2)]
        .forEach((v, i) => tr.append(el('td', i >= 3 ? 'num' : null, v)));
      tb.append(tr);
    });
    t.append(tb); card.append(t); mount.append(card);
  }
}

// a small line chart: several series on one time axis, the watch band and the alarm lines
function lineChart(series, lim, title, dp) {
  const W = 900, H = 260, L = 48, R = 12, T = 16, B = 28;
  const all = series.flatMap(s => s.pts);
  const box = el('div', 'cx-chart');
  box.append(el('div', 'cx-chart-title', title));
  if (!all.length) { box.append(el('div', 'hint', 'No readings in this window.')); return box; }
  const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
  const vals = all.map(p => p[1]).concat([lim.low_watch, lim.high_watch].filter(v => v != null).map(Number));
  let v0 = Math.min(...vals), v1 = Math.max(...vals);
  if (v0 === v1) { v0 -= 1; v1 += 1; }
  const pad = (v1 - v0) * 0.08; const floor0 = v0 >= 0; v0 -= pad; v1 += pad; if (floor0) v0 = Math.max(0, v0);
  const x = t => L + (W - L - R) * ((t - t0) / Math.max(t1 - t0, 1));
  const y = v => T + (H - T - B) * (1 - (v - v0) / (v1 - v0));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'cx-svg');
  const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); svg.append(n); return n; };
  if (lim.low_watch != null && lim.high_watch != null) {
    add('rect', { x: L, y: y(Math.min(Number(lim.high_watch), v1)), width: W - L - R,
                  height: Math.max(0, y(Math.max(Number(lim.low_watch), v0)) - y(Math.min(Number(lim.high_watch), v1))), class: 'cx-band' });
  }
  [lim.low_alarm, lim.high_alarm].filter(v => v != null && Number(v) > v0 && Number(v) < v1)
    .forEach(v => add('line', { x1: L, x2: W - R, y1: y(Number(v)), y2: y(Number(v)), class: 'cx-alarm-line' }));
  for (let i = 0; i <= 4; i++) {
    const v = v0 + (v1 - v0) * i / 4;
    add('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'cx-grid' });
    const tx = add('text', { x: L - 6, y: y(v) + 4, class: 'cx-axis', 'text-anchor': 'end' }); tx.textContent = fmt(v, dp);
  }
  for (let i = 0; i <= 4; i++) {
    const t = t0 + (t1 - t0) * i / 4;
    const tx = add('text', { x: x(t), y: H - 8, class: 'cx-axis', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' });
    tx.textContent = new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  series.forEach(s => {
    if (!s.pts.length) return;
    add('path', { d: s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''), stroke: s.colour, class: 'cx-line' });
  });
  box.append(svg);
  const leg = el('div', 'cx-legend');
  series.forEach(s => { const it = el('span'); const sw = el('i'); sw.style.background = s.colour; it.append(sw, s.name); leg.append(it); });
  if (lim.low_watch != null) leg.append(el('span', 'hint', 'shaded: the watch range · dashed: alarm'));
  box.append(leg);
  return box;
}

// ── Heat map ─────────────────────────────────────────────────────────────────
const HM_SPANS = [[0, 'Today'], [6, '7 days'], [29, '30 days']];
export async function renderHeatmap(mount, farm) {
  const back = Number(pref.get('fbc_hm_span') ?? 6);
  await loader(mount, [['camera_heatmap', { p_farm: farm.id, p_from: daysAgo(back), p_to: daysAgo(0) }]], ([d]) => paintHeatmap(mount, farm, d, back), 'Reading the cameras…');
}
function paintHeatmap(mount, farm, d, back) {
  mount.textContent = '';
  const seg = el('div', 'seg');
  HM_SPANS.forEach(([n, label]) => {
    const b = el('button', 'seg-btn', label); b.setAttribute('aria-pressed', String(n === back));
    b.onclick = () => { pref.set('fbc_hm_span', String(n)); renderHeatmap(mount, farm); };
    seg.append(b);
  });
  mount.append(pageHead(null, 'Where time goes, from the fixed cameras: minutes of people per area and hour, against the task minutes planned there. ' +
    'Counts only — the cameras never say who (POPIA; staff are told the cameras count presence).', el('span', 'hint', d.cameras ? `${d.cameras} camera${d.cameras === 1 ? '' : 's'} · last ${ago(d.last_seen_at)}` : ''), seg));
  const areas = d.areas || [];
  if (!areas.length) { mount.append(notConnected('camera presence', 'the "presence" list: people minutes per area and 15-minute slot')); return; }

  // per area: seen against planned
  const card = el('div', 'card card-pad');
  card.append(el('div', 'sec-title', 'Per area · hours seen against hours planned'));
  const max = Math.max(1, ...areas.map(a => Math.max(Number(a.minutes), Number(a.planned || 0))));
  const list = el('div', 'hm-areas');
  areas.forEach(a => {
    const r = el('div', 'hm-area');
    const bars = el('div', 'hm-bars');
    const seen = el('i', 'seen'); seen.style.width = (100 * a.minutes / max) + '%';
    const plan = el('i', 'plan'); plan.style.width = (100 * (a.planned || 0) / max) + '%';
    bars.append(seen, plan);
    const ratio = a.planned ? Math.round(100 * a.minutes / a.planned) : null;
    r.append(el('b', null, a.name), bars,
             el('span', 'hint', `${fmt(a.minutes / 60, 1)} h seen · ${fmt((a.planned || 0) / 60, 1)} h planned` + (ratio != null ? ` · ${ratio}%` : '')));
    list.append(r);
  });
  card.append(list, el('div', 'hint', 'Blue: seen by the cameras · grey: the minutes of the tasks planned in that area.'));
  mount.append(card);

  // day × hour and area × hour
  const hours = [...new Set((d.grid || []).map(g => g.h))].sort((a, b) => a - b);
  const h0 = Math.min(6, ...hours), h1 = Math.max(18, ...hours);
  const heat = (rows, keyOf, label) => {
    const c = el('div', 'card card-pad');
    c.append(el('div', 'sec-title', label));
    const peak = Math.max(1, ...rows.map(r => Number(r.minutes)));
    const keys = [...new Set(rows.map(keyOf))];
    const t = el('table', 'hm-grid');
    const head = el('tr'); head.append(el('th'));
    for (let h = h0; h <= h1; h++) head.append(el('th', null, String(h).padStart(2, '0')));
    t.append(head);
    keys.forEach(k => {
      const tr = el('tr'); tr.append(el('th', 'hm-row', k));
      for (let h = h0; h <= h1; h++) {
        const m = rows.filter(r => keyOf(r) === k && r.h === h).reduce((a, r) => a + Number(r.minutes), 0);
        const td = el('td'); td.style.setProperty('--a', (m / peak).toFixed(3));
        td.title = `${k} · ${String(h).padStart(2, '0')}:00 · ${fmt(m, 0)} person-minutes`;
        tr.append(td);
      }
      t.append(tr);
    });
    c.append(t);
    return c;
  };
  mount.append(heat(d.grid || [], g => niceDay(g.d), 'Day by hour'), heat(d.area_hours || [], g => g.name, 'Area by hour'));
}

// ── Crop growth ──────────────────────────────────────────────────────────────
export async function renderGrowth(mount, farm) {
  await loader(mount, [['camera_growth_view', { p_farm: farm.id }]], ([d]) => paintGrowth(mount, farm, d), 'Reading the growth estimates…');
}
function paintGrowth(mount, farm, d) {
  mount.textContent = '';
  mount.append(pageHead(null, 'What the fixed cameras see of each batch — stage, canopy, height, days to harvest and kg — against the plan. ' +
    'An estimate is a proposal: Apply turns it into a phase observation that moves the batch\'s harvest and its tasks; Dismiss drops it.',
    el('span', 'hint', d.cameras ? `${d.cameras} camera${d.cameras === 1 ? '' : 's'} · last ${ago(d.last_seen_at)}` : '')));
  const rows = d.latest || [];
  if (!rows.length) { mount.append(notConnected('growth estimates', 'the "growth" list, one estimate per position')); return; }
  const hist = new Map();
  (d.history || []).forEach(h => { if (!hist.has(h.position_id)) hist.set(h.position_id, []); hist.get(h.position_id).push(h); });
  const pending = rows.filter(r => r.status === 'new' && r.plan_id && r.shift_days != null && Math.abs(r.shift_days) >= 2);
  mount.append(el('div', 'tiles cx-tiles'));
  const tiles = mount.lastChild;
  const tile = (v, l, s) => { const t = el('div', 'tile'); const b = el('div', 'tile-body'); b.append(el('div', 'tile-value', v), el('div', 'tile-label', l)); if (s) b.append(el('div', 'tile-sub', s)); t.append(b); return t; };
  tiles.append(tile(String(rows.length), 'Positions seen', 'in the last three weeks'),
               tile(String(pending.length), 'To decide', 'the camera differs from the plan by 2 days or more'),
               tile(String(rows.filter(r => r.status === 'applied').length), 'Applied'));
  const list = el('div', 'cx-growth');
  rows.forEach(r => {
    const card = el('div', 'card card-pad cx-g');
    const head = el('div', 'row');
    if (r.crop) head.append(cropAvatar({ name: r.crop, category: r.category, photo_url: r.photo_url }, 'sm'));
    const name = el('div'); name.append(el('b', null, r.crop || 'No batch here'), el('div', 'hint', [r.zone, r.system, r.position].filter(Boolean).join(' · ')));
    head.append(name, el('div', 'spacer'), el('span', 'pill ' + (r.status === 'applied' ? 'ok' : r.status === 'dismissed' ? '' : 'info'), r.status === 'new' ? 'estimate' : r.status));
    card.append(head);
    const facts = el('div', 'cx-facts');
    const fact = (l, v) => { const f = el('div'); f.append(el('span', 'hint', l), el('b', null, v)); facts.append(f); };
    fact('Stage', r.stage || '—'); fact('Canopy', r.canopy_pct != null ? `${fmt(r.canopy_pct, 0)}%` : '—');
    fact('Height', r.height_cm != null ? `${fmt(r.height_cm, 0)} cm` : '—');
    fact('Harvest (camera)', r.camera_harvest ? niceDay(r.camera_harvest) : '—');
    fact('Harvest (plan)', r.plan_harvest ? niceDay(r.plan_harvest) : '—');
    fact('kg camera / plan', `${fmt(r.kg_est, 0)} / ${fmt(r.plan_kg, 0)}`);
    card.append(facts);
    if (r.shift_days != null) {
      const s = Number(r.shift_days);
      card.append(el('div', 'cx-shift ' + (Math.abs(s) >= 2 ? (s > 0 ? 'late' : 'early') : 'same'),
        s === 0 ? 'On plan' : `${Math.abs(s)} day${Math.abs(s) === 1 ? '' : 's'} ${s > 0 ? 'later' : 'earlier'} than planned`));
    }
    const h = hist.get(r.position_id) || [];
    if (h.length > 1) card.append(spark(h.map(x => Number(x.canopy_pct ?? 0)), 'canopy % over time'));
    card.append(el('div', 'hint', `${nice(r.at)} · ${r.model || 'model ?'}${r.confidence != null ? ` · confidence ${Math.round(r.confidence * 100)}%` : ''}`));
    if (d.may_apply && r.status === 'new' && r.plan_id) {
      const act = el('div', 'row');
      const ap = el('button', 'btn btn-sm btn-primary', 'Apply to the batch');
      ap.title = 'Record it as a phase observation: the batch\'s harvest, its later dates and tasks move';
      ap.onclick = async () => {
        busy(ap, true, 'Applying…');
        try { const x = await rpc('apply_camera_growth', { p_id: r.id }); toast(`Harvest now from ${niceDay(x.harvest_start)}`, 'ok'); renderGrowth(mount, farm); }
        catch (e) { busy(ap, false, 'Apply to the batch'); toast(e.message, 'bad'); }
      };
      const no = el('button', 'btn btn-sm btn-ghost', 'Dismiss');
      no.onclick = async () => { try { await rpc('dismiss_camera_growth', { p_id: r.id }); renderGrowth(mount, farm); } catch (e) { toast(e.message, 'bad'); } };
      act.append(ap, no); card.append(act);
    }
    list.append(card);
  });
  mount.append(list);
}
function spark(vals, label) {
  const w = 160, h = 32, max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('class', 'cx-spark');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', vals.map((v, i) => `${i ? 'L' : 'M'}${(w * i / Math.max(vals.length - 1, 1)).toFixed(1)},${(h - 2 - (h - 4) * (v - min) / (max - min || 1)).toFixed(1)}`).join(''));
  svg.append(p);
  const box = el('div', 'cx-spark-box'); box.append(svg, el('span', 'hint', label));
  return box;
}

// ── Counting ─────────────────────────────────────────────────────────────────
const OBJ = { plant: 'Plants', head: 'Heads', fruit: 'Fruit', flower: 'Flowers', truss: 'Trusses', gap: 'Gaps', pest: 'Pests', other: 'Other' };
export async function renderCounting(mount, farm) {
  const back = Number(pref.get('fbc_ct_span') ?? 29);
  await loader(mount, [['camera_counts_view', { p_farm: farm.id, p_from: daysAgo(back), p_to: daysAgo(0) }]], ([d]) => paintCounting(mount, farm, d, back), 'Reading the counts…');
}
function paintCounting(mount, farm, d, back) {
  mount.textContent = '';
  const seg = el('div', 'seg');
  [[6, '7 days'], [29, '30 days'], [89, '90 days']].forEach(([n, label]) => {
    const b = el('button', 'seg-btn', label); b.setAttribute('aria-pressed', String(n === back));
    b.onclick = () => { pref.set('fbc_ct_span', String(n)); renderCounting(mount, farm); };
    seg.append(b);
  });
  mount.append(pageHead(null, 'What the cameras count per position: plants, heads, fruit, flowers, trusses and gaps. Plants and heads are compared with the places the position holds.',
    el('span', 'hint', d.cameras ? `${d.cameras} camera${d.cameras === 1 ? '' : 's'} · last ${ago(d.last_seen_at)}` : ''), seg));
  const pos = d.positions || [];
  if (!pos.length) { mount.append(notConnected('counts', 'the "counts" list, one count per position and object')); return; }
  const objs = [...new Set(pos.map(p => p.object))];
  const tiles = el('div', 'tiles cx-tiles');
  objs.forEach(o => {
    const n = pos.filter(p => p.object === o).reduce((a, p) => a + Number(p.count), 0);
    const t = el('div', 'tile'); const b = el('div', 'tile-body');
    b.append(el('div', 'tile-value', n.toLocaleString()), el('div', 'tile-label', OBJ[o] || o), el('div', 'tile-sub', 'latest count, all positions'));
    t.append(b); tiles.append(t);
  });
  mount.append(tiles);
  // day by day
  const days = d.days || [];
  if (days.length > 1) {
    const card = el('div', 'card card-pad');
    card.append(lineChart(objs.map((o, i) => ({
      name: OBJ[o] || o, colour: `hsl(${ZONE_HUES[i % ZONE_HUES.length]} 60% 52%)`,
      pts: days.filter(x => x.object === o).map(x => [new Date(x.d + 'T12:00:00').getTime(), Number(x.count)]),
    })), {}, 'Counted each day (all positions)', 0));
    mount.append(card);
  }
  const card = el('div', 'card card-pad');
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th></th><th>Crop</th><th>Where</th><th>Counted</th><th class="num">Count</th><th class="num">Places</th><th class="num">Filled</th><th>When</th></tr></thead>';
  const tb = el('tbody');
  pos.forEach(p => {
    const tr = el('tr');
    const av = el('td'); if (p.crop) av.append(cropAvatar({ name: p.crop, category: p.category, photo_url: p.photo_url }, 'xs'));
    tr.append(av, el('td', null, p.crop || '—'), el('td', null, [p.zone, p.system, p.position].filter(Boolean).join(' · ') || '—'),
              el('td', null, OBJ[p.object] || p.object), el('td', 'num', Number(p.count).toLocaleString()),
              el('td', 'num', p.places ? Number(p.places).toLocaleString() : '—'),
              el('td', 'num ' + (p.fill_pct != null && p.fill_pct < 90 ? 'warn' : ''), p.fill_pct != null ? `${fmt(p.fill_pct, 0)}%` : '—'),
              el('td', 'hint', nice(p.at)));
    tb.append(tr);
  });
  t.append(tb); card.append(t); mount.append(card);
}

// ── Devices & API ────────────────────────────────────────────────────────────
const KIND_LABEL = { controller: 'Controller', sensor: 'Sensor', gateway: 'Gateway', camera: 'Camera', robot: 'Robot' };
const VENDORS = [['farmnet', 'FarmNet'], ['ridder', 'Ridder HortiMaX'], ['priva', 'Priva'], ['edge', 'Camera edge computer'], ['generic', 'Other']];
const STATE = { online: ['online', 'ok'], quiet: ['quiet', 'warn'], never: ['not connected yet', ''], off: ['switched off', ''] };

export async function renderDevices(mount, farm) {
  await loader(mount, [['connections', { p_farm: farm.id }]], ([d]) => paintDevices(mount, farm, d), 'Reading the devices…');
}
function paintDevices(mount, farm, d) {
  mount.textContent = '';
  const add = d.may_edit ? el('button', 'btn btn-primary', 'Add a device') : null;
  if (add) add.onclick = () => editDevice(mount, farm, d, null);
  mount.append(pageHead(null, 'Everything that sends data: FarmNet and other controllers, sensors, gateways and fixed cameras. Each has its own key; ' +
    'data only comes in — nothing here sends a command to a device.', add));

  const card = el('div', 'card');
  const devs = d.devices || [];
  if (!devs.length) card.append(el('div', 'empty', d.may_edit ? 'No device yet. "Add a device" registers the first one — FarmNet first.' : 'No device yet.'));
  else {
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Device</th><th>Kind</th><th>Where</th><th>State</th><th>Last data</th><th class="num">Readings 24 h</th><th>Key</th><th></th></tr></thead>';
    const tb = el('tbody');
    devs.forEach(v => {
      const tr = el('tr');
      const name = el('td'); name.append(el('b', null, v.name), el('div', 'hint', [VENDORS.find(x => x[0] === v.vendor)?.[1] || v.vendor, v.code].filter(Boolean).join(' · ')));
      const st = STATE[v.state] || [v.state, ''];
      const state = el('td'); state.append(el('span', 'pill ' + st[1], st[0]));
      const key = el('td', 'hint', v.key_set ? `•••• ${v.key_last4 || ''}` : 'no key');
      const act = el('td', 'row');
      if (d.may_edit) {
        const ed = el('button', 'btn btn-sm btn-ghost', 'Edit'); ed.onclick = () => editDevice(mount, farm, d, v);
        const nk = el('button', 'btn btn-sm', v.key_set ? 'New key' : 'Make a key'); nk.onclick = () => newKey(mount, farm, v);
        act.append(ed, nk);
      }
      tr.append(name, el('td', null, KIND_LABEL[v.kind] || v.kind), el('td', null, [v.zone, v.system, v.area].filter(Boolean).join(' · ') || 'the farm'),
                state, el('td', 'hint', ago(v.last_seen_at)), el('td', 'num', String(v.readings_24h || 0)), key, act);
      tb.append(tr);
    });
    t.append(tb); card.append(t);
  }
  mount.append(card);

  // limits
  const lim = el('div', 'card card-pad');
  lim.append(el('div', 'sec-title', 'Limits'), el('p', 'hint', 'A reading outside the watch range shows amber; outside the alarm range it shows red and opens an issue (one while it lasts). The standard limits apply until the farm sets its own.'));
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Metric</th><th>Unit</th><th class="num">Alarm below</th><th class="num">Watch below</th><th class="num">Watch above</th><th class="num">Alarm above</th><th></th></tr></thead>';
  const tb = el('tbody');
  (d.metrics || []).forEach(m => {
    const l = m.limits || {};
    const tr = el('tr');
    tr.append(el('td', null, m.label), el('td', 'hint', m.unit || ''),
              ...['low_alarm', 'low_watch', 'high_watch', 'high_alarm'].map(k => el('td', 'num', l[k] == null ? '—' : String(l[k]))));
    const a = el('td');
    if (l.own) a.append(el('span', 'pill info', 'farm'));
    if (d.may_edit) { const b = el('button', 'btn btn-sm btn-ghost', 'Set'); b.onclick = () => editLimit(mount, farm, m); a.append(b); }
    tr.append(a); tb.append(tr);
  });
  t.append(tb); lim.append(t); mount.append(lim);

  // how to send data
  const api = el('div', 'card card-pad cx-api');
  api.append(el('div', 'sec-title', 'Sending data (for the integrator)'));
  api.append(el('p', 'hint', 'One HTTPS POST per batch of data, as often as every minute. The key goes in a header; anything the device already knows (zone, bay, time) can be left out.'));
  const pre = el('pre', 'cx-code');
  pre.textContent =
`POST ${URL_BASE}/functions/v1/ingest
X-Device-Key: fbd_…            (Make a key, above — shown once)
Content-Type: application/json

{
  "readings":   [{ "metric": "ec", "value": 1.8, "at": "2026-09-29T08:00:00Z", "zone": "Z2" }],
  "irrigation": [{ "cycle": "2B", "zone": "Z2", "started_at": "…", "ended_at": "…",
                   "volume_l": 120, "ec": 1.8, "ph": 5.9, "drain_pct": 22, "drain_ec": 2.4 }],
  "presence":   [{ "area": "Zone 2", "slot_start": "…", "slot_minutes": 15, "person_minutes": 22.5, "people_max": 2 }],
  "growth":     [{ "system": "FL-Z3", "position": "A", "stage": "vegetative", "canopy_pct": 55,
                   "height_cm": 12, "days_to_harvest": 14, "kg_est": 35, "confidence": 0.8, "model": "…" }],
  "counts":     [{ "system": "FL-Z3", "position": "A", "object": "head", "count": 250, "confidence": 0.9 }]
}

A robot may add to a count:
  "measures": [{ "item": 1, "what": "length", "mm": 363 }, { "item": 1, "what": "diameter", "mm": 41 }],
  "photo": "data:image/jpeg;base64,…"   (at most 400 kB),   "note": "…"

GET ${URL_BASE}/functions/v1/ingest     → the metric codes`;
  api.append(pre);
  const codes = el('div', 'cx-codes');
  (d.metrics || []).forEach(m => codes.append(el('span', 'chip', `${m.code}${m.unit ? ' · ' + m.unit : ''}`)));
  api.append(el('div', 'hint', 'Metric codes:'), codes);
  mount.append(api);
}

function editDevice(mount, farm, d, v) {
  const dr = drawer(v ? `Edit ${v.name}` : 'Add a device', 'What sends data, and where it is');
  const kind = selectBox(Object.entries(KIND_LABEL), v?.kind || 'controller');
  const vendor = selectBox(VENDORS, v?.vendor || 'farmnet');
  const name = el('input', 'input'); name.value = v?.name || ''; name.placeholder = 'FarmNet — Zone 2 climate';
  const code = el('input', 'input'); code.value = v?.code || ''; code.placeholder = 'FN-Z2';
  const zone = selectBox([['', 'The whole farm'], ...(d.zones || []).map(z => [z.id, z.name])], v?.zone_id || '');
  const sys = selectBox([['', '—'], ...(d.systems || []).map(s => [s.id, s.name])], v?.system_id || '');
  const area = selectBox([['', '—'], ...(d.areas || []).map(a => [a.id, a.name])], v?.area_id || '');
  const ext = el('input', 'input'); ext.value = v?.external_id || ''; ext.placeholder = 'the id FarmNet gives it';
  const notes = el('textarea', 'input'); notes.value = v?.notes || '';
  dr.body.append(field('Kind', kind), field('Make', vendor), field('Name', name), field('Code', code, 'short, unique on this farm'),
                 field('Zone', zone), field('Bay', sys, 'for a camera looking at one bay'), field('Area', area, 'for a camera counting people in an area'),
                 field('External id', ext), field('Notes', notes));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = dr.close;
  if (v) {
    const rm = el('button', 'btn btn-ghost tl-clear', 'Remove');
    rm.onclick = async () => {
      if (!await confirmDrawer(`Remove ${v.name}?`, 'A device that already sent data is switched off and keeps its history; its key stops working.', 'Remove')) return;
      try { const r = await rpc('remove_device', { p_device: v.id }); toast(r.removed ? 'Removed' : 'Switched off — its data stays', 'ok'); dr.close(); renderDevices(mount, farm); }
      catch (e) { toast(e.message, 'bad'); }
    };
    dr.footer.append(rm);
  }
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      await rpc('save_device', { p_farm: farm.id, p: { id: v?.id || null, kind: kind.value, vendor: vendor.value, name: name.value, code: code.value,
        zone_id: zone.value || null, system_id: sys.value || null, area_id: area.value || null, external_id: ext.value, notes: notes.value, active: true } });
      dr.close(); renderDevices(mount, farm);
    } catch (e) { busy(go, false, 'Save'); toast(e.message, 'bad'); }
  };
  dr.footer.append(cancel, el('div', 'spacer'), go);
}

async function newKey(mount, farm, v) {
  if (v.key_set && !await confirmDrawer(`A new key for ${v.name}?`, 'The key it uses now stops working at once.', 'Make a new key')) return;
  try {
    const r = await rpc('device_new_key', { p_device: v.id });
    // closed any way (✕, Escape, outside): the list shows the new key's last four (0.7.162)
    const dr = drawer(`Key for ${v.name}`, 'Shown once — copy it now and give it to whoever connects the device', { onClose: () => renderDevices(mount, farm) });
    const box = el('pre', 'cx-code cx-key', r.key);
    const copy = el('button', 'btn btn-primary', 'Copy');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(r.key); toast('Copied', 'ok'); } catch { toast('Select the key and copy it', ''); } };
    dr.body.append(box, el('p', 'hint', 'Send it in the X-Device-Key header of every POST to the ingest endpoint. Only its last four characters are kept in sight here.'));
    const done = el('button', 'btn', 'Done'); done.onclick = () => dr.close();
    dr.footer.append(copy, el('div', 'spacer'), done);
  } catch (e) { toast(e.message, 'bad'); }
}

function editLimit(mount, farm, m) {
  const l = m.limits || {};
  const dr = drawer(`Limits · ${m.label}`, `${m.unit || ''} — empty = no limit on that side`);
  const inputs = {};
  [['low_alarm', 'Alarm below'], ['low_watch', 'Watch below'], ['high_watch', 'Watch above'], ['high_alarm', 'Alarm above']].forEach(([k, label]) => {
    const i = el('input', 'input'); i.type = 'number'; i.step = 'any'; i.value = l[k] ?? ''; inputs[k] = i;
    dr.body.append(field(label, i));
  });
  const std = el('button', 'btn btn-ghost', 'Back to the standard');
  std.onclick = async () => { try { await rpc('save_metric_limit', { p_farm: farm.id, p_metric: m.code, p_zone: null, p: {} }); dr.close(); renderDevices(mount, farm); } catch (e) { toast(e.message, 'bad'); } };
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    const p = {}; Object.entries(inputs).forEach(([k, i]) => { p[k] = i.value === '' ? null : Number(i.value); });
    try { await rpc('save_metric_limit', { p_farm: farm.id, p_metric: m.code, p_zone: null, p }); dr.close(); renderDevices(mount, farm); }
    catch (e) { toast(e.message, 'bad'); }
  };
  dr.footer.append(std, el('div', 'spacer'), go);
}
