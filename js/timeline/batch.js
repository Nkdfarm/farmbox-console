// the batch drawer, labels, planning here, propose, validate and discard
import { drawer, el, nurseryLine, money, field, selectBox, busy, toast, once, confirmDrawer,
         farmDate } from '../ui.js';
import { rpc, mergeValidated, rpcInChunks } from '../api.js';
import { printLabels } from '../labels.js';
import { nice, DAY, dn, ds, span, S } from './state.js';
import { fits, reload, cycleOf } from './index.js';
import { dropProblem, openMoveBatch } from './drag.js';

// ── one batch ────────────────────────────────────────────────────────────────
export function openBatch(b, sys, p) {
  const cur = S.data.currency || 'ZAR';
  const d = drawer(b.crop, `${sys.name} · ${p.code} · ${Number(p.capacity || 0).toLocaleString()} places`);
  const facts = el('div', 'set-group');
  const row = (k, v) => { if (v == null || v === '') return; const r = el('div', 'set-row'); r.append(el('span', null, k), el('span', null, String(v))); facts.append(r); };
  row('State', { proposed: 'Proposed — not planted until validated', validated: 'Validated', active: 'Growing', harvested: 'Harvested' }[b.status] || b.status);
  // the lot (0234): given when its label is printed or the plants are on the farm, never changed
  if (b.status !== 'proposed') row('Lot', b.lot_code || 'given when its label is printed, or when it is planted');
  row('Batch', b.batch_code);
  if (b.succession) {
    const series = (S.data.batches || []).filter(x => x.succession === b.succession);
    row('Succession', `planting ${b.round ?? '?'} · ${series.length} in this window`);
  }
  if (b.nursery) row('Seedlings', nurseryLine(b));
  row('Sowing', nice(b.sow_date));
  row('In the position', `${nice(b.stay_from)} → ${nice(b.stay_to)}`);
  row('Harvest', `${nice(b.harvest_start)} – ${nice(b.harvest_end)}`);
  if (b.harvested_kg) row('Harvested', b.harvested_kg + ' kg');
  if (b.yield) row('Expected', `${Math.round(b.yield).toLocaleString()} kg · ${money(b.revenue, cur)}` + (b.revenue_per_day ? ` · ${money(b.revenue_per_day, cur)}/day` : ''));
  if (b.customer) row('For', b.customer + ' (an order — Office › Orders)');
  if (b.rotation_warn) facts.append(el('div', 'note warn', 'Rotation: ' + b.rotation_warn + '. Nothing stops it; a different family is better for the position.'));
  if (b.over) facts.append(el('div', 'note warn', 'The harvest window has ended and no last cut is recorded, so the position is still held. Record the last cut on Grow › Harvest (or the harvest task) to free it.'));
  if (!b.movable && b.status === 'validated') facts.append(el('div', 'hint', b.ordered ? 'Its seedlings are ordered: the date stays.' : 'It is in the ground: only the harvest end can change.'));
  d.body.append(facts);

  if (S.data.may_plan && b.status !== 'harvested') {
    // another crop in the same slot
    if (b.movable) {
      const fitting = (S.data.crops || []).filter(c => fits(c, sys));
      const crop = selectBox(fitting.map(c => [c.id, c.name]), b.crop_id);
      const go = el('button', 'btn btn-sm', 'Change crop');
      go.onclick = async () => {
        if (crop.value === b.crop_id) return;
        busy(go, true, 'Changing…');
        try {
          const r = await rpc('change_batch_crop', { p_plan: b.id, p_crop: crop.value });
          d.close(); toast(`Now ${r.crop} · harvest ${nice(r.harvest_start)} – ${nice(r.harvest_end)}`, 'ok'); await reload();
        } catch (e) { busy(go, false, 'Change crop'); toast(e.message, 'bad'); }
      };
      const w = el('div', 'row'); w.append(crop, go);
      d.body.append(field('Crop', w, 'Same position and transplant day; its cycle decides the rest.'));
    }
    if (b.movable && (S.data.crops || []).some(c => c.id === b.crop_id)) {
      const mv = el('button', 'btn btn-sm', 'Move to…');
      mv.title = 'Another zone, position or transplant day — what dragging the bar does';
      mv.onclick = () => openMoveBatch(b, d);
      d.body.append(field('Position', mv, 'For a touch screen, where a bar cannot be dragged.'));
    }
    const endIn = el('input', 'input'); endIn.type = 'date'; endIn.value = b.harvest_end || '';
    const setEnd = el('button', 'btn btn-sm', 'Set');
    setEnd.onclick = async () => {
      if (!endIn.value || endIn.value === b.harvest_end) return;
      busy(setEnd, true, '…');
      try { await rpc('resize_batch', { p_plan: b.id, p_harvest_end: endIn.value }); d.close(); toast('Harvest end changed', 'ok'); await reload(); }
      catch (e) { busy(setEnd, false, 'Set'); toast(e.message, 'bad'); }
    };
    const w2 = el('div', 'row'); w2.append(endIn, setEnd);
    d.body.append(field('Last harvest day', w2, 'The harvest and cleanup tasks follow.'));
  }

  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close, el('div', 'spacer'));
  if (b.status !== 'proposed') {
    const lab = el('button', 'btn', 'Print label');
    lab.title = 'The label of the batch: its lot code, crop, table, dates and a QR that Naked Brain scans';
    lab.onclick = async () => { const r = await printLabels([b.id]); if (r?.length && !b.lot_code) { d.close(); await reload(); } };
    d.footer.append(lab);
  }
  if (S.data.may_plan && b.succession) {
    const series = (S.data.batches || []).filter(x => x.succession === b.succession && x.status === 'proposed');
    if (series.length > 1) {
      const rs = el('button', 'btn', `Remove the series (${series.length})`);
      rs.title = 'Every proposed planting of this succession on screen';
      rs.onclick = async () => { d.close(); await discard(series.map(x => x.id)); };
      d.footer.append(rs);
    }
  }
  if (S.data.may_plan && b.status === 'proposed') {
    const rm = el('button', 'btn btn-danger', 'Remove');
    rm.onclick = async () => { try { await rpc('cancel_crop_plan', { p_ids: [b.id] }); d.close(); toast('Removed', 'ok'); await reload(); } catch (e) { toast(e.message, 'bad'); } };
    const ok = el('button', 'btn btn-primary', 'Validate');
    ok.onclick = async () => { d.close(); await validate(ok, [b.id]); };
    d.footer.append(rm, ok);
  } else if (S.data.may_plan && b.status === 'validated' && b.movable) {
    const rm = el('button', 'btn btn-danger', 'Cancel this batch');
    rm.onclick = () => once(rm, async () => {
      if (!await confirmDrawer('Cancel it?', `${b.crop} on ${p.code}: its open tasks are removed. Nothing is planted yet.`, 'Cancel the batch', true)) return;
      try { await rpc('cancel_crop_plan', { p_ids: [b.id] }); d.close(); toast('Cancelled', 'ok'); await reload(); } catch (e) { toast(e.message, 'bad'); }
    });
    d.footer.append(rm);
  }
}

