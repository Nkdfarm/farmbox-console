// ═══════════════════════════════════════════════════════════════════════════
// Grow › Field validation (migration 0137, console 0.7.149)
//
// The crop database and the procedures are corrected from the field. Anybody of
// the farm — a worker, a student, the agronomist — proposes: this phase lasts n
// days, this crop gives n kg here, this EC should read x–y, this step is wrong,
// this pest was misread; with a note and a photo as evidence. The Farm manager or
// the agronomist decides. A figure the platform owns is applied at once on the
// farm's own crops; on a standard crop it waits for the franchisor ("for the
// standard"). Every decision stays: who proposed, on what evidence, who decided.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast, rpc, api, cachedRpc, URL_BASE } from './api.js';
import { loading, el, pageHead, drawer, field, selectBox, toast, busy, cropAvatar, pref, systemTypes } from './ui.js';

const ENTITY = { phase_days: 'Phase length', yield: 'Yield', target: 'EC / pH / climate target', procedure_step: 'Procedure step',
                 pest: 'Pest identification', material: 'Material quantity', other: 'Other' };
const STATUS = { proposed: ['to decide', 'warn'], applied: ['applied', 'ok'], accepted: ['accepted', 'ok'], for_standard: ['accepted — for the standard', 'info'], rejected: ['rejected', ''] };
const TARGETS = [['ec', 'EC (mS/cm)'], ['ph', 'pH'], ['air_temp', 'Air temperature (°C)'], ['water_temp', 'Solution temperature (°C)'], ['rh', 'Humidity (%)']];
const nice = s => s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

