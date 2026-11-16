// zone blocks, the time scale, position rows, batch bars and the legend
import { el, systemLabel, mediumLabel, cropHue, money, cropAvatar } from '../ui.js';
import { groupColour, steadyChip, groupName, pickZone } from './steady.js';
import { splitMenu } from './succession.js';
import { kgRow, plantsRow } from './weeks.js';
import { clearButton } from './clear.js';
import { propose, planHere } from './batch.js';
import { dn, DAY, ds, nice, S } from './state.js';
import { dropTarget, pressable, resizable } from './drag.js';

// one zone: its header (name, positions, buttons), its kg and plants lines, its positions;
// group = the steady group it belongs to (null: none)
export function zoneBlock(inner, sys, W, from, to, px, today, cur, group) {
  const may = S.data.may_plan, steady = !!group;
  const zh = el('div', 'tl-zone' + (steady ? ' steady' : '') + (S.steadyMode && S.steadyPick.has(sys.id) ? ' picked' : ''));
  zh.dataset.sys = sys.id;
  if (group) zh.style.setProperty('--g', groupColour(group));
  const lab = el('div', 'tl-label tl-zone-label');
  // a zone is in one group at a time: while choosing another group's zones it cannot be ticked
  const elsewhere = S.steadyMode && group && group.id !== S.steadyEdit;
  if (elsewhere) {
    const cb = el('input'); cb.type = 'checkbox'; cb.disabled = true;
    cb.setAttribute('aria-label', `${sys.name} is in ${groupName(group)}`);
    lab.append(cb);
    lab.title = `${sys.name} is in ${groupName(group)} — take it out there first (✕ on its chip)`;
  } else if (S.steadyMode) {
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = S.steadyPick.has(sys.id);
    cb.setAttribute('aria-label', `Keep ${sys.name} steady`);
    cb.onchange = () => pickZone(sys.id, cb.checked, zh);
    lab.append(cb);
    lab.classList.add('pickable');
    lab.onclick = e => { if (e.target !== cb) { cb.checked = !cb.checked; pickZone(sys.id, cb.checked, zh); } };
  }
  lab.append(el('b', null, sys.name), el('span', 'hint', ' ' + systemLabel(sys.type)));
  if (!elsewhere) lab.title = 'Growing medium: ' + (sys.media || []).map(mediumLabel).join(', ') +
    ((sys.categories || []).length ? ' · kept for ' + sys.categories.join(', ').replace(/_/g, ' ') : '');
  zh.append(lab);
  const zt = el('div', 'tl-zone-track');
  if (steady) zt.append(steadyChip(sys, group));
  if (may) zt.append(splitMenu(sys));
  if (may) {
    const pb = el('button', 'btn btn-sm btn-ghost', 'Plan this bay');
    pb.title = 'Fill the free positions of this bay only';
    pb.onclick = () => propose(pb, sys.code, sys.name);
    zt.append(pb, clearButton(sys));
  }
  zh.append(zt);
  inner.append(zh);
  const lines = [kgRow('kg / week', W, sys.id, from, px, false), plantsRow('plants / week', W, sys.id, from, px, false),
                 ...(sys.positions || []).map(p => row(sys, p, from, to, px, today, cur))];
  if (steady) lines.forEach(r => { r.classList.add('steady'); r.style.setProperty('--g', groupColour(group)); });
  inner.append(...lines);
}

export function scale(from, days, px, today) {
  const s = el('div', 'tl-scale');
  s.append(el('div', 'tl-label tl-scale-label', 'Position'));
  const track = el('div', 'tl-track tl-scale-track');
  const closed = new Set((S.data.holidays || []).map(dn));
  const open = new Set(S.data.operating_days || [1, 2, 3, 4, 5]);
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
  (S.data.batches || []).filter(b => b.position_id === p.id).forEach(b => track.append(barOf(b, sys, p, from, px, cur)));
  // click an empty day: plan something there
  track.addEventListener('click', e => {
    if (e.target !== track || !S.data.may_plan) return;
    const x = e.clientX - track.getBoundingClientRect().left;
    planHere(sys, p, ds(from + Math.floor(x / px)));
  });
  // a crop dragged from the palette
  if (S.data.may_plan) dropTarget(track, sys, p, from, px);
  r.append(lab, track);
  return r;
}

function barOf(b, sys, p, from, px, cur) {
  const f = dn(b.stay_from), t = dn(b.stay_to);
  const hs = b.harvest_start ? dn(b.harvest_start) : null, he = b.harvest_end ? dn(b.harvest_end) : null;
  const box = el('div', `tl-bar is-${b.status}` + (b.over ? ' is-over' : '') + (S.selected.has(b.id) ? ' is-sel' : '') + (b.movable ? ' movable' : '')
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
    b.movable && S.data.may_plan ? 'Drag to move · drag the right edge to change the harvest · Shift-click to select' : null]
    .filter(Boolean).join('\n');

  if (S.data.may_plan && b.status !== 'harvested') {
    const handle = el('span', 'tl-handle');
    handle.title = 'Drag to lengthen or shorten the harvest';
    box.append(handle);
    resizable(handle, box, b, px);
  }
  pressable(box, b, sys, p, from, px);
  return box;
}

export function legend() {
  const l = el('div', 'tl-legend');
  const item = (cls, text) => { const s = el('span'); s.append(el('i', cls), text); l.append(s); };
  item('lg-nursery', 'nursery'); item('lg-grow', 'growing'); item('lg-harvest', 'harvest'); item('lg-clean', 'cleanup');
  item('lg-proposed', 'proposed'); item('lg-over', 'harvest over, not closed'); item('lg-closed', 'closed day');
  item('lg-fc', 'kg forecast'); item('lg-fcp', 'kg forecast, proposed'); item('lg-real', 'kg harvested');
  return l;
}
