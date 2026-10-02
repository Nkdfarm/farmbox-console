// ═══════════════════════════════════════════════════════════════════════════
// Feedback — what people say should change in a task, a procedure or the app
// (migration 0189, owner 2 Oct 2026)
//
// On the phone every task has a 💬 button (when the feedback is switched on for
// the FarmBox): a note, a voice note, photos, a short video. Each one lands here
// as a row — when, who, which task and procedure — with the transcription and
// what the AI (Groq) made of it: a summary, bullet points, the kind, the change
// it proposes. A manager accepts, closes or rejects it and may answer; the
// person reads the answer on the phone. "Copy as prompt" turns one feedback, or
// the list on screen, into a text ready for Claude Code.
//
// The AI proposes: nothing here changes a procedure or the app by itself.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast, fn, api, URL_BASE } from './api.js';
import { loading, el, table, pageHead, drawer, toast, busy } from './ui.js';

const STATUS = { new: ['New', 'warn'], accepted: ['Accepted', 'info'], done: ['Done', 'ok'], rejected: ['Rejected', ''] };
const KIND = { procedure: 'Procedure', app_bug: 'App bug', app_idea: 'App idea', equipment: 'Equipment', safety: 'Safety', other: 'Other' };
const SEV_CLS = { high: 'bad', medium: 'warn', low: '' };
const FILTERS = [['open', 'To decide'], ['accepted', 'Accepted'], ['done', 'Done'], ['rejected', 'Rejected'], ['all', 'All']];

let farm = null, data = null, mount = null, filter = 'open', kind = '';

