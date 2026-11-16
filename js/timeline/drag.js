// the crop palette, drag and drop onto positions, press and resize of bars
import { el, cropAvatar, mediumLabel, toast } from '../ui.js';
import { rpc } from '../api.js';
import { fits, cycleOf, clashOn, reload, paint } from './index.js';
import { dn, nice, ds, S } from './state.js';
import { openBatch } from './batch.js';

// ── the palette: crops to drag ───────────────────────────────────────────────
let paletteQ = '';
export function palette() {
  const box = el('div', 'tl-palette');
  const q = el('input', 'input'); q.type = 'search'; q.placeholder = 'Find a crop to drag'; q.value = paletteQ;
  const list = el('div', 'tl-crops');
  const fill = () => {
    list.textContent = '';
    (S.data.crops || []).filter(c => !paletteQ || (c.name + ' ' + c.category).toLowerCase().includes(paletteQ)).forEach(c => {
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
  const sysOf = id => (S.data.systems || []).find(s => s.id === id);
  // only the position rows: the kg and plants lines carry no zone, and fits(crop, undefined) threw
  S.mount.querySelectorAll('.tl-row[data-pos]').forEach(r => r.classList.toggle('no-fit', !fits(crop, sysOf(r.dataset.sys) || {})));
}
function unmarkRows() { S.mount.querySelectorAll('.tl-row.no-fit').forEach(r => r.classList.remove('no-fit')); }
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
  const before = (S.data.batches || []).filter(b => b.position_id === pid && b.id !== except && dn(b.stay_from) < tpDay)
    .sort((a, b) => dn(b.stay_from) - dn(a.stay_from))[0];
  if (!before) return null;
  const same = before.crop_id === crop.id
    || (crop.rotation_group && crop.rotation_group !== 'other' && crop.rotation_group === before.rotation_group);
  return same ? `follows ${before.crop} (${before.crop_id === crop.id ? 'same crop' : crop.rotation_group + ' family'})` : null;
}
export function dropProblem(crop, sys, pid, tpDay, except) {
  if (!fits(crop, sys)) return `${crop.name} does not grow in ${sys.name}`;
  const c = cycleOf(crop, tpDay);
  const hit = clashOn(pid, c.tp, c.to, except);
  if (hit) return `overlaps ${hit.crop} (${nice(hit.stay_from)} – ${nice(hit.stay_to)})`;
  if (tpDay < dn(S.data.today)) return 'before today';
  return null;
}

export function dropTarget(track, sys, p, from, px) {
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
      prob || `${dragCrop.name} · in ${nice(ds(c.tp))} · harvest ${nice(ds(c.hs))}` + (c.sow < dn(S.data.today) ? ' · too soon for its seedlings' : '')
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

// The click that ends a drag is not a click (review 13 Oct 2026). The browser sends it to whatever holds both the
// place pressed and the place let go: a bar moved along its own row, or its edge pulled past the bar, ended with a
// click on the row and "plan a batch here" opened over the move. The bar used to keep a flag for it instead; let go
// anywhere but on the bar, the flag stayed up and swallowed the next real click on that bar. That click is sent in
// the same turn as the pointerup, so the eater is taken off on the next tick whether a click came or not.
function eatClick() {
  const eat = e => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener('click', eat, true);
  setTimeout(() => document.removeEventListener('click', eat, true), 0);
}

// ── a bar under the pointer: click, Shift-click, or drag to move ─────────────
export function pressable(box, b, sys, p, from, px) {
  box.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.classList.contains('tl-handle')) return;
    const x0 = e.clientX, y0 = e.clientY;
    const grabDay = Math.floor((x0 - box.getBoundingClientRect().left) / px);   // where in the bar it was taken
    let moving = false, target = null, day = null;
    const crop = (S.data.crops || []).find(c => c.id === b.crop_id);
    const move = ev => {
      if (!moving) {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return;
        if (!(S.data.may_plan && b.movable && crop)) return;   // in the ground: a click only
        moving = true; box.classList.add('dragging'); document.body.classList.add('tl-dragging'); markRows(crop);
      }
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-row[data-pos]');
      if (!under) { clearGhost(); target = null; return; }
      const track = under.querySelector('.tl-track');
      const s = (S.data.systems || []).find(x => x.id === under.dataset.sys);
      day = from + Math.floor((ev.clientX - track.getBoundingClientRect().left) / px) - grabDay
            + (dn(b.transplant_date) - dn(b.stay_from));
      target = { pos: under.dataset.pos, sys: s, code: s.positions.find(q => q.id === under.dataset.pos)?.code };
      const prob = dropProblem(crop, s, target.pos, day, b.id);
      showGhost(track, crop, day, from, px, !!prob, prob || `${b.crop} → ${target.code} · in ${nice(ds(day))}`);
      target.prob = prob;
    };
    // the browser took the gesture (touch scroll, a pen lifted off): nothing is written, nothing stays on the page
    const cancel = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      box.classList.remove('dragging'); document.body.classList.remove('tl-dragging'); unmarkRows(); clearGhost();
    };
    const up = async () => {
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      box.classList.remove('dragging'); document.body.classList.remove('tl-dragging'); unmarkRows(); clearGhost();
      if (!moving) return;
      eatClick();
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
    document.addEventListener('pointercancel', cancel);
  });
  box.addEventListener('click', e => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (!S.data.may_plan || b.status === 'harvested' || b.status === 'active') return;
      S.selected.has(b.id) ? S.selected.delete(b.id) : S.selected.add(b.id);
      paint();
      return;
    }
    openBatch(b, sys, p);
  });
}

// the right edge: the last harvest day
export function resizable(handle, box, b, px) {
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
    const cancel = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      tip.remove(); box.style.width = w0 + 'px'; box.classList.remove('bad');
    };
    const up = async () => {
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      tip.remove();
      eatClick();
      if (!dd) { box.style.width = w0 + 'px'; return; }
      try {
        await rpc('resize_batch', { p_plan: b.id, p_harvest_end: ds(he0 + dd) });
        toast(`${b.crop}: harvest to ${nice(ds(he0 + dd))}`, 'ok');
        await reload();
      } catch (err) { toast(err.message, 'bad'); box.style.width = w0 + 'px'; box.classList.remove('bad'); }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  });
}
