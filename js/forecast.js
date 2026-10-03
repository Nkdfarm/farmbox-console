// ═══════════════════════════════════════════════════════════════════════════
// Grow › Forecast review (migration 0136, console 0.7.148)
//
// Twice a week (the working days before the harvest days) somebody walks the
// batches and says where each one really is: the phase, the days to harvest,
// the kilograms it will give. "As planned" confirms; a different number of days
// moves the harvest, the later dates and the tasks (a phase observation, §9.8);
// a different kg changes what the basket planner and the orders count on. A
// camera estimate waiting for a decision is shown beside the batch and can be
// taken as it is.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast, rpc } from './api.js';
import { loading, el, pageHead, toast, busy, cropAvatar, pref } from './ui.js';

const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const nice = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
const ago = s => { if (!s) return 'never'; const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const PHASES = [['germination', 'Germination'], ['nursery', 'Nursery'], ['transplant', 'Transplant'], ['vegetative', 'Vegetative'],
                ['flowering', 'Flowering'], ['harvest_window', 'Harvesting'], ['cleanup', 'Clean-up']];

let farm = null, mount = null, data = null;
export async function renderForecast(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}
async function load(fresh = false) {
  const here = mount;
  await openFast([['forecast_review', { p_farm: farm.id }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the batches…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}

function paint() {
  mount.textContent = '';
  const all = data.batches || [];
  const due = all.filter(b => b.due);
  const onlyDue = pref.get('fbc_forecast_due') !== 'all';
  const tog = el('button', 'btn btn-sm btn-ghost', onlyDue ? `Show all ${all.length}` : `Only the ${due.length} due`);
  tog.onclick = () => { pref.set('fbc_forecast_due', onlyDue ? 'all' : null); paint(); };
  const days = (data.review_days || []).map(d => DAY[d]).join(' and ');
  mount.append(pageHead(null, `Every ${days}: where each batch really is — its phase, the days to harvest and the kg it will give. ` +
    '"As planned" confirms; another number of days moves its harvest, later dates and tasks; another kg changes what the baskets and orders count on.', tog));
  const rows = onlyDue ? due : all;
  if (!all.length) { mount.append(el('div', 'empty', 'No batch is growing or validated.')); return; }
  if (!rows.length) { mount.append(el('div', 'empty', `Every batch was looked at in the last three days. ${all.length} growing.`)); return; }
  let zone = null, card = null;
  rows.forEach(b => {
    if (b.zone !== zone) { zone = b.zone; card = el('div', 'card card-pad fc-zone'); card.append(el('div', 'sec-title', zone || 'No zone')); mount.append(card); }
    card.append(row(b));
  });
}

function row(b) {
  const r = el('div', 'fc-row' + (b.due ? ' due' : ''));
  const who = el('div', 'fc-who');
  who.append(cropAvatar({ name: b.crop, category: b.category, photo_url: b.photo_url }, 'sm'));
  const nm = el('div'); nm.append(el('b', null, b.crop), el('div', 'hint', `${b.system} · ${b.position}`));
  who.append(nm);
  const plan = el('div', 'fc-plan');
  const dated = b.harvest_start != null && b.days_to_harvest != null;
  plan.append(el('span', null, `plan: ${dated ? (b.planned_phase?.name || '—') : '—'}`),
              el('span', 'hint', dated ? `harvest ${nice(b.harvest_start)} · ${b.days_to_harvest} d · ${Math.round(Number(b.expected_kg || 0))} kg` : 'no dates yet — set them on the Crop planner, or give the days to harvest here'));
  const may = data.may_review;
  const phase = document.createElement('select'); phase.className = 'input';
  PHASES.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; phase.append(o); });
  phase.value = b.current_phase || b.planned_phase?.phase_type || 'vegetative';
  const days = el('input', 'input'); days.type = 'number'; days.min = '0'; days.max = '365'; days.value = dated ? Math.max(0, Number(b.days_to_harvest)) : '';
  const kg = el('input', 'input'); kg.type = 'number'; kg.min = '0'; kg.step = '0.5'; kg.value = Math.round(Number(b.expected_kg || 0) * 10) / 10;
  const kgShown = kg.value;          // compared with what was shown, not the unrounded figure (each Save rewrote it)
  [phase, days, kg].forEach(x => { x.disabled = !may; });
  const f = el('div', 'fc-fields');
  const lab = (t, x) => { const w = el('label', 'fc-f'); w.append(el('span', 'hint', t), x); return w; };
  f.append(lab('Phase', phase), lab('Days to harvest', days), lab('kg', kg));
  const last = el('div', 'hint fc-last', b.last ? `looked at ${ago(b.last.at)}${b.last.by ? ' by ' + b.last.by : ''}${b.last.source === 'camera' ? ' (camera)' : ''}` : 'never looked at');
  const acts = el('div', 'fc-acts');
  if (may) {
    const same = el('button', 'btn btn-sm', 'As planned');
    same.title = 'Confirm: it is where the plan says';
    same.onclick = () => save(same, b, b.planned_phase?.phase_type || phase.value, Number(b.days_to_harvest), null);
    const go = el('button', 'btn btn-sm btn-primary', 'Save');
    go.onclick = () => { if (days.value === '') { toast('How many days to harvest?', 'bad'); return; } save(go, b, phase.value, Number(days.value), kg.value !== '' && kg.value !== kgShown ? Number(kg.value) : null); };
    if (dated) acts.append(same);
    acts.append(go);
    if (b.camera) {
      const cam = el('button', 'btn btn-sm btn-ghost', `Camera: ${b.camera.days_to_harvest ?? '—'} d · ${b.camera.kg_est != null ? Math.round(b.camera.kg_est) + ' kg' : '—'}`);
      cam.title = 'Fill in what the camera estimated, then Save';
      cam.onclick = () => { if (b.camera.days_to_harvest != null) days.value = b.camera.days_to_harvest; if (b.camera.kg_est != null) kg.value = Math.round(b.camera.kg_est); if (b.camera.stage && PHASES.some(([v]) => v === b.camera.stage)) phase.value = b.camera.stage; };
      acts.append(cam);
    }
  }
  r.append(who, plan, f, acts, last);
  return r;
}

async function save(button, b, phase, days, kg) {
  busy(button, true, 'Saving…');
  try {
    const r = await rpc('review_batch', { p_plan: b.plan_id, p_phase: phase, p_days_to_harvest: Math.max(0, Math.round(days)), p_expected_kg: kg, p_note: null });
    toast(`${b.crop} · ${b.position}: harvest ${nice(r.harvest_start)}${kg != null ? ` · ${kg} kg` : ''}`, 'ok');
    load(true);
  } catch (e) { busy(button, false); toast(e.message, 'bad'); }
}