let farm = null, mount = null, data = null;
export async function renderValidation(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}
async function load(fresh = false) {
  const here = mount;
  await openFast([['field_corrections', { p_farm: farm.id, p_status: null }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the corrections…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}

function paint() {
  mount.textContent = '';
  const add = el('button', 'btn btn-primary', 'Propose a correction');
  add.onclick = () => propose();
  const show = pref.get('fbc_valid_show') || 'proposed';
  const seg = el('div', 'seg');
  const n = data.counts || {};
  [['proposed', `To decide · ${n.proposed || 0}`], ['decided', 'Decided'], ['all', 'All']].forEach(([v, l]) => {
    const b = el('button', 'seg-btn', l); b.setAttribute('aria-pressed', String(v === show));
    b.onclick = () => { pref.set('fbc_valid_show', v); paint(); };
    seg.append(b);
  });
  mount.append(pageHead(null, 'Corrections to the crop database and the procedures, proposed from the field with evidence and decided by the Farm manager or the agronomist. ' +
    'A figure on the farm\'s own crops is applied at once; on a standard crop it goes to the franchisor.', seg, add));
  const items = (data.items || []).filter(i => show === 'all' || (show === 'proposed' ? i.status === 'proposed' : i.status !== 'proposed'));
  if (!items.length) { mount.append(el('div', 'empty', show === 'proposed' ? 'Nothing waiting for a decision.' : 'No correction yet.')); return; }
  const list = el('div', 'va-list');
  items.forEach(i => list.append(card(i)));
  mount.append(list);
}

function card(i) {
  const c = el('div', 'card card-pad va-card');
  const head = el('div', 'row');
  if (i.crop) head.append(cropAvatar({ name: i.crop, category: i.category, photo_url: i.photo_url }, 'sm'));
  const t = el('div'); t.append(el('b', null, ENTITY[i.entity] || i.entity), el('div', 'hint', [i.crop, i.phase, i.system_type, i.procedure, i.field].filter(Boolean).join(' · ')));
  const st = STATUS[i.status] || [i.status, ''];
  head.append(t, el('div', 'spacer'), el('span', 'pill ' + st[1], st[0]));
  c.append(head);
  const ch = el('div', 'va-change');
  ch.append(el('span', 'va-from', i.current_value || '—'), el('span', 'va-arrow', '→'), el('b', 'va-to', i.proposed_value + (i.unit ? ' ' + i.unit : '')));
  c.append(ch);
  if (i.note) c.append(el('div', null, i.note));
  const meta = el('div', 'hint', `proposed by ${i.proposer || 'someone'} · ${nice(i.created_at)}` + (i.decided_at ? ` · decided by ${i.decider || 'someone'} · ${nice(i.decided_at)}` : '') + (i.decision_note ? ` — ${i.decision_note}` : ''));
  c.append(meta);
  if (i.evidence_path) {
    const ph = el('button', 'btn btn-sm btn-ghost', 'See the photo');
    ph.onclick = async () => {
      try { const r = await api('/storage/v1/object/sign/evidence/' + i.evidence_path, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) });
            if (r?.signedURL) window.open(URL_BASE + '/storage/v1' + r.signedURL, '_blank', 'noopener'); } catch (e) { toast(e.message, 'bad'); }
    };
    c.append(ph);
  }
  if (data.may_decide && i.status === 'proposed') {
    const note = el('input', 'input'); note.placeholder = 'why (optional)';
    const ok = el('button', 'btn btn-sm btn-primary', 'Accept');
    ok.title = ['phase_days', 'yield', 'target'].includes(i.entity) ? 'Applied at once on the farm\'s own crops; for a standard crop it goes to the franchisor' : 'Accepted as something to act on';
    const no = el('button', 'btn btn-sm', 'Reject');
    const decide = async (btn, d) => {
      busy(btn, true, '…');
      try { const r = await rpc('decide_correction', { p_id: i.id, p_decision: d, p_note: note.value || null }); toast((STATUS[r.status] || [r.status])[0], 'ok'); load(true); }
      catch (e) { busy(btn, false, d === 'accept' ? 'Accept' : 'Reject'); toast(e.message, 'bad'); }
    };
    ok.onclick = () => decide(ok, 'accept'); no.onclick = () => decide(no, 'reject');
    const acts = el('div', 'row va-acts'); acts.append(note, ok, no);
    c.append(acts);
  }
  return c;
}

// a photo shrunk on this computer, into the evidence bucket under the farm
async function uploadEvidence(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
  const path = `${farm.id}/corrections/${crypto.randomUUID()}.jpg`;
  await api('/storage/v1/object/evidence/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  return path;
}

async function propose() {
  const d = drawer('Propose a correction', 'What the database says, what you found, and how you know');
  d.body.append(loading('Reading the crops…'));
  let lib, procs;
  try {
    lib = (await cachedRpc('crop_library', { p_farm: farm.id })) || await rpc('crop_library', { p_farm: farm.id });
    procs = (await cachedRpc('procedures', { p_farm: farm.id })) || await rpc('procedures', { p_farm: farm.id });
  } catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
  d.body.textContent = '';
  const crops = (lib.crops || []).filter(c => !c.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const entity = selectBox(Object.entries(ENTITY), 'phase_days');
  const crop = selectBox(crops.map(c => [c.id, c.name]));
  const phase = selectBox([]);
  const sys = selectBox(systemTypes());   // the catalogue (Available systems and media), no list of its own
  const tgt = selectBox(TARGETS);
  const proc = selectBox((procs.procedures || []).map(p => [p.id, p.title]).sort((a, b) => a[1].localeCompare(b[1])));
  const value = el('input', 'input'); value.placeholder = 'e.g. 26 days';
  const current = el('input', 'input'); current.placeholder = 'what it says now (optional)';
  const note = el('textarea', 'input'); note.placeholder = 'How you know: batches measured, dates, who saw it…';
  const photo = el('input'); photo.type = 'file'; photo.accept = 'image/*';
  const fCrop = field('Crop', crop), fPhase = field('Phase', phase), fSys = field('System', sys), fTgt = field('Target', tgt),
        fProc = field('Procedure', proc), fCur = field('What it says now', current);
  // always the chosen crop's phases: only the last answer fills the menu (two quick crop changes
  // used to append both), and it is refilled whenever the crop or "About" changes (review 3 Oct 2026)
  let phaseSeq = 0, phaseCrop = null;
  const fillPhases = async () => {
    const my = ++phaseSeq, want = crop.value;
    phase.textContent = ''; phaseCrop = null;
    try {
      const det = await rpc('crop_detail', { p_crop: want, p_farm: farm.id });
      if (my !== phaseSeq) return;
      (det.phases || det.cycle || []).forEach(p => { const o = el('option', null, `${p.name} · ${p.days} d`); o.value = p.id; phase.append(o); });
      phaseCrop = want;
    } catch { /* the phase list is a help, not a must */ }
  };
  const shape = () => {
    const e = entity.value;
    fCrop.hidden = !['phase_days', 'yield', 'target', 'pest', 'material'].includes(e);
    fPhase.hidden = e !== 'phase_days'; fSys.hidden = e !== 'yield'; fTgt.hidden = e !== 'target';
    fProc.hidden = e !== 'procedure_step'; fCur.hidden = ['phase_days', 'yield', 'target'].includes(e);
    value.placeholder = { phase_days: 'e.g. 26 days', yield: 'kg a plant, e.g. 0.18', target: 'a range, e.g. 1.6–2.0', procedure_step: 'what the step should say' }[e] || 'what it should be';
  };
  entity.onchange = () => { shape(); if (entity.value === 'phase_days' && phaseCrop !== crop.value) fillPhases(); };
  crop.onchange = () => { if (entity.value === 'phase_days') fillPhases(); else { phase.textContent = ''; phaseCrop = null; } };
  d.body.append(field('About', entity), fCrop, fPhase, fSys, fTgt, fProc, fCur, field('Should be', value), field('Evidence', note), field('Photo', photo, 'optional, kept with the correction'));
  shape(); fillPhases();
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Propose');
  go.onclick = async () => {
    if (!value.value.trim()) { toast('What should it be?', 'bad'); return; }
    if (entity.value === 'phase_days' && (!phase.value || phaseCrop !== crop.value)) { toast('Choose the phase (its list is still loading?)', 'bad'); return; }
    busy(go, true, 'Sending…');
    try {
      const evidence = photo.files?.[0] ? await uploadEvidence(photo.files[0]) : null;
      const e = entity.value;
      await rpc('propose_correction', { p_farm: farm.id, p: {
        entity: e, crop_id: fCrop.hidden ? null : crop.value, ref_id: e === 'phase_days' ? phase.value || null : null,
        system_type: e === 'yield' ? sys.value : null, field: e === 'target' ? tgt.value : null, sop_id: e === 'procedure_step' ? proc.value : null,
        current_value: fCur.hidden ? null : current.value, proposed_value: value.value.trim(), note: note.value, evidence_path: evidence } });
      d.close(); toast('Proposed — the Farm manager or the agronomist decides', 'ok'); load(true);
    } catch (x) { busy(go, false, 'Propose'); toast(x.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}
