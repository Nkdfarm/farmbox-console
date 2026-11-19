// Scouting page: the page paint (day rows, zone bar, dashboard)
import { rpc } from '../api.js';
import { newCase } from '../cases.js';
import { el, pageHead, emptyState } from '../ui.js';
import { unfiledButton } from '../unfiled.js';
import { dayRow } from './day.js';
import { feedButton, opinionsButton } from './feed.js';
import { caseStrip, cropBar } from './found.js';
import { reload } from './index.js';
import { opinionCard } from './opinion.js';
import { openRemoved } from './removed.js';
import { S, cur, robotNames, zoneName } from './state.js';
import { dashboard, zoneBar, zoneReport } from './zones.js';

// the days a person opened stay open, and the page keeps its scroll, when it is drawn again after a tag, an AI
// answer or a case point (review 3 Oct 2026: it went back to "today open" at the top every time)
export const openDays = new Set();
export function paint() {
  const keepY = S.mount.childElementCount ? window.scrollY : null;
  S.mount.textContent = '';
  if (keepY != null) requestAnimationFrame(() => window.scrollTo(0, keepY));
  const openBtn = el('button', 'btn btn-primary', 'Open a case');
  openBtn.onclick = () => newCase({ farm: S.farm, crop_id: S.cropFilter, crops: S.over.crops || [], onDone: reload });
  const scaleBtn = el('a', 'btn', 'Scale card');
  scaleBtn.href = 'scale-card.html'; scaleBtn.target = '_blank'; scaleBtn.rel = 'noopener';
  scaleBtn.title = 'The printed card for growth photos: a black-and-white marker with a 5 cm square the phone measures against';
  const setupBtn = el('button', 'btn', 'Traps and limits…');
  setupBtn.title = 'Every trap on the list, add or move one, the watch and over limits';
  setupBtn.onclick = () => S.kit?.openSetup();
  const sizeBtn = el('button', 'btn', 'Map size…');
  sizeBtn.title = 'How the trap map draws a zone';
  sizeBtn.onclick = () => S.kit?.openSize();
  const removedBtn = el('button', 'btn', 'Removed photos…');
  removedBtn.title = 'The photos taken off the reports in the last 30 days; a manager can put one back';
  removedBtn.onclick = openRemoved;
  S.mount.append(pageHead(null,
    'The whole greenhouse first, then each scouting day by zone. ' +
    'A dot marks the worst thing inside: red severe or over the limit, orange open or on watch, green improving or resolved.',
    scaleBtn, setupBtn, ...(S.tmap?.may_edit ? [sizeBtn] : []), removedBtn, unfiledButton(S.farm, reload), feedButton(), opinionsButton(), openBtn));

  if (S.zoneFilter && !cur()) S.zoneFilter = null;   // a zone gone, or Zone 4 now reported as 4.1 and 4.2
  S.mount.append(zoneBar());
  if (S.zoneFilter) S.mount.append(opinionCard(), zoneReport());
  else {
    // the whole greenhouse first, always open: the AI's report with its trend, the notes under it, any day by the
    // calendar (0.7.237, owner 12 Oct 2026) — not in one zone's report, which has its own AI opinion just above
    if (S.gh) S.mount.append(S.gh.panel());
    S.mount.append(dashboard());
  }
  S.mount.append(caseStrip());
  S.mount.append(cropBar());

  const list = el('div', 'pd-days');
  // a day only the robot worked gets its own date line, inside the dates read so far
  const oldest = S.dates.length ? S.dates[S.dates.length - 1].day : null;
  // … and today always has one while a robot is registered, so its line is there before it has sent anything (0.7.185)
  const robotOnly = [...new Set((S.robot?.rows || []).map(r => String(r.day)).concat(robotNames() && S.over?.today ? [String(S.over.today)] : []))]
    .filter(day => !S.dates.some(d => String(d.day) === day) && (S.moreDone || !oldest || day > String(oldest))).map(day => ({ day }));
  // (a day that holds only a note or the AI's report on the whole greenhouse had a line here in 0.7.236; the panel
  // on top shows it now, and its calendar marks it)
  const shown = S.dates.filter(d => !S.cropFilter || (d.photo_crops || {})[S.cropFilter] || d.traps).concat(S.cropFilter ? [] : robotOnly)
    .sort((x, y) => String(y.day).localeCompare(String(x.day)));
  if (S.zoneFilter) list.append(el('div', 'pd-zone-head', `${zoneName(S.zoneFilter)} — the scouting report by date`));
  if (!shown.length) list.append(emptyState('No scouting report yet. The phone makes one every working day.'));
  // only today's report opens by itself (0.7.202, owner 2 Oct 2026: "only today report is opened, other reports are
  // closed"; it was today and yesterday, or the latest, since 0.7.174) — a day opens, and is read, when it is clicked
  // … and with no report today yet, the latest one (0.7.203, owner: "yes open the last one")
  const today = String(S.over.today), any = shown.some(d => d.day === today);
  shown.forEach((d, i) => { const o = d.day === today || (!any && i === 0); list.append(dayRow(d, o, o)); });   // the AI line on the day that opens
  S.mount.append(list);
  if (!S.moreDone) {
    const more = el('button', 'btn btn-sm', 'Show older reports');
    more.onclick = async () => {
      more.disabled = true;
      S.olderSeq++;                              // a re-read of the older days on its way knows nothing of these: dropped
      const base = S.dates;
      try {
        const older = await rpc('scouting_dates', { p_farm: S.farm.id, p_before: S.dates[S.dates.length - 1].day, p_limit: 21 });
        if (S.dates !== base) return;            // the page was read and painted again meanwhile: its own button asks afresh
        S.moreDone = older.length < 21;
        S.dates = S.dates.concat(older);
        const start = list.children.length;
        older.filter(d => !S.cropFilter || (d.photo_crops || {})[S.cropFilter] || d.traps).forEach(d => list.append(dayRow(d, false)));
        if (S.moreDone) more.remove(); else more.disabled = false;
        if (list.children.length === start) more.textContent = 'Show older reports (none with this crop)';
      } catch (e) { more.disabled = false; more.textContent = e.message; }
    };
    S.mount.append(more);
  }
}
