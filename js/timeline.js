// ═══════════════════════════════════════════════════════════════════════════
// Crop planner — the timeline (console 0.7.113, migration 0105)
//
// One row per growing position, grouped by zone; time runs left to right. Each
// batch is a bar over the days it holds its position: growing, then the
// harvest (darker), then the cleanup (grey); its nursery is a hatched strip
// before it, off the row, because seedlings do not hold a position.
//
// A manager (or the agronomist) plans by hand:
//   · drag a crop from the palette onto a row — a proposal lands there, its
//     length the crop's own cycle; a row it does not fit, or a slot that is
//     taken, shows red while dragging;
//   · drag a bar to another day or another row (move_batch), its right edge to
//     lengthen or shorten the harvest (resize_batch);
//   · click a bar for the batch, click an empty day to plan one there;
//   · Shift-click bars to validate or remove several at once.
// The database checks every drop again; the colours only say it in advance.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, drawer, field, input, selectBox, toast, busy, confirmDrawer, pref, cropAvatar, cropHue,
         systemLabel, mediumLabel, nurseryLine } from './ui.js';

const SPANS = [['35', '5 weeks'], ['91', '3 months'], ['182', '6 months'], ['365', 'Year']];
const SPAN_KEY = 'fbc_tl_span';
const LABEL_W = 176;                       // the sticky column of zone and position names
const DAY = 864e5;

