// ═══════════════════════════════════════════════════════════════════════════
// Harvest — what actually came off the bench (spec §9, §10.7)
//
// The one number the platform cannot work out for itself. Everything else is
// derived: the plan predicts a yield, the tasks follow from it, the price book
// values it. Somebody still has to put the crop on a scale, and until they do,
// every yield in the crop database is a figure out of a book.
//
// So the screen is a short list — what is ready to cut, and what was cut — and
// one form with a weight in it. Recording the last cut closes the batch, frees
// the position, and moves the learned yield toward the truth.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, card, drawer, field, input, selectBox,
         toast, busy, num, shortDate } from './ui.js';

let farm = null, data = null, mount = null;

export async function renderHarvest(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the harvest…'));
  try { data = await rpc('harvests', { p_farm: farm.id, p_days: 30 }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const due = data.ready.filter(r => r.due_in_days <= 0).length;

  mount.append(pageHead('Harvest',
    `${num(data.total_kg, 1)} kg in the last 30 days · ` +
    `${due} batch${due === 1 ? '' : 'es'} ready to cut` +
    `${data.ready.length - due ? `, ${data.ready.length - due} within the week` : ''}.`));

  const ready = card('Ready to cut');
  ready.append(table([
    { key: 'crop', label: 'Crop', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        b.append(el('div', 'hint', r.batch));
        return b; } },
    { key: 'position', label: 'Where', fmt: (v, r) => `${v} · ${r.system}` },
    { key: 'harvest_start', label: 'From', fmt: (v, r) => {
        const s = el('span', r.due_in_days <= 0 ? 'up' : null, shortDate(v));
        s.title = r.due_in_days <= 0 ? 'ready now' : `in ${r.due_in_days} days`;
        return s; } },
    { key: 'expected_kg', label: 'Expected', align: 'right',
      fmt: v => v == null ? '—' : num(v, 1) + ' kg' },
    { key: 'cut_so_far', label: 'Cut so far', align: 'right',
      fmt: (v, r) => v ? `${num(v, 1)} kg in ${r.cuts}` : '—' },
    { key: 'id', label: '', align: 'right', fmt: (v, r) => {
        if (!data.may_record) return '';
        const b = el('button', 'btn btn-sm btn-primary', 'Weigh it in');
        b.onclick = e => { e.stopPropagation(); recordFor(r); };
        return b; } },
  ], data.ready, {
    empty: 'Nothing ready within the week. The dates come from the crop plan.',
  }));
  mount.append(ready);

  const recent = card('Cut in the last 30 days');
  recent.append(table([
    { key: 'date', label: 'When', fmt: shortDate },
    { key: 'crop', label: 'Crop' },
    { key: 'position', label: 'Where' },
    { key: 'cut', label: 'Cut', align: 'right' },
    { key: 'qty', label: 'Weight', align: 'right',
      fmt: (v, r) => `${num(v, 1)} ${r.unit}` },
    { key: 'expected_kg', label: 'Against plan', align: 'right', fmt: (v, r) => {
        if (!v) return '—';
        const pct = Math.round(100 * r.qty / v);
        return el('span', pct >= 95 ? 'up' : pct < 75 ? 'down' : null, pct + '%'); } },
    { key: 'waste', label: 'Waste', align: 'right',
      fmt: v => v ? num(v, 1) + ' kg' : '—' },
    { key: 'destination', label: 'Went to' },
  ], data.recent, {
    empty: 'Nothing recorded yet. Until a real weight lands here, every yield in ' +
           'the crop database is a figure out of a book.',
  }));
  mount.append(recent);
}

function recordFor(batch) {
  const d = drawer('Weigh in ' + batch.crop, `${batch.batch} · ${batch.position}`);

  const qty = input({ type: 'number', step: '0.1', required: true });
  const waste = input({ type: 'number', step: '0.1', value: '' });
  const when = input({ type: 'date' });
  const dest = selectBox([['', '—'], ['direct', 'Direct customer'], ['retail', 'Retailer'],
                          ['market', 'Market'], ['own', 'Own use']], '');
  const grade = selectBox([['', '—'], ['A', 'Grade A'], ['B', 'Grade B']], '');
  const final = el('input');
  final.type = 'checkbox';

  const expected = batch.expected_kg
    ? `The plan expected ${num(batch.expected_kg, 1)} kg from this batch` +
      (batch.cut_so_far ? `; ${num(batch.cut_so_far, 1)} kg has already come off.` : '.')
    : 'No expected weight on this batch.';

  d.body.append(el('p', 'hint', expected));
  d.body.append(field('Weight (kg)', qty));
  d.body.append(field('Waste (kg)', waste, 'What was cut and thrown, if any.'));
  d.body.append(field('Date', when, 'Today unless it sat in the cold room.'));
  d.body.append(field('Went to', dest));
  d.body.append(field('Grade', grade));

  const lastRow = el('label', 'row');
  lastRow.style.marginTop = 'var(--space-3)';
  lastRow.append(final, el('span', null, 'This was the last cut — close the batch'));
  d.body.append(lastRow);
  d.body.append(el('p', 'hint',
    'Closing the batch frees the position and teaches the crop database what this ' +
    'crop really yields on this system. Half a crop weighed mid-cut is not a yield, ' +
    'so nothing is learned until the batch is closed.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Record it');
  save.onclick = async () => {
    if (!qty.value || Number(qty.value) <= 0) { toast('It needs a weight', 'bad'); return; }
    busy(save, true, 'Recording…');
    try {
      const r = await rpc('record_harvest', { p: {
        crop_plan_id: batch.id, qty: Number(qty.value),
        waste_qty: waste.value === '' ? null : Number(waste.value),
        date: when.value || null, destination: dest.value || null,
        grade: grade.value || null, final: final.checked } });
      d.close();
      toast(r.closed
        ? `${num(r.total_kg, 1)} kg total, batch closed` +
          (r.learned ? ' — the crop database learned from it' : '')
        : `Cut ${r.cut} recorded · ${num(r.total_kg, 1)} kg so far`, 'ok');
      await load();
    } catch (e) { busy(save, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}
