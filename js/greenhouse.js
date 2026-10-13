// The whole greenhouse, on top of the scouting page (0.7.237, migrations 0224 and 0225).
//
// First built as a band inside each day, people's notes on the left and the AI on the right (0.7.236). The owner,
// 12 Oct 2026: "the whole greenhouse report has to be in horizontal with AI in the top, because the human reports are
// not always consistent. put this block in the top of daily scouting always opened to have a quick view of general
// situation with an easy way to change to old report (as a calendar)"; then "go with the trend (very important) and
// still open". So it is one panel, always open, the width of the page:
//   · the day it shows — the last fourteen days as coloured squares, ‹ › between the days that hold something, and a
//     month calendar for older ones. It opens on today when today has a report or a note, on the last report otherwise
//   · the AI's report first (greenhouse_opinion, edge function greenhouse-opinion): its word (OK, Watch, Act now), where
//     the greenhouse is going and why, then three columns — What matters · Next · Still open from before — under
//     them a coloured box with the AI's own opinion on the team's notes (agrees, partly, disagrees; what it would add
//     or do instead — 0.7.241), beside both the photo that shows the worst of it, and What was missing, which opens
//     on a press only. Every line has a
//     dot in its colour and the worst comes first; a place (Zone 2, Sump 1) is in bold; what a point rests on is a
//     button a record — a photo, a trap, a case, a note, a sump — that opens it beside the page (0.7.240). Written
//     from that day and the days before it, never from what came after, and short (0.7.238)
//   · under it, Team reports: what people said or wrote about the greenhouse that day (scout_note: the phone's "All"
//     card in a planned or an extra scouting, or typed here), a line each across the panel, its author's picture first
//     — or, for several notes or a long one, one text the AI wrote from them, with a button a note that opens the note
//     itself to read, correct or remove (0.7.240; the notes are the record, the text a reading aid)
//     (0.7.238, owner 12 Oct 2026: stacked blocks were tried for the whole panel; "finally a hybrid solution: the AI
//     report as before (just more concise and direct) and user report as proposed")
//
// Not a task and not a zone: nothing here counts in "5/5 scouted". A voice note is written down by the server with the
// farm's own words; its author, the agronomist or a manager corrects it here, and the recording stays to listen again.
// The AI's report is written by itself once the day's scouting is complete (on a farm whose automatic AI scan is on)
// and on a press. It proposes; a person decides.
//
// scouting.js owns the page: it asks this kit for the panel and for the pills of a day's line (a press on one shows
// that day up here). Everything is read beside the page, so a database without 0224 still shows the report.
import { rpc, fn, api, cachedRpc, URL_BASE } from './api.js';
import { el, toast, busy, drawer, field, confirmDrawer, avatar, g1Face } from './ui.js';

