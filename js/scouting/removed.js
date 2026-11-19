// Scouting page: removing a picture and the removed-pictures window
import { rpc } from './zapi.js';
import { el, num, toast, busy, drawer, confirmDrawer, shortDay, farmWhen, emptyState } from '../ui.js';
import { reload } from './index.js';
import { S, dayData } from './state.js';

// ── a photo taken off the reports (0190): the ✕ in its corner ──
export function removeX(p) {
  const x = el('span', 'pd-x', '✕');
  x.setAttribute('role', 'button'); x.tabIndex = 0;
  x.title = 'Remove this photo from the reports';
  x.setAttribute('aria-label', 'Remove this photo');
  const go = async e => {
    e.preventDefault(); e.stopPropagation();
    const trap = p.kind === 'trap';
    const ok = await confirmDrawer('Remove this photo?',
      (trap ? `Trap ${p.code}: its count of ${num(p.total, 0)} leaves the insect curve with it, and the photo after it is counted against the one before. `
            : (p.measures || []).length ? 'Its sizes leave the growth curve with it. ' : '')
      + 'The photo is kept for 30 days under Removed photos…, where a manager can put it back.', 'Remove', true);
    if (!ok) return;
    try {
      await rpc('remove_photo', { p_kind: trap ? 'trap' : 'observation', p_id: p.id, p_reason: null });
      toast('Photo removed — Removed photos… puts it back', 'ok');
      // the page stays as it is (0.7.204, owner 2 Oct 2026: "when we delete a pic the page has to stay open, the refresh
      // after deleting is too confusing"): only the photo leaves — its card, the day's kept answer, the counts on its zone
      const card = x.closest('.pd-trap, .sc-fig'), band = x.closest('.pd-zone-band');
      dayData.forEach(day => [...(day.units || []), ...(day.zones || [])].forEach(z => {
        z.photos = (z.photos || []).filter(q => q.id !== p.id);
        z.traps = (z.traps || []).filter(q => q.id !== p.id);
      }));
      card?.remove();
      if (band) {
        const figs = band.querySelectorAll('.sc-fig').length, traps = band.liveTraps ? band.liveTraps() : 0;
        band.querySelectorAll(':scope > summary .pill').forEach(pill => {
          if (/^\d+ photos?$/.test(pill.textContent)) pill.textContent = `${figs} photo${figs === 1 ? '' : 's'}`;
          else if (/^\d+ traps?$/.test(pill.textContent)) pill.textContent = traps ? `${traps} trap${traps === 1 ? '' : 's'}` : 'traps —';
        });
        const hint = band.querySelector('.pd-photos-head .hint'), n = band.querySelectorAll('.pd-hphotos .sc-fig').length;
        if (hint) hint.textContent = n ? `${n} photo${n === 1 ? '' : 's'}` : 'no photo that day';
      }
    } catch (err) { toast(String(err.message || err).replace(/^\d+ /, ''), 'bad'); }
  };
  x.onclick = go;
  x.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') go(e); };
  return x;
}

export async function openRemoved() {
  const d = drawer('Removed photos', 'Taken off the reports in the last 30 days');
  const paintList = async () => {
    d.body.textContent = ''; d.body.append(el('div', 'hint', 'Reading…'));
    let r;
    try { r = await rpc('removed_photos', { p_farm: S.farm.id }); }
    catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
    d.body.textContent = '';
    if (!(r.rows || []).length) { d.body.append(emptyState('No photo was removed in the last 30 days.')); return; }
    if (!r.may_restore) d.body.append(el('div', 'hint', 'A manager can put a photo back.'));
    const list = el('div', 'pd-removed');
    r.rows.forEach(x => {
      const row = el('div', 'pd-removed-row');
      const im = el('img'); im.src = x.photo_data || ''; im.alt = ''; im.loading = 'lazy';
      const txt = el('div');
      txt.append(el('b', null, x.label || (x.kind === 'trap' ? 'Trap photo' : 'Plant photo')),
        el('div', 'hint', [x.zone, x.day ? shortDay(x.day) : null].filter(Boolean).join(' · ')),
        el('div', 'hint', `Removed ${farmWhen(x.removed_at)}${x.by ? ' by ' + x.by : ''}${x.reason ? ' — ' + x.reason : ''}`));
      row.append(im, txt);
      if (r.may_restore) {
        const b = el('button', 'btn btn-sm', 'Put back');
        b.onclick = async () => {
          busy(b, true, 'Putting back…');
          try { await rpc('restore_photo', { p_id: x.id }); toast('Photo back in its report', 'ok'); await paintList(); reload(); }
          catch (e) { busy(b, false, 'Put back'); toast(String(e.message || e).replace(/^\d+ /, ''), 'bad'); }
        };
        row.append(b);
      }
      list.append(row);
    });
    d.body.append(list);
  };
  paintList();
}