// dates as day numbers, in UTC so a date never slips a day with the time zone
const dn = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const ds = n => new Date(n * DAY).toISOString().slice(0, 10);
const nice = s => s ? new Date(dn(s) * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const money = (n, cur) => n == null ? '—' : `${cur} ${Math.round(Number(n)).toLocaleString()}`;

// shell (0.7.120): the planner's top bar from crops.js — this view fills its left part and its ⓘ text
let farm = null, mount = null, data = null, offset = 0, selected = new Set(), shell = null;
const span = () => Number(pref.get(SPAN_KEY)) || 91;

// the window on screen: a week back from today, then the span (warm() reads the same)
export function timelineRange(off = 0) {
  const t = new Date(); const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY;
  const from = today - 7 + off;
  return { p_from: ds(from), p_to: ds(from + span() - 1) };
}

export async function renderTimeline(container, currentFarm, plannerShell) {
  if (farm?.id !== currentFarm.id) { offset = 0; selected.clear(); }
  farm = currentFarm; mount = container; shell = plannerShell || null;
  await load();
}

async function load(fresh = false) {
  const here = mount;
  await openFast([['crop_timeline', { p_farm: farm.id, ...timelineRange(offset) }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Drawing the plan…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}
const reload = () => load(true);

// ── what fits where ──────────────────────────────────────────────────────────
const fits = (crop, sys) => (crop.media || []).some(m => (sys.media || []).includes(m))
  && (!(sys.categories || []).length || sys.categories.includes(crop.category));
function cycleOf(crop, tp) {       // a crop's days from a transplant day number: its bar
  const hs = tp + (crop.grow_days || 0);
  const he = hs + Math.max((crop.harvest_days || 1) - 1, 0);
  return { sow: tp - Math.round(crop.nursery_days || 0), tp, hs, he, to: he + (crop.cleanup_days || 0) };
}
const posBatches = pid => (data.batches || []).filter(b => b.position_id === pid && b.status !== 'harvested');
function clashOn(pid, from, to, except) {
  return posBatches(pid).find(b => b.id !== except && dn(b.stay_from) <= to && dn(b.stay_to) >= from) || null;
}

// ── the page ─────────────────────────────────────────────────────────────────
function paint() {
  mount.textContent = '';
  const may = data.may_plan, cur = data.currency || 'ZAR';
  const from = dn(data.from), to = dn(data.to), days = to - from + 1, today = dn(data.today);
  const width = Math.max(mount.clientWidth || 1000, 700) - LABEL_W - 2;
  const px = Math.max(span() > 200 ? 2.2 : 4, width / days);

  // no page head (0.7.119): the calendar options go in the planner's top bar, which stays in place when
  // the view changes (0.7.120); the explanation is behind its ⓘ
  const seg = el('div', 'seg');
  SPANS.forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label);
    b.setAttribute('aria-pressed', String(String(span()) === v));
    b.onclick = () => { pref.set(SPAN_KEY, v); offset = 0; load(); };
    seg.append(b);
  });
  const back = el('button', 'btn btn-sm', '‹'); back.title = 'Earlier';
  const fwd = el('button', 'btn btn-sm', '›'); fwd.title = 'Later';
  const now = el('button', 'btn btn-sm', 'Today');
  const stepDays = Math.round(span() / 2);
  back.onclick = () => { offset -= stepDays; load(); };
  fwd.onclick = () => { offset += stepDays; load(); };
  now.onclick = () => { offset = 0; load(); };
  const controls = [now, back, fwd, el('b', 'tl-range', `${nice(data.from)} – ${nice(data.to)}`), el('div', 'spacer'), seg];
  if (shell) { shell.left.replaceChildren(...controls); shell.setHelp('One row per position. Drag a crop from the list onto a row to plan it; drag a bar to move it, its right edge ' +
    'to change the harvest. Click a bar for the batch, an empty day to plan one there; Shift-click to select several. ' +
    'Each zone has its kg per week (forecast green, harvested orange) and its number of positions. Nothing is planted until it is validated.'); }
  else { const bar = el('div', 'tl-nav'); bar.append(...controls); mount.append(bar); }

  // proposals and a selection: the decisions in one place
  const proposed = (data.batches || []).filter(b => b.status === 'proposed');
  const act = el('div', 'tl-actions');
  if (may) {
    const all = el('button', 'btn btn-primary btn-sm', 'Plan the whole farm');
    all.title = 'Fill every free position inside the window with what earns most per day';
    all.onclick = () => propose(all);
    const suc = el('button', 'btn btn-sm', 'Succession…');
    suc.title = 'The same crop planted again and again — every week, say — for a steady harvest';
    suc.onclick = () => succession();
    act.append(all, suc);
    if (proposed.length) {
      const rev = proposed.reduce((a, b) => a + Number(b.revenue || 0), 0);
      act.append(el('span', 'pill', `${proposed.length} proposed · ${money(rev, cur)}`));
      const ok = el('button', 'btn btn-sm btn-accent', `Validate ${selected.size ? 'selected ' + selected.size : 'all ' + proposed.length}`);
      ok.onclick = () => validate(ok, selected.size ? [...selected] : proposed.map(b => b.id));
      const no = el('button', 'btn btn-sm', selected.size ? `Remove selected ${selected.size}` : 'Discard proposals');
      no.onclick = () => discard(selected.size ? [...selected] : proposed.map(b => b.id));
      act.append(ok, no);
    } else if (selected.size) {
      const no = el('button', 'btn btn-sm', `Remove selected ${selected.size}`);
      no.onclick = () => discard([...selected]);
      act.append(no);
    }
    if (selected.size) {
      const clear = el('button', 'btn btn-sm btn-ghost', 'Clear selection');
      clear.onclick = () => { selected.clear(); paint(); };
      act.append(clear);
    }
  }
  mount.append(act);

  // the crop palette
  if (may) mount.append(palette());

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
  pinned.append(scale(from, days, px, today), kgRow('All zones', W, null, from, px, true), plantsRow(W, from, px));
  inner.append(pinned);
  (data.systems || []).forEach(sys => {
    const zh = el('div', 'tl-zone');
    const lab = el('div', 'tl-label tl-zone-label');
    lab.append(el('b', null, sys.name), el('span', 'hint', ' ' + systemLabel(sys.type)));
    lab.title = 'Growing medium: ' + (sys.media || []).map(mediumLabel).join(', ') +
      ((sys.categories || []).length ? ' · kept for ' + sys.categories.join(', ').replace(/_/g, ' ') : '');
    zh.append(lab);
    const zt = el('div', 'tl-zone-track');
    if (may) zt.append(splitMenu(sys));
    if (may) {
      const pb = el('button', 'btn btn-sm btn-ghost', 'Plan this bay');
      pb.title = 'Fill the free positions of this bay only';
      pb.onclick = () => propose(pb, sys.code, sys.name);
      zt.append(pb);
    }
    zh.append(zt);
    inner.append(zh);
    inner.append(kgRow('kg / week', W, sys.id, from, px, false));
    (sys.positions || []).forEach(p => inner.append(row(sys, p, from, to, px, today, cur)));
  });
  board.append(inner);
  // the scroll bar on top: the same sideways position as the board, both ways
  const hs = el('div', 'tl-hscroll');
  const hsi = el('div'); hsi.style.width = innerW + 'px'; hs.append(hsi);
  let syncing = false;
  hs.addEventListener('scroll', () => { if (syncing) { syncing = false; return; } syncing = true; board.scrollLeft = hs.scrollLeft; });
  board.addEventListener('scroll', () => { if (syncing) { syncing = false; return; } syncing = true; hs.scrollLeft = board.scrollLeft; });
  mount.append(hs, board);
  // open on today, a week in
  requestAnimationFrame(() => { board.scrollLeft = hs.scrollLeft = Math.max(0, (today - from - 3) * px); });

  mount.append(legend());
}

function scale(from, days, px, today) {
  const s = el('div', 'tl-scale');
  s.append(el('div', 'tl-label tl-scale-label', 'Position'));
  const track = el('div', 'tl-track tl-scale-track');
  const closed = new Set((data.holidays || []).map(dn));
  const open = new Set(data.operating_days || [1, 2, 3, 4, 5]);
  for (let i = 0; i < days; i++) {
    const d = new Date((from + i) * DAY);
    const dow = d.getUTCDay() || 7, dom = d.getUTCDate();
    if (dom === 1 || i === 0) {
      const m = el('span', 'tl-month', d.toLocaleDateString(undefined, { month: 'short', year: dom === 1 && d.getUTCMonth() === 0 ? 'numeric' : undefined, timeZone: 'UTC' }));
      m.style.left = (i * px) + 'px';
      track.append(m);
    }
    if (px >= 14 || (px >= 4 && dow === 1)) {
      const t = el('span', 'tl-tick' + (dow === 1 ? ' mon' : ''), px >= 14 ? String(dom) : String(dom));
      t.style.left = (i * px) + 'px'; t.style.width = (px >= 14 ? px : 7 * px) + 'px';
      track.append(t);
    }
    if (!open.has(dow) || closed.has(from + i)) {
      const c = el('span', 'tl-closed'); c.style.left = (i * px) + 'px'; c.style.width = px + 'px';
      track.append(c);
    }
  }
  if (today >= from && today < from + days) {
    const n = el('span', 'tl-today'); n.style.left = ((today - from) * px) + 'px'; track.append(n);
  }
  s.append(track);
  return s;
}

function row(sys, p, from, to, px, today, cur) {
  const r = el('div', 'tl-row');
  r.dataset.pos = p.id; r.dataset.sys = sys.id;
  const lab = el('div', 'tl-label');
  lab.append(el('b', null, p.code), el('span', 'hint', ` ${Number(p.capacity || 0).toLocaleString()}`));
  lab.title = `${sys.name} · ${p.code} · ${Number(p.capacity || 0).toLocaleString()} places` + (p.area_m2 ? ` · ${p.area_m2} m²` : '');
  const track = el('div', 'tl-track');
  if (today >= from && today <= to) {
    const n = el('span', 'tl-today'); n.style.left = ((today - from) * px) + 'px'; track.append(n);
  }
  (data.batches || []).filter(b => b.position_id === p.id).forEach(b => track.append(barOf(b, sys, p, from, px, cur)));
  // click an empty day: plan something there
  track.addEventListener('click', e => {
    if (e.target !== track || !data.may_plan) return;
    const x = e.clientX - track.getBoundingClientRect().left;
    planHere(sys, p, ds(from + Math.floor(x / px)));
  });
  // a crop dragged from the palette
  if (data.may_plan) dropTarget(track, sys, p, from, px);
  r.append(lab, track);
  return r;
}

function barOf(b, sys, p, from, px, cur) {
  const f = dn(b.stay_from), t = dn(b.stay_to);
  const hs = b.harvest_start ? dn(b.harvest_start) : null, he = b.harvest_end ? dn(b.harvest_end) : null;
  const box = el('div', `tl-bar is-${b.status}` + (b.over ? ' is-over' : '') + (selected.has(b.id) ? ' is-sel' : '') + (b.movable ? ' movable' : '')
    + (b.customer ? ' has-order' : '') + (b.rotation_warn ? ' rot-warn' : ''));
  box.style.setProperty('--h', cropHue(b.category));
  box.style.left = ((f - from) * px) + 'px';
  box.style.width = Math.max((t - f + 1) * px, 3) + 'px';
  // the parts: growing, harvest, cleanup
  const seg = (a, z, cls) => {
    if (a == null || z == null || z < a) return;
    const s = el('span', 'tl-part ' + cls);
    s.style.left = ((Math.max(a, f) - f) * px) + 'px';
    s.style.width = ((Math.min(z, t) - Math.max(a, f) + 1) * px) + 'px';
    box.append(s);
  };
  if (hs != null && he != null) { seg(hs, he, 'harvest'); seg(he + 1, t, 'clean'); }
  // the nursery, off the row: a hatched strip before the bar (an external one is a delivery)
  if (b.sow_date && b.transplant_date && b.status !== 'harvested') {
    const sw = dn(b.sow_date), tp = dn(b.transplant_date);
    if (tp > sw) {
      const n = el('span', 'tl-nursery' + (b.nursery === 'external' ? ' ext' : ''));
      n.style.left = (-(tp - sw) * px) + 'px'; n.style.width = ((tp - sw) * px) + 'px';
      n.title = b.nursery === 'external' ? `Seedlings from the nursery · delivered before ${nice(b.transplant_date)}` : `In our nursery from ${nice(b.sow_date)}`;
      box.append(n);
    }
  }
  const lab = el('span', 'tl-bar-label');
  if ((t - f + 1) * px > 70) { const a = cropAvatar({ name: b.crop, category: b.category, photo_url: b.photo_url }, 'xs'); lab.append(a); }
  if (b.customer) lab.append(el('span', 'tl-flag', '◆'));          // for an order
  if (b.rotation_warn) lab.append(el('span', 'tl-flag warn', '↻'));  // follows its own family
  lab.append(el('span', null, b.crop));
  box.append(lab);
  box.title = [b.crop + ' · ' + ({ proposed: 'proposed', validated: 'validated', active: 'growing', harvested: 'harvested' }[b.status] || b.status),
    `${nice(b.transplant_date)} in · harvest ${nice(b.harvest_start)} – ${nice(b.harvest_end)} · free ${nice(ds(t + 1))}`,
    b.over ? 'Harvest ended — record the last cut to free the position' : null,
    b.customer ? `For ${b.customer} (an order)` : null,
    b.rotation_warn ? `Rotation: ${b.rotation_warn}` : null,
    b.revenue ? `${Math.round(b.yield || 0).toLocaleString()} kg · ${money(b.revenue, cur)}` : null,
    b.movable && data.may_plan ? 'Drag to move · drag the right edge to change the harvest · Shift-click to select' : null]
    .filter(Boolean).join('\n');

  if (data.may_plan && b.status !== 'harvested') {
    const handle = el('span', 'tl-handle');
    handle.title = 'Drag to lengthen or shorten the harvest';
    box.append(handle);
    resizable(handle, box, b, px);
  }
  pressable(box, b, sys, p, from, px);
  return box;
}

function legend() {
  const l = el('div', 'tl-legend');
  const item = (cls, text) => { const s = el('span'); s.append(el('i', cls), text); l.append(s); };
  item('lg-nursery', 'nursery'); item('lg-grow', 'growing'); item('lg-harvest', 'harvest'); item('lg-clean', 'cleanup');
  item('lg-proposed', 'proposed'); item('lg-over', 'harvest over, not closed'); item('lg-closed', 'closed day');
  item('lg-fc', 'kg forecast'); item('lg-fcp', 'kg forecast, proposed'); item('lg-real', 'kg harvested');
  return l;
}

// ── the palette: crops to drag ───────────────────────────────────────────────
let paletteQ = '';
function palette() {
  const box = el('div', 'tl-palette');
  const q = el('input', 'input'); q.type = 'search'; q.placeholder = 'Find a crop to drag'; q.value = paletteQ;
  const list = el('div', 'tl-crops');
  const fill = () => {
    list.textContent = '';
    (data.crops || []).filter(c => !paletteQ || (c.name + ' ' + c.category).toLowerCase().includes(paletteQ)).forEach(c => {
      const chip = el('div', 'tl-crop');
      chip.draggable = true;
      chip.append(cropAvatar(c, 'xs'), el('span', null, c.name));
      chip.title = `${c.name} · ${Math.round(c.nursery_days || 0)} d nursery, ${c.grow_days} d growing, ${c.harvest_days} d harvest` +
        ` · grows in ${(c.media || []).map(mediumLabel).join(', ')}\nDrag it onto a row`;
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', 'crop:' + c.id);
        e.dataTransfer.effectAllowed = 'copy';
        dragCrop = c;
        document.body.classList.add('tl-dragging');
        markRows(c);
      });
      chip.addEventListener('dragend', () => { dragCrop = null; document.body.classList.remove('tl-dragging'); unmarkRows(); clearGhost(); });
      list.append(chip);
    });
    if (!list.childNodes.length) list.append(el('span', 'hint', 'No crop matches.'));
  };
  q.oninput = () => { paletteQ = q.value.trim().toLowerCase(); fill(); };
  fill();
  box.append(q, list);
  return box;
}

