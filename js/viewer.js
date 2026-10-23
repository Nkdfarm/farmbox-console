// ═══════════════════════════════════════════════════════════════════════════
// The photo viewer (migration 0096, console 0.7.98)
//
// One scouting photo — a sticky trap or a plant part — full screen on the
// full-resolution file: wheel or pinch to zoom up to 8×, drag to pan, 1:1 and
// Fit. Beside it: what it is, the person's tags from the pest catalogue, the
// AI's reading with an "Ask the AI" button (sent by itself only where the automatic scan is on, 0194), and
// "Compare with…", which lists the same zone's photos by date and opens the
// chosen one in a second pane at the same zoom. Since 0195 a chat about the photo
// (rpc photo_chat, function photo-chat): the farm's one conversation, with the cards
// the AI proposes — run here, as the person, on "Do it".
//
//   openViewer({ farm, photo, catalog, zonePhotos, aiReady, mayWrite, onChange })
//     photo       { kind: 'trap' | 'observation', id, taken_at, photo_data, photo_path, tags, … }
//     catalog     the pest catalogue (rpc pest_catalog)
//     zonePhotos  async () → the zone's photos, newest first (rpc zone_photos)
//     onChange    called after a tag or an AI answer, so the page repaints
//     zoneId, cropId, crops   where the photo was taken, for the case section (0097)
//     openCases   async () → the open cases of the zone (rpc cases, filtered)
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn, api, URL_BASE, me } from './api.js';
import { el, toast, busy, num, selectBox, avatar, drawer, g1Face } from './ui.js';
import { newCase, openCase } from './cases.js';

const when = ts => ts ? new Date(ts).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const day = ts => ts ? new Date(ts).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
const SEV = ['none', 'slight', 'clear', 'severe'];
export const partLabel = p => ({ leaf: 'leaf', fruit: 'fruit', head: 'head', root: 'root', stem: 'stem', whole: 'whole plant', other: 'other' })[p] || p || '';

// a signed URL (one hour) for a full photo in the private evidence bucket
export async function fullPhotoUrl(path) {
  if (!path) return null;
  try {
    const res = await api('/storage/v1/object/sign/evidence/' + path, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }), quiet: true });
    return res?.signedURL ? URL_BASE + '/storage/v1' + res.signedURL : null;
  } catch { return null; }
}

export const photoTitle = p => p.kind === 'trap'
  ? `Trap ${p.code}` + (p.total != null ? ` · ${num(p.total, 0)} insects` : '')
  : `${p.crop || 'Plant'} · ${partLabel(p.part)}`;

