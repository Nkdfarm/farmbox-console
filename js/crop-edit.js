// ═══════════════════════════════════════════════════════════════════════════
// Crop database › Edit (migration 0058, console 0.7.50; procedures on phases
// and plugs per tray since 0.7.57, migrations 0061–0062)
//
// A crop's details, its medium (from Farm setup › Available systems and media),
// its growing cycle — each phase with the procedures a batch runs in it, at a
// day offset, once or every n days — and its yield on each system, saved with
// one call to save_crop, which replans the live batches. Batches already planned keep their dates; new plans read the new
// cycle. A yield typed here is the farm's own figure and the library seed never
// overwrites it; leaving it empty goes back to the library figure.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, api, URL_BASE } from './api.js';
import { el, field, input, selectBox, toast, drawer, busy, mediaList, systemTypes, systemsFor, num, sowingLine, cropAvatar } from './ui.js';

const CATEGORIES = [['leafy', 'Leafy'], ['mixed_leafy', 'Mixed leafy'], ['herbs', 'Herbs'],
                    ['microgreens', 'Microgreens'], ['fruiting_vines', 'Fruiting vines'], ['fruiting_bush', 'Fruiting bush']];
const STATUS = [['approved', 'Approved'], ['draft', 'Draft'], ['archived', 'Archived']];
const SELL = [['kg', 'By the kg'], ['piece', 'Each'], ['bunch', 'Bunch'], ['punnet', 'Punnet']];
const PHASES = [['germination', 'Germination'], ['nursery', 'Nursery'], ['transplant', 'Transplant'],
                ['vegetative', 'Vegetative'], ['flowering', 'Flowering'],
                ['harvest_window', 'Harvest window'], ['cleanup', 'Clean-up']];

function toggles(options, chosen, onChange) {
  const on = new Set(chosen || []);
  const row = el('div', 'row');
  row.style.flexWrap = 'wrap';
  options.forEach(([v, text]) => {
    const b = el('button', 'toggle', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on.has(v)));
    b.onclick = () => {
      if (on.has(v)) on.delete(v); else on.add(v);
      b.setAttribute('aria-pressed', String(on.has(v)));
      onChange?.([...on]);
    };
    row.append(b);
  });
  row.value = () => [...on];
  return row;
}

const grid = (cls, ...fields) => { const g = el('div', cls); g.append(...fields); return g; };