let dragCrop = null, ghost = null;
function markRows(crop) {
  const sysOf = id => (data.systems || []).find(s => s.id === id);
  mount.querySelectorAll('.tl-row').forEach(r => r.classList.toggle('no-fit', !fits(crop, sysOf(r.dataset.sys))));
}
function unmarkRows() { mount.querySelectorAll('.tl-row.no-fit').forEach(r => r.classList.remove('no-fit')); }
function clearGhost() { ghost?.remove(); ghost = null; }
function showGhost(track, crop, tpDay, from, px, bad, text) {
  if (!ghost) ghost = el('div', 'tl-ghost');
  const c = cycleOf(crop, tpDay);
  ghost.className = 'tl-ghost' + (bad ? ' bad' : '');
  ghost.style.left = ((c.tp - from) * px) + 'px';
  ghost.style.width = ((c.to - c.tp + 1) * px) + 'px';
  ghost.textContent = text;
  if (ghost.parentNode !== track) track.append(ghost);
}
// what a drop there would say: nothing when it is fine, else the reason
// the batch before on the row, when it is the same crop or the same rotation group (not 'other')
function rotationNote(crop, pid, tpDay, except) {
  const before = (data.batches || []).filter(b => b.position_id === pid && b.id !== except && dn(b.stay_from) < tpDay)
    .sort((a, b) => dn(b.stay_from) - dn(a.stay_from))[0];
  if (!before) return null;
  const same = before.crop_id === crop.id
    || (crop.rotation_group && crop.rotation_group !== 'other' && crop.rotation_group === before.rotation_group);
  return same ? `follows ${before.crop} (${before.crop_id === crop.id ? 'same crop' : crop.rotation_group + ' family'})` : null;
}
function dropProblem(crop, sys, pid, tpDay, except) {
  if (!fits(crop, sys)) return `${crop.name} does not grow in ${sys.name}`;
  const c = cycleOf(crop, tpDay);
  const hit = clashOn(pid, c.tp, c.to, except);
  if (hit) return `overlaps ${hit.crop} (${nice(hit.stay_from)} – ${nice(hit.stay_to)})`;
  if (tpDay < dn(data.today)) return 'before today';
  return null;
}

