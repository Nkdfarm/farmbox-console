// renderTimeline, load and reload, the crop-cycle helpers and paint
import { farmDate, loading, el, toast, pref, money } from '../ui.js';
import { openFast } from '../api.js';
import { DAY, ds, span, dn, LABEL_W, SPANS, nice, SPAN_KEY, S } from './state.js';
import { steadyBar, steadyGroups, startSteady, steadyHead } from './steady.js';
import { palette } from './drag.js';
import { weeksOf, kgRow, plantsRow } from './weeks.js';
import { scale, legend, zoneBlock } from './grid.js';
import { succession } from './succession.js';
import { openLabels, validate, discard } from './batch.js';
import { openCancelValidated } from './clear.js';

// the window on screen: a week back from today, then the span (warm() reads the same)
export function timelineRange(off = 0) {
  const t = farmDate(); const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY;
  const from = today - 7 + off;
  return { p_from: ds(from), p_to: ds(from + span() - 1) };
}

export async function renderTimeline(container, currentFarm, plannerShell) {
  if (S.farm?.id !== currentFarm.id) { S.offset = 0; S.selected.clear(); S.steadyMode = false; S.steadyPick.clear(); S.steadyEdit = null; }
  S.farm = currentFarm; S.mount = container; S.shell = plannerShell || null;
  await load();
}

let loadSeq = 0;   // ‹ › clicked quickly: only the last period asked for draws
async function load(fresh = false) {
  const here = S.mount, my = ++loadSeq;
  await openFast([['crop_timeline', { p_farm: S.farm.id, ...timelineRange(S.offset) }]], {
    show: ([d]) => { S.data = d; paint(); },
    waiting: () => { S.mount.textContent = ''; S.mount.append(loading('Drawing the plan…')); },
    // a reload after a change that fails keeps the board on screen and says so
    failed: e => { if (fresh && S.data && S.mount.querySelector('.tl-board')) { toast(e.message, 'bad'); return; } S.mount.textContent = ''; S.mount.append(el('div', 'note bad', e.message)); },
    // the Map may have taken the same box meanwhile (crops.js: fbc_planner_view)
    stillHere: () => here.isConnected && S.mount === here && my === loadSeq && (!S.shell || pref.get('fbc_planner_view') !== 'map'), fresh,
  });
}
export const reload = () => load(true);

// ── what fits where ──────────────────────────────────────────────────────────
export const fits = (crop, sys) => (crop.media || []).some(m => (sys.media || []).includes(m))
  && (!(sys.categories || []).length || sys.categories.includes(crop.category));
export function cycleOf(crop, tp) {       // a crop's days from a transplant day number: its bar
  const hs = tp + (crop.grow_days || 0);
  const he = hs + Math.max((crop.harvest_days || 1) - 1, 0);
  // sow = the day its seedlings must be started or ordered: the farm's lead (0.7.162 — an external nursery's 4–5 weeks), else the crop's nursery days
  return { sow: tp - Math.round(crop.lead ?? crop.nursery_days ?? 0), tp, hs, he, to: he + (crop.cleanup_days || 0) };
}
const posBatches = pid => (S.data.batches || []).filter(b => b.position_id === pid && b.status !== 'harvested');
export function clashOn(pid, from, to, except) {
  return posBatches(pid).find(b => b.id !== except && dn(b.stay_from) <= to && dn(b.stay_to) >= from) || null;
}

