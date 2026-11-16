// Scouting page: the health section (insects and growth blocks)
import { robotFig } from '../robot.js';
import { sumpBlock } from '../sump.js';
import { treatBlock } from '../treatments.js';
import { el, num, drawer, shortDay } from '../ui.js';
import { photoFig, trapCard } from './cards.js';
import { G_WORD, growthCurve, insectStrip } from './curves.js';
import { reload } from './index.js';
import { S, longDay, robotOpts } from './state.js';
import { panelCall } from './thumbs.js';

// ── a zone's plant health (0.7.175, owner 30 Sept 2026: "2/3 of the width for the health pictures, 1/3 on the right:
// on top the average insects a day for the whole bay with its curve over time, at the bottom the heat map with all
// the information of the traps; the traps block can go if its information is in the daily report") ──
const newestFirst = (a, b) => (Date.parse(b.taken_at || b.at) || 0) - (Date.parse(a.taken_at || a.at) || 0);
export function healthSection(z, day, photos, traps, robotRows = []) {
  const sec = el('div', 'pd-sec pd-health');
  const health = photos.filter(p => p.section !== 'growth').sort(newestFirst);
  const growth = photos.filter(p => p.section === 'growth').sort(newestFirst);
  const grid = el('div', 'pd-hgrid');
  // left, two thirds: one block of photos — health first, then sizes and the robot's, each newest first
  const left = el('div', 'pd-hleft');
  const head = el('div', 'pd-photos-head');
  const measured = growth.filter(p => (p.measures || []).length).length;
  const toValidate = robotRows.filter(r => r.status === 'new').length;
  head.append(el('b', null, 'Photos'), el('span', 'hint', [
    health.length ? `${health.length} plant health` : null,
    growth.length ? `${growth.length} growth${measured < growth.length ? ` (${measured} with sizes)` : ''}` : null,
    robotRows.length ? `${robotRows.length} Matthew G1` : null].filter(Boolean).join(' · ') || 'no photo that day'));
  if (toValidate) head.append(el('span', 'pill warn', `${toValidate} to validate`));
  left.append(head);
  if (health.length || growth.length || robotRows.length) {
    const g = el('div', 'sc-grid pd-hphotos');
    // the photos the viewer slides through, in this order — read when a photo opens, so a photo removed meanwhile is gone
    const order = [...health, ...growth];
    const gallery = { label: 'Photos', list: () => order.filter(p => (z.photos || []).some(q => q.id === p.id)) };
    health.forEach(p => g.append(photoFig(p, z, day, gallery)));
    const later = [...growth.map(p => ({ t: Date.parse(p.taken_at) || 0, p })), ...robotRows.map(r => ({ t: Date.parse(r.at) || 0, r }))]
      .sort((a, b) => b.t - a.t);
    later.forEach(x => g.append(x.p ? photoFig(x.p, z, day, gallery) : robotFig(x.r, robotOpts())));
    left.append(g);
  } else left.append(el('div', 'hint pd-hnone', 'No photo that day.'));
  // right, one third: the water open, then treatments, insects and growth closed with their figure on the line
  const right = el('div', 'pd-hright');
  const call = panelCall(String(day.day));               // the zone's blocks come in one answer for the day (0198)
  const sump = sumpBlock(S.farm, z, day, call);
  const treat = treatBlock(S.farm, z, day, call, reload);   // the IPM programs on this zone's tables (0197)
  treat.keepClosed = true;
  const ins = insectsBlock(z, day, traps);
  const grow = growthBlock();
  right.append(sump, treat, ins, grow);
  grid.append(left, right);
  sec.append(grid);
  sec.load = async () => {
    if (sec.dataset.loaded) return;
    sec.dataset.loaded = '1';
    sump.load();
    treat.load();
    call('zone_growth', { p_farm: S.farm.id, p_zone: z.zone_id, p_system: z.system_id || null, p_day: day.day })
      .then(g => grow.fill(g)).catch(e => grow.fill(null, e));
    try {
      const h = await call('zone_health', { p_farm: S.farm.id, p_zone: z.zone_id, p_system: z.system_id || null, p_day: day.day });
      ins.fill(h);
    } catch (e) { ins.fail(e); delete sec.dataset.loaded; }
  };
  return sec;
}

