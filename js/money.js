// ═══════════════════════════════════════════════════════════════════════════
// Office › Money (migration 0135, console 0.7.147)
//
// Profit and loss, month by month: revenue (what was delivered, at its price),
// direct costs (materials used at cost, hours clocked at each person's hourly
// cost, costs entered against a batch), indirect costs (entered), gross and net.
// Per crop, over the batches harvested in the period: kg, price a kg, cost of
// goods sold a kg (bill of materials at cost + the labour of its tasks + its
// direct costs + a share of the indirect costs by m² × days) and the margin.
// Per channel: kg, revenue and price a kg. Estimates until an accountant sets
// the cost structure. For the unit's Admin, the Farm manager and the office.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast, rpc } from './api.js';
import { loading, el, pageHead, drawer, field, selectBox, toast, busy, cropAvatar, confirmDrawer, pref, farmDate, farmToday } from './ui.js';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PERIODS = [['month', 'This month'], ['quarter', 'Last 3 months'], ['year', 'This year'], ['12m', 'Last 12 months']];
const CATS = [['seedlings', 'Seedlings'], ['materials', 'Materials'], ['nutrients', 'Nutrients'], ['labour', 'Labour'], ['energy', 'Energy'],
  ['water', 'Water'], ['rent', 'Rent'], ['equipment', 'Equipment'], ['maintenance', 'Maintenance'], ['transport', 'Transport'],
  ['packaging', 'Packaging'], ['marketing', 'Marketing'], ['admin', 'Admin'], ['insurance', 'Insurance'], ['finance', 'Finance'], ['other', 'Other']];
const KIND_WORD = { direct: 'Direct clients', super_user: 'Super users', restaurant: 'Restaurants', retailer: 'Retailers', community: 'Communities',
  market_agent: 'Market agents', other: 'Other', unknown: 'Not in the book' };

export function moneyRange(p = pref.get('fbc_money_period') || 'quarter') {
  const t = farmDate();
  if (p === 'month') return { p_from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), p_to: ymd(t) };
  if (p === 'year') return { p_from: `${t.getFullYear()}-01-01`, p_to: ymd(t) };
  if (p === '12m') return { p_from: ymd(new Date(t.getFullYear() - 1, t.getMonth() + 1, 1)), p_to: ymd(t) };
  return { p_from: ymd(new Date(t.getFullYear(), t.getMonth() - 2, 1)), p_to: ymd(t) };
}