function dropTarget(track, sys, p, from, px) {
  const dayAt = e => from + Math.floor((e.clientX - track.getBoundingClientRect().left) / px);
  track.addEventListener('dragover', e => {
    if (!dragCrop) return;
    e.preventDefault();
    const d = dayAt(e);
    const prob = dropProblem(dragCrop, sys, p.id, d, null);
    const c = cycleOf(dragCrop, d);
    e.dataTransfer.dropEffect = prob ? 'none' : 'copy';
    const rot = prob ? null : rotationNote(dragCrop, p.id, d, null);
    showGhost(track, dragCrop, d, from, px, !!prob,
      prob || `${dragCrop.name} · in ${nice(ds(c.tp))} · harvest ${nice(ds(c.hs))}` + (c.sow < dn(data.today) ? ' · sowing already past' : '')
             + (rot ? ' · ↻ ' + rot : ''));
  });
  track.addEventListener('dragleave', e => { if (!track.contains(e.relatedTarget)) clearGhost(); });
  track.addEventListener('drop', async e => {
    if (!dragCrop) return;
    e.preventDefault();
    const crop = dragCrop, d = dayAt(e);
    dragCrop = null; clearGhost(); unmarkRows(); document.body.classList.remove('tl-dragging');
    const prob = dropProblem(crop, sys, p.id, d, null);
    if (prob) { toast(prob, 'bad'); return; }
    try {
      const r = await rpc('plan_position', { p_position: p.id, p_crop: crop.id, p_transplant: ds(d) });
      toast(`${crop.name} proposed on ${p.code} · in ${nice(r.transplant_date)} · harvest from ${nice(r.harvest_start)}`, 'ok');
      await reload();
    } catch (err) { toast(err.message, 'bad'); }
  });
}

// ── a bar under the pointer: click, Shift-click, or drag to move ─────────────
function pressable(box, b, sys, p, from, px) {
  box.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.classList.contains('tl-handle')) return;
    const x0 = e.clientX, y0 = e.clientY;
    const grabDay = Math.floor((x0 - box.getBoundingClientRect().left) / px);   // where in the bar it was taken
    let moving = false, target = null, day = null;
    const crop = (data.crops || []).find(c => c.id === b.crop_id);
    const move = ev => {
      if (!moving) {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return;
        if (!(data.may_plan && b.movable && crop)) return;   // in the ground: a click only
        moving = true; box.classList.add('dragging'); document.body.classList.add('tl-dragging'); markRows(crop);
      }
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-row');
      if (!under) { clearGhost(); target = null; return; }
      const track = under.querySelector('.tl-track');
      const s = (data.systems || []).find(x => x.id === under.dataset.sys);
      day = from + Math.floor((ev.clientX - track.getBoundingClientRect().left) / px) - grabDay
            + (dn(b.transplant_date) - dn(b.stay_from));
      target = { pos: under.dataset.pos, sys: s, code: s.positions.find(q => q.id === under.dataset.pos)?.code };
      const prob = dropProblem(crop, s, target.pos, day, b.id);
      showGhost(track, crop, day, from, px, !!prob, prob || `${b.crop} → ${target.code} · in ${nice(ds(day))}`);
      target.prob = prob;
    };
    const up = async () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      box.classList.remove('dragging'); document.body.classList.remove('tl-dragging'); unmarkRows(); clearGhost();
      if (!moving) return;
      box.dataset.dragged = '1';
      if (!target) return;
      if (target.prob) { toast(target.prob, 'bad'); return; }
      if (target.pos === b.position_id && ds(day) === b.transplant_date) return;
      try {
        const r = await rpc('move_batch', { p_plan: b.id, p_position: target.pos, p_transplant: ds(day) });
        toast(`${b.crop} moved to ${target.code} · in ${nice(r.transplant_date)}` + (r.tasks ? ` · ${r.tasks} tasks re-dated` : '')
          + (r.late_sowing ? ' · its sowing is already past' : ''), r.late_sowing ? 'bad' : 'ok');
        await reload();
      } catch (err) { toast(err.message, 'bad'); }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
  box.addEventListener('click', e => {
    if (box.dataset.dragged) { delete box.dataset.dragged; return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (!data.may_plan || b.status === 'harvested' || b.status === 'active') return;
      selected.has(b.id) ? selected.delete(b.id) : selected.add(b.id);
      paint();
      return;
    }
    openBatch(b, sys, p);
  });
}

