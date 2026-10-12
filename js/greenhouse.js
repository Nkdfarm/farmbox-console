// The whole greenhouse on a scouting day (0.7.236, migration 0224; owner 12 Oct 2026: "a small section for all
// greenhouse with human and AI short report. the human report will be filled just a voice note or text (not
// mandatory)"). The scouting report is one band a zone; this is the band above them: what people said or wrote about
// the greenhouse as a whole that day (scout_note: from the phone's "All" card, in a planned or an extra scouting, or
// typed here), and the AI's short report on the unit (greenhouse_opinion, edge function greenhouse-opinion).
//
// Not a task and not a zone: nothing here counts in "5/5 scouted", and the band says so by asking for nothing.
// A voice note is written down by the server with the farm's own words; the text can still be wrong, so its author,
// the agronomist or a manager corrects it here — the recording stays, to listen again. The AI's report is written by
// itself once the day's scouting is complete (on a farm whose automatic AI scan is on) and on a press; it reads the
// notes, and says when one came after it. It proposes; a person decides.
//
// scouting.js owns the page. It asks this kit for the days that hold a note or a report (to list a day that has
// nothing else), for the pills of a day's line, and for the band of a day; the kit tells it when a day should be
// drawn again. Everything is read beside the page, so a database without 0224 still shows the report.
import { rpc, fn, api, cachedRpc, URL_BASE } from './api.js';
import { el, toast, busy, drawer, field, confirmDrawer } from './ui.js';

const STATUS = { ok: ['ok', 'OK'], watch: ['warn', 'Watch'], act: ['bad', 'Act now'] };
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';
const dayMon = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const first = n => String(n || 'somebody').trim().split(/\s+/)[0];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clean = e => String(e?.message || e).replace(/^\d+ /, '').slice(0, 200);

