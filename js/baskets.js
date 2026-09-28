// ═══════════════════════════════════════════════════════════════════════════
// Office › Sell — the basket planner (migration 0128, console 0.7.141)
//
// One bar per harvest day (the farm's harvest weekdays), built of one colour per
// crop: what was weighed on the days behind us, the forecast on the days ahead
// (each batch's expected kg shared over the harvest days of its window), the
// proposals lighter. Above each bar the day's total and the weight of one basket
// when the kilograms are shared equally over the direct clients set on top. A
// click on a day opens its basket: every crop with its picture, the kilograms of
// the day and what one basket holds (in pieces or bunches when the crop is sold
// that way). Sister units are read together unless one is switched off.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast, rpc } from './api.js';
import { loading, el, pageHead, drawer, toast, cropAvatar, pref } from './ui.js';

const DAY = 86400000;
const SPAN_KEY = 'fbc_basket_span', PROP_KEY = 'fbc_basket_proposed', UNITS_KEY = 'fbc_basket_units';
const SPANS = [[28, '4 weeks'], [91, '3 months'], [182, '6 months']];
const BACK = 14;   // the window opens two weeks back: the last harvests weighed, then the forecast

let farm = null, mount = null, data = null, offset = 0, clients = null;
const span = () => Number(pref.get(SPAN_KEY)) || 91;
const withProposals = () => pref.get(PROP_KEY) !== 'off';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dateOf = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const dayName = s => dateOf(s).toLocaleDateString(undefined, { weekday: 'short' });
const dayNum = s => dateOf(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDay = s => dateOf(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const kgText = n => { n = Number(n || 0); return n >= 100 ? `${Math.round(n).toLocaleString()} kg` : `${n.toFixed(n >= 10 ? 0 : 1)} kg`; };
const basketText = n => { n = Number(n || 0); return n < 1 ? `${Math.round(n * 1000)} g` : `${n.toFixed(n >= 10 ? 0 : 2)} kg`; };

// the window on screen (warm() reads the same)
export function basketRange(off = 0) {
  const t = new Date();
  const from = addDays(new Date(t.getFullYear(), t.getMonth(), t.getDate()), -BACK + off);
  return { p_from: ymd(from), p_to: ymd(addDays(from, span() - 1)) };
}
function unitsPicked() {
  try { const v = JSON.parse(pref.get(UNITS_KEY) || 'null'); return Array.isArray(v) && v.length ? v : null; } catch { return null; }
}
export const basketArgs = (farmId, off = 0) => ({ p_farm: farmId, ...basketRange(off), p_units: unitsPicked(), p_proposed: withProposals() });

export async function renderBaskets(container, currentFarm) {
  if (farm?.id !== currentFarm.id) { offset = 0; clients = null; }
  farm = currentFarm; mount = container;
  await load();
}

async function load(fresh = false) {
  const here = mount;
  await openFast([['basket_plan', basketArgs(farm.id, offset)]], {
    show: ([d]) => { data = d; if (clients == null || fresh) clients = d.clients; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the harvest days…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}

// one colour per crop, spaced round the wheel (two lettuces must not share a green)
let colours = new Map();
const colourOf = id => colours.get(id) || 'var(--text-muted)';
const cropOf = id => (data.crops || []).find(c => c.id === id);

// what fills a day's baskets: weighed kilograms once the day is behind us (or weighed today), else the forecast
function dayContent(day) {
  const past = day.d < data.today || (day.d === data.today && Number(day.realized_kg) > 0);
  if (past) return { kind: 'realized', parts: Object.entries(day.realized || {}).map(([id, kg]) => ({ id, kg: Number(kg), prop: false })) };
  const parts = Object.entries(day.forecast || {}).map(([id, kg]) => ({ id, kg: Number(kg), prop: false }));
  if (data.proposals) Object.entries(day.proposed || {}).forEach(([id, kg]) => parts.push({ id, kg: Number(kg), prop: true }));
  return { kind: 'forecast', parts };
}
const sum = parts => parts.reduce((a, p) => a + p.kg, 0);

function paint() {
  mount.textContent = '';
  colours = new Map((data.crops || []).map((c, i) => [c.id, `hsl(${Math.round((i * 137.508 + 150) % 360)} 58% 52%)`]));

  // the head: clients, the window, proposals, units
  const cl = el('label', 'bk-clients');
  const inp = el('input', 'input');
  inp.type = 'number'; inp.min = '0'; inp.step = '1'; inp.value = clients ?? '';
  inp.placeholder = '0';
  inp.disabled = !data.may_edit;
  inp.title = data.may_edit ? 'How many direct clients get an equal basket each harvest day (shared by sister units)'
                            : 'Set by the farm manager';
  inp.oninput = () => { clients = inp.value === '' ? null : Math.max(0, Math.round(Number(inp.value))); paintChart(); paintTiles(); };
  inp.onchange = async () => {
    try { await rpc('set_basket_clients', { p_farm: farm.id, p_clients: clients }); toast(`${clients ?? 0} direct clients saved`, 'ok'); data.clients = clients; }
    catch (e) { toast(e.message, 'bad'); }
  };
  cl.append(el('span', null, 'Direct clients'), inp);

  const seg = el('div', 'seg');
  SPANS.forEach(([n, label]) => {
    const b = el('button', 'seg-btn', label);
    b.setAttribute('aria-pressed', String(span() === n));
    b.onclick = () => { pref.set(SPAN_KEY, String(n)); load(); };
    seg.append(b);
  });
  const back = el('button', 'btn btn-sm', '‹'), fwd = el('button', 'btn btn-sm', '›'), now = el('button', 'btn btn-sm', 'Today');
  const step = Math.round(span() / 2);
  back.onclick = () => { offset -= step; load(); };
  fwd.onclick = () => { offset += step; load(); };
  now.onclick = () => { offset = 0; load(); };
  const prop = el('label', 'row bk-toggle');
  const pc = el('input'); pc.type = 'checkbox'; pc.checked = withProposals();
  pc.onchange = () => { pref.set(PROP_KEY, pc.checked ? 'on' : 'off'); load(); };
  prop.append(pc, el('span', null, 'Count proposed batches'));
  prop.title = 'Batches the planner proposed and nobody has validated yet, drawn lighter';

  mount.append(pageHead(null,
    'The harvest of each harvest day, crop by crop — weighed on the days behind, forecast on the days ahead — and the basket each ' +
    'direct client gets when the day is shared equally. Click a day for its basket.', cl));
  const bar = el('div', 'bk-bar');
  bar.append(now, back, fwd, el('b', 'bk-range', `${dayNum(data.from)} – ${dayNum(data.to)}`), el('div', 'spacer'), prop, seg);
  const units = data.units || [];
  if (units.length > 1) {
    const us = el('div', 'bk-units');
    units.forEach(u => {
      const b = el('button', 'btn btn-sm bk-unit' + (u.on ? ' on' : ''));
      const m = el('span', 'bk-unit-mark', u.badge); m.style.background = u.colour || 'var(--text-muted)';
      b.append(m, u.name);
      b.onclick = () => {
        const on = new Set(units.filter(x => x.on).map(x => x.id));
        on.has(u.id) ? on.delete(u.id) : on.add(u.id);
        if (!on.size) return;   // at least one unit
        pref.set(UNITS_KEY, on.size === units.length ? null : JSON.stringify([...on]));
        load();
      };
      us.append(b);
    });
    bar.append(us);
  }
  mount.append(bar);

  tilesBox = el('div', 'tiles bk-tiles');
  chartBox = el('div', 'card card-pad bk-card');
  mount.append(tilesBox, chartBox);
  paintTiles();
  paintChart();
}

let tilesBox = null, chartBox = null;
function tile(label, value, hint) {
  const t = el('div', 'tile');
  const body = el('div', 'tile-body');
  body.append(el('div', 'tile-value', value), el('div', 'tile-label', label));
  if (hint) body.append(el('div', 'tile-sub', hint));
  t.append(body);
  return t;
}
function paintTiles() {
  if (!tilesBox) return;
  tilesBox.textContent = '';
  const days = data.days || [];
  const ahead = days.filter(d => d.d >= data.today), behind = days.filter(d => d.d < data.today);
  const fc = ahead.reduce((a, d) => a + sum(dayContent(d).parts), 0);
  const rz = behind.reduce((a, d) => a + Number(d.realized_kg || 0), 0);
  const withKg = ahead.filter(d => sum(dayContent(d).parts) > 0);
  const avg = withKg.length ? fc / withKg.length : 0;
  tilesBox.append(
    tile('Forecast ahead', kgText(fc), `${withKg.length} harvest day${withKg.length === 1 ? '' : 's'} with a harvest`),
    tile('Weighed', kgText(rz), `${behind.length} harvest day${behind.length === 1 ? '' : 's'} behind`),
    tile('A harvest day', kgText(avg), 'on average, ahead'),
    tile('One basket', clients ? basketText(avg / clients) : '—', clients ? `on average, ${clients} clients` : 'set the direct clients'));
}

function paintChart() {
  if (!chartBox) return;
  chartBox.textContent = '';
  const days = data.days || [];
  if (!days.length) {
    chartBox.append(el('div', 'empty', 'No harvest day in this window. Harvest days are set on Farm setup › The week.'));
    return;
  }
  const contents = days.map(d => ({ day: d, ...dayContent(d) }));
  const max = Math.max(1, ...contents.map(c => sum(c.parts)), ...days.map(d => Number(d.forecast_kg || 0) + (data.proposals ? Number(d.proposed_kg || 0) : 0)));
  const chart = el('div', 'bk-chart');
  contents.forEach(c => {
    const d = c.day, total = sum(c.parts);
    const col = el('button', 'bk-col' + (c.kind === 'realized' ? ' realized' : '') + (d.d === data.today ? ' today' : '') + (total ? '' : ' empty'));
    col.type = 'button';
    const top = el('div', 'bk-top');
    top.append(el('b', null, total ? kgText(total) : '—'));
    top.append(el('span', 'bk-avg', total && clients ? basketText(total / clients) : ''));
    const stack = el('div', 'bk-stack');
    // the forecast, as a dashed outline, on the days that were weighed
    if (c.kind === 'realized') {
      const f = Number(d.forecast_kg || 0) + (data.proposals ? Number(d.proposed_kg || 0) : 0);
      if (f > 0) { const o = el('i', 'bk-fc-line'); o.style.bottom = (100 * f / max) + '%'; o.title = `Forecast ${kgText(f)}`; stack.append(o); }
    }
    c.parts.slice().sort((a, b) => (a.prop - b.prop) || (b.kg - a.kg)).forEach(p => {
      const seg = el('span', 'bk-seg' + (p.prop ? ' prop' : ''));
      seg.style.height = (100 * p.kg / max) + '%';
      seg.style.background = colourOf(p.id);
      stack.append(seg);
    });
    const foot = el('div', 'bk-foot');
    foot.append(el('span', null, dayName(d.d)), el('span', 'hint', dayNum(d.d)));
    col.append(top, stack, foot);
    col.title = `${longDay(d.d)} · ${c.kind === 'realized' ? 'weighed' : 'forecast'} ${kgText(total)}` +
      (clients && total ? ` · one basket ${basketText(total / clients)}` : '') +
      c.parts.slice().sort((a, b) => b.kg - a.kg).map(p => `\n  ${cropOf(p.id)?.name || 'crop'}: ${kgText(p.kg)}${p.prop ? ' (proposed)' : ''}`).join('');
    col.onclick = () => openBasket(d);
    chart.append(col);
  });
  const scroller = el('div', 'bk-scroll');
  scroller.append(chart);
  chartBox.append(scroller);
  // open on today
  requestAnimationFrame(() => {
    const t = chart.querySelector('.today') || [...chart.children].find((x, i) => contents[i].day.d >= data.today);
    if (t) scroller.scrollLeft = Math.max(0, t.offsetLeft - 3 * t.offsetWidth);
  });

  // the legend: the crops on screen with their pictures
  const legend = el('div', 'bk-legend');
  const onScreen = new Set(contents.flatMap(c => c.parts.map(p => p.id)));
  (data.crops || []).filter(c => onScreen.has(c.id)).forEach(c => {
    const it = el('span', 'bk-leg');
    const sw = el('i', 'bk-swatch'); sw.style.background = colourOf(c.id);
    it.append(sw, cropAvatar(c, 'xs'), el('span', null, c.name));
    legend.append(it);
  });
  const key = el('div', 'bk-key hint');
  key.append(el('span', null, 'Solid: weighed (behind) or validated (ahead) · lighter: proposed · dashed line: what was forecast for a day already weighed · ' +
    'figures on top: the day in kg, then one basket.'));
  chartBox.append(legend, key);
}

// the basket of one day: every crop with its picture, the day's kilograms and one basket's share
function openBasket(day) {
  const c = dayContent(day), total = sum(c.parts);
  const n = clients || 0;
  const d = drawer(`Basket · ${longDay(day.d)}`,
    `${c.kind === 'realized' ? 'Weighed' : 'Forecast'} ${kgText(total)}` + (n ? ` shared by ${n} direct client${n === 1 ? '' : 's'}: one basket ≈ ${basketText(total / n)}` : ' — set the direct clients on top to see one basket'));
  if (!total) { d.body.append(el('div', 'hint', 'Nothing to harvest this day.')); return; }
  const byCrop = new Map();
  c.parts.forEach(p => {
    const x = byCrop.get(p.id) || { id: p.id, kg: 0, prop: 0 };
    x.kg += p.kg; if (p.prop) x.prop += p.kg;
    byCrop.set(p.id, x);
  });
  const rows = [...byCrop.values()].sort((a, b) => b.kg - a.kg);
  const list = el('div', 'bk-basket');
  const head = el('div', 'bk-brow bk-bhead');
  head.append(el('span'), el('span', 'hint', 'Crop'), el('span', 'hint', 'The day'), el('span', 'hint', 'One basket'), el('span', 'hint', 'Share'));
  list.append(head);
  rows.forEach(r => {
    const crop = cropOf(r.id) || { name: 'Crop' };
    const row = el('div', 'bk-brow');
    const name = el('div');
    name.append(el('b', null, crop.name));
    const sub = [crop.variety, r.prop ? (r.prop >= r.kg - 0.01 ? 'proposed' : `${kgText(r.prop)} proposed`) : null].filter(Boolean).join(' · ');
    if (sub) name.append(el('div', 'hint', sub));
    const per = n ? r.kg / n : null;
    const perBox = el('div');
    perBox.append(el('b', null, per == null ? '—' : basketText(per)));
    const g = Number(crop.grams_per_unit || 0);
    if (per != null && g > 0 && crop.sell_unit && crop.sell_unit !== 'kg') {
      const pcs = per * 1000 / g;
      perBox.append(el('div', 'hint', `≈ ${pcs >= 10 ? Math.round(pcs) : pcs.toFixed(1)} ${crop.sell_unit}${pcs >= 1.5 ? (crop.sell_unit === 'bunch' ? 'es' : 's') : ''}`));
    }
    const share = el('div', 'bk-share');
    const bar = el('i'); bar.style.width = (100 * r.kg / total) + '%'; bar.style.background = colourOf(r.id);
    share.append(bar, el('span', 'hint', `${Math.round(100 * r.kg / total)}%`));
    const av = cropAvatar(crop);
    av.style.boxShadow = `0 0 0 2px ${colourOf(r.id)}`;
    row.append(av, name, el('span', null, kgText(r.kg)), perBox, share);
    list.append(row);
  });
  d.body.append(list);
  if (c.kind === 'realized' && Number(day.forecast_kg || 0) > 0)
    d.body.append(el('div', 'hint', `Forecast for this day: ${kgText(Number(day.forecast_kg) + (data.proposals ? Number(day.proposed_kg || 0) : 0))}.`));
  if (c.kind === 'forecast')
    d.body.append(el('div', 'hint', 'A forecast: each batch\'s expected kilograms shared over the harvest days of its window. The weights recorded by the harvest tasks replace it once the day is harvested.'));
}