// the right edge: the last harvest day
function resizable(handle, box, b, px) {
  handle.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const x0 = e.clientX, w0 = box.offsetWidth;
    const clean = Number(b.cleanup_days || 0);
    const he0 = dn(b.harvest_end || b.stay_to);
    let dd = 0;
    const tip = el('span', 'tl-tip');
    box.append(tip);
    const move = ev => {
      dd = Math.round((ev.clientX - x0) / px);
      box.style.width = Math.max(w0 + dd * px, px * (clean + 1)) + 'px';
      const bad = clashOn(b.position_id, dn(b.stay_from), he0 + dd + clean, b.id);
      box.classList.toggle('bad', !!bad);
      tip.textContent = `harvest to ${nice(ds(he0 + dd))}` + (bad ? ` · runs into ${bad.crop}` : '');
    };
    const up = async () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      tip.remove();
      box.dataset.dragged = '1';
      if (!dd) { box.style.width = w0 + 'px'; return; }
      try {
        await rpc('resize_batch', { p_plan: b.id, p_harvest_end: ds(he0 + dd) });
        toast(`${b.crop}: harvest to ${nice(ds(he0 + dd))}`, 'ok');
        await reload();
      } catch (err) { toast(err.message, 'bad'); box.style.width = w0 + 'px'; box.classList.remove('bad'); }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

// ── one batch ────────────────────────────────────────────────────────────────
function openBatch(b, sys, p) {
  const cur = data.currency || 'ZAR';
  const d = drawer(b.crop, `${sys.name} · ${p.code} · ${Number(p.capacity || 0).toLocaleString()} places`);
  const facts = el('div', 'set-group');
  const row = (k, v) => { if (v == null || v === '') return; const r = el('div', 'set-row'); r.append(el('span', null, k), el('span', null, String(v))); facts.append(r); };
  row('State', { proposed: 'Proposed — not planted until validated', validated: 'Validated', active: 'Growing', harvested: 'Harvested' }[b.status] || b.status);
  row('Batch', b.batch_code);
  if (b.succession) {
    const series = (data.batches || []).filter(x => x.succession === b.succession);
    row('Succession', `planting ${b.round ?? '?'} · ${series.length} in this window`);
  }
  if (b.nursery) row('Seedlings', nurseryLine(b));
  row('Sowing', nice(b.sow_date));
  row('In the position', `${nice(b.stay_from)} → ${nice(b.stay_to)}`);
  row('Harvest', `${nice(b.harvest_start)} – ${nice(b.harvest_end)}`);
  if (b.harvested_kg) row('Harvested', b.harvested_kg + ' kg');
  if (b.yield) row('Expected', `${Math.round(b.yield).toLocaleString()} kg · ${money(b.revenue, cur)}` + (b.revenue_per_day ? ` · ${money(b.revenue_per_day, cur)}/day` : ''));
  if (b.customer) row('For', b.customer + ' (an order — Office › Orders)');
  if (b.rotation_warn) facts.append(el('div', 'note warn', 'Rotation: ' + b.rotation_warn + '. Nothing stops it; a different family is better for the position.'));
  if (b.over) facts.append(el('div', 'note warn', 'The harvest window has ended and no last cut is recorded, so the position is still held. Record the last cut on Grow › Harvest (or the harvest task) to free it.'));
  if (!b.movable && b.status === 'validated') facts.append(el('div', 'hint', b.ordered ? 'Its seedlings are ordered: the date stays.' : 'It is in the ground: only the harvest end can change.'));
  d.body.append(facts);

  if (data.may_plan && b.status !== 'harvested') {
    // another crop in the same slot
    if (b.movable) {
      const fitting = (data.crops || []).filter(c => fits(c, sys));
      const crop = selectBox(fitting.map(c => [c.id, c.name]), b.crop_id);
      const go = el('button', 'btn btn-sm', 'Change crop');
      go.onclick = async () => {
        if (crop.value === b.crop_id) return;
        busy(go, true, 'Changing…');
        try {
          const r = await rpc('change_batch_crop', { p_plan: b.id, p_crop: crop.value });
          d.close(); toast(`Now ${r.crop} · harvest ${nice(r.harvest_start)} – ${nice(r.harvest_end)}`, 'ok'); await reload();
        } catch (e) { busy(go, false, 'Change crop'); toast(e.message, 'bad'); }
      };
      const w = el('div', 'row'); w.append(crop, go);
      d.body.append(field('Crop', w, 'Same position and transplant day; its cycle decides the rest.'));
    }
    const endIn = el('input', 'input'); endIn.type = 'date'; endIn.value = b.harvest_end || '';
    const setEnd = el('button', 'btn btn-sm', 'Set');
    setEnd.onclick = async () => {
      if (!endIn.value || endIn.value === b.harvest_end) return;
      busy(setEnd, true, '…');
      try { await rpc('resize_batch', { p_plan: b.id, p_harvest_end: endIn.value }); d.close(); toast('Harvest end changed', 'ok'); await reload(); }
      catch (e) { busy(setEnd, false, 'Set'); toast(e.message, 'bad'); }
    };
    const w2 = el('div', 'row'); w2.append(endIn, setEnd);
    d.body.append(field('Last harvest day', w2, 'The harvest and cleanup tasks follow.'));
  }

  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close, el('div', 'spacer'));
  if (data.may_plan && b.succession) {
    const series = (data.batches || []).filter(x => x.succession === b.succession && x.status === 'proposed');
    if (series.length > 1) {
      const rs = el('button', 'btn', `Remove the series (${series.length})`);
      rs.title = 'Every proposed planting of this succession on screen';
      rs.onclick = async () => { d.close(); await discard(series.map(x => x.id)); };
      d.footer.append(rs);
    }
  }
  if (data.may_plan && b.status === 'proposed') {
    const rm = el('button', 'btn btn-danger', 'Remove');
    rm.onclick = async () => { try { await rpc('cancel_crop_plan', { p_ids: [b.id] }); d.close(); toast('Removed', 'ok'); await reload(); } catch (e) { toast(e.message, 'bad'); } };
    const ok = el('button', 'btn btn-primary', 'Validate');
    ok.onclick = async () => { d.close(); await validate(ok, [b.id]); };
    d.footer.append(rm, ok);
  } else if (data.may_plan && b.status === 'validated' && b.movable) {
    const rm = el('button', 'btn btn-danger', 'Cancel this batch');
    rm.onclick = async () => {
      if (!await confirmDrawer('Cancel it?', `${b.crop} on ${p.code}: its open tasks are removed. Nothing is planted yet.`, 'Cancel the batch', true)) return;
      try { await rpc('cancel_crop_plan', { p_ids: [b.id] }); d.close(); toast('Cancelled', 'ok'); await reload(); } catch (e) { toast(e.message, 'bad'); }
    };
    d.footer.append(rm);
  }
}