const STATUS = { ok: ['ok', 'OK'], watch: ['warn', 'Watch'], act: ['bad', 'Act now'] };
// the zones' own words for a trend (scouting.js, TREND_AI): down is fewer pests
const TREND = { better: ['ok', '▼ getting better', '▼'], stable: ['', '– stable', '–'], worse: ['bad', '▲ getting worse', '▲'], unclear: ['', '? trend unclear', '?'] };
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';
const dayMon = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const first = n => String(n || 'somebody').trim().split(/\s+/)[0];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clean = e => String(e?.message || e).replace(/^\d+ /, '').slice(0, 200);
// a day is a 'YYYY-MM-DD' string everywhere here; noon keeps it the same day in every time zone
const at = day => new Date(String(day) + 'T12:00:00');
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (day, n) => { const d = at(day); d.setDate(d.getDate() + n); return iso(d); };
const longDay = day => at(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = day => at(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const LONG = 700;   // a note longer than this is shown by its first lines
// the report's colours (0.7.239, owner: "use some color code in the ai report according with the severity and urgency"):
// a point by how bad it is, an action by how soon, a thing still open by how long it has waited
const LEVEL = { act: ['bad', 'Needs action now'], watch: ['warn', 'Building, or not sure yet: look closer'], good: ['ok', 'Improving, or under control'] };
const WHEN = { today: ['bad', 'today'], this_week: ['warn', 'this week'], later: ['', 'later'] };
const daysBetween = (a, b) => Math.round((at(b) - at(a)) / 86400000);
// a line of the report or of the notes, with its places in bold (0.7.240, owner: "the zones and the titles have to be in
// bold font"): what a line starts with before its colon — "Zone 2 NGS bay:", "Sump 2:" — and every "Zone 3", "Zones 2 to
// 4.2", "Sump 1" inside it
const PLACE = /(Zones?\s\d+(?:\.\d+)?(?:(?:,\s|\sand\s|\sto\s)\d+(?:\.\d+)?)*|Sumps?\s\d+(?:(?:,\s|\sand\s)\d+)*)/g;
function rich(text, lead = true) {
  const s = el('span');
  let t = String(text || '');
  const m = lead ? /^([^:.!?]{2,48}):\s/.exec(t) : null;
  if (m) { s.append(el('b', null, m[1] + ':'), ' '); t = t.slice(m[0].length); }
  t.split(PLACE).forEach((part, i) => { if (part) s.append(i % 2 ? el('b', null, part) : part); });
  return s;
}

export function greenhouseKit({ farm, today, scouted, relist, openRef }) {
  let days = new Map();            // day → { notes, by[], opinion: { status, trend, trend_note, headline } } (greenhouse_days)
  let known = false;               // the database has 0224
  const data = new Map();          // day → greenhouse_day
  const tried = new Map();         // day → when it was last asked for, so a read that fails is not asked in a loop
  const failed = new Map();        // day → why its last read failed: the panel says so and offers "Try again"
  const asked = new Map(), landed = new Map();   // day → the number of its last read sent, and of the last one applied
  const sending = new Map();       // day → { text, id } of a note sent whose answer has not come
  let gone = false;                // the page made another kit (dispose): nothing of this one paints any more
  const typing = new Map();        // day → what is being typed in "add a note" (the panel is drawn again under the writer)
  const wide = new Set();          // the long notes a person opened
  let focusDay = null;
  let sel = null;                  // the day a person chose; none: the kit chooses (auto)
  let calMonth = null;             // 'YYYY-MM' while the calendar is open
  const node = el('section', 'card pd-ghp');
  node.setAttribute('aria-label', 'The whole greenhouse');

  const now = () => String(today() || iso(new Date()));
  const a = () => ({ p_farm: farm.id, p_days: 120 });
  const list = () => { if (!gone) relist(); };
  const take = rows => { days = new Map((rows || []).map(r => [String(r.day), r])); known = true; };

  // the day shown when nobody chose: today once it holds a report or a note, the last report before that, today when
  // there is nothing at all
  function auto() {
    const t = now(), x = days.get(t);
    if (x && (x.opinion || x.notes)) return t;
    const past = [...days.keys()].filter(d => d <= t).sort().reverse();
    return past.find(d => days.get(d).opinion) || past[0] || t;
  }
  const current = () => sel || auto();

  // the list: beside the page, the kept copy first
  async function readDays() {
    const before = JSON.stringify([...days]);
    try { const copy = await cachedRpc('greenhouse_days', a()); if (copy) take(copy); } catch { /* no copy */ }
    if (JSON.stringify([...days]) !== before) { list(); draw(); }
    try {
      const fresh = await rpc('greenhouse_days', a());
      const was = JSON.stringify([...days]);
      take(fresh);
      if (JSON.stringify([...days]) !== was) { list(); draw(); }
    } catch { /* a database without the function, or no connection: the page goes on without the panel's figures */ }
  }
  // the page read again (a change made here or on another device): the list, and the day on show. What was read of
  // the other days is let go, so each is read again when it is next shown (0.7.242: a report written again elsewhere
  // stayed on screen as it had first been read — "the report of 9 is in the old format")
  const refresh = () => {
    const k = current();
    [...data.keys()].forEach(d => { if (d !== k) data.delete(d); });
    tried.clear();
    return Promise.all([readDays(), readDay(k).catch(() => {})]);
  };

  async function readDay(day, { fresh = false } = {}) {
    const k = String(day), args = { p_farm: farm.id, p_day: k };
    const was = JSON.stringify(data.get(k) || null);
    // two reads of a day can be on their way at once (the page read again while a note is being added): the answer
    // of the one sent first is dropped when the later one is already on screen (review 13 Oct 2026: the older answer
    // came last and took the new note off the panel)
    const my = (asked.get(k) || 0) + 1;
    asked.set(k, my);
    tried.set(k, Date.now());
    if (!fresh && !data.has(k)) {
      try { const copy = await cachedRpc('greenhouse_day', args); if (copy && !data.has(k)) { data.set(k, copy); if (k === current()) draw(); } } catch { /* no copy */ }
    }
    try {
      const d = await rpc('greenhouse_day', args);
      known = true;
      if ((landed.get(k) || 0) > my) return;
      landed.set(k, my);
      failed.delete(k);
      data.set(k, d);
      if (JSON.stringify(d) !== was && k === current()) draw();
    } catch (e) {
      // said on the panel, with "Try again" (review 13 Oct 2026: a read that failed left "Reading…" for ever). Only a
      // day with nothing to show is drawn again, and the failure counts as its last try, so it is not asked in a loop.
      if ((landed.get(k) || 0) < my) {
        failed.set(k, clean(e)); tried.set(k, Date.now());
        if (!data.has(k) && k === current()) draw();
      }
      if (fresh) throw e;
    }
  }

  // after a change made here: the day and the list again, and the panel drawn anew even when the answer is the same
  // (a report asked twice in ten minutes comes back as it was, and its button must not stay busy)
  const after = async day => { await Promise.all([readDay(day, { fresh: true }), readDays()]); draw(); };

  function select(day, { show = false } = {}) {
    const k = String(day);
    if (k > now()) return;
    sel = k === auto() ? null : k;
    calMonth = null;
    draw();
    // what is kept of that day is shown at once, and asked again: it is drawn anew only when the answer differs
    if (data.has(k)) readDay(k).catch(() => {});
    if (show && node.isConnected) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // on a day's line in the list below: who wrote, and the AI's word with its trend. A press shows that day up here.
  function pills(day) {
    const k = String(day), x = days.get(k);
    if (!x) return [];
    const out = [];
    const press = p => {
      p.classList.add('pd-gh-press'); p.setAttribute('role', 'button'); p.tabIndex = 0;
      const go = e => { e.preventDefault(); e.stopPropagation(); select(k, { show: true }); };
      p.onclick = go;
      p.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') go(e); };
      return p;
    };
    if (x.notes) {
      const p = el('span', 'pill pd-gh-pill', `${x.notes > 1 ? x.notes + ' notes' : 'note'} · ${(x.by || []).map(first).join(', ')}`);
      p.title = 'About the whole greenhouse — show it at the top of the page';
      out.push(press(p));
    }
    if (x.opinion) {
      const [c, w] = STATUS[x.opinion.status] || ['', x.opinion.status];
      const t = TREND[x.opinion.trend];
      const p = el('span', 'pill ' + c, '✦ ' + w + (t ? ' ' + t[2] : ''));
      p.title = 'The AI on the whole greenhouse: ' + (x.opinion.headline || '') + (t ? ` (${t[1].slice(2)})` : '') + ' — show it at the top of the page';
      out.push(press(p));
    }
    return out;
  }

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

  function noteRow(day, n, done) {
    // the author's picture first, the same one as on the Tasks board and on Team (a drawn face in their colour without one)
    const line = el('div', 'pd-gh-note');
    line.append(avatar({ worker_id: n.worker_id || null, name: n.author || 'somebody' }, 'sm'));
    const row = el('div', 'pd-gh-said');
    line.append(row);
    const who = el('div', 'pd-gh-who');
    who.append(el('b', null, n.mine ? 'You' : first(n.author)), el('span', 'hint', hhmm(n.at)));
    if (n.extra) who.append(el('span', 'pill pd-extra', 'extra'));
    if (n.source === 'import') who.append(el('span', 'hint', 'brought in from Notion'));
    if (n.edited_at) who.append(el('span', 'hint', `corrected${n.edited_by ? ' by ' + first(n.edited_by) : ''}`));
    row.append(who);
    const tools = el('div', 'pd-gh-tools');
    if (n.text) {
      const long = n.text.length > LONG, t = el('div', 'pd-gh-text' + (long && !wide.has(n.id) ? ' clamp' : ''), n.text);
      row.append(t);
      if (long) {
        const more = el('button', 'linkish', wide.has(n.id) ? 'Show less' : 'Show all');
        more.onclick = () => {
          if (wide.has(n.id)) wide.delete(n.id); else wide.add(n.id);
          t.classList.toggle('clamp', !wide.has(n.id));
          more.textContent = wide.has(n.id) ? 'Show less' : 'Show all';
        };
        tools.append(more);
      }
    }
    else if (n.ai_status === 'queued') row.append(el('div', 'hint', 'A voice note — being written down…'));
    else if (n.ai_status === 'no_key') row.append(el('div', 'hint', 'A voice note — not written down: no Groq key in Settings › Integrations.'));
    else if (n.audio?.length) row.append(el('div', 'hint', 'A voice note — not written down' + (n.ai_error ? ': ' + n.ai_error : '.')));

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
      const fix = el('button', 'linkish', 'Correct'); fix.onclick = () => { done?.(); correct(day, n); };
      const rm = el('button', 'linkish', 'Remove');
      rm.onclick = async () => {
        if (!await confirmDrawer('Remove this note?', `${first(n.author)}, ${dayMon(n.at)} ${hhmm(n.at)} — it leaves the report. It is not erased: the database keeps it.`, 'Remove', true)) return;
        try { await rpc('remove_scout_note', { p_id: n.id }); toast('Removed', 'ok'); done?.(); await after(day); }
        catch (e) { toast(clean(e), 'bad'); }
      };
      tools.append(fix, rm);
    }
    if (tools.childNodes.length) row.append(tools);
    return line;
  }

  function addBox(day) {
    const k = String(day);
    const wrap = el('div', 'pd-gh-add');
    const box = el('textarea', 'pd-gh-box'); box.rows = 2; box.maxLength = 8000;
    box.placeholder = `Add a note about the whole greenhouse on ${shortDay(k)}…`;
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
      // the same words sent again keep their id: when the first answer was lost on the way, the database still
      // holds one note, not two (review 13 Oct 2026)
      const again = sending.get(k);
      const id = again?.text === text ? again.id : 'web-' + crypto.randomUUID();
      sending.set(k, { text, id });
      try {
        await rpc('submit_scout_note', { p: { farm_id: farm.id, client_id: id, day: k, text, source: 'console', app: 'heart' } });
        typing.delete(k); sending.delete(k); focusDay = null;
        toast('Note added', 'ok');
        await after(k);
      } catch (e) { busy(send, false, 'Add the note'); toast(clean(e), 'bad'); }
    };
    wrap.append(box, send);
    return wrap;
  }
  // the panel was drawn again, or put back on the page, while somebody was writing: the cursor goes back where it was
  const refocus = () => {
    if (!focusDay) return;
    requestAnimationFrame(() => {
      const box = node.querySelector('.pd-gh-box');
      if (box && box.isConnected && focusDay === current() && document.activeElement !== box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    });
  };

  // ── the day on show: squares for the last fourteen days, ‹ ›, and the calendar ──
  const mark = day => {                       // what a square says about a day
    const x = days.get(day), [c, w] = x?.opinion ? (STATUS[x.opinion.status] || ['', '']) : ['', ''];
    const t = x?.opinion ? TREND[x.opinion.trend] : null;
    const said = [w ? 'AI: ' + w + (t ? ', ' + t[1].slice(2) : '') : null, x?.notes ? plural(x.notes, 'note') : null].filter(Boolean).join(' · ');
    return { cls: c, noted: !!x?.notes, title: longDay(day) + (said ? ' — ' + said : '') + (x?.opinion?.headline ? '\n' + x.opinion.headline : '') };
  };
  function cell(day, k, label) {
    const m = mark(day), t = now();
    const b = el('button', 'pd-ghp-cell' + (m.cls ? ' ' + m.cls : '') + (m.noted ? ' noted' : '') + (day === k ? ' sel' : '') + (day === t ? ' today' : ''), label);
    b.type = 'button'; b.title = m.title;
    b.setAttribute('aria-label', m.title.replace('\n', '. '));
    if (day === k) b.setAttribute('aria-current', 'date');
    if (day > t) b.disabled = true; else b.onclick = e => { e.stopPropagation(); select(day); };
    return b;
  }
  // the days worth stopping at: a report, a note or a scouting, and today
  const stops = () => [...new Set([...days.keys(), ...(scouted() || []).map(String), now()])].filter(d => d <= now()).sort();

  function calendar(k) {
    const t = now(), box = el('div', 'pd-ghp-cal');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Choose a day');
    const [y, m] = calMonth.split('-').map(Number);
    const head = el('div', 'pd-ghp-cal-head');
    const move = n => { const d = new Date(y, m - 1 + n, 1, 12); calMonth = iso(d).slice(0, 7); draw(); };
    const prev = el('button', 'pd-ghp-step', '‹'); prev.type = 'button'; prev.title = 'The month before'; prev.onclick = e => { e.stopPropagation(); move(-1); };
    const next = el('button', 'pd-ghp-step', '›'); next.type = 'button'; next.title = 'The month after'; next.onclick = e => { e.stopPropagation(); move(1); };
    next.disabled = calMonth >= t.slice(0, 7);
    head.append(prev, el('b', null, new Date(y, m - 1, 1, 12).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })), next);
    const grid = el('div', 'pd-ghp-cal-grid');
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(w => grid.append(el('span', 'wd', w)));
    const lead = (new Date(y, m - 1, 1, 12).getDay() + 6) % 7, n = new Date(y, m, 0, 12).getDate();
    for (let i = 0; i < lead; i++) grid.append(el('span'));
    const walked = new Set((scouted() || []).map(String));
    for (let i = 1; i <= n; i++) {
      const day = `${calMonth}-${String(i).padStart(2, '0')}`, c = cell(day, k, String(i));
      if (walked.has(day)) c.classList.add('scouted');
      grid.append(c);
    }
    const key = el('div', 'pd-ghp-key');
    [['ok', 'OK'], ['warn', 'Watch'], ['bad', 'Act now']].forEach(([c, w]) => { const s = el('span'); s.append(el('i', 'pd-ghp-cell ' + c), w); key.append(s); });
    const s = el('span'); s.append(el('i', 'pd-ghp-cell noted'), 'a note'); key.append(s);
    box.append(head, grid, key);
    box.onclick = e => e.stopPropagation();
    return box;
  }

  function headRow(k) {
    const t = now(), all = stops();
    const head = el('div', 'pd-ghp-head');
    head.append(el('b', 'pd-ghp-title', 'Whole greenhouse'));
    const nav = el('div', 'pd-ghp-nav');
    const before = all.filter(d => d < k).pop(), afterDay = all.find(d => d > k);
    const back = el('button', 'pd-ghp-step', '‹'); back.type = 'button';
    back.title = before ? 'The report before: ' + longDay(before) : 'Nothing earlier';
    back.disabled = !before; back.onclick = () => select(before);
    const fwd = el('button', 'pd-ghp-step', '›'); fwd.type = 'button';
    fwd.title = afterDay ? 'The report after: ' + longDay(afterDay) : 'Nothing later';
    fwd.disabled = !afterDay; fwd.onclick = () => select(afterDay);
    const date = el('button', 'pd-ghp-date', longDay(k) + (k === t ? ' · today' : ''));
    date.type = 'button'; date.title = 'Choose another day'; date.setAttribute('aria-haspopup', 'dialog'); date.setAttribute('aria-expanded', String(!!calMonth));
    date.append(el('span', 'pd-ghp-caret', '▾'));
    date.onclick = e => { e.stopPropagation(); calMonth = calMonth ? null : k.slice(0, 7); draw(); };
    nav.append(back, date, fwd);
    if (calMonth) nav.append(calendar(k));
    head.append(nav);
    if (k !== t) {
      const go = el('button', 'linkish', 'Today'); go.type = 'button'; go.onclick = () => select(t);   // as any other day: shown at once, and asked again
      head.append(go);
      if (!sel) head.append(el('span', 'hint', 'no report today yet: this is the last one'));
    }
    const strip = el('div', 'pd-ghp-strip');
    strip.setAttribute('aria-label', 'The last fourteen days');
    for (let i = 13; i >= 0; i--) { const day = shift(t, -i); strip.append(cell(day, k, String(at(day).getDate()))); }
    head.append(strip);
    return head;
  }

  // a day that could not be read: why, and a way to ask again
  function failLine(k) {
    const line = el('div', 'hint');
    line.append(`Could not read this day: ${failed.get(k)}. `);
    const again = el('button', 'linkish', 'Try again'); again.type = 'button';
    again.onclick = () => { failed.delete(k); tried.delete(k); draw(); };
    line.append(again);
    return line;
  }

  // ── the AI's report, first ──
  function report(k, d) {
    const x = days.get(k) || null;
    const op = d?.opinion || null, lite = op || x?.opinion || null;      // the list's line while the day is being read
    const box = el('div', 'pd-ghp-ai');
    const label = () => (lite ? '✦ Ask again' : '✦ Ask the AI');
    const ask = el('button', 'btn btn-sm' + (lite ? '' : ' btn-primary'), label());
    ask.title = 'Sends that day and the thirty before it of every zone — the counts, the cases, the notes people made, the AI notes on the photos, no picture — and the earlier reports, for a short report on the whole greenhouse that day. Nothing from after that day is sent.';
    ask.onclick = async () => {
      busy(ask, true, 'The AI is reading the greenhouse…');
      try {
        const r = await fn('greenhouse-opinion', { farm_id: farm.id, day: k, force: true });
        if (!r?.ok) throw new Error(r?.error || 'no answer');
        await after(k);
      } catch (err) { busy(ask, false, label()); toast('AI report: ' + clean(err), 'bad'); }
    };
    const line = el('div', 'pd-ghp-line');
    line.append(g1Face('', 'Written by the AI'), el('b', 'pd-ghp-ailabel', 'AI report'));
    if (lite) {
      const [c, w] = STATUS[lite.status] || ['', lite.status];
      line.append(el('span', 'pill pd-ghp-status ' + c, w));
      const t = TREND[lite.trend];
      if (t) { const p = el('span', 'pill pd-ghp-trend ' + t[0], t[1]); p.title = 'Against the days before'; line.append(p); }
      const why = el('span', 'pd-ghp-why'); why.append(lite.trend_note ? rich(lite.trend_note, false) : (t ? '' : 'Written before the report gave a trend — ask again for it.'));
      line.append(why);
    } else line.append(el('span', 'pd-ghp-why'));
    if (d ? d.ai_ready !== false : !!lite) line.append(ask);
    box.append(line);

    if (!lite) {
      box.append(!d && failed.has(k) ? failLine(k) : el('div', 'hint', !d ? (known ? 'Reading…' : 'Reading the report…') : d.ai_ready === false
        ? 'No report: paste an Anthropic API key in Settings › Integrations first.'
        : `No report for ${k === now() ? 'today' : shortDay(k)} yet. It is written by itself once the day's scouting is complete, where the automatic AI scan is on — or on a press. It reads every zone, the notes and the days before. It proposes; you decide.`));
      return box;
    }
    box.append(el('b', 'pd-gh-headline', lite.headline || ''));
    if (!op) { box.append(!d && failed.has(k) ? failLine(k) : el('div', 'hint', 'Reading the rest…')); return box; }

    const cols = el('div', 'pd-ghp-cols');
    const col = (title, list) => { const c = el('div', 'pd-ghp-col'); c.append(el('div', 'pd-hlabel', title), list); cols.append(c); };
    // every line a dot in its colour and the worst first: no numbers, the order says it (0.7.240)
    const by = (key, order) => (x, y) => { const r = o => { const i = order.indexOf(o?.[key]); return i < 0 ? order.length : i; }; return r(x) - r(y); };
    if ((op.points || []).length) {
      const ul = el('ul', 'pd-ai-points');
      [...op.points].sort(by('level', ['act', 'watch', 'good'])).forEach(p => {
        const lv = LEVEL[p.level], li = el('li', 'lv lv-' + (lv ? lv[0] : 'none'));
        if (lv) li.title = lv[1];
        li.append(rich(p.text || String(p)));
        // what it rests on: a button a record, which opens it beside the page; the words alone in a report written before 0226
        if ((p.refs || []).length) { const r = el('div', 'pd-ghp-refs'); p.refs.forEach(x => r.append(refChip(x, k))); li.append(r); }
        else if (p.basis) li.append(el('div', 'hint', p.basis));
        ul.append(li);
      });
      col('What matters', ul);
    }
    if ((op.next_actions || []).length) {
      const ul = el('ul', 'pd-ai-next');
      // an action is a line of text in the reports written before 0.7.239, { text, when } since
      [...op.next_actions].sort(by('when', ['today', 'this_week', 'later'])).forEach(t => {
        const w = WHEN[t?.when], li = el('li', 'lv lv-' + ((w && w[0]) || 'none'));
        if (w) li.append(el('span', 'pd-ghp-when ' + w[0], w[1]));
        li.append(rich(t?.text || String(t))); ul.append(li);
      });
      col('Next', ul);
    }
    if ((op.carried || []).length) {
      const ul = el('ul', 'pd-ai-next pd-ghp-open');
      // the longer it has waited, the hotter and the higher: a week red, three days orange
      [...op.carried].sort((x, y) => String(x?.since || '9').localeCompare(String(y?.since || '9'))).forEach(c => {
        const n = c.since ? daysBetween(c.since, k) : null, cls = n == null ? 'none' : n >= 7 ? 'bad' : n >= 3 ? 'warn' : 'none';
        const li = el('li', 'lv lv-' + cls);
        li.append(rich(c.text || String(c)));
        if (c.since) li.append(el('div', 'hint', `since ${shortDay(c.since)}${n > 0 ? ' · ' + plural(n, 'day') : ''}`));
        ul.append(li);
      });
      col('Still open from before', ul);
    } else if (op.trend) {
      col('Still open from before', el('div', 'hint', 'Nothing carried over from the earlier reports and notes.'));
    }
    // under the three columns, the AI's own opinion on the team's notes; beside both, the photo that shows the worst of
    // the report — always one while the unit has a photo (0.7.241: the picture stood as a fourth column of the lists)
    const left = el('div', 'pd-ghp-left');
    if (cols.childNodes.length) left.append(cols);
    if (op.critique?.text) left.append(critBox(op.critique, k));
    const main = el('div', 'pd-ghp-main' + (op.picture?.id ? ' has-pic' : ''));
    main.append(left);
    if (op.picture?.id) main.append(pictureCol(op.picture, k));
    if (left.childNodes.length || op.picture?.id) box.append(main);
    // what was missing: closed until it is pressed, and closed again whenever the panel is drawn
    if ((op.missing || []).length) {
      const m = el('details', 'pd-ai-missing');
      const ul = el('ul');
      op.missing.forEach(t => { const li = el('li', 'lv lv-none'); li.append(rich(t)); ul.append(li); });
      m.append(el('summary', 'pd-hlabel', `What was missing (${op.missing.length})`), ul);
      box.append(m);
    }
    const lg = el('div', 'hint pd-ghp-legend');
    [['bad', 'act now · today · open a week or more'], ['warn', 'watch · this week · open three days'], ['ok', 'improving'], ['none', 'later, or not rated']]
      .forEach(([c, w]) => { const x = el('span'); x.append(el('i', 'lv-dot lv-' + c), w); lg.append(x); });
    box.append(lg);
    const st = op.stats || {};
    const read = [st.days ? plural(st.days, 'day') + ' of records' : null, st.reports_before ? plural(st.reports_before, 'earlier report') : null,
                  st.notes ? plural(st.notes, 'note') : null, st.trap_readings ? plural(st.trap_readings, 'trap reading') : null,
                  st.plant_health ? plural(st.plant_health, 'health photo') : null, st.cases ? plural(st.cases, 'case') : null].filter(Boolean).join(', ');
    box.append(el('div', 'hint pd-ai-foot', [`Written ${dayMon(op.created_at)} ${hhmm(op.created_at)}`, op.auto ? 'by itself' : (op.by ? 'asked by ' + first(op.by) : null),
      op.confidence != null ? `confidence ${Math.round(op.confidence * 100)} %` : null, read ? 'read ' + read : null,
      'nothing from after ' + shortDay(k)].filter(Boolean).join(' · ') + ' · The AI proposes; you decide.'));
    if (op.notes_since > 0) box.append(el('div', 'note warn pd-gh-stale', `${op.notes_since > 1 ? op.notes_since + ' notes were' : 'A note was'} added or corrected after this report — ask again.`));
    return box;
  }

  // ── what a report rests on, opened beside the page ──
  const OPEN = { photo: 'Open the photo', trap: 'Open the trap and its readings', case: 'Open the case', note: 'Open the note', sump: 'Open the sump and its readings' };
  async function open(ref, k) {
    if (ref.kind === 'note') return openNote(ref.day || k, ref.id);
    if (!openRef) return;
    try { await openRef({ ...ref, day: ref.day || k }); } catch (e) { toast(clean(e), 'bad'); }
  }
  function refChip(x, k) {
    const b = el('button', 'pd-ghp-ref k-' + x.kind, x.label || x.kind);
    b.type = 'button'; b.title = OPEN[x.kind] || 'Open';
    b.onclick = e => { e.stopPropagation(); open(x, k); };
    return b;
  }
  // the AI's own opinion on what the team wrote (0227): agrees, partly, disagrees — in that colour — two or three
  // sentences, what it rests on, and what it would add or do instead. An opinion: the person's instruction stays in Next.
  const VERDICT = { agree: ['ok', 'Agrees with'], partly: ['warn', 'Partly agrees with'], disagree: ['bad', 'Disagrees with'], no_notes: ['none', 'No team note to compare'] };
  function critBox(c, k) {
    const [cls, word] = VERDICT[c.verdict] || ['none', ''];
    const b = el('div', 'pd-ghp-crit ' + cls);
    const head = el('div', 'pd-ghp-crit-head');
    head.append(el('span', 'pd-hlabel', "The AI's opinion"), el('span', 'pill pd-ghp-verdict ' + (cls === 'none' ? '' : cls), c.verdict === 'no_notes' ? word : `${word} ${c.about || 'the team notes'}`));
    b.append(head);
    const t = el('div', 'pd-ghp-crit-text'); t.append(rich(c.text, false)); b.append(t);
    const refs = Array.isArray(c.refs) ? c.refs : [], props = Array.isArray(c.proposals) ? c.proposals : [];
    if (refs.length) { const r = el('div', 'pd-ghp-refs'); refs.forEach(x => r.append(refChip(x, k))); b.append(r); }
    if (props.length) {
      const ul = el('ul', 'pd-ghp-props');
      props.forEach(p => {
        const w = WHEN[p.when], li = el('li', 'lv lv-' + ((w && w[0]) || 'none'));
        li.append(el('span', 'pd-ghp-kind', p.kind === 'instead' ? 'instead' : 'add'));
        if (w) li.append(el('span', 'pd-ghp-when ' + w[0], w[1]));
        li.append(rich(p.text));
        if (p.kind === 'instead' && p.instead_of) li.append(el('div', 'hint', 'instead of: ' + p.instead_of));
        ul.append(li);
      });
      b.append(ul);
    }
    b.append(el('div', 'hint', "The AI's proposal, beside what the team asked: nothing is changed by it. You decide."));
    return b;
  }
  function pictureCol(pic, k) {
    const c = el('figure', 'pd-ghp-pic');
    const b = el('button', 'pd-ghp-picbtn'); b.type = 'button'; b.title = 'Open the photo';
    const img = el('img'); img.alt = pic.caption || 'The photo of the report'; img.decoding = 'async';
    if (pic.photo_data) img.src = pic.photo_data;
    else if (pic.photo_path) audioUrl(pic.photo_path).then(u => { if (u) img.src = u; }).catch(() => {});
    b.append(img);
    b.onclick = () => open({ kind: 'photo', id: pic.id, day: pic.day, photo_data: pic.photo_data || null }, k);
    const cap = el('figcaption'); cap.append(rich(pic.caption || ''));
    if (!pic.chosen) cap.append(el('div', 'hint', 'the worst photo of the day as its AI read it — this report named none'));
    c.append(el('div', 'pd-hlabel', 'In the picture'), b, cap);
    return c;
  }
  // one note in a drawer: to read whole, listen, correct or remove
  async function openNote(day, id) {
    const kd = String(day);
    if (!data.has(kd)) { try { await readDay(kd, { fresh: true }); } catch { /* said below */ } }
    const n = (data.get(kd)?.notes || []).find(x => x.id === id);
    if (!n) { toast('That note is no longer in the report', 'bad'); return; }
    const dr = drawer(`${n.mine ? 'Your' : first(n.author) + "'s"} note`, `${longDay(kd)} · ${hhmm(n.at)} · about the whole greenhouse`);
    wide.add(n.id);
    dr.body.append(noteRow(kd, n, dr.close));
    const x = el('button', 'btn', 'Close'); x.onclick = dr.close;
    dr.footer.append(x);
  }

  // ── Team reports, under it ──
  // Several notes, or a long one, are read as one text the AI wrote from them (scout_note_digest, 0226), with a button
  // a note above it that opens the note itself. The text is shown only while it was written from the notes as they
  // read now; until then, and when it could not be written without losing something, the notes stand as they are.
  const waits = new Map();         // day → how often the page looked again for a text being written
  // The text takes a few seconds: the day is read again after five, six times at most. One timer a day, which arms
  // itself again while the text is still being written (review 13 Oct 2026: a timer was set each time the panel was
  // drawn, so the six looks were spent in the first second and a text that came later never showed).
  const timers = new Map();        // day → the look that is waiting
  function look(k) {
    if (gone || timers.has(k)) return;
    const n = waits.get(k) || 0;
    if (n >= 6) return;
    waits.set(k, n + 1);
    timers.set(k, setTimeout(async () => {
      if (!gone && current() === k) await readDay(k, { fresh: true }).catch(() => {});
      timers.delete(k);
      const d = data.get(k), st = d?.digest?.status;
      if (current() === k && d?.digest_wanted && (d.notes || []).length && (st === 'queued' || st === 'claimed')) look(k);
    }, 5000));
  }
  function said(k, d) {
    const x = days.get(k) || null;
    const box = el('div', 'pd-ghp-notes');
    if (!d) {
      box.append(el('div', 'pd-hlabel', x?.notes ? `Team reports · ${x.notes}` : 'Team reports'), el('div', 'hint', failed.has(k) ? 'Not read.' : 'Reading…'));
      return box;
    }
    const notes = d.notes || [], dg = d.digest || null;
    if (dg?.fresh && dg.text && notes.length) {
      waits.delete(k);
      const head = el('div', 'pd-ghp-sumhead');
      head.append(el('span', 'pd-hlabel', `Team reports · AI summary of ${plural(notes.length, 'note')}`));
      notes.forEach(n => {
        const b = el('button', 'pd-ghp-notechip'); b.type = 'button';
        b.append(avatar({ worker_id: n.worker_id || null, name: n.author || 'somebody' }, 'xs'), `${n.mine ? 'You' : first(n.author)} ${hhmm(n.at)}`);
        b.title = 'Open this note: read it as it was said or written, listen, correct or remove it';
        b.onclick = () => openNote(k, n.id);
        head.append(b);
      });
      const body = el('div', 'pd-ghp-sum');
      dg.text.split(/\n+/).map(t => t.trim()).filter(Boolean).forEach(t => { const par = el('p'); par.append(rich(t, false)); body.append(par); });
      box.append(head, body, el('div', 'hint', `Written by the AI from the ${notes.length > 1 ? plural(notes.length, 'note') : 'note'} above${dg.written_at ? ', ' + dayMon(dg.written_at) + ' ' + hhmm(dg.written_at) : ''}: nothing is added. The notes are kept as they were said or written — open one to read, correct or remove it.`));
      if (d.may_write) box.append(addBox(k));
      return box;
    }
    box.append(el('div', 'pd-hlabel', notes.length ? `Team reports · ${notes.length}` : `Team reports · nobody wrote on ${k === now() ? 'this day yet' : shortDay(k)}`));
    if (d.digest_wanted && notes.length) {
      const st = dg?.status, line = el('div', 'hint');
      if (st === 'queued' || st === 'claimed') {
        line.textContent = 'The AI is writing these as one text…';
        look(k);
      } else if (st === 'no_key') line.textContent = 'Not written as one text: no Groq key in Settings › Integrations.';
      else {
        line.append(st === 'failed' ? `Not written as one text${dg?.error ? ' — ' + dg.error : ''}. ` : 'Not written as one text yet. ');
        if (d.may_write) {
          const again = el('button', 'linkish', 'Write it');
          again.onclick = async () => {
            again.disabled = true;
            try { await rpc('retry_note_digest', { p_farm: farm.id, p_day: k }); waits.delete(k); await readDay(k, { fresh: true }); draw(); }
            catch (e) { again.disabled = false; toast(clean(e), 'bad'); }
          };
          line.append(again);
        }
      }
      box.append(line);
    }
    const grid = el('div', 'pd-ghp-notegrid');
    notes.forEach(nt => grid.append(noteRow(k, nt)));
    if (d.may_write) grid.append(addBox(k));
    if (grid.childNodes.length) box.append(grid);
    return box;
  }

  function draw() {
    if (gone) return;
    const k = current(), d = data.get(k) || null;
    node.textContent = '';
    node.append(headRow(k), report(k, d), said(k, d));
    if (!d && Date.now() - (tried.get(k) || 0) > 30000) readDay(k).catch(() => {});
    refocus();
  }
  // a click anywhere else, or Escape, closes the calendar
  const shut = e => { if (calMonth && node.isConnected && !(e.type === 'keydown' && e.key !== 'Escape')) { calMonth = null; draw(); } };
  document.addEventListener('click', shut);
  document.addEventListener('keydown', shut);
  // the page makes a kit a unit: the one it leaves stops listening, looking again and painting (review 13 Oct 2026:
  // every kit left two listeners on the document, and its late answers drew the page of the unit just left)
  function dispose() {
    gone = true;
    document.removeEventListener('click', shut);
    document.removeEventListener('keydown', shut);
    timers.forEach(t => clearTimeout(t)); timers.clear();
  }

  // the panel, for the page to place: the same node every time, so what is being typed and played stays. While a
  // voice note plays it is not drawn again: that would take the player away mid-sentence (review 13 Oct 2026)
  const playing = () => [...node.querySelectorAll('audio')].some(p => !p.paused && !p.ended);
  function panel() { if (node.childNodes.length && playing()) refocus(); else draw(); return node; }

  return { readDays, refresh, pills, panel, select, ready: () => known, dispose };
}
