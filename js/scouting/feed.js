// Scouting page: the opinions button and the feed window
import { rpc } from '../api.js';
import { loading, el, num, toast, busy, drawer, farmWhen } from '../ui.js';
import { openViewer, tagChips, noteChip, partLabel, openOpinions, firstComments, aiBlocks } from '../viewer.js';
import { socialLine } from './cards.js';
import { viewerCtx } from './day.js';
import { load, reload } from './index.js';
import { S, calm, dayData } from './state.js';
import { thumbMaps } from './thumbs.js';

// the photos the team asked my opinion on (0.7.269, Digital scouting): the count on the button, the list in a window
export function opinionsButton() {
  const b = el('button', 'btn', 'Opinions');
  b.title = 'Photos the team sent you for your opinion';
  b.onclick = () => openOpinions(S.farm, () => { reload(); count(); });
  const count = () => rpc('dg_my_requests', { p_farm: S.farm.id }).then(rows => {
    const n = (rows || []).length;
    b.textContent = n ? `Opinions · ${n}` : 'Opinions';
    b.classList.toggle('btn-primary', n > 0);
  }).catch(() => {});
  count();
  return b;
}

// ── the feed (0.7.271, 0250): the unit's photos and trap readings of the last 7 or 30 days as posts, for the
// agronomist at the desk (owner 22 Oct 2026, step 3 and 4 of the photo as a post) ──
// Four orders, the database's (dg_feed): what needs attention first (the highest risk, a verified one after the others of
// its risk, then the most discussed), the newest, the disagreements (a disagree vote, or the people's colour unlike the
// AI's), mine (taken, commented or voted on by me); 20 a page, the pictures apart (dg_thumbs). A card is drawn as the
// report draws a photo, with its risk as the left edge; a click opens the photo in the viewer as its day holds it — its
// zone, its cases — and ‹ › go through the list. A change made in the viewer reads the list again.
const FEED_SORT = [['attention', 'Needs attention'], ['newest', 'Newest'], ['disagree', 'Disagreements'], ['mine', 'Mine']];
let feedSort = 'attention', feedDays = 7;         // as last chosen, while the console is open
const errText = e => {
  const m = String(e?.message || e).replace(/^\d+ /, '');
  // a database without migration 0250
  return /dg_feed|dg_thumbs|PGRST202|Could not find the function/i.test(m) ? 'The feed needs the database update of 22 Oct 2026 (migration 0250).' : m;
};
export function feedButton() {
  const b = el('button', 'btn', 'Feed');
  b.title = 'The photos of the last days as posts: what needs attention first, the disagreements, yours';
  b.onclick = openFeed;
  return b;
}
function openFeed() {
  const f = S.farm;
  let closed = false, seq = 0, soon = null;
  const d = drawer('Feed', 'The scouting photos as posts — a click opens the photo with its conversation', { onClose: () => { closed = true; clearTimeout(soon); } });
  d.box.classList.add('pd-feed-drawer');
  const ctl = el('div', 'pd-feed-ctl'), sum = el('div', 'hint'), list = el('div', 'pd-feed'), foot = el('div', 'pd-feed-foot');
  d.body.append(ctl, sum, list, foot);
  let items = [], total = 0, more = false, mayWrite = true;
  const thumbs = new Map(), asked = new Set();    // id → the phone copy, kept across the orders and the reads
  const page = (offset, limit) => rpc('dg_feed', { p: { farm_id: f.id, sort: feedSort, days: feedDays, offset, limit } }, { quiet: true });

  const paintCtl = () => {
    ctl.textContent = '';
    const chips = el('div', 'chips');
    FEED_SORT.forEach(([v, word]) => {
      const c = el('button', 'chip' + (feedSort === v ? ' on' : ''), word);
      c.type = 'button'; c.setAttribute('aria-pressed', String(feedSort === v));
      c.onclick = () => { if (feedSort === v) return; feedSort = v; paintCtl(); load(); };
      chips.append(c);
    });
    const seg = el('div', 'seg');
    [7, 30].forEach(n => {
      const s = el('button', 'seg-btn', `${n} days`);
      s.type = 'button'; s.setAttribute('aria-pressed', String(feedDays === n));
      s.onclick = () => { if (feedDays === n) return; feedDays = n; paintCtl(); load(); };
      seg.append(s);
    });
    ctl.append(chips, seg);
  };
  // the pictures of the cards that have none yet, 40 at a time; each lands in its card
  const fetchThumbs = async rows => {
    const want = rows.filter(p => p.has_thumb && !thumbs.has(p.id) && !asked.has(p.id));
    want.forEach(p => asked.add(p.id));
    for (let i = 0; i < want.length; i += 40) {
      try {
        const m = await rpc('dg_thumbs', { p: { items: want.slice(i, i + 40).map(p => ({ kind: p.kind, id: p.id })) } }, { quiet: true });
        if (closed) return;
        Object.entries(m || {}).forEach(([id, src]) => {
          thumbs.set(id, src);
          list.querySelectorAll(`img[data-id="${id}"]`).forEach(im => { im.src = String(src); im.classList.remove('pd-wait'); });
        });
      } catch { /* the cards stay without their picture */ }
    }
  };
  const card = (p, i, rows) => {
    const c = el('button', 'pd-post' + (p.risk ? ' r-' + p.risk : ''));
    c.type = 'button';
    if (p.risk) c.title = { red: 'High risk', orange: 'Low risk', green: 'No risk' }[p.risk] || '';
    const im = el('img'); im.alt = ''; im.loading = 'lazy'; im.dataset.id = p.id;
    const got = thumbs.get(p.id) || thumbMaps.get(String(p.day))?.[p.id];
    if (got) im.src = got; else if (p.has_thumb) im.classList.add('pd-wait');
    const info = el('div', 'pd-post-info');
    const title = el('div', 'pd-post-title');
    if (p.kind === 'trap') {
      title.append(el('b', null, p.zone || 'Trap'), el('span', 'ipm-code ' + (p.colour || ''), p.code || '?'));
      if (p.total != null) title.append(el('span', 'hint', `${num(p.total, 0)} insects`));
    } else {
      const part = partLabel(p.part) || 'photo';
      title.append(el('b', null, [p.zone, part.charAt(0).toUpperCase() + part.slice(1)].filter(Boolean).join(' · ')));
      if (p.crop) title.append(el('span', 'hint', p.crop));
    }
    info.append(title, el('div', 'hint', [`${farmWhen(p.taken_at)}`, p.by ? String(p.by).trim().split(/\s+/)[0] : null].filter(Boolean).join(' · ')));
    // the AI's chips, the person's note and the team's first comments, as under a report photo (three at most, 0.7.280)
    const tc = p.ai_status === 'done' ? tagChips(p, true) : null;
    if (tc) info.append(tc);
    const nc = noteChip(p, true);
    if (nc) info.append(nc);
    info.append(...firstComments(p, aiBlocks(tc) + (nc ? 1 : 0)));
    const v = p.social?.verified;
    if (v) {
      const lvl = ['green', 'yellow', 'red'].includes(v.level) ? v.level : 'yellow';
      const vb = el('div', `vw-verified r-${lvl}`);
      vb.append(el('div', 'vw-verified-h', '✓ Verified diagnosis'), el('div', 'vw-verified-body clamp', v.body || 'A voice note'),
                el('div', 'hint', [v.by, v.verified_by ? 'verified by ' + v.verified_by : null].filter(Boolean).join(' · ')));
      info.append(vb);
    }
    const sl = socialLine(p.social);
    if (sl) info.append(sl);
    c.append(im, info);
    c.onclick = () => openPost(rows, i);
    return c;
  };
  const paintList = () => {
    const y = d.body.scrollTop;
    list.textContent = ''; foot.textContent = '';
    sum.textContent = total ? `${total} post${total === 1 ? '' : 's'} in the last ${feedDays} days` : '';
    if (!items.length) list.append(el('div', 'empty', feedSort === 'mine' ? `Nothing of yours in the last ${feedDays} days.`
      : feedSort === 'disagree' ? `No disagreement in the last ${feedDays} days.` : `No photo in the last ${feedDays} days.`));
    const rows = items.slice();                   // the list a viewer opened from it goes through, as it was clicked
    rows.forEach((p, i) => list.append(card(p, i, rows)));
    if (more) {
      const b = el('button', 'btn btn-sm', 'More');
      b.onclick = async () => {
        const my = seq;
        busy(b, true, 'Reading…');
        try {
          const r = await page(items.length, 20);
          if (my !== seq || closed) return;
          items = items.concat(r?.items || []); total = r?.total ?? total; more = !!r?.more;
          paintList(); fetchThumbs(r?.items || []);
        } catch (e) { busy(b, false, 'More'); toast(errText(e), 'bad'); }
      };
      foot.append(b);
    }
    d.body.scrollTop = y;
  };
  // the list from the top; keep = as many as were on screen (a change in the viewer reads them again, in place)
  const load = async (keep = 0) => {
    const my = ++seq;
    if (!keep) { list.textContent = ''; foot.textContent = ''; sum.textContent = ''; list.append(loading('Reading…')); }
    let got = [], r = null;
    try {
      const want = Math.max(20, keep);
      while (got.length < want) {
        r = await page(got.length, Math.min(40, want - got.length));
        if (my !== seq || closed) return;
        got = got.concat(r?.items || []);
        if (!r?.more) break;
      }
    } catch (e) {
      if (my !== seq || closed || keep) return;   // read again after a change: the list stays as it was
      list.textContent = ''; list.append(el('div', 'note bad', errText(e)));
      return;
    }
    items = got; total = r?.total ?? got.length; more = !!r?.more; mayWrite = r?.may_write !== false;
    paintList(); fetchThumbs(items);
  };
  const changed = () => { clearTimeout(soon); soon = setTimeout(() => { if (!closed) load(items.length); }, 400); };

  // a post opened as the report opens it: the photo from its day's report (its zone, crops and cases); a photo that is in
  // no report any more opens from the post itself
  const openPost = async (rows, i) => {
    const p = rows[i];
    if (!p) return;
    const gallery = { index: i, count: rows.length, label: 'Feed', open: k => openPost(rows, k) };
    const onChange = () => { changed(); reload(); };
    const dstr = String(p.day || '');
    let day = null, z = null, q = null;
    try {
      day = dayData.get(dstr);
      if (!day && dstr) { day = await calm('scouting_day_light', { p_farm: f.id, p_day: dstr }); dayData.set(dstr, day); }
      for (const u of (day?.units || day?.zones || [])) {
        q = ((p.kind === 'trap' ? u.traps : u.photos) || []).find(x => x.id === p.id) || null;
        if (q) { z = u; break; }
      }
    } catch { /* opened from the post */ }
    if (closed) return;                           // the feed was closed while its day was read
    const pic = q?.photo_data || thumbs.get(p.id) || thumbMaps.get(dstr)?.[p.id] || '';
    if (q && z) return openViewer({ ...viewerCtx({ ...q, kind: p.kind, zone: z.name, photo_data: pic }, z, day), gallery, onChange });
    openViewer({
      farm: f, photo: { ...p, photo_data: pic }, catalog: S.catalog || [], aiReady: day?.ai_ready, mayWrite,
      zonePhotos: () => p.zone_id ? rpc('zone_photos', { p_farm: f.id, p_zone: p.zone_id }) : Promise.resolve([]),
      zoneId: p.zone_id, crops: [],
      openCases: async () => (S.cases?.cases || []).filter(k => k.zone_id === p.zone_id && k.status !== 'closed'),
      gallery, onChange,
    });
  };
  paintCtl();
  load();
}
