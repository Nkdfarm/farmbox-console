// ═══════════════════════════════════════════════════════════════════════════
// Purchasing — what the plan makes somebody buy (spec §7.8, §10.5)
//
// Nothing here is typed twice. A validated crop plan and the bill of
// materials say what will be consumed and when; stock and open orders say
// what is already covered; the supplier's lead time says when it has to be
// ordered. What is left is a short list with dates on it.
//
// A request whose order-by date has already passed is shown as late rather
// than silently moved to today: the plan is at risk, and moving the date
// would hide that.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, table, pageHead, card, drawer, field, input, toast, busy,
         num, shortDate, selectBox, confirmDrawer, isFranchisor } from './ui.js';

let farm = null, data = null, seed = null, mount = null, chosen = new Set(), tab = 'requests', laterOpen = false;
let stockOnly = false;
// a phone number for wa.me: digits only, 00 = international, a ten-digit 0… number is South African
// ("0027 82…" used to become "2702782…")
const waNumber = ph => {
  let n = String(ph || '').replace(/[^0-9]/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  else if (n.length === 10 && n.startsWith('0')) n = '27' + n.slice(1);
  return n;
};                            // Office › Stock shows the stock alone, no Buy chips

export async function renderPurchasing(container, currentFarm) {
  farm = currentFarm; mount = container; chosen = new Set(); stockOnly = false;
  if (tab === 'stock') tab = 'requests';          // Buy opens on what to order; Stock has its own tab (0.7.152)
  await load();
}
// Office › Stock: the same page, the stock only
export async function renderStock(container, currentFarm) {
  farm = currentFarm; mount = container; chosen = new Set(); stockOnly = true;
  tab = 'stock';
  await load();
}

// last time's copy at once, the server's answer behind it (openFast, 0.7.108)
async function load() {
  const here = mount;
  // seedling orders are optional: an older database without them still opens Buy
  await openFast([['purchasing', { p_farm: farm.id }], ['seedling_orders', { p_farm: farm.id }, true]], {
    show: ([d, s]) => { data = d; seed = s; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading purchasing…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here,
  });
}

function paint() {
  mount.textContent = '';
  const may = data.may_order;
  const drafts = data.requests.filter(r => r.status === 'draft');
  const toOrder = drafts.filter(r => !r.po_id);
  const ordered = data.requests.filter(r => r.status === 'ordered');
  const late = drafts.filter(r => r.late).length;
  const below = data.stock.filter(s => s.below).length;

  const compute = el('button', 'btn btn-primary', 'Work out what to buy');
  compute.title = 'From the validated crop plan, the bill of materials, stock and open orders.';
  compute.onclick = () => recompute(compute);

  if (stockOnly) {
    mount.append(pageHead(null, `${data.stock.length} item${data.stock.length === 1 ? '' : 's'} in stock` +
      `${below ? `, ${below} below the reorder point` : ''}. What to buy is under Buy.`));
    mount.append(stockCard(may));
    return;
  }

  mount.append(pageHead(null,        // the tab already says Buy / Stock (0.7.162)
    `${toOrder.length} to order${late ? `, ${late} already late` : ''}` +
    `${ordered.length ? `, ${ordered.length} on the way` : ''}` +
    `${below ? `, ${below} item${below === 1 ? '' : 's'} below the reorder point` : ''}.`,
    may ? compute : null));

  if (late) {
    mount.append(el('div', 'note warn',
      `${late} request${late === 1 ? ' has' : 's have'} an order-by date in the past. ` +
      'Those batches are at risk — order today, or move the transplant.'));
  }

  const openPos = (data.orders || []).filter(o => ['draft', 'approved', 'sent'].includes(o.status));
  const tabs = el('div', 'chips');
  tabs.style.marginBottom = 'var(--space-4)';
  const seedOpen = (seed?.orders || []).filter(o => o.status !== 'done');
  const seedNow = seedOpen.filter(o => o.day <= seed.today).length;
  [['requests', `To order · ${drafts.filter(r => !r.po_id).length}`],
   ['seedlings', `Seedlings · ${seedOpen.length}${seedNow ? ` (${seedNow} today)` : ''}`],
   ['orders', `Purchase orders · ${openPos.length}`],
   ['ordered', `On the way · ${ordered.length}`],
   ['suppliers', `Suppliers · ${data.suppliers.length}`]].forEach(([k, label]) => {
    const c = el('button', 'chip' + (tab === k ? ' on' : ''), label);
    c.onclick = () => { tab = k; paint(); };
    tabs.append(c);
  });
  mount.append(tabs);

  if (tab === 'requests') mount.append(requestsCard(drafts.filter(r => !r.po_id), may));
  if (tab === 'seedlings') mount.append(seedlingsCard());
  if (tab === 'orders') mount.append(ordersCard(data.orders || [], may));
  if (tab === 'ordered') mount.append(orderedCard(ordered, may));
  if (tab === 'stock') mount.append(stockCard(may));
  if (tab === 'suppliers') mount.append(suppliersCard());
}

function requestsCard(rows, may) {
  const c = card('To order');
  if (may && rows.length) {
    const po = el('button', 'btn btn-sm btn-primary', 'Make purchase orders');
    po.title = 'The ticked requests become one purchase order per supplier, to approve and send';
    po.onclick = () => makeOrders(po);
    const mark = el('button', 'btn btn-sm btn-ghost', 'Mark chosen as ordered');
    mark.title = 'Already ordered some other way: skip the purchase order';
    mark.onclick = () => markOrdered(mark);
    c._head.append(po, mark);
  }

  const pick = r => {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = chosen.has(r.id);
    box.onclick = e => {
      e.stopPropagation();
      box.checked ? chosen.add(r.id) : chosen.delete(r.id);
    };
    return box;
  };

  c.append(table([
    ...(may ? [{ key: 'id', label: '', fmt: (v, r) => pick(r) }] : []),
    { key: 'item', label: 'Item', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        b.append(el('div', 'hint', r.category + (r.why === 'reorder' ? ' · below its reorder point' : r.why === 'plan' ? ' · for the crop plan' : '')));
        return b; } },
    { key: 'qty', label: 'Quantity', align: 'right',
      fmt: (v, r) => `${num(v, 2)} ${r.unit || ''}` },
    { key: 'supplier', label: 'From', fmt: (v, r) =>
        v ? `${v}${r.lead_days ? ` · ${r.lead_days} d` : ''}` : 'no supplier yet' },
    { key: 'order_by', label: 'Order by', fmt: (v, r) => {
        const s = el('span', r.late ? 'pill bad' : '', shortDate(v));
        return s; } },
    { key: 'need_by', label: 'Needed', fmt: shortDate },
    { key: 'cost', label: 'Cost', align: 'right',
      fmt: v => v ? `${data.currency} ${num(v, 2)}` : '—' },
  ], rows, { empty: 'Nothing to buy — press "Work out what to buy" after validating a plan.' }));
  return c;
}

function orderedCard(rows, may) {
  const c = card('On the way');
  c.append(table([
    { key: 'item', label: 'Item' },
    { key: 'qty', label: 'Quantity', align: 'right',
      fmt: (v, r) => `${num(v, 2)} ${r.unit || ''}` },
    { key: 'supplier', label: 'From' },
    { key: 'order_ref', label: 'Reference' },
    { key: 'expected_delivery', label: 'Expected', fmt: shortDate },
    { key: 'id', label: '', align: 'right', fmt: (v, r) => {
        if (!may) return '';
        const b = el('button', 'btn btn-sm', 'Received');
        b.onclick = e => { e.stopPropagation(); receive(b, r); };
        return b; } },
  ], rows, { empty: 'No open orders.' }));
  return c;
}

function stockCard(may) {
  const c = card('Stock on hand');
  if (may) {
    const add = el('button', 'btn btn-sm', 'New item');
    add.onclick = () => editItem(null);
    c._head.append(add);
  }
  const total = data.stock.reduce((a, s) => a + Number(s.value || 0), 0);
  if (total) c._head.insertBefore(el('span', 'hint', `worth ${data.currency} ${num(total, 0)} at cost`), c._head.lastChild);
  c.append(table([
    { key: 'item', label: 'Item' },
    { key: 'category', label: 'Category' },
    { key: 'on_hand', label: 'On hand', align: 'right',
      fmt: (v, r) => `${num(v, 2)} ${r.unit || ''}` },
    { key: 'used_30d', label: 'Used · 30 d', align: 'right', fmt: v => Number(v) ? num(v, 2) : '—' },
    { key: 'reorder_point', label: 'Reorder at', align: 'right',
      fmt: (v, r) => v == null ? '—' : `${num(v, 2)}${r.own_rule ? ' ·' : ''}` },
    { key: 'value', label: 'Value', align: 'right', fmt: v => Number(v) ? `${data.currency} ${num(v, 0)}` : '—' },
    { key: 'below', label: '', fmt: v => v ? el('span', 'pill bad', 'low') : '' },
    { key: 'item_id', label: '', align: 'right', fmt: (v, r) => {
        if (!may) return '';
        const w = el('span', 'row');
        const b = el('button', 'btn btn-sm', 'Count');
        b.title = 'Correct the ledger after a stock count.';
        b.onclick = e => { e.stopPropagation(); countStock(r); };
        const ed = el('button', 'btn btn-sm btn-ghost', 'Edit');
        ed.onclick = e => { e.stopPropagation(); editItem(r); };
        w.append(b, ed);
        return w; } },
  ], data.stock, { rowClass: r => r.below ? 'warn-row' : '' }));

  if (data.movements.length) {
    c.append(el('div', 'card-pad'));
    c.append(el('div', 'sec-title', 'Last movements'));
    c.append(table([
      { key: 'at', label: 'When', fmt: v => shortDate(String(v).slice(0, 10)) },
      { key: 'item', label: 'Item' },
      { key: 'qty', label: 'Quantity', align: 'right', fmt: v => num(v, 2) },
      { key: 'reason', label: 'Why' },
      { key: 'note', label: 'Note' },
    ], data.movements));
  }
  return c;
}

function suppliersCard() {
  const c = card('Suppliers');
  c.append(table([
    { key: 'name', label: 'Supplier' },
    { key: 'supplies', label: 'Supplies', fmt: v => (v || []).join(', ') },
    { key: 'lead_days', label: 'Lead', align: 'right', fmt: v => v ? v + ' d' : '—' },
    { key: 'order_days', label: 'Orders taken', fmt: v =>
        (v || []).map(d => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ') },
    { key: 'email', label: 'E-mail' },
    { key: 'phone', label: 'Phone' },
  ], data.suppliers, { empty: 'No suppliers yet — add them on Farm setup.' }));
  return c;
}

async function recompute(button) {
  busy(button, true, 'Working it out…');
  try {
    const r = await rpc('compute_purchase_requests', { p_farm: farm.id, p_horizon_days: 60 });
    chosen = new Set();   // the run may have dropped ticked requests (0.7.162)
    toast(r.requests
      ? `${r.requests} request${r.requests === 1 ? '' : 's'}${r.late ? `, ${r.late} already late` : ''}`
      : 'Nothing needed — stock and open orders cover the plan',
      r.late ? 'bad' : r.requests ? 'ok' : '');
    await load();
  } catch (e) { busy(button, false); toast(e.message, 'bad'); }
}

async function markOrdered(button) {
  if (!chosen.size) { toast('Tick the ones you have ordered first', 'bad'); return; }
  const d = drawer('Mark as ordered', `${chosen.size} request${chosen.size === 1 ? '' : 's'}`);
  const ref = input({ placeholder: 'order number, or how it was sent' });
  const when = input({ type: 'date' });
  d.body.append(field('Reference', ref));
  d.body.append(field('Expected delivery', when, 'Left empty, the date it is needed is assumed.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Mark as ordered');
  ok.onclick = async () => {
    busy(ok, true, 'Saving…');
    try {
      const n = await rpc('mark_ordered', {
        p_ids: [...chosen], p_ref: ref.value.trim() || null,
        p_expected: when.value || null });
      chosen = new Set();
      d.close();
      toast(`${n} marked as ordered`, 'ok');
      await load();
    } catch (e) { busy(ok, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

async function receive(button, row) {
  const d = drawer('Received', row.item);
  const qty = input({ type: 'number', step: '0.01', value: row.qty });
  const when = input({ type: 'date' });
  d.body.append(field(`Quantity (${row.unit || 'units'})`, qty,
    'Change it if what arrived is not what was ordered.'));
  d.body.append(field('Date', when, 'Today, unless it sat in the van.'));
  d.body.append(el('p', 'hint', 'Receiving is what moves stock: the ledger gains this quantity.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Receive');
  ok.onclick = async () => {
    // an empty field would book 0 and close the request (review 3 Oct 2026)
    const rq = qty.value === '' ? NaN : Number(qty.value);
    if (!Number.isFinite(rq) || rq <= 0) { toast('Type the quantity that arrived.', 'bad'); return; }
    busy(ok, true, 'Saving…');
    try {
      const r = await rpc('receive_purchase', {
        p_id: row.id, p_qty: rq, p_on: when.value || null });
      d.close();
      toast(`Received — ${num(r.on_hand, 2)} ${row.unit || ''} on hand`, 'ok');
      await load();
    } catch (e) { busy(ok, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

function countStock(row) {
  const d = drawer('Stock count', row.item);
  const counted = el('input');
  counted.type = 'number';
  counted.step = '0.01';
  counted.value = row.on_hand ?? 0;
  d.body.append(field(`Counted (${row.unit || 'units'})`, counted,
    `The ledger says ${num(row.on_hand, 2)}. The difference is written as an adjustment, ` +
    'so the history still adds up.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Save the count');
  ok.onclick = async () => {
    const n = counted.value === '' ? NaN : Number(counted.value);
    if (!Number.isFinite(n) || n < 0) { toast('How many are there? Type the count (0 or more).', 'bad'); return; }
    const diff = Math.round((n - Number(row.on_hand ?? 0)) * 1e4) / 1e4;
    if (!diff) { d.close(); toast('Nothing to correct'); return; }
    busy(ok, true, 'Saving…');
    try {
      await rpc('adjust_stock', {
        p_farm: farm.id, p_item: row.item_id, p_qty: diff,
        p_reason: 'adjustment', p_note: 'Stock count' });
      d.close();
      toast('Counted', 'ok');
      await load();
    } catch (e) { busy(ok, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

// ── purchase orders (0132): per supplier, approved by the Admin or Farm manager, then sent ──
function ordersCard(rows, may) {
  const box = el('div', 'po-list');
  if (!rows.length) { const c = card('Purchase orders'); c.append(el('div', 'empty', 'No purchase order yet. Tick requests under "To order" and press "Make purchase orders".')); return c; }
  const ST = { draft: ['to approve', 'warn'], approved: ['approved — to send', 'info'], sent: ['sent', 'ok'], received: ['received', 'ok'], cancelled: ['cancelled', ''] };
  rows.forEach(po => {
    const c = el('div', 'card card-pad po');
    const head = el('div', 'row');
    const st = ST[po.status] || [po.status, ''];
    head.append(el('b', null, po.number), el('span', 'pill ' + st[1], st[0]), el('span', null, po.supplier || 'no supplier'),
                el('div', 'spacer'), el('b', null, `${data.currency} ${num(po.total, 2)}`));
    c.append(head);
    const sub = [po.expected_delivery ? `expected ${shortDate(po.expected_delivery)}` : null, po.reference ? `ref ${po.reference}` : null,
                 po.approved_by ? `approved by ${po.approved_by}` : null, po.sent_at ? `sent ${shortDate(String(po.sent_at).slice(0, 10))}` : null].filter(Boolean);
    if (sub.length) c.append(el('div', 'hint', sub.join(' · ')));
    c.append(table([
      { key: 'item', label: 'Item' },
      { key: 'qty', label: 'Quantity', align: 'right', fmt: (v, r) => `${num(v, 2)} ${r.unit || ''}` },
      { key: 'unit_cost', label: 'Unit cost', align: 'right', fmt: v => v == null ? '—' : num(v, 2) },
      { key: 'cost', label: 'Cost', align: 'right', fmt: v => num(v, 2) },
      { key: 'need_by', label: 'Needed', fmt: shortDate },
      { key: 'status', label: '' },
    ], po.lines || []));
    if (may && ['draft', 'approved', 'sent'].includes(po.status)) {
      const acts = el('div', 'row');
      if (po.status === 'draft' && data.may_approve) {
        const ap = el('button', 'btn btn-sm btn-primary', 'Approve');
        ap.onclick = async () => { busy(ap, true, 'Approving…'); try { await rpc('approve_purchase_order', { p_po: po.id }); await load(); } catch (e) { busy(ap, false, 'Approve'); toast(e.message, 'bad'); } };
        acts.append(ap);
      } else if (po.status === 'draft') acts.append(el('span', 'hint', 'Waiting for the Admin or the Farm manager to approve it.'));
      if (po.status === 'approved') {
        const se = el('button', 'btn btn-sm btn-primary', 'Send…');
        se.onclick = () => sendOrder(po);
        acts.append(se);
      }
      if (po.status !== 'sent') {
        const cx = el('button', 'btn btn-sm btn-ghost tl-clear', 'Cancel');
        cx.onclick = async () => {
          if (!await confirmDrawer(`Cancel ${po.number}?`, 'Its requests go back to "To order".', 'Cancel it')) return;
          try { await rpc('cancel_purchase_order', { p_po: po.id }); await load(); } catch (e) { toast(e.message, 'bad'); }
        };
        acts.append(cx);
      } else acts.append(el('span', 'hint', 'Receive each line under "On the way"; the order closes with the last one.'));
      c.append(acts);
    }
    box.append(c);
  });
  return box;
}

async function makeOrders(button) {
  if (!chosen.size) { toast('Tick the requests to order first', 'bad'); return; }
  busy(button, true, 'Preparing…');
  try {
    const r = await rpc('make_purchase_orders', { p_farm: farm.id, p_requests: [...chosen] });
    chosen = new Set(); tab = 'orders';
    toast(`${(r.orders || []).length} purchase order${(r.orders || []).length === 1 ? '' : 's'} to approve`, 'ok');
    await load();
  } catch (e) { busy(button, false, 'Make purchase orders'); toast(e.message, 'bad'); }
}

// the message to the supplier: prepared here, sent by e-mail or WhatsApp by a person (supplier messaging is still an open decision)
function sendOrder(po) {
  const d = drawer(`Send ${po.number}`, `${po.supplier || 'Supplier'}${po.supplier_email ? ' · ' + po.supplier_email : ''}${po.supplier_phone ? ' · ' + po.supplier_phone : ''}`);
  const text = [`Purchase order ${po.number}`, `From: ${farm.name}`, '', ...(po.lines || []).map(l => `- ${num(l.qty, 2)} ${l.unit || ''} ${l.item}${l.code ? ' (' + l.code + ')' : ''}`),
    '', `Needed by: ${po.expected_delivery ? shortDate(po.expected_delivery) : 'as soon as possible'}`, '', 'Please confirm the delivery date. Thank you.'].join('\n');
  const pre = el('textarea', 'input po-text'); pre.value = text; pre.rows = Math.min(18, text.split('\n').length + 1);
  const copy = el('button', 'btn btn-sm', 'Copy');
  copy.onclick = async () => { try { await navigator.clipboard.writeText(pre.value); toast('Copied', 'ok'); } catch { pre.select(); } };
  const links = el('div', 'row');
  links.append(copy);
  if (po.supplier_email) { const a = el('a', 'btn btn-sm', 'Open e-mail'); a.href = `mailto:${po.supplier_email}?subject=${encodeURIComponent(po.number)}&body=${encodeURIComponent(pre.value)}`; links.append(a); }
  if (po.supplier_phone) { const a = el('a', 'btn btn-sm', 'WhatsApp'); a.href = `https://wa.me/${waNumber(po.supplier_phone)}?text=${encodeURIComponent(pre.value)}`; a.target = '_blank'; a.rel = 'noopener'; links.append(a); }
  const ref = input({ placeholder: 'their confirmation, or how it was sent' });
  const when = input({ type: 'date', value: po.expected_delivery ? String(po.expected_delivery).slice(0, 10) : '' });
  d.body.append(field('The order', pre), links, field('Reference', ref), field('Expected delivery', when));
  const cancel = el('button', 'btn', 'Not yet'); cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Mark as sent');
  ok.onclick = async () => {
    busy(ok, true, 'Saving…');
    try { await rpc('send_purchase_order', { p_po: po.id, p_reference: ref.value.trim() || null, p_expected: when.value || null }); d.close(); toast('Sent — its lines are on the way', 'ok'); await load(); }
    catch (e) { busy(ok, false, 'Mark as sent'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), ok);
}

// ── seedlings from the nursery (0153): the "Order seedlings" tasks the validated plan made, with every batch ──
// Purchasing never buys seedlings; an external nursery is ordered through these tasks, one per ordering day.
function seedlingsCard() {
  const box = el('div', 'po-list');
  if (!seed) { box.append(el('div', 'note', 'Seedling orders need the latest database update.')); return box; }
  const all = seed.orders || [];
  if (!all.length) {
    const c = card('Seedlings');
    c.append(el('div', 'empty', 'No seedling order. Validated batches with an external nursery make one here, on the day to order.'));
    return c;
  }
  const open = all.filter(o => o.status !== 'done');
  const now = open.filter(o => o.day <= seed.today || o.late);
  const later = open.filter(o => !now.includes(o));
  const done = all.filter(o => o.status === 'done').sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
  if (now.length) now.forEach(o => box.append(seedOrder(o, true)));
  else box.append(el('div', 'note', `Nothing to order today. Next: ${later.length ? shortDate(later[0].day) : '—'}.`));
  if (later.length) {
    const t = el('button', 'btn btn-ghost', `${laterOpen ? '▾' : '▸'} Later orders · ${later.length}`);
    t.onclick = () => { laterOpen = !laterOpen; paint(); };
    box.append(t);
    if (laterOpen) later.forEach(o => box.append(seedOrder(o, false)));
  }
  if (done.length) {
    box.append(el('h3', 'seed-head', 'Ordered in the last 30 days'));
    done.forEach(o => box.append(seedOrder(o, false)));
  }
  return box;
}

function seedOrder(o, openBatches) {
  const c = el('div', 'card card-pad po');
  const head = el('div', 'row');
  const trays = (o.crops || []).reduce((a, x) => a + Number(x.trays || 0), 0);
  o.tray_cells = o.tray_cells || o.crops?.[0]?.cells || 72;   // an order made before the tray size was set
  const st = o.status === 'done' ? [`ordered${o.done_by ? ' by ' + o.done_by : ''}`, 'ok']
           : o.day < seed.today || o.late ? ['late — order today', 'bad']
           : o.day === seed.today ? ['order today', 'warn'] : ['to order', 'info'];
  const unit = el('span', 'pill', o.badge || o.unit);
  if (o.colour) { unit.style.background = o.colour; unit.style.color = '#fff'; }
  head.append(el('b', null, o.day === seed.today ? 'Today' : shortDate(o.day)), unit, el('span', 'pill ' + st[1], st[0]),
              el('span', null, o.supplier || 'the nursery'), el('div', 'spacer'),
              el('b', null, `${num(trays)} trays of ${o.tray_cells} · ${num(o.plants)} plants`));
  c.append(head);
  const dels = (o.deliveries || []).filter(Boolean).sort();
  c.append(el('div', 'hint', `Delivery ${dels.map(shortDate).join(', ')} · ${(o.batches || []).length} batches` +
    (o.contact ? ` · ${o.contact}` : '') + (o.supplier_phone ? ` · ${o.supplier_phone}` : '')));
  c.append(table([
    { key: 'crop', label: 'Crop' },
    { key: 'batches', label: 'Batches', align: 'right' },
    { key: 'plants', label: 'Plants needed', align: 'right', fmt: v => num(v) },
    { key: 'trays', label: `Trays of ${o.tray_cells}`, align: 'right', fmt: v => el('b', null, num(v)) },
    { key: 'you_get', label: 'Plants in the trays', align: 'right', fmt: v => num(v) },
  ], o.crops || []));
  const det = el('details', 'seed-batches');
  det.open = openBatches;
  det.append(el('summary', null, `All ${(o.batches || []).length} batches`));
  det.append(table([
    { key: 'crop', label: 'Crop', fmt: (v, r) => r.variety ? `${v} · ${r.variety}` : v },
    { key: 'zone', label: 'Table', fmt: (v, r) => `${v || ''}${r.position && r.position !== v ? ' · ' + r.position : ''}` },
    { key: 'places', label: 'Places', align: 'right', fmt: v => num(v) },
    { key: 'plants', label: 'Plants (+ spare)', align: 'right', fmt: v => num(v) },
    { key: 'trays', label: 'Of a tray', align: 'right', fmt: (v, r) => num(Number(r.plants) / (Number(o.tray_cells) || 1), 2) },
    { key: 'delivery', label: 'Delivery', fmt: shortDate },
    { key: 'transplant', label: 'Transplant', fmt: shortDate },
  ], o.batches || []));
  c.append(det);
  if (o.status !== 'done' && seed.may_order) {
    const acts = el('div', 'row');
    const se = el('button', 'btn btn-sm', 'Message for the nursery…');
    se.onclick = () => seedMessage(o);
    const ok = el('button', 'btn btn-sm btn-primary', 'Mark as ordered');
    ok.onclick = async () => {
      if (!await confirmDrawer('Mark this order as placed?',
        `${num(trays)} trays from ${o.supplier || 'the nursery'}. Its ${(o.batches || []).length} batches are then fixed: they can no longer be moved or switched to our own nursery.`,
        'Mark as ordered')) return;
      busy(ok, true, 'Saving…');
      try { await rpc('complete_task', { p_task: o.task_id, p_minutes: null }); toast('Ordered', 'ok'); await load(); }
      catch (e) { busy(ok, false, 'Mark as ordered'); toast(e.message, 'bad'); }
    };
    acts.append(se, el('div', 'spacer'), ok);
    c.append(acts);
  }
  return c;
}

// the text for the nursery: whole trays per crop and delivery, sent by a person (e-mail or WhatsApp)
function seedMessage(o) {
  const d = drawer('Message for the nursery', `${o.supplier || ''}${o.supplier_email ? ' · ' + o.supplier_email : ''}${o.supplier_phone ? ' · ' + o.supplier_phone : ''}`);
  const byDelivery = {};
  (o.batches || []).forEach(b => {
    const day = (byDelivery[b.delivery] ||= {});
    day[b.crop] = (day[b.crop] || 0) + Number(b.plants || 0);
  });
  const cells = Number(o.tray_cells) || 1;
  const lines = [`Seedling order — ${o.unit}`, `Hi${o.contact ? ' ' + String(o.contact).split(' ')[0] : ''}, please sow for us:`, ''];
  Object.keys(byDelivery).sort().forEach(day => {
    lines.push(`For delivery ${shortDate(day)}:`);
    Object.entries(byDelivery[day]).sort().forEach(([crop, plants]) => {
      const t = Math.ceil(plants / cells);
      lines.push(`- ${crop}: ${t} tray${t === 1 ? '' : 's'} of ${cells} (${num(t * cells)} plants)`);
    });
    lines.push('');
  });
  lines.push('Please confirm. Thank you.');
  const pre = el('textarea', 'input po-text'); pre.value = lines.join('\n'); pre.rows = Math.min(20, lines.length + 1);
  const row = el('div', 'row');
  const copy = el('button', 'btn btn-sm', 'Copy');
  copy.onclick = async () => { try { await navigator.clipboard.writeText(pre.value); toast('Copied', 'ok'); } catch { pre.select(); } };
  row.append(copy);
  if (o.supplier_email) { const a = el('a', 'btn btn-sm', 'Open e-mail'); a.href = `mailto:${o.supplier_email}?subject=${encodeURIComponent('Seedling order ' + o.unit)}&body=${encodeURIComponent(pre.value)}`; row.append(a); }
  if (o.supplier_phone) { const a = el('a', 'btn btn-sm', 'WhatsApp'); a.href = `https://wa.me/${waNumber(o.supplier_phone)}?text=${encodeURIComponent(pre.value)}`; a.target = '_blank'; a.rel = 'noopener'; row.append(a); }
  d.body.append(field('The order', pre), row, el('div', 'hint', 'Whole trays per crop and delivery. Once it is placed, press "Mark as ordered" on the order.'));
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(el('div', 'spacer'), close);
}

const ITEM_CATS = [['seed', 'Seed'], ['medium', 'Growing medium'], ['nutrient', 'Nutrient'], ['pot_cap', 'Pots and caps'], ['packaging', 'Packaging'],
                   ['consumable', 'Consumable'], ['equipment', 'Equipment'], ['seedling', 'Seedlings']];
function editItem(r) {
  const own = !r || r.scope === 'farm';
  const d = drawer(r ? r.item : 'New item', own ? 'An item of this FarmBox' : 'A standard item: this FarmBox sets its own reorder point and quantity');
  const name = input({ value: r?.item || '' }), code = input({ value: r?.code || '', placeholder: 'optional' });
  const cat = selectBox(ITEM_CATS, r?.category || 'consumable');
  const unit = input({ value: r?.unit || 'unit' }), pack = input({ type: 'number', step: 'any', min: 0, value: r?.pack_size ?? 1 });
  const cost = input({ type: 'number', step: '0.01', min: 0, value: r?.unit_cost ?? '' });
  const rp = input({ type: 'number', step: 'any', min: 0, value: r?.reorder_point ?? '' });
  const rq = input({ type: 'number', step: 'any', min: 0, value: r?.reorder_qty ?? '', placeholder: 'empty = up to twice the point' });
  const std = !own && isFranchisor();        // the franchisor sets a standard item's pack and cost for every farm
  if (own) {
    const g = el('div', 'grid2'); g.append(field('Name', name), field('Code', code));
    const g2 = el('div', 'grid2'); g2.append(field('Category', cat), field('Unit', unit));
    const g3 = el('div', 'grid2'); g3.append(field('Pack size', pack, 'orders are rounded up to it'), field(`Unit cost (${data.currency})`, cost));
    d.body.append(g, g2, g3);
  } else if (std) {
    const g3 = el('div', 'grid2'); g3.append(field('Pack size', pack, 'for every farm — orders are rounded up to it'), field(`Unit cost (${data.currency})`, cost, 'for every farm'));
    d.body.append(g3);
  }
  const g4 = el('div', 'grid2'); g4.append(field('Reorder at', rp, 'below it, "Work out what to buy" tops it up'), field('Reorder quantity', rq));
  d.body.append(g4);
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Save');
  ok.onclick = async () => {
    busy(ok, true, 'Saving…');
    const p = { id: r?.item_id || null, reorder_point: rp.value, reorder_qty: rq.value };
    if (own) Object.assign(p, { name: name.value, code: code.value, category: cat.value, unit: unit.value, pack_size: pack.value, unit_cost: cost.value });
    else if (std) Object.assign(p, { pack_size: pack.value, unit_cost: cost.value });
    try { await rpc('save_item', { p_farm: farm.id, p }); d.close(); toast('Saved', 'ok'); await load(); }
    catch (e) { busy(ok, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), ok);
}
