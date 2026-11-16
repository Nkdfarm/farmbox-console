// Scouting page: one day row, its zone bands and the viewer context
import { rpc, cachedRpc } from '../api.js';
import { openCase } from '../cases.js';
import { robotSection } from '../robot.js';
import { el, cropAvatar, farmTime, farmWhen } from '../ui.js';
import { extraPill, sectionPills } from './extras.js';
import { healthSection } from './health.js';
import { reload } from './index.js';
import { opinionCard } from './opinion.js';
import { openDays } from './paint.js';
import { S, calm, dayData, dotEl, longDay, robotDay, robotIn, robotNames, robotOpts, worst, zoneName, zones } from './state.js';
import { dayRows, readThumbs, updater } from './thumbs.js';

// ── one report day ──
export function dayRow(d, openFirst, latest = false) {
  const det = el('details', 'pd-day');
  det.dataset.day = String(d.day);
  const sum = el('summary');
  sum.append(dotEl(d.dot), el('b', null, longDay(d.day) + (d.day === String(S.over.today) ? ' · today' : '')));
  const facts = el('span', 'pd-day-facts');
  const t = d.task;
  // how many zones were scouted (0.7.170, owner): green all, orange some, red none — the photos and traps are inside
  if (t) {
    // a zone task is scouted when done; a day scouted as one task (before 0172) never ticked its zones — there a zone
    // counts as scouted when it has a trap read or a photo that day (owner: "today scouting is 1/5 not 5/5")
    const withData = Object.values(d.unit_counts || {}).filter(c => (c.photos || 0) + (c.traps || 0) > 0).length;
    const total = t.zones || 1, done = Math.min(total, t.per_zone ? (t.zones_done || 0) : Math.max(t.zones_done || 0, withData));
    const pill = el('span', 'pill ' + (done >= total ? 'ok' : done > 0 ? 'warn' : 'bad'), `${done}/${total} scouted`);
    pill.title = [t.workers?.length ? t.workers.join(', ') : null, t.done_at ? 'last at ' + farmTime(t.done_at) : null].filter(Boolean).join(' · ');
    facts.append(pill);
  }
  // each section's result on the line itself (0174, owner: "more compact: the OK is not needed") — the unit's, so not in a zone's report
  det._summary = S.zoneFilter ? null : d.summary;
  if (!S.zoneFilter) sectionPills(d.day, d.summary).forEach(p => facts.append(p));
  const rbDay = robotDay(d.day);
  if (rbDay.length) { const p = el('span', 'pill' + (rbDay.some(r => r.status === 'new') ? ' warn' : ''), `robot ${rbDay.length}`); p.title = 'Observations the robot sent that day'; facts.append(p); }
  const xp = extraPill(d.day);
  if (xp) facts.append(xp);
  if (S.gh && !S.zoneFilter) S.gh.pills(d.day).forEach(p => facts.append(p));   // who wrote about the whole greenhouse, and the AI's word: a press shows that day on top
  const upd = updater();
  facts.append(upd.node);
  sum.append(facts);
  det.append(sum);
  const body = el('div', 'pd-day-body');
  det.append(body);
  const fill = async () => {
    if (body.dataset.done) return;
    body.dataset.done = '1';
    body.append(el('div', 'hint', 'Reading the day…'));
    const a = { p_farm: S.farm.id, p_day: d.day };
    let day = dayData.get(d.day), shown = null;
    dayRows.set(String(d.day), { upd, repaint: () => { const x = dayData.get(d.day); if (x && body.isConnected) paintDay(x); } });
    readThumbs(String(d.day));               // the pictures, beside the report: they fill in as they land
    if (!day) {
      upd.begin();
      try {
        // this device's copy at once, the database's answer behind it
        const copy = await cachedRpc('scouting_day_light', a).catch(() => null);
        if (copy) { shown = JSON.stringify(copy); dayData.set(d.day, copy); paintDay(copy); }
        day = await calm('scouting_day_light', a);
        dayData.set(d.day, day);
      } catch (e) {
        if (!shown) { body.textContent = ''; body.append(el('div', 'note bad', e.message)); delete body.dataset.done; }
        else body.prepend(el('div', 'hint', 'Could not reach the database: this is the copy kept on this computer.'));
        return;
      } finally { upd.end(); }
    }
    if (shown !== JSON.stringify(day)) paintDay(day);
  };
  const paintDay = day => {
    if (day?.ai_ready != null) S.aiReadyKnown = day.ai_ready;
    // the zones a person opened or closed stay as they were when the fresh answer repaints the day
    const was = new Map([...body.querySelectorAll('.pd-zone-band')].map(b => [b.dataset.unit, b.open]));
    // and the folds inside a band (Plant health, Treatments, Traps…), by their place in it
    const inner = new Map();
    body.querySelectorAll('.pd-zone-band').forEach(b => b.querySelectorAll('details').forEach((x, i) => inner.set(`${b.dataset.unit}|${x.className}|${i}`, x.open)));
    body.textContent = '';
    // only a Not OK says anything here, in one line: its why (0174; the sections are on the date's line)
    const tk = day.task;
    const why = tk?.outcome === 'nok' ? (tk.outcome_note || '') : (!S.zoneFilter && d.summary?.outcome === 'nok' ? (d.summary.notes || '') : null);
    if (why != null) body.append(el('div', 'note bad sc-outcome', 'Not OK' + (why ? ' — ' + why : '') +
      (tk?.edited_at ? ` · changed ${farmWhen(tk.edited_at)}` : '')));
    const zones = (day.units || day.zones || []).filter(z => (!S.zoneFilter || (z.unit_id || z.zone_id) === S.zoneFilter)
      && (!S.cropFilter || (z.crops || []).some(c => c.id === S.cropFilter) || z.photos.some(p => p.crop_id === S.cropFilter)));
    // a zone with nothing in it that day is one word, not a band
    const has = z => z.traps.length || z.photos.length || (z.cases || []).length || z.item?.task?.status === 'done' || robotIn(z, rbDay).length;
    const full = zones.filter(has), empty = zones.filter(z => !has(z));
    if (S.zoneFilter && !full.length) body.append(el('div', 'hint', `Nothing photographed or counted in ${zoneName(S.zoneFilter)} that day.`));
    else if (!full.length && !rbDay.length && !(robotNames() && String(d.day) === String(S.over.today))) body.append(el('div', 'hint', S.cropFilter ? 'No zone with this crop.' : 'Nothing photographed that day.'));
    full.forEach(z => { const b = zoneBand(z, day, latest && !S.zoneFilter); if (S.zoneFilter) b.open = true;
      b.dataset.unit = z.unit_id || z.zone_id || z.name;
      if (was.has(b.dataset.unit) && was.get(b.dataset.unit) !== b.open) b.open = was.get(b.dataset.unit);
      b.querySelectorAll('details').forEach((x, i) => { const k = `${b.dataset.unit}|${x.className}|${i}`; if (inner.has(k) && inner.get(k) !== x.open) x.open = inner.get(k); });
      body.append(b); });
    if (empty.length && full.length) body.append(el('div', 'hint', 'Nothing photographed in ' + empty.map(z => z.name).join(', ') + '.'));
    // the robot's rows that name no zone of the day's bands: one line under the zones (not in a zone's own report)
    const loose = rbDay.filter(r => !full.some(z => robotIn(z, [r]).length));
    const waiting = !rbDay.length && robotNames() && String(d.day) === String(S.over.today);   // registered, nothing sent yet today
    if ((loose.length || waiting) && !S.zoneFilter && !S.cropFilter) { const s = robotSection(loose, robotOpts()); s.open = !full.length && loose.length > 0; body.append(s); }
  };
  det.addEventListener('toggle', () => { if (det.open) { openDays.add(String(d.day)); fill(); } else openDays.delete(String(d.day)); });
  if (openFirst || openDays.has(String(d.day))) { det.open = true; fill(); }
  return det;
}

