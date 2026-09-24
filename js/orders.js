// ═══════════════════════════════════════════════════════════════════════════
// Office › Orders — a promise to a customer, planned backwards (spec §10.8,
// migration 0107, console 0.7.115)
//
// Somebody enters what was sold: who to, the crop, the kg and the delivery day —
// once, or every n weeks. "Check" asks the planner without writing anything and
// reads the answer out: yes, yes but tight, or no and why, with what would work
// instead (the earliest date for the whole quantity, the most kg on the day
// asked). "Save and plan" keeps the order and places its batches as proposals on
// the Crop planner, where the machine's own proposals make way for them.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast, cachedRpc } from './api.js';
import { loading, el, pageHead, drawer, field, input, selectBox, toast, busy, confirmDrawer, cropAvatar, systemLabel } from './ui.js';

let farm = null, mount = null, data = null, showClosed = false, planMap = null;
const nice = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const kg = n => `${Math.round(Number(n || 0)).toLocaleString()} kg`;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const STATUS = { open: ['open', ''], planned: ['planned', 'ok'], short: ['short', 'bad'], delivered: ['delivered', 'ok'], cancelled: ['cancelled', ''] };

export async function renderOrders(container, currentFarm) {
  if (farm?.id !== currentFarm.id) planMap = null;
  farm = currentFarm; mount = container;
  await load();
}