// ── the page ─────────────────────────────────────────────────────────────────
export function paint() {
  // the same window drawn again (a selection, a drop, a move): keep where the person was looking —
  // it used to jump back to today and to the top every time (review 3 Oct 2026)
  const win = S.data.from + '|' + S.data.to, oldBoard = S.mount.querySelector('.tl-board');
  const keep = oldBoard && win === S.lastWin ? { x: oldBoard.scrollLeft, y: oldBoard.scrollTop } : null;
  S.lastWin = win;
  S.mount.textContent = '';
  const may = S.data.may_plan, cur = S.data.currency || 'ZAR';
  const from = dn(S.data.from), to = dn(S.data.to), days = to - from + 1, today = dn(S.data.today);
  const width = Math.max(S.mount.clientWidth || 1000, 700) - LABEL_W - 2;
  const px = Math.max(span() > 200 ? 2.2 : 4, width / days);

  // no page head (0.7.119): the calendar options go in the planner's top bar, which stays in place when
  // the view changes (0.7.120); the explanation is behind its ⓘ
  const seg = el('div', 'seg');
  SPANS.forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label);
    b.setAttribute('aria-pressed', String(String(span()) === v));
    b.onclick = () => { pref.set(SPAN_KEY, v); S.offset = 0; load(); };
    seg.append(b);
  });
  const back = el('button', 'btn btn-sm', '‹'); back.title = 'Earlier';
  const fwd = el('button', 'btn btn-sm', '›'); fwd.title = 'Later';
  const now = el('button', 'btn btn-sm', 'Today');
  const stepDays = Math.round(span() / 2);
  back.onclick = () => { S.offset -= stepDays; load(); };
  fwd.onclick = () => { S.offset += stepDays; load(); };
  now.onclick = () => { S.offset = 0; load(); };
  const controls = [now, back, fwd, el('b', 'tl-range', `${nice(S.data.from)} – ${nice(S.data.to)}`), el('div', 'spacer'), seg];
  if (S.shell) { S.shell.left.replaceChildren(...controls); S.shell.setHelp('One row per position. Drag a crop from the list onto a row to plan it; drag a bar to move it, its right edge ' +
    'to change the harvest. Click a bar for the batch, an empty day to plan one there; Shift-click to select several. ' +
    'Each zone has its kg per week (forecast green, harvested orange) and its number of positions (whole or half rows). ' +
    'Steady harvest… picks zones to plan together: every position is replanted on a fixed weekly rhythm for an even harvest, ' +
    'and changing a steady zone\'s positions plans its group again at once (with Undo). A FarmBox may keep several steady groups: ' +
    '＋ Steady group… starts another, each with its own colour, crops, rhythm and Undo. Nothing is planted until it is validated.'); }
  else { const bar = el('div', 'tl-nav'); bar.append(...controls); S.mount.append(bar); }

  // proposals and a selection: the decisions in one place
  const proposed = (S.data.batches || []).filter(b => b.status === 'proposed');
  const act = el('div', 'tl-actions');
  if (may) {
    // the whole farm is no longer planned in one go (0.7.137): Plan this bay on each zone
    const suc = el('button', 'btn btn-sm', 'Succession…');
    suc.title = 'The same crop planted again and again — every week, say — for a steady harvest';
    suc.onclick = () => succession();
    act.append(suc);
    if (!S.steadyMode) {
      const st = el('button', 'btn btn-sm tl-steady-btn', steadyGroups().length ? '＋ Steady group…' : 'Steady harvest…');
      st.title = 'Pick zones to plan together for an even harvest every week — different crops may be mixed. ' +
        'Each group has its own rhythm; the zones of an existing group are changed from its own bar.';
      st.onclick = () => startSteady(null);
      act.append(st);
    }
    const lb = el('button', 'btn btn-sm', 'Labels…');
    lb.title = 'Print the labels of the batches transplanted in a week, or of the bars selected';
    lb.onclick = () => openLabels();
    act.append(lb);
    const cv = el('button', 'btn btn-sm btn-ghost tl-clear', 'Cancel validated…');
    cv.title = 'Cancel the validated batches of this unit or of a steady group — and plan the steady groups again';
    cv.onclick = () => openCancelValidated();
    act.append(cv);
    if (proposed.length) {
      const rev = proposed.reduce((a, b) => a + Number(b.revenue || 0), 0);
      act.append(el('span', 'pill', `${proposed.length} proposed · ${money(rev, cur)}`));
      // the proposals of the dates on screen only: a longer span shows the ones further ahead (0.7.162)
      const ok = el('button', 'btn btn-sm btn-accent', `Validate ${S.selected.size ? 'selected ' + S.selected.size : proposed.length + ' on screen'}`);
      ok.title = 'Validates the proposals in the dates on screen. Choose a longer span (6 months, Year) to include the ones further ahead.';
      ok.onclick = () => validate(ok, S.selected.size ? [...S.selected] : proposed.map(b => b.id));
      const no = el('button', 'btn btn-sm', S.selected.size ? `Remove selected ${S.selected.size}` : `Discard ${proposed.length} on screen`);
      no.onclick = () => discard(S.selected.size ? [...S.selected] : proposed.map(b => b.id));
      act.append(ok, no);
    } else if (S.selected.size) {
      const no = el('button', 'btn btn-sm', `Remove selected ${S.selected.size}`);
      no.onclick = () => discard([...S.selected]);
      act.append(no);
    }
    if (S.selected.size) {
      const clear = el('button', 'btn btn-sm btn-ghost', 'Clear selection');
      clear.onclick = () => { S.selected.clear(); paint(); };
      act.append(clear);
    }
  }
  S.mount.append(act);
  if (may && S.steadyMode) S.mount.append(steadyBar());

  // the crop palette
  if (may) S.mount.append(palette());

  // the board (0.7.118): a scroll bar on top for moving through time; below it a window
  // that scrolls both ways, its head — dates, kg per week of the whole farm, plants per
  // week — pinned while the zones scroll under it, each zone opened by its own kg line
  const W = weeksOf(from, days);
  const board = el('div', 'tl-board');
  const inner = el('div', 'tl-inner');
  const innerW = LABEL_W + days * px;
  inner.style.width = innerW + 'px';
  inner.style.setProperty('--px', px + 'px');
  const pinned = el('div', 'tl-sticky');
  pinned.append(scale(from, days, px, today), kgRow('All zones', W, null, from, px, true), plantsRow('All zones · plants', W, null, from, px, true));
  inner.append(pinned);
  // each steady group first, its zones under its own lines, in its own colour; then the others
  const systems = S.data.systems || [];
  const grouped = new Set();
  steadyGroups().forEach(g => {
    const zs = systems.filter(s => s.steady_group_id === g.id);
    if (!zs.length) return;
    zs.forEach(z => grouped.add(z.id));
    inner.append(...steadyHead(g, zs, W, from, px));
    zs.forEach(sys => zoneBlock(inner, sys, W, from, to, px, today, cur, g));
  });
  const otherZones = systems.filter(s => !grouped.has(s.id));
  if (grouped.size && otherZones.length) { const sep = el('div', 'tl-zone tl-others'); sep.append(el('div', 'tl-label', 'Other zones')); inner.append(sep); }
  otherZones.forEach(sys => zoneBlock(inner, sys, W, from, to, px, today, cur, null));
  board.append(inner);
  // the scroll bar on top: the same sideways position as the board, both ways
  const hs = el('div', 'tl-hscroll');
  const hsi = el('div'); hsi.style.width = innerW + 'px'; hs.append(hsi);
  let syncing = false;
  hs.addEventListener('scroll', () => { if (syncing) { syncing = false; return; } syncing = true; board.scrollLeft = hs.scrollLeft; });
  board.addEventListener('scroll', () => { if (syncing) { syncing = false; return; } syncing = true; hs.scrollLeft = board.scrollLeft; });
  S.mount.append(hs, board);
  // open on today, a week in
  requestAnimationFrame(() => {
    if (keep) { board.scrollLeft = hs.scrollLeft = keep.x; board.scrollTop = keep.y; }
    else board.scrollLeft = hs.scrollLeft = Math.max(0, (today - from - 3) * px);
  });

  S.mount.append(legend());
}
