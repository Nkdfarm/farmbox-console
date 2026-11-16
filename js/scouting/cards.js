// Scouting page: trap, photo and social cards, open in the gallery
import { el, num, trapCheckPill, farmTime, farmDay } from '../ui.js';
import { openViewer, tagChips, noteChip, photoTitle, partLabel, REACTS, firstComments, aiBlocks } from '../viewer.js';
import { viewerCtx } from './day.js';
import { removeX } from './removed.js';
import { S, MEASURE_WORD, SVG_NS, dotEl } from './state.js';
import { thumb } from './thumbs.js';

// a photo or a count added by an extra scouting (0204), beside the zone's planned one: "extra · Dial"
function extraTag(p) {
  const t = el('span', 'pill pd-extra', 'extra' + (p.by ? ' · ' + String(p.by).trim().split(/\s+/)[0] : ''));
  t.title = `Added by an extra scouting${p.by ? ' — ' + p.by : ''}, beside the zone's planned scouting`;
  return t;
}
export function trapCard(p, z, day, withNote = true, gallery = null) {
  const card = el('button', 'pd-trap' + (p.dot ? ' ' + p.dot : ''));
  const im = el('img'); im.alt = `trap ${p.code}`; im.loading = 'lazy'; thumb(im, p, day);
  const head = el('div', 'pd-trap-head');
  // while the AI counts, the figure is the phone's hidden placeholder: no number shown (0.7.277)
  const countingNow = !p.corrected && ['queued', 'running'].includes(p.ai_count_status);
  head.append(dotEl(p.dot), el('span', 'ipm-code ' + (p.colour || ''), p.code),
              el('b', null, countingNow || (p.total == null && ['queued', 'running'].includes(p.ai_count_status)) ? '…' : p.total == null ? 'needs a count' : num(p.total, 0)));
  // where the figure comes from (0.7.276, 0254): the AI's count, still counting, or typed by a person
  const src = p.corrected ? 'typed' : p.ai_count_status === 'done' ? 'AI' : ['queued', 'running'].includes(p.ai_count_status) ? 'counting…' : '';
  if (src) { const w = el('span', 'hint pd-count-src', src); w.title = src === 'AI' ? 'Counted by the AI on the card' : src === 'typed' ? 'Typed by a person' : "The phone's first guess; the AI is counting"; head.append(w); }
  if (p.extra) head.append(extraTag(p));
  if (p.day_rate != null) { const r = el('span', 'hint', `${num(p.day_rate, p.day_rate >= 10 ? 0 : 1)}/day`); r.title = 'New insects a day since the photo before'; head.append(r); }
  card.append(im, head, trapCurve(p.curve || [], day.threshold));
  // the AI's chips and the person's note on the trap, in the same risk colours (0.7.262, 0240)
  const ttc = (p.tags || []).length || p.ai_status === 'done' ? tagChips(p) : null;
  if (ttc) card.append(ttc);
  const tn = withNote ? noteChip(p, true) : null;            // the person's note: its own bubble under the chips
  if (tn) card.append(tn);
  // then the team's first comments: three blocks at most with the AI's and the note (0.7.280)
  if (withNote) card.append(...firstComments(p, aiBlocks(ttc) + (tn ? 1 : 0)));
  const tsl = socialLine(p.social);
  if (tsl) card.append(tsl);
  const chk = trapCheckPill(p.check, p.total);
  if (chk) card.append(chk);
  if (p.replaced) card.append(el('span', 'hint', 'card replaced'));
  if (day.may_write !== false && p.id) card.append(removeX({ ...p, kind: 'trap' }));
  card.onclick = () => openInGallery(p, z, day, gallery);
  return card;
}

// the trap's last 30 days by date, the threshold as a rule, a reset where the card was replaced
function trapCurve(pts, th) {
  const W = 120, H = 30, pad = 3;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pd-tcurve');
  if (pts.length < 2) { svg.setAttribute('aria-label', 'one reading'); return svg; }
  const ts = pts.map(p => new Date(p.at).getTime());
  const t0 = Math.min(...ts), t1 = Math.max(...ts), span = (t1 - t0) || 1;
  const max = Math.max(th?.over || 0, ...pts.map(p => p.total || 0), 1);
  const x = t => pad + (t - t0) * (W - 2 * pad) / span, y = v => H - pad - v * (H - 2 * pad) / max;
  if (th?.over) { const r = document.createElementNS(SVG_NS, 'line'); r.setAttribute('x1', pad); r.setAttribute('x2', W - pad); r.setAttribute('y1', y(th.over)); r.setAttribute('y2', y(th.over)); r.setAttribute('class', 'ipm-rule'); svg.append(r); }
  let seg = [];
  const flush = () => { if (seg.length > 1) { const pl = document.createElementNS(SVG_NS, 'polyline'); pl.setAttribute('points', seg.join(' ')); svg.append(pl); } seg = []; };
  pts.forEach((p, i) => {
    seg.push(`${x(ts[i]).toFixed(1)},${y(p.total || 0).toFixed(1)}`);
    if (p.replaced) flush();                                       // the next card starts from nothing
  });
  flush();
  const t = document.createElementNS(SVG_NS, 'title');
  t.textContent = pts.map(p => `${farmDay(p.at)}: ${p.total}${p.replaced ? ' (replaced)' : ''}`).join('\n');
  svg.append(t);
  svg.setAttribute('aria-label', `${pts.length} readings over ${Math.round(span / 864e5)} days`);
  return svg;
}

