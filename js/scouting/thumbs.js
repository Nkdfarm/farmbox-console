// Scouting page: photo thumbnails and panel reads per day (queued, kept copy, live)
import { cachedRpc } from '../api.js';
import { el, ymd, parseNoon as parse } from '../ui.js';
import { S, calm } from './state.js';

// ── a report that opens fast (0.7.201, migration 0198, owner 2 Oct 2026: "it takes time to charge the daily report") ──
// A day is read without its photos (scouting_day_light, a few kB instead of 5 MB); the photos' phone copies come in one
// answer beside it (scouting_thumbs) and fill the pictures in as they land; a zone's four blocks come in one answer for
// the whole day (zone_panels) instead of four calls a zone. Every day opens on the copy this device kept, at once, with
// "updating…" on its line while the database is asked; the screen is drawn again only when the answer differs (owner:
// "open instantly the old copy with a small logo running like updating data"). Only the pictures of a day before
// yesterday are not asked again when this device has them — a photo's phone copy does not change — unless one is missing.
const isOld = dstr => String(dstr) < ymd(new Date(parse(String(S.over.today)).getTime() - 864e5));
export const thumbMaps = new Map(), pendings = new Map(), panelReads = new Map();
export const thumbsLive = new Set(), thumbsKept = new Set();   // days whose pictures were asked of the database / answered from the copy
export const dayRows = new Map();                              // day → { repaint(), upd } of the row on screen
// "updating…" on a day's line while something of it is being asked
export function updater() {
  const node = el('span', 'pd-upd'); node.hidden = true;
  node.append(el('span', 'spin'), document.createTextNode(' updating…'));
  node.title = 'Showing the copy this computer kept; asking the database for the latest';
  let n = 0;
  return { node, begin() { n++; node.hidden = false; }, end() { n = Math.max(0, n - 1); if (!n) node.hidden = true; } };
}
const watched = (dstr, promise) => { const u = dayRows.get(String(dstr))?.upd; u?.begin(); return promise.finally(() => u?.end()); };
// a picture of a day's report: its phone copy when it is here, else when it lands
export function thumb(im, p, day) {
  const k = String(day?.day || '');
  const got = p.photo_data || thumbMaps.get(k)?.[p.id];
  if (got) { p.photo_data = got; im.src = got; return; }
  im.classList.add('pd-wait');
  (pendings.get(k) || pendings.set(k, []).get(k)).push([im, p]);
  if (thumbsKept.has(k)) liveThumbs(k);            // the kept pictures do not hold this one (a photo put back, a late one)
}
function landThumbs(dstr, map) {
  const k = String(dstr);
  thumbMaps.set(k, { ...(thumbMaps.get(k) || {}), ...(map || {}) });
  const all = thumbMaps.get(k);
  pendings.set(k, (pendings.get(k) || []).filter(([im, p]) => {
    if (!all[p.id]) return im.isConnected;          // still waiting, unless its picture left the page
    p.photo_data = all[p.id]; im.src = all[p.id]; im.classList.remove('pd-wait'); return false;
  }));
}
function liveThumbs(dstr) {
  if (thumbsLive.has(dstr)) return;
  thumbsLive.add(dstr);
  watched(dstr, calm('scouting_thumbs', { p_farm: S.farm.id, p_day: dstr })).then(r => landThumbs(dstr, r?.photos)).catch(() => thumbsLive.delete(dstr));
}
export async function readThumbs(dstr) {
  const copy = await cachedRpc('scouting_thumbs', { p_farm: S.farm.id, p_day: dstr }).catch(() => null);
  if (copy) landThumbs(dstr, copy.photos);
  if (copy && isOld(dstr)) { thumbsKept.add(dstr); if ((pendings.get(dstr) || []).length) liveThumbs(dstr); }
  else liveThumbs(dstr);
}
// the four blocks of every zone of a day, read once: the kept copy at once, the database's answer behind it — when it
// differs the day is drawn again from it. The first ask of each block is answered from that read, a later one (after a
// change) goes to the database.
function readPanels(dstr) {
  if (panelReads.has(dstr)) return panelReads.get(dstr);
  const a = { p_farm: S.farm.id, p_day: dstr };
  const live = () => watched(dstr, calm('zone_panels', a));
  const p = cachedRpc('zone_panels', a).catch(() => null).then(copy => {
    if (!copy) return live();
    live().then(fresh => {
      if (JSON.stringify(fresh) === JSON.stringify(copy) || panelReads.get(dstr) !== p) return;
      panelReads.set(dstr, Promise.resolve(fresh));
      dayRows.get(dstr)?.repaint();
    }).catch(() => {});
    return copy;
  });
  panelReads.set(dstr, p); p.catch(() => panelReads.delete(dstr));
  return p;
}
export function panelCall(dstr) {
  const used = new Set();
  return async (name, args) => {
    const key = name + '|' + (args.p_system || args.p_zone);
    const plain = name !== 'sump_history' || (args.p_days === 30 && !args.p_sump);
    if (plain && !used.has(key)) {
      used.add(key);
      try {
        const hit = (await readPanels(dstr))?.units?.[args.p_system || args.p_zone]?.[name];
        if (hit != null) return hit;
      } catch (e) { /* asked one by one below */ }
    }
    return calm(name, args);
  };
}