// the insects (0.7.266, 0.7.267 owner 21 Oct 2026: "make the insect block collapsible opening the heat map and only a
// special click to have the side page with all traps pics"): a fold — its line holds the insects a day in its colour,
// the traps over or on watch and what is to look at again; open, the curve and the trap map; the button "Trap photos"
// (on the line and inside) opens the side page with every trap photo of the day to slide, and each trap's history
function insectsBlock(z, day, traps) {
  const box = el('details', 'pd-fold pd-ins-block');
  const sum = el('summary');
  const mu = (S.tmap?.units || []).find(u => u.n === z.zone_number);
  const spots = mu ? (S.tmap.spots || []).filter(s => s.n === mu.n && s.active) : [];
  const rate = el('span', 'tr-kpi'); rate.hidden = true;
  sum.append(el('span', 'pd-hlabel', 'Insects'), rate);
  const over = spots.filter(s => s.tone === 'red').length, watch = spots.filter(s => s.tone === 'orange').length;
  const toCheck = traps.filter(p => ['fewer', 'auto_new', 'excluded'].includes(p.check?.state)).length;
  const codes = [...new Set(traps.map(p => p.code))];
  sum.append(el('span', 'hint', traps.length ? `${codes.length} trap${codes.length === 1 ? '' : 's'} read` : spots.length ? 'not read that day' : 'no trap'));
  if (over) sum.append(el('span', 'pill bad', `${over} over`));
  if (watch) sum.append(el('span', 'pill warn', `${watch} on watch`));
  if (toCheck) sum.append(el('span', 'pill warn', `${toCheck} to look at again`));
  const live = () => traps.filter(t => (z.traps || []).some(q => q.id === t.id));
  const photosBtn = cls => {
    const b = el('button', 'btn btn-sm ' + cls, `Trap photos${traps.length ? ' · ' + traps.length : ''} ›`);
    b.type = 'button'; b.title = 'Every trap photo of the day in a side page, to slide one after the other';
    b.disabled = !traps.length;
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); open(); };
    return b;
  };
  sum.append(photosBtn('pd-ins-photos'));
  box.append(sum);
  // inside: the curve (read with the zone) and the map
  const body = el('div', 'pd-fold-body');
  const curve = el('div', 'pd-ins-curve');
  curve.append(el('div', 'hint', 'Reading the insects a day…'));
  body.append(curve);
  if (mu && S.kit) { const m = S.kit.unitMap(mu, spots); m.classList.add('tm-mini'); body.append(m); }
  else body.append(el('div', 'hint', 'No trap map for this zone.'));
  const lastRead = spots.map(s => s.read_at).filter(Boolean).sort().pop();
  const foot = el('div', 'pd-ins-foot');
  if (lastRead) foot.append(el('span', 'hint', 'last read ' + shortDay(lastRead)));
  foot.append(photosBtn(''));
  body.append(foot);
  box.append(body);
  box.open = false;
  box.fill = h => {
    const strip = insectStrip(h, z), b = strip.querySelector('.pd-ins-big');
    curve.textContent = ''; curve.append(strip);
    if (!b) return;
    rate.textContent = b.textContent + '/day';
    rate.className = 'tr-kpi ' + (b.classList.contains('bad') ? 'bad' : b.classList.contains('warn') ? 'warn' : 'ok');
    rate.title = 'Insects a trap a day, the last day read'; rate.hidden = false;
  };
  box.fail = e => {
    rate.hidden = false; rate.className = 'tr-kpi'; rate.textContent = '?'; rate.title = String(e?.message || e);
    curve.textContent = ''; curve.append(el('div', 'note bad', 'The insects a day could not be read: close and open the zone again.'));
  };
  const open = () => {
    const now = live();
    const d = drawer(`Trap photos · ${z.name}`, `${longDay(day.day)} · ${now.length} photo${now.length === 1 ? '' : 's'}, both sides of each card`);
    d.box.classList.add('sump-drawer', 'pd-ins-drawer');
    if (!now.length) { d.body.append(el('div', 'hint', 'No trap photo that day.')); return; }
    const cards = el('div', 'pd-traps');
    const gallery = { label: 'Trap photos', list: live };
    // a trap's comment is one for the trap: on its first side's card only, not on both (review 15 Oct 2026)
    const noted = new Set();
    now.forEach(p => { const k = (p.code || '') + '|' + (p.note || ''); const first = !noted.has(k); noted.add(k);
      cards.append(trapCard(p, z, day, first, gallery)); });
    d.body.append(cards);
    if (S.kit && codes.length) {
      const hist = el('div', 'pd-hist');
      hist.append(el('span', 'hint', 'History:'));
      codes.forEach(c => { const sp = S.kit.spotOf(c); if (!sp) return; const b = el('button', 'pd-cropchip', c); b.onclick = () => S.kit.openSpots(`${z.name} · trap ${c}`, [sp]); hist.append(b); });
      if (hist.children.length > 1) d.body.append(hist);
    }
  };
  return box;
}

// the growth curve, closed (0.7.264): the line holds the latest size measured in the zone
function growthBlock() {
  const box = el('details', 'pd-fold pd-grow-block');
  const sum = el('summary');
  const kpi = el('span', 'hint', 'reading…');
  sum.append(el('span', 'pd-hlabel', 'Growth'), kpi);
  const inner = el('div', 'pd-fold-body');
  box.append(sum, inner);
  box.fill = (g, err = null) => {
    inner.textContent = '';
    if (err) { kpi.textContent = 'not read'; kpi.className = 'hint'; kpi.title = String(err.message || err); return; }
    const pts = g?.points || [];
    if (!pts.length) { kpi.textContent = 'no size yet'; inner.append(el('div', 'hint', 'Sizes come from photos with the scale card.')); return; }
    const last = pts.reduce((a, p) => (String(p.day) >= String(a.day) ? p : a), pts[0]);
    kpi.textContent = `${G_WORD[last.what] || last.what} ${num(last.mm, 0)} mm · ${shortDay(last.day)}`;
    kpi.className = 'tr-kpi ok';
    const c = growthCurve(g);
    if (c) inner.append(c);
  };
  return box;
}