// click on an empty day: pick a crop that fits
function planHere(sys, p, day) {
  const fitting = (data.crops || []).filter(c => fits(c, sys) && !dropProblem(c, sys, p.id, dn(day), null));
  const d = drawer(`Plan ${p.code}`, `${sys.name} · transplant on ${nice(day)}`);
  if (!fitting.length) { d.body.append(el('div', 'note warn', 'No approved crop fits here on that day without running into the next batch.')); return; }
  const crop = selectBox(fitting.map(c => [c.id, c.name]));
  const info = el('div', 'hint');
  const say = () => { const c = fitting.find(x => x.id === crop.value); const y = cycleOf(c, dn(day));
    info.textContent = `Harvest ${nice(ds(y.hs))} – ${nice(ds(y.he))} · free again ${nice(ds(y.to + 1))}` + (y.sow < dn(data.today) ? ' · its sowing would already be past' : ''); };
  crop.onchange = say; say();
  d.body.append(field('Crop', crop), info);
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Propose it');
  go.onclick = async () => {
    busy(go, true, 'Planning…');
    try { await rpc('plan_position', { p_position: p.id, p_crop: crop.value, p_transplant: day }); d.close(); toast('Proposed', 'ok'); await reload(); }
    catch (e) { busy(go, false, 'Propose it'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, go);
}

// ── deciding ─────────────────────────────────────────────────────────────────
async function propose(button, scope, label) {
  const back = button.textContent;
  busy(button, true, 'Planning…');
  try {
    const r = await rpc('propose_crop_plan', { p_farm: farm.id, p_horizon_days: span(), p_system: scope ?? null });
    toast(r.proposed ? `${r.proposed} positions proposed in ${r.scope}`
          : r.nothing_fits ? `${r.nothing_fits} free, but no approved crop fits ${r.scope}`
          : `Nothing to plan — ${r.scope} is full for the window`, r.proposed ? 'ok' : r.nothing_fits ? 'bad' : '');
    await reload();
  } catch (e) { busy(button, false, back); toast(e.message, 'bad'); }
}
async function validate(button, ids) {
  busy(button, true, 'Validating…');
  try {
    const r = await rpc('validate_crop_plan', { p_ids: ids });
    selected.clear();
    const c = r.conflicts || [];
    toast(`${r.validated} batch${r.validated === 1 ? '' : 'es'} validated · ${r.tasks_created} tasks` +
      (c.length ? ` · ${c.length} skipped: ${c.map(x => `${x.batch} overlaps ${x.overlaps}`).join(', ')}` : ''), c.length ? 'bad' : 'ok');
    await reload();
  } catch (e) { busy(button, false, 'Validate'); toast(e.message, 'bad'); }
}
async function discard(ids) {
  if (!await confirmDrawer('Remove them?', `${ids.length} batch${ids.length === 1 ? '' : 'es'} will be removed. A validated one loses its open tasks; nothing growing is touched.`, 'Remove', true)) return;
  try { await rpc('cancel_crop_plan', { p_ids: ids }); selected.clear(); toast('Removed', 'ok'); await reload(); }
  catch (e) { toast(e.message, 'bad'); }
}

// ── the weeks: kg forecast and harvested, plants to sow or receive (0.7.114, 0.7.118) ──
// Forecast = a batch's expected kg spread over its harvest days (proposals apart,
// lighter); harvested = the cuts recorded, by the day they were weighed. Both per
// zone and for the whole farm. Plants = the position's places in the week the batch
// is sown in our nursery, or the week it arrives from an external one.
function weeksOf(from, days) {
  const sysOf = new Map();
  (data.systems || []).forEach(sy => (sy.positions || []).forEach(p => sysOf.set(p.id, sy.id)));
  const cap = new Map();
  (data.systems || []).forEach(sy => (sy.positions || []).forEach(p => cap.set(p.id, Number(p.capacity || 0))));
  const mon0 = from - (((new Date(from * DAY).getUTCDay() || 7) - 1));
  const end = from + days;
  const weeks = new Map();        // monday → { all: cell, bySys: Map(sys → cell) }
  const blank = () => ({ fc: 0, fcP: 0, real: 0, sow: 0, sowP: 0, ext: 0, crops: new Map() });
  const cellOf = (d, sys) => {
    const m = d - (((new Date(d * DAY).getUTCDay() || 7) - 1));
    if (!weeks.has(m)) weeks.set(m, { all: blank(), bySys: new Map() });
    const w = weeks.get(m);
    if (sys && !w.bySys.has(sys)) w.bySys.set(sys, blank());
    return [w.all, sys ? w.bySys.get(sys) : null];
  };
  for (let m = mon0; m < end; m += 7) cellOf(m, null);
  const both = (d, sys, f) => cellOf(d, sys).forEach(c => c && f(c));
  (data.batches || []).forEach(b => {
    const sys = sysOf.get(b.position_id), prop = b.status === 'proposed';
    if (b.harvest_start && b.harvest_end) {
      const hs = dn(b.harvest_start), he = dn(b.harvest_end), n = Math.max(he - hs + 1, 1), k = Number(b.yield || 0) / n;
      for (let d = Math.max(hs, mon0); d <= Math.min(he, end - 1); d++)
        both(d, sys, c => { prop ? (c.fcP += k) : (c.fc += k); c.crops.set(b.crop, (c.crops.get(b.crop) || 0) + k); });
    }
    if (b.status === 'harvested') return;
    const plants = cap.get(b.position_id) || 0;
    if (b.nursery === 'external' && b.transplant_date) {
      const d = dn(b.transplant_date) - 1;
      if (d >= mon0 && d < end) both(d, sys, c => { c.ext += plants; });
    } else if (b.sow_date && b.transplant_date && dn(b.sow_date) < dn(b.transplant_date)) {
      const d = dn(b.sow_date);
      if (d >= mon0 && d < end) both(d, sys, c => { prop ? (c.sowP += plants) : (c.sow += plants); });
    }
  });
  (data.harvests || []).forEach(h => {
    const d = dn(h.date);
    if (d >= mon0 && d < end) both(d, h.system_id, c => { c.real += Number(h.kg || 0); });
  });
  return [...weeks.entries()].sort((a, b) => a[0] - b[0]);
}
const fmtN = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));

