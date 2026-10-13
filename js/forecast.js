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
import { loading, el, pageHead, toast, busy, cropAvatar, pref, parseYmd, farmDate, farmLocal, farmToday } from './ui.js';

const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const nice = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
// counted in the farm's days, not in blocks of 24 hours: a look at four yesterday afternoon read "today" all the next morning (review 13 Oct 2026)
const ago = s => { if (!s) return 'never'; const d = Math.round((farmDate() - parseYmd(farmLocal(s))) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
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
  mount.append(pageHead(null, `${days ? `Every ${days}: confirm` : 'Confirm'} each batch, or correct its days to harvest and its kg.`, tog));
  const rows = onlyDue ? due : all;
  if (!all.length) { mount.append(el('div', 'empty', 'No batch is growing or validated. Validate a proposal on Grow › Crop planner first.')); return; }
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
  // The days are counted here, from the harvest date and the farm's day as it is now, not taken as the list read
  // them: a list read on Monday and still on screen on Thursday (the console left open on this page, or the kept
  // copy when the read fails) sent Monday's figure, and "As planned" moved the harvest to Thursday + that. The server
  // counts the same way (forecast_review: harvest start − the farm's today), so on a fresh list the two are equal.
  // Counted again at each click: the page has no refresh of its own, so the row can be days old when it is pressed.
  const daysLeft = () => dated ? Math.round((parseYmd(b.harvest_start) - farmDate()) / 86400000) : null;
  const left = daysLeft();
  plan.append(el('span', null, `plan: ${dated ? (b.planned_phase?.name || '—') : '—'}`),
              el('span', 'hint', dated ? `harvest ${nice(b.harvest_start)} · ${left < 0 ? -left + ' d ago' : left + ' d'} · ${Math.round(Number(b.expected_kg || 0))} kg` : 'no dates yet — set them on the Crop planner, or give the days to harvest here'));
  const may = data.may_review;
  const phase = document.createElement('select'); phase.className = 'input';
  PHASES.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; phase.append(o); });
  phase.value = b.current_phase || b.planned_phase?.phase_type || 'vegetative';
  const days = el('input', 'input'); days.type = 'number'; days.min = '0'; days.max = '365'; days.value = dated && left >= 0 ? left : '';
  const kg = el('input', 'input'); kg.type = 'number'; kg.min = '0'; kg.step = '0.5'; kg.value = Math.round(Number(b.expected_kg || 0) * 10) / 10;
  const kgShown = kg.value;          // compared with what was shown, not the unrounded figure (each Save rewrote it)
  // Days sent to the database MOVE the harvest to today + days and make a validated batch "growing" (the phase
  // observation's trigger). So they are not sent when nothing is being said about them: a batch already being
  // harvested (its days are negative — "As planned" used to push its harvest to today, and its end and tasks with
  // it, at every review), and a batch still only validated whose days were left as shown. A date that has passed
  // leaves the field empty, not 0: the list cannot tell a batch being cut from one that is late, and 0 typed there
  // has to mean "harvest today" (it was read as "left as shown" and moved nothing).
  const daysShown = days.value;
  if (dated && daysShown === '') { days.placeholder = '—'; days.title = 'The date has passed. Leave it empty to keep it; a number moves the harvest to today + that many days (0 = today)'; }
  // nothing to say about the days: the date has passed, or the batch is still only validated (asked at the click)
  const still = () => dated && (daysLeft() < 0 || b.status === 'validated');
  [phase, days, kg].forEach(x => { x.disabled = !may; });
  const f = el('div', 'fc-fields');
  const lab = (t, x) => { const w = el('label', 'fc-f'); w.append(el('span', 'hint', t), x); return w; };
  f.append(lab('Phase', phase), lab('Days to harvest', days), lab('kg', kg));
  const last = el('div', 'hint fc-last', b.last ? `looked at ${ago(b.last.at)}${b.last.by ? ' by ' + b.last.by : ''}${b.last.source === 'camera' ? ' (camera)' : ''}` : 'never looked at');
  const acts = el('div', 'fc-acts');
  if (may) {
    // a list read on another day is read again before anything is said about it: its figures are that day's, and a
    // figure left as shown could not be told from one confirmed (the page has no refresh of its own)
    const stale = () => {
      if (!data.today || String(data.today).slice(0, 10) === farmToday()) return false;
      toast('This list was read on another day: it is read again. Look, then press again.', 'bad');
      load(true);
      return true;
    };
    const same = el('button', 'btn btn-sm', 'As planned');
    same.title = 'Confirm: it is where the plan says';
    same.onclick = () => { if (stale()) return; save(same, b, b.planned_phase?.phase_type || phase.value, still() ? null : daysLeft(), null); };
    const go = el('button', 'btn btn-sm btn-primary', 'Save');
    go.onclick = () => {
      if (stale()) return;
      // the days left as they were shown say "as planned": what is sent is today's count, not the figure painted
      // (on a row some days old the painted figure moved the harvest by those days), and nothing when there is
      // nothing to say. Days typed are sent as typed.
      const untouched = days.value === daysShown;
      if (days.value === '' && !(untouched && dated)) { toast('How many days to harvest?', 'bad'); return; }
      save(go, b, phase.value, untouched ? (still() ? null : daysLeft()) : Number(days.value), kg.value !== '' && kg.value !== kgShown ? Number(kg.value) : null);
    };
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
    const r = await rpc('review_batch', { p_plan: b.plan_id, p_phase: phase, p_days_to_harvest: days == null ? null : Math.max(0, Math.round(days)), p_expected_kg: kg, p_note: null });
    toast(`${b.crop} · ${b.position}: harvest ${nice(r.harvest_start)}${kg != null ? ` · ${kg} kg` : ''}`, 'ok');
    load(true);
  } catch (e) { busy(button, false); toast(e.message, 'bad'); }
}
