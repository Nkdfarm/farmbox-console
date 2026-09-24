// ═══════════════════════════════════════════════════════════════════════════
// Crop database — what the platform knows about each crop (spec §7.6)
//
// One page, crops and their procedures together (owner, 22 Sept 2026, after
// the 0.7.57 package's demo): the crops grouped by family, each one a row
// that opens to its cycle — every phase with the procedures a batch runs in
// it, at a day offset, once or every n days. On the row: plugs per tray,
// Edit phases (inline), Plan this crop, Archive…, and Details for everything
// else (yields, targets, materials, prices, batches, the full editor).
// Page head: Plan a crop, Archive (the window of archived crops, with Restore).
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, table, pageHead, drawer, field, input, selectBox, num, toast, busy, ymd, sowingLine, cropAvatar,
         systemLabel, mediumLabel, systemsFor, nurseryField } from './ui.js';
import { editCrop } from './crop-edit.js';

// the words on screen, and a colour, for a category code
const CATS = {
  fruiting_vines: ['Fruiting vines', '#b5451b'], fruiting_bush: ['Fruiting bush', '#c2731f'],
  leafy: ['Leafy', '#2e7d32'], mixed_leafy: ['Mixed leafy', '#4c8c2b'],
  herbs: ['Herbs', '#1f7a5c'], microgreens: ['Microgreens', '#3b6fb6'],
};
const CAT_ORDER = Object.keys(CATS);
const catLabel = c => CATS[c]?.[0] || String(c || '').replace('_', ' ');
const catColour = c => CATS[c]?.[1] || '#888';
const UNIT_WORD = { tray: 'tray', plant: 'plant', position: 'position', m2: 'm²', system: 'system', batch: 'batch' };

let farm = null, data = null, mount = null, filter = { q: '', raw: '' };
let procs = null;          // approved procedures, for the inline phase editor
const opened = new Set();  // crop ids the person opened (everything is folded by default)

export async function renderCropDb(container, currentFarm) {
  if (farm?.id !== currentFarm.id) { opened.clear(); procs = null; }
  farm = currentFarm; mount = container;
  procs = null;   // a procedure approved since is offered next time the editor opens
  await load();
}

// last time's copy at once, the server's answer behind it (openFast, 0.7.108)
async function load() {
  const here = mount;
  await openFast([['crop_library', { p_farm: farm.id }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the crop library…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here,
  });
}

async function procedureList() {
  if (procs) return procs;
  try {
    const d = await rpc('procedures', { p_farm: farm.id });
    procs = (d.procedures || []).filter(x => x.status === 'approved')
      .sort((a, b) => (a.trigger === 'crop_plan' ? 0 : 1) - (b.trigger === 'crop_plan' ? 0 : 1) || a.title.localeCompare(b.title));
  } catch (e) { toast(e.message, 'bad'); return []; }
  return procs;
}

function paint() {
  mount.textContent = '';
  const all = data.crops;
  const q = filter.q;
  const shown = all.filter(c => !q || c.name.toLowerCase().includes(q) || catLabel(c.category).toLowerCase().includes(q));

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search crops';
  search.value = filter.raw;
  search.setAttribute('aria-label', 'Search crops');
  search.oninput = () => {
    filter.raw = search.value; filter.q = search.value.trim().toLowerCase();
    paint();
    const s = mount.querySelector('input[type=search]');
    if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  };
  search.style.minWidth = '200px';

  const plan = data.may_plan ? el('button', 'btn btn-primary', 'Plan a crop') : null;
  if (plan) plan.onclick = () => openPlan(null);

  const archived = data.archived || [];
  const arch = el('button', 'btn', `Archive${archived.length ? ` (${archived.length})` : ''}`);
  arch.title = 'Crops taken out of the library. They keep their history and can come back.';
  arch.onclick = () => openArchive();

  mount.append(pageHead(null,
    'Open a crop to see its cycle and the procedure a batch runs on every phase. ' +
    'A procedure link opens its checklist; every procedure is on Grow › Procedures.', search, arch, plan));

  // the counts, then Crops | Procedures
  const nPh = all.reduce((n, c) => n + (Number(c.phases) || 0), 0);
  const nLk = all.reduce((n, c) => n + (Number(c.links) || 0), 0);
  const kpi = el('div', 'cropdb-kpi');
  [[all.length, 'crops'], [new Set(all.map(c => c.category)).size, 'families'], [nPh, 'phases'],
   [nLk, 'phase→procedure links'], [(data.procedures || []).length, 'procedures']]
    .forEach(([n, w]) => { const k = el('span'); k.append(el('b', null, String(n)), ' ' + w); kpi.append(k); });
  mount.append(kpi);

  // the crops only (0.7.109): the procedures live on Grow › Procedures
  const tabs = el('div', 'row cropdb-tabs');
  const anyOpen = shown.some(c => opened.has(c.id));
  const fold = el('button', 'btn btn-sm btn-ghost', anyOpen ? 'Fold all' : 'Open all');
  fold.onclick = () => { shown.forEach(c => anyOpen ? opened.delete(c.id) : opened.add(c.id)); paint(); };
  tabs.append(el('div', 'spacer'), fold);
  mount.append(tabs);

  const list = el('div', 'cropdb');
  if (!shown.length) list.append(el('div', 'empty', 'No crop matches that.'));
  const byCat = new Map();
  shown.forEach(c => { if (!byCat.has(c.category)) byCat.set(c.category, []); byCat.get(c.category).push(c); });
  [...byCat.keys()].sort((a, b) => CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b)).forEach(cat => {
    const crops = byCat.get(cat).sort((a, b) => a.name.localeCompare(b.name));
    const fam = el('div', 'cropdb-fam');
    const dot = el('i');
    dot.style.background = catColour(cat);
    fam.append(dot, el('b', null, catLabel(cat)), el('span', 'hint', ` · ${crops.length}`));
    list.append(fam);
    crops.forEach(c => list.append(cropRow(c)));
  });
  mount.append(list);
}

