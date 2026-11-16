// The team's notes and thread under a photo in the viewer: teamNotes (split from viewer.js, 16 Nov 2026)
import { rpc, fn } from '../api.js';
import { el, toast, busy, confirmDrawer, once, avatar, g1Face } from '../ui.js';
import { when, RISK_WORD, tagChips, whoAmI, signedUrl, errWord, riskSelect, firstWord, REACTS, firstSentence, verifiedBlock } from './parts.js';
import { askOpinion } from './opinions.js';

// hooks: editNote() opens the photographer's note for a change; showAI() brings the whole AI reading into view
export function teamNotes(photo, ctx, mayWrite, onAsked, hooks = {}) {
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
        if (!await confirmDrawer('Delete your note?', 'It leaves the photo and its thread.', 'Delete it', true)) return;
        await once(x, async () => { try {
          await rpc('dg_delete_note', { p_id: n.id });
          photo.notes = (photo.notes || []).filter(q => q.id !== n.id);
          if (T) T.thread = (T.thread || []).filter(q => !(q.type === 'note' && q.id === n.id));
          await changed();
        } catch (e) { toast(errWord(e), 'bad'); } });
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
