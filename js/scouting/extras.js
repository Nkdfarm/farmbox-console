// Scouting page: the greenhouse reference, the extra scoutings, section pills
import { rpc, cachedRpc } from '../api.js';
import { openCase } from '../cases.js';
import { openSump } from '../sump.js';
import { el, toast } from '../ui.js';
import { openViewer } from '../viewer.js';
import { viewerCtx } from './day.js';
import { reload } from './index.js';
import { S, calm, dayData, readFailed, readOk } from './state.js';
import { thumbMaps } from './thumbs.js';

// what the whole-greenhouse report rests on, opened beside the page (0.7.240): the windows the page already has
export async function openGhRef(ref) {
  if (ref.kind === 'case') return openCase(ref.id, reload, S.farm);
  if (ref.kind === 'sump') return openSump(S.farm, { sump: ref.id, day: ref.day || null, onChange: reload });
  if (ref.kind === 'trap') {
    const sp = ref.trap ? S.kit?.spotOf(ref.trap) : null;
    if (sp) return S.kit.openSpots(`Trap ${ref.trap}`, [sp]);
    toast(`Trap ${ref.trap || ''} is no longer on the map`, 'bad');
    return;
  }
  if (ref.kind === 'photo') {
    // the photo as its day holds it, so the viewer has its zone, its crops and its cases
    const dstr = String(ref.day || S.over?.today || '');
    let day = dayData.get(dstr);
    if (!day) { day = await calm('scouting_day_light', { p_farm: S.farm.id, p_day: dstr }); dayData.set(dstr, day); }
    for (const z of (day.units || day.zones || [])) {
      const p = (z.photos || []).find(q => q.id === ref.id);
      if (p) return openViewer(viewerCtx({ ...p, zone: z.name, photo_data: p.photo_data || ref.photo_data || thumbMaps.get(dstr)?.[p.id] || '' }, z, day));
    }
    toast('That photo is no longer in the report of that day', 'bad');
  }
}