async function load(fresh = false) {
  const here = mount;
  await openFast([['orders', { p_farm: farm.id, p_include_closed: showClosed }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the orders…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}
const reload = () => load(true);

function paint() {
  mount.textContent = '';
  const add = data.may_edit ? el('button', 'btn btn-primary', 'New order') : null;
  if (add) add.onclick = () => editOrder(null);
  const closed = el('button', 'btn btn-ghost btn-sm', showClosed ? 'Hide delivered and cancelled' : 'Show delivered and cancelled');
  closed.onclick = () => { showClosed = !showClosed; load(); };
  mount.append(pageHead(null,
    'What has been promised to customers. Each order is planned backwards from its delivery day: the harvest, the transplant, ' +
    'the sowing, and the positions it needs — which it takes before the planner fills the rest. Check first: the answer is yes, ' +
    'tight, or no with the reason and what would work instead.', closed, add));

  const orders = data.orders || [];
  if (!orders.length) {
    mount.append(el('div', 'empty', data.may_edit ? 'No order yet. "New order" takes the first one.' : 'No order yet.'));
    return;
  }
  const list = el('div', 'ord-list');
  orders.forEach(o => list.append(orderCard(o)));
  mount.append(list);
}

function orderCard(o) {
  const card = el('div', 'card card-pad ord');
  const head = el('div', 'row');
  const st = STATUS[o.status] || [o.status, ''];
  head.append(el('b', 'ord-customer', o.customer), el('span', 'pill ' + st[1], st[0]));
  if (o.notes) head.append(el('span', 'hint', o.notes));
  head.append(el('div', 'spacer'));
  if (data.may_edit && !['cancelled', 'delivered'].includes(o.status)) {
    const addLine = el('button', 'btn btn-sm btn-ghost', 'Add a line');
    addLine.onclick = () => editOrder(o);
    const cancel = el('button', 'btn btn-sm btn-ghost', 'Cancel order');
    cancel.onclick = async () => {
      if (!await confirmDrawer('Cancel this order?', `${o.customer}: its batches that are still plans are removed. What is already in the ground keeps growing.`, 'Cancel the order', true)) return;
      try { const r = await rpc('cancel_order', { p_order: o.id }); toast(`Cancelled · ${r.batches_cancelled} batch${r.batches_cancelled === 1 ? '' : 'es'} removed`, 'ok'); await reload(); }
      catch (e) { toast(e.message, 'bad'); }
    };
    head.append(addLine, cancel);
  }
  card.append(head);
  (o.lines || []).forEach(l => card.append(lineRow(o, l)));
  return card;
}

function lineRow(o, l) {
  const r = el('div', 'ord-line' + (l.status === 'cancelled' ? ' off' : ''));
  r.append(cropAvatar({ name: l.crop, category: l.category, photo_url: l.photo_url }, 'sm'));
  const what = el('div', 'ord-what');
  const when = l.repeat_weeks
    ? `every ${l.repeat_weeks === 1 ? 'week' : l.repeat_weeks + ' weeks'} × ${l.repeat_times}, from ${nice(l.delivery_date)}`
    : `on ${nice(l.delivery_date)}`;
  what.append(el('b', null, `${kg(l.qty_kg)} ${l.crop}`), el('div', 'hint', when + (l.system_code ? ` · ${l.system_code}` : '')));
  r.append(what);
  // planned against promised
  const need = Number(l.qty_kg) * (l.deliveries || 1), got = Number(l.planned_kg || 0);
  const bar = el('div', 'ord-bar'); const fill = el('i'); fill.style.width = Math.min(100, need ? 100 * got / need : 0) + '%';
  if (got < need * 0.999) bar.classList.add('short');
  bar.append(fill);
  const b = el('div', 'ord-cover'); b.append(bar, el('span', 'hint', `${kg(got)} planned of ${kg(need)}`));
  r.append(b);
  const st = STATUS[l.status] || [l.status, ''];
  r.append(el('span', 'pill ' + st[1], st[0]));
  // why short, from the last planning
  const shortOnes = (l.last_check?.deliveries || []).filter(d => d.verdict === 'short');
  if (shortOnes.length) {
    const why = el('div', 'note warn ord-why');
    why.textContent = shortOnes.slice(0, 3).map(d => `${nice(d.delivery)}: ${kg(d.kg)} of ${kg(d.need)}` +
      (d.why === 'cycle' ? ` — too soon, earliest ${nice(d.earliest_delivery)}` : d.why === 'positions' ? ' — not enough free positions' : d.why === 'nowhere' ? ' — no zone grows it' : '')).join(' · ');
    r.append(why);
  }
  if (data.may_edit && l.status !== 'cancelled') {
    const acts = el('div', 'row');
    const plan = el('button', 'btn btn-sm', l.batches ? 'Plan again' : 'Plan');
    plan.title = 'Place its batches on the Crop planner (as proposals); planning again replaces the proposals, keeps what is decided';
    plan.onclick = async () => {
      busy(plan, true, 'Planning…');
      try { const x = await rpc('plan_order_line', { p_line: l.id }); toast(x.ok ? `Planned · ${x.batches} batch${x.batches === 1 ? '' : 'es'} proposed` : `Partly planned · ${x.batches} batches — see why on the line`, x.ok ? 'ok' : 'bad'); await reload(); }
      catch (e) { busy(plan, false, 'Plan'); toast(e.message, 'bad'); }
    };
    acts.append(plan);
    if (l.proposed) {
      const ok = el('button', 'btn btn-sm btn-primary', `Validate ${l.proposed}`);
      ok.title = 'Validate the proposed batches of this line: their tasks are created';
      ok.onclick = async () => {
        busy(ok, true, 'Validating…');
        try {
          const x = await rpc('validate_crop_plan', { p_ids: l.proposed_ids });
          const c = x.conflicts || [];
          toast(`${x.validated} validated · ${x.tasks_created} tasks` + (c.length ? ` · ${c.length} skipped (overlap)` : ''), c.length ? 'bad' : 'ok');
          await reload();
        } catch (e) { busy(ok, false, 'Validate'); toast(e.message, 'bad'); }
      };
      acts.append(ok);
    }
    const see = el('a', 'btn btn-sm btn-ghost', 'On the planner'); see.href = '#/grow/planner';
    acts.append(see);
    r.append(acts);
  }
  return r;
}

// ── a new order, or a line added to one ──────────────────────────────────────
async function editOrder(o) {
  const d = drawer(o ? `Add to ${o.customer}` : 'New order', 'Check it before promising: the planner answers from the farm as it is');
  if (!planMap) {
    d.body.append(loading('Reading the crops…'));
    // the copy kept of the planner's map first (it is read at start-up), the server if there is none
    try { planMap = (await cachedRpc('crop_map', { p_farm: farm.id })) || await rpc('crop_map', { p_farm: farm.id }); } catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
    d.body.textContent = '';
  }
  const crops = (planMap.crops || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const customer = input({ value: o?.customer || '', placeholder: 'Restaurant, shop, market…' });
  const notes = input({ value: o?.notes || '', placeholder: 'optional' });
  const crop = selectBox(crops.map(c => [c.id, c.name]));
  const zone = selectBox([]);
  const qty = input({ type: 'number', min: 1, step: 'any', placeholder: 'kg' });
  const t = new Date(); t.setDate(t.getDate() + 60);
  const when = input({ type: 'date', value: ymd(t) });
  const repeat = selectBox([['', 'Once'], ['1', 'Every week'], ['2', 'Every 2 weeks'], ['4', 'Every 4 weeks']], '');
  const times = input({ type: 'number', min: 1, max: 52, value: 4 });
  const timesF = field('How many deliveries', times);
  const fits = (c, s) => (c.media || []).some(m => (s.media || []).includes(m)) && (!(s.categories || []).length || s.categories.includes(c.category));
  const fillZones = () => {
    const c = crops.find(x => x.id === crop.value);
    zone.textContent = '';
    const any = el('option', null, 'Any zone it grows in'); any.value = ''; zone.append(any);
    (planMap.systems || []).filter(s => c && fits(c, s)).forEach(s => { const op = el('option', null, `${s.name} · ${systemLabel(s.type)}`); op.value = s.code; zone.append(op); });
    answer.textContent = '';
  };
  const showTimes = () => { timesF.style.display = repeat.value ? '' : 'none'; answer.textContent = ''; };
  const answer = el('div', 'ord-answer');
  crop.onchange = fillZones; repeat.onchange = showTimes;
  [zone, qty, when, times].forEach(x => x.addEventListener('change', () => { answer.textContent = ''; }));

  if (!o) d.body.append(field('Customer', customer), field('Note', notes));
  const r1 = el('div', 'grid2'); r1.append(field('Crop', crop), field('Zone', zone));
  const r2 = el('div', 'grid2'); r2.append(field('Kilograms', qty), field('Delivery', when));
  const r3 = el('div', 'grid2'); r3.append(field('Repeats', repeat), timesF);
  d.body.append(r1, r2, r3, answer);
  fillZones(); showTimes();

  // the planner's answer for the first delivery
  const check = el('button', 'btn', 'Check');
  check.onclick = async () => {
    if (!Number(qty.value)) { toast('How many kg?', 'bad'); return; }
    busy(check, true, 'Checking…');
    try {
      const r = await rpc('order_check', { p_farm: farm.id, p_crop: crop.value, p_qty: Number(qty.value), p_delivery: when.value, p_system: zone.value || null });
      paintAnswer(answer, r, { qty, when });
    } catch (e) { toast(e.message, 'bad'); }
    busy(check, false, 'Check');
  };
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save and plan');
  save.onclick = async () => {
    if (!o && !customer.value.trim()) { toast('Who is it for?', 'bad'); return; }
    if (!Number(qty.value)) { toast('How many kg?', 'bad'); return; }
    busy(save, true, 'Planning…');
    try {
      const line = { crop_id: crop.value, qty_kg: Number(qty.value), delivery_date: when.value,
                     repeat_weeks: repeat.value || null, repeat_times: repeat.value ? Number(times.value || 1) : 1, system_code: zone.value || null };
      const lines = o ? [...(o.lines || []).filter(l => l.status !== 'cancelled').map(l => ({ id: l.id, crop_id: l.crop_id, qty_kg: l.qty_kg,
                          delivery_date: l.delivery_date, repeat_weeks: l.repeat_weeks, repeat_times: l.repeat_times, system_code: l.system_code, notes: l.notes })), line]
                       : [line];
      const saved = await rpc('save_order', { p: { id: o?.id ?? null, farm_id: farm.id, customer: o ? o.customer : customer.value.trim(),
                                                   notes: o ? o.notes : notes.value.trim() || null, lines } });
      const newLine = (saved.lines || []).filter(l => !(o?.lines || []).some(x => x.id === l.id)).pop();
      const p = newLine ? await rpc('plan_order_line', { p_line: newLine.id }) : null;
      d.close();
      toast(p ? (p.ok ? `Saved and planned · ${p.batches} batch${p.batches === 1 ? '' : 'es'} proposed on the Crop planner` : `Saved · only partly planned — see why on the line`) : 'Saved', p && !p.ok ? 'bad' : 'ok');
      await reload();
    } catch (e) { busy(save, false, 'Save and plan'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), check, save);
}

export function paintAnswer(box, r, inputs) {   // exported for the preview tests too
  box.textContent = '';
  const word = { yes: 'Yes', tight: 'Yes, but tight', no: 'No' }[r.verdict] || r.verdict;
  const head = el('div', 'ord-verdict ' + r.verdict);
  head.append(el('b', null, word), el('span', null, r.reason ? ' — ' + r.reason : ` — ${kg(r.kg)} from ${(r.plan || []).length} position${(r.plan || []).length === 1 ? '' : 's'}`));
  box.append(head);
  if ((r.plan || []).length) {
    const t = el('table', 'people ord-plan');
    const hr = el('tr'); ['Position', 'Sow', 'Transplant', 'Harvest', 'kg'].forEach(x => hr.append(el('th', null, x)));
    const th = el('thead'); th.append(hr); t.append(th);
    const tb = el('tbody');
    r.plan.forEach(p => {
      const tr = el('tr');
      [`${p.zone} · ${p.position}`, nice(p.sow), nice(p.transplant), `${nice(p.harvest_start)} – ${nice(p.harvest_end)}`, kg(p.kg)]
        .forEach(v => tr.append(el('td', null, v)));
      tb.append(tr);
    });
    t.append(tb); box.append(t);
  }
  if ((r.displaced || []).length) {
    box.append(el('div', 'hint', `It takes the place of ${r.displaced.length} automatic proposal${r.displaced.length === 1 ? '' : 's'} (${[...new Set(r.displaced.map(x => x.crop))].join(', ')}), which make way.`));
  }
  if (r.verdict === 'no') {
    const alt = el('div', 'row ord-alt');
    if (r.earliest_date) {
      const b = el('button', 'btn btn-sm', `Earliest for ${kg(r.qty ?? inputs.qty.value)}: ${nice(r.earliest_date)} — use it`);
      b.onclick = () => { inputs.when.value = String(r.earliest_date).slice(0, 10); inputs.when.dispatchEvent(new Event('change')); };
      alt.append(b);
    } else alt.append(el('span', 'hint', `No date in the next four months takes ${kg(r.qty ?? inputs.qty.value)}.`));
    if (Number(r.max_kg_on_date) > 0) {
      const b = el('button', 'btn btn-sm', `Most on ${nice(r.delivery)}: ${kg(r.max_kg_on_date)} — use it`);
      b.onclick = () => { inputs.qty.value = Math.floor(r.max_kg_on_date); inputs.qty.dispatchEvent(new Event('change')); };
      alt.append(b);
    }
    box.append(alt);
  }
}