// the tags on a photo, the person's and the AI's, as one list of chips
// `short` (the report's cards, 0.7.214, owner 4 Oct 2026: "just the AI summary with 3 colours, the complete AI report
// only when clicking"): an AI finding is its first words — "Powdery mildew · slight" — in its risk colour (below),
// the whole sentence on hover; the viewer shows everything.
const shortName = s => { const t = String(s || '').split(/\s*[(,;:]|\s+[—–-]\s+/)[0].trim(); return t.length > 26 ? t.slice(0, 25).trimEnd() + '…' : t; };
// One risk scale for every chip, the person's and the AI's (0.7.261, owner 15 Oct 2026: "yellow (low risk), red (risk
// high) and green (no risks). remove the blue and grey"): until then a chip took the colour of its kind (pest amber,
// disease red, disorder blue, beneficial green, none grey). Now: nothing or a beneficial green, slight yellow, clear or
// severe red; the kind stays in the words. A tag without a severity is slight (tag_photo's default).
export const RISK_WORD = { green: 'no risk', yellow: 'low risk', red: 'high risk' };
export const riskOf = (severity, kind) => kind === 'beneficial' || Number(severity) === 0 ? 'green'
  : Number(severity ?? 1) >= 2 ? 'red' : 'yellow';
// the person's note as a chip of the same scale, their small face inside on the left (0239): the colour is theirs —
// beside the AI's chips it shows where the two read the photo differently. A note filed by hand ("Recovered by …")
// says nothing about the crop: it stays a line of text.
export function noteChip(p, short = false) {
  const text = String(p.note || '').trim();
  // a list that does not carry the reading (a case, "The AI found something"): the note stays text
  if (!text || !('note_level' in p) || (!p.note_level && /^Recovered by\b/.test(text))) return null;
  const lvl = RISK_WORD[p.note_level] ? p.note_level : 'yellow';
  const c = el('span', `vw-tag vw-note r-${lvl}`);
  if (p.by || p.worker_id) c.append(avatar({ worker_id: p.worker_id || null, name: p.by || '' }, 'xs'));
  c.append(el('span', 'vw-note-text' + (short ? ' clamp' : ''), text));
  c.title = `${p.by ? p.by + ': ' : ''}${text} (${p.note_level ? RISK_WORD[lvl] : 'no risk chosen'})`;
  return c;
}
// the AI's reading in the same block as a person's note, the robot's face in place of theirs (0.7.273, owner 22 Oct
// 2026: "use the same visual block used for human for ai as well just with the robot avatar"); "AI:" stays on hover
function aiNote(text, lvl, title, short) {
  const c = el('span', `vw-tag vw-note ai r-${lvl}`);
  c.append(g1Face('xs', 'The AI'), el('span', 'vw-note-text' + (short ? ' clamp' : ''), text));
  c.title = title || `AI: ${text}`;
  return c;
}
// the AI's findings as ONE block, the most serious first and the block in the colour of the worst (0.7.275, owner 22
// Oct 2026: "the AI notes in only one to be more visual, with first information according with gravity"): red before
// yellow before green, then the higher severity, then the AI's own order
const RISK_RANK = { red: 3, yellow: 2, green: 1 };
export const byGravity = all => all.map((x, i) => ({ x, i, lvl: riskOf(x.severity, x.kind) }))
  .sort((a, b) => (RISK_RANK[b.lvl] - RISK_RANK[a.lvl]) || (Number(b.x.severity ?? 1) - Number(a.x.severity ?? 1)) || a.i - b.i);
// a trap's insects the same way: the pests before the beneficial ones, the most counted first
export const insectsByGravity = sp => sp.map((x, i) => ({ x, i }))
  .sort((a, b) => (!!a.x.beneficial - !!b.x.beneficial) || (Number(b.x.count ?? 0) - Number(a.x.count ?? 0)) || a.i - b.i).map(o => o.x);
export function tagChips(p, short = false) {
  const box = el('div', 'vw-chips');
  (p.tags || []).forEach(t => box.append(el('span', 'vw-tag r-' + riskOf(t.severity, t.kind), `${t.label || t.code}${t.severity != null ? ' · ' + SEV[t.severity] : ''}`)));
  if (p.kind === 'observation' && p.ai_status === 'done') {
    const all = byGravity(p.ai?.findings || []);
    if (!all.length && p.ai?.healthy !== false) box.append(aiNote('Healthy', 'green', 'AI: healthy', short));
    if (all.length) {
      const sev = x => x.severity != null ? ' · ' + SEV[x.severity] : '';
      // under a picture (short) each finding's first words, two lines at most; every finding in full on hover
      const text = all.map(({ x }) => `${short ? shortName(x.name || x.code) : (x.name || x.code)}${sev(x)}`).join(', ');
      box.append(aiNote(text, all[0].lvl, all.map(({ x }) => `AI: ${x.name || x.code}${sev(x)}`).join('\n'), short));
    }
  }
  // insects on a trap: a pest seen, low risk by itself — the trap's own figure against the limits says more
  if (p.kind === 'trap' && p.ai_status === 'done' && Array.isArray(p.species) && p.species.length) {
    const sp = insectsByGravity(p.species);
    box.append(aiNote(sp.map(x => `${x.common || x.name} ${x.count ?? ''}`.trim()).join(', '), sp.some(x => !x.beneficial) ? 'yellow' : 'green',
                      sp.map(x => `AI: ${x.common || x.name}${x.name && x.common && x.name !== x.common ? ' (' + x.name + ')' : ''} ${x.count ?? ''}`.trim()).join('\n'), short));
  }
  return box;
}

// ── the team's notes on a photo (0.7.269) ──
let meId = null, meAt = 0;           // the signed-in person, asked again after a minute (a sign-out and in)
const whoAmI = async () => { if (meId && Date.now() - meAt < 60000) return meId; try { meId = (await me())?.id || null; meAt = Date.now(); } catch { meId = null; } return meId; };
const signedUrl = async path => {
  try {
    const r = await api('/storage/v1/object/sign/evidence/' + path.split('/').map(encodeURIComponent).join('/'),
                        { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }), quiet: true });
    return r?.signedURL ? URL_BASE + '/storage/v1' + r.signedURL : null;
  } catch { return null; }
};
const errWord = e => String(e?.message || e).replace(/^\d+ /, '');
const riskSelect = () => {
  const s = el('select', 'vw-note-risk');
  [['green', 'Green · no risk'], ['yellow', 'Yellow · low risk'], ['red', 'Red · high risk']].forEach(([v, w]) => { const o = el('option', null, w); o.value = v; s.append(o); });
  s.value = 'yellow'; s.dataset.level = 'yellow'; s.onchange = () => { s.dataset.level = s.value; };
  return s;
};
// The photo as a post (0.7.271, 0250; owner 22 Oct 2026: "Naked Heart shows the same thread, votes and verified answer
// on each photo"), as a comment flow since 0.7.279 (0261; owner 23 Oct 2026: "this part has to be as a comments flow in
// the social … first comment by ai (summarized in one line …), second comment is the human note done by the user take
// the pic, other comments by users … like, dislike and pensive … same approach for the naked heart"): read with
// dg_photo_thread — the verified diagnosis on top when a manager or the agronomist has marked one, then the AI's reading
// in one line (the whole of it is "The AI" further down), the note of who took the photo, and everybody's comments and
// questions in time order with the AI's answers indented under the comment they answer; each with like, dislike and
// not sure. "Ask the AI" under my own comment sends that comment (photo-chat, brief) — never by itself; "More detail"
// under an answer asks for the long one. After every change the photo's social and notes are the thread's, and the page
// underneath is told (ctx.onChange).
const firstWord = s => s ? String(s).trim().split(/\s+/)[0] : '';
// the reactions, the one place with emoji (owner 23 Oct 2026: "for general design and gui I prefer the minimalist icon,
// for the reactions the classic small emoji are better")
export const REACTS = [['like', '👍', 'Like'], ['dislike', '👎', 'Dislike'], ['pensive', '🤔', 'Not sure']];
const firstSentence = s => { const t = String(s || '').replace(/\s+/g, ' ').trim(), m = t.match(/^.+?[.!?](?=\s|$)/); const x = (m ? m[0] : t).trim(); return x.length > 160 ? x.slice(0, 157).trimEnd() + '…' : x; };
function verifiedBlock(v) {
  const lvl = RISK_WORD[v.level] ? v.level : 'yellow';
  const box = el('div', `vw-verified r-${lvl}`);
  box.append(el('div', 'vw-verified-h', '✓ Verified diagnosis'), el('div', 'vw-verified-body', v.body || 'A voice note'),
             el('div', 'hint', [v.by ? 'by ' + v.by : null, v.verified_by ? 'verified by ' + v.verified_by : null, v.at ? when(v.at) : null]
                                 .filter(Boolean).join(' · ')));
  box.title = `${RISK_WORD[lvl]} — it stands above the AI's reading`;
  return box;
}
// hooks: editNote() opens the photographer's note for a change; showAI() brings the whole AI reading into view
function teamNotes(photo, ctx, mayWrite, onAsked, hooks = {}) {
  const sec = el('div', 'vw-note-sec vw-team');
  const kind = photo.kind === 'trap' ? 'trap' : 'observation';
  const top = el('div', 'vw-team-top');
  sec.append(top);
  let T = null, tried = false, readSeq = 0, paintSeq = 0;
  const asking = new Set();                       // my comments (and "more detail" asks) on their way to the AI
  // the thread: dg_photo_thread is not on the api's list of reads, so it is asked quiet — reading it is no change to
  // tell the other consoles about. Its notes become the photo's (the report's note chips read photo.notes).
  const read = async () => {
    const my = ++readSeq;
    try {
      const t = await rpc('dg_photo_thread', { p_kind: kind, p_id: photo.id }, { quiet: true });
      if (my !== readSeq || !t) return;
      T = t;
      photo.social = t.social || photo.social || null;
      photo.notes = (t.thread || []).filter(x => x.type === 'note');
    } catch { /* a database before 0249: the photo's own notes, without the AI's answers */ }
    finally { if (my === readSeq) tried = true; }
  };
  // after a change: drawn at once from what is known, then the thread read again, then the page underneath
  const changed = async () => { paint(); await read(); paint(); ctx.onChange?.(photo); };

  const askAi = async n => {
    if (asking.has(n.id)) return;
    if (ctx.aiReady === false) { toast('Paste an Anthropic API key in Settings › Integrations first', 'bad'); return; }
    asking.add(n.id); paint();
    try {
      const res = await fn('photo-chat', { kind, id: photo.id, note_id: n.id, brief: true });
      if (!res?.ok) throw new Error(res?.error || 'no answer');
    } catch (e) {
      // 409: this comment has its answer already (another console, a phone) — the thread read again shows it
      if (e?.status !== 409) toast('The AI did not answer: ' + errWord(e).slice(0, 160), 'bad');
    }
    asking.delete(n.id);
    await changed();
    onAsked?.();                                   // the chat below holds the same answer
  };
  // more on a short answer: a question of mine in the flow, the long answer under it
  const moreDetail = async a => {
    const key = 'more:' + a.id;
    if (asking.has(key)) return;
    if (ctx.aiReady === false) { toast('Paste an Anthropic API key in Settings › Integrations first', 'bad'); return; }
    asking.add(key); paint();
    const said = firstSentence(a.body);
    try {
      const res = await fn('photo-chat', { kind, id: photo.id, message: `More detail, please, on your answer${said ? ': "' + said + '"' : ''}` });
      if (!res?.ok) throw new Error(res?.error || 'no answer');
    } catch (e) { toast('The AI did not answer: ' + errWord(e).slice(0, 160), 'bad'); }
    asking.delete(key);
    await changed();
    onAsked?.();
  };
  const verify = async (n, on, btn) => {
    busy(btn, true, '…');
    try {
      photo.social = await rpc('dg_verify_note', { p: { note_id: n.id, on } });
      toast(on ? 'Marked as the verified diagnosis' : 'No longer the verified diagnosis', 'ok');
      await changed();
    } catch (e) { busy(btn, false, on ? 'Verify' : 'Unverify'); toast(errWord(e), 'bad'); }
  };
  // like, dislike, not sure: the same again takes it back; who gave which on hover
  const reactRow = (target, tid, r0) => {
    const r = { like: Number(r0?.like) || 0, dislike: Number(r0?.dislike) || 0, pensive: Number(r0?.pensive) || 0, mine: r0?.mine || null };
    const row = el('span', 'vw-react');
    const who = Array.isArray(r0?.who) ? r0.who : [];
    REACTS.forEach(([k, emo, word]) => {
      const b = el('button', 'vw-rb' + (r.mine === k ? ' on' : ''));
      b.textContent = r[k] ? `${emo} ${r[k]}` : emo;
      const names = who.filter(x => x.reaction === k).map(x => firstWord(x.by)).filter(Boolean);
      b.title = word + (names.length ? ': ' + names.join(', ') : '');
      b.setAttribute('aria-pressed', String(r.mine === k));
      b.disabled = !mayWrite;
      b.onclick = async () => {
        const reaction = r.mine === k ? null : k;
        busy(b, true, '…');
        try {
          const res = await rpc('dg_react', { p: { kind, ref_id: photo.id, target, target_id: tid || null, reaction } });
          const { target: _t, target_id: _i, reactions, ...soc } = res || {};
          photo.social = soc;
          if (T && reactions) {
            if (target === 'ai') T.ai_reactions = reactions;
            else if (target === 'own') { if (T.own) T.own.reactions = reactions; }
            else (T.thread || []).forEach(x => { if (x.id === tid && (target === 'note' ? x.type === 'note' : x.type !== 'note')) x.reactions = reactions; });
            T.social = soc;
          }
          await changed();
        } catch (e) { busy(b, false, emo); toast(errWord(e), 'bad'); }
      };
      row.append(b);
    });
    return row;
  };

  // the AI's reading, first: one line — its findings by gravity and the first thing it says — the whole of it in "The AI"
  const aiComment = () => {
    const st = photo.ai_status;
    const b = el('div', 'vw-tag vw-note ai vw-flow-ai');
    b.append(g1Face('xs', 'The AI'));
    const txt = el('div', 'vw-note-text');
    txt.append(el('b', null, 'AI · the reading'));
    if (st !== 'done') { txt.append(el('div', 'hint', st === 'queued' ? 'Asked — waiting for the answer.' : st === 'failed' ? 'The AI could not read it.' : 'Not read by the AI yet.')); b.append(txt); return b; }
    const chips = tagChips({ ...photo, tags: [] }, true).querySelector('.vw-note');
    const line = [chips ? chips.textContent : null, firstSentence(kind === 'trap' ? photo.ai_notes : photo.ai?.summary)].filter(Boolean).join(' — ');
    b.classList.add('r-' + ((chips && ['green', 'yellow', 'red'].find(l => chips.classList.contains('r-' + l))) || 'yellow'));
    txt.append(el('div', null, line || 'Nothing it could name.'));
    const acts = el('div', 'vw-msg-acts');
    acts.append(reactRow('ai', null, T?.ai_reactions || photo.social?.ai || null));
    if (hooks.showAI) { const full = el('button', 'btn btn-sm', 'See the full reading'); full.onclick = hooks.showAI; acts.append(full); }
    txt.append(acts);
    b.append(txt);
    return b;
  };
  // the note of who took the photo, second: the photo's own (as changed here), its reactions from the thread
  const ownComment = () => {
    const words = String(photo.note || '').trim();
    if (!words) return null;
    const o = T?.own || {};
    const lvl = RISK_WORD[photo.note_level] ? photo.note_level : 'yellow';
    const b = el('div', `vw-tag vw-note r-${lvl} vw-flow-own`);
    const by = o.by || photo.by || '';
    if (by || o.worker_id || photo.worker_id) b.append(avatar({ worker_id: o.worker_id || photo.worker_id || null, name: by }, 'xs'));
    const txt = el('div', 'vw-note-text');
    txt.append(el('b', null, [firstWord(by) || 'Somebody', 'took the photo', o.at || photo.taken_at ? when(o.at || photo.taken_at) : null].filter(Boolean).join(' · ')),
               el('div', null, words));
    const acts = el('div', 'vw-msg-acts');
    acts.append(reactRow('own', null, o.reactions || null));
    if (mayWrite && hooks.editNote) { const ed = el('button', 'btn btn-sm', 'Edit'); ed.onclick = hooks.editNote; acts.append(ed); }
    txt.append(acts);
    b.append(txt);
    return b;
  };
  // one comment: face, risk colour, words or the voice; under it its reactions and what I may do with it
  const comment = (n, mine, mayVerify) => {
    const lvl = RISK_WORD[n.level] ? n.level : 'yellow';
    const b = el('div', `vw-tag vw-note r-${lvl}` + (n.verified_at ? ' verified' : ''));
    if (n.by || n.worker_id) b.append(avatar({ worker_id: n.worker_id || null, name: n.by || '' }, 'xs'));
    const txt = el('div', 'vw-note-text');
    txt.append(el('b', null, (firstWord(n.by) || 'Somebody') + ' · ' + when(n.at) + (n.verified_at ? ' · verified' : '')));
    const words = String(n.body || n.transcript || '').trim();
    if (words) txt.append(el('div', null, words));
    else if (n.audio_path) txt.append(el('div', 'hint', n.voice_status === 'failed' ? 'The recording could not be written down' : 'Writing the recording down…'));
    const acts = el('div', 'vw-msg-acts');
    if (n.id) acts.append(reactRow('note', n.id, n.reactions));
    if (n.audio_path) {
      const play = el('button', 'btn btn-sm', 'Listen');
      play.onclick = async () => {
        const u = await signedUrl(n.audio_path);
        if (!u) { toast('The recording could not be opened', 'bad'); return; }
        const a = el('audio'); a.controls = true; a.autoplay = true; a.src = u; play.replaceWith(a);
      };
      acts.append(play);
    }
    // my own comment, written and not yet asked: I decide whether the AI sees it (the phone's "Ask the AI")
    if (mayWrite && mine && n.id && n.by_user === mine && !n.asked_ai && words && !asking.has(n.id)) {
      const ask = el('button', 'btn btn-sm', 'Ask the AI');
      ask.title = 'Send this comment to the AI — a short answer, kept under it; about half a minute';
      ask.onclick = () => askAi(n);
      acts.append(ask);
    }
    if (mayVerify && n.id) {
      const v = el('button', 'btn btn-sm' + (n.verified_at ? ' btn-primary' : ''), n.verified_at ? 'Unverify' : 'Verify');
      v.title = n.verified_at ? 'It stops being the verified diagnosis of this photo'
                              : 'Mark it as the verified diagnosis of this photo (one a photo; a comment changed loses it)';
      v.onclick = () => verify(n, !n.verified_at, v);
      acts.append(v);
    }
    txt.append(acts);
    b.append(txt);
    if (mayWrite && mine && n.id && n.by_user === mine) {
      const x = el('button', 'vw-x', '×'); x.title = 'Delete my note';
      x.onclick = async () => {
        try {
          await rpc('dg_delete_note', { p_id: n.id });
          photo.notes = (photo.notes || []).filter(q => q.id !== n.id);
          if (T) T.thread = (T.thread || []).filter(q => !(q.type === 'note' && q.id === n.id));
          await changed();
        } catch (e) { toast(errWord(e), 'bad'); }
      };
      b.append(x);
    }
    return b;
  };
  // a question to the AI (the chat below, or "More detail"): its asker, no colour
  const question = q => {
    const b = el('div', 'vw-tag vw-note vw-flow-q');
    if (q.by || q.worker_id) b.append(avatar({ worker_id: q.worker_id || null, name: q.by || '' }, 'xs'));
    const txt = el('div', 'vw-note-text');
    txt.append(el('b', null, (firstWord(q.by) || 'Somebody') + ' · ' + when(q.at)), el('div', null, q.body || ''));
    const acts = el('div', 'vw-msg-acts'); acts.append(reactRow('chat', q.id, q.reactions)); txt.append(acts);
    b.append(txt);
    return b;
  };
  const answer = a => {
    const r = el('div', 'vw-reply');
    const txt = el('div', 'vw-note-text');
    txt.append(el('b', null, 'AI · ' + when(a.at)), el('div', null, a.body || ''));
    const acts = el('div', 'vw-msg-acts');
    if (a.id) acts.append(reactRow('chat', a.id, a.reactions));
    if (a.id && mayWrite) {
      if (asking.has('more:' + a.id)) acts.append(el('span', 'hint', 'The AI is answering…'));
      else { const mo = el('button', 'btn btn-sm', 'More detail'); mo.title = 'A longer answer, under this one'; mo.onclick = () => moreDetail(a); acts.append(mo); }
    }
    txt.append(acts);
    r.append(g1Face('xs', 'The AI'), txt);
    return r;
  };

  const paint = async () => {
    const my = ++paintSeq;
    const mine = await whoAmI();
    if (my !== paintSeq) return;
    top.textContent = '';
    const s = photo.social || {};
    // the flow: comments and questions in time order, each AI answer under the comment it answers
    const items = (T ? (T.thread || []) : (photo.notes || []).map(n => ({ type: 'note', ...n })))
      .slice().sort((a, b) => (new Date(a.at).getTime() || 0) - (new Date(b.at).getTime() || 0));
    const notes = new Set(items.filter(x => x.type === 'note').map(x => x.id));
    const under = new Map();
    items.forEach(x => { if (x.type === 'ai' && x.note_id && notes.has(x.note_id)) under.set(x.note_id, [...(under.get(x.note_id) || []), x]); });
    const own = ownComment();
    const count = items.length + (own ? 1 : 0);
    top.append(el('div', 'sec-title', count ? `Comments · ${count}` : 'Comments'));
    const list = el('div', 'vw-team-list');
    list.append(aiComment());
    // the verified diagnosis, right under the AI's reading (0250)
    if (s.verified) list.append(verifiedBlock(s.verified));
    if (own) list.append(own);
    const mayVerify = mayWrite && !!T?.may_verify;
    items.forEach(x => {
      if (x.type === 'note') {
        list.append(comment(x, mine, mayVerify));
        (under.get(x.id) || []).forEach(a => list.append(answer(a)));
        if (asking.has(x.id)) { const w = el('div', 'vw-reply wait'); w.append(g1Face('xs', 'The AI'), el('div', 'vw-note-text', 'The AI is answering…')); list.append(w); }
      } else if (x.type === 'question') list.append(question(x));
      else if (!(x.note_id && notes.has(x.note_id))) list.append(answer(x));
    });
    if (!items.length && !own) list.append(el('div', 'hint', T || tried ? 'No comment yet.' : 'Reading the conversation…'));
    top.append(list);
  };
  sec.repaint = () => paint();
  paint();
  read().then(() => paint());

  if (mayWrite) {
    // the box is made once: a note being written lives through every repaint (a reaction, a note deleted, an AI answer)
    const ta = el('textarea', 'vw-note-box'); ta.rows = 2; ta.maxLength = 4000; ta.placeholder = 'Write a comment';
    const risk = riskSelect();
    const add = el('button', 'btn btn-sm btn-primary', 'Post');
    const addAi = el('button', 'btn btn-sm', 'Post + ask the AI');
    const addAsk = el('button', 'btn btn-sm', 'Post + ask someone…');
    let cref = 'hc:' + crypto.randomUUID();       // one id for this note: a retry after a lost answer is the same note
    const post = async (btn, then) => {
      if (!ta.value.trim()) { toast('Write the comment first', 'bad'); return; }
      const label = btn.textContent;
      busy(btn, true, 'Posting…');
      try {
        const mine = await whoAmI();
        const r = await rpc('dg_add_note', { p: { kind, ref_id: photo.id, body: ta.value, level: risk.value, client_ref: cref } });
        const n = { id: r.id, body: ta.value.trim(), level: risk.value, by: 'You', by_user: mine, at: new Date().toISOString() };
        photo.notes = [...(photo.notes || []), n];
        if (T) T.thread = [...(T.thread || []), { type: 'note', ...n }];
        ta.value = ''; risk.value = risk.dataset.level = 'yellow'; cref = 'hc:' + crypto.randomUUID();
        busy(btn, false, label);
        if (then === 'ai') { await askAi(n); return; }
        await changed();
        if (then === 'ask') askOpinion(photo, kind, ctx, n.body);
        else toast('Posted', 'ok');
      } catch (e) { busy(btn, false, label); toast(errWord(e), 'bad'); }
    };
    add.onclick = () => post(add);
    addAi.onclick = () => post(addAi, 'ai');
    addAsk.onclick = () => post(addAsk, 'ask');
    const ask = el('button', 'btn btn-sm', 'Ask someone…');
    ask.onclick = () => askOpinion(photo, kind, ctx);
    const acts = el('div', 'vw-note-acts'); acts.append(risk, add, addAi, addAsk, ask);
    sec.append(ta, acts);
  }
  return sec;
}
async function askOpinion(photo, kind, ctx, question = '') {
  const d = drawer('Ask for an opinion', 'They find this photo with all its data in their list, in Naked Brain and Naked Heart');
  d.body.append(el('div', 'hint', 'Reading the team…'));
  let people = [];
  try { people = await rpc('dg_people', { p_farm: ctx.farm.id }); } catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', errWord(e))); return; }
  const mine = await whoAmI();
  d.body.textContent = '';
  const box = el('div', 'vw-ask-people');
  const picks = new Set();
  people.filter(x => x.user_id !== mine).forEach(x => {
    const lab = el('label', 'vw-ask-person'); const cb = el('input'); cb.type = 'checkbox';
    cb.onchange = () => { if (cb.checked) picks.add(x.user_id); else picks.delete(x.user_id); };
    lab.append(cb, avatar({ worker_id: x.worker_id || null, name: x.name }, 'xs'), el('span', null, x.name));
    box.append(lab);
  });
  const q = el('textarea', 'vw-note-box'); q.rows = 3; q.maxLength = 1000; q.placeholder = 'Your question (optional)'; q.value = question || '';
  const go = el('button', 'btn btn-primary', 'Send');
  go.onclick = async () => {
    if (!picks.size) { toast('Choose at least one person', 'bad'); return; }
    busy(go, true, 'Sending…');
    try {
      const r = await rpc('dg_ask_opinion', { p: { kind, ref_id: photo.id, to: [...picks], question: q.value } });
      toast(r.asked ? `Asked ${r.asked} ${r.asked === 1 ? 'person' : 'people'}` : 'Already asked', 'ok'); d.close();
    } catch (e) { busy(go, false, 'Send'); toast(errWord(e), 'bad'); }
  };
  d.body.append(box, q, go);
}

