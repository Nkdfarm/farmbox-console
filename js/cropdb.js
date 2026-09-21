// ═══════════════════════════════════════════════════════════════════════════
// Crop database — what the platform knows about each crop (spec §7.6)
//
// One row per crop and variety; open one for its cycle, the systems it fits,
// yields, materials, the tasks a batch of it creates, and what it is worth in
// each season. The medium column is the one that decides where it can go
// (§8.3), so it is on the list rather than buried in the detail.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, drawer, num, systemLabel } from './ui.js';

const MEDIUM = {
  net_cup: 'channel', pot: 'pot', tray: 'tray', rockwool: 'rockwool', slab: 'slab', bucket: 'bucket',
};

let farm = null, data = null, mount = null, filter = { cat: '', q: '' };

export async function renderCropDb(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the crop library…'));
  try { data = await rpc('crop_library', { p_farm: farm.id }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const all = data.crops;
  const cats = [...new Set(all.map(c => c.category))].sort();
  const shown = all.filter(c =>
    (!filter.cat || c.category === filter.cat) &&
    (!filter.q || c.name.toLowerCase().includes(filter.q)));

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Find a crop';
  search.value = filter.q;
  search.oninput = () => { filter.q = search.value.trim().toLowerCase(); paint(); search.focus(); };
  search.style.minWidth = '200px';

  mount.append(pageHead('Crop database',
    `${all.length} crops and varieties. What each one needs, how long it takes, ` +
    'what it yields and what it is worth here.', search));

  const chips = el('div', 'chips');
  chips.style.marginBottom = 'var(--space-4)';
  const add = (label, value) => {
    const c = el('button', 'chip' + (filter.cat === value ? ' on' : ''), label);
    c.onclick = () => { filter.cat = value; paint(); };
    chips.append(c);
  };
  add('Everything', '');
  cats.forEach(c => add(c.replace('_', ' '), c));
  mount.append(chips);

  mount.append(table([
    { key: 'name', label: 'Crop', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        b.append(el('div', 'hint', r.code));
        return b; } },
    { key: 'category', label: 'Category', fmt: v => String(v).replace('_', ' ') },
    { key: 'media', label: 'Grows in', fmt: v => (v || []).map(m => MEDIUM[m] || m).join(', ') },
    { key: 'cycle_days', label: 'Cycle', align: 'right', fmt: v => v ? v + ' d' : '—' },
    { key: 'yield_per_position', label: 'kg/plant', align: 'right',
      fmt: v => v == null ? '—' : num(v, 3) },
    { key: 'price', label: `Price/kg`, align: 'right',
      fmt: v => v == null ? '—' : `${data.currency} ${num(v, 2)}` },
    { key: 'batches', label: 'Growing', align: 'right', fmt: v => v || '—' },
    { key: 'status', label: 'Status', fmt: v =>
        el('span', 'pill' + (v === 'approved' ? ' ok' : ' warn'), v) },
  ], shown, {
    onRow: r => openCrop(r),
    empty: 'No crop matches that.',
  }));
}

async function openCrop(row) {
  const d = drawer(row.name, `${row.category.replace('_', ' ')} · ${row.code}`);
  d.body.append(el('div', 'empty', 'Reading…'));

  let c;
  try { c = await rpc('crop_detail', { p_crop: row.id, p_farm: farm.id }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }

  d.body.textContent = '';
  const facts = el('div', 'facts');
  const fact = (k, v) => {
    const f = el('div', 'fact');
    f.append(el('span', 'fact-k', k), el('span', 'fact-v', v ?? '—'));
    facts.append(f);
  };
  fact('Grows in', (c.media || []).map(m => MEDIUM[m] || m).join(', '));
  fact('Cycle', c.phases.reduce((n, p) => n + (p.days || 0), 0) + ' days');
  fact('Sold by', c.sell_unit);
  fact('Seedling lead', c.seedling_lead_days ? c.seedling_lead_days + ' days' : '—');
  fact('Rotation group', c.rotation_group);
  fact('Scope', c.scope);
  d.body.append(facts);

  d.body.append(el('div', 'sec-title', 'Cycle'));
  d.body.append(table([
    { key: 'seq', label: '#', align: 'right' },
    { key: 'name', label: 'Phase' },
    { key: 'days', label: 'Days', align: 'right' },
    { key: 'cues', label: 'What it looks like' },
  ], c.phases, { empty: 'No phases — the planner will not touch this crop.' }));

  d.body.append(el('div', 'sec-title', 'Systems and yield'));
  d.body.append(table([
    { key: 'system_type', label: 'System', fmt: systemLabel },
    { key: 'yield_per_position', label: 'kg/plant', align: 'right',
      fmt: v => v == null ? '—' : num(v, 3) },
    { key: 'yield_per_m2_cycle', label: 'kg/m²/cycle', align: 'right',
      fmt: v => v == null ? '—' : num(v, 2) },
    { key: 'manual', label: 'Source', fmt: v => v ? 'measured here' : 'library' },
  ], c.systems, { empty: 'No yields recorded.' }));

  if (c.targets.length) {
    d.body.append(el('div', 'sec-title', 'Targets by phase'));
    d.body.append(table([
      { key: 'phase', label: 'Phase' },
      { key: 'air', label: 'Air °C' },
      { key: 'rh', label: 'RH %' },
      { key: 'ec', label: 'EC' },
      { key: 'ph', label: 'pH' },
    ], c.targets));
  }

  if (c.bom.length) {
    d.body.append(el('div', 'sec-title', 'Materials'));
    d.body.append(table([
      { key: 'item', label: 'Item' },
      { key: 'qty', label: 'Quantity', align: 'right', fmt: (v, r) => `${num(v, 3)} ${r.unit || ''}` },
      { key: 'per', label: 'Per' },
      { key: 'phase', label: 'At' },
    ], c.bom));
  }

  if (c.tasks.length) {
    d.body.append(el('div', 'sec-title', 'What a batch makes somebody do'));
    d.body.append(table([
      { key: 'name', label: 'Task' },
      { key: 'anchor', label: 'From' },
      { key: 'offset_days', label: 'Offset', align: 'right', fmt: v => (v > 0 ? '+' : '') + v + ' d' },
      { key: 'procedure', label: 'Procedure' },
    ], c.tasks));
  }

  if (c.prices.length) {
    d.body.append(el('div', 'sec-title', 'Price by season'));
    d.body.append(table([
      { key: 'channel', label: 'Sold to' },
      { key: 'season', label: 'Season' },
      { key: 'price', label: 'Per kg', align: 'right',
        fmt: (v, r) => `${r.currency} ${num(v, 2)}` },
    ], c.prices));
  }

  if (c.batches.length) {
    d.body.append(el('div', 'sec-title', 'Growing here now'));
    d.body.append(table([
      { key: 'batch', label: 'Batch' },
      { key: 'position', label: 'Where' },
      { key: 'status', label: 'Status' },
      { key: 'harvest', label: 'Harvest' },
      { key: 'yield', label: 'kg', align: 'right', fmt: v => num(v, 1) },
    ], c.batches));
  }

  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(el('span', 'hint',
    'The library is the standard package. A farm-specific change is an override (§5.6), not an edit here.'));
  d.footer.append(el('div', 'spacer'));
  d.footer.append(close);
}