export async function editCrop(c, onSaved, farm) {
  // the procedures a phase can carry: approved, per-batch ones first
  let sops = [];
  try {
    const d = await rpc('procedures', { p_farm: farm?.id ?? c.farm_id ?? null });
    sops = (d.procedures || []).filter(x => x.status === 'approved')
      .sort((a, b) => (a.trigger === 'crop_plan' ? 0 : 1) - (b.trigger === 'crop_plan' ? 0 : 1) || a.title.localeCompare(b.title));
  } catch { /* the editor still works; the picker is just empty */ }

  const d = drawer('Edit ' + c.name, `${c.code} · planned batches keep their dates; new plans use what you save`);
  d.box.style.width = 'min(760px, 100vw)';

  // ── details ──
  const name = input({ value: c.name || '' });
  const variety = input({ value: c.variety || '', placeholder: 'optional' });
  const category = selectBox(CATEGORIES, c.category);
  const status = selectBox(STATUS, c.status || 'approved');
  const sell = selectBox(SELL, c.sell_unit || 'kg');
  const grams = input({ type: 'number', min: 1, step: 'any', value: c.grams_per_unit ?? '' });
  const gramsF = field('Grams per unit', grams, 'The weight of one unit sold.');
  const showGrams = () => { gramsF.style.display = sell.value === 'kg' ? 'none' : ''; };
  sell.onchange = showGrams;
  const lead = input({ type: 'number', min: 0, step: '1', value: c.seedling_lead_days ?? '' });
  const plugs = input({ type: 'number', min: 1, step: '1', value: c.plugs_per_tray ?? 72 });
  const rotation = input({ value: c.rotation_group || '', placeholder: 'e.g. brassica' });
  const notes = el('textarea');
  notes.rows = 2;
  notes.value = c.notes || '';
  notes.style.width = '100%';

  // sowing: the procedure is the method, these are the crop's numbers (0074)
  const sw = c.sowing || {};
  const seeds = input({ type: 'number', min: 1, step: '1', value: sw.seeds_per_plug ?? '' });
  const depth = input({ type: 'number', min: 0, step: '1', value: sw.depth_mm ?? '' });
  const cover = selectBox([['', '—'], ['none', 'None (needs light)'], ['vermiculite', 'Vermiculite'], ['medium', 'Medium'], ['blackout', 'Blackout']], sw.cover || '');
  const germ = input({ value: sw.germination_c ?? '', placeholder: 'e.g. 18–24' });
  const seedG = input({ type: 'number', min: 0, step: 'any', value: sw.seed_g_per_tray ?? '' });
  const blackout = input({ type: 'number', min: 0, step: '1', value: sw.blackout_days ?? '' });
  const sowNotes = input({ value: sw.notes ?? '', placeholder: 'e.g. soak 8 h' });
  const sowing = () => ({ seeds_per_plug: seeds.value, depth_mm: depth.value, cover: cover.value, germination_c: germ.value.trim(),
                          seed_g_per_tray: seedG.value, blackout_days: blackout.value, notes: sowNotes.value.trim() });
  const sowHint = el('div', 'hint');
  const paintSow = () => { sowHint.textContent = sowingLine(sowing()) || 'Nothing yet — the sowing task shows these under each batch.'; };
  [seeds, depth, cover, germ, seedG, blackout, sowNotes].forEach(x => { x.oninput = paintSow; x.onchange = paintSow; });

  // the picture (0088): chosen here, shrunk to 512 px, put in the public bucket as <crop id>.jpg
  let photoUrl = c.photo_url || '';
  const picBox = el('div', 'row'); picBox.style.alignItems = 'center';
  const picNow = () => { picBox.textContent = ''; picBox.append(cropAvatar({ ...c, photo_url: photoUrl }, 'lg')); picBox.append(pickBtn, dropBtn); dropBtn.style.display = photoUrl ? '' : 'none'; };
  const pick = el('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.style.display = 'none';
  const pickBtn = el('button', 'btn btn-sm', 'Choose a picture');
  pickBtn.onclick = () => pick.click();
  const dropBtn = el('button', 'btn btn-sm btn-ghost', 'Remove');
  dropBtn.onclick = () => { photoUrl = ''; picNow(); };
  pick.onchange = async () => {
    const f = pick.files[0]; if (!f) return;
    busy(pickBtn, true, 'Uploading…');
    try {
      const blob = await shrink(f, 512);
      await api(`/storage/v1/object/crop-photos/${c.id}.jpg`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: blob });
      photoUrl = `${URL_BASE}/storage/v1/object/public/crop-photos/${c.id}.jpg?t=${Date.now()}`;
      busy(pickBtn, false, 'Choose a picture'); picNow();
      toast('Picture uploaded — Save to keep it', 'ok');
    } catch (e) { busy(pickBtn, false, 'Choose a picture'); toast(e.message, 'bad'); }
  };
  picNow();

  const sysHint = el('div', 'hint');
  const paintSysHint = m => {
    const s = systemsFor(m).map(x => x.label);
    sysHint.textContent = s.length ? 'Grows on: ' + s.join(', ') : 'No system offers this medium yet.';
  };
  const media = toggles(mediaList(c.media || []), c.media, paintSysHint);
  paintSysHint(c.media);

  d.body.append(
    field('Picture', picBox, 'Shown on the Crop database like a face. A grouped task covers several crops, so the task cards carry none.'), pick,
    grid('grid3', field('Name', name), field('Variety', variety), field('Category', category)),
    field('Medium', media), sysHint,
    grid('grid3', field('Sold by', sell), gramsF, field('Status', status)),
    grid('grid3', field('Seedling lead (days)', lead, 'How long before transplant the seedlings are needed.'),
                  field('Plugs per tray', plugs, 'Turns plants into trays for a procedure counted per tray.'),
                  field('Rotation group', rotation)),
    field('Notes', notes),
    el('div', 'sec-title', 'Sowing'),
    grid('grid3', field('Seeds per plug', seeds), field('Depth (mm)', depth, '0 = on the surface.'), field('Cover', cover)),
    grid('grid3', field('Germination °C', germ), field('Seed g per tray', seedG, 'Microgreens: seed weight per 1020 tray.'),
                  field('Blackout days', blackout)),
    field('Sowing note', sowNotes), sowHint,
  );
  showGrams();
  paintSow();

  // ── the cycle ──
  const phases = (c.phases || []).map(p => ({ ...p, procedures: (p.procedures || []).map(x => ({ ...x })) }));
  const sopTitle = id => sops.find(x => x.id === id)?.title || phases.flatMap(p => p.procedures).find(x => x.sop_id === id)?.title || '?';
  const phaseBox = el('div');
  const total = el('span', 'hint');
  const paintTotal = () => {
    total.textContent = phases.reduce((n, p) => n + Number(p.days || 0), 0) + ' days';
  };
  const paintPhases = () => {
    phaseBox.textContent = '';
    phases.forEach((p, i) => {
      const line = el('div', 'row');
      line.style.flexWrap = 'nowrap';
      line.style.margin = '0 0 var(--space-2)';
      line.append(el('b', null, String(i + 1)));
      const nm = input({ value: p.name || '', placeholder: 'Phase' });
      nm.style.flex = '2';
      nm.oninput = () => { p.name = nm.value; };
      const ty = selectBox(PHASES, p.type || 'vegetative');
      ty.style.flex = '1.3';
      ty.onchange = () => { p.type = ty.value; };
      const days = input({ type: 'number', min: 0, step: '1', value: p.days ?? '' });
      days.style.width = '80px';
      days.oninput = () => { p.days = days.value; paintTotal(); };
      const cues = input({ value: p.cues || '', placeholder: 'What it looks like' });
      cues.style.flex = '2';
      cues.oninput = () => { p.cues = cues.value; };
      const up = el('button', 'btn btn-sm', '↑');
      up.type = 'button';
      up.disabled = i === 0;
      up.onclick = () => { phases.splice(i - 1, 0, phases.splice(i, 1)[0]); paintPhases(); };
      const rm = el('button', 'btn btn-sm', '✕');
      rm.type = 'button';
      rm.title = 'Remove this phase';
      rm.onclick = () => { phases.splice(i, 1); paintPhases(); };
      line.append(nm, ty, days, el('span', 'hint', 'd'), cues, up, rm);
      phaseBox.append(line);

      // the procedures a batch runs in this phase
      const links = el('div', 'phase-links');
      const paintLinks = () => {
        links.textContent = '';
        p.procedures.forEach((pr, j) => {
          const row = el('div', 'row phase-link');
          row.append(el('span', 'phase-link-title', sopTitle(pr.sop_id)));
          const off = input({ type: 'number', step: '1', value: pr.day_offset ?? 0 });
          off.style.width = '64px';
          off.title = 'Days after the phase starts';
          off.oninput = () => { pr.day_offset = off.value; };
          const rep_ = input({ type: 'number', min: 0, step: '1', value: pr.repeat_days ?? '', placeholder: 'once' });
          rep_.style.width = '64px';
          rep_.title = 'Repeat every n days while the phase lasts; empty = once';
          rep_.oninput = () => { pr.repeat_days = rep_.value; };
          const x = el('button', 'btn btn-sm btn-ghost', '✕');
          x.title = 'Take this procedure off the phase';
          x.onclick = () => { p.procedures.splice(j, 1); paintLinks(); };
          row.append(el('span', 'hint', 'day'), off, el('span', 'hint', 'every'), rep_, el('span', 'hint', 'd'), x);
          links.append(row);
        });
        const addRow = el('div', 'row phase-link add');
        const pick = selectBox([['', '+ Add a procedure'], ...sops.map(x => [x.id, x.title])], '');
        pick.onchange = () => {
          if (!pick.value) return;
          p.procedures.push({ sop_id: pick.value, day_offset: 0, repeat_days: '' });
          paintLinks();
        };
        addRow.append(pick);
        links.append(addRow);
        if (!p.procedures.length) links.prepend(el('div', 'hint', 'No procedure — a batch does nothing in this phase.'));
      };
      paintLinks();
      phaseBox.append(links);
    });
    if (!phases.length) phaseBox.append(el('div', 'hint', 'No phases — the planner will not place this crop.'));
    paintTotal();
  };
  const ph = el('div', 'row');
  ph.append(el('div', 'sec-title', 'Cycle'), total, el('div', 'spacer'));
  const addPhase = el('button', 'btn btn-sm', '+ Add phase');
  addPhase.type = 'button';
  addPhase.onclick = () => { phases.push({ name: '', type: 'vegetative', days: 7, procedures: [] }); paintPhases(); };
  ph.append(addPhase);
  d.body.append(ph, phaseBox);
  paintPhases();

  // ── yields per system ──
  const known = new Map((c.systems || []).map(s => [s.system_type, s]));
  const yields = systemTypes([...known.keys()]).map(([code, label]) => ({
    system_type: code, label,
    ypp: known.get(code)?.manual ? known.get(code).yield_per_position : '',
    lib: known.get(code)?.yield_per_position,
    ym2: known.get(code)?.yield_per_m2_cycle ?? '',
    had: known.has(code),
  }));
  d.body.append(el('div', 'sec-title', 'Yield by system'));
  d.body.append(el('div', 'hint',
    'kg per plant (or per tray). Leave empty to use the library figure shown in grey.'));
  const yBox = el('div');
  yields.forEach(y => {
    const line = el('div', 'row');
    line.style.flexWrap = 'nowrap';
    line.style.margin = '0 0 var(--space-2)';
    const lbl = el('span', null, y.label);
    lbl.style.flex = '1';
    const a = input({ type: 'number', min: 0, step: 'any', value: y.ypp ?? '',
                      placeholder: y.lib != null ? num(y.lib, 3) : 'kg/plant' });
    a.style.width = '120px';
    a.oninput = () => { y.ypp = a.value; y.touched = true; };
    const b = input({ type: 'number', min: 0, step: 'any', value: y.ym2 ?? '', placeholder: 'kg/m²/cycle' });
    b.style.width = '120px';
    b.oninput = () => { y.ym2 = b.value; y.touched = true; };
    line.append(lbl, a, el('span', 'hint', 'kg/plant'), b, el('span', 'hint', 'kg/m²/cycle'));
    yBox.append(line);
  });
  d.body.append(yBox);

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save');
  save.onclick = async () => {
    if (!name.value.trim()) { toast('A crop needs a name', 'bad'); return; }
    if (!media.value().length) { toast('Pick at least one growing medium', 'bad'); return; }
    const blank = phases.findIndex(p => !String(p.name || '').trim());
    if (blank >= 0) { toast(`Phase ${blank + 1} needs a name`, 'bad'); return; }
    busy(save, true, 'Saving…');
    try {
      const r = await rpc('save_crop', { p_crop: c.id, p: {
        name: name.value.trim(), variety: variety.value.trim(), category: category.value,
        status: status.value, media: media.value(), sell_unit: sell.value,
        grams_per_unit: sell.value === 'kg' ? '' : grams.value,
        seedling_lead_days: lead.value, rotation_group: rotation.value, notes: notes.value,
        plugs_per_tray: plugs.value,
        sowing: sowing(),
        photo_url: photoUrl,
        phases: phases.map(p => ({ name: String(p.name).trim(), type: p.type || 'vegetative',
                                   days: p.days ?? 0, cues: p.cues || '',
                                   procedures: p.procedures.map(x => ({ sop_id: x.sop_id,
                                     day_offset: parseInt(x.day_offset, 10) || 0, repeat_days: parseInt(x.repeat_days, 10) || '' })) })),
        // only the systems somebody changed; an emptied figure goes back to the library
        yields: yields.filter(y => y.touched)
          .map(y => ({ system_type: y.system_type, yield_per_position: y.ypp ?? '',
                       yield_per_m2_cycle: y.ym2 ?? '' })),
      } });
      toast(`${name.value.trim()} saved · ${r.cycle_days} day cycle` + (r.replanned ? ` · ${r.replanned} batch${r.replanned === 1 ? '' : 'es'} replanned` : ''), 'ok');
      d.close();
      await onSaved?.();
    } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}

// a picture shrunk to fit a square of `max` px, as a JPEG blob (the phone does the same for its evidence)
async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.86));
}
