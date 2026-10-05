// ═════════════════════════════════════════════════════════════════════════
// Unfiled photos (console 0.7.223, migration 0217, owner 5 Oct 2026: "where do I
// check the not assigned pictures? could a space for manual recovery be built?")
//
// A development-phase tool, kept in its own module so it can be taken out again.
// A scouting photo is uploaded the moment it is taken; its record only comes
// with the report. A phone closed, a task cancelled or a report refused leaves
// the file in storage with nothing pointing to it. This window lists those
// files (and plant photos that have a record but no zone); a manager or the
// agronomist files one into a zone, a section and a day — it then sits in that
// day's report — or discards it (the file itself stays in storage).
// Trap photos are only looked at and discarded: a reading needs a count.
// ═════════════════════════════════════════════════════════════════════════
import { rpc, api, URL_BASE } from './api.js';
import { el, toast, busy, drawer } from './ui.js';

const parse = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const shortDay = s => parse(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';
const errText = e => String(e?.message || e).replace(/^\d+ /, '');
const STATUS = { done: 'done', skipped: 'cancelled', cancelled: 'cancelled', in_progress: 'in progress', assigned: 'open', planned: 'open', generated: 'open' };

// the day of an instant in the farm's zone, as yyyy-mm-dd (for the date field)
function dayIn(ts, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts)); }
  catch { return String(ts).slice(0, 10); }
}

// one request signs every file of the list for an hour
async function signAll(paths, farmId) {
  const out = new Map();
  if (!paths.length) return out;
  try {
    const res = await api('/storage/v1/object/sign/evidence', { method: 'POST', body: JSON.stringify({ expiresIn: 3600, paths }) });
    (res || []).forEach(x => { if (x?.signedURL && x.path) out.set(x.path, URL_BASE + '/storage/v1' + x.signedURL); });
  } catch { /* the rows say "no preview" */ }
  return out;
}

// the 640 px copy the reports show, made here from the full photo
async function smallCopy(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return cv.toDataURL('image/jpeg', 0.8);
}

const select = (options, value) => {
  const s = el('select');
  options.forEach(([v, label]) => { const o = el('option', null, label); o.value = v; s.append(o); });
  if (value != null && options.some(([v]) => v === value)) s.value = value;
  return s;
};

// the button for the page's head: it counts by itself, and opens the window
export function unfiledButton(farm, onChange) {
  const b = el('button', 'btn', 'Unfiled photos…');
  b.title = 'Scouting photos that reached storage without a report (a phone closed, a task cancelled) and plant photos without a zone: file them by hand or discard them';
  const count = n => { b.textContent = n > 0 ? `Unfiled photos (${n})…` : 'Unfiled photos…'; b.classList.toggle('btn-accent', n > 0); };
  const recount = () => rpc('unfiled_photos', { p_farm: farm.id }).then(r => { if (b.isConnected) count(Number(r?.count) || 0); }).catch(() => { b.hidden = true; });
  setTimeout(recount, 1500);                 // beside the page, never in its way; a database before 0217 has no button
  b.onclick = () => openUnfiled(farm, () => { recount(); onChange?.(); });
  return b;
}