// the photo as a post (0.7.270, 0249): its comments and the team's agree / disagree with the AI, under the picture;
// since 0.7.271 (0250) a small "Verified" when a manager or the agronomist marked one comment as the diagnosis
// since 0.7.279 (0261) the reactions of every comment instead: "5 comments · 👍 3 · 👎 1 · 🤔 2" (a database before 0261
// gives agree / disagree: the AI's likes and dislikes)
export function socialLine(s) {
  if (!s) return null;
  const parts = [];
  if (s.comments) parts.push(`${s.comments} comment${s.comments === 1 ? '' : 's'}`);
  const r = { like: 'like' in s ? s.like : s.agree, dislike: 'dislike' in s ? s.dislike : s.disagree, pensive: s.pensive };
  REACTS.forEach(([k, emo]) => { if (Number(r[k])) parts.push(`${emo} ${r[k]}`); });
  if (!parts.length && !s.verified) return null;
  const d = el('div', 'pd-social', parts.join(' · '));
  d.title = 'Open the photo for the conversation';
  if (s.verified) {
    const v = el('span', 'pd-verified', '✓ Verified');
    v.title = `Verified diagnosis${s.verified.verified_by ? ' (' + s.verified.verified_by + ')' : ''}: ${s.verified.body || 'a voice note'}`;
    d.append(v);
  }
  return d;
}

export function photoFig(p, z, day, gallery = null) {
  const fig = el('figure', 'sc-fig' + (p.dot ? ' ' + p.dot : ''));
  const im = el('img'); im.alt = photoTitle(p); im.loading = 'lazy'; thumb(im, p, day);
  fig.append(im);
  const cap = el('figcaption');
  // one line under the picture (0.7.215, owner 4 Oct 2026: "Fruit - 10:25 - Oliver … remove the unnecessary tags"): what
  // it shows, when, who. The section, "extra", the AI's state and its sentence are the card's hover and the viewer's.
  const part = partLabel(p.part) || 'photo', who = p.by ? String(p.by).trim().split(/\s+/)[0] : null;
  const title = el('div', 'pd-fig-title' + (p.extra ? ' extra' : ''));
  title.append(dotEl(p.dot), el('b', null, [part.charAt(0).toUpperCase() + part.slice(1), farmTime(p.taken_at), who].filter(Boolean).join(' · ')));
  // the AI's chips, then the person's note as a bubble of its own with the writer's face and its risk colour
  // (0.7.261, 0.7.264: "identify better the human notes")
  const nc = noteChip(p, true);
  const tc = tagChips(p, true);
  cap.append(title, tc);
  if (nc) cap.append(nc);
  // then the team's first comments: three blocks at most with the AI's and the note (0.7.280, owner 23 Oct 2026: "rule
  // is to show up to the 3 first comments")
  cap.append(...firstComments(p, aiBlocks(tc) + (nc ? 1 : 0)));
  const sl = socialLine(p.social);
  if (sl) cap.append(sl);
  if ((p.measures || []).length) title.append(el('span', 'pill pd-sized', 'sizes'));
  // only what somebody measured or wrote: the position, the sizes on the scale card, the comment
  const sizes = (p.measures || []).map(m => `${MEASURE_WORD[m.what] || m.what} ${num(m.mm, 0)} mm`).join(' · ');
  const line = el('div', 'sc-where');
  if (p.pos_code) line.append(el('span', 'mono', p.pos_code));
  if (sizes) line.append(el('b', null, sizes));
  if (p.note && !nc) line.append(el('span', null, p.note));
  if (line.children.length) cap.append(line);
  const st = p.ai_status === 'done' ? 'AI read' : p.ai_status === 'queued' ? 'AI asked' : p.ai_status === 'failed' ? 'AI failed' : null;
  fig.title = [[p.crop, p.section === 'growth' ? 'Growth' : 'Plant health', p.extra ? 'extra scouting' : null, st].filter(Boolean).join(' · '),
               p.ai?.summary ? '✦ ' + p.ai.summary : null].filter(Boolean).join('\n');
  fig.append(cap);
  if (day.may_write !== false && p.id) fig.append(removeX(p));
  fig.onclick = () => openInGallery(p, z, day, gallery);
  return fig;
}

// a photo opened from its block slides through the block (0.7.264, owner: "a gallery mode with all current information
// but with the possibility to slide all pictures of the same section"): ‹ › and the arrow keys
function openInGallery(p, z, day, gallery) {
  const list = gallery ? (typeof gallery.list === 'function' ? gallery.list() : gallery.list) || [] : [];
  const at = list.findIndex(q => q.id === p.id);
  if (at < 0) return openViewer(viewerCtx(p, z, day));
  const show = i => openViewer({ ...viewerCtx(list[i], z, day),
    gallery: { index: i, count: list.length, label: gallery.label, open: show } });
  show(at);
}
