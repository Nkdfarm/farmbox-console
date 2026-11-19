// Scouting page: what was found (window, pressure line, case strip, crop bar)
import { rpc } from './zapi.js';
import { openCase } from '../cases.js';
import { loading, el, num, cropAvatar, toast, busy, drawer, ymd, parseNoon as parse, shortDay, farmDay, emptyState } from '../ui.js';
import { openViewer, photoTitle } from '../viewer.js';
import { reload } from './index.js';
import { paint } from './paint.js';
import { S, SVG_NS, caseInZone, cropInZone, dotEl, worst, zoneName } from './state.js';

// ── the AI found something (0194): the photos, the worst first; each opens in the viewer ──
const SEV_WORD = ['none', 'slight', 'clear', 'severe'];
export async function openFound() {
  const d = drawer('The AI found something', 'Plant photos of the last 14 days, not tagged, in no case, not marked seen');
  d.body.append(loading('Reading…'));
  const close = el('button', 'btn', 'Close'); close.onclick = d.close; d.footer.append(close);
  let j;
  try { j = await rpc('ai_found', { p_farm: S.farm.id }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
  const paintList = () => {
    d.body.textContent = '';
    const list = j.photos || [];
    if (!list.length) { d.body.append(emptyState('Nothing waiting: every finding was tagged, put in a case or marked seen.')); return; }
    d.body.append(el('div', 'hint', 'A proposal by the AI, not a diagnosis. Open a photo to tag it, put it in a case, or mark it seen.'));
    list.forEach(p => {
      const row = el('div', 'pd-found');
      const img = el('img'); img.src = p.photo_data || ''; img.alt = photoTitle(p); img.loading = 'lazy';
      const text = el('div', 'pd-found-text');
      const f = (p.ai?.findings || []).filter(x => ['pest', 'disease', 'disorder'].includes(x.kind) && (x.severity ?? 0) >= 1);
      text.append(el('b', null, f.map(x => `${x.name || x.code} · ${SEV_WORD[x.severity ?? 0]}`).join(' — ') || 'Finding'),
        el('div', 'hint', [p.zone, p.crop, farmDay(p.taken_at), p.ai_auto ? 'read automatically' : null].filter(Boolean).join(' · ')));
      if (p.ai?.summary) text.append(el('div', 'pd-found-sum', p.ai.summary));
      const open = el('button', 'btn btn-sm btn-primary', 'Open');
      const seen = el('button', 'btn btn-sm', 'Seen');
      seen.title = 'Looked at it: nothing to do. It leaves this list.';
      const drop = () => { j.photos = j.photos.filter(x => x.id !== p.id); paintList(); reload(); };
      open.onclick = () => openViewer({
        farm: S.farm, photo: p, catalog: S.catalog || [], aiReady: j.ai_ready, mayWrite: j.may_write !== false,
        zonePhotos: () => p.zone_id ? rpc('zone_photos', { p_farm: S.farm.id, p_zone: p.zone_id }) : Promise.resolve([]),
        zoneId: p.zone_id, crops: [],
        openCases: async () => (S.cases?.cases || []).filter(k => k.zone_id === p.zone_id && k.status !== 'closed'),
        onChange: ph => { if (ph?.ai_seen || (ph?.tags || []).length) drop(); else reload(); },
      });
      seen.onclick = async () => {
        busy(seen, true, '…');
        try { await rpc('mark_photo_seen', { p_id: p.id, p_seen: true }); drop(); }
        catch (e) { busy(seen, false, 'Seen'); toast(e.message, 'bad'); }
      };
      row.append(img, text, open);
      if (j.may_write !== false) row.append(seen);
      d.body.append(row);
    });
  };
  paintList();
}

export function pressureLine(weeks, thisWeek) {
  const W = 220, H = 40, pad = 4;
  const last = parse(thisWeek);
  const all = [];
  for (let k = 11; k >= 0; k--) { const d = new Date(last); d.setDate(d.getDate() - 7 * k); all.push(ymd(d)); }
  const by = new Map(weeks.map(w => [String(w.week).slice(0, 10), Number(w.rate) || 0]));
  const max = Math.max(1, ...by.values());
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-spark'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Insect pressure, twelve weeks');
  const x = i => pad + i * (W - 2 * pad) / (all.length - 1);
  const y = v => H - pad - v * (H - 2 * pad) / max;
  let seg = [];
  const flush = () => { if (seg.length > 1) { const pl = document.createElementNS(SVG_NS, 'polyline'); pl.setAttribute('points', seg.join(' ')); svg.append(pl); } seg = []; };
  all.forEach((wk, i) => {
    if (!by.has(wk)) { flush(); return; }                      // a week without a reading is a gap
    seg.push(`${x(i).toFixed(1)},${y(by.get(wk)).toFixed(1)}`);
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', x(i)); c.setAttribute('cy', y(by.get(wk))); c.setAttribute('r', i === all.length - 1 ? 2.8 : 1.6);
    const t = document.createElementNS(SVG_NS, 'title'); t.textContent = `Week of ${shortDay(wk)}: ${num(by.get(wk), 2)}`; c.append(t);
    svg.append(c);
  });
  flush();
  return svg;
}

// ── the open cases, as chips ──
export function caseStrip() {
  const box = el('div', 'pd-strip');
  const list = (S.cases.cases || []).filter(k => (!S.cropFilter || k.crop_id === S.cropFilter) && caseInZone(k));
  box.append(el('span', 'pd-strip-label', S.showClosed ? 'Cases' : 'Open cases'));
  if (!list.length) box.append(el('span', 'hint', S.cropFilter ? 'none on this crop' : S.zoneFilter ? 'none in ' + zoneName(S.zoneFilter) : 'none'));
  list.forEach(k => {
    const b = el('button', 'pd-case' + (k.status === 'closed' ? ' closed' : ''));
    b.append(dotEl(k.dot), el('b', null, k.label || k.title), el('span', 'hint', [k.crop, k.zone, k.status === 'in_progress' ? 'treating' : k.status === 'closed' ? String(k.outcome || 'closed').replace('_', ' ') : null].filter(Boolean).join(' · ')));
    b.onclick = () => openCase(k.id, reload, S.farm);
    box.append(b);
  });
  const t = el('button', 'linkish', S.showClosed ? 'Hide closed' : 'Show closed');
  t.onclick = async () => {
    S.showClosed = !S.showClosed;
    try { S.cases = await rpc('cases', { p_farm: S.farm.id, p_include_closed: S.showClosed }); paint(); }
    catch (e) { S.showClosed = !S.showClosed; toast(e.message, 'bad'); }
  };
  box.append(t);
  return box;
}

// ── the crop filter ──
export function cropBar() {
  const box = el('div', 'pd-crops');
  const all = el('button', 'pd-cropchip' + (!S.cropFilter ? ' on' : ''), 'All crops');
  all.onclick = () => { S.cropFilter = null; paint(); };
  box.append(all);
  (S.over.crops || []).filter(cropInZone).forEach(c => {
    const b = el('button', 'pd-cropchip' + (S.cropFilter === c.id ? ' on' : ''));
    const d = worst((S.cases.cases || []).filter(k => k.crop_id === c.id).map(k => k.dot));
    b.append(cropAvatar({ name: c.name, category: c.category, photo_url: c.photo_url }, 'sm'), el('span', null, c.name));
    if (d) b.append(dotEl(d));
    b.title = [(c.zones || []).map(z => z.name).join(', '), c.pressure != null ? `${num(c.pressure, 1)} insects/trap/day` : null].filter(Boolean).join(' · ');
    b.onclick = () => { S.cropFilter = S.cropFilter === c.id ? null : c.id; paint(); };
    box.append(b);
  });
  return box;
}