// the extra scoutings (0206), read beside the page so a database without the function still shows the report: this
// device's copy at once, then the database's; each date line gets its pill when the answer lands
export async function readExtras(here) {
  const a = { p_farm: S.farm.id, p_days: 90 };
  const repaintLines = () => {
    S.mount.querySelectorAll('details.pd-day').forEach(det => {
      det.querySelectorAll('.pd-xpill').forEach(n => n.remove());
      const p = extraPill(det.dataset.day), upd = det.querySelector('.pd-day-facts .pd-upd');
      if (p) { const f = det.querySelector('.pd-day-facts'); if (upd) f.insertBefore(p, upd); else f?.append(p); }
    });
  };
  const land = x => {
    if (!Array.isArray(x) || !here.isConnected || S.mount !== here || JSON.stringify(x) === JSON.stringify(S.extras)) return;
    S.extras = x; repaintLines();
  };
  // who contributed, day by day (0209): the responsible in grey, the extras in orange; a database before 0209 keeps the pill
  const landPeople = x => {
    if (!Array.isArray(x) || !here.isConnected || S.mount !== here || JSON.stringify(x) === JSON.stringify(S.people)) return;
    S.people = x; repaintLines();
  };
  // did each day reach its targets (0211): the section pills take their colour from it
  const landCov = x => {
    if (!Array.isArray(x) || !here.isConnected || S.mount !== here || JSON.stringify(x) === JSON.stringify(S.coverage)) return;
    S.coverage = x;
    if (S.zoneFilter) return;          // one zone's report carries no pills of the whole unit (review 13 Oct 2026)
    S.mount.querySelectorAll('details.pd-day').forEach(det => {
      const f = det.querySelector('.pd-day-facts'); if (!f) return;
      const fresh = sectionPills(det.dataset.day, det._summary);
      const old = [...f.querySelectorAll('.pd-secpill')];
      if (!fresh.length) return;
      const before = old[0] || f.querySelector('.pd-xpill') || f.querySelector('.pd-upd');
      fresh.forEach(p => (before ? f.insertBefore(p, before) : f.append(p)));
      old.forEach(n => n.remove());
    });
  };
  const ca = { p_farm: S.farm.id, p_days: 45 };
  // the copy on this device is painted only if the fresh answer has not already arrived
  let freshCov = false, freshPeople = false, copyCov = false, copyPeople = false, copyExtras = false;   // copy = one was painted
  cachedRpc('scouting_coverage', ca).then(r => { if (!freshCov) { landCov(r); copyCov = Array.isArray(r); } }).catch(() => {});
  rpc('scouting_coverage', ca).then(r => { freshCov = true; landCov(r); readOk(); }).catch(() => readFailed(copyCov));
  cachedRpc('scouting_people', a).then(r => { if (!freshPeople) { landPeople(r); copyPeople = Array.isArray(r); } }).catch(() => {});
  rpc('scouting_people', a).then(r => { freshPeople = true; landPeople(r); readOk(); }).catch(() => readFailed(copyPeople));
  const kept = await cachedRpc('extra_scoutings', a).catch(() => null);
  copyExtras = Array.isArray(kept);
  land(kept);
  let ok = true;
  const live = await rpc('extra_scoutings', a).catch(() => { ok = false; readFailed(copyExtras); return null; });
  if (ok) readOk();
  land(live);
}
const minWord = m => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);
// The section pills of a day (0.7.219, owner 4 Oct 2026: "green when all assigned targets for this specific day are
// reached (minimum pics per zone), orange when started but not complete, red if not started"). The colour is the
// day's coverage (0211: 2 photos a zone for Plant health and for Growth, every trap of a zone read); a section somebody
// reported as a problem carries ⚠ and its note. Without coverage (an older database, a day with no planned scouting) the
// pills are the reported result, as before.
export function sectionPills(day, summary) {
  const cov = (S.coverage.find(x => String(x.day) === String(day)) || {}).sections, so = summary?.section_outcomes || {};
  const out = [];
  [['trap', 'Traps'], ['health', 'Plant health'], ['growth', 'Growth']].forEach(([k, label]) => {
    const c = cov?.[k], v = so[k];
    if (!c && !v) return;
    let pill;
    if (c) {
      const txt = c.state === 'ok' ? `✓ ${label}` : `${label} ${c.done}/${c.zones}`;
      pill = el('span', 'pill pd-secpill ' + (c.state === 'ok' ? 'ok' : c.state === 'warn' ? 'warn' : 'bad'), txt + (v?.outcome === 'nok' ? ' ⚠' : ''));
      const what = k === 'trap' ? 'every trap read' : '2 photos';
      pill.title = [`${c.done} of ${c.zones} zone${c.zones === 1 ? '' : 's'} reached the minimum (${what})` + (c.started > c.done ? `, ${c.started - c.done} started` : ''),
                    v?.outcome === 'nok' ? 'Problem reported' + (v.note ? ': ' + v.note : '') : (v?.note || null)].filter(Boolean).join(NLINE);
    } else {
      pill = el('span', 'pill pd-secpill ' + (v.outcome === 'ok' ? 'ok' : 'bad'), `${v.outcome === 'ok' ? '✓' : '✕'} ${label}`);
      if (v.note) pill.title = v.note;
    }
    out.push(pill);
  });
  return out;
}
const NLINE = String.fromCharCode(10);
export function extraPill(day) {
  // 0.7.216 (owner 4 Oct 2026): "Responsible · Francesco · 30 min" in the usual grey, "Extra · Oliver · 20 min" in orange —
  // the name under a picture carries the same colour, so it says who took it as what
  const ps = S.people.filter(x => String(x.day) === String(day));
  if (ps.length) {
    const first = n => String(n || 'somebody').trim().split(/\s+/)[0];
    const box = el('span', 'pd-xpill pd-people');
    ps.forEach(x => {
      const t = el('span', 'pd-who' + (x.kind === 'extra' ? ' extra' : ''),
        [x.kind === 'extra' ? 'Extra' : 'Responsible', first(x.name), Number(x.minutes) >= 1 ? minWord(Number(x.minutes)) : null].filter(Boolean).join(' · '));
      t.title = x.kind === 'extra' ? 'Added photos or counts in an extra scouting' : 'Did the planned scouting';
      box.append(t);
    });
    return box;
  }
  const xs = S.extras.filter(x => String(x.day) === String(day));
  if (!xs.length) return null;
  const first = n => String(n || 'somebody').trim().split(/\s+/)[0];
  const total = xs.reduce((s, x) => s + (Number(x.minutes) || 0), 0);
  const pill = el('span', 'pill pd-extra pd-xpill', `extra · ${xs.map(x => first(x.by)).join(', ')}${total >= 1 ? ' · ' + minWord(total) : ''}`);
  pill.title = 'Extra scoutings that day, beside the planned one:\n' + xs.map(x =>
    `${x.by || 'somebody'}: ${[Number(x.minutes) >= 1 ? minWord(Number(x.minutes)) + (x.running ? ' (now)' : '') : (x.running ? 'in progress' : null),
      `${x.visits} visit${x.visits === 1 ? '' : 's'}`, `${x.photos} photo${x.photos === 1 ? '' : 's'}`,
      `${x.traps} trap reading${x.traps === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}`).join('\n');
  return pill;
}