// ── one zone of a day: its traps, then its plant photos ──
function zoneBand(z, day, withAi = false) {
  const photos = z.photos.filter(p => !S.cropFilter || p.crop_id === S.cropFilter).map(p => ({ ...p, zone: z.name }));
  const traps = z.traps.map(p => ({ ...p, zone: z.name }));
  const caseDots = (z.cases || []).map(k => (S.cases.cases || []).find(x => x.id === k.id)?.dot).filter(Boolean);
  const zd = worst([...photos.map(p => p.dot), ...traps.map(p => p.dot), ...caseDots]);   // an open case colours its zone too
  const det = el('details', 'pd-zone-band');
  det.open = !!zd || photos.length > 0;
  const sum = el('summary');
  const left = el('span', 'pd-zone-title');
  left.append(dotEl(zd), el('b', null, z.name));
  const cr = el('span', 'sc-crops');
  (z.crops || []).forEach(c => cr.append(cropAvatar({ ...c }, 'sm')));
  left.append(cr);
  sum.append(left);
  const right = el('span', 'pd-day-facts');
  if (z.zone_id) right.append(el('span', 'pill', traps.length ? `${traps.length} trap${traps.length > 1 ? 's' : ''}` : (z.item?.done_at ? 'traps skipped' : 'traps —')));
  right.append(el('span', 'pill', `${photos.length} photo${photos.length === 1 ? '' : 's'}`));
  (z.cases || []).forEach(k => {
    const full = (S.cases.cases || []).find(x => x.id === k.id);
    const b = el('button', 'pd-case small');
    b.append(dotEl(full?.dot || 'orange'), el('span', null, (full?.label || k.title.replace(/ in .*$/, ''))));
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); openCase(k.id, reload, S.farm); };
    right.append(b);
  });
  const zt = z.item?.task;                  // the zone's own task (0172)
  if (zt) {
    if (zt.outcome) right.append(el('span', 'pill ' + (zt.outcome === 'nok' ? 'bad' : 'ok'), zt.outcome === 'nok' ? 'Not OK' : 'OK'));
    right.append(el('span', 'hint', zt.status === 'done'
      ? [zt.workers?.length ? zt.workers.join(', ') : null, zt.done_at ? farmTime(zt.done_at) : null].filter(Boolean).join(' · ') || 'done'
      : zt.status === 'skipped' ? 'cancelled'
      // somebody has it open on a phone now (0203): the same lock as the Tasks board and the phones
      : zt.held ? `🔒 ${zt.held.running ? 'in progress' : 'paused'} · ${String(zt.held.name || 'somebody').split(/\s+/)[0]}`
      : 'not done'));
  } else if (z.item?.done_at) right.append(el('span', 'hint', farmTime(z.item.done_at)));
  else if (z.item && day.task?.status !== 'done') right.append(el('span', 'hint', 'not done'));   // a day scouted as one task never ticked its zones
  sum.append(right);
  det.append(sum);

  const body = el('div', 'pd-zone-body');
  // the AI's opinion on this zone over its 30 days, at the top of the latest day's report (0.7.176)
  if (withAi) body.append(opinionCard({ unit_id: z.unit_id || z.zone_id, zone_id: z.zone_id, system_id: z.system_id || null, zone: z.name }, true));
  // the phone's verdicts on the zone say something only when it is Not OK (0.7.268, owner 21 Oct 2026: "remove these
  // not useful information" — "Traps: No traps today" and the ✓ Traps ✓ Plant health pills)
  if (zt?.outcome === 'nok' && zt.outcome_note) body.append(el('div', 'note bad sc-outcome', zt.outcome_note));
  const noks = Object.entries(zt?.section_outcomes || {}).filter(([, v]) => v && v.outcome !== 'ok');
  if (noks.length) {
    const row = el('div', 'sc-verdicts');
    const LABEL = { trap: 'Traps', health: 'Plant health', growth: 'Growth' };
    noks.forEach(([k, v]) => { const pill = el('span', 'pill bad', `✕ ${LABEL[k] || k}${v.note ? ': ' + v.note : ''}`); row.append(pill); });
    body.append(row);
  }
  const shared = [...traps, ...photos].filter(p => p.shared).length;
  if (shared) body.append(el('div', 'hint pd-shared', `${shared} of these name ${z.zone_name || 'the zone'} without its table, so they are in each of its reports.`));
  // one compact section (0.7.264, owner 21 Oct 2026): every photo of the zone in one block on the left — plant health
  // first, then the photos with sizes and the robot's, newest at the top left — and on the right the water (open), the
  // treatments, the insects (their traps open in a window of their own) and the growth curve, closed with their figure
  const rb = robotIn(z, robotDay(day.day));
  if (rb.length) det.open = true;
  const hs = healthSection(z, day, photos, traps, rb);
  det.liveTraps = () => traps.filter(t => (z.traps || []).some(q => q.id === t.id)).length;
  body.append(hs);
  if (det.open) hs.load();
  det.addEventListener('toggle', () => { if (det.open) hs.load(); });
  if (!traps.length && !photos.length && !rb.length) body.append(el('div', 'hint', z.item?.done_at || zt?.status === 'done' ? 'Nothing photographed, traps not counted.' : 'Not scouted that day.'));
  const answers = (z.answers || []).filter(a => a.note || a.value || a.result === 'nok');
  answers.forEach(a => body.append(el('div', 'sc-answer', `${a.result === 'nok' ? '✗ ' : ''}${a.title || 'step ' + a.seq}: ${[a.value, a.note].filter(Boolean).join(' · ')}`)));
  det.append(body);
  return det;
}

export function viewerCtx(p, z, day) {
  return {
    farm: S.farm, photo: p, catalog: S.catalog || [], aiReady: day.ai_ready, mayWrite: day.may_write !== false,
    zonePhotos: () => z.zone_id ? rpc('zone_photos', { p_farm: S.farm.id, p_zone: z.zone_id }) : Promise.resolve([]),
    zoneId: z.zone_id, crops: z.crops || [],
    openCases: async () => (S.cases.cases || []).filter(c => c.zone_id === z.zone_id && c.status !== 'closed'),
    onChange: reload,
  };
}