// the photos waiting for my opinion, with an answer box (0.7.269): opened from the Scouting page
export async function openOpinions(farm, onChange) {
  const d = drawer('Asked for your opinion', 'Photos the team sent you, newest first');
  const paint = async () => {
    d.body.textContent = ''; d.body.append(el('div', 'hint', 'Reading…'));
    let rows = [];
    try { rows = await rpc('dg_my_requests', { p_farm: farm.id }); } catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', errWord(e))); return; }
    d.body.textContent = '';
    if (!rows.length) { d.body.append(el('div', 'hint', 'Nothing waiting for your opinion.')); return; }
    rows.forEach(q => {
      const card = el('div', 'vw-req');
      const ph = q.photo || {};
      const img = el('img', 'vw-req-img'); img.alt = '';
      if (ph.photo_path) signedUrl(ph.photo_path).then(u => { if (u) { img.src = u; img.onclick = () => window.open(u, '_blank', 'noopener'); } });
      const info = el('div', 'vw-req-info');
      info.append(el('b', null, [q.kind === 'trap' ? `Trap ${ph.trap || ''}${ph.side ? ' (' + ph.side + ')' : ''}` : 'Plant photo', ph.zone, ph.taken_at ? day(ph.taken_at) : null].filter(Boolean).join(' · ')),
                  el('div', 'hint', `From ${q.by || 'somebody'} · ${day(q.at)}`));
      if (q.question) info.append(el('div', null, '"' + q.question + '"'));
      if (ph.note) info.append(el('div', 'hint', 'Note: ' + ph.note));
      const ta = el('textarea', 'vw-note-box'); ta.rows = 2; ta.placeholder = 'Your opinion';
      const risk = riskSelect();
      const ans = el('button', 'btn btn-sm btn-primary', 'Answer');
      const cref = 'hc:' + crypto.randomUUID();
      ans.onclick = async () => {
        if (!ta.value.trim()) { toast('Write your opinion first', 'bad'); return; }
        busy(ans, true, 'Sending…');
        try {
          await rpc('dg_add_note', { p: { kind: q.kind, ref_id: q.ref_id, body: ta.value, level: risk.value, request_id: q.id, client_ref: cref } });
          toast('Answer added to the photo', 'ok'); onChange?.(); paint();
        } catch (e) { busy(ans, false, 'Answer'); toast(errWord(e), 'bad'); }
      };
      const dis = el('button', 'btn btn-sm', 'Dismiss');
      dis.onclick = async () => { try { await rpc('dg_dismiss_request', { p_id: q.id }); paint(); onChange?.(); } catch (e) { toast(errWord(e), 'bad'); } };
      const acts = el('div', 'vw-note-acts'); acts.append(risk, ans, dis);
      info.append(ta, acts);
      card.append(img, info);
      d.body.append(card);
    });
  };
  paint();
}