// ── labels for a week's transplants (0234) ────────────────────────────────────
export function openLabels() {
  const t = farmDate(), today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY;
  const monday = today - ((new Date(today * DAY).getUTCDay() + 6) % 7);
  const real = b => b.status === 'validated' || b.status === 'active';
  const inWeek = w => (S.data.batches || []).filter(b => real(b) && dn(b.stay_from) >= w && dn(b.stay_from) < w + 7);
  const d = drawer('Batch labels', 'One label a batch, staked at its table: the lot code, the crop, the dates and a QR for Naked Brain');
  const choices = [['This week', monday], ['Next week', monday + 7], ['The week after', monday + 14]];
  const list = el('div', 'set-group');
  choices.forEach(([name, w]) => {
    const bs = inWeek(w);
    const r = el('div', 'set-row');
    const go = el('button', 'btn btn-sm', bs.length ? `Print ${bs.length}` : 'None');
    go.disabled = !bs.length;
    go.onclick = async () => { const res = await printLabels(bs.map(b => b.id)); if (res?.length) await reload(); };
    r.append(el('span', null, `${name} · transplants ${nice(ds(w))} – ${nice(ds(w + 6))}`), go);
    list.append(r);
  });
  const sel = (S.data.batches || []).filter(b => S.selected.has(b.id) && b.status !== 'proposed');
  if (sel.length) {
    const r = el('div', 'set-row'); const go = el('button', 'btn btn-sm', `Print ${sel.length}`);
    go.onclick = async () => { const res = await printLabels(sel.map(b => b.id)); if (res?.length) await reload(); };
    r.append(el('span', null, 'The bars selected'), go); list.append(r);
  }
  d.body.append(list, el('div', 'hint', 'Validated and growing batches only, from the dates on screen. A batch gets its lot code the first time its label is printed, if it had none; printing again gives the same code.'));
  const close = el('button', 'btn', 'Close'); close.onclick = d.close; d.footer.append(close);
}

