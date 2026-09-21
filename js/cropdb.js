// ═══════════════════════════════════════════════════════════════════════════
// Crop database — what the platform knows about each crop (spec §7.6)
//
// One row per crop and variety; open one for its cycle, the systems it fits,
// yields, materials, the tasks a batch of it creates, and what it is worth in
// each season. The medium column is the one that decides where it can go
// (§8.3), so it is on the list rather than buried in the detail.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, drawer, num, systemLabel, mediumLabel, systemsFor, toast, input, field, busy } from './ui.js';
import { editCrop } from './crop-edit.js';

// the words on screen for a category code
const CAT_LABEL = { leafy: 'Leafy', mixed_leafy: 'Mixed leafy', herbs: 'Herbs', microgreens: 'Microgreens',
                    fruiting_vines: 'Fruiting vines', fruiting_bush: 'Fruiting bush' };
const catLabel = c => CAT_LABEL[c] || String(c || '').replace('_', ' ');


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

  // archived crops live in their own window, never deleted
  const archived = data.archived || [];
  const arch = el('button', 'btn', `Archive${archived.length ? ` (${archived.length})` : ''}`);
  arch.title = 'Crops taken out of the library. They keep their history and can come back.';
  arch.onclick = () => openArchive();

  mount.append(pageHead('Crop database',
    `${all.length} crops and varieties. What each one needs, how long it takes, ` +
    'what it yields and what it is worth here.', search, arch));

  const chips = el('div', 'chips');
  chips.style.marginBottom = 'var(--space-4)';
  const add = (label, value) => {
    const c = el('button', 'chip' + (filter.cat === value ? ' on' : ''), label);
    c.onclick = () => { filter.cat = value; paint(); };
    chips.append(c);
  };
  add('Everything', '');
  cats.forEach(c => add(catLabel(c), c));
  mount.append(chips);

  mount.append(table([
    { key: 'name', label: 'Crop', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        b.append(el('div', 'hint', r.code));
        return b; } },
    { key: 'category', label: 'Category', fmt: catLabel },
    // the medium and the systems from Farm setup › Available systems and media
    { key: 'media', label: 'Medium', fmt: v => (v || []).map(mediumLabel).join(', ') || '—' },
    { key: 'media', label: 'System', fmt: v => systemsFor(v).map(x => x.label).join(', ') || '—' },
    { key: 'cycle_days', label: 'Cycle', align: 'right', fmt: v => v ? v + ' d' : '—' },
    { key: 'procedures', label: 'Procedures', align: 'right',
      fmt: (v, r) => {
        const s = el('span', r.phases && r.phases_linked < r.phases ? 'warn' : null, v || '—');
        s.title = r.phases ? `${r.phases_linked} of ${r.phases} phases have a procedure` : '';
        return s; } },
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
  const d = drawer(row.name, `${catLabel(row.category)} · ${row.code}`);
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
  fact('Medium', (c.media || []).map(mediumLabel).join(', '));
  fact('System', systemsFor(c.media).map(x => x.label).join(', ') || '—');
  fact('Cycle', c.phases.reduce((n, p) => n + (p.days || 0), 0) + ' days');
  fact('Sold by', c.sell_unit);
  fact('Plugs per tray', c.plugs_per_tray);
  fact('Seedling lead', c.seedling_lead_days ? c.seedling_lead_days + ' days' : '—');
  fact('Rotation group', c.rotation_group);
  fact('Scope', c.scope);
  d.body.append(facts);

  d.body.append(el('div', 'sec-title', 'Cycle, and what a batch does in each phase'));
  d.body.append(table([
    { key: 'seq', label: '#', align: 'right' },
    { key: 'name', label: 'Phase' },
    { key: 'days', label: 'Days', align: 'right' },
    { key: 'procedures', label: 'Procedures', fmt: (v, r) => {
        const w = el('div', 'phase-procs');
        if (!v?.length) { w.append(el('span', 'hint warn', 'none')); return w; }
        v.forEach(pr => {
          const line = el('div');
          const t = el('span', 'phase-proc', pr.title);
          t.title = `${pr.estimated_minutes ?? 0} min + ${pr.minutes_per_unit ?? 0} per ${pr.unit || 'unit'}`;
          line.append(t, el('span', 'hint',
            ` day ${pr.day_offset >= 0 ? '+' : ''}${pr.day_offset}` +
            (pr.repeat_days ? `, every ${pr.repeat_days} d` : '')));
          w.append(line);
        });
        return w; } },
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
  d.footer.append(close);
  if (c.may_edit) {
    const archive = el('button', 'btn btn-danger', 'Archive');
    archive.onclick = () => { d.close(); archiveCrop(c); };
    const edit = el('button', 'btn btn-primary', 'Edit');
    edit.onclick = () => { d.close(); editCrop(c, load, farm); };
    d.footer.append(archive, edit);
  } else {
    d.footer.prepend(el('span', 'hint', 'Only the franchisor edits a standard crop.'));
  }
}

// ── the archive ────────────────────────────────────────────────────────────
// A crop leaves the library with a reason and keeps everything that points at
// it — batches, harvests, prices. Restore brings it back with the status it had.
function archiveCrop(c) {
  const d = drawer('Archive ' + c.name, 'It leaves the Crop database and the planner; nothing about it is deleted.');
  const reason = input({ placeholder: 'Why (optional)' });
  d.body.append(field('Reason', reason));
  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const ok = el('button', 'btn btn-danger', 'Archive');
  ok.onclick = async () => {
    busy(ok, true, 'Archiving…');
    try {
      const r = await rpc('archive_crop', { p_crop: c.id, p_reason: reason.value.trim() || null });
      d.close();
      toast(`${c.name} archived` + (r.batches ? ` · ${r.batches} live batch${r.batches === 1 ? '' : 'es'} finish as planned` : ''), 'ok');
      await load();
    } catch (e) { busy(ok, false, 'Archive'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

function openArchive() {
  const rows = data.archived || [];
  const d = drawer('Archived crops', `${rows.length} crop${rows.length === 1 ? '' : 's'} out of the library, kept with their history`);
  d.box.style.width = 'min(760px, 100vw)';
  d.body.append(table([
    { key: 'name', label: 'Crop', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        b.append(el('div', 'hint', [r.code, r.variety].filter(Boolean).join(' · ')));
        return b; } },
    { key: 'category', label: 'Category', fmt: catLabel },
    { key: 'archived_at', label: 'Since', fmt: v => v ? new Date(v).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
    { key: 'reason', label: 'Why' },
    { key: 'batches', label: 'Live batches', align: 'right', fmt: v => v || '—' },
    { key: 'id', label: '', fmt: (v, r) => {
        if (!data.may_edit) return '';
        const b = el('button', 'btn btn-sm', 'Restore');
        b.onclick = async e => {
          e.stopPropagation();
          busy(b, true, '…');
          try {
            const x = await rpc('restore_crop', { p_crop: v });
            toast(`${r.name} is back (${x.status})`, 'ok');
            d.close();
            await load();
          } catch (err) { busy(b, false, 'Restore'); toast(err.message, 'bad'); }
        };
        return b; } },
  ], rows, { empty: 'Nothing archived.' }));
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}
