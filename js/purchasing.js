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
         num, shortDate } from './ui.js';

let farm = null, data = null, mount = null, chosen = new Set(), tab = 'requests';

export async function renderPurchasing(container, currentFarm) {
  farm = currentFarm; mount = container; chosen = new Set();
  await load();
}

// last time's copy at once, the server's answer behind it (openFast, 0.7.108)
async function load() {
  const here = mount;
  await openFast([['purchasing', { p_farm: farm.id }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading purchasing…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here,
  });
}

function paint() {
  mount.textContent = '';
  const may = data.may_order;
  const drafts = data.requests.filter(r => r.status === 'draft');
  const ordered = data.requests.filter(r => r.status === 'ordered');
  const late = drafts.filter(r => r.late).length;
  const below = data.stock.filter(s => s.below).length;

  const compute = el('button', 'btn btn-primary', 'Work out what to buy');
  compute.title = 'From the validated crop plan, the bill of materials, stock and open orders.';
  compute.onclick = () => recompute(compute);

  mount.append(pageHead('Purchasing',
    `${drafts.length} to order${late ? `, ${late} already late` : ''}` +
    `${ordered.length ? `, ${ordered.length} on the way` : ''}` +
    `${below ? `, ${below} item${below === 1 ? '' : 's'} below the reorder point` : ''}.`,
    may ? compute : null));

  if (late) {
    mount.append(el('div', 'note warn',
      `${late} request${late === 1 ? ' has' : 's have'} an order-by date in the past. ` +
      'Those batches are at risk — order today, or move the transplant.'));
  }

  const tabs = el('div', 'chips');
  tabs.style.marginBottom = 'var(--space-4)';
  [['requests', `To order · ${drafts.length}`],
   ['ordered', `On the way · ${ordered.length}`],
   ['stock', `Stock · ${data.stock.length}`],
   ['suppliers', `Suppliers · ${data.suppliers.length}`]].forEach(([k, label]) => {
    const c = el('button', 'chip' + (tab === k ? ' on' : ''), label);
    c.onclick = () => { tab = k; paint(); };
    tabs.append(c);
  });
  mount.append(tabs);

  if (tab === 'requests') mount.append(requestsCard(drafts, may));
  if (tab === 'ordered') mount.append(orderedCard(ordered, may));
  if (tab === 'stock') mount.append(stockCard(may));
  if (tab === 'suppliers') mount.append(suppliersCard());
}

function requestsCard(rows, may) {
  const c = card('To order');
  if (may && rows.length) {
    const mark = el('button', 'btn btn-sm', 'Mark chosen as ordered');
    mark.onclick = () => markOrdered(mark);
    c._head.append(mark);
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
        b.append(el('div', 'hint', r.category));
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
  c.append(table([
    { key: 'item', label: 'Item' },
    { key: 'category', label: 'Category' },
    { key: 'on_hand', label: 'On hand', align: 'right',
      fmt: (v, r) => `${num(v, 2)} ${r.unit || ''}` },
    { key: 'reorder_point', label: 'Reorder at', align: 'right',
      fmt: v => v == null ? '—' : num(v, 2) },
    { key: 'below', label: '', fmt: v => v ? el('span', 'pill bad', 'low') : '' },
    { key: 'item_id', label: '', align: 'right', fmt: (v, r) => {
        if (!may) return '';
        const b = el('button', 'btn btn-sm', 'Count');
        b.title = 'Correct the ledger after a stock count.';
        b.onclick = e => { e.stopPropagation(); countStock(r); };
        return b; } },
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
    busy(ok, true, 'Saving…');
    try {
      const r = await rpc('receive_purchase', {
        p_id: row.id, p_qty: Number(qty.value), p_on: when.value || null });
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
    const diff = Number(counted.value) - Number(row.on_hand ?? 0);
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