// click on an empty day: pick a crop that fits
export function planHere(sys, p, day) {
  const fitting = (S.data.crops || []).filter(c => fits(c, sys) && !dropProblem(c, sys, p.id, dn(day), null));
  const d = drawer(`Plan ${p.code}`, `${sys.name} · transplant on ${nice(day)}`);
  if (!fitting.length) { d.body.append(el('div', 'note warn', 'No approved crop fits here on that day without running into the next batch.')); return; }
  const crop = selectBox(fitting.map(c => [c.id, c.name]));
  const info = el('div', 'hint');
  const say = () => { const c = fitting.find(x => x.id === crop.value); const y = cycleOf(c, dn(day));
    info.textContent = `Harvest ${nice(ds(y.hs))} – ${nice(ds(y.he))} · free again ${nice(ds(y.to + 1))}` + (y.sow < dn(S.data.today) ? ' · too soon for its seedlings' : ''); };
  crop.onchange = say; say();
  d.body.append(field('Crop', crop), info);
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Propose it');
  go.onclick = async () => {
    busy(go, true, 'Planning…');
    try { await rpc('plan_position', { p_position: p.id, p_crop: crop.value, p_transplant: day }); d.close(); toast('Proposed', 'ok'); await reload(); }
    catch (e) { busy(go, false, 'Propose it'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, go);
}

// ── deciding ─────────────────────────────────────────────────────────────────
export async function propose(button, scope, label) {
  const back = button.textContent;
  busy(button, true, 'Planning…');
  try {
    const r = await rpc('propose_crop_plan', { p_farm: S.farm.id, p_horizon_days: span(), p_system: scope ?? null });
    toast(r.proposed ? `${r.proposed} positions proposed in ${r.scope}`
          : r.nothing_fits ? `${r.nothing_fits} free, but no approved crop fits ${r.scope}`
          : `Nothing to plan — ${r.scope} is full for the window`, r.proposed ? 'ok' : r.nothing_fits ? 'bad' : '');
    await reload();
  } catch (e) { busy(button, false, back); toast(e.message, 'bad'); }
}
export async function validate(button, ids) {
  busy(button, true, 'Validating…');
  try {
    const r = mergeValidated(await rpcInChunks('validate_crop_plan', ids, 'p_ids', 100,
      (n, all) => { if (all > 100) busy(button, true, `Validating ${n} of ${all}…`); }));
    S.selected.clear();
    const c = r.conflicts || [];
    toast(`${r.validated} batch${r.validated === 1 ? '' : 'es'} validated · ${r.tasks_created} tasks` +
      (c.length ? ` · ${c.length} skipped: ${c.map(x => `${x.batch} overlaps ${x.overlaps}`).join(', ')}` : ''), c.length ? 'bad' : 'ok');
    await reload();
  } catch (e) {
    busy(button, false, 'Validate'); toast(e.message, 'bad');
    reload();                         // the pieces that went through are validated: show them so
  }
}
export async function discard(ids) {
  if (!await confirmDrawer('Remove them?', `${ids.length} batch${ids.length === 1 ? '' : 'es'} will be removed. A validated one loses its open tasks; nothing growing is touched.`, 'Remove', true)) return;
  try { await rpcInChunks('cancel_crop_plan', ids); S.selected.clear(); toast('Removed', 'ok'); await reload(); }
  catch (e) { toast(e.message, 'bad'); reload(); }
}