export async function renderFeedback(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load(fresh = false) {
  const here = mount;
  await openFast([['task_feedback_list', { p_farm: farm.id, p_limit: 500 }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the feedback…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here,
    fresh,
  });
}

const when = t => {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
const count = (r, k) => (r.media || []).filter(m => m.kind === k).length;
const mediaWords = r => [[count(r, 'audio'), 'voice note'], [count(r, 'photo'), 'photo'], [count(r, 'video'), 'video']]
  .filter(([n]) => n).map(([n, w]) => `${n} ${w}${n > 1 ? 's' : ''}`).join(' · ');
const headline = r => r.ai_summary || (r.note || r.transcript || '').split('\n')[0].slice(0, 160)
  || (count(r, 'audio') + count(r, 'video') ? 'Not written down yet' : 'Photos only');
const whereOf = r => [r.area, r.procedure && r.procedure !== r.task ? r.procedure : null,
  r.step_seq ? `step ${r.step_seq}` : null].filter(Boolean).join(' · ');
const shown = () => data.rows.filter(r =>
  (filter === 'all' || (filter === 'open' ? r.status === 'new' : r.status === filter)) && (!kind || r.ai_kind === kind));

function paint() {
  mount.textContent = '';
  const rows = data.rows;
  const n = s => rows.filter(r => r.status === s).length;

  const copyAll = el('button', 'btn', 'Copy the list as prompt');
  copyAll.title = 'The feedback on screen, as one text ready to paste in Claude Code';
  copyAll.onclick = () => copy(listPrompt(shown()), `${shown().length} feedback copied`);
  let sw = null;
  if (data.may_switch) {
    sw = el('button', 'btn', data.on ? 'Switch the feedback off' : 'Switch the feedback on');
    if (!data.on) sw.classList.add('btn-primary');
    sw.onclick = async () => {
      busy(sw, true, 'Saving…');
      try {
        await rpc('set_task_feedback', { p_farm: farm.id, p_on: !data.on });
        toast(data.on ? 'Feedback switched off — the 💬 button leaves the phones at their next sync'
                      : 'Feedback switched on — the 💬 button is on every task at the phones\' next sync', 'ok');
        await load(true);
      } catch (e) { busy(sw, false); toast(e.message, 'bad'); }
    };
  }
  mount.append(pageHead(null,
    rows.length
      ? `${n('new')} to decide · ${n('accepted')} accepted · ${n('done')} done · ${n('rejected')} rejected. What people on the phone said should change in a task, a procedure or the app.`
      : 'What people on the phone say should change in a task, a procedure or the app: a note, a voice note, photos or a short video, sent from the 💬 button on a task.',
    rows.length ? copyAll : null, sw));

  if (!data.on) mount.append(el('div', 'note warn fbk-note',
    'The feedback is switched off for this FarmBox: the phone app shows no 💬 button.' + (data.may_switch ? '' : ' A manager switches it on.')));
  else if (!data.ai_ready) mount.append(el('div', 'note warn fbk-note',
    'No Groq API key yet: voice notes and videos are kept but not transcribed, and there is no summary. The franchisor pastes one in Settings › Integrations.'));

  const chips = el('div', 'chips fbk-chips');
  FILTERS.forEach(([v, label]) => {
    const k = v === 'open' ? n('new') : v === 'all' ? rows.length : n(v);
    const c = el('button', 'chip' + (filter === v ? ' on' : ''), `${label} ${k}`);
    c.onclick = () => { filter = v; paint(); };
    chips.append(c);
  });
  const kinds = [...new Set(rows.map(r => r.ai_kind).filter(Boolean))];
  if (kinds.length > 1) {
    chips.append(el('span', 'fbk-sep'));
    kinds.forEach(k => {
      const c = el('button', 'chip' + (kind === k ? ' on' : ''), KIND[k] || k);
      c.onclick = () => { kind = kind === k ? '' : k; paint(); };
      chips.append(c);
    });
  } else kind = '';
  mount.append(chips);

  mount.append(table([
    { key: 'sent_at', label: 'When', fmt: v => when(v) },
    { key: 'author', label: 'Who', fmt: (v, r) => {
        const b = el('div'); b.append(el('b', null, v || '—'));
        if (r.unit && farm.site) b.append(el('div', 'hint', r.unit));
        return b; } },
    { key: 'task', label: 'Task', fmt: (v, r) => {
        const b = el('div'); b.append(el('b', null, v || r.procedure || 'No task'));
        if (whereOf(r)) b.append(el('div', 'hint', whereOf(r)));
        return b; } },
    { key: 'ai_summary', label: 'What they say', fmt: (v, r) => {
        const b = el('div', 'fbk-what'); b.append(el('div', null, headline(r)));
        const line = el('div', 'fbk-tags');
        if (r.ai_kind) line.append(el('span', 'pill', KIND[r.ai_kind] || r.ai_kind));
        if (r.ai_severity && r.ai_severity !== 'low') line.append(el('span', 'pill ' + SEV_CLS[r.ai_severity], r.ai_severity));
        if (mediaWords(r)) line.append(el('span', 'hint', mediaWords(r)));
        if (r.ai_status === 'queued') line.append(el('span', 'hint', 'the AI is reading it…'));
        if (r.ai_status === 'failed') line.append(el('span', 'pill bad', 'AI failed'));
        if (line.childNodes.length) b.append(line);
        return b; } },
    { key: 'status', label: 'Status', fmt: v => el('span', 'pill ' + (STATUS[v]?.[1] || ''), STATUS[v]?.[0] || v) },
  ], shown(), {
    onRow: open,
    rowClass: r => r.status === 'rejected' ? 'off' : '',
    empty: rows.length ? 'Nothing in this list.' : data.on ? 'No feedback yet.' : 'No feedback yet — switch it on first.',
  }));
}

// a signed URL (one hour) for a file in the private evidence bucket
async function signed(path) {
  const res = await api('/storage/v1/object/sign/evidence/' + path, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) });
  return res?.signedURL ? URL_BASE + '/storage/v1' + res.signedURL : null;
}

function open(r) {
  const d = drawer(r.task || r.procedure || 'Feedback', [r.author, when(r.sent_at)].filter(Boolean).join(' · '));
  d.box.classList.add('fbk-drawer');
  const sec = (title, ...kids) => { const s = el('section', 'fbk-sec'); s.append(el('div', 'sec-title', title), ...kids.filter(Boolean)); d.body.append(s); return s; };

  const facts = el('div', 'fbk-facts');
  const row = (k, v) => { if (v == null || v === '') return; const x = el('div'); x.append(el('span', 'hint', k), el('b', null, String(v))); facts.append(x); };
  row('Task', r.task);
  row('Where', r.area);
  row('Planned for', r.planned_date);
  row('Procedure', r.procedure ? `${r.procedure}${r.version ? ' · version ' + r.version : ''}` : null);
  row('Step', r.step_seq ? `${r.step_seq}${r.step_title ? ' — ' + r.step_title : ''}` : null);
  row('Family', r.family);
  row('Unit', farm.site ? r.unit : null);
  row('Sent from', [r.app === 'heart' ? 'Naked Heart' : 'Naked Brain', r.app_version].filter(Boolean).join(' '));
  d.body.append(facts);

  // what the AI made of it
  if (r.ai_summary || (r.ai_points || []).length || r.ai_change) {
    const tags = el('div', 'fbk-tags');
    if (r.ai_kind) tags.append(el('span', 'pill', KIND[r.ai_kind] || r.ai_kind));
    if (r.ai_severity) tags.append(el('span', 'pill ' + SEV_CLS[r.ai_severity], r.ai_severity + ' severity'));
    const ul = el('ul', 'fbk-points');
    (r.ai_points || []).forEach(p => ul.append(el('li', null, p)));
    sec('In short (AI)', r.ai_summary ? el('p', 'fbk-summary', r.ai_summary) : null, ul.children.length ? ul : null, tags,
      r.ai_change ? el('div', 'fbk-change', 'Proposed change: ' + r.ai_change) : null);
  }
  if (r.note) sec('What they typed', el('p', 'fbk-text', r.note));
  if (r.transcript) sec('What they said' + (r.language ? ` (${r.language})` : ''), el('p', 'fbk-text', r.transcript));
  if (r.english) sec('In English', el('p', 'fbk-text', r.english));

  // the recordings and photos, from the evidence bucket
  if ((r.media || []).length) {
    const box = el('div', 'fbk-media');
    sec('Recordings and photos', box);
    r.media.forEach(async m => {
      const slot = el('div', 'fbk-m ' + m.kind);
      slot.append(el('span', 'hint', 'Loading…'));
      box.append(slot);
      try {
        const url = await signed(m.path);
        if (!url) throw new Error('no address');
        let n;
        if (m.kind === 'photo') { n = el('a'); n.href = url; n.target = '_blank'; n.rel = 'noopener'; const im = el('img'); im.src = url; im.alt = 'Photo'; im.loading = 'lazy'; n.append(im); }
        else { n = el(m.kind === 'video' ? 'video' : 'audio'); n.controls = true; n.preload = 'metadata'; n.src = url; }
        slot.replaceChildren(n);
        if (m.error) slot.append(el('div', 'hint', 'Not transcribed: ' + m.error));
      } catch (e) { slot.replaceChildren(el('span', 'hint', `This ${m.kind} could not be opened (${e.message}).`)); }
    });
  }

  // the AI's state, and asking again
  const aiLine = { queued: 'The AI is reading it — reload in a moment.', failed: 'The AI failed: ' + (r.ai_error || 'unknown reason'),
    no_key: 'Not read by the AI: no Groq API key (Settings › Integrations).', nothing: 'Photos only: nothing to transcribe or summarise.' }[r.ai_status];
  if (aiLine || r.ai_status === 'done') {
    const line = el('div', 'fbk-ai');
    line.append(el('span', 'hint', aiLine || `Read by ${r.ai_model || 'the AI'}${r.ai_at ? ' · ' + when(r.ai_at) : ''}`));
    if (r.ai_status !== 'nothing') {
      const again = el('button', 'btn btn-sm', r.ai_status === 'done' ? 'Ask the AI again' : 'Ask the AI');
      again.onclick = async () => {
        busy(again, true, 'Asking…');
        try {
          await rpc('retry_feedback_ai', { p_id: r.id });
          const res = await fn('task-feedback', { feedback_id: r.id });
          toast(res?.ok === false ? res.error : 'Read again', res?.ok === false ? 'bad' : 'ok');
          d.close(); await load(true);
        } catch (e) { busy(again, false); toast(e.message, 'bad'); }
      };
      line.append(again);
    }
    d.body.append(line);
  }

  // the decision
  const [word, cls] = STATUS[r.status] || [r.status, ''];
  const st = el('div', 'fbk-status');
  st.append(el('span', 'pill ' + cls, word));
  if (r.decided_at) st.append(el('span', 'hint', [r.decided_by, when(r.decided_at)].filter(Boolean).join(' · ')));
  const reply = el('textarea'); reply.rows = 3; reply.value = r.reply || '';
  reply.placeholder = 'An answer for the person who sent it (they read it on the phone, on this task\'s feedback page).';
  if (data.may_decide) {
    const acts = el('div', 'fbk-acts');
    const act = (label, status, primary) => {
      const b = el('button', 'btn' + (primary ? ' btn-primary' : ''), label);
      b.onclick = async () => {
        busy(b, true, 'Saving…');
        try { await rpc('decide_feedback', { p_id: r.id, p_status: status, p_reply: reply.value }); d.close(); toast('Saved', 'ok'); await load(true); }
        catch (e) { busy(b, false); toast(e.message, 'bad'); }
      };
      acts.append(b);
    };
    if (r.status !== 'accepted') act('Accept', 'accepted', r.status === 'new');
    if (r.status !== 'done') act('Done', 'done', r.status === 'accepted');
    if (r.status !== 'rejected') act('Reject', 'rejected');
    if (r.status !== 'new') act('Back to new', 'new');
    act('Save the answer', r.status);
    sec('Decision', st, reply, acts);
  } else {
    sec('Decision', st, r.reply ? el('p', 'fbk-text', r.reply) : el('p', 'hint', 'A manager of this FarmBox decides and may answer.'));
  }

  const prompt = el('button', 'btn btn-primary', 'Copy as prompt');
  prompt.title = 'This feedback as a text ready to paste in Claude Code';
  prompt.onclick = () => copy(onePrompt(r), 'Copied — paste it in Claude Code');
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(prompt, close);
}

// ── the prompt ───────────────────────────────────────────────────────────────
function body(r) {
  const lines = [
    `Sent: ${when(r.sent_at)} by ${r.author || 'unknown'} (${r.app === 'heart' ? 'Naked Heart' : 'Naked Brain'}${r.app_version ? ' ' + r.app_version : ''})`,
    `Task: ${r.task || '—'}${r.area ? ' — ' + r.area : ''}${r.family ? ' (' + r.family + ')' : ''}${r.planned_date ? ', planned ' + r.planned_date : ''}`,
    r.procedure ? `Procedure: ${r.procedure}${r.slug ? ' (slug ' + r.slug + ')' : ''}${r.version ? ', version ' + r.version : ''}` : null,
    r.step_seq ? `Step: ${r.step_seq}${r.step_title ? ' — ' + r.step_title : ''}` : null,
    r.ai_kind ? `Kind: ${KIND[r.ai_kind] || r.ai_kind}${r.ai_severity ? ' · severity ' + r.ai_severity : ''}` : null,
    r.ai_summary ? `Summary (AI): ${r.ai_summary}` : null,
    (r.ai_points || []).length ? 'Points (AI):\n' + r.ai_points.map(p => '- ' + p).join('\n') : null,
    r.ai_change ? `Proposed change (AI): ${r.ai_change}` : null,
    r.note ? `Typed by the person:\n"""${r.note}"""` : null,
    r.transcript ? `Said by the person (machine transcription${r.language ? ', ' + r.language : ''}):\n"""${r.transcript}"""` : null,
    r.english ? `In English:\n"""${r.english}"""` : null,
    (r.media || []).length ? `Attached: ${mediaWords(r)} — evidence bucket: ${r.media.map(m => m.path).join(', ')}` : null,
    r.reply ? `Manager's answer: ${r.reply}` : null,
    `Feedback id: ${r.id} · status ${r.status}`,
  ];
  return lines.filter(Boolean).join('\n');
}
const WHERE = 'Where things are: the phone app (Naked Brain) is Ugly200/index.html; the console (Naked Heart) is Platform/console; ' +
  'the database and its functions are Platform/supabase/migrations. A procedure\'s title, steps and limits are data: change them in ' +
  'Naked Heart (Grow › Procedures › open it › Edit) or with app.save_procedure, not in code. Read Platform/CLAUDE.md first.';
const onePrompt = r => [
  'A person working at the farm sent this feedback from the phone. Read it, tell me what you would change and where, then make the change when I say go.',
  '', body(r), '', WHERE].join('\n');
const listPrompt = rows => [
  `${rows.length} feedback from people working at the farm. Group the ones that ask for the same thing, propose one change for each group ` +
  '(say which feedback ids it answers), and tell me the order you would do them in. Make no change before I say go.',
  '', ...rows.map((r, i) => `── ${i + 1} ──\n${body(r)}`), '', WHERE].join('\n');

async function copy(text, said) {
  try { await navigator.clipboard.writeText(text); toast(said, 'ok'); }
  catch {
    // no clipboard permission: the text in a box, to copy by hand
    const d = drawer('Copy this text', 'Select it all and copy');
    const t = el('textarea'); t.rows = 24; t.value = text; t.style.width = '100%';
    d.body.append(t);
    const c = el('button', 'btn', 'Close'); c.onclick = d.close; d.footer.append(c);
    setTimeout(() => t.select(), 50);
  }
}