let farm = null, mount = null, data = null;
export async function renderMoney(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}
async function load(fresh = false) {
  const here = mount;
  await openFast([['money', { p_farm: farm.id, ...moneyRange() }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Adding it up…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}
const cur = () => data?.currency || 'ZAR';
const money = n => `${cur()} ${Math.round(Number(n || 0)).toLocaleString()}`;
const perKg = n => n == null ? '—' : `${cur()} ${Number(n).toFixed(2)}`;
const monthName = s => new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

function paint() {
  mount.textContent = '';
  const cp = pref.get('fbc_money_period') || 'quarter';
  const seg = el('div', 'seg');
  PERIODS.forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label); b.setAttribute('aria-pressed', String(v === cp));
    b.onclick = () => { pref.set('fbc_money_period', v); load(); };
    seg.append(b);
  });
  const add = data.may_edit ? el('button', 'btn btn-primary', 'Add a cost') : null;
  if (add) add.onclick = () => editCost(null);
  mount.append(pageHead(null, 'Profit and loss: what was delivered against what it cost — materials used, hours clocked, costs entered — and, per crop, ' +
    'the cost and the price of a kilogram. Estimates until an accountant sets the cost structure.', seg, add));

  const t = data.totals || {};
  const direct = Number(t.materials) + Number(t.labour) + Number(t.direct_entries);
  const gross = Number(t.revenue) - direct, net = gross - Number(t.indirect);
  const tiles = el('div', 'tiles mo-tiles');
  const tile = (v, l, s, tone) => { const x = el('div', 'tile' + (tone ? ' ' + tone : '')); const b = el('div', 'tile-body'); b.append(el('div', 'tile-value', v), el('div', 'tile-label', l)); if (s) b.append(el('div', 'tile-sub', s)); x.append(b); return x; };
  tiles.append(tile(money(t.revenue), 'Revenue', `${Math.round(Number(t.kg_sold || 0)).toLocaleString()} kg delivered`),
               tile(money(direct), 'Direct costs', `materials ${money(t.materials)} · labour ${money(t.labour)} · other ${money(t.direct_entries)}`),
               tile(money(gross), 'Gross margin', Number(t.revenue) ? `${Math.round(100 * gross / Number(t.revenue))}% of revenue` : null, gross < 0 ? 'bad' : ''),
               tile(money(t.indirect), 'Indirect costs'),
               tile(money(net), 'Net', null, net < 0 ? 'bad' : 'ok'));
  mount.append(tiles);

  // month by month
  const months = data.months || [];
  const card = el('div', 'card card-pad');
  card.append(el('div', 'sec-title', 'Month by month'));
  const max = Math.max(1, ...months.map(m => Math.max(Number(m.revenue), Number(m.direct) + Number(m.indirect))));
  const chart = el('div', 'mo-chart');
  months.forEach(m => {
    const col = el('div', 'mo-col');
    const bars = el('div', 'mo-bars');
    const r = el('i', 'rev'); r.style.height = (100 * m.revenue / max) + '%';
    const c = el('span', 'mo-cost');
    const ind = el('i', 'ind'); ind.style.height = (100 * m.indirect / max) + '%';
    const dir = el('i', 'dir'); dir.style.height = (100 * m.direct / max) + '%';
    c.append(ind, dir);
    bars.append(r, c);
    const net = Number(m.revenue) - Number(m.direct) - Number(m.indirect);
    col.append(bars, el('span', 'mo-lbl', monthName(m.m)), el('span', 'mo-net ' + (net < 0 ? 'neg' : ''), money(net)));
    col.title = `${monthName(m.m)} · revenue ${money(m.revenue)} · direct ${money(m.direct)} · indirect ${money(m.indirect)}`;
    chart.append(col);
  });
  card.append(chart, el('div', 'hint', 'Green: revenue · orange: direct costs · grey: indirect costs · under each month: net.'));
  mount.append(card);

  // per crop
  const crops = data.crops || [];
  const cc = el('div', 'card card-pad');
  cc.append(el('div', 'sec-title', 'Per crop · the batches harvested in the period'));
  if (!crops.length) cc.append(el('div', 'hint', 'No harvest recorded in the period.'));
  else {
    const tb = el('table', 'table');
    tb.innerHTML = '<thead><tr><th></th><th>Crop</th><th class="num">kg</th><th class="num">Price a kg</th><th class="num">Cost a kg</th><th class="num">Margin a kg</th><th>Margin</th><th class="num">Materials</th><th class="num">Labour</th><th class="num">Overhead</th></tr></thead>';
    const body = el('tbody');
    crops.forEach(c => {
      const tr = el('tr');
      const av = el('td'); av.append(cropAvatar({ name: c.crop, category: c.category, photo_url: c.photo_url }, 'xs'));
      const m = c.price_kg != null && c.cost_kg != null ? Number(c.price_kg) - Number(c.cost_kg) : null;
      const pct = m != null && Number(c.price_kg) > 0 ? Math.round(100 * m / Number(c.price_kg)) : null;
      const mb = el('td'); const bar = el('div', 'yd-bar' + (pct != null && pct < 20 ? ' short' : '')); const f = el('i'); f.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
      bar.append(f); mb.append(bar, el('span', 'hint', pct == null ? '—' : `${pct}%`));
      tr.append(av, el('td', null, c.crop), el('td', 'num', Math.round(c.kg).toLocaleString()), el('td', 'num', perKg(c.price_kg)), el('td', 'num', perKg(c.cost_kg)),
                el('td', 'num ' + (m != null && m < 0 ? 'warn' : ''), perKg(m)), mb,
                el('td', 'num', money(c.materials)), el('td', 'num', money(c.labour)), el('td', 'num', money(c.overhead)));
      body.append(tr);
    });
    tb.append(body); cc.append(tb);
    cc.append(el('div', 'hint', `Cost a kg: the bill of materials at cost, the labour of the batch's tasks at the average hourly cost, its direct costs, and the indirect costs shared at ${cur()} ${Number(data.overhead_rate_m2_day || 0).toFixed(3)} a m² a day in the ground. The price a kg is what it was delivered at, else the price book.`));
  }
  mount.append(cc);

  const grid = el('div', 'yd-grid');
  const ch = el('div', 'card card-pad');
  ch.append(el('div', 'sec-title', 'Per channel'));
  if (!(data.channels || []).length) ch.append(el('div', 'hint', 'No delivery in the period (Office › Orders › Delivered…).'));
  else {
    const t2 = el('table', 'table');
    t2.innerHTML = '<thead><tr><th>Customers</th><th class="num">kg</th><th class="num">Revenue</th><th class="num">Price a kg</th></tr></thead>';
    const b2 = el('tbody');
    data.channels.forEach(x => { const tr = el('tr'); tr.append(el('td', null, KIND_WORD[x.kind] || x.kind), el('td', 'num', Math.round(x.kg).toLocaleString()), el('td', 'num', money(x.revenue)), el('td', 'num', perKg(x.price_kg))); b2.append(tr); });
    t2.append(b2); ch.append(t2);
  }
  const ct = el('div', 'card card-pad');
  ct.append(el('div', 'sec-title', 'Costs entered, by category'));
  if (!(data.categories || []).length) ct.append(el('div', 'hint', 'No cost entered yet — "Add a cost" for rent, energy, water, insurance…'));
  else {
    const t3 = el('table', 'table');
    t3.innerHTML = '<thead><tr><th>Category</th><th>Kind</th><th class="num">Amount</th></tr></thead>';
    const b3 = el('tbody');
    data.categories.forEach(x => { const tr = el('tr'); tr.append(el('td', null, (CATS.find(c => c[0] === x.category) || [x.category, x.category])[1]), el('td', 'hint', x.kind), el('td', 'num', money(x.amount))); b3.append(tr); });
    t3.append(b3); ct.append(t3);
  }
  grid.append(ch, ct);
  mount.append(grid);

  // the entries
  const ent = data.entries || [];
  const ec = el('div', 'card card-pad');
  ec.append(el('div', 'sec-title', `Cost entries · ${ent.length}`));
  if (ent.length) {
    const t4 = el('table', 'table');
    t4.innerHTML = '<thead><tr><th>Day</th><th>Category</th><th>Kind</th><th>What</th><th class="num">Amount</th><th></th></tr></thead>';
    const b4 = el('tbody');
    ent.forEach(e => {
      const tr = el('tr');
      const act = el('td');
      if (data.may_edit) { const b = el('button', 'btn btn-sm btn-ghost', 'Edit'); b.onclick = () => editCost(e); act.append(b); }
      tr.append(el('td', null, String(e.day)), el('td', null, (CATS.find(c => c[0] === e.category) || [e.category, e.category])[1]), el('td', 'hint', e.kind),
                el('td', null, [e.description, e.supplier, e.batch ? `batch ${e.batch}` : null].filter(Boolean).join(' · ') || '—'), el('td', 'num', money(e.amount)), act);
      b4.append(tr);
    });
    t4.append(b4); ec.append(t4);
  } else ec.append(el('div', 'hint', 'Nothing entered in the period.'));
  mount.append(ec);
}