// ── one crop, opened to its cycle ──────────────────────────────────────────
function cropRow(c) {
  const d = el('details', 'cropdb-row');
  d.open = opened.has(c.id);
  const sum = el('summary');
  const left = el('span', 'cropdb-name');
  left.append(cropAvatar(c));
  const txt = el('span');
  left.append(txt);
  txt.append(el('b', null, c.name));
  const sys = systemsFor(c.media).map(x => x.label).join(', ');
  txt.append(el('div', 'hint',
    [(c.media || []).map(mediumLabel).join(', '), sys, `${c.plugs_per_tray} plugs/tray`,
     `${c.phases} phase${c.phases === 1 ? '' : 's'}`].filter(Boolean).join(' · ')));
  const right = el('span', 'cropdb-right');
  const pr = el('span', c.phases && c.phases_linked < c.phases ? 'warn' : 'hint',
    c.procedures ? `${c.procedures} procedure${c.procedures === 1 ? '' : 's'}` : 'no procedures');
  pr.title = c.phases ? `${c.phases_linked} of ${c.phases} phases have a procedure` : '';
  right.append(pr, el('span', 'mono', c.cycle_days ? `${c.cycle_days} days` : '—'),
               el('span', 'pill' + (c.status === 'approved' ? ' ok' : ' warn'), c.status));
  if (c.batches) right.append(el('span', 'pill', `${c.batches} growing`));
  sum.append(left, right);
  d.append(sum);
  const body = el('div', 'cropdb-body');
  d.append(body);
  d.addEventListener('toggle', () => { if (d.open) opened.add(c.id); else opened.delete(c.id); });
  let gen = 0;   // a second paint (Edit pressed twice) supersedes the first
  paintBody();

  // the cycle came with the list; may_edit is per crop (can_write_scoped on the server)
  async function paintBody(editing = false) {
    const my = ++gen;
    body.textContent = '';
    const full = { ...c, may_edit: c.may_edit ?? data.may_edit, phases: c.cycle || [] };

    // ── the tools ──
    const tools = el('div', 'row cropdb-tools');
    if (full.may_edit) {
      const plugs = input({ type: 'number', min: 1, step: '1', value: full.plugs_per_tray ?? 72 });
      plugs.style.width = '70px';
      plugs.title = 'Turns plants into trays for a procedure counted per tray';
      plugs.onchange = async () => {
        const v = parseInt(plugs.value, 10);
        if (!(v > 0)) return;
        try { await rpc('save_crop', { p_crop: c.id, p: { plugs_per_tray: v } }); toast('Plugs per tray saved', 'ok'); c.plugs_per_tray = v; paint(); }
        catch (e) { toast(e.message, 'bad'); }
      };
      const lbl = el('label', 'hint', 'Plugs per tray ');
      lbl.append(plugs);
      tools.append(lbl);
      const edit = el('button', 'btn btn-sm' + (editing ? '' : ' btn-primary'), editing ? 'Cancel' : 'Edit phases');
      edit.onclick = () => paintBody(!editing);
      tools.append(edit);
      if (editing) {
        const save = el('button', 'btn btn-sm btn-primary', 'Save phases');
        save.onclick = () => savePhases(save);
        tools.append(save);
      }
    }
    if (data.may_plan && full.status === 'approved') {
      const p = el('button', 'btn btn-sm', 'Plan this crop');
      p.onclick = () => openPlan(full);
      tools.append(p);
    }
    tools.append(el('div', 'spacer'));
    const det = el('button', 'btn btn-sm btn-ghost', 'Details');
    det.title = 'Yields, targets, materials, prices, batches — and the full editor';
    det.onclick = () => openCrop(c);
    tools.append(det);
    if (full.may_edit) {
      const a = el('button', 'btn btn-sm btn-ghost', 'Archive…');
      a.onclick = () => archiveCrop(full);
      tools.append(a);
    }
    body.append(tools);

    // ── the phases ──
    const phases = (full.phases || []).map(p => ({ ...p, procedures: (p.procedures || []).map(x => ({ ...x })) }));
    const list = editing ? await procedureList() : [];
    if (my !== gen) return;
    let day = 0;
    if (!phases.length) body.append(el('div', 'hint', 'No cycle yet — the planner will not place this crop.'));
    phases.forEach((p, i) => {
      const row = el('div', 'cropdb-phase');
      const head = el('div');
      head.append(el('b', null, `${i + 1}. ${p.name}`));
      head.append(el('div', 'mono hint', `day ${day} · ${Number(p.days) || 0} d`));
      const right = el('div', 'cropdb-procs');
      if (!editing) {
        p.procedures.forEach(pr => {
          const line = el('div', 'cropdb-proc');
          const a = el('button', 'linkish', pr.title);
          a.type = 'button';
          a.onclick = () => openProcedure(pr);
          const off = Number(pr.day_offset) || 0;
          const per = Number(pr.minutes_per_unit) || 0;
          line.append(a, el('span', 'mono hint',
            ` ${off < 0 ? '−' : '+'}${Math.abs(off)}${pr.repeat_days ? ` every ${pr.repeat_days} d` : ''} · ${num(pr.estimated_minutes, 0)}` +
            (per ? ` + ${num(per, 1)}/${UNIT_WORD[pr.unit] || pr.unit || 'unit'}` : '') + ' min'));
          right.append(line);
        });
        if (!p.procedures.length) right.append(el('span', 'hint warn', 'No procedure on this phase.'));
      } else {
        const paintEdit = () => {
          right.textContent = '';
          p.procedures.forEach((pr, j) => {
            const line = el('div', 'row cropdb-proc-edit');
            const opts = list.map(x => [x.id, x.title]);
            if (pr.sop_id && !list.some(x => x.id === pr.sop_id)) opts.unshift([pr.sop_id, (pr.title || 'procedure') + ' (not approved)']);
            const pick = selectBox(opts, pr.sop_id);
            pick.onchange = () => { pr.sop_id = pick.value; };
            const off = input({ type: 'number', step: '1', value: pr.day_offset ?? 0 });
            off.style.width = '60px';
            off.oninput = () => { pr.day_offset = off.value; };
            const rep = input({ type: 'number', min: 1, step: '1', value: pr.repeat_days ?? '', placeholder: 'once' });
            rep.style.width = '60px';
            rep.oninput = () => { pr.repeat_days = rep.value; };
            const x = el('button', 'btn btn-sm btn-ghost', '✕');
            x.type = 'button';
            x.onclick = () => { p.procedures.splice(j, 1); paintEdit(); };
            line.append(pick, el('span', 'hint', 'day'), off, el('span', 'hint', 'every'), rep, el('span', 'hint', 'd'), x);
            right.append(line);
          });
          const add = el('button', 'btn btn-sm', '+ procedure');
          add.type = 'button';
          add.onclick = () => { p.procedures.push({ sop_id: list[0]?.id, day_offset: 0, repeat_days: '' }); paintEdit(); };
          right.append(add);
        };
        paintEdit();
      }
      row.append(head, right);
      body.append(row);
      day += Number(p.days) || 0;
    });

    async function savePhases(btn) {
      busy(btn, true, 'Saving…');
      try {
        const r = await rpc('save_crop', { p_crop: c.id, p: {
          phases: phases.map(p => ({ name: p.name, type: p.type || 'vegetative', days: p.days ?? 0, cues: p.cues || '',
            procedures: p.procedures.filter(x => x.sop_id).map(x => ({ sop_id: x.sop_id,
              day_offset: parseInt(x.day_offset, 10) || 0, repeat_days: parseInt(x.repeat_days, 10) || '' })) })),
        } });
        toast(`Phases saved · ${r.procedures} procedure link${r.procedures === 1 ? '' : 's'}` +
              (r.replanned ? ` · ${r.replanned} batch${r.replanned === 1 ? '' : 'es'} replanned` : ''), 'ok');
        await load();
      } catch (e) { busy(btn, false, 'Save phases'); toast(e.message, 'bad'); }
    }
  }
  return d;
}