// a kg line: forecast (left) and harvested (right) side by side in each week
function kgRow(label, weeks, sysId, from, px, total) {
  const cells = weeks.map(([m, w]) => [m, sysId ? (w.bySys.get(sysId) || { fc: 0, fcP: 0, real: 0, crops: new Map() }) : w.all]);
  const max = Math.max(1, ...cells.map(([, c]) => Math.max(c.fc + c.fcP, c.real)));
  const r = el('div', 'tl-row tl-sum tl-kg' + (total ? ' total' : ''));
  const l = el('div', 'tl-label');
  const sumF = cells.reduce((a, [, c]) => a + c.fc + c.fcP, 0), sumR = cells.reduce((a, [, c]) => a + c.real, 0);
  l.append(el('b', null, label), el('span', 'hint', ` ${fmtN(sumF)} · ${fmtN(sumR)}`));
  l.title = `${label}: ${Math.round(sumF).toLocaleString()} kg forecast, ${Math.round(sumR).toLocaleString()} kg harvested in the window`;
  const t = el('div', 'tl-track');
  const H = total ? 26 : 20;
  cells.forEach(([m, c]) => {
    const x = (m - from) * px, width = 7 * px - 2, half = Math.max((width - 2) / 2, 1);
    const col = el('div', 'tl-wk'); col.style.left = x + 'px'; col.style.width = width + 'px';
    const bar = (v, cls, left, bottom = 0) => { if (!v) return 0; const p = el('span', 'tl-wk-part ' + cls); const h = H * v / max;
      p.style.height = h + 'px'; p.style.bottom = bottom + 'px'; p.style.left = left + 'px'; p.style.width = half + 'px'; col.append(p); return h; };
    const h1 = bar(c.fc, 'fc', 0); bar(c.fcP, 'fc-p', 0, h1);
    bar(c.real, 'real', half + 2);
    if (width >= 34 && (c.fc + c.fcP || c.real)) col.append(el('span', 'tl-wk-n', `${fmtN(c.fc + c.fcP)}${c.real ? ' | ' + fmtN(c.real) : ''}`));
    col.title = `Week of ${nice(ds(m))}` + (sysId ? '' : ' · all zones') +
      `\nforecast ${Math.round(c.fc + c.fcP).toLocaleString()} kg` + (c.fcP ? ` (${Math.round(c.fcP).toLocaleString()} only proposed)` : '') +
      `\nharvested ${Math.round(c.real).toLocaleString()} kg` +
      [...c.crops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `\n  ${k}: ${Math.round(v)} kg`).join('');
    t.append(col);
  });
  r.append(l, t);
  return r;
}

function plantsRow(weeks, from, px) {
  const max = Math.max(1, ...weeks.map(([, w]) => w.all.sow + w.all.sowP + w.all.ext));
  const r = el('div', 'tl-row tl-sum');
  const l = el('div', 'tl-label'); l.append(el('b', null, 'plants / week'));
  l.title = 'Plants to sow in our nursery (green) or to receive from a nursery (blue), per week';
  const t = el('div', 'tl-track');
  weeks.forEach(([m, w]) => {
    const c = w.all, x = (m - from) * px, width = 7 * px - 2;
    const col = el('div', 'tl-wk'); col.style.left = x + 'px'; col.style.width = width + 'px';
    let bottom = 0;
    [[c.sow, 'sow'], [c.sowP, 'sow-p'], [c.ext, 'ext']].forEach(([v, cls]) => { if (!v) return; const p = el('span', 'tl-wk-part ' + cls);
      const h = 20 * v / max; p.style.height = h + 'px'; p.style.bottom = bottom + 'px'; bottom += h; col.append(p); });
    const sT = c.sow + c.sowP + c.ext;
    if (sT && width >= 26) col.append(el('span', 'tl-wk-n', fmtN(sT)));
    col.title = `Week of ${nice(ds(m))}: ${sT.toLocaleString()} plants` + (c.sow ? `\nto sow: ${c.sow.toLocaleString()}` : '') +
      (c.sowP ? `\nto sow if proposals are validated: ${c.sowP.toLocaleString()}` : '') + (c.ext ? `\nto receive from a nursery: ${c.ext.toLocaleString()}` : '');
    t.append(col);
  });
  r.append(l, t);
  return r;
}