export function openViewer(ctx) {
  const { photo, catalog = [], mayWrite = true } = ctx;
  const root = el('div', 'viewer');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', photoTitle(photo));
  const stage = el('div', 'vw-stage');
  const panel = el('aside', 'vw-panel');
  root.append(stage, panel);
  document.body.append(root);
  // the browser's Back (another page) closes it too: it used to stay over the next page with its key handler
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); window.removeEventListener('hashchange', close); };
  window.addEventListener('hashchange', close);

  // ── a pane: one photo with its zoom ──
  const panes = [];
  const view = { scale: 0, x: 0, y: 0, fit: true };          // shared by the panes when comparing
  const makePane = p => {
    const pane = el('div', 'vw-pane');
    const img = el('img'); img.alt = photoTitle(p); img.draggable = false;
    img.src = p.photo_data || '';
    const cap = el('div', 'vw-cap', `${photoTitle(p)} · ${day(p.taken_at)}`);
    const state = el('span', 'vw-state', p.photo_path ? 'loading the full photo…' : 'phone copy');
    cap.append(' ', state);
    pane.append(img, cap);
    const o = { pane, img, p, nat: [0, 0] };
    img.onload = () => { o.nat = [img.naturalWidth, img.naturalHeight]; if (view.fit) fitAll(); else apply(); };
    fullPhotoUrl(p.photo_path).then(u => {
      if (!u) { state.textContent = p.photo_path ? 'full photo not reachable' : 'phone copy'; return; }
      const full = new Image();
      full.onload = () => { img.src = u; state.textContent = `${full.naturalWidth} × ${full.naturalHeight}`; };
      full.onerror = () => { state.textContent = 'full photo not reachable'; };
      full.src = u;
    });
    // zoom and pan
    pane.addEventListener('wheel', e => {
      e.preventDefault();
      const r = pane.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015), o);
    }, { passive: false });
    const pts = new Map(); let last = null, dist0 = 0, scale0 = 1;
    pane.addEventListener('pointerdown', e => { pane.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY];
      if (pts.size === 2) { const [a, b] = [...pts.values()]; dist0 = Math.hypot(a[0] - b[0], a[1] - b[1]); scale0 = view.scale; } });
    pane.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const r = pane.getBoundingClientRect();
        const cx = (a[0] + b[0]) / 2 - r.left, cy = (a[1] + b[1]) / 2 - r.top;
        zoomAt(cx, cy, (scale0 * (d / (dist0 || d))) / view.scale, o);
      } else if (last) {
        view.x += e.clientX - last[0]; view.y += e.clientY - last[1]; view.fit = false; last = [e.clientX, e.clientY]; apply();
      }
    });
    const up = e => { pts.delete(e.pointerId); last = pts.size ? [...pts.values()][0] : null; };
    pane.addEventListener('pointerup', up); pane.addEventListener('pointercancel', up);
    pane.addEventListener('dblclick', e => { const r = pane.getBoundingClientRect(); view.scale === 1 && !view.fit ? fitAll() : oneToOne(e.clientX - r.left, e.clientY - r.top, o); });
    panes.push(o);
    stage.append(pane);
    return o;
  };
  const apply = () => panes.forEach(o => { o.img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`; });
  const fitAll = () => {
    const o = panes[0]; if (!o || !o.nat[0]) return;
    const r = o.pane.getBoundingClientRect();
    view.scale = Math.min(r.width / o.nat[0], r.height / o.nat[1]);
    view.x = (r.width - o.nat[0] * view.scale) / 2; view.y = (r.height - o.nat[1] * view.scale) / 2; view.fit = true;
    apply(); paintZoom();
  };
  const zoomAt = (cx, cy, k, o) => {
    if (!o.nat[0]) return;
    const r = o.pane.getBoundingClientRect();
    const fitScale = Math.min(r.width / o.nat[0], r.height / o.nat[1]);
    const next = Math.max(fitScale * 0.5, Math.min(8, view.scale * k));
    const kk = next / view.scale;
    view.x = cx - (cx - view.x) * kk; view.y = cy - (cy - view.y) * kk; view.scale = next; view.fit = false;
    apply(); paintZoom();
  };
  const oneToOne = (cx, cy, o) => zoomAt(cx ?? o.pane.clientWidth / 2, cy ?? o.pane.clientHeight / 2, 1 / view.scale, o);
  const zoomLabel = el('span', 'vw-zoom');
  const paintZoom = () => { zoomLabel.textContent = view.fit ? 'fit' : Math.round(view.scale * 100) + ' %'; };
  const onKey = e => {
    if (e.key === 'Escape') {
      // a window opened from the viewer is on top: Escape is its own (ui.js drawer); else it closes the viewer,
      // before a drawer underneath the viewer takes it (0.7.162 — the capture phase, see addEventListener below)
      if ([...document.querySelectorAll('.drawer')].some(dr => root.compareDocumentPosition(dr) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      // a question half typed in the chat: Escape leaves the box first, a second Escape closes the viewer
      if (e.target?.tagName === 'TEXTAREA' && e.target.value.trim()) { e.stopImmediatePropagation(); e.target.blur(); return; }
      e.stopImmediatePropagation(); close();
    }
    else if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;   // typing (the chat, 0195) is not a zoom key
    else if (e.key === '+' || e.key === '=') zoomAt(panes[0].pane.clientWidth / 2, panes[0].pane.clientHeight / 2, 1.25, panes[0]);
    else if (e.key === '-') zoomAt(panes[0].pane.clientWidth / 2, panes[0].pane.clientHeight / 2, 0.8, panes[0]);
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ctx.gallery) {
      // a window opened from the viewer is on top: the arrows are not the gallery's then
      if ([...document.querySelectorAll('.drawer')].some(dr => root.compareDocumentPosition(dr) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1);
    }
    else if (e.key === '0') fitAll();
    else if (e.key === '1') oneToOne(null, null, panes[0]);
  };
  document.addEventListener('keydown', onKey, true);
  // the gallery (0.7.264): the photos of the same block, one after the other — ‹ › on the picture, the arrow keys, a swipe
  // when the photo is not zoomed; the panel says where in the block this one is
  const step = d => {
    const g = ctx.gallery; if (!g) return;
    const i = g.index + d;
    if (i < 0 || i >= g.count) return;
    close(); g.open(i);
  };
  if (ctx.gallery && ctx.gallery.count > 1) {
    const nav = (cls, label, d) => {
      const b = el('button', 'vw-nav ' + cls, label);
      b.type = 'button'; b.setAttribute('aria-label', d < 0 ? 'The photo before' : 'The next photo');
      b.disabled = ctx.gallery.index + d < 0 || ctx.gallery.index + d >= ctx.gallery.count;
      b.onclick = e => { e.stopPropagation(); step(d); };
      return b;
    };
    stage.append(nav('prev', '‹', -1), nav('next', '›', 1));
    let x0 = null;
    stage.addEventListener('touchstart', e => { x0 = e.touches.length === 1 && view.fit ? e.touches[0].clientX : null; }, { passive: true });
    stage.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  const onResize = () => { if (view.fit) fitAll(); };   // removed on close: it kept every viewer and its photo alive
  window.addEventListener('resize', onResize);
  const main = makePane(photo);

  // ── the panel ──
  const head = el('div', 'vw-head');
  const sub = el('div', 'hint', `${when(photo.taken_at)}${photo.zone ? ' · ' + photo.zone : ''}`);
  if (ctx.gallery) sub.append(el('span', 'vw-gal', ` · ${ctx.gallery.label || 'Photos'} ${ctx.gallery.index + 1} of ${ctx.gallery.count}`));
  head.append(el('h2', null, photoTitle(photo)), sub);
  // added by an extra scouting (0204), beside the zone's planned one
  if (photo.extra) {
    const xt = el('span', 'pill pd-extra', 'extra' + (photo.by ? ' · ' + String(photo.by).trim().split(/\s+/)[0] : ''));
    xt.title = `Added by an extra scouting${photo.by ? ' — ' + photo.by : ''}, beside the zone's planned scouting`;
    head.append(xt);
  }
  const x = el('button', 'btn btn-ghost btn-sm', '✕'); x.setAttribute('aria-label', 'Close'); x.onclick = close;
  head.append(x);
  const tools = el('div', 'vw-tools');
  const b = (label, f, title) => { const k = el('button', 'btn btn-sm', label); k.onclick = f; if (title) k.title = title; return k; };
  tools.append(b('−', () => zoomAt(main.pane.clientWidth / 2, main.pane.clientHeight / 2, 0.8, main)), zoomLabel,
               b('+', () => zoomAt(main.pane.clientWidth / 2, main.pane.clientHeight / 2, 1.25, main)),
               b('Fit', fitAll, 'the whole photo (0)'), b('1:1', () => oneToOne(null, null, main), 'one pixel of the photo per pixel (1)'));
  panel.append(head, tools, el('div', 'hint', 'Wheel or pinch to zoom, drag to move. Both photos move together when comparing.'));

  // the facts
  const facts = el('div', 'facts');
  const fact = (k, v) => { if (v == null || v === '') return; const f = el('div', 'fact'); f.append(el('span', 'fact-k', k), el('span', 'fact-v', v)); facts.append(f); };
  if (photo.kind === 'trap') {
    // the figure is the AI's count of the card or one typed by a person (0.7.278, 0260: no phone count shown anywhere);
    // a card waiting for the AI has none yet, and one the AI could not count needs a person's
    const aiWord = m => /opus/.test(m || '') ? 'Opus' : /haiku/.test(m || '') ? 'Haiku' : /sonnet/.test(m || '') ? 'Sonnet' : 'the AI';
    const counting = ['queued', 'running'].includes(photo.ai_count_status);
    const needs = photo.total == null && !counting;
    fact('Counted', photo.total == null ? (counting ? 'the AI is counting the card' : 'needs a count')
      : num(photo.total, 0) + (photo.corrected ? ' — typed by a person'
        : photo.ai_count_status === 'done' && photo.ai_count === photo.total ? ` — counted by the AI (${aiWord(photo.ai_count_model)})` : ''));
    if (photo.corrected && photo.ai_count != null && photo.ai_count !== photo.total) fact('The AI counted', num(photo.ai_count, 0));
    if (needs && mayWrite) {
      // the count typed here is the person's figure; the rates follow (correct_trap_reading → dg_edit_item)
      const box = el('div', 'fact'), inp = el('input'); inp.type = 'number'; inp.min = '0'; inp.style.width = '80px';
      const save = el('button', 'btn btn-sm btn-primary', 'Save the count');
      save.onclick = async () => {
        const n = parseInt(inp.value, 10);
        if (!(n >= 0)) { toast('Type the number of insects', 'bad'); return; }
        busy(save, true, 'Saving…');
        try { await rpc('correct_trap_reading', { p_id: photo.id, p_total: n }); Object.assign(photo, { total: n, corrected: true }); toast('Count saved', 'ok'); ctx.onChange?.(photo); }
        catch (e) { toast(errWord(e), 'bad'); }
        busy(save, false, 'Save the count');
      };
      box.append(el('span', 'fact-k', 'Type it'), inp, save);
      facts.append(box);
    }
    if (photo.replaced) fact('Trap', 'replaced on this round');
    if (photo.installed_at) fact('Hung since', day(photo.installed_at));
  } else {
    fact('Crop', photo.crop || '—');
    fact('Part', partLabel(photo.part));
  }
  // a manager counts a trap photo again with the AI (trap-count refuses anybody else); the figure follows unless typed
  if (photo.kind === 'trap' && photo.photo_path && mayWrite) {
    const again = el('button', 'btn btn-sm', 'Count again with the AI');
    again.title = 'Haiku counts the card; Opus again when there are more than 30 — a figure typed by a person stays';
    again.onclick = async () => {
      busy(again, true, 'Counting…');
      try {
        const r = await fn('trap-count', { reading_id: photo.id });
        if (r?.ok === false) throw new Error(r.error || 'not counted');
        Object.assign(photo, { ai_count: r?.reading?.count ?? photo.ai_count, ai_count_status: 'done',
                               total: r?.reading?.total ?? photo.total });
        toast(`The AI counted ${r?.reading?.count ?? '?'}${photo.corrected ? ' — the typed figure stays' : ''}`, 'ok');
        ctx.onChange?.(photo);                       // the page underneath reads again and shows the new figure
      } catch (e) {
        const w = errWord(e);
        toast(/^403|manager/i.test(String(e?.message || '')) ? 'Only a farm manager or the agronomist counts a trap again'
            : /not queued|409/i.test(String(e?.message || '')) ? 'The AI is counting this photo right now — look again in a minute' : w, 'bad');
      }
      busy(again, false, 'Count again with the AI');
    };
    facts.append(again);
  }
  panel.append(facts);

  // the person's note, its own section, changed here (0.7.263, 0241; owner 15 Oct 2026: "when I click on the picture I
  // have to see the human note as well and have the possibility to modify it"): the text and its risk colour, by the
  // person who wrote it, a manager or the agronomist (the server says who may)
  // since 0.7.279 the note itself is the second comment of the flow (teamNotes), with its Edit: this section is its editor,
  // and "Add a note" when the photo has none
  const secNote = el('div', 'vw-note-sec');
  let teamSec = null;
  const paintNote = () => {
    secNote.textContent = '';
    teamSec?.repaint?.();
    const inFlow = photo.id && (photo.kind === 'observation' || photo.kind === 'trap');
    if (!inFlow) {
      secNote.append(el('div', 'sec-title', 'Note'));
      const chip = noteChip(photo);
      if (chip) { const box = el('div', 'vw-chips'); box.append(chip); secNote.append(box); }
      else if (photo.note) secNote.append(el('div', 'vw-note-plain', photo.note));
      else secNote.append(el('div', 'hint', 'No note on this photo.'));
    }
    if (mayWrite && photo.id && (!inFlow || !photo.note)) {
      const ed = el('button', 'btn btn-sm', photo.note ? 'Edit the note' : 'Add the note of who took the photo');
      ed.onclick = editNote;
      secNote.append(ed);
    }
  };
  const editNote = () => {
    secNote.textContent = '';
    secNote.append(el('div', 'sec-title', 'Note'));
    const ta = el('textarea', 'vw-note-box'); ta.rows = 3; ta.maxLength = 2000; ta.value = photo.note || '';
    ta.placeholder = 'What you see on this photo';
    const risk = el('select', 'vw-note-risk');
    [['green', 'Green · no risk'], ['yellow', 'Yellow · low risk'], ['red', 'Red · high risk']].forEach(([v, t]) => {
      const o = el('option', null, t); o.value = v; risk.append(o);
    });
    risk.value = RISK_WORD[photo.note_level] ? photo.note_level : 'yellow';
    const tint = () => { risk.dataset.level = risk.value; };
    risk.onchange = tint; tint();
    const save = el('button', 'btn btn-sm btn-primary', 'Save');
    const cancel = el('button', 'btn btn-sm', 'Cancel');
    cancel.onclick = paintNote;
    save.onclick = async () => {
      busy(save, true, 'Saving…');
      try {
        const a = await rpc('edit_photo_note', { p_kind: photo.kind === 'trap' ? 'trap' : 'observation', p_id: photo.id,
                                                 p_note: ta.value, p_level: risk.value });
        photo.note = a.note; photo.note_level = a.note_level;
        paintNote(); toast(a.note ? 'Note saved' : 'Note removed', 'ok'); ctx.onChange?.(photo);
      } catch (e) { busy(save, false, 'Save'); toast(String(e.message || e).replace(/^\d+ /, ''), 'bad'); }
    };
    const acts = el('div', 'vw-note-acts');
    acts.append(risk, save, cancel);
    secNote.append(ta, acts);
    ta.focus();
  };
  paintNote();
  panel.append(secNote);
  // the team's notes on the photo, oldest first, typed or voice; a note added here; somebody asked for an opinion
  // (0.7.269, 0246–0247, Digital scouting: "always possible to add new notes to all pics", "share a pic … asking
  // personal opinion"). A person deletes their own note on its day; the server says who may. Since 0.7.271 (0250) the
  // whole post: the verified diagnosis, the reasons to disagree, the AI's answers under their comment, Ask the AI, Verify.
  // An answer asked from there is in the chat below too: the chat is read again, unless a question of its own is on its way.
  if (photo.id && (photo.kind === 'observation' || photo.kind === 'trap')) panel.append(teamSec = teamNotes(photo, ctx, mayWrite, () => {
    if (chat && !asking) rpc('photo_chat', { p_kind: photo.kind, p_id: photo.id }).then(j => { if (!asking) { chat = j; paintChat(); } }).catch(() => {});
  }, { editNote: () => { editNote(); secNote.scrollIntoView({ block: 'nearest' }); },
       showAI: () => secAI.scrollIntoView({ behavior: 'smooth', block: 'start' }) }));
  paintNote();

  // the person's tags
  const secTags = el('div');
  const paintTags = () => {
    secTags.textContent = '';
    secTags.append(el('div', 'sec-title', 'Tags'));
    const list = el('div', 'vw-chips');
    const tags = photo.tags || [];
    if (!tags.length) list.append(el('span', 'hint', 'No tag yet.'));
    tags.forEach((t, i) => {
      const chip = el('span', 'vw-tag r-' + riskOf(t.severity, t.kind), `${t.label || t.code} · ${SEV[t.severity ?? 1]}`);
      if (mayWrite) { const rm = el('button', 'vw-x', '×'); rm.title = 'Remove'; rm.onclick = () => saveTags(tags.filter((_, j) => j !== i)); chip.append(rm); }
      list.append(chip);
    });
    secTags.append(list);
    if (mayWrite && catalog.length) {
      const row = el('div', 'row'); row.style.alignItems = 'center';
      const byKind = ['pest', 'disease', 'disorder', 'beneficial'];
      const opts = [['', 'Add a tag…']];
      byKind.forEach(k => catalog.filter(c => c.kind === k).forEach(c => opts.push([c.code, `${k}: ${c.label}`])));
      const pick = selectBox(opts, '');
      const sev = selectBox([[1, 'slight'], [2, 'clear'], [3, 'severe'], [0, 'none']], 1);
      const add = el('button', 'btn btn-sm', 'Add');
      add.onclick = () => { if (!pick.value) return; saveTags([...tags, { code: pick.value, severity: Number(sev.value) }]); };
      row.append(pick, sev, add);
      secTags.append(row);
    }
  };
  const saveTags = async list => {
    try {
      const saved = await rpc('tag_photo', { p_kind: photo.kind, p_id: photo.id, p_tags: list });
      photo.tags = saved; paintTags(); ctx.onChange?.(photo);
    } catch (e) { toast(e.message, 'bad'); }
  };
  paintTags();
  panel.append(secTags);

  // the AI
  const secAI = el('div');
  const paintAI = () => {
    secAI.textContent = '';
    secAI.append(el('div', 'sec-title', 'The AI'));
    const st = photo.ai_status;
    if (photo.kind === 'observation') {
      if (st === 'done' && photo.ai) {
        const a = photo.ai;
        if (a.quality && a.quality !== 'ok') secAI.append(el('div', 'note warn', 'The photo is ' + a.quality + ' — the reading is less sure.'));
        const f = byGravity(a.findings || []).map(o => o.x);          // the most serious first (0.7.275)
        if (!f.length) secAI.append(el('div', 'vw-ai-line', a.healthy === false ? 'Nothing it could name.' : 'Looks healthy.'));
        f.forEach(x => {
          const line = el('div', 'vw-ai-line');
          line.append(el('b', null, x.name || x.code), ` · ${x.kind} · ${SEV[x.severity ?? 0]}` +
            (x.coverage_pct ? ` · ${num(x.coverage_pct, 0)} % of the ${partLabel(photo.part)}` : '') +
            (x.confidence != null ? ` · ${Math.round(x.confidence * 100)} % sure` : ''));
          if (x.evidence) line.append(el('div', 'hint', x.evidence));
          secAI.append(line);
        });
        if (a.summary) secAI.append(el('p', 'vw-ai-notes', a.summary));
        if (a.recommendation) secAI.append(el('p', 'vw-ai-notes', a.recommendation));
        secAI.append(el('div', 'hint', [photo.ai_model, photo.ai_at ? when(photo.ai_at) : null].filter(Boolean).join(' · ')));
      } else if (st === 'queued') secAI.append(el('div', 'hint', 'Asked — waiting for the answer.'));
      else if (st === 'failed') secAI.append(el('div', 'note bad', 'The AI could not answer: ' + (photo.ai_error || 'unknown error')));
      else secAI.append(el('div', 'hint', 'Not asked yet.'));
    } else {
      if (st === 'done') {
        const list = insectsByGravity(Array.isArray(photo.species) ? photo.species : []);      // the pests first (0.7.275)
        if (!list.length) secAI.append(el('div', 'vw-ai-line', 'Nothing it could name.'));
        list.forEach(x => {
          const line = el('div', 'vw-ai-line');
          line.append(el('b', null, x.common || x.name), ` · ${x.name} · ${num(x.count, 0)}` + (x.confidence != null ? ` · ${Math.round(x.confidence * 100)} % sure` : '') + (x.beneficial ? ' · beneficial' : ''));
          secAI.append(line);
        });
        if (photo.ai_total != null) secAI.append(el('div', 'hint', `${num(photo.ai_total, 0)} insects in all` + (photo.ai_quality && photo.ai_quality !== 'ok' ? ' · photo ' + photo.ai_quality.replace('_', ' ') : '')));
        if (photo.ai_notes) secAI.append(el('p', 'vw-ai-notes', photo.ai_notes));
      } else if (st === 'queued') secAI.append(el('div', 'hint', 'Asked — waiting for the answer.'));
      else if (st === 'failed') secAI.append(el('div', 'note bad', 'The AI could not answer: ' + (photo.ai_error || 'unknown error')));
      else secAI.append(el('div', 'hint', 'Not asked yet.'));
    }
    if (mayWrite) {
      const ask = el('button', 'btn btn-primary btn-sm', st === 'done' ? 'Ask the AI again' : 'Ask the AI');
      ask.title = 'Send this one photo to Claude (Anthropic) — about half a minute';
      ask.onclick = async () => {
        if (ctx.aiReady === false) { toast('Paste an Anthropic API key in Settings › Integrations first', 'bad'); return; }
        busy(ask, true, 'Asking… about half a minute');
        try {
          let res;
          if (photo.kind === 'observation') {
            await rpc('identify_observation', { p_id: photo.id });
            res = await fn('scout-photo', { observation_id: photo.id });
            if (!res?.ok) throw new Error(res?.error || 'no answer');
            Object.assign(photo, res.observation);
          } else {
            await rpc('identify_trap_species', { p_id: photo.id, p_force: true });
            res = await fn('trap-species', { reading_id: photo.id });
            if (!res?.ok) throw new Error(res?.error || 'no answer');
            Object.assign(photo, res.reading);
          }
          paintAI(); toast('The AI answered', 'ok'); ctx.onChange?.(photo);
        } catch (e) { paintAI(); toast(e.message, 'bad'); }
      };
      secAI.append(ask);
      // 0194: opened from "The AI found something" — looked at, nothing to do
      if (photo.ai_found && !photo.ai_seen) {
        const seen = el('button', 'btn btn-sm', 'Seen — nothing to do');
        seen.title = 'It leaves the list of photos where the AI found something';
        seen.style.marginLeft = '6px';
        seen.onclick = async () => {
          busy(seen, true, '…');
          try { await rpc('mark_photo_seen', { p_id: photo.id, p_seen: true }); photo.ai_seen = true; paintAI(); toast('Marked seen', 'ok'); ctx.onChange?.(photo); }
          catch (e) { busy(seen, false, 'Seen — nothing to do'); toast(e.message, 'bad'); }
        };
        secAI.append(seen);
      }
    }
  };
  paintAI();
  panel.append(secAI);

  // ── the chat about this photo (0195): the farm's one conversation, kept in the database ──
  // The AI answers looking at the photo, its record and the zone's month. It changes nothing:
  // a card it proposes is run here, as the person, only on "Do it".
  const secChat = el('div', 'vw-chat');
  let chat = null, asking = false;
  const CARD = {
    tag_photo: a => `Tag: ${a.label || a.code} · ${SEV[a.severity ?? 1]}`,
    add_to_case: a => `Add to the case “${a.case_title || 'open case'}” · ${SEV[a.severity ?? 1]}`,
    new_case: a => `Open a case${a.label ? ': ' + a.label : ''} · ${SEV[a.severity ?? 1]}`,
    mark_seen: () => 'Mark seen — nothing to do',
  };
  const runCard = async (m, i, a) => {
    if (a.type === 'tag_photo') {
      const tags = (photo.tags || []).filter(t => t.code !== a.code).map(t => ({ code: t.code, severity: t.severity, note: t.note }));
      photo.tags = await rpc('tag_photo', { p_kind: photo.kind, p_id: photo.id, p_tags: [...tags, { code: a.code, severity: a.severity }] });
      paintTags();
    } else if (a.type === 'add_to_case') {
      await rpc('add_case_point', { p_case: a.case_id, p_kind: photo.kind, p_ref: photo.id, p_severity: a.severity, p_count: null, p_note: null });
      paintCases();
    } else if (a.type === 'mark_seen') {
      await rpc('mark_photo_seen', { p_id: photo.id, p_seen: true }); photo.ai_seen = true; paintAI();
    } else if (a.type === 'new_case') {
      // the form opens filled in; the person saves it — only then is the card done
      await new Promise((resolve, reject) => newCase({ farm: ctx.farm, zone_id: ctx.zoneId || photo.zone_id || null,
        crop_id: photo.crop_id || ctx.cropId || null, crops: ctx.crops || [], from_kind: photo.kind, from_id: photo.id,
        code: a.code, severity: a.severity || 1, onDone: () => { paintCases(); resolve(); }, onCancel: () => reject(new Error('cancelled')) })
        ?.catch?.(reject));                // the catalogue failing to load used to leave the button spinning
    } else throw new Error('unknown card');
    m.actions = await rpc('photo_chat_action', { p_message: m.id, p_index: i, p_status: 'done' });
    ctx.onChange?.(photo);
  };
  const cardEl = (m, i, a) => {
    const c = el('div', 'vw-card ' + (a.status || 'proposed'));
    c.append(el('b', null, (CARD[a.type] || (() => a.type))(a)));
    if (a.summary) c.append(el('div', 'hint', a.summary));
    if (a.status === 'done' || a.status === 'dismissed') {
      c.append(el('div', 'hint', (a.status === 'done' ? '✓ Done' : 'Dismissed') + (a.by ? ' by ' + a.by : '') + (a.at ? ' · ' + when(a.at) : '')));
    } else if (mayWrite && chat?.may_ask) {
      const row = el('div', 'row');
      const go = el('button', 'btn btn-sm btn-primary', a.type === 'new_case' ? 'Open the form…' : 'Do it');
      const no = el('button', 'btn btn-sm btn-ghost', 'Dismiss');
      go.onclick = async () => {
        busy(go, true, '…');
        try { await runCard(m, i, a); paintChat(); toast('Done', 'ok'); }
        catch (e) { busy(go, false, a.type === 'new_case' ? 'Open the form…' : 'Do it'); if (e.message !== 'cancelled') toast(e.message, 'bad'); }
      };
      no.onclick = async () => {
        try { m.actions = await rpc('photo_chat_action', { p_message: m.id, p_index: i, p_status: 'dismissed' }); paintChat(); }
        catch (e) { toast(e.message, 'bad'); }
      };
      row.append(go, no);
      c.append(row);
    }
    return c;
  };
  const paintChat = (pending) => {
    secChat.textContent = '';
    if (!chat) return;
    secChat.append(el('div', 'sec-title', 'Chat about this photo'));
    const list = el('div', 'vw-msgs');
    const msgs = chat.messages || [];
    if (!msgs.length && !pending) list.append(el('div', 'hint', chat.may_ask
      ? 'Ask the AI anything about this photo: what it shows, how sure it is, what to check next. Everybody on the farm sees this conversation.'
      : 'Nobody has asked about this photo yet.'));
    msgs.forEach(m => {
      const b = el('div', 'vw-msg ' + m.role);
      b.append(el('div', 'vw-msg-who', m.role === 'user' ? `${m.mine ? 'You' : (m.author || 'Somebody')} · ${when(m.at)}` : `AI · ${when(m.at)}`));
      b.append(el('div', 'vw-msg-text', m.content));
      (m.actions || []).forEach((a, i) => b.append(cardEl(m, i, a)));
      list.append(b);
    });
    if (pending) {
      const q = el('div', 'vw-msg user'); q.append(el('div', 'vw-msg-who', 'You · now'), el('div', 'vw-msg-text', pending));
      const w = el('div', 'vw-msg assistant'); w.append(el('div', 'vw-msg-who', 'AI'), el('div', 'vw-msg-text hint', 'Looking at the photo… about half a minute'));
      list.append(q, w);
    }
    secChat.append(list);
    if (chat.may_ask && mayWrite) {
      const box = el('textarea', 'vw-ask'); box.rows = 2; box.maxLength = 2000;
      box.placeholder = 'Ask about this photo…'; box.setAttribute('aria-label', 'Ask about this photo');
      const send = el('button', 'btn btn-primary btn-sm', 'Send');
      box.disabled = send.disabled = asking;
      const ask = async () => {
        const text = box.value.trim();
        if (!text || asking) return;
        if (chat.ai_ready === false) { toast('Paste an Anthropic API key in Settings › Integrations first', 'bad'); return; }
        asking = true; paintChat(text);
        try {
          const res = await fn('photo-chat', { kind: photo.kind, id: photo.id, message: text });
          if (!res?.ok) throw new Error(res?.error || 'no answer');
          chat = await rpc('photo_chat', { p_kind: photo.kind, p_id: photo.id });
          asking = false; paintChat();
        } catch (e) {
          asking = false; paintChat();
          const again = secChat.querySelector('.vw-ask'); if (again) again.value = text;   // the question is not lost
          toast('The AI did not answer: ' + String(e.message || e).slice(0, 160), 'bad');
        }
      };
      send.onclick = ask;
      box.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
      const row = el('div', 'vw-ask-row'); row.append(box, send);
      secChat.append(row);
    }
    list.scrollTop = list.scrollHeight;
  };
  if (photo.id && (photo.kind === 'observation' || photo.kind === 'trap')) {
    panel.append(secChat);
    // a console published before migration 0195 has no chat: the section stays empty
    rpc('photo_chat', { p_kind: photo.kind, p_id: photo.id }).then(j => { chat = j; paintChat(); }).catch(() => {});
  }

  // the cases (0097): add this photo to an open case of the zone, or open one from it
  const secCase = el('div');
  let casesSeq = 0;                 // two paints in flight used to list the cases twice
  const paintCases = async () => {
    const my = ++casesSeq;
    let list = [];
    try { list = ctx.openCases ? await ctx.openCases() : []; } catch { list = []; }
    if (my !== casesSeq) return;
    secCase.textContent = '';
    secCase.append(el('div', 'sec-title', 'Cases'));
    const firstCode = (photo.tags || [])[0]?.code || (photo.ai?.findings || [])[0]?.code || null;
    const firstSev = (photo.tags || [])[0]?.severity ?? (photo.ai?.findings || [])[0]?.severity ?? 1;
    if (!list.length) secCase.append(el('div', 'hint', 'No open case in this zone.'));
    list.forEach(c => {
      const row = el('div', 'vw-case');
      const name = el('button', 'linkish', c.title); name.onclick = () => openCase(c.id, ctx.onChange, ctx.farm);
      row.append(name);
      if (mayWrite) {
        const sev = selectBox([[1, 'slight'], [2, 'clear'], [3, 'severe'], [0, 'none left']], firstSev || 1);
        const add = el('button', 'btn btn-sm', 'Add to this case');
        add.onclick = async () => {
          busy(add, true, '…');
          try {
            await rpc('add_case_point', { p_case: c.id, p_kind: photo.kind, p_ref: photo.id, p_severity: Number(sev.value), p_count: null, p_note: null });
            busy(add, false); add.textContent = 'Added ✓';   // busy() puts the first label back: the tick is written after it
            add.disabled = true;                              // once a photo: a second press put a second point on the curve
            toast('Added to the case — it is on its curve', 'ok'); ctx.onChange?.(photo);
          } catch (e) { busy(add, false, 'Add to this case'); toast(e.message, 'bad'); }
        };
        row.append(sev, add);
      }
      secCase.append(row);
    });
    if (mayWrite) {
      const open = el('button', 'btn btn-sm', 'Open a case from this photo…');
      open.onclick = () => newCase({ farm: ctx.farm, zone_id: ctx.zoneId || null, crop_id: photo.crop_id || ctx.cropId || null, crops: ctx.crops || [],
        from_kind: photo.kind, from_id: photo.id, code: firstCode, severity: firstSev || 1,
        onDone: () => { paintCases(); ctx.onChange?.(photo); } });
      secCase.append(open);
    }
  };
  if (photo.id) { paintCases(); panel.append(secCase); }

  // compare with another photo of the same zone
  const secCmp = el('div');
  secCmp.append(el('div', 'sec-title', 'Compare'));
  const cmpBtn = el('button', 'btn btn-sm', 'Compare with…');
  const cmpList = el('div', 'vw-cmp'); cmpList.hidden = true;
  let second = null;
  const closeCmp = el('button', 'btn btn-sm btn-ghost', 'Close the comparison'); closeCmp.hidden = true;
  closeCmp.onclick = () => { if (second) { second.pane.remove(); panes.splice(panes.indexOf(second), 1); second = null; } root.classList.remove('cmp'); closeCmp.hidden = true; fitAll(); };
  cmpBtn.onclick = async () => {
    if (!cmpList.hidden) { cmpList.hidden = true; return; }
    cmpList.hidden = false; cmpList.textContent = '';
    cmpList.append(el('div', 'hint', 'Reading the zone’s photos…'));
    let list = [];
    try { list = await ctx.zonePhotos?.() || []; } catch (e) { cmpList.textContent = ''; cmpList.append(el('div', 'note bad', e.message)); return; }
    cmpList.textContent = '';
    list = list.filter(p => !(p.kind === photo.kind && p.id === photo.id));
    if (!list.length) { cmpList.append(el('div', 'hint', 'No other photo of this zone in the last four months.')); return; }
    // by date, newest first; a trap's own earlier photos first when this is a trap
    const groups = new Map();
    list.forEach(p => { const d = String(p.taken_at).slice(0, 10); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(p); });
    [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([d, ps]) => {
      cmpList.append(el('div', 'vw-cmp-day', day(d + 'T12:00:00')));
      ps.sort((a, b) => (b.kind === 'trap' && b.code === photo.code) - (a.kind === 'trap' && a.code === photo.code)).forEach(p => {
        const row = el('button', 'vw-cmp-row');
        const im = el('img'); im.src = p.photo_data; im.alt = '';
        row.append(im, el('span', null, p.label || photoTitle(p)));
        row.onclick = () => {
          if (second) { second.pane.remove(); panes.splice(panes.indexOf(second), 1); }
          root.classList.add('cmp');
          second = makePane(p);
          closeCmp.hidden = false; cmpList.hidden = true;
          setTimeout(fitAll, 30);
        };
        cmpList.append(row);
      });
    });
  };
  secCmp.append(cmpBtn, ' ', closeCmp, cmpList);
  panel.append(secCmp);
  setTimeout(fitAll, 30);
  return { close };
}