// ── the procedures a batch runs, with their checklists ─────────────────────
// ── a procedure, read only ─────────────────────────────────────────────────
async function openProcedure(pr) {
  const d = drawer(pr.title, 'Read only — edit it on Procedures');
  d.body.append(loading('Reading…'));
  let p;
  try { p = await rpc('procedure', { p_sop: pr.sop_id, p_farm: farm.id }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
  d.body.textContent = '';
  d.body.append(el('div', 'hint',
    `Version ${p.version ?? '—'} · ${num(p.minutes, 0)} min` + (p.minutes_per_unit ? ` + ${num(p.minutes_per_unit, 1)} per ${p.unit || 'unit'}` : '') +
    (p.purpose ? ` · ${p.purpose}` : '')));
  d.body.append(table([
    { key: 'seq', label: '#', align: 'right' },
    { key: 'title', label: 'Step', fmt: (v, s) => {
        const b = el('div');
        b.append(el('b', null, v));
        if (s.instruction) b.append(el('div', 'hint', s.instruction));
        return b; } },
    { key: 'type', label: 'Type', fmt: (v, s) => v === 'measure' && (s.min != null || s.max != null)
        ? `${v} ${s.min ?? ''}–${s.max ?? ''} ${s.unit || ''}` : v },
    { key: 'expected', label: 'Expected' },
  ], p.steps || [], { empty: 'No checklist steps.' }));
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

// ── plan a crop: pick a zone and its free positions ────────────────────────
async function openPlan(full) {
  const d = drawer(full ? `Plan ${full.name}` : 'Plan a crop', 'A batch on each position you tick; the tasks follow from the cycle.');
  d.body.append(loading('Reading the farm…'));
  let map;
  try { map = await rpc('crop_map', { p_farm: farm.id }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
  d.body.textContent = '';

  const crops = (map.crops || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const crop = selectBox(crops.map(c => [c.id, c.name]), full?.id ?? crops[0]?.id);
  const zone = selectBox([], '');
  const when = input({ type: 'date', value: ymd(new Date()) });
  const posBox = el('div', 'cropdb-positions');
  const chosen = new Set();

  const fitsZones = () => {
    const c = crops.find(x => x.id === crop.value);
    return (map.systems || []).filter(s =>
      (c?.media || []).some(m => (s.media || []).includes(m))
      && (!(s.categories || []).length || s.categories.includes(c?.category)));
  };
  const paintZones = () => {
    const zs = fitsZones();
    zone.textContent = '';
    zs.forEach(s => { const o = el('option', null, `${s.name} · ${systemLabel(s.type)}`); o.value = s.id; zone.append(o); });
    zone.disabled = !zs.length;
    paintPositions();
  };
  const paintPositions = () => {
    posBox.textContent = '';
    chosen.clear();
    const s = (map.systems || []).find(x => x.id === zone.value);
    if (!s) { posBox.append(el('div', 'note warn', 'No zone grows this crop — give it that medium on the crop, or widen a zone.')); return; }
    // crop_map already lists only live batches; a position out of service is not offered
    const free = (s.positions || []).filter(p => !['maintenance', 'out_of_service'].includes(p.status) && !(p.batches || []).length);
    if (!free.length) { posBox.append(el('div', 'hint', 'Every position in this zone has a batch on it.')); return; }
    const all = el('button', 'btn btn-sm', 'All free');
    all.type = 'button';
    all.onclick = () => { posBox.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; chosen.add(cb.value); }); };
    posBox.append(all);
    free.forEach(p => {
      const lbl = el('label', 'cropdb-pos');
      const cb = el('input'); cb.type = 'checkbox'; cb.value = p.id;
      cb.onchange = () => { cb.checked ? chosen.add(p.id) : chosen.delete(p.id); };
      lbl.append(cb, el('span', null, ` ${p.code}`), el('span', 'hint', ` · ${Number(p.capacity || 0).toLocaleString('en-ZA')} places`));
      posBox.append(lbl);
    });
  };
  const nurs = nurseryField(crops.find(x => x.id === crop.value));
  crop.onchange = () => { nurs.set(crops.find(x => x.id === crop.value)); paintZones(); };
  zone.onchange = paintPositions;
  paintZones();

  d.body.append(field('Crop', crop), field('Zone', zone),
    field('Transplant on', when, 'The sowing date follows from the cycle; work before today is not created.'),
    nurs.field, field('Positions', posBox));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Create the batches');
  go.onclick = async () => {
    if (!chosen.size) { toast('Tick at least one position', 'bad'); return; }
    busy(go, true, 'Planning…');
    try {
      const ids = [];
      for (const pid of chosen) {
        const r = await rpc('plan_position', { p_position: pid, p_crop: crop.value, p_transplant: when.value || null });
        if (r?.id && nurs.value() && r.nursery !== nurs.value())
          await rpc('set_batch_nursery', { p_plan: r.id, p_nursery: nurs.value() });
        if (r?.id) ids.push(r.id);
      }
      const v = await rpc('validate_crop_plan', { p_ids: ids });
      d.close();
      toast(`${v.validated} batch${v.validated === 1 ? '' : 'es'} planned · ${v.tasks_created} task${v.tasks_created === 1 ? '' : 's'} created`, 'ok');
      await load();
    } catch (e) { busy(go, false, 'Create the batches'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, go);
}

// ── everything else about a crop ───────────────────────────────────────────
async function openCrop(row) {
  const d = drawer(row.name, `${catLabel(row.category)} · ${row.code}`);
  d.body.append(loading('Reading…'));

  let c;
  try { c = await rpc('crop_detail', { p_crop: row.id, p_farm: farm.id }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }

  d.body.textContent = '';
  // the picture, big, at the top (0088)
  const pic = cropAvatar(c, 'lg');
  pic.style.margin = '0 0 var(--space-3)';
  d.body.append(pic);
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
  fact('Seedlings', !c.has_nursery ? 'Starts in place' : c.nursery === 'external'
    ? `External nursery · order ${c.nursery_lead ?? '—'} days ahead` : `Internal nursery (external: ${c.nursery_lead ?? '—'} days ahead)`);
  fact('Rotation group', c.rotation_group);
  fact('Scope', c.scope);
  fact('Sowing', sowingLine(c.sowing) || '—');
  d.body.append(facts);

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
    const edit = el('button', 'btn btn-primary', 'Edit');
    edit.onclick = () => { d.close(); editCrop(c, load, farm); };
    d.footer.append(edit);
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