export function greenhouseKit({ farm, redraw, relist }) {
  let days = new Map();            // day → { notes, by[], opinion } (greenhouse_days)
  let known = false;               // the database has 0224
  const data = new Map();          // day → greenhouse_day
  const typing = new Map();        // day → what is being typed in "add a note" (a day is drawn again under the writer)
  let focusDay = null;

  const a = () => ({ p_farm: farm.id, p_days: 120 });
  const take = rows => { days = new Map((rows || []).map(r => [String(r.day), r])); known = true; };

  // the list: beside the page, the kept copy first
  async function readDays() {
    const before = JSON.stringify([...days]);
    try { const copy = await cachedRpc('greenhouse_days', a()); if (copy) take(copy); } catch { /* no copy */ }
    if (JSON.stringify([...days]) !== before) relist();
    try {
      const fresh = await rpc('greenhouse_days', a());
      const was = JSON.stringify([...days]);
      take(fresh);
      if (JSON.stringify([...days]) !== was) relist();
    } catch { /* a database without the function, or no connection: the report goes on without the band's figures */ }
  }

  async function readDay(day, { fresh = false } = {}) {
    const k = String(day), args = { p_farm: farm.id, p_day: k };
    const was = JSON.stringify(data.get(k) || null);
    if (!fresh && !data.has(k)) {
      try { const copy = await cachedRpc('greenhouse_day', args); if (copy) { data.set(k, copy); redraw(k); } } catch { /* no copy */ }
    }
    try {
      const d = await rpc('greenhouse_day', args);
      known = true;
      data.set(k, d);
      if (JSON.stringify(d) !== was) redraw(k);
    } catch (e) { if (fresh) throw e; }
  }

  // the days that hold a note or a report and are not in the page's own list (inside the window it has read)
  const onlyDays = (listed, oldest, all) => [...days.keys()]
    .filter(day => !listed.some(d => String(d.day) === day) && (all || !oldest || day > String(oldest)))
    .map(day => ({ day }));

  // on the day's line: who wrote, and the AI's word
  function pills(day) {
    const x = days.get(String(day));
    if (!x) return [];
    const out = [];
    if (x.notes) {
      const p = el('span', 'pill pd-gh-pill', `${x.notes > 1 ? x.notes + ' notes' : 'note'} · ${(x.by || []).map(first).join(', ')}`);
      p.title = 'About the whole greenhouse';
      out.push(p);
    }
    if (x.opinion) {
      const [c, w] = STATUS[x.opinion.status] || ['', x.opinion.status];
      const p = el('span', 'pill ' + c, '✦ ' + w);
      p.title = 'The AI on the whole greenhouse: ' + (x.opinion.headline || '');
      out.push(p);
    }
    return out;
  }

  // after a change made here: the day and the list again, and the band drawn anew even when the answer is the same
  // (a report asked twice in ten minutes comes back as it was, and its button must not stay busy)
  const after = async day => { await Promise.all([readDay(day, { fresh: true }), readDays()]); redraw(String(day)); };

  async function audioUrl(path) {
    const res = await api('/storage/v1/object/sign/evidence/' + path, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }), quiet: true });
    return res?.signedURL ? URL_BASE + '/storage/v1' + res.signedURL : null;
  }

  function correct(day, n) {
    const d = drawer('Correct the note', `${first(n.author)} · ${dayMon(n.at)} ${hhmm(n.at)}`);
    const box = el('textarea'); box.rows = 8; box.maxLength = 8000; box.value = n.text || '';
    d.body.append(field('The note', box, n.audio?.length
      ? 'A voice note is written down by a machine: put right what it heard wrong. The recording stays as it is.'
      : 'Put right what was written. The report keeps who changed it.'));
    if (n.transcript && n.transcript !== n.text) {
      const t = el('details', 'pd-gh-heard');
      t.append(el('summary', null, 'As the machine first heard it'), el('div', 'pd-gh-text', n.transcript));
      d.body.append(t);
    }
    const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
    const ok = el('button', 'btn btn-primary', 'Save');
    ok.onclick = async () => {
      const v = box.value.trim();
      if (!v) { toast('A note cannot be left empty: remove it instead', 'bad'); return; }
      busy(ok, true, 'Saving…');
      try { await rpc('edit_scout_note', { p_id: n.id, p_text: v }); d.close(); toast('Corrected', 'ok'); await after(day); }
      catch (e) { busy(ok, false); toast(clean(e), 'bad'); }
    };
    d.footer.append(cancel, ok);
  }

  function noteRow(day, n) {
    const row = el('div', 'pd-gh-note');
    const who = el('div', 'pd-gh-who');
    who.append(el('b', null, n.mine ? 'You' : first(n.author)), el('span', 'hint', hhmm(n.at)));
    if (n.extra) who.append(el('span', 'pill pd-extra', 'extra'));
    if (n.source === 'import') who.append(el('span', 'hint', 'brought in from Notion'));
    if (n.edited_at) who.append(el('span', 'hint', `corrected${n.edited_by ? ' by ' + first(n.edited_by) : ''}`));
    row.append(who);
    if (n.text) row.append(el('div', 'pd-gh-text', n.text));
    else if (n.ai_status === 'queued') row.append(el('div', 'hint', 'A voice note — being written down…'));
    else if (n.ai_status === 'no_key') row.append(el('div', 'hint', 'A voice note — not written down: no Groq key in Settings › Integrations.'));
    else if (n.audio?.length) row.append(el('div', 'hint', 'A voice note — not written down' + (n.ai_error ? ': ' + n.ai_error : '.')));

    const tools = el('div', 'pd-gh-tools');
    (n.audio || []).forEach((m, i) => {
      const b = el('button', 'linkish', `▶ Listen${n.audio.length > 1 ? ' ' + (i + 1) : ''}${m.seconds ? ' · ' + Math.round(m.seconds) + ' s' : ''}`);
      b.onclick = async () => {
        b.disabled = true;
        try {
          const url = await audioUrl(m.path);
          if (!url) throw new Error('the recording could not be opened');
          const p = el('audio'); p.controls = true; p.autoplay = true; p.src = url; p.className = 'pd-gh-audio';
          b.replaceWith(p);
        } catch (e) { b.disabled = false; toast(clean(e), 'bad'); }
      };
      tools.append(b);
    });
    if (n.audio?.length && (n.ai_status === 'failed' || (n.ai_status === 'queued' && Date.now() - new Date(n.at).getTime() > 5 * 60000))) {
      const again = el('button', 'linkish', 'Write it down again');
      again.onclick = async () => {
        again.disabled = true;
        try { await rpc('retry_scout_note_ai', { p_id: n.id }); toast('Asked again: it takes a few seconds', 'ok'); setTimeout(() => readDay(day).catch(() => {}), 8000); }
        catch (e) { again.disabled = false; toast(clean(e), 'bad'); }
      };
      tools.append(again);
    }
    if (n.may_change) {
      const fix = el('button', 'linkish', 'Correct'); fix.onclick = () => correct(day, n);
      const rm = el('button', 'linkish', 'Remove');
      rm.onclick = async () => {
        if (!await confirmDrawer('Remove this note?', `${first(n.author)}, ${dayMon(n.at)} ${hhmm(n.at)} — it leaves the report. It is not erased: the database keeps it.`, 'Remove', true)) return;
        try { await rpc('remove_scout_note', { p_id: n.id }); toast('Removed', 'ok'); await after(day); }
        catch (e) { toast(clean(e), 'bad'); }
      };
      tools.append(fix, rm);
    }
    if (tools.childNodes.length) row.append(tools);
    return row;
  }

  function addBox(day) {
    const k = String(day);
    const wrap = el('div', 'pd-gh-add');
    const box = el('textarea', 'pd-gh-box'); box.rows = 2; box.maxLength = 8000;
    box.placeholder = 'Add a note about the whole greenhouse that day…';
    box.setAttribute('aria-label', 'A note about the whole greenhouse');
    box.value = typing.get(k) || '';
    const send = el('button', 'btn btn-primary btn-sm', 'Add the note');
    send.disabled = !box.value.trim();
    box.oninput = () => { typing.set(k, box.value); send.disabled = !box.value.trim(); };
    box.onfocus = () => { focusDay = k; };
    box.onblur = () => { if (focusDay === k && box.isConnected) focusDay = null; };
    send.onclick = async () => {
      const text = box.value.trim();
      if (!text) return;
      busy(send, true, 'Adding…');
      try {
        await rpc('submit_scout_note', { p: { farm_id: farm.id, client_id: 'web-' + crypto.randomUUID(), day: k, text, source: 'console', app: 'heart' } });
        typing.delete(k); focusDay = null;
        toast('Note added', 'ok');
        await after(k);
      } catch (e) { busy(send, false, 'Add the note'); toast(clean(e), 'bad'); }
    };
    wrap.append(box, send);
    // the day was drawn again while somebody was writing: the cursor goes back where it was
    if (focusDay === k) requestAnimationFrame(() => { if (box.isConnected) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } });
    return wrap;
  }

  function reportCard(day, d) {
    const k = String(day), op = d?.opinion || null;
    const card = el('div', 'pd-ai pd-gh-ai');
    const label = () => (op ? '✦ Ask again' : '✦ Ask the AI');
    const ask = el('button', 'btn btn-sm' + (op ? '' : ' btn-primary'), label());
    ask.title = 'Sends the last days of every zone — the counts, the cases, the notes people made, the AI notes on the photos, no picture — for a short report on the whole greenhouse that day';
    ask.onclick = async e => {
      e.preventDefault(); e.stopPropagation();
      busy(ask, true, 'The AI is reading the greenhouse…');
      try {
        const r = await fn('greenhouse-opinion', { farm_id: farm.id, day: k, force: true });
        if (!r?.ok) throw new Error(r?.error || 'no answer');
        await after(k);
      } catch (err) { busy(ask, false, label()); toast('AI report: ' + clean(err), 'bad'); }
    };
    const head = el('div', 'pd-ai-head');
    head.append(el('b', null, '✦ AI report'));
    if (op) { const [c, w] = STATUS[op.status] || ['', op.status]; head.append(el('span', 'pill ' + c, w)); }
    head.append(el('span', 'spacer'));
    if (d?.ai_ready !== false) head.append(ask);
    card.append(head);
    if (!op) {
      card.append(el('div', 'hint', d?.ai_ready === false
        ? 'No report: paste an Anthropic API key in Settings › Integrations first.'
        : 'Not written yet. It is written by itself once the day\'s scouting is complete, where the automatic AI scan is on — or on a press. It reads every zone and the notes beside it. It proposes; you decide.'));
      return card;
    }
    const body = el('div', 'pd-ai-body');
    body.append(el('b', 'pd-gh-headline', op.headline));
    if ((op.points || []).length) {
      const ul = el('ul', 'pd-ai-points');
      op.points.forEach(p => { const li = el('li'); li.append(el('span', null, p.text || String(p))); if (p.basis) li.append(el('div', 'hint', p.basis)); ul.append(li); });
      body.append(ul);
    }
    if ((op.next_actions || []).length) {
      body.append(el('div', 'pd-hlabel', 'Next'));
      const ol = el('ol', 'pd-ai-next');
      op.next_actions.forEach(t => ol.append(el('li', null, t)));
      body.append(ol);
    }
    if ((op.missing || []).length) {
      const m = el('details', 'pd-ai-missing');
      const ul = el('ul');
      op.missing.forEach(t => ul.append(el('li', null, t)));
      m.append(el('summary', null, `What was missing (${op.missing.length})`), ul);
      body.append(m);
    }
    const st = op.stats || {};
    const read = [st.notes ? plural(st.notes, 'note') : null, st.trap_readings ? plural(st.trap_readings, 'trap reading') : null,
                  st.plant_health ? plural(st.plant_health, 'health photo') : null, st.cases ? plural(st.cases, 'case') : null].filter(Boolean).join(', ');
    body.append(el('div', 'hint pd-ai-foot', [`Written ${dayMon(op.created_at)} ${hhmm(op.created_at)}`, op.auto ? 'by itself' : (op.by ? 'asked by ' + first(op.by) : null),
      op.confidence != null ? `confidence ${Math.round(op.confidence * 100)} %` : null, read ? 'read ' + read : null].filter(Boolean).join(' · ') + ' · The AI proposes; you decide.'));
    if (op.notes_since > 0) body.append(el('div', 'note warn pd-gh-stale', `${op.notes_since > 1 ? op.notes_since + ' notes were' : 'A note was'} added or corrected after this report — ask again.`));
    card.append(body);
    return card;
  }

  // the band of a day, above its zones. scouting.js keeps its open state like a zone's (dataset.unit 'whole').
  function band(day) {
    const k = String(day), d = data.get(k) || null, x = days.get(k) || null;
    const notes = d?.notes || [], op = d?.opinion || x?.opinion || null;
    const det = el('details', 'pd-zone-band pd-gh');
    det.dataset.unit = 'whole';
    det.open = notes.length > 0 || !!op || (x?.notes || 0) > 0;
    const sum = el('summary');
    const left = el('span', 'pd-zone-title');
    left.append(el('b', null, 'Whole greenhouse'));
    sum.append(left);
    const right = el('span', 'pd-day-facts');
    const n = d ? notes.length : (x?.notes || 0);
    if (n) right.append(el('span', 'pill', n > 1 ? `${n} notes` : 'note'));
    if (op) { const [c, w] = STATUS[op.status] || ['', op.status]; right.append(el('span', 'pill ' + c, '✦ ' + w), el('span', 'pd-gh-line', op.headline || '')); }
    if (!n && !op) right.append(el('span', 'hint', 'no note, no AI report'));
    sum.append(right);
    det.append(sum);

    const body = el('div', 'pd-zone-body pd-gh-body');
    if (!d) { body.append(el('div', 'hint', known ? 'Reading…' : 'Reading the notes…')); det.append(body); return det; }
    const col = el('div', 'pd-gh-notes');
    col.append(el('div', 'pd-hlabel', notes.length ? 'What people said' : 'No note that day'));
    notes.forEach(nt => col.append(noteRow(k, nt)));
    if (d.may_write) col.append(addBox(k));
    body.append(col, reportCard(k, d));
    det.append(body);
    return det;
  }

  return { readDays, readDay, onlyDays, pills, band, has: day => days.has(String(day)), ready: () => known };
}