function openUnfiled(farm, onChange) {
  const d = drawer('Unfiled photos', 'Scouting photos of the last 14 days that are in no report');
  d.box.classList.add('uf-drawer');
  let showDiscarded = false;
  const done = () => onChange?.();

  const paintList = async () => {
    d.body.textContent = ''; d.body.append(el('div', 'hint', 'Reading…'));
    let r;
    try { r = await rpc('unfiled_photos', { p_farm: farm.id, p_days: 14, p_discarded: showDiscarded }); }
    catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', errText(e))); return; }
    const files = r.files || [], zoneless = r.zoneless || [], units = (r.units || []).map(u => [u.unit_id, u.name]);
    const urls = await signAll(files.map(f => f.path), farm.id);
    d.body.textContent = '';

    d.body.append(el('div', 'hint',
      'A photo is uploaded when it is taken; its place in a report comes with the report. When the report never came, the photo waits here. ' +
      'Filing puts it in the report of the day and zone you choose. Discarding only takes it off this list.'));
    if (!r.may_file) d.body.append(el('div', 'hint', 'A manager or the agronomist files or discards a photo.'));

    const live = files.filter(f => !f.discarded), plant = live.filter(f => f.kind === 'scout');
    // ── for all: one zone and section, then every plant photo of the list ──
    if (r.may_file && plant.length > 1) {
      const bar = el('div', 'uf-all');
      const z = select([['', 'Zone…'], ...units], ''), s = select([['health', 'Plant health'], ['growth', 'Growth']], 'health');
      const go = el('button', 'btn btn-sm', `File all ${plant.length} plant photos`);
      go.onclick = async () => {
        if (!z.value) { toast('Choose the zone first', 'bad'); return; }
        busy(go, true, 'Filing…');
        let ok = 0, bad = 0;
        for (const f of plant) {
          try {
            const url = urls.get(f.path); if (!url) throw new Error('no preview');
            await rpc('file_photo', { p: { farm_id: farm.id, path: f.path, unit_id: z.value, section: s.value, photo_data: await smallCopy(url) } });
            ok++;
          } catch { bad++; }
        }
        toast(`${ok} photo${ok === 1 ? '' : 's'} filed${bad ? ` · ${bad} could not be` : ''}`, bad ? 'bad' : undefined);
        done(); await paintList();
      };
      bar.append(el('b', null, 'All at once'), z, s, go);
      d.body.append(bar);
    }

    // ── files with no record ──
    d.body.append(el('h3', 'uf-h', `Photos with no report (${live.length})`));
    if (!files.length) d.body.append(el('div', 'empty', 'Every photo of the last 14 days is in a report.'));
    const list = el('div', 'pd-removed');
    files.forEach(f => {
      const row = el('div', 'pd-removed-row uf-row' + (f.discarded ? ' uf-off' : ''));
      const url = urls.get(f.path);
      const im = el('img'); im.alt = ''; im.loading = 'lazy';
      if (url) { im.src = url; im.style.cursor = 'zoom-in'; im.title = 'Open the full photo'; im.onclick = () => window.open(url, '_blank', 'noopener'); }
      const txt = el('div');
      txt.append(el('b', null, [f.kind === 'trap' ? 'Trap photo' : 'Plant photo', shortDay(dayIn(f.at, farm.timezone)) + ' ' + hhmm(f.at), f.by ? String(f.by).split(/\s+/)[0] : null].filter(Boolean).join(' · ')));
      txt.append(el('div', 'hint', f.task
        ? `From: ${f.task}${f.area ? ' · ' + f.area : ''}${f.task_day ? ' · ' + shortDay(f.task_day) : ''} (${STATUS[f.task_status] || f.task_status})`
        : 'Its task is no longer on the plan'));
      if (f.waiting && !f.discarded) txt.append(el('div', 'hint uf-wait', 'That task is still open: if somebody is scouting now, the report will bring this photo by itself.'));
      if (f.discarded) txt.append(el('div', 'hint', 'Discarded'));
      const acts = el('div', 'uf-acts');
      if (r.may_file && !f.discarded) {
        if (f.kind === 'scout') {
          const z = select([['', 'Zone…'], ...units], f.unit_id || ''), s = select([['health', 'Plant health'], ['growth', 'Growth']], 'health');
          const day = el('input'); day.type = 'date'; day.value = dayIn(f.at, farm.timezone); day.max = dayIn(Date.now(), farm.timezone);
          day.title = 'The day of the report it goes into';
          const go = el('button', 'btn btn-sm btn-primary', 'File');
          go.onclick = async () => {
            if (!z.value) { toast('Choose the zone', 'bad'); return; }
            if (!url) { toast('The photo could not be opened', 'bad'); return; }
            busy(go, true, 'Filing…');
            try {
              const a = await rpc('file_photo', { p: { farm_id: farm.id, path: f.path, unit_id: z.value, section: s.value, day: day.value, photo_data: await smallCopy(url) } });
              toast(`Filed in ${a.zone} · ${shortDay(a.day)}`);
              done(); await paintList();
            } catch (e) { busy(go, false, 'File'); toast(errText(e), 'bad'); }
          };
          acts.append(z, s, day, go);
        } else acts.append(el('span', 'hint', 'A trap reading needs a count: photograph the trap again.'));
        const no = el('button', 'btn btn-sm', 'Discard');
        no.title = 'Off this list; the file stays in storage';
        no.onclick = async () => {
          busy(no, true, '…');
          try { await rpc('discard_photo_file', { p_farm: farm.id, p_path: f.path }); done(); await paintList(); }
          catch (e) { busy(no, false, 'Discard'); toast(errText(e), 'bad'); }
        };
        acts.append(no);
      } else if (r.may_file && f.discarded) {
        const back = el('button', 'btn btn-sm', 'Bring back');
        back.onclick = async () => {
          busy(back, true, '…');
          try { await rpc('discard_photo_file', { p_farm: farm.id, p_path: f.path, p_undo: true }); done(); await paintList(); }
          catch (e) { busy(back, false, 'Bring back'); toast(errText(e), 'bad'); }
        };
        acts.append(back);
      }
      row.append(im, txt, acts);
      list.append(row);
    });
    d.body.append(list);

    // ── plant photos with a record but no zone ──
    if (zoneless.length) {
      d.body.append(el('h3', 'uf-h', `Plant photos without a zone (${zoneless.length})`),
        el('div', 'hint', 'These came with a report that named no zone, so no zone\'s report shows them.'));
      const zl = el('div', 'pd-removed');
      zoneless.forEach(o => {
        const row = el('div', 'pd-removed-row uf-row');
        const im = el('img'); im.alt = ''; im.loading = 'lazy'; im.src = o.photo_data || '';
        const txt = el('div');
        txt.append(el('b', null, [o.section === 'growth' ? 'Growth' : 'Plant health', shortDay(dayIn(o.at, farm.timezone)) + ' ' + hhmm(o.at), o.by ? String(o.by).split(/\s+/)[0] : null].filter(Boolean).join(' · ')));
        if (o.note) txt.append(el('div', 'hint', o.note));
        const acts = el('div', 'uf-acts');
        if (r.may_file) {
          const z = select([['', 'Zone…'], ...units], '');
          const go = el('button', 'btn btn-sm btn-primary', 'Set the zone');
          go.onclick = async () => {
            if (!z.value) { toast('Choose the zone', 'bad'); return; }
            busy(go, true, '…');
            try { const a = await rpc('place_photo', { p_id: o.id, p_unit: z.value }); toast(`Now in ${a.zone} · ${shortDay(a.day)}`); done(); await paintList(); }
            catch (e) { busy(go, false, 'Set the zone'); toast(errText(e), 'bad'); }
          };
          const no = el('button', 'btn btn-sm', 'Remove');
          no.title = 'Kept 30 days under Removed photos…';
          no.onclick = async () => {
            busy(no, true, '…');
            try { await rpc('remove_photo', { p_kind: 'observation', p_id: o.id, p_reason: 'no zone' }); done(); await paintList(); }
            catch (e) { busy(no, false, 'Remove'); toast(errText(e), 'bad'); }
          };
          acts.append(z, go, no);
        }
        row.append(im, txt, acts);
        zl.append(row);
      });
      d.body.append(zl);
    }

    const tog = el('button', 'btn btn-ghost btn-sm', showDiscarded ? 'Hide the discarded ones' : 'Show the discarded ones');
    tog.onclick = () => { showDiscarded = !showDiscarded; paintList(); };
    d.body.append(tog);
  };
  paintList();
}