// ── succession: the same crop again and again ────────────────────────────────
function succession() {
  const crops = data.crops || [];
  const d = drawer('Plant in succession', 'The same crop at a steady rhythm, for a harvest every week rather than all at once');
  const crop = selectBox(crops.map(c => [c.id, c.name]));
  const zone = selectBox([]);
  const first = input({ type: 'date' });
  const every = input({ type: 'number', min: 1, value: 1 });
  const unit = selectBox([['7', 'week(s)'], ['1', 'day(s)']], '7');
  const times = input({ type: 'number', min: 1, max: 52, value: 8 });
  const each = input({ type: 'number', min: 1, value: 1 });
  const info = el('div', 'hint');
  const cropOf = () => crops.find(c => c.id === crop.value);
  const fillZones = () => {
    const c = cropOf();
    zone.textContent = '';
    const any = el('option', null, 'Any zone it grows in'); any.value = ''; zone.append(any);
    (data.systems || []).filter(sy => fits(c, sy)).forEach(sy => { const o = el('option', null, `${sy.name} · ${systemLabel(sy.type)}`); o.value = sy.code; zone.append(o); });
    first.value = ds(dn(data.today) + (c.lead || 0));
    say();
  };
  const say = () => {
    const c = cropOf(); if (!c || !first.value) return;
    const step = Number(every.value || 1) * Number(unit.value), n = Number(times.value || 1), k = Number(each.value || 1);
    const a = cycleOf(c, dn(first.value)), z = cycleOf(c, dn(first.value) + step * (n - 1));
    const zones = (data.systems || []).filter(sy => fits(c, sy) && (!zone.value || sy.code === zone.value));
    const room = zones.reduce((t, sy) => t + (sy.positions || []).length, 0);
    info.textContent = `${n} plantings × ${k} position${k > 1 ? 's' : ''} = ${n * k} batches · harvest from ${nice(ds(a.hs))} to ${nice(ds(z.he))}` +
      ` · each stays ${a.to - a.tp + 1} days, so about ${Math.ceil((a.to - a.tp + 1) / step) * k} positions are busy at once (${room} in ${zone.value ? 'this zone' : 'the zones it grows in'})` +
      (a.sow < dn(data.today) ? ' · the first sowing would already be past' : '');
  };
  crop.onchange = fillZones; [zone, every, unit, times, each].forEach(x => x.onchange = say); first.onchange = say;
  [every, times, each].forEach(x => x.oninput = say);
  const ev = el('div', 'row'); ev.append(every, unit);
  d.body.append(field('Crop', crop), field('Zone', zone), field('First transplant', first),
    field('Every', ev), field('How many plantings', times), field('Positions each time', each), info,
    el('div', 'hint', 'Only free slots are used — each planting takes positions that are free for its whole stay. Everything lands as a proposal to validate.'));
  fillZones();
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Propose the series');
  go.onclick = async () => {
    busy(go, true, 'Planning…');
    try {
      const r = await rpc('plan_succession', { p_farm: farm.id, p_crop: crop.value, p_first: first.value,
        p_every_days: Number(every.value) * Number(unit.value), p_times: Number(times.value), p_positions_each: Number(each.value),
        p_system: zone.value || null });
      d.close();
      const short = r.short || [];
      toast(`${r.crop}: ${r.placed} of ${r.wanted} batches proposed · ${Math.round(r.expected_kg).toLocaleString()} kg · harvest ${nice(r.harvest_from)} – ${nice(r.harvest_to)}` +
        (short.length ? ` · ${short.length} planting${short.length > 1 ? 's' : ''} short: ${short.slice(0, 3).map(x => `${nice(x.transplant)} ${x.reason}`).join('; ')}` : ''),
        short.length ? 'bad' : 'ok');
      await reload();
    } catch (e) { busy(go, false, 'Propose the series'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, go);
}

// ── how many growing positions a zone has (0.7.116; 0.7.117: along what was built) ──
// A position is a whole number of the rows or tables built in the zone (base_units),
// so the menu offers the divisors of that number only — Zone 2's 10 rows give
// 10, 5, 2 and 1 — each with the places it makes.
function divisors(n) {
  const out = [];
  for (let k = 1; k <= n; k++) if (n % k === 0) out.push(k);
  return out;
}
function splitMenu(sys) {
  const total = Math.round((sys.positions || []).reduce((a, p) => a + Number(p.capacity || 0), 0));
  const cur = (sys.positions || []).length;
  const base = Number(sys.base_units) || cur;
  const wrap = el('label', 'tl-split');
  const sel = el('select', 'input');
  const opts = divisors(base).filter(n => total % n === 0);
  if (!opts.includes(cur)) opts.push(cur);
  opts.sort((a, b) => b - a).forEach(n => {
    const each = base % n === 0 ? base / n : null;
    const o = el('option', null, `${n} × ${(total / n).toLocaleString()}` + (each && each > 1 ? ` · ${each} rows each` : ''));
    o.value = String(n); sel.append(o);
  });
  sel.value = String(cur);
  sel.title = `Growing positions in ${sys.name}: ${base} rows or tables built, ${total.toLocaleString()} places — a position is a whole number of rows`;
  sel.onchange = async () => {
    const n = Number(sel.value);
    if (n === cur) return;
    const ok = await confirmDrawer(`${n} positions in ${sys.name}?`,
      `${n} positions of ${(total / n).toLocaleString()} places each, instead of ${cur}. The positions already there keep their history and ` +
      `are named again A, B, C…; the zone's proposals are removed. It is refused while a crop is validated or growing in the zone.`, 'Split it');
    if (!ok) { sel.value = String(cur); return; }
    try {
      const r = await rpc('split_zone', { p_system: sys.id, p_n: n });
      toast(`${r.zone}: ${r.positions} positions of ${Math.round(Number(r.places_each)).toLocaleString()} places`, 'ok');
      await reload();
    } catch (e) { sel.value = String(cur); toast(e.message, 'bad'); }
  };
  wrap.append(el('span', 'hint', 'Positions'), sel);
  return wrap;
}