function editCost(e) {
  const d = drawer(e ? 'Cost' : 'Add a cost', 'Indirect: rent, energy, water, insurance, admin… Direct: something a batch used that is not in its bill of materials');
  const day = el('input', 'input'); day.type = 'date'; day.value = e?.day || farmToday();
  const cat = selectBox(CATS, e?.category || 'energy');
  const kind = selectBox([['indirect', 'Indirect (shared by all batches)'], ['direct', 'Direct (belongs to the farm’s production)']], e?.kind || 'indirect');
  const amount = el('input', 'input'); amount.type = 'number'; amount.min = '0'; amount.step = '0.01'; amount.value = e?.amount ?? '';
  const desc = el('input', 'input'); desc.value = e?.description || ''; desc.placeholder = 'e.g. September electricity';
  const sup = el('input', 'input'); sup.value = e?.supplier || '';
  const g = el('div', 'grid2'); g.append(field('Day', day), field(`Amount (${cur()})`, amount));
  const g2 = el('div', 'grid2'); g2.append(field('Category', cat), field('Kind', kind));
  d.body.append(g, g2, field('What', desc), field('Paid to', sup));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  if (e) {
    const rm = el('button', 'btn btn-ghost tl-clear', 'Remove');
    rm.onclick = async () => {
      if (!await confirmDrawer('Remove this cost?', `${e.day} · ${money(e.amount)}`, 'Remove')) return;
      try { await rpc('remove_cost', { p_id: e.id }); d.close(); load(true); } catch (x) { toast(x.message, 'bad'); }
    };
    d.footer.append(rm);
  }
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      await rpc('save_cost', { p_farm: farm.id, p: { id: e?.id || null, day: day.value, category: cat.value, kind: kind.value, amount: amount.value,
        description: desc.value, supplier: sup.value, crop_plan_id: e?.crop_plan_id || null, zone_id: e?.zone_id || null } });   // an edit kept the zone it had
      d.close(); load(true);
    } catch (x) { busy(go, false, 'Save'); toast(x.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}
